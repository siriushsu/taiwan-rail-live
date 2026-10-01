// 驗「Plus 資格的環境收斂」——sandbox 購買不得被當成正式 Plus。
//
// 背景（C-3）：舊版 worker.js 打 RevenueCat v2 的 /active_entitlements 並用 items.length>0 判定，
// 而那支端點在協定層面就分辨不出環境——官方 OpenAPI v2 的 CustomerEntitlement 只有
// object/entitlement_id/expires_at 三個欄位且標了 additionalProperties:false（規格明文禁止出現
// 其他欄位）。於是 TestFlight／模擬器的 sandbox 購買可以解鎖正式付費功能與雲端同步。
// 修法是改打 /subscriptions（有 environment query 參數；回應的 Subscription 有 top-level 必填的
// environment 與 gives_access）。本檔驗的就是這條路徑的三個維度：打對端點、環境判對、存取權判對。
//
// 為什麼判準不是只看回傳狀態碼：「回 403」可以是因為整條路徑壞了（打錯端點、解析失敗、
// 例外被吞掉），沉默不是證據。所以每一條「判定為無資格」都配一條同一支替身、只差一個欄位的
// 「判定為有資格」正向對照；並且另外數「到底打了哪些上游網址」。
//
// 用法：node scripts/verify_plus_entitlement_env.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── G0 自檢：本檔驗的是哪棵樹（心得 32：驗收腳本第一道 gate 要印出目標與關鍵檔 md5） ──────
// ROOT 由本檔自身路徑推導，不吃任何 --root／env 參數，結構上不可能誤驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
const WORKER = path.join(ROOT, 'worker.js');
const WRANGLER = path.join(ROOT, 'wrangler.jsonc');
const RELEASE = path.join(ROOT, 'app/scripts/verify-release.mjs');
const PREPARE = path.join(ROOT, 'app/scripts/prepare-web.mjs');
const INDEX = path.join(ROOT, 'index.html');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5(WORKER)}`);
console.log(`[G0] wrangler.jsonc md5=${md5(WRANGLER)}`);
console.log(`[G0] app/scripts/verify-release.mjs md5=${md5(RELEASE)}`);
console.log(`[G0] app/scripts/prepare-web.mjs md5=${md5(PREPARE)}`);

const workerModule = await import('../worker.js');
const { _plus } = workerModule;
const worker = workerModule.default;
const { assertPlusSandboxOff, assertPlusSandboxTestBuild, assertAndroidPlusReleaseConfig } = await import('../app/scripts/verify-release.mjs');
const { checkPlusEntitlement, plusStatus, resolveRcNextPage, rcSubscriptionsPageError,
  subscriptionMatchesPlus, plusEntitlementDocument } = _plus;

let fails = 0;
// 段落完整性守門員：整段被刪掉時，收尾只會印「全部 PASS」而分母悄悄變小＝假綠。
// 刻意**不寫「總共幾條」這種手打常數**（判準寫「是什麼」不寫「有幾個」）——只要求
// 每個宣告過的段落都真的跑過至少一條，段落整批消失時會有一條具名紅燈。
const SECTIONS = ['1 環境判別', '2 存取權判別', '3 entitlement 比對', '4 端點與 query', '5 錯誤分流', '6 plus-status 端到端', '7 發版閘門', '8 分頁與跟頁',
  '9 回應 schema 守門(I-3／I-4)', '10 分頁 404 與 customer 綁定(I-1／I-5)', '11 TestFlight CORS 預檢',
  '12 Firestore runtime 身分', '13 終身（一次性）購買'];
const seen = new Map();
let SECTION = '(未分段)';
const section = (name) => { SECTION = name; console.log(`\n===== ${name} =====`); };
const check = (ok, msg, detail = '') => {
  if (!ok) fails++;
  seen.set(SECTION, (seen.get(SECTION) || 0) + 1);
  console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}${detail ? ' — ' + detail : ''}`);
};

// ── 替身 ────────────────────────────────────────────────────────────────────
let upstream = [];                       // 每一發 outbound fetch 的網址
let rcBody = { items: [] };              // RevenueCat 端點要回什麼(單頁測試用)
let rcStatus = 200;
let rcThrow = false;
// 分頁測試專用(F-1):設定時,每一發 api.revenuecat.com 呼叫依序取下一筆(超出陣列長度時
// 重複最後一筆,用來模擬「next_page 一直不是 null」的情境以測翻頁上限)。與 rcBody/rcStatus
// 互斥——設定 rcSeq 時忽略 rcBody/rcStatus,見 runPages()。
let rcSeq = null;
// 終身段落專用（第 13 段）：/purchases 依 environment query 回應；沒設定的環境回合規空清單。
// /purchases 一律走這裡、不落到上面的 rcBody／rcSeq——那兩個是 /subscriptions 的形狀。
let rcPurchasesByEnv = {};
// Firebase 替身回的 uid。終身段落直接用 sandbox 實測 fixture，回應裡的 customer_id 是 fixture 的帳號，
// customer-scoped 守門（I-5）要求兩者一致，所以那一段會暫時換成 fixture 的 uid。
let identityUid = 'uid-under-test';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  // 🔴複審修復輪 2 G-1:忠實模擬 fetch() 對相對路徑的真實行為——Workers/瀏覽器的 fetch() 沒有
  // 隱含 base,傳相對路徑字串進去會直接拋 TypeError,這正是 G-1 的正式環境症狀。替身若對
  // 相對路徑照樣放行(例如回一個假 Response),next_page 誤用相對路徑的迴歸就永遠測不到
  // ——判準不能跟「假設 fetch 對任何字串都不會拋錯」這個錯誤前提共用。
  try { new URL(u); } catch { upstream.push(u); throw new TypeError(`Failed to parse URL from ${u}`); }
  upstream.push(u);
  if (u.includes('identitytoolkit.googleapis.com')) {
    return new Response(JSON.stringify({ users: [{ localId: identityUid }] }), { status: 200 });
  }
  if (u.includes('api.revenuecat.com')) {
    if (rcThrow) throw new TypeError('network down');
    if (new URL(u).pathname.endsWith('/purchases')) {
      const entry = rcPurchasesByEnv[new URL(u).searchParams.get('environment')]
        || { body: { object: 'list', items: [], next_page: null } };
      if (entry.throws) throw new TypeError('network down (purchases)');
      return new Response(entry.raw !== undefined ? entry.raw : JSON.stringify(entry.body), { status: entry.status || 200 });
    }
    if (rcSeq) {
      const n = upstream.filter(x => x.includes('api.revenuecat.com')).length - 1;
      const { status = 200, body = { items: [] } } = rcSeq[Math.min(n, rcSeq.length - 1)];
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify(rcBody), { status: rcStatus });
  }
  return new Response('{}', { status: 500 });
};

const ENV = (over = {}) => ({
  FIREBASE_WEB_API_KEY: 'k', REVENUECAT_PROJECT_ID: 'proj_x', REVENUECAT_V2_SECRET_KEY: 'sk_x',
  REVENUECAT_SANDBOX_ALLOWED_UIDS: 'uid-under-test', ...over,
});
const req = (sandboxBuild = '') => new Request('https://railisland.tw/api/plus-status', {
  headers: {
    Authorization: 'Bearer ' + 'x'.repeat(900), 'cf-connecting-ip': '203.0.113.9',
    ...(sandboxBuild ? { 'X-Rail-Plus-Sandbox-Build': sandboxBuild } : {}),
  },
});

// 一筆 Subscription 的形狀（依官方 OpenAPI v2 的 Subscription schema：gives_access / environment /
// entitlements.items[].lookup_key 都是那份規格裡真的存在的欄位）。環境字面值刻意在這裡寫死
// 'production'／'sandbox'，不吃 worker.js 匯出的常數——判準與實作共用同一個常數時，常數被改壞
// 兩邊會一起改壞而全綠（心得 29：判準的真值來源不得與實作同源）。
const sub = (over = {}) => ({
  id: 'sub_1', customer_id: 'uid-under-test', gives_access: true, status: 'active',
  environment: 'production', store: 'app_store',
  entitlements: { items: [{ id: 'entl_1', lookup_key: 'plus', display_name: 'Plus', state: 'active' }] },
  ...over,
});
// 只有 environment 不同的一對樣本：sandbox 那筆其餘欄位與正向對照逐欄相同，
// 「被擋下來」就只可能是因為環境，不可能是別的欄位順便壞掉。
const SANDBOX_SUB = sub({ environment: 'sandbox' });
const PRODUCTION_SUB = sub();

const run = async ({ body = { items: [] }, status = 200, thrown = false, env = ENV(), request = req() } = {}) => {
  upstream = []; rcBody = body; rcStatus = status; rcThrow = thrown; rcSeq = null;
  const r = await checkPlusEntitlement(request, env);
  return r;
};
// 分頁測試專用(F-1):pages 是 [{status?, body}, ...],依呼叫順序取用,見上方 rcSeq 說明。
const runPages = async (pages, env = ENV()) => {
  upstream = []; rcThrow = false; rcSeq = pages;
  const r = await checkPlusEntitlement(req(), env);
  rcSeq = null;
  return r;
};

