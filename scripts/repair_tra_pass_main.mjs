// 台鐵通過列車走正線（F2c）：官方不停、只是通過的站，列車的接點要落在正線上，不走側線。
//
// 為什麼要有這支：CP-SAT 派車的路徑成本只有「靠錯邊」與「渡線數」（build_physical_routes.mjs 的 preference），停靠與通過用同一套，
// 通過列車就跟著停靠列車進側線。F2（repair_physical_stations.mjs）只看 B／C 衝突、F2b（repair_tra_overtake_tracks.mjs）只看
// 時刻表明示的待避對，沒有待避的一般通過車兩支都不會碰（F2b 規格第 2 節把它列為非目標）。
// 2026-11-24 回報：2 次自強通過永康走側線，拉近看像出軌（taiwan-rail-live#123、#124）。
//
// 做法（增量後處理，跟 F2b 同一套模型與接受條件，不從 CP-SAT 重解）：
//   1. 名冊：F2b 的釘版班表 14 天＋9/13 考卷（待避閘門的判準在這份名冊上算），再加磁碟上現行的班表 14 天（使用者今天看到的）。
//   2. 通過站次（scripts/lib/tra_pass_main.mjs）：官方不停的中途站；接點前後兩條軌道邊任一條帶 service 標記就算走側線。
//   3. 每個走側線的通過站次，列舉接點在正線的可行走法（J.routeOptions：順向、三個接點能轉、站間不超過基線 5%、不新踏非電化）。
//      借它切片的車次一起換（X.expand）。接受條件：
//        不碰受保護的東西（見下面「保護」）；節點有變的站，這班車（含跟著換的借用者）在那一站不得是官方停靠；
//        不讓別的通過站次從正線變成走側線；待避對的違規不增加、原本不穿越的待避對不變成穿越；
//        沒有任何一天的 B、C、單線交會共用節點變多。
//      同分依序取：少走側線的天次多、轉角小、路徑短、節點字串小的（結果可重現）。
//      單搬搬不動、原因是正線上停著別班車（通過時刻落在它的停站窗前後 PASS_MARGIN 秒內）時，連那幾班停站車一起換：
//      停站車改停同站別的停車節點（候選與 F2／F2b 相同：派車表派過的節點與路網的停車位置），通過車走正線。接受條件相同。
//      這就是待避：被超越的車進側線、通過車走正線；F2b 只在兩車直彎倒過來時才換，這裡補「幾何分不出、但通過車在側線」的那些。
//   4. 一輪一輪做到沒有可搬的；再從輸出重建名冊重來一遍，直到一整遍 0 次換股。
//   5. 收尾：先寫暫存名，從暫存檔重建模型 R，自檢都在 R 上做；全過才改成正式名。
//
// 保護（比 F2b 窄，理由寫在 passProtection）：0913 驗收的進路（scripts/fixtures/remaining-routes-0913.json）只鎖驗收的那幾站與它前後各一站，
//   不鎖整班車；四份受保護模板、0912 具名修復端點、太麻里非電化月台照舊整個鎖。被搬過的驗收計畫要重釘進 fixture 的 afterPlans
//  （scripts/repin_remaining_routes.mjs），閘門 verify_remaining_station_routes.mjs 的動態判準照舊對新進路驗。
// 借路徑的車次（派車表沒有自己的計畫、借別班路徑的加開車）不直接搬：來源計畫搬了它跟著搬（X.expand），不替它落成自己的計畫。
//   2026-11-24 試過落成：只多 269 天次（全部 41627 的 0.6%），卻多 46 份不可借的計畫，班表每週換、鍵跟著失效；
//   接力借路徑的專車（plan-binding.js）也借不到這些計畫，同一站會變成「落成的走正線、借路徑的走月台線」。
//
// 只用出貨路網已經打包的路徑（預設）：原生 App 把 network.json 的 bytes 釘在好幾處（層位剖面的 inputSha256、股距與待避補足檔記的
//   路網雜湊，路網一換整份不套），派車表可以單獨換、路網不行。所以預設不產新路徑，network.json 逐 byte 不變；
//   要新路徑才上得了正線的站次原因記「要新增路徑」。NEW_PATHS=1 放行新路徑（原生整批換路網基準時用；2026-11-24 試跑多搬 353 次）。
// 原生 App 換過走法的路徑不動（NATIVE_REPLACED）：彰化山線海線共用段、臺東—山里、瑞穗—三民三個雙線區段，派車表把兩個方向派在同一股，
//   網頁的方向模型在這裡不可靠；原生的待避補足檔（native shared/fixtures/tra-yield-tracks/double-track-1027.json，10-27）照靠左行駛
//   把下列路徑的走法換掉、有的連停車節點一起換，前後段是成組接好的。F2c 把這些路徑換成別條（或把別條換成它們），原生那邊就接不上，
//   而且 11-24 試跑時真的把瑞穗、三民的北上通過車搬到東股（靠左行駛的反向）。所以這幾條路徑所在的站間一律不換；
//   等網頁把這三段的方向派股修好、原生拿掉那份補足，這份清單就可以拿掉。
// 站間最長的派車路徑不得變短（pairShrinks）：立體地圖的待避換股（rail-3d/physical/overtake-sidings.js 的 pairMax）與單雙線表的 maxPathM
//   都拿「派車表在這個站間派過的最長路徑」當長度上限。通過車全搬上正線後那條側線路徑沒有計畫在走，上限短個 0.2 m，側線就被上限擋掉：
//   2026-11-24 第一版讓待避股道表在龍井南下、林鳳營北上各少一股可停，加開的 6629 在龍井等 2608 的單線交會停站排不進去
//   （11-27、11-28、12-04、12-06 各少兩筆預排）。所以每個站間最長的那條路徑至少留一份計畫在走，會把最後一份搬走的換股不收。
// 平行股道的站間不換（PARALLEL_PAIRS）：大武—枋野之間約 17 km 是兩條平行股道（安朔隧道一帶，間距 4–5 m），派車表兩條都有派。
//   NEW_PATHS=1 替新正線節點只產最短的那一條路，兩個方向都落在同一條；網頁的衝突模型不看雙線區段裡的方向（同上面 NATIVE_REPLACED），
//   擋不到。原生 App 的完整待避規劃器原本靠把車換到另一條平行股道錯開對向的車，2026-11-25 第二輪放行新路徑後換不了：
//   11-15 排不開的班 93 → 106，多出的全在這一段（native docs/m9/lanes/pass-main-2-1125-handoff.md）。11-25 決定這一輪枋野不搬。
//   等 F2c 產新路徑時把平行股道的另一條也補上，這一條就可以拿掉。
// 除了上面 NATIVE_REPLACED、PARALLEL_PAIRS 兩份清單，哪一站搬得動由路網與衝突模型決定；搬不動的逐站次列原因在 report.json。
// 不做的事：不改時刻、不加 hold、不造新股道、不改既有計畫的 stopSignature 與 holds；停靠的站不動。
// 產物：OUT_DIR（預設 output/pass-main/）的 network.json、dispatch.json、report.json。
// 順序：F1 → F2 → F2b → **F2c（這支）** → 再跑一輪 F2b（通過車換股後待避對的可行修法會變）→ 下游同 repair_physical_stations.mjs 檔頭。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStationConflictModel, MAX_PAIR_STRETCH, PASS_MARGIN } from './lib/tra_station_conflicts.mjs';
import { BASE_REF, SCHEDULE_REF, EXAM_REF, EXAM_DATE, loadOvertakeInputs, makeOvertakeJudge, findOvertakePairs, makeProtection, makeOvertakeSolver, makeMeetCounter } from './lib/tra_overtake_pairs.mjs';
import { makePassMain } from './lib/tra_pass_main.mjs';
import { stationKey } from '../rail-3d/physical/timing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || 'output/pass-main'), MAX_PASSES = 5, MAX_ROUNDS = 20;
const tStart = Date.now(), secsSince = t => +((Date.now() - t) / 1000).toFixed(1);
const ALLOW_NEW_PATHS = process.env.NEW_PATHS === '1';
const NETWORK_IN = process.env.NETWORK || 'rail-3d/physical/network.json', DISPATCH_IN = process.env.DISPATCH || 'rail-3d/physical/dispatch.json';
console.log(`輸入 network ${path.resolve(ROOT, NETWORK_IN)}\n輸入 dispatch ${path.resolve(ROOT, DISPATCH_IN)}\n輸出 ${OUT_DIR}`);
const I = loadOvertakeInputs({ scheduleRef: SCHEDULE_REF, withExam: true, network: NETWORK_IN, dispatch: DISPATCH_IN });
// 現行班表（磁碟上的 data/tra_schedule_dense.json，時刻同樣跑 computeProfiles）：每一天當成一個額外的日子進名冊
const C = loadOvertakeInputs({ scheduleRef: null, withExam: false, network: NETWORK_IN, dispatch: DISPATCH_IN });
const currentDays = Object.keys(C.sched.dates).sort(), currentSet = new Set(currentDays), pinnedSet = new Set([...Object.keys(I.sched.dates), ...I.extraDays.map(x => x.day)]);
for (const d of currentDays) assert.ok(!pinnedSet.has(d), '現行班表的日子與釘版名冊重疊 ' + d);
const extraDays = [...I.extraDays, ...currentDays.map(day => ({ day, sched: C.sched, timed: C.timed }))];

