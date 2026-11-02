// 路段懸賞後端驗收：「資料可用」標記（bountyUsableFlags／bountyUsableCron，schema 0020）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ BOUNTY_NOW 釘死，不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_usable.mjs
//
// 期望值一律寫死在這裡，由時刻表手算，不呼叫實作去產生期望：
//   ・標準車（停 S0、S2、S4、S6、S8、S10，奇數站通過；20 m/s、中間站各停 60 秒）：
//       S0 開 30000 → S2 到 30200 開 30260 → S4 到 30460 開 30520 → S6 到 30720 開 30780 → S8 到 30980 開 31040 → S10 到 31240
//   ・使用者 29700 就在 S0 月台等（早 5 分鐘），到 S10 之後原地多錄到 31540（多 5 分鐘），每秒一點、每 60 點一列（共 31 列）。
//   ・對得上的停車只留表定到開前後 180 秒：可用的時段是 29820（S0 開 30000−180）到 31420（S10 到 31240＋180），
//     所以第 0、1 列（29700–29819）與第 28–30 列（含 31421 之後的點）是 0，第 2–27 列（26 列）是 1。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」。
//
// 分組：U 純函式（比對與分列）　C 挑班車與寫入（bountyUsableCron）　S 掛在 scheduled() 的判定 cron 之後、出錯不影響判定
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(new URL('../worker.js', import.meta.url))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u) => { throw new Error('offline: ' + String(u)); };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;

// ── 固定的世界 ──────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00
const D28 = '2026-07-28', OLD = '2026-06-01';                 // OLD：超過 30 天，不挑
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const limiter = { limit: async () => ({ success: true }) };
const LINE = { sys: 'tra_sched', lnId: '山線', name: '山線', stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) };
const UNITS = { generatedAt: 1, schedDate: D28, units: [], lines: { 'tra_sched|山線': LINE } };
const STOPS = [[0, 30000, 30000], [2, 30200, 30260], [4, 30460, 30520], [6, 30720, 30780], [8, 30980, 31040], [10, 31240, 31240]];
const SCHED = STOPS.map(([i, arr, dep]) => ({ name: 'S' + i, arr, dep }));
// 站碼：S0＝1000 … S10＝1010（tra_station_info.json 以站名為鍵、值帶 id；事件表存站碼）
const nameOf = sta => { const n = Number(sta) - 1000; return n >= 0 && n <= 10 ? 'S' + n : undefined; };
const INFO = Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['S' + i, { name: 'S' + i, id: String(1000 + i) }]));
// tra_widget_schedule.json 的形狀：trains[i]＝[車次, 車種, [[站索引, 到站秒, 停站秒, 1 停／0 過],…]]，dates[日]＝索引
const WIDGET = {
  stations: Array.from({ length: 11 }, (_, i) => ['S' + i, 0, 0]),
  dates: { [D28]: [0] },
  trains: [['U1', '自強', Array.from({ length: 11 }, (_, i) => {
    const s = STOPS.find(x => x[0] === i);
    if (s) return [i, s[1], s[2] - s[1], 1];
    const a = STOPS.find(x => x[0] === i - 1);
    return [i, a[2] + 100, 0, 0];                                // 奇數站：前一站開車後 100 秒通過
  })]],
};

