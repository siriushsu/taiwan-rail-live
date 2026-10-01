// 片中「全台路網」用的線形：從 data/tra.json 取各線折線、簡化後輸出 film/network.js（OSM 衍生，ODbL）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const tra = JSON.parse(readFileSync(join(here, '../../../data/tra.json'), 'utf8'));
const rad = (x) => (x * Math.PI) / 180;
function simplify(pts, tolDeg) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  const k = Math.cos(rad(23.7));
  while (st.length) {
    const [s, e] = st.pop(); let best = -1, bi = -1;
    const [y1, x1] = pts[s], [y2, x2] = pts[e];
    const L = Math.hypot((x2 - x1) * k, y2 - y1) || 1e-9;
    for (let i = s + 1; i < e; i++) { const d = Math.abs((x2 - x1) * k * (y1 - pts[i][0]) - (x1 - pts[i][1]) * k * (y2 - y1)) / L; if (d > best) { best = d; bi = i; } }
    if (best > tolDeg) { keep[bi] = 1; st.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const lines = tra.lines.filter((l) => !l.aux).map((l) => ({ id: l.id, pts: simplify(l.shape, 0.004).map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]) }));
writeFileSync(join(here, 'network.js'), '// 自動產生：node prototypes/ride-guide/film/build_network.mjs（data/tra.json，OSM 衍生，ODbL）\n' +
  `window.FILM_NETWORK = ${JSON.stringify(lines)};\n`);
console.log(lines.map((l) => `${l.id}:${l.pts.length}`).join(' '));
