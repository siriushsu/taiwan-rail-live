// 臺南鐵路地下化第一階段（2026-10-17 通車）出貨閘門。來源股道以 scripts/fixtures/tainan-underground-osm-1017.json 為準，
// 不從出貨的 network.json 倒推（倒推的話地面線也會自己對自己通過）。
// 1. 層位：OSM 標 tunnel=yes 的 4 股是都市地下段（kind tunnel、rank −1、boreKind subsurface，最深到 −8 公尺）；
//    cutting=yes 的 4 段坡道一端在地面、一端往下；坡道外接回地面線的銜接段在地面。經過臺南的派車路徑，北上、南下都走隧道。
// 2. 停車：派車表停臺南的節點全部是地下 4 股上的停車點，北上、南下都有。
// 3. 2D 畫線：地下東側正線每個節點離縱貫線南段 shape ≤ 1 公尺（地面 shape 在臺南站最遠 33 公尺）；經過臺南的派車路徑
//    每 10 公尺取樣，離 shape ≤ 50 公尺（同 verify_physical_tracks_browser.mjs 的離線門檻）。
// 4. 大橋–臺南、臺南–保安的實體路徑長與 2D 站距，對官方營業里程（tra_seg_cumdist.json）。只印不擋。
// 帶 BASE_REF（改動前的 commit）時另做一次性驗收：
// 5. 區間外逐 byte 不變：network 的 ways（含陣列位置）、paths、nodeTags、inferredStops，層位與顯示高度 entries，
//    track_lines.geojson 其他線，tra.json 其他線與縱貫線南段兩個接點以外的 shape。兩邊筆數都印出來而且要 > 0，
//    再拿「改掉區間外一筆」當正向對照，比對必須抓得到。
// 6. 臺南重播頁 memories/tainan-2026-09-12/ 每個檔逐 byte 等於 BASE_REF。
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {makePath} from '../rail-3d/integration/train-path.js';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const net = read('rail-3d/physical/network.json'), levels = read('rail-3d/physical/level-profiles.json'), dispatch = read('rail-3d/physical/dispatch.json');
const tra = read('data/tra.json'), osm = read('scripts/fixtures/tainan-underground-osm-1017.json');
let failed = 0;
const ok = (name, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!pass) failed++; };

const ugWays = osm.elements.filter(e => e.type === 'way' && e.tags?.name === '台南市區鐵路地下化');
const TUNNEL = ugWays.filter(e => e.tags.tunnel === 'yes').map(e => String(e.id)), CUT = ugWays.filter(e => e.tags.cutting === 'yes').map(e => String(e.id));
const OPEN = ugWays.filter(e => !e.tags.tunnel && !e.tags.cutting).map(e => String(e.id));
ok('fixture 有 4 股隧道、4 段坡道、4 段坡道外接續', TUNNEL.length === 4 && CUT.length === 4 && OPEN.length === 4, `${TUNNEL.length}/${CUT.length}/${OPEN.length}`);
const wayIdx = new Map(net.ways.map((w, i) => [String(w.id), i])), wayOf = id => net.ways[wayIdx.get(id)];
const range = a => a?.length ? `${Math.min(...a).toFixed(1)}～${Math.max(...a).toFixed(1)}` : '無';

// ── 1. 層位 ──
for (const id of TUNNEL) { const e = levels.entries[id];
  ok(`隧道 ${id} 是都市地下段 −1`, !!wayOf(id) && e?.kind === 'tunnel' && e.rank === -1 && e.boreKind === 'subsurface' && Math.min(...e.offsets) <= -7.9 && Math.max(...e.offsets) < 0,
    e ? `${e.kind}/${e.rank}/${e.boreKind} 偏移 ${range(e.offsets)} m` : (wayOf(id) ? '沒有層位' : '不在路網')); }
for (const id of CUT) { const e = levels.entries[id];
  ok(`坡道 ${id} 一端在地面、一端往下`, !!wayOf(id) && !!e && Math.max(...e.offsets) > -0.01 && Math.min(...e.offsets) < -3, e ? `偏移 ${range(e.offsets)} m` : (wayOf(id) ? '沒有層位' : '不在路網')); }
for (const id of OPEN) { const e = levels.entries[id];
  ok(`坡道外 ${id} 在地面`, !!wayOf(id) && (!e || e.offsets.every(z => Math.abs(z) < 0.01)), e ? `偏移 ${range(e.offsets)} m` : (wayOf(id) ? '沒有層位＝地面' : '不在路網')); }