const outPath = n => path.join(OUT_DIR, n);
const netFile = outPath('network.json'), dispatchFile = outPath('dispatch.json'), reportFile = outPath('report.json');
const netTmp = outPath('network.unverified.json'), dispatchTmp = outPath('dispatch.unverified.json');
const sameFile = (a, b) => { try { const x = fs.statSync(a), y = fs.statSync(b); return x.dev === y.dev && x.ino === y.ino; } catch { return false; } };
for (const out of [netFile, dispatchFile, netTmp, dispatchTmp]) for (const inp of [I.files.network, I.files.dispatch])
  assert.ok(path.resolve(out) !== inp && !sameFile(out, inp), `輸出檔 ${out} 與輸入檔 ${inp} 是同一個檔；請把 OUT_DIR 換成輸入檔以外的位置`);
for (const f of [netFile, dispatchFile, reportFile, netTmp, dispatchTmp]) fs.rmSync(f, { force: true });

const dispatch = I.dispatch, original = structuredClone(dispatch.plans), protectedPlanKeys = new Set(Object.keys(I.protectedPlans));
const report = { params: { BASE_REF, SCHEDULE_REF, EXAM_REF, EXAM_DATE, MAX_PASSES, MAX_ROUNDS, MAX_PAIR_STRETCH, currentDays }, passes: [], moves: [], materialised: 0, pinnedRelays: [] };
const perDay = list => { const out = {}; for (const c of list) { const d = out[c.day] || (out[c.day] = { B: 0, C: 0 }); d[c.type]++; } return out; };
// ── 保護 ──
// F2b 把 0913 驗收進路的車次整班鎖住（makeProtection 的 lockedKeys）。那份驗收驗的是 changes 列的那幾站（一班一到數站的站內股道），
// 整班鎖只是保守；2 次自強（issue #123／#124 回報的那一班）就在名單裡，驗收站是太原，離永康 200 多公里。
// 這裡改成只鎖驗收的站與它前後各一站（搬第 j 站會換掉第 j−1、j 兩段路徑，前後站的節點不變但進出段會變，所以驗收站的鄰站也不搬）：
//   驗收站＝fixture.changes 裡同一把計畫鍵的 station（「甲—乙」「甲→乙」是站間，兩端都算）。
//   借驗收計畫切片的車次（改點版、借路徑）跟著來源的驗收站算。
//   四份受保護模板（protectedTemplates，fixture 的恆等式 beforePlans===afterPlans＝這批不動）仍然整班鎖。
const proof = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'scripts/fixtures/remaining-routes-0913.json'), 'utf8'));
const templateKeys = new Set(proof.protectedTemplates), guardedOf = new Map();
for (const c of proof.changes) { const set = guardedOf.get(c.key) || guardedOf.set(c.key, new Set()).get(c.key); for (const n of c.station.split(/[—→]/)) set.add(stationKey('tra_sched', n)); }
for (const k of Object.keys(I.protectedPlans)) assert.ok(templateKeys.has(k) || guardedOf.has(k), '驗收進路沒有對應的驗收站 ' + k);
function passProtection(S, base) {
  const sourcesOf = key => { const rec = S.trainOf.get(key); return [...new Set([key, rec.sourceKey, ...(rec.sourceKeys || []), ...(S.plans[rec.sourceKey ?? key]?.relaySources || [])].filter(Boolean))]; };
  const isProtected = (key, j, fromNode, toNode) => {
    const rec = S.trainOf.get(key);
    if (base.lockedStops.has(rec.no + '@' + rec.names[j])) return '具名修復端點';
    if (base.lockedNodes.has(String(fromNode)) || base.lockedNodes.has(String(toNode))) return '太麻里非電化月台';
    if (!base.lockedKeys.has(key)) return null;
    const src = sourcesOf(key);
    if (src.some(k => templateKeys.has(k))) return '受保護模板';
    const guarded = src.filter(k => guardedOf.has(k));
    if (!guarded.length) return '已驗收進路（對不回驗收站）';
    for (const k of guarded) for (const n of [rec.names[j - 1], rec.names[j], rec.names[j + 1]]) if (n && guardedOf.get(k).has(n)) return '已驗收進路的驗收站或鄰站';
    return null;
  };
  return Object.assign(isProtected, base);
}
const build = (net, disp, rep) => {
  const S = createStationConflictModel({ net, dispatch: disp, sched: I.sched, timed: I.timed, protectedPlanKeys, report: rep, stats: {}, roster: 'f2b', base: I.base, extraDays });
  S.buildBorrowerIndex();
  assert.equal(S.rosterStats.skippedLength, 0, '名冊有車次因站數不符被略過');
  // 釘版名冊不得有跨日對不上的（與 F2b、閘門 G0 同一條）；現行班表的日子對不上的那一班那一天不進 cells，只記數
  const bad = S.rosterStats.misaligned.filter(m => !currentSet.has(m.day));
  assert.equal(bad.length, 0, '釘版名冊有車次跨日對不上：' + JSON.stringify(bad.slice(0, 3)));
  assert.equal(S.rosterStats.unlinked, 0, '有借用切片對不回來源');
  const J = makeOvertakeJudge(S), { pairs } = findOvertakePairs(S), meets = makeMeetCounter(S, I.sections), prot = passProtection(S, makeProtection(S, I));
  const X = makeOvertakeSolver(S, J, { pairs, isProtected: prot, meets }), P = makePassMain(S, J);
  const sites = P.sites(), byKey = new Map();
  for (const s of sites) (byKey.get(s.key) || byKey.set(s.key, []).get(s.key)).push(s);
  return { S, J, pairs, meets, prot, X, P, sites, byKey, dwell: P.dwellSites() };
};
const rosterWrong = S => { const m = new Map(); for (const [key, ids] of S.current) { const n = ids.filter(pid => S.paths[pid] && S.M.wrongOn(S.paths[pid], S.clean).length).length; if (n) m.set(key, n); } return m; };
const sumOf = m => [...m.values()].reduce((a, b) => a + b, 0);
const looseKey = (type, st, q, p) => [type, st, q, p].join('|');

