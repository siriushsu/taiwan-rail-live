// GL 軌道/站點層守門人(換引擎 M1a)。雙引擎:Leaflet 是控制組(canvas 照舊畫),MapLibre 是受測組。
// T1 MapLibre:layer 順序=依 sortKey 階級交錯的 casing/line 對 + track-stations 在最上(aligndot 除外);source 有 feature。
// T2 canvas 讓位:凌晨三點(無車)在三個軌道中段取 overlay 像素 alpha —— MapLibre 必須 0、Leaflet 必須 >0、MapLibre+?gltracks=0 必須 >0(旗標有牙)。
// T3 可見集合:sched 預設 filter 含全部 trackLines;從 trackVisible 拿掉一條後 filter 少那一條(正向對照)。
// T4 主題/狀態:light auto=['get','color'];dark auto=case 運算式(只壓 sched,計畫 D1);faint dark=['get','colorFaintDark'];hidden light=['get','colorHiddenLight']。
// T5 站點圓:全台同框 minzoom=10(Leaflet z11);freq 捷運 minzoom=0 且 filter=可見捷運線;sched 無 deco 時 filter 空。
// T6 交叉口:layer 順序 index 隨 k 遞增;挑 above/below 都有線 id、離所有車站最遠(≥80m)的已收錄交叉,z16 中心像素色=above 那條線的 color(容差 40)。
// T7 每次開機 pageerror=0、頁面 console.error=0。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43541;
const fails = [];
const ck = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails.push(name); };

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

async function boot(browser, query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && (u => u === '' || /index\.html/.test(u))(((m.location && m.location()) || {}).url || '')) errs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?lang=zh-TW${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 });
  return { ctx, page, errs };
}
const isML = q => /engine=maplibre/.test(q);
async function settle(page, ml) { // GL 層裝好+畫面閒置
  if (ml) {
    await page.waitForFunction(() => window.__glTracks && window.__glTracks.ready && window.__ofmGl && window.__ofmGl.getLayer('track-line-' + window.__glTracks.ranks[0]), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => new Promise(r => { const g = window.__ofmGl; if (g.loaded() && !g.isMoving()) r(); else { g.once('idle', r); setTimeout(r, 8000); } }));
  }
  await page.waitForTimeout(300);
}
// 三個軌道中段點(縱貫線北段的 1/3、1/2、2/3 頂點,且離最近車站 ≥300m),凌晨 3 點無車;回 overlay 像素 alpha 陣列
const SAMPLE = `(() => {
  const st = window.__state, M = window.__M;
  st.simSec = 3 * 3600; st.clockAtNow = false; if (typeof draw === 'function') draw();
  const ln = (st.trackLines || []).find(l => l.id === '縱貫線北段'); if (!ln) return { err: 'no line' };
  const d = (a, b) => M.distance([a[0], a[1]], [b.lat, b.lon]);
  const size = M.getSize(), inb = i => { const p = M.toScreen([ln.shape[i][0], ln.shape[i][1]]); return p.x > 40 && p.y > 40 && p.x < size.x - 40 && p.y < size.y - 40; };
  const vis = ln.shape.map((_, i) => i).filter(i => inb(i) && !ln.stations.some(s => d(ln.shape[i], s) < 300)); // 畫面內(留 40px 邊)且離站 ≥300m 的頂點
  if (vis.length < 3) return { err: 'too few in-view vertices', n: vis.length };
  const idx = [0.2, 0.5, 0.8].map(f => vis[Math.floor((vis.length - 1) * f)]);
  const cv = document.getElementById('overlay'), ctx = cv.getContext('2d'), dpr = st.dpr || 1;
  return { alphas: idx.map(i => { const p = M.toScreen([ln.shape[i][0], ln.shape[i][1]]); return ctx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data[3]; }), idx };
})()`;
const GO_SCHED = `(() => { selectGroup(GROUPS.find(g => g.id === 'nat')); window.__M.setView([25.02, 121.46], 12, { animate: false }); })()`;

