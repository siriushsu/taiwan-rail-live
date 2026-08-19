#!/usr/bin/env node
// 手勢中的跨層同步:捏合縮放（pinch）／滾輪縮放／拖曳平移進行中，OpenFreeMap 底圖（MapLibre GL 畫布）
// 與列車 overlay 是否同步、視圖有沒有「跳動」（zoom 反向／位置回彈）。
//
// 為什麼要有這支：verify_basemap_align.mjs 五個情境全是 animate:false 的靜態落定態，
// 「捏合放手的那一拍」「拖曳進行中的每一幀」一格都沒量——真機一捏就看得到的跳動，靜態判準集體全綠。
//
// 量兩種東西：
//   (1) 逐幀數值：Leaflet zoom／_animatingZoom／overlay 仿射 k／GL 畫布 CSS 縮放與位置／
//       GL 上次 render 時的 zoom；由此算「探針世界點」在底圖上被畫在哪（rect×render 時投影）
//       與 overlay 會把它畫在哪（latLngToContainerPoint，含仿射）。
//   (2) 逐幀畫面（CDP screencast）：洋紅（底圖引擎畫）與青色（overlay 畫）兩顆探針的實際像素位置——
//       這是唯一不與任何投影公式同源的真值。
//
// 用法：node scripts/verify_basemap_gesture.mjs [--target app|web] [--scenario pinchin|pinchsnap|pinchout|wheel|drag|dragfast|all]
//                                             [--frames 目錄]（存 screencast 逐幀 PNG 供人看）
//   情境：pinchin/pinchsnap/pinchout/pinchpan（手機觸控 CDP，pinchsnap 離中心捏、pinchpan 邊捏邊拖）、wheel/drag/dragfast（桌面）
//   --target app 讀 app/www（要先 `cd app && npm run build`，否則驗的是上一顆 build）；web 讀 repo 根目錄 index.html
//   需 sharp 原生模組：在 Apple Silicon 用 `arch -arm64 node …`
// 判準（見檔尾）：畫面探針距離 >3px 的幀 ≤2 且最大 ≤8px（wheel 只回報）、捏合放手第一拍 k＝2^(捏合末 zoom−目標 zoom)±0.03、
//   收斂動畫期間遠探針錯位 ≤4px、頁面錯誤 0。exit 1 = 有情境未過。
// 已知基準（2026-08-19，修復前 bc2d649）：pinchin 首拍 k=0.500（應 0.950）、WebKit 拖曳整段 overlay 落後 2–3px。
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1'] : []).filter(Boolean));
const TARGET = args.target || 'app';
const SCEN = args.scenario || 'all';
const FRAMES_DIR = args.frames ? resolve(args.frames) : null;
const ROOT = resolve(import.meta.dirname, '..');
const WWW = TARGET === 'web' ? ROOT : join(ROOT, 'app', 'www');
const PORT = Number(process.env.GESTURE_PORT || 43577);
const DOT = { lat: 23.4700, lng: 120.9570 };   // 同 verify_basemap_align：中央山脈、沒有鐵路，探針乾淨
const START_Z = 12;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const built = await readFile(join(WWW, 'index.html'), 'utf8');
console.log(`[G0] 目標 ${TARGET} ${WWW}  index.html ${built.length} bytes  情境 ${SCEN}`);
for (const f of ['aligndot', 'L.maplibreGL({ style: OFM_STYLE[k]']) {
  if (!built.includes(f)) { console.error(`❌ [G0] 這份 build 缺「${f}」——驗錯目標或 build 過期`); process.exit(1); }
}

const server = createServer(async (rq, rs) => {
  try {
    const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    const f = join(WWW, p === '/' ? 'index.html' : p);
    if (!f.startsWith(WWW)) { rs.statusCode = 403; return rs.end(); }
    const b = await readFile(f);
    rs.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream');
    rs.end(b);
  } catch { rs.statusCode = 404; rs.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch();
// 手機殼：有觸控（捏合要走 Leaflet TouchZoom）、DPR 2；桌面情境（wheel／drag）另開 desktop context
async function makeCtx(mobile) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 393, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  await ctx.route('**://tiles.stadiamaps.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
  await ctx.route('**/api/**', async r => {
    const u = new URL(r.request().url());
    try {
      const res = await fetch('https://railisland.tw' + u.pathname + u.search, { headers: { accept: 'application/json' } });
      await r.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
    } catch { await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }); }
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); localStorage.setItem('trainmap-powersave', '0'); } catch (e) {} });
  return ctx;
}

