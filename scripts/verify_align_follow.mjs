// ?aligndot=follow 探針守門人(MapLibre 換引擎,設計書 3.2.2):跟車 30 秒那段也量得到的跨層探針。
// 固定經緯度的 ?aligndot=lat,lng 在跟車相機一走就不在畫面上;follow 模式讓探針跟著可視窗走——快出畫面就重錨到
// 可視窗中心往「螢幕上的列車前進方向」偏 28% 的位置。GL 側兩個 source 輪替、opacity(轉場 0ms)翻面,
// overlay 在翻面後第一次 render 才換目標,所以翻面那一幀兩層畫同一顆。本守門人驗:
//   F0 靜態契約(解析、opacity 轉場 0、軌道層排除 aligndot-*、換錨在畫完之後、不用 visibility/filter 當開關)
//   F2 兩層恰一亮一暗且轉場 0;F3 開機自動完成第一次錨定;F4 距離 ≤2px
//   (F1「Leaflet 下 follow 為 no-op」在 M4-B 拔引擎時退役——沒有第二個引擎可以當控制組了。)
//   F5 沒跟車時錨點在可視窗內、中心上方;F6/F7 縮放與平移把錨點推出畫面後會重錨且仍 ≤2px、在可視窗內
//   F8 跟車時錨點放在列車前進方向且 ≤2px;F9 style 重載後探針重掛且 ≤2px;F10 正向對照(overlay 挪 30px 量到 ≥25px)
// 翻面那一幀的兩層同步在 Playwright 截圖裡量不到(截圖強制合成),那是真機錄影(analyze_device_recording.mjs)的事。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { probeCentroids } from './probe_centroids.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43541;
const fails = [];
const ck = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) fails.push(name); };
const url = q => { const u = new URL(`http://127.0.0.1:${PORT}/index.html`); u.searchParams.set('lang', 'zh-TW'); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); return u.href; };

// ── F0 靜態契約 ─────────────────────────────────────────────────────────
const src = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log(`受測檔:${path.join(ROOT, 'index.html')}`);
ck(src.includes("if (v === 'follow') return { follow: true };"), 'F0a ?aligndot=follow 會被解析成 follow 模式');
ck(src.split("'circle-stroke-opacity-transition': { duration: 0, delay: 0 }").length - 1 === 1, 'F0b 翻面用 circle-stroke-opacity 且轉場 0ms');
ck((src.match(/paint: \{ \.\.\.ALIGN_RING_PAINT \}/g) || []).length === 2 && src.includes('...ALIGN_RING_PAINT, \'circle-stroke-opacity\''), 'F0h 三處探針層都用同一份環 paint(12–18css 環,分析器的已知半徑靠這個)');
ck(src.includes("!layer.id.startsWith('aligndot')") && src.includes("['aligndot', 'aligndot-a', 'aligndot-b'].find(id => raw.getLayer(id))"), 'F0c GL 軌道層插入時排除 aligndot-*、並可拿它當 before 錨點');
ck(src.includes('if (probe) probe.afterDraw();'), 'F0d 換錨與翻面在 overlay 畫完之後');
const ctlStart = src.indexOf('function setupFollowProbe()');
const ctl = ctlStart >= 0 ? src.slice(ctlStart, src.indexOf('  if (ALIGN_DOT) {', ctlStart)) : '';
ck(ctl.length > 200 && !/setLayoutProperty|setFilter|visibility/.test(ctl), 'F0e 控制器不用 visibility／filter 當開關(那些要 worker 重算圖磚、翻面會慢好幾格)', `控制器 ${ctl.length} 字`);
ck(/P\.next = ll/.test(ctl) && /M\.on\('render'/.test(ctl), 'F0f overlay 目標在翻面後第一次 render 才切換(P.next → P.live)');
// M4-B：原本有兩條路徑(MapLibre 工廠、Leaflet 底下掛的 GL 層),Leaflet 拔掉後只剩工廠那一條。
ck((src.match(/if \(ALIGN_DOT && !ALIGN_DOT\.follow\)/g) || []).length === 1, 'F0g 唯一的固定探針路徑(MapLibre 工廠)不在 follow 模式建 aligndot 層');

// ── 本機 server(照 verify_engine_adapter 的做法;/api/* 回空物件) ──────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (u.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(u.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!existsSync(fp)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

async function boot(browser, href) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && (l => l === '' || /index\.html/.test(l))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state?.ready, null, { timeout: 60000 });
  return { ctx, page, errs };
}
const SHOTS = path.join(ROOT, '.superpowers', 'align-follow'); mkdirSync(SHOTS, { recursive: true }); // 每次量測的截圖留檔,紅了可以直接看
const measure = async (page, label = 'shot') => {
  const png = await page.screenshot({ type: 'png' }); writeFileSync(path.join(SHOTS, label + '.png'), png);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cen = probeCentroids(data, info.width, info.height, { magR: 18, magInR: 12, cynR: 5 });
  const dist = cen.mag && cen.cyn ? Math.hypot(cen.mag.x - cen.cyn.x, cen.mag.y - cen.cyn.y) : NaN;
  return { ok: !!cen.mag && !!cen.cyn && cen.mag.sure && cen.cyn.sure, dist: +dist.toFixed(2), mag: cen.mag && { x: +cen.mag.x.toFixed(1), y: +cen.mag.y.toFixed(1), arc: +cen.mag.arc.toFixed(2), arcIn: cen.mag.arcIn == null ? null : +cen.mag.arcIn.toFixed(2), agree: cen.mag.agree == null ? null : +cen.mag.agree.toFixed(2) }, cyn: cen.cyn && { x: +cen.cyn.x.toFixed(1), y: +cen.cyn.y.toFixed(1), arc: +cen.cyn.arc.toFixed(2) } };
};
const probeState = page => page.evaluate(() => window.__alignProbe ? window.__alignProbe.state() : null);
const waitSwaps = (page, n) => page.waitForFunction(n => window.__alignProbe && window.__alignProbe.state().swaps >= n && !window.__alignProbe.state().next, n, { timeout: 12000 });
// 錨點相對可視窗:是否在內(留 70px 邊)、相對中心的向量、當下 bearing
const placement = page => page.evaluate(() => {
  const P = window.__alignProbe.state(); if (!P.live) return null;
  const i = mapInsets(), sz = __M.getSize(), p = __M.toScreen([P.live.lat, P.live.lng]);
  const cx = (i.left + sz.x - i.right) / 2, cy = (i.top + sz.y - i.bottom) / 2;
  return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), dx: +(p.x - cx).toFixed(1), dy: +(p.y - cy).toFixed(1), bearing: __M.getBearing(),
    inside: p.x > i.left + 70 && p.y > i.top + 70 && p.x < sz.x - i.right - 70 && p.y < sz.y - i.bottom - 70 };
});

