// 更新提示驗收:純函式 → 狀態機 → 查詢層 → UI → 跨引擎四寬度。
//
// 判準刻意不看實作怎麼寫:版本比較的期望值來自 Apple 的語意(逐段比整數),
// 不是來自 index.html 裡那段程式碼。`1.02` vs `1.1` 那一組是關鍵案例——
// 線上真的出現過 `1.02` 這個版本字串(見 app/scripts/set-release-mode.mjs:34-38),
// 字串比較會判反,只有逐段比整數才會對。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5399;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const md5 = b => createHash('md5').update(b).digest('hex');

// ── 第一道閘:確認驗的是哪一棵樹 ──(驗收腳本驗到別的 worktree 的舊檔是真的發生過的事)
const localHash = md5(readFileSync(path.join(ROOT, 'index.html')));
console.log(`驗證目標：${ROOT}\nindex.html md5：${localHash}\n`);
const servedHash = md5(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer()));
ok(servedHash === localHash, `伺服器供的 index.html 與本樹逐 byte 相同（served ${servedHash.slice(0, 8)}）`);
if (servedHash !== localHash) { console.log('\n目標不符,後續斷言無意義,中止。'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('  ⚠ pageerror: ' + e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.cmpVer === 'function', { timeout: 20000 })
  .catch(() => console.log('  ⚠ cmpVer 尚未存在'));

console.log('\n【A】cmpVer 逐段比整數');
const cases = [
  ['1.4.0', '1.4.1', -1, '小版號較舊'],
  ['1.4.1', '1.4.0',  1, '小版號較新'],
  ['1.4.1', '1.4.1',  0, '相同'],
  ['1.4',   '1.4.0',  0, '段數不同,短的補 0'],
  ['1.02',  '1.1',    1, '🔴 1.02＝[1,2] 大於 1.1＝[1,1];字串比會判反'],
  ['1.2',   '1.10',  -1, '10 > 2,逐段比整數不是字典序'],
];
for (const [a, b, want, why] of cases) {
  const got = await page.evaluate(([x, y]) => (window.cmpVer ? window.cmpVer(x, y) : 'NOFN'), [a, b]);
  ok(got === want, `cmpVer('${a}','${b}') = ${got}（期望 ${want}）— ${why}`);
}
for (const bad of ['', 'abc', '1.4.x', null]) {
  const got = await page.evaluate(v => (window.cmpVer ? window.cmpVer(v, '1.0.0') : 'NOFN'), bad);
  ok(got === null, `cmpVer(${JSON.stringify(bad)},'1.0.0') 回 null（不比較）`);
}

console.log('\n【B】appUpdateState 六種狀態');
const S = (mine, latest, st) => page.evaluate(
  ([m, l, s]) => (window.appUpdateState ? window.appUpdateState(m, l, s) : null), [mine, latest, st]);
let r;
r = await S('1.4.0', '1.4.1', { seen: '1.4.0', dismissed: null, whatsnewSeen: null });
ok(!!r && r.hasUpdate === true && r.showBanner === true && r.showWhatsNew === false, 'A1 有新版 → 橫幅出現');
r = await S('1.4.0', '1.4.1', { seen: '1.4.0', dismissed: '1.4.1', whatsnewSeen: null });
ok(!!r && r.hasUpdate === true && r.showBanner === false, 'A1 已關掉同一版 → 橫幅不出現,但仍標示有新版');
r = await S('1.4.1', '1.4.1', { seen: '1.4.0', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === true && r.showBanner === false, 'A2 剛更新完 → 顯示「更新了什麼」');
r = await S('1.4.1', '1.4.1', { seen: '1.4.1', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === false && r.hasUpdate === false, 'A3 平常 → 什麼都不顯示');
r = await S('1.4.1', '1.4.1', { seen: null, dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === false, '🔴 第一次裝(seen 不存在) → 不可迎面丟一張卡片');
r = await S('1.4.1', '1.4.1', { seen: '1.4.0', dismissed: null, whatsnewSeen: '1.4.1' });
ok(!!r && r.showWhatsNew === false, '同一版的更新卡片看過就不再出現');
r = await S('1.4.8', '1.4.6', { seen: '1.4.6', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === true && r.hasUpdate === false && r.showBanner === false,
   '🔴 A4 手上比商店新(審查中/lookup 落後):仍用本機內建文案顯示這次更新，不拿商店舊版說明冒充');
r = await S('1.4.8', '1.4.6', { seen: '1.4.8', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === false, 'A4b 手上比商店新但 seen 已是本版 → 不重複顯示');
r = await S('1.4.8', '1.4.8', { seen: '1.4.6', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === true, 'A4c 商店追上之後(seen 仍是舊版)→ 這時才顯示本版「更新了什麼」');
r = await S('1.4.1', null, { seen: '1.4.0', dismissed: null, whatsnewSeen: null });
ok(!!r && r.hasUpdate === false && r.showBanner === false && r.showWhatsNew === true,
   '查詢失敗(latest 為 null) → 不報新版，但本機內建的本版更新內容仍可顯示');

console.log('\n【C】查詢、快取與失敗靜默');
// 網站版:不注入 RAIL_APP_VERSION ⇒ 連請求都不該發(平台閘門的正向證明)
const siteReqs = [];
page.on('request', r => { if (r.url().includes('itunes.apple.com')) siteReqs.push(r.url()); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
ok(siteReqs.length === 0, '🔴 網站版(無 RAIL_APP_VERSION)完全不打 itunes.apple.com');

const LOOKUP_OK = {
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ resultCount: 1, results: [{ version: '1.4.1',
    releaseNotes: '測試用更新說明\n第二行', trackViewUrl: 'https://apps.apple.com/tw/app/id6792673516?uo=4' }] }),
};
const appPage = await browser.newPage();
appPage.on('pageerror', e => console.log('  ⚠ pageerror: ' + e.message));
await appPage.addInitScript(() => { window.RAIL_APP_VERSION = '1.4.0'; });
await appPage.route('**/itunes.apple.com/lookup**', route => route.fulfill(LOOKUP_OK));
await appPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
const got = await appPage.waitForFunction(() => window.__appverLast || null, { timeout: 20000 })
  .then(h => h.jsonValue()).catch(() => null);
ok(!!(got && got.latest && got.latest.v === '1.4.1'), 'App 版查得到線上版本 1.4.1');
ok(!!(got && got.state.hasUpdate === true), '1.4.0 < 1.4.1 ⇒ hasUpdate');

// 快取:第二次載入不應再發請求
let secondReq = 0;
appPage.on('request', r => { if (r.url().includes('itunes.apple.com')) secondReq++; });
await appPage.reload({ waitUntil: 'domcontentloaded' });
await appPage.waitForTimeout(3000);
ok(secondReq === 0, '12 小時內第二次開 App 走快取,不重複請求');

// 失敗靜默:清快取 + 讓端點 500
await appPage.evaluate(() => Object.keys(localStorage)
  .filter(k => k.startsWith('trainmap-appver')).forEach(k => localStorage.removeItem(k)));
await appPage.unroute('**/itunes.apple.com/lookup**');
await appPage.route('**/itunes.apple.com/lookup**', route => route.fulfill({ status: 500, body: '' }));
await appPage.reload({ waitUntil: 'domcontentloaded' });
await appPage.waitForTimeout(4000);
const failState = await appPage.evaluate(() => window.__appverLast || null);
ok(!!failState, '查詢失敗時 appUpdateInit 仍有回傳(不是整條炸掉)');
ok(!failState || failState.state.showBanner === false, '查詢失敗 → 不顯示橫幅');
ok(await appPage.evaluate(() => !!document.getElementById('map')), '🔴 查詢失敗不得擋住頁面（地圖仍在）');
await appPage.close();

console.log('\n【C-Android】Play Core 更新狀態與側載保守文案');
const androidPage = await browser.newPage();
const androidAppleReqs = [];
androidPage.on('request', r => { if (r.url().includes('itunes.apple.com')) androidAppleReqs.push(r.url()); });
androidPage.on('pageerror', e => console.log('  ⚠ Android pageerror: ' + e.message));
await androidPage.setViewportSize({ width: 390, height: 844 });
await androidPage.addInitScript(() => {
  window.RAIL_APP_VERSION = '1.4.2';
  window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
  window.RAIL_NATIVE_APPUPDATE = { check: async () => ({
    ok: true, playInstalled: false, available: false, availableVersionCode: 0,
  }) };
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
});
await androidPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
const androidState = await androidPage.waitForFunction(() => window.__appverLast || null, { timeout: 20000 })
  .then(h => h.jsonValue()).catch(() => null);
ok(androidAppleReqs.length === 0, '🔴 Android 完全不打 itunes.apple.com');
ok(!!androidState && androidState.latest && androidState.latest.android === true,
   'Android 回傳 Play Core 專屬更新狀態');
ok(!!androidState && androidState.state.hasUpdate === false && androidState.state.showBanner === false,
   'Android 不宣稱有新版，也不顯示更新橫幅');
// Android 不打網路，__appverLast 會比既有 iOS 路徑早很多出現；等到真實可操作的 boot-ready
// 再點「更多」，避免把尚未綁 onclick 的解析中間態誤當產品不可見。
await androidPage.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, { timeout: 30000 });
await androidPage.locator('#tabMore').click().catch(() => {});
await androidPage.waitForTimeout(400);
ok(await androidPage.locator('#msAppSec').isVisible().catch(() => false), 'Android「軌島」段可見');
ok(await androidPage.locator('.ms-row[data-act="rate"]').isVisible().catch(() => false), 'Android 評分列可見');
const androidUpdateRow = androidPage.locator('.ms-row[data-act="update"]');
ok(await androidUpdateRow.isVisible().catch(() => false), 'Android 更新列可見');
ok(((await androidUpdateRow.textContent().catch(() => '')) || '').includes('目前版本　1.4.2'),
   '🔴 adb／側載版只顯示目前版本，不冒充「已是最新版」');
ok(!(await androidPage.locator('#updBanner').isVisible().catch(() => false)), '🔴 Android 更新橫幅不出現');
await androidPage.close();

const androidPlayPage = await browser.newPage();
await androidPlayPage.setViewportSize({ width: 390, height: 844 });
await androidPlayPage.addInitScript(() => {
  window.RAIL_APP_VERSION = '1.4.2';
  window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
  window.RAIL_NATIVE_APPUPDATE = { check: async () => ({
    ok: true, playInstalled: true, available: false, availableVersionCode: 142,
  }) };
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
});
await androidPlayPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await androidPlayPage.waitForFunction(() => window.__appverLast || null, { timeout: 20000 }).catch(() => {});
await androidPlayPage.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, { timeout: 30000 });
await androidPlayPage.locator('#tabMore').click().catch(() => {});
const playCurrentRow = androidPlayPage.locator('.ms-row[data-act="update"]');
ok(((await playCurrentRow.textContent().catch(() => '')) || '').includes('已是最新版　1.4.2'),
   'Play 安裝且查詢成功，才顯示「已是最新版」');
await androidPlayPage.close();

const androidNewPage = await browser.newPage();
await androidNewPage.setViewportSize({ width: 390, height: 844 });
await androidNewPage.addInitScript(() => {
  window.RAIL_APP_VERSION = '1.4.2';
  window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
  window.RAIL_NATIVE_APPUPDATE = { check: async () => ({
    ok: true, playInstalled: true, available: true, availableVersionCode: 143,
  }) };
  try {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appver-seen', JSON.stringify('1.4.2'));
  } catch (e) {}
});
await androidNewPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await androidNewPage.waitForFunction(() => window.__appverLast || null, { timeout: 20000 }).catch(() => {});
ok(await androidNewPage.locator('#updBanner').isVisible().catch(() => false),
   'Play 回報有新版時顯示更新橫幅');
ok(((await androidNewPage.locator('#updBanner').textContent().catch(() => '')) || '').includes('Google Play'),
   'Android 更新橫幅明確寫 Google Play');
await androidNewPage.close();

console.log('\n【D】UI:橫幅、更多面板那一列、更新內容卡片');
// 開「更多」面板:setMore 是閉包內的 const,不是全域 ⇒ 走真實入口(手機 #tabMore / 桌面 #toolsFab)
async function appPageWith(mine, latest, opts = {}) {
  const p = await browser.newPage();
  p.on('pageerror', e => console.log('  ⚠ pageerror: ' + e.message));
  await p.setViewportSize(opts.viewport || { width: 390, height: 844 });
  await p.addInitScript(v => {
    window.RAIL_APP_VERSION = v;
    window.RAIL_APP_WHATS_NEW = '測試更新說明<b>不可當標籤</b>\n第二行';
  }, mine);
  // 關掉首訪教學卡(#howtoWrap,z800):它會蓋住整個地圖區,elementFromPoint 全滅。
  // 這也是真實情境——手上有舊版可更新的人,一定早就用過 App。
  await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  if (opts.seed) await p.addInitScript(s => {
    Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }, opts.seed);
  await p.route('**/itunes.apple.com/lookup**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ resultCount: 1, results: [{ version: latest,
      releaseNotes: '測試更新說明<b>不可當標籤</b>\n第二行',
      trackViewUrl: 'https://apps.apple.com/tw/app/id6792673516?uo=4' }] }),
  }));
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__appverLast || null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(600);
  return p;
}

