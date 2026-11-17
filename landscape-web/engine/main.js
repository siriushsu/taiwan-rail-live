import * as THREE from "./vendor/three.module.js";
import { createFacade } from "./tw-facade.js";
import { createRailStructures } from "./integration/rail-structures.js";
import { groupTunnelPortals, PORTAL_GROUND_U } from "./integration/tunnel-portals.js";
import { roadUnderpassGeometry, roadPortalMaterial } from "./integration/road-underpass.js";
import { levelCrossingGeometry, levelCrossingMaterial } from "./integration/level-crossing.js";
import { TILE_M, FINE_N, FINE_STEP } from "./shared/terrain.mjs";
import { decodeStation } from "./shared/station.mjs";
import { NIGHT_SKY_GLSL, MOON_FALLBACK_DIR, CITY_GLOW, createStars, cityGlow, NIGHT_SKY_GLOW_GLSL } from "./shared/night-sky.mjs";
import { moonAt } from "./shared/sky-ephem.mjs";
import { createBloom } from "./shared/night-bloom.mjs";
import { parseFx3, fx3FacadePatch, fx3GroundPatch, fx3SimplePatch, fx3LandPatch, LAND_CLASSES } from "./shared/fx3.mjs";
import { parseFx2, installChunks, frameUniforms, applyLight, facadePatch, groundPatch, simplePatch, createContactAO, createHeightShade, shadePatch } from "./shared/fx2.mjs";
import { aeroIndex, loadAero, aeroUniforms, aeroGroundPatch, aeroNoTree, AERO_KEY } from "./integration/airports.js";
import { createRideUg } from "../host-stubs.js";
import { createTrainsLayer } from "../host-stubs.js";
import { nightFlags, lampPositions, createLampMaterial, lampPoints, nightGroundPatch, nightRoadPatch, nightMidPatch, FAR_NIGHT, farNightK } from "./shared/night-city.mjs";
import { createRailHl } from "./shared/rail-hl.mjs";
import { VSHA, JSON_INIT, fspec, fetchV, hex16 } from "./shared/fetch-v.mjs";
const H = globalThis.__LANDSCAPE_HOST__, coarse = matchMedia("(pointer:coarse)").matches, params = H.params;
const $ = (id) => H.el(id), status = (t) => {
  $("status").textContent = t;
  H.status(t);
};
const FX = coarse ? { glassR: 0, river: 0, farm: 0, farmB: 0, seaBase: 0 } : { glassR: 1, river: 1, farm: 1, farmB: 0, seaBase: 0 };
for (const k of Object.keys(FX)) if (params.has(k)) FX[k] = +params.get(k);
const P79 = params.get("fx") !== "0";
const P79W = P79 && (coarse ? params.get("fxw") === "1" : params.get("fxw") !== "0");
if (P79) THREE.ShaderChunk.colorspace_fragment += `
#if defined( TONE_MAPPING )
{ vec3 g79 = clamp(gl_FragColor.rgb, 0., 1.); gl_FragColor.rgb = mix(g79, g79 * g79 * (3. - 2. * g79), .16) * vec3(1.015, 1., .975); }
#endif`;
const FX3 = parseFx3(params, coarse);
const FX2 = parseFx2(params, coarse), FX2U = FX2.any ? installChunks(THREE, FX2) : null, fx2S = { day: 1, dusk: 0 };
const P24 = { stn: 1, stnFar: 0, hill: 1, stnCull: 1, rtin: 0, wq: 1, structCull: 1, ovNear: 2600, stnNearD: 1e9 };
for (const k of Object.keys(P24)) if (params.has(k)) P24[k] = k === "rtin" ? params.get(k) : +params.get(k);
const SKIP = P24.hill ? "" : "hillside,villa";
const P28 = { fSide: 0, fWin: 1, fBasic: 0, rd: 1, rdLines: 1, rdFar: 0, rdStep: 4, fEnv: 1, fShd: 1, fFar: 0, fFarShd: 1, fFarWin: 0, fFarEnv: 0, fShSide: 2, fInner: 1, rdDeck: 1, rdPier: 1, rdSide: 1, rdMode: 3 };
for (const k of Object.keys(P28)) if (params.has(k)) P28[k] = +params.get(k);
if (params.get("ui") === "0") document.body.classList.add("noui");
const DATA = params.get("data") || "/tiles/", FAR_M = TILE_M * 4;
const LIMIT = coarse ? { near: 700, mid: 2600, far: 11e3, maxNear: 6, maxMid: 24, loads: 2, shadow: 2048, trees: 0.55, extraR: 350, shadowMove: 0.2, shadowGap: 400, adapt: 1, prMin: 1.5, stage: 1, maxMidMove: 16, still: 10, stillKB: 4096, stillLoads: 4, late: 1, lo: 2.5, loR: 1e3, chunk: 4 } : { near: 1100, mid: 4200, far: 16e3, maxNear: 12, maxMid: 60, loads: 3, shadow: 4096, trees: 1, extraR: 700, shadowMove: 0.04, shadowGap: 0, adapt: 0, prMin: 1, stage: 0, maxMidMove: 60, still: 0, stillKB: 4096, stillLoads: 0, late: 0, lo: 0, loR: 1e3, chunk: 2 };
for (const k of Object.keys(LIMIT)) if (params.has(k)) LIMIT[k] = +params.get(k);
const prFixed = parseFloat(params.get("pr")) || 0;
for (const k of Object.keys(LIMIT)) if (params.has(k)) LIMIT[k] = +params.get(k);
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
let pixelRatio = prFixed ? Math.min(prFixed, devicePixelRatio || 1) : Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2), shadowRenders = 0;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(H.w(), H.h());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const AO2 = FX2.ao ? createContactAO(THREE, renderer) : null;
const HS2 = FX2.shade ? createHeightShade(THREE, renderer, FX2) : null;
renderer.shadowMap.enabled = LIMIT.shadow > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, H.w() / H.h(), 2, 12e4);
const prof = { cur: {}, all: {}, take() {
  const c = this.cur;
  this.cur = {};
  return c;
} };
const tm = (k, f) => {
  const s = performance.now();
  try {
    return f();
  } finally {
    const d = performance.now() - s;
    prof.cur[k] = (prof.cur[k] || 0) + d;
    prof.all[k] = (prof.all[k] || 0) + d;
  }
};
const net = { n: 0, ms: 0, last: 0 }, netDone = (s) => {
  net.n++;
  net.ms += performance.now() - s;
  net.last = performance.now();
};
const json = async (u, raw) => {
  const t = performance.now(), r = await fetch(u, JSON_INIT);
  if (!r.ok) throw Error(u + " " + r.status);
  const s = await r.text();
  netDone(t);
  if (raw) raw.text = s;
  return tm("json", () => JSON.parse(s));
};
const vstat = {}, bin = async (u, spec, n = 0) => {
  const t = performance.now(), b = await fetchV(u, spec, n, vstat);
  netDone(t);
  return b;
};
const loader = new THREE.TextureLoader(), tex = (u, srgb, mip = true, spec, n = 0) => bin(u, spec, n).then((b) => new Promise((ok, no) => {
  const src = URL.createObjectURL(new Blob([b], { type: u.endsWith(".jpg") ? "image/jpeg" : "image/png" }));
  loader.load(src, (t) => {
    URL.revokeObjectURL(src);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = mip;
    t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    if (mip) t.anisotropy = Math.min(coarse ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
    ok(t);
  }, void 0, () => {
    URL.revokeObjectURL(src);
    no(Error("讀不到 " + u));
  });
}));
const BO = {
  m: /* @__PURE__ */ new Map(),
  gen: 0,
  wait(k) {
    const b = this.m.get(k);
    if (!b) return false;
    b.gen = this.gen;
    return performance.now() < b.at;
  },
  go(k) {
    const b = this.m.get(k);
    if (b) b.busy = true;
    return b?.n || 0;
  },
  has(k) {
    return this.m.has(k);
  },
  ok(k) {
    this.m.delete(k);
  },
  fail(k, err) {
    const b = this.m.get(k) || { n: 0 }, s = Math.min(60, 2 ** b.n);
    b.n++;
    b.busy = false;
    b.at = performance.now() + s * 1e3;
    b.gen = this.gen;
    this.m.set(k, b);
    console.warn(`[地景] ${k} 載入失敗（第 ${b.n} 次，${s} 秒後重試）：${err?.message || err}`);
  },
  sweep() {
    for (const [k, b] of this.m) if (!b.busy && b.gen !== this.gen) this.m.delete(k);
    this.gen++;
  }
};
const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blackTex.needsUpdate = true;
status("讀索引…");
const ixRaw = {}, index = await json(DATA + "index.json", ixRaw);
const VER = await hex16(ixRaw.text), vspec = (files, name) => fspec(files, name) || { v: VER };
ixRaw.text = null;
if (params.get("vsha") === "0") VSHA.on = false;
const FS = { on: params.get("farSat") !== "0" && !!index.farLod?.levels, ...coarse ? { f0: 4500, f1: 6500, r1: 12e3, r2: 4e4 } : { f0: 8e3, f1: 12e3, r1: 2e4, r2: 7e4 }, max: 8e5, fog: 75e-6 };
for (const k of ["f0", "f1", "r1", "r2"]) if (params.has("fs" + k)) FS[k] = +params.get("fs" + k);
const FSL = index.farLod?.levels || {}, FSTOP = Math.max(1, ...Object.keys(FSL).map(Number));
if (FS.on) THREE.ShaderChunk.alphahash_fragment = "#ifdef USE_ALPHAHASH\n	if ( opacity < getAlphaHashThreshold( vPosition ) ) discard;\n#endif";
const LAND_NO_TREE = new Set(["water", "courtPaved", "pitchGrass", "pitchSand", "track", "playground", "parking", "plaza", "sand", "aquaculture", "greenhouse", "pitchClay"].map((k) => LAND_CLASSES.indexOf(k)));
function landPixels(tx) {
  if (tx.userData.px) return tx.userData.px;
  const im = tx.image, c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(im, 0, 0, 512, 512);
  return tx.userData.px = x.getImageData(0, 0, 512, 512).data;
}
let landV = 1, landVer = VER;
const landSet = FX3.land ? await fetch(DATA + "land-index.json", JSON_INIT).then((r) => r.ok ? r.text() : null).then(async (s) => {
  const j = s && JSON.parse(s);
  if (s) landVer = await hex16(s);
  landV = +j?.v || 1;
  return j?.tiles ? new Set(j.tiles) : null;
}).catch(() => null) : null;
const tileId = (i, j) => `E${i}_N${j}`, farId = (i, j) => `F${i}_${j}`;
const origin = { e: 0, n: 0 };
const view = { e: 0, n: 0, dist: 520, az: 2.2, pitch: 0.5 };
const aeroSet = await aeroIndex(DATA);
const worker = new Worker(new URL("./tile.worker.js", import.meta.url), { type: "module" }), waiting = /* @__PURE__ */ new Map();
let jobId = 0;
const jobStat = {}, wNow = () => performance.timeOrigin + performance.now();
worker.onmessage = ({ data }) => {
  prof.cur.nMsg = (prof.cur.nMsg || 0) + 1;
  const w = waiting.get(data.id);
  waiting.delete(data.id);
  const r = data.result, s = jobStat[w.type] ||= { n: 0, wait: 0, run: 0, ph: {} };
  s.n++;
  if (r?.wt) {
    s.wait += r.wt[0] - w.post;
    s.run += r.wt[1] - r.wt[0];
  }
  for (const [k, v] of Object.entries(r?.ph || {})) s.ph[k] = (s.ph[k] || 0) + v;
  if (data.error) w.no(Error(data.error));
  else w.ok(r);
};
worker.onerror = (e) => status("worker 失敗：" + (e.message || e));
const job = (type, args) => new Promise((ok, no) => {
  const id = ++jobId;
  waiting.set(id, { ok, no, type, post: wNow() });
  worker.postMessage({ id, type, vsha: VSHA.on, ...args });
});
const SKY_GLSL = `
vec3 skyColor(vec3 d, vec3 sun) {
  float mu = max(d.y, 0.), sunH = sun.y, day = smoothstep(-.12, .14, sunH), dusk = (1. - smoothstep(0., .38, abs(sunH))) * smoothstep(-.22, .06, sunH);
  vec3 zen = mix(vec3(.0035, .006, .016), vec3(.085, .235, .60), day), hor = mix(vec3(.012, .018, .036), vec3(.52, .68, .88), day);
  hor = mix(hor, vec3(.98, .50, .22), dusk * .8); zen = mix(zen, vec3(.16, .20, .42), dusk * .5);
  vec3 c = mix(zen, hor, pow(1. - mu, 3.4));
  float cs = max(dot(d, sun), 0.);
  c += mix(vec3(1., .5, .2), vec3(1., .92, .78), smoothstep(0., .4, sunH)) * (pow(cs, 6.) * .16 + pow(cs, 90.) * .5 + pow(cs, 3000.) * 40.) * smoothstep(-.09, .03, sunH);
  if (d.y < 0.) c = mix(c, hor * .6, smoothstep(0., -.3, d.y));
  return c;
}`;
const sunDir = new THREE.Vector3(0, 1, 0), lightDir = new THREE.Vector3(0, 1, 0);
const NSKY = params.get("nsky") !== "0", stars = NSKY ? createStars() : null;
const moonDir = MOON_FALLBACK_DIR.clone(), moonSun = new THREE.Vector3(0, -1, 0);
let moonUp = false;
const NC = nightFlags(params, coarse);
const NFT = NC.far === true && index.farNight?.levels ? index.farNight.levels : null;
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: sunDir }, uNight: { value: 0 }, uMoon: { value: moonDir }, uMoonSun: { value: moonSun }, uGlowU: { value: 1 }, uGlow: { value: new Float32Array(8) } },
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  fog: false,
  vertexShader: "varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }",
  fragmentShader: `uniform vec3 uSun; uniform float uNight; uniform vec3 uMoon;${NSKY ? " uniform vec3 uMoonSun;" : ""} varying vec3 vDir; ${SKY_GLSL} ${NSKY ? NIGHT_SKY_GLSL : ""} void main(){ vec3 d = normalize(vDir), c = skyColor(d, uSun);${NSKY ? " if (uNight > 0.) c = nightSky(c, d, uMoon, uMoonSun, uNight);" : ""} gl_FragColor = vec4(c, 1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
});
if (FX2.grade) skyMat.uniforms.uGr2 = { value: FX2U.gr };
const skyDayFS = skyMat.fragmentShader, skyNightFS = NSKY ? skyDayFS.replace(NIGHT_SKY_GLSL, NIGHT_SKY_GLOW_GLSL) : skyDayFS;
let skyNightProg = false;
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
sky.scale.setScalar(9e4);
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);
if (stars) scene.add(stars.points);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat));
const envGround = P79 ? new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 3355443, side: THREE.BackSide, toneMapped: false, fog: false, depthTest: false, depthWrite: false })) : null;
if (envGround) {
  envGround.renderOrder = 1;
  envScene.add(envGround);
}
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const sun = new THREE.DirectionalLight(16777215, 3);
sun.castShadow = LIMIT.shadow > 0;
sun.shadow.mapSize.set(Math.max(16, LIMIT.shadow), Math.max(16, LIMIT.shadow));
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(12571903, 6972760, 0.35);
scene.add(hemi);
scene.fog = new THREE.FogExp2(10467023, 75e-6);
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
let hour = 15.2, night = 0, shadowDirty = true, envDirty = true, facade = null, facadeNightProg = false;
const shadowState = { x: 1e9, z: 1e9, r: 0, t: -1e9 };
const shared = { uTime: { value: 0 }, uNight: { value: 0 }, uRange: { value: 160 }, uWLit: { value: new THREE.Color(1, 1, 1) }, ...FS.on ? { uFsSea: { value: 0 } } : {}, ...NC.far ? { uNightFar: { value: 0 }, uNightKk: { value: FAR_NIGHT.k } } : {} };
const seaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.05, 0.085), roughness: 0.16, metalness: 0 }), sea = new THREE.Mesh(new THREE.CircleGeometry(9e4, 48).rotateX(-Math.PI / 2), seaMat);
sea.position.y = -0.6;
sea.renderOrder = -5;
scene.add(sea);
seaMat.depthWrite = false;
const AE = params.has("ae") ? +params.get("ae") : 0.5;
function twDate() {
  const m = /(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(params.get("date") || ""), now = new Date(Date.now() + 8 * 36e5);
  return [m && m[1] ? +m[1] : now.getUTCFullYear(), m ? +m[2] : now.getUTCMonth() + 1, m ? +m[3] : now.getUTCDate()];
}
function sunDay() {
  if (params.has("dec")) return [+params.get("dec"), 0];
  const [y, mo, d] = twDate();
  const g = 2 * Math.PI * (Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 864e5 / 365, c1 = Math.cos(g), s1 = Math.sin(g), c2 = Math.cos(2 * g), s2 = Math.sin(2 * g);
  return [
    (6918e-6 - 0.399912 * c1 + 0.070257 * s1 - 6758e-6 * c2 + 907e-6 * s2 - 2697e-6 * Math.cos(3 * g) + 148e-5 * Math.sin(3 * g)) * 180 / Math.PI,
    (229.18 * (75e-6 + 1868e-6 * c1 - 0.032077 * s1 - 0.014615 * c2 - 0.040849 * s2) + 4 * (121.5 - 120)) / 60
  ];
}
const fogBase = new THREE.Color(), glowS = { U: 1, dir: skyMat.uniforms.uGlow.value }, glowAt = { e: NaN, n: NaN };
function glowApply(force2) {
  const moved = !(Math.hypot(view.e - glowAt.e, view.n - glowAt.n) < 300);
  if (!force2 && !moved) return;
  if (moved) {
    glowAt.e = view.e;
    glowAt.n = view.n;
    cityGlow(view.e, view.n, glowS);
    skyMat.uniforms.uGlowU.value = glowS.U;
    if (!force2) envDirty = true;
  }
  const k = 1.5 * glowS.U * 0.92 * night;
  scene.fog.color.setRGB(fogBase.r + CITY_GLOW.r * k, fogBase.g + CITY_GLOW.g * k, fogBase.b + CITY_GLOW.b * k);
}
function setTime(h) {
  hour = h;
  const [decDeg, toSolar] = sunDay(), lat = 25.05 * Math.PI / 180, dec = decDeg * Math.PI / 180, H2 = (h + toSolar - 12) * 15 * Math.PI / 180;
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H2), north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H2), east = -Math.cos(dec) * Math.sin(H2);
  sunDir.set(east, up, -north).normalize();
  if (NSKY) {
    const [y, mo, d] = twDate(), m = moonAt(y, mo, d, h);
    moonDir.set(m.dir[0], m.dir[2], -m.dir[1]);
    moonSun.set(m.sun[0], m.sun[2], -m.sun[1]);
    moonUp = m.up;
  }
  const day = smooth(-0.12, 0.14, sunDir.y), dusk = (1 - smooth(0, 0.38, Math.abs(sunDir.y))) * smooth(-0.22, 0.06, sunDir.y);
  night = 1 - smooth(-0.1, 0.1, sunDir.y);
  if (sunDir.y > -0.02) {
    lightDir.copy(sunDir);
    if (lightDir.y < 0.06) {
      lightDir.y = 0.06;
      lightDir.normalize();
    }
    sun.color.setRGB(1, 0.96, 0.9).lerp(new THREE.Color(1, 0.5, 0.22), 1 - smooth(0, 0.36, sunDir.y));
    sun.intensity = 3.3 * smooth(-0.02, 0.14, sunDir.y);
  } else if (NC.wall) {
    if (moonUp) {
      lightDir.copy(moonDir);
      if (lightDir.y < 0.06) {
        lightDir.y = 0.06;
        lightDir.normalize();
      }
    } else lightDir.copy(MOON_FALLBACK_DIR);
    sun.color.setRGB(0.55, 0.66, 1);
    sun.intensity = 0.1 * night * (moonUp ? 0.3 + 0.7 * smooth(0.05, 0.35, moonDir.y) : 1);
  } else {
    lightDir.set(0.35, 0.72, 0.6).normalize();
    sun.color.setRGB(0.55, 0.66, 1);
    sun.intensity = 0.22;
  }
  hemi.intensity = (0.1 + 0.3 * day) * (NC.wall ? 1 - 0.55 * night : 1);
  hemi.color.setRGB(0.75, 0.83, 1);
  hemi.groundColor.setRGB(0.42, 0.4, 0.35);
  const hor = new THREE.Color(0.012, 0.018, 0.036).lerp(new THREE.Color(0.52, 0.68, 0.88), day).lerp(new THREE.Color(0.98, 0.5, 0.22), dusk * 0.5);
  scene.fog.color.copy(hor).multiplyScalar(0.92);
  fogBase.copy(scene.fog.color);
  if (NSKY) {
    skyMat.uniforms.uNight.value = night;
    glowApply(true);
    if (night > 0 !== skyNightProg) {
      skyNightProg = night > 0;
      skyMat.fragmentShader = skyNightProg ? skyNightFS : skyDayFS;
      skyMat.needsUpdate = true;
    }
  }
  shared.uWLit.value.setRGB(1, 1, 1).multiplyScalar(0.05 + 0.95 * day).lerp(new THREE.Color(1, 0.62, 0.4).multiplyScalar(0.7), dusk * 0.55);
  if (envGround) envGround.material.color.setRGB(0.3, 0.29, 0.27).multiplyScalar(0.04 + 0.9 * day).lerp(new THREE.Color(0.34, 0.24, 0.17), dusk * 0.35);
  renderer.toneMappingExposure = (0.82 + 0.75 * night) * (1 + AE * smooth(0.05, 0.3, sunDir.y) * (Math.min(1.6, Math.max(1, Math.sqrt(0.72 / Math.max(sunDir.y, 0.2)))) - 1));
  scene.environmentIntensity = NC.wall ? 0.75 - 0.35 * night : 0.75 + 0.5 * night;
  fx2S.day = day;
  fx2S.dusk = dusk;
  applyLight(FX2, { sun, hemi, scene, envGround, sunDir, day, night });
  shared.uNight.value = night;
  if (facade) facade.uniforms.uNight.value = night;
  if (NC.far) {
    shared.uNightFar.value = 1 - smooth(-0.21, -0.05, sunDir.y);
    if (shared.uNightFar.value > 0) nightSync();
  }
  if (lampMat) {
    const on = 1 - smooth(-0.025, -5e-3, sunDir.y);
    lampMat.uniforms.uNight.value = on;
    lampMat.visible = on > 0;
  }
  {
    stationLitOn.v = 1 - smooth(-0.025, -5e-3, sunDir.y);
    for (const m of stationLit.values()) m.emissiveIntensity = stationLitOn.v * LIT_GAIN;
    for (const w of stationWeekly.values()) {
      w.m.emissiveIntensity = stationLitOn.v * WEEK_GAIN;
      w.m.emissive.setRGB(...weeklyColor(w, h));
    }
  }
  if (NC.win && night > 0 !== facadeNightProg) {
    facadeNightProg = night > 0;
    for (const m of /* @__PURE__ */ new Set([facade?.material, facadeMat, facadeFarMat])) if (m) m.needsUpdate = true;
  }
  shadowDirty = envDirty = true;
  shadowState.t = -1e9;
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  $("clock").textContent = String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
function updateEnv() {
  const rt = pmrem.fromScene(envScene, 0, 0.1, 10);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
  envDirty = false;
}
function groundMaterial(u) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.bore = { a: [0, 1, 2, 3].map(() => new THREE.Vector4()), b: [0, 1, 2, 3].map(() => new THREE.Vector4()) };
  u.uBoreA = { value: m.bore.a };
  u.uBoreB = { value: m.bore.b };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, u);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW; varying vec2 vL;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz; vL = vec2(position.x, -position.z);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
uniform sampler2D tSat; uniform sampler2D tMask; uniform sampler2D tHarbor; uniform float uTime; uniform vec2 uSat; uniform float uSize; uniform vec2 uNoise; uniform float uRange; uniform float uNight; uniform float uHide[16]; uniform vec4 uBoreA[4]; uniform vec4 uBoreB[4];${FS.on ? " uniform float uFsSea;" : ""}
varying vec3 vW; varying vec2 vL;
float gH(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 gN(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6. - 15.) + 10.), du = 30. * f * f * (f * (f - 2.) + 1.);
  float a = gH(i), b = gH(i + vec2(1., 0.)), c = gH(i + vec2(0., 1.)), d = gH(i + vec2(1., 1.));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx)); }
vec2 gRot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }`).replace("#include <map_fragment>", `
  // 遠景塊：已經有近、中距離圖磚蓋住的那幾格不畫
  // 隧道洞口：洞身淨空內的地形挖掉（uBoreA＝洞口位置與往內的方向，uBoreB＝軌頂高度、半寬、坡度、是否啟用）。洞口前 4 m 高出道床的全挖，洞內 12 m 挖到拱頂。
  for (int i = 0; i < 4; i++) { if (uBoreB[i].w < .5) continue; vec2 q = vL - uBoreA[i].xy; float d = dot(q, uBoreA[i].zw), u = abs(dot(q, vec2(-uBoreA[i].w, uBoreA[i].z)));
    if (u < uBoreB[i].y && d > -4. && d < 12.) { float y = vW.y - uBoreB[i].x - uBoreB[i].z * d; if (y > -.57 && (d < 0. || y < 6.)) discard; } }
  if (uSize > 2000.) { vec2 c = clamp(floor(vL / ${FS.on ? "(uSize * .25)" : "1280."}), 0., 3.); if (uHide[int(c.x + c.y * 4.)] > .5) discard; }${FS.on ? `
  if (uFsSea > .5 && vW.y < -1.5) discard;   // 第 137 包：拉遠時海平面以下（塊的外緣裙邊）不畫，交給海平面` : ""}
  vec2 P = vL + uNoise, uvS = (vL + uSat.x) / uSat.y, uvM = vL / uSize;
  vec3 coreM = texture2D(tMask, uvM).rgb;   // 第 162 包：遠景塊（uSize > 2000）的 R 是夜燈密度、不是建物腳印，foot 當 0
  float sd = (coreM.b * 255. - 128.) / 127. * uRange, pond = coreM.g, foot = uSize > 2000. ? 0. : coreM.r, harbor = texture2D(tHarbor, uvM).r;
  vec3 sat = texture2D(tSat, uvS).rgb;
  float dist = length(cameraPosition - vW), nearF = 1. - smoothstep(120., 1100., dist), pxm = max(length(dFdx(P)), length(dFdy(P)));
  vec3 land = sat * 3.1 / (1. + sat * 2.3);
  float veg = smoothstep(.05, .2, (sat.g - max(sat.r, sat.b)) / (sat.r + sat.g + sat.b + .002));
  float can = gN(P / 9.).x * .5 + gN(P / 3.1).x * .32 + gN(P / 31.).x * .18;
  land *= mix(1., .55 + .9 * can, veg * (.25 + .6 * nearF));
  land *= mix(1., .36 / max(dot(land, vec3(.3, .5, .2)), .36), (1. - veg) * .7);
  vec3 pave = vec3(.27, .27, .26) * (.82 + .36 * gN(P / 2.1).x * nearF + .1 * gN(P / 17.).x);
  land = mix(land, pave, clamp(foot * 1.5, 0., 1.) * (1. - veg * .6) * .9);
  land *= 1. - .22 * foot;
  float wat = max(smoothstep(-.8, .9, sd), smoothstep(.4, .62, pond));
  vec3 gNrm = vec3(0., 1., 0.); float gRough = .96; vec3 gCol = land;
  if (wat > .001) {
    float depth = clamp(sd / 150., 0., 1.), calm = mix(.3, 1., smoothstep(4., 140., sd)) * mix(1., .4, harbor);
    vec3 wc = mix(vec3(.035, .17, .19), vec3(.006, .04, .085), pow(depth, .55));
    wc = mix(wc, sat * 2.2, .22);
    vec2 grad = vec2(0.); float lost = 0.;
    for (int i = 0; i < 6; i++) { float fi = float(i), L = 70. * pow(.42, fi), amp = .055 * L * (i < 2 ? 1. : .75) * calm, ang = fi * 1.9 + .6;
      vec2 q = gRot(P, ang) / L + vec2(uTime * (.35 + .22 * fi) * sqrt(9.8 * L) / L * .14, fi * 7.3);
      vec3 n = gN(q); float vis = 1. - smoothstep(.35, 1.1, pxm / L);
      grad += gRot(n.yz, -ang) * (amp / L) * vis; lost += (amp / L) * (1. - vis); }
    gNrm = normalize(vec3(-grad.x, 1., grad.y));
    float foam = (1. - smoothstep(0., 3.4, sd)) * smoothstep(.56, .9, gN(P / 1.6 + vec2(uTime * .25, 0.)).x + .3 * sin(sd * 1.4 - uTime * 1.3)) * step(0., sd) * (1. - smoothstep(.15, .6, harbor));
    wc = mix(wc, vec3(.82, .86, .86), foam * .75);
    gCol = mix(land, wc, wat); gRough = mix(.96, clamp(.055 + lost * 1.6 + foam * .5, .05, .7), wat);
  }
  diffuseColor.rgb = gCol;`).replace("#include <roughnessmap_fragment>", "float roughnessFactor = gRough;").replace("#include <normal_fragment_maps>", "normal = normalize(mix(normal, normalize(mat3(viewMatrix) * gNrm), wat));");
    reflectGround(sh);
    p24Ground(sh);
    if (NC.glow) nightGroundPatch(sh, NC.far);
    if (FX2.ground || FX2.ao) groundPatch(sh, FX2, AO2);
    if (FX3.land) fx3LandPatch(sh, FX3);
    if (FX3.ground) fx3GroundPatch(sh, FX3);
    if (HS2) shadePatch(sh, HS2, FX2.T.hd);
    aeroGroundPatch(sh);
    if (FS.on) sh.fragmentShader = fxRep(sh.fragmentShader, "    wc = mix(wc, sat * 2.2, .22);", "    wc = mix(wc, sat * 2.2, .22 * (1. - uFsSea * smoothstep(40., 150., sd)));");
  };
  m.customProgramCacheKey = () => "land-ground-2" + AERO_KEY + FXKEY + P24KEY + (NC.glow ? "-n64" + (NC.far ? "f" : "") : "") + (FX2.ground || FX2.ao || HS2 ? FX2.key : "") + (FX3.ground || FX3.land ? FX3.key : "");
  return m;
}
const P24KEY = (P24.wq === 0 ? "-wq0" : "") + (params.get("dbg") === "wat" ? "-dbgw" : "");
function p24Ground(sh) {
  if (P24.wq === 0) sh.fragmentShader = fxRep(sh.fragmentShader, "for (int i = 0; i < 6; i++) { float fi = float(i), L = 70.", "for (int i = 0; i < 0; i++) { float fi = float(i), L = 70.");
  if (params.get("dbg") === "wat") sh.fragmentShader = fxRep(sh.fragmentShader, "  diffuseColor.rgb = gCol;", "  diffuseColor.rgb = wat > .001 ? vec3(1., 0., 0.) : vec3(0., .2, 0.);");
}
const FXKEY = (FX.river ? "-r" : "") + (FX.farm ? "-f" + (FX.farmB ? "b" : "") : "") + (FX.seaBase ? "-s" : "");
const fxRep = (src, a, b) => {
  if (!src.includes(a)) throw Error("地面著色器對不上（第 21 包）：" + a.slice(0, 60));
  return src.replace(a, b);
};
function reflectGround(sh) {
  if (!FX.river && !FX.farm && !FX.seaBase) return;
  let f = sh.fragmentShader;
  f = fxRep(f, "uniform vec4 uBoreB[4];", "uniform vec4 uBoreB[4]; uniform vec3 uWLit;" + (FX.farm ? " uniform sampler2D tFarm;" : ""));
  f = fxRep(f, "#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += gEmis;");
  f = fxRep(f, "  vec3 gNrm = vec3(0., 1., 0.); float gRough = .96; vec3 gCol = land;", "  vec3 gNrm = vec3(0., 1., 0.); float gRough = mix(.96, fRough, fW); vec3 gCol = land; vec3 gEmis = vec3(0.);");
  let farm = "  float fRough = .96, fW = 0.;\n";
  if (FX.farm) farm = `  // 田（farm.png：R＝農地、G＝田的長邊方向 0～180°）：田埂把田切成一塊一塊、田裡成列的稻；近看才畫細節，遠了退回影像原色（用每像素公尺數 pxm 淡出，不閃、沒有規則摩爾紋）
  float fRough = .96, fW = texture2D(tFarm, uvM).r;
  if (fW > .01) {
    float fa = texelFetch(tFarm, ivec2(clamp(uvM, 0., .9999) * 256.), 0).g * 3.14159265;
    vec2 Q = gRot(P, -fa);
    float sy = floor(Q.y / 30.), hs = gH(vec2(sy, 17.3)), lx = 70. + 45. * hs, qx = Q.x + hs * 97.;
    vec2 fid = vec2(floor(qx / lx), sy), cell = vec2(fract(qx / lx) * lx, fract(Q.y / 30.) * 30.);
    float edge = min(min(cell.x, lx - cell.x), min(cell.y, 30. - cell.y)), pt = gH(fid * 1.7 + 3.1), pt2 = gH(fid * 2.3 + 8.9);
    float tintV = (1. - smoothstep(5., 14., pxm)) * smoothstep(0., pxm * 1.5 + .4, edge);
    vec3 fc = land * mix(vec3(.8, .88, .76), vec3(1.18, 1.1, .92), pt) * mix(1., .88, pt2);
    fc = mix(land, fc, tintV);
    float ridgeV = 1. - smoothstep(.25, .8, pxm), ridge = (1. - smoothstep(.22, .22 + pxm + .04, edge)) * ridgeV;
    float rw = pxm / .3, rowV = 1. - smoothstep(.35, .9, rw), rowF = abs(fract(Q.y / .3) - .5) * 2., plant = smoothstep(.5 - rw * .5 - .06, .5 + rw * .5 + .06, rowF);
    float furrow = (1. - plant) * rowV * smoothstep(.5, 1., edge);
    vec3 green = land * vec3(.82, 1.08, .78);
    fc = mix(fc, fc * .74, furrow * .8); fc = mix(fc, green, plant * rowV * .35);
    float wet = 0.;` + (FX.farmB ? `
    float fl = step(pt2, .3) * smoothstep(.5, 1.2, edge) * (1. - smoothstep(12., 26., pxm)) * (1. - smoothstep(.3, .7, veg));   // 影像很綠的（多半是樹林）不灌水
    vec3 wcol = mix(vec3(.035, .05, .045), land * .45, .35);
    float stem = mix(.22, plant, rowV);
    fc = mix(fc, mix(wcol, green * .9, stem), fl);
    wet = fl * (1. - stem);` : "") + `
    vec3 rcol = mix(land * .85, vec3(.13, .17, .08), .45) * (1. + .12 * gN(P / .7).x);
    fc = mix(fc, rcol, ridge * .8);
    land = mix(land, fc, fW);
    fRough = mix(mix(.96, .35, furrow * .55), .07, wet) * (1. - ridge) + .95 * ridge;
  }
`;
  f = fxRep(f, "  float wat = max(smoothstep(-.8, .9, sd), smoothstep(.4, .62, pond));", farm + "  float wat = max(smoothstep(-.8, .9, sd), smoothstep(.4, .62, pond));");
  if (FX.river || FX.seaBase) {
    const inl = FX.river ? "(1. - smoothstep(-.8, .9, sd))" : "0.";
    f = fxRep(f, "    wc = mix(wc, sat * 2.2, .22);", `    wc = mix(wc, sat * 2.2, .22);
    float inl = ${inl}, bodyW = ${FX.seaBase ? "1." : "inl"};
    vec3 wcI = mix(vec3(.045, .065, .05), sat * 2., .4); wcI *= min(1., .13 / max(dot(wcI, vec3(.3, .5, .2)), .001));
    wc = mix(wc, wcI, inl); calm = mix(calm, .45, inl);`);
    f = fxRep(f, "L = 70. * pow(.42, fi)", "L = mix(70., 3.2, inl) * pow(.42, fi)");
    f = fxRep(
      f,
      "    gCol = mix(land, wc, wat); gRough = mix(.96, clamp(.055 + lost * 1.6 + foam * .5, .05, .7), wat);",
      "    gCol = mix(land, wc * mix(1., .12, bodyW), wat); gRough = mix(.96, clamp(mix(.055, .03, inl) + lost * mix(1.6, .5, inl) + foam * .5, .03, .7), wat); gEmis = wc * .88 * bodyW * wat * uWLit;"
    );
  }
  sh.fragmentShader = f;
}
const NOISE_WRAP = TILE_M * 16, noiseOrg = (e0, n0) => new THREE.Vector2((e0 % NOISE_WRAP + NOISE_WRAP) % NOISE_WRAP, (n0 % NOISE_WRAP + NOISE_WRAP) % NOISE_WRAP);
const geom = (o, extra = {}) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(o.pos, 3));
  if (o.nor) g.setAttribute("normal", new THREE.BufferAttribute(o.nor, 4, true));
  if (o.col) g.setAttribute("color", new THREE.BufferAttribute(o.col, 4, true));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, v);
  if (o.idx) g.setIndex(new THREE.BufferAttribute(o.idx, 1));
  g.computeBoundingSphere();
  return g;
};
const geomBytes = (g) => [...new Set(Object.values(g.attributes))].reduce((s, a) => s + (a.array?.byteLength || a.data?.array.byteLength || 0), 0) + (g.index?.array.byteLength || 0);
const railMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
railMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 aRail; varying vec3 vRail3;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRail3 = aRail;");
  sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vRail3;
float rH(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float rN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(rH(i), rH(i + vec2(1., 0.)), f.x), mix(rH(i + vec2(0., 1.)), rH(i + vec2(1., 1.)), f.x), f.y); }`).replace("#include <map_fragment>", `
  vec2 vRail = vRail3.xy; float uHalfGauge = vRail3.z;
  float ru = vRail.x, rv = vRail.y, px = max(length(vec2(dFdx(ru), dFdy(ru))), length(vec2(dFdx(rv), dFdy(rv)))) + 1e-4;
  float grain = mix(.5, rN(vRail * 14.) * .55 + rN(vRail * 37.) * .45, 1. - smoothstep(.02, .12, px));
  vec3 bal = mix(vec3(.30, .285, .265), vec3(.37, .36, .345), rN(vRail * vec2(.9, .22))) * (.62 + .76 * grain);
  float rd = abs(abs(ru) - uHalfGauge);
  bal = mix(bal, vec3(.2, .15, .11), (1. - smoothstep(0., .45, rd)) * .4);
  float tieHalf = uHalfGauge + .47, inTie = 1. - smoothstep(tieHalf - px, tieHalf + px, abs(ru)), tv = abs(fract(rv / .6) - .5) * .6;
  float tie = mix((1. - smoothstep(.12 - px, .12 + px, tv)) * inTie, .4 * inTie, smoothstep(.1, .35, px));
  vec3 rc = mix(bal, vec3(.46, .45, .43) * (.85 + .3 * rN(vRail * vec2(3., 9.))), tie);
  float steel = clamp((.036 - rd) / px + .5, 0., 1.) * min(1., .072 / px + .25);
  rc = mix(rc, vec3(.58, .58, .57), steel);
  float rRough = mix(.95, .32, steel), rMetal = steel * .85;
  diffuseColor.rgb = rc;`).replace("#include <roughnessmap_fragment>", "float roughnessFactor = rRough;").replace("#include <metalnessmap_fragment>", "float metalnessFactor = rMetal;");
};
const RHL = createRailHl({ params, DATA, index, TILE_M, scene, origin, shared });
if (RHL?.band) RHL.band.patch(railMat);
const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
const simpleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const roadFlatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
if (NC.glow) nightRoadPatch(roadFlatMat, shared.uNight);
if (NC.glow) nightRoadPatch(roadMat, shared.uNight);
if (NC.mid) nightMidPatch(simpleMat, shared.uNight);
if (FX2.any) simplePatch(simpleMat, FX2, HS2);
if (HS2) for (const m of [roadMat, roadFlatMat, railMat]) {
  const ob = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    if (ob) ob.call(m, sh, r);
    shadePatch(sh, HS2, FX2.T.hd);
  };
  m.customProgramCacheKey = () => (key ? key.call(m) : "") + "-hs121";
}
if (FX3.far) fx3SimplePatch(simpleMat, FX3);
const farGeom = (g) => {
  if (FX3.far) g.setAttribute("aFar", g.attributes.normal);
  return g;
};
const lampMat = NC.lamp ? createLampMaterial(scene.fog.density, NC.lmix ? blackTex : null) : null;
const wallMat = new THREE.MeshStandardMaterial({ color: 9408136, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
let ugPortalMat = null, lxMat = null;
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
const makeTreeGeo = (detail) => {
  const geo = new THREE.IcosahedronGeometry(1, detail), p = geo.attributes.position, c = new Float32Array(p.count * 3), hsh = (x, y, z) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hsh(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50)) - 0.5) * 0.5, yy = y * k * (y > 0 ? 0.85 : 0.6) + 0.8;
    p.setXYZ(i, x * k, yy, z * k);
    const s = 0.42 + 0.62 * Math.max(0, Math.min(1, yy / 1.7));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
  }
  geo.computeVertexNormals();
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return geo;
};
const treeLo = makeTreeGeo(0), treeHi = coarse ? treeLo : makeTreeGeo(1), sharedGeo = /* @__PURE__ */ new Set([treeLo, treeHi]);
const stationSolid = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.62, side: THREE.DoubleSide }), stationGlass = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.3, side: THREE.DoubleSide });
const stationLit = /* @__PURE__ */ new Map(), stationLitOn = { v: 0 };
const BLOOM_ON = (params.has("nbloom") ? params.get("nbloom") === "1" : !coarse && params.get("n64") !== "0") || FX2.bloom, LIT_GAIN = BLOOM_ON ? 1 : 1.6, WEEK_GAIN = BLOOM_ON ? 1 : 0.7;
const stationLitMat = (e) => {
  const k = e.join(",");
  let m = stationLit.get(k);
  if (!m) {
    m = stationSolid.clone();
    m.emissive.setRGB(e[0], e[1], e[2]);
    m.emissiveIntensity = stationLitOn.v * LIT_GAIN;
    stationLit.set(k, m);
  }
  return m;
};
const stationWeekly = /* @__PURE__ */ new Map();
const twWeekday = () => {
  const m = /(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(params.get("date") || ""), now = new Date(Date.now() + 8 * 36e5), d = m ? new Date(Date.UTC(m[1] ? +m[1] : now.getUTCFullYear(), +m[2] - 1, +m[3])) : now;
  return (d.getUTCDay() + 6) % 7;
};
const weeklyColor = (w, h) => h >= w.hours[0] && h < w.hours[1] ? w.week[twWeekday()] : w.base;
const stationWeeklyMat = (part) => {
  const k = JSON.stringify([part.nightEmissiveWeekly, part.nightEmissive || null, part.nightWeeklyHours || null]);
  let w = stationWeekly.get(k);
  if (!w) {
    w = { m: stationSolid.clone(), week: part.nightEmissiveWeekly, base: part.nightEmissive || [0, 0, 0], hours: part.nightWeeklyHours || [18, 22] };
    w.m.emissive.setRGB(...weeklyColor(w, hour));
    w.m.emissiveIntensity = stationLitOn.v * WEEK_GAIN;
    stationWeekly.set(k, w);
  }
  return w.m;
};
const isWeekly = (part) => Array.isArray(part.nightEmissiveWeekly) && part.nightEmissiveWeekly.length === 7;
function stationGroup(buf, lod) {
  const { pos, nor, index: index2 } = decodeStation(buf, lod), n = lod.vertexCount, col = new Float32Array(n * 3), solid = [], glass = [], lit = /* @__PURE__ */ new Map(), wk = /* @__PURE__ */ new Map();
  for (const part of lod.drawGroups) {
    const e = Array.isArray(part.nightEmissive) && part.nightEmissive.length === 3 ? part.nightEmissive : null, list = isWeekly(part) ? wk.get(part) || wk.set(part, []).get(part) : e ? lit.get(e.join(",")) || lit.set(e.join(","), []).get(e.join(",")) : part.metalness > 0.15 ? glass : solid;
    for (let i = part.start; i < part.start + part.count; i++) {
      const v = index2[i];
      col[v * 3] = part.color[0];
      col[v * 3 + 1] = part.color[1];
      col[v * 3 + 2] = part.color[2];
      list.push(v);
    }
  }
  const g = new THREE.Group();
  g.rotation.x = -Math.PI / 2;
  const pa = new THREE.BufferAttribute(pos, 3), na = new THREE.BufferAttribute(nor, 3, true), ca = new THREE.BufferAttribute(col, 3);
  for (const [list, mat] of [[solid, stationSolid], [glass, stationGlass], ...[...lit].map(([k, l]) => [l, stationLitMat(k.split(",").map(Number))]), ...[...wk].map(([part, l]) => [l, stationWeeklyMat(part)])]) {
    if (!list.length) continue;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", pa);
    bg.setAttribute("normal", na);
    bg.setAttribute("color", ca);
    bg.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(list) : new Uint16Array(list), 1));
    addMesh(g, bg, mat).frustumCulled = !!P24.stnCull;
  }
  g.userData.bytes = pos.byteLength + nor.byteLength + col.byteLength + lod.indexCount * (n > 65535 ? 4 : 2);
  return g;
}
facade = createFacade(renderer, { coarse, glass: { a: 1, b: 2 }[params.get("glass")] || 0, pane: FX.glassR === 2 ? "color" : !!FX.glassR, nwin: NC.win, nroom: NC.room, fx: P79 ? P79W ? "full" : "lite" : false });
{
  const orig = facade.material.onBeforeCompile, from = "vSV = aSV; vLv = aLv; vHs = aHs; vRn = aRn; vCol = aCol; vTnt = aTnt;";
  facade.material.onBeforeCompile = (sh) => {
    orig(sh);
    if (!sh.vertexShader.includes(from)) throw Error("立面著色器對不上，精簡格式沒有套用");
    sh.vertexShader = sh.vertexShader.replace(from, "vSV = aSV; vLv = aLv * vec4(1., .001, .001, .01); vHs = aHs; vRn = vec4(aRn.x / 65535., aRn.y - 1., aRn.z, aRn.w); vCol = aCol * aCol; vTnt = aTnt * aTnt;");
  };
  facade.material.customProgramCacheKey = () => "tw-facade-compact-1" + (P79 ? "-p79" + (P79W ? "" : "l") : "");
}
if (FX2.any) {
  const ob = facade.material.onBeforeCompile, key = facade.material.customProgramCacheKey;
  if (FX2.wall || FX2.win || FX2.ao || HS2) facade.material.onBeforeCompile = (sh, r) => {
    ob(sh, r);
    facadePatch(sh, FX2, AO2);
    if (HS2) shadePatch(sh, HS2, FX2.T.hd);
  };
  facade.material.customProgramCacheKey = () => key() + FX2.key + (NC.win && facade.uniforms.uNight.value > 0 ? "-n114" : "");
}
if (FX3.roof || FX3.facade || FX3.glass) {
  const ob = facade.material.onBeforeCompile, key = facade.material.customProgramCacheKey;
  facade.material.onBeforeCompile = (sh, r) => {
    ob(sh, r);
    fx3FacadePatch(sh, FX3);
  };
  facade.material.customProgramCacheKey = () => key() + FX3.key + (NC.win && facade.uniforms.uNight.value > 0 ? "-n116" : "");
}
if (!P28.fWin) facade.uniforms.uDetail.value = 0;
const facadeMat = P28.fBasic ? new THREE.MeshBasicMaterial({ color: 10131343 }) : P28.fSide || !P28.fEnv ? (() => {
  const m = facade.material.clone(), ob = facade.material.onBeforeCompile, key = facade.material.customProgramCacheKey;
  m.onBeforeCompile = P28.fEnv ? ob : (sh) => {
    ob(sh);
    sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_maps>", "");
  };
  m.customProgramCacheKey = () => key() + (P28.fEnv ? "" : "-noenv");
  if (P28.fSide) {
    m.side = THREE.FrontSide;
    m.shadowSide = P28.fShSide === 2 ? THREE.DoubleSide : null;
  }
  return m;
})() : facade.material;
const facadeFarMat = P28.fFar > 0 && !P28.fBasic ? (() => {
  const m = facadeMat.clone(), ob = facadeMat.onBeforeCompile, key = facadeMat.customProgramCacheKey;
  m.side = facadeMat.side;
  m.shadowSide = facadeMat.shadowSide;
  m.onBeforeCompile = (sh) => {
    ob(sh);
    let f = sh.fragmentShader;
    const need = (x, y) => {
      if (!f.includes(x)) throw Error("便宜版立面對不上：" + x.slice(0, 40));
      f = f.split(x).join(y);
    };
    if (P28.fFarShd) need("#include <lights_fragment_begin>", `#define getShadow twShadow4
#include <lights_fragment_begin>
#undef getShadow`), need("#include <shadowmap_pars_fragment>", `#include <shadowmap_pars_fragment>
#ifdef USE_SHADOWMAP
float twShadow4( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float shadow = 1.0; shadowCoord.xyz /= shadowCoord.w; shadowCoord.z += shadowBias;
  if ( shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0 && shadowCoord.z <= 1.0 ) {
    vec2 t = vec2( 1.0 ) / shadowMapSize, uv = shadowCoord.xy, f = fract( uv * shadowMapSize + 0.5 ); uv -= f * t;
    shadow = mix( mix( texture2DCompare( shadowMap, uv, shadowCoord.z ), texture2DCompare( shadowMap, uv + vec2( t.x, 0.0 ), shadowCoord.z ), f.x ),
                  mix( texture2DCompare( shadowMap, uv + vec2( 0.0, t.y ), shadowCoord.z ), texture2DCompare( shadowMap, uv + t, shadowCoord.z ), f.x ), f.y ); }
  return mix( 1.0, shadow, shadowIntensity );
}
#endif`);
    if (P28.fFarWin) {
      need("if (fCage && k > .5", "if (false && fCage && k > .5");
      need("if (fAc && k > .5", "if (false && fAc && k > .5");
      need("if (fBands && k > .5", "if (false && fBands && k > .5");
    }
    if (P28.fFarEnv) {
      const from = "iblIrradiance += getIBLIrradiance( geometryNormal );", ch = THREE.ShaderChunk.lights_fragment_maps;
      if (!ch.includes(from)) throw Error("便宜版立面對不上：環境光");
      need("#include <lights_fragment_maps>", ch.replace(from, "iblIrradiance += PI * mix( vec3( .42, .40, .37 ), vec3( .62, .70, .82 ), inverseTransformDirection( geometryNormal, viewMatrix ).y * .5 + .5 ) * envMapIntensity;"));
    }
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => key() + "-far" + P28.fFarShd + P28.fFarWin + P28.fFarEnv;
  return m;
})() : null;
if (RHL?.fade) {
  for (const m of /* @__PURE__ */ new Set([facade.material, facadeMat, facadeFarMat, simpleMat])) if (m && !m.isMeshBasicMaterial) RHL.fade(m);
}
const facadeMeshes = /* @__PURE__ */ new Set();
let facadeFar = false;
const facadeFarCheck = () => {
  const far = !!facadeFarMat && !ride.on && view.dist > P28.fFar;
  if (far === facadeFar) return;
  facadeFar = far;
  for (const m of facadeMeshes) m.material = far ? facadeFarMat : facadeMat;
};
const roadMeshes = /* @__PURE__ */ new Set();
let roadFar = false;
const roadRange = (m) => {
  const u = m.userData;
  if (roadFar && u.nFar) m.geometry.setDrawRange(u.nMain, u.nFar);
  else m.geometry.setDrawRange(0, u.nMain);
};
const roadFarCheck = () => {
  const far = P28.rdFar > 0 && !ride.on && view.dist > P28.rdFar;
  if (far === roadFar) return;
  roadFar = far;
  for (const m of roadMeshes) roadRange(m);
};
const facadeGeometry = (c) => geom(c, { aSV: new THREE.BufferAttribute(c.sv, 4), aLv: new THREE.BufferAttribute(c.lv, 4), aHs: new THREE.BufferAttribute(c.hs, 4), aRn: new THREE.BufferAttribute(c.rn, 4), aCol: new THREE.BufferAttribute(c.col, 4, true), aTnt: new THREE.BufferAttribute(c.tnt, 4, true) });
const tiles = /* @__PURE__ */ new Map(), fars = /* @__PURE__ */ new Map(), total = { bytes: 0, tiles: 0, geomBytes: 0, texBytes: 0, buildMs: 0 };
const gridAt = (h, n, step, x, y) => {
  const u = Math.max(0, Math.min(n - 1 - 1e-6, x / step)), v = Math.max(0, Math.min(n - 1 - 1e-6, y / step)), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * n + i;
  return (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + n] * (1 - a) + h[k + n + 1] * a) * b;
};
function groundAt(e, n) {
  const ti = Math.floor(e / TILE_M), tj = Math.floor(n / TILE_M), t = tiles.get(tileId(ti, tj));
  if (t?.h) return gridAt(t.h, FINE_N, FINE_STEP, e - ti * TILE_M, n - tj * TILE_M);
  const fi = Math.floor(e / FAR_M), fj = Math.floor(n / FAR_M), f = fars.get(farId(fi, fj));
  if (f?.h) return gridAt(f.h, 129, 40, e - fi * FAR_M, n - fj * FAR_M);
  if (FS.on) for (let k = 2; k <= FSTOP; k++) {
    const M = FSL[k].blockM, ci = Math.floor(e / M), cj = Math.floor(n / M), c = fars.get(`L${k}:` + farId(ci, cj));
    if (c?.h) return gridAt(c.h, 129, M / 128, e - ci * M, n - cj * M);
  }
  return 0;
}
const place = (group, e0, n0) => group.position.set(e0 - origin.e, 0, -(n0 - origin.n));
const lampDeck = (groundAt2) => (r, x, y) => {
  let best = null;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x - a[0] - dx * f, y - a[1] - dy * f);
    if (!best || d < best.d) best = { d, h: (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * f };
  }
  return best && best.h > 0.3 ? groundAt2(x, y) + best.h : null;
};
function addMesh(parent, g, m, { cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}
const stageQ = [], HIDDEN = 1, unculled = [], force = (m) => {
  if (m.frustumCulled) {
    m.frustumCulled = false;
    unculled.push(m);
  }
};
const stageOn = () => LIMIT.stage > 0, hold = (o) => o.traverse((m) => {
  if (m.isMesh) m.layers.set(HIDDEN);
});
const drawn = (m) => {
  let o = m;
  for (; o; o = o.parent) {
    if (!o.visible) return false;
    if (!o.parent) break;
  }
  return o === scene;
};
const texKB = (x) => {
  const i = x.image;
  return Math.max(1, (i?.width || 1) * (i?.height || 1) * 4 * 1.33 / 1024);
};
const stageTex = (x, alive) => stageQ.push({ alive, run: () => {
  renderer.initTexture(x);
  return texKB(x);
} });
const stageMesh = (m, alive) => stageQ.push({ alive, run: () => {
  m.layers.set(0);
  if (!drawn(m)) return false;
  force(m);
  m.userData.up = true;
  return Math.max(1, geomBytes(m.geometry) / 1024);
} });
function drainStage() {
  while (unculled.length) unculled.pop().frustumCulled = true;
  const still = LIMIT.still > 0 && performance.now() >= movingUntil;
  if (!still && LIMIT.late > 0 && lastDt > 20) {
    prof.cur.stageSkip = 1;
    return 0;
  }
  let kb = 0;
  while (stageQ.length) {
    const s = stageQ.shift();
    if (s.alive && !s.alive()) continue;
    const b = s.run();
    if (!b) continue;
    kb += b;
    if (!still || kb >= LIMIT.stillKB || performance.now() - frameT0 >= LIMIT.still) break;
  }
  return kb;
}
async function loadTile(id, ti, tj, n = 0) {
  const url = DATA + id + "/", e0 = ti * TILE_M, n0 = tj * TILE_M, t = { id, ti, tj, e0, n0, lod: 1, state: "loading", near: null, group: new THREE.Group(), bytes: 0, geomBytes: 0, texBytes: 0, calls: 0 };
  tiles.set(id, t);
  const lampRoads = lampMat ? json(url + "roads.json").catch(() => null) : null;
  const t0 = performance.now(), [meta, rails, stations] = await Promise.all([json(url + "tile.json"), json(url + "rails.json"), json(url + "stations.json")]), V = (name) => vspec(meta.files, name);
  t.vf = { "terrain.bin": V("terrain.bin"), "rtin.bin": V("rtin.bin") };
  const [base, tSat, tMask] = await Promise.all([job("base", { url, lo: LIMIT.lo, skip: SKIP, mid: P24.rtin === "mid", rtin: P24.rtin !== "calc" && (index.tiles[id]?.version || 0) >= 9, ...FX3.far ? { far: FX3.farW } : {}, vf: t.vf, rn: n }), tex(url + "sat.jpg", true, true, V("sat.jpg"), n), tex(url + "mask.png", false, false, V("mask.png"), n)]);
  const tHarbor = meta.hasHarbor ? await tex(url + "harbor.png", false, false, V("harbor.png"), n) : blackTex, tFarm = FX.farm && meta.hasFarm ? await tex(url + "farm.png", false, false, V("farm.png"), n) : blackTex, tLand = landSet?.has(id) ? await tex(url + "land.png", false, false, { v: landVer }, n) : blackTex, aero = aeroSet.has(id) ? await loadAero(url, (u, s, m) => tex(u, s, m, { v: aeroSet.v || VER }, n)).catch(() => null) : null;
  if (!tiles.has(id)) return;
  t.meta = meta;
  t.tLand = tLand;
  t.aero = aero;
  t.h = base.h;
  t.bytes = meta.bytes;
  t.texBytes = 130 * 130 * 4 * 1.33 + 512 * 512 * 4 + (meta.hasHarbor ? 128 * 128 * 4 : 0) + (tFarm !== blackTex ? 256 * 256 * 4 : 0) + (tLand !== blackTex ? 512 * 512 * 4 : 0) | 0;
  t.textures = [tSat, tMask, ...meta.hasHarbor ? [tHarbor] : [], ...tFarm !== blackTex ? [tFarm] : [], ...tLand !== blackTex ? [tLand] : []];
  if (aero) {
    t.texBytes += 512 * 512 * 4;
    t.textures.push(aero.tex);
  }
  const local = (x, y) => gridAt(t.h, FINE_N, FINE_STEP, x, y);
  t.nightR = NC.far ? { value: blackTex } : null;
  t.nightK = NC.far ? { value: 0 } : null;
  t.nightRo = NC.far ? { value: new THREE.Vector3((ti & 3) * TILE_M, (tj & 3) * TILE_M, FAR_M) } : null;
  tm("tile.mat", () => {
    t.mat = groundMaterial({ tSat: { value: tSat }, tMask: { value: tMask }, tHarbor: { value: tHarbor }, tFarm: { value: tFarm }, ...t.nightR ? { tNightR: t.nightR, uNightK: t.nightK, uNightRo: t.nightRo } : {}, ...FX3.land ? { tLand: { value: tLand }, uLandOn: { value: tLand !== blackTex ? 1 : 0 }, uLandV: { value: landV } } : {}, uSat: { value: new THREE.Vector2(10, 1300) }, uSize: { value: TILE_M }, uNoise: { value: noiseOrg(e0, n0) }, uHide: { value: new Array(16).fill(0) }, ...aeroUniforms(aero) });
  });
  tm("tile.terrain", () => {
    t.terrain = base.lods.map((l) => addMesh(t.group, geom(l), t.mat));
    t.terrainTris = base.lods.map((l) => l.idx.length / 3);
    t.simple = base.simple.n ? addMesh(t.group, farGeom(geom(base.simple)), simpleMat) : null;
    t.simpleLo = base.simpleLo?.n ? addMesh(t.group, farGeom(geom(base.simpleLo)), simpleMat) : null;
    if (t.simpleLo) t.simpleLo.visible = false;
  });
  tm("tile.rail", () => {
    const pos = [], nor = [], rl = [], idx = [], rc = RHL?.band ? [] : null;
    let n2 = 0;
    const SEC = RHL?.band ? RHL.band.SEC : [[-2.6, -0.62], [-1.7, -0.17], [1.7, -0.17], [2.6, -0.62]];
    for (const tr of rails.tracks) {
      if (tr.kind === 2) continue;
      const rcol = rc && RHL.band.color(tr), m = tr.p.length / 4, P = (i) => [tr.p[i * 4], tr.p[i * 4 + 1], tr.p[i * 4 + 2], tr.p[i * 4 + 3]], hg = tr.gauge / 2e3, s0 = Math.floor(tr.p[3] / 600) * 600;
      for (let i = 0; i < m; i++) {
        const p = P(i), a = i > 0 ? P(i - 1) : tr.pre || p, b = i < m - 1 ? P(i + 1) : tr.post || p, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
        for (let s = 0; s < 3; s++) {
          const tilt = s === 1 ? 0 : (s === 0 ? -1 : 1) * 0.42, q = [nx * tilt, 0.9, -ny * tilt], ql = Math.hypot(...q);
          for (const [u, dz] of [SEC[s], SEC[s + 1]]) {
            pos.push(p[0] + nx * u, p[2] + dz, -(p[1] + ny * u));
            nor.push(Math.round(q[0] / ql * 127), Math.round(q[1] / ql * 127), Math.round(q[2] / ql * 127), 0);
            rl.push(u, p[3] - s0, hg);
            if (rc) rc.push(...rcol);
          }
          if (i > 0) {
            const c = n2 + s * 2, d = c - 6;
            idx.push(d, d + 1, c + 1, d, c + 1, c);
          }
        }
        n2 += 6;
      }
    }
    if (n2) t.rail = addMesh(t.group, geom({ pos: new Float32Array(pos), nor: new Int8Array(nor), idx: n2 > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx) }, { aRail: new THREE.BufferAttribute(new Float32Array(rl), 3), ...rc ? { aRCol: new THREE.BufferAttribute(new Float32Array(rc), 3) } : {} }), railMat, { cast: false });
  });
  if (RHL) tm("tile.railhl", () => RHL.tileLines(t, rails, local));
  tm("tile.struct", () => {
    const segs = [];
    for (const tr of rails.tracks) {
      if (tr.kind !== 1) continue;
      for (let i = 4; i < tr.p.length; i += 4) {
        const a = [tr.p[i - 4], tr.p[i - 3], tr.p[i - 2]], b = [tr.p[i], tr.p[i + 1], tr.p[i + 2]];
        segs.push({ a, b, groundA: local(a[0], a[1]), groundB: local(b[0], b[1]), bridge: true });
      }
    }
    const portals = groupTunnelPortals(rails.portals.map((p) => ({ ...p })));
    for (const item of portals) {
      const ux = -Math.sin(item.angle), uy = Math.cos(item.angle);
      item.ground = PORTAL_GROUND_U.map((f) => {
        const u = f * (item.halfWidth + 4);
        return local(item.p[0] + ux * u, item.p[1] + uy * u);
      });
    }
    portals.slice(0, 4).forEach((item, i) => {
      const sm = (item.members?.[0] || item).samples, grade = sm?.length > 1 ? (sm[1][2] - sm[0][2]) / (Math.hypot(sm[1][0] - sm[0][0], sm[1][1] - sm[0][1]) || 1) : 0;
      t.mat.bore.a[i].set(item.p[0], item.p[1], Math.cos(item.angle), Math.sin(item.angle));
      t.mat.bore.b[i].set(item.p[2], item.halfWidth, grade, 1);
    });
    if (segs.length || rails.piers.length || portals.length) {
      const g = new THREE.Group();
      g.rotation.x = -Math.PI / 2;
      t.group.add(g);
      t.structures = createRailStructures(g, { track: false });
      t.structures.set(segs, rails.piers, 2, portals);
      g.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          o.renderOrder = 0;
          t.structMesh = o;
          if (P24.structCull) {
            o.geometry.computeBoundingSphere();
            o.frustumCulled = true;
          }
        }
      });
    }
  });
  if (rails.walls?.length) tm("tile.walls", () => {
    const pos = [], nor = [], idx = [];
    let n2 = 0;
    const CAP = 7.2;
    const quad = (a, b, c, d, q) => {
      for (const p of [a, b, c, d]) {
        pos.push(p[0], p[2], -p[1]);
        nor.push(Math.round(q[0] * 127), Math.round(q[2] * 127), Math.round(-q[1] * 127), 0);
      }
      idx.push(n2, n2 + 1, n2 + 2, n2, n2 + 2, n2 + 3);
      n2 += 4;
    };
    for (const [x0, y0, x1, y1, b0, b1, t02, t1, nx, ny] of rails.walls) {
      const T0 = t02 + 0.05, T1 = t1 + 0.05;
      quad([x0, y0, b0 - 0.1], [x1, y1, b1 - 0.1], [x1, y1, T1], [x0, y0, T0], [-nx, -ny, 0]);
      quad([x0, y0, T0], [x1, y1, T1], [x1 + nx * CAP, y1 + ny * CAP, T1], [x0 + nx * CAP, y0 + ny * CAP, T0], [0, 0, 1]);
    }
    t.walls = addMesh(t.group, geom({ pos: new Float32Array(pos), nor: new Int8Array(nor), idx: n2 > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx) }), wallMat);
  });
  if (rails.roadWalls?.length || rails.roadPortals?.length) tm("tile.ug", () => {
    const u = roadUnderpassGeometry(rails);
    t.ug = [u.wall.n && addMesh(t.group, geom(u.wall), wallMat), u.cap.n && addMesh(t.group, geom(u.cap), roadMat, { cast: false }), u.dark.n && addMesh(t.group, geom(u.dark), ugPortalMat ||= roadPortalMaterial(THREE), { cast: false })];
  });
  if (rails.levelCrossings?.length) tm("tile.lx", () => {
    const g = levelCrossingGeometry(rails.levelCrossings, local);
    if (g.n) t.lx = addMesh(t.group, geom(g), lxMat ||= levelCrossingMaterial(THREE));
  });
  t.stations = [];
  for (const s of P24.stn ? stations : []) {
    const lod = s.lods.far || s.lods.near, buf = await bin(url + lod.file, V(lod.file), n), g = tm("tile.station", () => stationGroup(buf, lod));
    t.group.add(g);
    t.stations.push({ id: s.id, name: s.name, far: g, near: s.lods.far && !P24.stnFar ? s.lods.near : null, at: s.at });
  }
  if (lampRoads) {
    const rd = await lampRoads;
    if (rd) tm("tile.lamps", () => {
      const p = lampPoints(lampPositions(rd.roads, local, { deckAt: lampDeck(local), mix: NC.lmix }), lampMat);
      if (p) {
        t.group.add(p);
        t.lamps = p.geometry.attributes.position.count;
        if (NC.lmix && t.nightR) {
          p.onBeforeRender = (r, s, c, g, m) => {
            const u = m.uniforms;
            u.tNightR.value = t.nightR.value;
            u.uNightRo.value.copy(t.nightRo.value);
            u.uNightK.value = t.nightK.value;
            m.uniformsNeedUpdate = true;
          };
        }
      }
    });
  }
  tm("tile.add", () => {
    t.group.traverse((o) => {
      if (o.isMesh && o.geometry) t.geomBytes += geomBytes(o.geometry);
    });
    place(t.group, e0, n0);
    fsTrack(t);
    scene.add(t.group);
    t.state = "ready";
    t.useLo = !!t.simpleLo && rectDist(view.e, view.n, e0, n0, TILE_M) > LIMIT.loR;
    setLod(t, 1);
    if (stageOn()) {
      hold(t.group);
      const alive = () => tiles.get(id) === t;
      for (const x of t.textures) stageTex(x, alive);
      stageQ.push({ alive, run: () => {
        t.terrain[1].layers.set(0);
        force(t.terrain[1]);
        hideUnderFar(t, true);
        shadowDirty = true;
        return true;
      } });
      t.group.traverse((o) => {
        if (o.isMesh && o !== t.terrain[1]) stageMesh(o, alive);
      });
      stageQ.push({ alive, run: () => {
        shadowDirty = true;
        return false;
      } });
    } else hideUnderFar(t, true);
    applyView();
  });
  total.bytes += t.bytes;
  total.tiles++;
  total.buildMs += performance.now() - t0;
  shadowDirty = true;
}
async function loadNear(t, rn = 0) {
  t.near = "loading";
  const url = DATA + t.id + "/", V = (name) => vspec(t.meta.files, name), [r, treeBuf] = await Promise.all([job("near", { url, chunk: LIMIT.chunk, skip: SKIP, lines: P28.rdLines, farStep: P28.rdFar > 0 ? P28.rdStep : 0, deck: P28.rdDeck, pier: P28.rdPier, side: P28.rdSide, rdMode: P28.rdMode, ...FX3.worker ? { fx3: FX3.worker } : {}, inner: P28.fSide && !P28.fBasic && P28.fInner ? 1 : 0, vf: t.vf, rn }), bin(url + "trees.bin", V("trees.bin"), rn)]);
  if (!tiles.has(t.id) || t.near !== "loading") return;
  const g = new THREE.Group();
  let bytes = 0;
  tm("near.facade", () => {
    for (const c of r.buildings.chunks) {
      const m = addMesh(g, facadeGeometry(c), facadeFar ? facadeFarMat : facadeMat, { receive: !!P28.fShd });
      facadeMeshes.add(m);
      if (AO2) m.layers.enable(AO2.LAYER);
      bytes += geomBytes(m.geometry);
    }
    if (r.roads.n && P28.rd) {
      const m = addMesh(g, geom(r.roads), roadMat, { cast: false });
      bytes += geomBytes(m.geometry);
      m.userData.nMain = r.roads.nMain;
      m.userData.nFar = r.roads.nFar;
      roadMeshes.add(m);
      roadRange(m);
    }
    if (r.flat?.n && P28.rd) {
      const m = addMesh(g, geom(r.flat), roadFlatMat, { cast: false });
      m.renderOrder = 1;
      bytes += geomBytes(m.geometry);
      m.userData.nMain = r.flat.nMain;
      m.userData.nFar = 0;
      roadMeshes.add(m);
      roadRange(m);
    }
  });
  const T = new DataView(treeBuf), n = Math.floor(treeBuf.byteLength / 10 * LIMIT.trees);
  let treeMesh = null;
  if (n) tm("near.trees", () => {
    const mesh = treeMesh = new THREE.InstancedMesh(treeLo, treeMat, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), lin = (v) => Math.pow(v / 255, 2.2), tone = (v) => v * 3.1 / (1 + v * 2.3);
    const lp = FX3.land && t.tLand !== blackTex ? landPixels(t.tLand) : null;
    let kept = 0;
    for (let i0 = 0; i0 < n; i0++) {
      const o = i0 * 10, x = T.getUint16(o, true) / 50, y = T.getUint16(o + 2, true) / 50, rad = T.getUint8(o + 4) * 0.02, hh = T.getUint8(o + 5) * 0.05, s = T.getUint8(o + 6) / 256, k = 0.62 + 0.34 * (s * 7.3 % 1);
      if (lp && LAND_NO_TREE.has(lp[(Math.min(511, Math.max(0, Math.floor((TILE_M - y) / 2.5))) * 512 + Math.min(511, Math.max(0, Math.floor(x / 2.5)))) * 4] & 63)) continue;
      if (aeroNoTree(t.aero, x, y)) continue;
      const i = kept++;
      q.setFromAxisAngle(up, s * 6.283);
      m4.compose(new THREE.Vector3(x, gridAt(t.h, FINE_N, FINE_STEP, x, y) - 0.2, -y), q, new THREE.Vector3(rad, hh * 0.55, rad));
      mesh.setMatrixAt(i, m4);
      col.setRGB((tone(lin(T.getUint8(o + 7))) * 0.6 + 0.016) * k, (tone(lin(T.getUint8(o + 8))) * 0.6 + 0.034) * k, (tone(lin(T.getUint8(o + 9))) * 0.6 + 0.01) * k);
      mesh.setColorAt(i, col);
    }
    mesh.count = kept;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    g.add(mesh);
    bytes += n * (64 + 12);
  });
  try {
    for (const st of t.stations) {
      if (!st.near) continue;
      const sb = await bin(url + st.near.file, V(st.near.file), rn), sg = tm("near.station", () => stationGroup(sb, st.near));
      g.add(sg);
      st.nearG = sg;
      bytes += sg.userData.bytes;
    }
  } catch (e) {
    g.traverse((o) => {
      roadMeshes.delete(o);
      facadeMeshes.delete(o);
      if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    for (const st of t.stations) st.nearG = null;
    throw e;
  }
  if (!tiles.has(t.id) || t.near !== "loading") {
    g.traverse((o) => {
      if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
    });
    return;
  }
  t.group.add(g);
  t.near = { group: g, bytes, trees: n, treeMesh, staged: !stageOn(), fine: false, buildings: { count: t.meta.counts.buildings, verts: r.buildings.verts, tris: r.buildings.rawVerts / 3, bytes: r.buildings.bytes, rawBytes: r.buildings.rawBytes, ms: Math.round(r.buildings.ms) } };
  t.geomBytes += bytes;
  if (stageOn()) {
    hold(g);
    const alive = () => tiles.get(t.id) === t && t.near?.group === g;
    stageQ.push({ alive, run: () => {
      if (t.wantLod !== 0) return false;
      t.near.fine = true;
      setLod(t, 1);
      force(t.terrain[0]);
      return true;
    } });
    g.traverse((o) => {
      if (o.isMesh) stageMesh(o, alive);
    });
    stageQ.push({ alive, run: () => {
      t.near.staged = true;
      setLod(t, t.wantLod ?? 0);
      return false;
    } });
    setLod(t, 1);
  } else setLod(t, t.wantLod ?? 0);
  shadowDirty = true;
}
const extras = { e: 1e12, n: 1e12, key: "", busy: false, meshes: [], bytes: 0 };
async function updateExtras() {
  if (extras.busy || !(LIMIT.extraR > 0)) return;
  const near = [...tiles.values()].filter((t) => t.state === "ready" && t.lod === 0 && t.near?.group), key = near.map((t) => t.id).join() + "@" + LIMIT.extraR;
  if (!near.length || Math.hypot(view.e - extras.e, view.n - extras.n) < LIMIT.extraR / 4 && key === extras.key) return;
  extras.busy = true;
  const e = view.e, n = view.n;
  try {
    const made = [];
    await Promise.all(near.filter((t) => rectDist(e, n, t.e0, t.n0, TILE_M) <= LIMIT.extraR).map(async (t) => {
      const r = await job("extras", { url: DATA + t.id + "/", cx: e - t.e0, cy: n - t.n0, r: LIMIT.extraR, chunk: LIMIT.chunk, skip: SKIP, vf: t.vf });
      for (const c of r.chunks) made.push({ t, c });
    }));
    const old = extras.meshes, drop = () => {
      for (const m of old) {
        m.parent?.remove(m);
        m.geometry.dispose();
      }
    };
    if (!stageOn()) drop();
    extras.meshes = tm("extras", () => made.filter((m) => tiles.get(m.t.id) === m.t && m.t.near?.group).map(({ t, c }) => addMesh(t.near.group, facadeGeometry(c), P28.fBasic ? facadeMat : facade.material)));
    if (stageOn()) {
      for (const m of extras.meshes) {
        m.layers.set(HIDDEN);
        stageMesh(m, () => !!m.parent);
      }
      stageQ.push({ run: () => {
        drop();
        shadowDirty = true;
        return false;
      } });
    }
    Object.assign(extras, { e, n, key, bytes: extras.meshes.reduce((s, m) => s + geomBytes(m.geometry), 0) });
    shadowDirty = true;
  } catch (err) {
    status("建物細節失敗：" + err.message);
  } finally {
    extras.busy = false;
  }
}
const stnFarMode = () => view.dist >= P24.stnNearD;
function setLod(t, lod) {
  if (lod === 0 && !(t.near?.group && t.near.staged)) lod = 1;
  const staging = !!t.near?.group && !t.near.staged, fine = lod === 0 || staging && t.near.fine;
  t.lod = lod;
  t.terrain[0].visible = fine;
  t.terrain[1].visible = !fine;
  if (t.simple) t.simple.visible = lod === 1 && !t.useLo;
  if (t.simpleLo) t.simpleLo.visible = lod === 1 && !!t.useLo;
  if (t.near?.group) t.near.group.visible = lod === 0 || staging;
  t.stnFarMode = lod === 0 && stnFarMode();
  for (const st of t.stations) if (st.near) {
    st.far.visible = lod === 1 || t.stnFarMode;
    if (st.nearG) st.nearG.visible = !t.stnFarMode;
  }
  shadowDirty = true;
}
function dropNear(t) {
  if (!t.near || t.near === "loading") {
    t.near = null;
    return;
  }
  t.group.remove(t.near.group);
  t.near.group.traverse((o) => {
    roadMeshes.delete(o);
    facadeMeshes.delete(o);
    if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
  t.geomBytes -= t.near.bytes;
  t.near = null;
  setLod(t, 1);
}
function unloadTile(t) {
  tiles.delete(t.id);
  if (t.state !== "ready") return;
  hideUnderFar(t, false);
  scene.remove(t.group);
  t.group.traverse((o) => {
    if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
  t.structures?.destroy();
  t.mat.dispose();
  for (const x of t.textures) x.dispose();
  total.tiles--;
  shadowDirty = true;
}
function failTile(t) {
  if (t.state === "ready") {
    unloadTile(t);
    return;
  }
  if (tiles.get(t.id) === t) tiles.delete(t.id);
  t.group.traverse((o) => {
    if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
  });
  t.structures?.destroy();
}
function hideUnderFar(t, on) {
  const f = fars.get(farId(Math.floor(t.ti / 4), Math.floor(t.tj / 4)));
  if (f?.mat) f.hide[(t.ti & 3) + (t.tj & 3) * 4] = on ? 1 : 0;
  if (t.nightR) {
    t.nOn = on;
    nightBindTile(t);
  }
  if (FS.on && !!t.fsUnder !== on) {
    t.fsUnder = on;
    fsHides();
  }
}
async function loadFar(id, fi, fj, lv = 1, rn = 0) {
  const L = lv > 1 ? FSL[lv] : null, M = L ? L.blockM : FAR_M, url = DATA + (L ? L.dir + "/" + id.slice(3) : "far/" + id) + "/", e0 = fi * M, n0 = fj * M, f = { id, fi, fj, e0, n0, lv, M, state: "loading", hide: new Array(16).fill(0) };
  fars.set(id, f);
  const fjs = await json(url + "far.json"), V = (name) => vspec(fjs.files, name);
  const [r, tSat, tMask] = await Promise.all([job("far", { ...L ? { url, n: 129, step: L.stepM, tol: 2.5 * L.stepM / 40, skirt: 120 * L.stepM / 40, cells: 1 } : { url, n: 129, step: 40 }, vf: { "terrain.bin": V("terrain.bin") }, rn }), tex(url + "sat.jpg", true, true, V("sat.jpg"), rn), tex(url + "mask.png", false, false, V("mask.png"), rn)]);
  if (!fars.has(id) || FS.on && fars.get(id) !== f) return;
  f.nU = NC.far ? { tNightR: { value: blackTex }, uNightRo: { value: new THREE.Vector3(0, 0, M) }, uNightK: { value: 0 } } : null;
  f.h = r.h;
  if (f.nU) {
    let a = Infinity, b = -Infinity;
    for (const v of r.h) {
      if (v < a) a = v;
      if (v > b) b = v;
    }
    f.hy = [a, b];
  }
  f.mat = groundMaterial({ tSat: { value: tSat }, tMask: { value: tMask }, tHarbor: { value: blackTex }, tFarm: { value: blackTex }, ...f.nU || {}, ...FX3.land ? { tLand: { value: blackTex }, uLandOn: { value: 0 }, uLandV: { value: landV } } : {}, uSat: { value: L ? new THREE.Vector2(L.satGutterPx * L.satMpp, M + 2 * L.satGutterPx * L.satMpp) : new THREE.Vector2(40, FAR_M + 80) }, uSize: { value: M }, uNoise: { value: noiseOrg(e0, n0) }, uHide: { value: f.hide } });
  f.mesh = tm("far", () => new THREE.Mesh(geom(r.mesh), f.mat));
  f.mesh.receiveShadow = true;
  f.tris = r.mesh.idx.length / 3;
  f.textures = [tSat, tMask];
  f.bytes = L ? L.blocks[id.slice(3)].bytes : index.far[id].bytes;
  total.bytes += f.bytes;
  if (FS.on) {
    f.geomBytes = geomBytes(f.mesh.geometry);
    f.texBytes = f.textures.reduce((s, x) => s + texKB(x) * 1024, 0) | 0;
  }
  place(f.mesh, e0, n0);
  scene.add(f.mesh);
  f.state = "ready";
  nightBindFar(f);
  nsDirty = true;
  if (stageOn()) {
    f.mesh.layers.set(HIDDEN);
    const alive = () => fars.get(id) === f;
    for (const x of f.textures) stageTex(x, alive);
    if (FS.on) stageQ.push({ alive, run: () => {
      const m = f.mesh;
      m.layers.set(0);
      fsHides();
      if (!drawn(m)) return false;
      force(m);
      m.userData.up = true;
      return Math.max(1, geomBytes(m.geometry) / 1024);
    } });
    else stageMesh(f.mesh, alive);
  }
  for (const t of tiles.values()) if (t.state === "ready") hideUnderFar(t, true);
  if (FS.on) fsHides();
}
const NSEL = { px: 1, back: 1.25, inA: 0.15, outA: 0.3, max: coarse ? 20 : 48, lru: coarse ? 6 : 12, move: 0.02, turn: 0.01 };
for (const k of ["px", "max", "inA", "outA"]) if (params.has("ns" + k)) NSEL[k] = +params.get("ns" + k);
const nmaps = /* @__PURE__ */ new Map(), nlru = /* @__PURE__ */ new Map(), nsBox = new THREE.Box3(), nsCam = new THREE.PerspectiveCamera(), nsFr = [new THREE.Frustum(), new THREE.Frustum()], nsMat = new THREE.Matrix4(), nsLast = { p: new THREE.Vector3(Infinity, 0, 0), d: new THREE.Vector3(), h: 0 }, nsDir = new THREE.Vector3();
let nsDirty = true;
const nKey = (lv, i, j) => lv + ":" + farId(i, j);
function nightSelect() {
  if (!NFT || !(shared.uNightFar.value > 0)) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(nsDir);
  const H2 = renderer.domElement.height;
  const now = performance.now(), due = (m) => m.state === "fail" && now >= m.at;
  if (!nsDirty && ![...nmaps.values()].some(due) && camera.position.distanceTo(nsLast.p) <= NSEL.move * Math.max(100, view.dist) && nsDir.angleTo(nsLast.d) <= NSEL.turn && H2 === nsLast.h) return;
  nsDirty = false;
  nsLast.p.copy(camera.position);
  nsLast.d.copy(nsDir);
  nsLast.h = H2;
  const hv = camera.fov * Math.PI / 360, hh = Math.atan(Math.tan(hv) * camera.aspect), th = 2 * hv / H2, reach = fsReach();
  for (let k = 0; k < 2; k++) {
    const a = k ? NSEL.outA : NSEL.inA, tv = Math.tan(Math.min(1.5, hv + a)), tw = Math.tan(Math.min(1.5, hh + a));
    nsCam.fov = 360 / Math.PI * Math.atan(tv);
    nsCam.aspect = tw / tv;
    nsCam.near = 1;
    nsCam.far = 1e8;
    nsCam.updateProjectionMatrix();
    nsFr[k].setFromProjectionMatrix(nsMat.multiplyMatrices(nsCam.projectionMatrix, camera.matrixWorldInverse));
  }
  const req = /* @__PURE__ */ new Map(), ask = (lv, i, j, px) => {
    if (!NFT[lv]?.blocks?.[farId(i, j)]) return;
    const key = nKey(lv, i, j), r = req.get(key);
    if (!r) req.set(key, { key, lv, i, j, px });
    else if (px > r.px) r.px = px;
  };
  for (const f of fars.values()) {
    if (f.state !== "ready" || !f.hy || f.lv > 2) continue;
    const was = !!f.nsel;
    nsBox.min.set(f.e0 - origin.e, f.hy[0] - 50, -(f.n0 + f.M - origin.n));
    nsBox.max.set(f.e0 + f.M - origin.e, f.hy[1] + 10, -(f.n0 - origin.n));
    const d = Math.max(1, nsBox.distanceToPoint(camera.position)), px = (lv) => NFT[lv] ? NFT[lv].mpp / (d * th) : 0;
    f.nsel = d <= reach * (was ? 1.1 : 1) && nsFr[was ? 1 : 0].intersectsBox(nsBox);
    if (!f.nsel) continue;
    if (f.lv > 1) {
      if (f.mesh.visible) ask(2, f.fi, f.fj, px(2));
      continue;
    }
    ask(2, Math.floor(f.fi / 4), Math.floor(f.fj / 4), px(2));
    if (px(2) >= NSEL.px / (nmaps.has(nKey(1, f.fi, f.fj)) ? NSEL.back : 1)) ask(1, f.fi, f.fj, px(1));
  }
  const list = [...req.values()].sort((a, b) => b.px - a.px).slice(0, NSEL.max), want = new Set(list.map((r) => r.key));
  for (const [key, m] of nmaps) if (!want.has(key)) {
    nmaps.delete(key);
    if (m.tex) {
      m.tex.dispose();
      nlruPut(key, m.tex);
    }
  }
  for (const r of list) {
    const m = nmaps.get(r.key);
    if (!m || due(m)) nightFetch(r, m?.n || 0);
  }
  nightRebind();
}
function nlruPut(key, x) {
  nlru.delete(key);
  nlru.set(key, x);
  while (nlru.size > NSEL.lru) nlru.delete(nlru.keys().next().value);
}
function nightFetch(r, k = 0) {
  const m = { key: r.key, lv: r.lv, state: "loading", tex: null, n: k };
  nmaps.set(r.key, m);
  const ok = (x, sync) => {
    if (nmaps.get(r.key) !== m) {
      nlruPut(r.key, x);
      return;
    }
    x.format = THREE.RGFormat;
    x.needsUpdate = true;
    m.tex = x;
    m.state = "ready";
    if (!sync) nightRebind();
  };
  const c = nlru.get(r.key);
  if (c) {
    nlru.delete(r.key);
    ok(c, true);
    return;
  }
  const id = farId(r.i, r.j);
  tex(DATA + NFT[r.lv].dir + "/" + id + ".png", false, false, { v: VER, bytes: NFT[r.lv].blocks[id] }, k).then((x) => ok(x, false)).catch((err) => {
    if (nmaps.get(r.key) !== m) return;
    const s = Math.min(60, 2 ** k);
    m.state = "fail";
    m.n = k + 1;
    m.at = performance.now() + s * 1e3;
    console.warn(`[地景] 夜燈圖 ${r.key} 載入失敗（第 ${m.n} 次，${s} 秒後重試）：${err?.message || err}`);
  });
}
function nightBindFar(f) {
  if (!f.nU || f.state !== "ready") return;
  const own = f.lv > 2 ? null : nmaps.get(nKey(f.lv > 1 ? 2 : 1, f.fi, f.fj)), up = f.lv > 1 ? null : nmaps.get(nKey(2, Math.floor(f.fi / 4), Math.floor(f.fj / 4))), m = own?.tex ? own : up?.tex ? up : null;
  f.nm = m;
  f.nU.tNightR.value = m ? m.tex : blackTex;
  f.nU.uNightK.value = m ? 1 : 0;
  if (m && m.lv > f.lv) f.nU.uNightRo.value.set((f.fi & 3) * f.M, (f.fj & 3) * f.M, NFT[2].blockM);
  else f.nU.uNightRo.value.set(0, 0, f.M);
}
function nightBindTile(t) {
  if (!t.nightR) return;
  const f = t.nOn ? fars.get(farId(Math.floor(t.ti / 4), Math.floor(t.tj / 4))) : null, ok = f?.state === "ready", m = ok ? f.nm : null, q = m?.lv > 1 ? 15 : 3;
  t.nightR.value = m ? m.tex : ok ? f.textures[1] : blackTex;
  t.nightK.value = m ? 1 : 0;
  t.nightRo.value.set((t.ti & q) * TILE_M, (t.tj & q) * TILE_M, m?.lv > 1 ? NFT[2].blockM : FAR_M);
}
function nightRebind() {
  for (const f of fars.values()) nightBindFar(f);
  for (const t of tiles.values()) nightBindTile(t);
}
function nightSync() {
  nsDirty = true;
  nightSelect();
}
const nightPending = () => NFT && shared.uNightFar.value > 0 ? (nsDirty ? 1 : 0) + [...nmaps.values()].filter((m) => m.state === "loading").length : 0;
function nightInfo() {
  const o = { L1: 0, L2: 0, MB: 0, loading: 0, fail: 0, lru: nlru.size, ids: [] };
  for (const m of nmaps.values()) {
    if (m.state === "loading") o.loading++;
    else if (!m.tex) o.fail++;
    else {
      o["L" + m.lv]++;
      o.MB += m.tex.image.width * m.tex.image.height * 2 / 1048576;
      o.ids.push((m.lv > 1 ? "L2:" : "") + m.key.slice(2));
    }
  }
  o.MB = +o.MB.toFixed(1);
  return o;
}
let fsSeaMesh = null;
function fsSea() {
  if (fsSeaMesh) return fsSeaMesh;
  const px = (r, g, b, srgb) => {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const uNoise = { value: new THREE.Vector2() }, mat = groundMaterial({ tSat: { value: px(23, 43, 51, true) }, tMask: { value: px(0, 0, 255) }, tHarbor: { value: blackTex }, tFarm: { value: blackTex }, ...NC.far ? { tNightR: { value: blackTex }, uNightRo: { value: new THREE.Vector3(0, 0, 1) }, uNightK: { value: 0 } } : {}, ...FX3.land ? { tLand: { value: blackTex }, uLandOn: { value: 0 }, uLandV: { value: landV } } : {}, uSat: { value: new THREE.Vector2(0, 1) }, uSize: { value: 1 }, uNoise, uHide: { value: new Array(16).fill(0) } });
  mat.depthWrite = false;
  mat.userData.uNoise = uNoise;
  fsSeaMesh = new THREE.Mesh(new THREE.CircleGeometry(1e6, 96).rotateX(-Math.PI / 2), mat);
  fsSeaMesh.renderOrder = -5;
  fsSeaMesh.frustumCulled = false;
  fsSeaMesh.visible = false;
  scene.add(fsSeaMesh);
  return fsSeaMesh;
}
function unloadFar(f) {
  fars.delete(f.id);
  if (f.state !== "ready") return;
  if (!(f.lv > 1)) {
    for (const t of tiles.values()) if (t.nightR && Math.floor(t.ti / 4) === f.fi && Math.floor(t.tj / 4) === f.fj) nightBindTile(t);
  }
  scene.remove(f.mesh);
  f.mesh.geometry.dispose();
  f.mat.dispose();
  for (const x of f.textures) x.dispose();
  nsDirty = true;
  if (FS.on) fsHides();
}
function farGo(id, i, j, lv = 1) {
  if (fars.has(id) || BO.wait(id)) return;
  loadFar(id, i, j, lv, BO.go(id)).then(() => BO.ok(id), (err) => {
    status("遠景塊 " + id + " 失敗：" + err.message);
    fars.delete(id);
    BO.fail(id, err);
  });
}
const fsFar = () => FS.on && !ride.on && view.dist > FS.f0;
const fsReach = () => 1.98 / scene.fog.density;
const fsKey = (k, i, j) => k === 1 ? farId(i, j) : `L${k}:` + farId(i, j);
function fsHides() {
  const under = /* @__PURE__ */ new Set();
  for (const t of tiles.values()) if (t.fsUnder) under.add(farId(Math.floor(t.ti / 4), Math.floor(t.tj / 4)));
  for (const f of fars.values()) {
    if (f.state !== "ready" || !(f.lv > 1)) continue;
    let all = 1;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const c = fars.get(fsKey(f.lv - 1, f.fi * 4 + a, f.fj * 4 + b)), on = c && c.state === "ready" && c.mesh.layers.isEnabled(0) || f.lv === 2 && under.has(farId(f.fi * 4 + a, f.fj * 4 + b)) ? 1 : 0;
      f.hide[a + b * 4] = on;
      all &= on;
    }
    f.mesh.visible = !all;
  }
}
function fsSchedule() {
  const ce = camera.position.x + origin.e, cn = origin.n - camera.position.z, cy = camera.position.y, reach = fsReach(), R = [0, FS.r1, FS.r2, Infinity];
  const want = /* @__PURE__ */ new Map(), keep = /* @__PURE__ */ new Set();
  const visit = (k, i, j, s, out) => {
    const id = fsKey(k, i, j), has = k === 1 ? index.far?.[farId(i, j)] : FSL[k]?.blocks?.[farId(i, j)];
    if (!has) return;
    const M = k === 1 ? FAR_M : FSL[k].blockM, d = Math.hypot(rectDist(ce, cn, i * M, j * M, M), cy);
    if (d > reach * s) return;
    if (out === keep) keep.add(id);
    else want.set(id, [i, j, k]);
    if (k > 1 && d < R[k - 1] * s) for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) visit(k - 1, i * 4 + a, j * 4 + b, s, out);
  };
  for (const id of Object.keys(FSL[FSTOP].blocks)) {
    const [i, j] = id.slice(1).split("_").map(Number);
    visit(FSTOP, i, j, 1, want);
    visit(FSTOP, i, j, 1.2, keep);
  }
  for (const [id, [i, j, k]] of want) farGo(id, i, j, k);
  for (const f of [...fars.values()]) if (!keep.has(f.id) && !want.has(f.id) && f.state === "ready") unloadFar(f);
  fsHides();
}
function fsNear(keep1) {
  const L = FSL[2];
  if (!L) return;
  const ce = camera.position.x + origin.e, cn = origin.n - camera.position.z, cy = camera.position.y, reach = 1.98 / FS.fog, M = L.blockM, C = M / 4, want = /* @__PURE__ */ new Map(), keep = /* @__PURE__ */ new Set();
  const R = reach * 1.2, i0 = Math.floor((ce - R) / M), i1 = Math.floor((ce + R) / M), j0 = Math.floor((cn - R) / M), j1 = Math.floor((cn + R) / M);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const id = farId(i, j);
    if (!L.blocks[id]) continue;
    let w = false, k = false;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const c = farId(i * 4 + a, j * 4 + b), d = Math.hypot(rectDist(ce, cn, (i * 4 + a) * C, (j * 4 + b) * C, C), cy), f = fars.get(c);
      if (d <= reach && !keep1.has(c)) w = true;
      if (d <= R && !(f?.state === "ready" && f.mesh.layers.isEnabled(0))) k = true;
    }
    if (w) want.set("L2:" + id, [i, j]);
    if (w || k) keep.add("L2:" + id);
  }
  for (const [id, [i, j]] of want) farGo(id, i, j, 2);
  const zone = !ride.on && view.dist >= FS.f0 * 0.8;
  for (const f of [...fars.values()]) if (f.lv > 1 && f.state === "ready" && !keep.has(f.id) && (!zone || Math.hypot(rectDist(ce, cn, f.e0, f.n0, f.M), cy) > R)) unloadFar(f);
  fsHides();
}
const fsMats = /* @__PURE__ */ new Map(), fsHideMeshes = /* @__PURE__ */ new Set();
let fsK = 0, fsKShown = 0;
function fsTrack(t) {
  if (!FS.on) return;
  t.group.traverse((o) => {
    if (!o.material || o.material === t.mat) return;
    for (const m of [].concat(o.material)) {
      if (fsMats.has(m)) continue;
      if (m.isShaderMaterial || !("opacity" in m)) {
        fsHideMeshes.add(o);
        continue;
      }
      const base = m.opacity;
      if (!m.transparent && base === 1 && !m.alphaHash) {
        m.alphaHash = true;
        m.needsUpdate = true;
      }
      fsMats.set(m, base);
    }
  });
}
function fsFade() {
  if (!FS.on) return;
  fsK = ride.on ? 0 : smooth(FS.f0, FS.f1, view.dist);
  if (fsK === fsKShown) return;
  fsKShown = fsK;
  for (const [m, base] of fsMats) m.opacity = base * (1 - fsK);
  for (const o of fsHideMeshes) if (o.parent) o.visible = fsK < 0.5;
  else fsHideMeshes.delete(o);
  sun.shadow.intensity = 1 - fsK;
  shadowDirty = true;
}
function fsInfo() {
  const lv = {};
  let geo = 0, texB = 0, files = 0, bytes = 0, tris = 0;
  for (const f of fars.values()) {
    if (f.state !== "ready") continue;
    const k = "L" + (f.lv || 1);
    lv[k] = (lv[k] || 0) + 1;
    geo += f.geomBytes || geomBytes(f.mesh.geometry);
    texB += f.texBytes || f.textures.reduce((s, x) => s + texKB(x) * 1024, 0);
    files += 3;
    bytes += f.bytes;
    tris += f.tris;
  }
  const list = [...tiles.values()].filter((t) => t.state === "ready");
  return { fsK, far: lv, farTris: tris, farGeomMB: +(geo / 1048576).toFixed(1), farTexMB: +(texB / 1048576).toFixed(1), tiles: list.length, tileGeomMB: +(list.reduce((s, t) => s + t.geomBytes, 0) / 1048576).toFixed(1), tileTexMB: +(list.reduce((s, t) => s + t.texBytes, 0) / 1048576).toFixed(1), loadedMB: +(total.bytes / 1048576).toFixed(2), net: { ...net }, dist: view.dist };
}
let loading = 0, movingUntil = 0, wantMissing = 0;
const lastView = { e: 0, n: 0, dist: 0, az: 0, pitch: 0 };
const rectDist = (e, n, e0, n0, size) => Math.hypot(Math.max(e0 - e, 0, e - e0 - size), Math.max(n0 - n, 0, n - n0 - size));
function schedule() {
  const fsAll = FS.on && !ride.on && view.dist >= FS.f1;
  const { e, n } = view, zoomedOut = view.dist > 2600, nearR = zoomedOut || view.dist > P24.ovNear ? -1 : Math.min(LIMIT.near, 500 + view.dist * 1.2), midR = fsAll ? -1 : Math.min(LIMIT.mid * (zoomedOut ? 1.6 : 1), 1500 + view.dist * 2.2), want = [];
  const ci = Math.floor(e / TILE_M), cj = Math.floor(n / TILE_M), R = Math.ceil(midR / TILE_M) + 1;
  for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
    const id = tileId(i, j);
    if (!index.tiles[id]) continue;
    const d = rectDist(e, n, i * TILE_M, j * TILE_M, TILE_M);
    if (d <= midR) want.push({ id, i, j, d });
  }
  const now = performance.now();
  if (Math.abs(view.e - lastView.e) + Math.abs(view.n - lastView.n) > 0.5 || Math.abs(view.dist - lastView.dist) > 0.5 || Math.abs(view.az - lastView.az) + Math.abs(view.pitch - lastView.pitch) > 2e-3) movingUntil = now + 500;
  for (const k in lastView) lastView[k] = view[k];
  const maxMid = stageOn() && now < movingUntil ? Math.min(LIMIT.maxMid, LIMIT.maxMidMove) : LIMIT.maxMid, maxLoads = now < movingUntil ? LIMIT.loads : Math.max(LIMIT.loads, LIMIT.stillLoads);
  want.sort((a, b) => a.d - b.d);
  const keep = /* @__PURE__ */ new Set();
  let nNear = 0, nMid = 0, missing = 0;
  for (const w of want) {
    const near = w.d <= nearR && nNear < LIMIT.maxNear;
    if (!near && nMid >= maxMid) continue;
    near ? nNear++ : nMid++;
    keep.add(w.id);
    const t = tiles.get(w.id);
    if (!t) {
      if (BO.wait(w.id)) continue;
      missing++;
      if (loading < maxLoads) {
        loading++;
        loadTile(w.id, w.i, w.j, BO.go(w.id)).then(() => BO.ok(w.id), (err) => {
          status("圖磚 " + w.id + " 失敗：" + err.message);
          const f = tiles.get(w.id);
          if (f) failTile(f);
          BO.fail(w.id, err);
        }).finally(() => loading--);
      }
      continue;
    }
    if (t.state !== "ready") continue;
    t.wantLod = near ? 0 : 1;
    if (t.simpleLo) {
      const lo = !near && w.d > LIMIT.loR;
      if (lo !== !!t.useLo && !t.loQ) {
        const m = lo ? t.simpleLo : t.simple, swap = () => {
          t.loQ = false;
          t.useLo = lo;
          if (t.lod === 1) setLod(t, 1);
        };
        if (stageOn() && !m.userData.up) {
          t.loQ = true;
          stageQ.push({ alive: () => tiles.get(t.id) === t, run: () => {
            swap();
            if (!drawn(m)) return false;
            force(m);
            m.userData.up = true;
            return Math.max(1, geomBytes(m.geometry) / 1024);
          } });
        } else swap();
      }
    }
    if (near && !t.near && !BO.wait("n:" + w.id) && loading < maxLoads) {
      loading++;
      loadNear(t, BO.go("n:" + w.id)).then(() => BO.ok("n:" + w.id), (err) => {
        status("圖磚 " + w.id + " 近景失敗：" + err.message);
        if (t.near === "loading") t.near = null;
        BO.fail("n:" + w.id, err);
      }).finally(() => loading--);
    }
    if (t.lod !== t.wantLod || t.lod === 0 && t.stnFarMode !== stnFarMode()) setLod(t, t.wantLod);
    if (t.near?.treeMesh) {
      const m = t.near.treeMesh, here = w.d === 0;
      m.geometry = here ? treeHi : treeLo;
      m.count = here ? t.near.trees : Math.ceil(t.near.trees * 0.5);
    }
    if (!near && t.near && t.near !== "loading" && w.d > nearR * 1.5 + 300) dropNear(t);
  }
  for (const t of [...tiles.values()]) if (!keep.has(t.id) && t.state === "ready" && (fsAll || rectDist(e, n, t.e0, t.n0, TILE_M) > midR * 1.25 + 400)) unloadTile(t);
  if (fsFar()) fsSchedule();
  else {
    const fi = Math.floor(e / FAR_M), fj = Math.floor(n / FAR_M), FR = Math.ceil(LIMIT.far / FAR_M), keepFar = /* @__PURE__ */ new Set();
    for (let j = fj - FR; j <= fj + FR; j++) for (let i = fi - FR; i <= fi + FR; i++) {
      const id = farId(i, j);
      if (!index.far?.[id] || rectDist(e, n, i * FAR_M, j * FAR_M, FAR_M) > LIMIT.far) continue;
      keepFar.add(id);
      farGo(id, i, j);
    }
    for (const f of [...fars.values()]) if (!keepFar.has(f.id) && f.state === "ready" && !(f.lv > 1) && rectDist(e, n, f.e0, f.n0, FAR_M) > LIMIT.far * 1.3) unloadFar(f);
    if (FS.on) fsNear(keepFar);
  }
  wantMissing = missing;
  nightSelect();
  BO.sweep();
  updateExtras();
  if (Math.hypot(e - origin.e, n - origin.n) > 12e3) {
    origin.e = Math.floor(e / TILE_M) * TILE_M;
    origin.n = Math.floor(n / TILE_M) * TILE_M;
    for (const t of tiles.values()) if (t.state === "ready") place(t.group, t.e0, t.n0);
    for (const f of fars.values()) if (f.state === "ready") place(f.mesh, f.e0, f.n0);
    shadowDirty = true;
    applyView();
  }
}
const pending = () => (RHL ? RHL.pending() : 0) + wantMissing + loading + stageQ.length + waiting.size + (extras.busy ? 1 : 0) + [...tiles.values()].filter((t) => t.state !== "ready" || t.near === "loading" || t.wantLod === 0 && !t.near && !BO.has("n:" + t.id)).length + [...fars.values()].filter((f) => f.state !== "ready").length + nightPending();
const VIEWS = {
  haikeguan: { e: 330661, n: 2781251, dist: 300, az: 2.55, pitch: 0.42, label: "海科館站" },
  badouzi: { e: 330953, n: 2781002, dist: 330, az: -2.2, pitch: 0.34, label: "八斗子站" },
  port: { e: 330140, n: 2781720, dist: 520, az: -0.35, pitch: 0.46, label: "漁港市街" },
  wide: { e: 330550, n: 2781450, dist: 4200, az: 3.5, pitch: 0.55, label: "八斗子全景" },
  daan: { e: 304857, n: 2769543, dist: 380, az: 0.5, pitch: 0.45, label: "大安站（文湖線高架）" },
  taipei: { e: 305280, n: 2769280, dist: 1500, az: -0.4, pitch: 0.7, label: "台北大安區" },
  street: { e: 305100, n: 2769250, dist: 130, az: 0.9, pitch: 0.26, label: "台北街道近看" }
};
function applyView() {
  if (NC.far) shared.uNightKk.value = ride.on ? FAR_NIGHT.kn : farNightK(view.dist);
  if (ride.on) return rideCamera();
  view.pitch = Math.max(0.08, Math.min(1.5, view.pitch));
  view.dist = Math.max(25, Math.min(FS.on ? FS.max : 16e3, view.dist));
  const ty = groundAt(view.e, view.n), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), dx = Math.sin(view.az), dn = Math.cos(view.az), ce = view.e - dx * view.dist * cp, cn = view.n - dn * view.dist * cp;
  camera.position.set(ce - origin.e, ty + view.dist * sp, -(cn - origin.n));
  const gy = groundAt(ce, cn) + 4;
  if (camera.position.y < gy) camera.position.y = gy;
  camera.lookAt(view.e - origin.e, ty + 2, -(view.n - origin.n));
  if (FS.on) scene.fog.density = view.dist > FS.f1 ? FS.fog * FS.f1 / view.dist : FS.fog;
  const fsF = fsFar();
  camera.near = Math.max(1.5, Math.min(fsF ? 1e9 : 120, (camera.position.y - gy + 4) * 0.08));
  camera.far = fsF ? Math.max(12e4, fsReach() * 1.3) : 12e4;
  camera.updateProjectionMatrix();
  H.camera(camera, origin);
  sky.position.copy(camera.position);
  sea.position.set(camera.position.x, -0.6, camera.position.z);
  if (FS.on) {
    shared.uFsSea.value = fsF ? 1 : 0;
    const s = fsSea();
    sea.visible = !fsF;
    s.visible = fsF;
    if (fsF) {
      s.position.set(camera.position.x, -0.6, camera.position.z);
      s.material.userData.uNoise?.value.copy(noiseOrg(camera.position.x + origin.e, origin.n - camera.position.z));
    }
  }
}
function setView(v) {
  if (ride.on) rideExit();
  Object.assign(view, typeof v === "string" ? VIEWS[v] : v);
  applyView();
  schedule();
}
const RIDE_CAMS = { front: { h: 2.6, side: 0, yaw: 0, pitch: -3, fov: 60, label: "車頭" }, left: { h: 2, side: 1.2, yaw: 90, pitch: -2, fov: 70, label: "左窗" }, right: { h: 2, side: -1.2, yaw: -90, pitch: -2, fov: 70, label: "右窗" } };
const RIDES = { wenhu: "文湖線", tamsui: "淡水線", "r-under": "圓山南地下", "br-under": "松山機場地下" };
const ride = { on: false, name: "", route: null, s: 0, s0: 0, kmh: +(params.get("kmh") || 60), cam: "front", yaw: 0, pitch: 0, paused: false, done: false, look: +(params.get("rideLook") || 150), lead: +(params.get("rideLead") || 4), dist: +(params.get("rideDist") || 300), cur: null };
const rideCache = /* @__PURE__ */ new Map();
const rideLoad = (name) => {
  if (!rideCache.has(name)) rideCache.set(name, json("./routes/" + name + ".json"));
  return rideCache.get(name);
};
function routeAt(r, s) {
  const p = r.p, n = p.length;
  s = Math.max(0, Math.min(r.lengthM, s));
  let i = 0, j = n - 1;
  while (j - i > 1) {
    const m = i + j >> 1;
    if (p[m][3] <= s) i = m;
    else j = m;
  }
  const a = p[i], b = p[j], f = (s - a[3]) / (b[3] - a[3] || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, f < 0.5 ? a[4] : b[4]];
}
function rideCamera() {
  const r = ride.route, c = RIDE_CAMS[ride.cam], s = ride.s, here = routeAt(r, s), A = routeAt(r, s - 15), B = routeAt(r, s + 15);
  let fe = B[0] - A[0], fn = B[1] - A[1];
  const fl = Math.hypot(fe, fn) || 1;
  fe /= fl;
  fn /= fl;
  let z = 0;
  for (let k = -3; k <= 3; k++) z += routeAt(r, s + k * 5)[2];
  z /= 7;
  const le = -fn, ln = fe, yaw = (c.yaw + ride.yaw) * Math.PI / 180, pit = (c.pitch + ride.pitch) * Math.PI / 180;
  const de = fe * Math.cos(yaw) + le * Math.sin(yaw), dn = fn * Math.cos(yaw) + ln * Math.sin(yaw);
  const ce = here[0] + le * c.side, cn = here[1] + ln * c.side, cy = z + c.h;
  camera.position.set(ce - origin.e, cy, -(cn - origin.n));
  camera.lookAt(ce - origin.e + de * Math.cos(pit), cy + Math.sin(pit), -(cn - origin.n) - dn * Math.cos(pit));
  const aspect = H.w() / H.h(), A0 = c.fov * Math.PI / 180;
  camera.fov = (aspect >= 1 ? 2 * Math.atan(Math.tan(A0 / 2) / aspect) : A0) * 180 / Math.PI;
  camera.near = 0.5;
  camera.far = 4e4;
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  sea.position.set(camera.position.x, -0.6, camera.position.z);
  const ahead = ride.kmh / 3.6 * ride.lead;
  view.e = ce + de * ride.look + fe * ahead;
  view.n = cn + dn * ride.look + fn * ahead;
  view.dist = ride.dist;
  view.az = Math.atan2(de, dn);
  view.pitch = 0.3;
  ride.cur = { e: ce, n: cn, y: cy, de, dn, kind: here[3], ground: groundAt(ce, cn) };
}
function rebaseTo(e, n) {
  origin.e = Math.floor(e / TILE_M) * TILE_M;
  origin.n = Math.floor(n / TILE_M) * TILE_M;
  for (const t of tiles.values()) if (t.state === "ready") place(t.group, t.e0, t.n0);
  for (const f of fars.values()) if (f.state === "ready") place(f.mesh, f.e0, f.n0);
  shadowDirty = true;
}
async function rideStart(name, cam = ride.cam, s0 = 0) {
  const r = await rideLoad(name);
  Object.assign(ride, { on: true, name, route: r, cam: RIDE_CAMS[cam] ? cam : "front", s: Math.max(0, Math.min(r.lengthM, s0)), s0, yaw: 0, pitch: 0, done: false });
  const p = routeAt(r, ride.s);
  if (Math.hypot(p[0] - origin.e, p[1] - origin.n) > 6e3) rebaseTo(p[0], p[1]);
  rideCamera();
  schedule();
  rideUI();
}
function rideExit() {
  ride.on = false;
  camera.fov = 42;
  camera.updateProjectionMatrix();
  rideUI();
}
function rideSet(o) {
  if (o.cam && RIDE_CAMS[o.cam] && o.cam !== ride.cam) {
    ride.cam = o.cam;
    ride.yaw = ride.pitch = 0;
  }
  if (o.s != null) {
    ride.s = Math.max(0, Math.min(ride.route.lengthM, o.s));
    ride.done = false;
  }
  if (o.yaw != null) ride.yaw = Math.max(-60, Math.min(60, o.yaw));
  if (o.paused != null) ride.paused = !!o.paused;
  if (o.kmh) ride.kmh = o.kmh;
  if (ride.on) {
    rideCamera();
    schedule();
  }
  rideUI();
}
function rideStep(dt) {
  if (!ride.on || ride.paused) return;
  ride.s += ride.kmh / 3.6 * Math.min(dt, 100) / 1e3;
  if (ride.s >= ride.route.lengthM) {
    ride.s = ride.route.lengthM;
    ride.paused = ride.done = true;
    rideUI();
  }
  rideCamera();
}
function rideMissing() {
  if (!ride.on || !ride.cur) return [0, 0];
  const { e, n, de, dn } = ride.cur, half = (RIDE_CAMS[ride.cam].fov / 2 + 20) * Math.PI / 180;
  let vis = 0, near = 0;
  const ci = Math.floor(e / TILE_M), cj = Math.floor(n / TILE_M);
  for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
    const id = tileId(i, j);
    if (!index.tiles[id]) continue;
    const d = rectDist(e, n, i * TILE_M, j * TILE_M, TILE_M), t = tiles.get(id);
    const ce = (i + 0.5) * TILE_M - e, cn = (j + 0.5) * TILE_M - n, cd = Math.hypot(ce, cn) || 1, ang = Math.acos(Math.max(-1, Math.min(1, (ce * de + cn * dn) / cd)));
    if (d <= 1200 && (d <= 200 || ang <= half + Math.atan(TILE_M * 0.7 / cd)) && t?.state !== "ready") vis++;
    if (d <= 300 && !(t?.state === "ready" && t.lod === 0 && t.near && t.near !== "loading")) near++;
  }
  return [vis, near];
}
function rideUI() {
  const box = $("rides");
  if (!box) return;
  for (const b of box.querySelectorAll("button")) {
    const k = b.dataset.k, v = b.dataset.v;
    b.classList.toggle("on", k === "ride" ? ride.on && ride.name === v : k === "cam" ? ride.on && ride.cam === v : k === "pause" ? ride.on && ride.paused : false);
  }
}
{
  const pts = /* @__PURE__ */ new Map();
  let last = null;
  const mpp = () => 2 * Math.tan(camera.fov * Math.PI / 360) * view.dist / H.h();
  const pan = (dx, dy) => {
    const s = mpp(), f = dy * s / Math.max(0.3, Math.sin(view.pitch)), r = -dx * s;
    view.e += Math.cos(view.az) * r + Math.sin(view.az) * f;
    view.n += -Math.sin(view.az) * r + Math.cos(view.az) * f;
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, mod: e.shiftKey || e.ctrlKey });
    last = null;
  });
  canvas.addEventListener("pointerup", (e) => {
    pts.delete(e.pointerId);
    last = null;
  });
  canvas.addEventListener("pointercancel", (e) => {
    pts.delete(e.pointerId);
    last = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ride.on) {
      if (pts.size === 1) {
        ride.yaw = Math.max(-60, Math.min(60, ride.yaw + dx * 0.15));
        ride.pitch = Math.max(-20, Math.min(20, ride.pitch + dy * 0.1));
        rideCamera();
      }
      return;
    }
    if (pts.size === 1) {
      if (p.b === 2 || p.mod) {
        view.az += dx * 5e-3;
        view.pitch += dy * 4e-3;
      } else pan(dx, dy);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
      if (last) {
        view.dist *= last.d / Math.max(1, d);
        let da = ang - last.ang;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        view.az -= da;
        view.pitch += (my - last.my) * 4e-3;
      }
      last = { d, ang, my };
    }
    applyView();
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (ride.on) return;
    if (e.ctrlKey) view.pitch += e.deltaY * 4e-3;
    else view.dist *= Math.exp(e.deltaY * 11e-4);
    applyView();
  }, { passive: false });
}
H.onResize(() => {
  renderer.setSize(H.w(), H.h());
  camera.aspect = H.w() / H.h();
  camera.updateProjectionMatrix();
});
for (const [k, v] of Object.entries(VIEWS)) {
  const b = document.createElement("button");
  b.textContent = v.label;
  b.onclick = () => setView(k);
  $("views").appendChild(b);
}
{
  const box = $("rides"), add = (k, v, label, fn) => {
    const b = document.createElement("button");
    b.dataset.k = k;
    b.dataset.v = v;
    b.textContent = label;
    b.onclick = fn;
    box.appendChild(b);
  };
  for (const [k, label] of Object.entries(RIDES)) add("ride", k, "搭" + label, () => rideStart(k, ride.cam, 0));
  for (const [k, c] of Object.entries(RIDE_CAMS)) add("cam", k, c.label, () => ride.on ? rideSet({ cam: k }) : rideStart("wenhu", k, 0));
  add("pause", "", "暫停", () => ride.on && rideSet({ paused: !ride.paused }));
}
$("time").addEventListener("input", (e) => setTime(+e.target.value));
$("detail").addEventListener("change", (e) => {
  facade.uniforms.uDetail.value = e.target.checked ? 1 : 0;
});
const CREDIT = "資料：地形＝內政部 20 m DTM（經 Mapterhorn）｜影像＝Copernicus Sentinel-2｜建物輪廓、道路、水域＝Overture Maps（© OpenStreetMap 貢獻者、東亞建物資料集 Shi 等 2023）｜部分樓層＝臺北市建築執照套繪圖（臺北市建築管理工程處）｜軌道＝既有 network.json／metro-network.json（© OpenStreetMap 貢獻者）";
let creditKey = "";
function updateCredits() {
  let known = 0, guess = 0;
  for (const t of tiles.values()) {
    const f = t.meta?.counts?.floorsFrom;
    if (t.state !== "ready" || !f) continue;
    known += (f.height || 0) + (f.floors || 0) + (f.permit || 0);
    guess += (f.estimate || 0) + (f.rule || 0);
  }
  const key = known + "/" + guess;
  if (key === creditKey) return;
  creditKey = key;
  $("credits").textContent = (known + guess ? `樓層：畫面上載入的 ${known + guess} 棟裡，來源有記高度或樓層的 ${known} 棟，其餘 ${guess} 棟是照建物類型估的｜` : "") + CREDIT;
}
updateCredits();
setTime(+(params.get("t") || 15.2));
$("time").value = hour;
{
  const v = params.get("view") || "haikeguan", start = VIEWS[v] || VIEWS.haikeguan, o = { ...start };
  for (const k of ["e", "n", "dist", "az", "pitch"]) if (params.has(k)) o[k] = +params.get(k);
  origin.e = Math.floor(o.e / TILE_M) * TILE_M;
  origin.n = Math.floor(o.n / TILE_M) * TILE_M;
  setView(o);
}
const rideUg = await createRideUg({ DATA, renderer, scene, camera, tiles });
const trains = await createTrainsLayer({ THREE, scene, origin, params, tileReady: (e, n) => tiles.get(tileId(Math.floor(e / TILE_M), Math.floor(n / TILE_M)))?.state === "ready" });
if (params.get("ride") && !params.get("bench")) {
  await rideStart(params.get("ride"), params.get("cam") || "front", +(params.get("s0") || 0));
  rideSet({ yaw: +(params.get("yaw") || 0), paused: params.get("paused") === "1" });
  if (params.get("from")) rideSet({ s: rideUg.stationS(ride.route, params.get("from")) + +(params.get("s0") || 0) });
}
function hsKey() {
  let k = origin.e + "," + origin.n + "," + facadeMeshes.size + "," + extras.meshes.length;
  for (const t of tiles.values()) if (t.state === "ready") k += "," + t.lod + (t.useLo ? "l" : "");
  return k;
}
function hsCasters() {
  const mats = new Set([simpleMat, facadeMat, facade.material, facadeFarMat, stationSolid, ...stationLit.values()].filter(Boolean)), out = [];
  for (const t of tiles.values()) if (t.state === "ready") t.group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.visible && o.layers.isEnabled(0) && (mats.has(o.material) || o === t.structMesh)) out.push(o);
  });
  return out;
}
function updateShadow(now) {
  const R = Math.max(220, Math.min(1500, view.dist * 0.95)), tx = view.e - origin.e, tz = -(view.n - origin.n), moved = Math.hypot(tx - shadowState.x, tz - shadowState.z) >= R * LIMIT.shadowMove || Math.abs(R - shadowState.r) >= R * Math.max(0.12, LIMIT.shadowMove);
  if (!shadowDirty && !moved) return;
  if (now - shadowState.t < LIMIT.shadowGap) return;
  const ty = groundAt(view.e, view.n), c = sun.shadow.camera;
  c.left = c.bottom = -R;
  c.right = c.top = R;
  c.near = 200;
  c.far = 9e3;
  c.updateProjectionMatrix();
  sun.target.position.set(tx, ty, tz);
  sun.position.set(tx, ty, tz).addScaledVector(lightDir, 4e3);
  sun.target.updateMatrixWorld();
  sun.shadow.bias = -25e-5 - R * 4e-7;
  sun.shadow.normalBias = 0.25 + R * 12e-4;
  renderer.shadowMap.needsUpdate = true;
  shadowRenders++;
  Object.assign(shadowState, { x: tx, z: tz, r: R, t: now });
  shadowDirty = false;
}
const adapt = { on: LIMIT.adapt > 0, prTop: pixelRatio, prMin: Math.min(LIMIT.prMin, pixelRatio), extraSteps: [LIMIT.extraR, 250, 150].filter((v, i) => i === 0 || v < LIMIT.extraR), level: 0, n: 0, over: 0, t0: 0, bad: 0, good: 0, hold: 0, upWait: 4, lastUp: -1e9, changes: 0, log: [] };
function adaptFrame(dt, now) {
  if (!adapt.on) return;
  adapt.n++;
  if (dt > 20) adapt.over++;
  if (!adapt.t0) adapt.t0 = now;
  if (now - adapt.t0 < 1e3) return;
  const share = adapt.over / adapt.n;
  adapt.n = adapt.over = 0;
  adapt.t0 = now;
  if (now < adapt.hold) return;
  if (share > 0.08) {
    adapt.good = 0;
    if (++adapt.bad >= 2) {
      adapt.bad = 0;
      adaptMove(-1, now);
    }
  } else if (share < 0.02) {
    adapt.bad = 0;
    if (++adapt.good >= adapt.upWait) {
      adapt.good = 0;
      adaptMove(1, now);
    }
  } else adapt.bad = adapt.good = 0;
}
function adaptMove(dir, now) {
  const before = pixelRatio.toFixed(3) + "/" + LIMIT.extraR;
  if (dir < 0) {
    if (now - adapt.lastUp < 6e3) adapt.upWait = Math.min(30, adapt.upWait * 2);
    if (pixelRatio > adapt.prMin) {
      pixelRatio = Math.max(adapt.prMin, pixelRatio - 0.125);
      renderer.setPixelRatio(pixelRatio);
    } else if (adapt.level < adapt.extraSteps.length - 1) LIMIT.extraR = adapt.extraSteps[++adapt.level];
    else return;
  } else {
    if (adapt.level > 0) LIMIT.extraR = adapt.extraSteps[--adapt.level];
    else if (pixelRatio < adapt.prTop) {
      pixelRatio = Math.min(adapt.prTop, pixelRatio + 0.125);
      renderer.setPixelRatio(pixelRatio);
    } else return;
    adapt.lastUp = now;
  }
  adapt.hold = now + 1500;
  adapt.changes++;
  if (adapt.log.length < 200) adapt.log.push([Math.round(now), +pixelRatio.toFixed(3), LIMIT.extraR]);
  if (before !== pixelRatio.toFixed(3) + "/" + LIMIT.extraR) updateExtras();
}
const stat = { fps: 0, ms: 0, calls: 0, tris: 0, near: 0, mid: 0, far: 0, mb: 0, geomMB: 0, texMB: 0 };
let frames = 0, acc = 0, lastT = performance.now(), slow = 0, lastSched = 0, sample = null, frameT0 = 0, lastDt = 0;
const bloom = BLOOM_ON ? createBloom(renderer, FX2.grade ? { uGr2: { value: FX2U.gr } } : {}) : null;
const drawFrame = () => {
  if (bloom && night > 0.02) bloom.render(scene, camera, (0.2 + 0.5 * night) * smooth(0.02, 0.3, night));
  else if (bloom && FX2.bloom) bloom.render(scene, camera, FX2.T.bk, FX2.T.bt);
  else renderer.render(scene, camera);
};
window.__n64 = { NC, draw: drawFrame, bloom: !!bloom };
const fx2Size = new THREE.Vector2();
window.__fx2 = { FX2, AO2, HS2 };
const rest = { on: params.get("rest") !== "0", until: 0, at: 0, hour: NaN, drawn: 0, skipped: 0, why: [0, 0, 0, 0, 0, 0, 0, 0] };
const restGap = () => {
  const tanHalf = 1 / camera.projectionMatrix.elements[5];
  if (stars && stars.points.visible && view.pitch - Math.atan(tanHalf) < 0.12) return 0;
  renderer.getDrawingBufferSize(fx2Size);
  return Math.max(33, Math.min(250, 385 * 2 * view.dist * tanHalf / fx2Size.y));
};
window.__rest = rest;
function frame(now, still = false) {
  const dt = now - lastT;
  lastT = now;
  frameT0 = performance.now();
  lastDt = dt;
  frames++;
  acc += dt;
  const rec = prof.take();
  if (sample) sample(dt, now, rec);
  adaptFrame(dt, now);
  shared.uTime.value = now / 1e3;
  const renders0 = renderer.info.render.frame, busy0 = stageQ.length > 0 || unculled.length > 0 || envDirty || shadowDirty;
  if (ride.on) rideStep(dt);
  rideUg.update(ride);
  trains.update(now);
  if (NSKY && night > 0) glowApply(false);
  if (stars) stars.update(hour, night, now / 1e3, pixelRatio);
  if (lampMat) lampMat.uniforms.uPR.value = pixelRatio;
  if (now - lastSched > 250) {
    lastSched = now;
    tm("schedule", schedule);
  }
  if (envDirty) tm("env", updateEnv);
  updateShadow(now);
  roadFarCheck();
  facadeFarCheck();
  fsFade();
  {
    const mem = renderer.info.memory, g0 = mem.geometries, x0 = mem.textures, p0 = renderer.info.programs?.length || 0;
    if (stageQ.length || unculled.length) {
      const kb = tm("stage", drainStage);
      if (kb) prof.cur.stageKB = kb;
    }
    if (renderer.shadowMap.needsUpdate) prof.cur.shadow = 1;
    if (FX3.roof || FX3.far) {
      const sv = FX3.sun.value;
      sv.x = sunDir.x;
      sv.y = sunDir.y;
      sv.z = sunDir.z;
    }
    if (HS2) tm("hs2", () => {
      HS2.update(scene, hsCasters, view.e - origin.e, -(view.n - origin.n), view.dist, hsKey(), now);
      HS2.frame({ lightDir, sunY: sunDir.y, shadowCam: sun.shadow.camera, shadowOn: sun.castShadow && renderer.shadowMap.enabled && shadowRenders > 0 });
      if (fsK > 0) HS2.uniforms.uHt2L.value.w *= 1 - fsK;
    });
    if (FX2.any) {
      if (AO2) tm("ao2", () => AO2.update(scene, view.e - origin.e, -(view.n - origin.n), facadeMeshes.size + "," + origin.e + "," + origin.n, now));
      if (FX2U) {
        camera.updateMatrixWorld();
        renderer.getDrawingBufferSize(fx2Size);
        frameUniforms(FX2U, FX2, { camera, sunDir, fogColor: scene.fog.color, night, day: fx2S.day, dusk: fx2S.dusk, w: fx2Size.x, h: fx2Size.y, time: now / 1e3 });
      }
    }
    if (RHL) RHL.update(renderer, camera, view, night);
    const why = !rest.on ? 1 : !still ? 2 : busy0 ? 3 : hour !== rest.hour ? 4 : renderer.shadowMap.needsUpdate ? 5 : renderer.info.render.frame !== renders0 ? 6 : pending() > 0 ? 7 : 0;
    if (why) {
      rest.why[why]++;
      rest.until = now + 150;
      rest.hour = hour;
    }
    if (now < rest.until || now - rest.at >= restGap()) {
      rest.at = now;
      rest.drawn++;
      tm("render", drawFrame);
    } else rest.skipped++;
    if (mem.geometries > g0) prof.cur.upGeo = mem.geometries - g0;
    if (mem.textures > x0) prof.cur.upTex = mem.textures - x0;
    const p1 = renderer.info.programs?.length || 0;
    if (p1 > p0) prof.cur.upProg = p1 - p0;
  }
  if (acc >= 500) {
    stat.fps = Math.round(frames * 1e3 / acc);
    stat.ms = +(acc / frames).toFixed(1);
    stat.calls = renderer.info.render.calls;
    stat.tris = renderer.info.render.triangles;
    frames = 0;
    acc = 0;
    const list = [...tiles.values()].filter((t) => t.state === "ready");
    stat.near = list.filter((t) => t.lod === 0).length;
    stat.mid = list.length - stat.near;
    stat.far = [...fars.values()].filter((f) => f.state === "ready").length;
    stat.mb = +(total.bytes / 1048576).toFixed(2);
    stat.geomMB = +((list.reduce((s, t) => s + t.geomBytes, 0) + extras.bytes) / 1048576).toFixed(1);
    stat.texMB = +((list.reduce((s, t) => s + t.texBytes, 0) + stat.far * (260 * 260 * 4 * 1.33 + 256 * 256 * 4)) / 1048576).toFixed(1);
    updateCredits();
    $("hud").textContent = `${stat.fps} fps｜每格 ${stat.ms} ms｜繪製 ${stat.calls} 次｜三角形 ${(stat.tris / 1e6).toFixed(2)} M｜圖磚 近 ${stat.near}・中 ${stat.mid}・遠景塊 ${stat.far}｜已下載 ${stat.mb} MB｜幾何 ${stat.geomMB} MB、貼圖 ${stat.texMB} MB｜像素比 ${pixelRatio.toFixed(2)}` + (ride.on ? `｜${RIDES[ride.name] || ride.name} ${RIDE_CAMS[ride.cam].label} 里程 ${ride.s.toFixed(0)} m、${ride.kmh} km/h${ride.paused ? "（停）" : ""}｜下一站 ${(ride.route.stations.find((x) => x.s > ride.s + 1) || ride.route.stations.at(-1)).name}｜鏡頭附近沒載好 ${rideMissing().join("／")} 格` : "");
    if (!pending()) status("");
    if (!adapt.on && stat.fps < 42 && pixelRatio > 1 && !params.has("fixed") && !prFixed) {
      if (++slow >= 3) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        slow = 0;
      }
    } else slow = 0;
  }
}
H.ready({ frame, view, applyView, schedule, setTime, groundAt, origin, camera, renderer, scene, pending, tiles, fars, index, TILE_M, hsCasters, hsKey, get pixelRatio() {
  return pixelRatio;
} });
const BENCH = {
  badouzi: [{ ...VIEWS.wide, dist: 2600 }, VIEWS.haikeguan, VIEWS.badouzi, { e: 331500, n: 2780600, dist: 420, az: -1.2, pitch: 0.4 }, VIEWS.port],
  taipei: [VIEWS.taipei, VIEWS.daan, VIEWS.street, { e: 304850, n: 2768790, dist: 420, az: 1.4, pitch: 0.4 }, { e: 305900, n: 2769900, dist: 700, az: -2, pitch: 0.5 }],
  // 第 21 包：經過河與田的路線（關渡平原的田、基隆河與淡水河匯流口、關渡附近的基隆河）
  // 第 67 包：看得到道路高架橋的路線（市民高架與建國高架交會處 → 沿建國高架往北、往南 → 沿市民高架往東 → 拉高看整片），給手機量高架橋的成本
  viaduct: [{ e: 303480, n: 2770820, dist: 600, az: 0.6, pitch: 0.42 }, { e: 303480, n: 2771500, dist: 260, az: 0, pitch: 0.3 }, { e: 303500, n: 2769800, dist: 260, az: 3.14, pitch: 0.3 }, { e: 304300, n: 2770830, dist: 260, az: 1.57, pitch: 0.3 }, { e: 304800, n: 2770850, dist: 700, az: -1.6, pitch: 0.45 }],
  guandu: [{ e: 299200, n: 2779300, dist: 1500, az: -0.6, pitch: 0.7 }, { e: 298900, n: 2779700, dist: 500, az: 0.1, pitch: 0.42 }, { e: 298700, n: 2779850, dist: 140, az: 0.4, pitch: 0.3 }, { e: 298300, n: 2778700, dist: 800, az: -0.5, pitch: 0.4 }, { e: 300200, n: 2778300, dist: 600, az: 1.6, pitch: 0.36 }]
};
async function waitFilled(t0) {
  schedule();
  let net2 = 0, zero = 0;
  for (; ; ) {
    const now = performance.now(), p = pending();
    if (!net2 && p - stageQ.length === 0) net2 = now;
    else if (p - stageQ.length > 0) net2 = 0;
    if (p === 0) {
      if (!zero) zero = now;
      else if (now - zero >= 300) break;
    } else zero = 0;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { netMs: Math.round(net2), allMs: Math.round(zero), sinceMs: Math.round(zero - t0) };
}
const overShares = (a) => Object.fromEntries([20, 29, 37].map((m) => [m, a.length ? +(a.filter((d) => d > m).length / a.length).toFixed(4) : 0]));
async function bench(name = "badouzi", secondsPerLeg = 6) {
  const isRide = name === "window", keys = isRide ? [0, 1, 2, 3, 4] : BENCH[name], fr = { dt: [], g: [], x: [], s: [], b: [], kb: [], k: [] }, times = [], line = [], legs = [], slowRec = [], stepAll = {}, stepSlow = {}, sh0 = shadowRenders, peaks = { calls: 0, tris: 0, near: 0, mid: 0, geomMB: 0, texMB: 0 }, t0 = performance.now(), ad = { pr: [pixelRatio, pixelRatio], extraR: [LIMIT.extraR, LIMIT.extraR], changes0: adapt.changes }, miss = { vis: [], near: [], maxVis: 0, maxNear: 0, firstVisS: null };
  if (isRide) {
    await rideStart(params.get("ride") || "wenhu", params.get("cam") || "front", +(params.get("s0") || 0));
    ride.paused = true;
  } else setView(keys[0]);
  const fill = await waitFilled(t0), load = loadSnap();
  const loadMs = performance.now() - t0, lerp = (a, b, t) => a + (b - a) * t;
  for (let k = 1; k < keys.length; k++) {
    const a = { ...view }, b = keys[k];
    let da = b.az - a.az;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    await new Promise((done) => {
      const start = performance.now();
      sample = (dt, now, rec) => {
        const t = Math.min(1, (now - start) / (secondsPerLeg * 1e3)), s = t * t * (3 - 2 * t);
        times.push(dt);
        for (const [k2, v] of Object.entries(rec)) {
          stepAll[k2] = (stepAll[k2] || 0) + v;
          if (dt > 25) stepSlow[k2] = (stepSlow[k2] || 0) + v;
        }
        fr.dt.push(+dt.toFixed(1));
        fr.g.push(rec.upGeo || 0);
        fr.x.push(rec.upTex || 0);
        fr.s.push(rec.shadow || 0);
        fr.b.push(pending() > 0 ? 1 : 0);
        fr.kb.push(Math.round(rec.stageKB || 0));
        fr.k.push(rec.stageSkip ? 1 : 0);
        if (dt > 25 && slowRec.length < 600) {
          const r = { t: +((now - t0) / 1e3).toFixed(2), dt: +dt.toFixed(1), busy: pending() > 0 ? 1 : 0 };
          for (const [k2, v] of Object.entries(rec)) r[k2] = +v.toFixed(1);
          slowRec.push(r);
        }
        {
          const sec = Math.floor((now - t0) / 1e3), busy = pending() > 0;
          let b2 = line.at(-1);
          if (!b2 || b2.s !== sec) line.push(b2 = { s: sec, leg: k, n: 0, slow: 0, slowBusy: 0, maxMs: 0, tris: 0, calls: 0, shadow: shadowRenders });
          b2.n++;
          if (dt > 25) {
            b2.slow++;
            if (busy) b2.slowBusy++;
          }
          b2.maxMs = Math.max(b2.maxMs, +dt.toFixed(1));
          b2.tris = Math.max(b2.tris, renderer.info.render.triangles);
          b2.calls = Math.max(b2.calls, renderer.info.render.calls);
          (legs[k] ||= []).push(dt);
        }
        if (isRide) {
          ride.s = Math.min(ride.route.lengthM, ride.s0 + ride.kmh / 3.6 * secondsPerLeg * (k - 1 + t));
          rideCamera();
          const [mv, mn] = rideMissing();
          miss.vis.push(mv);
          miss.near.push(mn);
          miss.maxVis = Math.max(miss.maxVis, mv);
          miss.maxNear = Math.max(miss.maxNear, mn);
          if (mv && miss.firstVisS == null) miss.firstVisS = +ride.s.toFixed(0);
          const L = line.at(-1);
          L.miss = Math.max(L.miss || 0, mv);
          L.missNear = Math.max(L.missNear || 0, mn);
        } else Object.assign(view, { e: lerp(a.e, b.e, s), n: lerp(a.n, b.n, s), dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), s)), az: a.az + da * s, pitch: lerp(a.pitch, b.pitch, s) });
        applyView();
        ad.pr = [Math.min(ad.pr[0], pixelRatio), Math.max(ad.pr[1], pixelRatio)];
        ad.extraR = [Math.min(ad.extraR[0], LIMIT.extraR), Math.max(ad.extraR[1], LIMIT.extraR)];
        const i = renderer.info.render;
        peaks.calls = Math.max(peaks.calls, i.calls);
        peaks.tris = Math.max(peaks.tris, i.triangles);
        for (const key of ["near", "mid", "geomMB", "texMB"]) peaks[key] = Math.max(peaks[key], stat[key]);
        if (t >= 1) {
          sample = null;
          done();
        }
      };
    });
  }
  times.sort((x, y) => x - y);
  const q = (p) => +times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(1), gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
  for (let i = line.length - 1; i > 0; i--) line[i].shadow -= line[i - 1].shadow;
  if (line.length) line[0].shadow -= sh0;
  const p95 = (a) => {
    const v = [...a].sort((x, y) => x - y);
    return +v[Math.min(v.length - 1, Math.floor(v.length * 0.95))].toFixed(1);
  }, slowAll = line.reduce((t, b) => t + b.slow, 0), slowBusy = line.reduce((t, b) => t + b.slowBusy, 0);
  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(1)]));
  const result = {
    name,
    query: location.search,
    ...isRide ? { ride: { name: ride.name, cam: ride.cam, kmh: ride.kmh, s0: ride.s0, s1: +ride.s.toFixed(1), look: ride.look, lead: ride.lead, dist: ride.dist, missVisFrames: miss.vis.filter(Boolean).length, missNearFrames: miss.near.filter(Boolean).length, maxVis: miss.maxVis, maxNear: miss.maxNear, firstVisS: miss.firstVisS } } : {},
    over: overShares(times),
    load,
    overLeg: legs.filter(Boolean).map(overShares),
    fill,
    prof: { stepAll: r1(stepAll), stepSlow: r1(stepSlow), slowFrames: slowRec },
    frameLog: fr,
    slow: { over25ms: slowAll, whileLoading: slowBusy, steady: slowAll - slowBusy, share: +(slowAll / times.length).toFixed(3) },
    legP95: legs.filter(Boolean).map(p95),
    shadowRenders: shadowRenders - sh0,
    timeline: line,
    when: (/* @__PURE__ */ new Date()).toISOString(),
    ua: navigator.userAgent,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "",
    screen: [H.w(), H.h(), devicePixelRatio],
    pixelRatio,
    adapt: { on: adapt.on, prRange: ad.pr, extraRRange: ad.extraR, changes: adapt.changes - ad.changes0, upWait: adapt.upWait, log: adapt.log.slice(-60) },
    coarse,
    limit: { ...LIMIT },
    loadMs: Math.round(loadMs),
    frames: times.length,
    frameMs: { median: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) },
    fps: +(1e3 / (times.reduce((s, v) => s + v, 0) / times.length)).toFixed(1),
    peaks,
    downloadedMB: stat.mb,
    tilesLoaded: total.tiles,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null
  };
  window.__land.benchResult = result;
  return result;
}
const r0 = (o) => JSON.parse(JSON.stringify(o, (k, v) => typeof v === "number" ? +v.toFixed(1) : v));
const loadSnap = () => r0({ at: performance.now(), net: { n: net.n, ms: net.ms, lastAt: net.last }, prof: prof.all, jobs: jobStat, tiles: total.tiles, fars: fars.size });
function census() {
  camera.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const nearG = /* @__PURE__ */ new Set(), terr = /* @__PURE__ */ new Set(), farM = /* @__PURE__ */ new Set(), ex = new Set(extras.meshes), out = {}, shadow = { draws: 0, tris: 0 };
  for (const t of tiles.values()) {
    if (t.near?.group) nearG.add(t.near.group);
    for (const m of t.terrain || []) terr.add(m);
  }
  for (const f of fars.values()) if (f.mesh) farM.add(f.mesh);
  const cat = (m, inNear) => m.material === stationSolid || m.material === stationGlass ? (inNear ? "stn.near" : "stn.far") + (m.material === stationGlass ? ".glass" : "") : m.material === facade.material || m.material === facadeMat || facadeFarMat && m.material === facadeFarMat ? ex.has(m) ? "extras" : "facade" : m.material === simpleMat ? "simple" : m.material === treeMat ? "trees" : m.material === railMat ? "rail" : m.material === roadMat ? "roads" : m.material === wallMat ? "walls" : m.material === skyMat ? "sky" : m.material === seaMat ? "sea" : terr.has(m) ? "terrain" : farM.has(m) ? "far" : "struct";
  const walk = (o, inNear) => {
    if (!o.visible) return;
    inNear = inNear || nearG.has(o);
    if (o.isMesh && o.layers.test(camera.layers)) {
      const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1), k = cat(o, inNear), c = out[k] ||= { draws: 0, tris: 0, offDraws: 0, offTris: 0, meshes: 0 };
      c.meshes++;
      const inView = o.isInstancedMesh ? true : !o.frustumCulled ? (g.boundingSphere || g.computeBoundingSphere(), fr.intersectsSphere(g.boundingSphere.clone().applyMatrix4(o.matrixWorld))) : fr.intersectsObject(o);
      if (o.frustumCulled && !inView) return;
      c.draws++;
      c.tris += tris;
      if (!inView) {
        c.offDraws++;
        c.offTris += tris;
      }
      if (o.castShadow) {
        shadow.draws++;
        shadow.tris += tris;
      }
    }
    for (const ch of o.children) walk(ch, inNear);
  };
  scene.updateMatrixWorld();
  walk(scene, false);
  const tot = Object.values(out).reduce((a, c) => ({ draws: a.draws + c.draws, tris: a.tris + c.tris }), { draws: 0, tris: 0 });
  return { cats: out, total: tot, shadowCasters: shadow, info: { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }, view: { ...view }, stations: [...tiles.values()].reduce((a, t) => a + (t.stations?.length || 0), 0) };
}
window.__land = { census, loadSnap, P24, P28, facadeMat, facadeFarMat, facadeMeshes, roadMeshes, mats: { stationSolid, stationGlass, simpleMat, roadMat, treeMat, railMat, wallMat }, extras, tileStats: () => [...tiles.values()].filter((t) => t.state === "ready").map((t) => ({ id: t.id, lod: t.lod, terrainTris: t.terrainTris, geomMB: +(t.geomBytes / 1048576).toFixed(2), near: t.near && t.near !== "loading" ? { trees: t.near.trees, ...t.near.buildings } : null })), setView, setTime, view, stat, total, tiles, fars, renderer, scene, camera, facade, groundAt, VIEWS, origin, pending, bench, LIMIT, index, ride, rideStart, rideSet, rideExit, rideMissing, routeAt, setDetail: (on) => {
  facade.uniforms.uDetail.value = on ? 1 : 0;
  $("detail").checked = !!on;
}, ready: true };
Object.assign(window.__land, { FS, fsInfo, nightInfo, NSEL });
window.__land.vInfo = () => ({ VER, landVer, aeroVer: aeroSet.v || null, vsha: VSHA.on, main: { ...vstat }, worker: Object.fromEntries(Object.entries(jobStat).map(([k, s]) => [k, { n: s.n, sha: s.ph.sha || 0, shaN: s.ph.shaN || 0, shaKB: s.ph.shaKB || 0 }])), bo: [...BO.m].map(([k, b]) => ({ k, n: b.n, busy: !!b.busy })), nfail: [...nmaps.values()].filter((m) => m.state === "fail").map((m) => ({ k: m.key, n: m.n })) });
if (params.get("bench")) {
  const names = params.get("bench") === "1" ? ["badouzi", "taipei"] : params.get("bench").split(","), out = [];
  for (const nm of names) {
    status("量測中：" + nm);
    out.push(await bench(nm));
  }
  if (params.get("hold")) {
    const h = params.get("hold"), t1 = performance.now();
    if (ride.on) ride.paused = true;
    else setView(VIEWS[h] || JSON.parse(h));
    out.at(-1).holdFill = await waitFilled(t1);
    await new Promise((r) => setTimeout(r, 2500));
  }
  status("量測完成，送回結果…");
  try {
    const r = await fetch("/bench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(out) });
    status(r.ok ? "量測完成，結果已存回電腦：" + await r.text() : "結果送不回去（" + r.status + "）");
  } catch (e) {
    status("結果送不回去：" + e.message);
  }
  $("hud").textContent = out.map((o) => `${o.name}：${o.fps} fps、中位 ${o.frameMs.median} ms、95% ${o.frameMs.p95} ms、繪製 ${o.peaks.calls} 次、三角形 ${(o.peaks.tris / 1e6).toFixed(2)} M、像素比 ${pixelRatio.toFixed(2)}`).join("｜");
  if (params.get("next")) {
    const list = params.get("next").split("|"), q = list.shift();
    setTimeout(() => location.replace("/?" + q + (list.length ? "&next=" + encodeURIComponent(list.join("|")) : "")), 7e3);
  }
}
