// weekend.html 的驗收。用 Playwright 攔 /api/weekend,不依賴真的跑 worker。
// 用法:node scripts/verify_weekend_page.mjs   /   VURL=http://localhost:5187 node ...
// 🔴 route 只攔 /api/weekend 與活動原文連結兩條:全攔式 ctx.route('**/*') 會把外部資源
//    一起擋掉,頁面 boot 會拋錯而永遠不 ready(這個 repo 2026-08-10 踩過)。
// 🔴 locale 釘 zh-TW:文案判準隨機器語系會假紅,與真回歸不可分辨。
import { chromium } from 'playwright';

const BASE = process.env.VURL || 'http://localhost:5187';
let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

const PAYLOAD = {
  today: '2026-09-04',
  span: { from: '2026-09-05', to: '2026-09-06', days: 2, label: '本週末' },
  events: [
    { title: '廣慈市集', note: '1 號出口 B1 連通道層', url: 'https://ev.invalid/1',
      days: ['2026-09-05', '2026-09-06'], places: [{ sys: 'mrt', station: '廣慈/奉天宮' }], ids: ['a', 'b'] },
    { title: '沒有連結的活動', note: '', url: '',
      days: ['2026-09-05'], places: [{ sys: 'mrt', station: '中山' }], ids: ['c'] },
    { title: '惡意連結活動', note: '', url: 'javascript:window.__pwned=1',
      days: ['2026-09-06'], places: [{ sys: 'mrt', station: '中山' }], ids: ['d'] },
  ],
  alsoOpen: [
    { title: '長期特展', note: '', url: 'https://ev.invalid/2',
      days: ['2026-09-05', '2026-09-06'], places: [{ sys: 'mrt', station: '大安森林公園' }], ids: ['e'] },
  ],
  updated: '2026-09-04',
  count: 3,
};

async function open(browser, { payload = PAYLOAD, lang = '', w = 1280, h = 900, status = 200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'zh-TW' });
  await ctx.route('**/api/weekend*', r => status === 200
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
    : r.fulfill({ status, body: 'err' }));
  await ctx.route(/ev\.invalid/, r =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>ev</title>ok' }));
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message || e)));
  await pg.goto(BASE + '/weekend.html' + (lang ? '?lang=' + lang : ''), { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.body.dataset.ready, null, { timeout: 15000 });
  pg._errs = errs;
  return { ctx, pg };
}

const browser = await chromium.launch();
try {
  console.log('\n【A】正常渲染');
  {
    const { ctx, pg } = await open(browser);
    chk('A1 沒有 page error', pg._errs.length === 0, pg._errs.join(' / '));
    chk('A2 標題用 span.label', (await pg.locator('#h1').textContent()) === '本週末');
    chk('A3 日期區間', (await pg.locator('#range').textContent()).includes('09/05–09/06'));
    chk('A4 四張卡（限定 3 ＋ 長期 1）', (await pg.locator('#body .ev').count()) === 4, '限定 3 + alsoOpen 1');
    chk('A5 兩個分節', (await pg.locator('#body h2').count()) === 2);
    chk('A6 多天活動顯示兩個日期', (await pg.locator('.ev-when').first().textContent()).includes('、'));
    chk('A7 顯示站名', (await pg.locator('#body').textContent()).includes('廣慈/奉天宮站'));
    chk('A8 顯示資料更新日', (await pg.locator('#foot').textContent()).includes('2026-09-04'));
    await ctx.close();
  }

  console.log('\n【B】連結安全');
  {
    const { ctx, pg } = await open(browser);
    const hrefs = await pg.locator('#body a.ev').evaluateAll(a => a.map(x => x.getAttribute('href')));
    chk('B1 只有兩張卡是連結（沒連結與惡意連結都不是 <a>）', hrefs.length === 2, JSON.stringify(hrefs));
    chk('B2 沒有任何 javascript: href', !hrefs.some(h => /^javascript:/i.test(h || '')));
    chk('B3 外連都有 rel=noopener',
      (await pg.locator('#body a.ev').evaluateAll(a => a.every(x => (x.getAttribute('rel') || '').includes('noopener')))));
    chk('B4 惡意連結沒有被執行', (await pg.evaluate(() => window.__pwned)) === undefined);
    chk('B5 標題有跳脫', (await pg.evaluate(() => window.__xss)) === undefined);
    await ctx.close();
  }

  console.log('\n【C】空狀態與錯誤態');
  {
    const { ctx, pg } = await open(browser, { payload: { ...PAYLOAD, events: [], alsoOpen: [], count: 0 } });
    chk('C1 空狀態有文案', (await pg.locator('.empty').textContent()).includes('沒有收錄到活動'));
    chk('C2 空狀態不顯示分節標題', (await pg.locator('#body h2').count()) === 0);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(browser, { status: 503 });
    chk('C3 API 掛掉頁面仍打得開', (await pg.evaluate(() => document.body.dataset.ready)) === 'error');
    chk('C4 錯誤態有文案', (await pg.locator('.empty').textContent()).includes('暫時讀不到'));
    chk('C5 錯誤態仍有回地圖的路', (await pg.locator('#foot a').count()) === 1);
    await ctx.close();
  }

  console.log('\n【D】多語');
  {
    const { ctx, pg } = await open(browser, { lang: 'en' });
    chk('D1 英文分節標題', (await pg.locator('#body h2').first().textContent()) === 'Only during these days');
    chk('D2 中文來源有標記', (await pg.locator('#body').textContent()).includes('Chinese source'));
    chk('D3 html lang 跟著換', (await pg.evaluate(() => document.documentElement.lang)) === 'en');
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(browser, { lang: 'nonsense' });
    chk('D4 不認得的語言退回中文', (await pg.locator('#body h2').first().textContent()) === '這段期間限定');
    await ctx.close();
  }

  console.log('\n【E】手機四寬不溢版');
  for (const w of [360, 375, 414, 768]) {
    const { ctx, pg } = await open(browser, { w, h: 800 });
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    chk(`E${w} ${w}px 沒有水平溢版`, overflow === false);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${fail ? '❌' : '✅'} weekend-page：${pass} 過 / ${fail} 失敗`);
if (fail) { console.error('失敗項目：\n  - ' + bad.join('\n  - ')); process.exit(1); }
