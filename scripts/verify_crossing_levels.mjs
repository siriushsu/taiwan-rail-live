#!/usr/bin/env node
// 「立體交叉處誰蓋誰」的端到端驗證。
//
// 判準一律取【螢幕像素】——不看 paintTrain/flushTrainPaint 的佇列,也不看排序結果,
// 只看畫布上疊在一起的那一小塊比較像哪一條線的顏色。判準與實作不同源,實作換寫法也照驗。
//
// 每一條都配控制組或突變對照:
//   ·「真表:上面那條真的在上面」 配「把表的上下對調,每一格都要跟著翻面」(判準有牙)
//   ·「交叉口以外零副作用」      配「連畫兩次結果相同」(畫面可重現,比較才有意義)
//                              配「畫面上真的有車」(不是空過)
//   · 另量出「沒有這張表時會疊錯幾格」,證明它不是裝飾
//
// 用法: node scripts/verify_crossing_levels.mjs [--local <index.html>] [--url <站台>]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOCAL = arg('--local', path.join(ROOT, 'index.html'));
const SITE = arg('--url', 'https://railisland.tw');
const html = fs.readFileSync(LOCAL, 'utf8');
const levels = fs.readFileSync(path.join(ROOT, 'data/rail_crossing_levels.json'), 'utf8');
const TBL = JSON.parse(levels).crossings;
const host = new URL(SITE).hostname;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${n}${d ? '  ' + d : ''}`); };
console.log(`受測檔:${LOCAL}\n站台:${SITE}(API 與資料仍走這裡)\n高低表:${TBL.length} 處交叉`);

const br = await chromium.launch();
const mk = async (g) => {
  const page = await br.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch {} });
  await page.route(u => u.hostname === host && (u.pathname === '/' || u.pathname === '/index.html'),
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  // 高低表也餵本機這一份:不然還沒部署時會拿到 404,整支等於在驗舊路徑
  await page.route(u => u.pathname === '/data/rail_crossing_levels.json',
    r => r.fulfill({ status: 200, contentType: 'application/json', body: levels }));
  await page.goto(`${SITE}/?g=${g}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready, null, { timeout: 90000 });
  // 凍結環境:停時鐘、停自動重畫、釘死 performance.now、掐掉後續 fetch。
  // (停站脈動會讀時鐘、即時誤點若在比較途中落地,兩張圖就不是同一個世界)
  await page.evaluate(() => { state.playing = false; state.clockAtNow = false; draw = () => {};
    performance.now = () => 12345; window.fetch = () => new Promise(() => {}); });
  return page;
};
const keyFor = s => ['mrt', 'tymc', 'tmrt', 'krtc', 'sanying'].includes(s.sys) ? 'M:' + s.id : 'S:' + s.sys;

