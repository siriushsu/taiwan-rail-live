// 台鐵待避股道修復（F2b）：時刻表明示的待避（通過型與停站型），讓待避車停較彎的股道、超越車走較直的股道。
//
// 為什麼要有這支：F2（repair_physical_stations.mjs）一次只搬一班、只認 B＋C 變少。「超越車走側線、待避車停正線」
// 兩班停在不同節點，B、C 都是 0，F2 永遠不會挑到；單搬任一班又會先多一筆 C 被退回。要兩班一起換才修得好。
// 規格：docs/specs/2026-10-06-tra-overtake-main-siding.md。
//
// 做法：
//   1. 名冊與 F2 同一份衝突模型（scripts/lib/tra_station_conflicts.mjs，roster='f2b'）：班表釘 SCHEDULE_REF 的 14 天，加 9/13 考卷。
//   2. 待避對、直彎判準、單線交會計數跟閘門 verify_tra_overtake_tracks.mjs 同一份（scripts/lib/tra_overtake_pairs.mjs）。
//      配對只用嚴格窗；窗外 60 秒內的近距配對不是超越，只計數、不修。
//   3. 每組違規列舉（待避車選項 × 超越車選項，含不動），可行性沿用 F2；某份計畫換股時，執行期借它切片的車次一起換。
//      接受：違規總數（兩型合計、按天數加權）變少；沒有任何一天的 B、C 或單線交會共用節點變多；
//      原本不共用節點的待避對不得變成共用節點（逐對算，不是逐日總數：總數擋不住「這一對修好、隔壁那一對變穿越」的換位）。
//      同分依序取：這一組修完變成做對的、修完超越車是直的、搬的車少、路徑短的。
//   4. 一遍裡一輪一輪做到沒有改善；再從輸出重建名冊重來一遍（落成的新計畫會改變別班的綁定來源），
//      直到一整遍 0 次換股，收尾狀態就是從零重算的結果。
//   5. 基準（站間長度上限、方向股道、候選節點、非電化允許清單、單雙線表）釘在 BASE_REF，重跑自己的輸出時判準不漂移。
//
// 不做的事：不改時刻、不加 hold、不造新股道、不改既有計畫的 stopSignature 與 holds；受保護的進路不動。
// 路網只寫派車表真的用到的新路徑（探索過但沒採用的不寫）。
// 產物：OUT_DIR（預設 output/overtake-tracks/）的 network.json、dispatch.json、report.json。順序見 repair_physical_stations.mjs 檔頭。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStationConflictModel, MAX_PAIR_STRETCH } from './lib/tra_station_conflicts.mjs';
import { BASE_REF, SCHEDULE_REF, EXAM_REF, EXAM_DATE, REASON_SHORT, loadOvertakeInputs, makeOvertakeJudge, findOvertakePairs, makeProtection, makeOvertakeSolver, makeMeetCounter } from './lib/tra_overtake_pairs.mjs';

const OUT_DIR = process.env.OUT_DIR || 'output/overtake-tracks', MAX_PASSES = 4, MAX_ROUNDS = 20;
const tStart = Date.now(), secsSince = t => +((Date.now() - t) / 1000).toFixed(1);
const I = loadOvertakeInputs({ scheduleRef: SCHEDULE_REF, withExam: true,
  network: process.env.NETWORK || 'rail-3d/physical/network.json', dispatch: process.env.DISPATCH || 'rail-3d/physical/dispatch.json' });
