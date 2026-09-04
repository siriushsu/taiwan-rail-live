// 地圖引擎適配層守門人(MapLibre 換引擎 M0a/M1b)。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { probeCentroids } from './probe_centroids.mjs';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43537;
const BASE = `http://127.0.0.1:${PORT}/index.html?lang=zh-TW`;
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
  outside.split('\n').forEach((line, i) => { if (RAW_MAP.test(line)) hits.push(i + 1 + ':' + line.trim().slice(0, 100)); RAW_MAP.lastIndex = 0; });
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
const mutated = src.replace('<script>', '<script>\nconst __x = map.getZoom();');
ck(countRawMapOutside(mutated).length === rawHits.length + 1, 'G5 正向對照:塞一行 map.getZoom( 計數 +1');
const mutatedBare = src.replace('<script>', '<script>\nconst __y = map && 1;');
ck((mutatedBare.match(BARE) || []).length === bareHits + 1, 'G5b 正向對照:塞一行 `map && 1` 裸 map 計數 +1');

const FORBIDDEN_VERIFY_MAP = /window\.__map\.(?:latLngToContainerPoint|containerPointToLatLng|project\s*\(|unproject\s*\(|invalidateSize)/;
function verifyFilesAt(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => /^verify_.*\.mjs$/.test(name)).map(name => path.join(dir, name));
}
function forbiddenVerifyCalls(files, extraLines = []) {
  const hits = [];
  for (const file of files) readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const count = (line.match(new RegExp(FORBIDDEN_VERIFY_MAP.source, 'g')) || []).length;
    for (let n = 0; n < count; n++) hits.push(`${path.relative(ROOT, file)}:${i + 1}:${line.trim().slice(0, 120)}`);
  });
  extraLines.forEach((line, i) => {
    const count = (line.match(new RegExp(FORBIDDEN_VERIFY_MAP.source, 'g')) || []).length;
    for (let n = 0; n < count; n++) hits.push(`<memory>:${i + 1}:${line}`);
  });
  return hits;
}
const verifyFiles = [...verifyFilesAt(path.join(ROOT, 'scripts')), ...verifyFilesAt(path.join(ROOT, 'app', 'scripts'))];
const forbiddenVerifyHits = forbiddenVerifyCalls(verifyFiles);
console.log(`  驗收腳本 Leaflet 投影原名命中數:${forbiddenVerifyHits.length}`);
if (forbiddenVerifyHits.length) console.log('  ' + forbiddenVerifyHits.join('\n  '));
ck(forbiddenVerifyHits.length === 0, 'G1e 驗收腳本不直呼 Leaflet 投影原名', `${forbiddenVerifyHits.length} 處`);
const forbiddenMutation = ['window.__', 'map.latLngToContainerPoint([0,0])'].join('');
ck(forbiddenVerifyCalls(verifyFiles, [forbiddenMutation]).length === forbiddenVerifyHits.length + 1,
  'G1f 正向對照:記憶體塞一行 Leaflet 投影原名後命中數 +1');

function overlayRuntimeContract(text) {
  const reprojectStart = text.indexOf('function reproject() {');
  const reprojectEnd = text.indexOf('// 縮放動畫逐幀驅動', reprojectStart);
  const body = reprojectStart >= 0 && reprojectEnd > reprojectStart ? text.slice(reprojectStart, reprojectEnd) : '';
  const renderWires = (text.match(/M\.on\('render', syncDrawMaplibre\)/g) || []).length;
  return {
    reprojectPure: body.includes('M.getSize()') && body.includes('M.toScreen(')
      && !/M\.(?:leaflet|raw|_[A-Za-z])\b|window\.__map/.test(body),
    renderWires,
    renderBody: text.includes('const syncDrawMaplibre = () => { reproject(); syncDraw(); };'),
    leafletZoomOnly: /if \(M\.engine === 'leaflet'\) \{[\s\S]*?M\.on\('zoomanim', onZoomAnim\);[\s\S]*?state\._endZoomAnim = endZoomAnim;[\s\S]*?\n  \}/.test(text),
  };
}
const overlayContract = overlayRuntimeContract(src);
ck(overlayContract.reprojectPure && overlayContract.renderWires === 1 && overlayContract.renderBody && overlayContract.leafletZoomOnly,
  'G8 overlay runtime：reproject 引擎中立、MapLibre render 接線唯一、Leaflet zoomanim 已隔離', JSON.stringify(overlayContract));
