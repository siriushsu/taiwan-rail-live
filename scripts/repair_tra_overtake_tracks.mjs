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
//      接力借路徑的專車（好幾份來源的切片接成一條）：交接處接不上就不跟著換；換股之後前端重新綁定挑的來源與模型不同的，
//      落成自己的計畫、路徑維持模型的（report.pinnedRelays 逐一列出）。
//      接受：違規總數（兩型合計、按天數加權）變少；沒有任何一天的 B、C 或單線交會共用節點變多；
//      原本不穿越的待避對不得變成穿越（逐對算，不是逐日總數：總數擋不住「這一對修好、隔壁那一對變穿越」的換位）。
//      同分依序取：這一組修完變成做對的、修完超越車是直的、搬的車少、路徑短的。
//   4. 一遍裡一輪一輪做到沒有改善；再從輸出重建名冊重來一遍（落成的新計畫會改變別班的綁定來源），
//      直到一整遍 0 次換股，收尾狀態就是從零重算的結果。
//   5. 基準（站間長度上限、方向股道、候選節點、非電化允許清單、單雙線表）釘在 BASE_REF，重跑自己的輸出時判準不漂移。
//   6. 收尾：先把 network、dispatch 寫成暫存名（network.unverified.json、dispatch.unverified.json），再從暫存檔重建一個模型 R，
//      自檢都在 R 上做（收斂的最後一遍沒有換股，記憶體模型是用記憶體裡的 net／dispatch 重算的，只用來核對 R 逐對相同）。
//      收尾另把第一遍開始時與 R 的 B／C 逐件對照，新出現與消失的件寫進 report.json（conflictItemsDiff，只列不擋）。
//      全過了才把暫存檔改成正式名，report.json 最後才寫。舊的正式名與暫存名產物在輸入載入、確認輸出不是輸入之後就刪掉，
//      從那裡起任何一步失敗，OUT_DIR 裡都沒有正式名的產物；更早的失敗（輸入讀不到、輸出就是輸入）不會動 OUT_DIR，只靠非 0 離開碼示警。
//
// 不做的事：不改時刻、不加 hold、不造新股道、不改既有計畫的 stopSignature 與 holds；受保護的進路不動。
// 路網只寫派車表真的用到的新路徑（探索過但沒採用的不寫）。
// 產物：OUT_DIR（預設 output/overtake-tracks/）的 network.json、dispatch.json、report.json；這一次的產物自檢全過才以正式名出現。
// 輸出檔不得就是輸入檔（啟動時斷言）。
// 順序見 repair_physical_stations.mjs 檔頭。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStationConflictModel, MAX_PAIR_STRETCH } from './lib/tra_station_conflicts.mjs';
import { BASE_REF, SCHEDULE_REF, EXAM_REF, EXAM_DATE, REASON_SHORT, REASON_FIXABLE, SHARED_OK_REASONS, loadOvertakeInputs, makeOvertakeJudge, findOvertakePairs, makeProtection, makeOvertakeSolver, makeMeetCounter } from './lib/tra_overtake_pairs.mjs';