const dispatch = I.dispatch, original = structuredClone(dispatch.plans), protectedPlanKeys = new Set(Object.keys(I.protectedPlans));
const report = { params: { BASE_REF, SCHEDULE_REF, EXAM_REF, EXAM_DATE, MAX_PASSES, MAX_ROUNDS, MAX_PAIR_STRETCH }, passes: [], moves: [], materialised: 0 };
const perDay = list => { const out = {}; for (const c of list) { const d = out[c.day] || (out[c.day] = { B: 0, C: 0 }); d[c.type]++; } return out; };
const build = (net, disp, rep) => {
  const S = createStationConflictModel({ net, dispatch: disp, sched: I.sched, timed: I.timed, protectedPlanKeys, report: rep, stats: {}, roster: 'f2b', base: I.base, extraDays: I.extraDays });
  S.buildBorrowerIndex();
  assert.equal(S.rosterStats.skippedLength, 0, '名冊有車次因站數不符被略過');
  assert.equal(S.rosterStats.misaligned.length, 0, '名冊有車次跨日對不上：' + JSON.stringify(S.rosterStats.misaligned.slice(0, 3)));
  assert.equal(S.rosterStats.unlinked, 0, '有借用切片對不回來源');
  const J = makeOvertakeJudge(S), { pairs, near } = findOvertakePairs(S), meets = makeMeetCounter(S, I.sections);
  return { S, J, pairs, near, meets, X: makeOvertakeSolver(S, J, { pairs, isProtected: makeProtection(S, I), meets }) };
};
const sourceOf = S => new Map([...S.trainOf].map(([k, r]) => [k, r.basis + '|' + (r.sourceKey || '')]));
// 逆向段（走在方向乾淨的股道上卻逆向的路徑段）按名冊逐車次鍵算：車次鍵 → 該班有幾段逆向，沒有逆向的不記；借用的車次算它借來的那一段。
// 不用 S.wrongSegments()：它逐計畫筆數，借來的車次落成自己的計畫時，沿用來源的逆向段會在計畫表裡多一筆，總數變多，但這班車的路徑沒有變壞。
// 斷言逐班比，不比總數：總數會掩蓋「一班修好、一班變壞」。
const rosterWrong = S => { const m = new Map(); for (const [key, ids] of S.current) { const n = ids.filter(pid => S.paths[pid] && S.M.wrongOn(S.paths[pid], S.clean).length).length; if (n) m.set(key, n); } return m; };
const sumOf = m => [...m.values()].reduce((a, b) => a + b, 0);
const looseKey = (type, st, q, p) => [type, st, q, p].join('|');   // 站＋型別＋Q 車次鍵＋P 車次鍵（不含站序）

const usedNew = new Map();   // pathId → 路網記錄（各遍落成的新路徑；寫檔時只留派車表用到的）
let net = I.net, cur, first = null, firstSource = null, firstPairs = null, firstWrong = null, drift = [];
for (let pass = 1; pass <= MAX_PASSES; pass++) {
  const tPass = Date.now();
  cur = null;   // 前一遍的模型（約 1 GB）先放掉再建下一個
  cur = build(net, dispatch, report);
  const buildSecs = secsSince(tPass), { S, X } = cur;
  if (!first) {
    firstWrong = rosterWrong(S);
    first = { violations: X.violations(), byType: X.violationsByType(), conflicts: perDay(S.allConflicts()), meets: cur.meets.perDay(), wrong: sumOf(firstWrong), wrongPlanEntries: S.wrongSegments(), pairs: cur.pairs.length, near: cur.near.length };
    firstSource = sourceOf(S);
    // 第一遍開始時每一對待避對的樣子：收尾時逐對核對「不准新造穿越」（pair 的 id 含車次鍵與站序，id 對不上再退回不含站序的鍵）
    firstPairs = cur.pairs.map(c => ({ id: c.id, loose: looseKey(c.type, c.st, c.q.key, c.p.key), shared: X.state(c).kind === 'shared' }));
  } else {
    const now = sourceOf(S);
    drift = [...now].filter(([k, v]) => firstSource.has(k) && firstSource.get(k) !== v && !report.moves.some(m => m.changes.some(c => c.key === k))).map(([k, v]) => [k, firstSource.get(k), v]);
  }
  const rec = { pass, start: X.violations(), buildSecs, rounds: [] };
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const tRound = Date.now(), before = X.violations(); let moved = 0;
    for (const c of X.violating()) {
      if (!X.state(c).viol) continue;
      const fix = X.bestFix(c); if (!fix) continue;
      report.moves.push({ pass, round, ...X.describe(fix) }); X.apply(fix); moved++;
    }
    const roundSecs = secsSince(tRound);
    rec.rounds.push({ round, before, after: X.violations(), moved, secs: roundSecs });
    console.log(`第 ${pass} 遍第 ${round} 輪：違規 ${before} → ${X.violations()}，換股 ${moved} 次（${roundSecs} 秒）`);
    if (!moved) break;
    assert.ok(round < MAX_ROUNDS, `第 ${pass} 遍 ${MAX_ROUNDS} 輪仍在換股`);
  }
  rec.moves = rec.rounds.reduce((n, r) => n + r.moved, 0); rec.secs = secsSince(tPass);
  report.passes.push(rec);
  console.log(`第 ${pass} 遍：建模型 ${buildSecs} 秒、換股 ${rec.moves} 次、共 ${rec.secs} 秒`);
  for (const [id, p] of Object.entries(S.newPaths)) usedNew.set(+id, p);
  net = { ...I.net, paths: { ...I.net.paths, ...Object.fromEntries(usedNew) } };
  if (rec.rounds.every(r => !r.moved)) break;
  assert.ok(pass < MAX_PASSES, `${MAX_PASSES} 遍仍有換股，沒有收斂`);
}
const { S, X, meets, near, pairs } = cur;

