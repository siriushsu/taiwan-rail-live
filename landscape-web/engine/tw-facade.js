import * as THREE from "./vendor/three.module.js";
import { TQ, drawFinishes, drawWindows, drawSigns, SHUTTERS, CAGES } from "./kit-city-atlas.js";
import { CVS_PAL, CVS_PAL_NAMES, cvsBandGLSL, cvsBrandOn } from "./shared/cvs-look.mjs";
import { TW2 } from "./shared/tw2.mjs";
const WIN_COL = [[1, 0.623, 0.31], [1, 0.882, 0.745], [0.484, 0.666, 1]];
const WIN_MIX = { res: [0.68, 0.2, 0.12], office: [0.3, 0.45, 0.25], shop: [0.3, 0.35, 0.35], school: [0.1, 0.4, 0.5], hall: [0.15, 0.35, 0.5], temple: [0.75, 0.1, 0.15], wood: [0.8, 0.1, 0.1] };
const y709 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], g3 = (c) => `vec3(${c.map((v) => v.toFixed(4)).join(", ")})`;
const WIN_Y = { res: (0.85 * y709([1, 0.66, 0.32]) + 0.15 * y709([0.64, 0.688, 0.8])) * 1.25, office: (0.8 * y709([1, 0.8, 0.56]) + 0.2 * y709([0.86 * 0.85, 0.9 * 0.85, 0.85])) * 0.4 };
const WIN_C1 = WIN_COL.map((c) => g3(c.map((v) => v / y709(c))));
function layersFrom(canvas, cols, rows, cw, ch, { premultiply = false, red = false } = {}) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }), n = cols * rows, out = new Uint8Array(cw * ch * n * (red ? 1 : 4));
  for (let i = 0; i < n; i++) {
    const d = ctx.getImageData(i % cols * cw, Math.floor(i / cols) * ch, cw, ch).data;
    if (red) {
      for (let p = 0; p < cw * ch; p++) out[i * cw * ch + p] = d[p * 4];
      continue;
    }
    if (premultiply) for (let p = 0; p < cw * ch; p++) {
      const a = d[p * 4 + 3] / 255;
      d[p * 4] = Math.round(d[p * 4] * a);
      d[p * 4 + 1] = Math.round(d[p * 4 + 1] * a);
      d[p * 4 + 2] = Math.round(d[p * 4 + 2] * a);
    }
    out.set(d, i * cw * ch * 4);
  }
  const t = new THREE.DataArrayTexture(out, cw, ch, n);
  if (red) {
    t.format = THREE.RedFormat;
  } else {
    t.format = THREE.RGBAFormat;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  t.type = THREE.UnsignedByteType;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
export function createFacade(renderer, { coarse = false, glass = 0, pane = false, nwin = false, nroom = false, fx = false } = {}) {
  TQ.win = coarse ? 0.5 : 1;
  TQ.finish = coarse ? 0.5 : 1;
  TQ.sign = coarse ? 0.25 : 0.5;
  const aniso = Math.min(coarse ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  const fin = drawFinishes(), fs = fin[0].width, finCanvas = document.createElement("canvas");
  finCanvas.width = fs * fin.length;
  finCanvas.height = fs;
  {
    const c = finCanvas.getContext("2d", { willReadFrequently: true });
    fin.forEach((f, i) => c.drawImage(f, i * fs, 0));
  }
  const tFinish = layersFrom(finCanvas, fin.length, 1, fs, fs);
  tFinish.wrapS = tFinish.wrapT = THREE.RepeatWrapping;
  tFinish.anisotropy = aniso;
  const win = drawWindows(), ws = win.width, tWin = layersFrom(win, 1, 40, ws, ws, { premultiply: true }), tWinM = layersFrom(win.glassMask, 1, 40, ws, ws, { red: true });
  for (const t of [tWin, tWinM]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso;
  }
  const signs = drawSigns(), hw = signs.horizontal.width / 4, hh = signs.horizontal.height / 8, tSign = layersFrom(signs.horizontal, 4, 8, hw, hh), vw = signs.vertical.width / 16, tVSign = layersFrom(signs.vertical, 16, 1, vw, signs.vertical.height);
  for (const t of [tSign, tVSign]) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso;
  }
  const lin = (hex) => new THREE.Color(hex);
  const uniforms = {
    tFinish: { value: tFinish },
    tWin: { value: tWin },
    tWinM: { value: tWinM },
    tSign: { value: tSign },
    tVSign: { value: tVSign },
    uNight: { value: 0 },
    uDetail: { value: 1 },
    uShutters: { value: SHUTTERS.map(lin) },
    uCages: { value: CAGES.map(lin) },
    uCvsPal: { value: CVS_PAL_NAMES.map((n) => lin(CVS_PAL[n])) },
    uCvsBrand: { value: cvsBrandOn() ? 1 : 0 }
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
attribute vec4 aSV; attribute vec4 aLv; attribute vec4 aHs; attribute vec4 aRn; attribute vec3 aCol; attribute vec3 aTnt;
varying vec4 vSV; varying vec4 vLv; varying vec4 vHs; varying vec4 vRn; varying vec3 vCol; varying vec3 vTnt;`).replace("#include <begin_vertex>", `#include <begin_vertex>
vSV = aSV; vLv = aLv; vHs = aHs; vRn = aRn; vCol = aCol; vTnt = aTnt;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
uniform highp sampler2DArray tFinish; uniform highp sampler2DArray tWin; uniform highp sampler2DArray tWinM; uniform highp sampler2DArray tSign; uniform highp sampler2DArray tVSign;
uniform float uNight; uniform float uDetail; uniform vec3 uShutters[6]; uniform vec3 uCages[7]; uniform vec3 uCvsPal[${CVS_PAL_NAMES.length}]; uniform float uCvsBrand;
varying vec4 vSV; varying vec4 vLv; varying vec4 vHs; varying vec4 vRn; varying vec3 vCol; varying vec3 vTnt;
float twH3(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float twN2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); float a = twH3(vec3(i, 1.)), b = twH3(vec3(i + vec2(1., 0.), 1.)), c = twH3(vec3(i + vec2(0., 1.), 1.)), d = twH3(vec3(i + 1., 1.)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
bool twBit(float flags, float b){ return mod(floor(flags / b), 2.) > .5; }
${cvsBandGLSL()}
// 鐵窗尺寸（寬、高、窗台高）：照 city-details.js 的 CAGE 表
vec3 twCage(float t){ if (t < .5) return vec3(2.2, 1.4, .9); if (abs(t - 2.) < .5) return vec3(3.4, 1.4, .9); if (abs(t - 5.) < .5) return vec3(2.4, 1.2, 1.); if (abs(t - 7.) < .5) return vec3(2.4, 1.3, .9); if (abs(t - 8.) < .5) return vec3(3., 1.4, .9); if (abs(t - 12.) < .5) return vec3(1.6, 1.2, 1.); if (abs(t - 14.) < .5) return vec3(2.4, 1.4, 1.); return vec3(0.); }
void twFacade(out vec3 col, out float rough, out float metal, out vec3 emis) {
  float part = floor(vHs.x + .5); vec3 base = vCol; emis = vec3(0.); metal = 0.; rough = .9;
  if (part > 3.5) {
    float layer = floor(vHs.y + .5);
    if (part < 4.5) { col = texture(tFinish, vec3(vSV.xy, 7.)).rgb * base * 1.12; rough = .5; metal = .3; }
    else if (part < 5.5) { float n = twN2(vSV.xy * .9) * .6 + twN2(vSV.xy * 4.) * .4; col = base * mix(.78, 1.06, n); rough = .93; }
    else if (part < 6.5) { float row = fract(vSV.y * 3.3), colm = fract(vSV.x * 9.); col = base * mix(.7, 1.08, smoothstep(0., .3, row)) * mix(.9, 1., smoothstep(0., .2, colm)); rough = .72; }
    else if (part < 7.5) { col = base; rough = .85; }
    else if (part < 8.5) { col = base; metal = .92; rough = .24; }
    else if (part < 9.5) { vec3 t = texture(tSign, vec3(vSV.x, 1. - vSV.y, layer)).rgb; col = t; rough = .45; emis = t * uNight * 1.4; }
    else { vec3 t = texture(tVSign, vec3(vSV.x, 1. - vSV.y, layer)).rgb; col = t; rough = .45; emis = t * uNight * 1.4; }
    return;
  }
  float s = vSV.x, v = vSV.y, bays = vSV.z, len = vSV.w, F = vLv.x, gh = vLv.y, uh = vLv.z, top = vLv.w;
  float finish = floor(vHs.y + .5), win = floor(vHs.z + .5), flags = vHs.w;
  col = texture(tFinish, vec3(s / 4.4, v / 3.3, finish)).rgb * base * 1.12;
  rough = finish < .5 ? .5 : finish < 1.5 ? .58 : .9;
  // 牆腳的髒污、女兒牆下的雨水痕：貼圖以外的大尺度深淺
  col *= mix(.78, 1., smoothstep(-.3, 1.8, v)) * mix(.93, 1., smoothstep(0., .9, abs(top - v)));
  if (uDetail < .5 || v >= top || v < 0. || bays < .5) return;
  float bw = len / bays, sj = s / bw, j = min(floor(sj), bays - 1.), cu = sj - j, k = 0., z0 = 0., fh = F < 1.5 ? top : gh;
  if (F > 1.5 && v >= gh) { k = min(1. + floor((v - gh) / uh), F - 1.); z0 = gh + (k - 1.) * uh; fh = uh; }
  float cv = clamp((v - z0) / fh, 0., 1.), seed = vRn.x * 911.;
  vec2 g = vec2(sj, v / fh), gx = dFdx(g), gy = dFdy(g);
  float r = twH3(vec3(j, k, seed)), rb = twH3(vec3(j, 91., seed)), rb2 = twH3(vec3(j, 47., seed)), r3 = twH3(vec3(j + 13., k, seed));
  bool side = abs(part - 2.) < .5, back = abs(part - 3.) < .5, commercial = part < .5;
  bool fCage = twBit(flags, 1.), fBands = twBit(flags, 2.), fAc = twBit(flags, 4.), fSchool = twBit(flags, 8.), fCivic = twBit(flags, 16.), fTemple = twBit(flags, 32.), fWood = twBit(flags, 64.), fHall = twBit(flags, 128.), fTall = twBit(flags, 256.), fSchoolFront = twBit(flags, 1024.), fSignEdge = twBit(flags, 2048.), fQuiet = twBit(flags, 4096.), fLobby = twBit(flags, 8192.);
  float layer = -1., type = -1.; vec3 tint = vec3(1.);
  // 每格畫哪一款：照 city-details.js 的規則（側牆少窗、背面小窗與管線、一樓店面／鐵捲門／住家門、樓上本戶窗型、少數改陽台外推）
  if (fTemple) { layer = (!side && !back && k < .5 && fSignEdge && abs(j - floor(bays * .5)) < .5) ? 34. : 35.; }
  else if (side) { if (k > .5 && r < (fSchool ? .5 : .25) && !fCivic) layer = r < .12 ? 26. : 27.; }
  else if (back) { if (fSchool) { if (k > .5) { layer = 11.; tint = vTnt; } } else if (r < .6) { float q = floor(r / .12); layer = q < .5 ? 26. : q < 1.5 ? 28. : q < 2.5 ? 29. : q < 3.5 ? 30. : 31.; } }
  else if (k < .5) {
    if (fSchool) layer = fSchoolFront ? 32. : 11.;
    else if (fCivic) { float gc = vRn.w, pA = floor(gc / 4096.), gB = floor(mod(gc, 4096.) / 64.), gA = mod(gc, 64.); layer = rb * 10. < pA ? gA : gB; }
    else if (fWood && !commercial) layer = 38.;
    else { float gt, t = rb * 10.4;
      // 第 111 包（旗標只在有店面判定檔時才會設）：quiet＝停車場、公園旁小建物、機關學校等一定不是店面的，一樓畫鐵捲門、半開的車庫口或素牆（-1）；
      //   lobby＝七層以上公寓沒店的一樓，畫大廳（第 7、6 款玻璃）、停車場鐵捲門或素牆。都用圖集原有的一樓款式，不新增貼圖。
      if (fQuiet && !commercial) gt = rb < .45 ? 0. : rb < .6 ? 5. : -1.;
      else if (fHall) gt = commercial ? 2. : 7.;
      else if (commercial) gt = t < 1.2 ? 0. : t < 2. ? 1. : t < 4. ? 2. : t < 6.5 ? 3. : t < 7.3 ? 4. : t < 7.7 ? 5. : t < 9.2 ? 6. : 7.;
      else if (fLobby) gt = rb < .4 ? 7. : rb < .55 ? 6. : rb < .7 ? 0. : -1.;
      else gt = rb < .5 ? 4. : rb < .7 ? 0. : rb < .9 ? 5. : 1.;
      layer = gt < -.5 ? -1. : 16. + gt; if (gt > -.5 && (gt < 1.5 || abs(gt - 5.) < .5)) tint = uShutters[int(min(rb2 * 6., 5.))]; }
  } else {
    type = win;
    if (fSchool) { if (fSchoolFront) layer = 32.; else type = 11.; }
    if (layer < 0.) { if (!fCivic && !fWood && !fHall && !fTall && r > .8) type = r > .9 ? 3. : floor(vRn.z + .5); layer = type; tint = vTnt; }
  }
  float glass = 0.;
  if (layer > -.5) {
    vec3 tc = vec3(cu, 1. - cv, layer); vec2 dx = vec2(gx.x, -gx.y), dy = vec2(gy.x, -gy.y);
    vec4 w = textureGrad(tWin, tc, dx, dy);
    col = col * (1. - w.a) + w.rgb * tint * 1.12;
    float lum = dot(w.rgb, vec3(.3, .59, .11)) / max(w.a, .05);
    glass = textureGrad(tWinM, tc, dx, dy).r * w.a * (1. - smoothstep(.45, .75, lum));
  }
  // 鐵窗：圖集第 24 格的鐵窗網，罩在窗外（原本只畫最近 24～40 棟）
  if (fCage && k > .5 && type > -.5 && !side && !back) { vec3 cg = twCage(type);
    if (cg.x > 0.) { float w = min(bw - .3, (cg.x + .3) * bw / 4.4) / bw, za = (cg.z - .15) / 3.2, zb = za + (cg.y + .3) / 3.2; vec2 q = vec2((cu - .5) / w + .5, (cv - za) / (zb - za));
      if (q.x > 0. && q.x < 1. && q.y > 0. && q.y < 1.) { vec4 c = textureGrad(tWin, vec3(q.x, 1. - q.y, 24.), vec2(gx.x / w, -gx.y / (zb - za)), vec2(gy.x / w, -gy.y / (zb - za)));
        col = col * (1. - c.a) * .86 + c.rgb * uCages[int(clamp(vRn.y, 0., 6.) + .5)]; glass *= 1. - c.a * .8; } } }
  float px = max(fwidth(s), fwidth(v));
  // 冷氣：窗邊外掛的窗型機（原本只畫最近的幾十棟）
  if (fAc && k > .5 && layer > -.5 && abs(layer - 10.) > .5 && abs(layer - 11.) > .5 && r3 < .45 && !side && !back && !(fCivic && k < 1.5)) {
    float ax = (cu - (.5 + (twH3(vec3(j, k + 7., seed)) < .5 ? -.36 : .36))) * bw, ay = cv * fh - .45; vec2 d = abs(vec2(ax, ay)) - vec2(.4, .275);
    float body = 1. - smoothstep(-px, px, max(d.x, d.y)), sh = (1. - smoothstep(0., .35, -ay - .275)) * step(-.275, -ay) * (1. - smoothstep(.4, .5, abs(ax))) * step(ay, -.275);
    col *= 1. - .3 * sh * (1. - body);
    vec3 ac = vec3(.80, .80, .77) * mix(1., .72, 1. - smoothstep(.13, .17, length(vec2(ax + .14, ay)))) * mix(.9, 1., step(.02, fract(ay * 12.)));
    col = mix(col, ac, body); glass *= 1. - body; }
  // 樓層飾帶
  if (fBands && k > .5 && !side) { float dz = v - z0, bb = max(1. - smoothstep(.08 - px, .08 + px, dz), k < F - 1.5 ? 1. - smoothstep(.08 - px, .08 + px, fh - dz) : 0.);
    col = mix(col, (fSchool || fCivic) ? vec3(.86, .85, .8) : base * .86, bb); glass *= 1. - bb; }
  // 玻璃：反射天空；夜裡每格亂數亮燈（一樓店面亮得多）
  float lit = step(twH3(vec3(j + 5., k + 3., seed)), (k < .5 && commercial) ? .8 : .4);
  col = mix(col, col * mix(.55, 1., lit * uNight), glass * .6);
  rough = mix(rough, .09, glass); metal = mix(0., .6, glass);
  emis = glass * lit * uNight * mix(vec3(1., .74, .42), vec3(.85, .9, 1.), step(.8, twH3(vec3(j, k, seed + 3.)))) * 1.5;
}
  // 第 150 包：超商門面（只有 shopfronts.json 帶品牌碼的開間，碼在 vRn.w：品牌 1～5＋16×(開間數−1)＋64×起始開間）。整段開間畫成：兩側牆柱、腳下矮牆、整面落地玻璃（窗框、一組自動門）、
  //   上面一條招牌色帶（條紋照 shared/cvs-look.mjs，沒有字也沒有標誌）。白天玻璃反天空、隱約看得到貨架；夜裡店內白光與色帶自己發光（24 小時營業，不看亂數亮燈）。
  //   uCvsBrand＝0 時一律當 generic（白色色帶）。這一段只在碼大於 0、一樓、臨路店面牆時才走，其他像素不受影響。
// （獨立成一個函式、在 twFacade 之後才呼叫：這樣沒有超商的像素連 twFacade 本身的編譯結果都跟改前一樣，改前改後逐像素 0 px。）
void twCvs(inout vec3 col, inout float rough, inout float metal, inout vec3 emis) {
  float s = vSV.x, v = vSV.y, bays = vSV.z, len = vSV.w, F = vLv.x, gh = vLv.y, bw = len / bays, k = (F > 1.5 && v >= gh) ? 1. : 0.;
  bool commercial = floor(vHs.x + .5) < .5, fCivic = twBit(vHs.w, 16.);
  float px = max(fwidth(s), fwidth(v));
  if (vRn.w > .5 && k < .5 && commercial && !fCivic) {
    float cw = vRn.w, cb = mod(cw, 16.), cn = floor(mod(cw / 16., 4.)) + 1., cj0 = floor(cw / 64.);
    if (uCvsBrand < .5) cb = 5.;
    float CW = cn * bw, x = s - cj0 * bw, y = v, aa = max(px, .004);
    float bandH = clamp(gh * .27, .7, 1.05), by1 = gh - .1, by0 = by1 - bandH, gTop = by0 - .05;
    float sd9 = vRn.x * 911., r0 = twH3(vec3(cj0, 3., sd9)), np = max(2., floor(CW / 2.1 + .5)), pw = (CW - .4) / np, di = 1. + floor(r0 * (np - 1.) * .999);
    float gxl = x - .2, pI = clamp(floor(gxl / pw), 0., np - 1.), lx = gxl - pI * pw, isDoor = step(di - 1.5, pI) * step(pI, di + .5), gB = mix(.4, .06, isDoor);
    float mx = min(lx, pw - lx), fwid = mix(.022, .04, isDoor);
    float frV = 1. - smoothstep(fwid - aa, fwid + aa, mx), frH = max(1. - smoothstep(.03 - aa, .03 + aa, y - gB), 1. - smoothstep(.03 - aa, .03 + aa, gTop - y));
    float bar = isDoor * step(.88, y) * step(y, 1.32) * (1. - smoothstep(.014 - aa, .014 + aa, abs(abs(gxl - di * pw) - .14)));
    float fr = max(max(frV, frH), bar);
    // 店內：暖白牆與天花、貨架（過道留空）、貨品色塊、天花燈帶
    vec2 sc = vec2(x * 2.6, y * 4.2); vec2 ci = floor(sc); float hp = twH3(vec3(ci, sd9 + 9.));
    vec3 prod = hp < .25 ? vec3(.80, .22, .18) : hp < .5 ? vec3(.20, .45, .80) : hp < .72 ? vec3(.90, .78, .25) : hp < .88 ? vec3(.25, .62, .35) : vec3(.9, .9, .88);
    float shelf = step(.55, y) * step(y, 1.85) * step(.14, fract(x / 1.35)) * smoothstep(.1, .2, fract(sc.x)) * smoothstep(.1, .2, fract(sc.y));
    vec3 inner = mix(vec3(.86, .84, .78), prod * .85 + .1, shelf * .7);
    inner = mix(inner, vec3(1.), smoothstep(gTop - .3, gTop, y)) * mix(.8, 1., smoothstep(gB, gB + .9, y));
    float wG = smoothstep(.2 - aa, .2 + aa, x) * (1. - smoothstep(CW - .2 - aa, CW - .2 + aa, x)) * smoothstep(gB - aa, gB + aa, y) * (1. - smoothstep(gTop - aa, gTop + aa, y));
    float wB = smoothstep(by0 - aa, by0 + aa, y) * (1. - smoothstep(by1 - aa, by1 + aa, y));
    float wK = 1. - smoothstep(.4 - aa, .4 + aa, y);
    // 色帶：由上往下的條紋；一個像素蓋過好幾條時（遠）用七點平均
    float bt = clamp((by1 - y) / bandH, 0., 1.); vec3 bc = twCvsBand(cb, bt);
    float bf = smoothstep(.03, .12, aa);
    if (bf > .001) { vec3 av = vec3(0.); for (int q = 0; q < 7; q++) av += twCvsBand(cb, (float(q) + .5) / 7.); bc = mix(bc, av / 7., bf); }
    vec3 wall = col; col = mix(wall, wall * .78, wK * (1. - wG)); rough = mix(rough, .8, wK);
    vec3 gl = mix(vec3(.30, .38, .46), inner * .45, .55);
    col = mix(col, mix(gl, vec3(.55, .57, .58), fr), wG);
    rough = mix(rough, mix(.12, .45, fr), wG); metal = mix(0., mix(.35, .8, fr), wG);
    col = mix(col, bc, wB); rough = mix(rough, .5, wB); metal = mix(metal, 0., wB);
    emis = (wG * (1. - fr) * inner * vec3(1., .97, .9) * .95 + wB * bc * .95) * uNight;
  }
}`).replace("#include <map_fragment>", `vec3 twCol; float twRough; float twMetal; vec3 twEmis; twFacade(twCol, twRough, twMetal, twEmis); twCvs(twCol, twRough, twMetal, twEmis); diffuseColor.rgb = twCol;`).replace("#include <roughnessmap_fragment>", "float roughnessFactor = twRough;").replace("#include <metalnessmap_fragment>", "float metalnessFactor = twMetal;").replace("#include <emissivemap_fragment>", "totalEmissiveRadiance += twEmis;");
    if (TW2.arcade || TW2.cage) shader.fragmentShader = tw2Facade(shader.fragmentShader);
  };
  if (glass) {
    const ob = material.onBeforeCompile, from = "rough = mix(rough, .09, glass); metal = mix(0., .6, glass);";
    material.onBeforeCompile = (sh) => {
      ob(sh);
      if (!sh.fragmentShader.includes(from)) throw Error("玻璃那一行對不上");
      sh.fragmentShader = sh.fragmentShader.replace(from, glass === 1 ? "rough = mix(rough, .09, glass); metal = 0.;" : "if (abs(layer - 10.) < .5) col = mix(col, vec3(.30, .37, .42), glass);\n  " + from);
    };
  }
  if (pane && !glass) {
    const ob = material.onBeforeCompile, from = "col = mix(col, col * mix(.55, 1., lit * uNight), glass * .6);\n  rough = mix(rough, .09, glass); metal = mix(0., .6, glass);";
    material.onBeforeCompile = (sh) => {
      ob(sh);
      let f = sh.fragmentShader;
      const need = (a, b) => {
        if (!f.includes(a)) throw Error("玻璃那一段對不上（第 21 包）：" + a.slice(0, 50));
        f = f.replace(a, b);
      };
      need("bool twBit(float flags, float b){", "vec3 twPN = vec3(0.);\nbool twBit(float flags, float b){");
      need(from, `float cw = 1. - step(.5, abs(layer - 10.));
  vec3 gBody = mix(vec3(.20, .29, .36), base * 1.3, .4), gIn = mix(col * mix(.5, .62, cw), gBody, mix(.25, .75, cw));
  col = mix(col, gIn, glass);
  rough = mix(rough, mix(.16, .07, cw), glass); metal = mix(0., mix(.25, .55, cw), glass);
  twPN = vec3(twH3(vec3(j * 2. + floor(cu * 2.) * cw, k, seed + 7.)) - .5, twH3(vec3(j, k + 31., seed)) - .5, glass * (1. - smoothstep(bw * .05, bw * .14, px)) * mix(.6, 1., cw));`);
      if (pane !== "color") need("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  if (twPN.z > .001) { vec3 upV = normalize(mat3(viewMatrix) * vec3(0., 1., 0.)), tV = cross(upV, normal); float tl = length(tV); if (tl > .1) normal = normalize(normal + (tV / tl * twPN.x * .16 + upV * twPN.y * .18) * twPN.z); }`);
      sh.fragmentShader = f;
    };
  }
  if (nwin) {
    const ob = material.onBeforeCompile, B = `  emis = glass * lit * uNight * mix(vec3(1., .74, .42), vec3(.85, .9, 1.), step(.8, twH3(vec3(j, k, seed + 3.)))) * 1.5;`;
    material.onBeforeCompile = (sh) => {
      ob(sh);
      if (!(uniforms.uNight.value > 0)) return;
      if (!sh.fragmentShader.includes(B)) throw Error("亮窗那一行對不上（第 64 包）");
      sh.fragmentShader = sh.fragmentShader.replace(B, B + `
  if (uNight > 0.) {
    // 第 64 包（nwin）：亮燈率依建物類型（住宅 .2、七層以上 .22、一樓店面 .75、學校與機關 .07、廠房 .1、廟 .5、木造 .16）；
    //   帷幕大樓（窗型 10）整層一起亮或暗（一半的樓層亮、亮的那層八成五的窗亮）；每格亮度不同、暖色為主（帷幕冷白多一點）、窗內上亮下暗；
    //   遠了照每格在畫面上的大小退成「樓層亮帶」（每層一個亮燈比例）、再退成整面平均，不會變成黑白雜訊。白天不走這一段（原本那一行算出來是 0）。
    // 第 152 包：辦公（帷幕窗型 10，以及 hall 型八層以上）改成逐窗亮——每層抽一個亮燈比例 pF（.25～.6；8% 的樓層全暗），
    //   帷幕的一個開間再切成 1～4 格（約 1.8 m 一格）各自抽亮不亮；中距離的亮帶＝pF×每個「開間×樓層」的變化（.55～1.45），
    //   遠處＝pF 的期望值 .39（.92×.425），三段的平均亮度一樣。顏色以暖白為主（冷白兩成），強度比住宅的亮窗低。
    bool curtain = abs(win - 10.) < .5, office = (curtain || (fHall && F > 7.5)) && k > .5;
    //   第 152 包（街道層級太黑，超商成了唯一的亮點）：住宅亮燈率 .2→.28、七層以上 .22→.3，住宅亮窗強度 ×1→×1.25。
    float rate = (k < .5 && commercial) ? .75 : (fSchool || fCivic) ? .07 : fHall ? .1 : fTemple ? .5 : fWood ? .16 : fTall ? .3 : .28;
    float hw = twH3(vec3(j + 5., k + 3., seed)), hf = twH3(vec3(k, 7., seed));
    float pF = step(.08, twH3(vec3(k, 19., seed))) * (.25 + .35 * hf), nsub = curtain ? clamp(floor(bw / 1.8 + .5), 1., 4.) : 1., csub = cu * nsub, sub = min(floor(csub), nsub - 1.);
    float nLit = office ? step(twH3(vec3(j * 4. + sub + 5., k + 3., seed)), pF) * mix(1., smoothstep(0., .07, fract(csub)) * smoothstep(0., .07, 1. - fract(csub)), step(1.5, nsub)) : step(hw, rate);
    float cellPx = px / max(min(bw, fh), .5), a1 = smoothstep(.15, .35, cellPx), a2 = smoothstep(.4, .9, cellPx);
    float bandF = office ? min(pF * mix(.55, 1.45, twH3(vec3(j, k + 23., seed))), 1.) : clamp(rate * (.4 + 1.2 * hf), 0., 1.), avgF = office ? .39 : rate;
    float litL = mix(mix(nLit * mix(.45, 1.15, twH3(vec3(office ? j * 4. + sub : j, k + 11., seed))) * (${nroom ? "1." : "mix(.75, 1.15, cv)"}), bandF * .8, a1), avgF * .8, a2);

    // 第 64 包（nroom）：亮窗後面的假立體房間＋窗簾（只在近景、亮的窗算）：視線打進「開間寬 × 層高 × 深 .8 開間」的盒子，
    //   看打到後牆、側牆、天花板或地板給不同亮度（天花板最亮、地板最暗），三成八的窗有半拉的窗簾。遠了（a1→1）退回平塗。
    float roomL = 1.;
    if (${nroom ? "true" : "false"} && nLit * glass > .01 && a1 < .99) {
      vec3 Pv = -vViewPosition, dPx = dFdx(Pv), dPy = dFdy(Pv), Nw = normalize(cross(dPx, dPy)); if (dot(Nw, Pv) > 0.) Nw = -Nw;
      vec3 Ts = cross(dPy, Nw) * dFdx(s) + cross(Nw, dPx) * dFdy(s); float tl = length(Ts);
      vec3 Up = normalize(mat3(viewMatrix) * vec3(0., 1., 0.)); Up = normalize(Up - Nw * dot(Up, Nw));
      if (tl > 1e-6) { Ts /= tl; vec3 rd = normalize(Pv); vec3 r = vec3(dot(rd, Ts), dot(rd, Up), -dot(rd, Nw));
        float D = min(.8 * bw, 4.), hx = bw * .5, hy = fh * .5; vec2 p0 = vec2((cu - .5) * bw, (cv - .5) * fh);
        float tx = (sign(r.x) * hx - p0.x) / (abs(r.x) > 1e-4 ? r.x : 1e-4), ty = (sign(r.y) * hy - p0.y) / (abs(r.y) > 1e-4 ? r.y : 1e-4), tz = D / max(r.z, 1e-3);
        float t = min(min(tx, ty), tz), dep = clamp(t * r.z / D, 0., 1.);
        roomL = t == tz ? .95 : t == ty ? (r.y > 0. ? 1.7 : .45) : .7;
        roomL *= mix(1.1, .75, dep);
        float cur = twH3(vec3(j + 3., k + 17., seed)); if (cur < .38) { float cy = mix(.35, .85, fract(cur * 7.3)); if (cv > cy) roomL = mix(roomL, 1.05, .85); } }
      roomL = mix(roomL, 1., a1); }
    // 第 169 包：燈色分暖黃、中性白、晝光白三類，比例照建物類型（WIN_MIX，類型的判斷順序同 rate）；同一戶同色——住宅、學校機關、廠房、廟、木造是「同一層相鄰兩個開間」，
    //   辦公是「同一層相鄰四個開間」，一樓店面是「一個開間」（一間店）。三種色亮度一樣（＝改前該類的平均），遠了（a1）退成比例加權的平均色，近中遠平均一樣。
    vec3 mixP = office ? ${g3(WIN_MIX.office)} : (k < .5 && commercial) ? ${g3(WIN_MIX.shop)} : (fSchool || fCivic) ? ${g3(WIN_MIX.school)} : fHall ? ${g3(WIN_MIX.hall)} : fTemple ? ${g3(WIN_MIX.temple)} : fWood ? ${g3(WIN_MIX.wood)} : ${g3(WIN_MIX.res)};
    float hu = twH3(vec3(office ? floor(j * .25) : (k < .5 && commercial) ? j : floor(j * .5), k, seed + 3.));
    vec3 cW = ${WIN_C1[0]}, cN = ${WIN_C1[1]}, cD = ${WIN_C1[2]};
    vec3 litC = mix(hu < mixP.x ? cW : hu < mixP.x + mixP.y ? cN : cD, mixP.x * cW + mixP.y * cN + mixP.z * cD, a1) * (office ? ${WIN_Y.office.toFixed(5)} : ${WIN_Y.res.toFixed(5)});
    emis = glass * litL * roomL * uNight * litC * .6;
    // 第 152 包：路燈照到的牆腳與騎樓——離地 2 m 以下全量、9 m 以上沒有，牆色×暖白 (1,.8,.6)×.07（不看亮窗，每棟都有）
    emis += col * vec3(1., .8, .6) * .07 * (1. - smoothstep(2., 9., v)) * uNight; }`);
    };
  }
  if (fx) {
    const ob = material.onBeforeCompile;
    material.onBeforeCompile = (sh) => {
      ob(sh);
      let f = sh.fragmentShader;
      const need = (x, y) => {
        if (!f.includes(x)) throw Error("第 79 包對不上：" + x.slice(0, 50));
        f = f.replace(x, y);
      };
      need("rough = finish < .5 ? .5 : finish < 1.5 ? .58 : .9;", "rough = finish < .5 ? .7 : finish < 1.5 ? .76 : .92;");
      if (fx !== "lite") need("col *= mix(.78, 1., smoothstep(-.3, 1.8, v)) * mix(.93, 1., smoothstep(0., .9, abs(top - v)));", `col *= mix(.78, 1., smoothstep(-.3, 1.8, v)) * mix(.93, 1., smoothstep(0., .9, abs(top - v)));
  { float sd = vRn.x * 911., wood = twBit(vHs.w, 64.) ? .5 : 1.;
    float streak = twN2(vec2(s * 1.1 + sd, v * .045)) * twN2(vec2(s * .23, sd * .5)), grime = twN2(vec2(s * .13, v * .16) + sd);
    col *= 1. - wood * (.45 * streak * smoothstep(top + 1., top - 16., v) + .16 * grime);
    col *= .93 + .14 * twN2(vec2(s * .42 + sd, v * .38)); }`);
      sh.fragmentShader = f;
    };
  }
  material.customProgramCacheKey = () => "tw-facade-1" + (pane && !glass ? "-pane" + (pane === "color" ? "c" : "") : "") + (nwin ? uniforms.uNight.value > 0 ? "-n64n" + (nroom ? "r" : "") : "-n64d" : "") + (fx ? "-p79" + (fx === "lite" ? "l" : "") : "");
  return { material, uniforms, textures: { tFinish, tWin, tWinM, tSign, tVSign }, cell: ws };
}
export function facadeGeometry(array, stride = 28) {
  const g = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(array, stride), A = (name, size, offset) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, size, offset));
  A("position", 3, 0);
  A("normal", 3, 3);
  A("aSV", 4, 6);
  A("aLv", 4, 10);
  A("aHs", 4, 14);
  A("aRn", 4, 18);
  A("aCol", 3, 22);
  A("aTnt", 3, 25);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
