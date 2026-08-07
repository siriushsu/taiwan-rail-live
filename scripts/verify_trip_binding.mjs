#!/usr/bin/env node
// 逐班綁定器(工項1-3)驗收:設計書 §10 R1/R2/R3/R4/R7/R8。純函式段落(R1/R2/R3/R7/R8+語料回放)
// 零外部依賴;R4(冷啟動等價)起本機 wrangler+D1,從乾淨 detached worktree 起 server
// (memory wrangler-local-verification-traps 坑7:工作樹起會陷入重載風暴、永遠不服務)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  buildTrtcModel, buildLedgerFromRaw, trtcServiceDay,
  bindTracksToTrips, buildTripSetsByLineDir, tripKeyOf, tripRosterActive, tripLegIndex, trtcServiceSecOfEpoch,
} from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIND_MODULE = path.join(ROOT, 'scripts/trtc_board_ledger.mjs');
const output = [];
let failures = 0;
const say = s => { output.push(s); console.log(s); };
const ok = (condition, label, detail = '') => {
  if (!condition) failures++;
  say(`${condition ? '✅' : '❌'} ${label}${detail ? `:${detail}` : ''}`);
  return condition;
};
const note = (label, detail) => say(`⚠️ ${label}:${detail}`);
const md5 = data => crypto.createHash('md5').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const curl = (url, args = []) => execFileSync('curl', ['-k', '-sS', ...args, url], { encoding: 'utf8' });
const jsonCurl = (url, args = []) => JSON.parse(curl(url, args));

// ═══ Gate 0:自檢驗的目標(心得32——防驗到別的樹/舊快取) ═══
say(`【受測模組】${BIND_MODULE}`);
say(`【md5】${md5(fs.readFileSync(BIND_MODULE))}`);
const importedPath = fileURLToPath(new URL('./trtc_board_ledger.mjs', import.meta.url));
ok(importedPath === BIND_MODULE, 'Gate0 import 路徑即本 worktree 檔案', importedPath);
ok(typeof bindTracksToTrips === 'function' && typeof buildTripSetsByLineDir === 'function' &&
   typeof tripKeyOf === 'function' && typeof tripRosterActive === 'function',
  'Gate0 目標函式皆已成功 import', 'bindTracksToTrips/buildTripSetsByLineDir/tripKeyOf/tripRosterActive');

// ═══ 合成 fixture 小工具(R1/R2/R3/R7/R8 共用) ═══
const LINE = 'R', DIR = 2, HW = 300; // 300s 頭距,貼近尖峰班距
const BASE_MIDNIGHT_EPOCH = Date.UTC(2026, 7, 3, 16, 0, 0) / 1000; // 台北 2026-08-04 00:00:00
const secToEpoch = sec => BASE_MIDNIGHT_EPOCH + sec; // 只用於 04:00 後(sec>=14400),無跨夜折返疑慮
const T0 = 8 * 3600; // 08:00 起算,5 班 300s 頭距落在 08:00-08:20,遠離 04:00 切點

function mkTrip(st0, t0, legs) { const tr = [st0, t0]; for (const [to, arr] of legs) tr.push(to, arr); return tr; }
function mkNarrowTrip(t0) { return mkTrip(0, t0, [[1, t0 + 200]]); } // 2 站,200s 短窗,R1/R8 用(黏性續算不查視窗,故意留窄凸顯這點)
function mkWideTrip(t0) { return mkTrip(0, t0, [[1, t0 + 120], [2, t0 + 7200]]); } // 末段給 2 小時,R2/R3/R7 用,防出生匹配當下視窗已到期混淆
function buildSeries(n, startSec, wide = false) {
  const trips = []; for (let i = 0; i < n; i++) trips.push(wide ? mkWideTrip(startSec + i * HW) : mkNarrowTrip(startSec + i * HW));
  return trips;
}
function tripSetsOf(trips) { const m = new Map(); m.set(`${LINE}|${DIR}`, trips); return m; }
// 終點站出發型觀測:destIdx/to 取 tr 最終站,depSec=arrSec(terminal),δ 為相對 tr[1](排定發車)的偏移秒數。
function terminalClaim(trackId, tr, deltaSec) {
  const depSec = tr[1] + deltaSec;
  return { trackId, line: LINE, dir: DIR, from: tr[0], to: tr[tr.length - 2], destIdx: tr[tr.length - 2],
    arrEpoch: secToEpoch(depSec), run: 0, terminal: true };
}
const dayOf = nowEpoch => trtcServiceDay(nowEpoch);
function seedRefBinding(shift, boundEpoch) {
  return { line: LINE, dir: DIR, tripKey: '__seed__', trackId: '__seed_ref__', boundEpoch, birth: 'terminal',
    lastShift: shift, lastTo: null, lastArrEpoch: null, badStreak: 0, done: false, rebinds: 0 };
}
function findBinding(bindings, trackId) { return (bindings || []).find(b => b.trackId === trackId && !b.done); }

