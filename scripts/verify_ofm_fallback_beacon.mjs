#!/usr/bin/env node
// L2 退場埋點(index.html 的 ofmFailBeacon → Worker 的 /api/basemap-fallback → USAGE 資料點)的驗收。
//
// 背景:App 判定 OpenFreeMap 上場後 8 秒內載不出來就當場退回 Stadia raster(計費),網站則跳提示。
// 2026-09-03 之前這件事只在使用者的 console 留一行 warn,全體使用者裡有多少人正在燒 Stadia 一個數字
// 都沒有。這批在 fail 那一刻打一發 beacon,Worker 寫一筆 railisland_usage(blob1='ofmfail')。
//
// 四段:
//  G  靜態自檢:機制真的在這棵樹的 index.html / worker.js 裡(驗到舊檔會長得跟全綠一模一樣)。
//  W  Worker 離線:直接 import worker.js,用假的 USAGE/限流器呼叫 basemapFallback 與 default.fetch。
//     斷言資料點的形狀、認不得的值一律降級成 'na'、限流不寫、綁定缺席與寫入拋錯都不影響回應、
//     TRAFFIC 埋點記到的端點名是 'basemap-fallback' 而不是 'other'(API_ENDPOINTS 漏加的症狀)。
//  B  瀏覽器(Playwright):真的把 index.html 跑起來。OFM 擋掉 ⇒ 8 秒後 fail ⇒ 必須**恰好一發**;
//     OFM 正常(本機 stub)⇒ **零發**。🔴 負向對照是本檔的重點:一個「出事就打一發」的埋點,最貴的
//     假綠是它其實每次開機都打——那量到的不是退場率,是開機數。
//  M  突變:把 fail 裡的 ofmFailBeacon 拔掉再跑 B1,「恰好一發」必須轉紅——證明判準有牙。
//
// 網路:一律不打真端點。Stadia/Esri 回假 PNG;OFM 依情境擋掉或用本機 stub(TileJSON＋空圖磚＋空 sprite);
//      /api/* 全攔(basemap-fallback 計數並回 200,basemap-token 給假 token,其餘 404 讓前端走本機資料)。
//      Leaflet 來自 cdnjs;離線環境可設 LEAFLET_DIR=<含 leaflet.js／leaflet.css 的目錄> 讓腳本就地供應。
//      Playwright 找不到自己的 Chromium 時,可設 PW_CHROMIUM_PATH 指定執行檔。
//
// 用法:node scripts/verify_ofm_fallback_beacon.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const R = [];
const ok = (id, pass, detail) => { R.push({ id, pass }); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };
const note = (id, detail) => console.log(`ℹ️  ${id} — ${detail}`);

// ── G:靜態自檢 ────────────────────────────────────────────────────────────────
const src = await readFile(join(ROOT, 'index.html'), 'utf8');
const wsrc = await readFile(join(ROOT, 'worker.js'), 'utf8');
const FAIL_LINE = '  const fail = why => { stop(); ofmFailBeacon(why); if (APP_CFG.tiles) ofmFallToRaster(why); else ofmNoticeWeb(why); };';
for (const [file, text, frag, why] of [
  ['index.html', src, 'function ofmFailBeacon(why)', 'beacon 函式'],
  ['index.html', src, FAIL_LINE, 'fail 先打 beacon 再分支(App 退場／網站提示)'],
  ['index.html', src, "apiUrl('api/basemap-fallback?why='", 'beacon 打的是 basemap-fallback'],
  ['index.html', src, 'keepalive: true', 'beacon 帶 keepalive'],
  ['worker.js', wsrc, 'async function basemapFallback(request, env)', 'Worker 處理函式'],
  ['worker.js', wsrc, "else if (url.pathname === '/api/basemap-fallback') res = await basemapFallback(request, env);", 'Worker 路由'],
  ['worker.js', wsrc, "'basemap-fallback',", 'API_ENDPOINTS 白名單(否則 TRAFFIC 記成 other)'],
  ['worker.js', wsrc, 'export const _basemap = { basemapSrc, basemapFallback };', '離線測試用導出'],
]) {
  if (!text.includes(frag)) { console.error(`❌ [G0] ${file} 沒有「${why}」(${frag})——驗錯目標或改動沒落地`); process.exit(1); }
}
console.log('[G0] 前端與 Worker 兩半的機制都在這棵樹裡');

