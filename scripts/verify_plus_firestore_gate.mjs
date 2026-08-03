// 驗「軌島 Plus」伺服器端資格文件寫入：service account JWT、OAuth token 快取、
// Firestore REST payload、自癒路徑與 RevenueCat webhook。全程只用 fetch 替身，不打外部服務。
//
// 用法：node scripts/verify_plus_firestore_gate.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5(WORKER_PATH)}`);

const workerModule = await import('../worker.js');
const worker = workerModule.default;
const {
  plusEntitlementDocument, firestoreEntitlementPayload,
  getFirestoreAccessToken, resetFirestoreAccessTokenCache,
  writePlusEntitlement, plusStatus,
} = workerModule._plus;

let fails = 0;
// 突變證明仍會跑完整支腳本，只把 PASS 行收起來，保留真實 exit code 與 FAIL 行；不用管道截輸出。
const QUIET = process.env.VERIFY_MUTATION_QUIET === '1';
const SECTIONS = [
  '1 JWT header／claims／RS256',
  '2 OAuth token 快取與過期',
  '3 Firestore 資格文件契約',
  '4 webhook Authorization 與接線',
  '5 sandbox／production 分流',
  '6 plus-status 寫入失敗隔離',
  '7 webhook 速率限制',
  '8 分頁累積與 origin 白名單',
];
const seen = new Map();
let SECTION = '(未分段)';
const section = (name) => { SECTION = name; if (!QUIET) console.log(`\n===== ${name} =====`); };
const check = (ok, msg, detail = '') => {
  if (!ok) fails += 1;
  seen.set(SECTION, (seen.get(SECTION) || 0) + 1);
  if (!QUIET || !ok) console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`);
};

// 每次執行動態產生一次性測試金鑰；repo 裡沒有固定私鑰或 service account JSON。
const keyPair = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['sign', 'verify']);
const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
const privateBase64 = Buffer.from(privateDer).toString('base64').match(/.{1,64}/g).join('\n');
const PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----\n${privateBase64}\n-----END PRIVATE KEY-----`;

const AUTH_VALUE = 'Bearer fixture.authorization';
const UID = 'uid-fixture';
const END_MS = 1_800_000_000_000;
const NOW_MS = 1_700_000_000_000;
const baseSubscription = (over = {}) => ({
  id: 'sub_fixture', customer_id: UID, gives_access: true, status: 'active',
  environment: 'production', current_period_ends_at: END_MS, ends_at: END_MS,
  entitlements: { items: [{ lookup_key: 'plus' }] },
  ...over,
});

let calls = [];
let oauthAssertions = [];
let oauthCount = 0;
let oauthExpiresIn = 3600;
let rcBody = { items: [baseSubscription()] };
let rcPages = null;
let rcStatus = 200;
let firestoreStatus = 200;
let trafficPoints = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = init.method || (typeof input !== 'string' && input.method) || 'GET';
  calls.push({ url, method, headers: new Headers(init.headers || {}), body: init.body });
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body);
    oauthAssertions.push(form.get('assertion'));
    oauthCount += 1;
    return new Response(JSON.stringify({ access_token: `oauth-fixture-${oauthCount}`, expires_in: oauthExpiresIn }), { status: 200 });
  }
  if (url.includes('identitytoolkit.googleapis.com')) {
    return new Response(JSON.stringify({ users: [{ localId: UID }] }), { status: 200 });
  }
  if (url.includes('api.revenuecat.com')) {
    if (rcPages) {
      const n = calls.filter(call => call.url.includes('api.revenuecat.com')).length - 1;
      const page = rcPages[Math.min(n, rcPages.length - 1)];
      return new Response(JSON.stringify(page.body), { status: page.status || 200 });
    }
    return new Response(JSON.stringify(rcBody), { status: rcStatus });
  }
  if (url.includes('firestore.googleapis.com')) {
    return new Response('{}', { status: firestoreStatus });
  }
  return new Response('{}', { status: 599 });
};