// D1 有新版 → 橫幅出現
let p = await appPageWith('1.4.0', '1.4.1', { seed: { 'trainmap-appver-seen': '1.4.0' } });
ok(await p.locator('#updBanner').isVisible().catch(() => false), 'D1 有新版 → #updBanner 可見');
ok(((await p.locator('#updBanner').textContent().catch(() => '')) || '').includes('1.4.1'), 'D1 橫幅寫出新版號');
await p.close();

// D2 反向:版本相同時橫幅不得出現(只驗一邊等於沒驗)
p = await appPageWith('1.4.1', '1.4.1', { seed: { 'trainmap-appver-seen': '1.4.1' } });
ok(!(await p.locator('#updBanner').isVisible().catch(() => false)), '🔴 D2 版本相同 → 橫幅不出現');
await p.close();

// D3 剛更新完 → 更新內容卡片,且 releaseNotes 必須 escape
p = await appPageWith('1.4.1', '1.4.1', { seed: { 'trainmap-appver-seen': '1.4.0' } });
ok(await p.locator('#updNotes').isVisible().catch(() => false), 'D3 剛更新完 → 更新內容卡片出現');
ok(((await p.locator('#updNotes').innerHTML().catch(() => '')) || '').includes('&lt;b&gt;'),
   '🔴 D3 releaseNotes 必須 escape（不可被當成 HTML 標籤）');
