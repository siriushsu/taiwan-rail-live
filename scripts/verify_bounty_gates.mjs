// 懸賞判定驗收：防偽四重、品質七項、三態。判準刻意不與實作同源——
// 每一筆偽樣本都由測試自己按「該重應該擋下什麼」手造，期望值寫死，不呼叫實作去產生期望。
// 跑法：node scripts/verify_bounty_gates.mjs
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';
import { readFileSync } from 'node:fs';

// bountyBoard()（K 組用得到）讀 caches.default——Node 沒有全域 caches，比照
// verify_bounty_api.mjs/verify_rate_limit.mjs 既有慣例補一個永遠 miss 的替身。
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const { assembleTrip, integrityGate, qualityGate, verdictOf, coverageOf, bountyVerifyCron } = _bounty;
const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };

// 一條乾淨的軌跡：從 0 公尺出發，25 m/s 等速跑 600 秒＝15 公里，1 Hz，acc 8 公尺。
// 都卜勒速度刻意加一點雜訊——真實 GPS 的 coords.speed 與位置微分本來就有差異，
// 完全一致才是 spoof 的特徵（第四重）。
function cleanTrip(over = {}) {
  const pts = [];
  for (let i = 0; i <= 600; i++) {
    pts.push({ d: i * 25, t: 30000 + i, v: 25 + Math.sin(i / 7) * 0.6, acc: 8 });
  }
  return { actor: 'dev-x', tripDate: '2026-07-28', trainNo: '312', sys: 'tra_sched', lnId: '南迴線', dir: 0,
    sampleIds: ['s1'], pts, ...over };
}
// 🔴 都卜勒測試專用底座：cleanTrip() 的 d=i*25 是完美等速直線，逐步距離(dd)恆為常數 25、
// 方差=0——不管 v 怎麼設，Pearson 相關係数的分母(sb)恆為 0，corr 短路成 0，「都卜勒過度一致」
// 這條測試永遠打不中，不論用什麼 v 都測不出來（實測驗證：distinct dd values=1）。這是測試資料
// 的問題不是 integrityGate 的問題（比照 brief Step 8「不是實作錯，是測試資料造錯，改測試資料」）。
// wobblyPts() 讓位置本身帶正弦波動的逐步距離（真的有方差），spoofedPts() 把 v 設成與 dd/dt
// 逐點相等（spoof 工具的特徵：兩者不只同向、根本同一個數）——這樣相關係数才有東西可算，
// 且實測 corr=1.000。波動幅度沿用原本 v 的 ±0.6，已實測不會誤觸物理閘（maxAbsDvDt=0.086 遠低於
// 3.9 門檻、maxDd=25.6 遠低於 41.63 cap）。只用在 F6／H5 的 spoof，不動 cleanTrip() 本身——
// 其餘所有測試(F1/F4/F5/F7/F8/G1-G7/H1-H4/H6-H11)都依賴 cleanTrip() 現有的直線位置，不能動。
function wobblyPts() {
  const pts = []; let d = 0;
  for (let i = 0; i <= 600; i++) { if (i > 0) d += 25 + Math.sin(i / 7) * 0.6; pts.push({ d, t: 30000 + i, acc: 8 }); }
  return pts;
}
function spoofedPts(basePts) {
  return basePts.map((p, i, a) => ({ ...p, v: i ? (p.d - a[i - 1].d) / (p.t - a[i - 1].t) : 25 }));
}
// 一條線：0–20 公里之間每 2 公里一站，正規區間 10 段
const LINE = { sys: 'tra_sched', lnId: '南迴線', name: '測試線',
  stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) };
const CTX = { line: LINE, events: [], now: Date.parse('2026-07-29T02:00:00Z') };

// ── F 組：防偽閘四重 ──────────────────────────────────────────────────────
ok('F1 乾淨樣本不被防偽閘擋', integrityGate(cleanTrip(), CTX, RULES).pass === true,
  JSON.stringify(integrityGate(cleanTrip(), CTX, RULES)));

ok('F2 第一重 日期在未來 → suspect',
  integrityGate(cleanTrip({ tripDate: '2099-01-01' }), CTX, RULES).code === 'future_date');
ok('F3 第一重 日期太舊 → suspect',
  integrityGate(cleanTrip({ tripDate: '2020-01-01' }), CTX, RULES).code === 'stale_date');

{
  // 第三重 物理可能：里程倒退
  const t = cleanTrip(); t.pts[300] = { ...t.pts[300], d: t.pts[100].d };
  ok('F4 第三重 里程倒退 → suspect', integrityGate(t, CTX, RULES).code === 'impossible_physics');
}
{
  // 第三重：瞬間加速（一秒內從 25 跳到 200 m/s）
  const t = cleanTrip();
  for (let i = 301; i <= 600; i++) t.pts[i] = { ...t.pts[i], d: t.pts[300].d + (i - 300) * 200 };
  ok('F5 第三重 加速度物理不可能 → suspect', integrityGate(t, CTX, RULES).code === 'impossible_physics');
}
{
  // 第四重 都卜勒過度一致：把 v 寫成位置微分本身（spoof 工具的特徵）。底座用 wobblyPts()
  // 不用 cleanTrip().pts——理由見上方大段註解（直線位置的相關係数分母恆 0，測不出來）。
  const t = cleanTrip({ pts: spoofedPts(wobblyPts()) });
  ok('F6 第四重 都卜勒與位置微分過度一致 → suspect',
    integrityGate(t, CTX, RULES).code === 'doppler_too_clean', JSON.stringify(integrityGate(t, CTX, RULES)));
}
{
  // 第二重 對得上當時的獨立誤點回報：我們自己幾小時前存下的到站時刻對不上
  const ctx = { ...CTX, events: [{ sta: 'S5', status: '到站', delay: 0, obs_at: '2026-07-28T00:00:00Z', schedSec: 20000 }] };
  ok('F7 第二重 與獨立誤點紀錄差太多 → suspect',
    integrityGate(cleanTrip(), ctx, RULES).code === 'delay_mismatch', JSON.stringify(integrityGate(cleanTrip(), ctx, RULES)));
  ok('F8 第二重 沒有獨立紀錄時直接跳過這一重（捷運無車次級誤點源，不可因此判失敗）',
    integrityGate(cleanTrip(), { ...CTX, events: [] }, RULES).pass === true);
}

