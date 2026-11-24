import { TW2 } from "./tw2.mjs";
import { ST, STM, ST_CAND } from "./tw2-roof.mjs";
export const FX3_ALL = ["roof", "facade", "ground", "glass", "far", "land"];
export const FX3_CHEAP = ["roof", "facade", "glass", "far"];
export function parseFx3(params, coarse) {
  const v = params.get("fx3"), F = {};
  const on = v === "0" ? [] : !v ? coarse ? [] : FX3_ALL : v === "1" ? coarse ? FX3_CHEAP : FX3_ALL : v.split(",");
  for (const k of FX3_ALL) F[k] = on.includes(k);
  F.any = on.length > 0;
  F.key = on.length ? "-fx3" + FX3_ALL.filter((k) => F[k]).map((k) => k === "far" ? "fr" : k[0] + k[1]).join("") : "";
  F.worker = (F.roof ? 1 : 0) | (F.facade ? 2 : 0);
  F.farW = F.far ? 1 | (F.roof ? 2 : 0) : 0;
  const T = { fr: 0.7, fw: 0.7, gl: 0.4, cw: 0.82 };
  for (const k of Object.keys(T)) if (params.has("x3" + k)) T[k] = +params.get("x3" + k);
  F.T = T;
  F.sun = { value: { x: 0, y: 1, z: 0 } };
  return F;
}
const ROOF_GLSL = `
uniform vec3 uSun3;
float r3H(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float r3N(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(r3H(i), r3H(i + vec2(1., 0.)), f.x), mix(r3H(i + vec2(0., 1.)), r3H(i + 1.), f.x), f.y); }
float r3Box(vec2 p, vec2 c, vec2 h){ vec2 d = abs(p - c) - h; return max(d.x, d.y); }
// 一個屋頂物件：頂面遮罩、影子遮罩（沿太陽方向掃過的盒子）。tS＝每公尺高度的影子位移（本地座標，朝向太陽）
vec2 r3Obj(vec2 p, vec2 c, vec2 h, float ht, vec2 tS, float aa){ vec2 o = tS * ht * .5; float top = 1. - smoothstep(-aa, aa, r3Box(p, c, h));
  float sh = 1. - smoothstep(-aa, aa, r3Box(p + o, c, h + abs(o))); return vec2(top, sh * (1. - top)); }
vec3 twRoof3(vec3 base, vec2 p, float L, float W, float code, float sd, float ang, float px, inout float rough){
  vec2 ca = vec2(cos(ang), sin(ang)), sw = vec2(uSun3.x, -uSun3.z), sl = vec2(dot(sw, ca), dot(sw, vec2(-ca.y, ca.x)));
  vec2 tS = sl / max(uSun3.y, .25); float dayK = smoothstep(-.02, .15, uSun3.y);
  float aa = max(px * .7, .02), fine = 1. - smoothstep(.04, .12, px), mid = 1. - smoothstep(.2, .7, px);
  float e = min(L - abs(p.x), W - abs(p.y));
  bool red = base.r > base.g * 1.22, grn = base.g > base.r * 1.06 && base.g >= base.b;
  // 第 117 包：補丁的尺度、數量、對比跟著屋頂大小走——大屋頂（學校、賣場、廠辦）多半整片同色，只有幾條沿長邊的長條補修（不再是 5 m 一格的迷彩）
  float big = smoothstep(250., 1400., 4. * L * W); vec2 pc = mix(vec2(5.5), vec2(max(L * .55, 8.), 3.2), big);
  vec3 c = base * (.8 + .38 * r3H(vec2(sd * 61., 1.))) * mix(vec3(1.), vec3(1.06, 1., .92), r3H(vec2(sd * 19., 8.)) - .5); float n1 = r3N(p * .33 + sd * 50.), n2 = r3N(p * 1.7 + sd * 13.);
  // 防水層：隔熱磚（30 cm 方磚、磚縫、每塊深淺）／PU 綠漆（滾筒痕、走道磨白、補漆）／水泥（歷年補的防水層一塊一塊，孟買 873-875）
  if (red) { vec2 t = p / .3, f = abs(fract(t) - .5); float jn = smoothstep(.40, .48, max(f.x, f.y)) * fine;
    c *= mix(1., .84 + .3 * r3H(floor(t) + sd * 77.), fine) * (1. - .28 * jn) * (.9 + .2 * n1);
    c = mix(c, c * vec3(.78, .8, .82), step(mix(.82, .93, big), r3H(floor(p / mix(vec2(3.2), pc, big)) + sd * 9.)) * mix(.7, .4, big)); rough = .9; }
  else if (grn) { c *= .9 + .12 * r3N(vec2(p.x * .4, p.y * 2.6) + sd * 31.) + .06 * n2;
    float ph = r3H(floor(p / mix(vec2(4.2), pc, big)) + sd * 17.); c = mix(c, c * vec3(.86, .82, .84), step(mix(.84, .92, big), ph) * mix(.8, .5, big));
    c = mix(c, c * 1.12 + .01, (1. - smoothstep(.3, .9, abs(p.y + (sd - .5) * W * .6))) * .3 * step(.5, fract(sd * 7.))); rough = .55; }
  else { c *= mix(.80 + .34 * n1 - .12 * n2, .9 + .14 * n1 - .05 * n2, big); float ph = r3H(floor(p / pc) + sd * 23.);
    c = mix(c, mix(vec3(.075, .075, .08), c * .62, big), step(mix(.78, .9, big), ph) * mix(.8, .55, big)); c = mix(c, c * 1.25 + .04, step(ph, mix(.1, .05, big)) * mix(.5, .25, big)); rough = .93; }
  // 積水與排水口的水痕（角落暗、一條條往排水口）
  c *= 1. - .22 * smoothstep(.55, .85, r3N(p * .6 + sd * 41.)) * smoothstep(.0, 2.5, e);
  // 女兒牆：牆腳暗帶＋照太陽方向的影子（牆高 0.8 m）
  c *= mix(.6, 1., smoothstep(0., 1.,  e));
  float pw = .8; vec2 dE = vec2(L - abs(p.x), W - abs(p.y)), sg = sign(p) * tS;   // sg>0：太陽在這一側的女兒牆外，牆往內投影
  float psh = max(step(dE.x, pw * max(sg.x, 0.)), step(dE.y, pw * max(sg.y, 0.)));
  c *= 1. - .42 * psh * dayK;
  // 屋頂上的東西（避開中央的樓梯間幾何 3.4×2.8）
  vec3 add = vec3(0.); float cov = 0., shd = 0.;
  bool stair = code > 1.5 && code < 7.5;
  float side = r3H(vec2(sd * 91., 3.)) < .5 ? -1. : 1.;
  if (mid > .01) {
    // 冷氣室外機一排（公寓、華廈、大樓、廠房；透天少數）：0.85×0.35 m、高 0.65 m，靠一道長邊
    float acP = code < 1.5 ? .35 : code < 5.5 ? .9 : .5;
    if (r3H(vec2(sd * 13., 5.)) < acP && W > 2.4) { float sp = 1.15, nA = floor((L * 2. - 2.) / sp), i = clamp(floor((p.x + L - 1.) / sp), 0., nA - 1.), keep = step(r3H(vec2(i, sd * 7.)), .72);
      vec2 cc = vec2(-L + 1. + (i + .5) * sp, side * (W - .75));
      if (nA > .5 && keep > .5) { vec2 o = r3Obj(p, cc, vec2(.42, .18), .65, tS, aa); vec2 q = p - cc;
        vec3 top = vec3(.62, .62, .6) * (1. - .55 * (1. - smoothstep(.12, .15, length(q - vec2(.12, 0.)))) * fine);
        add = mix(add, top, o.x); cov = max(cov, o.x); shd = max(shd, o.y); } }
    // 管線：沿女兒牆內 0.35 m 一條（給水、冷媒）
    if (r3H(vec2(sd * 5., 9.)) < .6) { float d = abs(abs(p.y) - (W - .35)) - .05; float pm = (1. - smoothstep(-aa, aa, d)) * step(abs(p.x), L - .3) * step(0., p.y * -side);
      float psd = (1. - smoothstep(-aa, aa, abs(abs(p.y) - (W - .35) + tS.y * sign(p.y) * .08) - .05 - abs(tS.y) * .08)) * (1. - pm) * step(abs(p.x), L - .3) * step(0., p.y * -side);
      add = mix(add, vec3(.55, .56, .55), pm); cov = max(cov, pm); shd = max(shd, psd * .6); }
    // 太陽能板（公寓、大樓、廠房兩成五，透天一成）：1.0×1.65 m 一片、架高 0.6 m，排在屋頂另一半
    if (r3H(vec2(sd * 3., 11.)) < (code < 1.5 ? .1 : .25) && L > 3. && W > 2.5) { vec2 ar = vec2(L * .7, W * .35), ac = vec2(0., -side * W * .4);
      vec2 g = (p - ac + ar) / vec2(1.05, 1.7), gi = floor(g), gf = fract(g); float inA = step(abs(p.x - ac.x), ar.x - .2) * step(abs(p.y - ac.y), ar.y - .1) * step(2.5, abs(p.x)) ;
      float pan = inA * step(.05, gf.x) * step(.04, gf.y);
      float psh2 = step(abs(p.x - ac.x + tS.x * .3), ar.x - .2) * step(abs(p.y - ac.y + tS.y * .3), ar.y) * (1. - pan) * step(2.5, abs(p.x));
      vec3 pc = vec3(.03, .045, .09) * (1. + .5 * fine * step(.48, abs(fract(gf.y * 6.) - .5))) + vec3(.05) * (1. - smoothstep(.0, .06, min(gf.x, gf.y)) ) * fine;
      add = mix(add, pc, pan); cov = max(cov, pan); shd = max(shd, psh2 * .8); if (pan > .5) rough = .25; }
    if (code < 1.5) {   // 透天：晒衣架（三條線＋影子）、盆栽一排
      if (r3H(vec2(sd * 17., 2.)) < .55 && W > 2.) { float yy = p.y + side * (W - 1.6), ln = 0.;
        for (int t = 0; t < 3; t++) ln = max(ln, 1. - smoothstep(.0, aa + .015, abs(yy - (float(t) - 1.) * .35)));
        float ls = 0.; for (int t = 0; t < 3; t++) ls = max(ls, 1. - smoothstep(.0, aa + .04, abs(yy + tS.y * 1.6 - (float(t) - 1.) * .35)));
        float inR = step(abs(p.x), min(L - .6, 1.6));
        add = mix(add, vec3(.7, .7, .68), ln * inR * fine); cov = max(cov, ln * inR * fine); shd = max(shd, ls * inR * .5 * fine);
        float cl = step(.62, r3H(vec2(floor(p.x / .45), sd * 3.))) * inR * step(abs(yy - .35 * (floor(r3H(vec2(floor(p.x / .45), 8.)) * 3.) - 1.)), .05) * step(fract(p.x / .45), .7);   // 晒的衣服
        add = mix(add, mix(vec3(.6, .58, .55), vec3(.25, .32, .45), r3H(vec2(floor(p.x / .45), 4.))), cl * fine); cov = max(cov, cl * fine); }
      if (r3H(vec2(sd * 29., 4.)) < .45) { float pp = fract((p.x + L) / .7) - .5, pr = length(vec2(pp * .7, abs(p.y) - (W - .45))) ;
        float pot = (1. - smoothstep(.22 - aa, .22 + aa, pr)) * step(0., p.y * side) * step(abs(p.x), L - .5);
        add = mix(add, vec3(.06, .13, .04) * (.7 + .6 * n2), pot); cov = max(cov, pot); shd = max(shd, (1. - smoothstep(.25, .45, length(vec2(pp * .7 + tS.x * .3, abs(p.y) - (W - .45) + tS.y * .3 * sign(p.y))))) * step(0., p.y * side) * (1. - pot) * .5 * step(abs(p.x), L - .5)); }
    }
    if (code > 3.5 && code < 4.5 && L > 7. && W > 7.) {   // 大樓：停機坪圓圈＋H、冷卻水塔兩座
      float R = min(W * .62, 9.); vec2 hc = vec2(-side * (L - R * .85 - .6), 0.); float dr = length(p - hc);
      float ring = (1. - smoothstep(.35 - aa, .35 + aa, abs(dr - R * .8))) * mid; vec2 hq = (p - hc) / (R * .32);
      float H = max(step(abs(abs(hq.x) - .55), .14) * step(abs(hq.y), .8), step(abs(hq.x), .55) * step(abs(hq.y), .12)) * mid;
      if (r3H(vec2(sd * 41., 6.)) < .6 && abs(hc.x) - R * .85 > 2.) { add = mix(add, vec3(.85, .62, .1), max(ring, H)); cov = max(cov, max(ring, H)); c = mix(c, vec3(.16, .17, .17), (1. - smoothstep(R * .95, R, dr)) * .5); }
      for (int t = 0; t < 2; t++) { vec2 tc = vec2(side * (L - 2.6), (float(t) - .5) * 3.4); float dt = length(p - tc), top = 1. - smoothstep(1.4 - aa, 1.4 + aa, dt);
        float ts = (1. - smoothstep(1.4 - aa, 1.4 + aa, length(p - tc + tS * 1.6))) * (1. - top);
        vec3 tcol = mix(vec3(.5, .53, .54), vec3(.16, .17, .17), (1. - smoothstep(.75, .85, dt)) * .8) * (1. - .5 * step(.5, fract(atan(p.y - tc.y, p.x - tc.x) * 1.9)) * (1. - smoothstep(.9, 1., dt)) * fine);
        add = mix(add, tcol, top); cov = max(cov, top); shd = max(shd, ts); } }
    if (code > 4.5 && code < 5.5) {   // 廠房、大空間：採光罩一條條、排氣扇
      float sk = abs(fract(p.x / 6.) - .5) * 6.; float sky = (1. - smoothstep(.6 - aa, .6 + aa, sk)) * step(abs(p.y), W - 1.2);
      add = mix(add, vec3(.62, .66, .66), sky); cov = max(cov, sky);
      vec2 fq = vec2(fract(p.x / 6. + .5) - .5, fract(p.y / 5.) - .5) * vec2(6., 5.); float fan = 1. - smoothstep(.3 - aa, .3 + aa, length(fq)); add = mix(add, vec3(.5, .52, .5), fan * step(abs(p.y), W - 1.)); cov = max(cov, fan * step(abs(p.y), W - 1.)); }
    // 樓梯間不畫東西
    if (stair) { float st = step(abs(p.x), 2.) * step(abs(p.y), 1.7); cov *= 1. - st; shd *= 1. - st; }
    c = mix(c, add, cov * mid); c *= 1. - .55 * shd * mid * dayK;
  }
  return c;
}`;
const f2 = (x) => (+x).toFixed(4);
const TW2_GLSL = `
vec2 tw2Cand(float k){ ${ST_CAND.map(([a, b], i) => `if (k < ${i + 1}.5) return vec2(${a}., ${b}.);`).join(" ")} return vec2(0.); }
vec2 tw2Stair(float k, float L, float W){ return k > 8.5 ? vec2(0.) : tw2Cand(k) * vec2(L - ${f2(ST.l / 2 + STM)}, W - ${f2(ST.w / 2 + STM)}); }
vec2 tw2Tu(float L, float W){ return vec2(min(8., 2. * (L - 4.6)), min(6., 2. * W - 3.)); }
`;
const TW2_HS = `vec2(${f2(ST.l / 2)}, ${f2(ST.w / 2)})`;
function tw2Roof(src) {
  let s = src;
  const need = (a, b) => {
    if (!s.includes(a)) throw Error("試作 tw2 屋頂著色器對不上：" + a.slice(0, 60));
    s = s.replace(a, b);
  };
  if (TW2.stair || TW2.heli) {
    need("vec3 twRoof3(", TW2_GLSL + "vec3 twRoof3(");
    need(
      "if (stair) { float st = step(abs(p.x), 2.) * step(abs(p.y), 1.7); cov *= 1. - st; shd *= 1. - st; }",
      `{ float w4 = vRn.w, sk = mod(w4, 16.), st = 0.; vec2 sc = tw2Stair(sk, L, W);
      if (sk > .5) st = step(abs(p.x - sc.x), ${TW2_HS}.x + .3) * step(abs(p.y - sc.y), ${TW2_HS}.y + .3);
      if (mod(floor(w4 / 32.), 2.) > .5) { vec2 hA = tw2Tu(L, W) * .5 + .3; st = max(st, step(abs(p.x), hA.x) * step(abs(p.y), hA.y)); }
      cov *= 1. - st; shd *= 1. - st; }`
    );
  }
  if (TW2.heli) {
    const a = s.indexOf("    if (code > 3.5 && code < 4.5 && L > 7. && W > 7.) {"), b = s.indexOf("      for (int t = 0; t < 2; t++) { vec2 tc = vec2(side * (L - 2.6)");
    if (a < 0 || b < 0) throw Error("試作 tw2 停機坪段對不上");
    s = s.slice(0, a) + `    if (code > 3.5 && code < 4.5 && L > 7. && W > 7.) {   // 大樓：停機坪（試作 tw2 heli）、冷卻水塔兩座
      float w4 = vRn.w, sk = mod(w4, 16.), pad = mod(floor(w4 / 16.), 2.), yo = mod(floor(w4 / 64.), 4.) - 1., ps = mod(floor(w4 / 256.), 2.) > .5 ? 1. : -1.;
      float R = min(min(6., W - 1.2), sk > 8.5 ? (L - 2.8) * .5 : L - 2.8); vec2 hc = vec2(ps * (L - R - .8), yo * (W - R - .8)); float dr = length(p - hc);
      float ring = (1. - smoothstep(.2 - aa, .2 + aa, abs(dr - R * .84))) * mid; vec2 hq = (p - hc) / (R * .3);
      float H = max(step(abs(abs(hq.x) - .55), .14) * step(abs(hq.y), .8), step(abs(hq.x), .55) * step(abs(hq.y), .12)) * mid;
      if (pad > .5) { float m = max(ring, H) * .8; add = mix(add, mix(vec3(.85, .62, .1), c, .35), m); cov = max(cov, m); c = mix(c, vec3(.2, .21, .21), (1. - smoothstep(R * .95, R, dr)) * .3); }
      float tsd = pad > .5 ? -ps : side;
` + s.slice(b).replace("vec2 tc = vec2(side * (L - 2.6)", "vec2 tc = vec2(tsd * (L - 2.6)");
  }
  return s;
}
const ROOF_GLSL_TW2 = TW2.stair || TW2.heli ? tw2Roof(ROOF_GLSL) : ROOF_GLSL;
export function fx3FacadePatch(sh, F) {
  let s = sh.fragmentShader;
  const need = (a, b) => {
    if (!s.includes(a)) throw Error("第 116 包立面對不上：" + a.slice(0, 60));
    s = s.replace(a, b);
  };
  if (F.roof) {
    need("void twFacade(out vec3 col,", ROOF_GLSL_TW2 + "\nvoid twFacade(out vec3 col,");
    need(
      "else if (part < 5.5) { float n = twN2(vSV.xy * .9) * .6 + twN2(vSV.xy * 4.) * .4; col = base * mix(.78, 1.06, n); rough = .93; }",
      `else if (part < 5.5) { float n = twN2(vSV.xy * .9) * .6 + twN2(vSV.xy * 4.) * .4; col = base * mix(.78, 1.06, n); rough = .93;
      if (vLv.x > .5) { float pxR = max(fwidth(vSV.z), fwidth(vSV.w)); col = twRoof3(base, vSV.zw, vLv.w, vLv.y, vLv.x, vRn.x, vRn.z / 65535. * 6.2831853 - 3.1415927, pxR, rough); } }`
    );
    need(
      "if (part < 4.5) { col = texture(tFinish, vec3(vSV.xy, 7.)).rgb * base * 1.12; rough = .5; metal = .3; }",
      `if (part < 4.5) { col = texture(tFinish, vec3(vSV.xy, 7.)).rgb * base * 1.12; rough = .5; metal = .3;
      { float sdM = dot(base, vec3(91., 37., 13.)), pch = twH3(vec3(floor(vSV.x * 6. / 2.4), floor(vSV.y * 3.), sdM)); col *= .82 + .32 * pch;
        col = mix(col, vec3(.16, .07, .03) * (.7 + .6 * twN2(vSV.xy * 9.)), step(.8, twH3(vec3(sdM, 3., 1.))) * smoothstep(.45, .8, twN2(vSV.xy * vec2(3., 1.4) + sdM)) * .7); } }`
    );
  }
  if (TW2.tank) {
    need("else if (part < 8.5) { col = base; metal = .92; rough = .24; }", `else if (part < 8.5) { col = base; metal = .92; rough = .24;
      if (dot(base, vec3(.3, .59, .11)) > .45) { float v = vSV.y, band = smoothstep(.5, .56, v) * (1. - smoothstep(.68, .74, v));
        col = base * (.94 + .1 * twH3(vec3(floor(v * 14.), 3., 7.))) + .04 * smoothstep(.8, 1., v); col = mix(col, vec3(.70, .80, .93), band * .65); metal = .5; rough = .3; } }`);
  }
  if (F.facade) {
    need("  // 樓層飾帶\n", `  // 第 116 包（fx3 facade）：樓板線、凹陽台、雨遮、窗下水痕、騎樓；依透天／公寓／華廈／大樓不同配方
  if (!fHall && !fTemple && !fSchool && !fWood && F > 1.5 && finish < 6.5) {
    bool fTH = twBit(flags, 16384.), fLow = twBit(flags, 32768.), hiR = F > 11.5; float dz = v - z0;
    float fdA = 1. - smoothstep(.05, .2, px), fdB = 1. - smoothstep(.2, .8, px), nit = 1. - .6 * uNight;
    if (k > .5 && !side) {
      // 樓板線：板緣一條亮、上面那層樓板在本層頂留一條陰影
      float slabT = 1. - smoothstep(.16 - px, .16 + px, dz), shT = (1. - smoothstep(0., hiR ? .25 : .4, fh - dz)) * step(k, F - 1.5);
      col = mix(col, base * (hiR ? 1.12 : 1.05) + .02, slabT * fdB * (back ? .4 : .8)); col *= 1. - .28 * shT * fdB * nit; glass *= 1. - slabT * fdB;
      // 陽台：凹進去的整格（陰影、欄杆或實心女兒牆）。機率依類型
      float pB = back ? .1 : fTH ? (k > F - 1.5 ? .55 : .3) : fLow ? .5 : hiR ? .3 : .45;
      float rbal = twH3(vec3(j, k + 41., seed)), rk = twH3(vec3(j, 43., seed));   // 同一開間上下樓多半一致（大樓陽台成串）
      bool bal = (hiR || fLow ? rk : rbal) < pB && layer > -.5 && abs(layer - 10.) > .5 && bw > 2.2;
      if (bal) { float inB = step(.05, cu) * step(cu, .95), rail = 1. - smoothstep(1.05 - px, 1.05 + px, dz), solid = step(.45, twH3(vec3(j, k + 3., seed + 9.)));
        float rec = inB * (1. - rail) * step(.16, dz);
        col *= 1. - rec * fdB * nit * mix(.62, .4, smoothstep(.2, fh, dz));   // 凹進去，越靠天花板越暗
        float bars = step(.55, fract(cu * bw / .13)) * fdA;   // 欄杆
        vec3 rc = solid > .5 ? base * 1.06 + .02 : mix(col * .45, vec3(.32, .33, .33), bars);
        col = mix(col, rc, rail * inB * step(.16, dz) * fdB); col = mix(col, base * 1.15 + .03, (1. - smoothstep(.06, .06 + px, abs(dz - 1.05))) * inB * fdA);
        glass *= 1. - rail * inB; glass *= 1. - .3 * rec; }
      // 雨遮：窗頂上一條板（亮面）＋板下 0.4 m 陰影；透天、公寓多，大樓少
      float pH = fTH || fLow ? .7 : hiR ? .08 : .4;
      if (!bal && layer > -.5 && layer < 15.5 && abs(layer - 10.) > .5 && twH3(vec3(j, k + 77., seed)) < pH) { float hz = fh * .84, hd = dz - hz, hw = step(.06, cu) * step(cu, .94);
        float hood = (1. - smoothstep(.0, px, abs(hd - .06) - .06)) * hw, hs2 = (1. - smoothstep(-.42, 0., hd)) * step(hd, 0.) * hw;
        col *= 1. - .32 * hs2 * fdA * nit; col = mix(col, base * 1.1 + .04, hood * fdA); glass *= 1. - hood * fdA; }
      // 窗下水痕：窗兩角往下的灰黑流痕
      float wx = min(abs(cu - .16), abs(cu - .84)); col *= 1. - .14 * fdA * (1. - smoothstep(.0, .04, wx)) * smoothstep(fh * .3, fh * .05, dz) * smoothstep(.4, .7, twN2(vec2(j * 3. + cu * 9., k + seed)));
    }
    // 騎樓：臨路店面的一樓，柱列（開間邊）＋騎樓內退縮的暗面，柱頂一條樑
    if (k < .5 && commercial && !fQuiet && (fTH || fLow || F < 12.)) { float col0 = max(1. - smoothstep(.07, .07 + px / bw, cu), smoothstep(.93 - px / bw, .93, cu));
      float beam = smoothstep(gh - .55 - px, gh - .55, v);
      float inA = (1. - col0) * (1. - beam);
      col = mix(col * mix(.62, .4, smoothstep(0., gh, v)) , col, 1. - inA * fdB);
      col = mix(col, base * vec3(.98, .97, .95) * mix(.85, 1., smoothstep(0., 1., v)), max(col0, beam) * fdB); glass *= 1. - max(col0, beam) * fdB; }
  }
  // 樓層飾帶
`);
    if (TW2.arcade) need("if (k < .5 && commercial && !fQuiet && (fTH || fLow || F < 12.)) {", "if (k < .5 && commercial && !fQuiet && (fTH || fLow || F < 12.) && vRn.y < 14.5) {");
  }
  if (F.glass && s.includes("col = mix(col, gIn, glass);")) {
    need("col = mix(col, gIn, glass);", `{ float pu = fract(cu * (1. + cw)), pxC = px / max(bw / (1. + cw), .3), fdG = 1. - smoothstep(.04, .25, pxC);
    float hP = twH3(vec3(j * 2. + floor(cu * 2.) * cw, k, seed + 19.)); gIn *= mix(vec3(1.), mix(vec3(.82, .9, .95), vec3(1.12, 1.08, 1.02), hP), .6 + .4 * cw);
    if (cw > .5) { float span = smoothstep(.83, .86, cv) * mix(1., .6, 1. - fdG); gIn = mix(gIn, vec3(.035, .045, .055), span);
      float mull = max(1. - smoothstep(.0, .025 + pxC * .5, min(pu, 1. - pu)), 1. - smoothstep(.0, .02 + pxC * .5, min(cv, abs(cv - .85)))) * fdG; gIn = mix(gIn, vec3(.42, .44, .45), mull * .85); } }
  col = mix(col, gIn, glass);`);
    need("rough = mix(rough, mix(.16, .07, cw), glass); metal = mix(0., mix(.25, .55, cw), glass);", "rough = mix(rough, mix(.12, .035, cw), glass); metal = mix(0., mix(.3, .72, cw), glass);");
    need("twPN = vec3(twH3(", "twPN = vec3(1.8, 1.8, 1.) * vec3(twH3(");
  }
  sh.fragmentShader = s;
  if (F.roof) sh.uniforms.uSun3 = F.sun;
}
export function fx3GroundPatch(sh, F) {
  if (!F.ground) return;
  let s = sh.fragmentShader;
  const a = "float wat = max(smoothstep(-.8, .9, sd), smoothstep(.4, .62, pond));";
  if (!s.includes(a)) throw Error("第 116 包地面對不上");
  s = s.replace(a, `{ float nr3 = 1. - smoothstep(200., 1600., dist);
    if (nr3 > .001 && uSize < 2000.) {
      // 人行道：建物輪廓外擴約 3.5 m（遮罩四個方向各取一次的最大值），扣掉輪廓本身
      // 試作 tw2（walk）：外擴縮到 apron（預設 1.5 m）、改無磚縫的水泥色；植生多的地方（草地、山坡、農村）整圈不畫。人行道改由道路那層沿路畫（road-marks.mjs）
      vec2 o3 = vec2(${TW2.walk ? (+TW2.num("apron", 1.5)).toFixed(2) : "3.5"} / uSize, 0.); float fo = max(max(texture2D(tMask, uvM + o3).r, texture2D(tMask, uvM - o3).r), max(texture2D(tMask, uvM + o3.yx).r, texture2D(tMask, uvM - o3.yx).r));
      float walk = smoothstep(.12, .45, fo) * (1. - smoothstep(.3, .65, foot)) * (1. - veg * .8)${TW2.walk ? " * (1. - smoothstep(.22, .42, veg))" : ""};
      vec2 tq = abs(fract(P / .5) - .5); float jn = smoothstep(.43, .49, max(tq.x, tq.y)) * (1. - smoothstep(.02, .07, pxm));
      vec3 swC = ${TW2.walk ? "vec3(.165, .162, .155) * (.94 + .1 * gN(P / 1.7).x)" : "vec3(.2, .195, .185) * (.88 + .2 * gH(floor(P / .5))) * (1. - .3 * jn)"};
      // 空地分類：草地、裸土、柏油、水泥；邊界加雜訊再切，不再是 10 m 的糊色塊
      // 第 117 包：10 m 影像內插後的分類邊界是一格一格的——加大、加一層更大的雜訊抖動邊界（不是格線方向）、邊界放寬成柔邊、類別之間的色差縮小
      float lumS = dot(sat, vec3(.3, .59, .11)), warm = (sat.r - sat.b) / (lumS + .03), n3 = gN(P / 4.3).x * .45 + gN(P / 1.3).x * .25 + gN(P / 11.7 + 3.1).x * .3;
      float vc = smoothstep(.36, .64, veg + (n3 - .5) * .6), soil = smoothstep(.42, .72, warm + (n3 - .5) * .4) * (1. - vc);
      vec3 hard = mix(vec3(.085, .085, .088) * (.85 + .3 * gN(P / .6).x), vec3(.21, .205, .195) * (.9 + .2 * gN(P / 1.4).x), smoothstep(.05, .28, lumS + (n3 - .5) * .12));
      vec3 cls = mix(mix(hard, vec3(.14, .115, .085) * (.8 + .4 * n3), soil), mix(vec3(.05, .085, .025), vec3(.10, .14, .04), gN(P / 2.2).x), vc);
      land = mix(land, cls, .38 * nr3 * (1. - clamp(foot * 1.5, 0., 1.))${F.land ? " * (1. - landW)" : ""});   // 第 119 包：有地面分類圖的地方不再照影像猜
      land = mix(land, swC, walk * nr3);
    } }
  ${a}`);
  sh.fragmentShader = s;
}
export const LAND_CLASSES = [
  "none",
  "water",
  "forest",
  "shrub",
  "grass",
  "park",
  "garden",
  "courtPaved",
  "pitchGrass",
  "pitchSand",
  "track",
  "playground",
  "school",
  "farmland",
  "orchard",
  "aquaculture",
  "cemetery",
  "barren",
  "sand",
  "wetland",
  "construction",
  "plaza",
  "parking",
  "residential",
  "commercial",
  "industrial",
  "military",
  "golf",
  "urban",
  "railway",
  "rock",
  "greenhouse",
  "institution",
  "pitchClay",
  "riverbed"
];
const LC = Object.fromEntries(LAND_CLASSES.map((k, i) => [k, i.toFixed(1)]));
export function fx3LandPatch(sh, F) {
  if (!F.land) return;
  let s = sh.fragmentShader;
  const need = (a, b) => {
    if (!s.includes(a)) throw Error("第 119 包地面對不上：" + a.slice(0, 50));
    s = s.replace(a, b);
  };
  need("uniform sampler2D tSat;", "uniform sampler2D tLand; uniform float uLandOn; uniform float uLandV; uniform sampler2D tSat;");
  need("vec2 gRot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }", `vec2 gRot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// 第 119 包：地面分類
float lS(float c, vec4 cs, vec4 ds, vec4 ws){ vec4 m = 1. - step(.5, abs(cs - c)); return dot(ws, mix(-ds, ds, m)); }
// 抗鋸齒的線：x＝到線中心的距離（公尺），w＝線寬；線比像素細時變淡（覆蓋率不變）
float lLine(float x, float w, float px){ float h = max(w, px) * .5; return (1. - smoothstep(h - px * .5, h + px * .5, abs(x))) * min(1., w / max(px, 1e-4)); }
// 週期線：沿 x 每 per 公尺一條
float lGrid(float x, float per, float w, float px){ return lLine((fract(x / per + .5) - .5) * per, w, px) * (1. - smoothstep(per * .25, per * .6, px)); }
float lNat(float c){ return c > ${LC.forest} - .5 && c < ${LC.shrub} + .5 || c > ${LC.barren} - .5 && c < ${LC.wetland} + .5 || c > ${LC.rock} - .5 && c < ${LC.rock} + .5 ? 1. : 0.; }
float lLum(vec3 c){ return dot(c, vec3(.3, .59, .11)); }
// 低頻影像色調：保留色相與一點亮度差（k＝跟影像走多少）
vec3 lTint(vec3 base, vec3 satL, float k){ float l = max(lLum(satL), .004); vec3 ch = clamp(satL / l, vec3(.4), vec3(2.2)); return base * mix(vec3(1.), ch, k) * mix(1., clamp(l / .055, .7, 1.4), k * .6); }
vec3 lCol(float c, float s, float ang, float rn, vec2 P, float px, vec3 satL, vec3 land, float veg){
  vec2 Q = gRot(P, -ang); float h = gH(vec2(ang * 57.3 + rn * 7.1, c));   // rn：每塊多邊形的亂數（land.png 版本 2；版本 1 恆為 0＝照舊）
  float n1 = gN(P / 1.7).x, n2 = gN(P / 7.3).x, n3 = gN(P / 23.).x, fdF = 1. - smoothstep(.15, .9, px), fdM = 1. - smoothstep(1., 5., px);
  float mott = (n1 - .5) * .5 * fdF + (n2 - .5) * .7 * fdM + (n3 - .5) * .6;
  vec3 lawn = lTint(vec3(.05, .074, .032), satL, .25) * (1. + .3 * mott);
  if (c < ${LC.forest} + .5 && c > ${LC.forest} - .5 || c > ${LC.shrub} - .5 && c < ${LC.shrub} + .5) {
    // 樹林、灌叢：保留影像（山坡的色調變化）＋樹冠雜訊，只把顏色收乾淨一點
    vec3 fc = lTint(c < ${LC.forest} + .5 ? vec3(.03, .055, .022) : vec3(.05, .07, .03), satL, .5) * (.75 + .5 * (gN(P / 4.1).x * .6 + gN(P / 13.).x * .4));
    // 地表顏色線 11-24：分類多邊形粗（ESA 10 m、OSM 的灌叢面蓋到河口礫石灘），影像是亮的、不綠的地方（裸地、礫石）照影像，不拉成綠色
    float bare = smoothstep(.22, .32, lLum(land)) * (1. - veg);
    if (c < ${LC.forest} + .5) {
      // 地表顏色線 11-24：樹林的地面畫成一團一團的林冠（約 7 m 一團：團心亮、團與團之間暗），樹與樹之間斜看才不像平整的草坡（林口台地）；遠了收成平均色
      //   只用到最近團心的距離（不畫團與團的交界線，交界線會排成蜂巢格），位置再用雜訊推歪
      vec2 q = P / 7. + (gN(P / 23.).yz - .5) * .8, ci = floor(q); float d1 = 9., hv = 0.;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 cc = ci + vec2(float(i), float(j)); float d = length(q - cc - vec2(gH(cc), gH(cc + 17.3))) * (.8 + .4 * gH(cc + 9.7)); if (d < d1) { d1 = d; hv = gH(cc + 5.1); } }
      float fdC = 1. - smoothstep(.6, 2.2, px), cr = .74 + .4 * (1. - smoothstep(.1, .85, d1)) * (.6 + .8 * hv);
      fc *= mix(.92, cr, fdC);
      return mix(land, fc, .6 * (1. - bare)); }
    return mix(land, fc, .45 * (1. - bare)); }
  if (c > ${LC.grass} - .5 && c < ${LC.garden} + .5 || c > ${LC.golf} - .5 && c < ${LC.golf} + .5) {
    vec3 g = lawn;
    if (c > ${LC.park} - .5 && c < ${LC.park} + .5) {   // 公園：草地＋樹蔭下較深的地被（影像很綠的地方）＋少數裸露
      float tr = smoothstep(.5, .56, veg + (n2 - .5) * .5 + (n1 - .5) * .12 * fdF); g = mix(g, lawn * vec3(.74, .82, .72) * (1. + .25 * (gN(P / 2.6).x - .5) * fdM), tr * .65); g = mix(g, lTint(vec3(.1, .085, .06), satL, .2), smoothstep(.78, .9, gN(P / 9.1 + 4.).x) * .5); }
    if (c > ${LC.garden} - .5 && c < ${LC.garden} + .5) g = mix(g, vec3(.11, .05, .06), smoothstep(.72, .8, gN(P / 2.3).x) * fdM * .6);
    if (c > ${LC.golf} - .5) g *= vec3(1.1, 1.2, 1.);
    return g; }
  if (c > ${LC.courtPaved} - .5 && c < ${LC.pitchSand} + .5) {
    vec3 a, b; float inset = 1.8;
    vec3 sat1 = texture2D(tSat, (P - uNoise + uSat.x) / uSat.y, 1.).rgb; float vg1 = (sat1.g - max(sat1.r, sat1.b)) / (sat1.r + sat1.g + sat1.b + .002);
    if (c < ${LC.courtPaved} + .5 && vg1 > .1) c = ${LC.pitchGrass};   // 資料說是硬地、影像（20 m）明明是綠的：多半是草地球場（棒壘球場、足球場）
    if (c < ${LC.courtPaved} + .5) {   // 硬地球場：外圈一色、場內一色、白線（籃球、網球、排球都是這個樣子）
      if (h < .4) { a = vec3(.035, .085, .045); b = vec3(.02, .06, .035); } else if (h < .7) { a = vec3(.025, .055, .11); b = vec3(.035, .085, .045); }
      else if (h < .85) { a = vec3(.12, .04, .025); b = vec3(.04, .085, .045); } else { a = vec3(.15, .15, .14); b = vec3(.12, .12, .115); }
      a *= 1. + .08 * (n1 - .5) * fdF; b *= 1. + .08 * (n1 - .5) * fdF; }
    else if (c < ${LC.pitchGrass} + .5) {   // 草地球場：割草條紋
      float st = step(.5, fract(Q.x / 12.)); a = lawn * mix(.9, 1.1, mix(.5, st, fdM)); b = a; inset = 1.; }
    else { a = lTint(vec3(.17, .095, .05), satL, .2) * (1. + .15 * (n1 - .5) * fdF); b = lawn; inset = 1.; }
    vec3 g = s > inset ? a : b; g = mix(b, a, smoothstep(inset - px * .5, inset + px * .5, s));
    float ln = max(lLine(s - inset, .08, px), lLine(s - .12, .1, px));
    return mix(g, vec3(.6, .6, .58), ln * .85); }
  if (c > ${LC.pitchClay} - .5 && c < ${LC.pitchClay} + .5) {   // 地表顏色線 11-24：原本只寫下限（紅土是最後一類），新類別 riverbed 排在後面會被畫成紅土，補上限
      // 第 121 包：棒壘球場的紅土內野（紅褐土、細顆粒、靠邊緣有一圈較深的踩踏痕）
    vec3 g = lTint(vec3(.15, .065, .032), satL, .15) * (1. + .2 * ((gN(P / .35).x - .5) * fdF + (n2 - .5) * .6)); return g * mix(.86, 1., smoothstep(.4, 2.2, s)); }
  if (c > ${LC.track} - .5 && c < ${LC.track} + .5) {   // 跑道：紅色 PU、分道線跟著邊界走（距離每 1.22 m 一條）
    vec3 g = vec3(.16, .045, .03) * (1. + .1 * (n1 - .5) * fdF);
    float ln = s < 10.2 ? lGrid(s - .05, 1.22, .05, px) : 0.;
    return mix(g, vec3(.55, .55, .52), ln * .8); }
  if (c > ${LC.playground} - .5 && c < ${LC.playground} + .5) {
    vec3 g = h < .33 ? vec3(.11, .03, .025) : h < .66 ? vec3(.03, .075, .035) : vec3(.025, .05, .1);
    return g * (1. - .2 * max(lGrid(Q.x, 1., .03, px), lGrid(Q.y, 1., .03, px))); }
  if (c > ${LC.farmland} - .5 && c < ${LC.farmland} + .5 || c > ${LC.orchard} - .5 && c < ${LC.orchard} + .5) {
    // 農地：作物色跟影像的季節色走（k 大），田裡成列；果園：一格一格的樹
    vec3 g = lTint(vec3(.065, .085, .03), satL, .8) * (1. + .25 * ((n2 - .5) * fdM + (n3 - .5)));
    if (c < ${LC.farmland} + .5) { float lg = lLum(g); vec3 lf = land * clamp(lg * 1.35 / max(lLum(land), 1e-3), .55, 1.); g = mix(g, lf, .45); g *= 1. - .12 * lGrid(Q.y, .8, .3, px);
      if (uLandV > 1.5) {   // 第 121 包：一塊一塊的田有色差（休耕偏黃褐、剛插秧偏水色、熟成偏黃綠、一般偏深綠）。田的格子照這一塊多邊形的方向切 30 m ×（60～110）m，
        // 亂數＝格子編號＋這一塊多邊形的亂數 rn；格子比像素大很多，拉到很遠（每像素 12～30 m）才淡掉，不會閃
        float fy = floor(Q.y / 30.), fh = gH(vec2(fy, 41.7 + rn * 8.)), flx = 60. + 50. * fh; vec2 fid = vec2(floor((Q.x + fh * 97.) / flx), fy); float pr = gH(fid * 1.37 + rn * 11.3);
        vec3 tv = pr < .16 ? vec3(1.42, 1.13, .9) : pr < .3 ? vec3(.8, .9, .97) : pr < .52 ? vec3(1.16, 1.1, .8) : pr < .78 ? vec3(.84, .95, .8) : vec3(1.);
        g *= mix(vec3(1.), tv * (.92 + .16 * gH(fid + 5.1)), .75 * (1. - smoothstep(12., 30., px))); } }   // 田跟田之間的色差留著（影像 10 m 對 30×70 m 的田夠細）；影像裡太亮的白塊（溫室、雲、裸地反光）壓回作物的亮度
    else { vec2 q = fract(Q / 4.) - .5; float tr = 1. - smoothstep(.3, .36 + px / 4., length(q)); g = mix(g * vec3(1.1, 1., .85), vec3(.025, .05, .018), tr * (1. - smoothstep(.6, 2.5, px))); }
    return g; }
  if (c > ${LC.aquaculture} - .5 && c < ${LC.aquaculture} + .5) { vec3 g = mix(vec3(.02, .045, .04), satL * .7, .3) * (uLandV > 1.5 ? mix(vec3(.8, .9, .85), vec3(1.15, 1.12, 1.), rn) : vec3(1.)); return mix(g, lTint(vec3(.12, .1, .07), satL, .3), 1. - smoothstep(1.5 - px, 1.5 + px, s)); }
  if (c > ${LC.cemetery} - .5 && c < ${LC.cemetery} + .5) return land;
  if (c > ${LC.barren} - .5 && c < ${LC.barren} + .5) {   // 裸地（河床、崩塌地、ESA 的裸露地）：留一半影像（山坡崩塌地、河床的深淺），亮度壓到裸土的範圍
    vec3 g = lTint(vec3(.14, .125, .1), satL, .75) * (1. + .3 * ((gN(P / .4).x - .5) * fdF + (n2 - .5) * .7)); float lg = lLum(g);
    return mix(g, land * clamp(lg * 1.3 / max(lLum(land), 1e-3), .5, 1.1), .5); }
  if (c > ${LC.sand} - .5 && c < ${LC.sand} + .5) {   // 地表顏色線 11-24：原本底色是沙黃、再乘上影像的色相（暖色算兩次），亮度又夾在上限——礫石灘、灰黑沙都畫成一樣亮的黃沙。改成中性底色、色相與亮度都跟影像（石城礫石灰褐、外澳與旗津灰黑沙、福隆金黃沙）
    vec3 g = vec3(.25) * mix(vec3(1.), clamp(satL / max(lLum(satL), .004), vec3(.4), vec3(2.2)), .75) * clamp(lLum(land) / .42, .5, 1.35) * (1. + .15 * ((gN(P / .3).x - .5) * fdF + (n2 - .5))); return mix(g, land, .35); }   // 沙灘、礫石灘：顏色跟影像走（花蓮的礫石灘是灰的、西部沙灘偏黃）
  if (c > ${LC.wetland} - .5 && c < ${LC.wetland} + .5) { vec3 g = lTint(vec3(.04, .065, .035), satL, .5) * (1. + .3 * mott); return mix(g, vec3(.02, .035, .035), smoothstep(.62, .66, gN(P / 6.).x) * .7); }
${TW2.soil ? `  if (c > ${LC.construction} - .5 && c < ${LC.construction} + .5) {   // 試作 tw2 soil：OSM 的「施工中」多半是重劃區、園區的範圍，不是整片裸土。底色調淡，一半跟著影像走；影像是綠的地方畫成草
    vec3 g = lTint(vec3(${TW2.num("soilr", 0.2).toFixed(3)}, ${TW2.num("soilg", 0.17).toFixed(3)}, ${TW2.num("soilb", 0.13).toFixed(3)}), satL, .75) * (1. + .25 * ((gN(P / .9).x - .5) * fdF + (n2 - .5) * .8)) * (1. - .15 * lGrid(gRot(P, .4).x, 2.3, .4, px) * step(.55, n3));
    g = mix(g, land * clamp(lLum(g) * 1.2 / max(lLum(land), 1e-3), .5, 1.3), ${TW2.num("soilk", 0.5).toFixed(2)});
    return mix(g, lawn, smoothstep(.5, .6, veg + (n2 - .5) * .3) * .8); }
` : `  if (c > ${LC.construction} - .5 && c < ${LC.construction} + .5) return lTint(vec3(.15, .115, .08), satL, .3) * (1. + .25 * ((gN(P / .9).x - .5) * fdF + (n2 - .5) * .8)) * (1. - .15 * lGrid(gRot(P, .4).x, 2.3, .4, px) * step(.55, n3));
`}  if (c > ${LC.plaza} - .5 && c < ${LC.plaza} + .5) { vec2 cell = floor(Q / .6); return lTint(vec3(.23, .22, .2), satL, .2) * (.9 + .15 * gH(cell) * fdF + .1 * (n3 - .5)) * (1. - .25 * max(lGrid(Q.x, .6, .02, px), lGrid(Q.y, .6, .02, px))); }
  if (c > ${LC.parking} - .5 && c < ${LC.parking} + .5) {   // 停車場：柏油＋白色停車格（5 m 深、2.5 m 寬，兩排夾 6 m 車道）
    vec3 g = vec3(.065, .065, .07) * (1. + .12 * mott);
    float y = mod(Q.y, 16.), inRow = step(y, 5.) + step(11., y), ln = inRow * lGrid(Q.x, 2.5, .1, px) * step(1.2, s);
    return mix(g, vec3(.45, .45, .42), ln * .8); }
  if (c > ${LC.railway} - .5 && c < ${LC.railway} + .5) return lTint(vec3(.12, .11, .1), satL, .3) * (1. + .3 * (gN(P / .25).x - .5) * fdF);
  if (c > ${LC.riverbed} - .5 && c < ${LC.riverbed} + .5) {   // 地表顏色線 11-24：河床（只有中心線的河，bake/landclass.mjs 的 riverbed）：灰色卵石＋離帶子邊 5 m 以上畫一條水（8 m 的溪溝沒有水線，16 m 的間歇河中間約 6 m）；影像很綠（樹冠蓋住的小河）讓影像透出來
    float cob = gN(P / .45).x * fdF * .5 + gN(P / 1.6).x * fdM * .35 + n2 * .3;
    vec3 g = lTint(vec3(.17, .165, .155), satL, .25) * (.75 + .5 * cob);
    vec3 w = vec3(.035, .075, .08) * (.85 + .3 * gN(P / 2.3 + 3.).x) + vec3(.25) * smoothstep(.75, .9, gN(P / .8).x) * fdF * .5;
    return mix(mix(g, w, smoothstep(4.5, 5.5, s)), land, veg * .6); }
  if (c > ${LC.rock} - .5 && c < ${LC.rock} + .5) return mix(lTint(vec3(.16, .155, .145), satL, .5) * (1. + .3 * mott), land, .45);
  if (c > ${LC.greenhouse} - .5 && c < ${LC.greenhouse} + .5) return vec3(.32, .34, .34) * (1. - .2 * lGrid(Q.y, 3.2, .25, px));
  // 街廓（住宅、商業、工業、機關、學校、軍事、ESA 的都市）：柏油與水泥鋪面拼成一塊一塊，接縫；影像很綠的地方是植栽（邊界用雜訊切開，不是糊的）
  vec2 cs = vec2(11. + 5. * h, 8. + 4. * h); vec2 cell = floor(Q / cs); float pk = gH(cell + c * 3.1), dd = gH(cell * 1.3 + 9.);
  vec3 asph = vec3(.07, .07, .072), conc = vec3(.19, .185, .17), tile = vec3(.2, .175, .15);
  bool ind = c > ${LC.industrial} - .5 && c < ${LC.industrial} + .5, sch = c > ${LC.school} - .5 && c < ${LC.school} + .5;
  float cf = 1. - smoothstep(.25, 1.6, px);   // 一塊一塊的拼法只在近處看得到，遠了收成平均色（不會變成方格馬賽克）
  vec3 avg = mix(asph, conc, ind ? .75 : .6), g = pk < (ind ? .25 : .4) ? asph : pk < .85 ? conc : tile; if (sch) g = mix(conc, tile, step(.6, pk));
  g = mix(avg, mix(avg, g, .55), cf);
  g = lTint(g, satL, .3) * (1. + (.12 * (dd - .5) * cf) + .12 * mott);
  if (c > ${LC.urban} - .5 && c < ${LC.urban} + .5) g = mix(g, land, .3);   // ESA 的都市（10 m 衛星分類、鄉下的聚落）裡面有菜園、空地：留一點影像
  vec2 qc = fract(Q / cs) * cs; g *= 1. - .15 * (lLine(qc.x, .06, px) + lLine(qc.y, .06, px)) * (1. - smoothstep(.2, .8, px));
  float pl = smoothstep(.5, .54, veg + (n2 - .5) * .35 + (n1 - .5) * .1 * fdF) * (c > ${LC.military} - .5 && c < ${LC.military} + .5 ? 1. : .9);
  return mix(g, lawn * vec3(.85, .95, .85), pl); }`);
  need("  vec3 pave = ", `  float landW = 0.;
  if (uLandOn > .5 && uSize < 2000.) {
    // 第 119 包：地面分類（land.png 2×2 個像素）
    vec2 tc = uvM * 512. - .5, bf = floor(tc), fr = tc - bf; ivec2 b0 = ivec2(bf);
    vec3 t0 = texelFetch(tLand, clamp(b0, ivec2(0), ivec2(511)), 0).rgb, t1 = texelFetch(tLand, clamp(b0 + ivec2(1, 0), ivec2(0), ivec2(511)), 0).rgb;
    vec3 t2 = texelFetch(tLand, clamp(b0 + ivec2(0, 1), ivec2(0), ivec2(511)), 0).rgb, t3 = texelFetch(tLand, clamp(b0 + ivec2(1, 1), ivec2(0), ivec2(511)), 0).rgb;
    vec4 cs = floor(vec4(t0.r, t1.r, t2.r, t3.r) * 255. + .5), ds = vec4(t0.g, t1.g, t2.g, t3.g) * (255. / 16.), as = vec4(t0.b, t1.b, t2.b, t3.b) * 3.14159265, rs = vec4(0.);
    if (uLandV > 1.5) { vec4 bs = floor(vec4(t0.b, t1.b, t2.b, t3.b) * 255. + .5); rs = (floor(cs / 64.) * 2. + mod(bs, 2.)) / 8.; cs = mod(cs, 64.); as = floor(bs / 2.) / 127. * 3.14159265; }   // 第 121 包：land.png 版本 2
    vec4 ws = vec4((1. - fr.x) * (1. - fr.y), fr.x * (1. - fr.y), (1. - fr.x) * fr.y, fr.x * fr.y);
    vec4 ss = vec4(lS(cs.x, cs, ds, ws), lS(cs.y, cs, ds, ws), lS(cs.z, cs, ds, ws), lS(cs.w, cs, ds, ws));
    float c1 = cs.x, s1 = ss.x, a1 = as.x, r1 = rs.x, wb = ws.x;
    if (ss.y > s1) { c1 = cs.y; s1 = ss.y; } if (ss.z > s1) { c1 = cs.z; s1 = ss.z; } if (ss.w > s1) { c1 = cs.w; s1 = ss.w; }
    float c2 = -1., s2 = -1e3; for (int k = 0; k < 4; k++) { if (abs(cs[k] - c1) > .5 && ss[k] > s2) { c2 = cs[k]; s2 = ss[k]; } if (abs(cs[k] - c1) < .5 && ws[k] >= wb - 1e-5) { a1 = as[k]; r1 = rs[k]; wb = ws[k]; } }
    wb = -1.; float a2 = 0., r2 = 0.; for (int k = 0; k < 4; k++) if (abs(cs[k] - c2) < .5 && ws[k] > wb) { a2 = as[k]; r2 = rs[k]; wb = ws[k]; }
    float pxL = max(pxm, .02), e = c2 < 0. ? 99. : (s1 - s2) * .5;
    vec3 satL = texture2D(tSat, uvS, 3.).rgb;
    bool k1 = c1 > ${LC.water} + .5, k2 = c2 > ${LC.water} + .5;
    vec3 lc = k1 ? lCol(c1, s1, a1, r1, P, pxL, satL, land, veg) : land;
    // 自然地表（樹林、灌叢、裸地、岩、濕地、沙）的邊界：ESA 與 OSM 的多邊形在山上是粗略的折線，用兩層雜訊把邊界推成不規則、放寬到約 1.5 m（不是糊的漸層）；
    //   推的方向照類別碼大小定，兩側算出來是同一條線
    float nat = lNat(c1) + lNat(c2), bw = pxL * .75;
    if (nat > .5 && c2 >= 0.) { e += (c1 < c2 ? 1. : -1.) * ((gN(P / 11.).x - .5) * 6. + (gN(P / 3.3).x - .5) * 1.6); bw = max(bw, 1.5); }
    float tb = smoothstep(-bw, bw, e);
    if (tb < .999) lc = mix(k2 ? lCol(c2, s2, a2, r2, P, pxL, satL, land, veg) : land, lc, tb);
    // 地表顏色線 11-24：海岸線往內約 30 m、分類不是沙灘的地方（OSM／ESA 把灌叢、林地畫到水邊）：10 m 影像在這一帶混了浪花白沫、礫石、草，顏色偏黃；
    //   沒標沙灘的岸邊多是礫石、礁岩、消波塊——不綠的地方收成同亮度的偏灰礫石色（石城—大里）。沙灘照影像（lCol 的 sand）。
    if (k1 && abs(c1 - ${LC.sand}) > .5) lc = mix(lc, vec3(lLum(lc)) * vec3(1.03, 1., .94), smoothstep(-32., -14., sd) * (1. - veg) * .8);
    landW = (1. - smoothstep(4500., 7000., dist)) * (k1 || (tb < .999 && k2) ? 1. : 0.);
    land = mix(land, lc, landW);
  }
  vec3 pave = `);
  sh.fragmentShader = s;
}
export function fx3SimplePatch(m, F) {
  const ob = m.onBeforeCompile, key = m.customProgramCacheKey, T = F.T, f = (x) => (+x).toFixed(4);
  m.onBeforeCompile = (sh, r) => {
    if (ob) ob.call(m, sh, r);
    let v = sh.vertexShader, s = sh.fragmentShader;
    const need = (src, a, b) => {
      if (!src.includes(a)) throw Error("第 117 包簡化建物對不上：" + a.slice(0, 50));
      return src.replace(a, b);
    };
    v = need(v, "#include <common>", "#include <common>\nattribute vec4 aFar; varying vec4 vX3; varying float vX3F; varying vec3 vX3W; varying vec3 vX3N;");
    v = need(v, "#include <beginnormal_vertex>", `#include <beginnormal_vertex>
  { vec4 xa = aFar * 127.; float xw = floor(xa.w + .5), xc = floor(color.a * 255. + .5); vX3F = 0.;
    if (xw < -.5) { vX3 = vec4(xa.x / 127., xa.z / 127., -xw - 1., xc); objectNormal = vec3(0., 1., 0.);${TW2.stair || TW2.heli ? " vX3F = xa.y;" : ""} }
    else { vX3F = xa.y; vX3 = vec4(0., 0., -1. - xw, xc); objectNormal = normalize(vec3(objectNormal.x, 0., objectNormal.z) + vec3(1e-6, 0., 0.)); }
    vX3N = objectNormal; }`);
    v = need(v, "#include <begin_vertex>", "#include <begin_vertex>\nvX3W = (modelMatrix * vec4(transformed, 1.)).xyz;");
    s = need(s, "#include <common>", `#include <common>
varying vec4 vX3; varying float vX3F; varying vec3 vX3W; varying vec3 vX3N; uniform vec3 uSun3;
float x3H(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float x3N(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(x3H(i), x3H(i + vec2(1., 0.)), f.x), mix(x3H(i + vec2(0., 1.)), x3H(i + 1.), f.x), f.y); }
// 抗鋸齒的 [a,b] 方框（w＝這個座標一個像素的寬）
float x3Box(float x, float a, float b, float w){ w = max(w, 1e-4); return clamp((min(x + w * .5, b) - max(x - w * .5, a)) / w, 0., 1.); }
float x3Rough = -1., x3Metal = 0.;${TW2.stair || TW2.heli ? TW2_GLSL : ""}`);
    s = need(s, "#include <roughnessmap_fragment>", `{ float dayK = smoothstep(-.02, .15, uSun3.y);
  if (vX3.z > -.5) {
    // ---- 屋頂：底色（worker 已乘每棟色調）×fr；女兒牆暗邊；中央樓梯間；浪板的分片；低頻風化 ----
    float Lc = mod(vX3.z, 64.), Wc = mod(vX3.w, 64.), rt = floor(vX3.w / 64. + .01), metal = step(63.5, vX3.z);
    float L = exp2(Lc / 9.), W = exp2(Wc / 9.), px = max(length(fwidth(vX3W.xz)), .02);
    vec2 p = vX3.xy * vec2(L, W); float e = min(L - abs(p.x), W - abs(p.y)), noRim = step(61.5, Lc);
    vec3 c = diffuseColor.rgb * ${f(T.fr)};
    float fdN = 1. - smoothstep(1.5, 6., px);
    c *= 1. + .16 * (x3N(vX3W.xz / 6.5 + vX3.w * 1.7) - .5) * fdN;
    if (metal > .5) { float pn = x3H(vec2(floor(p.x / 2.4), vX3.w + floor(p.y / 6.))); c *= 1. + (.3 * pn - .15) * (1. - smoothstep(.8, 2.4, px)); x3Rough = .5; x3Metal = .3; }
    else {
      // 女兒牆：牆腳暗帶 1 m（近景 twRoof3 同一個 .6→1），太遠時帶子變寬但淡，平均暗度不變
      float rw = 1. + px * .6; c *= 1. - .4 * (1. - smoothstep(0., rw, e)) * (1. - noRim) / (1. + px * .35);
      // 樓梯間（公寓、大樓；近景是幾何 3.4×2.8 m）：遠看一塊亮一點的方塊＋背光面暗
      ${TW2.stair || TW2.heli ? `// 試作 tw2：樓梯間照近景同一個位置（tile.worker.js farBuilding 把 roofPlan 的 k＋16×屋突寫在法線 y；沒寫的是 127，照原本）
      if (vX3F < 99.5) { float fk = floor(vX3F + .5), sk = mod(fk, 16.), st = 0.; vec2 sc = tw2Stair(sk, L, W), hs = ${TW2_HS};
        if (sk > .5 && L > 4. && W > 3.) st = x3Box(p.x, sc.x - hs.x, sc.x + hs.x, px) * x3Box(p.y, sc.y - hs.y, sc.y + hs.y, px);
        if (fk > 15.5) { vec2 hA = tw2Tu(L, W) * .5; st = max(st, x3Box(p.x, -hA.x, hA.x, px) * x3Box(p.y, -hA.y, hA.y, px)); }
        c = mix(c, diffuseColor.rgb * 1.08 + .02, st * .8 * (1. - smoothstep(1.2, 3.5, px))); }
      else ` : ""}if (rt > .5 && rt < 1.5 && L > 4. && W > 3.) { float st = x3Box(p.x, -1.7, 1.7, px) * x3Box(p.y, -1.4, 1.4, px); c = mix(c, diffuseColor.rgb * 1.08 + .02, st * .8 * (1. - smoothstep(1.2, 3.5, px))); }
    }
    diffuseColor.rgb = c;
  } else {
    // ---- 牆：每層的窗帶、開間；透天雨遮線、一樓店面或車庫；大樓板緣；帷幕牆偏天空色 ----
    float code = floor((-vX3.z - 1.) / 16. + .01), sd = vX3.w / 255., Fl = vX3F;
    vec3 N = normalize(vX3N); vec2 Tg = vec2(-N.z, N.x); float u = dot(vX3W.xz, Tg);
    float bay = (code < .5 ? 3.6 : code > 4.5 ? 6. : code > 2.5 ? 3.1 : 3.4) * (.9 + .25 * x3H(vec2(sd * 7., 2.)));
    float U = u / bay + sd * 3., cu = fract(U), cv = fract(Fl), k = floor(Fl), wF = fwidth(Fl), wU = fwidth(U);
    float fade = 1. - smoothstep(.22, .6, max(wF, wU * .8));
    vec3 w0 = diffuseColor.rgb * ${f(T.fw / 0.78)};   // worker 把牆色乘了 .78（舊的窗平均），這裡先還原成牆本色
    bool curtain = code > 3.5 && code < 4.5 && k > .5, hall = code > 4.5 && code < 5.5;
    vec3 gM = vec3(.05, .06, .07);
    vec3 sky = mix(vec3(.30, .40, .50), vec3(.55, .62, .70), x3H(vec2(sd * 13., k))) * dayK;
    float A = ${f(T.gl)}, g;   // A＝窗佔牆面的平均比例（＝淡出後的值）
    if (curtain) { vec3 V = normalize(cameraPosition - vX3W); float fr = pow(1. - max(dot(V, N), 0.), 3.);
      gM = mix(mix(gM, mix(vec3(.20, .29, .36), w0 * 1.3, .4), .8), sky, .12 + .45 * fr); A = .85;
      g = 1. - x3Box(cv, .83, 1., wF) * .9 - x3Box(cu, -.03, .03, wU) * .5 - x3Box(cu, .47, .53, wU) * .5; }
    else if (hall) { g = x3Box(cv, .62, .86, wF) * x3Box(cu, .06, .94, wU) * step(.5, k); A = .21 * step(.5, k + .5); w0 *= 1. - .07 * step(.5, fract(u / .9)) * (1. - smoothstep(.15, .45, fwidth(u / .9))); }
    else if (code > 2.5) {   // 十二層以上：一半水平連窗、一半單窗；板緣一條亮
      bool ribbon = x3H(vec2(sd * 3., 5.)) < .45; g = ribbon ? x3Box(cv, .28, .70, wF) * .95 : x3Box(cv, .25, .78, wF) * x3Box(cu, .12, .88, wU);
      w0 = mix(w0, w0 * 1.12 + .02, x3Box(cv, .0, .09, wF) * fade); }
    else if (code < .5) {   // 透天：直窗、窗頂雨遮一條亮、一樓店面或車庫
      g = x3Box(cv, .22, .80, wF) * x3Box(cu, .15, .85, wU);
      w0 = mix(w0, w0 * 1.15 + .03, x3Box(cv, .82, .87, wF) * x3Box(cu, .1, .9, wU) * fade);
      if (k < .5) { g = x3Box(cv, .04, .80, wF) * x3Box(cu, .06, .94, wU) * .75; } }
    else {   // 公寓、華廈：寬窗，一部分有鐵窗（偏亮灰），一部分是陽台（凹進去更暗）
      float colH = x3H(vec2(floor(U), sd * 11.)); g = x3Box(cv, .26, .76, wF) * x3Box(cu, .10, .90, wU);
      if (colH < .3 && code < 1.5) gM = mix(gM, vec3(.26, .27, .27), .6); else if (colH > .78) { g = x3Box(cv, .06, .86, wF) * x3Box(cu, .05, .95, wU) * .62; gM *= .7; }
      if (k < .5 && code < 1.5) g = x3Box(cv, .04, .80, wF) * x3Box(cu, .06, .94, wU) * .7; }
    // 風化：每棟不同的低頻髒污與往下的水痕（孟買 main.pretty.js 785-788 的做法，數值自己定）；像素太大時淡掉，平均不變
    { float px = max(length(fwidth(vX3W.xz)), .02), fdN = 1. - smoothstep(2., 7., px);
      float gr = x3N(vec2(u * .13, Fl * .55) + sd * 17.), stk = x3N(vec2(u * .9 + sd * 9., Fl * .06)) * x3N(vec2(u * .21, sd * 5.));
      w0 *= 1. - (.22 * (gr - .5) + .3 * (stk - .25)) * fdN * (curtain ? .3 : 1.);
      w0 *= mix(.8, 1., smoothstep(0., 2.6, Fl)); }   // 牆腳 8 m 漸暗（近景 fx2 ao 同一個 .8）
    // 樓板線（板下一條陰影）
    w0 *= 1. - .1 * x3Box(cv, .95, 1., wF) * fade * (hall ? 0. : 1.);
    diffuseColor.rgb = mix(w0, gM, mix(A, g, fade));
    if (curtain) { diffuseColor.rgb *= ${f(T.cw)}; x3Rough = .3; x3Metal = .2; }
  } }
#include <roughnessmap_fragment>`);
    s = need(s, "#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nif (x3Rough >= 0.) { roughnessFactor = x3Rough; metalnessFactor = x3Metal; }");
    const winLine = "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.05, .06, .07), .36 * (1. - smoothstep(.3, .7, abs(nW.y))));";
    if (s.includes(winLine)) s = s.replace(winLine, "");
    sh.vertexShader = v;
    sh.fragmentShader = s;
    sh.uniforms.uSun3 = F.sun;
  };
  m.customProgramCacheKey = () => (key ? key.call(m) : "") + "-x3far";
  m.needsUpdate = true;
}
