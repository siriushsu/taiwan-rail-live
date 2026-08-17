#!/usr/bin/env node
// 地圖動畫健康掃描：對任一 URL（正式站／預覽站／本機）跑一次，回報畫面上的車有沒有異常。
//
// 判準一律落在 state._freqHits ——那是畫車迴圈每一幀重建的「這台車實際畫在螢幕哪裡」，
// 不是管線算出來的中間量。08-17 稽核的教訓：量 lastShift 中位數／roster.positions
// 這類與實作同源的量，實作錯了判準會跟著一起錯，38 項全綠也看不到 4 倍超衝。
//
// 量四件事（都是使用者真的會看到的形態）：
//   1. 同向疊車：同線同方向的車在畫面上重疊。對向交會是正常的，必須先分方向再算。
//   2. 倒退：兩次取樣之間沿線位移為負。
//   3. 車數：與官方逐車清單比，過多（幽靈）或過少（掉車）。
//   4. 停滯：整段觀測窗完全沒動，而同線其他車有動。
//
// 用法：
//   node scripts/scan_map_health.mjs [url] [--json out.json] [--gap 20]
//   TRTC_SCAN_URL=https://... node scripts/scan_map_health.mjs
// 離開碼：0 全部在門檻內；1 有超標項；2 掃描本身沒跑起來（零斷言／取不到車）。
import fs from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const URL_ARG = args.find(a => !a.startsWith('--')) || process.env.TRTC_SCAN_URL || 'https://railisland.tw/';
const JSON_OUT = (() => { const i = args.indexOf('--json'); return i >= 0 ? args[i + 1] : null; })();
const GAP_SEC = Number((() => { const i = args.indexOf('--gap'); return i >= 0 ? args[i + 1] : 20; })());

// 門檻。刻意寫成「結構性質」而不是魔術數字：疊車用車號牌的實際半寬，
// 倒退用 0（任何負位移都不該有），車數用相對比例。
// 疊車分兩級。使用者回報的症狀是「好幾台疊在同一個點」，那在物理上不可能；
// 但兩百多公尺是可能的——前車在月台停靠、後車進站前被號誌擋住就是這個量級。
// 把兩者混成一個門檻，不是漏掉真缺陷就是每四輪吵一次假警報。
const OVERLAP_BAD_M = 100;  // 物理上不可能：號誌不會讓兩台車靠這麼近 ⇒ 判缺陷
const OVERLAP_WARN_M = 250; // 罕見但可能（前車停靠、後車進站中）⇒ 只記警告不判缺陷
const AT_STATION_M = 60;    // 離最近車站這麼近就算「停在站上」。
// 同站疊車不能無條件豁免——使用者回報的截圖正是「好幾台疊在站附近」，而突變測試也證實
// 把校正量灌壞時，車全部被拖回站上疊成一堆（13 對），無條件豁免會讓這條判準完全沒有牙。
// 同向同站最多 2 台（一台停靠、一台進站中）；3 台以上物理上不可能。
const AT_STATION_MAX_PER_STOP = 2;   // 同一站同一方向的車數上限
const AT_STATION_MAX_PAIRS = 3;      // 全系統同站疊車對數上限（正常營運實測 0–1 對）
// 刻意不用像素門檻：像素會隨縮放漂移，而這支掃描是把整個路網框在一個畫面裡跑的，
// 密集路段（文湖線彎道）沿線 500 公尺在畫面上本來就只有幾個像素。
const BACKWARD_M = 15;      // 沿線負位移超過這個距離才算倒退（低於此為投影抖動）
const STALL_RATIO = .9;     // 幾乎整條線的車都沒動才算凍結。停站本身就會讓車不動，
                            // 門檻抓一半會把「正常停站」誤判成凍結（實測 8 秒觀測窗下 BL 10/19 全在停站）
const MIN_GAP_SEC = 20;     // 觀測窗要長過停站時間，否則「沒動」分不出是停站還是凍結