// 🔴 F9/F10 第三重的速度上限「依系統」——2026-07-28 修掉一個 P0 缺陷後補上的守門。
// 缺陷：integrityGate 原本寫 R.speedCapMps[trip.sys]，但 speedCapMps 的鍵是系統家族
// （default/THSR/metro），trip.sys 卻是 SYS_DEFS 的 id（tra_sched/thsr_sched/afr_sched），
// 查表恆常 undefined ⇒ 全部落到 default 36.2m/s＝130km/h ⇒ 高鐵 300km/h 每一趟都被判
// impossible_physics、不給章不給點數，高鐵懸賞整條壞掉，而當時所有測試都是綠的。
// 兩項刻意成對且只差 sys 一個欄位：F9 證明高鐵放得過，F10 證明不是「速度上限根本沒在管」。
{
  const fast = mps => { const pts = []; for (let i = 0; i <= 600; i++)
    pts.push({ d: i * mps, t: 30000 + i, v: mps + Math.sin(i / 7) * 0.6, acc: 8 }); return pts; };
  const P = fast(70);                       // 70m/s＝252km/h：高鐵日常，台鐵物理上不可能
  const thsr = integrityGate(cleanTrip({ sys: 'thsr_sched', pts: P }), CTX, RULES);
  const tra = integrityGate(cleanTrip({ sys: 'tra_sched', pts: P }), CTX, RULES);
  ok('F9 第三重 高鐵 252km/h 不被速度上限擋（查到 THSR 的 83.4m/s）',
    thsr.pass === true, JSON.stringify(thsr));
  ok('F10 第三重 同一條 252km/h 軌跡掛在台鐵上要被擋（落 default 36.2m/s＝130km/h）',
    tra.code === 'impossible_physics', JSON.stringify(tra));
}

