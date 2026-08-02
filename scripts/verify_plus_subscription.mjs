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
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
// PLUS_ENABLED 是 UI 總閘(網站端只認 ?plus=1)。不帶這個參數,plusOpen 畫不出方案卡,整支腳本會崩在 section A。
const BASE = `http://localhost:${PORT}/?plus=1`;

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
  };
});
const FORBIDDEN = ['一次購買', '永久解鎖', '不是訂閱'];

const chromiumB = await chromium.launch();
const webkitB = await webkit.launch();

// ══════════════ A/B. 主流程(桌機 1280×800 chromium、手機 375×812 觸控) ══════════════
async function runFlow(browser, label, opts) {
  const { ctx, page } = await newPage(browser, opts);
  const errs = attach(page, label);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await injectPlus(page, { mode: 'buy' });
  await page.evaluate(() => plusOpen('test'));
  await page.waitForSelector('#plusBody .plus-plan', { timeout: 6000 });
  const m = await readModal(page);

  ok(`${label}1 訂閱視窗顯示(modal 未隱藏)`, m.hidden === false, `hidden=${m.hidden}`);
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
  ok(`${label}8 頭牌功能=誤點履歷 + 信任聲明「永遠免費」皆在`, m.text.includes('誤點履歷') && m.trust && m.text.includes('永遠免費'),
    `誤點履歷=${m.text.includes('誤點履歷')} trust=${m.trust}`);
  ok(`${label}9 自動續訂法務說明存在`, m.text.includes('自動續訂') || m.text.includes('自動續'),
    m.text.slice(0, 0));

  // 購買年訂 → 訂閱成功。既有行為:成功後 modal 自動關閉並跳 toast;重開即渲染「已訂閱」狀態。
  await page.click('#plusBody .plus-plan[data-pkg="annual"]');
  await page.waitForFunction(() => state.plus && state.plus.active === true && state.plus.loading === false, null, { timeout: 6000 });
  const closedAfterBuy = await page.evaluate(() => document.getElementById('plusModal').hidden);
  await page.evaluate(() => plusOpen('test'));
  await page.waitForSelector('#plusBody .plus-owned', { state: 'visible', timeout: 6000 });
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
  await page.waitForSelector('#plusBody [data-plus="restore"]', { timeout: 6000 });
  await page.click('#plusBody [data-plus="restore"]');
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
  await page.waitForSelector('#plusBody .plus-plan', { timeout: 6000 });
  await page.waitForTimeout(250);
  const themeApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const file = path.join(SHOT_DIR, `plus_sub_${label}.png`);
  await page.locator('.plus-dialog').screenshot({ path: file });
  console.log(`SHOT ${label} (data-theme=${themeApplied}) → ${file}`);
  await ctx.close();
  return { file, themeApplied };
}
const shotDeskLight = await shot('desktop_light', { width: 1280, height: 800, touch: false, theme: 'light' });
const shotDeskDark = await shot('desktop_dark', { width: 1280, height: 800, touch: false, theme: 'dark' });
const shotMobLight = await shot('mobile_light', { width: 375, height: 812, touch: true, theme: 'light' });
const shotMobDark = await shot('mobile_dark', { width: 375, height: 812, touch: true, theme: 'dark' });
ok('E1 亮/暗主題確實套用(截圖用)', shotDeskLight.themeApplied === 'light' && shotDeskDark.themeApplied === 'dark' && shotMobLight.themeApplied === 'light' && shotMobDark.themeApplied === 'dark',
  `desk=${shotDeskLight.themeApplied}/${shotDeskDark.themeApplied} mob=${shotMobLight.themeApplied}/${shotMobDark.themeApplied}`);

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

// ══════════════ G. 帳號系統重開:匿名使用者可抵達登入鈕(不注入帳號,真實走 plusGateOpen→accountEnsureInit) ══════════════
// 匿名使用者點 Plus 入口 → 必須看得到 Google＋Apple 兩顆登入鈕（不是空白視窗、也不是只有一顆）
// 這條在 RAIL_APPLE_LOGIN=false 時必失敗：accountRender 只畫得出 Google 一顆
async function assertAnonymousCanReachLogin(page) {
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.plusGateOpen('test-gate', () => {}));
  // 條件式等待,不用固定秒數:Firebase SDK 是延遲載入,冷載入比暖載入慢很多,
  // 固定 timeout 會讓這條斷言實際在量「載入快不快」而不是「旗標對不對」。
  await page.waitForSelector('[data-login="google"]', { timeout: 15000 }).catch(() => {});
  const loginBtns = await page.locator('[data-login="google"], [data-login="apple"]').count();
  return { name: '匿名使用者可抵達登入鈕', ok: loginBtns >= 2,
           detail: `找到 ${loginBtns} 顆登入鈕（需要 Google＋Apple 兩顆）` };
}
{
  const { ctx, page } = await newPage(chromiumB);
  attach(page, 'G');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await assertAnonymousCanReachLogin(page);
  ok(r.name, r.ok, r.detail);
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
const FIREBASE_REQ_RE = /gstatic\.com\/firebasejs|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com|firebaseapp\.com/;
function collectFirebaseReqs(page) {
  const out = [];
  page.on('request', req => { const u = req.url(); if (FIREBASE_REQ_RE.test(u)) out.push(u); });
  return out;
}
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