// ── 現行前端純 |shift| 最小化算法的獨立複刻(R1/R2 對照組;不含 ref/cap/FIFO/黏性,鏡射 applyTrtcBoard) ──
function naiveMinShiftBind(tripSets, claim, nowEpoch) {
  const nowSec = trtcServiceSecOfEpoch(nowEpoch);
  const depSec = trtcServiceSecOfEpoch(claim.arrEpoch);
  let best = null;
  for (const tr of tripSets.get(`${claim.line}|${claim.dir}`) || []) {
    if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== claim.destIdx || tr[0] !== claim.from) continue;
    const cost = Math.abs(depSec - tr[1]);
    if (!best || cost < best.cost) best = { tripKey: tripKeyOf(tr), cost };
  }
  return best;
}

// ── 拆掉前驅單調(FIFO)的獨立複刻(R7 對照組;保留 ref/cap,只拿掉 latestDepByRoute 檢查) ──
function bindWithoutFifo(tripSets, priorBindings, claim, nowEpoch) {
  const nowSec = trtcServiceSecOfEpoch(nowEpoch);
  const occupied = new Set((priorBindings || []).map(p => `${p.line}|${p.dir}|${p.tripKey}`));
  const shifts = (priorBindings || []).filter(p => !p.done).map(p => p.lastShift || 0).sort((a, b) => a - b);
  const ref = shifts.length ? shifts[Math.floor((shifts.length - 1) / 2)] : 0;
  const depSec = trtcServiceSecOfEpoch(claim.arrEpoch);
  let best = null;
  for (const tr of tripSets.get(`${claim.line}|${claim.dir}`) || []) {
    if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== claim.destIdx || tr[0] !== claim.from) continue;
    const fullKey = `${claim.line}|${claim.dir}|${tripKeyOf(tr)}`;
    if (occupied.has(fullKey)) continue;
    const shift = depSec - tr[1];
    if (shift < -90) continue;
    const cost = Math.abs(shift - ref);
    if (cost > 600 || Math.abs(shift) > 1800) continue;
    // 刻意不檢查前驅單調——這正是被拆掉的那一段
    if (!best || cost < best.cost) best = { tripKey: tripKeyOf(tr), tr, cost, shift };
  }
  return best;
}

say('\n── R1:單車誤點>半頭距,黏性不轉班;對照組(現行純 |shift| 最小化)須誤判 ──');
{
  const trips = buildSeries(5, T0);
  const tripSets = tripSetsOf(trips);
  const round1Now = secToEpoch(T0 + 2 * HW + 5);
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('t1', trips[2], 0)],
    priorBindings: [], nowEpoch: round1Now, day: dayOf(round1Now) });
  const r1a = findBinding(b1.bindings, 't1');
  ok(!!r1a && r1a.tripKey === tripKeyOf(trips[2]), 'R1 出生正確綁到 trip[2]', JSON.stringify(r1a));

  const DELTA = 350; // >H(300),確保連現行黏性續算路徑本身(不靠naiveMinShiftBind)在強制清空時也會選錯,供 R8 沿用同一組數字
  const claim2 = terminalClaim('t1', trips[2], DELTA);
  const round2Now = secToEpoch(T0 + 2 * HW + DELTA + 5);
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claim2],
    priorBindings: b1.bindings, nowEpoch: round2Now, day: dayOf(round2Now) });
  const r1b = findBinding(b2.bindings, 't1');
  ok(!!r1b && r1b.tripKey === tripKeyOf(trips[2]) && r1b.boundEpoch === r1a.boundEpoch,
    'R1 誤點 350s(>H)後仍黏在同一班(boundEpoch 未變=延續非重綁)',
    `tripKey=${r1b && r1b.tripKey}, boundEpoch ${r1a.boundEpoch}->${r1b && r1b.boundEpoch}`);
  ok(!!r1b && Math.abs(r1b.lastShift - DELTA) < 1, 'R1 修正後 shift 精確反映延遲(合成 fixture 誤差<1s ⇒ 位置誤差<1站)',
    `lastShift=${r1b && r1b.lastShift}`);

  const naive = naiveMinShiftBind(tripSets, claim2, round2Now);
  ok(!!naive && naive.tripKey !== tripKeyOf(trips[2]), 'R1 對照組(現行 |shift| 最小化)在同一輸入上誤判到別班',
    `naive 選到 ${naive && naive.tripKey}(正解 ${tripKeyOf(trips[2])})`);
}

