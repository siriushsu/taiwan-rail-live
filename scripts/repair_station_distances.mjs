#!/usr/bin/env node
// 修正「shape 已正確，但 stations[].d 漏算段間接縫」的既有資料。
// 新資料應由 build_tdx.mjs 以實際 assembled shape 累積里程；本腳本只負責修復已發布 JSON。

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = 6371, toR = Math.PI / 180;

function distKm(a, b) {
  const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R;
  const dy = (b[0] - a[0]) * toR * R;
  return Math.hypot(dx, dy);
}

function project(pt, shape) {
  const cum = [0];
  for (let i = 1; i < shape.length; i++) cum[i] = cum[i - 1] + distKm(shape[i - 1], shape[i]);
  let best = { dist: Infinity, d: null };
  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i], b = shape[i + 1], k = Math.cos(a[0] * toR);
    const vx = (b[1] - a[1]) * k, vy = b[0] - a[0];
    const px = (pt[1] - a[1]) * k, py = pt[0] - a[0];
    const L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const dist = distKm(pt, q);
    if (dist < best.dist) best = { dist, d: cum[i] + distKm(a, q) };
  }
  return best;
}

const repairs = [{
  file: 'data/ntdlrt.json', lineId: 'VB',
  stations: new Set(['台北海洋大學', '沙崙', '淡水漁人碼頭']),
}];

for (const job of repairs) {
  const fp = path.join(ROOT, job.file);
  const data = JSON.parse(readFileSync(fp, 'utf8'));
  const line = data.lines.find(l => l.id === job.lineId);
  if (!line) throw new Error(`${job.file}: 找不到 line ${job.lineId}`);
  let changed = 0;
  for (const st of line.stations.filter(s => job.stations.has(s.name))) {
    const pr = project([st.lat, st.lon], line.shape);
    if (pr.dist > 0.02) throw new Error(`${job.lineId}/${st.name}: 離軌 ${(pr.dist * 1000).toFixed(1)}m，拒絕自動改里程`);
    const next = +pr.d.toFixed(4), delta = next - st.d;
    if (Math.abs(delta) > 0.2) throw new Error(`${job.lineId}/${st.name}: 里程差 ${delta.toFixed(3)}km 超過200m gate`);
    if (next !== st.d) {
      console.log(`${job.lineId}/${st.name}: ${st.d.toFixed(4)} → ${next.toFixed(4)}km（${(delta * 1000).toFixed(1)}m）`);
      st.d = next; changed++;
    }
  }
  if (changed) writeFileSync(fp, JSON.stringify(data));
  console.log(`${job.file}: ${changed ? `修正 ${changed} 站` : '已是正確里程，無需改寫'}`);
}
