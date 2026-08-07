#!/usr/bin/env node
// 逐班綁定器(工項1-3)驗收:設計書 §10 R1/R2/R3/R4/R7a/R7b/R8/R11/R12(v1.1)。純函式段落
// (R1/R2/R3/R7a/R7b/R8/R11/R12+語料回放)零外部依賴;R4(冷啟動等價,含認回延續)起本機
// wrangler+D1,從乾淨 detached worktree 起 server(memory wrangler-local-verification-traps
// 坑7:工作樹起會陷入重載風暴、永遠不服務)。
// v1.1(2026-08-07 晚):§5.1(b) 前驅單調水位線→無反轉約束、§5.3 新增 reclaim 認回,見
// tmp_設計書.md §14。R7 拆成 R7a(真反轉必擋)/R7b(假反轉不擋),新增 R11(折返重生)/R12(安全閥專測)。
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

// ── v1.0 前驅單調水位線的獨立複刻(R7b 對照組;證明這條被廢棄的規則會誤擋合法的「假反轉」案例) ──
function bindWithV0Watermark(tripSets, priorBindings, claim, nowEpoch) {
  const nowSec = trtcServiceSecOfEpoch(nowEpoch);
  const occupied = new Set((priorBindings || []).filter(p => !p.done).map(p => `${p.line}|${p.dir}|${p.tripKey}`));
  const shifts = (priorBindings || []).filter(p => !p.done).map(p => p.lastShift || 0).sort((a, b) => a - b);
  const ref = shifts.length ? shifts[Math.floor((shifts.length - 1) / 2)] : 0;
  const depSec = trtcServiceSecOfEpoch(claim.arrEpoch);
  let latestDep = null; // 同路線(起訖站相同)已綁的最大 tr[1]——v1.0 §5.1(b) 原文邏輯
  for (const p of priorBindings || []) {
    if (p.done) continue;
    for (const tr of tripSets.get(`${p.line}|${p.dir}`) || []) {
      if (tripKeyOf(tr) !== p.tripKey) continue;
      if (tr[0] === claim.from && tr[tr.length - 2] === claim.destIdx) {
        if (latestDep == null || tr[1] > latestDep) latestDep = tr[1];
      }
      break;
    }
  }
  let best = null;
  for (const tr of tripSets.get(`${claim.line}|${claim.dir}`) || []) {
    if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== claim.destIdx || tr[0] !== claim.from) continue;
    const fullKey = `${claim.line}|${claim.dir}|${tripKeyOf(tr)}`;
    if (occupied.has(fullKey)) continue;
    const shift = depSec - tr[1];
    if (shift < -90) continue;
    if (latestDep != null && tr[1] <= latestDep) continue; // v1.0 前驅單調水位線
    const cost = Math.abs(shift - ref);
    if (cost > 600 || Math.abs(shift) > 1800) continue;
    if (!best || cost < best.cost) best = { tripKey: tripKeyOf(tr), tr, cost, shift };
  }
  return best;
}

// ── 只留出生路徑、拆掉 reclaim 的獨立複刻(R11 對照組;occupied-排除兩版都有,不是本次改動的機制——
//    用來證明「沒有 reclaim,只靠出生」在候選已被舊 track 佔用時結構上進不去,永久 unbound) ──
function bindBirthOnlyNoReclaim(tripSets, priorBindings, claim, nowEpoch) {
  const nowSec = trtcServiceSecOfEpoch(nowEpoch);
  const occupied = new Set((priorBindings || []).filter(p => !p.done).map(p => `${p.line}|${p.dir}|${p.tripKey}`));
  for (const tr of tripSets.get(`${claim.line}|${claim.dir}`) || []) {
    if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== claim.destIdx) continue;
    if (occupied.has(`${claim.line}|${claim.dir}|${tripKeyOf(tr)}`)) continue;
    if (claim.terminal ? tr[0] !== claim.from : tripLegIndex(tr, claim.from, claim.to) < 0) continue;
    return { tripKey: tripKeyOf(tr) };
  }
  return null;
}

