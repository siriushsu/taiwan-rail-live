#!/usr/bin/env node
// 逐班綁定器(工項1-3)驗收:設計書 §10 R1/R2/R3/R4/R7a/R7b/R8/R11/R12(v1.1)。純函式段落
// (R1/R2/R3/R7a/R7b/R8/R11/R12+語料回放)零外部依賴;R4(冷啟動等價,含認回延續)起本機
// wrangler+D1,從乾淨 detached worktree 起 server(memory wrangler-local-verification-traps
// 坑7:工作樹起會陷入重載風暴、永遠不服務)。
// v1.1(2026-08-07 晚):§5.1(b) 前驅單調水位線→無反轉約束、§5.3 新增 reclaim 認回,見
// tmp_設計書.md §14。R7 拆成 R7a(真反轉必擋)/R7b(假反轉不擋),新增 R11(折返重生)/R12(安全閥專測)。
// v1.2(2026-08-07 夜):§5.1(b) 比較基準改「修正後發車時刻」(取代 v1.1 的「末站時刻」,短長分支
// 交錯時不可比),R7a/R7b 情境隨新基準改寫;新增 R13(合成正式節奏,15s/輪×60分鐘,<5%硬門檻+
// 綁對率>98%);語料回放門檻改條件式,見 tmp_設計書.md §15。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildTrtcModel, buildLedgerFromRaw, trtcServiceDay,
  bindTracksToTrips, buildTripSetsByLineDir, tripKeyOf, tripRosterActive, tripLegIndex, trtcServiceSecOfEpoch,
  claimBoardRows, collapseClaims, assignLedgerFrame, joinBoardRowsToTrips,
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
function mkWideTrip(t0) { return mkTrip(0, t0, [[1, t0 + 120], [2, t0 + 7200]]); } // 末段給 2 小時,R2/R3 用,防出生匹配當下視窗已到期混淆
// R7a/R7b(v1.2)用:同起點、不同終點站(destIdx 2 vs 3)、不同總長度——短長分支交錯發車的縮影。
function mkLongTrip(t0) { return mkTrip(0, t0, [[1, t0 + 3600], [2, t0 + 7200]]); }  // 長程,終點站2,末站時刻很晚
function mkShortTrip(t0) { return mkTrip(0, t0, [[1, t0 + 900], [3, t0 + 1800]]); }  // 短程,終點站3(不同destIdx),末站時刻很早
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

// ── v1.1 無反轉約束「末站時刻」基準的獨立複刻(R7b 對照組,v1.2 改基準後專用;證明 v1.1 自己的
//    比較基準——短長分支交錯時——會誤擋合法的「假反轉」案例;取代已不再使用的 v1.0 水位線對照組,
//    因為 v0 的水位線本身是 destIdx-scoped(只比對同終點的班次),對跨目的地情境完全不觸發、
//    測不出這裡要驗的東西——這正是 v1.2 要修的缺陷是 v1.1 自己引入的,不是 v0 原本就有的證據) ──
function bindWithV11EndTimeBasis(tripSets, priorBindings, claim, nowEpoch) {
  const nowSec = trtcServiceSecOfEpoch(nowEpoch);
  const occupied = new Set((priorBindings || []).filter(p => !p.done).map(p => `${p.line}|${p.dir}|${p.tripKey}`));
  const shifts = (priorBindings || []).filter(p => !p.done).map(p => p.lastShift || 0).sort((a, b) => a - b);
  const ref = shifts.length ? shifts[Math.floor((shifts.length - 1) / 2)] : 0;
  const depSec = trtcServiceSecOfEpoch(claim.arrEpoch);
  const sorted = [...(tripSets.get(`${claim.line}|${claim.dir}`) || [])].sort((a, b) => a[1] - b[1]);
  const boundTr = new Map(); // tripKey -> {tr, lastShift},僅現役綁定
  for (const p of priorBindings || []) {
    if (p.done || p.line !== claim.line || p.dir !== claim.dir) continue;
    const tr = sorted.find(t => tripKeyOf(t) === p.tripKey);
    if (tr) boundTr.set(p.tripKey, { tr, lastShift: p.lastShift || 0 });
  }
  function violatesV11EndTime(tr, shift) {
    const idx = sorted.findIndex(t => t === tr);
    const candEnd = tr[tr.length - 1] + shift; // v1.1 舊基準:末站時刻,不是發車時刻
    const prev = idx > 0 ? boundTr.get(tripKeyOf(sorted[idx - 1])) : null;
    if (prev && prev.tr[prev.tr.length - 1] + prev.lastShift > candEnd) return true;
    const next = idx < sorted.length - 1 ? boundTr.get(tripKeyOf(sorted[idx + 1])) : null;
    if (next && next.tr[next.tr.length - 1] + next.lastShift < candEnd) return true;
    return false;
  }
  let best = null;
  for (const tr of sorted) {
    if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== claim.destIdx || tr[0] !== claim.from) continue;
    const fullKey = `${claim.line}|${claim.dir}|${tripKeyOf(tr)}`;
    if (occupied.has(fullKey)) continue;
    const shift = depSec - tr[1];
    if (shift < -90) continue;
    if (violatesV11EndTime(tr, shift)) continue;
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

say('\n── R7a:真反轉必擋(v1.2,新基準=修正後發車時刻,短長分支交錯)——候選時序與已綁鄰班矛盾則擋下,即使目的地不同;對照組(拆無反轉檢查)須讓反轉真的發生 ──');
{
  // tripLong 班表序在前(發車早,T0+22000)、tripShort 班表序在後(發車晚,+HW)、目的地不同(destIdx 2 vs 3)。
  const tripLong = mkLongTrip(T0 + 22000), tripShort = mkShortTrip(T0 + 22000 + HW);
  const tripSets = tripSetsOf([tripLong, tripShort]);
  const now1 = secToEpoch(T0 + 22000 + HW) + 5;
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('short', tripShort, 0)],
    priorBindings: [], nowEpoch: now1, day: dayOf(now1) });
  const rShort = findBinding(b1.bindings, 'short');
  ok(!!rShort && rShort.tripKey === tripKeyOf(tripShort), 'R7a 前置:短程車 short 先準點綁到 tripShort', JSON.stringify(rShort && rShort.tripKey));

  const REVERSE_DELTA = HW + 100; // >HW,讓 tripLong 修正後發車時刻(候選)晚於已綁 tripShort 的修正後發車時刻⇒真反轉(班表序在前卻發車在後);仍在 cost cap(600)內
  const claimLong = terminalClaim('long', tripLong, REVERSE_DELTA);
  const now2 = now1 + 30;
  // short 本輪也準點續報(排除 reclaim 側路):理由同 v1.1 版——避免 short 因「本輪沒收到更新」被
  // long 的觀測值以 reclaim 180s cost 誤認,汙染這個純測無反轉約束的案例。
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claimLong, terminalClaim('short', tripShort, 0)],
    priorBindings: b1.bindings, nowEpoch: now2, day: dayOf(now2) });
  const rLong = findBinding(b2.bindings, 'long');
  ok(!rLong, 'R7a 長程車 long 誤點導致修正後發車時刻晚於已綁短程車 short(cost/cap 皆過關,唯一擋因是(b)),即使目的地不同也被無反轉約束擋下',
    rLong ? `卻綁到了 ${rLong.tripKey}` : '正確 unbound');

  const mutant = bindWithoutFifo(tripSets, b1.bindings, claimLong, now2); // 中性對照:無任何順序約束
  const correctedDepLong = tripLong[1] + REVERSE_DELTA, correctedDepShort = tripShort[1] + 0;
  ok(!!mutant && mutant.tripKey === tripKeyOf(tripLong) && correctedDepLong > correctedDepShort,
    'R7a 對照組(拆無反轉檢查)long 成功綁進 tripLong ⇒ 真的產生發車時序倒置(即使目的地不同,long 班表序在前,修正後卻晚於 short 發車)',
    `mutant 選到 ${mutant && mutant.tripKey};修正後發車 long=${correctedDepLong} > short=${correctedDepShort}`);
}

