#!/usr/bin/env node
// 掃 37 款自製車的車頭，算頭牌掛在哪：沿車頭中線往後打射線，找一塊夠大、夠平、不是窗不是燈的車身，寫進 rail-3d/head-marks.js。
// 用法：node scripts/build_head_marks.mjs。車模改了就重跑，跑完用 scripts/shoot_head_marks.mjs 拼接觸圖人工看過。
// 座標跟車模同一套：+X 車頭、Z 往上、原點在車模中心；x 是牌面中心、z 是高度、t 是後仰角（弧度）、r 是半徑。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'rail-3d/assets/garage-blender-v1');
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'my-train-plan.js'), 'utf8'), ctx);
const IDS = Object.keys(ctx.MyTrainPlan.MODELS);

const BAD = /glass|lamp|lens|smoke|led|示意牌|light/i;   // 頭牌不能蓋住窗、燈、車型牌
const THIN = /rail|hose|plow|rubber|metal|chassis|canopy/i;   // 細桿、管線、排障器：射線穿過去看後面的車身
// 掃不到好位置或位置不對的車款，人工看過接觸圖後在這裡指定高度範圍（佔車高比例）。
const BAND = {};
const HEIGHTS = [.42, .38, .46, .34, .5, .3, .54, .58, .26, .62];   // 想放的高度，由中間往外試

function load(id) {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(DIR, meta.mesh.file)));
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const tris = [];
  const front = meta.bounds.max[0];
  for (const g of meta.mesh.drawGroups) {
    if (THIN.test(g.name)) continue;
    const bad = BAD.test(g.name);
    for (let v = g.start; v < g.start + g.count; v += 3) {
      const a = v * 6, b = a + 6, c = b + 6;
      if (Math.max(f[a], f[b], f[c]) < front - 4) continue;
      tris.push({ a: [f[a], f[a + 1], f[a + 2]], b: [f[b], f[b + 1], f[b + 2]], c: [f[c], f[c + 1], f[c + 2]], bad, name: g.name });
    }
  }
  return { meta, tris, height: meta.bounds.max[2], front };
}
// 打一條沿 -X 的射線，回傳最前面那一面。
function hit(tris, y, z) {
  let best = null;
  for (const t of tris) {
    const { a, b, c } = t;
    if (Math.min(a[1], b[1], c[1]) > y || Math.max(a[1], b[1], c[1]) < y || Math.min(a[2], b[2], c[2]) > z || Math.max(a[2], b[2], c[2]) < z) continue;
    const d = (b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-9) continue;
    const u = ((y - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (z - a[2])) / d, v = ((b[1] - a[1]) * (z - a[2]) - (y - a[1]) * (b[2] - a[2])) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const x = a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]);
    if (!best || x > best.x) best = { x, bad: t.bad, name: t.name };
  }
  return best;
}
// (y, z) 圓盤上的點都要打在同一塊面上。回傳擬合的平面 x = p + q·(z - zc)，打不到或不平回 null。
function fit(tris, zc, r) {
  const pts = [[0, zc]];
  for (const k of [.55, 1]) for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * Math.PI; pts.push([Math.cos(a) * r * k, zc + Math.sin(a) * r * k]); }
  const hits = pts.map(([y, z]) => ({ y, z, h: hit(tris, y, z) }));
  if (hits.some(p => !p.h || p.h.bad)) return null;
  const n = hits.length, mz = hits.reduce((s, p) => s + p.z, 0) / n, mx = hits.reduce((s, p) => s + p.h.x, 0) / n;
  const q = hits.reduce((s, p) => s + (p.z - mz) * (p.h.x - mx), 0) / hits.reduce((s, p) => s + (p.z - mz) ** 2, 0);
  const res = hits.map(p => p.h.x - (mx + q * (p.z - mz))), worst = Math.max(...res.map(Math.abs));
  return { x: mx + q * (zc - mz), q, worst, top: Math.max(...res) };
}
const round = v => Math.round(v * 1000) / 1000;
const out = {};
for (const id of IDS) {
  const { tris, height, front } = load(id);
  let pick = null;
  search: for (const r of [.42, .38, .34, .3, .27, .24]) {
    for (const k of BAND[id] || HEIGHTS) {
      const f = fit(tris, height * k, r);
      if (f && f.worst <= .07 && f.x > front - 1.6) { pick = { ...f, z: height * k, r }; break search; }
    }
  }
  if (!pick) { console.log(`❌ ${id} 找不到位置`); continue; }
  out[id] = { x: round(pick.x + pick.top + .02), z: round(pick.z), t: round(Math.atan(-pick.q)), r: pick.r };
  console.log(`${id.padEnd(10)} x ${out[id].x} (車頭 ${round(front)})  z ${out[id].z}/${round(height)}  t ${out[id].t}  r ${out[id].r}  不平 ${round(pick.worst)}`);
}
const missing = IDS.filter(id => !out[id]);
if (missing.length) { console.error('缺：' + missing.join(' ')); process.exit(1); }
const body = IDS.map(id => `  ${/^\d/.test(id) ? `'${id}'` : id}: ${JSON.stringify(out[id]).replace(/"/g, '')},`).join('\n');
fs.writeFileSync(path.join(ROOT, 'rail-3d/head-marks.js'), `// 頭牌掛在車頭的位置，scripts/build_head_marks.mjs 掃出來的，不要手改。座標跟車模同一套：+X 車頭、Z 往上；t 是後仰角（弧度）、r 是半徑。
export const HEAD_MARKS = {
${body}
};
`);
console.log(`\n寫入 rail-3d/head-marks.js，${IDS.length} 款`);
