#!/usr/bin/env node

// 驗「資格文件的寫入是 compare-and-set：舊真相不得覆蓋新真相」（2026-08-04 整合稽核 Important 1）。
//
// 背景：/api/plus-status 與 /api/revenuecat-webhook 各自獨立查 RevenueCat 真相，再寫同一份
// entitlements/{uid}。舊版是無條件 PATCH ⇒ 真正生效的是「最後抵達 Firestore 的請求」，不是
// 「最新取得的真相」。退款 webhook 先寫 inactive、較早的 plus-status 後到 ⇒ 文件被反向覆寫回
// active，而 firestore.rules 只看 active／activeUntilMs，退款的人可以繼續寫雲端資料到舊到期日
// 加寬限為止。反向排序則是「舊的 inactive 蓋掉新的重新訂閱」⇒ 付費者被誤判成沒訂閱。
// 兩個方向是同一個缺陷的兩面，所以兩個方向都在這裡驗。
//
// 這支腳本與既有 verify_plus_firestore_gate.mjs 的差別，是替身的**強度**：
//   · 那支的 Firestore 替身永遠回 200，測得到「有沒有寫」，測不到「並發下誰贏」。
//   · 這支的替身是一顆**會真的執行 precondition 的單文件 Firestore 複製品**：帶 updateTime 的
//     PATCH 只有在文件確實停在那個版本時才成功，否則回 FAILED_PRECONDITION；不帶 precondition
//     的 PATCH 則忠實照 Firestore 的語意無條件覆寫（突變測試要靠這條才顯形）。
//   · 交錯順序不是靠 sleep 賭出來的：用 AsyncLocalStorage 給每條流程一個身分，替身在指定流程的
//     指定動作前停住，讓另一條流程整個跑完，再放行。順序是宣告出來的，不是碰運氣。
//
// 期望值全部是本檔自己宣告的字面值（T_SEED／T_EARLY／T_LATE 與 active 的 true/false），
// 不從 worker.js 讀任何常數——判準不得與實作同源。
//
// 用法：node scripts/verify_plus_entitlement_cas.mjs
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── G0 自檢：驗的是哪棵樹、哪一份 worker.js（心得 32）。ROOT 由本檔自身路徑推導，不吃參數。 ──
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(WORKER_PATH)).digest('hex')}`);

const workerModule = await import('../worker.js');
const worker = workerModule.default;
const { writePlusEntitlement, plusStatus, resetFirestoreAccessTokenCache } = workerModule._plus;

let fails = 0;
// 突變證明仍會跑完整支腳本，只把 PASS 行收起來，保留真實 exit code 與 FAIL 行；不用管道截輸出。
const QUIET = process.env.VERIFY_MUTATION_QUIET === '1';
const SECTIONS = [
  '1 替身自檢：precondition 真的有牙',
  '2 單一寫入者：建立、更新、跳過、邊界',
  '3 雙向交錯：plus-status 先查 / webhook 先寫',
  '4 雙向交錯：webhook 先查 / plus-status 先寫',
  '5 衝突後的行為：重讀重判、有上限、硬失敗不重試',
];
const seen = new Map();
let SECTION = '(未分段)';
const section = (name) => { SECTION = name; if (!QUIET) console.log(`\n===== ${name} =====`); };
const check = (ok, msg, detail = '') => {
  if (!ok) fails += 1;
  seen.set(SECTION, (seen.get(SECTION) || 0) + 1);
  if (!QUIET || !ok) console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`);
};

// ── 本檔自己宣告的字面值：時間順序、資格答案 ──────────────────────────────────────────
const T_SEED = 1_785_000_000_000;    // 文件裡既有那一版的時間戳（最舊）
const T_EARLY = 1_785_000_030_000;   // 「較早取得的真相」
const T_LATE = 1_785_000_090_000;    // 「較晚取得的真相」——不論抵達順序，它都必須是最後留下的
const END_MS = 1_800_000_000_000;
const UID = 'uid-cas-fixture';
const AUTH_VALUE = 'Bearer fixture.authorization';

