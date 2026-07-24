// verify_zoom_anim.mjs — 向量地圖縮放機制 跨層驗證（實作無關判準版，2026-07-25 重寫）
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 為什麼重寫：前一版用「frozen-q + 圖磚容器起始矩陣重算仿射」比對跨層對齊——與實作共用同一套
//   起始矩陣假設、且只取「中央帶」圖磚（靠近縮放錨點、比例誤差幾乎不動）→ 兩邊一起錯＝永遠自洽
//   （dApp≈0 假對齊），漏掉了真實使用者踩到的「多次縮放後幾何 4× 超衝」重大缺陷（假陰性）。
// 新判準＝實作無關的獨立量，錨點無關、遠離錨點取樣：
//   • 幾何比（Metric G，PRIMARY）：沿 map.latLngToContainerPoint 取兩個「遠離中心、彼此相距」的世界點，
//     其 overlay 投影「間距比值」= 幾何實際縮放倍率。判準＝結束/峰值比值必 = 2^Δz（±2%），中途單調平滑。
//     oracle 是純數學 2^Δz（非圖磚矩陣）→ 共用錯誤假設無法騙過它；間距比值與錨點無關→ 4× 超衝全靈敏。
//   • 像素級獨立比對（Metric P）：mid-anim 以「圖磚 <img> 自己的 getBoundingClientRect（合成器實渲染幾何）」
//     ＋Leaflet 該磚 coords{x,y,z}＋map.project 反算「某遠點的圖磚渲染螢幕位置」，與 overlay 投影同幀比 ≤3px。
//     用圖磚 img 自身 rect（非容器矩陣推算）→ 與實作讀的容器 computed transform 獨立。
//   • 零跳動、字級/線寬恆定：機制無關、保留（在遠點量零跳動，靠近錨點會被縮放不動點遮住）。
//   • overlay 全程無 CSS transform：機制無關、保留。
//   • 累積狀態情境（連縮 5 次 進進出進出 後再縮放）：使用者踩到、前一版漏掉的路徑，必含；乾淨首縮也保留。
// 偵測力證明：對 HEAD~1（9438701＝4× 超衝 bug 版）跑同一 Metric G，須抓到 ext≈4（fires）。
//
// 跑法：
//   1) 生差分基準（暫存檔，跑完刪）——git 讀操作允許：
//        git show main:index.html    > index_old.html    # zoomAnimation:false（縮放瞬跳掉圖磚）→ V1 覆蓋崩塌/V3/V4e 對照
//        git show HEAD~1:index.html  > index_buggy.html   # 4× 幾何超衝 bug 版 → Metric G 偵測力對照
//   2) 起靜態站（repo 根目錄）：python3 -m http.server 8791 --bind 127.0.0.1
//   3) node verify_zoom_anim.mjs        （ONLY=cd/cm/wd/cp/wp 可只跑單引擎）
//   4) 跑完刪除 index_old.html / index_buggy.html（禁 git 寫操作）。
// 心得16/27/28：量「跨層對齊」而非單層；互比量在同一同步 rAF 區塊讀完；互動類必含累積狀態；
//   trunk-WebKit 的 compositor(getBoundingClientRect) vs 主執行緒(getComputedStyle) 於 running transition
//   有 ~1 幀時序偏斜（Metric P mid-frame 假殘差）——用時序無關的 Metric G（overlay 對 overlay）當引擎無關守門，
//   Metric P mid-frame 在 WebKit 只報告不計分，並以「Metric G 精確 + Metric P 落定端點乾淨」證其為暫態非缺陷。
import { chromium, webkit } from './node_modules/playwright/index.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const naResults = [];
const pass = (id, ok, msg) => { results.push({ id, ok, msg }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}: ${msg}`); };
const na = (id, msg) => { naResults.push({ id, msg }); console.log(`  [N/A ] ${id}: ${msg}`); };
const TAIPEI = [25.047, 121.517];

async function newPage(ctx, file = 'index.html') {
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await p.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 40000 });
  await p.waitForFunction(() => window.__map && window.__state && window.__state.ready, { timeout: 40000 });
  await p.evaluate(() => { const s = window.__state; s.ambient = false; s._hotNext = 1e18; if (window.setAmbient) try { window.setAmbient(false); } catch (e) {} const w = document.getElementById('howtoWrap'); if (w) w.remove(); });
  await p.waitForTimeout(400);
  return p;
}

async function getBg(pg) {
  return await pg.evaluate(() => { const s = getComputedStyle(document.querySelector('.leaflet-container')).backgroundColor; const m = s.match(/(\d+)/g).map(Number); return [m[0], m[1], m[2]]; });
}

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

// ── V1（保留）：縮放中不「消失」——新版動畫期間圖磚覆蓋率不塌 vs 舊版 zoomAnimation:false 瞬跳到空 ──
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
    return { cov0, minCov: Math.min(...series), covEnd: cov() };
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
//  核心：幾何比（Metric G，oracle=2^Δz）＋ 像素獨立比對（Metric P，圖磚 img rect）＋ 零跳動 ＋ 字級/線寬恆定
// ══════════════════════════════════════════════════════════════════════════════════════════════
// 頁內函式（字串注入，避免依賴外部作用域）
const GEOM_FN = `
async function geomRatioEval({dz, accumulate, panBy}) {
  const map=window.__map, state=window.__state, L=window.L;
  const ovEl=document.getElementById('overlay'), ctx2d=ovEl.getContext('2d');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function tileLayer(){ for(const id in map._layers){ const ly=map._layers[id]; if(ly&&ly._tiles&&ly.getTileSize) return ly; } return null; }
  async function animZoom(delta){ return new Promise(res=>{ let done=false; map.once('zoomend',()=>{done=true;}); map.setZoom(map.getZoom()+delta,{animate:true});
    const iv=setInterval(()=>{ if(done){clearInterval(iv);res();} },20); setTimeout(()=>{clearInterval(iv);res();},1500); }); }
  // 字級/線寬 hook：裝在動畫前，涵蓋 rest 與 mid
  const parseFontPx=f=>{const m=/(\\d+(?:\\.\\d+)?)px/.exec(f||'');return m?+m[1]:null;};
  const rec={fill:[],line:[]}; const oF=ctx2d.fillText,oS=ctx2d.strokeText,oStroke=ctx2d.stroke;
  ctx2d.fillText=function(...a){const px=parseFontPx(this.font);if(px)rec.fill.push({px,za:!!state._zoomAnim});return oF.apply(this,a);};
  ctx2d.strokeText=function(...a){const px=parseFontPx(this.font);if(px)rec.fill.push({px,za:!!state._zoomAnim});return oS.apply(this,a);};
  ctx2d.stroke=function(...a){rec.line.push({lw:+this.lineWidth,za:!!state._zoomAnim});return oStroke.apply(this,a);};
  await sleep(250);
  if(panBy){ map.panBy(panBy,{animate:false}); await sleep(400); }
  if(accumulate){ for(const d of [+1,+1,-1,+1,-1]){ await animZoom(d); await sleep(120); } }
  await sleep(120);
  const pp0=map._getMapPanePos();
  const size=map.getSize();
  // 兩個「遠離中心、彼此相距」的世界點：間距比值=幾何縮放倍率（錨點無關）
  const A=map.containerPointToLatLng([size.x*0.2, size.y*0.25]);
  const B=map.containerPointToLatLng([size.x*0.8, size.y*0.75]);
  // 遠離中心錨點的第三點：Metric P 與零跳動用（比例誤差在此最放大）
  const C=map.containerPointToLatLng([size.x*0.85, size.y*0.82]);
  const dist=(P,Q)=>{const a=map.latLngToContainerPoint(P),b=map.latLngToContainerPoint(Q);return Math.hypot(a.x-b.x,a.y-b.y);};
  const d0=dist(A,B);
  const mapRect=map.getContainer().getBoundingClientRect();
  const ly=tileLayer(); const tsz=ly?ly.getTileSize().x:256;
  function metricP(){ // 圖磚 img 自身 rect oracle（獨立於 _zaAff / 容器矩陣）
    if(!ly) return null; let best=null,bs=1e18;
    const ov=map.latLngToContainerPoint(C); const cx=mapRect.left+ov.x, cy=mapRect.top+ov.y;
    for(const key in ly._tiles){ const t=ly._tiles[key]; if(!t.el||!t.el.isConnected||!t.coords) continue;
      const r=t.el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
      const inside=(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom);
      const dc=Math.hypot((r.left+r.right)/2-cx,(r.top+r.bottom)/2-cy);
      const sc=(inside?0:1e9)+dc; if(sc<bs){bs=sc;best={t,r};} }
    if(!best) return null; const t=best.t, r=best.r, z=t.coords.z;
    const proj=map.project(C,z); const twx=t.coords.x*tsz, twy=t.coords.y*tsz;
    const sx=r.left+(proj.x-twx)/tsz*r.width, sy=r.top+(proj.y-twy)/tsz*r.height;
    return { diff: Math.hypot(sx-cx,sy-cy), z };
  }
  const samples=[]; const pCaps=[]; let cLastAnim=null; let ppMin=1e9,ppMax=-1e9; let running=true;
  function frame(){ if(!running) return;
    const za=state._zoomAnim; const ratio=dist(A,B)/d0; const ov=getComputedStyle(ovEl).transform;
    samples.push({za,ratio,ov});
    if(za){ cLastAnim=map.latLngToContainerPoint(C); const px=map._getMapPanePos().x; ppMin=Math.min(ppMin,px); ppMax=Math.max(ppMax,px);
      if(state._zaAff){ const mp=metricP(); if(mp) pCaps.push({k:+state._zaAff.k.toFixed(3),diff:+mp.diff.toFixed(2)}); } }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  await animZoom(dz); await sleep(70); running=false;
  ctx2d.fillText=oF; ctx2d.strokeText=oS; ctx2d.stroke=oStroke;
  const settledC=map.latLngToContainerPoint(C);
  const zeroJump=cLastAnim?Math.hypot(cLastAnim.x-settledC.x,cLastAnim.y-settledC.y):999;
  const during=samples.filter(s=>s.za); const ratios=during.map(s=>s.ratio);
  const targetK=Math.pow(2,dz);
  const ext = ratios.length ? (dz>0?Math.max(...ratios):Math.min(...ratios)) : null; // 峰值（in=max、out=min）
  const lastAnim = during.length ? during[during.length-1].ratio : null;
  const settled = dist(A,B)/d0;
  const ovNone = samples.every(s=>s.ov==='none'||!s.ov);
  // 單調平滑（方向感知）：偏離 running 極值 >0.06 的幀數
  let mono=0; if(dz>0){ let mx=0; for(const r of ratios){ if(r<mx-0.06)mono++; mx=Math.max(mx,r);} }
  else { let mn=1e9; for(const r of ratios){ if(r>mn+0.06)mono++; mn=Math.min(mn,r);} }
  // Metric P：pMax(整段最大，含 mid-frame)、pEnd(近 targetK 的落定端點,低速乾淨)、pMid(近 sqrt(targetK) 高速幀)
  const pDiffs=pCaps.map(p=>p.diff); const pMax=pDiffs.length?Math.max(...pDiffs):null;
  const near=(tk)=>{ let b=1e9,v=null; for(const p of pCaps){ const dd=Math.abs(p.k-tk); if(dd<b){b=dd;v=p;} } return v; };
  const pEnd=near(targetK), pMid=near(Math.sqrt(targetK));
  // 字級/線寬
  const restPx=[...new Set(rec.fill.filter(x=>!x.za).map(x=>x.px))].sort((a,b)=>a-b);
  const midPx=[...new Set(rec.fill.filter(x=>x.za).map(x=>x.px))].sort((a,b)=>a-b);
  const midTextCalls=rec.fill.filter(x=>x.za).length;
  const fontConst=midPx.length>0 && midPx.every(px=>restPx.includes(px)) && Math.max(...midPx)<=Math.max(...restPx)+0.01;
  const restLw=[...new Set(rec.line.filter(x=>!x.za).map(x=>x.lw))].sort((a,b)=>a-b);
  const midLw=[...new Set(rec.line.filter(x=>x.za).map(x=>x.lw))].sort((a,b)=>a-b);
  const lwConst=midLw.length===0 || (Math.max(...midLw)<=Math.max(...restLw)+0.01);
  return {
    dz, accumulate, panBy: panBy||null, pp0:{x:+pp0.x.toFixed(1),y:+pp0.y.toFixed(1)},
    targetK:+targetK.toFixed(3), ext:ext&&+ext.toFixed(3), lastAnim:lastAnim&&+lastAnim.toFixed(3), settled:+settled.toFixed(3),
    extErrPct:+(Math.abs(ext-targetK)/targetK*100).toFixed(2), lastErrPct:+(Math.abs(lastAnim-targetK)/targetK*100).toFixed(2),
    nDuring:during.length, monoViol:mono, ovNone, zeroJump:+zeroJump.toFixed(2),
    pMax:pMax==null?null:+pMax.toFixed(2), pEnd, pMid, nPcap:pCaps.length,
    ppRangeZoom:+(ppMax-ppMin>0?(ppMax-ppMin):0).toFixed(2),
    restPx, midPx, midTextCalls, fontConst, restLw, midLw, lwConst,
    zoom:+map.getZoom().toFixed(2), afterOv:getComputedStyle(ovEl).transform, affNull: state._zaAff==null, flag:!!state._zoomAnim,
  };
}
`;

async function geomRatioProfile(ctx, file, opts) {
  const p = await newPage(ctx, file);
  await p.addScriptTag({ content: GEOM_FN });
  await p.evaluate((c) => window.__map.setView(c, 13, { animate: false }), TAIPEI);
  await p.waitForTimeout(1000);
  const r = await p.evaluate((o) => window.geomRatioEval(o), opts);
  await p.close();
  return r;
}

// ══ W6：跟車模式回歸（overlay-none + 跟車中縮放幾何比 + tile-URL oracle 漂移，全部實作無關） ══
async function followProfile(ctx) {
  const p = await newPage(ctx);
  const r = await p.evaluate(async () => {
    const map = window.__map, state = window.__state, mapEl = document.getElementById('map'), ov = document.getElementById('overlay');
    let tr = (state.trains || []).find(x => x.stops && x.stops.length > 6 && !x.loop) || (state.trains || []).find(x => x.stops && x.stops.length > 4) || (state.trains || [])[0];
    if (!tr) return { entered: false };
    if (typeof window.setFollow === 'function') window.setFollow(tr, false, false, { fromStart: true }); else { state.followTrain = tr; state.followId = tr.train; state.followLock = true; }
    state.ambient = false; state._hotNext = 1e18;
    await new Promise(r => setTimeout(r, 900));
    const following1 = !!state.followTrain;

    // (a) 跟車中縮放一次：overlay 全程 none + 幾何比→2（實作無關），錨點在中心、量遠點間距
    const size = map.getSize();
    const A = map.containerPointToLatLng([size.x * 0.2, size.y * 0.25]);
    const B = map.containerPointToLatLng([size.x * 0.8, size.y * 0.75]);
    const dist = (P, Q) => { const a = map.latLngToContainerPoint(P), b = map.latLngToContainerPoint(Q); return Math.hypot(a.x - b.x, a.y - b.y); };
    const d0 = dist(A, B);
    const samplesZ = [];
    map.setZoomAround(map.getSize().divideBy(2), map.getZoom() + 1);
    await new Promise(res => { let n = 0; const loop = () => {
      const za = state._zoomAnim; const ovT = getComputedStyle(ov).transform;
      if (za) samplesZ.push({ ratio: dist(A, B) / d0, ovNone: ovT === 'none' });
      if (++n < 30) requestAnimationFrame(loop); else res();
    }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 400));
    const zAct = samplesZ.filter(Boolean);
    const zRatios = zAct.map(s => s.ratio);
    const zoomExt = zRatios.length ? Math.max(...zRatios) : null; // 幾何比峰值,應→2
    const zoomExtErr = zoomExt ? +(Math.abs(zoomExt - 2) / 2 * 100).toFixed(2) : 999;
    const zoomOvNone = zAct.length > 0 && zAct.every(s => s.ovNone);

    // (b) 落定後 ≥3 秒：固定螢幕位置的地理點 overlay 投影 vs tile-URL 推算（獨立 oracle），不隨列車漂移
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
    const drift = []; let zaNullAll = true, ovNoneAll = true, drawStart = state._drawCount, ctr0 = map.getCenter();
    for (let i = 0; i < 15; i++) {
      const R = mapEl.getBoundingClientRect();
      const scr = L.point(R.width * 0.4, R.height * 0.4);
      const ll = map.containerPointToLatLng(scr);
      const ov1 = map.latLngToContainerPoint(ll); const o = oracle(ll);
      if (state._zaAff != null) zaNullAll = false;
      if (getComputedStyle(ov).transform !== 'none') ovNoneAll = false;
      if (o) drift.push(Math.hypot(ov1.x - o.x, ov1.y - o.y));
      await new Promise(r => setTimeout(r, 200));
    }
    const drawDelta = state._drawCount - drawStart, ctr1 = map.getCenter();
    const camMoved = Math.hypot((ctr1.lat - ctr0.lat) * 1e5, (ctr1.lng - ctr0.lng) * 1e5);
    if (typeof window.clearFollow === 'function') try { window.clearFollow(); } catch (e) {}
    state.followTrain = null; state.followLock = false;
    const driftRobust = (() => { const a = drift.slice().sort((x, y) => y - x); return a.length >= 2 ? a[1] : (a[0] ?? -1); })();
    return {
      entered: true, following1, zoomFrames: zAct.length, zoomExt: zoomExt && +zoomExt.toFixed(3), zoomExtErr, zoomOvNone,
      driftRobust: +driftRobust.toFixed(2), driftMax: +Math.max(...drift).toFixed(2), driftN: drift.length,
      zaNullAll, ovNoneAll, drawDelta, camMoved: +camMoved.toFixed(1), zaAffAfterNull: state._zaAff == null,
    };
  });
  await p.close();
  return r;
}

// ══ W7：放空模式回歸（overlay-none + 放空中縮放幾何比→2 + 呼吸幕交還，實作無關） ══
async function ambientProfile(ctx) {
  const p = await newPage(ctx);
  const r = await p.evaluate(async () => {
    const map = window.__map, state = window.__state, ov = document.getElementById('overlay');
    state._hotNext = 0;
    if (typeof window.setAmbient === 'function') window.setAmbient(true); else state.ambient = true;
    let breathSeen = false; const t0 = performance.now();
    while (performance.now() - t0 < 10000) { if (state._breathStage) { breathSeen = true; break; } await new Promise(r => setTimeout(r, 150)); }
    const ambientOn = !!state.ambient;
    const breathAtZoom = !!state._breathStage;
    const size = map.getSize();
    const A = map.containerPointToLatLng([size.x * 0.2, size.y * 0.25]);
    const B = map.containerPointToLatLng([size.x * 0.8, size.y * 0.75]);
    const dist = (P, Q) => { const a = map.latLngToContainerPoint(P), b = map.latLngToContainerPoint(Q); return Math.hypot(a.x - b.x, a.y - b.y); };
    const d0 = dist(A, B);
    const samples = [];
    map.setZoomAround(map.getSize().divideBy(2), map.getZoom() + 1);
    await new Promise(res => { let n = 0; const loop = () => {
      const za = state._zoomAnim, ovT = getComputedStyle(ov).transform;
      if (za) samples.push({ ratio: dist(A, B) / d0, ovNone: ovT === 'none' });
      if (++n < 30) requestAnimationFrame(loop); else res();
    }; requestAnimationFrame(loop); });
    await new Promise(r => setTimeout(r, 500));
    const act = samples.filter(Boolean);
    const zRatios = act.map(s => s.ratio);
    const zoomExt = zRatios.length ? Math.max(...zRatios) : null;
    const zoomExtErr = zoomExt ? +(Math.abs(zoomExt - 2) / 2 * 100).toFixed(2) : 999;
    const breathYielded = !state._breathStage;
    const afterOv = getComputedStyle(ov).transform;
    if (typeof window.setAmbient === 'function') try { window.setAmbient(false); } catch (e) {}
    state.ambient = false; state._hotNext = 1e18;
    return { ambientOn, breathSeen, breathAtZoom, zoomFrames: act.length, zoomExt: zoomExt && +zoomExt.toFixed(3), zoomExtErr,
      allOvNone: act.length > 0 && act.every(s => s.ovNone), afterOvNone: afterOv === 'none', breathYielded, zaAffAfterNull: state._zaAff == null };
  });
  await p.close();
  return r;
}

// ══ V3（改：自一致性零殘留）：縮放來回 z13→14→13（列車凍結 playing=false）後，與未縮放的 z13 像素比對 ══
//   前一版比對「舊 HEAD(main)」已因 main 落後 6 commit（字級/控制帶/里程校正等 UI 變更）而基準漂移＝假 FAIL；
//   改成同一份程式的「縮放來回是否留下靜態殘留」——凍結列車後唯一差異即縮放機制的殘留，drift-free。
async function settleResidual(ctx) {
  const p = await newPage(ctx);
  await p.evaluate((c) => { const s = window.__state; s.playing = false; s.ambient = false; s._hotNext = 1e18; window.__map.setView(c, 13, { animate: false }); }, TAIPEI);
  await p.waitForTimeout(1500);
  const simA = await p.evaluate(() => window.__state.simSec);
  const box = await p.$eval('#map', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const bufA = await p.screenshot({ clip: box });
  await p.evaluate(async () => { const m = window.__map;
    await new Promise(res => { m.once('zoomend', () => res()); m.setZoom(14, { animate: true }); }); await new Promise(r => setTimeout(r, 350));
    await new Promise(res => { m.once('zoomend', () => res()); m.setZoom(13, { animate: true }); }); });
  await p.waitForTimeout(1200);
  const simB = await p.evaluate(() => window.__state.simSec);
  const bufB = await p.screenshot({ clip: box });
  const diff = await p.evaluate(async ({ a, b }) => {
    const load = u => new Promise(async res => { const im = new Image(); im.src = u; await im.decode(); res(im); });
    const ia = await load('data:image/png;base64,' + a), ib = await load('data:image/png;base64,' + b);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const mk = im => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, w, h).data; };
    const da = mk(ia), db = mk(ib); let d = 0; const n = w * h;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) d++;
    return d / n;
  }, { a: bufA.toString('base64'), b: bufB.toString('base64') });
  await p.close();
  return { diff, framesFrozen: simA === simB };
}

// ══ V4e（保留）：拖曳平移中軌道跟上圖磚（省電節流互動豁免） ══
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

// ══ W5：真捏合（chromium CDP dispatchTouchEvent 驅動 TouchZoom） ══
// 捏合不發 zoomanim → _zaAff 恆 null、overlay 走原生逐幀重投影；幾何比＝固定世界點 latLngToContainerPoint 間距 / 起始間距；
// 跨層像素＝固定世界點 overlay 投影 vs 該點所在圖磚 img rect（獨立 oracle）。
async function pinchProfile(ctx, { fromZ, panBy, dir }) {
  const p = await newPage(ctx);
  const cdp = await p.context().newCDPSession(p);
  await p.evaluate(async ({ fromZ, panBy }) => {
    const map = window.__map, state = window.__state, mapEl = document.getElementById('map'), ov = document.getElementById('overlay'), L = window.L;
    map.setView([25.047, 121.517], fromZ, { animate: false }); await new Promise(r => setTimeout(r, 800));
    if (panBy) { map.panBy(panBy, { animate: false }); await new Promise(r => setTimeout(r, 400)); }
    const pp0 = map._getMapPanePos(); window.__pp0 = { x: +pp0.x.toFixed(1), y: +pp0.y.toFixed(1) };
    const size = map.getSize();
    window.__A = map.containerPointToLatLng([size.x * 0.2, size.y * 0.25]);
    window.__B = map.containerPointToLatLng([size.x * 0.8, size.y * 0.75]);
    window.__C = map.containerPointToLatLng([size.x * 0.85, size.y * 0.82]);
    const dist = (P, Q) => { const a = map.latLngToContainerPoint(P), b = map.latLngToContainerPoint(Q); return Math.hypot(a.x - b.x, a.y - b.y); };
    window.__d0 = dist(window.__A, window.__B);
    window.__pstart = map.getZoom();
    function tileLayer(){ for(const id in map._layers){ const ly=map._layers[id]; if(ly&&ly._tiles&&ly.getTileSize) return ly; } return null; }
    window.__ly = tileLayer(); window.__tsz = window.__ly ? window.__ly.getTileSize().x : 256;
    const ctx2d = ov.getContext('2d'); const parseFontPx = (f) => { const mm = /(\d+(?:\.\d+)?)px/.exec(f || ''); return mm ? +mm[1] : null; };
    window.__rec = { fill: [] }; const oF = ctx2d.fillText, oS = ctx2d.strokeText;
    ctx2d.fillText = function (...a) { const px = parseFontPx(this.font); if (px) window.__rec.fill.push({ px, z: !!(map.touchZoom && map.touchZoom._zooming) }); return oF.apply(this, a); };
    ctx2d.strokeText = function (...a) { const px = parseFontPx(this.font); if (px) window.__rec.fill.push({ px, z: !!(map.touchZoom && map.touchZoom._zooming) }); return oS.apply(this, a); };
    window.__restore = () => { ctx2d.fillText = oF; ctx2d.strokeText = oS; };
    window.__ps = []; window.__psRec = true;
    const mapRect = mapEl.getBoundingClientRect();
    function metricP(){
      const ly = window.__ly, C = window.__C; if (!ly) return null; let best=null,bs=1e18;
      const ov2 = map.latLngToContainerPoint(C); const cx=mapRect.left+ov2.x, cy=mapRect.top+ov2.y;
      for(const key in ly._tiles){ const t=ly._tiles[key]; if(!t.el||!t.el.isConnected||!t.coords) continue;
        const r=t.el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
        const inside=(cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom);
        const dc=Math.hypot((r.left+r.right)/2-cx,(r.top+r.bottom)/2-cy);
        const sc=(inside?0:1e9)+dc; if(sc<bs){bs=sc;best={t,r};} }
      if(!best) return null; const t=best.t,r=best.r,z=t.coords.z;
      const proj=map.project(C,z); const twx=t.coords.x*window.__tsz, twy=t.coords.y*window.__tsz;
      const sx=r.left+(proj.x-twx)/window.__tsz*r.width, sy=r.top+(proj.y-twy)/window.__tsz*r.height;
      return Math.hypot(sx-cx,sy-cy);
    }
    const rec = () => {
      if (!window.__psRec) return;
      const ovT = getComputedStyle(ov).transform;
      const zooming = !!(map.touchZoom && map.touchZoom._zooming), animZoom = !!map._animatingZoom;
      const ratio = dist(window.__A, window.__B) / window.__d0;
      const mp = metricP();
      window.__ps.push({ z: map.getZoom(), ovNone: ovT === 'none', zooming, animZoom, ratio, mp });
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
  const r = await p.evaluate(({ dir }) => {
    window.__psRec = false; const s = window.__ps; window.__restore && window.__restore();
    const pinch = s.filter(x => x.zooming);
    const converge = s.filter(x => !x.zooming && x.animZoom);
    const pRatios = pinch.map(x => x.ratio);
    // 捏合幾何比：整段掃到的縮放倍率極值（in 放大→>1、out 縮小→<1）與 zoom span 對得上
    const pinchExt = pRatios.length ? (dir === 'out' ? Math.min(...pRatios) : Math.max(...pRatios)) : null;
    const pMps = pinch.map(x => x.mp).filter(v => v != null).sort((a, b) => b - a);
    const pinchPRobust = pMps.length >= 2 ? pMps[1] : (pMps[0] ?? 999);
    const restPx = [...new Set(window.__rec.fill.filter(x => !x.z).map(x => x.px))].sort((a, b) => a - b);
    const midPx = [...new Set(window.__rec.fill.filter(x => x.z).map(x => x.px))].sort((a, b) => a - b);
    const R = document.getElementById('map').getBoundingClientRect(), grid = [];
    for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 18; ix++) grid.push([R.left + (ix + 0.5) * R.width / 18, R.top + (iy + 0.5) * R.height / 12]);
    const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).map(t => t.getBoundingClientRect());
    let cc = 0; for (const [x, y] of grid) for (const rr of rects) if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { cc++; break; }
    const zSpan = Math.abs(Math.max(...pinch.map(x => x.z), window.__pstart) - Math.min(...pinch.map(x => x.z), window.__pstart));
    return {
      pp0: window.__pp0, startZoom: +window.__pstart.toFixed(3),
      pinchFrames: pinch.length, convFrames: converge.length,
      pinchExt: pinchExt && +pinchExt.toFixed(3), pinchPRobust: +pinchPRobust.toFixed(2), pinchPMax: +(pMps[0] ?? 999).toFixed(2),
      allPinchOvNone: pinch.length > 0 && pinch.every(x => x.ovNone),
      restPx, midPx, fontConst: midPx.length > 0 && midPx.every(px => restPx.includes(px)) && Math.max(...midPx) <= Math.max(...restPx) + 0.01,
      zoomSpan: +zSpan.toFixed(3),
      after: { ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, affNull: window.__state._zaAff == null, z: +window.__map.getZoom().toFixed(3) },
      restCov: +(cc / grid.length).toFixed(3),
    };
  }, { dir });
  r.zStartFlag = zStart;
  await p.close();
  return r;
}

// ══════════════════════════════════════════ 主流程 ══════════════════════════════════════════
async function run(browserType, label, { mobile, cdp, isWebkit } = {}) {
  console.log(`\n===== ${label} =====`);
  // WebKit 註記：Metric P mid-frame 在 trunk WebKit 帶 ~13–30px 假殘差（getComputedStyle 主執行緒 vs
  //   getBoundingClientRect 合成器 於 running transition 差 ~1 幀；Chromium 強制同步二者=0px；心得27）。
  //   PASS 守門用時序無關的 Metric G（overlay 對 overlay 同幀,兩引擎皆精確 2^Δz）＋ Metric P 落定端點 pEnd
  //   （低速,乾淨）；Metric P pMax(mid-frame) 在 WebKit 只報告不計分。
  const wkNote = isWebkit ? ' [WebKit:pMax mid-frame 時序假殘差不計分,見檔頭註]' : '';
  const browser = await browserType.launch();
  const ctx = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } });
  const pg = await newPage(ctx);
  const bg = await getBg(pg);

  // ── V1：縮放中不「消失」(新 vs 舊 zoomAnimation:false)
  try {
    const nIn = await coverageProfile(ctx, 'index.html', 13, 14, bg, TAIPEI);
    const oIn = await coverageProfile(ctx, 'index_old.html', 13, 14, bg, TAIPEI);
    const nOut = await coverageProfile(ctx, 'index.html', 14, 13, bg, TAIPEI);
    const oOut = await coverageProfile(ctx, 'index_old.html', 14, 13, bg, TAIPEI);
    const ok = nIn.minCov >= 0.5 && (nIn.minCov - oIn.minCov) >= 0.4 && nIn.midNonBg >= 0.80 && (nOut.minCov - oOut.minCov) >= 0.3;
    pass(`${label}/V1`, ok, `zoomIN new.minCov=${nIn.minCov.toFixed(3)} vs old=${oIn.minCov.toFixed(3)}; zoomOUT new=${nOut.minCov.toFixed(3)} vs old=${oOut.minCov.toFixed(3)}; new midNonBg=${nIn.midNonBg.toFixed(3)}`);
  } catch (e) { pass(`${label}/V1`, false, 'error ' + e.message); }

  // ── 幾何比 + 像素獨立比對 + 零跳動 + 字級恆定（桌面量；行動由 W5 捏合覆蓋）
  if (!mobile) {
    const scoreGeom = (id, a, label2, extra = true) => {
      // Metric G：ext/last/settled 三者皆 = 2^Δz（±2%）——PRIMARY，兩引擎計分
      const gOk = a.ext != null && a.extErrPct <= 2 && a.lastErrPct <= 2 && Math.abs(a.settled - a.targetK) / a.targetK <= 0.02;
      // Metric P：Chromium pMax ≤3；WebKit 用落定端點 pEnd ≤4（低速乾淨），pMax 只報告
      const pOk = isWebkit ? (a.pEnd && a.pEnd.diff <= 4) : (a.pMax != null && a.pMax <= 3);
      const ok = gOk && pOk && a.ovNone && a.monoViol <= 1 && a.fontConst && a.lwConst && a.zeroJump <= 4 && a.afterOv === 'none' && a.affNull && !a.flag && a.nDuring >= 5 && extra;
      const pTxt = isWebkit
        ? `pEnd(k≈${a.targetK})=${a.pEnd ? a.pEnd.diff : 'n/a'}px pMax=${a.pMax}px${wkNote}`
        : `pMax=${a.pMax}px pEnd=${a.pEnd ? a.pEnd.diff : 'n/a'}px(n${a.nPcap})`;
      pass(id, ok, `${label2}: geomRatio ext=${a.ext}(±${a.extErrPct}% vs 2^${a.dz}=${a.targetK}) last=${a.lastAnim}(±${a.lastErrPct}%) settled=${a.settled} | Metric P ${pTxt} | zeroJump=${a.zeroJump}px ovNone=${a.ovNone} mono=${a.monoViol} | font mid[${a.midPx}]⊆rest[${a.restPx}]=${a.fontConst}(${a.midTextCalls}) lwConst=${a.lwConst} | after ov=${a.afterOv} affNull=${a.affNull} z=${a.zoom}(${a.nDuring}f)`);
      return a;
    };
    // Z1：乾淨載入首縮（放大 / 縮小）
    try { scoreGeom(`${label}/Z1-in`, await geomRatioProfile(ctx, 'index.html', { dz: +1 }), '乾淨首縮-放大'); } catch (e) { pass(`${label}/Z1-in`, false, 'error ' + e.message); }
    try { scoreGeom(`${label}/Z1-out`, await geomRatioProfile(ctx, 'index.html', { dz: -1 }), '乾淨首縮-縮小'); } catch (e) { pass(`${label}/Z1-out`, false, 'error ' + e.message); }
    // Z2：累積狀態（連縮 5 次 進進出進出）後再縮放——使用者踩到、前一版漏掉的路徑
    try { scoreGeom(`${label}/Z2-accum-in`, await geomRatioProfile(ctx, 'index.html', { dz: +1, accumulate: true }), '連縮5次後-放大(用戶路徑)'); } catch (e) { pass(`${label}/Z2-accum-in`, false, 'error ' + e.message); }
    try { scoreGeom(`${label}/Z2-accum-out`, await geomRatioProfile(ctx, 'index.html', { dz: -1, accumulate: true }), '連縮5次後-縮小'); } catch (e) { pass(`${label}/Z2-accum-out`, false, 'error ' + e.message); }
    // Z3：平移後縮放（非零 panePos）+ pane 於縮放中靜止佐證
    try {
      const a = await geomRatioProfile(ctx, 'index.html', { dz: +1, panBy: [260, 170] });
      const panned = Math.hypot(a.pp0.x, a.pp0.y) >= 150;
      scoreGeom(`${label}/Z3-pan-in`, a, `平移後放大 panePos=|${Math.hypot(a.pp0.x, a.pp0.y).toFixed(0)}px| ppRangeDuringZoom=${a.ppRangeZoom}px`, panned && a.ppRangeZoom <= 3);
    } catch (e) { pass(`${label}/Z3-pan-in`, false, 'error ' + e.message); }
  }

  // ── V3：縮放來回零殘留（自一致性，列車凍結；取代已漂移的「vs 舊 HEAD」像素比對）
  try { const s = await settleResidual(ctx); pass(`${label}/V3`, s.diff <= 0.02 && s.framesFrozen, `settleResidual(z13→14→13 來回 vs 未縮放 z13,列車凍結=${s.framesFrozen})=${(s.diff * 100).toFixed(3)}% — 縮放機制無靜態殘留`); }
  catch (e) { pass(`${label}/V3`, false, 'error ' + e.message); }

  // ── W6：跟車模式回歸
  try {
    const f = await followProfile(ctx);
    const ok = f.entered && f.following1 && f.zoomExtErr <= 5 && f.zoomOvNone && f.driftRobust <= 2 && f.zaNullAll && f.ovNoneAll && f.drawDelta > 30 && f.camMoved > 0.5 && f.zaAffAfterNull;
    pass(`${label}/W6`, ok, `follow: (a)zoom 幾何比 ext=${f.zoomExt}(±${f.zoomExtErr}% vs 2, ${f.zoomFrames}f, ovNone=${f.zoomOvNone}) (b)settle3s drift(tile-URL oracle) robust=${f.driftRobust}px(max${f.driftMax},n${f.driftN}) zaNull=${f.zaNullAll} ovNone=${f.ovNoneAll} drawΔ=${f.drawDelta} camMoved=${f.camMoved} — 軌道不隨列車漂移`);
  } catch (e) { pass(`${label}/W6`, false, 'error ' + e.message); }

  // ── W7：放空模式回歸
  try {
    const a = await ambientProfile(ctx);
    const ok = a.ambientOn && a.zoomFrames >= 3 && a.zoomExtErr <= 5 && a.allOvNone && a.afterOvNone && a.breathYielded && a.zaAffAfterNull;
    pass(`${label}/W7`, ok, `ambient: on=${a.ambientOn} breathSeen=${a.breathSeen}(atZoom=${a.breathAtZoom}) → wheel-zoom 幾何比 ext=${a.zoomExt}(±${a.zoomExtErr}% vs 2, ${a.zoomFrames}f, ovNone=${a.allOvNone}) breathYielded=${a.breathYielded} afterOvNone=${a.afterOvNone}`);
  } catch (e) { pass(`${label}/W7`, false, 'error ' + e.message); }

  // ── V4：迴歸矩陣
  try {
    await pg.evaluate((c) => window.__map.setView(c, 11, { animate: false }), TAIPEI); await pg.waitForTimeout(500);
    await pg.evaluate(async (c) => { const m = window.__map; for (let i = 0; i < 5; i++) { m.setZoomAround(m.latLngToContainerPoint(c), m.getZoom() + 1); await new Promise(r => setTimeout(r, 70)); } }, TAIPEI);
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => { const R = document.getElementById('map').getBoundingClientRect(), grid = []; for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 18; ix++) grid.push([R.left + (ix + 0.5) * R.width / 18, R.top + (iy + 0.5) * R.height / 12]); const rects = [...document.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).map(t => t.getBoundingClientRect()); let c = 0; for (const [x, y] of grid) for (const rr of rects) if (x >= rr.left && x < rr.right && y >= rr.top && y < rr.bottom) { c++; break; } return { ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, affNull: window.__state._zaAff == null, z: window.__map.getZoom(), restCov: c / grid.length }; });
    pass(`${label}/V4a`, st.ov === 'none' && !st.flag && st.affNull && st.restCov >= 0.95, `rapid5x settled: overlay=${st.ov}, flag=${st.flag}, affNull=${st.affNull}, z=${st.z}, restCov=${st.restCov.toFixed(3)}`);

    const fly = await pg.evaluate(async () => { const m = window.__map; m.setView([25.047, 121.517], 12, { animate: false }); await new Promise(r => setTimeout(r, 400)); let animFired = 0; const h = () => animFired++; m.on('zoomanim', h); m.flyTo([22.63, 120.30], 14, { duration: 0.7 }); await new Promise(r => setTimeout(r, 1400)); m.off('zoomanim', h); return { animFired, ov: getComputedStyle(document.getElementById('overlay')).transform, flag: !!window.__state._zoomAnim, z: m.getZoom() }; });
    pass(`${label}/V4b`, fly.animFired === 0 && fly.ov === 'none' && !fly.flag, `flyTo: zoomanimFired=${fly.animFired}(應0), overlay=${fly.ov}, flag=${fly.flag}, endZoom=${fly.z}`);

    if (!mobile && cdp) {
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

// ── 偵測力：對 HEAD~1（4× 超衝 bug 版）跑 Metric G，必抓到 ext≈4 ──
async function detectionPower(browserType) {
  console.log(`\n===== detection-power (vs HEAD~1 buggy) =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const fresh = await geomRatioProfile(ctx, 'index_buggy.html', { dz: +1 });
    const accum = await geomRatioProfile(ctx, 'index_buggy.html', { dz: +1, accumulate: true });
    // 新版 fresh 的 ext（對照，證明同判準在正版=2）
    const good = await geomRatioProfile(ctx, 'index.html', { dz: +1 });
    const fires = fresh.ext >= 3.5 && accum.ext >= 3.5 && (fresh.pMax == null || fresh.pMax >= 100) && good.ext <= 2.1;
    pass(`detection/Metric-G-catches-4x`, fires,
      `bug版 fresh ext=${fresh.ext}(±${fresh.extErrPct}%) zeroJump=${fresh.zeroJump}px pMax=${fresh.pMax}px | bug版 accum ext=${accum.ext} zeroJump=${accum.zeroJump}px | 正版 fresh ext=${good.ext} — 判準對 4× 超衝開火(bug≈4 vs 正版≈2)`);
  } catch (e) { pass(`detection/Metric-G-catches-4x`, false, 'error ' + e.message); }
  await browser.close();
}

