import { JSON_INIT } from "../shared/fetch-v.mjs";
let idx = null;
const indexOf = (url) => idx ??= fetch(url.replace(/[^/]+\/$/, "") + "aero-index.json", JSON_INIT).then((r) => r.ok ? r.json() : null).then((j) => new Set(j?.tiles || [])).catch(() => /* @__PURE__ */ new Set());
export async function aeroDropBuildings(url, list) {
  const id = url.match(/([^/]+)\/$/)?.[1], set = await indexOf(url);
  if (!set.has(id)) return 0;
  let j = null;
  try {
    const r = await fetch(url + "aero.json", JSON_INIT);
    j = r.ok ? await r.json() : null;
  } catch {
  }
  const drop = new Set(j?.drop || []);
  let n = 0;
  for (const b of list) if (drop.has(b.id)) {
    b.rings = [[]];
    n++;
  }
  return n;
}
