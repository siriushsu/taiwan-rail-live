// 大山、頭城補站場渡線（extend_tra_yield_crossovers_1020.mjs）之後的顯示高度與層位檔可重現步驟，
// 做法同 splice_tainan_underground_profiles_1017.mjs：完整重算之後，只把「有動的 way」換進改動前已驗證的檔案，其餘 entries 逐筆保留。
// 有動的 way＝新增的渡線、咽喉股道與插了道岔節點的正線，加上跟它們共用節點的 way（道岔節點取共用最大值，接點高度會跟著變）。
// 層位另外再加上 LEVEL_EXTRA（完整重算時跟著動、但不共用節點的 way；帶 BASE_FULL 跑時重新核對）。
// 跑法：
//   node scripts/build_physical_display_profiles.mjs && BASE_REF=<改動前已驗證commit> node scripts/splice_tra_yield_crossovers_profiles_1020.mjs display
//   node scripts/build_rail_levels.mjs && BASE_REF=<同上> node scripts/splice_tra_yield_crossovers_profiles_1020.mjs level
// 完成後仍必須跑 verify_rail_levels、verify_flat_rail_grade、verify_rail_grounding、verify_rail_structure_heights。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const kind = process.argv[2]; assert(['display', 'level'].includes(kind), '參數是 display 或 level');
const ref = process.env.BASE_REF; assert(ref, '必須明確指定改動前已驗證的 BASE_REF');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
const show = f => JSON.parse(execFileSync('git', ['-C', root, 'show', `${sha}:${f}`], {maxBuffer: 256 * 1024 * 1024}));
const file = `rail-3d/physical/${kind}-profiles.json`;
const base = show(file), full = JSON.parse(fs.readFileSync(file));
const net = JSON.parse(fs.readFileSync('rail-3d/physical/network.json'));
const ext = net.extensions.at(-1); assert.equal(ext.name, '台鐵待避站場渡線（大山、頭城，NLSC 正射影像判讀）', 'network.json 最後一筆 extension 不是大山、頭城渡線');
const changed = new Set([...ext.ways, ...Object.values(ext.insertedNodes).map(r => r.way)]);
const touchNodes = new Set(net.ways.filter(w => changed.has(String(w.id))).flatMap(w => w.nodes));
const region = new Set(changed);
for (const w of net.ways) if (w.nodes.some(n => touchNodes.has(n))) region.add(String(w.id));
// 層位：頭城新接的股道讓平地縱坡（flat_rail_grade）的連續段多了一條，頭城前後相連的宜蘭線跟著動
// （2026-10-20 實測：BASE_REF 與改動後各完整重算一次，兩者不同的除了上面那些，只有這 13 條，全在北緯 24.84～24.87；
// 只動 flatOffsets（最大 0.0046 m）與 terrainValues 一個接點（0.01 m），values 逐筆相同）。
// 另有 194081482 也動了，但只差 0.00001 m，而且出貨檔本來就保留了另一組解（同樣只差 0.00001 m），所以不換、沿用出貨檔（NOISE_KEPT）。
// 帶 BASE_FULL=<BASE_REF 上完整重算的 level-profiles.json> 跑時會重新核對這兩份清單。
const LEVEL_EXTRA = ['194075575', '194075576', '194075578', '194075580', '194075582', '194075778', '194075780', '194075781',
  '371345099', '371345100', '371345108', '371345109'];
const NOISE_KEPT = ['194081482'];
if (kind === 'level') for (const id of LEVEL_EXTRA) region.add(id);
if (kind === 'level' && process.env.BASE_FULL) {
  const baseFull = JSON.parse(fs.readFileSync(process.env.BASE_FULL));
  const diff = (a, b) => [...new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])].filter(k => JSON.stringify(a.entries[k]) !== JSON.stringify(b.entries[k]));
  const moved = diff(baseFull, full), preserved = new Set(diff(base, baseFull));
  const maxDiff = (x, y) => Math.max(0, ...Object.keys(y).filter(k => Array.isArray(y[k]) && typeof y[k][0] === 'number').map(k => Math.max(...y[k].map((v, i) => Math.abs(v - x[k][i])))));
  for (const id of NOISE_KEPT) assert(preserved.has(id) && maxDiff(baseFull.entries[id], full.entries[id]) < 1e-4, `${id} 不再是只差雜訊的保留解`);
  const outside = moved.filter(id => !region.has(id) && !NOISE_KEPT.includes(id));
  console.log(JSON.stringify({baseFullMoved: moved.length, preservedElsewhere: preserved.size, movedOutsideRegion: outside}));
  assert.equal(outside.length, 0, `完整重算在大山、頭城以外改了 ${outside.join(' ')}`);
  for (const id of region) assert(!preserved.has(id), `${id} 是出貨檔刻意保留的解，不能換`);
}
const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
const replaced = [], kept = [], entries = {};
// 層位檔也收捷運的 way（metro-network.json），不在 network.json 裡的 entry 一律照原樣保留
for (const id of new Set([...Object.keys(full.entries), ...Object.keys(base.entries)])) {
  const e = region.has(id) ? full.entries[id] : base.entries[id];
  if (e) entries[id] = e;
  if (differs(base.entries[id], full.entries[id])) (region.has(id) ? replaced : kept).push(id);
}
for (const id of changed) assert(entries[id], `新增或插點的 way ${id} 沒有剖面`);
let out;
if (kind === 'display') {
  assert.deepEqual(full.source, base.source, 'DEM 或方法跟 BASE_REF 不同');
  out = {...base, entries};
} else {
  // 洞口清單：大山、頭城都在平地，換進的 way 端點不該有洞口
  const ends = new Set(net.ways.filter(w => region.has(String(w.id))).flatMap(w => [w.coordinates[0], w.coordinates.at(-1)].map(c => c[0].toFixed(6) + ',' + c[1].toFixed(6))));
  const mine = p => ends.has(p[0].toFixed(6) + ',' + p[1].toFixed(6));
  assert(!base.portals.some(mine) && !full.portals.some(mine), '換進的 way 端點有洞口');
  for (const w of net.ways) { const id = String(w.id); if (!region.has(id) && base.entries[id]?.boreKind !== full.entries[id]?.boreKind) assert.fail('大山、頭城以外隧道分類改變 ' + id); }
  out = {...base, inputSha256: full.inputSha256, entries,
    incrementalSplice: {baseCommit: sha, network: '大山、頭城站場渡線 extend_tra_yield_crossovers_1020.mjs', replacedWays: replaced, removedWays: [],
      method: '完整重算後只換進大山、頭城有動的 way 與共用節點的鄰接 way；其餘沿用 BASE_REF 已驗證的解。換進的剖面另經完整高度、坡度、交會淨距與接縫閘門驗證。', previous: base.incrementalSplice}};
}
fs.writeFileSync(file, JSON.stringify(out));
console.log(JSON.stringify({file, region: [...region], replaced, keptDiffering: kept.length, entries: [Object.keys(base.entries).length, Object.keys(entries).length]}));