await p.close();

// D4 「更多」那一列:真的點下去看發生什麼,不是只看它在哪
p = await appPageWith('1.4.0', '1.4.1', { seed: { 'trainmap-appver-seen': '1.4.0' } });
await p.locator('#tabMore').click().catch(() => {});
await p.waitForTimeout(400);
const row = p.locator('.ms-row[data-act="update"]');
ok(await row.count() === 1, 'D4 「更多」面板有且只有一列 data-act=update');
ok(((await row.textContent().catch(() => '')) || '').includes('1.4.1'), 'D4 那一列寫出新版號');
// 面板是可捲的長清單,那一列在「軌島」段(靠近底部)⇒ 先捲進視野再命中測試,
// 否則量到的是視窗外的座標(elementFromPoint 必回 null),那是測法錯不是產品錯。
await row.scrollIntoViewIfNeeded().catch(() => {});
await p.waitForTimeout(200);
const box = await row.boundingBox().catch(() => null);
ok(!!(box && box.width > 0 && box.height > 0), 'D4 那一列有非零 rect（0×0 互不相交是假綠）');
const hit = box ? await p.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return !!(el && el.closest('.ms-row[data-act="update"]'));
}, [box.x + box.width / 2, box.y + box.height / 2]) : false;
ok(hit, '🔴 D4 那一列的中心點真的命中自己（沒有被別的元素蓋住）');
ok(await p.locator('#msAbout .ms-row[data-act="update"]').count() === 0,
   '🔴 D4 那一列不可放在 #msAbout 內（桌面/iPad 會被 display:none 整個吃掉）');
