// 懸賞判定驗收：防偽四重、品質七項、三態。判準刻意不與實作同源——
// 每一筆偽樣本都由測試自己按「該重應該擋下什麼」手造，期望值寫死，不呼叫實作去產生期望。
// 跑法：node scripts/verify_bounty_gates.mjs
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';
import { readFileSync } from 'node:fs';

// bountyBoard()（K 組用得到）讀 caches.default——Node 沒有全域 caches，比照
// verify_bounty_api.mjs/verify_rate_limit.mjs 既有慣例補一個永遠 miss 的替身。
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const { assembleTrip, integrityGate: integrityGate0, qualityGate, verdictOf, coverageOf, bountyVerifyCron } = _bounty;
// 第十一批起 integrityGate 回傳收下的點（pts，動輒上千點）。舊判準的訊息把整個結果 JSON.stringify，
// 輸出到管道時 process.exit 會把還沒寫完的 stdout 截掉（突變測試讀到半份 log、FAIL 行不見）。
// 設成不可列舉：訊息只印 pass／code／detail，判準照樣用 r.pts 讀。
const integrityGate = (...a) => {
  const r = integrityGate0(...a);
  if (r && r.pts) Object.defineProperty(r, 'pts', { value: r.pts, enumerable: false });
  return r;
};
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
  // 第三重 物理可能：里程倒退而且之後一直留在後面（第 300 點起整段退回 5 km）→ 之後每一點都比最後收下的第 299 點退超過 50 m，連丟到第 6 點 → suspect。
  // 第十一批起只有一點倒退（舊的形狀：第 300 點換成第 100 點的里程）只丟那一點、整班通過（孤立壞點見 F24）。
  const t = cleanTrip(); t.pts = t.pts.map((p, i) => i >= 300 ? { ...p, d: p.d - 5000 } : p);
  const single = cleanTrip(); single.pts[300] = { ...single.pts[300], d: single.pts[100].d };
  const r4 = [integrityGate(t, CTX, RULES), integrityGate(single, CTX, RULES)];
  ok('F4 第三重 里程倒退而且留在後面 → suspect；只有一點倒退（舊的形狀）→ 丟那一點、整班通過',
    r4[0].code === 'impossible_physics' && r4[1].pass === true && !r4[1].pts.some(p => p.t === 30300), JSON.stringify(r4.map(r => r.code || r.pass)));
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
// 🔴 第十一批（V7 B(1)）：違反上面任一條的點「丟掉、不判整班」——逐點比的是「已收下的點」（往前比所有收下的點，往後與加速度比最後收下的那一點），
//   被丟的點不當基準；連續丟超過 5 點（第 6 點）、或全程丟的點超過 max(5, 1%×考慮過的點數) 才判 impossible_physics。
//   開頭的 2 點、以及每個 Δt≥10 秒的斷點（隧道）之後的 2 點直接不收，也不算違反、不算「考慮過」。回傳的 pts＝收下的點。
//   F14／F16／F18／F23 的單點邊界因此改寫成「那一點收不收」（看回傳的 pts），整班判不判改用「連續丟幾點」的邊界；F24–F31 是這一批新增的。
// 🔴 第十三批（V8 B(1)、B(2)）：①回溯一層——一點不合規時，若它對「去掉最後一個收下點」的其餘收下點合規（往前比其餘任兩點、往後與加速度比倒數第二點），
//   而且最後那個收下點是 10 秒內收的，就改丟最後那一點、收下這一點（照樣算一次丟點，連丟歸零）；②收下的點首末淨位移往後超過 50 m，就換另一個方向重判，
//   那個方向也不成立才判 impossible_physics（回傳的 dir 是最後用的方向）。F14／F16／F18／F24／F27／F28 的期望值照回溯一層重算；
//   F32、F33 是這一批新增的，排在 F29 前面，讓 F29 一起檢查收下的點。
{
  // REC：F11 起每一次判定都記下來，F29 拿通過的那些檢查「收下的點本身合規」。
  const REC = [];
  const rec = (pts, sys, dir, r) => (REC.push({ pts, sys, dir, r }), r);
  const has = (r, p) => Array.isArray(r.pts) && r.pts.some(k => k.t === p.t && k.d === p.d);
  const tra = pts => rec(pts, 'tra_sched', 0, integrityGate(cleanTrip({ pts }), CTX, RULES));
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
  // F14：往後的容差（50 m，比最後收下的那一點）。底座是 5 m/s 的慢車（1 Hz，第 300 秒在 1500 m）：
  //   ・孤立：第 300 秒那一秒多兩點——往後退 m 公尺的一點、再來回到前方 2 m 的一點。退 60 m 的那點不收、退 30 m 的收下，兩趟都通過（丟 1 點）。
  //   ・退了之後留在後面：多一點往後退 X，之後每一點都退 X。第 300＋k 秒（k≥1）比最後收下的第 300 秒：5k − X＜−50 就不合規；
  //     回溯一層：它若比第 299 秒（倒數第二個收下點）合規——5(k＋1) − X ≥ −50——就改丟第 300 秒、收下它（也算丟一點）。
  //     多出來的那一點（退 X）比第 299 秒退 X−5，兩邊都不合規、直接丟。→ 連丟的點數＝1＋#{k≥1：5(k＋1)＜X−50}，連丟 6 點才判
  //     → X＞80：81 m 擋（第 305 秒比第 299 秒退 51 m）、80 m 放行（丟 5 點後，第 305 秒比第 299 秒剛好退 50 m → 回溯；
  //     共丟 6 點＝全程預算 max(5, 1%×600)＝6，沒超過）。
  const slow = cleanTrip().pts.map(p => ({ ...p, d: (p.t - 30000) * 5, v: 5 + Math.sin(p.t / 7) * 0.3 }));
  const back = m => { const b = slow.slice(0, 301); const p = b[300]; b.push({ ...p, d: p.d - m }, { ...p, d: p.d + 2 }); return b.concat(slow.slice(301)); };
  const backStay = X => { const b = slow.slice(0, 301); b.push({ ...b[300], d: b[300].d - X }); return b.concat(slow.slice(301).map(p => ({ ...p, d: p.d - X }))); };
  const r14 = [tra(back(60)), tra(back(30)), tra(backStay(81)), tra(backStay(80))];
  ok('F14 第三重 同一秒裡往後退 60 m 的那一點不收、退 30 m（GPS 抖動）的收下，兩趟都通過；退了之後留在後面：81 m（連丟 6 點）→ impossible_physics、80 m（丟 5 點後回溯一層）→ 通過',
    r14[0].pass === true && !has(r14[0], { t: 30300, d: 1440 }) && r14[1].pass === true && has(r14[1], { t: 30300, d: 1470 }) &&
      r14[2].code === 'impossible_physics' && r14[3].pass === true && !has(r14[3], { t: 30300, d: 1500 }) && has(r14[3], { t: 30305, d: 1445 }),
    JSON.stringify(r14.map(r => r.code || r.pass)));
  // F15／F16：高鐵的上限（83.4 m/s → 上限×1.15＝95.91 m/s）。誠實的 2 Hz 80 m/s（0.5 秒 40 m）放行。
  const thsr = pts => rec(pts, 'thsr_sched', 0, integrityGate(cleanTrip({ sys: 'thsr_sched', pts }), CTX, RULES));
  const h2 = [];
  for (let i = 0; i <= 1200; i++) {
    const tr = 30000.3 + i * 0.5;
    h2.push({ d: Math.round((tr - 30000) * 80 + Math.sin(i * 1.3) * 3), t: Math.round(tr), v: 80 + Math.sin(i / 9) * 0.5, acc: 6 });
  }
  ok('F15 第三重 高鐵誠實的 2 Hz 錄程（80 m/s、同一秒兩點相隔約 40 m）照樣通過',
    thsr(h2).pass === true, JSON.stringify(thsr(h2)));
  // F16：往前的上界（任兩點）。70 m/s 的高鐵（1 Hz，第 300 秒在 21000 m），第 300 秒那一秒多一點、往前跳 X 公尺，之後整段跟著往前挪 X
  // （真的跳過去、不回來，往後那一條量不到）。同一秒往前最多 95.91＋50＝145.91 m；第 300＋k 秒的點比第 300 秒（最後收下、g 最小的點）
  // 多 X − 25.91k（每晚一秒多 95.91−70＝25.91 m 的餘裕），超過 145.91 就不合規；回溯一層：比第 299 秒（倒數第二個收下點）再多一秒的餘裕，
  // X ≤ 145.91＋25.91(k＋1)＝171.82＋25.91k 就改丟第 300 秒、收下它。
  //   ・跳 150 m：跳的那一點比第 300 秒不合規、比第 299 秒合規（多 220 m ≤ 95.91×2＋50＝241.82）→ 改丟第 300 秒、收下跳的那一點；
  //     跳 140 m：直接收下（第 300 秒也留著）。兩趟都通過。
  //   ・連丟 6 點才判：連丟的點數＝#{k≥0：X＞171.82＋25.91k} → X＞171.82＋25.91×5＝301.37：302 m 擋、301 m 放行
  //     （丟 5 點後第 305 秒回溯，共丟 6 點＝全程預算 6）。
  const jumpBy = X => { const b = cleanTrip().pts.map(p => ({ ...p, d: (p.t - 30000) * 70, v: 70 }));
    return [...b.slice(0, 301), { ...b[300], d: b[300].d + X }, ...b.slice(301).map(p => ({ ...p, d: p.d + X }))]; };
  const r16 = [thsr(jumpBy(150)), thsr(jumpBy(140)), thsr(jumpBy(302)), thsr(jumpBy(301))];
  ok('F16 第三重 高鐵同一秒往前跳 150 m（超過 145.91 m）→ 回溯一層改丟前一點、收下跳的點；140 m 直接收下，兩趟都通過；跳過去不回來：302 m（連丟 6 點）→ impossible_physics、301 m（丟 5 點後回溯）→ 通過',
    r16[0].pass === true && !has(r16[0], { t: 30300, d: 21000 }) && has(r16[0], { t: 30300, d: 21150 }) &&
      r16[1].pass === true && has(r16[1], { t: 30300, d: 21000 }) && has(r16[1], { t: 30300, d: 21140 }) &&
      r16[2].code === 'impossible_physics' && r16[3].pass === true, JSON.stringify(r16.map(r => r.code || r.pass)));

  // ── 以下第六輪：兩個方向、取整到秒的誠實錄程、偽造軌跡的長期速度 ──
  const gate = (pts, sys = 'tra_sched', dir = 0) => rec(pts, sys, dir, integrityGate(cleanTrip({ sys, dir, pts }), CTX, RULES));
  const flip = (pts, L) => pts.map(p => ({ ...p, d: Math.round((L - p.d) * 10) / 10 }));   // 同一條軌跡倒過來走（dir 1＝里程遞減），t 與 v 不變
  // F17：F13、F15 倒過來走，再加一條高鐵 1 Hz 80 m/s（每步 80 m，大於往後的容差 50 m——方向沒套進「往後」那一條的話，第一步就被當成倒退）。
  const h1 = Array.from({ length: 601 }, (_, i) => ({ d: i * 80 + Math.round(Math.sin(i * 1.3) * 3), t: 30000 + i, v: 80 + Math.sin(i / 9) * 0.5, acc: 6 }));
  const r17 = [gate(flip(hz2, 50000), 'tra_sched', 1), gate(flip(h2, 100000), 'thsr_sched', 1), gate(flip(h1, 60000), 'thsr_sched', 1)];
  ok('F17 第三重 里程遞減（dir 1）的誠實錄程照樣通過：台鐵 2 Hz 35 m/s、高鐵 2 Hz 80 m/s、高鐵 1 Hz 80 m/s',
    r17.every(r => r.pass === true), JSON.stringify(r17));
  // F18：F14、F16、F10 倒過來走（dir 1：往後＝里程變大、往前＝里程變小），同一組邊界：往後退 60 m 那點不收、30 m 收下（都通過）；
  // 退了留在後面 81 m 擋、80 m 放行；高鐵同一秒往前跳 150 m 改丟前一點、140 m 直接收下（都通過）；跳過去不回來 302 m 擋、301 m 放行；台鐵掛 252 km/h 擋。
  const slow1 = flip(slow, 20000);
  const back1 = m => { const b = slow1.slice(0, 301); const p = b[300]; b.push({ ...p, d: p.d + m }, { ...p, d: p.d - 2 }); return b.concat(slow1.slice(301)); };
  const fast70 = Array.from({ length: 601 }, (_, i) => ({ d: i * 70, t: 30000 + i, v: 70 + Math.sin(i / 7) * 0.6, acc: 8 }));
  const r18 = [gate(back1(60), 'tra_sched', 1), gate(back1(30), 'tra_sched', 1), gate(flip(backStay(81), 20000), 'tra_sched', 1),
    gate(flip(backStay(80), 20000), 'tra_sched', 1), gate(flip(jumpBy(150), 60000), 'thsr_sched', 1), gate(flip(jumpBy(140), 60000), 'thsr_sched', 1),
    gate(flip(jumpBy(302), 60000), 'thsr_sched', 1), gate(flip(jumpBy(301), 60000), 'thsr_sched', 1), gate(flip(fast70, 60000), 'tra_sched', 1)];
  ok('F18 第三重 里程遞減（dir 1）的同一組邊界：往後退 60 m 那點不收、30 m 收下（都通過）；退了留在後面 81 m 擋、80 m 放行；高鐵同一秒往前跳 150 m 改丟前一點、140 m 直接收下（都通過）；跳過去不回來 302 m 擋、301 m 放行；台鐵掛 252 km/h 擋',
    r18[0].pass === true && !has(r18[0], { t: 30300, d: 18560 }) && r18[1].pass === true && has(r18[1], { t: 30300, d: 18530 }) &&
      r18[2].code === 'impossible_physics' && r18[3].pass === true && !has(r18[3], { t: 30300, d: 18500 }) && has(r18[3], { t: 30305, d: 18555 }) &&
      r18[4].pass === true && !has(r18[4], { t: 30300, d: 39000 }) && has(r18[4], { t: 30300, d: 38850 }) &&
      r18[5].pass === true && has(r18[5], { t: 30300, d: 39000 }) && has(r18[5], { t: 30300, d: 38860 }) &&
      r18[6].code === 'impossible_physics' && r18[7].pass === true && r18[8].code === 'impossible_physics', JSON.stringify(r18.map(r => r.code || r.pass)));
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
  // F23：加速度（都卜勒速度）的邊界：相鄰兩點都有速度時 |Δv| ≤ 1.3×3×(Δt＋1)——比的是最後收下的那一點，Δt＝1 時 7.8 m/s。等速 25 m/s（第 300 秒在 7500 m）：
  //   ・孤立：只有第 300 秒那一點速度多 Δ（位置照舊）——多 8.2 那點不收、多 7.4 收下，兩趟都通過（兩個方向）；那一點速度是 0（沒有速度）→ 不比、收下。
  //   ・之後一直多 Δ（回報速度真的跳上去）：第 300＋k 秒比第 299 秒（最後收下的），Δt＝k＋1 → Δ＞3.9(k＋2) 就丟 → 丟 #{k≥0：Δ＞3.9(k＋2)} 點；
  //     連丟 6 點才判：Δ＞3.9×7＝27.3 → 多 28 擋（兩個方向）、多 26（丟 5 點）放行。
  const vstep = (dv, only = false) => Array.from({ length: 601 }, (_, i) => ({ d: i * 25, t: 30000 + i, v: i < 300 || (only && i > 300) ? 25 : 25 + dv, acc: 8 }));
  const r23 = [gate(vstep(8.2, true)), gate(flip(vstep(8.2, true), 20000), 'tra_sched', 1), gate(vstep(7.4, true)), gate(vstep(-25, true)),
    gate(vstep(28)), gate(flip(vstep(28), 20000), 'tra_sched', 1), gate(vstep(26))];
  ok('F23 第三重 加速度的邊界（比最後收下的點，|Δv| ≤ 1.3×3×(Δt＋1)）：只有一點多 8.2 m/s 那點不收（兩個方向）、多 7.4 收下、速度 0 不比收下，都通過；之後一直多 28 m/s（連丟 6 點）擋（兩個方向）、多 26（5 點）放行',
    r23[0].pass === true && !has(r23[0], { t: 30300, d: 7500 }) && r23[1].pass === true && !has(r23[1], { t: 30300, d: 12500 }) &&
      r23[2].pass === true && has(r23[2], { t: 30300, d: 7500 }) && r23[3].pass === true && has(r23[3], { t: 30300, d: 7500 }) &&
      r23[4].code === 'impossible_physics' && r23[5].code === 'impossible_physics' && r23[6].pass === true, JSON.stringify(r23.map(r => r.code || r.pass)));

  // ── 以下第十一批（V7 B(1)）：孤立壞點丟掉、隧道與冷啟動不收 ──
  // F24：孤立的跳點（GPS 沿線方向單點跳；V7 誤殺最多的一型）→ 整班通過。台鐵 25 m/s（第 299 秒在 7475 m），第 300 秒那一點 ±100／±300 m，兩個方向：
  //   +300（比第 299 秒多 325 m＞41.63×2＋50＝133.26，比第 298 秒多 350 m＞41.63×3＋50＝174.89）、−300（兩邊都退超過 50 m）那一點不收；
  //   +100（多 125 m ≤ 133.26）在上界內、先收下——第 301 秒比它退 75 m 不合規、比第 299 秒多 50 m 合規 → 回溯一層：改丟 +100 那一點、收下第 301 秒；
  //   −100（比第 299 秒退 75 m）不合規、比第 298 秒剛好退 50 m（容差的邊上）合規 → 回溯一層：改丟第 299 秒、收下 −100 那一點（第 301 秒比它多 125 m，在上界內）。
  //   規則比的是收下的點，不是原始的前一點；回溯只退一層。
  const spike = S => cleanTrip().pts.map((p, i) => i === 300 ? { ...p, d: p.d + S } : p);
  const r24 = [100, -100, 300, -300].map(S => ({ S, a: gate(spike(S)), b: gate(flip(spike(S), 20000), 'tra_sched', 1) }));
  const ok24 = ({ S, a, b }) => a.pass === true && b.pass === true && (S === 100
    ? !has(a, { t: 30300, d: 7600 }) && has(a, { t: 30299, d: 7475 }) && has(a, { t: 30301, d: 7525 }) &&
      !has(b, { t: 30300, d: 12400 }) && has(b, { t: 30299, d: 12525 }) && has(b, { t: 30301, d: 12475 })
    : S === -100
    ? has(a, { t: 30300, d: 7400 }) && !has(a, { t: 30299, d: 7475 }) && has(a, { t: 30301, d: 7525 }) &&
      has(b, { t: 30300, d: 12600 }) && !has(b, { t: 30299, d: 12525 }) && has(b, { t: 30301, d: 12475 })
    : !has(a, { t: 30300, d: 7500 + S }) && !has(b, { t: 30300, d: 12500 - S }));
  ok('F24 第三重 孤立的跳點 ±100／±300 m 整班通過（兩個方向）：+300、−300 那一點不收；+100 在上界內先收下、下一點比它退 75 m → 回溯一層改丟它；−100 比前一點退 75 m、比前前一點剛好退 50 m → 回溯一層改丟前一點、收下它',
    r24.every(ok24), JSON.stringify(r24.map(x => [x.S, x.a.code || x.a.pass, x.b.code || x.b.pass, ok24(x)])));
  // F25：連續丟點的上限（連續超過 5 點才判）：第 300 秒起連續 n 點各退 300 m——每一點都比最後收下的第 299 秒退 150 m 以上。
  //   n＝5 → 丟 5 點、通過；n＝6 → impossible_physics。兩個方向。
  //   軌跡用 1201 點（考慮 1199 點、全程預算 11.99）：601 點的 cleanTrip 預算只有 5.99，連續 6 點同時也超過全程預算，
  //   連續上限改成 6 照樣擋、這條量不到它本身（第十一批突變 run_6 是靠 F14／F16／F18 才抓到的）。
  const long25 = () => Array.from({ length: 1201 }, (_, i) => ({ d: i * 25, t: 30000 + i, v: 25 + Math.sin(i / 7) * 0.6, acc: 8 }));
  const burst = n => long25().map((p, i) => i >= 300 && i < 300 + n ? { ...p, d: p.d - 300 } : p);
  const r25 = [gate(burst(5)), gate(flip(burst(5), 40000), 'tra_sched', 1), gate(burst(6)), gate(flip(burst(6), 40000), 'tra_sched', 1)];
  ok('F25 第三重 連續丟點：連續 5 點各退 300 m → 通過；連續 6 點 → impossible_physics（兩個方向）',
    r25[0].pass === true && r25[1].pass === true && r25[2].code === 'impossible_physics' && r25[3].code === 'impossible_physics',
    JSON.stringify(r25.map(r => r.code || r.pass)));
  // F26：全程丟點的預算：丟的點超過 max(5, 1%×考慮過的點數) 才判（考慮過的＝扣掉開頭 2 點與斷點後 2 點）。孤立的 −300 m 跳點、彼此相隔 30 點以上：
  //   301 點（考慮 299 點，預算 max(5, 2.99)＝5）：5 點通過、6 點擋；2001 點（考慮 1999 點，預算 19.99）：19 點通過、20 點擋。
  const scatter = (N, n) => {
    const pts = Array.from({ length: N }, (_, i) => ({ d: i * 25, t: 30000 + i, v: 25 + Math.sin(i / 7) * 0.6, acc: 8 }));
    const step = Math.floor((N - 100) / n);
    for (let k = 0; k < n; k++) { const i = 50 + k * step; pts[i] = { ...pts[i], d: pts[i].d - 300 }; }
    return pts;
  };
  const r26 = [gate(scatter(301, 5)), gate(scatter(301, 6)), gate(scatter(2001, 19)), gate(scatter(2001, 20))];
  ok('F26 第三重 全程丟點的預算 max(5, 1%)：301 點丟 5 點通過、6 點擋；2001 點丟 19 點通過、20 點擋',
    r26[0].pass === true && r26[1].code === 'impossible_physics' && r26[2].pass === true && r26[3].code === 'impossible_physics',
    JSON.stringify(r26.map(r => r.code || r.pass)));
  // F27：隧道——Δt≥10 秒的斷點之後的前 2 點不收、也不算違反。台鐵 25 m/s（第 300 秒在 7500 m），第 300 秒之後斷 G 秒、中間沒有點：
  //   ・G＝10、出隧道頭三點偏前 230／76／23 m（GPS 收斂中；V7 的出隧道形狀）：頭兩點不收，第三點（偏 23 m）在上界內收下 → 通過。
  //   ・頭四點偏前 230／230／76／23 m、G＝9（不到 10 秒、不算斷點）：頭兩點（比第 300 秒多 455、480 m，都在 41.63×(Δt＋1)＋50 以內）被收下當基準，
  //     第三點起比第二點、比第一點都退超過 50 m（−129／−104、−157／−132、−155／−130、−130／−105、−105／−80、−80／−55），回溯一層救不回來
  //     → 連丟 6 點 → impossible_physics（兩個方向）。同樣四點在 G＝10 → 頭兩點不收、第三點（偏 76 m）當基準 → 通過。
  //     （230／76／23 在 G＝9 已經判不死：第二點比第一點退 129 m、比第 300 秒合規 → 回溯一層改丟第一點。）
  //   ・G＝10、頭五點偏前 230／230／230／76／23 m：頭兩點不收；第三點（偏 230）收下、第四點比它退 129 m → 回溯一層改丟它 → 通過。
  //     只不收 1 點的話，第二、三點都被收下，第四點起兩邊都退超過 50 m → 連丟 6 點（這一條量「不收的點數」不能少於 2）。
  //   ・G＝120、出隧道第一點還是進隧道前的舊位置、第二點偏前 300 m → 兩點都不收 → 通過。
  //   ・同一趟 4 個 G＝10 的隧道（不收的點連開頭一共 10 點，超過預算 5）→ 通過：不收的點不算違反。
  const tunnels = (ats, G, offs) => cleanTrip().pts.filter((p, i) => !ats.some(a => i > a && i < a + G)).map(p => {
    const i = p.t - 30000, a = ats.find(x => i >= x + G && i < x + G + offs.length);
    return a == null ? p : { ...p, d: p.d + offs[i - a - G] };
  });
  const EXIT = [230, 76, 23], EXIT2 = [230, 230, 76, 23], EXIT3 = [230, 230, 230, 76, 23];
  const r27 = [gate(tunnels([300], 10, EXIT)), gate(flip(tunnels([300], 10, EXIT), 20000), 'tra_sched', 1),
    gate(tunnels([300], 9, EXIT2)), gate(flip(tunnels([300], 9, EXIT2), 20000), 'tra_sched', 1),
    gate(tunnels([300], 120, [-3000, 300])), gate(tunnels([100, 200, 300, 400], 10, EXIT)),
    gate(tunnels([300], 10, EXIT2)), gate(tunnels([300], 10, EXIT3))];
  ok('F27 第三重 隧道：斷 10 秒、出隧道頭三點偏前 230／76／23 m → 通過、頭兩點不在收下的點裡；頭四點 230／230／76／23：斷 9 秒（不算斷點）→ impossible_physics（兩個方向）、斷 10 秒 → 通過；斷 10 秒、頭三點都偏 230 m → 通過（只不收 1 點會連丟 6 點）；斷 120 秒、第一點是舊位置第二點偏 300 m → 通過；一趟 4 個隧道（不收 10 點）→ 通過',
    r27[0].pass === true && !has(r27[0], { t: 30310, d: 7980 }) && !has(r27[0], { t: 30311, d: 7851 }) && has(r27[0], { t: 30312, d: 7823 }) &&
      r27[1].pass === true && r27[2].code === 'impossible_physics' && r27[3].code === 'impossible_physics' && r27[4].pass === true && r27[5].pass === true &&
      r27[6].pass === true && has(r27[6], { t: 30312, d: 7876 }) && r27[7].pass === true && !has(r27[7], { t: 30312, d: 8030 }) && has(r27[7], { t: 30313, d: 7901 }),
    JSON.stringify(r27.map(r => r.code || r.pass)));
  // F28：冷啟動——開頭 2 點不收、也不算違反。台鐵 25 m/s：
  //   ・前三點偏前 300／99／30 m（V7 的冷啟動形狀）→ 前兩點不收，第三點（偏 30 m）當基準，第四點比它退 5 m → 通過。
  //   ・前兩點正常、第 2–5 點偏前 300／300／99／30 m → 第 2、3 點（偏 300 m）都被收下，第 4 點起比第 3 點、比第 2 點都退超過 50 m
  //     （−176／−151、−220／−195、−225／−200、−200／−175、−175／−150、−150／−125），回溯一層救不回來 → 連丟 6 點 → impossible_physics（兩個方向）。
  //     （只有第 2 點偏 300 m 的話已經判不死：第 3 點比第 2 點退、第 2 點又是唯一的收下點 → 回溯一層改丟第 2 點。）
  //   ・第 0–4 點偏前 300／300／300／99／30 m → 第 0、1 點不收；第 2 點收下、第 3 點比它退 176 m → 回溯一層改丟第 2 點 → 通過。
  //     只不收 1 點的話，第 1、2 點都被收下，第 3 點起兩邊都退超過 50 m → 連丟 6 點（這一條量「不收的點數」不能少於 2）。
  //   ・前兩點都偏前 300 m → 兩點都不收 → 通過。
  const cold = (at, offs) => cleanTrip().pts.map((p, i) => i >= at && i < at + offs.length ? { ...p, d: p.d + offs[i - at] } : p);
  const r28 = [gate(cold(0, [300, 99, 30])), gate(flip(cold(0, [300, 99, 30]), 20000), 'tra_sched', 1), gate(cold(2, [300, 300, 99, 30])),
    gate(flip(cold(2, [300, 300, 99, 30]), 20000), 'tra_sched', 1), gate(cold(0, [300, 300])), gate(cold(0, [300, 300, 300, 99, 30]))];
  ok('F28 第三重 冷啟動：頭三點偏前 300／99／30 m → 通過、頭兩點不在收下的點裡；第 2–5 點偏 300／300／99／30 m → impossible_physics（兩個方向）；頭三點都偏 300 m → 通過（只不收 1 點會連丟 6 點）；頭兩點都偏 300 m → 通過',
    r28[0].pass === true && !has(r28[0], { t: 30000, d: 300 }) && !has(r28[0], { t: 30001, d: 124 }) && r28[1].pass === true &&
      r28[2].code === 'impossible_physics' && r28[3].code === 'impossible_physics' && r28[4].pass === true &&
      r28[5].pass === true && !has(r28[5], { t: 30002, d: 350 }) && has(r28[5], { t: 30003, d: 174 }), JSON.stringify(r28.map(r => r.code || r.pass)));
  // ── 以下第十三批（V8 B(1)）：回溯一層 ──
  // F32：站停時 GPS 單點往前跳（V8 模擬誤殺最多的一型：往前跳 55 m 到「上限×2＋50」之間的那一點在上界內、被收下當基準，
  // 之後站著不動的好點全都比它退超過 50 m → 舊版連丟 6 點判死）。底座：20 m/s 跑 600 秒（第 600 秒到站）→ 站停 60 秒（第 600–660 秒，速度 0）
  // → 再跑 600 秒，共 1261 點（考慮 1259 點，全程丟點預算 12.59）；高鐵同一個形狀用 80 m/s。
  //   a 第 630 秒那一點往前跳 J：台鐵 70／100／130 m（比第 629 秒多 J ≤ 41.63×2＋50＝133.26，收下）、高鐵 150／200 m（≤ 95.91×2＋50＝241.82）
  //     → 第 631 秒比它退 J＞50 不合規、比第 629 秒合規 → 回溯一層改丟跳的那一點 → 通過，跳的那一點不在收下的點裡（兩個方向）。
  //   b 回溯的時間窗（10 秒）與回溯後連丟歸零：第 630 秒往前跳 100 m（收下），第 631–635 秒各退 300 m（比跳點、比第 629 秒都退超過 50 m → 連丟 5 點），
  //     之後沒有點，直到第 630＋W 秒回到原位（比跳點退 100 m 不合規、比第 629 秒合規）：
  //     W＝10 → 離跳點 10 秒、回溯；下一秒又一點退 300 m（兩邊都不合規、丟，連丟從 1 算起）→ 通過。W＝11 → 超過時間窗、不回溯 → 連丟第 6 點 → impossible_physics。兩個方向。
  //   c 回溯也算一次丟點：站停中從第 604 秒起每 4 秒一個往前 100 m 的跳點（每個都被下一秒回溯掉、各丟 1 點）——12 個（丟 12 點 ≤ 12.59）→ 通過；13 個 → impossible_physics。
  //   d 回溯之後的判定跟沒回溯過一樣（往前比的最小值要跟著退回去）：第 630 秒一個 +100 m 的跳點（第 631 秒回溯掉），第 640 秒起整段往前平移 150 m
  //     （之後一直在新位置）：比第 639 秒多 150＞133.26、比第 638 秒 ≤ 41.63×3＋50＝174.89 → 回溯改丟第 639 秒、收第 640 秒 → 通過。
  //     對照：沒有第 630 秒的跳點 → 第 638–641 秒的收法相同。最小值沒跟著退的話，第 640 秒比到的最小值少了第 639 秒 → 直接收下、第 639 秒也留著，
  //     一秒往前 150 m 違反往前的上界（F29 的逐對檢查也會紅）。兩個方向。
  const stop32 = (mps = 20) => Array.from({ length: 1261 }, (_, k) => ({ d: mps * (Math.min(k, 600) + Math.max(0, k - 660)), t: 30000 + k,
    v: k < 600 || k > 660 ? Math.round((mps + Math.sin(k / 7) * 0.6) * 100) / 100 : 0, acc: 8 }));
  // m：第 k 秒（t−30000）的點加多少公尺；null＝拿掉那一點
  const edit = (pts, m) => pts.flatMap(p => { const k = p.t - 30000; return !(k in m) ? [p] : m[k] == null ? [] : [{ ...p, d: p.d + m[k] }]; });
  const r32a = [['tra_sched', 20, 30000, [70, 100, 130]], ['thsr_sched', 80, 100000, [150, 200]]].flatMap(([sys, mps, L, Js]) => Js.flatMap(J => {
    const pts = edit(stop32(mps), { 630: J }), ds = mps * 600;
    return [{ J, sys, dir: 0, r: gate(pts, sys), sp: ds + J, st: ds }, { J, sys, dir: 1, r: gate(flip(pts, L), sys, 1), sp: L - ds - J, st: L - ds }];
  }));
  ok('F32a [第十三批 V8 B(1)] 站停中單點往前跳：台鐵 +70／+100／+130 m、高鐵 +150／+200 m → 回溯一層改丟跳的那一點、整班通過（兩個方向）',
    r32a.length === 10 && r32a.every(x => x.r.pass === true && !has(x.r, { t: 30630, d: x.sp }) && has(x.r, { t: 30629, d: x.st }) && has(x.r, { t: 30631, d: x.st })),
    JSON.stringify(r32a.map(x => [x.sys, x.J, x.dir, x.r.code || x.r.pass])));
  const win = (W, extra) => {
    const m = { 630: 100, 631: -300, 632: -300, 633: -300, 634: -300, 635: -300 };
    for (let k = 636; k < 630 + W; k++) m[k] = null;
    if (extra) m[631 + W] = -300;
    return edit(stop32(), m);
  };
  const r32b = [gate(win(10, true)), gate(flip(win(10, true), 30000), 'tra_sched', 1), gate(win(11, false)), gate(flip(win(11, false), 30000), 'tra_sched', 1)];
  ok('F32b 回溯的時間窗 10 秒、回溯後連丟歸零：跳點後連丟 5 點、第 10 秒回原位 → 回溯、之後再丟 1 點仍通過；第 11 秒才回原位 → 不回溯、連丟 6 點 → impossible_physics（兩個方向）',
    r32b[0].pass === true && !has(r32b[0], { t: 30630, d: 12100 }) && has(r32b[0], { t: 30640, d: 12000 }) && !has(r32b[0], { t: 30641, d: 11700 }) &&
      r32b[1].pass === true && !has(r32b[1], { t: 30630, d: 17900 }) && has(r32b[1], { t: 30640, d: 18000 }) &&
      r32b[2].code === 'impossible_physics' && r32b[3].code === 'impossible_physics', JSON.stringify(r32b.map(r => r.code || r.pass)));
  const spikes = n => { const m = {}; for (let i = 0; i < n; i++) m[604 + 4 * i] = 100; return edit(stop32(), m); };
  const r32c = [gate(spikes(12)), gate(spikes(13))];
  ok('F32c 回溯也算一次丟點：站停中 12 個往前 100 m 的跳點（各被回溯掉、丟 12 點 ≤ 預算 12.59）→ 通過；13 個 → impossible_physics',
    r32c[0].pass === true && r32c[0].pts.length === 1259 - 12 && r32c[1].code === 'impossible_physics', JSON.stringify(r32c.map(r => r.code || r.pass)));
  const tele = spike => { const m = spike ? { 630: 100 } : {}; for (let k = 640; k <= 1260; k++) m[k] = 150; return edit(stop32(), m); };
  const r32d = [true, false].flatMap(sp => [{ sp, dir: 0, r: gate(tele(sp)), at: dd => 12000 + dd },
    { sp, dir: 1, r: gate(flip(tele(sp), 30000), 'tra_sched', 1), at: dd => 18000 - dd }]);
  const pat32 = x => [638, 639, 640, 641].map(k => (has(x.r, { t: 30000 + k, d: x.at(k >= 640 ? 150 : 0) }) ? '+' : '-') + k).join(' ');
  ok('F32d 回溯之後的判定跟沒回溯過一樣：第 630 秒的跳點被回溯後，第 640 秒起整段往前平移 150 m → 回溯改丟第 639 秒、收第 640 秒、通過（丟 2 點）；' +
    '沒有第 630 秒跳點的對照第 638–641 秒收法相同（丟 1 點）（兩個方向）',
    r32d.length === 4 && r32d.every(x => x.r.pass === true && pat32(x) === '+638 -639 +640 +641' && x.r.pts.length === 1259 - (x.sp ? 2 : 1)),
    JSON.stringify(r32d.map(x => [x.sp, x.dir, x.r.code || x.r.pass, x.r.pts && x.r.pts.length, pat32(x)])));

  // ── 第十三批（V8 B(2) T5）：淨位移——收下的點首末要往 dir 的方向走；整體往後退超過 50 m 就換方向重判，兩個方向都不成立才判 ──
  // F33（傳進去的 dir＝上傳端／assembleTrip 給的方向；r.dir＝防偽閘回的方向，判定端的覆蓋段照它記）：
  //   a T5：原始首兩點（不收）放在線頭 0 m，之後每步退 49.9 m 從 19,500 m 掃回 39 m，391 點塞在 60 秒裡。dir 0：每步往後 49.9 m（容差 50）全收、
  //     淨位移 −19,461 m → 換 dir 1 重判：每步往前 49.9 m、平均 325 m/s → 判死 → impossible_physics（舊版：dir 0 通過、蓋滿整條線）。
  //     同樣的點攤在 600 秒（32.5 m/s）→ dir 1 成立 → 通過、r.dir＝1（方向跟著軌跡走，不再記在反方向）。
  //   b 原始首末定錯方向的誠實錄程 → 通過、方向更正：
  //     b1 停靠卡整趟站著不動：開頭兩點偏前 300／150 m（原始首末 → dir 1），之後 300 點從 50,000 m 每秒飄 0.25 m 到 50,074.75 m
  //        → dir 1 淨位移 −74.75 m → 換 dir 0：通過、r.dir＝0。
  //     b2 台鐵 25 m/s 往里程遞增走 600 秒，最後一點是往後 17 km 的大偏移（原始首末 → dir 1）→ dir 1：每步 −25 m 全收、偏移那點不收、淨位移 −14,950 m
  //        → 換 dir 0：偏移那點不收 → 通過、r.dir＝0。
  //   c 一般的趟方向不變：cleanTrip dir 0 → 0；倒過來走 dir 1 → 1。
  //   d 淨位移的邊界（容差 50 m，判的是「小於 −50」）：dir 0、站著不動從 50,000 m 慢慢飄回 49,950 m → 不換（r.dir＝0）；飄回 49,949 m → 換成 1。
  //   e 兩個方向都往後：頭兩點（不收）後在 1000 m 站 10 秒，之後 4 秒每秒退 37.5 m（到 850 m），同一秒再往前 5 步各 50 m（到 1100 m）。
  //     dir 0：往前那 5 步第 2 步起違反往前（同一秒累積 100 m＞41.63＋50），丟 4 點，收下的點淨位移 900 − 1000＝−100；
  //     dir 1：往前 37.5 m/s 在上限內、往回的 5 步各退 50 m（剛好在容差上）全收，淨位移 −(1100 − 1000)＝−100 → 兩個方向都不成立 → impossible_physics。
  const t5 = W => [{ d: 0, t: 30000, v: 0, acc: 5 }, { d: 0, t: 30000, v: 0, acc: 5 },
    ...Array.from({ length: 391 }, (_, j) => ({ d: Math.round((19500 - j * 49.9) * 10) / 10, t: 30000 + Math.floor(j * W / 391), v: 0, acc: 5 }))];
  const st = (h, n, f) => [...h, ...Array.from({ length: n }, (_, k) => ({ d: f(k), t: 30000 + h.length + k, v: 0, acc: 8 }))];
  const b1 = st([{ d: 50300, t: 30000, v: 0, acc: 8 }, { d: 50150, t: 30001, v: 0, acc: 8 }], 300, k => 50000 + k * 0.25);
  const b2 = [...cleanTrip().pts, { d: -2000, t: 30601, v: 25, acc: 8 }];
  const drift = D => st([{ d: 50000, t: 30000, v: 0, acc: 8 }, { d: 50000, t: 30001, v: 0, acc: 8 }], 300, k => Math.round((50000 - D * k / 299) * 100) / 100);
  const both = [{ d: 1000, t: 30000 }, { d: 1000, t: 30001 }, ...Array.from({ length: 10 }, (_, k) => ({ d: 1000, t: 30002 + k })),
    ...[1, 2, 3, 4].map(k => ({ d: 1000 - 37.5 * k, t: 30011 + k })), ...[1, 2, 3, 4, 5].map(j => ({ d: 850 + 50 * j, t: 30015 }))].map(p => ({ ...p, v: 0, acc: 8 }));
  const r33 = { a60: gate(t5(60)), a600: gate(t5(600)), b1: gate(b1, 'tra_sched', 1), b2: gate(b2, 'tra_sched', 1),
    c0: gate(cleanTrip().pts), c1: gate(flip(cleanTrip().pts, 20000), 'tra_sched', 1), d50: gate(drift(50)), d51: gate(drift(51)), e: gate(both) };
  const pd = r => r.pass ? `ok/dir${r.dir}` : r.code;
  ok('F33 [第十三批 V8 B(2)] 淨位移：T5 往後掃（60 秒）→ impossible_physics、攤在 600 秒 → 通過且方向改成 1；原始首末定錯方向的誠實錄程（站停漂移、最後一點大偏移）→ 通過且方向更正；一般的趟方向不變；邊界 −50 不換、−51 換；兩個方向都往後 → impossible_physics',
    r33.a60.code === 'impossible_physics' && r33.a600.pass === true && r33.a600.dir === 1 &&
      r33.b1.pass === true && r33.b1.dir === 0 && r33.b2.pass === true && r33.b2.dir === 0 && !has(r33.b2, { t: 30601, d: -2000 }) &&
      r33.c0.pass === true && r33.c0.dir === 0 && r33.c1.pass === true && r33.c1.dir === 1 &&
      r33.d50.pass === true && r33.d50.dir === 0 && r33.d51.pass === true && r33.d51.dir === 1 && r33.e.code === 'impossible_physics',
    JSON.stringify(Object.fromEntries(Object.entries(r33).map(([k, r]) => [k, pd(r)]))));
  // F29：收下的點本身要是一趟合規的錄程——丟點＝那幾點沒送，偽造者不因此多出能力（V7 的但書）。F11 起每一個判通過的案例（含 F32、F33）：
  //   回傳的 pts 是原始點的子序列（t、d、v 逐欄相同），而且任兩點往前 ≤ 上限×1.15×(Δt＋1)＋50、相鄰兩點往後 ≤ 50、相鄰兩點都有速度時 |Δv| ≤ 1.3×3×(Δt＋1)、
  //   首末淨位移不往後超過 50 m——方向照防偽閘回的 r.dir（第十三批起收下的點整體往後退會換方向，收下的點只對它回的方向合規）。
  //   獨立的逐對檢查（O(n²)，不用實作「記最小值」的寫法）；要有牙：通過的案例裡至少 10 個收下的點比原始少 3 點以上（開頭 2 點之外還有丟或不收的）。
  const CAP = RULES.integrity.speedCapMps, AMAX = RULES.integrity.maxAccelMps2 * 3;
  const keptBad = ({ pts, sys, dir, r }) => {
    const P = r.pts, s = Number(r.dir ?? dir) === 1 ? -1 : 1, lim = (sys === 'thsr_sched' ? CAP.THSR : CAP.default) * 1.15;
    if (!Array.isArray(P)) return 'pts 不是陣列';
    let j = 0;
    for (const p of pts) if (j < P.length && P[j].t === p.t && P[j].d === p.d && P[j].v === p.v) j++;
    if (j !== P.length) return '不是原始點的子序列';
    for (let b = 1; b < P.length; b++) {
      const x = P[b - 1], y = P[b];
      if (s * (y.d - x.d) < -50) return `往後 ${y.t}`;
      if (x.v > 0 && y.v > 0 && Math.abs(y.v - x.v) > AMAX * (y.t - x.t + 1) + 1e-9) return `加速度 ${y.t}`;
      for (let a = 0; a < b; a++) if (s * (y.d - P[a].d) > lim * (y.t - P[a].t + 1) + 50 + 1e-6) return `往前 ${P[a].t}→${y.t}`;
    }
    if (P.length >= 2 && s * (P[P.length - 1].d - P[0].d) < -50) return '淨位移往後';
    return null;
  };
  const passed = REC.filter(x => x.r.pass === true);
  const thinned = passed.filter(x => x.r.pts.length <= x.pts.length - 3);
  const bad29 = passed.map(x => [x.sys, x.dir, x.pts.length, keptBad(x)]).filter(x => x[3]);
  ok('F29 第三重 收下的點本身合規（丟點＝沒送）：F11 起每一個通過的案例（含 F32、F33），收下的點是原始點的子序列，而且任兩點往前、相鄰兩點往後與加速度都在上界內、首末淨位移不往後（逐對檢查，方向照回傳的 dir）',
    thinned.length >= 10 && bad29.length === 0, JSON.stringify({ passed: passed.length, thinned: thinned.length, bad: bad29.slice(0, 3) }));
}

