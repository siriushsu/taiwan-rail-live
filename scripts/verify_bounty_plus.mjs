// 通行證錄程加成驗收（規格 native/build/bounty-v3/通行證錄程加成-規格.html，10-28 使用者定案）：
// 帳號有通行證時，判定 cron 照那趟實際入帳的錄程點數另寫一列加成（kind 'adjust'、ref 'plus|'＋錄程 ref，捨去，不吃每日上限）；
// 規則檔 chips.plusBonusPct 是開關（0＝關）；資格向 RevenueCat 查（與 /api/plus-status 同一條），查不完整整班留 pending。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ RevenueCat／Firebase 替身 ＋ BOUNTY_NOW 釘死。
// 跑法：node scripts/verify_bounty_plus.mjs
//
// 期望值一律手算、寫成字面（不呼叫實作去產生期望）：
//   ・700 秒 @20 m/s 的一段（leg）：收下 40–14000 m＝13.96 km → 13 點；南迴線 ×2＝27.92 → 27（同 verify_bounty_cron.mjs 檔頭）。
//   ・加成 50%：13 × 50 ÷ 100＝6.5 → 6；27 → 13.5 → 13；上限只剩 10 時錄程 10 → 加成 5。
//   ・RevenueCat 訂閱的形狀照 verify_plus_entitlement_env.mjs 的 sub()（官方 OpenAPI v2 Subscription）。
// 分組：P 有／沒有通行證與身分　Q 開關　R 查不完整與中斷重判　S 上限、偏遠線、快取、sandbox　T 錢包 chips-me（餘額含加成、回應欄位不變）
import { readFileSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

// ── 對外替身 ───────────────────────────────────────────────────────────────
// RevenueCat：rc[uid] ＝ { production: [訂閱…], sandbox: [訂閱…] }，或 'error'（回 500）。每一發呼叫記在 rcCalls（uid＋環境）。
// Firebase：只給 chips-me 的 Bearer 用。其餘對外連線一律丟例外。
let rc = {}, rcCalls = [], firebaseUid = null;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes('identitytoolkit.googleapis.com')) {
    return firebaseUid ? new Response(JSON.stringify({ users: [{ localId: firebaseUid }] }), { status: 200 }) : new Response('{}', { status: 400 });
  }
  const m = url.match(/^https:\/\/api\.revenuecat\.com\/v2\/projects\/[^/]+\/customers\/([^/]+)\/subscriptions\?environment=(\w+)/);
  if (m) {
    const uid = decodeURIComponent(m[1]), environment = m[2];
    rcCalls.push(`${uid}|${environment}`);
    if (rc[uid] === 'error') return new Response('{"type":"server_error"}', { status: 500 });
    const items = ((rc[uid] || {})[environment] || []).map(s => ({ ...s, customer_id: uid }));
    return new Response(JSON.stringify({ object: 'list', items, next_page: null, url }), { status: 200 });
  }
  throw new Error('offline: ' + url);
};
const sub = (over = {}) => ({
  id: 'sub_1', gives_access: true, status: 'active', environment: 'production', store: 'app_store',
  ends_at: Date.parse('2026-08-28T00:00:00Z'), current_period_ends_at: Date.parse('2026-08-28T00:00:00Z'),
  entitlements: { items: [{ id: 'entl_1', lookup_key: 'plus', display_name: 'Plus', state: 'active' }] },
  ...over,
});

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const withPct = pct => ({ ...RULES, chips: { ...RULES.chips, plusBonusPct: pct } });
const RULES50 = withPct(50);
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;

// ── 固定的世界（同 verify_bounty_cron.mjs）────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00
const D28 = '2026-07-28';
const D28_NOON = Date.parse('2026-07-28T04:00:00Z');        // 台北 2026-07-28 12:00：讀錢包時「今天」＝乘車日
const APP = { platform: 'ios', app: '1.7.5', simulator: false };
const limiter = { limit: async () => ({ success: true }) };
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const LINES = {};
for (const ln of ['山線', '南迴線']) LINES[`tra_sched|${ln}`] = mkLine('tra_sched', ln);
const UNITS = { generatedAt: 1, schedDate: D28, units: [], lines: LINES };