// ── W:Worker 離線 ─────────────────────────────────────────────────────────────
const worker = await import(pathToFileURL(join(ROOT, 'worker.js')).href);
const { basemapFallback } = worker._basemap;
const APP_ORIGIN = 'capacitor://localhost';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const UA_D = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
function mkEnv({ limited = false, noUsage = false, throwOnWrite = false } = {}) {
  const writes = [], traffic = [];
  const env = {
    BASEMAP_LIMITER: { limit: async () => ({ success: !limited }) },
    TRAFFIC: { writeDataPoint: p => traffic.push(p) },
  };
  if (!noUsage) env.USAGE = { writeDataPoint: p => { if (throwOnWrite) throw new Error('boom'); writes.push(p); } };
  return { env, writes, traffic };
}
const mkReq = (qs, { origin, ua = UA_D, method = 'GET' } = {}) =>
  new Request('https://railisland.tw/api/basemap-fallback' + qs, { method, headers: { 'user-agent': ua, ...(origin ? { Origin: origin } : {}) } });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
{
  const { env, writes } = mkEnv();
  const r = await basemapFallback(mkReq('?why=slow&z=11', { origin: APP_ORIGIN, ua: UA_M }), env);
  const body = await r.json();
  ok('W1 App 手機 why=slow z=11 → 恰好一筆 ofmfail 資料點', r.status === 200 && body.ok === true && writes.length === 1
    && same(writes[0], { blobs: ['ofmfail', 'm', 'app', 'slow'], doubles: [11], indexes: ['ofmfail'] }),
    `status=${r.status} writes=${JSON.stringify(writes)}`);
  ok('W1b 回應 no-store(被快取的 beacon 永遠到不了 Worker,計數就停了)', r.headers.get('cache-control') === 'no-store', `cache-control=${r.headers.get('cache-control')}`);
}
{
  const { env, writes } = mkEnv();
  await basemapFallback(mkReq('?why=bogus&z=abc'), env);
  ok('W2 認不得的 why／z、無 Origin、桌機 UA → na／0／web／d(壞值降級不拋)', writes.length === 1
    && same(writes[0], { blobs: ['ofmfail', 'd', 'web', 'na'], doubles: [0], indexes: ['ofmfail'] }), JSON.stringify(writes));
}
{
  const { env, writes } = mkEnv();
  await basemapFallback(mkReq('?why=error', { origin: 'https://localhost', ua: UA_M }), env);
  ok('W3 why=error、沒帶 z、Android 殼 Origin → error／0／app', writes.length === 1
    && same(writes[0], { blobs: ['ofmfail', 'm', 'app', 'error'], doubles: [0], indexes: ['ofmfail'] }), JSON.stringify(writes));
}
{
  const { env, writes } = mkEnv({ limited: true });
  const r = await basemapFallback(mkReq('?why=slow&z=9', { origin: APP_ORIGIN }), env);
  ok('W4 被限流 → 429 且不寫', r.status === 429 && writes.length === 0, `status=${r.status} writes=${writes.length}`);
}
{
  const { env } = mkEnv({ noUsage: true });
  const r = await basemapFallback(mkReq('?why=slow&z=9'), env);
  ok('W5 USAGE 綁定缺席(本機 dev)→ 照樣 200', r.status === 200, `status=${r.status}`);
}
{
  const { env, writes } = mkEnv({ throwOnWrite: true });
  const r = await basemapFallback(mkReq('?why=slow&z=9'), env);
  ok('W6 writeDataPoint 拋錯 → 整段吞掉、仍 200(觀測不可影響服務)', r.status === 200 && writes.length === 0, `status=${r.status}`);
}
{
  // 走完整的 fetch 入口:方法閘門、TRAFFIC 端點名、App CORS
  const ctx = { waitUntil() {} };
  const { env, writes, traffic } = mkEnv();
  const r = await worker.default.fetch(mkReq('?why=slow&z=12', { origin: APP_ORIGIN, ua: UA_M }), env, ctx);
  ok('W7 完整 fetch 入口:200 ＋ App CORS ＋ USAGE 一筆', r.status === 200 && r.headers.get('access-control-allow-origin') === APP_ORIGIN && writes.length === 1,
    `status=${r.status} acao=${r.headers.get('access-control-allow-origin')} writes=${writes.length}`);
  ok('W7b TRAFFIC 記到的端點名是 basemap-fallback(不是 other)', traffic.length === 1 && traffic[0].blobs[0] === 'app' && traffic[0].blobs[1] === 'basemap-fallback',
    JSON.stringify(traffic));
  const { env: env2, writes: w2 } = mkEnv();
  const r2 = await worker.default.fetch(mkReq('?why=slow', { method: 'POST' }), env2, ctx);
  ok('W8 POST → 405(唯讀端點的方法閘門)且不寫', r2.status === 405 && w2.length === 0, `status=${r2.status} writes=${w2.length}`);
}

