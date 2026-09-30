// 路段懸賞 v2 後端驗收（八）：review-B 修補的端到端證明——審查者重現過的每一種攻擊與中斷，修補後逐條再跑一次，結果必須是「不再重現」。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ Firebase 替身 ＋ BOUNTY_NOW 釘死，不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_hardening.mjs
//
// 期望值一律寫死在這裡，不呼叫實作去產生期望（日期自己用 Date 算、點數與籌碼自己手算並寫出算式）。來源：
//   ・缺陷與修法都是 review-B（主對話派的獨立審查）與修補之後那一輪獨立驗收（N2／N3／N4）的發現、加上主對話的修補設計，
//     不是使用者逐字裁示；沒有任何一條是使用者原話。
//   ・數字（每趟至少 600 秒、每日籌碼上限 4、第一座 4 之後每座 8、每日計點上限 200、日期窗 7 天、每人每日 720 批）
//     來自 data/bounty_rules.json 與 worker.js 的常數，這裡照抄成字面。
// 每一條判準寫的時候都先答「哪一個突變能讓它變紅」——突變表在 commit 訊息與回報裡。
//
// 分組（括號裡是 review-B 的編號）：
//   B1  上傳窗與防偽閘同一條台北日（走真的上傳端點再跑判定）
//   B3  判定順序：可信身分先、每人輪流、同一輪隨機（a 可信先／b 輪流／c 隨機／e 每人前 8 班）
//   B4  賺的端點帶了別的帳號的 Bearer → 403，一列不寫
//   B5  帶 Bearer 讀取（chips-me／bounty-me）也跑 S0：別人預先掛上的 merged_into 被清掉
//   B6  髒帳號列（uid 與 merged_into 都有值）：判定記在帳號本人，不跟 merged_into
//   C2  合併落在判定途中（讀認領那一刻）：點數、認領都記對人；C2b／C2c 落在寫帳本、去重登記的前一刻：籌碼與登記記對人（獨立驗收 V3）
//   C2s 合併落在第二發的第 k 次 D1 呼叫之前（k 全掃）：同一班不發兩顆、當天不超過上限，結果與「最後才合併」逐列相同（第三輪 V3b 與日額窗）
//   C3  判定途中第 k 次 D1 呼叫失敗（k 全掃）→ 重跑後六張表與一次跑完逐列相同（B7）
//   LS  租約：兩發重疊不重複計點；過期可接手；別人的活租約不碰；只釋放自己那一份
//   R1  一條線組的寫入＝一個 batch、四句（標記、點數、sample_count、關認領），標記一句
//   R2  前次線組只讀最早／最晚時間；超量的車（批數、總長、第一段之後才灌進來）整班可疑、payload 不讀
//   R3  一班車判定出錯：那一行 log 用 error 等級；出錯的班車記下來、同一發繼續判下一班，下一發判得過就刪記錄
//   ISO 記下來的班車之後每一發排在最後（連可信身分也一樣）；D1 整個不能用（連記錄都寫不進去）才停手；每一發都會丟錯的壞班車不擋別人
//   ISO5／B5 出錯 2 次才排最後（錯過一次的誠實班車照常排）；SW 每一發開頭清掃沒有 pending 的出錯記錄；B4e 刪帳號一起刪出錯記錄；
//   D4 出錯記錄的寫與刪都圍租約；B3e 系統性出錯時只印前 5 班（第二輪獨立驗收）
//   N1d 清單截斷時可信名額最多佔一半（第三輪 N1b）；N1e 讓出的可信名額與一般班車按輪次交錯（第三輪 B(5)）；N1f 讀取量預算（第二輪 CPU）
//   N4  一班車的點數上看十幾萬（4 MB 塞得下）：判定不把整班的點展開成函式引數（V8 約十二萬多個就丟 RangeError）
//   N2  清單之後才灌進來的批次：讀這班車那一句依讀取順序累加長度截住，送回 Worker 的不超過 4 MB 再加一批，整班判可疑
//   N3  租約被下一發接手之後，舊的那一發第③段整組不動任何列（點數、sample_count、關認領不會做兩次）；N3d：② 的籌碼與登記也不動（第二輪 D2）
//   D3  oversize 那一句也圍租約；MD 第③段只在標記真的標到時才給點數／sample_count／關認領；D5 判定途中刪帳號不會長回任何東西；
//   B1f 統計只算真的寫進去的班（第二輪獨立驗收）
//   N1  可信名額最多先用掉剩下預算（子請求、牆鐘各算）的一半：養出來的可信分身擠不掉新使用者的第一趟；讓出來的名額排在別人之後照判
//   M3  兌換的交易內餘額守衛的邊界（讀到之後被扣）——review-B Q8 說這一層只有 redeem C6 一條在守
//   M5b 刪帳號時 body 的 deviceActor 若已併進別的帳號，一列不刪——review-B Q8 說這一層只有 auth A11d 一條在守
//   PL  會隨使用者長大的六張表：每個端點與兩支 cron 實際送出的每一句，查詢計畫在八種統計形狀下都與沒有統計時相同（第十批，N6-1 同一族）
//   PF  防偽閘丟掉／不收的點不進覆蓋率（孤立的遠點、斷點後的頭兩點）、也不能拿去過品質閘；跨午夜的班車照整班長度發籌碼（一次上傳、兩發、前次組本身跨午夜）（第十一批，V7 B(1)／B(2)）
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// Firebase 替身：token 'tok-<uid>' 驗出 <uid>，其餘一律驗不過。由 token 本身決定是誰（不用全域變數），併發的請求才不會互相串味。
// 其餘對外連線一律記下來並丟例外（這支腳本不准碰網路；結尾有一條判準數它）。
const outbound = [];
globalThis.fetch = async (u, init) => {
  if (String(u).includes('identitytoolkit.googleapis.com')) {
    let tok = '';
    try { tok = JSON.parse(init.body).idToken; } catch (e) {}
    return /^tok-[A-Za-z0-9_-]{8,64}$/.test(tok)
      ? new Response(JSON.stringify({ users: [{ localId: tok.slice(4) }] }), { status: 200 })
      : new Response('{}', { status: 400 });
  }
  outbound.push(String(u).slice(0, 80));
  throw new Error('offline: ' + String(u));
};
const bearer = uid => ({ Authorization: 'Bearer tok-' + uid });