// 使用者的軌跡：關鍵影格之間線性內插、每秒一點（公尺、台北當日秒）。
// shift：整段往後挪幾秒（搭的是晚 shift 秒的車）；hold：{ at: 站號, sec }＝在那站多停 sec 秒、之後整段晚 sec 秒（下車換下一班）；
// gap：[t0, t1] 這段沒有點（地下段）；tailTo：到 S10 之後原地錄到幾秒。
function ride({ shift = 0, hold = null, gap = null, tailTo = 31540 } = {}) {
  const kf = [[29700, 0]];
  let off = 0;
  for (const [st, arr, dep] of STOPS) {
    kf.push([arr + off, st * 2000]);
    if (hold && hold.at === st) off += hold.sec;
    kf.push([dep + off, st * 2000]);
  }
  kf.push([tailTo + off, 20000]);
  const pts = [];
  for (let t = kf[0][0], k = 0; t <= kf[kf.length - 1][0]; t++) {
    while (k + 1 < kf.length - 1 && kf[k + 1][0] <= t) k++;
    const [ta, da] = kf[k], [tb, db] = kf[k + 1];
    if (gap && t > gap[0] && t < gap[1]) continue;
    pts.push({ d: da + (tb > ta ? (db - da) * (t - ta) / (tb - ta) : 0), t: t + shift, v: null, acc: 8 });
  }
  return pts;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const rowsOf = (pts, tag = 'r') => chunk(pts, 60).map((p, k) => ({ id: `${tag}.${k}`, payload: J(p) }));
// 期望：整列的點都在 [lo, hi] 裡＝1，否則 0
const expect = (rows, lo, hi) => rows.map(r => JSON.parse(r.payload).every(p => p.t >= lo && p.t <= hi) ? 1 : 0);
const flagsOf = (rows, sched, events) => { const m = _bounty.bountyUsableFlags(rows, LINE, sched, events, nameOf); return rows.map(r => m.get(r.id)); };
const EV0 = [{ sta: '1000', status: '2', delay: 0 }];

// ═══ U 組：純函式 ═════════════════════════════════════════════════════════
await attempt('U1', async () => {
  const rows = rowsOf(ride());
  const f = flagsOf(rows, SCHED, EV0), want = expect(rows, 29820, 31420);
  ok('U1a 對得上的一趟：開錄前在月台等的兩列與到站後原地多錄的三列是 0，中間 26 列是 1（31 列）',
    rows.length === 31 && J(f) === J(want) && f.filter(x => x === 1).length === 26 && J(f.slice(0, 3)) === '[0,0,1]' && J(f.slice(27)) === '[1,0,0,0]', J(f));
  const g = flagsOf(rowsOf(ride({ shift: 600 })), SCHED, EV0);
  ok('U1b [對照] 同一條軌跡晚 10 分鐘（搭的是後一班、標成這一班）：每站都差 600 秒，31 列全是 0', g.length === 31 && g.every(x => x === 0), J(g));
  const h = flagsOf(rowsOf(ride({ shift: 150 })), SCHED, EV0), wantH = expect(rowsOf(ride({ shift: 150 })), 29820, 31420);
  ok('U1c 晚 150 秒（在 180 秒內）：每站都對得上，可用時段仍照表定夾在 29820–31420', J(h) === J(wantH) && h.includes(1), J(h));
});

await attempt('U2', async () => {
  const rows = rowsOf(ride({ shift: 360 }));
  const late = expect(rows, 29820 + 360, 31420 + 360);
  const a = flagsOf(rows, SCHED, [{ sta: '1000', status: '2', delay: 6 }]);
  ok('U2a 誤點 6 分：軌跡晚 360 秒、S0 官方誤點 6 分（其他站沿用前面最近一站）→ 跟準點那趟一樣分列（可用時段一起晚 360 秒）', J(a) === J(late) && a.filter(x => x === 1).length === 26, J(a));
  const b = flagsOf(rows, SCHED, EV0);
  ok('U2b [對照] 同一條軌跡、官方誤點 0 分：每站差 360 秒，全是 0', b.every(x => x === 0), J(b));
  const c = flagsOf(rows, SCHED, [{ sta: '1000', status: '0', delay: 0 }, { sta: '1000', status: '2', delay: 6 }]);
  ok('U2c 同一站有進站（0 分）與離站（6 分）兩筆：取狀態最後的離站那筆 → 跟 U2a 一樣', J(c) === J(late), J(c));
  const d = flagsOf(rows, SCHED, [{ sta: '1006', status: '1', delay: 6 }]);
  ok('U2d 只有 S6 有官方誤點：S0–S4 前面沒有就取後面最近一站（S6 的 6 分）→ 跟 U2a 一樣', J(d) === J(late), J(d));
});

await attempt('U3', async () => {
  const rows = rowsOf(ride());
  const a = flagsOf(rows, SCHED, []), b = flagsOf(rows, [], EV0), c = flagsOf(rows, SCHED, [{ sta: '9999', status: '2', delay: 0 }]);
  ok('U3a 沒有官方誤點、沒有班表、事件都不在這班車的停靠站：一站都比不到 → 全部 null（不是 0）',
    a.every(x => x === null) && b.every(x => x === null) && c.every(x => x === null), J({ a: a.slice(0, 3), b: b.slice(0, 3), c: c.slice(0, 3) }));
  const bad = [{ id: 'x.bad', payload: '{not json' }, ...rows];
  const m = _bounty.bountyUsableFlags(bad, LINE, SCHED, EV0, nameOf);
  ok('U3b payload 壞掉的那一列是 null，其他列照常分（跟 U1a 同一組值）',
    m.get('x.bad') === null && J(rows.map(r => m.get(r.id))) === J(expect(rows, 29820, 31420)), J([m.get('x.bad'), m.get('r.2')]));
});

await attempt('U4', async () => {
  // 30399–30581 沒有點：S4（8 km，表定 30460 到、30520 開）整段在裡面，前後兩點間隔 182 秒 > 60，不內插通過時刻
  const rows = rowsOf(ride({ gap: [30399, 30581] }));
  const f = flagsOf(rows, SCHED, EV0);
  ok('U4a 地下段斷訊蓋掉一個停靠站：那站不比，前後對得上的站（S2、S6）接起來，斷訊兩側的列照樣是 1', J(f) === J(expect(rows, 29820, 31420)) && f.filter(x => x === 1).length >= 20, J(f));
});

await attempt('U5', async () => {
  // 在 S4 下車、15 分鐘後搭下一班繼續：S4 之後每站都差 900 秒。對得上的最後一站是 S4，停車只留到表定開 30520＋180＝30700。
  // 第 2–15 列（29820–30659）是 1，第 16 列（30660–30719）起含 30700 之後的點。
  const rows = rowsOf(ride({ hold: { at: 4, sec: 900 } }));
  const f = flagsOf(rows, SCHED, EV0), want = expect(rows, 29820, 30700);
  ok('U5a 中途換搭下一班沒停錄：S4 開車 180 秒以前的列是 1，之後（含在 S4 月台等的那 15 分鐘）全是 0',
    J(f) === J(want) && f.filter(x => x === 1).length === 14 && f.slice(16).every(x => x === 0), J(f));
});

await attempt('U6', async () => {
  // 開車 50 秒後才開錄（離 S0 已 1 km，S0 比不到）、到 S10 前 2 km 就停錄（S10 比不到）：S2–S8 都對得上，
  // 頭尾往外接到人停住為止 → 31150 以前每一列都是 1（30050–31150，共 19 列）。
  const pts = ride().filter(p => p.t >= 30050 && p.t <= 31150);
  const rows = rowsOf(pts), f = flagsOf(rows, SCHED, EV0);
  ok('U6a 起站與終點都比不到：第一個與最後一個對得上的站往外接，車上的 19 列全是 1', rows.length === 19 && f.every(x => x === 1), J(f));
  // 對照：開錄的頭 60 秒人原地不動（1 km 處，29990–30049），之後才開始走——停住的那一段不接
  const still = Array.from({ length: 60 }, (_, i) => ({ d: 1000, t: 29990 + i, v: null, acc: 8 }));
  const rows2 = rowsOf([...still, ...pts]), g = flagsOf(rows2, SCHED, EV0);
  ok('U6b [對照] 開錄先原地停 60 秒再走：停住那一列是 0，之後 19 列是 1', rows2.length === 20 && g[0] === 0 && g.slice(1).every(x => x === 1), J(g));
});

// ═══ C 組：挑班車與寫入 ═══════════════════════════════════════════════════
function world(over = {}) {
  const { db, DELAY_DB } = openTestDb('');
  const ASSETS = { fetch: async r => {
    const u = String(r.url);
    const body = u.includes('bounty_units') ? UNITS : u.includes('tra_widget_schedule') ? WIDGET : u.includes('tra_station_info') ? INFO : RULES;
    return new Response(J(body), { status: 200 });
  } };
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, AUTH_LIMITER: limiter, FIREBASE_WEB_API_KEY: 'k', BOUNTY_NOW: String(over.now || NOW_MS) };
  if (over.budget) env.BOUNTY_SUBREQ_BUDGET = String(over.budget);
  return { db, DELAY_DB, env };
}
// 直接寫樣本列（每 60 點一列）。verdict 預設 ok（C 組不經判定）。
function put(db, { actor, trainNo = 'U1', sys = 'tra_sched', lnId = '山線', date = D28, pts, verdict = 'ok', first = 0 }) {
  chunk(pts, 60).forEach((part, k) => db.prepare(
    'INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client) VALUES (?,?,?,?,?,0,?,?,NULL,?,?,?)'
  ).run(`${actor}.${trainNo}.${date}.${first + k}`, actor, sys, lnId, trainNo, date, J(part), NOW_MS - 3600e3 + first + k, verdict, J(APP)));
}
const putEvents = (db, rows) => { for (const e of rows) db.prepare('INSERT INTO tra_station_events (service_date,train_no,sta,status,delay,delay_max,obs_at) VALUES (?,?,?,?,?,?,?)').run(D28, 'U1', e.sta, e.status, e.delay, e.delay, '2026-07-28T08:20:00+08:00'); };
const rowsDb = (db, actor) => db.prepare('SELECT id, usable, usable_at, verdict FROM bounty_samples WHERE actor=? ORDER BY submitted_at').all(actor).map(r => ({ ...r }));
const run = async (w, env = w.env) => { _bounty.bountyResetMemCaches(); const c = _bounty.bountyCounted(env); const st = await _bounty.bountyUsableCron(c); return { st, n: c.__bountySubreq.n, by: c.__bountySubreq.by, bytes: c.__bountySubreq.bytes }; };
const want1 = expect(rowsOf(ride()), 29820, 31420);