// ── 1. 環境判別：sandbox 不算、production 算（成對，逐欄只差 environment） ───────────────
section(SECTIONS[0]);
{
  const pos = await run({ body: { items: [PRODUCTION_SUB] } });
  check(pos.ok === true && pos.uid === 'uid-under-test',
    '正向對照：正式環境、有存取權的訂閱 ⇒ 判定為有資格', JSON.stringify(pos));

  const neg = await run({ body: { items: [SANDBOX_SUB] } });
  check(neg.ok === false && neg.status === 403 && neg.error === 'not_entitled',
    'sandbox 環境的訂閱（其餘欄位與上一條逐欄相同）⇒ 判定為無資格（403 not_entitled）', JSON.stringify(neg));

  const wrongBuild = await run({ body: { items: [SANDBOX_SUB] }, request: req('20') });
  check(wrongBuild.ok === false && wrongBuild.status === 403,
    '未核准的 build 20 即使自帶 Sandbox header 仍無資格', JSON.stringify(wrongBuild));

  const android16 = await run({ body: { items: [SANDBOX_SUB] }, request: req('16') });
  check(android16.ok === true && android16.entitlementEnvironment === 'sandbox',
    'Android build 16＋Firebase UID 命中 Worker allowlist＋真正 Sandbox subscription ⇒ 取得測試資格',
    JSON.stringify(android16));

  const android16NotAllowed = await run({
    body: { items: [SANDBOX_SUB] }, request: req('16'), env: ENV({ REVENUECAT_SANDBOX_ALLOWED_UIDS: 'somebody-else' })
  });
  check(android16NotAllowed.ok === false && android16NotAllowed.status === 403,
    'Android build 16 的 Firebase UID 未命中 Worker allowlist ⇒ 即使有 Sandbox subscription 也不放行',
    JSON.stringify(android16NotAllowed));

  const testflight = await run({ body: { items: [SANDBOX_SUB] }, request: req('21') });
  const testflightRc = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(testflight.ok === true && testflight.entitlementEnvironment === 'sandbox'
      && testflightRc.length === 2
      && /environment=production/.test(testflightRc[0]) && /environment=sandbox/.test(testflightRc[1]),
    'build 21＋Firebase 身分＋真正 Sandbox subscription ⇒ 先查正式、再回退 Sandbox 並取得測試資格',
    JSON.stringify({ testflight, rc: testflightRc }));

  const testflight22 = await run({ body: { items: [SANDBOX_SUB] }, request: req('22') });
  const testflight22Rc = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(testflight22.ok === true && testflight22.entitlementEnvironment === 'sandbox'
      && testflight22Rc.length === 2
      && /environment=production/.test(testflight22Rc[0]) && /environment=sandbox/.test(testflight22Rc[1]),
    'build 22＋Firebase 身分＋真正 Sandbox subscription ⇒ 同樣取得測試資格',
    JSON.stringify({ testflight22, rc: testflight22Rc }));

  // 「拿不到環境資訊」不准當成正式——這是 Task 4 簡報明文的紅線。
  const noEnvSub = sub(); delete noEnvSub.environment;
  const noEnv = await run({ body: { items: [noEnvSub] } });
  check(noEnv.ok === false && noEnv.status === 403,
    'environment 欄位不存在 ⇒ 判定為無資格（不准「拿不到環境資訊就當成正式」）', JSON.stringify(noEnv));

  // ⚠️ 大小寫陷阱：REST（v1/v2）用小寫 production/sandbox，webhook payload 用大寫 PRODUCTION/SANDBOX。
  // 這條把「有人把 webhook 的常數拿來比對 REST 回應」變成一條會叫的紅燈。
  const upper = await run({ body: { items: [sub({ environment: 'PRODUCTION' })] } });
  check(upper.ok === false && upper.status === 403,
    'environment 是大寫 PRODUCTION（webhook 的寫法）⇒ 不被 REST 路徑接受（兩套大小寫不可混用）', JSON.stringify(upper));
}

// ── 2. 存取權判別：用 gives_access，不是 status ────────────────────────────────────────
section(SECTIONS[1]);
{
  // status 仍是 'active'（看起來很像有資格），只有 gives_access 是 false。判準若退回去看 status，
  // 這條會變綠 ⇒ 它就是「有沒有真的照官方建議判」的那顆牙。
  const noAccess = await run({ body: { items: [sub({ gives_access: false })] } });
  check(noAccess.ok === false && noAccess.status === 403,
    'gives_access=false 但 status 仍是 active ⇒ 判定為無資格（判的是 gives_access 不是 status）', JSON.stringify(noAccess));

  const mixedBad = await run({ body: { items: [SANDBOX_SUB, sub({ gives_access: false })] } });
  check(mixedBad.ok === false && mixedBad.status === 403,
    '混合清單：sandbox 有存取權 ＋ 正式無存取權 ⇒ 判定為無資格（不會被「有一筆有存取權」矇混過去）', JSON.stringify(mixedBad));

  const mixedGood = await run({ body: { items: [SANDBOX_SUB, PRODUCTION_SUB] } });
  check(mixedGood.ok === true,
    '混合清單：sandbox ＋ 正式且有存取權 ⇒ 判定為有資格（不是只要出現 sandbox 就整批否決）', JSON.stringify(mixedGood));

  const empty = await run({ body: { items: [] } });
  check(empty.ok === false && empty.status === 403,
    '沒有任何訂閱 ⇒ 判定為無資格', JSON.stringify(empty));
}

// ── 3. entitlement 比對（lookup_key），以及清單缺席時的退路 ────────────────────────────
section(SECTIONS[2]);
{
  const wrongKey = await run({ body: { items: [sub({ entitlements: { items: [{ lookup_key: 'some_other_tier' }] } })] } });
  check(wrongKey.ok === false && wrongKey.status === 403,
    '正式環境、有存取權，但掛的是別的 entitlement ⇒ 判定為無資格', JSON.stringify(wrongKey));

  const envKey = await run({ body: { items: [sub({ entitlements: { items: [{ lookup_key: 'vip' }] } })] }, env: ENV({ REVENUECAT_ENTITLEMENT: 'vip' }) });
  check(envKey.ok === true,
    '正向對照：把要找的 entitlement 換成 vip，同一筆資料就判定為有資格（證明上一條的 403 是比對結果，不是路徑壞掉）', JSON.stringify(envKey));

  // 記錄在案的退路：上游若哪天不展開巢狀 entitlements（例如改成要 expand 才給），嚴格比對會把
  // 所有付費者一次擋光。軌島 Plus 是單一 entitlement 產品，退回「只看 gives_access」與改造前等價。
  const noEnts = sub(); delete noEnts.entitlements;
  const fallback = await run({ body: { items: [noEnts] } });
  check(fallback.ok === true,
    'entitlements 清單缺席（上游沒展開巢狀物件）⇒ 退回只看 gives_access，不把付費者一次擋光', JSON.stringify(fallback));

  // 🔴複審 I-2：entitlements**明確回空陣列**（這筆訂閱不掛任何 entitlement）與**缺席**是兩件
  // 不同的事——前者的正確答案是 false，舊版程式碼把兩者混為一談（多給資格，是複審抓到的唯一
  // 一處程式行為超出自己註解宣稱範圍的地方）。與上一條 fallback（缺席 ⇒ true）逐欄只差
  // entitlements 這一個欄位，對照才看得出程式碼真的分辨這兩種語意，不是巧合過關。
  const emptyEnts = await run({ body: { items: [sub({ entitlements: { items: [] } })] } });
  check(emptyEnts.ok === false && emptyEnts.status === 403,
    'entitlements 明確回空陣列（不是缺席）⇒ 判定為無資格——與上一條「缺席退回 true」對照，證明程式碼分辨「缺席」與「空陣列」', JSON.stringify(emptyEnts));

  // 🔴 2026-08-04 敵意稽核 I-3：上面兩條只覆蓋「缺席」與「空陣列」兩態，中間還有第三態
  // ——**property 存在但型別不對**。舊版寫成
  //   `sub.entitlements && Array.isArray(sub.entitlements.items) ? ... : null`
  // 把 `{items:'x'}`／`{items:null}`／`{}`／`null` 全部折疊成同一個 null，再被
  // `if (!ents) return true` 放行 ⇒ **多給資格**（沒掛 plus 的訂閱拿到 Plus）。
  // 正確答案不是「當成空陣列」也不是「當成缺席」，而是「這個 200 不符官方 schema」＝可重試的
  // 503，且不得寫資格文件。判準的真值來源是 RevenueCat Developer API v2 的 Subscription 欄位表
  // （entitlements 為必填，且其本身 required:[items, next_page, object, url]），不是實作。
  // 這一族刻意機械窮舉「存在但形狀錯」的各種寫法，不是只挑稽核報告舉的那一個例子。
  const I3_MALFORMED_ENTS = [
    ['entitlements 是 null', null],
    ['entitlements 是空物件（連 items 都沒有）', {}],
    ['entitlements 是陣列', []],
    ['entitlements.items 是字串', { items: 'not-an-array' }],
    ['entitlements.items 是 null', { items: null }],
    ['entitlements.items 是物件', { items: {} }],
    ['entitlements.items 內含非物件成員', { items: ['plus'] }],
  ];
  for (const [label, ents] of I3_MALFORMED_ENTS) {
    const r = await run({ body: { items: [sub({ entitlements: ents })] } });
    check(r.ok === false && r.status === 503 && r.error === 'entitlement_unavailable',
      `${label} ⇒ 整次 200 判為 malformed 回 503（不得折疊成「缺席 fallback」而多給資格，也不得折疊成「空陣列」）`,
      JSON.stringify(r));
  }

  // I-3 有兩層防線，上面那批只驗得到**第一層**（rcSubscriptionsPageError 把整次 200 判 malformed）。
  // 第二層是 subscriptionMatchesPlus() 自己在型別錯時回 false 而不是 true——它在正常管線上到不了
  // （第一層先擋掉），所以端到端測試對它是全盲的：把第二層改回舊的折疊寫法，上面那批照樣全綠。
  // 這裡直接對它下判準，讓兩層各自有牙（否則「補的那條也沒牙」）。
  const matchesFalse = I3_MALFORMED_ENTS
    .filter(([, ents]) => subscriptionMatchesPlus(sub({ entitlements: ents }), 'plus') !== false)
    .map(([label]) => label);
  check(matchesFalse.length === 0,
    '第二層：subscriptionMatchesPlus() 對每一種「entitlements 存在但形狀錯」都回 false（型別混淆絕不可以擴大「缺席 fallback」的範圍）',
    JSON.stringify({ 竟然沒被判false的: matchesFalse }));
  // 正向對照：第二層不是「一律回 false」——三種合法輸入的答案必須各自正確。
  const absentEnts = sub(); delete absentEnts.entitlements;
  check(subscriptionMatchesPlus(absentEnts, 'plus') === true
      && subscriptionMatchesPlus(sub(), 'plus') === true
      && subscriptionMatchesPlus(sub({ entitlements: { items: [] } }), 'plus') === false
      && subscriptionMatchesPlus(sub({ entitlements: { items: [{ lookup_key: 'other' }] } }), 'plus') === false,
    '正向對照：第二層對三種合法輸入各自答對（缺席⇒true、掛 plus⇒true、空陣列與別的 key⇒false），不是靠「一律回 false」矇過上一條',
    JSON.stringify({
      缺席: subscriptionMatchesPlus(absentEnts, 'plus'),
      掛plus: subscriptionMatchesPlus(sub(), 'plus'),
      空陣列: subscriptionMatchesPlus(sub({ entitlements: { items: [] } }), 'plus'),
    }));
}

// ── 4. 打的是哪一支端點（沉默不是證據：直接數上游網址） ──────────────────────────────
section(SECTIONS[3]);
{
  await run({ body: { items: [PRODUCTION_SUB] } });
  const rcCalls = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(rcCalls.length === 1 && rcCalls[0].includes('/subscriptions'),
    'RevenueCat 打的是 /subscriptions 端點', rcCalls.join(' , ') || '（一發都沒打）');
  check(rcCalls.every(u => !u.includes('active_entitlements')),
    '完全不再打 /active_entitlements（那支端點在協定層面就分辨不出環境）', rcCalls.join(' , '));
  check(rcCalls.length === 1 && /[?&]environment=production(&|$)/.test(rcCalls[0]),
    'query string 帶 ?environment=production 讓上游先濾一次（本地那道是第二層防線）', rcCalls.join(' , '));
  check(rcCalls.length === 1 && /[?&]limit=100(&|$)/.test(rcCalls[0]),
    '🔴複審 I-1(b)：query string 帶 ?limit=100（規格允許的上限，一次拿最多，減少分頁來回次數）', rcCalls.join(' , '));
  check(upstream.some(u => u.includes('identitytoolkit.googleapis.com')),
    '正向對照：上游計數器真的收得到（Firebase 驗證那一發有被記到）', `本輪共 ${upstream.length} 發`);
}