// ── F30：跨午夜（第十一批，V7 B(2) T3）──────────────────────────────────────────
// App 的 t 是當天第幾秒（index.html 的 nowSecOfDay），午夜歸零；乘車日是開始錄的那一天（bountyOnFix、state.recording.tripDate）。
// 規則：同一組點的 t 最大減最小超過半天（43200 秒）＝跨午夜，小於半天的 t 加一天（86400）再排序。期望值照規則手算：
//   25 m/s、700 秒：t 86000–86399（午夜前 400 點）接 0–300（午夜後 301 點），里程連續；兩批上傳、後半先到。
//   → 組回來 701 點、t 86000–86700 依序；防偽閘通過（兩個方向）。
//   對照：同一批點照原始 t 排（午夜後的點排到最前面）→ 過了午夜的點在里程上「退回」起點 → impossible_physics（舊版就是這樣整班判死）。
//   清晨的趟（t 300–1000）t 不變；半天的邊界：最大減最小剛好 43200 不動、43201 才加一天。
{
  const row = (id, pts) => ({ id, actor: 'dev-x', trip_date: '2026-07-28', train_no: '312', sys: 'tra_sched', ln_id: '南迴線', dir: 0, payload: JSON.stringify(pts) });
  const mk = sgn => Array.from({ length: 701 }, (_, k) => ({ d: sgn > 0 ? k * 25 : 20000 - k * 25, t: k < 400 ? 86000 + k : k - 400, v: 25 + Math.sin(k / 7) * 0.6, acc: 8 }));
  const res = [1, -1].map(sgn => {
    const P = mk(sgn), trip = assembleTrip([row('m2', P.slice(400)), row('m1', P.slice(0, 400))]);
    const raw = { ...trip, pts: P.map(p => ({ ...p })).sort((a, b) => a.t - b.t) };
    return { dir: trip.dir, ts: trip.pts.map(p => p.t), ig: integrityGate(trip, CTX, RULES), raw: integrityGate(raw, CTX, RULES) };
  });
  const seq = JSON.stringify(Array.from({ length: 701 }, (_, k) => 86000 + k));
  ok('F30a 跨午夜：午夜前 400 點＋午夜後 301 點（後半先到）→ 組回來 t 86000–86700 依序、防偽閘通過（兩個方向；方向照首末里程判 0／1）',
    res.every((r, i) => JSON.stringify(r.ts) === seq && r.ig.pass === true && r.dir === i),
    JSON.stringify(res.map(r => ({ dir: r.dir, t0: r.ts[0], t400: r.ts[400], tN: r.ts[r.ts.length - 1], ig: r.ig.code || r.ig.pass }))));
  ok('F30b 對照：同一批點照原始 t 排（午夜後的排到最前面）→ impossible_physics（兩個方向）——跨午夜沒認的話整班判死',
    res.every(r => r.raw.code === 'impossible_physics'), JSON.stringify(res.map(r => r.raw.code || r.raw.pass)));
  const early = assembleTrip([row('e1', Array.from({ length: 701 }, (_, k) => ({ d: k * 25, t: 300 + k, v: 25, acc: 8 })))]);
  const edge = n => assembleTrip([row('x1', [{ d: 0, t: 1000, v: 1, acc: 8 }, { d: 10, t: 1000 + n, v: 1, acc: 8 }])]).pts.map(p => p.t);
  ok('F30c 清晨的趟（t 300–1000）t 不變；半天的邊界：最大減最小剛好 43200 → 不動（1000、44200），43201 → 小的加一天（44201、87400）',
    early.pts[0].t === 300 && early.pts[700].t === 1000 && JSON.stringify(edge(43200)) === JSON.stringify([1000, 44200]) &&
      JSON.stringify(edge(43201)) === JSON.stringify([44201, 87400]),
    JSON.stringify({ early: [early.pts[0].t, early.pts[700].t], e0: edge(43200), e1: edge(43201) }));
}