const RULES = JSON.parse(readFileSync(join(ROOT, 'data/bounty_rules.json'), 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
// 例外也記成 FAIL（突變時「紅」有兩種長相：斷言為假、或流程丟例外），不讓整支腳本崩潰、後面的判準全部沒跑。
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00
const D22 = '2026-07-22', D28 = '2026-07-28';               // D22＝判定當天往前 7 天（上傳窗最舊那天）
const DAY = 86400e3;
const tpe = (day, h, m = 0) => Date.parse(day + 'T00:00:00Z') - 8 * 3600e3 + (h * 60 + m) * 60000;   // 台北某日某時的 epoch
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const limiter = { limit: async () => ({ success: true }) };
const BOUNTY_CRON = '30 19 * * *';
const LEASE = 'bounty_verify_lease';

// 合成的線：20 公里、每 2 公里一站（S0…S10）。名字用真的鍵（bounty_rules.json 的 remoteLines 認 'tra_sched|南迴線'）。
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const LINES = {};
for (const ln of ['屏東線', '南迴線', '山線']) LINES[`tra_sched|${ln}`] = mkLine('tra_sched', ln);
// 121 站、120 個區間的超長線（R1：一條線組覆蓋 120 段）
const xlName = i => 'X' + String(i).padStart(3, '0');
LINES['tra_sched|超長線'] = { sys: 'tra_sched', lnId: '超長線', name: '超長線', stations: Array.from({ length: 121 }, (_, i) => ({ name: xlName(i), d: i * 2 })) };
const XL_SEGS = Array.from({ length: 120 }, (_, i) => `${xlName(i)}|${xlName(i + 1)}`);
const UNITS = { generatedAt: 1, schedDate: D28, units: [], lines: LINES };
const SEGS10 = Array.from({ length: 9 }, (_, i) => `S${i}|S${i + 1}`);      // 板上種 9 段：S0|S1 … S8|S9
const KT = (ln, s) => `tra_sched|${ln}|${s}`;

// 一段乾淨軌跡：每秒一點、等速 speed。點數＝sec+1，長度（t 的 max−min）＝sec。700 秒 @20 m/s＝14 km＝山線前 7 段（S0|S1…S6|S7）。
function leg({ sec, speed = 20, t0 = 30000, d0 = 0, reverse = false, acc = 8 }) {
  const pts = [];
  for (let i = 0; i <= sec; i++) pts.push({ d: d0 + (reverse ? -i : i) * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc });
  return pts;
}
const TINY = [{ d: 0, t: 100, v: 1, acc: 5 }];               // 垃圾批次：一個點（判得出來、只是 unusable）
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function world(over = {}) {
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const rulesText = J(over.rules || RULES);                  // over.rules：換一份設定檔（N3c 的降級路徑）
  const ASSETS = { fetch: async r => new Response(String((r && r.url) || r).includes('bounty_units') ? J(UNITS) : rulesText, { status: 200 }) };
  const env = { DELAY_DB, ASSETS, FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter, BOUNTY_LIMITER: limiter, DELETE_LIMITER: limiter,
    BOUNTY_NOW: String(over.now || NOW_MS), ...(over.env || {}) };
  const w = { db, DELAY_DB, env };
  w.at = ms => { env.BOUNTY_NOW = String(ms); };
  // 模組層級有 rules／units 快取，每次跑之前歸零。o：這一發額外的 env（BOUNTY_NOW、預算、排序鉤）。
  w.cron = async (o = {}) => { _bounty.bountyResetMemCaches(); return _bounty.bountyVerifyCron({ ...env, ...o }); };
  return w;
}
// 直接寫樣本列（每一批一列）。first＝這一段批次的起始序號（同一班車分幾次寫入時，序號與 submitted_at 都要接續）。
function putBatches(db, o) {
  const { actor, trainNo, lnId = '山線', sys = 'tra_sched', date = D28, pts, dir = 0, client = APP, first = 0, size = 200 } = o;
  const at = o.submittedAt ?? (NOW_MS - 3600e3);
  const st = db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
    " VALUES (?,?,?,?,?,?,?,?,NULL,?,'pending',?)");
  chunk(pts, size).forEach((part, k) => st.run(`${actor}.${trainNo}.${date}.${lnId}.${first + k}`, actor, sys, lnId, trainNo, dir, date, J(part), at + first + k, J(client)));
}
// 大量寫入（數千班）包成一筆交易，只為了快；內容與逐筆 putBatches 相同。
function bulk(db, list) {
  db.exec('BEGIN');
  try { for (const o of list) putBatches(db, o); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const boardSql = (ln, segs = SEGS10, points = 3) => 'INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users) VALUES ' +
  segs.map(s => `('${KT(ln, s)}','tra_sched','自強',0,'track','',1,1,${points},10,1,1,0,NULL,0)`).join(',') + ';';
const claimSql = c => `INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES ` +
  `('${c.id}','${c.actor}','${c.seg}','自強',0,'track','',${c.pts},1,${NOW_MS + DAY},'open');`;
const pointsSql = rows => 'INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ' +
  rows.map(([a, uid, pts, into]) => `('${a}',${uid ? `'${uid}'` : 'NULL'},${pts},${into ? `'${into}'` : 'NULL'},1)`).join(',') + ';';
const ledgerSql = (actor, kind, delta, ref, day = null) =>
  `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES ('${kind}|${ref}','${actor}','${kind}',${delta},'${ref}',${day ? `'${day}'` : 'NULL'},1);`;

// ── 讀庫（一律自己寫 SQL，不呼叫實作的任何函式）─────────────────────────────────
const rows = (w, sql, ...p) => w.db.prepare(sql).all(...p).map(r => ({ ...r }));
const one = (w, sql, ...p) => { const r = w.db.prepare(sql).get(...p); return r ? { ...r } : null; };
const q = {
  verdicts: (w, actor, trainNo) => rows(w, 'SELECT DISTINCT verdict v FROM bounty_samples WHERE actor=? AND train_no=?', actor, trainNo).map(r => r.v).sort().join(),
  rejects: (w, actor, trainNo) => rows(w, 'SELECT DISTINCT reject_code r FROM bounty_samples WHERE actor=? AND train_no=?', actor, trainNo).map(r => r.r).sort().join(),
  trips: w => rows(w, "SELECT actor,delta,ref,day FROM chip_ledger WHERE kind='trip' ORDER BY actor,ref"),
  bal: (w, a) => one(w, 'SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=?', a).n,
  point: (w, a) => one(w, 'SELECT uid,points,merged_into FROM bounty_points WHERE actor=?', a),
  points: (w, a) => { const r = q.point(w, a); return r ? r.points : null; },
  contrib: (w, a) => one(w, 'SELECT COUNT(*) c FROM bounty_seg_contrib WHERE actor=?', a).c,
  count: (w, table, where = '1=1', ...p) => one(w, `SELECT COUNT(*) c FROM ${table} WHERE ${where}`, ...p).c,
  pending: w => q.count(w, 'bounty_samples', "verdict='pending'"),
  sampleCounts: (w, ln) => rows(w, 'SELECT seg_key,sample_count FROM bounty_board WHERE seg_key LIKE ? ORDER BY seg_key', `tra_sched|${ln}|%`).map(r => r.sample_count),
  lease: w => one(w, 'SELECT v FROM kv_blobs WHERE k=?', LEASE),
};
const expireLease = w => w.db.exec(`UPDATE kv_blobs SET v=json_set(v,'$.until',0) WHERE k='${LEASE}'`);
const S7 = [1, 1, 1, 1, 1, 1, 1, 0, 0];                       // 山線 9 段的 sample_count：一趟 700 秒 ok 之後（S0|S1…S6|S7 各 +1）

// ── 端點呼叫 ─────────────────────────────────────────────────────────────
const post = (path, body, hdr = {}) => new Request('https://railisland.tw' + path, { method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr }, body: J(body) });
const get = (path, hdr = {}) => new Request('https://railisland.tw' + path, { headers: { 'cf-connecting-ip': '203.0.113.9', ...hdr } });
async function call(fn, req, env) {
  _bounty.bountyResetMemCaches();
  const res = await fn(req, env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}
let rid = 0;
const nextReq = () => 'rqh-' + String(++rid).padStart(6, '0');
const submit = (w, actor, o = {}, hdr = {}) => call(_bounty.bountySubmit, post('/api/bounty-submit', {
  actor, client: APP, sys: 'tra_sched', lnId: '山線', trainNo: 'H1', tripDate: D28, dir: 0, samples: TINY, requestId: nextReq(), ...o }, hdr), w.env);
const claim = (w, actor, cardId, hdr = {}) => call(_bounty.bountyClaim, post('/api/bounty-claim', { actor, cardId }, hdr), w.env);
const chipsMe = (w, query = '', hdr = {}) => call(_bounty.chipsMe, get('/api/chips-me' + query, hdr), w.env);
const bountyMe = (w, query = '', hdr = {}) => call(_bounty.bountyMe, get('/api/bounty-me' + query, hdr), w.env);
const merge = (w, dev, uid) => call(_bounty.bountyMerge, post('/api/bounty-merge', { actor: dev }, bearer(uid)), w.env);
const redeem = (w, actor, scene, requestId) => call(_bounty.garageRedeem, post('/api/garage-redeem', { actor, scene, requestId }), w.env);
async function delAccount(w, body, uid) {
  const res = await worker.fetch(post('/api/account-delete', body, bearer(uid)), w.env, { waitUntil() {} });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}
// 用真的 scheduled() 觸發一次判定時段（估值＋判定）；log 分等級收起來。
async function fire(w) {
  const logs = [], errs = [], cl = console.log, ce = console.error, cw = console.warn;
  console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  let threw = null;
  try { _bounty.bountyResetMemCaches(); await worker.scheduled({ cron: BOUNTY_CRON, scheduledTime: NOW_MS }, w.env, { waitUntil() {} }); }
  catch (e) { threw = String((e && e.message) || e); }
  finally { console.log = cl; console.error = ce; console.warn = cw; }
  return { logs, errs, threw };
}

// ── 測試用注入點 ─────────────────────────────────────────────────────────────
// 在「符合的那句 SQL 第一次真的執行前」插一段非同步動作（競態注入點）。fired＝符合的句子總共執行了幾次。
function hookOnce(DELAY_DB, re, fn) {
  const orig = DELAY_DB.prepare.bind(DELAY_DB);
  const state = { fired: 0 };
  DELAY_DB.prepare = sql => {
    const st = orig(sql);
    if (!re.test(sql)) return st;
    const wrapS = s => new Proxy(s, { get(t, k) {
      if (k === 'bind') return (...p) => wrapS(t.bind(...p));
      if (k === 'all' || k === 'first' || k === 'run') return async (...a) => { if (!state.fired++) await fn(); return t[k](...a); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    } });
    return wrapS(st);
  };
  return state;
}
// 記下每一句查詢回了哪些列（onRows(sql, rows)）：用來證明「某一班車的 payload 從來沒被讀回 Worker」與「班車清單的次序」。
function spyRows(DELAY_DB, onRows) {
  const orig = DELAY_DB.prepare.bind(DELAY_DB);
  const wrapS = (s, sql) => new Proxy(s, { get(t, k) {
    if (k === 'bind') return (...p) => wrapS(t.bind(...p), sql);
    if (k === 'all') return async (...a) => { const r = await t.all(...a); onRows(sql, (r && r.results) || []); return r; };
    if (k === 'first') return async (...a) => { const r = await t.first(...a); onRows(sql, r ? [r] : []); return r; };
    const v = t[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  DELAY_DB.prepare = sql => wrapS(orig(sql), sql);
}
// 記下每一次 batch 送了哪些句子（SQL＋綁定值）。bountyCounted 交給 batch 的是真正的 prepared statement（_inner），所以讀得到 _sql／_p。
function spyBatches(DELAY_DB) {
  const log = [];
  const orig = DELAY_DB.batch.bind(DELAY_DB);
  DELAY_DB.batch = stmts => { log.push(stmts.map(s => ({ sql: String(s._sql), p: s._p || [] }))); return orig(stmts); };
  return log;
}
const LIST_RE = /^WITH t AS \(/;                                            // 判定第一段：班車清單
// 判定時讀這個人的認領那一句（第九批起寫 INDEXED BY idx_claims_actor；兩種寫法都認，才分得出「句子沒送出」與「計畫不對」——計畫由 CL4、K1e 看）
const CLAIMS_READ_RE = /FROM bounty_claims (?:INDEXED BY idx_claims_actor )?WHERE actor=COALESCE/;
const LOAD_RE = /^SELECT \* FROM \(SELECT \*, SUM\(length\(payload\)\) OVER/;   // 第二段：讀一班車（依讀取順序累加長度截住，見 N2）
const PRIOR_RE = /verdict <> 'pending'/;                                  // 前次線組
const MARK_RE = /^UPDATE bounty_samples (?:INDEXED BY sqlite_autoindex_bounty_samples_1 )?SET verdict=\?/;   // 標記已判定
const SUMMARY_RE = /^\[cron bounty 驗證\] \d+ 班／/;                        // 判定那一行（一發一行；逐班出錯另有一行，含 STRIKE 的鍵）
const STRIKE = (actor, trainNo, day = D28) => `bounty_verify_strike|${actor}|${day}|${trainNo}`;   // 判定出錯的班車記在 kv_blobs 的鍵
const strikes = w => rows(w, "SELECT k, v FROM kv_blobs WHERE k LIKE 'bounty_verify_strike|%' ORDER BY k");

// ═══ B1：上傳窗與防偽閘同一條台北日 ═══════════════════════════════════════════════
// 乘車日 07-28。上傳窗＝上傳當天（台北）往前 7 天到明天；防偽閘用同一條（以上傳時間為基準）。
// 舊版防偽閘拿「乘車日 UTC 零點（＝台北 08:00）」比毫秒：第 7 天 08:00 之後的補傳被上傳端點收下、卻在判定被打成 stale_date（B1a／B1b 會紅），
// 未來那一端差 8 小時（B1d 會紅）。每一列：[標籤, 上傳時刻, 期望上傳狀態, 判定時刻, 說明]
const B1_LEG = leg({ sec: 700 });                            // 701 點 → 兩批（600＋101）
for (const [tag, upAt, want, judgeAt, why] of [
  ['B1a', tpe('2026-08-04', 8, 1), 200, tpe('2026-08-05', 3, 30), '08-04 08:01（上傳窗最舊那天，UTC 零點＋7 天之後）'],
  ['B1b', tpe('2026-08-04', 23, 59), 200, tpe('2026-08-05', 3, 30), '08-04 23:59（上傳窗最舊那天的最後一分鐘）'],
  ['B1c', tpe('2026-08-05', 0, 0), 400, null, '08-05 00:00（第 8 天，出窗）'],
  ['B1d', tpe('2026-07-27', 0, 0), 200, tpe('2026-07-29', 3, 30), '07-27 00:00（乘車日前一天＝上傳窗「明天」那一端，比 UTC 零點早 32 小時）'],
  ['B1e', tpe('2026-07-26', 23, 59), 400, null, '07-26 23:59（乘車日前兩天，出窗）'],
]) {
  await attempt(tag, async () => {
    const w = world({ seed: boardSql('山線') });
    const A = `dev-${tag.toLowerCase()}-00001`;
    w.at(upAt);
    const r1 = await submit(w, A, { trainNo: 'B1', samples: B1_LEG.slice(0, 600) });
    const r2 = await submit(w, A, { trainNo: 'B1', samples: B1_LEG.slice(600) });
    if (want === 400) {
      ok(`${tag} [B1] 上傳時刻 ${why}：兩批都 400 bad_date、一列都沒寫`,
        r1.status === 400 && r1.json.error === 'bad_date' && r2.status === 400 && q.count(w, 'bounty_samples') === 0, J([r1.text, r2.text]));
      return;
    }
    const st = await w.cron({ BOUNTY_NOW: String(judgeAt) });
    ok(`${tag} [B1] 上傳時刻 ${why}：上傳端點收下（200×2）→ 判定 ok、入帳 1 顆（帳本 ${A}|${D28}|B1）——兩道閘同一條，收下的就不會被判成日期不合`,
      r1.status === 200 && r2.status === 200 && q.verdicts(w, A, 'B1') === 'ok' && q.rejects(w, A, 'B1') === '' &&
        J(q.trips(w)) === J([{ actor: A, delta: 1, ref: `${A}|${D28}|B1`, day: D28 }]) && st.chips === 1,
      J({ up: [r1.status, r2.status], v: q.verdicts(w, A, 'B1'), rej: q.rejects(w, A, 'B1'), trips: q.trips(w), chips: st.chips }));
  });
}

// ═══ B3：判定順序 ═══════════════════════════════════════════════════════════
// 班車清單的次序（第一段）＝判定的次序。用 spyRows 記下清單那一句回的列：actor 與 who（記在誰名下）。
const listOf = (w) => {
  const seen = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LIST_RE.test(sql)) seen.push(rs.map(r => ({ actor: String(r.actor), who: String(r.who), train: String(r.train_no) }))); });
  return seen;
};

await attempt('B3a', async () => {
  // review-B C1 的攻擊：一個 IP、不帶任何憑證，送兩千多班「乘車日＝上傳窗最舊那天、actor 字母序在前」的垃圾。
  // 誠實的可信身分：帳號 U（3 班）、以前入帳過錄程籌碼的匿名裝置 R（1 班）、併進帳號 U2 的裝置 M（1 班）。
  // 預設預算（8000）、預設次序（同一輪隨機）：可信身分的前 8 班排在最前面，所以這 5 班一定先判；垃圾把預算用完，剩下的留 pending。
  // 垃圾一班成本＝讀一班 1＋逐站觀測 1＋身分 1＋前次 1＋寫入 batch 1＝5 → 預算 8000 判得了約 1,600 班 < 2,500 班，一定用完。
  const U = 'uid-b3a-0000U', U2 = 'uid-b3a-000U2', Rr = 'dev-b3a-00000R', M = 'dev-b3a-00000M';
  const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null], [U2, U2, 0, null], [M, null, 0, U2]]) +
    ledgerSql(Rr, 'trip', 1, `${Rr}|2026-07-10|O1`, '2026-07-10') });
  const junk = Array.from({ length: 2500 }, (_, i) => ({ actor: '0000junk' + String(i).padStart(4, '0'), trainNo: 'J1', date: D22, pts: TINY }));
  bulk(w.db, [...junk, ...['U1', 'U2', 'U3'].map(t => ({ actor: U, trainNo: t, pts: leg({ sec: 700 }) })),
    { actor: Rr, trainNo: 'R1', pts: leg({ sec: 700 }) }, { actor: M, trainNo: 'M1', pts: leg({ sec: 700 }) }]);
  const seen = listOf(w);
  const st = await w.cron();
  const first5 = (seen[0] || []).slice(0, 5).map(r => r.who).sort();
  ok('B3a1 [B3] 班車清單最前面 5 班恰是可信身分的 5 班（who：U×3、R、U2），垃圾一班都沒插到前面',
    J(first5) === J([Rr, U, U, U, U2].sort()), J((seen[0] || []).slice(0, 6)));
  ok('B3a2 [B3] 五班誠實的趟都判成 ok、入帳：U 3 顆（3 班各 1，每日上限 4 之內）、R 1 顆（另有舊的 1 顆）、M 的 1 顆記在 U2',
    ['U1', 'U2', 'U3'].every(t => q.verdicts(w, U, t) === 'ok') && q.verdicts(w, Rr, 'R1') === 'ok' && q.verdicts(w, M, 'M1') === 'ok' &&
      J(q.trips(w)) === J([
        { actor: Rr, delta: 1, ref: `${Rr}|2026-07-10|O1`, day: '2026-07-10' }, { actor: Rr, delta: 1, ref: `${Rr}|${D28}|R1`, day: D28 },
        { actor: U, delta: 1, ref: `${U}|${D28}|U1`, day: D28 }, { actor: U, delta: 1, ref: `${U}|${D28}|U2`, day: D28 },
        { actor: U, delta: 1, ref: `${U}|${D28}|U3`, day: D28 }, { actor: U2, delta: 1, ref: `${U2}|${D28}|M1`, day: D28 },
      ].sort((a, b) => (a.actor + a.ref).localeCompare(b.actor + b.ref))),
    J({ trips: q.trips(w), st }));
  const junkPending = q.count(w, 'bounty_samples', "verdict='pending' AND actor LIKE '0000junk%'");
  ok('B3a3 攻擊確實把預算用完（子請求預算停手），垃圾還有一部分留 pending——證明上面兩條是在「預算不夠判完」的條件下成立的',
    st.budgetStop === true && st.stopBy === 'subreq' && junkPending > 0 && junkPending < 2500, J({ budgetStop: st.budgetStop, stopBy: st.stopBy, trains: st.trains, junkPending }));
});

await attempt('B3b', async () => {
  // 單一攻擊者灌 3,000 班（五個乘車日各 600 班），新來的誠實匿名使用者 N 只有 1 班、乘車日最新。
  // 寫死次序（BOUNTY_VERIFY_ORDER='fixed'：同一輪依乘車日、actor、車次），預算 40（約判得了 5 班）。
  // 第一輪：攻擊者的第 1 班（07-22）、N 的第 1 班（07-28）→ N 第 2 個判。舊版次序（乘車日最舊先）N 排在 3,000 班之後。
  const X = 'dev-b3b-attack', N = 'dev-b3b-honest';
  const w = world({ seed: boardSql('山線') });
  const days = ['2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
  bulk(w.db, [...Array.from({ length: 3000 }, (_, i) => ({ actor: X, trainNo: 'X' + String(i).padStart(4, '0'), date: days[Math.floor(i / 600)], pts: TINY })),
    { actor: N, trainNo: 'N1', pts: leg({ sec: 700 }) }]);
  const seen = listOf(w);
  const st = await w.cron({ BOUNTY_VERIFY_ORDER: 'fixed', BOUNTY_SUBREQ_BUDGET: '40' });
  const order = (seen[0] || []).slice(0, 3).map(r => r.train);
  ok('B3b1 [B3] 每人輪流：清單前 3 班＝攻擊者第 1 班、N 的第 1 班、攻擊者第 2 班（X0000、N1、X0001）',
    J(order) === J(['X0000', 'N1', 'X0001']), J(order));
  ok('B3b2 [B3] 預算只夠判幾班的情況下，N 的趟判成 ok、入帳 1 顆；攻擊者 3,000 班裡至少 2,990 班還是 pending',
    q.verdicts(w, N, 'N1') === 'ok' && J(q.trips(w)) === J([{ actor: N, delta: 1, ref: `${N}|${D28}|N1`, day: D28 }]) &&
      q.count(w, 'bounty_samples', "verdict='pending' AND actor=?", X) >= 2990 && st.budgetStop === true,
    J({ n: q.verdicts(w, N, 'N1'), trips: q.trips(w), xPending: q.count(w, 'bounty_samples', "verdict='pending' AND actor=?", X), st }));
});

await attempt('B3c', async () => {
  // 同一輪裡隨機：301 個匿名 actor 各 1 班、同一個乘車日；字母序最後的是 'zzzzzzzz'。預算 5（判完第一班就停，只為了拿到清單）。
  // 正向對照：寫死次序時清單＝actor 字母序、兩次相同（證明「拿到的清單」真的是判定次序，而且這條判準在不隨機時會紅）。
  const actors = [...Array.from({ length: 300 }, (_, i) => 'dev-b3c-' + String(i + 1).padStart(3, '0')), 'zzzzzzzz'];
  const run = async (o) => {
    const w = world();
    bulk(w.db, actors.map(a => ({ actor: a, trainNo: 'C1', date: D22, pts: TINY })));
    const seen = listOf(w);
    await w.cron({ BOUNTY_SUBREQ_BUDGET: '5', ...o });
    return (seen[0] || []).map(r => r.actor);
  };
  const sorted = [...actors].sort();
  const f1 = await run({ BOUNTY_VERIFY_ORDER: 'fixed' }), f2 = await run({ BOUNTY_VERIFY_ORDER: 'fixed' });
  ok('B3c0 [對照] 寫死次序：清單 301 班＝actor 字母序，兩次相同', f1.length === 301 && J(f1) === J(sorted) && J(f2) === J(f1), J(f1.slice(0, 3)));
  const runs = [await run({}), await run({}), await run({})];
  ok('B3c1 [B3] 預設（隨機）：三次的清單都是完整的 301 班、而且都不是字母序', runs.every(r => r.length === 301 && J(r) !== J(sorted)),
    J(runs.map(r => r.slice(0, 3))));
  ok('B3c2 [B3] 三次的次序兩兩不同（同一輪用 random()，不是任何上傳者填得了的欄位）',
    J(runs[0]) !== J(runs[1]) && J(runs[1]) !== J(runs[2]) && J(runs[0]) !== J(runs[2]), '');
  ok("B3c3 [B3] 字母序最後的 'zzzzzzzz' 不會每次都排最後（三次都最後的機率 (1/301)³）", !runs.every(r => r[r.length - 1] === 'zzzzzzzz'),
    J(runs.map(r => r.indexOf('zzzzzzzz'))));
});

await attempt('B3e', async () => {
  // 每個可信身分只有前 8 班插隊：帳號 A 自己 4 班、併進 A 的兩台裝置各 4 班（who 都是 A，共 12 班）＋ 50 個匿名垃圾各 1 班。
  // 期望次序：A 的前 8 班 → 50 班垃圾（全是第 1 輪）→ A 的第 9–12 班（第 9–12 輪）。兩種模式都一樣（隨機只在同一格裡）。
  const A = 'uid-b3e-0000A', DA1 = 'dev-b3e-da01', DA2 = 'dev-b3e-da02';
  for (const mode of ['fixed', '']) {
    const w = world({ seed: pointsSql([[A, A, 0, null], [DA1, null, 0, A], [DA2, null, 0, A]]) });
    const mine = [[DA1, 'A01'], [DA1, 'A02'], [DA1, 'A03'], [DA1, 'A04'], [DA2, 'A05'], [DA2, 'A06'], [DA2, 'A07'], [DA2, 'A08'],
      [A, 'A09'], [A, 'A10'], [A, 'A11'], [A, 'A12']];
    bulk(w.db, [...mine.map(([a, t]) => ({ actor: a, trainNo: t, pts: TINY })),
      ...Array.from({ length: 50 }, (_, i) => ({ actor: 'dev-b3e-j' + String(i).padStart(3, '0'), trainNo: 'J1', date: D22, pts: TINY }))]);
    const seen = listOf(w);
    await w.cron({ BOUNTY_SUBREQ_BUDGET: '5', ...(mode ? { BOUNTY_VERIFY_ORDER: mode } : {}) });
    const who = (seen[0] || []).map(r => r.who);
    ok(`B3e${mode ? '1' : '2'} [B3] 每人前 8 班（${mode || '隨機'}）：清單 62 班＝A 的 8 班 → 垃圾 50 班 → A 的 4 班（併進 A 的裝置也算 A 的名額）`,
      who.length === 62 && who.slice(0, 8).every(x => x === A) && who.slice(8, 58).every(x => x !== A) && who.slice(58).every(x => x === A),
      J({ n: who.length, head: who.slice(0, 9), tail: who.slice(57) }));
  }
});

// ═══ B4：賺的端點帶了別的帳號的 Bearer ═════════════════════════════════════════
await attempt('B4b', async () => {
  // D 已併進帳號 A；B 是另一個帳號（同一個瀏覽器換人登入）。
  const A = 'uid-b4-00000A', B = 'uid-b4-00000B', D = 'dev-b4-000000D';
  const CARD = 'tra_sched|山線|0|自強|track|';                    // 山線 dir 0 自強 track：板上 9 段
  const w = world({ seed: boardSql('山線') + pointsSql([[A, A, 0, null], [D, null, 0, A]]) });
  const s1 = await submit(w, D, {}, bearer(B)), c1 = await claim(w, D, CARD, bearer(B));
  ok('B4b1 [B4] 裝置 D 已併進 A、請求帶的是 B 的 Bearer：上傳與認領都 403 wrong_account；樣本與認領一列都沒寫',
    s1.status === 403 && s1.json.error === 'wrong_account' && c1.status === 403 && c1.json.error === 'wrong_account' &&
      q.count(w, 'bounty_samples') === 0 && q.count(w, 'bounty_claims') === 0, J([s1.text, c1.text]));
  const s2 = await submit(w, D, {}, bearer(A)), c2 = await claim(w, D, CARD, bearer(A));
  ok('B4b2 帶 A 自己的 Bearer：兩個都 200，樣本 1 列、認領 9 列（9 段），全部記在 A',
    s2.status === 200 && c2.status === 200 && q.count(w, 'bounty_samples', 'actor=?', A) === 1 && q.count(w, 'bounty_claims', 'actor=?', A) === 9 &&
      q.count(w, 'bounty_samples', 'actor<>?', A) === 0 && q.count(w, 'bounty_claims', 'actor<>?', A) === 0, J([s2.text, c2.text]));
  const s3 = await submit(w, D, {}), c3 = await claim(w, D, CARD);
  // 同一張卡再接一次＝取代舊的（第五輪獨立驗收 新洞①；舊版這裡是 18 列）：仍 9 列，而且 9 列全是這一次（c3）的 claimId。
  const ids3 = rows(w, 'SELECT id FROM bounty_claims WHERE actor=?', A).map(r => r.id);
  ok('B4b3 不帶 Bearer（App 的錄程上傳、網頁的認領都不帶）：照舊 200、記在 A（樣本 2 列；同一張卡再接一次取代舊的，認領仍 9 列、全是這一次的）',
    s3.status === 200 && c3.status === 200 && q.count(w, 'bounty_samples', 'actor=?', A) === 2 && q.count(w, 'bounty_claims', 'actor=?', A) === 9 &&
      !!(c3.json && c3.json.claimId) && ids3.length === 9 && ids3.every(id => id.startsWith(c3.json.claimId + '|')),
    J([s3.text, c3.text, ids3.slice(0, 3)]));
});

// ═══ B5：帶 Bearer 讀取也跑 S0 ═════════════════════════════════════════════════
for (const [tag, read] of [['B5a', chipsMe], ['B5b', bountyMe]]) {
  await attempt(tag, async () => {
    // 攻擊者 A 先前拿 V（還沒出現過的 uid）當「裝置」併進自己（F2 的預先佔位），V 的列是 {uid NULL, merged_into A}。
    // V 本人第一次帶 Bearer 出現、只是讀取：列要被收回成帳號列 {uid V, merged_into NULL}，讀到的是 V 自己的帳（0），不是 A 的。
    const A = 'uid-b5-00000A', V = 'uid-b5-00000V';
    const w = world({ seed: pointsSql([[A, A, 40, null], [V, null, 0, A]]) + ledgerSql(A, 'adjust', 6, 'b5-seed') });
    const r = await read(w, '', bearer(V));
    const body = tag === 'B5a' ? { balance: r.json && r.json.balance } : { actor: r.json && r.json.actor, points: r.json && r.json.points };
    ok(`${tag} [B5] ${tag === 'B5a' ? 'chips-me' : 'bounty-me'} 帶 V 的 Bearer 讀取 → 200、讀到 V 自己的帳（${tag === 'B5a' ? '餘額 0' : 'points 0'}）；V 的列變成帳號列 {uid V, merged_into NULL}`,
      r.status === 200 && J(body) === J(tag === 'B5a' ? { balance: 0 } : { actor: V, points: 0 }) && J(q.point(w, V)) === J({ uid: V, points: 0, merged_into: null }),
      J({ r: r.text.slice(0, 120), row: q.point(w, V) }));
    const anon = await read(w, '?actor=' + V);
    ok(`${tag}2 收回之後 V 是帳號：不帶 token 用 ?actor=V 讀 → 401 auth_required（攻擊者不能再冒 V 的名義讀）`,
      anon.status === 401 && anon.json.error === 'auth_required', anon.text);
  });
}

// ═══ B6：髒帳號列（uid 與 merged_into 都有值）判定記在本人 ═════════════════════════
await attempt('B6', async () => {
  // 舊版 F2 攻擊留下的髒列：V 是帳號（uid＝V），卻掛著 merged_into＝A。V 名下的樣本判完，籌碼、點數、去重貢獻都要記在 V。
  // 期望：700 秒 ok → 1 顆；點數 7 段×3＝21；登記 7 段。A 一樣都沒有。
  const A = 'uid-b6-00000A', V = 'uid-b6-00000V';
  const w = world({ seed: boardSql('山線') + pointsSql([[A, A, 0, null], [V, V, 0, A]]) });
  putBatches(w.db, { actor: V, trainNo: 'V1', pts: leg({ sec: 700 }) });
  await w.cron();
  ok('B6 [B6] 髒帳號列 V：籌碼 1 顆（帳本 V|07-28|V1）、點數 21、登記 7 段都在 V；A 的帳本 0 列、點數 0、登記 0',
    J(q.trips(w)) === J([{ actor: V, delta: 1, ref: `${V}|${D28}|V1`, day: D28 }]) && q.points(w, V) === 21 && q.contrib(w, V) === 7 &&
      q.bal(w, A) === 0 && q.points(w, A) === 0 && q.contrib(w, A) === 0,
    J({ trips: q.trips(w), pV: q.points(w, V), pA: q.points(w, A), cV: q.contrib(w, V), cA: q.contrib(w, A) }));
});

// ═══ C2：合併落在判定途中（讀認領那一刻）══════════════════════════════════════════
await attempt('C2', async () => {
  // 注入點：第③段讀認領那一句（標記與寫點數之前）。這一刻 DEV 被併進 UID：樣本、認領、帳本、登記整批改名到 UID。
  // 期望：點數記在 UID＝6 段×3＋認領鎖價 9＝27；認領（已改名到 UID）被關成 fulfilled；DEV 的墓碑 0 點；籌碼 1 顆與登記 7 段隨合併在 UID。
  const DEV = 'dev-c2-race-001', UID = 'uid-c2-race-001';
  const w = world({ seed: boardSql('山線') + claimSql({ id: 'claim-c2', actor: DEV, seg: KT('山線', 'S0|S1'), pts: 9 }) });
  putBatches(w.db, { actor: DEV, trainNo: 'C2', pts: leg({ sec: 700 }) });
  let mst = null;
  const h = hookOnce(w.DELAY_DB, CLAIMS_READ_RE, async () => { mst = (await merge(w, DEV, UID)).status; });
  await w.cron();
  const cl = one(w, "SELECT actor,status FROM bounty_claims WHERE id='claim-c2'");
  ok('C2 [B7 競態] 合併落在讀認領之前：UID 27 點、認領 {UID, fulfilled}、DEV 墓碑 0 點；籌碼 1 顆與登記 7 段在 UID、DEV 名下 0',
    h.fired >= 1 && mst === 200 && q.points(w, UID) === 27 && J(q.point(w, DEV)) === J({ uid: null, points: 0, merged_into: UID }) &&
      J(cl) === J({ actor: UID, status: 'fulfilled' }) && q.bal(w, UID) === 1 && q.bal(w, DEV) === 0 && q.contrib(w, UID) === 7 && q.contrib(w, DEV) === 0,
    J({ fired: h.fired, merge: mst, uid: q.point(w, UID), dev: q.point(w, DEV), claim: cl, bal: [q.bal(w, UID), q.bal(w, DEV)], contrib: [q.contrib(w, UID), q.contrib(w, DEV)] }));
});
await attempt('C2b', async () => {
  // 注入點：② 寫帳本那一句（身分、同班已入帳、當日上限都查完之後）。這一刻 DEV 被併進 UID（獨立驗收 V3 的 k=8–10）。
  // 舊版把先前在 JS 解析出來的 DEV 綁進那一句：籌碼記在已併掉的 DEV（帳號讀不到）；期望：記在 UID，帳本列的 ref 前綴也是 UID。
  const DEV = 'dev-c2b-race-01', UID = 'uid-c2b-race-01';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: DEV, trainNo: 'C2B', pts: leg({ sec: 700 }) });
  let mst = null;
  const h = hookOnce(w.DELAY_DB, /^INSERT OR IGNORE INTO chip_ledger/, async () => { mst = (await merge(w, DEV, UID)).status; });
  const st = await w.cron();
  const led = rows(w, "SELECT actor, ref FROM chip_ledger WHERE kind='trip'");
  ok('C2b [V3 競態] 合併落在寫帳本那一句之前：籌碼 1 顆記在 UID（帳本列 actor 與 ref 前綴都是 UID）、DEV 名下 0；登記 7 段也在 UID',
    h.fired >= 1 && mst === 200 && st.chips === 1 && J(led) === J([{ actor: UID, ref: `${UID}|${D28}|C2B` }]) && q.bal(w, UID) === 1 && q.bal(w, DEV) === 0 &&
      q.contrib(w, UID) === 7 && q.contrib(w, DEV) === 0,
    J({ fired: h.fired, merge: mst, led, chips: st.chips, bal: [q.bal(w, UID), q.bal(w, DEV)], contrib: [q.contrib(w, UID), q.contrib(w, DEV)] }));
});
await attempt('C2c', async () => {
  // 注入點：② 去重登記那個 batch 送出之前（獨立驗收 V3 的 k=12）。UID 以前用另一台裝置交過同一段：S0|S1…S6|S7 已有 UID 的登記、人數各 1。
  // 這一刻 DEV 被併進 UID。舊版把先前在 JS 解析出來的 DEV 綁進 batch：7 段各多一列 DEV 的登記、人數變 2（同一個人算兩次）；
  // 期望：登記只有 UID 那 7 列、人數仍各 1。籌碼在登記之前已記在 DEV，合併時一起搬到 UID。
  const DEV = 'dev-c2c-race-01', UID = 'uid-c2c-race-01';
  const seg7 = SEGS10.slice(0, 7).map(s => KT('山線', s));
  const w = world({ seed: boardSql('山線') + pointsSql([[UID, UID, 0, null]]) +
    seg7.map(k => `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ('${k}','${UID}',1);`).join('') +
    `UPDATE bounty_board SET distinct_ok_users=1 WHERE seg_key IN (${seg7.map(k => `'${k}'`).join(',')});` });
  putBatches(w.db, { actor: DEV, trainNo: 'C2C', pts: leg({ sec: 700 }) });
  const hb = { fired: 0, merge: null };
  const origBatch = w.DELAY_DB.batch.bind(w.DELAY_DB);
  w.DELAY_DB.batch = async stmts => {
    if (!hb.fired && stmts.some(s => /^INSERT OR IGNORE INTO bounty_seg_contrib/.test(String(s && s._sql)))) { hb.fired++; hb.merge = (await merge(w, DEV, UID)).status; }
    return origBatch(stmts);
  };
  await w.cron();
  const users = rows(w, "SELECT distinct_ok_users d FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.d);
  ok('C2c [V3 競態] 合併落在去重登記的 batch 之前：登記只有 UID 的 7 列、DEV 0 列；這 7 段的人數仍各 1（沒有把同一人算兩次）；籌碼 1 顆在 UID',
    hb.fired === 1 && hb.merge === 200 && q.contrib(w, UID) === 7 && q.contrib(w, DEV) === 0 && J(users) === J(S7) && q.bal(w, UID) === 1 && q.bal(w, DEV) === 0,
    J({ hb, contrib: [q.contrib(w, UID), q.contrib(w, DEV)], users, bal: [q.bal(w, UID), q.bal(w, DEV)] }));
});
await attempt('C2f', async () => {
  // 遲傳＋合併（第三輪獨立驗收 C3 的遲傳窗）：DEV 的 L2 前半 400 秒前一發已判 ok（不到 600 秒、0 顆）；後半 400 秒這一發才判。
  // 注入點：前次線組那一句（這一班的身分已在 JS 解析成 DEV 之後）。這一刻 DEV 被併進 UID：前半的列已改名到 UID。
  // 舊版只綁 JS 解析出來的 DEV → 前次查不到前半 → 只拿後半 400 秒判 → 0 顆，而且後半隨即標成已判定、再也補不回來。
  // 期望：前次查詢在 SQL 裡當場解析身分、找得到前半 → 整班 801 秒 → 1 顆，記在 UID。
  const DEV = 'dev-c2f-race-01', UID = 'uid-c2f-race-01';
  const w = world({ seed: boardSql('山線') + pointsSql([[UID, UID, 0, null]]) });
  putBatches(w.db, { actor: DEV, trainNo: 'L2', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
  const st1 = await w.cron();
  putBatches(w.db, { actor: DEV, trainNo: 'L2', pts: leg({ sec: 400, t0: 30401, d0: 8000 }), first: 100 });
  let mst = null;
  const h = hookOnce(w.DELAY_DB, PRIOR_RE, async () => { mst = (await merge(w, DEV, UID)).status; });
  const st2 = await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  ok('C2f [第三輪 C3] 合併落在前次查詢之前：前半（已改名到 UID）照樣算進整班長度 → 這一發 1 顆、記在 UID；DEV 名下 0；整班 ok（前一發只判前半、0 顆）',
    st1.chips === 0 && h.fired === 1 && mst === 200 && st2.chips === 1 && J(q.trips(w)) === J([{ actor: UID, delta: 1, ref: `${UID}|${D28}|L2`, day: D28 }]) &&
      q.bal(w, DEV) === 0 && q.verdicts(w, UID, 'L2') === 'ok',
    J({ st1: st1.chips, fired: h.fired, mst, chips: st2.chips, trips: q.trips(w), v: q.verdicts(w, UID, 'L2') }));
});

// ═══ C2s：合併落在第二發的第 k 次 D1 呼叫之前（k 全掃）════════════════════════════════
// C2／C2b／C2c／C2f 各釘一個注入點；第三輪獨立驗收的 V3b（合併落在「查這班入過帳沒」之前 → 同一班兩顆）與日額窗
// （合併落在「查今天領了幾顆」之前 → 當天多發一班）都是「合併剛好落在某兩句之間」。這裡逐一掃過每一個間隙，不必猜哪兩句之間有窗。
// 在第 k 次 D1 呼叫（first／all／run／raw、batch、exec 各算 1；同 C3 的 faulty）之前把 DEV 併進 UID。
// 合併本身走沒包起來的 D1：不算進 k，也不被攔。
function mergeAt(DB, k, doMerge) {
  const st = { n: 0, k, status: null };
  const hit = async () => { if (++st.n === st.k) st.status = await doMerge(); };
  const wrap = s => ({ __real: s, bind: (...a) => wrap(s.bind(...a)),
    first: async (...a) => { await hit(); return s.first(...a); }, all: async (...a) => { await hit(); return s.all(...a); },
    run: async (...a) => { await hit(); return s.run(...a); }, raw: async (...a) => { await hit(); return s.raw(...a); } });
  return { st, db: { prepare: sql => wrap(DB.prepare(sql)),
    batch: async stmts => { await hit(); return DB.batch(stmts.map(x => (x && x.__real) || x)); },
    exec: async sql => { await hit(); return DB.exec(sql); } } };
}
await attempt('C2s', async () => {
  // 世界（全部是 DEV 錄的；UID 是帳號、自己沒有任何資料）：
  //   X1（07-28 山線）：前半 610 秒前一發已判 ok、已入帳 1 顆（DEV 名下）；後半 380 秒這一發才判 → 不能再發（同一班已入帳）。
  //   X2（07-28 屏東線）：前半 400 秒前一發已判 ok、0 顆（不到 600 秒）；後半 400 秒這一發才判 → 整班 801 秒，恰 1 顆。
  //   X3（07-27 山線）：DEV 那天已領滿 4 顆（帳本種 4 列）；X3 700 秒單獨夠 1 顆 → 0 顆（併進帳號之後那天仍是 4 顆）。
  // 基準＝同一個世界「第二發一次跑完、最後才合併」。每個 k：第二發（第 k 次呼叫前合併）跑完、租約過期、重跑到沒有 pending，
  // 再與基準逐列比。帳本比 actor、kind、份量、ref 的尾巴（|乘車日|車次）與日期——ref 的前綴依合併的先後本來就不同（見 bountyCreditTripChips）。
  const DEV = 'dev-c2s-race-01', UID = 'uid-c2s-race-01', D27 = '2026-07-27';
  const FIX = { BOUNTY_VERIFY_ORDER: 'fixed' };
  const seed = boardSql('山線') + boardSql('屏東線') + pointsSql([[UID, UID, 0, null]]) +
    [1, 2, 3, 4].map(i => ledgerSql(DEV, 'trip', 1, `${DEV}|${D27}|P${i}`, D27)).join('');
  const build = async () => {
    const w = world({ seed });
    putBatches(w.db, { actor: DEV, trainNo: 'X1', lnId: '山線', pts: leg({ sec: 610, t0: 30000 }), first: 0 });
    putBatches(w.db, { actor: DEV, trainNo: 'X2', lnId: '屏東線', pts: leg({ sec: 400, t0: 40000 }), first: 0 });
    const st1 = await w.cron(FIX);
    putBatches(w.db, { actor: DEV, trainNo: 'X1', lnId: '山線', pts: leg({ sec: 380, t0: 30611, d0: 12220 }), first: 100 });
    putBatches(w.db, { actor: DEV, trainNo: 'X2', lnId: '屏東線', pts: leg({ sec: 400, t0: 40401, d0: 8020 }), first: 100 });
    putBatches(w.db, { actor: DEV, trainNo: 'X3', lnId: '山線', date: D27, pts: leg({ sec: 700 }), first: 0 });
    return { w, st1 };
  };
  const mergeRaw = w => call(_bounty.bountyMerge, post('/api/bounty-merge', { actor: DEV }, bearer(UID)), { ...w.env, DELAY_DB: w.DELAY_DB }).then(r => r.status);
  const T2 = { ...FIX, BOUNTY_NOW: String(NOW_MS + 3600e3) }, T3 = { ...FIX, BOUNTY_NOW: String(NOW_MS + 7200e3) };
  const norm = w => ({
    ledger: J(rows(w, "SELECT actor, kind, delta, substr(ref, instr(ref, '|')) AS tail, day FROM chip_ledger ORDER BY kind, day, tail, actor, delta")),
    contrib: J(rows(w, 'SELECT seg_key, actor FROM bounty_seg_contrib ORDER BY seg_key, actor')),
    points: J(rows(w, 'SELECT actor, uid, points, merged_into FROM bounty_points ORDER BY actor')),
    board: J(rows(w, 'SELECT seg_key, sample_count, covered_at IS NOT NULL AS cov, distinct_ok_users FROM bounty_board ORDER BY seg_key')),
    samples: J(rows(w, 'SELECT id, actor, verdict, quality_code, reject_code, segs FROM bounty_samples ORDER BY id')),
  });
  const tripsOf = (w, tail) => rows(w, "SELECT actor, delta FROM chip_ledger WHERE kind='trip' AND substr(ref, -length(?)) = ?", tail, tail);
  const dayTotal = (w, a, day) => one(w, "SELECT COALESCE(SUM(delta), 0) n FROM chip_ledger WHERE actor=? AND kind='trip' AND day=?", a, day).n;
  // 看板的人數＝登記列的人數（一段一個 seg_key；這個世界只有 DEV／UID 一個人，所以每段不是 0 就是 1，而且兩者要相等）
  const usersMismatch = w => rows(w, 'SELECT b.seg_key, b.distinct_ok_users d, (SELECT COUNT(*) FROM bounty_seg_contrib c WHERE c.seg_key=b.seg_key) c FROM bounty_board b')
    .filter(r => r.d !== r.c).map(r => r.seg_key);
  // 基準
  const b0 = await build();
  const f0 = mergeAt(b0.w.DELAY_DB, -1, null);
  b0.w.env.DELAY_DB = f0.db;
  const bst = await b0.w.cron(T2);
  b0.w.env.DELAY_DB = b0.w.DELAY_DB;
  const bms = await mergeRaw(b0.w);
  const base = norm(b0.w), N = f0.st.n;
  const bx = { st1: b0.st1.chips, st2: bst.chips, merge: bms, x1: tripsOf(b0.w, `|${D28}|X1`), x2: tripsOf(b0.w, `|${D28}|X2`), x3: tripsOf(b0.w, `|${D27}|X3`),
    d27: dayTotal(b0.w, UID, D27), devRows: q.count(b0.w, 'chip_ledger', 'actor=?', DEV), devContrib: q.contrib(b0.w, DEV), pending: q.pending(b0.w), users: usersMismatch(b0.w),
    contrib: q.contrib(b0.w, UID) };
  ok('C2s0 [第三輪 V3b 前置] 基準（第二發一次跑完、最後才合併）：前一發 X1 入帳 1 顆；這一發只有 X2 的 1 顆；X1、X2 各恰 1 列（UID、1 顆）、X3 沒有列、UID 的 07-27 仍是 4 顆；' +
    'DEV 名下 0 列帳本、0 列登記；看板人數＝登記列數；沒有 pending；第二發至少 20 次 D1 呼叫',
    bx.st1 === 1 && bx.st2 === 1 && bx.merge === 200 && J(bx.x1) === J([{ actor: UID, delta: 1 }]) && J(bx.x2) === J([{ actor: UID, delta: 1 }]) && bx.x3.length === 0 &&
      bx.d27 === 4 && bx.devRows === 0 && bx.devContrib === 0 && bx.users.length === 0 && bx.pending === 0 && bx.contrib > 0 && N >= 20, J({ ...bx, N }));
  const res = [];
  for (let k = 1; k <= N; k++) {
    const { w } = await build();
    const f = mergeAt(w.DELAY_DB, k, () => mergeRaw(w));
    w.env.DELAY_DB = f.db;
    let threw = null;
    try { await w.cron(T2); } catch (e) { threw = String((e && e.message) || e).slice(0, 60); }
    w.env.DELAY_DB = w.DELAY_DB;
    expireLease(w);
    let reruns = 0;
    while (q.pending(w) > 0 && reruns < 3) { await w.cron(T3); expireLease(w); reruns++; }
    const s = norm(w);
    res.push({ k, merged: f.st.status, threw, reruns, pending: q.pending(w), strikes: strikes(w).length,
      x1: tripsOf(w, `|${D28}|X1`).length, x2: tripsOf(w, `|${D28}|X2`).length, d27: dayTotal(w, UID, D27), users: usersMismatch(w).length,
      diff: Object.keys(s).filter(key => s[key] !== base[key]) });
  }
  const bad = res.filter(r => r.merged !== 200 || r.threw || r.pending || r.strikes || r.users || r.diff.length);
  console.log(`   C2s 第二發 ${N} 次 D1 呼叫；逐一在第 k 次之前合併：` + res.map(r => `${r.k}${r.diff.length ? '✗' : '・'}`).join(' '));
  ok(`C2sa [第三輪 V3b／日額窗] ${N} 個間隙逐一合併：每一個都與基準逐列相同（帳本、登記、點數、看板、樣本），合併都成功、沒有丟例外、沒有 pending、沒有出錯記錄、看板人數＝登記列數`,
    res.length === N && bad.length === 0,
    J(bad.map(r => ({ k: r.k, m: r.merged, t: r.threw, p: r.pending, s: r.strikes, u: r.users, diff: r.diff.join('+'), x1: r.x1, x2: r.x2, d27: r.d27 }))));
  ok('C2sb [第三輪 V3b／日額窗] 分項（C2sa 紅的時候看這條就知道是哪一種）：每個間隙 X1、X2 都恰 1 列、UID 的 07-27 都是 4 顆',
    res.every(r => r.x1 === 1 && r.x2 === 1 && r.d27 === 4),
    J(res.filter(r => r.x1 !== 1 || r.x2 !== 1 || r.d27 !== 4).map(r => [r.k, r.x1, r.x2, r.d27])));
});

// ═══ C3：第 k 次 D1 呼叫失敗（k 全掃）═══════════════════════════════════════════
// 在第 k 次 D1 呼叫（first／all／run／raw 各算 1、batch 算 1、exec 算 1）丟例外。包在 bountyCounted 的下面，不影響它的計數。
function faulty(DB, k) {
  const st = { n: 0, k };
  const hit = () => { st.n++; if (st.n === st.k) throw new Error('INJECTED_FAULT@' + st.k); };
  const wrap = s => ({ __real: s, bind: (...a) => wrap(s.bind(...a)),
    first: async (...a) => { hit(); return s.first(...a); }, all: async (...a) => { hit(); return s.all(...a); },
    run: async (...a) => { hit(); return s.run(...a); }, raw: async (...a) => { hit(); return s.raw(...a); } });
  return { st, db: { prepare: sql => wrap(DB.prepare(sql)),
    batch: async stmts => { hit(); return DB.batch(stmts.map(x => (x && x.__real) || x)); },
    exec: async sql => { hit(); return DB.exec(sql); } } };
}
const snap = w => ({
  ledger: J(rows(w, 'SELECT actor,kind,delta,ref,day FROM chip_ledger ORDER BY id')),
  contrib: J(rows(w, 'SELECT seg_key,actor FROM bounty_seg_contrib ORDER BY seg_key,actor')),
  points: J(rows(w, 'SELECT actor,uid,points,merged_into FROM bounty_points ORDER BY actor')),
  claims: J(rows(w, 'SELECT id,actor,status FROM bounty_claims ORDER BY id')),
  board: J(rows(w, 'SELECT seg_key,train_kind,dir,sample_count,covered_at IS NOT NULL AS cov,distinct_ok_users FROM bounty_board ORDER BY seg_key,train_kind,dir')),
  samples: J(rows(w, 'SELECT id,verdict,quality_code,reject_code,segs FROM bounty_samples ORDER BY id')),
});
await attempt('C3', async () => {
  // 直通車 T1（屏東線 700 秒＋南迴線 400 秒，兩個線組；屏東線 S0|S1 有 D 的認領鎖價 9）＋另一人 E 的 T2（山線）。
  // 第一發寫死次序（D 的 T1 先、E 的 T2 後）：第 k 次呼叫每一輪都打在同一句上，掃描結果可以重現；也才看得出「T1 出錯之後 T2 照判」。
  const D = 'dev-c3-000001', E = 'dev-c3-000002';
  const FIX = { BOUNTY_VERIFY_ORDER: 'fixed' };
  const seed = boardSql('屏東線') + boardSql('南迴線') + boardSql('山線') + claimSql({ id: 'claim-c3', actor: D, seg: KT('屏東線', 'S0|S1'), pts: 9 });
  const build = () => {
    const w = world({ seed });
    putBatches(w.db, { actor: D, trainNo: 'T1', lnId: '屏東線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
    putBatches(w.db, { actor: D, trainNo: 'T1', lnId: '南迴線', pts: leg({ sec: 400, t0: 30701 }), first: 100 });
    putBatches(w.db, { actor: E, trainNo: 'T2', lnId: '山線', pts: leg({ sec: 700 }), first: 0 });
    return w;
  };
  const wc = build();
  const f0 = faulty(wc.DELAY_DB, -1);
  wc.env.DELAY_DB = f0.db;
  const cleanSt = await wc.cron(FIX);
  const N = f0.st.n, clean = snap(wc);
  const res = [];
  for (let k = 1; k <= N; k++) {
    const w = build();
    const f = faulty(w.DELAY_DB, k);
    w.env.DELAY_DB = f.db;
    let threw = null, st1 = null;
    try { st1 = await w.cron(FIX); } catch (e) { threw = String(e.message).slice(0, 40); }
    w.env.DELAY_DB = w.DELAY_DB;
    const sk = strikes(w).map(r => r.k);                                     // 這一發記下了哪幾班
    const t2Done = q.count(w, 'bounty_samples', "actor=? AND verdict='pending'", E) === 0;   // 排在後面的 T2 這一發判完了沒
    // 那一發若連租約都沒釋放（例外正好打在釋放那一句），真實世界裡 20 分鐘後自己過期；這裡直接讓它過期，模擬「隔天那一發」。
    expireLease(w);
    let reruns = 0;
    while (q.pending(w) > 0 && reruns < 3) { await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) }); expireLease(w); reruns++; }
    const s = snap(w);
    res.push({ k, threw: !!threw, stopBy: st1 && st1.stopBy, errors: st1 ? st1.errors : null, sk, t2Done, reruns, pending: q.pending(w),
      strikesAfter: strikes(w).length, diff: Object.keys(s).filter(key => s[key] !== clean[key]) });
  }
  const bad = res.filter(r => r.diff.length || r.pending);
  console.log(`   C3 乾淨一次跑完 ${N} 次 D1 呼叫（ok ${cleanSt.ok}／可惜 ${cleanSt.unusable}／籌碼 ${cleanSt.chips}）；逐一注入：` +
    res.map(r => `${r.k}${r.threw ? '拋' : r.errors ? '記' : '・'}`).join(' '));
  ok(`C3a [B7] ${N} 個中斷點全部重跑後，帳本、登記、點數、認領、看板、樣本六張表都與一次跑完逐列相同，而且沒有留 pending`,
    N >= 20 && bad.length === 0, J(bad.map(r => [r.k, r.diff.join('+'), r.pending])));
  // 班車裡面出錯的中斷點：記下那一班（恰一列）、不停手；其中 T1 出錯的，同一發照樣判完 T2（舊寫法「出錯就停手」T2 會留 pending）
  const inTrain = res.filter(r => r.errors), t1Faults = inTrain.filter(r => J(r.sk) === J([STRIKE(D, 'T1')]));
  ok('C3b [ISO] 中斷真的發生在班車裡面、而且沒有讓整發停下：每個這種點都恰記下一班、stopBy 不是 error；T1 出錯的點同一發照樣判完 T2；也真的有整發丟例外的點（租約、清單那幾句）',
    t1Faults.length > 0 && t1Faults.every(r => r.t2Done) && inTrain.every(r => r.errors === 1 && r.sk.length === 1 && r.stopBy === null) && res.some(r => r.threw),
    J(res.map(r => [r.k, r.threw ? 'T' : r.errors ? r.sk.map(k => k.split('|').pop()).join() + (r.t2Done ? '+T2' : '') : '-'])));
  ok('C3c [ISO] 重跑判得過之後，每一個中斷點留下的出錯記錄都刪掉了（0 列）', res.every(r => r.strikesAfter === 0),
    J(res.filter(r => r.strikesAfter).map(r => [r.k, r.strikesAfter])));
});

// ═══ LS：租約 ═══════════════════════════════════════════════════════════════
await attempt('LSa', async () => {
  // 兩發重疊：外面那一發讀完一班車的樣本、還沒寫之前（注入點：逐站觀測那一句），裡面又跑一發。
  // 沒有租約時兩發都會判這一班、點數與 sample_count 各加兩次（42、2）；有租約時裡面那一發什麼都不動。
  const A = 'dev-ls-a00001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'L1', pts: leg({ sec: 700 }) });
  let inner = null;
  const h = hookOnce(w.DELAY_DB, /FROM tra_station_events/, async () => { inner = await w.cron(); });
  const outer = await w.cron();
  ok('LSa [租約] 兩發重疊：裡面那一發 locked、判 0 班；外面那一發判完——點數 21（不是 42）、sample_count 各 1（不是 2）、籌碼 1 顆',
    h.fired >= 1 && inner && inner.locked === true && inner.trains === 0 && outer.locked === false && outer.trains === 1 &&
      q.points(w, A) === 21 && J(q.sampleCounts(w, '山線')) === J(S7) && q.bal(w, A) === 1,
    J({ inner, outer: { locked: outer.locked, trains: outer.trains }, points: q.points(w, A), sc: q.sampleCounts(w, '山線') }));
  ok('LSa2 跑完之後租約列刪掉了（下一發不必等 20 分鐘）', q.lease(w) === null, J(q.lease(w)));
});
await attempt('LSb', async () => {
  const A = 'dev-ls-b00001';
  const w = world({ seed: boardSql('山線') + `INSERT INTO kv_blobs (k,v,updated) VALUES ('${LEASE}','{"token":"old","until":1}','x');` });
  putBatches(w.db, { actor: A, trainNo: 'L1', pts: leg({ sec: 700 }) });
  const st = await w.cron();
  ok('LSb [租約] 前一發留下的租約已過期：這一發照樣拿到、判完（ok、1 顆），跑完租約列刪掉',
    st.locked === false && st.trains === 1 && q.verdicts(w, A, 'L1') === 'ok' && q.bal(w, A) === 1 && q.lease(w) === null, J({ st, lease: q.lease(w) }));
});
await attempt('LSc', async () => {
  const A = 'dev-ls-c00001';
  const live = J({ token: 'other-run', until: Date.now() + 10 * 60e3 });
  const w = world({ seed: boardSql('山線') + `INSERT INTO kv_blobs (k,v,updated) VALUES ('${LEASE}','${live}','x');` });
  putBatches(w.db, { actor: A, trainNo: 'L1', pts: leg({ sec: 700 }) });
  const f = await fire(w);
  const line = [...f.logs, ...f.errs].find(s => s.includes('[cron bounty 驗證]')) || '';
  ok('LSc [租約] 別人的租約還沒到期：這一發（真的 scheduled() 判定時段）什麼都沒動——樣本仍 pending、0 顆；租約列原封不動；log 寫「跳過」',
    q.verdicts(w, A, 'L1') === 'pending' && q.bal(w, A) === 0 && q.lease(w) && q.lease(w).v === live && line.includes('跳過') && f.logs.includes(line) && !f.threw,
    J({ v: q.verdicts(w, A, 'L1'), lease: q.lease(w), line, threw: f.threw }));
});
await attempt('LSe', async () => {
  // 這一發的租約在判定途中被別人接手（例如這一發慢到超過 20 分鐘）：收尾時只刪「自己那一份」，不能刪掉接手那一發的租約。
  const A = 'dev-ls-e00001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'L1', pts: leg({ sec: 700 }) });
  const other = J({ token: 'taken-over', until: Date.now() + 10 * 60e3 });
  const h = hookOnce(w.DELAY_DB, /FROM tra_station_events/, async () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
  const st = await w.cron();
  // 這一發確實讀到了這一班（注入點那一句跑過）；被接手之後它的寫入全被圍欄擋下，所以判定數是 0——統計只算真的標到的（第二輪 B1f，
  // 舊版讀完列就先加，這裡會是 1）。樣本仍 pending。
  ok('LSe [租約] 途中被接手：收尾只刪自己那一份——接手那一發的租約列還在、值沒變；這一發讀到了這一班、但寫入不動任何列（見 N3），判定數 0、樣本仍 pending',
    h.fired >= 1 && st.trains === 0 && st.trips === 0 && q.verdicts(w, A, 'L1') === 'pending' && q.lease(w) && q.lease(w).v === other,
    J({ fired: h.fired, trains: st.trains, trips: st.trips, v: q.verdicts(w, A, 'L1'), lease: q.lease(w) }));
});

// ═══ R1：一條線組的寫入＝一個 batch ═══════════════════════════════════════════════
await attempt('R1', async () => {
  // 超長線 120 段、一班 12,001 點（21 批）；板上 120 段都有、X000|X001 有這個人的認領（鎖價 9）。
  // 期望：標記已判定只有一句（綁 8 個值：6 個＋租約圍欄的鍵與值；樣本 id 是一個 21 個元素的 JSON 陣列），跟點數、sample_count、關認領在同一個 batch（共 4 句）。
  // 點數：119 段×3＋9＝366 → 每日計點上限 200。舊版一批一句標記（21 句、每句重綁整份覆蓋段），外加逐段各幾句。
  const A = 'dev-r1-000001';
  const w = world({ seed: boardSql('超長線', XL_SEGS) + claimSql({ id: 'claim-r1', actor: A, seg: KT('超長線', 'X000|X001'), pts: 9 }) });
  putBatches(w.db, { actor: A, trainNo: 'R1', lnId: '超長線', pts: leg({ sec: 12000 }), size: 600 });
  const log = spyBatches(w.DELAY_DB);
  const st = await w.cron();
  const withMark = log.filter(b => b.some(s => MARK_RE.test(s.sql)));
  const g = withMark[0] || [];
  const mark = g.find(s => MARK_RE.test(s.sql));
  let ids = [];
  try { ids = JSON.parse(mark.p[5]); } catch (e) {}
  const kinds = g.map(s => /^UPDATE bounty_samples/.test(s.sql) ? 'mark' : /^INSERT INTO bounty_points/.test(s.sql) ? 'points'
    : /^UPDATE bounty_board SET sample_count/.test(s.sql) ? 'sample_count' : /^UPDATE bounty_claims/.test(s.sql) ? 'claims' : s.sql.slice(0, 30));
  const bindChars = g.reduce((a, s) => a + s.p.reduce((b, x) => b + String(x).length, 0), 0);
  ok('R1a [R1] 這一條線組（120 段）的寫入＝一個 batch、四句：標記、點數、sample_count、關認領',
    withMark.length === 1 && J(kinds) === J(['mark', 'points', 'sample_count', 'claims']), J({ batches: withMark.length, kinds }));
  let leaseTok = null;
  try { leaseTok = JSON.parse(mark.p[7]).token; } catch (e) {}
  ok('R1b [R1] 標記只有一句、綁 8 個值（最後兩個是租約圍欄：租約的鍵與這一發的租約值），樣本 id 以一個 JSON 陣列帶 21 個（不是一批一句）；整個 batch 綁的字元數 < 64 KB',
    !!mark && mark.p.length === 8 && mark.p[6] === LEASE && typeof leaseTok === 'string' && leaseTok.length > 0 && ids.length === 21 && bindChars < 65536,
    J({ p: mark && mark.p.length, fence: mark && mark.p.slice(6), ids: ids.length, bindChars }));
  ok('R1c 結果照舊：ok、點數 200（119×3＋9＝366 過每日上限 200）、120 段 sample_count 各 1、認領 fulfilled、籌碼 1 顆',
    q.verdicts(w, A, 'R1') === 'ok' && q.points(w, A) === 200 && q.sampleCounts(w, '超長線').length === 120 && q.sampleCounts(w, '超長線').every(n => n === 1) &&
      one(w, "SELECT status FROM bounty_claims WHERE id='claim-r1'").status === 'fulfilled' && st.chips === 1,
    J({ v: q.verdicts(w, A, 'R1'), p: q.points(w, A), chips: st.chips }));
});

// ═══ R2：記憶體上限——前次線組不讀 payload、超量的車整班可疑 ═══════════════════════════
await attempt('R2a', async () => {
  // 遲傳（同 cron2 J1）：前半段 400 秒（t 30000–30400，3 批：30000–30199、30200–30399、30400）先判掉；後半段 400 秒晚到。
  // 後半那一發讀前次線組：每一列只回 [{t:最早},{t:最晚}]，而籌碼照樣看得到整班 801 秒 → 補 1 顆。
  const A = 'dev-r2a-00001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'J1', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
  await w.cron();
  putBatches(w.db, { actor: A, trainNo: 'J1', pts: leg({ sec: 400, t0: 30401, d0: 8000 }), first: 100 });
  const prior = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (PRIOR_RE.test(sql)) prior.push(...rs.map(r => ({ ...r }))); });
  const st2 = await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  // u0／u1＝「小於半天的 t 加一天」之後的最早與最晚（跨午夜用，第十一批）：30000、30400 都小於 43200 → 116400、116800（這一組沒跨午夜，判定端用 t0／t1）
  ok('R2a1 [R2／C4] 前次線組在 SQL 裡依線彙總：前半 3 批只回 1 列（山線）——最壞判定 ok（worst 1）、最早 30000、最晚 30400、跨午夜用的 u0／u1＝116400／116800、不是模擬器；payload、segs 等其他欄都不送回',
    J(prior) === J([{ sys: 'tra_sched', ln_id: '山線', worst: 1, t0: 30000, t1: 30400, u0: 116400, u1: 116800, sim: 0 }]), J(prior));
  ok('R2a2 籌碼判斷照舊看整班（前 400＋後 400＝801 秒 ≥ 600）：補發 1 顆', st2.chips === 1 && q.bal(w, A) === 1, J({ chips: st2.chips, bal: q.bal(w, A) }));
});
await attempt('C4', async () => {
  // 前次的列很多、每列 segs 都很大（獨立驗收 C4：一個帳號併進 k 台都錄了同一班的裝置，列數就是 k 倍；segs 是判定時寫下的整組覆蓋段，最長的線一列約 8 KB）。
  // A 的 C4 這一班：前面 300 批已判 ok（山線 150 批 t 30000–30299、南迴線 150 批 t 30300–30400，每批 segs 約 8 KB），後半 1 批山線 400 秒 pending。
  // 期望：前次查詢只回 2 列（一條線一列）、送回的全部不到 1 KB（舊版每列帶 segs：300 列約 2.4 MB）；
  // 籌碼照舊看整班：30000–30801＝801 秒 ≥ 600，而且前次 ok 的南迴線是偏遠線 → ×2 ＝ 2 顆（前次組沒有 segs 也要算進偏遠判斷）。
  const A = 'uid-c4-0000001';
  const w = world({ seed: boardSql('山線') + boardSql('南迴線') + pointsSql([[A, A, 0, null]]) });
  const big = ln => J(Array.from({ length: 91 }, (_, i) => ({ key: KT(ln, SEGS10[i % 9]), dir: 0, kind: 'track', slot: 'pad-' + String(i).padStart(3, '0') + '-' + 'x'.repeat(24), cov: 1 })));
  const ins = w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
    " VALUES (?,?,'tra_sched',?,'C4',0,?,?,?,?,'ok',?)");
  w.db.exec('BEGIN');
  for (let i = 0; i < 300; i++) {
    const ln = i < 150 ? '山線' : '南迴線', t = i < 150 ? 30000 + i * 2 : 30300 + Math.min(100, (i - 150) * 2);
    ins.run(`c4-prior-${String(i).padStart(3, '0')}`, A, ln, D28, J([{ d: i, t, v: 20, acc: 8 }, { d: i + 1, t: Math.min(t + 1, i < 150 ? 30299 : 30400), v: 20, acc: 8 }]), big(ln), NOW_MS - 7200e3 + i, J(APP));
  }
  w.db.exec('COMMIT');
  putBatches(w.db, { actor: A, trainNo: 'C4', pts: leg({ sec: 400, t0: 30401 }), first: 500 });
  const segBytes = one(w, "SELECT SUM(length(segs)) n FROM bounty_samples WHERE train_no='C4' AND verdict='ok'").n;
  const prior = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (PRIOR_RE.test(sql)) prior.push(...rs.map(r => ({ ...r }))); });
  const st = await w.cron();
  const sent = J(prior).length;
  ok('C4 [C4] 前次 300 批（segs 合計 > 2 MB）：前次查詢只回 2 列（山線、南迴線，各 worst 1）、全部不到 1 KB、沒有 segs／payload 欄；整班 801 秒、南迴線偏遠 ×2 → 2 顆',
    segBytes > 2e6 && prior.length === 2 && sent < 1024 && prior.every(r => J(Object.keys(r)) === J(['sys', 'ln_id', 'worst', 't0', 't1', 'u0', 'u1', 'sim']) && r.worst === 1) &&
      J(prior.map(r => r.ln_id).sort()) === J(['南迴線', '山線'].sort()) && st.chips === 2 && J(q.trips(w)) === J([{ actor: A, delta: 2, ref: `${A}|${D28}|C4`, day: D28 }]),
    J({ segBytes, rows: prior.length, sent, prior, chips: st.chips, trips: q.trips(w) }));
});
// 超量的車：看哪一句查詢把它的 payload 讀回了 Worker（spyRows 看每一句回的每一列；記整句 SQL，對照組拿 LOAD_RE 比）
const payloadReads = (w, trainNo) => {
  const hits = [];
  spyRows(w.DELAY_DB, (sql, rs) => { for (const r of rs) if ('payload' in r && String(r.train_no) === trainNo) hits.push(sql); });
  return hits;
};
for (const [tag, why, put, extra] of [
  ['R2b', '批數 721（每人每日上限 720＋1，每批 1 點）', w => putBatches(w.db, { actor: 'dev-r2-ov0001', trainNo: 'OV', pts: Array.from({ length: 721 }, (_, i) => ({ d: i, t: 30000 + i, v: 1, acc: 5 })), size: 1 }),
    w => q.count(w, 'bounty_samples', "train_no='OV'") === 721],
  ['R2c', '200 批、每批 600 點（總長超過 4 MB，批數沒超）', w => putBatches(w.db, { actor: 'dev-r2-ov0001', trainNo: 'OV', pts: leg({ sec: 119999 }), size: 600 }),
    w => q.count(w, 'bounty_samples', "train_no='OV'") === 200 && one(w, "SELECT SUM(length(payload)) n FROM bounty_samples WHERE train_no='OV'").n > 4 * 1024 * 1024],
]) {
  await attempt(tag, async () => {
    const A = 'dev-r2-ov0001', H = 'dev-r2-hon001';
    const w = world({ seed: boardSql('山線') });
    put(w);
    putBatches(w.db, { actor: H, trainNo: 'H1', pts: leg({ sec: 700 }) });      // 同一發裡另一班正常的車：照樣判
    const hits = payloadReads(w, 'OV'), hitsH = payloadReads(w, 'H1');
    const st = await w.cron();
    ok(`${tag}0 [前提] fixture 真的是${why}`, extra(w), J(one(w, "SELECT COUNT(*) c, SUM(length(payload)) n FROM bounty_samples WHERE train_no='OV'")));
    ok(`${tag}1 [對照] 同一個監聽器看得到正常那一班（H1）的 payload 由逐班讀取那一句讀回——下一條「OV 一句都沒讀回」不是因為監聽器或正規式比對不到`,
      hitsH.some(s => LOAD_RE.test(s)), J(hitsH.map(s => s.slice(0, 50))));
    ok(`${tag} [R2] ${why}：整班 suspect（原因碼 oversize、覆蓋段空）、0 顆；這班車的 payload 沒有任何一句讀回 Worker；同一發另一班照樣 ok`,
      q.verdicts(w, A, 'OV') === 'suspect' && q.rejects(w, A, 'OV') === 'oversize' && q.count(w, 'bounty_samples', "train_no='OV' AND segs<>'[]'") === 0 &&
        q.bal(w, A) === 0 && hits.length === 0 && st.oversize === 1 && q.verdicts(w, H, 'H1') === 'ok',
      J({ v: q.verdicts(w, A, 'OV'), rej: q.rejects(w, A, 'OV'), hits: hits.slice(0, 3).map(s => s.slice(0, 40)), oversize: st.oversize, h: q.verdicts(w, H, 'H1') }));
  });
}
await attempt('R2d', async () => {
  // 對照：一班正常的車切成 101 批（每批 7 點，700 秒）——批數多但遠在上限內，照常判 ok，不是 oversize。
  const A = 'dev-r2d-00001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'M1', pts: leg({ sec: 700 }), size: 7 });
  const st = await w.cron();
  ok('R2d [對照] 101 批的正常車：ok、1 顆、oversize 0', q.count(w, 'bounty_samples', "train_no='M1'") === 101 && q.verdicts(w, A, 'M1') === 'ok' &&
    q.rejects(w, A, 'M1') === '' && q.bal(w, A) === 1 && st.oversize === 0, J({ v: q.verdicts(w, A, 'M1'), st: st.oversize }));
});
await attempt('R2e', async () => {
  // 競態：第一段數到 700 批（沒超量），第二段讀之前又灌進 30 批（注入點：讀這班車那一句）。讀的那一句有 LIMIT 721：
  // 讀回恰 721 列就知道超量 → 整班（730 列全部）判可疑。沒有 LIMIT 的話會把 730 批全讀進來。
  const A = 'dev-r2e-00001';
  const w = world({ seed: boardSql('山線') });
  const mk = (n, from) => Array.from({ length: n }, (_, i) => ({ d: from + i, t: 30000 + from + i, v: 1, acc: 5 }));
  putBatches(w.db, { actor: A, trainNo: 'RC', pts: mk(700, 0), size: 1 });
  const loads = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LOAD_RE.test(sql)) loads.push(rs.length); });
  hookOnce(w.DELAY_DB, LOAD_RE, async () => { putBatches(w.db, { actor: A, trainNo: 'RC', pts: mk(30, 700), size: 1, first: 700 }); });
  const st = await w.cron();
  ok('R2e [R2] 第一段之後才灌進來的 30 批：讀那一班只讀回 721 列（LIMIT），整班 730 列全部 suspect／oversize',
    J(loads) === J([721]) && q.count(w, 'bounty_samples', "train_no='RC' AND verdict='suspect' AND reject_code='oversize'") === 730 && st.oversize === 1,
    J({ loads, suspect: q.count(w, 'bounty_samples', "train_no='RC' AND verdict='suspect'"), st: st.oversize }));
});