// ── 派車表裡停或經過臺南的進出站路徑 ──
const isTainan = s => /^tra_sched:(臺|台)南$/.test(s);
const tunnelSet = new Set(TUNNEL), ugSet = new Set(ugWays.map(e => String(e.id)));
const walkWays = pid => net.paths[pid].walk.map(([wi]) => String(net.ways[wi].id));
const walkCoords = pid => net.paths[pid].walk.flatMap(([wi, start, count], k) => { const w = net.ways[wi], sign = Math.sign(count), out = [];
  for (let j = 0; j < Math.abs(count); j++) { const i = start + j * sign; if (!k && !j) out.push(w.coordinates[i + (sign < 0 ? 1 : 0)]); out.push(w.coordinates[i + (sign > 0 ? 1 : 0)]); } return out; });
const legs = [], stops = new Map();
for (const [key, plan] of Object.entries(dispatch.plans)) {
  if (!key.startsWith('tra_sched:') || !plan.stopSignature) continue;
  const sig = JSON.parse(plan.stopSignature), i = sig.findIndex(s => isTainan(s[0])); if (i < 0) continue;
  for (const [k, side] of [[i - 1, 'in'], [i, 'out']]) if (k >= 0 && k < plan.pathIds.length) {
    const pid = String(plan.pathIds[k]), p = net.paths[pid], c = walkCoords(pid), at = side === 'in' ? c.at(-1) : c[0], far = side === 'in' ? c[0] : c.at(-1);
    legs.push({key, pid, side, north: side === 'in' ? far[1] < at[1] : far[1] > at[1]});
    const node = side === 'in' ? p.to : p.from; stops.set(node, (stops.get(node) || 0) + 1);
  }
}
const nb = legs.filter(l => l.north), sb = legs.filter(l => !l.north);
ok('經過臺南的派車路徑北上、南下都有', nb.length > 0 && sb.length > 0, `北上 ${nb.length} 段、南下 ${sb.length} 段（${new Set(legs.map(l => l.key)).size} 班）`);
const surface = legs.filter(l => !walkWays(l.pid).some(id => tunnelSet.has(id)));
ok('經過臺南的派車路徑全部走隧道', legs.length > 0 && !surface.length, surface.length ? `沒走隧道：${[...new Set(surface.map(l => l.pid))].join('、')}` : `${new Set(legs.map(l => l.pid)).size} 條路徑`);

// ── 2. 停車點 ──
const stopWay = node => TUNNEL.find(id => wayOf(id)?.nodes.includes(node));
const offTrack = [...stops.keys()].filter(n => !stopWay(n) || net.nodeTags?.[n]?.railway !== 'stop');
ok('停臺南的車都停在地下 4 股之一', stops.size > 0 && !offTrack.length,
  [...stops].map(([n, c]) => `${stopWay(n) || '地面'}:${c}`).join('、') + (offTrack.length ? `；不在地下股道：${offTrack.join('、')}` : ''));
const sides = new Set(legs.map(l => (l.side === 'in' ? net.paths[l.pid].to : net.paths[l.pid].from)).map(n => stopWay(n)).filter(Boolean));
ok('北上與南下停在不同側的股道', sides.size >= 2, [...sides].join('、'));

// ── 3. 2D 畫線 ──
const R = 6371000, toR = Math.PI / 180;
const line = tra.lines.find(l => l.name.startsWith('縱貫線南段')), shape = line.shape;
const distToShape = ([lon, lat]) => { let best = Infinity;
  for (let i = 0; i < shape.length - 1; i++) { const a = shape[i], b = shape[i + 1], k = Math.cos(a[0] * toR), vx = (b[1] - a[1]) * k, vy = b[0] - a[0], px = (lon - a[1]) * k, py = lat - a[0];
    const L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0; best = Math.min(best, Math.hypot(px - t * vx, py - t * vy) * toR * R); }
  return best; };
const eastMain = osm.elements.find(e => String(e.id) === '1102288954');
const eastOff = Math.max(...eastMain.geometry.map(q => distToShape([q.lon, q.lat])));
ok('2D 畫線走地下東側正線（每個節點 ≤ 1 m）', eastOff <= 1, `最遠 ${eastOff.toFixed(2)} m`);
let worst = {d: 0};
for (const pid of new Set(legs.map(l => l.pid))) { const p = makePath(walkCoords(pid));
  for (let s = 0; s <= p.length; s += 10) { const c = p.at(Math.min(s, p.length)).coordinate, d = distToShape(c); if (d > worst.d) worst = {d, pid, c}; } }
