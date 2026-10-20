// 台鐵同向待避缺的站場渡線（大山、頭城）：OSM 沒畫、NLSC 正射影像看得到的道岔，補進出貨路網，並補待避的進出站路徑。
//
// 派車表 10/18 大山北上 2550 待避 158、頭城北上 4037 待避 443。待避換股只從已打包的路徑挑（rail-3d/physical/overtake-sidings.js），
// 這兩站北上正線在 OSM 上沒有通往站內別股的道岔：大山缺北上→南下正線的渡線（側線 198611896 只接在南下正線上），
// 頭城站內股道南端畫成車擋，兩車只能停／過同一股。10-20 用 OSM API 0.6 重抓，兩站附近的股道與 2026-09-07 快照相同，
// 缺口在 OSM 本身。影像判讀值、來源與方法在 scripts/fixtures/tra-yield-crossovers-nlsc-1020.json。
//
// 改動（其餘 way、路徑、節點標籤逐 byte 不變；way 陣列位置不動，新 way 接在最後）：
//   大山：在 372043053、789641626 各插一個道岔節點（落在 OSM 線形上，沿線距離取影像判讀值），兩點之間接一條渡線 way。
//         經過這兩條 way 的既有路徑照節點序列重編 walk（節點序列只多出新道岔節點，長度差 < 1 mm）。
//   頭城：從北上正線既有接點 2045873638 接一條股道到 194075775 南端（原車擋 2045873667，拿掉 buffer_stop 標籤）。
//   兩站：補待避的進站段、出站段路徑（overtakePaths），檢查同 extend_tra_overtake_sidings.mjs（南平）：
//         經過的 way 與下面逐條覆核過的清單相同、道岔不倒車、與同站對現行派車的前後段接得上、長度不比派車表最長的長超過 1 m。
//         例外只有大山：北上待避車要從渡線落地點逆向走南下正線 789641626 到側線道岔 3755778623，再走側線 198611896 到北端道岔
//         3755778633。198611896 沒有 service 標籤、派車表只有南下車停過，方向模型因此把它判成只准南下；它其實是兩道岔之間的
//         站內待避線。這兩條的逆向都在站內兩個道岔之間，這裡明列並限長；原生待避規劃器的站內換股放寬
//        （OvertakeSidings localStationChange：進出口都是道岔、離本站比離鄰站近、不經過別站）也只准這種。
//
// 跑法：BASE_REF=<改動前已驗證的 commit> node scripts/extend_tra_yield_crossovers_1020.mjs
// 之後跑 splice_tra_yield_crossovers_profiles_1020.mjs 的顯示高度與層位局部重產，再重產 tra_track_sections、run profiles、manifest。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {makePath} from '../rail-3d/integration/train-path.js';
import {makeDirectionModel} from './lib/track_directions.mjs';

const NAME = '台鐵待避站場渡線（大山、頭城，NLSC 正射影像判讀）';
const ref = process.env.BASE_REF; assert(ref, '必須明確指定改動前的 BASE_REF');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
const show = f => JSON.parse(execFileSync('git', ['-C', root, 'show', `${sha}:${f}`], {maxBuffer: 256 * 1024 * 1024}));
const base = show('rail-3d/physical/network.json'), dispatch = show('rail-3d/physical/dispatch.json');
assert(!base.extensions?.some(e => e.name === NAME), 'BASE_REF 已經含這筆 extension');
const FIXTURE = 'scripts/fixtures/tra-yield-crossovers-nlsc-1020.json';
const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const DS = fx.sites['大山'], TC = fx.sites['頭城'];
const net = structuredClone(base);
const wayIndex = new Map(net.ways.map((w, i) => [String(w.id), i]));
const wayOf = id => net.ways[wayIndex.get(id)];