const limiter = (success = true, thrown = false) => ({
  calls: 0,
  async limit() {
    this.calls += 1;
    if (thrown) throw new Error('limiter unavailable');
    return { success };
  },
});

const ENV = (over = {}) => ({
  FIREBASE_WEB_API_KEY: 'fixture-web-key',
  REVENUECAT_PROJECT_ID: 'project-fixture',
  REVENUECAT_V2_SECRET_KEY: 'fixture-revenuecat-value',
  REVENUECAT_WEBHOOK_AUTH: AUTH_VALUE,
  FIRESTORE_PROJECT_ID: 'project-fixture',
  FIRESTORE_SERVICE_ACCOUNT_EMAIL: 'writer@example.invalid',
  FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY: PRIVATE_PEM,
  AUTH_LIMITER: limiter(true),
  TRAFFIC: { writeDataPoint(point) { trafficPoints.push(point); } },
  ASSETS: { fetch: async () => new Response('asset fallback', { status: 598 }) },
  ...over,
});

function resetIo({ resetToken = true } = {}) {
  calls = [];
  oauthAssertions = [];
  oauthCount = 0;
  oauthExpiresIn = 3600;
  rcBody = { items: [baseSubscription()] };
  rcPages = null;
  rcStatus = 200;
  firestoreStatus = 200;
  trafficPoints = [];
  if (resetToken) resetFirestoreAccessTokenCache();
}

const callsTo = (fragment) => calls.filter(call => call.url.includes(fragment));
const decodeJwtPart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const webhookRequest = (authorization, environment = 'PRODUCTION', method = 'POST') => {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' };
  if (authorization !== null) headers.Authorization = authorization;
  return new Request('https://railisland.tw/api/revenuecat-webhook', {
    method, headers,
    body: method === 'POST' ? JSON.stringify({ api_version: '1.0', event: {
      id: 'event-fixture', type: 'RENEWAL', app_user_id: UID, environment,
    } }) : undefined,
  });
};
const plusStatusRequest = () => new Request('https://railisland.tw/api/plus-status', {
  headers: { Authorization: `Bearer ${'x'.repeat(900)}`, 'cf-connecting-ip': '203.0.113.8' },
});

section(SECTIONS[0]);
{
  resetIo();
  const issuedAtMs = 1_730_000_000_123;
  const token = await getFirestoreAccessToken(ENV(), issuedAtMs);
  check(token === 'oauth-fixture-1', 'JWT assertion 可換到 OAuth access token（替身回應有被採用）', token);
  check(oauthAssertions.length === 1 && typeof oauthAssertions[0] === 'string',
    'OAuth 表單真的帶一顆 JWT assertion', `assertions=${oauthAssertions.length}`);
  const parts = (oauthAssertions[0] || '').split('.');
  const header = parts.length === 3 ? decodeJwtPart(parts[0]) : {};
  const claims = parts.length === 3 ? decodeJwtPart(parts[1]) : {};
  check(parts.length === 3 && JSON.stringify(header) === JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    'JWT header 精確宣告 alg=RS256、typ=JWT', JSON.stringify(header));
  const expectedIssuedAt = Math.floor(issuedAtMs / 1000);
  check(claims.iss === 'writer@example.invalid'
      && claims.scope === 'https://www.googleapis.com/auth/datastore'
      && claims.aud === 'https://oauth2.googleapis.com/token'
      && claims.iat === expectedIssuedAt && claims.exp === expectedIssuedAt + 3600,
    'JWT claims 含正確 iss／datastore scope／aud／一小時效期', JSON.stringify(claims));
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2] || '', 'base64url');
  const signatureOk = parts.length === 3 && await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', keyPair.publicKey, signature, new TextEncoder().encode(signingInput)
  );
  check(signatureOk, 'JWT 簽章可由獨立 public key 以 RSASSA-PKCS1-v1_5＋SHA-256 驗過');
  const oauthCall = callsTo('oauth2.googleapis.com/token')[0];
  const form = oauthCall ? new URLSearchParams(oauthCall.body) : new URLSearchParams();
  check(oauthCall && oauthCall.method === 'POST'
      && form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'OAuth token exchange 使用 JWT bearer grant', form.get('grant_type') || '無');
}

