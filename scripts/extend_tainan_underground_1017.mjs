// 臺南鐵路地下化第一階段（2026-10-17 通車）：大橋南端到生產路以南的地面縱貫線換成 OSM 畫的地下線，
// 臺南站改成地下 2 島式月台 4 股（台鐵 2026/10/13 公告：「地下化後的臺南車站將配置2座島式月臺與4條股道」）。
//
// 來源：scripts/fixtures/tainan-underground-osm-1017.json（Overpass 原樣回應，osm_base 2026-10-16T16:57:51Z，
//   查詢在同目錄 tainan-underground-osm-1017.overpassql）。地下線 way 來自 changeset 127235268（站內外側股）、
//   168638820（南端坡道與接續段）、168640237（隧道正線與北端坡道）。OSM 仍標 railway=construction（施工中），
//   台鐵 10/15 新聞稿宣布 10/17 通車，這裡只把 railway 改成 rail、拿掉 construction，其餘標籤照留。
// 推估的只有兩處，都寫進 extensions：
//   1. 南端接點：OSM 的地下線南端停在地面線東側 2.6～10 m（兩者都往對方收斂，但交會點沒畫）。
//      依 1:25 漸變取地面線上第一個夠遠的既有節點，兩端照各自切線接一條平滑曲線。
//   2. 臺南站停車點：地下月台在 OSM 沒有 stop_position，照 infer_physical_stops.mjs 的做法
//      把 TDX 臺南站座標垂直投影到 4 股上，插入 estimated: 節點。
// 只動地下化區間的股道、臺南站停車點、經過這段的 14 條路徑；其餘 way、路徑、節點標籤逐 byte 不變。
// way 陣列位置不動（路徑 walk 以陣列索引引用 way）：拿掉的 way 由新 way 頂替，多出來的接在最後。
// 派車表 dispatch.json 不用改：計畫只引用路徑編號，股道改派全在路徑的 walk 裡。
//
// 跑法：BASE_REF=<改動前已驗證的 commit> node scripts/extend_tainan_underground_1017.mjs
// 之後要跑 build_physical_display_profiles／build_rail_levels 的臺南局部重產（見 commit 訊息），再跑出貨閘門。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {makePath, distanceM} from '../rail-3d/integration/train-path.js';

const ref = process.env.BASE_REF; assert(ref, '必須明確指定改動前的 BASE_REF');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
const base = JSON.parse(execFileSync('git', ['-C', root, 'show', `${sha}:rail-3d/physical/network.json`], {maxBuffer: 64 * 1024 * 1024}));
const FIXTURE = 'scripts/fixtures/tainan-underground-osm-1017.json';
const osm = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const stationInfo = JSON.parse(fs.readFileSync('data/tra_station_info.json', 'utf8'));
const net = structuredClone(base);

const WEST = ['1413211242', '1413211241', '1102288955', '1413215950', '1413215951']; // 北上（西側），南→北
const EAST = ['1413211243', '1413211240', '1102288954', '1413215949', '1413215952']; // 南下（東側），南→北
const LOOP = {W: '1102288953', E: '1102288952'};   // 臺南站外側股（島式月台另一面）
const MAIN = {W: '1102288955', E: '1102288954'};
const SURF = {W: '347019916', E: '161325956'};     // 南端接回的地面線（保留洞口以南）
const NORTH = {W: '347018826', E: '108071684'};    // 北端接回的地面線（保留接點以北）
const REMOVE = ['108037248', '1176543139', '1176543138', '152086608', '1176543137', '1176543136', '747411514', '108071669', '347018833'];
const TAPER = 25;                                   // 南端銜接段：每公尺側移至少走 25 m
const LINK = {W: 'tainan-ug-link-w', E: 'tainan-ug-link-e'};
const STATION = 'tra_sched:臺南';

