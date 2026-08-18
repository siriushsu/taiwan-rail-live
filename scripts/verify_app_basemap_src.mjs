#!/usr/bin/env node
// App 街道底圖來源(OpenFreeMap)與兩層退路的瀏覽器驗收。
//
// 驗的對象刻意是 **app/www 的建置產物**,不是 repo 根的 index.html——App 與網站走不同分支
// (APP_CFG.tiles 有沒有值),拿網站那份驗等於沒驗到 App 那條路。
//
// 🔴 雙向:L1/L2 這種「出事就切走」的機制最常見的假綠是**只驗切得過去、沒驗切得回來**
// (見記憶 cross-runtime-entitlement-flag-sync:推得出 true 推不回 false)。所以每一層都有
// 反向情境:切到 stadia 之後要能切回 ofm;L2 退場之後下一次開機要自己回到 ofm。
//
// 🔴 費用:built index.html 內含真的 Stadia 金鑰。所有 stadiamaps 請求一律 fulfill 成假 PNG,
// 絕不讓驗收去打真的計費端點。OFM 是免費無上限,故放行真網路——那也順便證明它真的通。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const WWW = resolve(process.argv[2] || join(import.meta.dirname, '..', 'app', 'www'));
const PORT = Number(process.env.BASEMAP_PORT || 43521);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

// Step0 自檢(記憶 心得 32):印出驗的到底是哪個目錄與哪份檔,並斷言它含本批的機制,
// 否則「驗到舊 build」會長得跟全綠一模一樣。
const built = await readFile(join(WWW, 'index.html'), 'utf8');
console.log(`[G0] 目標目錄 ${WWW}`);
console.log(`[G0] index.html ${built.length} bytes`);
for (const [frag, why] of [['"streetSrc":"ofm"', 'L1 build 預設'], ['api/basemap-src', 'L1 讀取端'],
  ['function ofmWatch', 'L2 監看'], ['function ofmFallToRaster', 'L2 退場']]) {
  if (!built.includes(frag)) { console.error(`❌ [G0] 這份 build 沒有「${why}」(${frag})——驗錯目標或 build 過期`); process.exit(1); }
}
console.log('[G0] 四項機制都在這份 build 裡');

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(WWW, p === '/' ? 'index.html' : p);
    if (!file.startsWith(WWW)) { res.statusCode = 403; return res.end(); }
    const body = await readFile(file);
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch();
const results = [];
const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };

async function run({ id, seed, blockOfm, expect, waitMs = 4000 }) {
  const ctx = await browser.newContext();
  const errs = [], ofmHits = { ok: 0, fail: 0 };
  await ctx.route('**://tiles.stadiamaps.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  if (blockOfm) await ctx.route('**://tiles.openfreemap.org/**', r => r.abort('failed'));
  else await ctx.route('**://tiles.openfreemap.org/**', async r => { try { const x = await r.fetch(); ofmHits.ok++; await r.fulfill({ response: x }); } catch { ofmHits.fail++; await r.abort(); } });
  await ctx.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));   // 記憶:waitReady 逾時多半是 boot 靜默拋錯
  if (seed !== undefined) await page.addInitScript(v => { try { localStorage.setItem('trainmap-app-street-src', v); } catch (e) {} }, seed);
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(waitMs);   // 讓 L2 的 8 秒逾時有機會發生(blockOfm 情境給更久)
  const got = await page.evaluate(() => {
    const l = (typeof baseLayers !== 'undefined' && baseLayers) ? baseLayers.light : null;
    return {
      kind: !l ? 'none' : (typeof l._url === 'string' ? (l._url.includes('stadiamaps') ? 'stadia' : 'raster-other') : 'ofm'),
      fallbackArmed: typeof ofmRasterFallback !== 'undefined' && ofmRasterFallback !== null,
      cached: (() => { try { return localStorage.getItem('trainmap-app-street-src'); } catch (e) { return null; } })(),
    };
  }).catch(e => ({ kind: 'evalfail:' + String(e).slice(0, 60) }));
  ok(id, got.kind === expect, `圖層=${got.kind}(期望 ${expect}) 退路待命=${got.fallbackArmed} 快取=${got.cached} OFM圖磚 ok/fail=${ofmHits.ok}/${ofmHits.fail}${errs.length ? ' pageerror=' + errs[0] : ''}`);
  await ctx.close();
  return got;
}

// A. 預設(無快取)→ OFM,且真的抓得到 OFM 圖磚、L2 沒有假退場
await run({ id: 'A 預設走 OFM(且 L2 不假退場)', expect: 'ofm', waitMs: 11000 });
// B. L1 切到 stadia(方向一:切得過去)
await run({ id: 'B L1 快取=stadia → 走 Stadia', seed: 'stadia', expect: 'stadia' });
// C. L1 切回 ofm(方向二:切得回來)——只驗 B 不驗 C 就是單向閥假綠
await run({ id: 'C L1 快取切回 ofm → 走 OFM', seed: 'ofm', expect: 'ofm' });
// D+E 必須共用同一個 context —— 這是本檔最容易寫錯的一條。
// 🔴 E 原本用 browser.newContext() 跑,那是**全新的 localStorage**,所以就算 L2 真的把退場
// 寫進 localStorage(＝使用者從此永久留在計費底圖上),E 照樣是綠的——它其實只是 A 的重複。
// 2026-08-18 用 persistL2 突變實測證實:改壞了 5/5 全綠。改成在同一個 context 內 reload,
// 突變才會如實變紅。教訓:驗「不持久化」的斷言,storage 必須跨得過那次重開。
{
  const ctx = await browser.newContext();
  const errs = [], hits = { ok: 0, fail: 0 };
  await ctx.route('**://tiles.stadiamaps.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const block = r => r.abort('failed');
  await ctx.route('**://tiles.openfreemap.org/**', block);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  const probe = () => page.evaluate(() => ({
    kind: (() => { const l = (typeof baseLayers !== 'undefined' && baseLayers) ? baseLayers.light : null;
      return !l ? 'none' : (typeof l._url === 'string' ? (l._url.includes('stadiamaps') ? 'stadia' : 'raster-other') : 'ofm'); })(),
    cached: (() => { try { return localStorage.getItem('trainmap-app-street-src'); } catch (e) { return null; } })(),
  }));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(12000);
  const d = await probe();
  ok('D L2 OFM 不通 → 自動退場 Stadia', d.kind === 'stadia', `圖層=${d.kind}(期望 stadia) 快取=${d.cached}`);
  // 同一個 context 內把封鎖解掉再重開:localStorage 跟著過來,L2 若寫了東西進去這裡就會顯形
  await ctx.unroute('**://tiles.openfreemap.org/**', block);
  await ctx.route('**://tiles.openfreemap.org/**', async r => { try { const x = await r.fetch(); hits.ok++; await r.fulfill({ response: x }); } catch { hits.fail++; await r.abort(); } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(11000);
  const e = await probe();
  ok('E L2 退場後同一裝置重開 → 回到 OFM', e.kind === 'ofm',
    `圖層=${e.kind}(期望 ofm) 快取=${e.cached}(必須是 null:退場不可寫 localStorage) OFM圖磚 ok/fail=${hits.ok}/${hits.fail}`);
  await ctx.close();
}

await browser.close(); server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,通過 ${results.length - bad.length},失敗 ${bad.length}`);
process.exit(bad.length ? 1 : 0);