// ── 平面幾何（各站附近的公尺座標）──
const frame = c0 => { const MX = 111320 * Math.cos(c0[1] * Math.PI / 180), MY = 111320;
  return {xy: ([lon, lat]) => [(lon - c0[0]) * MX, (lat - c0[1]) * MY], ll: ([x, y]) => [+(x / MX + c0[0]).toFixed(7), +(y / MY + c0[1]).toFixed(7)]}; };
const nodesOf = (n, walk) => { const ids = []; for (const [wi, start, count] of walk) { const w = n.ways[wi], sign = Math.sign(count);
  for (let j = 0; j < Math.abs(count); j++) { const i = start + j * sign, a = i + (sign < 0 ? 1 : 0), b = i + (sign > 0 ? 1 : 0);
    if (!ids.length) ids.push(w.nodes[a]); else assert.equal(ids.at(-1), w.nodes[a], '實體股道不連續'); ids.push(w.nodes[b]); } } return ids; };
const coordsOf = (n, walk) => walk.flatMap(([wi, start, count], k) => { const w = n.ways[wi], sign = Math.sign(count), out = [];
  for (let j = 0; j < Math.abs(count); j++) { const i = start + j * sign; if (!k && !j) out.push(w.coordinates[i + (sign < 0 ? 1 : 0)]); out.push(w.coordinates[i + (sign > 0 ? 1 : 0)]); } return out; });
// 每一步：[wayIndex, 起點節點, 終點節點]
const stepsOf = (n, walk) => walk.flatMap(([wi, start, count]) => { const w = n.ways[wi], sign = Math.sign(count);
  return Array.from({length: Math.abs(count)}, (_, j) => { const i = start + j * sign; return sign > 0 ? [wi, w.nodes[i], w.nodes[i + 1]] : [wi, w.nodes[i + 1], w.nodes[i]]; }); });
const encode = (n, steps) => { const walk = []; let prior = null;
  for (const [wi, a, b] of steps) { const ns = n.ways[wi].nodes, ia = ns.indexOf(a), ib = ns.indexOf(b);
    assert(ia >= 0 && Math.abs(ia - ib) === 1, `way ${n.ways[wi].id} 上 ${a}→${b} 不相鄰`);
    const dir = ib > ia ? 1 : -1, ix = Math.min(ia, ib);
    if (prior && prior[0] === wi && Math.sign(prior[2]) === dir && prior[1] + prior[2] === ix) prior[2] += dir; else { prior = [wi, ix, dir]; walk.push(prior); } }
  return walk; };
// 長度公式先拿沒動的路徑對一次，確認跟打包時算法一致
for (const pid of Object.keys(base.paths).slice(0, 50)) assert(Math.abs(makePath(coordsOf(base, base.paths[pid].walk)).length - base.paths[pid].lengthM) < 1e-6, `路徑 ${pid} 長度算法不一致`);

// 進站路徑上「停車點往回 |alongM| 公尺」那一點：回傳座標與它落在哪一步
function pointOnRef(site, alongM) {
  const p = base.paths[site.refPath], steps = stepsOf(base, p.walk), cs = coordsOf(base, p.walk), path = makePath(cs);
  assert.equal(p.to, site.stopNode, `${site.refPath} 不是停在 ${site.stopNode}`);
  const s = path.length + alongM, i = path.d.findIndex((d, k) => k && d >= s) - 1;
  assert(i >= 0, `沿線 ${alongM} m 超出路徑 ${site.refPath}`);
  const t = (s - path.d[i]) / (path.d[i + 1] - path.d[i]), a = cs[i], b = cs[i + 1];
  return {c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], step: steps[i], t};
}
// 在 way 的 seg 段（節點 seg 與 seg+1 之間）插入節點
function insertNode(wayId, seg, id, c) {
  const w = wayOf(wayId); assert.equal(new Set(w.nodes).size, w.nodes.length, `${wayId} 節點重複`);
  w.nodes.splice(seg + 1, 0, id); w.coordinates.splice(seg + 1, 0, c);
  return {way: wayId, between: [w.nodes[seg], w.nodes[seg + 2]]};
}
const tagsFrom = (wayId, extra) => { const t = wayOf(wayId).tags, out = {railway: 'rail'};
  for (const k of ['name', 'name:zh', 'operator', 'gauge', 'electrified', 'voltage']) if (t[k]) out[k] = t[k];
  return {...out, ...extra}; };

