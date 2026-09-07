#!/usr/bin/env node
// 林鐵站內股道(含之字形折返股)：把「列車實際停靠的實體股道」補進畫出來的線形。
//
// 為什麼要有這支：TDX 的 AFR Shape 只給營業線的主線形，不含之字形折返股與站內股道，
// 而 0f5bb774 之後列車位置改吃實體股道(rail-3d/physical)，於是停靠中的車會畫在
// 「官方線形之外」——阿里山 94m、神木 164m。2026-09-07 裁示「軌道都要跟新的、正確的
// 資訊」＝畫出來的線要補上已查證的實體股道，不是把車搬回舊線形。
//
// 判準（刻意收得很窄，只補真的會擱淺列車的那幾段）：
//   1. 只看林鐵班次真正會走的實體路徑(dispatch.json 的 afr_sched 派軌)。
//   2. 逐頂點量離「TDX 四條線形」的距離，取出 >50m 的連續段（50m＝verify_afr 的判準）。
//   3. 只留「段內含車站停車點(railway=stop，即列車停靠時的位置)」的段——這才是會讓
//      停靠中的列車離線的原因。其餘離線段是主線形本身的路廊差異(多林 130m、奮起湖 51m、
//      對高岳 66m…)，那是另一種病：兩邊各畫一條會變成雙線，不能用補畫解決，留給
//      線形本身的修正處理，本檔不碰。
//   4. 往兩端延伸到離既有線形 <=20m 為止，讓補上的股道接得回去、不留明顯缺口。
//
// 產出 data/afr_station_tracks.json；build_afr.mjs 會把 lines 原樣接到 data/afr.json 後面
// (aux:true＝畫得出來但不列入路線票根，同 data/tra.json 的成追線)。
// 幾何來源與 rail-3d/physical/network.json 同一份 OSM 匯出(ODbL)，故與列車位置同源。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteRuntime } from '../rail-3d/physical/route-runtime.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
export const OFF_LINE_M = 50;      // 判定「離線」的門檻，與 verify_afr.mjs 同值
export const REJOIN_M = 20;        // 補上的股道往兩端延伸到離既有線形這麼近才收尾（再小就會把
                                   // 主線形本身 10~40m 的路廊差異整段拉進來，變成同一條軌道畫兩條）

const d2seg = (p, a, b) => {
  const k = Math.cos(p[0] * Math.PI / 180), R = 111320;
  const px = (p[1] - a[1]) * k * R, py = (p[0] - a[0]) * R;
  const bx = (b[1] - a[1]) * k * R, by = (b[0] - a[0]) * R, L2 = bx * bx + by * by;
  const t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
};
const d2line = (p, shape) => {
  let m = Infinity;
  for (let i = 1; i < shape.length; i++) { const d = d2seg(p, shape[i - 1], shape[i]); if (d < m) m = d; }
  return m;
};
const hav = (a, b) => {
  const R = 6371000, q = Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * q / 2) ** 2 +
    Math.cos(a[0] * q) * Math.cos(b[0] * q) * Math.sin((b[1] - a[1]) * q / 2) ** 2));
};