function tw2Facade(fs) {
  const need = (a, b) => {
    if (!fs.includes(a)) throw Error("tw2 立面對不上：" + a.slice(0, 50));
    fs = fs.replace(a, b);
  };
  const geo = TW2.cage && TW2.num("cageGeo", 0) > 0, f = (x) => (+x).toFixed(3);
  if (TW2.arcade) need("  // 玻璃：反射天空；夜裡每格亂數亮燈（一樓店面亮得多）\n", `  if (vRn.y > 14.5) col *= mix(.86, .58, smoothstep(0., gh, v));
  // 玻璃：反射天空；夜裡每格亂數亮燈（一樓店面亮得多）
`);
  if (geo) need("    else { vec3 t = texture(tVSign,", `    else if (part > 10.5) { vec4 c = texture(tWin, vec3(vSV.x, 1. - vSV.y, 24.)); col = base * .2 * (1. - c.a) + c.rgb * base; rough = .6; }
    else { vec3 t = texture(tVSign,`);
  if (TW2.cage && !geo) {
    need("  // 鐵窗：圖集第 24 格的鐵窗網，罩在窗外（原本只畫最近 24～40 棟）\n", `  vec3 cgP = -vViewPosition, cgDx = dFdx(cgP), cgDy = dFdy(cgP); float cgSx = dFdx(s), cgSy = dFdy(s), cgVx = dFdx(v), cgVy = dFdy(v);
  // 鐵窗：圖集第 24 格的鐵窗網，罩在窗外（原本只畫最近 24～40 棟）
`);
    need(
      `if (cg.x > 0.) { float w = min(bw - .3, (cg.x + .3) * bw / 4.4) / bw, za = (cg.z - .15) / 3.2, zb = za + (cg.y + .3) / 3.2; vec2 q = vec2((cu - .5) / w + .5, (cv - za) / (zb - za));`,
      `if (cg.x > 0.) { float w = min(bw - .3, (cg.x + .3) * bw / 4.4) / bw, za = (cg.z - .15) / 3.2, zb = za + (cg.y + .3) / 3.2;
      float wm = w * bw, sa = (j + .5) * bw - wm * .5, sb = sa + wm, va = z0 + za * fh, vb = z0 + zb * fh, det = cgSx * cgVy - cgSy * cgVx;
      vec3 cT = (cgDx * cgVy - cgDy * cgVx) / det, cB = (cgDy * cgSx - cgDx * cgSy) / det, cV = normalize(vViewPosition); float vn = dot(cV, normalize(cross(cT, cB)));
      vec2 o = abs(det) > 1e-12 && vn > .08 ? clamp(${f(TW2.num("cageD", 0.5))} * vec2(dot(cV, cT), dot(cV, cB)) / vn, vec2(-.9, -.7), vec2(.9, .7)) : vec2(0.);
      vec3 cc = uCages[int(clamp(vRn.y, 0., 6.) + .5)];
      float bx = step(sa, s) * step(s, sb); col *= 1. - .3 * bx * step(va, v) * step(v, vb); col *= 1. - .35 * bx * step(v, va) * (1. - smoothstep(0., .35, va - v));
      float ts = abs(o.x) > 1e-4 ? ((o.x > 0. ? sb : sa) - s) / o.x : -1., vs = v + ts * o.y;
      if (ts > 0. && ts < 1. && vs > va && vs < vb) { col = mix(col * .8, cc * .5, .65); glass = 0.; }
      float tb = abs(o.y) > 1e-4 ? (va - v) / o.y : -1., xb = s + tb * o.x;
      if (tb > 0. && tb < 1. && xb > sa && xb < sb) { col = vec3(.42, .42, .4) * (o.y > 0. ? 1. : .5); glass = 0.; }
      float tt = abs(o.y) > 1e-4 ? (vb - v) / o.y : -1., xt = s + tt * o.x;
      if (tt > 0. && tt < 1. && xt > sa && xt < sb) { col = vec3(.5, .51, .5) * (o.y > 0. ? 1. : .45); glass = 0.; }
      vec2 q = vec2((cu + o.x / bw - .5) / w + .5, (cv + o.y / fh - za) / (zb - za));`
    );
    need("col = col * (1. - c.a) * .86 + c.rgb * uCages[int(clamp(vRn.y, 0., 6.) + .5)];", "col = col * (1. - c.a) * .86 + c.rgb * cc;");
  }
  return fs;
}
