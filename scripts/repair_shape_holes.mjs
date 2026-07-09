#!/usr/bin/env node
// 補洞:fetch_shapes.py 的 Dijkstra 失敗段當年直接落站對站直線,shape 里留下多公里的
// 「弦」(跨海岬/山體的直線,跟隨高亮特別顯眼)。本腳本用 .overpass_cache 的原始軌道圖
// 離線重路由:先把 25m 內未相連的節點橋接(治 OSM 拓撲斷點),再對每個 >0.5km 的長段
// 重跑 Dijkstra——路由結果比直線長 2% 以上才視為「真弦」接回真軌道;
// 幾乎等長者是直線隧道/直線區間本來就沒中間點,不是錯誤,跳過(腳本因此冪等)。
// 另補建成追線(追分–成功,座標取自時刻表),讓跨線車不再飛直線。
// 用法:node scripts/repair_shape_holes.mjs   (就地改寫 data/tra.json、data/mrt.json;git 即備份)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = 6371, toR = Math.PI / 180, CELL = 0.0006; // ~60m 網格

function distKm(a, b) { // [lat,lon]
  const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R;
  const dy = (b[0] - a[0]) * toR * R;
  return Math.hypot(dx, dy);
}

// ── Overpass cache → 節點圖(附 60m 網格索引) ──
function buildGraph(cacheFile) {
  const res = JSON.parse(readFileSync(cacheFile, 'utf8'));
  const coord = new Map(), adj = new Map(), grid = new Map();
  const edge = (a, b, d) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push([b, d]);
  };
  for (const el of res.elements) {
    if (el.type !== 'way') continue;
    const nodes = el.nodes || [], geom = el.geometry || [];
    if (nodes.length !== geom.length) continue;
    nodes.forEach((nid, i) => coord.set(nid, [geom[i].lat, geom[i].lon]));
    for (let i = 0; i < nodes.length - 1; i++) {
      const d = distKm(coord.get(nodes[i]), coord.get(nodes[i + 1]));
      edge(nodes[i], nodes[i + 1], d); edge(nodes[i + 1], nodes[i], d);
    }
  }
  for (const [nid, c] of coord) {
    const key = Math.round(c[0] / CELL) + ',' + Math.round(c[1] / CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(nid);
  }
  // 橋接拓撲斷點:25m 內互不相連的節點補邊(OSM 端點沒共用 node 的斷軌)
  let bridged = 0;
  for (const [nid, c] of coord) {
    const gx = Math.round(c[0] / CELL), gy = Math.round(c[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of (grid.get((gx + dx) + ',' + (gy + dy)) || [])) {
        if (other <= nid) continue;
        const d = distKm(c, coord.get(other));
        if (d > 0.025) continue;
        if ((adj.get(nid) || []).some(([n]) => n === other)) continue;
        edge(nid, other, d); edge(other, nid, d);
        bridged++;
      }
    }
  }
  return { coord, adj, grid, bridged };
}

function nearestNode({ coord, grid }, pt, maxKm = 0.15) {
  const gx = Math.round(pt[0] / CELL), gy = Math.round(pt[1] / CELL);
  let best = null, bd = maxKm;
  const reach = Math.ceil(maxKm / (CELL * 111)) + 1;
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
    for (const nid of (grid.get((gx + dx) + ',' + (gy + dy)) || [])) {
      const d = distKm(pt, coord.get(nid));
      if (d < bd) { bd = d; best = nid; }
    }
  }
  return best;
}

function dijkstra({ coord, adj }, src, dst, maxKm) {
  if (src === dst) return [src];
  const dist = new Map([[src, 0]]), prev = new Map();
  const heap = [[0, src]];
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (u === dst) break;
    if (d > (dist.get(u) ?? 1e9) || d > maxKm) continue;
    for (const [v, w] of (adj.get(u) || [])) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? 1e9)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); }
    }
  }
  if (!prev.has(dst)) return null;
  const out = [dst];
  while (out[out.length - 1] !== src) out.push(prev.get(out[out.length - 1]));
  return out.reverse();
}

// 站點重投影(修完 shape 里程全變,d 要重算;沿用 despike 的單調投影)
function reprojectStations(ln) {
  const sh = ln.shape, cum = [0];
  for (let i = 1; i < sh.length; i++) cum[i] = cum[i - 1] + distKm(sh[i - 1], sh[i]);
  let prevD = -1e9, moved = 0;
  for (const st of ln.stations) {
    if (st.d == null) continue;
    let bestD = null, bestDist = 1e18;
    for (let j = 0; j < sh.length - 1; j++) {
      if (cum[j + 1] < prevD - 0.3) continue;
      const ax = sh[j][1], ay = sh[j][0], bx = sh[j + 1][1], by = sh[j + 1][0];
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((st.lon - ax) * vx + (st.lat - ay) * vy) / L2)) : 0;
      const q = [ay + vy * t, ax + vx * t];
      const dd = distKm([st.lat, st.lon], q);
      if (dd < bestDist) { bestDist = dd; bestD = cum[j] + distKm(sh[j], q); }
    }
    if (bestD != null) {
      if (Math.abs(bestD - st.d) > 0.05) moved++;
      st.d = bestD; prevD = Math.max(prevD, bestD);
    }
  }
  ln.shapeLen = +cum[cum.length - 1].toFixed(4);
  return moved;
}

