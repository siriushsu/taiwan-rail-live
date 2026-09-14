// 把 fixture 裡「OSM 已畫、但沒被打包進出貨路網」的台鐵站區股道補進 network.json（F9，F6 的一般化）。
// 僅補入公開既有股道；接頭必須同 node ID，不補直線、不位移原軌道
// （與 extend_tra_station_throats.mjs／extend_guangci_physical.mjs 同一條原則）。
//
// 與 F6 的差別只有兩點：
//   1. 吃的 fixture 是 scripts/fixtures/tra-station-tracks-osm-0914.json（1272 條，不是手挑的 9 條），
//      service 不再限於 yard／siding（站區本來就有 spur／crossover／無 service 的正線股）。
//   2. 補入順序要做遞移閉包——fixture 允許「透過同批其他新 way 才接得回正線」的 way，
//      所以一輪一輪加，每加一條就把它的節點併進接頭池；最後一條都不能剩（剩下＝ fixture 選錯了）。
// F6 的檢查一條都沒拿掉：接頭同 node id、既有節點座標差 <0.5 m、補入的 way 一定要進拓樸、
// 既有路徑經過接頭時 canTurn 仍要成立（檢查次數 >0）、nodeTags 只補不改、extensions 記錄以便重跑無害。
//
// 路徑搜尋端沒有跟著放寬：scripts/lib/track_directions.mjs 的 yard 規則（沒有純正線順向路徑才准走、
// 一條路徑 yard／spur 總長 ≤ YARD_CAP_M）照舊，所以補進來的站場股道不會自動變成現役客運線。
//
// 跑法：node scripts/extend_tra_station_tracks.mjs
//   NETWORK=／OUT= 換檔；SECTION=ways|bridge|ways,bridge 選區段（預設 ways）。
//   bridge＝萬華–臺北隧道東正線那 30 m 的補缺，其中一條是依 TDX 官方幾何擬的非 OSM way，**要裁定才套用**。
// 🔴 重新打包 network.json 之後要再跑一次；用 extensions 記錄判斷是否已補入，重跑無害。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { restorePhysicalRoutes } from './lib/restore_physical_routes.mjs';
import { distanceM } from '../rail-3d/integration/train-path.js';

const FIXTURE = process.env.FIXTURE || 'scripts/fixtures/tra-station-tracks-osm-0914.json';
const sections = (process.env.SECTION || 'ways').split(',').map(s => s.trim()).filter(Boolean);
const NAME = 'F9 台鐵站區既有股道（' + sections.join('+') + '）';
const file = process.env.NETWORK || 'rail-3d/physical/network.json', out = process.env.OUT || file;

const net = JSON.parse(fs.readFileSync(file, 'utf8'));
if (net.extensions?.some(e => e.name === NAME)) { console.log('已補入', NAME); process.exit(0); }
const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const wanted = sections.flatMap(s => { const v = s === 'bridge' ? fx.bridge?.ways : fx[s]; assert(Array.isArray(v), 'fixture 沒有區段 ' + s); return v; });

// 既有節點座標：接頭必須同 node ID，且 OSM 現況座標與出貨檔一致（不位移原軌道）。
const coord = new Map(); for (const w of net.ways) w.nodes.forEach((n, i) => coord.set(String(n), w.coordinates[i]));
const existing = new Set(net.ways.map(w => String(w.id)));
const joints = new Set(), added = [];
let fresh = 0, synthetic = 0;

