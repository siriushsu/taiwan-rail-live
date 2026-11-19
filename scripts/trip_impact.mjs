// AI 串聯行程 P4「出狀況判斷」：行程各段 × 最新一版 AI 營運整理（/api/rail-status 的 systems[].impacts）→ 三態。
// 純函式：不碰 D1、不碰網路。原生 railcore 的 TripImpact.kt 是同一套規則，兩邊跑同一份測試向量
// （scripts/fixtures/trip_impact_vectors.json；node scripts/verify_trip_impact.mjs）。規則改一邊就要改另一邊。
//
// 三態：hit＝受影響、maybe＝可能受影響、clear＝依公告不受影響。看不懂的一律落 maybe，不能誤判成 clear。
// 規則（契約 native/build/pp3/p4-contract.md 第 2 節，加上契約沒寫明、這裡補的幾條，標「補」）：
//  0. （補）impact 沒有 line 這個 key（不是空字串，是沒有這個 key）＝P4 之前的舊格式整理，整筆跳過，也不算進 show。
//  1. 只看同系統的 impacts（statusIds）。
//  2. 時間：impact [fromAt, untilAt) 跟這段 [上車, 下車] 沒交集＝不適用；空字串（或解析不了）＝不設限。
//  3. 車次被點名：正常＝clear；停駛／部分停駛／減班或改點／未確認＝hit；
//     （補）impact 有站名區間、這段沒碰到＝maybe。（補）有任何一筆點名這段的車次，這段只看點名的那幾筆。
//     （補）有列車次但沒點名這段＝不適用；只有 state 部分停駛又有範圍時照範圍判、最多 maybe。
//  4. 車種（只用在台鐵）：trainClass 對號／非對號而這段不屬於它＝不適用；認不得的車種＝範圍涵蓋時最多 maybe。
//  5. 範圍：line「*」＝涵蓋；有起訖站＝站序區間重疊（只碰到一站不算），沒重疊但這班車的 route 經過＝maybe；
//     只有 line＝整條線；line、站都空＝看不懂＝maybe；站名不在站序資料＝看不懂＝maybe。
//     （補）起訖同一站＝單站事項（暫停停靠、封站）：這段在那站上車或下車才算涵蓋，只是經過不算。
//     捷運只比線名，有站名區間＝maybe（這一版不算捷運站序）；單站而且這段在那站上下車＝涵蓋。
//  6. 涵蓋時：停駛＝hit；其他非正常＝maybe；正常＝clear（拿那筆當依據）。
//  7. 沒有適用的 impact＝clear（沒有依據）。
import lineData from '../data/trip_impact_lines.json' with { type: 'json' };

export const HIT = 'hit', MAYBE = 'maybe', CLEAR = 'clear';
const SEV = { clear: 0, maybe: 1, hit: 2 };
const VERDICT = ['clear', 'maybe', 'hit'];
const NORMAL = '正常', STOPPED = '停駛', PARTIAL = '部分停駛';

// ── 正規化 ────────────────────────────────────────────────
/** 站名：去頭尾空白、「台」→「臺」、去掉「台鐵／高鐵」字首與「火車站／車站／站」字尾。 */
export function normStation(s) {
  let t = String(s ?? '').trim().replaceAll('台', '臺');
  if (t.startsWith('高鐵') || t.startsWith('臺鐵')) t = t.slice(2);
  for (const suf of ['火車站', '車站', '站']) if (t.endsWith(suf) && t.length > suf.length) { t = t.slice(0, -suf.length); break; }
  return t.trim();
}
/** 捷運線名：去掉（…）/(…) 括註、「支線」→「線」（規劃器的「中和新蘆線（迴龍）」「新北投支線」對上公告清單的「中和新蘆線」「新北投線」）。 */
export function normLine(s) {
  return String(s ?? '').trim().replace(/[（(][^）)]*[）)][ 　]*$/, '').replaceAll('支線', '線').trim();
}
/** 車次：去頭尾空白與前導 0。 */
export function normTrain(s) {
  const t = String(s ?? '').trim();
  const u = t.replace(/^0+/, '');
  return u === '' && t !== '' ? '0' : u;
}
/** 車種 → 對號／非對號／null（認不得）。 */
export function trainClassOf(kind) {
  const k = String(kind ?? '').trim();
  if (!k) return null;
  for (const c of ['對號', '非對號']) if (lineData.trainClass[c].some(w => k.includes(w))) return c;
  return null;
}

