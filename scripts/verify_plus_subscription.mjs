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
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = '/private/tmp/claude-501/-Users-xuxiang-Code------/7527b6c9-bef6-4caa-9ffe-60c4cba112b7/scratchpad';
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
const BASE = `http://localhost:${PORT}/`;

const M_PRICE = 'NT$90';   // stub「月訂」價(模擬商店回傳;index.html 不得硬編此值)
const A_PRICE = 'NT$390';  // stub「年訂」價

const results = [];
const skips = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const skip = (name, reason) => { skips.push({ name, reason }); console.log(`SKIP ${name} — ${reason}`); };

const allErrors = [];
function attach(page, tag) {
  const local = [];
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; local.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error') { const s = `[${tag}] console.error: ${m.text()}`; local.push(s); allErrors.push(s); } });
  return local;
}
async function newPage(browser, { width = 1280, height = 800, touch = false, theme = 'light' } = {}) {
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