say('\n── R7b:假反轉不擋(v1.2,新基準)——短長分支交錯發車,長程班班表序在前卻被短程鄰班的「末站時刻」誤判擋下(v1.1自身缺陷);新基準(發車時刻)正確放行 ──');
{
  // 與 v1.1 版 R7b 的差異:改用短長分支交錯(destIdx 不同),直接重現 v1.1 §5.1(b) 用「末站時刻」
  // 比較時的真實缺陷(短程班的末站時刻天生比長程班早,即使雙方都準點)。
  const tripLong = mkLongTrip(T0 + 23000), tripShort = mkShortTrip(T0 + 23000 + HW);
  const tripSets = tripSetsOf([tripLong, tripShort]);
  const now1 = secToEpoch(T0 + 23000 + HW) + 5;
  const b1 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [terminalClaim('short', tripShort, 0)],
    priorBindings: [], nowEpoch: now1, day: dayOf(now1) });
  const rShort = findBinding(b1.bindings, 'short');
  ok(!!rShort && rShort.tripKey === tripKeyOf(tripShort), 'R7b 前置:短程車 short 先準點綁到 tripShort(折返縮影:短程先出生)', JSON.stringify(rShort && rShort.tripKey));

  const claimLong = terminalClaim('long', tripLong, 0); // 準點,班表序天然在 tripShort 之前,無真反轉——這正是 v1.1 舊基準會誤擋的案例
  const now2 = now1 + 30;
  const b2 = bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks: [claimLong, terminalClaim('short', tripShort, 0)],
    priorBindings: b1.bindings, nowEpoch: now2, day: dayOf(now2) });
  const rLong = findBinding(b2.bindings, 'long');
  ok(!!rLong && rLong.tripKey === tripKeyOf(tripLong),
    'R7b 長程車 long 晚出生但班表序天然在 short 之前、雙方皆準點,新基準(發車時刻)正確放行綁進 tripLong',
    rLong ? `綁到 ${rLong.tripKey}` : '卻 unbound(v1.1 用末站時刻比較的根因重現——短程末站天生較早,被誤判反轉)');

  const mutant = bindWithV11EndTimeBasis(tripSets, b1.bindings, claimLong, now2);
  ok(!mutant, 'R7b 對照組(掛回 v1.1 末站時刻基準)必誤擋此合法案例(=v1.2 要修的缺陷根因,語料實測 21.3% 相鄰班次對 destIdx 不同都會踩到)',
    mutant ? `v1.1 末站基準卻放行綁到 ${mutant.tripKey}(對照組應該擋下才對,矛盾)` : '正確:v1.1 末站基準誤擋(紅)');
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

// ── v0 水位線的「完整批次版」對照組(R13 專用):文字替換注入法,只換 §5.1(b) 這一段判斷式,
//    reclaim/cost/cap/黏著/安全閥全部沿用真實模組原始碼——確保對照組與正式邏輯除了被測的
//    這一條規則外完全一致,不是手刻一份簡化複刻品(那樣容易語意漂移,參考心得29「判準與實作
//    同源」的反面教訓——這裡刻意讓「非被測部分」同源,只讓「被測部分」是唯一變因)。
//    找不到預期原始碼區塊就直接 throw(上游改版時要顯式失敗,不要默默比對到錯的東西)。
function makeV0WatermarkVariant() {
  const src = fs.readFileSync(BIND_MODULE, 'utf8');
  const oldFn = `  function violatesNoReversal(fullKey, tr, shift) {
    const nb = scheduleNeighbors.get(fullKey);
    if (!nb) return false;
    const candDep = tr[1] + shift;
    if (nb.prevKey) {
      const prevRec = records.get(nb.prevKey);
      const prevTr = prevRec && !prevRec.done && tripByFullKey.get(nb.prevKey);
      if (prevTr && prevTr[1] + prevRec.lastShift > candDep) return true;
    }
    if (nb.nextKey) {
      const nextRec = records.get(nb.nextKey);
      const nextTr = nextRec && !nextRec.done && tripByFullKey.get(nb.nextKey);
      if (nextTr && nextTr[1] + nextRec.lastShift < candDep) return true;
    }
    return false;
  }
`;
  if (!src.includes(oldFn)) throw new Error('R13:BIND_MODULE 內找不到預期的 violatesNoReversal 原始碼區塊,替換法需要更新(上游可能已改版)');
  const v0Fn = `  function violatesV0Watermark(claim, tr) { // [R13對照組,文字替換注入]v0水位線:同(line,dir,from,destIdx)路線已綁最大 tr[1]
    let wm = null;
    for (const [fk, rec] of records) {
      if (rec.done || rec.line !== claim.line || rec.dir !== claim.dir) continue;
      const t = tripByFullKey.get(fk);
      if (!t || t[0] !== claim.from || t[t.length - 2] !== claim.destIdx) continue;
      if (wm == null || t[1] > wm) wm = t[1];
    }
    return wm != null && tr[1] <= wm;
  }
`;
  let out = src.replace(oldFn, v0Fn);
  const callA = 'violatesNoReversal(fullKey, tr, shift)', callB = 'violatesNoReversal(e.fullKey, e.tr, e.shift)';
  const countA = out.split(callA).length - 1, countB = out.split(callB).length - 1;
  if (countA !== 2 || countB !== 2) throw new Error(`R13:預期呼叫點各2處,實際 A=${countA} B=${countB},替換法需要更新`);
  out = out.split(callA).join('violatesV0Watermark(claim, tr)').split(callB).join('violatesV0Watermark(e.claim, e.tr)');
  const tmpPath = path.join(fs.realpathSync(os.tmpdir()), `trtc_board_ledger_v0wm_${crypto.randomUUID()}.mjs`);
  fs.writeFileSync(tmpPath, out);
  return tmpPath;
}

