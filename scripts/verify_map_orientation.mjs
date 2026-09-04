#!/usr/bin/env node
// M2/M3：MapLibre 旋轉、傾斜、指南針、3D 建築與 heading-up 守門人。
// 範圍：SCOPE=m2|m3|all；靜態紅基線：STATIC_ONLY=1。
// 突變：MUT=adapter|gestures|compass|buildings|heading（各自必須非 0）。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const SOURCE = readFileSync(INDEX, 'utf8');
const SCOPE = process.env.SCOPE || 'all';
const MUT = process.env.MUT || '';
const STATIC_ONLY = process.env.STATIC_ONLY === '1';
const MUTS = new Set(['adapter', 'gestures', 'compass', 'buildings', 'heading']);
const SCOPES = new Set(['m2', 'm3', 'all', ...MUTS]);
if (!SCOPES.has(SCOPE)) throw new Error(`未知 SCOPE=${SCOPE}`);
if (MUT && !MUTS.has(MUT)) throw new Error(`未知 MUT=${MUT}`);

const predicates = {
  adapter: src => src.includes('getBearing: () => raw.getBearing()')
    && src.includes('getPitch: () => raw.getPitch()')
    && src.includes('setBearing: bearing =>')
    && src.includes('setPitch: pitch =>')
    && src.includes('resetNorth: o =>')
    && src.includes('getBearing: () => 0')
    && src.includes('getPitch: () => 0'),
  gestures: src => src.includes('dragRotate: true')
    && src.includes('pitchWithRotate: true')
    && src.includes('touchPitch: true')
    && src.includes('maxPitch: 60')
    && (src.match(/raw\.touchZoomRotate\.enableRotation\(\)/g) || []).length >= 2,
  compass: src => src.includes('showCompass: true')
    && src.includes('visualizePitch: true')
    && src.includes("classList.toggle('map-orient-active'")
    && src.includes('.maplibregl-ctrl-group .maplibregl-ctrl-zoom-in,')
    && src.includes('.maplibregl-ctrl-group .maplibregl-ctrl-zoom-out { display: none; }'),
  buildings: src => src.includes("id: 'building-3d'")
    && src.includes("type: 'fill-extrusion'")
    && src.includes("'source-layer': 'building'")
    && src.includes("const MAP3D_PREF_KEY = 'trainmap-map-3d'")
    && src.includes('function setMap3d(on)')
    && src.includes('M.onStyleLoad(installBuilding3d);'),
  heading: src => src.includes('function initialBearing(a, b)')
    && src.includes('function followHeadingFor(')
    && src.includes('function applyFollowHeading(')
    && src.includes('resetFollowHeading(')
    && src.includes('state.ambient ? 0 : heading')
    && src.includes('applyFollowHeading(followHeadingFor(tr, headingBefore, headingAfter));')
    && (src.match(/applyFreqFollowHeading\(/g) || []).length >= 4,
};
const predicateScope = name => SCOPE === 'all'
  || SCOPE === name
  || (SCOPE === 'm2' && name !== 'heading')
  || (SCOPE === 'm3' && name === 'heading');

function mutateSource(src, name) {
  const anchors = {
    adapter: ['getBearing: () => raw.getBearing()', 'getBearing: () => 0 /* MUT adapter */'],
    gestures: ['raw.touchZoomRotate.enableRotation()', 'raw.touchZoomRotate.disableRotation() /* MUT gestures */'],
    compass: ['showCompass: true', 'showCompass: false /* MUT compass */'],
    buildings: ["id: 'building-3d'", "id: 'building-3d-disabled' /* MUT buildings */"],
    heading: ['function initialBearing(a, b)', 'function initialBearing_DISABLED(a, b) /* MUT heading */'],
  };
  const [from, to] = anchors[name];
  const out = src.replace(from, to);
  if (out === src) throw new Error(`MUT=${name} 沒命中，拒絕空包彈`);
  return out;
}
const servedSource = MUT ? mutateSource(SOURCE, MUT) : SOURCE;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};
// M4-B(2026-09-05)：index.html 不再載 Leaflet，原本供本機 leaflet.js/css 給 cdnjs 網址的
// 讀檔與路由已移除（那份 readFileSync 在 app/node_modules 重裝後會讓腳本在載入時就爆）。
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const TILEJSON = JSON.stringify({
  tilejson: '3.0.0', attribution: 'OpenFreeMap', minzoom: 0, maxzoom: 14,
  tiles: ['https://tiles.openfreemap.org/__orientation_empty/{z}/{x}/{y}.pbf'],
});