function cWorld(over) {
  const w = world(over);
  put(w.db, { actor: 'a1', pts: ride() });                                         // 對得上的一趟（31 列）
  put(w.db, { actor: 'a1', pts: ride({ tailTo: 31600 }).slice(-10), verdict: 'pending', first: 100 });   // 同一班還在 pending 的一列：不動
  put(w.db, { actor: 'a4', trainNo: 'U9', pts: ride() });                          // 班表裡沒有 U9：比不了
  put(w.db, { actor: 'a5', pts: ride({ shift: 600 }) });                           // 同一天同一車次的另一個人，搭的是後一班
  put(w.db, { actor: 'b1', sys: 'thsr_sched', lnId: 'THSR', trainNo: '0123', pts: ride() });   // 高鐵：不挑
  put(w.db, { actor: 'b2', date: OLD, pts: ride() });                               // 超過 30 天：不挑
  put(w.db, { actor: 'b3', pts: ride(), verdict: 'unusable' });                    // 不是 ok：不挑
  putEvents(w.db, EV0);
  return w;
}

await attempt('C1', async () => {
  const w = cWorld();
  const r = await run(w);
  const a1 = rowsDb(w.db, 'a1'), ok1 = a1.filter(x => x.verdict === 'ok'), pend = a1.filter(x => x.verdict === 'pending');
  ok('C1a 對得上的那一趟：ok 的 31 列照 U1a 分（0,0,1×26,0,0,0），usable_at 都是這一發的時刻',
    J(ok1.map(x => x.usable)) === J(want1) && ok1.every(x => x.usable_at === NOW_MS), J(ok1.map(x => x.usable)));
  const a5 = rowsDb(w.db, 'a5');
  ok('C1b 同一班車的另一個人搭的是後一班：31 列全是 0', a5.length === 31 && a5.every(x => x.usable === 0 && x.usable_at === NOW_MS), J(a5.map(x => x.usable)));
  const a4 = rowsDb(w.db, 'a4');
  ok('C1c 班表裡沒有這班車：usable 留 NULL、usable_at 照寫（下一發不再挑）', a4.length === 31 && a4.every(x => x.usable === null && x.usable_at === NOW_MS), J(a4.slice(0, 2)));
  const others = ['b1', 'b2', 'b3'].flatMap(a => rowsDb(w.db, a));
  ok('C1d 不挑的不碰：同一班還在 pending 的列、高鐵、超過 30 天、判 unusable 的，usable 與 usable_at 都還是 NULL',
    pend.length === 1 && [...pend, ...others].every(x => x.usable === null && x.usable_at === null) && others.length === 93, J({ pend, n: others.length }));
  // 手算：挑班車 1＋資產（題庫、班表、站碼）3＋a1（讀列、讀誤點、寫）3＋a4（讀列、寫；沒班表不讀誤點）2＋a5（讀列、寫；誤點同一天同一車次已讀過）2＝11
  ok('C1e 子請求恰 11 次（query 5、fetch 3、batch 3）；三班車、列 93（可用 26、對不上 36、比不了 31）',
    r.n === 11 && r.by.query === 5 && r.by.fetch === 3 && r.by.batch === 3 && r.st.trains === 3 && r.st.rows === 93 && r.st.usable === 26 && r.st.mismatch === 36 && r.st.unknown === 31,
    J({ n: r.n, by: r.by, st: r.st }));
  const r2 = await run(w);
  ok('C1f 再跑一發：沒有要標的班車，只花挑班車那 1 次子請求、什麼都不寫', r2.st.trains === 0 && r2.n === 1 && J(rowsDb(w.db, 'a1').filter(x => x.verdict === 'ok').map(x => x.usable)) === J(want1), J(r2));
});