let problems = [];
const note = (level, msg, detail) => problems.push({ level, msg, detail });
// 有專屬 console.log 的判準用 note()；沒有的用 noteLoud()——否則收尾只印「1 項超標」，
// 看不出是哪一項，要開 JSON 才知道（Codex 08-17 複審指出的「日誌太安靜」）。
const noteLoud = (level, msg, detail) => {
  console.log(`${level === 'bad' ? '❌' : level === 'warn' ? '⚠️' : 'ℓ'} ${msg}`);
  note(level, msg, detail);
};

const SAMPLE = () => {
  const hits = state._freqHits || [];
  const out = [];
  for (const h of hits) {
    const ln = h.ln; if (!ln) continue;
    const tr = h.tr;
    // 沿線里程：用畫面座標反投影回線形，這是與繪製同一組座標，但比對的是
    // 「同一台車前後兩次」，不涉及與別條管線的真值比較，所以不受同源問題影響。
    let d = null, nearM = null, nearIdx = -1;
    try {
      const ll = map.containerPointToLatLng([h.x, h.y]);
      const pr = projectOntoShape(ln, ll.lat, ll.lng);
      d = pr && pr.d != null ? pr.d : null;
      if (d != null && ln.stations) {
        let best = Infinity, bi = -1;
        ln.stations.forEach((st, i) => {
          if (st && st.d != null) { const gap = Math.abs(st.d - d); if (gap < best) { best = gap; bi = i; } }
        });
        nearM = best * 1000; nearIdx = bi;
      }
    } catch (e) {}
    // 方向。三種畫車路徑各有各的 hit 形狀，取不到就是 0（後面的位移判定會跳過）：
    //   班表車 {ln,tr}／示意車 {ln,k}／名冊車 {ln,vehicleId}（?census=1 與 ?officialroster=1 走這條）
    let dir = 0;
    try {
      if (h.vehicleId) {
        const v = ((state.trtcOfficialRoster || {}).vehicles || [])
          .find(x => String(x.vehicleId) === String(h.vehicleId));
        if (v) dir = v.dir === 2 ? 1 : -1;   // 統一成「里程遞增為 +1」
      } else if (tr && ln.stations) {
        dir = Math.sign(ln.stations[tr[tr.length - 2]].d - ln.stations[tr[0]].d) || 0;
      }
    } catch (e) {}
    out.push({
      // 名冊車的身分是 vehicleId（hit 裡沒有 tr／k，用舊寫法會讓整條線塌成同一個 key，
      // 位移與疊車判定全部失效）
      key: h.vehicleId ? `${ln.id}#${h.vehicleId}` : (tr ? `${ln.id}#tr${(ln._tt || []).indexOf(tr)}` : `${ln.id}#k${h.k}`),
      line: ln.id, abbr: ln.abbr, dir, x: h.x, y: h.y, d, nearM, nearIdx,
      stations: Array.isArray(ln.stations) ? ln.stations.length : null,
      sys: typeof freqSysIdOf === 'function' ? freqSysIdOf(ln) : null,
    });
  }
  const R = state.trtcOfficialRoster || {};
  return { at: Date.now(), simSec: state.simSec, zoom: map.getZoom(), n: out.length, hits: out,
    censusFallbackLines: R.censusFallbackLines || null,
    // 名冊本身的新鮮度：整包被驗證器退掉時車還是會照舊時間線往前跑，位置全綠、
    // 卻是在演一份舊快照（2026-08-17 實測連續 148 秒）。這兩個值是唯一照得到的證據。
    rosterFeed: R.feedMode || null, rosterRecv: R.receivedEpoch || null,
    rosterN: (R.vehicles || []).length,
    // 名冊路徑沒啟用時「沒有名冊」是正常的，不是缺陷 ⇒ 判準要先看這顆旗標。
    rosterEnabled: typeof OFFICIAL_ROSTER_ENABLED !== 'undefined' ? !!OFFICIAL_ROSTER_ENABLED : null,
    rosterHold: state.trtcOfficialRosterHold
      ? { reason: state.trtcOfficialRosterHold.reason, epoch: state.trtcOfficialRosterHold.epoch } : null };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
await ctx.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-appearance', 'light');
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 200)));

