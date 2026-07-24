// verify_zoom_anim.mjs — 縮放動畫回歸 + overlay 同步變換 的跨層驗證 (V1–V4)
// 跑法：先在本資料夾起 `python3 -m http.server 8791 --bind 127.0.0.1`，再 `node verify_zoom_anim.mjs`
// 心得16 標準：量「跨層對齊」而非單層；動畫類一律 Playwright 真引擎，不用內建 Browser pane。
import { chromium, webkit } from './node_modules/playwright/index.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const pass = (id, ok, msg) => { results.push({ id, ok, msg }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}: ${msg}`); };

async function loadApp(pg, file = 'index.html') {
  await pg.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await pg.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await pg.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  // 關掉會搶相機的模式，避免干擾量測
  await pg.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; if (window.setAmbient) try { window.setAmbient(false); } catch (e) {} });
  const el = await pg.$('#howtoWrap'); if (el) await pg.evaluate(() => { const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; });
  await pg.waitForTimeout(600);
}

// 真截圖非底色像素比例（把 Playwright PNG 灌回頁面 canvas 計算，同源不 taint）
async function nonBgRatioOfMapRegion(pg, bg) {
  const mapBox = await pg.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const buf = await pg.screenshot({ clip: mapBox });
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  return await pg.evaluate(async ({ dataUrl, bg }) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement('canvas'); c.width = Math.min(480, img.width); c.height = Math.round(c.width * img.height / img.width);
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let nonbg = 0, total = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - bg[0]) > 16 || Math.abs(d[i + 1] - bg[1]) > 16 || Math.abs(d[i + 2] - bg[2]) > 16) nonbg++;
    }
    return nonbg / total;
  }, { dataUrl, bg });
}

// 開一個乾淨分頁載入指定檔案、做一次 fromZ→toZ 縮放，逐幀量「已載入圖磚」對視窗的覆蓋率。
// 舊版(zoomAnimation:false)瞬跳＝舊圖磚立即被丟、新圖磚未到→覆蓋率掉到 0(使用者說的「消失」);
// 新版動畫期間舊圖磚縮放橋接→覆蓋率不塌。回傳最小覆蓋率＋一張動畫途中真截圖的非底色比例。
async function coverageProfile(ctx, file, fromZ, toZ, bg, center) {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; });
  const r = await p.evaluate(async ({ fromZ, toZ, center }) => {
    const map = window.__map; map.setView(center, fromZ, { animate: false });
    await new Promise(r => setTimeout(r, 900));
    const R = document.getElementById('map').getBoundingClientRect();
    const NX = 24, NY = 16, grid = [];
    for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) grid.push([R.left + (ix + 0.5) * R.width / NX, R.top + (iy + 0.5) * R.height / NY]);
    const cov = () => { const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0').map(t => t.getBoundingClientRect()); let c = 0; for (const [x, y] of grid) { for (const rr of rects) { if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { c++; break; } } } return c / grid.length; };
    const cov0 = cov(), series = [];
    map.setZoom(toZ); // 新版預設 animate:true；舊版 zoomAnimation:false → 瞬跳
    await new Promise(res => { let n = 0; const loop = () => { series.push(cov()); if (++n < 30) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 200));
    return { cov0, minCov: Math.min(...series), first5: series.slice(0, 5), covEnd: cov(), finalZoom: map.getZoom() };
  }, { fromZ, toZ, center });
  // 動畫途中真截圖非底色比例
  await p.evaluate((c) => window.__map.setView(c, fromZ, { animate: false }), center).catch(() => {});
  let midNonBg = 1;
  await p.evaluate(({ c, fromZ }) => window.__map.setView(c, fromZ, { animate: false }), { c: center, fromZ });
  await p.waitForTimeout(700);
  await p.evaluate((toZ) => window.__map.setZoom(toZ), toZ);
  for (let i = 0; i < 3; i++) { await p.waitForTimeout(55); try { midNonBg = Math.min(midNonBg, await nonBgRatioOfMapRegion(p, bg)); } catch (e) {} }
  await p.close();
  return { ...r, midNonBg };
}

