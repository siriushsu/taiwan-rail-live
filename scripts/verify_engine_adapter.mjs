// 地圖引擎適配層守門人(MapLibre 換引擎 M0a)。
// G1 靜態:index.html 裡 `// ==== ENGINE ADAPTER START/END ====` 標記各恰 1 次;標記外的 `map.xxx(` 呼叫數
//    (ENGINE_GATE_STRICT=1 時必須 0);`toScreen: ll => Lmap.latLngToContainerPoint(ll)` 原文存在(不准快取函式參考)。
// G2 動態(Leaflet 引擎):__M 與 __map 同一物件;toScreen/fromScreen/worldPx/worldUnpx/getSize/getZoom/getCenter 逐值相等。
// G3 事件:M.on('moveend') 在 M.setView 後被叫到;M.off 後不再叫到。
// G4 旗標:?engine=maplibre → __ENGINE==='maplibre'(有 MapLibre 實作時 __M.engine 也是,否則退回 leaflet);
//    localStorage 路徑;URL 蓋 localStorage;非法值退回 leaflet。
// G5 正向對照:把一行 `map.getZoom(` 塞進來源字串副本,G1 計數器必須抓到(證明計數器有牙)。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43537;
const STRICT = process.env.ENGINE_GATE_STRICT === '1';
const fails = [];
const ck = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails.push(name); };

