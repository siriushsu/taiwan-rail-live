// Plus 訂閱制改造(買斷→月/年訂閱)獨立行為驗證——Playwright 真引擎 + 本機靜態伺服器。
// 本腳本未參與實作;以下是我從 index.html 讀出、供本腳本判準依據的關鍵事實:
//
//   · 購買 adapter 消費介面(index.html plusAdapterFor / plusRefresh / plusPurchase / plusRestore):
//     window.RAIL_PLUS_TEST_ADAPTER 若存在則 plusAdapterFor 直接回傳它(短路 web SDK),需實作:
//       setUser(uid) / getCustomerInfo() / getOfferings() / purchase(pkg,email) / restore()。
//     - getCustomerInfo() → { entitlements:{ active:{...} }, managementURL }。active 含 config.entitlement
//       (預設 'plus') 這個 key 即視為「已訂閱」(plusActiveFrom)。
//     - getOfferings() → { all:{ [offeringId]:offering }, current:offering };
//       offering.availablePackages = [ 月package, 年package ]。plusPickPackage 以 packageType
//       (MONTHLY/ANNUAL) 或 identifier 挑出月/年。
//     - 每個 package 的價格由 plusPackagePrice 讀 pkg.webBillingProduct.currentPrice.formattedPrice。
//       ★關鍵:UI 顯示的價格一律來自這裡(商店回傳),index.html 內不硬編任何金額。
//     - purchase(pkg,email) → { customerInfo:{...active.plus...} }。
//   · plusOpen 需 state.account.user 才會開購買畫面(否則轉登入);plusConfigured() 為真(有 test/native
//     adapter 或 webApiKey)才會 plusRefresh 初始化 billing——故「web 未配置(無 webApiKey、無 adapter)」
//     時不會拿 undefined key 去 configure,改停在「請在 App 內訂閱」。
//   · 主題:html[data-theme=dark];FOUC 腳本(index.html:1727)讀 localStorage['trainmap-appearance']
//     ('light'|'dark'|'auto')套 data-theme——故 seed 這個鍵即可強制亮/暗截圖。
//   · state / plusOpen / accountRender 等皆為 classic script 頂層宣告,page.evaluate 全域可見(比照
//     verify_last_view.mjs 的既有作法)。注入 config/adapter/account 後直接呼叫 app 自己的公開函式,
//     走的是與真實使用者相同的 render/購買路徑,只是用可控 stub 取代真商店,以取得可斷言的數值。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// G0 自檢(心得32:驗收腳本第一道 gate 要印出驗的是哪個目錄):ROOT 由本檔自身路徑推導,
// 不吃任何 --root／env 參數,結構上不會誤驗到別的 worktree;仍留一行可稽核紀錄。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);
// 可推導,不寫死 session scratchpad 路徑(每個 session 都要手改一次的坑,2026-08-02)。
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'rail-plus-shots');
mkdirSync(SHOT_DIR, { recursive: true });
const PORT = 5207;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// 止血旗標關閉版:網址帶 ?__flagoff=1 時,供應同一份磁碟檔、只把 PLUS_ENABLED 的宣告翻成 false。
// 為什麼改原始碼而不是靠既有的 URL 參數:PLUS_ENABLED 已刻意不再認 ?plus=1(見下方 BASE 註解),
// 要驗「關得掉嗎」就只能動那一行宣告本身。KS0 會現讀頁面確認真的翻到了。
// ⚠️ 用 query 標記而不是路徑前綴(/__flagoff/):頁面裡的 API 是相對路徑(`api/tra-live`),
//    掛在路徑前綴下會變成 /__flagoff/api/…,繞過本伺服器的 /api/ 短路而 404,把整段染上假的
//    console.error(第一版實測到 6 個)。query 標記不動路徑,所有相對資源照常解析。
const FLAG_ON_DECL = 'const PLUS_ENABLED = true;';
const FLAG_OFF_DECL = 'const PLUS_ENABLED = false;';
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  if (url.searchParams.get('__flagoff') === '1' && fp.endsWith('index.html')) {
    const src = readFileSync(fp, 'utf8');
    // 找不到宣告就回 500:靜默供應未替換的版本會讓整個 KS 段變成「旗標開著卻宣稱驗了關閉態」的假綠。
    if (!src.includes(FLAG_ON_DECL)) { res.statusCode = 500; return res.end('flag-decl-not-found'); }
    return res.end(src.replace(FLAG_ON_DECL, FLAG_OFF_DECL));
  }
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
// PLUS_ENABLED 是 UI 總閘,2026-08-02 開閘後恆真(不再認 ?plus=1)。刻意不帶任何 query string:
// 網址帶著 ?plus=1 會讓「旗標被改回只認 URL 參數」這種回退在本腳本裡完全看不出來(每一節都自帶
// 通行證),整支腳本會變成永遠的綠燈。用真實預設網址跑,旗標一被關掉 A/B 段當場崩。
const BASE = `http://localhost:${PORT}/`;

// 刻意用非真實佔位值:本 repo 公開,實際定價未拍板,不放進版控。
// 判準只比「商店回傳什麼、UI 就顯示什麼」,不解析數值,故任何相異字串皆可。
const M_PRICE = 'NT$MONTH-STUB';  // stub「月訂」價(模擬商店回傳;index.html 不得硬編此值)
const A_PRICE = 'NT$YEAR-STUB';   // stub「年訂」價

const results = [];
const skips = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const skip = (name, reason) => { skips.push({ name, reason }); console.log(`SKIP ${name} — ${reason}`); };

const allErrors = [];
// 本檔有 ~10 條「零 pageerror/console.error」斷言,全部是「數量必須為 0」型——收集器若沒掛上,
// 它們會全部無條件通過。兩道防線:(1) Z0 正向對照證明 listener 真的收得到(見檔尾);
// (2) 下面兩個計數器證明「每一個開出來的 page 都有掛」——attach 與 newPage 是分開兩次呼叫,
//     新增情境時可能只寫了 newPage 忘了 attach,那顆 page 的例外就會全程隱形。
let pagesCreated = 0, pagesAttached = 0;
function attach(page, tag) {
  const local = [];
  pagesAttached++;
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; local.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error') { const s = `[${tag}] console.error: ${m.text()}`; local.push(s); allErrors.push(s); } });
  return local;
}
async function newPage(browser, { width = 1280, height = 800, touch = false, theme = 'light' } = {}) {
  pagesCreated++;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(t => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    try { localStorage.setItem('trainmap-appearance', t); } catch (e) {}
  }, theme);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function waitReady(page) {
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}
// 注入 stub 商店 + 帳號,回傳後可呼叫 plusOpen。mode: 'buy'(可購買,有 test adapter) | 'appOnly'(web 未配置:僅 iosApiKey)
async function injectPlus(page, { mode = 'buy', subscribed = false } = {}) {
  await page.evaluate(({ mode, subscribed, M_PRICE, A_PRICE }) => {
    state.plus = null; // 清掉殘留
    state.account = { ready: true, user: { uid: 'test-uid', email: 'tester@example.com', displayName: '測試員' }, syncing: false, lastSync: 0, actionError: '', error: '' };
    if (mode === 'appOnly') {
      window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus', iosApiKey: 'ios_only_key' };
      delete window.RAIL_PLUS_TEST_ADAPTER;
      return;
    }
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    let sub = !!subscribed;
    const info = () => ({ entitlements: { active: sub ? { plus: { identifier: 'plus' } } : {} }, managementURL: sub ? 'https://apps.apple.com/account/subscriptions' : '' });
    const offering = { availablePackages: [
      { identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: M_PRICE } } },
      { identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: A_PRICE } } },
    ] };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {},
      getCustomerInfo: async () => info(),
      getOfferings: async () => ({ all: { plus: offering }, current: offering }),
      purchase: async () => { sub = true; return { customerInfo: info() }; },
      restore: async () => info(),
    };
  }, { mode, subscribed, M_PRICE, A_PRICE });
}
const readModal = (page) => page.evaluate(() => {
  const modal = document.getElementById('plusModal');
  const body = document.getElementById('plusBody');
  const plans = [...body.querySelectorAll('.plus-plan')].map(b => ({
    pkg: b.dataset.pkg,
    primary: b.classList.contains('plus-plan-primary'),
    badge: (b.querySelector('.plus-plan-badge') || {}).textContent || '',
    name: (b.querySelector('.plus-plan-name') || {}).textContent || '',
    price: (b.querySelector('.plus-plan-price') || {}).textContent || '',
  }));
  return {
    hidden: modal.hidden,
    text: body.textContent || '',
    html: body.innerHTML,
    plans,
    owned: !!body.querySelector('.plus-owned'),
    ownedText: (body.querySelector('.plus-owned') || {}).textContent || '',
    manageHref: (body.querySelector('.plus-manage') || {}).getAttribute ? body.querySelector('.plus-manage').getAttribute('href') : (body.querySelector('.plus-manage') ? '' : null),
    hasRestore: !!body.querySelector('[data-plus="restore"]'),
    privacy: !!body.querySelector('.plus-legal a[href="privacy.html"]'),
    terms: !!body.querySelector('.plus-legal a[href="terms.html"]'),
    trust: !!body.querySelector('.plus-trust'),
    trustText: (body.querySelector('.plus-trust') || {}).textContent || '',
    feats: body.querySelectorAll('.plus-feature').length,
  };
});
const FORBIDDEN = ['一次購買', '永久解鎖', '不是訂閱'];
// 原生殼等價物:plusConfigured() 轉真的注入內容。必須在頁面載入「之前」注入——setupTakeoutUi()
// 在 boot 內就跑完了,執行期才設 window.RAIL_NATIVE_PLUS_ADAPTER 已經來不及(見 verify_plus_features
// 的同一則教訓)。Firebase 用既有的 RAIL_FIREBASE_TEST_MODULES 短路,不打真網路。
const NATIVE_INIT = () => {
  window.RAIL_NATIVE_PLUS_ADAPTER = {
    setUser: async () => {}, getCustomerInfo: async () => ({ entitlements: { active: {} } }),
    getOfferings: async () => ({ all: {}, current: null }), purchase: async () => ({}), restore: async () => ({ entitlements: { active: {} } }),
  };
  window.RAIL_FIREBASE_TEST_MODULES = { initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}), onAuthStateChanged: () => {} };
};

const chromiumB = await chromium.launch();
const webkitB = await webkit.launch();

