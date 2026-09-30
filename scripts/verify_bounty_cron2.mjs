// 路段懸賞 v2 後端驗收（六）：判定 cron 第二批——第③段身分（S10）、可疑整班不發（S11）、遲傳合併判（S12）、
// 查詢量與子請求預算（S13）、日期窗以上傳時間為基準（S14）。（review-A 第二輪；第一批在 verify_bounty_cron.mjs 的 F1–F24）
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ BOUNTY_NOW 釘死，不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_cron2.mjs
//
// 期望值一律寫死在這裡，不呼叫實作去產生期望（日期自己用 Date 算、點數自己手算並寫出算式）。來源：
//   ・以下規格來自 review-A 第二輪（S10–S14）的審查與修補設計。
//   ・數字（台鐵 50／高鐵 15 位不同的人、一趟至少 600 秒、每日上限 4 籌碼、南迴／臺東 ×2、日期窗 7 天、每日計點上限 200）
//     來自 data/bounty_rules.json，這裡照抄成字面。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準。突變表在回報裡。
//
// 【對照版】K 組與 K0 組拿 c2e81e3b（第一批 F1／F24／F4…修完、S10–S14 動工前的 worker.js）當對照：
//   ・K1／K2／K3 批次化等價：新舊各從乾淨 DB 跑同一批資料，六張表逐列相等（S13a 只改「查詢怎麼打」，結果必須逐位元組相同）。
//   ・K0 正向對照：H／I／J／L 這幾組場景也拿去跑對照版——「新行為」那幾條在對照版上必須紅（證明判準真的有牙、不是拿新版的輸出當期望），
//     「舊行為本來就對」那幾條在對照版上必須綠（證明 fixture 本身沒壞）。
//   對照版由 `git show c2e81e3b:worker.js` 產生（相對 import 改成絕對路徑），寫在系統暫存目錄、跑完刪掉；取不到 git 歷史時 K 組會紅並說明原因，不會靜默略過。
//
// 分組：H 第③段身分（S10）　I 可疑整班不發（S11）　J 遲傳合併判（S12）　L 日期窗基準（S14）
//       K 批次化等價／查詢量（S13a；K1e／K1f＝新增查詢的查詢計畫；K5＝覆蓋段超過 D1 每句 100 個綁定參數）　M 子請求預算與排序（S13b／c／d；M5＝bountyCounted 直接驗）
//       K0 正向對照　K8 容量（S13e，印數字）
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(join(ROOT, 'worker.js'))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// 對外連線偵測：整支腳本唯一允許的對外連線是 Firebase 查 uid（合併用）；其餘一律記下來並丟例外。
const outbound = [];
let firebaseUid = 'uid-cron2-0001';
globalThis.fetch = async (u) => {
  if (String(u).includes('identitytoolkit.googleapis.com')) {
    return firebaseUid ? new Response(JSON.stringify({ users: [{ localId: firebaseUid }] }), { status: 200 }) : new Response('{}', { status: 400 });
  }
  outbound.push(String(u).slice(0, 80));
  throw new Error('offline: ' + String(u));
};

const RULES = JSON.parse(readFileSync(join(ROOT, 'data/bounty_rules.json'), 'utf8'));
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
const D27 = '2026-07-27', D28 = '2026-07-28', D29 = '2026-07-29';   // 週一、週二、週三：都不是假日
const DAY = 86400e3;
const TRIP_MS = Date.parse(D28 + 'T00:00:00Z');             // 乘車日 07-28 的 UTC 零點（防偽閘日期窗用的就是這個時刻）
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const SIM = { platform: 'ios', app: '1.6.13', simulator: true };
const limiter = { limit: async () => ({ success: true }) };

// 合成的線：20 公里、每 2 公里一站（S0…S10），正規區間 10 段。名字用真的鍵（bounty_rules.json 的 remoteLines 認 'tra_sched|南迴線'）。
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const LINES = {};
for (const ln of ['屏東線', '南迴線', '臺東線', '山線']) LINES[`tra_sched|${ln}`] = mkLine('tra_sched', ln);
LINES['thsr_sched|THSR'] = mkLine('thsr_sched', 'THSR');
// 一條 61 站的長線（站名補零：字串比大小＝數字比大小，區間鍵才會是 L00|L01 而不是 L10|L9）：分塊邊界（39／40 段）用。
const LONG_N = 61;
LINES['tra_sched|長線'] = { sys: 'tra_sched', lnId: '長線', name: '長線', stations: Array.from({ length: LONG_N }, (_, i) => ({ name: 'L' + String(i).padStart(2, '0'), d: i * 2 })) };
const LONG_SEGS = Array.from({ length: LONG_N - 1 }, (_, i) => `L${String(i).padStart(2, '0')}|L${String(i + 1).padStart(2, '0')}`);
// 一條 121 站、120 個區間的超長線：覆蓋段一次超過 100 個（D1 每句最多 100 個綁定參數）——K5 用。
const XL_N = 121;
const xlName = i => 'X' + String(i).padStart(3, '0');
LINES['tra_sched|超長線'] = { sys: 'tra_sched', lnId: '超長線', name: '超長線', stations: Array.from({ length: XL_N }, (_, i) => ({ name: xlName(i), d: i * 2 })) };
const XL_SEGS = Array.from({ length: XL_N - 1 }, (_, i) => `${xlName(i)}|${xlName(i + 1)}`);
const PEAK = { tra_sched: [7, 8, 9, 17, 18, 19], thsr_sched: [8, 9, 16, 17, 18, 19] };
const UNITS = { generatedAt: 1, schedDate: D28, units: [], lines: LINES };
const UNITS_PEAK = { ...UNITS, peakHoursBySys: PEAK };     // 有尖峰時段表 → 平日也會產出 dwell 覆蓋（K 組用）
const SEGS10 = Array.from({ length: 9 }, (_, i) => `S${i}|S${i + 1}`);      // 板上種 9 段：S0|S1 … S8|S9
const segKey = (sys, lnId, s) => `${sys}|${lnId}|${s}`;
const KT = (ln, s) => segKey('tra_sched', ln, s);

// 一段乾淨軌跡：從里程 d0 出發、每秒一點、等速 speed（reverse＝往里程減少的方向走）。點數＝sec+1，長度（t 的 max−min）＝sec。
function leg({ sec, speed = 20, t0 = 30000, d0 = 0, reverse = false, acc = 8 }) {
  const pts = [];
  for (let i = 0; i <= sec; i++) pts.push({ d: d0 + (reverse ? -i : i) * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc });
  return pts;
}
// 逐站停靠的軌跡（產出 dwell 覆蓋用）：從 d0 巡航到 d1，經過 stops（公尺）各停一次。幾何同 verify_bounty_dwell.mjs 的 trajectory：
// 站前 105 m 開始 20 秒減速、停 5 秒（都卜勒速度 0.35–0.45）、20 秒加速；每秒一點；回報速度 = 物理速度 + 小幅正弦（避開「都卜勒太乾淨」那一重）。
function stopGo({ d0 = 0, d1, stops = [], cruise = 10, t0 = 30000 }) {
  let d = d0, t = t0, n = 0;
  const pts = [{ d, t, v: cruise + 0.4, acc: 8 }];
  const push = (ps, dv = null) => {
    d += ps; t += 1; n += 1;
    pts.push({ d, t, v: dv == null ? Math.max(0, ps + Math.sin(n / 3) * 1.2) : dv, acc: 8 + (n % 3) });
  };
  for (const c of stops) {
    // 巡航到站前 105 m：把剩下的距離平均分給整數個步（速度微幅低於 cruise），不用「最後補一小步」——
    // 補的那一小步會讓回報速度在 1 秒內掉 5 m/s 以上——第九批之前的加速度上限（1.3×3，每秒）會判 impossible_physics；現在的上限是 1.3×3×(Δt＋1)，形狀沿用
    const dist = c - 105 - d;
    if (dist > 0) { const k = Math.max(1, Math.ceil(dist / cruise)); for (let i = 0; i < k; i++) push(dist / k); }
    for (let j = 1; j <= 20; j++) push(cruise - (cruise - 0.5) * j / 20);
    for (let j = 0; j < 5; j++) push(0.2, 0.35 + (j % 2) * 0.1);
    for (let j = 1; j <= 20; j++) push(0.5 + (cruise - 0.5) * j / 20);
  }
  while (d + cruise <= d1) push(cruise);
  return pts;
}
// K 組用：前面補兩個與第一點同位置、同速度的點（t−2、t−1）。第十一批起判定端不收每趟開頭的 2 點（冷啟動，見 worker.js integrityGate），
// 覆蓋率從第 3 點算起；補上這兩點，新版不收的剛好是補的那兩點，舊版（對照版）多收的兩點與第一點同位置、不改變任何區間的跨度——
// 讓「批次化等價」的範圍不含這個刻意的改變（與 K 組開頭那段「範圍」說明同一個作法）。長度多 2 秒，兩版都是從原始的點算。
const pad2 = pts => [{ ...pts[0], t: pts[0].t - 2 }, { ...pts[0], t: pts[0].t - 1 }, ...pts];
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// ── 測試端獨立的子請求計數（在 worker 自己的計數器「下面」再包一層，兩邊各數各的、再比對）──────────────────────────
// 數法：first／run／all／raw 各 1、batch 整批 1（不論幾句）、exec 1、ASSETS.fetch 1。
// 刻意與 worker.js 的 bountyCounted 寫成兩份程式（不 import、不共用）：同一份程式量自己＝零資訊。
function tallyEnv(env) {
  const t = { query: 0, batch: 0, exec: 0, fetch: 0, maxBind: 0, sqls: new Set(), get n() { return this.query + this.batch + this.exec + this.fetch; } };
  const DB = env.DELAY_DB;
  const wrapStmt = st => ({
    _inner: st,
    get _sql() { return st._sql; },
    // 綁定參數：Cloudflare D1 每一句最多 100 個（文件的固定上限）；假 D1 的 SQLite 沒這個限制，所以在這裡替它擋——超過就丟例外，跟真的一樣。
    // 沒有這一道，「動態展開 IN (?,?,…)」的寫法在假 D1 上永遠是綠的，上線遇到覆蓋段超過 98 段的整條線才爆（見 K5）。
    bind: (...a) => {
      t.maxBind = Math.max(t.maxBind, a.length);
      if (a.length > 100) throw new Error(`D1_ERROR: too many SQL variables（${a.length} 個綁定參數 > 100）`);
      return wrapStmt(st.bind(...a));
    },
    first: (...a) => { t.query++; return st.first(...a); },
    run: (...a) => { t.query++; return st.run(...a); },
    all: (...a) => { t.query++; return st.all(...a); },
    raw: (...a) => { t.query++; return st.raw(...a); },
  });
  const db = {
    prepare: sql => { t.sqls.add(String(sql)); return wrapStmt(DB.prepare(sql)); },     // sqls：worker 真正送出的 SQL 文字（K1e／K1f 拿去跑 EXPLAIN QUERY PLAN）
    batch: async stmts => { t.batch++; return DB.batch(stmts.map(s => (s && s._inner) || s)); },
    exec: async sql => { t.exec++; return DB.exec(sql); },
  };
  const assets = { fetch: (...a) => { t.fetch++; return env.ASSETS.fetch(...a); } };
  return { env: { ...env, DELAY_DB: db, ASSETS: assets }, t };
}

// 一個獨立的世界：全新的 D1、規則與題庫替身、釘死的時鐘。impl 決定跑哪一版 worker（預設新版）。
const NEW = { name: '新版', api: _bounty };
const CTL_ERRS = [];
function world(over = {}) {
  const impl = over.impl || NEW;
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  if (over.afterOpen) over.afterOpen(db);
  const units = over.units || UNITS;
  const rules = over.rules || RULES;
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units') ? J(units) : J(rules), { status: 200 }) };
  let env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, AUTH_LIMITER: limiter, FIREBASE_WEB_API_KEY: 'k' };
  if (over.now !== null) env.BOUNTY_NOW = String(over.now || NOW_MS);
  let tally = null;
  if (over.tally) { const T = tallyEnv(env); env = T.env; tally = T.t; }
  return {
    db, DELAY_DB, get env() { return env; }, tally, impl,
    // 模組層級有 rules／units 快取（bountyResetMemCaches 的註解），每次跑之前歸零，情境之間才不會串味
    // 判定 cron 丟例外＝突變或回歸的訊號，但不能讓整個場景函式中斷（後面的判準會沒跑、也就不會變紅）：這裡接住、記一條「Ecron」FAIL（只記新版；
    // 對照版的例外進 CTL_ERRS，由 K0a 報），回傳一個空的 stat，讓場景裡後面的判準拿停在例外之前的資料照跑。
    cron: async (now) => {
      impl.api.bountyResetMemCaches();
      try { return await impl.api.bountyVerifyCron(now ? { ...env, BOUNTY_NOW: String(now) } : env); }
      catch (e) {
        const msg = String((e && e.message) || e).slice(0, 160);
        if (impl === NEW) ok('Ecron [判定 cron 丟例外] 判定 cron 不該丟例外（例外是突變或回歸的訊號；場景裡後面的判準用停在例外之前的資料照跑）', false, msg);
        else CTL_ERRS.push(msg);
        return { threw: msg, trips: 0, trains: 0, ok: 0, unusable: 0, suspect: 0, truncated: false, chips: 0, subreq: 0, budgetStop: false };
      }
    },
    valuation: async () => { impl.api.bountyResetMemCaches(); return impl.api.bountyValuationCron(env); },
  };
}

// 直接寫樣本列（每一批一列）。first＝這一段批次的起始序號（同一班車分幾次寫入時，序號與 submitted_at 都要接續）。
function putBatches(db, o) {
  const { actor, trainNo, lnId, sys = 'tra_sched', date = D28, pts, dir = 0, client = APP, first = 0, size = 200 } = o;
  // submittedAt：上傳時間的基準，預設是固定世界的「一小時前」。防偽閘的日期窗以上傳時間為基準（S14），要測日期窗就自己給。
  const at = o.submittedAt ?? (NOW_MS - 3600e3);
  chunk(pts, size).forEach((part, k) => {
    const c = Array.isArray(client) ? client[Math.min(first + k, client.length - 1)] : client;
    db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
      " VALUES (?,?,?,?,?,?,?,?,NULL,?,'pending',?)")
      .run(`${actor}.${trainNo}.${date}.${lnId}.${first + k}`, actor, sys, lnId, trainNo, dir, date, J(part),
        at + first + k, c ? J(c) : null);
  });
}

// 板上種段（同 verify_bounty_cron.mjs）。一次可以種多列（同段不同車種）；covered／distinct／sampleCount 可指定。
const boardSql = (sys, lnId, rows, segs = SEGS10) => {
  const v = [];
  for (const s of segs) for (const r of rows) {
    v.push(`('${segKey(sys, lnId, s)}','${sys}','${r.trainKind || '自強'}',${r.dir ?? 0},'track','',1,1,${r.points ?? 3},10,1,1,` +
      `${r.sampleCount ?? 0},${r.covered ?? 'NULL'},${(r.distinctOf && r.distinctOf[s]) ?? r.distinct ?? 0})`);
  }
  return `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users) VALUES ${v.join(',')};`;
};
const boardAll = (lns) => lns.map(ln => boardSql('tra_sched', ln, [{}])).join('\n');
// 任意列（含 dwell）：{ k 段鍵, tk 車種, dir, kind, slot, pts 點數 }
const boardRows = rows => 'INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users) VALUES ' +
  rows.map(r => `('${r.k}','${r.sys || 'tra_sched'}','${r.tk || '自強'}',${r.dir ?? 0},'${r.kind || 'track'}','${r.slot ?? ''}',1,1,${r.pts ?? 3},10,1,1,0,NULL,0)`).join(',') + ';';
const claimSql = c => `INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES ` +
  `('${c.id}','${c.actor}','${c.seg}','${c.tk || '自強'}',${c.dir ?? 0},'${c.kind || 'track'}','${c.slot ?? ''}',${c.pts},${c.at ?? 1},${c.exp ?? NOW_MS + DAY},'${c.status || 'open'}');`;

