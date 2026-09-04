#!/usr/bin/env node
// M1c：Marker、卡片穿透直接命中、MapLibre 家具與手機四寬守門人。
// 正常：node scripts/verify_m1c_overlay_controls.mjs
// 突變：MUT=marker|forward|controls node scripts/verify_m1c_overlay_controls.mjs（各自必須非 0）
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const SOURCE = readFileSync(INDEX, 'utf8');
const MUT = process.env.MUT || '';
const SCOPE = process.env.SCOPE || 'all';
const MUTS = new Set(['marker', 'forward', 'controls']);
if (MUT && !MUTS.has(MUT)) throw new Error(`未知 MUT=${MUT}`);
if (SCOPE !== 'all' && !MUTS.has(SCOPE)) throw new Error(`未知 SCOPE=${SCOPE}`);

const markerPredicate = src => (src.match(/new maplibregl\.Marker\s*\(/g) || []).length >= 3
  && src.includes("anchor: 'center', draggable: true")
  && src.includes("anchor: 'bottom'");
const forwardPredicate = src => src.includes("M.on('click', handleMapClick)")
  && src.includes('handleMapClick({ containerPoint: cp, latlng: M.fromScreen(cp) });')
  && !src.includes("M.fire('click', { containerPoint: cp, latlng: M.fromScreen(cp) });");
const controlsPredicate = src => src.includes("el.className = 'maplibregl-ctrl follow-lock-ctl'")
  && /\.leaflet-control-zoom\s*,\s*\n\s*\.maplibregl-ctrl-group \.maplibregl-ctrl-zoom-in\s*,\s*\n\s*\.maplibregl-ctrl-group \.maplibregl-ctrl-zoom-out\s*\{\s*display:\s*none;\s*\}/.test(src)
  && src.includes('body.cexp .maplibregl-ctrl-attrib');
const PREDICATES = { marker: markerPredicate, forward: forwardPredicate, controls: controlsPredicate };

let servedSource = SOURCE;
if (MUT === 'marker') servedSource = servedSource.replace('new maplibregl.Marker(', 'new maplibregl.Marker_DISABLED(');
if (MUT === 'forward') servedSource = servedSource.replace(
  'handleMapClick({ containerPoint: cp, latlng: M.fromScreen(cp) });',
  'void ({ containerPoint: cp, latlng: M.fromScreen(cp) }); // MUT forward');
if (MUT === 'controls') servedSource = servedSource.replace(
  '.maplibregl-ctrl-group .maplibregl-ctrl-zoom-out { display: none; }',
  '.maplibregl-ctrl-group .maplibregl-ctrl-zoom-out { display: block; } /* MUT controls */');
if (MUT && servedSource === SOURCE) throw new Error(`MUT=${MUT} 沒命中，拒絕空包彈`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const LEAFLET_JS = readFileSync(path.join(ROOT, 'app/node_modules/leaflet/dist/leaflet.js'));
const LEAFLET_CSS = readFileSync(path.join(ROOT, 'app/node_modules/leaflet/dist/leaflet.css'));
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const TILEJSON = JSON.stringify({ tilejson: '3.0.0', attribution: 'OpenFreeMap', minzoom: 0, maxzoom: 14,
  tiles: ['https://tiles.openfreemap.org/__m1c_empty/{z}/{x}/{y}.pbf'] });

const server = createServer((req, res) => {
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
const ORIGIN = `http://127.0.0.1:${server.address().port}/`;

async function prepareContext(browser, width, touch) {
  const context = await browser.newContext({
    viewport: { width, height: width === 768 ? 1024 : 844 },
    isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, locale: 'zh-TW',
  });
  await context.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.removeItem('trainmap-last-view');
    localStorage.removeItem('trainmap-user-data-v1');
  });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('leaflet.min.js'))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: LEAFLET_JS });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('leaflet.min.css'))
      return route.fulfill({ status: 200, contentType: 'text/css', body: LEAFLET_CSS });
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'tiles.openfreemap.org' && /\/planet\/?$/.test(u.pathname))
      return route.fulfill({ status: 200, contentType: 'application/json', body: TILEJSON });
    if (u.hostname === 'tiles.openfreemap.org' && /\/sprites\/.*\.json$/.test(u.pathname))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\.pbf(?:\?|$)/i.test(u.pathname))
      return route.fulfill({ status: 204, contentType: 'application/x-protobuf', body: '' });
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

