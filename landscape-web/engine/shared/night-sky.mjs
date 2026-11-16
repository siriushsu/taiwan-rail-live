import * as THREE from "../vendor/three.module.js";
import { TAIPEI } from "./sky-ephem.mjs";
export const MOON_FALLBACK_DIR = new THREE.Vector3(0.84, 0.242, 0.485).normalize();
export const CITY_GLOW = new THREE.Color(0.013, 95e-4, 65e-4);
export const GLOW_CITIES = [
  [303985, 2770536, 1, 9e3],
  [296630, 2767186, 0.8, 7e3],
  [296412, 2771948, 0.6, 6e3],
  [301279, 2765652, 0.6, 5e3],
  [280385, 2765036, 0.6, 7e3],
  [272719, 2761034, 0.55, 7e3],
  [324718, 2780493, 0.35, 4e3],
  [246765, 2743958, 0.5, 7e3],
  [215956, 2671676, 0.9, 1e4],
  [203430, 2663737, 0.35, 5e3],
  [193717, 2597544, 0.35, 5e3],
  [168497, 2543729, 0.7, 8e3],
  [178250, 2503149, 0.9, 1e4],
  [197386, 2507722, 0.3, 5e3],
  [326160, 2738740, 0.2, 4e3],
  [311464, 2652497, 0.2, 4e3],
  [264891, 2517272, 0.15, 4e3],
  [203400, 2622871, 0.12, 3e3],
  [231868, 2717277, 0.15, 3e3],
  [217827, 2645092, 0.12, 3e3]
];
export function cityGlow(e, n, out = { U: 0, dir: new Float32Array(8) }) {
  let U = 0;
  out.dir.fill(0);
  for (const [ce, cn, w, r] of GLOW_CITIES) {
    const dx = ce - e, dn = cn - n, D = Math.hypot(dx, dn), q = Math.exp(-((D / r) ** 2));
    U += w * q;
    if (D < 1) continue;
    const b = Math.atan2(dx, dn), a = Math.atan(r / D) + 0.3, g = w * Math.min(1, 1.5 * r / D) ** 1.2 * (1 - q);
    for (let s = 0; s < 8; s++) {
      let d = b - s * Math.PI / 4;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      out.dir[s] += g * Math.exp(-((d / a) ** 2));
    }
  }
  out.U = Math.min(1, U);
  for (let s = 0; s < 8; s++) out.dir[s] = Math.min(1.5, out.dir[s]);
  return out;
}
const POLE = [0, Math.sin(TAIPEI.lat * Math.PI / 180), -Math.cos(TAIPEI.lat * Math.PI / 180)];
export const NIGHT_SKY_GLSL = `
vec3 nightSky(vec3 c, vec3 d, vec3 moon, vec3 msun, float n) {
  float mu = max(d.y, 0.);
  c *= 1. - .3 * n * smoothstep(.15, 1., mu);                                   // 天頂再深一點
  c += vec3(${CITY_GLOW.r.toFixed(4)}, ${CITY_GLOW.g.toFixed(4)}, ${CITY_GLOW.b.toFixed(4)}) * pow(1. - mu, 5.) * n;   // 城市光害（地平線、地平線以下都是滿值，跟霧色接上）
  if (moon.y > -.03) {                                                          // 月亮中心在地平線下 1.7° 以下：整個不畫
    float cm = dot(d, moon), cosI = -dot(moon, msun), kf = .5 + .5 * cosI;      // cosI＝相位角的餘弦，kf＝照亮比例
    float ph = degrees(acos(clamp(cosI, -1., 1.))), hb = exp2(-1.3288 * (.026 * ph + 4e-9 * ph * ph * ph * ph)) * smoothstep(-.03, .01, moon.y);   // 月暈亮度：Allen 月相亮度（滿月＝1），月亮落到地平線下淡掉
    c += (vec3(.010, .012, .017) * pow(max(cm, 0.), 40.) + vec3(.05, .055, .065) * pow(max(cm, 0.), 1500.)) * n * hb;   // 月暈
    float r = acos(clamp(cm, -1., 1.)) / .0085;                                 // 月面半徑約 0.49°（實際 0.26°，放大一點手機上才看得到）
    if (r < 1.25 && d.y > 0.) {
      vec3 ax = normalize(cross(moon, vec3(${POLE.map((v) => v.toFixed(5)).join(", ")}))), ay = cross(ax, moon);   // ay＝天球北方：月面朝向跟真的月亮一樣隨天轉
      vec2 q = vec2(dot(d, ax), dot(d, ay)) / .0085;
      float disc = 1. - smoothstep(.93, 1.03, r), limb = sqrt(max(1. - r * r, 0.));
      float ci = dot(normalize(q.x * ax + q.y * ay - limb * moon), msun);       // 月面法線（朝觀察者那一面）對太陽方向
      float lit = clamp(2. * ci / (max(ci, 0.) + max(limb, .02)), 0., 1.2) + .01 * (1. - kf);   // 亮面（Lommel–Seeliger：滿月整面平均、明暗界線漸暗）＋暗面很淡的地照
      float mare = smoothstep(.55, .2, length(q - vec2(-.25, .22))) * .32 + smoothstep(.42, .1, length(q - vec2(.3, -.05))) * .26 + smoothstep(.3, .05, length(q - vec2(-.05, -.42))) * .2;
      c += vec3(1.15, 1.12, 1.02) * (.62 + .38 * limb) * (1. - mare) * lit * disc * n;
    }
  }
  return c;
}`;
const GLOW_FROM = `c += vec3(${CITY_GLOW.r.toFixed(4)}, ${CITY_GLOW.g.toFixed(4)}, ${CITY_GLOW.b.toFixed(4)}) * pow(1. - mu, 5.) * n;`;
if (!NIGHT_SKY_GLSL.includes(GLOW_FROM)) throw Error("夜空光害那一行對不上（第 152 包）");
export const NIGHT_SKY_GLOW_GLSL = "uniform float uGlowU; uniform float uGlow[8];\n" + NIGHT_SKY_GLSL.replace(GLOW_FROM, `float gs = mod(atan(d.x, -d.z) / .785398, 8.), gf = fract(gs); int gi = int(gs) % 8;   // 第 152 包：方位（0＝北、順時針），相鄰兩個方位內插
  float gd = mix(uGlow[gi], uGlow[(gi + 1) % 8], gf);
  c += vec3(${CITY_GLOW.r.toFixed(4)}, ${CITY_GLOW.g.toFixed(4)}, ${CITY_GLOW.b.toFixed(4)}) * (1.5 * uGlowU * pow(1. - mu, 5.) + 1.2 * gd * exp(-mu * 16.)) * n;   // 城市光害：一圈（×1.5U，跟霧色接上）＋往城市方向的地平線暖光`);