let server = null;
let origin = '';
if (!STATIC_ONLY) {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://local.test');
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = url.pathname === '/api/basemap-token' ? 200 : 404;
      res.setHeader('content-type', 'application/json');
      return res.end(url.pathname === '/api/basemap-token' ? '{"esri":"T1"}' : '{"error":"stubbed"}');
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!path.resolve(file).startsWith(ROOT) || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(file === INDEX ? servedSource.replace(/\s+integrity="[^"]+"/g, '') : readFileSync(file));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}/`;
}

async function prepareContext(browser, width = 1280, touch = false) {
  const context = await browser.newContext({
    viewport: { width, height: width === 768 ? 1024 : 800 },
    isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, locale: 'zh-TW',
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-appearance', 'light');
      localStorage.removeItem('trainmap-last-view');
      if (!sessionStorage.getItem('__orientation_init')) {
        localStorage.removeItem('trainmap-map-3d');
        localStorage.removeItem('trainmap-map-pitch');
        sessionStorage.setItem('__orientation_init', '1');
      }
    } catch (error) {}
  });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'tiles.openfreemap.org' && /\/planet\/?$/.test(u.pathname))
      return route.fulfill({ status: 200, contentType: 'application/json', body: TILEJSON });
    if (u.hostname === 'tiles.openfreemap.org' && /\/sprites\/.*\.json$/.test(u.pathname))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\.pbf(?:\?|$)/i.test(u.pathname))
      return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
    if (/\.(?:png|jpg|jpeg|webp)(?:\?|$)/i.test(u.pathname) || /\/tile\//.test(u.pathname))
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG1 });
    return route.abort();
  });
  return context;
}

async function load(context, url) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error && error.message || error)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__state?.ready && window.__M, null, { timeout: 90_000 });
  return { page, errors };
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function colorBlob(data, width, height, channels, test) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    if (!test(data[i], data[i + 1], data[i + 2])) continue;
    n++; sx += x; sy += y;
  }
  return n ? { n, x: sx / n, y: sy / n } : null;
}