function leg({ sec, speed = 20, t0 = 30000, d0 = 0 }) {
  const pts = [];
  for (let i = 0; i <= sec; i++) pts.push({ d: d0 + i * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc: 8 });
  return pts;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function world(over = {}) {
  rc = over.rc || {}; rcCalls = [];
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const rules = over.rules || RULES50;
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units') ? J(UNITS) : J(rules), { status: 200 }) };
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, AUTH_LIMITER: limiter, FIREBASE_WEB_API_KEY: 'k', BOUNTY_NOW: String(NOW_MS),
    REVENUECAT_PROJECT_ID: 'proj_test', REVENUECAT_V2_SECRET_KEY: 'sk_test', ...(over.env || {}) };
  return {
    db, env,
    cron: async () => { _bounty.bountyResetMemCaches(); return _bounty.bountyVerifyCron(env); },
    me: async uid => {
      _bounty.bountyResetMemCaches(); firebaseUid = uid;
      const res = await _bounty.chipsMe(new Request('https://railisland.tw/api/chips-me', { headers: { Authorization: 'Bearer t' } }), { ...env, BOUNTY_NOW: String(D28_NOON) });
      return { status: res.status, json: JSON.parse(await res.text()) };
    },
  };
}
const account = uid => `INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('${uid}','${uid}',0,NULL,1);`;
const mergedDevice = (dev, uid) => `INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('${dev}',NULL,0,'${uid}',1);`;
function putTrain(db, { actor, trainNo, lnId = '山線', sec = 700 }) {
  chunk(leg({ sec }), 200).forEach((part, k) => {
    db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
      " VALUES (?,?,?,?,?,0,?,?,NULL,?,'pending',?)")
      .run(`${actor}.${trainNo}.${D28}.${lnId}.${k}`, actor, 'tra_sched', lnId, trainNo, D28, J(part), NOW_MS - 3600e3 + k, J(APP));
  });
}

// ── 讀庫（自己寫 SQL）─────────────────────────────────────────────────────────
const rows = (db, actor) => db.prepare('SELECT id,actor,kind,delta,ref,day,unit FROM chip_ledger WHERE actor=? ORDER BY kind, ref').all(actor).map(r => ({ ...r }));
const trips = (db, actor) => rows(db, actor).filter(r => r.kind === 'trip');
const pluses = (db, actor) => rows(db, actor).filter(r => r.kind === 'adjust' && r.ref.startsWith('plus|'));
const nLedger = db => db.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c;
const nPending = db => db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c;
const sum = a => a.reduce((s, r) => s + r.delta, 0);