function repairFile(dataFile, cacheFile) {
  const G = buildGraph(path.join(ROOT, cacheFile));
  console.log(`${dataFile}: graph ${G.coord.size} nodes, bridged ${G.bridged} gaps(<=25m)`);
  const fp = path.join(ROOT, dataFile);
  const data = JSON.parse(readFileSync(fp, 'utf8'));
  let totalFixed = 0;
  for (const ln of data.lines) {
    if (!ln.shape || ln.shape.length < 2) continue;
    let fixed = 0, straightOk = 0;
    const left = [];
    for (let i = 1; i < ln.shape.length; i++) {
      const gap = distKm(ln.shape[i - 1], ln.shape[i]);
      if (gap <= 0.5) continue;
      const a = nearestNode(G, ln.shape[i - 1]);
      const b = nearestNode(G, ln.shape[i]);
      if (a == null || b == null) { left.push(`${gap.toFixed(1)}km@snap`); continue; }
      const p = dijkstra(G, a, b, gap * 4 + 10);
      if (!p) { left.push(`${gap.toFixed(1)}km@route`); continue; }
      let routed = 0;
      for (let k = 0; k < p.length - 1; k++) routed += distKm(G.coord.get(p[k]), G.coord.get(p[k + 1]));
      if (routed > 3 * gap + 2) { left.push(`${gap.toFixed(1)}km@detour${routed.toFixed(0)}`); continue; }
      if (routed < gap * 1.02) { straightOk++; continue; } // 直線隧道/直線區間:本來就直,不是弦
      const mid = p.map(nid => G.coord.get(nid).map(v => +v.toFixed(6)));
      ln.shape.splice(i, 0, ...mid);
      i += mid.length; fixed++;
    }
    // 去重:相鄰 <3m 的點(路徑端點與原 shape 端點幾乎重合)
    let dedup = 0;
    for (let i = 1; i < ln.shape.length; i++)
      if (distKm(ln.shape[i - 1], ln.shape[i]) < 0.003) { ln.shape.splice(i, 1); i--; dedup++; }
    if (fixed) {
      const moved = reprojectStations(ln);
      console.log(`  ${ln.id}: 接回 ${fixed} 弦(去重 ${dedup} 點),直線段放行 ${straightOk},站里程更動 ${moved}`
        + (left.length ? `,未修 ${left.length} [${left.slice(0, 5).join(',')}]` : ''));
      totalFixed += fixed;
    } else if (left.length) {
      console.log(`  ${ln.id}: 未修 ${left.length} [${left.slice(0, 5).join(',')}],直線段放行 ${straightOk}`);
    }
  }
  return { data, fp, totalFixed, G };
}

// ── main ──
const tra = repairFile('data/tra.json', 'scripts/.overpass_cache/tra.json');

// 成追線(追分–成功):線資料裡沒有這條連絡線,跨線車(追分↔成功)一直飛直線。
// 站座標取自時刻表(線站列也沒有成功站)。
if (!tra.data.lines.some(l => l.id === 'chengzhui')) {
  const sched = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
  const coordOf = name => {
    for (const t of sched.trains) for (const s of t.stops) if (s.name === name) return s;
    return null;
  };
  const zf = coordOf('追分'), cg = coordOf('成功');
  if (zf && cg) {
    const a = nearestNode(tra.G, [zf.lat, zf.lon]);
    const b = nearestNode(tra.G, [cg.lat, cg.lon]);
    const p = a != null && b != null ? dijkstra(tra.G, a, b, 15) : null;
    if (p && p.length > 2) {
      const shape = p.map(nid => tra.G.coord.get(nid).map(v => +v.toFixed(6)));
      let cum = 0;
      for (let k = 1; k < shape.length; k++) cum += distKm(shape[k - 1], shape[k]);
      tra.data.lines.push({
        id: 'chengzhui', name: '成追線（追分–成功）', color: '#3b6ea5', aux: true,
        stations: [
          { name: '追分', lat: zf.lat, lon: zf.lon, d: 0 },
          { name: '成功', lat: cg.lat, lon: cg.lon, d: +cum.toFixed(4) },
        ],
        shape, shapeLen: +cum.toFixed(4),
      });
      console.log(`成追線: 補建 ${shape.length} 點 ${cum.toFixed(2)}km`);
    } else console.log('成追線: 路由失敗,未補');
  } else console.log('成追線: 時刻表查無追分/成功座標,未補');
}
writeFileSync(tra.fp, JSON.stringify(tra.data));
console.log(`WROTE ${tra.fp} (接回 ${tra.totalFixed} 弦)`);

const mrt = repairFile('data/mrt.json', 'scripts/.overpass_cache/mrt.json');
writeFileSync(mrt.fp, JSON.stringify(mrt.data));
console.log(`WROTE ${mrt.fp} (接回 ${mrt.totalFixed} 弦)`);
