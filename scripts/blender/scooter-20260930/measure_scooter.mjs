#!/usr/bin/env node
// 驗收 M1～M4（尺寸、形狀、騎士、面數）：直接從「載入後的網格」量，不讀建模腳本的常數。
// 用法：node scripts/blender/scooter-20260930/measure_scooter.mjs [輸出檔]   （Node 24；不需瀏覽器）
// 量法都附正向對照：形狀連續性拿掉前擋板應該量到缺口、騎士穿模拿把騎士整個往前推 12 cm 應該量到相交。
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from '../../../rail-3d/vendor/three.module.js';
import {buildGarageParts} from '../../../rail-3d/garage-parts.js';
import {createScooterRider} from '../../../rail-3d/garage-scooter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const kit = dir => {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'rail-3d/assets', dir, path.basename(dir).replace(/-v1$/, '').replace('garage-', '') + '.json'), 'utf8'));
  const bin = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'rail-3d/assets', dir, meta.mesh.file)));
  return buildGarageParts(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
};
const peopleKit = kit('garage-people-v1'), scooterKit = kit('garage-scooter-v1');
const rider = createScooterRider({peopleKit, scooterKit, scale: 1});
const lines = [];
const out = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };
const f = (x, d = 3) => Number(x).toFixed(d);

// ---------- 世界座標三角形 ----------
const worldTris = (geometry, matrix) => {
  const pos = geometry.getAttribute('position'), v = new THREE.Vector3(), o = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(matrix); o[i * 3] = v.x; o[i * 3 + 1] = v.y; o[i * 3 + 2] = v.z; }
  return o;
};
const items = rider.inspect().map(it => ({...it, tris: worldTris(it.geometry, it.matrix), local: it.geometry.boundingBox ?? it.geometry.computeBoundingBox() ?? it.geometry.boundingBox}));
const by = (pred) => items.filter(pred);
const scooter = by(i => i.kind === 'scooter'), wheels = by(i => i.kind === 'wheel'), riderParts = by(i => i.kind === 'rider'), helmet = items.find(i => i.name === 'helmet');
const verts = arr => { const vs = []; for (const it of arr) for (let i = 0; i < it.tris.length; i += 3) vs.push([it.tris[i], it.tris[i + 1], it.tris[i + 2]]); return vs; };
const bbox = vs => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const v of vs) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } return {mn, mx}; };
const part = (arr, name) => arr.filter(i => i.name === name || i.name.startsWith(name));