// ── 大山：北上正線→南下正線的渡線 ──
const X = DS.crossover, inserted = {};
{
  const P1 = pointOnRef(DS, X.from.alongM), P2 = pointOnRef(DS, X.to.alongM), w1 = base.ways[P1.step[0]];
  assert.equal(String(w1.id), X.from.way, `沿線 ${X.from.alongM} m 不在 ${X.from.way} 上`);
  assert(P1.t > 0.02 && P1.t < 0.98, '渡線北上端太靠近既有節點');
  const seg1 = w1.nodes.indexOf(P1.step[1]) < w1.nodes.indexOf(P1.step[2]) ? w1.nodes.indexOf(P1.step[1]) : w1.nodes.indexOf(P1.step[2]);
  // 南下端：沿線同一處的進站路徑點，垂直投影到南下正線
  const F = frame(P2.c), w2 = wayOf(X.to.way), P = F.xy(P2.c);
  let best = null;
  for (let i = 0; i + 1 < w2.coordinates.length; i++) {
    const A = F.xy(w2.coordinates[i]), B = F.xy(w2.coordinates[i + 1]), vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy;
    const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / L2)), d = Math.hypot(P[0] - A[0] - t * vx, P[1] - A[1] - t * vy);
    if (!best || d < best.d) best = {seg: i, t, d};
  }
  assert(best.d > 3 && best.d < 8 && best.t > 0.02 && best.t < 0.98, `南下正線投影不合理：${best.d.toFixed(2)} m、t=${best.t.toFixed(3)}`);
  const a = w2.coordinates[best.seg], b = w2.coordinates[best.seg + 1], c2 = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
  inserted[X.from.node] = {...insertNode(X.from.way, seg1, X.from.node, P1.c), alongM: X.from.alongM};
  inserted[X.to.node] = {...insertNode(X.to.way, best.seg, X.to.node, c2), alongM: X.to.alongM, offsetM: +best.d.toFixed(2)};
  net.ways.push({id: X.id, system: 'tra_sched', tags: tagsFrom(X.from.way, {service: 'crossover', note: '大山站南端渡線：OSM 沒畫，依 NLSC 正射影像判讀（scripts/fixtures/tra-yield-crossovers-nlsc-1020.json）'}),
    nodes: [X.from.node, X.to.node], coordinates: [P1.c, c2]});
  for (const n of [X.from.node, X.to.node]) net.nodeTags[n] = {railway: 'switch'};
}