section(SECTIONS[1]);
{
  resetIo();
  const t0 = 1_730_000_000_000;
  const first = await getFirestoreAccessToken(ENV(), t0);
  const cached = await getFirestoreAccessToken(ENV(), t0 + 1_000);
  check(first === cached && oauthCount === 1,
    '過期前重用 isolate 記憶體 access token，不重打 OAuth', `${first}/${cached} oauth=${oauthCount}`);
  const renewed = await getFirestoreAccessToken(ENV(), t0 + 3_601_000);
  check(renewed !== first && oauthCount === 2,
    '正向對照：token 過期後會重新交換', `${first}/${renewed} oauth=${oauthCount}`);
}

section(SECTIONS[2]);
{
  const activeDoc = plusEntitlementDocument({ items: [baseSubscription()] }, 'plus', 'plus-status', NOW_MS);
  check(JSON.stringify(Object.keys(activeDoc).sort()) === JSON.stringify(['active', 'activeUntilMs', 'source', 'updatedAtMs']),
    '資格文件只有契約四欄', Object.keys(activeDoc).sort().join(','));
  check(activeDoc.active === true && activeDoc.activeUntilMs === END_MS + 86_400_000
      && activeDoc.updatedAtMs === NOW_MS && activeDoc.source === 'plus-status',
    '正式有效訂閱 ⇒ active=true、最新到期時刻加 24 小時寬限', JSON.stringify(activeDoc));
  const inactiveDoc = plusEntitlementDocument({ items: [baseSubscription({ gives_access: false })] }, 'plus', 'plus-status', NOW_MS);
  check(inactiveDoc.active === false && inactiveDoc.activeUntilMs === 0,
    '無存取權 ⇒ active=false、activeUntilMs=0', JSON.stringify(inactiveDoc));
  const lifetimeDoc = plusEntitlementDocument({ items: [baseSubscription({ ends_at: null, current_period_ends_at: null })] }, 'plus', 'plus-status', NOW_MS);
  check(lifetimeDoc.active === true && lifetimeDoc.activeUntilMs === 0,
    '正式有效但無到期日 ⇒ activeUntilMs=0（不設限）', JSON.stringify(lifetimeDoc));
  const emptyEntitlementsDoc = plusEntitlementDocument({ items: [baseSubscription({ entitlements: { items: [] } })] }, 'plus', 'plus-status', NOW_MS);
  check(emptyEntitlementsDoc.active === false && emptyEntitlementsDoc.activeUntilMs === 0,
    'entitlements 明確回空陣列 ⇒ 不算有資格（不能與欄位缺席的 fallback 混為一談）', JSON.stringify(emptyEntitlementsDoc));
  check(activeDoc.active === true,
    '正向對照：相同訂閱掛有正確 lookup_key ⇒ 算有資格', JSON.stringify(activeDoc));
  const restPayload = firestoreEntitlementPayload(activeDoc);
  check(restPayload.fields.active.booleanValue === true
      && restPayload.fields.activeUntilMs.integerValue === String(END_MS + 86_400_000)
      && restPayload.fields.updatedAtMs.integerValue === String(NOW_MS)
      && restPayload.fields.source.stringValue === 'plus-status',
    'Firestore REST 型別包裝保留 boolean／integer／string 契約', JSON.stringify(restPayload));

  resetIo();
  await writePlusEntitlement(UID, activeDoc, ENV(), NOW_MS);
  const writes = callsTo('firestore.googleapis.com');
  const written = writes[0] ? JSON.parse(writes[0].body) : {};
  check(writes.length === 1 && writes[0].method === 'PATCH'
      && writes[0].url.endsWith(`/documents/entitlements/${UID}`),
    '實際寫入 entitlements/{uid}，使用 Firestore REST PATCH', writes.map(c => `${c.method} ${c.url}`).join(' | '));
  check(writes.length === 1 && written.fields.source.stringValue === 'plus-status'
      && writes[0].headers.get('Authorization') === 'Bearer oauth-fixture-1',
    '實際 REST body 與 Authorization 都送到替身（不是只測沒被呼叫的純函式）', JSON.stringify(written));
}