// 搬不動的原因（每個正線走法各記一個；一個站次的原因＝它所有走法的原因去重後排序相接）
const NATIVE_REPLACED = new Set([319, 320, 327, 4622, 20279, 20782, 20783, 20784, 1795, 1797, 20788, 20789, 20791, 20792, 3533, 3548, 3990, 3992, 3998, 4004, 4015, 21009]);
// all 裡有沒有哪一段把 NATIVE_REPLACED 的路徑換掉或換進來
const nativeHit = (S, all) => { for (const [k, ids2] of all) { const c0 = S.current.get(k); for (let j = 0; j < ids2.length; j++) if (c0[j] !== ids2[j] && (NATIVE_REPLACED.has(+c0[j]) || NATIVE_REPLACED.has(+ids2[j]))) return true; } return false; };
// 站間（兩端站名鍵排序相接，與 overtake-sidings.js 的 pairMax 同一把鍵）→ Map(路徑 → 走它的計畫數)；extLen＝待避側線延伸路徑（不靠計畫也算數）
const pairKey = (a, b) => [a, b].sort().join('|'), sigCache = new Map(), extLen = new Map();
for (const e of I.net.extensions || []) for (const [id, pair] of Object.entries(e.overtakePaths || {})) { const p = I.net.paths[id], k = pairKey(...pair.map(n => 'tra_sched:' + n)); if (p) extLen.set(k, Math.max(extLen.get(k) || 0, p.lengthM)); }
const planNames = (key, plan) => { let n = sigCache.get(key); if (n === undefined) { try { n = JSON.parse(plan.stopSignature).map(x => x[0]); } catch { n = null; } sigCache.set(key, n); } return n && n.length === plan.pathIds.length + 1 ? n : null; };
function pairUse(plans) {
  const use = new Map();
  for (const [key, plan] of Object.entries(plans)) { if (!key.startsWith('tra_sched:')) continue; const n = planNames(key, plan); if (!n) continue;
    plan.pathIds.forEach((id, j) => { const k = pairKey(n[j], n[j + 1]), m = use.get(k) || use.set(k, new Map()).get(k); m.set(id, (m.get(id) || 0) + 1); }); }
  return use;
}
const pairMaxOf = (paths, k, m) => { let L = extLen.get(k) || 0; for (const [id, n] of m || []) if (n > 0) L = Math.max(L, paths[id]?.lengthM ?? 0); return L; };
// all 裡有沒有哪一段換了 PARALLEL_PAIRS 站間的路徑（借路徑的車次跟著來源計畫換，來源計畫也在 all 裡）
const PARALLEL_PAIRS = new Set([pairKey('tra_sched:大武', 'tra_sched:枋野')]);
const parallelHit = (S, all) => { for (const [k, ids2] of all) { if (S.borrowed.has(k)) continue; const n = planNames(k, S.plans[k]); if (!n) continue; const c0 = S.current.get(k);
  for (let j = 0; j < ids2.length; j++) if (c0[j] !== ids2[j] && PARALLEL_PAIRS.has(pairKey(n[j], n[j + 1]))) return true; } return false; };
