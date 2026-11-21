import * as THREE from "./vendor/three.module.js";
import { hash, pick, orientedBox, STYLES, ACCENT_WALLS, ROOF_TILE, REDBRICK_WALLS, WOOD_WALLS, OLD_FINISH, wpick, fitFinish } from "./kit-building-appearance.js";
import { HILL_STYLES } from "./shared/hill-styles.mjs";
import { wallOf, deckOf, sheetRoofOf, addonWallOf } from "./shared/tw-variety.mjs";
import { cvsCode } from "./shared/cvs-look.mjs";
import { LANDMARK_TYPES, buildLandmark } from "../landmark-fix.mjs";
import { TW2 } from "./shared/tw2.mjs";
import { ST, stairXY, roofPlan, shedPlan, shedHex, tuSize, TU } from "./shared/tw2-roof.mjs";
import { templePlan, templeRoofHex, TEMPLE_RIDGE, TEMPLE_HIP, TEMPLE_GOLD, TEMPLE_FLOOR } from "./shared/tw2-temple.mjs";
import { BAY, FRAMES, CAGES, AWNINGS, SHUTTERS, DECKS, TANKS, TEMPLE_ROOFS, CAGE, CIVIC, seed, rnd } from "./kit-city-atlas.js";
const colorCache = /* @__PURE__ */ new Map();
const rgb = (hex) => {
  let c = colorCache.get(hex);
  if (!c) {
    const o = new THREE.Color(hex);
    c = [o.r, o.g, o.b];
    colorCache.set(hex, c);
  }
  return c;
};
const shade = (c, k) => c.map((v) => Math.min(1, v * k));
const WHITE = [1, 1, 1];
const P_METAL = 4, P_DECK = 5, P_TILE = 6, P_PLAIN = 7, P_TANK = 8, P_SIGN = 9, P_VSIGN = 10;
const FL = { cage: 1, bands: 2, ac: 4, school: 8, civic: 16, temple: 32, wood: 64, hall: 128, tall: 256, shops: 512, schoolFront: 1024, signEdge: 2048, quiet: 4096, lobby: 8192 };
const STRIDE = 28;
const f32 = Math.fround, fr32 = (x) => f32(x - Math.floor(x));
const twH3 = (x, y, z) => {
  let a = fr32(f32(x * f32(0.1031))), b = fr32(f32(y * f32(0.1031))), c = fr32(f32(z * f32(0.1031)));
  const k = f32(31.32), d = f32(f32(f32(a * f32(c + k)) + f32(b * f32(b + k))) + f32(c * f32(a + k)));
  a = f32(a + d);
  b = f32(b + d);
  c = f32(c + d);
  return fr32(f32(f32(a + b) * c));
};
export const SHOP_SIGN = { h: 0.85, awning: 0.3 };
export function buildDetailed({ buildings, roads, groundAt, chunkSize, mode = 0, only = null, inner = 0, shopfronts = null, fx3 = 0, ctr = null }) {
  const t0 = performance.now();
  const GRID = 20, roadGrid = /* @__PURE__ */ new Map();
  for (const line of roads) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    for (let x = Math.floor(Math.min(a[0], b[0]) / GRID); x <= Math.floor(Math.max(a[0], b[0]) / GRID); x++) for (let y = Math.floor(Math.min(a[1], b[1]) / GRID); y <= Math.floor(Math.max(a[1], b[1]) / GRID); y++) {
      const k = x + "," + y;
      let l = roadGrid.get(k);
      if (!l) roadGrid.set(k, l = []);
      l.push([a, b]);
    }
  }
  const roadDistance = (p) => {
    let best = Infinity;
    const cx = Math.floor(p[0] / GRID), cy = Math.floor(p[1] / GRID);
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) {
      const l = roadGrid.get(x + "," + y);
      if (l) for (const [a, b] of l) {
        const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
      }
    }
    return best;
  };
  const chunks = /* @__PURE__ */ new Map();
  let out = null;
  const V = new Float64Array(STRIDE);
  const vert = (p, n, sv, lv, hs, rn, col, tnt) => {
    if (mode === 1 ? hs[0] >= 7 : mode === 2 && hs[0] < 7) return;
    V[0] = p[0];
    V[1] = p[2];
    V[2] = -p[1];
    V[3] = n[0];
    V[4] = n[2];
    V[5] = -n[1];
    V.set(sv, 6);
    V.set(lv, 10);
    V.set(hs, 14);
    V.set(rn, 18);
    V.set(col, 22);
    V.set(tnt, 25);
    const d = out.data, n0 = out.n;
    for (let q = n0 - 1; q >= n0 - 6 && q >= 0; q--) {
      const o = q * STRIDE;
      let k = 0;
      while (k < STRIDE && d[o + k] === V[k]) k++;
      if (k === STRIDE) {
        out.index.push(q);
        return;
      }
    }
    for (let k = 0; k < STRIDE; k++) d.push(V[k]);
    out.index.push(n0);
    out.n++;
  };
  const Z4 = [0, 0, 0, 0];
  const normalOf = (P) => {
    const [a, b, c] = P, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const UV1 = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const quad = (P, part, color, uv = UV1, layer = 0) => {
    const n = normalOf(P);
    for (const i of [0, 1, 2, 0, 2, 3]) vert(P[i], n, [uv[i][0], uv[i][1], 0, 0], Z4, [part, layer, 0, 0], Z4, color, WHITE);
  };
  const tri = (P, part, color) => {
    const n = normalOf(P);
    for (const p of P) vert(p, n, Z4, Z4, [part, 0, 0, 0], Z4, color, WHITE);
  };
  const FREE = [1, 2, 3, 4, 5], OUT = [1, 2, 3, 5];
  const box = (center, size, part, color, angle = 0, faces = FREE) => {
    const ca = Math.cos(angle), sa = Math.sin(angle), p = [];
    for (const [x, y, z] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) p.push([center[0] + x * size[0] / 2 * ca - y * size[1] / 2 * sa, center[1] + x * size[0] / 2 * sa + y * size[1] / 2 * ca, center[2] + z * size[2] / 2]);
    const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (const f of faces) quad(F[f].map((i) => p[i]), part, color, [[0, 0], [size[0] / 6, 0], [size[0] / 6, size[2] / 6], [0, size[2] / 6]]);
  };
  const prism = (center, radius, z0, z1, part, color, sides = 8) => {
    const at = (k, z) => [center[0] + radius * Math.cos(k * 2 * Math.PI / sides), center[1] + radius * Math.sin(k * 2 * Math.PI / sides), z];
    for (let k = 0; k < sides; k++) quad([at(k, z0), at(k + 1, z0), at(k + 1, z1), at(k, z1)], part, color);
    for (let k = 1; k < sides - 1; k++) tri([at(0, z1), at(k, z1), at(k + 1, z1)], part, color);
  };
  function houseOf(b, slot) {
    const S = b.style, r = (k) => hash(b.key, "house", slot, k), hall = b.type === "hall", civic = CIVIC[b.mark];
    if (civic) {
      const light = rgb(b.color).reduce((s, v) => s + v, 0) / 3 > 0.5;
      return { color: b.color, win: civic.win, finish: civic.finish, frame: "#ffffff", cage: null, bands: !!civic.band, ac: b.mark !== "hospital", parapet: 0, deck: pick(DECKS, r("deck")), civic };
    }
    if (b.mark === "mall") return { color: b.color, win: 11, win2: 10, finish: 0, frame: "#78898a", cage: null, bands: true, ac: false, parapet: 0, deck: b.sceneRoof || "#b4b6b0" };
    if (b.type === "school") return { color: b.color, win: 11, finish: r("finish") < 0.5 ? 0 : 2, frame: pick(["#ffffff", "#6f8f78", "#d2d6d4"], r("frame")), cage: null, bands: true, ac: false, parapet: 0, deck: pick(DECKS, r("deck")), school: true };
    if (b.type === "temple") return { color: b.color, win: -1, finish: 2, frame: "#ffffff", cage: null, bands: false, ac: false, parapet: 0, deck: "#a7a9a4", temple: true };
    const finish = hall ? r("finish") < 0.6 ? 3 : 0 : slot === 0 && b.finish !== null ? b.finish : fitFinish(wpick(S.finish, r("finish")), b.type, b.floors);
    let color = b.type === "townhouse" && slot > 0 ? wallOf({ key: b.key, slot, type: b.type, floors: b.floors, style: b.styleKey }) || (r("accent") < S.accent ? pick(ACCENT_WALLS, r("accent-color")) : pick(S.walls, r("color"))) : b.color;
    if (slot > 0 && finish === 4) color = pick(REDBRICK_WALLS, r("color"));
    if (slot > 0 && finish === 6) color = pick(WOOD_WALLS, r("color"));
    const tint = OLD_FINISH.has(finish) ? pick(["#ffffff", "#f4efe9", "#ebe5de", "#f9f4ee"], r("tint")) : null;
    if (finish === 6) return { color, tint, win: 37, finish, frame: "#ffffff", cage: null, bands: false, ac: r("ac") < 0.25, parapet: 0, deck: pick(DECKS, r("deck")), wood: true };
    const tall = b.type === "apartment" && b.floors >= 7, win = hall ? wpick([[6, 2], [10, 1], [11, 2]], r("win")) : tall ? wpick([[2, 2], [3, 2], [6, 3], [14, 2], [10, 1]], r("win")) : wpick(S.windows, r("win"));
    return {
      color,
      tint,
      win,
      win2: wpick(S.windows, r("win2")),
      finish,
      frame: pick(FRAMES, r("frame")),
      tall,
      cage: !hall && !tall && win in CAGE && r("grill") < (TW2.cage && b.floors <= 5 ? Math.min(0.9, S.grill * TW2.num("cageK", 1.6)) : S.grill) ? CAGES.indexOf(pick(CAGES, r("cage-color"))) : null,
      bands: r("bands") < 0.35,
      ac: !hall && r("ac") < 0.6,
      parapet: b.type === "townhouse" && r("parapet") < 0.3 ? 0.5 + r("parapet-h") * 0.9 : 0,
      deck: deckOf(b.key)
    };
  }
  function buildConstruction(b) {
    const ring = [...b.rings[0]], area = ring.reduce((s2, p, i) => s2 + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);
    if (area <= 0) ring.reverse();
    const z = b.ground + b.h, bottom = b.ground - 0.6, TOP_OPEN = Math.min(10, b.h * 0.08), zn = z - TOP_OPEN, net = rgb(b.color), steel = rgb("#8a9094");
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.5) continue;
      const wall = (z0, z1, col) => quad([[a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], [a[0], a[1], z1]], P_DECK, col, [[0, 0], [len / 6, 0], [len / 6, (z1 - z0) / 6], [0, (z1 - z0) / 6]]);
      wall(bottom, zn, net);
      wall(zn, z, steel);
    }
    const pts = ring.map((p) => new THREE.Vector2(p[0], p[1])), s = b.id % 97;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) for (const q of [ring[i], ring[j], ring[k]]) vert([q[0], q[1], z], [0, 0, 1], [q[0] * 0.25 + s, q[1] * 0.25, 0, 0], Z4, [P_DECK, 7, 0, 0], Z4, rgb("#6b6f70"), WHITE);
    const obb = orientedBox(ring);
    if (!obb || b.h < 20) return;
    const at = (du, dv) => [obb.center[0] + obb.u[0] * du + obb.v[0] * dv, obb.center[1] + obb.u[1] * du + obb.v[1] * dv], base = Math.atan2(obb.u[1], obb.u[0]), cr = rgb("#d4502a"), wh = rgb("#e4e2dc"), wd = obb.width || obb.length * 0.5, flip = b.id % 2 ? 1 : -1;
    const beam = (p0, p1, w, color) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz) || 1, hz = Math.hypot(dx, dy), u = [dx / L, dy / L, dz / L], sd = hz > 1e-6 ? [-dy / hz, dx / hz, 0] : [1, 0, 0];
      const up = [sd[1] * u[2] - sd[2] * u[1], sd[2] * u[0] - sd[0] * u[2], sd[0] * u[1] - sd[1] * u[0]], h = w / 2, mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
      const C = (p, a, c) => [p[0] + sd[0] * a * h + up[0] * c * h, p[1] + sd[1] * a * h + up[1] * c * h, p[2] + sd[2] * a * h + up[2] * c * h];
      const q = [C(p0, -1, -1), C(p0, 1, -1), C(p0, 1, 1), C(p0, -1, 1), C(p1, -1, -1), C(p1, 1, -1), C(p1, 1, 1), C(p1, -1, 1)];
      for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
        let P = f.map((k) => q[k]);
        const n = normalOf(P), c = P.reduce((t, v) => [t[0] + v[0] / 4, t[1] + v[1] / 4, t[2] + v[2] / 4], [0, 0, 0]);
        if (n[0] * (c[0] - mid[0]) + n[1] * (c[1] - mid[1]) + n[2] * (c[2] - mid[2]) < 0) P = P.reverse();
        quad(P, P_PLAIN, color);
      }
    };
    const crane = (du, dv, rot, mast, jib, elev) => {
      const m = at(du, dv), angle = base + rot * flip, cu = Math.cos(angle), su = Math.sin(angle), top = z + mast;
      box([m[0], m[1], z + mast / 2], [1.8, 1.8, mast], P_PLAIN, cr, base);
      box([m[0] - cu * 1.2, m[1] - su * 1.2, top + 1.4], [6, 3, 2.8], P_PLAIN, wh, angle);
      box([m[0] - cu * 4.6, m[1] - su * 4.6, top + 1.4], [2.2, 3.2, 3.2], P_PLAIN, wh, angle);
      const pivot = [m[0] + cu * 1.6, m[1] + su * 1.6, top + 2.4], tip = [pivot[0] + cu * jib * Math.cos(elev), pivot[1] + su * jib * Math.cos(elev), pivot[2] + jib * Math.sin(elev)], aTop = [m[0] - cu * 1.5, m[1] - su * 1.5, top + 9];
      beam(pivot, tip, 1.1, cr);
      beam([m[0] + cu * 0.6, m[1] + su * 0.6, top + 2.8], aTop, 0.6, cr);
      beam(aTop, tip, 0.18, rgb("#3a3d40"));
    };
    crane(obb.length * 0.18, wd * 0.2, 0.4, 26, 50, 0.75);
    crane(-obb.length * 0.2, wd * 0.2, 2.5, 30, 46, 1.05);
    crane(-obb.length * 0.18, -wd * 0.22, -2.2, 20, 52, 0.55);
    crane(obb.length * 0.2, -wd * 0.18, -0.9, 23, 44, 1.25);
  }
  function buildCanopy(b) {
    const z = b.ground + b.h, T = 0.45, zb = z - T, roof = rgb(b.color), under = shade(roof, 0.72), col = rgb("#c9ccc8"), s = b.id % 97;
    const rings = b.rings.map((r) => {
      const a = r.reduce((t, p, i) => t + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0);
      return a < 0 ? [...r].reverse() : r;
    });
    const outer = rings[0], holes = rings.slice(1).map((h) => [...h].reverse()), all = [outer, ...holes].flat();
    const tris = THREE.ShapeUtils.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
    for (const [i, j, k] of tris) {
      for (const q of [all[i], all[j], all[k]]) vert([q[0], q[1], z], [0, 0, 1], [q[0] * 0.25 + s, q[1] * 0.25, 0, 0], Z4, [P_DECK, 7, 0, 0], Z4, roof, WHITE);
      for (const q of [all[i], all[k], all[j]]) vert([q[0], q[1], zb], [0, 0, -1], [q[0] * 0.25 + s, q[1] * 0.25, 0, 0], Z4, [P_DECK, 0, 0, 0], Z4, under, WHITE);
    }
    for (const r of [outer, ...holes]) for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.3) continue;
      quad([[a[0], a[1], zb], [c[0], c[1], zb], [c[0], c[1], z], [a[0], a[1], z]], P_DECK, shade(roof, 0.9), [[0, 0], [len / 6, 0], [len / 6, T / 6], [0, T / 6]]);
    }
    for (const [x, y] of b.cols || []) box([x, y, (b.ground - 0.3 + zb) / 2], [0.4, 0.4, zb - b.ground + 0.3], P_DECK, col);
  }
  function buildFacility(b) {
    const ring = [...b.rings[0]], area = ring.reduce((s2, p, i) => s2 + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);
    if (area <= 0) ring.reverse();
    const z = b.ground + b.h, bottom = b.ground - 0.6, wall = rgb(b.color), louver = rgb(b.facility?.louver || "#2f4a3e"), edge = rgb(b.facility?.edge || "#4f9a8e"), O = 0.06, s = b.id % 97;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.3) continue;
      const ex = (c[0] - a[0]) / len, ey = (c[1] - a[1]) / len, nx = ey * O, ny = -ex * O;
      const panel = (u0, u1, z0, z1, col) => quad([[a[0] + ex * u0 + nx, a[1] + ey * u0 + ny, z0], [a[0] + ex * u1 + nx, a[1] + ey * u1 + ny, z0], [a[0] + ex * u1 + nx, a[1] + ey * u1 + ny, z1], [a[0] + ex * u0 + nx, a[1] + ey * u0 + ny, z1]], P_DECK, col, [[0, 0], [(u1 - u0) / 6, 0], [(u1 - u0) / 6, (z1 - z0) / 6], [0, (z1 - z0) / 6]]);
      quad([[a[0], a[1], bottom], [c[0], c[1], bottom], [c[0], c[1], z], [a[0], a[1], z]], P_DECK, wall, [[0, 0], [len / 6, 0], [len / 6, (z - bottom) / 6], [0, (z - bottom) / 6]]);
      if (len >= 2.4) {
        const bays = Math.max(1, Math.round(len / 3.2)), bw = len / bays;
        for (let k = 0; k < bays; k++) panel(k * bw + bw * 0.22, (k + 1) * bw - bw * 0.22, b.ground + 0.15, z - 2.2, louver);
      }
      if (len >= 1.2) {
        panel(0, 0.35, bottom, z, edge);
        panel(len - 0.35, len, bottom, z, edge);
      }
    }
    const pts = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) for (const q of [ring[i], ring[j], ring[k]]) vert([q[0], q[1], z], [0, 0, 1], [q[0] * 0.25 + s, q[1] * 0.25, 0, 0], Z4, [P_DECK, 7, 0, 0], Z4, rgb("#a9aca8"), WHITE);
  }
  function buildOne(b) {
    if (LANDMARK_TYPES.has(b.type)) return buildLandmark(b, { quad, tri, box, vert, rgb, shade, THREE, Z4, WHITE, P_DECK, P_TILE, P_PLAIN });
    if (b.tw2Tank) {
      const { r, c } = b.tw2Tank, K = 20, z0 = b.ground - 0.6, z1 = b.ground + b.h, col = rgb(b.color), top2 = col.map((v) => v * 0.9), at2 = (k, rad, z2) => [c[0] + rad * Math.cos(k * 2 * Math.PI / K), c[1] + rad * Math.sin(k * 2 * Math.PI / K), z2], apex = [c[0], c[1], z1 + r * 0.1];
      for (let k = 0; k < K; k++) {
        quad([at2(k, r, z0), at2(k + 1, r, z0), at2(k + 1, r, z1), at2(k, r, z1)], P_DECK, col, [[k / 4, 0], [(k + 1) / 4, 0], [(k + 1) / 4, b.h / 6], [k / 4, b.h / 6]]);
        tri([at2(k, r, z1), at2(k + 1, r, z1), apex], P_DECK, top2);
      }
      return;
    }
    if (b.tw2Gh) {
      const { c, u, v, L, W, n } = b.tw2Gh, z0 = b.ground - 0.5, ze = b.ground + b.h * 0.6, zt = b.ground + b.h, zq = ze + (zt - ze) * 0.74, col = rgb(b.color), wallc = shade(col, 0.9), endc = shade(col, 0.82), sw = 2 * W / n, P = (a, t, z2) => [c[0] + u[0] * a + v[0] * t, c[1] + u[1] * a + v[1] * t, z2];
      const strip = (ta, za, tb, zb) => quad([P(-L, ta, za), P(L, ta, za), P(L, tb, zb), P(-L, tb, zb)], P_DECK, col, [[0, 0], [L / 3, 0], [L / 3, 0.5], [0, 0.5]]);
      for (let k = 0; k < n; k++) {
        const t02 = -W + k * sw, t1 = t02 + sw, tm = (t02 + t1) / 2, a0 = t02 + sw * 0.2, a1 = t1 - sw * 0.2;
        strip(t02, ze, a0, zq);
        strip(a0, zq, tm, zt);
        strip(tm, zt, a1, zq);
        strip(a1, zq, t1, ze);
        for (const s of [1, -1]) {
          const A = P(s * L, t02, ze), B = P(s * L, t1, ze), C = P(s * L, a1, zq), D = P(s * L, tm, zt), E = P(s * L, a0, zq);
          for (const T of [[A, B, C], [A, C, D], [A, D, E]]) tri(s > 0 ? T : [T[0], T[2], T[1]], P_DECK, endc);
        }
      }
      quad([P(-L, -W, z0), P(L, -W, z0), P(L, -W, ze), P(-L, -W, ze)], P_DECK, wallc);
      quad([P(L, W, z0), P(-L, W, z0), P(-L, W, ze), P(L, W, ze)], P_DECK, wallc);
      quad([P(L, -W, z0), P(L, W, z0), P(L, W, ze), P(L, -W, ze)], P_DECK, endc);
      quad([P(-L, W, z0), P(-L, -W, z0), P(-L, -W, ze), P(-L, W, ze)], P_DECK, endc);
      return;
    }
    if (b.tw2Plain) {
      const r0 = b.rings[0], ring2 = r0.reduce((t, p, i) => t + p[0] * r0[(i + 1) % r0.length][1] - r0[(i + 1) % r0.length][0] * p[1], 0) < 0 ? [...r0].reverse() : r0, z2 = b.ground + b.h, z0 = b.ground - 0.6, col = rgb(b.color), top2 = shade(col, 0.86);
      for (let i = 0; i < ring2.length; i++) {
        const a = ring2[i], c = ring2[(i + 1) % ring2.length];
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.2) continue;
        quad([[a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z2], [a[0], a[1], z2]], P_DECK, col);
      }
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring2.map((p) => new THREE.Vector2(p[0], p[1])), [])) tri([ring2[i], ring2[j], ring2[k]].map((q) => [q[0], q[1], z2]), P_DECK, top2);
      return;
    }
    if (b.tw2Gym) {
      const { c, u, v, L, W, eave, rise, open } = b.tw2Gym, z0 = b.ground - 0.6, ze = b.ground + eave, K = 8, roofc = rgb(b.tw2Gym.roof), wallc = rgb(b.color), endc = shade(wallc, 0.9), ov = open ? 0 : 0.7, P = (a, t, z2) => [c[0] + u[0] * a + v[0] * t, c[1] + u[1] * a + v[1] * t, z2];
      const arc = (k, w) => {
        const th = Math.PI * k / K;
        return [-w * Math.cos(th), ze + rise * Math.sin(th)];
      };
      for (let k = 0; k < K; k++) {
        const [ta, za] = arc(k, W + ov), [tb, zb] = arc(k + 1, W + ov), col = shade(roofc, 0.9 + 0.1 * Math.sin(Math.PI * (k + 0.5) / K));
        quad([P(-L - ov, ta, za), P(L + ov, ta, za), P(L + ov, tb, zb), P(-L - ov, tb, zb)], P_DECK, col, [[0, 0], [L / 3, 0], [L / 3, 0.5], [0, 0.5]]);
        if (open) quad([P(L, ta, za - 0.25), P(-L, ta, za - 0.25), P(-L, tb, zb - 0.25), P(L, tb, zb - 0.25)], P_DECK, shade(roofc, 0.62));
      }
      if (open) {
        const n = Math.max(1, Math.round(2 * L / 6)), col = rgb("#c9ccc8");
        for (let i = 0; i <= n; i++) for (const sd of [-1, 1]) {
          const q = P(-L + 2 * L * i / n, sd * (W - 0.3), 0);
          box([q[0], q[1], (z0 + ze) / 2], [0.5, 0.5, ze - z0], P_DECK, col);
        }
        return;
      }
      for (const sd of [1, -1]) {
        const O = P(sd * L, 0, ze);
        for (let k = 0; k < K; k++) {
          const [ta, za] = arc(k, W), [tb, zb] = arc(k + 1, W), A = P(sd * L, ta, za), B = P(sd * L, tb, zb);
          tri(sd > 0 ? [O, B, A] : [O, A, B], P_DECK, endc);
        }
      }
      quad([P(-L, -W, z0), P(L, -W, z0), P(L, -W, ze), P(-L, -W, ze)], P_DECK, wallc);
      quad([P(L, W, z0), P(-L, W, z0), P(-L, W, ze), P(L, W, ze)], P_DECK, wallc);
      quad([P(L, -W, z0), P(L, W, z0), P(L, W, ze), P(L, -W, ze)], P_DECK, endc);
      quad([P(-L, W, z0), P(-L, -W, z0), P(-L, -W, ze), P(-L, W, ze)], P_DECK, endc);
      if (L > 5 && eave > 5) {
        const g = rgb("#5f6e7a"), o = 0.08, m = Math.min(2.5, L * 0.15), wa = ze - Math.min(3, eave * 0.32), wb = ze - 0.9;
        quad([P(-L + m, -W - o, wa), P(L - m, -W - o, wa), P(L - m, -W - o, wb), P(-L + m, -W - o, wb)], P_DECK, g);
        quad([P(L - m, W + o, wa), P(-L + m, W + o, wa), P(-L + m, W + o, wb), P(L - m, W + o, wb)], P_DECK, g);
      }
      if (W > 5 && eave > 5) {
        const g = rgb("#5f6e7a"), d = rgb("#4a4f55"), o = 0.08, m = Math.min(2.5, W * 0.18), wa = ze - Math.min(3, eave * 0.32), wb = ze - 0.9, dw = Math.min(3, W * 0.3), zd = z0 + 0.6;
        for (const sd of [1, -1]) {
          const a = sd * (L + o), q = (t02, t1, za, zb) => quad([P(a, sd * t02, za), P(a, sd * t1, za), P(a, sd * t1, zb), P(a, sd * t02, zb)], P_DECK, za === zd ? d : g);
          q(-W + m, W - m, wa, wb);
          q(-dw, dw, zd, zd + 2.8);
        }
      }
      return;
    }
    if (b.tw2Stand) {
      const { f, radial, dir, d0, d1, seat } = b.tw2Stand, zl = b.ground + 1.2, zh = b.ground + b.h, z0 = b.ground - 0.6, seatc = rgb(seat), conc = rgb(b.color);
      const zAt = (p) => {
        const d = radial ? Math.hypot(p[0] - f[0], p[1] - f[1]) : (p[0] - f[0]) * dir[0] + (p[1] - f[1]) * dir[1];
        return zl + (zh - zl) * Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
      };
      const rings = b.rings.map((r) => {
        const a = r.reduce((t, p, i) => t + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0);
        return a < 0 ? [...r].reverse() : r;
      }), outer = rings[0], holes = rings.slice(1).map((h) => [...h].reverse()), all = [outer, ...holes].flat();
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))))) tri([all[i], all[j], all[k]].map((q) => [q[0], q[1], zAt(q)]), P_DECK, seatc);
      for (const r of [outer, ...holes]) for (let i = 0; i < r.length; i++) {
        const a = r[i], c = r[(i + 1) % r.length];
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.3) continue;
        quad([[a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], zAt(c)], [a[0], a[1], zAt(a)]], P_DECK, conc);
      }
      return;
    }
    if (b.type === "construction") return buildConstruction(b);
    if (b.type === "facility") return buildFacility(b);
    if (b.type === "canopy") return buildCanopy(b);
    const z = b.ground + b.h, bottom = b.ground - 0.6, pitched = b.roof !== "flat", metal = b.type === "shed" || b.type === "factory", obb = orientedBox(b.rings[0]);
    const floor0 = b.ground, top = z - (pitched || metal ? 0 : 0.8), F = b.floors, gh = F === 1 ? top - floor0 : Math.min(3.6, (top - floor0) / F * 1.12), uh = F > 1 ? (top - floor0 - gh) / (F - 1) : 0, level = (k) => k === 0 ? floor0 : floor0 + gh + (k - 1) * uh;
    const slotOf = (x, y) => b.type !== "townhouse" || !obb || obb.length < 9 ? 0 : Math.floor(((x - obb.center[0]) * obb.u[0] + (y - obb.center[1]) * obb.u[1] + obb.length / 2) / BAY);
    const houses = /* @__PURE__ */ new Map(), H = (slot) => {
      if (!houses.has(slot)) houses.set(slot, houseOf(b, slot));
      return houses.get(slot);
    };
    const ring = [...b.rings[0]], area = ring.reduce((s, p, i) => s + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);
    if (area <= 0) ring.reverse();
    const edges = ring.map((a, i) => {
      const c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
      return len < 0.5 ? null : { a, c, len, u: [dx / len, dy / len], n: [dy / len, -dx / len], angle: Math.atan2(dy, dx), d: roadDistance([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]) };
    }).filter(Boolean);
    if (!edges.length) return;
    for (const e2 of edges) e2.at = (s, o = 0) => [e2.a[0] + e2.u[0] * s + e2.n[0] * o, e2.a[1] + e2.u[1] * s + e2.n[1] * o];
    let fronts = edges.filter((e2) => e2.d < 14 && e2.len >= 2.5);
    if (!fronts.length) {
      const nearest = [...edges].sort((p, q) => p.d - q.d)[0];
      fronts = nearest && nearest.d < 40 ? [nearest] : [[...edges].sort((p, q) => q.len - p.len)[0]];
    }
    const maxLen = Math.max(...edges.map((e2) => e2.len)), south = b.type === "school" ? [...edges].filter((e2) => e2.len >= 0.6 * maxLen).sort((p, q) => p.n[1] - q.n[1])[0] : null, fn = south ? south.n : fronts[0].n, signEdge = south || [...fronts].sort((p, q) => q.len - p.len)[0], shops = !b.mark && b.type !== "school" && b.type !== "temple" && (b.sf !== void 0 ? !!b.sf : hash(b.key, "shop") < (b.style.shop ?? 1));
    const wallColorOf = H(0).tint ? rgb(H(0).tint) : rgb(H(0).color);
    const dCtr = ctr && (TW2.cage || TW2.arcade) ? ((c) => Math.hypot(c[0] - ctr[0], c[1] - ctr[1]))(obb ? obb.center : ring[0]) : 0;
    const cageNear = TW2.cage && TW2.num("cageGeo", 0) > 0 && mode !== 1 && ctr && F <= 5 && dCtr <= TW2.num("cageR", 200);
    const arcBld = TW2.arcade && !b.mark && !b.quiet && (b.type === "townhouse" || b.type === "apartment" && F < 12) && !H(0).wood && !H(0).civic;
    const inRing = (p) => {
      let yes = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], c = ring[j];
        if (a[1] > p[1] !== c[1] > p[1] && p[0] < (c[0] - a[0]) * (p[1] - a[1]) / (c[1] - a[1]) + a[0]) yes = !yes;
      }
      return yes;
    };
    const arcs = arcBld ? edges.map((e2, ei) => {
      const shopE = b.sf ? b.sf.get(ei) : void 0, front = !!shopE || fronts.includes(e2) || b.type !== "townhouse" && e2.len >= 3, commercial = b.sf !== void 0 ? !!shopE : front && e2.d < 14;
      if (!(commercial && shops && front && F >= 2 && e2.len >= 2.5 && gh > 2.9 && e2.d >= TW2.num("arcMinD", 4.5))) return null;
      const D = TW2.num("arcD", 3.64), L = edges.length, pv = edges[(ei + L - 1) % L], nx = edges[(ei + 1) % L], cr = (p, q) => p[0] * q[1] - p[1] * q[0], kp = cr(e2.u, pv.u), kn = cr(e2.u, nx.u);
      if (Math.abs(kp) <= 0.5 || Math.abs(kn) <= 0.5) return null;
      const t02 = D * cr(e2.n, pv.u) / kp, t1 = e2.len + D * cr(e2.n, nx.u) / kn;
      if (!(t1 - t02 > 1.5 && inRing(e2.at(t02 + 0.3, -D)) && inRing(e2.at(t1 - 0.3, -D)) && inRing(e2.at(e2.len / 2, -D - 1.5)))) return null;
      return { D, t0: t02, t1, zc: floor0 + gh, zg: floor0 + gh, pa: e2.at(t02, -D), pb: e2.at(t1, -D) };
    }) : null;
    edges.forEach((e2, ei) => {
      const shopE = b.sf ? b.sf.get(ei) : void 0;
      const role = shopE || fronts.includes(e2) ? "front" : b.type !== "townhouse" && e2.len >= 3 ? "front" : e2.n[0] * fn[0] + e2.n[1] * fn[1] < -0.7 ? "back" : "side";
      const P = (s, o, hh) => [...e2.at(s, o), hh], n3 = [e2.n[0], e2.n[1], 0];
      if (metal) {
        const su = e2.len / 6, sv = (z - bottom) / 6;
        quad([P(0, 0, bottom), P(e2.len, 0, bottom), P(e2.len, 0, z), P(0, 0, z)], P_METAL, rgb(b.color), [[0, 0], [su, 0], [su, sv], [0, sv]], 7);
        return;
      }
      const facing = e2.n[0] * fn[0] + e2.n[1] * fn[1], schoolEnd = b.type === "school" && Math.abs(facing) <= 0.5, bays = Math.max(1, Math.round(e2.len / BAY)), commercial = b.sf !== void 0 ? !!shopE : role === "front" && e2.d < 14, bw = e2.len / bays;
      const part = role === "side" || schoolEnd ? 2 : role === "back" ? 3 : commercial ? 0 : 1, cellSeed = rnd(b.id, ei * 7919 + 13);
      const arc = arcs ? arcs[ei] : null, opn = [];
      let rec = null;
      const flushRec = () => {
        if (!rec) return;
        const { sa, sb, lv, hs, rA, color, tnt } = rec, R = [[sa, bottom], [sb, bottom], [sb, arc.zc], [sa, arc.zc]];
        for (const i of [0, 1, 2, 0, 2, 3]) vert(P(R[i][0], -arc.D, R[i][1]), [e2.n[0], e2.n[1], 0], [R[i][0], R[i][1] - floor0, bays, e2.len], lv, hs, rA, color, tnt);
        rec = null;
      };
      if (arcs && !arc && TW2.num("arcOpen", 1) > 0) {
        const L = edges.length, an = arcs[(ei + 1) % L], ap = arcs[(ei + L - 1) % L];
        if (an) {
          const t = Math.hypot(an.pa[0] - e2.c[0], an.pa[1] - e2.c[1]);
          if (t < e2.len - 0.3) opn.push([e2.len - t, e2.len, an.zc]);
        }
        if (ap) {
          const t = Math.hypot(ap.pb[0] - e2.a[0], ap.pb[1] - e2.a[1]);
          if (t < e2.len - 0.3) opn.push([0, t, ap.zc]);
        }
      }
      const wallRun = (s0, s1, h, pt = part, cw = 0) => {
        const finish = role === "side" && b.type === "townhouse" && !OLD_FINISH.has(h.finish) ? 2 : h.finish, base = rgb(h.tint || h.color), color = role === "side" ? shade(base, 0.93) : base;
        const zt = z + (role === "front" && h.parapet && !pitched ? h.parapet : 0);
        let flags = (h.cage !== null ? FL.cage : 0) | (h.bands ? FL.bands : 0) | (h.ac ? FL.ac : 0) | (h.school ? FL.school : 0) | (h.civic ? FL.civic : 0) | (h.temple ? FL.temple : 0) | (h.wood ? FL.wood : 0) | (b.type === "hall" ? FL.hall : 0) | (h.tall || b.floors >= 7 ? FL.tall : 0) | (shops ? FL.shops : 0) | (h.school && facing > 0.5 ? FL.schoolFront : 0) | (e2 === signEdge ? FL.signEdge : 0) | (b.quiet ? FL.quiet : 0) | (b.sf !== void 0 && pt === 1 && b.type === "apartment" && b.floors >= 7 ? FL.lobby : 0) | (fx3 & 2 ? b.type === "townhouse" ? 16384 : b.type === "apartment" && b.floors <= 5 ? 32768 : 0 : 0);
        let groundCode = 0;
        if (h.civic) {
          const g = h.civic.ground, total = g.reduce((s, x) => s + x[1], 0);
          groundCode = g[0][0] + 64 * (g[1] ? g[1][0] : g[0][0]) + 4096 * Math.round(g[0][1] / total * 10);
        }
        const lv = [F, gh, uh, top - floor0], hs = [pt, finish, h.win, flags], rn = [cellSeed, h.cage !== null ? h.cage : -1, h.win2 ?? h.win, groundCode || cw], tnt = rgb(h.frame);
        const wq = (s02, s12, zb) => {
          const A = [[s02, zb], [s12, zb], [s12, zt], [s02, zt]];
          for (const i of [0, 1, 2, 0, 2, 3]) vert(P(A[i][0], 0, A[i][1]), n3, [A[i][0], A[i][1] - floor0, bays, e2.len], lv, hs, rn, color, tnt);
        };
        if (!opn.length) wq(s0, s1, arc ? arc.zg : bottom);
        else {
          const xs = [.../* @__PURE__ */ new Set([s0, s1, ...opn.flatMap((o) => [o[0], o[1]]).filter((x) => x > s0 && x < s1)])].sort((p, q) => p - q);
          for (let i = 1; i < xs.length; i++) {
            const m = (xs[i - 1] + xs[i]) / 2, o = opn.find((o2) => m > o2[0] && m < o2[1]);
            if (xs[i] - xs[i - 1] > 0.01) wq(xs[i - 1], xs[i], o ? o[2] : bottom);
          }
        }
        if (arc) {
          const sa = Math.max(s0, arc.t0), sb = Math.min(s1, arc.t1), k = pt + "|" + cw;
          if (sb > sa + 0.05) {
            if (rec && rec.k === k && Math.abs(rec.sb - sa) < 0.01) rec.sb = sb;
            else {
              flushRec();
              rec = { k, sa, sb, lv, hs, rA: [rn[0], 15, rn[2], rn[3]], color, tnt };
            }
          }
        }
        if (cageNear && role === "front" && e2.d < 14 && h.cage !== null && !h.civic && !h.wood && !h.school) {
          const d = TW2.num("cageD", 0.5), cc = rgb(CAGES[h.cage]), sd = f32(f32(Math.round(cellSeed * 65535) / 65535) * 911), j0 = Math.round(s0 / bw), j1 = Math.round(s1 / bw), tall = h.tall || F >= 7;
          for (let j = j0; j < j1; j++) for (let k = 1; k < F; k++) {
            const r = twH3(j, k, sd);
            let type = h.win;
            if (!tall && r > 0.8) type = r > 0.9 ? 3 : h.win2 ?? h.win;
            const cg = CAGE[type];
            if (!cg) continue;
            const wm = Math.min(bw - 0.3, (cg[0] + 0.3) * bw / 4.4), za = (cg[2] - 0.15) / 3.2, zb = za + (cg[1] + 0.3) / 3.2, z0 = level(k), va = z0 + za * uh, vb = z0 + zb * uh, sa = (j + 0.5) * bw - wm / 2, sb = sa + wm;
            quad([P(sa, d, va), P(sb, d, va), P(sb, d, vb), P(sa, d, vb)], 11, cc);
            quad([P(sb, d, va), P(sb, 0, va), P(sb, 0, vb), P(sb, d, vb)], 11, cc);
            quad([P(sa, 0, va), P(sa, d, va), P(sa, d, vb), P(sa, 0, vb)], 11, cc);
            quad([P(sa, 0, va), P(sb, 0, va), P(sb, d, va), P(sa, d, va)], P_PLAIN, [0.42, 0.42, 0.4]);
            quad([P(sa, d, vb + 0.04), P(sb, d, vb + 0.04), P(sb, 0, vb + 0.04), P(sa, 0, vb + 0.04)], P_PLAIN, [0.5, 0.51, 0.5]);
          }
        }
        const zi = b.rings.length > 1 ? bottom : top;
        if (inner && zt > zi + 0.01) {
          const I = [[s0, zi], [s1, zi], [s1, zt], [s0, zt]], ni = [-n3[0], -n3[1], 0];
          for (const i of [0, 2, 1, 0, 3, 2]) vert(P(I[i][0], 0, I[i][1]), ni, [I[i][0], I[i][1] - floor0, bays, e2.len], lv, hs, rn, color, tnt);
        }
        if (role === "front" && h.parapet && !pitched) quad([P(s0, -0.1, zt + 0.06), P(s1, -0.1, zt + 0.06), P(s1, 0.15, zt + 0.06), P(s0, 0.15, zt + 0.06)], P_PLAIN, shade(color, 0.85));
      };
      let runStart = 0, runSlot = null, runKey = null, runJ = 0, runCw = 0;
      for (let j = 0; j <= bays; j++) {
        const slot = j < bays ? (() => {
          const m = e2.at((j + 0.5) * bw, 0);
          return slotOf(m[0], m[1]);
        })() : null, grp = j < bays && shopE?.cg ? shopE.cg.get(j) : null, key = slot === null || !shopE ? slot : slot * 2 + (shopE.bays.has(j) ? 1 : 0) + (grp ? 1e5 * (grp.gi + 1) : 0);
        if (j === bays || key !== runKey) {
          if (runKey !== null) wallRun(runStart, j * bw, H(runSlot), shopE ? shopE.bays.has(runJ) ? 0 : 1 : part, runCw);
          runStart = j * bw;
          runSlot = slot;
          runKey = key;
          runJ = j;
          runCw = grp ? grp.code : 0;
        }
      }
      if (arc) {
        flushRec();
        const { D, t0: t02, t1, zc, zg } = arc, g = (s, o) => groundAt(...e2.at(s, o)) + 0.06, bm = zg - 0.3, bc = shade(wallColorOf, 0.96);
        quad([P(0, 0, bm), P(e2.len, 0, bm), P(e2.len, 0, zg), P(0, 0, zg)], P_PLAIN, bc);
        quad([P(0, 0, zc), P(t02, -D, zc), P(t1, -D, zc), P(e2.len, 0, zc)], P_PLAIN, shade(wallColorOf, 0.82));
        quad([P(e2.len, 0, g(e2.len, 0)), P(t1, -D, g(t1, -D)), P(t02, -D, g(t02, -D)), P(0, 0, g(0, 0))], P_DECK, [0.21, 0.205, 0.195]);
        const cs = Array.from({ length: bays - 1 }, (_, j) => (j + 1) * bw).filter((s) => s >= t02 + 0.4 && s <= t1 - 0.4), cc = shade(wallColorOf, 0.97), full = dCtr <= TW2.num("arcColR", 150);
        for (const s of cs) {
          const m = e2.at(s, -0.4);
          box([m[0], m[1], (bottom + zc) / 2], [0.5, 0.5, zc - bottom], P_PLAIN, cc, e2.angle, full ? [2, 3, 5] : [2]);
        }
        if (TW2.num("arcOpen", 1) > 0) {
          const m = e2.at(0.3, -0.4);
          box([m[0], m[1], (bottom + zc) / 2], [0.5, 0.5, zc - bottom], P_PLAIN, cc, e2.angle, full ? [2, 3] : [2]);
        }
      }
      const z1 = F > 1 ? level(1) : top;
      if (commercial && shops && !H(0).wood) for (let j = 0; j < bays; j++) {
        if (shopE && !shopE.bays.has(j)) continue;
        if (shopE?.cg?.has(j)) continue;
        const s0 = j * bw, s1 = s0 + bw, cell = b.id + Math.imul(ei, 7919) + Math.imul(j, 104729), shopR = (k) => rnd(cell, k);
        if (bw >= 2.5 && b.type !== "hall") {
          if (shopR(4) < (shopE ? SHOP_SIGN.h : 0.8)) {
            const zs = z1 - 0.05, i = Math.floor(shopR(5) * 32);
            quad([P(s0 + 0.1, 0.2, zs), P(s1 - 0.1, 0.2, zs), P(s1 - 0.1, 0.2, zs + 0.9), P(s0 + 0.1, 0.2, zs + 0.9)], P_SIGN, WHITE, UV1, i);
            quad([P(s0 + 0.1, 0.03, zs + 0.9), P(s1 - 0.1, 0.03, zs + 0.9), P(s1 - 0.1, 0.2, zs + 0.9), P(s0 + 0.1, 0.2, zs + 0.9)], P_PLAIN, rgb("#4a4d4c"));
          }
          if (!arc && shopR(6) < (shopE ? SHOP_SIGN.awning : 0.4)) quad([P(s0 + 0.1, 1.35, z1 - 0.85), P(s1 - 0.1, 1.35, z1 - 0.85), P(s1 - 0.1, 0.05, z1 - 0.3), P(s0 + 0.1, 0.05, z1 - 0.3)], P_PLAIN, rgb(pick(AWNINGS, shopR(7))));
        }
        if (F >= 2 && shopR(10) < b.style.vsign * (shopE ? shopE.vk : 1)) {
          const s = s1 - 0.35, zb = level(1) + 0.3, zt = Math.min(z - 0.4, zb + (F >= 4 ? 5.2 : 3)), vi = Math.floor(shopR(11) * 16), p0 = e2.at(s, 0.15), p1 = e2.at(s, 1.05), ext = (p, o, hh) => [p[0] + e2.u[0] * o, p[1] + e2.u[1] * o, hh];
          if (zt > zb + 1.4) {
            for (const o of [-0.075, 0.075]) quad([ext(p1, o, zb), ext(p0, o, zb), ext(p0, o, zt), ext(p1, o, zt)], P_VSIGN, WHITE, o < 0 ? [[1, 0], [0, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]], vi);
            quad([ext(p1, -0.075, zb), ext(p1, 0.075, zb), ext(p1, 0.075, zt), ext(p1, -0.075, zt)], P_PLAIN, rgb("#e8e4da"));
          }
        }
      }
      if (!pitched && b.h > 4) quad([P(0, -0.12, z + 0.02), P(e2.len, -0.12, z + 0.02), P(e2.len, 0.12, z + 0.02), P(0, 0.12, z + 0.02)], P_PLAIN, shade(wallColorOf, 0.88));
    });
    const inside = (p) => {
      let yes = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], c = ring[j];
        if (a[1] > p[1] !== c[1] > p[1] && p[0] < (c[0] - a[0]) * (p[1] - a[1]) / (c[1] - a[1]) + a[0]) yes = !yes;
      }
      return yes;
    };
    let tp = null;
    if ((TW2.stair || TW2.heli || TW2.tank || TW2.shed) && !pitched && obb && b.h > 4 && b.rings.length === 1 && !metal) {
      const atT = (du, dv) => [obb.center[0] + obb.u[0] * du + obb.v[0] * dv, obb.center[1] + obb.u[1] * du + obb.v[1] * dv];
      const fitsT = (cu, cv, l, w) => [-1, 1].every((x) => [-1, 1].every((y) => inside(atT(cu + x * l / 2, cv + y * w / 2))));
      const plain = b.type === "hall" || b.type === "school" || !!b.mark, sheds = shedPlan({ key: b.key, type: b.type, floors: b.floors, mark: b.mark, obb, rings: b.rings });
      let aptAddon = null;
      if (!sheds.length && b.type === "apartment" && b.floors <= 5 && !plain && rnd(b.id, 2) < b.addon && obb.width >= 6) {
        const r = (k) => rnd(b.id, k), l = obb.length * (0.4 + r(3) * 0.4), w = obb.width * (0.45 + r(4) * 0.35), cu2 = (r(9) < 0.5 ? -1 : 1) * (obb.length - l) / 2 * 0.85;
        if (fitsT(cu2, (fn[0] * obb.v[0] + fn[1] * obb.v[1] > 0 ? -1 : 1) * (obb.width - w) / 2 * 0.85, l, w)) aptAddon = true;
      }
      const rp = b.type !== "townhouse" && (TW2.stair || TW2.heli || TW2.tank) ? roofPlan({ key: b.key, tall: b.type === "apartment" && b.floors > 11, L: obb.length / 2, W: obb.width / 2, fits: fitsT, stairOK: !aptAddon && !sheds.length }) : null;
      tp = { sheds, rp, w: rp ? rp.w : 0 };
    }
    const deckZ = pitched || metal ? z : top, deckColor = rgb(metal ? b.style.roofMetal ? pick(b.style.roofMetal, hash(b.key, "roof")) : sheetRoofOf(b.key) : b.sceneRoof || H(0).deck);
    if (!pitched || !obb) {
      const pts = ring.map((p) => new THREE.Vector2(p[0], p[1])), holes = b.rings.slice(1).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))), all = [...ring, ...b.rings.slice(1).flat()];
      const r3 = fx3 & 1 && !metal && obb ? { code: b.type === "townhouse" ? 1 : b.type === "apartment" ? b.floors <= 5 ? 2 : b.floors <= 11 ? 3 : 4 : b.type === "hall" || b.type === "factory" ? 5 : b.type === "school" || b.type === "civic" || b.mark ? 6 : 7, ang: Math.round((Math.atan2(obb.u[1], obb.u[0]) + Math.PI) / (2 * Math.PI) * 65535), sd: rnd(b.id, 7116) } : null;
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, holes)) {
        const P = [[...all[i], deckZ], [...all[j], deckZ], [...all[k], deckZ]], n = [0, 0, 1], s = b.id % 97;
        for (const p of P) {
          if (r3) {
            const dx = p[0] - obb.center[0], dy = p[1] - obb.center[1];
            vert(p, n, [p[0] * 0.25 + s, p[1] * 0.25, dx * obb.u[0] + dy * obb.u[1], dx * obb.v[0] + dy * obb.v[1]], [r3.code, Math.min(obb.width / 2, 65), 0, obb.length / 2], [P_DECK, 7, 0, 0], [r3.sd, -1, r3.ang, tp ? tp.w : 0], deckColor, WHITE);
          } else vert(p, n, [p[0] * 0.25 + s, p[1] * 0.25, 0, 0], Z4, [metal ? P_METAL : P_DECK, 7, 0, 0], Z4, deckColor, WHITE);
        }
      }
    }
    if (!obb) return;
    const at = (du, dv) => [obb.center[0] + obb.u[0] * du + obb.v[0] * dv, obb.center[1] + obb.u[1] * du + obb.v[1] * dv], angle = Math.atan2(obb.u[1], obb.u[0]);
    const fits = (cu, cv, l, w) => b.rings.length === 1 && [-1, 1].every((x) => [-1, 1].every((y) => inside(at(cu + x * l / 2, cv + y * w / 2))));
    const e = (du, dv, hh) => [...at(du, dv), hh];
    const addonBox = (cu, cv, l, w, hh, k) => {
      const deck = top, c = at(cu, cv), roofHex = sheetRoofOf(b.key, k);
      box([c[0], c[1], deck + hh / 2], [l, w, hh], P_METAL, rgb(addonWallOf(b.key, k, roofHex)), angle);
      const ee = (du, dv, z2) => [...at(cu + du, cv + dv), z2];
      quad([ee(-l / 2 - 0.15, -w / 2 - 0.2, deck + hh), ee(l / 2 + 0.15, -w / 2 - 0.2, deck + hh), ee(l / 2 + 0.15, w / 2 + 0.2, deck + hh + 0.45), ee(-l / 2 - 0.15, w / 2 + 0.2, deck + hh + 0.45)], P_METAL, rgb(roofHex), [[0, 0], [l / 6, 0], [l / 6, 0.3], [0, 0.3]], 7);
    };
    if (b.roof === "temple" && TW2.temple && b.tw2T) {
      const tileC = rgb(templeRoofHex(b.key)), tile2C = shade(tileC, 0.84), ridgeC = rgb(TEMPLE_RIDGE), hipC = rgb(TEMPLE_HIP), goldC = rgb(TEMPLE_GOLD), wallC = rgb(b.color), g0 = b.ground;
      const emit = (P, dir, part, color, uv = null, layer = 0) => {
        const nn = normalOf(P);
        if (nn[0] * dir[0] + nn[1] * dir[1] + nn[2] * dir[2] < 0) {
          P = P.length === 4 ? [P[0], P[3], P[2], P[1]] : [P[0], P[2], P[1]];
          if (uv) uv = uv.length === 4 ? [uv[0], uv[3], uv[2], uv[1]] : [uv[0], uv[2], uv[1]];
        }
        const n = normalOf(P);
        for (const i of P.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]) vert(P[i], n, uv ? [uv[i][0], uv[i][1], 0, 0] : Z4, Z4, [part, layer, 0, 0], Z4, color, WHITE);
      };
      const frameOf = (cu, cv, axis) => axis === "u" ? { P: (s, t, zz) => e(cu + s, cv + t, zz), D: (ds, dt, dz) => [obb.u[0] * ds + obb.v[0] * dt, obb.u[1] * ds + obb.v[1] * dt, dz] } : { P: (s, t, zz) => e(cu - t, cv + s, zz), D: (ds, dt, dz) => [obb.v[0] * ds - obb.u[0] * dt, obb.v[1] * ds - obb.u[1] * dt, dz] };
      const tentL = (P0, P1, w, h0, h1, color) => {
        const dx = P1[0] - P0[0], dy = P1[1] - P0[1], l = Math.hypot(dx, dy);
        if (l < 1e-4) return;
        const nx = dy / l * w, ny = -dx / l * w, t02 = [P0[0], P0[1], P0[2] + h0], t1 = [P1[0], P1[1], P1[2] + h1];
        emit([[P0[0] + nx, P0[1] + ny, P0[2] - 0.05], [P1[0] + nx, P1[1] + ny, P1[2] - 0.05], t1, t02], [nx, ny, w], P_PLAIN, color);
        emit([[P0[0] - nx, P0[1] - ny, P0[2] - 0.05], [P1[0] - nx, P1[1] - ny, P1[2] - 0.05], t1, t02], [-nx, -ny, w], P_PLAIN, color);
      };
      const ridgeOf = (fr, a1, zb, { ext, up, h, w, mid = true }) => {
        const Lr = a1 + ext, S = mid === 0 ? [-Lr, -a1, a1, Lr] : mid ? [-Lr, -a1, -a1 * 0.4, a1 * 0.4, a1, Lr] : [-Lr, -a1 * 0.5, a1 * 0.5, Lr];
        const sec = S.map((s) => {
          const k = Math.abs(s) / Lr, tip = Math.abs(s) > a1 + 1e-6, top2 = zb + h + up * (mid === 0 ? +tip : k ** 2.4);
          return { s, top: top2, bot: tip ? top2 - 0.22 : zb - 0.15, w: tip ? 0.07 : w };
        });
        for (let i = 0; i < sec.length - 1; i++) {
          const p = sec[i], q = sec[i + 1];
          for (const sg of [-1, 1]) emit([fr.P(p.s, sg * p.w, p.bot), fr.P(q.s, sg * q.w, q.bot), fr.P(q.s, 0, q.top), fr.P(p.s, 0, p.top)], fr.D(0, sg, 0.5), P_PLAIN, ridgeC);
        }
      };
      const skirt = (fr, ao, bo, z0, ai, bi, z1, lift, color, v0, v1, hips) => {
        const E = [[-ao, -bo], [ao, -bo], [ao, bo], [-ao, bo]], I = [[-ai, -bi], [ai, -bi], [ai, bi], [-ai, bi]], out2 = [fr.D(0, -1, 1), fr.D(1, 0, 1), fr.D(0, 1, 1), fr.D(-1, 0, 1)], cut = 0.24;
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4, A = E[i], Bq = E[j], len = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), pa = [A[0] + (Bq[0] - A[0]) * cut, A[1] + (Bq[1] - A[1]) * cut], pb = [A[0] + (Bq[0] - A[0]) * (1 - cut), A[1] + (Bq[1] - A[1]) * (1 - cut)];
          const cA = fr.P(A[0], A[1], z0 + lift), cB = fr.P(Bq[0], Bq[1], z0 + lift), mA = fr.P(pa[0], pa[1], z0), mB = fr.P(pb[0], pb[1], z0), iA = fr.P(I[i][0], I[i][1], z1), iB = fr.P(I[j][0], I[j][1], z1), U = (k) => len * k / 2;
          emit([cA, mA, iA], out2[i], P_TILE, color, [[U(0), v0], [U(cut), v0], [U(cut), v1]]);
          emit([mA, mB, iB, iA], out2[i], P_TILE, color, [[U(cut), v0], [U(1 - cut), v0], [U(1 - cut), v1], [U(cut), v1]]);
          emit([mB, cB, iB], out2[i], P_TILE, color, [[U(1 - cut), v0], [U(1), v0], [U(1 - cut), v1]]);
          if (hips) tentL(iA, cA, 0.2, 0.34, 0.26, hipC);
        }
      };
      const xie = (fr, a, b2, z0, z2, { lift, ridge, pagoda }) => {
        const a1 = Math.max(0.4, a - b2 * 0.45), b1 = b2 * 0.38, z1 = z0 + (z2 - z0) * 0.55;
        skirt(fr, a, b2, z0, a1, b1, z1, lift, tileC, 0, 0.55, true);
        const R0 = fr.P(-a1, 0, z2), R1 = fr.P(a1, 0, z2), I = [[-a1, -b1], [a1, -b1], [a1, b1], [-a1, b1]].map(([s, t]) => fr.P(s, t, z1));
        emit([I[0], I[1], R1, R0], fr.D(0, -1, 1.2), P_TILE, tileC, [[0, 0.55], [a1, 0.55], [a1, 1], [0, 1]]);
        emit([I[2], I[3], R0, R1], fr.D(0, 1, 1.2), P_TILE, tileC, [[0, 0.55], [a1, 0.55], [a1, 1], [0, 1]]);
        emit([I[1], I[2], R1], fr.D(1, 0, 0), P_DECK, shade(wallC, 0.8), [[0, 0], [b1 / 3, 0], [b1 / 6, 0.3]]);
        emit([I[3], I[0], R0], fr.D(-1, 0, 0), P_DECK, shade(wallC, 0.8), [[0, 0], [b1 / 3, 0], [b1 / 6, 0.3]]);
        ridgeOf(fr, a1, z2, ridge);
        if (pagoda) prism(fr.P(0, 0, 0), 0.32, z2 + ridge.h - 0.1, z2 + ridge.h + 1.1, P_PLAIN, goldC, 4);
      };
      const wallsBox = (fr, a, b2, z0, z1, color) => {
        const c = [[-a, -b2], [a, -b2], [a, b2], [-a, b2]], out2 = [fr.D(0, -1, 0), fr.D(1, 0, 0), fr.D(0, 1, 0), fr.D(-1, 0, 0)];
        for (let i = 0; i < 4; i++) {
          const p = c[i], q = c[(i + 1) % 4];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          emit([fr.P(p[0], p[1], z0), fr.P(q[0], q[1], z0), fr.P(q[0], q[1], z1), fr.P(p[0], p[1], z1)], out2[i], P_DECK, color, [[0, 0], [len / 6, 0], [len / 6, (z1 - z0) / 6], [0, (z1 - z0) / 6]]);
        }
      };
      const Lh = obb.length / 2, Wh = obb.width / 2;
      if (b.tw2T === "shrine") {
        const fr = frameOf(0, 0, "u"), a = Lh + 0.5, bb = Wh + 0.6, z0 = z - 0.12, rise = Math.min(1.8, obb.width * 0.3 + 0.4), zr = z0 + rise;
        emit([fr.P(-a, -bb, z0), fr.P(a, -bb, z0), fr.P(a, 0, zr), fr.P(-a, 0, zr)], fr.D(0, -1, 1), P_TILE, tileC, [[0, 0], [a, 0], [a, 1], [0, 1]]);
        emit([fr.P(a, bb, z0), fr.P(-a, bb, z0), fr.P(-a, 0, zr), fr.P(a, 0, zr)], fr.D(0, 1, 1), P_TILE, tileC, [[0, 0], [a, 0], [a, 1], [0, 1]]);
        emit([fr.P(-Lh, -Wh, z), fr.P(-Lh, 0, zr - 0.1), fr.P(-Lh, Wh, z)], fr.D(-1, 0, 0), P_DECK, wallC, [[0, 0], [0.2, 0.3], [0.4, 0]]);
        emit([fr.P(Lh, Wh, z), fr.P(Lh, 0, zr - 0.1), fr.P(Lh, -Wh, z)], fr.D(1, 0, 0), P_DECK, wallC, [[0, 0], [0.2, 0.3], [0.4, 0]]);
        ridgeOf(fr, a - 0.2, zr, { ext: 0.5, up: 0.5, h: 0.16, w: 0.1, mid: 0 });
      } else if (b.tw2T === "rows" || b.tw2T === "court") {
        const plan = templePlan({ id: b.key, L: obb.length, W: obb.width, area: obb.area, h: 4.4 });
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])) emit([[...ring[i], g0 + 0.2], [...ring[j], g0 + 0.2], [...ring[k], g0 + 0.2]], [0, 0, 1], P_DECK, rgb(TEMPLE_FLOOR), [ring[i], ring[j], ring[k]].map((p) => [p[0] * 0.25, p[1] * 0.25]), 7);
        for (const hl of plan.halls || []) {
          const fr = frameOf(hl.cu, hl.cv, hl.axis), ov = hl.wing ? 0.6 : 0.95, ze = g0 + hl.eave, zr = g0 + hl.ridge, small = hl.wing;
          if (hl.dbl) {
            const ins = Math.min(2.4, hl.b * 0.32), zl = ze - 2.5;
            wallsBox(fr, hl.a, hl.b, g0, zl + 0.3, wallC);
            skirt(fr, hl.a + ov, hl.b + ov, zl, hl.a - ins, hl.b - ins, zl + 1.5, 0.5, tile2C, 0, 1, true);
            wallsBox(fr, hl.a - ins, hl.b - ins, zl + 1.3, ze + 0.1, shade(wallC, 0.9));
            xie(fr, hl.a - ins + ov, hl.b - ins + ov, ze, zr, { lift: 0.6, ridge: { ext: 1.7, up: 1.9, h: 0.7, w: 0.28 }, pagoda: true });
          } else {
            wallsBox(fr, hl.a, hl.b, g0, ze + 0.1, wallC);
            xie(fr, hl.a + ov, hl.b + ov, ze, zr, { lift: small ? 0.25 : 0.5, ridge: small ? { ext: 0.7, up: 0.6, h: 0.4, w: 0.2, mid: false } : { ext: 1.4, up: 1.5, h: 0.6, w: 0.26 }, pagoda: false });
          }
        }
      } else {
        const fr = frameOf(0, 0, "u"), a = Lh + 0.7, bb = Wh + 0.8, z0 = z - 0.2, rise = Math.min(4.2, obb.width * 0.3 + 0.6), big = obb.width >= 8;
        xie(fr, a, bb, z0, z0 + rise, { lift: Math.max(0.3, Math.min(0.7, obb.width * 0.05)), ridge: { ext: Math.max(0.8, Math.min(1.8, obb.width * 0.12)), up: Math.max(0.8, Math.min(2, obb.width * 0.13)), h: big ? 0.6 : 0.45, w: big ? 0.26 : 0.2 }, pagoda: big });
      }
    } else if (b.roof === "temple") {
      const L = obb.length / 2 + 0.7, W = obb.width / 2 + 0.8, rise = Math.min(3, obb.width * 0.32 + 0.6), col = rgb(pick(TEMPLE_ROOFS, hash(b.key, "temple-roof"))), ridge = rgb("#c9a23a"), zr = z - 0.2;
      quad([e(-L, -W, zr), e(L, -W, zr), e(L * 0.96, 0, zr + rise), e(-L * 0.96, 0, zr + rise)], P_TILE, col, [[0, 0], [L / 2, 0], [L / 2, 1], [0, 1]]);
      quad([e(L, W, zr), e(-L, W, zr), e(-L * 0.96, 0, zr + rise), e(L * 0.96, 0, zr + rise)], P_TILE, col, [[0, 0], [L / 2, 0], [L / 2, 1], [0, 1]]);
      tri([e(-L + 0.7, -W + 0.8, z), e(-L * 0.96 + 0.5, 0, zr + rise), e(-L + 0.7, W - 0.8, z)], P_PLAIN, rgb(b.color));
      tri([e(L - 0.7, W - 0.8, z), e(L * 0.96 - 0.5, 0, zr + rise), e(L - 0.7, -W + 0.8, z)], P_PLAIN, rgb(b.color));
      box([...at(0, 0), zr + rise + 0.15], [L * 1.9, 0.35, 0.4], P_PLAIN, ridge, angle);
      for (const sgn of [-1, 1]) {
        const x0 = sgn * L * 0.95, x1 = sgn * (L * 0.95 + 0.9), x2 = sgn * (L * 0.95 + 1.5);
        quad([e(x0, -0.16, zr + rise + 0.2), e(x1, -0.16, zr + rise + 0.7), e(x1, 0.16, zr + rise + 0.7), e(x0, 0.16, zr + rise + 0.2)], P_PLAIN, ridge);
        quad([e(x1, -0.12, zr + rise + 0.7), e(x2, -0.12, zr + rise + 1.6), e(x2, 0.12, zr + rise + 1.6), e(x1, 0.12, zr + rise + 0.7)], P_PLAIN, ridge);
      }
      prism(at(0, 0), 0.3, zr + rise + 0.35, zr + rise + 1.1, P_PLAIN, rgb("#d9b44a"), 6);
    } else if (pitched) {
      const L = obb.length / 2 - 0.05, W = obb.width / 2 - 0.05, isMetal = b.roof === "metal", rise = Math.min(isMetal ? 2.4 : 3, obb.width * (isMetal ? 0.18 : 0.28)), color = rgb(b.sceneRoof || (isMetal ? b.style.roofMetal ? pick(b.style.roofMetal, hash(b.key, "roof")) : sheetRoofOf(b.key) : b.tw2Roof || pick(b.style.roofTile || ROOF_TILE, hash(b.key, "roof")))), part = isMetal ? P_METAL : P_TILE, uv = [[0, 0], [obb.length / 6, 0], [obb.length / 6, isMetal ? 0.5 : W / 1.2], [0, isMetal ? 0.5 : W / 1.2]];
      quad([e(-L - 0.3, -W - 0.35, z - 0.12), e(L + 0.3, -W - 0.35, z - 0.12), e(L + 0.3, 0, z + rise), e(-L - 0.3, 0, z + rise)], part, color, uv, 7);
      quad([e(L + 0.3, W + 0.35, z - 0.12), e(-L - 0.3, W + 0.35, z - 0.12), e(-L - 0.3, 0, z + rise), e(L + 0.3, 0, z + rise)], part, color, uv, 7);
      const gable = metal ? rgb(b.color) : wallColorOf;
      tri([e(-L, -W, z), e(-L, 0, z + rise), e(-L, W, z)], P_PLAIN, gable);
      tri([e(L, W, z), e(L, 0, z + rise), e(L, -W, z)], P_PLAIN, gable);
    } else if (b.h > 4 && b.rings.length === 1 && !metal) {
      const n = b.type === "townhouse" ? Math.max(1, Math.round(obb.length / BAY)) : 1, sw = obb.length / n, deck = top, back = fn[0] * obb.v[0] + fn[1] * obb.v[1] > 0 ? -1 : 1, plain = b.type === "hall" || b.type === "school" || !!b.mark;
      const outQ = (P, dir, part, color, uv, layer) => {
        const nn = normalOf(P);
        if (nn[0] * dir[0] + nn[1] * dir[1] + nn[2] * dir[2] < 0) P = [P[0], P[3], P[2], P[1]];
        quad(P, part, color, uv, layer);
      };
      const lv3 = (u, v) => [obb.u[0] * u + obb.v[0] * v, obb.u[1] * u + obb.v[1] * v];
      const stairDoor = (cu, cv, l, w, nu, nv, z0, dw, dh, lip = true) => {
        const off = nu ? l / 2 : w / 2, tu = -nv, tv = nu, ee = (du, dv, z2) => [...at(du, dv), z2], d = [...lv3(nu, nv), 0];
        const fu = cu + nu * (off + 0.03), fv = cv + nv * (off + 0.03);
        outQ([ee(fu - tu * dw / 2, fv - tv * dw / 2, z0 + 0.02), ee(fu + tu * dw / 2, fv + tv * dw / 2, z0 + 0.02), ee(fu + tu * dw / 2, fv + tv * dw / 2, z0 + dh), ee(fu - tu * dw / 2, fv - tv * dw / 2, z0 + dh)], d, P_PLAIN, rgb("#3d4346"));
        const cw = dw / 2 + 0.25, zc = z0 + dh + 0.18, gu = cu + nu * off, gv = cv + nv * off, ou = gu + nu * 0.6, ov = gv + nv * 0.6;
        outQ([ee(gu - tu * cw, gv - tv * cw, zc), ee(gu + tu * cw, gv + tv * cw, zc), ee(ou + tu * cw, ov + tv * cw, zc - 0.08), ee(ou - tu * cw, ov - tv * cw, zc - 0.08)], [0, 0, 1], P_PLAIN, rgb("#b4b7b2"));
        if (lip) outQ([ee(ou - tu * cw, ov - tv * cw, zc - 0.16), ee(ou + tu * cw, ov + tv * cw, zc - 0.16), ee(ou + tu * cw, ov + tv * cw, zc - 0.08), ee(ou - tu * cw, ov - tv * cw, zc - 0.08)], d, P_PLAIN, rgb("#9a9d98"));
      };
      const tankAt = (tu, tv, z0, t, r, colHex, steel) => {
        const c = at(tu, tv);
        quad([[...at(tu - 0.65, tv - 0.65), z0 + 0.5], [...at(tu + 0.65, tv - 0.65), z0 + 0.5], [...at(tu + 0.65, tv + 0.65), z0 + 0.5], [...at(tu - 0.65, tv + 0.65), z0 + 0.5]], P_PLAIN, rgb("#8a908d"));
        for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
          const q = at(tu + dx, tv + dy);
          if (TW2.tank) {
            const ee = (a, bb, z2) => [...at(tu + dx + a, tv + dy + bb), z2];
            for (const [a, bb] of [[0.05, 0], [0, 0.05]]) quad([ee(-a, -bb, z0), ee(a, bb, z0), ee(a, bb, z0 + 0.5), ee(-a, -bb, z0 + 0.5)], P_PLAIN, rgb("#7c8280"));
          } else box([q[0], q[1], z0 + 0.25], [0.08, 0.08, 0.5], P_PLAIN, rgb("#7c8280"), angle, OUT);
        }
        if (r(20 + t) < 0.3) box([c[0], c[1], z0 + 1], [1.2, 1, 1], steel ? P_TANK : P_PLAIN, rgb(steel ? "#e9ebe8" : colHex), angle);
        else prism(c, 0.6, z0 + 0.5, z0 + 1.6 + r(30 + t) * 0.4, steel ? P_TANK : P_PLAIN, rgb(colHex), 8);
      };
      const shedSet = tp ? new Set(tp.sheds.map((s) => s.i)) : null;
      const drawShed = (sh) => {
        const i = sh.i, rr = (k) => rnd(b.id, 7300 + i * 10 + k), lowS = rr(1) < 0.5 ? back : -back, hexC = shedHex(b.key, i, sheetRoofOf), col = rgb(hexC);
        const endA = i === 0 || !shedSet.has(i - 1), endB = i === n - 1 || !shedSet.has(i + 1), u0 = sh.cu - sh.l / 2 - (endA ? 0.15 : 0), u1 = sh.cu + sh.l / 2 + (endB ? 0.15 : 0);
        const sw2 = sh.v1 - sh.v0, zl = z + 2.2, zh = zl + Math.min(1.4, Math.max(0.5, sw2 * 0.1)), vL = lowS > 0 ? sh.v1 + 0.25 : sh.v0 - 0.25, vH = lowS > 0 ? sh.v0 - 0.25 : sh.v1 + 0.25, zAt = (v) => zl + (zh - zl) * (v - vL) / (vH - vL), ee = (du, dv, z2) => [...at(du, dv), z2];
        outQ([ee(u0, vL, zl), ee(u1, vL, zl), ee(u1, vH, zh), ee(u0, vH, zh)], [0, 0, 1], P_METAL, col, [[0, 0], [(u1 - u0) / 6, 0], [(u1 - u0) / 6, sw2 / 6], [0, sw2 / 6]], 7);
        const m = Math.max(2, Math.ceil((u1 - u0 - 0.3) / 4.5) + 1), steelC = rgb("#5f6568");
        for (const pv of [sh.v0 + 0.02, sh.v1 - 0.02]) {
          const zt = zAt(pv);
          for (let j = 0; j < m; j++) {
            if (!endA && j === 0) continue;
            const pu = u0 + 0.15 + (u1 - u0 - 0.3) * j / (m - 1);
            for (const [a, bb] of [[0.06, 0], [0, 0.06]]) quad([ee(pu - a, pv - bb, deck), ee(pu + a, pv + bb, deck), ee(pu + a, pv + bb, zt), ee(pu - a, pv - bb, zt)], P_PLAIN, steelC);
          }
        }
        if (rr(2) < 0.5) {
          const sk = shade(col, 0.9), D = 0.9;
          outQ([ee(u0, vL, zl - D), ee(u1, vL, zl - D), ee(u1, vL, zl), ee(u0, vL, zl)], [...lv3(0, lowS), 0], P_METAL, sk, [[0, 0], [(u1 - u0) / 6, 0], [(u1 - u0) / 6, D / 6], [0, D / 6]]);
          outQ([ee(u0, vH, zh - D), ee(u1, vH, zh - D), ee(u1, vH, zh), ee(u0, vH, zh)], [...lv3(0, -lowS), 0], P_METAL, sk, [[0, 0], [(u1 - u0) / 6, 0], [(u1 - u0) / 6, D / 6], [0, D / 6]]);
          if (endA) outQ([ee(u0, vL, zl - D), ee(u0, vH, zh - D), ee(u0, vH, zh), ee(u0, vL, zl)], [...lv3(-1, 0), 0], P_METAL, sk, [[0, 0], [sw2 / 6, 0], [sw2 / 6, D / 6], [0, D / 6]]);
          if (endB) outQ([ee(u1, vL, zl - D), ee(u1, vH, zh - D), ee(u1, vH, zh), ee(u1, vL, zl)], [...lv3(1, 0), 0], P_METAL, sk, [[0, 0], [sw2 / 6, 0], [sw2 / 6, D / 6], [0, D / 6]]);
        }
      };
      const rp = tp?.rp;
      for (let i = 0; i < n; i++) {
        const cu = -obb.length / 2 + (i + 0.5) * sw, r = (k) => rnd(b.id, i * 100 + k);
        let used = false;
        const shedHere = !!shedSet?.has(i);
        if (shedHere) drawShed(tp.sheds.find((s) => s.i === i));
        if (!shedHere && b.type === "townhouse" && r(2) < b.addon && obb.width >= 3.5) {
          const l = Math.min(sw, BAY) - 0.3, w = obb.width * (0.45 + r(3) * 0.4), cv = back * (obb.width - w) / 2 * 0.9, hh = 2.3 + r(4) * 0.6;
          if (fits(cu, cv, l, w)) {
            addonBox(cu, cv, l, w, hh, i);
            used = true;
          }
        }
        if (!shedHere && b.type === "apartment" && b.floors <= 5 && !plain && i === 0 && r(2) < b.addon && obb.width >= 6) {
          const l = obb.length * (0.4 + r(3) * 0.4), w = obb.width * (0.45 + r(4) * 0.35), cu2 = (r(9) < 0.5 ? -1 : 1) * (obb.length - l) / 2 * 0.85, cv = back * (obb.width - w) / 2 * 0.85, hh = 2.4 + r(11) * 0.5;
          if (fits(cu2, cv, l, w)) {
            addonBox(cu2, cv, l, w, hh, i);
            used = true;
          }
        }
        let stTop = null;
        if (rp && i === 0) {
          if (rp.tu) {
            const [lA, wA] = tuSize(obb.length / 2, Math.min(obb.width / 2, 65)), lB = lA * 0.5, wB = wA * 0.7, sB = rnd(b.id, 7401) < 0.5 ? -1 : 1, cA = at(0, 0), cB = at(sB * (lA - lB) / 2, 0), wc = shade(wallColorOf, 0.95);
            box([cA[0], cA[1], deck + TU.hA / 2], [lA, wA, TU.hA], P_DECK, wc, angle);
            box([cB[0], cB[1], deck + TU.hA + TU.hB / 2], [lB, wB, TU.hB], P_DECK, shade(wc, 0.97), angle);
            stairDoor(-sB * lA / 4, 0, lA, wA, 0, -back, deck, 1, 2.1);
          } else if (rp.k) {
            const [su, sv] = rp.k === 9 ? [0, 0] : stairXY(rp.k, obb.length / 2, Math.min(obb.width / 2, 65)).map(Math.sign), [sc, sd] = stairXY(rp.k, obb.length / 2, Math.min(obb.width / 2, 65)), c = at(sc, sd);
            box([c[0], c[1], deck + 1.3], [ST.l, ST.w, ST.h], P_PLAIN, shade(wallColorOf, 0.95), angle);
            stTop = { cu: sc, cv: sd, l: ST.l, w: ST.w, z: deck + ST.h };
            if (TW2.stair) {
              if (su) stairDoor(sc, sd, ST.l, ST.w, -su, 0, deck, 0.9, 2);
              else if (sv) stairDoor(sc, sd, ST.l, ST.w, 0, -sv, deck, 0.9, 2);
              else stairDoor(sc, sd, ST.l, ST.w, 0, -back, deck, 0.9, 2);
            }
          }
        } else if (!rp && b.type !== "townhouse" && i === 0 && !used && fits(0, 0, 3.4, 2.8)) {
          const c = at(0, 0);
          box([c[0], c[1], deck + 1.3], [3.4, 2.8, 2.6], P_PLAIN, shade(wallColorOf, 0.95), angle);
        }
        if (TW2.stair && b.type === "townhouse" && !used && !shedHere && obb.width >= 4.5 && rnd(b.id, i * 100 + 61) < TW2.num("stairTH", 1)) {
          const l = Math.min(2.2, sw - 0.9), w = 1.8, h = 2.3, su = r(62) < 0.5 ? -1 : 1, scu = cu + su * (sw / 2 - l / 2 - 0.3), scv = back * (obb.width / 2 - w / 2 - 0.3), hc = H(i);
          if (l >= 1.4 && fits(scu, scv, l + 0.1, w + 0.1)) {
            const c = at(scu, scv);
            box([c[0], c[1], deck + h / 2], [l, w, h], P_PLAIN, shade(rgb(hc.tint || hc.color), 0.93), angle, FREE);
            stTop = { cu: scu, cv: scv, l, w, z: deck + h };
            stairDoor(scu, scv, l, w, 0, -back, deck, 0.8, 1.9, false);
          }
        }
        const tanks = b.type === "townhouse" ? r(7) < 0.7 ? 1 : 0 : plain ? 1 : 1 + Math.floor(r(8) * 3);
        const onTop = TW2.tank && stTop ? Math.min(tanks, stTop.l >= 3 ? 2 : 1) : 0;
        for (let t = 0; t < tanks; t++) {
          const tu = b.type === "townhouse" ? cu : (t - 1) * 1.8 + (plain ? 2.4 : 0), tv = (used ? -back : back) * (obb.width / 2 - 1), colHex = pick(TANKS, r(10 + t)), steel = colHex === "#cfd3d6" || colHex === "#c2c7cb";
          if (t < onTop) {
            const du = onTop === 2 ? t ? 0.85 : -0.85 : 0;
            tankAt(stTop.cu + du, stTop.cv, stTop.z, t, r, colHex, steel);
            continue;
          }
          if (rp?.tu && TW2.tank) continue;
          let [xu, xv] = [tu, tv];
          const hit = (pu, pv) => stTop && TW2.stair && Math.abs(pu - stTop.cu) < stTop.l / 2 + 0.8 && Math.abs(pv - stTop.cv) < stTop.w / 2 + 0.8;
          if (hit(xu, xv)) {
            [xu, xv] = b.type === "townhouse" ? [cu + (stTop.cu < cu ? 1 : -1) * (sw / 2 - 0.95), tv] : [tu, -tv];
            if (hit(xu, xv)) continue;
          }
          if (obb.width >= 2.6 && fits(xu, xv, 1.5, 1.5)) tankAt(xu, xv, deck, t, r, colHex, steel);
        }
        if (!plain && r(40) < 0.15 && fits(cu, -back * (obb.width / 2 - 1.2), 1.8, 1.4) && !(stTop && TW2.stair && Math.abs(cu - stTop.cu) < stTop.l / 2 + 0.9 && Math.abs(-back * (obb.width / 2 - 1.2) - stTop.cv) < stTop.w / 2 + 0.7)) {
          const ee = (du, dv, z2) => [...at(cu + du, -back * (obb.width / 2 - 1.2) + dv), z2];
          quad([ee(-0.9, -0.6, deck + 0.3), ee(0.9, -0.6, deck + 0.3), ee(0.9, 0.6, deck + 1.2), ee(-0.9, 0.6, deck + 1.2)], P_TANK, rgb("#2f3e57"));
        }
      }
    }
  }
  let skipped = 0;
  for (const src of buildings) {
    const ring = src.rings[0];
    if (!ring || ring.length < 3) {
      skipped++;
      continue;
    }
    let gmin = Infinity, cx = 0, cy = 0;
    for (const p of ring) {
      gmin = Math.min(gmin, groundAt(p[0], p[1]));
      cx += p[0] / ring.length;
      cy += p[1] / ring.length;
    }
    if (only && !only(cx, cy)) continue;
    const sfe = shopfronts ? shopfronts.b[src.id] : void 0, sf = !shopfronts ? void 0 : sfe && sfe.r === ring.length ? new Map(sfe.e.map(([ei, bays, vk, cv]) => [ei, { bays: new Set(bays), vk, cg: cv?.length ? new Map(cv.flatMap(([brand, j0, n], gi) => Array.from({ length: n }, (_, d) => [j0 + d, { gi, code: cvsCode(brand, j0, n) }]))) : null }])) : null;
    const b = { sf, quiet: !!(shopfronts && shopfronts.x[src.id]), key: src.id, id: seed(src.id), type: src.type || "townhouse", floors: Math.max(1, src.floors || 1), h: Math.max(3, src.h || 6), color: src.wall || "#d0cfca", roof: src.roof || "flat", finish: src.finish, addon: Number(src.addon) || 0.3, style: STYLES[src.style] || HILL_STYLES[src.style] || STYLES.town, styleKey: src.style, mark: src.mark, markName: src.markName, sceneRoof: src.sceneRoof, rings: src.rings, ground: gmin, cols: src.canopy?.cols, facility: src.facility };
    if (src.tw2Roof) b.tw2Roof = src.tw2Roof;
    if (src.tw2T) b.tw2T = src.tw2T;
    if (src.tw2Tank) b.tw2Tank = src.tw2Tank;
    if (src.tw2Gh) b.tw2Gh = src.tw2Gh;
    if (src.tw2Plain) b.tw2Plain = 1;
    if (src.tw2Gym) b.tw2Gym = src.tw2Gym;
    if (src.tw2Stand) b.tw2Stand = src.tw2Stand;
    const key = Math.floor(cx / chunkSize) + "," + Math.floor(cy / chunkSize);
    let c = chunks.get(key);
    if (!c) chunks.set(key, c = { data: [], index: [], n: 0, count: 0 });
    out = c;
    c.count++;
    try {
      buildOne(b);
    } catch (err) {
      skipped++;
    }
  }
  const result = [];
  let verts = 0, rawVerts = 0, bytes = 0;
  for (const [key, c] of chunks) {
    if (!c.n) continue;
    const packed = packChunk(c);
    verts += c.n;
    rawVerts += c.index.length;
    bytes += packed.bytes;
    result.push({ key, buildings: c.count, ...packed });
  }
  return { chunks: result, verts, rawVerts, bytes, rawBytes: rawVerts * STRIDE * 4, skipped, ms: performance.now() - t0 };
}
export function packChunk(c) {
  const n = c.n, d = c.data, pos = new Float32Array(n * 3), nor = new Int8Array(n * 4), sv = new Float32Array(n * 4), lv = new Uint16Array(n * 4), hs = new Uint16Array(n * 4), rn = new Uint16Array(n * 4), col = new Uint8Array(n * 4), tnt = new Uint8Array(n * 4);
  const u16 = (v) => Math.max(0, Math.min(65535, Math.round(v))), c8 = (v) => Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 255);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE, a = i * 3, b = i * 4;
    pos[a] = d[o];
    pos[a + 1] = d[o + 1];
    pos[a + 2] = d[o + 2];
    nor[b] = Math.round(d[o + 3] * 127);
    nor[b + 1] = Math.round(d[o + 4] * 127);
    nor[b + 2] = Math.round(d[o + 5] * 127);
    sv[b] = d[o + 6];
    sv[b + 1] = d[o + 7];
    sv[b + 2] = d[o + 8];
    sv[b + 3] = d[o + 9];
    lv[b] = u16(d[o + 10]);
    lv[b + 1] = u16(d[o + 11] * 1e3);
    lv[b + 2] = u16(d[o + 12] * 1e3);
    lv[b + 3] = u16(d[o + 13] * 100);
    hs[b] = u16(d[o + 14]);
    hs[b + 1] = u16(d[o + 15]);
    hs[b + 2] = u16(d[o + 16]);
    hs[b + 3] = u16(d[o + 17]);
    rn[b] = u16(d[o + 18] * 65535);
    rn[b + 1] = u16(d[o + 19] + 1);
    rn[b + 2] = u16(d[o + 20]);
    rn[b + 3] = u16(d[o + 21]);
    col[b] = c8(d[o + 22]);
    col[b + 1] = c8(d[o + 23]);
    col[b + 2] = c8(d[o + 24]);
    col[b + 3] = 255;
    tnt[b] = c8(d[o + 25]);
    tnt[b + 1] = c8(d[o + 26]);
    tnt[b + 2] = c8(d[o + 27]);
    tnt[b + 3] = 255;
  }
  const idx = n > 65535 ? Uint32Array.from(c.index) : Uint16Array.from(c.index);
  return { pos, nor, sv, lv, hs, rn, col, tnt, idx, n, bytes: n * 64 + idx.byteLength };
}