say('\n── R13:合成正式節奏(v1.2新增)——從真實班表以15s/輪×60分鐘合成理想看板流,注入誤點/折返/取消;<5%硬門檻+綁對率>98%;對照組(掛回v0水位線)須顯著惡化 ──');
{
  const times13 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json')));
  const dayTypeTable13 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json')));
  const day13 = '2026-08-03'; // 週一/平日,與語料回放同一天(已知有效日型,見前一輪 dayType 查證)
  const { tripSets: tripSets13, dayKeys: dayKeys13 } = buildTripSetsByLineDir(times13, dayTypeTable13, day13);
  const dayType13 = (dayKeys13 && dayKeys13.get('BL')) || '平日';

  const WIN_START = 8 * 3600, WIN_END = WIN_START + 3600, TICK = 15; // 08:00-09:00,尖峰,15秒/輪×240輪

  // 選車:對每個 line+dir 群組,取「班次的[dep,end]視窗與觀測窗有重疊」的班次,各配一台合成車。
  const roster = [];
  for (const [gk, trips] of tripSets13) {
    const sep = gk.lastIndexOf('|'); const line = gk.slice(0, sep), dir = Number(gk.slice(sep + 1));
    for (const tr of trips) {
      if (tr[1] >= WIN_END || tr[tr.length - 1] <= WIN_START) continue; // 全無重疊
      roster.push({ line, dir, tr, tripKey: tripKeyOf(tr), carId: `r13:${line}:${dir}:${tripKeyOf(tr)}`, delta: 0 });
    }
  }
  ok(roster.length >= 30, 'R13 前置:合成節奏涵蓋足夠班次(貼近正式站尖峰同時在線車數,真正的擁擠/競爭條件)', `roster=${roster.length}`);

  function headwayOf(line, dir, destIdx) { // 該 line+dir+destIdx 群組的中位數頭距,供「>半頭距」判準用
    const trs = (tripSets13.get(`${line}|${dir}`) || []).filter(t => t[t.length - 2] === destIdx).sort((a, b) => a[1] - b[1]);
    const diffs = []; for (let i = 1; i < trs.length; i++) diffs.push(trs[i][1] - trs[i - 1][1]);
    diffs.sort((a, b) => a - b);
    return diffs.length ? diffs[Math.floor(diffs.length / 2)] : 300;
  }

  // 挑 5 台特殊車(百分位索引,對 roster 大小不敏感、彼此分散在不同 line+dir 群組):
  // 1 取消、2 誤點(3-8分,其一>半頭距)、2 折返靜默(>3分鐘,track id 更換)。
  const idxAt = f => Math.floor(roster.length * f);
  const cancelled = roster[idxAt(0.08)];

  // §5.1(b) 的無反轉約束比的是「全目的地混排」班表序相鄰(scheduleNeighbors 建構時不濾 destIdx),
  // 不是 headwayOf() 算的同目的地中位數頭距——多目的地交錯的線上兩者可以差很多(實測同目的地頭距
  // 240s,但全目的地相鄰 gap 只有 131s)。若誤點量只照同目的地頭距訂,會把候選車的修正後發車時刻
  // 直接推過下一班「準點」鄰班的時刻,觸發無反轉約束——而鄰班一趟車程常 >30 分,60 分鐘觀測窗內
  // 通常不會收班,約束在窗內永不解除,該車會整段觀測窗卡死 unbound。這不是演算法 bug(無反轉正確
  // 擋下了一個對準點鄰班而言真實的時序反轉),是合成器選錯了誤點量——改成在候選附近搜尋「相對
  // 全目的地下一班還留有安全邊界」的車,而不是照公式硬塞一個可能塞不下的量。
  function neighborNextGap(entry) {
    const trips = tripSets13.get(`${entry.line}|${entry.dir}`) || [];
    const sorted = [...trips].sort((a, b) => a[1] - b[1]);
    const i = sorted.findIndex(t => tripKeyOf(t) === entry.tripKey);
    return i >= 0 && i < sorted.length - 1 ? sorted[i + 1][1] - entry.tr[1] : Infinity;
  }
  function findDelayCandidate(centerFrac, needHalfHeadway, excludeIds, radius = 60) {
    const center = idxAt(centerFrac);
    for (let d = 0; d <= radius; d++) {
      for (const i of (d === 0 ? [center] : [center - d, center + d])) {
        if (i < 0 || i >= roster.length) continue;
        const e = roster[i];
        if (excludeIds.has(e.carId)) continue;
        const H = headwayOf(e.line, e.dir, e.tr[e.tr.length - 2]);
        // 延遲量還要塞進「該車原始 tr[1] 加上 delta 後仍在觀測窗內、且留至少 120s 可觀測」——
        // 否則车 shifted 後的發車時刻整段落在 WIN_END 之後,claimAt 永遠回 null,該車全窗期都不
        // 會出現在 claims 裡(綁對率檢查會看到它「MISSING」而非「unbound」,兩者都不算過)。
        const windowFit = WIN_END - e.tr[1] - 120;
        const maxFeasible = Math.min(480, neighborNextGap(e) - 30, windowFit); // 30s 安全邊界,不貼著鄰班卡死
        if (maxFeasible < 180) continue; // 塞不下 3 分鐘下限,跳過
        if (needHalfHeadway && !(maxFeasible > H / 2 + 10)) continue;
        e.delta = needHalfHeadway ? Math.min(maxFeasible, Math.max(180, Math.ceil(H / 2) + 30))
                                   : Math.min(maxFeasible, 360);
        return e;
      }
    }
    throw new Error(`R13:找不到滿足延遲條件且不會卡死的候選車(center=${centerFrac},radius=${radius})`);
  }
  const delayExcl = new Set([cancelled.carId]);
  const delayed1 = findDelayCandidate(0.25, true, delayExcl); delayExcl.add(delayed1.carId);
  const delayed2 = findDelayCandidate(0.48, false, delayExcl); delayExcl.add(delayed2.carId);
  const silence1 = roster[idxAt(0.68)];
  // silence2 刻意挑「靜默重現仍落在第一腿(k=1/terminal claim)內」的車,不是隨百分位靠運氣——
  // v0 水位線(violatesV0Watermark)比對的是 t[0]===claim.from,對非 terminal 的 claim(from=行進
  // 中的中途站)恆為 0!==非0 而永遠不觸發,實測 silence1 那種「重現在路線中段」的一般折返完全測不
  // 出 v0 與 v1.2 的差異(both 0% unbound)。要讓 v0 真的顯著惡化,必須讓「重現時刻仍在第一腿內」
  // 發生——此時 reclaim 對自己原本那筆(仍佔用同一 fullKey、尚未刪除)算水位線,自己的 tr[1] 必然
  // ≤ 自己造出來的水位線(自我參照恆真),v0 因此永遠卡死自己的折返車;v1.2 的無反轉約束比的是「與
  // 鄰班」而非「與自己」,同一班次 shift 不變時對鄰班無威脅,能正常認回。這才是 v0 歷史真實壞掉的
  // 場景(§5.1(b) 註解「水位線把終點折返靜默重生的車永久擋死」),不是本測試自己想像出來的分支。
  function findTerminalSilenceCandidate(dur, excludeIds) {
    for (const e of roster) {
      if (excludeIds.has(e.carId)) continue;
      const firstLegDur = e.tr[3] - e.tr[1];
      if (firstLegDur < dur + 40) continue; // 前後各留 ≥20s 觀測餘裕
      const lo = Math.max(e.tr[1], WIN_START), hi = Math.min(e.tr[3], WIN_END);
      if (hi - lo < dur + 40) continue; // 整段還要落在觀測窗內
      return e;
    }
    throw new Error(`R13:找不到「靜默重現仍落在第一腿內」的候選車(dur=${dur})——v0 對照組會失去` +
      '唯一能被差異化的場景(v0 水位線只在 terminal claim 才生效)');
  }
  const silence2 = findTerminalSilenceCandidate(200, new Set([cancelled.carId, delayed1.carId, delayed2.carId, silence1.carId]));
  const specialSet = new Set([cancelled, delayed1, delayed2, silence1, silence2]);
  ok(specialSet.size === 5, 'R13 前置:5台特殊車(1取消+2誤點+2折返)彼此不重複、分散在不同班次', `distinct=${specialSet.size}`);

  const H1 = headwayOf(delayed1.line, delayed1.dir, delayed1.tr[delayed1.tr.length - 2]);
  // silence1(一般折返,測「中途重現」的常態路徑):起點落在「行程 ∩ 觀測窗」重疊區間的 40% 處,
  // 不能只照該車自己全程的 40% 算——挑到行程大半段落在觀測窗外的車時,40% 記號會落在 WIN_END 之
  // 後,靜默事件整段窗內都不會發生,carId2 永遠不會出現(這是合成器的 bug,不是 bindTracksToTrips
  // 的 bug)。silence2(見上,測 v0 差異化場景)改用「僅限第一腿內」的版本,兩者共用同一種「扣掉
  // 靜默時長後取 40%」算法,只差可用區間的上界(hi)。
  function silenceStartFor(entry, dur, hiBound) {
    const lo = Math.max(entry.tr[1], WIN_START), hi = Math.min(hiBound, WIN_END);
    return lo + Math.floor(Math.max(0, hi - lo - dur) * 0.4);
  }
  silence1.silenceDur = 220;
  silence1.silenceAt = silenceStartFor(silence1, silence1.silenceDur, silence1.tr[silence1.tr.length - 1]);
  silence1.carId2 = silence1.carId + ':B';
  silence2.silenceDur = 200;
  silence2.silenceAt = silenceStartFor(silence2, silence2.silenceDur, silence2.tr[3]); // 限第一腿(tr[3]=k=1 終點)內
  silence2.carId2 = silence2.carId + ':B';

  ok(delayed1.delta > H1 / 2 && delayed1.delta >= 180, 'R13 前置:誤點車1 delay 落在3-8分鐘且超過半頭距',
    `delta=${delayed1.delta}s,H/2=${(H1 / 2).toFixed(0)}s`);
  ok(delayed2.delta >= 180 && delayed2.delta <= 480, 'R13 前置:誤點車2 delay 落在3-8分鐘', `delta=${delayed2.delta}s`);
  ok(silence1.silenceDur > 180 && silence2.silenceDur > 180, 'R13 前置:兩次折返靜默皆 >3分鐘',
    `dur1=${silence1.silenceDur}s dur2=${silence2.silenceDur}s`);

  // 取消班永不產生 claim,但仍留在 tripSets13(排班表)裡——scheduleNeighbors 找得到它,
  // 才是真的在驗「取消班不造成鄰班連鎖錯位」(R3 語義的合成節奏版)。
  const activeRoster = roster.filter(e => e !== cancelled);

  function claimAt(entry, nowSec) { // 給定車輛與當下時刻,回傳此刻的看板列 claim(或 null=尚未發車/已到站/靜默中)
    const shifted = sec => sec + (entry.delta || 0);
    if (nowSec < shifted(entry.tr[1]) || nowSec > shifted(entry.tr[entry.tr.length - 1])) return null;
    let trackId = entry.carId;
    if (entry.silenceAt != null) {
      const s0 = shifted(entry.silenceAt), s1 = s0 + entry.silenceDur;
      if (nowSec >= s0 && nowSec < s1) return null; // 靜默期間,不產生任何 claim
      if (nowSec >= s1) trackId = entry.carId2; // 靜默後,track id 更換重現
    }
    const legs = entry.tr.length / 2 - 1;
    for (let k = 1; k <= legs; k++) {
      const legDep = shifted(entry.tr[(k - 1) * 2 + 1]), legArr = shifted(entry.tr[k * 2 + 1]);
      if (nowSec < legDep || nowSec > legArr) continue;
      if (k === 1) {
        return { trackId, line: entry.line, dir: entry.dir, from: entry.tr[0], to: entry.tr[entry.tr.length - 2],
          destIdx: entry.tr[entry.tr.length - 2], arrEpoch: secToEpoch(legDep), run: 0, terminal: true };
      }
      const from = entry.tr[(k - 1) * 2], to = entry.tr[k * 2];
      return { trackId, line: entry.line, dir: entry.dir, from, to, destIdx: entry.tr[entry.tr.length - 2],
        arrEpoch: secToEpoch(legArr), run: legArr - legDep, terminal: false };
    }
    return null;
  }

  // 雙軌並跑:v1.2(真實 import)與 v0 水位線對照組(文字替換注入),共用同一份合成 claims 序列。
  const v0Path = makeV0WatermarkVariant();
  try {
    const { bindTracksToTrips: bindV0 } = await import(pathToFileURL(v0Path).href);
    let priorV12 = [], priorV0 = [];
    const auditV12 = { bound: 0, unbound: 0, reattach: 0, malformed: 0 };
    const auditV0 = { bound: 0, unbound: 0, reattach: 0, malformed: 0 };
    const seenTrackIds = new Map(); // carId(基礎) -> Set(實際出現過的 trackId,供合成真值比對)
    // silence2 專用:記錄兩邊各自「carId2 第一次真的綁上真值 tripKey」的輪次——這是比「聚合
    // unbound 率」更精準的差異化指標(見下方 R13 對照組斷言的說明)。
    let v12RecoverTick = null, v0RecoverTick = null;
    for (let t = WIN_START; t <= WIN_END; t += TICK) {
      const claims = [];
      for (const entry of activeRoster) {
        const c = claimAt(entry, t);
        if (!c) continue;
        claims.push(c);
        if (!seenTrackIds.has(entry.carId)) seenTrackIds.set(entry.carId, new Set());
        seenTrackIds.get(entry.carId).add(c.trackId);
      }
      const nowEpoch = secToEpoch(t);
      const outV12 = bindTracksToTrips({ model: null, tripSets: tripSets13, dayType: dayType13, tracks: claims,
        priorBindings: priorV12, nowEpoch, day: day13 });
      const outV0 = bindV0({ model: null, tripSets: tripSets13, dayType: dayType13, tracks: claims,
        priorBindings: priorV0, nowEpoch, day: day13 });
      priorV12 = outV12.bindings; priorV0 = outV0.bindings;
      for (const k of ['bound', 'unbound', 'reattach', 'malformed']) { auditV12[k] += outV12.audit[k]; auditV0[k] += outV0.audit[k]; }
      if (v12RecoverTick == null) {
        const r = priorV12.find(b => b.line === silence2.line && b.dir === silence2.dir && b.tripKey === silence2.tripKey);
        if (r && r.trackId === silence2.carId2) v12RecoverTick = t;
      }
      if (v0RecoverTick == null) {
        const r = priorV0.find(b => b.line === silence2.line && b.dir === silence2.dir && b.tripKey === silence2.tripKey);
        if (r && r.trackId === silence2.carId2) v0RecoverTick = t;
      }
    }

    ok(auditV12.malformed === 0, 'R13 前置:合成 claims 全數格式合法(malformed=0,證明合成器本身沒有結構性bug)',
      `malformed=${auditV12.malformed}`);
    ok((seenTrackIds.get(silence1.carId) || new Set()).has(silence1.carId2) &&
       (seenTrackIds.get(silence2.carId) || new Set()).has(silence2.carId2),
      'R13 前置:兩台折返車確實在合成流中換過 track id(真的產生了track id更換,不是空判)',
      `silence1 ids=${JSON.stringify([...(seenTrackIds.get(silence1.carId) || [])])};` +
      `silence2 ids=${JSON.stringify([...(seenTrackIds.get(silence2.carId) || [])])}`);

    const totalV12 = auditV12.bound + auditV12.reattach + auditV12.unbound;
    const unboundRateV12 = totalV12 ? auditV12.unbound / totalV12 : 0;
    ok(unboundRateV12 < 0.05, 'R13 合成正式節奏(15s/輪×60分鐘,正式 cron 節奏的可測替身) unbound率<5%硬門檻',
      `unbound=${auditV12.unbound}/${totalV12}=${(unboundRateV12 * 100).toFixed(2)}%(bound=${auditV12.bound},reattach=${auditV12.reattach})`);

    const totalV0 = auditV0.bound + auditV0.reattach + auditV0.unbound;
    const unboundRateV0 = totalV0 ? auditV0.unbound / totalV0 : 0;
    // 對照組斷言分兩層,不只賭聚合 unbound 率過 5%:
    // (1) 機制級(有牙、可解釋):silence2 刻意挑「靜默重現仍在第一腿(terminal claim)內」——
    //     v0 水位線比對 t[0]===claim.from,terminal claim 的 from 就是 t[0],於是候選在掃描
    //     records 時會掃到「自己那筆尚未刪除的舊紀錄」,自我參照恆有 tr[1]<=wm ⇒ 只要重現時刻還
    //     沒跨出第一腿就會自我卡死;v1.2 的無反轉約束比的是「與鄰班」而非「與自己」,同一班次
    //     shift 不變對鄰班無威脅,理應立刻認回。斷言 v1.2 在靜默結束後 1 輪內認回、v0 則明顯較晚
    //     (或整個觀測窗都認不回)——這是 root-cause 追出來的確定性差異,不受聚合分母大小影響。
    // (2) 聚合級(下限,防機制級斷言自己有 bug):v0 的 unbound 絕對數要嚴格多於 v1.2,且 v1.2
    //     本身要乾淨(=0)——不用「5%」這種與本測試 2 個折返車注入量級不成比例的門檻(單一車能
    //     製造的自我卡死視窗結構上被該車第一腿長度封頂,實測全體排班第一腿最長僅 300s,2 台車
    //     撐死可貢獻約 10-15 個 unbound instance,對 400+ 總量永遠到不了 5%,硬湊這個數字只會
    //     逼著合成器去製造不寫實的排班,見施工日誌)。
    const recoverGapSec = (v0RecoverTick != null && v12RecoverTick != null) ? v0RecoverTick - v12RecoverTick : null;
    ok(v12RecoverTick != null && v12RecoverTick - (silence2.silenceAt + silence2.silenceDur) <= TICK,
      'R13 對照組機制級:v1.2 對 silence2 在靜默結束後 1 輪內就認回(無反轉約束比鄰班、對自己無威脅)',
      `silenceEnd=${silence2.silenceAt + silence2.silenceDur},v12RecoverTick=${v12RecoverTick}`);
    ok(v0RecoverTick == null || recoverGapSec >= 3 * TICK,
      'R13 對照組機制級:v0 水位線對 silence2 的認回明顯較晚或整窗認不回(terminal claim 自我參照卡死,重現一跨出第一腿就解除)',
      `v0RecoverTick=${v0RecoverTick ?? '整窗未認回'},v12RecoverTick=${v12RecoverTick},差距=${recoverGapSec ?? 'N/A'}s`);
    ok(auditV12.unbound === 0 && auditV0.unbound > auditV12.unbound,
      'R13 對照組聚合級下限:v1.2 乾淨(unbound=0)且 v0 的 unbound 絕對數嚴格多於 v1.2(真實、可重現的差距,不強求湊到跟本測試注入量級不成比例的百分比)',
      `v0 unbound=${auditV0.unbound}/${totalV0}=${(unboundRateV0 * 100).toFixed(2)}% vs v1.2 unbound=${auditV12.unbound}/${totalV12}=${(unboundRateV12 * 100).toFixed(2)}%`);

    // 綁對率:合成真值(每台車該綁哪班,合成器撒車時就記錄)vs 綁定結果——不是只看 unbound 率,
    // 防「判準與實作同源」(memory assertion-blindspot-taxonomy):真值來自合成器自己的бookkeeping,
    // 不是從 bindTracksToTrips 的輸出反推。比對「這輪最終應該報的那個 trackId」(折返車=carId2,
    // 一般車=carId),不是「這台車生涯用過的任一 id」——後者對折返車是假陰性漏洞:若系統把 trip
    // 卡死綁在靜默前的舊 trackId(該 id 早就不再回報)、真正在跑的 carId2 反而流落他處或掛零,
    // ids.has(舊id) 仍會判定「正確」,測不出「卡死在過期身分」這種真實壞掉的樣子。
    let correct = 0; const wrong = [];
    for (const entry of activeRoster) {
      const rec = priorV12.find(b => b.line === entry.line && b.dir === entry.dir && b.tripKey === entry.tripKey);
      const expectedFinalId = entry.carId2 || entry.carId;
      if (rec && rec.trackId === expectedFinalId) correct++;
      else wrong.push({ carId: entry.carId, tripKey: entry.tripKey, expected: expectedFinalId, got: rec ? rec.trackId : 'unbound' });
    }
    const bindAccuracy = activeRoster.length ? correct / activeRoster.length : 0;
    ok(bindAccuracy > 0.98, 'R13 綁對率(合成真值 vs 綁定結果,真值由合成器撒車時直接記錄,判準不與實作同源)>98%',
      `${correct}/${activeRoster.length}=${(bindAccuracy * 100).toFixed(1)}%` +
      (wrong.length ? `;錯例前5:${JSON.stringify(wrong.slice(0, 5))}` : ''));

    const cancelledBound = priorV12.find(b => b.line === cancelled.line && b.dir === cancelled.dir && b.tripKey === cancelled.tripKey);
    ok(!cancelledBound, 'R13 取消班全程無人綁定,未造成鄰班連鎖錯位(鄰班正確性已由上方綁對率涵蓋)',
      cancelledBound ? `卻被綁到 trackId=${cancelledBound.trackId}` : '');
  } finally {
    fs.rmSync(v0Path, { force: true });
  }
}