// 正向對照:那一列真的在派發器的作用範圍(#moreBody)內,否則點了永遠沒反應
ok(await p.locator('#moreBody .ms-row[data-act="update"]').count() === 1,
   '🔴 D4 那一列必須在 #moreBody 內（派發器綁在它身上）');
await p.close();

// D5 關掉橫幅 → 同版不再出現,但那一列還在(找得回來)
p = await appPageWith('1.4.0', '1.4.1', { seed: { 'trainmap-appver-seen': '1.4.0' } });
await p.locator('#updBannerClose').click().catch(() => {});
await p.waitForTimeout(300);
ok(!(await p.locator('#updBanner').isVisible().catch(() => false)), 'D5 按 ✕ 後橫幅收起');
ok(await p.evaluate(() => localStorage.getItem('trainmap-appver-dismissed')) === '"1.4.1"',
   'D5 關閉狀態記在 dismissed');
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
ok(!(await p.locator('#updBanner').isVisible().catch(() => false)), 'D5 重開後同一版不再出現');
ok(await p.locator('.ms-row[data-act="update"]').count() === 1, '🔴 D5 橫幅關掉後,「更多」那一列仍在（找得回來）');
await p.close();

// D6 網站版:兩列都不可見(平台閘門在 UI 層的證明)
const siteP = await browser.newPage();
siteP.on('pageerror', e => console.log('  ⚠ pageerror: ' + e.message));
await siteP.setViewportSize({ width: 390, height: 844 });
await siteP.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await siteP.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await siteP.waitForTimeout(2500);
await siteP.locator('#tabMore').click().catch(() => {});
await siteP.waitForTimeout(400);
ok(await siteP.locator('.ms-row[data-act="update"]:visible').count() === 0, 'D6 網站版看不到更新列');
ok(await siteP.locator('.ms-row[data-act="rate"]:visible').count() === 0, 'D6 網站版看不到評分列');
ok(!(await siteP.locator('#updBanner').isVisible().catch(() => false)), 'D6 網站版沒有橫幅');
await siteP.close();

