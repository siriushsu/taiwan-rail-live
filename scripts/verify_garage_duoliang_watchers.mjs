// 多良景：遊客與攝影者跟著經過的列車轉頭。量的是實際畫出來的東西：
// newScenePreview.inspect() 讀回各零件 InstancedMesh 的實例矩陣（頭朝向＝頭實例矩陣的 +X；相機鏡頭朝向＝鏡頭玻璃中心減機身中心；
// 腳＝鞋實例矩陣；身高＝各零件實例矩陣×零件幾何包圍盒），列車位置取 newScenePreview.state.poses（不經過場景自己的程式）。
// 比例與欄杆（2026-09-29 起）：人高／車身高對真實比 ±5%（真值＝站姿人包圍盒高 ÷ 車模編組最高一節原生高，兩個都是車模檔的公尺）、任何人換成公尺 ∈ [1.1, 1.95]；
// 紅欄杆、觀景層木欄杆、藍立柱木扶手頂面 1.1 m、樓梯扶手頂面離踏階鼻 .9 m、長椅座面 .45 m／椅背頂 .85 m（各 ±10%，射線量畫出來的高度）；山側紅欄杆頂高／成人身高 ∈ [.55, .75]。
// 站房門窗（2026-09-29 起，使用者裁示「門窗也一起改成真實尺寸」）：另建一份 createScene(null) 讀回門、窗、窗櫺的實例矩陣（×幾何包圍盒 8 個角），門窗正前方地面用 probeDown 量，
// 門洞高 2.1～2.4 m、門寬 1.6～1.9 m、窗台離地 .8～1.0 m、窗高 1.2～1.5 m、每格玻璃寬 ≤ 1.0 m（各 ÷ 這款車畫出來的每公尺單位數，三款車各判一次）；窗櫺上下緣與窗差 ≤ .02、位置與組寬大致不動、貼牆且深度與修前相同、畫得出來。
// 用法：node scripts/verify_garage_duoliang_watchers.mjs  （GARAGE_BASE_URL 預設 http://127.0.0.1:5255；無視窗，chromium 用 channel:'chrome'）
//
// 判準常數（寫死在這裡，場景改了常數就會紅）：
const HEAD_LIMIT_DEG = 70;        // 一般遊客頭相對身體的轉角上限
const TORSO_LIMIT_DEG = 75;       // 攝影者上半身相對腳的轉角上限
const HEAD_RATE_LIMIT_DEG = 190;  // 一般遊客頭的角速度上限（度/秒；場景設 3.2 rad/s＝183°/s，留 4% 量測餘地）
const TORSO_RATE_LIMIT_DEG = 145; // 攝影者上半身（頭與相機同轉）角速度上限（場景 2.4 rad/s＝137°/s）
const TURN_RATE_LIMIT_DEG = 125;  // 走路者身體轉向角速度上限（場景 2.0 rad/s＝115°/s）
const AIM_TOL_DEG = 25;           // 頭朝向與「頭→最近車廂中心」夾角容許
const CAMERA_TOL_DEG = 10;        // 相機鏡頭與頭朝向夾角容許
// ---- 比例與欄杆高度（2026-09-29 使用者裁示「選 A：欄杆降到真實約 1.1 m，遊客改成真實比例，跟南迴、高架一致」）
// 真值不是場景自己的公式，是兩個原生尺寸的比（都是公尺）：零件庫站姿人的包圍盒高 ÷ 車模編組最高一節的原生高（garage-model 的 size.z）。
// 畫出來的 人高／車身高（inspect 的 bbox 與 trainBox，同一種包圍盒）要落在它的 ±5%；畫出來的「每公尺幾單位」＝ trainBox 高 ÷ 車模原生高，
// 欄杆、扶手、長椅的高度都用這把尺換成公尺再比。
// 這兩條原本是 CHILD_MIN_RATIO = 0.35、RATIO_RANGE = [0.45, 0.75]：修前遊客固定用 .58 的比例，畫出來是真實的 1.30／1.38／1.41 倍（人高／車身高 .63～.67，
// 真實 .46～.49），欄杆頂 1.05（換成公尺是 2.5 m），舊的成人範圍上限 0.75 就是為了容納那些偏高的遊客與欄杆放寬的。改成真實比之後那個放寬沒有理由了。
const REAL_TOL = 0.05;            // 人高／車身高 中位數相對真實比的容許
const PERSON_M = [1.1, 1.95];     // 任何遊客換成公尺的身高範圍（5 歲小孩 1.1 m，戴帽的高個子 1.95 m）；場景放的是 1.28～1.83 m
const RAIL_TOL = 0.10;            // 欄杆、扶手、長椅高度相對目標的容許
const RAIL_M = {fence: 1.1, hand: 0.9, seat: 0.45, back: 0.85}; // 紅欄杆／觀景層木欄杆／藍立柱木扶手頂高；樓梯扶手頂面離踏階鼻；長椅座面；椅背頂
const FENCE_PERSON = [0.55, 0.75]; // 紅欄杆頂高／成人身高（1.1 ÷ 1.66～1.83＝.60～.66）
const FOOT_TOL = 0.02;            // 腳底離平台頂面
const DT = 0.02;                  // 連續取樣步長（秒）
// ---- 站房正面的門窗（2026-09-29 使用者裁示「門窗也一起改成真實尺寸」；公尺範圍是主對話訂的一般尺寸，不是使用者給的數字）
// 量的是畫出來的東西：另建一份 createScene(null)（同一支模組、不放遊客），烘焙後讀每個 InstancedMesh 的實例矩陣 × 幾何包圍盒的 8 個角；
// 牆面前緣、門窗有沒有被牆埋住用水平射線量（從海側往山側打）；門前地面用射線（頁面上的 newScenePreview.probeDown）量，不假設。
// 基準面：門窗正前方的地面（草地，z 3.65）。山側步道頂面 4.5 只到離牆 2.1 單位處，步道與牆之間是草地，門腳站在草地上（預設視角看得到）。
const DOOR_M = {h: [2.1, 2.4], w: [1.6, 1.9]};                       // 門洞高（門頂離門前地面）、雙開門寬（公尺）
const WIN_M = {sill: [0.8, 1.0], h: [1.2, 1.5], pane: [0.25, 1.0]};  // 窗台離地、窗高、每格玻璃寬（公尺；pane 下限只是擋「窗櫺塞滿」的健全檢查）
const MULLION_TOL = 0.02;                                            // 窗櫺上下緣跟窗一致（單位）
const LAYOUT = {win: [-9.2, -5.3, -1.4], door: -7.1, winW: 1.8, pos: 0.15, width: 0.2}; // 三組窗與門的水平位置、窗組寬（修前的版面，大致不動）
const WALL_GAP = [-0.01, 0.06];                                      // 門窗背面離牆面（單位）：修前 .047（深度沒動）；負的＝埋進牆，太大＝浮空
const DOOR_FOOT = [-0.05, 0.02];                                     // 門腳離門前地面（單位）：修前 +.04（浮空 9 cm）
const FRONT_Y = {door: 5.963, glass: 5.983, tol: 0.005};            // 門、窗玻璃的正面 y（修前的深度，這輪不動；「跟修前同一個深度關係」）
const inR = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
async function readStation(T, S) {
 const sc = S.createScene(null); sc.group.updateMatrixWorld(true);
 const m4 = new T.Matrix4(), v3 = new T.Vector3(), bb = new T.Box3(), all = [];
 sc.group.traverse(o => {
  if (!o.isInstancedMesh || !o.material.color) return;
  o.geometry.computeBoundingBox();
  const g = o.geometry.boundingBox, hex = o.material.color.getHexString();
  for (let i = 0; i < o.count; i++) {
   o.getMatrixAt(i, m4); bb.makeEmpty();
   for (let c = 0; c < 8; c++) bb.expandByPoint(v3.set(c & 1 ? g.max.x : g.min.x, c & 2 ? g.max.y : g.min.y, c & 4 ? g.max.z : g.min.z).applyMatrix4(m4));
   all.push({hex, min: bb.min.toArray(), max: bb.max.toArray()});
  }
 });
 const ray = new T.Raycaster(), hit = (o, d) => {ray.set(new T.Vector3(...o), new T.Vector3(...d)); const h = ray.intersectObject(sc.group, true)[0]; return h ? {p: h.point.toArray(), hex: h.object.material.color?.getHexString?.() ?? null} : null;};
 const glass = all.filter(i => i.hex === '4d5957'), door = all.filter(i => i.hex === '8c4734');
 const cream = all.filter(i => i.hex === 'c9c2ac' && i.max[0] - i.min[0] <= 0.1 && (i.min[1] + i.max[1]) / 2 > 5.5 && (i.min[1] + i.max[1]) / 2 < 6.2); // 窗櫺候選：奶油色、細長、貼在牆前
 const mid = i => [(i.min[0] + i.max[0]) / 2, (i.min[2] + i.max[2]) / 2];
 const wallY = hit([-3.3, 5.0, 4.3], [0, 1, 0])?.p[1] ?? null;   // 兩組窗之間、窗台高度上的牆面前緣
 const st = {glass, door, cream, wallY, doorHit: door.map(d => hit([mid(d)[0], 5.0, mid(d)[1]], [0, 1, 0])), glassHit: glass.map(w => hit([mid(w)[0], 5.0, mid(w)[1]], [0, 1, 0]))};
 sc.dispose();
 return st;
}
// st：readStation 的結果；ground：{door: 門前地面 z, win: [各窗前地面 z]}；unit：畫出來的每公尺幾單位（該款車）
function judgeStation(st, ground, unit) {
 const M = v => v / unit, r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3), out = {};
 const wins = st.glass.slice().sort((a, b) => a.min[0] - b.min[0]), d = st.door[0], cx = i => (i.min[0] + i.max[0]) / 2, cy = i => (i.min[1] + i.max[1]) / 2;
 const doorH = d ? d.max[2] - ground.door : NaN, doorW = d ? d.max[0] - d.min[0] : NaN;
 out.door = {pass: st.door.length === 1 && inR(M(doorH), DOOR_M.h) && inR(M(doorW), DOOR_M.w), detail: {doors: st.door.length, hM: r2(M(doorH)), wM: r2(M(doorW)), hUnits: r3(doorH), wUnits: r3(doorW), ground: ground.door}};
 const rows = wins.map((w, k) => {
  const ms = st.cream.filter(c => cx(c) >= w.min[0] && cx(c) <= w.max[0] && c.max[2] > w.min[2] && c.min[2] < w.max[2] && cy(c) < cy(w)).sort((a, b) => cx(a) - cx(b));
  const edges = [w.min[0], ...ms.flatMap(c => [c.min[0], c.max[0]]), w.max[0]], panes = [];
  for (let i = 0; i < edges.length; i += 2) panes.push(edges[i + 1] - edges[i]);
  return {x: r2(cx(w)), sillM: r2(M(w.min[2] - ground.win[k])), hM: r2(M(w.max[2] - w.min[2])), widthU: r3(w.max[0] - w.min[0]), mullions: ms.length, panesM: panes.map(p => r2(M(p))),
   edgeErr: ms.map(c => Math.max(Math.abs(c.min[2] - w.min[2]), Math.abs(c.max[2] - w.max[2]))), w, ms};
 });
 const strip = rows.map(({w, ms, edgeErr, ...r}) => ({...r, edgeErr: r2(Math.max(0, ...edgeErr))}));
 out.win = {pass: rows.length === 3 && rows.every(r => inR(r.sillM, WIN_M.sill) && inR(r.hM, WIN_M.h)), detail: strip.map(r => ({x: r.x, sillM: r.sillM, hM: r.hM}))};
 out.pane = {pass: rows.length === 3 && rows.every(r => r.mullions >= 3 && r.panesM.every(p => inR(p, WIN_M.pane))), detail: strip.map(r => ({x: r.x, mullions: r.mullions, panesM: r.panesM}))};
 out.mullion = {pass: rows.length === 3 && rows.every(r => r.mullions >= 3 && r.edgeErr.every(e => e <= MULLION_TOL)), detail: strip.map(r => ({x: r.x, mullions: r.mullions, worstErr: r.edgeErr}))};
 out.layout = {pass: rows.length === 3 && !!d && LAYOUT.win.every((x, k) => Math.abs(cx(wins[k]) - x) <= LAYOUT.pos && Math.abs(wins[k].max[0] - wins[k].min[0] - LAYOUT.winW) <= LAYOUT.width) && Math.abs(cx(d) - LAYOUT.door) <= LAYOUT.pos,
  detail: {winX: wins.map(cx).map(r2), winW: wins.map(w => r2(w.max[0] - w.min[0])), doorX: d ? r2(cx(d)) : null}};
 const items = [...wins.map((w, k) => ({name: `窗${k + 1}`, i: w})), ...(d ? [{name: '門', i: d}] : [])];
 const gaps = items.map(({name, i}) => ({name, back: r3(st.wallY - i.max[1]), front: r3(st.wallY - i.min[1])})), foot = d ? d.min[2] - ground.door : NaN;
 const depthOk = !!d && Math.abs(d.min[1] - FRONT_Y.door) <= FRONT_Y.tol && wins.every(w => Math.abs(w.min[1] - FRONT_Y.glass) <= FRONT_Y.tol);
 out.wall = {pass: Number.isFinite(st.wallY) && items.length === 4 && gaps.every(g => inR(g.back, WALL_GAP) && g.front > 0.05) && depthOk && inR(foot, DOOR_FOOT), detail: {wallY: st.wallY, gaps, depthSameAsBefore: depthOk, doorFootUnits: r3(foot)}};
 out.visible = {pass: st.doorHit.length === 1 && !!st.doorHit[0] && st.doorHit[0].hex === '8c4734' && d && Math.abs(st.doorHit[0].p[1] - d.min[1]) <= 0.01 && st.glassHit.length === 3 && st.glassHit.every((h, k) => h && h.hex === '4d5957' && Math.abs(h.p[1] - wins[k].min[1]) <= 0.01),
  detail: {door: st.doorHit.map(h => h && [h.hex, r3(h.p[1])]), glass: st.glassHit.map(h => h && [h.hex, r3(h.p[1])])}};
 return out;
}
import {chromium, webkit} from 'playwright';
import {mkdirSync, writeFileSync} from 'node:fs';
const SITE = process.env.GARAGE_BASE_URL || 'http://127.0.0.1:5255';
const OUT = 'output/garage-duoliang-watchers';
mkdirSync(OUT, {recursive: true});
const results = [];
const check = (name, pass, detail) => {results.push({name, pass: !!pass, detail}); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? ''));};
const deg = r => r * 180 / Math.PI, wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), angDiff = (a, b) => Math.abs(deg(wrap(a - b)));
const only = process.env.ONLY?.split(',');
// 判準自檢（純運算，不開瀏覽器）：把修前實測的門窗幾何（2026-09-29 動手前讀回的實例矩陣）餵進同一組判準——門高、窗高、每格玻璃寬、門腳必須判紅；
// 窗櫺上下緣、位置與組寬、看得見這三項修前本來就對，必須仍綠。判準若被放寬到連修前都過，這一項會紅。
{
 const oldX = [-9.2, -5.3, -1.4], glass = x => ({hex: '4d5957', min: [x - 0.9, 5.983, 4.055], max: [x + 0.9, 6.053, 5.305]}), mu = (x, dx) => ({hex: 'c9c2ac', min: [x + dx - 0.0225, 5.925, 4.055], max: [x + dx + 0.0225, 6.015, 5.305]});
 const OLD = {glass: oldX.map(glass), door: [{hex: '8c4734', min: [-7.575, 5.963, 3.69], max: [-6.625, 6.053, 5.69]}], cream: oldX.flatMap(x => [-0.6, -0.2, 0.2].map(dx => mu(x, dx))), wallY: 6.1,
  doorHit: [{p: [-7.1, 5.963, 4.69], hex: '8c4734'}], glassHit: oldX.map(x => ({p: [x, 5.983, 4.68], hex: '4d5957'}))};
 const j = judgeStation(OLD, {door: 3.65, win: [3.65, 3.65, 3.65]}, 1.25 / 2.8);
 check('站房門窗判準自檢：修前的門窗幾何（藍皮比例尺）→ 門、窗高、每格玻璃寬、貼牆與門腳判紅，窗櫺上下緣、位置與組寬、看得見仍綠',
  !j.door.pass && !j.win.pass && !j.pane.pass && !j.wall.pass && j.mullion.pass && j.layout.pass && j.visible.pass,
  Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.pass])));
}
const engines = {chromium: () => chromium.launch({channel: 'chrome', headless: true}), webkit: () => webkit.launch({headless: true})};
for (const [engine, launch] of Object.entries(engines)) {
 if (only && !only.includes(engine)) continue;
 const browser = await launch();
 try {
  const page = await browser.newPage({viewport: {width: 1200, height: 800}}), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('response', r => {if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());}); page.on('console', m => {if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) /* 資源失敗由上面的 response 監聽記錄真正的網址（chrome 會多要 favicon，那個 404 不算） */ errors.push(m.text());});
  await page.goto(`${SITE}/prototypes/garage-duoliang/`);
  await page.waitForFunction(() => window.newScenePreview?.state.ready, null, {timeout: 90000});
  if ((await page.evaluate(() => newScenePreview.state)).running) await page.click('#play');
  await page.click('[data-period="day"]');
  // 站房正面門窗：畫出來的幾何（實例矩陣）＋門窗正前方的地面（頁面上的 probeDown）；跟列車無關，每個引擎讀一次，換算成公尺在每款車裡各做一次
  const station = await page.evaluate(`(async () => {const T = await import('/rail-3d/vendor/three.module.js'), S = await import('/rail-3d/garage-scenes/duoliang.js'); return (${readStation.toString()})(T, S);})()`);
  station.glass.sort((a, b) => a.min[0] - b.min[0]);
  const ref = await page.evaluate(({xs, y}) => {const api = newScenePreview, p = api.samplePath(-7.1), h = p.heading; return {at: xs.map(x => api.probeDown([x, y, 50])), walk: api.probeDown([p.x - Math.sin(h) * 2.5, p.y + Math.cos(h) * 2.5, 50])};},
   {xs: [...station.door, ...station.glass].map(i => (i.min[0] + i.max[0]) / 2), y: station.wallY - 0.6});   // 門前 .6 處（站在牆前的地面）；walk＝山側步道頂面（只當對照，不是基準）
  const ground = {door: ref.at[0], win: ref.at.slice(1)};
  for (const id of ['blue', 'dr1000', 'emu3000']) {
   await page.selectOption('#train', id);
   await page.waitForFunction(id => newScenePreview.state.model === id && !newScenePreview.state.changing, id);
   const tag = `${engine} ${id}`;
   // 連續掃過：車由左（x<0）往右，從整列在景外掃到整列離景，DT 一步。
   const sweep = await page.evaluate(({DT}) => {
    const api = newScenePreview, t0 = (-75 + 30) / 2.6, t1 = (75 + 30) / 2.6, rec = [];
    api.setTime(t0 - 1);
    for (let t = t0; t <= t1; t += DT) {
     api.setTime(t);
     const st = api.state, cars = st.inScene ? st.poses.map(p => p.position) : [], ins = api.inspect();
     rec.push({t, cars, p: ins.map(v => ({h: v.head.yaw, c: v.camera ? v.camera.yaw : null, y: v.bodyYaw, f: v.feet, pos: v.head.pos}))});
    }
    api.setTime(t0 - 1);
    const ins = api.inspect();
    return {rec, kinds: ins.map(v => v.kind), rel: ins.map(v => v.i), bbox: ins.map(v => v.bbox), base: ins.map(v => v.pos), train: api.trainBox(), opposing: api.state.opposing};
   }, {DT});
   const {rec, kinds} = sweep, n = kinds.length;
   // ---- 追蹤：進場、正前方、離場
   const visible = r => r.cars.filter(c => Math.abs(c[0]) < 35);
   const tEnter = rec.findIndex(r => visible(r).length && Math.max(...visible(r).map(c => c[0])) >= -18);
   let tLeave = -1; rec.forEach((r, i) => {const v = visible(r); if (v.length && Math.min(...v.map(c => c[0])) <= 18) tLeave = i;});
   const moments = [['進場', () => tEnter], ['正前方', pi => {let best = -1, bd = 1e9; rec.forEach((r, i) => {for (const c of visible(r)) {const d = Math.abs(c[0] - r.p[pi].pos[0]); if (d < bd) {bd = d; best = i;}}}); return best;}], ['離場', () => tLeave]];
   let tied = 0, aimN = 0, aimBad = [], clampN = 0, clampBad = [], sideNeg = 0, sidePos = 0;
   const moment = {};
   for (const [label, pick] of moments) for (let pi = 0; pi < n; pi++) {
    const ri = pick(pi); if (ri < 0) {aimBad.push({label, pi, why: 'no moment'}); continue;}
    const r = rec[ri], p = r.p[pi], vis = visible(r);
    if (!vis.length) {aimBad.push({label, pi, why: 'no car'}); continue;}
    let bc = vis[0]; for (const c of vis) if (Math.hypot(c[0] - p.pos[0], c[1] - p.pos[1]) < Math.hypot(bc[0] - p.pos[0], bc[1] - p.pos[1])) bc = c;
    const dists = vis.map(c => Math.hypot(c[0] - p.pos[0], c[1] - p.pos[1])).sort((x, y) => x - y);
    if (dists.length > 1 && dists[1] < dists[0] * 1.10) {tied++; continue;}   // 兩節車廂幾乎一樣近＝哪節算「最近」不明確，這個時點不判
    const toCar = Math.atan2(bc[1] - p.pos[1], bc[0] - p.pos[0]), rel = wrap(toCar - p.y), limit = (kinds[pi] === 'photographer' ? TORSO_LIMIT_DEG : HEAD_LIMIT_DEG) * Math.PI / 180;
    const headRel = wrap(p.h - p.y);
    if (Math.abs(rel) <= limit) {aimN++; const e = angDiff(p.h, toCar); if (e > AIM_TOL_DEG) aimBad.push({label, pi, kind: kinds[pi], err: +e.toFixed(1)}); if (label !== '正前方') {if (headRel < 0) sideNeg++; else sidePos++;}}
    else {clampN++; // 目標超出上限；正後方（|rel|>170°）兩側都算對
      const lim = limit * 180 / Math.PI, h = Math.abs(deg(headRel)); if (!(h <= lim + 1 && h >= lim - 3 && (Math.abs(deg(rel)) > 170 || Math.sign(headRel) === Math.sign(rel)))) clampBad.push({label, pi, kind: kinds[pi], head: +deg(headRel).toFixed(1), target: +deg(rel).toFixed(1)});}
    (moment[label] ??= []).push(+deg(rel).toFixed(0));
   }
   check(`${tag} 追蹤：轉角上限內，頭朝向與最近車廂中心夾角 ≤ ${AIM_TOL_DEG}°（進場／正前方／離場）`, aimN >= 10 && tied <= 6 && !aimBad.length, {ok: aimN - aimBad.length, of: aimN, tiedSkipped: tied, bad: aimBad.slice(0, 6)});
   check(`${tag} 追蹤：超出轉角上限的停在上限、方向對、不翻面`, clampN >= 4 && !clampBad.length, {ok: clampN - clampBad.length, of: clampN, bad: clampBad.slice(0, 6)});
   check(`${tag} 追蹤：進場與離場兩側的視線都測到（車由左往右掃）`, sideNeg >= 3 && sidePos >= 3, {sideNeg, sidePos});
   check(`${tag} 沒有對向車（本景單向穿越），所以不測第二個方向`, sweep.opposing === null, sweep.opposing);
   // ---- 攝影者：鏡頭與頭朝向、腳不動、確實有轉
   const photo = kinds.map((k, i) => k === 'photographer' ? i : -1).filter(i => i >= 0);
   let camN = 0, camBad = 0, maxCam = 0, maxTurn = 0, maxFoot = 0;
   for (const pi of photo) {
    const f0 = rec[0].p[pi].f;
    for (const r of rec) {const p = r.p[pi], e = angDiff(p.c, p.h); camN++; maxCam = Math.max(maxCam, e); if (e > CAMERA_TOL_DEG) camBad++; maxTurn = Math.max(maxTurn, Math.abs(deg(wrap(p.h - p.y))));
     for (let k = 0; k < 2; k++) for (let a = 0; a < 3; a++) maxFoot = Math.max(maxFoot, Math.abs(p.f[k][a] - f0[k][a]));}
   }
   check(`${tag} 攝影者：相機鏡頭朝向與頭朝向夾角 ≤ ${CAMERA_TOL_DEG}°（${photo.length} 人 × 全程取樣）`, photo.length >= 5 && camBad === 0, {ok: camN - camBad, of: camN, worst: +maxCam.toFixed(2)});
   check(`${tag} 攝影者：腳的位置整段不變（≤ 0.001）`, maxFoot <= 0.001, {maxFoot});
   check(`${tag} 攝影者：上半身確實轉了（最大轉角 ≥ 50°，且不超過 ${TORSO_LIMIT_DEG}°）`, maxTurn >= 50 && maxTurn <= TORSO_LIMIT_DEG + 1, {maxTurn: +maxTurn.toFixed(1)});
   // ---- 平滑：連續小步長的最大角速度
   const worst = {visitor: 0, photographer: 0, walker: 0, walkerBody: 0};
   for (let pi = 0; pi < n; pi++) for (let i = 1; i < rec.length; i++) {
    const a = rec[i - 1].p[pi], b = rec[i].p[pi], dt = rec[i].t - rec[i - 1].t;
    const relRate = Math.abs(deg(wrap(wrap(b.h - b.y) - wrap(a.h - a.y)))) / dt;
    const key = kinds[pi] === 'photographer' ? 'photographer' : kinds[pi] === 'walker' ? 'walker' : 'visitor';
    worst[key] = Math.max(worst[key], relRate);
    if (kinds[pi] === 'photographer') worst.photographer = Math.max(worst.photographer, Math.abs(deg(wrap(b.c - a.c))) / dt);
    if (kinds[pi] === 'walker') worst.walkerBody = Math.max(worst.walkerBody, Math.abs(deg(wrap(b.y - a.y))) / dt);
   }
   check(`${tag} 平滑：一般遊客頭的角速度 ≤ ${HEAD_RATE_LIMIT_DEG}°/s（步長 ${DT}s，連續 ${rec.length} 步）`, worst.visitor <= HEAD_RATE_LIMIT_DEG && worst.visitor > 20, {worst: +worst.visitor.toFixed(1)});
   check(`${tag} 平滑：攝影者上半身與相機角速度 ≤ ${TORSO_RATE_LIMIT_DEG}°/s`, worst.photographer <= TORSO_RATE_LIMIT_DEG && worst.photographer > 20, {worst: +worst.photographer.toFixed(1)});
   check(`${tag} 平滑：走路者頭 ≤ ${HEAD_RATE_LIMIT_DEG}°/s、身體轉向 ≤ ${TURN_RATE_LIMIT_DEG}°/s`, worst.walker <= HEAD_RATE_LIMIT_DEG && worst.walkerBody <= TURN_RATE_LIMIT_DEG, {head: +worst.walker.toFixed(1), body: +worst.walkerBody.toFixed(1)});
   // ---- 沒車回到看海：掃描最後一步（整列已離景數秒）
   const last = rec.at(-1);
   let idleBad = [];
   last.p.forEach((p, pi) => {const e = Math.abs(deg(wrap(p.h - p.y))); if (e > 3 && kinds[pi] !== 'walker') idleBad.push({pi, e: +e.toFixed(1)});});
   check(`${tag} 沒車時：頭與上半身回到身體朝向（≤ 3°）`, last.cars.length === 0 && !idleBad.length, {cars: last.cars.length, bad: idleBad});
   // ---- 比例（人高／車身高，兩面都量；真值是兩個原生尺寸的比，不經過場景的比例尺）與腳底貼平台
   const nat = await page.evaluate(async ({id}) => {
    const M = await import('/rail-3d/garage-model.js?revision=doors-0924'), P = await import('/rail-3d/garage-people.js?revision=people-0927'), T = await import('/rail-3d/vendor/three.module.js');
    const primary = await M.loadGarageModel(id), consist = await M.createConsist(id, primary), cars = consist.cars.map(c => +c.asset.size.z.toFixed(4));
    consist.dispose(); primary.dispose();
    const kit = await M.loadGarageParts(new URL('/rail-3d/assets/garage-people-v1/people.json', location.href)), q = new T.Vector3();
    const v = {look: {hair: 'short', torso: 'shirt', accessory: null, scale: 1, top: '#fff', bottom: '#fff', skin: '#fff', hairColor: '#fff', accent: '#fff'}, pose: 'stand', walking: false, stride: 0, step: 1, hand: 0};
    let zmin = 1e9, zmax = -1e9;
    for (const e of P.personPose(v, kit, [])) {const b = kit.parts.get(e.name).geometry.boundingBox;
     for (let c = 0; c < 8; c++) {q.set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).applyMatrix4(e.matrix); zmin = Math.min(zmin, q.z); zmax = Math.max(zmax, q.z);}}
    return {trainM: Math.max(...cars), cars, kitM: zmax - zmin};   // 車模編組最高一節的原生高（公尺）、站姿人的包圍盒高（公尺）
   }, {id});
   const height = sweep.bbox.map(b => b.max[2] - b.min[2]), trainH = sweep.train.max[2] - sweep.train.min[2], unit = trainH / nat.trainM, realRatio = nat.kitM / nat.trainM;
   const ratios = height.map(h => h / trainH), sorted = ratios.slice().sort((x, y) => x - y), median = sorted[Math.floor(sorted.length / 2)];
   const metres = height.map(h => h / unit), outOfRange = metres.map((m, i) => ({i, kind: kinds[i], m: +m.toFixed(2)})).filter(x => x.m < PERSON_M[0] || x.m > PERSON_M[1]);
   check(`${tag} 比例：人高／車身高的中位數 ＝ 真實比 ±${REAL_TOL * 100}%（真實比＝站姿人 ${nat.kitM.toFixed(3)} m ÷ 車身 ${nat.trainM.toFixed(3)} m），任何人換成公尺 ∈ [${PERSON_M}]（${n} 人，太高太低兩面都量）`,
    Math.abs(median / realRatio - 1) <= REAL_TOL && !outOfRange.length,
    {realRatio: +realRatio.toFixed(3), median: +median.toFixed(3), off: +((median / realRatio - 1) * 100).toFixed(1) + '%', trainH: +trainH.toFixed(3), unitPerM: +unit.toFixed(4), minM: +Math.min(...metres).toFixed(2), maxM: +Math.max(...metres).toFixed(2), cars: nat.cars, bad: outOfRange});
   const tops = await page.evaluate(({base, bbox}) => base.map((b, i) => newScenePreview.probeDown([b[0] + 0.45, b[1], b[2] + 2])), {base: sweep.base, bbox: sweep.bbox});
   const footErr = sweep.bbox.map((b, i) => Math.abs(b.min[2] - tops[i]));
   const bad = footErr.map((e, i) => ({i, e: +e.toFixed(3), top: tops[i], foot: +sweep.bbox[i].min[2].toFixed(3)})).filter(x => !(x.e <= FOOT_TOL));
   check(`${tag} 腳底貼平台頂面（誤差 ≤ ${FOOT_TOL}，${n} 人，平台頂面用射線量）`, !bad.length, {ok: n - bad.length, of: n, bad: bad.slice(0, 4)});
   // ---- 欄杆、扶手、長椅（真實高度）：用射線量畫出來的頂面高度（多點取最大，地板取最小），除以畫出來的「每公尺幾單位」換成公尺再比
   // 位置是場景佈局：紅欄杆在軌道法線 −2.45（海側窄月台）與 1.58（山側步道），觀景層前後欄杆 y 5.97／10.43，藍立柱木扶手 y 10.29，長椅在 x −9、−4，階梯在 x 2.6、起點 y 4.3、級深 .32；場景搬了佈局，這裡會因為射線打不到而紅。
   const rail = await page.evaluate(() => {
    const api = newScenePreview, S = [-18, -14.3, -10.6, -6.9, -3.2, 0.5, 4.2, 7.9, 11.6, 15.3, 19], XS = [-10.3, -8.4, -6.5, -4.6, -2.7, -0.8];
    const pt = (s, n) => {const p = api.samplePath(s); return [p.x - Math.sin(p.heading) * n, p.y + Math.cos(p.heading) * n];}, down = (x, y) => api.probeDown([x, y, 50]), nz = (x, y) => {const v = down(x, y); return v === null ? NaN : v;};   // nz：打不到就是 NaN（不會被當成 0 算進去）
    const hi = list => list.reduce((a, v) => v !== null && v > a ? v : a, -Infinity), lo = list => list.reduce((a, v) => v !== null && v < a ? v : a, Infinity);
    // 每個 s 量頂桿頂（取最大：兩段頂桿的接縫可能剛好沒打到），地板取最小（遊客的頭不算地板）
    const along = (n, floors) => {const top = hi(S.map(s => down(...pt(s, n)))), floor = lo(S.flatMap(s => floors.map(f => down(...pt(s, f)))));return {h: top - floor, floor};};
    const line = (y, xs, floors) => hi(xs.map(x => down(x, y))) - lo(xs.flatMap(x => floors.map(f => down(x, f))));
    const tread = i => nz(2.6, 4.3 + i * 0.32 + 0.10), slope = (tread(14) - tread(0)) / (14 * 0.32);   // 踏階鼻連線的斜率（量出來的）
    // 樓梯扶手：在各階踏階鼻往後 .10 處量扶手頂，扣掉踏階鼻連線在那 .10 上升的高度，再減踏面高＝扶手頂面離踏階鼻的垂直高度
    const stair = [1.4, 3.8].flatMap(x => [0, 4, 8, 12, 14].map(i => ({x, i, h: nz(x, 4.3 + i * 0.32 + 0.10) - slope * 0.10 - tread(i)})));
    const bench = [-9, -4].map(x => {const floor = lo([down(x, 8.1), down(x - 0.5, 8.1), down(x + 0.5, 8.1)]); return {x, seat: nz(x, 9.25) - floor, back: nz(x, 9.68) - floor};});
    return {redSea: along(-2.45, [-1.9, -1.85, -1.8]), redMtn: along(1.58, [2.0, 2.05, 2.1]), deckFront: line(5.97, XS, [7.3, 7.4, 7.5]), deckBack: line(10.43, XS, [9.0, 9.05]),
     blueRail: line(10.29, [1.6, 2.2, 3.0, 3.5], [9.6, 9.7]), stair, bench, slope};
   });
   const okRows = rows => rows.every(([, h, t]) => Number.isFinite(h) && Math.abs(h / unit - t) <= RAIL_TOL * t), outRows = rows => rows.map(([name, h, t]) => ({name, m: +(h / unit).toFixed(3), target: t}));
   const rows = {
    red: [['紅欄杆（海側）', rail.redSea.h, RAIL_M.fence], ['紅欄杆（山側）', rail.redMtn.h, RAIL_M.fence]],
    deck: [['觀景層前欄杆', rail.deckFront, RAIL_M.fence], ['觀景層後欄杆', rail.deckBack, RAIL_M.fence]],
    blue: [['藍立柱木扶手', rail.blueRail, RAIL_M.fence]],
    stair: rail.stair.map(s => [`樓梯扶手 x${s.x} 第${s.i + 1}階`, s.h, RAIL_M.hand]),
    bench: rail.bench.flatMap(b => [[`長椅 x${b.x} 座面`, b.seat, RAIL_M.seat], [`長椅 x${b.x} 椅背頂`, b.back, RAIL_M.back]])};
   check(`${tag} 欄杆：紅欄杆（海側、山側）頂面高 ＝ ${RAIL_M.fence} m ±${RAIL_TOL * 100}%（射線頂高 ÷ 畫出來的每公尺 ${unit.toFixed(4)} 單位）`, okRows(rows.red), outRows(rows.red));
   check(`${tag} 欄杆：觀景層木欄杆（前、後）頂面高 ＝ ${RAIL_M.fence} m ±${RAIL_TOL * 100}%`, okRows(rows.deck), outRows(rows.deck));
   check(`${tag} 欄杆：階梯上端藍立柱＋木扶手頂面高 ＝ ${RAIL_M.fence} m ±${RAIL_TOL * 100}%`, okRows(rows.blue), outRows(rows.blue));
   check(`${tag} 扶手：樓梯扶手頂面離踏階鼻 ＝ ${RAIL_M.hand} m ±${RAIL_TOL * 100}%（兩側各第 1、5、9、13、15 階，與踏階鼻連線平行）`, okRows(rows.stair), outRows(rows.stair));
   check(`${tag} 長椅：座面 ＝ ${RAIL_M.seat} m、椅背頂 ＝ ${RAIL_M.back} m（兩張，±${RAIL_TOL * 100}%）`, okRows(rows.bench), outRows(rows.bench));
   // ---- 站房正面門窗（真實尺寸）：實例矩陣讀回的門窗 ÷ 這款車畫出來的每公尺單位數；基準面＝門窗正前方地面（射線量），不是山側步道（步道頂面只到離牆 2.1 單位處；兩個高度都印在 detail）
   const sj = judgeStation(station, ground, unit), sdet = {unitPerM: +unit.toFixed(4), ground: ground.door, walkwayTop: ref.walk};
   check(`${tag} 站房門：門洞高（門頂離門前地面）∈ [${DOOR_M.h}] m、雙開門寬 ∈ [${DOOR_M.w}] m`, sj.door.pass, {...sj.door.detail, ...sdet});
   check(`${tag} 站房窗：三組窗的窗台離地 ∈ [${WIN_M.sill}] m、窗高 ∈ [${WIN_M.h}] m`, sj.win.pass, {win: sj.win.detail, ...sdet});
   check(`${tag} 站房窗：每格玻璃寬 ∈ [${WIN_M.pane}] m（窗櫺之間與窗緣，三組窗、每組 ≥ 3 根窗櫺）`, sj.pane.pass, {pane: sj.pane.detail, ...sdet});
   check(`${tag} 站房窗櫺：上下緣跟窗一致（≤ ${MULLION_TOL} 單位）`, sj.mullion.pass, sj.mullion.detail);
   check(`${tag} 站房門窗：水平位置與組寬大致不動（窗組中心 ${LAYOUT.win} ±${LAYOUT.pos}、組寬 ${LAYOUT.winW} ±${LAYOUT.width}、門 ${LAYOUT.door} ±${LAYOUT.pos}）`, sj.layout.pass, sj.layout.detail);
   check(`${tag} 站房門窗：貼牆（背面離牆面 ∈ [${WALL_GAP}]、正面在牆前）、深度與修前相同、門腳離門前地面 ∈ [${DOOR_FOOT}]`, sj.wall.pass, sj.wall.detail);
   check(`${tag} 站房門窗：畫得出來（海側水平射線打門中心先打到門、打窗中心先打到玻璃，沒被牆埋住）`, sj.visible.pass, sj.visible.detail);
   // 紅欄杆頂高／成人身高：山側步道（腳在步道頂面）上的遊客與走路者，成人＝身高 ≥ 中位數的 90%（小孩、較矮的走路者本來就會比 0.75 高）
   const medH = sorted.map(r => r * trainH)[Math.floor(sorted.length / 2)], onWalk = sweep.bbox.map((b, i) => ({i, kind: kinds[i], foot: b.min[2], h: height[i]})).filter(p => Math.abs(p.foot - rail.redMtn.floor) <= FOOT_TOL * 2);
   const adults = onWalk.filter(p => p.h >= 0.9 * medH), fp = adults.map(p => ({i: p.i, kind: p.kind, r: +(rail.redMtn.h / p.h).toFixed(3)})), fpBad = fp.filter(x => !(x.r >= FENCE_PERSON[0] && x.r <= FENCE_PERSON[1]));
   check(`${tag} 欄杆與人：山側紅欄杆頂高／成人身高 ∈ [${FENCE_PERSON}]（步道上 ${onWalk.length} 人，成人 ${adults.length} 人）`, adults.length >= 8 && !fpBad.length, {adults: adults.length, min: Math.min(...fp.map(x => x.r)), max: Math.max(...fp.map(x => x.r)), bad: fpBad});
   check(`${tag} 無程式錯誤`, !errors.length, errors);
  }
  await page.close();
 } finally {await browser.close();}
}
writeFileSync(`${OUT}/verification.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} PASS`);
if (results.some(r => !r.pass)) process.exitCode = 1;
