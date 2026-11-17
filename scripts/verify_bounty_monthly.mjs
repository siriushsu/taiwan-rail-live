// 通行證每月點數（POST /api/pass-monthly）與點數彙總（GET /api/points-summary）驗收。契約：docs/bounty/contract-v3.md 1.2 與 2.0 節。
// 規則檔 chips.passMonthly＝{ points: 300, from: '2026-12' }：台北時間每月 1 號起，有通行證的軌島帳號開 App 來領當月那一份。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ RevenueCat／Firebase 替身 ＋ BOUNTY_NOW 釘死。
// 跑法：node scripts/verify_bounty_monthly.mjs
//
// 期望值一律手算、寫成字面（不呼叫實作去產生期望）：
//   ・帳本的 ref＝'passmonthly|<月份>|'＋SHA-256(環境|種類|商店|商店的交易識別) 前 24 個十六進位字；這裡用 node:crypto 自己算。
//   ・時間：2026-12-01T01:00Z＝台北 12-01 09:00；2026-11-30T16:30Z＝台北 12-01 00:30；2026-11-30T15:30Z＝台北 11-30 23:30。
//   ・RevenueCat 訂閱與終身購買的形狀照 verify_bounty_plus.mjs（官方 OpenAPI v2 Subscription／Purchase）。
// 分組：A 入帳與冪等　B 一張通行證只給一個帳號　C 退款、過期、查不完整　D 身分與請求　E 開關與月份
//       F 寫入總閘　G 錢包不受影響　H 刪帳號　S 點數彙總
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

