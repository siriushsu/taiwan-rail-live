// 台鐵同向待避的「各站各方向可待避股道」表 → data/tra_overtake_tracks.json。
// 2026-09-29 使用者裁示「改排到有空股的站」：index.html planSameDirectionOvertakes 選待避站時，待避車那個方向要有一股
// 超越車不走、待避期間也沒有別班佔著；沒有就往回找 25 km 內的前一個候選站，再沒有就不預排。
// 選站在 2D 就要定案（立體地圖非同步載入，也可能根本沒開），所以把立體地圖換股（rail-3d/physical/overtake-sidings.js）
// 找得到的股道離線算好，規劃器只查表：
//   ・候選：派車表裡在這一站通過的每一種進出路徑（待避車原本的股道），再用 overtake-sidings.js 的 reroute 一股一股換
//     （每找到一股就把它的進出路徑加進迴避集合再找下一股；與立體地圖同一支程式、同一套條件）；
//   ・動線：這一站每一種「前站>後站|s／p」（s＝在這一站停靠或起訖，前站／後站空白＝起訖站；p＝通過）派車表用過的
//     每一條路線（進站路徑＋出站路徑）；同一種動線不同班次可能派在不同股道（五堵北上有的走正線、有的走第三股）；
//   ・每個候選記下會擋住它的路線：路線經過候選的停車節點，或壓到候選車身（停車點前後各半列）的邊資源——
//     與 motion.js sidingsFor 避開同站他車的判準相同（它拿的也是他車在這一站的整段進出路徑）。
// 半列長取班表裡最長編組的一半：表對每一種車都成立；短車也許還有別股可停，這裡不算（寧可少排一次待避）。
// 站名鍵與 rail-3d/physical/timing.js 的 stationKey 同一套正規化（派車表寫「台」、班表寫「臺」，還有「-環島」）。
//
// 跑法：node scripts/build_tra_overtake_tracks.mjs；--check 只比對不寫（出貨鏈用）。
// 輸入：rail-3d/physical/network.json、dispatch.json、data/tra.json（站座標）、data/tra_schedule_dense.json（車種）；
// 任一改動後重跑（npm run fetch-schedule 會跑）。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteRuntime } from '../rail-3d/physical/route-runtime.js';
import { createOvertakeSidings } from '../rail-3d/physical/overtake-sidings.js';
import { formationFor } from '../rail-3d/integration/formations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/tra_overtake_tracks.json');
const MAX_ALTERNATIVES = 4;
const read = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const pack = read('rail-3d/physical/network.json'), dispatch = read('rail-3d/physical/dispatch.json');
const norm = n => String(n).replaceAll('臺', '台').replace(/\s*[（(].*?[）)]/g, '').replace(/-環島$/, '').trim();
const geometry = createRouteRuntime(pack, null), sidings = createOvertakeSidings(pack, dispatch, geometry);

const coord = new Map();
for (const line of read('data/tra.json').lines) for (const s of line.stations) if (!coord.has(norm(s.name))) coord.set(norm(s.name), [s.lon, s.lat]);
let half = 0;
for (const t of read('data/tra_schedule_dense.json').trains) {
  const f = formationFor({ systemId: 'tra_sched', carName: t.carName, typeName: t.typeName }, 'actual');
  half = Math.max(half, (f ? f.lengths.reduce((a, b) => a + b, 0) : 240) / 2);
}

const unfolded = new Map(), unfold = id => unfolded.get(id) || unfolded.set(id, geometry.unfold(id)).get(id);
const routeOf = ids => {
  const nodes = new Set(), res = new Set();
  for (const id of ids) if (id != null) { const u = unfold(id); for (const n of u.nodeIds) nodes.add(String(n)); for (const e of u.edges) res.add(e.resource); }
  return { nodes, res };
};
const nodeAt = (ids, k) => (k < ids.length ? pack.paths[ids[k]]?.from : pack.paths[ids[k - 1]]?.to);

// 站 → { routes: [[進站路徑, 出站路徑]], routeIdx: Map, moves: Map(動線鍵 → Set(路線索引)), reps: Map(方向鍵＋路線 → 代表計畫) }
const stations = new Map();
const at = name => stations.get(name) || stations.set(name, { routes: [], routeIdx: new Map(), moves: new Map(), reps: new Map() }).get(name);
for (const [key, plan] of Object.entries(dispatch.plans)) {
  if (!key.startsWith('tra_sched:')) continue;
  let sig; try { sig = JSON.parse(plan.stopSignature); } catch { continue; }
  const ids = plan.pathIds, last = sig.length - 1;
  if (sig.length !== ids.length + 1 || ids.some(id => !pack.paths[id])) continue;
  const names = sig.map(s => norm(s[0].slice(s[0].indexOf(':') + 1)));
  sig.forEach((s, k) => {
    const st = at(names[k]), kind = !k || k === last || s[2] > s[1] ? 's' : 'p';
    const route = [k ? ids[k - 1] : null, k < last ? ids[k] : null], rk = route.join('>');
    let ri = st.routeIdx.get(rk);
    if (ri == null) { ri = st.routes.length; st.routes.push(route); st.routeIdx.set(rk, ri); }
    const mk = (k ? names[k - 1] : '') + '>' + (k < last ? names[k + 1] : '') + '|' + kind;
    (st.moves.get(mk) || st.moves.set(mk, new Set()).get(mk)).add(ri);
    if (kind === 'p' && !st.reps.has(rk)) st.reps.set(rk, { dir: names[k - 1] + '>' + names[k + 1], ids, sig, w: k });
  });
}