const browser = await chromium.launch();
try {
  // F1／F1b(Leaflet 控制組:follow 在 Leaflet 是 no-op)已於 M4-B 退役——Leaflet 不存在了,
  // 那一輪 boot 會落回 MapLibre、量到的是受測組自己,判準必然假紅。
  const b = await boot(browser, url({ engine: 'maplibre', aligndot: 'follow' }));
  await b.page.waitForFunction(() => window.__alignProbe && window.__alignProbe.state().live && !window.__alignProbe.state().next, null, { timeout: 30000 });
  await b.page.waitForTimeout(600);
  const layers = await b.page.evaluate(() => ['aligndot-a', 'aligndot-b'].map(id => ({ id, layer: !!__M.raw.getLayer(id), opacity: __M.raw.getPaintProperty(id, 'circle-stroke-opacity'), transition: __M.raw.getPaintProperty(id, 'circle-stroke-opacity-transition'), ring: __M.raw.getPaintProperty(id, 'circle-radius') === 12 && __M.raw.getPaintProperty(id, 'circle-stroke-width') === 6 && __M.raw.getPaintProperty(id, 'circle-opacity') === 0 })));
  ck(layers.every(l => l.layer) && layers.filter(l => l.opacity === 1).length === 1 && layers.filter(l => l.opacity === 0).length === 1, 'F2 兩個輪替層都在、恰一亮一暗', layers);
  ck(layers.every(l => l.transition && l.transition.duration === 0), 'F2b circle-stroke-opacity 轉場 0ms(翻面不淡入淡出)', layers.map(l => l.transition));
  ck(layers.every(l => l.ring), 'F2c 兩層都是 12–18css 的環(中空)', layers.map(l => l.ring));
  const s0 = await probeState(b.page);
  ck(s0 && s0.swaps >= 1 && !s0.pending && !s0.next, 'F3 開機後自動完成第一次錨定(swaps ≥1、無 pending)', s0);
  const m0 = await measure(b.page, 'F4');
  ck(m0.ok && m0.dist <= 2, 'F4 初始錨點:GL 洋紅／overlay 青圓心距離 ≤2px', m0);
  const pl0 = await placement(b.page);
  ck(pl0 && pl0.inside && pl0.dy < -100 && Math.abs(pl0.dx) < 5, 'F5 沒跟車時錨點在可視窗內、位於中心正上方', pl0);

  // F6 縮到台北:舊錨點遠在畫面外 → 重錨
  const s1 = (await probeState(b.page)).swaps;
  await b.page.evaluate(() => __M.setView([25.05, 121.5], 13, { animate: false }));
  await waitSwaps(b.page, s1 + 1); await b.page.waitForTimeout(500);
  const m1 = await measure(b.page, 'F6'), pl1 = await placement(b.page);
  ck(m1.ok && m1.dist <= 2, 'F6 縮到台北 z13 後重錨,距離 ≤2px', m1);
  ck(pl1 && pl1.inside, 'F6b 重錨點在可視窗內', pl1);
  // F7 平移到錨點剛好出畫面(用當下投影算新中心,不依賴 zoom)
  const s2 = (await probeState(b.page)).swaps;
  await b.page.evaluate(() => { const L = __alignProbe.state().live, p = __M.toScreen([L.lat, L.lng]), sz = __M.getSize(); const c = __M.fromScreen({ x: p.x, y: p.y + sz.y }); __M.setView([c.lat, c.lng], __M.getZoom(), { animate: false }); });
  await waitSwaps(b.page, s2 + 1); await b.page.waitForTimeout(500);
  const m2 = await measure(b.page, 'F7'), pl2 = await placement(b.page);
  ck(m2.ok && m2.dist <= 2, 'F7 平移到錨點出畫面後重錨,距離 ≤2px', m2);
  ck(pl2 && pl2.inside, 'F7b 重錨點在可視窗內', pl2);

  // F8 跟車:錨點要放在列車前進方向(heading-up 下＝螢幕上方)
  const fol = await b.page.evaluate(() => {
    const cand = (state.trains || []).map(tr => { const a = trainPos(tr, state.simSec - 5), b = trainPos(tr, state.simSec + 5); return { tr, a, b, heading: a && b ? initialBearing(a, b) : null }; })
      .find(x => Number.isFinite(x.heading) && Math.abs(x.heading) > 15);
    if (!cand) return null;
    setFollow(cand.tr, false, true);
    for (let i = 0; i < 28; i++) updateFollowCamera();
    return { heading: cand.heading, bearing: __M.getBearing(), train: cand.tr.train, offscreen: __alignProbe.state().offscreen };
  });
  ck(!!fol, 'F8 找得到行駛中的 sched 樣本並進入跟車', fol);
  if (fol) {
    // 錨點沒出畫面(整台灣同框)時 afterDraw 不會自己換錨;要驗的是「跟車時 pick() 放在前進方向」,直接要求重錨一次
    await b.page.waitForTimeout(900);
    const swaps0 = await b.page.evaluate(() => { const s = __alignProbe.state().swaps; if (!__alignProbe.request(__alignProbe.pick())) throw new Error('request 被拒:' + JSON.stringify(__alignProbe.state())); return s; });
    await waitSwaps(b.page, swaps0 + 1); await b.page.waitForTimeout(500);
    const pl3 = await placement(b.page);
    const ang = (fol.heading - pl3.bearing - 90) * Math.PI / 180; // pick() 的螢幕角
    const len = Math.hypot(pl3.dx, pl3.dy) || 1, dot = (pl3.dx * Math.cos(ang) + pl3.dy * Math.sin(ang)) / len;
    ck(pl3.inside && dot > 0.9, 'F8b 跟車時錨點放在列車前進方向、在可視窗內', { ...pl3, heading: fol.heading, dot: +dot.toFixed(3) });
    const m3 = await measure(b.page, 'F8');
    ck(m3.ok && m3.dist <= 2, 'F8c 跟車重錨後距離 ≤2px', m3);
    await b.page.evaluate(() => clearFollow());
    await b.page.waitForTimeout(400);
  }

  // F9 style 重載:setStyle({diff:false}) 清掉自訂層 → ensure() 冪等重掛、探針回來
  await b.page.evaluate(async () => { const loaded = new Promise(r => __M.raw.once('style.load', r)); __M.setStyleKind('dark'); await loaded; });
  await b.page.waitForFunction(() => ['aligndot-a', 'aligndot-b'].every(id => __M.raw.getLayer(id)) && __alignProbe.state().live && !__alignProbe.state().next, null, { timeout: 15000 });
  await b.page.waitForTimeout(1000);
  const m4 = await measure(b.page, 'F9');
  ck(m4.ok && m4.dist <= 2, 'F9 style 重載(dark)後探針重掛且距離 ≤2px', m4);

  // F10 正向對照:overlay 投影挪 30px,量得到 ≥25px(證明 F4–F9 的 ≤2px 不是恆真)
  await b.page.evaluate(() => { const M = window.__M, o = M.toScreen; M.toScreen = ll => { const p = o(ll); return { x: p.x + 30, y: p.y }; }; if (window.__state.ready) draw(); });
  await b.page.waitForTimeout(300);
  const m5 = await measure(b.page, 'F10');
  ck(m5.ok && m5.dist >= 25, 'F10 正向對照:overlay 投影挪 30px 後量到 ≥25px', m5);
  ck(b.errs.length === 0, 'F11 MapLibre 路徑零 pageerror／console.error', b.errs);
  await b.ctx.close();
} finally {
  await browser.close(); server.close();
}
console.log(fails.length ? `\n${fails.length} 項未過:\n  ${fails.join('\n  ')}` : '\n全部通過');
process.exit(fails.length ? 1 : 0);