/** ISO 8601 → epoch 秒；沒寫時區＝+08:00；空字串或解析不了＝null。兩邊同一個寫法（不用 Date.parse：沒時區時它當本機時間）。 */
export function parseIsoSec(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)? ?(Z|[+-]\d{2}:?\d{2})?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  let off = 8 * 3600;
  if (m[7] === 'Z') off = 0;
  else if (m[7]) {
    const z = m[7].replace(':', '');
    const oh = +z.slice(1, 3), om = +z.slice(3, 5);
    if (oh > 14 || om > 59) return null;
    off = (z[0] === '-' ? -1 : 1) * (oh * 3600 + om * 60);
  }
  return daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + se - off;
}
// Howard Hinnant days_from_civil（整數運算，兩邊結果相同）
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// ── 站序圖（台鐵、高鐵各一張）─────────────────────────────
const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
let GRAPHS = null;
function graphs() {
  if (GRAPHS) return GRAPHS;
  GRAPHS = {};
  for (const [sys, lines] of Object.entries(lineData.lines)) {
    const g = { index: new Map(), names: [], adj: [], lines: {}, lineEdges: {}, bypass: (lineData.bypass || {})[sys] || [] };
    const node = n => {
      if (!g.index.has(n)) { g.index.set(n, g.names.length); g.names.push(n); g.adj.push([]); }
      return g.index.get(n);
    };
    for (const [code, sts] of Object.entries(lines)) {
      const names = sts.map(s => normStation(s[0]));
      g.lines[code] = names;
      g.lineEdges[code] = new Set(names.slice(1).map((n, i) => edgeKey(names[i], n)));
      for (let i = 0; i < sts.length; i++) {
        const a = node(names[i]);
        if (i === 0) continue;
        const b = node(names[i - 1]);
        const w = Math.max(1, Math.floor(Math.abs(sts[i][1] - sts[i - 1][1]) * 10 + 0.5));
        const ea = g.adj[a].find(e => e.to === b);
        if (ea) { ea.w = Math.min(ea.w, w); g.adj[b].find(e => e.to === a).w = ea.w; continue; }
        g.adj[a].push({ to: b, w });
        g.adj[b].push({ to: a, w });
      }
    }
    GRAPHS[sys] = g;
  }
  return GRAPHS;
}

/**
 * 最短路（O(V²)：每輪取距離最小、同距離取索引小的；只在嚴格變短時更新），回傳經過的節點索引；到不了＝null。
 * [prefer]＝這條線的邊集合：不在這條線上的邊權重 ×4（給了路線代號的範圍盡量沿那條線走：西部幹線基隆=枋寮
 * 不能因為東部繞過去比較短就走宜蘭線、臺東線）。
 */
function shortest(g, s, t, prefer) {
  const n = g.names.length;
  const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return null;
    if (u === t) break;
    done[u] = true;
    for (const e of g.adj[u]) {
      const w = prefer && !prefer.has(edgeKey(g.names[u], g.names[e.to])) ? e.w * 4 : e.w;
      if (!done[e.to] && dist[u] + w < dist[e.to]) { dist[e.to] = dist[u] + w; prev[e.to] = u; }
    }
  }
  const path = [t];
  while (path[0] !== s) path.unshift(prev[path[0]]);
  return path;
}

/** 依序經過 [stops]（站名，已正規化）的路段：{ edges, nodes }。圖裡沒有的站跳過；起訖不在圖裡或到不了＝null。 */
function pathThrough(g, stops, prefer) {
  const ids = stops.map(s => g.index.get(s)).filter(i => i !== undefined);
  if (ids.length < 1) return null;
  const edges = new Set(), nodes = new Set([g.names[ids[0]]]);
  for (let k = 1; k < ids.length; k++) {
    if (ids[k] === ids[k - 1]) continue;
    const p = shortest(g, ids[k - 1], ids[k], prefer);
    if (!p) return null;
    for (let i = 0; i < p.length; i++) {
      nodes.add(g.names[p[i]]);
      if (i > 0) edges.add(edgeKey(g.names[p[i - 1]], g.names[p[i]]));
    }
  }
  return { edges, nodes };
}

/**
 * 受影響範圍：給的 line 同時含兩站＝那條線的區段；否則最短路（給了認得的 line 就偏好沿那條線走）；
 * 再把兩端都在範圍內的繞行線整條加進來。站名不認得＝null。
 */