// 🔴 F11–F23 第三重（物理可能）的規則——期望值自己照規則算，不讀實作。t 是取整到秒的時刻（App 取 floor），兩點真實間隔只知道 < Δt＋1 秒：
//   往前：任兩點 i 早於 j，往前里程差 ≤ 上限×1.15×(t_j − t_i + 1) ＋ 50 m（第五輪：同一秒的點不能跳過；第六輪：分母用 Δt＋1、比任兩點）。
//   往後：相鄰兩點往後不超過 50 m。加速度：相鄰兩點都有都卜勒速度（v＞0）才比，|Δv| ≤ 1.3×3×(Δt＋1)。
// 台鐵上限 36.2 m/s → 上限×1.15＝41.63 m/s；高鐵 83.4 → 95.91。同一秒（Δt＝0）往前最多 41.63＋50＝91.63 m（高鐵 145.91 m）。
// 舊版（第五輪之前）dt≤0 直接跳過——「整條線每個站間兩點、全部同一個 t」的錄程完全不受物理檢查，判 ok、全線覆蓋（第五輪用 90 點、3.3 KB 做到）；
// 第五輪版只比相鄰兩點、分母用 Δt，漏一次定位回呼的誠實錄程在 79 km/h 以上就被判死，一秒兩點又能以兩倍多的上限前進（第六輪）。
// 成對寫：攻擊（該擋）與誠實錄程（不能誤殺）各有一組，而且每一組兩個方向都有（dir 1＝里程遞減）。
{
  const tra = pts => integrityGate(cleanTrip({ pts }), CTX, RULES);
  // F11：第五輪的形狀——10 個站間各放兩點（站後 100 m、站前 100 m），全部同一個 t。
  const same = [];
  for (let k = 0; k < 10; k++) for (const dd of [100, 1900]) same.push({ d: k * 2000 + dd, t: 30000, v: 20, acc: 5 });
  ok('F11 第三重 整條線的點全部同一個 t（每個站間兩點、相隔約 2 km）→ impossible_physics（舊版跳過同一秒、判通過）',
    tra(same).code === 'impossible_physics', JSON.stringify(tra(same)));
  // F12：同一個 t、每點只差 40 m（兩兩相鄰都小於 91.63 m）——只跟前一個點比會放行，要比任兩點才抓得到（第三點起累積 120 m）。
  const dense = Array.from({ length: 50 }, (_, i) => ({ d: i * 40, t: 30000, v: 20, acc: 5 }));
  ok('F12 第三重 同一個 t、每點只往前 40 m（兩兩相鄰都在一秒的上限內，累積 1,960 m）→ impossible_physics',
    tra(dense).code === 'impossible_physics', JSON.stringify(tra(dense)));
  // F13：誠實的 2 Hz 錄程、台鐵接近上限（35 m/s，0.5 秒 17.5 m），t 取整到秒、d 帶 ±3 m 雜訊 → 同一秒常有兩點。要放行。
  const hz2 = [];
  for (let i = 0; i <= 1200; i++) {
    const tr = 30000.3 + i * 0.5;
    hz2.push({ d: Math.round(tr * 35 - 30000 * 35 + Math.sin(i * 1.7) * 3), t: Math.round(tr), v: 35 + Math.sin(i / 9) * 0.4, acc: 6 });
  }
  const zeroGaps = hz2.filter((p, i) => i && p.t === hz2[i - 1].t).length;
  ok('F13 第三重 誠實的 2 Hz 錄程（台鐵 35 m/s、t 取整到秒、±3 m 雜訊，同一秒兩點）照樣通過——不誤殺',
    zeroGaps > 100 && tra(hz2).pass === true, JSON.stringify({ zeroGaps, r: tra(hz2) }));
  // F14：同一秒往後退的邊界（GPS 抖動容差 50 m，相鄰兩點）：退 60 m 擋、退 30 m 放行。底座是 5 m/s 的慢車（1 Hz），第 300 秒那一秒多兩點：
  // 往後退 m 公尺的一點、再來回到前方 2 m 的一點——下一秒跟「前方 2 m 那點」比只差 3 m，所以最早的版本（跳過同一秒）兩種都放行，
  // 擋下來的只能是同一秒裡的那一對。
  const slow = cleanTrip().pts.map(p => ({ ...p, d: (p.t - 30000) * 5, v: 5 + Math.sin(p.t / 7) * 0.3 }));
  const back = m => { const b = slow.slice(0, 301); const p = b[300]; b.push({ ...p, d: p.d - m }, { ...p, d: p.d + 2 }); return b.concat(slow.slice(301)); };
  ok('F14 第三重 同一秒裡往後退 60 m → impossible_physics；退 30 m（GPS 抖動）→ 通過',
    tra(back(60)).code === 'impossible_physics' && tra(back(30)).pass === true, JSON.stringify([tra(back(60)), tra(back(30))]));
  // F15／F16：高鐵的上限（83.4 m/s → 上限×1.15＝95.91 m/s）。誠實的 2 Hz 80 m/s（0.5 秒 40 m）放行。
  const thsr = pts => integrityGate(cleanTrip({ sys: 'thsr_sched', pts }), CTX, RULES);
  const h2 = [];
  for (let i = 0; i <= 1200; i++) {
    const tr = 30000.3 + i * 0.5;
    h2.push({ d: Math.round((tr - 30000) * 80 + Math.sin(i * 1.3) * 3), t: Math.round(tr), v: 80 + Math.sin(i / 9) * 0.5, acc: 6 });
  }
  ok('F15 第三重 高鐵誠實的 2 Hz 錄程（80 m/s、同一秒兩點相隔約 40 m）照樣通過',
    thsr(h2).pass === true, JSON.stringify(thsr(h2)));
  // F16：同一秒往前的邊界。70 m/s 的高鐵（1 Hz），第 300 秒那一秒多一點、往前跳 X 公尺，之後整段跟著往前挪 X（真的跳過去、不回來，往後那一條量不到）。
  // 同一秒往前最多 95.91＋50＝145.91 m；更早的點跟它比只會更寬（每早一秒多 95.91−70＝25.91 m 的餘裕）。跳 150 m 擋、140 m 放行。
  const jumpBy = X => { const b = cleanTrip().pts.map(p => ({ ...p, d: (p.t - 30000) * 70, v: 70 }));
    return [...b.slice(0, 301), { ...b[300], d: b[300].d + X }, ...b.slice(301).map(p => ({ ...p, d: p.d + X }))]; };
  ok('F16 第三重 高鐵同一秒往前跳 150 m（超過 145.91 m）→ impossible_physics；跳 140 m → 通過',
    thsr(jumpBy(150)).code === 'impossible_physics' && thsr(jumpBy(140)).pass === true, JSON.stringify([thsr(jumpBy(150)), thsr(jumpBy(140))]));

  // ── 以下第六輪：兩個方向、取整到秒的誠實錄程、偽造軌跡的長期速度 ──
  const gate = (pts, sys = 'tra_sched', dir = 0) => integrityGate(cleanTrip({ sys, dir, pts }), CTX, RULES);
  const flip = (pts, L) => pts.map(p => ({ ...p, d: Math.round((L - p.d) * 10) / 10 }));   // 同一條軌跡倒過來走（dir 1＝里程遞減），t 與 v 不變
  // F17：F13、F15 倒過來走，再加一條高鐵 1 Hz 80 m/s（每步 80 m，大於往後的容差 50 m——方向沒套進「往後」那一條的話，第一步就被當成倒退）。
  const h1 = Array.from({ length: 601 }, (_, i) => ({ d: i * 80 + Math.round(Math.sin(i * 1.3) * 3), t: 30000 + i, v: 80 + Math.sin(i / 9) * 0.5, acc: 6 }));
  const r17 = [gate(flip(hz2, 50000), 'tra_sched', 1), gate(flip(h2, 100000), 'thsr_sched', 1), gate(flip(h1, 60000), 'thsr_sched', 1)];
  ok('F17 第三重 里程遞減（dir 1）的誠實錄程照樣通過：台鐵 2 Hz 35 m/s、高鐵 2 Hz 80 m/s、高鐵 1 Hz 80 m/s',
    r17.every(r => r.pass === true), JSON.stringify(r17));
  // F18：F14、F16、F10 倒過來走——往後（里程變大）退 60 m 擋、30 m 放行；同一秒往前（里程變小）跳 150 m 擋、140 m 放行；台鐵掛 252 km/h 擋。
  const slow1 = flip(slow, 20000);
  const back1 = m => { const b = slow1.slice(0, 301); const p = b[300]; b.push({ ...p, d: p.d + m }, { ...p, d: p.d - 2 }); return b.concat(slow1.slice(301)); };
  const fast70 = Array.from({ length: 601 }, (_, i) => ({ d: i * 70, t: 30000 + i, v: 70 + Math.sin(i / 7) * 0.6, acc: 8 }));
  const r18 = [gate(back1(60), 'tra_sched', 1), gate(back1(30), 'tra_sched', 1), gate(flip(jumpBy(150), 60000), 'thsr_sched', 1),
    gate(flip(jumpBy(140), 60000), 'thsr_sched', 1), gate(flip(fast70, 60000), 'tra_sched', 1)];
  ok('F18 第三重 里程遞減（dir 1）的邊界：同一秒往後退 60 m 擋、30 m 放行；同一秒往前跳 150 m 擋、140 m 放行；台鐵掛 252 km/h 擋',
    r18[0].code === 'impossible_physics' && r18[1].pass === true && r18[2].code === 'impossible_physics' && r18[3].pass === true &&
      r18[4].code === 'impossible_physics', JSON.stringify(r18));
  // App 的錄程：定位回呼約每秒一次（相位 phase 秒），900 ms 節流（離上一個收下的點不到 0.9 秒就丟），t 取 floor 到秒（index.html 的 nowSecOfDay）。
  // late：這幾次回呼晚到 120 ms——下一次回呼只隔 0.88 秒、被節流丟掉，於是相鄰兩點 Δt＝1、真實間隔 1.88 秒（「漏一次回呼」）。
  const app = ({ mps, secs = 600, late = [300], phase = 0.95 }) => {
    const pts = []; let last = -Infinity;
    for (let k = 0; k <= secs; k++) {
      const T = k + phase + (late.includes(k) ? 0.12 : 0);
      if (T - last < 0.9) continue;
      last = T;
      pts.push({ d: Math.round(T * mps * 10) / 10, t: 30000 + Math.floor(T), v: Math.round((mps + Math.sin(k / 7) * 0.6) * 100) / 100, acc: 8 });
    }
    return pts;
  };
  const maxStep1 = pts => Math.max(...pts.slice(1).map((p, i) => p.t - pts[i].t === 1 ? Math.abs(p.d - pts[i].d) : 0));
  // F19：漏一次回呼（第六輪獨立驗收的重現）。台鐵 100 km/h（27.78 m/s）那一步 52.2 m（> 41.63，第五輪版判死）；高鐵 300 km/h 那一步 156.7 m（> 95.91）。
  const a100 = app({ mps: 27.78 }), a300 = app({ mps: 83.33 });
  const r19 = [gate(a100), gate(flip(a100, 30000), 'tra_sched', 1), gate(a300, 'thsr_sched'), gate(flip(a300, 60000), 'thsr_sched', 1)];
  ok('F19 第三重 漏一次定位回呼（Δt＝1、真實 1.88 秒）的誠實錄程通過：台鐵 100 km/h（那一步 52.2 m）、高鐵 300 km/h（156.7 m），兩個方向',
    maxStep1(a100) > 52 && maxStep1(a300) > 156 && r19.every(r => r.pass === true), JSON.stringify({ step: [maxStep1(a100), maxStep1(a300)], r19 }));
  // F20：站停起步（第六輪獨立驗收的重現）：停站點回報速度 0、最後一點 GPS 飄 +4 m，起步那一點 −6 m（回到停車點後方 2 m）、都卜勒 0.3——
  // 第五輪版把 0 當成「沒有速度」換成位置微分（−6 m/s），一秒內「加速」6.3 m/s 就判死。另一條：每三點一點沒有都卜勒速度（上傳端存成 0）、
  // 時速 108 km/h、漏一次回呼。加速度只在兩點都有速度時才比，兩條都要通過（兩個方向）。回報速度帶 ±1.2 的正弦（避開都卜勒太乾淨那一重）。
  const stopGo = () => {
    const pts = []; let d = 0, t = 30000, n = 0;
    const push = (dd, v) => { d += dd; n += 1; pts.push({ d: Math.round(d * 10) / 10, t: t++, v, acc: 8 }); };
    const mv = dd => Math.round(Math.max(0, dd + Math.sin(n / 3) * 1.2) * 100) / 100;
    for (let i = 0; i < 100; i++) push(i ? 20 : 0, mv(20));
    for (let j = 1; j <= 20; j++) push(20 - j, mv(20 - j));
    for (let j = 0; j < 30; j++) push(j === 29 ? 4 : 0, 0);
    push(-6, 0.3);
    for (let j = 1; j <= 20; j++) push(j, mv(j));
    for (let i = 0; i < 100; i++) push(20, mv(20));
    return pts;
  };
  const sg = stopGo(), gappy = app({ mps: 30 }).map((p, i) => i % 3 === 1 ? { ...p, v: 0 } : p);
  const kick = sg.findIndex((p, i) => i && p.v === 0.3 && sg[i - 1].v === 0 && p.d - sg[i - 1].d === -6);
  const r20 = [gate(sg), gate(flip(sg, 20000), 'tra_sched', 1), gate(gappy), gate(flip(gappy, 30000), 'tra_sched', 1)];
  ok('F20 第三重 站停起步（速度 0 的點 GPS 飄 +4／−6 m）與「每三點一點沒有都卜勒速度、漏一次回呼」的誠實錄程通過（兩個方向）',
    kick > 0 && r20.every(r => r.pass === true), JSON.stringify({ kick, r20 }));
  // F21：1 Hz、台鐵 130 km/h（36.1 m/s，上限的 99.8%）、GPS 雜訊（慢變的偏移 σ5 m、時間常數 5 秒＋白雜訊 σ1.5 m）、回呼抖動 ±150 ms、
  // 每 100 秒一次回呼晚 400 ms（固定亂數種子）——第五輪版逐對以 Δt 當分母，雜訊一大就超過 41.63 m/s（第六輪模擬 300 趟全紅）。兩個方向都要通過。
  const rng = (s => () => { s = s + 0x6D2B79F5 | 0; let x = Math.imul(s ^ s >>> 15, 1 | s); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; })(20260930);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const noisy = (() => {
    const pts = []; let last = -Infinity, e = 0; const rho = Math.exp(-1 / 5);
    for (let k = 0; k <= 540; k++) {
      e = rho * e + Math.sqrt(1 - rho * rho) * 5 * gauss();
      const T = k + 0.5 + (rng() * 2 - 1) * 0.15 + (k % 100 === 50 ? 0.4 : 0);
      if (T - last < 0.9) continue;
      last = T;
      pts.push({ d: Math.round((T * 36.1 + e + gauss() * 1.5) * 10) / 10, t: 30000 + Math.floor(T), v: Math.round((36.1 + gauss() * 0.3) * 100) / 100, acc: 8 });
    }
    return pts;
  })();
  const over1 = noisy.filter((p, i) => i && p.t - noisy[i - 1].t === 1 && p.d - noisy[i - 1].d > 41.63).length;
  const r21 = [gate(noisy), gate(flip(noisy, 30000), 'tra_sched', 1)];
  ok('F21 第三重 1 Hz、台鐵 130 km/h、GPS 雜訊與回呼抖動的誠實錄程通過（兩個方向；其中 Δt＝1 而位移超過 41.63 m 的相鄰兩點要有，場景才有牙）',
    over1 > 0 && r21.every(r => r.pass === true), JSON.stringify({ over1, n: noisy.length, r21 }));
  // F22：偽造軌跡的長期速度釘在上限×1.15 以內（第六輪）。(a) 一秒兩點、每秒前進 82.26 m（第五輪版的上界 2×41.63−1：逐對都貼著上限）→ 擋；
  // (b) 1 Hz 等速 43.44 m/s（上限的 1.2 倍：每一對都在 Δt＋1 的上界內，要比任兩點才抓得到）→ 擋；(c) 對照：1 Hz 等速 41 m/s → 通過。兩個方向。
  const two = Array.from({ length: 1200 }, (_, i) => ({ d: Math.round((Math.floor(i / 2) * 82.26 + (i % 2) * 41.13) * 10) / 10, t: 30000 + Math.floor(i / 2), v: 30, acc: 5 }));
  const steady = mps => Array.from({ length: 601 }, (_, i) => ({ d: Math.round(i * mps * 10) / 10, t: 30000 + i, v: mps + Math.sin(i / 7) * 0.6, acc: 8 }));
  const r22 = [gate(two), gate(flip(two, 60000), 'tra_sched', 1), gate(steady(43.44)), gate(flip(steady(43.44), 30000), 'tra_sched', 1),
    gate(steady(41)), gate(flip(steady(41), 30000), 'tra_sched', 1)];
  ok('F22 第三重 偽造軌跡的長期速度釘在上限×1.15 以內：一秒兩點每秒 82 m 擋、1 Hz 等速 1.2 倍上限擋；1 Hz 等速 41 m/s 通過（兩個方向）',
    r22.slice(0, 4).every(r => r.code === 'impossible_physics') && r22.slice(4).every(r => r.pass === true), JSON.stringify(r22));
  // F23：加速度（都卜勒速度）的邊界：相鄰兩點都有速度時 |Δv| ≤ 1.3×3×(Δt＋1)，Δt＝1 時 7.8 m/s。等速 25 m/s，第 300 秒起回報速度多 Δ（位置照舊）：
  // Δ＝8.2 擋（兩個方向）、7.4 放行；只有第 300 秒那一點速度是 0（沒有速度）→ 那兩對不比、放行。
  const vstep = (dv, only = false) => Array.from({ length: 601 }, (_, i) => ({ d: i * 25, t: 30000 + i, v: i < 300 || (only && i > 300) ? 25 : 25 + dv, acc: 8 }));
  const r23 = [gate(vstep(8.2)), gate(flip(vstep(8.2), 20000), 'tra_sched', 1), gate(vstep(7.4)), gate(vstep(-25, true))];
  ok('F23 第三重 加速度的邊界：相鄰兩點都有速度時 |Δv| ≤ 1.3×3×(Δt＋1)——多 8.2 m/s 擋（兩個方向）、多 7.4 放行；那一點沒有速度（0）→ 不比、放行',
    r23[0].code === 'impossible_physics' && r23[1].code === 'impossible_physics' && r23[2].pass === true && r23[3].pass === true, JSON.stringify(r23));
}

