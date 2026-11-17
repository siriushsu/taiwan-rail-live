// 地景地圖（新）：全台地景圖磚（engine/，從地景工作區同步來的 three.js 場景）接到網站的 MapLibre 地圖底下。
//
// 做法：地景畫在自己的畫布，放在 MapLibre 畫布正下方；MapLibre 這邊把底圖圖層藏起來（畫布透明），列車、路線、站名照舊由 MapLibre 畫在上面。
//   鏡頭每一格從 MapLibre 拿：在 MapLibre 裡掛一個什麼都不畫的 custom layer，render 時拿到這一格的投影矩陣（墨卡托 → 裁切空間），
//   換成地景場景座標（TM2 公尺，x＝東、y＝上、z＝−北，原點在鏡頭附近的圖磚角）的鏡頭，同一格接著把地景畫出來——兩張畫布同一格更新，不會一前一後。
//   場景座標 → 墨卡托在畫面中心那一點線性化（TM2 與墨卡托都是保角投影，差一個尺度與收斂角；離中心 5 km 誤差約 2 m，遠景本來就在霧裡）。
//   深度：鏡頭的 x、y、w 三列跟 MapLibre 逐位相同（畫面位置一致），z 那一列換成地景自己的近遠平面（遠景塊要畫到幾十公里外）。
//
// 已知限制：兩張畫布不共用深度，MapLibre 的列車一律蓋在地景上面（建物擋不住列車）。
import { toTM2, fromTM2 } from './engine/proj/tm2.mjs';

const LAYER_ID = 'landscape-web', OCC_ID = 'landscape-web-occluder', OCC_AFTER = 'live-vehicles-3d';
const EARTH_C = 2 * Math.PI * 6371008.8;   // MapLibre 的地球周長（MercatorCoordinate 的公尺換算用同一個值）
const mercX = lng => (180 + lng) / 360;
const mercY = lat => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360;
// 底圖：這些來源的圖層在新地景底下全部藏起來（OFM 地景樣式、離線陸地、舊地景的山影與 3D 建物）
const BASEMAP_SOURCES = new Set(['openmaptiles', 'ne2_shaded', 'taiwan-worldcover', 'offline-land', 'terrain']);
// 網站自己加的 3D 圖層裡，新地景已經有的東西（站房與車站周邊建物、隧道口、樹）：藏起來，不然會疊兩份
const HIDE_CUSTOM = new Set(['station-building-context', 'island-stations', 'live-tunnel-apertures', 'landscape-trees']);
// 遠處淡出：傾斜看出去時，MapLibre 會把遠平面以前的路線都畫出來，遠處的線全擠在地平線底下那一排、疊在遠山與天空交界。
// 距離一律用「鏡頭沿視線到畫面中心（再到海平面）的距離 s」的倍數（跟 MapLibre 算霧同一式），跟縮放、畫面大小無關；
// 鏡頭深度 from·s 開始淡、to·s 淡完：
//   1. 路線（rail-3d/integration/profile-lines.js 畫的立體線，網站看到的路線主要是它）：著色器照鏡頭深度淡成透明，強度跟 MapLibre 的霧
//      一樣隨俯角 60°→70° 漸強，60° 以下不淡（俯視、看全台時路線照舊）。
//   2. 貼在地形上的 MapLibre 圖層：地形的霧（sky 的 fog-*，霧色全透明＝只淡出、不上色），起點換算成同一個 from。
//   3. 俯角 70° 以上把 MapLibre 的遠平面拉近到 to·s（比 MapLibre 自己算的近才拉）：再遠就不畫，立體列車、站點也一樣；
//      70°→73° 從 MapLibre 自己的遠平面漸進過去，俯仰時不會跳。
//   站名、平面列車畫在網站自己的畫布，另有視距上限（index.html 的 detailOpacity）。
const FADE = { conservative: { from: 2, to: 5 }, aggressive: { from: 1.5, to: 3 }, off: null }, FADE_DEFAULT = 'conservative', CLEAR = 'rgba(0,0,0,0)';
const fogStart = f => (1 - 1 / f.from) / (1 - 1 / f.to);   // MapLibre 霧的深度＝(1/s − 1/z)／(1/s − 1/遠平面)：z＝from·s 的那一點
const fadeSky = g => ({ 'sky-color': CLEAR, 'horizon-color': CLEAR, 'fog-color': CLEAR, 'fog-ground-blend': g, 'horizon-fog-blend': 1, 'sky-horizon-blend': 0, 'atmosphere-blend': 0 });

