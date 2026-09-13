// 台鐵站內停車節點的指派修復（F2）：同月台同時停兩班（B）、通過車穿過停站車（C）。
//
// 為什麼要有這支（docs/tra-overlap-rootcause-0914.md 的 R2）：
//   CP-SAT 的派車把停站車放在正線、讓通過車從它身上穿過去，同站同時停四班卻只用三個節點。
//   F1（repair_physical_directions.mjs）把列車放回靠左的那一股之後，這些衝突反而全部浮出來
//  （2026-09-13 實測 B 28→48、C 291→350 場）：以前是靠「兩班各走一股、方向亂派」把它們藏起來的。
//   真實世界的解法就是待避：被超越的車停側線／待避線，通過車走正線；同向兩班同時停站就各用一股。
//
// 做法：
//   1. 逐日名冊（14 天，班表 data/tra_schedule_dense.json）：每班車綁到的 pathIds；借路徑的車要改就先落成自己的計畫。
//   2. 衝突模型只用停站時窗與路徑經過的節點，不用行車曲線：
//        B：同一天、同一節點、兩班正式停站時窗相交。
//        C：某班在節點 n 停站的時窗（前後各留 PASS_MARGIN 秒）內，另一班進站或出站那段路徑經過 n。
//      2026-09-13 全日 4 秒掃描的 365 場 C 事件，通過車的路徑 100% 經過停站車的節點，模型與閘門量到的一致。
//   3. 貪婪修：衝突最多的（車次, 站）先處理，試著把它搬到同站別的停車節點；候選節點 = 整份派車表曾派過
//      該站的節點 ∪ 路網裡該站的停車位置（OSM railway=stop 與建置時推估的停車點，含側線上的），
//      不憑空造月台。進出兩段路徑一律走方向模型的順向路徑（scripts/lib/track_directions.mjs），
//      而且前一站、本站、下一站三個接點都要接得上（道岔不得倒車，g.canTurn），
//      所以 F1 修好的方向不會被這支換回去（09-13 的 repair_physical_platforms.mjs 就是不看方向才會
//      把車搬到對向月台）。搬過去之後只認「該站與前後站的衝突總數變少」才算數。
//
// 不做的事：不加 hold、不動時刻、不縮車身、不改 stopSignature；修不掉的列出來（多半是路網沒畫待避線）。
//
// 產物：OUT_DIR（預設 output/stations/）底下的 network.json、dispatch.json、report.json。
// 順序：repair_physical_directions → repair_physical_stations → 覆蓋 rail-3d/physical/ → build_rail_levels
//       → build_tra_track_sections → 出貨閘門（verify_physical_no_overlap 等）。
// 🔴 重抓班表（npm run fetch-schedule）之後兩支都要重跑。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeDirectionModel } from './lib/track_directions.mjs';
import { createPlanBinding, physicalTrainKey, physicalStopSignature } from '../rail-3d/physical/plan-binding.js';
import { stationKey } from '../rail-3d/physical/timing.js';
import { formationFor } from '../rail-3d/integration/formations.js';
import { computeProfiles, readPassObs } from './build_run_profiles.mjs';

const SYS = 'tra_sched', OUT_DIR = process.env.OUT_DIR || 'output/stations';
const PASS_MARGIN = 60, ROUNDS = 12;
const net = JSON.parse(fs.readFileSync(process.env.NETWORK || 'rail-3d/physical/network.json', 'utf8'));
const dispatch = JSON.parse(fs.readFileSync(process.env.DISPATCH || 'rail-3d/physical/dispatch.json', 'utf8'));
const sched = JSON.parse(fs.readFileSync('data/tra_schedule_dense.json', 'utf8'));
// 通過站的時刻要用畫面真的會用的那一份：跑剖面＋交會／待避推論（F3）之後的時刻，不是班表密化的插值——
// 待避推論會刻意把通過車的時刻夾進被超越那班的停站窗裡，用插值時刻會漏掉正是要修的那些衝突。
// verify_run_profiles_match.mjs 保證這裡算出來的與畫面逐值相同。車次鍵與簽章仍用原始班表（綁定看的是那一份）。
const timed = structuredClone(sched);
computeProfiles({ indexPath: 'index.html', schedule: timed, track: JSON.parse(fs.readFileSync('data/tra.json', 'utf8')), passObs: readPassObs('data/tra_pass_obs.json') });
const M = makeDirectionModel({ net, dispatch });
const { g, paths, sigOf, classify, wrongOn, cleanRoute, turnOK, newPaths, nodesOf } = M;
const { clean } = classify(); const memo = new Map();
const plans = dispatch.plans;
const wrongSegments = () => Object.entries(plans).filter(([k]) => k.startsWith(SYS + ':')).reduce((n, [, p]) => n + p.pathIds.filter(pid => paths[pid] && wrongOn(paths[pid], clean).length).length, 0);
const wrongBefore = wrongSegments();