// 輸入檔的相對路徑從樹根算（loadOvertakeInputs），輸出目錄同一個基準：從哪個目錄啟動都寫在樹根底下，不會跑到別的樹。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || 'output/overtake-tracks'), MAX_PASSES = 4, MAX_ROUNDS = 20;
// 剛重跑過 F1／F2 時，BASE_REF 的基準（站間長度上限、非電化允許清單）還是舊 F2 產物：新產物合理地引入新股道或拉長站間，
// 下面兩個斷言會誤擋，要先把 BASE_REF 換成含新 F2 產物的 commit（規格第 6 節）。
const REBASE_HINT = '；若剛重跑過 F1／F2，要先把 BASE_REF 換成含新 F2 產物的 commit（規格第 6 節）';
const tStart = Date.now(), secsSince = t => +((Date.now() - t) / 1000).toFixed(1);
const NETWORK_IN = process.env.NETWORK || 'rail-3d/physical/network.json', DISPATCH_IN = process.env.DISPATCH || 'rail-3d/physical/dispatch.json';
// 一開跑就印出實際讀哪兩個檔、寫到哪裡（絕對路徑）：輸入讀不到或輸出就是輸入而中止時，也看得到是哪個檔。
console.log(`輸入 network ${path.resolve(ROOT, NETWORK_IN)}\n輸入 dispatch ${path.resolve(ROOT, DISPATCH_IN)}\n輸出 ${OUT_DIR}`);
const I = loadOvertakeInputs({ scheduleRef: SCHEDULE_REF, withExam: true, network: NETWORK_IN, dispatch: DISPATCH_IN });
// 產物檔名：先寫成暫存名（*.unverified.json），自檢全過才改成正式名，report.json 最後才寫。
const outPath = n => path.join(OUT_DIR, n);
const netFile = outPath('network.json'), dispatchFile = outPath('dispatch.json'), reportFile = outPath('report.json');
const netTmp = outPath('network.unverified.json'), dispatchTmp = outPath('dispatch.unverified.json');
// 輸出檔（正式名與暫存名）不得就是輸入檔：收尾的 ways 比對是拿寫出的檔對輸入的檔，同一個檔就是自己比自己，永遠相同；
// 下一步就會刪掉輸出名，同一個檔會把輸入刪掉。除了路徑字串，也比 dev／ino（符號連結、換個寫法的路徑都擋得住）。
const sameFile = (a, b) => { try { const x = fs.statSync(a), y = fs.statSync(b); return x.dev === y.dev && x.ino === y.ino; } catch { return false; } };
for (const out of [netFile, dispatchFile, netTmp, dispatchTmp]) for (const [what, inp] of [['NETWORK', I.files.network], ['DISPATCH', I.files.dispatch]])
  assert.ok(path.resolve(out) !== inp && !sameFile(out, inp),
    `輸出檔 ${path.resolve(out)} 與輸入的 ${what} 檔 ${inp} 是同一個檔：ways 比對會變成自己比自己，而且刪舊產物時會把輸入刪掉；請把 OUT_DIR 換成輸入檔以外的位置`);
// 舊產物（正式名與暫存名）在這裡就刪掉：從這裡起任何一步失敗，OUT_DIR 都不會留下正式名的產物，
// 也就不會把上一次（可能是另一份輸入）的產物誤當成這一次的。這之前的失敗（輸入讀不到、輸出就是輸入）不動 OUT_DIR。
for (const f of [netFile, dispatchFile, reportFile, netTmp, dispatchTmp]) fs.rmSync(f, { force: true });
const dispatch = I.dispatch, original = structuredClone(dispatch.plans), protectedPlanKeys = new Set(Object.keys(I.protectedPlans));
const report = { params: { BASE_REF, SCHEDULE_REF, EXAM_REF, EXAM_DATE, MAX_PASSES, MAX_ROUNDS, MAX_PAIR_STRETCH }, passes: [], moves: [], materialised: 0, pinnedRelays: [] };
const perDay = list => { const out = {}; for (const c of list) { const d = out[c.day] || (out[c.day] = { B: 0, C: 0 }); d[c.type]++; } return out; };
const build = (net, disp, rep) => {
  const S = createStationConflictModel({ net, dispatch: disp, sched: I.sched, timed: I.timed, protectedPlanKeys, report: rep, stats: {}, roster: 'f2b', base: I.base, extraDays: I.extraDays });
  S.buildBorrowerIndex();
  assert.equal(S.rosterStats.skippedLength, 0, '名冊有車次因站數不符被略過');
  assert.equal(S.rosterStats.misaligned.length, 0, '名冊有車次跨日對不上：' + JSON.stringify(S.rosterStats.misaligned.slice(0, 3)));
  assert.equal(S.rosterStats.unlinked, 0, '有借用切片對不回來源');
  const J = makeOvertakeJudge(S), { pairs, near } = findOvertakePairs(S), meets = makeMeetCounter(S, I.sections), prot = makeProtection(S, I);
  return { S, J, pairs, near, meets, prot, X: makeOvertakeSolver(S, J, { pairs, isProtected: prot, meets }) };
};
// 逆向段（走在方向乾淨的股道上卻逆向的路徑段）按名冊逐車次鍵算：車次鍵 → 該班有幾段逆向，沒有逆向的不記；借用的車次算它借來的那一段。
// 不用 S.wrongSegments()：它逐計畫筆數，借來的車次落成自己的計畫時，沿用來源的逆向段會在計畫表裡多一筆，總數變多，但這班車的路徑沒有變壞。
// 斷言逐班比，不比總數：總數會掩蓋「一班修好、一班變壞」。
const rosterWrong = S => { const m = new Map(); for (const [key, ids] of S.current) { const n = ids.filter(pid => S.paths[pid] && S.M.wrongOn(S.paths[pid], S.clean).length).length; if (n) m.set(key, n); } return m; };
const sumOf = m => [...m.values()].reduce((a, b) => a + b, 0);
const looseKey = (type, st, q, p) => [type, st, q, p].join('|');   // 站＋型別＋Q 車次鍵＋P 車次鍵（不含站序）

