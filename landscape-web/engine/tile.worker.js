import * as THREE from "./vendor/three.module.js";
import { decodeTerrain, buildGrid, gridAt, rtinErrors, rtinMesh, toleranceField, borderForce, decodeErrLevels, FINE_N, FINE_STEP, LOD_SCALE, TILE_M } from "./shared/terrain.mjs";
import { buildDetailed } from "./buildings.worker.js";
import { deckOf, sheetRoofOf, vhash } from "./shared/tw-variety.mjs";
import { orientedBox, hash, wpick } from "./kit-building-appearance.js";
import { aeroDropBuildings } from "./integration/airports-worker.js";
import { seed, rnd } from "./kit-city-atlas.js";
import { VSHA, JSON_INIT, fetchV } from "./shared/fetch-v.mjs";
import { edgeRuns, edgeKeep, keepSpans } from "./shared/deck-lines.mjs";
const cache = /* @__PURE__ */ new Map(), KEEP = 24;
let shopIndex;
const shopIndexOf = (url) => shopIndex ??= fetch(url.replace(/[^/]+\/$/, "") + "shopfronts-index.json", JSON_INIT).then((r) => r.ok ? r.json() : null).then((j) => j?.tiles ? new Set(j.tiles) : null).catch(() => null);
const shopFp = (bj) => `${bj.length}:${bj.reduce((s, b) => s + (b.rings?.[0]?.length || 0), 0)}:${bj[0]?.id || ""}:${bj[bj.length - 1]?.id || ""}`;
async function shopfrontsOf(url) {
  const idx = await shopIndexOf(url), id = url.match(/([^/]+)\/$/)?.[1];
  if (!idx || !idx.has(id)) return null;
  try {
    const r = await fetch(url + "shopfronts.json", JSON_INIT);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function tileData(url, ph = null, vf = {}, rn = 0) {
  const key = url + vf["terrain.bin"]?.v;
  let t = cache.get(key);
  if (t) {
    cache.delete(key);
    cache.set(key, t);
    return t;
  }
  const f0 = performance.now(), [tb, bj, sf] = await Promise.all([fetchV(url + "terrain.bin", vf["terrain.bin"], rn, ph), fetch(url + "buildings.json", JSON_INIT).then((r) => r.json()), shopfrontsOf(url)]);
  if (ph) ph.fetch = (ph.fetch || 0) + performance.now() - f0;
  t = { terrain: new Uint8Array(tb), buildings: bj, shopfronts: sf && sf.fp === shopFp(bj) && sf.b && sf.x ? sf : null };
  await aeroDropBuildings(url, bj);
  cache.set(key, t);
  if (cache.size > KEEP) cache.delete(cache.keys().next().value);
  return t;
}
const i8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
function terrainMesh(h, n, step, err, threshold, skirt, nd) {
  const { verts, indices } = rtinMesh(err, n, threshold), nv = verts.length, edge = [[], [], [], []];
  for (let i = 0; i < nv; i++) {
    const g = verts[i], x = g % n, y = (g - x) / n;
    if (y === 0) edge[0].push(i);
    if (y === n - 1) edge[1].push(i);
    if (x === 0) edge[2].push(i);
    if (x === n - 1) edge[3].push(i);
  }
  const extra = edge.reduce((s, e) => s + e.length, 0), pos = new Float32Array((nv + extra) * 3), nor = new Int8Array((nv + extra) * 4), idx = new (nv + extra > 65535 ? Uint32Array : Uint16Array)(indices.length + (extra - 4) * 6);
  const H = (x, y) => h[Math.max(0, Math.min(n - 1, y)) * n + Math.max(0, Math.min(n - 1, x))];
  for (let i = 0; i < nv; i++) {
    const g = verts[i], x = g % n, y = (g - x) / n, x0 = Math.max(0, x - nd), x1 = Math.min(n - 1, x + nd), y0 = Math.max(0, y - nd), y1 = Math.min(n - 1, y + nd);
    const hx = (H(x1, y) - H(x0, y)) / ((x1 - x0) * step), hy = (H(x, y1) - H(x, y0)) / ((y1 - y0) * step), l = Math.hypot(hx, hy, 1);
    pos[i * 3] = x * step;
    pos[i * 3 + 1] = h[g];
    pos[i * 3 + 2] = -y * step;
    nor[i * 4] = i8(-hx / l);
    nor[i * 4 + 1] = i8(1 / l);
    nor[i * 4 + 2] = i8(hy / l);
  }
  for (let t2 = 0; t2 < indices.length; t2 += 3) {
    const a = indices[t2], b = indices[t2 + 1], c = indices[t2 + 2], ax = pos[a * 3], az = pos[a * 3 + 2], cross = (pos[b * 3] - ax) * -(pos[c * 3 + 2] - az) - (pos[c * 3] - ax) * -(pos[b * 3 + 2] - az);
    idx[t2] = a;
    if (cross >= 0) {
      idx[t2 + 1] = b;
      idx[t2 + 2] = c;
    } else {
      idx[t2 + 1] = c;
      idx[t2 + 2] = b;
    }
  }
  let v = nv, t = indices.length;
  edge.forEach((list, side) => {
    const key = side < 2 ? (i) => pos[i * 3] : (i) => -pos[i * 3 + 2];
    list.sort((a, b) => key(a) - key(b));
    const flip = side === 1 || side === 2;
    list.forEach((i, k) => {
      pos[v * 3] = pos[i * 3];
      pos[v * 3 + 1] = pos[i * 3 + 1] - skirt;
      pos[v * 3 + 2] = pos[i * 3 + 2];
      nor[v * 4] = nor[i * 4];
      nor[v * 4 + 1] = nor[i * 4 + 1];
      nor[v * 4 + 2] = nor[i * 4 + 2];
      if (k > 0) {
        const a = list[k - 1], b = i, c = v, d = v - 1;
        if (flip) {
          idx[t++] = a;
          idx[t++] = b;
          idx[t++] = c;
          idx[t++] = a;
          idx[t++] = c;
          idx[t++] = d;
        } else {
          idx[t++] = a;
          idx[t++] = c;
          idx[t++] = b;
          idx[t++] = a;
          idx[t++] = d;
          idx[t++] = c;
        }
      }
      v++;
    });
  });
  return { pos, nor, idx, tris: indices.length / 3, verts: nv };
}
function innerSkirts(mesh, h, n, step, skirt) {
  const g = (n - 1) / 4, lines = [];
  for (let c = 1; c < 4; c++) for (const side of [-0.5, 0.5]) {
    lines.push({ x: c * g, side });
    lines.push({ y: c * g, side });
  }
  const nv0 = mesh.pos.length / 3, add = lines.length * n * 2, pos = new Float32Array((nv0 + add) * 3), nor = new Int8Array((nv0 + add) * 4), nIdx = mesh.idx.length + lines.length * (n - 1) * 6, idx = new (nv0 + add > 65535 ? Uint32Array : Uint16Array)(nIdx);
  pos.set(mesh.pos);
  nor.set(mesh.nor);
  idx.set(mesh.idx);
  let v = nv0, t = mesh.idx.length;
  for (const L of lines) {
    const r = L.x !== void 0 ? L.side < 0 : L.side > 0;
    for (let k = 0; k < n; k++) {
      const x = L.x ?? k, y = L.y ?? k, hh = h[y * n + x], px = x * step + (L.x !== void 0 ? L.side : 0), pz = -(y * step + (L.y !== void 0 ? L.side : 0));
      pos[v * 3] = px;
      pos[v * 3 + 1] = hh;
      pos[v * 3 + 2] = pz;
      pos[v * 3 + 3] = px;
      pos[v * 3 + 4] = hh - skirt;
      pos[v * 3 + 5] = pz;
      nor[v * 4 + 1] = nor[v * 4 + 5] = 127;
      if (k > 0) {
        idx[t++] = v - 2;
        idx[t++] = r ? v + 1 : v;
        idx[t++] = r ? v : v + 1;
        idx[t++] = v - 2;
        idx[t++] = r ? v - 1 : v + 1;
        idx[t++] = r ? v + 1 : v - 1;
      }
      v += 2;
    }
  }
  return { pos, nor, idx, tris: nIdx / 3, verts: mesh.verts };
}
const hexCache = /* @__PURE__ */ new Map(), rgb = (hex) => {
  let c = hexCache.get(hex);
  if (!c) {
    const o = new THREE.Color(hex);
    hexCache.set(hex, c = [o.r, o.g, o.b]);
  }
  return c;
};
function simplifyRing(ring, tol) {
  const n = ring.length;
  if (!(tol > 0) || n <= 4) return ring;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const dp = (a, b) => {
    const A = ring[a], B = ring[b % n], dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1e-9;
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) {
      const P = ring[i % n], d = Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / l;
      if (d > md) {
        md = d;
        m = i;
      }
    }
    if (m >= 0) {
      keep[m % n] = 1;
      dp(a, m);
      dp(m, b);
    }
  };
  dp(0, far);
  dp(far, n);
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : ring;
}
const fr32 = Math.fround, fract32 = (x) => fr32(x - Math.floor(x));
function r3H(px, py) {
  const k = fr32(0.1031), c = fr32(33.33);
  let qx = fract32(fr32(fr32(px) * k)), qy = fract32(fr32(fr32(py) * k)), qz = qx;
  const d = fr32(fr32(fr32(qx * fr32(qy + c)) + fr32(qy * fr32(qz + c))) + fr32(qz * fr32(qx + c)));
  qx = fr32(qx + d);
  qy = fr32(qy + d);
  qz = fr32(qz + d);
  return fract32(fr32(fr32(qx + qy) * qz));
}
const farWin = (b, w) => wpick(w, hash(b.id, "house", 0, "win"));
const farCode = (b) => {
  const t = b.type || "townhouse", F = b.floors || 1;
  if (t === "townhouse") return 0;
  if (t === "apartment") {
    if (F >= 7 && farWin(b, [[2, 2], [3, 2], [6, 3], [14, 2], [10, 1]]) === 10) return 4;
    return F <= 5 ? 1 : F <= 11 ? 2 : 3;
  }
  if (t === "hall") return farWin(b, [[6, 2], [10, 1], [11, 2]]) === 10 ? 4 : 5;
  if (t === "factory" || t === "shed") return 5;
  if (t === "school" || t === "temple" || t === "facility" || b.mark) return 6;
  return 7;
};
const lq = (m) => Math.max(0, Math.min(62, Math.round(Math.log2(Math.max(1, m)) * 9)));
function simpleBuildings(list, groundAt, tol = 0, far = 0) {
  const pos = [], nor = [], col = [], idx = [];
  let n = 0;
  const put = (x, y, z, nx, ny, nz, c, k) => {
    pos.push(x, z, -y);
    nor.push(i8(nx), i8(nz), i8(-ny), 0);
    col.push(Math.round(Math.min(1, c[0] * k) * 255), Math.round(Math.min(1, c[1] * k) * 255), Math.round(Math.min(1, c[2] * k) * 255), 255);
    return n++;
  };
  const putX = (x, y, z, c, k, ex) => {
    const v = put(x, y, z, 0, 0, 1, c, k);
    nor[v * 4] = ex[0];
    nor[v * 4 + 1] = ex[1];
    nor[v * 4 + 2] = ex[2];
    nor[v * 4 + 3] = ex[3];
    col[v * 4 + 3] = ex[4];
    return v;
  };
  for (const b of list) {
    let ring = b.rings[0];
    if (!ring || ring.length < 3) continue;
    if (tol > 0) ring = simplifyRing(ring, tol);
    let a2 = 0, g = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a2 += p[0] * q[1] - q[0] * p[1];
      g = Math.min(g, groundAt(p[0], p[1]));
    }
    if (a2 < 0) ring = [...ring].reverse();
    if (far) {
      farBuilding(b, ring, g, putX, idx, () => n, far);
      continue;
    }
    const top = g + Math.max(3, b.h || 6), wall = rgb(b.wall || "#d0cfca"), roof = b.roof === "flat" ? (b.type === "townhouse" || b.type === "apartment" && b.floors <= 5) && vhash(b.id, "v60", "mid-addon") < (b.addon || 0) ? rgb(deckOf(b.id)).map((v, k) => (v + rgb(sheetRoofOf(b.id))[k]) / 2) : rgb(deckOf(b.id)) : b.roof === "metal" ? rgb(sheetRoofOf(b.id)) : [0.42, 0.2, 0.14];
    const foot = b.type === "canopy" ? top - 0.6 : g - 0.6;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
      if (l < 0.3) continue;
      const nx = dy / l, ny = -dx / l;
      const v0 = put(p[0], p[1], foot, nx, ny, 0, wall, 0.78), v1 = put(q[0], q[1], foot, nx, ny, 0, wall, 0.78), v2 = put(q[0], q[1], top, nx, ny, 0, wall, 0.78), v3 = put(p[0], p[1], top, nx, ny, 0, wall, 0.78);
      idx.push(v0, v1, v2, v0, v2, v3);
    }
    const first = n;
    for (const p of ring) put(p[0], p[1], top, 0, 0, 1, roof, 1);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])) idx.push(first + i, first + j, first + k);
  }
  return { pos: new Float32Array(pos), nor: new Int8Array(nor), col: new Uint8Array(col), idx: n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), n, count: list.length };
}
function farBuilding(b, ring, g, putX, idx, cur, far) {
  const top = g + Math.max(3, b.h || 6), wall = rgb(b.wall || "#d0cfca");
  let roof = b.roof === "flat" ? (b.type === "townhouse" || b.type === "apartment" && b.floors <= 5) && vhash(b.id, "v60", "mid-addon") < (b.addon || 0) ? rgb(deckOf(b.id)).map((v, k) => (v + rgb(sheetRoofOf(b.id))[k]) / 2) : rgb(deckOf(b.id)) : b.roof === "metal" ? rgb(sheetRoofOf(b.id)) : [0.42, 0.2, 0.14];
  const foot = b.type === "canopy" ? top - 0.6 : g - 0.6, obb = orientedBox(b.rings[0]);
  const code = farCode(b), sd8 = Math.floor(vhash(b.id, "v117") * 256), fl = b.type === "canopy" ? 0 : Math.min(120, Math.max(1, b.floors || 1));
  const metal = b.type === "shed" || b.type === "factory" || b.roof === "metal", rt = code <= 1 ? 0 : code <= 4 ? 1 : code <= 6 ? 2 : 3;
  if (far & 2 && b.roof === "flat" && !(b.type === "shed" || b.type === "factory") && obb) {
    const sd = fr32(Math.max(0, Math.min(65535, Math.round(rnd(seed(b.id), 7116) * 65535))) / 65535), m = 0.8 + 0.38 * r3H(fr32(sd * 61), 1), h2 = r3H(fr32(sd * 19), 8) - 0.5;
    roof = [roof[0] * m * (1 + 0.06 * h2), roof[1] * m, roof[2] * m * (1 - 0.08 * h2)];
  }
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    if (l < 0.3) continue;
    const nx = i8(dy / l), nz = i8(dx / l);
    const e0 = [nx, 0, nz, code * 16, sd8], e1 = [nx, fl, nz, code * 16, sd8];
    const v0 = putX(p[0], p[1], foot, wall, 0.78, e0), v1 = putX(q[0], q[1], foot, wall, 0.78, e0), v2 = putX(q[0], q[1], top, wall, 0.78, e1), v3 = putX(p[0], p[1], top, wall, 0.78, e1);
    idx.push(v0, v1, v2, v0, v2, v3);
  }
  const first = cur(), L = obb ? obb.length / 2 : 1, W = obb ? obb.width / 2 : 1, Lc = obb ? lq(L) : 62, Wc = obb ? lq(W) : 62;
  for (const p of ring) {
    let s = 0, t = 0;
    if (obb) {
      const ddx = p[0] - obb.center[0], ddy = p[1] - obb.center[1];
      s = (ddx * obb.u[0] + ddy * obb.u[1]) / Math.max(L, 0.01);
      t = (ddx * obb.v[0] + ddy * obb.v[1]) / Math.max(W, 0.01);
    }
    putX(p[0], p[1], top, roof, 1, [Math.round(Math.max(-1, Math.min(1, s)) * 127), 127, Math.round(Math.max(-1, Math.min(1, t)) * 127), -(1 + Lc + (metal ? 64 : 0)), Wc + 64 * rt]);
  }
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])) idx.push(first + i, first + j, first + k);
}
function roadRibbons(roads, groundAt, lines = 1, farStep = 0, piers = [], deck = 1, pier = 1, sides = 1, flat = 0) {
  const pos = [], nor = [], col = [], idx = [], fidx = [];
  let n = 0;
  const normalAt = (x, y, d = 6) => {
    const hx = (groundAt(x + d, y) - groundAt(x - d, y)) / (2 * d), hy = (groundAt(x, y + d) - groundAt(x, y - d)) / (2 * d), l = Math.hypot(hx, hy, 1);
    return [-hx / l, 1 / l, hy / l];
  };
  const add = (pts, width, lift, color, offset = 0, surf = false, side = false, edge = 0, cut = null) => {
    const P = [], keep = [], wAt = (a, b, f) => a[3] > 0 ? a[3] + ((b[3] > 0 ? b[3] : a[3]) - a[3]) * f : 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let k = 0; k < m; k++) {
        keep.push(k === 0);
        P.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m, deck ? (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * k / m : 0, deck ? wAt(a, b, k / m) : 0]);
      }
    }
    P.push([pts.at(-1)[0], pts.at(-1)[1], deck ? pts.at(-1)[2] || 0 : 0, deck ? wAt(pts.at(-1), pts.at(-1), 0) : 0]);
    keep.push(true);
    const c = color.map((v) => Math.round(v * 255)), vi = [];
    const sP = side && cut ? [] : null;
    if (sP) {
      let sa = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L / 10));
        for (let k = 0; k < m; k++) sP.push(sa + L * k / m);
        sa += L;
      }
      sP.push(sa);
    }
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const nx = -dy, ny = dx, q = normalAt(P[i][0], P[i][1]);
      vi.push(n);
      const wd = surf && P[i][3] > 0 ? P[i][3] : width, of = edge && P[i][3] > 0 ? edge * (P[i][3] / 2 - 0.35) : offset;
      for (const s of [1, -1]) {
        const x = P[i][0] + nx * (of + s * wd / 2), y = P[i][1] + ny * (of + s * wd / 2);
        const up = P[i][2] > 0.3;
        pos.push(x, groundAt(x, y) + lift + P[i][2], -y);
        nor.push(up ? 0 : i8(q[0]), up ? 127 : i8(q[1]), up ? 0 : i8(q[2]), 0);
        col.push(c[0], c[1], c[2], 255);
      }
      if (i > 0) {
        const pv = vi[i - 1];
        idx.push(pv, pv + 1, n + 1, pv, n + 1, n);
      }
      n += 2;
      if (side && i > 0 && (P[i][2] > 0.3 || P[i - 1][2] > 0.3)) for (const s of [1, -1]) {
        const A = [P[i - 1], P[i]].map((p, j) => {
          const ww = p[3] > 0 ? p[3] : width, x = p[0] + nx * s * ww / 2, y = p[1] + ny * s * ww / 2, top = groundAt(x, y) + lift + p[2];
          return [x, y, top];
        });
        const at = (f) => [A[0][0] + (A[1][0] - A[0][0]) * f, A[0][1] + (A[1][1] - A[0][1]) * f, A[0][2] + (A[1][2] - A[0][2]) * f];
        for (const [f0, f1] of keepSpans(cut && cut[s], sP?.[i - 1], sP?.[i])) {
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
    const toneF = (c) => R(c) <= 1 ? [0.24, 0.23, 0.21] : [0.095, 0.096, 0.1], sorted = [...roads].filter((r) => flat < 2 || R(r.cls) >= 2 && r.cls !== "service").sort((a, b) => R(a.cls) - R(b.cls));
    const merged = flat !== 3 ? sorted : (() => {
      const segs = [];
      for (const r of sorted) if (R(r.cls) >= 5) for (let i = 0; i < r.pts.length - 1; i++) segs.push([r, r.pts[i], r.pts[i + 1]]);
      return sorted.map((r) => {
        if (R(r.cls) < 5) return r;
        const out = [];
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, m = Math.max(1, Math.ceil(L / 10));
          for (let k = 0; k <= m; k++) {
            if (k === m && i < r.pts.length - 2) continue;
            const x = a[0] + (b[0] - a[0]) * k / m, y = a[1] + (b[1] - a[1]) * k / m;
            let best = 0;
            for (const [o, p, q] of segs) {
              if (o === r) continue;
              const sx = q[0] - p[0], sy = q[1] - p[1], sl = Math.hypot(sx, sy) || 1;
              if (Math.abs((sx * tx + sy * ty) / sl) < 0.94) continue;
              const u = ((x - p[0]) * sx + (y - p[1]) * sy) / (sl * sl);
              if (u < -0.05 || u > 1.05) continue;
              const lat = (x - p[0] - sx * u) * -ty + (y - p[1] - sy * u) * tx;
              if (Math.abs(lat) >= 4 && Math.abs(lat) <= 30 && (!best || Math.abs(lat) < Math.abs(best))) best = lat;
            }
            const d = -best / 2;
            out.push([x - ty * d, y + tx * d, 0, best ? r.w + Math.abs(best) : 0]);
          }
        }
        return { ...r, pts: out };
      });
    })();
    for (const r of merged) add(r.pts, r.w, 0.3, toneF(r.cls), 0, true, false);
    if ((flat === 1 || flat === 3) && lines) {
      for (const r of merged) if (R(r.cls) >= 4 && r.w >= 8) add(r.pts, 0.3, 0.3, [0.78, 0.58, 0.08]);
    }
  } else
    for (const r of [...roads].sort((a, b) => R(a.cls) - R(b.cls))) {
      const k = R(r.cls);
      add(r.pts, r.w, 0.1 + k * 0.012, tone(r.cls), 0, true, !!sides && !PED.test(r.cls), 0, r.edgeSkip ? { 1: edgeKeep(r, 1), "-1": edgeKeep(r, -1) } : null);
      if (k >= 4 && lines) {
        add(r.pts, 0.28, 0.24, [0.78, 0.58, 0.08]);
        if (k >= 5) for (const o of [-1, 1]) for (const q of edgeRuns(r, o)) add(q, 0.16, 0.24, [0.8, 0.8, 0.78], o * (r.w / 2 - 0.35), false, false, o);
      }
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
const buffers = (o) => {
  const out = [];
  const walk = (v) => {
    if (ArrayBuffer.isView(v)) out.push(v.buffer);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(o);
  return [...new Set(out)];
};
const jobs = {
  // ph（第 24 包）：這個工作各階段的毫秒（fetch＝抓檔、grid＝解碼與還原高度格、err＝誤差場、mesh＝抽稀成三角網、simple／build／roads＝建物與道路）
  // skip（第 24 包，量測用）：這幾種風格的建物不畫（例如 'hillside,villa'＝山邊建物不畫）；沒給就全畫
  // rtin（第 24 包）：圖磚有烘好的誤差場分級（rtin.bin，版本 9）就直接讀，不在手機上算（A54 一格約 0.2 秒、二十幾格排隊，開頁慢 4 秒）；沒有就照舊算。
  async base({ url, lo = 0, skip = "", mid = false, rtin = false, far = 0, vf, rn = 0 }) {
    const ph = {}, T = (k, f) => {
      const s = performance.now(), r = f();
      ph[k] = (ph[k] || 0) + performance.now() - s;
      return r;
    };
    const t0 = performance.now(), t = await tileData(url, ph, vf, rn);
    const grid = T("grid", () => buildGrid(decodeTerrain(t.terrain))), err = rtin && !mid ? await errFile(url, ph, vf["rtin.bin"], rn) : T("err", () => rtinErrors(grid.h, FINE_N, toleranceField(grid), borderForce(grid), mid)), groundAt = (x, y) => gridAt(grid, x, y);
    const lods = T("mesh", () => [terrainMesh(grid.h, FINE_N, FINE_STEP, err, LOD_SCALE[0], 30, 4), terrainMesh(grid.h, FINE_N, FINE_STEP, err, LOD_SCALE[1], 40, 4)]), bl = keepStyles(t.buildings, skip);
    const simple = T("simple", () => simpleBuildings(bl, groundAt, 0, far)), simpleLo = lo > 0 ? T("simple", () => simpleBuildings(bl, groundAt, lo, far)) : null;
    return { lods, simple, simpleLo, h: grid.h, ms: performance.now() - t0, ph };
  },
  async near({ url, chunk = 2, skip = "", lines = 1, farStep = 0, inner = 0, deck = 1, pier = 1, side = 1, rdMode = 0, fx3 = 0, vf, rn = 0 }) {
    const ph = {}, T = (k, f) => {
      const s = performance.now(), r = f();
      ph[k] = (ph[k] || 0) + performance.now() - s;
      return r;
    };
    const t0 = performance.now(), t = await tileData(url, ph, vf, rn), f0 = performance.now(), roads = await fetch(url + "roads.json", JSON_INIT).then((r) => r.json());
    ph.fetch = (ph.fetch || 0) + performance.now() - f0;
    const grid = T("grid", () => buildGrid(decodeTerrain(t.terrain))), groundAt = (x, y) => gridAt(grid, x, y);
    t.roads = roads.context;
    const built = T("build", () => buildDetailed({ buildings: keepStyles(t.buildings, skip), roads: roads.context, groundAt, chunkSize: TILE_M / Math.max(1, chunk || 2), mode: 1, inner, shopfronts: t.shopfronts, fx3 }));
    if (rdMode > 0) {
      const up = (r) => r.pts.some((p) => p[2] > 0.3), flatRoads = roads.roads.filter((r) => !up(r));
      return { buildings: built, roads: T("roads", () => roadRibbons(roads.roads.filter(up), groundAt, lines, farStep, roads.piers || [], deck, pier, side)), flat: T("roads", () => roadRibbons(flatRoads, groundAt, lines, 0, [], rdMode === 3 ? 1 : 0, 0, 0, rdMode)), h: grid.h, ms: performance.now() - t0, ph };
    }
    return { buildings: built, roads: T("roads", () => roadRibbons(roads.roads, groundAt, lines, farStep, roads.piers || [], deck, pier, side)), h: grid.h, ms: performance.now() - t0, ph };
  },
  async extras({ url, cx, cy, r, chunk = 2, skip = "", vf }) {
    const t = await tileData(url, null, vf);
    if (!t.roads) t.roads = (await fetch(url + "roads.json", JSON_INIT).then((x) => x.json())).context;
    const grid = buildGrid(decodeTerrain(t.terrain));
    return buildDetailed({
      buildings: keepStyles(t.buildings, skip),
      roads: t.roads,
      groundAt: (x, y) => gridAt(grid, x, y),
      chunkSize: chunk > 2 ? TILE_M / chunk : 1e9,
      mode: 2,
      shopfronts: t.shopfronts,
      // 第六包 chunk＞2 時細節也切塊（預設一格一塊）
      only: (x, y) => Math.hypot(x - cx, y - cy) <= r
    });
  },
  // 第 137 包：tol／skirt 給較粗的層級用（沒給＝原本的 2.5 m、120 m）；cells＝1 時塊的四邊與 4×4 格線上的頂點一律保留、格線兩側各多一圈內裙邊（innerSkirts）
  async far({ url, n, step, tol = 2.5, skirt = 120, cells = 0, vf, rn = 0 }) {
    const ph = {}, T = (k, f) => {
      const s = performance.now(), r = f();
      ph[k] = (ph[k] || 0) + performance.now() - s;
      return r;
    };
    const f0 = performance.now(), h = new Float32Array(await fetchV(url + "terrain.bin", vf["terrain.bin"], rn, ph));
    ph.fetch = performance.now() - f0;
    const g = (n - 1) / 4, force = cells ? new Uint8Array(n * n).map((_, i) => i % n % g === 0 || Math.floor(i / n) % g === 0 ? 1 : 0) : null, err = T("err", () => rtinErrors(h, n, null, force));
    const mesh = T("mesh", () => terrainMesh(h, n, step, err, tol, skirt, 1));
    return { mesh: cells ? innerSkirts(mesh, h, n, step, skirt) : mesh, h, ph };
  }
};
async function errFile(url, ph, spec, rn = 0) {
  const f0 = performance.now(), b = await fetchV(url + "rtin.bin", spec, rn, ph);
  ph.fetch = (ph.fetch || 0) + performance.now() - f0;
  const s = performance.now(), e = decodeErrLevels(b, FINE_N);
  ph.err = (ph.err || 0) + performance.now() - s;
  return e;
}
const skipCache = /* @__PURE__ */ new WeakMap(), keepStyles = (list, skip) => {
  if (!skip) return list;
  let m = skipCache.get(list);
  if (!m) skipCache.set(list, m = /* @__PURE__ */ new Map());
  let r = m.get(skip);
  if (!r) {
    const s = new Set(skip.split(","));
    m.set(skip, r = list.filter((b) => !s.has(b.style)));
  }
  return r;
};
self.onmessage = async ({ data }) => {
  if ("vsha" in data) VSHA.on = !!data.vsha;
  try {
    const w0 = performance.timeOrigin + performance.now(), result = await jobs[data.type](data);
    result.wt = [w0, performance.timeOrigin + performance.now()];
    self.postMessage({ id: data.id, result }, buffers(result));
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e?.stack || e) });
  }
};
