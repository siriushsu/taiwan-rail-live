// dwell 結構洞迴歸：真實單位／真實 line metadata／正式匯出函式／本機假 D1。
// 跑法：node scripts/verify_bounty_dwell.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const UNITS = JSON.parse(readFileSync('data/bounty_units.json', 'utf8'));
const CARD_ID = 'tra_sched|山線|0|其他|dwell|peak';
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
const ASSETS = { fetch: async request =>
  asset(new URL(request.url).pathname.endsWith('/bounty_units.json') ? 'bounty_units.json' : 'bounty_rules.json') };
const limiter = { limit: async () => ({ success: true }) };
const NOW = Date.parse('2026-07-29T08:00:00Z');

async function e2e(actor, samples) {
  const { db, DELAY_DB } = openTestDb();
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, BOUNTY_NOW: String(NOW) };
  _bounty.bountyResetMemCaches();
  const valuation = await _bounty.bountyValuationCron(env);
  const before = db.prepare(
    "SELECT points,sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='其他'" +
    " AND dir=0 AND kind='dwell' AND slot='peak'"
  ).get(DWELL_KEY);
  const claimRes = await _bounty.bountyClaim(new Request('http://local.test/api/bounty-claim', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor, cardId: CARD_ID }),
  }), env);
  const claim = await claimRes.json();
  // 同 actor、同站／時段故意再塞另一車種的 open claim。驗證後只能關這次真正接的「其他」，
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
    }),
  }), env);
  const submit = await submitRes.json();
  const verify = await _bounty.bountyVerifyCron(env);
  const after = db.prepare(
    "SELECT points,sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='其他'" +
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
    "SELECT points,sample_count,covered_at FROM bounty_board WHERE seg_key=? AND train_kind='其他'" +
    " AND dir=0 AND kind='dwell' AND slot='peak'"
  ).get(DWELL_KEY);
  return {
    valuation, before, claimStatus: claimRes.status, claim,
    submitStatus: submitRes.status, submit, verify, after, otherKindAfter, claimAfter, decoyClaimAfter, points, sample,
    valuationAfterCovered, repriced,
  };
}

const stoppedE2e = await e2e('device-dwell-stop', stopped);
ok('D4 真 D1 路徑：估值→認領→上傳→驗證後 dwell sample_count 加 1 且 covered_at 有值',
  stoppedE2e.claimStatus === 200 && stoppedE2e.submitStatus === 200 &&
    stoppedE2e.sample.verdict === 'ok' && stoppedE2e.after.sample_count === 1 && !!stoppedE2e.after.covered_at &&
    stoppedE2e.otherKindAfter.sample_count === 0 && !stoppedE2e.otherKindAfter.covered_at,
  JSON.stringify({ claim: stoppedE2e.claimStatus, submit: stoppedE2e.submitStatus,
    verdict: stoppedE2e.sample.verdict, board: stoppedE2e.after }));
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
writeFileSync('scratchpad/bounty_dwell_e2e_fixed.json', JSON.stringify(out, null, 2) + '\n');
const pass = R.filter(x => x.pass).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