// all 套用後有沒有哪個站間的最長派車路徑變短（借路徑的車次沒有自己的計畫，不算）
const pairShrinks = (cur, all) => {
  const { S } = cur, use = cur.use || (cur.use = pairUse(S.plans)), touched = new Map();
  for (const [k, ids2] of all) { if (S.borrowed.has(k)) continue; const n = planNames(k, S.plans[k]); if (!n) continue; const c0 = S.current.get(k);
    for (let j = 0; j < ids2.length; j++) if (c0[j] !== ids2[j]) { const pk = pairKey(n[j], n[j + 1]), d = touched.get(pk) || touched.set(pk, new Map(use.get(pk))).get(pk); d.set(c0[j], (d.get(c0[j]) || 0) - 1); d.set(ids2[j], (d.get(ids2[j]) || 0) + 1); } }
  for (const [pk, d] of touched) if (pairMaxOf(S.paths, pk, d) < pairMaxOf(S.paths, pk, use.get(pk)) - 1e-9) return true;
  return false;
};
const packedIds = new Set(Object.keys(I.net.paths)), packedOK = o => ALLOW_NEW_PATHS || o.ids2.every(id => packedIds.has(String(id)));
const R = { NO_MAIN: '沒有可行的正線走法', NEW_PATH: '正線走法要新增路徑（路網檔不動，見檔頭）', NATIVE: '站間路徑在原生 App 換過走法（雙線方向派股，見檔頭）', PARALLEL: '站間是兩條平行股道、新路徑只走其中一條（大武—枋野，見檔頭）', PAIRMAX: '是這個站間最長路徑的最後一份計畫（待避換股的長度上限照它算，見檔頭）', PROTECTED: '受保護', OLD_BORROWER: '借路徑的車次（跟著來源計畫走，不另外落成）', NONELEC: '引入新非電化股道', DWELL: '這班或借它路徑的車在這站官方停靠', NEWSIDE: '會讓別的通過站次改走側線',
  JOINT: '連停站車一起換仍', JOINT_MANY: '正線上同時停著的車太多', JOINT_NO_ALT: '正線上的停站車沒有別的停車節點可換',
  VIOL: '會增加待避違規', BC: '會增加 B 或 C', MEET: '會增加單線交會共用節點', SHARED: '會讓待避對變成穿越' };
const rank = (a, b) => b.gain - a.gain || a.moved - b.moved || a.turn - b.turn || a.o.lengthM - b.o.lengthM || (a.o.m < b.o.m ? -1 : a.o.m > b.o.m ? 1 : 0)
  || (a.lengthQ || 0) - (b.lengthQ || 0) || ((a.nodesQ || '') < (b.nodesQ || '') ? -1 : (a.nodesQ || '') > (b.nodesQ || '') ? 1 : 0);
