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
export function createStationConflictModel({ net, dispatch, sched, timed, protectedPlanKeys, report, stats, roster = 'f2', base = null, extraDays = [] }) {
  const F2B = roster === 'f2b';
  const M = makeDirectionModel({ net, dispatch });
  const { g, paths, sigOf, classify, wrongOn, cleanRoute, turnOK, newPaths, nodesOf } = M;
  // F2B 帶 base 時，方向股道、站間長度上限、候選節點、非電化允許清單都從 base 算：F2b 重跑自己的輸出、閘門驗 F2b 的輸出，
  // 用的都是第一次修時那把尺。F2 不帶 base，行為不變。
  const baseModel = F2B && base ? makeDirectionModel({ net: base.net, dispatch: base.dispatch }) : null;
  const { clean } = (baseModel || M).classify(); const memo = new Map();
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
  for (const [, plan] of Object.entries(baseModel ? base.dispatch.plans : plans)) {
    if (!plan.stopSignature) continue;
    const sig = JSON.parse(plan.stopSignature);
    plan.pathIds.forEach((pid, i) => {
      const p = (baseModel ? baseModel.paths : paths)[pid]; if (!p || !sig[i + 1]) return;
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
  // roster='f2' 是 F2 的原行為（抽 lib 時逐 byte 驗收過，不要改這條路）。roster='f2b' 多做四件事：
  //   1. 綁定先拿掉派車表沒有的中途站（平鎮）再綁（plan-binding.js 回傳 stops／stopIndexes）。名冊站序用綁定實際用的那一份，
  //      否則經過平鎮的車次站數對不上，整班被略過。
  //   2. 同一個車次鍵的其他日子（含 extraDays 的考卷日）依站名對齊到名冊站序；對不上、或當日綁到不同股道的記進 rosterStats.misaligned。
  //   3. 沿用自己計畫的改點車次（retimed、sourceKey 是自己）與自己的計畫共用陣列：換股時原地改 pathIds，不重寫 stopSignature。
  //   4. 中途站停不停看當天的班表（cells 那段）。
  const bind = createPlanBinding(dispatch), days = Object.keys(sched.dates).sort();
  const sources = [...days.map(day => ({ day, S: sched, T: timed })), ...(F2B ? extraDays.map(x => ({ day: x.day, S: x.sched, T: x.timed })) : [])];
  const current = new Map(), borrowed = new Set(), trainOf = new Map(), daysOf = new Map(), coords = new Map();
  const protectedScheduleKeys = new Set();
  const carName = new Map();
  const rosterStats = { keys: 0, borrowed: 0, unbound: 0, skippedLength: 0, subsetBound: 0, misaligned: [], unlinked: 0 };
  const unboundKeys = new Set(), skippedKeys = new Set();   // unbound／skippedLength 數的是車次鍵，不是每天出現的次數
  const dayIdx = new Map();   // F2B：`${day}#${ix}` → 名冊第 j 站在當日班表的索引
  const baseBind = baseModel ? createPlanBinding(base.dispatch) : null, baseIds = new Map();
  function alignDay(key, day, ix, tr) {
    const rec = trainOf.get(key), idx = []; let j = 0;
    tr.stops.forEach((s, i) => { if (j < rec.names.length && stationKey(SYS, s.name) === rec.names[j]) { idx.push(i); j++; } });
    const ids = bind(tr)?.plan?.pathIds, live = current.get(key);
    const why = idx.length !== rec.names.length || idx[0] !== 0 || idx.at(-1) !== tr.stops.length - 1 ? '站序對不上'
      : !ids || ids.length !== live.length || ids.some((p, k) => p !== live[k]) ? '當日綁到不同股道' : null;
    if (why) rosterStats.misaligned.push({ key, day, why }); else dayIdx.set(day + '#' + ix, idx);
  }
  for (const { day, S } of sources) for (const ix of S.dates[day]) {
    const t = S.trains[ix], no = String(t.train);
    if (!carName.has(no)) carName.set(no, t.carName);
    const tr = { sys: SYS, system: SYS, train: no, stops: t.stops.map(s => ({ name: s.name, arrSec: s.arrSec, depSec: s.depSec, stop: s.stop })) };
    const key = physicalTrainKey(tr);
    (daysOf.get(key) || daysOf.set(key, []).get(key)).push(day);
    if (trainOf.has(key)) { if (F2B) alignDay(key, day, ix, tr); continue; }
    const b = bind(tr), bStops = F2B && b?.stopIndexes ? b.stops : tr.stops;
    if (!b?.plan) { unboundKeys.add(key); rosterStats.unbound = unboundKeys.size; continue; }
    if (b.plan.pathIds.length !== bStops.length - 1) { skippedKeys.add(key); rosterStats.skippedLength = skippedKeys.size; continue; }
    if (F2B && b.stopIndexes) rosterStats.subsetBound++;
    // exact／derived 直接以自己的 key 為來源；retimed／route-template 則保護 binder 實際沿用的
    // source plan。不用 bare trainNo，避免未來同號但站序／停靠型態不同的另一份計畫被過度保護。
    const protectedSourceKey = b.sourceKey
      || (b.basis === 'exact' || b.basis === 'derived-pass-times' ? key : null);
    if (protectedSourceKey && protectedPlanKeys.has(protectedSourceKey)) protectedScheduleKeys.add(key);
    const rtr = bStops === tr.stops ? tr : { ...tr, stops: bStops }, idx = F2B && b.stopIndexes ? b.stopIndexes : null;
    const names = rtr.stops.map(s => stationKey(SYS, s.name));
    names.forEach((n, i) => { const s0 = t.stops[idx ? idx[i] : i]; if (!coords.has(n) && Number.isFinite(s0.lat)) coords.set(n, { lat: s0.lat, lon: s0.lon }); });
    trainOf.set(key, { key, no, tr: rtr, stops: rtr.stops, names, basis: b.basis, sourceKey: b.sourceKey ?? null });
    if (F2B) dayIdx.set(day + '#' + ix, idx || names.map((_, i) => i));
    const ownRetimed = F2B && b.basis === 'retimed' && b.sourceKey === key && !!plans[key];
    if (plans[key] && (b.plan === plans[key] || ownRetimed)) current.set(key, plans[key].pathIds);   // 自己的計畫：直接共用同一個陣列
    else { current.set(key, b.plan.pathIds.slice()); borrowed.add(key); }          // 借來的：改了才落成
    if (baseBind) { const bb = baseBind(tr); if (bb?.plan && bb.plan.pathIds.length === names.length - 1) baseIds.set(key, bb.plan.pathIds); }
  }
  rosterStats.keys = trainOf.size; rosterStats.borrowed = borrowed.size;
  console.log(`名冊：${trainOf.size} 個車次鍵（借路徑 ${borrowed.size}），${days.length} 天`);
  const initialNonElectric = new Map([...current].map(([key, ids]) => [key,
    new Set((baseIds.get(key) || ids).flatMap(pid => [...nonElectricWays(pid)]))]));

  // ── 候選停車節點 ───────────────────────────────────────────────────────────────────
  const poolCache = new Map();
  function poolOf(st) {
    if (poolCache.has(st)) return poolCache.get(st);
    const set = new Set([...(nodesOf.get(st) || []), ...(baseModel?.nodesOf.get(st) || [])]), c = coords.get(st), name = st.split(':')[1];
    for (const cand of g.stopCandidates(c ? { name, lat: c.lat, lon: c.lon } : name, SYS)) set.add(cand.nodeId);
    const pool = [...set]; poolCache.set(st, pool); return pool;
  }

  // ── 衝突模型 ───────────────────────────────────────────────────────────────────────
  const nodeAt = (ids, i) => (i < ids.length ? paths[ids[i]]?.from : paths[ids[i - 1]]?.to);
  const nodeSets = new Map(); const nodeSet = pid => nodeSets.get(pid) || nodeSets.set(pid, new Set(paths[pid]?.nodeIds || [])).get(pid);
  const isOfficial = (stops, i) => i === 0 || i === stops.length - 1 || stops[i].stop !== false;
  // cells[day] : station → {dwell:[{key,i,a,b}], pass:[{key,i,t,side,dwells}]}
  const cells = new Map();
  for (const { day, S, T } of sources) {
    const byStation = cells.get(day) || new Map(); cells.set(day, byStation);
    for (const ix of S.dates[day]) {
      const t = S.trains[ix], key = physicalTrainKey({ sys: SYS, train: String(t.train), stops: t.stops }), rec = trainOf.get(key); if (!rec) continue;
      const last = rec.stops.length - 1, tt = T.trains[ix];
      let at = null, official = i => isOfficial(rec.stops, i);
      if (F2B) { at = dayIdx.get(day + '#' + ix); if (!at) continue; official = i => i === 0 || i === last || t.stops[at[i]].stop !== false; }
      else assert.equal(tt.stops.length, rec.stops.length);
      rec.names.forEach((name, i) => {
        const s = tt.stops[at ? at[i] : i];
        const cell = byStation.get(name) || byStation.set(name, { dwell: [], pass: [] }).get(name), dwells = official(i);
        if (dwells) cell.dwell.push({ key, i, a: s.arrSec, b: s.depSec });
        if (i > 0) cell.pass.push({ key, i, t: s.arrSec, side: 'in', dwells });
        if (i < last) cell.pass.push({ key, i, t: s.depSec, side: 'out', dwells });
      });
    }
  }
  function cellConflicts(cell, override) {
    const idsOf = key => (override instanceof Map ? (override.get(key) || current.get(key)) : override && override.key === key ? override.ids : current.get(key));
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
  // 落成的計畫要與執行期 borrow()（rail-3d/physical/plan-binding.js）借出來的一致：沿用自己的計畫（retimed）時，
  // 來源若標了 templateEligible:false（不可借給別班當模板，藍皮的非電化月台靠它守），落成後也要帶著，
  // 否則落成之後別班的綁定會把這份計畫當模板借走。route-template 借的來源本來就不會有這個標記，borrow() 也不帶。
  function materialize(key) {
    const t = trainOf.get(key), ids = current.get(key).slice(), holds = t.stops.map(() => ({ arrival: 0, departure: 0 }));
    const noTemplate = t.basis === 'retimed' && plans[t.sourceKey]?.templateEligible === false;
    plans[key] = { pathIds: ids, departureHolds: holds.map(() => 0), officialDelaySec: 0, holds, stopSignature: physicalStopSignature(t.tr), lengthM: lenOf(t.no) ?? 240,
      ...(noTemplate && { templateEligible: false }) };
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
  // 借用者索引（F2b 用）：一份自己的計畫換股時，執行期綁到它切片的車次會跟著換（plan-binding 的 retimed／route-template 每次綁定都重切），
  // 但名冊裡借用者拿的是副本。這張索引讓修復器把來源的改動一起套到借用者身上；o＝切片在來源裡的起點。
  // 連不回來源的借用者都記進 rosterStats.unlinked（沒有來源鍵、來源計畫不在派車表、切片在來源裡找不到），
  // 否則來源換股時它不會跟著換、模型與執行期各說各話。src === key（自己借自己）不是連不回來源，略過不計。
  let borrowerIndex = null;
  function buildBorrowerIndex() {
    borrowerIndex = new Map(); rosterStats.unlinked = 0;
    for (const key of borrowed) {
      const rec = trainOf.get(key), src = rec.sourceKey; if (src === key) continue;
      if (!src || !plans[src]) { rosterStats.unlinked++; continue; }
      const ids = current.get(key), sIds = plans[src].pathIds, sNames = JSON.parse(plans[src].stopSignature).map(x => x[0]);
      let o = -1;
      for (let k = 0; k + ids.length <= sIds.length && o < 0; k++)
        if (ids.every((p, j) => p === sIds[k + j]) && rec.names.every((n, j) => n === sNames[k + j])) o = k;
      if (o < 0) { rosterStats.unlinked++; continue; }
      (borrowerIndex.get(src) || borrowerIndex.set(src, []).get(src)).push({ key, o, n: ids.length });
    }
    return borrowerIndex;
  }
  const borrowersOf = src => ((borrowerIndex || buildBorrowerIndex()).get(src) || []).filter(b => borrowed.has(b.key));
  return { M, g, paths, plans, clean, memo, newPaths, cleanRoute, turnOK, nodesOf, wrongSegments, wrongBefore,
    basePairMax, nonElectricWays, bind, days, current, borrowed, trainOf, daysOf, coords, protectedScheduleKeys, carName,
    initialNonElectric, poolOf, nodeAt, nodeSet, isOfficial, cells, cellConflicts, allConflicts, tally, dedup,
    lenOf, materialize, localCells, tryMove, rosterStats, sources, baseModel, buildBorrowerIndex, borrowersOf };
}
