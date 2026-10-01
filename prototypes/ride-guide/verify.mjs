// 乘車導覽原型驗收：用真瀏覽器（Playwright Chromium）跑完整流程＋各寬度點擊檢查。
// 用法：node prototypes/ride-guide/verify.mjs
//   repo 沒裝 playwright 時，可指定全域安裝位置：PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
// 截圖輸出到 prototypes/ride-guide/_shots/（本目錄 .gitignore 已排除，不進版控）
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, '_shots');
await mkdir(shots, { recursive: true });

let pw;
try { pw = await import('playwright'); } catch {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('找不到 playwright；請 npm install 或設定 PLAYWRIGHT_MODULE');
  pw = await import(process.env.PLAYWRIGHT_MODULE);
}
const { chromium } = pw;

// 只服務原型目錄本身，順便證明它不依賴正式站任何檔案
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const f = join(here, p);
  if (!f.startsWith(here)) { res.writeHead(403).end(); return; }
  try { const buf = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(buf); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } };
const browser = await chromium.launch();

async function newPage(width, height, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 900, isMobile: width < 900, colorScheme: opts.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('requestfailed', (r) => page.errors.push('requestfailed ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) page.errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return page;
}
const tap = async (page, sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(120); };
const text = (page, sel) => page.locator(sel).first().innerText();
const pressed = (page) => page.$$eval('#dock .chip[aria-pressed="true"]', (els) => els.map((e) => e.dataset.id));

/* ── 1. 完整流程（375px 觸控） ── */
console.log('\n[1] 完整流程：進入示範旅程 → 選第一站 → 讀故事 → 改選第二站 → 切英文 → 開地圖 → 回內容');
{
  const page = await newPage(375, 740);
  await page.goto(BASE);
  ok(await page.locator('.scan-list > li').count() === 3, '入口有三種 QR 模擬');
  ok(await page.locator('[data-act="scan"][data-via="car"]').count() === 3, '車廂 QR 有三條示範路線可選');
  await page.screenshot({ path: join(shots, '01-entry.png'), fullPage: true });

  await tap(page, '[data-fk="scan-car"]');
  ok((await text(page, '#jbar')).includes('4816'), '車廂 QR 直接帶入班次 4816，不用重選');
  ok((await text(page, '#jbar')).includes('往菁桐'), '頁首顯示方向 往菁桐');
  ok(await page.locator('.notice.info').count() === 1, '顯示「已從車廂 QR 帶入」提示');
  const chipIds = await page.$$eval('#dock .chip', (els) => els.map((e) => e.dataset.id));
  const data = await page.evaluate(() => window.RIDE_ROUTES.routes.pingxi.trains.find((t) => t.no === '4816').stops.map((s) => s.id));
  ok(JSON.stringify(chipIds) === JSON.stringify(data.slice(data.indexOf('ruifang') + 1)), `目的站只列這班車接下來會停的站：${chipIds.join(',')}`);
  await page.screenshot({ path: join(shots, '02-journey.png') });

  await tap(page, '[data-fk="chip-shifen"]');
  ok((await text(page, '.plate .pn')).includes('十分'), '選十分 → 站名牌換成十分');
  ok(await page.locator('#sec-stories .story').count() >= 2, '十分有 2 張以上故事卡');
  ok(await page.locator('#sec-routes ol.steps .step').count() >= 3, '十分有推薦路線（含車站與景點）');
  ok(await page.locator('.dhero .tagline').count() === 1 && await page.locator('#sec-highlights .hl').count() >= 3, '十分有主視覺主題句與 3 張以上亮點卡');
  ok(await page.locator('#sec-shops .shop').count() >= 3, '十分列出 OSM 在地店家');
  ok(await page.locator('#sec-shops .prov.sim').count() >= 1 && await page.locator('.prov-legend').count() === 1, '模擬值有標示，頁面有資料標示說明');
  ok(await page.locator('#sec-next tbody tr').count() >= 3, '十分列出之後的班次');
  const walkShifen = await text(page, '#sec-routes .lead');
  await page.screenshot({ path: join(shots, '03-shifen.png'), fullPage: true });

  const hBefore = await page.evaluate(() => history.length);
  await tap(page, '#sec-stories .story');
  ok(await page.locator('.sheet[role="dialog"]').isVisible(), '點故事卡 → 開啟全文面板');
  ok(await page.locator('.sheet .srclist a[href^="https://"]').count() >= 1, '故事全文附有來源連結');
  await page.screenshot({ path: join(shots, '04-story.png') });
  await page.goBack(); await page.waitForTimeout(150);
  ok(await page.locator('.sheet').count() === 0, '瀏覽器返回鍵 → 關閉故事面板（不離開頁面）');
  ok(JSON.stringify(await pressed(page)) === '["shifen"]', '關閉故事後目的站仍是十分');
  ok(await page.evaluate(() => history.length) >= hBefore, 'history 未被倒退出原型');

  await tap(page, '[data-fk="chip-pingxi"]');
  ok((await text(page, '.plate .pn')).includes('平溪'), '改選平溪 → 站名牌同步切換');
  const walkPingxi = await text(page, '#sec-routes .lead');
  ok(walkPingxi !== walkShifen, '散步建議同步切換');
  await page.screenshot({ path: join(shots, '05-pingxi.png'), fullPage: true });

  await tap(page, '[data-fk="lang-en"]');
  ok(await page.evaluate(() => document.documentElement.lang) === 'en', '切英文：html lang=en');
  ok((await text(page, '.plate .pn')).includes('Pingxi'), '切英文後站名牌為 Pingxi');
  ok(JSON.stringify(await pressed(page)) === '["pingxi"]', '切英文後目的站仍是平溪');
  await page.screenshot({ path: join(shots, '06-pingxi-en.png'), fullPage: true });

  await tap(page, '[data-fk="map-open"]');
  ok(await page.locator('#mappanel').isVisible(), '開地圖與旅程進度');
  ok((await page.locator('#mappanel svg').first().textContent()).includes('★ Pingxi'), '地圖以 ★ 標出目的站');
  ok((await text(page, '#mappanel table.tt')).includes('Pingxi'), '進度表列出停靠站');
  await page.screenshot({ path: join(shots, '07-map-en.png') });
  await tap(page, '[data-fk="map-close"]');
  ok(!(await page.locator('#mappanel').isVisible()), '「回到導覽」關閉地圖');
  ok(JSON.stringify(await pressed(page)) === '["pingxi"]' && (await text(page, '.plate .pn')).includes('Pingxi'), '回到內容：目的站與內容都保留，不必重選');
  ok(await page.evaluate(() => document.documentElement.lang) === 'en', '回到內容：語言保留英文');

  // 地圖也能用返回鍵關
  await tap(page, '[data-fk="map-open"]');
  await page.goBack(); await page.waitForTimeout(150);
  ok(!(await page.locator('#mappanel').isVisible()) && (await page.locator('[data-screen="journey"]').count()) === 1, '返回鍵關地圖，仍在旅程頁');

  // 重複點擊：同一站連點、語言連點、地圖連點，都不產生多餘 history
  const h0 = await page.evaluate(() => history.length);
  await page.locator('[data-fk="chip-pingxi"]').dblclick();
  await page.locator('[data-fk="lang-en"]').dblclick();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => history.length) === h0, '連點已選目的站／目前語言不增加 history');
  await page.locator('[data-fk="map-open"]').dblclick(); await page.waitForTimeout(150);
  ok(await page.locator('#mappanel').isVisible(), '連點地圖鈕：地圖開著');
  await page.goBack(); await page.waitForTimeout(150);
  ok(!(await page.locator('#mappanel').isVisible()) && (await page.locator('[data-screen="journey"]').count()) === 1, '連點地圖鈕只開一層：按一次返回就關掉，仍在旅程頁');

  // 空白內容：選沒有建內容的站
  await tap(page, '[data-fk="chip-dahua"]');
  ok(await page.locator('.card.empty[role="status"]').count() === 1, '選大華（未建內容）→ 顯示「內容還沒建立」與替代選項');
  await page.screenshot({ path: join(shots, '08-empty-en.png'), fullPage: true });

  // 沿途故事
  await tap(page, '[data-fk="lang-zh"]');
  await tap(page, '[data-fk="tab-along"]');
  ok(await page.locator('ol.tl > li').count() >= 11, '沿途故事依停靠順序列出全部站');
  ok(await page.locator('ol.tl .story').count() >= 4, '沿途有 4 則以上故事可手動點開');
  await page.screenshot({ path: join(shots, '09-along.png'), fullPage: true });
  await tap(page, 'ol.tl .story');
  ok(await page.locator('.sheet').isVisible(), '沿途故事可點開閱讀');
  await tap(page, '[data-fk="sheet-close"]');
  ok(await page.locator('.sheet').count() === 0, '關閉鈕關閉沿途故事');

  // 示範位置推進到目的站之後
  await tap(page, '[data-fk="chip-shifen"]');
  await tap(page, '[data-fk="map-open"]');
  for (let i = 0; i < 4; i++) await tap(page, '[data-fk="step-next"]');
  await tap(page, '[data-fk="map-close"]');
  ok(await page.locator('.pass-note').count() === 1, '示範位置超過目的站 → 提示並保留內容');
  await tap(page, '[data-fk="move-before"]');
  ok(await page.locator('.pass-note').count() === 0, '「調回之前」恢復');
  ok(page.errors.length === 0, `無 console 錯誤／載入失敗 ${page.errors.join(' | ')}`);
  await page.context().close();
}