await attempt('C2', async () => {
  const w = cWorld();
  await run(w);
  // 遲傳：a1 多一列 ok（到站之後原地又錄 60 秒）、還沒標。下一發整班重算、整班重寫。
  put(w.db, { actor: 'a1', pts: ride({ tailTo: 31600 }).slice(-60), first: 200 });
  const NOW2 = NOW_MS + 3600e3;
  const r = await run(w, { ...w.env, BOUNTY_NOW: String(NOW2) });
  const ok1 = rowsDb(w.db, 'a1').filter(x => x.verdict === 'ok');
  ok('C2a 遲傳的一列判 ok 之後：那班車整班重算（只挑到這一班），32 列 usable_at 都換成新的一發，舊列的值不變、新的那列是 0',
    r.st.trains === 1 && ok1.length === 32 && ok1.every(x => x.usable_at === NOW2) && J(ok1.map(x => x.usable)) === J([...want1, 0]), J({ st: r.st, u: ok1.map(x => x.usable) }));
});

await attempt('C3', async () => {
  const w = cWorld({ budget: 9 });
  const r = await run(w);
  // 預算 9：挑班車 1＋資產 3＝4；a1 開始前 4＋3≤9 → 做（到 7）；a4 開始前 7＋3＞9 → 停
  ok('C3a 預算不夠：做完一班就停在班車邊界（budgetStop），沒輪到的兩班 usable_at 還是 NULL',
    r.st.trains === 1 && r.st.budgetStop === true && r.n === 7 && rowsDb(w.db, 'a4').every(x => x.usable_at === null) && rowsDb(w.db, 'a5').every(x => x.usable_at === null), J(r));
  const r2 = await run(w, { ...w.env, BOUNTY_SUBREQ_BUDGET: '8000' });
  ok('C3b 下一發接著把剩下的兩班標完', r2.st.trains === 2 && rowsDb(w.db, 'a5').every(x => x.usable === 0), J(r2.st));
});

