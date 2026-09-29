// 多良景：遊客與攝影者跟著經過的列車轉頭。量的是實際畫出來的東西：
// newScenePreview.inspect() 讀回各零件 InstancedMesh 的實例矩陣（頭朝向＝頭實例矩陣的 +X；相機鏡頭朝向＝鏡頭玻璃中心減機身中心；
// 腳＝鞋實例矩陣；身高＝各零件實例矩陣×零件幾何包圍盒），列車位置取 newScenePreview.state.poses（不經過場景自己的程式）。
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
const CHILD_MIN_RATIO = 0.35;      // 小孩與較矮的走路者下限
const RATIO_RANGE = [0.45, 0.75]; // 成人身高／車身高（真實約 1.7/3.6≈0.47；Q 版場景欄杆是照較高的遊客做的，放寬到 0.75）
const FOOT_TOL = 0.02;            // 腳底離平台頂面
const DT = 0.02;                  // 連續取樣步長（秒）
import {chromium, webkit} from 'playwright';
import {mkdirSync, writeFileSync} from 'node:fs';
const SITE = process.env.GARAGE_BASE_URL || 'http://127.0.0.1:5255';
const OUT = 'output/garage-duoliang-watchers';
mkdirSync(OUT, {recursive: true});
const results = [];
const check = (name, pass, detail) => {results.push({name, pass: !!pass, detail}); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? ''));};
const deg = r => r * 180 / Math.PI, wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), angDiff = (a, b) => Math.abs(deg(wrap(a - b)));
const only = process.env.ONLY?.split(',');
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
   // ---- 比例（成人高度／車身高，兩面都量）與腳底貼平台
   const height = sweep.bbox.map(b => b.max[2] - b.min[2]), trainH = sweep.train.max[2] - sweep.train.min[2];
   const ratios = height.map(h => h / trainH), sorted = ratios.slice().sort((x, y) => x - y), median = sorted[Math.floor(sorted.length / 2)];
   const outOfRange = ratios.map((r, i) => ({i, kind: kinds[i], r: +r.toFixed(3)})).filter(x => x.r < CHILD_MIN_RATIO || x.r > RATIO_RANGE[1]);
   check(`${tag} 比例：成人中位數人高／車身高 ∈ [${RATIO_RANGE}]，任何人 ∈ [${CHILD_MIN_RATIO}, ${RATIO_RANGE[1]}]（${n} 人，太高太低兩面都量）`, median >= RATIO_RANGE[0] && median <= RATIO_RANGE[1] && !outOfRange.length, {trainH: +trainH.toFixed(3), median: +median.toFixed(3), min: +sorted[0].toFixed(3), max: +sorted.at(-1).toFixed(3), bad: outOfRange});
   const tops = await page.evaluate(({base, bbox}) => base.map((b, i) => newScenePreview.probeDown([b[0] + 0.45, b[1], b[2] + 2])), {base: sweep.base, bbox: sweep.bbox});
   const footErr = sweep.bbox.map((b, i) => Math.abs(b.min[2] - tops[i]));
   const bad = footErr.map((e, i) => ({i, e: +e.toFixed(3), top: tops[i], foot: +sweep.bbox[i].min[2].toFixed(3)})).filter(x => !(x.e <= FOOT_TOL));
   check(`${tag} 腳底貼平台頂面（誤差 ≤ ${FOOT_TOL}，${n} 人，平台頂面用射線量）`, !bad.length, {ok: n - bad.length, of: n, bad: bad.slice(0, 4)});
   check(`${tag} 無程式錯誤`, !errors.length, errors);
  }
  await page.close();
 } finally {await browser.close();}
}
writeFileSync(`${OUT}/verification.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} PASS`);
if (results.some(r => !r.pass)) process.exitCode = 1;