// ── 讀庫（一律自己寫 SQL，不呼叫實作的任何函式）─────────────────────────────────
const q = {
  verdicts: (db, actor, trainNo) => db.prepare('SELECT DISTINCT verdict v FROM bounty_samples WHERE actor=? AND train_no=?').all(actor, trainNo).map(r => r.v).sort().join(),
  verdictsLn: (db, actor, trainNo, ln) => db.prepare('SELECT DISTINCT verdict v FROM bounty_samples WHERE actor=? AND train_no=? AND ln_id=?').all(actor, trainNo, ln).map(r => r.v).sort().join(),
  // 批次序號在 [first, first+100) 之間的那幾列的判定（同一班車分幾發寫入時，用 putBatches 的 first 區分是哪一發寫的）
  verdicts2: (db, actor, trainNo, first) => db.prepare('SELECT id,verdict FROM bounty_samples WHERE actor=? AND train_no=?').all(actor, trainNo)
    .filter(r => { const k = Number(r.id.split('.').pop()); return k >= first && k < first + 100; }).map(r => r.verdict).filter((v, i, a) => a.indexOf(v) === i).sort().join(),
  rejects: (db, actor, trainNo, ln) => db.prepare('SELECT DISTINCT reject_code r FROM bounty_samples WHERE actor=? AND train_no=? AND ln_id=?').all(actor, trainNo, ln).map(r => r.r).sort().join(),
  nPending: db => db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c,
  tripRows: db => db.prepare("SELECT actor,delta,ref,day FROM chip_ledger WHERE kind='trip' ORDER BY ref").all().map(r => ({ ...r })),
  nLedger: (db, actor) => db.prepare('SELECT COUNT(*) c FROM chip_ledger WHERE actor=?').get(actor).c,
  contribKeys: (db, actor) => db.prepare('SELECT seg_key FROM bounty_seg_contrib WHERE actor=? ORDER BY seg_key').all(actor).map(r => r.seg_key),
  nContrib: (db, actor) => db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib WHERE actor=?').get(actor).c,
  board: (db, key) => db.prepare('SELECT train_kind,dir,sample_count,covered_at,distinct_ok_users FROM bounty_board WHERE seg_key=? ORDER BY train_kind,dir').all(key).map(r => ({ ...r })),
  points: (db, actor) => { const r = db.prepare('SELECT points FROM bounty_points WHERE actor=?').get(actor); return r ? r.points : null; },
  nPointsRows: (db, actor) => db.prepare('SELECT COUNT(*) c FROM bounty_points WHERE actor=?').get(actor).c,
  claim: (db, id) => db.prepare('SELECT actor,status FROM bounty_claims WHERE id=?').get(id),
  verdictAts: (db, actor, trainNo) => db.prepare("SELECT id,verdict_at FROM bounty_samples WHERE actor=? AND train_no=? AND verdict!='pending' ORDER BY id").all(actor, trainNo).map(r => ({ ...r })),
};
const segNames = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `S${from + i}|S${from + i + 1}`);   // segNames(0,6)＝S0|S1…S6|S7
const keysOf = (ln, names) => names.map(s => KT(ln, s)).sort();
const S7 = segNames(0, 6);                                    // 700 秒 @20 m/s＝14 km＝前 7 段
const S4 = segNames(0, 3);                                    // 400 秒 @20 m/s＝ 8 km＝前 4 段
const S4b = segNames(4, 7);                                   // 第二段 400 秒（d0＝8000）＝ S4|S5…S7|S8

// ── 測試用注入點（同 verify_bounty_cron.mjs）──────────────────────────────────
// 在「符合的那句 SQL 第一次真的執行前」插入一段非同步動作＝競態注入點（等於在 cron 讀完樣本、之後才發生別的請求）。
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
// 走真的 bountyMerge（裝置 token 併進 uid）。若日後 bountyMerge 的呼叫契約改了，只要改這一個函式。
async function mergeInto(w, dev, uid) {
  firebaseUid = uid;
  const res = await _bounty.bountyMerge(new Request('https://railisland.tw/api/bounty-merge', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', Authorization: 'Bearer t' },
    body: J({ actor: dev }) }), w.env);
  return res.status;
}
// 用真的 scheduled() 觸發一次 cron；log 與 error 收起來。回傳 { logs, errs, threw }
async function fire(w, cron) {
  const logs = [], errs = [], cl = console.log, ce = console.error, cw = console.warn;
  console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  let threw = null;
  try { _bounty.bountyResetMemCaches(); await worker.scheduled({ cron, scheduledTime: NOW_MS }, w.env, { waitUntil() {} }); }
  catch (e) { threw = String((e && e.message) || e).slice(0, 100); }
  finally { console.log = cl; console.error = ce; console.warn = cw; }
  return { logs, errs, threw };
}

