// 誤點履歷卡(Plus 頭牌 UI)行為驗證——Playwright 真引擎(chromium+webkit)+ 本機靜態伺服器。
// 後端 /api/delay-history 尚未部署,一律以 page.route 攔截餵假資料(90 天,含誤點/準點/缺日)。
// 依據的關鍵事實(從 index.html 讀出,本腳本未參與實作):
//   · PLUS_ENABLED = ?plus=1(暗啟動);為真時 renderDelayRow 在準點列尾端掛 .fp-dhlink、
//     並取消車次卡 #tcDelayHist 的 hidden。入口 gate 與準點列相同:tr.sys==='tra_sched' 且 delayStats.d>=5。
//   · 統計列複用 state.delayStats[no] = {a 平均誤點, p 準點率%, d 樣本天數, m 最大誤點};由 /api/delay-stats 載入。
//   · 卡片 #delayHistPanel(.board 家族):h3 sticky 內含 × 關閉鈕(v0717p);逐日長條 .dh-bars rect.dh-bar
//     (fd≤5→.ok 綠 / >5→.hi 紅)、週幾 .dh-wd 七柱、資料標示 .dh-src。
//   · Plus:state.plus.active → 完整;未訂閱 → .dh-locked 模糊 + .dh-cta-btn(呼叫 plusGateOpen('delay-history',...))。
//   · 主題 html[data-theme];seed localStorage['trainmap-appearance'] 強制亮/暗。howto 卡 seed trainmap-howto-seen=1。
//   · injectPlus / plusOpen 走法沿用 verify_plus_subscription.mjs。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = '/private/tmp/claude-501/-Users-xuxiang-Code------/7527b6c9-bef6-4caa-9ffe-60c4cba112b7/scratchpad';
const PORT = 5219;
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

