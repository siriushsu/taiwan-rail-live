// 都會呼吸幕(放空定場)抖動修復驗證 — Playwright 真引擎 + 本機靜態伺服器。
// 背景:v0717x 呼吸幕逐幀分數 zoom 用 map.setView(animate:false)。Leaflet latLngToContainerPoint 對每點
//   project 取整、又減取整後 pixelOrigin,分數 zoom 逐幀推進時整幅畫面(路網+海陸輪廓)±1~2.5px shimmer 抖動;
//   海陸輪廓另走 Leaflet canvas 圖層(獨立取整投影)→ 與 overlay 路網跨層相對抖動(基線量到 1.4px)。
// 修法(v0718c):呼吸中 latLngToContainerPoint 包成「相對中心浮點投影」(零取整)→ 全體平滑;
//   海陸輪廓改由 overlay 同幀同投影自繪(drawBreathLand),隱藏 Leaflet 離線層 → 跨層恆對齊。
// 基線(修前,本機 chromium@1280 實測存證):overlay-vs-float p2p 2.5px、overlay 2nd-diff rms 1.4px(max 2.8)、
//   海陸 2nd-diff max 5px、全域 origin 取整 2nd-diff rms 1.16、每點 2nd-diff rms 0.91、跨層 Δrange 1.4px。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5191;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const r2 = x => Math.round(x * 100) / 100;
const sd = a => { const v = []; for (let i = 2; i < a.length; i++) v.push(Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return v; };
const sd2 = a => { const v = []; for (let i = 2; i < a.length; i++) { const ddx = a[i].x - 2 * a[i - 1].x + a[i - 2].x, ddy = a[i].y - 2 * a[i - 1].y + a[i - 2].y; v.push(Math.hypot(ddx, ddy)); } return v; };
const mx = a => a.length ? Math.max(...a) : 0;
const rms = a => a.length ? Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length) : 0;

