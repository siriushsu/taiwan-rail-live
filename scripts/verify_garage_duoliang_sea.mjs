// 多良景的海面：任何角度都不會整片反白。量的是實際畫出來的像素（不是材質常數，也不是場景自己的公式）。
//
// 起因（2026-09-29 使用者原話「多良車站再從這個後方角度看的時候 海面顏色會變得很奇怪」）：黃昏把鏡頭轉到山側往海看，
// 整片海變成接近白的米色、只剩幾條淡淡的浪線。
// 根因：正交相機＋平行光＋一整片平面 → 整片海的半角向量完全相同；海材質 roughness .32 太光滑，鏡面波瓣一對準太陽的鏡射方向，
// 整片海同時反白（黃昏在鏡頭方位角 41°～71°，日出在 131°，白天、夜晚也有）。修法：多良的海面 roughness 1（duoliang.js 一個數字）。
// （對照實驗：關太陽→任何角度都不反白；只關環境反射→照樣反白；只把 roughness 改 1→不反白。環境反射不是原因。）
//
// 量法：
//  1. 鏡頭用畫面上真的拖曳去轉（main.js 沒有 setYaw）：#reset 回到 yaw −1.12／elevation .61，再拖 yaw、elevation（拖過頭撞到 .23／1.2 的夾限）；
//     一圈 24 格每 15°：k=0 是預設視角、k=8 是「＋120°」（修前黃昏反白最兇、使用者截圖那一格）、k=12 是轉半圈；elevation {.23,.61,1.2}；四個時段。
//     每格讀回 state.yaw 與相機高度，實際角度和目標差太多就紅（掃描沒掃到它宣稱的角度＝什麼都沒驗）。
//  2. 海面上取一組固定點（x −30..30 步 6、y 六排，66 點；probeDown 量到的高度不是海面高度的丟掉＝浪花、岩石）。每格對每個點沿視線
//     （正交相機，方向固定）往相機方向打射線：被任何看得見的東西擋住（陸地、欄杆、遊客、列車、浪花）就丟掉；剩下 ≥ 6 點才判。
//     山側低角度時整片海被擋牆擋住，那幾格不判，另有覆蓋率檢查（判到的格數 ≥ 90%，仰角 .61、1.2 的格一格不能少）。
//  3. 每個點用 newScenePreview.project() 投影到畫布，readPixels 讀 3×3 平均的最終像素（含色調映射），轉 CIELAB，各分量取中位數。
//     （射線的物件清單靠攔截 Raycaster.prototype.intersectObject 從 probeDown 拿到 place.group，不改 main.js。）
//
// 「反白」的定義（兩邊都量）：以各時段「修前預設視角」的海色 REF 為基準——修前的程式在 yaw −1.12、elevation .61 量到的
//   （chromium 與 webkit 差 < 0.3），白天那一組就是使用者說「預設視角看起來要跟現在差不多」的基準：
//   亮度上限 L* ≤ L*ref + 8；亮度下限 L* ≥ L*ref − 12（不能被修成髒黑）；飽和度下限 C* ≥ .6·C*ref；色相與 ref 差 ≤ 60°（夜晚 40°，深藍）。
//   門檻怎麼來的：
//   - 修前反白格：白天 L* 79.7（ref 60.1）、黃昏 76.7（ref 44.1）、日出 88.0（ref 51.6）、夜晚 20.1（ref 1.5）——四個時段亮度都比 ref 高 19～36；
//     黃昏色相 94°（ref 198°，米色）、日出 81°（ref 179°）另外跑掉 99°～104°；白天色相沒跑（192° 對 203°），飽和度掉到 ref 的 .52 倍（C* 14.3 對 27.5）；夜晚只有亮度。
//     所以亮度上限是每個時段都判得出來的那一條，其餘三條（下限、飽和度、色相）是防「修成別的怪色」。
//   - 修後（roughness 1）整個掃描的極值：白天 L* 60.2～62.3、C* 25.9～27.6、色相 201～202°；黃昏 42.6～45.8／10.6～13.5／182～195°；
//     日出 50.5～53.4／5.1～6.0／149～171°；夜晚 1.0～1.7／2.6～3.7／262～269°。最貼近門檻的是日出色相（差 ref 30°，門檻 60°）與各時段亮度（＋1.7～2.2，門檻 ＋8）。
//   夜晚另訂：亮度上限 L* ≤ 9.5（ref 1.5＋8，修前月光反白 20.1）、色相 264.7°±40°（深藍）；日出的 ref 飽和度本來就低（C* 6.3，設計色 #8c9999），
//   所以它的飽和度下限是 3.8、看色相與亮度為主。
// 預設視角白天海面平均色 修前 → 修後 的 ΔE（CIE76）≤ 8（修前那一組寫死在 REF.day，修後現量）。
// 判準自檢：修前反白格的實測色直接餵判準，必須判反白；修前預設視角色餵判準，必須判正常。
//
// 用法：node scripts/verify_garage_duoliang_sea.mjs （GARAGE_BASE_URL 預設 http://127.0.0.1:5255；無視窗，chromium 用 channel:'chrome'；ONLY=chromium 或 webkit 可只跑一個）
// 突變：把 duoliang.js 的 sea roughness 改回 .32，這支必須紅（兩個引擎都紅）；還原後回到全綠。
import {chromium, webkit} from 'playwright';
import {mkdirSync, writeFileSync} from 'node:fs';
const SITE = process.env.GARAGE_BASE_URL || 'http://127.0.0.1:5255';
const OUT = process.env.SEA_OUT || 'output/garage-duoliang-sea';
const only = process.env.ONLY?.split(',');
mkdirSync(OUT, {recursive: true});
const results = [];
const check = (name, pass, detail) => {results.push({name, pass: !!pass, detail}); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? ''));};