// ── 一顆會執行 precondition 的單文件 Firestore 複製品 ──────────────────────────────────
// 只實作這條路徑用得到的部分：GET 一份文件、PATCH 帶（或不帶）currentDocument 前置條件。
// updateTime 每次寫入單調遞增，形狀照 Firestore 的微秒時間戳。
const DOC_NAME = `projects/project-fixture/databases/(default)/documents/entitlements/${UID}`;
let store = null;             // { name, fields, createTime, updateTime }
let storeVersion = 0;
let beforePatch = null;       // 測試可掛的「就在你的 PATCH 送達前，別人插隊寫了一筆」
let patchHardFailure = false; // 讓 PATCH 回一個「不是衝突」的 500，驗它不會被當成衝突重試
const stamp = (n) => `2026-08-04T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000000Z`;
const fieldsOf = ({ active, activeUntilMs, updatedAtMs, source }) => ({
  active: { booleanValue: active },
  activeUntilMs: { integerValue: String(activeUntilMs) },
  updatedAtMs: { integerValue: String(updatedAtMs) },
  source: { stringValue: source },
});
function seedStore(doc) {
  storeVersion += 1;
  store = { name: DOC_NAME, fields: fieldsOf(doc), createTime: stamp(0), updateTime: stamp(storeVersion) };
}
function storeCommit(fields) {
  storeVersion += 1;
  store = { name: DOC_NAME, fields, createTime: store ? store.createTime : stamp(storeVersion), updateTime: stamp(storeVersion) };
  return new Response(JSON.stringify(store), { status: 200 });
}
const googleError = (code, status) =>
  new Response(JSON.stringify({ error: { code, status, message: `${status} (fixture)` } }), { status: code });

function firestoreRespond(url, method, body) {
  if (method === 'GET') {
    return store ? new Response(JSON.stringify(store), { status: 200 }) : googleError(404, 'NOT_FOUND');
  }
  if (method !== 'PATCH') return googleError(405, 'FAILED_PRECONDITION');
  if (patchHardFailure) return googleError(500, 'INTERNAL');
  if (beforePatch) beforePatch();
  const params = new URL(url).searchParams;
  const exists = params.get('currentDocument.exists');
  const updateTime = params.get('currentDocument.updateTime');
  const fields = JSON.parse(body).fields;
  // 不帶 precondition ⇒ Firestore 就是無條件覆寫（documents.patch = "Updates or inserts a
  // document."）。這一支不是為了方便，是為了讓「拿掉 precondition」這發突變真的會顯形。
  if (exists === null && updateTime === null) return storeCommit(fields);
  if (exists === 'false') return store ? googleError(409, 'ALREADY_EXISTS') : storeCommit(fields);
  if (exists === 'true') return store ? storeCommit(fields) : googleError(404, 'NOT_FOUND');
  if (!store || store.updateTime !== updateTime) return googleError(400, 'FAILED_PRECONDITION');
  return storeCommit(fields);
}

// ── 流程身分 ＋ 交錯閘門 ＋ 可控時鐘 ───────────────────────────────────────────────────
// AsyncLocalStorage 讓「這發 subrequest 是哪條流程發的」在 await 之後仍然認得出來，於是可以
// (a) 給每條流程自己的 Date.now（時間戳因此是宣告的字面值，不是實際時鐘）、
// (b) 給每條流程自己的 RevenueCat 真相、
// (c) 在指定流程的指定動作前停住，精確編排交錯。
const als = new AsyncLocalStorage();
const realNow = Date.now;
Date.now = () => {
  const ctx = als.getStore();
  return ctx && Number.isFinite(ctx.nowMs) ? ctx.nowMs : realNow();
};

