// GL 底圖守門人(換引擎 M1a):離線陸地(L)與衛星(S)。伺服器/boot 與 verify_gl_tracks.mjs 相同(PORT 43542)。
// L1 MapLibre 開機:layers[0]=background、[1]=offline-land-fill、[2]=offline-land-line;.stage 有 offline-land;署名含 OpenFreeMap 與 臺灣輪廓。
// L2 OFM 圖磚全 500 ⇒ 陸地像素=#f1f3f1、海面像素=#d4dadc(±4);dark 切換後 #0e0e0e/#262626。
// L3 正向對照:移除 offline-land-fill 後陸地像素變成海面色。
// L4 每次開機 pageerror=0。
// (S1–S7 見 Task 6)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43542;
const BASE = `http://127.0.0.1:${PORT}/index.html?lang=zh-TW`;
const GL_BASEMAP_REASON = '此斷言直接讀 MapLibre source/layer/style，Leaflet 沒有同型物件';
const selfSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
if (/(?:\?|&)engine=(?:maplibre|leaflet)/.test(selfSource)) throw new Error('不得硬編 engine query；請使用 engineUrl()');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!existsSync(fp)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

async function boot(browser, url, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && (u => u === '' || /index\.html/.test(u))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
  if (setup) await setup(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 });
  return { ctx, page, errs };
}
const idle = page => page.evaluate(() => new Promise(r => { const g = window.__ofmGl; if (g.loaded() && !g.isMoving()) r(); else { g.once('idle', r); setTimeout(r, 8000); } }));
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const near = (px, h, tol = 4) => Math.max(...px.map((v, i) => Math.abs(v - hex(h)[i]))) <= tol;
async function pixelAt(page, lat, lon) { // 目標點先移到畫面中央(邊緣有浮動 UI);toScreen 是容器座標,截圖是整頁座標,要加容器位移
  const p = await page.evaluate(([la, lo]) => { const M = window.__M; M.setView([la, lo], M.getZoom(), { animate: false }); const r = document.getElementById('map').getBoundingClientRect(); const q = M.toScreen([la, lo]); return { x: q.x + r.left, y: q.y + r.top }; }, [lat, lon]);
  await page.waitForTimeout(450);
  const png = await page.screenshot({ type: 'png' });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.round(p.y) * info.width + Math.round(p.x)) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}
const LAND = [23.70, 120.90], SEA = [25.20, 121.80]; // 中央山脈 / 基隆外海