async function openPage(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?aligndot=${DOT.lat},${DOT.lng}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__map && window.__ofmGl, null, { timeout: 45000 });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(([lat, lng, z]) => window.__map.setView([lat, lng], z, { animate: false }), [DOT.lat, DOT.lng, START_Z]);
  await page.waitForFunction(() => window.__ofmGl.loaded() && window.__ofmGl.isStyleLoaded(), null, { timeout: 45000 });
  await page.waitForTimeout(2500);
  const z = await page.evaluate(() => window.__map.getZoom());
  if (z !== START_Z) throw new Error(`前置失敗：setView 沒生效 z=${z}`);
  return { page, errs };
}

// 逐幀數值記錄器（掛在頁面 rAF 上，與 tick 同節奏）
// 除了畫面中央的探針（DOT，捏合焦點附近、對「整片縮放比例錯了」最不敏感），另加一顆「遠探針」F：
// 開始時落在容器 (12%,12%) 角落的世界點——overlay 仿射 k 若標定錯（例：以捏合前的 zoom 標定），
// 誤差 ∝ 離焦點距離，遠探針才量得出真機看到的「整片軌道跳回去」量級（中央探針只差幾 px）。
async function startRecorder(page) {
  await page.evaluate(([lat, lng]) => {
    const m = window.__map, gl = window.__ofmGl, cvs = gl.getCanvas(), st = window.__state;
    const sz = m.getSize(), F = m.containerPointToLatLng([sz.x * 0.12, sz.y * 0.12]);
    let last = null;
    gl.on('render', () => { const p = gl.project([lng, lat]), pf = gl.project([F.lng, F.lat]); last = { z: gl.transform.zoom, x: p.x, y: p.y, fx: pf.x, fy: pf.y, t: performance.now() }; });
    window.__rec = []; window.__recOn = true;
    const frame = (t) => {
      if (!window.__recOn) return;
      const r = cvs.getBoundingClientRect(), mc = m.getContainer().getBoundingClientRect();
      const sc = r.width / cvs.clientWidth;
      const ov = m.latLngToContainerPoint([lat, lng]), of = m.latLngToContainerPoint(F);
      const pp = m._getMapPanePos();
      window.__rec.push({
        t: Math.round(t), z: +m.getZoom().toFixed(3), anim: !!m._animatingZoom, za: !!st._zoomAnim,
        k: st._zaAff ? +st._zaAff.k.toFixed(3) : null,
        glz: +gl.transform.zoom.toFixed(3), rz: last ? +last.z.toFixed(3) : null,
        sc: +sc.toFixed(3), rx: +(r.left - mc.left).toFixed(1), ry: +(r.top - mc.top).toFixed(1),
        bx: last ? +(r.left - mc.left + last.x * sc).toFixed(1) : null, by: last ? +(r.top - mc.top + last.y * sc).toFixed(1) : null,
        ox: +ov.x.toFixed(1), oy: +ov.y.toFixed(1), px: +pp.x.toFixed(1), py: +pp.y.toFixed(1),
        fbx: last ? +(r.left - mc.left + last.fx * sc).toFixed(1) : null, fby: last ? +(r.top - mc.top + last.fy * sc).toFixed(1) : null,
        fox: +of.x.toFixed(1), foy: +of.y.toFixed(1),
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [DOT.lat, DOT.lng]);
}
async function stopRecorder(page) {
  return page.evaluate(() => { window.__recOn = false; return window.__rec; });
}

// screencast：Chromium 每合成一幀就給一張，這是「畫面上到底畫了什麼」的真值
async function startCast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ev => {
    frames.push({ ts: ev.metadata.timestamp, data: ev.data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return { cdp, frames };
}
async function stopCast(cast) {
  try { await cast.cdp.send('Page.stopScreencast'); } catch {}
  return cast.frames;
}

function blob(data, w, h, ch, test) {
  let n = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch;
    if (!test(data[i], data[i + 1], data[i + 2])) continue;
    n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return n ? { n, cx: sx / n, cy: sy / n, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}
async function analyzeFrames(frames, dpr, tag) {
  const out = [];
  let i = 0;
  for (const f of frames) {
    const buf = Buffer.from(f.data, 'base64');
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const mag = blob(data, info.width, info.height, info.channels, (r, g, b) => r > 200 && g < 70 && b > 200);
    const cy = blob(data, info.width, info.height, info.channels, (r, g, b) => r < 70 && g > 200 && b > 200);
    // screencast 影像可能被縮過：用實際寬 / 視窗 CSS 寬換算成 CSS px
    const scale = info.width / (dpr === 2 ? 393 : 1100) ;
    out.push({ i, ts: f.ts, mag: mag ? { x: mag.cx / scale, y: mag.cy / scale, w: mag.w / scale, n: mag.n } : null,
      cy: cy ? { x: cy.cx / scale, y: cy.cy / scale, n: cy.n } : null });
    if (FRAMES_DIR) await writeFile(join(FRAMES_DIR, `${tag}-${String(i).padStart(3, '0')}.png`), buf);
    i++;
  }
  return out;
}

// CDP 觸控捏合：兩指從 ±d0 撐到 ±d1（縱向），每步等一幀；(dx,dy)=兩指中心在整段手勢裡的平移量（捏合中同時拖）
async function pinch(page, cdp, cx, cy, d0, d1, steps, dx = 0, dy = 0) {
  const pts = (d, f) => [{ x: cx + dx * f, y: cy + dy * f - d, id: 0 }, { x: cx + dx * f, y: cy + dy * f + d, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0, 0) });
  for (let s = 1; s <= steps; s++) {
    const f = s / steps, d = d0 + (d1 - d0) * f;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d, f) });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function fmtRow(r) {
  return `t=${String(r.t).padStart(6)} z=${r.z.toFixed(3)} anim=${r.anim ? 1 : 0} za=${r.za ? 1 : 0} k=${r.k === null ? '  -  ' : r.k.toFixed(3)} glz=${r.glz.toFixed(3)} rz=${r.rz === null ? '-' : r.rz.toFixed(3)} sc=${r.sc.toFixed(3)} rect=(${r.rx},${r.ry}) base=(${r.bx},${r.by}) ov=(${r.ox},${r.oy}) pane=(${r.px},${r.py})`;
}

const summary = [];
async function runScenario(name) {
  const mobile = name.startsWith('pinch');
  const ctx = await makeCtx(mobile);
  const { page, errs } = await openPage(ctx);
  const cdp = await ctx.newCDPSession(page);
  const size = await page.evaluate(() => { const s = window.__map.getSize(); return { x: s.x, y: s.y }; });
  const cx = size.x / 2, cy = size.y / 2;
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await startRecorder(page);
  const cast = await startCast(page);
  await page.waitForTimeout(150);
  const t0 = await page.evaluate(() => performance.now());
  if (name === 'pinchin') await pinch(page, cdp, cx, cy, 50, 95, 24);          // 放大 ~+0.93 級 → 收斂到 +1
  // 彈回原級要「離中心捏」：正中央捏、目標=起始視圖時 Leaflet 的 proxy transform 不變，會同步跳過整段動畫（無 za 幀可量）
  else if (name === 'pinchsnap') await pinch(page, cdp, cx + 40, cy + 70, 50, 66, 16); // 放大 ~+0.40 級 → 收斂回原級（Leaflet zoomSnap=1）
  else if (name === 'pinchout') await pinch(page, cdp, cx, cy, 95, 50, 24);    // 縮小 ~-0.93 級 → 收斂到 -1
  else if (name === 'pinchpan') await pinch(page, cdp, cx - 30, cy - 40, 50, 92, 24, 70, 90); // 邊捏邊拖：放大 ~+0.88 級同時兩指中心平移 (70,90)
  else if (name === 'wheel') { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -120); }
  else if (name === 'drag') {
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let s = 1; s <= 24; s++) { await page.mouse.move(cx + 6 * s, cy + 4 * s); await page.waitForTimeout(16); }
    await page.mouse.up();
  }
  else if (name === 'dragfast') {
    // 真實 60Hz 拖曳：CDP 滑鼠事件不等回應、每 ~8ms 一發（page.mouse.move 每步要來回等，會變成 4 幀一步）
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    // 探針要一直離 UI 遠一點：往左上拖 60 步×(−3,−2)，探針落點仍在畫面中央區（被控件蓋到會量出假錯位）
    const N = 60;
    await new Promise(res => { let s = 0; const iv = setInterval(() => { s++; if (s > N) { clearInterval(iv); return res(); }
      cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - 3 * s, y: cy - 2 * s, button: 'left', buttons: 1 }).catch(() => {}); }, 8); });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx - 3 * N, y: cy - 2 * N, button: 'left', clickCount: 1 });
  }
  await page.waitForTimeout(700);
  const rec = await stopRecorder(page);
  const frames = await stopCast(cast);
  const vis = await analyzeFrames(frames, mobile ? 2 : 1, name);
  await ctx.close();

  // ── 判讀 ──
  const active = rec.filter(r => r.t >= t0 - 20);
  console.log(`\n=== ${name}（${mobile ? '手機觸控' : '桌面'}）  記錄 ${active.length} 幀，screencast ${vis.length} 幀  頁面錯誤 ${errs.length}`);
  // 只印狀態有變的幀，避免洗版
  let prev = null, printed = 0;
  for (const r of active) {
    const key = `${r.z}|${r.anim}|${r.za}|${r.k}|${r.rz}|${r.sc}|${r.rx}|${r.bx}|${r.ox}`;
    if (key !== prev && printed < 90) { console.log('  ' + fmtRow(r)); printed++; }
    prev = key;
  }
  // 視圖 zoom 反向：把「底圖被畫成的比例尺」當視圖 zoom 的代理：rz + log2(sc)（GL 內容 zoom + CSS 縮放）
  const zs = active.filter(r => r.rz !== null).map(r => ({ t: r.t, v: r.rz + Math.log2(r.sc), z: r.z }));
  let reversals = 0, maxRev = 0;
  const trend = name === 'pinchout' ? -1 : 1;
  for (let i = 1; i < zs.length; i++) {
    const d = (zs[i].v - zs[i - 1].v) * trend;
    if (d < -0.15) { reversals++; maxRev = Math.max(maxRev, -d); }
  }
  // 跨層錯位：底圖畫的探針 vs overlay 畫的探針，同一幀的距離
  let maxGap = 0, gapAt = null;
  for (const r of active) if (r.bx !== null) { const g = Math.hypot(r.bx - r.ox, r.by - r.oy); if (g > maxGap) { maxGap = g; gapAt = r.t; } }
  // 畫面真值：洋紅 vs 青色距離
  const missing = vis.filter(v => !(v.mag && v.cy)).map(v => `${v.i}${v.mag ? '' : 'M'}${v.cy ? '' : 'C'}`);
  if (missing.length) console.log(`  （缺探針的幀：${missing.slice(0, 40).join(' ')}${missing.length > 40 ? ' …' : ''}）`);
  let maxVis = 0, visAt = null, visN = 0, visOver = 0;
  for (const v of vis) if (v.mag && v.cy) { visN++; const g = Math.hypot(v.mag.x - v.cy.x, v.mag.y - v.cy.y); if (g > maxVis) { maxVis = g; visAt = v.i; } if (g > 3) visOver++; }
  console.log(`  → 視圖 zoom 代理反向次數 ${reversals}（最大反向 ${maxRev.toFixed(2)} 級）｜數值跨層最大錯位 ${maxGap.toFixed(1)}px @t=${gapAt}｜畫面兩顆探針最大距離 ${maxVis.toFixed(1)}px @frame ${visAt}（${visN}/${vis.length} 幀兩顆都在）`);
  // ── 收斂動畫（za 幀）的兩個直接判準 ──
  // (a) 放手第一拍的 overlay 仿射 k 必須等於「畫布內容當下的 zoom 相對目標 zoom 的比例」= 2^(捏合末 zoom − 目標 zoom)。
  //     以 zoomstart 的 zoom 標定（舊碼）會得到 2^(起始 zoom − 目標 zoom)（例：0.500 而非 0.950）⇒ 整段 250ms overlay 被拉回捏合前版面。
  // (b) 遠探針在 za 幀的數值跨層錯位（畫布內容在收斂動畫期間凍結、只動 CSS transform，此時數值判準與畫面同義）。
  let kFirst = null, kExp = null, farMax = 0, farAt = null;
  const zaIdx = active.findIndex(r => r.za && r.k !== null);
  if (zaIdx > 0) {
    const before = active.slice(0, zaIdx).filter(r => !r.za).pop();
    kFirst = active[zaIdx].k;
    if (before) kExp = Math.pow(2, before.z - active[zaIdx].z);
    for (const r of active) if (r.za && r.fbx !== null) { const g = Math.hypot(r.fbx - r.fox, r.fby - r.foy); if (g > farMax) { farMax = g; farAt = r.t; } }
    console.log(`  → 放手第一拍 k=${kFirst.toFixed(3)}（應為 2^(${before ? before.z.toFixed(3) : '?'}−${active[zaIdx].z.toFixed(3)})=${kExp === null ? '?' : kExp.toFixed(3)}）｜遠探針 za 幀最大錯位 ${farMax.toFixed(1)}px @t=${farAt}`);
  }
  if (name.startsWith('drag')) {
    const gs = vis.filter(v => v.mag && v.cy).map(v => Math.hypot(v.mag.x - v.cy.x, v.mag.y - v.cy.y));
    console.log(`  → 畫面逐幀 洋紅–青色 距離(px)： ${gs.map(g => g.toFixed(1)).join(' ')}`);
    const xs = vis.filter(v => v.mag && v.cy).map(v => `${v.mag.x.toFixed(0)}/${v.cy.x.toFixed(0)}`);
    console.log(`  → 畫面逐幀 洋紅x/青色x： ${xs.join(' ')}`);
  }
  if (name.startsWith('pinch') || name === 'wheel') {
    // 洋紅寬度＝底圖畫布當下的 CSS 縮放（r=18 畫布 px 固定）：畫面上看縮放曲線有沒有回頭
    const ws = vis.filter(v => v.mag).map(v => v.mag.w);
    console.log(`  → 畫面洋紅寬度序列(=底圖畫布 CSS 縮放)： ${ws.map(w => w.toFixed(0)).join(' ')}`);
    const cys = vis.filter(v => v.cy && v.mag).map(v => `${v.mag.x.toFixed(0)},${v.mag.y.toFixed(0)}/${v.cy.x.toFixed(0)},${v.cy.y.toFixed(0)}`);
    console.log(`  → 畫面洋紅/青色位置序列： ${cys.join('  ')}`);
  }
  summary.push({ name, reversals, maxRev, maxGap, maxVis, visN, visOver, errs: errs.length, kFirst, kExp, farMax, animN: active.filter(r => r.anim).length });
}

