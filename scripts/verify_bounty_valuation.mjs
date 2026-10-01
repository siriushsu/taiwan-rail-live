// 懸賞估值驗收。判準刻意不與實作同源（心得 29）：L1／L2 的期望值由測試自己手算寫死，
// 不呼叫實作的估值函式去產生期望值。
// 跑法：node scripts/verify_bounty_valuation.mjs
import { readFileSync, existsSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';
import { bountyRetireVerdict, BOUNTY_VALUATION_MAX_AGE_MS } from './lib/bounty_retire_verdict.mjs';

const { bountyMedian, bountyL1, bountyL2, bountyPointsOf, bountyUnlocked, bountyValuationCron } = _bounty;
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const DAY = 86400000;

// ── D 組：純函式 ─────────────────────────────────────────────────────────
ok('D1 中位數（偶數筆取中間兩筆平均）', bountyMedian([1, 2, 3, 4]) === 2.5 && bountyMedian([5, 1, 3]) === 3);
// 全網中位 60 班/日、南迴自強 4 班/日 → 60/4=15 → clamp 到上限 3
ok('D2 L1 稀疏路線頂到 3', bountyL1(4, 60) === 3, String(bountyL1(4, 60)));
// 西部幹線 60 班/日 = 中位數 → 1
ok('D3 L1 中位數路線＝1', bountyL1(60, 60) === 1, String(bountyL1(60, 60)));
// 比中位還密 → 仍是 1（下限）
ok('D4 L1 有下限 1', bountyL1(120, 60) === 1, String(bountyL1(120, 60)));
// 30 班 → 60/30 = 2
ok('D5 L1 中間值不被 clamp', bountyL1(30, 60) === 2, String(bountyL1(30, 60)));
ok('D6 L1 沒有班次資料視同最難（3）', bountyL1(0, 60) === 3 && bountyL1(null, 60) === 3);

// L2 = min(1.2^floor(天數/7), 5)。手算：第 0–6 天 → 1.2^0=1；第 7 天 → 1.2；第 56 天 → 1.2^8=4.29981696；
// 第 63 天 → 1.2^9=5.159780352 → 封頂 5
{
  const t0 = 1700000000000;
  ok('D7 L2 第 0 天＝1', bountyL2(t0, t0) === 1, String(bountyL2(t0, t0)));
  ok('D8 L2 第 6 天仍＝1', bountyL2(t0 + 6 * DAY, t0) === 1, String(bountyL2(t0 + 6 * DAY, t0)));
  ok('D9 L2 第 7 天＝1.2', Math.abs(bountyL2(t0 + 7 * DAY, t0) - 1.2) < 1e-9, String(bountyL2(t0 + 7 * DAY, t0)));
  ok('D10 L2 第 56 天＝1.2^8', Math.abs(bountyL2(t0 + 56 * DAY, t0) - 4.29981696) < 1e-6, String(bountyL2(t0 + 56 * DAY, t0)));
  ok('D11 L2 第 63 天封頂 5', bountyL2(t0 + 63 * DAY, t0) === 5, String(bountyL2(t0 + 63 * DAY, t0)));
  // 🔴 這一條是規格 §4 的鐵則：沒人能接的期間 L2 不准漲
  ok('D12 first_claimable_at 為 NULL 時 L2 恆為 1（不准用假訊號漲價）',
    bountyL2(t0 + 999 * DAY, null) === 1 && bountyL2(t0 + 999 * DAY, 0) === 1);
}

// 點數 = round(1 × L1 × L2)，最低 1
ok('D13 點數 3×1＝3', bountyPointsOf(3, 1) === 3);
ok('D14 點數 3×1.2＝3.6→4', bountyPointsOf(3, 1.2) === 4, String(bountyPointsOf(3, 1.2)));
ok('D15 點數有下限 1', bountyPointsOf(1, 0.1) === 1, String(bountyPointsOf(1, 0.1)));

// 自動開關：三個條件同時成立才置 1
{
  const t = 1700000000000, base = { l2: 5, sample_count: 0, l2_capped_at: t };
  ok('D16 到頂滿 30 天且零覆蓋 → 開', bountyUnlocked(base, t + 30 * DAY) === 1);
  ok('D17 到頂但只過 29 天 → 不開', bountyUnlocked(base, t + 29 * DAY) === 0);
  ok('D18 有樣本就不開', bountyUnlocked({ ...base, sample_count: 1 }, t + 60 * DAY) === 0);
  ok('D19 l2 沒到頂就不開', bountyUnlocked({ ...base, l2: 4.3 }, t + 60 * DAY) === 0);
  ok('D20 沒有 l2_capped_at 就不開', bountyUnlocked({ ...base, l2_capped_at: null }, t + 60 * DAY) === 0);
}

// ── E 組：清單檔與 cron ───────────────────────────────────────────────────
ok('E1 data/bounty_units.json 存在', existsSync('data/bounty_units.json'));
let M = null;
if (existsSync('data/bounty_units.json')) {
  M = JSON.parse(readFileSync('data/bounty_units.json', 'utf8'));
  ok('E2 有 units 與 lines', Array.isArray(M.units) && M.units.length > 100 && M.lines && Object.keys(M.lines).length > 3,
    `units=${M.units && M.units.length} lines=${M.lines && Object.keys(M.lines).length}`);
  ok('E3 每個 unit 五個鍵欄位齊全',
    M.units.every(u => u.segKey && u.sys && u.trainKind && (u.dir === 0 || u.dir === 1) &&
      (u.kind === 'track' || u.kind === 'dwell') && typeof u.perDay === 'number'),
    JSON.stringify(M.units[0]));
  ok('E4 track 的兩端站相異、dwell 的兩端站相同（全計畫共用的鍵約定）',
    M.units.every(u => { const p = u.segKey.split('|'); return u.kind === 'dwell' ? p[2] === p[3] : p[2] !== p[3]; }));
  ok('E5 lines 帶站里程（驗證閘要靠它把里程換回站）',
    Object.values(M.lines).every(l => Array.isArray(l.stations) && l.stations.every(s => s.name && typeof s.d === 'number')));
  ok('E6 segKey 的前兩段對得上 lines 的鍵',
    M.units.every(u => { const p = u.segKey.split('|'); return !!M.lines[p[0] + '|' + p[1]]; }));
}

// E7–E10 cron：第一次跑會建列，第二次跑不重複建、只更新
{
  const manifest = { generatedAt: 1, schedDate: '2026-07-28', lines: { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] } },
    units: [
      { segKey: 'tra_sched|南迴線|大武|太麻里', sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 4 },
      { segKey: 'tra_sched|南迴線|大武|枋寮', sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 60 },
    ] };
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(manifest) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  const { db, DELAY_DB } = openTestDb();

  const r1 = await bountyValuationCron({ DELAY_DB, ASSETS });
  const rows = db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all();
  ok('E7 第一次跑建了兩列', r1.inserted === 2 && rows.length === 2, JSON.stringify(r1));
  // 中位數 = (4+60)/2 = 32；南迴 32/4 = 8 → clamp 3；西部 32/60 = 0.53 → clamp 1
  const nh = rows.find(x => x.seg_key === 'tra_sched|南迴線|大武|太麻里');
  const wl = rows.find(x => x.seg_key === 'tra_sched|南迴線|大武|枋寮');
  ok('E8 L1 用清單自己的中位數算（手算：中位 32 → 3 與 1）', nh.l1 === 3 && wl.l1 === 1, `${nh.l1} / ${wl.l1}`);
  ok('E9 未設 BOUNTY_CLAIMABLE_FROM → first_claimable_at 為 NULL 且 L2＝1',
    nh.first_claimable_at === null && nh.l2 === 1, JSON.stringify({ f: nh.first_claimable_at, l2: nh.l2 }));

  const r2 = await bountyValuationCron({ DELAY_DB, ASSETS });
  const n2 = db.prepare('SELECT COUNT(*) c FROM bounty_board').get().c;
  ok('E10 第二次跑不重複建列（冪等）', n2 === 2 && r2.inserted === 0, `rows=${n2} ${JSON.stringify(r2)}`);

  // E11 設了 secret 之後才開始計時
  const r3 = await bountyValuationCron({ DELAY_DB, ASSETS, BOUNTY_CLAIMABLE_FROM: String(Date.now() - 63 * DAY) });
  const nh3 = db.prepare("SELECT * FROM bounty_board WHERE seg_key='tra_sched|南迴線|大武|太麻里'").get();
  ok('E11 設了起算點後 L2 封頂 5、points＝round(3×5)＝15 且記下 l2_capped_at',
    nh3.l2 === 5 && nh3.points === 15 && nh3.l2_capped_at > 0, JSON.stringify({ l2: nh3.l2, p: nh3.points, c: nh3.l2_capped_at }));
  ok('E12 剛到頂還沒滿 30 天 → 自動開關不開', nh3.unlocked_offer === 0, String(nh3.unlocked_offer));
}

