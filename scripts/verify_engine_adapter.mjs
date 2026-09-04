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
// M4-B:原本釘的是 Leaflet 版 `toScreen: ll => Lmap.latLngToContainerPoint(ll)`(要防 boot 的呼吸幕 patch
// 換掉方法之後 toScreen 還指著舊的)。Leaflet 拔掉後那個 patch 也不存在了,契約改釘 MapLibre 版:
// 每次呼叫都問 raw.project(),不快取 Point 或函式參考。
ck(/toScreen: ll => \{ const p = mlToLL\(ll\); const q = raw\.project\(\[p\.lng, p\.lat\]\); return \{ x: q\.x, y: q\.y \}; \}/.test(src),
  'G1c toScreen 每次呼叫走 raw.project(不快取函式參考)');
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
  // M4-B:原本拿「// 縮放動畫逐幀驅動」這條註解當結束邊界,那段隨 Leaflet 一起拔掉了。
  // 改用一個刻意放在那裡的具名標記,不會再因為刪改鄰近註解而靜默失效(indexOf 回 -1 ⇒ body='' ⇒ 恆綠)。
  const reprojectEnd = text.indexOf('// ==== REPROJECT END ====', reprojectStart);
  const body = reprojectStart >= 0 && reprojectEnd > reprojectStart ? text.slice(reprojectStart, reprojectEnd) : '';
  const renderWires = (text.match(/M\.on\('render', syncDrawMaplibre\)/g) || []).length;
  return {
    reprojectPure: body.includes('M.getSize()') && body.includes('M.toScreen(')
      && !/M\.(?:leaflet|raw|_[A-Za-z])\b|window\.__map/.test(body),
    renderWires,
    // 09-04 起 render 接線多記 GL 剛畫的相機簽名(state._glKey/_glAt),tick 用它決定「GL 還沒畫到這個相機就不畫」(兩層同幀落地)
    renderBody: text.includes("const syncDrawMaplibre = () => { state._glKey = camKey(); state._glAt = performance.now(); reproject(); syncDraw(); };"),
    // M4-B:原本是【正向】釘住 Leaflet-only 的 zoomanim 區塊必須存在。Leaflet 拔掉後改成【反向】——
    // 縮放動畫仿射整套(zoomanim 事件、_endZoomAnim)是 Leaflet 專屬,MapLibre 每幀真實更新相機,
    // 這些東西再冒出來就是有人把舊路徑併回來了。
    noZoomAnim: !/M\.on\('zoomanim'|_endZoomAnim|_animatingZoom/.test(text),
  };
}
const overlayContract = overlayRuntimeContract(src);
ck(overlayContract.reprojectPure && overlayContract.renderWires === 1 && overlayContract.renderBody && overlayContract.noZoomAnim,
  'G8 overlay runtime：reproject 引擎中立、MapLibre render 接線唯一、Leaflet zoomanim 整套已不存在', JSON.stringify(overlayContract));
const overlayMutated = overlayRuntimeContract(src.replace("M.on('render', syncDrawMaplibre);", ''));
ck(overlayMutated.renderWires === overlayContract.renderWires - 1 && overlayMutated.renderWires === 0,
  'G8b 正向對照:移除 MapLibre render 接線後契約必少 1');