// 一個代表計畫在待避站的候選停法：原本的通過股道，加上一股一股換出來的。
function candidatesOf({ ids, sig, w }) {
  const names = sig.map(s => s[0]), last = sig.length - 1;
  const coords = sig.map(s => coord.get(norm(s[0].slice(s[0].indexOf(':') + 1))) || null);
  const fixed = sig.map((s, k) => !k || k === last || s[2] > s[1]);
  const out = [{ node: String(nodeAt(ids, w)), body: new Set(sidings.body(ids[w - 1], ids[w], half)) }];
  const avoid = routeOf([ids[w - 1], ids[w]]);
  for (let n = 0; n < MAX_ALTERNATIVES; n++) {
    const r = sidings.reroute({ ids, names, coords, fixed, w, avoidNodes: avoid.nodes, avoidRes: avoid.res, half });
    if (!r) break;
    out.push({ node: String(r.node), body: new Set(sidings.body(r.ids[w - 1], r.ids[w], half)) });
    const more = routeOf([r.ids[w - 1], r.ids[w]]);
    for (const x of more.nodes) avoid.nodes.add(x); for (const x of more.res) avoid.res.add(x);
  }
  return out;
}

const table = {}, stats = { stations: 0, dirs: 0, withSpare: 0, alternatives: 0 };
for (const [name, st] of [...stations].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))) {
  const occupied = st.routes.map(routeOf), dirs = {};
  for (const rep of st.reps.values()) {
    const list = dirs[rep.dir] || (dirs[rep.dir] = []);
    for (const c of candidatesOf(rep)) {
      const sig = c.node + '|' + [...c.body].sort().join(',');
      if (list.some(x => x.sig === sig)) continue;
      const blockedBy = occupied.flatMap((r, i) => r.nodes.has(c.node) || [...c.body].some(x => r.res.has(x)) ? [i] : []);
      list.push({ sig, blockedBy });
    }
  }
  const out = { moves: {}, dirs: {} };
  for (const [mk, set] of [...st.moves].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))) out.moves[mk] = [...set].sort((a, b) => a - b);
  for (const [dir, list] of Object.entries(dirs).sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))) {
    out.dirs[dir] = list.map(x => x.blockedBy);
    stats.dirs++; stats.alternatives += list.length - 1;
    if (list.length > 1) stats.withSpare++;
  }
  table[name] = out;
  stats.stations++;
}

const body = JSON.stringify({
  version: 1,
  source_notes: '本站自算，無外部上游：由 rail-3d/physical/network.json 與 dispatch.json（派車表各站進出路徑）、'
    + 'rail-3d/physical/overtake-sidings.js（立體地圖待避換股）算出，data/tra.json 供站座標、data/tra_schedule_dense.json 供最長編組。'
    + 'stations[站].moves[前站>後站|s 或 p]＝派車表這種動線在這一站用過的路線（站內編號；s＝停靠或起訖，起訖那一側站名空白，p＝通過）；'
    + 'dirs[前站>後站]＝在這一站通過的車可停的股道，每一股列出會擋住它的路線編號。index.html planSameDirectionOvertakes 選待避站時查它。',
  halfM: +half.toFixed(3),
  stations: table,
}) + '\n';
if (process.argv.includes('--check')) {
  let now = null; try { now = readFileSync(OUT, 'utf8'); } catch {}
  if (now === body) { console.log(`✓ 待避股道表與目前的路網、派車表一致（${stats.stations} 站）`); process.exit(0); }
  console.error('✗ data/tra_overtake_tracks.json 與目前的路網／派車表不符——修法：node scripts/build_tra_overtake_tracks.mjs 後 npm run build-manifest，一起 commit');
  process.exit(1);
}
writeFileSync(OUT, body);
console.log(`待避股道表：${stats.stations} 站、${stats.dirs} 個通過方向，其中 ${stats.withSpare} 個有另一股可停（另外可停 ${stats.alternatives} 股）；半列長 ${half.toFixed(1)} m → ${path.relative(ROOT, OUT)}`);
