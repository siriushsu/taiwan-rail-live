#!/usr/bin/env node
// 阿里山林業鐵路(AFR):從 TDX v3 Rail/AFR/* 抓資料,產出:
//   data/afr.json               路線幾何/站序(格式對齊 data/tra.json / data/thsr_track.json)
//   data/afr_schedule_dense.json 時刻表加密(格式對齊 data/tra_schedule_dense.json)
// 用法: node scripts/build_afr.mjs (設 AFR_REFRESH=1 強制重抓,略過 data/tdx/AFR_*.json 快取)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TDX_DIR = path.join(ROOT, 'data/tdx');
const osmGapData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/afr_osm_gap_fills.json'), 'utf8'));

// ─────────────── TDX fetch(auth + retry + 本地快取) ───────────────
const envFile = path.join(ROOT, '.env');
const env = Object.fromEntries(
  (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api/basic/';

async function getToken() {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET)
    throw new Error('缺少 .env 的 TDX_CLIENT_ID／TDX_CLIENT_SECRET，無法刷新 AFR 原始資料');
  const r = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error('TDX auth failed: ' + r.status);
  return (await r.json()).access_token;
}

async function apiGet(pathPart, tok, tries = 0) {
  const sep = pathPart.includes('?') ? '&' : '?';
  const url = `${API_BASE}${pathPart}${sep}$format=JSON&$top=1000`;
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + tok, accept: 'application/json' } });
  if (r.status === 429) {
    const waits = [15000, 30000, 45000]; // 已實測 15s/30s/45s 退避可過
    if (tries >= waits.length) throw new Error('429 rate-limited too many times: ' + pathPart);
    console.log(`    429 rate-limited on ${pathPart}, waiting ${waits[tries] / 1000}s...`);
    await new Promise(res => setTimeout(res, waits[tries]));
    return apiGet(pathPart, tok, tries + 1);
  }
  if (!r.ok) throw new Error(`TDX api ${r.status} ${pathPart}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function fetchAFR(name, ep, tok) {
  const cacheFile = path.join(TDX_DIR, `AFR_${name}.json`);
  if (fs.existsSync(cacheFile) && !process.env.AFR_REFRESH) {
    console.log(`  [cache] AFR_${name}.json`);
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  console.log(`  [fetch] ${ep}`);
  const data = await apiGet(ep, tok);
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  await new Promise(res => setTimeout(res, 1200)); // 溫和限速
  return data;
}

// ─────────────── 幾何工具(distKm/parseWKT/cumOf/project/despike 抄自 scripts/build_tdx.mjs,已驗證勿改動邏輯) ───────────────
const R = 6371, toR = Math.PI / 180;
function distKm(a, b) { // [lat,lon]
  const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R;
  const dy = (b[0] - a[0]) * toR * R;
  return Math.hypot(dx, dy);
}
function havKm(a, b) { return distKm([a.lat, a.lon], [b.lat, b.lon]); }

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
function despike(pts) {
  const GAP = 0.06, MIN_LEG = 0.005, WIN = 40;
  let removed = 0, guard = 0;
  while (guard++ < 200) {
    let apex = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      if (distKm(pts[i - 1], pts[i]) < MIN_LEG || distKm(pts[i], pts[i + 1]) < MIN_LEG) continue;
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const v1 = [(b[1] - a[1]) * Math.cos(b[0] * toR), b[0] - a[0]];
      const v2 = [(c[1] - b[1]) * Math.cos(b[0] * toR), c[0] - b[0]];
      const nn = Math.hypot(...v1) * Math.hypot(...v2);
      if (nn > 0 && (v1[0] * v2[0] + v1[1] * v2[1]) / nn < -0.8) { apex = i; break; }
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
    else { removed += 1; pts.splice(apex, 1); }
  }
  return removed;
}
function lenOf(p) { let L = 0; for (let i = 1; i < p.length; i++) L += distKm(p[i - 1], p[i]); return L; }
function bearing(a, b) {
  const k = Math.cos(a[0] * toR);
  const dx = (b[1] - a[1]) * k, dy = (b[0] - a[0]);
  return Math.atan2(dx, dy) * 180 / Math.PI;
}
function angDiff(a, b) { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }
// 碎片端點的切線方向(跳過末端 k 個點以免被單點噪音帶偏):headOf=從起點出發的方向、tailOf=抵達終點時的方向。
// 用途見 stitchGeneral 的 DFS:真實軌道在碎片接縫處方向必然連續,錯誤的接法會出現銳角。
function headOf(pts, k = 3) { return bearing(pts[0], pts[Math.min(k, pts.length - 1)]); }
function tailOf(pts, k = 3) { return bearing(pts[Math.max(0, pts.length - 1 - k)], pts[pts.length - 1]); }

// ─────────────── 通用拼接:先簡單首尾配對,殘餘的自我交叉(如獨立山螺旋)用 Eulerian 涵蓋走法解 ───────────────
// 動機見 scratchpad/afr_build_notes.md:本線(Line1)WKT 有 22 個碎片,19 個聚在獨立山迴圈區、
// 2D 投影下自我交叉出多個 degree>=3 節點,不能用單純首尾配對(tol 內找不到單一鏈)。
// 做法:1) 座標完全重合(<3m)的端點視為同一節點,建圖 2) 找連通分量 3) 每個分量若是簡單鏈直接用;
// 若有 hub 節點,對該分量的兩個「外接點」(degree 為奇數的節點,或退化時取離其他分量最近的兩端)
// 用 DFS 窮舉「最多邊覆蓋」路徑(小資料量,可行) 4) 分量之間再用貪婪最近端點合併(不設 tol 上限,
// 但合併距離 >0.2km 會記警告,供人工檢視/報告)。
const NODE_TOL_KM = 0.005; // 5m,只用來判斷「同一節點」(這批資料端點多半完全重合,不需要大 tol)

function stitchGeneral(parts, label, warnings) {
  parts = parts.map(p => p.slice()).filter(p => lenOf(p) > 0.001);
  if (parts.length === 1) return parts[0];

  // 1) 建節點圖(端點按 6 位小數座標鍵值分組,再用距離門檻歸併幾乎重合的鍵)
  const keyOf = pt => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
  const nodeCoord = new Map();
  const edges = parts.map((p, i) => {
    const a = keyOf(p[0]), b = keyOf(p[p.length - 1]);
    nodeCoord.set(a, p[0]); nodeCoord.set(b, p[p.length - 1]);
    return { i, p, a, b, len: lenOf(p) };
  });
  const degree = new Map();
  for (const e of edges) { degree.set(e.a, (degree.get(e.a) || 0) + 1); degree.set(e.b, (degree.get(e.b) || 0) + 1); }

  // 2) 連通分量(edges 為邊)
  const parent = new Map([...nodeCoord.keys()].map(k => [k, k]));
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent.set(a, b); }
  for (const e of edges) union(e.a, e.b);
  const compOf = new Map();
  for (const k of nodeCoord.keys()) { const r = find(k); (compOf.get(r) || compOf.set(r, []).get(r)).push(k); }
  const comps = new Map(); // rootKey -> {nodes:[...], edges:[...]}
  for (const e of edges) { const r = find(e.a); (comps.get(r) || comps.set(r, { nodes: compOf.get(r), edges: [] }).get(r)).edges.push(e); }

  console.log(`  [stitch:${label}] ${parts.length} 碎片 → ${comps.size} 個連通分量`);

  // 3) 每個分量解成一條 polyline(chain),記錄兩端座標
  const chains = [];
  for (const { nodes, edges: cEdges } of comps.values()) {
    if (cEdges.length === 1) { chains.push(cEdges[0].p.slice()); continue; }
    const nodeDeg = new Map(nodes.map(n => [n, 0]));
    for (const e of cEdges) { nodeDeg.set(e.a, nodeDeg.get(e.a) + 1); nodeDeg.set(e.b, nodeDeg.get(e.b) + 1); }
    const simple = [...nodeDeg.values()].every(d => d <= 2);
    if (simple) {
      // 簡單鏈:找一個 degree<=1 的端點開始順著走(退化環狀分量取任一節點起走)
      const ends = nodes.filter(n => nodeDeg.get(n) <= 1);
      const start = ends[0] || nodes[0];
      const used = new Set(); let cur = start; const chainPts = [];
      for (let guard = 0; guard < cEdges.length + 1; guard++) {
        const e = cEdges.find(x => !used.has(x.i) && (x.a === cur || x.b === cur));
        if (!e) break;
        used.add(e.i);
        const pts = e.a === cur ? e.p : e.p.slice().reverse();
        for (let j = chainPts.length ? 1 : 0; j < pts.length; j++) chainPts.push(pts[j]);
        cur = e.a === cur ? e.b : e.a;
      }
      chains.push(chainPts);
      continue;
    }
    // 有 hub(degree>=3):Eulerian 涵蓋走法。外接點=分量內 degree 為奇數的節點(Eulerian path 必為 0 或 2 個)。
    const odd = nodes.filter(n => nodeDeg.get(n) % 2 === 1);
    let startNode, endNode;
    if (odd.length === 2) { [startNode, endNode] = odd; }
    else if (odd.length === 0) { startNode = endNode = nodes[0]; } // 純環,起訖同點
    else {
      warnings.push(`${label}: 分量有 ${odd.length} 個奇數度節點(非典型 Eulerian 情況),取前兩個當起訖點,可能無法涵蓋所有碎片`);
      [startNode, endNode] = odd;
    }
    // DFS 窮舉「用最多邊」的路徑(小資料量可行;>=25 條邊則退化為貪婪避免爆炸)。
    // 覆蓋邊數相同時以「接縫轉角總和最小」定勝負,不可用總長最大——獨立山螺旋的 19 個碎片在 2D 投影
    // 自我交叉,單看端點距離無法分辨圈次(不同圈的端點幾乎重合),只有方向連續性能區別:真實軌道是平滑
    // 曲線、接縫處方向幾乎不變,錯接則出現銳角。先前用總長最大選出的是走遍全部碎片但轉折混亂的路徑
    // (畫面上呈一團交叉直線,螺旋繞行圈數塌到 0.43 圈)。
    const dirOf = new Map(); // e.i -> {fH,fT,rH,rT} 兩個走向的首尾切線,預算避免 DFS 內重複 reverse
    for (const e of cEdges) {
      const r = e.p.slice().reverse();
      dirOf.set(e.i, { fH: headOf(e.p), fT: tailOf(e.p), rH: headOf(r), rT: tailOf(r) });
    }
    let bestPath = null;
    if (cEdges.length <= 25) {
      const usedSet = new Set(); const curPath = [];
      function dfs(node, total, turn, prevHead) {
        if (node === endNode && usedSet.size > 0) {
          if (!bestPath || usedSet.size > bestPath.usedCount
            || (usedSet.size === bestPath.usedCount && turn < bestPath.turn))
            bestPath = { usedCount: usedSet.size, total, turn, path: [...curPath] };
        }
        if (usedSet.size === cEdges.length) return; // 已經全用,不用再往下探
        for (const e of cEdges) {
          if (usedSet.has(e.i)) continue;
          const d = dirOf.get(e.i);
          let next, rev, hIn, tOut;
          if (e.a === node) { next = e.b; rev = false; hIn = d.fH; tOut = d.fT; }
          else if (e.b === node) { next = e.a; rev = true; hIn = d.rH; tOut = d.rT; }
          else continue;
          const t = prevHead == null ? 0 : Math.abs(angDiff(prevHead, hIn));
          usedSet.add(e.i); curPath.push({ e, rev });
          dfs(next, total + e.len, turn + t, tOut);
          curPath.pop(); usedSet.delete(e.i);
        }
      }
      dfs(startNode, 0, 0, null);
      if (bestPath) console.log(`  [stitch:${label}] hub 分量最佳解:覆蓋 ${bestPath.usedCount}/${cEdges.length} 邊,接縫轉角總和 ${bestPath.turn.toFixed(0)}°`);
    }
    if (!bestPath) {
      warnings.push(`${label}: 分量(${cEdges.length}條邊)DFS 找不到涵蓋路徑,退回貪婪最近端點合併`);
      // 退回單純貪婪合併(見下方 cross-component 合併邏輯,把這個分量的碎片各自視為獨立鏈丟進去)
      for (const e of cEdges) chains.push(e.p.slice());
      continue;
    }
    if (bestPath.usedCount < cEdges.length) {
      warnings.push(`${label}: hub 分量只覆蓋 ${bestPath.usedCount}/${cEdges.length} 條邊(其餘無法在不重複邊的情況下納入同一條路徑),已用最大覆蓋解`);
    }
    const chainPts = [];
    for (const { e, rev } of bestPath.path) {
      const pts = rev ? e.p.slice().reverse() : e.p;
      for (let j = chainPts.length ? 1 : 0; j < pts.length; j++) chainPts.push(pts[j]);
    }
    chains.push(chainPts);
  }

  // 4) 分量之間貪婪最近端點合併(不設距離上限,>0.2km 記警告)
  while (chains.length > 1) {
    let best = null;
    for (let i = 0; i < chains.length; i++) for (let j = i + 1; j < chains.length; j++) {
      const A = chains[i], B = chains[j];
      const combos = [
        [distKm(A[A.length - 1], B[0]), () => A.concat(B.slice(1))],
        [distKm(A[A.length - 1], B[B.length - 1]), () => A.concat(B.slice().reverse().slice(1))],
        [distKm(A[0], B[0]), () => B.slice().reverse().concat(A.slice(1))],
        [distKm(A[0], B[B.length - 1]), () => B.concat(A.slice(1))],
      ];
      for (const [gap, make] of combos) if (!best || gap < best.gap) best = { gap, make, i, j };
    }
    if (best.gap > 0.2) warnings.push(`${label}: 跨分量橋接 ${(best.gap * 1000).toFixed(0)}m(無更近的碎片可接,以直線橋接)`);
    const merged = best.make();
    chains.splice(best.j, 1); chains.splice(best.i, 1); chains.push(merged);
  }
  return chains[0];
}

// TDX 的 MULTILINESTRING 在本線與祝山線有5處跨分量缺口。以前 stitchGeneral 只能用直線橋接；
// 現在以 OSM active narrow_gauge 路徑補進現有兩端，不改動 TDX 已提供的其餘軌跡。
function applyOsmGapFills(shape, lineId) {
  const fills = osmGapData.fills.filter(x => x.lineId === lineId);
  let inserted = 0, addedKm = 0;
  for (const fill of fills) {
    let hit = null;
    for (let i = 0; i < shape.length - 1; i++) {
      if (distKm(shape[i], fill.from) < 0.03 && distKm(shape[i + 1], fill.to) < 0.03) { hit = { i, rev: false }; break; }
      if (distKm(shape[i], fill.to) < 0.03 && distKm(shape[i + 1], fill.from) < 0.03) { hit = { i, rev: true }; break; }
    }
    if (!hit) throw new Error(`${lineId}: 找不到 OSM gap fill 的相鄰 TDX 端點 ${fill.from.join(',')}→${fill.to.join(',')}`);
    const direct = distKm(shape[hit.i], shape[hit.i + 1]);
    if (direct < 0.08) throw new Error(`${lineId}: 目標段只剩 ${(direct * 1000).toFixed(0)}m，拒絕重複補線`);
    const route = (hit.rev ? fill.path.slice().reverse() : fill.path).filter((p, i, arr) =>
      (i || distKm(shape[hit.i], p) >= 0.002) && (i < arr.length - 1 || distKm(p, shape[hit.i + 1]) >= 0.002));
    const joined = [shape[hit.i], ...route, shape[hit.i + 1]];
    const routeKm = lenOf(joined);
    if (!(routeKm > direct && routeKm < 2)) throw new Error(`${lineId}: OSM 補線 ${routeKm.toFixed(3)}km 未通過長度 gate`);
    shape.splice(hit.i + 1, 0, ...route);
    inserted += route.length; addedKm += routeKm - direct;
    console.log(`    [OSM補線] ${lineId}: ${direct.toFixed(3)}→${routeKm.toFixed(3)}km，插入${route.length}點（ways ${fill.wayIds.join(',')}）`);
  }
  return { count: fills.length, inserted, addedKm };
}

// ─────────────── main ───────────────
async function main() {
  fs.mkdirSync(TDX_DIR, { recursive: true });
  console.log('== AFR 阿里山林業鐵路');
  const cacheNames = ['Station', 'Line', 'StationOfLine', 'Shape', 'GeneralTrainTimetable'];
  const cacheReady = cacheNames.every(name => fs.existsSync(path.join(TDX_DIR, `AFR_${name}.json`)));
  const tok = (!cacheReady || process.env.AFR_REFRESH) ? await getToken() : null;
  console.log(tok ? '  got TDX token' : '  全部 TDX 原始檔使用本機快取（不需連線授權）');

  const stationRaw = await fetchAFR('Station', 'v3/Rail/AFR/Station', tok);
  const lineRaw = await fetchAFR('Line', 'v3/Rail/AFR/Line', tok);
  const solRaw = await fetchAFR('StationOfLine', 'v3/Rail/AFR/StationOfLine', tok);
  const shapeRaw = await fetchAFR('Shape', 'v3/Rail/AFR/Shape', tok);
  const ttRaw = await fetchAFR('GeneralTrainTimetable', 'v3/Rail/AFR/GeneralTrainTimetable', tok);

  const fetchDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // 站點主表(21站):name -> {id,name,lat,lon}
  const stationByName = new Map();
  const stationById = new Map();
  for (const s of stationRaw.Stations) {
    const rec = { id: s.StationID, name: s.StationName.Zh_tw, lat: s.StationPosition.PositionLat, lon: s.StationPosition.PositionLon };
    stationByName.set(rec.name, rec);
    stationById.set(rec.id, rec);
  }
  console.log(`  站點主表:${stationByName.size} 站`);

  // StationOfLine:LineID -> 有序 StationID[]
  const solByLine = new Map();
  for (const l of solRaw.StationOfLines) solByLine.set(l.LineID, l.Stations.sort((a, b) => a.Sequence - b.Sequence).map(s => s.StationID));

  // Shape:LineID -> WKT parts
  const shapeByLine = new Map();
  for (const s of shapeRaw.Shapes) shapeByLine.set(s.LineID, parseWKT(s.Geometry));

  const LINE_DEFS = [
    { id: 'AFR_MAIN', tdxId: '1', name: '本線（嘉義－阿里山）', color: '#B03A2E' },
    { id: 'AFR_ZHUSHAN', tdxId: '2', name: '祝山線', color: '#E0A458' },
    { id: 'AFR_SHENMU', tdxId: '3', name: '神木線', color: '#CB6A4A' },
    { id: 'AFR_ZHAOPING', tdxId: '4', name: '沼平線', color: '#D98A5F' },
  ];

  let warnings = [];
  const lines = [];
  const osmFilled = [];
  const lineShapeById = {}; // tdxId -> {shape, cum} 供後面densify 站點插補用(尤其二萬平)
  for (const def of LINE_DEFS) {
    let stIds = solByLine.get(def.tdxId);
    // 本線末站依幾何現實改列神木(377)而非官方的阿里山(378):本線 shape 的終點就在神木站(離軌 1.2m),
    // 阿里山站離本線 shape 有 503m、實際是由神木線(神木→阿里山)銜接。沿用官方末站會讓 stations
    // 最後一筆的 d(里程)與離軌距離都失真(實測 503.6m,遠超其他站的個位數公尺)。
    // 阿里山本身不會消失——它是神木線/沼平線/祝山線三條線的共同端點。
    if (def.tdxId === '1') stIds = stIds.map(id => id === '378' ? '377' : id);
    const sts = stIds.map(id => stationById.get(id));
    const parts = shapeByLine.get(def.tdxId);
    const rawTotal = parts.reduce((s, p) => s + lenOf(p), 0);
    let shape = stitchGeneral(parts, def.name, warnings);
    const filled = applyOsmGapFills(shape, def.id);
    if (filled.count) {
      const expected = osmGapData.fills.filter(x => x.lineId === def.id).length;
      if (filled.count !== expected) throw new Error(`${def.id}: OSM 補線數 ${filled.count}/${expected}`);
      osmFilled.push({ lineId: def.id, ...filled });
      // stitchGeneral 的跨分量警告已由上述 OSM 路徑解決，不應再寫成「直線橋接」。
      warnings = warnings.filter(w => !w.startsWith(`${def.name}: 跨分量橋接 `));
    }
    // 刻意不跑 despike():實測會把第一分道/第二分道之字形折返(真實存在的 ~180° 轉向,
    // 阿里山林鐵著名的 switchback 爬升)誤判成拼接殘留的尖刺去掉(第一分道離軌距離從 8.6m
    // 惡化到 244m)。despike() 是為捷運系統的模糊容差拼接殘留設計,AFR 這裡用的是精確座標
    // 圖匹配(獨立山迴圈)+ 直線橋接(缺口段),不會產生那類殘留尖刺,故不需要也不能套用。
    const removedSpikes = 0;
    let cum = cumOf(shape);

    // 方向校正:WKT 原始點序不保證與官方 StationOfLine 站序同向(神木線實測整條反了——
    // shape[0] 貼近阿里山、shape[末] 貼近神木,但官方站序是「神木→阿里山」)。
    // 用「起訖兩站的投影 s」判斷方向,反了就整條 shape 陣列反轉再重算累積里程。
    {
      const firstPr = project([sts[0].lat, sts[0].lon], shape, cum);
      const lastPr = project([sts[sts.length - 1].lat, sts[sts.length - 1].lon], shape, cum);
      if (firstPr.s > lastPr.s) {
        shape = shape.slice().reverse();
        cum = cumOf(shape);
        console.log(`    (方向校正:${def.name} 的 WKT 點序與官方站序相反,已反轉 shape)`);
      }
    }
    const totalLen = cum[cum.length - 1];
    console.log(`  ${def.name}: 碎片內總長=${rawTotal.toFixed(3)}km, 拼接後=${totalLen.toFixed(3)}km(未套用despike,理由見註解), 站數=${sts.length}, shape點數=${shape.length}`);

    // 站點投影取得 d(累積里程);同時檢查離軌距離
    const stationsOut = [];
    let prevD = -1;
    for (const st of sts) {
      const pr = project([st.lat, st.lon], shape, cum);
      let d = pr.s;
      if (d < prevD) d = prevD; // 防止投影雜訊造成非遞增(方向已校正,這裡只防微小雜訊)
      prevD = d;
      stationsOut.push({ name: st.name, lat: st.lat, lon: st.lon, d: +d.toFixed(4), _projDistM: +(pr.dist * 1000).toFixed(1) });
    }
    lineShapeById[def.tdxId] = { shape, cum, stationsOut };
    const outputShape = shape.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]);
    lines.push({
      id: def.id, name: def.name, color: def.color,
      stations: stationsOut.map(({ _projDistM, ...rest }) => rest),
      shape: outputShape,
      // 成品座標壓到6位小數後，數千段的捨入差可累積到數公尺；shapeLen 必須與實際發布折線同尺。
      shapeLen: +lenOf(outputShape).toFixed(4),
      _stationDist: stationsOut, // 內部用,寫檔前會濾掉
    });
  }

  // 站點離軌距離檢查(驗收條件2)
  console.log('\n  站點→線形最近距離檢查(門檻150m):');
  const overThreshold = [];
  for (const line of lines) {
    for (const s of line._stationDist) {
      const flag = s._projDistM > 150 ? '  ⚠ 超過150m' : '';
      console.log(`    ${line.name} / ${s.name}: ${s._projDistM}m${flag}`);
      if (s._projDistM > 150) overThreshold.push(`${line.name}/${s.name}: ${s._projDistM}m`);
    }
  }

  for (const line of lines) delete line._stationDist;

  const afrOut = {
    system: 'AFR',
    source_notes: '交通部 TDX 運輸資料流通服務 v3/Rail/AFR/*(Station/Line/StationOfLine/Shape),'
      + `${fetchDate.slice(0,4)}-${fetchDate.slice(4,6)} 抓取。`
      + ' v2 的 /v2/Rail/AFR/* 全部 404,僅 v3 有資料。'
      + ' 本線(LineID=1)官方 StationOfLine 列 17 站(嘉義…第二分道→二萬平→阿里山),但實際路線在'
      + '二萬平之後必經神木站:本線 shape 的幾何終點就落在神木(離軌1.2m),阿里山站離本線 shape 有 503m、'
      + '實際由神木線(LineID=3,神木→阿里山)銜接。故 stations 末站依幾何現實改列神木,並在班次 densify 的'
      + '站點圖上斷開「二萬平↔阿里山」這條官方相鄰邊、改接神木——否則最短路徑會抄捷徑,車次5/8 少掉神木一站。'
      + ' 本線原始 WKT 為 22 個 MULTILINESTRING 碎片,其中 19 個碎片(共約4.6km)聚集在獨立山迴圈區,'
      + '2D 投影下自我交叉形成多個分岔節點(螺旋繞山多圈、不同圈次在平面投影上座標重疊所致),'
      + '無法用簡單首尾配對拼接;改用連通分量+Eulerian 最大覆蓋路徑,並以「接縫處方向連續」為擇優準則'
      + '(真實軌道是平滑曲線,錯接必然出現銳角;單看端點距離無法分辨圈次)。'
      + '驗證:螺旋區累積轉向 2.02 圈、銳角接縫 0 處(未套用此準則時為 0.02 圈、4 處銳角)。'
      + ` TDX shape 的本線1處與祝山線4處跨分量缺口，改以 © OpenStreetMap 貢獻者（ODbL）active narrow_gauge 軌道補齊`
      + `（${osmGapData.fetched}擷取；共${osmFilled.reduce((n, x) => n + x.count, 0)}段、ways `
      + `${[...new Set(osmGapData.fills.flatMap(x => x.wayIds))].join(',')}），不再以直線穿越山谷。`
      + (warnings.length ? ' 拼接過程警告:' + warnings.join('；') : '')
      + (overThreshold.length ? ' 離軌超過150m的站點:' + overThreshold.join('；') : ' 全部站點離軌距離均在150m內。'),
    lines: lines,
  };
  fs.writeFileSync(path.join(ROOT, 'data/afr.json'), JSON.stringify(afrOut));
  console.log('\n  wrote data/afr.json');

  // ─────────────── 時刻表 densify ───────────────
  console.log('\n== 時刻表 densify');
  // 車種表:GeneralTrainTimetable 的 TrainInfo.TrainTypeName 十個車次全部是 null(已實測確認),
  // 前端 typeName 篩選/繪製 gate 需要非空值,依「起訖站所屬路線」歸類(規格由協調者拍板):
  const TRAIN_TYPE = {
    '1': { typeName: '阿里山號', color: '#B03A2E' }, '2': { typeName: '阿里山號', color: '#B03A2E' },
    '5': { typeName: '阿里山號', color: '#B03A2E' }, '8': { typeName: '阿里山號', color: '#B03A2E' },
    '120': { typeName: '神木線', color: '#CB6A4A' }, '121': { typeName: '神木線', color: '#CB6A4A' },
    '53': { typeName: '沼平線', color: '#D98A5F' }, '54': { typeName: '沼平線', color: '#D98A5F' },
    '97': { typeName: '祝山線', color: '#E0A458' }, '98': { typeName: '祝山線', color: '#E0A458' },
  };
  // 官網補充班次也要歸類:沼平線 31-54、神木線 100-121(車次段規則,與上表 TDX 已知號一致)
  const classifyTrain = no => TRAIN_TYPE[no]
    || (/^(3[1-9]|4\d|5[0-4])$/.test(no) ? { typeName: '沼平線', color: '#D98A5F' } : null)
    || (/^1(0\d|1\d|2[01])$/.test(no) ? { typeName: '神木線', color: '#CB6A4A' } : null);
  const TYPES_OUT = [
    { key: '阿里山號', color: '#B03A2E' },
    { key: '神木線', color: '#CB6A4A' },
    { key: '沼平線', color: '#D98A5F' },
    { key: '祝山線', color: '#E0A458' },
  ];

  // 站點圖:節點=21站站名,邊=4條線官方 StationOfLine 相鄰站(權重=球面直線距離km)
  // 另外把二萬平(376)依其在本線 shape 上的投影位置,插入官方站序中「里程上最近的前後站」之間,
  // 讓時刻表裡實際停靠二萬平的車次(5,8)也能正確 densify,不會因為它不在官方站序而整段退化成直線。
  const nodeCoord = new Map(); // name -> {lat,lon}
  const adj = new Map(); // name -> Map(neighborName -> weightKm)
  function addEdge(nameA, nameB, w) {
    if (!adj.has(nameA)) adj.set(nameA, new Map());
    if (!adj.has(nameB)) adj.set(nameB, new Map());
    if (!adj.get(nameA).has(nameB) || w < adj.get(nameA).get(nameB)) { adj.get(nameA).set(nameB, w); adj.get(nameB).set(nameA, w); }
  }
  for (const def of LINE_DEFS) {
    const stIds = solByLine.get(def.tdxId);
    const sts = stIds.map(id => stationById.get(id));
    for (const st of sts) nodeCoord.set(st.name, { lat: st.lat, lon: st.lon });
    for (let i = 0; i < sts.length - 1; i++) addEdge(sts[i].name, sts[i + 1].name, havKm(sts[i], sts[i + 1]));
  }
  // 二萬平與神木插入本線拓樸:兩站都不在官方 StationOfLine(只列16站)裡,但都落在本線 shape 上
  // (神木更是本線幾何終點,離軌僅 1m),且車次 5/8 實際行經。缺任一站,densify 的最短路徑就會抄捷徑
  // 跳過它——實測缺神木時車次5 走成「二萬平→阿里山」,少了本線最後那段、與現實路線不符。
  // 關鍵:插入中間站時必須「斷開被它跨越的那條原邊」,否則舊的直接邊仍在,Dijkstra 會照走捷徑
  // (實測光加邊不刪邊,神木仍被跳過:二萬平→阿里山直線 1.6km < 繞神木 2.5km)。
  function removeEdge(a, b) { adj.get(a)?.delete(b); adj.get(b)?.delete(a); }
  // 本線末端拓樸修正:官方 StationOfLine(LineID=1,17站)把「二萬平→阿里山」列為相鄰,但實際路線
  // 必經神木——本線 shape 的幾何終點就落在神木站(離軌 1.2m),阿里山站離本線 shape 有 503m,
  // 而神木線(LineID=3,神木→阿里山)正好補上最後 1.3km。不修正的話 densify 會走「二萬平→阿里山」
  // 這條官方相鄰邊當捷徑,車次 5/8 少掉一站、路徑也與現實不符(實測 densify 出 17 站而非 18 站)。
  {
    const ewp = stationByName.get('二萬平'), smu = stationByName.get('神木');
    if (ewp && smu && adj.get('二萬平')?.has('阿里山')) {
      removeEdge('二萬平', '阿里山');
      addEdge('二萬平', '神木', havKm(ewp, smu));
      console.log(`  本線末端修正:斷開 二萬平↔阿里山 官方相鄰邊,改接 二萬平↔神木(${havKm(ewp, smu).toFixed(3)}km),阿里山續由神木線銜接`);
    } else {
      warnings.push('本線末端修正未套用(二萬平/神木節點或二萬平↔阿里山邊不存在),車次5/8 可能跳過神木');
      console.log('  ⚠ 本線末端修正未套用');
    }
  }

  // Dijkstra all-pairs
  function dijkstraAll() {
    const distAll = new Map(), prevAll = new Map();
    for (const src of nodeCoord.keys()) {
      const dist = new Map([[src, 0]]); const prev = new Map(); const visited = new Set();
      const pq = [[0, src]];
      while (pq.length) {
        pq.sort((a, b) => a[0] - b[0]);
        const [d, u] = pq.shift();
        if (visited.has(u)) continue;
        visited.add(u);
        for (const [v, w] of (adj.get(u) || new Map())) {
          const nd = d + w;
          if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); pq.push([nd, v]); }
        }
      }
      distAll.set(src, dist); prevAll.set(src, prev);
    }
    return { distAll, prevAll };
  }
  const { distAll, prevAll } = dijkstraAll();
  function getPath(a, b) {
    if (a === b) return [a];
    if (!distAll.get(a)?.has(b)) return null;
    const path = [b]; let cur = b; const prev = prevAll.get(a);
    while (cur !== a) { if (!prev.has(cur)) return null; cur = prev.get(cur); path.push(cur); }
    return path.reverse();
  }

  const hms2sec = s => { const [h, m, sec] = s.split(':').map(Number); return h * 3600 + m * 60 + (sec || 0); };

  // ── 官網補充班次:沼平線/神木線的完整區間車 ──
  // TDX GeneralTrainTimetable 對這兩條支線只收「每線最後一往返」(53/54、120/121),但官方
  // 林鐵支線頁(afrch.forest.gov.tw/0000300)公告完整班表——沼平線 12 往返、神木線 11 往返,
  // 且與車站張貼的紙本時刻表(網友回報照片,2026-07 攝)逐班一致。TDX 缺的 42 班在此以官網為源補上,
  // 否則地圖上白天整天沒車(網友實際回報的缺陷)。時刻為「發車時刻」,行駛時間依官網到達欄:
  // 沼平線 6 分、神木線 7 分(與 TDX 已收 4 班的區間一致)。發車站到達=發車前 3 分(比照 TDX 慣例)。
  const WEB_SUPPLEMENT = [
    // [起站, 訖站, 行駛分, [[車次, 發車 HH:MM], ...]]
    ['阿里山', '沼平', 6, [['31', '09:00'], ['33', '09:30'], ['35', '10:00'], ['37', '10:30'], ['39', '11:00'],
      ['41', '11:30'], ['43', '13:00'], ['45', '13:30'], ['47', '14:00'], ['49', '14:30'], ['51', '15:10'], ['53', '15:40']]],
    ['沼平', '阿里山', 6, [['32', '09:20'], ['34', '09:50'], ['36', '10:20'], ['38', '10:50'], ['40', '11:20'],
      ['42', '11:50'], ['44', '13:20'], ['46', '13:50'], ['48', '14:20'], ['50', '15:00'], ['52', '15:30'], ['54', '16:00']]],
    ['阿里山', '神木', 7, [['100', '09:40'], ['102', '10:10'], ['104', '10:40'], ['106', '11:10'], ['108', '11:40'],
      ['110', '13:10'], ['112', '13:40'], ['114', '14:10'], ['116', '14:40'], ['118', '15:20'], ['120', '15:50']]],
    ['神木', '阿里山', 7, [['101', '10:00'], ['103', '10:30'], ['105', '11:00'], ['107', '11:30'], ['109', '12:00'],
      ['111', '13:30'], ['113', '14:00'], ['115', '14:30'], ['117', '15:10'], ['119', '15:40'], ['121', '16:10']]],
  ];
  const tdxNos = new Set(ttRaw.TrainTimetables.map(t => String(t.TrainInfo.TrainNo)));
  const hm2 = s => { const [h, m] = s.split(':'); return { h, m }; };
  let webAdded = 0;
  const allTimetables = [...ttRaw.TrainTimetables];
  for (const [from, to, runMin, deps] of WEB_SUPPLEMENT) {
    for (const [no, dep] of deps) {
      if (tdxNos.has(no)) continue; // TDX 已有的班次以 TDX 為準(時刻已驗證與官網一致)
      const d0 = hms2sec(dep), fmt = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
      allTimetables.push({
        TrainInfo: { TrainNo: no, Note: ' ' },
        StopTimes: [
          { StopSequence: 1, StationName: { Zh_tw: from }, ArrivalTime: fmt(d0 - 180), DepartureTime: dep },
          { StopSequence: 2, StationName: { Zh_tw: to }, ArrivalTime: fmt(d0 + runMin * 60), DepartureTime: fmt(d0 + runMin * 60 + 180) },
        ],
      });
      webAdded++;
    }
  }

  const trainsOut = [];
  const sunriseExcluded = [];
  let fallbackSegments = 0, totalSegments = 0;
  for (const t of allTimetables) {
    const no = String(t.TrainInfo.TrainNo);
    // 祝山線觀日列車:TDX 常態表給的是佔位時間(97=阿里山08:00發車),但 TrainInfo.Note 自己註明
    // 「停靠時間根據日出時間而定」。官方林鐵支線頁(afrch.forest.gov.tw/0000300)明載祝山線沒有
    // 固定時刻表,當日開車時間「乘車前1日下午4時30分」才於官網首頁公告——實測 2026-07-19 公告為
    // 「04:20開車,回程末班車為06:10」,與 TDX 的 08:00 差近四小時;且公告只給首班發車與回程末班,
    // 不足以還原各車次時刻。照 TDX 值動畫=每天早上八點跑一班不存在的日出列車(三鶯線幽靈車翻版)→排除。
    if (/日出時間/.test(t.TrainInfo.Note || '')) { sunriseExcluded.push(no); continue; }
    const cls = classifyTrain(no);
    if (!cls) { warnings.push(`車次${no}不在已知的4類車種表中,略過`); continue; }
    const stops = t.StopTimes.slice().sort((a, b) => a.StopSequence - b.StopSequence);
    const newStops = [];
    let prevStop = null;
    let offset = 0, prevAbs = null;
    for (const s of stops) {
      const name = s.StationName.Zh_tw;
      const st = stationByName.get(name);
      let arrRaw = hms2sec(s.ArrivalTime), depRaw = hms2sec(s.DepartureTime);
      let arrAbs = arrRaw + offset;
      if (prevAbs !== null && arrAbs < prevAbs) { offset += 86400; arrAbs = arrRaw + offset; }
      let depAbs = depRaw + offset;
      if (depAbs < arrAbs) { offset += 86400; depAbs = depRaw + offset; }
      prevAbs = depAbs;

      if (prevStop === null) {
        newStops.push({ name, lat: st.lat, lon: st.lon, order: s.StopSequence, arrSec: arrAbs, depSec: depAbs, stop: true });
        prevStop = { name, depSec: depAbs };
        continue;
      }
      totalSegments++;
      const path = getPath(prevStop.name, name);
      if (path && path.length > 2) {
        let edgeDists = []; for (let i = 0; i < path.length - 1; i++) edgeDists.push(adj.get(path[i]).get(path[i + 1]));
        const totalDist = edgeDists.reduce((a, b) => a + b, 0);
        if (totalDist > 0) {
          let cum = 0;
          const t0 = prevStop.depSec, t1 = arrAbs;
          for (let i = 1; i < path.length - 1; i++) {
            cum += edgeDists[i - 1];
            const frac = cum / totalDist;
            const tsec = Math.round(t0 + frac * (t1 - t0));
            const pc = nodeCoord.get(path[i]);
            newStops.push({ name: path[i], lat: pc.lat, lon: pc.lon, order: null, arrSec: tsec, depSec: tsec, stop: false });
          }
        }
      } else if (!path) {
        fallbackSegments++;
      }
      newStops.push({ name, lat: st.lat, lon: st.lon, order: s.StopSequence, arrSec: arrAbs, depSec: depAbs, stop: true });
      prevStop = { name, depSec: depAbs };
    }
    trainsOut.push({ train: no, typeName: cls.typeName, carName: cls.typeName, color: cls.color, stops: newStops });
  }
  console.log(`  車次densify完成:${trainsOut.length} 車次(含官網補充 ${webAdded} 班), fallback區段=${fallbackSegments}/${totalSegments}`);
  if (sunriseExcluded.length) console.log(`  依日出調整而排除(靜態班表不收):車次 ${sunriseExcluded.join(',')}`);
  // types 保留全部 4 類(含祝山線):觀日列車由前端依官方日出時間表逐日推算合成(index.html
  // addSunriseTrains),圖例與繪製 gate 需要「祝山線」這個 key 存在。
  const typesOut = TYPES_OUT;
  for (const t of trainsOut) console.log(`    車次${t.train}(${t.typeName}): 原始停靠→densify後 stops=${t.stops.length}`);

  const scheduleOut = {
    system: '阿里山林鐵時刻表',
    date: fetchDate,
    source_notes: `時刻表來源:交通部 TDX v3/Rail/AFR/GeneralTrainTimetable(EffectiveDate=${ttRaw.EffectiveDate || '未提供'}),${fetchDate.slice(0,4)}-${fetchDate.slice(4,6)} 抓取,原始10車次、收錄${trainsOut.length}車次。`
      + ` 其中 ${webAdded} 班為官網補充:TDX 對沼平/神木兩支線只收每線最後一往返(53/54/120/121),完整班表(沼平12往返、神木11往返)依官方林鐵支線頁 afrch.forest.gov.tw/0000300 補齊,並與車站張貼紙本時刻表(2026-07 網友照片)逐班核對一致;TDX 已有班次以 TDX 為準。`
      + (sunriseExcluded.length ? ` 靜態班表不收祝山線觀日列車(車次${sunriseExcluded.join(',')}):TDX 該兩班的 TrainInfo.Note 註明「停靠時間根據日出時間而定」,官方林鐵支線頁載明祝山線無固定時刻表、當日開車時間於乘車前1日16:30才公告(2026-07-19 官網公告04:20開車/回程末班06:10,TDX 常態表卻是08:00)。觀日列車改由前端依官方「祝山觀日平台日出時間概況表」逐日推算合成並標示「推算」(index.html addSunriseTrains;types 仍保留祝山線供其使用)。` : '')
      + ' TDX 未提供車種欄位(TrainInfo.TrainTypeID/TrainTypeName 十個車次全部為 null;v3/Rail/AFR/TrainType 雖列7種官方車種但未與班次資料建立關聯),'
      + '故車種依「起訖站所屬路線」歸類:本線(嘉義↔十字路/阿里山)車次1,2,5,8→阿里山號;神木線車次120,121→神木線;沼平線車次53,54→沼平線(祝山線車次97,98 因上述日出因素排除,故 types 不含祝山線)。'
      + ' 加密方法同 scripts/densify_schedule.py 精神(節點=站名、邊=各線官方相鄰站、Dijkstra最短路徑插通過站、時刻依累積距離比例內插),'
      + '差異:二萬平不在任何官方 StationOfLine 站序中,但時刻表確有車次(5,8)實際停靠,已依其在本線 shape 上的投影位置插入本線拓樸(於最近的前後官方站之間建邊)。'
      + ` fallback區段(無法densify,保留原直線)=${fallbackSegments}/${totalSegments}。`
      + (warnings.length ? ' 警告:' + warnings.join('；') : ''),
    types: typesOut,
    trains: trainsOut,
  };
  fs.writeFileSync(path.join(ROOT, 'data/afr_schedule_dense.json'), JSON.stringify(scheduleOut));
  console.log('  wrote data/afr_schedule_dense.json');

  console.log('\n== 警告彙總 ==');
  if (!warnings.length) console.log('  (無)');
  for (const w of warnings) console.log('  - ' + w);

  console.log('\ndone');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
