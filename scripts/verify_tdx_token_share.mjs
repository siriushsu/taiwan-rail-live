// TDX 權杖「跨 isolate 共用、同時只打一發、失敗後退避」的守門人(2026-11-17)。
//
// TDX 取權杖的端點按來源 IP 限流(每分鐘 20 次,Cloudflare 的出口 IP 是跟別人共用的)。權杖原本只存在
// 單一 isolate 的記憶體:每個冷的 isolate 都要自己打一次,排程一發裡約 8 個工作拿不到就各打各的。
// 2026-11-16 11:00 起遠端機房幾乎每一發都被回 429,排程側一天多拿不到權杖——台鐵公告存檔、鎖屏跟車的
// 即時資料、台鐵誤點與高鐵班表的每日更新一起停。
//
// 這支量的事(每個「isolate」是另外 import 的一份 worker.js 模組實例;D1 用 scripts/d1_local.mjs 的
// 真 SQLite 替身,各 isolate 共用同一個;時間用可控的假時鐘;取權杖的端點是可切換行為的假件):
//   A 共用:第一個 isolate 取到後寫進 D1;冷的 isolate 直接採用,一次都不打 TDX。
//   B 同時只打一發:同一個 isolate 同時 8 個呼叫,TDX 只打 1 次。
//   C 退避:取不到(429)時 8 個同時呼叫只打 1 次;退避期間不再打,但別的 isolate 換到就立刻採用;
//     過了退避才再打。
//   D 提前換新:快到期先去換;換不到就繼續用手上還沒到期的那把,而且退避期間不再打;換到之後寫回 D1,
//     別的 isolate 直接採用。效期很短的權杖不會每次呼叫都重取。
//   E 被 TDX 拒收(401):D1 裡還是被拒的那一把就不採用、重新去取並覆寫;別的 isolate 接著採用新的。
//     這一組走真的呼叫端(archiveTraAlert 收到 401 把 tok 設成 null),不是測試自己清權杖。
//     慢到的 401(還帶著前一把的 request,在新的那把換上之後才收到 401)不可以把新的那把也當成被拒;
//     過了認定時間、新的那把真的被拒,才重新去取。
//   F 沒有 D1、D1 壞掉、D1 那一列不是權杖、D1 卡住不回:都退回直接向 TDX 取,不拋例外。
//   G 等待有上限:發起的那一發永遠不回來(發起它的 request 被取消)時,搭便車的人最多等到等待上限;
//     超過放掉門檻才重打一次。手上那把還能用時搭便車的人不等,直接拿手上那把走。
//
// 跑法:node scripts/verify_tdx_token_share.mjs(不需要伺服器、不打任何上游,約 10 秒——F4 要真的等 D1 的等待上限)
import { openTestDb } from './d1_local.mjs';

let nowMs = 1_800_000_000_000;
Date.now = () => nowMs;

const AUTH = 'https://auth.test/token';
let authCalls = 0, tokenSeq = 0;
let authMode = 'ok';   // 'ok' | 'hang' | <HTTP 狀態碼> | { delayMs }
let authLife = 86400;  // expires_in(秒)
const rejected = new Set();   // TDX 不再接受的權杖
let alertCalls = 0;
let alertHold = null;  // 設了之後,下一個打到台鐵公告的 request 要等它放行才拿得到回應(只扣住那一個)
const sleep = ms => new Promise(r => setTimeout(r, ms));
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === AUTH) {
    authCalls++;
    const mode = authMode;
    if (mode === 'hang') return new Promise(() => {});   // 發起者被取消後,它的 I/O 在等待者眼裡就是這樣
    if (typeof mode === 'number') return new Response('rate limited', { status: mode });
    if (mode !== 'ok') await sleep(mode.delayMs);
    return new Response(JSON.stringify({ access_token: 'T' + (++tokenSeq), expires_in: authLife }), { status: 200 });
  }
  if (u.includes('/Rail/TRA/Alert')) {
    alertCalls++;
    const bearer = String(init.headers.authorization).replace('Bearer ', '');
    const hold = alertHold;
    alertHold = null;
    if (hold) await hold;
    if (rejected.has(bearer)) return new Response('', { status: 401 });
    return new Response(JSON.stringify({ UpdateTime: 'x', Alerts: [] }), { status: 200 });
  }
  throw new Error('未預期的 fetch 目標:' + u);
};