// ═══ R3：一班車判定出錯 → error 等級、記下來、同一發繼續判下一班；下一發判得過就刪記錄 ═══════════════════════
await attempt('R3', async () => {
  // 寫死次序：E1（dev-r3-000001）先、E2 後。E1 讀樣本那一句丟錯（D1 的暫時錯誤）。
  const E1 = 'dev-r3-000001', E2 = 'dev-r3-000002';
  const w = world({ seed: boardSql('山線'), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  putBatches(w.db, { actor: E1, trainNo: 'E1', pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: E2, trainNo: 'E2', pts: leg({ sec: 700 }) });
  const h = hookOnce(w.DELAY_DB, LOAD_RE, async () => { throw new Error('D1_ERROR: 模擬的暫時錯誤'); });
  const f = await fire(w);
  const line = f.errs.find(s => SUMMARY_RE.test(s)) || '';
  const which = f.errs.find(s => s.includes('這班車判定出錯')) || '';
  ok('R3a [R3] 第一班（E1）讀樣本就出錯：判定那一行走 console.error、寫出「1 班判定出錯」「已記下」與錯誤訊息；另一行 console.error 指名是哪一班（記錄的鍵）；' +
    'console.log 沒有判定那一行；讀取那一句這一發執行了 2 次（E1 丟錯、E2 照讀）；scheduled 不丟例外',
    h.fired === 2 && line.includes('1 班判定出錯') && line.includes('已記下') && line.includes('D1_ERROR: 模擬的暫時錯誤') &&
      which.includes(STRIKE(E1, 'E1')) && !f.logs.some(s => SUMMARY_RE.test(s)) && !f.threw,
    J({ fired: h.fired, line: line.slice(0, 200), which: which.slice(0, 120), logs: f.logs.filter(s => SUMMARY_RE.test(s)), threw: f.threw }));
  const sk = strikes(w);
  let skv = {};
  try { skv = JSON.parse(sk[0].v); } catch (e) {}
  ok('R3b [ISO] E1 留 pending、記下恰一列（鍵＝…|E1，值帶錯誤訊息）；同一發繼續判 E2：ok、1 顆；租約已釋放',
    q.verdicts(w, E1, 'E1') === 'pending' && sk.length === 1 && sk[0].k === STRIKE(E1, 'E1') && String(skv.error).includes('D1_ERROR') &&
      q.verdicts(w, E2, 'E2') === 'ok' && q.bal(w, E2) === 1 && q.lease(w) === null,
    J({ e1: q.verdicts(w, E1, 'E1'), sk, e2: q.verdicts(w, E2, 'E2'), bal: q.bal(w, E2), lease: q.lease(w) }));
  const f2 = await fire(w);
  ok('R3c [ISO] 下一發（沒有故障）：E1 判成 ok、1 顆；它的記錄刪掉（0 列）；判定那一行回到 console.log、沒有任何 error 等級的判定 log',
    q.verdicts(w, E1, 'E1') === 'ok' && q.bal(w, E1) === 1 && strikes(w).length === 0 && f2.logs.some(s => SUMMARY_RE.test(s)) &&
      !f2.errs.some(s => s.includes('[cron bounty 驗證]')) && !f2.threw,
    J({ e1: q.verdicts(w, E1, 'E1'), bal: q.bal(w, E1), sk: strikes(w), errs: f2.errs.map(s => s.slice(0, 80)) }));
});

// ═══ ISO：記下來的班車之後每一發排在最後；D1 整個不能用才停手 ═══════════════════════════════════
await attempt('ISO2', async () => {
  // 帳號 U（可信）的 U1、匿名 a、b 各 1 班。沒有記錄時 U1 排第一（可信先）；U1 已出錯 2 次（n＝2，BOUNTY_VERIFY_STRIKES_TO_LAST）時排最後
  // ——連可信身分也一樣。兩種模式都驗。只錯過 1 次的見 ISO5。
  const U = 'uid-iso-0000U', A = 'dev-iso-0000a', B = 'dev-iso-0000b';
  for (const mode of ['fixed', '']) {
    const order = async (withStrike) => {
      const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) +
        (withStrike ? `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(U, 'U1')}','{"at":1,"error":"x","n":2}','x');` : '') });
      bulk(w.db, [{ actor: U, trainNo: 'U1', pts: TINY }, { actor: A, trainNo: 'A1', pts: TINY }, { actor: B, trainNo: 'B1', pts: TINY }]);
      const seen = listOf(w);
      await w.cron({ BOUNTY_SUBREQ_BUDGET: '5', ...(mode ? { BOUNTY_VERIFY_ORDER: mode } : {}) });
      return (seen[0] || []).map(r => r.train);
    };
    const plain = await order(false), struck = await order(true);
    ok(`ISO2${mode ? 'a' : 'b'} [ISO] 記錄過出錯的班車排在最後（${mode || '隨機'}）：沒記錄時 U1（可信）排第一；U1 有記錄時排第三` + (mode ? '（清單 A1、B1、U1）' : ''),
      plain.length === 3 && plain[0] === 'U1' && struck.length === 3 && struck[2] === 'U1' && (mode !== 'fixed' || J(struck) === J(['A1', 'B1', 'U1'])),
      J({ plain, struck }));
  }
});
// 清單那一句執行完之後 D1 整個不能用：之後每一次查詢、每一個 batch 都丟錯（failed＝丟了幾次）。
function breakAfter(DELAY_DB, re) {
  const st = { broken: false, failed: 0 };
  const orig = DELAY_DB.prepare.bind(DELAY_DB), origBatch = DELAY_DB.batch.bind(DELAY_DB);
  const fail = () => { st.failed++; throw new Error('D1_ERROR: 資料庫整個不能用（測試注入）'); };
  const wrapS = (s, trips) => new Proxy(s, { get(t, k) {
    if (k === 'bind') return (...p) => wrapS(t.bind(...p), trips);
    if (k === 'all' || k === 'first' || k === 'run' || k === 'raw') return async (...a) => {
      if (st.broken) fail();
      const r = await t[k](...a);
      if (trips) st.broken = true;
      return r;
    };
    const v = t[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  DELAY_DB.prepare = sql => wrapS(orig(sql), re.test(sql));
  DELAY_DB.batch = async stmts => { if (st.broken) fail(); return origBatch(stmts); };
  return st;
}
await attempt('ISO3', async () => {
  const w = world({ seed: boardSql('山線'), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  for (const a of ['dev-iso3-0001', 'dev-iso3-0002', 'dev-iso3-0003']) putBatches(w.db, { actor: a, trainNo: 'K1', pts: leg({ sec: 700 }) });
  const brk = breakAfter(w.DELAY_DB, LIST_RE);
  const f = await fire(w);
  const line = f.errs.find(s => SUMMARY_RE.test(s)) || '';
  ok('ISO3 [ISO] 清單讀完之後 D1 整個不能用：第一班出錯、連記錄都寫不進去 → 停手，不再試後面兩班（清單之後恰 3 次失敗的呼叫：讀第一班、寫記錄、釋放租約）；' +
    '判定那一行走 console.error、寫「連記錄都寫不進 D1 而停手」；3 班全留 pending、沒有任何記錄列；scheduled 不丟例外',
    brk.broken && brk.failed === 3 && line.includes('1 班判定出錯') && line.includes('連記錄都寫不進 D1 而停手') &&
      q.pending(w) === q.count(w, 'bounty_samples') && strikes(w).length === 0 && !f.threw,
    J({ failed: brk.failed, line: line.slice(0, 220), pending: q.pending(w), sk: strikes(w).length, threw: f.threw }));
});

await attempt('ISO4', async () => {
  // 每一發都會丟錯的壞班車（資料本身的問題，不是注入的 D1 錯誤）：payload 是 [null,null]——上傳端的清洗不會產生，只可能是直接寫庫或日後的缺陷，
  // 判定組回整趟、依時間排序時讀 null.t 丟 TypeError。寫死次序下它排第一（actor 字母序最前、每人第 1 班）。
  // 期望：第一發記下它、繼續判後面兩班（ok、各 1 顆）；第二發它是唯一 pending、排在最後照樣再丟一次、記錄仍恰一列、不停手。
  const P = 'dev-iso4-000A', H = 'dev-iso4-000B';
  const w = world({ seed: boardSql('山線'), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
    " VALUES ('iso4-poison',?,'tra_sched','山線','P1',0,?,'[null,null]',NULL,?,'pending',?)").run(P, D28, NOW_MS - 3600e3, J(APP));
  putBatches(w.db, { actor: H, trainNo: 'H1', pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: H, trainNo: 'H2', pts: leg({ sec: 700, t0: 40000 }) });
  const seen = listOf(w);
  const st1 = await w.cron();
  const sk1 = strikes(w);
  let err1 = '', n1 = null;
  try { const v = JSON.parse(sk1[0].v); err1 = String(v.error); n1 = v.n; } catch (e) {}
  ok('ISO4a [ISO] 壞班車排第一、判定丟 TypeError：記下恰一列（它的鍵、出錯次數 n＝1）、同一發繼續判完後面兩班（ok、各 1 顆）；errors 1、stopBy 不是 error',
    J((seen[0] || []).map(r => r.train)) === J(['P1', 'H1', 'H2']) && st1.errors === 1 && st1.stopBy === null && sk1.length === 1 && sk1[0].k === STRIKE(P, 'P1') && n1 === 1 &&
      /null/.test(err1) && q.verdicts(w, P, 'P1') === 'pending' && q.verdicts(w, H, 'H1') === 'ok' && q.verdicts(w, H, 'H2') === 'ok' && q.bal(w, H) === 2,
    J({ order: (seen[0] || []).map(r => r.train), errors: st1.errors, stopBy: st1.stopBy, sk1, p: q.verdicts(w, P, 'P1'), bal: q.bal(w, H) }));
  const st2 = await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  const sk2 = strikes(w);
  let n2 = null;
  try { n2 = JSON.parse(sk2[0].v).n; } catch (e) {}
  ok('ISO4b [ISO] 第二發：壞班車照樣丟錯、照樣記（仍恰一列、出錯次數累加到 n＝2——之後每一發排最後）、不停手；仍 pending；H 的帳沒有變',
    st2.errors === 1 && st2.stopBy === null && sk2.length === 1 && sk2[0].k === STRIKE(P, 'P1') && n2 === 2 && q.verdicts(w, P, 'P1') === 'pending' && q.bal(w, H) === 2,
    J({ errors: st2.errors, stopBy: st2.stopBy, sk2, bal: q.bal(w, H) }));
});

// ═══ ISO5／B5：出錯 2 次才排最後（第二輪獨立驗收 B5）═════════════════════════════════════
// 舊版錯過一次就排最後、記錄只在判過之後才刪：誠實班車被一次暫時錯誤（D1 連線中斷）記過之後，預算被塞滿的夜裡永遠輪不到。
await attempt('ISO5', async () => {
  // 帳號 U（可信）的 U1 與匿名 a、b 各 1 班（同 ISO2），U1 的記錄換成各種值。寫死次序：可信先 → 沒記錄時 U1 排第一。
  const U = 'uid-iso5-000U', A = 'dev-iso5-000a', B = 'dev-iso5-000b';
  const order = async v => {
    const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) +
      (v === null ? '' : `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(U, 'U1')}','${v}','x');`), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
    bulk(w.db, [{ actor: U, trainNo: 'U1', pts: TINY }, { actor: A, trainNo: 'A1', pts: TINY }, { actor: B, trainNo: 'B1', pts: TINY }]);
    const seen = listOf(w);
    await w.cron({ BOUNTY_SUBREQ_BUDGET: '1' });              // 只看清單的次序，一班都不判
    return (seen[0] || []).map(r => r.train).join();
  };
  const r = { none: await order(null), n1: await order('{"at":1,"error":"x","n":1}'), legacy: await order('{"at":1,"error":"x"}'),
    broken: await order('not json'), n2: await order('{"at":1,"error":"x","n":2}'), n5: await order('{"at":1,"error":"x","n":5}') };
  ok('ISO5 [第二輪 B5] 出錯次數分級：沒有記錄、錯過 1 次（n＝1）、舊格式（沒有 n，算 1 次）、值壞掉（算 1 次）→ U1 照常排第一；n＝2、n＝5 → 排最後',
    r.none === 'U1,A1,B1' && r.n1 === 'U1,A1,B1' && r.legacy === 'U1,A1,B1' && r.broken === 'U1,A1,B1' && r.n2 === 'A1,B1,U1' && r.n5 === 'A1,B1,U1', J(r));
});
await attempt('B5', async () => {
  // 誠實班車 H 被一次暫時錯誤記過（n＝1）；同一發還有 3 班別人的車。預算只夠判 1 班：寫死次序下 H（actor 字母序最前）照常排第一 → 判到。
  // 對照：H 已錯過 2 次（n＝2）→ 排最後、這一發判不到——證明預算真的只夠 1 班（上面判到不是因為預算夠大）。
  const H = 'dev-b5-00000a', O = ['dev-b5-00000b', 'dev-b5-00000c', 'dev-b5-00000d'];
  const run = async n => {
    const w = world({ seed: boardSql('山線') + `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(H, 'H1')}','{"at":1,"error":"Network connection lost","n":${n}}','x');`,
      env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
    putBatches(w.db, { actor: H, trainNo: 'H1', pts: leg({ sec: 700 }) });
    for (const a of O) putBatches(w.db, { actor: a, trainNo: 'O1', pts: leg({ sec: 700 }) });
    const st = await w.cron({ BOUNTY_SUBREQ_BUDGET: '7' });     // 第一班開始前已用 5（見 cron2 的 M2a），一班之後 ≥ 7 就停
    return { trains: st.trains, h: q.verdicts(w, H, 'H1'), bal: q.bal(w, H), sk: strikes(w).length };
  };
  const one1 = await run(1), two = await run(2);
  ok('B5 [第二輪 B5] 錯過 1 次的誠實班車照常排：預算只夠 1 班時判到的就是它（ok、1 顆、記錄隨即刪掉）；對照 n＝2：排最後、這一發判不到（仍 pending、記錄還在）',
    one1.trains === 1 && one1.h === 'ok' && one1.bal === 1 && one1.sk === 0 && two.trains === 1 && two.h === 'pending' && two.sk === 1, J({ one1, two }));
});

// ═══ SW：每一發開頭的出錯記錄清掃（第二輪 B4c／B4d）═══════════════════════════════════════
await attempt('SW', async () => {
  // 記錄五列＋別的鍵三列：
  //   orphan：那班車已判完（沒有 pending 列）——B4c（判得過的當下刪記錄那一句失敗、被吞掉）留下的形狀 → 刪
  //   legacy：舊格式（沒有 n）、那班車也沒有 pending → 刪
  //   merged：裝置 D 記過之後併進帳號 U（樣本已改名到 U，裝置鍵下沒有 pending）——B4d → 刪
  //   live：那班車還有 pending（還沒判）→ 留著（n 不動）
  //   liveU：同一班車改名後在 U 名下的記錄（還有 pending）→ 留著
  //   別的鍵：'bounty_verify_strike'（沒有「|」，在範圍之前）、'bounty_verify_strike~x'（「~」在「}」之後）、'bounty_verify_lease' 以外的快取 → 不動
  // 預算 1：一班都不判（清掃在清單之前），留下來的就只看清掃。
  const A = 'dev-sw-00000A', D = 'dev-sw-00000D', U = 'uid-sw-00000U';
  const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null], [D, null, 0, U]]) + 'INSERT INTO kv_blobs (k,v,updated) VALUES ' + [
    [STRIKE(A, 'J1'), '{"at":1,"error":"x","n":1}'], [STRIKE(A, 'J2'), '{"at":1,"error":"x"}'], [STRIKE(D, 'M1'), '{"at":1,"error":"x","n":1}'],
    [STRIKE(A, 'P1'), '{"at":1,"error":"x","n":1}'], [STRIKE(U, 'M1'), '{"at":1,"error":"x","n":1}'],
    ['bounty_verify_strike', 'keep-1'], ['bounty_verify_strike~x', 'keep-2'], ['tra_delay_stats_30d', 'keep-3'],
  ].map(([k, v]) => `('${k}','${v}','x')`).join(',') + ';' });
  putBatches(w.db, { actor: A, trainNo: 'J1', pts: TINY });
  w.db.exec("UPDATE bounty_samples SET verdict='ok' WHERE train_no='J1'");               // J1 已判完
  putBatches(w.db, { actor: A, trainNo: 'P1', pts: TINY });                              // P1 還是 pending
  putBatches(w.db, { actor: U, trainNo: 'M1', pts: TINY });                              // D 的 M1 併進 U 之後的樣子
  const st = await w.cron({ BOUNTY_SUBREQ_BUDGET: '1' });
  const left = rows(w, "SELECT k FROM kv_blobs WHERE k <> 'bounty_verify_lease' ORDER BY k").map(r => r.k);
  ok('SWa [第二輪 B4c／B4d] 清掃：沒有 pending 的記錄（判完的、舊格式的、裝置併進帳號之後的）刪掉；還有 pending 的兩列留著；範圍外的三個鍵不動；這一發一班都沒判',
    st.trains === 0 && J(left) === J(['bounty_verify_strike', STRIKE(A, 'P1'), STRIKE(U, 'M1'), 'bounty_verify_strike~x', 'tra_delay_stats_30d'].sort()), J({ left, trains: st.trains }));
  // 圍欄：清掃那一句執行前租約被接手 → 一列都不刪
  const w2 = world({ seed: `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(A, 'J1')}','{"at":1,"error":"x","n":1}','x');` });
  const other = J({ token: 'taken-over', until: Date.now() + 10 * 60e3 });
  const h = hookOnce(w2.DELAY_DB, /^DELETE FROM kv_blobs WHERE k >= \?/, async () => { w2.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
  await w2.cron();
  ok('SWb [第二輪 D4] 清掃那一句之前租約被接手：一列都不刪（孤兒記錄還在）；接手那一發的租約原封不動',
    h.fired === 1 && strikes(w2).length === 1 && (q.lease(w2) || {}).v === other, J({ fired: h.fired, sk: strikes(w2), lease: q.lease(w2) }));
});

// ═══ D4：出錯記錄的寫與刪都圍租約（第二輪 D4）══════════════════════════════════════════════
await attempt('D4', async () => {
  const other = J({ token: 'taken-over', until: Date.now() + 10 * 60e3 });
  // (a) 判得過就刪記錄那一句：這一發在第③段之前被接手（寫入全被擋、其實沒判到）→ 不能把記錄刪掉。記錄 n＝1（照常排、不是最後）。
  const A = 'dev-d4-000001';
  const w = world({ seed: boardSql('山線') + `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(A, 'F1')}','{"at":1,"error":"x","n":1}','x');` });
  putBatches(w.db, { actor: A, trainNo: 'F1', pts: leg({ sec: 700 }) });
  const h = hookOnce(w.DELAY_DB, CLAIMS_READ_RE, async () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
  await w.cron();
  ok('D4a [第二輪 D4] 第③段之前被接手：這班車仍 pending，而且它的出錯記錄沒有被刪（舊版以為判過了、照刪）',
    h.fired === 1 && q.verdicts(w, A, 'F1') === 'pending' && strikes(w).length === 1, J({ fired: h.fired, v: q.verdicts(w, A, 'F1'), sk: strikes(w) }));
  // (b) 寫記錄那一句：這一發被接手之後才丟錯 → 不寫記錄（舊版照寫）。
  const B = 'dev-d4-000002';
  const w2 = world({ seed: boardSql('山線') });
  putBatches(w2.db, { actor: B, trainNo: 'F2', pts: leg({ sec: 700 }) });
  const h2 = hookOnce(w2.DELAY_DB, LOAD_RE, async () => { w2.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); throw new Error('D1_ERROR: 模擬的暫時錯誤'); });
  const st2 = await w2.cron();
  ok('D4b [第二輪 D4] 被接手之後才丟錯：errors 1、不停手，但一列記錄都不寫；接手那一發的租約原封不動',
    h2.fired === 1 && st2.errors === 1 && st2.stopBy === null && strikes(w2).length === 0 && (q.lease(w2) || {}).v === other, J({ st2: { errors: st2.errors, stopBy: st2.stopBy }, sk: strikes(w2) }));
});

// ═══ B3e：系統性出錯時只印前 5 班（第二輪 B3e）══════════════════════════════════════════════
await attempt('B3e', async () => {
  // 8 班壞車（同 ISO4 的 [null,null]，每一班都丟 TypeError）。期望：console.error 的逐班那一行恰 5 行（前 5 班）；
  // 判定那一行寫 8 班出錯、已記下、「前 5 班」「其餘 3 班只記在 kv_blobs 的出錯記錄」；8 班都記下了。
  const w = world({ seed: boardSql('山線') });
  const ins = w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
    " VALUES (?,?,'tra_sched','山線','P1',0,?,'[null,null]',NULL,?,'pending',?)");
  for (let i = 1; i <= 8; i++) ins.run('b3e-poison-' + i, 'dev-b3e-00000' + i, D28, NOW_MS - 3600e3, J(APP));
  const f = await fire(w);
  const per = f.errs.filter(s => s.includes('這班車判定出錯'));
  const line = f.errs.find(s => SUMMARY_RE.test(s)) || '';
  ok('B3e [第二輪 B3e] 8 班都出錯：逐班的 console.error 恰 5 行；判定那一行寫「8 班判定出錯」「已記下」「前 5 班」「其餘 3 班只記在 kv_blobs 的出錯記錄」；8 班都記下；不丟例外',
    per.length === 5 && line.includes('8 班判定出錯') && line.includes('已記下') && line.includes('前 5 班') && line.includes('其餘 3 班只記在 kv_blobs 的出錯記錄') &&
      strikes(w).length === 8 && !f.threw, J({ per: per.length, line: line.slice(0, 300), sk: strikes(w).length, threw: f.threw }));
});

// ═══ N4：一班車的點數上看十幾萬（4 MB 塞得下）══════════════════════════════════════
// 最小的點（{d:0,t:0,v:0,acc:300}，每點 30 字元上下）：4 MB 塞得下約 14 萬點，超過 V8 函式引數的上限（本機 node v24 實測約 12.4 萬個就丟 RangeError）。
// acc 300 讓品質閘走「精確位置被關」那一支（會算整班誤差的範圍）；乘車日選週六，dwell 那一段才會算整趟與站附近的里程範圍。
const flat = n => Array.from({ length: n }, () => ({ d: 0, t: 0, v: 0, acc: 300 }));
const DSAT = '2026-07-25';                                   // 週六
await attempt('N4a', async () => {
  const pts = flat(400000);
  let cov = null, qg = null, err = null;
  try { cov = _bounty.coverageOf({ tripDate: DSAT, dir: 0, pts }, LINES['tra_sched|山線'], RULES, {}); } catch (e) { err = String(e && e.message); }
  try { qg = _bounty.qualityGate({ trainNo: 'N4', pts }, { line: null, events: [] }, RULES); } catch (e) { err = (err ? err + ' / ' : '') + String(e && e.message); }
  ok('N4a [N4] 40 萬點直接呼叫：coverageOf（週六、dwell 段）與 qualityGate（精確位置被關）都不丟例外；品質閘判 precise_off（誤差範圍 0）',
    new Date(DSAT + 'T00:00:00Z').getUTCDay() === 6 && err === null && Array.isArray(cov) && qg && qg.pass === false && qg.code === 'precise_off',
    J({ err, cov: cov && cov.length, qg }));
});
await attempt('N4b', async () => {
  // 端到端：週六的一班車，232 批 × 600 點＝139,200 點、總長 < 4 MB（過得了超量閘）。舊版在展開整班的點時丟 RangeError：
  // 這班車永遠 pending，而且每一發都停在它（獨立驗收的重現）。期望：判得出來（unusable／precise_off），沒有任何班車出錯；同一發另一班照樣 ok。
  const A = 'dev-n4b-00001', H = 'dev-n4b-hon01', NPTS = 139200;
  const w = world({ seed: boardSql('山線'), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  putBatches(w.db, { actor: A, trainNo: 'N4', date: DSAT, pts: flat(NPTS), size: 600 });
  putBatches(w.db, { actor: H, trainNo: 'H1', date: DSAT, pts: leg({ sec: 700 }) });
  const fx = one(w, "SELECT COUNT(*) n, SUM(length(payload)) b FROM bounty_samples WHERE train_no='N4'");
  ok('N4b0 [前提] fixture：232 批（≤ 720）、139,200 點（> 12.5 萬）、總長 < 4 MB（4,194,304）', fx.n === 232 && fx.b < 4 * 1024 * 1024 && NPTS > 125000, J(fx));
  const t0 = Date.now();
  const st = await w.cron();
  const ms = Date.now() - t0;
  const qc = rows(w, "SELECT DISTINCT quality_code c FROM bounty_samples WHERE train_no='N4'").map(r => r.c);
  ok('N4b [N4] 端到端：這班車判得出來（unusable／precise_off，不是 pending），這一發沒有任何班車出錯、沒有記錄列；同一發 H1 照樣 ok',
    q.verdicts(w, A, 'N4') === 'unusable' && J(qc) === J(['precise_off']) && st.errors === 0 && st.stopBy === null && strikes(w).length === 0 &&
      q.verdicts(w, H, 'H1') === 'ok',
    J({ v: q.verdicts(w, A, 'N4'), qc, errors: st.errors, error: st.error, stopBy: st.stopBy, h: q.verdicts(w, H, 'H1'), ms }));
});

// ═══ N2：清單之後才灌進來的批次，讀取那一句依長度截住 ════════════════════════════════════
await attempt('N2', async () => {
  // 清單那一刻這班車只有 10 批（每批 600 點、約 30 KB）；清單之後、讀這班車之前又灌進 180 批 → 190 批、總長超過 4 MB。
  // 舊版讀取那一句只有批數上限（LIMIT 721），190 批全部送回 Worker（獨立驗收量到最壞 49 MB）；現在依讀取順序累加長度，
  // 只送回「加到前一列為止還沒超過 4 MB」的列——最多 4 MB 再加一批，而且最後一列一定跨過上限，所以照樣判得出超量。
  const A = 'dev-n2-000001', H = 'dev-n2-hon001';
  const w = world({ seed: boardSql('山線'), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  const big = leg({ sec: 113999 });                          // 114,000 點＝190 批 × 600
  putBatches(w.db, { actor: A, trainNo: 'LB', pts: big.slice(0, 6000), size: 600 });
  putBatches(w.db, { actor: H, trainNo: 'H1', pts: leg({ sec: 700 }) });
  const loads = [];
  spyRows(w.DELAY_DB, (sql, rs) => {
    if (LOAD_RE.test(sql)) loads.push({ train: rs.length ? String(rs[0].train_no) : '', n: rs.length, bytes: rs.reduce((a, r) => a + String(r.payload).length, 0) });
  });
  const h = hookOnce(w.DELAY_DB, LOAD_RE, async () => { putBatches(w.db, { actor: A, trainNo: 'LB', pts: big.slice(6000), size: 600, first: 10 }); });
  const st = await w.cron();
  const fx = one(w, "SELECT COUNT(*) n, SUM(length(payload)) b, MAX(length(payload)) m FROM bounty_samples WHERE train_no='LB'");
  const lb = loads.find(l => l.train === 'LB') || { n: 0, bytes: 0 };
  const CAP = 4 * 1024 * 1024;
  ok('N2a [前提] 清單之後、讀取之前灌進 180 批：這班車最後 190 批（≤ 720，批數閘擋不到）、總長超過 4 MB', h.fired >= 1 && fx.n === 190 && fx.b > CAP, J(fx));
  ok('N2b [N2] 讀這班車那一句送回 Worker 的 payload：超過 4 MB（跨過上限的那一批有送回，才判得出超量）但不超過「4 MB 再加一批」；送回的批數少於 190',
    lb.bytes > CAP && lb.bytes <= CAP + fx.m && lb.n < 190, J({ lb, cap: CAP, maxBatch: fx.m }));
  ok('N2c [N2] 整班 190 批判可疑（oversize）、0 顆；同一發另一班 H1 照樣 ok',
    q.count(w, 'bounty_samples', "train_no='LB' AND verdict='suspect' AND reject_code='oversize'") === 190 && st.oversize === 1 && q.bal(w, A) === 0 &&
      q.verdicts(w, H, 'H1') === 'ok',
    J({ suspect: q.count(w, 'bounty_samples', "train_no='LB' AND verdict='suspect'"), oversize: st.oversize, h: q.verdicts(w, H, 'H1') }));
});

// ═══ N3：租約被接手之後，舊的那一發第③段不動任何列 ═══════════════════════════════════
// 注入點：第③段讀認領那一句（這一班 ② 的籌碼與登記已寫完、③ 的 batch 還沒送）→ 租約換成別人的（模擬這一發慢到超過 20 分鐘、被下一發接手）。
// 之後把別人的租約刪掉（接手那一發跑完、釋放），再跑一發＝接手那一發該做的事。
async function n3Run(rules) {
  const A = 'dev-n3-000001';
  const w = world({ seed: boardSql('山線') + claimSql({ id: 'claim-n3', actor: A, seg: KT('山線', 'S0|S1'), pts: 9 }), rules });
  putBatches(w.db, { actor: A, trainNo: 'F1', pts: leg({ sec: 700 }) });
  const other = J({ token: 'taken-over', until: Date.now() + 10 * 60e3 });
  const h = hookOnce(w.DELAY_DB, CLAIMS_READ_RE, async () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
  const look = () => ({ v: q.verdicts(w, A, 'F1'), point: q.point(w, A), sc: q.sampleCounts(w, '山線'),
    cov: rows(w, "SELECT covered_at IS NOT NULL c FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.c),
    claim: one(w, "SELECT status FROM bounty_claims WHERE id='claim-n3'").status, bal: q.bal(w, A), contrib: q.contrib(w, A) });
  await w.cron();
  const mid = { ...look(), lease: (q.lease(w) || {}).v };
  w.db.prepare('DELETE FROM kv_blobs WHERE k=?').run(LEASE);
  await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  return { h, other, mid, end: look() };
}
const Z9 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
await attempt('N3', async () => {
  const r = await n3Run();
  ok('N3a [N3] 租約在第③段之前被接手：舊的那一發第③段整組不動——樣本仍 pending、沒有點數列、sample_count 全 0、認領仍 open；' +
    '② 的籌碼 1 顆與登記 7 段已寫（冪等）；接手那一發的租約原封不動',
    r.h.fired >= 1 && r.mid.v === 'pending' && r.mid.point === null && J(r.mid.sc) === J(Z9) && r.mid.claim === 'open' &&
      r.mid.bal === 1 && r.mid.contrib === 7 && r.mid.lease === r.other, J(r.mid));
  ok('N3b [N3] 接手那一發把這一班判完、恰好記一次：ok、點數 27（6 段×3＋認領鎖價 9）、sample_count S0|S1…S6|S7 各 1、認領 fulfilled、籌碼仍 1 顆、登記仍 7 段',
    r.end.v === 'ok' && r.end.point && r.end.point.points === 27 && J(r.end.sc) === J(S7) && r.end.claim === 'fulfilled' && r.end.bal === 1 && r.end.contrib === 7,
    J(r.end));
});
await attempt('N3c', async () => {
  // 同一個情境換成「設定檔缺台鐵的 coverDistinct」（降級路徑：sample_count 與收滿寫在同一句、門檻取 coverN 台鐵 1）：那一句也要圍住。
  const rules = { ...RULES, coverDistinct: { THSR: RULES.coverDistinct.THSR } };
  const r = await n3Run(rules);
  ok('N3c [N3] 降級路徑（sample_count＋收滿同一句）：被接手的那一發 sample_count 全 0、沒有收滿；接手那一發之後 S0|S1…S6|S7 各 1、收滿（coverN 台鐵 1）',
    RULES.coverDistinct.TRA > 0 && r.mid.v === 'pending' && J(r.mid.sc) === J(Z9) && J(r.mid.cov) === J(Z9) &&
      r.end.v === 'ok' && J(r.end.sc) === J(S7) && J(r.end.cov) === J(S7),
    J({ mid: { sc: r.mid.sc, cov: r.mid.cov }, end: { sc: r.end.sc, cov: r.end.cov } }));
});

// N3e：接手那一發用「同一個 now」把同一班判完，之後被接手的那一發才送它第③段的 batch。
// 第③段的 MARKED 看的是「這一組的樣本此刻全是 verdict＝這一發的判定、verdict_at＝這一發的 now」：接手那一發的 now 若恰好相同
// （BOUNTY_NOW 固定，或兩發落在同一毫秒）、判定也相同，被接手那一發的 MARKED 照樣成立——這時只剩租約圍欄擋住點數、sample_count、收滿寫第二次。
// N3a／N3c 的接手那一發是在被接手那一發跑完之後才跑（樣本還是 pending），MARKED 自己就擋住了，量不到租約圍欄（突變 v6 的 N3_legacy 因此存活）。
// 注入點同 N3：被接手那一發第③段讀認領那一句；在那裡把它的租約改成過期、整個跑完接手的那一發（同一個 now、同一份資料＝同一個判定），再讓它繼續。
async function n3eRun(rules) {
  const A = 'dev-n3e-000001';
  const w = world({ seed: boardSql('山線') + claimSql({ id: 'claim-n3e', actor: A, seg: KT('山線', 'S0|S1'), pts: 9 }), rules });
  putBatches(w.db, { actor: A, trainNo: 'F1', pts: leg({ sec: 700 }) });
  let inner = null;
  const h = hookOnce(w.DELAY_DB, CLAIMS_READ_RE, async () => {
    w.db.prepare("UPDATE kv_blobs SET v=json_set(v, '$.until', 0) WHERE k=?").run(LEASE);
    inner = await w.cron();
  });
  const outer = await w.cron();
  const cov = rows(w, "SELECT covered_at IS NOT NULL c FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.c);
  const at = one(w, "SELECT COUNT(*) n, SUM(verdict='ok' AND verdict_at=?) same FROM bounty_samples WHERE actor=? AND train_no='F1'", NOW_MS, A);
  return { h, inner, outer, at, cov, v: q.verdicts(w, A, 'F1'), point: q.point(w, A), sc: q.sampleCounts(w, '山線'),
    claim: one(w, "SELECT status FROM bounty_claims WHERE id='claim-n3e'").status, bal: q.bal(w, A), contrib: q.contrib(w, A), lease: q.lease(w) };
}
await attempt('N3e', async () => {
  const pick = s => s && { trips: s.trips, ok: s.ok, chips: s.chips, locked: s.locked, error: s.error };
  const a = await n3eRun();
  ok('N3e0 [前提] 接手那一發在被接手那一發的第③段之前跑完、拿得到租約、判 ok；樣本全部標成 ok、verdict_at＝被接手那一發的 now（它的 MARKED 會成立，只剩租約圍欄擋）',
    a.h.fired >= 1 && a.inner && a.inner.locked === false && a.inner.trips === 1 && a.inner.ok === 1 && a.at.n > 0 && a.at.same === a.at.n,
    J({ fired: a.h.fired, inner: pick(a.inner), at: a.at }));
  ok('N3ea [N3] 接手那一發用同一個 now 判完之後，被接手的那一發第③段一句都不寫：點數恰 27（6 段×3＋認領鎖價 9，沒有加兩次）、sample_count S0|S1…S6|S7 各 1、' +
    '認領 fulfilled、籌碼仍 1 顆、登記仍 7 段；被接手那一發這一班不算判過（trips 0）；租約都已釋放',
    a.v === 'ok' && a.point && a.point.points === 27 && J(a.sc) === J(S7) && a.claim === 'fulfilled' && a.bal === 1 && a.contrib === 7 &&
      a.outer.trips === 0 && a.outer.ok === 0 && !a.lease,
    J({ point: a.point, sc: a.sc, claim: a.claim, bal: a.bal, contrib: a.contrib, outer: pick(a.outer), lease: a.lease }));
  // 降級路徑（設定檔缺台鐵的 coverDistinct：sample_count 與收滿同一句、門檻取 coverN 台鐵 1）。
  const b = await n3eRun({ ...RULES, coverDistinct: { THSR: RULES.coverDistinct.THSR } });
  ok('N3eb [N3] 降級路徑：同一個情境，sample_count 仍各 1（沒有加兩次）、收滿 S0|S1…S6|S7、點數恰 27；前提同 N3e0',
    RULES.coverDistinct.TRA > 0 && b.h.fired >= 1 && b.inner && b.inner.trips === 1 && b.at.n > 0 && b.at.same === b.at.n &&
      b.v === 'ok' && J(b.sc) === J(S7) && J(b.cov) === J(S7) && b.point && b.point.points === 27 && b.outer.trips === 0,
    J({ sc: b.sc, cov: b.cov, point: b.point, inner: pick(b.inner), outer: pick(b.outer), at: b.at }));
});

// N3d：租約在 ② 被接手（第二輪獨立驗收 D2）。注入點一：寫帳本那一句之前；注入點二：去重登記的 batch 之前。
// 舊版 ② 不圍（「兩者本來就冪等」）：冪等擋得住同一班入帳兩次，擋不住「兩發各自讀到今天還沒領、各自寫」——被接手的那一發照樣入帳、登記。
async function n3dRun(where) {
  const A = 'dev-n3d-000001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'F1', pts: leg({ sec: 700 }) });
  const other = J({ token: 'taken-over', until: Date.now() + 10 * 60e3 });
  const take = () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); };
  const h = { fired: 0 };
  if (where === 'chips') {
    const hk = hookOnce(w.DELAY_DB, /^INSERT OR IGNORE INTO chip_ledger/, async () => { take(); });
    Object.defineProperty(h, 'fired', { get: () => hk.fired });
  } else {
    const ob = w.DELAY_DB.batch.bind(w.DELAY_DB);
    w.DELAY_DB.batch = async stmts => {
      if (!h.fired && stmts.some(s => /^INSERT OR IGNORE INTO bounty_seg_contrib/.test(String(s && s._sql)))) { h.fired++; take(); }
      return ob(stmts);
    };
  }
  const users = () => rows(w, "SELECT distinct_ok_users d FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.d);
  const look = () => ({ v: q.verdicts(w, A, 'F1'), trips: q.trips(w), contrib: q.contrib(w, A), users: users(), point: q.point(w, A) });
  const st1 = await w.cron();
  const mid = { ...look(), chips: st1.chips, lease: (q.lease(w) || {}).v };
  w.db.prepare('DELETE FROM kv_blobs WHERE k=?').run(LEASE);
  const st2 = await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  return { fired: h.fired, other, mid, end: { ...look(), chips: st2.chips } };
}
await attempt('N3d', async () => {
  const one1 = [{ actor: 'dev-n3d-000001', delta: 1, ref: `dev-n3d-000001|${D28}|F1`, day: D28 }];
  const a = await n3dRun('chips');
  ok('N3da [第二輪 D2] 租約在寫帳本之前被接手：被接手的那一發一顆都不入（帳本 0 列、這一發入帳 0）、也不登記（0 段、人數全 0）、第③段不動（仍 pending、沒有點數列）；接手那一發的租約原封不動',
    a.fired >= 1 && a.mid.trips.length === 0 && a.mid.chips === 0 && a.mid.contrib === 0 && J(a.mid.users) === J(Z9) && a.mid.v === 'pending' && a.mid.point === null &&
      a.mid.lease === a.other, J(a.mid));
  ok('N3db [第二輪 D2] 接手那一發把這一班判完、恰好記一次：ok、帳本 1 列 1 顆、登記 7 段、人數 S0|S1…S6|S7 各 1',
    a.end.v === 'ok' && J(a.end.trips) === J(one1) && a.end.chips === 1 && a.end.contrib === 7 && J(a.end.users) === J(S7), J(a.end));
  const b = await n3dRun('contrib');
  ok('N3dc [第二輪 D2] 租約在去重登記的 batch 之前被接手（籌碼那一句已寫）：被接手的那一發不登記（0 段、人數全 0）、第③段不動；接手那一發的租約原封不動',
    b.fired === 1 && J(b.mid.trips) === J(one1) && b.mid.contrib === 0 && J(b.mid.users) === J(Z9) && b.mid.v === 'pending' && b.mid.point === null && b.mid.lease === b.other,
    J(b.mid));
  ok('N3dd [第二輪 D2] 接手那一發：登記 7 段、人數各 1（沒有加兩次）、帳本仍 1 列（同一班不再入帳）、ok',
    b.end.v === 'ok' && J(b.end.trips) === J(one1) && b.end.chips === 0 && b.end.contrib === 7 && J(b.end.users) === J(S7), J(b.end));
});

// ═══ D3／MD／D5／B1f：寫入只在「真的標到」時才算數（第二輪獨立驗收）══════════════════════════════
// 同一個根因的四個面：oversize 那一句沒有圍欄（D3）；第③段的點數、sample_count、關認領不看標記那句有沒有真的標到（D3 (b)、D5）；
// 統計在讀完列就先加（B1f）。
const OV721 = Array.from({ length: 721 }, (_, i) => ({ d: i, t: 30000 + i, v: 1, acc: 5 }));   // 721 批、每批 1 點（每人每日上限 720＋1）
await attempt('D3', async () => {
  // 注入點：oversize 那一句執行前，租約換成別人的（這一發慢到超過 20 分鐘、被下一發接手）。
  // 舊版那一句沒有圍欄：被接手的那一發照樣把整班標成 oversize——接手那一發若正在判同一班（D3 (b) 的交錯），它的標記改到 0 列。
  const A = 'dev-d3-ov00001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'OV', pts: OV721, size: 1 });
  const other = J({ token: 'taken-over', until: Date.now() + 10 * 60e3 });
  const h = hookOnce(w.DELAY_DB, /reject_code='oversize'/, async () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
  const st1 = await w.cron();
  const mid = { fired: h.fired, pending: q.count(w, 'bounty_samples', "train_no='OV' AND verdict='pending'"), oversize: st1.oversize, trains: st1.trains, lease: (q.lease(w) || {}).v };
  w.db.prepare('DELETE FROM kv_blobs WHERE k=?').run(LEASE);
  const st2 = await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  const end = { ov: q.count(w, 'bounty_samples', "train_no='OV' AND verdict='suspect' AND reject_code='oversize'"), oversize: st2.oversize, trains: st2.trains };
  ok('D3a [第二輪 D3] oversize 那一句之前租約被接手：被接手的那一發一列都不標（721 列仍 pending）、oversize 0、trains 0；接手那一發的租約原封不動',
    mid.fired === 1 && mid.pending === 721 && mid.oversize === 0 && mid.trains === 0 && mid.lease === other, J(mid));
  ok('D3b [第二輪 D3] 接手那一發：整班 721 列 suspect／oversize、oversize 1、trains 1', end.ov === 721 && end.oversize === 1 && end.trains === 1, J(end));
});
await attempt('MD', async () => {
  // 注入點：第③段的 batch 送出之前，這一組的樣本已被別的寫入者標成 suspect／oversize（D3 (b) 的最後一步；D3 修掉之後這個形狀只剩縱深防禦）。
  // 舊版：標記那句改到 0 列，同一個 batch 的點數、sample_count、關認領只看租約 → 照給（點數 27、7 段各 +1、認領 fulfilled）。
  const A = 'dev-md-000001';
  const w = world({ seed: boardSql('山線') + claimSql({ id: 'claim-md', actor: A, seg: KT('山線', 'S0|S1'), pts: 9 }) });
  putBatches(w.db, { actor: A, trainNo: 'F1', pts: leg({ sec: 700 }) });
  const h = { fired: 0 };
  const ob = w.DELAY_DB.batch.bind(w.DELAY_DB);
  w.DELAY_DB.batch = async stmts => {
    if (!h.fired && stmts.some(x => MARK_RE.test(String(x && x._sql)))) {
      h.fired++;
      w.db.prepare("UPDATE bounty_samples SET verdict='suspect', verdict_at=1, reject_code='oversize', segs='[]' WHERE actor=? AND train_no='F1'").run(A);
    }
    return ob(stmts);
  };
  const st = await w.cron();
  const look = { v: q.verdicts(w, A, 'F1'), rej: q.rejects(w, A, 'F1'), point: q.point(w, A), sc: q.sampleCounts(w, '山線'),
    claim: one(w, "SELECT status FROM bounty_claims WHERE id='claim-md'").status, trains: st.trains, trips: st.trips, ok: st.ok };
  ok('MD [第二輪 D3(b)] 第③段送出之前樣本已被標走：點數列沒有長出來、sample_count 全 0、認領仍 open；樣本維持別人標的 suspect／oversize；判定數 0',
    h.fired === 1 && look.v === 'suspect' && look.rej === 'oversize' && look.point === null && J(look.sc) === J(Z9) && look.claim === 'open' &&
      look.trains === 0 && look.trips === 0 && look.ok === 0, J(look));
});
// D5：判定途中刪帳號（bountyPurgeUid）。注入點一：② 寫帳本那一句之前；注入點二：第③段的 batch 之前。
// 舊版：②、③ 只看租約，不看樣本還在不在、有沒有真的標到——刪完之後這個 uid 又長出點數列（uid 欄 NULL，看起來像匿名裝置）、籌碼、去重登記。
async function d5Run(where) {
  const UID = 'uid-d5-race-0001';
  const w = world({ seed: boardSql('山線') + pointsSql([[UID, UID, 5, null]]) });
  putBatches(w.db, { actor: UID, trainNo: 'P5', pts: leg({ sec: 700 }) });
  const h = { fired: 0, del: null };
  const kill = async () => { h.fired++; h.del = (await delAccount(w, {}, UID)).status; };
  if (where === 'chips') hookOnce(w.DELAY_DB, /^INSERT OR IGNORE INTO chip_ledger/, kill);
  else {
    const ob = w.DELAY_DB.batch.bind(w.DELAY_DB);
    w.DELAY_DB.batch = async stmts => { if (!h.fired && stmts.some(x => MARK_RE.test(String(x && x._sql)))) await kill(); return ob(stmts); };
  }
  await w.cron();
  const users = rows(w, "SELECT distinct_ok_users d FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.d);
  return { h, left: { point: q.point(w, UID), ledger: q.count(w, 'chip_ledger', 'actor=?', UID), contrib: q.contrib(w, UID),
    samples: q.count(w, 'bounty_samples', 'actor=?', UID), sc: q.sampleCounts(w, '山線'), users } };
}
await attempt('D5', async () => {
  const a = await d5Run('chips');
  ok('D5a [第二輪 D5] 刪帳號落在 ② 寫帳本之前：刪完之後這個 uid 沒有再長出任何東西——點數列、帳本、登記、樣本都是 0；看板 sample_count 與人數全 0',
    a.h.fired === 1 && a.h.del === 200 && a.left.point === null && a.left.ledger === 0 && a.left.contrib === 0 && a.left.samples === 0 &&
      J(a.left.sc) === J(Z9) && J(a.left.users) === J(Z9), J(a));
  const b = await d5Run('mark');
  // ② 在刪帳號之前已寫（籌碼、登記、人數 +1）；刪帳號刪掉帳本與登記，看板的人數刻意不回扣（bountyPurgeUid 的說明）。
  ok('D5b [第二輪 D5] 刪帳號落在第③段之前：點數列沒有長回來（舊版會是 uid 欄 NULL 的 21 點）、sample_count 全 0；帳本、登記、樣本 0；人數維持 ② 寫的（刻意不回扣）',
    b.h.fired === 1 && b.h.del === 200 && b.left.point === null && b.left.ledger === 0 && b.left.contrib === 0 && b.left.samples === 0 &&
      J(b.left.sc) === J(Z9) && J(b.left.users) === J(S7), J(b));
});
await attempt('B1f', async () => {
  // 統計只算真的寫進去的班（判定那一行的「幾班／幾線組」）。兩班（固定次序 T1 先）：T1 的第③段 batch 丟例外、T2 照判。
  // 舊版讀完列就先加：trains 2、trips 2、ok 2——出錯那一班也算進「判了」。
  const A = 'dev-b1f-000001', B = 'dev-b1f-000002';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'T1', pts: leg({ sec: 700 }) });
  putBatches(w.db, { actor: B, trainNo: 'T2', pts: leg({ sec: 700 }) });
  const h = { fired: 0 };
  const ob = w.DELAY_DB.batch.bind(w.DELAY_DB);
  w.DELAY_DB.batch = async stmts => {
    if (!h.fired && stmts.some(x => MARK_RE.test(String(x && x._sql)) && String((x._p || [])[5]).includes(`${A}.T1.`))) { h.fired++; throw new Error('D1_ERROR: 模擬的暫時錯誤'); }
    return ob(stmts);
  };
  const st = await w.cron({ BOUNTY_VERIFY_ORDER: 'fixed' });
  ok('B1f [第二輪 B1f] 兩班、T1 的第③段 batch 丟例外：判定數只算 T2——trains 1、trips 1、ok 1、errors 1；T1 仍 pending、T2 ok',
    h.fired === 1 && st.trains === 1 && st.trips === 1 && st.ok === 1 && st.errors === 1 && q.verdicts(w, A, 'T1') === 'pending' && q.verdicts(w, B, 'T2') === 'ok',
    J({ fired: h.fired, st: { trains: st.trains, trips: st.trips, ok: st.ok, errors: st.errors }, v: [q.verdicts(w, A, 'T1'), q.verdicts(w, B, 'T2')] }));
});
// MDL／MDT／PC：突變 v6 存活的三個（D5_marked_legacy、D5_marked_time、D5_pending_count）。
// MDL：MD 的情境換成降級路徑（設定檔缺台鐵的 coverDistinct：sample_count 與收滿同一句）——那一句也要看 MARKED。
// MDT：第③段送出之前，這一組已被標成「同一個判定、不同時間」（verdict＝ok、verdict_at 比這一發的 now 早 1 毫秒）：
//      MARKED 要比 verdict_at，別人標的 ok 不算「這一句剛標上的」。租約之下目前的寫入者做不到這個形狀（只有持租約的那一發標得到），
//      這一條釘住規格的「這一句剛標上」，是縱深防禦。
// PC：寫帳本之前，這一班讀進來的樣本少了一列（其餘仍 pending）：「樣本還在」要比筆數，不是「還有任何一列」。
//     目前的寫入者刪樣本都是整個身分一起刪（bountyPurgeUid），一班車不會只少幾列；這一條釘住規格的「讀進來的全部還是 pending」。
//     這個形狀下標記那句照樣標掉剩下的列、但籌碼與點數都不給（保守的一邊）。
async function fenceRun({ id, rules, before, sql }) {
  const A = `dev-${id}-000001`;
  const w = world({ seed: boardSql('山線') + claimSql({ id: `claim-${id}`, actor: A, seg: KT('山線', 'S0|S1'), pts: 9 }), rules });
  putBatches(w.db, { actor: A, trainNo: 'F1', pts: leg({ sec: 700 }) });
  const n0 = q.count(w, 'bounty_samples', 'actor=?', A);
  const h = { fired: 0, changes: 0 };
  const act = () => { h.fired++; h.changes = Number(w.db.prepare(sql).run(A).changes); };
  if (before === 'chips') hookOnce(w.DELAY_DB, /^INSERT OR IGNORE INTO chip_ledger/, async () => { act(); });
  else {
    const ob = w.DELAY_DB.batch.bind(w.DELAY_DB);
    w.DELAY_DB.batch = async stmts => { if (!h.fired && stmts.some(x => MARK_RE.test(String(x && x._sql)))) act(); return ob(stmts); };
  }
  const st = await w.cron();
  const users = rows(w, "SELECT distinct_ok_users d FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.d);
  const cov = rows(w, "SELECT covered_at IS NOT NULL c FROM bounty_board WHERE seg_key LIKE 'tra_sched|山線|%' ORDER BY seg_key").map(r => r.c);
  return { h, n0, trips: st.trips, v: q.verdicts(w, A, 'F1'), point: q.point(w, A), sc: q.sampleCounts(w, '山線'), cov, users,
    claim: one(w, `SELECT status FROM bounty_claims WHERE id='claim-${id}'`).status, ledger: q.count(w, 'chip_ledger', 'actor=?', A), contrib: q.contrib(w, A) };
}
await attempt('MDL', async () => {
  const r = await fenceRun({ id: 'mdl', before: 'mark', rules: { ...RULES, coverDistinct: { THSR: RULES.coverDistinct.THSR } },
    sql: "UPDATE bounty_samples SET verdict='suspect', verdict_at=1, reject_code='oversize', segs='[]' WHERE actor=? AND train_no='F1'" });
  ok('MDL [第二輪 D3(b)／D5] 降級路徑：第③段送出之前樣本已被標走——sample_count 全 0、沒有收滿、點數列沒有長出來、認領仍 open、判定數 0',
    RULES.coverDistinct.TRA > 0 && r.h.fired === 1 && r.n0 > 1 && r.h.changes === r.n0 && r.v === 'suspect' && J(r.sc) === J(Z9) && J(r.cov) === J(Z9) &&
      r.point === null && r.claim === 'open' && r.trips === 0, J(r));
});
await attempt('MDT', async () => {
  const r = await fenceRun({ id: 'mdt', before: 'mark', sql: `UPDATE bounty_samples SET verdict='ok', verdict_at=${NOW_MS - 1} WHERE actor=? AND train_no='F1'` });
  ok('MDT [第二輪 D5／規格「這一句剛標上」] 第③段送出之前這一組已被標成同一個判定 ok、時間早 1 毫秒：點數列沒有長出來、sample_count 全 0、認領仍 open、判定數 0；' +
    '② 照常（籌碼 1、登記 7 段）',
    r.h.fired === 1 && r.n0 > 1 && r.h.changes === r.n0 && r.v === 'ok' && r.point === null && J(r.sc) === J(Z9) && r.claim === 'open' && r.trips === 0 &&
      r.ledger === 1 && r.contrib === 7, J(r));
});
await attempt('PC', async () => {
  const r = await fenceRun({ id: 'pc', before: 'chips',
    sql: "DELETE FROM bounty_samples WHERE id=(SELECT id FROM bounty_samples WHERE actor=? AND train_no='F1' ORDER BY submitted_at DESC, id DESC LIMIT 1)" });
  ok('PC [第二輪 D5／規格「讀進來的全部還是 pending」] 寫帳本之前這一班讀進來的樣本少了一列（其餘仍 pending）：帳本 0 列、登記 0 段、人數全 0；' +
    '點數列沒有長出來、sample_count 全 0、認領仍 open',
    r.h.fired >= 1 && r.n0 > 1 && r.h.changes === 1 && r.ledger === 0 && r.contrib === 0 && J(r.users) === J(Z9) && r.point === null && J(r.sc) === J(Z9) &&
      r.claim === 'open', J(r));
});

// ═══ N1：可信名額最多先用掉一半預算 ═══════════════════════════════════════════════
// 攻擊（獨立驗收 N1 的形狀）：12 個「可信」匿名身分（帳本各有一筆舊的錄程籌碼——等速的合成錄程就養得出來）各灌 8 班垃圾車，
// 每班在 4 條線各一批（一條線一組，比一般的車貴）；新來的誠實使用者 N 只有 1 班；另有一班出過錯的班車 K（有記錄，排最後）。寫死次序。
// 舊版：可信名額（96 班）全排在 N 前面，預算判不完它們，N 每一發都判不到。現在：可信名額用到剩下預算的一半就讓出來。
// 預算不寫死：先用夠大的預算跑同樣的世界，量出「全部判完」要幾個子請求（all），再用 all 的一半（判不完）與 all 多一點（判得完）各跑一次。
const SYB = Array.from({ length: 12 }, (_, i) => 'dev-n1-syb' + String(i + 1).padStart(2, '0'));
const N1H = 'dev-n1-honest', N1K = 'dev-n1-struck';
function n1World() {
  const w = world({ seed: boardSql('山線') + SYB.map(s => ledgerSql(s, 'trip', 1, `${s}|2026-07-10|O1`, '2026-07-10')).join('') +
    `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(N1K, 'K1')}','{"at":1,"error":"x","n":2}','x');`, env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  bulk(w.db, [...SYB.flatMap(s => Array.from({ length: 8 }, (_, k) => ['屏東線', '南迴線', '山線', '超長線'].map(ln => ({ actor: s, trainNo: 'G' + (k + 1), lnId: ln, pts: TINY }))).flat()),
    { actor: N1H, trainNo: 'N1', pts: leg({ sec: 700 }) }, { actor: N1K, trainNo: 'K1', pts: leg({ sec: 700 }) }]);
  const loads = [];                                          // 判定實際讀班車的次序（每班讀一次）
  spyRows(w.DELAY_DB, (sql, rs) => { if (LOAD_RE.test(sql) && rs.length) loads.push(String(rs[0].actor)); });
  return { w, loads };
}
const sybPending = w => q.count(w, 'bounty_samples', "verdict='pending' AND actor LIKE 'dev-n1-syb%'");
// 讓「讀一班車」那一句對選中的班車慢 ms 毫秒（D1 很慢的那一天）。pick(actor)：哪些班車要慢。
function slowLoads(DELAY_DB, ms, pick) {
  const orig = DELAY_DB.prepare.bind(DELAY_DB);
  DELAY_DB.prepare = sql => {
    const st = orig(sql);
    if (!LOAD_RE.test(sql)) return st;
    const wrapS = (s, p) => new Proxy(s, { get(t, k) {
      if (k === 'bind') return (...a) => wrapS(t.bind(...a), a);
      if (k === 'all') return async (...a) => { if (p && pick(String(p[0]))) await new Promise(r => setTimeout(r, ms)); return t.all(...a); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    } });
    return wrapS(st, null);
  };
}
await attempt('N1', async () => {
  const cal = n1World();
  const st0 = await cal.w.cron({ BOUNTY_SUBREQ_BUDGET: '1000000' });
  const all = st0.subreq;
  ok('N1a0 [前提] 預算夠大：98 班全部判完；份額沒用到時 N 排在 96 班可信名額之後、K 最後——證明可信名額真的排在 N 前面',
    st0.trains === 98 && q.pending(cal.w) === 0 && q.verdicts(cal.w, N1H, 'N1') === 'ok' && st0.headDeferred === 0 &&
      cal.loads.length === 98 && cal.loads.slice(0, 96).every(x => SYB.includes(x)) && cal.loads[96] === N1H && cal.loads[97] === N1K,
    J({ trains: st0.trains, all, deferred: st0.headDeferred, tail: cal.loads.slice(95) }));
  const a = n1World();
  const stA = await a.w.cron({ BOUNTY_SUBREQ_BUDGET: String(Math.floor(all / 2)) });
  ok('N1a [N1] 預算只有全部判完的一半：可信名額用到份額就讓出來，N 這一發判到（ok、1 顆）；預算照樣用完（子請求停手）、垃圾還有留 pending',
    q.verdicts(a.w, N1H, 'N1') === 'ok' && q.bal(a.w, N1H) === 1 && stA.budgetStop === true && stA.stopBy === 'subreq' && sybPending(a.w) > 0 && stA.headDeferred > 0,
    J({ budget: Math.floor(all / 2), n: q.verdicts(a.w, N1H, 'N1'), stopBy: stA.stopBy, pending: sybPending(a.w), deferred: stA.headDeferred, pos: a.loads.indexOf(N1H) }));
  const b = n1World();
  const stB = await b.w.cron({ BOUNTY_SUBREQ_BUDGET: String(all + 10) });
  const pos = b.loads.indexOf(N1H);
  ok('N1b [N1] 預算夠判完全部：同一發 98 班全部判完（讓出來的可信名額排在 N 之後照判，預算沒有浪費）；N 夾在可信名額中間、' +
    '排在它後面的可信名額恰是讓出的班數；出過錯的 K 仍在最後',
    stB.trains === 98 && q.pending(b.w) === 0 && stB.budgetStop === false && b.loads.length === 98 && pos > 0 && pos < 96 && 96 - pos === stB.headDeferred &&
      b.loads.slice(0, pos).every(x => SYB.includes(x)) && b.loads.slice(pos + 1, 97).every(x => SYB.includes(x)) && b.loads[97] === N1K,
    J({ budget: all + 10, trains: stB.trains, pending: q.pending(b.w), pos, deferred: stB.headDeferred, last: b.loads[97] }));
});
await attempt('N1c', async () => {
  // 牆鐘也算份額：可信名額的每一班讀取慢 30 ms、牆鐘預算 1.5 秒、子請求不設限。只看子請求的話，96 班 × 30 ms 就超過 1.5 秒，N 判不到。
  const { w, loads } = n1World();
  slowLoads(w.DELAY_DB, 30, actor => SYB.includes(actor));
  const st = await w.cron({ BOUNTY_SUBREQ_BUDGET: '1000000', BOUNTY_WALL_BUDGET_MS: '1500' });
  ok('N1c [N1] 牆鐘 1.5 秒、可信名額每班慢 30 ms：用到一半牆鐘就讓出來，N 判到（ok）；之後牆鐘停手、垃圾還有留 pending',
    q.verdicts(w, N1H, 'N1') === 'ok' && st.budgetStop === true && st.stopBy === 'wall' && sybPending(w) > 0 && st.headDeferred > 0,
    J({ n: q.verdicts(w, N1H, 'N1'), stopBy: st.stopBy, pending: sybPending(w), deferred: st.headDeferred, pos: loads.indexOf(N1H), ms: st.elapsedMs }));
});

// ═══ N1d：清單上限不能讓可信名額佔滿（第三輪獨立驗收 N1b）═══════════════════════════════════
// 舊版清單依「head 最先」排好才截到 4000 班：約 500 個畢業分身各灌 8 班（head 恰 4000 班），新身分連清單都進不去，判定迴圈裡的份額完全不起作用。
// 現在：截斷時 head 依輪次只保證前 2000 班（上限×份額），其餘位置先給一般班車；一般班車不夠填，head 照樣補滿。
const syb = (tag, n) => Array.from({ length: n }, (_, i) => `dev-${tag}-s` + String(i).padStart(3, '0'));
const gradSql = list => list.map(s => ledgerSql(s, 'trip', 1, `${s}|2026-07-10|O1`, '2026-07-10')).join('');
const listRows = w => {
  const seen = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LIST_RE.test(sql)) seen.push(rs.map(r => ({ actor: String(r.actor), train: String(r.train_no), head: Number(r.head) }))); });
  return seen;
};
await attempt('N1d', async () => {
  const SY = syb('n1d', 500), NEW = Array.from({ length: 5 }, (_, i) => 'dev-n1d-new0' + i);
  const w = world({ seed: boardSql('山線') + gradSql(SY), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  bulk(w.db, [...SY.flatMap(s => Array.from({ length: 8 }, (_, k) => ({ actor: s, trainNo: 'G' + (k + 1), pts: TINY }))),
    ...NEW.map(a => ({ actor: a, trainNo: 'N1', pts: leg({ sec: 700 }) }))]);
  const seen = listRows(w);
  const st = await w.cron({ BOUNTY_SUBREQ_BUDGET: '300' });
  const L = seen[0] || [];
  const nHead = L.filter(r => r.head).length, newIn = NEW.filter(a => L.some(r => r.actor === a)).length;
  const judged = NEW.filter(a => q.verdicts(w, a, 'N1') === 'ok').length;
  ok('N1da [第三輪 N1b] 500 個畢業分身各 8 班（可信名額恰 4000 班＝清單上限）＋5 個新身分：清單截到 4000 班（truncated）＝可信名額 3995＋新身分 5；' +
    '這一發 5/5 判到（ok）、分身還有留 pending',
    st.truncated === true && L.length === 4000 && nHead === 3995 && newIn === 5 && judged === 5 &&
      q.count(w, 'bounty_samples', "verdict='pending' AND actor LIKE 'dev-n1d-s%'") > 0,
    J({ truncated: st.truncated, list: L.length, nHead, newIn, judged, headDeferred: st.headDeferred, subreq: st.subreq }));
  // 一般班車夠多時 head 只保證一半：300 個分身各 8 班（2400）＋3000 個匿名身分各 1 班 → 清單 2000＋2000；
  // head 依輪次截（每個分身至少前 6 班都在），不是依 actor 次序截（那樣會是前 250 個分身各 8 班、後 50 個 0 班）。預算 1：一班都不判，只看清單。
  const SY2 = syb('n1e', 300);
  const w2 = world({ seed: gradSql(SY2), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  bulk(w2.db, [...SY2.flatMap(s => Array.from({ length: 8 }, (_, k) => ({ actor: s, trainNo: 'G' + (k + 1), pts: TINY }))),
    ...Array.from({ length: 3000 }, (_, i) => ({ actor: 'dev-n1d-a' + String(i).padStart(4, '0'), trainNo: 'A1', pts: TINY }))]);
  const seen2 = listRows(w2);
  const st2 = await w2.cron({ BOUNTY_SUBREQ_BUDGET: '1' });
  const L2 = seen2[0] || [];
  const per = SY2.map(s => L2.filter(r => r.actor === s).length);
  ok('N1db [第三輪 N1b] 一般班車夠多時：清單＝可信名額 2000＋一般 2000（truncated）；每個分身至少前 6 班都在（依輪次截）',
    st2.truncated === true && L2.length === 4000 && L2.filter(r => r.head).length === 2000 && L2.filter(r => !r.head).length === 2000 && Math.min(...per) >= 6,
    J({ truncated: st2.truncated, list: L2.length, head: L2.filter(r => r.head).length, minPer: Math.min(...per), maxPer: Math.max(...per) }));
});

// ═══ N1e：讓出的可信名額與一般班車按輪次交錯（第三輪獨立驗收 B(5)）═══════════════════════════
// 20 個畢業分身各 8 班（TINY）、誠實帳號 U 8 班（ok 車）都是可信名額；匿名灌水者 F 12 班（一般，第 1…12 輪）；新身分 N 1 班。
// 預算＝全部判完所需＋10：同一發全部判完，整條次序看得到。期望次序依規格自己算（不讀實作）：
//   份額內的 head（清單次序的前 k 班，k＝head 總數－headDeferred）→ 其餘依輪次合併，同一輪一般班車先 → 出錯過的（本世界沒有）。
// 舊版：讓出的 head 整批排在 F 的 12 班之後——U 被讓出的班次排在 F 的第 6…12 班後面。
await attempt('N1e', async () => {
  const SY = syb('n1f', 20), U = 'uid-n1e-0000U', F = 'dev-n1e-flood', N = 'dev-n1e-new01';
  const mk = () => {
    const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) + gradSql(SY), env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
    bulk(w.db, [...SY.flatMap(s => Array.from({ length: 8 }, (_, k) => ({ actor: s, trainNo: 'G' + (k + 1), pts: TINY }))),
      ...Array.from({ length: 8 }, (_, k) => ({ actor: U, trainNo: 'U' + (k + 1), pts: leg({ sec: 700 }) })),
      ...Array.from({ length: 12 }, (_, k) => ({ actor: F, trainNo: 'F' + String(k + 1).padStart(2, '0'), pts: TINY })),
      { actor: N, trainNo: 'N1', pts: leg({ sec: 700 }) }]);
    const loads = [];
    spyRows(w.DELAY_DB, (sql, rs) => { if (LOAD_RE.test(sql) && rs.length) loads.push(`${rs[0].actor}|${rs[0].train_no}`); });
    return { w, loads };
  };
  const cal = mk();
  const all = (await cal.w.cron({ BOUNTY_SUBREQ_BUDGET: '1000000' })).subreq;
  const { w, loads } = mk();
  const st = await w.cron({ BOUNTY_SUBREQ_BUDGET: String(all + 10) });
  const T = [];
  for (const s of SY) for (let k = 1; k <= 8; k++) T.push({ a: s, t: 'G' + k, rnd: k, head: 1 });
  for (let k = 1; k <= 8; k++) T.push({ a: U, t: 'U' + k, rnd: k, head: 1 });
  for (let k = 1; k <= 12; k++) T.push({ a: F, t: 'F' + String(k).padStart(2, '0'), rnd: k, head: 0 });
  T.push({ a: N, t: 'N1', rnd: 1, head: 0 });
  const byTie = (x, y) => x.rnd - y.rnd || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0);   // fixed：輪次、乘車日（同一天）、actor、車次
  const head = T.filter(x => x.head).sort(byTie), rest = T.filter(x => !x.head).sort(byTie);
  const k = head.length - st.headDeferred;
  const merged = [];
  for (let r = 1; r <= 12; r++) merged.push(...rest.filter(x => x.rnd === r), ...head.slice(k).filter(x => x.rnd === r));
  const expect = [...head.slice(0, k), ...merged].map(x => `${x.a}|${x.t}`);
  ok('N1ea [第三輪 B(5)] 同一發全部判完（181 班、pending 0）、有讓出（headDeferred＞0）；實際判定次序逐班等於「份額內 head → 依輪次合併（同一輪一般班車先）」',
    st.headDeferred > 0 && q.pending(w) === 0 && loads.length === 181 && J(loads) === J(expect),
    J({ deferred: st.headDeferred, pending: q.pending(w), n: loads.length, firstDiff: loads.findIndex((x, i) => x !== expect[i]), got: loads.slice(k, k + 8), want: expect.slice(k, k + 8) }));
  const dU = head.slice(k).filter(x => x.a === U);
  const at = key => loads.indexOf(key);
  const good = dU.length > 0 && dU.every(x => T.filter(y => y.a === F).every(y => (y.rnd <= x.rnd) === (at(`${F}|${y.t}`) < at(`${U}|${x.t}`))));
  ok('N1eb [第三輪 B(5)] 誠實帳號被讓出的每一班（第 r 輪）：灌水者第 r 輪以內的班在它前面、第 r＋1 輪起的在它後面（舊版灌水者 12 班全在前面）',
    good, J({ deferredU: dU.map(x => x.t), pos: dU.map(x => at(`${U}|${x.t}`)), flood: T.filter(y => y.a === F).map(y => at(`${F}|${y.t}`)) }));
});

// ═══ N1f：讀取量預算（第二輪獨立驗收 CPU）═════════════════════════════════════════════
// 判定的 CPU 與讀進來的 payload 量成正比，子請求與牆鐘都量不到。6 個畢業分身各 8 班大車（可信名額）＋新身分 N 1 班；
// 讀取量預算＝分身全部 payload 的一半、子請求與牆鐘不設限。期望：可信名額先用掉一半（預算的一半）就讓出、N 判到；
// 之後讀取量用完停手（stopBy bytes），垃圾還有留 pending。stat.bytes＝已判定列的 payload 總長（測試端自己用 SQL 算）。
await attempt('N1f', async () => {
  const SY = syb('n1g', 6), N = 'dev-n1f-new01';
  const mk = (env, size) => {
    const w = world({ seed: boardSql('山線') + gradSql(SY), env: { BOUNTY_VERIFY_ORDER: 'fixed', BOUNTY_SUBREQ_BUDGET: '1000000', BOUNTY_WALL_BUDGET_MS: '3600000', ...env } });
    bulk(w.db, [...SY.flatMap(s => Array.from({ length: 8 }, (_, k) => ({ actor: s, trainNo: 'G' + (k + 1), pts: leg({ sec: 1500, t0: 30000 + k * 2000 }), size }))),
      { actor: N, trainNo: 'N1', pts: leg({ sec: 700 }), size }]);
    return w;
  };
  const probe = mk({});
  const headBytes = one(probe, "SELECT SUM(length(payload)) b FROM bounty_samples WHERE actor LIKE 'dev-n1g-%'").b;
  // 讀取量＝payload 位元組＋列數 × 每列折算（第四輪獨立驗收 C(4)；折算值取實作導出的常數，這一條驗的是記帳與停手邊界，折算的大小由 N1fe 另外釘）
  const K = _bounty.BOUNTY_BYTES_PER_ROW;
  const maxTrain = one(probe, "SELECT MAX(b) b FROM (SELECT SUM(length(payload)) b FROM bounty_samples GROUP BY actor, train_no)").b;
  const maxCost = one(probe, `SELECT MAX(c) c FROM (SELECT SUM(length(payload)) + COUNT(*) * ${K} c FROM bounty_samples GROUP BY actor, train_no)`).c;
  const budget = Math.floor(headBytes / 2);
  const w = mk({ BOUNTY_BYTES_BUDGET: String(budget) });
  const st = await w.cron();
  const judged = one(w, "SELECT COALESCE(SUM(length(payload)), 0) b, COUNT(*) n FROM bounty_samples WHERE verdict <> 'pending'");
  const cost = st.bytes + st.rows * K;
  ok('N1fa [第二輪 CPU] 讀取量預算＝分身 payload 的一半：新身分 N 判到（ok）；讀取量用完停手（budgetStop、stopBy bytes）、分身還有留 pending、有讓出',
    q.verdicts(w, N, 'N1') === 'ok' && st.budgetStop === true && st.stopBy === 'bytes' && q.count(w, 'bounty_samples', "verdict='pending' AND actor LIKE 'dev-n1g-%'") > 0 && st.headDeferred > 0,
    J({ n: q.verdicts(w, N, 'N1'), stopBy: st.stopBy, budgetStop: st.budgetStop, deferred: st.headDeferred, budget, bytes: st.bytes, rows: st.rows }));
  ok('N1fb [第二輪 CPU／第四輪 C(4)] stat.bytes＝已判定列的 payload 總長、stat.rows＝已判定列數（測試端 SQL）；讀取量（位元組＋列數×每列折算）停在「超過預算之後的第一個班車邊界」：' +
    '≥ 預算、扣掉一班最大的車就不到預算',
    K > 0 && st.bytes === judged.b && st.rows === judged.n && judged.b > 0 && cost >= budget && cost - maxCost < budget,
    J({ bytes: st.bytes, rows: st.rows, judged, K, cost, budget, maxCost }));
  // 這一條的世界每列 20 點（其餘 200 點）：列數夠多，「位元組」與「位元組＋列數×折算」印出來的一位小數才分得開（差 ≥ 0.1 MB）。
  // 舊世界 188 列 × 384 ≈ 0.07 MB，兩者都印 1.8——把 MB 換成讀取量照樣綠（第八批 突變 log_mb_is_cost 存活）。
  const headF = one(mk({}, 20), "SELECT SUM(length(payload)) b FROM bounty_samples WHERE actor LIKE 'dev-n1g-%'").b;
  const wf = mk({ BOUNTY_BYTES_BUDGET: String(Math.floor(headF / 2)) }, 20);
  const f = await fire(wf);
  const line = f.logs.concat(f.errs).find(s => SUMMARY_RE.test(s)) || '';
  const mb = line.match(/讀取 ([\d.]+) MB（(\d+) 列）/);
  // 括號裡的列數＝這一發判到的列數、MB＝那些列的 payload（測試端 SQL；第五輪獨立驗收：舊判準只要求列數 > 0，印成班數照樣綠）。
  const jf = one(wf, "SELECT COALESCE(SUM(length(payload)), 0) b, COUNT(*) n, COUNT(DISTINCT actor || '|' || train_no) t FROM bounty_samples WHERE verdict <> 'pending'");
  ok('N1fc [第二輪 CPU／第五輪] 判定那一行寫「讀取量預算用盡」與讀取量：MB＝已判定列的 payload（一位小數）、括號裡＝已判定的列數（不是班數）',
    line.includes('讀取量預算用盡') && !!mb && mb[1] === (jf.b / 1048576).toFixed(1) && mb[1] !== ((jf.b + jf.n * K) / 1048576).toFixed(1) &&
      Number(mb[2]) === jf.n && jf.n !== jf.t && jf.n > 0,
    J({ line: line.slice(0, 260), sql: jf, costMb: ((jf.b + jf.n * K) / 1048576).toFixed(1) }));
  const w0 = mk({});
  const st0 = await w0.cron();
  ok('N1fd [第二輪 CPU 對照] 預設讀取量預算（128 MB）：同一個世界全部判完、沒有停手、沒有讓出', q.pending(w0) === 0 && st0.budgetStop === false && st0.stopBy === null && st0.headDeferred === 0,
    J({ pending: q.pending(w0), stopBy: st0.stopBy, deferred: st0.headDeferred, bytes: st0.bytes }));
});

// N1fe：讀取量把列數也算進去（第四輪獨立驗收 C(4)）。30 個新身分各 1 班、每班 720 列、每列 1 點（上傳端點每人每乘車日 720 批的上限）：
// 30 班的 payload 全部加起來還不到預算——只數位元組的話一班都不會因讀取量停手（舊版就是這樣：判到子請求用完，CPU 跟列數走）。
// 期望：讀取量用完就停（stopBy bytes）；判到的班數不超過「每列至少折 256 位元組」時的上限。256 是本機實測（每列 300–400 位元組等價）的保守下緣，
// 不讀實作的常數——折算被拿掉或調低到量不到列的成本，這一條就紅。
await attempt('N1fe', async () => {
  const R = Array.from({ length: 30 }, (_, i) => 'dev-n1fe-r' + String(i).padStart(3, '0'));
  const ONE = Array.from({ length: 720 }, () => TINY[0]);
  const BB = 2 * 1024 * 1024;
  const w = world({ seed: boardSql('山線'), env: { BOUNTY_VERIFY_ORDER: 'fixed', BOUNTY_SUBREQ_BUDGET: '1000000', BOUNTY_WALL_BUDGET_MS: '3600000', BOUNTY_BYTES_BUDGET: String(BB) } });
  bulk(w.db, R.map(a => ({ actor: a, trainNo: 'R1', pts: ONE, size: 1 })));
  const loads = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LOAD_RE.test(sql)) loads.push(rs.length); });
  const per = one(w, "SELECT MAX(b) b, MIN(b) b0, MAX(n) n FROM (SELECT SUM(length(payload)) b, COUNT(*) n FROM bounty_samples GROUP BY actor, train_no)");
  const total = one(w, 'SELECT SUM(length(payload)) b FROM bounty_samples').b;
  const st = await w.cron();
  const cap = Math.ceil(BB / (per.b + per.n * 256));
  ok('N1fe [第四輪 C(4)] 每班 720 列、每列 1 點：30 班的 payload 合計不到預算（只數位元組不會停），讀取量照樣用完就停（stopBy bytes）；' +
    `判到的班數 ≤ 每列折 256 位元組時的上限；stat.rows＝讀進來的列數`,
    per.n === 720 && total < BB && st.budgetStop === true && st.stopBy === 'bytes' && loads.length > 0 && loads.length <= cap && loads.length < 30 &&
      st.rows === loads.reduce((a, n) => a + n, 0) && st.bytes <= per.b * loads.length,
    J({ perTrain: per, total, budget: BB, trains: loads.length, cap, rows: st.rows, bytes: st.bytes, stopBy: st.stopBy }));
});

// ═══ N1g：份額的比例（第四輪獨立驗收 E 的缺口）════════════════════════════════════════════
// N1a–N1c、N1f 只驗「份額用到就讓出、新身分判得到」，把份額從一半改成六成照樣全綠（突變 share_subreq_60／share_wall_60／share_bytes_60）；
// N1ea 的期望次序又拿實作自己回報的 headDeferred 切（同源）。這裡三種預算各一個世界，讓出點照規格自己算：
// 可信名額的第 i 班，只在「份額起點之後已用掉的量 < 份額起點剩下的預算 × 一半」時才先判。已用掉的量由測試端自己量——
// 子請求：countCalls（測試端自己數，定義同 bountyCounted：DELAY_DB 的 first／run／all／raw、batch、exec，ASSETS 的 fetch）；
// 牆鐘：測試端的假時鐘（清單那一句之前撥快 PRE、每讀一班撥快 STEP）；讀取量：SQL 量每班的 payload 與列數。
// 世界：可信帳號 U 8 班（都是 head）＋3 個新身分各 1 班（一般、第 1 輪）；寫死次序。讓出之後同一輪一般班車先，所以「U 連續判了幾班才輪到別人」就是讓出點。
const N1G_U = 'dev-n1s-trust01', N1G_A = ['dev-n1s-anon01', 'dev-n1s-anon02', 'dev-n1s-anon03'];
// rows720：每班改成 720 列、每列 1 點（N1gd：份額也要把列數算進去）。
function n1gWorld(env, rows720 = false) {
  const w = world({ seed: boardSql('山線') + gradSql([N1G_U]),
    env: { BOUNTY_VERIFY_ORDER: 'fixed', BOUNTY_SUBREQ_BUDGET: '1000000', BOUNTY_WALL_BUDGET_MS: '3600000', ...env } });
  const shape = rows720 ? { pts: Array.from({ length: 720 }, () => TINY[0]), size: 1 } : { pts: leg({ sec: 700 }) };
  bulk(w.db, [...Array.from({ length: 8 }, (_, k) => ({ actor: N1G_U, trainNo: 'U' + (k + 1), ...shape })),
    ...N1G_A.map(a => ({ actor: a, trainNo: 'A1', ...shape }))]);
  const loads = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LOAD_RE.test(sql) && rs.length) loads.push(String(rs[0].actor)); });
  return { w, loads };
}
// 期望的讀取次序：U 先判 k 班 → 3 個新身分 → U 其餘；總共判 m 班（m 由各自的停手規則算）。
const n1gExpect = (k, m) => [...Array(k).fill(N1G_U), ...N1G_A, ...Array(8 - k).fill(N1G_U)].slice(0, m);
function countCalls(w) {
  const log = { n: 0, loads: [] };
  let inBatch = 0;                                           // batch 裡面每一句的 run() 不另外算（一次 batch＝一個子請求）
  const op = w.DELAY_DB.prepare.bind(w.DELAY_DB), ob = w.DELAY_DB.batch.bind(w.DELAY_DB), af = w.env.ASSETS.fetch;
  const wrapS = (st, sql) => new Proxy(st, { get(t, k) {
    if (k === 'bind') return (...a) => wrapS(t.bind(...a), sql);
    if (k === 'first' || k === 'run' || k === 'all' || k === 'raw') return (...a) => {
      if (!inBatch) { if (LOAD_RE.test(sql)) log.loads.push(log.n); log.n++; }
      return t[k](...a);
    };
    const v = t[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  w.DELAY_DB.prepare = sql => wrapS(op(sql), sql);
  w.DELAY_DB.batch = async stmts => { log.n++; inBatch++; try { return await ob(stmts); } finally { inBatch--; } };
  w.env.ASSETS.fetch = (...a) => { log.n++; return af(...a); };
  return log;
}
// 在符合的句子每一次執行前呼叫 fn（同步）：假時鐘撥快用。
function beforeEach(DELAY_DB, re, fn) {
  const op = DELAY_DB.prepare.bind(DELAY_DB);
  DELAY_DB.prepare = sql => {
    const st = op(sql);
    if (!re.test(sql)) return st;
    const wrapS = s => new Proxy(s, { get(t, k) {
      if (k === 'bind') return (...a) => wrapS(t.bind(...a));
      if (k === 'all' || k === 'first' || k === 'run') return async (...a) => { fn(); return t[k](...a); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    } });
    return wrapS(st);
  };
}
await attempt('N1g', async () => {
  // 子請求：先用不設限的預算量出份額起點 n0 與一班的量 c，再把預算設成 n0＋8c（份額＝4c：一半在第 4 班之後讓出，六成要到第 5 班之後）。
  const cal = n1gWorld({});
  const cc = countCalls(cal.w);
  await cal.w.cron();
  const B = cc.loads[0] + 8 * (cc.loads[1] - cc.loads[0]);
  const a = n1gWorld({ BOUNTY_SUBREQ_BUDGET: String(B) });
  const ac = countCalls(a.w);
  const sta = await a.w.cron();
  const n0 = ac.loads[0];
  let k = 0;
  while (k < ac.loads.length && ac.loads[k] - n0 < (B - n0) * 0.5) k++;
  // 停手點（第五輪獨立驗收：「≥ 預算就停」缺一個恰好相等的格）：每班一樣貴（c），第 m 班開始前已用 n0＋m×c；恰好等於預算那一格就要停。
  const c = cc.loads[1] - cc.loads[0], even = cc.loads.slice(1).every((x, i) => x - cc.loads[i] === c);
  let m = 0;
  while (n0 + m * c < B) m++;
  ok('N1ga [第四輪 E 缺口／第五輪] 子請求份額恰是剩下的一半：U 連續判的班數＝測試端自己數的「份額起點之後已用 < (預算－起點)×0.5」的班數；之後 3 個新身分、再來 U 其餘；' +
    '已用恰好等於預算的那個班車邊界就停（判 8 班）',
    cc.loads.length === 11 && even && k >= 2 && k < 8 && m === 8 && a.loads.length === m && J(a.loads) === J(n1gExpect(k, m)) && sta.stopBy === 'subreq',
    J({ B, n0, c, even, k, m, loads: a.loads.map(x => x === N1G_U ? 'U' : 'A'), stopBy: sta.stopBy }));
  // N1ga2 下緣（第五輪獨立驗收：0.5 放在班車邊界正上方，只釘住上緣——0.4、0.45 都綠）：預算 n0＋13c，份額 6.5c 落在兩個班車邊界中間。
  // 份額比例 s 下 U 先判的班數 kOf(s)＝校準那一發（預算不設限、U 的 8 班全在前面）裡「份額起點之後已用 < 13c×s」的 U 班數；
  // 0.45 → 6、0.5 → 7、0.55 → 8，三個比例各給不同的次序。11 班 11c 用不完 13c：全部判完、不停手。
  {
    const c0 = cc.loads[0], B2 = c0 + 13 * c;
    const kOf = s => cc.loads.slice(0, 8).filter(x => x - c0 < (B2 - c0) * s).length;
    const a2 = n1gWorld({ BOUNTY_SUBREQ_BUDGET: String(B2) });
    const st2 = await a2.w.cron();
    ok('N1ga2 [第五輪] 子請求份額的下緣：預算 n0＋13c（份額 6.5c）——U 先判 7 班（比例 0.45 會是 6、0.55 會是 8），之後 3 個新身分、U 最後 1 班；11 班判完、沒有停手',
      even && kOf(0.45) === 6 && kOf(0.5) === 7 && kOf(0.55) === 8 && J(a2.loads) === J(n1gExpect(7, 11)) && st2.stopBy === null,
      J({ B2, k: [kOf(0.45), kOf(0.5), kOf(0.55)], loads: a2.loads.map(x => x === N1G_U ? 'U' : 'A'), stopBy: st2.stopBy }));
  }
  // 牆鐘：假時鐘。WALL 600 秒、每讀一班 100 秒；PRE＝清單之前已花掉的時間（份額是「剩下的一半」，不是「總量的一半」）。
  const WALL = 600000, STEP = 100000;
  for (const PRE of [0, 200000]) {
    const x = n1gWorld({ BOUNTY_WALL_BUDGET_MS: String(WALL) });
    const real = Date.now;
    let fake = real.call(Date);
    beforeEach(x.w.DELAY_DB, LIST_RE, () => { fake += PRE; });
    beforeEach(x.w.DELAY_DB, LOAD_RE, () => { fake += STEP; });
    Date.now = () => fake;
    let stx;
    try { stx = await x.w.cron(); } finally { Date.now = real; }
    let kk = 0;
    while (kk * STEP < (WALL - PRE) * 0.5) kk++;
    let mm = 0;
    while (PRE + mm * STEP < WALL) mm++;
    ok(`N1gb${PRE ? 2 : 1} [第四輪 E 缺口] 牆鐘份額恰是剩下的一半（清單之前已花 ${PRE / 1000} 秒、每班 ${STEP / 1000} 秒、牆鐘 ${WALL / 1000} 秒）：U 先判 ${kk} 班、之後新身分；共 ${mm} 班、牆鐘停手`,
      J(x.loads) === J(n1gExpect(kk, mm)) && stx.stopBy === 'wall',
      J({ PRE, kk, mm, loads: x.loads.map(y => y === N1G_U ? 'U' : 'A'), stopBy: stx.stopBy }));
  }
  // 假時鐘跑一發：wall＝牆鐘預算覆寫值、step＝每讀一班撥快幾毫秒（清單之前不撥）。
  const wallRun = async (wall, step) => {
    const x = n1gWorld({ BOUNTY_WALL_BUDGET_MS: String(wall) });
    const real = Date.now;
    let fake = real.call(Date);
    beforeEach(x.w.DELAY_DB, LOAD_RE, () => { fake += step; });
    Date.now = () => fake;
    try { return { loads: x.loads, st: await x.w.cron() }; } finally { Date.now = real; }
  };
  // N1gb3 下緣（第五輪獨立驗收，同 N1ga2）：牆鐘 520 秒、每班 40 秒——份額 260 秒落在兩個班車邊界中間（比例 0.45 → 6 班、0.5 → 7、0.55 → 8）。
  // 11 班 440 秒用不完 520 秒：全部判完、不停手。
  {
    const WALL3 = 520000, STEP3 = 40000;
    const kOf = s => { let k = 0; while (k * STEP3 < WALL3 * s) k++; return k; };
    const r3 = await wallRun(WALL3, STEP3);
    ok('N1gb3 [第五輪] 牆鐘份額的下緣：牆鐘 520 秒、每班 40 秒（份額 260 秒）——U 先判 7 班（0.45 會是 6、0.55 會是 8），之後新身分、U 最後 1 班；11 班判完、沒有停手',
      kOf(0.45) === 6 && kOf(0.5) === 7 && kOf(0.55) === 8 && J(r3.loads) === J(n1gExpect(7, 11)) && r3.st.stopBy === null,
      J({ k: [kOf(0.45), kOf(0.5), kOf(0.55)], loads: r3.loads.map(y => y === N1G_U ? 'U' : 'A'), stopBy: r3.st.stopBy }));
  }
  // N1gb4 牆鐘覆寫值的上限（第五輪獨立驗收）：覆寫成 1 小時也只算「租約 20 分鐘－5 分鐘」＝900 秒（規格寫死在這裡，不讀實作的常數）。
  // 每班 100 秒：份額 450 秒 → U 先判 5 班；第 9 班讀完正好 900 秒 → 停在牆鐘。沒有上限的話 11 班 1,100 秒都判得完、U 的 8 班全在前面。
  {
    const r4 = await wallRun(3600000, 100000);
    ok('N1gb4 [第五輪] 牆鐘預算覆寫成 1 小時也只用 900 秒（租約 20 分鐘－5 分鐘）：每班 100 秒——U 先判 5 班、之後新身分、U 1 班；9 班之後牆鐘停手',
      J(r4.loads) === J(n1gExpect(5, 9)) && r4.st.stopBy === 'wall' && r4.st.budgetStop === true,
      J({ loads: r4.loads.map(y => y === N1G_U ? 'U' : 'A'), stopBy: r4.st.stopBy }));
  }
  // 讀取量：每班一樣大（C＝payload＋列數×每列折算）；預算 5.5C（份額 2.75C：一半判 3 班讓出，六成要判 4 班）。
  const y0 = n1gWorld({});
  const K = _bounty.BOUNTY_BYTES_PER_ROW;
  const per = one(y0.w, `SELECT MIN(c) lo, MAX(c) hi FROM (SELECT SUM(length(payload)) + COUNT(*) * ${K} c FROM bounty_samples GROUP BY actor, train_no)`);
  const BB = Math.floor(5.5 * per.hi);
  const y = n1gWorld({ BOUNTY_BYTES_BUDGET: String(BB) });
  const sty = await y.w.cron();
  let kb = 0;
  while (kb * per.hi < BB * 0.5) kb++;
  let mb = 0;
  while (mb * per.hi < BB) mb++;
  ok('N1gc [第四輪 E 缺口] 讀取量份額恰是剩下的一半：每班一樣大、預算 5.5 班，U 先判 3 班、之後新身分；共 6 班、讀取量停手',
    per.lo === per.hi && kb === 3 && mb === 6 && J(y.loads) === J(n1gExpect(kb, mb)) && sty.stopBy === 'bytes',
    J({ per, BB, kb, mb, loads: y.loads.map(z => z === N1G_U ? 'U' : 'A'), stopBy: sty.stopBy }));
  // N1gc2 下緣（第五輪獨立驗收，同 N1ga2）：預算 13 班（份額 6.5 班，比例 0.45 → 6、0.5 → 7、0.55 → 8）；11 班用不完：全部判完、不停手。
  {
    const kOf = s => { let k = 0; while (k * per.hi < 13 * per.hi * s) k++; return k; };
    const y2 = n1gWorld({ BOUNTY_BYTES_BUDGET: String(13 * per.hi) });
    const st2 = await y2.w.cron();
    ok('N1gc2 [第五輪] 讀取量份額的下緣：預算 13 班（份額 6.5 班）——U 先判 7 班（0.45 會是 6、0.55 會是 8），之後新身分、U 最後 1 班；11 班判完、沒有停手',
      kOf(0.45) === 6 && kOf(0.5) === 7 && kOf(0.55) === 8 && J(y2.loads) === J(n1gExpect(7, 11)) && st2.stopBy === null,
      J({ k: [kOf(0.45), kOf(0.5), kOf(0.55)], loads: y2.loads.map(z => z === N1G_U ? 'U' : 'A'), stopBy: st2.stopBy }));
  }
  // N1gc3 停手點恰好等於預算（第五輪獨立驗收：「≥ 預算就停」缺一個恰好相等的格）：預算恰是 4 班（份額 2 班）→ U、U、新身分、新身分，
  // 第 4 班讀完讀取量＝預算，就停在那裡（「>」會再判第 5 班）。
  {
    const y3 = n1gWorld({ BOUNTY_BYTES_BUDGET: String(4 * per.hi) });
    const st3 = await y3.w.cron();
    ok('N1gc3 [第五輪] 讀取量恰好等於預算就停：預算恰是 4 班——U、U、新身分、新身分，第 4 班之後停手（stopBy bytes）；stat 的讀取量＝4 班',
      J(y3.loads) === J(n1gExpect(2, 4)) && st3.stopBy === 'bytes' && st3.bytes + st3.rows * K === 4 * per.hi,
      J({ loads: y3.loads.map(z => z === N1G_U ? 'U' : 'A'), stopBy: st3.stopBy, cost: st3.bytes + st3.rows * K, want: 4 * per.hi }));
  }
  // 同一個規則換成每班 720 列、每列 1 點：payload 只佔這一班讀取量的一成不到，份額若只看位元組，U 的 8 班會全部先判完。
  const r0 = n1gWorld({}, true);
  const pr = one(r0.w, `SELECT MIN(c) lo, MAX(c) hi, MAX(b) b FROM (SELECT SUM(length(payload)) + COUNT(*) * ${K} c, SUM(length(payload)) b FROM bounty_samples GROUP BY actor, train_no)`);
  const BR = Math.floor(5.5 * pr.hi);
  const r = n1gWorld({ BOUNTY_BYTES_BUDGET: String(BR) }, true);
  const str = await r.w.cron();
  ok('N1gd [第四輪 C(4)] 份額也把列數算進去：每班 720 列、每列 1 點（payload 不到讀取量的一成），預算 5.5 班——U 仍只先判 3 班、之後新身分；共 6 班、讀取量停手',
    pr.lo === pr.hi && pr.b * 10 < pr.hi && J(r.loads) === J(n1gExpect(3, 6)) && str.stopBy === 'bytes',
    J({ pr, BR, loads: r.loads.map(z => z === N1G_U ? 'U' : 'A'), stopBy: str.stopBy }));
});

// ═══ N1h：清單截斷時，出錯過（錯滿 2 次）的班車最先被截（第四輪獨立驗收 E 的缺口）════════════════════════
// N1d 的世界裡沒有出錯過的班車，把「struck」挪到截斷的排序鍵後面（突變 trunc_struck_kept）照樣全綠。
// 500 個畢業分身各 8 班（head 4000）＋5 個新身分＋5 班錯滿 2 次的一般班車：共 4010 班、截到 4000——
// 期望：出錯過的 5 班一班都不在清單裡；head 3995、新身分 5。（出錯過的班車本來就排最後，截斷先截它們。）
await attempt('N1h', async () => {
  const SY = syb('n1h', 500), NEW = Array.from({ length: 5 }, (_, i) => 'dev-n1h-new0' + i), KS = Array.from({ length: 5 }, (_, i) => 'dev-n1h-bad0' + i);
  const w = world({ seed: boardSql('山線') + gradSql(SY) +
    KS.map(a => `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(a, 'K1')}','{"at":1,"error":"x","n":2}','x');`).join(''),
    env: { BOUNTY_VERIFY_ORDER: 'fixed', BOUNTY_SUBREQ_BUDGET: '60' } });
  bulk(w.db, [...SY.flatMap(s => Array.from({ length: 8 }, (_, k) => ({ actor: s, trainNo: 'G' + (k + 1), pts: TINY }))),
    ...NEW.map(a => ({ actor: a, trainNo: 'N1', pts: TINY })), ...KS.map(a => ({ actor: a, trainNo: 'K1', pts: TINY }))]);
  const seen = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LIST_RE.test(sql)) seen.push(rs.map(r => ({ actor: String(r.actor), head: Number(r.head), struck: Number(r.struck) }))); });
  const st = await w.cron();
  const L = seen[0] || [];
  ok('N1h [第四輪 E 缺口] 4010 班截到 4000：錯滿 2 次的 5 班一班都不在清單裡（最先被截）；head 3995、新身分 5 班全在',
    st.truncated === true && L.length === 4000 && L.filter(r => KS.includes(r.actor)).length === 0 && L.filter(r => r.struck).length === 0 &&
      L.filter(r => r.head).length === 3995 && NEW.every(a => L.some(r => r.actor === a)),
    J({ truncated: st.truncated, list: L.length, struck: L.filter(r => KS.includes(r.actor)).length, head: L.filter(r => r.head).length,
      newIn: NEW.filter(a => L.some(r => r.actor === a)).length }));
});

// N1h2 截斷時，一般班車依輪次排、同一輪裡可信的才先（第五輪獨立驗收：N1d／N1h 的世界裡沒有「可信身分的非 head 班車」，
// 把截斷排序的 rnd 與 trusted DESC 換序照樣全綠）。可信身分 T 傳 3,000 班＋2,000 個新身分各 1 班：共 5,000 班、截到 4,000。
// 期望（自己照規格排）：T 的 head 8 班 → 各人第 1 輪（新身分 2,000 班；T 的第 1 輪是 head）→ T 的第 9 班起依輪次，截到 4,000 ＝ T 的 1,992 班。
// 換序的話 T 的 2,992 班非 head 全排在新身分前面，新身分只剩 1,000 班進得了清單。
await attempt('N1h2', async () => {
  const T = 'dev-n1h2-trust1', NEW = Array.from({ length: 2000 }, (_, i) => 'dev-n1h2-n' + String(i).padStart(4, '0'));
  const w = world({ seed: boardSql('山線') + gradSql([T]), env: { BOUNTY_VERIFY_ORDER: 'fixed', BOUNTY_SUBREQ_BUDGET: '60' } });
  bulk(w.db, [...Array.from({ length: 3000 }, (_, k) => ({ actor: T, trainNo: 'T' + String(k + 1).padStart(4, '0'), pts: TINY })),
    ...NEW.map(a => ({ actor: a, trainNo: 'N1', pts: TINY }))]);
  const seen = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LIST_RE.test(sql)) seen.push(rs.map(r => ({ actor: String(r.actor), head: Number(r.head), rnd: Number(r.rnd) }))); });
  const st = await w.cron();
  const L = seen[0] || [];
  const newIn = new Set(L.filter(r => r.actor !== T).map(r => r.actor)).size;
  const tRnd = L.filter(r => r.actor === T && !r.head).map(r => r.rnd);
  ok('N1h2 [第五輪] 5,000 班截到 4,000：新身分 2,000 班全在（同一輪的一般班車不因為 T 可信就被擠掉）；T 在清單裡＝head 8 班＋第 9–2,000 輪',
    st.truncated === true && L.length === 4000 && newIn === 2000 && L.filter(r => r.head).length === 8 &&
      tRnd.length === 1992 && Math.min(...tRnd) === 9 && Math.max(...tRnd) === 2000,
    J({ truncated: st.truncated, list: L.length, newIn, head: L.filter(r => r.head).length, tNonHead: tRnd.length, tRange: tRnd.length ? [Math.min(...tRnd), Math.max(...tRnd)] : null }));
});

// ═══ CL：認領的上界（第五輪獨立驗收 新洞①）══════════════════════════════════════
// 舊版：同一個 actor 同一張卡接幾次就多幾組列（不去重），判定時認領那一句整包送回 Worker（不算讀取量、子請求也擋不住），
// unusable 的車又不關認領，每一班都再讀一次——第五輪用一個匿名身分 1,112 次認領＋1,200 班，本機一發 71 秒。
// 修法三處：判定那一句在 SQL 裡先取每個單位最近的一筆（CL1）；認領端點同一張卡再接＝取代（CL2）；合併之後帳號名下也去重（CL3）。
const claimRow = ({ id, actor, seg, pts, at, tk = '自強', status = 'open', exp = NOW_MS + DAY }) =>
  'INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES ' +
  `('${id}','${actor}','${seg}','${tk}',0,'track','',${pts},${at},${exp},'${status}');`;
const boardSqlKind = (ln, tk) => boardSql(ln).replaceAll("'自強'", `'${tk}'`);
// 認領端點用 Date.now()（不吃 BOUNTY_NOW）：同一毫秒接的兩組會在 claimed_at 平手、改比隨機的 claimId——時間要自己撥，結果才寫得死。
const withClock = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };
await attempt('CL1', async () => {
  // A 在山線 9 段各有 40 筆開著的認領（claimed_at 1000…1039；最新那筆 7 點、其餘 1 點）；S0|S1 另有一筆與最新同一刻、id 較大的 11 點
  // （claimed_at 平手比 id：與舊版 ORDER BY claimed_at DESC, id DESC 的第一筆相同）。一趟 700 秒 ok 覆蓋 S0|S1…S6|S7（7 段）。
  // 期望點數＝11（S0|S1）＋6×7＝53；判定那一句送回 7 列（每個覆蓋單位一筆；舊版 7×40＋1＝281 列）。
  const A = 'dev-cl1-000001';
  const seed = [];
  for (const s of SEGS10) for (let k = 0; k < 40; k++)
    seed.push(claimRow({ id: `cl1|${s}|${String(k).padStart(2, '0')}`, actor: A, seg: KT('山線', s), pts: k === 39 ? 7 : 1, at: 1000 + k }));
  seed.push(claimRow({ id: 'cl1|S0|S1|zz', actor: A, seg: KT('山線', 'S0|S1'), pts: 11, at: 1039 }));
  const w = world({ seed: boardSql('山線') + seed.join('') });
  putBatches(w.db, { actor: A, trainNo: 'C1', pts: leg({ sec: 700 }) });
  const got = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (CLAIMS_READ_RE.test(sql)) got.push(rs.length); });
  const st = await w.cron();
  ok('CL1 [第五輪 新洞①] 一個人 9 段各有 40 筆開著的認領：判定那一句只送回 7 列（每個覆蓋單位一筆；舊版 281 列）；點數用每個單位最近的那一筆（11＋6×7＝53，平手比 id）',
    q.verdicts(w, A, 'C1') === 'ok' && J(got) === J([7]) && q.points(w, A) === 53 && st.ok === 1,
    J({ v: q.verdicts(w, A, 'C1'), got, points: q.points(w, A), ok: st.ok }));
});
// 在 S1（2 km）停 5 秒的一趟：10 m/s 巡航、20 秒減速到 0.5、5 秒 0.2 m/s（都卜勒 0.35／0.45）、20 秒加速回 10 m/s，一路開到 S2（4 km）。
// 形狀照 verify_bounty_dwell.mjs 的 trajectory（同樣的雜訊，過得了防偽閘）。從 5 m 起跑：巡航剛好停在 1,895 m 開始減速，
// 從 0 起跑的話中間會多一步 5 m、都卜勒從 5 跳到 9.5——第九批之前的加速度上限（每秒 3.9 m/s）會判成 impossible_physics；現在的上限是 1.3×3×(Δt＋1)，形狀沿用。
function dwellLeg(t0 = 30000) {
  const pts = [{ d: 5, t: t0, v: 10.4, acc: 8 }];
  let d = 5, t = t0, n = 0;
  const push = (s, dop = null) => { d += s; t += 1; n += 1; pts.push({ d, t, v: dop == null ? Math.max(0, s + Math.sin(n / 3) * 1.2) : dop, acc: 8 + (n % 3) }); };
  while (d + 10 < 2000 - 105) push(10);
  if (d < 2000 - 105) push(2000 - 105 - d);
  for (let j = 1; j <= 20; j++) push(10 - 9.5 * j / 20);
  for (let j = 0; j < 5; j++) push(0.2, 0.35 + (j % 2) * 0.1);
  for (let j = 1; j <= 20; j++) push(0.5 + 9.5 * j / 20);
  while (d + 10 <= 4000) push(10);
  return pts;
}
await attempt('CL1b', async () => {
  // 判定那一句的分組鍵是 (seg_key, dir, kind, slot) 四欄，少一欄就會拿別的方向／別的時段的認領蓋掉這一趟的（CL1 的世界只有一個方向、一個時段，量不到）。
  // 乘車日 07-26（週日＝holiday 時段）：一趟 S0 → S2、在 S1 停 5 秒 → 覆蓋 S0|S1、S1|S2（track）＋ S1|S1（dwell, holiday）。
  // 認領：S0|S1 dir 0 一筆 7 點（較舊）＋ dir 1 一筆 99 點（較新）；S1|S1 dwell 的 holiday 9 點（最舊）＋ peak、off 各 1 點（較新）。
  // 期望點數＝7（S0|S1 用 dir 0 那筆）＋3（S1|S2 沒認領，板價 3）＋9（S1|S1 用 holiday 那筆）＝19；那一句送回 5 列（五個分組各一筆）。
  const A = 'dev-cl1b-00001', D26 = '2026-07-26', ST = KT('山線', 'S1|S1');
  const dw = (id, slot, pts, at) => `INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES ` +
    `('${id}','${A}','${ST}','自強',0,'dwell','${slot}',${pts},${at},${NOW_MS + DAY},'open');`;
  const w = world({ seed: boardSql('山線') +
    claimRow({ id: 'cl1b-d0', actor: A, seg: KT('山線', 'S0|S1'), pts: 7, at: 100 }) +
    claimRow({ id: 'cl1b-d1', actor: A, seg: KT('山線', 'S0|S1'), pts: 99, at: 200 }).replace(",'自強',0,'track'", ",'自強',1,'track'") +
    dw('cl1b-h', 'holiday', 9, 100) + dw('cl1b-p', 'peak', 1, 200) + dw('cl1b-o', 'off', 1, 300) });
  putBatches(w.db, { actor: A, trainNo: 'W1', date: D26, pts: dwellLeg() });
  const got = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (CLAIMS_READ_RE.test(sql)) got.push(rs.length); });
  await w.cron();
  const segs = JSON.parse((one(w, "SELECT segs FROM bounty_samples WHERE actor=? AND segs IS NOT NULL", A) || {}).segs || '[]');
  ok('CL1b [第五輪 新洞①] 分組鍵四欄都在：S0|S1 用 dir 0 的 7 點（不是較新的 dir 1）、S1|S1 用 holiday 的 9 點（不是較新的 peak／off）——點數 7＋3＋9＝19；那一句送回 5 列',
    q.verdicts(w, A, 'W1') === 'ok' && segs.some(c => c.key === ST && c.kind === 'dwell' && c.slot === 'holiday') && q.points(w, A) === 19 && J(got) === J([5]),
    J({ v: q.verdicts(w, A, 'W1'), rej: q.rejects(w, A, 'W1'), points: q.points(w, A), got, segs: segs.map(c => `${c.key.split('|').slice(2).join('|')}/${c.kind}/${c.slot}`) }));
});
await attempt('CL2', async () => {
  // A 接山線 dir 0 自強那張卡、再接莒光那張；B 也接自強那張。然後板價 3 → 5、時間往後 1 小時，A 再接一次自強那張。
  // 另外種兩筆 A 的舊列：S0|S1 自強已完成（fulfilled）、S1|S2 自強開著但早就過期。
  // 期望：A 的自強開著的認領恰 9 列、全是最後這一次的（點數 5、時間是 1 小時後）——過期但開著的那筆也被取代；
  // 已完成的那筆、A 的莒光 9 列、B 的 9 列都原封不動；回應照舊（9 個單位、鎖 45 點、認領人數 2）。
  const A = 'dev-cl2-00000A', B = 'dev-cl2-00000B';
  const CARD = 'tra_sched|山線|0|自強|track|', CARD_K = 'tra_sched|山線|0|莒光|track|';
  const w = world({ seed: boardSql('山線') + boardSqlKind('山線', '莒光') +
    claimRow({ id: 'cl2-done', actor: A, seg: KT('山線', 'S0|S1'), pts: 2, at: 5, status: 'fulfilled' }) +
    claimRow({ id: 'cl2-old', actor: A, seg: KT('山線', 'S1|S2'), pts: 2, at: 5, exp: 10 }) });
  const log = spyBatches(w.DELAY_DB);
  const [c1, k1, b1] = await withClock(NOW_MS, async () => [await claim(w, A, CARD), await claim(w, A, CARD_K), await claim(w, B, CARD)]);
  const idsOf = (a, tk) => rows(w, 'SELECT id FROM bounty_claims WHERE actor=? AND train_kind=? ORDER BY id', a, tk).map(r => r.id);
  const kBefore = idsOf(A, '莒光'), bBefore = idsOf(B, '自強');
  w.db.exec("UPDATE bounty_board SET points=5 WHERE train_kind='自強'");
  const c2 = await withClock(NOW_MS + 3600e3, () => claim(w, A, CARD));
  const open = rows(w, "SELECT id, points_locked p, claimed_at at FROM bounty_claims WHERE actor=? AND train_kind='自強' AND status='open'", A);
  const pre = c2.json && c2.json.claimId + '|';
  ok('CL2a [第五輪 新洞①] 同一張卡再接一次＝取代：A 的自強開著的認領恰 9 列、全是這一次的（點數 5、時間 1 小時後），過期但開著的舊列也被取代',
    [c1, k1, b1, c2].every(r => r.status === 200) && !!pre && open.length === 9 &&
      open.every(r => r.id.startsWith(pre) && r.p === 5 && r.at === NOW_MS + 3600e3) && !one(w, "SELECT 1 x FROM bounty_claims WHERE id='cl2-old'"),
    J({ st: [c1, k1, b1, c2].map(r => r.status), open: open.slice(0, 2), n: open.length }));
  ok('CL2b 別的都不動：A 已完成的那筆還在（fulfilled）、A 的莒光 9 列與 B 的 9 列 id 逐列相同；回應照舊（9 個單位、鎖 45 點、認領人數 2）',
    one(w, "SELECT status FROM bounty_claims WHERE id='cl2-done'")?.status === 'fulfilled' && kBefore.length === 9 && J(idsOf(A, '莒光')) === J(kBefore) &&
      bBefore.length === 9 && J(idsOf(B, '自強')) === J(bBefore) && c2.json.units === 9 && c2.json.pointsLocked === 45 && c2.json.claimers === 2,
    J({ done: one(w, "SELECT status FROM bounty_claims WHERE id='cl2-done'"), k: idsOf(A, '莒光').length, b: idsOf(B, '自強').length, res: c2.json }));
  // 查詢計畫：去重那一句只能走 idx_claims_actor（這個人自己的，有上界），不能走 idx_claims_unit（那個單位所有人的，匿名身分免費、沒有上界）。
  const del = [...new Set(log.flat().map(s => s.sql).filter(s => /^DELETE FROM bounty_claims/.test(s)))];
  const plan = del.length === 1 ? w.db.prepare('EXPLAIN QUERY PLAN ' + del[0]).all(...Array((del[0].match(/\?/g) || []).length).fill(null)).map(r => String(r.detail)).join(' ; ') : '';
  ok('CL2c [第五輪] 去重那一句走 idx_claims_actor（actor, status），不走 idx_claims_unit（單位上所有人的認領）',
    del.length === 1 && /SEARCH bounty_claims USING INDEX idx_claims_actor \(actor=\? AND status=\?\)/.test(plan) && !/idx_claims_unit/.test(plan),
    J({ n: del.length, plan }));
});
await attempt('CL2d', async () => {
  // E7／E8（第六輪 突變存活）：去重那一句只刪「同一個方向、同一個時段」的舊認領——兩個方向共用同一批段鍵、同一站的三個時段共用同一個站鍵，
  // 刪除條件少了 dir 或 slot，再接一張卡就會把自己別的方向、別的時段的認領刪掉（CL2 的世界只有一個方向、只有 track 卡，照不到）。
  // A 接山線自強 dir 0、dir 1 兩張 track 卡，與 S1 站 dwell 的 peak、off 兩張卡；一小時後再接 dir 0 track 與 dwell peak。
  // 期望：dir 0 track 與 dwell peak 各自整組換成這一次的；dir 1 的 9 列、dwell off 那一列 id 逐列不變。
  const A = 'dev-cl2d-0000A';
  const T0 = 'tra_sched|山線|0|自強|track|', T1 = 'tra_sched|山線|1|自強|track|', DP = 'tra_sched|山線|0|自強|dwell|peak', DO = 'tra_sched|山線|0|自強|dwell|off';
  const dwellSql = slot => boardSql('山線', ['S1|S1']).replace(",'track','',", `,'dwell','${slot}',`);
  const w = world({ seed: boardSql('山線') + boardSql('山線').replaceAll(",'自強',0,'track',", ",'自強',1,'track',") + dwellSql('peak') + dwellSql('off') });
  const first = await withClock(NOW_MS, async () => [await claim(w, A, T0), await claim(w, A, T1), await claim(w, A, DP), await claim(w, A, DO)]);
  const idsOf = (dir, kind, slot) => rows(w, "SELECT id FROM bounty_claims WHERE actor=? AND dir=? AND kind=? AND slot=? AND status='open' ORDER BY id", A, dir, kind, slot).map(r => r.id);
  const d1Before = idsOf(1, 'track', ''), offBefore = idsOf(0, 'dwell', 'off');
  const again = await withClock(NOW_MS + 3600e3, async () => [await claim(w, A, T0), await claim(w, A, DP)]);
  const d0After = idsOf(0, 'track', ''), peakAfter = idsOf(0, 'dwell', 'peak');
  ok('CL2d [第六輪 E7／E8] 再接 dir 0 的 track 卡與 dwell peak 卡：那兩組整組換成這一次的；自己 dir 1 的 9 列（同一批段鍵）與 dwell off 那一列（同一個站鍵）一列不動',
    [...first, ...again].every(r => r.status === 200) && d1Before.length === 9 && offBefore.length === 1 &&
      J(idsOf(1, 'track', '')) === J(d1Before) && J(idsOf(0, 'dwell', 'off')) === J(offBefore) &&
      d0After.length === 9 && d0After.every(id => id.startsWith(again[0].json.claimId + '|')) &&
      peakAfter.length === 1 && peakAfter[0].startsWith(again[1].json.claimId + '|'),
    J({ st: [...first, ...again].map(r => r.status), d1: [d1Before.length, idsOf(1, 'track', '').length], off: [offBefore, idsOf(0, 'dwell', 'off')], d0After: d0After.length, peakAfter }));
});
await attempt('CL3', async () => {
  // 帳號 U 與兩個裝置 D1、D2 都接過山線自強那張卡，時間 D1 < U < D2；D1 先併進 U、D2 再併。U 另有莒光那張與一筆已完成的舊認領。
  // 期望：每次合併之後 U 名下自強開著的認領恰 9 列＝最近的那一組（D1 併進來之後留 U 的、D2 併進來之後留 D2 的）；莒光與已完成的不動。
  const U = 'uid-cl3-0000U', D1 = 'dev-cl3-000D1', D2 = 'dev-cl3-000D2';
  const CARD = 'tra_sched|山線|0|自強|track|', CARD_K = 'tra_sched|山線|0|莒光|track|';
  const w = world({ seed: boardSql('山線') + boardSqlKind('山線', '莒光') + pointsSql([[U, U, 0, null]]) +
    claimRow({ id: 'cl3-done', actor: U, seg: KT('山線', 'S0|S1'), pts: 2, at: 5, status: 'fulfilled' }) });
  const d1 = await withClock(NOW_MS, () => claim(w, D1, CARD));
  const [u1, uk] = await withClock(NOW_MS + 60e3, async () => [await claim(w, U, CARD, bearer(U)), await claim(w, U, CARD_K, bearer(U))]);
  const d2 = await withClock(NOW_MS + 120e3, () => claim(w, D2, CARD));
  const openOf = a => rows(w, "SELECT id FROM bounty_claims WHERE actor=? AND train_kind='自強' AND status='open'", a).map(r => r.id);
  const m1 = await merge(w, D1, U), after1 = openOf(U);
  const m2 = await merge(w, D2, U), after2 = openOf(U);
  const kIds = rows(w, "SELECT id FROM bounty_claims WHERE actor=? AND train_kind='莒光'", U).map(r => r.id);
  ok('CL3a [第五輪 新洞①] 裝置併進帳號之後，帳號名下同一個單位只留最近的一筆：D1 併進來之後 9 列全是 U 自己的、D2 併進來之後 9 列全是 D2 的；莒光 9 列與已完成的那筆不動；裝置名下一列不剩',
    [d1, u1, uk, d2, m1, m2].every(r => r.status === 200) && after1.length === 9 && after1.every(id => id.startsWith(u1.json.claimId + '|')) &&
      after2.length === 9 && after2.every(id => id.startsWith(d2.json.claimId + '|')) && kIds.length === 9 && kIds.every(id => id.startsWith(uk.json.claimId + '|')) &&
      one(w, "SELECT actor, status FROM bounty_claims WHERE id='cl3-done'")?.status === 'fulfilled' && q.count(w, 'bounty_claims', 'actor IN (?,?)', D1, D2) === 0,
    J({ st: [d1, u1, uk, d2, m1, m2].map(r => r.status), after1: after1.length, after2: after2.length, k: kIds.length }));
  // 守衛 G：來源 V 已經併進別人（X）→ 合併回 409，這一句一列都不刪（U 名下事先種的兩筆重複都還在）；
  // 對照組：接著併一個新裝置 D3（守衛成立）→ U 名下那兩筆收成最近的一筆。
  const X = 'uid-cl3-0000X', V = 'dev-cl3-0000V', D3 = 'dev-cl3-000D3';
  const w2 = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null], [X, X, 0, null], [V, null, 0, X]]) +
    claimRow({ id: 'cl3-dup1', actor: U, seg: KT('山線', 'S0|S1'), pts: 2, at: 10 }) + claimRow({ id: 'cl3-dup2', actor: U, seg: KT('山線', 'S0|S1'), pts: 3, at: 20 }) +
    claimRow({ id: 'cl3-v', actor: V, seg: KT('山線', 'S0|S1'), pts: 4, at: 30 }) });
  const all2 = () => rows(w2, 'SELECT id, actor FROM bounty_claims ORDER BY id').map(r => `${r.id}@${r.actor}`);
  const m3 = await merge(w2, V, U), snap3 = all2();
  const m4 = await merge(w2, D3, U), snap4 = all2();
  ok('CL3b [第五輪] 合併去重也圍守衛 G：來源已併進別人 → 409、一列都不刪（U 的兩筆重複都在、V 的原地）；對照：併一個新裝置之後 U 的兩筆收成最近的那筆',
    m3.status === 409 && m3.json.error === 'merged_elsewhere' && J(snap3) === J([`cl3-dup1@${U}`, `cl3-dup2@${U}`, `cl3-v@${V}`]) &&
      m4.status === 200 && J(snap4) === J([`cl3-dup2@${U}`, `cl3-v@${V}`]),
    J({ m3: m3.text, snap3, m4: m4.status, snap4 }));
  // M4（第六輪 突變存活）：去重只在「開著的」之間比新舊。U 在 S0|S1 有一筆較新的已完成、裝置 D4 有一筆較舊的開著——
  // 併進來之後那筆開著的要留著（它是 U 在這個單位唯一開著的認領）；內層若把已完成的也排進來，開著的那筆會被當成「較舊的重複」刪掉。
  const D4 = 'dev-cl3-000D4';
  const w3 = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) +
    claimRow({ id: 'cl3c-done', actor: U, seg: KT('山線', 'S0|S1'), pts: 2, at: 200, status: 'fulfilled' }) +
    claimRow({ id: 'cl3c-open', actor: D4, seg: KT('山線', 'S0|S1'), pts: 3, at: 100 }) });
  const m5 = await merge(w3, D4, U);
  const snap5 = rows(w3, 'SELECT id, actor, status FROM bounty_claims ORDER BY id').map(r => `${r.id}@${r.actor}/${r.status}`);
  ok('CL3c [第六輪 M4] 帳號在同一個單位有較新的「已完成」、裝置帶來較舊的「開著」：合併之後那筆開著的留著（只在開著的之間去重）',
    m5.status === 200 && J(snap5) === J([`cl3c-done@${U}/fulfilled`, `cl3c-open@${U}/open`]), J({ m5: m5.status, snap5 }));
});
// CL4（第八、九批）：讀／刪／關「這個人的」認領的三句，加上合併時認領改名、去重兩句，不論表有沒有統計資料都只走 idx_claims_actor。
// 沒有統計時 SQLite 本來就挑 idx_claims_actor（所以 CL2c 照不到）；表一旦有統計，兩種形狀會把它帶走：
//   H1 手寫的偏斜——每個人的認領多、每個單位的認領少（早期少數重度使用者時跑 PRAGMA optimize 會收到的形狀）：改走 idx_claims_unit＝讀這些段上所有人的認領；
//   R2 ANALYZE 自己算的——表裡只有一個身分、每個單位一筆開著的認領（上線初期只有自己在測）：actor 看起來毫無選擇性，改走全表掃描（第六輪獨立驗收 N6-1，
//      第八批只用一元加號擋 idx_claims_unit，擋不住這一種）。
// 第九批五句都寫 INDEXED BY idx_claims_actor。判準：句子裡有 INDEXED BY idx_claims_actor，而且三種狀態下碰到 bounty_claims 的每一步都走 idx_claims_actor；
// 對照組（證明統計真的偏、判準有牙）：同一份統計下把 INDEXED BY 拿掉——R2 下不再走 idx_claims_actor（a、b、c、e），H1 下改走 idx_claims_unit（a、b、c）。
// 合併改名那一句（d）在這裡的 SQLite（node 3.51.2）拿掉 INDEXED BY 也照樣走 idx_claims_actor 的覆蓋索引，量不出差別；D1（workerd）在 R2 下是全表掃描
// （第六輪 V6/d2 的實測：rows_read 98,442），那個對照留在 workerd 的冒煙（d1_plan_probe）。這一句的判準因此多看「句子裡有 INDEXED BY」——計畫隨引擎版本變，寫法不會。
// 計畫在只有 schema 的空庫裡看（計畫只看 schema 與統計，不看資料）；統計是手寫進 sqlite_stat1 再 ANALYZE sqlite_schema 讓規劃器重讀（H1），或真的跑 ANALYZE（R2）。
const skewClaimStats = db => {
  db.exec('ANALYZE');
  db.exec("DELETE FROM sqlite_stat1 WHERE tbl='bounty_claims'");
  db.exec("INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES ('bounty_claims','idx_claims_actor','200000 20000 10000')," +
    " ('bounty_claims','idx_claims_unit','200000 20 2 1 1 1 1 1'), ('bounty_claims','idx_claims_expiry','200000 100000 2')");
  db.exec('ANALYZE sqlite_schema');
};
const soloClaimStats = db => {
  const st = db.prepare('INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 3626; i++) st.run(`solo-${i}`, 'dev-solo-000001', KT('獨線', `X${i}|X${i + 1}`), '自強', i % 2, 'track', '', 3, 1, NOW_MS + DAY, 'open');
  db.exec('COMMIT');
  db.exec('ANALYZE');
};
const claimsPlan = (db, sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array((sql.match(/\?/g) || []).length).fill(null))
  .map(r => String(r.detail)).filter(d => /\bbounty_claims\b/.test(d));
await attempt('CL4', async () => {
  const A = 'dev-cl4-00000A', U = 'uid-cl4-0000U', CARD = 'tra_sched|山線|0|自強|track|';
  // 刪除那一句：認領端點
  const w1 = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) });
  const log1 = spyBatches(w1.DELAY_DB);
  await withClock(NOW_MS, () => claim(w1, A, CARD));
  // 合併的改名、去重兩句：A（裝置）併進 U
  await merge(w1, A, U);
  const sqls1 = [...new Set(log1.flat().map(s => s.sql))];
  const del = sqls1.filter(s => /^DELETE FROM bounty_claims (?:INDEXED BY idx_claims_actor )?WHERE actor=\? AND status='open' AND train_kind=\?/.test(s));
  const ren = sqls1.filter(s => /^UPDATE bounty_claims (?:INDEXED BY idx_claims_actor )?SET actor=\?/.test(s));
  const ded = sqls1.filter(s => /^DELETE FROM bounty_claims (?:INDEXED BY idx_claims_actor )?WHERE actor=\? AND status='open' AND id IN/.test(s));
  // 讀認領那一句與關認領那一句：一趟 700 秒 ok、每段一筆認領
  const w2 = world({ seed: boardSql('山線') + SEGS10.map((s, i) => claimRow({ id: `cl4|${i}`, actor: A, seg: KT('山線', s), pts: 5, at: 1000 })).join('') });
  putBatches(w2.db, { actor: A, trainNo: 'C4', pts: leg({ sec: 700 }) });
  const sel = new Set();
  spyRows(w2.DELAY_DB, sql => { if (CLAIMS_READ_RE.test(sql)) sel.add(sql); });
  const log2 = spyBatches(w2.DELAY_DB);
  await w2.cron();
  const upd = [...new Set(log2.flat().map(s => s.sql).filter(s => /^UPDATE bounty_claims (?:INDEXED BY idx_claims_actor )?SET status='fulfilled'/.test(s)))];
  const cases = [['a 認領端點的刪除', del, 'unit'], ['b 判定時讀認領', [...sel], 'unit'], ['c 判定 ok 之後關認領', upd, 'unit'],
    ['d 合併時認領改名', ren, 'none'], ['e 合併時認領去重', ded, 'r2']];
  const DB0 = openTestDb('').db, DBH = openTestDb('').db, DBR = openTestDb('').db;
  skewClaimStats(DBH); soloClaimStats(DBR);
  const ACTOR = /^SEARCH bounty_claims USING (?:COVERING )?INDEX idx_claims_actor \(actor=\?(?: AND status=\?)?\)$/;   // 改名那句只有 actor=?（覆蓋索引）
  const onActor = lines => lines.length > 0 && lines.every(l => ACTOR.test(l));
  const strip = s => s.replaceAll(' INDEXED BY idx_claims_actor', '');
  cases.forEach(([name, l, ctrl]) => {
    const sql = l.length === 1 ? l[0] : null;
    const [p0, pH, pR] = sql ? [DB0, DBH, DBR].map(db => claimsPlan(db, sql)) : [[], [], []];
    const [cH, cR] = sql && strip(sql) !== sql ? [DBH, DBR].map(db => claimsPlan(db, strip(sql))) : [[], []];
    ok(`CL4${name[0]} [第八、九批] ${name.slice(2)}那一句寫 INDEXED BY idx_claims_actor，沒有統計、H1、R2 三種統計下碰到 bounty_claims 的每一步都走 idx_claims_actor` +
      (ctrl === 'none' ? '（對照在 workerd 冒煙，見上方說明）' : `；對照——同一份統計下拿掉 INDEXED BY：R2 下不再走 idx_claims_actor${ctrl === 'unit' ? '、H1 下改走 idx_claims_unit' : ''}`),
      !!sql && sql.includes('bounty_claims INDEXED BY idx_claims_actor') && onActor(p0) && onActor(pH) && onActor(pR) &&
        (ctrl === 'none' || (cR.length > 0 && !onActor(cR))) && (ctrl !== 'unit' || cH.some(x => /idx_claims_unit/.test(x))),
      J({ n: l.length, p0, pH, pR, cH, cR }));
  });
});