// ── 安全閥連續輪數門檻的獨立複刻(R12 對照組;不 import 模組內部常數,純模擬 badStreak 遞增/歸零邏輯) ──
function simulateBadStreak(overCapSequence, limit) {
  let streak = 0;
  for (let i = 0; i < overCapSequence.length; i++) {
    if (overCapSequence[i]) { streak++; if (streak >= limit) return { evicted: true, round: i + 1 }; }
    else streak = 0;
  }
  return { evicted: false, round: null };
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

say('\n── R7a:真反轉必擋(v1.1)——候選時序與已綁鄰班矛盾則擋下;對照組(拆無反轉檢查)須讓反轉真的發生 ──');
{
  const [tripA, tripB] = buildSeries(2, T0 + 20000, true); // wide window,防視窗到期confound;tripB 班表序在 tripA 之後
  const tripSets = tripSetsOf([tripA, tripB]);
  const now1 = secToEpoch(T0 + 20000 + HW) + 5;
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('late', tripB, 0)],
    priorBindings: [], nowEpoch: now1, day: dayOf(now1) });
  const rLate = findBinding(b1.bindings, 'late');
  ok(!!rLate && rLate.tripKey === tripKeyOf(tripB), 'R7a 前置:track late 先準點綁到較晚班次 tripB', JSON.stringify(rLate && rLate.tripKey));

  const REVERSE_DELTA = 400; // >HW(300),讓 tripA 修正後末站時刻晚於 tripB 已綁的修正後末站時刻⇒真反轉;仍在 cost cap(600)內
  const claimEarly = terminalClaim('early', tripA, REVERSE_DELTA);
  const now2 = now1 + 30;
  // late 本輪也準點續報(排除 reclaim 側路):若 late 這輪不出現,它會被判定「本輪沒收到更新」而成為
  // reclaim 候選,early 的觀測值若剛好落在 reclaim 180s cost 內會被拿去認回 late 的 tripB,汙染這個純
  // 測無反轉約束的案例(late 仍是活躍中的真實列車,不是本測試想模擬的失聯情境)。
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claimEarly, terminalClaim('late', tripB, 0)],
    priorBindings: b1.bindings, nowEpoch: now2, day: dayOf(now2) });
  const rEarly = findBinding(b2.bindings, 'early');
  ok(!rEarly, 'R7a track early 誤點400s 導致與已綁 tripB 時序矛盾,被無反轉約束擋下(cost/cap 皆過關,唯一擋因是(b))',
    rEarly ? `卻綁到了 ${rEarly.tripKey}` : '正確 unbound');

  const mutant = bindWithoutFifo(tripSets, b1.bindings, claimEarly, now2); // 中性對照:無任何順序約束(既非水位線也非無反轉)
  const correctedEndA = tripA[tripA.length - 1] + REVERSE_DELTA, correctedEndB = tripB[tripB.length - 1] + 0;
  ok(!!mutant && mutant.tripKey === tripKeyOf(tripA) && correctedEndA > correctedEndB,
    'R7a 對照組(拆無反轉檢查)early 成功綁進 tripA ⇒ 真的產生時序倒置(tripA 修正後末站時刻反而晚於 tripB)',
    `mutant 選到 ${mutant && mutant.tripKey};修正後末站 tripA=${correctedEndA} > tripB=${correctedEndB}`);
}

say('\n── R7b:假反轉不擋(v1.1新增)——晚出生但班表序/物理序皆在前的車可綁早班(折返縮影);對照組(掛回v1.0水位線)須誤擋 ──');
{
  const [tripA, tripB] = buildSeries(2, T0 + 21000, true); // 與 R7a 不同起點,避免互相污染
  const tripSets = tripSetsOf([tripA, tripB]);
  const now1 = secToEpoch(T0 + 21000 + HW) + 5;
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('late', tripB, 0)],
    priorBindings: [], nowEpoch: now1, day: dayOf(now1) });
  const rLate = findBinding(b1.bindings, 'late');
  ok(!!rLate && rLate.tripKey === tripKeyOf(tripB), 'R7b 前置:track late 先準點綁到較晚班次 tripB(折返縮影:B 先出生)', JSON.stringify(rLate && rLate.tripKey));

  const claimEarly = terminalClaim('early', tripA, 0); // 準點,物理序天然在 tripB 之前,無真反轉——這正是 v1.0 會誤擋的案例
  const now2 = now1 + 30;
  // late 本輪也準點續報,理由同 R7a(排除 reclaim 側路汙染這個純測無反轉約束的案例)。
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claimEarly, terminalClaim('late', tripB, 0)],
    priorBindings: b1.bindings, nowEpoch: now2, day: dayOf(now2) });
  const rEarly = findBinding(b2.bindings, 'early');
  ok(!!rEarly && rEarly.tripKey === tripKeyOf(tripA),
    'R7b track early 晚出生但班表序/修正後物理序皆在 tripB 之前,無反轉約束放行,正確綁進 tripA',
    rEarly ? `綁到 ${rEarly.tripKey}` : '卻 unbound(v1.1 應放行,語料 67.8% unbound 的根因就是這種案例被誤擋)');

  const mutant = bindWithV0Watermark(tripSets, b1.bindings, claimEarly, now2);
  ok(!mutant, 'R7b 對照組(掛回 v1.0 前驅單調水位線)必誤擋此合法案例(=v1.0 的真實缺陷根因)',
    mutant ? `v1.0 水位線卻放行綁到 ${mutant.tripKey}(對照組應該擋下才對,矛盾)` : '正確:v1.0 水位線誤擋(紅)');
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