// 拖曳平移中量「軌道 overlay 落後圖磚」的像素：儀器化 draw() 記錄每次繪製當下的 mapPane 位移，
// 逐幀取樣「現在 pane 位移 − 上次 draw 當下 pane 位移」＝軌道相對圖磚的落後量。省電節流會讓 draw 掉到 30fps → 落後。
async function dragLagProfile(ctx, file, powerSave, center) {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate((ps) => {
    const s = window.__state; s.ambient = false; s._hotNext = 1e18; s.powerSave = ps;
    const w = document.getElementById('howtoWrap'); if (w) w.hidden = true;
    const orig = window.draw; window.__drawN = 0;
    window.draw = function () { try { window.__drawPane = window.__map._getMapPanePos().clone(); window.__drawN++; } catch (e) {} return orig.apply(this, arguments); };
    window.__map.setView([25.047, 121.517], 14, { animate: false });
  }, powerSave);
  await p.waitForTimeout(800);
  const box = await p.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await p.evaluate(() => {
    window.__lag = []; window.__drawN0 = window.__drawN; window.__t0 = performance.now(); const map = window.__map;
    const loop = () => { if (window.__drawPane) { const q = map._getMapPanePos(); window.__lag.push(Math.hypot(q.x - window.__drawPane.x, q.y - window.__drawPane.y)); }
      if (performance.now() - window.__t0 < 600) requestAnimationFrame(loop); else window.__lagDone = true; };
    requestAnimationFrame(loop);
  });
  const t0 = Date.now(); let x = cx, y = cy;
  while (Date.now() - t0 < 600) { x -= 5; y -= 2; await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' }); await new Promise(r => setTimeout(r, 6)); }
  await p.waitForFunction(() => window.__lagDone, { timeout: 3000 }).catch(() => {});
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' });
  const r = await p.evaluate(() => {
    const draws = window.__drawN - window.__drawN0, dur = (performance.now() - window.__t0) / 1000, lag = window.__lag.filter(Number.isFinite);
    return { drawFps: +(draws / dur).toFixed(1), maxLag: +Math.max(...lag).toFixed(2), avgLag: +(lag.reduce((a, b) => a + b, 0) / lag.length).toFixed(2) };
  });
  await p.close(); return r;
}

// 待機時(無互動 >1.5s)省電節流是否仍生效——確認互動全速豁免沒把省電整個關掉
async function idleDrawFps(ctx, file, powerSave) {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate((ps) => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; s.powerSave = ps; s.playing = true; const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; window.__map.setView([25.047, 121.517], 12, { animate: false }); }, powerSave);
  await p.waitForTimeout(2000); // 讓 _interactAt 過期(>1.5s 無互動)
  const fps = await p.evaluate(async () => {
    const s = window.__state; const n0 = s._drawCount || 0; const t0 = performance.now();
    await new Promise(r => setTimeout(r, 1000)); // 期間不做任何互動
    return +(((s._drawCount || 0) - n0) / ((performance.now() - t0) / 1000)).toFixed(1);
  });
  await p.close(); return fps;
}

async function getBg(pg) {
  return await pg.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.leaflet-container')).backgroundColor;
    const m = s.match(/(\d+)/g).map(Number); return [m[0], m[1], m[2]];
  });
}

