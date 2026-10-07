// 台鐵待避股道的共用判準（修復器 repair_tra_overtake_tracks.mjs 與閘門 verify_tra_overtake_tracks.mjs 同一份）。
// 規格：docs/specs/2026-10-06-tra-overtake-main-siding.md。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeProfiles } from '../build_run_profiles.mjs';
import { SYS, MAX_PAIR_STRETCH } from './tra_station_conflicts.mjs';
import { sectionKey, normSta } from './parallel_tracks.mjs';
import { stationKey } from '../../rail-3d/physical/timing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 基準：站間長度上限、方向股道、候選節點、非電化允許清單、單雙線表都從這顆的出貨檔算，重跑自己的輸出時判準不漂移。
// 何時換：重跑 F1／F2 並 commit 新產物之後、跑 F2b 之前，換成那顆 commit（規格第 6 節「釘選的 commit 何時換」）。
export const BASE_REF = '0a435fcf';
// 硬閘門釘的班表快照（14 天窗 2026-10-02～10-15）；通過時刻 tra_pass_obs.json 取同一顆。班表釘在這顆，班表檔每週換窗
// 不會改變閘門用的班表，滾動窗另出報告。但主窗的時刻推論（computeProfiles）沒傳單雙線表，讀的是磁碟上現行的
// data/tra_track_sections.json：每週重產若改了站對，單線交會的通過時刻就可能被推動一些，待避對的時間窗歸屬也可能跟著變；
// 那是輸入的時刻變了，不是閘門的班表變了。
// 何時換：F2b 換新班表重跑時，換成那份班表的 commit（規格第 6 節）。
export const SCHEDULE_REF = '882523ceb43991d0acf7749de81b427e0ccf0db5';
// 9/13 考卷：與 verify_physical_no_overlap.mjs 的 FIXTURE_REF／FIXTURE_DERIVED_REF 同一組，避免修了今天、退了考卷。
// 何時換：只跟著 verify_physical_no_overlap.mjs 的那一組一起換（規格第 6 節）。
export const EXAM_REF = '132e1ebb', EXAM_DATE = '2026-09-13', EXAM_DERIVED_REF = '0ef6fa24';