const YAW0 = -1.12, STEP = 15 * Math.PI / 180, ELEVS = [.23, .61, 1.2], PERIODS = ['dawn', 'day', 'sunset', 'night'], KS = Array.from({length: 24}, (_, i) => i - 11), MIN_N = 6;
const NAMED = {user: [8, .61, '使用者角度（黃昏、後方：預設視角再轉 ＋120°，elevation .61）'], half: [12, .61, '轉半圈（黃昏，＋180°，elevation .61）']};
// 修前預設視角（yaw −1.12、elevation .61）各時段的海色 CIELAB [L*, a*, b*]；夜晚與日出的 ref 飽和度本來就低。
const REF = {dawn: [51.55, -6.29, .08], day: [60.15, -25.28, -10.82], sunset: [44.07, -13.03, -4.33], night: [1.50, -.30, -3.21]};
const RULE = {dawn: {hue: 60}, day: {hue: 60}, sunset: {hue: 60}, night: {hue: 40}}, DL_MAX = 8, DL_MIN = -12, C_MIN = .6, DE_MAX = 8;

const lin = c => {c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;};
function lab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (.4124564 * R + .3575761 * G + .1804375 * B) / .95047, Y = .2126729 * R + .7151522 * G + .0721750 * B, Z = (.0193339 * R + .1191920 * G + .9503041 * B) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116, fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const median = a => {const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;};
const hueOf = ([, a, b]) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360, chromaOf = ([, a, b]) => Math.hypot(a, b);
const hueGap = (p, q) => {const d = Math.abs(p - q) % 360; return d > 180 ? 360 - d : d;};
const dE76 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
// 判準：回傳違反的條件（空陣列＝正常）
function washed(period, L) {
  const ref = REF[period], why = [];
  if (L[0] > ref[0] + DL_MAX) why.push(`太亮 L*=${L[0].toFixed(1)}>${(ref[0] + DL_MAX).toFixed(1)}`);
  if (L[0] < ref[0] + DL_MIN) why.push(`太暗 L*=${L[0].toFixed(1)}<${(ref[0] + DL_MIN).toFixed(1)}`);
  if (chromaOf(L) < C_MIN * chromaOf(ref)) why.push(`飽和度太低 C*=${chromaOf(L).toFixed(1)}<${(C_MIN * chromaOf(ref)).toFixed(1)}`);
  if (hueGap(hueOf(L), hueOf(ref)) > RULE[period].hue) why.push(`色相跑掉 h=${hueOf(L).toFixed(0)}°（ref ${hueOf(ref).toFixed(0)}°±${RULE[period].hue}）`);
  return why;
}
const stat = colors => {const L = colors.map(lab); return [0, 1, 2].map(c => median(L.map(x => x[c])));};