// ── 對外替身 ───────────────────────────────────────────────────────────────
// Firebase：token 'tok-<uid>' 驗出 <uid>，其餘驗不過（由 token 本身決定是誰，併發的請求才不會串味）。
// RevenueCat：rc[uid] ＝ { production: [訂閱…], sandbox: [訂閱…], purchases: { production: [購買…] } }，或 'error'（回 500）。
// 每一發記在 rcCalls（uid|環境，終身多一段 |purchases）。其餘對外連線一律丟例外。
// rcGate[uid] ＝ { n, answers }：這個 uid 的訂閱查詢要等 n 發都到了才一起回，第 i 發回 answers[i]——讓同時的幾個請求都先過了
// 「這個月領過沒」的前置檢查才拿到 RevenueCat 的答案（A4：同一個帳號兩次查到的通行證不同時，只靠寫入那一句的 NOT EXISTS 擋）。
let rc = {}, rcCalls = [], rcGate = {};
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.includes('identitytoolkit.googleapis.com')) {
    let tok = '';
    try { tok = JSON.parse(init.body).idToken; } catch (e) {}
    return /^tok-[A-Za-z0-9_-]{8,64}$/.test(tok)
      ? new Response(JSON.stringify({ users: [{ localId: tok.slice(4) }] }), { status: 200 })
      : new Response('{}', { status: 400 });
  }
  const m = url.match(/^https:\/\/api\.revenuecat\.com\/v2\/projects\/[^/]+\/customers\/([^/]+)\/(subscriptions|purchases)\?environment=(\w+)/);
  if (m) {
    const uid = decodeURIComponent(m[1]), resource = m[2], environment = m[3];
    rcCalls.push(resource === 'purchases' ? `${uid}|${environment}|purchases` : `${uid}|${environment}`);
    if (rc[uid] === 'error') return new Response('{"type":"server_error"}', { status: 500 });
    const gate = rcGate[uid];
    if (gate && resource === 'subscriptions') {
      const i = (gate.arrived = (gate.arrived || 0) + 1) - 1;
      if (!gate.all) gate.all = new Promise(r => { gate.open = r; });
      if (gate.arrived === gate.n) gate.open();
      await gate.all;
      const items = gate.answers[i].map(s => ({ ...s, customer_id: uid }));
      return new Response(JSON.stringify({ object: 'list', items, next_page: null, url }), { status: 200 });
    }
    const byEnv = resource === 'purchases' ? ((rc[uid] || {}).purchases || {}) : (rc[uid] || {});
    const items = (byEnv[environment] || []).map(s => ({ ...s, customer_id: uid }));
    return new Response(JSON.stringify({ object: 'list', items, next_page: null, url }), { status: 200 });
  }
  throw new Error('offline: ' + url);
};
const ENT = { items: [{ id: 'entl_1', lookup_key: 'plus', display_name: 'Plus', state: 'active' }] };
const sub = (tx, over = {}) => ({
  id: 'sub_' + tx, gives_access: true, status: 'active', environment: 'production', store: 'app_store', store_subscription_identifier: tx,
  ends_at: Date.parse('2027-01-15T00:00:00Z'), current_period_ends_at: Date.parse('2027-01-15T00:00:00Z'), entitlements: ENT, ...over,
});
const LIFETIME_PROD = 'prod_lifetime_test';
const purchase = (tx, over = {}) => ({
  object: 'purchase', id: 'otp_' + tx, product_id: LIFETIME_PROD, status: 'owned', environment: 'production', store: 'app_store',
  store_purchase_identifier: tx, entitlements: ENT, ...over,
});
const LIFETIME_ENV = { REVENUECAT_LIFETIME_PRODUCT_IDS: LIFETIME_PROD };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const withMonthly = pm => { const chips = { ...RULES.chips }; if (pm === undefined) delete chips.passMonthly; else chips.passMonthly = pm; return { ...RULES, chips }; };
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;
const key = m => createHash('sha256').update(m).digest('hex').slice(0, 24);

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const DEC1 = Date.parse('2026-12-01T01:00:00Z');            // 台北 2026-12-01 09:00
const limiter = { limit: async () => ({ success: true }) };
const blocked = { limit: async () => ({ success: false }) };
function world(over = {}) {
  rc = over.rc || {}; rcCalls = [];
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const rulesText = J(over.rules || RULES);
  const ASSETS = { fetch: async () => new Response(rulesText, { status: 200 }) };
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, AUTH_LIMITER: limiter, FIREBASE_WEB_API_KEY: 'k', BOUNTY_NOW: String(DEC1),
    REVENUECAT_PROJECT_ID: 'proj_test', REVENUECAT_V2_SECRET_KEY: 'sk_test', ...(over.env || {}) };
  return { db, env };
}
async function call(fn, req, env) {
  _bounty.bountyResetMemCaches();
  const res = await fn(req, env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json };
}
const bearer = uid => ({ Authorization: 'Bearer tok-' + uid });
const claimReq = (hdr = {}, method = 'POST') => new Request('https://railisland.tw/api/pass-monthly',
  { method, headers: { 'cf-connecting-ip': '203.0.113.9', ...hdr }, ...(method === 'POST' ? { body: '{}' } : {}) });
const claim = (w, uid, o = {}) => call(_bounty.passMonthly, claimReq(uid ? bearer(uid) : {}),
  { ...w.env, ...(o.now ? { BOUNTY_NOW: String(o.now) } : {}), ...(o.env || {}) });
const summary = (w, query, hdr = {}, env = {}) => call(_bounty.pointsSummary,
  new Request('https://railisland.tw/api/points-summary' + query, { headers: { 'cf-connecting-ip': '203.0.113.9', ...hdr } }), { ...w.env, ...env });

// ── 讀庫（自己寫 SQL）─────────────────────────────────────────────────────────
const monthly = (w, actor) => w.db.prepare("SELECT id,actor,kind,delta,ref,day,created_at,unit FROM chip_ledger WHERE actor=? AND ref LIKE 'passmonthly|%' ORDER BY ref")
  .all(actor).map(r => ({ ...r }));
const nLedger = w => w.db.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c;
const account = uid => `INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('${uid}','${uid}',0,NULL,1);`;
const REF_A1 = 'passmonthly|2026-12|' + key('production|sub|app_store|tx-a1');