const STATS = { a: 2.4, p: 82, d: 26, m: 18 };  // 注入 delayStats(30 天聚合;d>=5 讓入口出現)
const GEN = '2026-07-20T01:00:00Z';
// 90 天假資料:含 >5 分誤點日、≤5 分準點日、與缺日(gap);跨足各週幾以驗週幾分布。
function fakeDays() {
  const days = [], end = new Date(Date.UTC(2026, 6, 19)); // 2026-07-19
  for (let i = 89; i >= 0; i--) {
    const dt = new Date(end); dt.setUTCDate(dt.getUTCDate() - i);
    const ds = dt.toISOString().slice(0, 10);
    if (i % 11 === 3) continue;                 // 缺日(約 8 天)
    let fd;
    if (i % 7 === 0) fd = 8 + (i % 5) * 2;       // 明顯誤點 (>5)
    else if (i % 5 === 0) fd = 6;                // 剛過門檻 (>5)
    else fd = i % 4;                             // 0..3 準點
    days.push({ d: ds, fd, md: fd + (i % 3) });
  }
  return days;
}
const FAKE_DAYS = fakeDays();
const N_DAYS = FAKE_DAYS.length;
const N_OK = FAKE_DAYS.filter(d => d.fd <= 5).length;
const N_HI = FAKE_DAYS.filter(d => d.fd > 5).length;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const allErrors = [];
function attach(page, tag) {
  const local = [];
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; local.push(m); allErrors.push(m); });
  // 過濾瀏覽器網路層雜訊(如刻意測試的 503「Failed to load resource」)——那是瀏覽器對回應碼的自動記錄,
  // 非 app 拋錯(app 的 fetch().catch 已妥善處理);只計 app 程式碼的 console.error 與未捕捉例外。
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { const s = `[${tag}] console.error: ${m.text()}`; local.push(s); allErrors.push(s); } });
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
  await page.waitForTimeout(200);
}
// injectPlus:注入 stub 商店+帳號(沿用 verify_plus_subscription.mjs)
async function injectPlus(page, { mode = 'buy', subscribed = false } = {}) {
  await page.evaluate(({ mode, subscribed }) => {
    state.plus = null;
    state.account = { ready: true, user: { uid: 'test-uid', email: 'tester@example.com', displayName: '測試員' }, syncing: false, lastSync: 0, actionError: '', error: '' };
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    let sub = !!subscribed;
    const info = () => ({ entitlements: { active: sub ? { plus: { identifier: 'plus' } } : {} }, managementURL: sub ? 'https://apps.apple.com/account/subscriptions' : '' });
    const offering = { availablePackages: [
      { identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: 'NT$90' } } },
      { identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: 'NT$390' } } },
    ] };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {}, getCustomerInfo: async () => info(),
      getOfferings: async () => ({ all: { plus: offering }, current: offering }),
      purchase: async () => { sub = true; return { customerInfo: info() }; }, restore: async () => info(),
    };
  }, { mode, subscribed });
}
// 選一班台鐵車(優先在途中,否則任一非環島);不依賴牆鐘,純以 state.trains。
async function pickTra(page) {
  return page.evaluate(async () => {
    let tries = 0;
    while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && tries < 60) { await new Promise(r => setTimeout(r, 60)); tries++; }
    let running = null, any = null;
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      if (!any) any = String(tr.train);
      const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
      if (s && eff > s[0].depSec + 60 && eff < s[s.length - 1].arrSec - 120) { running = String(tr.train); break; }
    }
    return running || any;
  });
}
async function routeApis(page, no, histMode) {
  await page.route('**/api/delay-stats*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: { [no]: STATS } }) }));
  await page.route('**/api/delay-history*', r => {
    if (histMode === '503') return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
    const days = histMode === 'empty' ? [] : FAKE_DAYS;
    const dr = days.length ? [days[0].d, days[days.length - 1].d] : null;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ train: no, days, _meta: { window_days: 90, n: days.length, date_range: dr, generated: GEN } }) });
  });
}
// boot + route + follow 一班台鐵車;flag=false 測預設迴歸(不加 ?plus=1)
async function bootFollowed(browser, opts = {}) {
  const { width = 1280, height = 800, touch = false, theme = 'light', flag = true, histMode = 'full', tag = '?' } = opts;
  const { ctx, page } = await newPage(browser, { width, height, touch, theme });
  const errs = attach(page, tag);
  await page.goto(BASE + (flag ? '?plus=1' : ''), { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const no = await pickTra(page);
  if (no) { await routeApis(page, no, histMode); await page.evaluate(n => followTrainNo(n), no); }
  return { ctx, page, errs, no };
}
async function openCardViaEntry(page) {
  await page.waitForSelector('#fpDelay .fp-dhlink', { state: 'visible', timeout: 9000 });
  await page.click('#fpDelay .fp-dhlink');
  await page.waitForSelector('#delayHistPanel h3', { timeout: 6000 });
}

const readCard = page => page.evaluate(() => {
  const el = document.getElementById('delayHistPanel');
  const h3 = el.querySelector('h3');
  const closeBtn = el.querySelector('#delayHistClose');
  return {
    hidden: el.hidden,
    text: el.textContent || '',
    statVals: [...el.querySelectorAll('.dh-stats .dh-stat b')].map(b => b.textContent),
    bars: el.querySelectorAll('.dh-bars rect.dh-bar').length,
    barsOk: el.querySelectorAll('.dh-bars rect.dh-bar.ok').length,
    barsHi: el.querySelectorAll('.dh-bars rect.dh-bar.hi').length,
    wdCols: el.querySelectorAll('.dh-wd .dh-wd-col').length,
    hasSrc: /交通部TDX/.test(el.textContent || ''),
    hasLocked: !!el.querySelector('.dh-locked'),
    lockedBlur: (() => { const l = el.querySelector('.dh-locked'); return l ? getComputedStyle(l).filter : ''; })(),
    hasCta: !!el.querySelector('.dh-cta-btn'),
    closeInStickyH3: !!(closeBtn && h3 && h3.contains(closeBtn) && getComputedStyle(h3).position === 'sticky'),
    hasRetry: !!el.querySelector('[data-dh-retry]'),
    msg: (el.querySelector('.dh-msg') || {}).textContent || '',
  };
});

const chromiumB = await chromium.launch();
const webkitB = await webkit.launch();

// ══════════════ A/W. 完整卡(桌機 chromium + WebKit),Plus active ══════════════
async function fullFlow(browser, label, opts) {
  const { ctx, page, errs, no } = await bootFollowed(browser, { ...opts, histMode: 'full', tag: label });
  ok(`${label}0 找到台鐵車並跟隨`, !!no, `no=${no}`);
  // 等主入口出現(= delayStats 已載、renderDelayRow 已跑);此時次要入口(車次卡)同一 gate 也應解除 hidden
  await page.waitForSelector('#fpDelay .fp-dhlink', { state: 'visible', timeout: 9000 });
  const tcHidden = await page.evaluate(() => document.getElementById('tcDelayHist').hidden);
  ok(`${label}1 車次卡次要入口顯示(#tcDelayHist 非 hidden)`, tcHidden === false, `hidden=${tcHidden}`);
  await page.evaluate(() => { state.plus = { active: true }; }); // Plus 已訂閱 → 完整內容
  await openCardViaEntry(page);
  await page.waitForSelector('#delayHistPanel .dh-bars', { timeout: 6000 });
  const c = await readCard(page);
  ok(`${label}2 卡片開啟(未隱藏)`, c.hidden === false);
  ok(`${label}3 統計列四值 = delayStats(平均2.4/準點82%/最大18/樣本26)`,
    c.statVals.join(',') === ['2.4', '82%', '18', '26'].join(','), c.statVals.join(','));
  ok(`${label}4 逐日長條數 = 資料天數(${N_DAYS})`, c.bars === N_DAYS, `bars=${c.bars}`);
  ok(`${label}5 長條顏色分層:綠(≤5)${c.barsOk} 紅(>5)${c.barsHi},皆>0 且加總=天數`,
    c.barsOk > 0 && c.barsHi > 0 && (c.barsOk + c.barsHi) === N_DAYS, `ok=${c.barsOk} hi=${c.barsHi} 期望ok=${N_OK}/hi=${N_HI}`);
  ok(`${label}6 週幾分布七柱`, c.wdCols === 7, `cols=${c.wdCols}`);
  ok(`${label}7 資料標示行(交通部TDX + 統計區間)`, c.hasSrc && /統計區間/.test(c.text), `src=${c.hasSrc}`);
  ok(`${label}8 Plus active 無鎖層/CTA(完整內容)`, !c.hasLocked && !c.hasCta, `locked=${c.hasLocked} cta=${c.hasCta}`);
  ok(`${label}9 × 在 sticky h3 內(v0717p)`, c.closeInStickyH3);
  // × 可關
  await page.click('#delayHistClose');
  const closed = await page.evaluate(() => document.getElementById('delayHistPanel').hidden);
  ok(`${label}10 點 × 關閉卡片`, closed === true, `hidden=${closed}`);
  // 次要入口也能開卡
  await page.evaluate(() => document.getElementById('tcDelayHist').click());
  await page.waitForSelector('#delayHistPanel .dh-bars', { timeout: 6000 });
  const via2 = await page.evaluate(() => !document.getElementById('delayHistPanel').hidden);
  ok(`${label}11 車次卡次要入口也能開卡`, via2 === true);
  ok(`${label}Z 本輪零 pageerror/console.error`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
await fullFlow(chromiumB, 'A(桌機)', { width: 1280, height: 800 });
await fullFlow(chromiumB, 'M(手機)', { width: 375, height: 812, touch: true });
await fullFlow(webkitB, 'W(WebKit)', { width: 1280, height: 800 });

// ══════════════ B. Plus 未訂閱:圖表模糊 + CTA,點 CTA 開 Plus modal ══════════════
{
  const { ctx, page, errs } = await bootFollowed(chromiumB, { tag: 'B', histMode: 'full' });
  await openCardViaEntry(page);
  await page.waitForSelector('#delayHistPanel .dh-locked', { timeout: 6000 });
  const c = await readCard(page);
  ok('B1 未訂閱 → 圖表區有鎖層 .dh-locked', c.hasLocked, `locked=${c.hasLocked}`);
  ok('B2 鎖層 CSS filter 含 blur(模糊化)', /blur/.test(c.lockedBlur), `filter=${c.lockedBlur}`);
  ok('B3 置中 CTA 鈕存在(訂閱 Plus 解鎖完整履歷)', c.hasCta && /訂閱 Plus 解鎖完整履歷/.test(c.text), `cta=${c.hasCta}`);
  ok('B4 未訂閱時統計列(teaser)仍可見', c.statVals.join(',') === ['2.4', '82%', '18', '26'].join(','), c.statVals.join(','));
  // 注入帳號+stub 商店 → 點 CTA 應開出 Plus modal
  await injectPlus(page, { mode: 'buy', subscribed: false });
  await page.click('#delayHistPanel .dh-cta-btn');
  await page.waitForSelector('#plusBody .plus-plan', { timeout: 6000 }).catch(() => {});
  const modal = await page.evaluate(() => ({ hidden: document.getElementById('plusModal').hidden, plans: document.querySelectorAll('#plusBody .plus-plan').length }));
  ok('B5 點 CTA 開出 Plus 訂閱視窗(plusGateOpen 首個接線點)', modal.hidden === false && modal.plans === 2, JSON.stringify(modal));
  ok('B Z 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ C. 空資料態 / D. 503 態 ══════════════
async function stateFlow(label, histMode, assertFn) {
  const { ctx, page, errs } = await bootFollowed(chromiumB, { tag: label, histMode });
  await page.evaluate(() => { state.plus = { active: true }; });
  await openCardViaEntry(page);
  await page.waitForTimeout(400);
  const c = await readCard(page);
  assertFn(c);
  ok(`${label} Z 本輪零 pageerror/console.error`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
await stateFlow('C(空資料)', 'empty', c => {
  ok('C1 空資料態顯示「資料累積中」', /資料累積中/.test(c.msg || c.text), `msg=${c.msg}`);
  ok('C2 空資料態無長條/無鎖層', c.bars === 0 && !c.hasLocked, `bars=${c.bars}`);
});
await stateFlow('D(503)', '503', c => {
  ok('D1 503 態顯示失敗訊息(含 503)', /暫時讀不到/.test(c.text) && /503/.test(c.text), c.msg);
  ok('D2 503 態提供重試鈕', c.hasRetry, `retry=${c.hasRetry}`);
});

// ══════════════ E. 預設迴歸:無 ?plus=1 → 入口零存在、boot 零 error ══════════════
{
  const { ctx, page, errs, no } = await bootFollowed(chromiumB, { tag: 'E', flag: false, histMode: 'full' });
  await page.waitForSelector('#fpDelay:not([hidden])', { timeout: 9000 }).catch(() => {});
  const snap = await page.evaluate(() => ({
    fpDelayShown: !document.getElementById('fpDelay').hidden,
    dhLink: document.querySelectorAll('.fp-dhlink').length,
    tcHidden: document.getElementById('tcDelayHist').hidden,
    panelHidden: document.getElementById('delayHistPanel').hidden,
  }));
  ok('E0 準點列本身仍正常顯示(不受旗標影響)', snap.fpDelayShown === true, JSON.stringify(snap));
  ok('E1 旗標關 → 主入口零存在(.fp-dhlink=0)', snap.dhLink === 0, `n=${snap.dhLink}`);
  ok('E2 旗標關 → 次要入口保持 hidden', snap.tcHidden === true);
  ok('E3 旗標關 → 卡片保持 hidden', snap.panelHidden === true);
  ok('E Z boot 零 pageerror/console.error', errs.length === 0, errs.slice(0, 4).join(' | '));
  await ctx.close();
}

// ══════════════ F. 寬度掃描:卡片開啟時與既有控件無相交(getBoundingClientRect) ══════════════
async function overlapAt(width, height, touch) {
  const { ctx, page, errs } = await bootFollowed(chromiumB, { width, height, touch, tag: `F${width}`, histMode: 'full' });
  await page.evaluate(() => { state.plus = { active: true }; });
  await openCardViaEntry(page);
  await page.waitForSelector('#delayHistPanel .dh-bars', { timeout: 6000 });
  await page.waitForTimeout(650); // 讓 body.sheet-open 觸發的 .controls 淡出過渡(opacity .5s)走完再量
  const res = await page.evaluate(() => {
    const overlap = (a, b, eps = 0.5) => !(a.right <= b.left + eps || b.right <= a.left + eps || a.bottom <= b.top + eps || b.bottom <= a.top + eps);
    const el = document.getElementById('delayHistPanel');
    const card = el.getBoundingClientRect();
    // 排除隱形/非互動控件:opacity≈0 或 pointer-events:none(如 sheet 開啟時淡出讓位的速度膠囊/版權條)——
    // 它們既看不見也點不到,不構成遮擋;只計真正可見可互動的控件是否被卡片壓到。
    const vis = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 0.02) return null; const r = e.getBoundingClientRect(); return (r.width < 1 || r.height < 1) ? null : r; };
    const sels = ['.follow-panel', '.freq-card', '.controls', '.badge', '#trainCard', '.leaflet-control-attribution'];
    const hits = [];
    for (const s of sels) { const r = vis(s); if (r && overlap(card, r)) hits.push(s + `[${r.left | 0},${r.top | 0},${r.right | 0},${r.bottom | 0}]`); }
    const inViewport = card.left >= -0.5 && card.top >= -0.5 && card.right <= innerWidth + 0.5 && card.bottom <= innerHeight + 0.5;
    return { card: [card.left | 0, card.top | 0, card.right | 0, card.bottom | 0], hits, inViewport };
  });
  ok(`F${width} 卡片開啟與既有控件零相交`, res.hits.length === 0, `card=${res.card.join(',')} hits=${res.hits.join(' ')}`);
  ok(`F${width} 卡片在視窗內不溢出`, res.inViewport === true, `card=${res.card.join(',')}`);
  if (errs.length) ok(`F${width} Z 零 error`, false, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
for (const [w, h, t] of [[360, 780, true], [375, 812, true], [414, 896, true], [768, 1024, true], [1280, 800, false]]) await overlapAt(w, h, t);

// ══════════════ G. 截圖:桌機/手機 × 亮/暗(Plus active,完整卡)+ 一張未訂閱鎖層 ══════════════
async function shot(name, { width, height, touch, theme, locked = false }) {
  const { ctx, page } = await bootFollowed(chromiumB, { width, height, touch, theme, tag: `SHOT-${name}`, histMode: 'full' });
  if (!locked) await page.evaluate(() => { state.plus = { active: true }; });
  await openCardViaEntry(page);
  await page.waitForSelector('#delayHistPanel .dh-bars', { timeout: 6000 });
  await page.waitForTimeout(300);
  const themeApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const file = path.join(SHOT_DIR, `dh_${name}.png`);
  await page.locator('#delayHistPanel').screenshot({ path: file });
  console.log(`SHOT ${name} (data-theme=${themeApplied}) → ${file}`);
  await ctx.close();
  return themeApplied;
}
const tD1 = await shot('desktop_light', { width: 1280, height: 800, touch: false, theme: 'light' });
const tD2 = await shot('desktop_dark', { width: 1280, height: 800, touch: false, theme: 'dark' });
const tM1 = await shot('mobile_light', { width: 375, height: 812, touch: true, theme: 'light' });
const tM2 = await shot('mobile_dark', { width: 375, height: 812, touch: true, theme: 'dark' });
await shot('locked_light', { width: 1280, height: 800, touch: false, theme: 'light', locked: true });
await shot('locked_mobile_dark', { width: 375, height: 812, touch: true, theme: 'dark', locked: true });
ok('G1 亮/暗主題確實套用(截圖用)', tD1 === 'light' && tD2 === 'dark' && tM1 === 'light' && tM2 === 'dark', `${tD1}/${tD2}/${tM1}/${tM2}`);

// ══════════════ 收尾 ══════════════
ok('K 全程 pageerror/console.error 為零', allErrors.length === 0, allErrors.slice(0, 8).join(' | '));
server.close();
await chromiumB.close();
await webkitB.close();

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
console.log(`(假資料:天數 ${N_DAYS} / 準點 ${N_OK} / 誤點 ${N_HI})`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name + (f.detail ? ` (${f.detail})` : '')).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