async function bootBreath(browser, { width = 1280, height = 800, touch = false, url = `http://localhost:${PORT}/?breath=1`, forceCity = null, bt = 37.5 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); localStorage.setItem('trainmap-ambient-style', 'hotspot'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready && map && state._landGeo; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(({ forceCity, bt }) => {
    state.ambientStyle = 'hotspot'; state.ambient = true; state.playing = true;
    state.followTrain = null; state.freqFollow = null; state._theater = false; state._transition = false; state._hotYield = 0;
    const sc = pickBreathScene();
    if (forceCity && typeof CITY_BBOX !== 'undefined' && CITY_BBOX[forceCity]) {
      const b = CITY_BBOX[forceCity], c = L.latLngBounds([[b[0], b[1]], [b[2], b[3]]]).getCenter();
      sc.lat = c.lat; sc.lon = c.lng; sc.anchor = { lat: c.lat, lon: c.lng };
    }
    sc.bt = bt; state._hotScene = sc; state._hotFresh = false; state._hotNext = performance.now() + 9e8;
  }, { forceCity, bt });
  await page.waitForFunction(() => { try { return state._breathStage && map.options.zoomSnap === 0 && map.getZoom() > 11.05; } catch (e) { return false; } }, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}

// 逐幀取樣:zoom + 測試經緯度的 overlay 螢幕座標與浮點真值(投影層級平滑度)
async function sampleProjection(page, N = 80) {
  return page.evaluate((N) => new Promise(resolve => {
    const out = []; const size = map.getSize();
    const mk = (dx, dy) => { const p = L.point(size.x / 2 + dx, size.y / 2 + dy); return map.containerPointToLatLng(p); };
    const pts = [mk(0, 0), mk(180, 90), mk(-320, 160), mk(420, -220), mk(-460, -320)].map(ll => [ll.lat, ll.lng]);
    // 跨層特徵:真實海陸 geojson 頂點 + 真實車站(兩者都經 latLngToContainerPoint→呼吸中浮點包裝);
    // 量兩者螢幕相對位移的 2nd-diff → 海陸 vs 軌道相對運動是否平滑鎖定(心得16,非單層自洽)
    let landVtx = null, stn = null;
    try { const g = state._landGeo.geometry, poly = g.type === 'MultiPolygon' ? g.coordinates[0] : g.coordinates; const ring = poly[0]; landVtx = [ring[Math.floor(ring.length / 2)][1], ring[Math.floor(ring.length / 2)][0]]; } catch (e) {}
    try { // 軌道網特徵:sched 站點(schedStations)優先,其次 trackLines 折線頂點
      const src = (state.schedStations && state.schedStations.length) ? state.schedStations
        : (state.trackLines || []).find(l => l.stations && l.stations.length)?.stations;
      const s = src[Math.floor(src.length / 2)]; stn = [s.lat, s.lon];
    } catch (e) {}
    let n = 0;
    (function tick() {
      const z = map.getZoom(), c = map.getCenter(), s = map.getSize();
      const rec = { t: performance.now(), z, pts: [] };
      for (const p of pts) {
        const ll = L.latLng(p[0], p[1]);
        const over = map.latLngToContainerPoint(ll);
        const P = map.project(ll, z), C = map.project(c, z);
        const flo = { x: P.x - C.x + s.x / 2, y: P.y - C.y + s.y / 2 };
        rec.pts.push({ over: { x: over.x, y: over.y }, flo, dc: Math.hypot(over.x - s.x / 2, over.y - s.y / 2) });
      }
      if (landVtx && stn) { const a = map.latLngToContainerPoint(landVtx), b = map.latLngToContainerPoint(stn); rec.rel = { x: a.x - b.x, y: a.y - b.y }; }
      out.push(rec);
      if (++n >= N) return resolve(out);
      requestAnimationFrame(tick);
    })();
  }), N);
}

// 逐幀讀 overlay 真實像素:海陸(米色填色)質心-x 與 軌道(高彩度描線)質心-x(跨層像素級對齊,心得 16)
async function samplePixels(page, N = 70) {
  return page.evaluate((N) => new Promise(resolve => {
    const cv = document.getElementById('overlay'); const g = cv.getContext('2d');
    const dpr = cv.width / (parseFloat(cv.style.width) || cv.width / 2); // 裝置像素/CSS
    const y0 = Math.round(cv.height * 0.30), y1 = Math.round(cv.height * 0.70); // 中央帶
    let n = 0; const out = [];
    (function tick() {
      let img; try { img = g.getImageData(0, y0, cv.width, y1 - y0).data; } catch (e) { return resolve({ err: String(e) }); }
      let lSx = 0, lN = 0, rSx = 0, rN = 0, lEdge = 0, lEdgeN = 0;
      const W = cv.width;
      for (let yy = 0; yy < (y1 - y0); yy++) {
        let rowEdge = -1;
        for (let xx = 0; xx < W; xx++) {
          const i = (yy * W + xx) * 4, R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
          if (A < 120) continue;
          const isLand = Math.abs(R - 234) < 30 && Math.abs(G - 223) < 30 && Math.abs(B - 196) < 34;
          if (isLand) { lSx += xx; lN++; if (rowEdge < 0) { rowEdge = xx; } }
          else { const chroma = Math.max(R, G, B) - Math.min(R, G, B); if (chroma > 50) { rSx += xx; rN++; } }
        }
        if (rowEdge >= 0) { lEdge += rowEdge; lEdgeN++; }
      }
      out.push({ t: performance.now(), landCx: lN ? lSx / lN / dpr : null, railCx: rN ? rSx / rN / dpr : null, landEdge: lEdgeN ? lEdge / lEdgeN / dpr : null, landN: lN, railN: rN });
      if (++n >= N) return resolve(out);
      requestAnimationFrame(tick);
    })();
  }), N);
}

async function crossLayerCore(engName, browser, opts, label) {
  const { page, errors } = await bootBreath(browser, opts);
  const proj = await sampleProjection(page, 80);
  // 平滑度(投影層級):每點 on-screen 2nd-diff、overlay-vs-float 誤差 p2p
  let maxSd = 0, maxErr = 0, edgePt = null;
  for (let j = 0; j < proj[0].pts.length; j++) {
    const over = proj.map(r => r.pts[j].over), flo = proj.map(r => r.pts[j].flo);
    maxSd = Math.max(maxSd, mx(sd2(over)));
    const ex = over.map((o, i) => o.x - flo[i].x), ey = over.map((o, i) => o.y - flo[i].y);
    const p2p = Math.hypot(Math.max(...ex) - Math.min(...ex), Math.max(...ey) - Math.min(...ey));
    maxErr = Math.max(maxErr, p2p);
    if (proj[proj.length - 1].pts[j].dc > (edgePt ? edgePt.dc : 0)) edgePt = { dc: proj[proj.length - 1].pts[j].dc };
  }
  // rAF 幀時
  const dts = []; for (let i = 1; i < proj.length; i++) dts.push(proj[i].t - proj[i - 1].t);
  const p95 = [...dts].sort((a, b) => a - b)[Math.floor(dts.length * 0.95)] || 0;
  // zoom 單調
  let nonMono = 0; for (let i = 1; i < proj.length; i++) if (proj[i].z < proj[i - 1].z - 1e-9) nonMono++;
  // 跨層(海陸頂點 vs 車站)相對位移 2nd-diff
  const rels = proj.map(r => r.rel).filter(Boolean);
  const crossProjSd = rels.length > 3 ? mx(sd2(rels)) : null;
  return { page, errors, maxSd, maxErr, p95, nonMono, zRange: [proj[0].z, proj[proj.length - 1].z], edgeDc: edgePt ? edgePt.dc : 0, crossProjSd };
}

// ══════════════ Chromium 桌面全項 ══════════════
{
  const browser = await chromium.launch();
  console.log('\n═══ chromium 1280×800 ═══');

  // T1 投影層級平滑 + 跨層(浮點投影,shimmer 應歸零)
  const c = await crossLayerCore('chromium', browser, { width: 1280, height: 800, bt: 37.5 }, 'desktop');
  ok('chromium T1a 呼吸平滑度 overlay 2nd-diff≤0.5px(基線2.8)', c.maxSd <= 0.5, `max=${r2(c.maxSd)}px @最遠點≈${Math.round(c.edgeDc)}px`);
  ok('chromium T1b overlay-vs-浮點真值誤差≈0(基線2.5)', c.maxErr <= 0.3, `p2p=${r2(c.maxErr)}px`);
  ok('chromium T1c 跨層相對運動平滑(海陸頂點vs車站 2nd-diff≤0.5px,基線1.4)', c.crossProjSd != null && c.crossProjSd <= 0.5, `crossSd=${r2(c.crossProjSd)}px`);

  // T1d 跨層像素級:海陸確由 overlay 自繪、且渲染質心逐幀平滑(心得16,真實像素;修前海陸2nd-diff達5px)
  await c.page.evaluate(() => { state._hotScene.bt = 25; }); // 拉到 z≈12 讓西岸海陸都在視野
  await c.page.waitForTimeout(120);
  const px = await samplePixels(c.page, 70);
  if (px.err) { ok('chromium T1d 海陸像素平滑', false, 'getImageData 失敗:' + px.err); }
  else {
    const withLand = px.filter(p => p.landCx != null && p.landN > 500);
    const landCx = withLand.map(p => p.landCx);
    const landSd = mx(sd(landCx));
    ok('chromium T1d 海陸確由 overlay 自繪(landN>500 幀數)', withLand.length >= px.length * 0.7, `${withLand.length}/${px.length} 幀`);
    ok('chromium T1d 海陸渲染質心逐幀平滑 2nd-diff≤0.5px(基線5)', withLand.length >= 30 && landSd <= 0.5, `landSd=${r2(landSd)}px, n=${withLand.length}`);
  }

  // T2 平滑度:rAF p95≤25ms、zoom 單調
  ok('chromium T2a rAF 幀時 p95≤25ms', c.p95 <= 25, `p95=${r2(c.p95)}ms`);
  ok('chromium T2b zoom 單調遞增(半週期)', c.nonMono === 0, `非單調=${c.nonMono}, z ${r2(c.zRange[0])}→${r2(c.zRange[1])}`);

  // T3 狀態還原:drag → 圖磚回場、zoomSnap 還原
  {
    const { page } = await bootBreath(browser, { width: 1280, height: 800, bt: 37.5 });
    const before = await page.evaluate(() => ({ bs: state._breathStage, zs: map.options.zoomSnap }));
    // 真實使用者拖曳
    await page.mouse.move(640, 400); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(640 - i * 12, 400 - i * 6); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      const want = state.mapDark ? 'dark' : (state.basemap === 'sat' ? 'sat' : 'light');
      const fp = map.getPane('fallbackPane');
      return { bs: state._breathStage, zs: map.options.zoomSnap, tileBack: !!(baseLayers[want] && map.hasLayer(baseLayers[want])), fpShown: fp ? fp.style.display !== 'none' : true };
    });
    ok('chromium T3a drag→呼吸退場(_breathStage=false)', before.bs === true && after.bs === false, `before=${before.bs} after=${after.bs}`);
    ok('chromium T3b drag→圖磚底圖回場(≤5s,立即)', after.tileBack === true, `tileBack=${after.tileBack}`);
    ok('chromium T3c drag→zoomSnap 還原=1、離線層顯示', after.zs === 1 && after.fpShown, `zoomSnap=${after.zs} fpShown=${after.fpShown}`);
    // 離開放空 → zoomSnap==1、zoom 整數、圖磚在場
    await page.evaluate(() => { setAmbient(false); });
    await page.waitForTimeout(300);
    const off = await page.evaluate(() => {
      const want = state.mapDark ? 'dark' : (state.basemap === 'sat' ? 'sat' : 'light');
      const z = map.getZoom();
      return { zs: map.options.zoomSnap, zInt: z === Math.round(z), z, bs: state._breathStage, tileBack: !!(baseLayers[want] && map.hasLayer(baseLayers[want])) };
    });
    ok('chromium T3d 離開放空→zoomSnap=1 且 zoom 整數 且圖磚在場', off.zs === 1 && off.zInt && off.tileBack && off.bs === false, JSON.stringify(off));
    await page.context().close();
  }

  // T4 不越界:?live=1 抽不到呼吸;劇場模式呼吸讓位
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-ambient-style', 'hotspot'); });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/?live=1&breath=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready && map; } catch (e) { return false; } }, null, { timeout: 30000 });
    const liveRes = await page.evaluate(() => new Promise(resolve => {
      state.ambient = true; state.ambientStyle = 'hotspot'; state.playing = true; state.followTrain = null; state.freqFollow = null;
      state._hotFresh = true; state._hotScene = null; state._hotNext = 0;
      let bad = false, ticks = 0;
      const iv = setInterval(() => {
        if (state._breathStage || (state._hotScene && state._hotScene.breath)) bad = true;
        if (++ticks >= 30) { clearInterval(iv); resolve({ live: state.liveMode, bad }); }
      }, 100);
    }));
    ok('chromium T4a ?live=1 永不進呼吸幕', liveRes.live === true && liveRes.bad === false, JSON.stringify(liveRes));
    await ctx.close();
  }
  {
    const { page } = await bootBreath(browser, { width: 1280, height: 800, bt: 37.5 });
    const th = await page.evaluate(() => { enterTheater(); return { bs: state._breathStage, th: state._theater }; });
    ok('chromium T4b 進劇場→呼吸讓位(_breathStage=false、_theater=true)', th.bs === false && th.th === true, JSON.stringify(th));
    await page.context().close();
  }

  // ── T5 空鏡頭防護(v0718h):錨點=軌道質心最近車站、組不出內容就取消 ──
  // 背景:CITY_BBOX 是整個行政區,台中/高雄幾何中心在山區(頭汴坑/旗美),拉近段視窗內零軌道=整片素色。
  {
    const { page } = await bootBreath(browser, { width: 1280, height: 800, bt: 37.5 });
    const t5 = await page.evaluate(() => {
      const out = { cities: {} };
      for (const id of ['taipei', 'taichung', 'kaohsiung']) {
        const a = breathAnchorFor(id);
        const b = CITY_BBOX[id];
        const c = L.latLngBounds([[b[0], b[1]], [b[2], b[3]]]).getCenter();
        // z15 視窗(1280×800)半高約 0.9km → 量錨點 ±0.008° 內站點數(含錨點自身;≥1=拉近正對真站有內容)
        let near = 0;
        const scan = s => { if (s && Math.abs(s.lat - a.lat) < 0.008 && Math.abs(s.lon - a.lon) < 0.008) near++; };
        (state.schedStations || []).forEach(scan);
        (state.lines || []).forEach(ln => (ln.stations || []).forEach(scan));
        (state.decoLines || []).forEach(ln => (ln.stations || []).forEach(scan));
        const kmOff = Math.round(L.latLng(a.lat, a.lon).distanceTo(c) / 100) / 10;
        out.cities[id] = { ok: !!a, near, kmOff };
      }
      const lg = state._landGeo; state._landGeo = null;
      out.noLand = pickBreathScene();
      state._landGeo = lg;
      const ss = state.schedStations, li = state.lines, dl = state.decoLines;
      state.schedStations = []; state.lines = []; state.decoLines = null;
      out.noRail = pickBreathScene();
      state.schedStations = ss; state.lines = li; state.decoLines = dl;
      return out;
    });
    const cs = t5.cities;
    ok('chromium T5a 三城錨點皆可得且正對車站(z15 視窗有內容)',
      ['taipei', 'taichung', 'kaohsiung'].every(id => cs[id].ok && cs[id].near >= 1),
      Object.entries(cs).map(([k, v]) => `${k}:near=${v.near},偏離bbox中心${v.kmOff}km`).join(' '));
    ok('chromium T5b 台中/高雄錨點已離開山區 bbox 中心(位移>5km)',
      cs.taichung.kmOff > 5 && cs.kaohsiung.kmOff > 5, `台中${cs.taichung.kmOff}km 高雄${cs.kaohsiung.kmOff}km`);
    ok('chromium T5c 海陸輪廓缺失→呼吸取消(null,落回一般巡航)', t5.noLand === null, String(t5.noLand));
    ok('chromium T5d 軌道資料不足→呼吸取消(null)', t5.noRail === null, String(t5.noRail));
    await page.context().close();
  }

  // 錯誤彙整
  ok('chromium 無 JS 例外', c.errors.length === 0, c.errors.slice(0, 2).join(' | '));
  await c.page.context().close();
  await browser.close();
}

