// 路段懸賞 v2 後端驗收（五）：判定 cron 這一族——排程分流（F1）、只判昨天以前（F24）、整班車一趟（F4）、
// 身分在入帳當下重新解析且同一班車不重複發（F10／F11）、模擬器只留判定（F23）、估值上架帶人數並補收滿（F12／F21）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ BOUNTY_NOW 釘死，不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_cron.mjs
//
// 期望值一律寫死在這裡，不呼叫實作去產生期望（日期一律自己用 Date 算，不借 taipeiDay）：
//   ・產品規則：捷運不列入懸賞；每日上限 4 籌碼、一趟至少 10 分鐘。
//   ・判定語意：一班車＝同一個 actor＋乘車日＋車次＝一趟＝最多一次錄程籌碼；只要有一條線的合格覆蓋段落在偏遠線就 ×2；
//     長度算整班車所有批次；模擬器只留判定、不登記貢獻、不動看板。
//   ・數字（台鐵 50／高鐵 15 位不同的人、一趟至少 600 秒、每日上限 4 籌碼、南迴／臺東 ×2、一趟 1 籌碼）
//     來自 data/bounty_rules.json，這裡照抄成字面。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準（突變表在回報裡）。
//
// 分組：A 排程分流（F1）　B 只判昨天以前（F24）　C 整班車一趟（F4）　D 身分與重複入帳（F10／F11）
//       E 模擬器（F23）　F 估值上架帶人數（F12）　G 估值上架補收滿（F21）　H 換班表之後退場的單位（第十二輪獨立驗收 P2-1）
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(new URL('../worker.js', import.meta.url))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// 對外連線偵測：整支腳本唯一允許的對外連線是 Firebase 查 uid（D 組合併用）；其餘一律記下來並丟例外。
// A 組拿它證明「BOUNTY_CRON 沒有跑每日 ingest」（ingest 一開始就會打 TDX）。
const outbound = [];
let firebaseUid = 'uid-cron-0001';
globalThis.fetch = async (u) => {
  if (String(u).includes('identitytoolkit.googleapis.com')) {
    return firebaseUid ? new Response(JSON.stringify({ users: [{ localId: firebaseUid }] }), { status: 200 }) : new Response('{}', { status: 400 });
  }
  outbound.push(String(u).slice(0, 80));
  throw new Error('offline: ' + String(u));
};

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
// 例外也要記成 FAIL（不讓整支腳本崩潰、後面的判準全部沒跑）：突變測試時「紅」有兩種長相——斷言為假、或流程直接丟例外。
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00（週三）
const D27 = '2026-07-27', D28 = '2026-07-28', D29 = '2026-07-29';   // 週一、週二、週三：都不是假日，coverageOf 不會產 dwell
const DAY = 86400e3;
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const SIM = { platform: 'ios', app: '1.6.13', simulator: true };
const limiter = { limit: async () => ({ success: true }) };

// 合成的線：20 公里、每 2 公里一站（S0…S10），正規區間 10 段。名字用真的鍵（bounty_rules.json 的 remoteLines 認 'tra_sched|南迴線'）。
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const LINES = {};
for (const ln of ['屏東線', '南迴線', '臺東線', '山線']) LINES[`tra_sched|${ln}`] = mkLine('tra_sched', ln);
LINES['thsr_sched|THSR'] = mkLine('thsr_sched', 'THSR');
const UNITS = { generatedAt: 1, schedDate: D28, units: [], lines: LINES };
const SEGS10 = Array.from({ length: 9 }, (_, i) => `S${i}|S${i + 1}`);      // 板上種 9 段：S0|S1 … S8|S9
const segKey = (sys, lnId, s) => `${sys}|${lnId}|${s}`;
const KT = (ln, s) => segKey('tra_sched', ln, s);

// 一段乾淨軌跡：從里程 d0 出發、每秒一點、等速 speed（reverse＝往里程減少的方向走）。點數＝sec+1，長度（t 的 max−min）＝sec。
function leg({ sec, speed = 20, t0 = 30000, d0 = 0, reverse = false }) {
  const pts = [];
  for (let i = 0; i <= sec; i++) pts.push({ d: d0 + (reverse ? -i : i) * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc: 8 });
  return pts;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// 一個獨立的世界：全新的 D1、規則與題庫替身、釘死的時鐘。
function world(over = {}) {
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const units = over.units || UNITS;
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units') ? J(units) : J(over.rules || RULES), { status: 200 }) };
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, AUTH_LIMITER: limiter, FIREBASE_WEB_API_KEY: 'k' };
  if (over.now !== null) env.BOUNTY_NOW = String(over.now || NOW_MS);
  return {
    db, DELAY_DB, env,
    // 模組層級有 rules／units 快取（bountyResetMemCaches 的註解），每次跑之前歸零，情境之間才不會串味
    cron: async (now) => { _bounty.bountyResetMemCaches(); return _bounty.bountyVerifyCron(now ? { ...env, BOUNTY_NOW: String(now) } : env); },
    valuation: async () => { _bounty.bountyResetMemCaches(); return _bounty.bountyValuationCron(env); },
  };
}

// 直接寫樣本列（每一批一列）。first＝這一段批次的起始序號（同一班車分幾次寫入時，序號與 submitted_at 都要接續）。
function putBatches(db, o) {
  const { actor, trainNo, lnId, sys = 'tra_sched', date = D28, pts, dir = 0, client = APP, first = 0, size = 200 } = o;
  // submittedAt：上傳時間的基準，預設是固定世界的「一小時前」。防偽閘的日期窗以上傳時間為基準（integrityGate 的 uploadedAt），
  // 所以用真時鐘的情境（B4）要自己給一個貼近真實現在的值，不然乘車日（真實昨天／今天）會比上傳時間（固定世界）還晚而被判 future_date。
  const at = o.submittedAt ?? (NOW_MS - 3600e3);
  chunk(pts, size).forEach((part, k) => {
    const c = Array.isArray(client) ? client[Math.min(first + k, client.length - 1)] : client;
    db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
      " VALUES (?,?,?,?,?,?,?,?,NULL,?,'pending',?)")
      .run(`${actor}.${trainNo}.${date}.${lnId}.${first + k}`, actor, sys, lnId, trainNo, dir, date, J(part),
        at + first + k, c ? J(c) : null);
  });
}

// 板上種段。一次可以種多列（同段不同車種）；covered／distinct／sampleCount 可指定。
const boardSql = (sys, lnId, rows, segs = SEGS10) => {
  const v = [];
  for (const s of segs) for (const r of rows) {
    v.push(`('${segKey(sys, lnId, s)}','${sys}','${r.trainKind || '自強'}',${r.dir ?? 0},'track','',1,1,${r.points ?? 3},10,1,1,` +
      `${r.sampleCount ?? 0},${r.covered ?? 'NULL'},${(r.distinctOf && r.distinctOf[s]) ?? r.distinct ?? 0})`);
  }
  return `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users) VALUES ${v.join(',')};`;
};
const boardAll = (lns) => lns.map(ln => boardSql('tra_sched', ln, [{}])).join('\n');
// 預塞 n 位「別人」已經貢獻過這條線的這些段（contrib 與板上計數要一致由呼叫端負責）
const stuffSql = (sys, lnId, n, segs = SEGS10) => {
  const v = [];
  for (const s of segs) for (let i = 0; i < n; i++) v.push(`('${segKey(sys, lnId, s)}','other-${String(i).padStart(3, '0')}',1)`);
  return `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ${v.join(',')};`;
};

// ── 讀庫（一律自己寫 SQL，不呼叫實作的任何函式）─────────────────────────────────
const q = {
  verdicts: (db, actor, trainNo) => db.prepare('SELECT DISTINCT verdict v FROM bounty_samples WHERE actor=? AND train_no=?').all(actor, trainNo).map(r => r.v).sort().join(),
  verdictsLn: (db, actor, trainNo, ln) => db.prepare('SELECT DISTINCT verdict v FROM bounty_samples WHERE actor=? AND train_no=? AND ln_id=?').all(actor, trainNo, ln).map(r => r.v).sort().join(),
  nPending: db => db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c,
  tripRows: db => db.prepare("SELECT actor,delta,ref,day FROM chip_ledger WHERE kind='trip' ORDER BY ref").all().map(r => ({ ...r })),
  chips: (db, actor, day) => day == null
    ? db.prepare("SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=? AND kind='trip'").get(actor).n
    : db.prepare("SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=? AND kind='trip' AND day=?").get(actor, day).n,
  nLedger: (db, actor) => db.prepare('SELECT COUNT(*) c FROM chip_ledger WHERE actor=?').get(actor).c,
  contribKeys: (db, actor) => db.prepare('SELECT seg_key FROM bounty_seg_contrib WHERE actor=? ORDER BY seg_key').all(actor).map(r => r.seg_key),
  nContrib: (db, actor) => db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib WHERE actor=?').get(actor).c,
  board: (db, key) => db.prepare('SELECT train_kind,dir,sample_count,covered_at,distinct_ok_users FROM bounty_board WHERE seg_key=? ORDER BY train_kind,dir').all(key).map(r => ({ ...r })),
  nPoints: (db, actor) => db.prepare('SELECT COUNT(*) c FROM bounty_points WHERE actor=?').get(actor).c,
  segsOf: (db, actor, trainNo, ln) => db.prepare('SELECT segs FROM bounty_samples WHERE actor=? AND train_no=? AND ln_id=? LIMIT 1').get(actor, trainNo, ln).segs,
};
const segNames = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `S${from + i}|S${from + i + 1}`);   // segNames(0,6)＝S0|S1…S6|S7
const keysOf = (ln, names) => names.map(s => KT(ln, s)).sort();
const S7 = segNames(0, 6);                                    // 700 秒 @20 m/s＝14 km＝前 7 段
const S4 = segNames(0, 3);                                    // 400 秒 @20 m/s＝ 8 km＝前 4 段