const gates = new Map();
function armGate(key) {
  let release;
  const entry = { hit: false, used: false, release: null };
  entry.promise = new Promise((resolve) => { release = resolve; });
  entry.release = release;
  gates.set(key, entry);
  return entry;
}
async function maybeHold(key) {
  const entry = gates.get(key);
  if (!entry || entry.used) return;
  entry.used = true;
  entry.hit = true;
  await entry.promise;
}
// 等到「流程停在閘門上」或「流程自己跑完了」，兩者先到者為準。**不可以在踩不到閘門時拋例外**：
// 那會讓整支腳本從中途死掉，後面的段落一條都不執行，而 exit code 仍是 1——看起來像有在驗，
// 其實是崩潰（本檔的 M2 突變第一版就是這樣顯形的）。踩不到閘門是一個要被回報的 FAIL，不是崩潰。
async function waitForHold(entry, isSettled) {
  for (let i = 0; i < 2000 && !entry.hit && !isSettled(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  return entry.hit;
}

let requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = init.method || (typeof input !== 'string' && input.method) || 'GET';
  const ctx = als.getStore() || {};
  const flow = ctx.name || '(無流程)';
  if (url.includes('oauth2.googleapis.com')) {
    return new Response(JSON.stringify({ access_token: 'oauth-fixture', expires_in: 3600 }), { status: 200 });
  }
  if (url.includes('identitytoolkit.googleapis.com')) {
    return new Response(JSON.stringify({ users: [{ localId: UID }] }), { status: 200 });
  }
  if (url.includes('api.revenuecat.com')) {
    requests.push({ flow, method, url, kind: 'revenuecat' });
    return new Response(JSON.stringify({ object: 'list', items: ctx.subscriptions || [], next_page: null }), { status: 200 });
  }
  if (url.includes('firestore.googleapis.com')) {
    await maybeHold(`${flow}:${method}`);
    const response = firestoreRespond(url, method, init.body);
    requests.push({ flow, method, url, kind: 'firestore', body: init.body, status: response.status });
    return response;
  }
  return new Response('{}', { status: 599 });
};

// wrangler secret 可貼真換行；這裡動態產生一次性測試金鑰，repo 裡不放固定私鑰。
const keyPair = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['sign', 'verify']);
const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
const PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateDer).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;

const ENV = () => ({
  FIREBASE_WEB_API_KEY: 'fixture-web-key',
  REVENUECAT_PROJECT_ID: 'project-fixture',
  REVENUECAT_V2_SECRET_KEY: 'fixture-revenuecat-value',
  REVENUECAT_WEBHOOK_AUTH: AUTH_VALUE,
  FIRESTORE_PROJECT_ID: 'project-fixture',
  FIRESTORE_SERVICE_ACCOUNT_EMAIL: 'writer@example.invalid',
  FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY: PRIVATE_PEM,
  AUTH_LIMITER: { async limit() { return { success: true }; } },
  TRAFFIC: { writeDataPoint() {} },
  ASSETS: { fetch: async () => new Response('asset fallback', { status: 598 }) },
});

const activeSubscription = () => ({
  id: 'sub_cas_fixture', customer_id: UID, gives_access: true, status: 'active',
  environment: 'production', current_period_ends_at: END_MS, ends_at: END_MS,
  entitlements: { items: [{ lookup_key: 'plus' }] },
});
const statusRequest = () => new Request('https://railisland.tw/api/plus-status', {
  headers: { Authorization: `Bearer ${'x'.repeat(900)}`, 'cf-connecting-ip': '203.0.113.21' },
});
const webhookRequest = () => new Request('https://railisland.tw/api/revenuecat-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.22', Authorization: AUTH_VALUE },
  body: JSON.stringify({ api_version: '1.0', event: { id: 'event-cas', type: 'RENEWAL', app_user_id: UID, environment: 'PRODUCTION' } }),
});

// 每條流程都在自己的 ALS context 裡跑：自己的時鐘、自己的 RevenueCat 真相、自己的身分。
const flow = (name, nowMs, subscriptions, fn) => als.run({ name, nowMs, subscriptions }, fn);

