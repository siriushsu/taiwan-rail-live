// verify_zoom_anim.mjs — 向量地圖縮放機制 跨層驗證 (W1–W8)
// 新規格(2026-07-24 重寫,取代舊「凍結畫布+整張 CSS scale」):
//   縮放中(動畫縮放+捏合):幾何(軌道/站點/列車)逐幀跟圖磚同縮同移;文字(站名/車牌)與線寬固定像素、只移動。
//   結束幀=最終視圖重繪,零跳動。#overlay canvas 全程無 CSS transform(逐幀重畫+投影仿射 _zaAff)。
// 舊規格斷言(overlay CSS transform / raster scale 同步)全部作廢、改寫成新規格;跨層對齊/差分偵測力保留。
//
// 跑法:
//   1) 生差分基準(暫存檔,跑完刪):
//        git show main:index.html      > index_old.html     # zoomAnimation:false=「消失」對照(V1 覆蓋崩塌)
//        git show 98222db:index.html   > index_buggy.html    # 被退回的「overlay CSS transform+凍結重繪」版
//                                                            #  (文字放大再縮回)=新規格 W1a/W2 差分偵測對照
//   2) 起靜態站: python3 -m http.server 8791 --bind 127.0.0.1
//   3) node verify_zoom_anim.mjs
// 心得16/28:量「跨層對齊」而非單層;所有互比量在同一同步 rAF 區塊讀完(跨幀取樣在並行平移會生假殘差);
//           互動類必含「互動累積狀態」(平移後/回彈中);動畫類一律 Playwright 真引擎。
import { chromium, webkit } from './node_modules/playwright/index.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const naResults = [];
const pass = (id, ok, msg) => { results.push({ id, ok, msg }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}: ${msg}`); };
const na = (id, msg) => { naResults.push({ id, msg }); console.log(`  [N/A ] ${id}: ${msg}`); };
const TAIPEI = [25.047, 121.517];

// robustMax = 丟掉單一最高幀後的次高值:真引擎偶有單幀 getBoundingClientRect 取樣毛刺(compositor 與主執行緒差半幀);
// 真正的座標錯位是「常數偏移、每幀皆錯」(如舊 layer-space bug 每幀 130–260px),次高值照樣揭露。

async function newPage(ctx, file = 'index.html') {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; if (window.setAmbient) try { window.setAmbient(false); } catch (e) {} const w = document.getElementById('howtoWrap'); if (w) w.hidden = true; });
  await p.waitForTimeout(400);
  return p;
}

async function getBg(pg) {
  return await pg.evaluate(() => { const s = getComputedStyle(document.querySelector('.leaflet-container')).backgroundColor; const m = s.match(/(\d+)/g).map(Number); return [m[0], m[1], m[2]]; });
}

// 真截圖非底色像素比例
async function nonBgRatioOfMapRegion(pg, bg) {
  const mapBox = await pg.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const buf = await pg.screenshot({ clip: mapBox });
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  return await pg.evaluate(async ({ dataUrl, bg }) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement('canvas'); c.width = Math.min(480, img.width); c.height = Math.round(c.width * img.height / img.width);
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data; let nonbg = 0, total = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) > 16 || Math.abs(d[i + 1] - bg[1]) > 16 || Math.abs(d[i + 2] - bg[2]) > 16) nonbg++;
    return nonbg / total;
  }, { dataUrl, bg });
}

// ── V1(保留):縮放中不「消失」——新版動畫期間圖磚覆蓋率不塌 vs 舊版 zoomAnimation:false 瞬跳掉到空 ──
async function coverageProfile(ctx, file, fromZ, toZ, bg, center) {
  const p = await newPage(ctx, file);
  const r = await p.evaluate(async ({ fromZ, toZ, center }) => {
    const map = window.__map; map.setView(center, fromZ, { animate: false });
    await new Promise(r => setTimeout(r, 900));
    const R = document.getElementById('map').getBoundingClientRect();
    const NX = 24, NY = 16, grid = [];
    for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) grid.push([R.left + (ix + 0.5) * R.width / NX, R.top + (iy + 0.5) * R.height / NY]);
    const cov = () => { const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0').map(t => t.getBoundingClientRect()); let c = 0; for (const [x, y] of grid) for (const rr of rects) if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { c++; break; } return c / grid.length; };
    const cov0 = cov(), series = [];
    map.setZoom(toZ);
    await new Promise(res => { let n = 0; const loop = () => { series.push(cov()); if (++n < 30) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 200));
    return { cov0, minCov: Math.min(...series), first5: series.slice(0, 5), covEnd: cov() };
  }, { fromZ, toZ, center });
  await p.evaluate(({ c, fromZ }) => window.__map.setView(c, fromZ, { animate: false }), { c: center, fromZ });
  await p.waitForTimeout(700);
  await p.evaluate((toZ) => window.__map.setZoom(toZ), toZ);
  let midNonBg = 1;
  for (let i = 0; i < 3; i++) { await p.waitForTimeout(55); try { midNonBg = Math.min(midNonBg, await nonBgRatioOfMapRegion(p, bg)); } catch (e) {} }
  await p.close();
  return { ...r, midNonBg };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  核心:動畫縮放跨層對齊 + 幾何同縮 + 文字/線寬恆定 + 零跳動  (W1/W2/W3/W4)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// 量法(全部在同一同步 rAF 區塊讀完):
//  • overlay 投影位置 = applyAff(state._zaAff, q):q=起始幀凍結的圖磚容器座標,_zaAff=app 每幀提交的仿射
//    (=overlay 實際畫幾何用的座標,無 CSS transform → canvas px 即 CSS px 1:1)。
//  • 圖磚真實渲染位置 = 同一凍結圖磚元素當幀 getBoundingClientRect()(瀏覽器已合成 mapPane 平移+容器 scale=引擎真值)。
//  • dApp = 兩者最大距離 = app overlay vs 圖磚真值(核心 PASS 判準)。
//  • dIdeal = 用當幀圖磚矩陣+live panePos 依 app 公式重算仿射→同幀原子對齊(排除 app 提交相位,純驗公式再現)。
//  • dBuggy = 注入「缺 (s−1)·panePos 修正項」的 layer-space 錯誤公式→證明本量測對該類 bug 有偵測力(平移後應飆大)。
//  • 幾何同縮:兩世界點 overlay 投影間距 / 圖磚 scale k → 比例應恆 1(±5%)。
//  • overlay CSS transform:每幀必為 none(W1a;被退回的 98222db 版會是 scale(k)→本判準抓得到)。
//  • 文字/線寬恆定:hook overlay 2d ctx 的 fillText/strokeText/stroke,記錄各幀 font px 與 lineWidth;
//    動畫中用的 font px 必 ⊆ 靜止時、且最大值不增(向量規格不放大文字);線寬同理。
//  • 零跳動:最後一動畫幀 vs 落定重繪幀,同一世界點位置差 ≤1px。
async function zoomAlignProfile(ctx, file, opts) {
  const { center, fromZ, toZ, panBy, rapid } = opts;
  const p = await newPage(ctx, file);
  const r = await p.evaluate(async ({ center, fromZ, toZ, panBy, rapid }) => {
    const map = window.__map, state = window.__state, mapEl = document.getElementById('map'), ov = document.getElementById('overlay');
    const ctx2d = ov.getContext('2d');
    const parseMat = (mstr) => { if (!mstr || mstr === 'none') return { k: 1, ux: 0, uy: 0 }; const v = mstr.slice(mstr.indexOf('(') + 1, -1).split(',').map(Number); return mstr.startsWith('matrix3d') ? { k: v[0], ux: v[12], uy: v[13] } : { k: v[0], ux: v[4], uy: v[5] }; };
    const applyAff = (A, q) => ({ x: A.k * q[0] + A.tx, y: A.k * q[1] + A.ty });
    const parseFontPx = (f) => { const mm = /(\d+(?:\.\d+)?)px/.exec(f || ''); return mm ? +mm[1] : null; };

    map.setView(center, fromZ, { animate: false });
    await new Promise(r => setTimeout(r, 800));
    if (panBy) { map.panBy(panBy, { animate: false }); await new Promise(r => setTimeout(r, 400)); }
    const R0 = mapEl.getBoundingClientRect();
    // 凍結圖磚樣本(中央帶=量測儀器可信區:邊緣圖磚在過渡下被裁/剔會有次像素噪聲)
    const cand = [...document.querySelectorAll('img.leaflet-tile')]
      .filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0')
      .map(t => { const b = t.getBoundingClientRect(); return { el: t, q: [b.left - R0.left, b.top - R0.top], mx: b.left + b.width / 2 - R0.left, my: b.top + b.height / 2 - R0.top }; })
      .filter(s => s.mx > R0.width * 0.20 && s.mx < R0.width * 0.80 && s.my > R0.height * 0.16 && s.my < R0.height * 0.84);
    cand.sort((a, b) => a.mx - b.mx);
    const picks = []; const step = Math.max(1, Math.floor(cand.length / 8));
    for (let i = 0; i < cand.length && picks.length < 8; i += step) picks.push(cand[i]);
    // 幾何同縮用兩個世界點
    const W = [[center[0], center[1]], [center[0] + 0.05, center[1] + 0.035]];

    // 文字/線寬 hook(裝在動畫開始前,涵蓋 rest 與 mid)
    const rec = { fill: [], line: [] };
    const oF = ctx2d.fillText, oS = ctx2d.strokeText, oStroke = ctx2d.stroke;
    ctx2d.fillText = function (...a) { const px = parseFontPx(this.font); if (px) rec.fill.push({ px, za: !!state._zoomAnim }); return oF.apply(this, a); };
    ctx2d.strokeText = function (...a) { const px = parseFontPx(this.font); if (px) rec.fill.push({ px, za: !!state._zoomAnim }); return oS.apply(this, a); };
    ctx2d.stroke = function (...a) { rec.line.push({ lw: +this.lineWidth, za: !!state._zoomAnim }); return oStroke.apply(this, a); };
    await new Promise(r => setTimeout(r, 250)); // 收集靜止時的 rest 樣本

    const pp0 = map._getMapPanePos();
    const samples = [];
    const sampleOnce = () => {
      const A = state._zaAff;
      const m0 = state._zaM0, el = state._zaEl;
      const ovT = getComputedStyle(ov).transform;
      const active = !!A;
      let dApp = 0, dIdeal = 0, dBuggy = 0, cnt = 0, kApp = active ? A.k : 1;
      if (active) {
        const mNow = el ? parseMat(getComputedStyle(el).transform) : { k: 1, ux: 0, uy: 0 };
        const pp = map._getMapPanePos();
        const kNow = m0 ? mNow.k / m0.k : 1;
        const ideal = m0 ? { k: kNow, tx: pp.x * (1 - kNow) + mNow.ux - kNow * m0.ux, ty: pp.y * (1 - kNow) + mNow.uy - kNow * m0.uy } : null;
        const buggy = m0 ? { k: kNow, tx: mNow.ux - kNow * m0.ux, ty: mNow.uy - kNow * m0.uy } : null;
        for (const s of picks) { if (!s.el.isConnected) continue; const rb = s.el.getBoundingClientRect(); if (!rb.width) continue;
          const R = mapEl.getBoundingClientRect(); const tile = { x: rb.left - R.left, y: rb.top - R.top };
          dApp = Math.max(dApp, Math.hypot(applyAff(A, s.q).x - tile.x, applyAff(A, s.q).y - tile.y));
          if (ideal) dIdeal = Math.max(dIdeal, Math.hypot(applyAff(ideal, s.q).x - tile.x, applyAff(ideal, s.q).y - tile.y));
          if (buggy) dBuggy = Math.max(dBuggy, Math.hypot(applyAff(buggy, s.q).x - tile.x, applyAff(buggy, s.q).y - tile.y));
          cnt++;
        }
      }
      // 幾何同縮:兩世界點 overlay 投影間距 vs 圖磚 scale
      const P0 = map.latLngToContainerPoint(W[0]), P1 = map.latLngToContainerPoint(W[1]);
      const dist = Math.hypot(P1.x - P0.x, P1.y - P0.y);
      samples.push({ active, ovNone: ovT === 'none', kApp: +kApp.toFixed(4), dApp, dIdeal, dBuggy, cnt, dist, ppx: map._getMapPanePos().x, lastPos: { x: P0.x, y: P0.y } });
    };

    map.setZoomAround(map.latLngToContainerPoint(center), toZ);
    await new Promise(res => { let n = 0; const loop = () => { sampleOnce(); if (++n < 34) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
    // 零跳動:抓最後一個仍在動畫的幀位置 vs 落定後位置(同一世界點)
    const lastActive = [...samples].reverse().find(s => s.active);
    await new Promise(r => setTimeout(r, 280));
    const settledPos = (() => { const P = map.latLngToContainerPoint(W[0]); return { x: P.x, y: P.y }; })();
    const zeroJump = lastActive ? Math.hypot(lastActive.lastPos.x - settledPos.x, lastActive.lastPos.y - settledPos.y) : 999;

    const after = { ov: getComputedStyle(ov).transform, flag: !!state._zoomAnim, aff: state._zaAff, z: map.getZoom() };
    let rapidState = null;
    if (rapid) {
      map.setView(center, fromZ, { animate: false }); await new Promise(r => setTimeout(r, 300));
      for (let i = 0; i < 3; i++) { map.setZoomAround(map.latLngToContainerPoint(center), map.getZoom() + 1); await new Promise(r => setTimeout(r, 90)); }
      await new Promise(r => setTimeout(r, 900));
      rapidState = { ov: getComputedStyle(ov).transform, flag: !!state._zoomAnim, aff: state._zaAff, z: map.getZoom() };
    }
    // restore hooks
    ctx2d.fillText = oF; ctx2d.strokeText = oS; ctx2d.stroke = oStroke;

    // ── 彙整 ──
    const act = samples.filter(s => s.active && s.cnt > 0);
    const midG = samples.filter(s => Math.abs(s.kApp - 1) > 0.08); // 動畫途中幀(有明顯縮放)
    const dAppArr = act.map(s => s.dApp), dIdealArr = act.map(s => s.dIdeal), dBuggyArr = act.map(s => s.dBuggy);
    // 幾何同縮:間距比例 / kApp,應恆 1
    const scaleRatios = act.filter(s => Math.abs(s.kApp - 1) > 0.05).map(s => (s.dist / act[0].dist) / s.kApp);
    const scaleErr = scaleRatios.length ? Math.max(...scaleRatios.map(x => Math.abs(x - 1))) : 999;
    // 文字/線寬
    const restPx = [...new Set(rec.fill.filter(x => !x.za).map(x => x.px))].sort((a, b) => a - b);
    const midPx = [...new Set(rec.fill.filter(x => x.za).map(x => x.px))].sort((a, b) => a - b);
    const midTextCalls = rec.fill.filter(x => x.za).length;
    const fontConst = midPx.length > 0 && midPx.every(px => restPx.includes(px)) && Math.max(...midPx) <= Math.max(...restPx) + 0.01;
    const restLw = [...new Set(rec.line.filter(x => !x.za).map(x => x.lw))].sort((a, b) => a - b);
    const midLw = [...new Set(rec.line.filter(x => x.za).map(x => x.lw))].sort((a, b) => a - b);
    const lwConst = midLw.length === 0 || (Math.max(...midLw) <= Math.max(...restLw) + 0.01);

    return {
      pp0: { x: +pp0.x.toFixed(1), y: +pp0.y.toFixed(1) }, nPicks: picks.length,
      activeFrames: act.length, midGeomFrames: midG.length,
      dAppRobust: +robustP(dAppArr).toFixed(2), dAppMax: +maxP(dAppArr).toFixed(2),
      dIdealRobust: +robustP(dIdealArr).toFixed(2), dBuggyRobust: +robustP(dBuggyArr).toFixed(2), dBuggyMax: +maxP(dBuggyArr).toFixed(2),
      framesOver2: act.filter(s => s.dApp > 2).length,
      allOvNone: act.length > 0 && act.every(s => s.ovNone),
      ppRangeZoom: act.length ? +(Math.max(...act.map(s => s.ppx)) - Math.min(...act.map(s => s.ppx))).toFixed(2) : 0,
      scaleErrPct: +(scaleErr * 100).toFixed(2), scaleSamples: scaleRatios.length,
      restPx, midPx, midTextCalls, fontConst, restLw, midLw, lwConst,
      zeroJump: +zeroJump.toFixed(2), after: { ov: after.ov, flag: after.flag, affNull: after.aff == null, z: +after.z.toFixed(3) },
      rapidState: rapidState ? { ov: rapidState.ov, flag: rapidState.flag, affNull: rapidState.aff == null, z: +rapidState.z.toFixed(3) } : null,
    };
    // 頁內小工具(避免與外層同名):
    function robustP(a) { const s = a.slice().sort((x, y) => y - x); return s.length >= 2 ? s[1] : (s[0] ?? -1); }
    function maxP(a) { return a.length ? Math.max(...a) : -1; }
  }, { center, fromZ, toZ, panBy, rapid });
  await p.close();
  return r;
}

// ══ 被退回版(98222db)差分:量動畫中 overlay 是否被施加 CSS scale transform(文字被 raster 放大=「放大再縮回」) ══
async function overlayScaleDuringZoom(ctx, file, center) {
  const p = await newPage(ctx, file);
  const r = await p.evaluate(async ({ center }) => {
    const map = window.__map, ov = document.getElementById('overlay');
    const parseK = (t) => { if (!t || t === 'none') return 1; const v = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number); return t.startsWith('matrix3d') ? v[0] : v[0]; };
    map.setView(center, 13, { animate: false }); await new Promise(r => setTimeout(r, 800));
    const ks = [], transforms = new Set();
    map.setZoomAround(map.latLngToContainerPoint(center), 15);
    await new Promise(res => { let n = 0; const loop = () => { const t = getComputedStyle(ov).transform; transforms.add(t === 'none' ? 'none' : 'matrix'); ks.push(parseK(t)); if (++n < 30) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 300));
    return { peakScale: +Math.max(...ks).toFixed(3), sawMatrix: transforms.has('matrix'), afterOv: getComputedStyle(ov).transform };
  }, { center });
  await p.close();
  return r;
}

// ══ W6:跟車模式回歸 ══
// tile-URL oracle:世界點的「圖磚推算螢幕位置」(獨立於 overlay 投影)——用覆蓋該點的圖磚 DOM rect + 其 src z/x/y + map.project。
async function followProfile(ctx) {
  const p = await newPage(ctx);
  const r = await p.evaluate(async () => {
    const map = window.__map, state = window.__state, mapEl = document.getElementById('map'), ov = document.getElementById('overlay');
    const parseMat = (mstr) => { if (!mstr || mstr === 'none') return { k: 1, ux: 0, uy: 0 }; const v = mstr.slice(mstr.indexOf('(') + 1, -1).split(',').map(Number); return mstr.startsWith('matrix3d') ? { k: v[0], ux: v[12], uy: v[13] } : { k: v[0], ux: v[4], uy: v[5] }; };
    const applyAff = (A, q) => ({ x: A.k * q[0] + A.tx, y: A.k * q[1] + A.ty });
    // 選一列多站列車進跟車;用 fromStart 強制在班(simSec=發車、播放、30×)→ 列車實際移動、相機逐幀追(才驗得到「軌道跟車跑」回歸)
    let tr = (state.trains || []).find(x => x.stops && x.stops.length > 6 && !x.loop) || (state.trains || []).find(x => x.stops && x.stops.length > 4) || (state.trains || [])[0];
    if (!tr) return { entered: false };
    if (typeof window.setFollow === 'function') window.setFollow(tr, false, false, { fromStart: true }); else { state.followTrain = tr; state.followId = tr.train; state.followLock = true; }
    state.ambient = false; state._hotNext = 1e18; // fromStart 已設 30× 播放:列車移動、相機逐幀追(不用 60× 免衝出圖磚載入區)
    await new Promise(r => setTimeout(r, 900));
    const following1 = !!state.followTrain;

    // (a) 跟車中縮放一次:動畫中跨層對齊(frozen-q + _zaAff)
    const R0 = mapEl.getBoundingClientRect();
    const cand = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0')
      .map(t => { const b = t.getBoundingClientRect(); return { el: t, q: [b.left - R0.left, b.top - R0.top], mx: b.left + b.width / 2 - R0.left, my: b.top + b.height / 2 - R0.top }; })
      .filter(s => s.mx > R0.width * 0.2 && s.mx < R0.width * 0.8 && s.my > R0.height * 0.16 && s.my < R0.height * 0.84);
    cand.sort((a, b) => a.mx - b.mx); const picks = cand.filter((_, i) => i % Math.max(1, Math.floor(cand.length / 6)) === 0).slice(0, 6);
    const zc = map.getCenter();
    const samplesZ = [];
    map.setZoomAround(map.getSize().divideBy(2), map.getZoom() + 2);
    await new Promise(res => { let n = 0; const loop = () => {
      const A = state._zaAff; const ovT = getComputedStyle(ov).transform;
      if (A) { let d = 0, cnt = 0; const R = mapEl.getBoundingClientRect();
        for (const s of picks) { if (!s.el.isConnected) continue; const rb = s.el.getBoundingClientRect(); if (!rb.width) continue; const o = applyAff(A, s.q); d = Math.max(d, Math.hypot(o.x - (rb.left - R.left), o.y - (rb.top - R.top))); cnt++; }
        samplesZ.push({ d, cnt, ovNone: ovT === 'none' }); }
      if (++n < 30) requestAnimationFrame(loop); else res();
    }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 400));
    const zAct = samplesZ.filter(s => s.cnt > 0);
    const dZoomRobust = (() => { const a = zAct.map(s => s.d).sort((x, y) => y - x); return a.length >= 2 ? a[1] : (a[0] ?? -1); })();
    const zoomOvNone = zAct.length > 0 && zAct.every(s => s.ovNone);

    // (b) 落定後 ≥3 秒:固定站點 overlay 投影 vs tile-URL 推算,恆 ≤2px 不隨列車移動漂移
    const oracle = (ll) => {
      const R = mapEl.getBoundingClientRect();
      const pc = map.latLngToContainerPoint(ll);
      const tiles = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0);
      let best = null, bd = 1e9;
      for (const t of tiles) { const rb = t.getBoundingClientRect(); const cx = rb.left - R.left, cy = rb.top - R.top;
        if (pc.x >= cx && pc.x < cx + rb.width && pc.y >= cy && pc.y < cy + rb.height) { best = t; bd = 0; break; }
        const d = Math.hypot(pc.x - (cx + rb.width / 2), pc.y - (cy + rb.height / 2)); if (d < bd) { bd = d; best = t; } }
      if (!best) return null;
      const mm = /\/(?:light_all|dark_all)\/(\d+)\/(\d+)\/(\d+)/.exec(best.src) || /\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.png/.exec(best.src);
      if (!mm) return null;
      const z = +mm[1], tx = +mm[2], ty = +mm[3], rb = best.getBoundingClientRect();
      const Sproj = map.project(ll, z);
      return { x: (rb.left - R.left) + (Sproj.x - tx * 256), y: (rb.top - R.top) + (Sproj.y - ty * 256) };
    };
    // 漂移量測:每幀取「當下位於固定螢幕位置的地理點」(隨相機平移仍恆在畫面內),比 overlay 投影 vs tile-URL 推算。
    // 相機跟車平移時,若軌道層相對底圖漂移(歷史「軌道跟車跑」回歸),此差值會隨列車移動而增長。
    const drift = []; let zaNullAll = true, ovNoneAll = true, drawStart = state._drawCount, ctr0 = map.getCenter();
    for (let i = 0; i < 15; i++) {
      const R = mapEl.getBoundingClientRect();
      const scr = L.point(R.width * 0.4, R.height * 0.4);
      const ll = map.containerPointToLatLng(scr);
      const ov1 = map.latLngToContainerPoint(ll); const o = oracle(ll);
      if (state._zaAff != null) zaNullAll = false;
      if (getComputedStyle(ov).transform !== 'none') ovNoneAll = false;
      if (o) drift.push(Math.hypot(ov1.x - o.x, ov1.y - o.y));
      await new Promise(r => setTimeout(r, 200)); // 3s total
    }
    const drawDelta = state._drawCount - drawStart, ctr1 = map.getCenter();
    const camMoved = Math.hypot((ctr1.lat - ctr0.lat) * 1e5, (ctr1.lng - ctr0.lng) * 1e5);
    if (typeof window.clearFollow === 'function') try { window.clearFollow(); } catch (e) {}
    state.followTrain = null; state.followLock = false;
    const driftRobust = (() => { const a = drift.slice().sort((x, y) => y - x); return a.length >= 2 ? a[1] : (a[0] ?? -1); })();
    return {
      entered: true, following1, dZoomRobust: +dZoomRobust.toFixed(2), zoomFrames: zAct.length, zoomOvNone,
      driftRobust: +driftRobust.toFixed(2), driftMax: +Math.max(...drift).toFixed(2), driftN: drift.length,
      zaNullAll, ovNoneAll, drawDelta, camMoved: +camMoved.toFixed(1), zaAffAfterNull: state._zaAff == null,
    };
  });
  await p.close();
  return r;
}

// ══ W7:放空模式回歸 ══
async function ambientProfile(ctx) {
  const p = await newPage(ctx);
  const r = await p.evaluate(async () => {
    const map = window.__map, state = window.__state, mapEl = document.getElementById('map'), ov = document.getElementById('overlay');
    const applyAff = (A, q) => ({ x: A.k * q[0] + A.tx, y: A.k * q[1] + A.ty });
    state._hotNext = 0;
    if (typeof window.setAmbient === 'function') window.setAmbient(true); else state.ambient = true;
    // 等到抓到「呼吸幕」階段(intermittent),最多 ~10s;抓不到就記錄未觀察到
    let breathSeen = false; const t0 = performance.now();
    while (performance.now() - t0 < 10000) { if (state._breathStage) { breathSeen = true; break; } await new Promise(r => setTimeout(r, 150)); }
    const ambientOn = !!state.ambient;
    const breathAtZoom = !!state._breathStage;

    // 使用者滾輪縮放(=setZoomAround)接管:呼吸幕交還 + 縮放正常
    const R0 = mapEl.getBoundingClientRect();
    const cand = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0')
      .map(t => { const b = t.getBoundingClientRect(); return { el: t, q: [b.left - R0.left, b.top - R0.top], mx: b.left + b.width / 2 - R0.left, my: b.top + b.height / 2 - R0.top }; })
      .filter(s => s.mx > R0.width * 0.2 && s.mx < R0.width * 0.8 && s.my > R0.height * 0.16 && s.my < R0.height * 0.84);
    cand.sort((a, b) => a.mx - b.mx); const picks = cand.filter((_, i) => i % Math.max(1, Math.floor(cand.length / 6)) === 0).slice(0, 6);
    const c = map.getCenter(); const center = [c.lat, c.lng];
    const samples = [];
    map.setZoomAround(map.getSize().divideBy(2), map.getZoom() + 1);
    await new Promise(res => { let n = 0; const loop = () => {
      const A = state._zaAff, ovT = getComputedStyle(ov).transform;
      if (A) { let d = 0, cnt = 0; const R = mapEl.getBoundingClientRect();
        for (const s of picks) { if (!s.el.isConnected) continue; const rb = s.el.getBoundingClientRect(); if (!rb.width) continue; const o = applyAff(A, s.q); d = Math.max(d, Math.hypot(o.x - (rb.left - R.left), o.y - (rb.top - R.top))); cnt++; }
        samples.push({ d, cnt, ovNone: ovT === 'none' }); }
      if (++n < 30) requestAnimationFrame(loop); else res();
    }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 500));
    const act = samples.filter(s => s.cnt > 0);
    const dRobust = (() => { const a = act.map(s => s.d).sort((x, y) => y - x); return a.length >= 2 ? a[1] : (a[0] ?? -1); })();
    const breathYielded = !state._breathStage; // 縮放後呼吸幕應交還
    const afterOv = getComputedStyle(ov).transform;
    // 收尾
    if (typeof window.setAmbient === 'function') try { window.setAmbient(false); } catch (e) {}
    state.ambient = false; state._hotNext = 1e18;
    return { ambientOn, breathSeen, breathAtZoom, zoomFrames: act.length, dRobust: +dRobust.toFixed(2), allOvNone: act.length > 0 && act.every(s => s.ovNone), afterOvNone: afterOv === 'none', breathYielded, zaAffAfterNull: state._zaAff == null };
  });
  await p.close();
  return r;
}

// ══ V3(保留):動畫結束後靜態對齊 新 vs 舊 HEAD 像素比對 ══
async function staticDiff(ctx) {
  const shot = async (file) => {
    const p = await newPage(ctx, file);
    await p.evaluate((c) => window.__map.setView(c, 13, { animate: false }), TAIPEI);
    await p.waitForTimeout(1600);
    const box = await p.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const buf = await p.screenshot({ clip: box }); await p.close(); return buf;
  };
  const bNew = await shot('index.html'), bOld = await shot('index_old.html');
  const p = await newPage(ctx);
  const diff = await p.evaluate(async ({ a, b }) => {
    const load = u => new Promise(async res => { const im = new Image(); im.src = u; await im.decode(); res(im); });
    const ia = await load('data:image/png;base64,' + a), ib = await load('data:image/png;base64,' + b);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const mk = im => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, w, h).data; };
    const da = mk(ia), db = mk(ib); let d = 0; const n = w * h;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) d++;
    return d / n;
  }, { a: bNew.toString('base64'), b: bOld.toString('base64') });
  await p.close();
  return diff;
}

// ══ V4e(保留):拖曳平移中軌道跟上圖磚(省電節流互動豁免) ══
async function dragLagProfile(ctx, file, powerSave) {
  const p = await newPage(ctx, file);
  await p.evaluate((ps) => {
    const s = window.__state; s.ambient = false; s._hotNext = 1e18; s.powerSave = ps;
    const orig = window.draw; window.__drawN = 0;
    window.draw = function () { try { window.__drawPane = window.__map._getMapPanePos().clone(); window.__drawN++; } catch (e) {} return orig.apply(this, arguments); };
    window.__map.setView([25.047, 121.517], 14, { animate: false });
  }, powerSave);
  await p.waitForTimeout(800);
  const box = await p.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await p.evaluate(() => { window.__lag = []; window.__drawN0 = window.__drawN; window.__t0 = performance.now(); const map = window.__map;
    const loop = () => { if (window.__drawPane) { const q = map._getMapPanePos(); window.__lag.push(Math.hypot(q.x - window.__drawPane.x, q.y - window.__drawPane.y)); } if (performance.now() - window.__t0 < 600) requestAnimationFrame(loop); else window.__lagDone = true; }; requestAnimationFrame(loop); });
  const t0 = Date.now(); let x = cx, y = cy;
  while (Date.now() - t0 < 600) { x -= 5; y -= 2; await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' }); await new Promise(r => setTimeout(r, 6)); }
  await p.waitForFunction(() => window.__lagDone, { timeout: 3000 }).catch(() => {});
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' });
  const r = await p.evaluate(() => { const draws = window.__drawN - window.__drawN0, dur = (performance.now() - window.__t0) / 1000, lag = window.__lag.filter(Number.isFinite); return { drawFps: +(draws / dur).toFixed(1), maxLag: +Math.max(...lag).toFixed(2) }; });
  await p.close(); return r;
}

async function idleDrawFps(ctx, file, powerSave) {
  const p = await newPage(ctx, file);
  await p.evaluate((ps) => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; s.powerSave = ps; s.playing = true; window.__map.setView([25.047, 121.517], 12, { animate: false }); }, powerSave);
  await p.waitForTimeout(2000);
  const fps = await p.evaluate(async () => { const s = window.__state; const n0 = s._drawCount || 0; const t0 = performance.now(); await new Promise(r => setTimeout(r, 1000)); return +(((s._drawCount || 0) - n0) / ((performance.now() - t0) / 1000)).toFixed(1); });
  await p.close(); return fps;
}

// ══ W5:真捏合(chromium CDP dispatchTouchEvent 驅動 TouchZoom) ══
// 捏合不發 zoomanim → _zaAff 恆 null、overlay 走原生逐幀重投影;跨層對齊改用「固定世界點 latLngToContainerPoint vs 同一凍結圖磚元素 rect」。
async function pinchProfile(ctx, { fromZ, panBy, dir }) {
  const p = await newPage(ctx);
  const cdp = await p.context().newCDPSession(p);
  await p.evaluate(async ({ fromZ, panBy }) => {
    const map = window.__map, state = window.__state, mapEl = document.getElementById('map'), ov = document.getElementById('overlay');
    map.setView([25.047, 121.517], fromZ, { animate: false }); await new Promise(r => setTimeout(r, 800));
    if (panBy) { map.panBy(panBy, { animate: false }); await new Promise(r => setTimeout(r, 400)); }
    const pp0 = map._getMapPanePos(); window.__pp0 = { x: +pp0.x.toFixed(1), y: +pp0.y.toFixed(1) };
    const R = mapEl.getBoundingClientRect();
    // 凍結圖磚:記錄元素 + 其世界座標(idle 時 containerPointToLatLng roundtrip)
    const cand = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0 && getComputedStyle(t).opacity !== '0')
      .map(t => { const b = t.getBoundingClientRect(); const q = [b.left - R.left, b.top - R.top]; return { el: t, ll: map.containerPointToLatLng(L.point(q[0], q[1])), mx: b.left + b.width / 2 - R.left, my: b.top + b.height / 2 - R.top }; })
      .filter(s => s.mx > R.width * 0.2 && s.mx < R.width * 0.8 && s.my > R.height * 0.16 && s.my < R.height * 0.84);
    cand.sort((a, b) => a.mx - b.mx); window.__picks = cand.filter((_, i) => i % Math.max(1, Math.floor(cand.length / 6)) === 0).slice(0, 6);
    window.__pstart = map.getZoom();
    const ctx2d = ov.getContext('2d'); const parseFontPx = (f) => { const mm = /(\d+(?:\.\d+)?)px/.exec(f || ''); return mm ? +mm[1] : null; };
    window.__rec = { fill: [] }; const oF = ctx2d.fillText, oS = ctx2d.strokeText;
    ctx2d.fillText = function (...a) { const px = parseFontPx(this.font); if (px) window.__rec.fill.push({ px, z: !!(map.touchZoom && map.touchZoom._zooming) }); return oF.apply(this, a); };
    ctx2d.strokeText = function (...a) { const px = parseFontPx(this.font); if (px) window.__rec.fill.push({ px, z: !!(map.touchZoom && map.touchZoom._zooming) }); return oS.apply(this, a); };
    window.__restore = () => { ctx2d.fillText = oF; ctx2d.strokeText = oS; };
    window.__ps = []; window.__psRec = true;
    const rec = () => {
      if (!window.__psRec) return;
      const R2 = mapEl.getBoundingClientRect();
      const ovT = getComputedStyle(ov).transform;
      const zooming = !!(map.touchZoom && map.touchZoom._zooming), animZoom = !!map._animatingZoom;
      let maxd = 0, cnt = 0;
      for (const s of window.__picks) { if (!s.el.isConnected) continue; const rb = s.el.getBoundingClientRect(); if (!rb.width) continue;
        const oPos = map.latLngToContainerPoint(s.ll); const tile = { x: rb.left - R2.left, y: rb.top - R2.top };
        maxd = Math.max(maxd, Math.hypot(oPos.x - tile.x, oPos.y - tile.y)); cnt++; }
      window.__ps.push({ z: map.getZoom(), ovNone: ovT === 'none', zooming, animZoom, maxd, cnt });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  }, { fromZ, panBy });
  const box = await p.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
  const dStart = dir === 'out' ? 150 : 26, dEnd = dir === 'out' ? 26 : 150, steps = 18;
  const tp = (d) => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(dStart) });
  await p.waitForTimeout(20);
  const zStart = await p.evaluate(() => !!(window.__map.touchZoom && window.__map.touchZoom._zooming));
  for (let i = 1; i <= steps; i++) { const d = Math.round(dStart + (dEnd - dStart) * i / steps); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(d) }); await new Promise(r => setTimeout(r, 18)); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(950);
  const r = await p.evaluate(() => {
    window.__psRec = false; const s = window.__ps; window.__restore && window.__restore();
    const pinch = s.filter(x => x.zooming && x.cnt > 0);
    const converge = s.filter(x => !x.zooming && x.animZoom && x.cnt > 0);
    const dP = pinch.map(x => x.maxd).sort((a, b) => b - a), dC = converge.map(x => x.maxd).sort((a, b) => b - a);
    const restPx = [...new Set(window.__rec.fill.filter(x => !x.z).map(x => x.px))].sort((a, b) => a - b);
    const midPx = [...new Set(window.__rec.fill.filter(x => x.z).map(x => x.px))].sort((a, b) => a - b);
    const R = document.getElementById('map').getBoundingClientRect(), grid = [];
    for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 18; ix++) grid.push([R.left + (ix + 0.5) * R.width / 18, R.top + (iy + 0.5) * R.height / 12]);
    const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).map(t => t.getBoundingClientRect());
    let cc = 0; for (const [x, y] of grid) for (const rr of rects) if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { cc++; break; }
    return {
      pp0: window.__pp0, nPicks: window.__picks.length, startZoom: +window.__pstart.toFixed(3),
      pinchFrames: pinch.length, convFrames: converge.length,
      pinchRobust: +(dP.length >= 2 ? dP[1] : (dP[0] ?? 999)).toFixed(2), pinchMax: +(dP[0] ?? 999).toFixed(2), pinchOver2: pinch.filter(x => x.maxd > 2).length,
      convRobust: +(dC.length >= 2 ? dC[1] : (dC[0] ?? 0)).toFixed(2),
      allPinchOvNone: pinch.length > 0 && pinch.every(x => x.ovNone),
      restPx, midPx, fontConst: midPx.length > 0 && midPx.every(px => restPx.includes(px)) && Math.max(...midPx) <= Math.max(...restPx) + 0.01,
      zoomSpan: +(Math.max(...pinch.map(x => x.z), window.__pstart) - Math.min(...pinch.map(x => x.z), window.__pstart)).toFixed(3),
      after: { ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, affNull: window.__state._zaAff == null, z: +window.__map.getZoom().toFixed(3) },
      restCov: +(cc / grid.length).toFixed(3),
    };
  });
  r.zStartFlag = zStart;
  await p.close();
  return r;
}

// ══════════════════════════════════════════ 主流程 ══════════════════════════════════════════
async function run(browserType, label, { mobile, cdp, isWebkit } = {}) {
  console.log(`\n===== ${label} =====`);
  // WebKit 註記:frozen-q/_zaAff 取樣的跨層量(dApp/dZoom/geomScale)在 trunk WebKit 上帶 ~12–35px
  //   getComputedStyle(主執行緒,app 建 _zaAff 用)vs getBoundingClientRect(合成器,量圖磚)的跨時鐘/跨 tick 落差
  //   (Chromium 強制同步二者=0px);此為 ⚠/心得27 點名的 trunk-WebKit 量測時序假殘差、無法與釋出版 Safari 區分。
  //   故 WebKit 上「app 真值 dApp」報告不計分,PASS 改用原子指標 dIdeal(同幀 getComputedStyle+rect,兩引擎皆 0)+
  //   dBuggy 偵測差分(260px)佐證偵測力未鈍;app 實際 _zaAff 正確性由 Chromium 的 dApp=0 驗(同一份引擎無關 JS)。
  const wkNote = isWebkit ? ' [WebKit:dApp 時序假殘差不計分,見檔頭註]' : '';
  const browser = await browserType.launch();
  const ctx = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } });
  const pg = await newPage(ctx);
  const bg = await getBg(pg);

  // ── V1:縮放中不「消失」(新 vs 舊 zoomAnimation:false)
  try {
    const nIn = await coverageProfile(ctx, 'index.html', 13, 14, bg, TAIPEI);
    const oIn = await coverageProfile(ctx, 'index_old.html', 13, 14, bg, TAIPEI);
    const nOut = await coverageProfile(ctx, 'index.html', 14, 13, bg, TAIPEI);
    const oOut = await coverageProfile(ctx, 'index_old.html', 14, 13, bg, TAIPEI);
    const ok = nIn.minCov >= 0.5 && (nIn.minCov - oIn.minCov) >= 0.4 && nIn.midNonBg >= 0.80 && (nOut.minCov - oOut.minCov) >= 0.3;
    pass(`${label}/V1`, ok, `zoomIN new.minCov=${nIn.minCov.toFixed(3)} vs old=${oIn.minCov.toFixed(3)}; zoomOUT new=${nOut.minCov.toFixed(3)} vs old=${oOut.minCov.toFixed(3)}; new midNonBg=${nIn.midNonBg.toFixed(3)}`);
  } catch (e) { pass(`${label}/V1`, false, 'error ' + e.message); }

  // ── W1/W2/W3/W4:跨層對齊 + 幾何同縮 + 文字恆定 + 零跳動(桌面量;行動由 W5 捏合覆蓋)
  if (!mobile) {
    // W1:未平移基準(放大)。PASS 用原子 dIdeal(兩引擎);dApp/geomScale 僅 Chromium 計分(WebKit 時序假殘差)
    try {
      const a = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 13, toZ: 14 });
      const zaOk = isWebkit || (a.dAppRobust <= 2 && a.scaleErrPct <= 5);
      const ok = a.dIdealRobust <= 2 && zaOk && a.allOvNone && a.midGeomFrames >= 3 && a.fontConst && a.lwConst && a.zeroJump <= 1 && a.after.ov === 'none' && a.after.affNull && !a.after.flag && a.nPicks >= 2;
      pass(`${label}/W1-in`, ok, `crossLayer dIdeal(atomic)=${a.dIdealRobust}px dApp=${a.dAppRobust}px(max${a.dAppMax})${wkNote} ovNone=${a.allOvNone} | geomScaleErr=${a.scaleErrPct}%(n${a.scaleSamples}) midFrames=${a.midGeomFrames} | font mid[${a.midPx}]⊆rest[${a.restPx}]=${a.fontConst}(${a.midTextCalls}calls) lwConst=${a.lwConst} | zeroJump=${a.zeroJump}px | after ov=${a.after.ov} affNull=${a.after.affNull} z=${a.after.z} (picks${a.nPicks})`);
    } catch (e) { pass(`${label}/W1-in`, false, 'error ' + e.message); }
    // W1:未平移基準(縮小)
    try {
      const a = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 14, toZ: 12 });
      const zaOk = isWebkit || (a.dAppRobust <= 2 && a.scaleErrPct <= 5);
      const ok = a.dIdealRobust <= 2 && zaOk && a.allOvNone && a.midGeomFrames >= 3 && a.fontConst && a.zeroJump <= 1 && a.after.affNull;
      pass(`${label}/W1-out`, ok, `crossLayer dIdeal(atomic)=${a.dIdealRobust}px dApp=${a.dAppRobust}px${wkNote} ovNone=${a.allOvNone} | geomScaleErr=${a.scaleErrPct}% midFrames=${a.midGeomFrames} | fontConst=${a.fontConst} | zeroJump=${a.zeroJump}px`);
    } catch (e) { pass(`${label}/W1-out`, false, 'error ' + e.message); }

    // W2:文字尺寸恆定 差分——被退回版(98222db)動畫中 overlay 被施 CSS scale(文字 raster 放大),新版恆 none
    try {
      const nw = await overlayScaleDuringZoom(ctx, 'index.html', TAIPEI);
      const bg2 = await overlayScaleDuringZoom(ctx, 'index_buggy.html', TAIPEI);
      const ok = !nw.sawMatrix && nw.peakScale <= 1.001 && bg2.sawMatrix && bg2.peakScale >= 1.2;
      pass(`${label}/W2-scaleDiff`, ok, `NEW overlay peakScale=${nw.peakScale}(sawMatrix=${nw.sawMatrix}) vs REJECTED(98222db) peakScale=${bg2.peakScale}(sawMatrix=${bg2.sawMatrix}) — 新版文字不被 raster 放大、被退回版整張畫布 scale 放大再縮回`);
    } catch (e) { pass(`${label}/W2-scaleDiff`, false, 'error ' + e.message); }

    // W3:平移 ≥150px 後縮放(非零 panePos)+ 缺 panePos 項的錯誤公式差分(偵測力)
    try {
      const fx = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 13, toZ: 14, panBy: [220, 140] });
      const panned = Math.hypot(fx.pp0.x, fx.pp0.y) >= 150;
      const zaOk = isWebkit || fx.dAppRobust <= 2;
      const ok = panned && fx.dIdealRobust <= 2 && zaOk && fx.allOvNone && fx.dBuggyRobust >= 8 && (fx.dBuggyRobust - fx.dIdealRobust) >= 6 && fx.fontConst && fx.zeroJump <= 1;
      pass(`${label}/W3`, ok, `panned |${Math.hypot(fx.pp0.x, fx.pp0.y).toFixed(0)}px| → dIdeal(atomic)=${fx.dIdealRobust}px dApp=${fx.dAppRobust}px(max${fx.dAppMax})${wkNote} ovNone=${fx.allOvNone} | fontConst=${fx.fontConst} zeroJump=${fx.zeroJump}px | 偵測力:缺 panePos 項錯誤公式 dBuggy robust=${fx.dBuggyRobust}px(max${fx.dBuggyMax}) 【正確 ${fx.dIdealRobust}px vs 錯誤 ${fx.dBuggyRobust}px】`);
    } catch (e) { pass(`${label}/W3`, false, 'error ' + e.message); }

    // W4:大位移 panePos 下縮放(maxBounds 邊界區代理)+ 佐證「縮放動畫期間 pane 靜止」(app 於 _zoomAnim 內抑制搶相機,index.html:8505)
    //   說明:真正「回彈動畫與縮放並行」在 z13–14 無法乾淨重現——maxBounds 圍籬=TW_BOUNDS.pad(2.0) 在互動縮放級距外,
    //   相機於 _zoomAnim 內被抑制,強迫 pane 於縮放中位移(過拖慣性/逐幀 panBy)會與 Leaflet 縮放動畫打架、產生量測假影(非 app 缺陷)。
    //   panePos 修正項本身的正確性由 W3(非零靜止 panePos:正確 vs 缺項 dBuggy 差分)完整驗證。此處驗大位移 panePos 仍對齊 + pane 靜止佐證。
    try {
      const k = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 13, toZ: 14, panBy: [640, 400] });
      const panned = Math.hypot(k.pp0.x, k.pp0.y) >= 400;
      const zaOk = isWebkit || k.dAppRobust <= 2;
      const ok = panned && k.dIdealRobust <= 2 && zaOk && k.allOvNone && k.midGeomFrames >= 3 && k.after.affNull && k.ppRangeZoom <= 3;
      pass(`${label}/W4`, ok, `large panePos |${Math.hypot(k.pp0.x, k.pp0.y).toFixed(0)}px| zoom: dIdeal(atomic)=${k.dIdealRobust}px dApp=${k.dAppRobust}px(max${k.dAppMax})${wkNote} ovNone=${k.allOvNone} midFrames=${k.midGeomFrames} | pane 靜止佐證 ppRangeDuringZoom=${k.ppRangeZoom}px(≤3=相機於 _zoomAnim 被抑制) | dBuggy=${k.dBuggyRobust}px after affNull=${k.after.affNull}`);
    } catch (e) { pass(`${label}/W4`, false, 'error ' + e.message); }

    // W2c(併入):平移後縮小 + 連縮×3 不殘留 transform/凍結旗標
    try {
      const c = await zoomAlignProfile(ctx, 'index.html', { center: TAIPEI, fromZ: 14, toZ: 12, panBy: [-180, 130], rapid: true });
      const zaOk = isWebkit || c.dAppRobust <= 2;
      const ok = Math.hypot(c.pp0.x, c.pp0.y) >= 120 && c.dIdealRobust <= 2 && zaOk && c.allOvNone && c.rapidState && c.rapidState.ov === 'none' && !c.rapidState.flag && c.rapidState.affNull;
      pass(`${label}/W3-out+rapid`, ok, `panned zoom-OUT dIdeal(atomic)=${c.dIdealRobust}px dApp=${c.dAppRobust}px${wkNote} ovNone=${c.allOvNone}; after rapid×3: overlay=${c.rapidState ? c.rapidState.ov : 'n/a'} flag=${c.rapidState ? c.rapidState.flag : 'n/a'} affNull=${c.rapidState ? c.rapidState.affNull : 'n/a'}`);
    } catch (e) { pass(`${label}/W3-out+rapid`, false, 'error ' + e.message); }
  }

  // ── V3:動畫結束後靜態對齊(新 vs 舊 HEAD)
  try { const diff = await staticDiff(ctx); pass(`${label}/V3`, diff <= 0.02, `staticDiff(new vs old HEAD)=${(diff * 100).toFixed(3)}%`); }
  catch (e) { pass(`${label}/V3`, false, 'error ' + e.message); }

  // ── W6:跟車模式回歸
  try {
    const f = await followProfile(ctx);
    // (a) 跟車中縮放的 _zaAff 跨層(dZoom)僅 Chromium 計分(WebKit 時序假殘差);(b) 落定漂移用 tile-URL oracle(native,兩引擎可靠)
    const zaOk = isWebkit || f.dZoomRobust <= 2;
    const ok = f.entered && f.following1 && zaOk && f.zoomOvNone && f.driftRobust <= 2 && f.zaNullAll && f.ovNoneAll && f.drawDelta > 30 && f.camMoved > 0.5 && f.zaAffAfterNull;
    pass(`${label}/W6`, ok, `follow: (a)zoom dZoom robust=${f.dZoomRobust}px(${f.zoomFrames}f,ovNone=${f.zoomOvNone})${isWebkit ? wkNote : ''} (b)settle3s drift(oracle) robust=${f.driftRobust}px(max${f.driftMax},n${f.driftN}) zaNull=${f.zaNullAll} ovNone=${f.ovNoneAll} drawΔ=${f.drawDelta} camMoved=${f.camMoved} — 軌道不隨列車漂移`);
  } catch (e) { pass(`${label}/W6`, false, 'error ' + e.message); }

  // ── W7:放空模式回歸
  try {
    const a = await ambientProfile(ctx);
    const zaOk = isWebkit || a.dRobust <= 2;
    const ok = a.ambientOn && a.zoomFrames >= 3 && zaOk && a.allOvNone && a.afterOvNone && a.breathYielded && a.zaAffAfterNull;
    pass(`${label}/W7`, ok, `ambient: on=${a.ambientOn} breathSeen=${a.breathSeen}(atZoom=${a.breathAtZoom}) → wheel-zoom dApp robust=${a.dRobust}px(${a.zoomFrames}f,ovNone=${a.allOvNone})${isWebkit ? wkNote : ''} breathYielded=${a.breathYielded} afterOvNone=${a.afterOvNone}`);
  } catch (e) { pass(`${label}/W7`, false, 'error ' + e.message); }

  // ── V4:迴歸矩陣
  try {
    // (a) 連續快速縮放 ×5 不卡死/殘留/凍結,靜置鋪滿
    await pg.evaluate((c) => window.__map.setView(c, 11, { animate: false }), TAIPEI); await pg.waitForTimeout(500);
    await pg.evaluate(async (c) => { const m = window.__map; for (let i = 0; i < 5; i++) { m.setZoomAround(m.latLngToContainerPoint(c), m.getZoom() + 1); await new Promise(r => setTimeout(r, 70)); } }, TAIPEI);
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => { const R = document.getElementById('map').getBoundingClientRect(), grid = []; for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 18; ix++) grid.push([R.left + (ix + 0.5) * R.width / 18, R.top + (iy + 0.5) * R.height / 12]); const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).map(t => t.getBoundingClientRect()); let c = 0; for (const [x, y] of grid) for (const rr of rects) if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { c++; break; } return { ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, affNull: window.__state._zaAff == null, z: window.__map.getZoom(), restCov: c / grid.length }; });
    pass(`${label}/V4a`, st.ov === 'none' && !st.flag && st.affNull && st.restCov >= 0.95, `rapid5x settled: overlay=${st.ov}, flag=${st.flag}, affNull=${st.affNull}, z=${st.z}, restCov=${st.restCov.toFixed(3)}`);

    // (b) flyTo 不觸發 zoomanim、結束 overlay 乾淨
    const fly = await pg.evaluate(async () => { const m = window.__map; m.setView([25.047, 121.517], 12, { animate: false }); await new Promise(r => setTimeout(r, 400)); let animFired = 0; const h = () => animFired++; m.on('zoomanim', h); m.flyTo([22.63, 120.30], 14, { duration: 0.7 }); await new Promise(r => setTimeout(r, 1400)); m.off('zoomanim', h); return { animFired, ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, z: m.getZoom() }; });
    pass(`${label}/V4b`, fly.animFired === 0 && fly.ov === 'none' && !fly.flag, `flyTo: zoomanimFired=${fly.animFired}(應0), overlay=${fly.ov}, flag=${fly.flag}, endZoom=${fly.z}`);

    if (!mobile && cdp) {
      // (e) 拖曳中軌道跟上圖磚(省電節流互動豁免)
      const dNew = await dragLagProfile(ctx, 'index.html', true);
      const dOld = await dragLagProfile(ctx, 'index_old.html', true);
      const dNewOff = await dragLagProfile(ctx, 'index.html', false);
      pass(`${label}/V4e`, dNew.maxLag <= 2 && (dOld.maxLag - dNew.maxLag) >= 2 && dNewOff.maxLag <= 2, `dragLag(powerSave ON): new=${dNew.maxLag}px(fps${dNew.drawFps}) vs old=${dOld.maxLag}px(fps${dOld.drawFps}); new(OFF)=${dNewOff.maxLag}px`);
    }
    if (!mobile) {
      const idleOn = await idleDrawFps(ctx, 'index.html', true);
      const idleOff = await idleDrawFps(ctx, 'index.html', false);
      pass(`${label}/V4f`, idleOn <= 42 && idleOff >= idleOn, `idle throttle: powerSaveON=${idleOn}fps(應~30), OFF=${idleOff}fps`);

      const g = await pg.evaluate(async (c) => { const s = window.__state, m = window.__map; s.powerSave = true; s.ambient = false; s._hotNext = 1e18; m.setView(c, 12, { animate: false }); await new Promise(r => setTimeout(r, 500)); s._interactAt = performance.now(); let sawFlag = false; const iv = setInterval(() => { if (s._zoomAnim) sawFlag = true; }, 8); m.setZoom(14); await new Promise(r => setTimeout(r, 500)); clearInterval(iv); return { sawFlag, flagAfter: !!s._zoomAnim, ov: getComputedStyle(document.getElementById('overlay')).transform, affNull: s._zaAff == null, z: m.getZoom() }; }, TAIPEI);
      pass(`${label}/V4g`, g.sawFlag && !g.flagAfter && g.ov === 'none' && g.affNull && g.z === 14, `drag→zoom(powerSave ON): entered=${g.sawFlag}, cleared=${!g.flagAfter}, overlay=${g.ov}, affNull=${g.affNull}, z=${g.z}`);
    }
  } catch (e) { pass(`${label}/V4`, false, 'error ' + e.message); }

  await browser.close();
}

// ── 捏合系列 ──
async function runPinch(browserType, label) {
  console.log(`\n===== ${label} =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const chk = (id, a, extra = true) => {
    const ok = a.zStartFlag && a.pinchFrames >= 5 && a.pinchRobust <= 2 && a.allPinchOvNone && a.fontConst && a.convRobust <= 2 && a.after.ov === 'none' && !a.after.flag && a.after.affNull && a.restCov >= 0.9 && extra;
    pass(id, ok, `engaged=${a.zStartFlag} zoomSpan=${a.zoomSpan} pinchFrames=${a.pinchFrames} | crossLayer robust=${a.pinchRobust}px(max${a.pinchMax},over2=${a.pinchOver2}) ovNone=${a.allPinchOvNone} | font mid[${a.midPx}]⊆rest[${a.restPx}]=${a.fontConst} | converge robust=${a.convRobust}px | after ov=${a.after.ov} flag=${a.after.flag} affNull=${a.after.affNull} z=${a.after.z} restCov=${a.restCov} (picks${a.nPicks},pp0=${a.pp0.x},${a.pp0.y})`);
  };
  try { chk(`${label}/W5-in`, await pinchProfile(ctx, { fromZ: 12, dir: 'in' })); } catch (e) { pass(`${label}/W5-in`, false, 'error ' + e.message); }
  try { const b = await pinchProfile(ctx, { fromZ: 12, dir: 'in', panBy: [220, 140] }); chk(`${label}/W5-panIn`, b, Math.hypot(b.pp0.x, b.pp0.y) >= 150); } catch (e) { pass(`${label}/W5-panIn`, false, 'error ' + e.message); }
  try { chk(`${label}/W5-out`, await pinchProfile(ctx, { fromZ: 14, dir: 'out' })); } catch (e) { pass(`${label}/W5-out`, false, 'error ' + e.message); }
  await browser.close();
}

