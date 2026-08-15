// 捷運小工具通行證旗標的「同步」回歸——Playwright 真引擎 + 本機靜態伺服器。
//
// 為什麼要有這一支(2026-08-16 使用者實機回報:「登出後還是可以選擇最近的站,也可以同時放好多個
// 小工具」,裝機 1.4.5 build 60,閘門早在 build 58 之前就進去了):
//
//   小工具的閘門判定住在 extension(MetroPlusGate/MetroPlusCore),它讀 App Group 的
//   metro.plusActive;那顆旗標【只能】由 App 的網頁端推。已經有 verify_metro_plus_gate.mjs 在守
//   「拿到旗標之後判得對不對」,但**沒有任何判準在守「旗標本身有沒有跟著資格走」**——
//   metroWidgetSyncPlus() 當時只有一個呼叫端(plusApplyCustomerInfo),於是:
//     · 登出(accountForgetIdentity)把 state.plus.active 歸零,卻沒推給小工具 ⇒ 旗標永遠停在 true
//     · 到期/退費(plusRefresh 拿到明確的 false)同樣沒推
//     · 反向也壞:購買/恢復購買成功後也沒推 ⇒ 付了錢的人小工具還鎖著
//   而 MetroPlusCore.decide 第一行就是 `if plus { return .allowed }` ⇒ 一顆過期的 true
//   同時解開「自動選站」與「多站」兩個閘門,正是使用者看到的兩個症狀。
//
// 判準刻意驗【行為】不驗原始碼字面:量的是「原生 plugin 的 setPlus 到底被呼叫了幾次、帶什麼值」,
// 不是「index.html 裡有沒有出現 metroWidgetSyncPlus 這串字」——後者對「呼叫了但值是錯的」
// 完全沒有牙(判準盲點:斷言落在受測物下游)。
//
// 依據的既有事實(讀 index.html 得到,本腳本未參與實作):
//   · metroWidgetSyncPlus(active) 走 window.Capacitor.Plugins.RailMetroWait.setPlus({active});
//     非原生殼/舊版原生殼(沒有這支 plugin)一律靜默略過。故這裡把 Capacitor 打樁成
//     **只有 Plugins.RailMetroWait、沒有 isNativePlatform**——index.html 全部 12 處
//     window.Capacitor 讀取都寫成 `Capacitor.isNativePlatform && Capacitor.isNativePlatform()`,
//     少了那支就一律落回網站模式,不會把頁面誤切成原生殼(PLUS_ENABLED 改由 ?plus=1 提供)。
//   · window.RAIL_PLUS_TEST_ADAPTER 短路 plusAdapterFor(既有慣例)。
//   · window.RAIL_FIREBASE_TEST_MODULES 短路 Firebase SDK,onAuthStateChanged 可自行決定
//     解出 user 或 null(既有慣例,見 verify_plus_refresh_lifecycle.mjs 第 1 節)。
//   · accountEndSession() 是登出的清理入口(accountSignOut 內呼叫它)。
//
// 🔴 M1 是**正向對照組**:它走的是修復前就已經會同步的那條路(listener → plusApplyCustomerInfo)。
//    沒有它,其餘「setPlus 應該被呼叫」的斷言在「打樁根本沒接上」時會一起假綠。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G0 自檢(心得 32:驗收腳本第一道 gate 要印出驗的是哪個目錄):ROOT 由本檔自身路徑推導,
// 不吃任何 --root/env 參數,結構上不會誤驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const PORT = Number(process.env.PORT || 5471); // 30+ worktree 並行,埠位可覆寫(既有慣例)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    // 高鐵班表:空物件會讓 applySchedSystems 拋錯、boot 停在 state.ready 之前(見 lifecycle 腳本同段註解)
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });
const BASE = `http://localhost:${PORT}/?plus=1`; // Plus 觸發面受 PLUS_ENABLED 止血旗標保護(既有測試開關)

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