function rangeOf(g, line, from, to) {
  if (!g.index.has(from) || !g.index.has(to)) return null;
  const L = g.lines[line];
  let r;
  if (L && L.includes(from) && L.includes(to)) {
    const i = L.indexOf(from), j = L.indexOf(to);
    r = { edges: new Set(), nodes: new Set() };
    for (let k = Math.min(i, j); k <= Math.max(i, j); k++) {
      r.nodes.add(L[k]);
      if (k > Math.min(i, j)) r.edges.add(edgeKey(L[k - 1], L[k]));
    }
  } else {
    r = pathThrough(g, [from, to], g.lineEdges[line]);
    if (!r) return null;
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const code of g.bypass) {
      const B = g.lines[code];
      if (!B || !r.nodes.has(B[0]) || !r.nodes.has(B[B.length - 1])) continue;
      for (let k = 0; k < B.length; k++) {
        r.nodes.add(B[k]);
        if (k > 0 && !r.edges.has(edgeKey(B[k - 1], B[k]))) { r.edges.add(edgeKey(B[k - 1], B[k])); changed = true; }
      }
    }
  }
  return r;
}

function overlaps(p, r) {
  if (r.edges.size) { for (const e of p.edges) if (r.edges.has(e)) return true; return false; }
  for (const n of r.nodes) if (p.nodes.has(n)) return true;
  return false;
}

/** 這段走過的路：有 route（這班車依序停靠站）而且上下車站依序在裡面＝照停靠站走；否則上下車站直接最短路。 */
function legPath(g, leg) {
  const b = normStation(leg.board), a = normStation(leg.alight);
  if (!g.index.has(b) || !g.index.has(a)) return null;
  let stops = [b, a];
  if (Array.isArray(leg.route)) {
    const r = leg.route.map(normStation);
    const bi = r.indexOf(b), ai = bi >= 0 ? r.indexOf(a, bi + 1) : -1;
    if (ai > bi && bi >= 0) stops = r.slice(bi, ai + 1);
  }
  return pathThrough(g, stops);
}
function routePath(g, leg) {
  if (!Array.isArray(leg.route) || leg.route.length < 2) return null;
  return pathThrough(g, leg.route.map(normStation));
}
/** 單站事項：這段在 [st]（已正規化）上車或下車。 */
const endsAt = (leg, st) => normStation(leg.board) === st || normStation(leg.alight) === st;
/** 舊格式整理（P4 之前，沒有 line 這個 key）：比對與 show 都不看。 */
const isOldFormat = imp => !Object.hasOwn(imp, 'line');

// ── 比對 ──────────────────────────────────────────────────
/** 這段要看哪些系統的 impacts（/api/rail-status 的系統 id）。環狀線屬北捷規劃、新北捷運營運，兩邊都看。 */
export function statusIds(leg) {
  const sys = String(leg.system ?? '').trim().toUpperCase();
  if (sys === 'TRTC') return normLine(leg.line) === '環狀線' ? ['trtc', 'ntmetro'] : ['trtc'];
  return sys ? [sys.toLowerCase()] : [];
}

/** 範圍涵蓋：in／partial（捷運站名區間，最多 maybe）／route（只有這班車的全程經過）／unknown（看不懂）／out。 */
function coverage(leg, sysId, imp) {
  const line = String(imp.line ?? '').trim();
  const from = normStation(imp.fromStation), to = normStation(imp.toStation);
  if (line === '*') return 'in';
  const g = graphs()[sysId];
  if (g) {
    if (from && from === to) return !g.index.has(from) ? 'unknown' : endsAt(leg, from) ? 'in' : 'out';
    let r;
    if (from && to) r = rangeOf(g, line, from, to);
    else if (from || to) return 'unknown';
    else if (line) { const L = g.lines[line]; r = L ? rangeOf(g, line, L[0], L[L.length - 1]) : null; }
    else return 'unknown';
    if (!r) return 'unknown';
    const p = legPath(g, leg);
    if (!p) return 'unknown';
    if (overlaps(p, r)) return 'in';
    const rp = routePath(g, leg);
    if (rp && overlaps(rp, r)) return 'route';
    return 'out';
  }
  const legLine = normLine(leg.line);
  if (line) {
    if (!legLine) return 'unknown';
    if (normLine(line) !== legLine) return 'out';
    if (from && from === to && endsAt(leg, from)) return 'in';
    return from || to ? 'partial' : 'in';
  }
  return 'unknown';
}

