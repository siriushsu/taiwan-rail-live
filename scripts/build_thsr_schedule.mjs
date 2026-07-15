#!/usr/bin/env node
// 高鐵當日時刻表 → 前端 sched 模式資料檔,輸出兩檔:
//   data/thsr_schedule_dense.json  班表(schema 同 tra_schedule_dense.json)
//     { system, date, source_notes, types:[{key,color}],
//       trains:[{ train, typeName, carName, color, stops:[{name,lat,lon,order,arrSec,depSec,stop}] }] }
//   data/thsr_track.json           軌道底圖(schema 同 tra.json 的 lines[])
//     { system, source_notes, lines:[{ id, name, color, shape:[[lat,lon]…], shapeLen, stations:[{name,lat,lon,d}] }] }
// 輸入(由 fetch_thsr.py 抓):data/tdx/THSR_{Station,Shape,DailyTimetable}.json
// 做法:把 12 站投影到縫合+RDP 簡化後的 THSR 路線折線取弧長。班表只留排定停靠站;
// 前端 assignSchedShapePaths 依軌道檔把站對貼到 shape、列車沿高鐵曲線跑(不需在班表塞通過點)。
// 用法:node scripts/build_thsr_schedule.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TDX = f => JSON.parse(readFileSync(path.join(ROOT, 'data/tdx', f), 'utf8'));
const R = 6371, toR = Math.PI / 180;
const THSR_COLOR = '#E85D0D'; // 高鐵企業橘

function distKm(a, b) { // [lat,lon]
  const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R;
  const dy = (b[0] - a[0]) * toR * R;
  return Math.hypot(dx, dy);
}
function parseWKT(s) {
  const parts = [];
  for (const m of s.matchAll(/\(([^()]+)\)/g)) {
    parts.push(m[1].split(',').map(p => {
      const [lon, lat] = p.trim().split(/\s+/).map(Number);
      return [lat, lon];
    }));
  }
  return parts;
}
function cumOf(part) {
  const c = [0];
  for (let i = 1; i < part.length; i++) c[i] = c[i - 1] + distKm(part[i - 1], part[i]);
  return c;
}
function project(pt, part, cum) {
  let best = { dist: 1e18, s: 0 };
  for (let j = 0; j < part.length - 1; j++) {
    const ay = part[j][0], ax = part[j][1], by = part[j + 1][0], bx = part[j + 1][1];
    const k = Math.cos(ay * toR);
    const vx = (bx - ax) * k, vy = by - ay;
    const px = (pt[1] - ax) * k, py = pt[0] - ay;
    const L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
    const q = [ay + (by - ay) * t, ax + (bx - ax) * t];
    const dd = distKm(pt, q);
    if (dd < best.dist) best = { dist: dd, s: cum[j] + distKm(part[j], q) };
  }
  return best;
}
function pointAt(part, cum, s) {
  if (s <= 0) return part[0];
  const n = part.length;
  if (s >= cum[n - 1]) return part[n - 1];
  let lo = 0, hi = n - 1;
  while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo]);
  return [part[lo][0] + (part[hi][0] - part[lo][0]) * f, part[lo][1] + (part[hi][1] - part[lo][1]) * f];
}
// 縫合碎片(同 build_tdx.mjs):端點相接就併成一條鏈,取最長鏈為主線。
function stitch(parts, tol = 0.3) {
  const chains = parts.filter(p => {
    let L = 0; for (let i = 1; i < p.length; i++) L += distKm(p[i - 1], p[i]);
    return L > 0.02;
  }).map(p => p.slice());
  for (;;) {
    let best = null;
    for (let i = 0; i < chains.length; i++) for (let j = i + 1; j < chains.length; j++) {
      const A = chains[i], B = chains[j];
      const combos = [
        [distKm(A[A.length - 1], B[0]), () => A.concat(B)],
        [distKm(A[A.length - 1], B[B.length - 1]), () => A.concat(B.slice().reverse())],
        [distKm(A[0], B[0]), () => B.slice().reverse().concat(A)],
        [distKm(A[0], B[B.length - 1]), () => B.concat(A)],
      ];
      for (const [gap, make] of combos) if (gap <= tol && (!best || gap < best.gap)) best = { gap, make, i, j };
    }
    if (!best) break;
    const merged = best.make();
    chains.splice(best.j, 1); chains.splice(best.i, 1); chains.push(merged);
  }
  return chains;
}

const hmsToSec = t => { // "HH:MM" 或 "HH:MM:SS" → 午夜起算秒
  const p = t.split(':').map(Number);
  return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
};