// E13–E18 換班表：per_day 照新清單更新、清單外的單位退場、回到清單就復出而且歷史不歸零、
// 已經退場的不再重算退場數、空清單中止。
// 模組層級的清單快取每一發之前都歸零（bountyResetMemCaches），才讀得到換過的清單。期望值手算：
//   清單 A＝{太麻里 4 班, 枋寮 60 班, 金崙 30 班} → 中位 30：太麻里 30/4 → 頂格 3、枋寮 1、金崙 1。
//   清單 B＝{太麻里 60 班, 枋寮 60 班, 瀧溪 4 班}（金崙拿掉、瀧溪新增）→ 中位 60：太麻里 1、枋寮 1、瀧溪 3；
//   金崙若被重算會是 60/30＝2——退場的列不重算，要停在 1。
{
  const U = (b, perDay) => ({ segKey: `tra_sched|南迴線|大武|${b}`, sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay });
  const lines = { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] } };
  let cur = null;
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(cur) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  const { db, DELAY_DB } = openTestDb();
  const run = units => { cur = { generatedAt: 1, schedDate: '2026-07-28', lines, units }; _bounty.bountyResetMemCaches(); return bountyValuationCron({ DELAY_DB, ASSETS }); };
  const row = b => ({ ...db.prepare('SELECT * FROM bounty_board WHERE seg_key=?').get(`tra_sched|南迴線|大武|${b}`) });
  const all = () => JSON.stringify(db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all());
  const A = [U('太麻里', 4), U('枋寮', 60), U('金崙', 30)];
  const B = [U('太麻里', 60), U('枋寮', 60), U('瀧溪', 4)];
  const ra = await run(A);
  const a1 = row('太麻里'), a3 = row('金崙');
  ok('E13 清單 A：三列上架、都沒退場；太麻里 per_day 4 → L1 3',
    ra.inserted === 3 && ra.retired === 0 && a1.per_day === 4 && a1.l1 === 3 && a1.retired === 0 && a3.retired === 0 && a3.l1 === 1,
    JSON.stringify({ ra, a1: [a1.per_day, a1.l1, a1.retired], a3: [a3.l1, a3.retired] }));
  db.prepare('UPDATE bounty_board SET sample_count=7, l2_capped_at=123 WHERE seg_key=?').run('tra_sched|南迴線|大武|金崙');   // 金崙累積一點歷史
  const rb = await run(B);
  const b1 = row('太麻里'), b3 = row('金崙'), b4 = row('瀧溪');
  ok('E14 清單 B：已在板上的太麻里 per_day 換成 60、L1 照新中位重算成 1、點數 1，first_listed_at 不變（舊版 INSERT OR IGNORE 停在 4 與 3）',
    b1.per_day === 60 && b1.l1 === 1 && b1.points === 1 && b1.first_listed_at === a1.first_listed_at,
    JSON.stringify({ per_day: b1.per_day, l1: b1.l1, points: b1.points, f: [a1.first_listed_at, b1.first_listed_at] }));
  ok('E15 清單 B 沒有金崙 → 退場（retired 1）：列還在，趟數 7、per_day 30、L1 1 原封不動（沒被重算成 2）；瀧溪新上架；回報新上架 1、退場 1',
    b3.retired === 1 && b3.sample_count === 7 && b3.per_day === 30 && b3.l1 === 1 && b4.retired === 0 && b4.l1 === 3 && rb.inserted === 1 && rb.retired === 1,
    JSON.stringify({ rb, b3: [b3.retired, b3.sample_count, b3.per_day, b3.l1], b4: [b4.retired, b4.l1] }));
  const rc = await run(A);
  const c3 = row('金崙'), c4 = row('瀧溪');
  ok('E16 清單又回到 A：金崙復出（retired 0），first_listed_at、趟數 7、l2_capped_at 123 都是原本的值；瀧溪換成退場；復出不算新上架（新上架 0、退場 1）',
    c3.retired === 0 && c3.first_listed_at === a3.first_listed_at && c3.sample_count === 7 && c3.l2_capped_at === 123 &&
      c4.retired === 1 && rc.inserted === 0 && rc.retired === 1,
    JSON.stringify({ rc, c3: [c3.retired, c3.first_listed_at === a3.first_listed_at, c3.sample_count, c3.l2_capped_at], c4: c4.retired }));
  const rd = await run(A);
  const d4 = row('瀧溪');
  ok('E18 清單還是 A：瀧溪上一發就退場了，這一發不再算進退場（新上架 0、退場 0），列照舊是退場',
    rd.inserted === 0 && rd.retired === 0 && d4.retired === 1,
    JSON.stringify({ rd, d4: d4.retired }));
  const snap = all();
  let threw = '';
  try { await run([]); } catch (e) { threw = String(e && e.message); }
  ok('E17 空清單＝丟錯中止，整張板一列都沒動（不是當成「今天沒有任何單位」全部退場）', /bounty_units empty/.test(threw) && all() === snap, threw || '沒有丟錯');
}

// E19：退場只退清單上真的少掉的那一格，主鍵五欄都要比。E13–E18 的單位 seg_key 各不相同，
// 退場那一句少比 slot、dir 或車種也看不出來。這裡同一個鍵放好幾格：大武站的自強停站尖峰／離峰／假日三格＋莒光尖峰一格，
// 大武–金崙自強兩個方向各一格。第二份清單只拿掉自強尖峰（尖峰換了小時就是這個樣子）與反方向那一格 →
// 只有這兩格退場；自強離峰、假日（同站同車種、別的時段）、莒光尖峰（同站同時段、別的車種）、順方向那一格都照舊。
{
  const D = (trainKind, slot) => ({ segKey: 'tra_sched|南迴線|大武|大武', sys: 'tra_sched', trainKind, dir: 0, kind: 'dwell', slot, perDay: 6 });
  const T = dir => ({ segKey: 'tra_sched|南迴線|大武|金崙', sys: 'tra_sched', trainKind: '自強', dir, kind: 'track', slot: '', perDay: 6 });
  const lines = { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] } };
  let cur = null;
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(cur) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  const { db, DELAY_DB } = openTestDb();
  const run = units => { cur = { generatedAt: 1, schedDate: '2026-07-28', lines, units }; _bounty.bountyResetMemCaches(); return bountyValuationCron({ DELAY_DB, ASSETS }); };
  const full = [D('自強', 'peak'), D('自強', 'off'), D('自強', 'holiday'), D('莒光', 'peak'), T(0), T(1)];
  const r1 = await run(full);
  const r2 = await run(full.filter(u => !(u.trainKind === '自強' && u.slot === 'peak') && !(u.kind === 'track' && u.dir === 1)));
  const got = db.prepare('SELECT train_kind, dir, kind, slot, retired FROM bounty_board ORDER BY kind, train_kind, dir, slot').all()
    .map(r => `${r.kind}|${r.train_kind}|${r.dir}|${r.slot}=${r.retired}`);
  const want = ['dwell|自強|0|holiday=0', 'dwell|自強|0|off=0', 'dwell|自強|0|peak=1', 'dwell|莒光|0|peak=0', 'track|自強|0|=0', 'track|自強|1|=1'];
  ok('E19 同站同車種只少尖峰那一格、同段只少反方向那一格 → 只有那兩格退場（退場 2）；同站別的時段、同時段別的車種、同段順方向都照舊',
    r1.inserted === 6 && r1.retired === 0 && r2.inserted === 0 && r2.retired === 2 && JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify({ r1: [r1.inserted, r1.retired], r2: [r2.inserted, r2.retired], got }));
}

