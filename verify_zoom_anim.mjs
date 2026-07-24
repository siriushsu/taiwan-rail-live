// verify_zoom_anim.mjs — 縮放動畫回歸 + overlay 同步變換 的跨層驗證 (V1–V4)
// 跑法：
//   1) 生差分基準（皆為暫存檔，驗完可刪）：
//        git show main:index.html    > index_old.html     # 修復前(zoomAnimation:false)＝V1「消失」對照 / V4e 拖曳落後對照
//        git show 98222db:index.html > index_buggy.html   # 縮放錯位 bug 版(layer-space 公式)＝V2b 核心回歸對照
//   2) 起靜態站：`python3 -m http.server 8791 --bind 127.0.0.1`
//   3) `node verify_zoom_anim.mjs`
// 心得16 標準：量「跨層對齊」而非單層；動畫類一律 Playwright 真引擎，不用內建 Browser pane。
import { chromium, webkit } from './node_modules/playwright/index.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const naResults = []; // 「驗不了」(harness/引擎限制)：如實記錄+附原因，不計入 pass/fail，也不靜默跳過
const pass = (id, ok, msg) => { results.push({ id, ok, msg }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}: ${msg}`); };
const na = (id, msg) => { naResults.push({ id, msg }); console.log(`  [N/A ] ${id}: ${msg}`); };

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

// ── V2 家族：動畫期間「圖磚實際渲染位置」 vs 「overlay 對同一世界點的位置」的最大錯位（跨層引擎真值對齊）
// 關鍵：不比兩層 transform 的字面值（舊 V2 的錯誤——那要求 M_ov==M_tc，只有 panePos=0 才成立，平移後就假通過）。
// 改直接量圖磚 NW 角的 getBoundingClientRect（瀏覽器已把 mapPane 平移＋容器 scale 全合成，零建模＝引擎真值），
// 對照 overlay 用它自己那一個 transform(origin 0 0) 把「凍結於起始幀的同一角 container 座標 q」映射到的位置。
// 兩者對同一世界點應重合(≤2px)。panBy 製造非零 panePos 重現「平移後再縮放」——舊式漏 (s−1)·panePos，錯位=常數偏移。
async function zoomAlignProfile(ctx, file, { center, fromZ, toZ, panBy, rapid }) {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; });
  const r = await p.evaluate(async ({ center, fromZ, toZ, panBy, rapid }) => {
    const map = window.__map, mapEl = document.getElementById('map'), ov = document.getElementById('overlay');
    const applyM = (mstr, q) => { const m = new DOMMatrix(mstr === 'none' ? undefined : mstr); return { x: m.a * q[0] + m.c * q[1] + m.e, y: m.b * q[0] + m.d * q[1] + m.f }; };
    map.setView(center, fromZ, { animate: false });
    await new Promise(r => setTimeout(r, 800));
    if (panBy) { map.panBy(panBy, { animate: false }); await new Promise(r => setTimeout(r, 400)); } // 非零 panePos，不重設 pixelOrigin
    const pp0 = map._getMapPanePos();
    const R = mapEl.getBoundingClientRect();
    // 取起始幀圖磚樣本（誤差為常數偏移，任一片即可揭露 bug，多片防脫落）。★只取中央帶★：邊緣圖磚在 WebKit CSS-scale
    // 過渡下會被裁切/剔除，其 getBoundingClientRect 有次像素取樣噪聲（compositor 與主執行緒不同幀），會虛胖 max；
    // 中央帶是量測儀器可信區（實測中央片 WebKit≈0.75px、邊緣片才飆到 4px）。bug 是常數偏移不受此影響。
    const cand = [...document.querySelectorAll('img.leaflet-tile')]
      .filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0')
      .map(t => { const b = t.getBoundingClientRect(); return { el: t, q: [b.left - R.left, b.top - R.top], mx: b.left + b.width / 2 - R.left, my: b.top + b.height / 2 - R.top }; })
      .filter(s => s.mx > R.width * 0.22 && s.mx < R.width * 0.78 && s.my > R.height * 0.18 && s.my < R.height * 0.82);
    cand.sort((a, b) => a.mx - b.mx);
    const picks = []; const step = Math.max(1, Math.floor(cand.length / 8));
    for (let i = 0; i < cand.length && picks.length < 8; i += step) picks.push(cand[i]);
    const measure = () => {
      const so = getComputedStyle(ov), t = so.transform, active = t !== 'none';
      const sc = active ? new DOMMatrix(t).a : 1; let maxd = 0, cnt = 0;
      if (active) for (const s of picks) {
        if (!s.el.isConnected) continue; const rb = s.el.getBoundingClientRect(); if (!rb.width) continue;
        const tileNow = { x: rb.left - R.left, y: rb.top - R.top }, ovNow = applyM(t, s.q);
        maxd = Math.max(maxd, Math.hypot(tileNow.x - ovNow.x, tileNow.y - ovNow.y)); cnt++;
      }
      return { sc, maxd, cnt, active, origin0: /^0px 0px/.test(so.transformOrigin) };
    };
    const samples = [];
    map.setZoomAround(map.latLngToContainerPoint(center), toZ); // 以（平移後的）中心點為軸做動畫縮放
    await new Promise(res => { let n = 0; const loop = () => { samples.push(measure()); if (++n < 32) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 260));
    const after = { ov: getComputedStyle(ov).transform, flag: !!window.__state._zoomAnim, z: map.getZoom() };
    let rapidState = null;
    if (rapid) { // 連續快速縮放後不得殘留 transform／凍結旗標（漂移／殘影）
      map.setView(center, fromZ, { animate: false }); await new Promise(r => setTimeout(r, 300));
      for (let i = 0; i < 3; i++) { map.setZoomAround(map.latLngToContainerPoint(center), map.getZoom() + 1); await new Promise(r => setTimeout(r, 90)); }
      await new Promise(r => setTimeout(r, 900));
      rapidState = { ov: getComputedStyle(ov).transform, flag: !!window.__state._zoomAnim, z: map.getZoom() };
    }
    const active = samples.filter(s => s.active && s.cnt > 0);
    const sortedD = active.map(s => s.maxd).sort((a, b) => b - a);
    const maxMisalign = sortedD.length ? sortedD[0] : 999;
    // robustMax＝丟掉單一最高幀後的次高值：WebKit 偶有單幀 getBoundingClientRect 取樣毛刺(compositor 與主執行緒差半幀)，
    // 實測 15/16 幀為 0px、僅 1 幀跳到 ~2px；真正的座標錯位是「常數偏移、每幀皆錯」(如舊版每幀 130–260px)，次高值照樣揭露。
    const robustMax = sortedD.length >= 2 ? sortedD[1] : (sortedD[0] ?? 999);
    const framesOver2 = active.filter(s => s.maxd > 2).length;
    const midFrames = active.filter(s => Math.abs(s.sc - 1) > 0.08).length; // 確有取到「動畫途中」的幀
    const origin0 = active.length > 0 && active.every(s => s.origin0);
    return { pp0: { x: +pp0.x.toFixed(1), y: +pp0.y.toFixed(1) }, nPicks: picks.length, maxMisalign: +maxMisalign.toFixed(2), robustMax: +robustMax.toFixed(2), framesOver2, midFrames, activeFrames: active.length, origin0, after, rapidState };
  }, { center, fromZ, toZ, panBy, rapid });
  await p.close();
  return r;
}

// ── V5 家族：真捏合手勢(genuine 2-finger touch)期間 overlay 與圖磚「整張 raster 同步縮放」的跨層驗證 ──
// 為何不用 CDP synthesizePinchGesture：實測它不會驅動 Leaflet 的 TouchZoom（map.touchZoom._zooming 恆 false），
// 而是被當成 wheel 式離散 animated zoom（走 onZoomAnim 路徑、zoom 一路跳到 maxZoom）→ 完全繞過本次要驗的
// 捏合 zoom handler（其閘門 = map.touchZoom._zooming）。正確原語是 CDP Input.dispatchTouchEvent（真多點觸控事件，
// touches.length===2 → Leaflet _onTouchStart 引擎級觸發 TouchZoom，逐幀 _move 發 zoom → 捏合 handler 生效）。
// 量測：頁內 rAF 取樣器逐幀記 overlay 的 computed transform scale、getZoom()、跨層對齊誤差(圖磚 rect vs overlay
// transform 對映同一凍結 container 座標 q，同 V2 家族真值對齊法)、_zooming/_zoomAnim 相位；手勢結束後才斷言。
async function pinchProfile(ctx, file, { center, fromZ, panBy, dir }) {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; });
  const cdp = await ctx.newCDPSession(p);
  // 設視圖(可選平移)→ 凍結起始幀圖磚取樣(中央帶,同 zoomAlignProfile)→ 掛 rAF 取樣器
  await p.evaluate(async ({ center, fromZ, panBy }) => {
    const map = window.__map;
    map.setView(center, fromZ, { animate: false });
    await new Promise(r => setTimeout(r, 800));
    if (panBy) { map.panBy(panBy, { animate: false }); await new Promise(r => setTimeout(r, 400)); } // 非零 panePos＝互動累積狀態
    const pp0 = map._getMapPanePos(); window.__pp0 = { x: +pp0.x.toFixed(1), y: +pp0.y.toFixed(1) };
    const R = document.getElementById('map').getBoundingClientRect();
    const cand = [...document.querySelectorAll('img.leaflet-tile')]
      .filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0')
      .map(t => { const b = t.getBoundingClientRect(); return { el: t, q: [b.left - R.left, b.top - R.top], mx: b.left + b.width / 2 - R.left, my: b.top + b.height / 2 - R.top }; })
      .filter(s => s.mx > R.width * 0.22 && s.mx < R.width * 0.78 && s.my > R.height * 0.18 && s.my < R.height * 0.82);
    cand.sort((a, b) => a.mx - b.mx);
    const picks = []; const step = Math.max(1, Math.floor(cand.length / 8));
    for (let i = 0; i < cand.length && picks.length < 8; i += step) picks.push(cand[i]);
    window.__picks = picks; window.__pstart = map.getZoom();
    const ov = document.getElementById('overlay');
    const applyM = (mstr, q) => { const m = new DOMMatrix(mstr === 'none' ? undefined : mstr); return { x: m.a * q[0] + m.c * q[1] + m.e, y: m.b * q[0] + m.d * q[1] + m.f }; };
    window.__ps = []; window.__psRec = true;
    const rec = () => {
      if (!window.__psRec) return;
      const so = getComputedStyle(ov), t = so.transform, active = t !== 'none';
      const sc = active ? new DOMMatrix(t).a : 1, z = map.getZoom();
      const zooming = !!(map.touchZoom && map.touchZoom._zooming), animZoom = !!map._animatingZoom;
      let maxd = 0, cnt = 0;
      if (active) {
        const Rc = document.getElementById('map').getBoundingClientRect();
        for (const s of window.__picks) { if (!s.el.isConnected) continue; const rb = s.el.getBoundingClientRect(); if (!rb.width) continue;
          const tileNow = { x: rb.left - Rc.left, y: rb.top - Rc.top }, ovNow = applyM(t, s.q);
          maxd = Math.max(maxd, Math.hypot(tileNow.x - ovNow.x, tileNow.y - ovNow.y)); cnt++; }
      }
      window.__ps.push({ z, active, ovScale: sc, expScale: map.getZoomScale(z, window.__pstart), zooming, animZoom, maxd, cnt, origin0: /^0px 0px/.test(so.transformOrigin) });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  }, { center, fromZ, panBy });
  // 用 CDP 派真多點觸控事件驅動 TouchZoom（dir:'in' 兩指張開＝放大／'out' 兩指併攏＝縮小）
  const box = await p.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
  const dStart = dir === 'out' ? 150 : 26, dEnd = dir === 'out' ? 26 : 150, steps = 18;
  const tp = (d) => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(dStart) });
  await p.waitForTimeout(20);
  const zStart = await p.evaluate(() => !!(window.__map.touchZoom && window.__map.touchZoom._zooming));
  for (let i = 1; i <= steps; i++) { const d = Math.round(dStart + (dEnd - dStart) * i / steps); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(d) }); await new Promise(r => setTimeout(r, 18)); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(950); // 含 touchend 收斂動畫(走 onZoomAnim)＋解凍
  const r = await p.evaluate(() => {
    window.__psRec = false; const s = window.__ps;
    const engaged = s.filter(x => x.zooming);
    const pinch = s.filter(x => x.active && x.zooming && x.cnt > 0);        // 跟手捏合幀
    const converge = s.filter(x => x.active && !x.zooming && x.animZoom && x.cnt > 0); // touchend 收斂動畫幀
    // (a) scale 同步：跟手幀中「有明顯縮放」者，overlay 實際 scale 對 getZoomScale(當幀,起始) 的相對誤差
    const scaleFrames = pinch.filter(x => Math.abs(x.ovScale - 1) > 0.04);
    const scaleErrs = scaleFrames.map(x => Math.abs(x.ovScale / x.expScale - 1));
    const maxScaleErr = scaleErrs.length ? Math.max(...scaleErrs) : 999;
    // (b) 跨層對齊：跟手幀；robustMax 丟單幀取樣毛刺(同 zoomAlignProfile)
    const dPinch = pinch.map(x => x.maxd).sort((a, b) => b - a);
    const pinchMax = dPinch.length ? dPinch[0] : 999, pinchRobust = dPinch.length >= 2 ? dPinch[1] : (dPinch[0] ?? 999);
    const pinchOver2 = pinch.filter(x => x.maxd > 2).length;
    // (c) 收斂→靜止：收斂動畫幀對齊 + 最終 overlay 清空
    const dConv = converge.map(x => x.maxd).sort((a, b) => b - a);
    const convRobust = dConv.length >= 2 ? dConv[1] : (dConv[0] ?? 0);
    const zoomVals = engaged.map(x => x.z);
    return {
      pp0: window.__pp0, nPicks: window.__picks.length, startZoom: +window.__pstart.toFixed(3),
      pinchFrames: pinch.length, scaleFrames: scaleFrames.length, convFrames: converge.length,
      maxScaleErr: +maxScaleErr.toFixed(4), pinchMax: +pinchMax.toFixed(2), pinchRobust: +pinchRobust.toFixed(2), pinchOver2,
      convRobust: +convRobust.toFixed(2), origin0: pinch.length > 0 && pinch.every(x => x.origin0),
      zoomSpan: zoomVals.length ? +(Math.max(...zoomVals) - Math.min(...zoomVals)).toFixed(3) : 0,
      after: { ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, z: +window.__map.getZoom().toFixed(3) },
    };
  });
  // 手勢結束後：確認內容已按新 zoom 重繪(靜置圖磚鋪滿＝reproject/draw 有跑)
  const restCov = await p.evaluate(() => {
    const R = document.getElementById('map').getBoundingClientRect(), grid = [];
    for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 18; ix++) grid.push([R.left + (ix + 0.5) * R.width / 18, R.top + (iy + 0.5) * R.height / 12]);
    const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).map(t => t.getBoundingClientRect());
    let c = 0; for (const [x, y] of grid) { for (const rr of rects) { if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { c++; break; } } }
    return +(c / grid.length).toFixed(3);
  });
  r.zStartFlag = zStart; r.restCov = restCov;
  await p.close();
  return r;
}

// 捏合系列（僅 Chromium：CDP dispatchTouchEvent 才驅動得了 TouchZoom）
async function runPinch(browserType, label) {
  console.log(`\n===== ${label} =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const TAIPEI = [25.047, 121.517];

  // V5：捏合放大（乾淨載入）
  try {
    const a = await pinchProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 12, dir: 'in' });
    const ok = a.zStartFlag && a.pinchFrames >= 5 && a.scaleFrames >= 3 && a.maxScaleErr <= 0.05
      && a.pinchRobust <= 2 && a.origin0 && a.after.ov === 'none' && !a.after.flag && a.restCov >= 0.9;
    pass(`${label}/V5`, ok, `pinch-IN engaged=${a.zStartFlag} zoomSpan=${a.zoomSpan} pinchFrames=${a.pinchFrames}(scale${a.scaleFrames}) | scaleSyncErr max=${(a.maxScaleErr * 100).toFixed(2)}%(≤5%) | crossLayer robust=${a.pinchRobust}px(max${a.pinchMax},over2=${a.pinchOver2}) origin0=${a.origin0} | converge robust=${a.convRobust}px | after ov=${a.after.ov} flag=${a.after.flag} z=${a.after.z} restCov=${a.restCov}`);
  } catch (e) { pass(`${label}/V5`, false, 'error ' + e.message); }

  // V5b：先平移再捏合放大（互動累積狀態，上次漏測路徑）
  try {
    const b = await pinchProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 12, dir: 'in', panBy: [220, 140] });
    const panned = Math.hypot(b.pp0.x, b.pp0.y) >= 150;
    const ok = panned && b.zStartFlag && b.pinchFrames >= 5 && b.scaleFrames >= 3 && b.maxScaleErr <= 0.05
      && b.pinchRobust <= 2 && b.after.ov === 'none' && !b.after.flag && b.restCov >= 0.9;
    pass(`${label}/V5b`, ok, `panned panePos=(${b.pp0.x},${b.pp0.y}) |${Math.hypot(b.pp0.x, b.pp0.y).toFixed(0)}px| → pinch-IN scaleSyncErr max=${(b.maxScaleErr * 100).toFixed(2)}% | crossLayer robust=${b.pinchRobust}px(max${b.pinchMax},over2=${b.pinchOver2}) pinchFrames=${b.pinchFrames}(scale${b.scaleFrames}) | converge robust=${b.convRobust}px | after ov=${b.after.ov} flag=${b.after.flag} restCov=${b.restCov}`);
  } catch (e) { pass(`${label}/V5b`, false, 'error ' + e.message); }

  // V5c：捏合縮小（反方向；雙方向各一例）
  try {
    const c = await pinchProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 14, dir: 'out' });
    const ok = c.zStartFlag && c.pinchFrames >= 5 && c.scaleFrames >= 3 && c.maxScaleErr <= 0.05
      && c.pinchRobust <= 2 && c.origin0 && c.after.ov === 'none' && !c.after.flag && c.restCov >= 0.9;
    pass(`${label}/V5c`, ok, `pinch-OUT engaged=${c.zStartFlag} zoomSpan=${c.zoomSpan} pinchFrames=${c.pinchFrames}(scale${c.scaleFrames}) | scaleSyncErr max=${(c.maxScaleErr * 100).toFixed(2)}%(≤5%) | crossLayer robust=${c.pinchRobust}px(max${c.pinchMax},over2=${c.pinchOver2}) | converge robust=${c.convRobust}px | after ov=${c.after.ov} flag=${c.after.flag} z=${c.after.z} restCov=${c.restCov}`);
  } catch (e) { pass(`${label}/V5c`, false, 'error ' + e.message); }

  await browser.close();
}

