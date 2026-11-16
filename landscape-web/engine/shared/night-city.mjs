import * as THREE from "../vendor/three.module.js";
import { LAMP_RGB_GLSL, lampMixAt, lampTone } from "./night-mix.mjs";
export function nightFlags(params, coarse = false) {
  const all = params.get("n64") !== "0", f = (k) => all && params.get(k) !== "0";
  return { lamp: f("nlamp"), glow: f("nglow"), wall: f("nwall"), win: f("nwin"), mid: f("nmid"), room: f("nwin") && (params.has("nroom") ? params.get("nroom") !== "0" : !coarse), lmix: f("nlamp") && params.get("nlmix") !== "0", far: f("nglow") && params.get("nfar") !== "0" && (params.get("nfr") === "0" ? "base" : true) };
}
const RANK = { footway: 0, path: 0, steps: 0, cycleway: 0, track: 1, service: 2, pedestrian: 2, unknown: 2, living_street: 3, residential: 3, unclassified: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 7 };
const hash2 = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
export function lampPositions(roads, groundAt, { size = 1280, deckAt = null, mix = false } = {}) {
  const pos = [], seed = [], road = [], tone = [];
  for (const r of roads || []) {
    const k = RANK[r.cls] ?? 2;
    if (k < 3 || !r.pts || r.pts.length < 2) continue;
    const main = k >= 4, gap = main ? 38 : 46, lift = main ? 9 : 7, off = (r.w || 6) / 2 + 0.6;
    let s = hash2(r.pts[0][0], r.pts[0][1]) * gap, idx = 0;
    const side0 = hash2(r.pts[0][1], r.pts[0][0]) < 0.5 ? 1 : -1, t0 = mix ? lampTone(hash2(r.pts[0][0] * 0.53 + 7.1, r.pts[0][1] * 0.29 + 3.3), lampMixAt(k >= 7)) : 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;
      const ux = dx / L, uy = dy / L;
      for (; s <= L; s += gap, idx++) {
        const side = main ? (idx % 2 ? 1 : -1) * side0 : side0, x = a[0] + ux * s - uy * off * side, y = a[1] + uy * s + ux * off * side;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const deck = r.bridge && deckAt ? deckAt(r, x, y) : null, h = typeof deck === "number" ? deck + 6.5 : groundAt(x, y) + lift;
        pos.push(x, h, -y);
        seed.push(hash2(x * 0.37, y * 0.91));
        if (mix) {
          road.push(a[0] + ux * s, a[1] + uy * s);
          tone.push(t0);
        }
      }
      s -= L;
    }
  }
  return { pos: new Float32Array(pos), seed: new Float32Array(seed), n: seed.length, ...mix ? { road: new Float32Array(road), tone: new Float32Array(tone) } : {} };
}
export function createLampMaterial(fogDensity, blackTex = null) {
  const mix = !!blackTex;
  const m = new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 }, uPR: { value: 1 }, uFog: { value: fogDensity }, ...mix ? { tNightR: { value: blackTex }, uNightRo: { value: new THREE.Vector3(0, 0, 1) }, uNightK: { value: 0 } } : {} },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: `attribute float aSeed; uniform float uPR; uniform float uFog; varying vec3 vC; varying float vA;${mix ? `
