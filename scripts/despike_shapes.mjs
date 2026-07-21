#!/usr/bin/env node
// 除毛刺:清掉軌道 shape 裡「出去又折回」的 OSM 尋路 artifacts(站場側線/橫渡線繞行),
// 再把各站重新投影回清乾淨的折線、重算里程 d。
// 症狀:列車經過特定站會倒退一小段再前進(2026-07-08 實測 61 個毛刺、773/905 班受影響)。
// 用法:node scripts/despike_shapes.mjs   (就地改寫現行台鐵 data/tra.json;捷運由 build_tdx.mjs 自行除刺)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = 6371, toR = Math.PI / 180;

function distKm(a, b) { // [lat,lon] 折線點
  const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R;
  const dy = (b[0] - a[0]) * toR * R;
  return Math.hypot(dx, dy);
}

function turnCos(a, b, c) {
  const v1 = [(b[1] - a[1]) * Math.cos(b[0] * toR), b[0] - a[0]];
  const v2 = [(c[1] - b[1]) * Math.cos(b[0] * toR), c[0] - b[0]];
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  return n > 0 ? (v1[0] * v2[0] + v1[1] * v2[1]) / n : 1;
}

// 找到急轉 apex 後,在前後窗口找一對「彼此很近、但沿線繞很遠」的點,把中間整段剪掉。
function despike(pts) {
  const GAP = 0.06, MIN_LEG = 0.005, WIN = 40; // km / 頂點數
  let removed = 0, guard = 0;
  while (guard++ < 200) {
    let apex = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      if (distKm(pts[i - 1], pts[i]) < MIN_LEG || distKm(pts[i], pts[i + 1]) < MIN_LEG) continue;
      if (turnCos(pts[i - 1], pts[i], pts[i + 1]) < -0.8) { apex = i; break; }
    }
    if (apex < 0) break;
    let best = null;
    for (let a = Math.max(0, apex - WIN); a < apex; a++) {
      for (let b = apex + 1; b <= Math.min(pts.length - 1, apex + WIN); b++) {
        const g = distKm(pts[a], pts[b]);
        if (g > GAP) continue;
        let arc = 0;
        for (let k = a; k < b; k++) arc += distKm(pts[k], pts[k + 1]);
        if (arc > 2 * g + 0.05) {
          const score = arc - g;
          if (!best || score > best.score) best = { a, b, score };
        }
      }
    }
    if (best) { removed += best.b - best.a - 1; pts.splice(best.a + 1, best.b - best.a - 1); }
    else { removed += 1; pts.splice(apex, 1); } // 兩三個點的小刺:直接拔掉 apex
  }
  return removed;
}

function cumOf(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + distKm(pts[i - 1], pts[i]);
  return c;
}

// 站點投影回折線(依站序限制搜尋起點,保證里程單調)
function reprojectStations(ln) {
  const sh = ln.shape, cum = cumOf(sh);
  let prevD = -1e9;
  const changes = [];
  for (const st of ln.stations) {
    if (st.d == null) continue;
    let bestD = null, bestDist = 1e18;
    for (let j = 0; j < sh.length - 1; j++) {
      if (cum[j + 1] < prevD - 0.3) continue; // 不准倒退超過 300m,鎖單調
      const ax = sh[j][1], ay = sh[j][0], bx = sh[j + 1][1], by = sh[j + 1][0];
      const px = st.lon, py = st.lat;
      const vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      const q = [ay + vy * t, ax + vx * t];
      const dd = distKm([py, px], q);
      if (dd < bestDist) { bestDist = dd; bestD = cum[j] + distKm(sh[j], q); }
    }
    if (bestD != null) {
      if (Math.abs(bestD - st.d) > 0.1) changes.push(`${st.name} ${st.d.toFixed(2)}→${bestD.toFixed(2)}km`);
      st.d = bestD;
      prevD = Math.max(prevD, bestD);
    }
  }
  // shape 被裁短後必須同步刷新總長；舊版只改 stations[].d，會留下過期的 shapeLen。
  ln.shapeLen = +cum[cum.length - 1].toFixed(4);
  return changes;
}

for (const file of ['data/tra.json']) {
  const fp = path.join(ROOT, file);
  const data = JSON.parse(readFileSync(fp, 'utf8'));
  let totalRemoved = 0, totalLenFixed = 0;
  for (const ln of data.lines) {
    if (!ln.shape || ln.shape.length < 3) continue;
    const removed = despike(ln.shape);
    if (removed) {
      const changes = reprojectStations(ln);
      totalRemoved += removed;
      console.log(`${file} ${ln.id}: 移除 ${removed} 個折返頂點;站里程更動 ${changes.length} 站`
        + (changes.length ? ` — ${changes.slice(0, 4).join('、')}${changes.length > 4 ? '…' : ''}` : ''));
    }
    const actualLen = +cumOf(ln.shape).at(-1).toFixed(4);
    if (Object.hasOwn(ln, 'shapeLen') && ln.shapeLen !== actualLen) {
      console.log(`${file} ${ln.id}: shapeLen ${ln.shapeLen}→${actualLen}km`);
      ln.shapeLen = actualLen; totalLenFixed++;
    }
  }
  if (totalRemoved || totalLenFixed) writeFileSync(fp, JSON.stringify(data));
  console.log(`${file}: 共移除 ${totalRemoved} 個頂點、刷新 ${totalLenFixed} 條 shapeLen`
    + (totalRemoved || totalLenFixed ? '(已寫回)' : '(無需改寫)'));
}
