const PARAPET = 0.8;
const ROUTE_GAP_M = 30, ROUTE_CAP_M = 8.8;
const SOURCE_HEIGHT = /source height attribute|source-derived|unresolved/i, ILLUSTRATIVE = /illustrative|unknown|fallback|massing/i;
export const STYLES = {
  town: {
    label: "市鎮街屋",
    townhouse: [2, 3, 3, 3, 4, 4, 4, 5],
    apartment: [4, 5, 6],
    hall: [3, 4],
    pitched: 0.05,
    addon: 0.3,
    walls: ["#f0ede5", "#e8e1d2", "#dcdad3", "#ead9c3", "#e3c6b6", "#d9d2c2", "#efe6d4", "#d6d8d2"],
    finish: [3, 4, 3, 1],
    windows: [[0, 3], [1, 3], [2, 2], [3, 2], [4, 1], [5, 1], [7, 2], [8, 1], [9, 1], [12, 1], [13, 2], [14, 2]],
    grill: 0.45,
    vsign: 0.4,
    accent: 0.25,
    rowShare: 0.8
  },
  city: {
    label: "都市中心",
    townhouse: [3, 4, 4, 5, 5, 6],
    apartment: [7, 8, 10, 12, 14],
    hall: [4, 5, 6],
    pitched: 0,
    addon: 0.35,
    walls: ["#e7e5df", "#d3d4d0", "#c8c9c6", "#dacfbf", "#cbaea1", "#bab5ac", "#ddd8cf"],
    finish: [3, 2, 1, 3],
    windows: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [6, 3], [7, 1], [9, 1], [10, 1], [11, 1], [14, 2]],
    grill: 0.25,
    vsign: 0.5,
    accent: 0.2,
    rowShare: 0.5
  },
  hilltown: {
    label: "山城市街",
    townhouse: [3, 4, 4, 4, 5, 5, 6],
    apartment: [5, 6, 7, 8],
    hall: [3, 4],
    pitched: 0.05,
    addon: 0.4,
    walls: ["#e4ded2", "#d6cfc2", "#dcc3b2", "#c4a493", "#e8e5dc", "#c9cdc6", "#b9c9c4", "#d9c9a8"],
    finish: [2, 3, 4, 1],
    windows: [[0, 2], [1, 3], [3, 2], [5, 2], [7, 2], [8, 3], [12, 1], [13, 3], [14, 1]],
    grill: 0.6,
    vsign: 0.55,
    accent: 0.25,
    rowShare: 0.8
  },
  // 農村（後壁、保安照片）：街心二到四層白／米色磁磚透天，外圍一兩層；紅磚老屋配紅瓦；穀倉、鐵皮工寮
  village: {
    label: "農村聚落",
    townhouse: [1, 2, 2, 2, 3, 3, 4],
    apartment: [3, 4],
    hall: [2, 3],
    pitched: 0.4,
    addon: 0.3,
    factory: 0.5,
    walls: ["#e6e3da", "#d8d4c9", "#cfcfc9", "#d9cdb8", "#e8d6c4", "#e0c2ae", "#bfc2bb"],
    finish: [3, 3, 3, 0, 1.6, 0.5, 0],
    windows: [[0, 3], [1, 2], [5, 2], [7, 2], [8, 2], [9, 1], [13, 2]],
    grill: 0.45,
    vsign: 0.15,
    accent: 0.3,
    rowShare: 0.7,
    roofTile: ["#8f513c", "#9a5c44", "#7d4a3a", "#6f6964"],
    roofMetal: ["#5a7fa6", "#a9b0b2", "#9a5240", "#7d8f99"]
  },
  // 礦業山城（菁桐、平溪照片）：沿河谷鐵道的二到四層水泥屋，灰白外牆水漬、青苔明顯，少數粉藍粉紅；一兩層老屋黑色油毛氈斜頂；鐵皮加蓋多
  mining: {
    label: "礦業山城",
    townhouse: [2, 2, 3, 3, 3, 4, 4],
    apartment: [4, 5, 5],
    hall: [2, 3],
    pitched: 0.45,
    addon: 0.55,
    walls: ["#cfccc3", "#c2c0b8", "#d9d6cc", "#b9b8b1", "#e0ddd3", "#c9c3b6"],
    finish: [1, 1, 2, 0, 1.2, 5, 0],
    windows: [[0, 3], [1, 4], [5, 2], [7, 2], [8, 3], [13, 2]],
    grill: 0.65,
    vsign: 0.25,
    accent: 0.22,
    rowShare: 0.85,
    roofTile: ["#353637", "#3f4143", "#2e3032", "#4a4b4c"],
    roofMetal: ["#7d8f99", "#6f8592", "#8e9ea6", "#8b6f5c", "#9aa0a0"]
  },
  // 花東縱谷（池上、玉里、關山照片）：一到三層、低密度，白／米色磁磚水泥屋；日式木造老屋配深灰瓦；店面大招牌
  east: {
    label: "花東縱谷",
    townhouse: [1, 2, 2, 2, 3, 3, 3],
    apartment: [3, 4, 4],
    hall: [2, 3],
    pitched: 0.3,
    addon: 0.35,
    walls: ["#efece4", "#e7e0d0", "#dcd9d0", "#ece4d6", "#e2d3c0", "#d9dcd6"],
    finish: [4, 3, 2, 0, 0, 0, 1],
    windows: [[0, 3], [1, 2], [2, 2], [5, 1], [7, 2], [9, 1], [13, 1]],
    grill: 0.4,
    vsign: 0.35,
    accent: 0.25,
    rowShare: 0.75,
    roofTile: ["#55585a", "#5f5f5c", "#4d5052"],
    roofMetal: ["#5a7fa6", "#7d8f99", "#a9b0b2", "#9a5240", "#6f8f78"]
  },
  // 海線漁村（龍港照片）：一層紅磚老屋、深灰瓦、白灰泥牆；港邊二三層白色水泥屋，海風水漬
  coastal: {
    label: "海線漁村",
    townhouse: [1, 1, 2, 2, 2, 3, 3, 4],
    apartment: [3, 4, 5],
    hall: [2, 3],
    pitched: 0.4,
    addon: 0.3,
    walls: ["#eeede8", "#e3e2dc", "#d8d8d3", "#e8e4da", "#d3d7d6", "#ece6dc"],
    finish: [3, 1, 3, 0, 2, 2, 0],
    windows: [[0, 3], [1, 3], [5, 2], [7, 1], [8, 2], [13, 1]],
    grill: 0.55,
    vsign: 0.15,
    accent: 0.2,
    rowShare: 0.8,
    roofTile: ["#57595b", "#626364", "#4c4e50"],
    roofMetal: ["#5f86a8", "#7d8f99", "#a9b0b2", "#4f79a6"]
  },
  // 山線老街（內灣、集集照片）：日式木造老屋（深色雨淋板、白框木窗、深灰瓦）夾在二三層街屋之間
  oldtown: {
    label: "山線老街",
    townhouse: [1, 2, 2, 2, 3, 3, 4],
    apartment: [4, 5],
    hall: [2, 3],
    pitched: 0.45,
    addon: 0.3,
    walls: ["#ece8de", "#e2ddd0", "#d6d2c6", "#e6dccb", "#d9cdb8", "#cfd2cc"],
    finish: [2, 2, 3, 0, 1, 0, 1.6],
    windows: [[0, 3], [1, 3], [5, 2], [7, 2], [8, 1], [9, 1], [13, 2]],
    grill: 0.45,
    vsign: 0.35,
    accent: 0.2,
    rowShare: 0.8,
    roofTile: ["#4e5153", "#5b5d5e", "#646361", "#45484a"],
    roofMetal: ["#7d8f99", "#a9b0b2", "#6f8592", "#9a5240"]
  }
};
const AREA_STYLE = {
  hukou: "town",
  zhongli: "city",
  ruifang: "hilltown",
  shuili: "hilltown",
  houtong: "mining",
  pingxi: "mining",
  shifen: "mining",
  jingtong: "mining",
  chishang: "east",
  guanshan: "east",
  fuli: "east",
  yuli: "east",
  ruisui: "east",
  luye: "east",
  fengtian: "east",
  shoufeng: "east",
  dafu: "east",
  qiding: "coastal",
  tanwen: "coastal",
  longgang: "coastal",
  xinpu: "coastal",
  dashan: "coastal",
  waiao: "coastal",
  fulong: "coastal",
  houbi: "village",
  nanjing: "village",
  longtian: "village",
  yongjing: "village",
  baoan: "village",
  neiwan: "oldtown",
  sanyi: "oldtown",
  tongluo: "oldtown",
  jiji: "oldtown"
};
export const REDBRICK_WALLS = ["#a5583f", "#b0603f", "#9a5038", "#a86a50"], WOOD_WALLS = ["#5e4a3a", "#6b5442", "#4f3f33", "#74604c"];
export const OLD_FINISH = /* @__PURE__ */ new Set([4, 6]);
export const wpick = (weights, r) => {
  const total = weights.reduce((s, w) => s + (Array.isArray(w) ? w[1] : w), 0);
  let t = r * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i], v = Array.isArray(w) ? w[1] : w;
    if ((t -= v) < 0) return Array.isArray(w) ? w[0] : i;
  }
  const last = weights.at(-1);
  return Array.isArray(last) ? last[0] : weights.length - 1;
};
export const fitFinish = (finish, type, floors, area = 0) => OLD_FINISH.has(finish) && (type !== "townhouse" || floors > 2 || area > 300) ? finish === 4 ? 1 : 2 : finish;
export const ACCENT_WALLS = ["#d3e2e6", "#d6e4d4", "#ecc8b6", "#c99179", "#e6d39e", "#b9a58f", "#a3a8a6", "#e8d0d4"];
export const ROOF_METAL = ["#7d8f99", "#8e9ea6", "#a9b0b2", "#6f8592", "#b9bcbb", "#8c8f8a"];
export const ROOF_TILE = ["#7b5c50", "#6f6964", "#86675a"];
export const ROOF_DECK = ["#a7a9a4", "#b0b1ab", "#9da29e", "#b8b4aa"];
export const METAL_WALLS = ["#c8cdcc", "#b7c0c3", "#d6d6d0", "#a9b6bb", "#c9c4b6"];
export function hash(...parts) {
  let h = 2166136261;
  for (const c of parts.join(":")) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
export const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];
export const mix = (a, b, t) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
export function orientedBox(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  area = Math.abs(area) / 2;
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.2) continue;
    const u2 = [dx / len, dy / len], v2 = [-u2[1], u2[0]];
    let u02 = Infinity, u12 = -Infinity, v02 = Infinity, v12 = -Infinity;
    for (const p of points) {
      const pu = p[0] * u2[0] + p[1] * u2[1], pv = p[0] * v2[0] + p[1] * v2[1];
      u02 = Math.min(u02, pu);
      u12 = Math.max(u12, pu);
      v02 = Math.min(v02, pv);
      v12 = Math.max(v12, pv);
    }
    const box = (u12 - u02) * (v12 - v02);
    if (!best || box < best.box) best = { box, u: u2, v: v2, u0: u02, u1: u12, v0: v02, v1: v12 };
  }
  if (!best) return null;
  let { u, v, u0, u1, v0, v1 } = best;
  if (v1 - v0 > u1 - u0) {
    [u, v] = [v, [-u[0], -u[1]]];
    [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
  }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { center: [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv], u, v, length: u1 - u0, width: v1 - v0, area, fill: area / (best.box || 1) };
}
function localProjection(anchor) {
  const mx = 111320 * Math.cos(anchor[1] * Math.PI / 180), my = 111320;
  return (p) => [(p[0] - anchor[0]) * mx, (p[1] - anchor[1]) * my];
}
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function classify(box, r, style) {
  if (box.area < 40 || box.width < 4.5 && box.area < 90) return "shed";
  if (style.factory && box.area >= 700 && box.fill >= 0.8 && box.width >= 14 && r < style.factory) return "factory";
  if (box.area >= 2500) return "hall";
  if (box.width <= 9.5 || box.fill < 0.72 || box.length / box.width >= 1.6) return "townhouse";
  if (box.area >= 600) return r < (style.rowShare ?? 0.5) ? "townhouse" : "apartment";
  return "apartment";
}
export const heightOf = (floors) => 3.6 + Math.max(0, floors - 1) * 3.2 + PARAPET;
export function styleKeyFor(area, quality = "") {
  return AREA_STYLE[area] || (/village|rural/i.test(quality) ? "village" : "town");
}
export function styleFor(area, quality = "") {
  return STYLES[styleKeyFor(area, quality)];
}
export const LANDMARKS = {
  post: { type: "civic", floors: [2, 3, 3], walls: ["#e4e2dc", "#dcdcd6"] },
  police: { type: "civic", floors: [2, 3, 3, 4], walls: ["#eef0f0", "#e6e9ea"] },
  fire: { type: "civic", floors: [2, 3, 3, 4], walls: ["#b8553f", "#c2654a", "#b04a36", "#e9e6e0"] },
  government: { type: "civic", floors: [3, 4, 4, 5], walls: ["#dcd8cf", "#d2cec4", "#e3e0d8"] },
  library: { type: "civic", floors: [2, 3, 4], walls: ["#dcd8cf", "#e3e0d8"] },
  hospital: { type: "civic", floors: [4, 5, 6], walls: ["#eeeeea", "#e6e8e6"] },
  church: { type: "civic", floors: [2, 3], walls: ["#ecebe6", "#e2ddd2"] },
  school: { type: "school", floors: [3, 3, 4, 4], walls: ["#e9d9b8", "#d9a184", "#efe6c8", "#cf8f6f", "#e6dfcf"] },
  kindergarten: { type: "school", floors: [1, 2, 2], walls: ["#f2d7a6", "#cfe3d2", "#f3c9c0", "#d6e2ef"] },
  temple: { type: "temple", floors: [1], walls: ["#b5412f", "#a83a2a", "#bf4a33"] }
};
export function withAppearance(collection, pilot, area, marks = {}) {
  const local = localProjection(pilot.anchor), route = pilot.route.geometry.coordinates.map(local);
  const routeBox = [Math.min(...route.map((p) => p[0])) - ROUTE_GAP_M, Math.min(...route.map((p) => p[1])) - ROUTE_GAP_M, Math.max(...route.map((p) => p[0])) + ROUTE_GAP_M, Math.max(...route.map((p) => p[1])) + ROUTE_GAP_M];
  const routeGap = (points) => {
    if (!points.some((p) => p[0] >= routeBox[0] && p[0] <= routeBox[2] && p[1] >= routeBox[1] && p[1] <= routeBox[3])) return Infinity;
    let best = Infinity;
    for (const p of points) for (let i = 1; i < route.length; i++) best = Math.min(best, segmentDistance(p, route[i - 1], route[i]));
    return best;
  };
  return { ...collection, features: collection.features.map((f) => {
    const p = f.properties;
    if (p.pilotSource !== "building" || f.geometry.type !== "Polygon") return f;
    const points = f.geometry.coordinates[0].slice(0, -1).map(local), box = orientedBox(points);
    if (!box) return f;
    const id = p.pilotId, quality = String(p.pilotHeightQuality || ""), styleKey = styleKeyFor(area, quality), style = STYLES[styleKey];
    const mark = marks[id], look = mark && LANDMARKS[mark.kind];
    let type = look ? look.type : classify(box, hash(id, "type"), style);
    const current = Math.max(3, Number(p.pilotHeight) || Number(p.render_height) || 6);
    const illustrative = !SOURCE_HEIGHT.test(quality) && ILLUSTRATIVE.test(quality) && !p.pilotReplaced && p.pilotRenderMode !== "footprint-only" && !(Number(p.render_min_height) > 0);
    let height = current, floors = Math.max(1, Math.round((current - PARAPET - 0.4) / 3.2));
    if (illustrative) {
      floors = look ? pick(look.floors, hash(id, "floors")) : type === "townhouse" || type === "apartment" || type === "hall" ? pick(style[type], hash(id, "floors")) : 1;
      height = type === "temple" ? 4.4 : type === "shed" ? 3 + hash(id, "shed") * 0.8 : type === "factory" ? 6 + hash(id, "factory") * 3 : heightOf(floors);
      if (routeGap(points) < ROUTE_GAP_M && height > ROUTE_CAP_M) {
        if (type === "factory" || type === "shed") height = ROUTE_CAP_M;
        else {
          floors = 2;
          height = Math.min(ROUTE_CAP_M, heightOf(2));
        }
      }
      height = Math.round(height * 10) / 10;
    } else if (type === "townhouse" && floors >= 6) type = "apartment";
    if (type === "temple" && !illustrative) floors = Math.max(1, Math.round((current - 0.6) / 4));
    let finish = null;
    if (!look && (type === "townhouse" || type === "apartment")) {
      finish = wpick(style.finish, hash(id, "house", 0, "finish"));
      if (OLD_FINISH.has(finish) && type === "townhouse" && illustrative && floors > 2) {
        floors = 2;
        height = Math.round(Math.min(height, heightOf(2)) * 10) / 10;
      }
      finish = fitFinish(finish, type, floors, box.area);
    }
    const old = OLD_FINISH.has(finish), metal = type === "shed" || type === "factory";
    const wall = look ? pick(look.walls, hash(id, "color")) : metal ? pick(METAL_WALLS, hash(id, "color")) : finish === 4 ? pick(REDBRICK_WALLS, hash(id, "color")) : finish === 6 ? pick(WOOD_WALLS, hash(id, "color")) : hash(id, "accent") < style.accent ? pick(ACCENT_WALLS, hash(id, "accent-color")) : pick(style.walls, hash(id, "color"));
    const pitched = type === "temple" || !look && box.fill >= (old ? 0.7 : 0.8) && (metal || floors <= 2 && hash(id, "roof") < (old ? 0.85 : style.pitched));
    return { ...f, properties: {
      ...p,
      pilotLookType: type,
      pilotLookFloors: floors,
      pilotLookHeight: height,
      pilotLookWall: wall,
      pilotLookColor: metal || pitched || look ? wall : mix(wall, "#b8b6ae", 0.22),
      pilotLookRoof: type === "temple" ? "temple" : pitched ? metal ? "metal" : "tile" : "flat",
      ...mark ? { pilotLookLandmark: mark.kind, pilotLookLandmarkName: mark.sign && mark.name || "" } : {},
      pilotLookAddon: style.addon,
      pilotLookStyle: styleKey,
      ...finish !== null ? { pilotLookFinish: finish } : {},
      pilotLookIllustrative: illustrative
    } };
  }) };
}