// ── 5. 「查不出來」與「確定沒有」要分開（既有契約，改端點後不得跑掉） ────────────────
section(SECTIONS[4]);
{
  const r404 = await run({ status: 404, body: {} });
  check(r404.ok === false && r404.status === 403 && r404.error === 'not_entitled',
    '上游 404（此 uid 從未在 RevenueCat 出現）⇒ 403 not_entitled', JSON.stringify(r404));

  // 🔴複審 I-1(c)：404 的 resource_missing 同時涵蓋「這個 uid 從未在 RevenueCat 出現（沒買過）」
  // 與「project_id/customer_id 這個 ID 本身不存在」——REVENUECAT_PROJECT_ID 設錯時，每一個
  // 使用者都會打出這個 404，不能把設定錯誤偽裝成「這個人沒買」。盡力用 Error schema 共用的
  // param 欄位分辨：上游明確指出出錯的參數是 project_id 才視為設定錯誤。
  const r404Project = await run({ status: 404, body: { object: 'error', type: 'resource_missing', message: 'Resource not found', param: 'project_id' } });
  check(r404Project.ok === false && r404Project.status === 503 && r404Project.error === 'entitlement_unavailable',
    '上游 404 且 param 指出是 project_id ⇒ 503（設定錯誤，不得偽裝成「這個人沒買」）', JSON.stringify(r404Project));

  const r404Customer = await run({ status: 404, body: { object: 'error', type: 'resource_missing', message: 'Resource not found', param: 'customer_id' } });
  check(r404Customer.ok === false && r404Customer.status === 403 && r404Customer.error === 'not_entitled',
    '正向對照：上游 404 且 param 是 customer_id（這個人真的沒買過）⇒ 維持 403 not_entitled，不是任何 404 都變 503', JSON.stringify(r404Customer));

  const r500 = await run({ status: 500, body: {} });
  check(r500.ok === false && r500.status === 503 && r500.error === 'entitlement_unavailable',
    '上游 500 ⇒ 503 entitlement_unavailable（不當有資格，也不永久拒絕）', JSON.stringify(r500));

  const rThrow = await run({ thrown: true });
  check(rThrow.ok === false && rThrow.status === 503,
    '上游連線拋例外 ⇒ 503（可重試）', JSON.stringify(rThrow));

  upstream = []; rcBody = { items: [PRODUCTION_SUB] }; rcStatus = 200; rcThrow = false;
  const noSecret = await checkPlusEntitlement(req(), ENV({ REVENUECAT_V2_SECRET_KEY: '' }));
  check(noSecret.ok === false && noSecret.status === 503 && upstream.length === 0,
    'secret 未設定 ⇒ 503 且一發上游都沒打（fail-closed，不放行任何人）',
    `${JSON.stringify(noSecret)} 上游 ${upstream.length} 發`);
}

// ── 6. 端到端：/api/plus-status 對 sandbox-only 客戶回 active:false ──────────────────
section(SECTIONS[5]);
{
  const read = async (body, request = req()) => {
    upstream = []; rcBody = body; rcStatus = 200; rcThrow = false;
    const res = await plusStatus(request, ENV());
    return { status: res.status, json: await res.json() };
  };
  const sandboxOnly = await read({ items: [SANDBOX_SUB] });
  check(sandboxOnly.status === 200 && sandboxOnly.json.active === false,
    'sandbox-only 客戶 ⇒ 200 {active:false}（查得到、答案是沒有；不是 503）', JSON.stringify(sandboxOnly));
  const production = await read({ items: [PRODUCTION_SUB] });
  check(production.status === 200 && production.json.active === true,
    '正向對照：正式訂閱客戶 ⇒ 200 {active:true}（證明上一條的 false 不是整條路徑壞掉）', JSON.stringify(production));
  // ── 批二-B：回應是兩個獨立真相，schema 與語意都要守住 ──────────────────────────────
  // 本段的 ENV() 沒有 FIRESTORE_PROJECT_ID／service account ⇒ writePlusEntitlement 必定拋錯、
  // 資格文件一定沒落地。這正是最危險的組合：RevenueCat 說有資格（active:true），但 rules 讀的
  // 那份文件根本不存在。此時若把 cloudSyncReady 也回成 true，客戶端會拿註定被擋的交易去撞牆，
  // 而且永遠不會再握手一次。欄位名與期望值都是本檔字面宣告，不從 worker.js 讀。
  const testflight = await read({ items: [SANDBOX_SUB] }, req('21'));
  check(testflight.status === 200 && testflight.json.active === true && testflight.json.environment === 'sandbox',
    'build 21 的 /api/plus-status 對 Sandbox 購買回 active:true＋environment:sandbox', JSON.stringify(testflight));
  const testflight22 = await read({ items: [SANDBOX_SUB] }, req('22'));
  check(testflight22.status === 200 && testflight22.json.active === true && testflight22.json.environment === 'sandbox',
    'build 22 的 /api/plus-status 對 Sandbox 購買回 active:true＋environment:sandbox', JSON.stringify(testflight22));
  check(Object.keys(production.json).sort().join(',') === 'active,cloudSyncReady,environment',
    '批二-B：/api/plus-status 的回應恰好是 {active, cloudSyncReady, environment} 三個欄位（多一個少一個都要在這裡紅）',
    JSON.stringify(production.json));
  check(production.json.cloudSyncReady === false,
    '批二-B：Firestore 設定缺席（寫入必定失敗）時 cloudSyncReady 必須是 false——不可以因為 RevenueCat 說有資格就宣稱雲端已放行',
    JSON.stringify(production.json));
  check(sandboxOnly.json.cloudSyncReady === false,
    '批二-B：無資格客戶的 cloudSyncReady 同樣是 false（active:false 的資格文件照樣被 rules 擋）',
    JSON.stringify(sandboxOnly.json));
}

// ── 7. 發版閘門：發行包不得允許 sandbox 資格 ─────────────────────────────────────────
section(SECTIONS[6]);
{
  const threw = (html) => { try { assertPlusSandboxOff(html); return null; } catch (e) { return e.message; } };
  const ok = threw('<script>window.RAIL_MUSIC_AVAILABLE=true;window.RAIL_PLUS_SANDBOX_OK=false;window.RAIL_PLUS_SANDBOX_BUILD=null</script>');
  check(ok === null, '注入 window.RAIL_PLUS_SANDBOX_OK=false 的發行包 ⇒ 通過', String(ok));

  const onMsg = threw('<script>window.RAIL_MUSIC_AVAILABLE=true;window.RAIL_PLUS_SANDBOX_OK=true</script>');
  check(typeof onMsg === 'string' && /RAIL_PLUS_SANDBOX_OK=true/.test(onMsg),
    '注入 window.RAIL_PLUS_SANDBOX_OK=true 的發行包 ⇒ 擋下（sandbox 購買會解鎖正式付費功能）', String(onMsg));

  // 判準刻意是「必須明確寫著 false」而不是「不得出現 true」：注入整段被拿掉時，後者會沉默放行。
  const missMsg = threw('<script>window.RAIL_MUSIC_AVAILABLE=true</script>');
  check(typeof missMsg === 'string' && /RAIL_PLUS_SANDBOX_OK/.test(missMsg),
    '注入整段不見了 ⇒ 也要擋下（沉默不是證據：閘門驗的是「明確是 false」不是「剛好沒有 true」）', String(missMsg));

  let testBuildMsg = null;
  try {
    assertPlusSandboxTestBuild('<script>window.RAIL_PLUS_SANDBOX_OK=true;window.RAIL_PLUS_SANDBOX_BUILD="22"</script>', '22');
  } catch (e) { testBuildMsg = e.message; }
  check(testBuildMsg === null,
    'TestFlight 閘門只接受明確的 SANDBOX_OK=true＋逐字 build 22', String(testBuildMsg));

  // 上面三條驗的是「這支函式有牙」，驗不到「它有沒有被接上發版流程」——直接 import 呼叫的測試
  // 對「verifyRelease 裡那一行被刪掉」是全盲的。這一條補上接線證據：驗 verifyRelease 的函式本體
  // （不是整個檔案）裡真的有呼叫它。這是原始碼字串比對、比行為證據弱，故只當接線檢查用。
  const releaseSrc = readFileSync(RELEASE, 'utf8');
  const verifyReleaseBody = releaseSrc.slice(releaseSrc.indexOf('export async function verifyRelease'));
  check(verifyReleaseBody.length > 0 && /assertPlusSandboxTestBuild\(html, expectPlusSandboxBuild\)/.test(verifyReleaseBody)
      && /assertPlusSandboxOff\(html\)/.test(verifyReleaseBody),
    'verifyRelease() 本體同時接上正式關閉閘門與 TestFlight build 閘門');

  // 閘門的對象要真的是 build 產物在用的那個變數名——prepare-web.mjs 若改了名字，
  // 上面三條照樣全綠而閘門看守的是一個不存在的東西。
  const prepareSrc = readFileSync(PREPARE, 'utf8');
  check(/window\.RAIL_PLUS_SANDBOX_OK=\$\{plusSandboxOk\}/.test(prepareSrc)
    && /process\.env\.RAIL_PLUS_SANDBOX_OK\s*===\s*'1'/.test(prepareSrc),
    'prepare-web.mjs 真的在注入同一個變數名，且值來自建置期環境變數（不是頁面上可改的東西）');

  const indexSrc = readFileSync(INDEX, 'utf8');
  const androidDisabled = '<script>window.RAIL_ANDROID_PLUS_ENABLED=false;window.RAIL_ANDROID_PLUS_SANDBOX_POLICY=null;window.RAIL_ANDROID_PLUS_SANDBOX_BUILD=null</script>' + indexSrc;
  let androidDisabledMsg = null;
  try { assertAndroidPlusReleaseConfig(androidDisabled, '16'); } catch (e) { androidDisabledMsg = e.message; }
  check(androidDisabledMsg === null,
    'Android Plus 明確關閉＋policy/build 都是 null ⇒ 發版設定閘門放行免費版本', String(androidDisabledMsg));

  const androidEnabled = '<script>window.RAIL_METRO_CORE_ENABLED=true;window.RAIL_ANDROID_PLUS_ENABLED=true;window.RAIL_ANDROID_PLUS_SANDBOX_POLICY="revenuecat-allowlist";window.RAIL_ANDROID_PLUS_SANDBOX_BUILD="16";window.RAIL_REVENUECAT_CONFIG={androidApiKey:"goog_PUBLIC123"}</script>' + indexSrc;
  let androidEnabledMsg = null;
  try { assertAndroidPlusReleaseConfig(androidEnabled, '16'); } catch (e) { androidEnabledMsg = e.message; }
  check(androidEnabledMsg === null,
    'Android Plus 開啟＋goog_ public key＋allowlist policy＋build 16 ⇒ 發版設定閘門放行', String(androidEnabledMsg));

  const androidMissingKey = androidEnabled.replace(';window.RAIL_REVENUECAT_CONFIG={androidApiKey:"goog_PUBLIC123"}', '');
  let androidMissingKeyMsg = null;
  try { assertAndroidPlusReleaseConfig(androidMissingKey, '16'); } catch (e) { androidMissingKeyMsg = e.message; }
  check(typeof androidMissingKeyMsg === 'string' && /public SDK key/.test(androidMissingKeyMsg),
    'Android Plus 開啟但缺 goog_ public key ⇒ 擋下', String(androidMissingKeyMsg));

  const androidMetroCoreOff = androidEnabled.replace('window.RAIL_METRO_CORE_ENABLED=true', 'window.RAIL_METRO_CORE_ENABLED=false');
  let androidMetroCoreOffMsg = null;
  try { assertAndroidPlusReleaseConfig(androidMetroCoreOff, '16'); } catch (e) { androidMetroCoreOffMsg = e.message; }
  check(typeof androidMetroCoreOffMsg === 'string' && /Metro Core/.test(androidMetroCoreOffMsg),
    'Android Plus 開啟但 Metro Core 關閉 ⇒ 擋下', String(androidMetroCoreOffMsg));

  let androidWrongBuildMsg = null;
  try { assertAndroidPlusReleaseConfig(androidEnabled, '17'); } catch (e) { androidWrongBuildMsg = e.message; }
  check(typeof androidWrongBuildMsg === 'string' && /versionCode=17/.test(androidWrongBuildMsg),
    'Android Sandbox build 與 versionCode 不一致 ⇒ 擋下', String(androidWrongBuildMsg));
}