ok('經過臺南的派車路徑離 2D 畫線 ≤ 50 m', legs.length > 0 && worst.d <= 50, `最遠 ${worst.d.toFixed(1)} m（路徑 ${worst.pid}）`);

// ── 4. 對官方營業里程（只印）──
const official = read('data/tra_seg_cumdist.json').lookup, st = n => line.stations.find(s => s.name === n);
for (const [a, b] of [['大橋', '臺南'], ['臺南', '保安']]) {
  const want = official[`縱貫線南段|${a.replace(/臺/g, '台')}|${b.replace(/臺/g, '台')}`] ?? official[`縱貫線南段|${b.replace(/臺/g, '台')}|${a.replace(/臺/g, '台')}`];
  const lens = Object.values(dispatch.plans).filter(p => p.stopSignature).flatMap(p => { const sig = JSON.parse(p.stopSignature);
    return p.pathIds.filter((_, k) => sig[k + 1] && [sig[k][0], sig[k + 1][0]].map(s => s.split(':')[1].replace(/台/g, '臺')).sort().join() === [a, b].sort().join()).map(pid => net.paths[pid].lengthM); });
  const d2 = Math.abs(st(b).d - st(a).d);
  console.log(`INFO ${a}–${b}：官方 ${want} km；2D 站距 ${d2.toFixed(4)} km（差 ${((d2 - want) * 1000).toFixed(1)} m）；實體派車路徑 ${lens.length} 段 ${(Math.min(...lens) / 1000).toFixed(4)}～${(Math.max(...lens) / 1000).toFixed(4)} km（差 ${(Math.min(...lens) - want * 1000).toFixed(1)}～${(Math.max(...lens) - want * 1000).toFixed(1)} m）`);
}

