// 台鐵「通過不停的列車走正線」的共用判準（現況表 report_tra_pass_main.mjs 與修復器 repair_tra_pass_main.mjs 同一份）。
//
// 通過站次＝某班車在某一站當天官方不停（cells 的 pass、side 'in'、dwells=false；起訖站不算）。
// 走側線＝這班車在這一站的接點（進站段的終點＝出站段的起點）前後兩條軌道邊，任一條帶 service 標記
//（siding 側線、crossover 渡線、yard 站場、spur 支線；正線是 usage=main 或沒有 service）。
// 有正線走法＝J.routeOptions 的可行選項（順向、三個接點能轉、站間不超過基線 5%、不新踏非電化；與待避修復同一組條件）
// 裡，有接點前後兩條邊都不帶 service 的。候選節點另加「正線上的通過點」（passPool）：通過列車不停車，接點只是兩段路徑的
// 分界，不需要月台；只拿派車表派過的節點與停車位置當候選，很多站那個方向沒有任何一個落在正線上。
import fs from 'node:fs';
import { normSta } from './parallel_tracks.mjs';

const SIDE_NEAR_M = 600;

export function makePassMain(S, J) {
  const { g, paths, cells, trainOf, current, nodeAt } = S;
  const tagsOf = eid => g.edges.get(eid)?.tags || {};
  const inEdge = (ids, i) => (i > 0 ? paths[ids[i - 1]].edgeIds.at(-1) : null), outEdge = (ids, i) => (i < ids.length ? paths[ids[i]].edgeIds[0] : null);
  // 接點前後兩條邊的 service 標記（去重）；空陣列＝在正線上
  const sideOf = (ids, i) => [...new Set([inEdge(ids, i), outEdge(ids, i)].filter(Boolean).map(e => tagsOf(e).service).filter(Boolean))];
  // 接點前後 SIDE_NEAR_M 公尺內走過的側線、站場、支線長度（渡線不算：正線之間換線是正常走法）。只當診斷，不當判準。
  function nearSidingM(ids, i) {
    let sum = 0;
    const scan = (pid, fromEnd) => { const p = paths[pid], n = p.edgeIds.length; let left = SIDE_NEAR_M;
      for (let k = 0; k < n && left > 0; k++) { const e = g.edges.get(p.edgeIds[fromEnd ? n - 1 - k : k]), L = Math.min(e.length, left); if (['siding', 'yard', 'spur'].includes(e.tags.service)) sum += L; left -= e.length; } };
    if (i > 0) scan(ids[i - 1], true); if (i < ids.length) scan(ids[i], false);
    return sum;
  }
  // 方向：data/tra.json 同一條線上 d 遞增＝順行（與 track_directions.mjs 的 seedAudit 同一個契約）
  const lines = JSON.parse(fs.readFileSync(new URL('../../data/tra.json', import.meta.url), 'utf8')).lines.map(L => new Map(L.stations.map(s => [normSta(s.name), s.d])));
  const raw = st => st.split(':')[1];
  const traDir = (a, b) => { a = normSta(raw(a)); b = normSta(raw(b)); const m = lines.find(m => m.has(a) && m.has(b)); return m ? Math.sign(m.get(b) - m.get(a)) : 0; };
  const dirName = (key, i) => { const n = trainOf.get(key).names, d = traDir(n[i - 1], n[i]) || traDir(n[i], n[i + 1]); return d > 0 ? '順行' : d < 0 ? '逆行' : '不明'; };

  // 通過站次：key@i → 當天不停的日子。only（日子的 Set）有給就只數那幾天。
  function sites(only = null) {
    const m = new Map();
    for (const [day, byStation] of cells) if (!only || only.has(day)) for (const [st, cell] of byStation) for (const p of cell.pass) {
      if (p.side !== 'in' || p.dwells) continue;
      const last = trainOf.get(p.key).stops.length - 1; if (p.i <= 0 || p.i >= last) continue;
      const id = p.key + '@' + p.i, s = m.get(id) || m.set(id, { id, key: p.key, i: p.i, st, days: [] }).get(id);
      s.days.push(day);
    }
    return [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const mainOptions = (key, i, ids = current.get(key)) => J.routeOptions(key, i, ids).filter(o => !o.current && !sideOf(o.ids2, i).length);
  const isSide = (key, i, ids = current.get(key)) => sideOf(ids, i).length > 0;

  // 官方停靠的站次（key@i，任何一天停就算）：換股會改到停車節點的站，這班車在那一站不得是停靠
  function dwellSites() {
    const out = new Set();
    for (const byStation of cells.values()) for (const cell of byStation.values()) for (const d of cell.dwell) out.add(d.key + '@' + d.i);
    return out;
  }
  function table(only = null) {
    const groups = new Map();
    for (const s of sites(only)) {
      const ids = current.get(s.key), dir = dirName(s.key, s.i), gk = s.st + '|' + dir;
      const r = groups.get(gk) || groups.set(gk, { station: raw(s.st), dir, keys: 0, passRuns: 0, sideKeys: 0, sideRuns: 0, sideKeysWithMain: 0, sideRunsWithMain: 0, kinds: {}, nodes: {}, sample: [] }).get(gk);
      r.keys++; r.passRuns += s.days.length;
      const node = nodeAt(ids, s.i), kinds = sideOf(ids, s.i);
      r.nodes[node] = (r.nodes[node] || 0) + 1;
      if (!kinds.length) continue;
      r.sideKeys++; r.sideRuns += s.days.length;
      for (const k of kinds) r.kinds[k] = (r.kinds[k] || 0) + 1;
      const has = mainOptions(s.key, s.i, ids).length > 0;
      if (has) { r.sideKeysWithMain++; r.sideRunsWithMain += s.days.length; }
      if (r.sample.length < 3) r.sample.push({ no: trainOf.get(s.key).no, key: s.key, i: s.i, node, kinds, nearSidingM: Math.round(nearSidingM(ids, s.i)), mainOption: has });
    }
    return [...groups.values()].sort((a, b) => (a.station + a.dir < b.station + b.dir ? -1 : 1));
  }
  const totals = rows => { const t = { groups: rows.length, sideGroups: 0, sideGroupsWithMain: 0, keys: 0, passRuns: 0, sideKeys: 0, sideRuns: 0, sideKeysWithMain: 0, sideRunsWithMain: 0 };
    for (const r of rows) { for (const k of ['keys', 'passRuns', 'sideKeys', 'sideRuns', 'sideKeysWithMain', 'sideRunsWithMain']) t[k] += r[k]; if (r.sideRuns) t.sideGroups++; if (r.sideRunsWithMain) t.sideGroupsWithMain++; }
    return t; };
  return { sideOf, isSide, nearSidingM, sites, dwellSites, mainOptions, table, totals, dirName };
}
