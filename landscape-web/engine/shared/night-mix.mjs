export const LAMP_MIX = { fast: { na: 0.5, warm: 0.05 }, city: { na: 0.05, warm: 0.1 }, rural: { na: 0.24, warm: 0.12 } };
export const LAMP_RGB = [[1, 0.5, 0.17], [1, 0.72, 0.44], [1, 0.8, 0.6]];
export const lampMixAt = (fast, q = 1) => {
  const { city: c, rural: r } = LAMP_MIX;
  return fast ? LAMP_MIX.fast : { na: r.na + (c.na - r.na) * q, warm: r.warm + (c.warm - r.warm) * q };
};
export const lampTone = (h, m) => h < m.na ? 0 : h < m.na + m.warm ? 0.5 : 1;
export const mixTone = (m) => 0.5 * m.warm + (1 - m.na - m.warm);
export const LAMP_RGB_GLSL = (() => {
  const v = (c) => `vec3(${c.map((x) => x.toFixed(2)).join(", ")})`;
  return `vec3 lampRGB(float t){ return t < .5 ? mix(${v(LAMP_RGB[0])}, ${v(LAMP_RGB[1])}, t * 2.) : mix(${v(LAMP_RGB[1])}, ${v(LAMP_RGB[2])}, t * 2. - 1.); }`;
})();