// ═══ R11/R12 專用 fixture 小工具 ═══
function mkR11Trip(t0) { return mkTrip(0, t0, [[1, t0 + 120], [2, t0 + 240], [3, t0 + 7200]]); } // 4站,中段站(1→2)供「路線中段重現」的非終點 leg claim
function legClaim(trackId, tr, from, to, deltaSec, runSec) {
  const k = tripLegIndex(tr, from, to);
  const scheduledEvent = tr[(k - 1) * 2 + 1];
  const depSec = scheduledEvent + deltaSec;
  return { trackId, line: LINE, dir: DIR, from, to, destIdx: tr[tr.length - 2],
    arrEpoch: secToEpoch(depSec + runSec), run: runSec, terminal: false };
}
function seedAnchor(idx, boundEpoch) { // R12 用:ref 錨點,fullKey 不對應真實班次,對出生/reclaim 候選皆無副作用
  return { line: LINE, dir: DIR, tripKey: `__r12anchor${idx}__`, trackId: `__r12track${idx}__`, boundEpoch,
    birth: 'terminal', lastShift: 0, lastTo: null, lastArrEpoch: null, badStreak: 0, done: false, rebinds: 0 };
}

say('\n── R11:折返/碎裂重生(v1.1新增)——A 綁早班後靜默、B 準點綁晚班、A 換新 track id 路線中段重現須認回早班 ──');
{
  const tripA = mkR11Trip(T0 + 30000), tripB = mkR11Trip(T0 + 30000 + HW);
  const tripSets = tripSetsOf([tripA, tripB]);

  const now1 = secToEpoch(T0 + 30000 + 5);
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('A', tripA, 0)],
    priorBindings: [], nowEpoch: now1, day: dayOf(now1) });
  const rA1 = findBinding(b1.bindings, 'A');
  ok(!!rA1 && rA1.tripKey === tripKeyOf(tripA), 'R11 前置1:A 準點綁到早班 tripA', JSON.stringify(rA1 && rA1.tripKey));

  const now2 = secToEpoch(T0 + 30000 + HW) + 5; // 錨在 tripB 自己的發車時刻(+5s),tripB 在此之前根本還沒進入 roster-active 視窗;A 靜默中,本輪 tracks 不含 A
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('B', tripB, 0)],
    priorBindings: b1.bindings, nowEpoch: now2, day: dayOf(now2) });
  const rB = findBinding(b2.bindings, 'B');
  ok(!!rB && rB.tripKey === tripKeyOf(tripB), 'R11 前置2:B 準點綁到晚班 tripB(A 靜默中未被驅逐,binding 仍在)', JSON.stringify(rB && rB.tripKey));
  const rAStillThere = findBinding(b2.bindings, 'A');
  ok(!!rAStillThere && rAStillThere.tripKey === tripKeyOf(tripA), 'R11 前置2:A 的舊綁定仍保留(lastShift 凍結,未被刪除)', '');

  const now3 = now2 + 10; // 距 round1 累計 310s(>3分鐘)靜默,A 換新 track id 在路線中段(站1→2)重現
  const reappear = legClaim('A2', tripA, 1, 2, 0, 120);
  const b3 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [reappear],
    priorBindings: b2.bindings, nowEpoch: now3, day: dayOf(now3) });
  const rA2 = findBinding(b3.bindings, 'A2');
  ok(!!rA2 && rA2.tripKey === tripKeyOf(tripA), 'R11 A 換新 track id(A2)路線中段重現 ⇒ 認回自己原本的早班 tripA,不是永久 unbound',
    rA2 ? `認回 ${rA2.tripKey}` : '卻 unbound(缺陷復現)');
  ok(!!rA2 && rA2.boundEpoch === rA1.boundEpoch, 'R11 認回後 boundEpoch 延續原值(不是重新出生)',
    `boundEpoch ${rA1 && rA1.boundEpoch} -> ${rA2 && rA2.boundEpoch}`);
  ok(!findBinding(b3.bindings, 'A'), 'R11 舊 track id(A)不再是任何現役綁定的 trackId(已被 A2 取代)', '');

  const mutant = bindBirthOnlyNoReclaim(tripSets, b2.bindings, reappear, now3);
  ok(!mutant, 'R11 對照組(拆 reclaim,只留出生路徑)A2 連候選都進不去(tripA 仍被舊 track 佔用,occupied-排除兩版都有)' +
    ' ⇒ 永久 unbound,重現 v1.0 缺陷', mutant ? `卻找到候選 ${mutant.tripKey}(矛盾)` : '正確:找不到候選(紅)');
}