// WebKit 捏合：如實探測「合成 TouchEvent 能否驅動 Leaflet TouchZoom」。Playwright WebKit 若構不出帶 2 touches
// 的事件（new Touch/new TouchEvent(touches)/initTouchEvent 皆不可用），則 _onTouchStart(要求 touches.length===2)
// 永不觸發 → 本條「驗不了」，記為 NA 並附「當下量到的確切原因」，不硬湊（禁止直呼內部 _onTouchStart 假裝驅動）。
async function runPinchWebkit(browserType, label) {
  console.log(`\n===== ${label} =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate(() => { const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; window.__map.setView([25.047, 121.517], 12, { animate: false }); });
  await p.waitForTimeout(500);
  const diag = await p.evaluate(async () => {
    const map = window.__map, el = map.getContainer(), cx = 187, cy = 406;
    const d = { hasTouchCtor: typeof Touch === 'function', hasTouchEventCtor: typeof TouchEvent === 'function', hasCreateTouch: typeof document.createTouch === 'function' };
    // 逐一嘗試三種構造帶 2 touches 的 TouchEvent 途徑，記下各自失敗原因
    try { new Touch({ identifier: 0, target: el, clientX: cx, clientY: cy }); d.newTouch = 'ok'; } catch (e) { d.newTouch = e.name + ':' + e.message; }
    let touches = null;
    try { touches = [document.createTouch(window, el, 0, cx - 30, cy), document.createTouch(window, el, 1, cx + 30, cy)]; d.createTouch = 'ok'; } catch (e) { d.createTouch = e.name + ':' + e.message; }
    try { const ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches }); d.newTouchEventWithTouches = 'ok len=' + ev.touches.length; } catch (e) { d.newTouchEventWithTouches = e.name + ':' + e.message; }
    try { const ev = document.createEvent('TouchEvent'); d.initTouchEvent = typeof ev.initTouchEvent; } catch (e) { d.initTouchEvent = 'createEvent-throw:' + e.message; }
    // 盡力一擊：用能構出的最完整事件實際 dispatch，看 TouchZoom 是否引擎級觸發
    let engaged = false;
    try {
      const t = touches || [];
      let ev; try { ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: t, targetTouches: t, changedTouches: t }); } catch (e) { ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true }); }
      el.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 30));
      engaged = !!(map.touchZoom && map.touchZoom._zooming);
    } catch (e) { d.dispatchErr = e.message; }
    d.touchZoomEngaged = engaged;
    d.dispatchedTouchesLen = (() => { try { const t = touches || []; const ev = new TouchEvent('touchstart', { touches: t }); return ev.touches.length; } catch (e) { return 'ctor-throws'; } })();
    return d;
  });
  await browser.close();
  if (diag.touchZoomEngaged) {
    // 若某天 Playwright WebKit 支援了，就走真驗（此路目前不會進來）
    na(`${label}/V5`, `WebKit 合成 TouchEvent 竟能驅動 TouchZoom（環境已升級）— 需補真捏合斷言。diag=${JSON.stringify(diag)}`);
  } else {
    na(`${label}/V5+V5b+V5c`, `驗不了：Playwright WebKit 構不出帶 2 touches 的 TouchEvent（new Touch→[${diag.newTouch}]；new TouchEvent({touches})→[${diag.newTouchEventWithTouches}]；createEvent('TouchEvent').initTouchEvent=${diag.initTouchEvent}）→ 派發的 touchstart touches.length=${diag.dispatchedTouchesLen}，Leaflet _onTouchStart(要求 touches.length===2) 未觸發、touchZoom._zooming=${diag.touchZoomEngaged}。非程式缺陷＝harness/引擎限制；捏合 handler 為引擎無關的純 JS 數學(getZoomScale/project)，其共用的凍結+CSS transform 已由 WebKit 上的 V2/V2b/V2c(zoomanim 路徑)跨層驗過。不硬湊直呼內部 handler。`);
  }
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

  // ── V2 家族：縮放時「地圖(圖磚) vs 軌道(overlay)」跨層對齊（僅桌面，行動由 V4d 捏合覆蓋）
  if (!mobile) {
    // V2：未平移基準（panePos≈0）——修好前後都該對齊；證明新公式在原始情境沒退化＋確有取到動畫途中幀
    try {
      const a = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 13, toZ: 14 });
      const ok = a.robustMax <= 2 && a.midFrames >= 3 && a.after.ov === 'none' && !a.after.flag && a.origin0 && a.nPicks >= 3;
      pass(`${label}/V2`, ok, `unpanned misalign max=${a.maxMisalign}px robust=${a.robustMax}px framesOver2=${a.framesOver2}/${a.activeFrames} (picks=${a.nPicks}, midFrames=${a.midFrames}), overlayCleared=${a.after.ov === 'none'}, flag=${a.after.flag}, origin0=${a.origin0}`);
    } catch (e) { pass(`${label}/V2`, false, 'error ' + e.message); }

    // V2b：平移 ≥150px 後縮放（非零 panePos）——★核心回歸★。新版每幀對齊、舊版 index_buggy 每幀恆錯 ~130–260px；
    // 差分證明此測真能抓到 bug。判準用 robustMax(丟單幀 WebKit 取樣毛刺)；真錯位是常數偏移、每幀皆錯，次高值照樣揭露。
    try {
      const fx = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 13, toZ: 14, panBy: [220, 140] });
      const bg2 = await zoomAlignProfile(ctx, 'index_buggy.html', { center: TAIPEI, fromZ: 13, toZ: 14, panBy: [220, 140] });
      const panned = Math.hypot(fx.pp0.x, fx.pp0.y) >= 150; // 前置：動畫起始時確實處於平移態
      const ok = panned && fx.robustMax <= 2 && bg2.robustMax >= 8 && (bg2.robustMax - fx.robustMax) >= 6;
      pass(`${label}/V2b`, ok, `panned panePos=(${fx.pp0.x},${fx.pp0.y}) |${Math.hypot(fx.pp0.x, fx.pp0.y).toFixed(0)}px| → FIXED robust=${fx.robustMax}px(max${fx.maxMisalign},over2=${fx.framesOver2}) vs BUGGY robust=${bg2.robustMax}px(over2=${bg2.framesOver2}/${bg2.activeFrames})  【修復前每幀錯位 ~${bg2.robustMax}px → 修復後 ${fx.robustMax}px】`);
    } catch (e) { pass(`${label}/V2b`, false, 'error ' + e.message); }

    // V2c：平移後「縮小」也對齊(s<1)＋接連續快速縮放×3 不殘留 transform/凍結旗標（無漂移/殘影）
    try {
      const c = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 14, toZ: 12, panBy: [-180, 130], rapid: true });
      const ok = Math.hypot(c.pp0.x, c.pp0.y) >= 120 && c.robustMax <= 2 && c.rapidState && c.rapidState.ov === 'none' && !c.rapidState.flag;
      pass(`${label}/V2c`, ok, `panned zoom-OUT misalign robust=${c.robustMax}px(max${c.maxMisalign}) (panePos |${Math.hypot(c.pp0.x, c.pp0.y).toFixed(0)}px|); after rapid×3: overlay=${c.rapidState ? c.rapidState.ov : 'n/a'}, flag=${c.rapidState ? c.rapidState.flag : 'n/a'}, z=${c.rapidState ? c.rapidState.z : 'n/a'} — 縮小與連縮皆無錯位/殘留`);
    } catch (e) { pass(`${label}/V2c`, false, 'error ' + e.message); }
  }

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
await runPinch(chromium, 'chromium-pinch');       // V5/V5b/V5c：真捏合手勢(CDP dispatchTouchEvent 驅動 TouchZoom)
await runPinchWebkit(webkit, 'webkit-pinch');      // 如實探測：WebKit 合成 TouchEvent 能否驅動 TouchZoom

console.log('\n================ SUMMARY ================');
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.msg}`);
for (const r of naResults) console.log(`N/A   ${r.id}  ${r.msg}`);
console.log(`\n${results.length - fails.length}/${results.length} checks passed; ${naResults.length} N/A (見上，附原因).`);
process.exit(fails.length ? 1 : 0);