let isoSeq = 0;
// 一個 isolate＝一份自己的模組層變數。getToken 沒有導出(修法之前的版本)就在 import 之後明講。
async function isolate() {
  const m = await import(new URL(`../worker.js?tdx-token-share-${++isoSeq}`, import.meta.url).href);
  if (!m._tdxToken || typeof m._tdxToken.getToken !== 'function') {
    console.log('FAIL worker.js 沒有導出 _tdxToken.getToken——這支量不到東西');
    process.exit(1);
  }
  return { get: env => m._tdxToken.getToken(env), k: m._tdxToken, archive: env => m._traAlertLog.archiveTraAlert(env, nowMs) };
}
const mkEnv = DELAY_DB => ({ ...(DELAY_DB ? { DELAY_DB } : {}), TDX_AUTH_URL_OVERRIDE: AUTH, TDX_CLIENT_ID: 'x', TDX_CLIENT_SECRET: 'y' });
const newDb = () => { const { db, DELAY_DB } = openTestDb(); return { db, env: mkEnv(DELAY_DB) }; };
const stored = (db, key) => {
  const row = db.prepare('SELECT v FROM kv_blobs WHERE k=?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.v); } catch { return { raw: row.v }; }
};

function within(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(v => ({ ok: true, v }), e => ({ ok: false, err: e })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, timeout: true }), ms); }),
  ]).finally(() => clearTimeout(timer));
}
const settle = p => within(p, 3000);
const many = (iso, env, n) => Promise.all(Array.from({ length: n }, () => settle(iso.get(env))));
async function untilAuthCalls(n, ms = 2000) {
  const end = performance.now() + ms;
  while (authCalls < n && performance.now() < end) await sleep(2);
  return authCalls >= n;
}
async function untilAlertCalls(n, ms = 2000) {
  const end = performance.now() + ms;
  while (alertCalls < n && performance.now() < end) await sleep(2);
  return alertCalls >= n;
}
const show = r => r.ok ? (typeof r.v === 'string' ? r.v : JSON.stringify(r.v)) :(r.timeout ? '逾時(陪一個永遠不回來的 promise 卡住)' : String(r.err && r.err.message || r.err));
const is429 = r => !r.ok && !r.timeout && /tdx auth 429/.test(String(r.err && r.err.message));
let failed = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}

const first = await isolate();
const K = first.k, KEY = K.TDX_TOKEN_KEY;
const BACKOFF = K.TDX_TOKEN_BACKOFF_MS, WAIT = K.TDX_TOKEN_WAIT_MAX_MS, RECLAIM = K.TDX_TOKEN_RECLAIM_MS, RENEW = K.TDX_TOKEN_RENEW_LEFT_MS;
const D1WAIT = K.TDX_TOKEN_D1_WAIT_MS, LATE = K.TDX_TOKEN_LATE_401_MS;
check('常數有導出給測試', typeof KEY === 'string' && !!KEY && [BACKOFF, WAIT, RECLAIM, RENEW, D1WAIT, LATE].every(v => Number.isFinite(v) && v > 0),
  `KEY=${KEY} BACKOFF=${BACKOFF} WAIT=${WAIT} RECLAIM=${RECLAIM} RENEW=${RENEW} D1WAIT=${D1WAIT} LATE=${LATE}`);
check('等待上限 < 放掉門檻(搭便車的人不會等到那一發被放掉)', WAIT < RECLAIM, `WAIT=${WAIT} RECLAIM=${RECLAIM}`);
check('D1 讀、寫各等滿也還在等待上限之內(D1 卡住時這一發仍來得及向 TDX 取)', 2 * D1WAIT < WAIT, `D1WAIT=${D1WAIT} WAIT=${WAIT}`);
check('提前換新的時間比退避長很多(快到期時至少有幾十次機會換到)', RENEW >= 20 * BACKOFF, `RENEW=${RENEW} BACKOFF=${BACKOFF}`);

