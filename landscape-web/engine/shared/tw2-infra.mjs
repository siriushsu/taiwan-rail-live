const LEVELS = { 3: [[0.62, 0.8], [0.76, 1], [0.9, 0.8]], 2: [[0.72, 1], [0.88, 0.8]] };
const half = (z, h) => z < 0.45 * h ? h * (0.085 - (0.085 - 0.03) * z / (0.45 * h)) : h * (0.03 - (0.03 - 0.018) * Math.min(1, (z - 0.45 * h) / (0.48 * h)));
export function towerLines(out, x, y, zg, az, h, w, lv = 3) {
  const ux = Math.cos(az), uy = Math.sin(az), vx = -uy, vy = ux, n0 = out.length, P = (a, b, z) => [x + a * ux + b * vx, zg + z, -(y + a * uy + b * vy)], seg = (p, q) => out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
  const arms = LEVELS[lv] || LEVELS[3], zs = [0, 0.22 * h, 0.45 * h, ...arms.map((a) => a[0] * h), 0.95 * h], C = (z) => {
    const s = half(z, h);
    return [P(-s, -s, z), P(s, -s, z), P(s, s, z), P(-s, s, z)];
  };
  let A = C(0);
  for (let k = 1; k < zs.length; k++) {
    const B = C(zs[k]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      seg(A[i], B[i]);
      seg(A[i], B[j]);
      seg(A[j], B[i]);
      seg(B[i], B[j]);
    }
    A = B;
  }
  const apex = P(0, 0, h);
  for (const c of A) seg(c, apex);
  for (const [f, r] of arms) {
    const z = f * h, s = half(z, h), dz = 0.05 * h;
    for (const sg of [-1, 1]) {
      const tip = P(0, sg * w * r, z + 0.012 * h);
      for (const a of [-s, s]) {
        seg(P(a, sg * s, z), tip);
        seg(P(a, sg * s, z + dz), tip);
      }
    }
  }
  return (out.length - n0) / 6;
}
export function towerSolid(pos, x, y, zg, az, h, w, lv = 3) {
  const ux = Math.cos(az), uy = Math.sin(az), vx = -uy, vy = ux, n0 = pos.length, P = (a, b, z) => [x + a * ux + b * vx, zg + z, -(y + a * uy + b * vy)], t = Math.max(0.35, h * 0.012);
  const beam = (p, q, tk) => {
    let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const up = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = dy * up[2] - dz * up[1], ay = dz * up[0] - dx * up[2], az_ = dx * up[1] - dy * up[0];
    const al = Math.hypot(ax, ay, az_) || 1;
    ax *= tk / 2 / al;
    ay *= tk / 2 / al;
    az_ *= tk / 2 / al;
    let bx = dy * az_ - dz * ay, by = dz * ax - dx * az_, bz = dx * ay - dy * ax;
    const bl = Math.hypot(bx, by, bz) || 1;
    bx *= tk / 2 / bl;
    by *= tk / 2 / bl;
    bz *= tk / 2 / bl;
    for (const [sx, sy, sz] of [[ax, ay, az_], [bx, by, bz]]) pos.push(p[0] - sx, p[1] - sy, p[2] - sz, p[0] + sx, p[1] + sy, p[2] + sz, q[0] + sx, q[1] + sy, q[2] + sz, p[0] - sx, p[1] - sy, p[2] - sz, q[0] + sx, q[1] + sy, q[2] + sz, q[0] - sx, q[1] - sy, q[2] - sz);
  };
  const arms = LEVELS[lv] || LEVELS[3], zs = [0, 0.22 * h, 0.45 * h, ...arms.map((a) => a[0] * h), 0.95 * h], C = (z) => {
    const s = half(z, h);
    return [P(-s, -s, z), P(s, -s, z), P(s, s, z), P(-s, s, z)];
  };
  let A = C(0);
  for (let k = 1; k < zs.length; k++) {
    const B = C(zs[k]);
    for (let i = 0; i < 4; i++) beam(A[i], B[i], t);
    A = B;
  }
  beam(P(0, 0, 0.95 * h), P(0, 0, h), t);
  for (const [f, r] of arms) {
    const z = f * h;
    for (const sg of [-1, 1]) beam(P(0, sg * half(z, h), z + 0.03 * h), P(0, sg * w * r, z + 0.012 * h), t * 0.8);
  }
  return (pos.length - n0) / 9;
}
export function spanLines(out, s, g0, g1, N = 6) {
  const [x0, y0, az0, h0, w0, x1, y1, az1, h1, w1, lv] = s, L = Math.hypot(x1 - x0, y1 - y0), arms = LEVELS[lv] || LEVELS[3], n0 = out.length;
  let v0 = [-Math.sin(az0), Math.cos(az0)], v1 = [-Math.sin(az1), Math.cos(az1)];
  const dx = (x1 - x0) / (L || 1), dy = (y1 - y0) / (L || 1);
  if (Math.abs(v0[0] * dx + v0[1] * dy) > 0.8) v0 = [-dy, dx];
  if (Math.abs(v1[0] * dx + v1[1] * dy) > 0.8) v1 = [-dy, dx];
  if (v0[0] * -dy + v0[1] * dx < 0) v0 = [-v0[0], -v0[1]];
  if (v1[0] * -dy + v1[1] * dx < 0) v1 = [-v1[0], -v1[1]];
  const wire = (ax, ay, az_, bx, by, bz, sag) => {
    let px = ax, py = ay, pz = az_;
    for (let i = 1; i <= N; i++) {
      const t = i / N, qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t, qz = az_ + (bz - az_) * t - sag * 4 * t * (1 - t);
      out.push(px, pz, -py, qx, qz, -qy);
      px = qx;
      py = qy;
      pz = qz;
    }
  };
  for (const [f, r] of arms) for (const sg of [-1, 1]) {
    const za = h0 * f - 0.035 * h0, zb = h1 * f - 0.035 * h1;
    wire(x0 + v0[0] * sg * w0 * r, y0 + v0[1] * sg * w0 * r, g0 + za, x1 + v1[0] * sg * w1 * r, y1 + v1[1] * sg * w1 * r, g1 + zb, Math.min(L * 0.03, Math.min(za, zb) * 0.4));
  }
  wire(x0, y0, g0 + h0, x1, y1, g1 + h1, L * 0.018);
  return (out.length - n0) / 6;
}
export function turbineMesh(pos, nor, x, y, zg, hub, r, face) {
  const tri = (a, b, c2) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const p of [a, b, c2]) {
      pos.push(p[0], p[1], p[2]);
      nor.push(nx, ny, nz);
    }
  };
  const quad = (a, b, c2, d) => {
    tri(a, b, c2);
    tri(a, c2, d);
  }, rb = hub * 0.032, rt = hub * 0.018, K = 8;
  for (let i = 0; i < K; i++) {
    const a0 = i / K * 6.2832, a1 = (i + 1) / K * 6.2832, B = (a) => [x + Math.cos(a) * rb, zg - 0.5, -(y + Math.sin(a) * rb)], T = (a) => [x + Math.cos(a) * rt, zg + hub, -(y + Math.sin(a) * rt)];
    quad(B(a0), B(a1), T(a1), T(a0));
  }
  const fx = Math.cos(face), fy = Math.sin(face), sx = -fy, sy = fx, ln = r * 0.13, wd = r * 0.05, P = (a, b, z) => [x + a * fx + b * sx, zg + hub + z, -(y + a * fy + b * sy)];
  const c = [[-ln, -wd, -wd], [ln * 0.8, -wd, -wd], [ln * 0.8, wd, -wd], [-ln, wd, -wd], [-ln, -wd, wd], [ln * 0.8, -wd, wd], [ln * 0.8, wd, wd], [-ln, wd, wd]].map((q) => P(q[0], q[1], q[2]));
  quad(c[0], c[3], c[2], c[1]);
  quad(c[4], c[5], c[6], c[7]);
  quad(c[0], c[1], c[5], c[4]);
  quad(c[1], c[2], c[6], c[5]);
  quad(c[2], c[3], c[7], c[6]);
  quad(c[3], c[0], c[4], c[7]);
  return P(ln * 0.8 + r * 0.02, 0, 0);
}
export function rotorGeo() {
  const pos = [], nor = [], tri = (a, b, c) => {
    pos.push(...a, 0, ...b, 0, ...c, 0);
    nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
  };
  for (let k = 0; k < 3; k++) {
    const a = k * 2.0944 + 1.5708, ca = Math.cos(a), sa = Math.sin(a), R = (rad, off) => [ca * rad - sa * off, sa * rad + ca * off];
    tri(R(0.03, -0.04), R(0.22, -0.055), R(0.22, 0.03));
    tri(R(0.03, -0.04), R(0.22, 0.03), R(0.03, 0.035));
    tri(R(0.22, -0.055), R(1, -0.012), R(1, 8e-3));
    tri(R(0.22, -0.055), R(1, 8e-3), R(0.22, 0.03));
  }
  for (let k = 0; k < 6; k++) {
    const a = k * 1.0472, b = (k + 1) * 1.0472;
    tri([0, 0], [Math.cos(a) * 0.05, Math.sin(a) * 0.05], [Math.cos(b) * 0.05, Math.sin(b) * 0.05]);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor) };
}
const ocsBeam = (pos, p, q, tk) => {
  let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const up = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ax = dy * up[2] - dz * up[1], ay = dz * up[0] - dx * up[2], az = dx * up[1] - dy * up[0];
  const al = Math.hypot(ax, ay, az) || 1;
  ax *= tk / 2 / al;
  ay *= tk / 2 / al;
  az *= tk / 2 / al;
  let bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx *= tk / 2 / bl;
  by *= tk / 2 / bl;
  bz *= tk / 2 / bl;
  for (const [sx, sy, sz] of [[ax, ay, az], [bx, by, bz]]) pos.push(p[0] - sx, p[1] - sy, p[2] - sz, p[0] + sx, p[1] + sy, p[2] + sz, q[0] + sx, q[1] + sy, q[2] + sz, p[0] - sx, p[1] - sy, p[2] - sz, q[0] + sx, q[1] + sy, q[2] + sz, q[0] - sx, q[1] - sy, q[2] - sz);
};
export function ocsGeo(tracks, lines, solid, span = 0, opt = null) {
  const wantMain = !opt || !!opt.main, wantLrt = !!opt?.lrt;
  const all = tracks.filter((t) => t.kind !== 2 && t.p.length >= 8), G = 16, grid = /* @__PURE__ */ new Map(), key = (gx, gy) => (gx + 16) * 4096 + gy + 16;
  let poles = 0;
  all.forEach((t, ti) => {
    for (let i = 4; i < t.p.length; i += 4) {
      const ax = t.p[i - 4], ay = t.p[i - 3], bx = t.p[i], by = t.p[i + 1];
      for (let gx = Math.floor((Math.min(ax, bx) - 7) / G); gx <= Math.floor((Math.max(ax, bx) + 7) / G); gx++) for (let gy = Math.floor((Math.min(ay, by) - 7) / G); gy <= Math.floor((Math.max(ay, by) + 7) / G); gy++) {
        const k = key(gx, gy);
        (grid.get(k) || grid.set(k, []).get(k)).push([ti, ax, ay, bx, by]);
      }
    }
  });
  const blocked = (ti, x, y, nx, ny) => {
    for (const [tj, ax, ay, bx, by] of grid.get(key(Math.floor(x / G), Math.floor(y / G))) || []) {
      if (tj === ti) continue;
      const dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))), qx = ax + dx * u - x, qy = ay + dy * u - y;
      if (qx * nx + qy * ny > 0.8 && qx * qx + qy * qy < 42.25) return true;
    }
    return false;
  };
  all.forEach((t, ti) => {
    if (!t.electrified) return;
    const hs = t.system === "thsr_sched", lr = t.system === "ntdlrt" || t.system === "ntalrt";
    if (lr ? !wantLrt : !(wantMain && (hs || t.system === "tra_sched"))) return;
    const SP = span || (hs ? 60 : lr ? 40 : 50), H = hs ? 8 : lr ? 6.7 : 7.3, zc = hs ? 5.3 : lr ? 4.9 : 5.1, zm = zc + (lr ? 1 : 1.4), off = lr ? 2.3 : t.kind === 1 ? 2.35 : 3, SG = lr ? 0.6 : 0.9, p = t.p, sagAt = (s) => {
      const u = s / SP - Math.floor(s / SP);
      return zm - SG * 4 * u * (1 - u);
    };
    for (let i = 4; i < p.length; i += 4) {
      const ax = p[i - 4], ay = p[i - 3], az = p[i - 2], as = p[i - 1], bx = p[i], by = p[i + 1], bz = p[i + 2], bs = p[i + 3], sl = Math.hypot(bx - ax, by - ay), ds = bs - as;
      if (sl < 0.05 || !(Math.abs(ds) > 0.01)) continue;
      const tx = (bx - ax) / sl, ty = (by - ay) / sl, nx = -ty, ny = tx, at = (s) => {
        const u = (s - as) / ds;
        return [ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u];
      }, lo = Math.min(as, bs), hi = Math.max(as, bs), Q = SP / 4;
      lines.push(ax, az + zc, -ay, bx, bz + zc, -by);
      let prev = lo, pp = at(lo);
      for (let k = Math.floor(lo / Q) + 1; ; k++) {
        const s = Math.min(hi, k * Q), q = at(s);
        lines.push(pp[0], pp[2] + sagAt(prev + 1e-6), -pp[1], q[0], q[2] + sagAt(s - 1e-6), -q[1]);
        prev = s;
        pp = q;
        if (s >= hi) break;
      }
      for (let k = Math.floor(lo / SP) + 1; k * SP <= hi; k++) {
        const [x, y, z] = at(k * SP), bl = blocked(ti, x, y, nx, ny), br = blocked(ti, x, y, -nx, -ny);
        if (bl && br) continue;
        const sg = bl ? -1 : 1, X = x + nx * sg * off, Y = y + ny * sg * off, V = (px, py, pz) => [px, pz, -py];
        ocsBeam(solid, V(X, Y, z - 0.6), V(X, Y, z + H), 0.26);
        ocsBeam(solid, V(X, Y, z + zm + 0.25), V(x - nx * sg * 0.2, y - ny * sg * 0.2, z + zm + 0.05), 0.12);
        ocsBeam(solid, V(X, Y, z + zc + 0.15), V(x + nx * sg * 0.25, y + ny * sg * 0.25, z + zc + 0.12), 0.09);
        lines.push(X, z + zc + 0.15, -Y, x, z + zm + 0.05, -y);
        poles++;
      }
    }
  });
  return poles;
}