attribute vec2 aRoad; attribute float aTone; uniform sampler2D tNightR; uniform vec3 uNightRo; uniform float uNightK; ${LAMP_RGB_GLSL}` : ""}
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; float d = max(-mv.z, 1.);
  float sz = clamp(3200. / d, 1.5, 18.); gl_PointSize = sz * uPR;${mix ? `
  float tone = aTone; if (uNightK > .5) { vec2 ng = texture2D(tNightR, (aRoad + uNightRo.xy) / uNightRo.z).rg; if (ng.r > .1) tone = ng.g; }
  vC = lampRGB(tone) * mix(.8, 1.15, fract(aSeed * 7.31));` : `
  vC = mix(vec3(1., .80, .55), vec3(1., .58, .24), step(.7, aSeed)) * mix(.8, 1.15, fract(aSeed * 7.31));`}
  vA = exp(-d * d * uFog * uFog) * mix(1., 2.2, 1. - smoothstep(2., 6., sz)); }`,
    // 遠了點變小，亮度補一點，遠看路網才連得起來
    fragmentShader: `uniform float uNight; varying vec3 vC; varying float vA;
void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r2 = dot(q, q); if (r2 > 1.) discard;
  float core = 1. - smoothstep(.0, .12, r2), halo = exp(-r2 * 4.5) * .45;
  gl_FragColor = vec4(vC * (core * 3.2 + halo * 1.5) * vA * uNight, 1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
  });
  m.visible = false;
  return m;
}
export function lampPoints(lamps, material) {
  if (!lamps.n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(lamps.pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(lamps.seed, 1));
  g.computeBoundingSphere();
  if (lamps.road) {
    g.setAttribute("aRoad", new THREE.BufferAttribute(lamps.road, 2));
    g.setAttribute("aTone", new THREE.BufferAttribute(lamps.tone, 1));
  }
  const p = new THREE.Points(g, material);
  p.frustumCulled = true;
  p.renderOrder = 2;
  p.castShadow = p.receiveShadow = false;
  return p;
}
const rep = (src, a, b) => {
  if (!src.includes(a)) throw Error("夜景（第 64 包）著色器對不上：" + a.slice(0, 60));
  return src.replace(a, b);
};
export function nightGroundPatch(sh, farOn = false) {
  sh.fragmentShader = rep(sh.fragmentShader, "#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (uNight > 0.) { vec2 o = vec2(22. / uSize, 0.);
    float bd = uSize > 2000. ? 0. : (foot + texture2D(tMask, uvM + o).r + texture2D(tMask, uvM - o).r + texture2D(tMask, uvM + o.yx).r + texture2D(tMask, uvM - o.yx).r) * .2;   // 第 162 包：遠景塊的 R 不是建物腳印
    float built = smoothstep(.07, .32, bd) * (1. - wat) * (1. - smoothstep(.3, .7, foot));
    vec2 gc = P / 16., gi = floor(gc); float gh = gH(gi + 17.3);
    vec2 gq = fract(gc) - .5 - (vec2(gH(gi + 3.1), gH(gi + 7.7)) - .5) * .5;
    float spot = step(gh, .45) * exp(-dot(gq, gq) * 16.) * (.6 + gh), far = smoothstep(1.2, 4.5, pxm);
    totalEmissiveRadiance += vec3(1., .64, .34) * mix(spot * .55 + .025, .07, far) * built * uNight; }`);
  if (farOn) {
    sh.fragmentShader = rep(sh.fragmentShader, "* mix(spot * .55 + .025, .07, far) * built * uNight; }", "* mix(spot * .55 + .025, .07, far) * built * uNight * (1. - nfW); }");
    nightFarPatch(sh, farOn !== "base");
  }
}
export const FAR_NIGHT = { k: 0.2, g: 0.8, gd: 0.3, d0: 2500, d1: 7e3, gain: 3.5, g0: 3e4, g1: 3e5, c0: 0.04, c1: 0.18, kn: 0.04, v0: 5e3, v1: 1e4, lw: 0.68 };
export const farNightK = (dist) => {
  const F = FAR_NIGHT, t = Math.min(1, Math.max(0, (dist - F.v0) / (F.v1 - F.v0)));
  return F.kn + (F.k - F.kn) * t * t * (3 - 2 * t);
};
export function nightFarPatch(sh, roadOn = true) {
  sh.fragmentShader = rep(sh.fragmentShader, "float gH(vec2 p){", `uniform float uNightFar; uniform sampler2D tNightR; uniform vec3 uNightRo; uniform float uNightK; uniform float uNightKk;
${LAMP_RGB_GLSL}
float gH(vec2 p){`);
  const F = FAR_NIGHT, f = (x) => x.toFixed(2);
  sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  float nfW = uNight > 0. ? smoothstep(${F.d0.toFixed(1)}, ${F.d1.toFixed(1)}, dist) : 0.;
  if (nfW > 0.) { vec2 nuv = (vL + uNightRo.xy) / uNightRo.z; float nr = 0., nt = -1.;
      ${roadOn ? "if (uNightK > .5) { vec2 ng = texture2D(tNightR, nuv).rg; nr = ng.r; nt = ng.g; } else nr = uSize > 2000. ? coreM.r : texture2D(tNightR, nuv).r;" : ""}
      float nl = nr * nr;
      vec3 nW = normalize(normal) * mat3(viewMatrix); float flt = smoothstep(.82, .95, nW.y), hiA = 1. - smoothstep(900., 1800., vW.y);
      float fz = smoothstep(${F.g0.toFixed(1)}, ${F.g1.toFixed(1)}, dist), lit = uNightKk * (1. + ${f(F.gain)} * fz) * pow(nl, ${f(F.g)} - ${f(F.gd)} * fz) * flt * hiA * (1. - wat);
      vec3 lc = nt < 0. ? mix(vec3(1., .46, .14), vec3(1., .82, .6), smoothstep(${f(F.c0)}, ${f(F.c1)}, lit)) : lampRGB(nt) * ${f(F.lw)};
      vec3 base = vec3(.010, .013, .022) * (.4 + .6 * clamp(dot(nW, vec3(-.5, .7, -.5)) * 1.15, 0., 1.)) * (1. - wat);
      totalEmissiveRadiance += (lc * lit + base) * nfW * uNightFar; }`);
}
export function nightRoadPatch(mat, uNight) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.fragmentShader = rep(sh.fragmentShader, "#include <common>", "#include <common>\nuniform float uNight;");
    sh.fragmentShader = rep(sh.fragmentShader, "#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (uNight > 0.) totalEmissiveRadiance += vec3(1., .66, .38) * mix(.025, .05, 1. - step(.1, vColor.r)) * uNight;`);
  };
  mat.customProgramCacheKey = () => "road-n64";
}
export function nightMidPatch(mat, uNight) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.vertexShader = rep(sh.vertexShader, "#include <common>", "#include <common>\nvarying vec3 vNW; varying vec3 vNN;");
    sh.vertexShader = rep(sh.vertexShader, "#include <begin_vertex>", "#include <begin_vertex>\nvNW = (modelMatrix * vec4(transformed, 1.)).xyz; vNN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = rep(sh.fragmentShader, "#include <common>", `#include <common>
uniform float uNight; varying vec3 vNW; varying vec3 vNN;
float nmH(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`);
    sh.fragmentShader = rep(sh.fragmentShader, "#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (uNight > 0.) { vec2 c = floor(vNW.xz / 18.); float hc = nmH(c), rate = .03 + .22 * hc * hc, wallF = 1. - smoothstep(.3, .6, abs(vNN.y));
    totalEmissiveRadiance += mix(vec3(1., .72, .42), vec3(.9, .92, 1.), step(.8, nmH(c + 9.1))) * rate * .2 * wallF * uNight; }`);
  };
  mat.customProgramCacheKey = () => "simple-n64";
}
