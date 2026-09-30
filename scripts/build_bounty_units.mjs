// 從既有的軌道 JSON 與班表 JSON 產生計價單位清單 data/bounty_units.json。
//
// 為什麼是建置期而不是 cron:單位清單只在改點時才變,每天在 worker 裡重算等於
// (a) 白燒 CPU (b) 把 index.html 的 lineNetwork() 線網拓樸複製一份進 worker——
// 而那會製造第二個真相源,改點時兩邊會不同步。跟著 npm run fetch-schedule 一起跑。
//
// 區間切法逐字比照 index.html 的 lineNetwork()(9166)與 writeSegments()(9187):
// 站依里程排序取相鄰對＝該線最細的「正規區間」;一段停靠區間攤成所有**中點落在其中**的正規區間。
// 兩邊必須用同一套鍵空間,否則使用者的收集地圖與懸賞板講的不是同一件事。
//
// 跑法:node scripts/build_bounty_units.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// [軌道檔, 班表檔, 系統代號]。班表為 null 的系統(捷運)沒有逐車班表,只出 dwell 不出 track——
// 那些線的 track 單位要等捷運班表管線就緒再補,現在硬出會得到一個沒人驗得了的清單。
const SOURCES = [
  { track: 'data/tra.json', sched: 'data/tra_schedule_dense.json', sys: 'tra_sched' },
  { track: 'data/thsr_track.json', sched: 'data/thsr_schedule_dense.json', sys: 'thsr_sched' },
  { track: 'data/afr.json', sched: 'data/afr_schedule_dense.json', sys: 'afr_sched' },
];

const segKey = (sys, lnId, a, b) => `${sys}|${lnId}|${a < b ? a + '|' + b : b + '|' + a}`;

// 比照 lineNetwork():同名或幾乎重合(同站不同月台)的相鄰站不成一段
function canonicalSegs(sys, ln) {
  const sts = (ln.stations || []).filter(s => s.d != null && s.name).slice().sort((a, b) => a.d - b.d);
  const segs = [];
  for (let i = 1; i < sts.length; i++) {
    const a = sts[i - 1], b = sts[i];
    if (a.name === b.name || Math.abs(b.d - a.d) < 0.05) continue;
    segs.push({ key: segKey(sys, ln.id, a.name, b.name), mid: (a.d + b.d) / 2 });
  }
  return segs;
}

const lines = {};        // "sys|lnId" → {sys,lnId,name,stations}
const lineSegs = {};     // "sys|lnId" → [{key,mid}]
const byName = {};       // sys → 站名 → [{lk, d}]
for (const src of SOURCES) {
  if (!existsSync(src.track)) { console.log(`  · 略過(缺軌道檔) ${src.track}`); continue; }
  const t = JSON.parse(readFileSync(src.track, 'utf8'));
  byName[src.sys] = byName[src.sys] || {};
  for (const ln of (t.lines || [])) {
    const lk = `${src.sys}|${ln.id}`;
    lines[lk] = { sys: src.sys, lnId: ln.id, name: ln.name || ln.id,
      stations: (ln.stations || []).filter(s => s.d != null && s.name).map(s => ({ name: s.name, d: s.d })).sort((a, b) => a.d - b.d) };
    lineSegs[lk] = canonicalSegs(src.sys, ln);
    for (const s of lines[lk].stations) (byName[src.sys][s.name] = byName[src.sys][s.name] || []).push({ lk, d: s.d });
  }
}

// 一段停靠區間要歸給哪一條線:兩端站都在的線裡,取里程差最小的那一條。
// 逐段選線(而不是整趟一次選)在這裡是對的——班表的一趟車本來就會跨線(例如縱貫線轉宜蘭線)。
// (規格 §6 那條「整趟一次性歸屬」講的是 GPS 軌跡的並行區間,是另一件事:那裡的候選線在空間上重疊,
//  逐點選會在分歧點來回跳;這裡的候選線是靠站名比對出來的,沒有那個問題。)
function pickLine(sys, a, b) {
  const A = (byName[sys] || {})[a] || [], B = (byName[sys] || {})[b] || [];
  let best = null;
  for (const x of A) for (const y of B) {
    if (x.lk !== y.lk) continue;
    const gap = Math.abs(y.d - x.d);
    if (!best || gap < best.gap) best = { lk: x.lk, dA: x.d, dB: y.d, gap };
  }
  return best;
}

