// 台鐵待避股道的共用判準（修復器 repair_tra_overtake_tracks.mjs 與閘門 verify_tra_overtake_tracks.mjs 同一份）。
// 規格：docs/specs/2026-10-06-tra-overtake-main-siding.md。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeProfiles } from '../build_run_profiles.mjs';
import { MAX_PAIR_STRETCH } from './tra_station_conflicts.mjs';
import { sectionKey, normSta } from './parallel_tracks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 基準：站間長度上限、方向股道、候選節點、非電化允許清單、單雙線表都從這顆的出貨檔算，重跑自己的輸出時判準不漂移。
export const BASE_REF = '0a435fcf';
// 硬閘門釘的班表快照（14 天窗 2026-10-02～10-15）；通過時刻 tra_pass_obs.json 取同一顆。換窗不會讓閘門變紅，滾動窗另出報告。
export const SCHEDULE_REF = '882523ceb43991d0acf7749de81b427e0ccf0db5';
// 9/13 考卷：與 verify_physical_no_overlap.mjs 的 FIXTURE_REF／FIXTURE_DERIVED_REF 同一組，避免修了今天、退了考卷。
export const EXAM_REF = '132e1ebb', EXAM_DATE = '2026-09-13', EXAM_DERIVED_REF = '0ef6fa24';