// ── 8. 分頁：limit 上限、跟 next_page 直到找到或翻完、翻頁上限的安全方向（F-1）；
//    以及 next_page 解析的安全性（🔴複審修復輪 2 G-1+G-2、修復輪 3 H-1）──────────────────
// 🔴複審 I-1(b)：/subscriptions 的 limit 預設只有 20，且這支端點沒有 sort、規格也沒有任何
// 「較新排前面」的排序保證——第一頁不能假設含有使用者現在生效的那筆訂閱。以下都要驗：
// (a) 有效訂閱在第 2 頁時仍判定為有資格；(b) 翻頁上限用完時走安全方向（不得靜默當成有資格）；
// (c) next_page 為 null 時正常結束；(d) next_page 指向外部 host 時，origin 比對不符必須被
// 拒絕、停止翻頁並留下診斷紀錄（H-1：不是「盡力修正後放行」）；(e) next_page 自己的
// origin 合法、但 pathname 以 // 開頭的 protocol-relative 繞法——修復輪 2 的兩段式解析
// （先 new URL(x,base) 把相對路徑當絕對URL，再取 pathname+search 重新套用 origin）會把
// 這種 pathname 誤判成 protocol-relative URL、host 被換掉；正確修法只解析一次、直接比對
// origin，這個繞法的 origin 本來就真的是 api.revenuecat.com，所以會被放行（不是漏網），
// 但判準不能用「字串裡有沒有出現 evil.example.com」這種天真寫法——繞法字串本身的路徑就
// 含這個子字串，必須解析出精確 host 才能分辨路徑裡的雜訊與真正的連線目標。
//
// (a)(b) 的 next_page fixture 刻意寫成官方規格 example 的**相對路徑**形式——ListSubscriptions.
// next_page 的 example 逐字是 `/v2/projects/.../subscriptions?starting_after=...`，整份規格裡
// next_page 沒有一個 example 是絕對 URL（散文寫「URL」是詮釋，example 才是規格錨定的東西）。
// 上一輪的 fixture 誤寫成絕對 URL，於是判準與 worker.js「next_page 就是完整 URL」的錯誤假設
// 共用同一個前提——正式環境會在第 2 頁對相對路徑字串拋 TypeError 的分頁邏輯，測試永遠是綠的。
// 替身的 fetch()（見上方）現在會對非絕對 URL 忠實拋錯，加上這裡改回相對路徑，才讓這個迴歸
// 有機會真的觸發。
const isRcUrl = (u) => { try { return new URL(u).host === 'api.revenuecat.com'; } catch { return false; } };
section(SECTIONS[7]);
{
  // (a) 第 1 頁只有 sandbox（無資格），第 2 頁才是正式有效訂閱 ⇒ 必須真的翻頁才找得到。
  const p2 = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: '/v2/projects/proj_x/customers/uid-under-test/subscriptions?environment=production&limit=100&starting_after=sub_1' } },
    { body: { items: [PRODUCTION_SUB], next_page: null } },
  ]);
  const rcCallsP2 = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(p2.ok === true && rcCallsP2.length === 2 && rcCallsP2.every(isRcUrl),
    '(a) 有效訂閱在第 2 頁（第 1 頁只有 sandbox，next_page 是規格 example 的相對路徑）⇒ 仍判定為有資格，且真的翻了 2 頁上游、每一發都是絕對 URL 且 host 為 api.revenuecat.com（不是把相對路徑原封不動送進 fetch）',
    JSON.stringify({ p2, 上游呼叫次數: rcCallsP2.length, 上游網址: rcCallsP2 }));

  // (c) 單頁、next_page 明確是 null（不是缺席）⇒ 正常結束，只打 1 次上游。
  const singlePage = await runPages([{ body: { items: [SANDBOX_SUB], next_page: null } }]);
  const rcCallsSingle = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(singlePage.ok === false && singlePage.status === 403 && rcCallsSingle.length === 1,
    '(c) next_page 明確是 null ⇒ 判定翻頁到底、正常結束於無資格，只打 1 次上游（不會誤以為還有下一頁）',
    JSON.stringify({ singlePage, 上游呼叫次數: rcCallsSingle.length }));

  // (b) 翻頁上限用完時走安全方向。MAX_PAGES_EXPECTED 必須與 worker.js 的 RC_SUBS_MAX_PAGES
  // 保持一致——這裡刻意寫死而不 import，是有意的契約測試（這個上限值本身就是要驗的東西，
  // 不是像 'production' 那種語意常數；之後若調整 worker.js 那個值，這裡要一起改）。
  // 前 MAX_PAGES_EXPECTED 頁都只有 sandbox（無正式資格），「獎品」（正式有效訂閱）刻意放在
  // 第 MAX_PAGES_EXPECTED+1 頁——翻頁上限正確運作時永遠翻不到那裡；上限被拿掉或改鬆，
  // 就會翻到那頁找到獎品、誤判為有資格。
  const MAX_PAGES_EXPECTED = 5;
  const beyondCapPages = Array.from({ length: MAX_PAGES_EXPECTED }, (_, i) => ({
    body: { items: [SANDBOX_SUB], next_page: `/v2/projects/proj_x/customers/uid-under-test/subscriptions?environment=production&limit=100&starting_after=p${i}` },
  })).concat([{ body: { items: [PRODUCTION_SUB], next_page: null } }]);
  const capped = await runPages(beyondCapPages);
  const rcCallsCapped = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(capped.ok === false && capped.status === 403 && rcCallsCapped.length === MAX_PAGES_EXPECTED && rcCallsCapped.every(isRcUrl),
    `(b) 翻頁上限用完仍未找到 ⇒ 安全方向是視同無資格（不得因為我們自己停止翻頁就靜默當成有資格）；剛好翻了 ${MAX_PAGES_EXPECTED} 頁就停手（皆為絕對 URL 且 host 正確），沒有翻到藏著正式資格的第 ${MAX_PAGES_EXPECTED + 1} 頁`,
    JSON.stringify({ capped, 上游呼叫次數: rcCallsCapped.length }));

  // (d) H-1（Critical，安全）：next_page 指向外部／惡意 host 時，正確修法不是「盡力修正後
  // 放行」（修復輪 2 的天真兩段式解析），而是解析一次、直接比對 origin，不符就拒絕（回傳
  // null）、停止翻頁、落到既有的 403 not_entitled 安全方向，並且用 console.error 留下
  // 診斷紀錄（收掉修復輪 2 疑慮 3：「G-2 目前是靜默導正，若上游曾回過非自身 origin 的
  // next_page 看不到」）。console.error 用範圍侷限的替身攔截，跑完立刻還原，不影響其他
  // 段落原本讓 console.error 直接印出的行為。
  let consoleErrorLog = [];
  const realConsoleError = console.error;
  console.error = (...args) => { consoleErrorLog.push(args.join(' ')); };

  const evilNextPage = 'https://evil.example.com/v2/projects/proj_x/customers/uid-under-test/subscriptions?starting_after=sub_1';
  const g2 = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: evilNextPage } },
    { body: { items: [PRODUCTION_SUB], next_page: null } },
  ]);
  check(g2.ok === false && g2.status === 403 && g2.error === 'not_entitled' && !upstream.some(u => u.includes('evil.example.com')),
    '(d) next_page 指向外部 host（evil.example.com）⇒ origin 比對不符，拒絕跟隨、停止翻頁，落到 403 not_entitled 安全方向（不再是「修正後放行」），惡意 host 從未出現在任何一發上游呼叫裡',
    JSON.stringify({ g2, 上游網址: upstream }));
  check(consoleErrorLog.length === 1,
    '(d) 上述拒絕留下 1 筆 console.error 診斷紀錄（可被 Observability 追蹤，不是靜默處理）',
    JSON.stringify({ consoleErrorLog }));

  // 正向對照：正常相對路徑翻頁 ⇒ 不觸發拒絕、不寫入 console.error（上面那條不是每輪都印，
  // 只有真的判定拒絕才印，不是巧合冒出來的雜訊）。
  consoleErrorLog = [];
  const p2Ctrl = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: '/v2/projects/proj_x/customers/uid-under-test/subscriptions?environment=production&limit=100&starting_after=sub_1' } },
    { body: { items: [PRODUCTION_SUB], next_page: null } },
  ]);
  check(p2Ctrl.ok === true && consoleErrorLog.length === 0,
    '正向對照：next_page 是正常相對路徑 ⇒ 不觸發拒絕、不寫入 console.error',
    JSON.stringify({ p2Ctrl, consoleErrorLog }));

  // (e) H-1（Critical，安全）：protocol-relative 繞法——next_page 自己的 origin 完全合法
  // （api.revenuecat.com），但 pathname 以 // 開頭。修復輪 2 的兩段式解析會把第二次
  // new URL() 的輸入（pathname+search）誤判成 protocol-relative URL，host 被換成 //
  // 後面那段（evil.example.com）。
  // 🔴 2026-08-04 敵意稽核 I-5 之後，這條輸入的**期望答案改變了**：resolveRcNextPage() 現在
  // 除了 origin 還要求 pathname 逐字等於「同一個 customer 的 subscriptions 端點」，而
  // `//evil.example.com/steal` 不是 ⇒ 從「放行、翻到第 2 頁」變成「拒絕跟隨、停在 403」。
  // 判準跟著實作改是危險動作，所以這裡刻意保留這條輸入原本真正要守的那件事——**不論放行或
  // 拒絕，任何一發實際送出去的連線，其解析後的 host 都必須是 api.revenuecat.com**——而且
  // 仍然不用「字串裡有沒有出現 evil.example.com」這種天真寫法（繞法字串本身的路徑就含這個
  // 子字串，天真的 includes 連正確版本都會誤判成紅）。
  // 「兩段式字串手術會不會被抓到」這件事改由下面 (f) 那族不變式守——它比這條端到端情境更準。
  consoleErrorLog = [];
  const bypassNextPage = 'https://api.revenuecat.com//evil.example.com/steal';
  const eResult = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: bypassNextPage } },
    { body: { items: [PRODUCTION_SUB], next_page: null } },
  ]);
  const rcCallsE = upstream.filter(u => u.includes('api.revenuecat.com'));
  const hostsE = upstream.map(u => { try { return new URL(u).host; } catch { return '(unparseable)'; } });
  check(eResult.ok === false && eResult.status === 403 && rcCallsE.length === 1
      && !hostsE.includes('evil.example.com') && consoleErrorLog.length === 1,
    '(e) protocol-relative 繞法（origin 合法、pathname 以 // 開頭）⇒ pathname 不是 canonical endpoint，拒絕跟隨、停在 403，只打了第 1 頁；所有實際送出的連線解析後的 host 沒有一個是 evil.example.com，且留下 1 筆診斷紀錄',
    JSON.stringify({ eResult, 上游網址: upstream, 解析host: hostsE, consoleErrorLog }));

  // (f) 🔴 2026-08-04 敵意稽核 I-5：直接對 resolveRcNextPage() 斷言一條**不變式**，用一族
  // 機械窮舉的對抗性輸入打它，而不是只覆蓋稽核報告舉的那一個例子。
  // 不變式（兩個外部錨點，都不是從實作回推的）：對任何輸入，回傳值要嘛是 null（拒絕），
  // 要嘛是一個 ① origin 逐字等於 RevenueCat 的 API origin、且 ② pathname 逐字等於「這次查詢
  // 自己的 customer subscriptions 端點」的 URL。任何「回了一個 origin 或 pathname 不對的 URL」
  // 都是漏洞，不論是哪種寫法造成的。
  // 這一族刻意讓每個保護各自有一個**只有它擋得住**的成員：
  //   · 拿掉 origin 檢查 → ① 會回一個 evil origin 的 URL（它的 pathname 完全 canonical）
  //   · 拿掉 pathname 檢查 → ②③⑦⑧ 會回別的 customer／別的 project／別的端點（origin 完全合法）
  //   · 換回修復輪 2 的兩段式字串手術 → ④ 的第二段解析把 host 換成 evil，而 pathname 剛好被
  //     手術成 canonical ⇒ origin 與 pathname 兩個檢查都「看起來」通過，只有這條不變式抓得到
  const RC_API_ORIGIN = 'https://api.revenuecat.com';                    // 外部常數（RevenueCat 的 API origin）
  const CANONICAL_PATH = '/v2/projects/proj_x/customers/uid-under-test/subscriptions';
  const ADVERSARIAL_NEXT_PAGES = [
    ['① canonical pathname，但換成外部 origin', `https://evil.example.com${CANONICAL_PATH}?starting_after=s1`, 'reject'],
    ['② origin 合法，但換成別人的 customer', `${RC_API_ORIGIN}/v2/projects/proj_x/customers/uid-other/subscriptions?starting_after=s1`, 'reject'],
    ['③ origin 合法，但換成別的端點', `${RC_API_ORIGIN}/v2/projects/proj_x/customers/uid-under-test/purchases?starting_after=s1`, 'reject'],
    ['④ protocol-relative 前綴 ＋ canonical 尾巴（兩段式字串手術會被鑽的形狀）', `${RC_API_ORIGIN}//evil.example.com${CANONICAL_PATH}`, 'reject'],
    ['⑤ 純相對、canonical（規格 example 的形狀，唯一常見的正常值）', `${CANONICAL_PATH}?environment=production&limit=100&starting_after=s1`, 'follow'],
    ['⑥ 絕對、canonical', `${RC_API_ORIGIN}${CANONICAL_PATH}?starting_after=s1`, 'follow'],
    ['⑦ origin 合法，但換成別的 project', `${RC_API_ORIGIN}/v2/projects/proj_other/customers/uid-under-test/subscriptions`, 'reject'],
    ['⑧ 用 ../ 正規化後溜到別人的 customer', `${RC_API_ORIGIN}${CANONICAL_PATH}/../../uid-other/subscriptions`, 'reject'],
  ];
  const invariantViolations = [];
  const followed = [];
  for (const [label, input] of ADVERSARIAL_NEXT_PAGES) {
    let out;
    try { out = resolveRcNextPage(input, CANONICAL_PATH); }
    catch (e) { out = null; }                                            // 解析不出來＝拒絕，也滿足不變式
    if (out === null) continue;
    followed.push(label);
    const parsed = new URL(out);
    if (parsed.origin !== RC_API_ORIGIN || parsed.pathname !== CANONICAL_PATH) {
      invariantViolations.push(`${label} ⇒ ${parsed.origin}${parsed.pathname}`);
    }
  }
  check(invariantViolations.length === 0,
    '(f) resolveRcNextPage() 對整族對抗性 next_page 都守住不變式：不是回 null，就是回一個 origin 與 pathname 都逐字正確的 URL（沒有任何一個輸入能讓它交出別的 host／別的 customer／別的端點）',
    JSON.stringify({ 違反: invariantViolations, 被放行的: followed }));
  // 正向對照：不變式若靠「永遠回 null」滿足就是零資訊。這條要求該放行的真的被放行。
  const shouldFollow = ADVERSARIAL_NEXT_PAGES.filter(([, , want]) => want === 'follow').map(([label]) => label);
  const shouldReject = ADVERSARIAL_NEXT_PAGES.filter(([, , want]) => want === 'reject').map(([label]) => label);
  check(shouldFollow.every(label => followed.includes(label)) && !shouldReject.some(label => followed.includes(label)),
    '(f) 正向對照：同一支收集器裡，canonical 的兩個輸入真的被放行（不是靠「永遠回 null」矇過不變式），其餘全部被拒絕',
    JSON.stringify({ 應放行: shouldFollow, 應拒絕: shouldReject, 實際放行: followed }));

  console.error = realConsoleError;
}