// ── A：入帳與冪等 ─────────────────────────────────────────────────────────────
await attempt('A1', async () => {
  const w = world({ rc: { 'uid-a1-test': { production: [sub('tx-a1')] } } });
  const r = await claim(w, 'uid-a1-test');
  ok('A1a 有訂閱、12 月 1 日來領：200、state granted、grantedNow true、month 2026-12、points 300、from 2026-12、balance 300',
    r.status === 200 && r.json.state === 'granted' && r.json.grantedNow === true && r.json.month === '2026-12' && r.json.points === 300 &&
    r.json.from === '2026-12' && r.json.balance === 300 && r.json.unit === 'point', J(r));
  ok('A1b history 一筆：{ month 2026-12, points 300, at＝領的那一刻 }',
    J(r.json.history) === J([{ month: '2026-12', points: 300, at: DEC1 }]), J(r.json.history));
  const l = monthly(w, 'uid-a1-test');
  ok('A1c 帳本一列：kind adjust、delta 300、ref passmonthly|2026-12|<SHA-256(production|sub|app_store|tx-a1) 前 24 字>、id adjust|＋ref、day 2026-12-01、unit point',
    l.length === 1 && l[0].kind === 'adjust' && l[0].delta === 300 && l[0].ref === REF_A1 && l[0].id === 'adjust|' + REF_A1 &&
    l[0].day === '2026-12-01' && l[0].unit === 'point' && l[0].created_at === DEC1, J(l));
  ok('A1d RevenueCat 只查一次這個 uid 的正式環境訂閱（沒設終身商品名單，不打 /purchases）', J(rcCalls) === J(['uid-a1-test|production']), J(rcCalls));
  ok('A1e 帳號列建好了（Bearer 的 uid 成為帳號，同 chips-me）',
    w.db.prepare('SELECT uid FROM bounty_points WHERE actor=?').get('uid-a1-test')?.uid === 'uid-a1-test');
  const r2 = await claim(w, 'uid-a1-test');
  ok('A2 同一個月再領：200、granted、grantedNow false、帳本仍是一列、沒有再查 RevenueCat、balance 仍 300',
    r2.status === 200 && r2.json.state === 'granted' && r2.json.grantedNow === false && monthly(w, 'uid-a1-test').length === 1 &&
    J(rcCalls) === J(['uid-a1-test|production']) && r2.json.balance === 300, J({ r2, rcCalls }));
});
await attempt('A3', async () => {
  const w = world({ rc: { 'uid-a3-test': { production: [sub('tx-a3')] } } });
  const rs = await Promise.all([claim(w, 'uid-a3-test'), claim(w, 'uid-a3-test'), claim(w, 'uid-a3-test')]);
  ok('A3 同時送三個請求（兩支手機同時開）：帳本只有一列 300、三個都是 200 granted、恰好一個 grantedNow true',
    monthly(w, 'uid-a3-test').length === 1 && monthly(w, 'uid-a3-test')[0].delta === 300 && rs.every(r => r.status === 200 && r.json.state === 'granted') &&
    rs.filter(r => r.json.grantedNow).length === 1, J(rs.map(r => [r.status, r.json && r.json.state, r.json && r.json.grantedNow])));
});
await attempt('A4', async () => {
  const w = world({ rc: { 'uid-a4-test': { production: [] } } });
  rcGate = { 'uid-a4-test': { n: 2, answers: [[sub('tx-a4-old')], [sub('tx-a4-new')]] } };
  try {
    const rs = await Promise.all([claim(w, 'uid-a4-test'), claim(w, 'uid-a4-test')]);
    const l = monthly(w, 'uid-a4-test');
    ok('A4 同一個帳號兩個請求同時進來、RevenueCat 兩次回的通行證不同（剛換方案）：兩邊都過了「領過沒」的前置檢查，仍只入一列 300（寫入那一句的 NOT EXISTS 擋）',
      rcCalls.length === 2 && l.length === 1 && l[0].delta === 300 && rs.every(r => r.status === 200 && r.json.state === 'granted') &&
      rs.filter(r => r.json.grantedNow).length === 1, J({ rcCalls, l, rs: rs.map(r => [r.status, r.json && r.json.state, r.json && r.json.grantedNow]) }));
  } finally { rcGate = {}; }
});