// ── G 組：品質閘七項 ──────────────────────────────────────────────────────
ok('G1 乾淨樣本通過品質閘', qualityGate(cleanTrip(), CTX, RULES).pass === true,
  JSON.stringify(qualityGate(cleanTrip(), CTX, RULES)));
ok('G2 精確位置被關（acc 中位數 > 200 且平坦）→ precise_off',
  qualityGate(cleanTrip({ pts: cleanTrip().pts.map(p => ({ ...p, acc: 400 })) }), CTX, RULES).code === 'precise_off');
ok('G3 訊號被遮蔽（acc 中位數 > 80）→ acc_blocked',
  qualityGate(cleanTrip({ pts: cleanTrip().pts.map((p, i) => ({ ...p, acc: 100 + (i % 40) })) }), CTX, RULES).code === 'acc_blocked');
ok('G4 取樣太稀（間隔中位數 > 5 秒）→ too_sparse',
  qualityGate(cleanTrip({ pts: cleanTrip().pts.filter((_, i) => i % 9 === 0) }), CTX, RULES).code === 'too_sparse');
// 🔴 slice(0,100)（100 點＝2.475 公里）其實會把第一段 S0-S1（0-2 公里）完整蓋滿(cov=1)，
// 不會落在「< 60%」——實測證實(coverageOf 對 d∈[0,2.475]km 算出 S0-S1 cov=1.0)。這是測試資料
// 造錯（比照 brief Step 8），改用 slice(0,30)（0.725 公里，實測 S0-S1 cov=0.3625<0.6）才是
// 真的「錄得太短」。
ok('G5 錄得太短（覆蓋率 < 60%）→ too_short',
  qualityGate(cleanTrip({ pts: cleanTrip().pts.slice(0, 30) }), CTX, RULES).code === 'too_short',
  JSON.stringify(qualityGate(cleanTrip({ pts: cleanTrip().pts.slice(0, 30) }), CTX, RULES)));
{
  const t = cleanTrip(); t.pts = t.pts.filter(p => p.t < 30150 || p.t > 30350);   // 中間 200 秒沒定位
  ok('G6 連續無定位超過門檻 → underground', qualityGate(t, CTX, RULES).code === 'underground',
    JSON.stringify(qualityGate(t, CTX, RULES)));
}
ok('G7 歸屬不到唯一班次 → unknown_train（不是 suspect！）',
  qualityGate(cleanTrip({ trainNo: '' }), CTX, RULES).code === 'unknown_train');

