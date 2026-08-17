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
const OVERLAP_M = 250;      // 沿線間距。用實際距離不用像素——像素門檻會隨縮放漂移，
                            // 同一份資料在不同 zoom 下會給出不同結論。250m 是物理下限量級：
                            // 捷運最小班距下兩台車不可能靠這麼近（尖峰 2 分鐘班距≈2km）。
const OVERLAP_PX = 8;       // 另外守一條視覺線：不管實際距離，畫面上疊在一起就是缺陷
const BACKWARD_M = 15;      // 沿線負位移超過這個距離才算倒退（低於此為投影抖動）
const STALL_RATIO = .9;     // 幾乎整條線的車都沒動才算凍結。停站本身就會讓車不動，
                            // 門檻抓一半會把「正常停站」誤判成凍結（實測 8 秒觀測窗下 BL 10/19 全在停站）
const MIN_GAP_SEC = 20;     // 觀測窗要長過停站時間，否則「沒動」分不出是停站還是凍結

let problems = [];
const note = (level, msg, detail) => problems.push({ level, msg, detail });

const SAMPLE = () => {
  const hits = state._freqHits || [];
  const out = [];
  for (const h of hits) {
    const ln = h.ln; if (!ln) continue;
    const tr = h.tr;
    // 沿線里程：用畫面座標反投影回線形，這是與繪製同一組座標，但比對的是
    // 「同一台車前後兩次」，不涉及與別條管線的真值比較，所以不受同源問題影響。
    let d = null;
    try {
      const ll = map.containerPointToLatLng([h.x, h.y]);
      const pr = projectOntoShape(ln, ll.lat, ll.lng);
      d = pr && pr.d != null ? pr.d : null;
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
      line: ln.id, abbr: ln.abbr, dir, x: h.x, y: h.y, d,
      sys: typeof freqSysIdOf === 'function' ? freqSysIdOf(ln) : null,
    });
  }
  return { at: Date.now(), simSec: state.simSec, zoom: map.getZoom(), n: out.length, hits: out };
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
  note('warn', `觀測窗 ${GAP_SEC}s 短於停站時間，凍結判定不可靠`, { MIN_GAP_SEC });
const s1 = await page.evaluate(SAMPLE);
await page.waitForTimeout(GAP_SEC * 1000);
const s2 = await page.evaluate(SAMPLE);

// 官方逐車清單當車數對照（獨立來源，不經我們的名冊）
let official = null;
try {
  const base = new URL(URL_ARG); base.pathname = '/api/trtc-live'; base.search = '';
  const live = await (await fetch(base.href, { headers: { 'cache-control': 'no-cache' } })).json();
  const feed = live.trains || [];
  official = { hw: feed.filter(t => t.sys === 'hw').length, br: feed.filter(t => t.sys === 'br').length,
    roster: (live.boardPos?.vehicles || []).length, age: Math.round(Date.now() / 1000 - (live.boardPos?.sourceRevision || 0)) };
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
if (pageErrors.length) note('warn', `頁面拋錯 ${pageErrors.length} 次`, pageErrors.slice(0, 3));

// 1. 同向疊車（先分線再分方向；對向交會是正常的）
const groups = new Map();
for (const h of s2.hits) {
  const g = `${h.line}|${h.dir}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(h);
}
const clumps = [];
for (const [g, arr] of groups) {
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const px = Math.hypot(arr[i].x - arr[j].x, arr[i].y - arr[j].y);
    const m = (arr[i].d != null && arr[j].d != null) ? Math.abs(arr[i].d - arr[j].d) * 1000 : null;
    const tooClose = (m != null ? m < OVERLAP_M : false) || px < OVERLAP_PX;
    if (tooClose) clumps.push({ group: g, px: Math.round(px), m: m == null ? null : Math.round(m),
      a: arr[i].key, b: arr[j].key });
  }
}
console.log(`${clumps.length ? '❌' : '✅'} 同向疊車：${clumps.length} 對` +
  (clumps.length ? `　例：${clumps.slice(0, 4).map(c => `${c.group} ${c.m}m/${c.px}px`).join('、')}` : ''));
if (clumps.length) note('bad', `同向疊車 ${clumps.length} 對`, clumps.slice(0, 10));

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
const frozen = Object.entries(stallByLine).filter(([ln, n]) => n / (totalByLine[ln] || 1) > STALL_RATIO)
  .map(([ln, n]) => `${ln} ${n}/${totalByLine[ln]}`);
console.log(`${frozen.length ? '❌' : '✅'} 整線凍結：${frozen.length ? frozen.join('、') : '無'}（單台停站 ${stalled.length} 台，正常）`);
if (frozen.length) note('bad', `疑似整線凍結：${frozen.join('、')}`);

// 4. 車數（只對北捷比；官方逐車是獨立來源）
if (official && !official.error) {
  const drawnTrtc = s2.hits.filter(h => h.sys === 'mrt').length;
  const expect = official.hw + official.br;
  const ratio = expect ? drawnTrtc / expect : 0;
  const ok = ratio >= .6 && ratio <= 1.6;
  console.log(`${ok ? '✅' : '❌'} 車數：畫面北捷 ${drawnTrtc} 台 vs 官方逐車 ${expect} 台（${(ratio * 100).toFixed(0)}%）`);
  if (!ok) note('bad', `車數比例異常 ${(ratio * 100).toFixed(0)}%`, { drawnTrtc, expect });
}

const bad = problems.filter(p => p.level === 'bad');
console.log(`\n${bad.length ? `❌ ${bad.length} 項超標` : '✅ 全部在門檻內'}｜警告 ${problems.length - bad.length} 項`);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ url: URL_ARG, at: new Date().toISOString(), official,
    counts: { s1: s1.n, s2: s2.n }, clumps, back, frozen, problems }, null, 1));
  console.log(`  明細 → ${JSON_OUT}`);
}
process.exit(bad.length ? 1 : 0);