// ── V2：動畫期間逐幀比對 #overlay 與 .leaflet-tile-container 的 transform（換算到同座標系的最大位移誤差）
async function v2CrossLayer(pg, center) {
  const out = await pg.evaluate(async ({ center }) => {
    const map = window.__map;
    map.setView(center, 12, { animate: false });
    await new Promise(r => setTimeout(r, 700));
    const ov = document.getElementById('overlay');
    const tc = document.querySelector('.leaflet-tile-container.leaflet-zoom-animated') || document.querySelector('.leaflet-tile-container');
    const R = document.getElementById('map').getBoundingClientRect();
    // 參考點：四角＋中心（container 座標，origin 0,0）
    const refs = [[0, 0], [R.width, 0], [0, R.height], [R.width, R.height], [R.width / 2, R.height / 2]];
    const mapPt = (mstr, p) => { const m = new DOMMatrix(mstr); return { x: m.a * p[0] + m.c * p[1] + m.e, y: m.b * p[0] + m.d * p[1] + m.f }; };
    const samples = [];
    map.setZoomAround(map.latLngToContainerPoint(center), 14);
    await new Promise(res => { let n = 0; const loop = () => {
      const so = getComputedStyle(ov), st = getComputedStyle(tc);
      let maxd = 0;
      if (so.transform !== 'none' && st.transform !== 'none') {
        for (const p of refs) { const a = mapPt(so.transform, p), b = mapPt(st.transform, p); maxd = Math.max(maxd, Math.hypot(a.x - b.x, a.y - b.y)); }
      }
      const sc = so.transform === 'none' ? 1 : new DOMMatrix(so.transform).a;
      samples.push({ ovT: so.transform, tcT: st.transform, ovOrigin: so.transformOrigin, maxd, sc });
      if (++n < 26) requestAnimationFrame(loop); else res();
    }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 180));
    return { samples, ovAfter: getComputedStyle(ov).transform, zoomAnimFlag: !!window.__state._zoomAnim };
  }, { center });
  // 分析：只看兩層都有 transform 的幀
  const active = out.samples.filter(s => s.ovT !== 'none' && s.tcT !== 'none');
  const maxErr = active.length ? Math.max(...active.map(s => s.maxd)) : 999;
  const midFrames = active.filter(s => s.sc > 1.1 && s.sc < 3.6).length; // 證明確有取到「動畫途中」的幀
  const origin0 = active.every(s => /^0px 0px|^0% 0%|^0px 0px 0px/.test(s.ovOrigin));
  return { maxErr, midFrames, activeFrames: active.length, ovAfter: out.ovAfter, zoomAnimFlag: out.zoomAnimFlag, origin0 };
}