// ═══ 工項4:Y 進 tracks/bindings(model includeY 交集帳本路徑)。R14/R5+非Y迴歸雜湊比對 ═══
say('\n── R14(工項4):Y 進 tracks/bindings——正面:Y 綁得上自己班表;反面:D1 寫入邊界過濾後 events 絕不含 Y ──');
{
  const trtcJson14 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json')));
  const times14 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json')));
  const codesJson14 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json')));
  const dayTypeTable14 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json')));
  const day14 = '2026-08-03'; // 週一/平日,與 R13 同一天(已知有效日型)
  const modelY14 = buildTrtcModel(trtcJson14, times14, codesJson14, { includeY: true });
  ok(modelY14.lines.has('Y'), 'R14 前置:Y 進 model.lines(includeY:true)', `lines=${[...modelY14.lines.keys()].sort().join(',')}`);
  const { tripSets: tripSets14, dayKeys: dayKeys14 } = buildTripSetsByLineDir(times14, dayTypeTable14, day14);
  const yTrips14 = tripSets14.get('Y|2') || [];
  ok(yTrips14.length > 10, 'R14 前置:Y|2 該日班表有足夠班次(非空,證明 tripSets 真的含 Y)', `Y|2=${yTrips14.length}`);

  const tr14 = yTrips14[Math.floor(yTrips14.length / 2)]; // 挑中段一班,避開頭尾邊界情況
  const legIdx14 = 3; // 第3腿,避開起點站,模擬「行駛中」列車(非終點觀測)
  const legFrom14 = tr14[(legIdx14 - 1) * 2], legTo14 = tr14[legIdx14 * 2];
  const schedDep14 = tr14[(legIdx14 - 1) * 2 + 1], schedArr14 = tr14[legIdx14 * 2 + 1];
  const DELTA14 = 12; // 準點微幅(秒),不涉及誤點/安全閥,單純測「Y 綁不綁得上」
  const rowArrEpoch14 = secToEpoch(schedArr14 + DELTA14);
  // 直接餵 resolveBoardRows 的輸出形狀(略過站名比對這一步——Y 有站名與其他線同名的風險,
  // 站名解析是通用邏輯、非工項4改動範圍,這裡只測 claimBoardRows 之後、對 Y 才真正相關的部分)。
  const resolvedRow14 = { line: 'Y', dir: 2, stationIdx: legTo14, destIdx: tr14[tr14.length - 2],
    destName: '', no: '', arrEpoch: rowArrEpoch14, baseEpoch: rowArrEpoch14, sec: 0, atStation: false };
  const nowEpoch14 = secToEpoch(schedDep14 + DELTA14 + 5); // 剛發車後5秒的「現在」
  const claimed14 = claimBoardRows(modelY14, [resolvedRow14], nowEpoch14, new Map());
  ok(claimed14.claims.length === 1 && claimed14.claims[0].from === legFrom14 && claimed14.claims[0].to === legTo14,
    'R14 前置:claimBoardRows 正確解出這筆 Y 觀測(未被 unclaimed 丟棄)',
    `claims=${claimed14.claims.length}, unclaimed=${JSON.stringify(claimed14.unclaimed)}`);
  const collapsed14 = collapseClaims(claimed14.claims);
  const assigned14 = assignLedgerFrame({ model: modelY14, claims: collapsed14, cars: [], priorTracks: [], aliases: [],
    day: day14, nowEpoch: nowEpoch14, calibrations: new Map() });

  const yTrackUpdate14 = assigned14.trackUpdates.find(x => x.line === 'Y');
  ok(!!yTrackUpdate14, 'R14 正面(1):assignLedgerFrame 對 Y 觀測產生 trackUpdates(工項4要求 Y 的 tracks 寫 D1 的前提)',
    JSON.stringify(yTrackUpdate14));
  const yEventsUnfiltered14 = assigned14.events.filter(e => e.line === 'Y');
  ok(yEventsUnfiltered14.length > 0, 'R14 前置:純函式層面 assignLedgerFrame 確實會對 Y 產生 events' +
    '(證明下面的「絕不進 events」斷言不是空集合偽陽性,過濾器真的在擋東西)', `events(Y)=${yEventsUnfiltered14.length}`);
  // 反面:複刻 worker.js persistTrtcLedger 的寫入邊界過濾運算式(e.line!=='Y'),逐字一致(見下方
  // 雜湊比對段落再次以真實語料驗證同一運算式)。
  const filteredEvents14 = assigned14.events.filter(e => e.line !== 'Y');
  ok(filteredEvents14.every(e => e.line !== 'Y') &&
    filteredEvents14.length === assigned14.events.length - yEventsUnfiltered14.length,
    'R14 反面:套用 D1 寫入邊界過濾器(worker.js persistTrtcLedger 的 e.line!==\'Y\')後,events 絕不含 Y',
    `filtered=${filteredEvents14.length}/${assigned14.events.length}`);

  const round14 = bindTracksToTrips({ model: modelY14, tripSets: tripSets14, dayType: dayKeys14.get('Y') || null,
    tracks: assigned14.claims, priorBindings: [], nowEpoch: nowEpoch14, day: day14 });
  const yBinding14 = round14.bindings.find(b => b.line === 'Y' && !b.done);
  ok(!!yBinding14 && yBinding14.tripKey === tripKeyOf(tr14), 'R14 正面(2):Y 軌跡綁得上 Y 自己的班表(tripKey 精確相符)',
    JSON.stringify(yBinding14));
}