console.log(`【掃描】${URL_ARG}`);
await page.goto(URL_ARG, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });

// 切到捷運群組並框到整個大台北，否則 _freqHits 只收視野內的車、分母會無聲縮水
const switched = await page.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
  return g ? g.id : null;
});
await page.waitForTimeout(2500);
await page.evaluate(() => map.fitBounds([[24.90, 121.30], [25.25, 121.75]], { animate: false }));
await page.waitForTimeout(3000);

if (GAP_SEC < MIN_GAP_SEC)
  noteLoud('warn', `觀測窗 ${GAP_SEC}s 短於停站時間，凍結判定不可靠`, { MIN_GAP_SEC });
const s1 = await page.evaluate(SAMPLE);
await page.waitForTimeout(GAP_SEC * 1000);
const s2 = await page.evaluate(SAMPLE);

// 官方逐車清單當車數對照（獨立來源，不經我們的名冊）
let official = null;
try {
  const base = new URL(URL_ARG); base.pathname = '/api/trtc-live'; base.search = '';
  const live = await (await fetch(base.href, { headers: { 'cache-control': 'no-cache' } })).json();
  const feed = live.trains || [];
  // 逐線車數也留下來。2026-08-17 踩到:名冊來源換成官方逐車清單時,那份清單只涵蓋北捷
  // (高運量＋文湖線),環狀線與兩條支線一台都沒有 ⇒ 整份名冊換掉就讓那三條線整條消失,
  // 而總車數只掉 17 台、疊車倒退全綠,四項判準沒有一項會紅。整條線不見必須自己成為一條判準。
  // 分母只算「會動的車」:停在終點站的車依裁示本來就不畫(到終點就收車),把它們算進去
  // 會讓兩條支線(小碧潭、新北投)每次都假紅——那是兩站區間車,多數時間就停在端點,
  // 實測 G_XBT／R_XBT 名冊上各 2 台全是 terminal、在跑的 0 台。
  const bpv = (live.boardPos?.vehicles || []).filter(v => !v.terminal);
  const byLine = {};
  for (const v of bpv) byLine[v.line] = (byLine[v.line] || 0) + 1;
  official = { hw: feed.filter(t => t.sys === 'hw').length, br: feed.filter(t => t.sys === 'br').length,
    roster: (live.boardPos?.vehicles || []).length, running: bpv.length, byLine, age: Math.round(Date.now() / 1000 - (live.boardPos?.sourceRevision || 0)) };
} catch (e) { official = { error: e.message }; }

await browser.close();

// ── 判讀 ──────────────────────────────────────────────────────────────────────
console.log(`  群組 ${switched}｜zoom ${s2.zoom}｜第一次取樣 ${s1.n} 台、${GAP_SEC} 秒後 ${s2.n} 台`);
if (official && !official.error)
  console.log(`  官方逐車：高運量 ${official.hw} 台、文湖線 ${official.br} 台｜我們名冊 ${official.roster} 台｜資料齡 ${official.age}s`);

if (!s1.n || !s2.n) {
  console.log('❌ 畫面上一台車都沒有——掃描沒有意義，先查頁面');
  process.exit(2);
}
if (pageErrors.length) noteLoud('warn', `頁面拋錯 ${pageErrors.length} 次`, pageErrors.slice(0, 3));
// 逐車名冊模式下，某條「本該由逐車清單接管」的主線退回舊綁定器＝那條線的幽靈車風險回來了。
// 環狀線與兩條支線是預期的退回（逐車清單沒有它們），前端已經先排除掉。
if (s2.censusFallbackLines && s2.censusFallbackLines.length)
  noteLoud('warn', `這些線退回舊綁定器：${s2.censusFallbackLines.join('、')}`, s2.censusFallbackLines);