const overlayMutated = overlayRuntimeContract(src.replace("M.on('render', syncDrawMaplibre);", ''));
ck(overlayMutated.renderWires === overlayContract.renderWires - 1 && overlayMutated.renderWires === 0,
  'G8b 正向對照:移除 MapLibre render 接線後契約必少 1');

if (process.env.ENGINE_GATE_STATIC_ONLY === '1') {
  console.log(fails.length ? `\n${fails.length} 項未過:${fails.join(', ')}` : '\n靜態閘門全部通過');
  process.exit(fails.length ? 1 : 0);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const HOOK_TILE = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 32, g: 64, b: 96 } } }).png().toBuffer();
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (/^\/__g6j-[ab]\//.test(url.pathname)) {
    res.statusCode = 200; res.setHeader('content-type', 'image/png'); return res.end(HOOK_TILE);
  }
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
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

async function boot(browser, url, initLs = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && (u => u === '' || /index\.html/.test(u))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.addInitScript(ls => { localStorage.setItem('trainmap-howto-seen', '1'); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, initLs);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state?.ready, null, { timeout: 60000 });
  return { ctx, page, errs };
}

const LEAFLET_REASON = '此斷言逐值比較 Leaflet native map，MapLibre 沒有同型 Leaflet 物件';
const MAPLIBRE_REASON = '此斷言直接讀 MapLibre style、canvas 或 raw map，Leaflet 沒有同型物件';
const FLAG_REASON = '此斷言刻意驗非法 engine 值退回 Leaflet，只在 Leaflet pass 執行一次';
const browser = await chromium.launch();
let matrix, leafletBaseline;
try {
  matrix = await runEngineMatrix(async ({ engine, engineUrl, check, onlyFor }) => {
    const b = await boot(browser, engineUrl(BASE));
    const common = await b.page.evaluate(async () => {
      const M = window.__M; let calls = 0; const fn = () => calls++;
      M.on('moveend', fn); M.setView([25.04, 121.5], 12, { animate: false });
      await new Promise(resolve => setTimeout(resolve, 300)); const after = calls;
      M.off('moveend', fn); M.setView([25.05, 121.51], 12, { animate: false });
      await new Promise(resolve => setTimeout(resolve, 300));
      const p = M.toScreen([25.0478, 121.517]), ll = M.fromScreen(p), p2 = M.toScreen(ll);
      const bounds = M.latLngBounds([24, 121], [25, 122]);
      return {
        engine: M.engine, flag: window.__ENGINE, after, final: calls,
        roundtrip: Math.abs(p2.x - p.x) < 1e-6 && Math.abs(p2.y - p.y) < 1e-6,
        size: M.getSize(), center: M.getCenter(),
        factories: bounds.getNorth() === 25 && M.point(3, 4).x === 3 && M.latLng(24.5, 121.2).lng === 121.2,
      };
    });
    check(common.engine === engine && common.flag === engine, 'G2a／G4a 矩陣指定引擎與 __ENGINE 生效', common);
    check(common.roundtrip && common.size.x > 100, 'G2b 共用投影 roundtrip 與尺寸原語可用', common);
    check(common.factories && Number.isFinite(common.center.lat) && Number.isFinite(common.center.lng), 'G2e 幾何工廠與中心原語可用', common);
    check(common.after >= 1 && common.final === common.after, 'G3 on/setView 觸發 moveend；off 後不再觸發', common);
    check(b.errs.length === 0, 'G2f 開機零 pageerror/console.error', b.errs.join(' | ').slice(0, 300));

    let leaf;
    if (engine === 'leaflet') {
      leaf = await b.page.evaluate(() => {
        const M = window.__M, raw = M.raw, pts = [[25.0478, 121.517], [22.6394, 120.3022], [24.1367, 120.6858]];
        const same = (a, c) => a && c && Math.abs(a.x - c.x) < 1e-9 && Math.abs(a.y - c.y) < 1e-9;
        const sameLL = (a, c) => a && c && Math.abs(a.lat - c.lat) < 1e-9 && Math.abs(a.lng - c.lng) < 1e-9;
        M.setView([25.0478, 121.517], 12, { animate: false });
        const a = M.toScreen([25.0478, 121.517]), c = M.toScreen([25.0578, 121.527]);
        const got = {}, originalResize = raw.invalidateSize, originalSetView = raw.setView;
        raw.invalidateSize = function (options) { got.resize = options; return originalResize.call(this, options); };
        raw.setView = function (center, zoom, options) { got.setView = options; return originalSetView.call(this, center, zoom, options); };
        M.resize({ animate: false, pan: false });
        M.setView([25.0, 121.5], 11, { animate: false });
        raw.invalidateSize = originalResize; raw.setView = originalSetView;
        return {
          engine: M.engine,
          identity: raw === window.__map && M.leaflet === raw,
          projection: pts.every(p => same(M.toScreen(p), raw.latLngToContainerPoint(p)))
            && [[10, 10], [300, 200]].every(p => sameLL(M.fromScreen(p), raw.containerPointToLatLng(p)))
            && pts.every(p => same(M.worldPx(p, 12), raw.project(p, 12)))
            && sameLL(M.worldUnpx({ x: 500000, y: 400000 }, 12), raw.unproject({ x: 500000, y: 400000 }, 12)),
          values: same(M.getSize(), raw.getSize()) && M.getZoom() === raw.getZoom()
            && sameLL(M.getCenter(), raw.getCenter()) && M.getBounds().equals(raw.getBounds()) && M.getContainer() === raw.getContainer(),
          forwardedResize: !!got.resize && got.resize.animate === false && got.resize.pan === false,
          forwardedSetView: !!got.setView && got.setView.animate === false,
          resizeOptions: got.resize, setViewOptions: got.setView,
          baseline: { d: Math.hypot(a.x - c.x, a.y - c.y), bz: M.getBoundsZoom(M.latLngBounds([24.9, 121.4], [25.2, 121.7]), false) },
        };
      });
      leafletBaseline = leaf.baseline;
    }
    onlyFor('leaflet', LEAFLET_REASON, 'G2a Leaflet 引擎且 window.__M 存在', engine === 'leaflet' ? leaf.engine === 'leaflet' : undefined, leaf);
    onlyFor('leaflet', LEAFLET_REASON, 'G2b M.raw 與 M.leaflet 都是 window.__map', engine === 'leaflet' ? leaf.identity : undefined, leaf);
    onlyFor('leaflet', LEAFLET_REASON, 'G2c Leaflet 投影四原語逐值相等', engine === 'leaflet' ? leaf.projection : undefined, leaf);
    onlyFor('leaflet', LEAFLET_REASON, 'G2d Leaflet identity／相機／容器逐值相等', engine === 'leaflet' ? leaf.identity && leaf.values : undefined, leaf);
    onlyFor('leaflet', LEAFLET_REASON, 'G2g resize options 逐字轉發到 invalidateSize', engine === 'leaflet' ? leaf.forwardedResize : undefined, leaf?.resizeOptions);
    onlyFor('leaflet', LEAFLET_REASON, 'G2h setView options 逐字轉發到 Lmap.setView', engine === 'leaflet' ? leaf.forwardedSetView : undefined, leaf?.setViewOptions);

    let ml, adapter, hookProbe;
    if (engine === 'maplibre') {
      await b.page.waitForFunction(() => window.__M.raw.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {});
      ml = await b.page.evaluate(() => {
        const M = window.__M, raw = M.raw, ov = document.getElementById('overlay'), mapEl = document.getElementById('map');
        M.setView([25.0478, 121.517], 12, { animate: false });
        const a = M.toScreen([25.0478, 121.517]), d = M.toScreen([25.0578, 121.527]);
        const c = M.getCenter();
        return {
          raw: raw instanceof maplibregl.Map, leafletNull: M.leaflet === null, style: raw.isStyleLoaded(), ready: !!window.__state.ready,
          flat: raw.getBearing() === 0 && raw.getPitch() === 0,
          sameSize: ov.clientWidth === mapEl.clientWidth && ov.clientHeight === mapEl.clientHeight && ov.clientWidth > 100,
          center: Math.abs(c.lat - 25.0478) < 1e-6 && Math.abs(c.lng - 121.517) < 1e-6,
          exposed: window.__map === raw, zoom: M.getZoom(), d: Math.hypot(a.x - d.x, a.y - d.y),
          bz: M.getBoundsZoom(M.latLngBounds([24.9, 121.4], [25.2, 121.7]), false),
          inBounds: M.getBounds().contains([25.0478, 121.517]),
        };
      });
      adapter = await b.page.evaluate(async () => {
        const M = window.__M, raw = M.raw, calls = [];
        M.onStyleLoad(() => calls.push((raw.getStyle().name || '') + '|' + raw.getStyle().layers.filter(layer => !/^(offline-land|track-)/.test(layer.id)).length));
        const immediate = calls.length;
        const loaded = new Promise(resolve => raw.once('style.load', resolve));
        M.setStyleKind('dark'); await loaded; await new Promise(resolve => setTimeout(resolve, 50));
        M.setStyleKind('foo'); const kindNoop = M.getStyleKind();
        M.setAttribution(['甲署名', '', '乙署名']);
        const box = document.querySelector('.maplibregl-ctrl-bottom-right');
        const kids = [...box.children].map(el => el.className);
        const coreKids = kids.filter(className => !/follow-lock-ctl/.test(className));
        const followLocks = kids.filter(className => /follow-lock-ctl/.test(className)).length;
        const text = (box.querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || '';
        return { immediate, calls, kindNoop, kids, coreKids, followLocks, text };
      });

      hookProbe = await b.page.evaluate(async () => {
        const M = window.__M, raw = M.raw, hits = [];
        const waitFor = async predicate => {
          const until = performance.now() + 3000;
          while (!predicate() && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
        };
        const remove = suffix => {
          const layer = `g6j-${suffix}-layer`, source = `g6j-${suffix}`;
          if (raw.getLayer(layer)) raw.removeLayer(layer);
          if (raw.getSource(source)) raw.removeSource(source);
        };
        const add = suffix => {
          raw.addSource(`g6j-${suffix}`, { type: 'raster', tiles: [`${location.origin}/__g6j-${suffix}/{z}/{x}/{y}.png`], tileSize: 256 });
          raw.addLayer({ id: `g6j-${suffix}-layer`, type: 'raster', source: `g6j-${suffix}`, paint: { 'raster-opacity': 0.01 } });
        };
        try {
          M.setTileRequestHook(url => hits.push(url));
          add('a');
          await waitFor(() => hits.some(url => url.includes('/__g6j-a/')));
          const beforeClear = hits.length;
          const aHits = hits.filter(url => url.includes('/__g6j-a/')).length;
          M.setTileRequestHook(null);
          remove('a'); add('b');
          await new Promise(resolve => setTimeout(resolve, 500));
          return { beforeClear, afterClear: hits.length, aHits, bHits: hits.filter(url => url.includes('/__g6j-b/')).length };
        } finally {
          M.setTileRequestHook(null); remove('a'); remove('b');
        }
      });
    }
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6a MapLibre 引擎生效(raw／leaflet／__map 契約)', engine === 'maplibre' ? ml.raw && ml.leafletNull && ml.exposed : undefined, ml);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G4a ?engine=maplibre → __ENGINE=maplibre', engine === 'maplibre' ? common.flag === 'maplibre' : undefined, common);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G4b __M.engine=maplibre', engine === 'maplibre' ? common.engine === 'maplibre' : undefined, common);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G4c ?engine=maplibre 開機零 pageerror', engine === 'maplibre' ? b.errs.length === 0 : undefined, b.errs);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6b style 載入且 state.ready', engine === 'maplibre' ? ml.style && ml.ready : undefined, ml);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6c #overlay 與 #map 同尺寸', engine === 'maplibre' ? ml.sameSize : undefined, ml);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6d zoom 尺度與 Leaflet 一致', engine === 'maplibre' ? !!leafletBaseline && Math.abs(ml.d - leafletBaseline.d) <= 1.5 && ml.zoom === 12 && ml.center : undefined, { ml, leafletBaseline });
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6e getBoundsZoom 與 Leaflet 差 ≤1 級', engine === 'maplibre' ? !!leafletBaseline && Math.abs(ml.bz - leafletBaseline.bz) <= 1 : undefined, { ml: ml?.bz, leaflet: leafletBaseline?.bz });
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6f getBounds 含中心；bearing/pitch 為 0', engine === 'maplibre' ? ml.inBounds && ml.flat : undefined, ml);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6g MapLibre 開機零 pageerror/console.error', engine === 'maplibre' ? b.errs.length === 0 : undefined, b.errs.join(' | ').slice(0, 300));
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6h onStyleLoad 立即一次、換 style 後再一次且身分改變', engine === 'maplibre' ? adapter.immediate === 1 && adapter.calls.length === 2 && adapter.calls[1] !== adapter.calls[0] : undefined, adapter?.calls);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6i setStyleKind 未知 kind 且無 style 物件為 no-op', engine === 'maplibre' ? adapter.kindNoop === 'dark' : undefined, adapter?.kindNoop);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6j setAttribution 整份替換、DOM 順序不變，tile hook 清除前後正向對照成立', engine === 'maplibre'
      ? adapter.text.includes('甲署名') && adapter.text.includes('乙署名') && adapter.coreKids.length === 2
        && /group/.test(adapter.coreKids[0]) && /attrib/.test(adapter.coreKids[1]) && adapter.followLocks === 1
        && hookProbe.aHits > 0 && hookProbe.beforeClear === hookProbe.afterClear && hookProbe.bHits === 0
      : undefined, { adapter, hookProbe });
    await b.ctx.close();

    const errorProbe = await boot(browser, engineUrl(BASE));
    await errorProbe.page.evaluate(() => { const script = document.createElement('script'); script.textContent = "console.error('G2i 探針')"; document.body.appendChild(script); });
    await errorProbe.page.waitForTimeout(100);
    check(errorProbe.errs.filter(error => error.includes('G2i 探針')).length === 1, 'G2i 正向對照：頁面 console.error 會被 errs 收到', errorProbe.errs);
    await errorProbe.ctx.close();

    const override = await boot(browser, engineUrl(BASE), { 'trainmap-engine': engine === 'leaflet' ? 'maplibre' : 'leaflet' });
    check((await override.page.evaluate(() => window.__ENGINE)) === engine, 'G4e URL engine 蓋過相反的 localStorage', engine);
    await override.ctx.close();

    const localStorageOnly = await boot(browser, BASE, { 'trainmap-engine': engine });
    check((await localStorageOnly.page.evaluate(() => window.__ENGINE)) === engine, 'G4d localStorage trainmap-engine 生效', engine);
    await localStorageOnly.ctx.close();

    let invalidFlag;
    if (engine === 'leaflet') {
      const invalidUrl = new URL(BASE); invalidUrl.searchParams.set('engine', 'foo');
      const invalid = await boot(browser, invalidUrl.href);
      invalidFlag = await invalid.page.evaluate(() => window.__ENGINE);
      await invalid.ctx.close();
    }
    onlyFor('leaflet', FLAG_REASON, 'G4f 非法 engine 值退回 leaflet', engine === 'leaflet' ? invalidFlag === 'leaflet' : undefined, invalidFlag);

    let probePass, probeDetail, probeMutationPass, probeMutationDetail;
    if (engine === 'maplibre') {
      const pr = await boot(browser, engineUrl(BASE, { aligndot: '25.20,121.80' }));
      await pr.page.waitForFunction(() => window.__ofmGl?.getLayer?.('aligndot'), null, { timeout: 30000 });
      await pr.page.evaluate(() => window.__M.setView([25.20, 121.80], 13, { animate: false }));
      await pr.page.waitForTimeout(1200);
      const { data, info } = await sharp(await pr.page.screenshot({ type: 'png' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const cen = probeCentroids(data, info.width, info.height, { magR: 18, cynR: 5 });
      const dist = cen.mag && cen.cyn ? Math.hypot(cen.mag.x - cen.cyn.x, cen.mag.y - cen.cyn.y) : NaN;
      probePass = !!cen.mag && !!cen.cyn && dist <= 2; probeDetail = { cen, dist };
      await pr.page.evaluate(() => {
        const M = window.__M, original = M.toScreen;
        M.toScreen = ll => { const p = original(ll); return { x: p.x + 30, y: p.y }; };
        if (window.__state.ready) draw();
      });
      await pr.page.waitForTimeout(300);
      const shifted = await sharp(await pr.page.screenshot({ type: 'png' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const shiftedCen = probeCentroids(shifted.data, shifted.info.width, shifted.info.height, { magR: 18, cynR: 5 });
      const shiftedDist = shiftedCen.mag && shiftedCen.cyn ? Math.hypot(shiftedCen.mag.x - shiftedCen.cyn.x, shiftedCen.mag.y - shiftedCen.cyn.y) : NaN;
      probeMutationPass = shiftedDist >= 25; probeMutationDetail = { cen: shiftedCen, dist: shiftedDist };
      await pr.ctx.close();
    }
    onlyFor('maplibre', MAPLIBRE_REASON, 'G7 對齊探針洋紅/青圓心距離 ≤2px', engine === 'maplibre' ? probePass : undefined, probeDetail);
    onlyFor('maplibre', MAPLIBRE_REASON, 'G7b 正向對照：overlay 投影挪 30px 後量到 ≥25px', engine === 'maplibre' ? probeMutationPass : undefined, probeMutationDetail);
  });
} finally {
  await browser.close(); server.close();
}
const staticFailures = fails.length;
console.log(matrix?.passed && !staticFailures ? '\n全部通過' : `\n${staticFailures + (matrix?.failures.length || 0)} 項未過`);
process.exit(matrix?.passed && !staticFailures ? 0 : 1);