// ═══ PL：會隨使用者長大的六張表，每一句的查詢計畫不看統計（第十批；第六輪獨立驗收 N6-1 的同一族）═════════════════
// N6-1 是認領五句：表很小時算的統計（D1 文件要使用者建索引後、每次改 schema 後都跑 PRAGMA optimize）會讓規劃器改走全表掃描。
// 第十批實測同一件事也發生在樣本表（判定 cron 讀一班、前次列、標記、清掃出錯記錄）與另外四張表的逐人查詢；修法是每一句都寫 INDEXED BY。
// 這一組判準不另外抄一份 SQL：把每個端點（上傳、認領、看板、bounty-me、chips-me、兌換、雲端搭乘、合併、刪帳號兩種形式）
// 與兩支 cron（估值、判定：ok、超量、出錯記錄清掃）各實際跑一次，攔下 DELAY_DB.prepare 收到的每一句，實作改了這裡自動跟著改。
// 統計形狀（手寫進 sqlite_stat1 再 ANALYZE sqlite_schema 讓規劃器重讀；計畫只看 schema 與統計，不看資料）：
//   one     每個索引都說「整張表 1 列」——表只有一列時跑過 PRAGMA optimize
//   tiny3   每個索引都說「3 列、每個值 3 列」——上線前自己測幾趟
//   t48     「48 列、第一欄只有一個值」——一位測試者錄了 48 批（第十批實測：班車清單改走 idx_samples_trip 的跳躍掃描）
//   cheap   「表 1 列、每個索引每個值 100 萬列」——全表掃描看起來最便宜（第七輪獨立驗收 H7）
//   favorK  每張表第 K 個索引（依名字排序）看起來完美、其餘毫無選擇性；K＝0…3 輪一遍，每個索引都當過一次「最好看的」
// PLa 覆蓋：worker.js 每一個寫 INDEXED BY 的片段都被攔到過（沒攔到＝那一句的計畫沒被看過，下面兩條對它失明）。
// PLb 穩定：碰到六張表的每一句，每一種統計形狀下的計畫都與沒有統計時逐行相同；沒有統計時也不掃六張表的全表（例外逐條列在 PL_SCAN_OK）。
// PLc 指名：每一族句子寫的是指定的索引（拿掉 INDEXED BY 而 node 的計畫剛好沒變的那幾句靠這一條抓——workerd 的成本模型與 node 不同，第九批 CL4d 的前例）。
// PLd 對照（統計真的偏、PLb 有牙）：同一份統計下把 INDEXED BY 全部拿掉，指名的幾句計畫會變。
// PLc2／PLd2 覆蓋：每一句寫了 INDEXED BY 的都有族名；六張表每一張都有會翻的對照（兩張清單被刪空或跟不上新加的句子時，PLc／PLd 會空轉成綠）。
const GROW6 = ['bounty_samples', 'bounty_claims', 'chip_ledger', 'garage_unlocks', 'cloud_rides', 'bounty_seg_contrib'];
const PL_STAT_TABLES = [...GROW6, 'bounty_points', 'kv_blobs'];   // 會跟六張表 join 的兩張也寫統計（更刁）
const PL_SHAPES = {
  one: k => Array(k + 1).fill(1).join(' '),
  tiny3: (k, u) => Array.from({ length: k + 1 }, (_, j) => (u && j === k) ? 1 : 3).join(' '),
  t48: (k, u) => ['48', ...Array.from({ length: k }, (_, j) => (u && j === k - 1) ? 1 : j === 0 ? 48 : 16)].join(' '),
  cheap: k => ['1', ...Array(k).fill(1000000)].join(' '),
};
for (let K = 0; K < 4; K++) PL_SHAPES['favor' + K] = (k, u, i, n) =>
  ['1000000', ...Array.from({ length: k }, (_, j) => (i === K % n) ? 1 : (u && j === k - 1) ? 1 : 1000000)].join(' ');
