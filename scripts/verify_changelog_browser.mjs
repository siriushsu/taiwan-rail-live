import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  let target = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) target = path.join(target, 'index.html');
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end('Not found');
  response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const failures = [];
const widths = [360, 375, 414, 768];
const expectedHistoryCount = 259;

try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await context.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('#tabMore').tap();
        const update = page.locator('#msAbout details.foot-box').filter({ hasText: '更新紀錄' }).first();
        const summary = update.locator(':scope > summary');
        await summary.scrollIntoViewIfNeeded();
        const hit = await summary.evaluate(element => {
          const box = element.getBoundingClientRect();
          const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return center === element || element.contains(center);
        });
        if (!hit) failures.push(`${engineName} ${width}px 更新紀錄摘要被遮住`);
        await summary.tap();
        if (!(await update.getAttribute('open')) && !(await update.evaluate(element => element.open))) failures.push(`${engineName} ${width}px 更新紀錄觸控未展開`);
        const recentCount = await update.locator('.foot-recent > li:not(.grp)').count();
        if (recentCount !== 8) failures.push(`${engineName} ${width}px 最近更新為 ${recentCount} 條`);
        const history = update.locator('.foot-more');
        await history.locator(':scope > summary').tap();
        const historyCount = await history.locator('.foot-list > li:not(.grp)').count();
        if (historyCount !== expectedHistoryCount) failures.push(`${engineName} ${width}px 完整歷史為 ${historyCount} 條`);
        const sources = page.locator('details.foot-box').nth(1);
        await sources.locator(':scope > summary').tap();
        const tdxMark = sources.locator('img[src="assets/tdx-logo.svg"]');
        await tdxMark.scrollIntoViewIfNeeded();
        const tdxResult = await tdxMark.evaluate(element => {
          const box = element.getBoundingClientRect();
          const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { loaded: element.complete && element.naturalWidth > 0, hittable: center === element || element.parentElement?.contains(center) };
        });
        if (!tdxResult.loaded || !tdxResult.hittable) failures.push(`${engineName} ${width}px TDX 標章載入=${tdxResult.loaded}／可點=${tdxResult.hittable}`);
        const metrics = await page.evaluate(() => ({
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          boxOverflow: [...document.querySelectorAll('#msAbout details.foot-box')].reduce((max, element) => Math.max(max, element.scrollWidth - element.clientWidth), 0),
        }));
        if (metrics.pageOverflow > 1 || metrics.boxOverflow > 1) failures.push(`${engineName} ${width}px 水平溢出：頁面 ${metrics.pageOverflow}px／盒子 ${metrics.boxOverflow}px`);
        if (errors.length) failures.push(`${engineName} ${width}px pageerror：${errors.join('；')}`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  console.error(`更新紀錄瀏覽器驗收失敗（${failures.length} 項）`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`更新紀錄瀏覽器驗收通過：Chromium + WebKit；${widths.join('/')}px 觸控寬度；最近 8 條、完整歷史 ${expectedHistoryCount} 條`);