const logs = [];
const realConsoleLog = console.log;
const realConsoleError = console.error;
function captureLogs() {
  console.log = (...args) => logs.push(args.map(String).join(' '));
  console.error = (...args) => logs.push(args.map(String).join(' '));
}
function releaseLogs() { console.log = realConsoleLog; console.error = realConsoleError; }

function resetWorld() {
  store = null;
  storeVersion = 0;
  beforePatch = null;
  requests = [];
  logs.length = 0;
  gates.clear();
  resetFirestoreAccessTokenCache();
}
const firestoreCalls = (method, flowName) => requests.filter(r => r.kind === 'firestore'
  && r.method === method && (!flowName || r.flow === flowName));
const storedNumber = (key) => (store && store.fields[key] ? store.fields[key].integerValue : '(無文件)');
const storedActive = () => (store ? store.fields.active.booleanValue : '(無文件)');
const storedSource = () => (store ? store.fields.source.stringValue : '(無文件)');

// ── 1. 替身自檢：precondition 真的有牙（判準本身要先被驗過）─────────────────────────────
section(SECTIONS[0]);
{
  resetWorld();
  const patchUrl = (query) => `https://firestore.googleapis.com/v1/${DOC_NAME}${query}`;
  const payload = JSON.stringify({ fields: fieldsOf({ active: true, activeUntilMs: 1, updatedAtMs: T_LATE, source: 'self-check' }) });

  const createBlocked = firestoreRespond(patchUrl('?currentDocument.updateTime=2026-08-04T00%3A00%3A01.000000Z'), 'PATCH', payload);
  check(createBlocked.status === 400 && store === null,
    '文件不存在時，帶 updateTime 的 PATCH 被拒（規格：updateTime 要求文件必須存在且停在那個版本）',
    `status=${createBlocked.status} store=${store === null ? 'null' : '有'}`);

  const created = firestoreRespond(patchUrl('?currentDocument.exists=false'), 'PATCH', payload);
  check(created.status === 200 && storedNumber('updatedAtMs') === String(T_LATE),
    '正向對照：exists=false 對不存在的文件 ⇒ 建立成功', `status=${created.status} updatedAtMs=${storedNumber('updatedAtMs')}`);

  const staleTime = store.updateTime;
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'interloper' });
  const stale = firestoreRespond(patchUrl(`?currentDocument.updateTime=${encodeURIComponent(staleTime)}`), 'PATCH', payload);
  check(stale.status === 400 && storedSource() === 'interloper',
    '過期的 updateTime ⇒ 400 FAILED_PRECONDITION，且文件內容沒有被覆寫',
    `status=${stale.status} source=${storedSource()}`);

  const fresh = firestoreRespond(patchUrl(`?currentDocument.updateTime=${encodeURIComponent(store.updateTime)}`), 'PATCH', payload);
  check(fresh.status === 200 && storedSource() === 'self-check',
    '正向對照：帶當下 updateTime ⇒ 寫得進去（證明上面的 400 是 precondition 造成的，不是替身整條壞了）',
    `status=${fresh.status} source=${storedSource()}`);

  const dup = firestoreRespond(patchUrl('?currentDocument.exists=false'), 'PATCH', payload);
  check(dup.status === 409, 'exists=false 對已存在的文件 ⇒ 409 ALREADY_EXISTS', `status=${dup.status}`);

  const naked = firestoreRespond(patchUrl(''), 'PATCH',
    JSON.stringify({ fields: fieldsOf({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'naked' }) }));
  check(naked.status === 200 && storedSource() === 'naked',
    '反向對照：完全不帶 precondition 的 PATCH ⇒ 替身照 Firestore 語意無條件覆寫（突變測試要能靠這條顯形）',
    `status=${naked.status} source=${storedSource()}`);
}