// ── 測試用注入點 ───────────────────────────────────────────────────────────
// 記下所有 prepare 的 SQL 文字
function spySql(DELAY_DB) {
  const sqls = [], orig = DELAY_DB.prepare.bind(DELAY_DB);
  DELAY_DB.prepare = sql => { sqls.push(sql); return orig(sql); };
  return sqls;
}
// 某句 SQL 一 prepare 就丟例外（模擬「這一支子 cron 壞掉」）
function failOnPrepare(DELAY_DB, re) {
  const orig = DELAY_DB.prepare.bind(DELAY_DB);
  DELAY_DB.prepare = sql => { if (re.test(sql)) throw new Error('injected: ' + sql.slice(0, 48)); return orig(sql); };
}
// 在「符合的那句 SQL 第一次真的執行前」插入一段非同步動作＝競態注入點（等於在 cron 讀完樣本、入帳之前發生別的請求）。
function hookOnce(DELAY_DB, re, fn) {
  const orig = DELAY_DB.prepare.bind(DELAY_DB);
  const state = { fired: 0 };
  DELAY_DB.prepare = sql => {
    const st = orig(sql);
    if (!re.test(sql)) return st;
    const wrapS = s => new Proxy(s, { get(t, k) {
      if (k === 'bind') return (...p) => wrapS(t.bind(...p));
      if (k === 'all' || k === 'first' || k === 'run') return async (...a) => { if (!state.fired++) await fn(); return t[k](...a); };
      return t[k];
    } });
    return wrapS(st);
  };
  return state;
}
// 走真的 bountyMerge（裝置 token 併進 uid）。若日後 bountyMerge 的呼叫契約改了（例如要多帶憑證），只要改這一個函式。
async function mergeInto(w, dev, uid) {
  firebaseUid = uid;
  const res = await _bounty.bountyMerge(new Request('https://railisland.tw/api/bounty-merge', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', Authorization: 'Bearer t' },
    body: J({ actor: dev }) }), w.env);
  return res.status;
}
// 用真的 scheduled() 觸發一次 cron；log 與 error 收起來（每日 ingest 失敗的 log 很吵）。回傳 { logs, errs, threw }
async function fire(w, cron) {
  const logs = [], errs = [], cl = console.log, ce = console.error, cw = console.warn;
  console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  let threw = null;
  try { _bounty.bountyResetMemCaches(); await worker.scheduled({ cron, scheduledTime: NOW_MS }, w.env, { waitUntil() {} }); }
  catch (e) { threw = String((e && e.message) || e).slice(0, 100); }
  finally { console.log = cl; console.error = ce; console.warn = cw; }
  return { logs, errs, threw };
}
const BOUNTY_TOUCH = /bounty_board|bounty_samples|bounty_seg_contrib|bounty_claims|bounty_points|chip_ledger/;

// ═══ A 組：排程分流（F1）══════════════════════════════════════════════════════
// 三個單位、一趟 700 秒的山線 ok 趟：估值跑了→板上有 3 列；驗證跑了→樣本判成 ok、帳本 +1。
const U3 = { generatedAt: 1, schedDate: D28, lines: LINES, units: [
  { segKey: KT('山線', 'S0|S1'), sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 30 },
  { segKey: KT('山線', 'S1|S2'), sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 30 },
  { segKey: KT('山線', 'S2|S3'), sys: 'tra_sched', trainKind: '區間車', dir: 0, kind: 'track', slot: '', perDay: 60 },
] };
const aWorld = () => {
  const w = world({ units: U3 });
  putBatches(w.db, { actor: 'cron-a', trainNo: '101', lnId: '山線', pts: leg({ sec: 700 }) });
  return w;
};
const nBoard = db => db.prepare('SELECT COUNT(*) c FROM bounty_board').get().c;