// ── H 組：三態與計帳 ─────────────────────────────────────────────────────
ok('H1 兩閘都過 → ok', verdictOf({ pass: true }, { pass: true }).verdict === 'ok');
{
  const v = verdictOf({ pass: true }, { pass: false, code: 'acc_blocked' });
  ok('H2 防偽過品質不過 → unusable，帶 quality_code 不帶 reject_code',
    v.verdict === 'unusable' && v.qualityCode === 'acc_blocked' && v.rejectCode === null, JSON.stringify(v));
}
{
  const v = verdictOf({ pass: false, code: 'doppler_too_clean' }, { pass: true });
  ok('H3 防偽不過 → suspect，帶 reject_code 不帶 quality_code',
    v.verdict === 'suspect' && v.rejectCode === 'doppler_too_clean' && v.qualityCode === null, JSON.stringify(v));
}
ok('H4 防偽不過時不看品質閘的結論（順序固定：先防偽後品質）',
  verdictOf({ pass: false, code: 'x' }, { pass: false, code: 'y' }).verdict === 'suspect');
{
  // 🔴 H4b 鎖不變式（task-6 controller 指令要求）：verdictOf 是「防偽不過就短路，不把品質閘的
  // code 混進來」這個設計（worker.js verdictOf：ig 不過時直接 return，完全不讀 qg.code）。
  // H4 只斷言了 verdict==='suspect'，沒斷言 qualityCode/rejectCode 兩個欄位——覆蓋缺口在於：
  // 如果哪天有人把 verdictOf 改成「兩閘都跑完才判定」（即使 ig 不過，還是把 qg.code 塞進
  // qualityCode），H4 這樣的斷言法還是會過，因為它沒看 qualityCode。這裡用「ig 與 qg 都真的
  // 帶著失敗碼」的輸入，直接斷言 qualityCode 恆為 null、rejectCode 恆等於 ig.code，把這個不變式
  // 焊死；schema（0002_bounty.sql bounty_samples.quality_code 註解）明文兩欄「永遠不可以合成
  // 一個」，這正是那條規則在 verdictOf 這一層的斷言化。
  const v = verdictOf({ pass: false, code: 'x' }, { pass: false, code: 'y' });
  ok('H4b 兩閘都失敗時仍只帶 reject_code，quality_code 恆為 null（鎖住「不合成」不變式）',
    v.qualityCode === null && v.rejectCode === 'x', JSON.stringify(v));
}