const browser = await chromium.launch();
try {
  // ── T1/T2/T3/T4/T6 MapLibre ──
  {
    const { ctx, page, errs } = await boot(browser, 'engine=maplibre');
    await page.evaluate(GO_SCHED); await settle(page, true);
    const t1 = await page.evaluate(() => {
      const g = window.__ofmGl, T = window.__glTracks, order = g.getLayersOrder();
      const want = T.ranks.flatMap(k => ['track-casing-' + k, 'track-line-' + k]).concat(['track-stations']);
      const idx = want.map(id => order.indexOf(id));
      const tail = order.slice(order.length - want.length);
      return { ranks: T.ranks, idx, tailOk: JSON.stringify(tail) === JSON.stringify(want), n: g.querySourceFeatures('track-lines').length, src: !!g.getSource('track-stations') };
    });
    ck(t1.ranks.length >= 2 && t1.idx.every((v, i) => v >= 0 && (i === 0 || v > t1.idx[i - 1])) && t1.tailOk, 'T1 GL 層順序=casing/line 依 sortKey 交錯、站點層最上', JSON.stringify(t1));
    ck(t1.n > 0 && t1.src, 'T1b source 有 feature', `n=${t1.n}`);
    const s2 = await page.evaluate(SAMPLE);
    ck(!s2.err && s2.alphas.every(a => a === 0), 'T2 MapLibre:canvas 不再描軌道(三個中段點 alpha=0)', JSON.stringify(s2));
    const t3a = await page.evaluate(() => window.__ofmGl.getFilter('track-line-' + window.__glTracks.ranks[0])[2][2][1].length);
    const t3b = await page.evaluate(() => { const st = window.__state; const id = st.trackLines[0].id; st.trackVisible.delete(id); draw(); return { n: window.__ofmGl.getFilter('track-line-' + window.__glTracks.ranks[0])[2][2][1].length, total: st.trackLines.length, id }; });
    ck(t3a === t3b.total && t3b.n === t3a - 1, 'T3 可見集合:預設=全部 trackLines;拿掉一條 filter 少一條', JSON.stringify({ t3a, ...t3b }));
    await page.evaluate(() => { const st = window.__state; st.trackVisible.add(st.trackLines[0].id); draw(); });
    const paintOf = () => page.evaluate(() => JSON.stringify(window.__ofmGl.getPaintProperty('track-line-' + window.__glTracks.ranks[0], 'line-color')));
    const light = await paintOf();
    await page.evaluate(() => new Promise(res => { window.__ofmGl.once('style.load', res); window.__state.mapDark = true; setBasemap(); setTimeout(res, 10000); })); // 先掛監聽再切 style(競態),10s 上限 await settle(page, true); await page.evaluate(() => draw());
    const dark = await paintOf();
    await page.evaluate(() => { window.__state.trackStyle = 'faint'; draw(); }); const faint = await paintOf();
    await page.evaluate(() => new Promise(res => { window.__ofmGl.once('style.load', res); window.__state.trackStyle = 'hidden'; window.__state.mapDark = false; setBasemap(); setTimeout(res, 10000); })); // 先掛監聽再切 style(競態),10s 上限 await settle(page, true); await page.evaluate(() => draw());
    const hidden = await paintOf();
    await page.evaluate(() => { window.__state.trackStyle = 'auto'; draw(); });
    ck(light === '["get","color"]' && /^\["case",\["in",\["get","lineKey"\]/.test(dark) && dark.includes('colorDark') && faint === '["get","colorFaintDark"]' && hidden === '["get","colorHiddenLight"]', 'T4 主題/狀態 paint:light auto 原色、dark auto 只壓 sched(case)、faint dark、hidden light', `${light} | ${dark.slice(0, 60)} | ${faint} | ${hidden}`);
    const t5a = await page.evaluate(() => ({ min: window.__ofmGl.getLayer('track-stations').minzoom, n: window.__ofmGl.getFilter('track-stations')[2][1].length, deco: (window.__state.decoLines || []).length }));
    await page.evaluate(() => { const g = GROUPS.find(x => x.id === 'all'); if (g) selectGroup(g); }); await settle(page, true); await page.evaluate(() => draw());
    const t5b = await page.evaluate(() => ({ min: window.__ofmGl.getLayer('track-stations').minzoom, n: window.__ofmGl.getFilter('track-stations')[2][1].length, deco: (window.__state.decoLines || []).length }));
    await page.evaluate(() => loadSystem(window.__state.systems.find(s => s.id === 'mrt'))); await settle(page, true); await page.evaluate(() => draw());
    const t5c = await page.evaluate(() => ({ min: window.__ofmGl.getLayer('track-stations').minzoom, n: window.__ofmGl.getFilter('track-stations')[2][1].length, vis: window.__state.visible.size, mode: window.__state.mode }));
    ck(t5a.n === 0 && t5b.min === 10 && t5b.n === t5b.deco && t5b.deco > 0 && t5c.min === 0 && t5c.mode === 'freq' && t5c.n === t5c.vis && t5c.n > 0, 'T5 站點圓:sched 無 deco=空;全台同框 minzoom 10 且=deco 線數;freq minzoom 0 且=可見捷運線數', JSON.stringify({ t5a, t5b, t5c }));
    // T6 交叉口(回 sched 全台同框,挑離站遠的已收錄交叉)
    await page.evaluate(() => { const g = GROUPS.find(x => x.id === 'all'); if (g) selectGroup(g); }); await settle(page, true);
    const t6 = await page.evaluate(async () => {
      const g = window.__ofmGl, st = window.__state, M = window.__M;
      const cl = await fetch('./data/rail_crossing_levels.json').then(r => r.json());
      const allSt = [...(st.trackLines || []), ...(st.decoLines || [])].flatMap(l => l.stations);
      // 只挑 above/below 都有線 id 的交叉(台鐵/高鐵/林鐵在表裡只認得到 sys),取離所有車站最遠的那一個
      const minD = c => Math.min(...allSt.map(s => M.distance([c.lat, c.lon], [s.lat, s.lon])));
      const far = cl.crossings.filter(c => c.above && c.above.id && c.below && c.below.id).map(c => ({ c, d: minD(c) })).sort((a, b) => b.d - a.d)[0];
      if (!far || far.d < 80) return { err: 'no far crossing', d: far && far.d };
      const fc = far.c;
      const lines = [...(st.trackLines || []), ...(st.decoLines || [])];
      const color = side => { const l = lines.find(x => x.id === side.id && (x.sys || x._sys) === side.sys); return l && l.color; };
      M.setView([fc.lat, fc.lon], 16, { animate: false });
      await new Promise(r => { if (g.loaded() && !g.isMoving()) r(); else { g.once('idle', r); setTimeout(r, 8000); } });
      st.simSec = 3 * 3600; st.clockAtNow = false; draw();
      const rr = document.getElementById('map').getBoundingClientRect(), q = M.toScreen([fc.lat, fc.lon]); const p = { x: q.x + rr.left, y: q.y + rr.top }; // 容器座標→整頁座標
      const order = g.getLayersOrder();
      return { p, above: color(fc.above), below: color(fc.below), at: [fc.lat, fc.lon], dStation: Math.round(far.d), orderOk: window.__glTracks.ranks.every((k, i) => i === 0 || order.indexOf('track-line-' + k) > order.indexOf('track-line-' + window.__glTracks.ranks[i - 1])) };
    });
    let t6ok = false, t6d = JSON.stringify(t6);
    if (!t6.err && t6.above) {
      await page.waitForTimeout(400);
      const png = await page.screenshot({ type: 'png' });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = (x, y) => { const i = (Math.round(y) * info.width + Math.round(x)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
      const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const px = at(t6.p.x, t6.p.y), dA = dist(px, hex(t6.above)), dB = dist(px, hex(t6.below));
      t6ok = t6.orderOk && dA <= 40 && dA < dB; t6d += ` px=${px} dAbove=${dA.toFixed(1)} dBelow=${dB.toFixed(1)}`;
    }
    ck(t6ok, 'T6 交叉口:layer 順序隨 sortKey 遞增;z16 中心像素=above 線色', t6d);
    ck(errs.length === 0, 'T7a MapLibre 開機零 pageerror/console.error', errs.join(' | ').slice(0, 300));
    await ctx.close();
  }
  // ── T2 控制組:Leaflet 與 MapLibre+?gltracks=0 都必須還在 canvas 描軌道 ──
  for (const q of ['', 'engine=maplibre&gltracks=0']) {
    const { ctx, page, errs } = await boot(browser, q);
    await page.evaluate(GO_SCHED); await settle(page, isML(q)); await page.waitForTimeout(500);
    const s = await page.evaluate(SAMPLE);
    const glOff = await page.evaluate(() => !(window.__glTracks && window.__glTracks.ready) || !window.__ofmGl.getLayer || !window.__ofmGl.getLayer('track-line-0'));
    ck(!s.err && s.alphas.every(a => a > 0) && glOff, `T2 控制組(${q || 'leaflet'}):canvas 仍描軌道(alpha>0)且無 GL 軌道層`, JSON.stringify(s) + ` glOff=${glOff}`);
    ck(errs.length === 0, `T7b ${q || 'leaflet'} 零 pageerror/console.error`, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(fails.length ? `\n${fails.length} 項未過:${fails.join(', ')}` : '\n全部通過');
process.exit(fails.length ? 1 : 0);
