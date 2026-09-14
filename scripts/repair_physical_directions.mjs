// 台鐵派路的方向規則修復（F1）：雙線區間靠左行駛，逆向佔用另一股的路徑段改走正確的那一股。
//
// 為什麼要有這支（docs/tra-overlap-rootcause-0914.md 的 R1）：
//   派車的路徑產生器（build_physical_routes.mjs）只求最短路徑，再從中點擋一條邊求一條替代路徑，
//   兩條都「不知道方向」；CP-SAT 只解佔用不重疊，preference 不進目標。結果 2026-09-13 用 4 秒
//   掃全日，對向互穿 226 場旁邊都有一條平行股道——兩班車被派在同一股對開，另一股空著。
//
// 做法（方向模型在 scripts/lib/track_directions.mjs）：
//   1. 從現行派車表統計每條正線 way 的行駛方向，用幾何找它最近的平行股道在多數方向的左側或右側；
//      台鐵靠左行駛 ⇒ 正確行駛時另一股在右側。合乎這條、且平行股道也合乎的，就是「乾淨的方向股道」。
//      另外有一組**指名的方向種子**（scripts/fixtures/tra-direction-seeds-0914.json，F17-S1）：統計是從
//      現行派車表來的，派錯得夠嚴重的區間永遠不會判乾淨（萬華–臺北隧道兩向都派在西正線），所以那幾條
//      改用 OSM 名稱（東正線／西正線）＋台鐵靠左行駛慣例直接鎖方向；判準與硬檢查在 lib/track_directions.mjs。
//   2. 每份 plan 逐站做動態規劃：每站的候選停車節點 = 整份派車表曾經派過該站的節點（不憑空造月台，
//      與 repair_physical_platforms.mjs 同一條紀律）；相鄰兩站之間只准走「不逆向通過任何乾淨股道」
//      的路徑（先挑既有的順向路徑，沒有才用 edgeAllowed 重求最短路徑），而且進站段與出站段在停車節點
//      要接得上（道岔不得倒車，g.canTurn；動態規劃的狀態帶著進站段）。目標依序是：留下的逆向段
//      最少 → 換掉的停車節點最少 → 換掉的路徑最少。2026-09-14 第一版只准同起訖節點改道，729 段
//      只修得掉 28 段——561 段的病根是停車節點本身就派在對向那一股的月台，不換節點修不了。
//   3. 修完重算方向統計再跑一輪（有些股道原本被逆向車拉成「混用」，清掉之後才夠乾淨），最多 3 輪。
//
// 不做的事：不加 hold、不動 yard／spur、不縮車身、不動任何時刻、不改 stopSignature（換節點不影響綁定）。
// 換了節點之後同月台／待避的衝突會浮出來（2026-09-13 實測 B 28→48、C 291→350 場），那是 F2
// scripts/repair_physical_stations.mjs 的事，兩支要接著跑。
//
// 產物：OUT_DIR（預設 output/directions/）底下的 network.json、dispatch.json、report.json。
// 覆蓋進 rail-3d/physical/ 之後必跑：node scripts/build_rail_levels.mjs（level-profiles 的 inputSha256
// 含 network.json）、node scripts/build_tra_track_sections.mjs（區間表沿 walk 量）、再跑出貨閘門。
// 🔴 重抓班表（npm run fetch-schedule）後新落成的計畫會回到舊派法，要重跑這支。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeDirectionModel } from './lib/track_directions.mjs';

const OUT_DIR = process.env.OUT_DIR || 'output/directions';
const ROUNDS = 3, WRONG_COST = 1000, NODE_COST = 1, PATH_COST = 0.01;
const net = JSON.parse(fs.readFileSync(process.env.NETWORK || 'rail-3d/physical/network.json', 'utf8'));
const dispatch = JSON.parse(fs.readFileSync(process.env.DISPATCH || 'rail-3d/physical/dispatch.json', 'utf8'));
const before = structuredClone(dispatch.plans);
const M = makeDirectionModel({ net, dispatch });
const { paths, plans, sigOf, classify, wrongOn, cleanRoute, turnOK, newPaths, nodesOf } = M;

