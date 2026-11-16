export const VARIETY_VERSION = 1;
export function vhash(...parts) {
  let h = 2166136261;
  for (const c of parts.join(":")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const wp = (list, r) => {
  let t = r * list.reduce((s, x) => s + x[1], 0);
  for (const x of list) if ((t -= x[1]) < 0) return x[0];
  return list.at(-1)[0];
};
const shadeHex = (hex, k) => "#" + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, "0")).join("");
const jit = (hex, r, amt) => shadeHex(hex, 1 + (r - 0.5) * 2 * amt);
const WALL_LOW = [["#f1efe9", 7], ["#e9e3d5", 12], ["#dfcfaa", 11], ["#d4b984", 8], ["#c49e63", 6], ["#c98b70", 6], ["#ad6550", 6], ["#8f6b56", 5], ["#b5b2aa", 9], ["#cfcdc6", 9], ["#9b9890", 4], ["#e1bdb0", 4], ["#bccab2", 3], ["#b0c2cb", 3]];
const WALL_RURAL = [["#f1efe9", 14], ["#e9e3d5", 16], ["#e0d3b8", 10], ["#d6c096", 5], ["#c98b70", 4], ["#ad6550", 3], ["#8f6b56", 2], ["#b5b2aa", 6], ["#cfcdc6", 9], ["#e1bdb0", 3], ["#bccab2", 3], ["#b0c2cb", 3]];
const WALL_MID = [["#ece9e1", 10], ["#e6dfcf", 14], ["#dccfb3", 9], ["#c99a7d", 6], ["#a96a55", 4], ["#93745f", 6], ["#bdbbb4", 13], ["#d2d1cb", 13], ["#9d9c96", 5], ["#dcc0b4", 3]];
const WALL_TALL = [["#d0d1cd", 10], ["#b4b6b3", 8], ["#ddd6c6", 8], ["#ebeae5", 8], ["#a9b3b8", 5], ["#9e8d7b", 4], ["#c4bcae", 5], ["#d8c9a3", 3], ["#c4a08c", 3]];
const RURAL = /* @__PURE__ */ new Set(["village", "coastal", "east", "oldtown"]);
export function wallOf({ key, slot = 0, type, floors, style, orig }) {
  if (style === "villa") return null;
  const r = (k) => vhash(key, "v60", slot, k), low = type === "townhouse" || floors <= 5;
  if (!low && floors >= 8) return orig && r("keep") < 0.5 ? jit(orig, r("j"), 0.05) : jit(wp(WALL_TALL, r("c")), r("j"), 0.05);
  const list = low ? RURAL.has(style) ? WALL_RURAL : WALL_LOW : WALL_MID;
  return jit(wp(list, r("c")), r("j"), 0.07);
}
const DECK = [["#a7a9a4", 20], ["#b3b3ac", 14], ["#9a9c97", 10], ["#c4c3bc", 10], ["#d6d6cf", 7], ["#7f7f7a", 6], ["#9c7363", 5], ["#ad8873", 4], ["#7f9488", 7], ["#6f8a78", 4], ["#8e8f8d", 6]];
export const deckOf = (key) => jit(wp(DECK, vhash(key, "v60", "deck")), vhash(key, "v60", "deck-j"), 0.06);
const SHEET_ROOF = [["#b9bcbb", 18], ["#a0a5a6", 12], ["#d9dad4", 10], ["#4f79a6", 13], ["#6f93b8", 7], ["#5f8f6f", 6], ["#b5583c", 9], ["#9a4e3a", 6], ["#8a5a3c", 5], ["#6b7072", 7], ["#c8c0b0", 7]];
const SHEET_WALL = [["#e3e3dd", 14], ["#d4d6d2", 16], ["#c3c7c6", 12], ["#a7b2b7", 8], ["#9fb5c9", 9], ["#5c84ad", 6], ["#d9d2bd", 9], ["#7aa088", 5], ["#9a6a4c", 4], ["#8c9194", 7]];
export const sheetRoofOf = (key, k = 0) => jit(wp(SHEET_ROOF, vhash(key, "v60", "sroof", k)), vhash(key, "v60", "sroof-j", k), 0.06);
export const sheetWallOf = (key, k = 0) => jit(wp(SHEET_WALL, vhash(key, "v60", "swall", k)), vhash(key, "v60", "swall-j", k), 0.05);
export const addonWallOf = (key, k, roof) => vhash(key, "v60", "awall", k) < 0.5 ? shadeHex(roof, 1.08) : wp([["#e3e3dd", 1], ["#d4d6d2", 1], ["#c3c7c6", 1]], vhash(key, "v60", "awall-c", k));
const ADDON = { city: 0.55, hilltown: 0.5, mining: 0.55, town: 0.45, hillside: 0.45, coastal: 0.3, village: 0.25, east: 0.25, oldtown: 0.3 };
export function addonOf({ style, type, floors, orig }) {
  if (style === "villa") return orig;
  if (!(type === "townhouse" || type === "apartment" && floors <= 5)) return orig;
  return ADDON[style] ?? orig;
}