// ══════════════ WebKit 手機 390 抽測跨層 ══════════════
try {
  const browser = await webkit.launch();
  console.log('\n═══ webkit 390×844(手機) ═══');
  const c = await crossLayerCore('webkit', browser, { width: 390, height: 844, touch: true, bt: 37.5 }, 'mobile');
  ok('webkit M1 手機呼吸平滑度 2nd-diff≤0.5px', c.maxSd <= 0.5, `max=${r2(c.maxSd)}px`);
  ok('webkit M2 手機 overlay-vs-浮點誤差≈0', c.maxErr <= 0.3, `p2p=${r2(c.maxErr)}px`);
  ok('webkit M3 手機跨層相對運動平滑(海陸頂點vs車站 2nd-diff≤0.5px)', c.crossProjSd != null && c.crossProjSd <= 0.5, `crossSd=${r2(c.crossProjSd)}px`);
  await c.page.evaluate(() => { state._hotScene.bt = 25; });
  await c.page.waitForTimeout(120);
  const px = await samplePixels(c.page, 60);
  if (px.err) ok('webkit M4 海陸像素平滑', false, px.err);
  else {
    const wl = px.filter(p => p.landCx != null && p.landN > 300);
    const landCx = wl.map(p => p.landCx); const landSd = mx(sd(landCx));
    ok('webkit M4 手機海陸渲染質心逐幀平滑 2nd-diff≤0.5px', wl.length >= 15 && landSd <= 0.5, `landSd=${r2(landSd)}px, n=${wl.length}`);
  }
  ok('webkit 無 JS 例外', c.errors.length === 0, c.errors.slice(0, 2).join(' | '));
  await c.page.context().close();
  await browser.close();
} catch (e) { ok('webkit 全項', false, 'webkit 啟動失敗:' + String(e).slice(0, 120)); }

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);
