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
//       (accountClearLocal)時解除註冊。
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
//
// ── 複審修復批次補充(L10-L13、COUNT-GATE,本輪新增,原 33 條 L1-L9/Z 不動)──
//   · L10(Important-1):plusEnsureListener 的 addCustomerInfoUpdateListener callback 簽章從
//     `info =>` 改成 `(info, err) =>`,err 有值或 info 不成形時直接 return、不動 state.plus——
//     Capacitor keep-alive callback 失敗路徑逐字是 `storedCall.callback(null, result.error)`
//     (app/node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js:962-966)。
//   · L11(Minor-2):註冊回傳 falsy id(cap.toNative 失敗回 null,native-bridge.js:928)時新增
//     `if (!id) return;`,不落地 plusListenerId/plusListenerAdapter——直接讀這兩個頂層 let 變數
//     (與 state 一樣是裸露全域繫結,page.evaluate 可直接引用,無須額外 hook)。
//   · L12/L13(Minor-1):plusRefresh() 的 `!plusConfigured()`(網站)分支補上 p.loading 早退守衛,
//     解決快速反覆回前景時多個 fetch 併發、回應可能亂序覆寫 p.active 的風險。L12 直接呼叫
//     plusRefresh() 驗守衛本身,L13 走真實的 visibilitychange 事件端到端驗證。
//   · COUNT-GATE(Important-2):斷言總數閘門,形狀照抄 verify_founding_seal.mjs:1003-1010。
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
      try { localStorage.setItem('trainmap-last-sync-uid', arg.uid); } catch (e) {} // accountReturning()===true
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
  ok('L2 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | ')); // 掛在 L2(此區塊最後一條編號斷言)名下,供下方 G9 風格斷言總數閘門分組
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
    accountClearLocal(); // 登出清理(accountSignOut 內會呼叫這支)
    return { removeCalls: window.__spy.removeListener, removedIds: window.__removedIds };
  });
  ok('L8 accountClearLocal()(登出清理)⇒ removeCustomerInfoUpdateListener 真的被呼叫一次,帶著註冊時拿到的同一個 id',
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

// ══════════════ 第 9 節(複審 Important-1):listener 回呼——原生端錯誤/不成形 info 不得被讀成「沒訂閱」══════════════
// Capacitor keep-alive callback 的失敗路徑逐字是 (null, error)(見 native-bridge.js:962-966,
// index.html plusEnsureListener 內修復註解逐字引用同一段)。這裡故意餵三種「查不到」的輸入
// (err/info 為 null/info 缺 entitlements),證明都不會被讀成「沒訂閱」,並用同一顆 callback 做
// 正向對照(合法的、entitlement 已消失的 CustomerInfo 仍然會讓 active 真的變 false)——證明
// 上面三條「不變」不是因為這條路徑整個死掉。
{
  const { ctx, page } = await newPage(chromiumB, {
    init: () => { window.RAIL_APP_CONFIG = { satRetina: true }; }, // 讓 satRetinaAllowed() 反映 plusIsActive(),見檔頭引用
  });
  const errs = attach(page, 'L10');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.evaluate(() => {
    window.__spy = { addListener: 0 };
    window.__listenerCb = null;
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {},
      getCustomerInfo: async () => ({ entitlements: { active: { plus: { identifier: 'plus' } } } }),
      getOfferings: async () => ({ all: {}, current: null }),
      purchase: async () => ({}), restore: async () => ({ entitlements: { active: {} } }),
      addCustomerInfoUpdateListener: async cb => { window.__spy.addListener++; window.__listenerCb = cb; return 'l10-id'; },
      removeCustomerInfoUpdateListener: async () => {},
    };
  });
  await loginAndRefresh(page);
  const pre = await page.evaluate(() => ({ active: state.plus.active, satRetina: satRetinaAllowed(), listenerRegistered: window.__spy.addListener === 1 }));
  ok('L10 前置條件:訂閱中 ⇒ active/satRetinaAllowed()===true 且 listener 已註冊(不是本來就假,下面的「不變」才有意義)',
    pre.active === true && pre.satRetina === true && pre.listenerRegistered === true, JSON.stringify(pre));

  const r1 = await page.evaluate(() => { window.__listenerCb(null, new Error('模擬原生端 reject(如 Android rejectIfNotConfigured)')); return { active: state.plus.active, satRetina: satRetinaAllowed() }; });
  ok('L10a listener 回呼帶原生錯誤 (null, error) ⇒ state.plus.active 維持不變(不被讀成「沒訂閱」)',
    r1.active === true && r1.satRetina === true, JSON.stringify(r1));

  const r2 = await page.evaluate(() => { window.__listenerCb(null); return { active: state.plus.active }; });
  ok('L10b listener 回呼 info 為 null(無 error 物件,只是沒有答案)⇒ state.plus.active 維持不變',
    r2.active === true, JSON.stringify(r2));

  const r3 = await page.evaluate(() => { window.__listenerCb({}); return { active: state.plus.active }; });
  ok('L10c listener 回呼 info 不成形(缺 entitlements)⇒ state.plus.active 維持不變',
    r3.active === true, JSON.stringify(r3));

  const r4 = await page.evaluate(() => { window.__listenerCb({ entitlements: { active: {} } }); return { active: state.plus.active, satRetina: satRetinaAllowed() }; });
  ok('L10d 正向對照:同一顆 callback 餵一份合法、entitlement 已消失的 CustomerInfo(無 error)⇒ active 真的變 false,satRetinaAllowed() 真的關閉(證明這條路徑活著,不是整條死了才不變)',
    r4.active === false && r4.satRetina === false, JSON.stringify(r4));

  ok('L10 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 10 節(複審 Minor-2):註冊回傳 falsy id 不落地追蹤變數 ══════════════
// cap.toNative 內部失敗會回傳 null 當 callbackId(native-bridge.js:928)。修復前 plusListenerId=id
// (unconditional)⇒ id 為 null 時仍會把 plusListenerAdapter 設成真物件,造成「id 是 null 但
// adapter 卻是真物件」的不一致狀態。直接讀模組級變數 plusListenerId/plusListenerAdapter(頂層 let
// 宣告,與 state 一樣是這個執行環境的裸露全域繫結,無須額外的測試專用 hook)。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'L11');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.evaluate(() => {
    window.__spy = { addListener: 0 };
    window.__L11_adapter = {
      setUser: async () => {},
      getCustomerInfo: async () => ({ entitlements: { active: {} } }),
      addCustomerInfoUpdateListener: async () => { window.__spy.addListener++; return window.__spy.addListener === 1 ? null : 'l11-real-id'; },
      removeCustomerInfoUpdateListener: async () => {},
    };
  });
  const after1 = await page.evaluate(async () => {
    await plusEnsureListener(window.__L11_adapter);
    return { id: plusListenerId, hasAdapter: !!plusListenerAdapter, calls: window.__spy.addListener };
  });
  ok('L11a 註冊回傳 falsy id(模擬 cap.toNative 失敗)⇒ plusListenerId 與 plusListenerAdapter 都維持 null(不落地「id 是 null、adapter 卻是真物件」的不一致狀態)',
    after1.id === null && after1.hasAdapter === false && after1.calls === 1, JSON.stringify(after1));

  const after2 = await page.evaluate(async () => {
    await plusEnsureListener(window.__L11_adapter);
    return { id: plusListenerId, hasAdapter: !!plusListenerAdapter, calls: window.__spy.addListener };
  });
  ok('L11b 正向對照:同一顆 adapter 下一次註冊成功拿到真 id ⇒ 正確落地(falsy id 沒有把後續合法註冊卡死)',
    after2.id === 'l11-real-id' && after2.hasAdapter === true && after2.calls === 2, JSON.stringify(after2));

  ok('L11 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 11 節(複審 Minor-1):網站路徑的併發 refresh 守衛 ══════════════
// 網站上 plusConfigured() 恆假,C-4 的 visibilitychange 每次回前景都 fire-and-forget 呼叫
// plusRefresh();快速反覆觸發若沒有守衛,多個 fetch 會同時在飛,回應可能亂序覆寫 p.active。
// 修法是在 !plusConfigured() 分支也設 p.loading,讓函式頂端既有的 `if (p.loading) return false;`
// 早退守衛生效。plusRefresh() 在第一個 await(getIdToken/fetch)之前就同步把 p.loading 設成
// true,故「不 await 就連續呼叫兩次」足以確定性地讓第二次撞上守衛,不需要真的操弄回應時序
// (時序操弄本身容易變成不穩定的計時假設;這裡用同步呼叫順序讓結果變成確定性的)。
{
  const { ctx, page } = await newPage(chromiumB, {
    init: () => { window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' }; }, // 故意不設 webApiKey/adapter ⇒ plusConfigured() 恆假,走網站分支
  });
  const errs = attach(page, 'L12');
  let reqCount = 0;
  page.on('request', req => { if (req.url().includes('/api/plus-status')) reqCount++; });
  await page.route('**/api/plus-status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: true }) }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  // state.account 刻意比照 verify_plus_features.mjs 的 fakeAccount 手法(fb:{} + user.getIdToken):
  // plusRefresh() 網站分支讀 state.account.fb.getIdToken,缺這個殼會在測試本身就先拋例外。
  await page.evaluate(() => {
    state.plus = null;
    state.account = { ready: true, user: { uid: 'l12-uid', email: 't@example.com', getIdToken: async () => 'FAKE_TOKEN' }, fb: {}, syncing: false, lastSync: 0, actionError: '', error: '' };
  });
  ok('L12 前置條件:尚未呼叫 plusRefresh() 前零個 /api/plus-status 請求', reqCount === 0, `reqCount=${reqCount}`);

  const concurrent = await page.evaluate(async () => {
    const p1 = plusRefresh();
    const p2 = plusRefresh(); // 不 await p1,緊接著同步呼叫第二次——p1 已在第一個 await 前同步把 p.loading 設成 true
    const [r1, r2] = await Promise.all([p1, p2]);
    return { r1, r2 };
  });
  await page.waitForTimeout(50); // 讓 Playwright 的 request 事件與頁面內 Promise 解決同步落定
  ok('L12a 網站路徑併發呼叫 plusRefresh():同時只有一個請求真的發出去(第二次撞上 p.loading 守衛,回傳 false)',
    reqCount === 1 && concurrent.r2 === false, `reqCount=${reqCount} ${JSON.stringify(concurrent)}`);
  ok('L12a 正向對照:先發的那一次仍然正常完成、真的拿到後端答案(守衛沒有連帶把第一次也擋掉)',
    concurrent.r1 === true, JSON.stringify(concurrent));

  // 正向對照:第一輪完全結束(p.loading 已重置)後再呼叫一次,應該要發出「新的」請求——
  // 證明守衛只擋真正同時在飛的那一刻,不是把這顆 adapter/使用者永久卡住。
  const again = await page.evaluate(() => plusRefresh());
  await page.waitForTimeout(50);
  ok('L12b 正向對照:第一輪完全結束後再呼叫一次 ⇒ 真的發出新的請求(守衛不是永久卡死,只擋真正併發的那一刻)',
    reqCount === 2 && again === true, `reqCount=${reqCount} again=${again}`);

  ok('L12 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ 第 12 節(複審 Minor-1,端到端):快速反覆回前景的真實觸發路徑只會落地一個請求 ══════════════
// 與第 11 節不同:這裡不直接呼叫 plusRefresh(),改成真的掛上 accountEnsureInit() 註冊的
// visibilitychange 監聽器,再連續 dispatch 3 次事件——驗證的是「使用者反覆切換前景」這個真實
// 觸發路徑本身,不只是 plusRefresh() 這個函式的守衛。
{
  const { ctx, page } = await newPage(chromiumB, {
    init: () => { window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' }; },
  });
  const errs = attach(page, 'L13');
  let reqCount = 0;
  page.on('request', req => { if (req.url().includes('/api/plus-status')) reqCount++; });
  await page.route('**/api/plus-status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: true }) }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.evaluate(() => {
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = { initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}), onAuthStateChanged: () => {} };
  });
  await page.evaluate(async () => { await accountEnsureInit(); }); // 掛上真正的 visibilitychange 監聽器,不觸發真登入
  await page.evaluate(() => {
    state.plus = null;
    state.account = { ready: true, user: { uid: 'l13-uid', email: 't@example.com', getIdToken: async () => 'FAKE_TOKEN' }, fb: {}, syncing: false, lastSync: 0, actionError: '', error: '' };
  });
  const beforeCount = reqCount;
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 400)); // 讓 fire-and-forget 的 plusRefresh() 有時間跑完
  });
  await page.waitForTimeout(50);
  ok('L13 端到端:連續 dispatch 3 次 visibilitychange(模擬反覆切換前景)⇒ 只多發出 1 個 /api/plus-status 請求,不是 3 個',
    reqCount === beforeCount + 1, `before=${beforeCount} after=${reqCount}`);
  ok('L13 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await chromiumB.close();
server.close();

ok('Z 每顆開出來的 page 都掛上了錯誤收集器(newPage/attach 沒有漏配對)', pagesCreated === pagesAttached, `newPage=${pagesCreated} attach=${pagesAttached}`);
ok('Z 全程 pageerror/console.error 為零', allErrors.length === 0, allErrors.slice(0, 8).join(' | '));

// ═══════════════ 斷言總數閘門(複審 Important-2,形狀照抄 verify_founding_seal.mjs:1003-1010) ═══════════════
// 為什麼需要:條件式區塊(如 L10 的 if (sigMatch) 之類、或整節被誤刪)一旦前置條件不成立,斷言是
// 「整批從結果集消失」而不是「變紅」,分母悄悄變小,「N/N PASS」看起來一模一樣漂亮。斷言數本身
// 就是要被守住的東西,所以下面這張表是刻意手寫的:新增/刪除斷言時必須同步改它——改不動就代表
// 有東西沒被跑到,那正是這道閘門要攔的。
// (表不含這條閘門自己;它在把自己 push 進去之前先數,所以不會自我計數——同founding_seal.mjs 手法。)
const EXPECTED_COUNTS = { L1: 1, L2: 2, L3: 2, L4: 6, L5: 3, L6: 4, L7: 7, L8: 4, L9: 2, L10: 6, L11: 3, L12: 5, L13: 2, Z: 2 };
const actualCounts = {};
// `\d+`(不是 `\d`):只吃一位數的話,日後加的 L10 會被歸進 L1 ⇒ L1 被灌水,而 L10 自己少跑幾條
// 反而不會紅——一道用來防假綠的閘門自己製造假綠(同 founding_seal.mjs 的理由)。字母尾碼
// (L7a/L7b/L7c)刻意併入同一個數字群組(L7),與既有 G1.7/G1.7b 用點號後綴的做法異曲同工。
for (const r of results) { const m = /^(L\d+|Z)/.exec(r.name); const k = m ? m[1] : '(未分組)'; actualCounts[k] = (actualCounts[k] || 0) + 1; }
const groupKeys = [...new Set([...Object.keys(EXPECTED_COUNTS), ...Object.keys(actualCounts)])].sort();
const countMismatch = groupKeys.filter(g => (EXPECTED_COUNTS[g] || 0) !== (actualCounts[g] || 0));
ok('COUNT-GATE 斷言總數閘門:每組實跑條數符合預期(條件式區塊整批消失時,分母變小不會被當成全綠)',
  countMismatch.length === 0,
  countMismatch.length
    ? countMismatch.map(g => `${g}:預期 ${EXPECTED_COUNTS[g] || 0} 實跑 ${actualCounts[g] || 0}`).join(' ; ')
    : groupKeys.map(g => `${g}=${actualCounts[g]}`).join(' '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name + (f.detail ? ` (${f.detail})` : '')).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