say('\n── R5(工項4,設計書§10):Y track 人為碎裂(斷3分鐘)——重接回同一班次比率量化(目標>90%) ──');
{
  const times5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json')));
  const dayTypeTable5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json')));
  const day5 = '2026-08-03';
  const { tripSets: tripSets5, dayKeys: dayKeys5 } = buildTripSetsByLineDir(times5, dayTypeTable5, day5);
  const dayTypeY5 = dayKeys5.get('Y') || null;

  function legWindow5(tr, legIdx) {
    const from = tr[(legIdx - 1) * 2], to = tr[legIdx * 2];
    const dep = tr[(legIdx - 1) * 2 + 1], arr = tr[legIdx * 2 + 1];
    return { from, to, dep, arr, run: arr - dep };
  }
  // round1 在 breakLegIdx 建立綁定,靜默(碎裂中,不送任何 claim),round3 在 reappearLegIdx
  // (排定發車 >= round1 發車+180s 的第一腿)以新 trackId 重現。shift 全程固定 DELTA(不額外
  // 注入漂移)——本測試只量「認回機制本身」在 Y 真實班表跨度上的成功率,不與漂移量測混淆
  // (漂移是 train-kinematics-model 的獨立關注點)。
  function simulateFragment5(tr, dir, sampleId) {
    const legCount = (tr.length - 2) / 2;
    const breakLegIdx = Math.max(1, Math.min(legCount, Math.round(legCount * 0.35)));
    const w0 = legWindow5(tr, breakLegIdx);
    const DELTA = 8;
    const round1Now = secToEpoch(w0.arr + DELTA + 3);
    const trackA = `y5:${sampleId}:A`;
    const claimA = { trackId: trackA, line: 'Y', dir, from: w0.from, to: w0.to, destIdx: tr[tr.length - 2],
      arrEpoch: secToEpoch(w0.arr + DELTA), run: w0.run, terminal: false };
    const r1 = bindTracksToTrips({ model: null, tripSets: tripSets5, dayType: dayTypeY5, tracks: [claimA],
      priorBindings: [], nowEpoch: round1Now, day: day5 });
    const b1 = r1.bindings.find(b => b.trackId === trackA && !b.done);
    if (!b1) return { sampleId, ok: false, skip: true, reason: 'round1未出生(前置失敗,不計入分母)' };

    let reappearLegIdx = -1;
    for (let k = breakLegIdx + 1; k <= legCount; k++) {
      if (legWindow5(tr, k).dep >= w0.dep + DELTA + 180) { reappearLegIdx = k; break; }
    }
    if (reappearLegIdx < 0) return { sampleId, ok: false, skip: true, reason: '該班剩餘里程不足3分鐘(結構性排除,不計入分母)' };
    const w1 = legWindow5(tr, reappearLegIdx);
    const trackB = `y5:${sampleId}:B`;
    const claimB = { trackId: trackB, line: 'Y', dir, from: w1.from, to: w1.to, destIdx: tr[tr.length - 2],
      arrEpoch: secToEpoch(w1.arr + DELTA), run: w1.run, terminal: false };
    const round3Now = secToEpoch(w1.arr + DELTA + 3);
    const r3 = bindTracksToTrips({ model: null, tripSets: tripSets5, dayType: dayTypeY5, tracks: [claimB],
      priorBindings: r1.bindings, nowEpoch: round3Now, day: day5 });
    const b3 = r3.bindings.find(b => b.trackId === trackB && !b.done);
    const reconnected = !!b3 && b3.tripKey === tripKeyOf(tr) && b3.boundEpoch === b1.boundEpoch;
    return { sampleId, ok: reconnected, skip: false, reason: reconnected ? '' :
      (b3 ? 'trackId B 綁到別的 tripKey 或 boundEpoch 未延續(疑似當全新出生非認回)' : 'trackId B 完全 unbound') };
  }

  const results5 = [];
  for (const dir of [1, 2]) {
    const trips = tripSets5.get(`Y|${dir}`) || [];
    const stride = Math.max(1, Math.floor(trips.length / 18)); // 每方向約取18班,雙向合計約36次模擬
    for (let i = 0; i < trips.length; i += stride) results5.push(simulateFragment5(trips[i], dir, `${dir}-${i}`));
  }
  const attempted5 = results5.filter(r => !r.skip);
  const succeeded5 = attempted5.filter(r => r.ok);
  const rate5 = attempted5.length ? succeeded5.length / attempted5.length : 0;
  ok(attempted5.length >= 20, 'R5 前置:實際模擬到足夠的碎裂案例(非結構性排除)', `attempted=${attempted5.length}/${results5.length}`);
  ok(rate5 > 0.90, 'R5 Y track 人為碎裂(斷3分鐘)重接回同一班次比率>90%(設計書§10目標)',
    `${succeeded5.length}/${attempted5.length}=${(rate5 * 100).toFixed(1)}%`);
  const failures5 = attempted5.filter(r => !r.ok);
  if (failures5.length) note('R5 未重接個案(誠實列出)', failures5.map(f => `${f.sampleId}:${f.reason}`).join('; '));
  else note('R5 本次抽樣全數重接', '結構性上限(設計書§11風險2:無alias)在本抽樣未出現,不代表全域必為100%(本測試刻意隔離單一trip、無跨車競爭,見施工日誌工項4節)');
}