say('\n── R2:系統性誤點 0.5H/1H/1.5H(ref 已建立)出生正確歸位;對照組(拆 ref)須從 1H 起轉紅 ──');
{
  for (const delta of [150, 300, 450]) {
    // wide trips:δ 最大 450s,窄 trip 的 200s 視窗會在觀測當下就已到期(trip[2] 自己都會被
    // tripRosterActive 排除,連對照組要「選錯到誰」都測不準);寬視窗確保出生匹配當下每一班仍在候選池。
    const trips = buildSeries(5, T0 + delta * 7, true); // 各 δ 用不同起點,避免三輪互相污染
    const tripSets = tripSetsOf(trips);
    const claim = terminalClaim('realTrack', trips[2], delta);
    const now = secToEpoch(trips[2][1] + delta) + 30; // now 綁在「這筆觀測本身實際發生的時刻」,不是固定公式
    const seedNow = now - 60; // seed 60s 前已存在,落在 20 分鐘 ref 窗內
    const b = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claim],
      priorBindings: [seedRefBinding(delta, seedNow)], nowEpoch: now, day: dayOf(now) });
    const r = findBinding(b.bindings, 'realTrack');
    ok(!!r && r.tripKey === tripKeyOf(trips[2]), `R2 δ=${delta}s(${(delta / HW).toFixed(1)}H) ref 已建立 ⇒ 正確歸位自己的班次`,
      `選到 ${r && r.tripKey}(正解 ${tripKeyOf(trips[2])})`);

    const naive = naiveMinShiftBind(tripSets, claim, now); // 對照組:cost=|shift|,無 ref(等同 ref 恆 0)
    if (delta >= 300) {
      ok(!!naive && naive.tripKey !== tripKeyOf(trips[2]),
        `R2 對照組(拆 ref)δ=${delta}s 轉紅——鄰班 cost 更小`, `naive 選到 ${naive && naive.tripKey}`);
    } else {
      note(`R2 對照組 δ=${delta}s(0.5H)`, `naive 選到 ${naive && naive.tripKey}(0.5H 邊界,插入序決定平手勝負,不硬性斷言)`);
    }
  }
}

say('\n── R3:班次取消(從未出現任何 track),不产生連鎖錯位,取消班永不被綁 ──');
{
  // wide trips:c0(trip[0])與 c2(trip[2])共用同一個 now,若用窄 trip,trip[0] 的 200s 視窗
  // 在 now(=trip[2] 的時刻)早就到期,連候選都進不去(誤判成「無法歸位」而非真的驗到 R3 的主張)。
  const trips = buildSeries(3, T0 + 9999, true);
  const tripSets = tripSetsOf(trips);
  const now = secToEpoch(T0 + 9999 + 2 * HW) + 5;
  const b = bindTracksToTrips({ model: null, tripSets, dayType: '平日',
    tracks: [terminalClaim('c0', trips[0], 0), terminalClaim('c2', trips[2], 0)],
    priorBindings: [], nowEpoch: now, day: dayOf(now) });
  const r0 = findBinding(b.bindings, 'c0'), r2 = findBinding(b.bindings, 'c2');
  ok(!!r0 && r0.tripKey === tripKeyOf(trips[0]), 'R3 trip[0] 正確歸位', JSON.stringify(r0 && r0.tripKey));
  ok(!!r2 && r2.tripKey === tripKeyOf(trips[2]), 'R3 trip[2] 正確歸位,未被推移到取消班的鄰位', JSON.stringify(r2 && r2.tripKey));
  const claimedTripKey1 = (b.bindings || []).some(x => x.tripKey === tripKeyOf(trips[1]));
  ok(!claimedTripKey1, 'R3 取消班(trip[1])全程無人綁定', `bindings 含 trip[1]=${claimedTripKey1}`);
}