section(SECTIONS[3]);
{
  resetIo();
  let response = await worker.fetch(webhookRequest(null), ENV(), {});
  check(response.status === 401 && calls.length === 0,
    'Authorization 缺席 ⇒ 401，且零 outbound fetch', `status=${response.status} calls=${calls.length}`);

  resetIo();
  response = await worker.fetch(webhookRequest('Bearer wrong.fixture'), ENV(), {});
  check(response.status === 401 && calls.length === 0,
    'Authorization 錯誤 ⇒ 401，且零 outbound fetch', `status=${response.status} calls=${calls.length}`);

  resetIo();
  response = await worker.fetch(webhookRequest(AUTH_VALUE), ENV(), {});
  const acceptedWrites = callsTo('firestore.googleapis.com');
  check(response.status === 200 && (await response.json()).ok === true && acceptedWrites.length === 1,
    'Authorization 正確 ⇒ 路由接受並真的寫入 Firestore', `status=${response.status} writes=${acceptedWrites.length}`);
  check(trafficPoints.some(point => point.blobs && point.blobs[1] === 'revenuecat-webhook'),
    'API_ENDPOINTS 已接上 webhook，流量埋點不會落到 other', JSON.stringify(trafficPoints));

  resetIo();
  response = await worker.fetch(webhookRequest(AUTH_VALUE, 'PRODUCTION', 'GET'), ENV(), {});
  check(response.status === 405 && response.headers.get('Allow') === 'POST, OPTIONS' && calls.length === 0,
    'webhook 只收 POST；GET 明確回 405', `status=${response.status} allow=${response.headers.get('Allow')}`);

  resetIo();
  response = await worker.fetch(webhookRequest(AUTH_VALUE), ENV({ REVENUECAT_WEBHOOK_AUTH: '' }), {});
  check(response.status === 503 && calls.length === 0,
    'webhook secret 未設定 ⇒ 503 fail-closed，且零 outbound fetch', `status=${response.status} calls=${calls.length}`);
}

section(SECTIONS[4]);
{
  resetIo();
  let response = await worker.fetch(webhookRequest(AUTH_VALUE, 'SANDBOX'), ENV(), {});
  check(response.status === 200 && callsTo('api.revenuecat.com').length === 0
      && callsTo('firestore.googleapis.com').length === 0,
    'SANDBOX webhook ⇒ 接受但不查正式資格、不寫 Firestore',
    `status=${response.status} rc=${callsTo('api.revenuecat.com').length} writes=${callsTo('firestore.googleapis.com').length}`);

  resetIo();
  response = await worker.fetch(webhookRequest(AUTH_VALUE, 'PRODUCTION'), ENV(), {});
  const writes = callsTo('firestore.googleapis.com');
  const body = writes[0] ? JSON.parse(writes[0].body) : {};
  check(response.status === 200 && writes.length === 1 && body.fields.active.booleanValue === true,
    '正向對照：PRODUCTION webhook＋正式有效訂閱 ⇒ 寫 active=true',
    `status=${response.status} writes=${writes.length} body=${JSON.stringify(body)}`);

  resetIo();
  rcBody = { items: [baseSubscription({ environment: 'sandbox' })] };
  response = await worker.fetch(webhookRequest(AUTH_VALUE, 'PRODUCTION'), ENV(), {});
  const sandboxInRest = callsTo('firestore.googleapis.com');
  const sandboxBody = sandboxInRest[0] ? JSON.parse(sandboxInRest[0].body) : {};
  check(response.status === 200 && sandboxInRest.length === 1 && sandboxBody.fields.active.booleanValue === false,
    '第二道防線：REST 回應若混入 sandbox 訂閱，也只能寫 active=false', JSON.stringify(sandboxBody));

  resetIo();
  rcBody = { items: [baseSubscription({ gives_access: false })] };
  response = await worker.fetch(webhookRequest(AUTH_VALUE, 'PRODUCTION'), ENV(), {});
  const revokedWrites = callsTo('firestore.googleapis.com');
  const revokedBody = revokedWrites[0] ? JSON.parse(revokedWrites[0].body) : {};
  check(response.status === 200 && revokedWrites.length === 1
      && revokedBody.fields.active.booleanValue === false
      && revokedBody.fields.source.stringValue === 'revenuecat-webhook',
    '正式到期／退款／撤銷後 gives_access=false ⇒ webhook 寫 active=false', JSON.stringify(revokedBody));
}