// H5–H10：整支 cron 跑一遍，斷言三態的四件事各自正確
{
  const M = { generatedAt: 1, schedDate: '2026-07-28', lines: { 'tra_sched|南迴線': LINE }, units: [] };
  // 🔴 2026-09-29（路段懸賞 v2）：收滿改看「去重人數」，真設定是台鐵 50 人，而這一組只有一位 ok 的 actor。
  // H10b 要驗的是「下架門檻的查表有過系統家族桶對照」，情境是「一位 ok 就收滿」——所以把 coverDistinct 調成
  // 1 人來維持這個情境，只改門檻的數字、斷言本身一個字沒動。真設定（50）下的收滿在 verify_bounty_ledger.mjs。
  const STUB_RULES = JSON.stringify({ ...RULES, coverDistinct: { TRA: 1, THSR: 1 } });
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(M) : STUB_RULES, { status: 200 }) };
  const board = LINE.stations.slice(1).map((s, i) =>
    `('tra_sched|南迴線|${LINE.stations[i].name}|${s.name}','tra_sched','自強',0,'track','',1,1,2,10,1,1,0,NULL)`).join(',');
  // 上傳時間要合理（乘車日 07-28 的隔天凌晨）：防偽閘的日期窗以上傳時間為基準（integrityGate 的 uploadedAt），
  // 原本寫 1（1970 年）會被判 future_date——那個值在舊行為下沒人讀，在新行為下等於「上傳早於乘車日 50 多年」。
  const mk = (id, actor, pts) => `('${id}','${actor}','tra_sched','南迴線','312',0,'2026-07-28','${JSON.stringify(pts)}',NULL,${Date.parse('2026-07-29T01:00:00Z')},'pending')`;
  const clean = cleanTrip().pts;
  const blocked = clean.map(p => ({ ...p, acc: 120 }));
  // 同 F6：spoof 底座須用 wobblyPts()，clean.map(...) 會因直線位置零方差而測不出 doppler_too_clean。
  const spoof = spoofedPts(wobblyPts());
  const { db, DELAY_DB } = openTestDb(
    `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at) VALUES ${board};
     INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict) VALUES
       ${mk('s-ok', 'dev-ok', clean)}, ${mk('s-un', 'dev-un', blocked)}, ${mk('s-sp', 'dev-sp', spoof)};`);

  // 🔴 模組級快取防呆（task-6 controller 指令要求，見報告「模組級快取」節）：bountyRulesMem／
  // bountyUnitsMem 是 worker.js 模組層級變數，同一個 process 內第一次呼叫 bountyRules(env)／
  // bountyUnits(env) 之後就不會再讀 env.ASSETS。本檔到這裡為止（F/G/H1-H4）從未呼叫過
  // bountyVerifyCron，理論上快取還是空的，這裡仍先顯式歸零——不是因為現在會紅，是因為往下任何人
  // 若在本檔插入另一個用不同 ASSETS 內容的情境（例如換一條線、換 rules）卻忘記歸零，會靜默讀到
  // 這裡快取住的舊值而不是新情境的值，且不會拋錯、只會拿錯資料，非常難查。固定在每個獨立情境
  // 起手處歸零，把「必須手動記得」的紀律換成「看得到就知道要做」的樣板。
  _bounty.bountyResetMemCaches();
  const r = await bountyVerifyCron({ DELAY_DB, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-29T02:00:00Z')) });
  const row = id => db.prepare('SELECT * FROM bounty_samples WHERE id=?').get(id);
  const pts = a => (db.prepare('SELECT points FROM bounty_points WHERE actor=?').get(a) || { points: 0 }).points;
  const covered = db.prepare('SELECT COUNT(*) c FROM bounty_board WHERE covered_at IS NOT NULL').get().c;
  const sampled = db.prepare('SELECT SUM(sample_count) s FROM bounty_board').get().s;

  ok('H5 三筆各自判成 ok／unusable／suspect',
    row('s-ok').verdict === 'ok' && row('s-un').verdict === 'unusable' && row('s-sp').verdict === 'suspect',
    JSON.stringify({ ok: row('s-ok').verdict, un: row('s-un').verdict, sp: row('s-sp').verdict, r }));
  ok('H6 unusable 照給點數（與 ok 同樣有入帳）', pts('dev-un') > 0, String(pts('dev-un')));
  ok('H7 suspect 一點都不給', pts('dev-sp') === 0, String(pts('dev-sp')));
  ok('H8 unusable 不計入 sample_count（付出與資料是兩本帳）',
    sampled === db.prepare("SELECT SUM(sample_count) s FROM bounty_board").get().s && sampled > 0 && sampled <= 10,
    `sample_count 合計=${sampled}`);
  {
    // 🔴 H8b（task-6 controller 指令要求驗收條件 4）：H8 只驗總和的上下界，同段 ok+unusable
    // 只加 1 這件事是「總和沒超過 10」間接推出來的，不是直接量。s-ok 與 s-un 的 payload 除了
    // acc 以外完全相同（見上面 blocked = clean.map(...acc:120)），兩者理論上覆蓋同一批區間；
    // 直接點名第一段（S0-S1，兩趟都保證有效覆蓋，見 coverageOf 對 d∈[0,2km] 的計算）查
    // sample_count，斷言恰好是 1（不是 0，也不是 2）。
    const segCount = (db.prepare(
      "SELECT sample_count FROM bounty_board WHERE seg_key=? AND kind='track' AND dir=0"
    ).get('tra_sched|南迴線|S0|S1') || {}).sample_count;
    ok('H8b 同一段被 ok 與 unusable 各覆蓋一次時，sample_count 只加 1（不是 2）',
      segCount === 1, `S0-S1 sample_count=${segCount}`);
  }
  ok('H9 unusable 帶 quality_code、suspect 帶 reject_code，兩者不互串',
    row('s-un').quality_code && !row('s-un').reject_code && row('s-sp').reject_code && !row('s-sp').quality_code,
    JSON.stringify({ un: row('s-un').quality_code, sp: row('s-sp').reject_code }));
  ok('H10 ok 那筆寫下 segs（護照要數「校正了幾段」不是「幾趟」）',
    row('s-ok').segs && JSON.parse(row('s-ok').segs).length > 0, String(row('s-ok').segs).slice(0, 60));

  // 🔴 H10b 下架門檻 need 要取 coverN.TRA=1，不是恆常落到 coverN.metro=3——與 F9/F10 同一個
  // 查表缺陷（2026-07-28 修）。缺陷在時 need=3，一筆 ok 收不滿任何段、covered 恆為 0，
  // 而 groupBoardRows 給前端看的卻是 coverN.TRA=1 ⇒ 使用者跑完一趟看到「1/1 收滿」、段卻永不下架。
  // 斷言寫成「ok 覆蓋幾段就收滿幾段」而不是寫死 7，門檻改了也不會誤報；covered>0 擋掉退化通過。
  {
    const okSegs = JSON.parse(row('s-ok').segs || '[]').length;
    ok('H10b 下架門檻取台鐵的 coverN=1：ok 覆蓋幾段就收滿幾段（不是恆常落到 metro 的 3）',
      covered === okSegs && covered > 0, `已收滿 ${covered} 段、ok 覆蓋 ${okSegs} 段`);
  }

  // H11 連灌 unusable 不會讓路段提早下架（規格 §11 指名要驗的）
  // 🔴 斷言刻意寫成「灌之前 vs 灌之後」而不是寫死 ===10：原本寫死 10 是踩在 bountyVerifyCron
  // 的 coverN 查表缺陷上——那時 need 恆常 fallback 到 coverN.metro(3)，所以連被 ok 收過的段
  // 也收不滿、10 段才會全開。缺陷修掉後 need=coverN.TRA=1，被 ok 收過的段本來就該下架，
  // 寫死 10 反而會紅。改成前後比對之後，這項測的是「unusable 沒有改變任何段的狀態」這個
  // 性質本身，與門檻值脫鉤——將來門檻怎麼調都不會讓這項失去意義或誤報。
  const openBefore = db.prepare("SELECT COUNT(*) c FROM bounty_board WHERE covered_at IS NULL").get().c;
  for (let i = 0; i < 5; i++) {
    db.exec(`INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict)
             VALUES ${mk('s-un' + i, 'dev-un', blocked)}`);
  }
  await bountyVerifyCron({ DELAY_DB, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-29T02:00:00Z')) });
  const stillOpen = db.prepare("SELECT COUNT(*) c FROM bounty_board WHERE covered_at IS NULL").get().c;
  ok('H11 連灌 6 筆 unusable 前後，在架上的段數完全不變（unusable 不讓路段下架）',
    stillOpen === openBefore && openBefore > 0,      // openBefore>0 擋掉「全下架了所以 0===0」的退化通過
    `灌之前 ${openBefore} 段在架、灌之後 ${stillOpen} 段（先前已被 ok 收滿 ${covered} 段）`);
}

// ── K 組：模組級快取重置自檢（task-6 controller 指令驗收條件 6：「處理掉，並說明你怎麼處理的」）
// 上面 H 組全程只用同一份 rules/units 內容,不會自然踩到快取污染,「先呼叫 bountyResetMemCaches()
// 才進第一個情境」純屬防禦性動作,不是被逼出來的紅測試。這裡直接證明重置機制本身有效：用
// bountyBoard()(已導出,內部呼叫 bountyRules(env))餵兩份 coverN 明顯不同的 rules 內容——
// 不重置時第二個環境讀到第一個環境快取住的舊值(K2,證明快取真的存在、真的會咬人)，
// 呼叫 bountyResetMemCaches() 後才讀到新值(K3,證明重置機制真的有效，不是擺著好看)。
{
  const { bountyBoard } = _bounty;
  const rulesA = RULES;
  const rulesB = { ...RULES, coverN: { ...RULES.coverN, TRA: 777 } };   // 刻意做出容易分辨的差異值
  const mkEnv = rules => ({ DELAY_DB: openTestDb().DELAY_DB,
    ASSETS: { fetch: async () => new Response(JSON.stringify(rules), { status: 200 }) } });
  const bodyOf = async res => JSON.parse(await res.text());

  const b1 = await bodyOf(await bountyBoard(new Request('http://x/api/bounty-board?probe=A'), mkEnv(rulesA)));
  ok('K1 第一個環境（rulesA）讀到 coverN.TRA=1', b1.coverN.TRA === 1, JSON.stringify(b1.coverN));

  // 不重置，直接換一個帶 rulesB 內容的全新 env 再呼叫：若快取有效會讀到 rulesA 的舊值
  const b2 = await bodyOf(await bountyBoard(new Request('http://x/api/bounty-board?probe=B'), mkEnv(rulesB)));
  ok('K2 不重置時，換了內容不同的新 env，bountyRules() 仍回傳第一個情境快取住的舊值（證明快取確實存在）',
    b2.coverN.TRA === 1, JSON.stringify(b2.coverN));

  _bounty.bountyResetMemCaches();
  const b3 = await bodyOf(await bountyBoard(new Request('http://x/api/bounty-board?probe=C'), mkEnv(rulesB)));
  ok('K3 呼叫 bountyResetMemCaches() 後，同一份 rulesB 環境才讀到新值（證明重置機制真的有效）',
    b3.coverN.TRA === 777, JSON.stringify(b3.coverN));
}

// ── L 組：驗證 cron 的單次處理上限（2026-07-29 稽核：SELECT * 沒有 LIMIT；review-B R2 改成「一次只讀一班車」）────────────
// 寫入端點是免登入的，所以「有多少 pending」是外部可控的數字。review-B 之前的上限是一句 SELECT * 讀 4,001 列（連 payload）：
// 上限有了、切在班車邊界也做了，但一句讀進來的 payload 最多近 100 MB（每批 600 點），一個 Workers isolate 只有 128 MB。
// 現在判定分兩段：第一段只列班車清單（不讀 payload），第二段一班一班讀。判準因此改成：
//   L1 任何一句查詢帶回來的 payload 最多屬於一班車（記憶體上限是「一班」而不是「整發」）；
//   L3 沒有任何一班車被切成一半；L4 這個量（1000 班）一發判完；
//   L2 班車清單的上限（4000 班）：超過的整班留到下一發、stat.truncated 誠實回報，下一發補完。
{
  const M = { generatedAt: 1, schedDate: '2026-07-28', lines: { 'tra_sched|南迴線': LINE }, units: [] };
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(M) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  // 探針：包住 DELAY_DB，記下每一句查詢帶回的列裡「有 payload 欄、而且不是空陣列」的那些列屬於幾班車（actor＋乘車日＋車次）、共幾列。
  // 刻意不看 SQL 文字：不管 payload 從哪一句來，只要一句帶回兩班車的 payload，就是「一次讀多班」。
  const probe = DB => {
    const t = { maxTrains: 0, maxRows: 0, sawPayload: 0 };
    const look = rows => {
      const withP = (rows || []).filter(r => r && typeof r.payload === 'string' && r.payload.length > 2);
      if (!withP.length) return;
      t.sawPayload += withP.length;
      t.maxRows = Math.max(t.maxRows, withP.length);
      t.maxTrains = Math.max(t.maxTrains, new Set(withP.map(r => `${r.actor}|${r.trip_date}|${r.train_no}`)).size);
    };
    const wrapS = st => new Proxy(st, { get(o, k) {
      if (k === 'bind') return (...a) => wrapS(o.bind(...a));
      if (k === 'all') return async (...a) => { const r = await o.all(...a); look(r && r.results); return r; };
      if (k === 'first') return async (...a) => { const r = await o.first(...a); look(r ? [r] : []); return r; };
      const v = o[k]; return typeof v === 'function' ? v.bind(o) : v;
    } });
    return { t, db: new Proxy(DB, { get(o, k) {
      if (k === 'prepare') return sql => wrapS(o.prepare(sql));
      const v = o[k]; return typeof v === 'function' ? v.bind(o) : v;
    } }) };
  };
  // 資料 A：1000 班、每班 4 批（最後一班 5 批）＝4001 列，每批都是完整的 601 點（review-B R2 的量級：舊版一句全讀進來）。
  const pts = JSON.stringify(cleanTrip().pts);
  const vals = [];
  for (let t = 0; t < 1000; t++) {
    const n = t === 999 ? 5 : 4;
    for (let i = 0; i < n; i++) {
      vals.push(`('s${t}-${i}','dev-${String(t).padStart(4, '0')}','tra_sched','南迴線','312',0,'2026-07-28','${pts}',NULL,${Date.parse('2026-07-29T01:00:00Z') + i},'pending')`);
    }
  }
  const { db, DELAY_DB } = openTestDb(
    `INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict) VALUES ${vals.join(',')};`);
  _bounty.bountyResetMemCaches();
  // 預算調到用不完：1000 班 ok 趟在預設子請求預算（8000）下一發做不完，會早於「全部判完」就停手；這一組驗的是讀取的形狀與截斷，
  // 停手的原因要只剩這兩件事（預算停手另有 verify_bounty_cron2.mjs 的 M 組專驗）。
  const P = probe(DELAY_DB);
  const stat = await bountyVerifyCron({ DELAY_DB: P.db, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-29T02:00:00Z')), BOUNTY_SUBREQ_BUDGET: '1000000' });
  const total = db.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c;
  const done = db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict<>'pending'").get().c;
  // 逐班檢查「全判完」或「全還沒判」，不存在中間狀態
  const split = db.prepare(
    "SELECT actor, SUM(CASE WHEN verdict='pending' THEN 1 ELSE 0 END) p, COUNT(*) n" +
    ' FROM bounty_samples GROUP BY actor, trip_date, train_no HAVING p > 0 AND p < n').all();
  // 探針本身要看得到 payload（不然「最多一班」是空對空）：4001 列全部被讀過一次
  ok('L1 任何一句查詢帶回來的 payload 最多屬於一班車、最多 5 列（記憶體上限是一班，不是整發；舊版一句帶回 1000 班 4001 列）',
    P.t.sawPayload === total && P.t.maxTrains === 1 && P.t.maxRows <= 5, JSON.stringify(P.t));
  ok('L3 沒有任何一班車被切成一半（一班車的批次在第二段一次讀齊）',
    split.length === 0, split.length ? JSON.stringify(split.slice(0, 3)) : '零趟處於半判定狀態');
  ok('L4 1000 班（4001 列）一發判完：trains 1000、全部已判定、沒有截斷（上限是 4000 班，不是 4000 列）',
    stat.trains === 1000 && done === total && total === 4001 && stat.truncated === false, JSON.stringify({ trains: stat.trains, done, total, truncated: stat.truncated }));
  // 資料 B：4001 班、每班一批極小的 payload（兩點）：超過班車清單上限（4000 班）一班
  const tiny = JSON.stringify(cleanTrip().pts.slice(0, 2));
  const valsB = [];
  for (let t = 0; t < 4001; t++) valsB.push(`('b${t}','dev-b${String(t).padStart(4, '0')}','tra_sched','南迴線','312',0,'2026-07-28','${tiny}',NULL,${Date.parse('2026-07-29T01:00:00Z')},'pending')`);
  const B = openTestDb(`INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict) VALUES ${valsB.join(',')};`);
  _bounty.bountyResetMemCaches();
  const sB = await bountyVerifyCron({ DELAY_DB: B.DELAY_DB, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-29T02:00:00Z')), BOUNTY_SUBREQ_BUDGET: '1000000' });
  const leftB = B.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c;
  ok('L2 4001 班超過班車清單上限（4000）：stat 誠實回報截斷（沒有這面旗，運維只會看到「今天判得比較少」）、判了 4000 班、剩 1 班 pending',
    sB.truncated === true && sB.trains === 4000 && leftB === 1, JSON.stringify({ truncated: sB.truncated, trains: sB.trains, leftB }));
  // 反向對照：剩下的下一發跑得完，不是永久卡住
  _bounty.bountyResetMemCaches();
  const sB2 = await bountyVerifyCron({ DELAY_DB: B.DELAY_DB, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-30T02:00:00Z')) });
  const leftB2 = B.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c;
  ok('L2b 沒判到的那一班下一發補完（截斷是延後，不是遺失）：trains 1、不再截斷、pending 0',
    leftB2 === 0 && sB2.truncated === false && sB2.trains === 1, JSON.stringify({ leftB2, truncated2: sB2.truncated, trains2: sB2.trains }));
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
