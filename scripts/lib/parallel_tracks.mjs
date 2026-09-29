// 台鐵股道的平行幾何（共用一份判準）。
//   * build_tra_track_sections.mjs 用它判「站間是單線還是雙線」（交會／待避推論的前提）。
//   * repair_physical_directions.mjs 用它判「這一股的另一股在行進方向的左側還是右側」（靠左行駛規則）。
// 兩支必須吃同一組常數，否則會出現「區間表說雙線、方向修復說單線」這種各說各話；所以判準只寫在這裡。
//
// 判準：另一條正線 way 的某一段，中點距本段中點 ≤ NEAR_M、方向夾角 ≤ ANGLE，且不是 siding／crossover／
// yard／spur。南迴線、臺東線的同名平行隧道 way 曾經一律當「未核實」排除
// （docs/tra-overlap-rootcause-0914.md）。北迴線「一條 way 畫雙軌」的例外由區間表建置器自己處理。
//
// 🔴 2026-09-14 裁示改法：使用者「交通部都有資料，那我們就應該知道有，怎麼會是當作沒有核實就不畫？」
// ⇒ 排除清單不再是「整條線的 ref 一律排除」，改成 **逐對 way 看官方 TDX 幾何怎麼畫**：
// scripts/build_tdx_parallel_evidence.mjs 沿 OSM 線形每 100 m 取樣，量 TDX GIS v3「實體路線」
// （逐股道官方幾何）在該點有沒有間距 3–8 m 的第二股，比例 ≥0.6 判核實；結果落在
// scripts/fixtures/tra-parallel-verified-tdx-0914.json。**只有沒被核實的那幾對才繼續排除。**
// 判單線的代價是多夾一次通過時刻、判雙線的代價是漏掉整段交會推論，兩者不對稱，所以
// 「TDX 說只畫一條」(rejected) 與「TDX 樣本不足」(insufficient) 都維持排除。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NEAR_M = 14, ANGLE = 25 * Math.PI / 180;
export const UNVERIFIED_REFS = new Set(['南迴線', '臺東線', '台東線']);
export const isTrack = w => w.system === 'tra_sched' && w.tags?.railway === 'rail' && !['siding', 'crossover', 'yard', 'spur'].includes(w.tags?.service) && Array.isArray(w.coordinates);
const M = 111320, lat0 = 23.7, kx = M * Math.cos(lat0 * Math.PI / 180);
export const xy = p => [p[0] * kx, p[1] * M];
// 區間表（data/tra_track_sections.json）的鍵：站名正規化後排序，用「|」接起來。
// 🔴 為什麼要正規化：鍵是從派車表 dispatch.plans[].stopSignature 的站名產的（OSM 用字「台東／台北／台南／台中」），
// 而讀它的 index.html 交會／待避推論拿的是班表站名（官方用字「臺東／臺北／臺南／臺中」）——
// 兩邊用字不同，所有含臺／台的站對查表一律落空、又不會報錯（查不到就當「不是單線」），
// 於是臺東|山里、臺北|萬華、臺南|保安… 這些站對在時間模型裡整個失明（2026-09-14 抓到）。
// 統一成班表用字「臺」（不是雙寫兩種鍵）：讀它的是前端，前端只有班表站名；一個鍵一個真相。
export const normSta = n => String(n).replace(/台/g, '臺');
export const sectionKey = (a, b) => [normSta(a), normSta(b)].sort().join('|');
export const segLen = (w, i) => { const A = xy(w.coordinates[i]), B = xy(w.coordinates[i + 1]); return Math.hypot(A[0] - B[0], A[1] - B[1]); };

// 已被官方 TDX 幾何核實為「真的兩股」的 way 對（鍵＝兩個 way id 字串排序後以 | 接起來）。
export const TDX_VERIFIED_PAIRS = (() => {
  const file = new URL('../fixtures/tra-parallel-verified-tdx-0914.json', import.meta.url);
  try {
    const fx = JSON.parse(readFileSync(fileURLToPath(file), 'utf8'));
    return new Set(fx.pairs.filter(p => p.verdict === 'verified').map(p => p.ways.map(String).sort().join('|')));
  } catch { return new Set(); }   // fixture 還沒產出時退回舊行為（整條線排除），不讓建置鏈整個掛掉
})();
const unverifiedPair = (a, b) => a.tags?.tunnel && b.tags?.tunnel && a.tags?.name && a.tags.name === b.tags.name
  && (UNVERIFIED_REFS.has(a.tags?.ref) || UNVERIFIED_REFS.has(b.tags?.ref))
  && !TDX_VERIFIED_PAIRS.has([String(a.id), String(b.id)].sort().join('|'));

// 空間格：50 m 一格，鍵 = cellX:cellY，值 = [{w, i, A, B}]（way 與段序、段的兩端平面座標）
export function makeParallelIndex(ways) {
  const CELL = 50, grid = new Map();
  const cellKey = (x, y) => Math.floor(x / CELL) + ':' + Math.floor(y / CELL);
  for (const w of ways.filter(isTrack)) {
    const c = w.coordinates;
    for (let i = 0; i + 1 < c.length; i++) {
      const A = xy(c[i]), B = xy(c[i + 1]);
      const x0 = Math.min(A[0], B[0]) - NEAR_M, x1 = Math.max(A[0], B[0]) + NEAR_M, y0 = Math.min(A[1], B[1]) - NEAR_M, y1 = Math.max(A[1], B[1]) + NEAR_M;
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        const k = gx + ':' + gy; (grid.get(k) || grid.set(k, []).get(k)).push({ w, i, A, B });
      }
    }
  }
  const cache = new Map();  // wayId:i → {w, distM, side} | null
  // 離本段中點最近的平行段；side = 它在本段（沿節點序前進）的左 'L' 或右 'R'。沒有 → null。
  function nearestParallel(w, i) {
    const key = w.id + ':' + i;
    if (cache.has(key)) return cache.get(key);
    const c = w.coordinates, A = xy(c[i]), B = xy(c[i + 1]);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], dir = Math.atan2(B[1] - A[1], B[0] - A[0]);
    let best = null;
    for (const e of grid.get(cellKey(mid[0], mid[1])) || []) {
      if (e.w === w) continue;
      if (unverifiedPair(w, e.w)) continue;
      const vx = e.B[0] - e.A[0], vy = e.B[1] - e.A[1], L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((mid[0] - e.A[0]) * vx + (mid[1] - e.A[1]) * vy) / L2));
      const px = e.A[0] + vx * t, py = e.A[1] + vy * t, d = Math.hypot(mid[0] - px, mid[1] - py);
      if (d > NEAR_M) continue;
      let ang = Math.abs(Math.atan2(vy, vx) - dir) % Math.PI; ang = Math.min(ang, Math.PI - ang);
      if (ang > ANGLE) continue;
      if (best && d >= best.distM) continue;
      const cross = (B[0] - A[0]) * (py - A[1]) - (B[1] - A[1]) * (px - A[0]);
      best = { w: e.w, distM: d, side: cross > 0 ? 'L' : 'R' };
    }
    cache.set(key, best);
    return best;
  }
  return { nearestParallel, hasParallel: (w, i) => nearestParallel(w, i) !== null };
}