await attempt('C4', async () => {
  const w = cWorld();
  // 一班 4 列、每列 payload 約 1.5 MB（ok 列可以跨好幾晚累積到超過 4 MB）：加到第 3 列 4.5 MB 超過上限，第 4 列不送回
  const pad = 'x'.repeat(1500000);
  for (let k = 0; k < 4; k++) w.db.prepare(
    'INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client) VALUES (?,?,?,?,?,0,?,?,NULL,?,?,?)'
  ).run(`c4.${k}`, 'c4', 'tra_sched', '山線', 'U1', D28, J([{ d: 0, t: 30000 + k, pad }, { d: 1, t: 30001 + k, pad: '' }]), NOW_MS - 3600e3 + k, 'ok', J(APP));
  const r = await run(w);
  const c4 = rowsDb(w.db, 'c4');
  ok('C4a 太大的一班：不拿去比、整班蓋上 usable_at（usable 留 NULL），skipped 1；其他三班照 C1 標',
    c4.length === 4 && c4.every(x => x.usable === null && x.usable_at === NOW_MS) && r.st.skipped === 1 && r.st.trains === 3 && r.st.rows === 93 &&
      J(rowsDb(w.db, 'a1').filter(x => x.verdict === 'ok').map(x => x.usable)) === J(want1), J({ st: r.st, c4: c4.slice(0, 1) }));
  // 手算：C1 的 11 次＋c4（讀列 1、蓋掉 1）＝13；讀進來的 payload：c4 三列 4.5 MB 多（第 4 列沒送回，送回就超過 6 MB）＋其他三班 93 列
  ok('C4b 讀取有上界：子請求 13、讀進來的位元組在 4.5 MB 到 6 MB 之間（第 4 列沒讀）', r.n === 13 && r.bytes > 4.5e6 && r.bytes < 6e6, J({ n: r.n, bytes: r.bytes }));
  const r2 = await run(w);
  ok('C4c 再跑一發：太大的那班不再被挑', r2.st.trains === 0 && r2.st.skipped === 0 && r2.n === 1, J(r2.st));
});

