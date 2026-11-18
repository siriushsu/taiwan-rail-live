// 地景圖磚道路網格。世界座標以公尺計，頂點使用 x＝東、y＝上、z＝負北。
import { edgeKeep, keepSpans } from './engine/shared/deck-lines.mjs';
import { surfaceMarkings } from './surface-markings.mjs';

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

export function roadRibbons(roads, groundAt, lines = 1, farStep = 0, piers = [], deck = 1, pier = 1, sides = 1, flat = 0, covers = roads) {
  const pos = [], nor = [], col = [], idx = [], fidx = [];
  const ends = joinedEnds(roads);
  let n = 0;
  const normalAt = (x, y, d = 6) => {
    const hx = (groundAt(x + d, y) - groundAt(x - d, y)) / (2 * d), hy = (groundAt(x, y + d) - groundAt(x, y - d)) / (2 * d), l = Math.hypot(hx, hy, 1);
    return [-hx / l, 1 / l, hy / l];
  };
  const add = (pts, width, lift, color, offset = 0, surf = false, side = false, edge = 0, cut = null) => {
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
        for (const [f0, f1] of keepSpans(cut && cut[s], distance[i - 1], distance[i])) {
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
  const rank = { footway: 0, path: 0, steps: 0, cycleway: 0, track: 1, service: 2, pedestrian: 2, unknown: 2, living_street: 3, residential: 3, unclassified: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 7 }, R = (c) => rank[c] ?? 2;
  const tone = (c) => R(c) === 0 ? [0.24, 0.23, 0.21] : R(c) === 1 ? [0.27, 0.24, 0.19] : R(c) <= 2 ? [0.13, 0.13, 0.13] : [0.085, 0.087, 0.092];
  const PED = /^(footway|steps|cycleway|path|pedestrian|bridleway)$/;
  if (flat) {
    const toneF = c => R(c) <= 1 ? [0.24, 0.23, 0.21] : flat === 3 && R(c) === 2 ? [0.14, 0.14, 0.14] : [0.095, 0.096, 0.1];
    // 車道、產業道路與巷弄照圖資寬度畫；模式 1 另含步道與階梯。
    const sorted = roads.filter(r => flat === 1 || (flat === 3 ? R(r.cls) >= 1 : R(r.cls) >= 2 && r.cls !== 'service'))
      .sort((a, b) => R(a.cls) - R(b.cls));
    for (const r of sorted) add(r.pts, r.w, 0.3, toneF(r.cls), 0, true, false);
    if (lines && flat === 3) {
      for (const pts of surfaceMarkings(sorted, R, covers)) add(pts, 0.22, 0.3, [0.58, 0.46, 0.17]);
    } else if (lines && flat === 1) {
      for (const r of sorted) if (R(r.cls) >= 4 && r.w >= 8) add(r.pts, 0.3, 0.3, [0.78, 0.58, 0.08]);
    }
  } else {
    for (const r of [...roads].sort((a, b) => R(a.cls) - R(b.cls))) {
      const k = R(r.cls);
      add(r.pts, r.w, 0.1 + k * 0.012, tone(r.cls), 0, true, !!sides && !PED.test(r.cls), 0, r.edgeSkip ? { 1: edgeKeep(r, 1), "-1": edgeKeep(r, -1) } : null);
      if (k >= 5 && lines) {
        for (const o of [-1, 1]) add(r.pts, 0.16, 0.24, [0.80, 0.80, 0.78], o * (r.w / 2 - 0.35), false, false, o, edgeKeep(r, o));
      }
    }
    if (lines) for (const pts of surfaceMarkings(roads, R, covers)) add(pts, 0.22, 0.24, [0.58, 0.46, 0.17]);
  }
  if (deck && pier) for (const [cx, cy, ux, uy, hw, h] of piers) {
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
  return { pos: new Float32Array(pos), nor: new Int8Array(nor), col: new Uint8Array(col), idx: n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), n, nMain, nFar };
}
