// 台灣的捷運與輕軌雙軌區間全部靠右行駛：對向股道在行進方向的左手邊。
// 真值不取自本專案任何資料，而是 OSM 逐線 route 關聯（往返各一條，成員 way 依行進順序排列），
// 逐點取切線後量對向線在左或在右；量法與資料在 docs/metro-track-side-0909.md，關聯編號列於該檔。
// 也與高雄 oneway=yes 的節點順序（KR 274 點、C 1254 點）互相印證。
import fs from 'node:fs';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';

const pack = JSON.parse(fs.readFileSync('rail-3d/physical/metro-network.json'));
const geometry = createRouteRuntime(pack);
const lineKeys = [...new Set(Object.keys(pack.routes).map(k => k.replace(/:-?1$/, '')))];
// 具名覆蓋率斷言：雙軌線數量會無聲縮水（少一條線、或某線退化成單線都照不到），所以寫死下限。
const expectedDoubleTrack = 16;
const rows = [], failures = [];

const metresX = lat => 111320 * Math.cos(lat * Math.PI / 180);
function side(a, b) {
  const cell = 0.0012, grid = new Map();
  b.forEach((c, i) => {
    const key = Math.round(c[0] / cell) + ',' + Math.round(c[1] / cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  let left = 0, right = 0, unpaired = 0;
  for (let i = 2; i < a.length - 2; i += 2) {
    const p = a[i], mx = metresX(p[1]);
    const tx = (a[i + 2][0] - a[i - 2][0]) * mx, ty = (a[i + 2][1] - a[i - 2][1]) * 111320;
    const tl = Math.hypot(tx, ty);
    if (tl < 3) continue;
    const ux = tx / tl, uy = ty / tl;
    let best = null;
    const gx = Math.round(p[0] / cell), gy = Math.round(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get((gx + dx) + ',' + (gy + dy)) || []) {
      const q = b[j], ex = (q[0] - p[0]) * mx, ey = (q[1] - p[1]) * 111320, d = Math.hypot(ex, ey);
      // 2 m 以內視為共用同一段股道：雙軌中心距不會小於 3 m。
      if (d < 2 || d > 45) continue;
      if (!best || d < best.d) best = {d, ex, ey};
    }
    if (!best) { unpaired++; continue; }
    // 只認橫向分量夠大的配對：來源只畫一條中心線的區間（例如台中綠線北段）兩個方向
    // 拿到同一批座標，最近點落在自己前後方，量到的左右是取樣位移造成的雜訊。
    const lateral = -best.ex * uy + best.ey * ux;
    if (Math.abs(lateral) < 1.5) { unpaired++; continue; }
    if (lateral > 0) left++; else right++;
  }
  return {left, right, unpaired};
}

let measured = 0;
for (const key of lineKeys) {
  const a = pack.routes[key + ':1'], b = pack.routes[key + ':-1'];
  if (!a || !b) { rows.push({key, verdict: '缺少對向路線'}); continue; }
  const ca = geometry.route(a.pathIds, key.split(':')[0], '#000').coordinates;
  const cb = geometry.route(b.pathIds, key.split(':')[0], '#000').coordinates;
  const {left, right, unpaired} = side(ca, cb), total = left + right;
  if (total < 30) { rows.push({key, verdict: '單線或樣本不足', total, unpaired}); continue; }
  measured++;
  const leftShare = left / total;
  const verdict = leftShare > 0.85 ? '靠右' : leftShare < 0.15 ? '靠左' : `混合 ${Math.round(leftShare * 100)}% 對向在左`;
  rows.push({key, verdict, total, unpaired, leftShare});
  if (leftShare <= 0.85) failures.push(`${key} 應靠右（對向在左），實測 ${verdict}；樣本 ${total}`);
}
if (measured < expectedDoubleTrack) failures.push(`可量測的雙軌線只有 ${measured} 條，少於預期的 ${expectedDoubleTrack} 條`);
// 建置端偏好只在重建 .cache 時才跑得到，這裡靜態擋住它被改回偏左（減號）。
const builder = fs.readFileSync('scripts/build_metro_physical_routes.mjs', 'utf8');
if (!builder.includes('cost:p.lengthM*.001+side')) failures.push('build_metro_physical_routes.mjs 的股道偏好不是偏右（應為 +side）');

for (const r of rows) console.log(r.key.padEnd(20), r.verdict.padEnd(22), r.total === undefined ? '' : `樣本 ${r.total} 無配對 ${r.unpaired}`);
if (failures.length) {
  console.error(`捷運股道左右驗收失敗（${failures.length} 項）`);
  for (const f of failures) console.error('- ' + f);
  process.exit(1);
}
console.log(`捷運股道左右驗收通過：${measured} 條雙軌線全部靠右行駛（對向股道在左）`);