// all（含跟著換的借用者）裡：節點有變的站是官方停靠的站次（dw）、通過站次的側線增減（gain／newSide）。
// allowDwell(k, j)＝這一班在這一站換停車節點是這次換股的本意（一起換的停站車與借它切片的車次，只限這一站）。
function effects(cur, all, allowDwell = null) {
  const { S, P, byKey, dwell } = cur; let dw = false, gain = 0, newSide = 0; const dwellMoved = [];
  for (const [k, ids2] of all) {
    const c0 = S.current.get(k);
    for (let j = 0; j <= ids2.length; j++) if (S.nodeAt(c0, j) !== S.nodeAt(ids2, j) && dwell.has(k + '@' + j)) { if (allowDwell?.(k, j)) dwellMoved.push(k + '@' + j); else dw = true; }
    for (const t of byKey.get(k) || []) { const a = P.sideOf(c0, t.i).length > 0, b = P.sideOf(ids2, t.i).length > 0; if (a && !b) gain += t.days.length; else if (!a && b) newSide += t.days.length; }
  }
  return { dw, gain, newSide, dwellMoved };
}
const liveOK = (S, key) => !S.borrowed.has(key);
const MAX_JOINT_Q = 3, MAX_JOINT_COMBOS = 200;
function tryMove(cur, s) {
  const { S, J, X, P } = cur, ids = S.current.get(s.key), every = P.mainOptions(s.key, s.i, ids), opts = every.filter(packedOK);
  if (!every.length) return { reason: R.NO_MAIN };
  if (!opts.length) return { reason: R.NEW_PATH };
  if (!liveOK(S, s.key)) return { reason: R.OLD_BORROWER };
  let best = null; const why = new Set(), retry = [];
  const accept = (direct, all, fx, o, extra = {}) => {
    const ev = X.evaluate(direct);
    if (ev.dViol > 0) return R.VIOL; if (ev.worse.length) return R.BC; if (ev.worseMeet.length) return R.MEET; if (ev.worseShared.length) return R.SHARED;
    const cand = { s, o, direct, ev, gain: fx.gain, moved: direct.size, dwellMoved: fx.dwellMoved, turn: J.turnOf(o.ids2, s.i), ...extra };
    if (!best || rank(cand, best) < 0) best = cand;
    return null;
  };
  for (const o of opts) {
    const direct = new Map([[s.key, o.ids2]]), all = X.expand(direct), blk = X.blockedBy(all);
    if (blk) { why.add(blk.kind === 'protected' ? R.PROTECTED + '：' + blk.why : R.NONELEC); continue; }
    if (nativeHit(S, all)) { why.add(R.NATIVE); continue; }
    if (parallelHit(S, all)) { why.add(R.PARALLEL); continue; }
    if (pairShrinks(cur, all)) { why.add(R.PAIRMAX); continue; }
    const fx = effects(cur, all);
    if (fx.dw) { why.add(R.DWELL); continue; }
    if (fx.newSide) { why.add(R.NEWSIDE); continue; }
    const bad = accept(direct, all, fx, o);
    if (bad) { why.add(bad); if (bad !== R.MEET) retry.push({ o, direct, all }); }
  }
  if (best) return { best };
  // 連停在正線上的停站車一起換
  for (const { o, direct: pDirect, all: pAll } of retry) {
    const pNodes = new Set([...S.nodeSet(o.ids2[s.i - 1]), ...S.nodeSet(o.ids2[s.i])]), qs = new Map();
    for (const day of s.days) { const cell = S.cells.get(day)?.get(s.st), p = cell?.pass.find(p => p.key === s.key && p.i === s.i && p.side === 'in'); if (!p) continue;
      for (const d of cell.dwell) if (d.key !== s.key && !pAll.has(d.key) && p.t >= d.a - PASS_MARGIN && p.t <= d.b + PASS_MARGIN && pNodes.has(S.nodeAt(S.current.get(d.key), d.i))) qs.set(d.key + '@' + d.i, { key: d.key, i: d.i }); }
    if (!qs.size) continue;
    if (qs.size > MAX_JOINT_Q || new Set([...qs.values()].map(q => q.key)).size !== qs.size) { why.add(R.JOINT_MANY); continue; }
    const lists = [...qs.values()].map(q => (liveOK(S, q.key) ? J.routeOptions(q.key, q.i, S.current.get(q.key)).filter(x => !x.current && !pNodes.has(x.m) && packedOK(x)).map(x => ({ q, x })) : []));
    if (lists.some(l => !l.length)) { why.add(R.JOINT_NO_ALT); continue; }
    let combos = [[]]; for (const l of lists) { combos = combos.flatMap(c => l.map(e => [...c, e])); if (combos.length > MAX_JOINT_COMBOS) break; }
    if (combos.length > MAX_JOINT_COMBOS) { why.add(R.JOINT_MANY); continue; }
    for (const combo of combos) {
      const direct = new Map(pDirect); for (const { q, x } of combo) direct.set(q.key, x.ids2);
      const all = X.expand(direct), blk = X.blockedBy(all);
      if (blk) { why.add(R.JOINT + (blk.kind === 'protected' ? R.PROTECTED + '：' + blk.why : R.NONELEC)); continue; }
      if (nativeHit(S, all)) { why.add(R.JOINT + R.NATIVE); continue; }
      if (parallelHit(S, all)) { why.add(R.JOINT + R.PARALLEL); continue; }
      if (pairShrinks(cur, all)) { why.add(R.JOINT + R.PAIRMAX); continue; }
      const fx = effects(cur, all, (k, j) => !pAll.has(k) && S.trainOf.get(k).names[j] === s.st);
      if (fx.dw) { why.add(R.JOINT + R.DWELL); continue; }
      if (fx.newSide) { why.add(R.JOINT + R.NEWSIDE); continue; }
      const bad = accept(direct, all, fx, o, { lengthQ: combo.reduce((n, e) => n + e.x.lengthM, 0), nodesQ: combo.map(e => e.x.m).join('|'),
        withQ: combo.map(({ q, x }) => ({ key: q.key, i: q.i, no: S.trainOf.get(q.key).no, from: S.nodeAt(S.current.get(q.key), q.i), to: x.m })) });
      if (bad) why.add(R.JOINT + bad);
    }
  }
  return best ? { best } : { reason: [...why].sort().join('／') };
}
const sideSummary = cur => { const all = cur.P.totals(cur.P.table()), now = cur.P.totals(cur.P.table(currentSet)), pin = cur.P.totals(cur.P.table(pinnedSet)); return { all, current: now, pinned: pin }; };