async function alignmentAtOrientation(page) {
  await page.evaluate(() => {
    const p = window.__alignDot;
    window.__M.setView([p.lat, p.lng], 13, { animate: false, bearing: 41, pitch: 32 });
    draw();
  });
  await settle(page);
  const { data, info } = await sharp(await page.screenshot({ type: 'png' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mag = colorBlob(data, info.width, info.height, info.channels, (r, g, b) => r > 200 && g < 70 && b > 200);
  const cyan = colorBlob(data, info.width, info.height, info.channels, (r, g, b) => r < 70 && g > 200 && b > 200);
  return { mag, cyan, distance: mag && cyan ? Math.hypot(mag.x - cyan.x, mag.y - cyan.y) : Infinity };
}

async function desktopM2(browser, url, engine, browserName, check, onlyFor) {
  const context = await prepareContext(browser);
  const { page, errors } = await load(context, url);
  try {
    const initial = await page.evaluate(() => ({ bearing: __M.getBearing(), pitch: __M.getPitch() }));
    check(Math.abs(initial.bearing) < 0.01 && Math.abs(initial.pitch) < 0.01, `${browserName} 初始北向且無俯角`, initial);
    const moved = await page.evaluate(() => {
      __M.setBearing(37).setPitch(25);
      const raw = __M.raw;
      return {
        bearing: __M.getBearing(), pitch: __M.getPitch(),
        dragRotate: raw.dragRotate?.isEnabled?.(), touch: raw.touchZoomRotate?.isEnabled?.(),
        compass: !!document.querySelector('.maplibregl-ctrl-compass'),
        orientClass: raw.getContainer().classList.contains('map-orient-active'),
        overlayTransform: getComputedStyle(document.getElementById('overlay')).transform,
      };
    });
    check(Math.abs(moved.bearing - 37) < 0.1 && Math.abs(moved.pitch - 25) < 0.1 && moved.dragRotate && moved.touch,
      `${browserName} MapLibre bearing/pitch 原語與手勢開啟`, moved);
    check(moved.compass && moved.orientClass && moved.overlayTransform === 'none',
      `${browserName} 指南針現形且 overlay 文字層不跟著旋轉`, moved);
    await page.locator('.maplibregl-ctrl-compass').click();
    await page.waitForFunction(() => Math.abs(__M.getBearing()) < 0.01 && Math.abs(__M.getPitch()) < 0.01
      && !__M.raw.getContainer().classList.contains('map-orient-active'));
    const reset = await page.evaluate(() => ({ bearing: __M.getBearing(), pitch: __M.getPitch(), orientClass: __M.raw.getContainer().classList.contains('map-orient-active') }));
    check(!reset.orientClass, `${browserName} 真點指南針回北且回水平`, reset);

    await page.evaluate(() => document.getElementById('map3dBtn').click());
    await page.waitForFunction(() => __state.map3d && __M.raw.getLayer('building-3d') && __M.raw.getLayer('track-stations'));
    const on3d = await page.evaluate(() => ({
      on: __state.map3d,
      visibility: __M.raw.getLayoutProperty('building-3d', 'visibility'),
      stored: localStorage.getItem('trainmap-map-3d'),
      before: (() => {
        const layers = __M.raw.getStyle().layers;
        const b = layers.findIndex(x => x.id === 'building-3d');
        const s = layers.findIndex(x => x.type === 'symbol');
        const tracks = layers.map((x, i) => x.id.startsWith('track-') ? i : -1).filter(i => i >= 0);
        return { building: b, symbol: s, firstTrack: Math.min(...tracks), lastTrack: Math.max(...tracks) };
      })(),
      pitch: __M.getPitch(),
    }));
    check(on3d.on && on3d.visibility === 'visible' && on3d.stored === '1' && on3d.before.building >= 0
      && on3d.before.firstTrack >= 0 && on3d.before.building < on3d.before.firstTrack
      && (on3d.before.symbol < 0 || on3d.before.lastTrack < on3d.before.symbol) && Math.abs(on3d.pitch) < 0.1,
      `${browserName} 3D 建築可切、記憶、位於 GL 軌道下且軌道仍在 symbol 下，不自動傾斜`, on3d);
    const styleReload = await page.evaluate(async () => {
      const loaded = new Promise(resolve => __M.raw.once('style.load', resolve));
      __M.setStyleKind('dark'); await loaded;
      return { layer: !!__M.raw.getLayer('building-3d'), visibility: __M.raw.getLayoutProperty('building-3d', 'visibility') };
    });
    check(styleReload.layer && styleReload.visibility === 'visible', `${browserName} style reload 冪等重掛 3D 建築`, styleReload);
    await page.evaluate(() => setMap3d(false));
    check(await page.evaluate(() => __M.raw.getLayoutProperty('building-3d', 'visibility') === 'none' && localStorage.getItem('trainmap-map-3d') === '0'),
      `${browserName} 3D 建築可關閉且寫回偏好`);
    await page.evaluate(() => __M.setPitch(21));
    await page.waitForFunction(() => Math.abs(Number(localStorage.getItem('trainmap-map-pitch')) - 21) < 0.1);
    // boot 的 clearFollow 會清掉 query string；不帶 query 的 reload 只會吃預設引擎（M4-A 起是 maplibre），要驗哪個引擎就必須重走明示 ?engine= 的原 URL。
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => window.__state?.ready && window.__M && Math.abs(window.__M.getPitch() - 21) < 0.1, null, { timeout: 90_000 });
    check(await page.evaluate(() => Math.abs(__M.getPitch() - 21) < 0.1 && !__state.map3d),
      `${browserName} 使用者 pitch 跨重載保留，3D 偏好各自獨立`);

    if (browserName === 'Chromium') {
      const aligned = await alignmentAtOrientation(page);
      onlyFor('maplibre', 'Chromium 最終合成截圖可穩定取得 GL 與 2D canvas 像素',
        'bearing/pitch 下 GL 與 overlay 形心差不超過 2 CSS px', aligned.distance <= 2, aligned);
    } else {
      const structural = await page.evaluate(() => {
        const p = __alignDot, screen = __M.toScreen([p.lat, p.lng]);
        return { layer: !!__M.raw.getLayer('aligndot'), x: screen.x, y: screen.y, bearing: __M.getBearing(), pitch: __M.getPitch() };
      });
      onlyFor('maplibre', 'headless WebKit 已知無法從最終截圖穩定取得 GL 洋紅探針；真機由螢幕錄影分析保護',
        'WebKit bearing/pitch 投影與 GL layer 結構仍在', structural.layer && Number.isFinite(structural.x) && Number.isFinite(structural.y), structural);
    }
    check(errors.length === 0, `${browserName} MapLibre M2 零 pageerror`, errors.slice(0, 5));
  } catch (error) {
    check(false, `${browserName} M2 桌面情境完整執行`, String(error && error.stack || error));
  } finally { await context.close(); }
}

async function mobileM2(browser, url, engine, browserName, width, check) {
  const context = await prepareContext(browser, width, true);
  const { page, errors } = await load(context, url);
  try {
    await page.evaluate(() => __M.setBearing(29).setPitch(18));
    const compass = page.locator('.maplibregl-ctrl-compass');
    check(await compass.isVisible(), `${browserName}/${width} 旋轉後指南針可見`);
    const cr = await compass.boundingBox();
    const hit = cr && await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!el?.closest('.maplibregl-ctrl-compass');
    }, { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 });
    check(!!hit, `${browserName}/${width} 指南針 elementFromPoint 真正可達`);
    await compass.tap();
    await page.waitForFunction(() => Math.abs(__M.getBearing()) < 0.01 && Math.abs(__M.getPitch()) < 0.01
      && !__M.raw.getContainer().classList.contains('map-orient-active'));
    await page.tap('#tabMore');
    const row = page.locator('#map3dRow');
    check(await row.isVisible(), `${browserName}/${width} 更多 sheet 的 3D 列可見`);
    const rr = await row.boundingBox();
    const rowHit = rr && await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#map3dRow'), { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 });
    check(!!rowHit, `${browserName}/${width} 3D 列 elementFromPoint 真正可達`);
    await row.tap();
    check(await page.evaluate(() => __state.map3d && __M.raw.getLayoutProperty('building-3d', 'visibility') === 'visible'),
      `${browserName}/${width} page.tap 真正切換 3D 狀態`);
    const layout = await page.evaluate(() => ({
      zoomButtons: [...document.querySelectorAll('.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out')].filter(el => getComputedStyle(el).display !== 'none').length,
      compass: !!document.querySelector('.maplibregl-ctrl-compass'),
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    }));
    check(layout.zoomButtons === 0 && layout.compass && layout.overflow <= 1,
      `${browserName}/${width} 手機只藏 zoom 鈕、保留 compass 且無水平溢出`, layout);
    check(errors.length === 0, `${browserName}/${width} M2 零 pageerror`, errors.slice(0, 5));
  } catch (error) {
    check(false, `${browserName}/${width} M2 手機情境完整執行`, String(error && error.stack || error));
  } finally { await context.close(); }
}