say('\n── R7:前驅單調(FIFO),已綁較晚班次後不可再綁更早班次;對照組(拆 FIFO)須產生時序倒置 ──');
{
  const [tripA, tripB] = buildSeries(2, T0 + 20000, true); // wide window,防視窗到期confound
  const tripSets = tripSetsOf([tripA, tripB]);
  const now1 = secToEpoch(T0 + 20000 + HW) + 5;
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('late', tripB, 0)],
    priorBindings: [], nowEpoch: now1, day: dayOf(now1) });
  const rLate = findBinding(b1.bindings, 'late');
  ok(!!rLate && rLate.tripKey === tripKeyOf(tripB), 'R7 前置:track late 先綁到較晚班次 tripB', JSON.stringify(rLate && rLate.tripKey));

  const claimEarly = terminalClaim('early', tripA, 0);
  const now2 = now1 + 30;
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claimEarly],
    priorBindings: b1.bindings, nowEpoch: now2, day: dayOf(now2) });
  const rEarly = findBinding(b2.bindings, 'early');
  ok(!rEarly, 'R7 track early 想綁更早的 tripA 被前驅單調擋下(tripA 本身未過期/未被占用,唯一擋因是 FIFO)',
    rEarly ? `卻綁到了 ${rEarly.tripKey}` : '正確 unbound');

  const mutant = bindWithoutFifo(tripSets, b1.bindings, claimEarly, now2);
  const inverted = !!mutant && mutant.tripKey === tripKeyOf(tripA);
  ok(inverted, 'R7 對照組(拆前驅單調)early 成功綁進 tripA ⇒ 產生時序倒置(後綁的紀錄反而發車更早)',
    `mutant 選到 ${mutant && mutant.tripKey}(tripA 發車 ${tripA[1]} < tripB 發車 ${tripB[1]},但 tripB 早綁)`);
}

say('\n── R8:強制每輪重配(黏性 mutation),同一份真實函式在清空 priorBindings 下必須重現 R1 的誤判 ──');
{
  const trips = buildSeries(5, T0 + 40000);
  const tripSets = tripSetsOf(trips);
  const round1Now = secToEpoch(T0 + 40000 + 2 * HW + 5);
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('t8', trips[2], 0)],
    priorBindings: [], nowEpoch: round1Now, day: dayOf(round1Now) });
  ok(!!findBinding(b1.bindings, 't8'), 'R8 前置:round1 正常出生', '');

  const DELTA = 350;
  const claim2 = terminalClaim('t8', trips[2], DELTA);
  const round2Now = secToEpoch(T0 + 40000 + 2 * HW + DELTA + 5);
  // mutation:不像 R1 把 b1.bindings 傳進去,強制清空——模擬「每輪都重猜」
  const bMutant = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claim2],
    priorBindings: [], nowEpoch: round2Now, day: dayOf(round2Now) });
  const rMutant = findBinding(bMutant.bindings, 't8');
  ok(!!rMutant && rMutant.tripKey !== tripKeyOf(trips[2]), 'R8 強制清空 priorBindings ⇒ 同一顆真實函式也誤判到鄰班(=R1 轉紅)',
    `mutant 選到 ${rMutant && rMutant.tripKey}(正解 ${tripKeyOf(trips[2])});證明 R1 過關靠的是黏性,不是巧合`);
}

