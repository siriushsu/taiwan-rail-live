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
//   C2  合併落在判定途中（讀認領那一刻）：點數、認領都記對人
//   C3  判定途中第 k 次 D1 呼叫失敗（k 全掃）→ 重跑後六張表與一次跑完逐列相同（B7）
//   LS  租約：兩發重疊不重複計點；過期可接手；別人的活租約不碰；只釋放自己那一份
//   R1  一條線組的寫入＝一個 batch、四句（標記、點數、sample_count、關認領），標記一句
//   R2  前次線組只讀最早／最晚時間；超量的車（批數、總長、第一段之後才灌進來）整班可疑、payload 不讀
//   R3  一班車判定出錯：那一行 log 用 error 等級；出錯的班車記下來、同一發繼續判下一班，下一發判得過就刪記錄
//   ISO 記下來的班車之後每一發排在最後（連可信身分也一樣）；D1 整個不能用（連記錄都寫不進去）才停手
//   N4  一班車的點數上看十幾萬（4 MB 塞得下）：判定不把整班的點展開成函式引數（V8 約十二萬多個就丟 RangeError）
//   N2  清單之後才灌進來的批次：讀這班車那一句依讀取順序累加長度截住，送回 Worker 的不超過 4 MB 再加一批，整班判可疑
//   N3  租約被下一發接手之後，舊的那一發第③段整組不動任何列（點數、sample_count、關認領不會做兩次）
//   M3  兌換的交易內餘額守衛的邊界（讀到之後被扣）——review-B Q8 說這一層只有 redeem C6 一條在守
//   M5b 刪帳號時 body 的 deviceActor 若已併進別的帳號，一列不刪——review-B Q8 說這一層只有 auth A11d 一條在守
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
const LOAD_RE = /^SELECT \* FROM \(SELECT \*, SUM\(length\(payload\)\) OVER/;   // 第二段：讀一班車（依讀取順序累加長度截住，見 N2）
const PRIOR_RE = /verdict <> 'pending'/;                                  // 前次線組
const MARK_RE = /^UPDATE bounty_samples SET verdict=\?/;                  // 標記已判定
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
  ok('B4b3 不帶 Bearer（App 的錄程上傳、網頁的認領都不帶）：照舊 200、記在 A（樣本 2 列、認領 18 列）',
    s3.status === 200 && c3.status === 200 && q.count(w, 'bounty_samples', 'actor=?', A) === 2 && q.count(w, 'bounty_claims', 'actor=?', A) === 18,
    J([s3.text, c3.text]));
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
  const h = hookOnce(w.DELAY_DB, /FROM bounty_claims WHERE actor=COALESCE/, async () => { mst = (await merge(w, DEV, UID)).status; });
  await w.cron();
  const cl = one(w, "SELECT actor,status FROM bounty_claims WHERE id='claim-c2'");
  ok('C2 [B7 競態] 合併落在讀認領之前：UID 27 點、認領 {UID, fulfilled}、DEV 墓碑 0 點；籌碼 1 顆與登記 7 段在 UID、DEV 名下 0',
    h.fired >= 1 && mst === 200 && q.points(w, UID) === 27 && J(q.point(w, DEV)) === J({ uid: null, points: 0, merged_into: UID }) &&
      J(cl) === J({ actor: UID, status: 'fulfilled' }) && q.bal(w, UID) === 1 && q.bal(w, DEV) === 0 && q.contrib(w, UID) === 7 && q.contrib(w, DEV) === 0,
    J({ fired: h.fired, merge: mst, uid: q.point(w, UID), dev: q.point(w, DEV), claim: cl, bal: [q.bal(w, UID), q.bal(w, DEV)], contrib: [q.contrib(w, UID), q.contrib(w, DEV)] }));
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
  hookOnce(w.DELAY_DB, /FROM tra_station_events/, async () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
  const st = await w.cron();
  ok('LSe [租約] 途中被接手：收尾只刪自己那一份——接手那一發的租約列還在、值沒變（被接手之後這一發的寫入不動任何列，見 N3）',
    st.trains === 1 && q.lease(w) && q.lease(w).v === other, J({ st: st.trains, lease: q.lease(w) }));
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
  spyRows(w.DELAY_DB, (sql, rs) => { if (PRIOR_RE.test(sql)) prior.push(...rs.map(r => ({ id: String(r.id), payload: String(r.payload) }))); });
  const st2 = await w.cron({ BOUNTY_NOW: String(NOW_MS + 3600e3) });
  const got = prior.sort((a, b) => a.id.localeCompare(b.id)).map(r => r.payload);
  ok('R2a1 [R2] 前次線組 3 列，每列的 payload 只剩最早與最晚兩點：[30000,30199]、[30200,30399]、[30400,30400]',
    J(got) === J([J([{ t: 30000 }, { t: 30199 }]), J([{ t: 30200 }, { t: 30399 }]), J([{ t: 30400 }, { t: 30400 }])]), J(got));
  ok('R2a2 籌碼判斷照舊看整班（前 400＋後 400＝801 秒 ≥ 600）：補發 1 顆', st2.chips === 1 && q.bal(w, A) === 1, J({ chips: st2.chips, bal: q.bal(w, A) }));
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
  // 帳號 U（可信）的 U1、匿名 a、b 各 1 班。沒有記錄時 U1 排第一（可信先）；U1 有記錄時排最後——連可信身分也一樣。兩種模式都驗。
  const U = 'uid-iso-0000U', A = 'dev-iso-0000a', B = 'dev-iso-0000b';
  for (const mode of ['fixed', '']) {
    const order = async (withStrike) => {
      const w = world({ seed: boardSql('山線') + pointsSql([[U, U, 0, null]]) +
        (withStrike ? `INSERT INTO kv_blobs (k,v,updated) VALUES ('${STRIKE(U, 'U1')}','{"at":1,"error":"x"}','x');` : '') });
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
  const h = hookOnce(w.DELAY_DB, /FROM bounty_claims WHERE actor=COALESCE/, async () => { w.db.prepare('UPDATE kv_blobs SET v=? WHERE k=?').run(other, LEASE); });
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

ok('Z 整支腳本沒有任何非 Firebase 的對外連線', outbound.length === 0, J(outbound.slice(0, 3)));
const bad = R.filter(r => !r.p);
console.log(`\n[SUMMARY] ${R.length - bad.length}/${R.length} 條判準通過${bad.length ? '；未過：' + bad.map(r => r.n.split(' ')[0]).join(',') : ''}`);
process.exitCode = bad.length ? 1 : 0;
