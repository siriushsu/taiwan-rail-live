// 台鐵股道的行駛方向模型（F1／F2 共用）：哪些正線 way 是「只准一個方向」的，一段路徑有沒有逆向，
// 以及在方向限制下兩個停車節點之間怎麼走。
//
// 「乾淨的方向股道」= 平行段 ≥ parFrac 長度、≥ minUses 段次通行、少數方向 ≤ minority、多數方向合乎靠左
//（台鐵靠左行駛 ⇒ 正確行駛時另一股在右側），而且它每一條被派過車的平行股道也都合乎這三條。
// 三線以上區段（七堵–八堵、竹南、臺南站區）的中股與站內雙向股道自然落在外面。
// 平行幾何的判準在 parallel_tracks.mjs（與區間表建置器同一份）。
//
// 使用者：scripts/repair_physical_directions.mjs（逐站動態規劃改道）、scripts/repair_physical_stations.mjs
//（同月台／待避的節點指派，換節點時進出路徑必須順向）。
import assert from 'node:assert/strict';
import { restorePhysicalRoutes } from './restore_physical_routes.mjs';
import { makeParallelIndex, isTrack, segLen } from './parallel_tracks.mjs';

// 站場咽喉連接段（F6，scripts/extend_tra_station_throats.mjs 補入的 service=yard 短段）：只在沒有純正線順向路徑時才准走，
// 一條路徑走 yard／spur 的總長不得超過這個上限（乾跑 81 筆全在 130 m 內），計價以 20 倍長度讓搜尋挑走最少 yard 的走法。
export const YARD_CAP_M = 150;

