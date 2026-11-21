import * as THREE from "./vendor/three.module.js";
import { decodeTerrain, buildGrid, gridAt, rtinErrors, rtinMesh, toleranceField, borderForce, decodeErrLevels, FINE_N, FINE_STEP, LOD_SCALE, TILE_M } from "./shared/terrain.mjs";
import { buildDetailed } from "./buildings.worker.js";
import { deckOf, sheetRoofOf, vhash } from "./shared/tw-variety.mjs";
import { orientedBox, hash, wpick, LANDMARKS } from "./kit-building-appearance.js";
import { aeroDropBuildings } from "./integration/airports-worker.js";
import { seed, rnd } from "./kit-city-atlas.js";
import { VSHA, fetchV, jget } from "./shared/fetch-v.mjs";
import { placeDetail, tunnelDetail, applyPlaceBuildings, fieldMesh, templeMesh, reviewedTempleMeshes } from "../places.mjs";
import { surfaceRoads } from "../tunnel-roads.mjs";
import { roadRibbons } from "../road-ribbons.mjs";
import { fixLandmarks } from "../landmark-fix.mjs";
import { TW2 } from "./shared/tw2.mjs";
import { roadMarks } from "./shared/road-marks.mjs";
import { findJunctions } from "./shared/road-marks.mjs";
import { roadTrees } from "./shared/road-trees.mjs";
import { buildingIndex, signals, motoRows } from "./shared/street-objects.mjs";
import { tileLamps } from "./shared/night-city.mjs";
import { tw2Building, templeRoofHex, tw2Parts } from "./shared/tw2-temple.mjs";
import { roofPlan, shedPlan, shedHex, makeFits } from "./shared/tw2-roof.mjs";
import { inClear } from "./shared/tw2-bridge.mjs";
const cache = /* @__PURE__ */ new Map(), KEEP = 24;
let shopIndex;
const shopIndexOf = (url, v) => shopIndex ??= jget(url.replace(/[^/]+\/$/, "") + "shopfronts-index.json", v).then((r) => r.ok ? r.json() : null).then((j) => j?.tiles ? new Set(j.tiles) : null).catch(() => null);
const shopFp = (bj) => `${bj.length}:${bj.reduce((s, b) => s + (b.rings?.[0]?.length || 0), 0)}:${bj[0]?.id || ""}:${bj[bj.length - 1]?.id || ""}`;
async function shopfrontsOf(url, vf = {}) {
  const idx = await shopIndexOf(url, vf.ri?.["shopfronts-index.json"]), id = url.match(/([^/]+)\/$/)?.[1];
  if (!idx || !idx.has(id)) return null;
  try {
    const r = await jget(url + "shopfronts.json", vf.j);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
let tw2BridgeIx;
async function tw2BridgeData(url, roads, vf = {}) {
  const ix = await (tw2BridgeIx ??= jget(url.replace(/[^/]+\/$/, "") + "bridges-index.json", vf.ri?.["bridges-index.json"]).then((r) => r.ok ? r.json() : null).catch(() => null)), tid = (url.match(/([^/]+)\/$/) || [])[1];
  if (!ix?.tiles?.[tid]) return null;
  const d = await jget(url + "bridges.json", vf.j).then((r) => r.ok ? r.json() : null).catch(() => null);
  return d && d.fp?.[0] === roads.roads.length && d.fp?.[1] === (roads.piers || []).length ? d : null;
}
async function tileData(url, ph = null, vf = {}, rn = 0) {
  const key = url + vf["terrain.bin"]?.v;
  let t = cache.get(key);
  if (t) {
    cache.delete(key);
    cache.set(key, t);
    return t;
  }
  const f0 = performance.now(), [tb, bj, sf, detail] = await Promise.all([fetchV(url + "terrain.bin", vf["terrain.bin"], rn, ph), jget(url + "buildings.json", vf.j).then((r) => r.json()), shopfrontsOf(url, vf), placeDetail(url)]);
  if (ph) ph.fetch = (ph.fetch || 0) + performance.now() - f0;
  const fp0 = shopFp(bj);
  if (TW2.temple || TW2.church || TW2.otank || TW2.bclass || TW2.gov || TW2.sport || TW2.campus) {
    const gk = (v) => {
      if (!v) return null;
      const k = Array.isArray(v) ? v[0] : v;
      return (k === "campus" ? TW2.campus : /^(gym|cover|bowl|stand|center)$/.test(k) ? TW2.sport : TW2.gov) ? v : null;
    };
    for (let i = 0; i < bj.length; i++) bj[i] = tw2Building(bj[i], TW2, orientedBox, TW2.bclass ? bj[i].cls : null, gk(bj[i].pub), LANDMARKS);
  }
  t = { detail, terrain: new Uint8Array(tb), buildings: bj, shopfronts: sf && sf.fp === fp0 && sf.b && sf.x ? sf : null };
  applyPlaceBuildings(bj, detail);
  fixLandmarks(bj);
  await aeroDropBuildings(url, bj, vf);
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
function tw2ShedRoof(b, roof, obb) {
  if (!TW2.shed || b.roof !== "flat" || b.type === "shed" || b.type === "factory" || !obb || !(Math.max(3, b.h || 6) > 4) || b.rings.length !== 1) return roof;
  const sh = shedPlan({ key: b.id, type: b.type || "townhouse", floors: Math.max(1, b.floors || 1), mark: b.mark, obb, rings: b.rings });
  if (!sh.length) return roof;
  const tot = sh.reduce((t, x) => t + x.l, 0), f = Math.min(1, tot / obb.length), avg = [0, 0, 0];
  for (const x of sh) {
    const c = rgb(shedHex(b.id, x.i, sheetRoofOf));
    for (let k = 0; k < 3; k++) avg[k] += c[k] * x.l / tot;
  }
  return roof.map((v, k) => v * (1 - f) + avg[k] * f);
}
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
    const top = g + Math.max(3, b.h || 6), wall = rgb(b.wall || "#d0cfca"), roof = b.roof === "flat" ? (b.type === "townhouse" || b.type === "apartment" && b.floors <= 5) && vhash(b.id, "v60", "mid-addon") < (b.addon || 0) ? rgb(deckOf(b.id)).map((v, k) => (v + rgb(sheetRoofOf(b.id))[k]) / 2) : rgb(deckOf(b.id)) : b.roof === "metal" ? rgb(sheetRoofOf(b.id)) : b.tw2Roof ? rgb(b.tw2Roof) : b.tw2T ? rgb(templeRoofHex(b.id)) : [0.42, 0.2, 0.14];
    const roofS = TW2.shed ? tw2ShedRoof(b, roof, orientedBox(b.rings[0])) : roof;
    const foot = b.type === "canopy" ? top - 0.6 : g - 0.6;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
      if (l < 0.3) continue;
      const nx = dy / l, ny = -dx / l;
      const v0 = put(p[0], p[1], foot, nx, ny, 0, wall, 0.78), v1 = put(q[0], q[1], foot, nx, ny, 0, wall, 0.78), v2 = put(q[0], q[1], top, nx, ny, 0, wall, 0.78), v3 = put(p[0], p[1], top, nx, ny, 0, wall, 0.78);
      idx.push(v0, v1, v2, v0, v2, v3);
    }
    const first = n;
    for (const p of ring) put(p[0], p[1], top, 0, 0, 1, roofS, 1);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])) idx.push(first + i, first + j, first + k);
  }
  return { pos: new Float32Array(pos), nor: new Int8Array(nor), col: new Uint8Array(col), idx: n > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), n, count: list.length };
}
function farBuilding(b, ring, g, putX, idx, cur, far) {
  const top = g + Math.max(3, b.h || 6), wall = rgb(b.wall || "#d0cfca");
  let roof = b.roof === "flat" ? (b.type === "townhouse" || b.type === "apartment" && b.floors <= 5) && vhash(b.id, "v60", "mid-addon") < (b.addon || 0) ? rgb(deckOf(b.id)).map((v, k) => (v + rgb(sheetRoofOf(b.id))[k]) / 2) : rgb(deckOf(b.id)) : b.roof === "metal" ? rgb(sheetRoofOf(b.id)) : b.tw2Roof ? rgb(b.tw2Roof) : b.tw2T ? rgb(templeRoofHex(b.id)) : [0.42, 0.2, 0.14];
  const foot = b.type === "canopy" ? top - 0.6 : g - 0.6, obb = orientedBox(b.rings[0]);
  const code = farCode(b), sd8 = Math.floor(vhash(b.id, "v117") * 256), fl = b.type === "canopy" ? 0 : Math.min(120, Math.max(1, b.floors || 1));
  const metal = b.type === "shed" || b.type === "factory" || b.roof === "metal", rt = code <= 1 ? 0 : code <= 4 ? 1 : code <= 6 ? 2 : 3;
  if (far & 2 && b.roof === "flat" && !(b.type === "shed" || b.type === "factory") && obb) {
    const sd = fr32(Math.max(0, Math.min(65535, Math.round(rnd(seed(b.id), 7116) * 65535))) / 65535), m = 0.8 + 0.38 * r3H(fr32(sd * 61), 1), h2 = r3H(fr32(sd * 19), 8) - 0.5;
    roof = [roof[0] * m * (1 + 0.06 * h2), roof[1] * m, roof[2] * m * (1 - 0.08 * h2)];
  }
  if (TW2.shed) roof = tw2ShedRoof(b, roof, obb);
  let fy = 127;
  if ((TW2.stair || TW2.heli) && rt === 1 && b.roof === "flat" && !metal && obb && Math.max(3, b.h || 6) > 4 && b.rings.length === 1) {
    const P = roofPlan({ key: b.id, tall: b.type === "apartment" && (b.floors || 1) > 11, L: obb.length / 2, W: obb.width / 2, fits: makeFits(b.rings, obb) });
    fy = P.k + (P.tu ? 16 : 0);
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
    putX(p[0], p[1], top, roof, 1, [Math.round(Math.max(-1, Math.min(1, s)) * 127), fy, Math.round(Math.max(-1, Math.min(1, t)) * 127), -(1 + Lc + (metal ? 64 : 0)), Wc + 64 * rt]);
  }
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])) idx.push(first + i, first + j, first + k);
}
async function streetObjects(url, vf, all, flat, buildings, groundAt) {
  const bi = buildingIndex(buildings), out = {}, J = TW2.sig || TW2.moto ? findJunctions(flat) : null;
  if (TW2.mtree) {
    const rails = await jget(url + "rails.json", vf?.j).then((r) => r.json()).catch(() => null), extra = [];
    for (const tk of rails?.tracks || []) {
      const p = tk.p || [];
      for (let k = 4; k + 3 < p.length; k += 4) {
        const ax = p[k - 4], ay = p[k - 3], bx = p[k], by = p[k + 1];
        if (Math.max(p[k - 2], p[k + 2]) > Math.min(groundAt(ax, ay), groundAt(bx, by)) - 2) extra.push([ax, ay, bx, by, Math.max(p[k - 2], p[k + 2]) > Math.min(groundAt(ax, ay), groundAt(bx, by)) + 2.5 ? 6.5 : 4]);
      }
    }
    const tr = roadTrees(all, { gap: TW2.num("mtgap", 9), blocked: bi.blocked, urban: (x, y) => bi.near(x, y, 10), extra });
    out.trees = new Float32Array(tr.length * 4);
    tr.forEach(([x, y, k], q) => out.trees.set([x, y, groundAt(x, y), k], q * 4));
  }
  if (TW2.sig) {
    const sg = signals(flat, J);
    out.sig = new Float32Array(sg.length * 7);
    sg.forEach(([x, y, dx, dy, arm, lit], q) => out.sig.set([x, y, groundAt(x, y), dx, dy, arm, lit], q * 7));
  }
  if (TW2.moto) {
    const mo = motoRows(flat, J, bi, { density: TW2.num("moto", 0.55) });
    out.moto = new Float32Array(mo.length * 5);
    mo.forEach(([x, y, a, c], q) => out.moto.set([x, y, groundAt(x, y), a, c], q * 5));
  }
  return out;
}
function bNearOf(bl) {
  const S = /* @__PURE__ */ new Set(), k = (x, y) => Math.floor(x / 6) * 4096 + Math.floor(y / 6);
  for (const b of bl) {
    const r = b.rings?.[0];
    if (!r) continue;
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length], m = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4));
      for (let j = 0; j < m; j++) S.add(k(p[0] + (q[0] - p[0]) * j / m, p[1] + (q[1] - p[1]) * j / m));
    }
  }
  return (x, y) => {
    const i = Math.floor(x / 6), j = Math.floor(y / 6);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (S.has((i + a) * 4096 + j + c)) return true;
    return false;
  };
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
  // lamp（效能線 2026-11-21）：{ mix, arm, tracks } 有給＝順便算這一格的路燈（shared/night-city.mjs tileLamps；原本在主執行緒算），roads.json 跟其他檔同時抓；抓不到＝這一格沒有路燈（照舊）。
  //   ph.lamps＝算路燈的毫秒、ph.lampJson＝等 roads.json（含解析）比其他步驟多等的毫秒。地面高用主執行緒那條算式（夾邊 1e-6），結果才跟搬之前逐位元相同。
  async base({ url, lo = 0, skip = "", mid = false, rtin = false, far = 0, vf, rn = 0, lamp = null }) {
    const ph = {}, T = (k, f) => {
      const s = performance.now(), r = f();
      ph[k] = (ph[k] || 0) + performance.now() - s;
      return r;
    };
    const lampRoads = lamp ? jget(url + "roads.json", vf?.j).then((r) => r.ok ? r.json() : null).catch(() => null) : null, lampTunnels = lamp ? tunnelDetail(url) : null;
    const t0 = performance.now(), t = await tileData(url, ph, vf, rn);
    const grid = T("grid", () => buildGrid(decodeTerrain(t.terrain))), err = rtin && !mid ? await errFile(url, ph, vf["rtin.bin"], rn) : T("err", () => rtinErrors(grid.h, FINE_N, toleranceField(grid), borderForce(grid), mid)), groundAt = (x, y) => gridAt(grid, x, y);
    const lods = T("mesh", () => [terrainMesh(grid.h, FINE_N, FINE_STEP, err, LOD_SCALE[0], 30, 4), terrainMesh(grid.h, FINE_N, FINE_STEP, err, LOD_SCALE[1], 40, 4)]), bl = keepStyles(t.buildings, skip);
    const simple = T("simple", () => simpleBuildings(bl, groundAt, 0, far)), simpleLo = lo > 0 ? T("simple", () => simpleBuildings(bl, groundAt, lo, far)) : null;
    let lamps = null;
    if (lampRoads) {
      const j0 = performance.now(), rd = await lampRoads, h = grid.h, n = FINE_N;
      ph.lampJson = performance.now() - j0;
      const g6 = (x, y) => {
        const u = Math.max(0, Math.min(n - 1 - 1e-6, x / FINE_STEP)), v = Math.max(0, Math.min(n - 1 - 1e-6, y / FINE_STEP)), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * n + i;
        return (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + n] * (1 - a) + h[k + n + 1] * a) * b;
      };
      const tunnels = await lampTunnels;
      if (rd?.roads) lamps = T("lamps", () => tileLamps(surfaceRoads(rd.roads, tunnels), lamp.tracks, g6, lamp));
    }
    return { lods, simple, simpleLo, h: grid.h, ms: performance.now() - t0, ph, ...lamps ? { lamp: lamps } : {} };
  },
  async near({ url, chunk = 2, skip = "", lines = 1, farStep = 0, inner = 0, deck = 1, pier = 1, side = 1, rdMode = 0, fx3 = 0, vf, rn = 0 }) {
    const ph = {}, T = (k, f) => {
      const s = performance.now(), r = f();
      ph[k] = (ph[k] || 0) + performance.now() - s;
      return r;
    };
    const t0 = performance.now(), t = await tileData(url, ph, vf, rn), f0 = performance.now(), roads = await jget(url + "roads.json", vf?.j).then((r) => r.json());
    ph.fetch = (ph.fetch || 0) + performance.now() - f0;
    const grid = T("grid", () => buildGrid(decodeTerrain(t.terrain))), groundAt = (x, y) => gridAt(grid, x, y);
    let rPiers = roads.piers || [];
    if (TW2.btype || TW2.rbrg) {
      const bd = await tw2BridgeData(url, roads, vf);
      if (bd) {
        if (TW2.rbrg) {
          for (const i of bd.wp || []) if (rPiers[i]) rPiers[i] = [...rPiers[i].slice(0, 6), 1];
          for (const i of bd.wr || []) if (roads.roads[i]) roads.roads[i].tw2w = 1;
        }
        if (TW2.btype && bd.clear?.length) rPiers = rPiers.filter((p) => !inClear(bd.clear, p[0], p[1]));
      }
    }
    roads.roads = surfaceRoads(roads.roads, t.detail?.tunnels);
    t.roads = roads.context;
    const fields = fieldMesh(t.detail, groundAt), temples = templeMesh(t.detail, groundAt), heritage = reviewedTempleMeshes(t.detail, groundAt);
    const built = T("build", () => buildDetailed({ buildings: keepStyles(t.buildings, skip), roads: roads.context, groundAt, chunkSize: TILE_M / Math.max(1, chunk || 2), mode: 1, inner, shopfronts: t.shopfronts, fx3 }));
    if (rdMode > 0) {
      const up = (r) => r.pts.some((p) => p[2] > 0.3), flatRoads = roads.roads.filter((r) => !up(r));
      const street = TW2.mtree || TW2.sig || TW2.moto ? await T("street", () => streetObjects(url, vf, roads.roads, flatRoads, t.buildings, groundAt)) : null;
      return { ...street ? { street } : {}, buildings: built, fields, temples, heritage, trees: t.detail?.tunnels?.trees, roads: T("roads", () => roadRibbons(roads.roads.filter(up), groundAt, lines, farStep, rPiers, deck, pier, side, 0, roads.roads)), flat: T("roads", () => roadRibbons(flatRoads, groundAt, lines, 0, [], rdMode === 3 ? 1 : 0, 0, 0, rdMode, roads.roads, TW2.walk ? t.buildings : null, bNearOf)), h: grid.h, ms: performance.now() - t0, ph };
    }
    return { buildings: built, fields, temples, heritage, trees: t.detail?.tunnels?.trees, roads: T("roads", () => roadRibbons(roads.roads, groundAt, lines, farStep, rPiers, deck, pier, side)), h: grid.h, ms: performance.now() - t0, ph };
  },
  async extras({ url, cx, cy, r, chunk = 2, skip = "", vf }) {
    const t = await tileData(url, null, vf);
    if (!t.roads) t.roads = (await jget(url + "roads.json", vf?.j).then((x) => x.json())).context;
    const grid = buildGrid(decodeTerrain(t.terrain));
    return buildDetailed({
      buildings: keepStyles(t.buildings, skip),
      roads: t.roads,
      groundAt: (x, y) => gridAt(grid, x, y),
      chunkSize: chunk > 2 ? TILE_M / chunk : 1e9,
      mode: 2,
      shopfronts: t.shopfronts,
      ctr: [cx, cy],
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