async function run(browserType, label, { mobile, cdp } = {}) {
  console.log(`\n===== ${label} =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  const TAIPEI = [25.047, 121.517];
  await loadApp(pg);
  const bg = await getBg(pg);

  // ── V1：縮放中不再「消失」——新版 vs 舊版 HEAD 差分（典型 1 級 wheel 縮放，放大＋縮小各一）
  // 判準：新版動畫期間真圖磚覆蓋率不塌(min≥0.5)，且明顯高於舊版瞬跳(差距≥0.4)；舊版會掉到 ~0(即使用者回報的消失)。
  try {
    const nIn = await coverageProfile(ctx, 'index.html', 13, 14, bg, TAIPEI);
    const oIn = await coverageProfile(ctx, 'index_old.html', 13, 14, bg, TAIPEI);
    const nOut = await coverageProfile(ctx, 'index.html', 14, 13, bg, TAIPEI);
    const oOut = await coverageProfile(ctx, 'index_old.html', 14, 13, bg, TAIPEI);
    const ok = nIn.minCov >= 0.5 && (nIn.minCov - oIn.minCov) >= 0.4 && nIn.midNonBg >= 0.80
      && (nOut.minCov - oOut.minCov) >= 0.3;
    pass(`${label}/V1`, ok,
      `zoomIN new.minCov=${nIn.minCov.toFixed(3)} vs old=${oIn.minCov.toFixed(3)} (new first5=[${nIn.first5.map(x => x.toFixed(2))}]); ` +
      `zoomOUT new=${nOut.minCov.toFixed(3)} vs old=${oOut.minCov.toFixed(3)}; new midNonBgPixels=${nIn.midNonBg.toFixed(3)} — 新版縮放中圖磚常在、舊版瞬跳掉到空`);
  } catch (e) { pass(`${label}/V1`, false, 'error ' + e.message); }

  // ── V2：跨層同步（僅桌面，行動不重複）
  if (!mobile) try {
    const v2 = await v2CrossLayer(pg, TAIPEI);
    const ok = v2.maxErr <= 2 && v2.midFrames >= 3 && v2.ovAfter === 'none' && !v2.zoomAnimFlag && v2.origin0;
    pass(`${label}/V2`, ok, `maxCrossLayerErr=${v2.maxErr.toFixed(3)}px, midAnimFrames=${v2.midFrames}/${v2.activeFrames}, overlayCleared=${v2.ovAfter === 'none'}, flagCleared=${!v2.zoomAnimFlag}, origin0=${v2.origin0}`);
  } catch (e) { pass(`${label}/V2`, false, 'error ' + e.message); }

  // ── V3：動畫結束後靜態對齊（新版 vs 舊版 HEAD 同視野像素比對，靜態應一致）
  try {
    const fixView = async (page, file) => {
      const p2 = await ctx.newPage(); await p2.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
      await p2.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
      await p2.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
      await p2.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; });
      await p2.evaluate((c) => window.__map.setView(c, 13, { animate: false }), TAIPEI);
      await p2.waitForTimeout(1600);
      const box = await p2.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const buf = await p2.screenshot({ clip: box }); await p2.close(); return buf;
    };
    const bNew = await fixView(pg, 'index.html');
    const bOld = await fixView(pg, 'index_old.html');
    // 像素差比例（同源 canvas 內算）
    const diff = await pg.evaluate(async ({ a, b }) => {
      const load = u => new Promise(async res => { const im = new Image(); im.src = u; await im.decode(); res(im); });
      const ia = await load('data:image/png;base64,' + a), ib = await load('data:image/png;base64,' + b);
      const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
      const mk = im => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, w, h).data; };
      const da = mk(ia), db = mk(ib); let diff = 0; const n = w * h;
      for (let i = 0; i < da.length; i += 4) { if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) diff++; }
      return diff / n;
    }, { a: bNew.toString('base64'), b: bOld.toString('base64') });
    pass(`${label}/V3`, diff <= 0.02, `staticDiff(new vs old HEAD)=${(diff * 100).toFixed(3)}% — 靜態渲染(軌道/底圖對齊)與修改前一致`);
  } catch (e) { pass(`${label}/V3`, false, 'error ' + e.message); }

  // ── V4：迴歸矩陣
  try {
    // (a) 連續快速縮放 ×5 不卡死、不殘留 transform、旗標歸零、reproject 恢復
    await pg.evaluate((c) => window.__map.setView(c, 11, { animate: false }), TAIPEI);
    await pg.waitForTimeout(500);
    await pg.evaluate(async (c) => {
      const m = window.__map;
      for (let i = 0; i < 5; i++) { m.setZoomAround(m.latLngToContainerPoint(c), m.getZoom() + 1); await new Promise(r => setTimeout(r, 70)); }
    }, TAIPEI);
    await pg.waitForTimeout(900);
    // 連續縮放後不可殘留 transform/凍結旗標(否則畫面卡住/殘影);靜置後地圖應完整鋪滿(重投影已恢復)
    const st = await pg.evaluate(() => {
      const R = document.getElementById('map').getBoundingClientRect(), grid = [];
      for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 18; ix++) grid.push([R.left + (ix + 0.5) * R.width / 18, R.top + (iy + 0.5) * R.height / 12]);
      const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).map(t => t.getBoundingClientRect());
      let c = 0; for (const [x, y] of grid) { for (const rr of rects) { if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { c++; break; } } }
      return { ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, z: window.__map.getZoom(), restCov: c / grid.length };
    });
    const okA = st.ov === 'none' && !st.flag && st.restCov >= 0.95;
    pass(`${label}/V4a`, okA, `rapid5x settled: overlayTransform=${st.ov}, frozenFlag=${st.flag}, zoom=${st.z}, restTileCoverage=${st.restCov.toFixed(3)} — 無卡死/殘影/凍結`);

    // (b) flyTo 不觸發 zoomanim（不受本機制影響），且結束後 overlay 乾淨
    const fly = await pg.evaluate(async () => {
      const m = window.__map; m.setView([25.047, 121.517], 12, { animate: false }); await new Promise(r => setTimeout(r, 400));
      let animFired = 0; const h = () => animFired++; m.on('zoomanim', h);
      m.flyTo([22.63, 120.30], 14, { duration: 0.7 }); // 飛去高雄
      await new Promise(r => setTimeout(r, 1400)); m.off('zoomanim', h);
      return { animFired, ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, z: m.getZoom(), c: m.getCenter() };
    });
    pass(`${label}/V4b`, fly.animFired === 0 && fly.ov === 'none' && !fly.flag, `flyTo: zoomanimFired=${fly.animFired}(應0), overlay=${fly.ov}, flag=${fly.flag}, endZoom=${fly.z}`);

    // (c) 跟車模式中縮放正常（不卡死、覆蓋不塌、旗標歸零）
    const followOk = await pg.evaluate(async (c) => {
      const s = window.__state, m = window.__map;
      // 進跟車：優先用 setFollow（非 module 頂層函式掛在 window），否則手動塞
      let tr = null;
      for (const sys of s.systems) { const t = (sys.data && sys.data.trains) || []; if (t.length) { tr = t.find(x => x.stops && x.stops.length > 2) || t[0]; if (tr) break; } }
      if (!tr) return { entered: false };
      if (typeof window.setFollow === 'function') { try { window.setFollow(tr); } catch (e) {} }
      if (!s.followTrain) { s.followTrain = tr; s.followLock = true; }
      await new Promise(r => setTimeout(r, 400));
      const zoomingOk = (typeof s.followTrain === 'object');
      m.setZoomAround(m.getSize().divideBy(2), m.getZoom() + 2); // 跟車中縮放
      await new Promise(r => setTimeout(r, 700));
      const flag = !!s._zoomAnim, ov = getComputedStyle(document.getElementById('overlay')).transform;
      if (typeof window.clearFollow === 'function') try { window.clearFollow(); } catch (e) {}
      s.followTrain = null; s.followLock = false;
      return { entered: true, following: zoomingOk, flag, ov };
    }, TAIPEI);
    pass(`${label}/V4c`, followOk.entered && !followOk.flag && followOk.ov === 'none', `followZoom: entered=${followOk.entered}, flagCleared=${!followOk.flag}, overlay=${followOk.ov}`);

    // (d) 行動捏合（僅 mobile chromium）— CDP synthesizePinchGesture 不空白
    if (mobile) {
      const cdp = await ctx.newCDPSession(pg);
      await pg.evaluate((c) => window.__map.setView(c, 12, { animate: false }), TAIPEI);
      await pg.waitForTimeout(700);
      const before = await pg.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).length);
      try { await cdp.send('Input.synthesizePinchGesture', { x: 187, y: 400, scaleFactor: 2.0, relativeSpeed: 800 }); } catch (e) {}
      await pg.waitForTimeout(300);
      const midNonBg = await nonBgRatioOfMapRegion(pg, bg);
      await pg.waitForTimeout(600);
      const st2 = await pg.evaluate(() => ({ ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, z: window.__map.getZoom(), tiles: [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).length }));
      pass(`${label}/V4d`, midNonBg >= 0.75 && !st2.flag && st2.ov === 'none', `pinch: midNonBgPixels=${midNonBg.toFixed(3)}, flagCleared=${!st2.flag}, overlay=${st2.ov}, zoom=${st2.z}, tiles=${st2.tiles}`);
    }

    if (!mobile) {
      // (e) 拖曳平移中「軌道跟上圖磚」——省電模式開啟(手機預設)下逐幀量 overlay 落後圖磚的像素。
      //     新版應 ≤2px；舊版 HEAD 因省電 30fps 節流吃掉互動全速→明顯落後(差分證明修好)。
      //     用 CDP 逐幀派 mousemove(pacing 最真)，僅 Chromium 支援；WebKit 跳過(節流邏輯與引擎無關，Chromium 覆蓋足夠)。
      if (cdp) {
        const dNew = await dragLagProfile(ctx, 'index.html', true, TAIPEI);
        const dOld = await dragLagProfile(ctx, 'index_old.html', true, TAIPEI);
        const dNewOff = await dragLagProfile(ctx, 'index.html', false, TAIPEI);
        const okE = dNew.maxLag <= 2 && (dOld.maxLag - dNew.maxLag) >= 2 && dNewOff.maxLag <= 2;
        pass(`${label}/V4e`, okE, `dragLag(powerSave ON): new.maxLag=${dNew.maxLag}px(fps${dNew.drawFps}) vs old=${dOld.maxLag}px(fps${dOld.drawFps}); new(powerSave OFF)=${dNewOff.maxLag}px — 拖曳中軌道跟上圖磚`);
      }

      // (f) 待機省電節流未被破壞：無互動 >1.5s 後，powerSave 開仍節流(~30fps)、關則全速
      const idleOn = await idleDrawFps(ctx, 'index.html', true);
      const idleOff = await idleDrawFps(ctx, 'index.html', false);
      pass(`${label}/V4f`, idleOn <= 42 && idleOff >= idleOn, `idle throttle preserved: powerSaveON=${idleOn}fps(應~30，節流仍在), powerSaveOFF=${idleOff}fps`);

      // (g) 拖曳中途接縮放：省電開＋互動視窗內做動畫縮放，_zoomAnim 正確起落、overlay 清乾淨、不打架
      const g = await pg.evaluate(async (c) => {
        const s = window.__state, m = window.__map; s.powerSave = true; s.ambient = false; s._hotNext = 1e18;
        m.setView(c, 12, { animate: false }); await new Promise(r => setTimeout(r, 500));
        s._interactAt = performance.now(); // 模擬「拖曳中」持續互動
        let sawFlag = false; const iv = setInterval(() => { if (s._zoomAnim) sawFlag = true; }, 8);
        m.setZoom(14); // 動畫縮放
        await new Promise(r => setTimeout(r, 500)); clearInterval(iv);
        return { sawFlag, flagAfter: !!s._zoomAnim, ov: getComputedStyle(document.getElementById('overlay')).transform, z: m.getZoom() };
      }, TAIPEI);
      pass(`${label}/V4g`, g.sawFlag && !g.flagAfter && g.ov === 'none' && g.z === 14, `drag→zoom(powerSave ON): zoomAnimEntered=${g.sawFlag}, cleared=${!g.flagAfter}, overlay=${g.ov}, zoom=${g.z}`);
    }
  } catch (e) { pass(`${label}/V4`, false, 'error ' + e.message); }

  await browser.close();
}

await run(chromium, 'chromium-desktop', { cdp: true });
await run(chromium, 'chromium-mobile', { mobile: true, cdp: true });
await run(webkit, 'webkit-desktop', {}); // 心得10/27：釋出版 Safari 主力引擎，至少跑 V1+V3（本 harness 為 trunk WebKit，作參考）；CDP 專案(V4e)Chromium 才有

console.log('\n================ SUMMARY ================');
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.msg}`);
console.log(`\n${results.length - fails.length}/${results.length} checks passed.`);
process.exit(fails.length ? 1 : 0);