// ── 捏合系列 ──
async function runPinch(browserType, label) {
  console.log(`\n===== ${label} =====`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const chk = (id, a, dir, extra = true) => {
    // 捏合幾何比：ext 應與 zoomSpan 對得上（放大 ext>1、縮小 ext<1），且 ≈ 2^zoomSpan（±8%,捏合非整級,寬容）
    const wantK = dir === 'out' ? Math.pow(2, -a.zoomSpan) : Math.pow(2, a.zoomSpan);
    const geomOk = a.pinchExt != null && Math.abs(a.pinchExt - wantK) / wantK <= 0.08;
    const ok = a.zStartFlag && a.pinchFrames >= 5 && geomOk && a.pinchPRobust <= 3 && a.allPinchOvNone && a.fontConst && a.after.ov === 'none' && !a.after.flag && a.after.affNull && a.restCov >= 0.9 && extra;
    pass(id, ok, `engaged=${a.zStartFlag} zoomSpan=${a.zoomSpan} pinchFrames=${a.pinchFrames} | geomRatio ext=${a.pinchExt}(want≈${wantK.toFixed(3)}) | Metric P robust=${a.pinchPRobust}px(max${a.pinchPMax}) ovNone=${a.allPinchOvNone} | font mid[${a.midPx}]⊆rest[${a.restPx}]=${a.fontConst} | after ov=${a.after.ov} flag=${a.after.flag} affNull=${a.after.affNull} z=${a.after.z} restCov=${a.restCov} (pp0=${a.pp0.x},${a.pp0.y})`);
  };
  try { chk(`${label}/W5-in`, await pinchProfile(ctx, { fromZ: 12, dir: 'in' }), 'in'); } catch (e) { pass(`${label}/W5-in`, false, 'error ' + e.message); }
  try { const b = await pinchProfile(ctx, { fromZ: 12, dir: 'in', panBy: [220, 140] }); chk(`${label}/W5-panIn`, b, 'in', Math.hypot(b.pp0.x, b.pp0.y) >= 150); } catch (e) { pass(`${label}/W5-panIn`, false, 'error ' + e.message); }
  try { chk(`${label}/W5-out`, await pinchProfile(ctx, { fromZ: 14, dir: 'out' }), 'out'); } catch (e) { pass(`${label}/W5-out`, false, 'error ' + e.message); }
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
  else na(`${label}/W5(in+panIn+out)`, `驗不了:Playwright WebKit 構不出帶 2 touches 的 TouchEvent(new Touch→[${diag.newTouch}];new TouchEvent({touches})→[${diag.newTouchEventWithTouches}])→派發 touchstart touches.length=${diag.dispatchedTouchesLen},Leaflet _onTouchStart(要求 2)未觸發、touchZoom._zooming=${diag.touchZoomEngaged}。非程式缺陷=harness 限制;捏合走原生逐幀 _move 重投影(引擎無關),幾何比與 overlay-none 已由 WebKit 上 Z1/Z2(zoomanim 路徑)驗過。不硬湊直呼內部 handler。`);
}

// ── 執行 ──
const ONLY = process.env.ONLY || '';
if (!ONLY || ONLY.includes('cd')) await run(chromium, 'chromium-desktop', { cdp: true });
if (!ONLY || ONLY.includes('cm')) await run(chromium, 'chromium-mobile', { mobile: true, cdp: true });
if (!ONLY || ONLY.includes('wd')) await run(webkit, 'webkit-desktop', { isWebkit: true });
if (!ONLY || ONLY.includes('dp')) await detectionPower(chromium);
if (!ONLY || ONLY.includes('cp')) await runPinch(chromium, 'chromium-pinch');
if (!ONLY || ONLY.includes('wp')) await runPinchWebkit(webkit, 'webkit-pinch');

console.log('\n================ SUMMARY ================');
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.msg}`);
for (const r of naResults) console.log(`N/A   ${r.id}  ${r.msg}`);
console.log(`\n${results.length - fails.length}/${results.length} checks passed; ${naResults.length} N/A.`);
process.exit(fails.length ? 1 : 0);