/* ── 2. 網址參數 ── */
console.log('\n[2] 網址攜帶路線／班次');
{
  const page = await newPage(390, 760);
  await page.goto(BASE + '?line=pingxi');
  ok(await page.locator('[data-screen="train"]').count() === 1, '只帶路線 → 選班次畫面');
  await page.goto(BASE + '?line=pingxi&train=9999');
  ok((await page.locator('.notice').count()) === 1 && (await page.locator('[data-screen="train"]').count()) === 1, '不存在的班次 → 提示並讓旅客重選');
  await page.goto(BASE + '?line=pingxi&train=4827&dest=jingtong');
  ok((await text(page, '#jbar')).includes('往八斗子'), '回程 4827 → 方向 往八斗子');
  ok(await page.locator('.notice').count() === 1 && (await pressed(page)).length === 0, '目的站是起站（不在前方）→ 略過並提示');
  const first = await page.$eval('#dock .chip', (e) => e.dataset.id);
  ok(first === 'pingxi', `回程第一個可選站是平溪（${first}）`);
  await tap(page, '[data-fk="chip-shifen"]');
  const band = await text(page, '.plate-foot');
  ok(band.includes('望古') && band.includes('大華') && band.indexOf('望古') < band.indexOf('大華'), `回程站名牌鄰站方向一致：${band.replace(/\s+/g, ' ')}`);
  await page.goto(BASE + '#pingxi-4816-jingtong-en');
  ok((await text(page, '.plate .pn')).includes('Jingtong'), '#錨點深連結（Artifact 預覽用）帶入班次、目的站與語言');
  ok(page.errors.length === 0, `無 console 錯誤 ${page.errors.join(' | ')}`);
  await page.context().close();
}

