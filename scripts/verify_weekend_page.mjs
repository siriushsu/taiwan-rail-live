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
    // 這一則常設帶兩種互相獨立的攻擊向量:url(javascript:)與 title(HTML 注入)。
    // safeUrl() 擋前者、esc() 擋後者,B4 驗前者、B5/B6 驗後者。
    // 🔴 title 故意不還原成安全字串(修復輪 1 之前的版本會還原,結果 card() 拿掉
    // esc(ev.title) 之後 B5 量不到任何差異——常設留著攻擊字串,判準才有牙。
    { title: '<img src=x onerror="window.__xss=1">', note: '', url: 'javascript:window.__pwned=1',
      days: ['2026-09-06'], places: [{ sys: 'mrt', station: '中山' }], ids: ['d'] },
    // 發現 2(標題不含空白的長字串會不會溢版)＋發現 3(三天以上區間要顯示成
    // 「頭–尾」而不是逐日頓號列舉)的常設 fixture,兩者合併成同一則:活動資料讀自
    // 官方公告草稿,長英文型號/專有名詞不斷行、連假 3 天以上(春節九天)都是真實會
    // 發生的輸入,不是刻意刁難的邊界值。故意放在陣列最後一個(events[3]),
    // 不打亂 events[0..2] 既有的 DOM 位置(A6/B5/B6 都靠固定索引指名)。
    { title: 'NewYearFestivalContinuousNineDayCelebrationExtravaganzaTaipeiMRT2026SpecialEditionTicketBundleCode',
      note: '', url: '',
      days: ['2026-09-05', '2026-09-06', '2026-09-07'], places: [{ sys: 'mrt', station: '台北車站' }], ids: ['f'] },
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
    chk('A4 五張卡（限定 4 ＋ 長期 1）', (await pg.locator('#body .ev').count()) === 5, '限定 4 + alsoOpen 1');
    chk('A5 兩個分節', (await pg.locator('#body h2').count()) === 2);
    chk('A6 多天活動顯示兩個日期', (await pg.locator('.ev-when').first().textContent()).includes('、'));
    chk('A7 顯示站名', (await pg.locator('#body').textContent()).includes('廣慈/奉天宮站'));
    chk('A8 顯示資料更新日', (await pg.locator('#foot').textContent()).includes('2026-09-04'));
    // events[3](第 4 張卡、DOM 序 nth(3))是唯一 3 天以上的活動:whenText() 三天以上
    // 分支應該顯示「頭–尾」區間,不是逐日頓號列舉(那是兩天分支的行為,見 A6)。
    chk('A9 三天以上活動顯示區間（不是逐日列舉）',
      (await pg.locator('#body .ev').nth(3).locator('.ev-when').textContent()) === '09/05–09/07');
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
    // 這裡原本有一條「B4 惡意連結沒有被執行」,量 window.__pwned === undefined——
    // 已刪除(2026-09-04 修復輪 2)。理由:整支測試從不 .click() 也不導覽,javascript:
    // URI 只有真的被點擊才會執行,所以那條不管實作對不對永遠是綠的。
    // 惡意連結的防線就是上面 B1(它連不上 <a> 都當不成)＋B2(DOM 裡完全沒有
    // javascript: 這個字串)——兩者是屬性層級的檢查,涵蓋所有可能觸發途徑
    // (滑鼠點擊、鍵盤 Enter、螢幕報讀器啟用……),比「模擬點擊再看有沒有執行」
    // 涵蓋範圍更廣、也更直接:href 屬性本身就不含危險 scheme,才是不能執行的
    // 根本原因,不是巧合地沒被點到。
    // 曾考慮改成「真的點擊那張卡」讓它名副其實,但實測(Playwright+Chromium)發現
    // card() 對任何有效連結都無條件加 target="_blank" rel="noopener",而
    // Chromium 對 target="_blank" 的 javascript: href 一律不執行、只開一個
    // about:blank 分頁——不管 safeUrl() 有沒有把關都一樣。這代表：用這頁真實產出的
    // markup 去點擊,測到的其實是瀏覽器自己對新分頁的限制,不是 safeUrl() 在擋,
    // 硬做出來的「點擊測試」一樣會是恆真判準,只是恆真的原因換了一個、更難被發現。
    // B5 是反向判準(注入的 script 沒有被執行),B6 是正向對照(標題確實被當純文字渲染)。
    // 只有反向判準會恆真無牙——B6 逐位元組核對 textContent,esc() 被拿掉時 <img> 會被
    // 瀏覽器解析成元素、.ev-title 的 textContent 變空字串,兩條各自獨立驗到不同的失效模式。
    // events[2](第 3 張卡、DOM 序 nth(2))是唯一帶 HTML 注入字元的標題,選取器指名到它。
    chk('B5 標題沒有被當成 script 執行', (await pg.evaluate(() => window.__xss)) === undefined);
    chk('B6 標題文字內容等於原字串（渲染成文字，不是被解析成 HTML）',
      (await pg.locator('#body .ev').nth(2).locator('.ev-title').textContent()) === PAYLOAD.events[2].title);
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