// ── P：有／沒有通行證與身分 ─────────────────────────────────────────────────────
await attempt('P1', async () => {
  const w = world({ seed: account('uid-p1'), rc: { 'uid-p1': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-p1', trainNo: 'P1' });
  const st = await w.cron();
  const t = trips(w.db, 'uid-p1'), p = pluses(w.db, 'uid-p1');
  ok('P1a 帳號＋有通行證、山線 700 秒：錄程 13 點（跟沒有通行證時一樣）＋加成一列 6 點（13×50÷100＝6.5 捨去）',
    t.length === 1 && t[0].delta === 13 && p.length === 1 && p[0].delta === 6, J({ t, p }));
  ok('P1b 加成列的形狀：kind adjust、ref plus|uid-p1|2026-07-28|P1、id adjust|plus|…、day＝乘車日、unit point',
    p.length === 1 && p[0].kind === 'adjust' && p[0].ref === 'plus|uid-p1|2026-07-28|P1' && p[0].id === 'adjust|plus|uid-p1|2026-07-28|P1' &&
    p[0].day === D28 && p[0].unit === 'point', J(p));
  ok('P1c RevenueCat 只查一次、查的是這個 uid 的正式環境；統計 plus＝6、chips 仍＝13',
    J(rcCalls) === J(['uid-p1|production']) && st.plus === 6 && st.chips === 13, J({ rcCalls, plus: st.plus, chips: st.chips }));
});
await attempt('P2', async () => {
  const w = world({ seed: account('uid-p2'), rc: { 'uid-p2': { production: [] } } });
  putTrain(w.db, { actor: 'uid-p2', trainNo: 'P2' });
  await w.cron();
  ok('P2 [對照 P1] 帳號、沒有通行證（RevenueCat 回空清單）：錄程 13、沒有加成列；有查 RevenueCat',
    sum(trips(w.db, 'uid-p2')) === 13 && pluses(w.db, 'uid-p2').length === 0 && rcCalls.length === 1, J({ l: rows(w.db, 'uid-p2'), rcCalls }));
});
await attempt('P3', async () => {
  const w = world({ seed: '', rc: { 'dev-p3': { production: [sub()] } } });
  putTrain(w.db, { actor: 'dev-p3', trainNo: 'P3' });
  await w.cron();
  ok('P3 匿名裝置（沒併帳號）：錄程 13、沒有加成列，而且完全不查 RevenueCat（即使替身說它有通行證）',
    sum(trips(w.db, 'dev-p3')) === 13 && pluses(w.db, 'dev-p3').length === 0 && rcCalls.length === 0, J({ l: rows(w.db, 'dev-p3'), rcCalls }));
});
await attempt('P4', async () => {
  const w = world({ seed: account('uid-p4') + mergedDevice('dev-p4', 'uid-p4'), rc: { 'uid-p4': { production: [sub()] } } });
  putTrain(w.db, { actor: 'dev-p4', trainNo: 'P4' });
  await w.cron();
  ok('P4 已併進帳號的裝置上傳：錄程 13＋加成 6 都記在帳號 uid-p4 名下，裝置名下沒有帳；查的是帳號的資格',
    sum(trips(w.db, 'uid-p4')) === 13 && sum(pluses(w.db, 'uid-p4')) === 6 && rows(w.db, 'dev-p4').length === 0 &&
    J(rcCalls) === J(['uid-p4|production']), J({ uid: rows(w.db, 'uid-p4'), dev: rows(w.db, 'dev-p4'), rcCalls }));
});

// ── Q：開關 ─────────────────────────────────────────────────────────────────
await attempt('Q1', async () => {
  const w = world({ seed: account('uid-q1'), rules: RULES, rc: { 'uid-q1': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-q1', trainNo: 'Q1' });
  await w.cron();
  ok(`Q1 規則檔原樣（plusBonusPct＝${RULES.chips.plusBonusPct}）＋帳號＋有通行證：錄程 13、沒有加成列、不查 RevenueCat`,
    RULES.chips.plusBonusPct === 0 && sum(trips(w.db, 'uid-q1')) === 13 && pluses(w.db, 'uid-q1').length === 0 && rcCalls.length === 0,
    J({ l: rows(w.db, 'uid-q1'), rcCalls }));
});
await attempt('Q2', async () => {
  const { plusBonusPct, ...chipsNoKey } = RULES.chips;
  const w = world({ seed: account('uid-q2'), rules: { ...RULES, chips: chipsNoKey }, rc: { 'uid-q2': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-q2', trainNo: 'Q2' });
  await w.cron();
  ok('Q2 規則檔沒有 plusBonusPct 這個鍵：當成關，判定照常（錄程 13）、沒有加成、不查 RevenueCat',
    sum(trips(w.db, 'uid-q2')) === 13 && pluses(w.db, 'uid-q2').length === 0 && rcCalls.length === 0, J({ l: rows(w.db, 'uid-q2'), rcCalls }));
});
await attempt('Q3', async () => {
  const w = world({ seed: account('uid-q3'), rc: { 'uid-q3': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-q3', trainNo: 'Q3', sec: 300 });
  await w.cron();
  ok('Q3 不合格的趟（300 秒，不到 600 秒）＋帳號＋有通行證：沒有任何帳本列，也不查 RevenueCat',
    nLedger(w.db) === 0 && rcCalls.length === 0, J({ n: nLedger(w.db), rcCalls }));
});

// ── R：查不完整與中斷重判 ─────────────────────────────────────────────────────
await attempt('R1', async () => {
  const w = world({ seed: account('uid-r1'), rc: { 'uid-r1': 'error' } });
  putTrain(w.db, { actor: 'uid-r1', trainNo: 'R1' });
  const pending0 = nPending(w.db);
  const st = await w.cron();
  ok('R1a RevenueCat 回 500：這班車一列帳都沒寫、樣本全部還是 pending、統計 plusDeferred＝1',
    nLedger(w.db) === 0 && pending0 > 0 && nPending(w.db) === pending0 && st.plusDeferred === 1,
    J({ n: nLedger(w.db), pending0, pending: nPending(w.db), deferred: st.plusDeferred }));
  rc['uid-r1'] = { production: [sub()] };
  const st2 = await w.cron();
  ok('R1b 下一發 RevenueCat 恢復：照常入帳錄程 13＋加成 6，樣本判掉（pending 0）',
    sum(trips(w.db, 'uid-r1')) === 13 && sum(pluses(w.db, 'uid-r1')) === 6 && nPending(w.db) === 0 && !st2.plusDeferred,
    J({ l: rows(w.db, 'uid-r1'), pending: nPending(w.db) }));
});
await attempt('R2', async () => {
  const w = world({ seed: account('uid-r2') + mergedDevice('dev-r2', 'uid-r2'), env: { REVENUECAT_V2_SECRET_KEY: '' } });
  putTrain(w.db, { actor: 'dev-r2', trainNo: 'R2' });
  const st = await w.cron();
  ok('R2 規則開著、併進帳號的裝置、但 Worker 沒設 RevenueCat secret：同樣整班留 pending（不當成沒有通行證），也不打 RevenueCat',
    nLedger(w.db) === 0 && nPending(w.db) > 0 && st.plusDeferred === 1 && rcCalls.length === 0, J({ n: nLedger(w.db), deferred: st.plusDeferred, rcCalls }));
});
await attempt('R3', async () => {
  // 模擬「前一發寫完錄程列、加成還沒寫就中斷」：錄程列已在帳本上、樣本仍是 pending。
  const tripRow = "INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES " +
    `('trip|uid-r3|${D28}|R3','uid-r3','trip',13,'uid-r3|${D28}|R3','${D28}',1,'point');`;
  const w = world({ seed: account('uid-r3') + tripRow, rc: { 'uid-r3': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-r3', trainNo: 'R3' });
  await w.cron();
  const t = trips(w.db, 'uid-r3'), p = pluses(w.db, 'uid-r3');
  ok('R3a 錄程列已在、班車仍 pending：這一發不重發錄程（仍一列 13），補上加成一列 6',
    t.length === 1 && t[0].delta === 13 && p.length === 1 && p[0].delta === 6, J({ t, p }));
  w.db.exec("UPDATE bounty_samples SET verdict='pending' WHERE actor='uid-r3'");   // 同一班車再判一次（例如標記那一步失敗、整班重來）
  await w.cron();
  ok('R3b 同一班車再判一次：錄程與加成都還是各一列（UNIQUE(kind, ref) 擋掉重複）',
    trips(w.db, 'uid-r3').length === 1 && pluses(w.db, 'uid-r3').length === 1, J(rows(w.db, 'uid-r3')));
});

// ── S：上限、偏遠線、快取、sandbox ──────────────────────────────────────────────
await attempt('S1', async () => {
  const other = "INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES " +
    `('trip|uid-s1|${D28}|X0','uid-s1','trip',490,'uid-s1|${D28}|X0','${D28}',1,'point');`;
  const w = world({ seed: account('uid-s1') + other, rc: { 'uid-s1': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-s1', trainNo: 'S1' });
  await w.cron();
  const t = trips(w.db, 'uid-s1').find(r => r.ref.endsWith('|S1')), p = pluses(w.db, 'uid-s1');
  ok('S1 當天已領 490（上限 500）：這趟錄程 10，加成照實際入帳的 10 算＝5；之前那 490 不補加成',
    t && t.delta === 10 && p.length === 1 && p[0].delta === 5 && p[0].ref.endsWith('|S1'), J({ t, p }));
});
await attempt('S2', async () => {
  const w = world({ seed: account('uid-s2'), rc: { 'uid-s2': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-s2', trainNo: 'S2', lnId: '南迴線' });
  await w.cron();
  ok('S2 南迴線 700 秒：錄程 27（×2）＋加成 13（27×50÷100＝13.5 捨去）',
    sum(trips(w.db, 'uid-s2')) === 27 && sum(pluses(w.db, 'uid-s2')) === 13, J(rows(w.db, 'uid-s2')));
});
await attempt('S3', async () => {
  const w = world({ seed: account('uid-s3'), rc: { 'uid-s3': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-s3', trainNo: 'S3a' });
  putTrain(w.db, { actor: 'uid-s3', trainNo: 'S3b' });
  await w.cron();
  ok('S3 同一發、同一個帳號兩班車：RevenueCat 只查一次；兩班各有錄程 13＋加成 6',
    rcCalls.length === 1 && trips(w.db, 'uid-s3').length === 2 && pluses(w.db, 'uid-s3').length === 2 &&
    sum(trips(w.db, 'uid-s3')) === 26 && sum(pluses(w.db, 'uid-s3')) === 12, J({ rcCalls, l: rows(w.db, 'uid-s3') }));
});
await attempt('S4', async () => {
  const sandboxOnly = { production: [], sandbox: [sub({ environment: 'sandbox' })] };
  const w = world({ seed: account('uid-s4a') + account('uid-s4b'), env: { REVENUECAT_SANDBOX_ALLOWED_UIDS: 'uid-s4a' },
    rc: { 'uid-s4a': sandboxOnly, 'uid-s4b': sandboxOnly } });
  putTrain(w.db, { actor: 'uid-s4a', trainNo: 'S4a' });
  putTrain(w.db, { actor: 'uid-s4b', trainNo: 'S4b' });
  await w.cron();
  ok('S4a sandbox 允許清單裡的帳號、只有 sandbox 訂閱：正式環境查無之後再查 sandbox，給加成 6',
    sum(pluses(w.db, 'uid-s4a')) === 6 && rcCalls.includes('uid-s4a|production') && rcCalls.includes('uid-s4a|sandbox'), J({ rcCalls, l: rows(w.db, 'uid-s4a') }));
  ok('S4b [對照] 不在允許清單的帳號、同樣只有 sandbox 訂閱：不查 sandbox、沒有加成',
    pluses(w.db, 'uid-s4b').length === 0 && !rcCalls.includes('uid-s4b|sandbox') && sum(trips(w.db, 'uid-s4b')) === 13, J({ rcCalls, l: rows(w.db, 'uid-s4b') }));
});

// ── T：錢包 chips-me ─────────────────────────────────────────────────────────
await attempt('T1', async () => {
  const w = world({ seed: account('uid-plus-t1'), rc: { 'uid-plus-t1': { production: [sub()] } } });
  putTrain(w.db, { actor: 'uid-plus-t1', trainNo: 'T1' });
  await w.cron();
  const r = await w.me('uid-plus-t1');
  ok('T1 chips-me（乘車日當天讀）：balance 19（13＋6，餘額含加成）、today.chips 13（只數錄程，加成不吃上限）、today.cap 500，回應欄位不變（today 只有 chips、cap）',
    r.status === 200 && r.json.balance === 19 && r.json.today.chips === 13 && r.json.today.cap === 500 &&
    J(Object.keys(r.json.today).sort()) === J(['cap', 'chips']), J(r));
});
await attempt('T2', async () => {
  const w = world({ seed: account('uid-plus-t2'), rc: { 'uid-plus-t2': { production: [] } } });
  putTrain(w.db, { actor: 'uid-plus-t2', trainNo: 'T2' });
  await w.cron();
  const r = await w.me('uid-plus-t2');
  ok('T2 [對照 T1] 沒有通行證：balance 13、today.chips 13',
    r.status === 200 && r.json.balance === 13 && r.json.today.chips === 13, J(r));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
