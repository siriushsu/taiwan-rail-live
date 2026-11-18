import { jget } from "../shared/fetch-v.mjs";
let idx = null;
const indexOf = (url, v) => idx ??= jget(url.replace(/[^/]+\/$/, "") + "aero-index.json", v).then((r) => r.ok ? r.json() : null).then((j) => new Set(j?.tiles || [])).catch(() => /* @__PURE__ */ new Set());
export async function aeroDropBuildings(url, list, vf = {}) {
  const id = url.match(/([^/]+)\/$/)?.[1], set = await indexOf(url, vf.ri?.["aero-index.json"]);
  if (!set.has(id)) return 0;
  let j = null;
  try {
    const r = await jget(url + "aero.json", vf.j);
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