// ── B：一張通行證一個月只給一個帳號 ─────────────────────────────────────────────
await attempt('B1', async () => {
  const w = world({ rc: {
    'uid-b1-test': { production: [sub('tx-shared')] }, 'uid-b2-test': { production: [sub('tx-shared')] }, 'uid-b3-test': { production: [sub('tx-b3')] },
    'uid-b4-test': { production: [sub('tx-shared'), sub('tx-b4')] } } });
  const r1 = await claim(w, 'uid-b1-test'), r2 = await claim(w, 'uid-b2-test');
  ok('B1a 同一張訂閱（商店交易識別相同）先後登入兩個軌島帳號：第一個 granted；第二個 200 pass_used、一列都沒寫、balance 0、history 空',
    r1.json.state === 'granted' && r2.status === 200 && r2.json.state === 'pass_used' && r2.json.grantedNow === false &&
    monthly(w, 'uid-b2-test').length === 0 && r2.json.balance === 0 && J(r2.json.history) === '[]', J({ r1: r1.json.state, r2 }));
  const r3 = await claim(w, 'uid-b3-test');
  ok('B1b [對照] 另一張訂閱的帳號：granted、一列 300', r3.json.state === 'granted' && monthly(w, 'uid-b3-test').length === 1, J(r3));
  const r4 = await claim(w, 'uid-b4-test'), l4 = monthly(w, 'uid-b4-test');
  ok('B1c 帳號手上兩張通行證、其中一張這個月已被別的帳號領走：用另一張入帳（ref 帶 tx-b4 的雜湊）、只有一列 300',
    r4.json.state === 'granted' && r4.json.grantedNow === true && l4.length === 1 && l4[0].delta === 300 &&
    l4[0].ref === 'passmonthly|2026-12|' + key('production|sub|app_store|tx-b4'), J({ r4, l4 }));
  const r2b = await claim(w, 'uid-b2-test');
  ok('B1d 被擋的帳號再試一次：仍是 pass_used、仍沒有列', r2b.json.state === 'pass_used' && monthly(w, 'uid-b2-test').length === 0, J(r2b));
});
await attempt('B2', async () => {
  const w = world({ env: LIFETIME_ENV, rc: { 'uid-b5-test': { production: [sub('tx-b5')], purchases: { production: [purchase('otp-b5')] } } } });
  const r = await claim(w, 'uid-b5-test'), again = await claim(w, 'uid-b5-test');
  ok('B2 同一個帳號同時有訂閱與終身：一個月只入一列 300（不是 600），再領也不加',
    r.json.state === 'granted' && again.json.grantedNow === false && monthly(w, 'uid-b5-test').length === 1 && again.json.balance === 300, J({ r, again }));
});