async function install(page) {
  await page.evaluate(async () => {
    const T = await import('/rail-3d/vendor/three.module.js');
    const orig = T.Raycaster.prototype.intersectObject; let cap = null;
    T.Raycaster.prototype.intersectObject = function (o, ...a) {cap = o; return orig.call(this, o, ...a);};
    newScenePreview.probeDown([0, 0, 50]);
    T.Raycaster.prototype.intersectObject = orig;
    if (!cap) throw new Error('intercept failed');
    const scene = cap.parent, ray = new T.Raycaster(), V = T.Vector3;
    const canvas = document.querySelector('#scene'), gl = canvas.getContext('webgl2') || canvas.getContext('webgl'), buf = new Uint8Array(36);
    window.__sea = {
      meshes() {const out = []; (function walk(o) {if (!o.visible) return; if (o.isMesh) out.push(o); for (const c of o.children) walk(c);})(scene); return out;},
      level(points) {return points.map(p => newScenePreview.probeDown([p[0], p[1], 50]));},
      free(points, dir) {const list = this.meshes(), d = new V(...dir).normalize(); ray.far = 300;
        return points.map(p => {ray.set(new V(p[0] + d.x * .03, p[1] + d.y * .03, p[2] + d.z * .03), d); return ray.intersectObjects(list, false).length === 0;});},
      read(points) {return points.map(p => {const q = newScenePreview.project(p), x = Math.floor(q.x), y = Math.floor(q.y);
        if (x < 2 || y < 2 || x >= canvas.width - 2 || y >= canvas.height - 2) return null;
        gl.readPixels(x - 1, canvas.height - 2 - y, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const m = [0, 0, 0]; for (let i = 0; i < 9; i++) for (let c = 0; c < 3; c++) m[c] += buf[i * 4 + c] / 9; return m;});}
    };
  });
}
async function setCamera(page, yaw, el) {
  await page.click('#reset');
  const box = await page.locator('#scene').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const read = () => page.evaluate(() => {newScenePreview.render(); const s = newScenePreview.state; return {yaw: s.yaw, camZ: s.camera[2]};});
  let cur = await read();
  for (let round = 0; round < 3; round++) {
    const dx = Math.round((yaw - cur.yaw) / .007), dy = round === 0 ? (el < .6 ? 150 : el > .62 ? -150 : 0) : 0;
    if (!dx && !dy) break;
    await page.mouse.move(cx - dx / 2, cy - dy / 2); await page.mouse.down(); await page.mouse.move(cx + dx / 2, cy + dy / 2, {steps: 4}); await page.mouse.up();
    cur = await read();
    if (Math.abs(yaw - cur.yaw) <= .004) break;
  }
  return {yaw: cur.yaw, el: Math.asin((cur.camZ - 6) / 100)};
}
async function sweep(page) {
  await install(page);
  await page.evaluate(() => {newScenePreview.setView('world'); newScenePreview.setTime(30 / 2.6);});   // 列車在正中央，遮住一部分海，正好用來驗「被列車擋住的點有丟掉」
  const cand = []; for (let x = -30; x <= 30; x += 6) for (const y of [-17, -14.5, -12, -9.5, -7, -4.5]) cand.push([x, y]);
  const lv = await page.evaluate(c => __sea.level(c), cand), zs = median(lv.filter(v => v !== null));
  const pts = cand.filter((_, i) => lv[i] !== null && Math.abs(lv[i] - zs) < .01).map(p => [p[0], p[1], zs]);
  const cells = [];
  for (const k of KS) for (const el of ELEVS) {
    const got = await setCamera(page, YAW0 + k * STEP, el);
    const dir = [Math.cos(got.el) * Math.cos(got.yaw), Math.cos(got.el) * Math.sin(got.yaw), Math.sin(got.el)];
    const free = await page.evaluate(([p, d]) => __sea.free(p, d), [pts, dir]);
    for (const period of PERIODS) {
      const px = await page.evaluate(([p, per]) => {newScenePreview.setPeriod(per); newScenePreview.render(); return __sea.read(p);}, [pts, period]);
      const use = pts.map((_, i) => free[i] && px[i] ? px[i] : null).filter(Boolean);
      cells.push({period, k, el, yawErr: got.yaw - (YAW0 + k * STEP), elErr: got.el - el, nFree: free.filter(Boolean).length, n: use.length, L: use.length >= MIN_N ? stat(use) : null});
    }
  }
  return {cells, zs, candidates: pts.length};
}

// ---- 判準自檢（修前的實測色）
{
  const glare = [['sunset', [76.65, -1.13, 16.15], '黃昏 k=8'], ['day', [79.71, -14.04, -2.92], '白天 k=8'], ['dawn', [87.98, 1.43, 8.73], '日出 k=−11'], ['night', [20.08, -2.19, -12.88], '夜晚 k=8']];
  const missed = glare.filter(([p, L]) => !washed(p, L).length).map(g => g[2]), falseAlarm = PERIODS.filter(p => washed(p, REF[p]).length);
  check(`判準自檢：修前四個反白格的實測色都判反白，四個修前預設視角色都判正常`, !missed.length && !falseAlarm.length, {missed, falseAlarm});
}
const engines = {chromium: () => chromium.launch({channel: 'chrome', headless: true}), webkit: () => webkit.launch({headless: true})};
const summary = {};
for (const [engine, launch] of Object.entries(engines)) {
  if (only && !only.includes(engine)) continue;
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}}), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('response', r => {if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());});
    page.on('console', m => {if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());});
    await page.goto(`${SITE}/prototypes/garage-duoliang/`);
    await page.waitForFunction(() => window.newScenePreview?.state.ready, null, {timeout: 90000});
    if ((await page.evaluate(() => newScenePreview.state)).running) await page.click('#play');
    const {cells, zs, candidates} = await sweep(page);
    const judged = cells.filter(c => c.L), tag = engine;
    check(`${tag} 掃描角度：${cells.length / 4} 個鏡頭位置的實際 yaw 與目標差 ≤ .004 rad、elevation 差 ≤ .005（拖曳真的轉到了）`,
      cells.every(c => Math.abs(c.yawErr) <= .004 && Math.abs(c.elErr) <= .005), {maxYaw: Math.max(...cells.map(c => Math.abs(c.yawErr))), maxEl: Math.max(...cells.map(c => Math.abs(c.elErr))), seaZ: +zs.toFixed(4), candidates});
    const unjudgedHigh = cells.filter(c => !c.L && c.el > .3);
    check(`${tag} 覆蓋率：判到的格 ≥ 90%（${judged.length}/${cells.length}），仰角 .61 與 1.2 的格一格不少（未判 ${unjudgedHigh.length}）`, judged.length >= .9 * cells.length && !unjudgedHigh.length, {judged: judged.length, of: cells.length, unjudgedHigh: unjudgedHigh.map(c => `${c.period} k${c.k} el${c.el}`)});
    for (const period of PERIODS) {
      const cs = judged.filter(c => c.period === period), bad = cs.map(c => ({c, why: washed(period, c.L)})).filter(x => x.why.length);
      const worst = cs.reduce((a, c) => c.L[0] > a.L[0] ? c : a, cs[0]);
      check(`${tag} ${period}：每個判到的格海面都不反白（${cs.length - bad.length}/${cs.length}）`, cs.length >= 60 && !bad.length,
        {judged: cs.length, brightest: `k${worst.k} el${worst.el} L*=${worst.L[0].toFixed(1)} C*=${chromaOf(worst.L).toFixed(1)} h=${hueOf(worst.L).toFixed(0)}° n=${worst.n}`, bad: bad.slice(0, 6).map(x => `k${x.c.k} el${x.c.el} L*=${x.c.L[0].toFixed(1)} h=${hueOf(x.c.L).toFixed(0)}° ${x.why.join('、')}`), nBad: bad.length});
    }
    for (const [key, [k, el, name]] of Object.entries(NAMED)) {
      const c = cells.find(c => c.period === 'sunset' && c.k === k && Math.abs(c.el - el) < 1e-6), why = c?.L ? washed('sunset', c.L) : ['沒判到'];
      check(`${tag} 具名格 ${name}：不反白`, c?.L && !why.length, c?.L ? {L: c.L.map(v => +v.toFixed(2)), C: +chromaOf(c.L).toFixed(1), h: +hueOf(c.L).toFixed(0), n: c.n, yaw: +(YAW0 + k * STEP).toFixed(3), why} : {why});
    }
    const d0 = cells.find(c => c.period === 'day' && c.k === 0 && Math.abs(c.el - .61) < 1e-6), de = d0?.L ? dE76(d0.L, REF.day) : NaN;
    check(`${tag} 預設視角白天海面平均色 修前 → 修後 ΔE76 ≤ ${DE_MAX}`, de <= DE_MAX, {before: REF.day, after: d0?.L?.map(v => +v.toFixed(2)), dE76: +de.toFixed(2)});
    check(`${tag} 無程式錯誤`, !errors.length, errors);
    summary[engine] = cells.map(c => ({...c, L: c.L?.map(v => +v.toFixed(2))}));
    await page.close();
  } finally {await browser.close();}
}
writeFileSync(`${OUT}/verification.json`, JSON.stringify({results, cells: summary}, null, 1));
console.log(`${results.filter(r => r.pass).length}/${results.length} PASS`);
if (results.some(r => !r.pass)) process.exitCode = 1;