// ── B:瀏覽器 ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.OFMBEACON_PORT || 43993);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const LEAFLET_DIR = process.env.LEAFLET_DIR || '';
let servedHtml = null; // null＝供 G0 讀進來的那份(已證明是這棵樹的);突變時換成改過的字串
// 離線環境:cdnjs 的 Leaflet 兩個 tag 帶 SRI(integrity),而 npm 那份的位元組跟 cdnjs 的不同 ⇒ 用本機替身
// 供應時瀏覽器會因 SRI 拒載(症狀:L 未定義、pageerror "reading 'extend'")。SRI 不是這支要驗的東西,
// 所以**只在**設了 LEAFLET_DIR 時把那兩個 tag 的 integrity 拿掉;沒設就原樣供應(有網路的機器走真 cdnjs,SRI 照驗)。
const LEAFLET_SRI_RE = /(<(?:link|script)[^>]*cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/[^>]*?)\s+integrity="[^"]*"/g;
const forBrowser = html => LEAFLET_DIR ? html.replace(LEAFLET_SRI_RE, '$1') : html;
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    if (p === '/' || p === '/index.html') { res.setHeader('content-type', MIME['.html']); return res.end(forBrowser(servedHtml != null ? servedHtml : src)); }
    const body = await readFile(file);
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