// ── 每份計畫的動態規劃：逐站選節點與路徑，代價 = 留下的逆向段 ×1000 ＋ 換節點 ×1 ＋ 換路徑 ×0.01 ──
function solvePlan(plan, clean, memo) {
  const sig = sigOf(plan), n = plan.pathIds.length; if (sig.length !== n + 1 || plan.pathIds.some(pid => !paths[pid])) return null;
  const cur = plan.pathIds.map(pid => paths[pid].from); cur.push(paths[plan.pathIds[n - 1]].to);
  const wrongSeg = plan.pathIds.map(pid => wrongOn(paths[pid], clean).length > 0);
  if (!wrongSeg.some(Boolean)) return null;
  const cand = sig.map((s, k) => { const set = new Set(nodesOf.get(s[0]) || []); set.add(cur[k]); return [...set]; });
  // 狀態 = (停車節點, 進站那段)：出站段在該節點接不接得上（道岔不得倒車）取決於進站段，所以狀態要帶著它。
  const layers = [new Map(cand[0].map(c => [c + '|', { node: c, pathId: null, cost: c === cur[0] ? 0 : NODE_COST, prev: null }]))];
  for (let k = 1; k <= n; k++) {
    const layer = new Map(), refLen = paths[plan.pathIds[k - 1]].lengthM;
    for (const b of cand[k]) for (const [pk, ent] of layers[k - 1]) {
      const a = ent.node, options = [];
      if (a === cur[k - 1] && b === cur[k]) options.push([plan.pathIds[k - 1], wrongSeg[k - 1] ? WRONG_COST : 0]);
      if (!options.length || options[0][1] > 0) { const r = cleanRoute(a, b, refLen, clean, memo); if (r && r.id !== options[0]?.[0]) options.push([r.id, PATH_COST]); }
      for (const [pathId, cost] of options) {
        if (ent.pathId !== null && !turnOK(ent.pathId, pathId)) continue;
        const total = ent.cost + cost + (b === cur[k] ? 0 : NODE_COST), key = b + '|' + pathId, old = layer.get(key);
        if (!old || total < old.cost) layer.set(key, { node: b, pathId, cost: total, prev: pk });
      }
    }
    layers.push(layer);
  }
  let end = null; for (const ent of layers[n].values()) if (!end || ent.cost < end.cost) end = ent;
  if (!end) return null;
  const pathIds = new Array(n), nodes = new Array(n + 1); let ent = end;
  for (let k = n; k >= 1; k--) { nodes[k] = ent.node; pathIds[k - 1] = ent.pathId; ent = layers[k - 1].get(ent.prev); }
  nodes[0] = ent.node;
  const wrongAfter = pathIds.filter(pid => wrongOn(paths[pid], clean).length).length;
  return { pathIds, nodes, cur, sig, nodeChanges: nodes.filter((v, k) => v !== cur[k]).length, pathChanges: pathIds.filter((pid, k) => pid !== plan.pathIds[k]).length, wrongBefore: wrongSeg.filter(Boolean).length, wrongAfter };
}

// 診斷用：同一節點上兩份計畫的正式停站時窗相交（不分日，只當前後對照的相對量；逐日的正式數字歸 verify_physical_no_overlap）
function nodeOverlaps() {
  const at = new Map();
  for (const [key, plan] of plans) { const sig = sigOf(plan); if (sig.length !== plan.pathIds.length + 1) continue;
    for (let i = 0; i < sig.length; i++) { const [, arr, dep] = sig[i]; if (i && i < sig.length - 1 && arr === dep) continue;
      const node = i < plan.pathIds.length ? paths[plan.pathIds[i]]?.from : paths[plan.pathIds[i - 1]]?.to; if (!node) continue;
      (at.get(node) || at.set(node, []).get(node)).push({ key, a: arr, b: dep }); } }
  let n = 0; for (const list of at.values()) { list.sort((x, y) => x.a - y.a); for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].a < list[i].b; j++) if (list[j].key !== list[i].key) n++; }
  return n;
}

