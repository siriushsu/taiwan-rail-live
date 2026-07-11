#!/usr/bin/env node
// TDX 原始檔(data/tdx/*.json,由 fetch_tdx.py 抓取)→ 前端班距模擬系統檔:
//   data/trtc.json  台北捷運(TDX 官方幾何/站序/班距/站間時間;環狀線 Y 自 mrt.json 搬入,TDX 無新北捷運資料)
//   data/krtc.json  高雄捷運(紅/橘線)+ 高雄輕軌(C,閉環;無 Frequency 檔,班距用官方公告估算)
//   data/tmrt.json  台中捷運(綠線)
// 產出 schema 與 mrt.json 相容,另加:stations[].dwell(停站秒)、segs[{run}](站間行駛秒)、loop(環線)。
// 用法:node scripts/build_tdx.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TDX = f => JSON.parse(readFileSync(path.join(ROOT, 'data/tdx', f), 'utf8'));
const R = 6371, toR = Math.PI / 180;

function distKm(a, b) { // [lat,lon]
  const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * toR) * toR * R;
  const dy = (b[0] - a[0]) * toR * R;
  return Math.hypot(dx, dy);
}
function havKm(a, b) { return distKm([a.lat, a.lon], [b.lat, b.lon]); }

// WKT LINESTRING / MULTILINESTRING → parts: [[[lat,lon],...],...]
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
// 點投影到折線:回傳 {dist(km), s(弧長 km)}
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
// 取弧長 s 處的座標
function pointAt(part, cum, s) {
  if (s <= 0) return part[0];
  const n = part.length;
  if (s >= cum[n - 1]) return part[n - 1];
  let lo = 0, hi = n - 1;
  while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo]);
  return [part[lo][0] + (part[hi][0] - part[lo][0]) * f, part[lo][1] + (part[hi][1] - part[lo][1]) * f];
}
// 折線切片 s1→s2(含端點;s2<s1 時反向;wrap=true 走環端接回起點)
function slicePart(part, cum, s1, s2, wrap) {
  const total = cum[cum.length - 1];
  if (wrap && s2 <= s1) { // 環線閉合段:s1→終點→起點→s2
    const a = slicePart(part, cum, s1, total, false);
    const b = slicePart(part, cum, 0, s2, false);
    return a.concat(b.slice(1));
  }
  const rev = s2 < s1;
  const [lo, hi] = rev ? [s2, s1] : [s1, s2];
  const out = [pointAt(part, cum, lo)];
  for (let j = 0; j < part.length; j++) if (cum[j] > lo && cum[j] < hi) out.push(part[j]);
  out.push(pointAt(part, cum, hi));
  return rev ? out.reverse() : out;
}
// 環線切片:一律走短弧(跨 seam 自動 wrap)
function ringSlice(part, cum, s1, s2) {
  const T = cum[cum.length - 1];
  const fwd = ((s2 - s1) % T + T) % T;
  if (fwd <= T - fwd) return slicePart(part, cum, s1, s2, s2 < s1);
  return slicePart(part, cum, s2, s1, s1 < s2).reverse();
}

