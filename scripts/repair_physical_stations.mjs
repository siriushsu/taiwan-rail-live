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
// 順序：repair_physical_directions（F1）→ repair_physical_stations（F2）→ repair_tra_overtake_tracks（F2b，待避股道）
//       → extend_tra_overtake_sidings → 覆蓋 rail-3d/physical/ → level-profiles.json 只換 inputSha256 裡 network.json 的雜湊
//       （F2b 保證 ways 不變；不跑完整的 build_rail_levels 重算）→ build_tra_track_sections（單雙線不得改判）
//       → build_run_profiles → verify_tra_overtake_tracks（重找一次待避對；有可修的違規就再跑一輪 F2b）
//       → build_tra_overtake_tracks → build_data_manifest → 出貨閘門（verify_physical_no_overlap 等）。
// 🔴 重跑 F1／F2 之後 F2b 也要接著重跑，重抓班表（npm run fetch-schedule）後也一樣。F2b 與閘門釘的兩顆 commit
//    （scripts/lib/tra_overtake_pairs.mjs 的 BASE_REF、SCHEDULE_REF）何時換、換成哪一顆、先後順序，
//    見 docs/specs/2026-10-06-tra-overtake-main-siding.md 第 6 節「釘選的 commit 何時換」，這裡不重寫一份。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeDirectionModel } from './lib/track_directions.mjs';
import { computeProfiles, readPassObs } from './build_run_profiles.mjs';
import { PASS_MARGIN, MAX_PAIR_STRETCH, createStationConflictModel } from './lib/tra_station_conflicts.mjs';

const OUT_DIR = process.env.OUT_DIR || 'output/stations';
const ROUNDS = 12;
const net = JSON.parse(fs.readFileSync(process.env.NETWORK || 'rail-3d/physical/network.json', 'utf8'));
const dispatch = JSON.parse(fs.readFileSync(process.env.DISPATCH || 'rail-3d/physical/dispatch.json', 'utf8'));
const sched = JSON.parse(fs.readFileSync('data/tra_schedule_dense.json', 'utf8'));
// remaining-routes fixture 裡的 afterPlans 是逐秒、雙方向與模板借用都驗收過的基準；F2 不能為了總量更低
// 又把這些具名修復重寫。保護清單直接讀同一份 fixture，避免修復器與 gate 各自維護兩張會漂移的名單。
const protectedPlans = JSON.parse(fs.readFileSync('scripts/fixtures/remaining-routes-0913.json', 'utf8')).afterPlans;
const protectedPlanKeys = new Set(Object.keys(protectedPlans));
// 通過站的時刻要用畫面真的會用的那一份：跑剖面＋交會／待避推論（F3）之後的時刻，不是班表密化的插值——
// 待避推論會刻意把通過車的時刻夾進被超越那班的停站窗裡，用插值時刻會漏掉正是要修的那些衝突。
// verify_run_profiles_match.mjs 保證這裡算出來的與畫面逐值相同。車次鍵與簽章仍用原始班表（綁定看的是那一份）。
const timed = structuredClone(sched);
computeProfiles({ indexPath: 'index.html', schedule: timed, track: JSON.parse(fs.readFileSync('data/tra.json', 'utf8')), passObs: readPassObs('data/tra_pass_obs.json') });
const report = { params: { PASS_MARGIN, ROUNDS, MAX_PAIR_STRETCH }, rounds: [], moves: [], movesByStation: {}, unfixed: [], materialised: 0 };
const stats = { 修好: 0, 無替代節點: 0, 無順向路徑: 0, 引入新非電化股道: 0, 拉長站間超過基線: 0, 道岔接不上: 0, 換了不會更好: 0 };
// 名冊、cells、B／C 模型與 tryMove 在 scripts/lib/tra_station_conflicts.mjs（與 F2b 共用）。
const { plans, paths, turnOK, newPaths, current, trainOf, protectedScheduleKeys, initialNonElectric, nonElectricWays,
  basePairMax, allConflicts, tally, dedup, tryMove, wrongSegments, wrongBefore } =
  createStationConflictModel({ net, dispatch, sched, timed, protectedPlanKeys, report, stats });

// ── 主迴圈 ────────────────────────────────────────────────────────────────────────
let list = allConflicts(); const first = tally(list);
console.log(`修復前：B ${first.B}、C ${first.C}（14 天合計，去重 ${dedup(list)} 對）`);
for (let round = 1; round <= ROUNDS; round++) {
  const load = new Map();
  for (const c of list) for (const s of [c.x, c.y]) {
    // 若把沿用受保護 source plan 的 schedule variant materialize 成 exact，產品就不再走該受保護進路。
    if (protectedScheduleKeys.has(s.key)) continue;
    const k = s.key + '@' + s.i; load.set(k, (load.get(k) || 0) + 1);
  }
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
for (const [key, plan] of Object.entries(protectedPlans)) assert.deepEqual(plans[key], plan, '重寫已驗收進路 ' + key);
// 收尾自檢：改過的計畫仍首尾相接、段數正確
for (const [key, ids] of current) { const t = trainOf.get(key);
  assert.equal(ids.length, t.stops.length - 1, key + ' 段數不對');
  const allowedNonElectric = initialNonElectric.get(key) || new Set();
  for (const pid of ids) for (const wid of nonElectricWays(pid)) assert.ok(allowedNonElectric.has(wid), key + ' 引入新的非電化股道 ' + wid);
  ids.forEach((pid, i) => {
    const p = paths[pid], limit = basePairMax.get(t.names[i] + '>' + t.names[i + 1]);
    if (limit) assert.ok(p.lengthM <= limit * MAX_PAIR_STRETCH + 1e-6, `${key} ${t.names[i]}→${t.names[i + 1]} 把站間拉長 ${p.lengthM}/${limit}`);
  });
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
