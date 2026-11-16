import * as THREE from "../vendor/three.module.js";
import { JSON_INIT, hex16 } from "../shared/fetch-v.mjs";
const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;
export const AERO_KEY = "-aero2";
export async function aeroIndex(DATA) {
  try {
    const r = await fetch(DATA + "aero-index.json", JSON_INIT);
    if (!r.ok) return /* @__PURE__ */ new Set();
    const s = await r.text(), j = JSON.parse(s), set = new Set(j.tiles || []);
    set.v = await hex16(s);
    return set;
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
export async function loadAero(url, tex) {
  const [t, j] = await Promise.all([tex(url + "aero.png", false, false), fetch(url + "aero.json", JSON_INIT).then((r) => r.ok ? r.json() : null)]);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return { tex: t, json: j, px: null };
}
const LET = { "": 0, L: 1, R: 2, C: 3 };
const code = (d) => {
  const m = /^(\d{1,2})([LRC]?)$/.exec(d || "");
  return m ? +m[1] + 100 * LET[m[2]] : 0;
};
export function aeroUniforms(a) {
  const A = [0, 1, 2, 3].map(() => new THREE.Vector4()), B = [0, 1, 2, 3].map(() => new THREE.Vector4());
  (a?.json?.runways || []).slice(0, 4).forEach((r, i) => {
    A[i].set(r.a[0], r.a[1], r.b[0], r.b[1]);
    B[i].set(r.w, code(r.da), code(r.db), 1);
  });
  return { tAero: { value: a?.tex || black }, uAeroOn: { value: a ? 1 : 0 }, uRwA: { value: A }, uRwB: { value: B } };
}
export function aeroNoTree(a, x, y) {
  if (!a) return false;
  if (!a.px) {
    const im = a.tex.image, c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, 0, 0, 512, 512);
    a.px = g.getImageData(0, 0, 512, 512).data;
  }
  const i = Math.min(511, Math.max(0, Math.floor(x / 2.5))), j = Math.min(511, Math.max(0, Math.floor((1280 - y) / 2.5)));
  return a.px[(j * 512 + i) * 4] > 0;
}
const GLSL = `
// 第 125 包：機場
uniform sampler2D tAero; uniform float uAeroOn; uniform vec4 uRwA[4]; uniform vec4 uRwB[4];
float aBand(float x, float lo, float hi, float px){ return clamp(min(x - lo, hi - x) / max(px, 1e-4) + .5, 0., 1.) * min(1., (hi - lo) / max(px, 1e-4)); }
float aBox(vec2 p, vec2 lo, vec2 hi, float px){ return aBand(p.x, lo.x, hi.x, px) * aBand(p.y, lo.y, hi.y, px); }
float aSeg(vec2 p, vec2 a, vec2 b, float t, float px){ vec2 ba = b - a; float h = clamp(dot(p - a, ba) / dot(ba, ba), 0., 1.); float d = length(p - a - ba * h); return clamp((t * .5 - d) / max(px, 1e-4) + .5, 0., 1.) * min(1., t / max(px, 1e-4)); }
// 七段字：p＝字格內座標（x 由左到右、y 由下到上，0～W、0～H），m＝段（a 上 b 右上 c 右下 d 下 e 左下 f 左上 g 中，128＝R 的斜腳）
float aGlyph(vec2 p, int m, float W, float H, float t, float px){
  float h2 = H * .5, r = 0.;
  if ((m & 1) != 0) r = max(r, aBox(p, vec2(0., H - t), vec2(W, H), px));
  if ((m & 2) != 0) r = max(r, aBox(p, vec2(W - t, h2), vec2(W, H), px));
  if ((m & 4) != 0) r = max(r, aBox(p, vec2(W - t, 0.), vec2(W, h2), px));
  if ((m & 8) != 0) r = max(r, aBox(p, vec2(0., 0.), vec2(W, t), px));
  if ((m & 16) != 0) r = max(r, aBox(p, vec2(0., 0.), vec2(t, h2), px));
  if ((m & 32) != 0) r = max(r, aBox(p, vec2(0., h2), vec2(t, H), px));
  if ((m & 64) != 0) r = max(r, aBox(p, vec2(0., h2 - t * .5), vec2(W, h2 + t * .5), px));
  if ((m & 128) != 0) r = max(r, aSeg(p, vec2(W * .35, h2), vec2(W - t * .5, t * .5), t * 1.05, px));
  return r; }
int aDigit(int d){ return d == 0 ? 63 : d == 1 ? 6 : d == 2 ? 91 : d == 3 ? 79 : d == 4 ? 102 : d == 5 ? 109 : d == 6 ? 125 : d == 7 ? 7 : d == 8 ? 127 : 111; }
// 一端的標線（s＝離這一端門檻的距離、v＝往左為正（面向跑道另一端）、w＝寬、L＝全長、cd＝號碼代碼）
float aEnd(float s, float v, float w, float L, float cd, float px){
  float x = abs(v), m = 0.;
  if (s < -1. || s > L * .5 + 1.) return 0.;
  // 門檻斑馬線：6～36 m，條寬 1.8、條距 1.8，中間留 3.6 m
  float n = w >= 59. ? 8. : w >= 44. ? 6. : w >= 29. ? 4. : 3., q = x - 1.8, k = floor(q / 3.6);
  if (q >= 0. && k < n) m = max(m, aBand(s, 6., 36., px) * aBand(q - k * 3.6, 0., 1.8, px));
  // 號碼（高 9 m，下緣距斑馬線 12 m＝48 m）：兩位數字＋字母（字母靠門檻、數字在後）
  int num = int(mod(cd, 100.) + .5), lt = int(floor(cd / 100.) + .5);
  float W = 4.2, H = 9., t = 1.1, y0 = 48.;
  if (num > 0) {
    vec2 p = vec2(-v, s - y0);   // 面向跑道：右邊是 −v（第 125 包：從進場方向看過「10」是正的；從跑道內往門檻看會是倒的「01」，那是對的）
    float yd = lt > 0 ? H + 3. : 0.;   // 有字母時字母靠門檻、數字在字母後面（ICAO Annex 14 圖 5-3 的排法）
    m = max(m, aGlyph(p - vec2(-W - 1., yd), aDigit(num / 10), W, H, t, px));
    m = max(m, aGlyph(p - vec2(1., yd), aDigit(num - num / 10 * 10), W, H, t, px));
    if (lt > 0) m = max(m, aGlyph(p - vec2(-W * .5, 0.), lt == 1 ? 56 : lt == 2 ? 243 : 57, W, H, t, px));
  }
  float sc = y0 + (lt > 0 ? 2. * H + 3. : H) + 12.;
  // 中心線：30 m 線、20 m 空，寬 0.9
  if (s > sc) m = max(m, aBand(v, -.45, .45, px) * aBand(mod(s - sc, 50.), 0., 30., px) * (1. - smoothstep(10., 30., px)));
  // 瞄準點與接地區（全長 ≥ 1200 m 才畫）
  if (L >= 1200.) { float ap = L >= 2400. ? 400. : 300.;
    m = max(m, aBand(s, ap, ap + 60., px) * aBand(x, 9., 19., px));
    for (int i = 1; i <= 6; i++) { float s0 = 150. * float(i); if (abs(s0 - ap) < 75. || s0 > L * .5 - 100.) continue; float cnt = i <= 2 ? 3. : i <= 4 ? 2. : 1., qq = x - 9., kk = floor(qq / 4.5);
      if (qq >= 0. && kk < cnt) m = max(m, aBand(s, s0, s0 + 22.5, px) * aBand(qq - kk * 4.5, 0., 3., px)); } }
  return m; }
`;
const need = (s, a, b) => {
  if (!s.includes(a)) throw Error("第 125 包地面著色器對不上：" + a.slice(0, 50));
  return s.replace(a, b);
};
export function aeroGroundPatch(sh) {
  sh.uniforms.tAero ??= { value: black };
  sh.uniforms.uAeroOn ??= { value: 0 };
  sh.uniforms.uRwA ??= { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) };
  sh.uniforms.uRwB ??= { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) };
  let s = sh.fragmentShader;
  s = need(s, "varying vec3 vW; varying vec2 vL;", "varying vec3 vW; varying vec2 vL;" + GLSL);
  s = need(s, "#include <emissivemap_fragment>", `
  if (uAeroOn > .5 && uSize < 2000.) {
    vec2 tcA = uvM * 512. - .5, bfA = floor(tcA), frA = tcA - bfA; ivec2 bA = ivec2(bfA);
    vec4 e0 = texelFetch(tAero, clamp(bA, ivec2(0), ivec2(511)), 0), e1 = texelFetch(tAero, clamp(bA + ivec2(1, 0), ivec2(0), ivec2(511)), 0);
    vec4 e2 = texelFetch(tAero, clamp(bA + ivec2(0, 1), ivec2(0), ivec2(511)), 0), e3 = texelFetch(tAero, clamp(bA + ivec2(1, 1), ivec2(0), ivec2(511)), 0);
    vec4 cs = floor(vec4(e0.r, e1.r, e2.r, e3.r) * 255. + .5), ds = vec4(e0.g, e1.g, e2.g, e3.g) * (255. / 16.), ls = floor(vec4(e0.b, e1.b, e2.b, e3.b) * 255. + .5);
    vec4 ws = vec4((1. - frA.x) * (1. - frA.y), frA.x * (1. - frA.y), (1. - frA.x) * frA.y, frA.x * frA.y);
    if (cs.x + cs.y + cs.z + cs.w > .5) {
      float px = max(pxm, .02), c1 = 0., s1 = -1e3, c2 = 0., s2 = -1e3;
      vec4 ss; for (int k = 0; k < 4; k++) { vec4 mk = 1. - step(.5, abs(cs - cs[k])); ss[k] = dot(ws, mix(-ds, ds, mk)); }
      for (int k = 0; k < 4; k++) if (ss[k] > s1) { c1 = cs[k]; s1 = ss[k]; }
      for (int k = 0; k < 4; k++) if (abs(cs[k] - c1) > .5 && ss[k] > s2) { c2 = cs[k]; s2 = ss[k]; }
      float e = s2 < -999. ? 99. : (s1 - s2) * .5, tb = smoothstep(-px * .75, px * .75, e);
      float nz = .88 + .24 * (gN(P / 2.3).x * nearF * .6 + gN(P / 23.).x * .4), nz2 = .9 + .2 * gN(P / 7.).x;
      vec3 base = diffuseColor.rgb;
      vec3 grass = mix(base, vec3(.07, .12, .045) * (.8 + .4 * gN(P / 5.).x) * (.85 + .3 * gN(P / 41.).x), .6);
      vec3 cA = c1 < 1.5 ? vec3(.052, .053, .056) * nz : c1 < 2.5 ? vec3(.068, .068, .07) * nz : c1 < 3.5 ? vec3(.30, .29, .27) * nz2 : c1 < 4.5 ? grass : vec3(.05, .046, .042) * nz;
      vec3 cB = c2 < .5 ? base : c2 < 1.5 ? vec3(.052, .053, .056) * nz : c2 < 2.5 ? vec3(.068, .068, .07) * nz : c2 < 3.5 ? vec3(.30, .29, .27) * nz2 : c2 < 4.5 ? grass : vec3(.05, .046, .042) * nz;
      vec3 col = mix(cB, cA, tb);
      // 滑行道黃色中心線（不畫在跑道與草地上）
      if (ls.x * ls.y * ls.z * ls.w > .5 && c1 > 1.5 && c1 < 3.5) { vec4 dl = (ls - 128.) / 16.; float d = dot(ws, dl), mn = min(min(abs(dl.x), abs(dl.y)), min(abs(dl.z), abs(dl.w)));
        col = mix(col, vec3(.62, .40, .03), aBand(d, -.3, .3, px) * (1. - smoothstep(1.5, 1.9, mn)) * (1. - smoothstep(6., 14., px)) * tb); }
      // 第 132 包：停機坪白色安全線（服務車道邊線）。同樣 4 個像素的 A 通道（不多抓貼圖），4 個都 < 255 才算；畫法跟黃線一樣（寬 0.5 m、照覆蓋率變淡、拉遠淡出）
      vec4 wa = floor(vec4(e0.a, e1.a, e2.a, e3.a) * 255. + .5);
      if (max(max(wa.x, wa.y), max(wa.z, wa.w)) < 254.5 && c1 > 1.5 && c1 < 3.5) { vec4 dw = (wa - 191.) / 16.; float d = dot(ws, dw), mn = min(min(abs(dw.x), abs(dw.y)), min(abs(dw.z), abs(dw.w)));
        col = mix(col, vec3(.55, .55, .53), aBand(d, -.25, .25, px) * (1. - smoothstep(1.5, 1.9, mn)) * (1. - smoothstep(6., 14., px)) * tb); }
      diffuseColor.rgb = col;
    }
    // 跑道標線（照跑道矩形現算，跟柵格無關）
    for (int i = 0; i < 4; i++) { if (uRwB[i].w < .5) continue;
      vec2 a = uRwA[i].xy, b = uRwA[i].zw, dv = b - a; float L = length(dv); vec2 dr = dv / L, nr = vec2(-dr.y, dr.x); vec2 q = vL - a; float u = dot(q, dr), v = dot(q, nr), w = uRwB[i].x;
      if (abs(v) > w * .5 + 2. || u < -2. || u > L + 2.) continue;
      float px = max(pxm, .02), x = abs(v);
      // 輪胎痕：接地區（離門檻 250～900 m、中線兩側 12 m）偏黑
      float tire = max(aBand(u, 250., 900., 40.), aBand(L - u, 250., 900., 40.)) * (1. - smoothstep(6., 13., x)) * (.55 + .45 * gN(vL / 3.7).x);
      diffuseColor.rgb *= 1. - .45 * tire * step(u, L) * step(0., u);
      float mk = max(aEnd(u, v, w, L, uRwB[i].y, px), aEnd(L - u, -v, w, L, uRwB[i].z, px));
      mk = max(mk, aBand(x, w * .5 - 1.2, w * .5 - .3, px) * aBand(u, 0., L, px));   // 邊線 0.9 m
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62, .62, .6) * (.9 + .1 * nearF), mk * .92);
    }
  }
#include <emissivemap_fragment>`);
  sh.fragmentShader = s;
}
