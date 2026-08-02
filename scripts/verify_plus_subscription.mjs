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

// ══════════════ G. Plus 面板入口與兩段式登入(2026-08-02 開閘裁示) ══════════════
// 舊版 G 斷言的是「匿名點 Plus 入口 → 直接看到 Google＋Apple 登入鈕」,那是被推翻的舊行為
// (plusOpen 一開頭就強迫登入)。開閘後的裁示是兩段式:
//   第一段 網站(無購買通道)的匿名訪客從 Plus 槽位開得了面板,看得到六項清單與「請在 App 內訂閱」,
//          而且這一段全程零 Firebase、state.account 仍 undefined(甲案裁示的免費層匿名沒有被撤銷);
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
  const entry = await page.evaluate(() => {
    const btn = document.getElementById('accountBtn');
    const row = document.querySelector('.ms-row[data-proxy="accountBtn"]');
    const cs = btn && getComputedStyle(btn), r = btn && btn.getBoundingClientRect();
    return {
      btnVisible: !!(btn && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0),
      btnLabel: btn && btn.querySelector('.tl') ? btn.querySelector('.tl').textContent : null,
      rowShown: !!(row && row.style.display !== 'none'),
      rowLabel: row && row.querySelector('span') ? row.querySelector('span').textContent : null,
    };
  });
  ok('G1 網站匿名訪客的工具列有 Plus 入口且標成 Plus(槽位改造真的跑過,不是還停在帳號標籤)',
    entry.btnVisible === true && entry.btnLabel === 'Plus', JSON.stringify(entry));
  ok('G2 「更多」抽屜的同一個槽位也露出且標成「軌島 Plus」(手機唯一入口,桌面工具鈕在 ≤900 是 display:none)',
    entry.rowShown === true && entry.rowLabel === '軌島 Plus', JSON.stringify(entry));
  await page.click('#accountBtn'); // 真的點,不是 evaluate 呼叫函式
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
  ok('G3 匿名點入口 → Plus 面板直接開且六項功能清單畫得出來(沒有被推去登入)',
    panel.open === true && panel.feats >= 5, JSON.stringify(panel));
  ok('G4 面板停在「請在 App 內訂閱」,零購買鈕(網站不賣)',
    panel.appOnly === true && panel.buyBtns === 0, `appOnly=${panel.appOnly} buy=${panel.buyBtns}`);
  ok('G5 看完整個面板,state.account 仍是 undefined(帳號系統沒被叫起來)',
    panel.accountUndefined === true, `accountUndefined=${panel.accountUndefined}`);
  ok('G6 看完整個面板,Firebase 網路請求仍為 0(免費層匿名沒有因為開放面板而破功)',
    firebaseReqs.length === 0, firebaseReqs.slice(0, 3).join(' | '));
  ok('G7 面板內有登入 CTA,但登入鈕此刻還沒出現(兩段式的第一段:看得到入口、還沒載帳號系統)',
    panel.loginCta === 1 && /登入/.test(panel.ctaText) && panel.loginBtns === 0,
    `cta=${panel.loginCta} 文字=${panel.ctaText} 登入鈕=${panel.loginBtns}`);
  await page.click('[data-plus="login"]');
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