// ── 收尾自檢 ──
const tExplain = Date.now(), viol = X.violating(), explained = viol.map(c => ({ c, reason: X.explain(c) }));
const explainSecs = secsSince(tExplain);
assert.ok(explained.every(e => e.reason !== 'FIXABLE'), '收斂後仍有可修的違規');
const finalConf = perDay(S.allConflicts()), finalMeets = meets.perDay(), wrongNow = rosterWrong(S), wrongAfter = sumOf(wrongNow);
for (const day of new Set([...Object.keys(first.conflicts), ...Object.keys(finalConf)])) for (const t of ['B', 'C'])
  assert.ok((finalConf[day]?.[t] || 0) <= (first.conflicts[day]?.[t] || 0), `${day} 的 ${t} 從 ${first.conflicts[day]?.[t] || 0} 變成 ${finalConf[day]?.[t] || 0}`);
for (const day of Object.keys(finalMeets)) assert.ok(finalMeets[day] <= (first.meets[day] || 0), `${day} 的單線交會共用節點從 ${first.meets[day] || 0} 變成 ${finalMeets[day]}`);
const wrongWorse = [...wrongNow].filter(([k, n]) => n > (firstWrong.get(k) || 0));   // 第一遍沒有記的車次鍵就是 0
assert.equal(wrongWorse.length, 0, `有 ${wrongWorse.length} 班的逆向段變多（車次鍵 前 → 後）：` + wrongWorse.slice(0, 10).map(([k, n]) => `${k} ${firstWrong.get(k) || 0} → ${n}`).join('；'));
const wrongTrainsBetter = [...firstWrong].filter(([k, n]) => (wrongNow.get(k) || 0) < n).length;
// 不准新造穿越（規格第 4 節第 3 步，逐對算）：第一遍開始時不是共用節點的待避對，收尾時不得是共用節點。
// 先用 id 對，id 對不上（跨遍重建後車次鍵或站序變了）的退回站＋型別＋Q 車次鍵＋P 車次鍵，同鍵有好幾對時任何一對共用就算。
const finalById = new Map(pairs.map(c => [c.id, c])), finalByLoose = new Map();
for (const c of pairs) { const k = looseKey(c.type, c.st, c.q.key, c.p.key); (finalByLoose.get(k) || finalByLoose.set(k, []).get(k)).push(c); }
const crossing = [], noNew = { firstPairs: firstPairs.length, notSharedAtStart: 0, matchedById: 0, matchedByLooseKey: 0, vanished: 0, newShared: 0, appeared: 0, appearedShared: 0 };
for (const f of firstPairs) {
  if (f.shared) continue;
  noNew.notSharedAtStart++;
  const hit = finalById.get(f.id), hits = hit ? [hit] : finalByLoose.get(f.loose) || [];
  if (hit) noNew.matchedById++; else if (hits.length) noNew.matchedByLooseKey++; else noNew.vanished++;
  for (const c of hits) if (X.state(c).kind === 'shared') crossing.push({ id: c.id, days: c.days, was: f.id });
}
noNew.newShared = crossing.length;
const firstIds = new Set(firstPairs.map(f => f.id)), firstLoose = new Set(firstPairs.map(f => f.loose));
for (const c of pairs) if (!firstIds.has(c.id) && !firstLoose.has(looseKey(c.type, c.st, c.q.key, c.p.key))) { noNew.appeared++; if (X.state(c).kind === 'shared') noNew.appearedShared++; }
noNew.matchBy = noNew.matchedByLooseKey ? 'id，對不上的退回站＋型別＋Q 車次鍵＋P 車次鍵' : 'id';
assert.equal(crossing.length, 0, '新造穿越（原本不共用節點的待避對收尾時共用了）：' + JSON.stringify(crossing.slice(0, 5)));
for (const [key, plan] of Object.entries(I.protectedPlans)) assert.deepEqual(dispatch.plans[key], plan, '重寫已驗收進路 ' + key);
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
assert.equal(JSON.stringify(outNet.ways), JSON.stringify(I.net.ways), 'ways 被改了');
for (const id of referenced) assert.ok(outNet.paths[id], '派車表用到路網沒有的路徑 ' + id);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'network.json'), JSON.stringify(outNet));
fs.writeFileSync(path.join(OUT_DIR, 'dispatch.json'), JSON.stringify(dispatch));

