#!/usr/bin/env node
// 全站軌道幾何回歸：尖刺、反向重走、站距投影、shapeLen 與 AFR OSM 補線。

import { readFileSync } from 'node:fs';

const FILES = ['tra', 'thsr_track', 'trtc', 'tymc', 'ntdlrt', 'ntalrt', 'sanying', 'tmrt', 'krtc', 'afr'];
const R = 6371, toR = Math.PI / 180;
let pass = 0, fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); cond ? pass++ : fail++; };
const distKm = (a, b) => Math.hypot(
  (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R,
  (b[0] - a[0]) * toR * R,
);
const cumOf = shape => {
  const cum = [0]; for (let i = 1; i < shape.length; i++) cum[i] = cum[i - 1] + distKm(shape[i - 1], shape[i]); return cum;
};

function project(pt, shape, cum) {
  let best = { dist: Infinity, d: null };
  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i], b = shape[i + 1], k = Math.cos(a[0] * toR);
    const vx = (b[1] - a[1]) * k, vy = b[0] - a[0], px = (pt[1] - a[1]) * k, py = pt[0] - a[0];
    const L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dist = distKm(pt, q);
    if (dist < best.dist) best = { dist, d: cum[i] + distKm(a, q) };
  }
  return best;
}

function turnCos(a, b, c) {
  const v1 = [(b[1] - a[1]) * Math.cos(b[0] * toR), b[0] - a[0]];
  const v2 = [(c[1] - b[1]) * Math.cos(b[0] * toR), c[0] - b[0]];
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  return n ? (v1[0] * v2[0] + v1[1] * v2[1]) / n : 1;
}

function spikeCount(input) {
  const pts = input.map(p => [...p]), GAP = 0.06, MIN_LEG = 0.005, WIN = 40;
  let removed = 0, guard = 0;
  while (guard++ < 200) {
    let apex = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      if (distKm(pts[i - 1], pts[i]) >= MIN_LEG && distKm(pts[i], pts[i + 1]) >= MIN_LEG
        && turnCos(pts[i - 1], pts[i], pts[i + 1]) < -0.8) { apex = i; break; }
    }
    if (apex < 0) break;
    let best = null;
    for (let a = Math.max(0, apex - WIN); a < apex; a++) for (let b = apex + 1; b <= Math.min(pts.length - 1, apex + WIN); b++) {
      const gap = distKm(pts[a], pts[b]); if (gap > GAP) continue;
      let arc = 0; for (let i = a; i < b; i++) arc += distKm(pts[i], pts[i + 1]);
      if (arc > 2 * gap + 0.05 && (!best || arc - gap > best.score)) best = { a, b, score: arc - gap };
    }
    if (best) { removed += best.b - best.a - 1; pts.splice(best.a + 1, best.b - best.a - 1); }
    else { removed++; pts.splice(apex, 1); }
  }
  return removed;
}

function reverseRevisits(shape) {
  const cellOf = p => `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)}`, grid = new Map();
  shape.forEach((p, i) => { const key = cellOf(p); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); });
  for (let i = 1; i < shape.length - 1; i++) {
    const [cy, cx] = cellOf(shape[i]).split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${cy + dy},${cx + dx}`) || []) {
      if (j <= i + 4 || j >= shape.length - 1 || distKm(shape[i], shape[j]) >= 0.015) continue;
      const vi = [shape[i + 1][0] - shape[i - 1][0], shape[i + 1][1] - shape[i - 1][1]];
      const vj = [shape[j + 1][0] - shape[j - 1][0], shape[j + 1][1] - shape[j - 1][1]];
      const n = Math.hypot(...vi) * Math.hypot(...vj);
      if (n && (vi[0] * vj[0] + vi[1] * vj[1]) / n < -0.5) return 1;
    }
  }
  return 0;
}

const allLines = [];
for (const file of FILES) {
  const data = JSON.parse(readFileSync(`data/${file}.json`, 'utf8'));
  for (const line of data.lines || []) allLines.push({ file, line });
}
ok(allLines.length === 39, `現行軌道 39 條全數載入（${allLines.length}）`);

for (const { file, line } of allLines) {
  const label = `${file}/${line.id}`;
  ok(line.shape?.length >= 2 && line.shape.every(p => p.length === 2 && p.every(Number.isFinite)), `${label} shape 有效`);
  const ds = (line.stations || []).map(s => s.d).filter(Number.isFinite);
  ok(ds.every((d, i) => !i || d >= ds[i - 1]), `${label} 站距單調`);
  if (file !== 'afr') ok(spikeCount(line.shape) === 0, `${label} 無短暫折返尖刺`);
  if (file !== 'afr' && !line.loop) ok(reverseRevisits(line.shape) === 0, `${label} 無同軌反向重走`);
  const cum = cumOf(line.shape);
  if (Number.isFinite(line.shapeLen)) ok(Math.abs(line.shapeLen - cum.at(-1)) < 0.001, `${label} shapeLen 與實際折線一致`);
  if (file !== 'afr' && !line.loop) {
    const worst = (line.stations || []).filter(s => Number.isFinite(s.d)).reduce((w, st) => {
      const pr = project([st.lat, st.lon], line.shape, cum), delta = Math.abs(pr.d - st.d);
      return delta > w.delta ? { name: st.name, delta } : w;
    }, { name: '', delta: 0 });
    ok(worst.delta < 0.03, `${label} 站距貼合 shape（最差 ${worst.name || '無'} ${(worst.delta * 1000).toFixed(1)}m）`);
  }
}

const afr = JSON.parse(readFileSync('data/afr.json', 'utf8'));
const fills = JSON.parse(readFileSync('data/afr_osm_gap_fills.json', 'utf8'));
ok(fills.fills.length === 5 && /OpenStreetMap/.test(fills.source), 'AFR 5處缺口保留 OSM ODbL 來源');
for (const fill of fills.fills) {
  const line = afr.lines.find(l => l.id === fill.lineId), cum = cumOf(line.shape);
  const worst = Math.max(...fill.path.map(p => project(p, line.shape, cum).dist));
  const oldStraight = line.shape.some((p, i) => i && distKm(p, fill.to) < 0.03 && distKm(line.shape[i - 1], fill.from) < 0.03);
  ok(worst < 0.005 && !oldStraight, `${fill.lineId} OSM補線在成品內且舊直線已移除（最大偏差 ${(worst * 1000).toFixed(1)}m）`);
}

console.log(`\n${pass} passed / ${fail} failed`);
if (fail) process.exitCode = 1;
