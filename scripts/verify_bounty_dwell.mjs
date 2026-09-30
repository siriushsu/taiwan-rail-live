// dwell 結構洞迴歸：真實單位／真實 line metadata／正式匯出函式／本機假 D1。
// 跑法：node scripts/verify_bounty_dwell.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';
import { POS_SPEED_WINDOW_REJECT, POS_SPEED_WINDOW_ACCEPT } from './bounty_guard_cases.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const UNITS = JSON.parse(readFileSync('data/bounty_units.json', 'utf8'));
// 車種用題庫裡真的有的卡（09-07 重產題庫後「其他」這個車種在新烏日尖峰已不存在，卡片 404）。
const CARD_ID = 'tra_sched|山線|0|自強|dwell|peak';
const DWELL_KEY = 'tra_sched|山線|新烏日|新烏日';
const LINE = UNITS.lines['tra_sched|山線'];
const R = [];
const ok = (name, pass, detail = '') => {
  R.push({ name, pass, detail });
  console.log(`${pass ? '  ok ' : 'FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

function trajectory({ stop, reverse = false }) {
  const stations = LINE.stations;
  const i = stations.findIndex(s => s.name === '新烏日');
  const start = stations[i - 1].d * 1000, center = stations[i].d * 1000, end = stations[i + 1].d * 1000;
  let d = start, t = 7 * 3600, n = 0;
  const pts = [{ d, t, v: 10.4, acc: 8 }];
  const push = (physicalSpeed, dopplerSpeed = null) => {
    d += physicalSpeed; t += 1; n += 1;
    const v = dopplerSpeed == null ? Math.max(0, physicalSpeed + Math.sin(n / 3) * 1.2) : dopplerSpeed;
    pts.push({ d, t, v, acc: 8 + (n % 3) });
  };
  if (stop) {
    while (d + 10 < center - 105) push(10);
    if (d < center - 105) push(center - 105 - d);
    for (let j = 1; j <= 20; j++) push(10 - 9.5 * j / 20);
    for (let j = 0; j < 5; j++) push(0.2, 0.35 + (j % 2) * 0.1);
    for (let j = 1; j <= 20; j++) push(0.5 + 9.5 * j / 20);
  }
  while (d + 10 <= end) push(10);
  const out = reverse
    ? pts.slice().reverse().map((p, i) => ({ ...p, t: 7 * 3600 + i }))
    : pts;
  return out;
}

const stopped = trajectory({ stop: true });
const passed = trajectory({ stop: false });
const reverseStopped = trajectory({ stop: true, reverse: true });
const trip = pts => ({
  actor: 'device-dwell-test', tripDate: '2026-07-29', trainNo: 'T1',
  sys: 'tra_sched', lnId: '山線', dir: 0, sampleIds: ['s1'], pts,
});

const stoppedCov = _bounty.coverageOf(trip(stopped), LINE, RULES, UNITS.peakHoursBySys);
const passedCov = _bounty.coverageOf(trip(passed), LINE, RULES, UNITS.peakHoursBySys);
ok('D1 停靠軌跡產出與 bounty_units 完全相同的 dwell segKey',
  stoppedCov.some(c => c.key === DWELL_KEY && c.kind === 'dwell' && c.slot === 'peak' && c.dir === 0),
  JSON.stringify(stoppedCov.filter(c => c.kind === 'dwell')));
ok('D2 通過不停靠不產出任何 dwell coverage',
  passedCov.every(c => c.kind !== 'dwell'), JSON.stringify(passedCov.filter(c => c.kind === 'dwell')));
const reverseTrip = { ...trip(reverseStopped), dir: 1 };
const assembledReverse = _bounty.assembleTrip([{
  actor: reverseTrip.actor, trip_date: reverseTrip.tripDate, train_no: reverseTrip.trainNo,
  sys: reverseTrip.sys, ln_id: reverseTrip.lnId, dir: 0, id: 'reverse-wrong-hint',
  payload: JSON.stringify(reverseStopped),
}]);
ok('D3 dwell 卡即使沒有跟隨班次而先送 dir=0，完整反向軌跡仍會自動判 dir=1、通過物理閘並命中 dwell',
  assembledReverse.dir === 1 &&
    _bounty.integrityGate(assembledReverse, { line: LINE, events: [], now: Date.parse('2026-07-29T08:00:00Z') }, RULES).pass &&
    _bounty.coverageOf(assembledReverse, LINE, RULES, UNITS.peakHoursBySys).some(c => c.key === DWELL_KEY),
  JSON.stringify({ dir: assembledReverse.dir,
    integrity: _bounty.integrityGate(assembledReverse, { line: LINE, events: [], now: Date.parse('2026-07-29T08:00:00Z') }, RULES) }));

const asset = name => new Response(readFileSync(`data/${name}`, 'utf8'), {
  status: 200, headers: { 'content-type': 'application/json' },
});
// 🔴 2026-09-29（路段懸賞 v2）：收滿改看「去重人數」，真設定是台鐵 50 人。這支 E2E 只有一個 actor，
// 原本要驗的是「一趟 ok 就收滿、其他車種不受影響、之後估值衰減」這個情境（D4／D7），所以把 coverDistinct
// 調成 1 人來維持它——只改門檻的數字，斷言本身一個字沒動。真設定（50）下的收滿行為在 verify_bounty_ledger.mjs。
const STUB_RULES = JSON.stringify({ ...RULES, coverDistinct: { TRA: 1, THSR: 1 } });
const ASSETS = { fetch: async request => new URL(request.url).pathname.endsWith('/bounty_units.json')
  ? asset('bounty_units.json')
  : new Response(STUB_RULES, { status: 200, headers: { 'content-type': 'application/json' } }) };
const limiter = { limit: async () => ({ success: true }) };
const NOW = Date.parse('2026-07-29T08:00:00Z');

async function e2e(actor, samples) {
  const { db, DELAY_DB } = openTestDb();
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, BOUNTY_NOW: String(NOW) };
  _bounty.bountyResetMemCaches();
  const valuation = await _bounty.bountyValuationCron(env);
  const before = db.prepare(
    "SELECT points,sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='自強'" +
    " AND dir=0 AND kind='dwell' AND slot='peak'"
  ).get(DWELL_KEY);
  const claimRes = await _bounty.bountyClaim(new Request('http://local.test/api/bounty-claim', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor, cardId: CARD_ID }),
  }), env);
  const claim = await claimRes.json();
  // 同 actor、同站／時段故意再塞另一車種的 open claim。驗證後只能關這次真正接的「自強」，
  // 不可因 coverage 本身不帶 trainKind 就把兩張卡一起完成。
  db.prepare(
    "INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status)" +
    " VALUES (?,?,?,?,0,'dwell','peak',99,?,?,'open')"
  ).run('decoy-kind', actor, DWELL_KEY, '區間車', 1, NOW + 86400000);
  const submitRes = await _bounty.bountySubmit(new Request('http://local.test/api/bounty-submit', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actor, sys: 'tra_sched', lnId: '山線', trainNo: 'T1',
      dir: 0, tripDate: '2026-07-29', batch: 1, samples,
      client: { platform: 'ios', app: '1.6.13', simulator: false },   // v2：GPS 錄程限 App，沒帶會 400 app_only
    }),
  }), env);
  const submit = await submitRes.json();
  // F24：判定只挑「乘車日早於台北今天」的樣本；這趟的乘車日 07-29 ＝ BOUNTY_NOW 那一天，今天的趟不判。
  // 所以 cron 的時鐘往後推一天（隔天那一發才會判到它）。只改時鐘，這支腳本的斷言一個字沒動；
  // 上面的估值、認領、上傳仍用原本的 NOW（乘車日窗與認領有效期都以 NOW 為準）。
  const verify = await _bounty.bountyVerifyCron({ ...env, BOUNTY_NOW: String(NOW + 86400000) });
  const after = db.prepare(
    "SELECT points,sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='自強'" +
    " AND dir=0 AND kind='dwell' AND slot='peak'"
  ).get(DWELL_KEY);
  const otherKindAfter = db.prepare(
    "SELECT sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='區間車'" +
    " AND dir=0 AND kind='dwell' AND slot='peak'"
  ).get(DWELL_KEY);
  const claimAfter = db.prepare(
    "SELECT status,points_locked FROM bounty_claims WHERE actor=? AND seg_key=? AND kind='dwell' AND slot='peak'"
  ).get(actor, DWELL_KEY);
  const decoyClaimAfter = db.prepare(
    "SELECT status,points_locked FROM bounty_claims WHERE id='decoy-kind'"
  ).get();
  const points = db.prepare('SELECT points FROM bounty_points WHERE actor=?').get(actor);
  const sample = db.prepare(
    'SELECT verdict,quality_code,reject_code,segs FROM bounty_samples WHERE actor=?'
  ).get(actor);
  const valuationAfterCovered = await _bounty.bountyValuationCron(env);
  const repriced = db.prepare(
    "SELECT points,sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='自強'" +
    " AND dir=0 AND kind='dwell' AND slot='peak'"
  ).get(DWELL_KEY);
  return {
    valuation, before, claimStatus: claimRes.status, claim,
    submitStatus: submitRes.status, submit, verify, after, otherKindAfter, claimAfter, decoyClaimAfter, points, sample,
    valuationAfterCovered, repriced,
  };
}

const stoppedE2e = await e2e('device-dwell-stop', stopped);
// 🔴 2026-09-29（路段懸賞 v2 A2-T0）：收滿改成「整段」——人數是按 seg_key 計的，同站同時段的另一車種列（區間車）
// 跟著一起收滿（covered_at 有值）；但 sample_count 仍是逐列累加，只有被計功的自強那一列 +1，區間車那列還是 0。
// 原本這裡斷言區間車列 covered_at 為空（逐列語意）；改成釘新語意，不是放寬——「沒收滿」與「收滿」是相反的判準。
ok('D4 真 D1 路徑：估值→認領→上傳→驗證後 dwell sample_count 加 1 且 covered_at 有值；同站另一車種列整段一起收滿（covered_at 有值），sample_count 仍逐列（0）',
  stoppedE2e.claimStatus === 200 && stoppedE2e.submitStatus === 200 &&
    stoppedE2e.sample.verdict === 'ok' && stoppedE2e.after.sample_count === 1 && !!stoppedE2e.after.covered_at &&
    stoppedE2e.otherKindAfter.sample_count === 0 && stoppedE2e.otherKindAfter.covered_at === stoppedE2e.after.covered_at,
  JSON.stringify({ claim: stoppedE2e.claimStatus, submit: stoppedE2e.submitStatus,
    verdict: stoppedE2e.sample.verdict, board: stoppedE2e.after, otherKind: stoppedE2e.otherKindAfter }));
ok('D5 同一路徑真的給點且只關閉該車種 dwell claim，另一車種同站 claim 保持 open',
  stoppedE2e.points.points > 0 && stoppedE2e.claimAfter.status === 'fulfilled' &&
    stoppedE2e.decoyClaimAfter.status === 'open',
  JSON.stringify({ points: stoppedE2e.points, claim: stoppedE2e.claimAfter, decoy: stoppedE2e.decoyClaimAfter }));
ok('D6 sample.segs 留下 exact dwell coverage，驗證明細沒有把 dwell 丟掉',
  JSON.parse(stoppedE2e.sample.segs).some(c => c.key === DWELL_KEY && c.kind === 'dwell' && c.slot === 'peak'),
  stoppedE2e.sample.segs);
ok('D7 dwell 收滿後仍有點但下一次估值確實衰減',
  stoppedE2e.repriced.points >= 1 && stoppedE2e.repriced.points < stoppedE2e.before.points,
  JSON.stringify({ before: stoppedE2e.before, repriced: stoppedE2e.repriced }));

const passedE2e = await e2e('device-dwell-pass', passed);
ok('D8 反例 E2E：通過不停靠時 dwell 不收樣、claim 不關',
  passedE2e.sample.verdict === 'ok' && passedE2e.after.sample_count === 0 &&
    passedE2e.claimAfter.status === 'open',
  JSON.stringify({ verdict: passedE2e.sample.verdict, board: passedE2e.after, claim: passedE2e.claimAfter }));

// ── 三個門檻的鑑別力（2026-07-29 補）─────────────────────────────────────────
// 起因：把 stopMinSec 與 sideMinM 突變成 0，D1–D8 仍然 8/8 全綠——反例那趟是高速通過，
// 光靠 stopSpeedMaxMps 就被擋掉，另外兩道閘門從來沒有被考到。下面三筆各自提供
// 「能讓它變紅的那一筆輸入」。D9 同時是使用者要的新行為：自己上下車那站只有單側樣本也要算。
const covOf = pts => _bounty.coverageOf(trip(pts), LINE, RULES, UNITS.peakHoursBySys);
const hitsDwell = pts => covOf(pts).some(c => c.key === DWELL_KEY && c.kind === 'dwell');
const iStop = LINE.stations.findIndex(s => s.name === '新烏日');
const centerM = LINE.stations[iStop].d * 1000;

// D9 起點站：停在月台上開始錄，只有出站側——中途站（新烏日不是線端）也必須算到
ok('D9 從這一站的月台開始錄（只有出站側樣本）仍算錄到——上下車那站收得到',
  hitsDwell(stopped.filter(p => Number(p.d) >= centerM - 5)),
  JSON.stringify(covOf(stopped.filter(p => Number(p.d) >= centerM - 5)).filter(c => c.kind === 'dwell')));

// D10 守 sideMinM：這趟明明走到了站前，站前那一側卻沒錄到（進站隧道沒定位）＝不算
// 洞要挖穿整個 stationWindowM，不能只挖一半——站前 240–250m 留一個點就構成「站前有樣本」了
const holeFromM = RULES.quality.dwell.stationWindowM + 10;
const holed = stopped.filter(p => {
  const d = Number(p.d);
  return !(d < centerM - 5 && d > centerM - holeFromM);   // 挖掉整段進站，但保留更早的點
});
ok('D10 這趟有走到站前、站前卻沒有樣本（隧道空洞）時不算錄到——守住 sideMinM',
  !hitsDwell(holed), JSON.stringify(covOf(holed).filter(c => c.kind === 'dwell')));

// D11 守 stopMinSec：慢速爬行通過，速度夠低但沒有連續停滿＝不算
const crawl = trajectory({ stop: true }).map(p => ({ ...p }));
let crawlT = crawl[0].t;
for (const p of crawl) { p.t = crawlT; crawlT += 1; }   // 重排時間，讓低速段只維持 2 秒
const lowIdx = crawl.map((p, i) => [p, i]).filter(([p]) => Math.abs(p.d - centerM) <= RULES.quality.dwell.stopRadiusM &&
  p.v <= RULES.quality.dwell.stopSpeedMaxMps).map(([, i]) => i);
for (let k = 2; k < lowIdx.length; k++) crawl[lowIdx[k]].v = RULES.quality.dwell.stopSpeedMaxMps + 3;
ok('D11 站心低速只維持 2 秒（慢速爬行通過）時不算錄到——守住 stopMinSec',
  !hitsDwell(crawl), JSON.stringify({ 低速點數: lowIdx.length, dwell: covOf(crawl).filter(c => c.kind === 'dwell') }));

// D12 守 posSpeedVetoMps（第十五批，第十輪獨立驗收 P1-2）：回報的速度再低，位置微分超過否決門檻（10 m/s）就不算低速。
// Android 沒有速度時送 0.0（不是 null），整趟送 0 的話通過的站全都算停靠；偽造者送 0 或任何小的數也一樣。
// 每秒一點、站心取整數公尺（位置微分在二進位下精確，邊界才比得出「剛好」），兩個方向：
//   a 每點回報 0、等速 10 m/s 通過（位置微分剛好 10，不超過）→ 信回報的 0 → 算停靠
//   b 每點回報 0、等速 10.5 m/s 通過 → 否決 → 不算；c 回報 0.3（不是剛好 0）、10.5 m/s → 一樣不算
//   d 對照：沒有速度（null）、10 m/s → 位置微分 10 ＞ 1.5 → 不算（否決只影響「有回報低速」的點，null 本來就看位置微分）
//   e 真的停靠：20 m/s 進站 → 停 60 秒（每點回報 0、GPS 每秒左右晃 ±2 m，位置微分 4 m/s）→ 20 m/s 離站 → 算停靠。
//     否決門檻若設成 stopSpeedMaxMps（1.5）這一趟就算不到——停著時 GPS 晃動的位置微分常超過 1.5，那樣會把回報 0 的誠實裝置的真停靠也否決掉。
{
  const c0 = Math.round(centerM);
  const steady = (sg, speed, v) => Array.from({ length: Math.floor(1200 / speed) + 1 },
    (_, k) => ({ d: c0 + sg * (-600 + speed * k), t: 7 * 3600 + k, v, acc: 8 }));
  const jitterStop = sg => {
    const xs = [];
    for (let k = 0; k <= 30; k++) xs.push(-600 + 20 * k);
    for (let k = 1; k <= 60; k++) xs.push(k % 2 ? 2 : -2);
    for (let k = 1; k <= 30; k++) xs.push(20 * k);
    return xs.map((x, k) => ({ d: c0 + sg * x, t: 7 * 3600 + k, v: 0, acc: 8 }));
  };
  const got = {};
  for (const sg of [1, -1]) {
    got[`a${sg}`] = hitsDwell(steady(sg, 10, 0));
    got[`b${sg}`] = hitsDwell(steady(sg, 10.5, 0));
    got[`c${sg}`] = hitsDwell(steady(sg, 10.5, 0.3));
    got[`d${sg}`] = hitsDwell(steady(sg, 10, null));
    got[`e${sg}`] = hitsDwell(jitterStop(sg));
  }
  ok('D12 [第十五批 V10 P1-2] 回報低速、位置微分超過 10 m/s 就不算停靠：回報 0 等速 10 m/s 通過 → 算、10.5 m/s → 不算、回報 0.3 的 10.5 m/s → 不算；對照：沒有速度的 10 m/s → 不算；回報 0 的真停靠（GPS 晃 ±2 m）→ 算（兩個方向）',
    [1, -1].every(sg => got[`a${sg}`] === true && got[`b${sg}`] === false && got[`c${sg}`] === false && got[`d${sg}`] === false && got[`e${sg}`] === true),
    JSON.stringify(got));
}

// D13 否決門檻少了或不合理就直接中止（第十五批）：posSpeedVetoMps 不在時 coverageOf 裡的比較式恆為假，
// Android 送 0 又會回到每站都算停靠——所以跟 quality.dwell 整段不在一樣丟 invalid bounty rule，不偷偷降級。等於 stopSpeedMaxMps 也丟（否決會蓋掉真的停靠）。
{
  const dwellWith = veto => ({ ...RULES, quality: { ...RULES.quality, dwell: { ...RULES.quality.dwell, posSpeedVetoMps: veto } } });
  const threw = rules => { try { _bounty.coverageOf(trip(stopped), LINE, rules, UNITS.peakHoursBySys); return 'no-throw'; } catch (e) { return String(e && e.message); } };
  const got = { missing: threw(dwellWith(undefined)), equal: threw(dwellWith(RULES.quality.dwell.stopSpeedMaxMps)), real: threw(RULES) };
  ok('D13 [第十五批] quality.dwell.posSpeedVetoMps 不在、或不大於 stopSpeedMaxMps → coverageOf 丟 invalid bounty rule（對照：正式設定檔不丟）',
    got.missing === 'invalid bounty rule: quality.dwell' && got.equal === 'invalid bounty rule: quality.dwell' && got.real === 'no-throw', JSON.stringify(got));
}

// D14 位置微分跟「至少 posSpeedWindowSec（5 秒）以前的那一點」比（第十七批，第十一輪獨立驗收 P2-1）。
// 第十五批跟前一點比：GPS 每一點獨立晃得大時，停著的位置微分就超過否決門檻 10，回報 0 的真停靠被否決掉。
// 每秒一點、站心取整數公尺，GPS 晃動是逐點正負交替（5 秒前那一點的晃動方向一定相反），兩個方向：
//   a 回報 0 的真停靠：20 m/s 從站前 600 m 開過來、停 12 秒（每點晃 ±8 m：跟前一點比 16 m/s，跟 5 秒前比 3.2 m/s）→ 算停靠。
//     停的頭兩點，5 秒前那一點還在進站途中（17.6、10.4 m/s）照樣否決，第三點起才低速。
//     停得短是刻意的：位置微分若改成「跟站窗第一點比」，12 秒內都還超過 10（站窗從站前 250 m 起算），這一趟就算不到。
//   b 回報 0、以 15 m/s 通過（同樣晃 ±8 m：5 秒內走 75 m ±16 m，11.8–18.2 m/s）→ 仍否決、不算。
//   c 沒有速度（null）的真停靠：20 m/s 開過來、停 30 秒（每點晃 ±2 m：跟前一點比 4 m/s＞1.5，跟 5 秒前比 0.8）→ 算停靠。
{
  const c0 = Math.round(centerM);
  const stopWith = (sg, amp, stopSec, v) => {
    const xs = [];
    for (let k = 0; k <= 30; k++) xs.push(-600 + 20 * k);
    for (let k = 1; k <= stopSec; k++) xs.push(k % 2 ? amp : -amp);
    for (let k = 1; k <= 30; k++) xs.push(20 * k);
    return xs.map((x, k) => ({ d: c0 + sg * x, t: 7 * 3600 + k, v: v === 'null' ? null : k > 30 && k <= 30 + stopSec ? 0 : v, acc: 8 }));
  };
  const jitterPass = sg => Array.from({ length: 81 }, (_, k) => ({ d: c0 + sg * (-600 + 15 * k + (k % 2 ? 8 : -8)), t: 7 * 3600 + k, v: 0, acc: 8 }));
  const got = {};
  for (const sg of [1, -1]) {
    got[`a${sg}`] = hitsDwell(stopWith(sg, 8, 12, 20));
    got[`b${sg}`] = hitsDwell(jitterPass(sg));
    got[`c${sg}`] = hitsDwell(stopWith(sg, 2, 30, 'null'));
  }
  ok('D14 [第十七批 V11 P2-1] 位置微分跟 5 秒前那一點比：回報 0 的真停靠、GPS 每點晃 ±8 m → 算；回報 0、15 m/s 通過（同樣晃 ±8 m）→ 不算；沒有速度的真停靠、晃 ±2 m → 算（兩個方向；跟前一點比的話 a、c 都算不到）',
    [1, -1].every(sg => got[`a${sg}`] === true && got[`b${sg}`] === false && got[`c${sg}`] === true), JSON.stringify(got));
}

// D15 posSpeedWindowSec 少了或小於 1 就直接中止（第十七批）：找不到基準點，位置微分就沒有定義。
//   第十八批（第十二輪獨立驗收 P3-3）：字串 "5" 不收（舊版轉型成 5 照跑）；超過 10 秒也中止（60 秒的窗比停靠還長，沒有速度的停靠整段拿不到低速）。
//   對照：1、10（兩端）與正式設定檔不丟。
//   第十九批（第十三輪 P3-3）：加 10.5，案例改從 scripts/bounty_guard_cases.mjs 拿（網頁的 D 用同一份）。
//   第二十批（第十四輪 P3-2）：加緊貼兩端外側的 0.9375、10.0625；這幾個值還在不在清單上，這裡另外手寫核對。
{
  const dwellWith = w => ({ ...RULES, quality: { ...RULES.quality, dwell: { ...RULES.quality.dwell, posSpeedWindowSec: w } } });
  const threw = rules => { try { _bounty.coverageOf(trip(stopped), LINE, rules, UNITS.peakHoursBySys); return 'no-throw'; } catch (e) { return String(e && e.message); } };
  const got = { ...Object.fromEntries([...POS_SPEED_WINDOW_REJECT, ...POS_SPEED_WINDOW_ACCEPT].map(([k, w]) => [k, threw(dwellWith(w))])), real: threw(RULES) };
  const E = 'invalid bounty rule: quality.dwell';
  ok('D15 [第十七批／第十八批 V12 P3-3／第十九批 V13 P3-3／第二十批 V14 P3-2] quality.dwell.posSpeedWindowSec 不在、是 0、0.5、0.9375、字串 "5"、10.0625、10.5、60 或 Infinity → coverageOf 丟 invalid bounty rule；1、10 與正式設定檔不丟（案例與網頁的 D 共用）',
    [0.9375, 10.0625, 10.5].every(v => POS_SPEED_WINDOW_REJECT.some(([, w]) => w === v)) && POS_SPEED_WINDOW_REJECT.every(([k]) => got[k] === E) &&
      POS_SPEED_WINDOW_ACCEPT.every(([k]) => got[k] === 'no-throw') && got.real === 'no-throw', JSON.stringify(got));
}

// D16 位置微分往回看幾秒，照設定檔的 posSpeedWindowSec（第十七批）：D14 a 的停法（回報 0、每點晃 ±8 m），停 8 秒，
//   5（正式值）→ 算（停下第 3 秒起，5 秒前的點已經在站前 40 m 內，連續 5 秒低速）；1（跟前一點比，16 m/s 被否決）→ 不算；
//   10（守門的上限）→ 不算（10 秒前的點還在進站途中，只剩最後 2 秒低速，不到 stopMinSec 3 秒）。
//   程式把 5 寫死、或自己乘了倍數（×2 或 ×½），1、5、10 至少有一個結果不會照著變。（第十八批以前用 12 秒的停法配 30 秒的窗；上限 10 之後改成這一組。）
{
  const c0 = Math.round(centerM);
  const jstop = sg => {
    const xs = [];
    for (let k = 0; k <= 30; k++) xs.push(-600 + 20 * k);
    for (let k = 1; k <= 8; k++) xs.push(k % 2 ? 8 : -8);
    for (let k = 1; k <= 30; k++) xs.push(20 * k);
    return xs.map((x, k) => ({ d: c0 + sg * x, t: 7 * 3600 + k, v: k > 30 && k <= 38 ? 0 : 20, acc: 8 }));
  };
  const withWin = w => ({ ...RULES, quality: { ...RULES.quality, dwell: { ...RULES.quality.dwell, posSpeedWindowSec: w } } });
  const hitsWith = (pts, rules) => _bounty.coverageOf(trip(pts), LINE, rules, UNITS.peakHoursBySys).some(c => c.key === DWELL_KEY && c.kind === 'dwell');
  // 包 try（第二十批，第十四輪 P3-6）：守門被改緊（例如 1 秒也不收）時 coverageOf 會丟錯，這裡印 FAIL 繼續跑，不讓整支中止。
  const got = {};
  try { for (const sg of [1, -1]) for (const w of [1, 5, 10]) got[`w${w}_${sg}`] = hitsWith(jstop(sg), withWin(w)); }
  catch (e) { got.threw = String((e && e.message) || e); }
  ok('D16 [第十七批] 位置微分往回看的秒數照設定檔：D14 a 的停法停 8 秒，posSpeedWindowSec＝5 → 算；＝1 → 不算（跟前一點比被否決）；＝10 → 不算（停 8 秒，10 秒前的點還在進站途中）（兩個方向）',
    RULES.quality.dwell.posSpeedWindowSec === 5 && [1, -1].every(sg => got[`w5_${sg}`] === true && got[`w1_${sg}`] === false && got[`w10_${sg}`] === false),
    JSON.stringify(got));
}

const out = {
  criterion: RULES.quality.dwell,
  cardId: CARD_ID,
  dwellKey: DWELL_KEY,
  stoppedSamples: stopped.length,
  passThroughSamples: passed.length,
  assertions: R,
  stoppedE2e,
  passedE2e,
};
mkdirSync('scratchpad', { recursive: true });   // scratchpad/ 被 .gitignore 忽略，乾淨的 worktree 裡沒有（第六輪獨立驗收 D-1：寫檔丟 ENOENT、整支假紅）
writeFileSync('scratchpad/bounty_dwell_e2e_fixed.json', JSON.stringify(out, null, 2) + '\n');
const pass = R.filter(x => x.pass).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