// ── 來源 ──
const osmWay = new Map(osm.elements.filter(e => e.type === 'way').map(e => [String(e.id), e]));
const osmNodeTags = new Map(osm.elements.filter(e => e.type === 'node').map(e => [String(e.id), e.tags || {}]));
const wayIndex = new Map(net.ways.map((w, i) => [String(w.id), i]));
const wayOf = id => net.ways[wayIndex.get(id)];
for (const id of [...WEST, ...EAST, LOOP.W, LOOP.E]) assert(osmWay.has(id), `fixture 缺地下線 way ${id}`);
// 地面線在 fixture 與出貨網路必須是同一份（節點與座標逐一相同），否則 fixture 跟網路對不上。
for (const id of [SURF.W, SURF.E, NORTH.W, NORTH.E, ...REMOVE]) {
  const w = base.ways[wayIndex.get(id)], o = osmWay.get(id);
  assert(w && o, `地面線 ${id} 不在網路或 fixture`);
  assert.deepEqual(w.nodes, o.nodes.map(String), `地面線 ${id} 節點跟 fixture 不同`);
  assert.deepEqual(w.coordinates, o.geometry.map(q => [q.lon, q.lat]), `地面線 ${id} 座標跟 fixture 不同`);
}

// ── 平面幾何（以臺南站附近為原點的公尺座標）──
const LAT0 = 23, MX = 111320 * Math.cos(LAT0 * Math.PI / 180), MY = 111320;
const toXY = ([lon, lat]) => [(lon - 120.2) * MX, (lat - LAT0) * MY];
const toLL = ([x, y]) => [+(x / MX + 120.2).toFixed(7), +(y / MY + LAT0).toFixed(7)];
function project(coords, p) { // 回傳 {d, seg, t, s}：s 為沿 way 的累積公尺
  const P = toXY(p); let best = null, cum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const A = toXY(coords[i]), B = toXY(coords[i + 1]), vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy, L = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / L2)), d = Math.hypot(P[0] - A[0] - t * vx, P[1] - A[1] - t * vy);
    if (!best || d < best.d) best = {d, seg: i, t, s: cum + t * L};
    cum += L;
  }
  return best;
}
const cumOf = coords => coords.reduce((a, c, i) => (a.push(i ? a[i - 1] + Math.hypot(...toXY(c).map((v, k) => v - toXY(coords[i - 1])[k])) : 0), a), []);
const unit = (a, b) => { const A = toXY(a), B = toXY(b), L = Math.hypot(B[0] - A[0], B[1] - A[1]); return [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; };

// ── 地下線 way（OSM 原樣，railway 改 rail）──
const ugWay = id => {
  const o = osmWay.get(id), tags = {...o.tags};
  assert(tags.railway === 'construction' || tags.railway === 'rail', `${id} railway=${tags.railway}`);
  tags.railway = 'rail'; delete tags.construction;
  return {id, system: 'tra_sched', tags, nodes: o.nodes.map(String), coordinates: o.geometry.map(q => [q.lon, q.lat])};
};
const ug = Object.fromEntries([...WEST, ...EAST, LOOP.W, LOOP.E].map(id => [id, ugWay(id)]));
for (const chain of [WEST, EAST]) for (let i = 1; i < chain.length; i++) assert.equal(ug[chain[i - 1]].nodes.at(-1), ug[chain[i]].nodes[0], `${chain[i - 1]}→${chain[i]} 不相接`);

// ── 北端：地下線北端點落在地面線線段上（0.0／0.3 m），從那一點切開，保留以北 ──
const north = {};
for (const side of ['W', 'E']) {
  const w = structuredClone(wayOf(NORTH[side])), last = ug[(side === 'W' ? WEST : EAST).at(-1)], J = last.nodes.at(-1), Jc = last.coordinates.at(-1);
  const pr = project(w.coordinates, Jc); assert(pr.d < 0.5, `北端 ${side} 接點離地面線 ${pr.d.toFixed(2)} m`);
  const southToNorth = w.coordinates[0][1] < w.coordinates.at(-1)[1];
  if (southToNorth) { w.nodes = [J, ...w.nodes.slice(pr.seg + 1)]; w.coordinates = [Jc, ...w.coordinates.slice(pr.seg + 1)]; }
  else { w.nodes = [...w.nodes.slice(0, pr.seg + 1), J]; w.coordinates = [...w.coordinates.slice(0, pr.seg + 1), Jc]; }
  north[side] = {way: w, junction: J, offsetM: pr.d};
}

// ── 南端：1:25 漸變銜接段 ──
const south = {};
for (const side of ['W', 'E']) {
  const first = ug[(side === 'W' ? WEST : EAST)[0]], P0 = first.coordinates[0], surf = structuredClone(wayOf(SURF[side]));
  const pr = project(surf.coordinates, P0), cum = cumOf(surf.coordinates), southToNorth = surf.coordinates[0][1] < surf.coordinates.at(-1)[1];
  const want = southToNorth ? pr.s - TAPER * pr.d : pr.s + TAPER * pr.d;
  const mi = southToNorth ? cum.findLastIndex(s => s <= want) : cum.findIndex(s => s >= want);
  assert(mi > 0 && mi < cum.length - 1, `南端 ${side} 找不到接點`);
  const M = surf.nodes[mi], Mc = surf.coordinates[mi];
  // 兩端切線都朝南：地下線往南延伸的方向、地面線在接點往南的方向
  const u0 = unit(first.coordinates[1], first.coordinates[0]), u1 = southToNorth ? unit(surf.coordinates[mi], surf.coordinates[mi - 1]) : unit(surf.coordinates[mi], surf.coordinates[mi + 1]);
  const A = toXY(P0), B = toXY(Mc), L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(2, Math.round(L / 20));
  const nodes = [first.nodes[0]], coordinates = [P0];
  for (let k = 1; k < n; k++) {
    const t = k / n, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    nodes.push(`${LINK[side]}:${k}`); coordinates.push(toLL([0, 1].map(j => h00 * A[j] + h10 * L * u0[j] + h01 * B[j] + h11 * L * u1[j])));
  }
  nodes.push(M); coordinates.push(Mc);
  const tags = {railway: 'rail', name: '縱貫線', 'name:zh': '縱貫線', ref: '縱貫線', operator: '國營臺灣鐵路股份有限公司', gauge: '1067', usage: 'main', electrified: 'contact_line', voltage: '25000',
    note: '臺南地下化南端銜接段：OSM 地下線南端與地面線之間沒有畫，依 1:25 漸變推估，兩端皆為 OSM 節點'};
  const link = {id: LINK[side], system: 'tra_sched', tags, nodes, coordinates};
  if (southToNorth) { surf.nodes = surf.nodes.slice(0, mi + 1); surf.coordinates = surf.coordinates.slice(0, mi + 1); }
  else { surf.nodes = surf.nodes.slice(mi); surf.coordinates = surf.coordinates.slice(mi); }
  south[side] = {way: surf, link, merge: M, ugEnd: first.nodes[0], offsetM: pr.d, lengthM: makePath(coordinates).length};
}

// ── 臺南站停車點：TDX 站座標投影到 4 股 ──
const tdx = stationInfo['台南']; assert(tdx && tdx.id === '4220', 'tra_station_info 找不到臺南 4220');
const tdxLL = [tdx.lon, tdx.lat], stops = {}, inferred = [];
for (const [key, id] of [['WM', MAIN.W], ['WL', LOOP.W], ['EM', MAIN.E], ['EL', LOOP.E]]) {
  const w = ug[id], pr = project(w.coordinates, tdxLL), a = w.coordinates[pr.seg], b = w.coordinates[pr.seg + 1];
  assert(pr.t > 1e-6 && pr.t < 1 - 1e-6, `${id} 停車點落在節點上`);
  const c = [a[0] + (b[0] - a[0]) * pr.t, a[1] + (b[1] - a[1]) * pr.t], sid = `estimated:${STATION}:${id}:${pr.seg}`;
  inferred.push({id: sid, station: STATION, system: 'tra_sched', sourceWay: id, sourceSegment: [w.nodes[pr.seg], w.nodes[pr.seg + 1]], fraction: pr.t, coordinate: c});
  w.nodes.splice(pr.seg + 1, 0, sid); w.coordinates.splice(pr.seg + 1, 0, c);
  stops[key] = sid;
}
// 停車點要在兩組道岔之間，而且離道岔至少半列 12 輛編組（120 m）
for (const [key, main, loop] of [['WM', MAIN.W, LOOP.W], ['WL', MAIN.W, LOOP.W], ['EM', MAIN.E, LOOP.E], ['EL', MAIN.E, LOOP.E]]) {
  const w = ug[key.endsWith('M') ? main : loop], p = makePath(w.coordinates), i = w.nodes.indexOf(stops[key]);
  const ends = [ug[loop].nodes[0], ug[loop].nodes.at(-1)].map(n => w.nodes.indexOf(n));
  assert(ends.every(j => j >= 0), `${key} 道岔不在 ${w.id} 上`);
  const gap = Math.min(...ends.map(j => Math.abs(p.d[j] - p.d[i])));
  assert(Math.min(...ends) < i && i < Math.max(...ends) && gap >= 120, `${key} 停車點離道岔 ${gap.toFixed(0)} m`);
}

// ── 組回網路：拿掉的 way 由新 way 頂替原陣列位置 ──
const added = [south.W.link, ...WEST.map(id => ug[id]), ug[LOOP.W], south.E.link, ...EAST.map(id => ug[id]), ug[LOOP.E]];
const slots = REMOVE.map(id => wayIndex.get(id)).sort((a, b) => a - b);
added.forEach((w, k) => { if (k < slots.length) net.ways[slots[k]] = w; else net.ways.push(w); });
for (const side of ['W', 'E']) { net.ways[wayIndex.get(SURF[side])] = south[side].way; net.ways[wayIndex.get(NORTH[side])] = north[side].way; }
const idx = new Map(net.ways.map((w, i) => [String(w.id), i]));
assert.equal(idx.size, net.ways.length, 'way id 重複');

// ── 14 條路徑：照節點序列重建 walk ──
const seg = (id, from, to) => {
  const wi = idx.get(id), w = net.ways[wi], a = w.nodes.indexOf(from), b = w.nodes.indexOf(to);
  assert(a >= 0 && b >= 0 && a !== b, `${id} 上找不到 ${from}→${to}`);
  return a < b ? [wi, a, b - a] : [wi, a - 1, -(a - b)];
};
const keep = (pid, k) => { const e = base.paths[pid].walk[k]; assert(!REMOVE.includes(String(base.ways[e[0]].id))); return [...e]; };
const W = ug, nW = north.W.junction, nE = north.E.junction;
const WL = {s: ug[LOOP.W].nodes.at(-1), n: ug[LOOP.W].nodes[0]}, EL = {s: ug[LOOP.E].nodes[0], n: ug[LOOP.E].nodes.at(-1)};
const northboundIn = [seg(SURF.W, wayOf(SURF.W).nodes[0], south.W.merge), seg(LINK.W, south.W.merge, south.W.ugEnd),
  seg(WEST[0], W[WEST[0]].nodes[0], W[WEST[0]].nodes.at(-1)), seg(WEST[1], W[WEST[1]].nodes[0], W[WEST[1]].nodes.at(-1)), seg(MAIN.W, W[MAIN.W].nodes[0], stops.WM)];
const southboundOut = from => [seg(MAIN.E, from, W[MAIN.E].nodes[0]), seg(EAST[1], W[EAST[1]].nodes.at(-1), W[EAST[1]].nodes[0]),
  seg(EAST[0], W[EAST[0]].nodes.at(-1), south.E.ugEnd), seg(LINK.E, south.E.ugEnd, south.E.merge), seg(SURF.E, south.E.merge, net.ways[idx.get(SURF.E)].nodes.at(-1))];
const fromLoopE = [seg(LOOP.E, stops.EL, EL.s)], toLoopE = [seg(LOOP.E, EL.s, stops.EL)];
const northboundSouthIn = to => [seg(SURF.E, net.ways[idx.get(SURF.E)].nodes.at(-1), south.E.merge), seg(LINK.E, south.E.merge, south.E.ugEnd),
  seg(EAST[0], south.E.ugEnd, W[EAST[0]].nodes.at(-1)), seg(EAST[1], W[EAST[1]].nodes[0], W[EAST[1]].nodes.at(-1)), seg(MAIN.E, W[MAIN.E].nodes[0], to)];
const fromNorth = to => [seg(NORTH.E, net.ways[idx.get(NORTH.E)].nodes[0], nE), seg(EAST[4], nE, W[EAST[4]].nodes[0]), seg(EAST[3], W[EAST[3]].nodes.at(-1), W[EAST[3]].nodes[0]), seg(MAIN.E, W[MAIN.E].nodes.at(-1), to)];
const toNorthE = from => [seg(MAIN.E, from, W[MAIN.E].nodes.at(-1)), seg(EAST[3], W[EAST[3]].nodes[0], W[EAST[3]].nodes.at(-1)), seg(EAST[4], W[EAST[4]].nodes[0], nE), seg(NORTH.E, nE, net.ways[idx.get(NORTH.E)].nodes[0])];
const plan = {
  5534: {to: stops.WM, walk: [keep(5534, 0), keep(5534, 1), keep(5534, 2), ...northboundIn]},
  21177: {to: stops.WM, walk: [keep(21177, 0), keep(21177, 1), keep(21177, 2), ...northboundIn]},
  5541: {from: stops.WM, walk: [seg(MAIN.W, stops.WM, W[MAIN.W].nodes.at(-1)), seg(WEST[3], W[WEST[3]].nodes[0], W[WEST[3]].nodes.at(-1)), seg(WEST[4], W[WEST[4]].nodes[0], nW),
    seg(NORTH.W, nW, net.ways[idx.get(NORTH.W)].nodes.at(-1)), keep(5541, 3), keep(5541, 4)]},
  5065: {to: stops.EL, walk: [keep(5065, 0), keep(5065, 1), ...fromNorth(EL.n), seg(LOOP.E, EL.n, stops.EL)]},
  5066: {to: stops.EM, walk: [keep(5066, 0), keep(5066, 1), ...fromNorth(stops.EM)]},
  5068: {from: stops.EL, walk: [...fromLoopE, ...southboundOut(EL.s), keep(5068, 5), keep(5068, 6), keep(5068, 7)]},
  5069: {from: stops.EL, walk: [...fromLoopE, ...southboundOut(EL.s), keep(5069, 5), keep(5069, 6), keep(5069, 7)]},
  5072: {from: stops.EM, walk: [...southboundOut(stops.EM), keep(5072, 5), keep(5072, 6), keep(5072, 7)]},
  20415: {from: stops.EM, walk: [...southboundOut(stops.EM), keep(20415, 5), keep(20415, 6), keep(20415, 7)]},
  5535: {to: stops.EL, walk: [keep(5535, 0), keep(5535, 1), keep(5535, 2), ...northboundSouthIn(EL.s), ...toLoopE]},
  5536: {to: stops.EM, walk: [keep(5536, 0), keep(5536, 1), keep(5536, 2), ...northboundSouthIn(stops.EM)]},
  5537: {to: stops.EL, walk: [keep(5537, 0), keep(5537, 1), keep(5537, 2), ...northboundSouthIn(EL.s), ...toLoopE]},
  5540: {from: stops.EL, walk: [seg(LOOP.E, stops.EL, EL.n), ...toNorthE(EL.n), keep(5540, 3), keep(5540, 4)]},
  5542: {from: stops.EM, walk: [...toNorthE(stops.EM), keep(5542, 3), keep(5542, 4)]},
};
// 只會有這 14 條碰到拿掉或切短的 way
const touched = new Set([...REMOVE, SURF.W, SURF.E, NORTH.W, NORTH.E].map(id => base.ways.findIndex(w => String(w.id) === id)));
const hit = Object.keys(base.paths).filter(pid => base.paths[pid].walk.some(([wi]) => touched.has(wi)));
assert.deepEqual(hit.sort(), Object.keys(plan).sort(), '碰到臺南段的路徑跟預期的 14 條不同');
const nodesOf = walk => { const ids = []; for (const [wi, start, count] of walk) { const w = net.ways[wi], sign = Math.sign(count);
  for (let j = 0; j < Math.abs(count); j++) { const i = start + j * sign, a = i + (sign < 0 ? 1 : 0), b = i + (sign > 0 ? 1 : 0);
    if (!ids.length) ids.push(w.nodes[a]); else assert.equal(ids.at(-1), w.nodes[a], '實體股道不連續'); ids.push(w.nodes[b]); } } return ids; };
const coordsOf = walk => walk.flatMap(([wi, start, count], k) => { const w = net.ways[wi], sign = Math.sign(count), out = [];
  for (let j = 0; j < Math.abs(count); j++) { const i = start + j * sign; if (!k && !j) out.push(w.coordinates[i + (sign < 0 ? 1 : 0)]); out.push(w.coordinates[i + (sign > 0 ? 1 : 0)]); } return out; });
// 長度公式先拿沒動的路徑對一次，確認跟打包時算法一致
for (const pid of Object.keys(base.paths).filter(p => !plan[p]).slice(0, 50)) assert(Math.abs(makePath(coordsOf(base.paths[pid].walk)).length - base.paths[pid].lengthM) < 1e-6, `路徑 ${pid} 長度算法不一致`);
const groupOf = stop => 'tra_sched:' + inferred.find(r => r.id === stop).sourceWay;
for (const [pid, p] of Object.entries(plan)) {
  const old = base.paths[pid], ids = nodesOf(p.walk), rec = {...old, walk: p.walk};
  if (p.from) { rec.from = p.from; rec.fromGroup = groupOf(p.from); }
  if (p.to) { rec.to = p.to; rec.toGroup = groupOf(p.to); }
  assert.equal(ids[0], rec.from, `${pid} 起點`); assert.equal(ids.at(-1), rec.to, `${pid} 終點`);
  if (!p.from) assert.equal(ids[0], old.from); if (!p.to) assert.equal(ids.at(-1), old.to);
  rec.lengthM = makePath(coordsOf(p.walk)).length;
  net.paths[pid] = rec;
}

// ── 節點標籤：拿掉沒有任何 way 再引用的舊節點標籤，補地下線道岔與推估停車點 ──
const live = new Set(net.ways.flatMap(w => w.nodes));
const removedTags = [];
for (const id of new Set([...REMOVE, SURF.W, SURF.E, NORTH.W, NORTH.E].flatMap(id => base.ways[wayIndex.get(id)].nodes)))
  if (!live.has(id) && net.nodeTags[id]) { removedTags.push([id, net.nodeTags[id].name || net.nodeTags[id].railway]); delete net.nodeTags[id]; }
for (const w of added) for (const n of w.nodes) { const t = osmNodeTags.get(n); if (t?.railway === 'switch') net.nodeTags[n] = {railway: 'switch'}; }
for (const r of inferred) net.nodeTags[r.id] = {railway: 'stop', name: '臺南', _source: 'estimated-stop-on-osm-track'};
net.inferredStops.push(...inferred);

net.extensions.push({
  name: '臺南鐵路地下化第一階段（2026-10-17 通車）', source: 'OpenStreetMap / Overpass', snapshot: FIXTURE, osmBase: osm.osm3s.timestamp_osm_base, date: '2026-10-17',
  ways: added.map(w => w.id), removedWays: REMOVE,
  truncatedWays: Object.fromEntries(['W', 'E'].flatMap(s => [[SURF[s], {keep: 'south', at: south[s].merge}], [NORTH[s], {keep: 'north', at: north[s].junction, offsetM: +north[s].offsetM.toFixed(2)}]])),
  inferredLinks: Object.fromEntries(['W', 'E'].map(s => [LINK[s], {from: south[s].ugEnd, to: south[s].merge, lateralOffsetM: +south[s].offsetM.toFixed(2), lengthM: +south[s].lengthM.toFixed(1), taper: `1:${TAPER}`}])),
  stops: inferred.map(r => r.id), reroutedPaths: Object.keys(plan),
  note: 'OSM 地下線仍標 railway=construction，依台鐵 10/15 新聞稿 10/17 通車改成 rail，其餘標籤照留。南端銜接段與臺南站 4 股停車點是推估；北上走西側正線、南下走東側（原側線停靠的改停外側股，原正線停靠的停正線）。林森、南臺南尚未啟用，不設停車點。',
});

fs.writeFileSync('rail-3d/physical/network.json', JSON.stringify(net));
console.log(JSON.stringify({
  base: sha, ways: [base.ways.length, net.ways.length], added: added.length, removed: REMOVE.length,
  south: Object.fromEntries(['W', 'E'].map(s => [s, {merge: south[s].merge, offsetM: +south[s].offsetM.toFixed(2), linkM: +south[s].lengthM.toFixed(1)}])),
  north: Object.fromEntries(['W', 'E'].map(s => [s, {junction: north[s].junction, offsetM: +north[s].offsetM.toFixed(2)}])),
  stops, removedTags: removedTags.length, paths: Object.fromEntries(Object.keys(plan).map(p => [p, [+base.paths[p].lengthM.toFixed(1), +net.paths[p].lengthM.toFixed(1)]])),
}, null, 1));