/* ── 2b. 另外兩條示範路線 ── */
console.log('\n[2b] 花東線、海線');
{
  const page = await newPage(390, 844);
  await page.goto(BASE + '?line=huadong&train=4543');
  const ids = await page.$$eval('#dock .chip', (els) => els.map((e) => e.dataset.id));
  ok(!ids.includes('linrongshinkong'), `4543 不停林榮新光，目的站選擇器就不列（${ids.length} 站）`);
  await page.goto(BASE + '?line=huadong&train=4528&dest=guangfu');
  ok((await text(page, '.plate .pn')).includes('光復'), '花東 4528 → 光復導覽');
  ok(await page.locator('#sec-shops .shop').count() >= 3, '光復列出 OSM 店家');
  await page.goto(BASE + '?line=haixian&train=2527&dest=tongxiao');
  ok((await text(page, '.plate .pn')).includes('通霄'), '海線 2527 → 通霄導覽');
  ok((await text(page, '#jbar')).includes('往彰化'), '海線方向 往彰化');
  ok(page.errors.length === 0, `無 console 錯誤 ${page.errors.join(' | ')}`);
  await page.context().close();
}

/* ── 2c. 委員簡報舞台 ── */
console.log('\n[2c] 簡報舞台 present.html');
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errs.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE + 'present.html');
  await page.waitForFunction(() => window.__tourReady === true);
  const n = await page.evaluate(() => window.RideTourStage.steps.length);
  for (let k = 0; k < n; k++) { await page.evaluate((x) => window.RideTourStage.show(x), k); await page.waitForTimeout(250); }
  ok(true, `逐一切過 ${n} 幕`);
  const idx = await page.evaluate(() => window.RideTourStage.steps.findIndex((s) => s.id === 'dest'));
  await page.evaluate((x) => window.RideTourStage.show(x), idx);
  await page.waitForTimeout(900);
  const app = page.frameLocator('#app');
  ok((await app.locator('.plate .pn').first().innerText()).includes('十分'), '簡報第 04 幕：手機畫面切到十分');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
  ok(await page.evaluate(() => window.__tourStep) === idx + 1, '方向鍵切到下一幕');
  ok(errs.length === 0, `簡報舞台無 console 錯誤 ${errs.join(' | ')}`);
  await ctx.close();
}