// 頁面內:掃一整天,每一格「兩條線各一台車、牌疊在一起」都在【真表】【對調表】【無表】下各量一次像素
const SCAN = `([ll, aKey, bKey, step]) => {
  const w = cv.width / state.dpr, h = cv.height / state.dpr;
  const RENDER = t => { state.simSec = t;
    state._trainHits = []; state._freqHits = []; state._crossHits = []; state._sugarHits = []; labelBoxes = [];
    ctx.clearRect(0, 0, w, h);
    if (state.mode === 'sched') { if (state.deco) drawDecoBase(w, h); drawSched(w, h, state.deco ? () => drawDecoTrains(w, h) : null); if (state.deco) drawDecoLabels(); }
    else drawFreq(w, h); };
  const keyOf = o => o.ln ? 'M:' + o.ln.id : (o.tr ? 'S:' + o.tr.sys : '?');
  const hex = s => [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)];
  const vote = (A, B) => { const a = hex(A.c), b = hex(B.c);
    const mx = Math.round((A.x+B.x)/2), my = Math.round((A.y+B.y)/2);
    const d = ctx.getImageData((mx-4)*state.dpr, (my-4)*state.dpr, 9*state.dpr, 9*state.dpr).data;
    let na = 0, nb = 0;
    for (let k = 0; k < d.length; k += 4) {
      const da = Math.hypot(d[k]-a[0], d[k+1]-a[1], d[k+2]-a[2]);
      const db = Math.hypot(d[k]-b[0], d[k+1]-b[1], d[k+2]-b[2]);
      if (Math.min(da, db) > 90) continue;   // 字與描邊那些像素兩邊都不像,不計票
      da < db ? na++ : nb++; }
    return na === nb ? null : (na > nb ? 'A' : 'B'); };
  const cen = window.__M.toScreen(ll);
  // 搜尋半徑由 CROSS_NEAR_M 推導(留 10% 邊際),不手打像素:掃到的每一格都保證在機制射程內
  const _a = window.__M.toScreen(ll), _b = window.__M.toScreen([ll[0] + 0.001, ll[1]]);
  const rPx = CROSS_NEAR_M * (Math.abs(_b.y - _a.y) / 111.32) * 0.9;
  const saved = crossLevels.slice();
  const setReal = () => { crossLevels.length = 0; crossLevels.push(...saved); };
  const setSwap = () => { crossLevels.length = 0; crossLevels.push(...saved.map(c => ({ ...c, above: c.below, below: c.above }))); };
  let n = 0, realA = 0, swapB = 0, noneA = 0, flipped = 0, dirty = 0;
  for (let t = 6*3600; t < 23*3600; t += step) {
    setReal(); RENDER(t);
    const pts = [...state._freqHits, ...state._trainHits]
      .map(o => ({ x:o.x, y:o.y, k:keyOf(o), c: o.ln ? o.ln.color : (o.tr && o.tr.color) }))
      .filter(p => Math.hypot(p.x-cen.x, p.y-cen.y) < rPx);
    let A = null, B = null;
    for (const x of pts.filter(p => p.k === aKey)) for (const y of pts.filter(p => p.k === bKey))
      if (Math.abs(x.x-y.x) <= 20 && Math.abs(x.y-y.y) <= 9) { A = x; B = y; break; }
    if (!A) continue;
    const mx = (A.x+B.x)/2, my = (A.y+B.y)/2;
    // 取樣窗混進第三台車就跳過:那格的票數不再代表這兩台的先後
    if ([...state._freqHits, ...state._trainHits].some(o => { const k = keyOf(o);
      if ((k === aKey && o.x === A.x && o.y === A.y) || (k === bKey && o.x === B.x && o.y === B.y)) return false;
      return Math.abs(o.x - mx) < 22 && Math.abs(o.y - my) < 12; })) { dirty++; continue; }
    // 顏色取「這一台車自己的」:台鐵逐車種不同色,拿同系統第一台的顏色會投錯票
    if (!A.c || !B.c || A.c.toLowerCase() === B.c.toLowerCase()) continue;
    n++;
    const vR = vote(A, B); if (vR === 'A') realA++;
    setSwap(); RENDER(t); const vS = vote(A, B); if (vS === 'B') swapB++;
    crossLevels.length = 0; RENDER(t); const vN = vote(A, B); if (vN === 'A') noneA++;
    if (vR !== vN) flipped++;
  }
  setReal();
  return { n, realA, swapB, noneA, flipped, dirty, levels: crossLevels.length };
}`;

