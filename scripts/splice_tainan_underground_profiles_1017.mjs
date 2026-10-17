// 臺南地下化（extend_tainan_underground_1017.mjs）之後的顯示高度與層位檔可重現步驟：
// 完整重算之後，只把「臺南段有動的 way」換進改動前已驗證的檔案，其餘 entries 逐筆保留。
// 有動的 way＝這次新增、切短的 way，加上跟它們或被拿掉的 way 共用節點的 way（道岔節點取共用最大值，
// 鄰接的 way 在接點的高度會跟著變）；層位另外再加上跟這些 way 同屬一段連續縱坡或交會的 way（見 LEVEL_EXTRA）。
// 不整檔採用完整重算的理由同 splice_mountain_share_profiles_0925.mjs：蘇澳 09-14 刻意保留的高程解，
// 以及遠處的求解雜訊。被拿掉的 way 從檔案裡刪除。
// 跑法：
//   node scripts/build_physical_display_profiles.mjs && BASE_REF=<改動前已驗證commit> node scripts/splice_tainan_underground_profiles_1017.mjs display
//   node scripts/build_rail_levels.mjs && BASE_REF=<同上> node scripts/splice_tainan_underground_profiles_1017.mjs level
//   node scripts/build_3d_display_profiles.mjs && BASE_REF=<同上> node scripts/splice_tainan_underground_profiles_1017.mjs integration
//   （立體地圖 2D 線的高度檔以線形為鍵；出貨檔自 09-07 沒重產，山線、紅線等鍵已跟現行線形不同，
//     完整重算會一併換掉那些，所以這裡只換縱貫線南段一筆。）
// 完成後仍必須跑 verify_rail_levels、verify_flat_rail_grade、verify_rail_grounding、verify_rail_structure_heights。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const kind = process.argv[2]; assert(['display', 'level', 'integration'].includes(kind), '參數是 display、level 或 integration');
const ref = process.env.BASE_REF; assert(ref, '必須明確指定改動前已驗證的 BASE_REF');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
const show = f => JSON.parse(execFileSync('git', ['-C', root, 'show', `${sha}:${f}`], {maxBuffer: 256 * 1024 * 1024}));
if (kind === 'integration') {
  const f = 'rail-3d/integration/display-profiles.json', ROUTE = 'tra_sched:縱貫線南段';
  const base = show(f), full = JSON.parse(fs.readFileSync(f)), mine = Object.entries(full.entries).filter(([, e]) => e.routeId === ROUTE);
  assert.equal(mine.length, 1, `完整重算裡 ${ROUTE} 不是剛好一筆`);
  assert.deepEqual({...full.source, routeSnapshotSha256: null}, {...base.source, routeSnapshotSha256: null}, 'DEM 或方法跟 BASE_REF 不同');
  const entries = Object.fromEntries(Object.entries(base.entries).filter(([, e]) => e.routeId !== ROUTE));
  assert.equal(Object.keys(entries).length, Object.keys(base.entries).length - 1, `出貨檔裡 ${ROUTE} 不是剛好一筆`);
  entries[mine[0][0]] = mine[0][1];
  fs.writeFileSync(f, JSON.stringify({...base, entries}) + '\n');
  console.log(JSON.stringify({file: f, route: ROUTE, entries: Object.keys(entries).length}));
  process.exit(0);
}
const file = `rail-3d/physical/${kind === 'display' ? 'display' : 'level'}-profiles.json`;
const base = show(file), full = JSON.parse(fs.readFileSync(file));
const oldNet = show('rail-3d/physical/network.json'), net = JSON.parse(fs.readFileSync('rail-3d/physical/network.json'));
const ext = net.extensions.at(-1); assert.equal(ext.name, '臺南鐵路地下化第一階段（2026-10-17 通車）', 'network.json 最後一筆 extension 不是臺南地下化');
const removed = new Set(ext.removedWays), changed = new Set([...ext.ways, ...Object.keys(ext.truncatedWays)]);
// 鄰接：跟新增、切短或拿掉的 way 共用任一節點（新舊兩份網路都算）
const touchNodes = new Set([...oldNet.ways.filter(w => removed.has(String(w.id)) || changed.has(String(w.id))), ...net.ways.filter(w => changed.has(String(w.id)))].flatMap(w => w.nodes));
const region = new Set(changed);
for (const w of net.ways) if (w.nodes.some(n => touchNodes.has(n))) region.add(String(w.id));
// 層位：露天段縱坡是沿連續股道一起解的，臺南段一動，大橋以北、保安以南相連的縱貫線也會跟著動
// （2026-10-17 實測：BASE_REF 與改動後各完整重算一次，兩者不同的除了上面那些，只有這 25 條，
// 最大高度差 0.067 公尺，其餘 24 條在 0.001 公尺以下；全部在北緯 22.91～23.04 的縱貫線上）。
// 帶 BASE_FULL=<BASE_REF 上完整重算的 level-profiles.json> 跑時會重新核對這份清單。
const LEVEL_EXTRA = ['108040326', '108040339', '172225920', '197614147', '197614795', '197614806', '197614807', '259864446', '259864449', '259864451', '259864454', '279060302',
  '346746530', '346746531', '346746532', '346746534', '346746535', '346746536', '374528514', '461902864', '587364545', '587364546', '903047509', '903047510', '1413625262'];