// ── 2. 單一寫入者：建立、更新、跳過、邊界 ──────────────────────────────────────────────
section(SECTIONS[1]);
{
  const write = async (doc) => {
    captureLogs();
    try { return { value: await flow('unit', doc.updatedAtMs, [], () => writePlusEntitlement(UID, doc, ENV(), doc.updatedAtMs)) }; }
    catch (e) { return { error: String(e && e.message || e) }; }
    finally { releaseLogs(); }
  };
  const incoming = (over = {}) => ({ active: true, activeUntilMs: END_MS, updatedAtMs: T_LATE, source: 'plus-status', ...over });

  resetWorld();
  let result = await write(incoming());
  const createPatch = firestoreCalls('PATCH')[0];
  check(result.value && result.value.written === true && firestoreCalls('PATCH').length === 1
      && createPatch.url.includes('currentDocument.exists=false') && storedNumber('updatedAtMs') === String(T_LATE),
    '文件不存在 ⇒ 用 currentDocument.exists=false 建立（不是無條件 PATCH）',
    JSON.stringify({ result: result.value, query: createPatch ? createPatch.url.split('?')[1] : '(無)', stored: storedNumber('updatedAtMs') }));

  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_EARLY, source: 'revenuecat-webhook' });
  const seededUpdateTime = store.updateTime;
  result = await write(incoming());
  const updatePatch = firestoreCalls('PATCH')[0];
  check(result.value && result.value.written === true
      && updatePatch.url.includes(`currentDocument.updateTime=${encodeURIComponent(seededUpdateTime)}`)
      && storedActive() === true && storedNumber('updatedAtMs') === String(T_LATE),
    '現存文件較舊 ⇒ 覆寫，且 precondition 逐字帶著剛剛讀到的 updateTime（不重新格式化）',
    JSON.stringify({ result: result.value, query: updatePatch ? decodeURIComponent(updatePatch.url.split('?')[1]) : '(無)', active: storedActive(), stored: storedNumber('updatedAtMs') }));

  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_LATE, source: 'revenuecat-webhook' });
  result = await write(incoming({ updatedAtMs: T_EARLY }));
  check(result.value && result.value.written === false && result.value.outcome === 'skipped-older'
      && firestoreCalls('PATCH').length === 0 && storedActive() === false && storedNumber('updatedAtMs') === String(T_LATE),
    '現存文件較新 ⇒ 一發 PATCH 都不送，文件原封不動（舊真相不得覆蓋新真相）',
    JSON.stringify({ result: result.value, patches: firestoreCalls('PATCH').length, active: storedActive(), stored: storedNumber('updatedAtMs') }));
  check(logs.some(line => line.includes('刻意跳過') && line.includes(String(T_LATE)) && line.includes(String(T_EARLY))),
    '跳過時留下的是「刻意跳過」的紀錄並帶著兩邊的時間戳，看得出來不是失敗', JSON.stringify(logs));

  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_LATE, source: 'revenuecat-webhook' });
  result = await write(incoming({ updatedAtMs: T_LATE }));
  check(result.value && result.value.written === true && storedActive() === true,
    '邊界：兩筆 updatedAtMs 相同（同一毫秒）⇒ 寫得進去（條件是 <=；同毫秒是一樣新的真相，用 < 會讓自癒永遠卡住）',
    JSON.stringify({ result: result.value, active: storedActive() }));

  for (const [label, broken] of [
    ['缺 updatedAtMs 欄位', { active: { booleanValue: false } }],
    ['updatedAtMs 是字串型別（不是 integerValue）', { updatedAtMs: { stringValue: '9999999999999' } }],
    ['updatedAtMs 轉不出數字', { updatedAtMs: { integerValue: 'not-a-number' } }],
  ]) {
    resetWorld();
    storeVersion += 1;
    store = { name: DOC_NAME, fields: broken, createTime: stamp(0), updateTime: stamp(storeVersion) };
    result = await write(incoming({ updatedAtMs: T_EARLY }));
    check(result.value && result.value.written === true && storedNumber('updatedAtMs') === String(T_EARLY),
      `現存文件${label} ⇒ 排不出先後，視同可覆寫（剛查到的真相不該被一份無法排序的文件擋住）`,
      JSON.stringify({ result: result.value, stored: storedNumber('updatedAtMs') }));
  }

  resetWorld();
  storeVersion += 1;
  store = { name: DOC_NAME, fields: fieldsOf({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'x' }) };  // 沒有 updateTime
  result = await write(incoming());
  check(result.error && firestoreCalls('PATCH').length === 0,
    '讀到 200 卻沒有 updateTime ⇒ 拋錯不寫（沒有 updateTime 就做不出 CAS，硬寫等於靜默降級回無條件覆寫）',
    JSON.stringify({ error: result.error, patches: firestoreCalls('PATCH').length }));
}