// 情境挑「兩條線各自都有車、且真的會在交叉口相遇」的:前兩個走兩條不同的繪製路徑
const CASES = [
  { g: 'metro', i: 4,  t: 'drawFreq 路徑(捷運分頁)｜忠孝復興 文湖線(上) × 松山新店線(下)' },
  { g: 'all',   i: 4,  t: 'drawSched 路徑(全台同框)｜忠孝復興 文湖線(上) × 松山新店線(下)' },
  { g: 'all',   i: 21, s: 10, t: 'drawSched 路徑(全台同框)｜西門一帶 板南線(上) × 台鐵縱貫線(下)' },
  { g: 'all',   i: 19, s: 10, t: 'drawSched 路徑(全台同框)｜龍山寺一帶 台鐵縱貫線(上) × 松山新店線(下)' },
];
let anyFlip = 0;
for (const cs of CASES) {
  const c = TBL[cs.i];
  console.log(`\n【${cs.t}】  表:${c.above.id} 蓋 ${c.below.id}`);
  const page = await mk(cs.g);
  await page.evaluate(([ll]) => window.__map.setView(ll, 16, { animate: false }), [[c.lat, c.lon]]);
  await page.waitForTimeout(900);
  const r = await page.evaluate(([S, a]) => eval('(' + S + ')')(a),
    [SCAN, [[c.lat, c.lon], keyFor(c.above), keyFor(c.below), cs.s || 30]]);
  ok('高低表有載進頁面(否則以下全在驗舊路徑)', r.levels === TBL.length, `${r.levels} 處`);
  ok('一天裡真的掃得到這兩條線疊在一起(正向對照)', r.n > 0,
    `${r.n} 格${r.dirty ? `(另有 ${r.dirty} 格混到第三台車,不計)` : ''}`);
  if (!r.n) { await page.close(); continue; }
  ok(`真表:「${c.above.id}」每一格都在上面`, r.realA === r.n, `${r.realA}/${r.n}`);
  ok('突變對照:把表的上下對調,每一格都跟著翻面(判準有牙)', r.swapB === r.n, `${r.swapB}/${r.n}`);
  console.log(`  · 沒有表時只有 ${r.noneA}/${r.n} 格是對的 → 這張表在這處改正了 ${r.flipped} 格`);
  anyFlip += r.flipped;
  await page.close();
}
ok('至少有一處交叉口,這張表確實改變了畫面(不是裝飾)', anyFlip > 0, `合計改正 ${anyFlip} 格`);

// ── 交叉口以外零副作用 ────────────────────────────────────────────
console.log('\n【零副作用】沒有交叉口的畫面,有表 vs 無表');
{
  const HASH = `(t) => { const w = cv.width/state.dpr, h = cv.height/state.dpr;
    state.simSec = t; state._trainHits = []; state._freqHits = []; state._crossHits = []; state._sugarHits = []; labelBoxes = [];
    ctx.clearRect(0, 0, w, h);
    if (state.mode === 'sched') { if (state.deco) drawDecoBase(w, h); drawSched(w, h, state.deco ? () => drawDecoTrains(w, h) : null); if (state.deco) drawDecoLabels(); }
    else drawFreq(w, h);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let x = 5381; for (let i = 0; i < d.length; i += 7) x = ((x*33) ^ d[i]) >>> 0;
    return { hash: x, trains: state._trainHits.length + state._freqHits.length }; }`;
  for (const sp of [
    { g: 'all',   n: '新竹一帶 台鐵＋高鐵', ll: [24.8010, 120.9710], z: 12 },
    { g: 'metro', n: '淡水一帶 北捷紅線',   ll: [25.1620, 121.4460], z: 13 },
  ]) {
    const page = await mk(sp.g);
    await page.evaluate(([ll, z]) => window.__map.setView(ll, z, { animate: false }), [sp.ll, sp.z]);
    await page.waitForTimeout(900);
    const run = () => page.evaluate(([H]) => eval('(' + H + ')')(8*3600 + 1234), [HASH]);
    const a1 = await run(), a2 = await run();
    console.log(`  · ${sp.n}(?g=${sp.g})`);
    ok('  控制組:連畫兩次結果相同(這個畫面可重現,下面的比較才有意義)', a1.hash === a2.hash);
    ok('  正向對照:畫面上真的有車', a1.trains > 0, `${a1.trains} 台`);
    const near = await page.evaluate(() => { const w = cv.width/state.dpr, h = cv.height/state.dpr;
      return crossLevels.filter(c => { const p = window.__M.toScreen([c.lat, c.lon]);
        return p.x > -200 && p.y > -200 && p.x < w+200 && p.y < h+200; }).length; });
    ok('  這個視野裡確實沒有交叉口', near === 0, `${near} 處`);
    await page.evaluate(() => { crossLevels.length = 0; });
    const b = await run();
    ok('  有表/無表畫出來一模一樣(交叉口以外零副作用)', a1.hash === b.hash);
    await page.close();
  }
}
await br.close();
console.log(`\n總計:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