async function desktopMarkers(browser, url, engine, check) {
  const context = await prepareContext(browser, 1280, false);
  const { page, errors } = await load(context, url);
  try {
    await page.evaluate(() => {
      const c = window.__M.getCenter();
      openPinAt(c.lat, c.lng);
    });
    const draft = await page.evaluate(expected => ({
      exists: !!document.querySelector('.pin-ico'),
      visible: !!pinDraft && !!pinDraft.marker,
      native: expected === 'maplibre' ? pinDraft?.marker instanceof maplibregl.Marker : pinDraft?.marker instanceof L.Marker,
      draggable: expected === 'maplibre' ? !!pinDraft?.marker?.isDraggable?.() : !!pinDraft?.marker?.dragging?.enabled?.(),
    }), engine);
    check(draft.exists && draft.visible && draft.native && draft.draggable, 'M17 草稿釘是該引擎原生可拖 Marker', draft);

    const before = await page.evaluate(() => ({ lat: pinDraft.lat, lon: pinDraft.lon }));
    const box = await page.locator('.pin-ico').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2 + 24, { steps: 5 }); await page.mouse.up();
    }
    const after = await page.evaluate(() => ({ lat: pinDraft.lat, lon: pinDraft.lon }));
    check(!!box && Number.isFinite(after.lat) && Number.isFinite(after.lon)
      && (after.lat !== before.lat || after.lon !== before.lon), 'M17 草稿釘真拖曳會更新有效座標', { before, after });

    await page.evaluate(() => {
      const c = window.__M.getCenter();
      closePinCard();
      userDataSaveCollection('pins', [{ lat: c.lat, lon: c.lng, label: 'T1' }]);
      renderSavedPins();
    });
    const saved = page.locator('.pin-saved');
    check(await saved.count() === 1, 'M17 收藏地點 Marker 出現');
    if (await saved.count()) await saved.click();
    check(await page.locator('#pinCard').isVisible(), 'M17 收藏地點 Marker 可點回地點卡');

    await page.evaluate(() => {
      closePinCard();
      const st = state.schedStations.find(item => Number.isFinite(item.lat) && Number.isFinite(item.lon));
      window.__m1cFavStation = st;
      userDataSaveCollection('stations', [{ sys: st.sys, name: st.name, lat: st.lat, lon: st.lon, group: state.group }]);
      renderFavStationMarkers();
      window.__M.setView([st.lat, st.lon], Math.max(window.__M.getZoom(), 13), { animate: false });
    });
    const star = page.locator('.favst-ico');
    check(await star.count() === 1, 'M17 收藏車站 Marker 出現');
    if (await star.count()) await star.click();
    check(await page.locator('#board').isVisible(), 'M17 收藏車站 Marker 可點開看板');

    if (SCOPE === 'marker') {
      check(errors.length === 0, '桌面 Marker 情境零 pageerror', errors.slice(0, 5));
      return;
    }

    await page.evaluate(() => {
      closeBoard();
      favStMarks.forEach(marker => marker.remove()); favStMarks = [];
      const st = window.__m1cFavStation;
      window.__M.setView([st.lat, st.lon], Math.max(window.__M.getZoom(), 14), { animate: false });
      const p = window.__M.toScreen([st.lat, st.lon]);
      const card = document.getElementById('xingCard');
      card.hidden = false;
      card.innerHTML = '<div id="m1cForwardTarget" style="width:100%;height:100%"></div>';
      Object.assign(card.style, { position: 'absolute', left: `${p.x - 24}px`, top: `${p.y - 24}px`, right: 'auto', width: '48px', height: '48px', padding: '0', zIndex: '2000' });
    });
    await page.evaluate(() => {
      // 這格驗的是 xingCard 是否直接轉交同一個 handleMapClick，不是列車／平交道的
      // 命中優先序。即時畫面可能剛好有車壓在測試站上；而 draw() 每幀會重建 hit cache，
      // 所以清空與 DOM click 必須在同一個 event loop，否則 Playwright click 前又會被補回。
      state._trainHits = [];
      state._crossHits = [];
      state._sugarHits = [];
      state.deco = false;
      const target = document.getElementById('m1cForwardTarget'), b = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2,
      }));
    });
    check(await page.evaluate(() => !!state.boardStation), 'M29 平交道卡穿透直接走共用命中函式');
    check(errors.length === 0, '桌面 Marker／穿透情境零 pageerror', errors.slice(0, 5));
  } catch (error) {
    check(false, '桌面 Marker／穿透情境完整執行', String(error && error.stack || error));
  } finally { await context.close(); }
}