// ── A 共用 ─────────────────────────────────────────────────────────────────
{
  const { db, env } = newDb();
  let before = authCalls;
  const a1 = await settle(first.get(env));
  const row = stored(db, KEY);
  check('A1 第一個 isolate 向 TDX 取 1 次,並寫進 D1', a1.ok && authCalls - before === 1 && !!row && row.t === a1.v && row.exp === nowMs + authLife * 1000,
    `權杖=${show(a1)}、TDX +${authCalls - before}、D1=${JSON.stringify(row)}`);
  before = authCalls;
  const a2 = await settle((await isolate()).get(env));
  check('A2 冷的 isolate 直接採用 D1 那一把,不打 TDX', a2.ok && a2.v === a1.v && authCalls - before === 0, `權杖=${show(a2)}、TDX +${authCalls - before}`);
  const a3 = await many(await isolate(), env, 8);
  check('A3 冷的 isolate 同時 8 個呼叫也都採用同一把,不打 TDX', a3.every(r => r.ok && r.v === a1.v) && authCalls - before === 0,
    `TDX +${authCalls - before}、${[...new Set(a3.map(show))].join('/')}`);
}

// ── B 同時只打一發 ───────────────────────────────────────────────────────────
{
  const { env } = newDb();
  authMode = { delayMs: 150 };
  const before = authCalls;
  const b = await many(await isolate(), env, 8);
  authMode = 'ok';
  check('B1 D1 沒有權杖時,同一個 isolate 同時 8 個呼叫只打 1 次 TDX,拿到同一把', b.every(r => r.ok && r.v === b[0].v) && authCalls - before === 1,
    `TDX +${authCalls - before}、${[...new Set(b.map(show))].join('/')}`);
}

// ── C 取不到時退避 ───────────────────────────────────────────────────────────
{
  const { env } = newDb();
  const iso = await isolate();
  authMode = 429;
  let before = authCalls;
  const c1 = await many(iso, env, 8);
  check('C1 TDX 回 429:同時 8 個呼叫只打 1 次,每個都丟 tdx auth 429', c1.every(is429) && authCalls - before === 1,
    `TDX +${authCalls - before}、${[...new Set(c1.map(show))].join('/')}`);
  before = authCalls;
  const c2 = await settle(iso.get(env));
  check('C2 退避期間再呼叫:照樣丟 tdx auth 429,不再打 TDX', is429(c2) && authCalls - before === 0, `TDX +${authCalls - before}、${show(c2)}`);
  authMode = 'ok';
  const other = await settle((await isolate()).get(env));   // 別的 isolate(例如訪客打到的那個)換到了
  before = authCalls;
  const c3 = await settle(iso.get(env));
  check('C3 退避期間別的 isolate 換到了:立刻採用,自己不打 TDX', other.ok && c3.ok && c3.v === other.v && authCalls - before === 0,
    `別的 isolate=${show(other)}、這個=${show(c3)}、TDX +${authCalls - before}`);
}
{
  const { env } = newDb();
  const iso = await isolate();
  authMode = 429;
  const c4a = await settle(iso.get(env));
  authMode = 'ok';
  nowMs += BACKOFF;
  const before = authCalls;
  const c4 = await settle(iso.get(env));
  check('C4 過了退避時間才再打 1 次 TDX,並拿到權杖', is429(c4a) && c4.ok && authCalls - before === 1, `先前=${show(c4a)}、之後=${show(c4)}、TDX +${authCalls - before}`);
}