const gitJSON = (ref, p) => JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${ref}:${p}`], { maxBuffer: 1 << 30, encoding: 'utf8' }));
const readJSON = p => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));

// scheduleRef 為 null 時讀磁碟上的班表與通過時刻（逐週報告用）。時刻一律跑 computeProfiles（與畫面同一段推論）。
// network／dispatch 是相對樹根的路徑或絕對路徑；files 回傳實際讀的兩個檔（絕對路徑），收尾要從磁碟重讀輸入時用它。
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
    files: { network: path.resolve(ROOT, network), dispatch: path.resolve(ROOT, dispatch) },
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
// 穿越（規格第 3 節）：車寬 2.9 m；共用軌道邊至少 0.5 m 才算（與全日畫面掃描判 W2 的同一組門檻）；編組長度查不到用 240 m
//（與 tra_station_conflicts.mjs 的 materialize 落成計畫的 lengthM 同一個預設）。
export const BODY_W_M = 2.9, SHARED_EDGE_MIN_M = 0.5, DEFAULT_FORMATION_M = 240;
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

// 列車在第 i 站的行進方向（平面向量）：有進站段就用進站段（含終點站），起點站用出站段。
// OSM 短於 MIN_SEG_M 的碎段方向不可靠（一段 0.3 m 的反向碎段會讓兩車的 cos 翻號，待避對或單線交會就被靜默丟掉）：
// 進站段從尾端往前、出站段從頭往後，取第一條長度不短於 MIN_SEG_M 的邊；整段都太短才退回最後一條（進站）／第一條（出站）。
// 邊長與 turnAround 用同一套平面近似（以停車點的緯度縮放經度）。
export function headingAt(S, ids, i) {
  const nodeIds = S.paths[i > 0 ? ids[i - 1] : ids[0]].nodeIds, last = nodeIds.length - 2, coordOf = id => S.g.nodes.get(id).coordinate;
  const cos0 = Math.cos(coordOf(i > 0 ? nodeIds.at(-1) : nodeIds[0])[1] * RAD);
  const long = j => { const a = coordOf(nodeIds[j]), b = coordOf(nodeIds[j + 1]); return Math.hypot((b[0] - a[0]) * cos0, b[1] - a[1]) * RAD * EARTH_R >= MIN_SEG_M; };
  let k = i > 0 ? last : 0;
  if (i > 0) { for (let j = last; j >= 0; j--) if (long(j)) { k = j; break; } }
  else for (let j = 0; j <= last; j++) if (long(j)) { k = j; break; }
  const a = coordOf(nodeIds[k]), b = coordOf(nodeIds[k + 1]);
  return [(b[0] - a[0]) * Math.cos(b[1] * RAD), b[1] - a[1]];
}

export function makeOvertakeJudge(S) {
  const { g, paths, trainOf, poolOf, nodeAt, nodeSet, cleanRoute, clean, memo, turnOK, basePairMax, nonElectricWays, initialNonElectric, lenOf } = S;
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
  // ── 穿越（規格第 3 節）：待避車停站期間車身佔用的那段軌道上，超越車的路徑與它共用軌道邊，或橫向距離小於車寬 ──
  // 算繪端停站時取樣點（整列中心）落在停車節點上（rail-3d/physical/motion.js 的 dwell），車身前後各半列：
  // 前半沿進站段、後半沿出站段（rail-3d/integration/formations.js 的 offsetM、train-path.js 的 formationPoses）。
  // 起點站沒有進站段、終點站沒有出站段（算繪端在那一側是延伸出去的一小段，離線沒有），只取有路徑的那一側，
  // 所以起訖站的車身少算另一半：只會漏判、不會多判。編組長度取 S.lenOf（查不到用 DEFAULT_FORMATION_M）。
  // 超越車在這一站的路徑＝進站段加出站段整段：它在待避車的停站窗內從這一站通過或進出，整段都會走過。
  // 全台共用同一個投影（兩條路徑要比相對位置，不能各用各的緯度）；沿路徑的距離另外用各段的緯度算公尺。
  const KM = EARTH_R * RAD, COS_REF = Math.cos(23.7 * RAD);
  const geoms = new Map();
  function pathGeom(pid) {
    let G = geoms.get(pid); if (G) return G;
    const p = paths[pid]; assert.ok(p, '路徑不存在 ' + pid);
    const n = p.nodeIds.length, xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n);
    let prev = null;
    for (let k = 0; k < n; k++) {
      const c = coordOf(p.nodeIds[k]); xs[k] = c[0] * KM * COS_REF; ys[k] = c[1] * KM;
      if (prev) cum[k] = cum[k - 1] + Math.hypot((c[0] - prev[0]) * Math.cos((c[1] + prev[1]) / 2 * RAD), c[1] - prev[1]) * KM;
      prev = c;
    }
    G = { xs, ys, cum, eids: p.edgeIds, total: cum[n - 1], eset: new Set(p.edgeIds) };
    geoms.set(pid, G); return G;
  }
  // 停車節點前 h 公尺的進站段尾加後 h 公尺的出站段頭；每一小段記它所在的軌道邊與被車身蓋到的長度
  const bodies = new Map();
  function bodyOf(qIn, qOut, h) {
    const key = qIn + ',' + qOut + ',' + h;
    let segs = bodies.get(key); if (segs) return segs;
    segs = [];
    const part = (G, k, d0, d1) => {
      const a = G.cum[k], span = G.cum[k + 1] - a; if (!(span > 0) || !(d1 > d0)) return;
      const f0 = (d0 - a) / span, f1 = (d1 - a) / span, dx = G.xs[k + 1] - G.xs[k], dy = G.ys[k + 1] - G.ys[k];
      segs.push({ x1: G.xs[k] + dx * f0, y1: G.ys[k] + dy * f0, x2: G.xs[k] + dx * f1, y2: G.ys[k] + dy * f1, eid: G.eids[k], len: d1 - d0 });
    };
    if (qIn != null) { const G = pathGeom(qIn), lo = Math.max(0, G.total - h); for (let k = G.eids.length - 1; k >= 0 && G.cum[k + 1] > lo; k--) part(G, k, Math.max(G.cum[k], lo), G.cum[k + 1]); }
    if (qOut != null) { const G = pathGeom(qOut), hi = Math.min(G.total, h); for (let k = 0; k < G.eids.length && G.cum[k] < hi; k++) part(G, k, G.cum[k], Math.min(G.cum[k + 1], hi)); }
    bodies.set(key, segs); return segs;
  }
  const cross2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const ptSeg = (px, py, ax, ay, bx, by) => { const x = bx - ax, y = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * x + (py - ay) * y) / (x * x + y * y || 1))); return Math.hypot(px - ax - x * t, py - ay - y * t); };
  function segDist(s, G, k) {
    const cx = G.xs[k], cy = G.ys[k], dx = G.xs[k + 1], dy = G.ys[k + 1];
    if (cross2(s.x1, s.y1, s.x2, s.y2, cx, cy) * cross2(s.x1, s.y1, s.x2, s.y2, dx, dy) < 0 && cross2(cx, cy, dx, dy, s.x1, s.y1) * cross2(cx, cy, dx, dy, s.x2, s.y2) < 0) return 0;
    return Math.min(ptSeg(s.x1, s.y1, cx, cy, dx, dy), ptSeg(s.x2, s.y2, cx, cy, dx, dy), ptSeg(cx, cy, s.x1, s.y1, s.x2, s.y2), ptSeg(dx, dy, s.x1, s.y1, s.x2, s.y2));
  }
  // 車身與超越車路徑的最小橫向距離。只比外框相距不超過 reach 的小段（reach 之外不可能小於門檻），沒有就回 Infinity；
  // 一般判定 reach＝車寬、量到小於車寬就收手；measure 時 reach 放寬到 50 m 而且不收手，報告與校準才看得到量到的距離。
  const crossCache = new Map();
  function crossingOf(qIn, qOut, h, pIn, pOut, measure = false) {
    const key = qIn + ',' + qOut + ',' + h + '|' + pIn + ',' + pOut + (measure ? '|m' : '');
    let r = crossCache.get(key); if (r) return r;
    const segs = bodyOf(qIn, qOut, h), Ps = [pIn, pOut].filter(x => x != null && paths[x]).map(pathGeom), reach = measure ? 50 : BODY_W_M;
    let sharedM = 0, latM = Infinity;
    for (const s of segs) if (Ps.some(G => G.eset.has(s.eid))) sharedM += s.len;
    if (segs.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of segs) { x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2); y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2); }
      x0 -= reach; x1 += reach; y0 -= reach; y1 += reach;
      scan: for (const G of Ps) for (let k = 0; k + 1 < G.xs.length; k++) {
        const ax = G.xs[k], bx = G.xs[k + 1], ay = G.ys[k], by = G.ys[k + 1];
        if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
        const gx0 = Math.min(ax, bx) - reach, gx1 = Math.max(ax, bx) + reach, gy0 = Math.min(ay, by) - reach, gy1 = Math.max(ay, by) + reach;
        for (const s of segs) {
          if (Math.max(s.x1, s.x2) < gx0 || Math.min(s.x1, s.x2) > gx1 || Math.max(s.y1, s.y2) < gy0 || Math.min(s.y1, s.y2) > gy1) continue;
          const d = segDist(s, G, k); if (d < latM) latM = d;
          if (!measure && latM < BODY_W_M) break scan;
        }
      }
    }
    r = { sharedM, latM, shared: sharedM >= SHARED_EDGE_MIN_M || latM < BODY_W_M }; crossCache.set(key, r); return r;
  }
  // 這一對在這兩份路徑下算不算穿越：停車節點在超越車路徑上（via=node）、車身範圍內共用軌道邊（edge）、橫距小於車寬（lateral）
  function crossing(pr, qIds, pIds, measure = false) {
    const qNode = nodeAt(qIds, pr.q.i), pIn = pIds[pr.p.i - 1], pOut = pIds[pr.p.i];
    const qIn = pr.q.i > 0 ? qIds[pr.q.i - 1] : null, qOut = pr.q.i < qIds.length ? qIds[pr.q.i] : null;
    const x = crossingOf(qIn, qOut, (lenOf?.(pr.q.no) ?? DEFAULT_FORMATION_M) / 2, pIn, pOut, measure);
    const onNode = nodeSet(pIn).has(qNode) || nodeSet(pOut).has(qNode);
    return { shared: onNode || x.shared, via: onNode ? 'node' : x.sharedM >= SHARED_EDGE_MIN_M ? 'edge' : x.latM < BODY_W_M ? 'lateral' : null, sharedM: x.sharedM, latM: x.latM };
  }
  function verdict(pr, qIds, pIds) {
    // 穿越優先於直彎判定：車身壓到超越車的路徑，畫面上就是超越車從待避車身上穿過去，直彎再對也沒用
    const x = crossing(pr, qIds, pIds);
    if (x.shared) return { kind: 'shared', viol: true, via: x.via };
    const rq = relTurn(pr.q.key, pr.q.i, qIds), rp = relTurn(pr.p.key, pr.p.i, pIds), d = rq - rp;
    const tq = tagKind(qIds, pr.q.i), tp = tagKind(pIds, pr.p.i);
    // 做對與倒過來對稱（規格第 3 節）：做對＝超越車走直的、待避車比它多轉；倒過來＝待避車走直的、超越車比它多轉。
    // 兩車都不直時看不出誰占了正線，歸 ambiguous，不算違規。
    let kind = 'ambiguous';
    if (rp <= STRAIGHT_DEG && (d >= CLEAR_DEG || (d >= STRAIGHT_DEG && tq === 'S' && tp === 'M'))) kind = 'ok';
    else if (rq <= STRAIGHT_DEG && (d <= -CLEAR_DEG || (d <= -STRAIGHT_DEG && tq === 'M' && tp === 'S'))) kind = 'reversed';
    return { kind, viol: kind === 'reversed', rq: +rq.toFixed(2), rp: +rp.toFixed(2), tq, tp };
  }
  return { routeOptions, turnOf, relTurn, tagKind, verdict, crossing };
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

export const REASON_SHORT = '同一班 P 在同站同時超越兩班 Q、該方向較彎的股道不夠';

// explain 回傳的原因（還有可行修法時回 REASON_FIXABLE，其餘每一組修不掉的都落在其中一個）。
// SHARED_OK_REASONS：共用節點（畫面上超越車穿過待避車）准許留下的原因，只有修了會違反硬性條件的（規格第 6 節第 3 條）；
// FIXABLE 與「會增加別的違規」不准留。閘門與 F2b 收尾自檢判「還有可行修法」用匯出的 REASON_FIXABLE、判共用節點的原因用
// SHARED_OK_REASONS，都不各寫一份字面；原因的字面只在這裡寫一次。
export const REASON_FIXABLE = 'FIXABLE';
const REASONS = {
  FIXABLE: REASON_FIXABLE, NO_ALT: '沒有替代股道', STILL: '替代組合都仍違規', SHORT: REASON_SHORT, PROTECTED: '受保護',
  BC: '會增加 B 或 C', MEET: '會增加單線交會共用節點', SHARED: '會增加共用節點', OTHER: '會增加別的違規',
};
export const SHARED_OK_REASONS = new Set([REASONS.NO_ALT, REASONS.STILL, REASONS.SHORT, REASONS.PROTECTED, REASONS.BC, REASONS.MEET, REASONS.SHARED]);

// 保護：remaining-routes-0913 的 afterPlans（含沿用它們的改點／借用車次）、0912 四筆具名修復的兩端站、太麻里非電化月台節點。
export function makeProtection(S, { protectedPlans, repairs, taimali }) {
  const lockedKeys = new Set([...Object.keys(protectedPlans), ...S.protectedScheduleKeys]);
  const lockedStops = new Set(repairs.flatMap(r => r.station.split('—').map(n => r.train + '@' + stationKey(SYS, n))));
  const lockedNodes = new Set([taimali.stopNode, taimali.dieselTrack?.stopNode].filter(Boolean).map(String));
  const isProtected = (key, j, fromNode, toNode) => {
    const rec = S.trainOf.get(key);
    if (lockedKeys.has(key)) return '已驗收進路';
    if (lockedStops.has(rec.no + '@' + rec.names[j])) return '具名修復端點';
    if (lockedNodes.has(String(fromNode)) || lockedNodes.has(String(toNode))) return '太麻里非電化月台';
    return null;
  };
  return Object.assign(isProtected, { lockedKeys, lockedStops, lockedNodes });
}

// 求解器：一組違規的待避車選項 × 超越車選項（含不動）一起列舉；改一份自己的計畫時，執行期借它切片的車次一起換（expand）。
// 接受：違規總數（兩型合計、按天數加權）變少，沒有任何一天的 B、C、單線交會共用節點變多（逐日淨增加），
// 而且原本不共用的待避對沒有任何一對變成共用節點（穿越；逐對算，不是逐日總數，見 evaluate）；
// 同分依序取：這一組自己修完的狀態好的（做對 > 超越車直 > 超越車仍彎 > 仍違規）、搬的車少、路徑短、節點字串小的（結果可重現）。
// 只比搬的車少，會偏好只把待避車推到另一條側線、超越車留在側線的修法：違規數照樣變少，超越車卻還沒走正線。
export function makeOvertakeSolver(S, J, { pairs, isProtected, meets }) {
  const { current, borrowed, trainOf, cells, daysOf, cellConflicts, borrowersOf, nonElectricWays, initialNonElectric, nodeAt, materialize, relayJoins, settleRelays } = S;
  const byKey = new Map(), byP = new Map();
  for (const c of pairs) {
    for (const side of ['q', 'p']) (byKey.get(c[side].key) || byKey.set(c[side].key, []).get(c[side].key)).push(c);
    const pk = c.p.key + '@' + c.p.i; (byP.get(pk) || byP.set(pk, []).get(pk)).push(c);
  }
  const state = new Map(pairs.map(c => [c.id, J.verdict(c, current.get(c.q.key), current.get(c.p.key))]));
  // 版本號：每次 apply 加 1。bestFix 回傳的 fix 帶著算它當下的版本，apply 只收現況版本的 fix——
  // fix 的 dViol、B／C、單線交會與換股內容都是相對於算它當下的現況，別的 fix 套用之後再套它，接受條件已經不成立。
  let ver = 0;
  const weight = c => c.days.length;
  const violations = () => pairs.reduce((n, c) => n + (state.get(c.id).viol ? weight(c) : 0), 0);
  const violationsByType = () => { const o = { pass: 0, stop: 0 }; for (const c of pairs) if (state.get(c.id).viol) o[c.type] += weight(c); return o; };
  const violating = () => pairs.filter(c => state.get(c.id).viol).sort((a, b) => weight(b) - weight(a) || (a.id < b.id ? -1 : 1));
  const idsAfter = (all, key) => all.get(key) || current.get(key);
  const changedAt = (key, ids2) => { const ids = current.get(key), out = []; ids2.forEach((p, k) => { if (p !== ids[k]) out.push(k); }); return out; };
  // 借用者（執行期綁到來源計畫切片的車次）跟著來源換：來源的新路徑從 b.o 起取 b.n 段，蓋到借用者自己路徑的 b.at 起。
  // 單一來源的借用者整條都是切片（at 為 0），結果與整條取代相同；接力借路徑的車次一份計畫借了好幾班的切片，
  // 每一份來源各蓋自己那一截，任何一份來源換股，這班車都在受影響範圍內。直接被換股的借用者（direct 裡有它）不再跟著來源。
  function expand(direct) {
    const all = new Map(direct), followed = new Map();
    for (const [key, ids2] of direct) if (!borrowed.has(key)) for (const b of borrowersOf(key)) {
      if (direct.has(b.key)) continue;
      const ids = followed.get(b.key) || followed.set(b.key, current.get(b.key).slice()).get(b.key);
      ids2.slice(b.o, b.o + b.n).forEach((pid, j) => { ids[b.at + j] = pid; });
    }
    for (const [key, ids] of followed) if (!trainOf.get(key).sourceKeys || relayJoins(key, ids)) all.set(key, ids);   // 接力借用者交接處接不上就不跟著換（見 relayJoins）
    return all;
  }
  // 受影響範圍：第 k 段路徑改了，相對轉角快取鍵含 ids[j-2..j+1] ⇒ 站 j∈[k-1,k+2] 的待避對要重判；
  // 站 k、k+1 的 cells 要重算 B／C 與單線交會（停車節點、進出站路徑與行進方向都只在這兩站變）。
  function affected(all) {
    const ps = new Set(), cs = new Map();
    for (const [key, ids2] of all) {
      const ch = changedAt(key, ids2); if (!ch.length) continue;
      const lo = ch[0], hi = ch.at(-1), rec = trainOf.get(key);
      for (const c of byKey.get(key) || []) { const i = c.q.key === key ? c.q.i : c.p.i; if (i >= lo - 1 && i <= hi + 2) ps.add(c); }
      for (const day of new Set(daysOf.get(key) || [])) for (let j = lo; j <= hi + 1; j++) { const cell = cells.get(day)?.get(rec.names[j]); if (cell) cs.set(cell, { day, st: rec.names[j] }); }
    }
    return { pairs: [...ps], cells: [...cs] };
  }
  const tallyOf = (cell, st, override) => { let B = 0, C = 0; for (const x of cellConflicts(cell, override)) if (x.type === 'B') B++; else C++; return { B, C, M: meets.cellMeets(st, cell, override).length }; };
  const baseTally = new Map(), tallyNow = (cell, st) => baseTally.get(cell) || baseTally.set(cell, tallyOf(cell, st)).get(cell);
  // 三種「變多就不准」的東西，算法不同：
  // B／C、單線交會共用節點是衝突件數，逐日加總套用前後的差，淨增加大於 0 的日子才列進 worse／worseMeet。
  // 待避對共用節點（kind 為 shared＝畫面上超越車穿過待避車）逐對算：套用前 kind 不是 shared、套用後是 shared 的那一對，
  // 它的 days 每一天都列進 worseShared（排序、去重）。原本就共用的對不算（那是既有的）。
  // 不看逐日總數：同一站、同一班 P，這一對修好、隔壁那一對變穿越，逐日淨變動是 0，總數擋不住這種換位；
  // 原本做對的那一對在畫面上就是退步，不能拿隔壁多修好一對來抵。
  function evaluate(direct) {
    const all = expand(direct), aff = affected(all);
    let dViol = 0;
    const perDay = new Map(), dayOf = day => perDay.get(day) || perDay.set(day, { B: 0, C: 0, M: 0 }).get(day), newShared = new Set();
    for (const c of aff.pairs) {
      const was = state.get(c.id), now = J.verdict(c, idsAfter(all, c.q.key), idsAfter(all, c.p.key));
      dViol += ((now.viol ? 1 : 0) - (was.viol ? 1 : 0)) * weight(c);
      if (now.kind === 'shared' && was.kind !== 'shared') for (const day of c.days) newShared.add(day);
    }
    for (const [cell, { day, st }] of aff.cells) {
      const b = tallyNow(cell, st), a = tallyOf(cell, st, all), d = dayOf(day);
      d.B += a.B - b.B; d.C += a.C - b.C; d.M += a.M - b.M;
    }
    return { all, dViol, worse: [...perDay].filter(([, d]) => d.B > 0 || d.C > 0).map(([day]) => day).sort(),
      worseMeet: [...perDay].filter(([, d]) => d.M > 0).map(([day]) => day).sort(),
      worseShared: [...newShared].sort() };
  }
  // 借用者連帶換股也要守非電化與保護（停車節點有變的那幾站逐一問 isProtected）
  function blockedBy(all) {
    for (const [key, ids2] of all) {
      const cur = current.get(key), allowed = initialNonElectric.get(key) || new Set();
      for (const k of changedAt(key, ids2)) if ([...nonElectricWays(ids2[k])].some(w => !allowed.has(w))) return { kind: 'infeasible', why: '引入新非電化股道' };
      for (let j = 0; j <= ids2.length; j++) { const a = nodeAt(cur, j), b = nodeAt(ids2, j); if (a !== b) { const why = isProtected(key, j, a, b); if (why) return { kind: 'protected', why }; } }
    }
    return null;
  }
  function candidates(c) {
    const qOpts = J.routeOptions(c.q.key, c.q.i, current.get(c.q.key)), pOpts = J.routeOptions(c.p.key, c.p.i, current.get(c.p.key)), out = [];
    for (const qo of qOpts) for (const po of pOpts) {
      if (qo.current && po.current) continue;
      const direct = new Map(); if (!qo.current) direct.set(c.q.key, qo.ids2); if (!po.current) direct.set(c.p.key, po.ids2);
      out.push({ c, direct, moved: direct.size, lengthM: qo.lengthM + po.lengthM, nodes: qo.m + '|' + po.m });
    }
    return { alternatives: qOpts.length + pOpts.length - 2, out };
  }
  // 這一組自己修完的狀態（同分時先看它）：0 做對、1 不違規且超越車是直的（rp≤3°，包含待避車只多轉 3°–5°、還沒到做對的）、
  // 2 不違規但超越車仍彎、3 仍違規。
  const qualityOf = v => (v.kind === 'ok' ? 0 : !v.viol ? (v.rp <= STRAIGHT_DEG ? 1 : 2) : 3);
  const rank = (a, b) => a.dViol - b.dViol || a.quality - b.quality || a.moved - b.moved || a.lengthM - b.lengthM || (a.nodes < b.nodes ? -1 : a.nodes > b.nodes ? 1 : 0);
  function bestFix(c) {
    let best = null;
    for (const cand of candidates(c).out) {
      if (blockedBy(expand(cand.direct))) continue;
      const ev = evaluate(cand.direct); if (ev.dViol >= 0 || ev.worse.length || ev.worseMeet.length || ev.worseShared.length) continue;
      const v = J.verdict(c, idsAfter(ev.all, c.q.key), idsAfter(ev.all, c.p.key));
      const fix = { ...cand, ...ev, ver, quality: qualityOf(v), cAfter: { kind: v.kind, rq: v.rq ?? null, rp: v.rp ?? null } };
      if (!best || rank(fix, best) < 0) best = fix;
    }
    return best;
  }
  // 同一班 P 在同站同一天同時超越好幾班 Q（每班 Q 的停站窗都包住 P 的通過或停站時段，那一天它們必然同時在站），
  // 而能讓這幾班 Q 都不違規的股道不夠：逐日判斷。groupD＝c 加上那天也在的手足（同一班 P、同一站序、Q 不同班、days 含該天）；
  // 不同天才出現的 Q 不會同時在站，不湊成同一組。對 P 的每個選項 po，只要有某一天 capD(po) < |groupD|，這個 po 就不夠；
  // 所有 po 都不夠才回 true。capD(po)＝groupD 各成員的 Q 選項裡，能讓該成員不違規的相異節點數
  // （近似：節點取聯集，不做二部配對）。只看 |groupD| ≥ 2 的天，沒有這種天就回 false。
  function curvedShortage(c) {
    const sibs = (byP.get(c.p.key + '@' + c.p.i) || []).filter(s => s.q.key !== c.q.key), seen = new Set(), groups = [];
    for (const d of c.days) {
      const g = [c, ...sibs.filter(s => s.days.includes(d))], k = g.map(x => x.id).join('\n');
      if (g.length >= 2 && !seen.has(k)) { seen.add(k); groups.push(g); }
    }
    if (!groups.length) return false;
    const qOpts = new Map([...new Set(groups.flat())].map(x => [x, J.routeOptions(x.q.key, x.q.i, current.get(x.q.key))]));
    return J.routeOptions(c.p.key, c.p.i, current.get(c.p.key)).every(po => groups.some(g => {
      const cap = new Set();
      for (const x of g) for (const qo of qOpts.get(x)) if (!J.verdict(x, qo.ids2, po.ids2).viol) cap.add(qo.m);
      return cap.size < g.length;
    }));
  }
  // 修不掉的原因，依序判斷（前一條成立就不看後面）：沒有替代股道（Q、P 都沒有別的選項）→ 替代組合都仍違規（換了也沒轉好）
  // → 受保護／沒有替代股道（轉得好的組合全被保護或非電化擋掉）→ REASON_SHORT（組合沒被擋，但同組 Q 較彎的股道不夠）
  // → 會增加 B 或 C → 會增加單線交會共用節點 → 會增加共用節點 → 會增加別的違規。
  // REASON_SHORT 排在保護之後：被保護擋下的組，原因是保護，不是股道不夠。
  function explain(c) {
    if (bestFix(c)) return REASONS.FIXABLE;
    const { alternatives, out } = candidates(c);
    if (!alternatives) return REASONS.NO_ALT;
    const fixing = out.map(x => ({ x, all: expand(x.direct) })).filter(({ all }) => !J.verdict(c, idsAfter(all, c.q.key), idsAfter(all, c.p.key)).viol);
    if (!fixing.length) return REASONS.STILL;
    const blocked = fixing.map(f => blockedBy(f.all)), open = fixing.filter((f, k) => !blocked[k]);
    if (!open.length) return blocked.some(b => b.kind === 'protected') ? REASONS.PROTECTED : REASONS.NO_ALT;
    if (curvedShortage(c)) return REASONS.SHORT;
    const evs = open.map(f => evaluate(f.x.direct));
    if (evs.every(e => e.worse.length)) return REASONS.BC;
    if (evs.every(e => e.worse.length || e.worseMeet.length)) return REASONS.MEET;
    if (evs.every(e => e.worse.length || e.worseMeet.length || e.worseShared.length)) return REASONS.SHARED;
    return REASONS.OTHER;
  }
  // 要在 apply 之前呼叫（diff 是相對於現況）
  function describe(fix) {
    const c = fix.c;
    return { type: c.type, station: c.st, q: c.q, p: c.p, days: c.days.length, dViol: fix.dViol, moved: fix.moved, cAfter: fix.cAfter,
      changes: [...fix.all].map(([key, ids2]) => ({ key, direct: fix.direct.has(key), materialise: fix.direct.has(key) && borrowed.has(key),
        diff: changedAt(key, ids2).map(k => [k, current.get(key)[k], ids2[k]]) })) };
  }
  function apply(fix) {
    assert.equal(fix.ver, ver, '這個 fix 是用舊狀態算的（fix.ver=' + fix.ver + '、現況 ver=' + ver + '）：每次 apply 之後都要重新 bestFix');
    const aff = affected(fix.all);
    for (const [key, ids2] of fix.all) {
      if (fix.direct.has(key) && borrowed.has(key)) materialize(key);   // 借來的被直接換股：落成自己的計畫，不再跟著來源
      const live = current.get(key); live.length = 0; live.push(...ids2);
    }
    for (const [cell] of aff.cells) baseTally.delete(cell);
    for (const c of aff.pairs) state.set(c.id, J.verdict(c, current.get(c.q.key), current.get(c.p.key)));
    settleRelays();   // 接力借路徑的車次：重新綁定與模型不同的落成自己的計畫（路徑不變，所以上面算好的狀態仍然成立）
    ver++;
  }
  return { violations, violationsByType, violating, state: c => state.get(c.id), expand, evaluate, bestFix, explain, apply, describe };
}