await attempt('C5', async () => {
  const w = cWorld();
  // 三班讀列就出錯的車，車主排在 a1 前面（挑班車依 actor 排序）：模擬每晚都會錯的班車
  const bad = ['0e1', '0e2', '0e3'];
  for (const a of bad) put(w.db, { actor: a, pts: ride() });
  const DB = w.DELAY_DB;
  const flaky = new Proxy(DB, { get(t, k) {
    if (k !== 'prepare') { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }
    return sql => {
      const st = t.prepare(sql);
      if (!sql.startsWith('SELECT id, ln_id, payload')) return st;
      return new Proxy(st, { get(s, kk) {
        if (kk !== 'bind') { const v = s[kk]; return typeof v === 'function' ? v.bind(s) : v; }
        return (...a) => { if (bad.includes(a[0])) throw new Error('模擬壞班車'); return s.bind(...a); };
      } });
    };
  } });
  const env = { ...w.env, DELAY_DB: flaky };
  const r1 = await run(w, env);
  const b1 = bad.flatMap(a => rowsDb(w.db, a));
  ok('C5a 連錯 3 班就停：三班都蓋上 usable_at（usable 留 NULL），還沒輪到的 a1 沒動',
    r1.st.errors === 3 && r1.st.trains === 0 && b1.length === 93 && b1.every(x => x.usable === null && x.usable_at === NOW_MS) &&
      rowsDb(w.db, 'a1').every(x => x.usable_at === null), J(r1.st));
  const NOW2 = NOW_MS + 3600e3;
  const r2 = await run(w, { ...env, BOUNTY_NOW: String(NOW2) });
  ok('C5b 下一發不再卡在同三班：出錯 0、照 C1 標完三班',
    r2.st.errors === 0 && r2.st.trains === 3 && J(rowsDb(w.db, 'a1').filter(x => x.verdict === 'ok').map(x => x.usable)) === J(want1), J(r2.st));
});

// ═══ S 組：掛在 scheduled() 的判定 cron 之後 ═══════════════════════════════
const tripPts = (db, a) => db.prepare("SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=? AND kind='trip'").get(a).n;
let S1_TRIP = null;
async function fire(w) {
  const logs = [], errs = [], cl = console.log, ce = console.error, cw = console.warn;
  console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  let threw = null;
  try { _bounty.bountyResetMemCaches(); await worker.scheduled({ cron: '30 19 * * *', scheduledTime: NOW_MS }, w.env, { waitUntil() {} }); }
  catch (e) { threw = String((e && e.message) || e).slice(0, 100); }
  finally { console.log = cl; console.error = ce; console.warn = cw; }
  return { logs, errs, threw };
}

await attempt('S1', async () => {
  const w = world();
  put(w.db, { actor: 's1', pts: ride(), verdict: 'pending' });
  putEvents(w.db, EV0);
  const r = await fire(w);
  const rows = rowsDb(w.db, 's1');
  S1_TRIP = tripPts(w.db, 's1');
  ok('S1a BOUNTY_CRON 一發：先判定（31 列判 ok），接著標資料可用（照 U1a 分），log 有一行「[cron bounty 可用] 班車 1」',
    r.threw === null && rows.every(x => x.verdict === 'ok') && J(rows.map(x => x.usable)) === J(want1) && r.logs.some(l => l.startsWith('[cron bounty 可用] 班車 1、')),
    J({ threw: r.threw, v: [...new Set(rows.map(x => x.verdict))], u: rows.map(x => x.usable), log: r.logs.filter(l => l.includes('可用')), errs: r.errs.slice(0, 2) }));
});

await attempt('S2', async () => {
  const w = world();
  put(w.db, { actor: 's2', pts: ride(), verdict: 'pending' });
  putEvents(w.db, EV0);
  w.db.exec('ALTER TABLE bounty_samples DROP COLUMN usable; ALTER TABLE bounty_samples DROP COLUMN usable_at;');   // 正式庫還沒套 0020 的樣子
  const r = await fire(w);
  const v = [...new Set(w.db.prepare("SELECT verdict FROM bounty_samples WHERE actor='s2'").all().map(x => x.verdict))];
  const pts = tripPts(w.db, 's2');
  ok('S2a 沒套 0020（缺兩欄）：判定與點數照常（31 列判 ok、錄程入帳跟 S1 一樣），scheduled 不丟例外，只印一行「[cron bounty 可用] 失敗」',
    r.threw === null && J(v) === '["ok"]' && pts > 0 && pts === S1_TRIP && r.errs.some(l => l.startsWith('[cron bounty 可用] 失敗')),
    J({ threw: r.threw, v, pts, s1: S1_TRIP, errs: r.errs.filter(l => l.includes('可用')).map(l => l.slice(0, 80)) }));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