// ---------- 射線 ----------
function rayTri(o, d, T, i, segMax = Infinity) {
  const a = i * 9, e1x = T[a + 3] - T[a], e1y = T[a + 4] - T[a + 1], e1z = T[a + 5] - T[a + 2], e2x = T[a + 6] - T[a], e2y = T[a + 7] - T[a + 1], e2z = T[a + 8] - T[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det, tx = o[0] - T[a], ty = o[1] - T[a + 1], tz = o[2] - T[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 && t <= segMax ? t : -1;
}
const rayHits = (arr, o, d) => { const hs = []; for (const it of arr) for (let i = 0; i < it.tris.length / 9; i++) { const t = rayTri(o, d, it.tris, i); if (t >= 0) hs.push({t, name: it.name}); } return hs.sort((a, b) => a.t - b.t); };
const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

// ---------- 三角形－三角形相交（邊對面）、包圍盒－三角形（SAT）----------
const triEdges = (T, i) => { const a = i * 9, P = [[T[a], T[a + 1], T[a + 2]], [T[a + 3], T[a + 4], T[a + 5]], [T[a + 6], T[a + 7], T[a + 8]]]; return [[P[0], P[1]], [P[1], P[2]], [P[2], P[0]]]; };
const tri2 = (A, i, B, j) => {
  for (const [p, q] of triEdges(A, i)) { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; if (rayTri(p, d, B, j, 1) >= 0) return true; }
  for (const [p, q] of triEdges(B, j)) { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; if (rayTri(p, d, A, i, 1) >= 0) return true; }
  return false;
};
const aabbOf = (T) => { const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], T[i + k]); b[k + 3] = Math.max(b[k + 3], T[i + k]); } return b; };
function meshIntersections(A, B, pad = 0) {   // A、B：{tris}；回傳相交的三角形對數
  let n = 0;
  for (let i = 0; i < A.tris.length / 9; i++) {
    const a = i * 9, lo = [Math.min(A.tris[a], A.tris[a + 3], A.tris[a + 6]) - pad, Math.min(A.tris[a + 1], A.tris[a + 4], A.tris[a + 7]) - pad, Math.min(A.tris[a + 2], A.tris[a + 5], A.tris[a + 8]) - pad];
    const hi = [Math.max(A.tris[a], A.tris[a + 3], A.tris[a + 6]) + pad, Math.max(A.tris[a + 1], A.tris[a + 4], A.tris[a + 7]) + pad, Math.max(A.tris[a + 2], A.tris[a + 5], A.tris[a + 8]) + pad];
    for (let j = 0; j < B.tris.length / 9; j++) {
      const b = j * 9;
      if (Math.max(B.tris[b], B.tris[b + 3], B.tris[b + 6]) < lo[0] || Math.min(B.tris[b], B.tris[b + 3], B.tris[b + 6]) > hi[0]) continue;
      if (Math.max(B.tris[b + 1], B.tris[b + 4], B.tris[b + 7]) < lo[1] || Math.min(B.tris[b + 1], B.tris[b + 4], B.tris[b + 7]) > hi[1]) continue;
      if (Math.max(B.tris[b + 2], B.tris[b + 5], B.tris[b + 8]) < lo[2] || Math.min(B.tris[b + 2], B.tris[b + 5], B.tris[b + 8]) > hi[2]) continue;
      if (tri2(A.tris, i, B.tris, j)) n++;
    }
  }
  return n;
}
// 三角形（相對盒心）對軸對齊盒（半長 h）的重疊；Akenine-Möller 的 13 軸
function triBox(h, v) {
  const e = [[v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], [v[2][0] - v[1][0], v[2][1] - v[1][1], v[2][2] - v[1][2]], [v[0][0] - v[2][0], v[0][1] - v[2][1], v[0][2] - v[2][2]]];
  const sep = (ax) => { const p = v.map(q => q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]), r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]); return Math.min(...p) > r || Math.max(...p) < -r; };
  for (const ed of e) for (const bx of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { const ax = [ed[1] * bx[2] - ed[2] * bx[1], ed[2] * bx[0] - ed[0] * bx[2], ed[0] * bx[1] - ed[1] * bx[0]]; if (Math.hypot(...ax) > 1e-12 && sep(ax)) return false; }
  for (let k = 0; k < 3; k++) if (Math.min(v[0][k], v[1][k], v[2][k]) > h[k] || Math.max(v[0][k], v[1][k], v[2][k]) < -h[k]) return false;
  const n = [e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]];
  if (Math.hypot(...n) < 1e-14) return true;
  const d = n[0] * v[0][0] + n[1] * v[0][1] + n[2] * v[0][2], r = h[0] * Math.abs(n[0]) + h[1] * Math.abs(n[1]) + h[2] * Math.abs(n[2]);
  return Math.abs(d) <= r;
}
// 騎士零件的「有向包圍盒」（零件本地座標的 bbox，經零件矩陣）對一組世界三角形：回傳相交的三角形數
function obbHits(rp, shellTris, shift = [0, 0, 0]) {
  const bb = rp.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(.5).toArray();
  const M = rp.matrix.clone().premultiply(new THREE.Matrix4().makeTranslation(...shift)), inv = M.clone().invert(), cl = new THREE.Vector3(), q = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < shellTris.length / 9; i++) {
    const vv = [0, 1, 2].map(k => { q.set(shellTris[i * 9 + k * 3], shellTris[i * 9 + k * 3 + 1], shellTris[i * 9 + k * 3 + 2]).applyMatrix4(inv); return [q.x - c.x, q.y - c.y, q.z - c.z]; });
    if (triBox(h, vv)) n++;
  }
  return n;
}
const concat = arr => { const n = arr.reduce((a, it) => a + it.tris.length, 0), T = new Float32Array(n); let o = 0; for (const it of arr) { T.set(it.tris, o); o += it.tris.length; } return {tris: T}; };
const shift = (it, d) => ({...it, tris: it.tris.map((x, i) => x + d[i % 3])});