section(SECTIONS[5]);
{
  resetIo();
  firestoreStatus = 500;
  const errors = [];
  const realConsoleError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  let response;
  try { response = await plusStatus(plusStatusRequest(), ENV()); }
  finally { console.error = realConsoleError; }
  const body = await response.json();
  check(response.status === 200 && body.active === true,
    'Firestore 寫入失敗時 /api/plus-status 仍回正確唯讀答案', `status=${response.status} body=${JSON.stringify(body)}`);
  check(callsTo('firestore.googleapis.com').length === 1 && errors.some(line => line.includes('Firestore write failed')),
    '失敗確實發生且有診斷 log，不是靜默跳過寫入', `writes=${callsTo('firestore.googleapis.com').length} logs=${JSON.stringify(errors)}`);

  resetIo();
  const successErrors = [];
  console.error = (...args) => successErrors.push(args.map(String).join(' '));
  try { response = await plusStatus(plusStatusRequest(), ENV()); }
  finally { console.error = realConsoleError; }
  check(response.status === 200 && callsTo('firestore.googleapis.com').length === 1 && successErrors.length === 0,
    '正向對照：寫入成功時仍回 200、確實寫一筆且不誤報錯',
    `status=${response.status} writes=${callsTo('firestore.googleapis.com').length} logs=${successErrors.length}`);

  resetIo();
  rcBody = { items: [baseSubscription({ environment: 'sandbox' })] };
  response = await plusStatus(plusStatusRequest(), ENV());
  const sandboxStatusBody = await response.json();
  const sandboxStatusWrites = callsTo('firestore.googleapis.com');
  const sandboxStatusDoc = sandboxStatusWrites[0] ? JSON.parse(sandboxStatusWrites[0].body) : {};
  check(response.status === 200 && sandboxStatusBody.active === false
      && sandboxStatusWrites.length === 1
      && sandboxStatusDoc.fields.active.booleanValue === false
      && sandboxStatusDoc.fields.source.stringValue === 'plus-status',
    'sandbox-only /api/plus-status ⇒ 唯讀回 active:false，且自癒文件也寫 active:false',
    `response=${JSON.stringify(sandboxStatusBody)} doc=${JSON.stringify(sandboxStatusDoc)}`);
}

section(SECTIONS[6]);
{
  resetIo();
  const blockedLimiter = limiter(false);
  let response = await worker.fetch(webhookRequest(AUTH_VALUE), ENV({ AUTH_LIMITER: blockedLimiter }), {});
  check(response.status === 429 && blockedLimiter.calls === 1 && calls.length === 0,
    'webhook 被 rate limiter 擋下 ⇒ 429，且一發上游／寫入都沒有',
    `status=${response.status} limiter=${blockedLimiter.calls} calls=${calls.length}`);

  resetIo();
  const openLimiter = limiter(true);
  response = await worker.fetch(webhookRequest(AUTH_VALUE), ENV({ AUTH_LIMITER: openLimiter }), {});
  check(response.status === 200 && openLimiter.calls === 1 && callsTo('firestore.googleapis.com').length === 1,
    '正向對照：limiter 放行 ⇒ webhook 會走到 Firestore 寫入',
    `status=${response.status} limiter=${openLimiter.calls} writes=${callsTo('firestore.googleapis.com').length}`);

  resetIo();
  const brokenLimiter = limiter(true, true);
  response = await worker.fetch(webhookRequest(AUTH_VALUE), ENV({ AUTH_LIMITER: brokenLimiter }), {});
  check(response.status === 429 && calls.length === 0,
    '寫入端點的 limiter 服務拋例外 ⇒ fail-closed 429', `status=${response.status} calls=${calls.length}`);
}

