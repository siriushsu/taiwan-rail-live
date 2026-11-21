const desatLight = (s, k, tag) => {
  const a = "#include <lights_fragment_end>";
  if (!s.includes(a)) throw Error("tw2 tone 對不上（" + tag + "）：" + a);
  return s.replace(a, `{ const vec3 twTw = vec3(.2126, .7152, .0722); float twTk = ${k}; irradiance = mix(irradiance, vec3(dot(irradiance, twTw)), twTk); iblIrradiance = mix(iblIrradiance, vec3(dot(iblIrradiance, twTw)), twTk); }
${a}`);
};
export function tonePatch(m, TW2) {
  const gain = TW2.num("toneg", 1.35), desat = TW2.num("toned", 0.7), ob = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (ob) ob.call(m, sh, r);
    let s = sh.fragmentShader;
    const a = "#include <color_fragment>";
    if (!s.includes(a)) throw Error("tw2 tone 對不上（路面）：" + a);
    s = s.replace(a, `${a}
  diffuseColor.rgb *= mix(${gain.toFixed(3)}, 1., smoothstep(.12, .2, vColor.r));`);
    sh.fragmentShader = desatLight(s, desat.toFixed(3), "路面");
  };
}
export function toneGround(sh, TW2) {
  const desat = TW2.num("tonegd", 0.5);
  if (desat > 0) sh.fragmentShader = desatLight(sh.fragmentShader, `${desat.toFixed(3)} * (1. - wat)`, "地面");
}