// ── D 快到期提前換新 ─────────────────────────────────────────────────────────
{
  const { db, env } = newDb();
  const iso = await isolate(), peer = await isolate();
  const d0 = await settle(iso.get(env));
  const p0 = await settle(peer.get(env));
  nowMs += authLife * 1000 - RENEW + 1000;   // 進到「該換新」的時間,離到期還很久
  authMode = 429;
  let before = authCalls;
  const d1 = await settle(iso.get(env));
  check('D1 快到期、TDX 回 429:試 1 次,然後繼續用手上還沒到期的那把(不丟例外)', d0.ok && d1.ok && d1.v === d0.v && authCalls - before === 1,
    `原本=${show(d0)}、這次=${show(d1)}、TDX +${authCalls - before}`);
  before = authCalls;
  const d2 = await settle(iso.get(env));
  check('D2 退避期間再呼叫:還是舊的那把,不再打 TDX', d2.ok && d2.v === d0.v && authCalls - before === 0, `${show(d2)}、TDX +${authCalls - before}`);
  authMode = 'ok';
  nowMs += BACKOFF;
  before = authCalls;
  const d3 = await settle(iso.get(env));
  const row = stored(db, KEY);
  check('D3 過了退避、TDX 正常:換到新的一把並寫回 D1', d3.ok && d3.v !== d0.v && authCalls - before === 1 && !!row && row.t === d3.v,
    `新=${show(d3)}、TDX +${authCalls - before}、D1.t=${row && row.t}`);
  before = authCalls;
  const d4 = await settle(peer.get(env));
  check('D4 另一個手上還是舊那把的 isolate:採用 D1 新的那把,不打 TDX', p0.ok && p0.v === d0.v && d4.ok && d4.v === d3.v && authCalls - before === 0,
    `原本=${show(p0)}、這次=${show(d4)}、TDX +${authCalls - before}`);
}
{
  const { env } = newDb();
  const iso = await isolate();
  authLife = 300;
  const before = authCalls;
  const d5 = [await settle(iso.get(env)), await settle(iso.get(env)), await settle(iso.get(env))];
  authLife = 86400;
  check('D5 效期只有 5 分鐘的權杖:連續呼叫只取 1 次(不會每次都當成快到期)', d5.every(r => r.ok && r.v === d5[0].v) && authCalls - before === 1,
    `TDX +${authCalls - before}、${[...new Set(d5.map(show))].join('/')}`);
}