// ── C：退款、過期、查不完整 ─────────────────────────────────────────────────────
await attempt('C1', async () => {
  const w = world({ env: LIFETIME_ENV, rc: {
    'uid-c1-test': { production: [sub('tx-c1', { gives_access: false, status: 'expired' })] },
    'uid-c2-test': { production: [], purchases: { production: [purchase('otp-c2', { status: 'refunded', entitlements: { items: [] } })] } },
    'uid-c3-test': { production: [], purchases: { production: [purchase('otp-c3')] } } } });
  const r1 = await claim(w, 'uid-c1-test'), r2 = await claim(w, 'uid-c2-test'), r3 = await claim(w, 'uid-c3-test');
  ok('C1a 訂閱過期（gives_access false）：200 no_pass、沒有列', r1.status === 200 && r1.json.state === 'no_pass' && monthly(w, 'uid-c1-test').length === 0, J(r1));
  ok('C1b 終身已退款（status refunded）：200 no_pass、沒有列', r2.status === 200 && r2.json.state === 'no_pass' && monthly(w, 'uid-c2-test').length === 0, J(r2));
  const l3 = monthly(w, 'uid-c3-test');
  ok('C1c [對照] 終身仍 owned：granted、ref 帶 SHA-256(production|otp|app_store|otp-c3)',
    r3.json.state === 'granted' && l3.length === 1 && l3[0].ref === 'passmonthly|2026-12|' + key('production|otp|app_store|otp-c3'), J({ r3, l3 }));
});
await attempt('C2', async () => {
  const w = world({ rc: { 'uid-c4-test': 'error' } });
  const r = await claim(w, 'uid-c4-test');
  ok('C2a RevenueCat 回 500：503 entitlement_unavailable、一列都沒寫（查不到不能當成沒有）',
    r.status === 503 && r.json.error === 'entitlement_unavailable' && nLedger(w) === 0, J(r));
  rcCalls = [];
  const r2 = await claim(w, 'uid-c5-test', { env: { REVENUECAT_V2_SECRET_KEY: '' } });
  ok('C2b Worker 沒設 RevenueCat secret：503 entitlement_unavailable、沒打 RevenueCat、沒有列',
    r2.status === 503 && r2.json.error === 'entitlement_unavailable' && rcCalls.length === 0 && nLedger(w) === 0, J({ r2, rcCalls }));
});
await attempt('C3', async () => {
  const w = world({ rc: { 'uid-c6-test': { production: [sub('tx-c6')] } } });
  await claim(w, 'uid-c6-test');
  rc['uid-c6-test'] = { production: [sub('tx-c6', { gives_access: false, status: 'expired' })] };
  const jan = await claim(w, 'uid-c6-test', { now: Date.parse('2027-01-02T01:00:00Z') });
  ok('C3 12 月領過、1 月時已過期：1 月 no_pass；12 月那一列不收回（history 只有 2026-12、balance 300）',
    jan.json.state === 'no_pass' && jan.json.month === '2027-01' && monthly(w, 'uid-c6-test').length === 1 &&
    J(jan.json.history.map(h => h.month)) === J(['2026-12']) && jan.json.balance === 300, J(jan));
});

// ── D：身分與請求 ─────────────────────────────────────────────────────────────
await attempt('D1', async () => {
  const w = world({ rc: { 'uid-d1-test': { production: [sub('tx-d1')] } } });
  const none = await claim(w, null);
  const bad = await call(_bounty.passMonthly, claimReq({ Authorization: 'Bearer nope' }), w.env);
  const getr = await call(_bounty.passMonthly, claimReq(bearer('uid-d1-test'), 'GET'), w.env);
  const lim = await claim(w, 'uid-d1-test', { env: { AUTH_LIMITER: blocked } });
  ok('D1a 沒帶 Bearer（匿名裝置領不到）：401 auth_required', none.status === 401 && none.json.error === 'auth_required', J(none));
  ok('D1b token 驗不過：401 unauthorized', bad.status === 401 && bad.json.error === 'unauthorized', J(bad));
  ok('D1c GET：405', getr.status === 405, J(getr));
  ok('D1d 被限流：429', lim.status === 429 && lim.json.error === 'rate_limited', J(lim));
  ok('D1e 以上四種都沒查 RevenueCat、帳本 0 列', rcCalls.length === 0 && nLedger(w) === 0, J({ rcCalls, n: nLedger(w) }));
});

