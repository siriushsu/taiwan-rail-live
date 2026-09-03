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
import sharp from 'sharp';
import { probeCentroids } from './probe_centroids.mjs';

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
  page.on('console', m => { if (m.type() === 'error' && (u => u === '' || /index\.html/.test(u))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
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
    const fw = await page.evaluate(() => {
      const M = window.__M, map = window.__map; const got = {};
      const oInv = map.invalidateSize, oSV = map.setView;
      map.invalidateSize = function (o) { got.resize = o; return oInv.call(this, o); };
      map.setView = function (c, z, o) { got.setView = o; return oSV.call(this, c, z, o); };
      M.resize({ animate: false, pan: false });
      M.setView([25.0, 121.5], 11, { animate: false });
      map.invalidateSize = oInv; map.setView = oSV;
      return got;
    });
    ck(!!fw.resize && fw.resize.animate === false && fw.resize.pan === false, 'G2g resize 的 options 逐字轉發到 invalidateSize', JSON.stringify(fw.resize));
    ck(!!fw.setView && fw.setView.animate === false, 'G2h setView 的 options 轉發到 Lmap.setView', JSON.stringify(fw.setView));
    ck(errs.length === 0, 'G2f 開機零 pageerror', errs.join(' | ').slice(0, 200));
    await ctx.close();
  }
  const probe = await (async () => { const b = await boot(browser, ''); await b.page.evaluate(() => { const s = document.createElement('script'); s.textContent = "console.error('G2i 探針')"; document.body.appendChild(s); }); await b.page.waitForTimeout(100); const n = b.errs.filter(e => e.includes('G2i 探針')).length; await b.ctx.close(); return n; })();
  ck(probe === 1, 'G2i 正向對照:頁面 console.error 會被 errs 收到', `n=${probe}`);
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
  // ── G6 MapLibre 引擎開機 ──
  if (await (async () => { const { ctx, page } = await boot(browser, ''); const v = await page.evaluate(() => typeof createMaplibreEngine === 'function'); await ctx.close(); return v; })()) {
    // 先量 Leaflet 引擎在 z12 下兩點的螢幕距離,當 zoom 尺度基準
    const lf = await boot(browser, '');
    const base = await lf.page.evaluate(() => {
      const M = window.__M; M.setView([25.0478, 121.517], 12, { animate: false });
      const a = M.toScreen([25.0478, 121.517]), b = M.toScreen([25.0578, 121.527]);
      return { d: Math.hypot(a.x - b.x, a.y - b.y), bz: M.getBoundsZoom(M.latLngBounds([24.9, 121.4], [25.2, 121.7]), false) };
    });
    await lf.ctx.close();
    const { ctx, page, errs } = await boot(browser, 'engine=maplibre');
    await page.waitForFunction(() => window.__M && window.__M.raw && window.__M.raw.isStyleLoaded && window.__M.raw.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const M = window.__M, ov = document.getElementById('overlay'), mp = document.getElementById('map');
      M.setView([25.0478, 121.517], 12, { animate: false });
      const a = M.toScreen([25.0478, 121.517]), b = M.toScreen([25.0578, 121.527]);
      const c = M.getCenter();
      return {
        engine: M.engine, isML: M.raw instanceof maplibregl.Map, leafletNull: M.leaflet === null,
        styleLoaded: M.raw.isStyleLoaded(), ready: !!window.__state.ready,
        ovW: ov.clientWidth, mpW: mp.clientWidth, ovH: ov.clientHeight, mpH: mp.clientHeight,
        d: Math.hypot(a.x - b.x, a.y - b.y), zoom: M.getZoom(),
        centerOk: Math.abs(c.lat - 25.0478) < 1e-6 && Math.abs(c.lng - 121.517) < 1e-6,
        bz: M.getBoundsZoom(M.latLngBounds([24.9, 121.4], [25.2, 121.7]), false),
        inBounds: M.getBounds().contains([25.0478, 121.517]),
        rt: M.raw.getBearing() === 0 && M.raw.getPitch() === 0,
        __map: window.__map === M.raw,
      };
    });
    ck(r.engine === 'maplibre' && r.isML && r.leafletNull && r.__map, 'G6a MapLibre 引擎生效(M.raw 是 maplibregl.Map、M.leaflet=null、__map=M.raw)', JSON.stringify(r).slice(0, 160));
    ck(r.styleLoaded && r.ready, 'G6b style 載入且 state.ready', `styleLoaded=${r.styleLoaded} ready=${r.ready}`);
    ck(r.ovW === r.mpW && r.ovH === r.mpH && r.ovW > 100, 'G6c #overlay 與 #map 同尺寸', `${r.ovW}x${r.ovH} vs ${r.mpW}x${r.mpH}`);
    ck(Math.abs(r.d - base.d) <= 1.5 && r.zoom === 12 && r.centerOk, 'G6d zoom 尺度與 Leaflet 一致(z12 兩點距離差 ≤1.5px)', `ml=${r.d.toFixed(2)} lf=${base.d.toFixed(2)} zoom=${r.zoom}`);
    ck(Math.abs(r.bz - base.bz) <= 1, 'G6e getBoundsZoom 與 Leaflet 差 ≤1 級', `ml=${r.bz} lf=${base.bz}`);
    ck(r.inBounds && r.rt, 'G6f getBounds 含中心;bearing/pitch 為 0(M0 不開旋轉)');
    ck(errs.length === 0, 'G6g MapLibre 開機零 pageerror', errs.join(' | ').slice(0, 300));
    const ad = await page.evaluate(async () => {
      const M = window.__M, raw = M.raw; const calls = [];
      M.onStyleLoad(() => calls.push((raw.getStyle().name || '') + '|' + raw.getStyle().layers.filter(l => !/^(offline-land|track-)/.test(l.id)).length)); // 量 style 身分(名稱+OFM 層數),不量 background:陸地層會把它重上色
      const immediate = calls.length;
      M.setStyleKind('dark');
      await new Promise(r => raw.once('style.load', r));
      await new Promise(r => setTimeout(r, 50));
      M.setStyleKind('foo'); const kindNoop = M.getStyleKind();
      M.setAttribution(['甲署名', '', '乙署名']);
      const box = document.querySelector('.maplibregl-ctrl-bottom-right');
      const kids = [...box.children].map(el => el.className);
      const text = (box.querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || '';
      const hooks = []; M.setTileRequestHook(u => hooks.push(u)); M.setTileRequestHook(null);
      return { immediate, calls, kindNoop, kids, text, hookOk: hooks.length === 0 };
    });
    ck(ad.immediate === 1 && ad.calls.length === 2 && ad.calls[1] !== ad.calls[0], 'G6h onStyleLoad:註冊當下呼叫一次、setStyleKind(dark) 後再一次且 style 身分變了', JSON.stringify(ad.calls));
    ck(ad.kindNoop === 'dark', 'G6i setStyleKind 未知 kind 且無 style 物件=no-op', ad.kindNoop);
    ck(ad.text.includes('甲署名') && ad.text.includes('乙署名') && ad.kids.length === 2 && /group/.test(ad.kids[0]) && /attrib/.test(ad.kids[1]) && ad.hookOk, 'G6j setAttribution 整份替換、空字串濾掉、DOM 仍是縮放鈕在前署名貼底(bottom 位置 addControl 是 prepend)', JSON.stringify(ad.kids) + ' ' + ad.text.slice(0, 40));
    // ── G7 對齊探針:洋紅(引擎)與青(overlay)圓心距離 ≤ 2px(桌面 dpr 1) ──
    // 探針座標刻意選在海上(25.20,121.80,基隆外海,無鐵路)而非 G6 用的台北車站:台北車站在 z13 會被 overlay 的
    // 路網/站名/車站牌壓在洋紅點上;圓擬合(probe_centroids.mjs)雖能容忍部分遮擋,判準的乾淨基準仍該是
    // 「兩顆探針完整可見」——與 verify_basemap_align.mjs 選中央山脈當探針點同一個理由。半徑明示為桌面 dpr 1 的值
    // (circle-radius 18css、ctx.arc 5css);真機錄影走 analyze_device_recording.mjs 以 --dpr 換算。
    const pr = await boot(browser, 'engine=maplibre&aligndot=25.20,121.80');
    await pr.page.waitForFunction(() => window.__ofmGl && window.__ofmGl.getLayer && window.__ofmGl.getLayer('aligndot'), null, { timeout: 30000 });
    await pr.page.evaluate(() => window.__M.setView([25.20, 121.80], 13, { animate: false }));
    await pr.page.waitForTimeout(1500);
    const png = await pr.page.screenshot({ type: 'png' });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const RADII = { magR: 18, cynR: 5 }; // 桌面 dpr 1
    const cen = probeCentroids(data, info.width, info.height, RADII);
    const dist = cen.mag && cen.cyn ? Math.hypot(cen.mag.x - cen.cyn.x, cen.mag.y - cen.cyn.y) : NaN;
    ck(cen.mag && cen.cyn && dist <= 2, 'G7 對齊探針洋紅/青圓心距離 ≤2px', `mag=${JSON.stringify(cen.mag)} cyn=${JSON.stringify(cen.cyn)} d=${dist.toFixed(2)}`);
    // 正向對照:把青點往右挪 30px 重畫一次,距離必須 ≥ 25(證明量得到錯位)
    await pr.page.evaluate(() => { const M = window.__M; const o = M.toScreen; M.toScreen = ll => { const p = o(ll); return { x: p.x + 30, y: p.y }; }; if (window.__state.ready) draw(); });
    await pr.page.waitForTimeout(300);
    const png2 = await pr.page.screenshot({ type: 'png' });
    const r2 = await sharp(png2).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cen2 = probeCentroids(r2.data, r2.info.width, r2.info.height, RADII);
    const dist2 = cen2.mag && cen2.cyn ? Math.hypot(cen2.mag.x - cen2.cyn.x, cen2.mag.y - cen2.cyn.y) : NaN;
    ck(dist2 >= 25, 'G7 正向對照:overlay 投影挪 30px 後量到 ≥25px', `d=${dist2.toFixed(2)}`);
    await pr.ctx.close();
    await ctx.close();
  } else console.log('  (尚無 createMaplibreEngine:G6 跳過)');
} finally {
  await browser.close(); server.close();
}
console.log(fails.length ? `\n${fails.length} 項未過:${fails.join(', ')}` : '\n全部通過');
process.exit(fails.length ? 1 : 0);