// ═══ 語料回放:~/Code/軌島-語料/trtc-peak-0803(唯讀)全鏈跑一遍,不拋例外、unbound 率 <20% ═══
say('\n── 語料回放:trtc-peak-0803 全鏈(buildLedgerFromRaw→bindTracksToTrips 逐快照串接) ──');
const CORPUS = process.env.TRTC_FIXTURE_DIR || '/Users/xuxiang/Code/軌島-語料/trtc-peak-0803';
function trackUpdateAsPrior(x) {
  return { day: x.day, track_id: x.trackId, line: x.line, dir: x.dir, station_idx: x.stationIdx,
    progress: x.progress, official_no: x.officialNo, crowd: x.crowd == null ? null : JSON.stringify(x.crowd),
    evidence: x.evidence, evidence_epoch: x.evidenceEpoch, last_seen_epoch: x.lastSeenEpoch,
    payload: JSON.stringify(x.payload) };
}
function aliasUpdateAsPrior(x) {
  return { day: x.day, alias_type: x.aliasType, alias: x.alias, track_id: x.trackId,
    first_seen_epoch: x.epoch, last_seen_epoch: x.epoch };
}
function eventAsHistory(x) {
  return { day: x.day, line: x.line, dir: x.dir, train_key: x.trackId, station_idx: x.stationIdx,
    kind: x.kind, epoch: x.epoch, src: x.src, state: x.state };
}
let corpusSummary = null;
try {
  const epochOf = value => {
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : null;
  };
  const loadKind = kind => fs.readdirSync(CORPUS).filter(f => f.startsWith(`snap_${kind}_`)).sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(CORPUS, file))));
  const tkSnaps = loadKind('tk'), hwSnaps = loadKind('hw'), brSnaps = loadKind('br');
  const held = (snaps, at) => [...snaps].reverse().find(s => s.fetchedAtEpoch <= at) || null;
  const model = buildTrtcModel(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json'))),
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json'))),
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json'))),
    { includeY: true });
  const times = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json')));
  const dayTypeTable = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json')));

  let priorTracks = [], aliases = [], historicalEvents = [], priorBindings = [];
  let tripSetsCache = null, tripSetsDay = null;
  const audit = { bound: 0, unbound: 0, rebinds: 0, capped: 0, done: 0, legMiss: 0, malformed: 0, rounds: 0 };
  // 診斷分母:對每一筆本輪才出生、又沒綁上的 claim,分類「真的無候選(destIdx/roster 都配不到)」
  // vs「有合理候選(cost 在絕對值上限內)但仍未綁上(=輸給別人佔用,或被 FIFO 水位擋下)」——
  // 用來把 unbound 率拆成「潛在演算法問題」與「FIFO 設計本來就會有的取捨」兩種不同性質的數字。
  const diag = { noCandidate: 0, hadGoodCandidateButLost: 0, other: 0 };
  for (const tk of tkSnaps) {
    const hw = held(hwSnaps, tk.fetchedAtEpoch), br = held(brSnaps, tk.fetchedAtEpoch);
    const nowEpoch = Math.max(...tk.rows.map(r => epochOf(r.NowDateTime) || 0));
    const day = trtcServiceDay(nowEpoch);
    const built = buildLedgerFromRaw({ model, boardRows: tk.rows, hwRows: hw ? hw.rows : [], brRows: br ? br.rows : [],
      epochOf, priorTracks, aliases, historicalEvents, nowEpoch, day });
    priorTracks = built.trackUpdates.map(trackUpdateAsPrior);
    aliases = aliases.concat(built.aliasUpdates.map(aliasUpdateAsPrior));
    historicalEvents = historicalEvents.concat(built.events.map(eventAsHistory));

    if (tripSetsDay !== day) { tripSetsCache = buildTripSetsByLineDir(times, dayTypeTable, day); tripSetsDay = day; }
    const dayType = tripSetsCache.dayKeys.get('BL') || null;
    const nowSec = trtcServiceSecOfEpoch(nowEpoch);
    const beforeIds = new Set((priorBindings || []).filter(b => !b.done).map(b => b.trackId));
    const bindOut = bindTracksToTrips({ model, tripSets: tripSetsCache.tripSets, dayType, tracks: built.claims,
      priorBindings, nowEpoch, day });
    const afterIds = new Set(bindOut.bindings.filter(b => !b.done).map(b => b.trackId));
    for (const c of built.claims) {
      if (beforeIds.has(c.trackId) || afterIds.has(c.trackId)) continue; // 沿用中或這輪綁上,不算失敗嘗試
      let anyCandidate = false, anyGoodCost = false;
      for (const tr of tripSetsCache.tripSets.get(`${c.line}|${c.dir}`) || []) {
        if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== c.destIdx) continue;
        let scheduledEvent;
        if (c.terminal) { if (tr[0] !== c.from) continue; scheduledEvent = tr[1]; }
        else { const k = tripLegIndex(tr, c.from, c.to); if (k < 0) continue; scheduledEvent = tr[(k - 1) * 2 + 1]; }
        anyCandidate = true;
        const depSec = c.terminal ? trtcServiceSecOfEpoch(c.arrEpoch) : trtcServiceSecOfEpoch(c.arrEpoch) - c.run;
        const shift = depSec - scheduledEvent;
        if (shift >= -90 && Math.abs(shift) <= 1800) anyGoodCost = true;
      }
      if (!anyCandidate) diag.noCandidate++; else if (anyGoodCost) diag.hadGoodCandidateButLost++; else diag.other++;
    }
    priorBindings = bindOut.bindings;
    for (const k of ['bound', 'unbound', 'rebinds', 'capped', 'done', 'legMiss', 'malformed']) audit[k] += bindOut.audit[k];
    audit.rounds++;
  }
  const totalAttempts = audit.bound + audit.unbound;
  const unboundRate = totalAttempts ? audit.unbound / totalAttempts : 0;
  corpusSummary = { ...audit, totalAttempts, unboundRate, diag };
  ok(true, '語料回放全鏈未拋例外', `${audit.rounds} 輪`);
  const diagTotal = diag.noCandidate + diag.hadGoodCandidateButLost + diag.other;
  note('語料回放 unbound 根因拆解(非本函式的判準,純供人判讀)',
    `無候選(destIdx/roster配不到)=${diag.noCandidate}(${diagTotal ? (diag.noCandidate / diagTotal * 100).toFixed(1) : 0}%) / ` +
    `有合理候選卻未綁上(佔用競爭輸或FIFO水位擋)=${diag.hadGoodCandidateButLost}(${diagTotal ? (diag.hadGoodCandidateButLost / diagTotal * 100).toFixed(1) : 0}%) / ` +
    `其餘=${diag.other}`);
  ok(unboundRate < 0.20, '語料回放 unbound 率 <20%(此語料快照間距 3.5-7 分鐘,遠寬於正式站 cron 節奏,' +
    '預期會比正式環境更容易踩到 FIFO 水位——見上一行根因拆解,紅燈不必然代表演算法有誤)',
    `unbound=${audit.unbound}/${totalAttempts}=${(unboundRate * 100).toFixed(1)}%`);
  note('語料回放完整 audit', JSON.stringify(audit));
} catch (e) {
  ok(false, '語料回放全鏈未拋例外', `拋出:${(e && e.stack) || String(e)}`);
}

