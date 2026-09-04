// GL 軌道/站點層守門人(換引擎 M1a/M1b)。Leaflet 是 canvas 控制組；MapLibre 是 GL 受測組。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43541;
const BASE = `http://127.0.0.1:${PORT}/index.html?lang=zh-TW`;
const GL_TRACKS_REASON = '此斷言直接讀 MapLibre source/layer/style，Leaflet 沒有同型物件';
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
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

async function boot(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && (u => u === '' || /index\.html/.test(u))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 });
  return { ctx, page, errs };
}
async function settle(page, maplibre) {
  if (maplibre) {
    await page.waitForFunction(() => window.__glTracks?.ready && window.__ofmGl?.getLayer('track-line-' + window.__glTracks.ranks[0]), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => { const g = window.__ofmGl; if (g.loaded() && !g.isMoving()) resolve(); else { g.once('idle', resolve); setTimeout(resolve, 8000); } }));
  }
  await page.waitForTimeout(300);
}
const SAMPLE = `(() => {
  const st = window.__state, M = window.__M;
  st.simSec = 3 * 3600; st.clockAtNow = false; if (typeof draw === 'function') draw();
  const ln = (st.trackLines || []).find(l => l.id === '縱貫線北段'); if (!ln) return { err: 'no line' };
  const d = (a, b) => M.distance([a[0], a[1]], [b.lat, b.lon]);
  const size = M.getSize(), inb = i => { const p = M.toScreen([ln.shape[i][0], ln.shape[i][1]]); return p.x > 40 && p.y > 40 && p.x < size.x - 40 && p.y < size.y - 40; };
  const vis = ln.shape.map((_, i) => i).filter(i => inb(i) && !ln.stations.some(s => d(ln.shape[i], s) < 300));
  if (vis.length < 3) return { err: 'too few in-view vertices', n: vis.length };
  const idx = [0.2, 0.5, 0.8].map(f => vis[Math.floor((vis.length - 1) * f)]);
  const cv = document.getElementById('overlay'), ctx = cv.getContext('2d'), dpr = st.dpr || 1;
  return { alphas: idx.map(i => { const p = M.toScreen([ln.shape[i][0], ln.shape[i][1]]); return ctx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data[3]; }), idx };
})()`;
const GO_SCHED = `(() => { selectGroup(GROUPS.find(g => g.id === 'nat')); window.__M.setView([25.02, 121.46], 12, { animate: false }); })()`;

