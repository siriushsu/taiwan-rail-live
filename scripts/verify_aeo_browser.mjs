import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  let target = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) target = path.join(target, 'index.html');
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const failures = [];
const paths = ['/about/', '/accuracy/', '/data-sources/', '/stations/', '/stations/taipei/', '/stations/formosa-boulevard/', '/en/', '/ja/'];
// 英日文著陸頁與首頁必須互相對應:同一組 hreflang、各自 canonical、CTA 帶 ?lang= 進即時地圖
const hreflangExpected = { 'zh-Hant': 'https://railisland.tw/', en: 'https://railisland.tw/en/', ja: 'https://railisland.tw/ja/', 'x-default': 'https://railisland.tw/' };
const landings = { '/en/': { lang: 'en', cta: '/?lang=en', titleRe: /Taiwan Train Map/, canonical: 'https://railisland.tw/en/' }, '/ja/': { lang: 'ja', cta: '/?lang=ja', titleRe: /台湾鉄道/, canonical: 'https://railisland.tw/ja/' } };
async function hreflangSet(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('link[rel=alternate][hreflang]')].map(el => [el.getAttribute('hreflang'), el.getAttribute('href')])));
}
async function inspectLanding(page, pathname, label) {
  const want = landings[pathname];
  const info = await page.evaluate(() => ({
    lang: document.documentElement.lang, title: document.title,
    canonical: document.querySelector('link[rel=canonical]')?.href,
    ctas: [...document.querySelectorAll('a.button:not(.secondary), a.nav-live')].map(el => el.getAttribute('href')),
  }));
  if (info.lang !== want.lang) failures.push(`${label} html lang=${info.lang}`);
  if (!want.titleRe.test(info.title)) failures.push(`${label} title 不含搜尋字：${info.title}`);
  if (info.canonical !== want.canonical) failures.push(`${label} canonical=${info.canonical}`);
  if (info.ctas.length < 2 || info.ctas.some(href => href !== want.cta)) failures.push(`${label} CTA 連結不是 ${want.cta}：${info.ctas.join('、')}`);
  const set = await hreflangSet(page);
  if (JSON.stringify(set) !== JSON.stringify(hreflangExpected)) failures.push(`${label} hreflang 不完整或不對應：${JSON.stringify(set)}`);
}

const widths = [360, 375, 414, 768];

async function inspect(page, label) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  const targets = page.locator('.site-nav a, .hero-actions a, .card-link');
  const blockedTargets = [];
  for (let index = 0; index < await targets.count(); index++) {
    const target = targets.nth(index);
    const result = await target.evaluate(element => {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const box = element.getBoundingClientRect();
      const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { label: element.textContent.trim(), hittable: center === element || element.contains(center) };
    });
    if (!result.hittable) blockedTargets.push(`${result.label} #${index + 1}`);
  }
  await page.evaluate(() => scrollTo(0, 0));
  const metrics = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll('.site-nav a')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const boxes = interactive.map(element => {
      const box = element.getBoundingClientRect();
      const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        label: element.textContent.trim(),
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      };
    });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${a.label} / ${b.label}`);
    }
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1: document.querySelectorAll('h1').length,
      main: Boolean(document.querySelector('main#main')),
      overlaps,
    };
  });
  if (metrics.overflow > 1) failures.push(`${label} 水平溢出 ${metrics.overflow}px`);
  if (metrics.h1 !== 1 || !metrics.main) failures.push(`${label} 語意結構錯誤`);
  if (blockedTargets.length) failures.push(`${label} 捲入畫面後點擊中心仍被遮住：${blockedTargets.join('、')}`);
  if (metrics.overlaps.length) failures.push(`${label} 導覽互相重疊：${metrics.overlaps.join('、')}`);
  if (errors.length) failures.push(`${label} pageerror：${errors.join('；')}`);
}

try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      for (const pathname of paths) {
        const page = await desktop.newPage();
        const response = await page.goto(`${base}${pathname}`, { waitUntil: 'load' });
        if (!response?.ok()) failures.push(`${engineName} desktop ${pathname} HTTP ${response?.status()}`);
        await inspect(page, `${engineName} desktop ${pathname}`);
        if (landings[pathname]) await inspectLanding(page, pathname, `${engineName} desktop ${pathname}`);
        await page.close();
      }
      await desktop.close();

      for (const width of widths) {
        const mobile = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await mobile.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        const rootPage = await mobile.newPage();
        await rootPage.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        if (width === widths[0]) {
          const rootSet = await hreflangSet(rootPage);
          if (JSON.stringify(rootSet) !== JSON.stringify(hreflangExpected)) failures.push(`${engineName} 首頁 hreflang 不對應：${JSON.stringify(rootSet)}`);
        }
        await rootPage.locator('#tabMore').tap();
        const aeoFooterLinks = rootPage.locator('.ms-aeo-links a');
        if (await aeoFooterLinks.count() !== 3) failures.push(`${engineName} ${width}px 手機「關於」區 AEO 入口不是 3 個`);
        const aboutLink = rootPage.locator('.ms-aeo-links a[href="about/"]');
        await aboutLink.scrollIntoViewIfNeeded();
        const rootHit = await aboutLink.evaluate(element => {
          const box = element.getBoundingClientRect();
          const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return center === element || element.contains(center);
        });
        if (!rootHit) failures.push(`${engineName} ${width}px 手機「關於軌島」入口被遮住`);
        await aboutLink.tap();
        await rootPage.waitForURL('**/about/');
        if (!rootPage.url().endsWith('/about/')) failures.push(`${engineName} ${width}px 首頁 AEO 入口觸控未成功`);
        await rootPage.close();
        for (const pathname of paths) {
          const page = await mobile.newPage();
          const response = await page.goto(`${base}${pathname}`, { waitUntil: 'load' });
          if (!response?.ok()) failures.push(`${engineName} ${width}px ${pathname} HTTP ${response?.status()}`);
          await inspect(page, `${engineName} ${width}px ${pathname}`);
          if (pathname === '/about/') {
            await page.locator('.site-nav a[href="/stations/"]').tap();
            await page.waitForURL('**/stations/');
            if (!page.url().endsWith('/stations/')) failures.push(`${engineName} ${width}px 觸控導覽未成功`);
          }
          await page.close();
        }
        await mobile.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  console.error(`AEO 瀏覽器驗收失敗（${failures.length} 項）`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`AEO 瀏覽器驗收通過：Chromium + WebKit；桌面與 ${widths.join('/')}px 觸控寬度；${paths.length} 個代表頁面（含 /en/、/ja/ 的 lang／title／canonical／hreflang／CTA）`);