// 縫合碎片:MULTILINESTRING 常被切成多段(施工分段),端點相接(≤tol km)就併成鏈,
// 支線(接在主線中段、端點不相碰)自然留成獨立鏈。每輪取全域最小縫隙先併。
function stitch(parts, tol = 0.15) {
  const chains = parts.filter(p => {
    let L = 0; for (let i = 1; i < p.length; i++) L += distKm(p[i - 1], p[i]);
    return L > 0.02; // 丟掉退化小碎屑
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

// 除毛刺(同 despike_shapes.mjs 演算法):清掉縫合殘留的「出去又折回」小段
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

// S2STravelTime → 站對行駛秒 + 站停站秒
function s2sMaps(file) {
  const run = new Map(), dwell = new Map();
  for (const g of TDX(file)) {
    for (const tt of (g.TravelTimes || [])) {
      const k = tt.FromStationID + '|' + tt.ToStationID;
      if (tt.RunTime > 0 && (!run.has(k) || tt.RunTime < run.get(k))) run.set(k, tt.RunTime);
      if (tt.StopTime > 0) {
        const d = Math.min(300, tt.StopTime); // 終點折返可達數分鐘,上限 300s
        if (!dwell.has(tt.FromStationID) || d > dwell.get(tt.FromStationID)) dwell.set(tt.FromStationID, d);
      }
    }
  }
  return { run, dwell };
}
const runOf = (maps, a, b) => maps.run.get(a + '|' + b) ?? maps.run.get(b + '|' + a) ?? null;
// 無 S2STravelTime 檔的系統(如淡海/安坑輕軌,TDX 未提供)→ 空表,前端以距離/速度回退。
function s2sMapsOpt(file) { try { return s2sMaps(file); } catch (e) { return { run: new Map(), dwell: new Map() }; } }

// Frequency → {peakSec, offSec}(平日;PeakFlag=1 取最小、離峰取涵蓋 13:00 的時段均值)
// 部分系統(如機捷)無「平日」分類、僅「每日」→ 平日缺就退回每日。
function freqOf(file, lineID, routeID) {
  let entries;
  try { entries = TDX(file); } catch (e) { return null; }
  const pick = tag => entries.find(f => f.LineID === lineID && (!routeID || f.RouteID === routeID)
    && f.ServiceDay && f.ServiceDay.ServiceTag === tag);
  const e = pick('平日') || pick('每日');
  if (!e || !e.Headways || !e.Headways.length) return null;
  const hs = e.Headways;
  const peaks = hs.filter(h => h.PeakFlag === '1' && h.MinHeadwayMins > 0);
  const offs = hs.filter(h => h.PeakFlag !== '1' && h.MinHeadwayMins > 0);
  const mid = offs.find(h => h.StartTime <= '13:00' && h.EndTime > '13:00') || offs[0];
  const peakSec = peaks.length ? Math.min(...peaks.map(h => h.MinHeadwayMins)) * 60
    : (mid ? mid.MinHeadwayMins * 60 : null);
  const offSec = mid ? Math.round((mid.MinHeadwayMins + mid.MaxHeadwayMins) / 2) * 60 : peakSec;
  return peakSec ? { peakSec, offSec } : null;
}

function stationMap(file) {
  const m = new Map();
  for (const st of TDX(file)) m.set(st.StationID, {
    id: st.StationID, name: st.StationName.Zh_tw,
    lat: st.StationPosition.PositionLat, lon: st.StationPosition.PositionLon,
  });
  return m;
}
function solOrder(file) {
  const m = new Map();
  for (const l of TDX(file)) m.set(l.LineID, l.Stations.map(s => s.StationID));
  return m;
}
function shapeParts(file) {
  const m = new Map();
  for (const s of TDX(file)) m.set(s.LineID, parseWKT(s.Geometry));
  return m;
}

// 組一條渲染線:碎片先縫合成鏈;每個站對選最貼的鏈切片,
// 兩站在不同鏈(支線交界)時經最近接點跨鏈接合;環線走短弧。
function assemble({ id, name, color, ids, stations, parts, maps, freq, loop, estimated }) {
  const sts = ids.map(sid => {
    const st = stations.get(sid);
    if (!st) throw new Error(`${id}: 找不到站 ${sid}`);
    return st;
  });
  const chains = stitch(parts);
  const chainCums = chains.map(cumOf);
  const n = sts.length;
  const shape = []; const d = [0]; const segs = [];
  const pairs = [];
  for (let i = 0; i < n - 1; i++) pairs.push([i, i + 1]);
  if (loop) pairs.push([n - 1, 0]);
  for (const [ia, ib] of pairs) {
    const A = sts[ia], B = sts[ib];
    // 先試單鏈
    let best = null;
    for (let p = 0; p < chains.length; p++) {
      const pa = project([A.lat, A.lon], chains[p], chainCums[p]);
      const pb = project([B.lat, B.lon], chains[p], chainCums[p]);
      const score = Math.max(pa.dist, pb.dist);
      if (!best || score < best.score) best = { p, pa, pb, score };
    }
    let seg;
    if (best.score <= 0.15) {
      seg = loop
        ? ringSlice(chains[best.p], chainCums[best.p], best.pa.s, best.pb.s)
        : slicePart(chains[best.p], chainCums[best.p], best.pa.s, best.pb.s, false);
    } else {
      // 跨鏈:A 所在鏈 → 最近接點 → B 所在鏈(支線交界,如 大橋頭→三重國小)
      let join = null;
      for (let p = 0; p < chains.length; p++) for (let q = 0; q < chains.length; q++) {
        if (p === q) continue;
        const pa = project([A.lat, A.lon], chains[p], chainCums[p]);
        const pb = project([B.lat, B.lon], chains[q], chainCums[q]);
        if (pa.dist > 0.15 || pb.dist > 0.15) continue;
        let jb = null; // q 的頂點投影到 p 的最近接點
        for (let v = 0; v < chains[q].length; v++) {
          const pj = project(chains[q][v], chains[p], chainCums[p]);
          if (!jb || pj.dist < jb.gap) jb = { gap: pj.dist, sP: pj.s, sQ: chainCums[q][v] };
        }
        const score = pa.dist + pb.dist + jb.gap;
        if (!join || score < join.score) join = { p, q, pa, pb, ...jb, score };
      }
      if (join && join.gap <= 0.25) {
        const s1 = slicePart(chains[join.p], chainCums[join.p], join.pa.s, join.sP, false);
        const s2 = slicePart(chains[join.q], chainCums[join.q], join.sQ, join.pb.s, false);
        seg = s1.concat(s2);
      } else {
        console.warn(`  ⚠ ${id} ${A.name}→${B.name}: 找不到合理路徑(離軌 ${(best.score * 1000).toFixed(0)}m),用直線`);
        seg = [[A.lat, A.lon], [B.lat, B.lon]];
      }
    }
    let len = 0;
    for (let j = 1; j < seg.length; j++) len += distKm(seg[j - 1], seg[j]);
    const straight = havKm(A, B);
    if (len > straight * 3 + 0.5) console.warn(`  ⚠ ${id} ${A.name}→${B.name}: 沿線 ${len.toFixed(2)}km vs 直線 ${straight.toFixed(2)}km(選段可疑)`);
    for (let j = shape.length ? 1 : 0; j < seg.length; j++) shape.push(seg[j]);
    d.push(d[d.length - 1] + len);
    segs.push({ run: runOf(maps, A.id, B.id) });
  }
  const noRun = segs.filter(s => !s.run).length;
  if (noRun) console.warn(`  ⚠ ${id}: ${noRun}/${segs.length} 段無 S2S 時間(前端以距離/速度回退)`);
  // 縫合殘渣除毛刺;有移除就重投影站點里程
  const spikesRemoved = despike(shape);
  if (spikesRemoved) {
    const cum = cumOf(shape);
    let prev = -1e9;
    for (let i = 0; i < n; i++) {
      const pr = project([sts[i].lat, sts[i].lon], shape, cum);
      d[i] = Math.max(pr.s, prev); prev = d[i];
    }
    d[n] = cum[cum.length - 1]; // 環線閉合端
    console.log(`  (${id} 除毛刺 ${spikesRemoved} 頂點,站里程已重投影)`);
  }
  const line = {
    id, name, color,
    peakHeadwaySec: freq ? freq.peakSec : null,
    offpeakHeadwaySec: freq ? freq.offSec : null,
    stations: sts.map((st, i) => ({
      name: st.name, lat: st.lat, lon: st.lon, d: +d[i].toFixed(4),
      ...(maps.dwell.get(st.id) ? { dwell: maps.dwell.get(st.id) } : {}),
    })),
    shape: shape.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]),
    segs,
  };
  if (loop) { line.loop = true; line.loopLen = +d[d.length - 1].toFixed(4); }
  if (estimated) line.headway_estimated = true;
  console.log(`  ${id} ${name}: ${n} 站, shape ${line.shape.length} 點, ${(d[d.length - 1]).toFixed(1)}km, 尖${line.peakHeadwaySec}s/離${line.offpeakHeadwaySec}s`);
  return line;
}

// ─────────────── TRTC 台北捷運 ───────────────
{
  console.log('== TRTC 台北捷運');
  const stations = stationMap('TRTC_Station.json');
  const sol = solOrder('TRTC_StationOfLine.json');
  const shapes = shapeParts('TRTC_Shape.json');
  const maps = s2sMaps('TRTC_S2STravelTime.json');
  const F = 'TRTC_Frequency.json';
  const seq = id => sol.get(id);
  const gMain = seq('G').filter(s => s !== 'G03A');
  const oAll = seq('O');
  const oMain = oAll.filter(s => !s.startsWith('O5'));           // O01..O21 南勢角→迴龍
  const oLuzhou = oAll.filter(s => +s.slice(1) <= 12 || s.startsWith('O5')); // O01..O12+O50..O54 南勢角→蘆洲
  const rMain = seq('R').filter(s => s !== 'R22A');
  const def = (args) => assemble({ ...args, stations, maps });
  const lines = [
    def({ id: 'BR', name: '文湖線', color: '#C48C31', ids: seq('BR'), parts: shapes.get('BR'), freq: freqOf(F, 'BR', 'BR-1') }),
    def({ id: 'R', name: '淡水信義線', color: '#E3002C', ids: rMain, parts: shapes.get('R'), freq: freqOf(F, 'R', 'R-1') }),
    def({ id: 'R_XBT', name: '新北投支線', color: '#F48B9F', ids: ['R22', 'R22A'], parts: shapes.get('R'), freq: freqOf(F, 'R', 'R-3') }),
    def({ id: 'G', name: '松山新店線', color: '#008659', ids: gMain, parts: shapes.get('G'), freq: freqOf(F, 'G', 'G-1') }),
    def({ id: 'G_XBT', name: '小碧潭支線', color: '#8CC8A0', ids: ['G03', 'G03A'], parts: shapes.get('G'), freq: freqOf(F, 'G', 'G-3') }),
    def({ id: 'O_XINZHUANG', name: '中和新蘆線（迴龍）', color: '#F8B61C', ids: oMain, parts: shapes.get('O'), freq: freqOf(F, 'O', 'O-1') }),
    def({ id: 'O_LUZHOU', name: '中和新蘆線（蘆洲）', color: '#F8B61C', ids: oLuzhou, parts: shapes.get('O'), freq: freqOf(F, 'O', 'O-2') }),
    def({ id: 'BL', name: '板南線', color: '#0070BD', ids: seq('BL'), parts: shapes.get('BL'), freq: freqOf(F, 'BL', 'BL-1') }),
  ];
  // 環狀線:TDX 無新北捷運資料,自 mrt.json(OSM 幾何+公告班距估算)搬入
  const oldMrt = JSON.parse(readFileSync(path.join(ROOT, 'data/mrt.json'), 'utf8'));
  const y = oldMrt.lines.find(l => l.id === 'Y');
  if (y) { lines.push(y); console.log(`  Y ${y.name}: 自 mrt.json 搬入(OSM 幾何,班距估算)`); }
  writeFileSync(path.join(ROOT, 'data/trtc.json'), JSON.stringify({
    system: 'TRTC',
    source_notes: '交通部 TDX 運輸資料流通服務(台北捷運路線幾何/站序/班距/站間行駛時間,2026-07 抓取);環狀線為 OSM 幾何+官網公告班距估算',
    lines,
  }));
}

// ─────────────── KRTC 高雄捷運 + KLRT 輕軌 ───────────────
{
  console.log('== KRTC 高雄捷運 + KLRT 環狀輕軌');
  const stations = stationMap('KRTC_Station.json');
  const sol = solOrder('KRTC_StationOfLine.json');
  const shapes = shapeParts('KRTC_Shape.json');
  const maps = s2sMaps('KRTC_S2STravelTime.json');
  const lines = [
    assemble({ id: 'KR', name: '紅線', color: '#E4002B', ids: sol.get('R'), parts: shapes.get('R'), stations, maps, freq: freqOf('KRTC_Frequency.json', 'R') }),
    assemble({ id: 'KO', name: '橘線', color: '#F8981D', ids: sol.get('O'), parts: shapes.get('O'), stations, maps, freq: freqOf('KRTC_Frequency.json', 'O') }),
  ];
  const cStations = stationMap('KLRT_Station.json');
  const cSol = solOrder('KLRT_StationOfLine.json');
  const cShapes = shapeParts('KLRT_Shape.json');
  const cMaps = s2sMaps('KLRT_S2STravelTime.json');
  lines.push(assemble({
    id: 'C', name: '環狀輕軌', color: '#77C043', ids: cSol.get('C'), parts: cShapes.get('C'),
    stations: cStations, maps: cMaps, loop: true, estimated: true,
    freq: { peakSec: 600, offSec: 900 }, // KLRT 無 Frequency 檔:官方公告尖峰約10分/離峰約15分
  }));
  writeFileSync(path.join(ROOT, 'data/krtc.json'), JSON.stringify({
    system: 'KRTC+KLRT',
    source_notes: '交通部 TDX 運輸資料流通服務(高雄捷運紅/橘線與高雄輕軌:路線幾何/站序/站間行駛時間,2026-07 抓取);輕軌班距為官方公告估算(尖峰約10分/離峰約15分)',
    lines,
  }));
}

// ─────────────── TMRT 台中捷運 ───────────────
{
  console.log('== TMRT 台中捷運');
  const stations = stationMap('TMRT_Station.json');
  const sol = solOrder('TMRT_StationOfLine.json');
  const shapes = shapeParts('TMRT_Shape.json');
  const maps = s2sMaps('TMRT_S2STravelTime.json');
  const lines = [
    assemble({ id: 'TG', name: '綠線', color: '#79BB29', ids: sol.get('G'), parts: shapes.get('G'), stations, maps, freq: freqOf('TMRT_Frequency.json', 'G') }),
  ];
  writeFileSync(path.join(ROOT, 'data/tmrt.json'), JSON.stringify({
    system: 'TMRT',
    source_notes: '交通部 TDX 運輸資料流通服務(台中捷運綠線:路線幾何/站序/班距/站間行駛時間,2026-07 抓取)',
    lines,
  }));
}

// ─────────────── TYMC 桃園機場捷運 ───────────────
{
  console.log('== TYMC 桃園機場捷運');
  const stations = stationMap('TYMC_Station.json');
  const sol = solOrder('TYMC_StationOfLine.json');
  const shapes = shapeParts('TYMC_Shape.json');
  const maps = s2sMaps('TYMC_S2STravelTime.json');
  const lines = [
    // 機捷同時有直達車/普通車;此處以全線 22 站的普通車停站型態繪製,班距取 TDX(每日 15 分)。
    assemble({ id: 'A', name: '機場捷運', color: '#8246AF', ids: sol.get('A'), parts: shapes.get('A'), stations, maps, freq: freqOf('TYMC_Frequency.json', 'A', 'A-1') }),
  ];
  writeFileSync(path.join(ROOT, 'data/tymc.json'), JSON.stringify({
    system: 'TYMC',
    source_notes: '交通部 TDX 運輸資料流通服務(桃園機場捷運:路線幾何/站序/班距/站間行駛時間,2026-07 抓取);以普通車全站停靠型態繪製',
    lines,
  }));
}

// ─────────────── NTDLRT 淡海輕軌 ───────────────
{
  console.log('== NTDLRT 淡海輕軌');
  const stations = stationMap('NTDLRT_Station.json');
  const sol = solOrder('NTDLRT_StationOfLine.json');
  const shapes = shapeParts('NTDLRT_Shape.json');
  const maps = s2sMapsOpt('NTDLRT_S2STravelTime.json'); // TDX 無 S2S 檔
  // TDX 把 Y 字路網登記成單一 V 線 14 站序(…V09濱海沙崙→V10淡海新市鎮→V11崁頂→V28海大→V27沙崙→V26漁人碼頭),
  // 整包餵 assemble 會讓綠山尾段(濱海沙崙→崁頂)變成折返毛刺被吃掉,V10/V11 只剩孤站(2026-07-11 使用者回報)。
  // → 拆成兩條實際營運線各自組裝(同 TRTC 新北投支線模式,共用同一包 shape 碎片,分岔在濱海沙崙旁的三角線)。
  const vAll = sol.get('V');
  const vGreen = vAll.filter(s => !['V28', 'V27', 'V26'].includes(s)); // 紅樹林→…→淡海新市鎮→崁頂
  const vBlue = vAll.filter(s => !['V10', 'V11'].includes(s));         // 紅樹林→…→濱海沙崙→海大→沙崙→漁人碼頭
  const freq = { peakSec: 600, offSec: 900 }; // TDX 無 Frequency 檔:官方公告尖峰約10分/離峰約15分
  const lines = [
    assemble({ id: 'V', name: '綠山線', color: '#FF2A00', ids: vGreen, parts: shapes.get('V'), stations, maps, estimated: true, freq }),
    assemble({ id: 'VB', name: '藍海線', color: '#FF2A00', ids: vBlue, parts: shapes.get('V'), stations, maps, estimated: true, freq }),
  ];
  writeFileSync(path.join(ROOT, 'data/ntdlrt.json'), JSON.stringify({
    system: 'NTDLRT',
    source_notes: '交通部 TDX 運輸資料流通服務(淡海輕軌:路線幾何/站序,2026-07 抓取);班距為官方公告估算(尖峰約10分/離峰約15分),TDX 無班距/站間時間檔',
    lines,
  }));
}

// ─────────────── NTALRT 安坑輕軌 ───────────────
{
  console.log('== NTALRT 安坑輕軌');
  const stations = stationMap('NTALRT_Station.json');
  const sol = solOrder('NTALRT_StationOfLine.json');
  const shapes = shapeParts('NTALRT_Shape.json');
  const maps = s2sMapsOpt('NTALRT_S2STravelTime.json'); // TDX 無 S2S 檔
  const lines = [
    assemble({
      id: 'K', name: '安坑輕軌', color: '#9E925E', ids: sol.get('K'), parts: shapes.get('K'),
      stations, maps, estimated: true,
      freq: { peakSec: 720, offSec: 900 }, // TDX 無 Frequency 檔:官方公告尖峰約12分/離峰約15分
    }),
  ];
  writeFileSync(path.join(ROOT, 'data/ntalrt.json'), JSON.stringify({
    system: 'NTALRT',
    source_notes: '交通部 TDX 運輸資料流通服務(安坑輕軌:路線幾何/站序,2026-07 抓取);班距為官方公告估算(尖峰約12分/離峰約15分),TDX 無班距/站間時間檔',
    lines,
  }));
}

// ─────────────── SANYING 三鶯線(TDX 尚未收錄,幾何/站序取自 OSM) ───────────────
{
  console.log('== SANYING 三鶯線');
  const stations = stationMap('SANYING_Station.json');
  const sol = solOrder('SANYING_StationOfLine.json');
  const shapes = shapeParts('SANYING_Shape.json');
  const maps = s2sMapsOpt('SANYING_S2STravelTime.json'); // TDX 未收錄,無 S2S 檔
  const lines = [
    assemble({
      id: 'LB', name: '三鶯線', color: '#79BCE8', ids: sol.get('LB'), parts: shapes.get('LB'),
      stations, maps, estimated: true,
      freq: { peakSec: 360, offSec: 480 }, // 試營運公告:尖峰約6分/離峰約8分
    }),
  ];
  writeFileSync(path.join(ROOT, 'data/sanying.json'), JSON.stringify({
    system: 'NTMC-LB',
    source_notes: '路線幾何與車站座標:OpenStreetMap 貢獻者(ODbL,2026-07 擷取);站序站名:新北捷運公司官網;班距為試營運公告估算(尖峰6分/離峰8分)',
    lines,
  }));
}
console.log('done');
