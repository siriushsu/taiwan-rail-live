// 衛星高解析(Retina)接 entitlement 驗證(2026-08-02,Plus 開賣 Task 3)——Playwright 真引擎 + 本機靜態伺服器。
// 背景:衛星本體維持免費;Retina(detectRetina,圖磚量約 4 倍)收斂成 Plus 專屬。
//   satRetinaAllowed() = SAT_RETINA(平台端「建不建得出高解析層」總開關,Esri 額度止血用)
//     && !!(state.plus && state.plus.active)(訂閱資格)——兩者是 AND。
//   setBasemap() 依此在 baseLayers.sat(detectRetina)／baseLayers.satLQ(標準解析)間二選一;
//   跟車中(state.followTrain)不論資格一律標準解析(4 倍圖磚量拖慢跟車鏡頭)。
//
// 判準(Step 8 原文):量「實際發出的圖磚請求 z 值」,不量畫面糊不糊——外部可觀測事實,
//   不與實作共用推導假設(心得29)。Leaflet TileLayer 的 detectRetina 只在瀏覽器
//   devicePixelRatio>1(L.Browser.retina)時才會把請求 z 墊高一階,故全程用 deviceScaleFactor≥2
//   的 context。
//
// 環境變數刻意全程固定,只讓「Plus 資格 / 跟車」在情境間變動:
//   - APP_CFG.satRetina 全程注入 true(=index.html 的 SAT_RETINA 平台開關開著,對應 App 端
//     prepare-web.mjs 的 satRetina:true,或網站端額度止血開關重開後的狀態)。
//     若讓「匿名」情境跑在網站現行預設(SAT_RETINA=false)、只讓「Plus」情境開 true,
//     Step 9 的突變測試會測不出資格判準被拔掉——SAT_RETINA 本身已經是 false,
//     mutation 後 satRetinaAllowed()=SAT_RETINA 對匿名情境仍是 false,情境 1 不會轉紅,
//     判準等於沒有牙(心得29:判準的真值來源不得與被驗對象共用同一個會變動的旗標)。
//   - deviceScaleFactor 全程 ≥2,否則 detectRetina 對誰都不生效,情境 3/4 測不出差異。
//   - Esri 圖磚全程用 page.route 攔截並回應本機小圖(絕不打真正的 ibasemaps-api,不需要真
//     token)——圖磚是按張計費的,驗收不該燒真額度,也不該依賴外部服務的可用性。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G0 自檢(心得32/verify_plus_subscription.mjs 既有慣例):ROOT 由本檔自身路徑推導,不吃任何
// --root/env 參數,結構上不會誤驗到別的 worktree(30+ 個並行)——伺服器就是直接 readFileSync
// 這個 ROOT 底下的檔案,不是連去某個可能屬於別人 session 的既有 dev server。副作用:本檔可以
// 原封不動複製進 Step 9 的隔離 worktree 做突變測試,ROOT 會自動跟著指向那一棵、md5 也會如實
// 印出「這次驗的是被動過手腳的那份」,不是誤植一個「必須等於當前工作區」的斷言把突變測試堵死。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const PORT = Number(process.env.PORT || 5233);
const ESRI_TOKEN = 'FAKE_TEST_TOKEN_NOT_REAL';
// 1x1 透明 PNG,讓被攔截的 <img> 觸發 load 不是 error(避免 Leaflet tileerror 干擾/汙染 console 斷言)。
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/basemap-token') { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ esri: ESRI_TOKEN })); }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const base = `http://localhost:${PORT}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// 開一頁:固定 SAT_RETINA=true(見檔頭理由)+ deviceScaleFactor(detectRetina 生效的必要條件)+
// 攔截 Esri 圖磚請求記錄 z、不打真網路、也不需要真 token。
async function boot(browser, { touch = false, width = 1280, height = 800, dsf = 2, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} // 蓋掉首訪教學卡(既有 E2E 慣例,見 afr-alishan-forest-railway 記憶)
    window.RAIL_APP_CONFIG = { satRetina: true }; // SAT_RETINA 平台開關固定 true,理由見檔頭
  });
  const zooms = [];
  await ctx.route(/ibasemaps-api\.arcgis\.com/, route => route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }));
  const page = await ctx.newPage();
  // 判準原文(Step 8):非 Plus 時 z===map.getZoom();Plus 時 detectRetina 會抓 z+1。
  page.on('request', r => {
    const m = r.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
    if (m) zooms.push(Number(m[1]));
  });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
  await page.goto(base + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForFunction(() => { try { return typeof satTokenState !== 'undefined' && satTokenState === 'ready'; } catch (e) { return false; } }, null, { timeout: 10000 });
  return { ctx, page, zooms, errors };
}

