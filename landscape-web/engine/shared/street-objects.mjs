import { rankOf, along, findJunctions } from "./road-marks.mjs";
import { segIndex, clearOf, elevated, companion } from "./road-trees.mjs";
const h01 = (x, y, k = 0) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
const len = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
};
export function buildingIndex(buildings) {
  const C = 16, G = /* @__PURE__ */ new Map(), rings = [];
  for (const b of buildings || []) {
    const r = b.rings?.[0];
    if (!r || r.length < 3) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of r) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    const k = rings.length;
    rings.push([r, x0, y0, x1, y1]);
    for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) for (let gy = Math.floor(y0 / C); gy <= Math.floor(y1 / C); gy++) {
      const key = gx * 4096 + gy;
      let a = G.get(key);
      if (!a) G.set(key, a = []);
      a.push(k);
    }
  }
  const cand = (x, y, R) => {
    const s = /* @__PURE__ */ new Set();
    for (let gx = Math.floor((x - R) / C); gx <= Math.floor((x + R) / C); gx++) for (let gy = Math.floor((y - R) / C); gy <= Math.floor((y + R) / C); gy++) for (const k of G.get(gx * 4096 + gy) || []) s.add(k);
    return s;
  };
  const pip = (r, x, y) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const edge = (r, x, y) => {
    let d = 1e9;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j], b = r[i], dx = b[0] - a[0], dy = b[1] - a[1], f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(x - a[0] - dx * f, y - a[1] - dy * f));
    }
    return d;
  };
  const blocked = (x, y, rr = 0) => {
    for (const k of cand(x, y, rr)) {
      const [r, x0, y0, x1, y1] = rings[k];
      if (x < x0 - rr || x > x1 + rr || y < y0 - rr || y > y1 + rr) continue;
      if (pip(r, x, y) || rr > 0 && edge(r, x, y) < rr) return true;
    }
    return false;
  };
  const near = (x, y, R) => {
    for (const k of cand(x, y, R)) {
      const [, x0, y0, x1, y1] = rings[k];
      if (x > x0 - R && x < x1 + R && y > y0 - R && y < y1 + R) return true;
    }
    return false;
  };
  return { inside: (x, y) => blocked(x, y, 0), blocked, near };
}
export function signals(roads, J = findJunctions(roads), { armMax = 7, cwD = 4 } = {}) {
  const { junctions, clusters, connector, paired } = J, out = [];
  const nearRing = (x, y, jn) => !jn.arms.some((a) => J.ringRoad.has(a.road)) && (J.rings || []).some((g) => Math.hypot(x - g.x, y - g.y) < g.r1 + 45);
  for (const C of clusters) {
    if (!C.major) continue;
    for (const A of C.arms) {
      const j = junctions[A.j], a = j.arms[A.arm], r = roads[a.road];
      if (nearRing(j.x, j.y, j) || connector.has(a.road) || elevated(r) || a.rank < 3 || r.w < 6) continue;
      const L = len(r.pts);
      if (A.e <= 0 || L < A.e + 14) continue;
      const pts = a.end ? [...r.pts].reverse() : r.pts, pr0 = paired.get(a.road) || 0, pr = a.end ? -pr0 : pr0;
      const appr = pr === 0 ? [0, r.w / 2] : pr < 0 ? [-r.w / 2, r.w / 2] : null;
      if (!appr) continue;
      const cw = a.rank >= 4 ? a.rank >= 5 ? cwD : 3 : 0, sStop = A.e + 0.5 + cw + (cw ? 1 : 0) + 0.2, [x, y, tx, ty] = along(pts, sStop + 0.5), o = appr[1] + 0.9;
      out.push([x - ty * o, y + tx * o, tx, ty, Math.min(armMax, (appr[1] - appr[0]) * 0.75), Math.abs(tx) > Math.abs(ty) ? 2 : 0]);
    }
  }
  return out;
}
export const MOTO_COLORS = [[0.05, 0.05, 0.055], [0.06, 0.06, 0.07], [0.12, 0.12, 0.13], [0.2, 0.2, 0.21], [0.05, 0.08, 0.16], [0.25, 0.05, 0.05], [0.62, 0.62, 0.6], [0.75, 0.74, 0.7], [0.7, 0.55, 0.1], [0.1, 0.3, 0.45]];
const MOTO_W = [16, 12, 12, 9, 7, 6, 8, 5, 2, 3];
export function motoRows(roads, J, bi, { density = 0.55, pitch = 0.8 } = {}) {
  const idx = segIndex(roads), out = [], cut = /* @__PURE__ */ new Map(), { clusters, junctions, internal, connector } = J, wsum = MOTO_W.reduce((a, b) => a + b, 0);
  const pick = (u) => {
    let a = u * wsum;
    for (let k = 0; k < MOTO_W.length; k++) {
      a -= MOTO_W[k];
      if (a < 0) return k;
    }
    return 0;
  };
  for (const C of clusters) for (const A of C.arms) {
    const a = junctions[A.j].arms[A.arm], r = roads[a.road], c = cut.get(a.road) || [0, 0];
    c[a.end] = Math.max(c[a.end], A.e + 3 + (C.major && a.rank >= 4 ? 6 : 0));
    cut.set(a.road, c);
    void r;
  }
  roads.forEach((r, i) => {
    const k = rankOf(r.cls);
    if (k < 3 || k > 6 || elevated(r) || internal.has(i) || connector.has(i) || r.pts.length < 2) return;
    const alley = k === 3;
    if (alley && r.w < 5) return;
    const L = len(r.pts), c = cut.get(i) || [0, 0], s0 = c[0] + 1, s1 = L - c[1] - 1;
    if (s1 - s0 < 6) return;
    for (const sg of [1, -1]) {
      if ((J.paired.get(i) || 0) === sg) continue;
      const off = alley ? r.w / 2 - 0.95 : r.w / 2 + 1.15;
      for (let b = Math.floor(s0 / 12); b * 12 < s1; b++) {
        if (h01(i * 1.7 + b, sg, 11) >= density) continue;
        for (let s = Math.max(s0, b * 12 + 0.4); s < Math.min(s1, b * 12 + 12); s += pitch) {
          if (h01(s * 3.1, i + sg, 13) < 0.1) continue;
          const [x, y, tx, ty] = along(r.pts, s), nx = -ty * sg, ny = tx * sg, px = x + nx * off, py = y + ny * off;
          if (!bi.near(x + nx * (r.w / 2 + 6), y + ny * (r.w / 2 + 6), 4)) continue;
          if (!alley && companion(roads, idx, i, x, y, tx, ty, sg, 45)) continue;
          if (bi.inside(px + nx * 0.95, py + ny * 0.95) || bi.inside(px - nx * 0.95, py - ny * 0.95) || bi.blocked(px, py, 0.2)) continue;
          if (!clearOf(roads, idx, px, py, tx, ty, /* @__PURE__ */ new Set([i]), 2.5, 1)) continue;
          const u = h01(s, i, 17), head = Math.atan2(ny, nx) + (u < 0.5 ? 0 : Math.PI) + (h01(s, i, 19) - 0.5) * 0.25;
          out.push([px, py, head, pick(h01(s * 1.3, i, 23))]);
        }
      }
    }
  });
  return out;
}
