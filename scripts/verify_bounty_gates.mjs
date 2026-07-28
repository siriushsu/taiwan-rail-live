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
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(M) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  const board = LINE.stations.slice(1).map((s, i) =>
    `('tra_sched|南迴線|${LINE.stations[i].name}|${s.name}','tra_sched','自強',0,'track','',1,1,2,10,1,1,0,NULL)`).join(',');
  const mk = (id, actor, pts) => `('${id}','${actor}','tra_sched','南迴線','312',0,'2026-07-28','${JSON.stringify(pts)}',NULL,1,'pending')`;
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

// ── L 組：驗證 cron 的單次處理上限（2026-07-29 稽核：SELECT * 沒有 LIMIT）────────────
// 寫入端點是免登入的，所以「有多少 pending」是外部可控的數字。上限本身好加，難的是**切在哪裡**：
// 從中間切開會讓那一趟被當成半趟送進品質閘 → 判 too_short。那是把資料判錯，不是延後一天。
// 判準因此不是「有沒有截斷」，而是「有沒有任何一趟被切成一半」——這條在沒有邊界處理時必紅。
{
  const M = { generatedAt: 1, schedDate: '2026-07-28', lines: { 'tra_sched|南迴線': LINE }, units: [] };
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(M) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  // 4001 列 > BOUNTY_VERIFY_MAX_ROWS(4000)，分成 1000 趟、每趟 4 批，最後一趟只給 1 批，
  // 讓「上限」正好落在某一趟的中間（4000 = 999 趟×4 + 第 1000 趟的第 1 批）。
  const pts = JSON.stringify(cleanTrip().pts);
  const vals = [];
  for (let t = 0; t < 1000; t++) {
    const n = t === 999 ? 5 : 4;
    for (let i = 0; i < n; i++) {
      vals.push(`('s${t}-${i}','dev-${String(t).padStart(4, '0')}','tra_sched','南迴線','312',0,'2026-07-28','${pts}',NULL,${i},'pending')`);
    }
  }
  const { db, DELAY_DB } = openTestDb(
    `INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict) VALUES ${vals.join(',')};`);
  _bounty.bountyResetMemCaches();
  const stat = await bountyVerifyCron({ DELAY_DB, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-29T02:00:00Z')) });
  const total = db.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c;
  const done = db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict<>'pending'").get().c;
  // 核心判準：逐趟檢查「全判完」或「全還沒判」，不存在中間狀態
  const split = db.prepare(
    "SELECT actor, SUM(CASE WHEN verdict='pending' THEN 1 ELSE 0 END) p, COUNT(*) n" +
    ' FROM bounty_samples GROUP BY actor, trip_date, train_no HAVING p > 0 AND p < n').all();
  ok('L1 單次 cron 不會把所有 pending 一次讀進來（有上限，最壞情況是常數不是外部可控）',
    done > 0 && done < total, `${done}/${total} 已判定`);
  ok('L2 stat 誠實回報這次被截斷了（沒有這面旗，運維只會看到「今天判得比較少」）',
    stat.truncated === true, JSON.stringify({ truncated: stat.truncated, trips: stat.trips }));
  ok('L3 沒有任何一趟被切成一半（截斷切在趟的邊界上，不是切在列中間）',
    split.length === 0, split.length ? JSON.stringify(split.slice(0, 3)) : '零趟處於半判定狀態');
  // 反向對照：剩下的下一次跑得完，不是永久卡住
  const stat2 = await bountyVerifyCron({ DELAY_DB, ASSETS, BOUNTY_NOW: String(Date.parse('2026-07-30T02:00:00Z')) });
  const left = db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c;
  ok('L4 沒判到的下一發補完（截斷是延後，不是遺失）',
    left === 0 && stat2.truncated === false, JSON.stringify({ left, truncated2: stat2.truncated }));
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
