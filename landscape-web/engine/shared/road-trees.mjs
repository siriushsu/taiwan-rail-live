import { rankOf, along } from "./road-marks.mjs";
const h01 = (x, y, k = 0) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
const len = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
};
export const elevated = (r) => !!r.bridge || r.pts.some((p) => (p[2] || 0) > 0.3);
export function segIndex(roads, extra = []) {
  const C = 24, G = /* @__PURE__ */ new Map(), segs = [];
  const put = (s, ax, ay, bx, by) => {
    const k = segs.length;
    segs.push(s);
    for (let gx = Math.floor(Math.min(ax, bx) / C); gx <= Math.floor(Math.max(ax, bx) / C); gx++) for (let gy = Math.floor(Math.min(ay, by) / C); gy <= Math.floor(Math.max(ay, by) / C); gy++) {
      const key = gx * 4096 + gy;
      let a = G.get(key);
      if (!a) G.set(key, a = []);
      a.push(k);
    }
  };
  roads.forEach((r, i) => {
    for (let k = 1; k < r.pts.length; k++) {
      const a = r.pts[k - 1], b = r.pts[k];
      put([i, a[0], a[1], b[0], b[1]], a[0], a[1], b[0], b[1]);
    }
  });
  for (const [ax, ay, bx, by, need] of extra) put([-1, ax, ay, bx, by, need], ax, ay, bx, by);
  return { each(x, y, R, fn) {
    const seen = /* @__PURE__ */ new Set();
    for (let gx = Math.floor((x - R) / C); gx <= Math.floor((x + R) / C); gx++) for (let gy = Math.floor((y - R) / C); gy <= Math.floor((y + R) / C); gy++) for (const k of G.get(gx * 4096 + gy) || []) {
      if (seen.has(k)) continue;
      seen.add(k);
      fn(...segs[k]);
    }
  } };
}
export function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, u = ((x - ax) * dx + (y - ay) * dy) / l2, f = Math.max(0, Math.min(1, u));
  return [Math.hypot(x - ax - dx * f, y - ay - dy * f), u];
}
export function clearOf(roads, idx, x, y, tx, ty, skip, perp = 9, par = 0.6) {
  let ok = true;
  idx.each(x, y, 24, (i, ax, ay, bx, by, need) => {
    if (!ok || skip.has(i)) return;
    const [d] = segDist(x, y, ax, ay, bx, by);
    if (i < 0) {
      if (d < need) ok = false;
      return;
    }
    const r = roads[i], k = rankOf(r.cls);
    if (k < 2) return;
    const sl = Math.hypot(bx - ax, by - ay) || 1, cos = Math.abs(((bx - ax) * tx + (by - ay) * ty) / sl);
    const lim = elevated(r) ? r.w / 2 + 3 : cos < 0.87 ? r.w / 2 + perp : r.w / 2 + par;
    if (d < lim) ok = false;
  });
  return ok;
}
export function companion(roads, idx, i, x, y, tx, ty, side, maxLat = 30) {
  let best = null;
  idx.each(x, y, maxLat + 2, (o, ax, ay, bx, by) => {
    if (o === i || o < 0) return;
    const r = roads[o];
    if (rankOf(r.cls) < 4 || elevated(r)) return;
    const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy) || 1;
    if (Math.abs((sx * tx + sy * ty) / sl) < 0.94) return;
    const u = ((x - ax) * sx + (y - ay) * sy) / (sl * sl);
    if (u < -0.05 || u > 1.05) return;
    const lat = -(x - ax - sx * u) * ty + (y - ay - sy * u) * tx;
    const sg = lat > 0 ? -1 : 1, d = Math.abs(lat);
    if (sg !== side || d < 4 || d > maxLat) return;
    if (!best || d < best[1]) best = [sg, d, o];
  });
  return best;
}
export function roadTrees(roads, { gap = 9, gapMin = 0.6, sideW = 10, sideOff = 1.2, blocked = null, urban = null, extra = [] } = {}) {
  const idx = segIndex(roads, extra), out = [];
  roads.forEach((r, i) => {
    const k = rankOf(r.cls);
    if (k < 4 || k > 7 || r.cls === "motorway" || elevated(r) || r.pts.length < 2) return;
    const L = len(r.pts);
    if (L < 20) return;
    const sideOk = k >= 5 && r.w >= sideW;
    for (const sg of [1, -1]) {
      let s = h01(r.pts[0][0], r.pts[0][1], sg > 0 ? 3 : 5) * gap;
      for (; s < L; s += gap * (0.88 + 0.24 * h01(s, i, sg))) {
        const [x, y, tx, ty] = along(r.pts, s), nx = -ty, ny = tx, c = companion(roads, idx, i, x, y, tx, ty, sg);
        let px, py, kind, skip;
        if (c) {
          const ro = roads[c[2]];
          if (c[2] < i || c[1] < (r.w + ro.w) / 2 + gapMin) continue;
          px = x + nx * sg * c[1] / 2;
          py = y + ny * sg * c[1] / 2;
          kind = 0;
          skip = /* @__PURE__ */ new Set([i, c[2]]);
        } else {
          if (!sideOk && !(k >= 4 && companion(roads, idx, i, x, y, tx, ty, -sg))) continue;
          const o = r.w / 2 + sideOff;
          px = x + nx * sg * o;
          py = y + ny * sg * o;
          kind = 1;
          skip = /* @__PURE__ */ new Set([i]);
          if (urban && !urban(x + nx * sg * (r.w / 2 + 8), y + ny * sg * (r.w / 2 + 8))) continue;
        }
        if (!clearOf(roads, idx, px, py, tx, ty, skip)) continue;
        if (blocked && blocked(px, py, 1.2)) continue;
        out.push([px, py, kind]);
      }
    }
  });
  return out;
}