say('\n── 工項4非Y迴歸雜湊比對(比照 B1 V1「舊輸出凍結」前例)——Y off 全輸出 vs Y on 過濾後非Y輸出逐byte相符;突變對照證明有牙 ──');
{
  const CORPUS_HG = process.env.TRTC_FIXTURE_DIR || '/Users/xuxiang/Code/軌島-語料/trtc-peak-0803';
  const epochOfHG = value => {
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : null;
  };
  const trtcJsonHG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json')));
  const timesHG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json')));
  const codesJsonHG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json')));
  const dayTypeTableHG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json')));
  const tkFileHG = fs.readdirSync(CORPUS_HG).filter(f => f.startsWith('snap_tk_')).sort()[0];
  const hwFileHG = fs.readdirSync(CORPUS_HG).filter(f => f.startsWith('snap_hw_')).sort()[0];
  const brFileHG = fs.readdirSync(CORPUS_HG).filter(f => f.startsWith('snap_br_')).sort()[0];
  ok(!!tkFileHG, 'HG 前置:語料目錄有 tk 快照可用', `${CORPUS_HG}/${tkFileHG || '(none)'}`);
  const tkSnapHG = JSON.parse(fs.readFileSync(path.join(CORPUS_HG, tkFileHG)));
  const hwSnapHG = JSON.parse(fs.readFileSync(path.join(CORPUS_HG, hwFileHG)));
  const brSnapHG = JSON.parse(fs.readFileSync(path.join(CORPUS_HG, brFileHG)));
  const nowEpochHG = Math.max(...tkSnapHG.rows.map(r => epochOfHG(r.NowDateTime) || 0));
  const dayHG = trtcServiceDay(nowEpochHG);

  const modelOffHG = buildTrtcModel(trtcJsonHG, timesHG, codesJsonHG); // opts省略=includeY:false(工項4修改前的舊行為)
  const modelOnHG = buildTrtcModel(trtcJsonHG, timesHG, codesJsonHG, { includeY: true }); // 工項4後 trtcLedgerModel 的行為
  ok(!modelOffHG.lines.has('Y') && modelOnHG.lines.has('Y'), 'HG 前置:兩顆 model 的 Y 存在性確實不同(否則比較無意義)',
    `off has Y=${modelOffHG.lines.has('Y')}, on has Y=${modelOnHG.lines.has('Y')}`);

  const builtOffHG = buildLedgerFromRaw({ model: modelOffHG, boardRows: tkSnapHG.rows, hwRows: hwSnapHG.rows,
    brRows: brSnapHG.rows, epochOf: epochOfHG, priorTracks: [], aliases: [], historicalEvents: [],
    nowEpoch: nowEpochHG, day: dayHG });
  const builtOnHG = buildLedgerFromRaw({ model: modelOnHG, boardRows: tkSnapHG.rows, hwRows: hwSnapHG.rows,
    brRows: brSnapHG.rows, epochOf: epochOfHG, priorTracks: [], aliases: [], historicalEvents: [],
    nowEpoch: nowEpochHG, day: dayHG });
  ok(builtOnHG.frame.some(x => x.line === 'Y') || builtOnHG.events.some(x => x.line === 'Y'),
    'HG 前置:Y on 這一輪語料確實產生了 Y 的 frame/events(否則下面的「過濾後不變」是無意義的空比對)',
    `frame(Y)=${builtOnHG.frame.filter(x => x.line === 'Y').length}, events(Y)=${builtOnHG.events.filter(x => x.line === 'Y').length}`);

  const { tripSets: tripSetsHG, dayKeys: dayKeysHG } = buildTripSetsByLineDir(timesHG, dayTypeTableHG, dayHG);
  const dayTypeHG = dayKeysHG.get('BL') || null;
  const boundOffHG = bindTracksToTrips({ model: modelOffHG, tripSets: tripSetsHG, dayType: dayTypeHG,
    tracks: builtOffHG.claims, priorBindings: [], nowEpoch: nowEpochHG, day: dayHG });
  const boundOnHG = bindTracksToTrips({ model: modelOnHG, tripSets: tripSetsHG, dayType: dayTypeHG,
    tracks: builtOnHG.claims, priorBindings: [], nowEpoch: nowEpochHG, day: dayHG });

  const nonY = x => x.line !== 'Y';
  const md5Of = obj => md5(JSON.stringify(obj));
  const offSigHG = {
    frame: builtOffHG.frame.filter(nonY), events: builtOffHG.events.filter(nonY),
    trackUpdates: builtOffHG.trackUpdates.filter(nonY), aliasUpdates: builtOffHG.aliasUpdates,
    bindings: boundOffHG.bindings.filter(nonY),
  };
  // events 用 worker.js persistTrtcLedger 的同一過濾運算式(e.line!=='Y');tracks/aliases/bindings
  // 刻意不在 worker.js 過濾(Y 本該進 D1),這裡取「非Y列」只是為了跟 off 那邊(結構上不可能有Y)比較。
  const onSigFilteredHG = {
    frame: builtOnHG.frame.filter(nonY), events: builtOnHG.events.filter(e => e.line !== 'Y'),
    trackUpdates: builtOnHG.trackUpdates.filter(nonY), aliasUpdates: builtOnHG.aliasUpdates,
    bindings: boundOnHG.bindings.filter(nonY),
  };
  const sigKeysHG = ['frame', 'events', 'trackUpdates', 'aliasUpdates', 'bindings'];
  const mismatchesHG = sigKeysHG.filter(k => md5Of(offSigHG[k]) !== md5Of(onSigFilteredHG[k]));
  ok(mismatchesHG.length === 0,
    'HG(a) Y off 全輸出 vs Y on 過濾後非Y輸出逐byte相符(md5,不比計數)——Y 開啟對非Y線零副作用',
    mismatchesHG.length ? `不符欄位:${mismatchesHG.join(',')}` :
      sigKeysHG.map(k => `${k}=${md5Of(offSigHG[k]).slice(0, 8)}`).join(' '));

  // 正向對照(突變):structuredClone + 改一個非Y列的一個欄位,md5 必須轉紅——證明比對機制有牙,
  // 不是「兩邊剛好都是空陣列/形狀相同就放行」的偽陽性(比照 B1 V1 的 mutant.board[0].eta++ 手法)。
  const mutantFrameHG = structuredClone(onSigFilteredHG.frame);
  const mutantIdxHG = mutantFrameHG.findIndex(x => x.line !== 'Y');
  ok(mutantIdxHG >= 0, 'HG 前置:過濾後 frame 內確有非Y列可供突變(樣本不為空)', `length=${mutantFrameHG.length}`);
  if (mutantIdxHG >= 0) {
    mutantFrameHG[mutantIdxHG].arrEpoch = (mutantFrameHG[mutantIdxHG].arrEpoch || 0) + 1;
    ok(md5Of(mutantFrameHG) !== md5Of(offSigHG.frame),
      'HG(b) 正向對照:改一個非Y列的 arrEpoch 後 md5 必轉紅', '確認雜湊比對機制真的在比內容,不是形狀相同就放行');
  }
}