// ═══ 既有測試零回歸:node scripts/verify_board_ledger.mjs 照跑全綠 ═══
say('\n── 零回歸:verify_board_ledger.mjs ──');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/verify_board_ledger.mjs')],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  ok(/\nPASS: B1 V1–V9 驗收完成/.test(out) || /\nPASS: B1 V1-V9 驗收完成/.test(out),
    'verify_board_ledger.mjs 全綠(零回歸)', out.trim().split('\n').slice(-1)[0]);
} catch (e) {
  const outText = (e && (e.stdout || '')) + '' ;
  ok(false, 'verify_board_ledger.mjs 全綠(零回歸)',
    `exit=${e && e.status};尾行:${outText.trim().split('\n').slice(-3).join(' / ')}`);
}

// ═══ R4:冷啟動等價(需 D1)——本機 wrangler,從乾淨 detached worktree 起 server ═══
say('\n── R4:冷啟動等價(D1 round-trip)——起本機 wrangler,乾淨 detached worktree ──');
const FIXTURE_PORT = Number(process.env.TRTC_BIND_FIXTURE_PORT || 43287);
const WORKER_PORT = Number(process.env.TRTC_BIND_WORKER_PORT || 43289);
const INSPECTOR_PORT = Number(process.env.TRTC_BIND_INSPECTOR_PORT || 43290);
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const BASE = `https://127.0.0.1:${WORKER_PORT}`;

async function waitFor(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server ready timeout: ${buf.slice(-2000)}`)), timeoutMs);
    const onData = chunk => { buf += String(chunk); if (pattern.test(buf)) { clearTimeout(timer); resolve(buf); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${buf.slice(-2000)}`)); });
  });
}
async function waitForHttp(url, timeoutMs, child) {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const deadline = Date.now() + timeoutMs;
    let last = '(還沒送出任何請求)';
    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
      try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); await r.text(); return r.status; }
      catch (e) { last = String((e && e.message) || e); }
      await new Promise(res => setTimeout(res, 1000));
    }
    throw new Error(`server ready timeout:${timeoutMs}ms 內 ${url} 一個 HTTP 回應都沒給(最後一次:${last})`);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}
