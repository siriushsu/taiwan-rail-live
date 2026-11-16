const YEL = [214, 168, 20, 255], BLK = [28, 28, 28, 255], WHITE = [235, 235, 230, 255], RED = [200, 30, 25, 255], GREY = [120, 120, 118, 255], PAINT_W = [230, 230, 225, 255], PAINT_Y = [205, 160, 25, 255];
const FLAT = 3.2, RAMP = 5, RAISE = 0.15, LIFT = 0.32;
export function levelCrossingGeometry(list, ground) {
  const pos = [], nor = [], col = [], idx = [];
  let n = 0;
  const v3 = (p, q) => {
    pos.push(p[0], p[2], -p[1]);
    nor.push(Math.round(q[0] * 127), Math.round(q[2] * 127), Math.round(-q[1] * 127), 0);
  };
  const quad = (P, q, c) => {
    const [a, b, d] = P, cr = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    if (cr[0] * q[0] + cr[1] * q[1] + cr[2] * q[2] < 0) P = [P[0], P[3], P[2], P[1]];
    for (const p of P) {
      v3(p, q);
      col.push(...c);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  const box = (c, A, Bv, U, a, b, h, color) => {
    const P = (i, j, k) => [0, 1, 2].map((m) => c[m] + A[m] * a * i + Bv[m] * b * j + U[m] * h * k);
    quad([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], U, color);
    for (const [s, ax, o1, o2] of [[1, A, Bv, U], [-1, A, Bv, U]]) {
      void o1;
      void o2;
      const q = ax.map((v) => v * s);
      quad([P(s, -1, -1), P(s, 1, -1), P(s, 1, 1), P(s, -1, 1)], q, color);
    }
    for (const s of [1, -1]) quad([P(-1, s, -1), P(1, s, -1), P(1, s, 1), P(-1, s, 1)], Bv.map((v) => v * s), color);
  };
  const striped = (p0, d, L, w, side) => {
    const m = Math.max(1, Math.round(L / 0.5));
    let B2 = [-d[1], d[0], 0];
    const bl = Math.hypot(...B2);
    B2 = bl > 1e-6 ? B2.map((v) => v / bl) : side;
    const U = [d[1] * B2[2] - d[2] * B2[1], d[2] * B2[0] - d[0] * B2[2], d[0] * B2[1] - d[1] * B2[0]];
    for (let k = 0; k < m; k++) {
      const c = [0, 1, 2].map((i) => p0[i] + d[i] * L * (k + 0.5) / m);
      box(c, d, B2, U, L / m / 2, w, w, k % 2 ? BLK : YEL);
    }
  };
  const UP = [0, 0, 1];
  for (const rec of list) {
    const [x, y, ux, uy, hw, half, type, ...ts] = rec;
    if (type === 2) continue;
    const vx = -uy, vy = ux, U = [ux, uy, 0], V = [vx, vy, 0];
    const hAt = (s) => {
      const lo = Math.min(...ts), hi = Math.max(...ts), d = Math.max(lo - FLAT - s, s - hi - FLAT, 0);
      return d >= RAMP ? 0 : RAISE * (1 - d / RAMP);
    };
    const at = (s, t) => [x + ux * s + vx * t, y + uy * s + vy * t], gz = (s, t) => {
      const p = at(s, t);
      return ground(p[0], p[1]);
    };
    for (const k of [-1, 1]) {
      const tb = k * (hw + 0.7), sb = k * half, pb = at(sb, tb), gb = gz(sb, tb);
      if (type === 0) {
        box([pb[0], pb[1], gb + 0.5], U, V, UP, 0.25, 0.2, 0.5, GREY);
        const ang = 80 * Math.PI / 180, d = [-k * vx * Math.cos(ang), -k * vy * Math.cos(ang), Math.sin(ang)];
        striped([pb[0], pb[1], gb + 1], d, Math.max(3, 2 * hw), 0.06, U);
      }
      const sw = k * (half + 0.9), pw = at(sw, tb), gw = gz(sw, tb);
      striped([pw[0], pw[1], gw], UP, 3.6, 0.08, U);
      const top = gw + 3.3;
      for (const r of [1, -1]) {
        const a = Math.PI / 4.5 * r, dd = [vx * Math.cos(a), vy * Math.cos(a), Math.sin(a)], N2 = [ux, uy, 0], B3 = [dd[1] * N2[2] - dd[2] * N2[1], dd[2] * N2[0] - dd[0] * N2[2], dd[0] * N2[1] - dd[1] * N2[0]];
        box([pw[0] - ux * k * 0.1, pw[1] - uy * k * 0.1, top], dd, N2, B3, 0.65, 0.03, 0.09, WHITE);
      }
      if (type === 0) for (const r of [-1, 1]) {
        const q = [pw[0] + vx * r * 0.38 - ux * k * 0.12, pw[1] + vy * r * 0.38 - uy * k * 0.12];
        box([q[0], q[1], gw + 2.55], U, V, UP, 0.06, 0.14, 0.14, RED);
      }
      const ss = k * (half + 2.2), zl = (s) => LIFT + hAt(s);
      {
        const a = at(ss - 0.2, 0), b = at(ss + 0.2, 0), c = at(ss + 0.2, tb > 0 ? hw : -hw), d = at(ss - 0.2, tb > 0 ? hw : -hw);
        quad([a, b, c, d].map((p) => [p[0], p[1], ground(p[0], p[1]) + zl(ss)]), UP, PAINT_W);
      }
    }
    if (type === 0) {
      const S0 = -half + 0.4, S1 = half - 0.4, G = 2.5, W2 = 0.1;
      for (const dir of [1, -1]) for (let o = -2 * half - 2 * hw; o <= 2 * half + 2 * hw; o += G) {
        for (let t = -hw + 0.2; t < hw - 0.2; t += 0.5) {
          const t1 = Math.min(hw - 0.2, t + 0.5), s0 = o + dir * t, s1 = o + dir * t1, sm = (s0 + s1) / 2;
          if (Math.min(s0, s1) < S0 || Math.max(s0, s1) > S1 || ts.some((v) => Math.abs(sm - v) < 1.8)) continue;
          const nx = W2 / Math.SQRT2, P = [[s0 - nx, t], [s1 - nx, t1], [s1 + nx, t1], [s0 + nx, t]].map(([s, tt]) => {
            const p = at(s, tt);
            return [p[0], p[1], ground(p[0], p[1]) + LIFT + hAt(s)];
          });
          quad(P, UP, PAINT_Y);
        }
      }
    }
  }
  return { n, pos: new Float32Array(pos), nor: new Int8Array(nor), col: new Uint8Array(col), idx: n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx) };
}
export const levelCrossingMaterial = (THREE) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