// ── 9. 回應 schema 守門：髒 200 不得被讀成「確定沒訂閱」或「已翻到底」（I-4）───────────────
// 🔴 2026-08-04 敵意稽核 I-4：舊版 plusAccessSubscriptions() 對非陣列 items 直接退回空陣列，
// fetchRevenueCatSubscriptions() 對非字串的 next_page 直接視為自然結尾——兩者都把「上游回了
// 不符 schema 的髒 200」與一個明確的業務答案合併了，而那個答案還會被寫成 active:false 的資格
// 文件（付費者被靜默關掉）或用不完整頁集算出偏短的 activeUntilMs。
// 判準的真值來源是 RevenueCat Developer API v2 的 ListSubscriptions 欄位表逐字所寫的
// `items required Array of objects`、`next_page required string or null`，不是實作。
section(SECTIONS[8]);
{
  const I4_MALFORMED_BODIES = [
    ['items 是 null', { object: 'list', items: null, next_page: null }],
    ['items 是物件', { object: 'list', items: {}, next_page: null }],
    ['items 是字串', { object: 'list', items: 'nope', next_page: null }],
    ['items 缺席', { object: 'list', next_page: null }],
    ['整個 body 是陣列', []],
    ['整個 body 是字串', 'not-a-list'],
    ['整個 body 是 null', null],
    ['next_page 是物件', { object: 'list', items: [], next_page: { cursor: 'later' } }],
    ['next_page 是數字', { object: 'list', items: [], next_page: 42 }],
    ['next_page 是空字串', { object: 'list', items: [], next_page: '' }],
    ['next_page 是陣列', { object: 'list', items: [], next_page: ['/v2/x'] }],
  ];
  const realConsoleError = console.error;
  const gateLogs = [];
  console.error = (...args) => { gateLogs.push(args.join(' ')); };
  try {
    for (const [label, body] of I4_MALFORMED_BODIES) {
      gateLogs.length = 0;
      const r = await run({ body });
      // 兩個維度：答案是 503，**而且**是被 schema 守門明確擋下的（留下可診斷的紀錄），
      // 不是靠某個下游函式碰巧拋錯被外層 catch 吞成 503。少了第二個維度，把守門整段刪掉
      // 這條照樣全綠——那正是「判準落在受測物下游」的典型盲點。
      check(r.ok === false && r.status === 503 && r.error === 'entitlement_unavailable'
          && gateLogs.some(line => line.includes('不符官方 schema')),
        `${label} ⇒ 503，且由 schema 守門明確擋下並留下診斷紀錄（髒 200 不得被讀成「確定沒訂閱」或「已翻到底」）`,
        JSON.stringify({ r, gateLogs }));
    }
  } finally { console.error = realConsoleError; }

  // 第二層（與守門獨立）：純篩選 helper 自己也不准把 malformed 折疊成空集合。它在正常管線上
  // 到不了（守門先擋），端到端測試對它全盲——所以直接對 plusEntitlementDocument() 下判準：
  // 拿一個 items 不是陣列的 body 進去，必須拋錯，而不是靜靜產生一份 active:false 的資格文件
  // （那份文件會被寫進 Firestore，把付費者關掉）。
  let threwOnMalformed = false;
  try { plusEntitlementDocument({ object: 'list', items: null, next_page: null }, 'plus', 'plus-status', 1); }
  catch (e) { threwOnMalformed = true; }
  const cleanDoc = plusEntitlementDocument({ object: 'list', items: [], next_page: null }, 'plus', 'plus-status', 1);
  check(threwOnMalformed && cleanDoc.active === false,
    '第二層：純篩選 helper 對 malformed body 直接拋錯（不得產出「看起來成功」的 inactive 文件）；正向對照是合規空清單仍然安靜地產出 active:false',
    JSON.stringify({ threwOnMalformed, cleanDoc }));

  // 正向對照：同一支替身、同一條路徑，合規的空清單仍然要得到「確定沒訂閱」的 403，
  // 合規的非空清單仍然要得到 ok:true。沒有這兩條，上面整批 503 可能只是路徑整條壞掉。
  const cleanEmpty = await run({ body: { object: 'list', items: [], next_page: null } });
  check(cleanEmpty.ok === false && cleanEmpty.status === 403 && cleanEmpty.error === 'not_entitled',
    '正向對照：合規的空清單（items:[]、next_page:null）⇒ 仍然是明確的 403 not_entitled，不是被新守門一起打成 503', JSON.stringify(cleanEmpty));
  const cleanHit = await run({ body: { object: 'list', items: [PRODUCTION_SUB], next_page: null } });
  check(cleanHit.ok === true,
    '正向對照：合規的非空清單 ⇒ 仍然判定為有資格（證明守門沒有把正常回應一起擋掉）', JSON.stringify(cleanHit));

  // 直接對純函式斷言，補上端到端測不到的維度：這支閘門必須說得出「哪裡不合規」，
  // 而不是只回一個 boolean——診斷字串會進 console.error，是線上唯一的線索。
  const err = rcSubscriptionsPageError({ object: 'list', items: [{ customer_id: 'uid-under-test', entitlements: { items: 'x' } }], next_page: null }, 'uid-under-test');
  check(typeof err === 'string' && err.length > 0 && !err.includes('uid-under-test'),
    'rcSubscriptionsPageError() 回的是可診斷的原因字串，而且不夾帶 uid 或訂閱內容（這個字串會被寫進 console.error）', String(err));
  const noErr = rcSubscriptionsPageError({ object: 'list', items: [PRODUCTION_SUB], next_page: null }, 'uid-under-test');
  check(noErr === null, '正向對照：合規回應 ⇒ 守門回 null（不是每次都喊違規）', String(noErr));
}

