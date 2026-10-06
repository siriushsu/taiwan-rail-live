// 台鐵站內停車節點的衝突模型（F2 與 F2b 共用）：逐日名冊、cells、B／C 衝突、單班搬節點（tryMove）。
// 由 scripts/repair_physical_stations.mjs（F2）原樣抽出，判準的來由寫在該檔檔頭；兩支共用這一份，模型才不會各自漂移。
// 抽出時的驗收：對同一份輸入跑 F2，產物 report.json、dispatch.json、network.json 逐 byte 不變。
import assert from 'node:assert/strict';
import { makeDirectionModel } from './track_directions.mjs';
import { createPlanBinding, physicalTrainKey, physicalStopSignature } from '../../rail-3d/physical/plan-binding.js';
import { stationKey } from '../../rail-3d/physical/timing.js';
import { formationFor } from '../../rail-3d/integration/formations.js';

export const SYS = 'tra_sched', PASS_MARGIN = 60, MAX_PAIR_STRETCH = 1.05;

// report／stats 由呼叫端建立後傳入：F2 的 report.json 欄位與順序由 F2 決定，模型只累加（materialize、tryMove）。
export function createStationConflictModel({ net, dispatch, sched, timed, protectedPlanKeys, report, stats }) {
  const M = makeDirectionModel({ net, dispatch });
  const { g, paths, sigOf, classify, wrongOn, cleanRoute, turnOK, newPaths, nodesOf } = M;
  const { clean } = classify(); const memo = new Map();
  const plans = dispatch.plans;
  const wrongSegments = () => Object.entries(plans).filter(([k]) => k.startsWith(SYS + ':')).reduce((n, [, p]) => n + p.pathIds.filter(pid => paths[pid] && wrongOn(paths[pid], clean).length).length, 0);
  const wrongBefore = wrongSegments();

  // F2 只修站內指派，不得順手改變整段站間的里程尺度，也不得把原本沒走非電化股道的車搬進去：
  // * tra_track_sections.maxPathM 取同一站對最長的派車路徑，單一候選若突然拉長很多，會讓所有同站對列車
  //   的跑段剖面一起變長。汐科曾因此把 967m 拉到 1254m，模型衝突雖少，完整重放反而多一筆互穿。
  // * 太麻里藍皮月台是非電化專用；只看「有沒有路」會把一般列車也搬進去，具名回歸會抓到。
  // 站間容許 5% 幾何差異（供月台股道繞行），非電化則採「不新增 way」的保守規則：本來就在柴油支線
  // 上的車仍可沿原有非電化 way 改道，但不能因這次站內修復新踏入另一條非電化股道。
  const basePairMax = new Map();
  for (const [, plan] of Object.entries(plans)) {
    if (!plan.stopSignature) continue;
    const sig = JSON.parse(plan.stopSignature);
    plan.pathIds.forEach((pid, i) => {
      const p = paths[pid]; if (!p || !sig[i + 1]) return;
      const key = sig[i][0] + '>' + sig[i + 1][0];
      basePairMax.set(key, Math.max(basePairMax.get(key) || 0, p.lengthM));
    });
  }
  const wayById = new Map(net.ways.map(w => [String(w.id), w]));
  const nonElectricCache = new Map();
  function nonElectricWays(pid) {
    if (nonElectricCache.has(pid)) return nonElectricCache.get(pid);
    const out = new Set((paths[pid]?.edgeIds || []).map(eid => String(g.edges.get(eid)?.wayId))
      .filter(wid => wayById.get(wid)?.tags?.electrified === 'no'));
    nonElectricCache.set(pid, out); return out;
  }

  // ── 逐日名冊 ─────────────────────────────────────────────────────────────────────
  const bind = createPlanBinding(dispatch), days = Object.keys(sched.dates).sort();
  const current = new Map(), borrowed = new Set(), trainOf = new Map(), daysOf = new Map(), coords = new Map();
  const protectedScheduleKeys = new Set();
  const carName = new Map();
  for (const day of days) for (const ix of sched.dates[day]) {
    const t = sched.trains[ix], no = String(t.train);
    if (!carName.has(no)) carName.set(no, t.carName);
    const tr = { sys: SYS, system: SYS, train: no, stops: t.stops.map(s => ({ name: s.name, arrSec: s.arrSec, depSec: s.depSec, stop: s.stop })) };
    const key = physicalTrainKey(tr);
    (daysOf.get(key) || daysOf.set(key, []).get(key)).push(day);
    if (trainOf.has(key)) continue;
    const b = bind(tr); if (!b?.plan || b.plan.pathIds.length !== tr.stops.length - 1) continue;
    // exact／derived 直接以自己的 key 為來源；retimed／route-template 則保護 binder 實際沿用的
    // source plan。不用 bare trainNo，避免未來同號但站序／停靠型態不同的另一份計畫被過度保護。
    const protectedSourceKey = b.sourceKey
      || (b.basis === 'exact' || b.basis === 'derived-pass-times' ? key : null);
    if (protectedSourceKey && protectedPlanKeys.has(protectedSourceKey)) protectedScheduleKeys.add(key);
    const names = tr.stops.map(s => stationKey(SYS, s.name));
    names.forEach((n, i) => { if (!coords.has(n) && Number.isFinite(t.stops[i].lat)) coords.set(n, { lat: t.stops[i].lat, lon: t.stops[i].lon }); });
    trainOf.set(key, { key, no, tr, stops: tr.stops, names, basis: b.basis });
    if (plans[key] && b.plan === plans[key]) current.set(key, plans[key].pathIds);   // 自己的計畫：直接共用同一個陣列
    else { current.set(key, b.plan.pathIds.slice()); borrowed.add(key); }          // 借來的：改了才落成
  }
  console.log(`名冊：${trainOf.size} 個車次鍵（借路徑 ${borrowed.size}），${days.length} 天`);
  const initialNonElectric = new Map([...current].map(([key, ids]) => [key,
    new Set(ids.flatMap(pid => [...nonElectricWays(pid)]))]));

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
    // 時窗含端點：起點站／終點站的官方停靠是 a===b 的零長時窗（發車那一刻在起點、到達那一刻在終點），
    // 用「嚴格相交」它永遠撞不到任何人，F2 就會把別班搬到它正要發車的節點上（2026-09-14 F6 把枋寮側線接回正線後，
    // 3001 被搬到 3054 06:25 發車的節點，4 秒全日掃描多出 3001/3054 同節點事件）。算繪端那一刻兩班車身確實同在該節點。
    for (let i = 0; i < dw.length; i++) for (let j = i + 1; j < dw.length; j++)
      if (dw[i].key !== dw[j].key && dw[i].node === dw[j].node && Math.min(dw[i].b, dw[j].b) >= Math.max(dw[i].a, dw[j].a)) out.push({ type: 'B', x: dw[i], y: dw[j] });
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
    const allowedNonElectric = initialNonElectric.get(key) || new Set();
    let best = null, routable = 0, turnBlocked = 0, electricBlocked = 0, stretchBlocked = 0;
    for (const m of options) {
      const inR = i > 0 ? cleanRoute(prev, m, paths[ids[i - 1]].lengthM, clean, memo) : null, outR = i < last ? cleanRoute(m, next, paths[ids[i]].lengthM, clean, memo) : null;
      if ((i > 0 && !inR) || (i < last && !outR)) continue;
      const introduced = [inR?.id, outR?.id].filter(pid => pid !== undefined && pid !== null)
        .some(pid => [...nonElectricWays(pid)].some(wid => !allowedNonElectric.has(wid)));
      if (introduced) { electricBlocked++; continue; }
      const inLimit = i > 0 ? (basePairMax.get(t.names[i - 1] + '>' + st) || paths[ids[i - 1]].lengthM) * MAX_PAIR_STRETCH : Infinity;
      const outLimit = i < last ? (basePairMax.get(st + '>' + t.names[i + 1]) || paths[ids[i]].lengthM) * MAX_PAIR_STRETCH : Infinity;
      if ((inR && inR.lengthM > inLimit + 1e-6) || (outR && outR.lengthM > outLimit + 1e-6)) { stretchBlocked++; continue; }
      const ids2 = ids.slice(); if (i > 0) ids2[i - 1] = inR.id; if (i < last) ids2[i] = outR.id;
      // 三個接點：前一站（舊進站段→新進站段）、本站（新進站段→新出站段）、下一站（新出站段→舊出站段）
      if ((i > 1 && !turnOK(ids2[i - 2], ids2[i - 1])) || (i > 0 && i < last && !turnOK(ids2[i - 1], ids2[i])) || (i + 1 < last && !turnOK(ids2[i], ids2[i + 1]))) { turnBlocked++; continue; }
      routable++;
      const after = local.reduce((n, c) => n + cellConflicts(c, { key, ids: ids2 }).length, 0), lengthM = (inR?.lengthM || 0) + (outR?.lengthM || 0);
      if (after < before && (!best || after < best.after || (after === best.after && lengthM < best.lengthM))) best = { m, ids2, after, lengthM };
    }
    if (!routable) {
      const reason = electricBlocked ? '引入新非電化股道' : stretchBlocked ? '拉長站間超過基線' : turnBlocked ? '道岔接不上' : '無順向路徑';
      stats[reason]++; report.unfixed.push({ key, i, station: st, reason }); return false;
    }
    if (!best) { stats.換了不會更好++; report.unfixed.push({ key, i, station: st, reason: '換了不會更好' }); return false; }
    if (borrowed.has(key)) materialize(key);
    const live = current.get(key); live.length = 0; live.push(...best.ids2);
    stats.修好++; report.moves.push({ key, i, station: st, from: cur, to: best.m, before, after: best.after });
    const name = st.split(':')[1]; report.movesByStation[name] = (report.movesByStation[name] || 0) + 1;
    return true;
  }
  return { M, g, paths, plans, clean, memo, newPaths, cleanRoute, turnOK, nodesOf, wrongSegments, wrongBefore,
    basePairMax, nonElectricWays, bind, days, current, borrowed, trainOf, daysOf, coords, protectedScheduleKeys, carName,
    initialNonElectric, poolOf, nodeAt, nodeSet, isOfficial, cells, cellConflicts, allConflicts, tally, dedup,
    lenOf, materialize, localCells, tryMove };
}