console.log('\n【E】跨引擎 × 四寬度:橫幅不得與既有浮層相交');
// 真實 id(2026-08-09 於本樹逐一 grep 確認):時鐘 #clock、跟隨資訊卡 #followPanel、
// 行程追蹤橫幅 #followBar、GPS 校正常駐列 #recordBar、地圖動作列 .map-actions。
const OVERLAYS = ['#clock', '#followPanel', '#followBar', '#recordBar', '.map-actions'];
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const br = name === 'chromium' ? browser : await engine.launch();
  for (const w of [360, 390, 414, 768]) {
    const q = await br.newPage();
    q.on('pageerror', e => console.log(`  ⚠ ${name}/${w} pageerror: ` + e.message));
    await q.setViewportSize({ width: w, height: 800 });
    await q.addInitScript(() => {
      window.RAIL_APP_VERSION = '1.4.0';
      try {
        localStorage.setItem('trainmap-howto-seen', '1');
        localStorage.setItem('trainmap-appver-seen', '"1.4.0"');
      } catch (e) {}
    });
    await q.route('**/itunes.apple.com/lookup**', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ resultCount: 1, results: [{ version: '1.4.1', releaseNotes: 'x',
        trackViewUrl: 'https://apps.apple.com/tw/app/id6792673516' }] }),
    }));
    await q.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await q.waitForFunction(() => window.__appverLast || null, { timeout: 20000 }).catch(() => {});
    await q.waitForTimeout(1200);
    const res = await q.evaluate(sels => {
      const b = document.getElementById('updBanner');
      if (!b || b.hidden) return { compared: 0, bad: 'banner-missing' };
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { compared: 0, bad: 'banner-zero-rect' };
      const hits = []; const compared = [];
      for (const sel of sels) {
        const o = document.querySelector(sel);
        if (!o || o.hidden || !o.offsetParent) continue;      // 沒掛上/隱藏的不算
        const t = o.getBoundingClientRect();
        if (t.width === 0 || t.height === 0) continue;        // 0×0 與任何東西都不相交,比了等於沒比
        compared.push(sel);
        if (!(r.right <= t.left || r.left >= t.right || r.bottom <= t.top || r.top >= t.bottom)) hits.push(sel);
      }
      return { compared: compared.length, comparedList: compared.join(','), bad: hits.join(','),
               rect: `${Math.round(r.top)},${Math.round(r.left)} ${Math.round(r.width)}×${Math.round(r.height)}` };
    }, OVERLAYS);
    // 🔴 對照組要算「真的被比對到幾個」,不是「選擇器選得到幾個」——
    // #followPanel/#followBar/#recordBar 在乾淨載入時是 0×0 且不可見,會被上面的過濾器跳過,
    // 只數 querySelector 的話會得到 5 這個虛數,而零相交其實只是拿 2 個在比。
    ok(res.compared >= 2, `${name} @${w}px 對照組:真的比對到 ${res.compared} 個浮層 [${res.comparedList || '無'}]（需 ≥2）`);
    ok(res.bad === '', `${name} @${w}px 橫幅不與時鐘/資訊卡/追蹤列/錄製列/動作列相交（${res.bad || res.rect}）`);
    await q.close();
  }
  if (name !== 'chromium') await br.close();
}

await browser.close();
console.log(`\n總計：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