function plDb(shape) {
  const { db } = openTestDb('');
  db.exec('ANALYZE'); db.exec('DELETE FROM sqlite_stat1');
  if (shape) {
    const ins = db.prepare('INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES (?, ?, ?)');
    for (const t of PL_STAT_TABLES) {
      const idx = db.prepare(`SELECT name, "unique" AS u FROM pragma_index_list('${t}') ORDER BY name`).all();
      idx.forEach((r, i) => ins.run(t, r.name, shape(db.prepare(`SELECT COUNT(*) AS c FROM pragma_index_info('${r.name}')`).get().c, r.u, i, idx.length)));
    }
  }
  db.exec('ANALYZE sqlite_schema');
  return db;
}
const plPlan = (db, sql) => {
  try { return db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array((sql.match(/\?/g) || []).length).fill(null)).map(r => String(r.detail)); }
  catch (e) { return ['ERR ' + String((e && e.message) || e)]; }
};
const touchesGrow = sql => GROW6.some(t => new RegExp(`\\b${t}\\b`).test(sql));
// 沒有統計時也掃全表的句子：六張表的別名（FROM t a、JOIN t a）也要認得，計畫裡寫的是別名。
const SQL_WORDS = new Set(['INDEXED', 'WHERE', 'SET', 'ON', 'JOIN', 'LEFT', 'INNER', 'CROSS', 'GROUP', 'ORDER', 'LIMIT', 'USING', 'WITH', 'VALUES',
  'AND', 'OR', 'NOT', 'AS', 'SELECT', 'UNION', 'EXCEPT', 'INTERSECT', 'DEFAULT']);