// ── G9 靜態:index.html 零 Leaflet 殘留(M4-B)────────────────────────────────
// 這條刻意放在【靜態】半段:ship_web 的 preflight 只跑 ENGINE_GATE_STATIC_ONLY=1,動態的 G4h/G4i
// 在出貨鏈上碰不到。合併一條舊分支就把 Leaflet 帶回來、而 build 與其餘閘門全綠,是這個 repo 出過的事故。
const LEAFLET_CODE = [
  ['L.map( 建構', /\bL\.map\s*\(/],
  ['L.* 呼叫', /(?<![.\w$])L\.[A-Za-z_$][\w$]*\s*[({]/],
  ['createLeafletEngine', /createLeafletEngine/],
  ['M.leaflet', /M\.leaflet\b/],
  ['engine === \'leaflet\'', /engine\s*===\s*['"]leaflet['"]/],
  ['.leaflet- CSS/選取器', /\.leaflet-/],
  ['cdnjs leaflet', /cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet/],
  ['vendor/leaflet', /vendor\/leaflet/],
];
const leafletResidue = LEAFLET_CODE
  .map(([name, re]) => [name, (src.match(new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : ''))) || []).length])
  .filter(([, n]) => n > 0);
ck(leafletResidue.length === 0, 'G9 index.html 零 Leaflet 殘留',
  leafletResidue.length ? leafletResidue.map(([name, n]) => `${name}=${n}`).join(', ') : '八種形態各 0');
// 正向對照:這條是否定式判準,沒有對照就永遠是綠的。每一種形態各塞一個假樣本,必須全被抓到。
const RESIDUE_PROBES = ["L.map('x')", 'L.marker(1)', 'createLeafletEngine(1)', 'M.leaflet.foo',
  "engine === 'leaflet'", '.leaflet-pane{}', 'cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/x.js', 'vendor/leaflet/leaflet.js'];
const probed = RESIDUE_PROBES.map((probe, i) => new RegExp(LEAFLET_CODE[i][1].source).test(src + '\n' + probe));
ck(probed.every(Boolean), 'G9b 正向對照:八種 Leaflet 形態各塞一個樣本都要被抓到',
  probed.map((hit, i) => `${LEAFLET_CODE[i][0]}=${hit ? 'caught' : 'MISSED'}`).join(', '));

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
  const page = await ctx.newPage(), errs = [], reqs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && (u => u === '' || /index\.html/.test(u))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
  page.on('request', r => reqs.push(r.url()));
  await page.addInitScript(ls => { localStorage.setItem('trainmap-howto-seen', '1'); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, initLs);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state?.ready, null, { timeout: 60000 });
  return { ctx, page, errs, reqs };
}

// 期望的 Web Mercator 螢幕距離:z12 下 (25.0478,121.517)→(25.0578,121.527) 的像素距離。
// 這是【獨立真值來源】——用 Web Mercator 定義自己算,不拿另一個引擎的讀數當基準
// (M4-B 之前這條是拿 Leaflet 的量測值當 baseline;Leaflet 拔掉後那個基準就不存在了,而
//  「拿被驗實作自己的讀數當期望值」是零資訊的判準)。z0 世界=256px 的專案慣例。
function mercatorScreenDistance(a, b, zoom) {
  const S = 256 * 2 ** zoom;
  const x = lng => (lng + 180) / 360 * S;
  const y = lat => { const phi = lat * Math.PI / 180; return (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * S; };
  return Math.hypot(x(a[1]) - x(b[1]), y(a[0]) - y(b[0]));
}
const EXPECTED_D = mercatorScreenDistance([25.0478, 121.517], [25.0578, 121.527], 12);
// 期望的 getBoundsZoom:同樣自己從 Web Mercator 與【當下量到的容器尺寸】推導,不寫死像素常數。
function expectedBoundsZoom(sw, ne, size) {
  const dxNorm = Math.abs(ne[1] - sw[1]) / 360;
  const yNorm = lat => { const phi = lat * Math.PI / 180; return (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2; };
  const dyNorm = Math.abs(yNorm(ne[0]) - yNorm(sw[0]));
  return Math.floor(Math.log2(Math.min(size.x / dxNorm, size.y / dyNorm) / 256));
}

const MAPLIBRE_REASON = '此斷言直接讀 MapLibre style、canvas 或 raw map，是引擎專屬的內部契約';
const FLAG_REASON = '此斷言驗引擎旗標已退場（?engine=／localStorage 舊值都要被忽略），只在 maplibre pass 執行一次';
const NOLEAFLET_REASON = '此斷言證明頁面上完全沒有 Leaflet（M4-B 拔引擎的驗收），只在 maplibre pass 執行一次';
const browser = await chromium.launch();
let matrix;
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
          size: M.getSize(),
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
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6d zoom 尺度＝Web Mercator 解析值', engine === 'maplibre' ? Math.abs(ml.d - EXPECTED_D) <= 1.5 && ml.zoom === 12 && ml.center : undefined, { d: ml?.d, expected: EXPECTED_D, zoom: ml?.zoom });
    onlyFor('maplibre', MAPLIBRE_REASON, 'G6e getBoundsZoom 與容器尺寸推導值差 ≤1 級', engine === 'maplibre' ? Math.abs(ml.bz - expectedBoundsZoom([24.9, 121.4], [25.2, 121.7], ml.size)) <= 1 : undefined, { bz: ml?.bz, expected: ml && expectedBoundsZoom([24.9, 121.4], [25.2, 121.7], ml.size), size: ml?.size });
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

    // M4-B(2026-09-05)起引擎旗標退場:?engine= 與 localStorage 'trainmap-engine' 都不再被讀。
    // 這幾條守的是「觀察期用過逃生口的人不會壞掉」——他們的瀏覽器裡還留著 trainmap-engine='leaflet',
    // 也可能有人把 ?engine=leaflet 的網址存成書籤。舊值一律忽略、落到 maplibre、且不得有 pageerror。
    let stale, staleUrl, invalidFlag, bareFlag, noLeaflet, cdnjsReqs;
    if (engine === 'maplibre') {
      // G4d 舊 localStorage 值
      const legacyLs = await boot(browser, BASE, { 'trainmap-engine': 'leaflet' });
      stale = { flag: await legacyLs.page.evaluate(() => window.__ENGINE), errs: legacyLs.errs };
      await legacyLs.ctx.close();
      // G4e 舊書籤網址 ?engine=leaflet（＋同時留著舊 localStorage）
      const legacyUrl = new URL(BASE); legacyUrl.searchParams.set('engine', 'leaflet');
      const legacy = await boot(browser, legacyUrl.href, { 'trainmap-engine': 'leaflet' });
      staleUrl = { flag: await legacy.page.evaluate(() => window.__ENGINE), errs: legacy.errs };
      await legacy.ctx.close();
      // G4f 非法值
      const invalidUrl = new URL(BASE); invalidUrl.searchParams.set('engine', 'foo');
      const invalid = await boot(browser, invalidUrl.href);
      invalidFlag = await invalid.page.evaluate(() => window.__ENGINE);
      await invalid.ctx.close();
      // G4g 裸網址 ＋ G4h 頁面零 Leaflet ＋ G4i 零 cdnjs leaflet 請求
      const bare = await boot(browser, BASE);
      bareFlag = await bare.page.evaluate(() => window.__ENGINE);
      noLeaflet = await bare.page.evaluate(() => ({
        noGlobalL: typeof L === 'undefined',
        noPane: document.querySelector('.leaflet-pane') === null,
        noContainer: document.querySelector('.leaflet-container') === null,
        leafletNull: !window.__M.leaflet,
        // 正向對照:同一把尺量得到真的存在的 MapLibre DOM,證明選取器本身不是恆 null
        seesMaplibrePane: document.querySelector('.maplibregl-canvas') !== null,
      }));
      cdnjsReqs = bare.reqs.filter(u => /cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet|\bleaflet(\.min)?\.(js|css)\b/i.test(u));
      await bare.ctx.close();
    }
    onlyFor('maplibre', FLAG_REASON, 'G4d 舊 localStorage trainmap-engine=leaflet 被忽略且零 pageerror', engine === 'maplibre' ? stale.flag === 'maplibre' && stale.errs.length === 0 : undefined, stale);
    onlyFor('maplibre', FLAG_REASON, 'G4e 舊書籤 ?engine=leaflet 被忽略且零 pageerror', engine === 'maplibre' ? staleUrl.flag === 'maplibre' && staleUrl.errs.length === 0 : undefined, staleUrl);
    onlyFor('maplibre', FLAG_REASON, 'G4f 非法 engine 值退回預設 maplibre', engine === 'maplibre' ? invalidFlag === 'maplibre' : undefined, invalidFlag);
    onlyFor('maplibre', FLAG_REASON, 'G4g 裸網址（無 ?engine、localStorage 空）⇒ 預設 maplibre', engine === 'maplibre' ? bareFlag === 'maplibre' : undefined, bareFlag);
    onlyFor('maplibre', NOLEAFLET_REASON, 'G4h 頁面沒有 Leaflet：全域 L 未定義、無 .leaflet-pane/.leaflet-container、M.leaflet 為 falsy（正向對照:同一把尺看得到 .maplibregl-canvas）',
      engine === 'maplibre' ? noLeaflet.noGlobalL && noLeaflet.noPane && noLeaflet.noContainer && noLeaflet.leafletNull && noLeaflet.seesMaplibrePane : undefined, noLeaflet);
    onlyFor('maplibre', NOLEAFLET_REASON, 'G4i 開機零筆 Leaflet 資源請求（cdnjs 或任何 leaflet.js/css）',
      engine === 'maplibre' ? cdnjsReqs.length === 0 : undefined, cdnjsReqs);

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