const usedNew = new Map();
let net = I.net, cur, first = null, firstPlanIds = null, firstPairs = null, firstWrong = null, firstTable = null;
for (let pass = 1; pass <= MAX_PASSES; pass++) {
  const tPass = Date.now();
  cur = null; cur = build(net, dispatch, report);
  const buildSecs = secsSince(tPass), { S, X, P } = cur;
  if (!first) {
    firstWrong = rosterWrong(S);
    first = { side: sideSummary(cur), violations: X.violations(), byType: X.violationsByType(), conflicts: perDay(S.allConflicts()), meets: cur.meets.perDay(), wrong: sumOf(firstWrong), rosterStats: { ...S.rosterStats, misaligned: S.rosterStats.misaligned.slice(0, 20) } };
    firstTable = { current: P.table(currentSet), pinned: P.table(pinnedSet) };
    firstPlanIds = new Map([...S.current].map(([k, ids]) => [k, ids.slice()]));
    firstPairs = cur.pairs.map(c => ({ id: c.id, loose: looseKey(c.type, c.st, c.q.key, c.p.key), shared: X.state(c).kind === 'shared' }));
    console.log(`名冊 ${S.rosterStats.keys} 個車次鍵；通過站次 ${first.side.all.keys} 個（${first.side.all.passRuns} 天次），走側線 ${first.side.all.sideKeys} 個（${first.side.all.sideRuns} 天次）`);
  }
  const rec = { pass, buildSecs, rounds: [] };
  // 自己有計畫的先搬（借它切片的車次會跟著換）；借路徑的車次還留在側線的最後才直接搬（落成自己的計畫）
  const order = cur.sites.slice().sort((a, b) => (S.borrowed.has(a.key) ? 1 : 0) - (S.borrowed.has(b.key) ? 1 : 0) || b.days.length - a.days.length || (a.id < b.id ? -1 : 1));
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const tRound = Date.now(); let moved = 0;
    for (const s of order) {
      if (!P.isSide(s.key, s.i)) continue;
      const { best } = tryMove(cur, s); if (!best) continue;
      const changes = [...best.ev.all].map(([key, ids2]) => { const c0 = S.current.get(key), diff = []; ids2.forEach((p, k) => { if (p !== c0[k]) diff.push([k, c0[k], p]); });
        return { key, direct: best.direct.has(key), materialise: best.direct.has(key) && S.borrowed.has(key), diff }; });
      report.moves.push({ pass, round, station: s.st, key: s.key, i: s.i, no: S.trainOf.get(s.key).no, days: s.days.length, from: S.nodeAt(S.current.get(s.key), s.i), to: best.o.m, gain: best.gain, dViol: best.ev.dViol, withQ: best.withQ || [], dwellMoved: best.dwellMoved, changes });
      X.apply({ ver: X.version(), all: best.ev.all, direct: best.direct }); cur.use = null; moved++;
    }
    rec.rounds.push({ round, moved, secs: secsSince(tRound) });
    console.log(`第 ${pass} 遍第 ${round} 輪：換股 ${moved} 次（${secsSince(tRound)} 秒），走側線剩 ${P.totals(P.table()).sideRuns} 天次`);
    if (!moved) break;
    assert.ok(round < MAX_ROUNDS, `第 ${pass} 遍 ${MAX_ROUNDS} 輪仍在換股`);
  }
  rec.moves = rec.rounds.reduce((n, r) => n + r.moved, 0); rec.secs = secsSince(tPass); report.passes.push(rec);
  for (const [id, p] of Object.entries(S.newPaths)) usedNew.set(+id, p);
  net = { ...I.net, paths: { ...I.net.paths, ...Object.fromEntries(usedNew) } };
  if (!rec.moves) break;
  assert.ok(pass < MAX_PASSES, `${MAX_PASSES} 遍仍有換股，沒有收斂`);
}
const { S, X, meets } = cur;

// ── 寫檔前自檢（記憶體模型）──
const finalViolations = X.violations(), finalConf = perDay(S.allConflicts()), finalMeets = meets.perDay();
for (const day of new Set([...Object.keys(first.conflicts), ...Object.keys(finalConf)])) for (const t of ['B', 'C'])
  assert.ok((finalConf[day]?.[t] || 0) <= (first.conflicts[day]?.[t] || 0), `${day} 的 ${t} 從 ${first.conflicts[day]?.[t] || 0} 變成 ${finalConf[day]?.[t] || 0}`);
for (const day of Object.keys(finalMeets)) assert.ok(finalMeets[day] <= (first.meets[day] || 0), `${day} 的單線交會共用節點從 ${first.meets[day] || 0} 變成 ${finalMeets[day]}`);
assert.ok(finalViolations <= first.violations, `待避違規從 ${first.violations} 變成 ${finalViolations}`);
const repinned = [];
for (const [key, plan] of Object.entries(I.protectedPlans)) {
  const now = dispatch.plans[key];
  if (templateKeys.has(key)) { assert.deepEqual(now, plan, '重寫受保護模板 ' + key); continue; }
  const { pathIds: a, ...restA } = plan, { pathIds: b, ...restB } = now, names = JSON.parse(plan.stopSignature).map(x => x[0]), guard = guardedOf.get(key);
  assert.deepEqual(restB, restA, key + ' 除了 pathIds 以外的欄位被改了'); assert.equal(b.length, a.length);
  names.forEach((n, j) => { if (!guard.has(n)) return; for (const k of [j - 1, j]) if (k >= 0 && k < a.length) assert.equal(b[k], a[k], `${key} 驗收站 ${n} 前後的路徑被改了（第 ${k} 段）`); });
  if (a.some((p, k) => p !== b[k])) repinned.push(key);
}
for (const [key, plan] of Object.entries(original)) {
  const now = dispatch.plans[key]; assert.ok(now, '計畫不見了 ' + key);
  const { pathIds: a, ...restA } = plan, { pathIds: b, ...restB } = now;
  assert.deepEqual(restB, restA, key + ' 除了 pathIds 以外的欄位被改了（stopSignature／holds 不得改）');
  if (!key.startsWith('tra_sched:')) assert.deepEqual(b, a, key + ' 不是台鐵卻被改了');
}
for (const [key, ids] of S.current) {
  const t = S.trainOf.get(key), allowed = S.initialNonElectric.get(key) || new Set();
  assert.equal(ids.length, t.stops.length - 1, key + ' 段數不對');
  for (const pid of ids) for (const wid of S.nonElectricWays(pid)) assert.ok(allowed.has(wid), key + ' 引入新的非電化股道 ' + wid);
  ids.forEach((pid, i) => { const limit = S.basePairMax.get(t.names[i] + '>' + t.names[i + 1]);
    if (limit) assert.ok(S.paths[pid].lengthM <= limit * MAX_PAIR_STRETCH + 1e-6, `${key} ${t.names[i]}→${t.names[i + 1]} 把站間拉長 ${S.paths[pid].lengthM}/${limit}`); });
  for (let i = 1; i < ids.length; i++) { assert.equal(S.paths[ids[i - 1]].to, S.paths[ids[i]].from, key + ' 第 ' + i + ' 段不相接'); assert.ok(S.turnOK(ids[i - 1], ids[i]), key + ' 第 ' + i + ' 站進出段接不上'); }
  if (!S.borrowed.has(key)) assert.strictEqual(dispatch.plans[key].pathIds, ids, key + ' 計畫與名冊脫鉤');
}