export function createStars({ count = 4e3, seed = 61, lat = 25.05 } = {}) {
  let s = seed >>> 0;
  const rnd = () => {
    s = s + 1831565813 >>> 0;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const pos = new Float32Array(count * 3), mag = new Float32Array(count), col = new Float32Array(count * 3), ph = new Float32Array(count);
  const tints = [[0.72, 0.82, 1], [0.86, 0.91, 1], [1, 1, 1], [1, 0.95, 0.84], [1, 0.86, 0.68], [1, 0.74, 0.55]], tw = [0.08, 0.2, 0.3, 0.22, 0.13, 0.07];
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([Math.cos(a) * r, z, Math.sin(a) * r], i * 3);
    mag[i] = Math.max(-1.4, 5.9 + Math.log10(Math.max(rnd(), 1e-6)) / 0.45);
    let u = rnd(), k = 0;
    while (k < tw.length - 1 && u > tw[k]) {
      u -= tw[k];
      k++;
    }
    col.set(tints[k], i * 3);
    ph[i] = rnd() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
  geo.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const uniforms = { uRot: { value: new THREE.Matrix3() }, uFade: { value: 0 }, uTime: { value: 0 }, uPR: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
    vertexShader: `uniform mat3 uRot; uniform float uFade; uniform float uTime; uniform float uPR; attribute float aMag; attribute vec3 aCol; attribute float aPh; varying vec3 vC;
void main() {
  vec3 w = uRot * position; float el = w.y;
  float lim = mix(5.0, 6.0, smoothstep(.02, .5, el));                    // 光害：可見極限星等
  float m = aMag + .08 / max(el, .06);                                       // 大氣消光（氣團）
  float I = pow(10., -.4 * (m - lim));                                       // >1 才看得到
  float twk = 1. + (1. - smoothstep(.1, .6, el)) * .35 * sin(uTime * (5. + mod(aPh, 7.)) + aPh);
  vC = aCol * min(.25 * I, 2.2) * smoothstep(1., 1.5, I) * smoothstep(0., .05, el) * uFade * twk;
  vec3 v = mat3(viewMatrix) * w; gl_Position = projectionMatrix * vec4(v * 1000., 1.); gl_Position.z = gl_Position.w;
  gl_PointSize = I > 1. ? clamp(1.6 + .6 * log(I), 1.6, 4.) * uPR : 0.;
}`,
    fragmentShader: `varying vec3 vC; void main() { vec2 q = gl_PointCoord - .5; float a = exp(-dot(q, q) * 14.); gl_FragColor = vec4(vC * a, 1.);
#include <colorspace_fragment>
}`
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -9;
  points.visible = false;
  const pole = new THREE.Vector3(0, Math.sin(lat * Math.PI / 180), -Math.cos(lat * Math.PI / 180)), m4 = new THREE.Matrix4();
  return { points, update(hour, night, time, pixelRatio) {
    const fade = Math.max(0, Math.min(1, (night - 0.3) / 0.6));
    uniforms.uFade.value = fade * fade * (3 - 2 * fade);
    points.visible = fade > 0;
    if (!points.visible) return;
    m4.makeRotationAxis(pole, -(hour + 2.2) * Math.PI / 12);
    uniforms.uRot.value.setFromMatrix4(m4);
    uniforms.uTime.value = time;
    uniforms.uPR.value = pixelRatio;
  } };
}
