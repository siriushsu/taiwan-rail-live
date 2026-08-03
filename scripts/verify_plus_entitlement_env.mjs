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
const { checkPlusEntitlement, plusStatus } = _plus;

let fails = 0;
// 段落完整性守門員：整段被刪掉時，收尾只會印「全部 PASS」而分母悄悄變小＝假綠。
// 刻意**不寫「總共幾條」這種手打常數**（判準寫「是什麼」不寫「有幾個」）——只要求
// 每個宣告過的段落都真的跑過至少一條，段落整批消失時會有一條具名紅燈。
const SECTIONS = ['1 環境判別', '2 存取權判別', '3 entitlement 比對', '4 端點與 query', '5 錯誤分流', '6 plus-status 端到端', '7 發版閘門', '8 分頁與跟頁'];
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

// ── 8. 分頁：limit 上限、跟 next_page 直到找到或翻完、翻頁上限的安全方向（F-1） ──────
// 🔴複審 I-1(b)：/subscriptions 的 limit 預設只有 20，且這支端點沒有 sort、規格也沒有任何
// 「較新排前面」的排序保證——第一頁不能假設含有使用者現在生效的那筆訂閱。三件事都要驗：
// (a) 有效訂閱在第 2 頁時仍判定為有資格；(b) 翻頁上限用完時走安全方向（不得靜默當成有資格）；
// (c) next_page 為 null 時正常結束。
section(SECTIONS[7]);
{
  // (a) 第 1 頁只有 sandbox（無資格），第 2 頁才是正式有效訂閱 ⇒ 必須真的翻頁才找得到。
  const p2 = await runPages([
    { body: { items: [SANDBOX_SUB], next_page: 'https://api.revenuecat.com/v2/projects/proj_x/customers/uid-under-test/subscriptions?environment=production&limit=100&starting_after=sub_1' } },
    { body: { items: [PRODUCTION_SUB], next_page: null } },
  ]);
  const rcCallsP2 = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(p2.ok === true && rcCallsP2.length === 2,
    '(a) 有效訂閱在第 2 頁（第 1 頁只有 sandbox）⇒ 仍判定為有資格，且真的翻了 2 頁上游（不是巧合過關）',
    JSON.stringify({ p2, 上游呼叫次數: rcCallsP2.length }));

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
    body: { items: [SANDBOX_SUB], next_page: `https://api.revenuecat.com/v2/projects/proj_x/customers/uid-under-test/subscriptions?environment=production&limit=100&starting_after=p${i}` },
  })).concat([{ body: { items: [PRODUCTION_SUB], next_page: null } }]);
  const capped = await runPages(beyondCapPages);
  const rcCallsCapped = upstream.filter(u => u.includes('api.revenuecat.com'));
  check(capped.ok === false && capped.status === 403 && rcCallsCapped.length === MAX_PAGES_EXPECTED,
    `(b) 翻頁上限用完仍未找到 ⇒ 安全方向是視同無資格（不得因為我們自己停止翻頁就靜默當成有資格）；剛好翻了 ${MAX_PAGES_EXPECTED} 頁就停手，沒有翻到藏著正式資格的第 ${MAX_PAGES_EXPECTED + 1} 頁`,
    JSON.stringify({ capped, 上游呼叫次數: rcCallsCapped.length }));
}

globalThis.fetch = realFetch;

// ── 收尾：段落完整性（整段被刪掉時要有具名紅燈，不是靜靜地少跑幾條還印「全部 PASS」）──
SECTION = '(收尾)';
const missing = SECTIONS.filter(s => !seen.get(s));
check(missing.length === 0, '每個宣告過的段落都真的跑過至少一條判準（整段消失時不會靜靜變綠）',
  missing.length ? `沒跑到：${missing.join('、')}` : SECTIONS.map(s => `${s}=${seen.get(s)}`).join(' '));

console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
