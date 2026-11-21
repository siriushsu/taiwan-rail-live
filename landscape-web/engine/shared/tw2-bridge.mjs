const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LIN = Uint8Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return Math.round(255 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
});
const CONC = [150, 148, 142], CABLE = [46, 48, 52], STEEL = [196, 198, 196];
function tri(o, a, b, c, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  for (const p of [a, b, c]) {
    o.pos.push(p[0], p[2], -p[1]);
    o.nor.push(nx, nz, -ny);
    o.col.push(LIN[col[0]], LIN[col[1]], LIN[col[2]]);
  }
}
const quad = (o, a, b, c, d, col) => {
  tri(o, a, b, c, col);
  tri(o, a, c, d, col);
};
function box(o, p, q, wd, dp, col, ref = [0, 0, 1]) {
  let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < 0.01) return;
  dx /= l;
  dy /= l;
  dz /= l;
  if (Math.abs(dx * ref[0] + dy * ref[1] + dz * ref[2]) > 0.97) ref = Math.abs(dz) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let sx = dy * ref[2] - dz * ref[1], sy = dz * ref[0] - dx * ref[2], sz = dx * ref[1] - dy * ref[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx *= wd / 2 / sl;
  sy *= wd / 2 / sl;
  sz *= wd / 2 / sl;
  let tx = dy * sz - dz * sy, ty = dz * sx - dx * sz, tz = dx * sy - dy * sx;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx *= dp / 2 / tl;
  ty *= dp / 2 / tl;
  tz *= dp / 2 / tl;
  const C = (e, a, b) => [e[0] + sx * a + tx * b, e[1] + sy * a + ty * b, e[2] + sz * a + tz * b], K = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [a0, b0] = K[k], [a1, b1] = K[(k + 1) % 4];
    quad(o, C(p, a0, b0), C(p, a1, b1), C(q, a1, b1), C(q, a0, b0), col);
  }
}
function wire(o, p, q, tk, col) {
  let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < 0.05) return;
  dx /= l;
  dy /= l;
  dz /= l;
  const ref = Math.abs(dz) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let sx = dy * ref[2] - dz * ref[1], sy = dz * ref[0] - dx * ref[2], sz = dx * ref[1] - dy * ref[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx *= tk / 2 / sl;
  sy *= tk / 2 / sl;
  sz *= tk / 2 / sl;
  const tx = dy * sz - dz * sy, ty = dz * sx - dx * sz, tz = dx * sy - dy * sx;
  for (const [ax, ay, az] of [[sx, sy, sz], [tx, ty, tz]]) quad(o, [p[0] - ax, p[1] - ay, p[2] - az], [p[0] + ax, p[1] + ay, p[2] + az], [q[0] + ax, q[1] + ay, q[2] + az], [q[0] - ax, q[1] - ay, q[2] - az], col);
}
function frame(B) {
  const [ax, ay] = B.a, [bx, by] = B.b, L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux, zs = B.zs, K = zs.length - 1;
  const zAt = (f) => {
    const t = clamp(f, 0, 1) * K, i = Math.min(K - 1, Math.floor(t));
    return zs[i] + (zs[i + 1] - zs[i]) * (t - i);
  };
  return { L, n: [nx, ny, 0], u: [ux, uy, 0], zAt, P: (f, v = 0, dz = 0) => [ax + (bx - ax) * f + nx * v, ay + (by - ay) * f + ny * v, zAt(f) + dz] };
}
const gAt = (B, f) => {
  const g = B.g, K = g.length - 1, t = clamp(f, 0, 1) * K, i = Math.min(K - 1, Math.floor(t));
  return K < 1 ? g[0] : g[i] + (g[i + 1] - g[i]) * (t - i);
};
function pier(o, F, B, f, top, wd = B.w * 0.7, tk = 1.8, col = CONC) {
  const p = F.P(f, 0, 0), g = Math.min(gAt(B, f), p[2] - 2) - 0.5;
  p[2] = g;
  const q = F.P(f, 0, top);
  if (q[2] - g < 0.8) return;
  box(o, p, q, tk, wd, col, F.n);
}
function susp(o, B) {
  const F = frame(B), { L, P } = F, e = B.w / 2 + 0.35, H = B.th || clamp(L / 10 + 1.5, 4.5, 60), leg = clamp(H * 0.085, 0.45, 3), tc = B.tc || CONC, cc = B.cc || CABLE, ct = clamp(L / 450, 0.22, 0.7);
  for (const f of [0, 1]) {
    for (const s of [-1, 1]) {
      const b = P(f, s * e, 0);
      b[2] = Math.min(gAt(B, f), b[2] - 1) - 0.5;
      box(o, b, P(f, s * e, H), leg, leg, tc, F.n);
    }
    box(o, P(f, -e, H - leg * 0.7), P(f, e, H - leg * 0.7), leg * 0.8, leg * 0.9, tc);
    if (H > 12) box(o, P(f, -e, H * 0.55), P(f, e, H * 0.55), leg * 0.7, leg * 0.8, tc);
    box(o, P(f, -e, -leg * 0.6), P(f, e, -leg * 0.6), leg * 0.8, leg, tc);
  }
  const N = clamp(Math.round(L / (B.hs || 6)), 8, 36), sag = H - (B.low ?? 1.3), bs = (B.bs ?? H * 1.7) / L;
  for (const s of [-1, 1]) {
    let pv = P(0, s * e, H);
    for (let i = 1; i <= N; i++) {
      const f = i / N, q = P(f, s * e, H - sag * 4 * f * (1 - f));
      box(o, pv, q, ct, ct, cc);
      if (i < N) wire(o, q, P(f, s * e, 0.1), ct * 0.45, cc);
      pv = q;
    }
    for (const [f, d] of [[0, -1], [1, 1]]) {
      const top = P(f, s * e, H), an = P(f + d * bs, s * e, 0);
      an[2] = Math.min(an[2], top[2] - H) - 0.2;
      box(o, top, an, ct, ct, cc);
    }
  }
}
function cable(o, B) {
  const F = frame(B), { L, P } = F, e = B.w / 2 + 0.3, tc = B.tc || CONC, cc = B.cc || CABLE, ct = clamp(L / 600, 0.2, 0.55);
  for (const T of B.towers) {
    const f = T.f, h = T.h, shape = T.shape || "H", leg = clamp(h * 0.07, 0.8, 4.5), v0 = T.v || 0, base = (v) => {
      const b = P(f, v, 0);
      b[2] = Math.min(gAt(B, f), b[2] - 1) - 0.5;
      return b;
    };
    let top;
    if (shape === "H") {
      for (const s of [-1, 1]) {
        box(o, base(s * e), P(f, s * e, 0), leg * 1.5, leg * 1.5, CONC, F.n);
        box(o, P(f, s * e, 0), P(f, s * e, h), leg, leg, tc, F.n);
      }
      box(o, P(f, -e, h * 0.93), P(f, e, h * 0.93), leg * 0.8, leg * 0.8, tc);
      if (h > 22) box(o, P(f, -e, h * 0.5), P(f, e, h * 0.5), leg * 0.8, leg * 0.8, tc);
      box(o, P(f, -e, -leg * 0.5), P(f, e, -leg * 0.5), leg * 0.9, leg, tc);
      top = (s, k) => P(f, s * e, h * (0.5 + 0.45 * k));
    } else if (shape === "A") {
      for (const s of [-1, 1]) {
        box(o, base(s * (e + 1.2)), P(f, s * (e + 0.6), 0), leg, leg, tc, F.n);
        box(o, P(f, s * (e + 0.6), 0), P(f, 0, h), leg, leg, tc, F.n);
      }
      box(o, P(f, -e - 0.6, -leg * 0.5), P(f, e + 0.6, -leg * 0.5), leg * 0.9, leg, tc);
      top = (s, k) => {
        const z = h * (0.55 + 0.4 * k);
        return P(f, s * (e + 0.6) * (1 - z / h), z);
      };
    } else if (shape === "Y") {
      const zj = h * 0.58;
      for (const s of [-1, 1]) {
        box(o, base(s * (e + 1.2)), P(f, s * (e + 0.6), 0), leg, leg, tc, F.n);
        box(o, P(f, s * (e + 0.6), 0), P(f, 0, zj), leg, leg, tc, F.n);
      }
      box(o, P(f, 0, zj - leg), P(f, 0, h), leg, leg * 1.15, tc, F.n);
      box(o, P(f, -e - 0.6, -leg * 0.5), P(f, e + 0.6, -leg * 0.5), leg * 0.9, leg, tc);
      top = (s, k) => P(f, 0, zj + (h - zj) * (0.08 + 0.88 * k));
    } else {
      const fl = f + (T.lx || 0) / L, tp = P(fl, v0, 0);
      tp[2] = P(f, v0, 0)[2] + h;
      const b0 = base(v0);
      box(o, b0, tp, leg, leg * 1.2, tc, F.n);
      if (T.ball) {
        const c = [tp[0], tp[1], tp[2] + T.ball * 0.6];
        for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) box(o, c.map((v, i) => v - d[i] * T.ball), c.map((v, i) => v + d[i] * T.ball), T.ball * 1.5, T.ball * 1.5, tc);
      }
      top = (s, k) => {
        const q = 0.5 + 0.46 * k, d0 = P(f, v0, 0);
        return [d0[0] + (tp[0] - d0[0]) * q, d0[1] + (tp[1] - d0[1]) * q, d0[2] + h * q];
      };
    }
    const planes = T.planes || (shape === "I" ? 1 : 2);
    for (const [dir, reach] of [[-1, T.ra ?? f * L * 0.92], [1, T.rb ?? (1 - f) * L * 0.92]]) {
      if (!(reach > 4)) continue;
      const n = T.n || clamp(Math.round(reach / 11), 3, 14);
      for (let i = 1; i <= n; i++) {
        const fz = f + dir * reach * (i / n) / L, k = n > 1 ? (i - 1) / (n - 1) : 1;
        for (const s of planes === 2 ? [-1, 1] : [0]) box(o, top(s || 1, k), P(fz, planes === 2 ? s * e : T.dv ?? v0, 0.25), ct, ct, cc);
      }
    }
  }
}
function arch(o, B) {
  const F = frame(B), { L, P } = F, e = B.w / 2 + 0.4, cuts = B.cuts || Array.from({ length: (B.n || 1) + 1 }, (_, i) => i / (B.n || 1)), mode = B.mode || "through", col = B.tc || STEEL, cc = B.cc || CABLE, ribs = B.ribs === 1 ? [0] : [-1, 1], lean = B.lean || 0;
  for (let k = 0; k < cuts.length - 1; k++) {
    const f0 = cuts[k], f1 = cuts[k + 1], Ls = L * (f1 - f0), rise = B.rise || Ls * (mode === "deck" ? 0.2 : 0.19), M = clamp(Math.round(Ls / 9), 10, 24) & ~1;
    const drop = mode === "half" ? B.drop ?? rise * 0.32 : 0, z0 = mode === "deck" ? -1.3 - rise : -drop, rw = clamp(Ls / 70, 0.7, 2.6), rd = rw * (mode === "deck" ? 1.3 : 1.1);
    const R = (s, u) => {
      const y = 4 * u * (1 - u);
      return P(f0 + (f1 - f0) * u, s * e * (1 - lean * y), z0 + rise * y);
    };
    for (const s of ribs) {
      let pv = R(s, 0);
      for (let i = 1; i <= M; i++) {
        const u = i / M, q = R(s, u);
        box(o, pv, q, rw, rd, col);
        pv = q;
        const zd = F.zAt(f0 + (f1 - f0) * u);
        if (i < M && mode !== "deck" && q[2] - zd > 1.2 && i % 2 === 0) wire(o, q, P(f0 + (f1 - f0) * u, s * e * (ribs.length === 1 ? 0 : 1), 0.15), clamp(rw * 0.22, 0.14, 0.4), cc);
        if (i < M && mode === "deck" && zd - 1.3 - q[2] > 1 && i % 2 === 0) box(o, q, P(f0 + (f1 - f0) * u, s * e * 0.92, -1.3), rw * 0.55, rw * 0.55, col, F.n);
      }
    }
    if (ribs.length === 2 && mode !== "deck" && !B.nobrace) for (let i = 2; i < M; i += 2) {
      const a = R(-1, i / M), b = R(1, i / M);
      if (a[2] - F.zAt(f0 + (f1 - f0) * i / M) > 6) box(o, a, b, rw * 0.5, rw * 0.5, col);
    }
    if (ribs.length === 2 && mode === "deck") for (let i = 2; i < M; i += 4) box(o, R(-1, i / M), R(1, i / M), rw * 0.5, rw * 0.5, col);
    if (k > 0) pier(o, F, B, f0, mode === "deck" ? z0 + 0.5 : -1.4);
  }
  if (mode === "deck" && !B.noEnds) for (const f of [cuts[0], cuts.at(-1)]) pier(o, F, B, f, -1.4, B.w * 0.8, 2.4);
}
function truss(o, B) {
  const F = frame(B), { L, P } = F, e = B.w / 2 + 0.3, cuts = B.cuts || Array.from({ length: (B.n || 1) + 1 }, (_, i) => i / (B.n || 1)), col = B.tc || [120, 124, 122];
  for (let k = 0; k < cuts.length - 1; k++) {
    const f0 = cuts[k], f1 = cuts[k + 1], Ls = L * (f1 - f0), h = B.h || clamp(Ls / 7.5, 4.5, 13), m = clamp(Math.round(Ls / (h * 1.05) / 2) * 2, 4, 16), ch = clamp(h * 0.055, 0.3, 0.7), fu = (i) => f0 + (f1 - f0) * i / m;
    const hz = (i) => B.curve ? h * (0.62 + 0.38 * 4 * (i / m) * (1 - i / m) / 1) : h, Bn = (s, i) => P(fu(i), s * e, 0.25), Tn = (s, i) => P(fu(i), s * e, hz(i));
    for (const s of [-1, 1]) {
      box(o, Bn(s, 0), Bn(s, m), ch, ch * 1.3, col);
      box(o, Bn(s, 0), Tn(s, 1), ch, ch, col);
      box(o, Tn(s, m - 1), Bn(s, m), ch, ch, col);
      for (let i = 1; i < m - 1; i++) {
        box(o, Tn(s, i), Tn(s, i + 1), ch, ch * 1.2, col);
        if (i % 2) box(o, Tn(s, i), Bn(s, i + 1), ch * 0.7, ch * 0.7, col);
        else box(o, Bn(s, i), Tn(s, i + 1), ch * 0.7, ch * 0.7, col);
      }
      for (let i = 1; i < m; i++) box(o, Bn(s, i), Tn(s, i), ch * 0.6, ch * 0.6, col, F.n);
    }
    for (let i = 1; i < m; i++) box(o, Tn(-1, i), Tn(1, i), ch * 0.7, ch * 0.7, col);
    if (k > 0) pier(o, F, B, f0, -1.4);
  }
}
const KIND = { susp, cable, arch, truss };
export function bridgeGeo(bridges) {
  const o = { pos: [], nor: [], col: [] };
  for (const B of bridges) KIND[B.t]?.(o, B);
  return { pos: new Float32Array(o.pos), nor: new Float32Array(o.nor), col: new Uint8Array(o.col), tris: o.pos.length / 9 };
}
export function inClear(clear, x, y) {
  for (const [ax, ay, bx, by, hw] of clear) {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, u = ((x - ax) * dx + (y - ay) * dy) / l, v = Math.abs((x - ax) * -dy + (y - ay) * dx) / l;
    if (u > 4 && u < l - 4 && v < hw) return true;
  }
  return false;
}
export function platGeo(plats) {
  const o = { pos: [], nor: [], col: [] }, TOP = [156, 154, 148], SIDE = [122, 120, 114], YEL = [216, 180, 46], cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const P of plats) {
    const r = P.ring, n = r.length, z = P.z, zb = Math.min(P.g, z - 1) - 0.3, V = (q, h) => [q[0], q[1], h], ix = r.map((_, i) => i);
    let guard = 0;
    while (ix.length > 3 && guard++ < 4e3) {
      let cut = false;
      for (let i = 0; i < ix.length; i++) {
        const ia = ix[(i + ix.length - 1) % ix.length], ib = ix[i], ic = ix[(i + 1) % ix.length], a = r[ia], b = r[ib], c = r[ic], k = cr(a, b, c);
        if (Math.abs(k) < 1e-6) {
          ix.splice(i, 1);
          cut = true;
          break;
        }
        if (k < 0) continue;
        if (ix.some((j) => j !== ia && j !== ib && j !== ic && cr(a, b, r[j]) >= 0 && cr(b, c, r[j]) >= 0 && cr(c, a, r[j]) >= 0)) continue;
        tri(o, V(a, z), V(b, z), V(c, z), TOP);
        ix.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (ix.length === 3) tri(o, V(r[ix[0]], z), V(r[ix[1]], z), V(r[ix[2]], z), TOP);
    for (let i = 0; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      quad(o, V(a, zb), V(b, zb), V(b, z), V(a, z), SIDE);
    }
    for (const e of P.edges || []) {
      const a = r[e], b = r[(e + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 2) continue;
      const tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l, nx = -ty, ny = tx, Q = (s, d) => [a[0] + tx * s + nx * d, a[1] + ty * s + ny * d, z + 0.04];
      quad(o, Q(0.4, 0.55), Q(l - 0.4, 0.55), Q(l - 0.4, 0.95), Q(0.4, 0.95), YEL);
    }
  }
  return { pos: new Float32Array(o.pos), nor: new Float32Array(o.nor), col: new Uint8Array(o.col), tris: o.pos.length / 9 };
}