export function makeDirectionModel({ net, dispatch, system = 'tra_sched', parFrac = 0.8, minUses = 10, minority = 0.2, detour = len => len * 1.25 + 300 }) {
  const { g, paths, edges } = restorePhysicalRoutes(net);
  const isYard = e => ['yard', 'spur'].includes(e.tags.service);
  const yardPenalty = new Map(); for (const e of Object.values(edges)) if (isYard(e)) yardPenalty.set(e.resource, e.length * 20);
  const yardLength = r => r.edgeIds.reduce((s, eid) => s + (isYard(edges[eid]) ? edges[eid].length : 0), 0);
  const ways = net.ways, wayIndex = new Map(ways.map((w, i) => [String(w.id), i]));
  const { nearestParallel } = makeParallelIndex(ways);
  const plans = Object.entries(dispatch.plans).filter(([k]) => k.startsWith(system + ':'));
  const sigOf = plan => JSON.parse(plan.stopSignature);

  // ── 幾何（與派車無關，只算一次）：沿節點序前進，最近平行股道在左側的長度比、平行長度比、夥伴 ──
  const geom = new Map();   // wayIndex → {parFrac, leftFrac, partners:Set(wayIndex)}
  for (let wi = 0; wi < ways.length; wi++) {
    const w = ways[wi]; if (!isTrack(w)) continue;
    let total = 0, par = 0, left = 0; const partners = new Set();
    for (let i = 0; i + 1 < w.coordinates.length; i++) {
      const L = segLen(w, i); total += L; const p = nearestParallel(w, i); if (!p) continue;
      par += L; partners.add(wayIndex.get(String(p.w.id))); if (p.side === 'L') left += L;
    }
    geom.set(wi, { parFrac: total ? par / total : 0, leftFrac: par ? left / par : 0, partners });
  }

  // ── 方向統計：每條 way 被多少段路徑順著／逆著節點序走過（同一段路徑同一條 way 只計一次） ──
  const dirOfEdge = (p, k) => (edges[p.edgeIds[k]].a === p.nodeIds[k] ? 1 : -1);
  function classify(planList = plans) {
    const use = new Map();  // wayIndex → {fwd, rev}
    for (const [, plan] of planList) for (const pid of plan.pathIds) {
      const p = paths[pid]; if (!p) continue; const seen = new Set();
      for (let k = 0; k < p.edgeIds.length; k++) {
        const wi = wayIndex.get(edges[p.edgeIds[k]].wayId), key = wi + ':' + dirOfEdge(p, k); if (seen.has(key)) continue; seen.add(key);
        const u = use.get(wi) || use.set(wi, { fwd: 0, rev: 0 }).get(wi); if (dirOfEdge(p, k) > 0) u.fwd++; else u.rev++;
      }
    }
    const rows = new Map();
    for (const [wi, gm] of geom) {
      const u = use.get(wi); if (!u) continue; const n = u.fwd + u.rev, dom = u.fwd >= u.rev ? 1 : -1;
      const sideFwd = gm.leftFrac >= 0.5 ? 'L' : 'R', sideDom = dom > 0 ? sideFwd : (sideFwd === 'L' ? 'R' : 'L');
      rows.set(wi, { wi, dom, n, minority: Math.min(u.fwd, u.rev) / n, parFrac: gm.parFrac, keepLeft: sideDom === 'R', partners: gm.partners });
    }
    const selfOK = r => r && r.parFrac >= parFrac && r.n >= minUses && r.minority <= minority && r.keepLeft;
    const clean = new Map();  // wayId → 唯一允許的行進方向（沿節點序 +1／−1）
    for (const r of rows.values()) {
      if (!selfOK(r)) continue;
      const ps = [...r.partners].map(wi => rows.get(wi)).filter(Boolean);
      if (ps.length && ps.every(selfOK)) clean.set(String(ways[r.wi].id), r.dom);
    }
    return { rows, clean };
  }
  // 一段路徑在哪些乾淨股道上逆向（way id 清單，空 = 順向）
  const wrongOn = (p, clean) => [...new Set(p.edgeIds.map((eid, k) => { const e = edges[eid], dom = clean.get(e.wayId); return dom !== undefined && dirOfEdge(p, k) !== dom ? e.wayId : null; }).filter(Boolean))];

  // ── 路徑落成：walk 編碼與 pack_physical_network.mjs 同一套 [[wayIndex, startIdx, signedCount], …] ──
  function encodeWalk(edgeIds, nodeIds) {
    const walk = []; let prior = null;
    for (let i = 0; i < edgeIds.length; i++) {
      const e = edges[edgeIds[i]], ix = +edgeIds[i].split(':').at(-1), direction = e.a === nodeIds[i] ? 1 : -1, w = wayIndex.get(e.wayId);
      if (prior && prior[0] === w && Math.sign(prior[2]) === direction && prior[1] + prior[2] === ix) prior[2] += direction; else { prior = [w, ix, direction]; walk.push(prior); }
    }
    return walk;
  }
  function decodeWalk(walk) {
    const out = [];
    for (const [wi, ix, steps] of walk) { const dir = Math.sign(steps); for (let k = 0; k < Math.abs(steps); k++) out.push(ways[wi].id + ':' + (ix + k * dir)); }
    return out;
  }
  const linkOf = new Map(), bySig = new Map();  // from>to → [pathId]；from>to>edgeIds → pathId（同一條路徑只落成一次）
  paths.forEach((p, id) => { if (!p) return; const k = p.from + '>' + p.to; (linkOf.get(k) || linkOf.set(k, []).get(k)).push(id); bySig.set(k + '>' + p.edgeIds.join(','), id); });
  // 股道群組（fromGroup／toGroup）只有求解器讀；出貨檔裡的群組編號取決於建置時整份 OSM 的節點走訪順序，
  // 出貨版拓樸重算不出同一個編號（同一節點甚至已有兩種編號並存），所以沿用既有路徑在同一節點上先看到的值。
  const groupByNode = new Map();
  for (const p of paths) if (p && p.system === system) for (const [node, grp] of [[p.from, p.fromGroup], [p.to, p.toGroup]]) if (!groupByNode.has(node)) groupByNode.set(node, grp);
  const groupOf = node => groupByNode.get(node) ?? (system + ':' + (g.trackGroups.get(node) || node));
  const newPaths = {}; let nextId = Math.max(...Object.keys(net.paths).map(Number)) + 1;
  function register(route) {
    const from = route.nodeIds[0], to = route.nodeIds.at(-1), sig = from + '>' + to + '>' + route.edgeIds.join(',');
    if (bySig.has(sig)) return bySig.get(sig);
    const id = nextId++, walk = encodeWalk(route.edgeIds, route.nodeIds);
    assert.deepEqual(decodeWalk(walk), route.edgeIds, 'walk 編碼往返不一致 ' + id);
    // preference 只有 CP-SAT 求解器讀（相對側 ×10 ＋ 岔道數 ×2），這裡不重解；相對側算不出來（站的候選中心不在出貨檔），只記岔道那一項。
    const preference = route.edgeIds.filter(eid => edges[eid].tags.service === 'crossover').length * 2;
    newPaths[id] = { from, to, fromGroup: groupOf(from), toGroup: groupOf(to), system, lengthM: route.lengthM, preference, walk };
    paths[id] = { ...newPaths[id], nodeIds: route.nodeIds, edgeIds: route.edgeIds };
    bySig.set(sig, id); (linkOf.get(from + '>' + to) || linkOf.set(from + '>' + to, []).get(from + '>' + to)).push(id);
    return id;
  }
  // 兩節點之間的順向路徑：先挑既有路徑裡本來就順向的最短者，沒有才用方向限制重求（memo 跟著同一份 clean 走）
  function cleanRoute(a, b, refLen, clean, memo) {
    const key = a + '>' + b; if (memo.has(key)) return memo.get(key);
    let best = null;
    for (const id of linkOf.get(key) || []) if (!wrongOn(paths[id], clean).length && (best === null || paths[id].lengthM < paths[best].lengthM)) best = id;
    let res = best !== null ? { id: best, lengthM: paths[best].lengthM } : null;
    if (!res) {
      const edgeAllowed = (edge, from) => { const dom = clean.get(edge.wayId); return dom === undefined || (edge.a === from ? 1 : -1) === dom; };
      let r = g.shortestPath({ from: a, to: b, system, maxLength: detour(refLen), edgeAllowed });
      if (!r && yardPenalty.size) { r = g.shortestPath({ from: a, to: b, system, maxLength: detour(refLen), edgeAllowed, allowYard: true, penalties: yardPenalty }); if (r && yardLength(r) > YARD_CAP_M) r = null; }
      if (r) { assert.equal(wrongOn({ edgeIds: r.edgeIds, nodeIds: r.nodeIds }, clean).length, 0); res = { id: register(r), lengthM: r.lengthM }; }
    }
    memo.set(key, res); return res;
  }

  // ── 兩段路徑在共用的停車節點接不接得上：道岔不得倒車、平面交叉只走直向（與 verify_remaining_station_routes.mjs 同一條判準 g.canTurn）──
  // 進站段與出站段是分開求的，各自順向不代表在停車節點能接上（2026-09-14 第一版在玉里造出 4 處要倒車轉進道岔另一支的接法）。
  const turnOK = (pa, pb) => { const a = paths[pa], b = paths[pb]; if (!a || !b || a.to !== b.from) return false; return g.canTurn(a.nodeIds.at(-2), a.to, b.nodeIds[1], g.edges.get(a.edgeIds.at(-1)), g.edges.get(b.edgeIds[0])); };

  // ── 站的候選停車節點：整份派車表曾經派過該站的節點（不憑空造月台） ──
  const nodesOf = new Map();
  const addNode = (st, n) => (nodesOf.get(st) || nodesOf.set(st, new Set()).get(st)).add(n);
  for (const [, plan] of plans) { const sig = sigOf(plan); if (sig.length !== plan.pathIds.length + 1) continue;
    for (let i = 0; i < plan.pathIds.length; i++) { const p = paths[plan.pathIds[i]]; if (!p) continue; addNode(sig[i][0], p.from); addNode(sig[i + 1][0], p.to); } }

  return { g, paths, edges, ways, plans, sigOf, classify, wrongOn, cleanRoute, turnOK, register, newPaths, nodesOf, linkOf, dirOfEdge };
}