let pagesCreated = 0, pagesAttached = 0;
const allErrors = [];
function attach(page, tag) {
  const local = [];
  pagesAttached++;
  page.on('pageerror', e => { local.push(`[${tag}] pageerror ${e.message}`); allErrors.push(`[${tag}] ${e.message}`); });
  page.on('console', m => { if (m.type() === 'error') { local.push(`[${tag}] console ${m.text()}`); allErrors.push(`[${tag}] ${m.text()}`); } });
  return local;
}
async function newPage(browser, { init = null, initArg } = {}) {
  pagesCreated++;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  if (init) await ctx.addInitScript(init, initArg);
  return { ctx, page: await ctx.newPage() };
}
async function waitReady(page) {
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}
// 環境打樁(錄音器＋測試 adapter)。🔴 addInitScript 把函式序列化後在頁面裡跑,引用不到本檔的
// 外層繫結 ⇒ 一切都得寫在這一支函式體內;要分情境就靠 arg,不要拆成兩支互相呼叫。
//   · 錄音器:每一發 setPlus 的值都留下來,判準看的是「呼叫序列」而不是最終狀態。
//   · Capacitor 刻意【不給】isNativePlatform:index.html 全部讀取點都寫成
//     `Capacitor.isNativePlatform && Capacitor.isNativePlatform()`,少了它就一律落回網站模式。
const STUB = (arg) => {
  window.__setPlusCalls = [];
  window.Capacitor = {
    Plugins: {
      RailMetroWait: {
        setPlus: async ({ active }) => { window.__setPlusCalls.push(active); return { ok: true }; },
      },
    },
  };
  window.__active = !!(arg && arg.active0);
  window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
  const info = () => ({ entitlements: { active: window.__active ? { plus: { identifier: 'plus' } } : {} }, managementURL: '' });
  // M6 要走真的 plusPurchase(),它需要 p.pkgMonthly ⇒ offerings 必須真的有 package。
  const offering = { availablePackages: [
    { identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: 'STUB-MONTH' } } },
    { identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: 'STUB-YEAR' } } },
  ] };
  window.RAIL_PLUS_TEST_ADAPTER = {
    setUser: async () => {}, getCustomerInfo: async () => info(),
    getOfferings: async () => ({ all: { plus: offering }, current: offering }),
    purchase: async () => { window.__active = true; return { customerInfo: info() }; },
    restore: async () => ({ customerInfo: info() }),
    addCustomerInfoUpdateListener: async cb => { window.__listenerCb = cb; return 'lid-1'; },
    removeCustomerInfoUpdateListener: async () => {},
  };
  if (arg && arg.guestBoot) {
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' }; // accountConfigured() 要求的三欄
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      onAuthStateChanged: (auth, cb) => { setTimeout(() => cb(null), 50); }, // 明確解出「沒有登入」
    };
    // returning＝本機留著 ACCOUNT_UID_KEY(accountReturning() 讀的就是這把)。兩條 boot 路徑完全不同:
    //   false ⇒ setupAccountUi() 走匿名分支,Firebase 根本不初始化,onAuthStateChanged 永遠不會來
    //   true  ⇒ 走 accountEnsureInit(),auth 非同步解出 null(伺服器端讓 session 失效即長這樣)
    if (arg.returning) { try { localStorage.setItem('trainmap-account-uid', 'stale-uid'); } catch (e) {} }
  }
};
const login = (page, uid = 'sync-uid') => page.evaluate(async (uid) => {
  state.plus = null;
  state.account = { ready: true, gen: 1, user: { uid, email: 't@example.com' }, syncing: false, lastSync: 0, actionError: '', error: '' };
  await plusRefresh();
}, uid);
const snap = page => page.evaluate(() => ({
  calls: window.__setPlusCalls.slice(),
  last: window.__setPlusCalls.length ? window.__setPlusCalls[window.__setPlusCalls.length - 1] : null,
  active: plusIsActive(),
}));

const B = await chromium.launch();

