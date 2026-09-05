#!/usr/bin/env node
// 跨層對齊 spike：地圖引擎畫洋紅點，overlay 走正式 M.toScreen 路徑畫青點；只量最終合成畫面。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ALIGN_PORT || 0);
let BASE = '';
const DOT = { lat: 23.47, lng: 120.957 };
const START_Z = 13;
const MUT_OFFSET = 30;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// M4-B(2026-09-05)：index.html 不再載 Leaflet，原本供本機 leaflet.js/css 給 cdnjs 網址的
// 讀檔與路由已移除（那份 readFileSync 在 app/node_modules 重裝後會讓腳本在載入時就爆）。
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const g0 = {
  aligndot: source.includes("q.get('aligndot')"),
  probe: source.includes("q.get('probe') === '1'"),
  glLayer: source.includes("id: 'aligndot'"),
  overlay: source.includes("ctx.fillStyle = '#00ffff'"),
};
if (!Object.values(g0).every(Boolean)) {
  console.error('G0 FAIL：root index.html 缺跨層探針契約 ' + JSON.stringify(g0));
  process.exit(1);
}
console.log(`[G0] root=${ROOT} 探針契約=${JSON.stringify(g0)}`);

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    if (url.pathname === '/api/basemap-token') return res.end(JSON.stringify({ esri: 'T1' }));
    if (url.pathname === '/api/basemap-session') return res.end(JSON.stringify({ sessionToken: 'S1', endTime: Date.now() + 3600000 }));
    return res.end('{}');
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!path.resolve(file).startsWith(ROOT) || !existsSync(file)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  if (path.extname(file) === '.html') return res.end(readFileSync(file, 'utf8').replace(/\s+integrity="[^"]+"/g, ''));
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
BASE = `http://127.0.0.1:${server.address().port}/index.html?lang=zh-TW`;

async function boot(launcher, url, { layerTimeout = 30000, allowLayerMissing = false } = {}) {
  const browser = await launcher.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  try {
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'tiles.openfreemap.org' && /\/planet\/?$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        tilejson: '3.0.0', attribution: 'OpenFreeMap', minzoom: 0, maxzoom: 14,
        tiles: ['https://tiles.openfreemap.org/__verify_empty/{z}/{x}/{y}.pbf'],
      }) });
    }
    if (u.hostname === 'tiles.openfreemap.org' && /\/sprites\/.*\.json$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (/\.(?:png|jpg|jpeg|webp)(?:\?|$)/i.test(u.pathname) || /\/tile\//.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG1 });
    }
    if (/\.pbf(?:\?|$)/i.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
    return route.abort();
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
  });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', error => errs.push(String(error && error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errs.push('console.error: ' + message.text().slice(0, 200));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state?.ready && window.__M && window.__alignDot, null, { timeout: 60000 });
  let layerReady = true;
  try {
    await page.waitForFunction(() => window.__ofmGl?.getLayer?.('aligndot'), null, { timeout: layerTimeout });
  } catch (error) {
    if (!allowLayerMissing) throw error;
    layerReady = false;
  }
  await page.evaluate(([lat, lng, zoom]) => window.__M.setView([lat, lng], zoom, { animate: false }), [DOT.lat, DOT.lng, START_Z]);
  await settle(page);
  return { browser, ctx, page, errs, layerReady };
  } catch (error) {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

// M4-B：原本有一條「Leaflet×WebKit 首次逾時就換 fresh browser 再試一次」的重試路徑，
// 那個組合已不存在（唯一引擎是 MapLibre，逾時就是逾時，不再吞第一次失敗）。
async function bootWithRetry(launcher, url, engine, browserName) {
  return boot(launcher, url, { layerTimeout: 30000 });
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    const gl = window.__ofmGl;
    if (gl?.loaded?.() && !gl?.isMoving?.()) return resolve();
    if (gl?.once) gl.once('idle', resolve);
    setTimeout(resolve, 6000);
  }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function blob(data, width, height, channels, test) {
  let n = 0, sx = 0, sy = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    if (!test(data[i], data[i + 1], data[i + 2])) continue;
    n++; sx += x; sy += y; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return n ? { n, cx: sx / n, cy: sy / n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}
const inside = (p, box) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
const intersects = (a, b) => Math.max(a.x0, b.x0) <= Math.min(a.x1, b.x1) && Math.max(a.y0, b.y0) <= Math.min(a.y1, b.y1);

async function keepVisible(page) {
  await page.evaluate(([lat, lng]) => {
    const M = window.__M, size = M.getSize(), p = M.toScreen([lat, lng]);
    if (p.x > 90 && p.y > 90 && p.x < size.x - 90 && p.y < size.y - 90) return;
    M.panBy([Math.round(p.x - (size.x * 0.5 + 57)), Math.round(p.y - (size.y * 0.5 - 43))], { animate: false });
  }, [DOT.lat, DOT.lng]);
}

async function applyMutation(page, mode) {
  if (mode === 'basemap') {
    await page.evaluate(offset => { window.__ofmGl.getCanvas().style.transform = `translateX(${offset}px)`; }, MUT_OFFSET);
  } else if (mode === 'overlay') {
    await page.evaluate(offset => {
      const M = window.__M;
      if (M.__alignMutated) return;
      const original = M.toScreen.bind(M);
      M.toScreen = value => { const p = original(value); return { x: p.x, y: p.y + offset }; };
      M.__alignMutated = true;
      draw();
    }, MUT_OFFSET);
  }
}

async function measure(page, id, action = null, mutate = '') {
  if (action) await page.evaluate(action);
  await keepVisible(page); await settle(page);
  if (mutate) { await applyMutation(page, mutate); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
  const { data, info } = await sharp(await page.screenshot({ type: 'png' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mag = blob(data, info.width, info.height, info.channels, (r, g, b) => r > 200 && g < 70 && b > 200);
  const cyan = blob(data, info.width, info.height, info.channels, (r, g, b) => r < 70 && g > 200 && b > 200);
  if (!mag || !cyan) return { id, pass: false, mag, cyan, detail: `探針缺失 mag=${mag?.n || 0} cyan=${cyan?.n || 0}` };
  const healthy = mag.w > cyan.w && mag.h > cyan.h && mag.n > cyan.n;
  const overlap = intersects(mag, cyan) && inside({ x: mag.cx, y: mag.cy }, cyan) && inside({ x: cyan.cx, y: cyan.cy }, mag);
  const separated = !intersects(mag, cyan);
  const pass = healthy && (mutate ? separated : overlap);
  return { id, pass, mag, cyan, overlap, separated, detail: `mag=${mag.n}@${mag.x0},${mag.y0}-${mag.x1},${mag.y1} cyan=${cyan.n}@${cyan.x0},${cyan.y0}-${cyan.x1},${cyan.y1} overlap=${overlap} separated=${separated}` };
}

async function renderedProbe(page) {
  return page.evaluate(([lng, lat]) => {
    const gl = window.__ofmGl;
    const point = gl.project([lng, lat]);
    const layer = !!gl.getLayer('aligndot');
    const data = gl.getStyle()?.sources?.aligndot?.data;
    const coordinates = data?.geometry?.coordinates;
    const sourceAt = Array.isArray(coordinates) && Math.abs(coordinates[0] - lng) < 1e-9 && Math.abs(coordinates[1] - lat) < 1e-9;
    const hits = layer ? gl.queryRenderedFeatures(point, { layers: ['aligndot'] }) : [];
    return { hit: hits.some(feature => feature.layer?.id === 'aligndot'), count: hits.length, layer, sourceAt, point: { x: point.x, y: point.y } };
  }, [DOT.lng, DOT.lat]);
}

async function renderedMutationProbe(page) {
  return page.evaluate(async ([lng, lat]) => {
    const gl = window.__ofmGl, source = gl.getSource('aligndot');
    const original = gl.project([lng, lat]);
    source.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng + 1, lat] } });
    await new Promise(resolve => { gl.once('render', resolve); gl.triggerRepaint(); setTimeout(resolve, 3000); });
    const hits = gl.queryRenderedFeatures(original, { layers: ['aligndot'] });
    return { absent: !hits.some(feature => feature.layer?.id === 'aligndot'), count: hits.length, point: { x: original.x, y: original.y } };
  }, [DOT.lng, DOT.lat]);
}

async function canvasMagenta(page) {
  const shot = await page.locator('.maplibregl-canvas').screenshot({ type: 'png' });
  const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return blob(data, info.width, info.height, info.channels, (r, g, b) => r > 200 && g < 70 && b > 200);
}

function namedSkip(label, reason, detail = '') {
  console.log(`SKIP ${label} — ${reason}${detail ? `；${detail}` : ''}`);
}

async function perfProbe(page) {
  return page.evaluate(() => new Promise(resolve => {
    const M = window.__M;
    M.setView([23.7, 121.0], 7, { animate: false });
    const size = M.getSize(), original = M.toScreen.bind(M);
    let total = 0, visibleCount = 0, done = false;
    M.toScreen = ll => {
      const p = original(ll); total++;
      if (p.x >= 0 && p.y >= 0 && p.x <= size.x && p.y <= size.y) visibleCount++;
      return p;
    };
    const finish = () => {
      if (done) return; done = true; M.toScreen = original;
      window.__alignPerf = { frameComplete: true, visibleCount, total };
      resolve(window.__alignPerf);
    };
    if (M.engine === 'maplibre') {
      M.raw.once('render', finish); M.raw.triggerRepaint();
    } else {
      requestAnimationFrame(() => { reproject(); finish(); });
    }
    setTimeout(finish, 3000);
  }));
}

const launchers = [['Chromium', chromium], ['WebKit', webkit]];
const chromiumPixelEvidence = new Map();
let matrix;
try {
  matrix = await runEngineMatrix(async ({ engine, engineUrl, check, onlyFor }) => {
    for (const [browserName, launcher] of launchers) {
      const url = engineUrl(BASE, { aligndot: `${DOT.lat},${DOT.lng}` });
      const clean = await bootWithRetry(launcher, url, engine, browserName);
      const { page } = clean;
      check((await page.evaluate(() => window.__M.engine)) === engine, `${browserName} 矩陣引擎生效`);
      const scenarioDefs = [
        ['S1 clean', null],
        ['S2 pan', () => window.__M.panBy([137, 89], { animate: false })],
        ['S3 zoom', () => { const M = window.__M; M.setView(M.getCenter(), M.getZoom() + 1, { animate: false }); }],
        ['S4 pan+zoom', () => { const M = window.__M; M.panBy([-71, 53], { animate: false }); M.setView(M.getCenter(), M.getZoom() - 1, { animate: false }); }],
      ];
      for (const [scenarioName, action] of scenarioDefs) {
        const result = await measure(page, `${browserName} ${scenarioName}`, action);
        const rendered = engine === 'maplibre' ? await renderedProbe(page) : null;
        const evidenceKey = `${engine}:${scenarioName}`;
        if (browserName === 'Chromium') chromiumPixelEvidence.set(evidenceKey, result.pass);
        const webkitNoGlComposite = browserName === 'WebKit' && !result.mag && !!result.cyan
          && chromiumPixelEvidence.get(evidenceKey) && !(await canvasMagenta(page));
        if (rendered) {
          if (webkitNoGlComposite && rendered.layer && rendered.sourceAt && !rendered.hit) {
            namedSkip(`[maplibre] ${browserName} ${scenarioName} queryRenderedFeatures`,
              'headless WebKit 未建立 GL 命中結果；style layer/source 正確且 Chromium 同情境合成像素已通過', JSON.stringify(rendered));
          } else check(rendered.hit, `${browserName} ${scenarioName} queryRenderedFeatures 命中 aligndot`, rendered);
        }
        if (result.pass) check(true, result.id, result.detail);
        else if (webkitNoGlComposite && rendered?.layer && rendered?.sourceAt) {
          namedSkip(`[${engine}] ${result.id}`,
            'headless WebKit 未合成 GL circle；Chromium 同情境像素已通過，真機由螢幕錄影＋scripts/analyze_device_recording.mjs 保護',
            result.detail);
        } else check(false, result.id, result.detail);
      }
      const perf = await perfProbe(page);
      check(perf.frameComplete && perf.visibleCount >= 100, `${browserName} P1 同一 render frame 投影至少 100 個入鏡樣本`, perf);
      await clean.ctx.close(); await clean.browser.close();

      const mode = engine === 'maplibre' ? 'overlay' : 'basemap';
      const mutated = await bootWithRetry(launcher, engineUrl(BASE, { aligndot: `${DOT.lat},${DOT.lng}`, mutate: mode }), engine, browserName);
      const mutation = await measure(mutated.page, `${browserName} mutation=${mode}`, null, mode);
      const mutationRendered = engine === 'maplibre' ? await renderedProbe(mutated.page) : null;
      const mutationKey = `${engine}:mutation`;
      if (browserName === 'Chromium') chromiumPixelEvidence.set(mutationKey, mutation.pass);
      const webkitNoGlMutation = browserName === 'WebKit' && !mutation.mag && !!mutation.cyan
        && chromiumPixelEvidence.get(mutationKey) && !(await canvasMagenta(mutated.page));
      if (mutationRendered) {
        if (webkitNoGlMutation && mutationRendered.layer && mutationRendered.sourceAt && !mutationRendered.hit) {
          namedSkip(`[maplibre] ${browserName} mutation 前 queryRenderedFeatures`,
            'headless WebKit 未建立 GL 命中結果；style layer/source 正確且 Chromium mutation 已通過', JSON.stringify(mutationRendered));
        } else check(mutationRendered.hit, `${browserName} mutation 前 renderer 仍命中 aligndot`, mutationRendered);
      }
      if (mutation.pass) check(true, mutation.id, mutation.detail);
      else if (webkitNoGlMutation && mutationRendered?.layer && mutationRendered?.sourceAt) {
        namedSkip(`[${engine}] ${mutation.id}`,
          'headless WebKit 未合成 GL circle；Chromium mutation 已通過，真機由螢幕錄影＋scripts/analyze_device_recording.mjs 保護',
          mutation.detail);
      } else check(false, mutation.id, mutation.detail);
      if (engine === 'maplibre') {
        const structuralMutation = await renderedMutationProbe(mutated.page);
        check(structuralMutation.absent, `${browserName} renderer 突變後原預期點不再命中 aligndot`, structuralMutation);
      }
      check(mutated.errs.length === 0, `${browserName} mutation 頁面零錯誤`, mutated.errs.join(' | ').slice(0, 300));
      await mutated.ctx.close(); await mutated.browser.close();

      let aliases;
      if (engine === 'maplibre') {
        const probe = await bootWithRetry(launcher, engineUrl(BASE, { probe: 1 }), engine, browserName);
        const explicit = await bootWithRetry(launcher, engineUrl(BASE, { aligndot: '25.20,121.80' }), engine, browserName);
        aliases = await Promise.all([probe.page, explicit.page].map(p => p.evaluate(() => ({ dot: window.__alignDot, layer: !!window.__ofmGl?.getLayer?.('aligndot') }))));
        await probe.ctx.close(); await probe.browser.close(); await explicit.ctx.close(); await explicit.browser.close();
      }
      onlyFor('maplibre', 'probe/aligndot 的 GL layer 是 MapLibre 診斷介面', `${browserName} probe=1 與 aligndot 別名等價`,
        engine === 'maplibre' ? aliases[0].layer && aliases[1].layer && JSON.stringify(aliases[0].dot) === JSON.stringify(aliases[1].dot) : undefined, aliases);
      check(clean.errs.length === 0, `${browserName} clean 頁面零錯誤`, clean.errs.join(' | ').slice(0, 300));
    }
  });
} finally {
  server.close();
}
console.log(matrix?.passed ? '\n全部通過' : `\n${matrix?.failures.length || 1} 項未過`);
process.exit(matrix?.passed ? 0 : 1);
