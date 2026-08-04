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
const RELEASE = path.join(ROOT, 'app/scripts/verify-release.mjs');
const PREPARE = path.join(ROOT, 'app/scripts/prepare-web.mjs');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5(WORKER)}`);
console.log(`[G0] app/scripts/verify-release.mjs md5=${md5(RELEASE)}`);
console.log(`[G0] app/scripts/prepare-web.mjs md5=${md5(PREPARE)}`);

const { _plus } = await import('../worker.js');
const { assertPlusSandboxOff } = await import('../app/scripts/verify-release.mjs');
const { checkPlusEntitlement, plusStatus, resolveRcNextPage, rcSubscriptionsPageError,
  subscriptionMatchesPlus, plusEntitlementDocument } = _plus;

let fails = 0;
// 段落完整性守門員：整段被刪掉時，收尾只會印「全部 PASS」而分母悄悄變小＝假綠。
// 刻意**不寫「總共幾條」這種手打常數**（判準寫「是什麼」不寫「有幾個」）——只要求
// 每個宣告過的段落都真的跑過至少一條，段落整批消失時會有一條具名紅燈。
const SECTIONS = ['1 環境判別', '2 存取權判別', '3 entitlement 比對', '4 端點與 query', '5 錯誤分流', '6 plus-status 端到端', '7 發版閘門', '8 分頁與跟頁',
  '9 回應 schema 守門(I-3／I-4)', '10 分頁 404 與 customer 綁定(I-1／I-5)'];
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
    return new Response(JSON.stringify({ users: [{ localId: 'uid-under-test' }] }), { status: 200 });
  }
  if (u.includes('api.revenuecat.com')) {
    if (rcThrow) throw new TypeError('network down');
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
  FIREBASE_WEB_API_KEY: 'k', REVENUECAT_PROJECT_ID: 'proj_x', REVENUECAT_V2_SECRET_KEY: 'sk_x', ...over,
});
const req = () => new Request('https://railisland.tw/api/plus-status', {
  headers: { Authorization: 'Bearer ' + 'x'.repeat(900), 'cf-connecting-ip': '203.0.113.9' },
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

const run = async ({ body = { items: [] }, status = 200, thrown = false, env = ENV() } = {}) => {
  upstream = []; rcBody = body; rcStatus = status; rcThrow = thrown; rcSeq = null;
  const r = await checkPlusEntitlement(req(), env);
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
  const read = async (body) => {
    upstream = []; rcBody = body; rcStatus = 200; rcThrow = false;
    const res = await plusStatus(req(), ENV());
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
  check(Object.keys(production.json).sort().join(',') === 'active,cloudSyncReady',
    '批二-B：/api/plus-status 的回應恰好是 {active, cloudSyncReady} 兩個欄位（多一個少一個都要在這裡紅）',
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
  const ok = threw('<script>window.RAIL_MUSIC_AVAILABLE=true;window.RAIL_PLUS_SANDBOX_OK=false</script>');
  check(ok === null, '注入 window.RAIL_PLUS_SANDBOX_OK=false 的發行包 ⇒ 通過', String(ok));

  const onMsg = threw('<script>window.RAIL_MUSIC_AVAILABLE=true;window.RAIL_PLUS_SANDBOX_OK=true</script>');
  check(typeof onMsg === 'string' && /RAIL_PLUS_SANDBOX_OK=true/.test(onMsg),
    '注入 window.RAIL_PLUS_SANDBOX_OK=true 的發行包 ⇒ 擋下（sandbox 購買會解鎖正式付費功能）', String(onMsg));

  // 判準刻意是「必須明確寫著 false」而不是「不得出現 true」：注入整段被拿掉時，後者會沉默放行。
  const missMsg = threw('<script>window.RAIL_MUSIC_AVAILABLE=true</script>');
  check(typeof missMsg === 'string' && /RAIL_PLUS_SANDBOX_OK/.test(missMsg),
    '注入整段不見了 ⇒ 也要擋下（沉默不是證據：閘門驗的是「明確是 false」不是「剛好沒有 true」）', String(missMsg));

  // 上面三條驗的是「這支函式有牙」，驗不到「它有沒有被接上發版流程」——直接 import 呼叫的測試
  // 對「verifyRelease 裡那一行被刪掉」是全盲的。這一條補上接線證據：驗 verifyRelease 的函式本體
  // （不是整個檔案）裡真的有呼叫它。這是原始碼字串比對、比行為證據弱，故只當接線檢查用。
  const releaseSrc = readFileSync(RELEASE, 'utf8');
  const verifyReleaseBody = releaseSrc.slice(releaseSrc.indexOf('export async function verifyRelease'));
  check(verifyReleaseBody.length > 0 && /^\s*assertPlusSandboxOff\(html\);\s*$/m.test(verifyReleaseBody),
    'verifyRelease() 本體真的呼叫了 assertPlusSandboxOff(html)（閘門有被接上發版流程，不是一支沒人叫的函式）');

  // 閘門的對象要真的是 build 產物在用的那個變數名——prepare-web.mjs 若改了名字，
  // 上面三條照樣全綠而閘門看守的是一個不存在的東西。
  const prepareSrc = readFileSync(PREPARE, 'utf8');
  check(/window\.RAIL_PLUS_SANDBOX_OK=\$\{plusSandboxOk\}/.test(prepareSrc)
    && /process\.env\.RAIL_PLUS_SANDBOX_OK\s*===\s*'1'/.test(prepareSrc),
    'prepare-web.mjs 真的在注入同一個變數名，且值來自建置期環境變數（不是頁面上可改的東西）');
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

globalThis.fetch = realFetch;

// ── 收尾：段落完整性（整段被刪掉時要有具名紅燈，不是靜靜地少跑幾條還印「全部 PASS」）──
SECTION = '(收尾)';
const missing = SECTIONS.filter(s => !seen.get(s));
check(missing.length === 0, '每個宣告過的段落都真的跑過至少一條判準（整段消失時不會靜靜變綠）',
  missing.length ? `沒跑到：${missing.join('、')}` : SECTIONS.map(s => `${s}=${seen.get(s)}`).join(' '));

console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