async function m3Scenario(browser, url, engine, browserName, check) {
  const context = await prepareContext(browser);
  const { page, errors } = await load(context, url);
  try {
    const math = await page.evaluate(() => ({
      east: initialBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }),
      west: initialBearing({ lat: 0, lng: 1 }, { lat: 0, lng: 0 }),
      north: initialBearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }),
      south: initialBearing({ lat: 1, lng: 0 }, { lat: 0, lng: 0 }),
    }));
    check(Math.abs(math.east - 90) < 0.1 && Math.abs(math.west + 90) < 0.1
      && Math.abs(math.north) < 0.1 && Math.abs(Math.abs(math.south) - 180) < 0.1,
      `${browserName} heading 純函式四向正確`, math);
    const result = await page.evaluate(async expected => {
      const p0 = __M.getPitch();
      applyFollowHeading(73, { immediate: true });
      const during = { bearing: __M.getBearing(), pitch: __M.getPitch() };
      resetFollowHeading({ immediate: true });
      return { expected, p0, during, after: { bearing: __M.getBearing(), pitch: __M.getPitch() } };
    }, engine);
    if (engine === 'maplibre') {
      check(Math.abs(result.during.bearing - 73) < 0.1 && Math.abs(result.during.pitch - result.p0) < 0.1
        && Math.abs(result.after.bearing) < 0.1 && Math.abs(result.after.pitch - result.p0) < 0.1,
        `${browserName} heading-up 只改 bearing，退出回北且不改 pitch`, result);
    }
    const actual = await page.evaluate(() => {
      const candidate = (state.trains || []).map(tr => {
        const a = trainPos(tr, state.simSec - 5), b = trainPos(tr, state.simSec + 5);
        return { tr, a, b, heading: a && b ? initialBearing(a, b) : null };
      }).find(item => Number.isFinite(item.heading) && Math.abs(item.heading) > 15);
      if (!candidate) return null;
      __M.setPitch(23);
      setFollow(candidate.tr, false, true);
      for (let i = 0; i < 28; i++) updateFollowCamera();
      const following = { expected: candidate.heading, bearing: __M.getBearing(), pitch: __M.getPitch() };
      clearFollow();
      return new Promise(resolve => setTimeout(() => resolve({ following, after: { bearing: __M.getBearing(), pitch: __M.getPitch() } }), 350));
    });
    check(!!actual, `${browserName} 找得到實際行駛中的 sched 雙點樣本`);
    if (actual && engine === 'maplibre') {
      const delta = Math.abs(((actual.following.bearing - actual.following.expected + 540) % 360) - 180);
      check(delta < 1 && Math.abs(actual.following.pitch - 23) < 0.1 && Math.abs(actual.after.bearing) < 0.1 && Math.abs(actual.after.pitch - 23) < 0.1,
        `${browserName} 實際 sched 跟車 heading-up，退出回北且 pitch 不變`, { ...actual, delta });
    }
    const metro = await page.evaluate(() => {
      let candidate = null;
      for (const ln of [...(state.lines || []), ...(state.decoLines || [])]) {
        if (!Array.isArray(ln._tt) || isTrtcBoardLine(ln)) continue;
        for (const tr of ln._tt) {
          for (let i = 1; i + 2 < tr.length; i += 2) {
            const testSec = tr[i] + 5;
            const info = freqTrainInfoAt(ln, tr, testSec);
            if (!info.pos || !info.nextName) continue;
            const before = freqTrainInfoAt(ln, tr, testSec - 5).pos;
            const after = freqTrainInfoAt(ln, tr, testSec + 5).pos;
            const heading = initialBearing(before, after);
            if (Number.isFinite(heading) && Math.abs(heading) > 15) { candidate = { ln, tr, heading, testSec }; break; }
          }
          if (candidate) break;
        }
        if (candidate) break;
      }
      if (!candidate) return null;
      const previousSec = state.simSec;
      state.simSec = candidate.testSec;
      __M.setPitch(19);
      if (!applyFreqFollow({ ln: candidate.ln, tr: candidate.tr })) { state.simSec = previousSec; return null; }
      for (let i = 0; i < 28; i++) updateFreqFollowCamera(false);
      const following = { expected: candidate.heading, bearing: __M.getBearing(), pitch: __M.getPitch(), line: candidate.ln.id };
      clearFreqFollow();
      state.simSec = previousSec;
      return new Promise(resolve => setTimeout(() => resolve({ following, after: { bearing: __M.getBearing(), pitch: __M.getPitch() } }), 350));
    });
    check(!!metro, `${browserName} 找得到實際行駛中的捷運／輕軌雙點樣本`);
    if (metro && engine === 'maplibre') {
      const delta = Math.abs(((metro.following.bearing - metro.following.expected + 540) % 360) - 180);
      check(delta < 1 && Math.abs(metro.following.pitch - 19) < 0.1 && Math.abs(metro.after.bearing) < 0.1 && Math.abs(metro.after.pitch - 19) < 0.1,
        `${browserName} 實際捷運／輕軌跟車 heading-up，退出回北且 pitch 不變`, { ...metro, delta });
    }
    const ambient = await page.evaluate(() => {
      __M.setPitch(17); __M.setBearing(55);
      state.ambient = true;
      applyFollowHeading(120, { immediate: true });
      const result = { bearing: __M.getBearing(), pitch: __M.getPitch() };
      state.ambient = false;
      resetFollowHeading({ immediate: true });
      return result;
    });
    check(Math.abs(ambient.bearing) < 0.1 && (engine !== 'maplibre' || Math.abs(ambient.pitch - 17) < 0.1),
      `${browserName} 放空模式固定正北且不改 pitch`, ambient);
    check(errors.length === 0, `${browserName} M3 零 pageerror`, errors.slice(0, 5));
  } catch (error) {
    check(false, `${browserName} M3 情境完整執行`, String(error && error.stack || error));
  } finally { await context.close(); }
}

