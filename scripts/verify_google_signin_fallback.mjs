// Android Google 登入「把路補完」行為驗證——Playwright 真引擎 + 本機靜態伺服器。
// 本腳本未參與實作;以下是我從 index.html 讀出、供本腳本判準依據的關鍵事實:
//
//   · accountAndroidNative() = IS_NATIVE_APP && Capacitor.getPlatform() === 'android'。
//     三處共用:15 秒逾時出口的武裝、明確失敗的自動退路、無 GMS 指引。
//   · accountSignIn(providerName, legacy):
//     - 開頭 a.actionError = ''; a.signinStuck = ''; accountRender()。
//     - 原生分支 await RAIL_NATIVE_AUTH.signIn(providerName, legacy)。
//     - catch:google + !legacy + accountAndroidNative() ⇒ 清掉紅字並 return accountSignIn('google', true)。
//              google + legacy + accountAndroidNative() ⇒ a.signinStuck = 'google-nogms'。
//     - finally 清掉 stuckTimer。
//   · accountRender() 只在 a.ready === true && !a.user 時走「未登入」分支,紅字與兩種出口都在那一支。
//     🔴 判準一律量 #accountBody 的實際 DOM,不量 state 欄位——2026-08-30 那個 bug 的形態正是
//     「state 設好了但畫面一個字都沒變」,只量 state 會讓同一類回歸整組全綠通過。
//
// 兩種失敗模式必須分辨清楚(這是本次修法的全部意義):
//   逾時卡住   → PluginCall 永不 settle → 15 秒後 signinStuck='google'  → 「沒有跳出…」+ 退路按鈕
//   明確 reject → 當場拋錯               → 自動改走 legacy;legacy 也死 → 「這台裝置沒有…」指引
// 逾時那條若被自動退路接手,會在使用者面前同時開兩個登入流程(原設計刻意避免)⇒ E 是反向對照。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// 🔴 一定要 fileURLToPath,不可以用 new URL(...).pathname——這個 repo 的路徑含中文(「捷運小動畫」),
//    .pathname 回的是 percent-encoded 字串(%E6%8D%B7…),readFile 一律 ENOENT ⇒ 每個請求 404 ⇒
//    頁面根本沒載入 ⇒ waitReady 逾時。而 404【不會】產生 pageerror,症狀與「stub 少一個端點」
//    完全同形,靠 pageerror 診斷不出來(2026-09-01 實際繞了兩圈才發現)。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 5731);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  // /api/* 預設空物件——但 thsr-schedule 不行:它是主來源,空物件仍是 200 ⇒ fetchJSONAt 視同成功
  // ⇒ 靜態 fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的 sys.data.trains ⇒ boot 停在
  // state.ready 之前,症狀是 waitReady 逾時而 pageerror 一片安靜(慣例見 verify_account_sync_race.mjs)。
  if (p.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (p === '/api/thsr-schedule') return res.end(await readFile(join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  try {
    const buf = await readFile(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, '')));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((ok, no) => { server.on('error', no); server.listen(PORT, ok); });

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

const browser = await chromium.launch();

// platform: 'android' | 'ios' | null(=網站,連 Capacitor 都沒有)
async function openPage(platform) {
  const ctx = await browser.newContext({ locale: 'zh-TW' });
  await ctx.addInitScript(([plat]) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    // IS_NATIVE_APP 是開機當下凍結的 const,但它只看 RAIL_ONLINE_BASEMAPS_AVAILABLE 有沒有定義
    // (index.html 11304),【不需要】Capacitor ⇒ 這裡只放這一顆旗標就夠;Capacitor 與假的
    // RAIL_NATIVE_AUTH 都留到 primeAccount 再裝,讓「這個情境是什麼平台、餵什麼劇本」寫在同一處。
    // (實測過:boot 期間就放假 Capacitor 也無害,三種組合都 0.3 秒內 ready ⇒ 放哪邊都行,
    //  這是可讀性的選擇,不是必要條件。accountAndroidNative() 是呼叫當下才求值。)
    if (plat) window.RAIL_ONLINE_BASEMAPS_AVAILABLE = true;
  }, [platform]);
  const page = await ctx.newPage();
  // 🔴 waitReady 逾時本身零資訊,boot 靜默拋錯才是真因——先掛上,不要往前猜。
  page.on('pageerror', e => console.log('  [pageerror]', String(e && e.message || e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  return { ctx, page };
}

// 面板必須真的處在「未登入且已就緒」,否則 accountRender 會走別的分支 ⇒ 判準量到的是別張畫面。
async function primeAccount(page, plan, platform) {
  await page.evaluate(([plan, plat]) => {
    window.__plan = plan;
    if (plat) {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => plat };
      window.__calls = [];
      window.RAIL_NATIVE_AUTH = {
        signIn(provider, legacy) {
          window.__calls.push({ provider, legacy: !!legacy });
          // 🔴 'ok' 的形狀必須包到 result.credential.idToken——少一層會讓 accountNativeCredential 拋
          //    「原生登入沒有回傳可驗證的 ID token」,成功路徑照樣掉進 catch,看起來像產品在該成功時
          //    也退路,其實是 stub 形狀錯(2026-09-01 誤判過一輪)。
          const p = window.__plan[window.__calls.length - 1];
          if (p === 'hang') return new Promise(() => {});               // 永不 settle
          if (p === 'ok') return Promise.resolve({ credential: { idToken: 'tok' } });
          return Promise.reject(new Error(p === 'fail' ? "Your device doesn't support credential manager" : p));
        }
      };
    }
    accountEnsureInit();
    const a = state.account;
    a.ready = true; a.user = null; a.error = ''; a.actionError = ''; a.signinStuck = '';
    a.auth = {};
    a.fb = {
      GoogleAuthProvider: Object.assign(function () {}, { credential: () => ({ __c: 1 }) }),
      OAuthProvider: function () { this.addScope = () => {}; },
      signInWithCredential: () => Promise.resolve({ user: { uid: 'u' } }),
      signInWithPopup: () => { window.__popup = (window.__popup || 0) + 1; return Promise.resolve({ user: { uid: 'u' } }); }
    };
    accountRender();
  }, [plan, platform]);
}

// 🔴 不要用固定毫秒數等非同步結果:2026-09-01 觀察到一次「檔案未突變卻 B4 紅」,
//    無法重現但成因只可能是時序。等【實際狀態到位】才讀,壞掉時靠 timeout 自己逾時轉紅,
//    不會把 flaky 混進判準裡(逾時後照樣往下讀,該紅的還是紅)。
async function settle(page, expectCalls) {
  if (expectCalls > 0) {
    await page.waitForFunction((n) => (window.__calls || []).length >= n, expectCalls, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(60);   // 讓最後一次 accountRender 落地
}

const seen = (page) => page.evaluate(() => {
  const el = document.getElementById('accountBody');
  const html = el ? el.innerHTML : '';
  const text = el ? el.innerText : '';
  return {
    calls: window.__calls || [],
    popup: window.__popup || 0,
    stuck: state.account ? state.account.signinStuck : '(no account)',
    errText: (html.match(/class="account-error">([^<]*)</) || [, ''])[1],
    // 🔴 數「畫面上有幾條紅字」,不是只抓第一條。2026-09-01 實際踩到:合併把同一段 render
    //    插了兩份在未登入分支裡(main／origin/main／各出貨分支與正式站全中),一次登入失敗
    //    印出兩行一模一樣的紅字,而只抓第一條的判準對這件事完全無感——連「拿掉其中一份」
    //    的突變都照樣全綠。有數量閘門之後,少一份與多一份兩個方向都會轉紅。
    errCount: el ? el.querySelectorAll('.account-error').length : -1,
    // 🔴 量畫面而不是量 state:這兩句必須真的出現在 #accountBody 的文字裡。
    showsNoGms: text.includes('這台裝置的 Google 登入試了兩種方式都不成功'),
    showsTimeoutExit: text.includes('沒有跳出 Google 帳號選擇畫面嗎'),
    hasLegacyBtn: !!(el && el.querySelector('[data-login-legacy="google"]'))
  };
});

// ── A:Android + Credential Manager 明確失敗 ⇒ 自動改走 legacy 並成功 ────────────────
{
  const { ctx, page } = await openPage('android');
  await primeAccount(page, ['fail', 'ok'], 'android');
  await page.evaluate(() => accountSignIn('google'));
  await settle(page, 2);
  const s = await seen(page);
  check('A1 明確失敗會自動再試一次(共 2 發)', s.calls.length === 2, JSON.stringify(s.calls));
  check('A2 第二發是 legacy=true', s.calls[1] && s.calls[1].legacy === true, JSON.stringify(s.calls[1]));
  check('A3 第一發是 legacy=false(沒有一開始就繞過 CM)', s.calls[0] && s.calls[0].legacy === false, JSON.stringify(s.calls[0]));
  check('A4 legacy 成功後畫面不留紅字', s.errText === '', `errText=${JSON.stringify(s.errText)}`);
  check('A5 legacy 成功後不顯示無 GMS 指引', s.showsNoGms === false, `showsNoGms=${s.showsNoGms}`);
  check('A6 legacy 成功後畫面上零條紅字', s.errCount === 0, `errCount=${s.errCount}`);
  await ctx.close();
}

// ── B:Android + 兩條原生路都失敗 ⇒ 紅字 + 指到 Apple 登入 ───────────────────────────
{
  const { ctx, page } = await openPage('android');
  await primeAccount(page, ['fail', 'fail'], 'android');
  await page.evaluate(() => accountSignIn('google'));
  await settle(page, 2);
  const s = await seen(page);
  check('B1 兩條都試過(共 2 發)', s.calls.length === 2, JSON.stringify(s.calls));
  check('B2 畫面顯示無 GMS 指引(量 DOM 文字)', s.showsNoGms === true, `showsNoGms=${s.showsNoGms}`);
  check('B3 指引與逾時出口是不同文案(不會再叫他按同一顆)', s.showsTimeoutExit === false, `showsTimeoutExit=${s.showsTimeoutExit}`);
  check('B4 紅字仍在(錯誤沒有被自動退路吞掉)', /credential manager/i.test(s.errText), `errText=${JSON.stringify(s.errText)}`);
  check('B5 state 與畫面一致', s.stuck === 'google-nogms', `stuck=${s.stuck}`);
  check('B6 紅字恰好一條(未登入分支不得有重複 render)', s.errCount === 1, `errCount=${s.errCount}`);
  await ctx.close();
}

// ── C:反向對照——iOS 除了 platform 之外每一格與 A 完全相同 ─────────────────────────
{
  const { ctx, page } = await openPage('ios');
  await primeAccount(page, ['fail', 'ok'], 'ios');
  await page.evaluate(() => accountSignIn('google'));
  await settle(page, 1);
  const s = await seen(page);
  check('C1 iOS 不自動退路(只 1 發)', s.calls.length === 1, JSON.stringify(s.calls));
  check('C2 iOS 顯示紅字', /credential manager/i.test(s.errText), `errText=${JSON.stringify(s.errText)}`);
  check('C3 iOS 不顯示無 GMS 指引', s.showsNoGms === false, `showsNoGms=${s.showsNoGms}`);
  check('C4 iOS 紅字恰好一條', s.errCount === 1, `errCount=${s.errCount}`);
  await ctx.close();
}

// ── D:反向對照——網站(沒有 RAIL_NATIVE_AUTH)走 signInWithPopup,完全不碰這條 ───────
{
  const { ctx, page } = await openPage(null);
  await primeAccount(page, [], null);
  await page.evaluate(() => accountSignIn('google'));
  await settle(page, 0);
  const s = await seen(page);
  check('D1 網站走 signInWithPopup', s.popup === 1, `popup=${s.popup}`);
  check('D2 網站不顯示無 GMS 指引', s.showsNoGms === false, `showsNoGms=${s.showsNoGms}`);
  await ctx.close();
}

// ── E:反向對照——逾時那條【不可】被自動退路接手(原設計:分不出卡死與還在選帳號) ────
{
  const { ctx, page } = await openPage('android');
  await primeAccount(page, ['hang'], 'android');
  await page.evaluate(() => { accountSignIn('google'); });
  await page.waitForTimeout(2000);
  const mid = await seen(page);
  check('E1 卡住時不會自作主張再開一發', mid.calls.length === 1, JSON.stringify(mid.calls));
  await page.waitForFunction(() => state.account && state.account.signinStuck === 'google', null, { timeout: 20000 })
    .catch(() => {});
  const s = await seen(page);
  check('E2 15 秒後出現逾時出口(原有行為未被破壞)', s.showsTimeoutExit === true, `stuck=${s.stuck}`);
  check('E3 逾時出口帶得動 legacy 的按鈕', s.hasLegacyBtn === true, `hasLegacyBtn=${s.hasLegacyBtn}`);
  check('E4 逾時走的不是無 GMS 那條文案', s.showsNoGms === false, `showsNoGms=${s.showsNoGms}`);
  await ctx.close();
}

// ── F:反向對照——Credential Manager 成功時不該有第二發 ──────────────────────────────
{
  const { ctx, page } = await openPage('android');
  await primeAccount(page, ['ok'], 'android');
  await page.evaluate(() => accountSignIn('google'));
  await settle(page, 1);
  const s = await seen(page);
  check('F1 成功時只有 1 發', s.calls.length === 1, JSON.stringify(s.calls));
  check('F2 成功時無紅字', s.errText === '', `errText=${JSON.stringify(s.errText)}`);
  check('F3 成功時無任何出口', s.showsNoGms === false && s.showsTimeoutExit === false, `nogms=${s.showsNoGms} timeout=${s.showsTimeoutExit}`);
  check('F4 成功時畫面上零條紅字', s.errCount === 0, `errCount=${s.errCount}`);
  await ctx.close();
}

await browser.close();
server.close();

let bad = 0;
for (const r of results) { if (!r.pass) bad++; console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.pass ? '' : '  ← ' + r.detail}`); }
console.log(`\n合計 ${results.length - bad}/${results.length}`);
process.exit(bad ? 1 : 0);