const usedNew = new Map();   // pathId → 路網記錄（各遍落成的新路徑；寫檔時只留派車表用到的）
let net = I.net, cur, first = null, firstPlanIds = null, firstPairs = null, firstWrong = null, firstItems = null;
// B／C 一件的身分：型別＋日＋站＋兩班車次鍵（排序）。第一遍的模型每遍都會放掉，只留這份純資料。
const itemOf = c => ({ type: c.type, day: c.day, station: c.st, keys: [c.x.key, c.y.key].sort() });
const itemKey = c => [c.type, c.day, c.station, c.keys.join('~')].join('|');
for (let pass = 1; pass <= MAX_PASSES; pass++) {
  const tPass = Date.now();
  cur = null;   // 先放掉上一遍的模型再建下一個：每一遍的模型都帶整份名冊、cells 與各種快取，cur 還指著它的話，建新模型時新舊兩份會同時佔著記憶體
  cur = build(net, dispatch, report);
  const buildSecs = secsSince(tPass), { S, X } = cur;
  if (!first) {
    firstWrong = rosterWrong(S);
    const firstConf = S.allConflicts();
    firstItems = firstConf.map(itemOf);
    first = { violations: X.violations(), byType: X.violationsByType(), conflicts: perDay(firstConf), meets: cur.meets.perDay(), wrong: sumOf(firstWrong), wrongPlanEntries: S.wrongSegments(), pairs: cur.pairs.length, near: cur.near.length };
    firstPlanIds = new Map([...S.current].map(([k, ids]) => [k, ids.slice()]));   // 收尾核對綁定漂移用：第一遍開始時每個車次鍵的有效 pathIds
    // 第一遍開始時每一對待避對的樣子：收尾時逐對核對「不准新造穿越」（pair 的 id 含車次鍵與站序，id 對不上再退回不含站序的鍵）
    firstPairs = cur.pairs.map(c => ({ id: c.id, loose: looseKey(c.type, c.st, c.q.key, c.p.key), shared: X.state(c).kind === 'shared' }));
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
const { S, X, meets, pairs } = cur;   // 最後一遍（沒有再換股、收斂的那一遍）的記憶體模型

// ── 寫檔前自檢（記憶體模型）：計畫表本身的結構與保護，不過就不落檔 ──
const finalViolations = X.violations(), finalConf = perDay(S.allConflicts()), finalMeets = meets.perDay();
for (const day of new Set([...Object.keys(first.conflicts), ...Object.keys(finalConf)])) for (const t of ['B', 'C'])
  assert.ok((finalConf[day]?.[t] || 0) <= (first.conflicts[day]?.[t] || 0), `${day} 的 ${t} 從 ${first.conflicts[day]?.[t] || 0} 變成 ${finalConf[day]?.[t] || 0}`);
for (const day of Object.keys(finalMeets)) assert.ok(finalMeets[day] <= (first.meets[day] || 0), `${day} 的單線交會共用節點從 ${first.meets[day] || 0} 變成 ${finalMeets[day]}`);
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
  for (const pid of ids) for (const wid of S.nonElectricWays(pid)) assert.ok(allowed.has(wid), key + ' 引入新的非電化股道 ' + wid + REBASE_HINT);
  ids.forEach((pid, i) => { const limit = S.basePairMax.get(t.names[i] + '>' + t.names[i + 1]);
    if (limit) assert.ok(S.paths[pid].lengthM <= limit * MAX_PAIR_STRETCH + 1e-6, `${key} ${t.names[i]}→${t.names[i + 1]} 把站間拉長 ${S.paths[pid].lengthM}/${limit}` + REBASE_HINT); });
  for (let i = 1; i < ids.length; i++) { assert.equal(S.paths[ids[i - 1]].to, S.paths[ids[i]].from, key + ' 第 ' + i + ' 段不相接'); assert.ok(S.turnOK(ids[i - 1], ids[i]), key + ' 第 ' + i + ' 站進出段接不上'); }
  if (!S.borrowed.has(key)) assert.strictEqual(dispatch.plans[key].pathIds, ids, key + ' 計畫與名冊脫鉤');
}

// ── 寫檔：路網只帶派車表用到的新路徑 ──
// 舊產物開跑時已刪；新產物先寫成暫存名，下面從暫存檔重建 R、自檢全過了才改成正式名，report.json 最後才寫。
// 自檢沒過時，OUT_DIR 裡不會有任何正式名的產物（留下的 *.unverified.json 只供除錯，不得使用）。
const referenced = new Set(Object.values(dispatch.plans).flatMap(p => p.pathIds));
const keep = [...usedNew.keys()].filter(id => referenced.has(id)).sort((a, b) => a - b);
const outNet = { ...I.net, paths: { ...I.net.paths, ...Object.fromEntries(keep.map(id => [id, usedNew.get(id)])) } };
for (const id of referenced) assert.ok(outNet.paths[id], '派車表用到路網沒有的路徑 ' + id);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(netTmp, JSON.stringify(outNet));
fs.writeFileSync(dispatchTmp, JSON.stringify(dispatch));

// ── 從暫存檔重建模型 R，之後的自檢都在 R 上做 ──
// ways 從磁碟重讀兩份來比（暫存的 network 檔、輸入的 NETWORK 檔），不沿用記憶體物件：
// outNet 是 { ...I.net, paths }，outNet.ways 與 I.net.ways 是同一個參照，拿它們互比必然相同。
const writtenNet = JSON.parse(fs.readFileSync(netTmp, 'utf8'));
assert.equal(JSON.stringify(writtenNet.ways), JSON.stringify(JSON.parse(fs.readFileSync(I.files.network, 'utf8')).ways), `ways 被改了：${netTmp} 與輸入 ${I.files.network} 的 ways 不同`);
const tRebuild = Date.now();
const R = build(writtenNet, JSON.parse(fs.readFileSync(dispatchTmp, 'utf8')), { materialised: 0 });
const rebuildSecs = secsSince(tRebuild), RS = R.S, RX = R.X;
const nm = c => `${c.st.split(':')[1]} Q${c.q.no}/P${c.p.no}（${c.type === 'pass' ? '通過' : '停站'}）`;

// 記憶體模型（收斂的最後一遍，這一遍 0 次換股，所以它是用記憶體裡的 net／dispatch 重算的，沒有增量算出來的狀態）要與從檔重算的 R 相同：
// 總量與逐對判定都比。比的是「記憶體物件重算」對「從檔重算」，序列化、路徑裁剪漏東西會在這裡現形。
assert.equal(RX.violations(), finalViolations, '從輸出重建的違規數跟記憶體模型不同');
assert.deepEqual(perDay(RS.allConflicts()), finalConf, '從輸出重建的 B／C 跟記憶體模型不同');
assert.deepEqual(R.meets.perDay(), finalMeets, '從輸出重建的單線交會跟記憶體模型不同');
const memPairs = new Map(pairs.map(c => [c.id, c])), rebuiltPairs = new Map(R.pairs.map(c => [c.id, c])), kindDiff = [];
for (const c of R.pairs) { const m = memPairs.get(c.id), km = m ? X.state(m).kind : '（沒有這一對）', kr = RX.state(c).kind; if (km !== kr) kindDiff.push(`${nm(c)} 記憶體 ${km}／重建 ${kr}`); }
for (const c of pairs) if (!rebuiltPairs.has(c.id)) kindDiff.push(`${nm(c)} 記憶體 ${X.state(c).kind}／重建 （沒有這一對）`);
assert.equal(kindDiff.length, 0, `記憶體模型與重建模型有 ${kindDiff.length} 對的判定不同（前 10）：` + kindDiff.slice(0, 10).join('；'));

// explain 只在 R 上跑一次：沒有可修的違規（閘門 G2 同條件）
const tExplain = Date.now(), viol = RX.violating(), explained = viol.map(c => ({ c, reason: RX.explain(c) }));
const explainSecs = secsSince(tExplain);
assert.ok(explained.every(e => e.reason !== REASON_FIXABLE), '收斂後仍有可修的違規');

// 逐班方向：沒有任何一班的逆向段變多（逐班比，不比總數：總數會掩蓋「一班修好、一班變壞」）
const wrongNow = rosterWrong(RS), wrongAfter = sumOf(wrongNow);
const wrongWorse = [...wrongNow].filter(([k, n]) => n > (firstWrong.get(k) || 0));   // 第一遍沒有記的車次鍵就是 0
assert.equal(wrongWorse.length, 0, `有 ${wrongWorse.length} 班的逆向段變多（車次鍵 前 → 後）：` + wrongWorse.slice(0, 10).map(([k, n]) => `${k} ${firstWrong.get(k) || 0} → ${n}`).join('；'));
const wrongTrainsBetter = [...firstWrong].filter(([k, n]) => (wrongNow.get(k) || 0) < n).length;

// 不准新造穿越（規格第 4 節第 3 步，逐對算）：第一遍開始時不穿越的待避對，收尾時不得穿越。
// 先用 id 對，id 對不上（跨遍重建後車次鍵或站序變了）的退回站＋型別＋Q 車次鍵＋P 車次鍵，同鍵有好幾對時任何一對共用就算。
// 另外兩種只出現在重建之後的情形也擋：收尾才找到、而且穿越的對；第一遍有、收尾找不到的對（找不到的違規不是修好了，是看不見了）。
// 「找不到」只逐對數第一遍不穿越的對（下面 f.shared 的略過）；第一遍就穿越、後來消失的對沒有逐對檢查，
// 只被下面名冊車次鍵不得消失（lostKeys）間接擋住。
const finalById = new Map(R.pairs.map(c => [c.id, c])), finalByLoose = new Map();
for (const c of R.pairs) { const k = looseKey(c.type, c.st, c.q.key, c.p.key); (finalByLoose.get(k) || finalByLoose.set(k, []).get(k)).push(c); }
const crossing = [], vanishedPairs = [], appearedSharedPairs = [];
const noNew = { firstPairs: firstPairs.length, notSharedAtStart: 0, matchedById: 0, matchedByLooseKey: 0, vanished: 0, newShared: 0, appeared: 0, appearedShared: 0 };
for (const f of firstPairs) {
  if (f.shared) continue;
  noNew.notSharedAtStart++;
  const hit = finalById.get(f.id), hits = hit ? [hit] : finalByLoose.get(f.loose) || [];
  if (hit) noNew.matchedById++; else if (hits.length) noNew.matchedByLooseKey++; else { noNew.vanished++; vanishedPairs.push(f.id); }
  for (const c of hits) if (RX.state(c).kind === 'shared') crossing.push({ pair: nm(c), id: c.id, days: c.days, was: f.id });
}
noNew.newShared = crossing.length;
const firstPairIds = new Set(firstPairs.map(f => f.id)), firstLoose = new Set(firstPairs.map(f => f.loose));
for (const c of R.pairs) if (!firstPairIds.has(c.id) && !firstLoose.has(looseKey(c.type, c.st, c.q.key, c.p.key))) {
  noNew.appeared++;
  if (RX.state(c).kind === 'shared') { noNew.appearedShared++; appearedSharedPairs.push({ pair: nm(c), id: c.id, days: c.days }); }
}
noNew.matchBy = noNew.matchedByLooseKey ? 'id，對不上的退回站＋型別＋Q 車次鍵＋P 車次鍵' : 'id';
assert.equal(crossing.length, 0, '新造穿越（原本不穿越的待避對收尾時穿越了）：' + JSON.stringify(crossing.slice(0, 10)));
assert.equal(noNew.appearedShared, 0, `收尾才出現、而且穿越的待避對 ${noNew.appearedShared} 對（前 10）：` + JSON.stringify(appearedSharedPairs.slice(0, 10)));
assert.equal(noNew.vanished, 0, `第一遍有、收尾找不到的待避對 ${noNew.vanished} 對（前 10）：` + JSON.stringify(vanishedPairs.slice(0, 10)));

// 綁定變動不得碰受保護的東西：名冊全部車次鍵（含被換股的），第一遍開始時與 R 在每一站的停車節點逐站比，
// 節點有變的站才用同一個保護判斷（R.prot：makeProtection 回傳的函式，與求解器 blockedBy 用的是同一個）檢查：
// 已驗收進路、具名修復端點、太麻里非電化月台。變動有兩種來源，失敗訊息分開記：
//   沒被換股的漂移：沒出現在任何一筆換股記錄（moves[].changes）的車次，多半是落成的新計畫改變了借用者的綁定來源；
//     blockedBy 只看換股清單裡的鍵，漂移不經過它。
//   換股後又被重綁：出現在換股記錄的車次。換股的那一步已經被 blockedBy 檢查過，這裡命中的是換股之後下一遍重建又改了綁定的結果。
// 前一種（不在換股記錄裡、有效 pathIds 有變的車次）一律不准：落成的計畫不當模板（templateEligible:false），接力專車重新綁定會分歧的
// 每次換股後也落成自己的計畫（settleRelays）。還有漂移就是這兩道沒接住，下面斷言 0；報告的 bindingDrift 照樣記件數與樣本。
const movedKeys = new Set(report.moves.flatMap(m => m.changes.map(ch => ch.key)));
const lostKeys = [...firstPlanIds.keys()].filter(k => !RS.current.has(k));
assert.equal(lostKeys.length, 0, `名冊車次鍵在重建的模型裡不見了 ${lostKeys.length} 個（前 10）：` + lostKeys.slice(0, 10).join('、'));
const drift = [], protHits = [], nodeChanged = { drift: 0, moved: 0 };
for (const [key, ids0] of firstPlanIds) {
  const ids1 = RS.current.get(key), moved = movedKeys.has(key), names = RS.trainOf.get(key).names;
  if (!moved) {
    const segs = [];
    for (let k = 0; k < Math.max(ids0.length, ids1.length); k++) if (ids0[k] !== ids1[k]) segs.push(k);
    if (segs.length) drift.push({ key, segs });
  }
  for (let j = 0; j < names.length; j++) {
    const a = RS.nodeAt(ids0, j), b = RS.nodeAt(ids1, j);
    if (a === b) continue;
    nodeChanged[moved ? 'moved' : 'drift']++;
    const why = R.prot(key, j, a, b);
    if (why) protHits.push({ moved, text: `${key} ${names[j].replace(/^[^:]*:/, '')} ${why}` });   // 站名去掉系統前綴，與其他訊息一致
  }
}
assert.equal(drift.length, 0, `沒被換股的車次綁定漂移 ${drift.length} 班（車次鍵 變動的段；前 10）：` + drift.slice(0, 10).map(d => `${d.key} ${d.segs.join(',')}`).join('；'));
const hitDrift = protHits.filter(h => !h.moved), hitRebound = protHits.filter(h => h.moved);
assert.equal(protHits.length, 0, `綁定變動碰到受保護的東西 ${protHits.length} 處（沒被換股的漂移 ${hitDrift.length} 處、換股後又被重綁 ${hitRebound.length} 處；來源 車次鍵 站 類別；各列前 10）：`
  + [...hitDrift.slice(0, 10).map(h => `沒被換股的漂移 ${h.text}`), ...hitRebound.slice(0, 10).map(h => `換股後又被重綁 ${h.text}`)].join('；'));
// 漂移也可能讓違規變多：收尾的違規數不得比第一遍開始時多
assert.ok(finalViolations <= first.violations, `違規數從 ${first.violations} 變成 ${finalViolations}`);

// 穿越（畫面上超越車穿過待避車）只准留下修了會違反硬性條件的，條件與閘門 G3 同一份（SHARED_OK_REASONS）
const sharedBad = explained.filter(e => RX.state(e.c).kind === 'shared' && !SHARED_OK_REASONS.has(e.reason));
assert.equal(sharedBad.length, 0, `穿越的原因不在准許集合內 ${sharedBad.length} 組（站 Q/P 型別 原因 天數；前 10）：` + sharedBad.slice(0, 10).map(e => `${nm(e.c)} 「${e.reason}」${e.c.days.length} 天`).join('；'));

// B／C 逐件對照（只列、不斷言）：第一遍開始時與收尾（R）的 B／C 一件一件比。換股本來就會讓別班車的 B／C 增減，
// 逐日件數的棘輪已經在上面斷言；這裡看的是「兩班車都沒被改（有效 pathIds 與第一遍開始時相同）卻新出現或消失」的件，
// 那種件不是這次換股造成的，多半是名冊綁定或模型漂移，值得看一眼。changed 旗標逐班記。
const changedNow = key => { const a = firstPlanIds.get(key), b = RS.current.get(key); return !(a && b && a.length === b.length && a.every((pid, k) => pid === b[k])); };
const withFlags = c => ({ type: c.type, day: c.day, station: c.station, trains: c.keys.map(key => ({ key, changed: changedNow(key) })) });
const nowItems = RS.allConflicts().map(itemOf), nowKeys = new Set(nowItems.map(itemKey)), firstKeys = new Set(firstItems.map(itemKey));
const bcDiff = { first: firstItems.length, final: nowItems.length,
  appeared: nowItems.filter(c => !firstKeys.has(itemKey(c))).map(withFlags), vanished: firstItems.filter(c => !nowKeys.has(itemKey(c))).map(withFlags) };
const untouchedOf = list => list.filter(x => x.trains.every(t => !t.changed)).length, countOf = (list, t) => list.filter(x => x.type === t).length;

// ── 報告內容（修不掉的清單與原因取 R 的結果）：先組好，下面才改名、寫檔，組報告時出錯就不會有任何正式名的產物 ──
const hist = {}; for (const e of explained) { const k = e.c.type + ':' + e.reason; hist[k] = (hist[k] || 0) + 1; }
const unfixable = explained.flatMap(({ c, reason }) => c.days.map(day => ({ day, type: c.type, station: c.st, q: c.q, p: c.p, ...c.at[day], ...RX.state(c), reason })));
const shortStations = [...new Set(explained.filter(e => e.reason === REASON_SHORT).map(e => e.c.st.split(':')[1]))];
const ambiguousByType = { pass: 0, stop: 0 }; for (const c of R.pairs) if (RX.state(c).kind === 'ambiguous') ambiguousByType[c.type] += c.days.length;
const nearPerDay = {}; for (const x of R.near) nearPerDay[x.day] = (nearPerDay[x.day] || 0) + 1;
// 換股依「這一組修完的狀態」分布；兩班一起換＝待避車與超越車都被直接換股（借用切片連帶換的不算）
const movesByAfterKind = {};
for (const m of report.moves) { const o = movesByAfterKind[m.cAfter?.kind ?? '（無）'] ||= { moves: 0, both: 0 }; o.moves++; if (m.moved === 2) o.both++; }
const newPlans = Object.keys(dispatch.plans).filter(k => !(k in original)).length, bothMoved = report.moves.filter(m => m.moved === 2).length;
const secs = { total: secsSince(tStart), explain: explainSecs, rebuild: rebuildSecs }, peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
const reportText = JSON.stringify({ ...report,
  before: first, after: { violations: RX.violations(), byType: RX.violationsByType(), conflicts: perDay(RS.allConflicts()), meets: R.meets.perDay(), wrong: wrongAfter, wrongPlanEntries: RS.wrongSegments(), wrongTrainsBetter }, newPaths: keep.length, newPlans,
  movesByAfterKind, bothMoved, noNewShared: noNew, conflictItemsDiff: bcDiff, unfixableByReason: hist, unfixable, shortStations, ambiguousByType, nearPerDay, bindingDrift: { count: drift.length, sample: drift.slice(0, 20) },
  secs, peakRssMB }, null, 1);

// ── 自檢全過、報告也組好了：暫存檔改成正式名（改名不重寫，交出去的位元組就是驗過的位元組），report.json 最後才寫 ──
fs.renameSync(netTmp, netFile); fs.renameSync(dispatchTmp, dispatchFile);
fs.writeFileSync(reportFile, reportText);
const bt = first.byType, at = RX.violationsByType();
console.log(`違規 通過型 ${bt.pass} → ${at.pass}、停站型 ${bt.stop} → ${at.stop} 件次；換股 ${report.moves.length} 次（兩班一起換 ${bothMoved}）、新落成計畫 ${newPlans}（落成動作 ${report.materialised} 次）、新路徑 ${keep.length}、綁定漂移 ${drift.length}`);
console.log(`換股後狀態分布 ${JSON.stringify(movesByAfterKind)}；不准新造穿越逐對核對 ${JSON.stringify(noNew)}`);
console.log(`B／C 逐件對照：第一遍 ${bcDiff.first} 件 → 收尾 ${bcDiff.final} 件；新出現 ${bcDiff.appeared.length} 件（B ${countOf(bcDiff.appeared, 'B')}／C ${countOf(bcDiff.appeared, 'C')}，兩班都沒被改 ${untouchedOf(bcDiff.appeared)}）、消失 ${bcDiff.vanished.length} 件（B ${countOf(bcDiff.vanished, 'B')}／C ${countOf(bcDiff.vanished, 'C')}，兩班都沒被改 ${untouchedOf(bcDiff.vanished)}）；明細在 report.json 的 conflictItemsDiff`);
console.log(`逆向段（名冊逐班）${first.wrong} → ${wrongAfter}、逐班變好 ${wrongTrainsBetter} 班、沒有任何一班變多；計畫表逐筆 ${first.wrongPlanEntries} → ${RS.wrongSegments()}`);
console.log(`修不掉（組）${JSON.stringify(hist)}；「${REASON_SHORT}」的站：${shortStations.join('、') || '（無）'}`);
console.log(`綁定變動保護：名冊 ${firstPlanIds.size} 個車次鍵逐站比停車節點，節點有變的站 ${nodeChanged.drift + nodeChanged.moved} 個（沒被換股的車次 ${nodeChanged.drift}、有被換股的車次 ${nodeChanged.moved}），碰到受保護的 ${protHits.length} 處`);
console.log(`收尾自檢都在暫存檔重建的模型上做：記憶體模型與重建模型的違規數、B／C、單線交會與 ${R.pairs.length} 對待避對的判定逐項相同；全過才把暫存檔改成正式名`);
console.log(`耗時 ${JSON.stringify(secs)} 秒；記憶體峰值 ${peakRssMB} MB`);
console.log('寫入', OUT_DIR);