await attempt('A1', async () => {
  const w = aWorld(); const sqls = spySql(w.DELAY_DB);
  outbound.length = 0;
  const r = await fire(w, '30 19 * * *');
  ok('A1a [F1] BOUNTY_CRON（30 19 * * *）：估值跑了（板上 3 列）＋驗證跑了（樣本判成 ok、帳本 +1）、scheduled 正常結束',
    nBoard(w.db) === 3 && q.verdicts(w.db, 'cron-a', '101') === 'ok' && q.chips(w.db, 'cron-a') === 1 && r.threw === null,
    J({ board: nBoard(w.db), v: q.verdicts(w.db, 'cron-a', '101'), chips: q.chips(w.db, 'cron-a'), threw: r.threw, errs: r.errs.slice(0, 2) }));
  ok('A1b [F1] BOUNTY_CRON 不跑每日 ingest：沒有任何對外連線，也沒有逐站事件清理那句 DELETE',
    outbound.length === 0 && !sqls.some(s => /DELETE FROM tra_station_events/.test(s)), J({ outbound, deletes: sqls.filter(s => /DELETE FROM/.test(s)).length }));
  ok('A1c [F1] log 留下估值與驗證各一行（營運上看 log 就知道這一發做了什麼）',
    r.logs.some(l => l.includes('[cron bounty 估值]')) && r.logs.some(l => l.includes('[cron bounty 驗證]')), J(r.logs.slice(0, 3)));
});
await attempt('A2', async () => {
  for (const cron of ['15 1 * * *', '45 1 * * *', '0 0 * * *']) {
    const w = aWorld(); const sqls = spySql(w.DELAY_DB);
    const r = await fire(w, cron);
    ok(`A2 [F1] cron 字串 ${J(cron)} 不碰任何懸賞表（估值、驗證都不跑：板上 0 列、樣本整趟仍 pending）`,
      !sqls.some(s => BOUNTY_TOUCH.test(s)) && nBoard(w.db) === 0 && q.verdicts(w.db, 'cron-a', '101') === 'pending',
      J({ touched: sqls.filter(s => BOUNTY_TOUCH.test(s)).length, board: nBoard(w.db), v: q.verdicts(w.db, 'cron-a', '101') }));
    ok(`A2b [F1 對照] ${J(cron)} 確實掉進每日 ingest（有跑逐站事件清理的 DELETE）——不是 scheduled 提早 return 才沒碰懸賞表`,
      sqls.some(s => /DELETE FROM tra_station_events/.test(s)), J({ threw: r.threw }));
  }
});
await attempt('A3', async () => {
  const w = aWorld();
  const r = await fire(w, '15 4 * * *');
  ok('A3 [F1 對照] 原本的 15 4 * * * 分支沒被動到：每日 ingest 照跑（這裡沒有 TDX 憑證，失敗照 rethrow 也無妨），懸賞估值＋驗證仍跑完（板上 3 列、ok、帳本 +1）',
    nBoard(w.db) === 3 && q.verdicts(w.db, 'cron-a', '101') === 'ok' && q.chips(w.db, 'cron-a') === 1,
    J({ threw: r.threw, board: nBoard(w.db), v: q.verdicts(w.db, 'cron-a', '101'), chips: q.chips(w.db, 'cron-a') }));
});
await attempt('A4', async () => {
  const w1 = aWorld(); failOnPrepare(w1.DELAY_DB, /^INSERT INTO bounty_board/);
  const r1 = await fire(w1, '30 19 * * *');
  ok('A4a [F1] 估值壞掉（上架那句 INSERT 丟例外）不擋驗證：估值失敗有記 log、scheduled 不丟例外、樣本照判、帳本 +1',
    r1.threw === null && r1.errs.some(e => e.includes('[cron bounty 估值] 失敗')) && q.verdicts(w1.db, 'cron-a', '101') === 'ok' && q.chips(w1.db, 'cron-a') === 1,
    J({ threw: r1.threw, errs: r1.errs.map(e => e.slice(0, 40)), v: q.verdicts(w1.db, 'cron-a', '101') }));
  // 驗證整支壞掉：review-B 之後判定分兩段，第一段「班車清單」那句壞掉＝整支失敗、往外丟（第二段一班一班判的錯誤會在裡面接住，見 A4c）
  const w2 = aWorld(); failOnPrepare(w2.DELAY_DB, /^WITH t AS \(/);
  const r2 = await fire(w2, '30 19 * * *');
  ok('A4b [F1] 驗證壞掉不擋估值：驗證失敗有記 log、scheduled 不丟例外、估值照跑（板上 3 列）',
    r2.threw === null && r2.errs.some(e => e.includes('[cron bounty 驗證] 失敗')) && nBoard(w2.db) === 3,
    J({ threw: r2.threw, errs: r2.errs.map(e => e.slice(0, 40)), board: nBoard(w2.db) }));
  // 一班車判到一半出錯（review-B R3：讀那班車的批次那句丟例外）：判定接住、記下這一班（之後每一發排到最後）、繼續下一班；
  // 判定那一行以 error 等級印（含錯誤訊息），另一行 error 指名是哪一班；樣本留 pending 給下一發
  const w3 = aWorld(); failOnPrepare(w3.DELAY_DB, /^SELECT \* FROM \(SELECT \*, SUM\(length\(payload\)\) OVER/);
  const r3 = await fire(w3, '30 19 * * *');
  const line3 = r3.errs.find(e => /^\[cron bounty 驗證\] \d+ 班／/.test(e)) || '';
  const which3 = r3.errs.find(e => e.includes('這班車判定出錯')) || '';
  ok('A4c [R3] 一班車途中出錯：scheduled 不丟例外、估值照跑（板上 3 列）；判定那一行以 error 等級印出「1 班判定出錯」與錯誤訊息（injected），' +
    '另一行指名那一班（cron-a 的 101）；樣本仍 pending、沒有帳本',
    r3.threw === null && nBoard(w3.db) === 3 && line3.includes('1 班判定出錯') && line3.includes('injected') && !line3.includes('失敗:') &&
      which3.includes('bounty_verify_strike|cron-a|') && which3.includes('|101）') &&
      q.verdicts(w3.db, 'cron-a', '101') === 'pending' && q.chips(w3.db, 'cron-a') === 0,
    J({ threw: r3.threw, line3: line3.slice(0, 200), which3: which3.slice(0, 120), v: q.verdicts(w3.db, 'cron-a', '101') }));
});

// ═══ B 組：只判「乘車日早於台北今天」的樣本（F24）══════════════════════════════
await attempt('B1', async () => {
  const w = world();
  putBatches(w.db, { actor: 'b1-yday', trainNo: '101', lnId: '山線', date: D28, pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: 'b1-today', trainNo: '102', lnId: '山線', date: D29, pts: leg({ sec: 700 }) });
  const st = await w.cron();                                               // BOUNTY_NOW＝台北 07-29 10:00
  ok('B1a [F24] 昨天（07-28）的趟判掉：ok、帳本 +1', q.verdicts(w.db, 'b1-yday', '101') === 'ok' && q.chips(w.db, 'b1-yday', D28) === 1,
    J({ v: q.verdicts(w.db, 'b1-yday', '101'), chips: q.chips(w.db, 'b1-yday', D28) }));
  ok('B1b [F24] 今天（07-29）的趟不判：整趟仍是 pending、沒有帳本、沒有貢獻登記（今天的趟可能還在車上）',
    q.verdicts(w.db, 'b1-today', '102') === 'pending' && q.nLedger(w.db, 'b1-today') === 0 && q.nContrib(w.db, 'b1-today') === 0,
    J({ v: q.verdicts(w.db, 'b1-today', '102'), ledger: q.nLedger(w.db, 'b1-today'), contrib: q.nContrib(w.db, 'b1-today') }));
  ok('B1c [F24] 這一發只處理了 1 趟（昨天那趟）、入帳 1 顆', st.trips === 1 && st.ok === 1 && st.chips === 1, J(st));
});
await attempt('B2', async () => {
  // 換日是台北午夜，不是 UTC 午夜：UTC 07-28 15:59:59＝台北 07-28 23:59:59（07-28 還是「今天」）；
  // 再過一秒 UTC 16:00:00＝台北 07-29 00:00:00（07-28 變成「昨天」）。用 UTC 的日期去比的話，這一秒兩邊都還是 07-28。
  const w = world();
  putBatches(w.db, { actor: 'b2', trainNo: '101', lnId: '山線', date: D28, pts: leg({ sec: 700 }) });
  const before = await w.cron(Date.parse('2026-07-28T15:59:59Z'));
  const pendBefore = q.verdicts(w.db, 'b2', '101'), chipsBefore = q.chips(w.db, 'b2');
  const after = await w.cron(Date.parse('2026-07-28T16:00:00Z'));
  ok('B2a [F24] 台北 07-28 23:59:59：07-28 的趟還是今天，不判（pending、0 趟、0 顆）', pendBefore === 'pending' && chipsBefore === 0 && before.trips === 0,
    J({ pendBefore, chipsBefore, trips: before.trips }));
  ok('B2b [F24] 台北 07-29 00:00:00：07-28 的趟變成昨天，這一發判掉（ok、帳本 +1）', q.verdicts(w.db, 'b2', '101') === 'ok' && q.chips(w.db, 'b2') === 1 && after.trips === 1,
    J({ v: q.verdicts(w.db, 'b2', '101'), chips: q.chips(w.db, 'b2'), trips: after.trips }));
});
await attempt('B3', async () => {
  // 840 秒、兩批（前 420、後 420），乘車日＝今天：今天那一發只看得到前一批，若當場判掉就是兩半各自判——各不到 600 秒、一顆都拿不到。
  const w = world();
  const pts = leg({ sec: 840, speed: 10 });                                // 841 點；t 30000…30840
  putBatches(w.db, { actor: 'b3', trainNo: 'T840', lnId: '山線', date: D29, pts: pts.slice(0, 421), first: 0, size: 1000 });   // 前半 t 30000…30420
  const s1 = await w.cron();                                              // 今天那一發（台北 07-29 10:00）
  const pend1 = q.nPending(w.db), chips1 = q.chips(w.db, 'b3');
  putBatches(w.db, { actor: 'b3', trainNo: 'T840', lnId: '山線', date: D29, pts: pts.slice(421), first: 1, size: 1000 });         // 後半 t 30421…30840 晚到
  const s2 = await w.cron(NOW_MS + DAY);                                  // 隔天那一發（台北 07-30 10:00）
  ok('B3a [F24] 今天那一發：只有前半批在庫、不判（仍 pending、0 趟、帳本 0）', pend1 === 1 && chips1 === 0 && s1.trips === 0, J({ pend1, chips1, trips: s1.trips }));
  ok('B3b [F24] 隔天那一發：兩批併成一趟一起判＝840 秒 ≥ 600 → 1 顆（ref＝actor|乘車日|車次）；只判 1 趟',
    q.verdicts(w.db, 'b3', 'T840') === 'ok' && J(q.tripRows(w.db)) === J([{ actor: 'b3', delta: 1, ref: `b3|${D29}|T840`, day: D29 }]) && s2.trips === 1 && s2.chips === 1,
    J({ v: q.verdicts(w.db, 'b3', 'T840'), ledger: q.tripRows(w.db), trips: s2.trips }));
});
await attempt('B4', async () => {
  // 不帶 BOUNTY_NOW（正式環境就是這樣）：用真的時鐘算「台北今天」。日期自己用 Date 算，不借實作的 taipeiDay。
  const tp = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
  for (let tries = 0; tries < 2; tries++) {                              // 跨台北午夜的那一瞬間重來一次（機率趨近 0，但不讓它變成偶發紅）
    const today = tp(Date.now()), yday = tp(Date.now() - DAY);
    const w = world({ now: null });
    const upAt = Date.now() - 3600e3;                                     // 上傳時間貼近真實現在（見 putBatches 的 submittedAt）
    putBatches(w.db, { actor: 'b4-yday', trainNo: '101', lnId: '山線', date: yday, pts: leg({ sec: 700 }), submittedAt: upAt });
    putBatches(w.db, { actor: 'b4-today', trainNo: '102', lnId: '山線', date: today, pts: leg({ sec: 700 }), submittedAt: upAt });
    await w.cron();
    if (tp(Date.now()) !== today) continue;
    ok('B4 [F24] 沒有 BOUNTY_NOW 時用真時鐘：昨天的趟判掉（ok、+1）、今天的趟不判（pending、0）',
      q.verdicts(w.db, 'b4-yday', '101') === 'ok' && q.chips(w.db, 'b4-yday') === 1 && q.verdicts(w.db, 'b4-today', '102') === 'pending' && q.chips(w.db, 'b4-today') === 0,
      J({ yday: q.verdicts(w.db, 'b4-yday', '101'), today: q.verdicts(w.db, 'b4-today', '102'), chips: [q.chips(w.db, 'b4-yday'), q.chips(w.db, 'b4-today')] }));
    return;
  }
  ok('B4 [F24] 沒有 BOUNTY_NOW 時用真時鐘（連兩次都跨台北午夜，無法判定）', false);
});

// ═══ C 組：一班車＝一趟（跨線的直通車）（F4）══════════════════════════════════════
// 兩條線各自判定、各自登記去重人數；籌碼整班車只發一次：任何一條 ok 就算 ok、任何一段落在偏遠線 ×2、長度算整班車所有批次。
const cWorld = () => world({ seed: boardAll(['屏東線', '南迴線', '臺東線', '山線']) });
await attempt('C1', async () => {
  // 高雄→臺東方向：先屏東線（一般線）、再南迴線（偏遠線 ×2）。舊行為（一條線一趟、先判完的先寫死）會因為屏東線排在前面而只拿 1。
  const w = cWorld();
  putBatches(w.db, { actor: 'c1', trainNo: 'F1', lnId: '屏東線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
  putBatches(w.db, { actor: 'c1', trainNo: 'F1', lnId: '南迴線', pts: leg({ sec: 700, t0: 30701 }), first: 100 });
  const st = await w.cron();
  ok('C1a [F4] 兩條線各自判定：屏東線、南迴線的樣本都判成 ok（各算一組：trips 2、ok 2）',
    q.verdictsLn(w.db, 'c1', 'F1', '屏東線') === 'ok' && q.verdictsLn(w.db, 'c1', 'F1', '南迴線') === 'ok' && st.trips === 2 && st.ok === 2,
    J({ p: q.verdictsLn(w.db, 'c1', 'F1', '屏東線'), n: q.verdictsLn(w.db, 'c1', 'F1', '南迴線'), st }));
  ok('C1b [F4] 籌碼整班車只發一次＝1 列、南迴在後也 ×2 → delta 2（ref＝c1|乘車日|F1）；stat.chips 2',
    J(q.tripRows(w.db)) === J([{ actor: 'c1', delta: 2, ref: `c1|${D28}|F1`, day: D28 }]) && st.chips === 2, J({ ledger: q.tripRows(w.db), chips: st.chips }));
  ok('C1c [F4] 兩條線各自登記去重：貢獻 14 段＝屏東線 S0|S1…S6|S7 ＋ 南迴線 S0|S1…S6|S7（不是全部記到第一條線）',
    J(q.contribKeys(w.db, 'c1')) === J([...keysOf('屏東線', S7), ...keysOf('南迴線', S7)].sort()), J(q.contribKeys(w.db, 'c1')));
  ok('C1d [F4] 每一條線的覆蓋段（segs）用自己那條線的幾何算：屏東線的樣本只有屏東線的 7 段、南迴線的樣本只有南迴線的 7 段',
    J(JSON.parse(q.segsOf(w.db, 'c1', 'F1', '屏東線')).map(c => c.key).sort()) === J(keysOf('屏東線', S7)) &&
      J(JSON.parse(q.segsOf(w.db, 'c1', 'F1', '南迴線')).map(c => c.key).sort()) === J(keysOf('南迴線', S7)),
    J({ p: q.segsOf(w.db, 'c1', 'F1', '屏東線').slice(0, 80), n: q.segsOf(w.db, 'c1', 'F1', '南迴線').slice(0, 80) }));
  ok('C1e [F4] 兩條線的看板人數各 +1（distinct_ok_users 1）、趟數各 +1（sample_count 1）',
    q.board(w.db, KT('屏東線', 'S0|S1'))[0].distinct_ok_users === 1 && q.board(w.db, KT('南迴線', 'S6|S7'))[0].distinct_ok_users === 1 &&
      q.board(w.db, KT('屏東線', 'S0|S1'))[0].sample_count === 1 && q.board(w.db, KT('南迴線', 'S6|S7'))[0].sample_count === 1,
    J({ p: q.board(w.db, KT('屏東線', 'S0|S1')), n: q.board(w.db, KT('南迴線', 'S6|S7')) }));
});
await attempt('C2', async () => {
  // 臺東→高雄方向（反向）：先南迴線、後屏東線，每條線 400 秒（各不到 600 秒、合起來 801 秒）。
  // 一條線一趟的舊行為：每一組都 <600 秒 → 一顆都沒有；整班算才對：801 秒、南迴 ×2 → 2。
  const w = cWorld();
  putBatches(w.db, { actor: 'c2', trainNo: 'R1', lnId: '南迴線', pts: leg({ sec: 400, t0: 30000, d0: 8000, reverse: true }), dir: 1, first: 0 });
  putBatches(w.db, { actor: 'c2', trainNo: 'R1', lnId: '屏東線', pts: leg({ sec: 400, t0: 30401, d0: 8000, reverse: true }), dir: 1, first: 100 });
  const st = await w.cron();
  ok('C2a [F4 反向] 臺東→高雄：兩條線各自判成 ok、籌碼 1 列 delta 2（各 400 秒不夠 600，合起來 801 秒才夠；南迴 ×2）',
    q.verdicts(w.db, 'c2', 'R1') === 'ok' && st.trips === 2 && J(q.tripRows(w.db)) === J([{ actor: 'c2', delta: 2, ref: `c2|${D28}|R1`, day: D28 }]),
    J({ v: q.verdicts(w.db, 'c2', 'R1'), st, ledger: q.tripRows(w.db) }));
  ok('C2b [F4 反向] 兩條線各登記 4 段（往里程減少的方向也是每條線用自己的幾何）',
    J(q.contribKeys(w.db, 'c2')) === J([...keysOf('南迴線', S4), ...keysOf('屏東線', S4)].sort()), J(q.contribKeys(w.db, 'c2')));
});
await attempt('C3', async () => {
  const w = cWorld();
  putBatches(w.db, { actor: 'c3', trainNo: 'P1', lnId: '屏東線', pts: leg({ sec: 700 }) });
  const st = await w.cron();
  ok('C3 [F4 對照] 只有屏東線（一般線）的一趟：1 顆、登記 7 段——×2 只在有偏遠線的合格段時才發生',
    J(q.tripRows(w.db)) === J([{ actor: 'c3', delta: 1, ref: `c3|${D28}|P1`, day: D28 }]) && q.nContrib(w.db, 'c3') === 7 && st.trips === 1,
    J({ ledger: q.tripRows(w.db), contrib: q.nContrib(w.db, 'c3'), trips: st.trips }));
});
await attempt('C4', async () => {
  // 兩條一般線各 400 秒（各不到 600、合起來 801）：1 顆。舊行為每一組都 <600 → 0。
  const w = cWorld();
  putBatches(w.db, { actor: 'c4', trainNo: 'M1', lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
  putBatches(w.db, { actor: 'c4', trainNo: 'M1', lnId: '屏東線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
  await w.cron();
  ok('C4 [F4] 兩條一般線各 400 秒、合起來 801 秒：整班車長度夠 → 1 顆（不是 0）；各登記 4 段',
    J(q.tripRows(w.db)) === J([{ actor: 'c4', delta: 1, ref: `c4|${D28}|M1`, day: D28 }]) && q.nContrib(w.db, 'c4') === 8,
    J({ ledger: q.tripRows(w.db), contrib: q.nContrib(w.db, 'c4') }));
});
await attempt('C5', async () => {
  // 兩條偏遠線（南迴線＋臺東線）：×2 是整班車一次，不是每條偏遠線各 ×2。
  const w = cWorld();
  putBatches(w.db, { actor: 'c5', trainNo: 'E1', lnId: '南迴線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
  putBatches(w.db, { actor: 'c5', trainNo: 'E1', lnId: '臺東線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
  await w.cron();
  ok('C5 [F4] 南迴線＋臺東線（都是偏遠線）各 400 秒：整班車 ×2 一次＝2 顆（不是 4）',
    J(q.tripRows(w.db)) === J([{ actor: 'c5', delta: 2, ref: `c5|${D28}|E1`, day: D28 }]), J(q.tripRows(w.db)));
});
await attempt('C6', async () => {
  // 屏東線 ok、南迴線那一組只有 5 個點（判 unusable、沒有任何覆蓋段）：整班車任一線 ok 就算 ok，
  // 但 ×2 只看「ok 那些組的覆蓋段」——南迴線那一組沒有貢獻任何段，不能讓這班車沾到 ×2。
  const w = cWorld();
  putBatches(w.db, { actor: 'c6', trainNo: 'K1', lnId: '屏東線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
  putBatches(w.db, { actor: 'c6', trainNo: 'K1', lnId: '南迴線', pts: leg({ sec: 4, t0: 30701 }), first: 100 });
  const st = await w.cron();
  ok('C6a [F4] 屏東線 ok、南迴線 5 點判 unusable；籌碼 1 顆（不是 2）、只登記屏東線的 7 段',
    q.verdictsLn(w.db, 'c6', 'K1', '屏東線') === 'ok' && q.verdictsLn(w.db, 'c6', 'K1', '南迴線') === 'unusable' &&
      J(q.tripRows(w.db)) === J([{ actor: 'c6', delta: 1, ref: `c6|${D28}|K1`, day: D28 }]) &&
      J(q.contribKeys(w.db, 'c6')) === J(keysOf('屏東線', S7)) && st.ok === 1 && st.unusable === 1,
    J({ p: q.verdictsLn(w.db, 'c6', 'K1', '屏東線'), n: q.verdictsLn(w.db, 'c6', 'K1', '南迴線'), ledger: q.tripRows(w.db), st }));
});
await attempt('C7', async () => {
  // 截斷切在「整班車」的邊界。review-B 之後單發上限是 4000 班（班車清單的列數，不是樣本列數），一班車的批次是第二段一次讀齊的，
  // 所以一班車不可能被切成兩半；這裡驗「超過上限的那一班整班留到下一發、下一發整班一起判」。
  // 4000 班單批的填充車（f0001…f4000）＋一班三批的 ZZ 車，共 4001 班、4003 列。同一個 actor 的班車依（乘車日、actor、車次）排隊
  // （同一個人的第幾班；隨機只用來打散不同人的同一輪），所以 zz01 一定是第 4001 班、被截掉。
  const w = world();
  // 4000 班填充車在預設子請求預算（8000）下一發做不完（停在預算是 S13b 的行為）；這一條驗的是截斷，
  // 所以把預算調到用不完，讓停手的原因只剩截斷（預算停手另有 verify_bounty_cron2.mjs 的 M 組專驗）。
  w.env.BOUNTY_SUBREQ_BUDGET = '1000000';
  w.db.exec('BEGIN');
  const ins = w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
    " VALUES (?,'trunc-a','tra_sched','山線',?,0,?,?,NULL,?,'pending',?)");
  for (let i = 1; i <= 4000; i++) ins.run(`fill-${i}`, 'f' + String(i).padStart(4, '0'), D28, '[]', NOW_MS - 3600e3, J(APP));
  w.db.exec('COMMIT');
  const zz = leg({ sec: 750, speed: 10 });                               // 751 點，切 3 批（251／251／249）＝ZZ 車
  putBatches(w.db, { actor: 'trunc-a', trainNo: 'zz01', lnId: '山線', pts: zz, size: 251 });
  const total = w.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c;
  const s1 = await w.cron();
  const zzPending = w.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE train_no='zz01' AND verdict='pending'").get().c;
  const filled = w.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE train_no LIKE 'f%' AND verdict!='pending'").get().c;
  ok('C7a [F4 截斷] 4001 班（4003 列）pending：這一發截斷（truncated）、4000 班填充車判掉（trains 4000），ZZ 車三批一批都沒動',
    total === 4003 && s1.truncated === true && s1.trains === 4000 && filled === 4000 && zzPending === 3 && q.chips(w.db, 'trunc-a') === 0,
    J({ total, truncated: s1.truncated, trains: s1.trains, filled, zzPending, chips: q.chips(w.db, 'trunc-a') }));
  const s2 = await w.cron();
  ok('C7b [F4 截斷] 下一發只剩 ZZ 車：三批併成一趟一起判＝750 秒 ≥ 600 → 1 顆（ref＝trunc-a|乘車日|zz01）、不再截斷',
    q.verdicts(w.db, 'trunc-a', 'zz01') === 'ok' && s2.truncated === false && s2.trips === 1 &&
      J(q.tripRows(w.db)) === J([{ actor: 'trunc-a', delta: 1, ref: `trunc-a|${D28}|zz01`, day: D28 }]),
    J({ v: q.verdicts(w.db, 'trunc-a', 'zz01'), st: s2, ledger: q.tripRows(w.db) }));
});
await attempt('C9', async () => {
  // 線的分組鍵是 sys|ln_id（與題庫 M.lines 同一個鍵空間），不是單獨的 ln_id：同名不同系統的兩批不能併成一組。
  // 這裡故意讓一批用 sys=thsr_sched、ln_id=山線（題庫裡沒有這條線 → 那一組判 unusable），另一批是正常的 tra_sched 山線。
  const w = cWorld();
  putBatches(w.db, { actor: 'c9', trainNo: 'X1', lnId: '山線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
  putBatches(w.db, { actor: 'c9', trainNo: 'X1', lnId: '山線', sys: 'thsr_sched', pts: leg({ sec: 4, t0: 30701 }), first: 100 });
  const st = await w.cron();
  ok('C9 [F4] 同名 ln_id（山線）、不同 sys 的兩批各自成組：tra_sched 那組 ok（登記 7 段、籌碼 1）、thsr_sched 那組因題庫沒有這條線判 unusable（trips 2）',
    st.trips === 2 && st.ok === 1 && st.unusable === 1 && J(q.contribKeys(w.db, 'c9')) === J(keysOf('山線', S7)) &&
      J(q.tripRows(w.db)) === J([{ actor: 'c9', delta: 1, ref: `c9|${D28}|X1`, day: D28 }]),
    J({ st, contrib: q.contribKeys(w.db, 'c9').length, ledger: q.tripRows(w.db) }));
});
await attempt('C8', async () => {
  // 重跑不重複：把已判定的樣本改回 pending 再跑一次，帳本、貢獻、每段人數完全不變（跨線的一班車也一樣）。
  const w = cWorld();
  putBatches(w.db, { actor: 'c8', trainNo: 'F1', lnId: '屏東線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
  putBatches(w.db, { actor: 'c8', trainNo: 'F1', lnId: '南迴線', pts: leg({ sec: 700, t0: 30701 }), first: 100 });
  const snap = () => J({
    ledger: w.db.prepare('SELECT id,actor,kind,delta,ref,day FROM chip_ledger ORDER BY id').all().map(r => ({ ...r })),
    contrib: w.db.prepare('SELECT seg_key,actor FROM bounty_seg_contrib ORDER BY seg_key,actor').all().map(r => ({ ...r })),
    distinct: w.db.prepare('SELECT seg_key,train_kind,distinct_ok_users d FROM bounty_board ORDER BY seg_key,train_kind').all().map(r => ({ ...r })),
  });
  await w.cron();
  const first = snap();
  w.db.exec("UPDATE bounty_samples SET verdict='pending', verdict_at=NULL, segs=NULL");
  const st2 = await w.cron(NOW_MS + 3600e3);
  ok('C8a [F4 冪等] 同一班車重判一次：帳本 1 列（delta 2）與內容、貢獻 14 列、每段人數完全不變，且重判確實發生（trips 2）、這次入帳 0',
    J(JSON.parse(first).ledger.map(r => r.delta)) === '[2]' && JSON.parse(first).contrib.length === 14 && first === snap() && st2.trips === 2 && st2.chips === 0,
    J({ nLedger: JSON.parse(first).ledger.length, nContrib: JSON.parse(first).contrib.length, same: first === snap(), st2 }));
  // 中途壞掉：籌碼與貢獻都已經寫完、第一句「標記已判定」丟例外 → 樣本仍 pending；補好之後下一發整班重跑，不重複發、不重複 +1。
  const w2 = cWorld();
  putBatches(w2.db, { actor: 'c8x', trainNo: 'F2', lnId: '屏東線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
  putBatches(w2.db, { actor: 'c8x', trainNo: 'F2', lnId: '南迴線', pts: leg({ sec: 700, t0: 30701 }), first: 100 });
  const origBatch = w2.DELAY_DB.batch.bind(w2.DELAY_DB);
  let crash = true;
  w2.DELAY_DB.batch = async stmts => {
    if (crash && stmts.some(s => /^UPDATE bounty_samples (?:INDEXED BY \w+ )?SET verdict/.test(s._sql))) throw new Error('injected: crash before marking');
    return origBatch(stmts);
  };
  // review-B R3 之後一班車的錯誤在判定裡接住（不再整發丟例外）：記下這一班（kv_blobs 一列）、繼續下一班（獨立驗收 N4 之後不再停手），
  // stat.errors＝1、stat.error 帶錯誤訊息、stopBy 不是 error（只有連記錄都寫不進 D1 才停手）
  let threw = '', st1 = null;
  try { st1 = await w2.cron(); } catch (e) { threw = String(e.message || e); }
  const nStrike = () => w2.db.prepare("SELECT COUNT(*) c FROM kv_blobs WHERE k LIKE 'bounty_verify_strike|%'").get().c;
  const mid = { pending: q.nPending(w2.db), ledger: q.tripRows(w2.db).length, contrib: q.nContrib(w2.db, 'c8x'), d: q.board(w2.db, KT('屏東線', 'S0|S1'))[0].distinct_ok_users,
    strike: w2.db.prepare("SELECT COUNT(*) c FROM kv_blobs WHERE k LIKE 'bounty_verify_strike|c8x|%|F2'").get().c };
  crash = false;
  const st3 = await w2.cron(NOW_MS + 3600e3);
  ok('C8b [F4 冪等] 標記那個 batch 壞掉：cron 接住、記下這一班（1 列）、不停手（errors 1、stopBy 不是 error、錯誤訊息 injected）、樣本全留 pending，但籌碼 1 列與貢獻 14 段已寫（在標記之前）',
    threw === '' && st1 && st1.errors === 1 && st1.stopBy === null && /injected/.test(st1.error) && mid.pending === 8 && mid.ledger === 1 && mid.contrib === 14 &&
      mid.d === 1 && mid.strike === 1,
    J({ threw, errors: st1 && st1.errors, stopBy: st1 && st1.stopBy, error: st1 && st1.error, mid }));
  ok('C8c [F4 冪等] 補好之後下一發整班重跑：樣本全判成 ok、帳本仍只有 1 列（delta 2）、貢獻仍 14 段、每段人數仍 1（沒有重複入帳、重複 +1）；這次入帳 0；出錯記錄刪掉（0 列）',
    q.nPending(w2.db) === 0 && q.verdicts(w2.db, 'c8x', 'F2') === 'ok' && J(q.tripRows(w2.db).map(r => r.delta)) === '[2]' &&
      q.nContrib(w2.db, 'c8x') === 14 && q.board(w2.db, KT('屏東線', 'S0|S1'))[0].distinct_ok_users === 1 &&
      q.board(w2.db, KT('南迴線', 'S6|S7'))[0].distinct_ok_users === 1 && st3.chips === 0 && nStrike() === 0,
    J({ pending: q.nPending(w2.db), ledger: q.tripRows(w2.db), contrib: q.nContrib(w2.db, 'c8x'), st3, strike: nStrike() }));
});

// ═══ D 組：身分在入帳當下重新解析、同一班車不重複發（F10／F11）════════════════════════
const DEV = 'dev-cron-0001', UID = 'uid-cron-0001';
await attempt('D1', async () => {
  // 前半趟以裝置 token 判定入帳 1 顆 → 登入合併（帳本整批改名到 uid、ref 不變）→ 後半趟晚到、以 uid 上傳、隔天單獨判。
  // 舊行為：後半趟的趟鍵是 uid|日|車，不撞前半趟的 dev|日|車 → 同一班車發兩次。
  const w = world({ seed: boardAll(['山線']) });
  putBatches(w.db, { actor: DEV, trainNo: '202', lnId: '山線', pts: leg({ sec: 750, speed: 10, t0: 30000, d0: 0 }) });
  const s1 = await w.cron();
  const beforeMerge = q.chips(w.db, DEV);
  const mst = await mergeInto(w, DEV, UID);
  const afterMerge = { uid: q.chips(w.db, UID), dev: q.nLedger(w.db, DEV) }, rowsAfterMerge = q.tripRows(w.db);
  putBatches(w.db, { actor: UID, trainNo: '202', lnId: '山線', pts: leg({ sec: 750, speed: 10, t0: 30751, d0: 7500 }), first: 100 });
  const s2 = await w.cron(NOW_MS + 3600e3);
  ok('D1a [F11 前置] 前半趟：裝置入帳 1 顆；合併之後這一顆在 uid 名下（ref 仍是裝置 token 開頭）',
    s1.chips === 1 && beforeMerge === 1 && mst === 200 && afterMerge.uid === 1 && afterMerge.dev === 0 &&
      J(rowsAfterMerge) === J([{ actor: UID, delta: 1, ref: `${DEV}|${D28}|202`, day: D28 }]),
    J({ s1: s1.chips, beforeMerge, mst, afterMerge, ledger: rowsAfterMerge }));
  ok('D1b [F11] 後半趟（uid 上傳、判 ok）不再入帳：同一班車 uid 名下已有這一天這個車次的 trip 列 → 這次入帳 0、帳本仍只有那 1 列',
    q.verdicts(w.db, UID, '202') === 'ok' && s2.chips === 0 && q.chips(w.db, UID) === 1 && q.tripRows(w.db).length === 1,
    J({ v: q.verdicts(w.db, UID, '202'), st2: s2.chips, chips: q.chips(w.db, UID), rows: q.tripRows(w.db) }));
  ok('D1c [F11] 去重人數仍是一個人：兩半趟合起來覆蓋 S0|S1…S6|S7，每段人數都是 1（不是裝置與 uid 各算一次）',
    J(SEGS10.slice(0, 7).map(s => q.board(w.db, KT('山線', s))[0].distinct_ok_users)) === J([1, 1, 1, 1, 1, 1, 1]) && q.nContrib(w.db, UID) === 7,
    J({ d: SEGS10.slice(0, 7).map(s => q.board(w.db, KT('山線', s))[0].distinct_ok_users), contrib: q.nContrib(w.db, UID) }));
});
await attempt('D2', async () => {
  // 不能把「已經入過帳」比對得太寬：同一個 actor 同一個車次號、隔一天再搭，是另一班車，要各入帳一次。
  const w = world({ seed: boardAll(['山線']) });
  putBatches(w.db, { actor: 'd2-actor', trainNo: '203', lnId: '山線', date: D27, pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: 'd2-actor', trainNo: '203', lnId: '山線', date: D28, pts: leg({ sec: 700 }) });
  await w.cron();
  ok('D2 [F11 對照] 同一個 actor、同一個車次號 203、不同天（07-27、07-28）：各入帳 1 顆（兩列），不會被當成同一班車',
    J(q.tripRows(w.db).map(r => `${r.ref}:${r.delta}`)) === J([`d2-actor|${D27}|203:1`, `d2-actor|${D28}|203:1`]), J(q.tripRows(w.db)));
});
await attempt('D3', async () => {
  // 比對的是「|乘車日|車次」的完整結尾：車次 20 不能被車次 120 的列擋掉（結尾比對前面必須是分隔符，不是子字串）。
  const w = world({ seed: boardAll(['山線']) });
  putBatches(w.db, { actor: 'd3-actor', trainNo: '120', lnId: '山線', pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: 'd3-actor', trainNo: '20', lnId: '山線', pts: leg({ sec: 700 }) });
  await w.cron();
  ok('D3 [F11 對照] 同一天車次 120 與車次 20：各入帳 1 顆（共 2 列），不會因為 "20" 是 "120" 的結尾就當成同一班',
    J(q.tripRows(w.db).map(r => `${r.ref}:${r.delta}`)) === J([`d3-actor|${D28}|120:1`, `d3-actor|${D28}|20:1`]), J(q.tripRows(w.db)));
});
await attempt('D6', async () => {
  // 前半趟 dev 已入帳（第一發 cron）；後半趟也是 dev 上傳、留在 pending（第二發 cron 讀到時 actor 還是 dev），
  // 第二發 cron 讀完之後、入帳之前才合併：帳本那一列已改名成 uid。「這班車已入帳」的查詢要用當下的身分（uid）才找得到——
  // 用讀樣本時的 dev 去找會找不到，同一班車發兩次（ref 分別是 dev|日|車 與 uid|日|車，UNIQUE 擋不住）。
  const w = world({ seed: boardAll(['山線']) });
  putBatches(w.db, { actor: DEV, trainNo: '303', lnId: '山線', pts: leg({ sec: 750, speed: 10, t0: 30000, d0: 0 }) });
  const s1 = await w.cron();
  putBatches(w.db, { actor: DEV, trainNo: '303', lnId: '山線', pts: leg({ sec: 750, speed: 10, t0: 30751, d0: 7500 }), first: 100 });
  const hook = hookOnce(w.DELAY_DB, /FROM tra_station_events WHERE service_date/, async () => { await mergeInto(w, DEV, UID); });
  const s2 = await w.cron(NOW_MS + 3600e3);
  ok('D6 [F10＋F11] 後半趟讀完之後才合併：這班車已在 uid 名下入過帳 → 不再入帳（帳本仍 1 列 delta 1、這次入帳 0）；後半趟樣本照判 ok',
    s1.chips === 1 && hook.fired === 1 && s2.chips === 0 && q.tripRows(w.db).length === 1 && q.chips(w.db, UID) === 1 && q.verdicts(w.db, UID, '303') === 'ok',
    J({ s1: s1.chips, fired: hook.fired, s2: s2.chips, ledger: q.tripRows(w.db), v: q.verdicts(w.db, UID, '303') }));
});
await attempt('D4', async () => {
  // 合併發生在「cron 讀完樣本」之後、「入帳」之前（注入點：第一次查逐站事件之前，那一步在判定迴圈裡、早於入帳與登記）。
  // 入帳與登記都要用「當下」的身分＝uid：帳本列掛 uid、貢獻掛 uid；uid 自己也交過同一段時人數不多算 1。
  const w = world({ seed: boardSql('tra_sched', '山線', [{ distinctOf: { 'S0|S1': 1 } }]) +
    `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ('${KT('山線', 'S0|S1')}','${UID}',1);` });
  putBatches(w.db, { actor: DEV, trainNo: '301', lnId: '山線', pts: leg({ sec: 700 }) });
  let mst = null;
  const hook = hookOnce(w.DELAY_DB, /FROM tra_station_events WHERE service_date/, async () => { mst = await mergeInto(w, DEV, UID); });
  const st = await w.cron();
  ok('D4a [F10 注入] 合併確實發生在 cron 讀樣本之後（注入點觸發 1 次、合併 200）', hook.fired === 1 && mst === 200, J({ fired: hook.fired, mst }));
  ok('D4b [F10] 籌碼入在 uid 名下：帳本 1 列、actor＝uid、ref＝uid|乘車日|301、delta 1；裝置名下 0 列；stat.chips 1',
    J(q.tripRows(w.db)) === J([{ actor: UID, delta: 1, ref: `${UID}|${D28}|301`, day: D28 }]) && q.nLedger(w.db, DEV) === 0 && st.chips === 1,
    J({ ledger: q.tripRows(w.db), dev: q.nLedger(w.db, DEV), chips: st.chips }));
  ok('D4c [F10] 貢獻登記在 uid 名下（7 段）、裝置名下 0 段；uid 原本就交過的 S0|S1 人數不多算（仍 1），其餘 6 段各 1、沒經過的 S7|S8 為 0',
    q.nContrib(w.db, UID) === 7 && q.nContrib(w.db, DEV) === 0 &&
      J(SEGS10.map(s => q.board(w.db, KT('山線', s))[0].distinct_ok_users)) === J([1, 1, 1, 1, 1, 1, 1, 0, 0]),
    J({ uid: q.nContrib(w.db, UID), dev: q.nContrib(w.db, DEV), d: SEGS10.map(s => q.board(w.db, KT('山線', s))[0].distinct_ok_users) }));
});
await attempt('D5', async () => {
  // 每日上限也要用「當下」的身分：uid 這一天已經拿滿 4 顆，裝置的這一趟在入帳前才併進 uid → 上限擋下、一顆都不入。
  const seed = [1, 2, 3, 4].map(i => `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES ('seed-${i}','${UID}','trip',1,'seed${i}|${D28}|90${i}','${D28}',1);`).join('\n');
  const w = world({ seed: boardAll(['山線']) + '\n' + seed });
  putBatches(w.db, { actor: DEV, trainNo: '302', lnId: '山線', pts: leg({ sec: 700 }) });
  hookOnce(w.DELAY_DB, /FROM tra_station_events WHERE service_date/, async () => { await mergeInto(w, DEV, UID); });
  const st = await w.cron();
  ok('D5 [F10] uid 當天已滿 4 顆、裝置的趟在入帳前併進 uid：不入帳（uid 仍 4、沒有 302 那列、裝置名下 0 列、這次入帳 0）；樣本照判 ok',
    q.chips(w.db, UID, D28) === 4 && q.tripRows(w.db).length === 4 && !q.tripRows(w.db).some(r => r.ref.endsWith('|302')) &&
      q.nLedger(w.db, DEV) === 0 && st.chips === 0 && q.verdicts(w.db, UID, '302') === 'ok',
    J({ uid: q.chips(w.db, UID, D28), rows: q.tripRows(w.db).length, dev: q.nLedger(w.db, DEV), chips: st.chips, v: q.verdicts(w.db, UID, '302') }));
});

// ═══ E 組：模擬器只留判定（F23）═══════════════════════════════════════════════════
const eSeed = () => boardSql('tra_sched', '南迴線', [{}]) +
  `INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status)` +
  ` VALUES ('claim-sim','sim-e1','${KT('南迴線', 'S0|S1')}','自強',0,'track','',3,1,${NOW_MS + DAY},'open');`;
await attempt('E1', async () => {
  const w = world({ seed: eSeed() });
  putBatches(w.db, { actor: 'sim-e1', trainNo: 'E1S', lnId: '南迴線', pts: leg({ sec: 700 }), client: SIM });
  putBatches(w.db, { actor: 'real-e1', trainNo: 'E1R', lnId: '南迴線', pts: leg({ sec: 700 }) });
  await w.cron();
  const simRow = w.db.prepare("SELECT verdict,verdict_at,segs,quality_code,reject_code FROM bounty_samples WHERE actor='sim-e1' LIMIT 1").get();
  ok('E1a [F23] 模擬器的趟只留判定：每一列 verdict＝ok、verdict_at＝這一發的時間、segs 留下 7 段（判定結果仍寫回，QA 看得到）',
    q.verdicts(w.db, 'sim-e1', 'E1S') === 'ok' && simRow.verdict_at === NOW_MS && JSON.parse(simRow.segs).length === 7,
    J({ v: q.verdicts(w.db, 'sim-e1', 'E1S'), at: simRow.verdict_at, nSegs: JSON.parse(simRow.segs || '[]').length }));
  ok('E1b [F23] 模擬器：帳本 0 列、貢獻 0 段、沒有點數列、認領仍 open（不關認領）',
    q.nLedger(w.db, 'sim-e1') === 0 && q.nContrib(w.db, 'sim-e1') === 0 && q.nPoints(w.db, 'sim-e1') === 0 &&
      w.db.prepare("SELECT status FROM bounty_claims WHERE id='claim-sim'").get().status === 'open',
    J({ ledger: q.nLedger(w.db, 'sim-e1'), contrib: q.nContrib(w.db, 'sim-e1'), points: q.nPoints(w.db, 'sim-e1'),
      claim: w.db.prepare("SELECT status FROM bounty_claims WHERE id='claim-sim'").get().status }));
  const b = q.board(w.db, KT('南迴線', 'S0|S1'))[0];
  ok('E1c [F23 對照] 同樣的趟、simulator:false 的另一位：帳本 2 顆（南迴 ×2；0 不是因為整條路壞了）、貢獻 7 段、有點數列',
    q.chips(w.db, 'real-e1') === 2 && q.nContrib(w.db, 'real-e1') === 7 && q.nPoints(w.db, 'real-e1') === 1,
    J({ chips: q.chips(w.db, 'real-e1'), contrib: q.nContrib(w.db, 'real-e1'), points: q.nPoints(w.db, 'real-e1') }));
  ok('E1d [F23] 看板只算真機那一位：S0|S1 的 distinct_ok_users 1、sample_count 1（不是 2）、沒收滿',
    b.distinct_ok_users === 1 && b.sample_count === 1 && b.covered_at === null, J(b));
});
await attempt('E2', async () => {
  // 模擬器灌人數收滿：這一段已有 49 位、門檻 50。模擬器那一趟不能是第 50 位（收滿會讓卡片下架）；真機那一趟才是。
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{ distinct: 49 }]) + '\n' + stuffSql('tra_sched', '南迴線', 49) });
  putBatches(w.db, { actor: 'sim-e2', trainNo: 'E2S', lnId: '南迴線', pts: leg({ sec: 700 }), client: SIM });
  await w.cron();
  const afterSim = q.board(w.db, KT('南迴線', 'S0|S1'))[0];
  putBatches(w.db, { actor: 'real-e2', trainNo: 'E2R', lnId: '南迴線', pts: leg({ sec: 700 }) });
  await w.cron(NOW_MS + 3600e3);
  const afterReal = q.board(w.db, KT('南迴線', 'S0|S1'))[0];
  ok('E2a [F23] 模擬器那一趟之後：S0|S1 仍是 49 位、沒收滿（模擬器不是「第 50 位」）', afterSim.distinct_ok_users === 49 && afterSim.covered_at === null, J(afterSim));
  ok('E2b [F23 對照] 真機那一趟之後：50 位、收滿（covered_at＝這一發的時間）——沒收滿不是因為整條路壞了',
    afterReal.distinct_ok_users === 50 && afterReal.covered_at === NOW_MS + 3600e3, J(afterReal));
});
await attempt('E3', async () => {
  // 一趟有很多批，任何一批自報模擬器整趟就是模擬器（不能靠混一批真機洗掉旗標）：貢獻 0、看板不動。
  const w = world({ seed: boardSql('tra_sched', '山線', [{}]) });
  putBatches(w.db, { actor: 'mix-e3', trainNo: 'E3', lnId: '山線', pts: leg({ sec: 700 }), client: [APP, SIM, APP, APP] });
  await w.cron();
  const b = q.board(w.db, KT('山線', 'S0|S1'))[0];
  ok('E3 [F23] 四批裡只有一批自報 simulator:true → 整趟 ok（判定照寫）、帳本 0、貢獻 0、看板不動（distinct 0、sample_count 0）',
    q.verdicts(w.db, 'mix-e3', 'E3') === 'ok' && q.nLedger(w.db, 'mix-e3') === 0 && q.nContrib(w.db, 'mix-e3') === 0 && b.distinct_ok_users === 0 && b.sample_count === 0,
    J({ v: q.verdicts(w.db, 'mix-e3', 'E3'), ledger: q.nLedger(w.db, 'mix-e3'), contrib: q.nContrib(w.db, 'mix-e3'), b }));
});

// ═══ F 組：估值上架時帶入的去重人數（F12）═════════════════════════════════════════
const U = (segKey, trainKind, over = {}) => ({ segKey, sys: 'tra_sched', trainKind, dir: 0, kind: 'track', slot: '', perDay: 30, ...over });
await attempt('F1', async () => {
  // X：板上已有一列（人數 5），貢獻列只剩 3 位（另兩位刪了帳號、刪帳號只刪貢獻列不回扣人數）→ 新上架的兄弟列要帶 5，不是 3。
  // Y：板上沒有這一段任何列、貢獻列 2 位 → 新列 2（貢獻列數仍是來源）。
  // Z：板上人數 1、貢獻列 4 位（資料漂移）→ 新列 4（取較大者，不是只信板上）。
  const X = KT('山線', 'S0|S1'), Y = KT('山線', 'S1|S2'), Z = KT('山線', 'S2|S3');
  const contrib = (k, n) => Array.from({ length: n }, (_, i) => `('${k}','p-${i}',1)`).join(',');
  const seed = boardSql('tra_sched', '山線', [{ distinct: 5 }], ['S0|S1']) + boardSql('tra_sched', '山線', [{ distinct: 1 }], ['S2|S3']) +
    `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ${contrib(X, 3)},${contrib(Y, 2)},${contrib(Z, 4)};`;
  const w = world({ seed, units: { generatedAt: 1, schedDate: D28, lines: LINES, units: [U(X, '區間車'), U(Y, '自強'), U(Z, '區間車')] } });
  const v = await w.valuation();
  const d = (k, tk) => (q.board(w.db, k).find(r => r.train_kind === tk) || {}).distinct_ok_users;
  ok('F1a [F12] 新上架 3 列（X 區間車、Y 自強、Z 區間車）', v.inserted === 3, J(v));
  ok('F1b [F12] X 新列＝5（板上既有列的人數 5，比貢獻列數 3 大 → 取 5；舊列 5 不動）', d(X, '區間車') === 5 && d(X, '自強') === 5, J({ 新列: d(X, '區間車'), 舊列: d(X, '自強') }));
  ok('F1c [F12 對照] Y 新列＝2（板上沒有既有列 → 取貢獻列數 2）；Z 新列＝4（貢獻列數 4 比板上的 1 大 → 取 4）', d(Y, '自強') === 2 && d(Z, '區間車') === 4,
    J({ Y: d(Y, '自強'), Z: d(Z, '區間車') }));
});

// ═══ G 組：估值上架時，人數已達門檻的新列補寫收滿（F21）═══════════════════════════════
await attempt('G1', async () => {
  // 換班表新增車種／時段時，「段」的人數早已達門檻：新上架的兄弟列不能是開著的（covered_at 為空＝看板當成可接）。
  // 台鐵門檻 50、高鐵門檻 15（bounty_rules.json）。各種一組剛好達標、一組差 1 位。
  const T50 = KT('山線', 'S0|S1'), T49 = KT('山線', 'S1|S2');
  const H15 = segKey('thsr_sched', 'THSR', 'S0|S1'), H14 = segKey('thsr_sched', 'THSR', 'S1|S2');
  const contrib = (k, n) => Array.from({ length: n }, (_, i) => `('${k}','p-${i}',1)`).join(',');
  const seed = `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ${contrib(T50, 50)},${contrib(T49, 49)},${contrib(H15, 15)},${contrib(H14, 14)};`;
  const units = [U(T50, '自強'), U(T50, '區間車'), U(T49, '自強'), U(T49, '區間車'),
    U(H15, '標準', { sys: 'thsr_sched' }), U(H15, '商務', { sys: 'thsr_sched' }), U(H14, '標準', { sys: 'thsr_sched' }), U(H14, '商務', { sys: 'thsr_sched' })];
  const w = world({ seed, units: { generatedAt: 1, schedDate: D28, lines: LINES, units } });
  const v = await w.valuation();
  const rows = k => w.db.prepare('SELECT distinct_ok_users d, covered_at c, first_listed_at f FROM bounty_board WHERE seg_key=? ORDER BY train_kind').all(k).map(r => ({ ...r }));
  const stamped = rs => rs.length === 2 && rs.every(r => r.c !== null && r.c === r.f);
  ok('G1a [F21] 新上架 8 列、人數帶入正確（台鐵 50／49、高鐵 15／14）', v.inserted === 8 &&
    rows(T50).every(r => r.d === 50) && rows(T49).every(r => r.d === 49) && rows(H15).every(r => r.d === 15) && rows(H14).every(r => r.d === 14),
    J({ v, t50: rows(T50), h15: rows(H15) }));
  ok('G1b [F21] 台鐵：人數剛好 50 的段，兩列（兩個車種）新上架就已收滿（covered_at＝上架那一刻）；49 的段兩列都還開著（covered_at 為空）',
    stamped(rows(T50)) && rows(T49).every(r => r.c === null), J({ t50: rows(T50), t49: rows(T49) }));
  ok('G1c [F21] 高鐵：門檻取 THSR 的 15（不是台鐵的 50）——人數 15 的段兩列已收滿；14 的段兩列還開著',
    stamped(rows(H15)) && rows(H14).every(r => r.c === null), J({ h15: rows(H15), h14: rows(H14) }));
});

// ═══ H 組：換班表之後退場的單位（第十二輪獨立驗收 P2-1）═══════════════════════════════════
// 山線 S0|S1…S8|S9 每段兩個車種：自強 30 班、區間車 2 班 → 中位 16：自強 16/30 → L1 1（點數 1）、區間車 16/2＝8 → 頂格 3（點數 3）。
// 換班表之後清單只剩自強（中位 30 → 自強點數仍是 1）：區間車的 9 列退場。期望值手算寫死：
// 沒接懸賞的人跑 S0→S7（前 7 段）拿 7×1＝7 點；退場的區間車若還算進板價（同一段取各車種最高價），會是 7×3＝21。
await attempt('H1', async () => {
  const unitsOf = kinds => SEGS10.flatMap(s => kinds.map(([trainKind, perDay]) =>
    ({ segKey: KT('山線', s), sys: 'tra_sched', trainKind, dir: 0, kind: 'track', slot: '', perDay })));
  const units = { generatedAt: 1, schedDate: D28, lines: LINES, units: unitsOf([['自強', 30], ['區間車', 2]]) };
  const w = world({ units });
  const board = async () => (await (await _bounty.bountyBoard(new Request('https://railisland.tw/api/bounty-board'), w.env)).json()).cards || [];
  const claim = (actor, cardId) => _bounty.bountyClaim(new Request('https://railisland.tw/api/bounty-claim',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ actor, cardId }) }), w.env);
  const LOCAL = 'tra_sched|山線|0|區間車|track|', EXP = 'tra_sched|山線|0|自強|track|';
  const card = (cs, id) => cs.find(c => c.id === id);
  await w.valuation();
  const b0 = await board();
  const c0 = await claim('h1-keeper-01', LOCAL);                       // 換班表之前接下區間車（鎖 3 點）
  ok('H1a [P2-1 對照] 換班表之前：看板有區間車（9 段共 27 點）與自強（9 點）兩張卡，區間車接得下（200）',
    !!card(b0, LOCAL) && card(b0, LOCAL).points === 27 && !!card(b0, EXP) && card(b0, EXP).points === 9 && c0.status === 200,
    J({ cards: b0.map(c => [c.id, c.points]), claim: c0.status }));
  units.units = unitsOf([['自強', 30]]);
  const v = await w.valuation();
  const b1 = await board();
  const gone = w.db.prepare('SELECT train_kind, COUNT(*) n FROM bounty_board WHERE retired=1 GROUP BY train_kind').all().map(r => ({ ...r }));
  ok('H1b [P2-1] 換班表之後：區間車 9 列退場（列還在、retired 1）、自強不動；估值回報退場 9、新上架 0；看板只剩自強那張（9 點）',
    v.retired === 9 && v.inserted === 0 && J(gone) === J([{ train_kind: '區間車', n: 9 }]) && !card(b1, LOCAL) && !!card(b1, EXP) && card(b1, EXP).points === 9,
    J({ v, gone, cards: b1.map(c => [c.id, c.points]) }));
  const c1 = await claim('h1-late-0001', LOCAL), c2 = await claim('h1-late-0001', EXP);
  const c1body = await c1.json();
  ok('H1c [P2-1] 退場的區間車接不了（404 no_open_units）；同一個人接自強照常（200）',
    c1.status === 404 && c1body.error === 'no_open_units' && c2.status === 200, J({ local: [c1.status, c1body.error], exp: c2.status }));
  putBatches(w.db, { actor: 'h1-rider-01', trainNo: 'H1', lnId: '山線', pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: 'h1-keeper-01', trainNo: 'H2', lnId: '山線', pts: leg({ sec: 700 }) });
  const st = await w.cron();
  const pts = a => (w.db.prepare('SELECT points FROM bounty_points WHERE actor=?').get(a) || {}).points;
  ok('H1d [P2-1] 沒接懸賞直接錄 S0→S7：7 段各取板上沒退場的最高價（自強 1）＝7 點，不是退場區間車的 7×3＝21',
    q.verdicts(w.db, 'h1-rider-01', 'H1') === 'ok' && pts('h1-rider-01') === 7, J({ v: q.verdicts(w.db, 'h1-rider-01', 'H1'), pts: pts('h1-rider-01'), st }));
  const done = w.db.prepare("SELECT COUNT(*) c FROM bounty_claims WHERE actor='h1-keeper-01' AND status='fulfilled'").get().c;
  ok('H1e [P2-1 對照] 退場之前就接下區間車的人：照鎖定價兌現（7 段×3＝21 點），那 7 段的認領關成 fulfilled',
    q.verdicts(w.db, 'h1-keeper-01', 'H2') === 'ok' && pts('h1-keeper-01') === 21 && done === 7,
    J({ v: q.verdicts(w.db, 'h1-keeper-01', 'H2'), pts: pts('h1-keeper-01'), done }));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