if (FRAMES_DIR) await mkdir(FRAMES_DIR, { recursive: true });
const list = SCEN === 'all' ? ['pinchin', 'pinchsnap', 'pinchout', 'pinchpan', 'wheel', 'drag', 'dragfast'] : SCEN.split(',');
for (const s of list) await runScenario(s);
await browser.close(); server.close();
console.log('\n=== 總結 ===');
// 判準（每情境）：
//   V  畫面兩顆探針距離 >3px 的幀 ≤2 且最大 ≤8px（wheel 除外：探針被縮放推到「隨機跟隨」鈕底下、且 CSS transition 對 JS 重繪的首幀時差為既有行為，只回報不 gate）
//   K  捏合情境放手第一拍 |k − 2^(捏合末 zoom − 目標 zoom)| ≤ 0.03
//   F  捏合情境 za 幀遠探針錯位 ≤4px
//   A  捏合情境至少量到一幀 Leaflet 縮放動畫（anim=1）——正中央捏又彈回原級會被 Leaflet 同步跳過整段動畫，那樣 K/F 沒東西可量
//   E  頁面錯誤 0；且畫面兩顆探針至少 30 幀同框（少於＝量測本身失效）
let fails = 0;
for (const s of summary) {
  const checks = [];
  if (s.name !== 'wheel') checks.push(['V', s.visOver <= 2 && s.maxVis <= 8]); // 持續性落後(修前 WebKit 拖曳 3/4 的取樣、修前捏合整段 250ms)會連續多幀 >3px;單幀 3–4px 是 screencast 取幀時差,不算
  if (s.name.startsWith('pinch')) {
    // 沒有動畫幀(anim 從未為 1)＝Leaflet 同步跳過整段動畫(目標視圖=起始視圖),沒有東西可同步、K/F 視為通過但要有 A 幀才算量到
    checks.push(['A', s.animN > 0]);
    checks.push(['K', s.animN === 0 || (s.kFirst !== null && s.kExp !== null && Math.abs(s.kFirst - s.kExp) <= 0.03)]);
    checks.push(['F', s.animN === 0 || (s.kFirst !== null && s.farMax <= 4)]);
  }
  checks.push(['E', s.errs === 0 && s.visN >= 30]);
  const bad = checks.filter(c => !c[1]).map(c => c[0]);
  if (bad.length) fails++;
  console.log(`${bad.length ? '❌' : '✅'} ${s.name}: zoom反向 ${s.reversals} 次(最大 ${s.maxRev.toFixed(2)})｜數值錯位 ${s.maxGap.toFixed(1)}px｜畫面錯位 最大 ${s.maxVis.toFixed(1)}px／>3px 有 ${s.visOver} 幀${s.kFirst !== null ? `｜首拍 k ${s.kFirst.toFixed(3)}/應 ${s.kExp === null ? '?' : s.kExp.toFixed(3)}｜遠探針 ${s.farMax.toFixed(1)}px` : ''}｜錯誤 ${s.errs}${bad.length ? `  ← 未過 ${bad.join(',')}` : ''}`);
}
console.log(fails ? `❌ ${fails}/${summary.length} 情境未過` : `✅ ${summary.length}/${summary.length} 情境通過`);
process.exit(fails ? 1 : 0);