/* ── 3. 各寬度：不橫捲、按鈕都有作用、觸控目標 ── */
console.log('\n[3] 各寬度檢查');
for (const [w, h] of [[360, 720], [375, 667], [414, 896], [768, 1024], [1280, 860]]) {
  const page = await newPage(w, h);
  await page.goto(BASE + '?line=pingxi&train=4816&dest=shifen');
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, `${w}px 無頁面橫向捲動（溢出 ${over}px）`);
  const small = await page.$$eval('button, a.btn, .jump a', (els) => els.filter((e) => e.offsetParent !== null).map((e) => [e.dataset.fk || e.textContent.trim().slice(0, 12), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]).filter(([, hh, ww]) => hh < 40 || ww < 40));
  ok(small.length === 0, `${w}px 可見按鈕觸控高度 ≥40px ${small.length ? JSON.stringify(small) : ''}`);
  await page.screenshot({ path: join(shots, `w${w}-shifen.png`), fullPage: false });

  // 逐一點每顆可見按鈕：點下去畫面、網址、捲動或焦點至少要有一樣改變
  const keys = await page.$$eval('#app button[data-fk], #dock button[data-fk]', (els) => els.filter((e) => e.offsetParent !== null && !e.disabled).map((e) => e.dataset.fk));
  const dead = [];
  for (const k of [...new Set(keys)]) {
    await page.goto(BASE + '?line=pingxi&train=4816&dest=shifen');
    await page.waitForTimeout(80);
    const el = page.locator(`[data-fk="${k}"]`).first();
    if (!(await el.isVisible())) continue;
    const ariaBefore = await el.getAttribute('aria-pressed');
    // 已選中的切換鈕（目前語言、已選目的站、目前分頁）刻意不動作，屬於「重複點擊」處理
    if (ariaBefore === 'true' || (await el.getAttribute('aria-selected')) === 'true') continue;
    await el.scrollIntoViewIfNeeded();
    const sig = () => page.evaluate(() => [document.body.innerHTML.length, document.querySelector('#app').innerHTML.slice(0, 4000), location.href, Math.round(scrollY), document.activeElement && document.activeElement.dataset.fk, document.querySelector('.sheet') ? 1 : 0].join('§'));
    const before = await sig();
    await el.click(); await page.waitForTimeout(250);
    if ((await sig()) === before) dead.push(k);
  }
  ok(dead.length === 0, `${w}px 每顆可見按鈕都有作用（${keys.length} 顆）${dead.length ? ' 無作用：' + dead.join(',') : ''}`);
  const links = await page.$$eval('a[target="_blank"]', (els) => els.filter((a) => !/^https:\/\//.test(a.href) || a.rel !== 'noopener').map((a) => a.href));
  ok(links.length === 0, `${w}px 外部連結皆為 https 且 rel=noopener`);
  ok(page.errors.length === 0, `${w}px 無 console 錯誤 ${page.errors.join(' | ')}`);
  await page.context().close();
}

/* ── 4. 暗色主題 ── */
console.log('\n[4] 暗色主題截圖');
{
  const page = await newPage(390, 844, { dark: true });
  await page.goto(BASE + '?line=pingxi&train=4816&dest=jingtong');
  await page.screenshot({ path: join(shots, 'dark-jingtong.png'), fullPage: true });
  await tap(page, '[data-fk="map-open"]');
  await page.screenshot({ path: join(shots, 'dark-map.png') });
  ok(page.errors.length === 0, `暗色無 console 錯誤 ${page.errors.join(' | ')}`);
  await page.context().close();
}

await browser.close();
server.close();
console.log(failures ? `\n✗ ${failures} 項未通過` : '\n✓ 全部通過');
process.exit(failures ? 1 : 0);
