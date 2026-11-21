// 地景圖磚道路網格。世界座標以公尺計，頂點使用 x＝東、y＝上、z＝負北。
import { edgeKeep, keepSpans } from './engine/shared/deck-lines.mjs';
import { surfaceMarkings } from './surface-markings.mjs';
import { TW2 } from './engine/shared/tw2.mjs';
import { roadMarks } from './engine/shared/road-marks.mjs';

const i8 = v => Math.max(-127, Math.min(127, Math.round(v * 127)));

function bisector(ax, ay, bx, by) {
  const len = Math.hypot(ax + bx, ay + by);
  if (len < 1e-6) return [-by, bx];
  // 兩段等權的角平分線。急彎限制斜接長度，避免很短的轉折在路緣伸出尖角。
  const scale = Math.min(1.5, 2 / len) / len;
  return [-(ay + by) * scale, (ax + bx) * scale];
}

const endpointKey = p => p[0] + ',' + p[1] + ',' + Math.round((p[2] || 0) * 10);

// 等寬道路在彎中被資料切成兩筆時，兩邊共用同一個斷面；三岔以上各依自己的方向匯入。
function joinedEnds(roads) {
  const ends = new Map(), frames = new Map();
  for (const r of roads) {
    for (const step of [1, -1]) {
      const i = step === 1 ? 0 : r.pts.length - 1, p = r.pts[i];
      if (!p) continue;
      let j = i + step;
      while (r.pts[j] && p[0] === r.pts[j][0] && p[1] === r.pts[j][1]) j += step;
      if (!r.pts[j]) continue;
      const key = endpointKey(p), x = r.pts[j][0] - p[0], y = r.pts[j][1] - p[1], len = Math.hypot(x, y);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ x: x / len, y: y / len, w: p[3] || r.w });
    }
  }
  for (const [key, arms] of ends) {
    if (arms.length !== 2) continue;
    const [a, b] = arms;
    if (a.w === b.w && a.x*b.x + a.y*b.y < 0.5) frames.set(key, bisector(-a.x, -a.y, b.x, b.y));
  }
  for (const r of roads) for (let i = 1; i < r.pts.length - 1; i++) frames.delete(endpointKey(r.pts[i]));
  return frames;
}

function roadFrame(points, i, ends) {
  const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
  const inX = p[0] - a[0], inY = p[1] - a[1], outX = b[0] - p[0], outY = b[1] - p[1];
  const inLen = Math.hypot(inX, inY), outLen = Math.hypot(outX, outY);
  if (inLen && outLen) return bisector(inX / inLen, inY / inLen, outX / outLen, outY / outLen);
  const len = inLen || outLen, nx = -(inY + outY) / len, ny = (inX + outX) / len;
  const shared = ends.get(endpointKey(p));
  if (!shared) return [nx, ny];
  return nx*shared[0] + ny*shared[1] < 0 ? [-shared[0], -shared[1]] : shared;
}