// 單位鍵 → 各日的班次數（第 i 格＝這個系統班表的第 i 天）。perDay＝各日的中位數，沒有這種車的日子算 0。
const trackDaily = new Map();     // "segKey|track|dir|車種"
const dwellDaily = new Map();     // "segKey|dwell|0|車種|slot"
const holidayDaily = new Map();   // "segKey|車種"：peak＋off 合計，給 holiday 單位用（見下面 holiday 那一段）
const peakHoursBySys = {};      // sys → 尖峰小時；驗證 cron 依同一份建置產物判 dwell slot
let schedDate = '', nTrain = 0;
const daysBySys = {};    // sys → 班表天數（只印在建置輸出）
const bump = (map, k, di, nDays) => { let a = map.get(k); if (!a) map.set(k, a = new Array(nDays).fill(0)); a[di]++; };
// 偶數個取中間兩個的平均（與 worker.js 的 bountyMedian 同一個定義）
const median = xs => { const a = xs.slice().sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// 班表有兩種形狀：單一服務日（高鐵、林鐵：trains 就是那一天的全部班次），或台鐵的 14 天逐日聯集
// （trains 是跨日去重後的班次定義，dates 是「日期 → 當天行駛的 trains 索引」）。回傳 [[日期, 當天的班次], …]。
// 🔴 第十一輪獨立驗收 P2-4：聯集整份當成一天算的話，只開一天的臨時車、同車次改點的第二份定義都被算成每天一班——
// 09-30 那一版多出 225 個單位，219 個的車只開 4 天以內（其中 142 個只開 1 天），尖峰時段也跟著偏。
function scheduleDays(file, S) {
  const trains = S.trains || [];
  if (S.dates == null) return [[S.date || '', trains]];
  if (typeof S.dates !== 'object' || Array.isArray(S.dates)) throw new Error(`${file} 的 dates 不是「日期 → 班次索引」`);
  const ds = Object.keys(S.dates).sort();
  if (!ds.length) throw new Error(`${file} 的 dates 是空的`);
  return ds.map(d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`${file} 的 dates 有不是日期的鍵：${d}`);
    const idx = S.dates[d], seen = new Set();
    if (!Array.isArray(idx)) throw new Error(`${file} 的 ${d} 不是班次索引陣列`);
    return [d, idx.map(i => {
      if (!Number.isInteger(i) || i < 0 || i >= trains.length || seen.has(i)) throw new Error(`${file} 的 ${d} 有壞的班次索引：${i}`);
      seen.add(i);
      return trains[i];
    })];
  });
}

// 時段切法:用每小時發車數的上四分位自動切「尖峰」,不手寫時段表。
// 手寫的會變成下一個 sanying-trial-hours-expiry(寫死的營運時段過期之後生出幽靈列車)。
// 多天的班表逐日各算一次每小時的停站數，每個小時取各日的中位數，再切上四分位（週末與臨時車不會把尖峰推走）。
function peakHours(days) {
  const perDay = days.map(([, trains]) => {
    const h = new Array(24).fill(0);
    for (const tr of trains) for (const s of (tr.stops || [])) if (s.stop !== false) h[Math.floor(((s.depSec || 0) % 86400) / 3600)]++;
    return h;
  });
  const h = Array.from({ length: 24 }, (_, i) => median(perDay.map(x => x[i])));
  const sorted = h.slice().sort((a, b) => a - b);
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return new Set(h.map((n, i) => (n >= q3 ? i : -1)).filter(i => i >= 0));
}

