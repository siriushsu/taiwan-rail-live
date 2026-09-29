// 僅補入公開 OSM 既有股道；接頭必須同 node ID，不補直線、不位移原軌道（與 extend_guangci_physical.mjs 同一條原則）。
//
// 為什麼要補：build_physical_routes → pack_physical_network 只把候選路徑走過的 way 打包進 network.json，而路徑搜尋
// 從不走 service=yard（topology.js 的 allowYard 預設關），所以站場咽喉裡 16–130 m 的 yard 連接段整批沒進出貨路網，
// 月台旁的到發線只剩一端接著正線。F2 修不掉的 438 筆「無順向路徑」有 81 筆只差這幾段
// （docs/tra-overlap-rootcause-0914.md 9.6）。這裡只補乾跑證明有人走的 9 條（fixture 的 basis），不把整個站場搬進來；
// 路徑搜尋端另有「沒有純正線順向路徑才准走、一條路徑的 yard 總長 ≤ YARD_CAP_M」的規則（scripts/lib/track_directions.mjs）。
//
// 跑法：node scripts/extend_tra_station_throats.mjs（就地改 rail-3d/physical/network.json；NETWORK=／OUT= 可換檔）。
// 🔴 重新打包 network.json 之後要再跑一次；用 extensions 記錄判斷是否已補入，重跑無害。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { restorePhysicalRoutes } from './lib/restore_physical_routes.mjs';
import { distanceM } from '../rail-3d/integration/train-path.js';

const NAME = 'F6 台鐵站場咽喉連接段', FIXTURE = 'scripts/fixtures/tra-station-throats-osm-0914.json';
const file = process.env.NETWORK || 'rail-3d/physical/network.json', out = process.env.OUT || file;
const net = JSON.parse(fs.readFileSync(file, 'utf8'));
if (net.extensions?.some(e => e.name === NAME)) { console.log('已補入', NAME); process.exit(0); }
const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// 既有節點座標：接頭必須同 node ID，且 OSM 現況座標與出貨檔一致（不位移原軌道）。
const coord = new Map(); for (const w of net.ways) w.nodes.forEach((n, i) => coord.set(String(n), w.coordinates[i]));
const joints = new Set(); let fresh = 0;
for (const w of fx.ways) {
  const id = String(w.id);
  assert(!net.ways.some(p => String(p.id) === id), '已在路網 ' + id);
  assert.equal(w.tags.railway, 'rail'); assert(['yard', 'siding'].includes(w.tags.service), '只補咽喉連接段 ' + id);
  const nodes = w.nodes.map(String);
  const coordinates = w.geometry.map((p, i) => {
    const c = coord.get(nodes[i]);
    if (!c) { fresh++; return [p.lon, p.lat]; }
    assert(distanceM(c, [p.lon, p.lat]) < 0.5, '接頭座標與出貨檔不一致 ' + nodes[i]); joints.add(nodes[i]); return c;
  });
  assert(nodes.some(n => coord.has(n)), '沒有接頭 ' + id);
  net.ways.push({ id, system: 'tra_sched', tags: w.tags, nodes, coordinates });
}
let taggedNew = 0;
for (const [n, t] of Object.entries(fx.nodeTags)) { if (net.nodeTags[n]) { assert.deepEqual(net.nodeTags[n], t, '節點標籤與出貨檔不一致 ' + n); continue; } net.nodeTags[n] = t; taggedNew++; }

// 補了第三股之後，接頭處的 canTurn 從「來源接頭直通」變成道岔規則：既有路徑經過接頭仍要接得上。
const { g, paths } = restorePhysicalRoutes(net);
for (const w of fx.ways) assert(g.edges.has(String(w.id) + ':0'), '補入的 way 沒有進拓樸 ' + w.id);
let checked = 0;
for (const p of paths) {
  if (!p) continue;
  for (let i = 1; i + 1 < p.nodeIds.length; i++) {
    if (!joints.has(p.nodeIds[i])) continue;
    assert(g.canTurn(p.nodeIds[i - 1], p.nodeIds[i], p.nodeIds[i + 1], g.edges.get(p.edgeIds[i - 1]), g.edges.get(p.edgeIds[i])), '既有路徑在接頭接不上 ' + p.nodeIds[i]);
    checked++;
  }
}
assert(checked > 0, '沒有任何既有路徑經過接頭，接頭有問題');

net.extensions = [...(net.extensions || []), {
  name: NAME, source: 'OpenStreetMap / Overpass', snapshot: FIXTURE, osmBase: fx.osmBase, date: '2026-09-14',
  ways: fx.ways.map(w => String(w.id)),
  note: '依共用來源節點接續，不改寫原始標籤（service=yard 照留，路徑搜尋端限制它只當短連接段走）。只補乾跑證明 F2 修不掉的站要走的 9 條，不是整個站場。',
}];
fs.writeFileSync(out, JSON.stringify(net));
console.log(`補入 ${fx.ways.length} 條 way（接頭 ${joints.size} 個、新節點 ${fresh} 個、新節點標籤 ${taggedNew} 個），既有路徑經接頭檢查 ${checked} 次 → ${out}`);