const gitJSON = (ref, p) => JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${ref}:${p}`], { maxBuffer: 1 << 30, encoding: 'utf8' }));
const readJSON = p => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));

// scheduleRef 為 null 時讀磁碟上的班表與通過時刻（逐週報告用）。時刻一律跑 computeProfiles（與畫面同一段推論）。
// network／dispatch 是相對樹根的路徑或絕對路徑。
export function loadOvertakeInputs({ scheduleRef = null, withExam = true, network = 'rail-3d/physical/network.json', dispatch = 'rail-3d/physical/dispatch.json' } = {}) {
  const indexPath = path.join(ROOT, 'index.html'), track = readJSON('data/tra.json');
  const sched = scheduleRef ? gitJSON(scheduleRef, 'data/tra_schedule_dense.json') : readJSON('data/tra_schedule_dense.json');
  const passObs = (scheduleRef ? gitJSON(scheduleRef, 'data/tra_pass_obs.json') : readJSON('data/tra_pass_obs.json')).trains;
  const timed = structuredClone(sched);
  computeProfiles({ indexPath, schedule: timed, track, passObs });
  const extraDays = [];
  if (withExam) {
    const examSched = gitJSON(EXAM_REF, 'data/tra_schedule_dense.json');
    assert.ok(examSched.dates[EXAM_DATE]?.length, '考卷班表沒有 ' + EXAM_DATE);
    const examTimed = structuredClone(examSched);
    computeProfiles({ indexPath, schedule: examTimed, track, passObs: gitJSON(EXAM_DERIVED_REF, 'data/tra_pass_obs.json').trains,
      trackSections: gitJSON(EXAM_DERIVED_REF, 'data/tra_track_sections.json').pairs });
    extraDays.push({ day: EXAM_DATE, sched: examSched, timed: examTimed });
  }
  return {
    net: readJSON(network), dispatch: readJSON(dispatch), sched, timed, extraDays,
    base: { net: gitJSON(BASE_REF, 'rail-3d/physical/network.json'), dispatch: gitJSON(BASE_REF, 'rail-3d/physical/dispatch.json') },
    // 單雙線表釘在 BASE_REF：這張表由路網與派車表算出（scripts/build_tra_track_sections.mjs），改派車後重產可能改判；
    // 單線交會的判準不能跟著受測的派車表漂移。重產後有沒有改判，由管線那一步另外檢查。
    sections: gitJSON(BASE_REF, 'data/tra_track_sections.json').pairs,
    protectedPlans: readJSON('scripts/fixtures/remaining-routes-0913.json').afterPlans,
    repairs: readJSON('scripts/fixtures/physical-route-conflicts-0912.json').repairs,
    taimali: readJSON('scripts/fixtures/taimali-platform-track-0912.json'),
  };
}

export const PAIR_MARGIN_SEC = 60, TURN_WINDOW_M = 400, STRAIGHT_DEG = 3, CLEAR_DEG = 5, MIN_SEG_M = 0.5;
const RAD = Math.PI / 180, EARTH_R = 6371008.8;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// 停車點 coords[at] 前後各 half 公尺（端點內插）的累計轉角（度）。OSM 短於 MIN_SEG_M 的碎段方向不可靠
//（一段 0.2 m 的反向碎段會被算成 180°），併掉不計。單一道岔的分岔角太吵，不單獨採用。
export function turnAround(coords, at, half = TURN_WINDOW_M) {
  const lat0 = coords[at][1] * RAD, xy = coords.map(([lon, lat]) => [lon * RAD * Math.cos(lat0) * EARTH_R, lat * RAD * EARTH_R]);
  const walk = step => {
    const out = [xy[at]]; let left = half;
    for (let k = at; left > 0 && k + step >= 0 && k + step < xy.length; k += step) {
      const [x0, y0] = xy[k], [x1, y1] = xy[k + step], d = Math.hypot(x1 - x0, y1 - y0); if (d === 0) continue;
      const f = Math.min(1, left / d); out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]); left -= d;
    }
    return out;
  };
  const line = [...walk(-1).reverse(), ...walk(1).slice(1)], pts = [line[0]];
  for (const p of line.slice(1)) if (Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) >= MIN_SEG_M) pts.push(p);
  let sum = 0;
  for (let k = 1; k + 1 < pts.length; k++) {
    const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]), b = Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; sum += d;
  }
  return sum / RAD;
}

// 列車在第 i 站的行進方向（平面向量）：有進站段就用進站段最後一條邊（含終點站），起點站用出站段第一條邊。
function headingAt(S, ids, i) {
  const [u, v] = i > 0 ? S.paths[ids[i - 1]].nodeIds.slice(-2) : S.paths[ids[0]].nodeIds.slice(0, 2);
  const a = S.g.nodes.get(u).coordinate, b = S.g.nodes.get(v).coordinate;
  return [(b[0] - a[0]) * Math.cos(b[1] * RAD), b[1] - a[1]];
}

export function makeOvertakeJudge(S) {
  const { g, paths, trainOf, poolOf, nodeAt, nodeSet, cleanRoute, clean, memo, turnOK, basePairMax, nonElectricWays, initialNonElectric } = S;
  // 第 i 站的可行停車選項：現況，加上候選節點裡同時滿足以下條件的（與 F2 的 tryMove 同一組條件）：順向、接點能轉、
  // 站間不超過基線 5%、不新踏非電化股道。通過型的超越車與停站型的超越車用同一份選項（候選都是停車節點）。
  // 起點站只有出站段、終點站只有進站段，只量、只換那一側。
  function routeOptions(key, i, ids) {
    const t = trainOf.get(key), last = t.stops.length - 1, st = t.names[i], cur = nodeAt(ids, i);
    assert.ok(i >= 0 && i <= last, key + ' 第 ' + i + ' 站不在站序內');
    const hasIn = i > 0, hasOut = i < last, allowed = initialNonElectric.get(key) || new Set();
    const prev = hasIn ? paths[ids[i - 1]].from : null, next = hasOut ? paths[ids[i]].to : null;
    const inRef = hasIn ? basePairMax.get(t.names[i - 1] + '>' + st) || paths[ids[i - 1]].lengthM : 0;
    const outRef = hasOut ? basePairMax.get(st + '>' + t.names[i + 1]) || paths[ids[i]].lengthM : 0;
    const out = [{ m: cur, ids2: ids, lengthM: (hasIn ? paths[ids[i - 1]].lengthM : 0) + (hasOut ? paths[ids[i]].lengthM : 0), current: true }];
    for (const m of poolOf(st)) {
      if (m === cur) continue;
      const inR = hasIn ? cleanRoute(prev, m, inRef, clean, memo) : null, outR = hasOut ? cleanRoute(m, next, outRef, clean, memo) : null;
      if ((hasIn && !inR) || (hasOut && !outR)) continue;
      if ([inR, outR].some(r => r && [...nonElectricWays(r.id)].some(w => !allowed.has(w)))) continue;
      if ((inR && inR.lengthM > inRef * MAX_PAIR_STRETCH + 1e-6) || (outR && outR.lengthM > outRef * MAX_PAIR_STRETCH + 1e-6)) continue;
      const ids2 = ids.slice(); if (hasIn) ids2[i - 1] = inR.id; if (hasOut) ids2[i] = outR.id;
      if ((i > 1 && !turnOK(ids2[i - 2], ids2[i - 1])) || (hasIn && hasOut && !turnOK(ids2[i - 1], ids2[i])) || (i + 1 < last && !turnOK(ids2[i], ids2[i + 1]))) continue;
      out.push({ m, ids2, lengthM: (inR?.lengthM || 0) + (outR?.lengthM || 0), current: false });
    }
    return out;
  }
  const coordOf = id => { const c = g.nodes.get(id)?.coordinate; assert.ok(c, '節點沒有座標 ' + id); return c; };
  const turnCache = new Map();
  // 進站段＋出站段在停車點前後的累計轉角；現況用派車表的實際路徑量（不是重求的最短路）。
  // 起點站只有出站段、終點站只有進站段（單側 400 m）。
  function turnOf(ids, i) {
    const hasIn = i > 0, hasOut = i < ids.length, k = (hasIn ? ids[i - 1] : '-') + ',' + (hasOut ? ids[i] : '-');
    if (!turnCache.has(k)) {
      const a = hasIn ? paths[ids[i - 1]].nodeIds : null, b = hasOut ? paths[ids[i]].nodeIds : null;
      const line = a && b ? [...a, ...b.slice(1)] : a || b;
      turnCache.set(k, turnAround(line.map(coordOf), a ? a.length - 1 : 0));
    }
    return turnCache.get(k);
  }
  const relCache = new Map();
  // 相對轉角＝現況轉角減去這班車在這站所有可行選項的最小轉角（彎道上的站每條路都彎，用相對值才比得出直彎）。
  // 快取鍵帶 ids[i-2..i+1]：可行選項取決於前後站節點與前後接點（turnOK），換了前後一站要重算。
  function relTurn(key, i, ids) {
    const k = key + '@' + i + '|' + [ids[i - 2], ids[i - 1], ids[i], ids[i + 1]].join(',');
    if (!relCache.has(k)) relCache.set(k, turnOf(ids, i) - Math.min(...routeOptions(key, i, ids).map(o => turnOf(o.ids2, i))));
    return relCache.get(k);
  }
  // 標記只在幾何分不出來時破同分：進站最後一條邊或出站第一條邊是 service=siding 算彎，usage=main 算直。
  const tagKind = (ids, i) => {
    const tags = [];
    if (i > 0) tags.push(g.edges.get(paths[ids[i - 1]].edgeIds.at(-1))?.tags || {});
    if (i < ids.length) tags.push(g.edges.get(paths[ids[i]].edgeIds[0])?.tags || {});
    return tags.some(t => t.service === 'siding') ? 'S' : tags.some(t => t.usage === 'main') ? 'M' : '?';
  };
  function verdict(pr, qIds, pIds) {
    const qNode = nodeAt(qIds, pr.q.i);
    if (nodeSet(pIds[pr.p.i - 1]).has(qNode) || nodeSet(pIds[pr.p.i]).has(qNode)) return { kind: 'shared', viol: true };
    const rq = relTurn(pr.q.key, pr.q.i, qIds), rp = relTurn(pr.p.key, pr.p.i, pIds), d = rq - rp;
    const tq = tagKind(qIds, pr.q.i), tp = tagKind(pIds, pr.p.i);
    let kind = 'ambiguous';
    if (rp <= STRAIGHT_DEG && (d >= CLEAR_DEG || (d >= STRAIGHT_DEG && tq === 'S' && tp === 'M'))) kind = 'ok';
    else if (d <= -CLEAR_DEG || (d <= -STRAIGHT_DEG && tq === 'M' && tp === 'S')) kind = 'reversed';
    return { kind, viol: kind === 'reversed', rq: +rq.toFixed(2), rp: +rp.toFixed(2), tq, tp };
  }
  return { routeOptions, turnOf, relTurn, tagKind, verdict };
}

// 待避對：同一天同一站，待避車 Q 官方停靠且停站窗長大於 0（起點站、終點站也算：前端在起點站發車前、終點站到站後都把車
// 畫在月台上，窗長 > 0 的停靠，超越車照樣會從旁經過），兩車進站方向相同（cos>0）。分兩型：
//   通過型：超越車 P 官方不停，Q.arr ≤ P 的通過時刻 < Q.dep（零長窗自然配不到）。
//   停站型（後到先開）：P 也官方停靠且不是起訖站，Q.arr ≤ P.arr 且 P.dep ≤ Q.dep，兩端至少一端嚴格成立
//     （兩端都同一分鐘分不出先後，不算）。
// 配對只看時刻是否落在停站窗內，不看停多久（停得久可能是折返、對向交會或單純長停）。
// 窗外前後 PAIR_MARGIN_SEC 秒內的通過車（P 在 Q 到站前就過站，或與 Q 同時、更晚才過站）不是超越：
// 只回傳在 near 給報告，不進違規、不修、閘門不算；放寬窗會讓修復器搬不必搬的車，閘門也會紅在不存在的問題上。
// 時刻來自 computeProfiles（cells），不是密化班表的內插值。同一組（型別, Q 車次鍵＠站序, P 車次鍵＠站序）跨日合併成一筆，
// days 是它出現的日子（違規按天數加權）。
export function findOvertakePairs(S) {
  const { cells, trainOf, current } = S;
  const hc = new Map(), head = (key, i) => hc.get(key + '@' + i) || hc.set(key + '@' + i, headingAt(S, current.get(key), i)).get(key + '@' + i);
  const ref = (key, i) => ({ key, i, no: trainOf.get(key).no });
  const mid = d => d.i > 0 && d.i < trainOf.get(d.key).stops.length - 1;
  const classes = new Map(), near = [];
  const add = (type, day, st, d, p, at) => {
    const id = `${type}:${d.key}@${d.i}|${p.key}@${p.i}`;
    const c = classes.get(id) || classes.set(id, { id, type, st, q: ref(d.key, d.i), p: ref(p.key, p.i), days: [], at: {} }).get(id);
    if (!c.days.includes(day)) { c.days.push(day); c.at[day] = at; }
  };
  for (const [day, byStation] of cells) for (const [st, cell] of byStation) {
    const passers = cell.pass.filter(p => p.side === 'in' && !p.dwells), waiters = cell.dwell.filter(d => d.b > d.a), stoppers = cell.dwell.filter(mid);
    for (const d of waiters) {
      for (const p of passers) {
        if (p.key === d.key || p.t < d.a - PAIR_MARGIN_SEC || p.t > d.b + PAIR_MARGIN_SEC || dot(head(d.key, d.i), head(p.key, p.i)) <= 0) continue;
        if (d.a <= p.t && p.t < d.b) add('pass', day, st, d, p, { qa: d.a, qb: d.b, pt: p.t });
        else near.push({ day, station: st, q: ref(d.key, d.i), p: ref(p.key, p.i), qa: d.a, qb: d.b, pt: p.t, side: p.t < d.a ? '到站前就過站' : '同時或更晚才過' });
      }
      for (const p of stoppers) {
        if (p.key === d.key || !(d.a <= p.a && p.b <= d.b && (d.a < p.a || p.b < d.b)) || dot(head(d.key, d.i), head(p.key, p.i)) <= 0) continue;
        add('stop', day, st, d, p, { qa: d.a, qb: d.b, pa: p.a, pb: p.b });
      }
    }
  }
  return { pairs: [...classes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), near };
}

// 單線交會：單線區間取 sections（data/tra_track_sections.json 的 pairs，tracks===1），不從班表推。在單線區間端點站上，
// 兩班對向車（方向向量 cos<0）停站或通過的時段重疊（含端點），而且至少一班的前一段或後一段就是單線區間：
// 任一班的停車節點落在另一班進出這站的路徑上，就算一件共用節點。閘門與修復器拿件數當棘輪（不增加）。
export function makeMeetCounter(S, sections) {
  const { cells, trainOf, current, nodeAt, nodeSet } = S;
  const single = new Set(Object.entries(sections).filter(([, v]) => v.tracks === 1).map(([k]) => k));
  const ends = new Set([...single].flatMap(k => k.split('|')));
  const raw = st => st.split(':')[1];
  const isEnd = st => ends.has(normSta(raw(st)));
  const usesSingle = (key, i) => { const n = trainOf.get(key).names;
    return (i > 0 && single.has(sectionKey(raw(n[i - 1]), raw(n[i])))) || (i < n.length - 1 && single.has(sectionKey(raw(n[i]), raw(n[i + 1])))); };
  const touches = (ids, i, node) => (i > 0 && nodeSet(ids[i - 1]).has(node)) || (i < ids.length && nodeSet(ids[i]).has(node));
  const span = (a, b) => [Number.isFinite(a) ? a : b, Number.isFinite(b) ? b : a];
  function scan(st, cell, override, keepAll) {
    if (!isEnd(st)) return [];
    const idsOf = key => (override && override.get(key)) || current.get(key);
    const occ = [...cell.dwell.map(d => ({ key: d.key, i: d.i, w: span(d.a, d.b) })),
      ...cell.pass.filter(p => p.side === 'in' && !p.dwells).map(p => ({ key: p.key, i: p.i, w: [p.t, p.t] }))];
    const out = [];
    for (let x = 0; x < occ.length; x++) for (let y = x + 1; y < occ.length; y++) {
      const X = occ[x], Y = occ[y];
      if (X.key === Y.key || Math.min(X.w[1], Y.w[1]) < Math.max(X.w[0], Y.w[0])) continue;
      if (!usesSingle(X.key, X.i) && !usesSingle(Y.key, Y.i)) continue;
      const xi = idsOf(X.key), yi = idsOf(Y.key);
      if (dot(headingAt(S, xi, X.i), headingAt(S, yi, Y.i)) >= 0) continue;
      const shared = touches(yi, Y.i, nodeAt(xi, X.i)) || touches(xi, X.i, nodeAt(yi, Y.i));
      if (shared || keepAll) out.push({ st, x: { key: X.key, i: X.i, no: trainOf.get(X.key).no }, y: { key: Y.key, i: Y.i, no: trainOf.get(Y.key).no }, at: Math.max(X.w[0], Y.w[0]), shared });
    }
    return out;
  }
  const cellMeets = (st, cell, override) => scan(st, cell, override, false);
  // all=true 時連不共用節點的交會一起數（只拿來證明這個計數器真的抓得到交會）
  function perDay({ override = null, collect = null, all = false } = {}) {
    const out = {};
    for (const [day, byStation] of cells) {
      let n = 0;
      for (const [st, cell] of byStation) for (const m of scan(st, cell, override, all)) { n++; if (collect) collect.push({ day, ...m }); }
      out[day] = n;
    }
    return out;
  }
  return { single, ends, isEnd, cellMeets, perDay };
}