for (const src of SOURCES) {
  if (!existsSync(src.sched)) { console.log(`  · 略過(缺班表) ${src.sched}`); continue; }
  const S = JSON.parse(readFileSync(src.sched, 'utf8'));
  const trains = S.trains || [];
  // 行駛日只認檔案層級的 dates（見 scheduleDays）。若日後改成逐車帶行駛日清單,perDay 就會靜默算錯——
  // 所以這裡直接擋下來吵一聲,而不是猜。
  if (trains.some(t => t.days || t.dates)) throw new Error(`${src.sched} 帶了逐車行駛日,perDay 的算法要重寫`);
  const days = scheduleDays(src.sched, S), nDays = days.length;
  daysBySys[src.sys] = nDays;
  schedDate = schedDate || S.date || '';
  nTrain += trains.length;
  const peak = peakHours(days);
  peakHoursBySys[src.sys] = [...peak].sort((a, b) => a - b);
  for (const [di, [, dayTrains]] of days.entries()) for (const tr of dayTrains) {
    const kind = tr.typeName || tr.carName || '其他';
    const stops = (tr.stops || []).filter(s => s.name);
    for (let i = 1; i < stops.length; i++) {
      const pick = pickLine(src.sys, stops[i - 1].name, stops[i].name);
      if (!pick) continue;                       // 兩端站配不到共同線:跳過,不猜
      const dir = pick.dA <= pick.dB ? 0 : 1;
      const lo = Math.min(pick.dA, pick.dB), hi = Math.max(pick.dA, pick.dB);
      for (const seg of (lineSegs[pick.lk] || [])) {
        if (seg.mid < lo || seg.mid > hi) continue;
        bump(trackDaily, `${seg.key}|track|${dir}|${kind}`, di, nDays);
      }
    }
    // 停站點:任何軌跡經過車站都自帶樣本,邊際成本近零(規格 §4)
    for (const s of stops) {
      if (s.stop === false) continue;
      const home = ((byName[src.sys] || {})[s.name] || [])[0];
      if (!home) continue;
      const lnId = home.lk.split('|')[1];
      const slot = peak.has(Math.floor(((s.depSec || 0) % 86400) / 3600)) ? 'peak' : 'off';
      const sk = segKey(src.sys, lnId, s.name, s.name);
      bump(dwellDaily, `${sk}|dwell|0|${kind}|${slot}`, di, nDays);
      bump(holidayDaily, `${sk}|${kind}`, di, nDays);
    }
  }
}

// perDay＝各日班次數的中位數。中位數是 0＝一半以上的日子沒有這種車（臨時車、只開幾天的改點），不出單位。
const units = [];
for (const [k, daily] of trackDaily) {
  const n = median(daily);
  if (!(n > 0)) continue;
  const p = k.split('|');            // sys|lnId|A|B|track|dir|車種
  units.push({ segKey: p.slice(0, 4).join('|'), sys: p[0], trainKind: p[6], dir: Number(p[5]), kind: 'track', slot: '', perDay: n });
}
// 假日停站另立一個單位:假日班表另有一份,但停站時間的招募難度與平日同級,perDay 直接沿用。
// 不另抓假日班表是刻意的——L1 量的是招募難度,不是精確班次數,為了小數點差異多接一條資料管線不划算。
// 🔴 holiday 的 perDay 必須先按 (segKey,trainKind) 把 peak/off 兩個 slot 加總,再各出一個
// holiday 單位——一個站的同一車種通常同時有 peak 與 off 兩筆 dwell 計數(一天裡本來就有尖峰
// 也有離峰),若每個 slot 各自照抄自己的 perDay 生一個 holiday 單位,會生出兩個 PK 完全相同
// (seg_key,train_kind,dir,kind='dwell',slot='holiday')但 perDay 不同的重複 unit——寫進
// D1 時 INSERT OR IGNORE 只留下第一個,另一個的 perDay 靜默消失,而且哪個先到是 Map 疊代順序
// 決定,行為不可預期。此 bug 由 scripts/verify_bounty_valuation.mjs 的 F4(PK 五元組唯一性)
// 抓到(519 組重複,見 task-5-report.md)。
// 逐日的「全天合計」在計數時就另外記在 holidayDaily（同一站同一車種每停一次加 1，不分 slot），取中位數。
for (const [k, daily] of dwellDaily) {
  const n = median(daily);
  if (!(n > 0)) continue;
  const p = k.split('|');            // sys|lnId|站|站|dwell|0|車種|slot
  units.push({ segKey: p.slice(0, 4).join('|'), sys: p[0], trainKind: p[6], dir: 0, kind: 'dwell', slot: p[7], perDay: n });
}
for (const [totalKey, daily] of holidayDaily) {
  const n = median(daily);
  if (!(n > 0)) continue;
  const p = totalKey.split('|');     // sys|lnId|站|站|車種
  units.push({ segKey: p.slice(0, 4).join('|'), sys: p[0], trainKind: p[4], dir: 0, kind: 'dwell', slot: 'holiday', perDay: n });
}

const out = { generatedAt: Date.now(), schedDate, peakHoursBySys, lines, units };
writeFileSync('data/bounty_units.json', JSON.stringify(out));
const nTrack = units.filter(u => u.kind === 'track').length;
console.log(`班表日 ${schedDate}（天數 ${JSON.stringify(daysBySys)}，perDay 取各日中位數）・${nTrain} 份班次定義 → 計價單位 ${units.length}（軌道 ${nTrack}／停站 ${units.length - nTrack}）・線 ${Object.keys(lines).length}`);