out('# 量測 M1～M4（從載入後的網格量；單位公尺）');
// ================= M1 尺寸（只量機車：不含騎士與安全帽）=================
const sv = verts([...scooter, ...wheels]), sb = bbox(sv);
const tire = side => { const t = wheels.find(w => w.name === 'wheel-tire:' + side), b = bbox(verts([t])); return {c: [(b.mn[0] + b.mx[0]) / 2, 0, (b.mn[2] + b.mx[2]) / 2], d: b.mx[2] - b.mn[2], dx: b.mx[0] - b.mn[0], minZ: b.mn[2], vs: verts([t])}; };
const tf = tire('front'), tr = tire('rear');
const seatTopZ = bbox(verts(part(scooter, 'scooter-seat'))).mx[2], matTopZ = bbox(verts(part(scooter, 'scooter-mat'))).mx[2];
const gripAxis = (sgn = 0) => { const gb = bbox(verts(part(scooter, 'scooter-grip')).filter(v => Math.abs(v[1]) > .22 && (sgn === 0 || v[1] * sgn > 0) && Math.hypot(v[0] - rider.rig.grip[0], v[2] - rider.rig.grip[2]) < .02)); return [0, 1, 2].map(k => (gb.mn[k] + gb.mx[k]) / 2); };   // 握把圓柱（不含煞車把手）的中心
const gripZ = gripAxis()[2];
const m1 = [['全長', sb.mx[0] - sb.mn[0], 1.80, 1.95], ['全寬（含後照鏡）', sb.mx[1] - sb.mn[1], .68, .80], ['座高', seatTopZ, .76, .80], ['軸距', tf.c[0] - tr.c[0], 1.25, 1.32],
  ['輪徑 前', tf.d, .44, .52], ['輪徑 後', tr.d, .44, .52], ['踏板面高', matTopZ, .28, .36], ['握把高', gripZ, 1.00, 1.15]];