// ── E 被 TDX 拒收(401) ───────────────────────────────────────────────────────
{
  const { db, env } = newDb();
  const a = await isolate(), b = await isolate();
  const t1 = await settle(a.get(env));
  const tb = await settle(b.get(env));
  rejected.add(t1.v);
  const e0 = await settle(a.archive(env));   // 真的呼叫端:收到 401 把 tok 設成 null
  let before = authCalls;
  const e1 = await settle(a.get(env));
  const row = stored(db, KEY);
  check('E1 權杖被拒之後:不採用 D1 裡被拒的那把,重新向 TDX 取 1 次並覆寫 D1',
    t1.ok && !e0.ok && /tdx 401/.test(show(e0)) && e1.ok && e1.v !== t1.v && authCalls - before === 1 && !!row && row.t === e1.v,
    `被拒=${show(t1)}、呼叫端=${show(e0)}、新=${show(e1)}、TDX +${authCalls - before}、D1.t=${row && row.t}`);
  before = authCalls;
  const e2a = await settle(b.archive(env));  // b 手上還是被拒的那把 → 401
  const e2b = await settle(b.archive(env));  // 再來一次就該用 D1 新的那把
  check('E2 另一個 isolate 也被拒之後:採用 D1 新的那把,不打 TDX', tb.ok && tb.v === t1.v && !e2a.ok && /tdx 401/.test(show(e2a)) && e2b.ok && authCalls - before === 0,
    `第一次=${show(e2a)}、第二次=${e2b.ok ? '成功' : show(e2b)}、TDX +${authCalls - before}`);
  const c = await isolate();
  rejected.add(e1.v);
  const e3a = await settle(c.archive(env));  // 冷的 isolate 採用 D1 那把 → 401
  authMode = 429;
  before = authCalls;
  const e3b = await settle(c.get(env));
  const e3c = await settle(c.get(env));
  authMode = 'ok';
  check('E3 被拒又換不到(429):不把被拒的那把交出去,只打 1 次 TDX', !e3a.ok && /tdx 401/.test(show(e3a)) && is429(e3b) && is429(e3c) && authCalls - before === 1,
    `呼叫端=${show(e3a)}、之後=${show(e3b)} / ${show(e3c)}、TDX +${authCalls - before}`);
}
{
  // 慢到的 401:一個 request 帶著 T1 出去、回應卡在路上;另一個 request 先收到 401、換上 T2 之後,卡住的那個才收到 401。
  const { db, env } = newDb();
  const a = await isolate();
  const t1 = await settle(a.get(env));
  rejected.add(t1.v);
  let release;
  alertHold = new Promise(r => { release = r; });
  const callsBefore = alertCalls;
  const slow = settle(a.archive(env));          // 帶著 T1 出去,回應被扣住
  const sent = await untilAlertCalls(callsBefore + 1);
  const e0 = await settle(a.archive(env));      // 另一個 request:馬上收到 401
  const t2 = await settle(a.get(env));          // 換上 T2、寫回 D1
  release();
  const late = await slow;                      // 卡住的那個這時才收到 401,又把 tok 清掉
  authMode = 429;
  let before = authCalls;
  const e4 = await settle(a.get(env));
  const e4b = await settle(a.archive(env));
  authMode = 'ok';
  check('E4 慢到的 401(帶著前一把的 request,在新的那把換上之後才被拒):新的那把照用,不打 TDX',
    sent && t1.ok && /tdx 401/.test(show(e0)) && t2.ok && t2.v !== t1.v && /tdx 401/.test(show(late)) && e4.ok && e4.v === t2.v && e4b.ok && authCalls - before === 0,
    `T1=${show(t1)}、T2=${show(t2)}、慢到的=${show(late)}、之後=${show(e4)}、呼叫端=${e4b.ok ? '成功' : show(e4b)}、TDX +${authCalls - before}`);
  nowMs += LATE;                                // 過了慢到的認定時間,T2 真的被拒
  rejected.add(t2.v);
  const e5a = await settle(a.archive(env));
  before = authCalls;
  const e5 = await settle(a.get(env));
  const row = stored(db, KEY);
  check('E5 過了慢到的認定時間、新的那把真的被拒:重新向 TDX 取 1 次並覆寫 D1',
    /tdx 401/.test(show(e5a)) && e5.ok && e5.v !== t2.v && e5.v !== t1.v && authCalls - before === 1 && !!row && row.t === e5.v,
    `呼叫端=${show(e5a)}、新=${show(e5)}、TDX +${authCalls - before}、D1.t=${row && row.t}`);
}

// ── F 沒有 D1、D1 壞掉、D1 那一列不是權杖 ─────────────────────────────────────
{
  const iso = await isolate(), env = mkEnv(null);
  let before = authCalls;
  const f1 = [await settle(iso.get(env)), await settle(iso.get(env))];
  check('F1 沒有 DELAY_DB:照舊向 TDX 取 1 次、存在記憶體', f1.every(r => r.ok && r.v === f1[0].v) && authCalls - before === 1,
    `TDX +${authCalls - before}、${f1.map(show).join('/')}`);
  before = authCalls;
  const f2 = await settle((await isolate()).get(mkEnv({ prepare() { throw new Error('D1 down'); } })));
  check('F2 D1 壞掉:退回直接向 TDX 取,不丟例外', f2.ok && authCalls - before === 1, `${show(f2)}、TDX +${authCalls - before}`);
  const { db, env: env3 } = newDb();
  db.prepare("INSERT INTO kv_blobs (k, v, updated) VALUES (?, ?, datetime('now'))").run(KEY, '{"days":{}}');
  before = authCalls;
  const f3 = await settle((await isolate()).get(env3));
  const row = stored(db, KEY);
  check('F3 D1 那一列不是權杖:不採用,向 TDX 取 1 次並覆寫', f3.ok && authCalls - before === 1 && !!row && row.t === f3.v,
    `${show(f3)}、TDX +${authCalls - before}、D1=${JSON.stringify(row)}`);
  // D1 卡住不回(讀、寫都不 settle):各等到 D1 的等待上限就放手,權杖照樣拿得到。
  const hung = { prepare: () => ({ bind: () => ({ first: () => new Promise(() => {}), run: () => new Promise(() => {}) }) }) };
  before = authCalls;
  const t = performance.now();
  const f4 = await within((await isolate()).get(mkEnv(hung)), WAIT);
  const ms = Math.round(performance.now() - t);
  check('F4 D1 卡住不回:讀、寫各最多等到 D1 的等待上限,仍向 TDX 取到權杖', f4.ok && authCalls - before === 1 && ms >= D1WAIT && ms < 2 * D1WAIT + 1500,
    `${show(f4)}、${ms} ms、TDX +${authCalls - before}`);
}