// ══════════════ G0b. 旗標現讀:PLUS_ENABLED 被改回參數式時要有一條「有名字」的紅燈 ══════════════
// 為什麼要獨立一條:旗標一旦改回只認 ?plus=1,本腳本(刻意不帶 query string)的 A 段會在
// waitForSelector('.plus-plan') 逾時**拋例外中止整支腳本**——exit code 雖然是 1,但輸出裡 0 條 PASS、
// 0 條 FAIL、沒有總計行,排查的人看不出「還有什麼壞了」。這一條把旗標本身變成一條具名斷言,
// 而且跑在 A 段之前;A/B/W 三段也一併改成等不到就往下走(見 runFlow),其餘判準照常各自回報。
// 從執行中的頁面現讀,不是 grep 原始碼:讀原始碼只證明字面上寫了 true,證明不了瀏覽器眼中它是 true。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'G0b');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const flagOn = await page.evaluate(() => { try { return PLUS_ENABLED === true; } catch (e) { return 'ReferenceError'; } });
  ok('G0b 頁面現讀 PLUS_ENABLED === true(開閘;被改回只認 ?plus=1 時這裡先亮一條具名紅燈)', flagOn === true, `PLUS_ENABLED=${flagOn}`);
  ok('G0b 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// 完整 Plus 清單的基準項數:由第一趟主流程(A)實地量到,不是手打的常數。
// 用途見 runFlow 內 `${label}1` 旁的註解;取不到(仍為 null 或 0)時 G3/G4/N-tap 會具名轉紅。
let BASELINE_FEATS = null;

// ══════════════ A/B. 主流程(桌機 1280×800 chromium、手機 375×812 觸控) ══════════════
async function runFlow(browser, label, opts) {
  const { ctx, page } = await newPage(browser, opts);
  const errs = attach(page, label);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await injectPlus(page, { mode: 'buy' });
  await page.evaluate(() => plusOpen('test'));
  // 等不到就往下走:讓 A1–A12 各自以「量到什麼」具名轉紅,不要在這裡拋例外中止整支腳本
  // ——中止的話後面的 C/D/G/N/H/I/P/Z0 全部靜默不跑,只留一段堆疊,看不出還有什麼壞了。
  await page.waitForSelector('#plusBody .plus-plan', { timeout: 6000 }).catch(() => {});
  const m = await readModal(page);

  ok(`${label}1 訂閱視窗顯示(modal 未隱藏)`, m.hidden === false, `hidden=${m.hidden}`);
  // 這一趟(桌機、有購買通道、真的走 plusOpen)是本檔的「完整清單」基準:後面每一條入口路徑都要求
  // 畫出同樣多項,而不是各自釘一個寫死的下限(`>= 5` 少一項也過、多十項也過)。清單本身的絕對內容
  // 由 verify_plus_features.mjs 的 REQUIRED 對映表負責,這裡負責的是「每條入口路徑渲染的是同一份」。
  if (BASELINE_FEATS === null) BASELINE_FEATS = m.feats;
  ok(`${label}2 出現月/年兩顆價格鈕`, m.plans.length === 2 && m.plans.some(p => p.pkg === 'month') && m.plans.some(p => p.pkg === 'annual'),
    `plans=${JSON.stringify(m.plans.map(p => p.pkg))}`);
  ok(`${label}3 年訂在前(第一顆)且為主推(有「最划算」徽章)`, m.plans[0] && m.plans[0].pkg === 'annual' && m.plans[0].primary === true && m.plans[0].badge.includes('最划算'),
    `first=${JSON.stringify(m.plans[0])}`);
  ok(`${label}4 月訂為次(第二顆、無徽章)`, m.plans[1] && m.plans[1].pkg === 'month' && m.plans[1].primary === false && !m.plans[1].badge,
    `second=${JSON.stringify(m.plans[1])}`);
  const aPlan = m.plans.find(p => p.pkg === 'annual'), mPlan = m.plans.find(p => p.pkg === 'month');
  ok(`${label}5 價格文字來自 stub 商店回傳(年=${A_PRICE}、月=${M_PRICE})`,
    aPlan && aPlan.price === A_PRICE && mPlan && mPlan.price === M_PRICE,
    `年=${aPlan && aPlan.price} 月=${mPlan && mPlan.price}`);
  ok(`${label}6 視窗內無「一次購買/永久解鎖/不是訂閱」字樣`, !FORBIDDEN.some(w => m.text.includes(w)),
    FORBIDDEN.filter(w => m.text.includes(w)).join(','));
  ok(`${label}7 法務列含隱私權政策(privacy.html)與使用條款(terms.html)連結`, m.privacy && m.terms,
    `privacy=${m.privacy} terms=${m.terms}`);
  // 舊版釘死字面值「永遠免費」,文案一改就為了正確的理由轉紅;而且釘另一個字面值只是把同一個坑
  // 往後推一格。改測語意:信任聲明這個節點存在,而且它主張的是「準確度不受 Plus 影響」——
  // 「準確度」是被主張的對象、「不影響/不受影響」是主張本身,兩者都在才算真的做了這個宣稱。
  const trustClaim = m.trustText.includes('準確度') && /不影響|不受.{0,4}影響/.test(m.trustText);
  ok(`${label}8 頭牌功能=誤點履歷,且信任聲明存在並主張「準確度不受 Plus 影響」`,
    m.text.includes('誤點履歷') && m.trust && trustClaim,
    `誤點履歷=${m.text.includes('誤點履歷')} trust=${m.trust} trustText=${JSON.stringify(m.trustText)}`);
  // 正向對照:同一支語意偵測器對「有準確度、沒有否定」與「有否定、沒有準確度」兩種殘缺樣本都要拒收,
  // 證明它不是只要 .plus-trust 存在就恆真(那正是舊斷言換成語意版之後最容易退化成的樣子)。
  const claimOf = s => s.includes('準確度') && /不影響|不受.{0,4}影響/.test(s);
  ok(`${label}8 正向對照:語意偵測器對殘缺樣本必須拒收(只有「準確度」或只有「不影響」都不算做了宣稱)`,
    claimOf('Plus 不影響準確度') === true && claimOf('準確度很高') === false && claimOf('不影響任何東西') === false,
    `完整=${claimOf('Plus 不影響準確度')} 只有準確度=${claimOf('準確度很高')} 只有不影響=${claimOf('不影響任何東西')}`);
  ok(`${label}9 自動續訂法務說明存在`, m.text.includes('自動續訂') || m.text.includes('自動續'),
    m.text.slice(0, 0));

  // 購買年訂 → 訂閱成功。既有行為:成功後 modal 自動關閉並跳 toast;重開即渲染「已訂閱」狀態。
  await page.click('#plusBody .plus-plan[data-pkg="annual"]', { timeout: 6000 }).catch(() => {}); // 同上:買不到就讓 A10–A12 轉紅,不中止
  await page.waitForFunction(() => state.plus && state.plus.active === true && state.plus.loading === false, null, { timeout: 6000 }).catch(() => {});
  const closedAfterBuy = await page.evaluate(() => document.getElementById('plusModal').hidden);
  await page.evaluate(() => plusOpen('test'));
  await page.waitForSelector('#plusBody .plus-owned', { state: 'visible', timeout: 6000 }).catch(() => {});
  const owned = await readModal(page);
  const acct = await page.evaluate(() => { accountRender(); return { active: !!(state.plus && state.plus.active), body: document.getElementById('accountBody').textContent || '' }; });
  ok(`${label}10 購買(年訂)後 Plus 已啟用,且購買成功自動關窗`, owned.owned && owned.ownedText.includes('Plus 已啟用') && acct.active === true && closedAfterBuy === true,
    `ownedText=${owned.ownedText} active=${acct.active} closedAfterBuy=${closedAfterBuy}`);
  ok(`${label}11 已訂閱狀態同時提供「恢復購買」與「管理訂閱」(有 mgmtUrl→連結)`, owned.hasRestore && owned.manageHref === 'https://apps.apple.com/account/subscriptions',
    `restore=${owned.hasRestore} manage=${owned.manageHref}`);
  ok(`${label}12 帳號頁 Plus 狀態顯示為「訂閱中」`, acct.body.includes('訂閱中'), `accountBody 片段含「訂閱中」=${acct.body.includes('訂閱中')}`);

  ok(`${label}Z 本輪零 pageerror/console.error`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
await runFlow(chromiumB, 'A(桌機)', { width: 1280, height: 800 });
await runFlow(chromiumB, 'B(手機)', { width: 375, height: 812, touch: true });
await runFlow(webkitB, 'W(WebKit)', { width: 1280, height: 800 });

// ══════════════ C. restore(此帳號未訂閱)不炸,給明確「無可恢復」訊息 ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'C');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await injectPlus(page, { mode: 'buy', subscribed: false });
  await page.evaluate(() => plusOpen('test'));
  await page.waitForSelector('#plusBody [data-plus="restore"]', { timeout: 6000 }).catch(() => {}); // 同 A/B/W:等不到就讓 C2 具名轉紅,不中止整支腳本
  await page.click('#plusBody [data-plus="restore"]', { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => state.plus && state.plus.loading === false && (state.plus.error || '').length > 0, null, { timeout: 6000 }).catch(() => {});
  const err = await page.evaluate(() => (state.plus && state.plus.error) || '');
  ok('C1 未訂閱帳號 restore 走恢復路徑不拋例外', errs.length === 0, errs.slice(0, 3).join(' | '));
  ok('C2 restore 給出「沒有可恢復的 Plus 訂閱資格」訊息', err.includes('沒有可恢復') && err.includes('訂閱'), `error=${err}`);
  await ctx.close();
}

// ══════════════ D. web 未配置購買(僅 iosApiKey、無 webApiKey/adapter):請在 App 內訂閱,不初始化 SDK ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'D');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await injectPlus(page, { mode: 'appOnly' });
  await page.evaluate(() => plusOpen('test'));
  await page.waitForSelector('#plusBody .plus-legal', { timeout: 6000 });
  await page.waitForTimeout(300);
  const m = await readModal(page);
  ok('D1 未配置購買時不出價格鈕', m.plans.length === 0, `plans=${m.plans.length}`);
  ok('D2 顯示「請在軌島 App 內訂閱」說明(非 disabled 鈕)', m.text.includes('請在軌島 App 內訂閱') && !m.html.includes('disabled'),
    `hasNote=${m.text.includes('請在軌島 App 內訂閱')}`);
  ok('D3 法務列仍在', m.privacy && m.terms, `privacy=${m.privacy} terms=${m.terms}`);
  ok('D4 未初始化 billing(零 pageerror,沒拿 undefined key 去 configure)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ E. 截圖:桌機/手機 × 亮/暗,購買畫面 modal ══════════════
async function shot(label, { width, height, touch, theme }) {
  const { ctx, page } = await newPage(chromiumB, { width, height, touch, theme });
  attach(page, `SHOT-${label}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await injectPlus(page, { mode: 'buy' });
  await page.evaluate(() => plusOpen('test'));
  // 等不到價格鈕就照樣往下走:截圖段沒有截到東西應該由 E1 具名報紅,不該把整支腳本連同總計行一起帶走
  await page.waitForSelector('#plusBody .plus-plan', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(250);
  const themeApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const file = path.join(SHOT_DIR, `plus_sub_${label}.png`);
  // 同 E2 註解:截不到就記下來交給 E2 具名報紅,不要讓 locator.screenshot 的 timeout 帶走總計行
  const shotOk = await page.locator('.plus-dialog').screenshot({ path: file }).then(() => true, () => false);
  console.log(`SHOT ${label} (data-theme=${themeApplied}) → ${file}${shotOk ? '' : ' (截圖失敗)'}`);
  await ctx.close();
  return { file, themeApplied, shotOk };
}
const shotDeskLight = await shot('desktop_light', { width: 1280, height: 800, touch: false, theme: 'light' });
const shotDeskDark = await shot('desktop_dark', { width: 1280, height: 800, touch: false, theme: 'dark' });
const shotMobLight = await shot('mobile_light', { width: 375, height: 812, touch: true, theme: 'light' });
const shotMobDark = await shot('mobile_dark', { width: 375, height: 812, touch: true, theme: 'dark' });
ok('E1 亮/暗主題確實套用(截圖用)', shotDeskLight.themeApplied === 'light' && shotDeskDark.themeApplied === 'dark' && shotMobLight.themeApplied === 'light' && shotMobDark.themeApplied === 'dark',
  `desk=${shotDeskLight.themeApplied}/${shotDeskDark.themeApplied} mob=${shotMobLight.themeApplied}/${shotMobDark.themeApplied}`);
const allShots = [shotDeskLight, shotDeskDark, shotMobLight, shotMobDark];
ok('E2 四張購買畫面截圖都真的產出(截不到 = 訂閱視窗根本沒開,不可以靜默放過)', allShots.every(s => s.shotOk),
  `成功 ${allShots.filter(s => s.shotOk).length}/4`);

// ══════════════ F. 迴歸:預設旗標全關(無注入)開站正常,Plus modal 不可見,零 error ══════════════
async function regression(label, { width, height, touch }) {
  const { ctx, page } = await newPage(chromiumB, { width, height, touch });
  const errs = attach(page, `REG-${label}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(400);
  const snap = await page.evaluate(() => ({
    plusHidden: document.getElementById('plusModal').hidden,
    plusCfg: (typeof RAIL_REVENUECAT_CONFIG !== 'undefined') ? true : (window.RAIL_REVENUECAT_CONFIG || null),
    firstScreenOk: !!(document.getElementById('systems') && document.getElementById('systems').children.length > 0
      && document.getElementById('overlay') && document.getElementById('overlay').width > 0),
    trains: !!(state.trains && state.trains.length > 0),
  }));
  ok(`F(${label})1 預設 Plus modal 不可見`, snap.plusHidden === true, `hidden=${snap.plusHidden}`);
  ok(`F(${label})2 首屏正常(系統列+canvas+列車資料非空)`, snap.firstScreenOk && snap.trains, `firstScreen=${snap.firstScreenOk} trains=${snap.trains}`);
  ok(`F(${label})3 boot 零 pageerror/console.error`, errs.length === 0, errs.slice(0, 4).join(' | '));
  await ctx.close();
}
await regression('1280', { width: 1280, height: 800, touch: false });
await regression('375', { width: 375, height: 812, touch: true });

// ══════════════ G. Plus 面板入口與兩段式登入 ══════════════
// 舊版 G 斷言的是「匿名點 Plus 入口 → 直接看到 Google＋Apple 登入鈕」,那是被取代的舊行為
// (plusOpen 一開頭就強迫登入)。現行契約是兩段式:
//   第一段 無購買通道的平台,匿名訪客從 Plus 槽位開得了面板,看得到功能清單與「請在 App 內訂閱」,
//          而且這一段全程零 Firebase、state.account 仍 undefined(未登入即可瀏覽的契約沒有被撤銷);
//   第二段 面板內按下「已經在 App 訂閱了？登入以同步」之後,才出現 Google＋Apple 兩顆登入鈕。
// 有購買通道的平台(App)不走這條:訂閱資格要綁帳號才能跨裝置恢復,維持「先登入再開面板」(見 G10)。
//
// 入口一律走真正的產品路徑(#accountBtn 的 click),不直接呼叫 plusOpen():直接呼叫會跳過
// setupAccountUi 的槽位改造,「誰把入口放上去、按下去接到哪」這半段就等於沒驗到。
const FIREBASE_REQ_RE = /gstatic\.com\/firebasejs|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com|firebaseapp\.com/;
function collectFirebaseReqs(page) {
  const out = [];
  page.on('request', req => { const u = req.url(); if (FIREBASE_REQ_RE.test(u)) out.push(u); });
  return out;
}
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'G');
  const firebaseReqs = collectFirebaseReqs(page); // 與 I2 同一支收集器、同一條 regex
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const entry = await page.evaluate(async () => {
    const vis = el => { if (!el) return false; const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const btn = document.getElementById('accountBtn');
    const cs = btn && getComputedStyle(btn), r = btn && btn.getBoundingClientRect();
    const out = {
      btnVisible: !!(btn && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0),
      btnLabel: btn && btn.querySelector('.tl') ? btn.querySelector('.tl').textContent : null,
    };
    // G2 要量的是使用者看得到的結果,所以得等抽屜真的打開:抽屜列的 inline display 在開啟當下
    // 會被 syncMoreSheet() 依代理鈕重算,開啟前那一格只是中間態(舊版斷言 row.style.display !== 'none'
    // 就是咬在那個中間態上,2026-08-03 複審實測:拿掉 accountBtnSlot 的那一行只有 G2/I3c 紅,
    // 同一趟真的點開抽屜再量的 N…b 全綠 ⇒ 那一行對使用者看得到的結果沒有影響)。
    const fab = document.getElementById('toolsFab') || document.getElementById('tabMore');
    if (fab) fab.click();
    await new Promise(r2 => setTimeout(r2, 350));
    const row = document.querySelector('.ms-row[data-proxy="accountBtn"]');
    const other = document.querySelector('.ms-row[data-proxy="shareBtn"]');
    out.sheetOpen = vis(document.querySelector('.more-sheet'));
    out.rowShown = vis(row);
    out.rowLabel = row && row.querySelector('span') ? row.querySelector('span').textContent : null;
    out.otherRowVisible = vis(other);
    if (fab) fab.click(); // 收回抽屜,不影響後面走真實點擊的那一段
    await new Promise(r2 => setTimeout(r2, 200));
    return out;
  });
  ok('G1 網站匿名訪客的工具列有 Plus 入口且標成 Plus(槽位改造真的跑過,不是還停在帳號標籤)',
    entry.btnVisible === true && entry.btnLabel === 'Plus', JSON.stringify(entry));
  ok('G2 「更多」抽屜真的打開後,同一個槽位在畫面上可見且標成「軌島 Plus」(手機唯一入口,桌面工具鈕在 ≤900 是 display:none)',
    entry.sheetOpen === true && entry.rowShown === true && entry.rowLabel === '軌島 Plus', JSON.stringify(entry));
  ok('G2b 正向對照:同一張抽屜、同一支可見性探針量得到一列可見的鄰居(#shareBtn 那列)——證明它不是對整張抽屜都回 false',
    entry.otherRowVisible === true, JSON.stringify(entry));
  // 真的點,不是 evaluate 呼叫函式。點不到就記下來往下走:讓它變成一條紅斷言,而不是拋例外中止整支腳本
  // ——中止的話後面所有情境(含守免費層匿名的 I 段)全部靜默不跑,只留一段堆疊,看不出還有什麼壞了。
  const entryClicked = await page.click('#accountBtn', { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForSelector('#plusModal:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => ({
    open: !document.getElementById('plusModal').hidden,
    feats: document.querySelectorAll('.plus-feature').length,
    appOnly: /App\s*內訂閱/.test(document.getElementById('plusBody').textContent || ''),
    buyBtns: document.querySelectorAll('[data-plus="buy"]').length,
    loginCta: document.querySelectorAll('[data-plus="login"]').length,
    ctaText: (document.querySelector('[data-plus="login"]') || {}).textContent || '',
    loginBtns: document.querySelectorAll('[data-login]').length,
    accountUndefined: typeof state.account === 'undefined',
  }));
  ok('G3 匿名點入口 → Plus 面板直接開,且畫出的功能項數與 A 段基準一致(沒有被推去登入、也沒有半截渲染)',
    entryClicked === true && panel.open === true && BASELINE_FEATS > 0 && panel.feats === BASELINE_FEATS,
    `點得到=${entryClicked} 基準=${BASELINE_FEATS} ` + JSON.stringify(panel));
  ok('G4 面板停在「請在 App 內訂閱」,零購買鈕(網站不賣)',
    panel.appOnly === true && panel.buyBtns === 0, `appOnly=${panel.appOnly} buy=${panel.buyBtns}`);
  ok('G5 看完整個面板,state.account 仍是 undefined(帳號系統沒被叫起來)',
    panel.accountUndefined === true, `accountUndefined=${panel.accountUndefined}`);
  ok('G6 看完整個面板,Firebase 網路請求仍為 0(免費層匿名沒有因為開放面板而破功)',
    firebaseReqs.length === 0, firebaseReqs.slice(0, 3).join(' | '));
  ok('G7 面板內有登入 CTA,但登入鈕此刻還沒出現(兩段式的第一段:看得到入口、還沒載帳號系統)',
    panel.loginCta === 1 && /登入/.test(panel.ctaText) && panel.loginBtns === 0,
    `cta=${panel.loginCta} 文字=${panel.ctaText} 登入鈕=${panel.loginBtns}`);
  await page.click('[data-plus="login"]', { timeout: 5000 }).catch(() => {}); // 同上:CTA 不存在時讓 G8/G9 轉紅,不要中止腳本
  // 條件式等待,不用固定秒數:Firebase SDK 是延遲載入,冷載入比暖載入慢很多,
  // 固定 timeout 會讓這條斷言實際在量「載入快不快」而不是「CTA 有沒有把帳號系統叫起來」。
  await page.waitForSelector('[data-login="google"]', { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => ({
    loginBtns: document.querySelectorAll('[data-login="google"], [data-login="apple"]').length,
    accountBuilt: !!state.account,
  }));
  ok('G8 按下 CTA 之後才出現 Google＋Apple 兩顆登入鈕(第二段;accountEnsureInit 是這時才跑的)',
    after.loginBtns >= 2 && after.accountBuilt === true, JSON.stringify(after));
  ok('G9 正向對照:同一支收集器在按下 CTA 之後抓得到 Firebase 請求(證明 G6 的「零」不是收集器壞掉)',
    firebaseReqs.length > 0, `抓到 ${firebaseReqs.length} 筆${firebaseReqs.length ? '：' + firebaseReqs[0] : ''}`);
  // G11/G12:在登入畫面反悔的人(不登入就關掉帳號面板)回得去 Plus 面板嗎?
  // 這條路一度是單向門:accountEnsureInit() 一跑就把槽位翻成帳號入口,而登出態的帳號面板沒有任何
  // 回 Plus 的路徑 ⇒ 只要按過一次登入 CTA(或登入失敗、popup 被擋),訂閱內容的入口就永久消失,
  // 只能重新整理頁面。手機更嚴重:≤900 的 .stage-tools 是 display:none,抽屜列是唯一入口。
  // 走真正的產品路徑(關面板→再點同一顆鈕),不直接呼叫函式:要驗的正是「槽位現在接到哪」。
  await page.evaluate(() => accountClose());
  await page.waitForTimeout(250);
  const backout = await page.evaluate(() => {
    const btn = document.getElementById('accountBtn'), row = document.querySelector('.ms-row[data-proxy="accountBtn"]');
    return {
      btnLabel: btn && btn.querySelector('.tl') ? btn.querySelector('.tl').textContent : null,
      rowLabel: row && row.querySelector('span') ? row.querySelector('span').textContent : null,
      loggedIn: !!(state.account && state.account.user),
      accountBuilt: !!state.account,
    };
  });
  ok('G11 按過登入 CTA 但沒登入就關掉帳號面板後,槽位仍是 Plus 入口(帳號系統已初始化 ≠ 這個人有帳號)',
    backout.accountBuilt === true && backout.loggedIn === false && backout.btnLabel === 'Plus' && backout.rowLabel === '軌島 Plus',
    JSON.stringify(backout));
  const reClicked = await page.click('#accountBtn', { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForSelector('#plusModal:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => ({
    plusOpen: !document.getElementById('plusModal').hidden,
    feats: document.querySelectorAll('.plus-feature').length,
    cta: document.querySelectorAll('[data-plus="login"]').length,
    accountOpen: !document.getElementById('accountModal').hidden,
  }));
  ok('G12 反悔之後再按一次槽位 → Plus 面板重新開得起來(功能項數與 A 段基準一致、登入 CTA 在,不是被推去帳號面板)',
    reClicked === true && back.plusOpen === true && BASELINE_FEATS > 0 && back.feats === BASELINE_FEATS && back.cta === 1 && back.accountOpen === false,
    `點得到=${reClicked} 基準=${BASELINE_FEATS} ` + JSON.stringify(back));
  // G13:就算槽位真的變成帳號入口(回訪裝置的登出態就是這樣),登出態的帳號面板也要有回 Plus 的路——
  // 兩道保險守的是同一件事:任何一條「進了帳號畫面又不想登入」的路都不該是死路。
  const escape = await page.evaluate(() => {
    accountOpen(); // 登出態的帳號面板
    const n = document.querySelectorAll('#accountBody [data-action="plus"]').length;
    const txt = (document.querySelector('#accountBody [data-action="plus"]') || {}).textContent || '';
    accountClose();
    return { n, txt, loggedIn: !!(state.account && state.account.user) };
  });
  ok('G13 登出態的帳號面板有一條回 Plus 的路(data-action="plus";無購買通道的平台才畫)',
    escape.loggedIn === false && escape.n === 1 && /Plus/.test(escape.txt), JSON.stringify(escape));
  ok('G 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
// G10:有購買通道的平台(App)必須維持舊行為——訂閱資格要綁軌島帳號才能跨裝置恢復,所以那條路
// 仍然先登入再開面板。注入 RAIL_PLUS_TEST_ADAPTER 讓 plusConfigured() 轉真(＝App 的
// RAIL_NATIVE_PLUS_ADAPTER 等價物,沿用本檔既有慣例),但刻意不注入 state.account:要驗的正是
// 「未登入時往哪走」。Firebase 用既有的 RAIL_FIREBASE_TEST_MODULES 短路,不打真網路。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'G10');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    window.RAIL_FIREBASE_TEST_MODULES = { initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}), onAuthStateChanged: () => {} };
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {}, getCustomerInfo: async () => ({ entitlements: { active: {} } }),
      getOfferings: async () => ({ all: {}, current: null }), purchase: async () => ({}), restore: async () => ({ entitlements: { active: {} } }),
    };
    const configured = plusConfigured();
    await plusOpen('native-path');
    return {
      configured,
      plusHidden: document.getElementById('plusModal').hidden,
      accountShown: !document.getElementById('accountModal').hidden,
      feats: document.querySelectorAll('.plus-feature').length,
    };
  });
  ok('G10 有購買通道的平台(App)匿名開 Plus → 維持先登入:帳號面板開、Plus 面板仍關、功能清單一項都沒畫',
    r.configured === true && r.plusHidden === true && r.accountShown === true && r.feats === 0, JSON.stringify(r));
  ok('G10 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ T. 「Google 清單匯入」是 App 限定的 Plus 功能:文案這樣寫,實際就必須這樣 ══════════════
// 開閘讓 plusConfigured() 在原生殼恆真,setupTakeoutUi() 的閘門本來就掛在它上面 ⇒ 匯入入口跟著現身,
// 按下去走 plusRequire 進訂閱面板。它是 Plus 功能清單的一項,而付費視窗/terms/說明中心都把它標成
// 「在 App」——那句話是可驗證宣稱,不是修辭,所以在這裡實測兩邊。
// ⚠️「必須看不到」型斷言:同一支可見性探針對同工具列的 #shareBtn 做正向對照,證明它分得出可見與不可見。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'T-web');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const w = await page.evaluate(async () => {
    const vis = el => { if (!el) return false; const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    // 使用者看得到的結果要在「更多」抽屜真的打開之後才量:抽屜列的可見性由 syncMoreSheet() 在
    // 開啟當下依代理鈕重算(index.html 的 syncMoreSheet),開啟前那一格 inline display 只是中間態。
    const fab = document.getElementById('toolsFab') || document.getElementById('tabMore');
    if (fab) fab.click();
    await new Promise(r => setTimeout(r, 350));
    const rowVis = p => { const r = document.querySelector(`.ms-row[data-proxy="${p}"]`); return { exists: !!r, visible: vis(r) }; };
    const out = { plusConfigured: plusConfigured(), accountConfigured: accountConfigured(),
      importVisible: vis(document.getElementById('importBtn')),
      sheetOpen: vis(document.querySelector('.more-sheet')),
      importRow: rowVis('importBtn'), shareRow: rowVis('shareBtn'),
      shareVisible: vis(document.getElementById('shareBtn')) };
    if (fab) fab.click(); // 收回抽屜,不影響後面的量測
    await new Promise(r => setTimeout(r, 200));
    return out;
  });
  ok('T1 網站前置:帳號設定齊備但無購買通道(accountConfigured=true、plusConfigured=false)——否則下一條會為了錯的理由而綠',
    w.accountConfigured === true && w.plusConfigured === false, JSON.stringify(w));
  ok('T2 網站看不到匯入入口(文案標「在 App」的事實面)', w.importVisible === false, `importVisible=${w.importVisible}`);
  ok('T2b 正向對照:同一支可見性探針在同一排工具列上量得到可見的鈕(#shareBtn)', w.shareVisible === true, `shareVisible=${w.shareVisible}`);
  // T3 舊版只斷言 `importRowExists === false`——那是開機當下的中間態,量不到使用者到底看不看得到:
  // 抽屜列就算留著,syncMoreSheet() 在開啟時也會依代理鈕把它設回 display:none。改成量「抽屜真的
  // 打開之後,那一列在畫面上不存在」,並用同一支探針在同一張抽屜裡量到一列可見的鄰居當正向對照。
  ok('T3 網站:「更多」抽屜真的打開後,匯入那一列在畫面上看不到(入口不長出來時不留一列點了靜默無反應的死列)',
    w.sheetOpen === true && w.importRow.visible === false, JSON.stringify(w));
  ok('T3b 正向對照:同一張抽屜、同一支探針量得到一列可見的鄰居(#shareBtn 那列)——證明它不是對整張抽屜都回 false',
    w.shareRow.exists === true && w.shareRow.visible === true, JSON.stringify(w));
  ok('T-web 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'T-native');
  await ctx.addInitScript(NATIVE_INIT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const n = await page.evaluate(async () => {
    const vis = el => { if (!el) return false; const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const fab = document.getElementById('toolsFab') || document.getElementById('tabMore');
    if (fab) fab.click();
    await new Promise(r => setTimeout(r, 350));
    const row = document.querySelector('.ms-row[data-proxy="importBtn"]');
    const other = document.querySelector('.ms-row[data-proxy="shareBtn"]');
    const out = { plusConfigured: plusConfigured(), importVisible: vis(document.getElementById('importBtn')),
      sheetOpen: vis(document.querySelector('.more-sheet')),
      rowExists: !!row, rowVisible: vis(row), otherRowVisible: vis(other),
      rowLabel: row && row.querySelector('span') ? row.querySelector('span').textContent : null };
    if (fab) fab.click();
    await new Promise(r => setTimeout(r, 200));
    return out;
  });
  ok('T4 原生殼(有購買通道)前置:plusConfigured()=true', n.plusConfigured === true, JSON.stringify(n));
  ok('T5 原生殼看得到匯入入口(＝清單裡的這一項真的交得出來,不是只寫在文案裡)', n.importVisible === true, `importVisible=${n.importVisible}`);
  // T6 舊版咬的是開機當下的 inline `row.style.display`,而使用者看到的那格是 syncMoreSheet() 在
  // 抽屜開啟時依代理鈕重算的——複審實測拿掉 setupTakeoutUi 裡那行 `row.style.display=''` 之後,
  // 只有舊 T6 轉紅、手機唯一入口照樣可見可點,證明它守的是沒有可見效果的中間態。改量開啟後的實況。
  ok('T6 原生殼:「更多」抽屜真的打開後,匯入那一列看得到且標成「Google 清單匯入」(手機唯一入口)',
    n.sheetOpen === true && n.rowVisible === true && n.rowLabel === 'Google 清單匯入', JSON.stringify(n));
  ok('T6b 正向對照:同一支探針在同一張抽屜裡也量得到鄰居列可見(#shareBtn 那列)——證明它不是對整張抽屜都回 true',
    n.otherRowVisible === true, JSON.stringify(n));
  // 未訂閱者按下去要被 Plus 閘門攔住(而不是直接開匯入,也不是靜默無反應):走真正的產品點擊
  const clicked = await page.click('#importBtn', { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  const gated = await page.evaluate(() => ({
    takeoutOpen: !document.getElementById('takeoutModal').hidden,
    plusOpen: !document.getElementById('plusModal').hidden,
    accountOpen: !document.getElementById('accountModal').hidden,
  }));
  ok('T7 未訂閱者按匯入 → 被 Plus 閘門導向登入/訂閱,匯入對話框沒有直接開(付費牆真的在,不是只寫在清單裡)',
    clicked === true && gated.takeoutOpen === false && (gated.plusOpen || gated.accountOpen), `點得到=${clicked} ` + JSON.stringify(gated));
  // 反向對照:同一顆鈕在「已訂閱」時必須真的把匯入開出來——否則 T7 的「沒開」可能只是它壞了
  const opened = await page.evaluate(async () => {
    accountClose(); plusClose();
    state.plus = { active: true, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
    document.getElementById('importBtn').click();
    await new Promise(r => setTimeout(r, 250));
    return { takeoutOpen: !document.getElementById('takeoutModal').hidden, plusOpen: !document.getElementById('plusModal').hidden };
  });
  ok('T7b 反向對照:同一顆鈕在已訂閱狀態真的開出匯入對話框(證明 T7 的「沒開」是閘門擋的,不是這條路本身壞了)',
    opened.takeoutOpen === true && opened.plusOpen === false, JSON.stringify(opened));
  ok('T-native 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ N. 手機四寬度:Plus 入口在「更多」抽屜那一列 ══════════════
// ≤900 的 .stage-tools 是 display:none ⇒ 手機唯一入口是抽屜列,桌面那顆工具鈕在手機驗不到東西。
// 本輪新增了可見控件,依全域鐵則做 360/375/414/768 四寬度 × WebKit × 全控件相交掃描 ×
// 多點 elementFromPoint × 375 真觸控端到端。
// ⚠️ 可見性判準刻意不看 opacity:本專案有元素平時就是 opacity:0(閒置淡出、sheet 開啟時的讓位過渡),
//    拿它當過濾條件會把受測對象整個排除掉而全綠。只排 display:none / visibility:hidden,rect 才是真相。
// ⚠️ 幾何不相交只證明「看起來沒疊」:偽元素熱區(::after)被撐大到蓋掉鄰列時,rect 與 computed style
//    兩邊都照不到(心得 33 的病灶)。所以另外橫掃整列 9×3 點,並要求上下鄰列各自命中自己。
const MOBILE_SEL = '.ms-row[data-proxy="accountBtn"]';
const IMPORT_SEL = '.ms-row[data-proxy="importBtn"]';
async function mobilePlusEntry(width, { sel = MOBILE_SEL, label = '軌島 Plus', tag = 'N', native = false } = {}) {
  const { ctx, page } = await newPage(webkitB, { width, height: 780, touch: true });
  const errs = attach(page, `${tag}${width}`);
  if (native) await ctx.addInitScript(NATIVE_INIT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const toolbarHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.stage-tools')).display === 'none');
  await page.tap('#tabMore');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  await page.waitForTimeout(350); // sheet 上滑轉場走完再量
  await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); // 列不存在時讓 b~e 轉紅,不要中止腳本
  await page.waitForTimeout(150);
  const s = await page.evaluate(sel => {
    const vis = el => { const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const overflow = document.documentElement.scrollWidth - window.innerWidth; // 與 target 無關,先算好:找不到列時也要照樣回報
    const target = document.querySelector(sel);
    if (!target || !vis(target)) return { found: false, overflow };
    const tr = target.getBoundingClientRect();
    const self = (el, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
    const topmost = el => { const r = el.getBoundingClientRect(); return self(el, r.left + r.width / 2, r.top + r.height / 2); };
    const controls = [...document.querySelectorAll('button,a[href],input,select,label,[role=button],.ms-row,.tabbar,#randBtn,#nearBtn,#fsFab,.map-actions,.follow-panel')].filter(vis);
    const collisions = [];
    for (const b of controls) {
      if (b === target || target.contains(b) || b.contains(target) || !topmost(b)) continue;
      const br = b.getBoundingClientRect();
      const iw = Math.min(tr.right, br.right) - Math.max(tr.left, br.left);
      const ih = Math.min(tr.bottom, br.bottom) - Math.max(tr.top, br.top);
      if (iw > 1 && ih > 1) collisions.push(`${b.id || b.dataset.proxy || b.className}(${Math.round(iw)}x${Math.round(ih)})`);
    }
    const miss = [];
    for (const fx of [0.06, 0.18, 0.3, 0.42, 0.5, 0.62, 0.74, 0.86, 0.94])
      for (const fy of [0.25, 0.5, 0.75])
        if (!self(target, tr.left + tr.width * fx, tr.top + tr.height * fy)) miss.push(`${fx}/${fy}`);
    const rows = [...document.querySelectorAll('#moreBody .ms-row')].filter(vis);
    const i = rows.indexOf(target);
    const neighbours = [rows[i - 1], rows[i + 1]].filter(Boolean).map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.proxy || el.dataset.act || el.className, self: self(el, r.left + r.width / 2, r.top + r.height / 2) };
    });
    return { found: true, label: (target.querySelector('span') || {}).textContent || '',
      h: Math.round(tr.height), collisions, miss, neighbours, overflow };
  }, sel);
  ok(`${tag}${width}a 手機工具列 .stage-tools 是 display:none(抽屜列是唯一入口,這是後面幾條的前提)`, toolbarHidden === true, `hidden=${toolbarHidden}`);
  ok(`${tag}${width}b 抽屜列存在、可見、標成「${label}」且高度 ≥44px`, s.found === true && s.label === label && s.h >= 44, JSON.stringify(s.found ? { label: s.label, h: s.h } : s));
  ok(`${tag}${width}c 與所有可見控件零相交`, s.found === true && s.collisions.length === 0, (s.collisions || []).join(' | '));
  ok(`${tag}${width}d 橫掃 9×3 點 elementFromPoint 全部命中自己(偽元素熱區沒被別人蓋掉)`, s.found === true && s.miss.length === 0, `未命中 ${(s.miss || []).length} 點:${(s.miss || []).slice(0, 5).join(',')}`);
  ok(`${tag}${width}e 上下鄰列各自命中自己(這一列的熱區沒有撐大吃掉鄰列)`, s.found === true && (s.neighbours || []).every(n => n.self), JSON.stringify(s.neighbours));
  ok(`${tag}${width}f 頁面無橫向溢出`, (s.overflow || 0) <= 1, `overflow=${s.overflow}px`);
  ok(`${tag}${width} 本輪零 pageerror/console.error`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
for (const w of [360, 375, 414, 768]) await mobilePlusEntry(w);
// 同一套掃描套在新公開的「Google 清單匯入」抽屜列上(它是 App 限定,故整段跑在模擬原生殼下)。
for (const w of [360, 375, 414, 768]) await mobilePlusEntry(w, { sel: IMPORT_SEL, label: 'Google 清單匯入', tag: 'NI', native: true });
// N-tap:375 真觸控端到端——點下去要真的開出 Plus 面板,而且這一刻仍然零帳號系統。
// 反向對照(另開一頁,避免狀態污染):同樣手勢點「上一列」不得開出 Plus 面板,證明「開了」是這一列
// 造成的,不是那個區域隨便點都會開(幾何過了不等於接線接對了)。
{
  const { ctx, page } = await newPage(webkitB, { width: 375, height: 780, touch: true });
  const errs = attach(page, 'Ntap');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.tap('#tabMore');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  await page.waitForTimeout(350);
  await page.locator(MOBILE_SEL).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const tapped = await page.tap(MOBILE_SEL, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForSelector('#plusModal:not([hidden])', { timeout: 8000 }).catch(() => {});
  const r = await page.evaluate(() => ({
    plusOpen: !document.getElementById('plusModal').hidden,
    feats: document.querySelectorAll('.plus-feature').length,
    cta: document.querySelectorAll('[data-plus="login"]').length,
    accountUndefined: typeof state.account === 'undefined',
  }));
  ok('N-tap 375 真觸控點抽屜列 → Plus 面板真的開出來(功能項數與 A 段基準一致、登入 CTA 在)',
    tapped === true && r.plusOpen === true && BASELINE_FEATS > 0 && r.feats === BASELINE_FEATS && r.cta === 1,
    `點得到=${tapped} 基準=${BASELINE_FEATS} ` + JSON.stringify(r));
  ok('N-tap 375 開面板這一刻 state.account 仍是 undefined(手機路徑的匿名保證與桌面一致)', r.accountUndefined === true, `accountUndefined=${r.accountUndefined}`);
  ok('N-tap 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await newPage(webkitB, { width: 375, height: 780, touch: true });
  const errs = attach(page, 'Ntap-ctrl');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.tap('#tabMore');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  await page.waitForTimeout(350);
  const prevSel = await page.evaluate(sel => {
    const vis = el => { const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const rows = [...document.querySelectorAll('#moreBody .ms-row')].filter(vis);
    const prev = rows[rows.indexOf(document.querySelector(sel)) - 1];
    return prev ? (prev.dataset.proxy ? `.ms-row[data-proxy="${prev.dataset.proxy}"]` : `.ms-row[data-act="${prev.dataset.act}"]`) : '';
  }, MOBILE_SEL);
  if (prevSel) { // 受測那一列不存在時 prevSel 會是空字串,直接讓下面的斷言以「找不到上一列」轉紅
    await page.locator(prevSel).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.tap(prevSel, { timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(700);
  const stillHidden = await page.evaluate(() => document.getElementById('plusModal').hidden);
  ok('N-tap 反向對照:同樣手勢點上一列不會開出 Plus 面板(證明上一條的「開了」是這一列接的線)',
    !!prevSel && stillHidden === true, `上一列=${prevSel} plusModal.hidden=${stillHidden}`);
  ok('N-tap 反向對照 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
// NI-tap:匯入抽屜列的 375 真觸控端到端(模擬原生殼)。同一頁跑兩種資格狀態:未訂閱要被閘門攔下、
// 已訂閱要真的開出匯入對話框——後者是前者的反向對照,少了它,「沒開」也可能只是這條路整個壞掉。
// 這一列在網站曾是一條點了靜默無反應的死列(既有缺陷),所以「點下去有反應」本身就是要驗的東西。
{
  const { ctx, page } = await newPage(webkitB, { width: 375, height: 780, touch: true });
  const errs = attach(page, 'NItap');
  await ctx.addInitScript(NATIVE_INIT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.tap('#tabMore');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  await page.waitForTimeout(350);
  await page.locator(IMPORT_SEL).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const tapped = await page.tap(IMPORT_SEL, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(700);
  const r1 = await page.evaluate(() => ({
    takeoutOpen: !document.getElementById('takeoutModal').hidden,
    plusOpen: !document.getElementById('plusModal').hidden,
    accountOpen: !document.getElementById('accountModal').hidden,
    sheetClosed: !document.body.classList.contains('tools-open'),
  }));
  ok('NI-tap 375 真觸控點匯入抽屜列 → 真的有反應(未訂閱被 Plus 閘門導向登入/訂閱,匯入對話框沒直接開)',
    tapped === true && r1.takeoutOpen === false && (r1.plusOpen || r1.accountOpen), `點得到=${tapped} ` + JSON.stringify(r1));
  // 兩段之間先把三張浮層都關掉再重開抽屜:閘門若被改壞(突變 MJ),第一段會直接開出匯入對話框,
  // 它會攔截後續的 tap 讓整支腳本在這裡逾時中止——後面的 H/I/P/Z0 就全部靜默不跑了。
  const r2 = await page.evaluate(async () => {
    accountClose(); plusClose(); takeoutClose();
    state.plus = { active: true, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
    return { ready: true };
  });
  await page.tap('#tabMore', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(350);
  await page.locator(IMPORT_SEL).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const tapped2 = await page.tap(IMPORT_SEL, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  const r3 = await page.evaluate(() => ({ takeoutOpen: !document.getElementById('takeoutModal').hidden }));
  ok('NI-tap 反向對照:同一列在已訂閱狀態下真的把匯入對話框點得開(證明上一條的「沒開」是閘門擋的)',
    r2.ready === true && tapped2 === true && r3.takeoutOpen === true, `點得到=${tapped2} ` + JSON.stringify(r3));
  ok('NI-tap 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ H. accountSyncNow 的 Plus 資格閘門(2026-08-02 心得35:沒有牙的判準等於沒驗) ══════════════
// 注入一個已登入但 state.plus.active=false 的假帳號,呼叫 accountSyncNow('manual')。
// 用 a.fb.doc 是否被呼叫到(syncAttempted)當唯一可信訊號——不能只看回傳值:gate 拿掉後,
// 程式會往下走進 try 呼叫 a.fb.doc,stub 丟例外,accountSyncNow 自己的 catch 一樣會把它接成
// return false,回傳值在兩種情況下都是 false,無法區分「閘門擋下」與「閘門被拿掉但半路失敗」。
// 突變測試紀錄(手動執行,不留在腳本內):暫時把 index.html 的
// `if (!reason.startsWith('logout') && !(state.plus && state.plus.active)) return false;` 整行註解掉、
// 重跑本腳本 → H1 轉 FAIL(syncAttempted=true);還原後重跑 → H1 轉回 PASS。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'H');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    let syncAttempted = false;
    state.plus = { active: false };
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '',
      user: { uid: 'test-uid-h', email: 'gate-test@example.com' },
      db: {}, // 只需 truthy,通過 accountSyncNow 開頭的 !a.db 檢查
      fb: {
        doc: () => { syncAttempted = true; throw new Error('gate 應該擋在這之前,不該呼叫到 Firestore SDK'); },
        runTransaction: () => { syncAttempted = true; throw new Error('gate 應該擋在這之前,不該呼叫到 Firestore SDK'); },
        serverTimestamp: () => 0,
      },
    };
    const result = await accountSyncNow('manual');
    return { result, syncAttempted };
  });
  ok('H1 未訂閱時 accountSyncNow 回 false 且未觸碰 Firestore(資格閘門有牙)', r.result === false && r.syncAttempted === false,
    `result=${r.result} syncAttempted=${r.syncAttempted}`);
  ok('H 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ I. Step 4/6 修正輪(2026-08-02 複審 finding):冷啟動資格 bootstrap ＋ logout-legacy 不被閘門擋下 ══════════════
// I1/I2:全新訪客(localStorage 空)——setupAccountUi 應該走 btn.remove() 那條,state.account 全程
// undefined、零 Firebase 網路請求。免費層「完全匿名」的保證不能因為補了 returning 分支而破功。
// I3:回訪使用者(localStorage 帶 trainmap-last-sync-uid)——setupAccountUi 的新 returning 條件要讓
// accountEnsureInit 開機就真的跑完(state.account.ready 轉真),不必等使用者先點過 Plus/帳號入口。
//
// ⚠️ I2 是「數量必須為 0」型斷言,而這種斷言在收集器根本沒收到東西時會無條件通過
//    ——regex 寫錯、Firebase 換 CDN 主機、listener 掛太晚,全都會讓它變成永遠的假綠。
//    所以 I2b 是它的正向對照:同一支 collectFirebaseReqs(共用同一條 regex,不可能漂移),
//    在回訪情境下必須抓到 >0 筆。兩條合起來才證明「零」是真的零,不是收集器壞了。
//    (collectFirebaseReqs 的定義已上移到 section G 之前——G 的兩段式登入也用同一支,
//     兩節共用一條 regex 才不會各自漂移成兩套判準。)
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'I-fresh');
  const firebaseReqs = collectFirebaseReqs(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(1500); // 給任何遲滯的非同步初始化一點時間,才能有把握斷言「沒發生」
  const accountUndefined = await page.evaluate(() => typeof state.account === 'undefined');
  ok('I1 全新訪客開機後 state.account 仍是 undefined(免費層完全匿名不因 returning 分支破功)', accountUndefined,
    `state.account ${accountUndefined ? '仍是 undefined' : '已被建立(不該發生)'}`);
  ok('I2 全新訪客開機零 Firebase 網路請求', firebaseReqs.length === 0, firebaseReqs.slice(0, 3).join(' | '));
  ok('I 全新訪客本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'I-returning');
  const firebaseReqs = collectFirebaseReqs(page); // I2 的正向對照,見上方註解
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-last-sync-uid', 'test-returning-uid'); } catch (e) {} });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const readyOk = await page.waitForFunction(() => state.account && state.account.ready === true, null, { timeout: 15000 })
    .then(() => true).catch(() => false);
  ok('I3 回訪使用者(留有 last-sync-uid)開機 accountEnsureInit 真的有跑(state.account.ready 轉真,不必先點過 Plus/帳號入口)',
    readyOk, `ready=${readyOk}`);
  // I3b/I3c:回訪／已登入者的帳號入口「真的看得見」。
  // #accountBtn 的 HTML 預設是 inline display:none、抽屜列也是,accountEnsureInit() 裡那一行
  // accountBtnSlot(...) 把工具列鈕的 inline none 還原——把它拿掉,回訪者的帳號入口整個消失,
  // 而在補這兩條之前,整套判準一條都不會紅(2026-08-02 複審實測)。
  // I3c 量的是**抽屜真的打開之後**那一列在畫面上的可見性:抽屜列的 inline display 由
  // syncMoreSheet() 在開啟當下依代理鈕重算,開啟前那一格只是中間態(舊版咬在中間態上,
  // 2026-08-03 複審實測那一行對使用者看得到的結果沒有影響)。
  // 這裡刻意只驗「看得見」不驗標籤:本情境的 uid 是假的,Firebase 不會給出真的 user,
  // 標籤會停在登出態該有的樣子(見 accountSlotMode),驗標籤等於把測試綁在一個與本條無關的分支上。
  const slot = await page.evaluate(async () => {
    const vis = el => { if (!el) return false; const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const btn = document.getElementById('accountBtn');
    const out = { btnExists: !!btn, btnVisible: vis(btn), btnInline: btn ? btn.style.display : null,
      shareVisible: vis(document.getElementById('shareBtn')) };
    const fab = document.getElementById('toolsFab') || document.getElementById('tabMore');
    if (fab) fab.click();
    await new Promise(r => setTimeout(r, 350));
    const row = document.querySelector('.ms-row[data-proxy="accountBtn"]');
    out.sheetOpen = vis(document.querySelector('.more-sheet'));
    out.rowExists = !!row;
    out.rowVisible = vis(row);
    out.otherRowVisible = vis(document.querySelector('.ms-row[data-proxy="shareBtn"]'));
    if (fab) fab.click();
    await new Promise(r => setTimeout(r, 200));
    return out;
  });
  ok('I3b 回訪使用者的工具列帳號入口真的可見(#accountBtn 的 inline display:none 有被還原)',
    slot.btnVisible === true, JSON.stringify(slot));
  ok('I3c 回訪使用者:「更多」抽屜真的打開後,帳號那一列在畫面上可見(手機唯一入口)',
    slot.sheetOpen === true && slot.rowVisible === true, JSON.stringify(slot));
  ok('I3d 正向對照:同一張抽屜、同一支可見性探針量得到一列可見的鄰居(#shareBtn 那列)',
    slot.otherRowVisible === true, JSON.stringify(slot));
  ok('I2b 正向對照:同一支收集器在回訪情境下抓得到 Firebase 請求(證明 I2 的「零」不是收集器壞掉)',
    firebaseReqs.length > 0, `抓到 ${firebaseReqs.length} 筆${firebaseReqs.length ? ':' + firebaseReqs[0] : ''}`);
  ok('I 回訪使用者本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// I4:accountSyncNow('logout-legacy') 不被資格閘門擋下,即使使用者未訂閱——Firestore rules 尚未放行新
// collection 時,accountSyncNow 的 catch 會遞迴呼叫 accountSyncNow(reason+'-legacy') 重試;若閘門用
// 字串嚴格比對 `reason !== 'logout'`,重試時 reason 已經是 'logout-legacy' 不等於 'logout',會被誤擋,
// 而 accountSignOut() 之後仍會無條件 accountClearLocal() 清本機——最後一次回寫沒完成就清本機＝真的掉資料。
// 用 a.fb.doc 是否被呼叫到(syncAttempted)當判準,不是回傳值:兩種情況(被擋/沒被擋但半路故意失敗)
// 回傳值都是 false,只有「有沒有嘗試碰 Firestore」能分辨(手法同 H)。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'I4');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    let syncAttempted = false;
    state.plus = { active: false }; // 刻意未訂閱:若閘門誤判把 logout-legacy 也擋下,syncAttempted 會維持 false
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '',
      user: { uid: 'test-uid-i4', email: 'legacy-test@example.com' },
      db: {},
      fb: {
        doc: () => { syncAttempted = true; throw new Error('探針:只需知道有沒有被呼叫到,不需要真的接 Firestore'); },
        runTransaction: () => { syncAttempted = true; throw new Error('探針:只需知道有沒有被呼叫到,不需要真的接 Firestore'); },
        serverTimestamp: () => 0,
      },
    };
    const result = await accountSyncNow('logout-legacy');
    return { result, syncAttempted };
  });
  ok(`I4 未訂閱使用者的 accountSyncNow('logout-legacy') 不被資格閘門擋下(有嘗試碰 Firestore)`, r.syncAttempted === true,
    `result=${r.result} syncAttempted=${r.syncAttempted}`);
  ok('I4 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ P. 雲端同步成功鏈(2026-08-02 Plus 開賣 Task 6b 補 P1/P2)══════════════
// H/I4 的 Firestore stub 只探測「有沒有呼叫到 SDK」(doc/runTransaction 直接 throw),驗資格
// 閘門夠了,但驗不到「刪光整段 transaction/merge/寫回」這種靜默失效——閘門通過後往下走,stub
// 一樣拋例外,accountSyncNow 自己的 catch 一樣接成 return false,回傳值在「閘門擋下」與「閘門
// 沒擋但實作被刪光」兩種情況下沒有差異。這裡升級成「會記錄」的假 Firestore:tx.get 回傳可控的
// 雲端文件、tx.set 把寫入內容記下來,斷言直接看「寫進去的 kind/items/revision」,以及
// 「本機原本沒有、雲端有的那一筆,同步後出現在本機」——這是 merge 真的跑過的證據,不是猜的。

// P1:真的呼叫產品的收藏函式(toggleFav,不直接寫 localStorage),斷言 rail-user-data-changed
// 監聽器真的把 accountScheduleSync 排程出去。監聽器只認事件 source、不看是否登入(登入檢查在
// accountScheduleSync 內部才做),故不需要注入 state.account.user——直接量監聽器有沒有把呼叫
// 轉出去(蓋掉 accountScheduleSync 本身當 spy,不call through:這裡只驗「排程」這個動作本身,
// 不需要它真的跑完一輪同步)。accountScheduleSync 全站只有這一個呼叫點(grep 確認),故這是
// 監聽器是否還在的乾淨訊號,不是碰巧被別的路徑觸發。
// ⚠️ 這個監聽器是 accountEnsureInit() 內部才註冊的一行(ACCOUNT_ENABLED=false 時開機預設不會
// 自動跑到那裡,見 setupAccountUi 的分流)——第一輪直接測 calls=0,不是監聽器被拔掉,是根本沒
// 註冊過。改用 RAIL_FIREBASE_TEST_MODULES(既有的 accountLoadModules 短路點,同檔 6838 行)
// 塞假 SDK,讓 accountEnsureInit() 不打真網路也能跑完、把監聽器掛上去,再測 toggleFav。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'P1');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}), onAuthStateChanged: () => {},
    };
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    await accountEnsureInit(); // 掛上 rail-user-data-changed 監聽器(見上方註解),不驗登入本身
    let calls = 0;
    window.accountScheduleSync = () => { calls++; }; // 蓋掉真身,只量「監聽器有沒有把事件轉呼叫出去」
    const tr = state.trains.find(t => t.sys === 'tra_sched' && !t.loop) || state.trains[0];
    toggleFav(tr); // 產品的收藏函式:內部 userDataSaveCollection→userDataNotify('local')→派 rail-user-data-changed
    return { calls, trainNo: tr && String(tr.train) };
  });
  ok('P1 加入最愛(產品函式 toggleFav)後,rail-user-data-changed 監聽器把 accountScheduleSync 排程出去', r.calls === 1,
    `calls=${r.calls} train=${r.trainNo}`);
  ok('P1 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// P2:升級 Firestore stub 為「會記錄」的假雲端——tx.get 回傳可控的雲端文件、tx.set 記錄寫入
// 內容;斷言看寫進去的 kind/items/revision,以及「本機原本沒有、雲端有的那一筆,同步後出現在
// 本機」。本機先用 toggleFav() 建一筆 local-only 收藏,雲端 favs 文件塞一筆 local 沒有的
// cloud-only 收藏,revision 刻意給 5(遠高於本機剛建立的 1)讓 revision 斷言有牙。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'P2');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    const localTr = state.trains.find(t => t.sys === 'tra_sched' && !t.loop) || state.trains[0];
    toggleFav(localTr); // 產品函式,不直接寫 localStorage
    const localNo = String(localTr.train);
    const CLOUD_NO = '__CLOUD_ONLY_TRAIN__';
    const cloudFavsDoc = {
      version: 1, kind: 'favs', revision: 5, clientUpdatedAt: Date.now(),
      items: [{ id: CLOUD_NO, value: { train: CLOUD_NO, label: '雲端獨有收藏' }, updatedAt: Date.now() }],
      tombstones: [],
    };
    const writes = [];
    const fb = {
      doc: (db, ...segs) => ({ kind: segs[segs.length - 1] }),
      runTransaction: async (db, fn) => {
        const tx = {
          get: async (ref) => { const d = ref.kind === 'favs' ? cloudFavsDoc : null; return { exists: () => !!d, data: () => d }; },
          set: (ref, data) => { writes.push({ kind: ref.kind, data }); },
        };
        return fn(tx);
      },
      serverTimestamp: () => 'SERVER_TIME_STUB',
    };
    state.plus = { active: true, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null }; // 雲端同步是 Plus 功能,不訂閱會被資格閘門擋在 transaction 之前
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '',
      user: { uid: 'test-uid-p2', email: 'p2-test@example.com' },
      db: {}, fb,
    };
    const result = await accountSyncNow('manual');
    const favsWrite = writes.find(w => w.kind === 'favs');
    const afterFavs = loadFavs(); // 同步完成後重讀本機收藏(走產品的讀取函式,不直接讀 localStorage)
    return {
      result, writeKinds: writes.map(w => w.kind).sort(),
      favsWrite, localNo,
      afterHasCloud: afterFavs.some(f => f.train === CLOUD_NO),
      afterHasLocal: afterFavs.some(f => f.train === localNo),
    };
  });
  ok('P2a accountSyncNow 回傳成功', r.result === true, `result=${r.result}`);
  ok('P2b 四個 kind 都呼叫了 tx.set(pins/favs/rides/stations)', JSON.stringify(r.writeKinds) === JSON.stringify(['favs', 'pins', 'rides', 'stations']),
    `writeKinds=${JSON.stringify(r.writeKinds)}`);
  ok('P2c favs 寫入內容同時含本機那筆與雲端那筆(真的合併,不是只挑一邊)',
    !!r.favsWrite && r.favsWrite.data.items.some(x => x.id === r.localNo) && r.favsWrite.data.items.some(x => x.id === '__CLOUD_ONLY_TRAIN__'),
    JSON.stringify(r.favsWrite && r.favsWrite.data.items.map(x => x.id)));
  ok('P2d revision = max(本機,雲端)+1(=6,雲端給的是5、本機剛建立是1)', !!r.favsWrite && r.favsWrite.data.revision === 6,
    `revision=${r.favsWrite && r.favsWrite.data.revision}`);
  ok('P2e 本機原本沒有、雲端有的那一筆,同步後出現在本機(merge 真的跑過,不是空轉)', r.afterHasCloud === true,
    `afterHasCloud=${r.afterHasCloud}`);
  ok('P2f 本機原本那一筆同步後仍在(合併不是覆蓋)', r.afterHasLocal === true, `afterHasLocal=${r.afterHasLocal}`);
  ok('P2 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ HP. 使用說明中心:新功能必加一節,且不得把付費內容講成免費 ══════════════
// 說明中心是「說明的唯一來源」,也是使用者在決定要不要付錢時會讀到的地方之一——
// 它把 Plus 內容寫成無條件可用,就跟付費視窗寫錯是同一類問題。
// HP2 是「全稱斷言」(每一句提到 90 天的都要標 Plus),所以配 HP2a 證明收集器真的抓得到句子:
// 收集器抓不到任何一句時,全稱斷言會空過成永遠的綠燈。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'HP');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const h = await page.evaluate(() => {
    renderHelp();
    const body = document.getElementById('helpBody');
    const plusSec = body.querySelector('.help-sec[data-sec="plus"]');
    // 全站說明文字裡每一句提到「90 天」的,逐句檢查有沒有標明需要 Plus
    const lines = [...body.querySelectorAll('li, p')].map(el => el.textContent || '');
    const d90 = lines.filter(t => /90\s*天/.test(t));
    return {
      secs: [...body.querySelectorAll('.help-sec')].map(s => s.dataset.sec),
      hasPlusSec: !!plusSec,
      plusText: plusSec ? (plusSec.textContent || '') : '',
      n90: d90.length,
      bad90: d90.filter(t => !/Plus/.test(t)),
      // 舊的「儲存地點」那節也提到匯入(App 限定的 Plus 功能),同樣不得寫成無條件可用
      pinText: (body.querySelector('.help-sec[data-sec="pin"]') || {}).textContent || '',
    };
  });
  ok('HP1 說明中心有 Plus 專節,且講清楚在哪買、網站怎麼接資格',
    h.hasPlusSec === true && /App/.test(h.plusText) && /登入/.test(h.plusText) && /誤點履歷/.test(h.plusText),
    `hasPlusSec=${h.hasPlusSec} secs=${JSON.stringify(h.secs)}`);
  ok('HP2a 正向對照:收集器真的抓得到提到「90 天」的說明句(否則 HP2b 是空過的全稱斷言)',
    h.n90 >= 1, `抓到 ${h.n90} 句`);
  ok('HP2b 每一句提到「90 天」的說明都標明需要 Plus(不把付費內容講成免費)',
    h.bad90.length === 0, h.bad90.slice(0, 2).join(' | '));
  ok('HP3 「儲存地點」那節提到的 Google 清單匯入標明了 App 與 Plus(它是 App 限定的 Plus 功能)',
    /匯入/.test(h.pinText) && /App/.test(h.pinText) && /Plus/.test(h.pinText), h.pinText.slice(0, 120));
  ok('HP 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ CL. 更新紀錄兩層結構:第一層是檢視,第二層才是正本 ══════════════
// 2026-08-03 的實際缺陷:為了把第一層維持在 8 條,擠掉了最舊的一條(8/1 衛星計費),
// 但那條的正本並不存在——第二層只有一句夾在 7/25 條目裡、日期對不上的附帶說明。
// 擠掉它＝刪掉那次變更唯一一筆可辨識的對外紀錄,而且當時沒有任何判準會發現。
//
// 判準寫「配對關係」不寫字面值:第一層每條用 data-cl-of 指向第二層某條的 data-cl。
// 刻意不用「日期＋文字相似度」去猜配對——實測現有 8 條的最長共同子字串最低只有 8 個字,
// 門檻設在那裡等於零餘裕,改個措辭就假紅(而且正是「日期對不上」那種缺陷最會漏掉的形狀)。
// 明示的 id 對映沒有門檻、沒有會漂移的量,而且「要離開第一層,正本必須先存在」這條紀律
// 變成寫得出來的東西:指向不存在的 id 會當場紅。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'CL');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const cl = await page.evaluate(() => {
    const recent = document.querySelector('.foot-recent');
    const more = document.querySelector('.foot-more');
    if (!recent || !more) return { fatal: `recent=${!!recent} more=${!!more}` };
    // li.grp 是分組標題不是內容(第一層有一顆「最近更新」,第二層每個主題組各一顆)
    const top = [...recent.querySelectorAll(':scope > li:not(.grp)')];
    const canon = [...more.querySelectorAll('li[data-cl]')];
    const canonIds = canon.map(li => li.dataset.cl);
    const txt = li => (li.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      topCount: top.length,
      grpCount: recent.querySelectorAll(':scope > li.grp').length,
      canonCount: canon.length,
      dupIds: canonIds.filter((id, i) => canonIds.indexOf(id) !== i),
      // 每條第一層:有沒有宣告正本、宣告的正本在不在第二層、那條正本有沒有被歸進某個主題組
      rows: top.map(li => {
        const of = li.dataset.clOf || '';
        const hit = of ? more.querySelector(`li[data-cl="${CSS.escape(of)}"]`) : null;
        return { of, found: !!hit, text: txt(li).slice(0, 24) };
      }),
    };
  });
  ok('CL0 正向對照:收集器真的抓到第一層條目與第二層正本(否則下面兩條全稱斷言是空過的)',
    !cl.fatal && cl.topCount >= 1 && cl.canonCount >= 1, JSON.stringify({ top: cl.topCount, canon: cl.canonCount, fatal: cl.fatal }));
  ok('CL1 第一層每一條都在第二層有正本(data-cl-of → data-cl 找得到;要擠出第一層,正本必須先存在)',
    !cl.fatal && cl.rows.length > 0 && cl.rows.every(r => r.of && r.found),
    JSON.stringify((cl.rows || []).filter(r => !r.of || !r.found)) || '(全數對上)');
  ok('CL1b 第二層的正本 id 不重複(重複＝兩條互相蓋掉,對映會指到哪條無法預期)',
    !cl.fatal && cl.dupIds.length === 0, JSON.stringify(cl.dupIds));
  // 8 是專案自己訂的版面上限(不是量出來的值);li.grp 標題不計入,否則加一個分組標題就會被誤判超量
  ok('CL2 第一層內容條目不超過 8 條(li.grp 標題不算)',
    !cl.fatal && cl.topCount <= 8, `內容=${cl.topCount} 標題=${cl.grpCount}`);
  ok('CL 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ KS. 止血旗標關得掉嗎(PLUS_ENABLED=false 時所有 Plus 觸發面都要消失) ══════════════
// 這條旗標存在的意義就是「要用的時候真的關得掉」,但它此前有一個反直覺的洞:帳號面板登出態那顆
// 「先看看軌島 Plus 有什麼」的條件是 `plusProjectConfigured() && !plusConfigured()`,而只有
// plusConfigured() 吃 PLUS_ENABLED ⇒ 旗標一關,`!plusConfigured()` 反轉成 true,鈕反而被「打開」。
// plusOpen() 本身也沒有守衛。修法是讓 plusProjectConfigured() 與 plusOpen() 也吃這條旗標。
//
// 🔴 這一段全是「必須不存在」型斷言,單獨跑等於用沉默當證據。所以旗標關閉態與開啟態走的是
//    同一支 collect(),開啟態那幾條就是它的正向對照:同一支收集器在旗標開著時必須抓得到那些鈕
//    與那張面板。收集器若壞掉(選擇器打錯、面板改名),正向對照會先紅,而不是讓關閉態假綠。
//    ⚠️ 正向對照刻意用「原生殼」情境:登出態那顆鈕在無購買通道的平台本來就會出現(兩段式登入的
//    設計),拿它當對照分不出「旗標關掉了」與「這個平台本來就沒有」。原生殼下 plusConfigured()
//    為真 ⇒ 登出態不畫那顆鈕、已登入態才畫,兩個狀態各有一個明確的期望值。
{
  const collect = async page => {
    // (a0) 工具列槽位與它的抽屜列——最先量,因為下面就要開帳號面板把畫面蓋掉。
    // 為什麼非量不可:這是網站與手機上**最先看到**的 Plus 觸發面(手機 .stage-tools 是 display:none,
    // 抽屜列是唯一入口)。此前 KS 只量帳號面板與 plusOpen(),複審實測拿掉 setupAccountUi() 的
    // `if (PLUS_ENABLED)` ⇒ 旗標關閉時工具列仍長出一顆標著「Plus」的鈕,而 plusOpen() 已被守衛擋住
    // ⇒ 按下去靜默無反應,整支卻 193/193 全綠。止血旗標的意義是「所有觸發面都關得掉」,
    // 只驗其中三個等於沒驗到這一條(index.html 自己也寫著「留著一顆點了沒有任何去處的鈕比沒有更糟」)。
    const slot = await page.evaluate(async () => {
      const vis = el => { if (!el) return false; const st = getComputedStyle(el), r = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const btn = document.getElementById('accountBtn');
      const o = {
        btnVisible: vis(btn),
        btnLabel: btn && btn.querySelector('.tl') ? btn.querySelector('.tl').textContent.trim() : null,
        btnTitle: btn ? (btn.getAttribute('title') || '') : null,
      };
      // 抽屜列一律等抽屜真的打開才量(syncMoreSheet() 在開啟當下依代理鈕重算那一格)
      const fab = document.getElementById('toolsFab') || document.getElementById('tabMore');
      if (fab) fab.click();
      await new Promise(r => setTimeout(r, 350));
      const row = document.querySelector('.ms-row[data-proxy="accountBtn"]');
      o.sheetOpen = vis(document.querySelector('.more-sheet'));
      o.rowVisible = vis(row);
      o.rowLabel = row && row.querySelector('span') ? row.querySelector('span').textContent.trim() : null;
      o.otherRowVisible = vis(document.querySelector('.ms-row[data-proxy="shareBtn"]'));
      if (fab) fab.click();
      await new Promise(r => setTimeout(r, 200));
      // 行程分享發起端也是 Plus 觸發面,而它的顯示由 ?tripshare=1 這條開發通道點亮(可被轉貼)。
      // 兩次載入都帶著那個參數,才量得到「旗標關閉時這條通道還會不會長出鈕」。
      o.tripShareVisible = (() => { try { return tripShareVisible(); } catch (e) { return 'err'; } })();
      return o;
    });
    // (a) 登出態帳號面板:強制進入 ready 且無 user 的分支(否則停在「正在讀取登入狀態…」什麼都量不到)
    const out = await page.evaluate(() => {
      const q = sel => !!(document.getElementById('accountBody') || {}).querySelector?.(sel);
      try { accountEnsureInit && accountEnsureInit(); } catch (e) {}
      try { accountOpen && accountOpen(); } catch (e) {}
      try { if (!state.account) state.account = {}; state.account.ready = true; state.account.user = null; state.account.error = ''; accountRender(); } catch (e) {}
      const loggedOutPlusBtn = q('[data-action="plus"]');
      // (b) 已登入態帳號面板
      try {
        state.account.user = { uid: 'ks', displayName: '測試', email: 'ks@example.invalid', providerData: [{ providerId: 'google.com' }] };
        state.account.db = {}; state.account.actionError = '';
        accountRender();
      } catch (e) {}
      const body = document.getElementById('accountBody');
      // Plus 狀態列判定取「結構」不取自由文字:已登入態另有一句「訂閱軌島 Plus 才會同步」的
      // 同步提示,拿 textContent 比對「軌島 Plus」會把那句話也算成狀態列(第一版實測誤判)。
      // 真正的狀態列是一個 .account-syncbox,其 <b> 恰為「軌島 Plus」。
      const syncBoxes = [...(body ? body.querySelectorAll('.account-syncbox') : [])]
        .map(el => (el.querySelector('b') || {}).textContent || '');
      return {
        loggedOutPlusBtn,
        loggedInPlusBtn: q('[data-action="plus"]'),
        loggedInSyncBoxes: syncBoxes,
        loggedInPlusStatusRow: syncBoxes.some(t => t.trim() === '軌島 Plus'),
        flag: (() => { try { return PLUS_ENABLED; } catch (e) { return 'ReferenceError'; } })(),
      };
    });
    // (c) Plus 面板可達性:走真正的函式,不是只看鈕在不在
    const panel = await page.evaluate(async () => {
      try { accountClose && accountClose(); } catch (e) {}
      try { await plusOpen('ks-probe'); } catch (e) { return { threw: String(e) }; }
      await new Promise(r => setTimeout(r, 350));
      const m = document.getElementById('plusModal'), b = document.getElementById('plusBody');
      return { modalOpen: m ? !m.hidden : null, feats: b ? b.querySelectorAll('.plus-feature').length : -1 };
    });
    return { ...out, ...panel, slot };
  };
  const run = async (base, tag) => {
    const { ctx, page } = await newPage(chromiumB);
    const errs = attach(page, `KS-${tag}`);
    await ctx.addInitScript(NATIVE_INIT); // 原生殼:plusConfigured() 為真,才分得出「旗標關掉」與「這個平台本來就沒有購買通道」
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const r = await collect(page);
    await ctx.close();
    return { r, errs };
  };
  // 兩邊都帶 ?tripshare=1:那是行程分享發起端的開發通道,不帶就量不到 KS8 要守的那條路徑
  const on = await run(`${BASE}?tripshare=1`, 'on');
  const off = await run(`http://localhost:${PORT}/index.html?__flagoff=1&tripshare=1`, 'off');
  // 🔴 第三次載入:accountEnsureInit() **有跑**、但 accountReturning() 為 false 的那條路。
  // 為什麼非它不可(實測結論,與直覺相反):accountSlotMode() 的 `if (!PLUS_ENABLED) return 'account'`
  // 在「回訪者」情境下**不是 load-bearing**——那一行拿掉之後,fallthrough 的
  // `accountReturning() ? 'account' : 'plus'` 對回訪者照樣回 'account',槽位一模一樣(實測驗證)。
  // 它唯一撐著的是「初始化跑了、但這台裝置沒登入過」那格,而現在只有兩條路走得到:
  // `ACCOUNT_ENABLED=true`(帳號入口復活批次,尚未發生)與 `?account=delete`(帳號刪除深連結,現在就走得到)。
  // 用後者當代理,那一行就從「無人看守」變成有判準——不必等旗標翻真才發現它已經壞了。
  const offInit = await run(`http://localhost:${PORT}/index.html?__flagoff=1&tripshare=1&account=delete`, 'off-init');
  // 前置:替換真的生效了。沒有這條,伺服器一旦找不到宣告字串(改寫、加空白),下面每一條都會在
  // 「旗標其實是開的」的頁面上量,而且量出來的「不存在」還是綠的——正是本 brief 警告的假綠形狀。
  ok('KS0 前置:?__flagoff=1 供應的頁面現讀 PLUS_ENABLED === false(替換真的生效)', off.r.flag === false, `off.flag=${off.r.flag}`);
  ok('KS0 前置:預設網址現讀 PLUS_ENABLED === true(對照組真的是開啟態)', on.r.flag === true, `on.flag=${on.r.flag}`);
  // 正向對照(旗標開啟,原生殼)——證明同一支 collect() 真的抓得到這三個東西
  ok('KS1 正向對照:旗標開啟時同一支收集器抓得到 Plus 面板(開得起來且畫得出功能項)',
    on.r.modalOpen === true && on.r.feats > 0, JSON.stringify(on.r));
  ok('KS2 正向對照:旗標開啟時同一支收集器抓得到已登入態帳號面板的 Plus 入口與 Plus 狀態列',
    on.r.loggedInPlusBtn === true && on.r.loggedInPlusStatusRow === true, JSON.stringify(on.r));
  // 工具列槽位的正向對照:同一支 slot 收集器在旗標開著時,必須抓得到一顆標成 Plus 的鈕與抽屜列。
  // 沒有這兩條,下面 KS6/KS7 的「不是 Plus 入口」可能只是收集器根本沒在看(選擇器打錯／改名)。
  ok('KS1b 正向對照:旗標開啟時同一支槽位收集器抓得到標成「Plus」的工具列鈕',
    on.r.slot.btnVisible === true && on.r.slot.btnLabel === 'Plus' && /Plus/.test(on.r.slot.btnTitle || ''),
    JSON.stringify(on.r.slot));
  ok('KS2b 正向對照:旗標開啟時抽屜真的打開後,那一列可見且標成「軌島 Plus」',
    on.r.slot.sheetOpen === true && on.r.slot.rowVisible === true && on.r.slot.rowLabel === '軌島 Plus',
    JSON.stringify(on.r.slot));
  // 關閉態:必須全部消失
  ok('KS3 旗標關閉:plusOpen() 打不開 Plus 面板(深連結與既有呼叫點都摸不到那張畫面)',
    off.r.modalOpen === false && off.r.feats === 0, JSON.stringify(off.r));
  ok('KS4 旗標關閉:帳號面板登出態沒有任何通往 Plus 的鈕(關掉旗標不得反而把它打開)',
    off.r.loggedOutPlusBtn === false, JSON.stringify(off.r));
  ok('KS5 旗標關閉:帳號面板已登入態沒有 Plus 入口鈕,也不出現 Plus 狀態列',
    off.r.loggedInPlusBtn === false && off.r.loggedInPlusStatusRow === false, JSON.stringify(off.r));
  // KS6/KS7 判的是「這個槽位是不是 Plus 入口」,不是「這顆鈕在不在」——槽位本身有兩種合法身分
  // (Plus 入口／帳號入口),旗標關閉時它可以整顆消失(免費匿名),也可以留下來當帳號入口(回訪者)。
  // 寫成「不得存在」會把後者判成缺陷,寫成身分才問對問題:關閉態不准有任何標著 Plus 的觸發面。
  ok('KS6 旗標關閉:工具列槽位不是 Plus 入口(不得留下一顆標著 Plus、按下去卻被守衛擋掉的死鈕)',
    !(off.r.slot.btnVisible && /Plus/.test(`${off.r.slot.btnLabel || ''}${off.r.slot.btnTitle || ''}`)),
    JSON.stringify(off.r.slot));
  ok('KS7 旗標關閉:「更多」抽屜打開後,那一列也不是 Plus 入口(手機唯一入口,不能只關桌面那顆)',
    off.r.slot.sheetOpen === true && !(off.r.slot.rowVisible && /Plus/.test(off.r.slot.rowLabel || '')),
    JSON.stringify(off.r.slot));
  ok('KS2c 正向對照:旗標開啟且帶 ?tripshare=1 時,行程分享發起端入口本來就會亮(證明 KS8 的 false 不是參數沒吃到)',
    on.r.slot.tripShareVisible === true, `on=${on.r.slot.tripShareVisible}`);
  ok('KS8 旗標關閉:?tripshare=1 這條開發通道也不再點亮行程分享發起端(URL 參數可被轉貼,不能變成公開後門)',
    off.r.slot.tripShareVisible === false, `off=${off.r.slot.tripShareVisible}`);
  // KS9/KS9b 判的是**身分**不是存在:這條路上鈕本來就該留著(帳號入口是它的合法身分),
  // 寫成「不得存在」會把正確行為判成缺陷。所以正面斷言「在、且是帳號」——
  // 收集器若壞掉,btnVisible 會是 false 而當場紅,沉默過不了關。
  ok('KS9 旗標關閉 + 初始化有跑但這台裝置沒登入過(?account=delete;與 ACCOUNT_ENABLED 翻真時同一條分支):工具列槽位在,身分是「帳號」不是 Plus',
    offInit.r.slot.btnVisible === true
    && offInit.r.slot.btnLabel === '帳號'
    && /登入與跨裝置同步/.test(offInit.r.slot.btnTitle || '')
    && !/Plus/.test(`${offInit.r.slot.btnLabel || ''}${offInit.r.slot.btnTitle || ''}`),
    JSON.stringify(offInit.r.slot));
  ok('KS9b 同一條路:「更多」抽屜打開後那一列也在,標成「帳號同步」不是「軌島 Plus」',
    offInit.r.slot.sheetOpen === true && offInit.r.slot.rowVisible === true && offInit.r.slot.rowLabel === '帳號同步',
    JSON.stringify(offInit.r.slot));
  ok('KS 本輪零 pageerror/console.error', on.errs.length === 0 && off.errs.length === 0 && offInit.errs.length === 0,
    [...on.errs, ...off.errs, ...offInit.errs].slice(0, 3).join(' | '));
}

// ══════════════ Z0 錯誤收集器的正向對照 ══════════════
// 上面每一條「零 pageerror」與檔尾的 K「全程為零」都是「數量必須為 0」型斷言:收集器壞掉(listener
// 掛在錯的 page、attach 忘了呼叫、Playwright 改事件名)時,它們全部會變成永遠的假綠。這裡故意在頁面裡
// 丟一顆例外,證明同一支 attach() 掛的 listener 真的收得到。
// ⚠️ 探針形式很關鍵:`page.evaluate(() => { throw ... })` 的例外是被 Playwright 接住、以 rejection
//    回到 Node,**完全不會觸發 pageerror**(2026-08-02 實測:形式A 收到 0 筆、形式B 收到 1 筆)。
//    要真的觸發,例外必須發生在頁面自己的 task 裡,所以用 setTimeout 包起來。
//    否則探針本身就是壞的——而壞掉的正向對照比沒有更糟,它會讓你以為驗過了。
{
  const before = allErrors.length;
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'Z0-probe');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page); // 與其他情境一致等到 boot 完成:半途關頁會產生中止類的假錯誤,污染 K
  await page.evaluate(() => { setTimeout(() => { throw new Error('__collector_probe__'); }, 0); });
  await page.waitForTimeout(400);
  ok('Z0 錯誤收集器正向對照:故意丟的 pageerror 有被收到(證明上面所有「零例外」不是假綠)',
    errs.some(s => s.includes('__collector_probe__')), `本輪收到 ${errs.length} 筆`);
  // 探針是刻意製造的,不能算進 K 的「全程為零」;摘除後比長度確認摘得剛好,避免摘太多把真錯誤一起吃掉。
  for (let i = allErrors.length - 1; i >= 0; i--) if (allErrors[i].includes('__collector_probe__')) allErrors.splice(i, 1);
  ok('Z0b 探針已從全程收集器摘乾淨(沒多摘也沒少摘)', allErrors.length === before,
    `摘除前後 ${before} → ${allErrors.length}`);
  await ctx.close();
}
// 每一顆開出來的 page 都必須掛上收集器,否則它的例外全程隱形、K 依然是綠的。
ok('Z0c 每顆 page 都掛上了錯誤收集器', pagesCreated === pagesAttached,
  `newPage=${pagesCreated} attach=${pagesAttached}`);

// ══════════════ 收尾 ══════════════
ok('K 全程 pageerror/console.error 為零', allErrors.length === 0, allErrors.slice(0, 8).join(' | '));
server.close();
await chromiumB.close();
await webkitB.close();

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (skips.length) console.log(`SKIP ${skips.length} 項:${skips.map(s => s.name).join('；')}`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name + (f.detail ? ` (${f.detail})` : '')).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