/** 一筆 impact 對這段：null＝不適用；否則 { sev, named }。 */
function judge(leg, sysId, imp) {
  if (isOldFormat(imp)) return null;
  const state = String(imp.state ?? '').trim();
  const f = parseIsoSec(imp.fromAt), u = parseIsoSec(imp.untilAt);
  if (f !== null && f >= leg.alightAt) return null;
  if (u !== null && u <= leg.boardAt) return null;
  const trains = (Array.isArray(imp.trains) ? imp.trains : []).map(normTrain).filter(Boolean);
  let cap = false;
  if (trains.length) {
    const no = normTrain(leg.train);
    if (no && trains.includes(no)) {
      if (state === NORMAL) return { sev: 0, named: true };
      const g = graphs()[sysId];
      const from = normStation(imp.fromStation), to = normStation(imp.toStation);
      if (g && from && from === to) {
        if (g.index.has(from) && !endsAt(leg, from)) return { sev: 1, named: true };
      } else if (g && from && to) {
        const r = rangeOf(g, String(imp.line ?? '').trim(), from, to);
        const p = r && legPath(g, leg);
        if (r && p && !overlaps(p, r)) return { sev: 1, named: true };
      }
      return { sev: 2, named: true };
    }
    // 列了車次卻沒點名這段：講的是那幾班，不適用。只有「部分停駛」又有範圍時，列出的不一定是全部 ⇒ 照範圍判、最多 maybe。
    const hasRange = String(imp.line ?? '').trim() || String(imp.fromStation ?? '').trim() || String(imp.toStation ?? '').trim();
    if (state !== PARTIAL || !hasRange) return null;
    cap = true;
  }
  if (sysId === 'tra') {
    const c = String(imp.trainClass ?? '').trim();
    if (c === '對號' || c === '非對號') {
      const k = trainClassOf(leg.kind);
      if (k === null) cap = true;
      else if (k !== c) return null;
    }
  }
  const cov = coverage(leg, sysId, imp);
  if (cov === 'out') return null;
  if (state === NORMAL) return cov === 'in' && !cap ? { sev: 0, named: false } : null;
  if (cov === 'in' && state === STOPPED && !cap) return { sev: 2, named: false };
  return { sev: 1, named: false };
}

/** 一段：{ verdict, system, impactIndex }（clear 沒有依據時 system＝null、impactIndex＝-1）。 */
function judgeLeg(leg, systems) {
  const ids = statusIds(leg);
  const cands = [];
  for (const e of systems) {
    if (!e || !ids.includes(e.id)) continue;
    (Array.isArray(e.impacts) ? e.impacts : []).forEach((imp, i) => {
      const r = imp && judge(leg, e.id, imp);
      if (r) cands.push({ ...r, entry: e, index: i });
    });
  }
  const pool = cands.some(c => c.named) ? cands.filter(c => c.named) : cands;
  let best = null;
  for (const c of pool) if (!best || c.sev > best.sev) best = c;
  return best ? { sev: best.sev, entry: best.entry, index: best.index } : { sev: 0, entry: null, index: -1 };
}

/**
 * 整趟判斷。
 * @param legs [{ system, train, kind, line, board, alight, boardAt, alightAt, route? }]（時刻是 epoch 秒）
 * @param systems /api/rail-status 的 systems（或 rail_ai_revisions.systems 的值陣列）
 * @param now epoch 秒（顯示規則用）
 * @returns { verdict, legIndex, system, label, scope, state, untilAt, impactIndex, show, legs: [{ verdict, system, impactIndex }] }
 *   legIndex＝最嚴重的第一段（全部 clear 時取第一個有依據的段，都沒有＝-1）；system…impactIndex＝那段採用的那筆 impact。
 *   show＝行程用到的系統有任何非正常、而且還沒結束（untilAt 空或晚於 now）的 impact（舊格式不算）。
 */
export function tripImpact(legs, systems, now) {
  const sys = Array.isArray(systems) ? systems : [];
  const per = (Array.isArray(legs) ? legs : []).map(l => judgeLeg(l, sys));
  let w = -1;
  per.forEach((p, i) => {
    if (w < 0) { if (p.sev > 0 || p.entry) w = i; return; }
    if (p.sev > per[w].sev) w = i;
  });
  const used = new Set((legs || []).flatMap(statusIds));
  const show = sys.some(e => e && used.has(e.id) && (Array.isArray(e.impacts) ? e.impacts : []).some(imp => {
    if (!imp || isOldFormat(imp) || String(imp.state ?? '').trim() === NORMAL) return false;
    const u = parseIsoSec(imp.untilAt);
    return u === null || u > now;
  }));
  const top = w >= 0 ? per[w] : null;
  const imp = top && top.entry ? top.entry.impacts[top.index] : null;
  return {
    verdict: VERDICT[top ? top.sev : 0],
    legIndex: w,
    system: top && top.entry ? top.entry.id : null,
    label: top && top.entry ? top.entry.label ?? null : null,
    scope: imp ? imp.scope ?? null : null,
    state: imp ? imp.state ?? null : null,
    untilAt: imp ? imp.untilAt ?? null : null,
    impactIndex: top ? top.index : -1,
    show,
    legs: per.map(p => ({ verdict: VERDICT[p.sev], system: p.entry ? p.entry.id : null, impactIndex: p.index })),
  };
}
