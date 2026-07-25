#!/usr/bin/env node
/**
 * 台鐵「通過站實測校正」資料建置（快車跳站校正 Phase 2）
 *
 * 為什麼要這支：前端在兩個真停靠站之間用一條梯形速度曲線推位置（index.html buildProfile /
 * assignRunProfiles），中途通過站的時刻是從曲線回填的估值。實測顯示這個估值在通過站的時間誤差
 * 中位 51 秒、p90 192 秒（留一日交叉驗證）。本腳本把 TDX 官方歷史逐站觀測煉成兩層校正資料，
 * 讓前端把梯形換成「通過實測點的曲線」，誤差中位降到 ~30 秒（改善約 40%）。
 *
 * 資料源：TDX api/historical/v2 Historical/Rail/TRA/LiveTrainDelay（逐日全台鐵逐站看板事件）
 *   - 一天約 7.2~7.5 萬筆／解壓 13.5MB／gzip 0.95MB；抓取約 2 秒；扣點約 0.09 點／日
 *   - $filter 不支援（會靜默回 0 筆），只能整日抓回自己過濾
 *   - 連打會 429，故逐日單發＋重試＋間隔
 *   - 檔案內資料列「不按時間排序」，且每行開頭可能有 BOM
 *
 * 產出（兩個檔）：
 *   data/tra_pass_obs.json（前端載入）trains: { 車次: { 通過站名: f千分比 } }
 *     f = 該站在跑段內的實測時間比例（0~1000）。第一層＝該車次自己的實測中位；第二層＝在第一層錨點
 *     之間用「路段速度表」推的段時間按比例分配。完全沒有任何實測依據的跑段不寫（前端照舊用梯形）。
 *   data/tra_pass_obs_model.json（稽核用，前端不載入）路段速度表、閘門、剔除統計、第一層原始值
 *
 * 用法：node scripts/build_pass_obs.mjs [天數，預設 7]
 *   憑證讀 .env 的 TDX_CLIENT_ID / TDX_CLIENT_SECRET；原始資料快取在 .cache/tra_hist/（已 gitignore）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'tra_hist');
const AUTH = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API = 'https://tdx.transportdata.tw/api/historical/v2/Historical/Rail/TRA/LiveTrainDelay';

// ── 模型常數（改這裡要同步更新 研究_快車跳站校正 文件的驗證數字）
const GATE = {
  madSec: 90,        // 跨日 f 的中位絕對離差上限（秒）；閘門收太緊會把「實測大贏梯形」的難點丟回梯形
  minDays: 3,        // 至少幾天觀測才採用該通過站（2 天的 MAD＝半個差值,幾乎必然過關）
  windows: [14, 30, 60, 9999],  // 分層時間窗（天）：近期樣本夠就只用近期,不足才往前擴。
                     // 時效性優先（改點、路線工程、運轉調整都會讓舊資料失真）,覆蓋率兜底。
  durLo: 0.45,       // 當日跑段實際歷時 / 表定跑段時間 的下限
  durHi: 2.2,        // 同上上限
  vLo: 8, vHi: 165,  // 相鄰 knot 間平均速度合理區間（km/h）：寬鬆，用來剔逐日離群點
  vFinalHi: 135,     // 產物最終序列的節點間速度上限（台鐵路線最高速限 130，留量測餘裕）
  winMax: 240,       // 通過站板窗（last−first）上限秒：超過＝非瞬時通過
  nMax: 5,           // 通過站板面筆數上限：≥5 多為隱藏停站或起站長掛
  dlyDrift: 2,       // 跑段兩端誤點差上限（分）
  segMinN: 2,        // 路段速度表每個鍵至少樣本數
};

const norm = s => (s || '').replace(/台/g, '臺').trim();
const med = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const R = 6371.0088, rad = Math.PI / 180;
const hav = (a, b) => { const dp = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad; const h = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 車輛性能（與 index.html PERF_RULES 同步；只用來分車種類別與退回梯形）
const PERF_RULES = [
  [/阿里山號|祝山線|神木線|沼平線|觀日/, { k: 'afr', a: .7, b: 1.1, v: 45 }],
  [/普快車|普通車/, { k: 'ord', a: 1.3, b: 2.4, v: 100 }],
  [/\(太/, { k: 'tilt', a: 1.88, b: 3.6, v: 135 }],
  [/\(普/, { k: 'tilt', a: 1.84, b: 3.6, v: 135 }],
  [/\(PP/, { k: 'pp', a: 1.6, b: 2.8, v: 130 }],
  [/\(3000|110[KM]/, { k: 'e3000', a: 2.52, b: 3.6, v: 135 }],
  [/\(D\d/, { k: 'dmu', a: 1.5, b: 2.448, v: 110 }],
  [/自強/, { k: 'tze', a: 1.8, b: 2.9, v: 130 }],
  [/莒光|復興/, { k: 'chu', a: 1.5, b: 2.6, v: 120 }],
  [/電車|區間/, { k: 'emu', a: 2.5, b: 3, v: 120 }],
];
const PERF_BY_TYPE = { '區間車': { k: 'emu', a: 2.5, b: 3, v: 120 }, '區間快': { k: 'emu', a: 2.5, b: 3, v: 120 }, '自強': { k: 'tze', a: 1.8, b: 2.9, v: 130 }, '莒光/復興': { k: 'chu', a: 1.5, b: 2.6, v: 120 } };
const resolvePerf = t => { const cn = t.carName || ''; for (const [re, p] of PERF_RULES) if (re.test(cn)) return p; return PERF_BY_TYPE[t.typeName] || { k: 'def', a: 1.5, b: 2.5, v: 110 }; };

// ── 梯形曲線（與 index.html buildProfile / profProgToTime 逐字一致；僅用於第二層退回）
function buildProfile(Lkm, T, aK, bK, vK) {
  const L = Lkm * 1000, a = aK / 3.6, b = bK / 3.6, vmax = vK / 3.6;
  if (!(L > 0) || !(T > 0) || !(a > 0) || !(b > 0)) return null;
  const k = 1 / a + 1 / b, disc = T * T - 2 * k * L;
  if (disc < 0) return null;
  const vc = (T - Math.sqrt(disc)) / k;
  if (vc > vmax) return null;
  const tAcc = vc / a, tDec = vc / b, tCru = Math.sqrt(disc);
  return { T, L, a, b, vc, tAcc, tCru, tDec, dAcc: vc * vc / (2 * a), dCru: vc * tCru, dDec: vc * vc / (2 * b) };
}
function profProgToTime(p, f) {
  if (f <= 0) return 0; if (f >= 1) return p.T;
  const d = f * p.L;
  if (d < p.dAcc) return Math.sqrt(2 * d / p.a);
  if (d < p.dAcc + p.dCru) return p.tAcc + (d - p.dAcc) / p.vc;
  const dd = d - p.dAcc - p.dCru, disc = p.vc * p.vc - 2 * p.b * dd;
  return p.tAcc + p.tCru + (disc > 0 ? (p.vc - Math.sqrt(disc)) / p.b : p.tDec);
}

// ── 取憑證
function env() {
  const out = {};
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n'))
    if (line.includes('=') && !line.trim().startsWith('#')) {
      const i = line.indexOf('='); out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  return out;
}
async function token(e) {
  const r = await fetch(AUTH, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: e.TDX_CLIENT_ID, client_secret: e.TDX_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error('TDX auth ' + r.status);
  return (await r.json()).access_token;
}
// 逐日抓取（有快取就跳過）；回傳日期陣列
async function fetchDays(days) {
  mkdirSync(CACHE, { recursive: true });
  const today = new Date(Date.now() + 8 * 3600e3);            // 台北日
  const list = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today.getTime() - i * 86400e3);
    list.push(d.toISOString().slice(0, 10));
  }
  list.reverse();
  let tok = null;
  for (const d of list) {
    const p = join(CACHE, `${d}.jsonl.gz`);
    if (existsSync(p) && statSync(p).size > 10000) { console.log(`  ${d} 快取命中`); continue; }
    if (!tok) tok = await token(env());
    let ok = false;
    for (let a = 0; a < 5 && !ok; a++) {
      const r = await fetch(`${API}?Dates=${d}&$top=1000000&$format=JSONL`, { headers: { authorization: 'Bearer ' + tok } });
      if (r.ok) {
        const txt = await r.text();
        writeFileSync(p, gzipSync(Buffer.from(txt), { level: 6 }));
        console.log(`  ${d} 抓取 ${txt.length}B → ${statSync(p).size}B gz（${txt.split('\n').length - 1} 筆）`);
        ok = true;
      } else if ([429, 500, 502, 503].includes(r.status)) { console.log(`  ${d} HTTP ${r.status}，等 ${15 * (a + 1)}s`); await sleep(15000 * (a + 1)); }
      else throw new Error(`${d} HTTP ${r.status}`);
    }
    if (!ok) throw new Error(`${d} 重試耗盡`);
    await sleep(8000);
  }
  return list;
}

// ── 讀快取 → ob[date][train][station] = {first,last,n,dly[]}
function loadObs(dates, holeStat) {
  const ob = {};
  for (const d of dates) {
    const p = join(CACHE, `${d}.jsonl.gz`);
    if (!existsSync(p)) continue;
    const byTrain = {}, minBucket = new Map();
    for (const line of gunzipSync(readFileSync(p)).toString('utf8').replace(/^﻿/, '').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      const t = Date.parse(r.SrcUpdateTime) / 1000, sta = norm(r.StationName?.Zh_tw);
      if (!Number.isFinite(t) || !sta) continue;
      const mb = Math.floor(t / 60); minBucket.set(mb, (minBucket.get(mb) || 0) + 1);
      const T = byTrain[r.TrainNo] || (byTrain[r.TrainNo] = {});
      const e = T[sta] || (T[sta] = { first: t, last: t, n: 0, dly: [], dlyFirst: r.DelayTime || 0, dlyLast: r.DelayTime || 0 });
      if (t < e.first) { e.first = t; e.dlyFirst = r.DelayTime || 0; }
      if (t > e.last) { e.last = t; e.dlyLast = r.DelayTime || 0; }
      e.n++; e.dly.push(r.DelayTime || 0);
    }
    // 斷抓偵測：抓取端掛掉時,該時段的紀錄整段缺失,某站真正的 first 沒收到,
    // 拿到的會是洞結束後的第一筆 → f 系統性偏晚,而板窗守門照不到（窗是變窄不是變寬）。
    // 做法：找連續 ≥5 分鐘完全沒有任何紀錄的洞,把「first 落在洞結束後 120 秒內」的觀測標成不可信。
    const mins = [...minBucket.keys()].sort((a, b) => a - b);
    const holes = [];
    for (let i = 1; i < mins.length; i++) if (mins[i] - mins[i - 1] >= 6) holes.push([mins[i - 1] * 60 + 60, mins[i] * 60]);
    if (holeStat) holeStat.push({ d, rows: [...minBucket.values()].reduce((a, b) => a + b, 0), holes: holes.length,
      holeMin: Math.round(holes.reduce((a, h) => a + (h[1] - h[0]) / 60, 0)) });
    if (holes.length) {
      let killed = 0;
      for (const tn in byTrain) for (const st in byTrain[tn]) {
        const e = byTrain[tn][st];
        for (const [hs, he] of holes) if (e.first >= he && e.first < he + 120) { e.holeSuspect = true; killed++; break; }
      }
      if (holeStat) holeStat[holeStat.length - 1].suspect = killed;
    }
    ob[d] = byTrain;
  }
  return ob;
}

const argv = process.argv.slice(2);
const cliArg = k => { const a = argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };

async function main() {
  const days = +(argv.find(x => /^\d+$/.test(x)) || 7);
  const ONLY = cliArg('only'), OUTDIR = cliArg('out');   // LOO 交叉驗證用：只採這些日期／產物寫到別處
  // 以下兩者只供獨立判準驗收：--mask 把真停靠站遮蔽成偽通過站（於是它的「表定＋官方誤點」可當獨立真值）；
  // --placebo 對通過站觀測注入每(車次,站)固定的憑空偏差,用來檢查驗收指標會不會跟著變差（判準有牙）。
  const MASK = new Set((cliArg('mask') || '').split(',').filter(Boolean).map(norm));
  const PLACEBO = +(cliArg('placebo') || 0);
  if (cliArg('mad')) GATE.madSec = +cliArg('mad');       // 閘門掃描用
  const placeboOff = (a, b) => {
    let h = 2166136261; const str = a + '|' + b;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 2 ? 1 : -1) * PLACEBO;
  };
  if (argv.includes('--quiet')) console.log = () => {};
  console.log(`══ 抓取最近 ${days} 天 ══`);
  const dates = ONLY ? ONLY.split(',') : await fetchDays(days);
  const holeStat = [];
  const ob = loadObs(dates, holeStat);
  const have = dates.filter(d => ob[d]);
  console.log(`══ 讀入 ${have.length} 天觀測 ══`);

  // 日期→距最新觀測日幾天（分層窗用）。基準取最新觀測日而非今天,重跑舊快取結果才可重現；
  // 用實際日期差而非序號,快取有缺日時才不會把窗算寬。
  const latestDay = have[have.length - 1], dayAge = {};
  for (const d of have) dayAge[d] = Math.round((Date.parse(latestDay) - Date.parse(d)) / 86400000);
  const sched = JSON.parse(readFileSync(join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
  // 官方累計里程
  const sol = JSON.parse(readFileSync(join(ROOT, 'data/tra_station_of_line.json'), 'utf8'));
  const pairKm = new Map();
  for (const ln of sol.lines) {
    const st = ln.stations;
    for (let i = 0; i < st.length; i++) for (let j = i + 1; j < Math.min(st.length, i + 12); j++) {
      const km = Math.abs(st[j].cumKm - st[i].cumKm);
      for (const k of [`${norm(st[i].name)}|${norm(st[j].name)}`, `${norm(st[j].name)}|${norm(st[i].name)}`])
        if (!pairKm.has(k) || pairKm.get(k) > km) pairKm.set(k, km);
    }
  }
  const segDist = (a, b) => pairKm.get(`${norm(a.name)}|${norm(b.name)}`) ?? hav(a, b);

  const feedNames = new Set(), schedNames = new Set(), ALIAS = new Map();
  for (const d of have) for (const tn in ob[d]) for (const st in ob[d][tn]) feedNames.add(st);
  for (const t of sched.trains) for (const x of t.stops) schedNames.add(norm(x.name));
  const alias = n => ALIAS.get(n) ?? n;   // 班表站名 → feed 站名（查觀測用；輸出的 key 一律用班表站名）
  // 班表帶括號註記（「新城 (太魯閣)」）而 feed 用本名（「新城」）→ 名稱 join 全滅。
  // 守門用座標不用「名稱不撞」：班表本身同時有「新城」與「新城 (太魯閣)」兩種寫法，
  // 用不撞名當條件會把真別名擋掉；座標同點才是「同一個站」的直接證據。
  const posOf = new Map();
  for (const t of sched.trains) for (const x of t.stops) if (!posOf.has(norm(x.name)) && x.lat) posOf.set(norm(x.name), x);
  for (const n of schedNames) {
    if (feedNames.has(n)) continue;
    const b = n.replace(/\s*[（(][^）)]*[）)]\s*/g, '').trim();
    if (!b || b === n || !feedNames.has(b)) continue;
    const p = posOf.get(n), q = posOf.get(b);
    if (!p || !q || hav(p, q) < 2) ALIAS.set(n, b);
  }
  if (ALIAS.size) console.log(`══ 站名別名 ══ ${[...ALIAS].map(x => x.join('→')).join('、')}`);

  // ── 偏移校準（真停靠站：first vs 表定到站、last vs 表定離站、中點 vs 表定中點）
  const bF = [], bL = [], bM = [], bySt = {};
  for (const t of sched.trains) for (const d of have) {
    const T = ob[d][t.train]; if (!T) continue;
    const any = Object.values(T)[0]; if (!any) continue;
    const day0 = Math.floor((any.first + 8 * 3600) / 86400) * 86400 - 8 * 3600;
    for (const s of t.stops) {
      if (s.stop === false) continue;
      const e = T[alias(norm(s.name))]; if (!e) continue;
      const dly = med(e.dly) * 60, sa = day0 + s.arrSec + dly, sd = day0 + s.depSec + dly;
      if (Math.abs(e.first - sa) > 3 * 3600) continue;
      // 校準樣本要與使用情境同一道守門：不守門的話 first 偏差是 -15s、守門後是 -8s，
      // 這 7s 會整體平移所有通過站的推估時刻。
      if (!(e.last - e.first > GATE.winMax || e.n >= GATE.nMax)) {
        bF.push(e.first - sa);
        (bySt[alias(norm(s.name))] || (bySt[alias(norm(s.name))] = [])).push(e.first - sa);
      }
      bL.push(e.last - sd);
      if (s.depSec - s.arrSec <= 60) bM.push((e.first + e.last) / 2 - (sa + sd) / 2);
    }
  }
  const CAL = { first: Math.round(med(bF)), last: Math.round(med(bL)), mid: Math.round(med(bM)), n: bF.length };
  // 逐站校準：全網站級偏差很小（p90 2s）,但少數站的板面更新時機明顯偏（談文 -67s、知本 -33s…）。
  // 樣本夠多才逐站,否則用全網值——樣本少時逐站中位本身的雜訊比要修的偏差還大。
  const calSt = {};
  for (const k in bySt) if (bySt[k].length >= 100) { const v = Math.round(med(bySt[k])); if (Math.abs(v - CAL.first) >= 10) calSt[k] = v; }
  console.log(`══ 逐站校準 ══ ${Object.keys(calSt).length} 站另用自己的偏移（其餘用全網 ${CAL.first}s）`);
  console.log(`══ 偏移校準 ══ first−到站 ${CAL.first}s／last−離站 ${CAL.last}s／中點 ${CAL.mid}s（n=${CAL.n}）`);

  // ── 主掃描：每車次的 τ（各站實測時刻）、路段速度樣本、跑段內 f
  const trains = {}, segRaw = new Map(), diag = {};
  // 同一份班表內有多筆同車次號（加停變體，實測 434/270/281/324/4041）：觀測按車次號 join 會把
  // 兩種停站型態混在一起，且 trains[t.train] 後者覆蓋前者。實測這 5 個號的各變體站清單完全相同、
  // 只差 1–2 站的停靠標記 → 取第一筆處理、把分歧站當通過站（first＝到站時刻，停或不停語意相同），
  // 跑段結構就一致、f 可共用；站清單真的不同才整批排除（否則丟掉 5 個長途車次共 800+ 個槽位）。
  const dupNo = new Set(), varDis = new Map(), doneNo = new Set(), doneNo2 = new Set(); {
    const by = {}; for (const t of sched.trains) (by[t.train] || (by[t.train] = [])).push(t);
    for (const k in by) {
      const v = by[k]; if (v.length < 2) continue;
      const base = v[0].stops.map(x => norm(x.name));
      if (v.some(x => x.stops.length !== base.length || x.stops.some((y, i) => norm(y.name) !== base[i]))) { dupNo.add(k); continue; }
      const dis = new Set();
      for (let i = 0; i < base.length; i++) if (new Set(v.map(x => x.stops[i].stop !== false)).size > 1) dis.add(base[i]);
      varDis.set(k, dis);
    }
  }
  const stat = { trains: 0, runs: 0, slots: 0, taken: 0, skipDup: 0, skipDupNo: 0, skipVar: 0, rejEnds: 0, rejDur: 0, rejMono: 0, rejRange: 0, rejMad: 0, rejV: 0, rejDayV: 0, rejWin: 0, rejDrift: 0, segFillVbar: 0, segFillTrap: 0, segFillLin: 0, rejHole: 0 };
  for (const t of sched.trains) {
    const s = t.stops;
    if (!s.some(x => x.stop === false)) continue;
    const names = s.map(x => norm(x.name));
    if (new Set(names).size !== names.length) { stat.skipDup++; continue; }   // 折返/環島：站名重複無法用名稱 join
    if (dupNo.has(t.train)) { stat.skipDupNo++; continue; }
    if (varDis.has(t.train)) { if (doneNo.has(t.train)) { stat.skipVar++; continue; } doneNo.add(t.train); }
    stat.trains++;
    const perf = resolvePerf(t), cls = perf.k;
    const oNames = names.map(alias);
    const vd = varDis.get(t.train);
    const segKm = []; for (let i = 0; i < s.length - 1; i++) segKm.push(segDist(s[i], s[i + 1]));
    const stopArr = s.map((x, i) => i === 0 || i === s.length - 1 || (x.stop !== false && !MASK.has(names[i]) && !vd?.has(names[i])));
    // 逐日各站實測時刻
    const tau = {};
    for (const d of have) {
      const T = ob[d][t.train]; if (!T) continue;
      const m = {};
      const day0 = Math.floor((Object.values(T)[0].first + 8 * 3600) / 86400) * 86400 - 8 * 3600;
      for (let i = 0; i < s.length; i++) {
        const e = T[oNames[i]]; if (!e) continue;
        if (stopArr[i]) {                       // 真停靠站：表定＋該站實測誤點（比時間戳可靠，看板尾巴 p90 +391s）
          m[i] = { arr: day0 + s[i].arrSec + e.dlyFirst * 60, dep: day0 + s[i].depSec + e.dlyLast * 60,
                   dA: e.dlyFirst, dL: e.dlyLast };
          continue;
        }
        // 通過站：用 first 不用中點。中點的偏移隨板窗筆數劇烈漂移（n=1 −38s／n=4 +112s，極差 150s，
        // 而通過站有 49% 是 n=1），first 只有 15s 極差。板窗過寬或筆數多＝不是瞬間通過（隱藏停站、
        // 起站長掛上板），單一常數校不了 → 直接不當觀測點。
        if (e.last - e.first > GATE.winMax || e.n >= GATE.nMax) { stat.rejWin++; continue; }
        if (e.holeSuspect) { stat.rejHole++; continue; }   // 抓取斷線後的第一筆,first 不可信
        const tp = e.first - (calSt[oNames[i]] ?? CAL.first) + (PLACEBO ? placeboOff(t.train, names[i]) : 0);
        m[i] = { arr: tp, dep: tp };
      }
      tau[d] = m;
      // 路段速度樣本
      for (let i = 0; i < s.length - 1; i++) {
        const A = m[i], B = m[i + 1]; if (!A || !B) continue;
        const dt = B.arr - A.dep;
        if (!(dt > 15) || dt > 3600) continue;
        const v = segKm[i] / (dt / 3600);
        if (!(v > GATE.vLo && v < GATE.vHi)) continue;
        const key = `${names[i]}|${names[i + 1]}|${stopArr[i] ? 'S' : 'P'}${stopArr[i + 1] ? 'S' : 'P'}|${cls}`;
        (segRaw.get(key) || segRaw.set(key, []).get(key)).push(v);
      }
    }
    // 跑段
    const bounds = []; for (let i = 0; i < s.length; i++) if (stopArr[i]) bounds.push(i);
    const rec = {};
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const k0 = bounds[bi], k1 = bounds[bi + 1];
      if (k1 - k0 < 2) continue;
      stat.runs++; stat.slots += k1 - k0 - 1;
      const runT = s[k1].arrSec - s[k0].depSec;
      let runKm = 0; for (let i = k0; i < k1; i++) runKm += segKm[i];
      const knots = []; let cum = 0;
      for (let i = k0; i < k1 - 1; i++) { cum += segKm[i]; knots.push({ i: i + 1, name: names[i + 1], km: cum }); }
      const vals = {}, durs = [];   // vals[站]=[{d,f}]、durs=[{d,dur}]：分層選窗要按日期篩
      for (const d of have) {
        const m = tau[d]; if (!m || !m[k0] || !m[k1]) { stat.rejEnds++; continue; }
        if (Math.abs((m[k1].dA ?? 0) - (m[k0].dL ?? 0)) >= GATE.dlyDrift) { stat.rejDrift++; continue; }
        const tDep = m[k0].dep, dur = m[k1].arr - tDep;
        if (!(dur > 45) || dur < GATE.durLo * runT || dur > GATE.durHi * runT) { stat.rejDur++; continue; }
        const day = {}; let prev = 0, bad = false, prevKm = 0;
        for (const kn of knots) {
          const e = m[kn.i]; if (!e) continue;
          const f = (e.arr - tDep) / dur;
          if (f <= prev) { bad = true; break; }                       // 當日非單調 → 整段丟（多半是站名 join 錯或繞行）
          if (!(f > 0.005 && f < 0.995)) { stat.rejRange++; continue; }
          const spd = (kn.km - prevKm) / (((f - prev) * dur) / 3600);
          if (spd > GATE.vHi || spd < GATE.vLo) { stat.rejDayV++; continue; }   // 該日該點不合物理(3.8%)：丟點不丟整段
          prev = f; prevKm = kn.km; day[kn.name] = f;
        }
        if (bad) { stat.rejMono++; continue; }
        if (!Object.keys(day).length) continue;
        durs.push({ d, dur });
        for (const k in day) (vals[k] || (vals[k] = [])).push({ d, f: day[k] });
      }
      const rpT = buildProfile(runKm, runT, perf.a, perf.b, perf.v);   // 同跑段的梯形,用來量「實測 vs 梯形」的系統偏差
      let prevF = 0, prevKm = 0;
      for (const kn of knots) {
        const raw = vals[kn.name];
        if (!raw || raw.length < GATE.minDays) continue;
        // 分層選窗：由近而遠,第一個湊到 minDays 的窗就用它（不繼續往外擴,避免混入過時型態）
        let a = null, usedWin = 0;
        for (const w of GATE.windows) {
          const sel = raw.filter(x => dayAge[x.d] < w);
          if (sel.length >= GATE.minDays) { a = sel.map(x => x.f); usedWin = w; break; }
        }
        if (!a) continue;
        const dSel = new Set(raw.filter(x => dayAge[x.d] < usedWin).map(x => x.d));
        const durMed = med(durs.filter(x => dSel.has(x.d)).map(x => x.dur));
        if (!(durMed > 0)) continue;
        const f = med(a);
        const mad = med(a.map(v => Math.abs(v - f))) * durMed;
        if (mad > GATE.madSec) { stat.rejMad++; continue; }            // 逐日行為不穩定 → 不採用
        if (f <= prevF) { stat.rejMono++; continue; }
        const v = (kn.km - prevKm) / (((f - prevF) * durMed) / 3600);
        if (!(v > GATE.vLo && v < GATE.vHi)) { stat.rejV++; continue; }
        prevF = f; prevKm = kn.km;
        rec[kn.name] = Math.round(f * 1000);
        // 訊號／噪音診斷：mad＝同站跨日重現的離散（噪音）；dev＝實測中位與梯形的差（訊號,正=比梯形晚到）
        const fT = rpT ? profProgToTime(rpT, kn.km / runKm) / runT : kn.km / runKm;
        (diag[t.train] || (diag[t.train] = {}))[kn.name] =
          [Math.round(mad), a.length, Math.round((f - fT) * durMed), usedWin];
        stat.taken++;
      }
    }
    if (Object.keys(rec).length) trains[t.train] = rec;
  }
  // 路段速度表（取中位、樣本數夠才留）
  const segs = {};
  for (const [k, arr] of [...segRaw].sort((a, b) => a[0] < b[0] ? -1 : 1))
    if (arr.length >= GATE.segMinN) segs[k] = [+med(arr).toFixed(1), arr.length];
  // 查表：段+邊界+車種 → 段+邊界(不分車種) → 換算其他邊界型別
  const BT_FIX = { SP: 1.269, PS: 1.21, SS: 1.466 };   // v_PP / v_bt 中位（由同段共有觀測估出）
  const vLook = (A, B, bt, cls) => {
    const s1 = segs[`${A}|${B}|${bt}|${cls}`]; if (s1) return s1[0];
    let best = null, bn = 0;
    for (const other of ['PP', 'SP', 'PS', 'SS']) for (const k in segs) {
      if (!k.startsWith(`${A}|${B}|${other}|`)) continue;
      const [v, n] = segs[k];
      if (n > bn) { bn = n; best = v * ((other === 'PP' ? 1 : BT_FIX[other]) / (bt === 'PP' ? 1 : BT_FIX[bt])); }
    }
    return best;
  };

  // ── 第二輪：兩層合成 → 每個通過站的最終 f
  //   A 有實測的點當「錨點」；錨點之間的其餘通過站，用路段速度表推出的段時間按比例分配（保證單調）。
  //   兩層都沒有的段落一律留空（前端該跑段仍照舊用梯形，或以現有錨點線性內插）。
  const finalF = {}, srcCount = { a: 0, b: 0, none: 0 };
  for (const t of sched.trains) {
    const s = t.stops;
    if (!s.some(x => x.stop === false)) continue;
    if (dupNo.has(t.train)) continue;
    const names = s.map(x => norm(x.name));
    if (new Set(names).size !== names.length) continue;
    if (varDis.has(t.train)) { if (doneNo2.has(t.train)) continue; doneNo2.add(t.train); }
    const cls = resolvePerf(t).k;
    const vd = varDis.get(t.train);
    const segKm = []; for (let i = 0; i < s.length - 1; i++) segKm.push(segDist(s[i], s[i + 1]));
    const stopArr = s.map((x, i) => i === 0 || i === s.length - 1 || (x.stop !== false && !MASK.has(names[i]) && !vd?.has(names[i])));
    const A = trains[t.train] || {};
    const bounds = []; for (let i = 0; i < s.length; i++) if (stopArr[i]) bounds.push(i);
    const rec = {};
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const k0 = bounds[bi], k1 = bounds[bi + 1];
      if (k1 - k0 < 2) continue;
      const mid = []; for (let i = k0 + 1; i < k1; i++) mid.push(i);
      const hasA = mid.some(i => A[names[i]] != null);
      let segHit = 0;
      // 段時間（路段速度表；查不到者記 null）
      const tSeg = [];
      for (let i = k0; i < k1; i++) {
        const v = vLook(names[i], names[i + 1], `${stopArr[i] ? 'S' : 'P'}${stopArr[i + 1] ? 'S' : 'P'}`, cls);
        if (v) segHit++;
        tSeg.push(v ? segKm[i] / v * 3600 : null);
      }
      // 查不到速度的小段的補法,由好到壞三段式：
      //  (1) 同跑段內查得到的段所反映的「實測速度水準」× 該段邊界型修正 —— 梯形的速度水準已證實只比
      //      等速好 5 秒,而同跑段的實測水準是這條路線這個時段的真實速度,遠比車種估值可靠
      //  (2) 沒有任何段查得到 → 退梯形曲線的隱含時間
      //  (3) 連梯形都建不出來（不可行段）→ 純里程比例
      const runT2 = s[k1].arrSec - s[k0].depSec;
      let runKm2 = 0; for (let i = k0; i < k1; i++) runKm2 += segKm[i];
      const rp2 = buildProfile(runKm2, runT2, resolvePerf(t).a, resolvePerf(t).b, resolvePerf(t).v);
      // 實測速度水準：把查得到的段先還原成「等效 PP 速度」（除掉邊界型修正）再取里程加權平均
      let vbKm = 0, vbHr = 0;
      for (let i = 0; i < tSeg.length; i++) {
        if (tSeg[i] == null || !(tSeg[i] > 0)) continue;
        const bt = `${stopArr[k0 + i] ? 'S' : 'P'}${stopArr[k0 + i + 1] ? 'S' : 'P'}`;
        const fix = bt === 'PP' ? 1 : BT_FIX[bt];
        vbKm += segKm[k0 + i]; vbHr += (tSeg[i] / 3600) / fix;      // 除以 fix ＝ 還原成無邊界成本的速度
      }
      const vBar = vbHr > 0 ? vbKm / vbHr : null;
      let cumKm2 = 0;
      for (let i = 0; i < tSeg.length; i++) {
        const kmA = cumKm2, kmB = cumKm2 + segKm[k0 + i]; cumKm2 = kmB;
        if (tSeg[i] != null) continue;
        const bt = `${stopArr[k0 + i] ? 'S' : 'P'}${stopArr[k0 + i + 1] ? 'S' : 'P'}`;
        if (vBar) { tSeg[i] = segKm[k0 + i] / vBar * 3600 * (bt === 'PP' ? 1 : BT_FIX[bt]); stat.segFillVbar++; }
        else if (rp2) { tSeg[i] = profProgToTime(rp2, kmB / runKm2) - profProgToTime(rp2, kmA / runKm2); stat.segFillTrap++; }
        else { tSeg[i] = segKm[k0 + i] / runKm2 * runT2; stat.segFillLin++; }
      }
      const haveAllSeg = tSeg.every(x => x != null && x > 0);
      const cumT = [0]; for (let i = 0; i < tSeg.length; i++) cumT.push(cumT[i] + tSeg[i]);
      // 錨點（含跑段兩端）
      const anch = [{ j: 0, f: 0 }];
      mid.forEach((i, idx) => { const f = A[names[i]]; if (f != null) anch.push({ j: idx + 1, f: f / 1000 }); });
      anch.push({ j: mid.length + 1, f: 1 });
      if (!hasA && !segHit) { srcCount.none += mid.length; continue; }   // 純梯形＝零資訊，不寫進產物
      for (let ai = 0; ai < anch.length - 1; ai++) {
        const L = anch[ai], Rr = anch[ai + 1];
        for (let j = L.j + 1; j < Rr.j; j++) {
          const i = mid[j - 1];
          if (haveAllSeg && cumT[Rr.j] > cumT[L.j]) {
            rec[names[i]] = Math.round(1000 * (L.f + (Rr.f - L.f) * (cumT[j] - cumT[L.j]) / (cumT[Rr.j] - cumT[L.j])));
            srcCount.b++;
          } else srcCount.none++;
        }
        if (Rr.j <= mid.length) { rec[names[mid[Rr.j - 1]]] = Math.round(Rr.f * 1000); srcCount.a++; }
      }
      // ── 最終速度清洗：前端把每個 f 當節點吃，節點間速度必須合物理。
      //    第二層是「按段時間比例分配」，只保證單調不保證速度；第一層錨點也可能兩兩太近。
      //    違規時丟「刪掉後局部速度最接近該車種巡航速度」的那個中間節點，迭代到全合格（丟點不丟段）。
      const runTc = s[k1].arrSec - s[k0].depSec;
      if (runTc > 0) {
        const kmAt = [0]; for (let i = k0; i < k1; i++) kmAt.push(kmAt[kmAt.length - 1] + segKm[i]);
        const vRef = resolvePerf(t).v;
        for (let guard = 0; guard < mid.length + 2; guard++) {
          // 目前節點序列（含兩端）
          const seq = [{ i: k0, f: 0, km: 0 }];
          mid.forEach((i, idx) => { const g = rec[names[i]]; if (g != null) seq.push({ i, f: g / 1000, km: kmAt[idx + 1] }); });
          seq.push({ i: k1, f: 1, km: kmAt[kmAt.length - 1] });
          const spdOf = (a, b) => (b.km - a.km) / (((b.f - a.f) * runTc) / 3600);
          let worst = -1, worstV = 0;
          for (let e = 1; e < seq.length; e++) {
            const v = spdOf(seq[e - 1], seq[e]);
            if ((v > GATE.vFinalHi || v < GATE.vLo) && Math.abs(v - vRef) > worstV) { worstV = Math.abs(v - vRef); worst = e; }
          }
          if (worst < 0) break;
          const cand = [worst - 1, worst].filter(x => x > 0 && x < seq.length - 1);
          if (!cand.length) break;                       // 兩端相鄰即違規＝表定本身如此，非本層造成
          let del = cand[0], bestScore = Infinity;
          for (const c of cand) {
            const v2 = spdOf(seq[c - 1], seq[c + 1]), sc = Math.abs(v2 - vRef);
            if (sc < bestScore) { bestScore = sc; del = c; }
          }
          delete rec[names[seq[del].i]];
          stat.rejFinalV = (stat.rejFinalV || 0) + 1;
        }
      }
    }
    if (Object.keys(rec).length) finalF[t.train] = rec;
  }
  const sortObj = o => Object.fromEntries(Object.entries(o).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true })));
  const metaCommon = {
    source: 'TDX api/historical/v2 Historical/Rail/TRA/LiveTrainDelay',
    built_at: new Date().toISOString(),
    dates: have, sched_date_range: sched.dateRange,
  };
  // 前端要用的：每個通過站在跑段內的實測時間比例（千分比）
  const dst = join(OUTDIR || join(ROOT, 'data'), 'tra_pass_obs.json');
  writeFileSync(dst, JSON.stringify({
    ...metaCommon,
    notes: '通過站在跑段內的實測時間比例(千分比,0~1000)。前端據此把梯形曲線換成通過實測點的曲線；'
      + '缺值的跑段照舊用梯形。產生方式與驗證數字見 研究_快車跳站校正_2026-07-24.md。',
    calib: CAL,
    trains: sortObj(Object.fromEntries(Object.entries(finalF).map(([k, v]) => [k, sortObj(v)]))),
  }));
  // 稽核用（前端不載入）：路段速度表、閘門、剔除統計
  const dstM = join(OUTDIR || join(ROOT, 'data'), 'tra_pass_obs_model.json');
  writeFileSync(dstM, JSON.stringify({
    ...metaCommon, calib: CAL, calib_station: calSt, gates: GATE, bt_fix: BT_FIX,
    holes: holeStat.filter(h => h.holes > 0),
    stats: { ...stat, srcCount, trainsWithA: Object.keys(trains).length, trainsFinal: Object.keys(finalF).length },
    trains_layerA: sortObj(Object.fromEntries(Object.entries(trains).map(([k, v]) => [k, sortObj(v)]))),
    segs: sortObj(segs),
  }, null, 1));
  writeFileSync(join(OUTDIR || join(ROOT, 'data'), 'tra_pass_obs_diag.json'), JSON.stringify({
    note: '第一層逐節點診斷：[跨日離散 mad 秒, 觀測天數, 實測中位−梯形 秒]。分析中間產物,不進版控、前端不讀。',
    trains: sortObj(Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, sortObj(v)]))),
  }, null, 1));
  console.log(`\n══ 統計 ══`);
  console.log(`  含通過站車次 ${stat.trains}（站名重複跳過 ${stat.skipDup}）；跑段 ${stat.runs}；通過站槽位 ${stat.slots}`);
  console.log(`  第一層(該車次實測) 採用 ${stat.taken}（${(100 * stat.taken / stat.slots).toFixed(1)}%）／車次 ${Object.keys(trains).length}`);
  console.log(`  剔除：兩端缺 ${stat.rejEnds}、歷時異常 ${stat.rejDur}、非單調 ${stat.rejMono}、越界 ${stat.rejRange}、離散過大 ${stat.rejMad}、逐日不合物理 ${stat.rejDayV}、中位不合物理 ${stat.rejV}`
    + `、板窗不合 ${stat.rejWin}、斷抓可疑 ${stat.rejHole}、端點誤點漂移 ${stat.rejDrift}、同號變體車次 ${stat.skipDupNo}（站清單相同而合併處理 ${stat.skipVar}）`);
  {
    const wc = {};
    for (const t in diag) for (const st in diag[t]) { const w = diag[t][st][3]; wc[w] = (wc[w] || 0) + 1; }
    console.log(`  分層窗用量：` + Object.entries(wc).sort((a, b) => a[0] - b[0])
      .map(([w, n]) => `${w === '9999' ? '全部' : w + '天'} ${n}`).join('、'));
  }
  console.log(`  第二層(路段速度表) ${Object.keys(segs).length} 鍵`);
  console.log(`  合成結果：A 錨點 ${srcCount.a}、B 填補 ${srcCount.b}、兩層皆無 ${srcCount.none}`
    + `　→ 覆蓋 ${srcCount.a + srcCount.b}／${stat.slots}（${(100 * (srcCount.a + srcCount.b) / stat.slots).toFixed(1)}%）`);
  console.log(`  → ${dst}（${(statSync(dst).size / 1024).toFixed(0)} KB，前端載入）`);
  console.log(`  → ${dstM}（${(statSync(dstM).size / 1024).toFixed(0)} KB，稽核用）`);
}
export { buildProfile, profProgToTime, resolvePerf, norm, med, loadObs, CACHE };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch(e => { console.error('失敗：', e.message); process.exit(1); });