const growNames = sql => {
  const names = new Set(GROW6);
  for (const m of sql.matchAll(/\b(bounty_samples|bounty_claims|chip_ledger|garage_unlocks|cloud_rides|bounty_seg_contrib)\s+(?:AS\s+)?([A-Za-z_]\w*)/g))
    if (!SQL_WORDS.has(m[2].toUpperCase())) names.add(m[2]);
  return names;
};
const growScans = (sql, lines) => { const n = growNames(sql); return lines.filter(l => { const m = /^SCAN (\w+)/.exec(l); return m && n.has(m[1]); }); };

// 跑一遍全部端點與兩支 cron，回傳攔到的句子（去重、依第一次出現排序）與各步的狀態碼（判準要先確認每一步真的走到了）。
async function plCapture() {
  const A = 'dev-pl-00000A', B = 'dev-pl-00000B', U = 'uid-pl-0000U', CARD = 'tra_sched|山線|0|自強|track|';
  const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) + ledgerSql(A, 'adjust', 20, 'pl-seed-a') + ledgerSql(B, 'adjust', 20, 'pl-seed-b') +
    `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(B, 'PLGONE')}','{"at":1,"error":"x","n":1}','x');` });
  const seen = [], seenSet = new Set();
  const orig = w.DELAY_DB.prepare.bind(w.DELAY_DB);
  w.DELAY_DB.prepare = sql => { if (!seenSet.has(sql)) { seenSet.add(sql); seen.push(sql); } return orig(sql); };
  const st = {};
  st.submit = (await submit(w, A, { trainNo: 'PL0' })).status;
  st.claim = (await withClock(NOW_MS, () => claim(w, A, CARD))).status;
  st.board = (await call(_bounty.bountyBoard, get('/api/bounty-board'), w.env)).status;
  putBatches(w.db, { actor: A, trainNo: 'PL1', pts: leg({ sec: 700 }) });                        // ok 的一班（寫籌碼、貢獻、點數、關認領）
  putBatches(w.db, { actor: B, trainNo: 'OV', pts: Array.from({ length: 721 }, (_, i) => ({ d: i, t: 30000 + i, v: 1, acc: 5 })), size: 1 });   // 超量
  const f = await fire(w);                                                                      // 真的 scheduled()：估值＋判定（出錯記錄清掃在開頭）
  st.fire = f.threw ? 'threw ' + f.threw : 'ok';
  st.verdictA = q.verdicts(w, A, 'PL1'); st.verdictB = q.verdicts(w, B, 'OV');
  const manifest = { generatedAt: 2, schedDate: D28, lines: LINES, units: [{ segKey: KT('山線', 'S9|S10'), sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 4 }] };
  const assets = { fetch: async r => new Response(String((r && r.url) || r).includes('bounty_units') ? J(manifest) : J(RULES), { status: 200 }) };
  _bounty.bountyResetMemCaches();
  st.valuation = J(await _bounty.bountyValuationCron({ ...w.env, ASSETS: assets }));             // 上架新單位（數這一段的貢獻人數）
  st.chipsMe = (await chipsMe(w, '?actor=' + A)).status;
  const me = await bountyMe(w, '?actor=' + A);
  st.bountyMe = me.status; st.firsts = me.json && me.json.firsts;
  st.redeem = (await redeem(w, A, RULES.chips.scenes[0], nextReq())).status;
  const ride = { actor: A, day: '2026-07-29', trainKey: 'mrt|BR|veh-0001', startedAt: tpe('2026-07-29', 9), sec: 600, requestId: nextReq(), client: APP };
  st.cloud = (await call(_bounty.cloudRide, post('/api/cloud-ride', ride), w.env)).status;
  st.cloudResend = (await call(_bounty.cloudRide, post('/api/cloud-ride', ride), w.env)).status;   // 重送：還原第一次的 chipAwarded 那一句
  st.merge = (await merge(w, A, U)).status;
  st.del = (await delAccount(w, { actor: B }, U)).status;
  return { sqls: seen, st };
}
// PLc 的指名清單：每一族句子寫的是哪一個索引（第三欄＝至少要攔到幾句；合併的「刪較晚」與「刪孿生」同一個寫法兩句）。
// 這份清單刻意手寫、不從 worker.js 產生：從原始碼產生的話，拿掉一處 INDEXED BY 只會讓清單少一項，而不是變紅。
const PL_PINS = [
  ['上傳：每人每日批數', /COUNT\(\*\) AS n FROM bounty_samples INDEXED BY idx_samples_trip WHERE actor=\? AND trip_date=\?$/],
  ['bounty-me：最近 60 趟', /FROM bounty_samples INDEXED BY idx_samples_trip WHERE actor=\? ORDER BY trip_date DESC/],
  ['合併：樣本改名', /^UPDATE bounty_samples INDEXED BY idx_samples_trip SET actor=\? WHERE actor=\?/],
  ['判定：清掃出錯記錄', /NOT EXISTS \(SELECT 1 FROM bounty_samples s INDEXED BY idx_samples_trip WHERE s\.actor = /],
  ['判定：班車清單', /FROM bounty_samples s INDEXED BY idx_samples_pending LEFT JOIN bounty_points p ON p\.actor = s\.actor/],
  ['判定：班車清單裡可信判斷的帳本子查詢', /FROM chip_ledger l INDEXED BY idx_chip_ledger_actor_day WHERE l\.actor = t\.who AND l\.kind = 'trip'/],
  ['判定：超量整班可疑', /^UPDATE bounty_samples INDEXED BY idx_samples_trip SET verdict='suspect'/],
  ['判定：讀一班', /FROM bounty_samples INDEXED BY idx_samples_trip WHERE actor=\? AND trip_date=\? AND train_no=\? AND verdict='pending'/],
  ['判定：前次列', /FROM bounty_samples s INDEXED BY idx_samples_trip LEFT JOIN json_each\(/],
  ['判定：標記', /^UPDATE bounty_samples INDEXED BY sqlite_autoindex_bounty_samples_1 SET verdict=\?/],
  ['判定：第②段的「這一組還是 pending」', /FROM bounty_samples INDEXED BY sqlite_autoindex_bounty_samples_1 WHERE id IN \(SELECT value FROM json_each\(\?\)\) AND \+verdict='pending'/],
  ['判定：第③段的「真的標到」', /FROM bounty_samples INDEXED BY sqlite_autoindex_bounty_samples_1 WHERE id IN \(SELECT value FROM json_each\(\?\)\) AND \+verdict=\? AND \+verdict_at=\?/],
  ['判定：寫籌碼（今天已得）', /\(SELECT COALESCE\(SUM\(delta\), 0\) FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=w AND kind='trip' AND day=\?\)/],
  ['判定：寫籌碼（這一班沒發過）', /NOT EXISTS \(SELECT 1 FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=w AND kind='trip' AND day=\? AND substr\(ref/],
  ['認領：刪同一張卡的舊認領', /^DELETE FROM bounty_claims INDEXED BY idx_claims_actor WHERE actor=\? AND status='open' AND train_kind=\?/],
  ['認領：回傳的認領人數', /COUNT\(DISTINCT actor\) AS n FROM bounty_claims INDEXED BY idx_claims_unit WHERE seg_key=\?/],
  ['看板：開著的認領人數', /COUNT\(DISTINCT actor\) AS n FROM bounty_claims INDEXED BY idx_claims_expiry WHERE status='open' AND expires_at > \?/],
  ['判定：讀認領', /FROM bounty_claims INDEXED BY idx_claims_actor WHERE actor=COALESCE\(/],
  ['判定：關認領', /^UPDATE bounty_claims INDEXED BY idx_claims_actor SET status='fulfilled' WHERE actor=COALESCE\(/],
  ['合併：認領改名', /^UPDATE bounty_claims INDEXED BY idx_claims_actor SET actor=\? WHERE actor=\?/],
  ['合併：認領去重（外層）', /^DELETE FROM bounty_claims INDEXED BY idx_claims_actor WHERE actor=\? AND status='open' AND id IN/],
  ['合併：認領去重（內層）', /FROM bounty_claims INDEXED BY idx_claims_actor WHERE actor=\? AND status='open'\) WHERE rn>1/],
  ['錢包：餘額', /^SELECT COALESCE\(SUM\(delta\),0\) AS n FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=\?$/],
  ['chips-me：今天的錄程籌碼', /^SELECT COALESCE\(SUM\(delta\),0\) AS n FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=\? AND kind='trip' AND day=\?$/],
  ['兌換：交易內餘額守衛', /\(SELECT COALESCE\(SUM\(delta\),0\) FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=\?\) >= \?/],
  ['雲端搭乘：已得籌碼', /^SELECT COALESCE\(SUM\(delta\),0\) AS n FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=\? AND kind='cloud'$/],
  ['雲端搭乘重送：還原第一次的 chipAwarded', /FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=\? AND kind='cloud' AND created_at=\?/],
  ['合併：帳本改名', /^UPDATE chip_ledger INDEXED BY idx_chip_ledger_actor_day SET actor=\? WHERE actor=\?/],
  ['錢包：解鎖清單', /FROM garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 WHERE actor=\? ORDER BY nth/],
  ['兌換：已解鎖座數（寫帳本那句）', /^INSERT OR IGNORE INTO chip_ledger .*\(SELECT COUNT\(\*\) FROM garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 WHERE actor=\?\)/],
  ['兌換：已解鎖座數（寫解鎖那句）', /^INSERT OR IGNORE INTO garage_unlocks .*\(SELECT COUNT\(\*\) FROM garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 WHERE actor=\?\)/],
  ['合併：解鎖退款（兩邊都指名）', /FROM garage_unlocks d INDEXED BY sqlite_autoindex_garage_unlocks_1 JOIN garage_unlocks u INDEXED BY sqlite_autoindex_garage_unlocks_1 ON/],
  ['合併：刪較晚與孿生的解鎖', /^DELETE FROM garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 WHERE actor=\? AND EXISTS/, 2],
  ['合併：解鎖改名', /^UPDATE garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 SET actor=\?/],
  ['合併：重排 nth（內外兩層）', /^UPDATE garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 SET nth = \(SELECT COUNT\(\*\) FROM garage_unlocks g INDEXED BY sqlite_autoindex_garage_unlocks_1/],
  ['雲端搭乘：次數', /FROM cloud_rides INDEXED BY sqlite_autoindex_cloud_rides_1 WHERE actor=\? AND simulator=0/],
  ['雲端搭乘：重送判斷', /FROM cloud_rides INDEXED BY sqlite_autoindex_cloud_rides_1 WHERE actor=\? AND request_id=\?/],
  ['合併：刪較晚與孿生的搭乘', /^DELETE FROM cloud_rides INDEXED BY sqlite_autoindex_cloud_rides_1 WHERE actor=\? AND EXISTS/, 2],
  ['合併：搭乘改名', /^UPDATE cloud_rides INDEXED BY sqlite_autoindex_cloud_rides_1 SET actor=\?/],
  ['bounty-me：首位校正者', /FROM bounty_seg_contrib c INDEXED BY idx_seg_contrib_first WHERE c\.seg_key = j\.value ORDER BY c\.first_ok_at, c\.actor LIMIT 1/],
  ['估值：這一段的貢獻人數', /\(SELECT COUNT\(\*\) FROM bounty_seg_contrib INDEXED BY sqlite_autoindex_bounty_seg_contrib_1 WHERE seg_key=\?\)/],
  ['合併：撞段扣人數', /FROM bounty_seg_contrib d INDEXED BY idx_seg_contrib_actor WHERE d\.actor=\? AND EXISTS/],
  ['合併：首次時間取較早', /^UPDATE bounty_seg_contrib INDEXED BY idx_seg_contrib_actor SET first_ok_at =/],
  ['合併：刪孿生貢獻', /^DELETE FROM bounty_seg_contrib INDEXED BY idx_seg_contrib_actor WHERE actor=\? AND EXISTS/],
  ['合併：貢獻改名', /^UPDATE bounty_seg_contrib INDEXED BY idx_seg_contrib_actor SET actor=\?/],
  ...[['bounty_samples', 'idx_samples_trip'], ['bounty_claims', 'idx_claims_actor'], ['chip_ledger', 'idx_chip_ledger_actor_day'],
    ['garage_unlocks', 'sqlite_autoindex_garage_unlocks_1'], ['cloud_rides', 'sqlite_autoindex_cloud_rides_1'], ['bounty_seg_contrib', 'idx_seg_contrib_actor']]
    .map(([t, i]) => [`刪帳號：${t}（uid 自己＋併進的裝置寫成一個 IN）`, new RegExp(`^DELETE FROM ${t} INDEXED BY ${i} WHERE actor IN \\(SELECT \\? UNION ALL SELECT actor FROM bounty_points`)]),
  ['刪帳號：body 帶的裝置（樣本）', /^DELETE FROM bounty_samples INDEXED BY idx_samples_trip WHERE actor=\? AND NOT EXISTS/],
  ['刪帳號：body 帶的裝置（認領）', /^DELETE FROM bounty_claims INDEXED BY idx_claims_actor WHERE actor=\? AND NOT EXISTS/],
];
// PLd 的對照：拿掉 INDEXED BY 之後，node 這裡的計畫確實會被統計帶走的幾句（其餘幾句——上傳批數、bounty-me 最近 60 趟、寫解鎖、首位校正者、
// 估值——node 拿掉 INDEXED BY 也不太動，那幾句靠 PLc 的指名守；workerd 的成本模型不同，第九批 CL4d 的前例）。
const PL_CTRL = [
  ['判定：讀一班', /^SELECT \* FROM \(SELECT \*, SUM\(length\(payload\)\) OVER/],
  ['判定：標記', /^UPDATE bounty_samples INDEXED BY sqlite_autoindex_bounty_samples_1 SET verdict=\?/],
  ['判定：班車清單', /^WITH t AS \(/],
  ['判定：清掃出錯記錄', /^DELETE FROM kv_blobs WHERE k >= \? AND k < \? AND NOT EXISTS \(SELECT 1 FROM bounty_samples s/],
  ['判定：前次列', /FROM bounty_samples s INDEXED BY idx_samples_trip LEFT JOIN json_each\(/],
  ['錢包：餘額', /^SELECT COALESCE\(SUM\(delta\),0\) AS n FROM chip_ledger INDEXED BY idx_chip_ledger_actor_day WHERE actor=\?$/],
  ['錢包：解鎖清單', /FROM garage_unlocks INDEXED BY sqlite_autoindex_garage_unlocks_1 WHERE actor=\? ORDER BY nth/],
  ['雲端搭乘：次數', /FROM cloud_rides INDEXED BY sqlite_autoindex_cloud_rides_1 WHERE actor=\? AND simulator=0/],
  ['合併：撞段扣人數', /FROM bounty_seg_contrib d INDEXED BY idx_seg_contrib_actor WHERE d\.actor=\? AND EXISTS/],
  ['合併：解鎖退款', /FROM garage_unlocks d INDEXED BY sqlite_autoindex_garage_unlocks_1 JOIN garage_unlocks u/],
  ['刪帳號：每段貢獻', /^DELETE FROM bounty_seg_contrib INDEXED BY idx_seg_contrib_actor WHERE actor IN/],
  ['看板：開著的認領人數', /COUNT\(DISTINCT actor\) AS n FROM bounty_claims INDEXED BY idx_claims_expiry/],
];
await attempt('PL', async () => {
  const { sqls, st } = await plCapture();
  ok('PL0 [前提] 每一步都真的走到了：上傳、認領、看板 200；A 那班 ok、B 那班超量 suspect；估值上架 1 個新單位；bounty-me 有首位校正者；' +
    'chips-me、兌換、雲端搭乘與它的重送、合併、刪帳號都 200',
    st.submit === 200 && st.claim === 200 && st.board === 200 && st.fire === 'ok' && st.verdictA === 'ok' && st.verdictB === 'suspect' &&
      JSON.parse(st.valuation).inserted === 1 && st.chipsMe === 200 && st.bountyMe === 200 && Array.isArray(st.firsts) && st.firsts.length > 0 &&
      st.redeem === 200 && st.cloud === 200 && st.cloudResend === 200 && st.merge === 200 && st.del === 200, J(st));
  // PLa：worker.js（整行註解以外）每一處 INDEXED BY 所在的字串片段；片段數必須等於 INDEXED BY 出現的次數（抽取本身沒有漏）。
  const code = readFileSync(join(ROOT, 'worker.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l));
  const frags = [];
  let occurrences = 0;
  for (const l of code) {
    occurrences += (l.match(/INDEXED BY/g) || []).length;
    for (const m of l.matchAll(/'([^']*INDEXED BY[^']*)'|"([^"]*INDEXED BY[^"]*)"|`([^`]*INDEXED BY[^`]*)`/g)) {
      const f = m[1] ?? m[2] ?? m[3];
      for (const part of f.split(/\$\{[^}]*\}/)) for (let k = 0; k < (part.match(/INDEXED BY/g) || []).length; k++) frags.push(part.trim());
    }
  }
  const missed = [...new Set(frags)].filter(f => !sqls.some(s => s.includes(f)));
  ok(`PLa 覆蓋：worker.js 每一處 INDEXED BY（${occurrences} 處）所在的片段都被攔到過——沒攔到的那一句，下面三條對它失明`,
    occurrences > 0 && frags.length === occurrences && missed.length === 0, J({ occurrences, frags: frags.length, missed }));
  // PLb：碰到六張表的每一句
  const grow = sqls.filter(touchesGrow);
  const DB0 = plDb(null), DBS = Object.fromEntries(Object.entries(PL_SHAPES).map(([k, f]) => [k, plDb(f)]));
  const unstable = [], scans = [], errs = [];
  for (const sql of grow) {
    const p0 = plPlan(DB0, sql);
    if (p0.some(l => l.startsWith('ERR'))) errs.push({ sql: sql.slice(0, 120), p0 });
    const sc = growScans(sql, p0);
    if (sc.length) scans.push({ sql: sql.slice(0, 120), sc });
    for (const [k, db] of Object.entries(DBS)) { const p = plPlan(db, sql); if (J(p) !== J(p0)) unstable.push({ shape: k, sql: sql.slice(0, 120), p0, p }); }
  }
  ok(`PLb 穩定：碰到六張表的 ${grow.length} 句，在 ${Object.keys(PL_SHAPES).length} 種統計形狀（${Object.keys(PL_SHAPES).join('、')}）下的計畫都與沒有統計時逐行相同；` +
    '沒有統計時也沒有一句掃六張表的全表（含 USING COVERING INDEX 的整個索引掃描）',
    grow.length > 0 && errs.length === 0 && scans.length === 0 && unstable.length === 0, J({ n: grow.length, errs, scans, unstable: unstable.slice(0, 4) }));
  // PLc：指名
  const lack = PL_PINS.filter(([, re, n = 1]) => sqls.filter(s => re.test(s)).length < n).map(([name]) => name);
  ok(`PLc 指名：${PL_PINS.length} 族句子寫的是指定的索引（INDEXED BY 被拿掉、或改指別的索引，那一族就找不到）`, lack.length === 0, J(lack));
  // PLc2：反方向——攔到的句子裡每一句寫了 INDEXED BY 的都歸在某一族。新加的 INDEXED BY 沒補族名、或 PL_PINS 被刪空時，PLc 會空轉成綠。
  const unnamed = sqls.filter(s => s.includes('INDEXED BY') && !PL_PINS.some(([, re]) => re.test(s)));
  ok('PLc2 指名的覆蓋：攔到的每一句寫了 INDEXED BY 的句子都屬於 PL_PINS 的某一族（沒有族名的那一句，改掉它指名的索引 PLc 也看不出來）',
    sqls.some(s => s.includes('INDEXED BY')) && unnamed.length === 0, J(unnamed.map(s => s.slice(0, 120))));
  // PLd：對照。同一份統計下把每一句的 INDEXED BY 全部拿掉：指名的幾句至少在一種形狀下計畫會變（或掃全表）；
  // 另外至少一句被判成「掃六張表的全表」——證明 growScans 認得出掃描（不然 PLb 的「沒有全表掃描」是空的）。
  const strip = s => s.replace(/ INDEXED BY \w+/g, '');
  const flips = (sql) => Object.entries(DBS).filter(([, db]) => { const p = plPlan(db, strip(sql)); return J(p) !== J(plPlan(DB0, sql)) || growScans(sql, p).length > 0; }).map(([k]) => k);
  const ctrl = PL_CTRL.map(([name, re]) => { const s = grow.find(x => re.test(x)); return { name, sql: s || '', found: !!s, flips: s ? flips(s) : [] }; });
  const scanSeen = grow.filter(s => s.includes('INDEXED BY')).some(s => Object.values(DBS).some(db => growScans(s, plPlan(db, strip(s))).length > 0));
  ok(`PLd [對照] 同一份統計下把 INDEXED BY 拿掉：${PL_CTRL.length} 句指名的句子都至少在一種形狀下計畫會變；而且看得到「掃六張表的全表」（PLb 的掃描偵測不是空的）`,
    ctrl.every(c => c.found && c.flips.length > 0) && scanSeen, J({ scanSeen, ctrl: ctrl.filter(c => !c.found || !c.flips.length).map(c => ({ name: c.name, found: c.found, flips: c.flips })) }));
  // PLd2：對照要涵蓋六張表的每一張——某張表沒有一句會翻，那張表上的 PLb 綠燈就沒有證據說明統計真的偏得動它（PL_CTRL 被刪空時 PLd 也會空轉成綠）。
  const noCtrl = GROW6.filter(t => !ctrl.some(c => c.found && c.flips.length > 0 && new RegExp(`\\b${t}\\b`).test(c.sql)));
  ok('PLd2 [對照的覆蓋] 六張表每一張都至少有一句對照在拿掉 INDEXED BY 後計畫會變', noCtrl.length === 0, J(noCtrl));
});

// ═══ PH：同一秒的點（第五輪獨立驗收）══════════════════════════════════════════════
// 上傳端把 t 取整到秒；舊版防偽閘第三重對 dt≤0 的點直接跳過，「整條線每個站間兩點、全部同一個 t」判 ok、全線覆蓋。
// 這裡走真的上傳端點再跑判定（逐點的邊界在 verify_bounty_gates.mjs 的 F11–F16）。
await attempt('PH1', async () => {
  const A = 'dev-ph1-000001';
  const w = world({ seed: boardSql('山線') });
  const same = [];
  for (let k = 0; k < 10; k++) for (const dd of [100, 1900]) same.push({ d: k * 2000 + dd, t: 30000, v: 20, acc: 5 });
  const r = await submit(w, A, { trainNo: 'P1', samples: same });
  const st = await w.cron();
  ok('PH1 [第五輪] 整條線的點全部同一個 t（走上傳端點）：判 suspect（impossible_physics）——不給點、不推 sample_count、不入帳籌碼（舊版判 ok）',
    r.status === 200 && q.verdicts(w, A, 'P1') === 'suspect' && q.rejects(w, A, 'P1') === 'impossible_physics' && !(q.points(w, A) > 0) &&
      J(q.sampleCounts(w, '山線')) === J(Array(9).fill(0)) && q.count(w, 'chip_ledger', 'actor=?', A) === 0 && st.suspect === 1,
    J({ up: r.status, v: q.verdicts(w, A, 'P1'), rej: q.rejects(w, A, 'P1'), points: q.points(w, A), sc: q.sampleCounts(w, '山線'), suspect: st.suspect }));
});

// ═══ PH2／PH3（第六輪）：t 取整到秒之後，誠實錄程不能被物理檢查誤殺；偽造軌跡的長期速度釘在上限以內。走真的上傳端點與判定 cron。
// App 的錄程照 index.html：定位回呼約每秒一次（相位 0.93 秒、抖動 ±80 ms）、900 ms 節流、t 取 floor 到秒（nowSecOfDay）、
// 沒有都卜勒速度送 null（上傳端存成 0）、d 取到 0.1 m。車：台鐵 130 km/h（36.1 m/s）巡航，在 S5（10 km）以 0.8 m/s² 減速、停 30 秒（回報速度 0）、
// 0.6 m/s² 起步，開到 19.9 km。GPS 雜訊：慢變偏移 σ4 m（時間常數 5 秒）＋白雜訊 σ1.5 m；每 97 秒一次回呼晚 150 ms（多半讓下一次被節流丟掉＝漏一次回呼）；
// 一成的點沒有都卜勒速度。固定亂數種子。reverse＝同一趟倒過來走（dir 1，里程遞減）。
function appTrip(seed, reverse = false) {
  let s = seed;
  const rnd = () => { s = s + 0x6D2B79F5 | 0; let x = Math.imul(s ^ s >>> 15, 1 | s); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const V = 36.1, dA = 10000 - V * V / 1.6, tA = (dA - 100) / V, tB = V / 0.8, tD = V / 0.6;
  const at = T => {                                           // 真實時刻 T（秒）→ [里程, 速度]
    if (T < tA) return [100 + V * T, V];
    if ((T -= tA) < tB) return [dA + V * T - 0.4 * T * T, V - 0.8 * T];
    if ((T -= tB) < 30) return [10000, 0];
    if ((T -= 30) < tD) return [10000 + 0.3 * T * T, 0.6 * T];
    return [10000 + 0.3 * tD * tD + V * (T - tD), V];
  };
  const end = tA + tB + 30 + tD + (19900 - 10000 - 0.3 * tD * tD) / V;
  const pts = []; let last = -Infinity, e = 0; const rho = Math.exp(-1 / 5);
  for (let k = 0; k < end; k++) {
    e = rho * e + Math.sqrt(1 - rho * rho) * 4 * gauss();
    const T = k + 0.93 + (rnd() * 2 - 1) * 0.08 + (k % 97 === 40 ? 0.15 : 0);
    const noise = e + gauss() * 1.5, vr = gauss() * 0.3, miss = rnd() < 0.1;
    if (T > end || T - last < 0.9) continue;
    last = T;
    const [d, v] = at(T), dm = d + noise;
    pts.push({ d: Math.round((reverse ? 20000 - dm : dm) * 10) / 10, t: 30000 + Math.floor(T),
      v: miss ? null : v === 0 ? 0 : Math.round(Math.max(0, v + vr) * 100) / 100, acc: 8 + Math.floor(rnd() * 5) });
  }
  return pts;
}
await attempt('PH2', async () => {
  const A = 'dev-ph2-00000A', B = 'dev-ph2-00000B';
  const w = world({ seed: boardSql('山線') });
  const up = async (actor, trainNo, dir, pts) => { const out = [];
    for (let k = 0; k * 60 < pts.length; k++) out.push((await submit(w, actor, { trainNo, dir, samples: pts.slice(k * 60, k * 60 + 60), requestId: `ph2-${trainNo}-${k}` })).status);
    return out; };
  const fwd = appTrip(20260930), rev = appTrip(20260930, true);
  const miss1 = pts => pts.filter((p, i) => i && p.t - pts[i - 1].t === 1 && Math.abs(p.d - pts[i - 1].d) > 41.63).length;
  const shape = pts => ({ n: pts.length, over1: miss1(pts), nulls: pts.filter(p => p.v === null).length, zeros: pts.filter(p => p.v === 0).length });
  const ups = [...await up(A, 'P2', 0, fwd), ...await up(B, 'P2', 1, rev)];
  const st = await w.cron();
  ok('PH2 [第六輪] App 形狀的誠實錄程（130 km/h、t 取 floor 到秒、900 ms 節流、漏回呼、GPS 雜訊、站停回報 0、一成沒有速度）兩個方向都判 ok；' +
    '場景有牙：Δt＝1 而位移超過 41.63 m 的相鄰兩點兩趟都有（第五輪版會判 impossible_physics）',
    ups.every(x => x === 200) && q.verdicts(w, A, 'P2') === 'ok' && q.verdicts(w, B, 'P2') === 'ok' && st.suspect === 0 &&
      miss1(fwd) > 0 && miss1(rev) > 0 && shape(fwd).nulls > 0 && shape(fwd).zeros > 0,
    J({ ups: [...new Set(ups)], v: [q.verdicts(w, A, 'P2'), q.verdicts(w, B, 'P2')], rej: [q.rejects(w, A, 'P2'), q.rejects(w, B, 'P2')], st: { ok: st.ok, suspect: st.suspect, unusable: st.unusable },
      fwd: shape(fwd), rev: shape(rev) }));
});
await attempt('PH3', async () => {
  // 一秒兩點、每秒前進 82.26 m（台鐵上限×1.15＝41.63 的兩倍少 1：第五輪版逐對都貼著上限、判 ok）→ 判 suspect（impossible_physics）。兩個方向。
  const A = 'dev-ph3-00000A', B = 'dev-ph3-00000B';
  const w = world({ seed: boardSql('山線') });
  const two = Array.from({ length: 482 }, (_, i) => ({ d: Math.round((100 + Math.floor(i / 2) * 82.26 + (i % 2) * 41.13) * 10) / 10, t: 30000 + Math.floor(i / 2), v: 30, acc: 5 }));
  const r = [await submit(w, A, { trainNo: 'P3', samples: two }), await submit(w, B, { trainNo: 'P3', dir: 1, samples: two.map(p => ({ ...p, d: Math.round((20000 - p.d) * 10) / 10 })) })];
  const st = await w.cron();
  ok('PH3 [第六輪] 一秒兩點、每秒前進 82 m 的偽造軌跡（走上傳端點）：兩個方向都判 suspect（impossible_physics）——不給點、不推 sample_count',
    r.every(x => x.status === 200) && [A, B].every(a => q.verdicts(w, a, 'P3') === 'suspect' && q.rejects(w, a, 'P3') === 'impossible_physics' && !(q.points(w, a) > 0)) &&
      J(q.sampleCounts(w, '山線')) === J(Array(9).fill(0)) && st.suspect === 2,
    J({ up: r.map(x => x.status), v: [A, B].map(a => q.verdicts(w, a, 'P3')), rej: [A, B].map(a => q.rejects(w, a, 'P3')), sc: q.sampleCounts(w, '山線'), suspect: st.suspect }));
});

// ═══ SK：合併時出錯記錄跟著改名（第四、五輪獨立驗收的殘留）═══════════════════════════════
// 舊版合併只把樣本改名到帳號，出錯記錄的鍵（前綴＋actor|乘車日|車次）還掛在裝置上，下一發開頭的清掃就把它刪掉（那班車已經沒有裝置名下的 pending），
// 出錯次數等於歸零。期望：裝置的每一把改名到帳號、值不變；帳號已有同一班的記錄時留次數大的那份；裝置名下一把不剩；壞值照搬、合併不丟錯；
// 下一發清單裡那班車（已掛在帳號名下）仍是錯滿 2 次（struck）。守衛 G：來源已併進別人時一把都不動。
await attempt('SK', async () => {
  const U = 'uid-sk-00000U', D = 'dev-sk-000000D', X = 'uid-sk-00000X', V = 'dev-sk-000000V';
  const kv = (k, v) => `INSERT INTO kv_blobs (k,v,updated) VALUES ('${k}','${v}','x');`;
  const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null], [X, X, 0, null], [V, null, 0, X]]) +
    kv(STRIKE(D, 'K1'), '{"at":1,"error":"d1","n":2}') + kv(STRIKE(D, 'K3'), '{"at":1,"error":"d3","n":1}') + kv(STRIKE(D, 'K5'), '{"at":1,"error":"d5","n":3}') +
    kv(STRIKE(D, 'K6'), 'not-json') + kv(STRIKE(U, 'K3'), '{"at":2,"error":"u3","n":3}') + kv(STRIKE(U, 'K5'), '{"at":2,"error":"u5","n":1}') +
    kv(STRIKE(U, 'K4'), '{"at":2,"error":"u4","n":1}') + kv(STRIKE(V, 'K1'), '{"at":3,"error":"v1","n":2}') + kv(STRIKE(V, 'K7'), '{"at":3,"error":"v7","n":1}') +
    // 第六輪 S5：前綴相近的別的裝置（D 後面多一個字元：字母、底線、連字號——比「|」小，鍵範圍放寬一點就會被掃進去）；S6：撞同一班、次數相同（K8）
    kv(STRIKE(D + 'A', 'K1'), '{"at":4,"error":"pa","n":1}') + kv(STRIKE(D + '_', 'K2'), '{"at":4,"error":"pu","n":1}') + kv(STRIKE(D + '-', 'K3'), '{"at":4,"error":"pm","n":1}') +
    kv(STRIKE(D, 'K8'), '{"at":1,"error":"d8","n":2}') + kv(STRIKE(U, 'K8'), '{"at":2,"error":"u8","n":2}'),
    env: { BOUNTY_VERIFY_ORDER: 'fixed' } });
  bulk(w.db, [...['K1', 'K3', 'K5', 'K6'].map(t => ({ actor: D, trainNo: t, pts: TINY })), ...['K3', 'K4', 'K5'].map(t => ({ actor: U, trainNo: t, pts: TINY })),
    { actor: V, trainNo: 'K1', pts: TINY }, { actor: V, trainNo: 'K7', pts: TINY }]);
  const m = await merge(w, D, U);
  const got = Object.fromEntries(strikes(w).map(r => [r.k, r.v]));
  const want = { [STRIKE(U, 'K1')]: '{"at":1,"error":"d1","n":2}', [STRIKE(U, 'K3')]: '{"at":2,"error":"u3","n":3}', [STRIKE(U, 'K4')]: '{"at":2,"error":"u4","n":1}',
    [STRIKE(U, 'K5')]: '{"at":1,"error":"d5","n":3}', [STRIKE(U, 'K6')]: 'not-json', [STRIKE(V, 'K1')]: '{"at":3,"error":"v1","n":2}',
    [STRIKE(V, 'K7')]: '{"at":3,"error":"v7","n":1}', [STRIKE(D + 'A', 'K1')]: '{"at":4,"error":"pa","n":1}', [STRIKE(D + '_', 'K2')]: '{"at":4,"error":"pu","n":1}',
    [STRIKE(D + '-', 'K3')]: '{"at":4,"error":"pm","n":1}', [STRIKE(U, 'K8')]: '{"at":2,"error":"u8","n":2}' };
  ok('SKa [第四、五輪 殘留；第六輪 S5／S6] 裝置併進帳號：出錯記錄逐把改名到帳號、值不變；撞同一班留次數大的（K3 留帳號的 3、K5 留裝置的 3），次數相同留帳號那份（K8）；' +
    '壞值照搬；裝置名下一把不剩；前綴相近的三個裝置（D 後面多一個 A、_、-）原地不動',
    m.status === 200 && J(Object.keys(got).sort()) === J(Object.keys(want).sort()) && Object.entries(want).every(([k, v]) => got[k] === v),
    J({ m: m.status, got }));
  const m2 = await merge(w, V, U);
  // V 的 K7 帳號名下沒有：改名那一句（INSERT…SELECT）漏了守衛的話會多出 U|K7（K1 跟帳號撞、n 相同，照不到；第八批 突變 merge_strike_no_G 存活後補）。
  ok('SKb 守衛 G：來源已併進別人（V → X）→ 409，V 的出錯記錄原地不動（K1、K7）、帳號名下沒有多出 V 的那一班（K7）',
    m2.status === 409 && strikes(w).some(r => r.k === STRIKE(V, 'K1')) && strikes(w).some(r => r.k === STRIKE(V, 'K7')) &&
      !strikes(w).some(r => r.k === STRIKE(U, 'K7')) && J(Object.fromEntries(strikes(w).map(r => [r.k, r.v]))) === J(got),
    J({ m2: m2.text }));
  const seen = [];
  spyRows(w.DELAY_DB, (sql, rs) => { if (LIST_RE.test(sql)) seen.push(rs.map(r => ({ actor: String(r.actor), train: String(r.train_no), struck: Number(r.struck), strikes: Number(r.strikes) }))); });
  await w.cron({ BOUNTY_SUBREQ_BUDGET: '1' });
  const k1 = (seen[0] || []).find(r => r.actor === U && r.train === 'K1');
  ok('SKc 下一發的清單裡，那班車（樣本已掛在帳號名下）仍是錯滿 2 次（struck）——清掃沒有把改名後的記錄刪掉（舊版這裡是 0 次）',
    !!k1 && k1.strikes === 2 && k1.struck === 1 && strikes(w).some(r => r.k === STRIKE(U, 'K1')), J({ k1, list: (seen[0] || []).length }));
});

// ═══ M3：兌換的交易內餘額守衛（邊界）════════════════════════════════════════════
// 讀完餘額之後、寫入之前，別的動作扣掉 1 顆（注入點：兌換的 batch 送出之前）。第一座 4 顆。
async function redeemDrained(A, seed, drain) {
  const w = world({ seed: ledgerSql(A, 'adjust', seed, `${A}-seed`) });
  const DB = w.DELAY_DB;
  let fired = 0;
  w.env.DELAY_DB = { prepare: s => DB.prepare(s), exec: s => DB.exec(s),
    batch: async stmts => { if (!fired++) w.db.exec(ledgerSql(A, 'adjust', -drain, `${A}-drain`)); return DB.batch(stmts); } };
  const r = await redeem(w, A, 'south-coast', 'req-' + A);
  return { w, r, fired };
}
await attempt('M3a', async () => {
  const A = 'dev-m3a-00001';
  const { w, r, fired } = await redeemDrained(A, 4, 1);
  ok('M3a [M3] 讀到餘額 4（剛好夠第一座 4）、寫入前被扣到 3 → 不能寫出負餘額：409 not_enough {cost 4, balance 3}；沒有解鎖、沒有 redeem 帳',
    fired >= 1 && r.status === 409 && J(r.json) === J({ error: 'not_enough', cost: 4, balance: 3 }) && q.bal(w, A) === 3 &&
      q.count(w, 'garage_unlocks') === 0 && q.count(w, 'chip_ledger', "kind='redeem'") === 0, J({ r: r.text, bal: q.bal(w, A) }));
});
await attempt('M3b', async () => {
  const A = 'dev-m3b-00001';
  const { w, r } = await redeemDrained(A, 5, 1);
  ok('M3b [M3 邊界] 讀到 5、寫入前被扣到 4（仍＝價格）→ 守衛是「≥」：200 {nth 1, cost 4, balance 0}，恰一列解鎖',
    r.status === 200 && r.json.nth === 1 && r.json.cost === 4 && r.json.balance === 0 && q.bal(w, A) === 0 && q.count(w, 'garage_unlocks', 'actor=?', A) === 1,
    J({ r: r.text, bal: q.bal(w, A) }));
});

// ═══ M5b：刪帳號時 deviceActor 已併進別的帳號 ════════════════════════════════════════
// X 刪自己的帳號；body 的 deviceActor 填的是「已經併進 W 的裝置 DW」→ DW 名下的樣本、認領、點數列一個字都不能動。
// 正向對照（review-B B8 的既定行為）：填的是「還沒併進任何帳號的裝置 DN」→ DN 的 v1 樣本與認領、點數列會刪掉。
const m5bWorld = () => {
  const X = 'uid-m5b-0000X', W = 'uid-m5b-0000W', DW = 'dev-m5b-0000DW', DN = 'dev-m5b-0000DN', DX = 'dev-m5b-0000DX';
  const w = world({ seed: pointsSql([[X, X, 3, null], [W, W, 7, null], [DW, null, 0, W], [DN, null, 2, null], [DX, null, 0, X]]) +
    claimSql({ id: 'm5b-cw', actor: DW, seg: KT('山線', 'S0|S1'), pts: 3 }) + claimSql({ id: 'm5b-cn', actor: DN, seg: KT('山線', 'S0|S1'), pts: 3 }) +
    claimSql({ id: 'm5b-cx', actor: DX, seg: KT('山線', 'S0|S1'), pts: 3 }) });
  for (const [a, n] of [[DW, 2], [DN, 2], [DX, 1], [X, 1]]) putBatches(w.db, { actor: a, trainNo: 'P1', pts: leg({ sec: 200 * n - 1 }) });   // n 批
  return { w, X, W, DW, DN, DX };
};
const v1Of = (w, a) => J({ samples: q.count(w, 'bounty_samples', 'actor=?', a), claims: q.count(w, 'bounty_claims', 'actor=?', a), point: q.point(w, a) });
await attempt('M5b', async () => {
  const { w, X, W, DW } = m5bWorld();
  const before = [v1Of(w, DW), v1Of(w, W)];
  const del = await delAccount(w, { actor: DW }, X);
  ok('M5b1 [M5b] X 刪帳號、body 帶「已併進 W 的裝置 DW」→ 200；DW 的樣本 2 列、認領 1 列、點數列（併進 W）與 W 自己都原封不動',
    del.status === 200 && J([v1Of(w, DW), v1Of(w, W)]) === J(before) && JSON.parse(before[0]).samples === 2,
    J({ del: del.json, dw: v1Of(w, DW) }));
  ok('M5b2 回應如實：樣本 2（X 1＋併進 X 的 DX 1）、認領 1（DX）、點數列 2（X、DX）',
    del.json && J({ s: del.json.deleted.samples, c: del.json.deleted.claims, p: del.json.deleted.points }) === J({ s: 2, c: 1, p: 2 }), J(del.json));
});
await attempt('M5b3', async () => {
  const { w, X, DN } = m5bWorld();
  const del = await delAccount(w, { actor: DN }, X);
  ok('M5b3 [對照 B8] body 帶「還沒併進任何帳號的裝置 DN」→ DN 的樣本、認領、點數列都刪了；回應 樣本 4、認領 2、點數列 3',
    del.status === 200 && v1Of(w, DN) === J({ samples: 0, claims: 0, point: null }) &&
      J({ s: del.json.deleted.samples, c: del.json.deleted.claims, p: del.json.deleted.points }) === J({ s: 4, c: 2, p: 3 }),
    J({ del: del.json, dn: v1Of(w, DN) }));
});

// ═══ B4e：刪帳號一起刪出錯記錄（第二輪 B4e）═══════════════════════════════════════════════
await attempt('B4e', async () => {
  // m5bWorld 的身分：X（要刪的帳號）、DX（併進 X 的裝置）、DN（還沒併進任何帳號的裝置，body 帶它）、W（別人的帳號）、DW（併進 W 的裝置）。
  // 每個身分各一列出錯記錄。期望：X、DX、DN 的刪掉；W、DW 的留著。回應的欄位不變（出錯記錄只刪不回報）。
  const { w, X, W, DW, DN, DX } = m5bWorld();
  w.db.exec('INSERT INTO kv_blobs (k,v,updated) VALUES ' + [X, DX, DN, W, DW].map(a => `('${STRIKE(a, 'P1')}','{"at":1,"error":"x","n":1}','x')`).join(',') + ';');
  const del = await delAccount(w, { actor: DN }, X);
  const left = strikes(w).map(r => r.k);
  ok('B4ea [第二輪 B4e] 刪帳號 X（body 帶裝置 DN）：X、併進 X 的 DX、DN 的出錯記錄都刪掉；別人的帳號 W 與併進 W 的 DW 的留著；回應的欄位與以前相同',
    del.status === 200 && J(left) === J([STRIKE(DW, 'P1'), STRIKE(W, 'P1')].sort()) &&
      J(Object.keys(del.json.deleted).sort()) === J(['chips', 'claims', 'cloudRides', 'contrib', 'points', 'samples', 'unlocks']),
    J({ status: del.status, left, deleted: del.json && del.json.deleted }));
  const { w: w2, X: X2, DW: DW2 } = m5bWorld();
  w2.db.exec(`INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(DW2, 'P1')}','{"at":1,"error":"x","n":1}','x');`);
  const del2 = await delAccount(w2, { actor: DW2 }, X2);
  ok('B4eb [第二輪 B4e 對照 M5b] body 帶「已併進別人（W）的裝置 DW」：它的出錯記錄不刪', del2.status === 200 && strikes(w2).length === 1, J({ status: del2.status, sk: strikes(w2) }));
});

// ═══ PF：第十一批——防偽閘丟掉／不收的點不進覆蓋率；跨午夜的班車照整班長度發籌碼（端到端，走真的判定 cron）══════════════
// 規則（期望值照規則手算，不呼叫實作）：防偽閘第三重逐點比「已收下的點」，違反往前（任兩點）／往後／加速度的點丟掉、不判整班；
// 開頭與每個 Δt≥10 秒的斷點之後的前 2 點不收。被丟、不收的點不能再拿去算覆蓋率——否則在任一段丟兩個點就能刷覆蓋（V7 的但書）。
// 覆蓋的定義（worker 的 coverageOf；這裡獨立再寫一次當對照）：區間 [lo, hi] 裡至少 2 點、(最大 − 最小)／區間長 ≥ segCoverageMin（0.6）。
const coversKm = (pts, loKm, hiKm) => {
  const ds = pts.map(p => p.d / 1000).filter(d => d >= loKm && d <= hiKm);
  return ds.length >= 2 && (Math.max(...ds) - Math.min(...ds)) / (hiKm - loKm) >= RULES.quality.segCoverageMin;
};
const segsOf = (w, actor, trainNo) => [...new Set(rows(w, 'SELECT segs FROM bounty_samples WHERE actor=? AND train_no=?', actor, trainNo)
  .flatMap(r => JSON.parse(r.segs || '[]').map(c => c.key)))].sort();
await attempt('PF1', async () => {
  // 誠實的一趟：山線 0 → 6 km（20 m/s、300 秒）＝ S0|S1、S1|S2、S2|S3。另外兩種「刷 S8|S9（16–18 km）」的手法：
  //   a 孤立的遠點：第 100、200 秒各換成 16.1 km、17.9 km 的一點（比當時的位置往前十幾公里，違反任兩點的上界 → 不收；丟 2 點＜預算 5）；
  //   b 斷點後不收的點：第 150 秒後斷 12 秒，出來的頭兩點放在 16.1、17.9 km（不收、不比），之後回到原位置繼續（停了 14 秒）。
  // 期望：兩趟都判 ok、存下的覆蓋段只有 S0|S1…S2|S3、每人登記 3 段、S8|S9 的 sample_count 仍是 0。
  // 對照：原始的點照覆蓋的定義算，S8|S9 是蓋到的（1.8／2＝0.9 ≥ 0.6）——判定端若拿原始的點算覆蓋，這兩趟就刷到了。
  const base = leg({ sec: 300 });
  const spikeA = base.map((p, i) => i === 100 ? { ...p, d: 16100 } : i === 200 ? { ...p, d: 17900 } : p);
  const gapB = [...base.slice(0, 151), { ...base[150], t: base[150].t + 12, d: 16100 }, { ...base[150], t: base[150].t + 13, d: 17900 },
    ...base.slice(151).map(p => ({ ...p, t: p.t + 13 }))];
  const A = 'dev-pf1-a0001', B = 'dev-pf1-b0001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'PFA', pts: spikeA });
  putBatches(w.db, { actor: B, trainNo: 'PFB', pts: gapB });
  await w.cron();
  const want = J(['S0|S1', 'S1|S2', 'S2|S3'].map(x => KT('山線', x)));
  const res = { a: [q.verdicts(w, A, 'PFA'), segsOf(w, A, 'PFA'), q.contrib(w, A)], b: [q.verdicts(w, B, 'PFB'), segsOf(w, B, 'PFB'), q.contrib(w, B)],
    s89: one(w, 'SELECT sample_count c FROM bounty_board WHERE seg_key=?', KT('山線', 'S8|S9')).c, raw: [coversKm(spikeA, 16, 18), coversKm(gapB, 16, 18)] };
  ok('PF1 [第十一批 V7] 不收的點不算覆蓋：孤立的遠點、斷點後的頭兩點都放在 S8|S9 → 兩趟都 ok、存下的覆蓋段只有 S0|S1…S2|S3、各登記 3 段、S8|S9 的 sample_count 0（對照：原始的點照覆蓋的定義蓋得到 S8|S9）',
    res.raw.every(Boolean) && [res.a, res.b].every(([v, segs, c]) => v === 'ok' && J(segs) === want && c === 3) && res.s89 === 0, J(res));
});
await attempt('PF2', async () => {
  // 不收的點也不能拿去過品質閘：品質閘的「至少一段覆蓋 ≥ 0.6」同樣只看收下的點。否則一趟完全沒動的錄程（停在 S0 旁 700 秒），
  // 斷 12 秒後塞兩個不收的點（2.1、3.9 km，S1|S2 的兩端），品質閘拿原始的點就會看到 S1|S2 蓋到 0.9 → 判 ok → 長度 700 多秒發 1 顆。
  // 期望：unusable（too_short：收下的點一段都沒蓋到）、0 顆、存下的覆蓋段是空的。對照：原始的點照覆蓋的定義蓋得到 S1|S2。
  const A = 'dev-pf2-a0001';
  const still = Array.from({ length: 700 }, (_, k) => ({ d: 5, t: 30000 + k, v: 0, acc: 8 }));
  const pts = [...still, { d: 2100, t: 30711, v: 0, acc: 8 }, { d: 3900, t: 30712, v: 0, acc: 8 },
    ...Array.from({ length: 10 }, (_, k) => ({ d: 5, t: 30713 + k, v: 0, acc: 8 }))];
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'PF2', pts });
  await w.cron();
  const res = { v: q.verdicts(w, A, 'PF2'), code: one(w, 'SELECT DISTINCT quality_code c FROM bounty_samples WHERE actor=?', A).c,
    segs: segsOf(w, A, 'PF2'), trips: q.trips(w), raw: coversKm(pts, 2, 4) };
  ok('PF2 [第十一批 V7] 不收的點不能讓一趟過品質閘：停著不動＋斷點後兩個不收的點（S1|S2 兩端）→ unusable（too_short）、0 顆、覆蓋段空（對照：原始的點蓋得到 S1|S2）',
    res.raw && res.v === 'unusable' && res.code === 'too_short' && res.segs.length === 0 && res.trips.length === 0, J(res));
});
await attempt('PF3', async () => {
  // 跨午夜：App 的 t 是當天第幾秒、午夜歸零；乘車日是開始錄的那一天。規則：同一組點的 t 最大減最小超過半天＝跨午夜，小於半天的 t 加一天；
  // 前後兩發判的兩段合起來再認一次（整班長度＝合起來的最晚 − 最早）。山線 20 m/s，籌碼門檻 600 秒、山線不是偏遠線（×1）。
  //   a 一次上傳：t 86000–86399（午夜前 400 點）＋ 0–300 → 700 秒 → ok、1 顆（沒認午夜的話防偽閘整班判死，見 gates F30b）。
  //   b 兩發：先只有午夜前 86000–86399（0 顆），後一發午夜後 0–300 → 合起來 700 秒 → 補 1 顆。
  //   c 兩發：午夜前 86200–86399 ＋午夜後 0–300 → 500 秒 → 0 顆（合起來沒再認一次午夜的話，會算成 0–86399＝86399 秒、發 1 顆）。
  //   d 前一發本身就跨午夜（86000–86399 ＋ 0–100，500 秒、0 顆），後一發 101–300 → 700 秒 → 1 顆
  //     （前次組要用 u0／u1：拿原始的最早 0、最晚 86399，合起來再認午夜會變成 86399–86700＝301 秒、0 顆）。
  //   e 清晨的趟（t 1000–1700，700 秒）不受影響 → 1 顆。
  const mid = (k0, k1) => Array.from({ length: k1 - k0 + 1 }, (_, j) => {
    const k = k0 + j;
    return { d: k * 20, t: k < 400 ? 86000 + k : k - 400, v: 20 + Math.sin(k / 7) * 0.6, acc: 8 };
  });
  const run = async (actor, phases) => {
    const w = world({ seed: boardSql('山線') });
    for (const [i, pts] of phases.entries()) {
      putBatches(w.db, { actor, trainNo: 'PF3', pts, first: i * 100 });
      await w.cron(i ? { BOUNTY_NOW: String(NOW_MS + i * 3600e3) } : {});
    }
    return { v: q.verdicts(w, actor, 'PF3'), trips: q.trips(w) };
  };
  const got = {
    a: await run('dev-pf3-a0001', [mid(0, 700)]),
    b: await run('dev-pf3-b0001', [mid(0, 399), mid(400, 700)]),
    c: await run('dev-pf3-c0001', [mid(200, 399), mid(400, 700)]),
    d: await run('dev-pf3-d0001', [mid(0, 500), mid(501, 700)]),
    e: await run('dev-pf3-e0001', [leg({ sec: 700, t0: 1000 })]),
  };
  const oneChip = a => J([{ actor: a, delta: 1, ref: `${a}|${D28}|PF3`, day: D28 }]);
  ok('PF3a [第十一批 V7 B(2)] 跨午夜一次上傳（86000–86399＋0–300，700 秒）→ ok、1 顆',
    got.a.v === 'ok' && J(got.a.trips) === oneChip('dev-pf3-a0001'), J(got.a));
  ok('PF3b 跨午夜分兩發（午夜前 400 秒先判、0 顆；午夜後 300 秒後判）→ 合起來 700 秒、補 1 顆',
    got.b.v === 'ok' && J(got.b.trips) === oneChip('dev-pf3-b0001'), J(got.b));
  ok('PF3c 跨午夜分兩發、合起來只有 500 秒 → 0 顆（兩段合起來要再認一次午夜，不然會算成 86399 秒）',
    got.c.v === 'ok' && got.c.trips.length === 0, J(got.c));
  ok('PF3d 前一發本身就跨午夜（500 秒、0 顆）、後一發 200 秒 → 合起來 700 秒、1 顆（前次組用 u0／u1）',
    got.d.v === 'ok' && J(got.d.trips) === oneChip('dev-pf3-d0001'), J(got.d));
  ok('PF3e 對照：清晨的趟（t 1000–1700，700 秒）不受午夜規則影響 → 1 顆',
    got.e.v === 'ok' && J(got.e.trips) === oneChip('dev-pf3-e0001'), J(got.e));
});
await attempt('PF4', async () => {
  // 第十二批：品質閘的斷訊（underground）看原始的點，不看防偽閘收下的點。防偽閘在開頭與每個 Δt≥10 秒的斷點之後不收頭兩點，
  // 斷訊在錄程頭尾時，旁邊那兩點一不收、斷訊就從收下的點裡消失；籌碼的整班長度卻照原始的點算（籌碼門檻 600 秒、山線 ×1）。
  //   a 前面掛兩點：一趟 300 秒的乾淨錄程（本身不到 600 秒），前面多送兩個 1000／999 秒前、同一位置的點 → 原始的點有 999 秒斷訊
  //     → unusable（underground）、0 顆。斷訊若看收下的點：開頭兩點與斷點後兩點都不收、收下的點沒有斷訊 → ok、整班 1300 秒 → 1 顆。
  //   b 後面掛兩點：同一趟、最後一點之後 1000／1001 秒再送兩點 → 同 a（原始的點有 1000 秒斷訊）。
  //   o 對照：那趟 300 秒本身 → ok、0 顆（a、b 的 unusable 來自斷訊，不是錄程本身）。
  //   c 中間的隧道：700 秒錄程在第 350 點之後斷 g 秒（車照 20 m/s 前進）。g＝noFixGapSec → ok、1 顆（整班 699＋g 秒）；
  //     g＝noFixGapSec＋1 → unusable（underground）、0 顆。斷訊若看收下的點，會多算斷點後不收的 2 秒，g＝noFixGapSec 也被判 underground。
  // 夾具自己先驗：四種錄程的原始最大間隔依序是 999、1000、noFixGapSec、noFixGapSec＋1。
  const G = RULES.quality.noFixGapSec;
  const base = leg({ sec: 300 }), last = base[base.length - 1];
  const head = [{ ...base[0], t: base[0].t - 1000 }, { ...base[0], t: base[0].t - 999 }, ...base];
  const tail = [...base, { ...last, t: last.t + 1000 }, { ...last, t: last.t + 1001 }];
  const tunnel = g => leg({ sec: 700 }).map((p, i) => i <= 350 ? p : { ...p, t: p.t + g - 1, d: p.d + (g - 1) * 20 });
  const maxGap = pts => Math.max(...pts.slice(1).map((p, i) => p.t - pts[i].t));
  const A = 'dev-pf4-a0001', B = 'dev-pf4-b0001', O = 'dev-pf4-o0001', C0 = 'dev-pf4-c0001', C1 = 'dev-pf4-c1001';
  const w = world({ seed: boardSql('山線') });
  putBatches(w.db, { actor: A, trainNo: 'PF4a', pts: head });
  putBatches(w.db, { actor: B, trainNo: 'PF4b', pts: tail });
  putBatches(w.db, { actor: O, trainNo: 'PF4o', pts: base });
  putBatches(w.db, { actor: C0, trainNo: 'PF4c', pts: tunnel(G) });
  putBatches(w.db, { actor: C1, trainNo: 'PF4c', pts: tunnel(G + 1) });
  await w.cron();
  const got = (actor, trainNo) => ({ v: q.verdicts(w, actor, trainNo),
    code: rows(w, 'SELECT DISTINCT quality_code c FROM bounty_samples WHERE actor=?', actor).map(r => r.c ?? '-').sort().join(),
    chips: rows(w, "SELECT delta, ref FROM chip_ledger WHERE kind='trip' AND actor=?", actor) });
  const res = { gaps: [head, tail, tunnel(G), tunnel(G + 1)].map(maxGap), a: got(A, 'PF4a'), b: got(B, 'PF4b'), o: got(O, 'PF4o'),
    c0: got(C0, 'PF4c'), c1: got(C1, 'PF4c') };
  const fixture = J(res.gaps) === J([999, 1000, G, G + 1]);
  const under = r => r.v === 'unusable' && r.code === 'underground' && r.chips.length === 0;
  ok('PF4a [第十二批] 斷訊在錄程開頭（1000／999 秒前兩點＋300 秒）→ unusable（underground）、0 顆（看收下的點斷訊會消失、整班 1300 秒發 1 顆）',
    fixture && under(res.a), J({ gaps: res.gaps, a: res.a }));
  ok('PF4b 斷訊在錄程結尾（300 秒＋1000／1001 秒後兩點）→ unusable（underground）、0 顆',
    fixture && under(res.b), J({ gaps: res.gaps, b: res.b }));
  ok('PF4o 對照：同一趟 300 秒本身 → ok、0 顆（不到 600 秒）',
    res.o.v === 'ok' && res.o.code === '-' && res.o.chips.length === 0, J(res.o));
  ok(`PF4c 隧道斷 ${G} 秒（＝noFixGapSec）→ ok、1 顆；斷 ${G + 1} 秒 → unusable（underground）、0 顆（看收下的點會多算不收的 2 秒）`,
    fixture && res.c0.v === 'ok' && res.c0.code === '-' && J(res.c0.chips) === J([{ delta: 1, ref: `${C0}|${D28}|PF4c` }]) && under(res.c1),
    J({ gaps: res.gaps, c0: res.c0, c1: res.c1 }));
});

ok('Z 整支腳本沒有任何非 Firebase 的對外連線', outbound.length === 0, J(outbound.slice(0, 3)));
const bad = R.filter(r => !r.p);
console.log(`\n[SUMMARY] ${R.length - bad.length}/${R.length} 條判準通過${bad.length ? '；未過：' + bad.map(r => r.n.split(' ')[0]).join(',') : ''}`);
process.exitCode = bad.length ? 1 : 0;