// E20–E23：清單只少一部分時的守門。某個系統這一發要退場的列至少 10 列、而且超過它現役列的一成，
// 就在動 bounty_board 之前丟錯：整張板一列都不動（同一份清單裡新增的單位也不上架；擋下時只會先寫 kv_blobs 那一列狀態，見 E29）。BOUNTY_RETIRE_ACK 等於這份清單的 generatedAt，才照常退場。
// 板上先放台鐵 200 列、高鐵 20 列。兩個門檻各釘兩端；比例要逐系統算——高鐵整個消失只佔全部的 20/220，合起來算不到一成。
// 門檻是手寫的數字，不從 worker.js 拿（同源的判準改了也一起跟著改）。
{
  const K = (sys, ln, i) => ({ segKey: `${sys}|${ln}|站${String(i).padStart(3, '0')}|站${String(i + 1).padStart(3, '0')}`, sys, trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 6 });
  const TRA = Array.from({ length: 200 }, (_, i) => K('tra_sched', '南迴線', i));
  const HSR = Array.from({ length: 20 }, (_, i) => K('thsr_sched', 'THSR', i));
  const lines = { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] },
    'thsr_sched|THSR': { sys: 'thsr_sched', lnId: 'THSR', name: 'THSR', stations: [] } };
  const fresh = () => {
    let cur = null;
    const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
      ? JSON.stringify(cur) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
    const { db, DELAY_DB } = openTestDb();
    const run = async (units, gen, ack) => {
      cur = { generatedAt: gen, schedDate: '2026-07-28', lines, units }; _bounty.bountyResetMemCaches();
      try { return await bountyValuationCron({ DELAY_DB, ASSETS, ...(ack === undefined ? {} : { BOUNTY_RETIRE_ACK: ack }) }); }
      catch (e) { return { threw: String(e && e.message) }; }
    };
    const snap = () => JSON.stringify(db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all());
    const retiredBySys = () => db.prepare('SELECT sys, SUM(retired) AS n, COUNT(*) AS m FROM bounty_board GROUP BY sys ORDER BY sys').all()
      .map(r => `${r.sys}=${r.n}/${r.m}`).join(',');
    return { run, snap, retiredBySys };
  };
  const E = /^bounty_units shrink: /;
  {
    const a = fresh(); await a.run([...TRA, ...HSR], 1);
    const ok20 = await a.run([...TRA.slice(20), ...HSR], 2);
    const b = fresh(); await b.run([...TRA, ...HSR], 1);
    const before = b.snap();
    const bad21 = await b.run([...TRA.slice(21), ...HSR], 2);
    ok('E20 比例那一端：台鐵 200 列少 20 列（剛好一成）照常退場 20；少 21 列 → 丟錯（訊息點名 tra_sched 21/200，並寫出要設的 generatedAt），整張板一列都沒動',
      ok20.retired === 20 && a.retiredBySys() === 'thsr_sched=0/20,tra_sched=20/200' &&
        E.test(bad21.threw || '') && /tra_sched 21\/200/.test(bad21.threw) && /BOUNTY_RETIRE_ACK 設成 2）/.test(bad21.threw) && b.snap() === before,
      JSON.stringify({ ok20, a: a.retiredBySys(), bad21, unchanged: b.snap() === before }));
  }
  {
    const a = fresh(); await a.run([...TRA, ...HSR], 1);
    const ok9 = await a.run([...TRA, ...HSR.slice(9)], 2);
    const b = fresh(); await b.run([...TRA, ...HSR], 1);
    const before = b.snap();
    const bad10 = await b.run([...TRA, ...HSR.slice(10)], 2);
    ok('E21 列數那一端：高鐵 20 列少 9 列（不到 10 列，雖然超過一成）照常退場 9；少 10 列 → 丟錯（thsr_sched 10/20），整張板一列都沒動',
      ok9.retired === 9 && a.retiredBySys() === 'thsr_sched=9/20,tra_sched=0/200' &&
        E.test(bad10.threw || '') && /thsr_sched 10\/20/.test(bad10.threw) && b.snap() === before,
      JSON.stringify({ ok9, a: a.retiredBySys(), bad10, unchanged: b.snap() === before }));
  }
  {
    const a = fresh(); await a.run([...TRA, ...HSR], 1);
    const before = a.snap();
    const extra = K('tra_sched', '南迴線', 500);
    const gone = await a.run([...TRA, extra], 2);
    ok('E22 比例逐系統算：高鐵 20 列整個不在清單上、台鐵完整（合起來只有 20/220）→ 丟錯（thsr_sched 20/20）；同一份清單新增的台鐵單位也沒上架',
      E.test(gone.threw || '') && /thsr_sched 20\/20/.test(gone.threw) && !/tra_sched/.test(gone.threw) && a.snap() === before,
      JSON.stringify({ gone, unchanged: a.snap() === before }));
  }
  {
    const a = fresh(); await a.run([...TRA, ...HSR], 1);
    const wrongAck = await a.run([...TRA, ...HSR.slice(10)], 2, '1');
    const acked = await a.run([...TRA.slice(100), ...HSR], 3, '3');
    const after = a.retiredBySys();
    const bad11 = await a.run([...TRA.slice(111), ...HSR], 4);
    ok('E23 BOUNTY_RETIRE_ACK：等於上一份清單的 generatedAt 不算數、照樣丟錯；等於這一份的 generatedAt → 照常退場（台鐵少 100 列、退場 100）；' +
      '下一份清單沒有 ack，現役只剩 100 列的台鐵再少 11 列 → 丟錯（tra_sched 11/100，分母不含已退場的列）',
      E.test(wrongAck.threw || '') && acked.retired === 100 && after === 'thsr_sched=0/20,tra_sched=100/200' &&
        E.test(bad11.threw || '') && /tra_sched 11\/100/.test(bad11.threw),
      JSON.stringify({ wrongAck, acked, after, bad11 }));
  }
  // E24–E26：逐線的守門。某條線（seg_key 的前兩段）這一發要退場的列至少 10 列、
  // 而且超過那條線現役列的一半，也要丟錯。台鐵另外放屏東線 20 列、平溪線 12 列：整條線消失時，台鐵合起來只少 20/232 或 12/232，
  // 系統那一道擋不到，要靠逐線那一道。
  const PT = Array.from({ length: 20 }, (_, i) => K('tra_sched', '屏東線', i));
  const PX = Array.from({ length: 12 }, (_, i) => K('tra_sched', '平溪線', i));
  const ALL = [...TRA, ...PT, ...PX, ...HSR];
  const SYS_ENTRY = /tra_sched \d/;   // 系統那一道的訊息是「tra_sched 11/232」，逐線的是「tra_sched|屏東線 11/20」
  {
    const a = fresh(); await a.run(ALL, 1);
    const ok10 = await a.run([...TRA, ...PT.slice(10), ...PX, ...HSR], 2);
    const b = fresh(); await b.run(ALL, 1);
    const before = b.snap();
    // 丟錯的那一份清單另外新增一個單位、改掉一列的 perDay（比照 E22）：守門若挪到上架之後，板上會多一列、per_day 會變，這裡才看得出來。
    // 新單位刻意放在屏東線本身（E22 放在別條線）：屏東線要退場 11 列、淨少 10 列，守門若改算淨減少就不會擋，這裡也看得出來。
    const bad11 = await b.run([...TRA.map((u, i) => i === 0 ? { ...u, perDay: 12 } : u), ...PT.slice(11), K('tra_sched', '屏東線', 500), ...PX, ...HSR], 2);
    ok('E24 逐線的比例那一端：屏東線 20 列少 10 列（剛好一半）照常退場 10；少 11 列 → 丟錯（訊息點名 tra_sched|屏東線 11/20，沒有點名整個台鐵），' +
      '整張板一列都沒動（同一份清單新增的單位沒上架、改了的 per_day 沒寫進去）',
      ok10.retired === 10 && a.retiredBySys() === 'thsr_sched=0/20,tra_sched=10/232' &&
        E.test(bad11.threw || '') && /tra_sched\|屏東線 11\/20/.test(bad11.threw) && !SYS_ENTRY.test(bad11.threw) && b.snap() === before,
      JSON.stringify({ ok10, a: a.retiredBySys(), bad11, unchanged: b.snap() === before }));
  }
  {
    const a = fresh(); await a.run(ALL, 1);
    const ok9 = await a.run([...TRA, ...PT, ...PX.slice(9), ...HSR], 2);
    const b = fresh(); await b.run(ALL, 1);
    const before = b.snap();
    const bad10 = await b.run([...TRA, ...PT, ...PX.slice(10), ...HSR], 2);
    ok('E25 逐線的列數那一端：平溪線 12 列少 9 列（不到 10 列，雖然超過一半）照常退場 9；少 10 列 → 丟錯（tra_sched|平溪線 10/12），整張板一列都沒動',
      ok9.retired === 9 && a.retiredBySys() === 'thsr_sched=0/20,tra_sched=9/232' &&
        E.test(bad10.threw || '') && /tra_sched\|平溪線 10\/12/.test(bad10.threw) && !SYS_ENTRY.test(bad10.threw) && b.snap() === before,
      JSON.stringify({ ok9, a: a.retiredBySys(), bad10, unchanged: b.snap() === before }));
  }
  {
    const a = fresh(); await a.run(ALL, 1);
    const half = await a.run([...TRA, ...PT.slice(10), ...PX, ...HSR], 2);
    const rest = await a.run([...TRA, ...PX, ...HSR], 3);
    const acked = await a.run([...TRA, ...PX, ...HSR], 3, '3');
    ok('E26 逐線的分母只算沒退場的列：屏東線先退一半（10 列），下一份清單把剩下的 10 列也拿掉 → 丟錯（tra_sched|屏東線 10/10）；' +
      '同一份清單的 ack 也放行逐線那一道（退場 10，台鐵共退 20）',
      half.retired === 10 && E.test(rest.threw || '') && /tra_sched\|屏東線 10\/10/.test(rest.threw) &&
        acked.retired === 10 && a.retiredBySys() === 'thsr_sched=0/20,tra_sched=20/232',
      JSON.stringify({ half, rest, acked, after: a.retiredBySys() }));
  }
  // E27：清單沒有 generatedAt（缺鍵或是 null）時
  // 沒有任何 ack 放得行（沒設 ack、ack 寫成 undefined 或 null 都一樣），訊息改叫人重建清單；ack 前後的空白與換行不算；寫成 3.0 不等於 3。
  {
    const a = fresh(); await a.run(ALL, 1);
    const cut = [...TRA, ...PT, ...PX, ...HSR.slice(10)];
    const noGen = await a.run(cut, undefined);
    const noGenAck = await a.run(cut, undefined, 'undefined');
    const nullGen = await a.run(cut, null);
    const nullGenAck = await a.run(cut, null, 'null');
    const spaced = await a.run(cut, 2, ' 2\n');
    const decimal = await a.run([...TRA, ...PT, ...PX], 3, '3.0');
    ok('E27 清單沒有 generatedAt（缺鍵或 null）：沒設 ack、ack 寫成 undefined／null 都丟錯，訊息叫人重建清單（不叫人設 ack）；' +
      'ack 前後有空白換行照樣放行（退場 10）；寫成 3.0 → 丟錯',
      E.test(noGen.threw || '') && /清單沒有 generatedAt/.test(noGen.threw) && !/BOUNTY_RETIRE_ACK 設成/.test(noGen.threw) &&
        E.test(noGenAck.threw || '') &&
        E.test(nullGen.threw || '') && /清單沒有 generatedAt/.test(nullGen.threw) && !/BOUNTY_RETIRE_ACK 設成/.test(nullGen.threw) &&
        E.test(nullGenAck.threw || '') &&
        spaced.retired === 10 && a.retiredBySys() === 'thsr_sched=10/20,tra_sched=0/232' &&
        E.test(decimal.threw || '') && /BOUNTY_RETIRE_ACK 設成 3）/.test(decimal.threw),
      JSON.stringify({ noGen, noGenAck, nullGen, nullGenAck, spaced, decimal, after: a.retiredBySys() }));
  }
  // E28：逐線比例的一半再釘緊一點。E24 的屏東線只有 20 列，比例放寬到 0.54 也看不出來。
  // 這裡放一條 100 列的線（山線），台鐵另外有 500 列，系統那一道碰不到（51/600 不到一成）。
  {
    const BIG = Array.from({ length: 500 }, (_, i) => K('tra_sched', '南迴線', i));
    const SHAN = Array.from({ length: 100 }, (_, i) => K('tra_sched', '山線', i));
    const a = fresh(); await a.run([...BIG, ...SHAN], 1);
    const ok50 = await a.run([...BIG, ...SHAN.slice(50)], 2);
    const b = fresh(); await b.run([...BIG, ...SHAN], 1);
    const before = b.snap();
    const bad51 = await b.run([...BIG, ...SHAN.slice(51)], 2);
    ok('E28 逐線比例的一半：100 列的線少 50 列照常退場 50；少 51 列 → 丟錯（tra_sched|山線 51/100；台鐵合起來只有 51/600），整張板一列都沒動',
      ok50.retired === 50 && a.retiredBySys() === 'tra_sched=50/600' &&
        E.test(bad51.threw || '') && /tra_sched\|山線 51\/100/.test(bad51.threw) && !SYS_ENTRY.test(bad51.threw) && b.snap() === before,
      JSON.stringify({ ok50, a: a.retiredBySys(), bad51, unchanged: b.snap() === before }));
  }
}