let allM1 = true;
for (const [n, v, lo, hi] of m1) { const ok = v >= lo && v <= hi; allM1 &&= ok; out(`M1 ${n}: ${f(v)} 範圍 ${lo}～${hi} → ${ok ? '過' : '不過'}`); }
out(`M1 對照：官方 JET SL 長寬高 1.815×0.680×1.115、軸距 1.290（https://tw.sym-global.com/jetsl125）；本模型 長 ${f(sb.mx[0] - sb.mn[0])}、寬 ${f(sb.mx[1] - sb.mn[1])}、最高 ${f(sb.mx[2])}`);
// ================= M2 形狀 =================
const bodyOnly = concat(part(scooter, 'scooter-body')), fender = concat(part(scooter, 'scooter-fender'));
const shell = concat([...part(scooter, 'scooter-body'), ...part(scooter, 'scooter-fender')]);   // 車殼＝漆色車身＋前土除
const wheelTop = tf.minZ + tf.d;
// (a) 前擋板：前輪頂到握把之間每 1 cm 一個高度，在 y＝0、±.06 三條中線上朝 -x 打射線，必須在 x>.15（前擋板區，不讓後車身湊數）打到車殼
const contin = (shellArr, ys = [0, .06, -.06]) => { const gaps = []; for (let z = wheelTop + .005; z <= gripZ; z += .01) for (const y of ys) if (!rayHits(shellArr, [1.5, y, z], [-1, 0, 0]).some(h => 1.5 - h.t > .15)) gaps.push([+z.toFixed(2), y]); return gaps; };
const gapsOk = contin([{tris: shell.tris, name: 'shell'}]);
out(`M2a 前輪頂 ${f(wheelTop)} 到握把 ${f(gripZ)}：每 1 cm 3 條中線，缺口 ${gapsOk.length} 處 → ${gapsOk.length === 0 ? '過（連續）' : '不過'}`);
const noShield = {tris: shell.tris.filter((_, i) => true)};   // 對照組：拿掉前擋板＋前罩板（重心 x>.15、z>.45 的車殼三角形）
const keep = []; for (let i = 0; i < shell.tris.length / 9; i++) { const cx = (shell.tris[i * 9] + shell.tris[i * 9 + 3] + shell.tris[i * 9 + 6]) / 3, cz = (shell.tris[i * 9 + 2] + shell.tris[i * 9 + 5] + shell.tris[i * 9 + 8]) / 3; if (!(cx > .15 && cz > .45)) keep.push(...shell.tris.slice(i * 9, i * 9 + 9)); }
const gapsNeg = contin([{tris: Float32Array.from(keep), name: 'shell'}]);
out(`M2a 對照組（拿掉前擋板與前罩板）：缺口 ${gapsNeg.length} 處 → ${gapsNeg.length > 0 ? '量法有效（沒有擋板就量得到缺口）' : '量法無效！'}`);
const top = sv.reduce((a, v) => v[2] > a[2] ? v : a), topPart = scooter.find(it => { for (let i = 0; i < it.tris.length; i += 3) if (Math.abs(it.tris[i + 2] - top[2]) < 1e-6 && Math.abs(it.tris[i] - top[0]) < 1e-6) return true; return false; })?.name;
out(`M2a 側面剖面最高點：z ${f(top[2])}、x ${f(top[0])}（零件 ${topPart}）；握把 x ${f(rider.rig.grip[0])} → ${top[2] >= 1 && top[2] <= 1.15 && Math.abs(top[0] - rider.rig.grip[0]) < .15 ? '過（在握把區、1.00～1.15）' : '不過'}`);
// (b) 踏板：mat 頂面 z、平整度；座墊前緣到前擋板後緣的距離
const mats = concat(part(scooter, 'scooter-mat')); const matTop = []; for (let i = 0; i < mats.tris.length / 9; i++) { const zs = [2, 5, 8].map(k => mats.tris[i * 9 + k]); if (zs.every(z => Math.abs(z - matTopZ) < 1e-5)) matTop.push(i); }
const zs = []; for (let x = -.04; x <= .32; x += .01) for (const y of [0, .1, -.1]) { const h = rayHits([{...mats, name: 'mat'}], [x, y, 1], [0, 0, -1]); if (h.length) zs.push(1 - h[0].t); }
const wallX = -1 * (-rayHits([{tris: shell.tris, name: 'shell'}], [.15, 0, .45], [-1, 0, 0])[0].t + .15) * -1;   // 座墊下車廂前壁 x
const wall = .15 - rayHits([{tris: shell.tris, name: 'shell'}], [.15, 0, .45], [-1, 0, 0])[0].t, shieldBack = .15 + rayHits([{tris: shell.tris, name: 'shell'}], [.15, 0, .36], [1, 0, 0])[0].t;
out(`M2b 踏板：頂面 z ${f(matTopZ)}（範圍 .28～.36）；沿 x 每 1 cm、y＝0、±.1 共 ${zs.length} 點，高度起伏 ${f((Math.max(...zs) - Math.min(...zs)) * 100, 2)} cm（門檻 ≤3）；平面長 ${f(shieldBack - wall)}（車廂前壁 x ${f(wall)} → 前擋板後緣 x ${f(shieldBack)}，門檻 ≥.35）→ ${matTopZ >= .28 && matTopZ <= .36 && Math.max(...zs) - Math.min(...zs) <= .03 && shieldBack - wall >= .35 ? '過' : '不過'}`);
// (c) 座墊：後半車（x<0）最高處是不是座墊；座墊上緣斜率
const rear = sv.filter(v => v[0] < 0), rmax = rear.reduce((a, v) => v[2] > a[2] ? v : a);
const seatArr = [{...concat(part(scooter, 'scooter-seat')), name: 'seat'}];
const prof = []; for (let x = -.78; x <= -.06; x += .01) { const h = rayHits(seatArr, [x, 0, 1.2], [0, 0, -1]); if (h.length) prof.push([x, 1.2 - h[0].t]); }
let maxSlope = 0, endSlope = 0; for (let i = 1; i < prof.length; i++) { const s = Math.abs(prof[i][1] - prof[i - 1][1]) / .01; if (prof[i][0] > -.72 && prof[i][0] < -.10) maxSlope = Math.max(maxSlope, s); endSlope = Math.max(endSlope, s); }   // 主頂面＝扣掉前後端各約 10 cm 的圓角
const rearPart = scooter.find(it => { for (let i = 0; i < it.tris.length; i += 3) if (Math.abs(it.tris[i + 2] - rmax[2]) < 1e-6 && Math.abs(it.tris[i] - rmax[0]) < 1e-6) return true; return false; })?.name;
out(`M2c 後半車（x<0）最高點 z ${f(rmax[2])} 屬於 ${rearPart}；座墊頂中線最高 ${f(Math.max(...prof.map(p => p[1])))}、最低（x∈[-.78,-.06]）${f(Math.min(...prof.filter(p => p[0] > -.7).map(p => p[1])))}；主頂面（x∈[-.72,-.10]）上緣最大斜率 ${f(maxSlope)}（≈${f(Math.atan(maxSlope) * 180 / Math.PI, 1)}°）；含前後圓角的最大斜率 ${f(endSlope)}（≈${f(Math.atan(endSlope) * 180 / Math.PI, 1)}°）→ ${rearPart === 'scooter-seat' && maxSlope < .2 ? '過' : '不過'}`);
// (d) 輪子圓、接地
for (const [side, t] of [['前', tf], ['後', tr]]) {
  const rs = []; for (let k = 0; k < 16; k++) { const a = 2 * Math.PI * k / 16, d = [Math.sin(a), Math.cos(a)]; let h = 0; for (const v of t.vs) h = Math.max(h, (v[0] - t.c[0]) * d[0] + (v[2] - t.c[2]) * d[1]); rs.push(h); }
  const mean = rs.reduce((a, b) => a + b) / 16, err = Math.max(...rs.map(r => Math.abs(r - mean) / mean));
  out(`M2d ${side}輪：輪廓 16 點半徑 ${f(Math.min(...rs), 4)}～${f(Math.max(...rs), 4)}，相對誤差 ${f(err * 100, 2)}%（門檻 ≤5%）；最低點高度 ${f(t.minZ * 100, 2)} cm（門檻 ≤1）→ ${err <= .05 && t.minZ <= .01 && t.minZ >= -.005 ? '過' : '不過'}`);
}

