// 片中「全台路網」用的線形：從 data/tra.json 取各線折線、簡化後輸出 film/network.js（OSM 衍生，ODbL）
// 底圖：data/taiwan_land.json（內政部縣市界線消去內部邊界的海岸線，政府資料開放授權條款）裁到畫面範圍，輸出 film/land.js
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

// 台灣底圖：只留畫面看得到的本島與澎湖、綠島、蘭嶼（金門、馬祖在鏡頭外）
const land = JSON.parse(readFileSync(join(here, '../../../data/taiwan_land.json'), 'utf8'));
const inView = ([lon, lat]) => lon > 119.2 && lon < 122.3 && lat > 21.7 && lat < 25.5;
const polys = land.geometry.coordinates
  .map((poly) => poly[0])
  .filter((ring) => ring.length >= 8 && ring.every(inView))
  .map((ring) => {
    // 封閉環首尾同點，直接簡化會被整條消掉：拆成兩半各自簡化再接回
    const pts = ring.map(([lon, lat]) => [lat, lon]);
    const mid = pts.length >> 1;
    const half = [...simplify(pts.slice(0, mid + 1), 0.0025), ...simplify(pts.slice(mid), 0.0025).slice(1)];
    return half.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]);
  })
  .filter((ring) => ring.length >= 4);
writeFileSync(join(here, 'land.js'), `// 自動產生：node prototypes/ride-guide/film/build_network.mjs（data/taiwan_land.json：${land.properties.source}，${land.properties.license}）\n` +
  `window.FILM_LAND = ${JSON.stringify(polys)};\n`);
console.log('land', polys.map((r) => r.length).join(' '));