// bl、bNearOf：tw2 人行道看路邊有沒有房子（T7 tile.worker.js 的 bNearOf，由 worker 傳進來）
export function roadRibbons(roads, groundAt, lines = 1, farStep = 0, piers = [], deck = 1, pier = 1, sides = 1, flat = 0, covers = roads, bl = null, bNearOf = null) {
  const pos = [], nor = [], col = [], idx = [], fidx = [];
  const ends = joinedEnds(roads);
  let n = 0;
  const normalAt = (x, y, d = 6) => {
    const hx = (groundAt(x + d, y) - groundAt(x - d, y)) / (2 * d), hy = (groundAt(x, y + d) - groundAt(x, y - d)) / (2 * d), l = Math.hypot(hx, hy, 1);
    return [-hx / l, 1 / l, hy / l];
  };
  const add = (pts, width, lift, color, offset = 0, surf = false, side = false, edge = 0, cut = null, wtr = 0) => {
    const P = [], keep = [], distance = [], wAt = (a, b, f) => a[3] > 0 ? a[3] + ((b[3] > 0 ? b[3] : a[3]) - a[3]) * f : 0;
    if (pts.length < 2) return;
    let along = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const m = Math.ceil(length / 10);
      for (let k = 0; k < m; k++) {
        distance.push(along + length * k / m);
        keep.push(k === 0);
        P.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m, deck ? (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * k / m : 0, deck ? wAt(a, b, k / m) : 0]);
      }
      along += length;
    }
    if (!along) return;
    distance.push(along);
    P.push([pts.at(-1)[0], pts.at(-1)[1], deck ? pts.at(-1)[2] || 0 : 0, deck ? wAt(pts.at(-1), pts.at(-1), 0) : 0]);
    keep.push(true);
    const c = color.map((v) => Math.round(v * 255)), vi = [];
    for (let i = 0; i < P.length; i++) {
      const [nx, ny] = roadFrame(P, i, ends), q = normalAt(P[i][0], P[i][1]);
      vi.push(n);
      const wd = surf && P[i][3] > 0 ? P[i][3] : width, of = edge && P[i][3] > 0 ? edge * (P[i][3] / 2 - 0.35) : offset;
      const up = P[i][2] > 0.3, floor = up ? groundAt(P[i][0], P[i][1]) : 0;
      // 橋面離地後依中心高程保持水平，落地前的兩公尺平順接回兩側地面。
      const blend = Math.min(1, Math.max(0, (P[i][2] - 0.3) / 2));
      for (const s of [1, -1]) {
        const x = P[i][0] + nx * (of + s * wd / 2), y = P[i][1] + ny * (of + s * wd / 2);
        const base = blend === 1 ? floor : (1 - blend) * groundAt(x, y) + blend * floor;
        pos.push(x, base + lift + P[i][2], -y);
        nor.push(up ? 0 : i8(q[0]), up ? 127 : i8(q[1]), up ? 0 : i8(q[2]), 0);
        col.push(c[0], c[1], c[2], 255);
      }
      n += 2;
      if (i > 0) {
        const prev = vi[i - 1], curr = vi[i];
        // 白邊先沿完整橋面建，再按與護欄相同的里程裁切，切點沿用橋面的轉向和寬度。
        if (!edge || !cut) {
          idx.push(prev, prev + 1, curr + 1, prev, curr + 1, curr);
        } else for (const [lo, hi] of keepSpans(cut, distance[i - 1], distance[i])) {
          const cutAt = f => {
            if (f === 0) return prev;
            if (f === 1) return curr;
            const start = n;
            for (let j = 0; j < 2; j++) {
              const a = prev + j, b = curr + j;
              for (let k = 0; k < 3; k++) pos.push(pos[3*a+k] + f * (pos[3*b+k] - pos[3*a+k]));
              for (let k = 0; k < 4; k++) nor.push(Math.round(nor[4*a+k] + f * (nor[4*b+k] - nor[4*a+k])));
              col.push(...c, 255);
            }
            n += 2; return start;
          };
          const a = cutAt(lo), b = cutAt(hi);
          idx.push(a, a + 1, b + 1, a, b + 1, b);
        }
      }
      if (side && i > 0 && (P[i][2] > 0.3 || P[i - 1][2] > 0.3)) for (const s of [1, -1]) {
        const rim = s === 1 ? 0 : 1;
        const A = [vi[i - 1] + rim, vi[i] + rim].map(v => [pos[3*v], -pos[3*v+2], pos[3*v+1]]);
        const at = (f) => [A[0][0] + (A[1][0] - A[0][0]) * f, A[0][1] + (A[1][1] - A[0][1]) * f, A[0][2] + (A[1][2] - A[0][2]) * f];
        // tw2 brg（T7 f222a01）：側板分成護欄（淺）與梁身（深）兩段，梁身往內縮 0.25 m；
        // tw2 rbrg（T7 4d2b666）：跨水的橋（wtr）護欄更淺、梁身薄一點（1.1 m）顏色比高架淺，brg 關著也照畫
        const inner = (TW2.brg || wtr) && [roadFrame(P, i - 1, ends), [nx, ny]].map(([fx, fy], j) => [A[j][0] - fx * s * 0.25, A[j][1] - fy * s * 0.25, A[j][2]]);
        for (const [f0, f1] of keepSpans(cut && cut[s], distance[i - 1], distance[i])) {
          if (inner) {
            const lerp = (Q, f) => f === 0 ? Q[0] : f === 1 ? Q[1] : [0, 1, 2].map(k => Q[0][k] + (Q[1][k] - Q[0][k]) * f);
            for (const [Q, za, zb, cc] of wtr ? [[A, 0.9, 0, [192, 194, 192]], [inner, 0, -1.1, [104, 104, 100]]] : [[A, 0.9, 0, [178, 176, 170]], [inner, 0, -1.4, [74, 74, 72]]]) {
              const m = n;
              for (const [x, y, top] of [lerp(Q, f0), lerp(Q, f1)]) {
                pos.push(x, top + za, -y, x, top + zb, -y);
                for (let k = 0; k < 2; k++) { nor.push(i8(nx * s), 0, i8(-ny * s), 0); col.push(cc[0], cc[1], cc[2], 255); }
              }
              idx.push(m, m + 1, m + 3, m, m + 3, m + 2, m, m + 3, m + 1, m, m + 2, m + 3);
              n += 4;
            }
            continue;
          }
          const m = n;
          for (const [x, y, top] of [f0 === 0 ? A[0] : at(f0), f1 === 1 ? A[1] : at(f1)]) {
            pos.push(x, top + 0.9, -y, x, top - 1.4, -y);
            for (let k = 0; k < 2; k++) {
              nor.push(i8(nx * s), 0, i8(-ny * s), 0);
              col.push(150, 148, 142, 255);
            }
          }
          idx.push(m, m + 1, m + 3, m, m + 3, m + 2, m, m + 3, m + 1, m, m + 2, m + 3);
          n += 4;
        }
      }
    }
    if (surf && farStep > 0) {
      let prev = 0;
      for (let i = 1; i < P.length; i++) if (keep[i] || i - prev >= farStep) {
        const A = vi[prev], B = vi[i];
        fidx.push(A, A + 1, B + 1, A, B + 1, B);
        prev = i;
      }
    }
  };
  // tw2 標線帶子（T7 f222a01 roadRibbons 的 addMk，照搬）：取樣跟著地形；period＞0 的虛線、枕木紋頂點帶 aMk＝[距離÷period, duty]，著色器切
  let mkv = null; const addMk = ({ pts, w, rgb, period, duty }) => { const P = [pts[0]];
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), mx = Math.max(1, Math.ceil(L / 10)); let m = 1;
      const bad = m => { for (let k = 0; k < m; k++) { const f0 = k / m, f1 = (k + 1) / m, x0 = a[0] + (b[0] - a[0]) * f0, y0 = a[1] + (b[1] - a[1]) * f0, x1 = a[0] + (b[0] - a[0]) * f1, y1 = a[1] + (b[1] - a[1]) * f1, g0 = groundAt(x0, y0), g1 = groundAt(x1, y1), q = Math.max(1, Math.ceil(L / m / 5));
        for (let t = 1; t < q; t++) if (Math.abs(groundAt(x0 + (x1 - x0) * t / q, y0 + (y1 - y0) * t / q) - (g0 + (g1 - g0) * t / q)) > .12) return true; } return false; };
      while (m < mx && bad(m)) m = Math.min(mx, m * 2);
      for (let k = 1; k <= m; k++) P.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]); }
    const c = rgb.map(v => Math.round(v * 255)); let d = 0, pv = -1;
    for (let i = 0; i < P.length; i++) { if (i) d += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); const A = P[Math.max(0, i - 1)], B = P[Math.min(P.length - 1, i + 1)]; let dx = B[0] - A[0], dy = B[1] - A[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const q = normalAt(P[i][0], P[i][1]);
      for (const s of [1, -1]) { const x = P[i][0] - dy * s * w / 2, y = P[i][1] + dx * s * w / 2; pos.push(x, groundAt(x, y) + .3, -y); nor.push(i8(q[0]), i8(q[1]), i8(q[2]), 0); col.push(c[0], c[1], c[2], 255); if (period > 0) mkv.push(n + (s > 0 ? 0 : 1), d / period, duty); }
      if (pv >= 0) idx.push(pv, pv + 1, n + 1, pv, n + 1, n); pv = n; n += 2; } };
  const rank = { footway: 0, path: 0, steps: 0, cycleway: 0, track: 1, service: 2, pedestrian: 2, unknown: 2, living_street: 3, residential: 3, unclassified: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 7 }, R = (c) => rank[c] ?? 2;
  const tone = (c) => R(c) === 0 ? [0.24, 0.23, 0.21] : R(c) === 1 ? [0.27, 0.24, 0.19] : R(c) <= 2 ? [0.13, 0.13, 0.13] : [0.085, 0.087, 0.092];
  const PED = /^(footway|steps|cycleway|path|pedestrian|bridleway)$/;
  if (flat) {
    const toneF = c => R(c) <= 1 ? [0.24, 0.23, 0.21] : flat === 3 && R(c) === 2 ? [0.14, 0.14, 0.14] : [0.095, 0.096, 0.1];
    // 車道、產業道路與巷弄照圖資寬度畫；模式 1 另含步道與階梯。
    const sorted = roads.filter(r => flat === 1 || (flat === 3 ? R(r.cls) >= 1 : R(r.cls) >= 2 && r.cls !== 'service'))
      .sort((a, b) => R(a.cls) - R(b.cls));
    // tw2 道路線（黃線修正、車道線、路口標線、人行道；規則在 engine/shared/road-marks.mjs）
    const MKS = (flat === 1 || flat === 3) && lines && (TW2.yline || TW2.lane || TW2.xing || TW2.walk) ? roadMarks(roads, TW2, TW2.num, bl && bNearOf && TW2.walk ? bNearOf(bl) : null) : null;
    if (MKS) { mkv = []; for (const m of MKS.under) addMk(m); }   // 人行道帶子先畫（路面蓋在上面）
    for (const r of sorted) add(r.pts, r.w, 0.3, toneF(r.cls), 0, true, false);
    // 黃線只留一套：tw2 yline 開著用 road-marks（跟停止線、斑馬線同一套路口退讓）；tw2=-yline 才回到網站原本沿圖資收線的 surfaceMarkings
    if (TW2.yline) {
      // 黃線在 MKS.over 裡
    } else if (lines && flat === 3) {
      for (const pts of surfaceMarkings(sorted, R, covers)) add(pts, 0.22, 0.3, [0.58, 0.46, 0.17]);
    } else if (lines && flat === 1) {
      for (const r of sorted) if (R(r.cls) >= 4 && r.w >= 8) add(r.pts, 0.3, 0.3, [0.78, 0.58, 0.08]);
    }
    if (MKS) for (const m of MKS.over) addMk(m);
  } else {
    for (const r of [...roads].sort((a, b) => R(a.cls) - R(b.cls))) {
      const k = R(r.cls);
      add(r.pts, r.w, 0.1 + k * 0.012, tone(r.cls), 0, true, !!sides && !PED.test(r.cls), 0, r.edgeSkip ? { 1: edgeKeep(r, 1), "-1": edgeKeep(r, -1) } : null, TW2.rbrg && r.tw2w ? 1 : 0);
      if (k >= 5 && lines) {
        for (const o of [-1, 1]) add(r.pts, 0.16, 0.24, [0.80, 0.80, 0.78], o * (r.w / 2 - 0.35), false, false, o, edgeKeep(r, o));
      }
    }
    if (lines) for (const pts of surfaceMarkings(roads, R, covers)) add(pts, 0.22, 0.24, [0.58, 0.46, 0.17]);
  }
  // tw2 brg（T7 f222a01，照搬）：橋墩改 T 型墩——中間一根柱＋往兩邊挑出、底面斜收的帽梁。太矮（橋面離地 < 4.5 m）的與橋台照舊。
  const tPier = (cx, cy, ux, uy, hw, h) => { const g = groundAt(cx, cy), top = g + .1 + h - 1.4, cw = Math.max(.9, hw * .62), tw = hw / .35 * .55, ua = .9, uc = 1.15, zc = top - 1.5, zt = top - .55, Pt = (u, v, z) => [cx + ux * u - uy * v, cy + uy * u + ux * v, z];
    const face = (P, nrm, cc) => { const a = P[0], b = P[1], c = P[2], gx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), gy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), gz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (gx * nrm[0] + gy * nrm[1] + gz * nrm[2] < 0) P = [...P].reverse();
      const m = n; for (const q of P) { pos.push(q[0], q[2], -q[1]); nor.push(i8(nrm[0]), i8(nrm[2]), i8(-nrm[1]), 0); col.push(cc[0], cc[1], cc[2], 255); } for (let k = 1; k < P.length - 1; k++) idx.push(m, m + k, m + k + 1); n += P.length; };
    const C1 = [140, 138, 132], C2 = [152, 150, 144], C3 = [118, 117, 112];
    for (const sg of [-1, 1]) { face([Pt(sg * ua, -cw, g - .5), Pt(sg * ua, cw, g - .5), Pt(sg * ua, cw, zc), Pt(sg * ua, -cw, zc)], [ux * sg, uy * sg, 0], C1); face([Pt(-ua, sg * cw, g - .5), Pt(ua, sg * cw, g - .5), Pt(ua, sg * cw, zc), Pt(-ua, sg * cw, zc)], [-uy * sg, ux * sg, 0], C1);
      face([Pt(sg * uc, -tw, top), Pt(sg * uc, tw, top), Pt(sg * uc, tw, zt), Pt(sg * uc, cw, zc), Pt(sg * uc, -cw, zc), Pt(sg * uc, -tw, zt)], [ux * sg, uy * sg, 0], C2);
      face([Pt(-uc, sg * tw, zt), Pt(uc, sg * tw, zt), Pt(uc, sg * tw, top), Pt(-uc, sg * tw, top)], [-uy * sg, ux * sg, 0], C2);
      face([Pt(-uc, sg * cw, zc), Pt(uc, sg * cw, zc), Pt(uc, sg * tw, zt), Pt(-uc, sg * tw, zt)], [-uy * sg * .5, ux * sg * .5, -.86], C3); }
    face([Pt(-uc, -tw, top), Pt(uc, -tw, top), Pt(uc, tw, top), Pt(-uc, tw, top)], [0, 0, 1], C2); };
  // tw2 rbrg（T7 4d2b666，照搬）：站在水裡的橋墩——圓柱（橋寬 ≥ 12 m 兩根、窄的一根，六角）＋帽梁＋露出水面的承台。墩頂在梁底（橋面下 1.1 m）。
  const wPier = (cx, cy, ux, uy, hw, h) => { const g = groundAt(cx, cy), top = g + .1 + h - 1.1, W = hw / .35, two = W >= 6, rr = two ? Math.min(1.25, Math.max(.8, W * .12)) : Math.min(1.5, Math.max(.75, W * .3)), vs = two ? [-W * .5, W * .5] : [0], zc = top - 1.25, capH = two ? W * .5 + rr + .5 : Math.max(rr + .3, W * .6), fh = (two ? W * .5 : 0) + rr + 1.1, Pt = (u, v, z) => [cx + ux * u - uy * v, cy + uy * u + ux * v, z];
    const quad = (A, B, C, D, nrm, cc) => { let P = [A, B, C, D]; const gx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), gy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), gz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]); if (gx * nrm[0] + gy * nrm[1] + gz * nrm[2] < 0) P = [D, C, B, A];
      const m = n; for (const q of P) { pos.push(q[0], q[2], -q[1]); nor.push(i8(nrm[0]), i8(nrm[2]), i8(-nrm[1]), 0); col.push(cc[0], cc[1], cc[2], 255); } idx.push(m, m + 1, m + 2, m, m + 2, m + 3); n += 4; };
    const boxAt = (hu, hv, z0, z1, cc, lid) => { for (const sg of [-1, 1]) { quad(Pt(sg * hu, -hv, z0), Pt(sg * hu, hv, z0), Pt(sg * hu, hv, z1), Pt(sg * hu, -hv, z1), [ux * sg, uy * sg, 0], cc); quad(Pt(-hu, sg * hv, z0), Pt(hu, sg * hv, z0), Pt(hu, sg * hv, z1), Pt(-hu, sg * hv, z1), [-uy * sg, ux * sg, 0], cc); } if (lid) quad(Pt(-hu, -hv, z1), Pt(hu, -hv, z1), Pt(hu, hv, z1), Pt(-hu, hv, z1), [0, 0, 1], cc.map(v => Math.min(255, v + 14))); };
    boxAt(rr + 1.1, fh, g - .5, g + .7, [112, 112, 106], 1);
    for (const v of vs) for (let k = 0; k < 6; k++) { const a0 = k * 1.0472, a1 = (k + 1) * 1.0472, am = (a0 + a1) / 2, c0 = Math.cos(a0) * rr, s0 = Math.sin(a0) * rr, c1 = Math.cos(a1) * rr, s1 = Math.sin(a1) * rr; quad(Pt(c0, v + s0, g + .7), Pt(c1, v + s1, g + .7), Pt(c1, v + s1, zc), Pt(c0, v + s0, zc), [ux * Math.cos(am) - uy * Math.sin(am), uy * Math.cos(am) + ux * Math.sin(am), 0], [158, 156, 150]); }
    boxAt(rr + .15, capH, zc, top, [150, 148, 142], 0); };
  if (deck && pier) for (const pq of piers) {
    const [cx, cy, ux, uy, hw, h] = pq;
    if (TW2.rbrg && pq[6] && hw <= 3 && h >= 2.2) { wPier(cx, cy, ux, uy, hw, h); continue; }
    if (TW2.brg && hw >= 1.2 && hw <= 3 && h >= 4.5) { tPier(cx, cy, ux, uy, hw, h); continue; }
    const g = groundAt(cx, cy), top = g + 0.1 + h - 1.4, C = [[-1, -hw], [1, -hw], [1, hw], [-1, hw]].map(([u, v]) => [cx + ux * u - uy * v, cy + uy * u + ux * v]);
    for (let k = 0; k < 4; k++) {
      const A = C[k], Bq = C[(k + 1) % 4], ex = Bq[0] - A[0], ey = Bq[1] - A[1], el = Math.hypot(ex, ey) || 1, fx = ey / el, fy = -ex / el, m = n;
      for (const [x, y] of [A, Bq]) {
        pos.push(x, g - 0.5, -y, x, top, -y);
        for (let j = 0; j < 2; j++) {
          nor.push(i8(fx), 0, i8(-fy), 0);
          col.push(140, 138, 132, 255);
        }
      }
      idx.push(m, m + 2, m + 3, m, m + 3, m + 1);
      n += 4;
    }
  }
  const nMain = idx.length, nFar = fidx.length;
  for (const v of fidx) idx.push(v);
  let mk; if (mkv) { mk = new Float32Array(n * 2); for (let k = 0; k < mkv.length; k += 3) { mk[mkv[k] * 2] = mkv[k + 1]; mk[mkv[k] * 2 + 1] = mkv[k + 2]; } }   // tw2 虛線、枕木紋的沿線座標
  return { pos: new Float32Array(pos), nor: new Int8Array(nor), col: new Uint8Array(col), idx: n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), n, nMain, nFar, ...(mk ? { mk } : {}) };
}