section(SECTIONS[7]);
{
  // 官方 next_page example 是相對路徑。第一頁已命中較早到期的 Plus，第二頁另有較晚到期
  // 的命中；若命中即提早回傳，雖然 active 仍是 true，activeUntilMs 會靜默算錯。
  resetIo();
  const laterEndMs = END_MS + 10_000_000;
  rcPages = [
    { body: { items: [baseSubscription()], next_page: '/v2/projects/project-fixture/customers/uid-fixture/subscriptions?environment=production&limit=100&starting_after=sub_fixture' } },
    { body: { items: [baseSubscription({ id: 'sub_fixture_page_2', ends_at: laterEndMs, current_period_ends_at: laterEndMs })], next_page: null } },
  ];
  let response = await plusStatus(plusStatusRequest(), ENV());
  const pageBody = await response.json();
  const pageCalls = callsTo('api.revenuecat.com');
  const pageWrites = callsTo('firestore.googleapis.com');
  const pageWriteBody = pageWrites[0] ? JSON.parse(pageWrites[0].body) : {};
  check(response.status === 200 && pageBody.active === true && pageCalls.length === 2
      && pageWriteBody.fields && pageWriteBody.fields.active.booleanValue === true
      && pageWriteBody.fields.activeUntilMs.integerValue === String(laterEndMs + 86_400_000),
    '有效訂閱跨到第 2 頁 ⇒ 資格文件仍 active=true，且累積所有頁命中後取最晚到期＋寬限（命中不提早回傳）',
    JSON.stringify({ status: response.status, pageBody, rcCalls: pageCalls.length, written: pageWriteBody }));
  check(pageCalls.length === 2 && pageCalls.every(call => new URL(call.url).host === 'api.revenuecat.com'),
    '正向對照：相對 next_page 真的翻頁，兩發 RevenueCat 呼叫都解析成固定 host', pageCalls.map(call => call.url).join(' | '));

  // 寫入路徑收到外部絕對 next_page 時，收集每一發 outbound host。正確實作會拒絕外部 host，
  // 但仍用已完整取得的空集合自癒寫 inactive 文件，所以四種合法上游都會出現，構成同一收集器
  // 的正向對照；若另生一條未釘 origin 的 RevenueCat fetch，evil.example.com 會直接被收進來。
  resetIo();
  rcPages = [{ body: { items: [], next_page: 'https://evil.example.com/steal' } }];
  response = await plusStatus(plusStatusRequest(), ENV());
  const rejectedBody = await response.json();
  const hosts = calls.map(call => new URL(call.url).host);
  const allowedHosts = new Set([
    'identitytoolkit.googleapis.com', 'api.revenuecat.com',
    'oauth2.googleapis.com', 'firestore.googleapis.com',
  ]);
  const unexpectedHosts = [...new Set(hosts.filter(host => !allowedHosts.has(host)))];
  const requiredHosts = [...allowedHosts].filter(host => !hosts.includes(host));
  check(response.status === 200 && rejectedBody.active === false && unexpectedHosts.length === 0,
    '資格文件寫入路徑的所有 outbound host 都在白名單，外部 next_page 不會收到 RevenueCat Authorization',
    JSON.stringify({ status: response.status, rejectedBody, hosts, unexpectedHosts }));
  check(requiredHosts.length === 0,
    '正向對照：同一 host 收集器確實看見 Firebase、RevenueCat、OAuth、Firestore 四種合法上游（不是空集合假綠）',
    JSON.stringify({ hosts, missing: requiredHosts }));
}

globalThis.fetch = realFetch;

SECTION = '(收尾)';
const missing = SECTIONS.filter(name => !seen.get(name));
check(missing.length === 0, '每個宣告過的段落都真的跑過至少一條判準',
  missing.length ? `沒跑到：${missing.join('、')}` : SECTIONS.map(s => `${s}=${seen.get(s)}`).join(' '));
console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
