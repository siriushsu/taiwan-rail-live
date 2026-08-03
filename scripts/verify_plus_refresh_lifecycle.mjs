// Task 5(C-4:退費/撤銷/到期後資格因快取與未刷新持續有效)行為驗證——Playwright 真引擎 + 本機靜態伺服器。
// 本腳本未參與實作;以下是我從 index.html/app/src/native-bridge.mjs 讀出、供本腳本判準依據的關鍵事實:
//
//   · index.html 新增/修改:
//     - plusRefresh() 第一行從 `const p = state.plus` 改成 `const p = plusState()`(見該函式頂端註解)。
//       修復前:state.plus 從未被任何呼叫初始化過的情況下(冷啟動、回訪使用者第一次登入),
//       plusRefresh() 會被 `!p` 擋下直接 return false,連 plusState() 都沒機會跑,資格永遠沒查過。
//     - plusEnsureListener(adapter)/plusTeardownListener():在 adapter 具備
//       addCustomerInfoUpdateListener 時註冊(typeof 特性偵測,不是每個平台必要條件),
//       用 plusListenerAdapter 記錄「目前掛在哪一顆 adapter 上」做冪等,登出
//       (accountEndSession -> accountForgetIdentity)時解除註冊。
//     - plusApplyCustomerInfo(info):套用 CustomerInfo 到 state.plus(active/founding/mgmtUrl),
//       只給 listener 回呼與 plusRevalidateBeforeAction 兩個新消費者共用——plusRefresh()/
//       plusPurchase()/plusRestore() 既有三處欄位寫入原封不動(觸碰過一次,踩到
//       verify_founding_seal.mjs G4.0/G4.2 的原始碼字面 regex,已改回不動既有三處)。
//     - plusPurchase()/plusRestore() 開頭各加一行 `await plusRevalidateBeforeAction(p.adapter)`:
//       adapter 支援 getCustomerInfo 才會取一次新鮮資料套用,失敗不阻擋原本流程也不把資格改成 false。
//     - accountEnsureInit() 的 visibilitychange 監聽器多呼叫一次 plusRefresh()(fire-and-forget,
//       不 await,同一行原本的 accountSyncNow('foreground') 也不 await)。
//   · window.RAIL_PLUS_TEST_ADAPTER 短路 plusAdapterFor(既有慣例,見 verify_plus_subscription.mjs
//     等既有腳本);要測 listener 能力就在這個物件上額外實作
//     addCustomerInfoUpdateListener(cb)=>Promise<id> / removeCustomerInfoUpdateListener(id)。
//   · satRetinaAllowed() = SAT_RETINA && plusIsActive():網站預設 SAT_RETINA=false(恆假,測不出
//     entitlement 變化),要注入 window.RAIL_APP_CONFIG={satRetina:true} 才會反映 plusIsActive()
//     ——沿用 verify_sat_retina.mjs 既有做法。
//   · accountSyncNow(reason) 開頭 `if (!reason.startsWith('logout') && !plusIsActive()) return false;`
//     ——沿用 verify_plus_subscription.mjs Section H 的 Firestore stub 手法(a.fb.doc/runTransaction
//     直接 throw,用「有沒有被呼叫到」當判準,不是看回傳值)。
//   · accountConfigured() 要求 window.RAIL_FIREBASE_CONFIG 具備 apiKey/authDomain/projectId,
//     否則 setupAccountUi() 不會呼叫 accountEnsureInit(),回訪使用者的自動登入流程根本不會跑。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G0 自檢(心得32:驗收腳本第一道 gate 要印出驗的是哪個目錄):ROOT 由本檔自身路徑推導,
// 不吃任何 --root/env 參數,結構上不會誤驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