// ── E：開關與月份 ─────────────────────────────────────────────────────────────
await attempt('E1', async () => {
  const P = { 'uid-e1-test': { production: [sub('tx-e1')] } };
  const offs = [];
  for (const [label, pm] of [['沒有這個鍵', undefined], ['points 0', { points: 0, from: '2026-12' }], ['from 2026-13', { points: 300, from: '2026-13' }],
    ['points 字串', { points: '300', from: '2026-12' }]]) {
    const w = world({ rules: withMonthly(pm), rc: P });
    const r = await claim(w, 'uid-e1-test');
    offs.push({ label, status: r.status, state: r.json && r.json.state, points: r.json && r.json.points, from: r.json && r.json.from, rc: rcCalls.length, n: nLedger(w) });
  }
  ok('E1 規則檔關著（沒有鍵、points 0、from 不合格式、points 不是整數）：200 off、points 0、from null、沒查 RevenueCat、沒有列',
    offs.every(o => o.status === 200 && o.state === 'off' && o.points === 0 && o.from === null && o.rc === 0 && o.n === 0), J(offs));
});
await attempt('E2', async () => {
  const w = world({ rc: { 'uid-e2-test': { production: [sub('tx-e2')] } } });
  const nov = await claim(w, 'uid-e2-test', { now: Date.parse('2026-11-20T04:00:00Z') });
  ok('E2a 11 月（from 2026-12 之前）：200 not_started、month 2026-11、沒查 RevenueCat、沒有列',
    nov.status === 200 && nov.json.state === 'not_started' && nov.json.month === '2026-11' && rcCalls.length === 0 && nLedger(w) === 0, J(nov));
  const utcNov = await claim(w, 'uid-e2-test', { now: Date.parse('2026-11-30T15:30:00Z') });
  ok('E2b 台北 11-30 23:30（UTC 15:30）：仍是 not_started', utcNov.json.state === 'not_started' && nLedger(w) === 0, J(utcNov));
  const tpe = await claim(w, 'uid-e2-test', { now: Date.parse('2026-11-30T16:30:00Z') });
  const l = monthly(w, 'uid-e2-test');
  ok('E2c 台北 12-01 00:30（UTC 還是 11-30）：照台北日期算 12 月、granted、day 2026-12-01',
    tpe.json.state === 'granted' && tpe.json.month === '2026-12' && l.length === 1 && l[0].day === '2026-12-01', J({ tpe, l }));
});
await attempt('E3', async () => {
  const w = world({ rc: { 'uid-e3-test': { production: [sub('tx-e3')] } } });
  await claim(w, 'uid-e3-test');
  const lastMin = await claim(w, 'uid-e3-test', { now: Date.parse('2026-12-31T15:59:00Z') });
  ok('E3a 台北 12-31 23:59 再開：仍是 12 月、granted、grantedNow false、一列', lastMin.json.month === '2026-12' && lastMin.json.grantedNow === false &&
    monthly(w, 'uid-e3-test').length === 1, J(lastMin));
  const jan = await claim(w, 'uid-e3-test', { now: Date.parse('2026-12-31T16:00:00Z') });
  const l = monthly(w, 'uid-e3-test');
  ok('E3b 台北 2027-01-01 00:00：新的一個月、granted、grantedNow true、兩列、balance 600、history 新到舊 [2027-01, 2026-12]、1 月那列 day 2027-01-01',
    jan.json.state === 'granted' && jan.json.grantedNow === true && jan.json.month === '2027-01' && l.length === 2 && jan.json.balance === 600 &&
    J(jan.json.history.map(h => h.month)) === J(['2027-01', '2026-12']) && l.find(x => x.ref.startsWith('passmonthly|2027-01|'))?.day === '2027-01-01', J({ jan, l }));
});

// ── F：寫入總閘 ───────────────────────────────────────────────────────────────
await attempt('F1', async () => {
  const w = world({ rc: { 'uid-f1-test': { production: [sub('tx-f1')] }, 'uid-f2-test': { production: [sub('tx-f2')] } } });
  const paused = await claim(w, 'uid-f1-test', { env: { BOUNTY_WRITES: 'off' } });
  ok('F1a 寫入總閘關著、這個月還沒領：503 bounty_paused、沒查 RevenueCat、沒有列',
    paused.status === 503 && paused.json.error === 'bounty_paused' && rcCalls.length === 0 && nLedger(w) === 0, J(paused));
  await claim(w, 'uid-f2-test');
  const after = await claim(w, 'uid-f2-test', { env: { BOUNTY_WRITES: 'off' } });
  ok('F1b 這個月已經領過、之後總閘關掉：照常 200 granted（grantedNow false），App 看得到已入帳',
    after.status === 200 && after.json.state === 'granted' && after.json.grantedNow === false && after.json.balance === 300, J(after));
});

// ── G：錢包不受影響 ─────────────────────────────────────────────────────────────
await attempt('G1', async () => {
  const w = world({ rc: { 'uid-g1-test': { production: [sub('tx-g1')] } } });
  await claim(w, 'uid-g1-test');
  const me = await call(_bounty.chipsMe, new Request('https://railisland.tw/api/chips-me', { headers: bearer('uid-g1-test') }), w.env);
  ok('G1 領完讀 chips-me（同一天）：balance 300（含每月點數）、today.chips 0（每日上限只數錄程）、today.cap 500',
    me.status === 200 && me.json.balance === 300 && me.json.today.chips === 0 && me.json.today.cap === 500, J(me));
});