// ── 從寫出的檔重建一次：違規數、每天 B／C、單線交會要等於追蹤值（序列化、路徑裁剪漏東西會在這裡現形）──
const tRebuild = Date.now(), finalViolations = X.violations();
const R = build(JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'network.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'dispatch.json'), 'utf8')), { materialised: 0 });
const rebuildSecs = secsSince(tRebuild);
assert.equal(R.X.violations(), finalViolations, '從輸出重建的違規數跟追蹤值不同');
assert.deepEqual(perDay(R.S.allConflicts()), finalConf, '從輸出重建的 B／C 跟追蹤值不同');
assert.deepEqual(R.meets.perDay(), finalMeets, '從輸出重建的單線交會跟追蹤值不同');

const hist = {}; for (const e of explained) { const k = e.c.type + ':' + e.reason; hist[k] = (hist[k] || 0) + 1; }
const unfixable = explained.flatMap(({ c, reason }) => c.days.map(day => ({ day, type: c.type, station: c.st, q: c.q, p: c.p, ...c.at[day], ...X.state(c), reason })));
const shortStations = [...new Set(explained.filter(e => e.reason === REASON_SHORT).map(e => e.c.st.split(':')[1]))];
const ambiguousByType = { pass: 0, stop: 0 }; for (const c of pairs) if (X.state(c).kind === 'ambiguous') ambiguousByType[c.type] += c.days.length;
const nearPerDay = {}; for (const x of near) nearPerDay[x.day] = (nearPerDay[x.day] || 0) + 1;
// 換股依「這一組修完的狀態」分布；兩班一起換＝待避車與超越車都被直接換股（借用切片連帶換的不算）
const movesByAfterKind = {};
for (const m of report.moves) { const o = movesByAfterKind[m.cAfter?.kind ?? '（無）'] ||= { moves: 0, both: 0 }; o.moves++; if (m.moved === 2) o.both++; }
const newPlans = Object.keys(dispatch.plans).filter(k => !(k in original)).length, bothMoved = report.moves.filter(m => m.moved === 2).length;
const secs = { total: secsSince(tStart), explain: explainSecs, rebuild: rebuildSecs }, peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ ...report,
  before: first, after: { violations: finalViolations, byType: X.violationsByType(), conflicts: finalConf, meets: finalMeets, wrong: wrongAfter, wrongPlanEntries: S.wrongSegments(), wrongTrainsBetter }, newPaths: keep.length, newPlans,
  movesByAfterKind, bothMoved, noNewShared: noNew, unfixableByReason: hist, unfixable, shortStations, ambiguousByType, nearPerDay, bindingDrift: { count: drift.length, sample: drift.slice(0, 20) },
  secs, peakRssMB }, null, 1));
const bt = first.byType, at = X.violationsByType();
console.log(`違規 通過型 ${bt.pass} → ${at.pass}、停站型 ${bt.stop} → ${at.stop} 件次；換股 ${report.moves.length} 次（兩班一起換 ${bothMoved}）、新落成計畫 ${newPlans}（落成動作 ${report.materialised} 次）、新路徑 ${keep.length}、綁定漂移 ${drift.length}`);
console.log(`換股後狀態分布 ${JSON.stringify(movesByAfterKind)}；不准新造穿越逐對核對 ${JSON.stringify(noNew)}`);
console.log(`逆向段（名冊逐班）${first.wrong} → ${wrongAfter}、逐班變好 ${wrongTrainsBetter} 班、沒有任何一班變多；計畫表逐筆 ${first.wrongPlanEntries} → ${S.wrongSegments()}`);
console.log(`修不掉（組）${JSON.stringify(hist)}；「${REASON_SHORT}」的站：${shortStations.join('、') || '（無）'}`);
console.log(`耗時 ${JSON.stringify(secs)} 秒；記憶體峰值 ${peakRssMB} MB`);
console.log('寫入', OUT_DIR);