async function launch() {
  try { return await chromium.launch(); }
  catch (e) {
    if (process.env.PW_CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
    throw e;
  }
}
const browser = await launch();
const TILEJSON = JSON.stringify({ tilejson: '2.2.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 });

// ofm: 'block'=全擋(模擬 OFM 掛掉) | 'stub'=本機假 OFM(TileJSON＋204 空圖磚＋空 sprite,讓 MapLibre 的 load 真的發)
async function run({ appShell, ofm, waitMs = 11000 }) {
  const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [], beacons = [];
  let stadiaHits = 0, ofmHits = 0;
  if (LEAFLET_DIR) await ctx.route('**://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/**', async r => {
    const css = r.request().url().endsWith('.css');
    r.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: await readFile(join(LEAFLET_DIR, css ? 'leaflet.css' : 'leaflet.js')) });
  });
  await ctx.route('**://tiles.openfreemap.org/**', r => {
    ofmHits++;
    if (ofm === 'block') return r.abort('failed');
    const u = r.request().url();
    if (/\/planet\/?(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: TILEJSON });
    if (u.endsWith('.pbf')) return r.fulfill({ status: 204, body: '' });
    if (/\/sprites\/.*\.json/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\/sprites\/.*\.png/.test(u)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return r.fulfill({ status: 404, body: 'nf' });
  });
  await ctx.route('**://tiles.stadiamaps.com/**', r => { stadiaHits++; r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await ctx.route('**://ibasemaps-api.arcgis.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('**/api/**', r => {
    const u = r.request().url();
    if (u.includes('/api/basemap-fallback')) { beacons.push({ url: u, method: r.request().method() }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.includes('/api/basemap-token')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"esri":"TESTTOKEN"}' });
    // 其餘回 404 而不是 200 {}:前端資料源是「apiUrl 優先、data/*.json 退路」,404 才會走本機那份真資料
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"stubbed"}' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  // App 分支:同一份 index.html,靠注入 window.RAIL_APP_CONFIG 走 APP_CFG.tiles 那條路(正式由 prepare-web.mjs 注入)
  if (appShell) await page.addInitScript(() => {
    window.RAIL_APP_CONFIG = { streetSrc: 'ofm', tiles: {
      light: { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png', maxZoom: 20, attribution: 'test' },
      dark: { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png', maxZoom: 20, attribution: 'test' },
    } };
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
  const booted = await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light, null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(waitMs); // OFM_HEALTH_MS = 8000,留足餘裕
  const got = await page.evaluate(() => {
    const bl = (typeof baseLayers !== 'undefined' && baseLayers) ? baseLayers : {};
    const l = bl.light, onMap = [bl.light, bl.dark].find(x => x && x._glMap);
    const gl = onMap && onMap._glMap;
    return {
      layerKind: !l ? 'none' : (typeof l._url === 'string' ? (l._url.includes('stadiamaps') ? 'stadia' : 'raster-other') : 'ofm'),
      glLoaded: !!(gl && gl.isStyleLoaded && gl.isStyleLoaded()),
      armed: typeof ofmRasterFallback !== 'undefined' && ofmRasterFallback !== null,
    };
  }).catch(e => ({ layerKind: 'evalfail:' + String(e).slice(0, 80), glLoaded: false, armed: false }));
  await ctx.close();
  return { ...got, booted, errs, beacons, stadiaHits, ofmHits };
}
const detail = x => `layer=${x.layerKind} beacons=${x.beacons.length} boot=${x.booted} glLoaded=${x.glLoaded} stadiaHits=${x.stadiaHits} ofmHits=${x.ofmHits}${x.errs.length ? ' pageerror=' + x.errs[0] : ''}`;

const a = await run({ appShell: true, ofm: 'block' });
ok('B1 App 殼、OFM 擋掉 → 退場到 Stadia,且恰好一發 beacon', a.layerKind === 'stadia' && a.beacons.length === 1, detail(a));
const u1 = a.beacons[0] ? new URL(a.beacons[0].url) : null;
const why1 = u1 && u1.searchParams.get('why');
ok('B1b beacon 是 GET、why ∈ {slow,error}、z 是整數', !!u1 && a.beacons[0].method === 'GET' && (why1 === 'slow' || why1 === 'error') && /^-?\d+$/.test(u1.searchParams.get('z') || ''),
  u1 ? u1.pathname + u1.search : 'no beacon');
if (u1) note('B1 量到的邊界', `OFM 全擋時判定原因=${why1}(TileJSON／sprite 各失敗一次,錯誤數不到 4 ⇒ 預期走 8 秒逾時的 slow)`);

const w = await run({ appShell: false, ofm: 'block' });
ok('B2 網站、OFM 擋掉 → 不退 raster(網站沒有退路),但同樣恰好一發 beacon', w.layerKind === 'ofm' && w.beacons.length === 1 && w.stadiaHits === 0, detail(w));

const h = await run({ appShell: true, ofm: 'stub' });
ok('B3 App 殼、OFM 正常(本機 stub)→ 零發 beacon、仍在 OFM、退路待命', h.beacons.length === 0 && h.layerKind === 'ofm' && h.armed && h.stadiaHits === 0, detail(h));
ok('B3b 負向對照有牙:MapLibre 樣式真的載完(不是根本沒起來就算零發)', h.glLoaded && h.ofmHits > 0, detail(h));

// ── M:突變 ────────────────────────────────────────────────────────────────────
servedHtml = src.replace(FAIL_LINE, FAIL_LINE.replace('ofmFailBeacon(why); ', ''));
if (servedHtml === src) { console.error('❌ 突變 M1 沒有命中'); process.exit(1); }
const m = await run({ appShell: true, ofm: 'block' });
ok('M1 突變(fail 拔掉 beacon)→ 退場照舊發生但零發 ⇒ B1 的「恰好一發」會轉紅(判準有牙)', m.layerKind === 'stadia' && m.beacons.length === 0, detail(m));
servedHtml = null;

await browser.close(); server.close();
const bad = R.filter(r => !r.pass);
console.log(`\n總計 ${R.length} 項,通過 ${R.length - bad.length},失敗 ${bad.length}`);
process.exit(bad.length ? 1 : 0);
