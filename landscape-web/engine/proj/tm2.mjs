export const TM2 = { a: 6378137, invF: 298.257222101, lon0: 121, k0: 0.9999, fe: 25e4, fn: 0 };
const RAD = Math.PI / 180;
function setup({ a, invF }) {
  const f = 1 / invF, n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  return {
    e: Math.sqrt(f * (2 - f)),
    n,
    A: a / (1 + n) * (1 + n2 / 4 + n4 / 64),
    alpha: [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180, 13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440, 61 * n3 / 240 - 103 * n4 / 140, 49561 * n4 / 161280],
    beta: [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360, n2 / 48 + n3 / 15 - 437 * n4 / 1440, 17 * n3 / 480 - 37 * n4 / 840, 4397 * n4 / 161280]
  };
}
const cache = /* @__PURE__ */ new Map();
const consts = (p) => {
  let c = cache.get(p);
  if (!c) cache.set(p, c = setup(p));
  return c;
};
function forwardCore(lon, lat, p) {
  const c = consts(p), phi = lat * RAD, lam = (lon - p.lon0) * RAD;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c.e * Math.atanh(c.e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let x = eta, y = xi, sigma = 1, tau = 0;
  for (let j = 1; j <= 4; j++) {
    const al = c.alpha[j - 1];
    x += al * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += al * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    sigma += 2 * j * al * Math.cos(2 * j * xi) * Math.cosh(2 * j * eta);
    tau += 2 * j * al * Math.sin(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return { c, phi, lam, t, x, y, sigma, tau };
}
export function toTM2(lon, lat, p = TM2) {
  const { c, x, y } = forwardCore(lon, lat, p);
  return [p.fe + p.k0 * c.A * x, p.fn + p.k0 * c.A * y];
}
export function fromTM2(E, N, p = TM2) {
  const c = consts(p), xi = (N - p.fn) / (p.k0 * c.A), eta = (E - p.fe) / (p.k0 * c.A);
  let xp = xi, ep = eta;
  for (let j = 1; j <= 4; j++) {
    const b = c.beta[j - 1];
    xp -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const sinChi = Math.sin(xp) / Math.cosh(ep), lam = Math.atan2(Math.sinh(ep), Math.cos(xp));
  const psi = Math.atanh(sinChi);
  let s = sinChi;
  for (let i = 0; i < 12; i++) {
    const next = Math.tanh(psi + c.e * Math.atanh(c.e * s));
    if (Math.abs(next - s) < 1e-15) {
      s = next;
      break;
    }
    s = next;
  }
  return [p.lon0 + lam / RAD, Math.asin(s) / RAD];
}
export function convergence(lon, lat, p = TM2) {
  const { lam, t, sigma, tau } = forwardCore(lon, lat, p), q = Math.sqrt(1 + t * t), tl = Math.tan(lam);
  return Math.atan2(tau * q + sigma * t * tl, sigma * q - tau * t * tl) / RAD;
}
export function scaleFactor(lon, lat, p = TM2) {
  const { c, phi, lam, t, sigma, tau } = forwardCore(lon, lat, p), r = (1 - c.n) / (1 + c.n) * Math.tan(phi);
  return p.k0 * c.A / p.a * Math.sqrt((1 + r * r) * (sigma * sigma + tau * tau) / (t * t + Math.cos(lam) ** 2));
}
export function place(lon, lat, trueAzimuthDeg = 0) {
  const [E, N] = toTM2(lon, lat);
  return { E, N, azimuth: trueAzimuthDeg - convergence(lon, lat) };
}
export const STATION_SPHERE_R = 63710088e-1;
export function stationToTM2(anchorLon, anchorLat, x, y, rotationDeg = 0) {
  const r = rotationDeg * RAD, cr = Math.cos(r), sr = Math.sin(r), ex = x * cr - y * sr, ny = x * sr + y * cr;
  const kx = RAD * STATION_SPHERE_R * Math.cos(anchorLat * RAD), ky = RAD * STATION_SPHERE_R;
  return toTM2(anchorLon + ex / kx, anchorLat + ny / ky);
}
export const TILE = 1280;
export const tileOf = (E, N) => [Math.floor(E / TILE), Math.floor(N / TILE)];
export const tileId = (i, j) => `E${i}_N${j}`;
export const tileBounds = (i, j) => ({ e0: i * TILE, n0: j * TILE, e1: (i + 1) * TILE, n1: (j + 1) * TILE });
export const parseTileId = (id) => {
  const m = /^E(-?\d+)_N(-?\d+)$/.exec(id);
  if (!m) throw Error("圖磚編號格式不對：" + id);
  return [+m[1], +m[2]];
};