// ── 頭城：站內股道 194075775 南端接回北上正線 ──
const T = TC.throat;
let throatInfo;
{
  const main = wayOf('194075783'), track = wayOf(TC.overtake.siding);
  assert.equal(main.nodes.at(-1), T.switchNode, '岔心不在北上正線南端');
  assert.equal(track.nodes.at(-1), T.toNode, '194075775 南端節點不同');
  assert.deepEqual(net.nodeTags[T.toNode], {railway: 'buffer_stop'}, '194075775 南端原本不是車擋');
  assert(!net.nodeTags[T.switchNode], '岔心節點原本有標籤');
  const nb = net.ways.filter(w => w.nodes.includes(T.switchNode)).map(w => String(w.id)).sort();
  assert.deepEqual(nb, ['194075782', '194075783'], '岔心節點原本不是兩條正線的接頭');
  const S = main.coordinates.at(-1), E = track.coordinates.at(-1), F = frame(S);
  const unit = (p, q) => { const A = F.xy(p), B = F.xy(q), L = Math.hypot(B[0] - A[0], B[1] - A[1]); return [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; };
  const u0 = unit(S, main.coordinates.at(-2)), u1 = unit(E, track.coordinates.at(-2)); // 兩端都朝北
  // E 在進站路徑上的沿線位置：投影到北上正線（停車點＝0）
  const stopC = main.coordinates[main.nodes.indexOf(TC.stopNode)], Ex = F.xy(E), Sx = F.xy(S), Zx = F.xy(stopC);
  const axis = [Zx[0] - Sx[0], Zx[1] - Sx[1]], axL = Math.hypot(...axis), alongE = ((Ex[0] - Zx[0]) * axis[0] + (Ex[1] - Zx[1]) * axis[1]) / axL;
  assert(alongE < -50 && alongE > -70, `194075775 南端沿線 ${alongE.toFixed(1)} m`);
  const Q = [Ex[0] - u1[0] * (alongE - T.parallelFromAlongM), Ex[1] - u1[1] * (alongE - T.parallelFromAlongM)];
  const L = Math.hypot(Q[0] - Sx[0], Q[1] - Sx[1]), n = Math.max(2, Math.round(L / 10)), nodes = [T.switchNode], coordinates = [S];
  for (let k = 1; k <= n; k++) {
    const t = k / n, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    nodes.push(`${T.id}:${k}`); coordinates.push(F.ll([0, 1].map(j => h00 * Sx[j] + h10 * L * u0[j] + h01 * Q[j] + h11 * L * u1[j])));
  }
  nodes.push(T.toNode); coordinates.push(E);
  const lateral = (axis[0] * (Ex[1] - Sx[1]) - axis[1] * (Ex[0] - Sx[0])) / axL;
  net.ways.push({id: T.id, system: 'tra_sched', tags: tagsFrom('194075783', {note: '頭城站內股道 194075775 南端接回北上正線：OSM 畫成車擋，依 NLSC 正射影像判讀（scripts/fixtures/tra-yield-crossovers-nlsc-1020.json）'}), nodes, coordinates});
  delete net.nodeTags[T.toNode];
  net.nodeTags[T.switchNode] = {railway: 'switch'};
  throatInfo = {alongM: +alongE.toFixed(1), lateralM: +lateral.toFixed(2), curveM: +L.toFixed(1), lengthM: +makePath(coordinates).length.toFixed(1)};
}
const idx = new Map(net.ways.map((w, i) => [String(w.id), i]));
assert.equal(idx.size, net.ways.length, 'way id 重複');

// ── 經過插點 way 的既有路徑：照節点序列重編 walk ──
const split = new Map(Object.entries(inserted).map(([id, r]) => [wayIndex.get(r.way) + '|' + [...r.between].sort().join('|'), id]));
const rerouted = {};
for (const [pid, p] of Object.entries(base.paths)) {
  const steps = stepsOf(base, p.walk); let hit = false;
  const out = steps.flatMap(([wi, a, b]) => { const x = split.get(wi + '|' + [a, b].sort().join('|')); if (!x) return [[wi, a, b]]; hit = true; return [[wi, a, x], [wi, x, b]]; });
  if (!hit) {
    // 沒經過插點那一段、但經過插點 way 的路徑：節點序不變，只有索引位移
    if (!p.walk.some(([wi]) => [...Object.values(inserted)].some(r => wayIndex.get(r.way) === wi))) continue;
  }
  const walk = encode(net, out), ids = nodesOf(net, walk);
  assert.equal(ids[0], p.from); assert.equal(ids.at(-1), p.to);
  assert.deepEqual(ids.filter(n => !inserted[n]), nodesOf(base, p.walk), `${pid} 節點序列除了新道岔以外不同`);
  const lengthM = makePath(coordsOf(net, walk)).length;
  assert(Math.abs(lengthM - p.lengthM) < 1e-3, `${pid} 長度差 ${lengthM - p.lengthM}`);
  net.paths[pid] = {...p, walk, lengthM};
  rerouted[pid] = hit ? 'split' : 'shift';
}
// inferredStops 不得落在被切開的那一段
for (const s of net.inferredStops) if (s.sourceSegment) assert(!split.has(idx.get(String(s.sourceWay)) + '|' + [...s.sourceSegment].sort().join('|')), `推估停車點 ${s.id} 落在被切開的段`);

// ── 待避進出站路徑 ──
const M = makeDirectionModel({net, dispatch});
const {clean} = M.classify();
const pairOf = pid => { for (const [, plan] of M.plans) { const i = plan.pathIds.indexOf(+pid); if (i >= 0) { const sig = M.sigOf(plan); return [sig[i][0], sig[i + 1][0]].map(s => s.split(':')[1]); } } assert.fail('派車表沒有路徑 ' + pid); };
const pairMax = new Map();
for (const [, plan] of M.plans) {
  const sig = M.sigOf(plan);
  plan.pathIds.forEach((id, i) => { const k = [sig[i][0], sig[i + 1][0]].sort().join('|'); if (M.paths[id]) pairMax.set(k, Math.max(pairMax.get(k) || 0, M.paths[id].lengthM)); });
}
const neighbours = (id, side) => new Set(M.plans.flatMap(([, p]) => p.pathIds.flatMap((x, i) => x !== id ? [] : side < 0 ? (i ? [p.pathIds[i - 1]] : []) : (i + 1 < p.pathIds.length ? [p.pathIds[i + 1]] : []))));
const wayList = ids => ids.reduce((a, e) => { const w = M.edges[e].wayId; if (a.at(-1) !== w) a.push(w); return a; }, []);
// 逐條覆核過的經過 way（進站段前段、出站段後段＝同站對現行派車路徑走的正線）與准許的逆向
const SITES = [
  {site: DS, local: {in: [X.id, X.to.way, DS.overtake.siding], out: [DS.overtake.siding]}, wrong: {in: {[X.to.way]: 130, [DS.overtake.siding]: 300}, out: {[DS.overtake.siding]: 450}}},
  {site: TC, local: {in: [T.id, TC.overtake.siding], out: [TC.overtake.siding, '194075780']}, wrong: {in: {}, out: {}}},
];
const overtakePaths = {}, report = [];
for (const {site, local, wrong} of SITES) {
  const name = Object.keys(fx.sites).find(k => fx.sites[k] === site), stop = site.overtake.stop;
  const mainIn = site.refPath, mainOut = M.plans.flatMap(([, p]) => p.pathIds.flatMap((x, i) => x === mainIn && i + 1 < p.pathIds.length ? [p.pathIds[i + 1]] : []))
    .filter(x => M.paths[x].from === site.stopNode).sort((a, b) => a - b)[0];
  assert(mainOut !== undefined, `${name} 找不到停正線後的出站路徑`);
  const legs = [
    {kind: 'in', from: M.paths[mainIn].from, to: stop, mainline: mainIn},
    {kind: 'out', from: stop, to: M.paths[mainOut].to, mainline: mainOut},
  ];
  const ids = legs.map(leg => {
    const main = M.paths[leg.mainline], pair = pairOf(leg.mainline), mainWays = wayList(main.edgeIds);
    const allowed = new Set([...mainWays, ...local[leg.kind]]), wrongOK = wrong[leg.kind];
    const edgeAllowed = (e, from) => { if (!allowed.has(e.wayId)) return false; const dom = clean.get(e.wayId); return dom === undefined || (e.a === from ? 1 : -1) === dom || e.wayId in wrongOK; };
    const r = M.g.shortestPath({from: leg.from, to: leg.to, system: 'tra_sched', maxLength: main.lengthM + 300, edgeAllowed});
    assert(r, `${name} ${pair.join('→')} 找不到路徑`);
    const id = M.register(r), p = M.paths[id], ws = wayList(p.edgeIds);
    // 經過的 way：先走（或最後走）同站對派車路徑的正線，再接站內那幾條
    const tail = leg.kind === 'in' ? ws.slice(ws.indexOf(local.in[0])) : ws.slice(0, ws.findIndex(w => mainWays.includes(w)));
    assert.deepEqual(tail, local[leg.kind], `${name} ${leg.kind} 站內經過的 way ${tail} 與覆核清單不同`);
    const rest = leg.kind === 'in' ? ws.slice(0, ws.indexOf(local.in[0])) : ws.slice(tail.length);
    assert(rest.every(w => mainWays.includes(w)), `${name} ${leg.kind} 站外走了派車路徑以外的 way`);
    const wrongWays = M.wrongOn(p, clean);
    assert.deepEqual([...wrongWays].sort(), Object.keys(wrongOK).sort(), `${name} ${leg.kind} 逆向 ${wrongWays}`);
    for (const [w, cap] of Object.entries(wrongOK)) {
      const m = p.edgeIds.reduce((s, e) => s + (M.edges[e].wayId === w ? M.edges[e].length : 0), 0);
      assert(m <= cap, `${name} 逆向走 ${w} ${m.toFixed(1)} m 超過 ${cap} m`);
      report.push(`${name} ${leg.kind} 逆向走 ${w} ${m.toFixed(1)} m（站內兩道岔之間）`);
    }
    const max = pairMax.get(pair.map(n => 'tra_sched:' + n).sort().join('|'));
    assert(max > 0 && p.lengthM - max < 1, `${name} ${pair.join('→')} ${p.lengthM.toFixed(3)} m 比派車表最長 ${max} m 長超過 1 m`);
    const existed = !!net.paths[id];
    report.push(`${name} ${pair.join('→')} 路徑 ${id}${existed ? '（已打包）' : ''}：${p.lengthM.toFixed(3)} m（正線 ${main.lengthM.toFixed(3)}、派車表最長 ${max.toFixed(3)}）way ${ws.join(' ')}`);
    return {id, pair, existed};
  });
  assert(M.turnOK(ids[0].id, ids[1].id), name + ' 進站段接不上出站段');
  for (const prev of neighbours(legs[0].mainline, -1)) if (M.turnOK(prev, legs[0].mainline)) assert(M.turnOK(prev, ids[0].id), name + ' 前一段 ' + prev + ' 接不上進站段');
  for (const next of neighbours(legs[1].mainline, 1)) if (M.turnOK(legs[1].mainline, next)) assert(M.turnOK(ids[1].id, next), name + ' 出站段接不上後一段 ' + next);
  for (const r of ids) if (!r.existed) overtakePaths[r.id] = r.pair;
}
for (const id of Object.keys(overtakePaths)) net.paths[id] = M.newPaths[id];

net.extensions.push({
  name: NAME, source: 'NLSC 正射影像判讀（非 OSM）', imagery: fx.imagery.source, snapshot: FIXTURE, date: '2026-10-20',
  ways: [X.id, T.id], insertedNodes: inserted,
  nodeTags: {added: {[X.from.node]: 'switch', [X.to.node]: 'switch', [T.switchNode]: 'switch'}, removed: {[T.toNode]: 'buffer_stop'}},
  throat: {[T.id]: {from: T.switchNode, to: T.toNode, ...throatInfo, parallelFromAlongM: T.parallelFromAlongM}},
  reroutedPaths: Object.keys(rerouted), overtakePaths,
  note: '大山：北上正線 372043053 停車點以南 468 m 岔出、396 m 併入南下正線 789641626，北上待避車經渡線、逆向走南下正線到側線道岔 3755778623 進側線 198611896。'
    + '頭城：194075775 南端原本是車擋，改從北上正線南端接點 2045873638 接進來。overtakePaths＝路徑編號→[前站, 後站]，同南平。羅東、永康影像判讀不出，沒有補。',
});
fs.writeFileSync('rail-3d/physical/network.json', JSON.stringify(net));
console.log(report.join('\n'));
console.log(JSON.stringify({base: sha, ways: [base.ways.length, net.ways.length], inserted, throat: throatInfo, rerouted, overtakePaths}, null, 1));