// ── 10. 分頁途中的 404 與 customer 綁定（I-1／I-5）──────────────────────────────────────
section(SECTIONS[9]);
{
  const nextPageOf = (cursor) => `/v2/projects/proj_x/customers/uid-under-test/subscriptions?environment=production&limit=100&starting_after=${cursor}`;

  // 🔴 I-1：404 只有在**第一頁**才可能是「這個 customer 不存在」。第 1 頁已經證明有有效訂閱、
  // 第 2 頁回 404 時，舊版直接回空集合 ⇒ 付費者被判 403、plus-status 還會覆寫 active:false 的
  // 資格文件。後續頁的 404 語意是「分頁游標失效／上游狀態改變」＝這次查詢失敗，不是「沒買過」。
  const p2NotFound = await runPages([
    { body: { items: [PRODUCTION_SUB], next_page: nextPageOf('sub_1') } },
    { status: 404, body: { object: 'error', type: 'resource_missing', param: 'customer_id' } },
  ]);
  check(p2NotFound.ok === false && p2NotFound.status === 503 && p2NotFound.error === 'entitlement_unavailable',
    '第 1 頁已有正式有效訂閱、第 2 頁回 404 ⇒ 503（分頁失敗），不得清空已累積的命中把付費者判成無資格',
    JSON.stringify(p2NotFound));

  // 同一族的另一半：即使第 1 頁沒有命中，第 2 頁的 404 仍然是分頁失敗，不是「這個人沒買過」
  // ——因為第 1 頁的 200 已經證明了這個 customer 存在。
  const p2NotFoundNoHit = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: nextPageOf('sub_1') } },
    { status: 404, body: { object: 'error', type: 'resource_missing', param: 'customer_id' } },
  ]);
  check(p2NotFoundNoHit.ok === false && p2NotFoundNoHit.status === 503,
    '第 1 頁 200（證明 customer 存在）、第 2 頁回 404 ⇒ 一樣是 503，不因為「還沒命中」就退回成功空集合',
    JSON.stringify(p2NotFoundNoHit));

  // 正向對照：第一頁的 404 仍然是「這個人沒買過」的明確答案（403），沒有被上面兩條一起改掉。
  const firstPage404 = await runPages([{ status: 404, body: { object: 'error', type: 'resource_missing', param: 'customer_id' } }]);
  check(firstPage404.ok === false && firstPage404.status === 403 && firstPage404.error === 'not_entitled',
    '正向對照：**第一頁**的 customer-not-found 404 ⇒ 仍然是 403 not_entitled（只有後續頁才升成 503）',
    JSON.stringify(firstPage404));

  // 正向對照：兩頁都正常時仍然翻得完、找得到（證明上面的 503 是 404 造成的，不是分頁整條壞掉）。
  const twoCleanPages = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: nextPageOf('sub_1') } },
    { body: { items: [PRODUCTION_SUB], next_page: null } },
  ]);
  check(twoCleanPages.ok === true,
    '正向對照：兩頁都是正常 200 ⇒ 照樣翻完並判定為有資格', JSON.stringify(twoCleanPages));

  // 🔴 I-5（第二層）：subscriptionMatchesPlus() 完全沒有碰 customer_id，所以只要一筆別人的
  // 訂閱混進回應（上游異常、代理損壞、或跟到別的 customer 的分頁），它的資格就會被算成
  // 目前這個 uid 的。customer-scoped 端點回別人的訂閱是嚴重異常 ⇒ malformed 503，
  // 刻意不「靜靜濾掉」——濾掉會讓這種回應變成一次成功的空集合去覆寫 active:false 的文件。
  const foreignSub = await run({ body: { object: 'list', items: [sub({ customer_id: 'uid-other' })], next_page: null } });
  check(foreignSub.ok === false && foreignSub.status === 503,
    '回應裡的 subscription customer_id 是別人 ⇒ 503（不得把別人的付款資格嫁接到目前的 uid，也不得靜靜濾掉當成空集合）',
    JSON.stringify(foreignSub));

  const foreignMixed = await run({ body: { object: 'list', items: [PRODUCTION_SUB, sub({ customer_id: 'uid-other' })], next_page: null } });
  check(foreignMixed.ok === false && foreignMixed.status === 503,
    '混合清單：自己的有效訂閱 ＋ 一筆別人的 ⇒ 整次 200 判 malformed 503（不是「有一筆對就算過」）',
    JSON.stringify(foreignMixed));

  // 🔴 I-5（第一層，端到端）：稽核報告的原始重現情境——第 1 頁的 next_page 指向同一個 origin
  // 但**別人的 customer**，第 2 頁擺一筆別人的有效 Plus 訂閱。舊版 ok:true（資格被嫁接）。
  const consoleLog = [];
  const realConsoleError = console.error;
  console.error = (...args) => { consoleLog.push(args.join(' ')); };
  const crossCustomer = await runPages([
    { body: { items: [], next_page: '/v2/projects/proj_x/customers/uid-other/subscriptions?starting_after=sub_1' } },
    { body: { items: [sub({ customer_id: 'uid-other' })], next_page: null } },
  ]);
  const rcCallsCross = upstream.filter(u => u.includes('api.revenuecat.com'));
  console.error = realConsoleError;
  check(crossCustomer.ok === false && crossCustomer.status === 403 && rcCallsCross.length === 1 && consoleLog.length === 1,
    '跨 customer 的 next_page（同 origin、換 uid）⇒ 拒絕跟隨、只打第 1 頁、留下診斷紀錄，別人的 Plus 訂閱不會被算成這個 uid 的資格',
    JSON.stringify({ crossCustomer, 上游: rcCallsCross, consoleLog }));
}

// ── 11. TestFlight 自訂 header 的 CORS 預檢 ────────────────────────────────────────
section(SECTIONS[10]);
{
  const preflight = await worker.fetch(new Request('https://railisland.tw/api/plus-status', {
    method: 'OPTIONS',
    headers: {
      Origin: 'capacitor://localhost',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization, x-rail-plus-sandbox-build',
    },
  }), ENV(), {});
  const allowed = String(preflight.headers.get('Access-Control-Allow-Headers') || '')
    .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  check(preflight.status === 204 && allowed.includes('authorization')
      && allowed.includes('x-rail-plus-sandbox-build'),
    'Capacitor 的 /api/plus-status 預檢明確允許 Authorization 與 TestFlight build header（否則只看得到 OPTIONS，真正 GET 不會送出）',
    JSON.stringify({ status: preflight.status, allowed }));
}