say('\n── R12:安全閥專測(v1.1新增)——|shift-ref|>600s 連續4輪才解綁,3輪不解綁;對照組(閥值突變1輪)須誤殺單輪抖動 ──');
{
  const [testTrip] = buildSeries(1, T0 + 50000, true);
  const tripSets = tripSetsOf([testTrip]);
  const round0Now = secToEpoch(T0 + 50000 + 5);
  const anchors = [0, 1, 2].map(i => seedAnchor(i, round0Now)); // 3 個準點錨點,確保 ref 全程釘死在 0(median([0,0,0,badShift])=0)

  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('bad', testTrip, 0)],
    priorBindings: anchors, nowEpoch: round0Now, day: dayOf(round0Now) });
  const r1 = findBinding(b1.bindings, 'bad');
  ok(!!r1 && r1.tripKey === tripKeyOf(testTrip) && r1.badStreak === 0, 'R12 前置:test track 準點出生,badStreak=0', JSON.stringify(r1));

  const BAD_SHIFT = 900; // >600s cost cap(相對 ref=0),每輪持續回報同一個誇張 shift
  let prev = b1.bindings;
  const streaks = [];
  for (let round = 1; round <= 4; round++) {
    const now = round0Now + round * 60; // 每輪間隔60秒,累計仍遠小於 20 分鐘 ref 窗
    const out = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('bad', testTrip, BAD_SHIFT)],
      priorBindings: prev, nowEpoch: now, day: dayOf(now) });
    const rec = findBinding(out.bindings, 'bad');
    streaks.push({ round, badStreak: rec ? rec.badStreak : null, stillOnTestTrip: !!rec && rec.tripKey === tripKeyOf(testTrip) });
    prev = out.bindings;
  }
  ok(streaks[0].badStreak === 1 && streaks[0].stillOnTestTrip, 'R12 第1個壞輪:badStreak=1,仍黏住不解綁', JSON.stringify(streaks[0]));
  ok(streaks[1].badStreak === 2 && streaks[1].stillOnTestTrip, 'R12 第2個壞輪:badStreak=2,仍黏住不解綁', JSON.stringify(streaks[1]));
  ok(streaks[2].badStreak === 3 && streaks[2].stillOnTestTrip, 'R12 第3個壞輪(累計3輪超標):badStreak=3,仍不解綁(未達4輪門檻)', JSON.stringify(streaks[2]));
  ok(!streaks[3].stillOnTestTrip, 'R12 第4個壞輪(連續4輪超標):安全閥觸發,track 不再黏在原 tripKey 上', JSON.stringify(streaks[3]));

  const singleJitterSeq = [true, false, false, false]; // 只有第1輪抖動超標,之後立刻恢復正常——單輪抖動的抽象模型
  const real = simulateBadStreak(singleJitterSeq, 4); // 4=TRIP_BIND_BAD_STREAK_LIMIT(獨立複刻,不 import 內部常數)
  ok(!real.evicted, 'R12 對照組基準:單輪抖動在真實閥值(連續4輪)下不解綁', JSON.stringify(real));
  const mutant = simulateBadStreak(singleJitterSeq, 1);
  ok(mutant.evicted && mutant.round === 1, 'R12 對照組(閥值突變成1輪)同一個單輪抖動立刻被誤殺 ⇒「連續4輪」這個寬度本身有牙,' +
    '不是裝飾——寬度不夠就退化回每輪重猜(=本設計要根治的現行 bug)', JSON.stringify(mutant));
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
  const audit = { bound: 0, unbound: 0, rebinds: 0, capped: 0, done: 0, legMiss: 0, malformed: 0, reattach: 0, rounds: 0 };
  // 診斷分母:對每一筆本輪才出生、又沒綁上的 claim,分類「真的無候選(destIdx/roster 都配不到)」
  // vs「有合理候選(cost 在絕對值上限內)但仍未綁上(=輸給別人佔用,或被 FIFO 水位擋下)」——
  // 用來把 unbound 率拆成「潛在演算法問題」與「FIFO 設計本來就會有的取捨」兩種不同性質的數字。
  const diag = { noCandidate: 0, hadGoodCandidateButLost: 0, other: 0 };
  // 供需診斷(v1.1新增,根因追蹤發現的第二個獨立因素):按 line|dir|destIdx 分組,比較「這輪觀測到的
  // 相異 claim 數」與「這輪 roster-active 的班表格位數」——若前者持續超過後者,代表根本不是綁定演算法
  // 配對能力的問題(格位數量結構性不足以容納所有 claim),而是上游 claim 產生階段(buildLedgerFromRaw/
  // collapseClaims,非本次改動範圍)可能把同一實體列車拆成多個 track id。
  let oversupplyRounds = 0, oversupplyGroupRoundsTotal = 0, oversupplySum = 0;
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
    { // 本輪供需比對:僅供人判讀,不影響任何斷言
      const claimGroups = new Map();
      for (const c of built.claims) { const k = `${c.line}|${c.dir}|${c.destIdx}`; claimGroups.set(k, (claimGroups.get(k) || 0) + 1); }
      const slotGroups = new Map();
      for (const [gk, trips] of tripSetsCache.tripSets) for (const tr of trips) {
        if (!tripRosterActive(tr, nowSec)) continue;
        const k = `${gk}|${tr[tr.length - 2]}`; slotGroups.set(k, (slotGroups.get(k) || 0) + 1);
      }
      let roundHasOversupply = false;
      for (const [k, claimCount] of claimGroups) {
        const over = claimCount - (slotGroups.get(k) || 0);
        if (over > 0) { roundHasOversupply = true; oversupplyGroupRoundsTotal++; oversupplySum += over; }
      }
      if (roundHasOversupply) oversupplyRounds++;
    }
    priorBindings = bindOut.bindings;
    for (const k of ['bound', 'unbound', 'rebinds', 'capped', 'done', 'legMiss', 'malformed', 'reattach']) audit[k] += bindOut.audit[k];
    audit.rounds++;
  }
  // v1.1:分母改含 reattach——認回成功和出生成功一樣是「這個 claim 被正確處理了」,不該只因為
  // 它走的是 reclaim 分支就被排除在分母外(舊公式 bound/(bound+unbound) 在 v1.0 沒有 reclaim 分支時
  // 是對的,v1.1 加了第三種結局後,分母漏 reattach 會讓 unboundRate 虛高)。
  const totalAttempts = audit.bound + audit.reattach + audit.unbound;
  const unboundRate = totalAttempts ? audit.unbound / totalAttempts : 0;
  corpusSummary = { ...audit, totalAttempts, unboundRate, diag, oversupplyRounds, oversupplyGroupRoundsTotal, oversupplySum };
  ok(true, '語料回放全鏈未拋例外', `${audit.rounds} 輪`);
  const diagTotal = diag.noCandidate + diag.hadGoodCandidateButLost + diag.other;
  note('語料回放 unbound 根因拆解(非本函式的判準,純供人判讀)',
    `無候選(destIdx/roster配不到)=${diag.noCandidate}(${diagTotal ? (diag.noCandidate / diagTotal * 100).toFixed(1) : 0}%) / ` +
    `有合理候選卻未綁上(佔用競爭輸或無反轉約束擋)=${diag.hadGoodCandidateButLost}(${diagTotal ? (diag.hadGoodCandidateButLost / diagTotal * 100).toFixed(1) : 0}%) / ` +
    `其餘=${diag.other}`);
  note('語料回放供需診斷(v1.1新增,第二個獨立根因——與 bindTracksToTrips 的配對邏輯無關)',
    `${oversupplyRounds}/${audit.rounds} 輪至少一組「觀測 claim 數>roster-active 班表格位數」;` +
    `累計 ${oversupplyGroupRoundsTotal} 組-輪次過量,總計超額 ${oversupplySum} 個 claim 結構性無處可綁` +
    `(格位數量不足,不是配對算法選錯——常見於 BR:同一 arrEpoch 對多個相鄰 from/to 站產生多筆 claim,` +
    `疑似上游 claim 產生階段(buildLedgerFromRaw 一族,非本次改動範圍)把單一實體列車拆成逐站多個 track id;` +
    `已用獨立診斷腳本核對 BR dir2 個例:23 筆 claim 只對應 2 個 track id 前綴,多筆共用同一 arrEpoch)`);
  // 第三個獨立根因(v1.1 施工期間新發現,§5.1(b) 本身的缺陷):scheduleNeighbors 是在整個
  // line+dir 範圍內依 tr[1] 排序取前後鄰,沒有再依 destIdx 分組——同一 line+dir 底下常有
  // 「短程分支」與「長程分支」交錯發車(如 R|2 的北投/淡水),短程班次的表定終點時刻天生比
  // 長程班次早,即使兩者都準點,violatesNoReversal 拿雙方「修正後終點時刻」互比也會判定假反轉。
  // 下面只讀 tripSets 結構(不碰 bindTracksToTrips),量「這個 line+dir 排序下,相鄰兩班
  // destIdx 不同」的比例,量化這個 line+dir 群組對此缺陷的暴露程度(非本次改動範圍——
  // 修法需重新界定 scheduleNeighbors 的分組粒度,屬 v1.2 決策,這裡只誠實回報現象與量級)。
  {
    let adjPairs = 0, destMismatch = 0;
    for (const [, trips] of tripSetsCache.tripSets) {
      const sorted = [...trips].sort((a, b) => a[1] - b[1]);
      for (let i = 1; i < sorted.length; i++) {
        adjPairs++;
        if (sorted[i][sorted[i].length - 2] !== sorted[i - 1][sorted[i - 1].length - 2]) destMismatch++;
      }
    }
    note('語料回放無反轉約束跨目的地暴露度診斷(v1.1施工期間新發現,第三個獨立根因,§5.1(b)本身的缺陷)',
      `全日班表相鄰班次對 ${adjPairs} 組,其中 ${destMismatch}(${adjPairs ? (destMismatch / adjPairs * 100).toFixed(1) : 0}%)` +
      `destIdx 不同(短長分支交錯發車)——這些位置的 violatesNoReversal 拿「終點時刻」互比會系統性誤判假反轉;` +
      `已用 scratch 變體(scheduleNeighbors 改依 line+dir+destIdx 分組再排序)離線驗證:` +
      `全語料 unbound 66.2%→58.9%(-7.3pp),R 線 40.0%→22.9%(觀測口徑,-17.1pp)——` +
      `方向確認但仍未達<20%,可見扣掉本因與供需診斷那條,至少還有第四個未查明成因`);
  }
  ok(unboundRate < 0.20, '語料回放 unbound 率 <20%(分母已計入 reattach 成功;此語料快照間距 3.5-7 分鐘,' +
    '遠寬於正式站 cron 節奏——見上三行根因拆解,紅燈已知三個獨立成因,其一已被 v1.1 修復,另兩個見上兩行診斷)',
    `unbound=${audit.unbound}/${totalAttempts}=${(unboundRate * 100).toFixed(1)}%(bound=${audit.bound},reattach=${audit.reattach})`);
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
say('\n── R4:冷啟動等價(D1 round-trip,含認回 boundEpoch 延續)——起本機 wrangler,乾淨 detached worktree ──');
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

  // 認回延續性(v1.1,機會性偵測):同 (line,dir,tripKey)、boundEpoch 不變、但 trackId 換了⇒真實語料
  // 在這兩輪之間自然發生了 reclaim。語料快照間距寬(~7分鐘),不保證每次跑都會出現,故不設 length>0
  // 的硬性下限(真出現 0 筆時只 note,不算失敗)——找到的那些則硬性斷言 boundEpoch 必須延續。
  let reclaimed = [];
  if (dyn1 && dyn2) {
    const byKey1r = new Map(dyn1.bindings.filter(b => !b.done).map(b => [`${b.line}|${b.dir}|${b.tripKey}`, b]));
    for (const b2 of dyn2.bindings) {
      const b1rec = byKey1r.get(`${b2.line}|${b2.dir}|${b2.tripKey}`);
      if (b1rec && b1rec.trackId !== b2.trackId && b1rec.boundEpoch != null) reclaimed.push({ key: `${b2.line}|${b2.dir}|${b2.tripKey}`, b1: b1rec, b2 });
    }
  }
  if (reclaimed.length > 0) {
    const reclaimBoundEpochPreserved = reclaimed.every(c => c.b1.boundEpoch === c.b2.boundEpoch);
    ok(reclaimBoundEpochPreserved, 'R4 語料自然產生的認回(round1→round2)boundEpoch 全數延續(track_id 換了但身分不變)',
      reclaimed.slice(0, 3).map(c => `${c.key}:track ${c.b1.trackId}->${c.b2.trackId},boundEpoch ${c.b1.boundEpoch}->${c.b2.boundEpoch}`).join('; '));
  } else {
    note('R4 round1→round2 語料未自然產生認回案例', '語料快照間距寬,兩輪之間未必有track換id重現;演算法層的認回正確性已由純函式段 R11 直接驗證(必然觸發,非機會性)');
  }

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

  // 認回延續性(v1.1,機會性偵測,退化路徑):round2→round3 之間(經 trip_dyn 遺失、trtc_trip_bindings 重建)
  // 若也自然出現認回案例,一併驗 boundEpoch 延續——證明認回的 boundEpoch 保真不只在快路徑成立,退化重建路徑
  // 也成立(track_id 本來就不是 trtc_trip_bindings 主鍵的一部分,重建時原樣讀回,無特殊處理needed)。
  let reclaimedFallback = [];
  if (dyn2 && dyn3) {
    const byKey2r = new Map(dyn2.bindings.filter(b => !b.done).map(b => [`${b.line}|${b.dir}|${b.tripKey}`, b]));
    for (const b3 of dyn3.bindings) {
      const b2rec = byKey2r.get(`${b3.line}|${b3.dir}|${b3.tripKey}`);
      if (b2rec && b2rec.trackId !== b3.trackId && b2rec.boundEpoch != null) reclaimedFallback.push({ key: `${b3.line}|${b3.dir}|${b3.tripKey}`, b2: b2rec, b3 });
    }
  }
  if (reclaimedFallback.length > 0) {
    const reclaimFallbackPreserved = reclaimedFallback.every(c => c.b2.boundEpoch === c.b3.boundEpoch);
    ok(reclaimFallbackPreserved, 'R4 語料自然產生的認回(round2→round3,退化重建路徑)boundEpoch 全數延續',
      reclaimedFallback.slice(0, 3).map(c => `${c.key}:track ${c.b2.trackId}->${c.b3.trackId},boundEpoch ${c.b2.boundEpoch}->${c.b3.boundEpoch}`).join('; '));
  } else {
    note('R4 round2→round3 語料未自然產生認回案例', '同上,機會性偵測,演算法正確性以 R11 為準');
  }
  note('R4 認回寫入低頻表的論證(程式碼舉證,非獨立於上述觀測的第二重複測)',
    'worker.js persistTrtcTripBindingRound 的 touched map 只認 events 的 (line,dir,tripKey),不分 event.type' +
    '(bind/done/reattach 走同一段 upsert)——這條路徑本身已被上面「round1→round2 continuing」與「round2→round3 ' +
    'fallbackContinuing」兩個斷言直接跑過(對 bind 類事件);reattach 事件的 (line,dir,tripKey) 形狀與 bind 完全相同,' +
    '故必然套用同一段已驗證過的 upsert 邏輯——這是程式路徑等價論證,不是另一次獨立經驗觀測。');
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

say(`\n${failures ? `FAIL ${failures}` : 'PASS'}: 逐班綁定器 R1/R2/R3/R4/R7a/R7b/R8/R11/R12 驗收完成(v1.1)`);
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp/verify_trip_binding-output.txt'), output.join('\n') + '\n');
if (corpusSummary) fs.writeFileSync(path.join(ROOT, 'tmp/verify_trip_binding-corpus-audit.json'), JSON.stringify(corpusSummary, null, 2));
if (failures) process.exitCode = 1;