// ══════════════ N. 手機四寬度:Plus 入口在「更多」抽屜那一列 ══════════════
// ≤900 的 .stage-tools 是 display:none ⇒ 手機唯一入口是抽屜列,桌面那顆工具鈕在手機驗不到東西。
// 本輪新增了可見控件,依全域鐵則做 360/375/414/768 四寬度 × WebKit × 全控件相交掃描 ×
// 多點 elementFromPoint × 375 真觸控端到端。
// ⚠️ 可見性判準刻意不看 opacity:本專案有元素平時就是 opacity:0(閒置淡出、sheet 開啟時的讓位過渡),
//    拿它當過濾條件會把受測對象整個排除掉而全綠。只排 display:none / visibility:hidden,rect 才是真相。
// ⚠️ 幾何不相交只證明「看起來沒疊」:偽元素熱區(::after)被撐大到蓋掉鄰列時,rect 與 computed style
//    兩邊都照不到(心得 33 的病灶)。所以另外橫掃整列 9×3 點,並要求上下鄰列各自命中自己。
const MOBILE_SEL = '.ms-row[data-proxy="accountBtn"]';
async function mobilePlusEntry(width) {
  const { ctx, page } = await newPage(webkitB, { width, height: 780, touch: true });
  const errs = attach(page, `N${width}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const toolbarHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.stage-tools')).display === 'none');
  await page.tap('#tabMore');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  await page.waitForTimeout(350); // sheet 上滑轉場走完再量
  await page.locator(MOBILE_SEL).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const s = await page.evaluate(sel => {
    const vis = el => { const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const target = document.querySelector(sel);
    if (!target || !vis(target)) return { found: false };
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
      h: Math.round(tr.height), collisions, miss, neighbours,
      overflow: document.documentElement.scrollWidth - window.innerWidth };
  }, MOBILE_SEL);
  ok(`N${width}a 手機工具列 .stage-tools 是 display:none(抽屜列是唯一入口,這是後面幾條的前提)`, toolbarHidden === true, `hidden=${toolbarHidden}`);
  ok(`N${width}b 抽屜列存在、可見、標成「軌島 Plus」且高度 ≥44px`, s.found === true && s.label === '軌島 Plus' && s.h >= 44, JSON.stringify(s.found ? { label: s.label, h: s.h } : s));
  ok(`N${width}c 與所有可見控件零相交`, s.found === true && s.collisions.length === 0, (s.collisions || []).join(' | '));
  ok(`N${width}d 橫掃 9×3 點 elementFromPoint 全部命中自己(偽元素熱區沒被別人蓋掉)`, s.found === true && s.miss.length === 0, `未命中 ${(s.miss || []).length} 點:${(s.miss || []).slice(0, 5).join(',')}`);
  ok(`N${width}e 上下鄰列各自命中自己(這一列的熱區沒有撐大吃掉鄰列)`, s.found === true && (s.neighbours || []).every(n => n.self), JSON.stringify(s.neighbours));
  ok(`N${width}f 頁面無橫向溢出`, (s.overflow || 0) <= 1, `overflow=${s.overflow}px`);
  ok(`N${width} 本輪零 pageerror/console.error`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
for (const w of [360, 375, 414, 768]) await mobilePlusEntry(w);
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
  await page.locator(MOBILE_SEL).scrollIntoViewIfNeeded();
  await page.tap(MOBILE_SEL);
  await page.waitForSelector('#plusModal:not([hidden])', { timeout: 8000 }).catch(() => {});
  const r = await page.evaluate(() => ({
    plusOpen: !document.getElementById('plusModal').hidden,
    feats: document.querySelectorAll('.plus-feature').length,
    cta: document.querySelectorAll('[data-plus="login"]').length,
    accountUndefined: typeof state.account === 'undefined',
  }));
  ok('N-tap 375 真觸控點抽屜列 → Plus 面板真的開出來(清單＋登入 CTA 都在)', r.plusOpen === true && r.feats >= 5 && r.cta === 1, JSON.stringify(r));
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
  await page.locator(prevSel).scrollIntoViewIfNeeded();
  await page.tap(prevSel);
  await page.waitForTimeout(700);
  const stillHidden = await page.evaluate(() => document.getElementById('plusModal').hidden);
  ok('N-tap 反向對照:同樣手勢點上一列不會開出 Plus 面板(證明上一條的「開了」是這一列接的線)',
    !!prevSel && stillHidden === true, `上一列=${prevSel} plusModal.hidden=${stillHidden}`);
  ok('N-tap 反向對照 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
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
