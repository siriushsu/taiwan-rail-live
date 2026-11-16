const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const TAIPEI = { lat: 25.05, lon: 121.5, h: 0 };
const DT_S = 69.2, AU_KM = 1495978707e-1, RE_KM = 6378.14, BA = 1 - 1 / 298.257;
const deg = (x) => (x % 360 + 360) % 360, sin = (x) => Math.sin(x * D2R), cos = (x) => Math.cos(x * D2R);
export function jdTw(y, m, d, hour) {
  return Date.UTC(y, m - 1, d) / 864e5 + 24405875e-1 + (hour - 8) / 24;
}
const ML = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752]
];
const MB = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107]
];
export function moonEcliptic(T) {
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = deg(218.3164477 + 481267.88123421 * T - 15786e-7 * T2 + T3 / 538841 - T4 / 65194e3);
  const D = deg(297.8501921 + 445267.1114034 * T - 18819e-7 * T2 + T3 / 545868 - T4 / 113065e3);
  const M = deg(357.5291092 + 35999.0502909 * T - 1536e-7 * T2 + T3 / 2449e4);
  const Mp = deg(134.9633964 + 477198.8675055 * T + 87414e-7 * T2 + T3 / 69699 - T4 / 14712e3);
  const F = deg(93.272095 + 483202.0175233 * T - 36539e-7 * T2 - T3 / 3526e3 + T4 / 86331e4);
  const A1 = deg(119.75 + 131.849 * T), A2 = deg(53.09 + 479264.29 * T), A3 = deg(313.45 + 481266.484 * T), E = 1 - 2516e-6 * T - 74e-7 * T2;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of ML) {
    const a = d * D + m * M + mp * Mp + f * F, e = m === 0 ? 1 : m === 1 || m === -1 ? E : E * E;
    sl += l * e * sin(a);
    sr += r * e * cos(a);
  }
  for (const [d, m, mp, f, b] of MB) {
    const a = d * D + m * M + mp * Mp + f * F, e = m === 0 ? 1 : m === 1 || m === -1 ? E : E * E;
    sb += b * e * sin(a);
  }
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  return { lon: Lp + sl / 1e6, lat: sb / 1e6, dist: 385000.56 + sr / 1e3, sl, sb, sr, Lp, D, M, Mp, F, E };
}
export function nutation(T) {
  const Om = 125.04452 - 1934.136261 * T, L = 280.4665 + 36000.7698 * T, Lp = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.2 * sin(Om) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * Om)) / 3600;
  const deps = (9.2 * cos(Om) + 0.57 * cos(2 * L) + 0.1 * cos(2 * Lp) - 0.09 * cos(2 * Om)) / 3600;
  const eps0 = 23.4392911111 - (46.815 * T + 59e-5 * T * T - 1813e-6 * T * T * T) / 3600;
  return { dpsi, deps, eps0, eps: eps0 + deps };
}
export function sunEcliptic(T, dpsi) {
  const L0 = 280.46646 + 36000.76983 * T + 3032e-7 * T * T, M = 357.52911 + 35999.05029 * T - 1537e-7 * T * T, e = 0.016708634 - 42037e-9 * T - 1267e-10 * T * T;
  const C = (1.914602 - 4817e-6 * T - 14e-6 * T * T) * sin(M) + (0.019993 - 101e-6 * T) * sin(2 * M) + 289e-6 * sin(3 * M);
  const R = 1.000001018 * (1 - e * e) / (1 + e * cos(M + C));
  return { lon: deg(L0 + C + dpsi - 20.4898 / 3600 / R), dist: R * AU_KM };
}
export function gmst(jd) {
  const t = jd - 2451545, T = t / 36525;
  return deg(280.46061837 + 360.98564736629 * t + 387933e-9 * T * T - T * T * T / 3871e4);
}
const eclVec = (lon, lat, eps) => {
  const x = cos(lat) * cos(lon), y = cos(lat) * sin(lon), z = sin(lat);
  return [x, y * cos(eps) - z * sin(eps), y * sin(eps) + z * cos(eps)];
};
const toENU = (v, th, ph) => [-sin(th) * v[0] + cos(th) * v[1], -sin(ph) * cos(th) * v[0] - sin(ph) * sin(th) * v[1] + cos(ph) * v[2], cos(ph) * cos(th) * v[0] + cos(ph) * sin(th) * v[1] + sin(ph) * v[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]), unit = (v) => {
  const l = len(v);
  return [v[0] / l, v[1] / l, v[2] / l];
}, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function observer(th, site) {
  const u = Math.atan(BA * Math.tan(site.lat * D2R)), hr = (site.h || 0) / (RE_KM * 1e3);
  const rc = Math.cos(u) + hr * cos(site.lat), rs = BA * Math.sin(u) + hr * sin(site.lat);
  return [RE_KM * rc * cos(th), RE_KM * rc * sin(th), RE_KM * rs];
}
const radec = (v) => [deg(Math.atan2(v[1], v[0]) * R2D), Math.asin(v[2] / len(v)) * R2D];
export function moonAt(y, m, d, hour, site = TAIPEI) {
  const jd = jdTw(y, m, d, hour), T = (jd + DT_S / 86400 - 2451545) / 36525, nu = nutation(T);
  const mo = moonEcliptic(T), so = sunEcliptic(T, nu.dpsi);
  const lst = deg(gmst(jd) + nu.dpsi * cos(nu.eps) + site.lon), obs = observer(lst, site);
  const mg = eclVec(mo.lon + nu.dpsi, mo.lat, nu.eps).map((c) => c * mo.dist), sg = eclVec(so.lon, 0, nu.eps).map((c) => c * so.dist);
  const mt = [mg[0] - obs[0], mg[1] - obs[1], mg[2] - obs[2]], st = [sg[0] - obs[0], sg[1] - obs[1], sg[2] - obs[2]];
  const dir = unit(toENU(mt, lst, site.lat)), sunE = unit(toENU(st, lst, site.lat));
  const ms = unit([st[0] - mt[0], st[1] - mt[1], st[2] - mt[2]]), cosI = -dot(ms, unit(mt));
  const sun = unit(toENU(ms, lst, site.lat));
  const [a, dl] = radec(mt), [a0, d0] = radec(st);
  const limbPA = deg(Math.atan2(cos(d0) * sin(a0 - a), sin(d0) * cos(dl) - cos(d0) * sin(dl) * cos(a0 - a)) * R2D);
  const el = Math.asin(dir[2]) * R2D;
  return { jd, dir, az: deg(Math.atan2(dir[0], dir[1]) * R2D), el, up: el > 0, dist: len(mt), k: (1 + cosI) / 2, phase: Math.acos(Math.max(-1, Math.min(1, cosI))) * R2D, sun, limbPA, sunDirTopo: sunE, lst, ra: a, dec: dl };
}
