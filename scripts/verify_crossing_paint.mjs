#!/usr/bin/env node
// 「立體交叉處,軌道本身誰畫在上面」的端到端驗證(姊妹檔 verify_crossing_levels.mjs 驗的是列車)。
//
// 背景:軌道原本逐條線依陣列順序描,交叉口誰蓋誰是隨機的。repaintOverpasses 在軌道描完後,
// 把 rail_crossing_levels.json 裡「現實在上」那條線於交叉口附近重描一小段,把上下關係校正回現實。
//
// 判準一律取【疊圖畫布的像素】——不看 repaintOverpasses 有沒有被呼叫、不看它算出什麼,
// 只看交叉口那一小塊比較像哪一條線的顏色。線色從頁面自己的 metroLineColor/trackLineColor 取,
// 不在腳本裡手打色碼(手打過一次,拿錯色號會讓整支靜默投錯票)。
// 每一格都配突變對照:把高低表上下對調,同一格必須跟著翻面——不會翻面的判準沒有牙。
// 另量「拿掉這段修法時有幾格是對的」,證明它不是裝飾。
//
// 用法: node scripts/verify_crossing_paint.mjs [--local <index.html>] [--url <站台>] [--zoom 17]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOCAL = arg('--local', path.join(ROOT, 'index.html'));
const SITE = arg('--url', 'https://railisland.tw');
const ZOOM = Number(arg('--zoom', '0'));
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
  await page.route(u => u.pathname === '/data/rail_crossing_levels.json',
    r => r.fulfill({ status: 200, contentType: 'application/json', body: levels }));
  await page.goto(`${SITE}/?g=${g}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready, null, { timeout: 90000 });
  // 凍結環境並關掉列車:量的是軌道疊層,車牌壓在交叉口上會把取樣窗吃掉。
  // (paintTrain 是所有畫車路徑的唯一入口,見 flushTrainPaint 檔頭)
  await page.evaluate(() => { state.playing = false; state.clockAtNow = false; draw = () => {};
    performance.now = () => 12345; window.paintTrain = () => {}; window.fetch = () => new Promise(() => {}); });
  return page;
};

// 頁面內:把畫面在【真表】【對調表】【無表】三種條件下各重畫一次,每次量兩條線各自的「連續度」。
//
// 判準不是「交叉口那一點是什麼顏色」——那對取樣窗擺哪裡極度敏感(交點常不在表上座標正中央,
// 窗一偏就量到旁邊那截平行線)。改量【沿著各自中心線走一遍,還看得到自己顏色的比例】:
// 在上面的那條從頭到尾都是自己的顏色,在下面的那條會被上面那條的外框咬掉一段。誰在上面 =
// 連續度較高的那條。線色一律向頁面拿,不在腳本裡手打色碼。
//
// 兩個必要的排除,不排會量到假訊號:
//  · 車站圓點的填色與外框色是同一個值(pal 的 stnFill === railCase),站點會長得跟「被咬掉」
//    一模一樣 ⇒ 取樣點只要靠近任一條線的站點就不計。
//  · 站名字、第三條線的顏色兩邊都不像 ⇒ 不計;連續度的分母只有「自己的顏色 + 外框色」,
//    也就是只在「看得見 vs 被蓋掉」之間做比例。
const MEASURE = `([ll, aId, bId, SPAN]) => {
  const w = cv.width / state.dpr, h = cv.height / state.dpr;
  const RENDER = () => { ctx.clearRect(0, 0, w, h);
    if (state.mode === 'sched') { if (state.deco) drawDecoBase(w, h); drawSched(w, h, state.deco ? () => drawDecoTrains(w, h) : null); if (state.deco) drawDecoLabels(); }
    else drawFreq(w, h); };
  const groups = () => [
    { lines: state.lines, color: metroLineColor, vis: ln => !state.visible || state.visible.has(ln.id) },
    { lines: state.trackLines, color: trackLineColor, vis: ln => !state.trackVisible || state.trackVisible.has(ln.id) },
    { lines: state.deco ? state.decoLines : null, color: metroLineColor },
  ];
  const lnOf = id => { for (const g of groups()) for (const ln of (g.lines || [])) {
    if (ln.id !== id || (g.vis && !g.vis(ln))) continue;
    const path = ln.shapePts || ln.pts;
    if (path && path.length >= 2) return { path, stn: ln.pts || [], col: g.color(ln.color) }; } return null; };
  const A = lnOf(aId), B = lnOf(bId);
  if (!A || !B) return { skip: 'missing' };
  if (String(A.col).toLowerCase() === String(B.col).toLowerCase()) return { skip: 'samecolor' };
  const rgb = s => { s = String(s).trim();
    if (s[0] === '#') { if (s.length === 4) s = '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
      return [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)]; }
    const m = s.match(/[\d.]+/g); return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : null; };
  const ca = rgb(A.col), cb = rgb(B.col), cc = rgb(pal().railCase);
  if (!ca || !cb || !cc) return { skip: 'color-parse' };
  const p = map.latLngToContainerPoint(ll);
  const x0 = Math.round(p.x) - SPAN, y0 = Math.round(p.y) - SPAN, N = SPAN * 2 + 1;
  if (x0 < 0 || y0 < 0 || (x0 + N) * state.dpr > cv.width || (y0 + N) * state.dpr > cv.height) return { skip: 'offscreen' };
  const STN_R = 8;   // 站點半徑 2.4 + 環 1.5,留到 8 才夠蓋住反鋸齒與環外緣
  const stns = [...A.stn, ...B.stn].filter(q => Math.abs(q.x - p.x) < SPAN + STN_R && Math.abs(q.y - p.y) < SPAN + STN_R);
  const nearStn = (x, y) => stns.some(q => Math.hypot(x - q.x, y - q.y) < STN_R);
  const walk = L => { const out = [];
    for (let i = 0; i + 1 < L.path.length; i++) {
      const a = L.path[i], b = L.path[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y);
      if (!d) continue;
      for (let t = 0; t < d; t += 0.5) { const x = a.x + (b.x - a.x) * t / d, y = a.y + (b.y - a.y) * t / d;
        if (x < x0 || y < y0 || x >= x0 + N || y >= y0 + N) continue;
        if (nearStn(x, y)) continue;
        out.push([x, y]); } }
    return out; };
  const sa = walk(A), sb = walk(B);
  if (sa.length < 12 || sb.length < 12) return { skip: 'too-short', ptsA: sa.length, ptsB: sb.length };
  const cont = (samples, own) => { const d = ctx.getImageData(x0 * state.dpr, y0 * state.dpr, N * state.dpr, N * state.dpr).data;
    let vis = 0, hid = 0;
    for (const [x, y] of samples) {
      const px = Math.round((x - x0) * state.dpr), py = Math.round((y - y0) * state.dpr);
      const k = (py * N * state.dpr + px) * 4;
      if (d[k + 3] < 200) continue;
      const px3 = [d[k], d[k + 1], d[k + 2]];
      if (Math.hypot(px3[0] - own[0], px3[1] - own[1], px3[2] - own[2]) < 60) vis++;
      else if (Math.hypot(px3[0] - cc[0], px3[1] - cc[1], px3[2] - cc[2]) < 60) hid++; }
    return { r: vis + hid ? vis / (vis + hid) : null, vis, hid }; };
  const both = () => { const ra = cont(sa, ca), rb = cont(sb, cb); return { a: ra.r, b: rb.r, da: ra.vis + ra.hid, db: rb.vis + rb.hid }; };
  const saved = crossLevels.slice();
  const set = arr => { crossLevels.length = 0; crossLevels.push(...arr); };
  set(saved); RENDER(); const real = both();
  set(saved.map(c => ({ ...c, above: c.below, below: c.above }))); RENDER(); const swap = both();
  set([]); RENDER(); const none = both();
  set(saved);
  if (real.a == null || real.b == null || real.da < 10 || real.db < 10) return { skip: 'thin', real };
  return { real, swap, none };
}`;

const SPAN = Number(arg('--span', '26')); // 取樣區塊半徑(CSS px):沿中心線走這麼長,足以涵蓋交點與被咬掉那一段
// 交點剛好被車站圓點壓住時(中山、大安這種「立體交叉就在轉乘站正下方」),兩條線的中心線在
// 排除站點之後都是滿的,量不出誰在上面——那也正是使用者在畫面上看不出來的情況。換個 zoom
// 站點與交點的相對距離會變,多半就分得開了;三個 zoom 都分不開的才記成「不可辨」並逐處列名。
const ZOOMS = ZOOM ? [ZOOM] : [17, 19, 15];

const run = async (g, label, pick) => {
  console.log(`\n【${label}】`);
  const page = await mk(g);
  let n = 0, realOK = 0, swapOK = 0, noneOK = 0, skipped = 0;
  const bad = [], badSwap = [], undet = [], swapUndet = [];
  for (const c of TBL) {
    if (pick && !pick(c)) continue;
    let r = null;
    for (const z of ZOOMS) {
      await page.evaluate(([ll, zz]) => map.setView(ll, zz, { animate: false }), [[c.lat, c.lon], z]);
      await page.waitForTimeout(120);
      const t = await page.evaluate(([S, a]) => eval('(' + S + ')')(a), [MEASURE, [[c.lat, c.lon], c.above.id, c.below.id, SPAN]]);
      if (!t.skip && t.real.a !== t.real.b) { r = t; break; }
      if (!t.skip) r = t;                       // 平手也先留著,三個 zoom 都平手才算不可辨
    }
    if (!r) { skipped++; continue; }
    const name = `${c.above.id}×${c.below.id}@${c.lat.toFixed(4)}`;
    if (r.real.a === r.real.b) { undet.push(name); continue; }
    n++;
    const f2 = v => (v == null ? '—' : v.toFixed(2));
    if (r.real.a > r.real.b) realOK++; else bad.push(`${name} 連續度 ${f2(r.real.a)}:${f2(r.real.b)}`);
    // 對調之後換另一條被咬,咬痕有可能改落在站點圓底下 ⇒ 這一處的突變結果不可辨,不計入分母
    if (r.swap.a === r.swap.b) swapUndet.push(name);
    else if (r.swap.b > r.swap.a) swapOK++;
    else badSwap.push(`${name} 對調後 ${f2(r.swap.a)}:${f2(r.swap.b)}`);
    if (r.none.a > r.none.b) noneOK++;
  }
  await page.close();
  ok(`量得到的交叉口數 > 0(正向對照,否則以下全是空過)`, n > 0,
    `${n} 處可量｜${undet.length} 處交點被站點圓壓住量不出(畫面上也看不出來):${undet.join(' ') || '無'}｜${skipped} 處這個情境沒畫到兩條線`);
  if (!n) return { n: 0, realOK: 0, noneOK: 0 };
  ok(`真表:每一處「現實在上」那條線都畫在上面`, realOK === n, `${realOK}/${n}` + (bad.length ? '｜' + bad.slice(0, 4).join('｜') : ''));
  ok(`突變對照:高低表上下對調後,每一處量得出來的都跟著翻面(判準有牙)`, badSwap.length === 0 && swapOK > 0,
    `${swapOK}/${n - swapUndet.length} 翻面` + (swapUndet.length ? `,${swapUndet.length} 處對調後咬痕落在站點圓下不可辨(${swapUndet.join(' ')})` : '') + (badSwap.length ? '｜沒翻面:' + badSwap.slice(0, 4).join('｜') : ''));
  console.log(`  · 拿掉這段修法時只有 ${noneOK}/${n} 處是對的 → 這段修法在此情境改正了 ${realOK - noneOK} 處`);
  return { n, realOK, noneOK };
};

const MRT = new Set(['mrt']);
const a = await run('all', `drawSched 路徑(全台同框 ?g=all)｜全部 ${TBL.length} 處`);
const b = await run('metro', 'drawFreq 路徑(捷運分頁 ?g=metro)｜北捷 × 北捷 那幾處',
  c => MRT.has(c.above.sys) && MRT.has(c.below.sys));
ok('兩條繪製路徑都各自量到交叉口(drawFreq 與 drawSched 都有守到)', a.n > 0 && b.n > 0, `all ${a.n} 處、metro ${b.n} 處`);
ok('這段修法確實改變了畫面(不是裝飾)', (a.realOK - a.noneOK) + (b.realOK - b.noneOK) > 0,
  `合計改正 ${(a.realOK - a.noneOK) + (b.realOK - b.noneOK)} 處`);

await br.close();
console.log(`\n總計:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