// 4×4（行優先，跟 WebGL／three 一樣）相乘：out = a·b
function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const row = (m, r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];

export function attach(map, { tilesBase, hour, date, params: extra = {}, onFail, onState } = {}) {
  const container = map.getContainer();
  const canvas = document.createElement('canvas');
  canvas.className = 'landscape-web-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none';
  container.insertBefore(canvas, container.firstChild);

  const size = { w: container.clientWidth || 1, h: container.clientHeight || 1 }, resizeFns = [];
  new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h || (w === size.w && h === size.h)) return; size.w = w; size.h = h; for (const f of resizeFns) f(); }).observe(container);

  let mainMatrix = null, api = null, active = false, failed = false, lastHour = -Infinity, lastStatus = '';
  // 第一次切進來時，舊底圖先留著蓋在上面，等新地景這個視角的圖磚到齊（或等太久）才藏掉舊底圖：載入那十幾秒畫面不會只剩路線。
  let revealed = false, activeSince = 0, settledSince = 0, settledCount = -1;
  const REVEAL_MAX_MS = 25000, REVEAL_SETTLE_MS = 800;
  // 畫面要的近景、遠景圖磚都到齊，而且 0.8 秒內沒有再多排新的就接手。不等 engine 的總 pending 歸零：載入失敗的圖磚會被 engine
  // 每次排程（約 0.25 秒）重排，pending 永遠剩 1，會白等到上限——同一格換了兩次以上新物件的就當載入失敗，不擋接手
  const tileSeen = new Map(), tileReloads = new Map();
  function tilesSettled(now) {
    let n = 0, ok = true;
    for (const [id, x] of api.tiles) {
      if (tileSeen.has(id) && tileSeen.get(id) !== x) tileReloads.set(id, (tileReloads.get(id) || 0) + 1);
      tileSeen.set(id, x);
      if ((tileReloads.get(id) || 0) >= 2) continue;
      n++; if (!(x.state === 'ready' && x.near !== 'loading' && !(x.wantLod === 0 && !x.near))) ok = false;
    }
    for (const f of api.fars.values()) { n++; if (f.state !== 'ready') ok = false; }
    if (!ok || !api.tiles.size) { settledSince = 0; return false; }
    if (n !== settledCount || !settledSince) { settledCount = n; settledSince = now; return false; }
    return now - settledSince >= REVEAL_SETTLE_MS;
  }
  const state = { loaded: false, error: null, frames: 0, get revealed() { return revealed; }, get status() { return lastStatus; }, get pending() { return api ? api.pending() : -1; } };

  // 這一格的鏡頭：MapLibre 投影矩陣 × 場景座標→墨卡托 ＝ 場景座標→裁切空間，拆成 three 的鏡頭（位置、朝向、投影）
  function sceneToMerc(origin) {
    const c = map.getCenter(), [Er, Nr] = toTM2(c.lng, c.lat), D = 50;
    const a = fromTM2(Er + D, Nr), b = fromTM2(Er - D, Nr), p = fromTM2(Er, Nr + D), q = fromTM2(Er, Nr - D);
    const JEx = (mercX(a[0]) - mercX(b[0])) / (2 * D), JEy = (mercY(a[1]) - mercY(b[1])) / (2 * D);
    const JNx = (mercX(p[0]) - mercX(q[0])) / (2 * D), JNy = (mercY(p[1]) - mercY(q[1])) / (2 * D);
    const sz = 1 / (EARTH_C * Math.cos(c.lat * Math.PI / 180)), dE = origin.e - Er, dN = origin.n - Nr;
    return { M: new Float64Array([JEx, JEy, 0, 0, 0, 0, sz, 0, -JNx, -JNy, 0, 0, mercX(c.lng) + JEx * dE + JNx * dN, mercY(c.lat) + JEy * dE + JNy * dN, 0, 1]), Er, Nr };
  }
  function solve(origin) {
    const { M, Er, Nr } = sceneToMerc(origin);
    const PV = mul(mainMatrix, M), r0 = row(PV, 0), r1 = row(PV, 1), r3 = row(PV, 3);
    // 鏡頭位置：x、y、w 三列同時為 0 的那一點
    const A = [r0, r1, r3], det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d0 = det(A), cam = [0, 1, 2].map(k => det(A.map(r => { const x = r.slice(0, 3); x[k] = -r[3]; return x; })) / d0);
    const k = Math.hypot(r3[0], r3[1], r3[2]), f = [r3[0] / k, r3[1] / k, r3[2] / k];
    let u = [r1[0], r1[1], r1[2]]; const uf = u[0] * f[0] + u[1] * f[1] + u[2] * f[2]; u = [u[0] - uf * f[0], u[1] - uf * f[1], u[2] - uf * f[2]];
    const ul = Math.hypot(...u); u = u.map(v => v / ul);
    const back = [-f[0], -f[1], -f[2]], right = [u[1] * back[2] - u[2] * back[1], u[2] * back[0] - u[0] * back[2], u[0] * back[1] - u[1] * back[0]];
    const W = new Float64Array([...right, 0, ...u, 0, ...back, 0, ...cam, 1]);
    const P = mul(PV, W); for (let i = 0; i < 16; i++) P[i] /= k;
    return { W, P, cam, Er, Nr };
  }
  function setCamera(camera, origin) {
    if (!mainMatrix) return;
    const { W, P } = solve(origin), n = camera.near, f = camera.far;
    P[2] = 0; P[6] = 0; P[10] = -(f + n) / (f - n); P[14] = -2 * f * n / (f - n);
    camera.matrixWorld.fromArray(W); camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.projectionMatrix.fromArray(P); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  const els = new Map();
  const params = new URLSearchParams({ fixed: '1', adapt: '0', ...extra });
  globalThis.__LANDSCAPE_HOST__ = {
    params,
    el: id => { if (id === 'view') return canvas; let e = els.get(id); if (!e) els.set(id, e = document.createElement(id === 'time' || id === 'detail' ? 'input' : 'div')); return e; },
    status: t => { lastStatus = t; onState?.(state); },
    w: () => size.w, h: () => size.h,
    onResize: fn => resizeFns.push(fn),
    camera: setCamera,
    ready: a => { api = a; },
  };

  // 開頁那一刻的視角先給 engine（它一載入就照這個排圖磚，不會先去載預設的八斗子）
  function viewFromMap() {
    const c = map.getCenter(), [e, n] = toTM2(c.lng, c.lat), zoom = map.getZoom(), pitch = map.getPitch() * Math.PI / 180;
    const mpp = EARTH_C * Math.cos(c.lat * Math.PI / 180) / (512 * 2 ** zoom), dist = mpp * map.transform.cameraToCenterDistance;
    return { e, n, dist, az: map.getBearing() * Math.PI / 180, pitch: Math.PI / 2 - pitch };
  }
  const v0 = viewFromMap(); for (const k of ['e', 'n', 'dist', 'az', 'pitch']) params.set(k, String(v0[k]));
  params.set('data', new URL(tilesBase, location.href).href);
  params.set('t', String(hour()));
  if (date?.()) params.set('date', date());

  const loaded = import('./engine/main.js').then(() => {
    if (!api) throw Error('地景 engine 沒有回報 ready');
    state.loaded = true; onState?.(state); return api;
  }).catch(err => { failed = true; state.error = err; console.warn('[地景] 新地景載入失敗，退回舊地景', err); onFail?.(err); throw err; });
  loaded.catch(() => {});

  // 地面高度給網站的立體列車與軌道（rail-3d/integration/map3d.js 的 terrainSample 讀 map.railIslandGround）：新地景接手後，
  // 列車、軌道、橋墩、隧道口貼的是畫面上看到的這一份地形，不是 MapLibre 的 DEM（兩份來源不同、取樣也不同，差幾公尺就浮空或陷下去）。
  // 經緯度 → TM2 每 0.01 度一格用線性近似（格內誤差約 2 公分；toTM2 一次約一微秒，重建一次要問上萬點）；這一點的近景圖磚與遠景塊都還沒到就回 NaN（等於「還沒載到」）。
  // rev 在圖磚到貨、換掉時加一，rail-3d 看到就重建（跟 MapLibre DEM 到貨重建同一條路）。
  const tmCells = new Map();
  function groundLL(lng, lat) {
    if (!api) return NaN;
    const i = Math.floor(lng * 100), j = Math.floor(lat * 100), key = i * 1e5 + j;
    let c = tmCells.get(key);
    if (!c) {
      const lo = (i + .5) / 100, la = (j + .5) / 100, d = .001, [e0, n0] = toTM2(lo, la), [e1, n1] = toTM2(lo + d, la), [e2, n2] = toTM2(lo, la + d);
      tmCells.set(key, c = [lo, la, e0, n0, (e1 - e0) / d, (n1 - n0) / d, (e2 - e0) / d, (n2 - n0) / d]);
    }
    const dl = lng - c[0], dp = lat - c[1], e = c[2] + c[4] * dl + c[6] * dp, n = c[3] + c[5] * dl + c[7] * dp, T = api.TILE_M;
    if (!api.tiles.get(`E${Math.floor(e / T)}_N${Math.floor(n / T)}`)?.h && !api.fars.get(`F${Math.floor(e / (T * 4))}_${Math.floor(n / (T * 4))}`)?.h) return NaN;
    return api.groundAt(e, n);
  }
  const ground = { at: groundLL, rev: 0 }; let groundSig = '', groundAt = 0;
  function syncGround(now) {
    const on = active && revealed && !!api;
    if (!on) { if (map.railIslandGround === ground) { delete map.railIslandGround; ground.rev++; groundSig = ''; } return; }
    if (map.railIslandGround !== ground) { map.railIslandGround = ground; ground.rev++; groundSig = ''; }
    if (now - groundAt < 200) return; groundAt = now;
    let a = 0, b = 0; for (const t of api.tiles.values()) if (t.h) a++; for (const f of api.fars.values()) if (f.h) b++;
    const sig = a + ':' + b + ':' + api.tiles.size + ':' + api.fars.size;
    if (sig !== groundSig) { groundSig = sig; ground.rev++; }
  }

  // 自動降畫質原型（預設關，網址帶 ?ls.auto=1 才開）。engine 自己的 adapt 看「兩格間隔 > 20 ms」，嵌進網站後停著時
  // 列車每 30 ms 才重畫一格，會被當成太慢一路降到底；這裡只在地圖操作中（isMoving）量間隔，停著與剛開始動的那一格不算。
  // 操作中每秒超過 20 ms 的格數過兩成、連兩秒 → engine 像素比降 0.25（最低 1）；操作中連 4 秒都順（< 5%）→ 升回 0.25。
  // 只動 engine 的畫布；時間若花在主執行緒（列車、路線），降像素比幫不上忙，所以先不預設開。
  const autoPr = extra.auto === '1' ? { last: 0, t0: 0, n: 0, slow: 0, bad: 0, good: 0, top: 0, log: [] } : null;
  function autoFrame(now) {
    const dt = now - autoPr.last; autoPr.last = now;
    if (!map.isMoving() || dt > 250) { autoPr.t0 = autoPr.n = autoPr.slow = 0; return; }
    if (!autoPr.top) autoPr.top = api.renderer.getPixelRatio();
    if (!autoPr.t0) { autoPr.t0 = now; return; }
    autoPr.n++; if (dt > 20) autoPr.slow++;
    if (now - autoPr.t0 < 1000) return;
    const share = autoPr.slow / autoPr.n, pr = api.renderer.getPixelRatio(); autoPr.t0 = now; autoPr.n = autoPr.slow = 0;
    let next = pr;
    if (share > .2) { autoPr.good = 0; if (++autoPr.bad >= 2) { autoPr.bad = 0; next = Math.max(1, pr - .25); } }
    else if (share < .05) { autoPr.bad = 0; if (++autoPr.good >= 4) { autoPr.good = 0; next = Math.min(autoPr.top, pr + .25); } }
    else autoPr.bad = autoPr.good = 0;
    if (next !== pr) { api.renderer.setPixelRatio(next); if (autoPr.log.length < 100) autoPr.log.push([Math.round(now), next, +share.toFixed(2)]); }
  }

  function draw() {
    if (!api || !active || !mainMatrix) return;
    if (autoPr) autoFrame(performance.now());
    // 網站時刻／日期 → engine 的太陽、月亮與夜景（engine 每次 setTime 都重讀 params 的 date）
    const d = date?.(); if (d && d !== params.get('date')) { params.set('date', d); lastHour = -Infinity; }
    const h = hour(); if (!(Math.abs(h - lastHour) <= 1 / 60)) { lastHour = h; api.setTime(h); }
    // 這一格要的圖磚範圍與層級（schedule 每 250 ms 看一次 view）：畫面中心＋鏡頭到中心的距離、方位、俯角，都從真的鏡頭算
    const { view, origin, camera } = api, { cam, Er, Nr } = solve(origin);
    const ty = api.groundAt(Er, Nr), dx = cam[0] - (Er - origin.e), dy = cam[1] - ty, dz = cam[2] + (Nr - origin.n), dist = Math.hypot(dx, dy, dz);
    view.e = Er; view.n = Nr; view.dist = dist; view.az = Math.atan2(-dx, dz); view.pitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    api.applyView();
    api.frame(performance.now());
    state.frames++;
    const now = performance.now();
    if (!revealed && ((api.pending() === 0 && [...api.tiles.values()].some(t => t.state === 'ready')) || tilesSettled(now) || now - activeSince > REVEAL_MAX_MS)) {
      revealed = true; queueMicrotask(() => { enforce(); onState?.(state); });   // 不在 MapLibre 畫這一格的途中改樣式
    }
    syncGround(now);
    if (api.pending() > 0 || !revealed) map.triggerRepaint();
  }

  const layer = {
    id: LAYER_ID, type: 'custom', renderingMode: '3d',
    render(gl, args) { mainMatrix = Float64Array.from(args.defaultProjectionData.mainMatrix); draw(); },
  };

  // 遮擋：網站的列車、高架、路線畫完之後（緊接在 live-vehicles-3d 後面），在「新地景的建物／站體比網站畫面更近」的像素
  // 把 MapLibre 畫布淡化成 42%——兩張畫布疊起來，被大樓擋住的部分就跟台北地下段一樣半透明透出來，沒被擋的照舊。
  // 幾何是 engine 畫陰影用的那一份（不含 engine 自己的高架：跟網站的高架幾乎重合，會一格一格閃）；兩張畫布不同 GL context，位置與索引另上傳一份。
  const occ = { on: true, gl: null, prog: null, uM: null, entries: new Map(), key: '', casters: [], drawn: 0 };
  const GHOST_KEEP = .42; // 跟 rail-3d 地下段列車的不透明度一致
  function occProgram(gl) {
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec3 p;uniform mat4 m;void main(){gl_Position=m*vec4(p,1.0);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision lowp float;out vec4 o;void main(){o=vec4(0.0,0.0,0.0,' + (1 - GHOST_KEEP).toFixed(2) + ');}'));
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog));
    return prog;
  }
  const GL_TYPE = gl => new Map([[Float32Array, gl.FLOAT], [Int16Array, gl.SHORT], [Uint16Array, gl.UNSIGNED_SHORT], [Int32Array, gl.INT], [Uint32Array, gl.UNSIGNED_INT], [Int8Array, gl.BYTE], [Uint8Array, gl.UNSIGNED_BYTE]]);
  function occEntry(gl, g) {
    let e = occ.entries.get(g); if (e) return e;
    const pos = g.attributes.position, idx = g.index, types = GL_TYPE(gl);
    if (!pos || !pos.array || pos.itemSize !== 3) return null;
    const vao = gl.createVertexArray(), vbo = gl.createBuffer(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, pos.array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, types.get(pos.array.constructor), !!pos.normalized, 0, 0);
    let ibo = null; if (idx) { ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx.array, gl.STATIC_DRAW); }
    gl.bindVertexArray(null);
    e = { vao, vbo, ibo, count: idx ? idx.count : pos.count, itype: idx ? types.get(idx.array.constructor) : 0 };
    occ.entries.set(g, e); return e;
  }
  // 在目前綁著的畫布（MapLibre 的 GL、這一格的 mainMatrix）淡化被大樓擋住的像素。回傳畫了幾個網格。
  function drawOccluder(gl, matrix) {
    if (!occ.on || !api || !active || !revealed || !matrix || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return 0;
    if (occ.gl !== gl) { occ.gl = gl; occ.prog = occProgram(gl); occ.uM = gl.getUniformLocation(occ.prog, 'm'); occ.entries.clear(); occ.key = ''; }
    const key = api.hsKey();
    if (key !== occ.key) {
      occ.key = key;
      const own = new Set([...api.tiles.values()].map(t => t.structMesh).filter(Boolean));
      occ.casters = api.hsCasters().filter(m => !own.has(m));
      const live = new Set(occ.casters.map(m => m.geometry));
      for (const [g, e] of occ.entries) if (!live.has(g)) { gl.deleteVertexArray(e.vao); gl.deleteBuffer(e.vbo); if (e.ibo) gl.deleteBuffer(e.ibo); occ.entries.delete(g); }
    }
    const base = mul(matrix, sceneToMerc(api.origin).M), u = new Float32Array(16);
    gl.useProgram(occ.prog); gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(false);
    // 同一像素前後好幾面牆只淡化一次：模板先清 0，畫過的設 1。畫完清掉、請 MapLibre 下一個要裁切的圖層重畫遮罩。
    gl.enable(gl.STENCIL_TEST); gl.stencilMask(0xff); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.colorMask(true, true, true, true); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    let n = 0;
    for (const m of occ.casters) {
      if (!m.visible || m.parent?.visible === false) continue;
      const e = occEntry(gl, m.geometry); if (!e) continue;
      const w = mul(base, m.matrixWorld.elements); for (let i = 0; i < 16; i++) u[i] = w[i];
      gl.uniformMatrix4fv(occ.uM, false, u); gl.bindVertexArray(e.vao);
      if (e.ibo) gl.drawElements(gl.TRIANGLES, e.count, e.itype, 0); else gl.drawArrays(gl.TRIANGLES, 0, e.count);
      n++;
    }
    gl.bindVertexArray(null); gl.clear(gl.STENCIL_BUFFER_BIT); gl.disable(gl.STENCIL_TEST);
    if (map.painter) map.painter.currentStencilSource = undefined;
    occ.drawn = n; return n;
  }
  const occLayer = { id: OCC_ID, type: 'custom', renderingMode: '3d', render(gl, args) { drawOccluder(gl, Float64Array.from(args.defaultProjectionData.mainMatrix)); } };

  // 遠處淡出只在新地景接手時開；切回舊地景放回原本的 sky 與 MapLibre 自己算的遠平面。style 整個換掉時 sky 會被清掉，enforce 每次都對一遍。
  // 接手期間天空也歸這裡管：天空與遠景的霧地景自己會畫，MapLibre 的 sky-color 會蓋在地景的天空與遠山上（畫在地平線以上），
  // 網站日夜光影（rail-3d/environment/sun.mjs）每 30 秒塗一次有色的霧，會把遠景整片塗成地平線色。別人這段期間的 setSky 先記著，切回舊地景再放回去。
  let fade = FADE[FADE_DEFAULT], fadeSaved = null, farElev = NaN;
  const setSkyRaw = map.setSky.bind(map), isFadeSky = s => !!s && s['sky-color'] === CLEAR && s['fog-color'] === CLEAR;
  // 別人在接手期間記下的「原本 sky」可能就是這裡的透明 sky（例如換底圖時），舊地景時收到它就當成沒有 sky
  map.setSky = (sky, opts) => { if (fadeSaved) { fadeSaved.sky = sky; return map; } return setSkyRaw(isFadeSky(sky) ? undefined : sky, opts); };
  // style 換到一半時 setSky 會丟錯：離開新地景就不放回（新 style 帶自己的 sky），接手中就等 styledata／render 再對一次
  function applyFade() {
    const want = active && revealed ? fade : null, ready = !!map.style?._loaded;
    applyFar();
    if (!want) { if (fadeSaved) { const prev = fadeSaved.sky; fadeSaved = null; if (ready) setSkyRaw(isFadeSky(prev) ? undefined : prev); } return; }
    if (!ready) return;
    if (!fadeSaved) fadeSaved = { sky: map.getSky() };
    if (map.getSky?.()?.['fog-ground-blend'] !== fogStart(want)) setSkyRaw(fadeSky(fogStart(want)));
  }
  // 每次鏡頭動：交給立體線的淡出距離（map.railIslandDistanceFade，rail-3d/integration/map3d.js 讀）與遠平面
  function applyFar() {
    const tr = map.transform, want = active && revealed ? fade : null, c = tr.cameraToCenterDistance;
    farElev = tr.elevation;
    if (!tr.autoCalculateNearFarZ) tr.clearNearFarZOverride();
    if (!want) { delete map.railIslandDistanceFade; return; }
    const s = Math.max(c / 2, c + tr.elevation * tr.pixelsPerMeter / Math.cos(tr.pitchInRadians)), ramp = (a, b) => Math.max(0, Math.min(1, (tr.pitch - a) / (b - a)));
    map.railIslandDistanceFade = { from: want.from * s, to: want.to * s, strength: ramp(60, 70) };
    const w = ramp(70, 73), auto = tr.farZ, far = Math.min(auto, auto + (want.to * s - auto) * w);
    if (w > 0 && far < auto) tr.overrideNearFarZ(tr.nearZ, far);
  }
  map.on('move', applyFar);
  map.on('resize', applyFar);
  // 地形把畫面中心的高程換掉時（MapLibre 在畫這一格時才更新），下一格照新的高程重算
  map.on('render', () => { if (active && revealed && map.transform.elevation !== farElev) { applyFar(); map.triggerRepaint(); } });

  // 底圖圖層藏起來／放回來（記住原本的 visibility，放回時照原樣）
  const hidden = new Map(); let sig = '';
  const shouldHide = id => { const l = map.getLayer(id); if (!l || id === LAYER_ID) return false; if (HIDE_CUSTOM.has(id) || l.type === 'background') return true; return l.type !== 'custom' && BASEMAP_SOURCES.has(l.source); };
  function enforce() {
    if (!active || !revealed) return;
    for (const id of map.getLayersOrder()) {
      if (!shouldHide(id)) continue;
      const v = map.getLayoutProperty(id, 'visibility') ?? 'visible';
      if (v !== 'none') { hidden.set(id, v); map.setLayoutProperty(id, 'visibility', 'none'); }
    }
    applyFade();
  }
  function restore() { for (const [id, v] of hidden) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v); hidden.clear(); applyFade(); }
  function ensureLayer() {
    if (!active || map.isStyleLoaded?.() === undefined) return;
    try {
      if (!map.getLayer(LAYER_ID)) map.addLayer(layer, map.getLayersOrder()[0]);
      // 遮擋緊接在網站列車圖層後面（地下段那一趟之前）；列車圖層還沒建好時先放最上面，等 styledata 再排
      const order = map.getLayersOrder().filter(id => id !== OCC_ID), vi = order.indexOf(OCC_AFTER), next = vi >= 0 ? order[vi + 1] : undefined;
      const now = map.getLayersOrder(), at = now.indexOf(OCC_ID);
      if (at < 0 || now[at + 1] !== next || (vi >= 0 && now[at - 1] !== OCC_AFTER)) { if (at >= 0) map.moveLayer(OCC_ID, next); else map.addLayer(occLayer, next); }
    } catch (e) { /* style 換到一半：styledata 會再叫 */ }
  }
  map.on('styledata', () => { if (!active) return; const s = map.getLayersOrder().join(); if (s !== sig) { sig = s; ensureLayer(); enforce(); } });
  // 網站自己會在別的時機把圖層打開（例如傾斜時自動開「3D 建築」）：每畫完一格檢查一次，有被打開的就再藏回去
  map.on('render', () => { if (active && revealed) enforce(); });

  return {
    state, canvas,
    get active() { return active; },
    get revealed() { return revealed; },
    get mainMatrix() { return mainMatrix; },
    get occluding() { return occ.on && active && revealed && !!map.getLayer(OCC_ID); },
    setOcclusion(on) { occ.on = !!on; map.triggerRepaint(); }, // 前後對照與閘門用
    get occluderMeshes() { return occ.drawn; },
    get autoPr() { return autoPr; },   // 自動降畫質原型的狀態（沒開是 null）
    get fade() { return fade; },
    setFade(level) { fade = level in FADE ? FADE[level] : FADE[FADE_DEFAULT]; applyFade(); map.triggerRepaint(); }, // 前後對照與閘門用：'conservative'／'aggressive'／'off'
    get engineDate() { return params.get('date'); },   // 這一格 MapLibre 給 custom layer 的投影矩陣（閘門比對鏡頭用）
    get failed() { return failed; },
    loaded,
    setActive(on) {
      on = !!on && !failed;
      if (on === active) { if (on) { ensureLayer(); enforce(); } return; }
      active = on;
      canvas.style.display = on ? 'block' : 'none';
      if (on) { if (!revealed) activeSince = performance.now(); ensureLayer(); enforce(); sig = map.getLayersOrder().join(); loaded.then(() => map.triggerRepaint(), () => {}); }
      else { if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID); if (map.getLayer(OCC_ID)) map.removeLayer(OCC_ID); restore(); syncGround(performance.now()); }
      map.triggerRepaint();
    },
    api: () => api,
  };
}
