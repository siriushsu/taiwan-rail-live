export const TILE_M = 1280, COARSE_N = 65, COARSE_STEP = 20, FINE_N = 513, FINE_STEP = 2.5, BLOCK_CELLS = 16, BLOCKS = 32, BLOCK_VERTS = 17;
export const TOL_TIGHT = 0.05, TOL_LOOSE = 0.35, LOD_SCALE = [1, 4, 12];
export function encodeTerrain(coarse, blocks) {
  const per = 4 + BLOCK_VERTS * BLOCK_VERTS * 3, buf = new ArrayBuffer(8 + COARSE_N * COARSE_N * 4 + blocks.size * per), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set([82, 84, 84, 49]);
  dv.setUint16(4, blocks.size, true);
  let o = 8;
  for (let i = 0; i < COARSE_N * COARSE_N; i++, o += 4) dv.setFloat32(o, coarse[i], true);
  for (const [index, b] of [...blocks].sort((a, c) => a[0] - c[0])) {
    dv.setUint16(o, index, true);
    o += 4;
    for (let i = 0; i < 289; i++, o += 2) dv.setInt16(o, b.delta[i], true);
    u8.set(b.tight, o);
    o += 289;
  }
  return u8;
}
export function decodeTerrain(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "RTT1") throw Error("terrain.bin 格式不對");
  const n = dv.getUint16(4, true), coarse = new Float32Array(COARSE_N * COARSE_N), blocks = /* @__PURE__ */ new Map();
  let o = 8;
  for (let i = 0; i < coarse.length; i++, o += 4) coarse[i] = dv.getFloat32(o, true);
  for (let b = 0; b < n; b++) {
    const index = dv.getUint16(o, true);
    o += 4;
    const delta = new Int16Array(289);
    for (let i = 0; i < 289; i++, o += 2) delta[i] = dv.getInt16(o, true);
    const tight = u8.slice(o, o + 289);
    o += 289;
    blocks.set(index, { delta, tight });
  }
  return { coarse, blocks };
}
export function coarseAt(coarse, x, y) {
  const u = Math.max(0, Math.min(COARSE_N - 1 - 1e-9, x / COARSE_STEP)), v = Math.max(0, Math.min(COARSE_N - 1 - 1e-9, y / COARSE_STEP)), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * COARSE_N + i;
  return (coarse[k] * (1 - a) + coarse[k + 1] * a) * (1 - b) + (coarse[k + COARSE_N] * (1 - a) + coarse[k + COARSE_N + 1] * a) * b;
}
export function buildGrid({ coarse, blocks }) {
  const h = new Float32Array(FINE_N * FINE_N), tight = new Uint8Array(FINE_N * FINE_N), mod = new Uint8Array(FINE_N * FINE_N), R = COARSE_STEP / FINE_STEP;
  for (let j = 0; j < FINE_N; j++) {
    const cj = Math.min(COARSE_N - 2, Math.floor(j / R)), b = j / R - cj;
    for (let i = 0; i < FINE_N; i++) {
      const ci = Math.min(COARSE_N - 2, Math.floor(i / R)), a = i / R - ci, k = cj * COARSE_N + ci;
      h[j * FINE_N + i] = (coarse[k] * (1 - a) + coarse[k + 1] * a) * (1 - b) + (coarse[k + COARSE_N] * (1 - a) + coarse[k + COARSE_N + 1] * a) * b;
    }
  }
  for (const [index, blk] of blocks) {
    const bi = index % BLOCKS, bj = Math.floor(index / BLOCKS);
    for (let v = 0; v < BLOCK_VERTS; v++) for (let u = 0; u < BLOCK_VERTS; u++) {
      const g = (bj * BLOCK_CELLS + v) * FINE_N + bi * BLOCK_CELLS + u, q = v * BLOCK_VERTS + u;
      if (blk.delta[q]) {
        if (!mod[g]) h[g] += blk.delta[q] / 100;
        mod[g] = 1;
      }
      if (blk.tight[q]) {
        tight[g] = 1;
        mod[g] = 1;
      }
    }
  }
  return { h, tight, mod, n: FINE_N, step: FINE_STEP };
}
export function gridAt(grid, x, y) {
  const { h, n, step } = grid, u = Math.max(0, Math.min(n - 1 - 1e-9, x / step)), v = Math.max(0, Math.min(n - 1 - 1e-9, y / step)), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * n + i;
  return (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + n] * (1 - a) + h[k + n + 1] * a) * b;
}
const layouts = /* @__PURE__ */ new Map();
function layout(n) {
  let L = layouts.get(n);
  if (L) return L;
  const size = n - 1, num = size * size * 2 - 2, coords = new Uint16Array(num * 4);
  for (let i = 0; i < num; i++) {
    let id = i + 2, ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
    if (id & 1) bx = by = cx = size;
    else ax = ay = cy = size;
    while ((id >>= 1) > 1) {
      const mx = ax + bx >> 1, my = ay + by >> 1;
      if (id & 1) {
        bx = ax;
        by = ay;
        ax = cx;
        ay = cy;
      } else {
        ax = bx;
        ay = by;
        bx = cx;
        by = cy;
      }
      cx = mx;
      cy = my;
    }
    coords[i * 4] = ax;
    coords[i * 4 + 1] = ay;
    coords[i * 4 + 2] = bx;
    coords[i * 4 + 3] = by;
  }
  layouts.set(n, L = { num, parents: num - size * size, coords });
  return L;
}
export function rtinErrors(h, n, tol = null, force = null, midOnly = false) {
  const { num, parents, coords } = layout(n), err = new Float32Array(n * n);
  if (force) {
    for (let i = 0; i < n * n; i++) if (force[i]) err[i] = Infinity;
  }
  for (let i = num - 1; i >= 0; i--) {
    const k = i * 4, ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3], mx = ax + bx >> 1, my = ay + by >> 1, cx = mx + my - ay, cy = my + ax - mx, m = my * n + mx;
    let e = Math.abs((h[ay * n + ax] + h[by * n + bx]) / 2 - h[m]);
    if (tol) e /= tol[m];
    if (!midOnly && Math.abs(ax - cx) + Math.abs(ay - cy) > 1) {
      const ha = h[ay * n + ax], hb = h[by * n + bx], hc = h[cy * n + cx], d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      for (let y = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy); y <= y1; y++) for (let x = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx); x <= x1; x++) {
        const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
        if (wa < -1e-9 || wb < -1e-9 || wa + wb > 1 + 1e-9) continue;
        const g = y * n + x;
        let q = Math.abs(wa * ha + wb * hb + (1 - wa - wb) * hc - h[g]);
        if (tol) q /= tol[g];
        if (q > e) e = q;
      }
    }
    if (e > err[m]) err[m] = e;
    if (i < parents) {
      const l = err[(ay + cy >> 1) * n + (ax + cx >> 1)], r = err[(by + cy >> 1) * n + (bx + cx >> 1)];
      if (l > err[m]) err[m] = l;
      if (r > err[m]) err[m] = r;
    }
  }
  if (force) {
    const max = n - 1, blocked = new Uint8Array(n * n);
    for (let k = 0; k <= max; k++) for (const g of [k, max * n + k, k * n, k * n + max]) if (err[g] !== Infinity) blocked[g] = 1;
    for (let i = 0; i < parents; i++) {
      const k = i * 4, ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3], mx = ax + bx >> 1, my = ay + by >> 1, cx = mx + my - ay, cy = my + ax - mx;
      if (blocked[my * n + mx]) {
        blocked[(ay + cy >> 1) * n + (ax + cx >> 1)] = 1;
        blocked[(by + cy >> 1) * n + (bx + cx >> 1)] = 1;
      }
    }
    for (let i = 0; i < n * n; i++) if (blocked[i]) err[i] = 0;
  }
  return err;
}
export const ERR_LEVELS = [0, 2, 8, Infinity];
export function encodeErrLevels(err) {
  const [t0, t1, t2] = LOD_SCALE, list = [];
  for (let g = 0; g < err.length; g++) {
    const e = err[g], k = (e > t0) + (e > t1) + (e > t2);
    if (k) list.push(g * 4 + k);
  }
  const buf = new ArrayBuffer(8 + list.length * 4), dv = new DataView(buf);
  new Uint8Array(buf).set([82, 84, 69, 49]);
  dv.setUint32(4, list.length, true);
  for (let i = 0; i < list.length; i++) dv.setUint32(8 + i * 4, list[i], true);
  return new Uint8Array(buf);
}
export function decodeErrLevels(input, n) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "RTE1") throw Error("rtin.bin 格式不對");
  const m = dv.getUint32(4, true), err = new Float32Array(n * n);
  for (let i = 0; i < m; i++) {
    const v = dv.getUint32(8 + i * 4, true);
    err[v >>> 2] = ERR_LEVELS[v & 3];
  }
  return err;
}
export function rtinMesh(err, n, threshold) {
  const max = n - 1, idx = /* @__PURE__ */ new Map(), verts = [], indices = [];
  const vert = (x, y) => {
    const g = y * n + x;
    let i = idx.get(g);
    if (i === void 0) {
      i = verts.length;
      idx.set(g, i);
      verts.push(g);
    }
    return i;
  };
  const stack = [0, 0, max, max, max, 0, max, max, 0, 0, 0, max];
  while (stack.length) {
    const cy = stack.pop(), cx = stack.pop(), by = stack.pop(), bx = stack.pop(), ay = stack.pop(), ax = stack.pop(), mx = ax + bx >> 1, my = ay + by >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && err[my * n + mx] > threshold) {
      stack.push(cx, cy, ax, ay, mx, my, bx, by, cx, cy, mx, my);
    } else indices.push(vert(ax, ay), vert(bx, by), vert(cx, cy));
  }
  return { verts: Uint32Array.from(verts), indices: Uint32Array.from(indices) };
}
export function rtinHeightAt(h, err, n, threshold, gx, gy) {
  const max = n - 1;
  gx = Math.max(0, Math.min(max, gx));
  gy = Math.max(0, Math.min(max, gy));
  let ax, ay, bx, by, cx, cy;
  if (gy <= gx) {
    ax = 0;
    ay = 0;
    bx = max;
    by = max;
    cx = max;
    cy = 0;
  } else {
    ax = max;
    ay = max;
    bx = 0;
    by = 0;
    cx = 0;
    cy = max;
  }
  for (; ; ) {
    const mx = ax + bx >> 1, my = ay + by >> 1;
    if (!(Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && err[my * n + mx] > threshold)) break;
    const side = (mx - cx) * (gy - cy) - (my - cy) * (gx - cx), sideA = (mx - cx) * (ay - cy) - (my - cy) * (ax - cx);
    if (side * sideA >= 0) {
      const nax = cx, nay = cy, nbx = ax, nby = ay;
      ax = nax;
      ay = nay;
      bx = nbx;
      by = nby;
    } else {
      const nax = bx, nay = by, nbx = cx, nby = cy;
      ax = nax;
      ay = nay;
      bx = nbx;
      by = nby;
    }
    cx = mx;
    cy = my;
  }
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy), wa = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d, wb = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d;
  return wa * h[ay * n + ax] + wb * h[by * n + bx] + (1 - wa - wb) * h[cy * n + cx];
}
export function toleranceField(grid) {
  const t = new Float32Array(grid.n * grid.n);
  for (let i = 0; i < t.length; i++) t[i] = grid.tight[i] ? TOL_TIGHT : TOL_LOOSE;
  return t;
}
export function borderForce(grid) {
  const n = grid.n, max = n - 1, R = COARSE_STEP / FINE_STEP, f = new Uint8Array(n * n);
  for (let k = 0; k <= max; k++) for (const g of [k, max * n + k, k * n, k * n + max]) if (k % R === 0 || k <= R || k >= max - R || grid.mod[g]) f[g] = 1;
  return f;
}