// 0. 名冊本身有沒有在換新。
// 🔴 這條是 2026-08-17 補的：支線車 run=0 讓驗證器整包退掉 payload，車照舊時間線繼續跑
//    ⇒ 疊車、倒退、凍結、車數、整條線不見這五條全綠了 148 秒，因為它們量的都是「畫面上的車
//    動不動」，而演一份舊快照的車動得非常順。名冊的 receivedEpoch 是唯一照得到的證據。
const ROSTER_STALE_SEC = 120;      // 官方 15–60 秒一輪；兩分鐘沒換新＝整包被退或上游真的斷了
{
  const ageSec = s2.rosterRecv ? Math.round((s2.at - s2.rosterRecv * 1000) / 1000) : null;
  const held = s2.rosterHold ? s2.rosterHold.reason : null;
  if (!s2.rosterEnabled)
    noteLoud('info', '官方名冊路徑未啟用（純班表模式），本條不適用', { rosterEnabled: s2.rosterEnabled });
  else if (s2.rosterFeed !== 'official')
    noteLoud('bad', `官方名冊不在 official 模式（${s2.rosterFeed}）＝這輪沒有官方位置可用`,
      { rosterFeed: s2.rosterFeed, rosterN: s2.rosterN, held });
  else if (ageSec == null)
    noteLoud('bad', '官方名冊沒有 receivedEpoch，無法判斷它有沒有換新', { rosterN: s2.rosterN });
  else if (ageSec > ROSTER_STALE_SEC)
    noteLoud('bad', `官方名冊 ${ageSec} 秒沒換新（上限 ${ROSTER_STALE_SEC}s）＝畫面在演舊快照` +
      (held ? `，最近一次被擋原因：${held}` : ''), { ageSec, held, rosterN: s2.rosterN });
  else
    noteLoud('info', `官方名冊 ${s2.rosterN} 台、${ageSec} 秒前換新` + (held ? `（曾被擋：${held}）` : ''),
      { ageSec, held, rosterN: s2.rosterN });
}