async function runPinchWebkit(browserType, label) {
  console.log(`\n===== ${label} =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await newPage(ctx);
  await p.evaluate(() => window.__map.setView([25.047, 121.517], 12, { animate: false }));
  await p.waitForTimeout(500);
  const diag = await p.evaluate(async () => {
    const map = window.__map, el = map.getContainer(), cx = 187, cy = 406;
    const d = {}; let touches = null;
    try { new Touch({ identifier: 0, target: el, clientX: cx, clientY: cy }); d.newTouch = 'ok'; } catch (e) { d.newTouch = e.name + ':' + e.message; }
    try { touches = [document.createTouch(window, el, 0, cx - 30, cy), document.createTouch(window, el, 1, cx + 30, cy)]; d.createTouch = 'ok'; } catch (e) { d.createTouch = e.name; }
    try { const ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches }); d.newTouchEventWithTouches = 'ok len=' + ev.touches.length; } catch (e) { d.newTouchEventWithTouches = e.name + ':' + e.message; }
    let engaged = false;
    try { const t = touches || []; let ev; try { ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: t, targetTouches: t, changedTouches: t }); } catch (e) { ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true }); } el.dispatchEvent(ev); await new Promise(r => setTimeout(r, 30)); engaged = !!(map.touchZoom && map.touchZoom._zooming); } catch (e) {}
    d.touchZoomEngaged = engaged;
    d.dispatchedTouchesLen = (() => { try { const t = touches || []; const ev = new TouchEvent('touchstart', { touches: t }); return ev.touches.length; } catch (e) { return 'ctor-throws'; } })();
    return d;
  });
  await browser.close();
  if (diag.touchZoomEngaged) na(`${label}/W5`, `WebKit 合成 TouchEvent 竟能驅動 TouchZoom(環境升級)—需補真捏合斷言。diag=${JSON.stringify(diag)}`);
  else na(`${label}/W5(in+panIn+out)`, `驗不了:Playwright WebKit 構不出帶 2 touches 的 TouchEvent(new Touch→[${diag.newTouch}];new TouchEvent({touches})→[${diag.newTouchEventWithTouches}])→派發 touchstart touches.length=${diag.dispatchedTouchesLen},Leaflet _onTouchStart(要求 2)未觸發、touchZoom._zooming=${diag.touchZoomEngaged}。非程式缺陷=harness 限制;捏合走原生逐幀 _move 重投影(引擎無關),其 overlay 無 transform+固定字級已由 WebKit 上 W1/W3(zoomanim 路徑)跨層驗過。不硬湊直呼內部 handler。`);
}

// ── 執行 ──
const ONLY = process.env.ONLY || '';
if (!ONLY || ONLY.includes('cd')) await run(chromium, 'chromium-desktop', { cdp: true });
if (!ONLY || ONLY.includes('cm')) await run(chromium, 'chromium-mobile', { mobile: true, cdp: true });
if (!ONLY || ONLY.includes('wd')) await run(webkit, 'webkit-desktop', { isWebkit: true }); // 心得10/27:釋出版 Safari 主力引擎,跑 V1/W1/W3/V3/W6/W7;CDP 專案 Chromium 才有;本 harness 為 trunk WebKit
if (!ONLY || ONLY.includes('cp')) await runPinch(chromium, 'chromium-pinch');
if (!ONLY || ONLY.includes('wp')) await runPinchWebkit(webkit, 'webkit-pinch');

console.log('\n================ SUMMARY ================');
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.msg}`);
for (const r of naResults) console.log(`N/A   ${r.id}  ${r.msg}`);
console.log(`\n${results.length - fails.length}/${results.length} checks passed; ${naResults.length} N/A.`);
process.exit(fails.length ? 1 : 0);