async function controlAudit(page) {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll('#map button,.maplibregl-ctrl-bottom-right button,.maplibregl-ctrl-bottom-right a,.leaflet-bottom.leaflet-right button,.leaflet-bottom.leaflet-right a')];
    const visible = candidates.filter(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 3 && r.height > 3 && s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none' && Number(s.opacity) > .05;
    });
    const blocked = [], overlaps = [];
    for (const el of visible) {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) blocked.push(el.id || el.getAttribute('aria-label') || el.textContent.trim());
    }
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j]; if (a.contains(b) || b.contains(a)) continue;
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      if (Math.min(x.right, y.right) > Math.max(x.left, y.left) && Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top))
        overlaps.push(`${a.id || a.getAttribute('aria-label')}↔${b.id || b.getAttribute('aria-label')}`);
    }
    const attribution = document.querySelector('.leaflet-control-attribution,.maplibregl-ctrl-attrib');
    const ar = attribution?.getBoundingClientRect();
    return { blocked, overlaps, attributionVisible: !!ar && ar.width > 0 && ar.height > 0,
      zoomVisible: [...document.querySelectorAll('.leaflet-control-zoom,.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out')].some(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0),
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
  });
}

async function mobileControls(browser, url, engine, browserName, width, check) {
  const context = await prepareContext(browser, width, true);
  const { page, errors } = await load(context, url);
  try {
    const audit = await controlAudit(page);
    check(!audit.blocked.length && !audit.overlaps.length && audit.attributionVisible && !audit.zoomVisible && audit.overflow <= 1,
      `${browserName}/${width} 家具可達、不重疊、署名可見且手機縮放鈕隱藏`, audit);
    await page.tap('#randBtn');
    await page.waitForFunction(() => !!(state.followTrain || state.freqFollow));
    const lock = page.locator('#followLockBtn');
    check(await lock.count() === 1 && await lock.isVisible(), `${browserName}/${width} 跟隨鎖可見`);
    const before = await page.evaluate(() => state.followLock);
    if (await lock.count()) await page.tap('#followLockBtn');
    const after = await page.evaluate(() => state.followLock);
    check(before !== after, `${browserName}/${width} page.tap 跟隨鎖改變狀態`, { before, after, engine });
    await page.tap('#tabMore');
    check(await page.evaluate(() => document.body.classList.contains('tools-open')), `${browserName}/${width} page.tap 更多 sheet 改變狀態`);
    check(errors.length === 0, `${browserName}/${width} 零 pageerror`, errors.slice(0, 5));
  } catch (error) {
    check(false, `${browserName}/${width} mobile 情境完整執行`, String(error && error.stack || error));
  } finally { await context.close(); }
}

let matrix;
try {
  matrix = await runEngineMatrix(async ({ engine, engineUrl, check }) => {
    for (const [name, predicate] of Object.entries(PREDICATES)) {
      if (SCOPE !== 'all' && SCOPE !== name) continue;
      check(predicate(SOURCE), `G0 ${name} 產品契約已落地`);
      if (predicate(SOURCE)) {
        let mutant = SOURCE;
        if (name === 'marker') mutant = mutant.replace('new maplibregl.Marker(', 'new maplibregl.Marker_DISABLED(');
        if (name === 'forward') mutant = mutant.replace('handleMapClick({ containerPoint: cp, latlng: M.fromScreen(cp) });', 'void 0;');
        if (name === 'controls') mutant = mutant.replace('.maplibregl-ctrl-group .maplibregl-ctrl-zoom-out { display: none; }', '.maplibregl-ctrl-group .maplibregl-ctrl-zoom-out { display: block; }');
        check(!predicate(mutant), `G0 ${name} 記憶體突變會令同一判準轉紅`);
      }
    }
    if (MUT) check(!PREDICATES[MUT](servedSource), `G0 MUT=${MUT} 確實破壞指名契約`);

    const url = engineUrl(ORIGIN, { lang: 'zh-TW', geomock: '25.0478,121.5170', geodelay: 0, geoacc: 20 });
    if (SCOPE === 'all' || SCOPE === 'marker' || SCOPE === 'forward') {
      const desktop = await chromium.launch();
      try { await desktopMarkers(desktop, url, engine, check); } finally { await desktop.close(); }
    }

    if (SCOPE === 'all' || SCOPE === 'controls') for (const [browserName, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
      const browser = await launcher.launch();
      try {
        for (const width of [360, 375, 414, 768]) await mobileControls(browser, url, engine, browserName, width, check);
      } finally { await browser.close(); }
    }
  });
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(matrix?.passed ? '\nM1c overlay/controls 全部通過' : `\nM1c overlay/controls ${matrix?.failures.length || 1} 項未過`);
process.exit(matrix?.passed ? 0 : 1);