// ── 12. Firestore runtime 身分不得只設 private key ───────────────────────────────
section(SECTIONS[11]);
{
  const wrangler = readFileSync(WRANGLER, 'utf8');
  const hasProject = /"FIRESTORE_PROJECT_ID"\s*:\s*"railisland"/.test(wrangler);
  const hasEmail = /"FIRESTORE_SERVICE_ACCOUNT_EMAIL"\s*:\s*"firebase-adminsdk-fbsvc@railisland\.iam\.gserviceaccount\.com"/.test(wrangler);
  check(hasProject && hasEmail,
    'wrangler runtime 同時帶 Firestore project ID 與已用現有 private key 完成 OAuth 驗證的 service-account email（缺任一個都會讓真機同步寫入失敗）',
    JSON.stringify({ hasProject, hasEmail }));
}
// ── 13. 終身（一次性）購買：只在 /purchases，用 allowlist 認，退款與環境都要擋 ───────────────
// 真值來源是 fixtures/revenuecat-lifetime-20261001/ 的 sandbox 實測原文（REST 回應逐字），不是 worker.js。
// 那批購買全是 sandbox；要測正式環境時只把每筆的 environment 改成 production，其餘欄位不動，
// 這種改寫在下面一律寫成 asProduction()，一眼看得出哪些是改過的。
// allowlist 的 prod… 值同樣從 fixture 讀：先寫死四個商店商品 ID（App Store／Play 後台建立的值），
// 再到 fixture 的 offerings（expand=items.package.product）裡找對應的 prod…——不讀 worker.js 的任何常數。
const FIXTURE_DIR = path.join(ROOT, 'fixtures/revenuecat-lifetime-20261001');
const fixtureBody = (rel) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, rel), 'utf8')).body;
const clone = (value) => JSON.parse(JSON.stringify(value));
const asProduction = (body) => {
  const copy = clone(body);
  for (const item of copy.items) item.environment = 'production';
  return copy;
};
const LIFETIME_STORE_IDS = [
  'tw.railisland.app.plus.lifetime', 'tw.railisland.app.plus.lifetime_upgrade',
  'railisland_pass_lifetime', 'railisland_pass_lifetime_upgrade',
];
section(SECTIONS[12]);
{
  const products = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.object === 'product' && typeof node.store_identifier === 'string') products.push(node);
    Object.values(node).forEach(walk);
  })(fixtureBody('rest/ios-refunded/offerings.json'));
  const lifetimeProd = LIFETIME_STORE_IDS.map(id => (products.find(p => p.store_identifier === id) || {}).id);
  check(lifetimeProd.every(id => typeof id === 'string' && id.startsWith('prod')) && new Set(lifetimeProd).size === 4,
    'fixture 自檢：四個終身商店商品 ID 在 offerings 裡各對到一個不同的 prod…（allowlist 的真值來源）',
    JSON.stringify(Object.fromEntries(LIFETIME_STORE_IDS.map((id, i) => [id, lifetimeProd[i]]))));
  const LIFETIME_ENV = (over = {}) => ENV({ REVENUECAT_LIFETIME_PRODUCT_IDS: lifetimeProd.join(','), ...over });

  const ANDROID_UID = 't2sbx_android_user1', IOS_UID = 't2sbx_ios_user3';
  const androidOwned = fixtureBody('rest/active/t2sbx_android_user1__purchases_sandbox.json');
  const androidRefunded = fixtureBody('rest/refunded/t2sbx_android_user1__purchases_sandbox.json');
  const iosBothOwned = fixtureBody('rest/ios-owned/t2sbx_ios_user3__purchases_sandbox.json');
  const iosOneRefunded = fixtureBody('rest/ios-refunded/t2sbx_ios_user3__purchases_sandbox.json');
  // fixture 自檢：下面每一條正反例都靠這些事實成立；fixture 若被換掉，先在這裡紅，不是讓判準空轉。
  const statuses = (body) => body.items.map(item => `${item.status}:${item.entitlements.items.map(e => e.lookup_key).join('+') || '∅'}`).join(',');
  check(statuses(androidOwned) === 'owned:plus' && statuses(androidRefunded) === 'refunded:∅'
      && statuses(iosBothOwned) === 'owned:plus,owned:plus' && statuses(iosOneRefunded) === 'owned:plus,refunded:∅'
      && androidOwned.items[0].product_id === androidRefunded.items[0].product_id
      && iosOneRefunded.items[0].purchased_at < iosOneRefunded.items[1].purchased_at
      && [androidOwned, iosOneRefunded].every(body => body.items.every(item => item.environment === 'sandbox')),
    'fixture 自檢：Android 買→退是同一個商品、iOS 買兩筆後退掉較晚那筆、全部是 sandbox',
    JSON.stringify({ androidOwned: statuses(androidOwned), androidRefunded: statuses(androidRefunded),
      iosBothOwned: statuses(iosBothOwned), iosOneRefunded: statuses(iosOneRefunded) }));

  const runLifetime = async ({ uid, production, sandbox, subscriptions = { object: 'list', items: [], next_page: null },
    env = LIFETIME_ENV(), request = req() }) => {
    upstream = []; rcBody = subscriptions; rcStatus = 200; rcThrow = false; rcSeq = null;
    rcPurchasesByEnv = { ...(production ? { production } : {}), ...(sandbox ? { sandbox } : {}) };
    identityUid = uid;
    try { return await checkPlusEntitlement(request, env); }
    finally { rcPurchasesByEnv = {}; identityUid = 'uid-under-test'; }
  };
  const purchaseCalls = () => upstream.filter(u => u.includes('api.revenuecat.com') && new URL(u).pathname.endsWith('/purchases'));

  // 終身有效 → 有資格；打的是 /purchases，帶 environment=production 與 limit=100。
  const owned = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) } });
  const ownedCalls = purchaseCalls();
  check(owned.ok === true && owned.entitlementEnvironment === 'production'
      && owned.lifetimePurchases && owned.lifetimePurchases.items.length === 1,
    '終身有效（Android 990 實測回應，只改 environment）＋沒有任何訂閱 ⇒ 有資格', JSON.stringify(owned));
  check(ownedCalls.length === 1 && /[?&]environment=production(&|$)/.test(ownedCalls[0])
      && /[?&]limit=100(&|$)/.test(ownedCalls[0])
      && new URL(ownedCalls[0]).pathname === `/v2/projects/proj_x/customers/${ANDROID_UID}/purchases`
      && upstream.every(u => !u.includes('active_entitlements')),
    '終身查的是這個 customer 的 /purchases，query 帶 environment=production（上游先濾一次）與 limit=100；不打 /active_entitlements（它不分環境）',
    JSON.stringify(ownedCalls));

  const iosOwned = await runLifetime({ uid: IOS_UID, production: { body: asProduction(iosBothOwned) } });
  check(iosOwned.ok === true, '正向對照：iOS 兩筆終身都 owned ⇒ 有資格', JSON.stringify(iosOwned));

  // 終身已退款 → 無資格（同一個帳號、同一個商品，實測退款後的回應）。
  const refunded = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidRefunded) } });
  check(refunded.ok === false && refunded.status === 403 && refunded.error === 'not_entitled',
    '終身已退款（同一筆實測回應：status=refunded、entitlements 清空）⇒ 403 not_entitled', JSON.stringify(refunded));

  // 退款有兩個訊號（status 與 entitlements），各給一條只差一個欄位的樣本，兩道各自有牙。
  const refundedStillEntitled = asProduction(androidRefunded);
  refundedStillEntitled.items[0].entitlements = clone(androidOwned.items[0].entitlements);
  const refundedEnt = await runLifetime({ uid: ANDROID_UID, production: { body: refundedStillEntitled } });
  check(refundedEnt.ok === false && refundedEnt.status === 403,
    'status=refunded 但 entitlements 還掛著 plus（RevenueCat 若晚一步清空）⇒ 仍然無資格（看的是 owned，不是只看 entitlements）',
    JSON.stringify(refundedEnt));
  const ownedNoEnt = asProduction(androidOwned);
  ownedNoEnt.items[0].entitlements.items = [];
  const ownedNoEntResult = await runLifetime({ uid: ANDROID_UID, production: { body: ownedNoEnt } });
  check(ownedNoEntResult.ok === false && ownedNoEntResult.status === 403,
    'status=owned 但 entitlements 是空陣列（商品被拿出 plus）⇒ 無資格', JSON.stringify(ownedNoEntResult));

  // 不在 allowlist 的一次性購買 → 不算。同一份回應、只差 allowlist，對照才證明擋下的是 allowlist。
  const ownedProd = androidOwned.items[0].product_id;
  const notListed = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) },
    env: LIFETIME_ENV({ REVENUECAT_LIFETIME_PRODUCT_IDS: lifetimeProd.filter(id => id !== ownedProd).join(',') }) });
  check(notListed.ok === false && notListed.status === 403,
    '同一筆 owned 購買，但它的商品不在 allowlist（另外三個都在）⇒ 不算終身', JSON.stringify(notListed));
  const otherProduct = asProduction(androidOwned);
  otherProduct.items[0].product_id = 'prod_other_one_time';
  const otherResult = await runLifetime({ uid: ANDROID_UID, production: { body: otherProduct } });
  check(otherResult.ok === false && otherResult.status === 403,
    '別的一次性商品（owned、掛 plus、正式環境，只有 product_id 不在 allowlist）⇒ 不算終身（不從「沒有到期日」反推）',
    JSON.stringify(otherResult));

  // 買兩筆、退一筆 → 仍有資格。fixture 裡被退的是較晚那筆，只看最新一筆的寫法會在這裡紅；
  // 再把順序倒過來，只看第一筆的寫法也會紅。
  const twoOneRefunded = await runLifetime({ uid: IOS_UID, production: { body: asProduction(iosOneRefunded) } });
  const reversed = asProduction(iosOneRefunded); reversed.items.reverse();
  const twoOneRefundedReversed = await runLifetime({ uid: IOS_UID, production: { body: reversed } });
  check(twoOneRefunded.ok === true && twoOneRefundedReversed.ok === true
      && twoOneRefunded.lifetimePurchases.items.length === 1
      && twoOneRefunded.lifetimePurchases.items[0].status === 'owned',
    '買兩筆、退一筆（iOS 實測回應；列表順序正反各一次）⇒ 仍有資格，命中的是 owned 那一筆',
    JSON.stringify({ twoOneRefunded: twoOneRefunded.ok, reversed: twoOneRefundedReversed.ok, hit: twoOneRefunded.lifetimePurchases }));

  // sandbox 購買在正式環境 → 不算。上游若忽略 environment 參數、把 sandbox 那筆回給正式查詢，
  // 逐筆 environment 這道仍要擋下。
  const sandboxInProduction = await runLifetime({ uid: ANDROID_UID, production: { body: androidOwned } });
  check(sandboxInProduction.ok === false && sandboxInProduction.status === 403
      && purchaseCalls().every(u => /[?&]environment=production(&|$)/.test(u)),
    'sandbox 購買（實測回應原文）出現在正式環境的查詢結果裡 ⇒ 不算（逐筆 environment 第二道）',
    JSON.stringify({ sandboxInProduction, calls: purchaseCalls() }));
  // 正向對照：同一份回應走 TestFlight build 21 的 sandbox 回退，帳號在 sandbox UID allowlist 裡，就是有效的測試資格。
  const sandboxFallback = await runLifetime({ uid: ANDROID_UID, production: { body: androidOwned },
    sandbox: { body: androidOwned }, request: req('21'), env: LIFETIME_ENV({ REVENUECAT_SANDBOX_ALLOWED_UIDS: ANDROID_UID }) });
  const fallbackEnvs = purchaseCalls().map(u => new URL(u).searchParams.get('environment'));
  check(sandboxFallback.ok === true && sandboxFallback.entitlementEnvironment === 'sandbox'
      && fallbackEnvs.join(',') === 'production,sandbox',
    '正向對照：同一份 sandbox 回應在 build 21 的 sandbox 回退、帳號在 sandbox UID allowlist ⇒ 取得 sandbox 資格（先查正式、再查 sandbox）',
    JSON.stringify({ sandboxFallback, fallbackEnvs }));
  // 舊 build 的 header 可偽造、不查 UID，sandbox 購買又不收錢：不在 allowlist 的帳號，sandbox 終身一律不算，
  // 也不去查 sandbox /purchases。21、22 兩個舊 build 各驗一次。
  for (const build of ['21', '22']) {
    const outsider = await runLifetime({ uid: ANDROID_UID, production: { body: androidOwned },
      sandbox: { body: androidOwned }, request: req(build) });
    const outsiderEnvs = purchaseCalls().map(u => new URL(u).searchParams.get('environment'));
    check(outsider.ok === false && outsider.status === 403 && outsiderEnvs.join(',') === 'production',
      `build ${build}、帳號不在 sandbox UID allowlist ⇒ sandbox 終身不算（不查 sandbox /purchases）`,
      JSON.stringify({ outsider, outsiderEnvs }));
  }
  // 限縮只針對終身：同一個不在 allowlist 的帳號，舊 build 的 sandbox 訂閱照舊有效（既有 TestFlight 驗收不受影響）。
  const outsiderSub = await runLifetime({ uid: ANDROID_UID, request: req('21'),
    subscriptions: { object: 'list', items: [sub({ customer_id: ANDROID_UID, environment: 'sandbox' })], next_page: null } });
  check(outsiderSub.ok === true && outsiderSub.entitlementEnvironment === 'sandbox',
    '正向對照：build 21、帳號不在 sandbox UID allowlist，但有 sandbox 訂閱 ⇒ 照舊取得 sandbox 資格',
    JSON.stringify(outsiderSub));

  // allowlist 用換行或空白分隔也要認得（secret 常被貼成多行）。
  const spaced = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) },
    env: LIFETIME_ENV({ REVENUECAT_LIFETIME_PRODUCT_IDS: ` ${lifetimeProd.join('\n ')}\n` }) });
  check(spaced.ok === true && spaced.lifetimePurchases && spaced.lifetimePurchases.items.length === 1,
    'allowlist 以換行＋空白分隔 ⇒ 一樣認得終身', JSON.stringify(spaced));
  // 名單填錯格式（帶引號的 JSON 陣列、商店 ID）⇒ 認不到，但要留下紀錄；格式正確時不留（正向對照）。
  {
    const realError = console.error;
    const seen = [];
    console.error = (...args) => { seen.push(args.join(' ')); };
    try {
      const quoted = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) },
        env: LIFETIME_ENV({ REVENUECAT_LIFETIME_PRODUCT_IDS: JSON.stringify(lifetimeProd) }) });
      const quotedLogged = seen.some(line => line.includes('REVENUECAT_LIFETIME_PRODUCT_IDS') && line.includes('prod'));
      seen.length = 0;
      const storeIds = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) },
        env: LIFETIME_ENV({ REVENUECAT_LIFETIME_PRODUCT_IDS: LIFETIME_STORE_IDS.join(',') }) });
      const storeLogged = seen.some(line => line.includes('REVENUECAT_LIFETIME_PRODUCT_IDS'));
      seen.length = 0;
      const good = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) } });
      const goodLogged = seen.some(line => line.includes('REVENUECAT_LIFETIME_PRODUCT_IDS'));
      check(quoted.ok === false && quoted.status === 403 && quotedLogged
          && storeIds.ok === false && storeIds.status === 403 && storeLogged
          && good.ok === true && !goodLogged,
        'allowlist 填成 JSON 陣列或商店 ID ⇒ 不認（不放寬比對）但留下設定錯誤紀錄；填對時不留紀錄',
        JSON.stringify({ quoted: quoted.status, quotedLogged, storeIds: storeIds.status, storeLogged, good: good.ok, goodLogged }));
    } finally { console.error = realError; }
  }

  // allowlist 沒設定 ⇒ 不認終身、也不打 /purchases（與只有訂閱時相同）。
  const unconfigured = await runLifetime({ uid: ANDROID_UID, production: { body: asProduction(androidOwned) }, env: ENV() });
  check(unconfigured.ok === false && unconfigured.status === 403 && purchaseCalls().length === 0,
    'REVENUECAT_LIFETIME_PRODUCT_IDS 沒設定 ⇒ 不打 /purchases、不認終身（行為與只有訂閱時相同）',
    JSON.stringify({ unconfigured, purchaseCalls: purchaseCalls().length }));

  // 查不完整／不合規 ⇒ 503，不得當成「確定沒有終身」。
  const realConsoleError = console.error;
  const logs = [];
  console.error = (...args) => { logs.push(args.join(' ')); };
  try {
    const p500 = await runLifetime({ uid: ANDROID_UID, production: { status: 500, body: {} } });
    check(p500.ok === false && p500.status === 503,
      '/purchases 上游 500 ⇒ 503（可重試），不當成「沒有終身」', JSON.stringify(p500));
    const p500WithSub = await runLifetime({ uid: ANDROID_UID, production: { status: 500, body: {} },
      subscriptions: { object: 'list', items: [sub({ customer_id: ANDROID_UID })], next_page: null } });
    check(p500WithSub.ok === true && p500WithSub.entitlementEnvironment === 'production'
        && p500WithSub.lifetimePurchases === null && p500WithSub.subscriptions.items.length === 1
        && logs.some(line => line.includes('purchases 查詢失敗') && line.includes('只依訂閱判定')),
      '有效訂閱＋/purchases 500 ⇒ 照訂閱判定有資格（終身記為未知，不是「有」），並留下紀錄；上一條是沒有訂閱時的反向對照',
      JSON.stringify({ p500WithSub, logs }));
    const p403WithSub = await runLifetime({ uid: ANDROID_UID,
      production: { status: 403, body: { object: 'error', type: 'authorization_error' } },
      subscriptions: { object: 'list', items: [sub({ customer_id: ANDROID_UID })], next_page: null } });
    const p403NoSub = await runLifetime({ uid: ANDROID_UID,
      production: { status: 403, body: { object: 'error', type: 'authorization_error' } } });
    check(p403WithSub.ok === true && p403WithSub.lifetimePurchases === null
        && p403NoSub.ok === false && p403NoSub.status === 503,
      '金鑰讀不到 /purchases（403）⇒ 訂閱者照常有資格，沒有訂閱的人 503（不當成「確定沒有終身」）',
      JSON.stringify({ p403WithSub, p403NoSub }));
    // 例外（網路斷、回應不是 JSON）與錯誤狀態碼同一套：訂閱者照訂閱，沒有訂閱的人 503。
    const withSub = { object: 'list', items: [sub({ customer_id: ANDROID_UID })], next_page: null };
    const thrownWithSub = await runLifetime({ uid: ANDROID_UID, production: { throws: true }, subscriptions: withSub });
    const thrownNoSub = await runLifetime({ uid: ANDROID_UID, production: { throws: true } });
    const htmlWithSub = await runLifetime({ uid: ANDROID_UID, production: { raw: '<html>oops' }, subscriptions: withSub });
    const htmlNoSub = await runLifetime({ uid: ANDROID_UID, production: { raw: '<html>oops' } });
    check(thrownWithSub.ok === true && thrownWithSub.lifetimePurchases === null
        && htmlWithSub.ok === true && htmlWithSub.lifetimePurchases === null
        && thrownNoSub.ok === false && thrownNoSub.status === 503
        && htmlNoSub.ok === false && htmlNoSub.status === 503,
      '/purchases 網路例外或回應不是 JSON ⇒ 訂閱者照常有資格，沒有訂閱的人 503',
      JSON.stringify({ thrownWithSub: thrownWithSub.ok, htmlWithSub: htmlWithSub.ok, thrownNoSub, htmlNoSub }));
    // 「訂閱足以判定」要用跟正常路徑同一套條件：gives_access 但沒掛 plus 的訂閱不算，/purchases 查不到就 503。
    const otherEntitlementSub = { object: 'list', next_page: null, items: [sub({ customer_id: ANDROID_UID,
      entitlements: { items: [{ id: 'entl_2', lookup_key: 'other', display_name: 'Other', state: 'active' }] } })] };
    const otherWith500 = await runLifetime({ uid: ANDROID_UID, production: { status: 500, body: {} }, subscriptions: otherEntitlementSub });
    check(otherWith500.ok === false && otherWith500.status === 503,
      '訂閱 gives_access 但沒掛 plus＋/purchases 500 ⇒ 503（不算「訂閱足以判定」）；正向對照是上面的有效訂閱＋500', JSON.stringify(otherWith500));
    logs.length = 0;
    const malformed = await runLifetime({ uid: ANDROID_UID, production: { body: { object: 'list', items: null, next_page: null } } });
    check(malformed.ok === false && malformed.status === 503 && logs.some(line => line.includes('purchases') && line.includes('不符官方 schema')),
      '/purchases 的 items 不是陣列 ⇒ 503，且由 schema 守門擋下並留下紀錄', JSON.stringify({ malformed, logs }));
    const foreign = asProduction(androidOwned);
    foreign.items[0].customer_id = 'someone-else';
    const foreignResult = await runLifetime({ uid: ANDROID_UID, production: { body: foreign } });
    check(foreignResult.ok === false && foreignResult.status === 503,
      '/purchases 回了別人的 customer_id ⇒ 503（不把別人的終身算到這個 uid）', JSON.stringify(foreignResult));
    const notFound = await runLifetime({ uid: ANDROID_UID,
      production: { status: 404, body: { object: 'error', type: 'resource_missing', param: 'customer_id' } },
      subscriptions: { object: 'list', items: [sub({ customer_id: ANDROID_UID })], next_page: null } });
    check(notFound.ok === true,
      '/purchases 第一頁 404（customer_id）＝沒有一次性購買，有效訂閱照樣有資格（不是任何 404 都變 503）', JSON.stringify(notFound));
  } finally { console.error = realConsoleError; }

  // 端到端：有終身＋訂閱已過期 ⇒ /api/plus-status 回 active:true。
  const expiredSub = sub({ customer_id: ANDROID_UID, gives_access: false, status: 'expired',
    ends_at: Date.now() - 30 * 86_400_000, current_period_ends_at: Date.now() - 30 * 86_400_000 });
  const status = async (purchases) => {
    upstream = []; rcBody = { object: 'list', items: [expiredSub], next_page: null }; rcStatus = 200; rcThrow = false; rcSeq = null;
    rcPurchasesByEnv = { production: { body: purchases } }; identityUid = ANDROID_UID;
    try {
      const res = await plusStatus(req(), LIFETIME_ENV());
      return { status: res.status, json: await res.json() };
    } finally { rcPurchasesByEnv = {}; identityUid = 'uid-under-test'; }
  };
  const lifetimeExpiredSub = await status(asProduction(androidOwned));
  check(lifetimeExpiredSub.status === 200 && lifetimeExpiredSub.json.active === true
      && lifetimeExpiredSub.json.environment === 'production',
    '端到端：有終身＋訂閱已過期 ⇒ /api/plus-status 回 200 {active:true, environment:production}',
    JSON.stringify(lifetimeExpiredSub));
  const refundedExpiredSub = await status(asProduction(androidRefunded));
  check(refundedExpiredSub.status === 200 && refundedExpiredSub.json.active === false,
    '端到端反向對照：終身已退款＋訂閱已過期 ⇒ 200 {active:false}', JSON.stringify(refundedExpiredSub));
}

globalThis.fetch = realFetch;

// ── 收尾：段落完整性（整段被刪掉時要有具名紅燈，不是靜靜地少跑幾條還印「全部 PASS」）──
SECTION = '(收尾)';
const missing = SECTIONS.filter(s => !seen.get(s));
check(missing.length === 0, '每個宣告過的段落都真的跑過至少一條判準（整段消失時不會靜靜變綠）',
  missing.length ? `沒跑到：${missing.join('、')}` : SECTIONS.map(s => `${s}=${seen.get(s)}`).join(' '));

console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