// ── 對照版（c2e81e3b）載入 ────────────────────────────────────────────────────
// c2e81e3b＝review-A 第一批（F1／F24／F4／F10／F11／F23／F12／F21）修完、第二批（S10–S14）動工之前的 worker.js。
// 換基準的方法：改這個常數；若日後歷史被改寫、這個 commit 取不到，K 組與 K0 組會紅並說明原因（換成當時的 tip 即可）。
const CONTROL_SHA = 'c2e81e3b';
let ctlDir = null;
async function loadControl() {
  const src = execFileSync('git', ['show', `${CONTROL_SHA}:worker.js`], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' });
  ctlDir = mkdtempSync(join(tmpdir(), 'bounty-ctl-'));
  const file = join(ctlDir, `worker.${CONTROL_SHA}.mjs`);
  // worker.js 的 import 都是 './scripts/…'：搬到暫存目錄後要改成指回這個 repo 的絕對 file:// 位址
  const fixed = src.replace(/from '\.\/(scripts\/[^']+)'/g, (m, p) => `from '${pathToFileURL(join(ROOT, p)).href}'`);
  if (/from '\.\//.test(fixed)) throw new Error('對照版還有沒改到的相對 import');
  writeFileSync(file, fixed);
  const mod = await import(pathToFileURL(file).href);
  return { name: `對照版 ${CONTROL_SHA}`, api: mod._bounty, md5: createHash('md5').update(src).digest('hex') };
}
let CTL = null, ctlErr = null;
try { CTL = await loadControl(); console.log(`[G0] 對照版 ${CONTROL_SHA} 載入完成（git show 原文 md5=${CTL.md5}）`); }
catch (e) { ctlErr = String((e && e.message) || e).split('\n')[0]; console.log(`[G0] 對照版載入失敗：${ctlErr}`); }
process.on('exit', () => { if (ctlDir) try { rmSync(ctlDir, { recursive: true, force: true }); } catch (e) {} });

// ── 場景：同一份場景函式，對新版與對照版各跑一次（c＝記錄一條判準）──────────────────────
const SCN = [];
const scn = (name, fn) => SCN.push([name, fn]);
const DEV = 'dev-cron2-0001', UID = 'uid-cron2-0001';

// ═══ H 組：第③段的身分（S10）══════════════════════════════════════════════════════
// 第③段（給點數、查認領、關認領）舊版用「讀樣本當時」的 trip.actor。cron 讀完樣本之後、走到第③段之前，這個裝置若剛好被併進帳號
// （POST /api/bounty-merge：樣本與認領整批改名到 uid、原 token 那一列歸零只當墓碑 merged_into＝uid），舊版會把點數記到墓碑上、
// 認領（已在 uid 名下）查不到也關不掉。注入點：第一次查逐站事件之前（在判定迴圈裡，早於身分解析與第③段）。
scn('H', async (impl, c) => {
  const seed = boardSql('tra_sched', '山線', [{ trainKind: '自強', points: 3 }]);
  const CLAIM = { id: 'claim-h', actor: DEV, seg: KT('山線', 'S0|S1'), tk: '自強', dir: 0, pts: 9 };
  const build = withClaim => {
    const w = world({ impl, seed: seed + (withClaim ? claimSql(CLAIM) : '') });
    putBatches(w.db, { actor: DEV, trainNo: 'H1', lnId: '山線', pts: leg({ sec: 700 }) });
    return w;
  };
  const racing = w => {
    const r = { mst: null };
    r.hook = hookOnce(w.DELAY_DB, /FROM tra_station_events WHERE service_date/, async () => { r.mst = await mergeInto(w, DEV, UID); });
    return r;
  };
  // H1：沒有認領。板價 3、覆蓋 S0|S1…S6|S7 共 7 段 → 7×3＝21 點，必須記在「當下的身分」uid 名下；墓碑（裝置 token 那一列）維持 0。
  { const w = build(false); const r = racing(w);
    await w.cron();
    c('H1p [S10 前置] 合併確實發生在 cron 讀樣本之後（注入點觸發 1 次、合併回 200），樣本判成 ok（已在 uid 名下）',
      r.hook.fired === 1 && r.mst === 200 && q.verdicts(w.db, UID, 'H1') === 'ok', J({ fired: r.hook.fired, mst: r.mst, v: q.verdicts(w.db, UID, 'H1') }));
    c('H1a [S10] 點數記在 uid 名下：7 段×3＝21（不是 0）', q.points(w.db, UID) === 21, J({ uid: q.points(w.db, UID), dev: q.points(w.db, DEV) }));
    c('H1b [S10] 已併掉的裝置 token（墓碑）點數仍是 0——點數沒有寫進墓碑', q.points(w.db, DEV) === 0, J({ dev: q.points(w.db, DEV) }));
  }
  // H2：裝置有一張認領（S0|S1，鎖價 9）。合併後認領在 uid 名下。第③段要用 uid 找得到它（S0|S1 以 9 計，其餘 6 段板價 3）＝9+18＝27，
  // 而且要把它關成 fulfilled（歸屬仍是 uid）。
  { const w = build(true); const r = racing(w);
    await w.cron();
    const cl = q.claim(w.db, 'claim-h');
    c('H2p [S10 前置] 合併發生（注入點 1 次）、認領隨合併改名到 uid（關之前 actor＝uid）', r.hook.fired === 1 && r.mst === 200 && cl && cl.actor === UID, J({ fired: r.hook.fired, cl }));
    c('H2a [S10 認領查詢] 認領價被套用：uid 點數＝9（認領鎖價）＋6×3（板價）＝27（不是 21）', q.points(w.db, UID) === 27, J({ uid: q.points(w.db, UID), dev: q.points(w.db, DEV) }));
    c('H2b [S10 關認領] 認領被關成 fulfilled（uid 名下那一張）', cl && cl.status === 'fulfilled' && cl.actor === UID, J(cl));
  }
  // H4（對照，沒有合併）：同樣的趟與認領，裝置名下就是它自己。舊版新版都該是 27＋fulfilled——證明上面的紅不是因為 fixture 本身有問題。
  { const w = build(true);
    await w.cron();
    const cl = q.claim(w.db, 'claim-h');
    c('H4a [S10 對照] 沒有合併：裝置名下點數＝27（認領鎖價 9＋6×3）', q.points(w.db, DEV) === 27, J({ dev: q.points(w.db, DEV) }));
    c('H4b [S10 對照] 沒有合併：認領被關成 fulfilled、歸屬仍是裝置', cl && cl.status === 'fulfilled' && cl.actor === DEV, J(cl));
  }
});

// ═══ I 組：任何一條線可疑，整班車就不發籌碼（S11）══════════════════════════════════════
// 「單獨一條線的趟被判 suspect 本來就是 0 顆」，整班車不能因為另一條線 ok 就照發（suspect 那段的時間也不該被算進長度）。
// ok 線組的去重登記、點數、看板照舊（那是它自己的事）。可疑那條線：400 秒、每秒 60 公尺（216 km/h）＞ 台鐵速度上限 130 km/h×1.15 → impossible_physics。
scn('I', async (impl, c) => {
  const seed = boardAll(['屏東線', '南迴線', '臺東線', '山線']);
  const iWorld = (actor, trainNo, parts) => {
    const w = world({ impl, seed });
    parts.forEach(p => putBatches(w.db, { actor, trainNo, ...p }));
    return w;
  };
  const OK700 = { lnId: '屏東線', pts: leg({ sec: 700, t0: 30000 }), first: 0 };
  const SUSPECT_FIRST = { lnId: '南迴線', pts: leg({ sec: 400, speed: 60, t0: 30000 }), first: 0 };
  // I1：屏東線 ok（700 秒）＋南迴線 suspect（400 秒），suspect 那組排在後面
  { const w = iWorld('i1', 'I1', [OK700, { lnId: '南迴線', pts: leg({ sec: 400, speed: 60, t0: 30701 }), first: 100 }]);
    const st = await w.cron();
    c('I1p [S11 前置] 屏東線判 ok、南迴線判 suspect（impossible_physics）；stat 各 1',
      q.verdictsLn(w.db, 'i1', 'I1', '屏東線') === 'ok' && q.verdictsLn(w.db, 'i1', 'I1', '南迴線') === 'suspect' &&
        q.rejects(w.db, 'i1', 'I1', '南迴線') === 'impossible_physics' && st.ok === 1 && st.suspect === 1,
      J({ p: q.verdictsLn(w.db, 'i1', 'I1', '屏東線'), n: q.verdictsLn(w.db, 'i1', 'I1', '南迴線'), rej: q.rejects(w.db, 'i1', 'I1', '南迴線'), st }));
    c('I1a [S11] 整班車不發籌碼：帳本 0 列、這一發入帳 0（屏東 ok 單獨看是 700 秒該發 1 顆，但同班車另一條線 suspect）',
      q.tripRows(w.db).length === 0 && st.chips === 0, J({ ledger: q.tripRows(w.db), chips: st.chips }));
    c('I1b [S11] ok 線組的去重登記照做：屏東線 7 段各登記 1 次（不因整班不發籌碼就連貢獻都不記）；suspect 那條線 0 段',
      J(q.contribKeys(w.db, 'i1')) === J(keysOf('屏東線', S7)), J({ contrib: q.contribKeys(w.db, 'i1').length }));
    c('I1c [S11] ok 線組的點數照給：屏東線 7 段×板價 3＝21', q.points(w.db, 'i1') === 21, J({ points: q.points(w.db, 'i1') }));
  }
  // I2：反過來，suspect 那組排在前面（迴圈順序不影響否決）
  { const w = iWorld('i2', 'I2', [SUSPECT_FIRST, { lnId: '屏東線', pts: leg({ sec: 700, t0: 30401 }), first: 100 }]);
    const st = await w.cron();
    c('I2a [S11 反序] suspect 線組排在前面：一樣整班 0 顆（帳本 0 列）；屏東線 ok、南迴線 suspect',
      q.tripRows(w.db).length === 0 && st.chips === 0 && q.verdictsLn(w.db, 'i2', 'I2', '屏東線') === 'ok' && q.verdictsLn(w.db, 'i2', 'I2', '南迴線') === 'suspect',
      J({ ledger: q.tripRows(w.db), chips: st.chips, p: q.verdictsLn(w.db, 'i2', 'I2', '屏東線'), n: q.verdictsLn(w.db, 'i2', 'I2', '南迴線') }));
  }
  // I3（對照）：兩條線都 ok（屏東 700＋南迴 700）：南迴 ×2 → 1 列 delta 2——否決只在有 suspect 時才發生
  { const w = iWorld('i3', 'I3', [OK700, { lnId: '南迴線', pts: leg({ sec: 700, t0: 30701 }), first: 100 }]);
    await w.cron();
    c('I3a [S11 對照] 兩條線都 ok：帳本 1 列 delta 2（南迴 ×2、一班車一次）', J(q.tripRows(w.db)) === J([{ actor: 'i3', delta: 2, ref: `i3|${D28}|I3`, day: D28 }]), J(q.tripRows(w.db)));
  }
  // I4（對照）：屏東 ok＋南迴只有 5 點（unusable，不是 suspect）：不否決 → 1 顆。unusable 不等於可疑。
  { const w = iWorld('i4', 'I4', [OK700, { lnId: '南迴線', pts: leg({ sec: 4, t0: 30701 }), first: 100 }]);
    await w.cron();
    c('I4a [S11 對照] 一條線 ok、另一條 unusable（5 點）：不否決，帳本 1 列 delta 1', J(q.tripRows(w.db)) === J([{ actor: 'i4', delta: 1, ref: `i4|${D28}|I4`, day: D28 }]) &&
      q.verdictsLn(w.db, 'i4', 'I4', '南迴線') === 'unusable', J({ ledger: q.tripRows(w.db), n: q.verdictsLn(w.db, 'i4', 'I4', '南迴線') }));
  }
});

// ═══ J 組：遲傳合併判（S12）══════════════════════════════════════════════════════
// 車上沒訊號、隔天早上才開 App：一班車前半段已在前一發判完（當時不到 600 秒 → 0 顆），後半段這一發才到。
// 只看這一發的批次，整班車一顆都拿不到；所以每班車另查「先前已判定過的列」（前次線組），籌碼判斷（任一 ok、suspect 否決、偏遠 ×2、整班長度）
// 把兩邊合起來看。前次線組只參與籌碼判斷——不重新登記去重、不重新標記、不重給點數。
// 兩發的時鐘：第一發 NOW_MS（台北 07-29 10:00）、第二發 T2＝NOW_MS＋1 小時；乘車日都是 07-28。前半段 t 從 30000、後半段接在後面（30401…）。
scn('J', async (impl, c) => {
  const T2 = NOW_MS + 3600e3;
  const led = w => q.tripRows(w.db);
  const ref = (a, t) => `${a}|${D28}|${t}`;
  const half = (w, actor, trainNo, o) => putBatches(w.db, { actor, trainNo, ...o });
  // J1：一般線（山線）、往里程增加方向：前半 400 秒（S0…S3，4 段）＋後半 400 秒（S4…S7，4 段）
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j1', 'J1', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    const s1 = await w.cron();
    const ids1 = new Set(q.verdictAts(w.db, 'j1', 'J1').map(r => r.id));
    const va1 = J(q.verdictAts(w.db, 'j1', 'J1'));
    const p1 = { chips: s1.chips, contrib: q.nContrib(w.db, 'j1'), points: q.points(w.db, 'j1') };
    half(w, 'j1', 'J1', { lnId: '山線', pts: leg({ sec: 400, t0: 30401, d0: 8000 }), first: 100 });
    const s2 = await w.cron(T2);
    c('J1p [S12 前置] 前半段那一發：ok、入帳 0（400 秒不到 600）、登記 4 段、點數 12（4 段×3）',
      q.verdicts(w.db, 'j1', 'J1') === 'ok' && p1.chips === 0 && p1.contrib === 4 && p1.points === 12 && ids1.size > 0, J(p1));
    c('J1a [S12] 後半段晚到那一發：前半＋後半共 801 秒 ≥ 600 → 補發 1 顆（帳本恰 1 列 delta 1、ref＝j1|乘車日|J1；這一發入帳 1）',
      J(led(w)) === J([{ actor: 'j1', delta: 1, ref: ref('j1', 'J1'), day: D28 }]) && s2.chips === 1, J({ ledger: led(w), chips: s2.chips }));
    const va2 = J(q.verdictAts(w.db, 'j1', 'J1').filter(r => ids1.has(r.id)));
    c('J1b [S12] 前次線組只參與籌碼判斷、不重新標記：前半段每一列的 verdict_at 仍是第一發的時間（NOW_MS），後半段是第二發的時間',
      va2 === va1 && JSON.parse(va2).every(r => r.verdict_at === NOW_MS) &&
        q.verdictAts(w.db, 'j1', 'J1').filter(r => !ids1.has(r.id)).every(r => r.verdict_at === T2),
      J({ first: JSON.parse(va2).map(r => r.verdict_at), all: q.verdictAts(w.db, 'j1', 'J1').length }));
    c('J1c [S12] 前次不重新登記、不重給點數：登記共 8 段（4＋4）、S0|S1 的 sample_count 與人數仍各 1、點數共 24（12＋12，不是 36）',
      J(q.contribKeys(w.db, 'j1')) === J(keysOf('山線', [...S4, ...S4b])) && q.points(w.db, 'j1') === 24 &&
        q.board(w.db, KT('山線', 'S0|S1'))[0].sample_count === 1 && q.board(w.db, KT('山線', 'S0|S1'))[0].distinct_ok_users === 1,
      J({ contrib: q.contribKeys(w.db, 'j1').length, points: q.points(w.db, 'j1'), b: q.board(w.db, KT('山線', 'S0|S1'))[0] }));
    c('J1d [S12] stat.trips 只數這一發讀到的線組（前次線組不算）＝1', s2.trips === 1, J(s2));
  }
  // J2：反方向（里程遞減，dir 1）：前半 400 秒（S4…S7）＋後半 400 秒（S0…S3），一樣補發 1 顆
  { const w = world({ impl, seed: boardSql('tra_sched', '山線', [{ dir: 0 }, { dir: 1 }]) });
    half(w, 'j2', 'J2', { lnId: '山線', dir: 1, pts: leg({ sec: 400, t0: 30000, d0: 16000, reverse: true }), first: 0 });
    await w.cron();
    half(w, 'j2', 'J2', { lnId: '山線', dir: 1, pts: leg({ sec: 400, t0: 30401, d0: 8000, reverse: true }), first: 100 });
    const s2 = await w.cron(T2);
    c('J2a [S12 反向] 里程遞減的兩半：後半晚到那一發補發 1 顆（帳本恰 1 列 delta 1）', J(led(w)) === J([{ actor: 'j2', delta: 1, ref: ref('j2', 'J2'), day: D28 }]) && s2.chips === 1, J({ ledger: led(w), st: s2 }));
    c('J2b [S12 反向] 登記 8 段、點數 24（dir 1 的板價 3×8）', J(q.contribKeys(w.db, 'j2')) === J(keysOf('山線', [...S4, ...S4b])) && q.points(w.db, 'j2') === 24,
      J({ contrib: q.contribKeys(w.db, 'j2').length, points: q.points(w.db, 'j2') }));
  }
  // J3：偏遠線 ×2 也看前次線組。前半（屏東線，一般線）400 秒、後半（南迴線）400 秒 → 合起來 801 秒、含偏遠線 → 2 顆；反過來（先南迴、後屏東）也是 2。
  { const w = world({ impl, seed: boardAll(['屏東線', '南迴線']) });
    half(w, 'j3a', 'J3A', { lnId: '屏東線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w.cron();
    half(w, 'j3a', 'J3A', { lnId: '南迴線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    await w.cron(T2);
    c('J3a [S12 偏遠] 前半屏東線、後半南迴線：補發 1 列 delta 2（南迴 ×2，取自「這一發」的線組）', J(led(w)) === J([{ actor: 'j3a', delta: 2, ref: ref('j3a', 'J3A'), day: D28 }]), J(led(w)));
    const w2 = world({ impl, seed: boardAll(['屏東線', '南迴線']) });
    half(w2, 'j3b', 'J3B', { lnId: '南迴線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w2.cron();
    half(w2, 'j3b', 'J3B', { lnId: '屏東線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    await w2.cron(T2);
    c('J3b [S12 偏遠] 前半南迴線、後半屏東線：補發 1 列 delta 2（南迴 ×2，取自「前次」的線組）', J(led(w2)) === J([{ actor: 'j3b', delta: 2, ref: ref('j3b', 'J3B'), day: D28 }]), J(led(w2)));
  }
  // J4：前次線組可疑 → 否決。前半屏東線 400 秒可疑（impossible_physics）、後半山線 ok 700 秒（單獨看夠發 1 顆）→ 整班 0 顆；後半 ok 的登記與點數照做。
  { const w = world({ impl, seed: boardAll(['屏東線', '山線']) });
    half(w, 'j4', 'J4', { lnId: '屏東線', pts: leg({ sec: 400, speed: 60, t0: 30000 }), first: 0 });
    await w.cron();
    const va1 = J(q.verdictAts(w.db, 'j4', 'J4'));
    half(w, 'j4', 'J4', { lnId: '山線', pts: leg({ sec: 700, t0: 30401 }), first: 100 });
    const s2 = await w.cron(T2);
    c('J4p [S12 前置] 前半段判 suspect、後半段判 ok',
      q.verdictsLn(w.db, 'j4', 'J4', '屏東線') === 'suspect' && q.verdictsLn(w.db, 'j4', 'J4', '山線') === 'ok', J({ p: q.verdictsLn(w.db, 'j4', 'J4', '屏東線'), s: q.verdictsLn(w.db, 'j4', 'J4', '山線') }));
    c('J4a [S12＋S11] 前次線組 suspect → 整班不發：帳本 0 列、這一發入帳 0', led(w).length === 0 && s2.chips === 0, J({ ledger: led(w), chips: s2.chips }));
    c('J4b [S12＋S11] 後半段（ok）自己的登記與點數照做：山線 7 段、點數 21；前半段判定列不動（verdict_at 仍是第一發）',
      J(q.contribKeys(w.db, 'j4')) === J(keysOf('山線', S7)) && q.points(w.db, 'j4') === 21 &&
        J(q.verdictAts(w.db, 'j4', 'J4').filter(r => r.verdict_at === NOW_MS)) === va1,
      J({ contrib: q.contribKeys(w.db, 'j4').length, points: q.points(w.db, 'j4') }));
  }
  // J5（對照）：前半段那一發已入帳（700 秒），後半段（也 700 秒）晚到 → 不再入帳（同一班車已入過帳的查詢照舊擋住），帳本仍 1 列。
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j5', 'J5', { lnId: '山線', pts: leg({ sec: 700, t0: 30000 }), first: 0 });
    const s1 = await w.cron();
    half(w, 'j5', 'J5', { lnId: '山線', pts: leg({ sec: 700, t0: 30701 }), first: 100 });
    const s2 = await w.cron(T2);
    c('J5a [S12 對照] 前半已入帳：後半段晚到不重發（帳本仍恰 1 列 delta 1；第一發入帳 1、第二發入帳 0）',
      J(led(w)) === J([{ actor: 'j5', delta: 1, ref: ref('j5', 'J5'), day: D28 }]) && s1.chips === 1 && s2.chips === 0, J({ ledger: led(w), s1: s1.chips, s2: s2.chips }));
  }
  // J6：模擬器旗標也看前次：前半段自報 simulator:true（只留判定）、後半段換一批「乾淨」的列（simulator:false、700 秒）晚到 →
  // 整班車仍是模擬器：帳本 0、貢獻 0、沒有點數列、看板不動；後半段的判定照寫。（不能靠分兩發洗掉旗標）
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j6', 'J6', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0, client: SIM });
    await w.cron();
    half(w, 'j6', 'J6', { lnId: '山線', pts: leg({ sec: 700, t0: 30401 }), first: 100 });
    const s2 = await w.cron(T2);
    const b = q.board(w.db, KT('山線', 'S0|S1'))[0];
    c('J6a [S12 模擬器] 前半段模擬器、後半段乾淨：整班不入帳（帳本 0 列、這一發入帳 0）；後半段的判定照寫（ok）',
      led(w).length === 0 && s2.chips === 0 && q.verdicts(w.db, 'j6', 'J6') === 'ok', J({ ledger: led(w), chips: s2.chips, v: q.verdicts(w.db, 'j6', 'J6') }));
    c('J6b [S12 模擬器] 貢獻 0 段、沒有點數列、看板不動（S0|S1 的人數與 sample_count 都是 0）',
      q.nContrib(w.db, 'j6') === 0 && q.nPointsRows(w.db, 'j6') === 0 && b.distinct_ok_users === 0 && b.sample_count === 0, J({ contrib: q.nContrib(w.db, 'j6'), points: q.nPointsRows(w.db, 'j6'), b }));
  }
  // J7：前次線組 unusable（品質不過：acc 150 m＞blocked 80 m）400 秒、後半段 ok 400 秒 → 整班長度含前次線組（與這一發自己的 unusable 線組同一個慣例：長度不分判定）→ 801 秒 → 1 顆。
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j7', 'J7', { lnId: '山線', pts: leg({ sec: 400, t0: 30000, acc: 150 }), first: 0 });
    await w.cron();
    half(w, 'j7', 'J7', { lnId: '山線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    await w.cron(T2);
    const qc = w.db.prepare("SELECT DISTINCT quality_code c FROM bounty_samples WHERE actor='j7' AND verdict='unusable'").all().map(r => r.c).join();
    c('J7p [S12 前置] 前半段判 unusable（acc_blocked）', qc === 'acc_blocked', qc);
    c('J7a [S12 長度] 前次 unusable 線組的時間算進整班長度：補發 1 顆（帳本恰 1 列 delta 1）', J(led(w)) === J([{ actor: 'j7', delta: 1, ref: ref('j7', 'J7'), day: D28 }]), J(led(w)));
  }
  // J8：身分。前半段判在裝置名下 → 合併進 uid（樣本整批改名）→ 後半段以 uid 晚到：前次列在 uid 名下，要找得到。
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, DEV, 'J8A', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w.cron();
    const mst = await mergeInto(w, DEV, UID);
    half(w, UID, 'J8A', { lnId: '山線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    const s2 = await w.cron(T2);
    c('J8p [S12 前置] 合併後前半段的判定列已在 uid 名下（ok）', mst === 200 && q.verdicts(w.db, UID, 'J8A') === 'ok', J({ mst, v: q.verdicts(w.db, UID, 'J8A') }));
    c('J8a [S12 身分] 合併之後晚到：前次列（uid 名下）併進來看 → 補發 1 顆，帳本在 uid 名下（ref＝uid|乘車日|J8A）',
      J(led(w)) === J([{ actor: UID, delta: 1, ref: ref(UID, 'J8A'), day: D28 }]) && s2.chips === 1, J({ ledger: led(w), chips: s2.chips }));
  }
  // J8b：競態。後半段仍在裝置名下 pending，cron 讀完之後（第一次查逐站事件之前）才合併：讀樣本時的 actor 是裝置、當下的身分是 uid，
  // 前次列（前半段）已隨合併改名到 uid——前次查詢必須同時綁「讀樣本時的 actor」與「當下的身分」才找得到。
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, DEV, 'J8B', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w.cron();
    half(w, DEV, 'J8B', { lnId: '山線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    let mst = null;
    const hook = hookOnce(w.DELAY_DB, /FROM tra_station_events WHERE service_date/, async () => { mst = await mergeInto(w, DEV, UID); });
    const s2 = await w.cron(T2);
    c('J8bp [S12 前置] 合併發生在讀樣本之後（注入點觸發 1 次、合併回 200）；前半段的判定列已隨合併在 uid 名下', hook.fired === 1 && mst === 200 && q.verdicts(w.db, UID, 'J8B') === 'ok', J({ fired: hook.fired, mst, v: q.verdicts(w.db, UID, 'J8B') }));
    c('J8b [S12 身分×競態] 讀樣本後才合併：前次列（uid 名下）仍找得到 → 補發 1 顆，帳本在 uid 名下（ref＝uid|乘車日|J8B）',
      J(led(w)) === J([{ actor: UID, delta: 1, ref: ref(UID, 'J8B'), day: D28 }]) && s2.chips === 1, J({ ledger: led(w), chips: s2.chips }));
  }
  // J9：不跨班車、不跨日、不跨人（前次查詢的鍵是 actor＋乘車日＋車次；任何一個放寬，兩個各 400 秒的無關趟就會被併成 801 秒）
  { const w = world({ impl, seed: boardAll(['山線']) });          // 同一個人、同一天、不同車次
    half(w, 'j9a', 'JA', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w.cron();
    half(w, 'j9a', 'JB', { lnId: '山線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    await w.cron(T2);
    c('J9a [S12 邊界] 同一個人、同一天、不同車次（JA／JB 各 400 秒）：不併，帳本 0 列', led(w).length === 0, J(led(w)));
    const w2 = world({ impl, seed: boardAll(['山線']) });          // 同一個人、同一車次號、不同乘車日
    half(w2, 'j9b', 'JC', { lnId: '山線', date: D27, pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w2.cron();
    half(w2, 'j9b', 'JC', { lnId: '山線', date: D28, pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    await w2.cron(T2);
    c('J9b [S12 邊界] 同一個人、同一車次號、不同乘車日（07-27／07-28 各 400 秒）：不併，帳本 0 列', led(w2).length === 0, J(led(w2)));
    const w3 = world({ impl, seed: boardAll(['山線']) });          // 不同的人、同一天同一車次號
    half(w3, 'j9c-x', 'JD', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w3.cron();
    half(w3, 'j9c-y', 'JD', { lnId: '山線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    await w3.cron(T2);
    c('J9c [S12 邊界] 不同的人搭同一天同一車次號（x 前半 400、y 後半 400）：不併，帳本 0 列', led(w3).length === 0, J(led(w3)));
  }
  // J11：前次 ok 列沒有 segs（直接寫入、或 JSON 壞掉）：不丟例外，退回它自己的 sys|ln_id 判偏遠（與這一發自己 ok 但沒有覆蓋段的線組同一個慣例）。
  // 前半段南迴線 400 秒（前次 ok、segs 空）＋後半段屏東線 400 秒 → 801 秒、南迴是偏遠線 → 2 顆。
  for (const [tag, segs] of [['a', null], ['b', 'not json']]) {
    const w = world({ impl, seed: boardAll(['屏東線', '南迴線']) });
    half(w, 'j11' + tag, 'J11' + tag.toUpperCase(), { lnId: '南迴線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    w.db.prepare("UPDATE bounty_samples SET verdict='ok', verdict_at=?, segs=? WHERE actor=?").run(NOW_MS, segs, 'j11' + tag);
    half(w, 'j11' + tag, 'J11' + tag.toUpperCase(), { lnId: '屏東線', pts: leg({ sec: 400, t0: 30401 }), first: 100 });
    const s2 = await w.cron(T2);
    c(`J11${tag} [S12 退路] 前次 ok 列的 segs＝${J(segs)}：不丟例外、退回 sys|ln_id 判偏遠 → 1 列 delta 2`,
      J(led(w)) === J([{ actor: 'j11' + tag, delta: 2, ref: ref('j11' + tag, 'J11' + tag.toUpperCase()), day: D28 }]) && s2.chips === 2, J({ ledger: led(w), chips: s2.chips }));
  }
  // J12：前次線組是「最壞的」：同一條線（山線）分三發判——A（ok，100 秒）、B（suspect，100 秒，60 m/s）、C（ok，700 秒，單獨夠發 1 顆）。
  // C 那一發的前次線組＝山線的 A＋B，最壞的是 suspect → 否決 → 0 顆。（ok 蓋過 suspect 的話會補發 1 顆）
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j12', 'J12', { lnId: '山線', pts: leg({ sec: 100, t0: 30000 }), first: 0 });
    await w.cron();
    half(w, 'j12', 'J12', { lnId: '山線', pts: leg({ sec: 100, speed: 60, t0: 30101 }), first: 100 });
    await w.cron(NOW_MS + 1800e3);
    half(w, 'j12', 'J12', { lnId: '山線', pts: leg({ sec: 700, t0: 30201 }), first: 200 });
    const s3 = await w.cron(T2);
    const vOf = first => q.verdicts2(w.db, 'j12', 'J12', first);        // 每一發的批次序號 first 開頭的那幾列
    const vs = [vOf(0), vOf(100), vOf(200)];
    c('J12p [S12 前置] 三發判定：A（100 秒）ok、B（100 秒、60 m/s）suspect、C（700 秒）ok', J(vs) === J(['ok', 'suspect', 'ok']), J(vs));
    c('J12a [S12 最壞] 前次同一條線先後判出 ok 與 suspect → 以 suspect 計 → 整班不發（帳本 0 列、第三發入帳 0）', led(w).length === 0 && s3.chips === 0, J({ ledger: led(w), chips: s3.chips }));
  }
  // J13：前次線組只算「已判定」的列。cron 讀完樣本之後才寫進來的 pending 批次（還沒判過、可能是可疑的）不算。
  // 前半 200 秒（第一發判完、ok、0 顆）；這一發讀到的後半 200 秒（t 30201…30401，兩半合計 401 秒 ＜ 600）；讀完之後、查前次列之前，同一班車又寫進一批
  // 400 秒（t 30402…30802）——這一發不可以把它算進去（算進去＝802 秒 → 提早入帳，而那一批連判都還沒判）；下一發才輪到它：兩半＋它＝802 秒 → 補發 1 顆。
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j13', 'J13', { lnId: '山線', pts: leg({ sec: 200, t0: 30000 }), first: 0 });
    await w.cron();
    half(w, 'j13', 'J13', { lnId: '山線', pts: leg({ sec: 200, t0: 30201, d0: 4000 }), first: 100 });
    const hook = hookOnce(w.DELAY_DB, /FROM tra_station_events WHERE service_date/, async () => { half(w, 'j13', 'J13', { lnId: '山線', pts: leg({ sec: 400, t0: 30402, d0: 8000 }), first: 200 }); });
    const s2 = await w.cron(T2);
    const v = [q.verdicts2(w.db, 'j13', 'J13', 0), q.verdicts2(w.db, 'j13', 'J13', 100), q.verdicts2(w.db, 'j13', 'J13', 200)];
    c('J13p [S12 前置] 注入點在讀樣本之後觸發 1 次：前半（前一發）與後半（這一發）判完 ok，晚寫進來的那批仍是 pending', hook.fired === 1 && J(v) === J(['ok', 'ok', 'pending']), J({ fired: hook.fired, v }));
    c('J13a [S12 只算已判定] 這一發：兩半合計 401 秒 ＜ 600，晚寫進來的 pending 批次不算 → 0 顆（帳本 0 列、入帳 0）', led(w).length === 0 && s2.chips === 0, J({ ledger: led(w), chips: s2.chips }));
    const s3 = await w.cron(T2 + 3600e3);
    c('J13b [S12 只算已判定] 下一發輪到那一批（判完）：前次線組＝兩半（401 秒）＋它（400 秒）＝802 秒 → 補發 1 顆（帳本恰 1 列 delta 1）',
      J(led(w)) === J([{ actor: 'j13', delta: 1, ref: ref('j13', 'J13'), day: D28 }]) && s3.chips === 1 && q.verdicts2(w.db, 'j13', 'J13', 200) === 'ok', J({ ledger: led(w), chips: s3.chips }));
  }
  // J14：前次線組 ok、這一發自己的線組 unusable（品質不過）：「任一 ok」也要看前次線組——整班算 ok，長度含這一發（801 秒）→ 補發 1 顆。
  { const w = world({ impl, seed: boardAll(['山線']) });
    half(w, 'j14', 'J14', { lnId: '山線', pts: leg({ sec: 400, t0: 30000 }), first: 0 });
    await w.cron();
    half(w, 'j14', 'J14', { lnId: '山線', pts: leg({ sec: 400, t0: 30401, d0: 8000, acc: 150 }), first: 100 });
    const s2 = await w.cron(T2);
    const qc = w.db.prepare("SELECT DISTINCT quality_code c FROM bounty_samples WHERE actor='j14' AND verdict='unusable'").all().map(r => r.c).join();
    c('J14p [S12 前置] 前半段（前一發）ok、後半段（這一發）unusable（acc_blocked）', q.verdicts2(w.db, 'j14', 'J14', 0) === 'ok' && q.verdicts2(w.db, 'j14', 'J14', 100) === 'unusable' && qc === 'acc_blocked', J({ qc }));
    c('J14a [S12 任一 ok] 前次 ok、這一發自己 unusable：補發 1 顆（帳本恰 1 列 delta 1；這一發入帳 1）', J(led(w)) === J([{ actor: 'j14', delta: 1, ref: ref('j14', 'J14'), day: D28 }]) && s2.chips === 1, J({ ledger: led(w), chips: s2.chips }));
  }
});

// ═══ L 組：防偽閘的日期窗以「上傳時間」為基準（S14）═══════════════════════════════════
// 「乘車日不得在未來、不得超過 7 天前」的本意是上傳窗（上傳端點 bountySubmit 已經用上傳當下擋過一次：今天往前 7 天到明天）。
// 舊版拿 cron 判定當下的 now 比：積壓超過 7 天才輪到判的趟（cron 停擺、預算用盡一路延後）會被判 stale_date，把誠實的趟當成作弊。
// 新版拿這一組樣本的上傳時間（submitted_at 的最大值）比；沒有上傳時間（直接呼叫閘門的舊用法）退回 now。
// 乘車日 07-28（UTC 零點＝TRIP_MS）；每一趟 700 秒山線（單獨夠發 1 顆），單一批（size 1000）——submitted_at 就是給定的那一個值。
scn('L', async (impl, c) => {
  const seed = boardAll(['山線']);
  const run = async (actor, submittedAt, cronAt) => {
    const w = world({ impl, seed });
    putBatches(w.db, { actor, trainNo: 'L1', lnId: '山線', pts: leg({ sec: 700 }), size: 1000, submittedAt });
    const st = await w.cron(cronAt);
    return { w, st, v: q.verdicts(w.db, actor, 'L1'), rej: q.rejects(w.db, actor, 'L1', '山線'), led: q.tripRows(w.db) };
  };
  const LATE = NOW_MS + 10 * DAY;                                   // 積壓 10 天才輪到判（台北 08-08）
  // L1：隔天上傳（07-29 09:00 台北）、10 天後才判：舊版 now 基準判 stale_date；新版以上傳時間為基準 → ok、發 1 顆
  { const r = await run('l1', Date.parse('2026-07-29T01:00:00Z'), LATE);
    c('L1a [S14] 隔天上傳、積壓 10 天後才判：不是 stale_date——判 ok', r.v === 'ok' && r.rej === '', J({ v: r.v, rej: r.rej }));
    c('L1b [S14] 帳本恰 1 列（delta 1、ref＝l1|乘車日|L1）', J(r.led) === J([{ actor: 'l1', delta: 1, ref: `l1|${D28}|L1`, day: D28 }]), J(r.led));
  }
  // L2：上傳時間本身就超過 7 天窗（直接寫入的列；正常上傳端點擋得掉）→ 仍是 stale_date、可疑、不入帳
  { const r = await run('l2', Date.parse('2026-08-06T01:00:00Z'), Date.parse('2026-08-10T02:00:00Z'));
    c('L2a [S14 對照] 上傳時間比乘車日晚 9 天（超過 7 天窗）：suspect、reject_code＝stale_date', r.v === 'suspect' && r.rej === 'stale_date', J({ v: r.v, rej: r.rej }));
    c('L2b [S14 對照] 可疑的趟不入帳（帳本 0 列）', r.led.length === 0, J(r.led));
    // 邊界（review-B B1 起比「台北日」，與上傳端點同一條）：乘車日 07-28 → 上傳在台北 08-04（第 7 天）的最後一毫秒＝窗內；台北 08-05 零點＝窗外。
    // TRIP_MS 是乘車日的 UTC 零點＝台北 08:00，所以台北 08-05 零點＝TRIP_MS＋7 天＋16 小時。
    const e = await run('l2c', TRIP_MS + 7 * DAY + 16 * 3600e3 - 1, LATE);
    c('L2c [S14 邊界] 上傳在台北第 7 天 23:59:59.999：窗內，判 ok', e.v === 'ok', J({ v: e.v, rej: e.rej }));
    const f = await run('l2d', TRIP_MS + 7 * DAY + 16 * 3600e3, LATE);
    c('L2d [S14 邊界] 再 1 毫秒＝台北第 8 天零點：窗外，suspect／stale_date', f.v === 'suspect' && f.rej === 'stale_date', J({ v: f.v, rej: f.rej }));
    // B1 原案：上傳端點收下的「第 7 天 08:00 之後」補傳（舊版拿乘車日 UTC 零點＋7 天比毫秒，這裡會判 stale_date）
    const g = await run('l2e', TRIP_MS + 7 * DAY + 1, LATE);
    c('L2e [B1] 上傳在台北第 7 天 08:00:00.001（上傳端點收得下）：判 ok，不是 stale_date', g.v === 'ok' && g.rej === '', J({ v: g.v, rej: g.rej }));
  }
  // L3：上傳時間早於乘車日太多（未來日期）：以上傳時間為基準判 future_date；舊版拿 cron 的 now 比，乘車日早已過去，放行
  { const r = await run('l3', Date.parse('2026-07-25T01:00:00Z'), NOW_MS);
    c('L3a [S14] 上傳時間（07-25）比乘車日（07-28）早 3 天：future_date、suspect', r.v === 'suspect' && r.rej === 'future_date', J({ v: r.v, rej: r.rej }));
    // 邊界（台北日）：乘車日不得晚於「上傳當天的明天」→ 上傳在台北 07-27 零點＝窗內；再早 1 毫秒（台北 07-26 23:59:59.999）＝未來日期。
    // 台北 07-27 零點＝UTC 07-26 16:00＝TRIP_MS − 1 天 − 8 小時。
    const e = await run('l3b', TRIP_MS - DAY - 8 * 3600e3, NOW_MS);
    c('L3b [S14 邊界] 上傳在乘車日前一天（台北）的零點：允許（乘車日不得晚於「上傳當天的明天」），判 ok', e.v === 'ok', J({ v: e.v, rej: e.rej }));
    const f = await run('l3c', TRIP_MS - DAY - 8 * 3600e3 - 1, NOW_MS);
    c('L3c [S14 邊界] 再早 1 毫秒（台北前兩天的 23:59:59.999）：future_date、suspect', f.v === 'suspect' && f.rej === 'future_date', J({ v: f.v, rej: f.rej }));
    // B1 未來端：舊版比毫秒時，台北 07-27 00:00～07:59:59.999 上傳的 07-28 趟被判 future_date（上傳端點卻收下）
    const g = await run('l3d', TRIP_MS - DAY - 1, NOW_MS);
    c('L3d [B1] 上傳在台北 07-27 07:59:59.999（上傳端點收得下）：判 ok，不是 future_date', g.v === 'ok' && g.rej === '', J({ v: g.v, rej: g.rej }));
  }
  // L4：同一組有多批、上傳時間不同：以「最晚」的那批為準（max）。第一批上傳在乘車日當天（窗內），第二批 13 天後才傳 → 這一組的上傳時間是第二批 → stale_date
  { const w = world({ impl, seed });
    const pts = leg({ sec: 700 });
    putBatches(w.db, { actor: 'l4', trainNo: 'L1', lnId: '山線', pts: pts.slice(0, 350), size: 1000, submittedAt: Date.parse('2026-07-28T20:00:00Z'), first: 0 });
    putBatches(w.db, { actor: 'l4', trainNo: 'L1', lnId: '山線', pts: pts.slice(350), size: 1000, submittedAt: Date.parse('2026-08-10T00:00:00Z'), first: 100 });
    await w.cron(Date.parse('2026-08-12T02:00:00Z'));
    c('L4a [S14 max] 兩批上傳時間差 13 天：以最晚那批為準 → stale_date、suspect（取最早那批就會放行）',
      q.verdicts(w.db, 'l4', 'L1') === 'suspect' && q.rejects(w.db, 'l4', 'L1', '山線') === 'stale_date', J({ v: q.verdicts(w.db, 'l4', 'L1'), rej: q.rejects(w.db, 'l4', 'L1', '山線') }));
  }
  // L5：直接呼叫閘門（沒有 cron、沒有資料庫）：ctx.uploadedAt 給了就用它；沒給（或 0）退回 ctx.now，舊用法的行為不變
  { const gate = ctx => impl.api.integrityGate({ tripDate: D28, pts: [] }, ctx, RULES);
    const g1 = gate({ now: TRIP_MS + 10 * DAY, uploadedAt: TRIP_MS + DAY });
    c('L5a [S14 閘門] now 晚乘車日 10 天、但上傳時間只晚 1 天：通過', g1.pass === true, J(g1));
    const g2 = gate({ now: TRIP_MS + 10 * DAY });
    c('L5b [S14 退路] 沒給 uploadedAt：退回 now，10 天前的乘車日 → stale_date', g2.pass === false && g2.code === 'stale_date', J(g2));
    const g3 = gate({ now: TRIP_MS + 10 * DAY, uploadedAt: 0 });
    c('L5c [S14 退路] uploadedAt＝0 視同沒給：退回 now → stale_date', g3.pass === false && g3.code === 'stale_date', J(g3));
    const g4 = gate({ now: TRIP_MS - 3 * DAY, uploadedAt: TRIP_MS + DAY });
    c('L5d [S14 閘門] now 早於乘車日（時鐘異常）、但上傳時間合理（乘車日隔天）：通過（不再拿 now 判 future_date）', g4.pass === true, J(g4));
    const g5 = gate({ now: TRIP_MS + 3 * DAY, uploadedAt: TRIP_MS - 3 * DAY });
    c('L5e [S14 閘門] 上傳時間比乘車日早 3 天：future_date（now 再晚都一樣）', g5.pass === false && g5.code === 'future_date', J(g5));
  }
});

// ── 跑場景 ──
// 場景跑兩遍：新版（判準要全綠）、對照版（結果收進 CT，K0 組拿去對「該紅／該綠」的名單）
const CT = {};
for (const [name, fn] of SCN) {
  await attempt(name, () => fn(NEW, ok));
  if (CTL) {
    try { await fn(CTL, (n, p, msg) => { CT[String(n).split(/\s+/)[0]] = { p: !!p, msg }; }); }
    catch (e) { CT['!' + name] = { p: false, msg: 'threw: ' + String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ') }; }
  }
}

// ═══ K0 組：正向對照——同一批場景在對照版（c2e81e3b）上的顏色 ═══════════════════════════
// 「新行為」那幾條在對照版上必須紅：證明判準真的有牙（不是拿新版自己的輸出當期望、或恆真）。
// 「舊行為本來就對」那幾條在對照版上必須綠：證明 fixture 本身沒壞（紅是行為造成的，不是資料寫歪了）。
// 這兩份名單是在看到對照版任何結果之前，依各條判準「舊版會怎麼做」推論寫下的。
const K0_EXPECT = {
  H: { red: ['H1a', 'H1b', 'H2a', 'H2b'], green: ['H1p', 'H2p', 'H4a', 'H4b'] },
  I: { red: ['I1a', 'I2a'], green: ['I1p', 'I1b', 'I1c', 'I3a', 'I4a'] },
  J: {
    red: ['J1a', 'J2a', 'J3a', 'J3b', 'J4a', 'J6a', 'J6b', 'J7a', 'J8a', 'J8b', 'J11a', 'J11b', 'J12a', 'J13b', 'J14a'],
    green: ['J1p', 'J1b', 'J1c', 'J1d', 'J2b', 'J4p', 'J4b', 'J5a', 'J7p', 'J8p', 'J8bp', 'J9a', 'J9b', 'J9c', 'J12p', 'J13p', 'J13a', 'J14p'],
  },
  // L2e／L3d 是 review-B B1 追加：對照版拿 cron 的 now 比（LATE 晚 10 天 → L2e 判 stale；NOW_MS 在乘車日之後 → L3d 放行）
  L: { red: ['L1a', 'L1b', 'L2c', 'L2e', 'L3a', 'L3c', 'L5a', 'L5d', 'L5e'], green: ['L2a', 'L2b', 'L2d', 'L3b', 'L3d', 'L4a', 'L5b', 'L5c'] },
};
await attempt('K0', async () => {
  if (!CTL) { ok('K0a [對照版] 對照版載入失敗，無法做正向對照', false, ctlErr); return; }
  const threw = Object.keys(CT).filter(k => k.startsWith('!'));
  ok('K0a [對照版] 所有場景在對照版上都跑得完（沒有丟例外；例外不算「紅」，是 fixture 或載入壞了）', threw.length === 0 && CTL_ERRS.length === 0, J({ 場景: threw.map(k => [k, CT[k].msg]), 判定: CTL_ERRS }));
  for (const [g, { red, green }] of Object.entries(K0_EXPECT)) {
    const notRed = red.filter(n => !(CT[n] && CT[n].p === false)), notGreen = green.filter(n => !(CT[n] && CT[n].p === true));
    ok(`K0${g} [正向對照 ${g}] 對照版上：該紅的 ${red.length} 條都紅、該綠的 ${green.length} 條都綠`,
      notRed.length === 0 && notGreen.length === 0, J({ 該紅卻沒紅: notRed, 該綠卻沒綠: notGreen }));
  }
  const listed = new Set(Object.values(K0_EXPECT).flatMap(x => x.red.concat(x.green)));
  const unlisted = Object.keys(CT).filter(n => !n.startsWith('!') && !listed.has(n));
  ok('K0z [正向對照] 每一條 H／I／J／L 判準都有人講過它在對照版該是什麼顏色（名單沒漏、沒有多寫不存在的名字）',
    unlisted.length === 0 && [...listed].every(n => n in CT), J({ 沒列進名單: unlisted, 名單裡不存在: [...listed].filter(n => !(n in CT)) }));
});
// ═══ K 組：批次化等價與查詢量（S13a）═══════════════════════════════════════════════════
// 第③段舊版逐段各打 2–4 句 D1（一趟 30 段約 130 句）；新版每一組的認領與板價各一句查完（段鍵包成 JSON 陣列交給 json_each）、
// 寫入收進 db.batch 分塊。查詢怎麼打變了，結果必須逐位元組相同：新舊各從乾淨 DB 跑同一批資料，六張表逐列比對。
// 範圍：不含「讀與寫之間發生合併」、可疑、前次已判定列、乘車日超過 7 天窗——那些是 S10–S14 刻意改變的行為，不是批次化的等價範圍。
const DUMP = [
  ['bounty_samples', 'id', 'id,actor,sys,ln_id,train_no,dir,trip_date,submitted_at,verdict,verdict_at,quality_code,reject_code,segs'],
  ['bounty_points', 'actor', 'actor,uid,points,merged_into,updated_at'],
  ['bounty_board', 'seg_key,train_kind,dir,kind,slot', 'seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users'],
  ['bounty_claims', 'id', 'id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status'],
  ['chip_ledger', 'id', 'id,actor,kind,delta,ref,day,created_at'],
  ['bounty_seg_contrib', 'seg_key,actor', 'seg_key,actor,first_ok_at'],
];
const dumpDb = db => Object.fromEntries(DUMP.map(([t, ob, cols]) => [t, db.prepare(`SELECT ${cols} FROM ${t} ORDER BY ${ob}`).all().map(r => ({ ...r }))]));
const dumpSizes = d => Object.fromEntries(Object.entries(d).map(([t, rows]) => [t, rows.length]));
// 「相等」只在兩邊都有東西時才有意義：這些表在該 fixture 裡不應是空的（空對空的相等沒有資訊）
const nonEmpty = (d, skip = []) => Object.entries(d).every(([t, rows]) => skip.includes(t) || rows.length > 0);
function diffDump(a, b) {
  const out = [];
  for (const t of Object.keys(a)) {
    if (a[t].length !== b[t].length) { out.push(`${t}: 列數 ${a[t].length} vs ${b[t].length}`); continue; }
    const i = a[t].findIndex((r, k) => J(r) !== J(b[t][k]));
    if (i >= 0) out.push(`${t}[${i}]: ${J(a[t][i]).slice(0, 200)} vs ${J(b[t][i]).slice(0, 200)}`);
  }
  return out;
}
const STAT_KEYS = ['trips', 'ok', 'unusable', 'suspect', 'truncated', 'chips'];
const statJ = st => J(STAT_KEYS.map(k => st[k]));
const noCtl = (name, why) => ok(`${name}（對照版取不到）`, false, `${why}：${ctlErr}`);

// ── K1：小合成世界。多車種、雙方向、同段多筆認領（靠 claimed_at、靠 id 定序）、過期／別人的／已完成／方向不符的認領、同分要靠車種名定序、dwell ──
const K_TB = [];
for (const s of SEGS10) {
  const tie = s === 'S6|S7';                                    // S6|S7 的兩個車種同分（4）：同分時取 train_kind 字典序小的（區間車 < 自強）
  K_TB.push({ k: KT('山線', s), tk: '自強', dir: 0, pts: tie ? 4 : 5 }, { k: KT('山線', s), tk: '區間車', dir: 0, pts: tie ? 4 : 3 },
    { k: KT('山線', s), tk: '自強', dir: 1, pts: 7 }, { k: KT('山線', s), tk: '區間車', dir: 1, pts: 2 });
}
const DKEY = KT('山線', 'S3|S3');                                 // 山線 S3 站的停靠（dwell）鍵
K_TB.push({ k: DKEY, tk: '自強', kind: 'dwell', slot: 'peak', pts: 6 }, { k: DKEY, tk: '區間車', kind: 'dwell', slot: 'peak', pts: 2 },
  { k: DKEY, tk: '自強', kind: 'dwell', slot: 'off', pts: 3 });
for (const s of SEGS10.slice(0, 4)) K_TB.push({ k: KT('南迴線', s), tk: '自強', pts: 6 });     // 南迴線只上架前 4 段
const K_CL = [
  { id: 'c-b', actor: 'k-a', seg: KT('山線', 'S0|S1'), pts: 9, at: 100 },
  { id: 'c-a', actor: 'k-a', seg: KT('山線', 'S0|S1'), pts: 11, at: 200 },                    // 同段兩張：claimed_at 較晚的（11）
  { id: 'c-x', actor: 'k-a', seg: KT('山線', 'S1|S2'), pts: 20, at: 100 },
  { id: 'c-y', actor: 'k-a', seg: KT('山線', 'S1|S2'), pts: 25, at: 100 },                    // claimed_at 相同：id 較大的（c-y，25）
  { id: 'c-exp', actor: 'k-a', seg: KT('山線', 'S2|S3'), pts: 50, exp: 1 },                   // 已過期：不採用
  { id: 'c-other', actor: 'k-b', seg: KT('山線', 'S3|S4'), pts: 14 },                         // 別人的：k-a 不採用（k-b 的趟才用）
  { id: 'c-done', actor: 'k-a', seg: KT('山線', 'S4|S5'), pts: 60, status: 'fulfilled' },     // 已完成：不採用
  { id: 'c-dir1', actor: 'k-a', seg: KT('山線', 'S5|S6'), pts: 40, dir: 1 },                  // 方向不符：往 dir 0 的趟不採用（dir 1 的趟才用）
  { id: 'c-tie', actor: 'k-a', seg: KT('山線', 'S6|S7'), pts: 30 },                           // 鎖了自強：勝過板上同分挑中的區間車
  { id: 'c-dwell', actor: 'k-b', seg: DKEY, pts: 12, kind: 'dwell', slot: 'peak' },           // dwell 的認領
];
// [actor, 車次, 乘車日, 線, 軌跡, dir, first]
const K_TRAINS = [
  ['k-a', 'K1', D28, '山線', pad2(leg({ sec: 700 })), 0, 0],
  ['k-a', 'K2', D28, '山線', pad2(leg({ sec: 700, d0: 14000, reverse: true })), 1, 0],
  ['k-b', 'K3', D28, '山線', pad2(stopGo({ d0: 0, d1: 14000, stops: [6000] })), 0, 0],       // S3 站（6000 m）停靠 → 有 dwell 覆蓋
  ['k-c', 'K4', D28, '屏東線', pad2(leg({ sec: 700 })), 0, 0],                                // 屏東線沒有任何板上列
  ['k-d', 'K5', D28, '南迴線', pad2(leg({ sec: 700 })), 0, 0],                                // 南迴線板上只有前 4 段
  ['k-e', 'K6', D28, '山線', pad2(leg({ sec: 4 })), 0, 0],                                    // 5 點 → unusable
  ['k-g', 'K7', D27, '山線', pad2(leg({ sec: 700 })), 0, 0],                                  // 前一天
  ['k-f', 'K8', D28, '屏東線', pad2(leg({ sec: 400, t0: 30000 })), 0, 0],                     // 直通：屏東 400＋南迴 400
  ['k-f', 'K8', D28, '南迴線', pad2(leg({ sec: 400, t0: 30401 })), 0, 100],
];
async function runRich(impl) {
  const w = world({ impl, units: UNITS_PEAK, tally: true, seed: boardRows(K_TB) + '\n' + K_CL.map(claimSql).join('\n') });
  for (const [actor, trainNo, date, lnId, pts, dir, first] of K_TRAINS) putBatches(w.db, { actor, trainNo, date, lnId, pts, dir, first });
  const st = await w.cron();
  return { w, st, dump: dumpDb(w.db) };
}
await attempt('K1', async () => {
  const a = await runRich(NEW);
  const w = a.w, st = a.st;
  // 手算的期望（不看實作、不看對照版）：
  // k-a 的 K1（dir 0，S0…S6|S7 共 7 段）：S0|S1 認領 c-a＝11（claimed_at 較晚）＋ S1|S2 認領 c-y＝25（同 claimed_at 取 id 大的）＋ S2|S3 板價 5（認領已過期）
  //   ＋ S3|S4 板價 5（認領是 k-b 的）＋ S4|S5 板價 5（認領已完成）＋ S5|S6 板價 5（認領方向不符）＋ S6|S7 認領 c-tie＝30 → 86。
  // k-a 的 K2（dir 1）：S5|S6 認領 c-dir1＝40 ＋ 其餘 6 段 dir 1 板價 7×6＝42 → 82。合計 168。
  // k-b 的 K3（dir 0、S3 站停靠）：S0|S1 5、S1|S2 5、S2|S3 5、S3|S4 認領 c-other＝14、S4|S5 5、S5|S6 5、S6|S7 同分取區間車 4 → 43；
  //   ＋ S3 站 dwell（尖峰）認領 c-dwell＝12 → 55。
  // k-c：屏東線板上沒有任何列 → 0（仍有點數列）。k-d：南迴線板上前 4 段 × 6＝24。k-e：unusable、沒有覆蓋段 → 0。k-f：屏東 0＋南迴前 4 段 6×4＝24。
  // k-g（前一天、沒有認領）：S0…S5 板價 5×6＝30 ＋ S6|S7 同分取區間車 4 → 34。
  const pts = ['k-a', 'k-b', 'k-c', 'k-d', 'k-e', 'k-f', 'k-g'].map(x => q.points(w.db, x));
  ok('K1p [S13a 前置] fixture 走到每一條分支：手算的點數 k-a 168、k-b 55（含 dwell）、k-c 0、k-d 24、k-e 0、k-f 24、k-g 34',
    J(pts) === J([168, 55, 0, 24, 0, 24, 34]), J(pts));
  const dwellRows = w.db.prepare("SELECT train_kind,slot,sample_count FROM bounty_board WHERE seg_key=? AND kind='dwell' ORDER BY train_kind,slot").all(DKEY).map(r => [r.train_kind, r.slot, r.sample_count]);
  const tieRows = q.board(w.db, KT('山線', 'S6|S7')).map(r => [r.train_kind, r.dir, r.sample_count]);
  ok('K1q [S13a 前置] 板價挑法與認領鎖的車種：S6|S7 同分取區間車（k-b、k-g 各 +1＝2），k-a 鎖的自強 +1、dir 1 的自強 +1；dwell 只有 k-b 的尖峰自強 +1',
    J(tieRows) === J([['區間車', 0, 2], ['區間車', 1, 0], ['自強', 0, 1], ['自強', 1, 1]]) &&
      J(dwellRows) === J([['區間車', 'peak', 0], ['自強', 'off', 0], ['自強', 'peak', 1]]), J({ tieRows, dwellRows }));
  const open = w.db.prepare("SELECT COUNT(*) c FROM bounty_claims WHERE status='open'").get().c;
  ok('K1r [S13a 前置] 認領的關法：10 張認領（含過期的、已完成的）判完後沒有任何 open；帳本 9 顆（k-a 2、k-b 1、k-c 1、k-d 2、k-f 2、k-g 1）；線組 9、班車 8',
    open === 0 && st.chips === 9 && st.trips === 9 && st.trains === 8 && q.tripRows(w.db).length === 7, J({ open, chips: st.chips, trips: st.trips, trains: st.trains, rows: q.tripRows(w.db).length }));
  ok('K1d [S13a 計數] 計數器與測試端獨立計數一致（多班車、多線組）：stat.subreq＝測試端在下一層數到的 first／run／all／raw＋batch＋exec＋fetch',
    st.subreq === w.tally.n, J({ subreq: st.subreq, tally: { n: w.tally.n, query: w.tally.query, batch: w.tally.batch, exec: w.tally.exec, fetch: w.tally.fetch } }));
  // K1e／K1f 查詢計畫：拿 worker 真正送出的 SQL 文字（測試端計數替身記下的），對「沒有統計資料的表」跑 EXPLAIN QUERY PLAN。
  // 為什麼要驗：D1 文件要使用者建索引後自己跑 PRAGMA optimize，沒跑就沒有統計；這種情況下認領那句原本會被 SQLite 挑到 idx_claims_expiry
  // （掃全站所有還沒過期的 open 認領、再逐列比對 actor——9,000 列的探針比走 idx_claims_actor 慢約 15 倍、隨全站認領數線性長）。
  // 結果一模一樣、只是慢，所以前面沒有任何一條等價判準看得到它；索引是唯一「遺失後完全無聲」的東西（verify_bounty_schema 的 A11 同一個道理）。
  // 判準刻意不寫成「不能有 SCAN」而是點名「用哪個索引、用到哪幾欄」：走對索引但只用到前綴一欄（例如 idx_samples_trip 只吃 actor）也是慢。
  const sqlOf = re => [...w.tally.sqls].filter(x => re.test(x));
  const planOf = sql => w.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array((sql.match(/\?/g) || []).length).fill(null)).map(r => String(r.detail)).join(' ; ');
  // review-B 之後的句子：認領的 actor 改成 SQL 裡當場解析（actor=COALESCE(...)）；pending 掃描拆成「班車清單」（WITH t AS）與「一班一班讀」兩句；
  // 標記改成一組一句（id IN json_each）；sample_count 與關認領改成一組一句（row value IN json_each）。
  const P = {
    list: sqlOf(/^WITH t AS \(/),
    load: sqlOf(/^SELECT \* FROM \(SELECT \*, SUM\(length\(payload\)\) OVER \(ORDER BY submitted_at, id ROWS UNBOUNDED PRECEDING\) AS cum_bytes FROM bounty_samples (?:INDEXED BY idx_samples_trip )?WHERE actor=\? AND trip_date=\? AND train_no=\? AND verdict='pending'\)/),
    prior: sqlOf(/FROM bounty_samples s (?:INDEXED BY idx_samples_trip )?LEFT JOIN json_each\(/),          // 前次線組（獨立驗收 C4 之後在 SQL 裡依線彙總，樣本表別名 s）
    mark: sqlOf(/^UPDATE bounty_samples (?:INDEXED BY sqlite_autoindex_bounty_samples_1 )?SET verdict=\?/),
    points: sqlOf(/^INSERT INTO bounty_points \(actor,uid,points,merged_into,updated_at\) SELECT/),
    claims: sqlOf(/FROM bounty_claims (?:INDEXED BY idx_claims_actor )?WHERE actor=COALESCE\(.*status='open'.*json_each/),
    board: sqlOf(/FROM bounty_board WHERE seg_key IN \(SELECT value FROM json_each/),
    count: sqlOf(/^UPDATE bounty_board SET sample_count = sample_count \+ 1 WHERE \(seg_key, train_kind, dir, kind, slot\) IN/),
    close: sqlOf(/^UPDATE bounty_claims (?:INDEXED BY idx_claims_actor )?SET status='fulfilled' WHERE actor=COALESCE/),
  };
  const plans = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.length === 1 ? planOf(v[0]) : `（抓到 ${v.length} 句，應該剛好 1 句）`]));
  ok('K1e [S13a 查詢計畫] 認領那句（讀與關）走 idx_claims_actor（actor, status 兩欄），不走 idx_claims_expiry（全站掃）；板價那句走主鍵（每個段鍵一次點查）；sample_count 那句吃滿主鍵五欄',
    P.claims.length === 1 && P.board.length === 1 && P.close.length === 1 && P.count.length === 1 &&
      /SEARCH bounty_claims USING INDEX idx_claims_actor \(actor=\? AND status=\?\)/.test(plans.claims) && !/idx_claims_expiry/.test(plans.claims) &&
      /SEARCH bounty_claims USING INDEX idx_claims_actor \(actor=\? AND status=\?\)/.test(plans.close) && !/idx_claims_expiry/.test(plans.close) &&
      /SEARCH bounty_board USING (PRIMARY KEY|INDEX sqlite_autoindex_bounty_board_\d+) \(seg_key=\?\)/.test(plans.board) && !/SCAN bounty_board/.test(plans.board) &&
      /SEARCH bounty_board USING (PRIMARY KEY|INDEX sqlite_autoindex_bounty_board_\d+) \(seg_key=\? AND train_kind=\? AND dir=\? AND kind=\? AND slot=\?\)/.test(plans.count),
    J({ claims: plans.claims, close: plans.close, board: plans.board, count: plans.count }));
  // 標記那句：沒有 +verdict 的一元加號，SQLite 會拿 verdict='pending' 走 idx_samples_pending、每一組掃一次全站 pending（K1f 的 mark）。
  // 班車清單：pending 走 idx_samples_pending（verdict＋乘車日）、可信判斷的帳本子查詢走 idx_chip_ledger_actor_day（不掃整本帳）、
  // 「以前出過錯」的子查詢（kv_blobs x）與第③段每一句的租約圍欄都是 kv_blobs 主鍵點查（k=?），不掃整張 kv_blobs（它也放別的快取）。
  const KV_PK = /SEARCH (x|kv_blobs)( EXISTS)? USING (PRIMARY KEY|INDEX sqlite_autoindex_kv_blobs_\d+) \(k=\?\)/;   // 點數那句 SQLite 寫成「SEARCH kv_blobs EXISTS USING …」
  ok('K1f [S12／S13c／review-B 查詢計畫] 班車清單走 idx_samples_pending（verdict＋乘車日）、帳本子查詢走 idx_chip_ledger_actor_day、出錯記錄子查詢走 kv_blobs 主鍵；' +
    '一班一班讀與前次列都走 idx_samples_trip 吃滿三欄；標記走主鍵（id），不走 idx_samples_pending；第③段各句的租約圍欄走 kv_blobs 主鍵、沒有任何一句掃 kv_blobs',
    Object.values(P).every(v => v.length === 1) &&
      /SEARCH s USING INDEX idx_samples_pending \(verdict=\? AND trip_date<\?\)/.test(plans.list) && /SEARCH l USING INDEX idx_chip_ledger_actor_day \(actor=\?/.test(plans.list) &&
      !/SCAN (s|l|x|bounty_samples|chip_ledger|kv_blobs)\b/.test(plans.list) && KV_PK.test(plans.list) &&
      ['mark', 'points', 'count', 'close'].every(k => KV_PK.test(plans[k]) && !/SCAN kv_blobs\b/.test(plans[k])) &&
      /SEARCH bounty_samples USING INDEX idx_samples_trip \(actor=\? AND trip_date=\? AND train_no=\?\)/.test(plans.load) &&
      /SEARCH (s|bounty_samples) USING INDEX idx_samples_trip \(actor=\? AND trip_date=\? AND train_no=\?\)/.test(plans.prior) &&
      /SEARCH bounty_samples USING INDEX sqlite_autoindex_bounty_samples_\d+ \(id=\?\)/.test(plans.mark) && !/idx_samples_pending/.test(plans.mark),
    J({ list: plans.list, load: plans.load, prior: plans.prior, mark: plans.mark, points: plans.points, count: plans.count, close: plans.close }));
  // K1g：第二輪獨立驗收之後新增的子查詢。② 的籌碼那句與登記那一批帶「樣本還在」（BOUNTY_VERIFY_PENDING）、第③段的點數／sample_count／關認領
  // 帶「真的標到」（MARKED）：兩者都是 bounty_samples 的 id IN json_each，要走主鍵（每個 id 一次點查），不能拿 verdict 去走 idx_samples_pending
  // （那是全站 pending 的掃描，每班、每組各掃一次，積壓越多越慢）；籌碼那句的帳本子查詢（這班入過帳沒、當日已領幾顆）走 idx_chip_ledger_actor_day 吃滿兩欄；
  // 每一句的租約圍欄走 kv_blobs 主鍵。
  const P2 = {
    chips: sqlOf(/^INSERT OR IGNORE INTO chip_ledger/),
    users: sqlOf(/^UPDATE bounty_board SET distinct_ok_users = distinct_ok_users \+ 1/),
    contrib: sqlOf(/^INSERT OR IGNORE INTO bounty_seg_contrib/),
    covered: sqlOf(/^UPDATE bounty_board SET covered_at = COALESCE\(covered_at, \?\)/),
  };
  const plans2 = Object.fromEntries(Object.entries(P2).map(([k, v]) => [k, v.length === 1 ? planOf(v[0]) : `（抓到 ${v.length} 句，應該剛好 1 句）`]));
  const SAMPLES_PK = /SEARCH bounty_samples USING INDEX sqlite_autoindex_bounty_samples_\d+ \(id=\?\)/;
  const fenced = [plans2.chips, plans2.users, plans2.contrib, plans2.covered, plans.points, plans.count, plans.close];
  ok('K1g [第二輪 D2／D3／D5 查詢計畫] 籌碼那句、登記那一批三句、第③段的點數／sample_count／關認領：樣本子查詢走主鍵（id），不走 idx_samples_pending、不掃 bounty_samples；' +
    '租約圍欄走 kv_blobs 主鍵；籌碼那句的帳本子查詢走 idx_chip_ledger_actor_day（actor＋day）、不掃帳本',
    Object.values(P2).every(v => v.length === 1) &&
      fenced.every(p => SAMPLES_PK.test(p) && !/idx_samples_pending/.test(p) && !/SCAN bounty_samples\b/.test(p) && KV_PK.test(p) && !/SCAN kv_blobs\b/.test(p)) &&
      /SEARCH chip_ledger USING INDEX idx_chip_ledger_actor_day \(actor=\? AND day=\?\)/.test(plans2.chips) && !/SCAN chip_ledger\b/.test(plans2.chips),
    J({ ...plans2, points: plans.points, count: plans.count, close: plans.close }));
  // K1h：每一發開頭的出錯記錄清掃（第二輪 B4c／B4d）。kv_blobs 也放別的快取，這一句只能走主鍵的範圍掃描（出錯記錄那一段），
  // 每一列再用 idx_samples_trip 吃滿三欄點查「那班車還有沒有 pending」——掃整張 kv_blobs 或整張樣本表，每一發都是全表級的讀取。
  const sweep = sqlOf(/^DELETE FROM kv_blobs WHERE k >= \? AND k < \? AND NOT EXISTS \(SELECT 1 FROM bounty_samples s/);
  const planSweep = sweep.length === 1 ? planOf(sweep[0]) : `（抓到 ${sweep.length} 句，應該剛好 1 句）`;
  ok('K1h [第二輪 B4c／B4d 查詢計畫] 出錯記錄清掃：kv_blobs 走主鍵範圍（k>? AND k<?）、樣本走 idx_samples_trip 吃滿三欄，不掃 kv_blobs、不掃樣本表、不走 idx_samples_pending；租約圍欄走 kv_blobs 主鍵',
    sweep.length === 1 && /SEARCH kv_blobs USING PRIMARY KEY \(k>\? AND k<\?\)/.test(planSweep) &&
      /SEARCH s USING (COVERING )?INDEX idx_samples_trip \(actor=\? AND trip_date=\? AND train_no=\?\)/.test(planSweep) &&
      !/SCAN (kv_blobs|s|bounty_samples)\b/.test(planSweep) && !/idx_samples_pending/.test(planSweep) && /SEARCH kv_blobs USING PRIMARY KEY \(k=\?\)/.test(planSweep),
    planSweep);
  if (!CTL) return noCtl('K1a', '無法比對等價');
  const b = await runRich(CTL);
  const diffs = diffDump(a.dump, b.dump);
  ok('K1a [S13a 等價] 新舊各從乾淨 DB 跑同一批資料：六張表逐列相等（樣本判定、點數、看板、認領、帳本、貢獻），且每張表都不是空的（空對空的「相等」沒有資訊）',
    diffs.length === 0 && nonEmpty(a.dump), J({ diffs, sizes: dumpSizes(a.dump) }));
  ok('K1b [S13a 等價] stat 共同欄位相等（trips／ok／unusable／suspect／truncated／chips）', statJ(a.st) === statJ(b.st), J({ 新: statJ(a.st), 舊: statJ(b.st) }));
  ok('K1c [S13a 查詢量] 同一批資料，新版的 D1＋fetch 子請求數遠少於舊版（測試端獨立計數）',
    a.w.tally.n * 2 < b.w.tally.n, J({ 新: a.w.tally.n, 舊: b.w.tally.n }));
});

// ── K2：分塊邊界。長線 61 站、60 段：39 段的趟寫入 1＋2×39＝79 句（一塊）、40 段的趟 1＋2×40＝81 句（80＋1，兩塊；最後一句在第二塊）──
// 每段兩句（sample_count＋關認領），最後一句＝最後一段的「關認領」——所以兩班車各在自己的最後一段掛一張認領（cl-39 鎖 5 點、cl-40 鎖 7 點）：
// 最後一塊只有這一句時，它有沒有寫進去看認領有沒有被關成 fulfilled 就知道（沒有認領的話，最後一句寫不寫都看不出來）。
// （review-B 之後寫入不再分塊：一組的標記、點數、sample_count、關認領是同一個 batch。這組照留，當「長趟的最後一段也寫進去了」與新舊等價的判準。）
async function runLong(impl) {
  const claims = claimSql({ id: 'cl-39', actor: 'kc-39', seg: KT('長線', LONG_SEGS[38]), pts: 5 }) + '\n' + claimSql({ id: 'cl-40', actor: 'kc-40', seg: KT('長線', LONG_SEGS[39]), pts: 7 });
  const w = world({ impl, tally: true, seed: boardSql('tra_sched', '長線', [{}], LONG_SEGS) + '\n' + claims });
  putBatches(w.db, { actor: 'kc-39', trainNo: 'C39', lnId: '長線', pts: pad2(leg({ sec: 3900 })) });     // 78 km → 39 段
  putBatches(w.db, { actor: 'kc-40', trainNo: 'C40', lnId: '長線', pts: pad2(leg({ sec: 4000 })) });     // 80 km → 40 段
  const st = await w.cron();
  return { w, st, dump: dumpDb(w.db) };
}
await attempt('K2', async () => {
  const a = await runLong(NEW);
  const w = a.w;
  const tot = w.db.prepare('SELECT SUM(sample_count) s, MAX(sample_count) m FROM bounty_board').get();
  const last = w.db.prepare("SELECT sample_count c FROM bounty_board WHERE seg_key=?").get(KT('長線', LONG_SEGS[39])).c;
  // 手算：kc-39 覆蓋 39 段（板價 3）、最後一段（第 39 段）認領鎖 5 → 38×3＋5＝119；kc-40 覆蓋 40 段、最後一段認領鎖 7 → 39×3＋7＝124。
  const cl = ['cl-39', 'cl-40'].map(id => q.claim(w.db, id).status);
  ok('K2p [S13a 分塊] 兩班車的覆蓋段都寫進看板：sample_count 總和 79（39＋40）、最大 2（前 39 段兩班車都經過）、第 40 段（81 句裡的倒數第二句）＝1；兩張認領（各在最後一段，也就是各自最後一句）都被關成 fulfilled；點數 119／124',
    tot.s === 79 && tot.m === 2 && last === 1 && q.nContrib(w.db, 'kc-39') === 39 && q.nContrib(w.db, 'kc-40') === 40 && q.points(w.db, 'kc-40') === 124 && q.points(w.db, 'kc-39') === 119 && J(cl) === J(['fulfilled', 'fulfilled']),
    J({ tot, last, c39: q.nContrib(w.db, 'kc-39'), c40: q.nContrib(w.db, 'kc-40'), p39: q.points(w.db, 'kc-39'), p40: q.points(w.db, 'kc-40'), cl }));
  if (!CTL) return noCtl('K2a', '無法比對等價');
  const b = await runLong(CTL);
  const diffs = diffDump(a.dump, b.dump);
  ok('K2a [S13a 等價] 79 句與 81 句兩種長度的寫入：新舊六張表逐列相等（非空）', diffs.length === 0 && nonEmpty(a.dump), J({ diffs, sizes: dumpSizes(a.dump) }));
});

// ── K3：真實整條線。真題庫（data/bounty_units.json）、真規則；縱貫線南段（46 站，最長）與南迴線（12 站，偏遠）各一班「逐站停靠」整條跑完的車 ──
// 覆蓋項＝每個區間一個軌道（站數−1）＋每個中間站一個停靠（站數−2）；寫入句數 1＋2×計功項。
const REAL_UNITS = JSON.parse(readFileSync(join(ROOT, 'data/bounty_units.json'), 'utf8'));
// 板價：依題庫的單位逐列上架，點數用固定的函式（1＋(序號×7 mod 5)：有同分也有不同分），時間戳釘死，兩邊才逐列比得起來。
const seedRealBoard = db => {
  db.exec('BEGIN');
  const ins = db.prepare('INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users)' +
    ' VALUES (?,?,?,?,?,?,1,1,?,?,1,1,0,NULL,0)');
  REAL_UNITS.units.forEach((u, i) => ins.run(u.segKey, u.sys, u.trainKind, u.dir, u.kind, u.slot || '', 1 + ((i * 7) % 5), Number(u.perDay) || 0));
  db.exec('COMMIT');
};
const fullLine = key => {
  const sts = REAL_UNITS.lines[key].stations.slice().sort((a, b) => a.d - b.d);
  return { nSt: sts.length, pts: pad2(stopGo({ d0: sts[0].d * 1000, d1: sts[sts.length - 1].d * 1000, stops: sts.slice(1, -1).map(s => s.d * 1000), t0: 21600 })) };
};
const CAP = {};
async function runReal(impl, key, actor) {
  const { pts, nSt } = fullLine(key);
  const w = world({ impl, units: REAL_UNITS, tally: true, afterOpen: seedRealBoard });
  putBatches(w.db, { actor, trainNo: 'R1', lnId: REAL_UNITS.lines[key].lnId, pts, size: 60 });
  const st = await w.cron();
  return { w, st, nSt, nPts: pts.length, dump: dumpDb(w.db) };
}
for (const [key, actor] of [['tra_sched|縱貫線南段', 'real-a'], ['tra_sched|南迴線', 'real-b']]) {
  await attempt(`K3 ${key}`, async () => {
    const tag = key.split('|')[1];
    const a = await runReal(NEW, key, actor);
    const w = a.w;
    const nCov = q.nContrib(w.db, actor), nCred = w.db.prepare('SELECT COUNT(*) c FROM bounty_board WHERE sample_count>0').get().c;
    ok(`K3p ${tag} [S13a 前置] 整條線一班車判 ok，覆蓋項＝${a.nSt - 1} 個區間＋${a.nSt - 2} 個中間站停靠＝${2 * a.nSt - 3}（登記的段數）、這一班入帳（${a.st.chips} 顆）`,
      q.verdicts(w.db, actor, 'R1') === 'ok' && nCov === 2 * a.nSt - 3 && a.st.trips === 1 && a.st.chips >= 1, J({ v: q.verdicts(w.db, actor, 'R1'), nCov, expect: 2 * a.nSt - 3, st: a.st, pts: a.nPts }));
    ok(`K3d ${tag} [S13a 計數] 真實整條線：計數器＝測試端獨立計數（子請求 ${a.st.subreq}）`, a.st.subreq === w.tally.n, J({ subreq: a.st.subreq, tally: w.tally.n }));
    CAP[tag] = { newN: w.tally.n, by: { query: w.tally.query, batch: w.tally.batch, fetch: w.tally.fetch }, nCov, nCred, nSt: a.nSt, nPts: a.nPts };
    if (!CTL) return noCtl(`K3a ${tag}`, '無法比對等價');
    const b = await runReal(CTL, key, actor);
    const diffs = diffDump(a.dump, b.dump);
    ok(`K3a ${tag} [S13a 等價] 真題庫整條線（覆蓋 ${nCov} 項、寫入 ${1 + 2 * nCred} 句＝${Math.ceil((1 + 2 * nCred) / 80)} 塊）：新舊六張表逐列相等（非空）`,
      diffs.length === 0 && nonEmpty(a.dump, ['bounty_claims']), J({ diffs, sizes: dumpSizes(a.dump) }));
    ok(`K3b ${tag} [S13a 等價] stat 共同欄位相等`, statJ(a.st) === statJ(b.st), J({ 新: statJ(a.st), 舊: statJ(b.st) }));
    CAP[tag].oldN = b.w.tally.n;
  });
}
// ── K5：覆蓋段超過 100 個（D1 每句最多 100 個綁定參數）。超長線 121 站、120 個區間，一班車整條跑完＝120 個覆蓋項 ──
// 舊版逐段各打一句，每句綁定 ≤ 10 個；新版一句查一整組，段鍵若「動態展開成 IN (?,?,…)」就會綁 120＋2 個 → 真的 D1 直接丟例外。
// 所以段鍵包成一個 JSON 陣列、以 json_each 展開（每一句只綁 3 個以內）。假 D1 沒有這個上限——測試端的計數替身（tallyEnv）幫它擋：超過 100 就丟例外。
async function runXL(impl) {
  // 最後一段掛一張認領（鎖 9 點）：它有沒有被關成 fulfilled＝最後一段有沒有寫進去（舊版分塊時是「241 句裡的最後一句、第 4 塊只有這一句」；
  // review-B 之後關認領是一組一句，這張認領在那一句的 json_each 陣列最末）
  const claim = claimSql({ id: 'cl-x', actor: 'kx', seg: KT('超長線', XL_SEGS[119]), pts: 9 });
  const w = world({ impl, tally: true, seed: boardSql('tra_sched', '超長線', [{ points: 1 }], XL_SEGS) + '\n' + claim });
  putBatches(w.db, { actor: 'kx', trainNo: 'X1', lnId: '超長線', pts: pad2(leg({ sec: 12000 })) });        // 240 km → 120 個區間
  let st = null, err = null;
  st = await w.cron();
  err = st.threw || null;                                                  // w.cron 接住例外、回 { threw }（見 world）
  return { w, st, err, dump: dumpDb(w.db) };
}
await attempt('K5', async () => {
  const a = await runXL(NEW);
  const w = a.w;
  const tot = w.db.prepare('SELECT SUM(sample_count) s, MIN(sample_count) lo, MAX(sample_count) hi, SUM(distinct_ok_users) d FROM bounty_board').get();
  // 手算：119 個區間 × 板價 1＋最後一段認領鎖 9＝128 點（＜ 每日上限 200）；每段 sample_count 1、去重人數 1；登記 120 段；一班車 12000 秒、一般線 → 1 顆。
  // 子請求（第二輪獨立驗收之後）：一發固定 6（FIXED：規則、題庫、租約、出錯記錄清掃、班車清單、釋放租約）＋每班固定 9（K4 的手算）＝15。
  // 寫入不分塊：標記、點數、sample_count、關認領是同一個 batch（一筆交易）；去重登記也是一個 batch（段鍵走 json_each）——不論幾段都是 1。
  ok('K5p [S13a 100 參數上限] 覆蓋 120 段（＞100）的整條線一班車：流程不丟例外（沒有任何一句綁超過 100 個參數）、判 ok、點數 128、每段 sample_count 1／去重人數 1、登記 120 段、最後一句（關認領）寫進去了、入帳 1 顆、子請求恰 15',
    a.err === null && q.verdicts(w.db, 'kx', 'X1') === 'ok' && q.points(w.db, 'kx') === 128 && tot.s === 120 && tot.lo === 1 && tot.hi === 1 && tot.d === 120 &&
      q.nContrib(w.db, 'kx') === 120 && q.claim(w.db, 'cl-x').status === 'fulfilled' && a.st.chips === 1 && a.st.subreq === 15,
    J({ err: a.err, v: q.verdicts(w.db, 'kx', 'X1'), points: q.points(w.db, 'kx'), tot, contrib: q.nContrib(w.db, 'kx'), cl: q.claim(w.db, 'cl-x'), st: a.st }));
  ok('K5d [S13a 100 參數上限] 前置：這條線真的讓覆蓋段超過 100（登記 120 段），而整個 cron 期間單句綁定參數最多 ≤ 100（測試端計數替身量到的最大值）；計數器＝測試端獨立計數',
    q.nContrib(w.db, 'kx') > 100 && w.tally.maxBind >= 1 && w.tally.maxBind <= 100 && a.st && a.st.subreq === w.tally.n, J({ contrib: q.nContrib(w.db, 'kx'), maxBind: w.tally.maxBind, subreq: a.st && a.st.subreq, tally: w.tally.n }));
  if (!CTL) return noCtl('K5a', '無法比對等價');
  const b = await runXL(CTL);
  const diffs = diffDump(a.dump, b.dump);
  ok('K5a [S13a 等價] 覆蓋 120 段（寫入 241 句、4 塊）：新舊六張表逐列相等（非空）', b.err === null && diffs.length === 0 && nonEmpty(a.dump), J({ oldErr: b.err, diffs, sizes: dumpSizes(a.dump) }));
});
// ═══ K4：每班車的子請求數＝固定 9（不隨覆蓋段數成長）════════════════════════════════════════
// 手算（逐一數 bountyVerifyTrain 對「一條線」的一班車的 D1 呼叫；第二輪獨立驗收之後）：讀這班車的批次 1、逐線查逐站事件 1、身分解析 1、
// 前次已判定列 1、籌碼 1（身分、同班已入帳、當日已領、租約、樣本還在，全在寫帳本那一句裡）、去重登記 1（所有 ok 線組的段併成一個 batch，
// 段鍵走 json_each）、認領 1、板價 1、這一組的寫入 1（標記＋點數＋sample_count＋關認領同一個 batch＝同一筆交易）＝9。
// 這一條把「查詢量不隨覆蓋段數成長」釘成等式：日後任何人在逐段迴圈裡加一句查詢、或把合在一句裡的條件拆回好幾句，這條就會紅。
// 一發的固定開銷是 FIXED＝6（規則、題庫、租約、出錯記錄清掃、班車清單、釋放租約；M0a）。
const FIXED = 6;
const perTrainExpect = () => 9;
for (const tag of Object.keys(CAP)) {
  const cp = CAP[tag];
  ok(`K4 ${tag} [S13a 查詢量] 真實整條線（覆蓋 ${cp.nCov} 項、計功 ${cp.nCred} 項）：每班車子請求＝${perTrainExpect(cp.nCov)}（固定，不隨段數），實測 ${cp.newN - FIXED}`,
    cp.newN - FIXED === perTrainExpect(cp.nCov), J(cp));
}

// ═══ M 組：子請求預算、排序、共用計數器（S13b／c／d）═════════════════════════════════════
// 預算：每班車開始前檢查「已用 ≥ 預算」就停（不在班車中間停）；停手時 stat.budgetStop＝true，剩下的班車原封不動仍是 pending，下一發接著判。
const U3 = { generatedAt: 1, schedDate: D28, lines: LINES, units: [
  { segKey: KT('山線', 'S0|S1'), sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 30 },
  { segKey: KT('山線', 'S1|S2'), sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 30 },
  { segKey: KT('山線', 'S2|S3'), sys: 'tra_sched', trainKind: '區間車', dir: 0, kind: 'track', slot: '', perDay: 60 },
] };
await attempt('M0', async () => {
  const w = world({ tally: true });
  const st = await w.cron();
  ok('M0a [S13b 手算] 沒有任何待判樣本的空跑：子請求恰 6 次（讀規則 1＋讀題庫 1＋拿租約 1＋出錯記錄清掃 1＋班車清單 1＋釋放租約 1）、trains 0、budgetStop false；計數器＝測試端獨立計數',
    st.subreq === FIXED && w.tally.n === FIXED && st.trains === 0 && st.budgetStop === false, J({ st, tally: w.tally.n }));
});
await attempt('M1', async () => {
  // 一班車、只有一條線：FIXED＋9＝15（K4 的手算；寫入與去重登記各是一個 batch，不隨段數分塊）
  const run = async (seed, lnId, sec) => {
    const w = world({ tally: true, seed });
    putBatches(w.db, { actor: 'm1', trainNo: 'M1', lnId, pts: leg({ sec }) });
    const st = await w.cron();
    return { st, n: w.tally.n, nCov: q.nContrib(w.db, 'm1') };
  };
  const a = await run(boardAll(['山線']), '山線', 700);                                // 7 段：6＋9＝15
  ok(`M1a [S13b 手算] 7 段的一班車：子請求恰 15＝6＋9（實測 ${a.st.subreq}）；計數器＝測試端獨立計數`, a.st.subreq === 15 && a.n === 15 && a.nCov === 7, J(a));
  const b = await run(boardSql('tra_sched', '長線', [{}], LONG_SEGS), '長線', 3900);      // 39 段：一樣 15（舊版登記每 26 段一個 batch）
  ok(`M1b [S13b 手算] 39 段的一班車：子請求恰 15＝6＋9，不隨段數（實測 ${b.st.subreq}）`, b.st.subreq === 15 && b.n === 15 && b.nCov === 39, J(b));
  const c = await run(boardSql('tra_sched', '長線', [{}], LONG_SEGS), '長線', 4000);      // 40 段：一樣 15（更舊的版本寫入分塊時 81 句＝兩塊）
  ok(`M1c [S13b 手算] 40 段的一班車（寫入 81 句仍是一個 batch）：子請求恰 15＝6＋9（實測 ${c.st.subreq}）`, c.st.subreq === 15 && c.n === 15 && c.nCov === 40, J(c));
});
await attempt('M2', async () => {
  // 三班車：MA（乘車日 07-27，actor m-zz）、MB（07-28、m-aa）、MC（07-28、m-mm）。每班 7 段、單獨夠發 1 顆。
  // 🔴 review-B B3 之後正式的次序是「每人輪流、同一輪隨機」（乘車日與 actor 都是上傳者自己填的，不能拿來排）；
  // 這三班分屬三個人、都不是可信身分，在正式次序下同一輪、先後隨機。BOUNTY_VERIFY_ORDER＝fixed（測試專用）把同一輪的隨機換成
  // （乘車日、actor、車次），這一組才寫得出「哪一班先」——這裡驗的是預算與續跑，不是排序（排序在 verify_bounty_hardening.mjs 的 B3 組）。
  const fx = () => {
    const w = world({ tally: true, seed: boardAll(['山線']) });
    w.env.BOUNTY_VERIFY_ORDER = 'fixed';
    putBatches(w.db, { actor: 'm-zz', trainNo: 'MA', date: D27, lnId: '山線', pts: leg({ sec: 700 }) });
    putBatches(w.db, { actor: 'm-mm', trainNo: 'MC', date: D28, lnId: '山線', pts: leg({ sec: 700 }) });
    putBatches(w.db, { actor: 'm-aa', trainNo: 'MB', date: D28, lnId: '山線', pts: leg({ sec: 700 }) });
    return w;
  };
  const vs = w => ['m-zz', 'm-aa', 'm-mm'].map(a => q.verdicts(w.db, a, { 'm-zz': 'MA', 'm-aa': 'MB', 'm-mm': 'MC' }[a]));
  const w = fx();
  // 固定開銷 6（M0a）裡，第一班車開始前已用 5（規則、題庫、租約、出錯記錄清掃、清單；釋放租約在迴圈之後）→ 預算 6：5 ＜ 6 會做第一班；做完之後 ≥ 6 → 停
  w.env.BOUNTY_SUBREQ_BUDGET = '6';
  const s1 = await w.cron();
  ok('M2a [S13b 預算] 預算 6：第一班車做完就停——trains 1、budgetStop true、子請求 ≥ 預算；只有固定次序的第一班（m-zz／07-27）判掉、入帳 1，另兩班仍 pending',
    s1.trains === 1 && s1.budgetStop === true && s1.subreq >= 6 && s1.chips === 1 && J(vs(w)) === J(['ok', 'pending', 'pending']), J({ s1, v: vs(w) }));
  const s2 = await w.cron();
  ok('M2b [S13c 續跑] 下一發（預算仍是 6）接著判：固定次序下剩下兩班 m-aa 先於 m-mm；只做 m-aa，m-mm 仍 pending；子請求 ≥ 預算、budgetStop true',
    s2.trains === 1 && s2.budgetStop === true && J(vs(w)) === J(['ok', 'ok', 'pending']), J({ s2, v: vs(w) }));
  delete w.env.BOUNTY_SUBREQ_BUDGET;
  const s3 = await w.cron();
  ok('M2c [S13b 續跑] 預算恢復預設（8000）那一發：把最後一班做完——trains 1、budgetStop false；三班全 ok、帳本 3 列（每班 1 顆、沒有重複入帳）',
    s3.trains === 1 && s3.budgetStop === false && J(vs(w)) === J(['ok', 'ok', 'ok']) && q.tripRows(w.db).length === 3 && q.nPending(w.db) === 0, J({ s3, v: vs(w), ledger: q.tripRows(w.db).length }));
  // 對照：預設預算一發就做完三班（trains 3、budgetStop false），最終狀態與分三發做的相同
  const w2 = fx();
  const t = await w2.cron();
  ok('M2d [S13b 對照] 預設預算：一發做完三班（trains 3、budgetStop false）；最終的點數與帳本與分三發做的完全相同（預算只改變「哪一發做」，不改變結果）',
    t.trains === 3 && t.budgetStop === false && J(vs(w2)) === J(['ok', 'ok', 'ok']) &&
      J(dumpDb(w2.db).bounty_points.map(r => [r.actor, r.points])) === J(dumpDb(w.db).bounty_points.map(r => [r.actor, r.points])) &&
      J(dumpDb(w2.db).chip_ledger.map(r => [r.actor, r.delta, r.ref])) === J(dumpDb(w.db).chip_ledger.map(r => [r.actor, r.delta, r.ref])) &&
      dumpDb(w2.db).chip_ledger.length === 3, J({ t, sameLedger: dumpDb(w2.db).chip_ledger.length }));
});
await attempt('M3', async () => {
  const w = world({ tally: true, seed: boardAll(['山線']) });
  putBatches(w.db, { actor: 'm3', trainNo: 'M3', lnId: '山線', pts: leg({ sec: 700 }) });
  w.env.BOUNTY_SUBREQ_BUDGET = '1';
  const s1 = await w.cron();
  ok('M3a [S13b 預算] 預算 1（第一班車開始前已用 5）：一班都不做——trains 0、budgetStop true、子請求恰 6（含釋放租約）；樣本原封不動仍 pending、沒有帳本',
    s1.trains === 0 && s1.budgetStop === true && s1.subreq === FIXED && q.verdicts(w.db, 'm3', 'M3') === 'pending' && q.tripRows(w.db).length === 0, J({ s1, v: q.verdicts(w.db, 'm3', 'M3') }));
  for (const bad of ['0', '-5', 'abc', '']) {
    const w2 = world({ seed: boardAll(['山線']) });
    putBatches(w2.db, { actor: 'm3', trainNo: 'M3', lnId: '山線', pts: leg({ sec: 700 }) });
    w2.env.BOUNTY_SUBREQ_BUDGET = bad;
    const s = await w2.cron();
    ok(`M3b [S13b 覆寫] BOUNTY_SUBREQ_BUDGET＝${J(bad)}（不是正數）：退回預設 8000，一班做完（trains 1、budgetStop false）`, s.trains === 1 && s.budgetStop === false && s.chips === 1, J(s));
  }
});
await attempt('M4', async () => {
  // scheduled() 下估值與判定共用同一個計數器與預算。估值單獨的用量 valN 先量出來（測試端獨立計數）；
  // 預算設成 valN＋1：判定開始時「估值已用的量」就已 ≥ 預算 → 一班都不做（若判定自己另起一個從 0 開始的計數器，就會照做）。
  const wv = world({ units: U3, tally: true });
  await wv.valuation();
  const valN = wv.tally.n;
  const mk = () => {
    const w = world({ units: U3, tally: true });
    putBatches(w.db, { actor: 'm4', trainNo: 'M4', lnId: '山線', pts: leg({ sec: 700 }) });
    return w;
  };
  const w = mk();
  w.env.BOUNTY_SUBREQ_BUDGET = String(valN + 1);
  const r = await fire(w, '30 19 * * *');
  const line = r.logs.find(l => l.includes('[cron bounty 驗證]')) || '';
  // 判定這一段自己用 4（租約、出錯記錄清掃、班車清單、釋放租約；規則與題庫在同一發裡估值已讀過、有記憶體快取）→ log 印「估值用量＋4」
  ok('M4a [S13b 共用] BOUNTY_CRON：預算＝估值用量＋1 → 估值之後判定一班都不做（樣本仍 pending）；驗證那行 log 印「0 班／0 線組」、「子請求 估值用量＋4」、預算用盡的警告',
    q.verdicts(w.db, 'm4', 'M4') === 'pending' && line.includes('0 班／0 線組') && line.includes(`子請求 ${valN + 4}（`) && line.includes('預算用盡') && r.threw === null,
    J({ valN, line, threw: r.threw }));
  ok('M4b [S13b 共用] 估值那一步照做（板上 3 列）——預算停的是判定、不是估值', w.db.prepare('SELECT COUNT(*) c FROM bounty_board').get().c === 3, '');
  // 對照：同樣的預算，直接呼叫判定（自己從 0 開始數）會照做——證明上面「一班都不做」是因為共用了估值的用量
  const w2 = mk();
  await w2.valuation();
  w2.env.BOUNTY_SUBREQ_BUDGET = String(valN + 1);
  const d = await w2.cron();
  ok('M4c [S13b 共用對照] 同樣的預算，判定單獨（新計數器從 0 起算）呼叫：一班做完——trains 1（所以 M4a 的「0 班」確實來自共用估值的用量）', d.trains === 1 && q.verdicts(w2.db, 'm4', 'M4') === 'ok', J(d));
  // 預算夠：整個 scheduled 的 log 裡「子請求」＝估值＋判定合計（測試端在下一層獨立數到的總數）
  const w3 = mk();
  const r3 = await fire(w3, '30 19 * * *');
  const line3 = r3.logs.find(l => l.includes('[cron bounty 驗證]')) || '';
  ok('M4d [S13d log] 預算充足：驗證那行 log 印「1 班／1 線組」、入帳籌碼 1、子請求＝整發（估值＋判定）在測試端獨立數到的總數，沒有預算用盡的警告',
    line3.includes('1 班／1 線組') && line3.includes('入帳籌碼 1') && line3.includes(`子請求 ${w3.tally.n}`) && !line3.includes('預算用盡') && q.verdicts(w3.db, 'm4', 'M4') === 'ok',
    J({ line3, tally: w3.tally.n }));
  // 舊分支（15 4 * * *）也共用計數器、也印同一行 log（每日 ingest 的用量不在計數範圍內——見 scheduled() 的註解）
  const w4 = mk();
  w4.env.BOUNTY_SUBREQ_BUDGET = String(valN + 1);
  const r4 = await fire(w4, '15 4 * * *');
  const line4 = r4.logs.find(l => l.includes('[cron bounty 驗證]')) || '';
  ok('M4e [S13b 共用] 舊分支 15 4 * * *：一樣估值＋判定共用計數器——預算＝估值用量＋1 → 判定 0 班、log 印子請求與預算用盡（每日 ingest 在這個環境離線失敗，照舊 rethrow，不影響懸賞那段）',
    q.verdicts(w4.db, 'm4', 'M4') === 'pending' && line4.includes('0 班／0 線組') && line4.includes(`子請求 ${valN + 4}（`) && line4.includes('預算用盡'), J({ line4, threw: r4.threw }));
});

// ═══ M5：bountyCounted 直接驗（S13b）═══════════════════════════════════════════════════
// 假 D1 沒有 raw、cron 路徑上也沒有人呼叫 exec——這兩種只能在這裡用替身直接驗；同時證明 batch 交給底層的是「真的 statement」
// （真 D1 拿到 Proxy 替身會直接丟例外：brand check），不是計數用的替身；預算取自 env；不改到原 env；已包過的原樣回傳。
await attempt('M5', async () => {
  const bound = [];
  const mk = (sql, p = []) => ({
    sql, p,
    bind(...a) { const n = mk(sql, a); bound.push(n); return n; },
    first: async () => ({ x: 1 }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [{ x: 1 }] }), raw: async () => [[1]],
  });
  let batchGot = null;
  const DB = { prepare: sql => mk(sql), batch: async stmts => { batchGot = stmts; return stmts.map(() => ({ success: true })); }, exec: async () => ({ count: 1 }), marker: 'db' };
  const AS = { fetch: async () => new Response('ok'), marker: 'assets' };
  const env0 = { DELAY_DB: DB, ASSETS: AS, BOUNTY_NOW: '123', BOUNTY_SUBREQ_BUDGET: '77' };
  const ce = _bounty.bountyCounted(env0);
  const ctr = ce.__bountySubreq;
  const st = ce.DELAY_DB.prepare('SELECT 1').bind(1, 2);
  const r = [await st.first(), await st.run(), await st.all(), await st.raw()];
  ok('M5a [S13b 計數] first／run／all／raw 各數 1 次（共 4，都歸「query」），呼叫結果原樣回傳', ctr.n === 4 && ctr.by.query === 4 && J(r) === J([{ x: 1 }, { meta: { changes: 1 } }, { results: [{ x: 1 }] }, [[1]]]), J({ n: ctr.n, by: ctr.by, r }));
  await ce.DELAY_DB.batch([ce.DELAY_DB.prepare('A').bind(1), ce.DELAY_DB.prepare('B').bind(2), ce.DELAY_DB.prepare('C').bind(3)]);
  ok('M5b [S13b 計數] 一次 batch（3 句）只數 1 次（不論幾句）；交給底層的是「真的 statement」（同一個物件，不是計數替身）',
    ctr.n === 5 && ctr.by.batch === 1 && Array.isArray(batchGot) && batchGot.length === 3 && batchGot.every((x, i) => x === bound[1 + i]), J({ n: ctr.n, by: ctr.by, len: batchGot && batchGot.length }));
  await ce.DELAY_DB.exec('X');
  await ce.ASSETS.fetch('https://x/y');
  ok('M5c [S13b 計數] exec 數 1 次、ASSETS.fetch 數 1 次（共 7＝query 4＋batch 1＋exec 1＋fetch 1）', ctr.n === 7 && ctr.by.exec === 1 && ctr.by.fetch === 1 && ctr.by.query === 4 && ctr.by.batch === 1, J({ n: ctr.n, by: ctr.by }));
  ok('M5d [S13b 計數器] 預算取自 env（77）；BOUNTY_NOW 走原型鏈讀得到；不改原 env（DELAY_DB／ASSETS 仍是原物件、原 env 沒有計數器）；其他屬性原樣通過；已包過的原樣回傳（不重包）',
    ctr.budget === 77 && ce.BOUNTY_NOW === '123' && env0.DELAY_DB === DB && env0.ASSETS === AS && !Object.prototype.hasOwnProperty.call(env0, '__bountySubreq') &&
      ce.DELAY_DB.marker === 'db' && ce.ASSETS.marker === 'assets' && _bounty.bountyCounted(ce) === ce, J({ budget: ctr.budget, now: ce.BOUNTY_NOW }));
  const dflt = _bounty.bountyCounted({ DELAY_DB: DB, ASSETS: AS }).__bountySubreq.budget;
  const lo = _bounty.bountyCounted({ DELAY_DB: DB, ASSETS: AS, BOUNTY_SUBREQ_BUDGET: '5' }).__bountySubreq.budget;
  ok('M5e [S13b 預算] 沒設＝8000（官方預設上限 10,000 扣餘裕）；設 5＝5', dflt === 8000 && lo === 5, J({ dflt, lo }));
});

// ═══ M6：牆鐘預算（Cron 一發的牆鐘上限 15 分鐘，官方明文含等待 D1 的時間；見 worker.js 的 BOUNTY_WALL_BUDGET_MS）═══════
// 假時鐘：Date.now 換成可撥的值，第一班車做第一個 batch 之後把時鐘往前撥（預設牆鐘預算 10 分鐘）。
// 停手點與子請求預算同一個（每班車開始前），所以第一班照做完、第二班開始前停。
await attempt('M6', async () => {
  const realNow = Date.now;
  const fx = (jumpMs, wallEnv) => {
    const w = world({ seed: boardAll(['山線']) });
    w.env.BOUNTY_VERIFY_ORDER = 'fixed';      // 固定次序（M2 的說明）：m6-a（07-27）先，才寫得出「哪一班做完、哪一班留著」
    putBatches(w.db, { actor: 'm6-a', trainNo: 'M6A', date: D27, lnId: '山線', pts: leg({ sec: 700 }) });
    putBatches(w.db, { actor: 'm6-b', trainNo: 'M6B', date: D28, lnId: '山線', pts: leg({ sec: 700 }) });
    if (wallEnv !== undefined) w.env.BOUNTY_WALL_BUDGET_MS = wallEnv;
    let fake = realNow.call(Date), jumped = false;
    const db0 = w.env.DELAY_DB;
    w.env.DELAY_DB = new Proxy(db0, { get(t, k) {
      if (k === 'batch') return async stmts => { const r = await t.batch(stmts); if (!jumped) { jumped = true; fake += jumpMs; } return r; };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    } });
    return { w, run: async () => { Date.now = () => fake; try { return await w.cron(); } finally { Date.now = realNow; } } };
  };
  const vs = w => [q.verdicts(w.db, 'm6-a', 'M6A'), q.verdicts(w.db, 'm6-b', 'M6B')];
  {
    const { w, run } = fx(11 * 60e3);
    const s = await run();
    ok('M6a [牆鐘] 第一班車途中時鐘往前 11 分鐘（預設預算 10 分鐘）：第一班照做完、第二班開始前停——trains 1、budgetStop true、stopBy wall；固定次序的第一班 ok、另一班仍 pending',
      s.trains === 1 && s.budgetStop === true && s.stopBy === 'wall' && s.elapsedMs >= 11 * 60e3 && J(vs(w)) === J(['ok', 'pending']), J({ s, v: vs(w) }));
    const s2 = await run();   // 下一發：時鐘不再跳（只跳第一次）→ 把剩下那班做完
    ok('M6b [牆鐘 續跑] 下一發時鐘正常：剩下那班做完——trains 1、budgetStop false、stopBy null；兩班都 ok、帳本 2 列（每班 1 顆、沒有重複入帳）',
      s2.trains === 1 && s2.budgetStop === false && s2.stopBy === null && J(vs(w)) === J(['ok', 'ok']) && q.tripRows(w.db).length === 2, J({ s2, v: vs(w) }));
  }
  {
    const { w, run } = fx(0);
    const s = await run();
    ok('M6c [牆鐘 對照] 時鐘不跳：一發做完兩班（trains 2、budgetStop false）——M6a 的停手確實來自時鐘，不是別的條件',
      s.trains === 2 && s.budgetStop === false && s.stopBy === null && J(vs(w)) === J(['ok', 'ok']), J({ s, v: vs(w) }));
  }
  {
    const { run } = fx(11 * 60e3, String(20 * 60e3));
    const s = await run();
    ok('M6d [牆鐘 覆寫] BOUNTY_WALL_BUDGET_MS＝20 分鐘：跳 11 分鐘仍在預算內，一發做完兩班', s.trains === 2 && s.budgetStop === false, J(s));
  }
  for (const bad of ['0', '-5', 'abc', '']) {
    const { run } = fx(11 * 60e3, bad);
    const s = await run();
    ok(`M6e [牆鐘 覆寫] BOUNTY_WALL_BUDGET_MS＝${J(bad)}（不是正數）：退回預設 10 分鐘——跳 11 分鐘 → 第二班前停`, s.trains === 1 && s.stopBy === 'wall', J(s));
  }
  const d = _bounty.bountyCounted({ DELAY_DB: {}, ASSETS: {} }).__bountySubreq.wallMs;
  ok('M6f [牆鐘 預設] 沒設＝10 分鐘（官方 Cron 牆鐘上限 15 分鐘，留 5 分鐘給最後一班與收尾）', d === 10 * 60e3, J({ d }));
});

// ═══ K8：容量（S13e，印數字）════════════════════════════════════════════════════
await attempt('K8', async () => {
  const wv = world({ units: REAL_UNITS, tally: true });
  await wv.valuation();
  const valN = wv.tally.n, valBy = { query: wv.tally.query, batch: wv.tally.batch, fetch: wv.tally.fetch };
  const BUDGET = 8000;
  const room = BUDGET - valN - FIXED;                                // 預設預算扣掉估值用量與判定的固定開銷（FIXED）
  const perOf = tag => CAP[tag].newN - FIXED, oldOf = tag => (CAP[tag].oldN == null ? null : CAP[tag].oldN - 3);   // 對照版的固定開銷是 3
  const cnt = per => Math.floor(room / per);
  const lines = [];
  lines.push(`估值（真題庫 ${REAL_UNITS.units.length} 個單位、第一次上架）：子請求 ${valN}（D1 查詢 ${valBy.query}＋batch ${valBy.batch}＋fetch ${valBy.fetch}）`);
  lines.push(`判定空跑固定開銷 ${FIXED}；預設預算 ${BUDGET}，扣掉估值與固定開銷後每一發可用 ${room}`);
  for (const tag of Object.keys(CAP)) {
    const cp = CAP[tag];
    lines.push(`${tag}（${cp.nSt} 站、${cp.nPts} 點、覆蓋 ${cp.nCov} 項）整條停站車：每班 ${perOf(tag)} 次子請求（新）／${oldOf(tag)} 次（舊）；一發約 ${cnt(perOf(tag))} 班（新）／${oldOf(tag) ? cnt(oldOf(tag)) : '?'} 班（舊）`);
  }
  lines.push(`一般短程（7 段）：每班 ${perTrainExpect()} 次（M1a）；一發約 ${cnt(perTrainExpect())} 班`);
  console.log('  [K8 容量]\n    ' + lines.join('\n    '));
  const big = '縱貫線南段';
  ok('K8a [S13e 容量] 縱貫線南段整條停站車（最長線、覆蓋項最多）：新版每班子請求不到舊版的 1/5；預設預算下一發做得完的班數 ≥ 100（舊版同樣的預算只做得完約 ' + (oldOf(big) ? cnt(oldOf(big)) : '?') + ' 班）',
    oldOf(big) != null && perOf(big) * 5 <= oldOf(big) && cnt(perOf(big)) >= 100, J({ 新每班: perOf(big), 舊每班: oldOf(big), 新一發: cnt(perOf(big)), 舊一發: oldOf(big) ? cnt(oldOf(big)) : null }));
  ok('K8b [S13e 容量] 估值本身的用量遠小於預算（真題庫第一次上架 ' + valN + ' 次 ≤ 預算的 5%）', valN * 20 <= BUDGET, J({ valN, valBy }));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