// ── 主迴圈 ────────────────────────────────────────────────────────────────────────────
const overlapsBefore = nodeOverlaps();
const report = { params: { ROUNDS, WRONG_COST, NODE_COST, PATH_COST }, rounds: [], changedPlans: {}, nodeChangesByStation: {}, remaining: [] };
let lastClean = null;
for (let round = 1; round <= ROUNDS; round++) {
  const { rows, clean } = classify(); lastClean = clean; const memo = new Map();
  let touched = 0, wrongBefore = 0, wrongAfter = 0, nodeChanges = 0, pathChanges = 0;
  for (const [key, plan] of plans) {
    const s = solvePlan(plan, clean, memo); if (!s) continue;
    wrongBefore += s.wrongBefore; wrongAfter += s.wrongAfter;
    if (s.wrongAfter >= s.wrongBefore && !s.pathChanges) continue;
    touched++; nodeChanges += s.nodeChanges; pathChanges += s.pathChanges;
    s.nodes.forEach((v, k) => { if (v !== s.cur[k]) { const st = s.sig[k][0].split(':')[1]; report.nodeChangesByStation[st] = (report.nodeChangesByStation[st] || 0) + 1; } });
    const rec = report.changedPlans[key] = report.changedPlans[key] || { nodeChanges: 0, pathChanges: 0, wrongBefore: s.wrongBefore, wrongAfter: s.wrongAfter };
    rec.nodeChanges += s.nodeChanges; rec.pathChanges += s.pathChanges; rec.wrongAfter = s.wrongAfter;
    plan.pathIds = s.pathIds;
  }
  report.rounds.push({ round, trackedWays: rows.size, cleanWays: clean.size, plansTouched: touched, wrongSegmentsBefore: wrongBefore, wrongSegmentsAfter: wrongAfter, nodeChanges, pathChanges });
  console.log(`第 ${round} 輪：方向股道 ${clean.size}／有派車正線 ${rows.size}，逆向段 ${wrongBefore} → ${wrongAfter}，動了 ${touched} 份計畫（換節點 ${nodeChanges}、換路徑 ${pathChanges}）`);
  if (!touched) break;
}
// 收尾自檢：站數不變、路徑首尾相接、每站節點都是該站曾派過的節點
for (const [key, plan] of plans) {
  const old = before[key].pathIds, sig = sigOf(plan);
  assert.equal(plan.pathIds.length, old.length, key + ' 段數變了');
  for (let i = 0; i < plan.pathIds.length; i++) {
    const p = paths[plan.pathIds[i]]; if (!p) { assert.equal(plan.pathIds[i], old[i]); continue; }
    if (i) assert.equal(paths[plan.pathIds[i - 1]].to, p.from, key + ' 第 ' + i + ' 段不相接');
    assert.ok(nodesOf.get(sig[i][0]).has(p.from), key + ' 第 ' + i + ' 站節點不是該站派過的節點');
    assert.ok(nodesOf.get(sig[i + 1][0]).has(p.to), key + ' 第 ' + (i + 1) + ' 站節點不是該站派過的節點');
    if (i) assert.ok(turnOK(plan.pathIds[i - 1], plan.pathIds[i]), key + ' 第 ' + i + ' 站進出段接不上（道岔不得倒車）');
  }
}
for (const [key, plan] of plans) { const sig = sigOf(plan);
  plan.pathIds.forEach((pid, i) => { const bad = paths[pid] && wrongOn(paths[pid], lastClean); if (bad?.length) report.remaining.push({ plan: key, i, from: sig[i][0].split(':')[1], to: sig[i + 1][0].split(':')[1], wrongWays: bad }); }); }
const remainingSeg = {}; for (const r of report.remaining) { const k = r.from + '→' + r.to; remainingSeg[k] = (remainingSeg[k] || 0) + 1; }
const overlapsAfter = nodeOverlaps();
console.log(`新落成路徑 ${Object.keys(newPaths).length}，改到 ${Object.keys(report.changedPlans).length} 份計畫；仍逆向的段 ${report.remaining.length}（${new Set(report.remaining.map(r => r.plan)).size} 份計畫）`);
console.log('仍逆向最多的站間：', Object.entries(remainingSeg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join('，'));
console.log('換節點最多的站：', Object.entries(report.nodeChangesByStation).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join('，'));
console.log(`同節點停站時窗相交（不分日、相對量）：${overlapsBefore} → ${overlapsAfter}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'network.json'), JSON.stringify({ ...net, paths: { ...net.paths, ...newPaths } }));
fs.writeFileSync(path.join(OUT_DIR, 'dispatch.json'), JSON.stringify(dispatch));
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ ...report, newPaths: Object.keys(newPaths).length, nodeOverlaps: { before: overlapsBefore, after: overlapsAfter } }, null, 1));
// 出貨前的最後一道：新檔要能被還原器逐邊對回拓樸（verify 系列吃的是同一個還原器）
makeDirectionModel({ net: JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'network.json'), 'utf8')), dispatch });
console.log('寫入', OUT_DIR);
