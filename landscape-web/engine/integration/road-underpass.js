const PARAPET = 1, PT = 0.3, CAP = 7.2, ASPHALT = [22, 22, 23, 255];
export function roadUnderpassGeometry(rails) {
  const mk = () => ({ pos: [], nor: [], col: [], idx: [], n: 0 }), W = mk(), C = mk(), D = mk();
  const quad = (o, pts, q, col) => {
    const [a, b, c] = pts, cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (cr[0] * q[0] + cr[1] * q[1] + cr[2] * q[2] < 0) pts = [pts[0], pts[3], pts[2], pts[1]];
    for (const p of pts) {
      o.pos.push(p[0], p[2], -p[1]);
      o.nor.push(Math.round(q[0] * 127), Math.round(q[2] * 127), Math.round(-q[1] * 127), 0);
      if (col) o.col.push(...col);
    }
    o.idx.push(o.n, o.n + 1, o.n + 2, o.n, o.n + 2, o.n + 3);
    o.n += 4;
  };
  for (const [x0, y0, x1, y1, b0, b1, t0, t1, nx, ny, kind] of rails.roadWalls || []) {
    const P0 = t0 + PARAPET, P1 = t1 + PARAPET, ox = nx * PT, oy = ny * PT;
    quad(W, [[x0, y0, b0 - 0.1], [x1, y1, b1 - 0.1], [x1, y1, P1], [x0, y0, P0]], [-nx, -ny, 0]);
    quad(W, [[x0, y0, P0], [x1, y1, P1], [x1 + ox, y1 + oy, P1], [x0 + ox, y0 + oy, P0]], [0, 0, 1]);
    quad(W, [[x0 + ox, y0 + oy, t0], [x1 + ox, y1 + oy, t1], [x1 + ox, y1 + oy, P1], [x0 + ox, y0 + oy, P0]], [nx, ny, 0]);
    const cap = [[x0 + ox, y0 + oy, t0 + 0.05], [x1 + ox, y1 + oy, t1 + 0.05], [x1 + nx * CAP, y1 + ny * CAP, t1 + 0.05], [x0 + nx * CAP, y0 + ny * CAP, t0 + 0.05]];
    if (kind === 1) quad(W, cap, [0, 0, 1]);
    else quad(C, cap, [0, 0, 1], ASPHALT);
  }
  for (const [x, y, tx, ty, w, z, clear] of rails.roadPortals || []) {
    const ux = -ty, uy = tx, z0 = z - 0.3, z1 = z + clear + 0.6;
    quad(D, [[x - ux * w, y - uy * w, z0], [x + ux * w, y + uy * w, z0], [x + ux * w, y + uy * w, z1], [x - ux * w, y - uy * w, z1]], [-tx, -ty, 0]);
  }
  const out = (o) => ({ n: o.n, pos: new Float32Array(o.pos), nor: new Int8Array(o.nor), ...o.col.length ? { col: new Uint8Array(o.col) } : {}, idx: o.n > 65535 ? Uint32Array.from(o.idx) : Uint16Array.from(o.idx) });
  return { wall: out(W), cap: out(C), dark: out(D) };
}
export const roadPortalMaterial = (THREE) => new THREE.MeshBasicMaterial({ color: 855311, side: THREE.DoubleSide });