let matrix;
try {
  matrix = await runEngineMatrix(async ({ engine, engineUrl, check, onlyFor }) => {
    for (const [name, predicate] of Object.entries(predicates)) {
      if (!predicateScope(name)) continue;
      check(predicate(SOURCE), `G0 ${name} 產品契約已落地`);
      if (predicate(SOURCE)) check(!predicate(mutateSource(SOURCE, name)), `G0 ${name} 記憶體突變會令同一判準轉紅`);
    }
    if (MUT && predicateScope(MUT)) check(!predicates[MUT](servedSource), `G0 MUT=${MUT} 確實破壞指名契約`);
    if (STATIC_ONLY) return;

    const url = engineUrl(origin, { lang: 'zh-TW', aligndot: '23.47,120.957', probe: 1 });
    if (SCOPE === 'all' || SCOPE === 'm2') for (const [browserName, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
      const browser = await launcher.launch();
      try {
        await desktopM2(browser, url, engine, browserName, check, onlyFor);
        for (const width of [360, 375, 414, 768]) await mobileM2(browser, url, engine, browserName, width, check);
      } finally { await browser.close(); }
    }
    if (SCOPE === 'all' || SCOPE === 'm3') for (const [browserName, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
      const browser = await launcher.launch();
      try { await m3Scenario(browser, url, engine, browserName, check); } finally { await browser.close(); }
    }
  });
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}

console.log(matrix?.passed ? '\nMap orientation 全部通過' : `\nMap orientation ${matrix?.failures.length || 1} 項未過`);
process.exit(matrix?.passed ? 0 : 1);
