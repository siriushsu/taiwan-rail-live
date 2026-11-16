export const DECK_LINE = { inset: 0.35, margin: 0.3, dh: 1, step: 0.5, minSkip: 2, minKeep: 2, up: 0.3, cell: 32 };
const RANK = { footway: 0, path: 0, steps: 0, cycleway: 0, track: 1, service: 2, pedestrian: 2, unknown: 2, living_street: 3, residential: 3, unclassified: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 7 };
const rankOf = (c) => RANK[c] ?? 2, PED = /^(footway|steps|cycleway|path|pedestrian|bridleway)$/;
const H = (p) => p[2] || 0, W = (p) => p[3] > 0 ? p[3] : 0;
const wAt = (a, b, f) => W(a) > 0 ? W(a) + ((W(b) > 0 ? W(b) : W(a)) - W(a)) * f : 0;
const r2 = (v) => Math.round(v * 100) / 100;
export const hasDeckLines = (r) => rankOf(r.cls) >= 5 && r.pts.some((p) => H(p) > DECK_LINE.up);
export function edgeSkips(lines, covers, K = DECK_LINE) {
  const segs = [], grid = /* @__PURE__ */ new Map(), key = (i, j) => i * 100003 + j;
  for (const c of covers) {
    if (PED.test(String(c.cls)) || c.pts.length < 2) continue;
    const n = c.pts.length;
    for (let k = 0; k < n - 1; k++) {
      const a = c.pts[k], b = c.pts[k + 1];
      if (Math.max(H(a), H(b)) <= K.up) continue;
      const half = Math.max(c.w, W(a), W(b)) / 2 + 1, s = { a, b, k, n, w: c.w, self: c.self };
      const i0 = Math.floor((Math.min(a[0], b[0]) - half) / K.cell), i1 = Math.floor((Math.max(a[0], b[0]) + half) / K.cell), j0 = Math.floor((Math.min(a[1], b[1]) - half) / K.cell), j1 = Math.floor((Math.max(a[1], b[1]) + half) / K.cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const q = key(i, j);
        let l = grid.get(q);
        if (!l) grid.set(q, l = []);
        l.push(s);
      }
      segs.push(s);
    }
  }
  const covered = (x, y, h, self) => {
    for (const s of grid.get(key(Math.floor(x / K.cell), Math.floor(y / K.cell))) || []) {
      if (s.self === self) continue;
      const { a, b } = s, dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, u = L2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
      let d, f;
      if (u >= 0 && u <= 1) {
        f = u;
        d = Math.hypot(x - a[0] - dx * u, y - a[1] - dy * u);
      } else if (u < 0 && s.k > 0) {
        f = 0;
        d = Math.hypot(x - a[0], y - a[1]);
      } else if (u > 1 && s.k < s.n - 2) {
        f = 1;
        d = Math.hypot(x - b[0], y - b[1]);
      } else continue;
      const hc = H(a) + (H(b) - H(a)) * f;
      if (hc <= K.up || Math.abs(h - hc) >= K.dh) continue;
      const wc = wAt(a, b, f) || s.w;
      if (d <= wc / 2 - K.margin) return true;
    }
    return false;
  };
  return lines.map((r) => {
    if (!hasDeckLines(r)) return null;
    const P = r.pts, S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = S.at(-1);
    if (!(total > 0)) return null;
    const out = [];
    for (const o of [-1, 1]) {
      const ns = Math.max(1, Math.ceil(total / K.step)), hit = new Uint8Array(ns + 1);
      let seg = 0;
      for (let q = 0; q <= ns; q++) {
        const s = total * q / ns;
        while (seg < P.length - 2 && S[seg + 1] < s) seg++;
        const a = P[seg], b = P[seg + 1], L = S[seg + 1] - S[seg];
        if (!(L > 0)) continue;
        const f = Math.max(0, Math.min(1, (s - S[seg]) / L)), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, wd = wAt(a, b, f) || r.w, of = o * (wd / 2 - K.inset);
        hit[q] = covered(a[0] + (b[0] - a[0]) * f + nx * of, a[1] + (b[1] - a[1]) * f + ny * of, H(a) + (H(b) - H(a)) * f, r.self) ? 1 : 0;
      }
      let runs = [];
      for (let q = 0; q <= ns; q++) {
        if (!hit[q]) continue;
        let e = q;
        while (e + 1 <= ns && hit[e + 1]) e++;
        runs.push([q === 0 ? 0 : total * (q - 0.5) / ns, e === ns ? total : total * (e + 0.5) / ns]);
        q = e;
      }
      const merged = [];
      for (const g of runs) {
        const last = merged.at(-1);
        if (last && g[0] - last[1] < K.minKeep) last[1] = g[1];
        else merged.push([...g]);
      }
      if (merged.length && merged[0][0] < K.minKeep) merged[0][0] = 0;
      if (merged.length && total - merged.at(-1)[1] < K.minKeep) merged.at(-1)[1] = total;
      for (const g of merged) if (g[1] - g[0] >= K.minSkip) out.push([o, r2(g[0]), r2(g[1])]);
    }
    return out.length ? out : null;
  });
}
export function edgeRuns(r, o) {
  const sk = (r.edgeSkip || []).filter((e) => e[0] === o);
  if (!sk.length) return [r.pts];
  const P = r.pts, S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = S.at(-1), keep = [];
  let s = 0;
  for (const [, a, b] of [...sk].sort((u, v) => u[1] - v[1])) {
    if (a > s) keep.push([s, a]);
    s = Math.max(s, b);
  }
  if (total > s) keep.push([s, total]);
  const at = (t) => {
    let i = 0;
    while (i < P.length - 2 && S[i + 1] < t) i++;
    const a = P[i], b = P[i + 1], L = S[i + 1] - S[i], f = L > 0 ? Math.max(0, Math.min(1, (t - S[i]) / L)) : 0, w = wAt(a, b, f);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, H(a) + (H(b) - H(a)) * f, ...w > 0 ? [w] : []];
  };
  return keep.filter(([a, b]) => b - a >= 0.01).map(([a, b]) => {
    const out = [at(a)];
    for (let i = 0; i < P.length; i++) if (S[i] > a && S[i] < b) out.push(P[i]);
    out.push(at(b));
    return out;
  });
}
export function edgeKeep(r, o) {
  const sk = (r.edgeSkip || []).filter((e) => e[0] === o);
  if (!sk.length) return null;
  const P = r.pts, S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = S.at(-1), keep = [];
  let s = 0;
  for (const [, a, b] of [...sk].sort((u, v) => u[1] - v[1])) {
    if (a > s) keep.push([s, a]);
    s = Math.max(s, b);
  }
  if (total > s) keep.push([s, total]);
  return keep.filter(([a, b]) => b - a >= 0.01);
}
export function keepSpans(keep, s0, s1) {
  if (!keep) return [[0, 1]];
  const out = [], L = s1 - s0;
  for (const [a, b] of keep) {
    if (!(L > 0)) {
      if (a <= s0 && s0 <= b) return [[0, 1]];
      continue;
    }
    const u0 = Math.max(a, s0), u1 = Math.min(b, s1);
    if (u1 > u0) out.push([(u0 - s0) / L, (u1 - s0) / L]);
  }
  return out;
}