// 埠位刻意用 process.env.PORT 可覆寫(這台機器 30+ worktree 並行,硬編埠位會撞到別的 session
// 同時在跑同名腳本——本次實測就撞過一次 5207/5233,retry 後確認是暫時佔用,不是本腳本的錯)。
const PORT = Number(process.env.PORT || 5439);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });
const BASE = `http://localhost:${PORT}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const allErrors = [];
// 心得(verify_plus_subscription.mjs 既有做法):newPage/attach 分開計數,新增情境忘記 attach 時
// 那顆 page 的例外會全程隱形,故用「每顆開出來的 page 都掛了收集器」當自身的健全性檢查。
let pagesCreated = 0, pagesAttached = 0;
function attach(page, tag) {
  const local = [];
  pagesAttached++;
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; local.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error') { const s = `[${tag}] console.error: ${m.text()}`; local.push(s); allErrors.push(s); } });
  return local;
}
async function newPage(browser, { width = 1280, height = 800, init = null, initArg } = {}) {
  pagesCreated++;
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  if (init) await ctx.addInitScript(init, initArg);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function waitReady(page) {
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}
// 建一顆帶 spy 計數的測試 adapter(既有慣例 window.RAIL_PLUS_TEST_ADAPTER,見 verify_plus_subscription.mjs
// 檔頭引用):withListener 決定要不要實作 addCustomerInfoUpdateListener/removeCustomerInfoUpdateListener
// (原生 adapter 才有這個能力,見 index.html plusEnsureListener 註解);active0 是初始「上游回什麼」;
// throwGetInfo 讓 getCustomerInfo 之後的呼叫改丟例外(模擬上游故障)。
function makeAdapterInit(cfg) {
  return (arg) => {
    window.__spy = { getCustomerInfo: 0, getOfferings: 0, purchase: 0, restore: 0, addListener: 0, removeListener: 0 };
    window.__listenerCb = null;
    window.__removedIds = [];
    window.__active = arg.active0;
    window.__throwGetInfo = false;
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    const info = () => ({ entitlements: { active: window.__active ? { plus: { identifier: 'plus' } } : {} }, managementURL: window.__active ? 'https://example.invalid/manage' : '' });
    const offering = { availablePackages: [
      { identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: 'STUB-MONTH' } } },
      { identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: 'STUB-YEAR' } } },
    ] };
    const adapter = {
      setUser: async () => {},
      getCustomerInfo: async () => {
        window.__spy.getCustomerInfo++;
        if (window.__throwGetInfo) throw new Error('模擬上游故障(網路錯誤)');
        return info();
      },
      getOfferings: async () => { window.__spy.getOfferings++; return { all: { plus: offering }, current: offering }; },
      purchase: async () => { window.__spy.purchase++; window.__active = true; return { customerInfo: info() }; },
      restore: async () => { window.__spy.restore++; return { customerInfo: info() }; },
    };
    if (arg.withListener) {
      adapter.addCustomerInfoUpdateListener = async cb => {
        window.__spy.addListener++; window.__listenerCb = cb; return 'listener-id-' + window.__spy.addListener;
      };
      adapter.removeCustomerInfoUpdateListener = async id => { window.__spy.removeListener++; window.__removedIds.push(id); };
    }
    window.RAIL_PLUS_TEST_ADAPTER = adapter;
  };
}
// 登入態的最小 state.account/state.plus 注入,呼叫端接著可以直接叫 plusRefresh()/plusPurchase()/
// plusRestore() 等公開函式(page.evaluate 全域可見,既有慣例見 verify_founding_seal.mjs 檔頭)。
async function loginAndRefresh(page, uid = 'lifecycle-test-uid') {
  return page.evaluate(async (uid) => {
    state.plus = null;
    state.account = { ready: true, user: { uid, email: 'tester@example.com' }, syncing: false, lastSync: 0, actionError: '', error: '' };
    await plusRefresh();
    return { active: state.plus && state.plus.active, calls: JSON.parse(JSON.stringify(window.__spy)) };
  }, uid);
}

const chromiumB = await chromium.launch();

// ══════════════ 第 1 節:冷啟動缺口修復(plusRefresh 讀 state.plus 而非 plusState()) ══════════════
// 既有 verify_plus_subscription.mjs 的 I3 也測「回訪使用者開機」,但它的 onAuthStateChanged 走真
// Firebase SDK、從未真的被呼叫過(沒有持久化的登入態),user 恆為 null,`if (user) {...}` 分支
// 從未執行到——不是同一個路徑。這裡改用 RAIL_FIREBASE_TEST_MODULES 短路且讓 onAuthStateChanged
// 真的非同步解出一個 truthy 使用者,才踩得到 accountEnsureInit() 那段 `if (user) { await plusRefresh(); }`。
{
  const { ctx, page } = await newPage(chromiumB, {
    init: (arg) => {
      // 2026-08-04 C-2 複審 Important 1:accountReturning() 改讀 trainmap-account-uid(見
      // index.html accountReturning 上方註解——非訂閱者的同步恆被 plusIsActive() 擋下,
      // trainmap-last-sync-uid 永遠不會被寫,舊 key 當這裡的判準已經不成立)。
      try { localStorage.setItem('trainmap-account-uid', arg.uid); } catch (e) {} // accountReturning()===true
      window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' }; // accountConfigured() 要求的三欄
      window.__spy = { getCustomerInfo: 0 };
      window.__active = true;
      window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
      window.RAIL_PLUS_TEST_ADAPTER = {
        setUser: async () => {},
        getCustomerInfo: async () => { window.__spy.getCustomerInfo++; return { entitlements: { active: { plus: { identifier: 'plus' } } } }; },
        getOfferings: async () => ({ all: {}, current: null }),
        purchase: async () => ({}), restore: async () => ({ entitlements: { active: {} } }),
      };
      window.RAIL_FIREBASE_TEST_MODULES = {
        initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
        // 與既有腳本唯一的差異:真的觸發 callback,模擬「裝置上已有 session,onAuthStateChanged
        // 非同步解出一個真使用者」——這是 I3 沒覆蓋到的路徑(I3 的 stub 是 () => {},從不觸發)。
        onAuthStateChanged: (auth, cb) => { setTimeout(() => cb({ uid: arg.uid, email: 't@example.com' }), 50); },
      };
    },
    initArg: { uid: 'returning-uid-l1' },
  });
  const errs = attach(page, 'L1');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(1500); // 讓 onAuthStateChanged 的非同步 callback 與其內的 await plusRefresh() 有時間跑完
  const r = await page.evaluate(() => ({
    statePlusExists: !!state.plus,
    active: state.plus ? state.plus.active : null,
    accountUser: !!(state.account && state.account.user),
    getCustomerInfoCalls: window.__spy.getCustomerInfo,
  }));
  ok('L1 回訪使用者冷啟動:onAuthStateChanged 解出真使用者後,state.plus 真的被初始化(不再是 undefined)',
    r.statePlusExists === true, JSON.stringify(r));
  ok('L2 回訪使用者冷啟動:plusRefresh() 的 meaningful body 真的執行到——adapter.getCustomerInfo 被呼叫過至少一次(修復前恆為 0,見 L1 同一個 r)',
    r.getCustomerInfoCalls >= 1 && r.active === true, JSON.stringify(r));
  ok('L 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 2 節:CustomerInfo 更新 listener 的冪等註冊 ══════════════
{
  const { ctx, page } = await newPage(chromiumB, { init: makeAdapterInit(), initArg: { withListener: true, active0: true } });
  const errs = attach(page, 'L3');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await loginAndRefresh(page);
  const after1 = await page.evaluate(() => window.__spy.addListener);
  // 再呼叫一次 plusRefresh()(同一個已登入使用者、同一顆 adapter 物件)——冪等的話不該再掛一次。
  await page.evaluate(() => plusRefresh());
  const after2 = await page.evaluate(() => window.__spy.addListener);
  ok('L3 同一顆 adapter 上,plusRefresh() 呼叫兩次只註冊一次 listener(冪等)',
    after1 === 1 && after2 === 1, `第一次後=${after1} 第二次後=${after2}`);
  ok('L3 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 3 節:listener 回呼是「行為」,不是只有欄位變了 ══════════════
// 判準要證明的是行為:satRetinaAllowed()(至少一個實際閘門)與 accountSyncNow() 的資格閘門
// 都要因為 listener 推播而真的改變結果——不是只斷言 state.plus.active 這個內部欄位。
{
  const { ctx, page } = await newPage(chromiumB, {
    init: (arg) => { window.RAIL_APP_CONFIG = { satRetina: true }; }, // 讓 satRetinaAllowed() 反映 plusIsActive(),見檔頭引用
  });
  const errs = attach(page, 'L4');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  // 這個情境要在頁面載入後才注入 adapter(RAIL_APP_CONFIG 已經是 addInitScript 注入的),
  // 故直接在 page.evaluate 內建立 adapter,不透過 makeAdapterInit(那支是給 addInitScript 用的)。
  await page.evaluate(() => {
    window.__spy = { addListener: 0 };
    window.__listenerCb = null;
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {},
      getCustomerInfo: async () => ({ entitlements: { active: { plus: { identifier: 'plus' } } } }),
      getOfferings: async () => ({ all: {}, current: null }),
      purchase: async () => ({}), restore: async () => ({ entitlements: { active: {} } }),
      addCustomerInfoUpdateListener: async cb => { window.__spy.addListener++; window.__listenerCb = cb; return 'id-1'; },
      removeCustomerInfoUpdateListener: async () => {},
    };
  });
  await loginAndRefresh(page);
  const pre = await page.evaluate(() => ({
    active: state.plus.active, satRetina: satRetinaAllowed(), listenerRegistered: window.__spy.addListener === 1,
  }));
  ok('L4 前置條件:訂閱中 ⇒ satRetinaAllowed()===true 且 listener 已註冊(不是本來就假,下面關閉才有意義)',
    pre.active === true && pre.satRetina === true && pre.listenerRegistered === true, JSON.stringify(pre));

  // Firestore stub(手法同 verify_plus_subscription.mjs Section H):訂閱中時 accountSyncNow 應該
  // 會嘗試碰 Firestore(即使 stub 讓它半路失敗)。
  const preSync = await page.evaluate(async () => {
    let syncAttempted = false;
    state.account.db = {};
    state.account.fb = { doc: () => { syncAttempted = true; throw new Error('探針'); }, runTransaction: () => { syncAttempted = true; throw new Error('探針'); }, serverTimestamp: () => 0 };
    const result = await accountSyncNow('manual');
    return { result, syncAttempted };
  });
  ok('L4 前置條件正向對照:訂閱中時 accountSyncNow(\'manual\') 真的會嘗試碰 Firestore(不是本來就被擋,下面關閉的擋下才有意義)',
    preSync.syncAttempted === true, JSON.stringify(preSync));

  // 模擬 SDK 主動推播:呼叫先前註冊時捕捉到的 callback,帶一份「沒有 plus entitlement」的新 CustomerInfo。
  const post = await page.evaluate(() => {
    window.__listenerCb({ entitlements: { active: {} } }); // 資格消失
    return { active: state.plus.active, satRetina: satRetinaAllowed() };
  });
  ok('L4 listener 回呼(資格消失)⇒ state.plus.active 真的變 false',
    post.active === false, JSON.stringify(post));
  ok('L4 listener 回呼(資格消失)⇒ satRetinaAllowed() 這個實際閘門真的關閉(不是只有內部欄位變了)',
    post.satRetina === false, JSON.stringify(post));

  const postSync = await page.evaluate(async () => {
    let syncAttempted = false;
    state.account.fb = { doc: () => { syncAttempted = true; throw new Error('探針'); }, runTransaction: () => { syncAttempted = true; throw new Error('探針'); }, serverTimestamp: () => 0 };
    const result = await accountSyncNow('manual');
    return { result, syncAttempted };
  });
  ok('L4 listener 回呼後 accountSyncNow(\'manual\') 不再嘗試碰 Firestore(資格閘門真的擋下,不是回傳值巧合)',
    postSync.result === false && postSync.syncAttempted === false, JSON.stringify(postSync));

  ok('L4 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// L5/L6 需要真正的 visibilitychange 監聽器掛上——那一行只在 accountEnsureInit() 內部註冊
// (見 index.html accountEnsureInit 尾端),loginAndRefresh() 直接手塞 state.account/呼叫
// plusRefresh() 從不走 accountEnsureInit(),不會掛上這個監聽器,dispatch 事件會是無效操作
// (第一版腳本在這裡吃過一次假綠:L6 的「資格不變」斷言在監聽器根本沒掛、dispatch 什麼都沒發生的
// 情況下也會通過,靠第二條「error 有被記錄」的斷言才抓到——單一斷言在受測物的下游會被空操作矇混)。
// 用 P1 既有手法(RAIL_FIREBASE_TEST_MODULES 的 onAuthStateChanged 給 no-op,不真的觸發登入)
// 讓 accountEnsureInit() 跑完掛上監聽器,再手動補上登入態與 adapter。
async function setupForegroundLogin(page, uid) {
  await page.evaluate(() => {
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = { initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}), onAuthStateChanged: () => {} };
  });
  await page.evaluate(async () => { await accountEnsureInit(); }); // 掛上 visibilitychange 監聽器,不觸發真登入
  return loginAndRefresh(page, uid); // 手動補登入態、跑一次 plusRefresh() 備妥 adapter
}

// ══════════════ 第 4 節:回前景重新驗證資格(spy 計數 + 正向對照) ══════════════
{
  const { ctx, page } = await newPage(chromiumB, { init: makeAdapterInit(), initArg: { withListener: false, active0: true } });
  const errs = attach(page, 'L5');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await setupForegroundLogin(page, 'lifecycle-l5-uid');
  const before = await page.evaluate(() => window.__spy.getCustomerInfo);

  // 正向對照:不觸發 visibilitychange,單純等待,呼叫數不應該增加——證明下面的增加不是巧合的計時器/輪詢。
  await page.waitForTimeout(600);
  const controlNoEvent = await page.evaluate(() => window.__spy.getCustomerInfo);
  ok('L5 正向對照:不回前景、只是等待,adapter.getCustomerInfo 呼叫數不會自己增加',
    controlNoEvent === before, `before=${before} 等待後=${controlNoEvent}`);

  // 觸發 visibilitychange(headless chromium 前景頁 document.hidden 本來就是 false,已受控實驗驗證過,
  // 見本任務報告——不需要另外操弄 document.hidden)。
  const afterEvent = await page.evaluate(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 400)); // plusRefresh() 是 fire-and-forget,給它時間跑完
    return window.__spy.getCustomerInfo;
  });
  ok('L5 回前景(dispatch visibilitychange)⇒ adapter.getCustomerInfo 恰好多被呼叫一次(資格真的被重新查詢)',
    afterEvent === before + 1, `before=${before} 回前景後=${afterEvent}`);

  ok('L5 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 5 節:回前景觸發的重新驗證,上游拋錯 ⇒ 資格不變(不是變 false) ══════════════
{
  const { ctx, page } = await newPage(chromiumB, { init: makeAdapterInit(), initArg: { withListener: false, active0: true } });
  const errs = attach(page, 'L6');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await setupForegroundLogin(page, 'lifecycle-l6-uid');
  const pre = await page.evaluate(() => state.plus.active);
  ok('L6 前置條件:初次 plusRefresh() 後資格為 true(下面上游拋錯若被誤判成 false,才是可分辨的變化)', pre === true, `active=${pre}`);

  // 讓下一次 getCustomerInfo() 開始拋錯,模擬回前景時上游/網路故障。
  await page.evaluate(() => { window.__throwGetInfo = true; });
  const r = await page.evaluate(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(res => setTimeout(res, 400));
    return { active: state.plus.active, error: state.plus.error, calls: window.__spy.getCustomerInfo };
  });
  ok('L6 回前景觸發的 plusRefresh() 內,adapter.getCustomerInfo 上游拋錯 ⇒ state.plus.active 維持不變(不被讀成「沒訂閱」)',
    r.active === true, JSON.stringify(r));
  ok('L6 同一次錯誤有被記錄到 state.plus.error(不是靜默吞掉,方便診斷)',
    typeof r.error === 'string' && r.error.length > 0, JSON.stringify(r));

  ok('L6 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 6 節:重要付費操作(購買/恢復購買)前重新驗證 ══════════════
{
  const { ctx, page } = await newPage(chromiumB, { init: makeAdapterInit(), initArg: { withListener: false, active0: false } });
  const errs = attach(page, 'L7');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await loginAndRefresh(page); // active0=false,但仍會把 pkgMonthly/pkgAnnual 從 getOfferings 填好

  const preOffer = await page.evaluate(() => ({ pkgAnnual: !!state.plus.pkgAnnual, adapter: !!state.plus.adapter }));
  ok('L7 前置條件:登入後 plusRefresh() 已備妥 adapter 與年訂閱方案(下面 plusPurchase 才叫得動)', preOffer.pkgAnnual && preOffer.adapter, JSON.stringify(preOffer));

  const beforePurchase = await page.evaluate(() => window.__spy.getCustomerInfo);
  const afterPurchase = await page.evaluate(async () => {
    await plusPurchase('annual');
    return { getCustomerInfoCalls: window.__spy.getCustomerInfo, purchaseCalls: window.__spy.purchase, active: state.plus.active };
  });
  ok('L7a plusPurchase() 內,購買前有一次獨立於 purchase() 本身的 getCustomerInfo 重新驗證呼叫',
    afterPurchase.getCustomerInfoCalls === beforePurchase + 1, `before=${beforePurchase} after=${JSON.stringify(afterPurchase)}`);
  ok('L7a 正向對照:purchase() 本身也真的被呼叫過(上面的 +1 不是把 purchase 呼叫誤數成 getCustomerInfo)',
    afterPurchase.purchaseCalls === 1 && afterPurchase.active === true, JSON.stringify(afterPurchase));

  // plusRestore:重置到未訂閱、adapter 需要重新拿一顆(plusRestore 的 `p.adapter = p.adapter || ...`)。
  await page.evaluate(() => { state.plus.active = false; window.__active = false; });
  const beforeRestore = await page.evaluate(() => window.__spy.getCustomerInfo);
  await page.evaluate(() => { window.__active = true; }); // 恢復購買時上游回「已訂閱」
  const afterRestore = await page.evaluate(async () => {
    await plusRestore();
    return { getCustomerInfoCalls: window.__spy.getCustomerInfo, restoreCalls: window.__spy.restore, active: state.plus.active };
  });
  ok('L7b plusRestore() 內,恢復購買前有一次獨立於 restore() 本身的 getCustomerInfo 重新驗證呼叫',
    afterRestore.getCustomerInfoCalls === beforeRestore + 1, `before=${beforeRestore} after=${JSON.stringify(afterRestore)}`);
  ok('L7b 正向對照:restore() 本身也真的被呼叫過',
    afterRestore.restoreCalls === 1 && afterRestore.active === true, JSON.stringify(afterRestore));

  // 重新驗證失敗不得阻擋原本流程:下一次購買前讓 getCustomerInfo 拋錯,plusPurchase 仍應正常完成。
  await page.evaluate(() => { state.plus.active = false; window.__active = false; window.__throwGetInfo = true; });
  const resilient = await page.evaluate(async () => {
    await plusPurchase('annual'); // getCustomerInfo 拋錯不能讓這裡整個掛掉
    return { active: state.plus.active, error: state.plus.error, purchaseCalls: window.__spy.purchase };
  });
  ok('L7c 付費操作前的重新驗證若上游拋錯,不阻擋原本的購買流程(purchase() 依然執行、資格依然正確寫入)',
    resilient.active === true && resilient.purchaseCalls === 2, JSON.stringify(resilient));

  ok('L7 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 7 節:登出解除 listener(teardown) ══════════════
{
  const { ctx, page } = await newPage(chromiumB, { init: makeAdapterInit(), initArg: { withListener: true, active0: true } });
  const errs = attach(page, 'L8');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await loginAndRefresh(page);
  const pre = await page.evaluate(() => ({ addCalls: window.__spy.addListener, removeCalls: window.__spy.removeListener }));
  ok('L8 前置條件:登入後 listener 已註冊一次、尚未解除', pre.addCalls === 1 && pre.removeCalls === 0, JSON.stringify(pre));

  const post = await page.evaluate(() => {
    accountEndSession(); // 登出清理(accountSignOut 內會呼叫這支;2026-08-04 複審輪2 前叫 accountClearLocal,那個名字現在專指刪除帳號那條會真的清資料的路徑)
    return { removeCalls: window.__spy.removeListener, removedIds: window.__removedIds };
  });
  ok('L8 accountEndSession()(登出清理)⇒ removeCustomerInfoUpdateListener 真的被呼叫一次,帶著註冊時拿到的同一個 id',
    post.removeCalls === 1 && post.removedIds[0] === 'listener-id-1', JSON.stringify(post));

  // 登出後重新登入(同一顆 adapter 物件,uid 換一個)——teardown 有把追蹤變數歸零的話,應該會重新註冊。
  const relogin = await page.evaluate(async (uid) => {
    state.account = { ready: true, user: { uid, email: 'tester2@example.com' }, syncing: false, lastSync: 0, actionError: '', error: '' };
    await plusRefresh();
    return { addCalls: window.__spy.addListener };
  }, 'lifecycle-test-uid-2');
  ok('L8 登出後重新登入 ⇒ listener 重新註冊(addListener 呼叫數變成 2,不是永久卡在解除狀態)',
    relogin.addCalls === 2, JSON.stringify(relogin));

  ok('L8 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 8 節:adapter 不支援 listener 時安全跳過(回歸安全網) ══════════════
// 既有 91 支測試 adapter 全部沒有實作這個方法,這條顯式驗證「沒有能力就跳過」不會拋例外、
// 不影響資格判定本身——這正是全部既有腳本(96+118+35+218+38)仍然全綠的原因,這裡額外補一條
// 直接斷言,不只是隱含在既有回歸裡。
{
  const { ctx, page } = await newPage(chromiumB, { init: makeAdapterInit(), initArg: { withListener: false, active0: true } });
  const errs = attach(page, 'L9');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await loginAndRefresh(page);
  ok('L9 adapter 沒有 addCustomerInfoUpdateListener 方法時,plusRefresh() 正常完成且資格正確(typeof 特性偵測安全跳過,不拋例外)',
    r.active === true, JSON.stringify(r));
  ok('L9 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await chromiumB.close();
server.close();

ok('Z 每顆開出來的 page 都掛上了錯誤收集器(newPage/attach 沒有漏配對)', pagesCreated === pagesAttached, `newPage=${pagesCreated} attach=${pagesAttached}`);
ok('Z 全程 pageerror/console.error 為零', allErrors.length === 0, allErrors.slice(0, 8).join(' | '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name + (f.detail ? ` (${f.detail})` : '')).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
