export const RANK = { footway: 0, path: 0, steps: 0, cycleway: 0, track: 1, service: 2, pedestrian: 2, unknown: 2, living_street: 3, residential: 3, unclassified: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 7 };
export const rankOf = (c) => RANK[c] ?? 2;
const VEH = (r) => rankOf(r.cls) >= 3;
const BORDER = (p, M = 1280) => p[0] < 0.5 || p[1] < 0.5 || p[0] > M - 0.5 || p[1] > M - 0.5;
const len = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
};
const keyOf = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
const h01 = (x, y, k = 0) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
export function along(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= L || i === pts.length - 1) {
      const f = L ? Math.max(0, Math.min(1, s / L)) : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, (b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)];
    }
    s -= L;
  }
  const p = pts[0];
  return [p[0], p[1], 1, 0];
}
export function slice(pts, s0, s1, off = 0) {
  const out = [], P = (x, y, tx, ty) => out.push([x - ty * off, y + tx * off]);
  let acc = 0;
  if (s1 - s0 < 0.05) return out;
  const a0 = along(pts, s0);
  P(a0[0], a0[1], a0[2], a0[3]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc <= s0 + 0.05 || acc >= s1 - 0.05) continue;
    let tx = (b[0] - a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) + (c[0] - b[0]) / (Math.hypot(c[0] - b[0], c[1] - b[1]) || 1), ty = (b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) + (c[1] - b[1]) / (Math.hypot(c[0] - b[0], c[1] - b[1]) || 1);
    const l = Math.hypot(tx, ty) || 1;
    P(b[0], b[1], tx / l, ty / l);
  }
  const a1 = along(pts, s1);
  P(a1[0], a1[1], a1[2], a1[3]);
  return out;
}
const dirFrom = (pts, fromEnd) => {
  const P = fromEnd ? [...pts].reverse() : pts, a = along(P, Math.min(10, len(P))), dx = a[0] - P[0][0], dy = a[1] - P[0][1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};
export function pairedRoads(roads) {
  const segs = [];
  roads.forEach((r, i) => {
    if (rankOf(r.cls) >= 4) for (let k = 0; k < r.pts.length - 1; k++) segs.push([i, r.pts[k], r.pts[k + 1]]);
  });
  const out = /* @__PURE__ */ new Map();
  roads.forEach((r, i) => {
    if (rankOf(r.cls) < 4) return;
    let n = 0, hit = 0, side = 0;
    const L = len(r.pts);
    for (let s = 2; s < L - 1; s += 10) {
      const [x, y, tx, ty] = along(r.pts, s);
      n++;
      let best = 0;
      for (const [o, p, q] of segs) {
        if (o === i) continue;
        const sx = q[0] - p[0], sy = q[1] - p[1], sl = Math.hypot(sx, sy) || 1;
        if (Math.abs((sx * tx + sy * ty) / sl) < 0.94) continue;
        const u = ((x - p[0]) * sx + (y - p[1]) * sy) / (sl * sl);
        if (u < -0.05 || u > 1.05) continue;
        const lat = -(x - p[0] - sx * u) * ty + (y - p[1] - sy * u) * tx;
        if (Math.abs(lat) >= 4 && Math.abs(lat) <= 30 && (!best || Math.abs(lat) < Math.abs(best))) best = lat;
      }
      if (best) {
        hit++;
        side += best > 0 ? -1 : 1;
      }
    }
    if (n && hit / n >= 0.6) out.set(i, side >= 0 ? 1 : -1);
  });
  return out;
}
function curvy(pts, R = 80) {
  let sum = 0, abs = 0;
  const L = len(pts);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sum += d;
    abs += Math.abs(d);
  }
  return Math.abs(sum) >= 0.35 && abs <= Math.abs(sum) * 1.3 + 0.05 && L / Math.abs(sum) < R;
}
export function findJunctions(roads, opt = {}) {
  const M = opt.tile || 1280, nodes = /* @__PURE__ */ new Map();
  roads.forEach((r, i) => {
    if (!VEH(r) || r.pts.length < 2) return;
    for (const end of [0, 1]) {
      const p = end ? r.pts.at(-1) : r.pts[0];
      if (BORDER(p, M)) continue;
      const k = keyOf(p);
      if (!nodes.has(k)) nodes.set(k, { x: p[0], y: p[1], arms: [] });
      nodes.get(k).arms.push({ road: i, end, dir: dirFrom(r.pts, end), w: r.w, cls: r.cls, rank: rankOf(r.cls) });
    }
  });
  const junctions = [...nodes.values()].filter((n) => n.arms.length >= 3), jOf = /* @__PURE__ */ new Map(), ends = /* @__PURE__ */ new Map();
  junctions.forEach((j, k) => {
    j.major = j.arms.filter((a) => a.rank >= 4).length >= 3;
    jOf.set(keyOf([j.x, j.y]), k);
    for (const a of j.arms) {
      if (!ends.has(a.road)) ends.set(a.road, [-1, -1]);
      ends.get(a.road)[a.end] = k;
    }
  });
  const par = junctions.map((_, k) => k), find = (k) => par[k] === k ? k : par[k] = find(par[k]), internal = /* @__PURE__ */ new Set();
  for (const [i, [a, b]] of ends) if (a >= 0 && b >= 0 && a !== b && junctions[a].major && junctions[b].major && len(roads[i].pts) <= 32) {
    par[find(a)] = find(b);
    internal.add(i);
  }
  for (const [i, [a, b]] of ends) if (a >= 0 && b >= 0 && find(a) === find(b)) internal.add(i);
  const connector = /* @__PURE__ */ new Set();
  roads.forEach((r, i) => {
    if (!VEH(r)) return;
    const e = ends.get(i), L = len(r.pts);
    if (r.pts.length > 2 && keyOf(r.pts[0]) === keyOf(r.pts.at(-1))) connector.add(i);
    else if (e && e[0] >= 0 && e[1] >= 0 && (L < 20 || L <= 150 && curvy(r.pts))) connector.add(i);
  });
  const circ = [];
  for (const i of connector) {
    const r = roads[i], L = len(r.pts);
    if (L < 15) continue;
    const A = r.pts[0], B = along(r.pts, L / 2), C = r.pts.at(-1), d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    if (Math.abs(d) < 1e-6) continue;
    const a2 = A[0] ** 2 + A[1] ** 2, b2 = B[0] ** 2 + B[1] ** 2, c2 = C[0] ** 2 + C[1] ** 2, ux = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d, uy = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d, rr = Math.hypot(A[0] - ux, A[1] - uy);
    if (rr < 8 || rr > 90) continue;
    circ.push([ux, uy, rr]);
  }
  const rings = [];
  for (const c of circ) {
    let g = rings.find((g2) => Math.hypot(g2.x - c[0], g2.y - c[1]) < 15);
    if (!g) rings.push(g = { x: c[0], y: c[1], n: 0, r0: 1e9, r1: 0 });
    g.n++;
    g.r0 = Math.min(g.r0, c[2]);
    g.r1 = Math.max(g.r1, c[2]);
  }
  const ringRoad = /* @__PURE__ */ new Set();
  for (const g of rings) if (g.n >= 3) roads.forEach((r, i) => {
    if (!VEH(r)) return;
    const L = len(r.pts), m = along(r.pts, L / 2), inR = (p) => {
      const d = Math.hypot(p[0] - g.x, p[1] - g.y);
      return d > g.r0 - 6 && d < g.r1 + 6;
    };
    if (L <= 150 && inR(r.pts[0]) && inR(r.pts.at(-1)) && inR(m)) {
      connector.add(i);
      ringRoad.add(i);
    } else if (!connector.has(i) && L <= 250 && Math.hypot(m[0] - g.x, m[1] - g.y) < g.r1 + 70 && curvy(r.pts, 160)) connector.add(i);
  });
  const cmap = /* @__PURE__ */ new Map();
  junctions.forEach((j, k) => {
    const c = find(k);
    j.cluster = c;
    if (!cmap.has(c)) cmap.set(c, []);
    cmap.get(c).push(k);
  });
  const clusters = [];
  for (const ks of cmap.values()) {
    const arms = [];
    for (const k of ks) junctions[k].arms.forEach((a, ai) => {
      if (!internal.has(a.road)) arms.push({ j: k, arm: ai });
    });
    for (const A of arms) {
      const ja = junctions[A.j], a = ja.arms[A.arm];
      let e = 0;
      for (const B of arms) {
        if (B === A) continue;
        const jb = junctions[B.j], b = jb.arms[B.arm], sn = Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0]);
        if (sn < 0.5) continue;
        e = Math.max(e, (jb.x - ja.x) * a.dir[0] + (jb.y - ja.y) * a.dir[1] + b.w / 2 / sn);
      }
      A.e = Math.min(e, 45);
    }
    clusters.push({ x: ks.reduce((s, k) => s + junctions[k].x, 0) / ks.length, y: ks.reduce((s, k) => s + junctions[k].y, 0) / ks.length, nodes: ks, arms, major: ks.some((k) => junctions[k].major) });
  }
  return { junctions, clusters, internal, connector, paired: opt.paired || pairedRoads(roads), ends, rings: rings.filter((g) => g.n >= 3), ringRoad };
}
const WHITE = [0.8, 0.8, 0.78], YELLOW = [0.78, 0.58, 0.08];
export function roadMarks(roads, on, num = (k, d) => d, bNear = null) {
  const J = findJunctions(roads), { junctions, clusters, internal, connector, paired, ends } = J, under = [], over = [];
  const laneW = num("lanew", 3.2), cwD = num("cw", 4), yW = num("yw", 0.3), lnW = num("lnw", 0.2), sw = num("sw", 2.5), gwP = num("gw", 0.3);
  const line = (dst, pts, w, rgb, period = 0, duty = 0) => {
    if (pts.length >= 2) dst.push({ pts, w, rgb, period, duty });
  };
  const cut = /* @__PURE__ */ new Map(), getCut = (i) => cut.get(i) || (cut.set(i, [[0, 0, 0, 0], [0, 0, 0, 0]]), cut.get(i));
  for (const C of clusters) for (const A of C.arms) {
    const j = junctions[A.j], a = j.arms[A.arm], r = roads[a.road], c = getCut(a.road)[a.end];
    const sStop = A.e + 0.5 + (a.rank >= 4 && C.major ? (a.rank >= 5 ? cwD : 3) + 1 : 0) + 0.4;
    c[0] = Math.max(c[0], C.major ? sStop : 0);
    c[3] = A.e;
    for (const b of j.arms) {
      if (b === a) continue;
      const cr = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0], sn = Math.abs(cr);
      if (sn < 0.2) continue;
      const lateral = cr > 0 ? 1 : 2, need = b.w / 2 / Math.max(sn, 0.5) + (b.rank >= 4 ? 0 : 0);
      c[lateral] = Math.max(c[lateral], need);
    }
    if (a.end === 1) {
      const t = c[1];
      c[1] = c[2];
      c[2] = t;
    }
    if (C.major && C.nodes.length > 1) {
      c[1] = Math.max(c[1], A.e);
      c[2] = Math.max(c[2], A.e);
    }
  }
  roads.forEach((r, i) => {
    const k = rankOf(r.cls);
    if (k < 3 || internal.has(i)) return;
    const L = len(r.pts), cc = getCut(i), pr = paired.get(i) || 0, cn = connector.has(i);
    const s0 = cc[0][0], s1 = L - cc[1][0];
    if (on.yline && k >= 4 && r.w >= 8 && !pr && !cn && s1 - s0 > 6) line(over, slice(r.pts, s0, s1), yW, YELLOW);
    if (on.lane && k >= 4 && r.w >= 8 && !cn && s1 - s0 > 8) {
      if (pr) {
        const n = Math.max(1, Math.floor(r.w / laneW + 0.25));
        for (let q = 1; q < n; q++) line(over, slice(r.pts, s0, s1, -r.w / 2 + q * r.w / n), lnW, WHITE, 10, 0.4);
      } else {
        const n = Math.max(1, Math.floor(r.w / 2 / laneW + 0.25));
        for (let q = 1; q < n; q++) for (const sg of [1, -1]) line(over, slice(r.pts, s0, s1, sg * q * r.w / 2 / n), lnW, WHITE, 10, 0.4);
      }
      for (const sg of [1, -1]) {
        if (pr === sg) continue;
        const a0 = Math.max(cc[0][sg > 0 ? 1 : 2], cc[0][0]), a1 = L - Math.max(cc[1][sg > 0 ? 1 : 2], cc[1][0]);
        if (a1 - a0 > 6) line(over, slice(r.pts, a0, a1, sg * (r.w / 2 - 0.5)), lnW, WHITE);
      }
    }
    if (on.walk && k >= 4 && r.w >= 8 && !cn) for (const sg of [1, -1]) {
      if (pr === sg) continue;
      const a0 = cc[0][sg > 0 ? 1 : 2], a1 = L - cc[1][sg > 0 ? 1 : 2];
      if (a1 - a0 < 10) continue;
      for (const [u0, u1] of runs(r.pts, a0, a1, sg * (r.w / 2 + sw + 5), bNear)) {
        line(under, slice(r.pts, u0, u1, sg * (r.w / 2 + sw / 2 - 0.05)), sw + 0.1, [0.25, 0.24, 0.22]);
        line(under, slice(r.pts, u0, u1, sg * (r.w / 2 + 0.12)), 0.25, [0.42, 0.41, 0.39]);
      }
    }
    if (on.walk && k === 3 && r.w >= 5 && !cn && L >= 30 && h01(r.pts[0][0], r.pts[0][1]) < gwP) {
      const sg = h01(r.pts[0][0], r.pts[0][1], 1) < 0.5 ? 1 : -1, a0 = Math.max(cc[0][sg > 0 ? 1 : 2], 2), a1 = L - Math.max(cc[1][sg > 0 ? 1 : 2], 2), gW = num("gww", 1.1);
      const cov = (o) => runs(r.pts, a0, a1, o, bNear).reduce((t, [u, v]) => t + v - u, 0) / (a1 - a0);
      if (a1 - a0 >= 15 && (!bNear || cov(r.w / 2 + 6) >= 0.5 && cov(-r.w / 2 - 6) >= 0.5)) {
        line(over, slice(r.pts, a0, a1, sg * (r.w / 2 - 0.15 - gW / 2)), gW, [0.12, 0.34, 0.17]);
        line(over, slice(r.pts, a0, a1, sg * (r.w / 2 - 0.15 - gW - 0.08)), 0.16, WHITE);
      }
    }
  });
  const nearRing = (x, y, jn) => !jn.arms.some((a) => J.ringRoad.has(a.road)) && (J.rings || []).some((g) => Math.hypot(x - g.x, y - g.y) < g.r1 + 45);
  if (on.xing) for (const C of clusters) for (const A of C.arms) {
    const j = junctions[A.j], a = j.arms[A.arm], r = roads[a.road], L = len(r.pts);
    if (nearRing(j.x, j.y, j)) continue;
    if (connector.has(a.road)) continue;
    const pts = a.end ? [...r.pts].reverse() : r.pts, pr0 = paired.get(a.road) || 0, pr = a.end ? -pr0 : pr0;
    const appr = pr === 0 ? [0, r.w / 2] : pr < 0 ? [-r.w / 2, r.w / 2] : null;
    if (!C.major) {
      if (a.rank === 3 && r.w >= 5 && A.e > 0 && L > A.e + 8 && appr) {
        const s = A.e + 1.2;
        line(over, cross(pts, s, appr[0] + 0.2, appr[1] - 0.3), 0.4, WHITE);
      }
      continue;
    }
    if (A.e <= 0 || L < A.e + 12) continue;
    const big = a.rank >= 4, cw = big ? a.rank >= 5 ? cwD : 3 : 0;
    if (big) line(over, cross(pts, A.e + 0.5 + cw / 2, -r.w / 2 + 0.4, r.w / 2 - 0.4), cw, WHITE, 0.8, 0.5);
    if (appr) line(over, cross(pts, A.e + 0.5 + cw + (big ? 1 : 0) + 0.2, appr[0] + 0.2, appr[1] - 0.3), 0.4, WHITE);
    if (big && appr && r.w >= 10 && A.e - 0.6 > 3.5) {
      const bw = Math.min(4.5, appr[1] - appr[0] - 1), o1 = appr[1] - 0.6, o0 = o1 - bw, s1 = A.e - 0.6, s0 = s1 - 2.5;
      for (const sg of [[s0, o0, s0, o1], [s1, o0, s1, o1], [s0, o0, s1, o0], [s0, o1, s1, o1]]) line(over, seg(pts, ...sg), 0.18, WHITE);
    }
  }
  return { under, over, J };
}
function cross(pts, s, o0, o1) {
  const [x, y, tx, ty] = along(pts, s);
  return [[x - ty * o0, y + tx * o0], [x - ty * o1, y + tx * o1]];
}
function seg(pts, sa, oa, sb, ob) {
  const A = along(pts, sa), B = along(pts, sb);
  return [[A[0] - A[3] * oa, A[1] + A[2] * oa], [B[0] - B[3] * ob, B[1] + B[2] * ob]];
}
function runs(pts, a0, a1, off, bNear) {
  if (!bNear) return [[a0, a1]];
  const hit = [];
  for (let s = a0; s <= a1; s += 10) {
    const [x, y, tx, ty] = along(pts, Math.min(s, a1));
    hit.push([s, bNear(x - ty * off, y + tx * off)]);
  }
  const out = [];
  let st = -1, last = -1;
  for (const [s, h] of hit) if (h) {
    if (st < 0 || s - last > 30) {
      if (st >= 0) out.push([st, last]);
      st = s;
    }
    last = s;
  }
  if (st >= 0) out.push([st, last]);
  return out.map(([u, v]) => [Math.max(a0, u - 5), Math.min(a1, v + 5)]).filter(([u, v]) => v - u >= 20);
}