// ── 寫檔：路網只帶派車表用到的新路徑 ──
const referenced = new Set(Object.values(dispatch.plans).flatMap(p => p.pathIds));
const keep = [...usedNew.keys()].filter(id => referenced.has(id)).sort((a, b) => a - b);
const outNet = { ...I.net, paths: { ...I.net.paths, ...Object.fromEntries(keep.map(id => [id, usedNew.get(id)])) } };
for (const id of referenced) assert.ok(outNet.paths[id], '派車表用到路網沒有的路徑 ' + id);
fs.mkdirSync(OUT_DIR, { recursive: true });
if (!ALLOW_NEW_PATHS) assert.equal(keep.length, 0, '預設不產新路徑，卻用到了 ' + keep.join(','));
// 沒有新路徑就原檔照抄：network.json 逐 byte 不變（重新序列化不保證）
if (keep.length) fs.writeFileSync(netTmp, JSON.stringify(outNet)); else fs.copyFileSync(I.files.network, netTmp);
fs.writeFileSync(dispatchTmp, JSON.stringify(dispatch));

// ── 從暫存檔重建模型 R，之後的自檢都在 R 上做 ──
const writtenNet = JSON.parse(fs.readFileSync(netTmp, 'utf8'));
assert.equal(JSON.stringify(writtenNet.ways), JSON.stringify(JSON.parse(fs.readFileSync(I.files.network, 'utf8')).ways), 'ways 被改了');
const Rm = build(writtenNet, JSON.parse(fs.readFileSync(dispatchTmp, 'utf8')), { materialised: 0 }), RS = Rm.S, RX = Rm.X;
assert.equal(RX.violations(), finalViolations, '從輸出重建的待避違規數跟記憶體模型不同');
assert.deepEqual(perDay(RS.allConflicts()), finalConf, '從輸出重建的 B／C 跟記憶體模型不同');
assert.deepEqual(Rm.meets.perDay(), finalMeets, '從輸出重建的單線交會跟記憶體模型不同');
// 不准新造穿越（逐對；id 對不上的退回站＋型別＋Q 車次鍵＋P 車次鍵），也不准待避對不見
const finalById = new Map(Rm.pairs.map(c => [c.id, c])), finalByLoose = new Map();
for (const c of Rm.pairs) { const k = looseKey(c.type, c.st, c.q.key, c.p.key); (finalByLoose.get(k) || finalByLoose.set(k, []).get(k)).push(c); }
const crossing = [], vanished = [];
for (const f of firstPairs) { if (f.shared) continue; const hit = finalById.get(f.id), hits = hit ? [hit] : finalByLoose.get(f.loose) || [];
  if (!hits.length) vanished.push(f.id); for (const c of hits) if (RX.state(c).kind === 'shared') crossing.push(c.id); }