// E29–E46 估值的狀態：被清單的守門擋下就在 kv_blobs 留一列 bounty_retire_block（值 {at, generatedAt, msg}），
// 估值正常跑完才清掉，看板的 retireBlock 欄位把它帶出去；正常跑完同時更新另一列 bounty_valuation_ok（值 {at, generatedAt}，
// 任何丟錯的路都不寫），看板的 valuationOk 欄位把它帶出去。鍵名、欄位名、訊息都是手寫的字面值，不從 worker.js 拿。
// 板上先放台鐵 200 列、高鐵 20 列（比照 E20）；第二份清單少台鐵 21 列 → 退場守門擋下（tra_sched 21/200）。
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };   // 看板用 Workers 的 Cache API，Node 沒有
{
  const K = (sys, ln, i) => ({ segKey: `${sys}|${ln}|站${String(i).padStart(3, '0')}|站${String(i + 1).padStart(3, '0')}`, sys, trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 6 });
  const TRA = Array.from({ length: 200 }, (_, i) => K('tra_sched', '南迴線', i));
  const HSR = Array.from({ length: 20 }, (_, i) => K('thsr_sched', 'THSR', i));
  const FULL = [...TRA, ...HSR];
  const CUT = [...TRA.slice(21), ...HSR];            // 台鐵少 21 列：擋下
  const lines = { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] },
    'thsr_sched|THSR': { sys: 'thsr_sched', lnId: 'THSR', name: 'THSR', stations: [] } };
  const KEY = 'bounty_retire_block', OKKEY = 'bounty_valuation_ok';
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  // 一個全新的庫。run(清單, 這份清單的 generatedAt, env 覆寫)：丟錯就回 { threw: 訊息 }。
  // over.manifest 給了就整份取代清單檔的內容（連 null 都可以），不經過上面的 {generatedAt, schedDate, lines, units}。
  const fixture = () => {
    let cur = null;
    const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
      ? JSON.stringify(cur) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
    const { db, DELAY_DB } = openTestDb();
    const run = async (units, gen, over = {}) => {
      const { manifest, ...envOver } = over;
      cur = manifest !== undefined ? manifest : { generatedAt: gen, schedDate: '2026-07-28', lines, units }; _bounty.bountyResetMemCaches();
      try { return await bountyValuationCron({ DELAY_DB, ASSETS, ...envOver }); }
      catch (e) { return { threw: String(e && e.message) }; }
    };
    const rawOf = k => db.prepare('SELECT v, updated FROM kv_blobs WHERE k = ?').get(k);          // undefined＝沒有這一列
    const jsonOf = r => r ? JSON.parse(r.v) : null;
    const raw = () => rawOf(KEY), okRaw = () => rawOf(OKKEY);                                       // 擋下的狀態、最後一次成功
    const row = () => jsonOf(raw()), okRow = () => jsonOf(okRaw());
    const countOf = k => db.prepare('SELECT COUNT(*) c FROM kv_blobs WHERE k = ?').get(k).c;
    const nKv = () => countOf(KEY), nOk = () => countOf(OKKEY);
    const snap = () => JSON.stringify(db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all());
    return { db, DELAY_DB, ASSETS, run, raw, row, nKv, okRaw, okRow, nOk, snap };
  };
  // D1 替身：SQL 符合 re 的那一句（單句，或 batch 裡的任何一句）一律丟 'D1 注入的錯'，其餘照常。
  const INJECTED = 'D1 注入的錯';
  const failOn = (DB, re) => {
    const bad = sql => re.test(String(sql));
    const dead = sql => { const s = { _sql: sql, bind: () => s, run: async () => { throw new Error(INJECTED); }, all: async () => { throw new Error(INJECTED); }, first: async () => { throw new Error(INJECTED); } }; return s; };
    return { prepare: sql => bad(sql) ? dead(sql) : DB.prepare(sql),
      batch: async stmts => { if (stmts.some(s => bad(s._sql))) throw new Error(INJECTED); return DB.batch(stmts); },
      exec: sql => DB.exec(sql) };
  };
  // 暫時接住 console.error（回傳收到的訊息；一定還原）
  const captureErrors = async fn => {
    const seen = [], orig = console.error;
    console.error = (...x) => seen.push(x.map(String).join(' '));
    try { await fn(); } finally { console.error = orig; }
    return seen;
  };
  const board = async a => {
    const res = await _bounty.bountyBoard(new Request('https://railisland.tw/api/bounty-board'), { DELAY_DB: a.DELAY_DB, ASSETS: a.ASSETS });
    return { status: res.status, body: JSON.parse(await res.text()) };
  };

  {
    const a = fixture(); await a.run(FULL, 1);
    const before = a.row();
    const t0 = Date.now();
    const bad = await a.run(CUT, 2);
    const t1 = Date.now();
    const r = a.row();
    ok('E29 退場守門擋下 → kv_blobs 有一列 bounty_retire_block，值正好三個欄位 {at, generatedAt, msg}：generatedAt 是這份清單的 2、msg 與丟出的錯誤訊息同一句、at 落在這一發的時間窗內；擋下之前沒有這一列',
      before === null && !!r && JSON.stringify(Object.keys(r).sort()) === '["at","generatedAt","msg"]' && r.generatedAt === 2 && r.msg === bad.threw &&
        /^bounty_units shrink: .*tra_sched 21\/200/.test(r.msg) && r.at >= t0 && r.at <= t1 && a.nKv() === 1,
      JSON.stringify({ before, r, threw: bad.threw, t0, t1 }));
  }
  {
    // 清單沒有 generatedAt 有三種寫法：缺鍵、null、只有空白——一律存 null（這時沒有任何 ack 放得行，訊息叫人重建清單）
    const a = fixture(); await a.run(FULL, 1);
    const got = [];
    for (const gen of [undefined, null, '  ']) {
      const bad = await a.run(CUT, gen);
      got.push({ gen: gen === undefined ? 'undefined' : JSON.stringify(gen), threw: bad.threw, r: a.row() });
    }
    ok('E30 清單沒有 generatedAt（缺鍵、null、只有空白）擋下 → 那一列的 generatedAt 都是 null，msg 仍與丟出的錯誤訊息同一句（訊息叫人重建清單、不叫人設 ack）',
      got.every(g => !!g.r && g.r.generatedAt === null && g.r.msg === g.threw && /^bounty_units shrink: .*清單沒有 generatedAt/.test(g.r.msg) && !/BOUNTY_RETIRE_ACK 設成/.test(g.r.msg)),
      JSON.stringify(got));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    const before = a.snap();
    const bad = await a.run([], 3);
    const r = a.row();
    // 整份清單檔只有 {units: []}、連 generatedAt 都沒有：存 null，msg 仍是空清單那一句
    const b = fixture(); await b.run(FULL, 1);
    const badNoGen = await b.run(null, undefined, { manifest: { units: [] } });
    const rNoGen = b.row();
    ok('E31 清單是空的 → 丟 bounty_units empty，kv_blobs 有一列：generatedAt 是這份清單的 3、msg 就是那一句；板上一列都沒動；' +
      '整份清單只有 {units: []}（沒有 generatedAt）→ 那一列的 generatedAt 是 null、msg 仍是那一句',
      bad.threw === 'bounty_units empty' && !!r && r.generatedAt === 3 && r.msg === 'bounty_units empty' && a.nKv() === 1 && a.snap() === before &&
        badNoGen.threw === 'bounty_units empty' && !!rNoGen && JSON.stringify(Object.keys(rNoGen).sort()) === '["at","generatedAt","msg"]' &&
        rNoGen.generatedAt === null && rNoGen.msg === 'bounty_units empty' && b.nKv() === 1,
      JSON.stringify({ bad, r, badNoGen, rNoGen }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    const b1 = await a.run(CUT, 2);
    const r1 = a.row();
    await new Promise(res => setTimeout(res, 5));          // 讓第二發的時間戳一定比第一發大
    const b2 = await a.run([...TRA.slice(22), ...HSR], 3);
    const r2 = a.row();
    ok('E32 連續兩發都被擋 → 還是一列，值是第二發的（generatedAt 3、msg 點名 tra_sched 22/200、at 比第一發晚）',
      !!r1 && !!r2 && a.nKv() === 1 && r1.generatedAt === 2 && r2.generatedAt === 3 && r2.msg === b2.threw && r1.msg === b1.threw &&
        /tra_sched 22\/200/.test(r2.msg) && r2.at > r1.at,
      JSON.stringify({ r1, r2 }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    // 別的 kv_blobs 列（判定的出錯記錄、統計 blob）：清除只准動 bounty_retire_block 那一列
    const put = a.db.prepare("INSERT INTO kv_blobs (k, v, updated) VALUES (?, ?, 'x')");
    put.run('bounty_verify_strike|device-aaaa|2026-07-28|123', '{"n":1}'); put.run('tra_delay_stats_30d', '{"a":1}');
    await a.run(CUT, 2);
    const blocked = a.nKv() === 1;
    const done = await a.run(FULL, 4);
    // 別的列＝除了這兩列（擋下的狀態、最後一次成功）以外的所有列
    const others = a.db.prepare("SELECT k, v FROM kv_blobs WHERE k NOT IN ('bounty_retire_block', 'bounty_valuation_ok') ORDER BY k").all();
    // 對照：從沒擋過的庫，跑完不會憑空冒出擋下的那一列（庫裡只有「最後一次成功」那一列）
    const c = fixture(); await c.run(FULL, 1); await c.run(FULL, 1);
    ok('E33 估值正常跑完 → 擋下的那一列清掉，別的 kv_blobs 列（判定的出錯記錄、統計 blob）原封不動；從沒擋過的庫跑完也不會冒出擋下的那一列（庫裡只有最後一次成功那一列）',
      blocked && done.threw === undefined && done.retired === 0 && done.updated === 220 && a.nKv() === 0 &&
        JSON.stringify(others) === JSON.stringify([{ k: 'bounty_verify_strike|device-aaaa|2026-07-28|123', v: '{"n":1}' }, { k: 'tra_delay_stats_30d', v: '{"a":1}' }]) &&
        c.nKv() === 0 && c.nOk() === 1 && c.db.prepare('SELECT COUNT(*) c FROM kv_blobs').get().c === 1,
      JSON.stringify({ blocked, done, others, c: [c.nKv(), c.nOk()] }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    const bad = await a.run(CUT, 2);
    const had = a.nKv() === 1;
    const acked = await a.run(CUT, 2, { BOUNTY_RETIRE_ACK: '2' });
    ok('E34 設了 BOUNTY_RETIRE_ACK（等於這份清單的 generatedAt）放行 → 照常退場 21 列、跑完，擋下的那一列也清掉，最後一次成功記成這一發（generatedAt 2）',
      had && /^bounty_units shrink: /.test(bad.threw || '') && acked.threw === undefined && acked.retired === 21 && a.nKv() === 0 &&
        !!a.okRow() && a.okRow().generatedAt === 2,
      JSON.stringify({ had, bad, acked, n: a.nKv(), ok: a.okRow() }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    const before = a.snap();
    let bad, empty;
    const errs = await captureErrors(async () => {
      bad = await a.run(CUT, 2, { DELAY_DB: failOn(a.DELAY_DB, /kv_blobs/) });
      empty = await a.run([], 3, { DELAY_DB: failOn(a.DELAY_DB, /kv_blobs/) });
    });
    ok('E35 kv_blobs 寫入丟錯 → 丟出來的仍是擋下的原因（退場守門、清單是空的），不是寫入的錯；寫入失敗各印一行 error；板上一列都沒動、kv_blobs 沒有這一列',
      /^bounty_units shrink: .*tra_sched 21\/200/.test(bad.threw || '') && empty.threw === 'bounty_units empty' &&
        errs.length === 2 && errs.every(e => /kv_blobs/.test(e) && e.includes(INJECTED)) && a.snap() === before && a.nKv() === 0,
      JSON.stringify({ bad, empty, errs: errs.map(e => e.slice(0, 80)) }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    await a.run(CUT, 2);
    const kept = a.raw();
    const same = () => { const r = a.raw(); return !!r && !!kept && r.v === kept.v && r.updated === kept.updated; };
    // 早：清單檔讀不到（ASSETS 回 500），守門之前就丟錯
    const early = await a.run(FULL, 4, { ASSETS: { fetch: async () => new Response('x', { status: 500 }) } });
    const sameEarly = same();
    // 晚：守門過了、上架與退場都做完，最後重算那一句才失敗（D1 錯誤）
    const late = await a.run(FULL, 4, { DELAY_DB: failOn(a.DELAY_DB, /UPDATE bounty_board SET l1=\?, l2=\?/) });
    ok('E36 丟錯但不是被守門擋下（清單檔讀不到；守門過了、最後重算那一句 D1 失敗）→ 那一列原封不動（值與 updated 都沒變）：只有正常 return 的那條路才清',
      /^bounty_units unavailable: 500/.test(early.threw || '') && sameEarly && late.threw === INJECTED && same(),
      JSON.stringify({ early, sameEarly, late, same: same() }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    await a.run(CUT, 2);
    const kept = a.raw(), keptOk = a.okRaw();
    let r;
    const errs = await captureErrors(async () => { r = await a.run(FULL, 4, { DELAY_DB: failOn(a.DELAY_DB, /DELETE FROM kv_blobs/) }); });
    const stillThere = !!a.raw() && a.raw().v === kept.v;
    const okSame = !!a.okRaw() && a.okRaw().v === keptOk.v && a.okRaw().updated === keptOk.updated;
    const again = await a.run(FULL, 4);
    ok('E37 清除那一句失敗 → 估值本身已跑完，這一發照樣正常回報（不丟錯、重算 220 列），印一行 error，擋下的那一列留著、最後一次成功也沒被更新（兩句同一次 batch）；' +
      '下一次正常跑完才清掉、更新成這一發（generatedAt 4）',
      r.threw === undefined && r.updated === 220 && errs.length === 1 && /kv_blobs|擋下/.test(errs[0]) && errs[0].includes(INJECTED) && stillThere && okSame &&
        again.threw === undefined && a.nKv() === 0 && !!a.okRow() && a.okRow().generatedAt === 4,
      JSON.stringify({ r, errs: errs.map(e => e.slice(0, 80)), stillThere, okSame, n: a.nKv(), ok: a.okRow() }));
  }
  {
    const a = fixture(); await a.run(FULL, 1);
    const b0 = await board(a);
    const bad = await a.run(CUT, 2);
    const b1 = await board(a);
    await a.run(FULL, 4);
    const b2 = await board(a);
    const rb = b1.body.retireBlock;
    const keys = o => JSON.stringify(Object.keys(o || {}).sort());
    // valuationOk 跟著同一條路：第一次成功之後是 {at, generatedAt: 1}；被擋下的那一發不動它（與第一次成功完全相同）；下一次正常跑完才換成 generatedAt 4
    const v0 = b0.body.valuationOk, v1 = b1.body.valuationOk, v2 = b2.body.valuationOk;
    ok('E38 看板的 retireBlock 與 valuationOk：沒擋過＝retireBlock null（欄位在）、valuationOk＝{at, generatedAt 1}；擋下後 retireBlock 是 {at, generatedAt, msg}（msg 與丟出的錯誤訊息同一句）、' +
      'valuationOk 不動（與第一次成功完全相同）；估值正常跑完之後 retireBlock 回到 null、valuationOk 換成 generatedAt 4（at 不早於前一次）；三次都是 200 且照常帶 cards',
      b0.status === 200 && 'retireBlock' in b0.body && b0.body.retireBlock === null &&
        b1.status === 200 && !!rb && rb.msg === bad.threw && rb.generatedAt === 2 && typeof rb.at === 'number' && rb.at > 0 &&
        b2.status === 200 && 'retireBlock' in b2.body && b2.body.retireBlock === null &&
        keys(v0) === '["at","generatedAt"]' && v0.generatedAt === 1 && typeof v0.at === 'number' && v0.at > 0 &&
        JSON.stringify(v1) === JSON.stringify(v0) &&
        keys(v2) === '["at","generatedAt"]' && v2.generatedAt === 4 && v2.at >= v0.at &&
        [b0, b1, b2].every(b => Array.isArray(b.body.cards) && b.body.cards.length > 0),
      JSON.stringify({ b0: b0.body.retireBlock, rb, b2: b2.body.retireBlock, v0, v1, v2, cards: [b0, b1, b2].map(b => b.body.cards && b.body.cards.length) }));
  }
  {
    // 子請求計數：寫入、清除都走傳進來的 env，所以算進同一個計數器。測試端在計數器下面自己數一份（first／run／all 各 1、batch 整批 1、fetch 1），
    // 兩邊的總數要一樣。擋下那一發恰一句 kv_blobs（單句寫入）；成功那一發是一次 batch、裡面恰兩句 kv_blobs（清除擋下的狀態＋記下這一次成功），整批只算一個子請求。
    const a = fixture(); await a.run(FULL, 1);
    const t = { n: 0, kv: 0, kvBatch: 0 };
    const isKv = st => /kv_blobs/.test(st._sql);
    const wrap = st => ({ _inner: st, _sql: st._sql, bind: (...x) => wrap(st.bind(...x)),
      first: (...x) => { t.n++; if (isKv(st)) t.kv++; return st.first(...x); },
      run: (...x) => { t.n++; if (isKv(st)) t.kv++; return st.run(...x); },
      all: (...x) => { t.n++; if (isKv(st)) t.kv++; return st.all(...x); } });
    const db = { prepare: sql => wrap(a.DELAY_DB.prepare(sql)),
      batch: async stmts => { t.n++; t.kvBatch += stmts.filter(isKv).length; return a.DELAY_DB.batch(stmts.map(s => s._inner || s)); },
      exec: async sql => { t.n++; return a.DELAY_DB.exec(sql); } };
    const assets = { fetch: (...x) => { t.n++; return a.ASSETS.fetch(...x); } };
    const cenv = _bounty.bountyCounted({ DELAY_DB: db, ASSETS: assets });
    const ctr = cenv.__bountySubreq;
    const bad = await a.run(CUT, 2, { DELAY_DB: cenv.DELAY_DB, ASSETS: cenv.ASSETS });
    const kvBlocked = t.kv, kvBatchBlocked = t.kvBatch, nBlocked = t.n, cBlocked = ctr.n;
    t.kv = 0; t.kvBatch = 0;
    const done = await a.run(FULL, 4, { DELAY_DB: cenv.DELAY_DB, ASSETS: cenv.ASSETS });
    ok('E39 擋下那一發的 kv_blobs 句子（恰一句）與成功那一發的（一次 batch、裡面恰兩句）都算進子請求計數器（計數器＝測試端獨立計數，batch 整批算一個）',
      /^bounty_units shrink: /.test(bad.threw || '') && done.threw === undefined && kvBlocked === 1 && kvBatchBlocked === 0 && t.kv === 0 && t.kvBatch === 2 &&
        nBlocked > 0 && cBlocked === nBlocked && ctr.n === t.n && t.n > nBlocked,
      JSON.stringify({ kvBlocked, kvBatchBlocked, kvDone: t.kv, kvBatchDone: t.kvBatch, afterBlocked: [cBlocked, nBlocked], afterDone: [ctr.n, t.n] }));
  }

  // E40–E46 估值正常跑完另記的「最後一次成功」（bounty_valuation_ok）：什麼時候寫、什麼時候絕不寫、寫的時候有沒有等到（await）、寫失敗怎麼辦。
  {
    const a = fixture();
    const t0 = Date.now();
    const r1 = await a.run(FULL, 1);
    const t1 = Date.now();
    const v1 = a.okRow();
    await sleep(5);                                       // 第二發的時間戳一定比第一發大
    const r2 = await a.run(FULL, 7);
    const v2 = a.okRow();
    // generatedAt 是這份清單的原值：數字還是數字、字串還是字串；沒有（缺鍵、null、只有空白）就存 null
    const gens = [];
    for (const g of [undefined, null, '  ', 'v-2026-10-01', 7]) {
      const f = fixture(); await f.run(FULL, g);
      gens.push(f.okRow() && f.okRow().generatedAt);
    }
    ok('E40 估值正常跑完 → kv_blobs 有一列 bounty_valuation_ok，值正好兩個欄位 {at, generatedAt}：generatedAt 是這份清單的原值（數字還是數字、字串還是字串；缺鍵、null、只有空白都存 null）、' +
      'at 落在這一發的時間窗內、沒有擋下的那一列；再跑一發 → 還是一列、換成這一發的值',
      r1.threw === undefined && !!v1 && JSON.stringify(Object.keys(v1).sort()) === '["at","generatedAt"]' && v1.generatedAt === 1 &&
        v1.at >= t0 && v1.at <= t1 && a.nOk() === 1 && a.nKv() === 0 &&
        r2.threw === undefined && !!v2 && v2.generatedAt === 7 && v2.at > v1.at && a.nOk() === 1 &&
        JSON.stringify(gens) === JSON.stringify([null, null, null, 'v-2026-10-01', 7]),
      JSON.stringify({ r1, v1, v2, window: [t0, t1], gens, nOk: a.nOk() }));
  }
  {
    // 丟錯的路都不准記成功：先跑一發正常的（有這一列），再各自走一條會丟錯的路，那一列的值與 updated 都不准動；
    // 對照：從沒成功過的庫（把那一列拿掉）走同一條路，也不准冒出這一列。八條路都要真的丟出該丟的錯（路沒走到、靠「沒寫」過關的假綠不算）。
    const RULES_TEXT = readFileSync('data/bounty_rules.json', 'utf8');
    const rulesBad = JSON.parse(RULES_TEXT); rulesBad.dwellReward.coveredMultiplier = 0;
    const manifestText = JSON.stringify({ generatedAt: 9, schedDate: '2026-07-28', lines, units: FULL });
    // 清單檔與規則檔各自回什麼：o.units／o.rules 是整份檔的文字，狀態碼另給
    const assets = (o = {}) => ({ fetch: async r => String(r.url).includes('bounty_units')
      ? new Response(o.units ?? manifestText, { status: o.unitsStatus ?? 200 })
      : new Response(o.rules ?? RULES_TEXT, { status: o.rulesStatus ?? 200 }) });
    const paths = [
      ['清單檔讀不到（HTTP 500）', a => a.run(FULL, 9, { ASSETS: assets({ unitsStatus: 500 }) }), /^bounty_units unavailable: 500/],
      ['清單檔不是 JSON', a => a.run(FULL, 9, { ASSETS: assets({ units: 'not json' }) }), /JSON|Unexpected/],
      ['清單檔的內容是 null', a => a.run(FULL, 9, { ASSETS: assets({ units: 'null' }) }), /null/],
      ['規則檔讀不到（HTTP 500）', a => a.run(FULL, 9, { ASSETS: assets({ rulesStatus: 500 }) }), /^bounty_rules unavailable: 500/],
      ['規則檔內容無效（dwellReward.coveredMultiplier 是 0）', a => a.run(FULL, 9, { ASSETS: assets({ rules: JSON.stringify(rulesBad) }) }), /^invalid bounty rule: dwellReward\.coveredMultiplier/],
      ['清單是空的（守門）', a => a.run([], 9), /^bounty_units empty$/],
      ['退場守門擋下', a => a.run(CUT, 9), /^bounty_units shrink: /],
      ['守門過了、最後重算那一句 D1 失敗', a => a.run(FULL, 9, { DELAY_DB: failOn(a.DELAY_DB, /UPDATE bounty_board SET l1=\?, l2=\?/) }), new RegExp(INJECTED)],
    ];
    const rows = [];
    for (const [label, go, re] of paths) {
      const a = fixture(); await a.run(FULL, 1);
      const kept = a.okRaw();
      await sleep(5);                                     // 這一發的時間戳一定比第一發大：寫了就看得出來
      const res = await go(a);
      const same = !!kept && !!a.okRaw() && a.okRaw().v === kept.v && a.okRaw().updated === kept.updated;
      const c = fixture(); await c.run(FULL, 1);
      c.db.prepare('DELETE FROM kv_blobs WHERE k = ?').run(OKKEY);                // 從沒成功過的庫
      const resC = await go(c);
      rows.push({ label, threw: re.test(res.threw || '') && re.test(resC.threw || ''), same, none: c.nOk() === 0 });
    }
    ok('E41 八條丟錯的路（清單檔讀不到／不是 JSON／是 null、規則檔讀不到／內容無效、清單是空的、退場守門、最後重算失敗）都不記成功：' +
      '有成功紀錄的庫，那一列的值與 updated 原封不動；從沒成功過的庫，不會冒出這一列；每一條路都真的丟出該丟的錯',
      rows.length === 8 && rows.every(r => r.threw && r.same && r.none),
      JSON.stringify(rows.filter(r => !(r.threw && r.same && r.none)).concat([{ n: rows.length }])));
  }
  // E42–E44 漏寫 await 的判準。d1_local 是同步執行的：寫入或清除漏了 await，D1 替身照樣當場做完，判準看不出來。
  // 這裡包一層替身，讓碰 kv_blobs 的寫入（單句的 run、含 kv_blobs 的 batch）延到下一個 macrotask 才真的做：
  // 漏了 await，丟錯或回傳的那一刻，寫入還沒發生。
  const deferKv = DB => {
    const isKv = st => /kv_blobs/.test(st._sql);
    const later = fn => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 0));
    const wrap = st => ({ _inner: st, _sql: st._sql, bind: (...x) => wrap(st.bind(...x)),
      run: (...x) => isKv(st) ? later(() => st.run(...x)) : st.run(...x),
      all: (...x) => isKv(st) ? later(() => st.all(...x)) : st.all(...x),
      first: (...x) => isKv(st) ? later(() => st.first(...x)) : st.first(...x) });
    return { prepare: sql => wrap(DB.prepare(sql)),
      batch: stmts => stmts.some(isKv) ? later(() => DB.batch(stmts.map(s => s._inner || s))) : DB.batch(stmts.map(s => s._inner || s)),
      exec: sql => DB.exec(sql) };
  };
  {
    // 擋下那一刻（兩處守門各一格）：丟出擋下的錯、回到這裡的當下（只過了微任務，還沒經過任何 macrotask），bounty_retire_block 已經寫進去
    const out = [];
    for (const [label, units, gen] of [['退場守門', CUT, 2], ['清單是空的', [], 3]]) {
      const a = fixture(); await a.run(FULL, 1);
      const bad = await a.run(units, gen, { DELAY_DB: deferKv(a.DELAY_DB) });
      const atThrow = a.row();
      await sleep(20);                                    // 漏掉的寫入（如果有）之後才落地，讓它落完，別污染下一格
      out.push({ label, threw: bad.threw, atThrow, ok: !!bad.threw && !!atThrow && atThrow.msg === bad.threw && atThrow.generatedAt === gen });
    }
    ok('E42 擋下那一刻（寫入延到下一個 macrotask 的 D1 替身；退場守門、清單是空的各一格）：丟出擋下的錯的當下，bounty_retire_block 已經寫進去（msg 與錯誤訊息同一句）——寫入有 await',
      out.length === 2 && out.every(o => o.ok), JSON.stringify(out));
  }
  {
    // 成功那一刻：先擋下一發（有 bounty_retire_block），換正常清單再跑；估值回傳的當下，擋下的那一列已經不在、最後一次成功已經是這一發
    const a = fixture(); await a.run(FULL, 1);
    await a.run(CUT, 2);
    const hadBlock = a.nKv() === 1, okBefore = a.okRow();
    const done = await a.run(FULL, 4, { DELAY_DB: deferKv(a.DELAY_DB) });
    const atReturn = { block: a.nKv(), ok: a.okRow() };
    await sleep(20);
    ok('E43 成功那一刻（寫入延到下一個 macrotask 的 D1 替身）：估值回傳的當下，擋下的那一列已經不在、最後一次成功已經是這一發（generatedAt 4）——清除與記成功都有 await',
      hadBlock && !!okBefore && okBefore.generatedAt === 1 && done.threw === undefined && done.updated === 220 &&
        atReturn.block === 0 && !!atReturn.ok && atReturn.ok.generatedAt === 4,
      JSON.stringify({ hadBlock, okBefore, done, atReturn }));
  }
  {
    // 對照（替身自己要有牙）：沒 await 的單句 run 與含 kv_blobs 的 batch，在當下（微任務都跑完）讀不到，await 之後才讀得到——否則 E42、E43 抓不到漏寫的 await
    const a = fixture();
    const d = deferKv(a.DELAY_DB);
    const n = k => a.db.prepare('SELECT COUNT(*) c FROM kv_blobs WHERE k = ?').get(k).c;
    const ins = "INSERT INTO kv_blobs (k, v, updated) VALUES (?, '{}', 'x')";
    const p1 = d.prepare(ins).bind('probe-run').run();
    const p2 = d.batch([d.prepare(ins).bind('probe-batch')]);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const now0 = [n('probe-run'), n('probe-batch')];
    await Promise.all([p1, p2]);
    const now1 = [n('probe-run'), n('probe-batch')];
    ok('E44 [對照] 延遲寫入的 D1 替身有牙：沒 await 的單句 run 與含 kv_blobs 的 batch，當下讀不到（0, 0），await 之後才讀得到（1, 1）',
      now0.join() === '0,0' && now1.join() === '1,1', JSON.stringify({ now0, now1 }));
  }
  {
    // 記成功與清除擋下的狀態是同一次 batch（一起成功或一起失敗）：第二句（記成功）在交易裡才失敗——寫 bounty_valuation_ok 時 trigger 丟錯——
    // 擋下的那一列也要跟著回滾、還在（清除若是獨立的一句，這時已經被刪掉了）。估值本身已經跑完，這一發照樣正常回報、印一行 error；
    // 拿掉 trigger 之後下一次正常跑完，兩列才一起更新。
    const a = fixture(); await a.run(FULL, 1);
    await a.run(CUT, 2);
    const keptBlock = a.raw(), keptOk = a.okRaw();
    a.db.exec("CREATE TRIGGER t_refuse_ok BEFORE INSERT ON kv_blobs WHEN NEW.k = 'bounty_valuation_ok' BEGIN SELECT RAISE(ABORT, 'ok 寫入被拒'); END");
    let r;
    const errs = await captureErrors(async () => { r = await a.run(FULL, 4); });
    const rolledBack = !!a.raw() && a.raw().v === keptBlock.v && !!a.okRaw() && a.okRaw().v === keptOk.v && a.okRaw().updated === keptOk.updated;
    a.db.exec('DROP TRIGGER t_refuse_ok');
    const again = await a.run(FULL, 4);
    ok('E45 記成功那一句在交易裡失敗 → 清除擋下狀態的那一句跟著回滾（擋下的那一列還在、最後一次成功沒動）；估值本身已跑完，這一發照樣正常回報（不丟錯、重算 220 列）、印一行 error；' +
      '下一次正常跑完，擋下的那一列清掉、最後一次成功換成這一發（generatedAt 4）',
      r.threw === undefined && r.updated === 220 && errs.length === 1 && errs[0].includes('ok 寫入被拒') && rolledBack &&
        again.threw === undefined && a.nKv() === 0 && !!a.okRow() && a.okRow().generatedAt === 4,
      JSON.stringify({ r, errs: errs.map(e => e.slice(0, 80)), rolledBack, again: [again.threw, a.nKv(), a.okRow()] }));
  }
  {
    // 看板的真實回應餵給 verdict（欄位名真的要對上，不是只對手寫的 body）：從沒跑過估值＝bad（還沒有成功）；跑完＝ok；
    // 被守門擋下＝bad（帶擋下的原因）；成功之後超過門檻沒再跑＝bad、剛好等於門檻＝ok
    const V = bountyRetireVerdict, T = BOUNTY_VALUATION_MAX_AGE_MS;
    const a = fixture();
    const never = await board(a);
    await a.run(FULL, 1);
    const fresh = await board(a);
    const at = fresh.body.valuationOk && fresh.body.valuationOk.at;
    await a.run(CUT, 2);
    const blocked = await board(a);
    const vNever = V(never.status, never.body, Date.now());
    const vFresh = V(fresh.status, fresh.body, at + 3600e3);
    const vEdge = V(fresh.status, fresh.body, at + T), vOver = V(fresh.status, fresh.body, at + T + 1);
    const vBlocked = V(blocked.status, blocked.body, at + 3600e3);
    ok('E46 看板的真實回應餵 verdict：從沒跑過估值（retireBlock null、valuationOk null）→ bad；成功跑完 → ok；成功之後剛好等於門檻 → ok、多 1 毫秒 → bad；被守門擋下 → bad（帶擋下的原因）',
      never.body.retireBlock === null && never.body.valuationOk === null && vNever.level === 'bad' && /還沒有任何一次成功/.test(vNever.line) &&
        typeof at === 'number' && vFresh.level === 'ok' && vEdge.level === 'ok' && vOver.level === 'bad' &&
        vBlocked.level === 'bad' && vBlocked.line.includes(blocked.body.retireBlock.msg),
      JSON.stringify({ vNever, vFresh, vEdge: vEdge.level, vOver: vOver.level, vBlocked: vBlocked.level }));
  }
}

// G1–G16 verdict 純函式（scripts/lib/bounty_retire_verdict.mjs，預備給每小時的巡檢 import，巡檢還沒接上）：
// 輸入 HTTP 狀態碼、解析後的 body 與現在的毫秒時間戳，輸出 { level, line }。
// 台北時間的期望值手算：2026-10-01 16:30 UTC ＝ 台北 2026-10-02 00:30（跨了日，UTC 的日期與台北的日期不同，轉錯時區會看出來）；
// 2026-10-02 03:15 UTC ＝ 台北 2026-10-02 11:15。門檻的毫秒數從匯出的常數取（邊界的比較方向要釘死），常數本身的合理範圍另有一條（G16）。
{
  const HOUR = 3600e3, T = BOUNTY_VALUATION_MAX_AGE_MS;
  const AT = Date.UTC(2026, 9, 1, 16, 30);                     // 擋下的時間
  const OKAT = Date.UTC(2026, 9, 2, 3, 15);                    // 最後一次成功
  const NOW = OKAT + 3 * HOUR;                                 // 成功之後 3 小時
  const MSG = 'bounty_units shrink: tra_sched 21/200（確認是真的換班表，就把 BOUNTY_RETIRE_ACK 設成 1790758089689）';
  const V = bountyRetireVerdict;
  const OKV = { at: OKAT, generatedAt: 1790758089689 };
  const BLOCK = { at: AT, generatedAt: 1790758089689, msg: MSG };
  const body = (over = {}) => ({ at: NOW, cards: [], retireBlock: null, valuationOk: OKV, ...over });
  const levelOf = (st, b, now) => { try { return V(st, b, now).level; } catch (e) { return 'threw ' + e.message; } };

  const good = V(200, body(), NOW);
  ok('G1 200、retireBlock 是 null、valuationOk 是 3 小時前的物件 → ok：line 帶最後一次成功的台北時間 2026-10-02 11:15（不是 UTC 的 03:15）與 3.0 小時前',
    good.level === 'ok' && good.line.includes('2026-10-02 11:15') && !good.line.includes('2026-10-02 03:15') && good.line.includes('3.0 小時'), JSON.stringify(good));
  const bad = V(200, body({ retireBlock: BLOCK }), NOW);
  ok('G2 200 且 retireBlock 是物件（valuationOk 也是物件）→ bad：line 帶擋下的台北時間 2026-10-02 00:30（不是 UTC 的 10-01 16:30）、generatedAt、擋下的原因（msg）',
    bad.level === 'bad' && bad.line.includes('2026-10-02 00:30') && !bad.line.includes('2026-10-01 16:30') && bad.line.includes('1790758089689') && bad.line.includes(MSG),
    JSON.stringify(bad));
  const noGen = V(200, body({ retireBlock: { at: AT, generatedAt: null, msg: 'bounty_units empty' } }), NOW);
  ok('G3 擋下的那份清單沒有 generatedAt（null）→ 仍是 bad，line 寫「清單沒有 generatedAt」，不印出 null 或 undefined', noGen.level === 'bad' && /清單沒有 generatedAt/.test(noGen.line) &&
    noGen.line.includes('bounty_units empty') && !/null|undefined/.test(noGen.line), JSON.stringify(noGen));
  const miss = [{ valuationOk: OKV }, { retireBlock: null }, { retireBlock: undefined, valuationOk: undefined }, { at: 1, cards: [] }]
    .map(b => V(200, b, NOW));
  ok('G4 200 但缺 retireBlock、或缺 valuationOk（舊版伺服器只有 retireBlock）、或兩個都缺 → unknown（不知道，不是正常）；line 說「沒有 … 欄位」並只點名缺的欄位（與「欄位的型別不認得」是兩種不同的說法）',
    miss.every(r => r.level === 'unknown') && /沒有 retireBlock 欄位/.test(miss[0].line) && !/valuationOk/.test(miss[0].line) &&
      /沒有 valuationOk 欄位/.test(miss[1].line) && !/retireBlock/.test(miss[1].line) &&
      /沒有 retireBlock、valuationOk 欄位/.test(miss[2].line) && /沒有 retireBlock、valuationOk 欄位/.test(miss[3].line),
    JSON.stringify(miss));
  const edge = [null, undefined, 'x', 0, [], {}].map(b => { try { return V(200, b, NOW); } catch (e) { return { level: 'threw ' + e.message, line: '' }; } });
  ok('G5 200 但 body 是 null（解析失敗）、undefined、字串、數字、陣列 → unknown，line 說「不是 JSON 物件」；空物件 → unknown，line 說沒有兩個欄位；一律不丟例外',
    edge.every(r => r.level === 'unknown') && edge.slice(0, 5).every(r => /不是 JSON 物件/.test(r.line) && !/欄位/.test(r.line)) &&
      /沒有 retireBlock、valuationOk 欄位/.test(edge[5].line) && !/不是 JSON 物件/.test(edge[5].line),
    JSON.stringify(edge));
  const na = [V(503, { error: 'not_ready' }, NOW), V(404, null, NOW), V(null, null, NOW), V(503, body(), NOW), V(500, body({ retireBlock: BLOCK }), NOW)];
  ok('G6 非 200 → n/a，line 寫「看板沒有正常回應」並帶狀態碼（503、404、沒有狀態碼）；非 200 時就算 body 長得完全正常、或長得像被擋下，也不能判 ok 或 bad',
    na.every(r => r.level === 'n/a' && /看板沒有正常回應/.test(r.line)) && na[0].line.includes('HTTP 503') && na[1].line.includes('HTTP 404') && /沒有狀態碼/.test(na[2].line) &&
      na[3].line.includes('HTTP 503') && na[4].line.includes('HTTP 500'),
    JSON.stringify(na));
  const oddBlock = ['', 'x', 0, false, 7, []].map(retireBlock => levelOf(200, body({ retireBlock }), NOW));
  const oddOk = ['', 'x', 0, false, 7].map(valuationOk => levelOf(200, body({ valuationOk }), NOW));
  ok('G7 retireBlock 或 valuationOk 不是 null 也不是物件（空字串、字串、數字、false、7、retireBlock 還有陣列）→ 一律 unknown，不是 ok 也不是 bad',
    oddBlock.every(l => l === 'unknown') && oddOk.every(l => l === 'unknown'), JSON.stringify({ oddBlock, oddOk }));
  const noAt = [{ generatedAt: 5, msg: 'm' }, { at: 'abc', generatedAt: 5, msg: 'm' }, { at: NaN, msg: 'm' }, { at: 1e20, msg: 'm' }].map(retireBlock => {
    try { const r = V(200, body({ retireBlock }), NOW); return { level: r.level, hasWhen: /時間不明/.test(r.line), hasMsg: r.line.includes('；m。') }; } catch (e) { return { threw: e.message }; }
  });
  ok('G8 擋下的物件缺 at（或 at 不是有效的毫秒數）→ 仍是 bad，line 寫「時間不明」並保留訊息，不丟例外', noAt.every(r => r.level === 'bad' && r.hasWhen && r.hasMsg), JSON.stringify(noAt));

  const never = V(200, body({ valuationOk: null }), NOW);
  ok('G9 valuationOk 是 null（從沒成功過）、retireBlock 也是 null → bad，line 寫「還沒有任何一次成功」；不是 ok（沒被擋下不等於估值正常）',
    never.level === 'bad' && /還沒有任何一次成功/.test(never.line), JSON.stringify(never));
  const badAt = [{}, { generatedAt: 5 }, { at: null }, { at: 'abc' }, { at: '1790758089689' }, { at: NaN }, { at: 1e20 }, { at: [OKAT] }].map(valuationOk => {
    try { const r = V(200, body({ valuationOk }), NOW); return { level: r.level, hasWhen: /時間不明/.test(r.line) }; } catch (e) { return { threw: e.message }; }
  });
  ok('G10 valuationOk 是物件但 at 無效（缺、null、字串、數字字串、NaN、超出範圍、陣列）→ bad，line 寫「時間不明」，不丟例外；不是 ok',
    badAt.every(r => r.level === 'bad' && r.hasWhen), JSON.stringify(badAt));
  const stale = V(200, body(), OKAT + 30 * HOUR);
  ok('G11 最後一次成功是 30 小時前（超過門檻）→ bad：line 帶最後一次成功的台北時間 2026-10-02 11:15 與已經過了 30.0 小時',
    stale.level === 'bad' && stale.line.includes('2026-10-02 11:15') && stale.line.includes('30.0 小時') && !stale.line.includes('2026-10-02 03:15'), JSON.stringify(stale));
  const edges = [T - 1, T, T + 1].map(age => levelOf(200, body(), OKAT + age));
  ok('G12 門檻的邊界：成功之後過了「門檻少 1 毫秒」→ ok、「剛好等於門檻」→ ok、「門檻多 1 毫秒」→ bad', JSON.stringify(edges) === '["ok","ok","bad"]', JSON.stringify(edges));
  const arr = [[], [OKV], [OKAT]].map(valuationOk => levelOf(200, body({ valuationOk }), NOW));
  ok('G13 valuationOk 是陣列（空陣列、裝著正常物件的陣列、裝著時間戳的陣列）→ unknown：陣列不是物件，不能當成「at 無效」或「正常」', arr.every(l => l === 'unknown'), JSON.stringify(arr));
  const both = [
    V(200, body({ retireBlock: BLOCK }), NOW),                                  // 兩個都是物件、valuationOk 新鮮
    V(200, body({ retireBlock: BLOCK }), OKAT + 30 * HOUR),                     // 兩個都是物件、valuationOk 也太久
    V(200, body({ retireBlock: BLOCK, valuationOk: { at: 'x' } }), NOW),        // 兩個都是物件、valuationOk 的 at 無效
    V(200, body({ retireBlock: BLOCK, valuationOk: null }), NOW),               // retireBlock 是物件、valuationOk 是 null
  ];
  ok('G14 retireBlock 是物件（不論 valuationOk 新鮮、太久、at 無效、還是 null）→ 一律 bad，line 帶擋下的原因（msg）', both.every(r => r.level === 'bad' && r.line.includes(MSG)), JSON.stringify(both));
  const noNow = [undefined, null, NaN, Infinity, 'x', '1790758089689'].map(now => V(200, body(), now));
  ok('G15 沒傳 now（或不是有限的數字）→ 新鮮度判不了，unknown 而不是 ok（舊的兩個參數的呼叫方式不能悄悄放行）；retireBlock 是物件或 valuationOk 是 null 這種用不到 now 的 bad 照判；非 200 照判 n/a',
    noNow.every(r => r.level === 'unknown' && /沒有現在的時間/.test(r.line)) &&
      levelOf(200, body({ retireBlock: BLOCK }), undefined) === 'bad' && levelOf(200, body({ valuationOk: null }), undefined) === 'bad' && levelOf(503, body(), undefined) === 'n/a',
    JSON.stringify({ noNow: noNow.map(r => r.level) }));
  ok('G16 門檻的合理範圍：比一天長（留給 cron 的延遲、估值的執行時間與看板 5 分鐘的邊緣快取，否則每天都誤報）、不超過兩天（錯過一整天的估值要抓得到）',
    T > 24 * HOUR + 5 * 60e3 && T <= 48 * HOUR, String(T / HOUR) + ' 小時');
}

// ── F 組：seg_key 鍵空間硬 gate（controller 任務指令額外要求，brief 沒有給）───────────
// 判準與 build_bounty_units.mjs 完全獨立重寫（不 import 它、不 import worker.js 的任何 canonicalSegs
// 邏輯），真值來源＝index.html 的 lineNetwork()/segKey()（index.html:9099,9166——已用
// `diff` 逐行核對過與這裡的邏輯等價，見 task-5-report.md 前置檢查）。同源判準會一起失明（心得29），
// 這裡刻意換一條獨立算路：直接從三個 track json 重新掃一次站表與相鄰站對。
//
// 🔴 track 與 dwell 是兩種不同形狀的鍵，真值來源也不同（schema/0002_bounty.sql 的註解 + 上面
// E4 本身就是證據）：track 的 A≠B，真值＝「正規區間」集合（相鄰站對，去同名與<0.05km）；
// dwell 的 A==B，真值＝「這是一座真實存在的站」，不是任何一個正規區間鍵——兩者結構上互斥，
// 不可能有任何 dwell 鍵是 275 個區間鍵之一。這是一開始的誤判：若把「每個 seg_key 都必須落在
// 275 個區間鍵集合」逐字當成唯一判準，兩千多個 dwell 單位會全數判 miss（見下方「RED/GREEN 實測
// 佐證」）——但那些鍵其實完全正確，只是驗法問錯了真值來源。
if (M) {
  const SOURCES = [
    { track: 'data/tra.json', sys: 'tra_sched' },
    { track: 'data/thsr_track.json', sys: 'thsr_sched' },
    { track: 'data/afr.json', sys: 'afr_sched' },
  ];
  const realSegKeys = new Set();          // track 的真值："sys|lnId|A|B"（A<B 字典序），275 個
  const realStations = {};                // dwell 的真值："sys|lnId" → Set(站名)
  const bySys = {};
  for (const src of SOURCES) {
    const t = JSON.parse(readFileSync(src.track, 'utf8'));
    for (const ln of (t.lines || [])) {
      const sts = (ln.stations || []).filter(s => s.d != null && s.name).slice().sort((a, b) => a.d - b.d);
      const lk = `${src.sys}|${ln.id}`;
      realStations[lk] = new Set(sts.map(s => s.name));
      for (let i = 1; i < sts.length; i++) {
        const a = sts[i - 1], b = sts[i];
        if (a.name === b.name || Math.abs(b.d - a.d) < 0.05) continue;
        const key = a.name < b.name ? `${src.sys}|${ln.id}|${a.name}|${b.name}` : `${src.sys}|${ln.id}|${b.name}|${a.name}`;
        realSegKeys.add(key);
        bySys[src.sys] = (bySys[src.sys] || 0) + 1;
      }
    }
  }
  ok('F1 獨立重算的真實區間鍵數與參考值一致（275：tra_sched 244／thsr_sched 11／afr_sched 20）',
    realSegKeys.size === 275 && bySys.tra_sched === 244 && bySys.thsr_sched === 11 && bySys.afr_sched === 20,
    JSON.stringify({ total: realSegKeys.size, ...bySys }));

  const missTrack = [], missDwell = [];
  let hitTrack = 0, hitDwell = 0;
  for (const u of M.units) {
    const p = u.segKey.split('|');
    if (u.kind === 'track') {
      if (p[2] !== p[3] && realSegKeys.has(u.segKey)) hitTrack++; else missTrack.push(u.segKey);
    } else {
      const lk = p[0] + '|' + p[1];
      if (p[2] === p[3] && realStations[lk] && realStations[lk].has(p[2])) hitDwell++; else missDwell.push(u.segKey);
    }
  }
  const nTrack = M.units.filter(u => u.kind === 'track').length;
  const nDwell = M.units.length - nTrack;
  ok('F2 所有 track 單位的 seg_key 都落在真實區間鍵集合內',
    hitTrack === nTrack, `命中 ${hitTrack}/${nTrack}，miss 前 5：${JSON.stringify(missTrack.slice(0, 5))}`);
  ok('F3 所有 dwell 單位的站名都是真實存在的站',
    hitDwell === nDwell, `命中 ${hitDwell}/${nDwell}，miss 前 5：${JSON.stringify(missDwell.slice(0, 5))}`);

  // ── 驗收條件 5：產出數量級人眼檢查（純資訊列印，不是斷言——由人眼判斷合不合理）──────────
  // 🔴 刻意不對真實 data/bounty_units.json 再跑一次 bountyValuationCron:worker.js 的
  // bountyUnits() 有模組級快取 bountyUnitsMem(比照既有 bountyRulesMem 的既定設計,見
  // task-2-report.md 風險 #4 已記錄的同一種跨測試污染)——上面 E7-E12 已經用兩筆 stub 資料
  // 呼叫過一次 bountyValuationCron,快取已鎖住那份 2 筆的 manifest;同一個 process 裡再呼叫
  // 一次、換一顆全新 D1、換 ASSETS 指到真實檔案,拿到的仍是快取住的 stub(不會真的重讀檔案)。
  // 這不是實作的 bug(生產環境本來就該全程重用同一份、不必每個請求重抓一次靜態資產),只是我
  // 這支測試腳本沒辦法在同一個 process 內把「stub 版 cron 正確性」與「全量真實資料的 cron」
  // 都跑到——已用 RED 實測過(見 task-5-report.md):照 brief 字面加一段對真實資料再跑一次
  // cron,inserted 回來是 2 不是 4166,就是被快取鎖死。改用「直接組合已驗過的純函式
  // (bountyMedian/bountyL1/bountyL2/bountyPointsOf,D 組已手算核對過)去跑同一份真實 M.units」
  // ——效果一樣是「真實資料跑過真實估值公式」,但不必經過會被快取污染的 bountyUnits()/D1 那層。
  const sysDist = {};
  for (const u of M.units) sysDist[u.sys] = (sysDist[u.sys] || 0) + 1;
  console.log(`\n[量級檢查] units 總數=${M.units.length}（track ${nTrack}／dwell ${nDwell}） sys 分佈=${JSON.stringify(sysDist)}`);

  // F4：PK 五元組(seg_key,train_kind,dir,kind,slot,對齊 schema 的 PRIMARY KEY)在整份清單裡
  // 不重複——這是「灌進 D1 不會互相覆蓋」真正在乎的不變量,直接在清單上驗,不必經過 D1。
  const pkSet = new Set(M.units.map(u => `${u.segKey}|${u.trainKind}|${u.dir}|${u.kind}|${u.slot || ''}`));
  ok('F4 每個 unit 的 PK 五元組在清單內唯一（無重複會互相覆蓋）',
    pkSet.size === M.units.length, `unique=${pkSet.size} total=${M.units.length}`);

  // points min/median/max：未設 BOUNTY_CLAIMABLE_FROM 時的「現況」(claimableFrom=0 → L2 恆 1，
  // 見 bountyL2/D12)——用已被 D 組驗過的同一批純函式，跑在真實的 4166 筆 perDay 分佈上。
  const med = bountyMedian(M.units.map(u => Number(u.perDay)));
  const now = Date.now();
  const pts = M.units.map(u => bountyPointsOf(bountyL1(u.perDay, med), bountyL2(now, 0))).sort((a, b) => a - b);
  const pMin = pts[0], pMax = pts[pts.length - 1], pMed = pts.length % 2
    ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
  console.log(`[量級檢查] points(未設 BOUNTY_CLAIMABLE_FROM，L2 恆 1) min=${pMin} median=${pMed} max=${pMax}（n=${pts.length}）`);
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