const browser = await chromium.launch();
let matrix;
try {
  matrix = await runEngineMatrix(async ({ engine, engineUrl, check, onlyFor }) => {
    const maplibre = engine === 'maplibre';
    const { ctx, page, errs } = await boot(browser, engineUrl(BASE));
    await page.evaluate(GO_SCHED); await settle(page, maplibre);
    const o = {};
    if (maplibre) {
      o.t1 = await page.evaluate(() => {
        const g = window.__ofmGl, T = window.__glTracks, layers = g.getStyle().layers, order = layers.map(layer => layer.id);
        const want = T.ranks.flatMap(k => ['track-casing-' + k, 'track-line-' + k]).concat(['track-stations']);
        const idx = want.map(id => order.indexOf(id)), building = order.indexOf('building-3d');
        const firstTrack = idx[0], lastTrack = idx[idx.length - 1];
        const nonLabelAbove = layers.slice(lastTrack + 1)
          .filter(layer => layer.type !== 'symbol' && layer.id !== 'aligndot')
          .map(layer => layer.id);
        return { ranks: T.ranks, idx, familyOk: idx[0] >= 0 && JSON.stringify(order.slice(idx[0], idx[0] + want.length)) === JSON.stringify(want),
          building, buildingBelow: building < 0 || building < firstTrack, nonLabelAbove,
          n: g.querySourceFeatures('track-lines').length, src: !!g.getSource('track-stations') };
      });
      o.s2 = await page.evaluate(SAMPLE);
      o.t3a = await page.evaluate(() => window.__ofmGl.getFilter('track-line-' + window.__glTracks.ranks[0])[2][2][1].length);
      o.t3b = await page.evaluate(() => { const st = window.__state, id = st.trackLines[0].id; st.trackVisible.delete(id); draw(); return { n: window.__ofmGl.getFilter('track-line-' + window.__glTracks.ranks[0])[2][2][1].length, total: st.trackLines.length, id }; });
      await page.evaluate(() => { const st = window.__state; st.trackVisible.add(st.trackLines[0].id); draw(); });
      const paint = () => page.evaluate(() => JSON.stringify(window.__ofmGl.getPaintProperty('track-line-' + window.__glTracks.ranks[0], 'line-color')));
      o.light = await paint();
      await page.evaluate(() => new Promise(resolve => { window.__ofmGl.once('style.load', resolve); window.__state.mapDark = true; setBasemap(); setTimeout(resolve, 10000); }));
      o.dark = await paint();
      await page.evaluate(() => { window.__state.trackStyle = 'faint'; draw(); }); o.faint = await paint();
      await page.evaluate(() => new Promise(resolve => { window.__ofmGl.once('style.load', resolve); window.__state.trackStyle = 'hidden'; window.__state.mapDark = false; setBasemap(); setTimeout(resolve, 10000); }));
      o.hidden = await paint();
      await page.evaluate(() => { window.__state.trackStyle = 'auto'; draw(); });
      o.t5a = await page.evaluate(() => ({ min: window.__ofmGl.getLayer('track-stations').minzoom, n: window.__ofmGl.getFilter('track-stations')[2][1].length, deco: (window.__state.decoLines || []).length }));
      await page.evaluate(() => selectGroup(GROUPS.find(x => x.id === 'all'))); await settle(page, true); await page.evaluate(() => draw());
      o.t5b = await page.evaluate(() => ({ min: window.__ofmGl.getLayer('track-stations').minzoom, n: window.__ofmGl.getFilter('track-stations')[2][1].length, deco: (window.__state.decoLines || []).length }));
      await page.evaluate(() => loadSystem(window.__state.systems.find(s => s.id === 'mrt'))); await settle(page, true); await page.evaluate(() => draw());
      o.t5c = await page.evaluate(() => ({ min: window.__ofmGl.getLayer('track-stations').minzoom, n: window.__ofmGl.getFilter('track-stations')[2][1].length, vis: window.__state.visible.size, mode: window.__state.mode }));
      await page.evaluate(() => selectGroup(GROUPS.find(x => x.id === 'all'))); await settle(page, true);
      o.t6 = await page.evaluate(async () => {
        const g = window.__ofmGl, st = window.__state, M = window.__M;
        const cl = await fetch('./data/rail_crossing_levels.json').then(r => r.json());
        const allSt = [...(st.trackLines || []), ...(st.decoLines || [])].flatMap(l => l.stations);
        const minD = c => Math.min(...allSt.map(s => M.distance([c.lat, c.lon], [s.lat, s.lon])));
        const far = cl.crossings.filter(c => c.above?.id && c.below?.id).map(c => ({ c, d: minD(c) })).sort((a, b) => b.d - a.d)[0];
        if (!far || far.d < 80) return { err: 'no far crossing', d: far?.d };
        const fc = far.c, lines = [...(st.trackLines || []), ...(st.decoLines || [])];
        const color = side => lines.find(x => x.id === side.id && (x.sys || x._sys) === side.sys)?.color;
        M.setView([fc.lat, fc.lon], 16, { animate: false });
        await new Promise(resolve => { if (g.loaded() && !g.isMoving()) resolve(); else { g.once('idle', resolve); setTimeout(resolve, 8000); } });
        st.simSec = 3 * 3600; st.clockAtNow = false; draw();
        const rr = document.getElementById('map').getBoundingClientRect(), q = M.toScreen([fc.lat, fc.lon]), order = g.getLayersOrder();
        return { p: { x: q.x + rr.left, y: q.y + rr.top }, above: color(fc.above), below: color(fc.below), orderOk: window.__glTracks.ranks.every((k, i) => i === 0 || order.indexOf('track-line-' + k) > order.indexOf('track-line-' + window.__glTracks.ranks[i - 1])) };
      });
      o.t6ok = false; o.t6detail = JSON.stringify(o.t6);
      if (!o.t6.err && o.t6.above) {
        await page.waitForTimeout(400);
        const { data, info } = await sharp(await page.screenshot({ type: 'png' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const at = (x, y) => { const i = (Math.round(y) * info.width + Math.round(x)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
        const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const px = at(o.t6.p.x, o.t6.p.y), dA = dist(px, rgb(o.t6.above)), dB = dist(px, rgb(o.t6.below));
        o.t6ok = o.t6.orderOk && dA <= 40 && dA < dB; o.t6detail += ` px=${px} dAbove=${dA.toFixed(1)} dBelow=${dB.toFixed(1)}`;
      }
    }
    const t1 = o.t1 || {}, t3b = o.t3b || {}, a = o.t5a || {}, b = o.t5b || {}, c = o.t5c || {};
    onlyFor('maplibre', GL_TRACKS_REASON, 'T1 GL 層順序=casing/line 依 sortKey 交錯，底圖道路與 3D 建築均在軌道下、文字標籤在上', maplibre ? t1.ranks?.length >= 2 && t1.idx.every((v, i) => v >= 0 && (i === 0 || v > t1.idx[i - 1])) && t1.familyOk && t1.buildingBelow && t1.nonLabelAbove?.length === 0 : undefined, t1);
    onlyFor('maplibre', GL_TRACKS_REASON, 'T1b source 有 feature', maplibre ? t1.n > 0 && t1.src : undefined, `n=${t1.n}`);
    onlyFor('maplibre', GL_TRACKS_REASON, 'T2 MapLibre:canvas 不再描軌道(三個中段點 alpha=0)', maplibre ? !o.s2.err && o.s2.alphas.every(x => x === 0) : undefined, o.s2);
    onlyFor('maplibre', GL_TRACKS_REASON, 'T3 可見集合與突變正確', maplibre ? o.t3a === t3b.total && t3b.n === o.t3a - 1 : undefined, { t3a: o.t3a, ...t3b });
    onlyFor('maplibre', GL_TRACKS_REASON, 'T4 主題/狀態 paint 正確', maplibre ? o.light === '["get","color"]' && /^\["case",\["in",\["get","lineKey"\]/.test(o.dark) && o.dark.includes('colorDark') && o.faint === '["get","colorFaintDark"]' && o.hidden === '["get","colorHiddenLight"]' : undefined, `${o.light} | ${o.dark || ''} | ${o.faint} | ${o.hidden}`);
    onlyFor('maplibre', GL_TRACKS_REASON, 'T5 站點圓各模式 filter/minzoom 正確', maplibre ? a.n === 0 && b.min === 10 && b.n === b.deco && b.deco > 0 && c.min === 0 && c.mode === 'freq' && c.n === c.vis && c.n > 0 : undefined, { a, b, c });
    onlyFor('maplibre', GL_TRACKS_REASON, 'T6 交叉口 layer 順序與中心像素=above 線色', maplibre ? o.t6ok : undefined, o.t6detail);
    if (!maplibre) {
      const sample = await page.evaluate(SAMPLE);
      const glOff = await page.evaluate(() => !(window.__glTracks?.ready) || !window.__ofmGl?.getLayer || !window.__ofmGl.getLayer('track-line-0'));
      check(!sample.err && sample.alphas.every(x => x > 0) && glOff, 'T2 Leaflet 控制組:canvas 仍描軌道且無 GL 軌道層', { sample, glOff });
    }
    check(errs.length === 0, 'T7 主情境零 pageerror/console.error', errs.join(' | ').slice(0, 300));
    await ctx.close();
    if (maplibre) {
      const off = await boot(browser, engineUrl(BASE, { gltracks: 0 }));
      await off.page.evaluate(GO_SCHED); await settle(off.page, true); await off.page.waitForTimeout(500);
      const sample = await off.page.evaluate(SAMPLE);
      const glOff = await off.page.evaluate(() => !(window.__glTracks?.ready) || !window.__ofmGl?.getLayer || !window.__ofmGl.getLayer('track-line-0'));
      check(!sample.err && sample.alphas.every(x => x > 0) && glOff, 'T2 gltracks=0 正向控制:canvas 仍描軌道且無 GL 軌道層', { sample, glOff });
      check(off.errs.length === 0, 'T7 gltracks=0 零 pageerror/console.error', off.errs.join(' | ').slice(0, 300));
      await off.ctx.close();
    }
  });
} finally {
  await browser.close(); server.close();
}
console.log(matrix?.passed ? '\n全部通過' : `\n${matrix?.failures.length || 1} 項未過`);
process.exit(matrix?.passed ? 0 : 1);