// ═════ M1 正向對照組:修復前就會同步的那條路(listener → plusApplyCustomerInfo) ═════
// 這條若不綠,底下所有「setPlus 應該被呼叫」的斷言都只是在驗「打樁沒接上」。
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: true } });
  const errs = attach(page, 'M1');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await login(page);
  await page.evaluate(() => plusApplyCustomerInfo({ entitlements: { active: { plus: { identifier: 'plus' } } } }));
  const r = await snap(page);
  ok('M1(正向對照)plusApplyCustomerInfo(有資格)⇒ setPlus 真的被呼叫、且帶 true',
    r.calls.includes(true), JSON.stringify(r));
  ok('M1 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═════ M2 登入且有資格:plusRefresh 拿到明確的 true ⇒ 要推 true ═════
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: true } });
  const errs = attach(page, 'M2');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await login(page);
  const r = await snap(page);
  ok('M2 plusRefresh() 拿到明確資格(true)⇒ 旗標推給小工具的最後一發是 true',
    r.last === true && r.active === true, JSON.stringify(r));
  ok('M2 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═════ M3 登出(使用者回報的那條):accountEndSession ⇒ 必須推 false ═════
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: true } });
  const errs = attach(page, 'M3');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await login(page);
  const before = await snap(page);
  await page.evaluate(() => { accountEndSession(); });
  await page.waitForTimeout(150);
  const after = await snap(page);
  ok('M3 登出(accountEndSession → accountForgetIdentity)⇒ 旗標推給小工具的最後一發是 false',
    after.last === false, `登出前=${JSON.stringify(before)} 登出後=${JSON.stringify(after)}`);
  ok('M3 不變式:登出後 App 自己的 plusIsActive() 與推給小工具的值一致',
    after.active === false && after.last === after.active, JSON.stringify(after));
  ok('M3 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═════ M4 到期/退費:仍登入,但上游改口說沒有資格 ⇒ 必須推 false ═════
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: true } });
  const errs = attach(page, 'M4');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await login(page);
  await page.evaluate(async () => { window.__active = false; await plusRefresh(); });
  const r = await snap(page);
  ok('M4 資格到期/退費(plusRefresh 拿到明確的 false)⇒ 旗標推給小工具的最後一發是 false',
    r.last === false && r.active === false, JSON.stringify(r));
  ok('M4 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═════ M5 冷啟動就是訪客(從沒登入):auth 明確解出「沒有身分」⇒ 必須推 false ═════
// 🔴 這條是「更新即關」的唯一保障:已經處於登出狀態的人不會再觸發一次登出,
//    只靠 M3 那條的話,他們裝了修好的版本、旗標照樣停在舊的 true。
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: true, guestBoot: true } });
  const errs = attach(page, 'M5');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(1500); // 等 onAuthStateChanged 的非同步 callback 跑完
  const r = await snap(page);
  ok('M5 冷啟動且 auth 明確說沒有身分 ⇒ 旗標至少被推過一次 false(更新即關)',
    r.calls.includes(false), JSON.stringify(r));
  ok('M5 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═════ M6 反向(付了錢卻鎖著):購買成功 ⇒ 必須推 true ═════
// 🔴 刻意走 plusPurchase() 而不是 plusRestore():後者開頭的 plusRevalidateBeforeAction() 會先
//    getCustomerInfo 一次,測試若在呼叫前就把 __active 翻成 true,那一發【修復前就會】經由
//    plusApplyCustomerInfo 推 true ⇒ 判準恆綠、零牙。購買則是「資格只在 purchase() 內部才成立」,
//    revalidate 那一發看到的仍是 false,唯有購買結果那一段推了才會綠。
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: false } });
  const errs = attach(page, 'M6');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await login(page); // active0=false ⇒ 此時應為未訂閱
  const before = await snap(page);
  await page.evaluate(async () => { await plusPurchase('month'); });
  const after = await snap(page);
  ok('M6 購買成功拿到資格 ⇒ 旗標推給小工具的最後一發是 true(修復前:付了錢小工具還鎖著)',
    after.last === true && after.active === true, `購買前=${JSON.stringify(before)} 購買後=${JSON.stringify(after)}`);
  ok('M6 不變式:購買後 App 自己的 plusIsActive() 與推給小工具的值一致',
    after.last === after.active, JSON.stringify(after));
  ok('M6 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═════ M7 回訪裝置但 auth 明確解出 null(伺服器端讓 session 失效)⇒ 必須推 false ═════
// 與 M5 是兩條不同的 boot 路徑(見 STUB 內 returning 註解):M5 連 Firebase 都不初始化,
// M7 才會真的走到 onAuthStateChanged 的 null 分支。少驗任何一條,那一條的修正就沒有判準守著。
{
  const { ctx, page } = await newPage(B, { init: STUB, initArg: { active0: true, guestBoot: true, returning: true } });
  const errs = attach(page, 'M7');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(1500); // 等 onAuthStateChanged 的非同步 callback 跑完
  const r = await snap(page);
  ok('M7 回訪裝置、auth 解出 null(session 失效)⇒ 旗標至少被推過一次 false',
    r.calls.includes(false), JSON.stringify(r));
  ok('M7 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await B.close();
server.close();

// ═════ 收尾閘門 ═════
ok('G9 每一顆開出來的 page 都掛了錯誤收集器(新增情境忘記 attach 會讓例外全程隱形)',
  pagesCreated === pagesAttached, `created=${pagesCreated} attached=${pagesAttached}`);
// 情境增減時同步改這個數字——分母無聲縮水必須是 FAIL(心得 37d)。
// 數的是「G10 自己被 push 之前」的總數:M1×2 M2×2 M3×3 M4×2 M5×2 M6×3 M7×2 ＝16,加 G9 ＝17。
const EXPECTED = 17;
ok('G10 斷言總數閘門', results.length === EXPECTED, `實得=${results.length} 期望=${EXPECTED}`);

const failed = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項，PASS ${results.length - failed.length}，FAIL ${failed.length}`);
if (allErrors.length) console.log(`頁面錯誤 ${allErrors.length} 則：\n  ${allErrors.slice(0, 5).join('\n  ')}`);
if (failed.length) { console.log('\n未通過：'); failed.forEach(f => console.log(`  · ${f.name}${f.detail ? ' — ' + f.detail : ''}`)); }
process.exit(failed.length ? 1 : 0);