// ── F31：被丟的點也不能拿去算都卜勒相關係數與逐站時刻（V7 的但書：否則丟掉的點仍能稀釋相關係數、仍能拿來對上誤點紀錄）────────────
{
  const pearson = (a, b) => {
    const n = a.length, mA = a.reduce((s, x) => s + x, 0) / n, mB = b.reduce((s, x) => s + x, 0) / n;
    let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - mA, y = b[i] - mB; sab += x * y; sa += x * x; sb += y * y; }
    return sa > 0 && sb > 0 ? sab / Math.sqrt(sa * sb) : 0;
  };
  const corrOf = pts => {
    const a = [], b = [];
    for (let i = 1; i < pts.length; i++) { const dt = pts[i].t - pts[i - 1].t; if (dt <= 0) continue; a.push(pts[i].v); b.push(Math.abs(pts[i].d - pts[i - 1].d) / dt); }
    return pearson(a, b);
  };
  // a：F6 的偽造（速度＝位置微分本身）再加 4 個孤立的 +300 m 跳點（第 100、250、400、550 秒）。跳點全部不收 → 收下的點相關係數仍＞0.995 → doppler_too_clean。
  //    對照：原始的點（含跳點）照同一個定義算的相關係數＜0.995——判定端若拿原始的點算，這個偽造就過了。
  const spk = spoofedPts(wobblyPts()).map((p, i) => [100, 250, 400, 550].includes(i) ? { ...p, d: p.d + 300 } : p);
  const r31a = integrityGate(cleanTrip({ pts: spk }), CTX, RULES), raw31 = corrOf(spk);
  ok('F31a 都卜勒只看收下的點：偽造軌跡加 4 個孤立跳點 → 仍判 doppler_too_clean（原始的點算出來的相關係數＜0.995，拿它算就會放行）',
    r31a.code === 'doppler_too_clean' && raw31 < RULES.integrity.dopplerCorrMax, JSON.stringify({ r: r31a.code || r31a.pass, raw31 }));
  // b：逐站時刻。誠實的軌跡 25 m/s、整段偏前 7 m（里程最接近 S5＝10 km 的點是第 400 秒的 10,007 m），獨立紀錄說 S5 的通過時刻是第 50 秒
  //    → 差 350 秒＞容差 300 → delay_mismatch。另外在第 50 秒塞一個剛好在 S5（10,000 m）的點：比當時的位置往前 8.7 km、違反往前的上界 → 不收。
  //    原始的點裡「里程最接近 S5」的就是這個 0 m 的假點、時刻剛好對上；只看收下的點 → 仍是 delay_mismatch。
  const hon = cleanTrip().pts.map(p => ({ ...p, d: p.d + 7 }));
  const fake = [...hon.slice(0, 51), { ...hon[50], d: 10000 }, ...hon.slice(51)];
  const ctx31 = { ...CTX, events: [{ sta: 'S5', status: '到站', delay: 0, obs_at: '2026-07-28T00:00:00Z', schedSec: 30050 }] };
  const best = pts => pts.reduce((m, p) => Math.abs(p.d / 1000 - 10) < m.gap ? { gap: Math.abs(p.d / 1000 - 10), t: p.t } : m, { gap: Infinity, t: null });
  const r31b = [integrityGate(cleanTrip({ pts: hon }), ctx31, RULES), integrityGate(cleanTrip({ pts: fake }), ctx31, RULES)];
  ok('F31b 逐站時刻只看收下的點：誠實軌跡對不上紀錄 → delay_mismatch；塞一個剛好在站上、剛好對上時刻的假點（不收）→ 仍是 delay_mismatch（原始的點裡最接近 S5 的就是那個假點）',
    r31b[0].code === 'delay_mismatch' && r31b[1].code === 'delay_mismatch' && best(fake).t === 30050 && best(fake).gap === 0 && best(hon).t === 30400,
    JSON.stringify({ r: r31b.map(r => r.code || r.pass), bestFake: best(fake), bestHon: best(hon) }));
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