// ── 5、6. 一次性驗收（BASE_REF）──
const ref = process.env.BASE_REF;
if (ref) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
  const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
  const showRaw = f => execFileSync('git', ['-C', root, 'show', `${sha}:${f}`], {maxBuffer: 256 * 1024 * 1024});
  const show = f => JSON.parse(showRaw(f));
  const ext = net.extensions.at(-1), removed = new Set(ext.removedWays), changed = new Set([...ext.ways, ...Object.keys(ext.truncatedWays)]);
  const bNet = show('rail-3d/physical/network.json');
  const touch = new Set([...bNet.ways.filter(w => removed.has(String(w.id)) || changed.has(String(w.id))), ...net.ways.filter(w => changed.has(String(w.id)))].flatMap(w => w.nodes));
  const region = new Set([...changed, ...removed]); for (const w of net.ways) if (w.nodes.some(n => touch.has(n))) region.add(String(w.id));
  const inBox = id => { const w = wayOf(id) || bNet.ways.find(x => String(x.id) === id); return !w || w.coordinates.every(([x, y]) => x > 120.15 && x < 120.30 && y > 22.88 && y < 23.08); };
  // 比對器：回傳 {a, b, diff}；a、b 是兩邊比過的筆數
  const cmpMap = (A, B, skip) => { const ka = Object.keys(A).filter(k => !skip(k)), kb = Object.keys(B).filter(k => !skip(k));
    const diff = [...new Set([...ka, ...kb])].filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k])); return {a: ka.length, b: kb.length, diff}; };
  const report = (name, r) => ok(name, r.a > 0 && r.b > 0 && !r.diff.length, `改動前 ${r.a} 筆、改動後 ${r.b} 筆` + (r.diff.length ? `；不同 ${r.diff.length}：${r.diff.slice(0, 5).join('、')}` : ''));
  const byId = ws => Object.fromEntries(ws.map((w, i) => [String(w.id), {i, w}]));
  const slots = new Set(ext.removedWays.map(id => bNet.ways.findIndex(w => String(w.id) === id)));
  const waysCmp = (A, B) => { const r = cmpMap(byId(A), byId(B), k => region.has(k)); return r; };
  report('區間外 ways 逐 byte 相同（含陣列位置）', waysCmp(bNet.ways, net.ways));
  // 正向對照：區間外隨便挑一條改一個座標，比對必須抓得到
  const mutated = structuredClone(net.ways), victim = mutated.findIndex((w, i) => !region.has(String(w.id)) && !slots.has(i));
  mutated[victim].coordinates[0] = [mutated[victim].coordinates[0][0] + 1e-7, mutated[victim].coordinates[0][1]];
  ok('正向對照：區間外改一個座標會被抓到', waysCmp(bNet.ways, mutated).diff.length === 1, `way ${mutated[victim].id}`);
  ok('區間內有動的 way 全在臺南附近', [...region].every(inBox), `${region.size} 條`);
  // 改道的路徑，加上待避修復（repair_tra_overtake_tracks.mjs）新增、一端在臺南地下停車點的路徑
  const tainanStop = n => String(n).startsWith('estimated:tra_sched:臺南:');
  const added = Object.keys(net.paths).filter(k => !bNet.paths[k] && (tainanStop(net.paths[k].from) || tainanStop(net.paths[k].to)));
  const rerouted = new Set([...ext.reroutedPaths, ...added]);
  report('區間外 paths 逐 byte 相同', cmpMap(bNet.paths, net.paths, k => rerouted.has(k)));
  console.log(`INFO 臺南改道 ${ext.reroutedPaths.length} 條、待避修復新增 ${added.length} 條（${added.join('、')}）`);
  const tagSkip = new Set([...bNet.ways.filter(w => region.has(String(w.id))), ...net.ways.filter(w => region.has(String(w.id)))].flatMap(w => w.nodes));
  report('區間外 nodeTags 逐 byte 相同', cmpMap(bNet.nodeTags, net.nodeTags, k => tagSkip.has(k)));
  ok('inferredStops 只在尾端加上臺南 4 筆', JSON.stringify(net.inferredStops.slice(0, bNet.inferredStops.length)) === JSON.stringify(bNet.inferredStops) && net.inferredStops.length - bNet.inferredStops.length === 4,
    `${bNet.inferredStops.length}→${net.inferredStops.length}`);
  const bLevels = show('rail-3d/physical/level-profiles.json'), lvSkip = new Set([...levels.incrementalSplice.replacedWays, ...levels.incrementalSplice.removedWays]);
  ok('層位換進的 way 全在臺南附近', [...lvSkip].every(inBox), `${lvSkip.size} 條`);
  report('區間外層位 entries 逐 byte 相同', cmpMap(bLevels.entries, levels.entries, k => lvSkip.has(k)));
  const bDisp = show('rail-3d/physical/display-profiles.json'), disp = read('rail-3d/physical/display-profiles.json');
  report('區間外顯示高度 entries 逐 byte 相同', cmpMap(bDisp.entries, disp.entries, k => region.has(k)));
  const bGeo = show('data/track_lines.geojson'), geo = read('data/track_lines.geojson'), fk = f => f.properties.lineKey;
  report('track_lines.geojson 其他線逐 byte 相同', cmpMap(Object.fromEntries(bGeo.features.map(f => [fk(f), f])), Object.fromEntries(geo.features.map(f => [fk(f), f])), k => k === 'tra_sched|縱貫線南段'));
  const bTra = show('data/tra.json'), bLine = bTra.lines.find(l => l.id === line.id);
  report('tra.json 其他線逐 byte 相同', cmpMap(Object.fromEntries(bTra.lines.map(l => [l.id, l])), Object.fromEntries(tra.lines.map(l => [l.id, l])), k => k === line.id));
  const head = shape.findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(bLine.shape[i]));
  const tail = [...shape].reverse().findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(bLine.shape.at(-1 - i)));
  ok('縱貫線南段接點外的 shape 逐點相同', head > 0 && tail > 0 && head + tail < shape.length, `北段前 ${head} 點、南段後 ${tail} 點相同（共 ${shape.length} 點）`);
  ok('縱貫線南段站名、站序與座標不變', JSON.stringify(line.stations.map(s => [s.name, s.lat, s.lon])) === JSON.stringify(bLine.stations.map(s => [s.name, s.lat, s.lon])), `${line.stations.length} 站`);
  // 6. 重播頁
  const dir = 'memories/tainan-2026-09-12', blobs = execFileSync('git', ['-C', root, 'ls-tree', '-r', sha, dir], {encoding: 'utf8'}).trim().split('\n').filter(Boolean).map(l => { const [meta, f] = l.split('\t'); return {f, oid: meta.split(' ')[2]}; });
  const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const here = walk(path.join(root, dir)).map(f => path.relative(root, f)).sort(), diffMem = blobs.filter(b => execFileSync('git', ['-C', root, 'hash-object', b.f], {encoding: 'utf8'}).trim() !== b.oid);
  ok('臺南重播頁每個檔逐 byte 等於改動前', blobs.length > 0 && here.length === blobs.length && !diffMem.length, `改動前 ${blobs.length} 檔、現在 ${here.length} 檔` + (diffMem.length ? `；不同 ${diffMem.map(b => b.f).join('、')}` : ''));
}
console.log(failed ? `${failed} 項失敗` : '臺南地下化：層位、停車股道、2D 畫線全部通過');
process.exit(failed ? 1 : 0);