// ── G 等待有上限、超齡放掉 ───────────────────────────────────────────────────
{
  const { env } = newDb();
  const iso = await isolate();
  authMode = 'hang';
  const before = authCalls, t0 = nowMs;
  iso.get(env).catch(() => {});   // 被取消的那個 request:不 await
  check('G 前置:卡住的那一發已送出', await untilAuthCalls(before + 1));
  nowMs = t0 + WAIT - 300;        // 搭便車的人進來時,那一發離等待上限只剩 300 ms(真實時間)
  let t = performance.now();
  const g1 = await settle(iso.get(env));
  let ms = Math.round(performance.now() - t);
  check('G1 搭便車最多等到等待上限就放棄(丟 tdx auth 開頭的錯),不陪卡死、不多打 TDX',
    !g1.ok && !g1.timeout && /^tdx auth/.test(show(g1)) && ms < 2000 && authCalls - before === 1, `${ms} ms、${show(g1)}、TDX +${authCalls - before}`);
  nowMs = t0 + WAIT + 1000;
  t = performance.now();
  const g2 = await settle(iso.get(env));
  ms = Math.round(performance.now() - t);
  check('G2 過了等待上限、還沒到放掉門檻:立刻放棄,不多打 TDX', !g2.ok && !g2.timeout && ms < 500 && authCalls - before === 1, `${ms} ms、${show(g2)}、TDX +${authCalls - before}`);
  authMode = 'ok';
  nowMs = t0 + RECLAIM;
  const g3 = await settle(iso.get(env));
  check('G3 滿放掉門檻:重打 1 次並拿到權杖', g3.ok && authCalls - before === 2, `${show(g3)}、TDX +${authCalls - before}`);
}
{
  // 手上那把還能用、到了該換新的時間,而換新的那一發卡住不回:搭便車的人不等它。
  const { env } = newDb();
  const iso = await isolate();
  const g0 = await settle(iso.get(env));
  nowMs += authLife * 1000 - RENEW + 1000;
  authMode = 'hang';
  const before = authCalls, t0 = nowMs;
  iso.get(env).catch(() => {});   // 發起換新的那個 request(它自己最多等到等待上限,這裡不陪它等)
  const sent = await untilAuthCalls(before + 1);
  const t = performance.now();
  const g4 = await many(iso, env, 8);
  const ms = Math.round(performance.now() - t);
  check('G4 手上那把還能用、換新的那一發卡住:搭便車的 8 個呼叫立刻拿手上那把走,不多打 TDX',
    sent && g0.ok && g4.every(r => r.ok && r.v === g0.v) && ms < 500 && authCalls - before === 1,
    `${ms} ms、TDX +${authCalls - before}、${[...new Set(g4.map(show))].join('/')}`);
  authMode = 'ok';
  nowMs = t0 + RECLAIM;
  const g5 = await settle(iso.get(env));
  check('G5 滿放掉門檻:重打 1 次並換到新的一把', g5.ok && g5.v !== g0.v && authCalls - before === 2, `${show(g5)}、TDX +${authCalls - before}`);
}

console.log(failed ? `\n${failed} 項未過` : '\n全部通過');
process.exit(failed ? 1 : 0);