// ── H：刪帳號 ─────────────────────────────────────────────────────────────────
await attempt('H1', async () => {
  const w = world({ rc: { 'uid-h1-test': { production: [sub('tx-h1')] } } });
  await claim(w, 'uid-h1-test');
  const before = monthly(w, 'uid-h1-test').length;
  await _bounty.bountyPurgeUid(w.env, 'uid-h1-test');
  ok('H1 刪帳號（bountyPurgeUid）：每月點數那一列跟著刪（刪前 1 列、刪後 0 列）', before === 1 && monthly(w, 'uid-h1-test').length === 0, J({ before }));
});

// ── S：點數彙總 ───────────────────────────────────────────────────────────────
// 手寫帳本（chipToPoints＝50）。2026-11 期望：trip＝13＋2＋1×50＋7＝72、trips＝3（兩列錄程不含補差額＋一列重判）、cloud 20／1 次、plus 6、
// monthly 300、other 50（manual；v3points 換算列不算）、spent 300（台北 11-01 00:30 那筆兌換；10-31 23:30 那筆算 10 月）。合併列不算。
const L = (actor, kind, delta, ref, day, at = Date.parse('2026-11-03T04:00:00Z'), unit = 'point') =>
  `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES ('${kind}|${ref}','${actor}','${kind}',${delta},'${ref}',${day ? `'${day}'` : 'NULL'},${at},'${unit}');`;
const SEED_S = account('uid-s1-test') +
  L('uid-s1-test', 'trip', 13, 'uid-s1-test|2026-11-05|T1', '2026-11-05') +
  L('uid-s1-test', 'trip', 2, 'uid-s1-test|2026-11-05|T1|topup|900', '2026-11-05') +
  L('uid-s1-test', 'trip', 1, 'uid-s1-test|2026-11-06|T2', '2026-11-06', undefined, 'chip') +
  L('uid-s1-test', 'adjust', 7, 'rejudge|uid-s1-test|2026-11-10|T3', '2026-11-10') +
  L('uid-s1-test', 'cloud', 20, 'cloud|s1|a', '2026-11-12') +
  L('uid-s1-test', 'cloud', 20, 'cloud|s1|b', '2026-12-02') +
  L('uid-s1-test', 'adjust', 6, 'plus|uid-s1-test|2026-11-05|T1', '2026-11-05') +
  L('uid-s1-test', 'adjust', 300, 'passmonthly|2026-11|abc', '2026-11-01') +
  L('uid-s1-test', 'adjust', 100, 'v3points|uid-s1-test', null) +
  L('uid-s1-test', 'adjust', 50, 'manual|s1|gift', '2026-11-15') +
  L('uid-s1-test', 'redeem', -300, 'scene|s1|r1', null, Date.parse('2026-10-31T16:30:00Z')) +
  L('uid-s1-test', 'redeem', -150, 'item|s1|r2', null, Date.parse('2026-10-31T15:30:00Z')) +
  L('uid-s1-test', 'merge', 50, 'merge|s1|x', null) +
  L('uid-s2-test', 'trip', 99, 'uid-s2-test|2026-11-05|T9', '2026-11-05') +
  L('uid-s1-test', 'trip', 5, 'uid-s1-test|2025-12-31|T0', '2025-12-31') +
  `INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('dev-s3-0000001',NULL,0,NULL,1);` +
  L('dev-s3-0000001', 'cloud', 20, 'cloud|s3|a', '2026-11-20');