// ── 逐日名冊 ─────────────────────────────────────────────────────────────────────
const bind = createPlanBinding(dispatch), days = Object.keys(sched.dates).sort();
const current = new Map(), borrowed = new Set(), trainOf = new Map(), daysOf = new Map(), coords = new Map();
const carName = new Map();
for (const day of days) for (const ix of sched.dates[day]) {
  const t = sched.trains[ix], no = String(t.train);
  if (!carName.has(no)) carName.set(no, t.carName);
  const tr = { sys: SYS, system: SYS, train: no, stops: t.stops.map(s => ({ name: s.name, arrSec: s.arrSec, depSec: s.depSec, stop: s.stop })) };
  const key = physicalTrainKey(tr);
  (daysOf.get(key) || daysOf.set(key, []).get(key)).push(day);
  if (trainOf.has(key)) continue;
  const b = bind(tr); if (!b?.plan || b.plan.pathIds.length !== tr.stops.length - 1) continue;
  const names = tr.stops.map(s => stationKey(SYS, s.name));
  names.forEach((n, i) => { if (!coords.has(n) && Number.isFinite(t.stops[i].lat)) coords.set(n, { lat: t.stops[i].lat, lon: t.stops[i].lon }); });
  trainOf.set(key, { key, no, tr, stops: tr.stops, names, basis: b.basis });
  if (plans[key] && b.plan === plans[key]) current.set(key, plans[key].pathIds);   // 自己的計畫：直接共用同一個陣列
  else { current.set(key, b.plan.pathIds.slice()); borrowed.add(key); }          // 借來的：改了才落成
}
console.log(`名冊：${trainOf.size} 個車次鍵（借路徑 ${borrowed.size}），${days.length} 天`);

// ── 候選停車節點 ───────────────────────────────────────────────────────────────────
const poolCache = new Map();
function poolOf(st) {
  if (poolCache.has(st)) return poolCache.get(st);
  const set = new Set(nodesOf.get(st) || []), c = coords.get(st), name = st.split(':')[1];
  for (const cand of g.stopCandidates(c ? { name, lat: c.lat, lon: c.lon } : name, SYS)) set.add(cand.nodeId);
  const pool = [...set]; poolCache.set(st, pool); return pool;
}