if (kind === 'level') for (const id of LEVEL_EXTRA) region.add(id);
if (kind === 'level' && process.env.BASE_FULL) {
  const baseFull = JSON.parse(fs.readFileSync(process.env.BASE_FULL));
  const diff = (a, b) => [...new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])].filter(k => JSON.stringify(a.entries[k]) !== JSON.stringify(b.entries[k]));
  const moved = diff(baseFull, full), preserved = new Set(diff(base, baseFull));
  for (const id of moved) assert(region.has(id) || removed.has(id), `完整重算在臺南段以外改了 ${id}`);
  for (const id of region) assert(!preserved.has(id), `${id} 是出貨檔刻意保留的解，不能換`);
  console.log(JSON.stringify({baseFullMoved: moved.length, preservedElsewhere: preserved.size}));
}
const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
const replaced = [], kept = [], dropped = [], entries = {};
// 層位檔也收捷運的 way（metro-network.json），不在 network.json 裡的 entry 一律照原樣保留
for (const id of new Set([...Object.keys(full.entries), ...Object.keys(base.entries)])) {
  if (removed.has(id)) { assert(!full.entries[id], `拿掉的 way ${id} 還在完整重算裡`); if (base.entries[id]) dropped.push(id); continue; }
  const e = region.has(id) ? full.entries[id] : base.entries[id];
  if (e) entries[id] = e;
  if (differs(base.entries[id], full.entries[id])) (region.has(id) ? replaced : kept).push(id);
}
for (const id of changed) if (kind === 'display') assert(entries[id], `新增或切短的 way ${id} 沒有剖面`);
let out;
if (kind === 'display') {
  assert.deepEqual(full.source, base.source, 'DEM 或方法跟 BASE_REF 不同');
  out = {...base, entries};
} else {
  // 洞口清單：換進臺南段的洞口（落在換進的 way 端點上），其餘保留
  const ends = new Set(net.ways.filter(w => region.has(String(w.id))).flatMap(w => [w.coordinates[0], w.coordinates.at(-1)].map(c => c[0].toFixed(6) + ',' + c[1].toFixed(6))));
  const mine = p => ends.has(p[0].toFixed(6) + ',' + p[1].toFixed(6));
  const portals = [...base.portals.filter(p => !mine(p)), ...full.portals.filter(mine)];
  for (const w of net.ways) { const id = String(w.id); if (!region.has(id) && base.entries[id]?.boreKind !== full.entries[id]?.boreKind) assert.fail('臺南段以外隧道分類改變 ' + id); }
  out = {...base, inputSha256: full.inputSha256, portals, entries,
    incrementalSplice: {baseCommit: sha, network: '臺南地下化 extend_tainan_underground_1017.mjs', replacedWays: replaced, removedWays: dropped,
      method: '完整重算後只換進臺南地下化有動的 way 與共用節點的鄰接 way；蘇澳 09-14 保留的高程解與其他地方的求解雜訊不採用。換進的剖面另經完整高度、坡度、交會淨距與接縫閘門驗證。', previous: base.incrementalSplice}};
}
fs.writeFileSync(file, JSON.stringify(out));
console.log(JSON.stringify({file, region: region.size, replaced: replaced.length, dropped: dropped.length, keptDiffering: kept.length, entries: [Object.keys(base.entries).length, Object.keys(entries).length]}));