// Douglas-Peucker 簡化(垂距 km):TDX 原始幾何每~12m 一點(35k 點),對動畫過密;
// 高架路段幾近直線 → 大幅減點,寬彎道保真。eps 越大點越少。
function rdp(pts, epsKm) {
  if (pts.length < 3) return pts.slice();
  const perp = (p, a, b) => {
    const k = Math.cos(a[0] * toR);
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (L2 === 0) return distKm(p, a);
    const t = ((px - ax) * dx + (py - ay) * dy) / L2;
    const qx = ax + Math.max(0, Math.min(1, t)) * dx, qy = ay + Math.max(0, Math.min(1, t)) * dy;
    return Math.hypot((px - qx), (py - qy)) * toR * R;
  };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1, fd = epsKm;
    for (let i = lo + 1; i < hi; i++) { const d = perp(pts[i], pts[lo], pts[hi]); if (d > fd) { fd = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([lo, far], [far, hi]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── 載入幾何,縫最長鏈為主線,12 站投影取弧長 ──
const rawShape = TDX('THSR_Shape.json')[0].Geometry;
const chains = stitch(parseWKT(rawShape));
chains.sort((a, b) => cumOf(b)[b.length - 1] - cumOf(a)[a.length - 1]);
const rawLine = chains[0];
const LINE = rdp(rawLine, 0.003), CUM = cumOf(LINE); // 簡化至~3m 垂距(原 50m 太粗,z18 跟車看得出彎道被拉直折角)
console.log(`主線 ${rawLine.length}→${LINE.length} 點(RDP 簡化), ${CUM[CUM.length - 1].toFixed(1)}km (縫合 ${chains.length} 段取最長)`);

const stMap = new Map(); // StationID → {name,lat,lon,s}
for (const st of TDX('THSR_Station.json')) {
  const lat = st.StationPosition.PositionLat, lon = st.StationPosition.PositionLon;
  const pr = project([lat, lon], LINE, CUM);
  if (pr.dist > 1.0) console.warn(`  ⚠ ${st.StationName.Zh_tw} 離線 ${(pr.dist * 1000).toFixed(0)}m`);
  stMap.set(st.StationID, { name: st.StationName.Zh_tw, lat, lon, s: pr.s });
}

const daily = TDX('THSR_DailyTimetable.json');
const trains = [];
let warnMono = 0;
for (const rec of daily) {
  const info = rec.DailyTrainInfo;
  const seq = (rec.StopTimes || []).slice().sort((a, b) => a.StopSequence - b.StopSequence);
  if (seq.length < 2) continue;
  // 排定停靠站 → {station, arrSec, depSec};跨午夜遞增修正
  const sched = [];
  let prev = -1;
  for (const s of seq) {
    const st = stMap.get(s.StationID);
    if (!st) continue;
    let arr = hmsToSec(s.ArrivalTime || s.DepartureTime);
    let dep = hmsToSec(s.DepartureTime || s.ArrivalTime);
    while (arr < prev) arr += 86400;
    while (dep < arr) dep += 86400;
    sched.push({ st, arr, dep });
    prev = dep;
  }
  if (sched.length < 2) continue;
  // 弧長單調性檢查(方向一致性;非單調代表投影或資料異常)
  const arcs = sched.map(x => x.st.s);
  const inc = arcs.every((v, i) => i === 0 || v >= arcs[i - 1]);
  const dec = arcs.every((v, i) => i === 0 || v <= arcs[i - 1]);
  if (!inc && !dec) warnMono++;
  // 班表只留排定停靠站;站間曲線交給前端 assignSchedShapePaths + 軌道檔
  const stops = sched.map((x, i) => ({
    name: x.st.name, lat: +x.st.lat.toFixed(6), lon: +x.st.lon.toFixed(6),
    order: i + 1, arrSec: x.arr, depSec: x.dep, stop: true,
  }));
  trains.push({
    train: info.TrainNo,
    typeName: '高鐵',
    carName: '高鐵',
    color: THSR_COLOR,
    stops,
  });
}

const date = (daily[0] && daily[0].TrainDate || '').replace(/-/g, '');
const out = {
  system: '高鐵時刻表',
  date,
  source_notes: `時刻表來源:交通部 TDX Rail/THSR/DailyTimetable/Today(${date} 當日逐車次,含加開/停駛);路線幾何 Rail/THSR/Shape;站間通過點沿路線幾何依弧長內插`,
  types: [{ key: '高鐵', color: THSR_COLOR }],
  trains,
};
writeFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'), JSON.stringify(out));

// 軌道底圖:單線 = RDP 簡化後的 THSR 主線;stations 依南下(弧長遞增)排序供貼軌
const stationList = [...stMap.values()].sort((a, b) => a.s - b.s)
  .map(st => ({ name: st.name, lat: +st.lat.toFixed(6), lon: +st.lon.toFixed(6), d: +st.s.toFixed(4) }));
writeFileSync(path.join(ROOT, 'data/thsr_track.json'), JSON.stringify({
  system: '高鐵',
  source_notes: '交通部 TDX Rail/THSR/Shape(路線幾何,RDP 簡化)與 Rail/THSR/Station(站點),2026-07 抓取',
  lines: [{
    id: 'THSR', name: '高鐵', color: THSR_COLOR,
    shape: LINE.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]),
    shapeLen: +CUM[CUM.length - 1].toFixed(4),
    stations: stationList,
  }],
}));

const dirs = daily.reduce((m, r) => (m[r.DailyTrainInfo.Direction] = (m[r.DailyTrainInfo.Direction] || 0) + 1, m), {});
console.log(`寫出 ${trains.length} 車次 (原始 ${daily.length};南下D0=${dirs[0]||0}/北上D1=${dirs[1]||0}), 非單調 ${warnMono}`);
console.log(`軌道檔 thsr_track.json: ${LINE.length} 點, ${stationList.length} 站`);
console.log('done');
