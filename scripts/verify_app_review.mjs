// 評分邀請驗收。
//
// 系統彈窗顯不顯示由 Apple 決定、自動化驗不了 ⇒ 這裡只驗三件事:
// (1) 五道節流條件的判定正確 (2) 該呼叫時真的呼叫到 plugin、不該呼叫時真的沒呼叫
// (3) 常駐入口點得到、且不在會被 iPad 藏掉的容器裡。
// 真機才驗得了的兩件(系統彈窗、write-review 深連結跳轉)寫在計畫書的「出貨前人工確認」。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5399;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const md5 = b => createHash('md5').update(b).digest('hex');

// ── 第一道閘:確認驗的是哪一棵樹 ──
const localHash = md5(readFileSync(path.join(ROOT, 'index.html')));
console.log(`驗證目標：${ROOT}\nindex.html md5：${localHash}\n`);
const servedHash = md5(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer()));
ok(servedHash === localHash, `伺服器供的 index.html 與本樹逐 byte 相同（served ${servedHash.slice(0, 8)}）`);
if (servedHash !== localHash) { console.log('\n目標不符,後續斷言無意義,中止。'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('  ⚠ pageerror: ' + e.message));
await page.setViewportSize({ width: 390, height: 844 });
await page.addInitScript(() => {
  window.RAIL_APP_VERSION = '1.4.1';
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
});
// 刻意讓版本查詢失敗:評分入口不該依賴更新檢查有沒有成功
await page.route('**/itunes.apple.com/lookup**', r => r.fulfill({ status: 500, body: '' }));
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.reviewShouldAsk === 'function', { timeout: 20000 })
  .catch(() => console.log('  ⚠ reviewShouldAsk 尚未存在'));
await page.waitForTimeout(500);

const DAY = 86400000, NOW = 1770000000000;
const T = (rides, st) => page.evaluate(
  ([r, s, n]) => (window.reviewShouldAsk ? window.reviewShouldAsk(r, n, s) : 'NOFN'), [rides, st, NOW]);

console.log('\n【A】五道節流條件');
ok(await T(2, { asked: null, done: false, ver: '1.4.1' }) === true, '完乘 2 次、從沒問過 → 要問');
ok(await T(1, { asked: null, done: false, ver: '1.4.1' }) === false, '🔴 只完乘 1 次 → 不問（還沒愛上）');
ok(await T(0, { asked: null, done: false, ver: '1.4.1' }) === false, '完乘 0 次 → 不問');
ok(await T(5, { asked: { ver: '1.4.1', at: NOW - 200 * DAY }, done: false, ver: '1.4.1' }) === false,
   '同一版已問過 → 不再問（就算超過 90 天）');
ok(await T(5, { asked: { ver: '1.4.0', at: NOW - 30 * DAY }, done: false, ver: '1.4.1' }) === false,
   '距上次不到 90 天 → 不問');
ok(await T(5, { asked: { ver: '1.4.0', at: NOW - 100 * DAY }, done: false, ver: '1.4.1' }) === true,
   '換了版本且超過 90 天 → 可以再問');
ok(await T(5, { asked: null, done: true, ver: '1.4.1' }) === false,
   '🔴 已從常駐入口評過 → 永遠不再自動問');

console.log('\n【B】真的有沒有呼叫到 plugin');
await page.evaluate(() => {
  window.__reviewCalls = 0;
  window.Capacitor = window.Capacitor || {};
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.Capacitor.Plugins.RailReview = {
    requestReview: async () => { window.__reviewCalls++; return { requested: true }; },
  };
  localStorage.removeItem('trainmap-review-asked');
  localStorage.removeItem('trainmap-review-done');
});
await page.evaluate(() => window.maybeAskReview(0, 3));
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__reviewCalls) === 1, '條件成立 → 呼叫到 plugin 恰一次');
ok(await page.evaluate(() => !!localStorage.getItem('trainmap-review-asked')),
   '呼叫後寫入 asked（收不到「有沒有顯示」,只能以「請求過了」計次）');
await page.evaluate(() => window.maybeAskReview(0, 3));
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__reviewCalls) === 1, '🔴 立刻再觸發一次 → 不得重複呼叫');
// 反向:完乘只有 1 次時不可呼叫
await page.evaluate(() => {
  window.__reviewCalls = 0;
  localStorage.removeItem('trainmap-review-asked');
});
await page.evaluate(() => window.maybeAskReview(0, 1));
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__reviewCalls) === 0, '🔴 完乘 1 次 → 一次都不可呼叫');
// 反向:沒有 plugin(網站版)時不可炸
const siteErr = [];
const siteP = await browser.newPage();
siteP.on('pageerror', e => siteErr.push(e.message));
await siteP.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await siteP.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await siteP.waitForTimeout(2000);
const siteCall = await siteP.evaluate(() => {
  try { window.maybeAskReview(0, 99); return 'ok'; } catch (e) { return 'threw:' + e.message; }
});
ok(siteCall === 'ok', '網站版呼叫 maybeAskReview 不得拋錯（沒有 plugin 就安靜返回）');

console.log('\n【C】常駐入口');
await page.locator('#tabMore').click().catch(() => {});
await page.waitForTimeout(400);
const rate = page.locator('.ms-row[data-act="rate"]');
ok(await rate.count() === 1, '「更多」面板有且只有一列 data-act=rate');
ok(await rate.isVisible().catch(() => false), '🔴 那一列在 App 版可見（就算版本查詢失敗也要在）');
await rate.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(200);
const bb = await rate.boundingBox().catch(() => null);
ok(!!(bb && bb.width > 0 && bb.height > 0), '那一列有非零 rect（0×0 互不相交是假綠）');
ok(bb ? await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return !!(el && el.closest('.ms-row[data-act="rate"]'));
}, [bb.x + bb.width / 2, bb.y + bb.height / 2]) : false, '🔴 中心點真的命中自己');
ok(await page.locator('#msAbout .ms-row[data-act="rate"]').count() === 0,
   '🔴 不可放在 #msAbout 內（桌面/iPad 會被 display:none 吃掉）');
ok(await page.locator('#moreBody .ms-row[data-act="rate"]').count() === 1,
   '🔴 必須在 #moreBody 內（派發器綁在它身上）');

// 真的點下去:應開 write-review 深連結,並記下 done
const opened = [];
await page.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
await rate.click();
await page.waitForTimeout(400);
const urls = await page.evaluate(() => window.__opened || []);
opened.push(...urls);
ok(opened.length === 1 && /id6792673516\?action=write-review/.test(opened[0]),
   `點下去開 write-review 深連結（實得：${opened[0] || '無'}）`);
ok(await page.evaluate(() => localStorage.getItem('trainmap-review-done')) === 'true',
   '點過之後記下 done（之後不再自動問）');
ok(await page.evaluate(() => window.reviewShouldAsk(99, Date.now(),
   { asked: null, done: !!JSON.parse(localStorage.getItem('trainmap-review-done') || 'false'), ver: '1.4.1' })) === false,
   '🔴 端到端:點過常駐入口之後,節流判定確實變成「不再問」');

await siteP.close();
await browser.close();
console.log(`\n總計：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