// ── 3／4. 雙向交錯 ────────────────────────────────────────────────────────────────────
// 共用的編排：先讓 slow 那條流程跑到「已經讀完、正要寫」的位置停住，讓 fast 那條整個跑完，
// 再放行 slow。slow 手上握的是**較早**取得的真相，fast 是**較晚**的；不論誰先抵達 Firestore，
// 留下來的都必須是 T_LATE 那一筆。
async function interleave({ slow, fast }) {
  resetWorld();
  seedStore({ active: slow.seedActive, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'seed' });
  captureLogs();
  let slowResult = { status: 0, body: {}, error: null };
  let fastResult = { status: 0, body: {}, error: null };
  let reached = false;
  try {
    const gate = armGate(`${slow.name}:PATCH`);
    let settled = false;
    const pending = flow(slow.name, T_EARLY, slow.subscriptions, slow.run).then(
      async (res) => { slowResult = { status: res.status, body: await res.json(), error: null }; },
      (e) => { slowResult = { status: 0, body: {}, error: String(e && e.message || e) }; },
    ).then(() => { settled = true; });
    reached = await waitForHold(gate, () => settled);
    const fastResponse = await flow(fast.name, T_LATE, fast.subscriptions, fast.run);
    fastResult = { status: fastResponse.status, body: await fastResponse.json(), error: null };
    gate.release();
    await pending;
  } finally { releaseLogs(); }
  return { slowResult, fastResult, reached };
}

section(SECTIONS[2]);
{
  // 稽核者重現的那條：較早的 plus-status 查到「有效訂閱」但請求延遲，退款 webhook 稍後查到
  // 「無資格」先寫入。舊版會被那筆遲到的 active 反向覆寫回去。
  const { slowResult, fastResult, reached } = await interleave({
    slow: { name: 'plus-status', seedActive: true, subscriptions: [activeSubscription()], run: () => plusStatus(statusRequest(), ENV()) },
    fast: { name: 'webhook', subscriptions: [], run: () => worker.fetch(webhookRequest(), ENV(), {}) },
  });
  check(reached,
    '交錯真的成立：較早的 plus-status 確實停在「已讀完現存文件、正要寫」的位置（沒踩到閘門＝這一段其實沒驗到並發）',
    `reached=${reached}`);
  check(storedActive() === false && storedNumber('updatedAtMs') === String(T_LATE) && storedSource() === 'revenuecat-webhook',
    '較早的 plus-status（有效訂閱）最後抵達 ⇒ 文件仍是退款 webhook 那份 active=false（舊真相沒有覆蓋新真相）',
    JSON.stringify({ active: storedActive(), updatedAtMs: storedNumber('updatedAtMs'), source: storedSource() }));
  check(firestoreCalls('PATCH', 'plus-status').length === 1 && firestoreCalls('PATCH', 'plus-status')[0].status === 400
      && firestoreCalls('GET', 'plus-status').length === 2,
    '遲到那條真的撞上 precondition（PATCH 被拒一次）、重讀一次後就不再送第二發 PATCH',
    JSON.stringify({ patch: firestoreCalls('PATCH', 'plus-status').map(r => r.status), get: firestoreCalls('GET', 'plus-status').length }));
  check(slowResult.status === 200 && slowResult.body.active === true,
    '寫入被跳過不影響 /api/plus-status 的唯讀答案（它回的是自己剛查到的真相，仍是 200）',
    JSON.stringify(slowResult));
  // 批二-B：兩個真相在這裡分家的最乾淨案例——RevenueCat 說有資格（active:true），但這一發的資格
  // 文件寫入被 CAS 判成「現存的比較新」而跳過，我方既沒寫、也沒讀回它的內容 ⇒ 不得宣稱雲端已放行。
  // 期望值是本檔自己宣告的字面 false，不從 writePlusEntitlement 的回傳推導。
  check(slowResult.body.cloudSyncReady === false,
    '批二-B：CAS 跳過寫入（skipped-older）時 cloudSyncReady 必須是 false——active 為真不等於雲端寫得進去',
    JSON.stringify(slowResult.body));
  check(fastResult.status === 200 && fastResult.body.ok === true,
    '正向對照：先完成的 webhook 回 200，且它那一筆確實是寫進去的那份', JSON.stringify(fastResult));
  check(logs.some(line => line.includes('刻意跳過')),
    '遲到那條留下「刻意跳過」的紀錄，不是失敗紀錄', JSON.stringify(logs.filter(l => l.includes('[plus-entitlement]'))));
}