await attempt('S1', async () => {
  const w = world({ seed: SEED_S });
  const nov = await summary(w, '?period=2026-11', bearer('uid-s1-test'));
  ok('S1a 2026-11（Bearer）：earned { trip 72, cloud 20, plus 6, monthly 300, other 50 }、spent 300、trips 3、clouds 1、from 2026-11-01、to 2026-11-31',
    nov.status === 200 && J(nov.json) === J({ unit: 'point', period: '2026-11', from: '2026-11-01', to: '2026-11-31',
      earned: { trip: 72, cloud: 20, plus: 6, monthly: 300, other: 50 }, spent: 300, trips: 3, clouds: 1 }), J(nov));
  const year = await summary(w, '?period=2026', bearer('uid-s1-test'));
  ok('S1b 2026 整年：cloud 40／2 次、spent 450（10 月那筆 150 也算）、其餘同 11 月；from 2026-01-01、to 2026-12-31',
    year.status === 200 && J(year.json) === J({ unit: 'point', period: '2026', from: '2026-01-01', to: '2026-12-31',
      earned: { trip: 72, cloud: 40, plus: 6, monthly: 300, other: 50 }, spent: 450, trips: 3, clouds: 2 }), J(year));
  const oct = await summary(w, '?period=2026-10', bearer('uid-s1-test'));
  ok('S1c 2026-10：只有台北 10-31 23:30 那筆兌換 spent 150，其餘全 0',
    J(oct.json.earned) === J({ trip: 0, cloud: 0, plus: 0, monthly: 0, other: 0 }) && oct.json.spent === 150 && oct.json.trips === 0, J(oct));
  const y25 = await summary(w, '?period=2025', bearer('uid-s1-test'));
  ok('S1d 2025：trip 5、trips 1（別年的不混進來）', y25.json.earned.trip === 5 && y25.json.trips === 1 && y25.json.spent === 0, J(y25));
});
await attempt('S2', async () => {
  const w = world({ seed: SEED_S });
  const bad = [];
  for (const p of ['?period=2026-13', '?period=2026-1', '?period=26-11', '', '?period=2026-11-01', '?period=1999']) {
    const r = await summary(w, p, bearer('uid-s1-test'));
    bad.push([p, r.status, r.json && r.json.error]);
  }
  ok('S2 期間格式不對（2026-13、2026-1、26-11、沒帶、2026-11-01、1999）：一律 400 bad_period', bad.every(([, s, e]) => s === 400 && e === 'bad_period'), J(bad));
});
await attempt('S3', async () => {
  const w = world({ seed: SEED_S });
  const asActor = await summary(w, '?period=2026-11&actor=uid-s1-test');
  ok('S3a 不帶 Bearer、用 ?actor= 讀帳號：401 auth_required（同 chips-me 的身分規則）', asActor.status === 401 && asActor.json.error === 'auth_required', J(asActor));
  const dev = await summary(w, '?period=2026-11&actor=dev-s3-0000001');
  ok('S3b 匿名裝置用 ?actor= 讀自己的：200、cloud 20、clouds 1', dev.status === 200 && dev.json.earned.cloud === 20 && dev.json.clouds === 1, J(dev));
  const badActor = await summary(w, '?period=2026-11&actor=x');
  ok('S3c actor 格式不對：400 bad_actor', badActor.status === 400 && badActor.json.error === 'bad_actor', J(badActor));
  const lim = await summary(w, '?period=2026-11&actor=dev-s3-0000001', {}, { BOUNTY_LIMITER: blocked });
  ok('S3d 匿名路徑被限流：429', lim.status === 429, J(lim));
  const paused = await summary(w, '?period=2026-11', bearer('uid-s1-test'), { BOUNTY_WRITES: 'off' });
  ok('S3e 寫入總閘關著：照樣 200（只讀）', paused.status === 200 && paused.json.earned.monthly === 300, J(paused));
});
await attempt('S4', async () => {
  const w = world({ rc: { 'uid-s4-test': { production: [sub('tx-s4')] } } });
  await claim(w, 'uid-s4-test');
  const dec = await summary(w, '?period=2026-12', bearer('uid-s4-test'));
  ok('S4 真的領一次之後讀 2026-12：earned.monthly 300、其餘 0', dec.status === 200 &&
    J(dec.json.earned) === J({ trip: 0, cloud: 0, plus: 0, monthly: 300, other: 0 }) && dec.json.spent === 0, J(dec));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
