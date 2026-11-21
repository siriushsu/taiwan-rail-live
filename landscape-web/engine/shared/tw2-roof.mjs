import { TW2 } from "./tw2.mjs";
import { vhash } from "./tw-variety.mjs";
import { BAY } from "../kit-city-atlas.js";
export const ST = { l: 3.4, w: 2.8, h: 2.6 };
export const STM = 0.35;
export const ST_CAND = [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export const stairXY = (k, L, W) => k === 9 ? [0, 0] : [ST_CAND[k - 1][0] * (L - ST.l / 2 - STM), ST_CAND[k - 1][1] * (W - ST.w / 2 - STM)];
export const padR = (k, L, W) => Math.min(6, W - 1.2, k === 9 ? (L - 2.8) / 2 : L - 2.8);
export const tuSize = (L, W) => [Math.min(8, 2 * (L - 4.6)), Math.min(6, 2 * W - 3)];
export const TU = { hA: 5.6, hB: 3 };
export function makeFits(rings, obb) {
  const ring = rings[0], inside = (p) => {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], c = ring[j];
      if (a[1] > p[1] !== c[1] > p[1] && p[0] < (c[0] - a[0]) * (p[1] - a[1]) / (c[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  };
  const at = (du, dv) => [obb.center[0] + obb.u[0] * du + obb.v[0] * dv, obb.center[1] + obb.u[1] * du + obb.v[1] * dv];
  return (cu, cv, l, w) => rings.length === 1 && [-1, 1].every((x) => [-1, 1].every((y) => inside(at(cu + x * l / 2, cv + y * w / 2))));
}
export function roofPlan({ key, tall, L, W, fits, stairOK = true }) {
  const P = { k: 0, pad: false, tu: false, ps: 1, yo: 0, rp: 0 }, Wc = Math.min(W, 65);
  const big = tall && L > 7 && W > 7;
  if (TW2.heli && big) P.pad = vhash(key, "tw2", "heli") < TW2.num("heli", 0.17);
  const pickStair = (corners) => {
    if (!stairOK) return 0;
    if (!TW2.stair) return fits(0, 0, ST.l, ST.w) ? 9 : 0;
    const n = corners ? 4 : 8, s0 = Math.floor(vhash(key, "tw2", "stair") * n);
    for (let j = 0; j < n; j++) {
      const k = (s0 + j) % n + 1, [cu, cv] = stairXY(k, L, Wc);
      if (fits(cu, cv, ST.l + 0.1, ST.w + 0.1)) return k;
    }
    return !corners && fits(0, 0, ST.l, ST.w) ? 9 : 0;
  };
  if (P.pad) {
    P.k = pickStair(true);
    if (!P.k && !TW2.stair) P.k = 0;
    P.ps = P.k >= 1 && P.k <= 4 ? -ST_CAND[P.k - 1][0] : vhash(key, "tw2", "ps") < 0.5 ? -1 : 1;
    P.rp = padR(P.k, L, Wc);
    let ok = false;
    if ((P.k || !TW2.stair) && P.rp >= 3.5) {
      const y0 = vhash(key, "tw2", "yo") < 0.5 ? -1 : 1, [sx, sy] = P.k ? stairXY(P.k, L, Wc) : [1e9, 1e9];
      for (const yo of [y0, 0, -y0]) {
        const hx = P.ps * (L - P.rp - 0.8), hy = yo * (Wc - P.rp - 0.8);
        const clear = Math.abs(hx - sx) > P.rp + ST.l / 2 + 0.3 || Math.abs(hy - sy) > P.rp + ST.w / 2 + 0.3;
        if (clear && fits(hx, hy, 2 * P.rp, 2 * P.rp)) {
          P.yo = yo;
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      P.pad = false;
      P.k = 0;
    }
  }
  if (TW2.heli && big && !P.pad) {
    const [lA, wA] = tuSize(L, Wc);
    if (fits(0, 0, lA + 0.2, wA + 0.2)) P.tu = true;
  }
  if (!P.pad && !P.tu) P.k = pickStair(false);
  P.w = P.k + 16 * (P.pad ? 1 : 0) + 32 * (P.tu ? 1 : 0) + 64 * (P.yo + 1) + 256 * (P.ps > 0 ? 1 : 0);
  return P;
}
function vSpan(ring, obb, u) {
  const P = ring.map((p) => {
    const dx = p[0] - obb.center[0], dy = p[1] - obb.center[1];
    return [dx * obb.u[0] + dy * obb.u[1], dx * obb.v[0] + dy * obb.v[1]];
  }), xs = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length];
    if (a[0] > u !== c[0] > u) xs.push(a[1] + (c[1] - a[1]) * (u - a[0]) / (c[0] - a[0]));
  }
  xs.sort((x, y) => x - y);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const s = [xs[k], xs[k + 1]];
    if (s[0] <= 0 && s[1] >= 0) return s;
    if (!best || s[1] - s[0] > best[1] - best[0]) best = s;
  }
  return best;
}
function spanAll(ring, obb, us) {
  let v0 = -Infinity, v1 = Infinity;
  for (const u of us) {
    const s = vSpan(ring, obb, u);
    if (!s) return null;
    v0 = Math.max(v0, s[0]);
    v1 = Math.min(v1, s[1]);
  }
  return v1 > v0 ? [v0, v1] : null;
}
export function shedPlan({ key, type, floors, mark, obb, rings }) {
  if (!TW2.shed || !obb || rings.length !== 1) return [];
  const out = [], ring = rings[0];
  if (type === "townhouse") {
    if (obb.width < 3.5) return out;
    const n = Math.max(1, Math.round(obb.length / BAY)), sw = obb.length / n, p = TW2.num("shedTH", 0.15);
    for (let i = 0; i < n; i++) {
      const cu = -obb.length / 2 + (i + 0.5) * sw;
      if (!(vhash(key, "tw2", "shed", i) < p)) continue;
      const sp = spanAll(ring, obb, [cu - sw / 2 + 0.2, cu, cu + sw / 2 - 0.2]);
      if (sp && sp[1] - sp[0] >= 3) out.push({ cu, l: sw, i, v0: sp[0] + 0.12, v1: sp[1] - 0.12 });
    }
  } else if (type === "apartment" && floors <= 5 && !mark && obb.width >= 4) {
    if (vhash(key, "tw2", "shed", 0) < TW2.num("shedApt", 0.1)) {
      const L = obb.length / 2, sp = spanAll(ring, obb, [-L + 0.2, -L / 2, 0, L / 2, L - 0.2]);
      if (sp && sp[1] - sp[0] >= 3) out.push({ cu: 0, l: obb.length, i: 0, v0: sp[0] + 0.12, v1: sp[1] - 0.12 });
    }
  }
  return out;
}
export const shedHex = (key, i, sheetRoofOf) => sheetRoofOf(key, 50 + i);
