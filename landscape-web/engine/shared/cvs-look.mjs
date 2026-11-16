export const CVS_BRAND_DEFAULT = true;
export const cvsBrandOn = (search = globalThis.location?.search || "") => {
  const v = new URLSearchParams(search).get("brand");
  return v === "0" ? false : v === "1" ? true : CVS_BRAND_DEFAULT;
};
export const CVS_IDX = { "7eleven": 1, family: 2, hilife: 3, ok: 4, generic: 5 };
export const cvsIdxOf = (brand) => CVS_IDX[brand] || CVS_IDX.generic;
export const CVS_PAL = {
  white: "#f4f4ef",
  gray: "#bfc3c0",
  orange: "#f26f21",
  green7: "#009a3e",
  red7: "#e3202f",
  // 7-ELEVEN：橘、綠、紅
  greenF: "#04a02a",
  blueF: "#1459b8",
  // 全家：綠、藍
  pinkH: "#e8506a",
  redH: "#c0222f",
  // 萊爾富：粉紅紅（寬條）、深紅（細線）
  redO: "#da2032"
  // OK：紅
};
export const CVS_BANDS = {
  1: [["white", 0.1], ["orange", 0.15], ["white", 0.11], ["green7", 0.25], ["white", 0.1], ["red7", 0.17], ["white", 0.12]],
  2: [["white", 0.06], ["greenF", 0.22], ["white", 0.32], ["blueF", 0.32], ["white", 0.08]],
  3: [["white", 0.12], ["pinkH", 0.48], ["white", 0.13], ["redH", 0.1], ["white", 0.17]],
  4: [["white", 0.18], ["redO", 0.1], ["white", 0.08], ["redO", 0.26], ["white", 0.1], ["redO", 0.1], ["white", 0.18]],
  5: [["white", 0.88], ["gray", 0.12]]
  // generic：白色招牌帶，最底一條淡灰線
};
export const CVS_PAL_NAMES = Object.keys(CVS_PAL);
export const cvsBandGLSL = () => {
  const idx = (n) => CVS_PAL_NAMES.indexOf(n);
  let s = "vec3 twCvsBand(float b, float t) {\n";
  for (const [k, stripes] of Object.entries(CVS_BANDS)) {
    let c = 0;
    s += `  if (abs(b - ${k}.) < .5) {
`;
    stripes.forEach(([name, h], i) => {
      c += h;
      s += i === stripes.length - 1 ? `    return uCvsPal[${idx(name)}];
` : `    if (t < ${c.toFixed(3)}) return uCvsPal[${idx(name)}];
`;
    });
    s += "  }\n";
  }
  return s + "  return uCvsPal[0];\n}\n";
};
export const cvsCode = (brand, j0, n) => cvsIdxOf(brand) + 16 * (Math.min(4, Math.max(1, n)) - 1) + 64 * j0;