section(SECTIONS[3]);
{
  // 反方向：較早的 webhook 查到「無資格」但請求延遲，使用者重新訂閱後 plus-status 查到有效並
  // 先寫入。舊版會被那筆遲到的 inactive 蓋掉 ⇒ 付費者被誤判成沒訂閱。
  const { slowResult, fastResult, reached } = await interleave({
    slow: { name: 'webhook', seedActive: false, subscriptions: [], run: () => worker.fetch(webhookRequest(), ENV(), {}) },
    fast: { name: 'plus-status', subscriptions: [activeSubscription()], run: () => plusStatus(statusRequest(), ENV()) },
  });
  check(reached,
    '交錯真的成立：較早的 webhook 確實停在「已讀完現存文件、正要寫」的位置（沒踩到閘門＝這一段其實沒驗到並發）',
    `reached=${reached}`);
  check(storedActive() === true && storedNumber('updatedAtMs') === String(T_LATE) && storedSource() === 'plus-status',
    '較早的 webhook（無資格）最後抵達 ⇒ 文件仍是 plus-status 那份 active=true（付費者不會被舊的 inactive 蓋掉）',
    JSON.stringify({ active: storedActive(), updatedAtMs: storedNumber('updatedAtMs'), source: storedSource() }));
  check(firestoreCalls('PATCH', 'webhook').length === 1 && firestoreCalls('PATCH', 'webhook')[0].status === 400
      && firestoreCalls('GET', 'webhook').length === 2,
    '遲到那條真的撞上 precondition（PATCH 被拒一次）、重讀一次後就不再送第二發 PATCH',
    JSON.stringify({ patch: firestoreCalls('PATCH', 'webhook').map(r => r.status), get: firestoreCalls('GET', 'webhook').length }));
  check(slowResult.status === 200 && slowResult.body.ok === true,
    '刻意跳過的 webhook 回 200，不是 503（跳過是成功；回 503 會白燒 RevenueCat 有限的重試次數）',
    JSON.stringify(slowResult));
  check(fastResult.status === 200 && fastResult.body.active === true,
    '正向對照：先完成的 plus-status 回 200 active:true，且它那一筆確實是寫進去的那份', JSON.stringify(fastResult));
  // 批二-B 正向對照（與第 3 段那條互為對照，同一支替身、同一顆假 Firestore）：這一發真的把 active
  // 的資格文件寫進去了 ⇒ cloudSyncReady 必須是 true。少了這條，上一段的 false 可能只是「這個欄位
  // 恆為 false」而不是「它真的在回報落地結果」。
  check(fastResult.body.cloudSyncReady === true,
    '批二-B 正向對照：資格文件真的寫進去（CAS created／updated）且內容 active ⇒ cloudSyncReady 為 true',
    JSON.stringify(fastResult.body));
}