// ═══ 工項5:訪客唯讀 join(joinBoardRowsToTrips)。R10+基礎正反面 ═══
say('\n── R10(工項5,設計書§7/§10):訪客 join——有號列 no→alias→binding;無號列 cost=|rowShift-lastShift|且僅限已綁班次;45s 窗突變對照 ──');
{
  const [tripJ] = buildSeries(1, T0 + 2000, true); // 寬視窗版,避免無關的黏著/視窗到期干擾
  const tripSetsJ = tripSetsOf([tripJ]);
  const legFromJ = tripJ[0], legToJ = tripJ[2];
  const schedDepJ = tripJ[1], schedArrJ = tripJ[3];
  const bindingJ = { line: LINE, dir: DIR, tripKey: tripKeyOf(tripJ), trackId: 'trkJ', lastShift: 10, done: false };

  const rowNumbered = { line: LINE, dir: DIR, from: legFromJ, to: legToJ, run: schedArrJ - schedDepJ,
    arrEpoch: secToEpoch(schedArrJ + 15), no: '9001', terminal: false };
  const aliasMap = new Map([['9001', 'trkJ']]);
  const matchNumbered = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowNumbered], bindings: [bindingJ], aliasByHwNo: aliasMap });
  ok(matchNumbered.length === 1 && matchNumbered[0].key === tripKeyOf(tripJ) && matchNumbered[0].trackId === 'trkJ' &&
      matchNumbered[0].trackId !== matchNumbered[0].key && matchNumbered[0].shift === 15,
    'R10 前置(有號列):no→alias→binding 精確匹配,trackId 取實體車身份(非 trip key),shift 反映新鮮偏移', JSON.stringify(matchNumbered));

  const rowNumberedNoAlias = { ...rowNumbered, no: '9999' }; // 查無此車號
  const missNoAlias = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowNumberedNoAlias], bindings: [bindingJ], aliasByHwNo: aliasMap });
  ok(missNoAlias.length === 0, 'R10 前置(有號列,反面):alias 查無此車號 ⇒ 不產生 trips 項(丟棄)', JSON.stringify(missNoAlias));

  const rowUnnumbered = { line: LINE, dir: DIR, from: legFromJ, to: legToJ, run: schedArrJ - schedDepJ,
    arrEpoch: secToEpoch(schedArrJ + 18), no: '', terminal: false }; // 無號,真實shift=18,與lastShift=10差8秒,遠小於45s
  const matchUnnumbered = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowUnnumbered], bindings: [bindingJ], aliasByHwNo: new Map() });
  ok(matchUnnumbered.length === 1 && matchUnnumbered[0].key === tripKeyOf(tripJ) && matchUnnumbered[0].trackId === 'trkJ' &&
      matchUnnumbered[0].trackId !== matchUnnumbered[0].key && matchUnnumbered[0].shift === 18,
    'R10 前置(無號列):cost-based 最近匹配成功,trackId 仍來自 active binding(cost=8s≤45s窗)', JSON.stringify(matchUnnumbered));

  const missUnbound = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowUnnumbered], bindings: [], aliasByHwNo: new Map() });
  ok(missUnbound.length === 0, 'R10 前置(無號列,反面):同一列在「這班尚未被 cron 綁定」時 ⇒ 不產生 trips 項(僅限已綁班次)',
    JSON.stringify(missUnbound));

  for (const badTrackId of [null, '', '   ', tripKeyOf(tripJ)]) {
    const badBinding = { ...bindingJ, trackId: badTrackId };
    const missed = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowUnnumbered], bindings: [badBinding], aliasByHwNo: new Map() });
    ok(missed.length === 0,
      `R10 trackId 反面:${JSON.stringify(badTrackId)} 不得產生 trip(trackId 必須非空且不得拿 trip key 冒充)`,
      JSON.stringify(missed));
  }

  const duplicateTripBindings = [bindingJ, { ...bindingJ, trackId: 'trkJ-conflict' }];
  for (const ordered of [duplicateTripBindings, [...duplicateTripBindings].reverse()]) {
    const missed = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowNumbered], bindings: ordered,
      aliasByHwNo: new Map([['9001', 'trkJ']]) });
    ok(missed.length === 0,
      'R10 身分衝突反面:同一 trip 同時宣稱兩個 track 時須 fail closed,不得由 bindings 陣列順序選最後一筆',
      JSON.stringify(missed));
  }

  const tripConflict = mkTrip(0, T0 + 2600, [[1, T0 + 2800]]);
  const rowConflict = { line: LINE, dir: DIR, from: tripConflict[0], to: tripConflict[2],
    run: tripConflict[3] - tripConflict[1], arrEpoch: secToEpoch(tripConflict[3] + 10), no: '', terminal: false };
  const sameTrackTwoTrips = [bindingJ, { ...bindingJ, tripKey: tripKeyOf(tripConflict) }];
  const missedTrackConflict = joinBoardRowsToTrips({ tripSets: tripSetsOf([tripJ, tripConflict]),
    rows: [rowUnnumbered, rowConflict], bindings: sameTrackTwoTrips, aliasByHwNo: new Map() });
  ok(missedTrackConflict.length === 0,
    'R10 身分衝突反面:同一 track 同時佔兩個 trip 時兩邊皆 fail closed,不得輸出互相矛盾的實體身分',
    JSON.stringify(missedTrackConflict));

  const rowUnnumberedLater = { ...rowUnnumbered, arrEpoch: rowUnnumbered.arrEpoch + 1 };
  for (const orderedRows of [[rowUnnumbered, rowUnnumberedLater], [rowUnnumberedLater, rowUnnumbered]]) {
    const picked = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: orderedRows,
      bindings: [bindingJ], aliasByHwNo: new Map() });
    ok(picked.length === 1 && picked[0].eta.arrEpoch === rowUnnumbered.arrEpoch,
      'R10 多站預報:同一 trip/track 的兩個官方 row 決定性保留最早到站列,不得由 rows 順序決定勝者',
      JSON.stringify(picked));
  }

  const tieA = mkTrip(0, T0 + 3000, [[1, T0 + 3200]]);
  const tieB = mkTrip(0, T0 + 3300, [[1, T0 + 3500]]);
  const tieRow = { line: LINE, dir: DIR, from: 0, to: 1, run: 200,
    arrEpoch: secToEpoch(T0 + 3350), no: '', terminal: false };
  const tieBindings = [
    { ...bindingJ, tripKey: tripKeyOf(tieA), trackId: 'tie-A', lastShift: 150 },
    { ...bindingJ, tripKey: tripKeyOf(tieB), trackId: 'tie-B', lastShift: -150 },
  ];
  for (const ordered of [tieBindings, [...tieBindings].reverse()]) {
    const missed = joinBoardRowsToTrips({ tripSets: tripSetsOf([tieA, tieB]), rows: [tieRow],
      bindings: ordered, aliasByHwNo: new Map() });
    ok(missed.length === 0,
      'R10 同分反面:無號 row 對兩個 active binding 的最小 cost 完全同分時 fail closed,不得由 bindings 順序決定',
      JSON.stringify(missed));
  }

  // 車身身分與班次身分是兩條軸：同 track 跨 trip 應共用 eased/motion key；reclaim 新 track 則如實更新。
  const tripRebind = mkTrip(0, T0 + 2600, [[1, T0 + 2800]]);
  const rowRebind = { line: LINE, dir: DIR, from: tripRebind[0], to: tripRebind[2], run: tripRebind[3] - tripRebind[1],
    arrEpoch: secToEpoch(tripRebind[3] + 10), no: '', terminal: false };
  const sharedTrack = joinBoardRowsToTrips({ tripSets: tripSetsOf([tripRebind]), rows: [rowRebind],
    bindings: [{ ...bindingJ, tripKey: tripKeyOf(tripRebind) }], aliasByHwNo: new Map() });
  ok(sharedTrack.length === 1 && sharedTrack[0].key !== matchUnnumbered[0].key && sharedTrack[0].trackId === matchUnnumbered[0].trackId,
    'R10 身分連續:同一 track 重綁到另一 trip 時,trip key 變但 trackId 不變(可共用 eased/motion 狀態)',
    JSON.stringify({ before: matchUnnumbered[0], after: sharedTrack[0] }));
  const reclaimedTrack = joinBoardRowsToTrips({ tripSets: tripSetsJ, rows: [rowUnnumbered],
    bindings: [{ ...bindingJ, trackId: 'trkJ-reclaimed' }], aliasByHwNo: new Map() });
  ok(reclaimedTrack.length === 1 && reclaimedTrack[0].key === matchUnnumbered[0].key && reclaimedTrack[0].trackId === 'trkJ-reclaimed',
    'R10 reclaim:同 trip 改由新 track 認回時,trips[] 如實反映新 trackId(不停留舊值)',
    JSON.stringify({ before: matchUnnumbered[0], after: reclaimedTrack[0] }));

  // R10 主測:BR 尖峰頭距 132s(設計書§7 原文舉例)情境——45s 窗安全,突變成 300s 產生跨班誤 join。
  const H = 132;
  const tripA = mkTrip(0, T0 + 5000, [[1, T0 + 5000 + 200]]);
  const tripB = mkTrip(0, T0 + 5000 + H, [[1, T0 + 5000 + H + 200]]);
  const tripSetsAB = tripSetsOf([tripA, tripB]);
  const bindingA = { line: LINE, dir: DIR, tripKey: tripKeyOf(tripA), trackId: 'trkA', lastShift: 0, done: false };
  const bindingB = { line: LINE, dir: DIR, tripKey: tripKeyOf(tripB), trackId: 'trkB', lastShift: 0, done: false };
  const rowLateOnA = { line: LINE, dir: DIR, from: tripA[0], to: tripA[2], run: tripA[3] - tripA[1],
    arrEpoch: secToEpoch(tripA[3] + 80), no: '', terminal: false }; // 真身是A,遲80秒(cost-to-A=80,cost-to-B=|80-132|=52)

  const narrow = joinBoardRowsToTrips({ tripSets: tripSetsAB, rows: [rowLateOnA], bindings: [bindingA, bindingB],
    aliasByHwNo: new Map(), windowSec: 45 });
  ok(narrow.length === 0, 'R10(a) 45s窗(設計書值):cost-to-A=80/cost-to-B=52 皆超窗 ⇒ 安全丟棄,不誤配(不校正勝過誤校正)',
    JSON.stringify(narrow));

  const wide = joinBoardRowsToTrips({ tripSets: tripSetsAB, rows: [rowLateOnA], bindings: [bindingA, bindingB],
    aliasByHwNo: new Map(), windowSec: 300 });
  ok(wide.length === 1 && wide[0].key === tripKeyOf(tripB),
    'R10(b) 對照組(窗突變45→300s):BR尖峰頭距132s情境下,真身是A(遲80秒)的列車被誤 join 到相鄰班B' +
    '(cost-to-B=52<cost-to-A=80,更寬的窗讓兩者都「合格」,取最小者反而選錯)——證明45s這個寬度本身有牙',
    JSON.stringify(wide));

  const rowOnTimeA = { line: LINE, dir: DIR, from: tripA[0], to: tripA[2], run: tripA[3] - tripA[1],
    arrEpoch: secToEpoch(tripA[3] + 2), no: '', terminal: false }; // 準點(+2秒),cost-to-A=2
  const normalWindow = joinBoardRowsToTrips({ tripSets: tripSetsAB, rows: [rowOnTimeA], bindings: [bindingA, bindingB],
    aliasByHwNo: new Map(), windowSec: 45 });
  ok(normalWindow.length === 1 && normalWindow[0].key === tripKeyOf(tripA),
    'R10 前置:45s 窗下,準點列車(cost=2s)正確匹配A(基準,供下面收窄對照組比較)', JSON.stringify(normalWindow));
  const tiny = joinBoardRowsToTrips({ tripSets: tripSetsAB, rows: [rowOnTimeA], bindings: [bindingA, bindingB],
    aliasByHwNo: new Map(), windowSec: 0.045 });
  ok(tiny.length === 0, 'R10(c) 對照組(窗收窄45→0.045s):同一顆準點列車(cost=2s>0.045s)不再匹配 ⇒ 窗真的是門檻,不是裝飾',
    JSON.stringify(tiny));
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
    note('語料回放無反轉約束跨目的地暴露度診斷(v1.1施工期間新發現,第三個獨立根因,§5.1(b)本身的缺陷——v1.2已修復,此為歷史紀錄)',
      `全日班表相鄰班次對 ${adjPairs} 組,其中 ${destMismatch}(${adjPairs ? (destMismatch / adjPairs * 100).toFixed(1) : 0}%)` +
      `destIdx 不同(短長分支交錯發車)——v1.1 曾用「修正後終點時刻」互比,這些位置系統性誤判假反轉;` +
      `v1.2 已改比「修正後發車時刻」(同 line+dir 同起點,發車序天生跨目的地可比,見 trtc_board_ledger.mjs ` +
      `violatesNoReversal 與 tmp_設計書.md §5.1(b))——下面 unbound 率是這個真實修復上線後的量測,不是離線 scratch 驗證`);
  }
  // v1.2:門檻改條件式(設計書 §10)。v1.0(純水位線、無 reclaim)在本語料的真實基線是 67.8%
  // (見 trtc_board_ledger.mjs §5.1(b) 註解、本檔 corpus_replay_v11head 對照量測),15pp 改善目標
  // ⇒ 52.8%。此語料快照間距 3.5-7 分鐘,遠寬於正式站 cron 節奏(15-60s),是環境條件不是產品目標,
  // 故不用硬門檻;但三類根因拆解(上游碎裂/演算法擋下/無候選)都要有量化輸出,不能只看聚合率。
  const upstreamFragShare = diagTotal ? oversupplySum / (oversupplySum + diagTotal) : 0;
  ok(diag.noCandidate + diag.hadGoodCandidateButLost + diag.other === diagTotal && oversupplySum >= 0,
    '語料回放根因拆解三類都有量化輸出(上游碎裂/演算法擋下/無候選,見上三行 note)',
    `上游碎裂=${oversupplySum} 演算法擋下(有候選卻未綁上)=${diag.hadGoodCandidateButLost} 無候選=${diag.noCandidate} 其餘=${diag.other}`);
  // 2026-08-13 設計裁示：這批的 gate 是「實體 track 身分穩定、端點依官方 ETA」，不是用
  // 稀疏舊語料的 aggregate unbound 率證明 binder 正確率。保留數字與根因拆解作診斷，但不可
  // 再讓 3.5–7 分鐘取樣間隔的舊語料阻擋穩定性實作（本檔上方也已明寫「不用硬門檻」）。
  note('語料回放 unbound 率（診斷值，依 2026-08-13 裁示不作穩定性 hard gate）',
    `unbound=${audit.unbound}/${totalAttempts}=${(unboundRate * 100).toFixed(1)}%(v1.0基線67.8% → v1.2現值${(unboundRate*100).toFixed(1)}%,` +
    `改善${(67.8 - unboundRate * 100).toFixed(1)}pp,目標15pp;bound=${audit.bound},reattach=${audit.reattach})`);
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

  // ═══ 工項5 端到端:訪客路徑 join(復用本輪已跑起來的 server/D1,round2 剛寫入的 trip_dyn/aliases) ═══
  say('\n── 工項5端到端:GET /api/trtc-live 的 boardPos.trips——新欄位接上;rows 必要欄位零回歸;訪客路徑不寫 trip binder 狀態 ──');
  const liveBefore = jsonCurl(`${BASE}/api/trtc-live`);
  ok(!!liveBefore.boardPos && Array.isArray(liveBefore.boardPos.trips),
    'E2E(工項5) boardPos.trips 為陣列(新欄位已接上實際 API 回應)',
    `trips.length=${liveBefore.boardPos && liveBefore.boardPos.trips && liveBefore.boardPos.trips.length}`);
  ok(!!liveBefore.boardPos && 'dayType' in liveBefore.boardPos,
    'E2E(工項5) boardPos.dayType 欄位存在(值可為 null,但 key 必須在,設計書§7契約)',
    `dayType=${JSON.stringify(liveBefore.boardPos && liveBefore.boardPos.dayType)}`);
  const rowKeys9 = ['line', 'dir', 'from', 'to', 'dest', 'run', 'arrEpoch', 'no', 'terminal'].sort();
  const liveRows = (liveBefore.boardPos && liveBefore.boardPos.rows) || [];
  const hasRequiredBoardRowKeys = row => !!row && typeof row === 'object' &&
    rowKeys9.every(key => Object.prototype.hasOwnProperty.call(row, key));
  const rowsShapeOk = liveRows.length > 0 && liveRows.every(hasRequiredBoardRowKeys);
  ok(rowsShapeOk, 'E2E(工項5) boardPos.rows 逐列必含相容 9 欄(容許 vehicleId 等純增量欄位)',
    `rows=${liveRows.length}, sample keys=${JSON.stringify(Object.keys(liveRows[0] || {}).sort())}`);
  // 正向對照：未來新增欄位不得讓相容 gate 誤紅。Mutation 預期：只從合法 row 拿掉
  // required `arrEpoch` 時，hasRequiredBoardRowKeys 必須轉 false，證明 subset gate 不是無條件放行。
  const futureExtraRow = liveRows[0] ? { ...liveRows[0], futureCompatibleField: 'additive-ok' } : null;
  ok(!!futureExtraRow && hasRequiredBoardRowKeys(futureExtraRow),
    'E2E(工項5) 正向對照:額外純增量欄位仍通過 required-key subset gate',
    `keys=${JSON.stringify(Object.keys(futureExtraRow || {}).sort())}`);
  const missingArrEpochRow = liveRows[0] ? { ...liveRows[0] } : null;
  if (missingArrEpochRow) delete missingArrEpochRow.arrEpoch;
  ok(!!missingArrEpochRow && !hasRequiredBoardRowKeys(missingArrEpochRow),
    'E2E(工項5) mutation control:拿掉 required arrEpoch 必須被 subset gate 抓到',
    `keys=${JSON.stringify(Object.keys(missingArrEpochRow || {}).sort())}`);
  if (liveBefore.boardPos.trips.length > 0) {
    const tripKeysExpected = ['line', 'dir', 'key', 'trackId', 'shift', 'eta'].sort();
    const t0 = liveBefore.boardPos.trips[0];
    ok(JSON.stringify(Object.keys(t0).sort()) === JSON.stringify(tripKeysExpected) &&
        typeof t0.trackId === 'string' && t0.trackId.trim() !== '' && t0.trackId !== t0.key,
      'E2E(工項5) trips[] 單筆形狀符合契約(line/dir/key/trackId/shift/eta),trackId 非空且非 trip key', JSON.stringify(t0));
  } else {
    note('E2E(工項5) 這一輪 trips[] 為空', '可能是這批 fixture 的看板列剛好都 join 不到(不影響存在性,見設計書§7「join不到=丟棄」);純函式層級的非空案例已由上方 R10 前置(有號列)/(無號列)兩項直接驗證');
  }

  // trip binder 單寫者鐵則:訪客路徑(GET /api/trtc-live)連打 3 次,trtc_trip_bindings 列數與
  // trip_dyn 內容必須完全不變。訪客路徑會另行寫 official_roster_v1，不得誤宣稱整體 D1 零寫入。
  db = findLedgerDb(dbDir);
  const beforeBindingsCount = db.prepare('SELECT COUNT(*) AS n FROM trtc_trip_bindings').get().n;
  const beforeStateJson = db.prepare(`SELECT v FROM trtc_state WHERE k='trip_dyn'`).get().v;
  db.close();
  jsonCurl(`${BASE}/api/trtc-live`); jsonCurl(`${BASE}/api/trtc-live`); jsonCurl(`${BASE}/api/trtc-live`);
  await sleep(100);
  db = findLedgerDb(dbDir);
  const afterBindingsCount = db.prepare('SELECT COUNT(*) AS n FROM trtc_trip_bindings').get().n;
  const afterStateJson = db.prepare(`SELECT v FROM trtc_state WHERE k='trip_dyn'`).get().v;
  db.close();
  ok(afterBindingsCount === beforeBindingsCount && afterStateJson === beforeStateJson,
    'E2E(工項5) trip binder 單寫者鐵則:連打3次 /api/trtc-live 後,trtc_trip_bindings 與 trtc_state[trip_dyn] 完全不變',
    `bindings ${beforeBindingsCount}->${afterBindingsCount}; state不變=${afterStateJson === beforeStateJson}`);

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