// satBtn 在桌面通常直接可見;手機可能收在「更多」抽屜,proxy row 點擊會轉發 btn.click()
// (index.html syncMoreSheet 區塊:btn.click()),兩條路徑走到的都是同一個 onclick,故都可驗。
async function openSatellite(page, touch) {
  const act = async sel => { if (touch) await page.tap(sel); else await page.click(sel); };
  const visible = await page.evaluate(() => { const b = document.getElementById('satBtn'); return !!(b && b.offsetParent); });
  if (visible) { await act('#satBtn'); }
  else {
    await act('#tabMore');
    await page.waitForSelector('.ms-row[data-proxy="satBtn"]', { state: 'visible', timeout: 5000 });
    await act('.ms-row[data-proxy="satBtn"]');
  }
  await page.waitForFunction(() => state.basemap === 'sat', null, { timeout: 5000 });
}
async function followAnyTrain(page) {
  return page.evaluate(() => {
    const tr = state.trains.find(t => t.sys === 'tra_sched') || state.trains[0];
    if (!tr) return null;
    followTrainNo(String(tr.train), { sys: tr.sys });
    return state.followTrain ? { no: String(state.followId), sys: tr.sys } : null;
  });
}
function classify(zooms, zoom) {
  return {
    total: zooms.length,
    base: zooms.filter(z => z === zoom).length,
    hi: zooms.filter(z => z === zoom + 1).length,
    other: zooms.filter(z => z !== zoom && z !== zoom + 1).length,
  };
}
const injectPlus = page => page.evaluate(() => {
  state.plus = { active: true, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
});

const cr = await chromium.launch();

// ── 情境 1:匿名 + 衛星(不跟車)→ 全部 z === zoom ──
{
  const { ctx, page, zooms, errors } = await boot(cr);
  await openSatellite(page, false);
  await page.waitForTimeout(800);
  const zoom = await page.evaluate(() => Math.round(map.getZoom()));
  const c = classify(zooms, zoom);
  ok('情境1 匿名+衛星(不跟車):有發出圖磚請求', c.total > 0, JSON.stringify(c));
  ok('情境1 匿名+衛星(不跟車):全部 z===zoom(標準解析,零 z+1)', c.total > 0 && c.hi === 0 && c.other === 0, `zoom=${zoom} ${JSON.stringify(c)}`);
  ok('情境1 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 情境 2:匿名 + 衛星 + 跟車 → 同上(標準解析) ──
{
  const { ctx, page, zooms, errors } = await boot(cr);
  const f = await followAnyTrain(page);
  ok('情境2 前置:成功跟車', !!f, JSON.stringify(f));
  await openSatellite(page, false);
  await page.waitForTimeout(800);
  const zoom = await page.evaluate(() => Math.round(map.getZoom()));
  const c = classify(zooms, zoom);
  ok('情境2 匿名+衛星+跟車:有發出圖磚請求', c.total > 0, JSON.stringify(c));
  ok('情境2 匿名+衛星+跟車:全部 z===zoom(標準解析,零 z+1)', c.total > 0 && c.hi === 0 && c.other === 0, `zoom=${zoom} ${JSON.stringify(c)}`);
  ok('情境2 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 情境 3:Plus + 衛星(不跟車)→ 出現 z === zoom+1 ──
{
  const { ctx, page, zooms, errors } = await boot(cr);
  await injectPlus(page);
  await openSatellite(page, false);
  await page.waitForTimeout(800);
  const zoom = await page.evaluate(() => Math.round(map.getZoom()));
  const c = classify(zooms, zoom);
  ok('情境3 Plus+衛星(不跟車):有發出圖磚請求', c.total > 0, JSON.stringify(c));
  ok('情境3 Plus+衛星(不跟車):出現 z===zoom+1(高解析)', c.hi > 0, `zoom=${zoom} ${JSON.stringify(c)}`);
  ok('情境3 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 情境 4:Plus + 衛星 + 跟車 → 退回 z === zoom(跟車一律標準解析) ──
{
  const { ctx, page, zooms, errors } = await boot(cr);
  await injectPlus(page);
  const f = await followAnyTrain(page);
  ok('情境4 前置:成功跟車', !!f, JSON.stringify(f));
  await openSatellite(page, false);
  await page.waitForTimeout(800);
  const zoom = await page.evaluate(() => Math.round(map.getZoom()));
  const c = classify(zooms, zoom);
  ok('情境4 Plus+衛星+跟車:有發出圖磚請求', c.total > 0, JSON.stringify(c));
  ok('情境4 Plus+衛星+跟車:全部 z===zoom(跟車強制標準解析,零 z+1)', c.total > 0 && c.hi === 0 && c.other === 0, `zoom=${zoom} ${JSON.stringify(c)}`);
  ok('情境4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 情境 5(Step 4 專驗,brief 四情境之外加驗):訂閱狀態「即時變動」要重掛圖層,不必等使用者
// 重切底圖——用 RAIL_PLUS_TEST_ADAPTER(既有慣例,同 verify_plus_subscription.mjs)走真正的
// plusPurchase(),而不是直接注入 state.plus.active,這樣測到的才是 Step 4 插入的那一行本身。
{
  // ?plus=1:PLUS_ENABLED 是整個 Plus 購買面(plusOpen/plusConfigured)的總閘,情境1-4 直接注入
  // state.plus.active 繞過它不需要,但這裡要走真正的 plusOpen()/plusPurchase(),必須帶。
  // satRetinaAllowed() 本身不讀 PLUS_ENABLED,只讀 state.plus.active,故不影響情境1-4 的判準。
  const { ctx, page, zooms, errors } = await boot(cr, { query: '?plus=1' });
  await page.evaluate(() => {
    state.account = { ready: true, user: { uid: 'sat-test-uid', email: 't@example.com', displayName: null }, syncing: false, lastSync: 0, actionError: '', error: '' };
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    let sub = false;
    const info = () => ({ entitlements: { active: sub ? { plus: { identifier: 'plus' } } : {} }, managementURL: '' });
    const offering = { availablePackages: [{ identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: 'NT$STUB' } } }] };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {},
      getCustomerInfo: async () => info(),
      getOfferings: async () => ({ all: { plus: offering }, current: offering }),
      purchase: async () => { sub = true; return { customerInfo: info() }; },
      restore: async () => info(),
    };
  });
  await openSatellite(page, false); // 先在未訂閱狀態切到衛星(=標準解析,同情境1)
  await page.waitForTimeout(600);
  const zoomBefore = await page.evaluate(() => Math.round(map.getZoom()));
  const cBefore = classify(zooms, zoomBefore);
  ok('情境5 前置:未訂閱時衛星=標準解析(零 z+1)', cBefore.total > 0 && cBefore.hi === 0, JSON.stringify(cBefore));
  zooms.length = 0; // 清空,只看購買之後新發出的請求
  await page.evaluate(() => plusOpen('test'));
  await page.waitForFunction(() => state.plus && !!state.plus.pkgMonthly, null, { timeout: 8000 });
  await page.evaluate(() => plusPurchase('month'));
  await page.waitForFunction(() => state.plus && state.plus.active === true, null, { timeout: 8000 });
  await page.waitForTimeout(800); // 不再點 satBtn——驗的正是 Step 4 的自動重掛
  const zoomAfter = await page.evaluate(() => Math.round(map.getZoom()));
  const cAfter = classify(zooms, zoomAfter);
  ok('情境5 購買完成後不必重切底圖,自動出現 z===zoom+1(高解析)', cAfter.hi > 0, `zoom=${zoomAfter} ${JSON.stringify(cAfter)}`);
  ok('情境5 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ Z0 錯誤收集器的正向對照 ══════════════
// 上面 5 條「無 JS 例外」都是「數量必須為 0」型:boot() 的 listener 若失效,它們會全部變成永遠的假綠。
// (相對地,z 值那幾條本來就是對的寫法——`c.total > 0 && c.hi === 0`,零永遠綁著一個「該有東西」的正向量。)
// ⚠️ 例外必須發生在頁面自己的 task 裡才會觸發 pageerror;`page.evaluate(() => { throw ... })` 的例外
//    會被 Playwright 以 rejection 接回 Node,一筆都收不到(2026-08-02 實測),那種探針本身就是壞的。
try {
  const { ctx, page, errors } = await boot(cr, {});
  await page.evaluate(() => { setTimeout(() => { throw new Error('__collector_probe__'); }, 0); });
  await page.waitForTimeout(400);
  ok('Z0 錯誤收集器正向對照:故意丟的 pageerror 有被收到(證明上面「無 JS 例外」不是假綠)',
    errors.some(s => s.includes('__collector_probe__')), `本輪收到 ${errors.length} 筆`);
  await ctx.close();
} catch (e) { ok('Z0 錯誤收集器正向對照', false, '探針情境失敗:' + String(e).slice(0, 150)); }

await cr.close();

// ── webkit 手機抽測(至少一路真觸控+真引擎;iPhone 典型 deviceScaleFactor=3) ──
try {
  const wk = await webkit.launch();
  {
    const { ctx, page, zooms, errors } = await boot(wk, { touch: true, width: 390, height: 844, dsf: 3 });
    await openSatellite(page, true);
    await page.waitForTimeout(800);
    const zoom = await page.evaluate(() => Math.round(map.getZoom()));
    const c = classify(zooms, zoom);
    ok('情境1w webkit手機 匿名+衛星(真觸控):全部 z===zoom', c.total > 0 && c.hi === 0, `zoom=${zoom} ${JSON.stringify(c)}`);
    ok('情境1w 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, zooms, errors } = await boot(wk, { touch: true, width: 390, height: 844, dsf: 3 });
    await injectPlus(page);
    await openSatellite(page, true);
    await page.waitForTimeout(800);
    const zoom = await page.evaluate(() => Math.round(map.getZoom()));
    const c = classify(zooms, zoom);
    ok('情境3w webkit手機 Plus+衛星(真觸控):出現 z===zoom+1', c.hi > 0, `zoom=${zoom} ${JSON.stringify(c)}`);
    ok('情境3w 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await wk.close();
} catch (e) { ok('webkit 手機抽測全項', false, 'webkit 啟動失敗:' + String(e).slice(0, 150)); }

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);