// ================= 前車身加厚（主對話 2026-09-30 要求）=================
{
  const bodyArr = [{...bodyOnly, name: 'body'}], fenderArr = [{...fender, name: 'fender'}];
  const prof = (z) => {   // y＝0 的側面剖面：前緣＝從前面朝 -x 第一個 x>.15 的面；後緣＝從 x＝.15 朝 +x 第一個面
    const hf = rayHits(bodyArr, [1.5, 0, z], [-1, 0, 0]).find(h => 1.5 - h.t > .15), hb = rayHits(bodyArr, [.15, 0, z], [1, 0, 0])[0];
    return hf && hb ? {xf: 1.5 - hf.t, xb: .15 + hb.t, d: 1.5 - hf.t - .15 - hb.t} : null;
  };
  const rows = []; for (let z = .35; z <= 1.0001; z += .01) { const q = prof(z); if (q) rows.push({z, ...q}); }
  const inR = (lo, hi) => rows.filter(r => r.z >= lo - 1e-9 && r.z <= hi + 1e-9), minOf = a => a.reduce((m, r) => r.d < m.d ? r : m);
  const rHi = inR(.46, .60), rLo = inR(.35, .46), rGrip = inR(.90, 1.0);
  const at = z => { const r = rows.find(r => Math.abs(r.z - z) < .004); return r ? `z ${f(z, 2)}: 前 ${f(r.xf)}／後 ${f(r.xb)}／深 ${f(r.d)}` : `z ${f(z, 2)}: 無`; };
  out(`前車身側面深度（y＝0，前緣 xf、後緣 xb）：${[.35, .40, .45, .46, .50, .55, .60, .80, .95].map(at).join('；')}`);
  const mh = minOf(rHi), ml = minOf(rLo), mg = minOf(rGrip);
  out(`前車身 z .46～.60 深度最小 ${f(mh.d)}（z ${f(mh.z, 2)}；要求 ≥.28）→ ${mh.d >= .28 ? '過' : '不過'}；z .90～1.00（握把附近）最小 ${f(mg.d)}（要求 ≥.18）→ ${mg.d >= .18 ? '過' : '不過'}`);
  const tireClear = (() => { let m = 1e9; for (const v of verts([...part(scooter, 'scooter-body')])) if (v[0] > .35 && v[2] < .62 && Math.abs(v[1]) < .055) m = Math.min(m, Math.hypot(v[0] - tf.c[0], v[2] - tf.c[2]) - tf.d / 2); return m; })();
  out(`前車身 z .35～.46 前緣被前胎限住：${f(ml.d)}（最小，z ${f(ml.z, 2)}）；胎的後緣 x 在 z .35／.40／.45＝${[.35, .40, .45].map(z => f(tf.c[0] - Math.sqrt((tf.d / 2) ** 2 - (z - tf.c[2]) ** 2))).join('／')}，車身前緣比胎面多留 ${f(tireClear * 1000, 1)} mm（>0＝沒穿進前胎）；胎頂 ${f(wheelTop)}、車身下段 z<.46 若要 ≥.28 前緣得穿進前胎 → 物理上做不到`);
  out(`前車身與前胎：三角形相交 ${meshIntersections({tris: bodyOnly.tris}, {tris: tf.vs.flat ? new Float32Array(tf.vs.flat()) : new Float32Array(0)})}（要 0）`);
  // 前叉：從網格找出 +y 那支叉管（金屬件裡 x∈[.40,.70]、y∈[.08,.13]、z∈[.15,.85] 的三角形），用兩端圓面中心當軸
  const mT = part(scooter, 'scooter-metal'), tv = []; for (const it of mT) for (let i = 0; i < it.tris.length; i += 9) { const P = [0, 3, 6].map(k => [it.tris[i + k], it.tris[i + k + 1], it.tris[i + k + 2]]); if (P.every(q => q[0] > .40 && q[0] < .70 && q[1] > .08 && q[1] < .13 && q[2] > .15 && q[2] < .85)) tv.push(...P); }
  // 用主成分（冪法）擬合管軸，兩端取沿軸投影的極值（不用端面邊緣最低點：那會偏離軸心一個管半徑）
  const ctr = pts => [0, 1, 2].map(k => pts.reduce((a, q) => a + q[k], 0) / pts.length), C = ctr(tv), cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of tv) { const w = [q[0] - C[0], q[1] - C[1], q[2] - C[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += w[a] * w[b]; }
  let u = [.3, 0, .9]; for (let it = 0; it < 60; it++) { const nu = [0, 1, 2].map(a => cov[a][0] * u[0] + cov[a][1] * u[1] + cov[a][2] * u[2]), l = Math.hypot(...nu); u = nu.map(x => x / l); }
  if (u[2] < 0) u = u.map(x => -x);
  const ss = tv.map(q => (q[0] - C[0]) * u[0] + (q[1] - C[1]) * u[1] + (q[2] - C[2]) * u[2]), s0 = Math.min(...ss), s1 = Math.max(...ss);
  const A = [0, 1, 2].map(k => C[k] + s0 * u[k]), B = [0, 1, 2].map(k => C[k] + s1 * u[k]), L = s1 - s0;
  const dev = Math.max(...tv.map(q => { const w = [q[0] - A[0], q[1] - A[1], q[2] - A[2]], s2 = w[0] * u[0] + w[1] * u[1] + w[2] * u[2]; return Math.hypot(w[0] - s2 * u[0], w[1] - s2 * u[1], w[2] - s2 * u[2]); }));
  out(`前車身 前叉管軸離輪心（xz 面）${f(Math.hypot(A[0] - tf.c[0], A[2] - tf.c[2]) * 1000, 1)} mm（管起點對車軸，要 ≈0）`);
  const hb = rayHits(bodyArr, A, u)[0], db = hb ? hb.t : Infinity;
  const hfd = rayHits(fenderArr, [tf.c[0], 0, tf.c[2]], nrm([u[0], 0, u[2]])), df = hfd.length ? hfd[hfd.length - 1].t : NaN;   // 從輪心沿叉軸方向，前土除外表面的距離＝土除上緣在叉管上的位置
  const exposed = Math.max(0, db - df);
  out(`前車身 前叉管（從網格找）：軸 (${A.map(x => f(x)).join(', ')}) → (${B.map(x => f(x)).join(', ')})，管長 ${f(L)}，頂點離軸最大 ${f(dev * 1000, 1)} mm（管半徑 17 mm）`);
  out(`前車身 前叉外露：從車軸沿叉管量，前土除上緣在 ${f(df)}、前車身底緣（叉軸進入車身）在 ${f(db)} → 前車身底緣到前土除上緣的外露長度 ${f(exposed)}（要求 ≤.20）→ ${exposed <= .20 ? '過' : '不過'}；叉管埋在前車身裡的長度 ${f(L - db)}；土除上緣到車軸（貼著輪側）${f(df)}`);
  const fb = meshIntersections({tris: fender.tris}, {tris: bodyOnly.tris}), ft = meshIntersections({tris: fender.tris}, {tris: new Float32Array(tf.vs.flat())});
  out(`前車身 前土除接在前車身下方：土除與前車身三角形相交 ${fb}（>0＝土除後段埋進車身下緣＝接上；0＝分開）→ ${fb > 0 ? '接上' : '沒接上'}；土除與前胎相交 ${ft}（要 0）`);
  { // 對照組：把前車身整個往後 12 cm，叉管就露出來（外露長度應該明顯變長），證明量法量得到
    const back = new Float32Array(bodyOnly.tris.map((x, i) => i % 3 === 0 ? x - .12 : x)), h2 = rayHits([{tris: back, name: 'b'}], A, u)[0], d2b = h2 ? h2.t : Infinity;
    out(`前車身 外露對照組（前車身往後移 12 cm）：外露長度 ${f(Math.max(0, Math.min(d2b, L) - df))}（管全長 ${f(L)}，應明顯大於上面的 ${f(exposed)}）→ ${Math.min(d2b, L) - df > exposed + .05 ? '量法有效' : '量法無效！'}`);
  }
}
// ================= M3 騎士 =================
const rv = verts(riderParts), helmetV = verts([helmet]);
const riderTop = bbox([...rv, ...helmetV]).mx[2];
out(`M3 騎士含安全帽頂離地 ${f(riderTop)}（範圍 1.55～1.80；涵洞淨高約 2.05 → 餘 ${f(2.05 - riderTop)}）→ ${riderTop >= 1.55 && riderTop <= 1.80 ? '過' : '不過'}`);
const seatObj = seatArr;
const gapOf = (v) => { const h = rayHits(seatObj, [v[0], v[1], v[2] + .3], [0, 0, -1]); return h.length ? v[2] - (v[2] + .3 - h[0].t) : null; };
const torsoV = verts(riderParts.filter(i => i.name.startsWith('torso'))), thighV = verts(riderParts.filter(i => i.name === 'leg:thigh'));
const gaps = (vs) => vs.map(gapOf).filter(g => g !== null);
const gt = gaps(torsoV), gh = gaps(thighV);
out(`M3 臀部：躯幹底面到座墊面的垂直距離最小 ${f(Math.min(...gt) * 100, 2)} cm（負＝陷進座墊；門檻 0～3）；大腿到座墊面最小 ${f(Math.min(...gh) * 100, 2)} cm → ${Math.min(...gt) >= -.001 && Math.min(...gt) <= .03 && Math.min(...gh) >= -.001 ? '過' : '不過'}`);
for (const c of [0, 1]) { const sh = riderParts.find(i => i.name === 'shoe' && i.copy === c), b = bbox(verts([sh])); out(`M3 ${c ? '右' : '左'}腳：鞋底 z ${f(b.mn[2])} 對踏板面 ${f(matTopZ)}，差 ${f((b.mn[2] - matTopZ) * 100, 2)} cm（門檻 ±3）→ ${Math.abs(b.mn[2] - matTopZ) <= .03 ? '過' : '不過'}`); }
for (const c of [0, 1]) {
  const hd = riderParts.find(i => i.name === 'hand' && i.copy === c), b = bbox(verts([hd])), ctr = [0, 1, 2].map(k => (b.mn[k] + b.mx[k]) / 2);
  const sgn = c ? -1 : 1, gc = gripAxis(sgn);
  const dd = Math.hypot(ctr[0] - gc[0], ctr[1] - gc[1], ctr[2] - gc[2]);
  out(`M3 ${c ? '右' : '左'}手：拳心 (${ctr.map(x => f(x)).join(', ')}) 對握把中心 (${gc.map(x => f(x)).join(', ')})，距離 ${f(dd * 100, 2)} cm（門檻 ≤5）→ ${dd <= .05 ? '過' : '不過'}`);
}
// 安全帽包住頭：頭上半部（本地 z≥.14）每個頂點朝本地 +z 打射線，打到帽殼恰好 2 次（進內面、出外面）＝在帽內；1 次＝穿出？0 次＝在帽外
const headP = kitPart(peopleKit, 'head'), helmP = kitPart(scooterKit, 'helmet');
function kitPart(k, n) { const g = k.parts.get(n).geometry, p = g.getAttribute('position'), a = []; for (let i = 0; i < p.count; i++) a.push([p.getX(i), p.getY(i), p.getZ(i)]); const T = new Float32Array(p.count * 3); a.forEach((v, i) => T.set(v, i * 3)); return {v: a, tris: T}; }
const upper = headP.v.filter(v => v[2] >= .14), counts = {};
for (const v of upper) { const n = rayHits([{tris: helmP.tris, name: 'helmet'}], v, nrm([1e-4, 2e-4, 1])).length; counts[n] = (counts[n] ?? 0) + 1; }
out(`M3 安全帽包頭：頭上半部 ${upper.length} 個頂點朝上打射線，命中帽殼次數分布 ${JSON.stringify(counts)}（全部要是 2 次）→ ${Object.keys(counts).length === 1 && counts[2] === upper.length ? '過' : '不過'}`);
{ // 對照：把帽子往下平移 6 cm，頭頂會穿出帽殼，必須量到不是全 2 次
  const dn = helmP.tris.map((x, i) => i % 3 === 2 ? x - .05 : x), c2 = {}; for (const v of upper) { const n = rayHits([{tris: dn, name: 'helmet'}], v, nrm([1e-4, 2e-4, 1])).length; c2[n] = (c2[n] ?? 0) + 1; }
  out(`M3 安全帽對照組（帽往下移 5 cm）：命中次數分布 ${JSON.stringify(c2)} → ${Object.keys(c2).length > 1 || !c2[2] ? '量法有效（穿出被量到）' : '量法無效！'}`);
}
// 騎士不穿進車殼：(1) 各部位有向包圍盒對車殼三角形 (2) 三角形對三角形（更嚴）
const shellArr = [...part(scooter, 'scooter-body'), ...part(scooter, 'scooter-fender')];
const contact = {seat: ['scooter-seat'], mat: ['scooter-mat'], grip: ['scooter-grip', 'scooter-metal']};
let obbTotal = 0, triTotal = 0; const detail = [];
for (const rp of riderParts.concat([{...helmet, name: 'helmet'}])) {
  const o = obbHits(rp, shell.tris), t = meshIntersections(rp, shell);
  obbTotal += o; triTotal += t; if (o || t) detail.push(`${rp.name}#${rp.copy}: 盒 ${o} 三角形 ${t}`);
}
out(`M3 騎士對車殼（scooter-body＋scooter-fender 全部 ${shell.tris.length / 9} 個三角形）：包圍盒相交 ${obbTotal}、三角形相交 ${triTotal}${detail.length ? '（' + detail.join('；') + '）' : ''} → ${obbTotal === 0 && triTotal === 0 ? '過' : '不過'}`);
const allScooterExceptContact = concat(scooter.filter(i => !['scooter-seat', 'scooter-mat', 'scooter-grip', 'scooter-metal', 'scooter-body', 'scooter-fender'].includes(i.name)));
let t2 = 0; const d2 = []; for (const rp of riderParts.concat([{...helmet, name: 'helmet'}])) { const t = meshIntersections(rp, allScooterExceptContact); t2 += t; if (t) d2.push(`${rp.name}#${rp.copy}: ${t}`); }
out(`M3 騎士對「車殼以外的其他機車零件（不含座墊、踏墊、握把、手把金屬件＝本來就接觸的；車殼已在上一行）」三角形相交 ${t2}${d2.length ? '（' + d2.join('；') + '）' : ''} → ${t2 === 0 ? '過' : '有相交'}`);
{ // 正向對照：整個騎士往前推 12 cm（膝蓋撞前擋板）
  const moved = riderParts.map(rp => shift(rp, [.12, 0, 0])); let o = 0, t = 0; for (let k = 0; k < moved.length; k++) { o += obbHits(riderParts[k], shell.tris, [.12, 0, 0]); t += meshIntersections(moved[k], shell); }
  out(`M3 穿模對照組（騎士整個往前 12 cm）：包圍盒相交 ${o}、三角形相交 ${t} → ${o > 0 && t > 0 ? '量法有效（故意穿入量得到）' : '量法無效！'}`);
}
// ================= M4 面數與 draw call =================
const asset = n => scooterKit.parts.get(n).count / 3, sum = (ns) => ns.reduce((a, n) => a + asset(n), 0);
const wnames = [...scooterKit.parts.keys()].filter(n => n.startsWith('wheel-')), snames = [...scooterKit.parts.keys()].filter(n => n !== 'helmet');
const scooterTris = sum(snames) + sum(wnames);   // 輪子兩個實例：再加一份
out(`M4 機車三角形：資產內 ${sum(snames)}（輪子一份）；實際繪製（輪子兩個實例）${scooterTris}（門檻 ≤3000）→ ${scooterTris <= 3000 ? '過' : '不過'}`);
out(`M4 安全帽三角形 ${asset('helmet')}（門檻 ≤600）→ ${asset('helmet') <= 600 ? '過' : '不過'}`);
out(`M4 draw call（機車＋騎士＋安全帽）：${rider.state.drawCalls}（靜態烤成一個網格 1、輪子 InstancedMesh 1、前燈 1、尾燈 1；門檻 ≤6，瀏覽器內用 renderer.info 再量一次）；整組實際三角形 ${rider.state.triangles}`);
out(`M1 整體：${allM1 ? '全部落在範圍內' : '有項目不在範圍內'}`);
const dest = process.argv[2];
if (dest) fs.writeFileSync(dest, lines.join('\n') + '\n');