// 遞移補入：每一輪只加「此刻已有接頭」的 way，加完把它的節點併進接頭池，直到沒有新的可加。
let pending = wanted.map(w => { assert(!existing.has(String(w.id)), '已在路網 ' + w.id); return w; });
for (let progress = true; progress && pending.length;) {
  progress = false;
  const still = [];
  for (const w of pending) {
    const nodes = w.nodes.map(String);
    if (!nodes.some(n => coord.has(n))) { still.push(w); continue; }
    assert.equal(w.tags.railway, 'rail', '只補鐵軌 ' + w.id);
    const coordinates = w.geometry.map((p, i) => {
      const c = coord.get(nodes[i]);
      if (!c) { fresh++; return [p.lon, p.lat]; }
      assert(distanceM(c, [p.lon, p.lat]) < 0.5, '接頭座標與出貨檔不一致 ' + nodes[i]); joints.add(nodes[i]); return c;
    });
    if (w.synthetic) synthetic++;
    net.ways.push({ id: String(w.id), system: 'tra_sched', tags: w.tags, nodes, coordinates });
    nodes.forEach((n, i) => { if (!coord.has(n)) coord.set(n, coordinates[i]); });
    added.push(String(w.id)); progress = true;
  }
  pending = still;
}
assert.equal(pending.length, 0, '有 way 接不回路網（fixture 的遞移條件與這裡不一致）：' + pending.slice(0, 5).map(w => w.id).join(','));

// nodeTags 只補不改。出貨檔裡的節點標籤是打包時裁過的子集（例如只留 railway／public_transport），
// 而 fixture 取自較新的 OSM 快照會多出 operator:* 那一大票；所以比對的是「出貨檔已有的每個鍵，
// 快照要給同一個值」——真正的矛盾（railway=stop 變成別的）照樣會被擋下，單純的裁剪差異不算。
let taggedNew = 0, tagKept = 0;
for (const [n, t] of Object.entries(fx.nodeTags || {})) {
  if (!coord.has(n)) continue;                                  // 只補真的補進來的 way 上的節點
  const cur = net.nodeTags[n];
  if (cur) {
    for (const k of Object.keys(cur)) assert.equal(cur[k], t[k], `節點標籤與出貨檔不一致 ${n}.${k}`);
    tagKept++; continue;
  }
  net.nodeTags[n] = t; taggedNew++;
}

// 補了新股之後，接頭處的 canTurn 從「來源接頭直通」變成道岔規則：既有路徑經過接頭仍要接得上。
const { g, paths } = restorePhysicalRoutes(net);
for (const id of added) assert(g.edges.has(id + ':0'), '補入的 way 沒有進拓樸 ' + id);
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

// 接頭處原本度數 2 的節點，補了第三股之後變成道岔 ⇒ topology 的 trackGroups 不再給它群組，
// 出貨路徑上那個節點的 fromGroup／toGroup 標籤就指向一個已經不存在的群組。
// 只修這一種（重算後「完全沒有群組」的端點）：出貨檔裡的群組編號取決於建置時整份 OSM 的節點走訪順序，
// 出貨版拓樸本來就重算不出同一個編號（HEAD 4790 個端點裡有 957 個對不上，見 lib/track_directions.mjs:86-87），
// 那 957 個一律不動；本批實測只有 1 個端點是「變成道岔、群組消失」。
let regrouped = 0;
for (const p of Object.values(net.paths)) {
  for (const which of ['from', 'to']) {
    const node = p[which], key = which + 'Group';
    if (g.trackGroups.get(node)) continue;                       // 還在某個群組裡 ⇒ 不碰
    const now = p.system + ':' + node;
    if (p[key] === now) continue;
    p[key] = now; regrouped++;
  }
}

net.extensions = [...(net.extensions || []), {
  name: NAME, source: fx.source, snapshot: FIXTURE, osmBase: fx.osmBase, date: '2026-09-14', sections, ways: added,
  note: '依共用來源節點接續（含遞移），不改寫原始標籤（service 照留，路徑搜尋端的 yard 規則限制它們只當短連接段走）。'
    + (synthetic ? ` 含 ${synthetic} 條非 OSM 既有的補缺 way（依 TDX 官方幾何），見 fixture 的 bridge.evidence。` : ''),
}];
fs.writeFileSync(out, JSON.stringify(net));
console.log(`補入 ${added.length} 條 way（區段 ${sections.join('+')}；接頭 ${joints.size} 個、新節點 ${fresh} 個、新節點標籤 ${taggedNew} 個、沿用既有標籤 ${tagKept} 個、非 OSM 補缺 ${synthetic} 條），既有路徑經接頭檢查 ${checked} 次、群組消失而重貼標籤的路徑端點 ${regrouped} 個 → ${out}`);