const browser = await chromium.launch();
let matrix;
try {
  matrix = await runEngineMatrix(async ({ engine, engineUrl, check, onlyFor }) => {
    const common = await boot(browser, engineUrl(BASE));
    const actualEngine = await common.page.evaluate(() => window.__M && window.__M.engine);
    check(actualEngine === engine, '共同開機使用矩陣指定引擎', `actual=${actualEngine}`);
    check(common.errs.length === 0, '共同開機零 pageerror/console.error', common.errs.join(' | ').slice(0, 300));
    await common.ctx.close();
    const labels = [
      'L1 陸地兩層緊貼 background 之上且 .stage.offline-land',
      'L1b 署名含 OpenFreeMap(TileJSON 自帶)與 臺灣輪廓：內政部(自訂)',
      'L4a 零 pageerror/console.error',
      'L2 light:陸地 #f1f3f1、海面 #d4dadc',
      'L2b dark:陸地 #0e0e0e、海面 #262626',
      'L3 正向對照:移除 fill 後陸地像素變海面色',
      'L4b 零 pageerror/console.error',
      'S1 衛星 style 層序 background/陸地/sat6/sat、.stage.sat、非 Plus=sat-lq(tileSize 256)',
      'S1b 衛星署名=Esri+內政部,無 OFM',
      'S2 記帳=實際請求數(開衛星後閒置)',
      'S2b 平移後仍逐張相等',
      'S2c 正向對照:多記一張就不等(比對有牙)',
      'S3 跨門檻後 session 恰好一次,之後圖磚帶 S1(之前帶 T1)',
      'S4 圖磚 z=Leaflet 尺 z(另有 z6 保底);hi=128/lq=256',
      'S4b Plus+satRetina 完整流程實際選 sat-hi(tileSize 128)',
      'S5 z6 保底層蓋住未載入區;移除後露出離線陸地(sat 色)',
      'S7 衛星流程零 pageerror/console.error',
      'S6 _headers connect-src 含 Esri 圖磚網域(MapLibre raster 走 fetch)',
    ];
    if (engine !== 'maplibre') {
      labels.forEach(label => onlyFor('maplibre', GL_BASEMAP_REASON, label, undefined));
      return;
    }
    const ck = (pass, label, detail = '') => onlyFor('maplibre', GL_BASEMAP_REASON, label, pass, detail);
  // ── L1 正常開機 ──
  {
    const { ctx, page, errs } = await boot(browser, engineUrl(BASE));
    await page.waitForFunction(() => window.__ofmGl && window.__ofmGl.getLayer && window.__ofmGl.getLayer('offline-land-line'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => /OpenFreeMap/.test((document.querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {}); // OFM 署名來自 TileJSON,非同步到
    const l1 = await page.evaluate(() => ({ order: window.__ofmGl.getLayersOrder().slice(0, 3), cls: document.querySelector('.stage').classList.contains('offline-land'), attrib: (document.querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || '' }));
    ck(l1.order[1] === 'offline-land-fill' && l1.order[2] === 'offline-land-line' && l1.cls, 'L1 陸地兩層緊貼 background 之上且 .stage.offline-land', JSON.stringify(l1.order));
    ck(/OpenFreeMap/.test(l1.attrib) && /臺灣輪廓/.test(l1.attrib), 'L1b 署名含 OpenFreeMap(TileJSON 自帶)與 臺灣輪廓：內政部(自訂)', l1.attrib.slice(0, 120));
    ck(errs.length === 0, 'L4a 零 pageerror/console.error', errs.join(' | ').slice(0, 300));
    await ctx.close();
  }
  // ── L2/L3 OFM 圖磚全掛 ──
  {
    const { ctx, page, errs } = await boot(browser, engineUrl(BASE), p => p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ status: 500, body: '' })));
    await page.waitForFunction(() => window.__ofmGl && window.__ofmGl.getLayer && window.__ofmGl.getLayer('offline-land-fill'), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.__M.setView([24.0, 121.0], 8, { animate: false })); await idle(page); await page.waitForTimeout(300);
    const land = await pixelAt(page, ...LAND), sea = await pixelAt(page, ...SEA);
    ck(near(land, '#f1f3f1') && near(sea, '#d4dadc'), 'L2 light:陸地 #f1f3f1、海面 #d4dadc', `land=${land} sea=${sea}`);
    await page.evaluate(() => new Promise(res => { window.__ofmGl.once('style.load', res); window.__state.mapDark = true; setBasemap(); setTimeout(res, 10000); })); // 先掛監聽再切 style(競態),10s 上限
    await page.waitForFunction(() => window.__ofmGl.getLayer('offline-land-fill'), null, { timeout: 10000 }); await idle(page); await page.waitForTimeout(300);
    const landD = await pixelAt(page, ...LAND), seaD = await pixelAt(page, ...SEA);
    ck(near(landD, '#0e0e0e') && near(seaD, '#262626'), 'L2b dark:陸地 #0e0e0e、海面 #262626', `land=${landD} sea=${seaD}`);
    await page.evaluate(() => window.__ofmGl.removeLayer('offline-land-fill')); await page.waitForTimeout(300);
    const landX = await pixelAt(page, ...LAND);
    ck(near(landX, '#262626'), 'L3 正向對照:移除 fill 後陸地像素變海面色', `land=${landX}`);
    ck(errs.length === 0, 'L4b 零 pageerror/console.error', errs.join(' | ').slice(0, 300));
    await ctx.close();
  }
  // ── S 衛星(MapLibre):token/session 端點與 Esri 圖磚全部 route 攔截,不打真網路 ──
  {
    const PNG = (r, g, b) => sharp({ create: { width: 1, height: 1, channels: 3, background: { r, g, b } } }).png().toBuffer();
    const tileGreen = await PNG(0x3a, 0x5a, 0x3a), tileZ6 = await PNG(0x5a, 0x7a, 0x3a);
    const reqs = []; let sessionHits = 0; let hangHi = false;
    const { ctx, page, errs } = await boot(browser, engineUrl(BASE), async p => {
      await p.route('**/api/basemap-token', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ esri: 'T1' }) }));
      await p.route('**/api/basemap-session', r => { sessionHits++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionToken: 'S1', endTime: Date.now() + 3600000 }) }); });
      await p.route('**/World_Imagery/MapServer/tile/**', r => {
        const u = r.request().url(); const z = Number((u.match(/\/tile\/(\d+)\//) || [])[1]);
        reqs.push(u);
        if (hangHi && z >= 7) return; // S5:高階圖磚掛住不回
        r.fulfill({ status: 200, contentType: 'image/png', body: z === 6 ? tileZ6 : tileGreen });
      });
    });
    await page.waitForFunction(() => document.getElementById('satBtn') && window.__satStats && window.__satStats().url, null, { timeout: 15000 });
    await page.evaluate(() => window.__M.setView([25.04, 121.52], 12, { animate: false }));
    await page.click('#satBtn');
    await page.waitForFunction(() => window.__state.basemap === 'sat' && window.__ofmGl.getSource && window.__ofmGl.getSource('sat'), null, { timeout: 15000 });
    await page.waitForFunction(() => window.__ofmGl.getLayer('offline-land-fill'), null, { timeout: 10000 }); await idle(page); await page.waitForTimeout(500);
    const s1 = await page.evaluate(() => ({ order: window.__ofmGl.getLayersOrder().slice(0, 5), cls: document.querySelector('.stage').classList.contains('sat'), kind: window.__M.getStyleKind(), attrib: (document.querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || '', ts: window.__ofmGl.getSource('sat').tileSize }));
    ck(JSON.stringify(s1.order) === JSON.stringify(['background', 'offline-land-fill', 'offline-land-line', 'sat6', 'sat']) && s1.cls && s1.kind === 'sat-lq' && s1.ts === 256, 'S1 衛星 style 層序 background/陸地/sat6/sat、.stage.sat、非 Plus=sat-lq(tileSize 256)', JSON.stringify(s1).slice(0, 200));
    ck(/Esri/.test(s1.attrib) && /臺灣輪廓/.test(s1.attrib) && !/OpenFreeMap/.test(s1.attrib), 'S1b 衛星署名=Esri+內政部,無 OFM', s1.attrib.slice(0, 120));
    const stat = () => page.evaluate(() => window.__satStats());
    let st = await stat();
    ck(st.tiles > 0 && st.tiles === reqs.length, 'S2 記帳=實際請求數(開衛星後閒置)', `app=${st.tiles} net=${reqs.length}`);
    await page.evaluate(() => window.__M.panBy([700, 0], { animate: false })); await idle(page); await page.waitForTimeout(500);
    st = await stat();
    ck(st.tiles === reqs.length, 'S2b 平移後仍逐張相等', `app=${st.tiles} net=${reqs.length}`);
    await page.evaluate(() => satTileLoaded()); const st2 = await stat();
    ck(st2.tiles === reqs.length + 1, 'S2c 正向對照:多記一張就不等(比對有牙)', `app=${st2.tiles} net=${reqs.length}`);
    // S3 session:跨過 SAT_SESSION_AT 後恰好開一顆,之後的圖磚網址帶 session token
    await page.evaluate(() => window.__M.panBy([700, 0], { animate: false })); await idle(page); await page.waitForTimeout(800);
    await page.evaluate(() => window.__M.panBy([0, 500], { animate: false })); await idle(page); await page.waitForTimeout(800);
    const lastUrl = reqs[reqs.length - 1] || '';
    const s3 = await page.evaluate(() => ({ session: window.__satStats().session, ls: !!localStorage.getItem('trainmap-esri-session') }));
    ck(sessionHits === 1 && s3.session && s3.ls && /token=S1/.test(lastUrl) && reqs.some(u => /token=T1/.test(u)), 'S3 跨門檻後 session 恰好一次,之後圖磚帶 S1(之前帶 T1)', `hits=${sessionHits} last=${lastUrl.slice(-30)} n=${reqs.length}`);
    // S4 tileSize/圖磚 z:非 Plus 主層 z=Leaflet 尺 z;satGlStyle(true) 為 128
    const zs = new Set(reqs.slice(-20).map(u => Number((u.match(/\/tile\/(\d+)\//) || [])[1])));
    const s4 = await page.evaluate(() => ({ z: Math.round(window.__M.getZoom()), hi: satGlStyle(true).sources.sat.tileSize, lq: satGlStyle(false).sources.sat.tileSize }));
    ck([...zs].every(z => z === 6 || z === s4.z) && s4.hi === 128 && s4.lq === 256, 'S4 圖磚 z=Leaflet 尺 z(另有 z6 保底);hi=128/lq=256', `zs=${[...zs]} z=${s4.z}`);
    // S5 z6 保底:高階圖磚全掛住、跳到新地區,陸地像素=z6 圖磚色;移除 sat6 後=離線陸地 sat 色(正向對照)
    hangHi = true;
    await page.evaluate(() => window.__M.setView([23.0, 120.2], 12, { animate: false })); await page.waitForTimeout(1200);
    const p5 = await pixelAt(page, 23.0, 120.2);
    await page.evaluate(() => window.__ofmGl.removeLayer('sat6')); await page.waitForTimeout(400);
    const p5b = await pixelAt(page, 23.0, 120.2);
    ck(near(p5, '#5a7a3a', 6) && near(p5b, '#606050', 6), 'S5 z6 保底層蓋住未載入區;移除後露出離線陸地(sat 色)', `with=${p5} without=${p5b}`);
    ck(errs.length === 0, 'S7 衛星流程零 pageerror/console.error', errs.join(' | ').slice(0, 300));
    await ctx.close();
  }
  // ── S4b 高解析不能只驗 satGlStyle(true) helper：由實際 Plus 狀態與 APP_CFG 走完整切圖流程 ──
  {
    const tile = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 58, g: 90, b: 58 } } }).png().toBuffer();
    const reqs = [];
    const { ctx, page } = await boot(browser, engineUrl(BASE), async p => {
      await p.addInitScript(() => { window.RAIL_APP_CONFIG = { satRetina: true }; });
      await p.route('**/api/basemap-token', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ esri: 'T1' }) }));
      await p.route('**/World_Imagery/MapServer/tile/**', r => {
        reqs.push(r.request().url());
        r.fulfill({ status: 200, contentType: 'image/png', body: tile });
      });
    });
    await page.waitForFunction(() => document.getElementById('satBtn') && window.__satStats && window.__satStats().url, null, { timeout: 15000 });
    await page.evaluate(() => {
      state.plus = { active: true, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
      state.followTrain = null;
      window.__M.setView([25.04, 121.52], 12, { animate: false });
    });
    await page.click('#satBtn');
    await page.waitForFunction(() => window.__M.getStyleKind() === 'sat-hi' && window.__ofmGl.getSource('sat'), null, { timeout: 15000 });
    await idle(page); await page.waitForTimeout(400);
    const hi = await page.evaluate(() => ({ kind: window.__M.getStyleKind(), tileSize: window.__ofmGl.getSource('sat').tileSize, basemap: state.basemap }));
    ck(hi.kind === 'sat-hi' && hi.tileSize === 128 && hi.basemap === 'sat' && reqs.length > 0,
      'S4b Plus+satRetina 完整流程實際選 sat-hi(tileSize 128)', `${JSON.stringify(hi)} requests=${reqs.length}`);
    await ctx.close();
  }
  // ── S6 CSP 靜態 ──
  {
    const h = readFileSync(path.join(ROOT, '_headers'), 'utf8');
    const csp = (h.split('\n').find(l => /Content-Security-Policy:/.test(l)) || '');
    const connect = (csp.match(/connect-src([^;]*)/) || [])[1] || '';
    ck(/https:\/\/ibasemaps-api\.arcgis\.com/.test(connect) && /https:\/\/tiles\.openfreemap\.org/.test(connect), 'S6 _headers connect-src 含 Esri 圖磚網域(MapLibre raster 走 fetch)', connect.trim().slice(0, 160));
  }
  });
} finally {
  await browser.close(); server.close();
}
console.log(matrix?.passed ? '\n全部通過' : `\n${matrix?.failures.length || 1} 項未過`);
process.exit(matrix?.passed ? 0 : 1);