// ── 衝突模型 ───────────────────────────────────────────────────────────────────────
const nodeAt = (ids, i) => (i < ids.length ? paths[ids[i]]?.from : paths[ids[i - 1]]?.to);
const nodeSets = new Map(); const nodeSet = pid => nodeSets.get(pid) || nodeSets.set(pid, new Set(paths[pid]?.nodeIds || [])).get(pid);
const isOfficial = (stops, i) => i === 0 || i === stops.length - 1 || stops[i].stop !== false;
// cells[day] : station → {dwell:[{key,i,a,b}], pass:[{key,i,t,side,dwells}]}
const cells = new Map();
for (const day of days) {
  const byStation = new Map(); cells.set(day, byStation);
  for (const ix of sched.dates[day]) {
    const t = sched.trains[ix], key = physicalTrainKey({ sys: SYS, train: String(t.train), stops: t.stops }), rec = trainOf.get(key); if (!rec) continue;
    const last = rec.stops.length - 1, tt = timed.trains[ix];
    assert.equal(tt.stops.length, rec.stops.length);
    tt.stops.forEach((s, i) => {
      const cell = byStation.get(rec.names[i]) || byStation.set(rec.names[i], { dwell: [], pass: [] }).get(rec.names[i]), dwells = isOfficial(rec.stops, i);
      if (dwells) cell.dwell.push({ key, i, a: s.arrSec, b: s.depSec });
      if (i > 0) cell.pass.push({ key, i, t: s.arrSec, side: 'in', dwells });
      if (i < last) cell.pass.push({ key, i, t: s.depSec, side: 'out', dwells });
    });
  }
}
function cellConflicts(cell, override) {
  const idsOf = key => (override && override.key === key ? override.ids : current.get(key));
  const dw = cell.dwell.map(d => ({ ...d, node: nodeAt(idsOf(d.key), d.i) })).filter(d => d.node), out = [];
  for (let i = 0; i < dw.length; i++) for (let j = i + 1; j < dw.length; j++)
    if (dw[i].key !== dw[j].key && dw[i].node === dw[j].node && Math.min(dw[i].b, dw[j].b) > Math.max(dw[i].a, dw[j].a)) out.push({ type: 'B', x: dw[i], y: dw[j] });
  for (const p of cell.pass) {
    const ids = idsOf(p.key), pid = p.side === 'in' ? ids[p.i - 1] : ids[p.i]; if (!paths[pid]) continue;
    const set = nodeSet(pid), own = nodeAt(ids, p.i);
    for (const d of dw) {
      if (d.key === p.key || (p.dwells && d.node === own)) continue;   // 同站同節點停站的那對算 B，不重複計 C
      if (set.has(d.node) && p.t >= d.a - PASS_MARGIN && p.t <= d.b + PASS_MARGIN) out.push({ type: 'C', x: d, y: { key: p.key, i: p.i } });
    }
  }
  return out;
}
function allConflicts() { const out = []; for (const [day, byStation] of cells) for (const [st, cell] of byStation) for (const c of cellConflicts(cell)) out.push({ ...c, day, st }); return out; }
const tally = list => ({ B: list.filter(c => c.type === 'B').length, C: list.filter(c => c.type === 'C').length });
const dedup = list => new Set(list.map(c => [c.x.key, c.y.key].sort().join('×') + '@' + c.st)).size;

// ── 搬節點 ────────────────────────────────────────────────────────────────────────
const lenOf = no => { const f = formationFor({ systemId: SYS, carName: carName.get(no) }, 'actual'); return f ? f.lengths.reduce((a, b) => a + b, 0) : null; };
function materialize(key) {
  const t = trainOf.get(key), ids = current.get(key).slice(), holds = t.stops.map(() => ({ arrival: 0, departure: 0 }));
  plans[key] = { pathIds: ids, departureHolds: holds.map(() => 0), officialDelaySec: 0, holds, stopSignature: physicalStopSignature(t.tr), lengthM: lenOf(t.no) ?? 240 };
  current.set(key, ids); borrowed.delete(key); report.materialised++;
}
const report = { params: { PASS_MARGIN, ROUNDS }, rounds: [], moves: [], movesByStation: {}, unfixed: [], materialised: 0 };
const stats = { 修好: 0, 無替代節點: 0, 無順向路徑: 0, 道岔接不上: 0, 換了不會更好: 0 };
function localCells(key, i) {
  const t = trainOf.get(key), out = [];
  for (const day of daysOf.get(key) || []) for (const k of [i - 1, i, i + 1]) { const cell = cells.get(day)?.get(t.names[k]); if (cell) out.push(cell); }
  return out;
}
function tryMove(key, i) {
  const t = trainOf.get(key), ids = current.get(key), last = t.stops.length - 1, cur = nodeAt(ids, i), st = t.names[i];
  const options = poolOf(st).filter(n => n !== cur);
  if (!options.length) { stats.無替代節點++; report.unfixed.push({ key, i, station: st, reason: '無替代節點' }); return false; }
  const prev = i > 0 ? paths[ids[i - 1]].from : null, next = i < last ? paths[ids[i]].to : null, local = localCells(key, i);
  const before = local.reduce((n, c) => n + cellConflicts(c).length, 0);
  let best = null, routable = 0, turnBlocked = 0;
  for (const m of options) {
    const inR = i > 0 ? cleanRoute(prev, m, paths[ids[i - 1]].lengthM, clean, memo) : null, outR = i < last ? cleanRoute(m, next, paths[ids[i]].lengthM, clean, memo) : null;
    if ((i > 0 && !inR) || (i < last && !outR)) continue;
    const ids2 = ids.slice(); if (i > 0) ids2[i - 1] = inR.id; if (i < last) ids2[i] = outR.id;
    // 三個接點：前一站（舊進站段→新進站段）、本站（新進站段→新出站段）、下一站（新出站段→舊出站段）
    if ((i > 1 && !turnOK(ids2[i - 2], ids2[i - 1])) || (i > 0 && i < last && !turnOK(ids2[i - 1], ids2[i])) || (i + 1 < last && !turnOK(ids2[i], ids2[i + 1]))) { turnBlocked++; continue; }
    routable++;
    const after = local.reduce((n, c) => n + cellConflicts(c, { key, ids: ids2 }).length, 0), lengthM = (inR?.lengthM || 0) + (outR?.lengthM || 0);
    if (after < before && (!best || after < best.after || (after === best.after && lengthM < best.lengthM))) best = { m, ids2, after, lengthM };
  }
  if (!routable) { const reason = turnBlocked ? '道岔接不上' : '無順向路徑'; stats[reason]++; report.unfixed.push({ key, i, station: st, reason }); return false; }
  if (!best) { stats.換了不會更好++; report.unfixed.push({ key, i, station: st, reason: '換了不會更好' }); return false; }
  if (borrowed.has(key)) materialize(key);
  const live = current.get(key); live.length = 0; live.push(...best.ids2);
  stats.修好++; report.moves.push({ key, i, station: st, from: cur, to: best.m, before, after: best.after });
  const name = st.split(':')[1]; report.movesByStation[name] = (report.movesByStation[name] || 0) + 1;
  return true;
}