export function buildAfrStationTracks({ network, dispatch, track }) {
  const runtime = createRouteRuntime(network, null);
  // 基準線形只取 TDX 原生的四條營業線；已補的股道不列入，否則第二次跑會把自己當基準。
  const base = track.lines.filter(l => !l.aux).map(l => l.shape);
  const distance = p => Math.min(...base.map(shape => d2line(p, shape)));
  const pathIds = new Set();
  for (const [key, plan] of Object.entries(dispatch.plans))
    if (key.startsWith('afr_sched:')) for (const id of plan.pathIds) pathIds.add(id);
  // 車站停車點＝派軌路徑的起訖節點（motion.js 的 dwell 就停在這些點上）
  const coordinate = new Map();
  for (const w of network.ways) w.nodes.forEach((n, i) => coordinate.set(String(n), [w.coordinates[i][1], w.coordinates[i][0]]));
  const stations = track.lines.filter(l => !l.aux).flatMap(l => l.stations);
  const stopNodes = new Map();
  for (const id of pathIds) for (const end of ['from', 'to']) {
    const node = String(network.paths[id][end]), at = coordinate.get(node);
    // 停車點多半有 name，但第一/第二分道那幾個是推估插進來的節點沒有名字：一律回頭認最近的車站
    const near = at && stations.map(s => ({ n: s.name, d: hav(at, [s.lat, s.lon]) })).sort((a, b) => a.d - b.d)[0];
    const name = network.nodeTags[node]?.name || (near && near.d < 200 ? near.n : '');
    if (name) stopNodes.set(node, name);
  }
  const fragments = new Map();
  for (const id of [...pathIds].sort((a, b) => a - b)) {
    const unfolded = runtime.unfold(id);
    const points = unfolded.coordinates.map(c => [c[1], c[0]]), ds = points.map(distance);
    for (let i = 0; i < ds.length;) {
      if (ds[i] <= OFF_LINE_M) { i++; continue; }
      let a = i, b = i;
      while (a > 0 && ds[a - 1] > OFF_LINE_M) a--;
      while (b < ds.length - 1 && ds[b + 1] > OFF_LINE_M) b++;
      const next = b + 1;
      while (a > 0 && ds[a] > REJOIN_M) a--;                 // 往兩端延伸，接回既有線形
      while (b < ds.length - 1 && ds[b] > REJOIN_M) b++;
      const nodes = unfolded.nodeIds.slice(a, b + 1).map(String);
      const named = nodes.filter(n => stopNodes.has(n));
      if (named.length) {
        const key = [...nodes].sort().join(',');             // 同一段的兩個行駛方向合成一筆
        if (!fragments.has(key)) fragments.set(key, {
          station: stopNodes.get(named[0]) || '', nodes, shape: points.slice(a, b + 1),
          worst: Math.max(...ds.slice(a, b + 1)),
          wayIds: [...new Set(unfolded.edges.slice(a, b).map(e => e.wayId))],
        });
      }
      i = next;
    }
  }
  const order = new Map(track.lines.filter(l => !l.aux).flatMap(l => l.stations.map((s, i) => [s.name, i])));
  const list = [...fragments.values()].sort((x, y) =>
    (order.get(x.station) ?? 99) - (order.get(y.station) ?? 99) || x.shape[0][0] - y.shape[0][0]);
  const seen = new Map();
  return list.map(f => {
    const n = (seen.get(f.station) || 0) + 1; seen.set(f.station, n);
    let len = 0; for (let i = 1; i < f.shape.length; i++) len += hav(f.shape[i - 1], f.shape[i]);
    return {
      id: 'AFR_YARD_' + f.station + (n > 1 ? '_' + n : ''),
      name: f.station + '站股道',
      color: track.lines.find(l => l.stations.some(s => s.name === f.station))?.color || '#B03A2E',
      aux: true, stations: [], shape: f.shape, shapeLen: +(len / 1000).toFixed(4),
      station: f.station, wayIds: f.wayIds, offLineM: +f.worst.toFixed(1),
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {  // 路徑含中文，不能用字串拼 file:// 比對
  const network = read('rail-3d/physical/network.json');
  const lines = buildAfrStationTracks({
    network, dispatch: read('rail-3d/physical/dispatch.json'), track: read('data/afr.json'),
  });
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    source: network.source, note: '林鐵之字形折返股與站內股道：TDX Shape 未涵蓋、但班次實際停靠其上，'
      + '幾何取自與列車位置同一份 OSM 匯出(rail-3d/physical/network.json)。aux=true，不列入路線票根。',
    lines,
  };
  fs.writeFileSync(path.join(ROOT, 'data/afr_station_tracks.json'), JSON.stringify(out, null, 1) + '\n');
  // data/afr.json 平常由 build_afr.mjs(要 TDX)產出，這裡只換掉 aux 那幾條，其餘一個位元組都不動。
  const track = read('data/afr.json');
  track.lines = track.lines.filter(l => !l.aux).concat(lines);
  fs.writeFileSync(path.join(ROOT, 'data/afr.json'), JSON.stringify(track));
  for (const l of lines) console.log(`  ${l.id.padEnd(22)} ${String(l.shape.length).padStart(2)}點 ${(l.shapeLen * 1000).toFixed(0).padStart(4)}m 最遠離線 ${l.offLineM}m ways ${l.wayIds.join(',')}`);
  console.log(`data/afr_station_tracks.json：${lines.length} 條站內股道`);
}