// 1. 同向疊車（先分線再分方向；對向交會是正常的）
const groups = new Map();
for (const h of s2.hits) {
  const g = `${h.line}|${h.dir}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(h);
}
const clumps = [], nearPairs = [];
let atStationPairs = 0;
const stationStack = new Map();   // "line|dir@站序" → 同站疊車對數
for (const [g, arr] of groups) {
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const px = Math.hypot(arr[i].x - arr[j].x, arr[i].y - arr[j].y);
    const m = (arr[i].d != null && arr[j].d != null) ? Math.abs(arr[i].d - arr[j].d) * 1000 : null;
    if (m == null || m >= OVERLAP_WARN_M) continue;
    // 兩台都停在同一個車站＝正常（多月台／折返），不算疊車
    const bothAtSameStation = arr[i].nearM != null && arr[j].nearM != null &&
      arr[i].nearM < AT_STATION_M && arr[j].nearM < AT_STATION_M && arr[i].nearIdx === arr[j].nearIdx;
    if (bothAtSameStation) {
      atStationPairs++;
      const sk = `${g}@${arr[i].nearIdx}`;
      stationStack.set(sk, (stationStack.get(sk) || 0) + 1);
      continue;
    }
    const rec = { group: g, px: Math.round(px), m: Math.round(m), a: arr[i].key, b: arr[j].key };
    (m < OVERLAP_BAD_M ? clumps : nearPairs).push(rec);
  }
}
console.log(`${clumps.length ? '❌' : '✅'} 同向疊車（<${OVERLAP_BAD_M}m）：${clumps.length} 對` +
  (clumps.length ? `　例：${clumps.slice(0, 4).map(c => `${c.group} ${c.m}m`).join('、')}`
    : `（靠近 <${OVERLAP_WARN_M}m ${nearPairs.length} 對、同站 ${atStationPairs} 對，皆屬正常範圍）`));
if (clumps.length) note('bad', `同向疊車 ${clumps.length} 對`, clumps.slice(0, 10));
if (nearPairs.length) note('warn', `同向靠近 ${nearPairs.length} 對（<${OVERLAP_WARN_M}m）`, nearPairs.slice(0, 6));
// 同站疊車：1 對＝一停靠一進站，正常；3 台以上擠在同一站、或全系統成堆，就是被拖回站上的形態
const overStop = [...stationStack.entries()].filter(([, pairs]) => pairs + 1 > AT_STATION_MAX_PER_STOP);
const stationBad = overStop.length > 0 || atStationPairs > AT_STATION_MAX_PAIRS;
console.log(`${stationBad ? '❌' : '✅'} 同站堆積：${atStationPairs} 對` +
  (overStop.length ? `　超載車站：${overStop.slice(0, 4).map(([k, n]) => `${k}=${n + 1}台`).join('、')}` : '（每站最多 2 台，正常）'));
if (stationBad) note('bad', `同站堆積 ${atStationPairs} 對`,
  { overStop: overStop.slice(0, 6), atStationPairs });

// 2. 倒退
const before = new Map(s1.hits.map(h => [h.key, h]));
let moved = 0, back = [], stalled = [];
for (const h of s2.hits) {
  const b = before.get(h.key);
  if (!b || h.d == null || b.d == null || !h.dir) continue;
  const delta = (h.d - b.d) * h.dir * 1000; // 公尺，沿行進方向為正
  if (delta < -BACKWARD_M) back.push({ key: h.key, m: Math.round(delta) });
  else if (Math.abs(delta) < 1) stalled.push(h.key);
  else moved++;
}
console.log(`${back.length ? '❌' : '✅'} 倒退：${back.length} 台` +
  (back.length ? `　例：${back.slice(0, 4).map(b => `${b.key} ${b.m}m`).join('、')}` : `（${moved} 台正常前進）`));
if (back.length) note('bad', `倒退 ${back.length} 台`, back.slice(0, 10));

// 3. 停滯（同線多數不動＝疑似凍結，單台不動可能只是停站）
const stallByLine = {};
for (const k of stalled) { const ln = k.split('#')[0]; stallByLine[ln] = (stallByLine[ln] || 0) + 1; }
const totalByLine = {};
for (const h of s2.hits) totalByLine[h.line] = (totalByLine[h.line] || 0) + 1;
// 兩站區間車（小碧潭、新北投）的常態就是兩台各停一端等發車 ⇒ 「整條線都沒動」對它們
// 恆真，不是故障訊號。線＝單一區間時，這個統計量本來就沒有意義（整條線不見那條判準
// 仍然守著它們：真的全消失照樣會紅）。
const shuttleLines = new Set(s2.hits.filter(h => h.stations != null && h.stations <= 2).map(h => h.line));
const frozen = Object.entries(stallByLine).filter(([ln]) => !shuttleLines.has(ln))
  .filter(([ln, n]) => n / (totalByLine[ln] || 1) > STALL_RATIO)
  .map(([ln, n]) => `${ln} ${n}/${totalByLine[ln]}`);
console.log(`${frozen.length ? '❌' : '✅'} 整線凍結：${frozen.length ? frozen.join('、') : '無'}（單台停站 ${stalled.length} 台，正常）`);
if (frozen.length) note('bad', `疑似整線凍結：${frozen.join('、')}`);

// 4. 車數（只對北捷比；官方逐車是獨立來源）
if (official && !official.error) {
  // 🔴 分子分母必須對齊：官方逐車清單是「臺北捷運」的，只涵蓋高運量與文湖線。
  // 環狀線（新北捷運公司）與小碧潭／新北投兩條支線它一台都沒有，把它們算進分子
  // 會讓比值天生虛高（實測量到 112%），上界再怎麼收都是虛的。
  const censusCovered = h => h.sys === 'mrt' && h.line !== 'Y' && !(h.stations != null && h.stations <= 2);
  const drawnTrtc = s2.hits.filter(censusCovered).length;
  const expect = official.hw + official.br;
  const ratio = expect ? drawnTrtc / expect : 0;
  // 下界寬、上界緊，兩邊的理由不對稱：
  //   少畫有一堆正當理由——停在終點站的依裁示本來就不畫（實測每輪約 5 台）、共線段真歧義
  //   解不出的 1–3 台、剛折返還沒配到方向的。實測正式站 83%、census 85%，取 .7 留餘裕；
  //   而「逐線流失」由第五條判準（整條線不見）接手，那條比一個總量比值敏感得多。
  //   多畫則沒有正當理由——分子分母對齊之後，畫面上不該出現官方沒說的車，所以上界收到
  //   1.1（只留給「官方那份比畫面舊幾秒」的抖動）。Codex 複審指出舊的 1.6 讓 59 台幽靈車
  //   仍全綠，那是對的。
  const ok = ratio >= .7 && ratio <= 1.1;
  // 分子的組成也印出來——「兩邊對齊」是這條判準的前提，不可以只寫在註解裡靠信任
  const numByLine = {};
  for (const h of s2.hits) if (censusCovered(h)) numByLine[h.line] = (numByLine[h.line] || 0) + 1;
  const excluded = {};
  for (const h of s2.hits) if (h.sys === 'mrt' && !censusCovered(h)) excluded[h.line] = (excluded[h.line] || 0) + 1;
  console.log(`${ok ? '✅' : '❌'} 車數：${drawnTrtc} 台 vs 官方逐車 ${expect} 台（${(ratio * 100).toFixed(0)}%）` +
    `　［兩邊都只算高運量＋文湖線］`);
  console.log(`     分子 ${JSON.stringify(numByLine)}`);
  console.log(`     兩邊都不算（不在官方逐車清單裡）${JSON.stringify(excluded)}`);
  if (!ok) note('bad', `車數比例異常 ${(ratio * 100).toFixed(0)}%`, { drawnTrtc, expect, numByLine });
}

// 5. 整條線不見（官方那份名冊說這條線有車，畫面卻一台都沒有）
// 真值取 API 的 boardPos.vehicles——那是完全獨立於前端狀態的來源；用前端自己的
// state.trtcOfficialRoster 當分母會與缺陷同源（名冊被換掉時它自己也沒有那條線）。
if (official && !official.error && official.byLine) {
  const drawnLines = new Set(s2.hits.map(h => h.line));
  const emptyLines = Object.entries(official.byLine)
    .filter(([id, n]) => n > 0 && !drawnLines.has(id))
    .map(([id, n]) => `${id}(官方 ${n} 台在跑)`);
  console.log(`${emptyLines.length ? '❌' : '✅'} 整條線不見：${emptyLines.length ? emptyLines.join('、') : `官方 ${Object.keys(official.byLine).length} 條線畫面上都有車`}`);
  if (emptyLines.length) note('bad', `整條線不見：${emptyLines.join('、')}`, official.byLine);
}

const bad = problems.filter(p => p.level === 'bad');
console.log(`\n${bad.length ? `❌ ${bad.length} 項超標` : '✅ 全部在門檻內'}｜警告 ${problems.filter(p => p.level === 'warn').length} 項`);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ url: URL_ARG, at: new Date().toISOString(), official,
    counts: { s1: s1.n, s2: s2.n }, clumps, back, frozen, problems }, null, 1));
  console.log(`  明細 → ${JSON_OUT}`);
}
process.exit(bad.length ? 1 : 0);