// ── 5. 衝突後的行為 ──────────────────────────────────────────────────────────────────
section(SECTIONS[4]);
{
  const write = async (doc) => {
    captureLogs();
    try { return { value: await flow('unit', doc.updatedAtMs, [], () => writePlusEntitlement(UID, doc, ENV(), doc.updatedAtMs)) }; }
    catch (e) { return { error: String(e && e.message || e) }; }
    finally { releaseLogs(); }
  };
  const mine = { active: true, activeUntilMs: END_MS, updatedAtMs: T_LATE, source: 'plus-status' };

  // (a) 插隊者寫的是**較舊**的一筆 ⇒ 衝突之後重讀，發現自己仍然比較新，必須重試並寫成功。
  //     這條是「衝突就無腦跳過」的反例：跳過在這裡是錯的。
  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'seed' });
  let once = false;
  beforePatch = () => {
    if (once) return;
    once = true;
    seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_EARLY, source: 'interloper' });
  };
  let result = await write(mine);
  check(result.value && result.value.written === true && storedNumber('updatedAtMs') === String(T_LATE)
      && storedSource() === 'plus-status' && firestoreCalls('PATCH').length === 2 && firestoreCalls('GET').length === 2,
    '衝突後重讀，發現自己仍是較新的 ⇒ 重試並寫成功（衝突不等於放棄；只重試 PATCH 而不重讀才是「等於沒修」）',
    JSON.stringify({ result: result.value, stored: storedNumber('updatedAtMs'), source: storedSource(), patches: firestoreCalls('PATCH').length, gets: firestoreCalls('GET').length }));

  // (b) 插隊者寫的是**較新**的一筆 ⇒ 衝突之後重讀就該收手，不得繼續強寫。
  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'seed' });
  once = false;
  beforePatch = () => {
    if (once) return;
    once = true;
    seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_LATE + 1_000, source: 'interloper' });
  };
  result = await write(mine);
  check(result.value && result.value.written === false && result.value.outcome === 'skipped-older'
      && storedSource() === 'interloper' && firestoreCalls('PATCH').length === 1,
    '衝突後重讀，發現對方比較新 ⇒ 收手不強寫（只有重讀＋重新比時間戳才做得到這個分辨）',
    JSON.stringify({ result: result.value, source: storedSource(), patches: firestoreCalls('PATCH').length }));

  // (c) 每一發 PATCH 前都有人插隊（且插隊的都比較舊）⇒ 重試次數必須有上限，不得無限重試／活鎖。
  //     上限的**數值**刻意不寫死成實作常數，只斷言「有限且大於一次」——判準不從被測程式碼推導。
  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'seed' });
  let bump = 0;
  beforePatch = () => {
    bump += 1;
    seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED + bump, source: 'interloper' });
  };
  result = await write(mine);
  const attempts = firestoreCalls('PATCH').length;
  check(!!result.error && attempts >= 2 && attempts <= 10 && storedSource() === 'interloper',
    '每次都被插隊 ⇒ 有限次數內收斂成拋錯、保留現況（不強寫、也不無限重試）',
    JSON.stringify({ error: result.error, patchAttempts: attempts, source: storedSource() }));

  // (d) 非衝突的硬失敗（500）⇒ 直接拋錯，不當成衝突重試。
  resetWorld();
  seedStore({ active: false, activeUntilMs: 0, updatedAtMs: T_SEED, source: 'seed' });
  patchHardFailure = true;
  result = await write(mine);
  patchHardFailure = false;
  check(!!result.error && firestoreCalls('PATCH').length === 1 && storedSource() === 'seed',
    '寫入回 500（不是衝突）⇒ 直接拋錯、不重試、不覆寫現況',
    JSON.stringify({ error: result.error, patches: firestoreCalls('PATCH').length, source: storedSource() }));
}

globalThis.fetch = realFetch;
Date.now = realNow;

SECTION = '(收尾)';
const missing = SECTIONS.filter(name => !seen.get(name));
check(missing.length === 0, '每個宣告過的段落都真的跑過至少一條判準',
  missing.length ? `沒跑到：${missing.join('、')}` : SECTIONS.map(s => `${s}=${seen.get(s)}`).join(' '));
console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
