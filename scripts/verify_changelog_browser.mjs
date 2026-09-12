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
// 完整更新歷史的正本條數(li 不含 .grp);每加一條正本就 +1。刻意寫死不從 index.html 推導:
// 這條是「合併把整段更新紀錄吃掉」的棘輪(見 1.4.9 比 1.4.8 少 18 項那次),同源推導就沒牙了。
// 09-05 M4-B → 263;09-07 補記:263→284 是這兩天各批次沒跟著 +1 的欠帳(靜態 check-copy 同樣數到 286,
// 兩層獨立數出同一個數字 ⇒ 不是渲染漏條),本批加放空近景與誤點慢速前進兩條 → 286，再加山線軌道重畫一條 → 287；併入 origin/main 5715afb1 的收藏車庫一條 → 288。
// 9/8：補上主線兩條既有紀錄，本次立體地圖效能再加一條。
// 9/9：地景底圖、WorldCover、歷史建物共新增三條。
// 9/9：先前車庫玻璃、環形鎖定兩條（309→311），本次軌道承托與車頭開關兩條（311→313）。
// 9/9：官方橋隧補正一條（324→325），地形晚到重建一條（325→326）。
// 9/9：捷運雙軌左右一條、推拉式自強號節數一條（326→328）。
// 9/9：夜間道路調暗一條（328→329）。
// 9/10：地下列車實色、隧道縱坡、網站登入、網站通行證、通行證面板五條先前未補記（330→334），
//       本次機捷官方車種一條（334→335）。
// 9/11：高鐵對號座與票價、公車站牌搜尋、小工具自動最近站、三鶯線末班四條（337→341）。
// 9/12：地下段車廂接縫、高填方改高架兩條（355→357）。
// 9/12：具名觀光列車外觀一條（364→365）。前面七條（357→364：隧道口、都市效能、高鐵股道、地景樹、
//       高鐵佔用、縱坡、林鐵股道、臺中平面站、機捷車種、歷史建物、車窗燈、隧道口光帶）併進主線時
//       沒有跟著 bump 這個數字，本輪一併補上——這支閘門不在出貨鏈，所以紅了也沒人擋。
// 9/12：柴聯車推估編組一條（365→366）；併 origin/main 337bb2d3 時發現它的地下橋墩、車頭燈兩條
//       同樣沒 bump（該分支自己跑這支會紅在 367），一併補齊 → 368。靜態數 li 與瀏覽器數 DOM
//       兩邊獨立都是 368，所以是欠帳不是漏渲染。
// 9/12：月台股道重新指派一條（368→369）。
const expectedHistoryCount = 369;

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
