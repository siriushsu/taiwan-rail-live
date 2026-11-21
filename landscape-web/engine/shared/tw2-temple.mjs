const h01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) % 1000003 / 1000003;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wpick = (list, r) => {
  const tot = list.reduce((s, x) => s + x[1], 0);
  let t = r * tot;
  for (const [v, w] of list) {
    if ((t -= w) < 0) return v;
  }
  return list.at(-1)[0];
};
export const TEMPLE_TILE = [["#934627", 3], ["#8a3f22", 2], ["#9c4e2a", 2], ["#a85a2c", 1.4], ["#b07a30", 0.9], ["#3f7f55", 0.5]];
export const TEMPLE_WALL = ["#8f3324", "#9a3a2a", "#86301f"];
export const TEMPLE_RIDGE = "#6f938d", TEMPLE_HIP = "#b4b2a8", TEMPLE_GOLD = "#c9a23a", TEMPLE_FLOOR = "#9a978e";
export const templeRoofHex = (id) => wpick(TEMPLE_TILE, h01(id + "|tw2-temple-roof"));
export const templeWallHex = (id) => TEMPLE_WALL[Math.floor(h01(id + "|tw2-temple-wall") * TEMPLE_WALL.length)];
export function notTempleKind(name = "") {
  if (!name || /佛教/.test(name)) return null;
  if (/教會|天主堂|教堂|禮拜堂|聖徒|基督|福音|清真寺|台北聖殿/.test(name)) return "church";
  if (/靜思堂/.test(name)) return "jingsi";
  return null;
}
export function templePlan({ id, L, W, area, h }) {
  const fill = area / Math.max(1, L * W);
  if (h > 8) return { kind: "tall" };
  if (area < 30 || W < 4.5) return { kind: "shrine", wallH: clamp(2.2 + W * 0.22, 2.6, 3.4) };
  if (area < 420 || L < 26 || fill < 0.55) return { kind: "single" };
  const halls = [], wallH = 3;
  if (W < 30) {
    const n = clamp(Math.round(L / 15), 2, 4), d = clamp(L / n * 0.58, 6, 13) / 2, mid = n === 2 ? 1 : Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      const cu = n === 1 ? 0 : -L / 2 + d + (L - 2 * d) * i / (n - 1), top = i === mid, eave = top ? 5.6 : 4.4, rise = clamp(d * 0.62 + 0.8, 2.2, 4.6);
      halls.push({ cu, cv: 0, a: W / 2 - 0.2, b: d, axis: "v", eave, ridge: eave + rise + (top ? 0.8 : 0), dbl: top && W >= 16 && d >= 5 });
    }
    return { kind: "rows", wallH, halls };
  }
  const Lc = Math.min(L, 58), Wc = Math.min(W, 46), dF = clamp(Lc * 0.16, 7, 10) / 2, wW = 3.4;
  for (const sg of [-1, 1]) halls.push({ cu: sg * (Lc / 2 - dF), cv: 0, a: Wc / 2 - 0.2, b: dF, axis: "v", eave: sg < 0 ? 4.4 : 5, ridge: (sg < 0 ? 4.4 : 5) + clamp(dF * 0.62 + 0.8, 2.4, 4.2) });
  for (const sg of [-1, 1]) halls.push({ cu: 0, cv: sg * (Wc / 2 - wW), a: Lc / 2 - 2 * dF - 0.3, b: wW, axis: "u", eave: 3.8, ridge: 5.9, wing: true });
  const ma = clamp(Wc * 0.26, 7, 12), mb = clamp(Lc * 0.15, 5.5, 8.5);
  halls.push({ cu: Lc * 0.04, cv: 0, a: ma, b: mb, axis: "v", eave: 6.6, ridge: 6.6 + clamp(mb * 0.62 + 1.2, 3.6, 5.6), dbl: true });
  return { kind: "court", wallH, halls };
}
export function tankOf(b, byClass = false) {
  if (b.rings.length !== 1 || !byClass && (b.markName || b.mark || !/^(apartment|townhouse|hall|shed|factory)$/.test(b.type || "townhouse"))) return null;
  const r = b.rings[0];
  if (r.length < (byClass ? 6 : 10)) return null;
  let a = 0, p = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const u = r[i], v = r[(i + 1) % r.length];
    a += u[0] * v[1] - v[0] * u[1];
    p += Math.hypot(v[0] - u[0], v[1] - u[1]);
    cx += u[0];
    cy += u[1];
  }
  a = Math.abs(a) / 2;
  const rad = Math.sqrt(a / Math.PI);
  return 4 * Math.PI * a / (p * p) >= (byClass ? 0.8 : 0.93) && rad >= (byClass ? 1.5 : 4) ? { r: rad, c: [cx / r.length, cy / r.length] } : null;
}
export const TANK_WALL = [["#c0c0ba", 7], ["#b4b8b9", 2], ["#abb9a8", 1]];
function byClassOf(b, cls, obbOf) {
  const est = b.floorsFrom === "estimate" || !(b.h > 4.5);
  if (cls === "storage_tank" || cls === "silo") {
    const tk = tankOf(b, true);
    if (!tk) return null;
    const wall = wpick(TANK_WALL, h01(b.id + "|tw2-tank")), h = est ? cls === "silo" ? clamp(tk.r * 2.4, 8, 26) : clamp(tk.r, 3, 22) : b.h;
    return { ...b, type: "shed", roof: "tank", floors: 1, h, wall, color: void 0, addon: 0, mark: void 0, tw2Roof: wall, tw2Tank: tk };
  }
  const o = obbOf && b.rings.length === 1 ? obbOf(b.rings[0]) : null;
  const cols = (o2, gap = 6) => {
    if (!o2) return [];
    const L = o2.length / 2 - 0.5, W = o2.width / 2 - 0.5, n = Math.max(1, Math.round(o2.length / gap)), out = [];
    if (L <= 0 || W <= 0) return out;
    for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
      const a = -L + 2 * L * i / n;
      out.push([o2.center[0] + o2.u[0] * a + o2.v[0] * s * W, o2.center[1] + o2.u[1] * a + o2.v[1] * s * W]);
    }
    return out;
  };
  if (cls === "greenhouse") {
    const c = h01(b.id + "|tw2-gh") < 0.7 ? "#bcc4bf" : "#b0b9b3", h = est ? 4.2 : clamp(b.h, 3.2, 6);
    if (o && o.fill >= 0.78 && o.width >= 4) return { ...b, type: "shed", roof: "tank", floors: 1, h, wall: c, color: void 0, addon: 0, mark: void 0, tw2Roof: c, tw2Gh: { c: o.center, u: o.u, v: o.v, L: o.length / 2, W: o.width / 2, n: Math.max(1, Math.round(o.width / 7)) } };
    return { ...b, type: "canopy", roof: "tank", floors: 1, h: Math.min(h, 3.8), wall: c, color: void 0, addon: 0, tw2Roof: c, canopy: { cols: cols(o, 8) } };
  }
  if (cls === "carport") {
    const c = h01(b.id + "|tw2-cp") < 0.5 ? "#8f989c" : "#7f8a86";
    return { ...b, type: "canopy", roof: "tank", floors: 1, h: est ? 3.2 : Math.min(b.h, 5), wall: c, color: void 0, addon: 0, tw2Roof: c, canopy: { cols: cols(o) } };
  }
  if (cls === "hangar") return { ...b, type: "factory", roof: "metal", floors: 1, h: est ? 12 : b.h, addon: 0 };
  return null;
}
export function govOf(b, kind, LM) {
  if (b.mark || !/^(apartment|townhouse|hall)$/.test(b.type || "")) return null;
  const est = !!b.illustrative || b.floorsFrom === "estimate" || !(b.h > 4.5), mk = kind === "court" || !est && b.floors >= 7 ? "government" : kind, sp = LM?.[mk];
  if (!sp) return null;
  const fl = kind === "court" ? [4, 5, 5, 6] : sp.floors, floors = est ? fl[Math.floor(h01(b.id + "|tw2-gov") * fl.length)] : b.floors, h = est ? floors * 3.4 + 0.8 : b.h, wall = sp.walls[Math.floor(h01(b.id + "|tw2-govw") * sp.walls.length)];
  return { ...b, type: "civic", mark: mk, wall, color: wall, roof: "flat", finish: null, floors, h, tw2Gov: kind };
}
const GYM_ROOF = [["#6d8ea6", 3], ["#5d8a78", 2], ["#a55a44", 2], ["#b4b9ba", 3], ["#77848f", 2]], GYM_WALL = ["#e6e2d8", "#dad5c9", "#e9e6df", "#d3d9da"], SEAT = [["#4a6f9c", 3], ["#a8503f", 2], ["#4a8a6a", 2], ["#c08a3a", 1], ["#8c9093", 2]];
export function sportOf(b, v, obbOf, LM) {
  const kind = Array.isArray(v) ? v[0] : v, est = !!b.illustrative || b.floorsFrom === "estimate" || !(b.h > 4.5);
  if (/^(temple|facility|canopy|construction)$/.test(b.type || "")) return null;
  if (kind === "center") {
    const sp = LM?.government;
    if (!sp || b.mark || !/^(apartment|townhouse)$/.test(b.type || "")) return null;
    const fl = [4, 5, 5, 6], floors = est ? fl[Math.floor(h01(b.id + "|tw2-ctr") * fl.length)] : b.floors, wall = sp.walls[Math.floor(h01(b.id + "|tw2-ctrw") * sp.walls.length)];
    return { ...b, type: "civic", mark: "government", wall, color: wall, roof: "flat", finish: null, floors, h: est ? floors * 3.4 + 0.8 : b.h, tw2Gov: "center" };
  }
  if (kind === "gym" || kind === "cover") {
    if (b.rings.length !== 1 || !obbOf) return null;
    const o = obbOf(b.rings[0]);
    if (!o || o.fill < 0.78 || o.width < 10) return null;
    const open = kind === "cover", rise = clamp(o.width * 0.17, 2.2, 8), eave = open ? clamp(o.width * 0.25, 6, 9) : est ? clamp(o.width * 0.32, 8, 14) : clamp(b.h - rise * 0.5, 7, 40), roof = wpick(GYM_ROOF, h01(b.id + "|tw2-gymr")), wall = GYM_WALL[Math.floor(h01(b.id + "|tw2-gymw") * GYM_WALL.length)];
    return { ...b, type: "shed", roof: "tank", floors: 1, h: eave + rise, wall: open ? roof : wall, color: void 0, addon: 0, mark: void 0, tw2Roof: roof, tw2Gym: { c: o.center, u: o.u, v: o.v, L: o.length / 2, W: o.width / 2, eave, rise, open, roof } };
  }
  if (kind === "bowl" || kind === "stand") {
    const cen = (r) => {
      let x = 0, y = 0;
      for (const p of r) {
        x += p[0] / r.length;
        y += p[1] / r.length;
      }
      return [x, y];
    }, ar = (r) => {
      let a = 0;
      for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      return Math.abs(a) / 2;
    };
    const c0 = cen(b.rings[0]);
    let f, radial = true;
    if (kind === "bowl") {
      if (b.rings.length < 2) return null;
      f = cen([...b.rings.slice(1)].sort((p, q) => ar(q) - ar(p))[0]);
    } else {
      if (!Array.isArray(v) || v.length < 3) return null;
      f = [c0[0] + v[1], c0[1] + v[2]];
      const o = obbOf && b.rings.length === 1 ? obbOf(b.rings[0]) : null;
      radial = !o || o.fill < 0.6;
    }
    const dl = Math.hypot(c0[0] - f[0], c0[1] - f[1]) || 1, dir = [(c0[0] - f[0]) / dl, (c0[1] - f[1]) / dl], dOf = (p) => radial ? Math.hypot(p[0] - f[0], p[1] - f[1]) : (p[0] - f[0]) * dir[0] + (p[1] - f[1]) * dir[1];
    let d0 = 1e9, d1 = -1e9;
    for (const r of b.rings) for (const p of r) {
      const d = dOf(p);
      d0 = Math.min(d0, d);
      d1 = Math.max(d1, d);
    }
    if (!(d1 - d0 >= 4)) return null;
    const h = Math.min(est ? clamp((d1 - d0) * 0.42, 5, 24) : clamp(b.h, 5, 45), Math.max(5, (d1 - d0) * 0.6));
    return { ...b, type: "shed", roof: "tank", floors: 1, h, wall: "#b9b7b0", color: void 0, addon: 0, mark: void 0, tw2Roof: "#b9b7b0", tw2Stand: { f, radial, dir, d0, d1, seat: wpick(SEAT, h01(b.id + "|tw2-seat")) } };
  }
  return null;
}
export function campusOf(b, LM) {
  const sp = LM?.school;
  if (!sp || b.mark || !/^(apartment|townhouse)$/.test(b.type || "")) return null;
  const est = !!b.illustrative || b.floorsFrom === "estimate" || !(b.h > 4.5), floors = est ? sp.floors[Math.floor(h01(b.id + "|tw2-cmp") * sp.floors.length)] : b.floors, h = est ? floors * 3.4 + 0.8 : b.h, wall = sp.walls[Math.floor(h01(b.id + "|tw2-cmpw") * sp.walls.length)];
  return { ...b, type: "school", mark: "school", wall, color: wall, roof: "flat", finish: null, floors, h, tw2Campus: 1 };
}
export function tw2Building(b, { temple, church, otank: tank }, obbOf, cls = null, gov = null, LM = null) {
  if (gov) {
    const k = Array.isArray(gov) ? gov[0] : gov, o2 = k === "campus" ? campusOf(b, LM) : /^(gym|cover|bowl|stand|center)$/.test(k) ? sportOf(b, gov, obbOf, LM) : govOf(b, gov, LM);
    if (o2) return o2;
  }
  if (cls && b.type !== "temple") {
    const o2 = byClassOf(b, cls, obbOf);
    if (o2) return o2;
  }
  if (tank && b.type !== "temple") {
    const tk = tankOf(b);
    if (tk) {
      const est2 = b.floorsFrom === "estimate" || !(b.h > 4.5), h = est2 ? clamp(tk.r, 7, 22) : b.h, wall = wpick(TANK_WALL, h01(b.id + "|tw2-tank"));
      return { ...b, type: "shed", roof: "tank", floors: 1, h, wall, color: void 0, addon: 0, tw2Roof: wall, tw2Tank: tk };
    }
  }
  if (b.type !== "temple") return b;
  const nk = church ? notTempleKind(b.markName) : null, est = b.floorsFrom === "estimate" || !(b.h > 4.5), r = h01(b.id + "|tw2-nt");
  if (nk === "church") {
    const floors = est ? r < 0.45 ? 3 : 2 : b.floors, h = est ? floors * 3.6 + 0.8 : b.h;
    return { ...b, type: "civic", mark: "church", wall: r < 0.5 ? "#ecebe6" : "#e2ddd2", color: void 0, roof: h <= 13 ? "tile" : "flat", floors, h, tw2Roof: r < 0.6 ? "#7d4a3c" : "#6f7376" };
  }
  if (nk === "jingsi") {
    const floors = est ? 3 : b.floors, h = est ? 13.6 : b.h;
    return { ...b, type: "civic", mark: "government", wall: "#b3b1aa", color: void 0, roof: h <= 20 ? "tile" : "flat", floors, h, tw2Roof: "#75777a" };
  }
  if (!temple || b.roof !== "temple") return b;
  const o = obbOf(b.rings[0]), ring = b.rings[0];
  let a2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  let plan = o ? templePlan({ id: b.id, L: o.length, W: o.width, area: Math.abs(a2) / 2, h: Math.max(3, b.h || 6) }) : { kind: "single" };
  if (b.rings.length > 1 && plan.halls && plan.kind !== "court") plan = { kind: "single" };
  return { ...b, wall: templeWallHex(b.id), h: plan.wallH ?? b.h, tw2T: plan.kind };
}
export function tw2Parts(bj, pj) {
  const sa = (r) => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }, out = [];
  for (const b of bj) {
    const ps = pj[b.id];
    if (!ps || !b.rings?.[0] || /^(temple|facility|canopy|construction)$/.test(b.type || "")) {
      out.push(b);
      continue;
    }
    const sgn = sa(b.rings[0]) >= 0 ? 1 : -1;
    ps.forEach(([fl, h, flat], k) => {
      const ring = [];
      for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
      if (ring.length < 3) return;
      const a = sa(ring);
      if ((a >= 0 ? 1 : -1) !== sgn) ring.reverse();
      const type = /^(civic|school|shed|factory)$/.test(b.type) ? b.type : fl >= 6 || b.type === "townhouse" && Math.abs(a) >= 500 ? "apartment" : b.type;
      out.push({ ...b, id: b.id + "#" + k, rings: [ring], floors: Math.max(1, fl), h: Math.max(3, h), type, roof: /^(shed|factory)$/.test(type) ? b.roof : "flat", illustrative: false, floorsFrom: "part", markName: k ? "" : b.markName, tw2Part: 1, ...Math.abs(a) < 60 ? { tw2Plain: 1 } : {} });
    });
  }
  return out;
}
