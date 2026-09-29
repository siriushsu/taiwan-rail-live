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
import fs from 'node:fs';
import { restorePhysicalRoutes } from './restore_physical_routes.mjs';
import { makeParallelIndex, isTrack, segLen, normSta } from './parallel_tracks.mjs';

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

  // ── 方向種子（F17-S1，2026-09-14；docs/tra-overlap-rootcause-0914.md §9.9）──
  // 上面那條「乾淨方向股道」的判準，dom／minority 全部是從**現行派車表**統計出來的，於是自舉死結：
  // 派錯得夠嚴重的區間，統計上永遠不乾淨，F1 就永遠不會去修它。萬華–臺北隧道就是這一型——兩個方向
  // 都派在西正線 1551465831（n=346、minority 0.494），東正線 1551465832 與 F9 補入的橋接段零派車。
  // 種子的依據不是統計，是 **OSM 名稱（東正線／西正線）＋台鐵靠左行駛慣例**：縱貫線順行＝南下，
  // 靠左 ⇒ 東正線＝順行、西正線＝逆行。🔴 這個慣例**線別相依**（宜蘭線／北迴線順行＝北上，東西相反），
  // 而且七堵–八堵三線區段的「東正線」最近平行股是中股不是對向股，所以**不得照名稱自動擴充**——
  // 種子逐條指名寫在 scripts/fixtures/tra-direction-seeds-0914.json，含依據與節點序方向的算法。
  const SEEDS = JSON.parse(fs.readFileSync(new URL('../fixtures/tra-direction-seeds-0914.json', import.meta.url), 'utf8')).seeds;
  // 防止鎖反的硬檢查用：逐「站間」判台鐵方向（data/tra.json 該線 d 遞增＝順行，index.html:21652 的契約），
  // 統計種子 way 在**允許方向**那些車次段上走的節點序——多數必須等於種子方向。
  const seedAudit = (() => {
    const lines = JSON.parse(fs.readFileSync(new URL('../../data/tra.json', import.meta.url), 'utf8')).lines
      .map(L => new Map(L.stations.map(s => [normSta(s.name), s.d])));
    const traDir = (a, b) => { a = normSta(a); b = normSta(b); const m = lines.find(m => m.has(a) && m.has(b)); return m ? Math.sign(m.get(b) - m.get(a)) : 0; };
    const want = new Set(SEEDS.map(s => s.id)), audit = new Map(SEEDS.map(s => [s.id, { 順行: { 1: 0, '-1': 0 }, 逆行: { 1: 0, '-1': 0 } }]));
    // 拓樸連續性檢查要用的另一份統計：鏈上每條 way（種子＋錨＋via）不分台鐵方向的節點序次數。
    for (const s of SEEDS) { const ps = s.basis.propagationSource; if (ps) { want.add(ps.anchorWay); if (ps.via) want.add(ps.via); } }
    const chainUse = new Map([...want].map(id => [id, { 1: 0, '-1': 0 }]));
    for (const [, plan] of plans) {
      const sig = sigOf(plan); if (sig.length !== plan.pathIds.length + 1) continue;
      for (let i = 0; i < plan.pathIds.length; i++) {
        const p = paths[plan.pathIds[i]]; if (!p) continue;
        const d = traDir(sig[i][0].split(':')[1], sig[i + 1][0].split(':')[1]); if (!d) continue;
        const seen = new Set();
        for (let k = 0; k < p.edgeIds.length; k++) {
          const wid = edges[p.edgeIds[k]].wayId; if (!want.has(wid)) continue;
          const nd = dirOfEdge(p, k), key = wid + '|' + nd; if (seen.has(key)) continue; seen.add(key);
          chainUse.get(wid)[nd]++;
          if (audit.has(wid)) audit.get(wid)[d > 0 ? '順行' : '逆行'][nd]++;
        }
      }
    }
    return { audit, chainUse };
  })();

  // ── 拓樸連續性（零派車種子的防鎖反；上面那條統計檢查對它們是瞎的）──
  // 上面的 assert 靠「允許方向那些車次段」的統計，被 `if (n)` 守著：1551465832 與 F9 橋接段引入當下零派車
  //（n=0）⇒ 翻面在引入當下的派車表上不會紅。所以帶 propagationSource 的種子另外驗一件統計以外的事：
  // 錨 way 必須自己有派車且**只走一個節點序方向**，沿 sharedNodes 逐段推——前一條以它的方向走完會從共用
  // 節點出去，下一條以它的**種子方向**走起來就必須從同一個節點進。用節點序拓樸就夠，不必切線內積：
  // 方向鎖反時「入口」會變成 way 的另一端，一定對不上。
  const seedChains = (() => {
    const byId = new Map(SEEDS.map(s => [s.id, s])), nodesOf = new Map(ways.map(w => [String(w.id), w.nodes]));
    const walk = (id, d) => { const ns = nodesOf.get(id); assert(ns && ns.length > 1, `方向種子傳播鏈：路網裡找不到 way ${id}（或它只有一個節點）`); return d > 0 ? ns : [...ns].reverse(); };
    return SEEDS.filter(s => s.basis.propagationSource).map(s => {
      const ps = s.basis.propagationSource, u = seedAudit.chainUse.get(ps.anchorWay) || { 1: 0, '-1': 0 }, dirs = [1, -1].filter(d => u[d] > 0);
      assert.equal(dirs.length, 1, `方向種子 ${s.id}（${s.name}）的錨 way ${ps.anchorWay} 不合格：錨必須自己有派車、而且只走一個節點序方向（+1:${u[1]}／−1:${u['-1']}）`);
      const chain = [ps.anchorWay, ...(ps.via ? [ps.via] : []), s.id];
      const dd = chain.map((id, i) => i === 0 ? dirs[0] : byId.get(id) && byId.get(id).nodeDir);
      dd.forEach((d, i) => assert([1, -1].includes(d), `方向種子 ${s.id} 的傳播鏈第 ${i + 1} 條 ${chain[i]} 沒有種子方向（propagationSource.via 必須自己也是 fixture 裡的種子）`));
      assert.equal(ps.sharedNodes.length, chain.length - 1, `方向種子 ${s.id}：sharedNodes 要 ${chain.length - 1} 個（鏈上每個接點一個），fixture 給了 ${ps.sharedNodes.length} 個`);
      for (let i = 0; i + 1 < chain.length; i++) {
        const exit = walk(chain[i], dd[i]).at(-1), entry = walk(chain[i + 1], dd[i + 1])[0], X = ps.sharedNodes[i];
        assert.equal(exit, X, `方向種子 ${s.id} 的傳播鏈斷了：${chain[i]} 以節點序 ${dd[i] > 0 ? '+1' : '−1'} 走完是從節點 ${exit} 出去，不是 fixture 宣告的共用節點 ${X}`);
        assert.equal(entry, X, `方向種子 ${s.id} 的傳播鏈斷了（多半是鎖反）：${chain[i + 1]} 以節點序 ${dd[i + 1] > 0 ? '+1' : '−1'} 走起來是從節點 ${entry} 進，不是上一條 ${chain[i]} 出去的節點 ${X}`);
      }
      return `${chain.join('→')}（錨 ${ps.anchorWay} 派車 ${u[1] + u['-1']} 段全走節點序 ${dirs[0] > 0 ? '+1' : '−1'}；接點 ${ps.sharedNodes.join('、')} 逐段連續）`;
    });
  })();
  // 種子 way 一律視為乾淨方向股道並鎖成種子方向（即使 minority > 0.2 或統計判它不乾淨）。
  function applySeeds(clean) {
    return SEEDS.map(s => {
      const a = seedAudit.audit.get(s.id), allow = a[s.allowedTraDirection], n = allow['1'] + allow['-1'];
      if (n) assert.equal(allow['1'] >= allow['-1'] ? 1 : -1, s.nodeDir,
        `方向種子 ${s.id}（${s.name}）可能鎖反：允許方向「${s.allowedTraDirection}」的 ${n} 段車次，節點序多數不是 ${s.nodeDir}（+1:${allow['1']}／−1:${allow['-1']}）`);
      const was = clean.get(s.id); clean.set(s.id, s.nodeDir);
      return `${s.id}「${s.name}」允許${s.allowedTraDirection}＝節點序${s.nodeDir > 0 ? '+1' : '−1'}`
        + `（該向派車 ${n} 段、反向 ${a[s.allowedTraDirection === '順行' ? '逆行' : '順行']['1'] + a[s.allowedTraDirection === '順行' ? '逆行' : '順行']['-1']} 段；`
        + (was === undefined ? '統計未判乾淨' : was === s.nodeDir ? '與統計一致' : '覆蓋統計 ' + was) + '）';
    });
  }

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
    const statClean = clean.size, seeds = applySeeds(clean);
    console.log(`方向種子（名稱＋靠左行駛）：${seeds.join('；')} ⇒ 乾淨方向股道 ${statClean} → ${clean.size} 條`);
    if (seedChains.length) console.log(`方向種子傳播鏈（拓樸連續性，零派車種子靠這道）：${seedChains.join('；')}`);
    return { rows, clean, statClean, seeds };
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