const firstIds = new Set(firstPairs.map(f => f.id)), firstLoose = new Set(firstPairs.map(f => f.loose));
const appearedShared = Rm.pairs.filter(c => !firstIds.has(c.id) && !firstLoose.has(looseKey(c.type, c.st, c.q.key, c.p.key)) && RX.state(c).kind === 'shared').map(c => c.id);
assert.equal(crossing.length, 0, '新造穿越：' + JSON.stringify(crossing.slice(0, 10)));
assert.equal(appearedShared.length, 0, '收尾才出現、而且穿越的待避對：' + JSON.stringify(appearedShared.slice(0, 10)));
assert.equal(vanished.length, 0, '第一遍有、收尾找不到的待避對：' + JSON.stringify(vanished.slice(0, 10)));
// 逐班方向：沒有任何一班的逆向段變多
const wrongNow = rosterWrong(RS), wrongWorse = [...wrongNow].filter(([k, n]) => n > (firstWrong.get(k) || 0));
assert.equal(wrongWorse.length, 0, `有 ${wrongWorse.length} 班的逆向段變多：` + wrongWorse.slice(0, 10).map(([k, n]) => `${k} ${firstWrong.get(k) || 0} → ${n}`).join('；'));
// 名冊車次鍵不得消失；沒被換股的車次綁定不得漂移；節點有變的站不得碰保護、不得是官方停靠
const movedKeys = new Set(report.moves.flatMap(m => m.changes.filter(ch => ch.diff.length).map(ch => ch.key)));
const lostKeys = [...firstPlanIds.keys()].filter(k => !RS.current.has(k));
assert.equal(lostKeys.length, 0, '名冊車次鍵在重建的模型裡不見了：' + lostKeys.slice(0, 10).join('、'));
const drift = [], protHits = [], dwellHits = [], dwellAllowed = new Set(report.moves.flatMap(m => m.dwellMoved)); let nodeChanged = 0;
for (const [key, ids0] of firstPlanIds) {
  const ids1 = RS.current.get(key), names = RS.trainOf.get(key).names;
  if (!movedKeys.has(key) && (ids0.length !== ids1.length || ids0.some((p, k) => p !== ids1[k]))) drift.push(key);
  for (let j = 0; j < names.length; j++) { const a = RS.nodeAt(ids0, j), b = RS.nodeAt(ids1, j); if (a === b) continue; nodeChanged++;
    const why = Rm.prot(key, j, a, b); if (why) protHits.push(`${key} ${names[j]} ${why}`); if (Rm.dwell.has(key + '@' + j) && !dwellAllowed.has(key + '@' + j)) dwellHits.push(`${key} ${names[j]}`); }
}
assert.equal(drift.length, 0, `沒被換股的車次綁定漂移 ${drift.length} 班：` + drift.slice(0, 10).join('；'));
assert.equal(protHits.length, 0, '節點變動碰到受保護的東西：' + protHits.slice(0, 10).join('；'));
assert.equal(dwellHits.length, 0, '官方停靠的站被換了停車節點（不是一起換的停站車）：' + dwellHits.slice(0, 10).join('；'));
// 沒有任何一個通過站次從正線變成側線（逐站次比第一遍開始時的路徑）；收尾還在側線的每個站次都要有搬不動的原因
const after = sideSummary(Rm), newSide = [], left = [];
for (const s of Rm.sites) {
  const ids1 = RS.current.get(s.key), ids0 = firstPlanIds.get(s.key);
  if (!Rm.P.isSide(s.key, s.i, ids1)) continue;
  if (ids0 && !Rm.P.isSide(s.key, s.i, ids0)) newSide.push(s.id);
  const t = tryMove(Rm, s); assert.ok(!t.best, '收斂後仍有搬得動的通過站次 ' + s.id);
  left.push({ station: s.st.split(':')[1], dir: Rm.P.dirName(s.key, s.i), no: RS.trainOf.get(s.key).no, key: s.key, i: s.i, days: s.days.length, currentDays: s.days.filter(d => currentSet.has(d)).length, node: RS.nodeAt(ids1, s.i), reason: t.reason });
}
assert.equal(newSide.length, 0, '有通過站次從正線變成走側線：' + newSide.slice(0, 10).join('；'));
const nativeTouched = Object.entries(original).flatMap(([k, was]) => { const now = dispatch.plans[k]?.pathIds || []; return was.pathIds.flatMap((id, j) => (id !== now[j] && (NATIVE_REPLACED.has(+id) || NATIVE_REPLACED.has(+now[j])) ? [`${k}#${j} ${id}→${now[j]}`] : [])); });
assert.equal(nativeTouched.length, 0, '原生換過走法的路徑被換掉或換進來：' + nativeTouched.slice(0, 10).join('；'));
const parallelTouched = Object.entries(original).flatMap(([k, was]) => { const n = planNames(k, was), now = dispatch.plans[k]?.pathIds || []; return n ? was.pathIds.flatMap((id, j) => (id !== now[j] && PARALLEL_PAIRS.has(pairKey(n[j], n[j + 1])) ? [`${k}#${j} ${id}→${now[j]}`] : [])) : []; });
assert.equal(parallelTouched.length, 0, '平行股道站間的路徑被換掉：' + parallelTouched.slice(0, 10).join('；'));
const use0 = pairUse(original), use1 = pairUse(dispatch.plans), shrunk = [...use0].flatMap(([pk, m]) => { const a = pairMaxOf(I.net.paths, pk, m), b = pairMaxOf(outNet.paths, pk, use1.get(pk)); return b < a - 1e-9 ? [`${pk} ${a}→${b}`] : []; });
assert.equal(shrunk.length, 0, '站間最長的派車路徑變短：' + shrunk.slice(0, 10).join('；'));
assert.ok(after.all.sideRuns <= first.side.all.sideRuns, '走側線的通過天次變多');

const leftByReason = {}, leftByStation = {};
for (const x of left) { leftByReason[x.reason] = (leftByReason[x.reason] || 0) + 1; const k = x.station + ' ' + x.dir, o = leftByStation[k] ||= { keys: 0, days: 0, currentDays: 0, reasons: {} }; o.keys++; o.days += x.days; o.currentDays += x.currentDays; o.reasons[x.reason] = (o.reasons[x.reason] || 0) + 1; }
const movesByStation = {}; for (const m of report.moves) { const k = m.station.split(':')[1]; movesByStation[k] = (movesByStation[k] || 0) + 1; }
const newPlans = Object.keys(dispatch.plans).filter(k => !(k in original)).length;
const reportText = JSON.stringify({ ...report, before: { ...first, table: firstTable },
  after: { side: after, table: { current: Rm.P.table(currentSet), pinned: Rm.P.table(pinnedSet) }, violations: RX.violations(), byType: RX.violationsByType(), conflicts: perDay(RS.allConflicts()), meets: Rm.meets.perDay(), wrong: sumOf(wrongNow) },
  newPaths: keep.length, newPlans, repinned, nodeChanged, movesByStation, leftByReason, leftByStation, left, secs: { total: secsSince(tStart) }, peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024) }, null, 1);
fs.renameSync(netTmp, netFile); fs.renameSync(dispatchTmp, dispatchFile); fs.writeFileSync(reportFile, reportText);
const f = first.side, a = after;
console.log(`走側線的通過站次（車次鍵／天次）：全名冊 ${f.all.sideKeys}／${f.all.sideRuns} → ${a.all.sideKeys}／${a.all.sideRuns}；現行班表 ${f.current.sideKeys}／${f.current.sideRuns} → ${a.current.sideKeys}／${a.current.sideRuns}；釘版 ${f.pinned.sideKeys}／${f.pinned.sideRuns} → ${a.pinned.sideKeys}／${a.pinned.sideRuns}`);
console.log(`站×方向有通過列車走側線：現行班表 ${f.current.sideGroups} → ${a.current.sideGroups} 組`);
console.log(`換股 ${report.moves.length} 次（連停站車一起換 ${report.moves.filter(m => m.withQ.length).length} 次）、新落成計畫 ${newPlans}（落成動作 ${report.materialised}）、新路徑 ${keep.length}；待避違規 ${first.violations} → ${RX.violations()}`);
console.log(`搬不動的原因（站次）${JSON.stringify(leftByReason)}`);
console.log(`0913 驗收進路裡被搬過（驗收站與鄰站以外）要重釘的計畫 ${repinned.length} 份：node scripts/repin_remaining_routes.mjs ${path.relative(ROOT, dispatchFile)}`);
console.log(`耗時 ${secsSince(tStart)} 秒；寫入 ${OUT_DIR}`);