// ── 主迴圈 ────────────────────────────────────────────────────────────────────────
let list = allConflicts(); const first = tally(list);
console.log(`修復前：B ${first.B}、C ${first.C}（14 天合計，去重 ${dedup(list)} 對）`);
for (let round = 1; round <= ROUNDS; round++) {
  const load = new Map();
  for (const c of list) for (const s of [c.x, c.y]) { const k = s.key + '@' + s.i; load.set(k, (load.get(k) || 0) + 1); }
  const order = [...load.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  report.unfixed = [];
  for (const k of order) { const at = k.lastIndexOf('@'); tryMove(k.slice(0, at), +k.slice(at + 1)); }
  const next = allConflicts(), t = tally(next);
  report.rounds.push({ round, before: tally(list), after: t, ...stats });
  console.log(`第 ${round} 輪：${list.length} → ${next.length}（B ${t.B}、C ${t.C}）${JSON.stringify(stats)}`);
  const done = next.length >= list.length; list = next; if (done) break;
}
const final = tally(list), wrongAfter = wrongSegments();
assert.ok(wrongAfter <= wrongBefore, `方向變差了 ${wrongBefore} → ${wrongAfter}`);
// 收尾自檢：改過的計畫仍首尾相接、段數正確
for (const [key, ids] of current) { const t = trainOf.get(key);
  assert.equal(ids.length, t.stops.length - 1, key + ' 段數不對');
  for (let i = 1; i < ids.length; i++) { assert.equal(paths[ids[i - 1]].to, paths[ids[i]].from, key + ' 第 ' + i + ' 段不相接'); assert.ok(turnOK(ids[i - 1], ids[i]), key + ' 第 ' + i + ' 站進出段接不上（道岔不得倒車）'); }
  if (plans[key]) assert.strictEqual(plans[key].pathIds, ids, key + ' 計畫與名冊脫鉤'); }
const unfixedBy = {}; for (const u of report.unfixed) { const k = u.station.split(':')[1] + '·' + u.reason; unfixedBy[k] = (unfixedBy[k] || 0) + 1; }
console.log(`修復後：B ${final.B}、C ${final.C}（去重 ${dedup(list)} 對）；搬了 ${report.moves.length} 次、新落成計畫 ${report.materialised}、新路徑 ${Object.keys(newPaths).length}；逆向段 ${wrongBefore} → ${wrongAfter}`);
console.log('搬最多的站：', Object.entries(report.movesByStation).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join('，'));
console.log('修不掉最多的：', Object.entries(unfixedBy).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join('，'));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'network.json'), JSON.stringify({ ...net, paths: { ...net.paths, ...newPaths } }));
fs.writeFileSync(path.join(OUT_DIR, 'dispatch.json'), JSON.stringify(dispatch));
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ ...report, conflicts: { before: first, after: final }, wrongSegments: { before: wrongBefore, after: wrongAfter }, newPaths: Object.keys(newPaths).length, unfixedByStation: unfixedBy }, null, 1));
makeDirectionModel({ net: JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'network.json'), 'utf8')), dispatch });
console.log('寫入', OUT_DIR);