function findLedgerDb(dbDir) {
  for (const file of fs.existsSync(dbDir) ? fs.readdirSync(dbDir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : []) {
    const db = new DatabaseSync(path.join(dbDir, file));
    try { db.prepare('SELECT COUNT(*) FROM trtc_events').get(); return db; } catch { db.close(); }
  }
  throw new Error('找不到 local TRTC_LEDGER SQLite');
}

let vtree = null, fixtureProc = null, workerProc = null;
if (process.env.TRTC_BIND_SKIP_R4 === '1') {
  note('R4 本輪跳過', 'TRTC_BIND_SKIP_R4=1(僅供快速迭代純函式段落用,正式驗收不得帶此旗標)');
} else
try {
  // 乾淨 detached worktree(memory 坑7 鐵則):工作樹本身有大量未追蹤/已修改檔案,直接在 ROOT
  // 起 wrangler dev 有落入重載風暴(~5次/秒,永遠不服務)的實測前例;HEAD 已含工項1-3(剛提交的三顆)。
  const scratchBase = process.env.TRIP_BIND_SCRATCH_DIR || os.tmpdir();
  vtree = fs.mkdtempSync(path.join(fs.realpathSync(scratchBase), 'trip-binding-vtree-'));
  execFileSync('git', ['worktree', 'add', '--detach', vtree, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(vtree, 'node_modules'));
  if (fs.existsSync(path.join(ROOT, '.env'))) fs.symlinkSync(path.join(ROOT, '.env'), path.join(vtree, '.env'));
  say(`【R4 乾淨 worktree】${vtree}`);
  const headMd5 = md5(fs.readFileSync(path.join(vtree, 'scripts/trtc_board_ledger.mjs')));
  ok(headMd5 === md5(fs.readFileSync(BIND_MODULE)),
    'R4 worktree 自檢:HEAD 內 trtc_board_ledger.mjs 與工作樹當前內容一致(工項1已全數 commit,非驗到舊碼)',
    `HEAD md5=${headMd5}`);

  fixtureProc = spawn(process.execPath, [path.join(ROOT, 'scripts/fixture_trtc_board_ledger.mjs'), String(FIXTURE_PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(fixtureProc, /"ready":true/, 10000);
  workerProc = spawn('arch', ['-arm64', process.execPath, path.join(vtree, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--local-protocol', 'https', '--port', String(WORKER_PORT), '--inspector-port', String(INSPECTOR_PORT), '--test-scheduled',
    '--var', 'TRTC_API_USER:fixture-user', '--var', 'TRTC_API_PASS:fixture-pass',
    '--var', `TRTC_API_BASE:${FIXTURE}`, '--var', 'TRTC_BOARD_SAMPLE_DELAY_MS:0'],
    { cwd: vtree, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForHttp(`${BASE}/api/delay-stats`, 300000, workerProc);
  const dbDir = path.join(vtree, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');

  // Round 1(slot s02,08:17:56 台北)
  jsonCurl(`${FIXTURE}/__config?slot=s02&advance=1`, ['-X', 'POST']);
  const e1 = Date.parse('2026-08-03T00:17:56Z'); // 台北 08:17:56
  curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('* * * * *')}&time=${e1}`);
  await sleep(300);
  let db = findLedgerDb(dbDir);
  const day1 = trtcServiceDay(Math.floor(e1 / 1000));
  const state1Row = db.prepare(`SELECT v FROM trtc_state WHERE k='trip_dyn'`).get();
  const tbl1 = db.prepare('SELECT * FROM trtc_trip_bindings WHERE day=?').all(day1);
  db.close();
  ok(!!state1Row, 'R4 round1 後 trtc_state[trip_dyn] 已寫入', state1Row ? `${state1Row.v.length} bytes` : 'MISSING');
  const dyn1 = state1Row ? JSON.parse(state1Row.v) : null;
  ok(!!dyn1 && Array.isArray(dyn1.bindings) && dyn1.bindings.length > 0,
    'R4 round1 trip_dyn 內容非空', `bindings=${dyn1 && dyn1.bindings.length}, trtc_trip_bindings 列=${tbl1.length}`);

  // Round 2(slot s04,08:24:56,~7 分後):正常延續——內部經 loadTrtcTripBindingState 從 D1 重讀 trip_dyn(快路徑)
  jsonCurl(`${FIXTURE}/__config?slot=s04&advance=1`, ['-X', 'POST']);
  const e2 = Date.parse('2026-08-03T00:24:56Z');
  curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('* * * * *')}&time=${e2}`);
  await sleep(300);
  db = findLedgerDb(dbDir);
  const state2Row = db.prepare(`SELECT v FROM trtc_state WHERE k='trip_dyn'`).get();
  db.close();
  const dyn2 = state2Row ? JSON.parse(state2Row.v) : null;
  ok(!!dyn2 && Array.isArray(dyn2.bindings), 'R4 round2 trip_dyn 仍可讀回', dyn2 ? `bindings=${dyn2.bindings.length}` : 'MISSING');

  let continuing = [];
  if (dyn1 && dyn2) {
    const byKey1 = new Map(dyn1.bindings.filter(b => !b.done).map(b => [`${b.line}|${b.dir}|${b.tripKey}`, b]));
    for (const b2 of dyn2.bindings) {
      const b1rec = byKey1.get(`${b2.line}|${b2.dir}|${b2.tripKey}`);
      if (b1rec && b1rec.trackId === b2.trackId) continuing.push({ key: `${b2.line}|${b2.dir}|${b2.tripKey}`, b1: b1rec, b2 });
    }
  }
  ok(continuing.length > 0, 'R4 round1→round2(快路徑)存在至少一個延續中的綁定(非巧合覆蓋率)', `continuing=${continuing.length}`);
  const boundEpochPreserved = continuing.every(c => c.b1.boundEpoch === c.b2.boundEpoch);
  ok(continuing.length === 0 || boundEpochPreserved,
    'R4 快路徑:延續綁定的 boundEpoch 全數不變(=延續非重綁;D1 round-trip 保真)',
    continuing.slice(0, 3).map(c => `${c.key}:${c.b1.boundEpoch}->${c.b2.boundEpoch}`).join('; '));

  // 模擬 trip_dyn 遺失(真實故障樣態:寫入失敗/人為誤刪),強迫下一輪走 trtc_trip_bindings 退化重建路徑
  db = findLedgerDb(dbDir);
  db.prepare(`DELETE FROM trtc_state WHERE k='trip_dyn'`).run();
  const goneCheck = db.prepare(`SELECT v FROM trtc_state WHERE k='trip_dyn'`).get();
  db.close();
  ok(!goneCheck, 'R4 已手動清空 trtc_state[trip_dyn](模擬遺失,強迫走退化路徑)', '');

  jsonCurl(`${FIXTURE}/__config?slot=s06&advance=1`, ['-X', 'POST']);
  const e3 = Date.parse('2026-08-03T00:31:56Z'); // s06,約再 7 分後
  curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('* * * * *')}&time=${e3}`);
  await sleep(300);
  db = findLedgerDb(dbDir);
  const state3Row = db.prepare(`SELECT v FROM trtc_state WHERE k='trip_dyn'`).get(); // round3 執行完會重寫一份新的
  db.close();
  const dyn3 = state3Row ? JSON.parse(state3Row.v) : null;

  let fallbackContinuing = [];
  if (dyn2 && dyn3) {
    const byKey2 = new Map(dyn2.bindings.filter(b => !b.done).map(b => [`${b.line}|${b.dir}|${b.tripKey}`, b]));
    for (const b3 of dyn3.bindings) {
      const b2rec = byKey2.get(`${b3.line}|${b3.dir}|${b3.tripKey}`);
      if (b2rec && b2rec.trackId === b3.trackId) fallbackContinuing.push({ key: `${b3.line}|${b3.dir}|${b3.tripKey}`, b2: b2rec, b3 });
    }
  }
  ok(fallbackContinuing.length > 0, 'R4 退化路徑(trip_dyn 遺失後,靠 trtc_trip_bindings 重建)仍找到延續中的綁定',
    `fallbackContinuing=${fallbackContinuing.length}`);
  const fallbackBoundEpochPreserved = fallbackContinuing.every(c => c.b2.boundEpoch === c.b3.boundEpoch);
  ok(fallbackContinuing.length === 0 || fallbackBoundEpochPreserved,
    'R4 退化路徑:boundEpoch 仍從 trtc_trip_bindings 正確還原(身分延續,只有 lastShift/badStreak 動態欄位重算)',
    fallbackContinuing.slice(0, 3).map(c => `${c.key}:${c.b2.boundEpoch}->${c.b3.boundEpoch}`).join('; '));
  note('R4 對照組(拆退化重建 ⇒ 紅)',
    '未經驗證重跑,以程式碼直接舉證:出生綁定(scripts/trtc_board_ledger.mjs:891)對任何不在 priorBindings ' +
    '內的候選一律 boundEpoch:nowEpoch;若拿掉 trtc_trip_bindings 退化重建、trip_dyn 一遺失就等同 priorBindings=[],' +
    '上述延續中的 boundEpoch 必然變成 round3 的 nowEpoch(=e3),不可能與 round2 相等——與本輪實測到的「相等」' +
    '直接矛盾,故退化重建是「boundEpoch 相等」這個觀測結果的必要原因。');
} catch (e) {
  ok(false, 'R4 D1 round-trip 整段', `拋出:${(e && e.stack) || String(e)}`);
} finally {
  if (workerProc && !workerProc.killed) workerProc.kill('SIGTERM');
  if (fixtureProc && !fixtureProc.killed) fixtureProc.kill('SIGTERM');
  await sleep(500);
  if (vtree) {
    try { execFileSync('git', ['worktree', 'remove', '--force', vtree], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { note('R4 worktree 清理失敗(不影響驗收結果,需手動清)', `${vtree}:${(e && e.message) || e}`); }
  }
}

say(`\n${failures ? `FAIL ${failures}` : 'PASS'}: 逐班綁定器 R1/R2/R3/R4/R7/R8 驗收完成`);
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp/verify_trip_binding-output.txt'), output.join('\n') + '\n');
if (corpusSummary) fs.writeFileSync(path.join(ROOT, 'tmp/verify_trip_binding-corpus-audit.json'), JSON.stringify(corpusSummary, null, 2));
if (failures) process.exitCode = 1;
