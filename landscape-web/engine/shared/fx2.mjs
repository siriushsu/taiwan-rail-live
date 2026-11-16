export const FX2_ALL = ["light", "wall", "ao", "win", "fog", "bloom", "grade", "ground", "shade"];
export const FX2_CHEAP = ["light", "wall", "win", "fog", "ground"];
export const FX2_MOBILE = ["light", "wall", "fog", "ground"];
export function parseFx2(params, coarse) {
  const v = params.get("fx2"), F = {};
  const on = v === "0" ? [] : !v ? coarse ? FX2_MOBILE : FX2_ALL : v === "1" ? coarse ? FX2_CHEAP : FX2_ALL : v.split(",");
  for (const k of FX2_ALL) F[k] = on.includes(k);
  const T = { sun: 5.4, hemi: 0.35, env: 0.55, wall: 0.76, sat: 1, warm: 0.15, fog: 4e-5, ao: 0.85, aow: 0.5, gk: 1.2, gm: 1, gn: 0.14, pv: 0.6, bk: 0.22, bt: 1.15, vig: 0.16, hs: 1, hr: 1.6, hn: 2048, hd: 0 };
  for (const k of Object.keys(T)) if (params.has("x2" + k)) T[k] = +params.get("x2" + k);
  F.any = on.length > 0;
  F.T = T;
  F.key = on.length ? "-fx2" + FX2_ALL.filter((k) => F[k]).map((k) => k[0] + k[1]).join("") : "";
  return F;
}
const f = (x) => (+x).toFixed(4);
export function installChunks(THREE, F) {
  const U = { hzS: { x: 0, y: 1, z: 0, w: 0 }, hzC: { x: 0, y: 1, z: 0, w: 0 }, hzH: { x: 0.6, y: 0.7, z: 0.8, w: 0 }, hzZ: { x: 1, y: 0.9, z: 0.8, w: 1 / 1300 }, gr: { x: 0, y: 0, z: 0, w: 0 } };
  const add = (name, val) => {
    for (const s of Object.values(THREE.ShaderLib)) if (s.uniforms && s.uniforms.fogColor) s.uniforms[name] = { value: val };
  };
  if (F.fog) {
    add("uHz2S", U.hzS);
    add("uHz2C", U.hzC);
    add("uHz2H", U.hzH);
    add("uHz2Z", U.hzZ);
    THREE.ShaderChunk.fog_pars_vertex += "\n#ifdef USE_FOG\nvarying vec3 vHz2P;\n#endif";
    THREE.ShaderChunk.fog_vertex += "\n#ifdef USE_FOG\nvHz2P = mvPosition.xyz;\n#endif";
    THREE.ShaderChunk.fog_pars_fragment += "\n#ifdef USE_FOG\nvarying vec3 vHz2P; uniform vec4 uHz2S; uniform vec4 uHz2C; uniform vec4 uHz2H; uniform vec4 uHz2Z;\n#endif";
    const orig = THREE.ShaderChunk.fog_fragment;
    THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
if (uHz2H.w > 0.) {
  float dA = length(vHz2P); vec3 vd = vHz2P / max(dA, 1e-3);
  float wy = dot(uHz2C.xyz, vHz2P) + uHz2C.w, cy = uHz2C.w, kk = uHz2Z.w, dy = wy - cy;
  float lay = abs(dy) > 2. ? (exp(-cy * kk) - exp(-wy * kk)) / (dy * kk) : exp(-cy * kk);
  float fogFactor = 1. - exp(-uHz2H.w * dA * clamp(lay, 0., 4.));
  float sg = pow(max(dot(vd, uHz2S.xyz), 0.), 5.);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uHz2H.rgb, uHz2Z.rgb, sg), fogFactor);
} else {
${orig}
}
#endif`;
  }
  if (F.grade) {
    add("uGr2", U.gr);
    THREE.ShaderChunk.colorspace_pars_fragment += "\nuniform vec4 uGr2;";
    THREE.ShaderChunk.colorspace_fragment += `
#if defined( TONE_MAPPING )
if (uGr2.x > 0.) { vec2 q2 = (gl_FragCoord.xy / uGr2.xy - .5) * vec2(1., .9); gl_FragColor.rgb *= mix(1. - uGr2.w, 1., smoothstep(.8, .28, length(q2)));
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy + fract(uGr2.z) * 97., vec2(12.9898, 78.233))) * 43758.5453) - .5) * .012; }
#endif`;
  }
  return U;
}
export function frameUniforms(U, F, { camera, sunDir, fogColor, night, day, dusk, w, h, time }) {
  if (F.fog) {
    const v = sunDir.clone().transformDirection(camera.matrixWorldInverse);
    U.hzS.x = v.x;
    U.hzS.y = v.y;
    U.hzS.z = v.z;
    const e = camera.matrixWorld.elements;
    U.hzC.x = e[1];
    U.hzC.y = e[5];
    U.hzC.z = e[9];
    U.hzC.w = e[13];
    U.hzH.x = fogColor.r;
    U.hzH.y = fogColor.g;
    U.hzH.z = fogColor.b;
    U.hzH.w = F.T.fog * (1 + 1.2 * night);
    const sk = (1 - night) * (1 + 0.25 * dusk);
    U.hzZ.x = fogColor.r * (1 + 0.32 * sk) + 0.05 * sk;
    U.hzZ.y = fogColor.g * (1 + 0.18 * sk) + 0.03 * sk;
    U.hzZ.z = fogColor.b * (1 + 0.02 * sk);
  }
  if (F.grade) {
    U.gr.x = w;
    U.gr.y = h;
    U.gr.z = time;
    U.gr.w = F.T.vig;
  }
}
export function applyLight(F, { sun, hemi, scene, envGround, sunDir, day, night }) {
  if (!F.light) return;
  const T = F.T, el = Math.max(sunDir.y, 0);
  if (sunDir.y > -0.02) sun.intensity *= T.sun / 3.3;
  hemi.intensity = hemi.intensity * (1 - day) + hemi.intensity * T.hemi * day;
  scene.environmentIntensity = scene.environmentIntensity * (1 - day) + T.env * day;
  if (envGround) {
    const dl = (sun.intensity * el + 1.1 * day + 0.03) / Math.PI;
    envGround.material.color.setRGB(0.3, 0.29, 0.27).multiplyScalar(Math.min(dl, 2.2) * day + 0.02);
  }
}
export function facadePatch(sh, F, ao) {
  const T = F.T;
  let s = sh.fragmentShader;
  const need = (a, b) => {
    if (!s.includes(a)) throw Error("第 114 包立面對不上：" + a.slice(0, 60));
    s = s.replace(a, b);
  };
  if (F.wall) need("float part = floor(vHs.x + .5); vec3 base = vCol;", `float part = floor(vHs.x + .5); vec3 base = vCol; { float l2 = dot(base, vec3(.3, .59, .11)); base = mix(vec3(l2), base, ${f(T.sat)}) * ${f(T.wall)} * vec3(${f(1 + 0.4 * T.warm)}, 1., ${f(1 - T.warm)}); }`);
  if (F.win || F.ao) need("float cv = clamp((v - z0) / fh, 0., 1.), seed = vRn.x * 911.;", "float cv = clamp((v - z0) / fh, 0., 1.), seed = vRn.x * 911.; vec3 c2Wall = col;");
  if (F.win) {
    const pane = s.includes("vec3 gBody = mix(vec3(.20, .29, .36), base * 1.3, .4)");
    need("float r = twH3(vec3(j, k, seed)),", `vec3 r2 = vec3(0., 0., 1.); float near2 = 0.;
  { float cp2 = max(fwidth(s), fwidth(v)) / max(min(bw, fh), .5); near2 = 1. - smoothstep(.05, .14, cp2);
    if (near2 > .01) { vec3 Pv = -vViewPosition, dPx = dFdx(Pv), dPy = dFdy(Pv), Nw = normalize(cross(dPx, dPy)); if (dot(Nw, Pv) > 0.) Nw = -Nw;
      vec3 Ts = cross(dPy, Nw) * dFdx(s) + cross(Nw, dPx) * dFdy(s); float tl = length(Ts); vec3 Up = normalize(mat3(viewMatrix) * vec3(0., 1., 0.)); Up = normalize(Up - Nw * dot(Up, Nw));
      if (tl > 1e-6) { vec3 rd = normalize(Pv); r2 = vec3(dot(rd, Ts / tl), dot(rd, Up), max(-dot(rd, Nw), .06)); } else near2 = 0.; } }
  float r = twH3(vec3(j, k, seed)),`);
    need("glass = textureGrad(tWinM, tc, dx, dy).r * w.a * (1. - smoothstep(.45, .75, lum));", `glass = textureGrad(tWinM, tc, dx, dy).r * w.a * (1. - smoothstep(.45, .75, lum));
    if (near2 > .01 && glass > .01) { vec2 sh2 = r2.xy / r2.z * .22; float gS = textureGrad(tWinM, vec3(cu + sh2.x / bw, 1. - (cv + sh2.y / fh), layer), dx, dy).r;
      float rev = clamp(glass - gS, 0., 1.) * near2; col = mix(col, c2Wall * (sh2.y > 0. ? .38 : .62), rev); glass *= 1. - rev; }`);
    if (pane) need("vec3 gBody = mix(vec3(.20, .29, .36), base * 1.3, .4), gIn = mix(col * mix(.5, .62, cw), gBody, mix(.25, .75, cw));", `vec3 gBody = mix(vec3(.20, .29, .36), base * 1.3, .4), gIn = mix(col * mix(.5, .62, cw), gBody, mix(.25, .75, cw));
  if (near2 > .01 && cw < .5) { float D2 = min(.8 * bw, 4.); vec3 rr = vec3(r2.x / bw, r2.y / fh, r2.z / D2); rr.x = abs(rr.x) < 1e-4 ? 1e-4 : rr.x; rr.y = abs(rr.y) < 1e-4 ? 1e-4 : rr.y;
    vec2 p2 = vec2(cu, cv); vec3 tt = vec3((rr.x > 0. ? 1. - p2.x : -p2.x) / rr.x, (rr.y > 0. ? 1. - p2.y : -p2.y) / rr.y, 1. / rr.z); float t2 = min(tt.x, min(tt.y, tt.z)); vec3 hh = vec3(p2, 0.) + rr * t2;
    float rh = twH3(vec3(j + 2., k + 5., seed)), rh2 = twH3(vec3(j + 9., k + 1., seed));
    vec3 wc = mix(vec3(.58, .52, .42), vec3(.42, .50, .55), step(.62, rh2)); wc = mix(wc, vec3(.62, .61, .58), step(.8, rh));
    vec3 room = tt.z <= t2 + 1e-5 ? wc * (.72 + .28 * step(.45, fract(hh.x * 1.7 + rh * 3.))) : tt.y <= t2 + 1e-5 ? (rr.y > 0. ? vec3(.80, .79, .76) : vec3(.26, .21, .16)) : wc * .78;
    room *= 1. - .4 * clamp(hh.z, 0., 1.);
    if (rh2 > .62 && cv > mix(.4, .8, rh)) room = mix(room, mix(vec3(.62, .57, .46), vec3(.42, .50, .58), step(.8, rh2)), .85);   // 窗簾
    gIn = mix(gIn, room * .3, near2); }`);
    need("  float lit = step(twH3(vec3(j + 5., k + 3., seed)),", `  if (layer > -.5) { float cp = px / max(min(bw, fh), .5), wa = smoothstep(.10, .24, cp) * (1. - uNight), wb = smoothstep(.3, .7, cp), cwF = 1. - step(.5, abs(layer - 10.)), aw = fwidth(cv);
    vec3 gM = mix(vec3(.05, .06, .07), mix(vec3(.20, .29, .36), base * 1.3, .4), cwF * .8);
    float band = smoothstep(.24 - aw, .24 + aw, cv) * (1. - smoothstep(.8 - aw, .8 + aw, cv)) * (k < .5 && !commercial ? .6 : 1.);
    vec3 cStr = mix(c2Wall, gM, band * mix(.8, .95, cwF)), cAvg = mix(c2Wall, gM, mix(.4, .85, cwF));
    col = mix(col, mix(cStr, cAvg, wb), wa); glass = mix(glass, mix(band * .8, .5 + .3 * cwF, wb), wa); }
  float lit = step(twH3(vec3(j + 5., k + 3., seed)),`);
  }
  if (F.ao && ao) {
    need("#include <common>", "#include <common>\nuniform sampler2D tAO2; uniform vec4 uAO2;");
    need("#include <lights_physical_fragment>", `if (vHs.x < 3.5 && vSV.y < vLv.w) { float v2 = vSV.y;
  vec3 Pw = (-vViewPosition - viewMatrix[3].xyz) * mat3(viewMatrix), Nw2 = nonPerturbedNormal * mat3(viewMatrix);
  vec2 q = Pw.xz + normalize(Nw2.xz + 1e-5) * 3.; vec2 uvA = vec2((q.x - uAO2.x) * uAO2.z + .5, -(q.y - uAO2.y) * uAO2.z + .5);
  float edge = smoothstep(0., .06, min(min(uvA.x, uvA.y), min(1. - uvA.x, 1. - uvA.y))) * uAO2.w;
  float occ = smoothstep(.3, .75, texture2D(tAO2, uvA).r) * edge;
  diffuseColor.rgb *= (1. - ${f(T.aow)} * occ * (1. - smoothstep(1.5, 24., v2))) * mix(.8, 1., smoothstep(0., 8., v2)); }
#include <lights_physical_fragment>`);
    Object.assign(sh.uniforms, ao.uniforms);
  }
  sh.fragmentShader = s;
}
export function groundPatch(sh, F, ao) {
  const T = F.T;
  let s = sh.fragmentShader;
  const need = (a, b) => {
    if (!s.includes(a)) throw Error("第 114 包地面對不上：" + a.slice(0, 60));
    s = s.replace(a, b);
  };
  if (F.ground) {
    need("vec3 pave = vec3(.27, .27, .26)", `vec3 pave = ${f(T.pv)} * vec3(.27, .27, .26)`);
    need("vec3 land = sat * 3.1 / (1. + sat * 2.3);", `vec3 land = mix(sat * 3.1 / (1. + sat * 2.3), sat * ${f(T.gk)}, ${f(T.gm)});`);
    need("land *= mix(1., .36 / max(dot(land, vec3(.3, .5, .2)), .36), (1. - veg) * .7);", `land *= mix(1., ${f(T.gn)} / max(dot(land, vec3(.3, .5, .2)), ${f(T.gn)}), (1. - veg) * .5);
  land *= mix(1., .8 + .4 * (gN(P / 2.3).x * .6 + gN(P / 15.).x * .4), (1. - veg) * (1. - smoothstep(80., 1400., dist)));`);
  }
  if (F.ao && ao) {
    need("#include <common>", "#include <common>\nuniform sampler2D tAO2; uniform vec4 uAO2;");
    need("land *= 1. - .22 * foot;", `land *= 1. - .22 * foot;
  { vec2 uvA = vec2((vW.x - uAO2.x) * uAO2.z + .5, -(vW.z - uAO2.y) * uAO2.z + .5); float edge = smoothstep(0., .06, min(min(uvA.x, uvA.y), min(1. - uvA.x, 1. - uvA.y))) * uAO2.w;
    land *= 1. - ${f(T.ao)} * texture2D(tAO2, uvA).r * edge * (1. - smoothstep(1500., 6000., dist)); }`);
    Object.assign(sh.uniforms, ao.uniforms);
  }
  sh.fragmentShader = s;
}
export function simplePatch(m, F, HS) {
  if (!F.wall && !F.win && !(F.shade && HS)) return;
  const T = F.T, ob = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    if (ob) ob.call(m, sh, r);
    if (F.shade && HS) shadePatch(sh, HS, F.T.hd);
    let s = sh.fragmentShader;
    if (!s.includes("#include <color_fragment>")) throw Error("第 114 包中景建物對不上");
    s = s.replace("#include <color_fragment>", `#include <color_fragment>
${F.wall ? `{ float l2 = dot(diffuseColor.rgb, vec3(.3, .59, .11)); diffuseColor.rgb = mix(vec3(l2), diffuseColor.rgb, ${f(T.sat)}) * ${f(T.wall)} * vec3(${f(1 + 0.4 * T.warm)}, 1., ${f(1 - T.warm)}); }` : ""}
${F.win ? "{ vec3 nW = normalize(vNormal) * mat3(viewMatrix); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.05, .06, .07), .36 * (1. - smoothstep(.3, .7, abs(nW.y)))); }" : ""}`);
    sh.fragmentShader = s;
  };
  m.customProgramCacheKey = () => (key ? key.call(m) : "") + F.key;
  m.needsUpdate = true;
}
export function createContactAO(THREE, renderer, { size = 1024, half = 1200 } = {}) {
  const LAYER = 7, mk = () => new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const rtA = mk(), rtB = mk(), cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 24e3);
  cam.layers.set(LAYER);
  cam.up.set(0, 0, -1);
  const white = new THREE.MeshBasicMaterial({ color: 16777215, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const blur = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv; void main(){ float c = texture2D(tSrc, vUv).r * .16;
  c += (texture2D(tSrc, vUv + uDir * 1.5).r + texture2D(tSrc, vUv - uDir * 1.5).r) * .15; c += (texture2D(tSrc, vUv + uDir * 3.5).r + texture2D(tSrc, vUv - uDir * 3.5).r) * .12;
  c += (texture2D(tSrc, vUv + uDir * 5.5).r + texture2D(tSrc, vUv - uDir * 5.5).r) * .1; c += (texture2D(tSrc, vUv + uDir * 7.5).r + texture2D(tSrc, vUv - uDir * 7.5).r) * .05; gl_FragColor = vec4(vec3(c), 1.); }`
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blur), qs = new THREE.Scene(), qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;
  qs.add(quad);
  const uniforms = { tAO2: { value: rtA.texture }, uAO2: { value: new THREE.Vector4(0, 0, 1 / (2 * half), 0) } };
  let lastKey = "", lastT = -1e9, renders = 0;
  const cc = new THREE.Color();
  return {
    LAYER,
    uniforms,
    rt: rtA,
    cam,
    get renders() {
      return renders;
    },
    // cx、cz：場景座標的中心（鏡頭看的點）；key 變了（中心移動 150 m、近景建物數變了、換原點）且距上次 ≥ 300 ms 才重畫
    update(scene, cx, cz, key, now) {
      const k = Math.round(cx / 150) + "," + Math.round(cz / 150) + "," + key;
      if (k === lastKey || now - lastT < 300) return false;
      lastKey = k;
      lastT = now;
      renders++;
      const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevOv = scene.overrideMaterial, prevBg = scene.background, prevFog = scene.fog, sNeed = renderer.shadowMap.needsUpdate, prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(cc);
      const ar = renderer.info.autoReset;
      renderer.info.autoReset = false;
      cam.position.set(cx, 12e3, cz);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      scene.overrideMaterial = white;
      scene.background = null;
      scene.fog = null;
      renderer.shadowMap.needsUpdate = false;
      renderer.autoClear = true;
      renderer.setClearColor(0, 1);
      renderer.setRenderTarget(rtA);
      renderer.render(scene, cam);
      scene.overrideMaterial = prevOv;
      scene.background = prevBg;
      scene.fog = prevFog;
      renderer.shadowMap.needsUpdate = sNeed;
      blur.uniforms.tSrc.value = rtA.texture;
      blur.uniforms.uDir.value.set(3 / size, 0);
      renderer.setRenderTarget(rtB);
      renderer.render(qs, qc);
      blur.uniforms.tSrc.value = rtB.texture;
      blur.uniforms.uDir.value.set(0, 3 / size);
      renderer.setRenderTarget(rtA);
      renderer.render(qs, qc);
      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(cc, prevAlpha);
      renderer.info.autoReset = ar;
      uniforms.uAO2.value.set(cx, cz, 1 / (2 * half), 1);
      return true;
    }
  };
}
export function createHeightShade(THREE, renderer, F) {
  const size = Math.max(256, Math.min(4096, F.T.hn | 0)), LAYER = 9;
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4e4);
  cam.layers.set(LAYER);
  cam.up.set(0, 0, -1);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    vertexShader: "varying float vY; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: "varying float vY; void main(){ gl_FragColor = vec4(max(vY, 0.), 0., 0., 1.); }"
  });
  const uniforms = { tHt2: { value: rt.texture }, uHt2: { value: new THREE.Vector4(0, 0, 1, 0) }, uHt2L: { value: new THREE.Vector4(0, 1, 0, 0) }, uHt2B: { value: new THREE.Vector4(1, 0, 0, 0) }, uHt2M: { value: new THREE.Matrix4() } };
  const cc = new THREE.Color();
  let last = { x: 1e9, z: 1e9, half: 0, key: "" }, lastT = -1e9, renders = 0, drawn = 0;
  return {
    LAYER,
    uniforms,
    rt,
    size,
    get renders() {
      return renders;
    },
    get drawn() {
      return drawn;
    },
    bytes: size * size * 2,
    // casters：要畫進高度圖的網格（呼叫端挑好、只給看得到的）；key：網格組成（數量＋原點）
    update(scene, casters, cx, cz, dist, key, now) {
      const half = Math.max(1500, Math.min(6e3, Math.round(dist * F.T.hr / 250) * 250)), tx = 2 * half / size;
      cx = Math.round(cx / tx) * tx;
      cz = Math.round(cz / tx) * tx;
      const moved = Math.hypot(cx - last.x, cz - last.z) > last.half * 0.06 || Math.abs(half - last.half) > last.half * 0.12 || key !== last.key;
      if (!moved || now - lastT < 300) return false;
      lastT = now;
      renders++;
      last = { x: cx, z: cz, half, key };
      casters = typeof casters === "function" ? casters() : casters;
      for (const m of casters) m.layers.enable(LAYER);
      const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevOv = scene.overrideMaterial, prevBg = scene.background, prevFog = scene.fog, sNeed = renderer.shadowMap.needsUpdate, prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(cc);
      const ar = renderer.info.autoReset;
      renderer.info.autoReset = false;
      const c0 = renderer.info.render.calls;
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.updateProjectionMatrix();
      cam.position.set(cx, 2e4, cz);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      scene.overrideMaterial = mat;
      scene.background = null;
      scene.fog = null;
      renderer.shadowMap.needsUpdate = false;
      renderer.autoClear = true;
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      drawn = renderer.info.render.calls - c0;
      scene.overrideMaterial = prevOv;
      scene.background = prevBg;
      scene.fog = prevFog;
      renderer.shadowMap.needsUpdate = sNeed;
      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(cc, prevAlpha);
      renderer.info.autoReset = ar;
      for (const m of casters) m.layers.disable(LAYER);
      uniforms.uHt2.value.set(cx, cz, 1 / (2 * half), 1);
      uniforms.uHt2B.value.x = 2 * half / size;
      return true;
    },
    // 每格：太陽方向（場景座標，朝太陽）、白天強度、陰影圖的光空間矩陣與半徑（R＝0 表示沒有陰影圖）
    frame({ lightDir, sunY, shadowCam, shadowOn }) {
      const w = Math.max(0, Math.min(1, (sunY - 0) / 0.08)) * F.T.hs * (uniforms.uHt2.value.w > 0 ? 1 : 0);
      uniforms.uHt2L.value.set(lightDir.x, lightDir.y, lightDir.z, w);
      if (shadowOn) {
        uniforms.uHt2M.value.copy(shadowCam.matrixWorldInverse);
        uniforms.uHt2B.value.z = shadowCam.right;
      } else uniforms.uHt2B.value.z = 0;
    }
  };
}
const SHADE_GLSL = `
uniform sampler2D tHt2; uniform vec4 uHt2; uniform vec4 uHt2L; uniform vec4 uHt2B; uniform mat4 uHt2M;
float twHsK = 1., twHsA = 1.;
float twHtH(vec2 q) { return texture2D(tHt2, vec2((q.x - uHt2.x) * uHt2.z + .5, -(q.y - uHt2.y) * uHt2.z + .5)).r; }
// 算 twHsK（太陽直射光的落影係數）與 twHsA（環境光：街谷與背光面）
void twHtCalc(vec3 P, vec3 N) {
  twHsK = 1.; twHsA = 1.; if (uHt2L.w <= 0.) return;
  vec2 Lh = uHt2L.xz; float lh = length(Lh); if (lh < 1e-3) return; Lh /= lh;
  vec2 Nh = N.xz; float nl = length(Nh), wall = smoothstep(.3, .7, nl); Nh = nl > .3 ? Nh / nl : vec2(0.);
  // 背光面：牆的水平法線背對太陽時環境光少一點（受光面、背光面拉開；屋頂、地面不變）
  twHsA = 1. - .22 * wall * clamp(-dot(Nh, Lh), 0., 1.) * uHt2L.w;
  vec2 uv = vec2((P.x - uHt2.x) * uHt2.z + .5, -(P.z - uHt2.y) * uHt2.z + .5);
  float edge = smoothstep(0., .08, min(min(uv.x, uv.y), min(1. - uv.x, 1. - uv.y)));
  float w = 1.;
  if (uHt2B.z > 0.) { vec2 ls = (uHt2M * vec4(P, 1.)).xy; w = smoothstep(.75, .95, max(abs(ls.x), abs(ls.y)) / uHt2B.z); }
  w *= edge * uHt2L.w; if (w <= .001) return;
  float tn = uHt2L.y / lh, tx = uHt2B.x;
  vec3 p = P + vec3(Nh.x, 0., Nh.y) * tx * 1.5; p.y += .5 + tx * .15;
  float dmax = clamp(70. / max(tn, 1e-3), tx * 4., 320.), occ = 0.;
  for (int i = 0; i < 12; i++) { float d = tx * .75 + dmax * pow((float(i) + .5) / 12., 1.5); vec2 q = p.xz + Lh * d;
    float h = twHtH(q) - (p.y + d * tn); occ = max(occ, smoothstep(0., 1.2 + d * .03, h) * (1. - smoothstep(dmax * .6, dmax, d) * .5)); }
  float soft = mix(.72, 1., smoothstep(.06, .3, uHt2L.y));
  twHsK = mix(1., 1. - occ * soft, w);
  // 街谷：四個方向 1.5 與 4 個像素外比自己高的越多，天空越少（只給地面與牆的下段，遠處才用；近處 fx2 ao 管）
  float sky = 0., r1 = tx * 1.5, r2 = tx * 4.;
  for (int k = 0; k < 4; k++) { vec2 dk = vec2(k == 0 ? 1. : k == 1 ? -1. : 0., k == 2 ? 1. : k == 3 ? -1. : 0.);
    sky += smoothstep(2., 14., twHtH(p.xz + dk * r1) - P.y) * .6 + smoothstep(4., 24., twHtH(p.xz + dk * r2) - P.y) * .4; }
  twHsA *= 1. - .32 * (sky / 4.) * w;
}
void twDirInfoS(const in DirectionalLight directionalLight, out IncidentLight light) { getDirectionalLightInfo(directionalLight, light); light.color *= twHsK; }
`;
export function shadePatch(sh, HS, dbg) {
  let s = sh.fragmentShader;
  const need = (a, b) => {
    if (!s.includes(a)) throw Error("第 121 包落影對不上：" + a.slice(0, 60));
    s = s.replace(a, b);
  };
  need("#include <lights_pars_begin>", "#include <lights_pars_begin>\n" + SHADE_GLSL);
  need("#include <lights_fragment_begin>", `{ vec3 PwS = (-vViewPosition - viewMatrix[3].xyz) * mat3(viewMatrix), NwS = normal * mat3(viewMatrix); twHtCalc(PwS, NwS); }
#define getDirectionalLightInfo twDirInfoS
#include <lights_fragment_begin>
#undef getDirectionalLightInfo`);
  need("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= twHsA; reflectedLight.indirectSpecular *= mix(1., twHsA, .5);");
  if (dbg) need("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor = vec4(twHsK, twHsA, 0., 1.);");
  Object.assign(sh.uniforms, HS.uniforms);
  sh.fragmentShader = s;
}