// ── G1 靜態 ──────────────────────────────────────────────────────────────
const src = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const START = '// ==== ENGINE ADAPTER START ====', END = '// ==== ENGINE ADAPTER END ====';
const RAW_MAP = /(?<![.\w$])map\.[A-Za-z_]+\(/g;
function countRawMapOutside(text) {
  const a = text.indexOf(START), b = text.indexOf(END);
  const outside = (a >= 0 && b > a) ? text.slice(0, a) + text.slice(b + END.length) : text;
  const hits = [];
  const lines = outside.split('\n');
  lines.forEach((l, i) => { if (RAW_MAP.test(l)) hits.push(i + 1 + ':' + l.trim().slice(0, 100)); RAW_MAP.lastIndex = 0; });
  return hits;
}
const nStart = src.split(START).length - 1, nEnd = src.split(END).length - 1;
ck(nStart === 1 && nEnd === 1, 'G1a 適配層標記各恰 1 次', `start=${nStart} end=${nEnd}`);
const rawHits = countRawMapOutside(src);
console.log(`  標記外 raw map.xxx( 命中數:${rawHits.length}`);
if (rawHits.length) console.log('  ' + rawHits.slice(0, 15).join('\n  ') + (rawHits.length > 15 ? `\n  …共 ${rawHits.length} 處` : ''));
if (STRICT) ck(rawHits.length === 0, 'G1b(嚴格) 標記外無 raw map.xxx( 呼叫', `${rawHits.length} 處`);
else console.log('  (非嚴格模式:G1b 只報數不判紅;ENGINE_GATE_STRICT=1 才判)');
ck(src.includes('toScreen: ll => Lmap.latLngToContainerPoint(ll)'), 'G1c toScreen 每次呼叫走 Lmap 當下的方法(不快取函式參考)');
const BARE = /\blet map\b|\bmap = L\.map\(|window\.__map = map\b|addTo\(map\)|\(map,|!map\b|(?<![.\w$])map &&/g;
const bareHits = (src.match(BARE) || []).length;
console.log(`  裸 map 識別字(let map / addTo(map) / !map / map && …)命中數:${bareHits}`);
if (STRICT) ck(bareHits === 0, 'G1d(嚴格) 無裸 map 識別字殘留', `${bareHits} 處`);
// G5 正向對照:計數器要抓得到塞進去的一行
const mutated = src.replace('<script>', '<script>\nconst __x = map.getZoom();');
ck(countRawMapOutside(mutated).length === rawHits.length + 1, 'G5 正向對照:塞一行 map.getZoom( 計數 +1');
const mutatedBare = src.replace('<script>', '<script>\nconst __y = map && 1;');
ck((mutatedBare.match(BARE) || []).length === bareHits + 1, 'G5b 正向對照:塞一行 `map && 1` 裸 map 計數 +1');

if (process.env.ENGINE_GATE_STATIC_ONLY === '1') {
  console.log(fails.length ? `\n${fails.length} 項未過:${fails.join(', ')}` : '\n靜態閘門全部通過');
  process.exit(fails.length ? 1 : 0);
}

// ── 靜態伺服器(離線;/api/* 回 {} 但高鐵班表吐打包那份,理由見 verify_last_view.mjs) ─────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
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

async function boot(browser, query, initLs) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.addInitScript(ls => { localStorage.setItem('trainmap-howto-seen', '1'); for (const k in ls) localStorage.setItem(k, ls[k]); }, initLs || {});
  await page.goto(`http://127.0.0.1:${PORT}/index.html?lang=zh-TW${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 });
  return { ctx, page, errs };
}

const browser = await chromium.launch();
try {
  // ── G2 Leaflet 引擎逐值相等 ──
  {
    const { ctx, page, errs } = await boot(browser, '');
    const r = await page.evaluate(() => {
      const M = window.__M, map = window.__map;
      if (!M) return { noM: true };
      const pts = [[25.0478, 121.517], [22.6394, 120.3022], [24.1367, 120.6858]];
      const same = (a, b) => a && b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
      const sameLL = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
      return {
        engine: M.engine, rawIsMap: M.raw === map, leafletIsMap: M.leaflet === map,
        toScreen: pts.every(p => same(M.toScreen(p), map.latLngToContainerPoint(p))),
        fromScreen: [[10, 10], [300, 200]].every(p => sameLL(M.fromScreen(p), map.containerPointToLatLng(p))),
        worldPx: pts.every(p => same(M.worldPx(p, 12), map.project(p, 12))),
        worldUnpx: sameLL(M.worldUnpx({ x: 500000, y: 400000 }, 12), map.unproject({ x: 500000, y: 400000 }, 12)),
        size: same(M.getSize(), map.getSize()), zoom: M.getZoom() === map.getZoom(),
        center: sameLL(M.getCenter(), map.getCenter()),
        bounds: M.getBounds().equals(map.getBounds()),
        container: M.getContainer() === map.getContainer(),
        lb: M.latLngBounds([24, 121], [25, 122]).getNorth() === 25 && M.point(3, 4).x === 3 && M.latLng(24.5, 121.2).lng === 121.2,
      };
    });
    ck(!r.noM && r.engine === 'leaflet', 'G2a 預設引擎 leaflet 且 window.__M 存在', JSON.stringify(r).slice(0, 120));
    ck(r.rawIsMap && r.leafletIsMap, 'G2b M.raw 與 M.leaflet 都是 window.__map');
    ck(r.toScreen && r.fromScreen && r.worldPx && r.worldUnpx, 'G2c 投影四原語逐值相等');
    ck(r.size && r.zoom && r.center && r.bounds && r.container, 'G2d 相機/容器讀值逐值相等');
    ck(r.lb, 'G2e 幾何工廠 latLngBounds/point/latLng 可用');
    // ── G3 事件 ──
    const ev = await page.evaluate(async () => {
      const M = window.__M; let n = 0; const fn = () => { n++; };
      M.on('moveend', fn);
      M.setView([25.04, 121.5], 12, { animate: false });
      await new Promise(r => setTimeout(r, 300));
      const after1 = n;
      M.off('moveend', fn);
      M.setView([25.05, 121.51], 12, { animate: false });
      await new Promise(r => setTimeout(r, 300));
      return { after1, after2: n, zoom: M.getZoom() };
    });
    ck(ev.after1 >= 1 && ev.after2 === ev.after1 && ev.zoom === 12, 'G3 on/setView 觸發 moveend;off 後不再觸發', JSON.stringify(ev));
    ck(errs.length === 0, 'G2f 開機零 pageerror', errs.join(' | ').slice(0, 200));
    await ctx.close();
  }
  // ── G4 旗標 ──
  {
    const hasML = await (async () => { const { ctx, page } = await boot(browser, ''); const v = await page.evaluate(() => typeof createMaplibreEngine === 'function'); await ctx.close(); return v; })();
    const expectEngine = hasML ? 'maplibre' : 'leaflet';
    const { ctx, page, errs } = await boot(browser, 'engine=maplibre');
    const r = await page.evaluate(() => ({ flag: window.__ENGINE, engine: window.__M && window.__M.engine }));
    ck(r.flag === 'maplibre', 'G4a ?engine=maplibre → __ENGINE=maplibre', JSON.stringify(r));
    ck(r.engine === expectEngine, `G4b __M.engine=${expectEngine}(${hasML ? '有' : '尚無'} MapLibre 實作)`, JSON.stringify(r));
    ck(errs.length === 0, 'G4c ?engine=maplibre 開機零 pageerror', errs.join(' | ').slice(0, 200));
    await ctx.close();
    const b = await boot(browser, '', { 'trainmap-engine': 'maplibre' });
    ck((await b.page.evaluate(() => window.__ENGINE)) === 'maplibre', 'G4d localStorage trainmap-engine=maplibre 生效');
    await b.ctx.close();
    const c = await boot(browser, 'engine=leaflet', { 'trainmap-engine': 'maplibre' });
    ck((await c.page.evaluate(() => window.__ENGINE)) === 'leaflet', 'G4e URL 蓋過 localStorage');
    await c.ctx.close();
    const d = await boot(browser, 'engine=foo');
    ck((await d.page.evaluate(() => window.__ENGINE)) === 'leaflet', 'G4f 非法值退回 leaflet');
    await d.ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(fails.length ? `\n${fails.length} 項未過:${fails.join(', ')}` : '\n全部通過');
process.exit(fails.length ? 1 : 0);
