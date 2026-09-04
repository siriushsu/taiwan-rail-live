// 週末活動入口(更多抽屜 + 探索面板)的驗收。
// 用法:node scripts/verify_weekend_entry.mjs            (預設 http://localhost:5187)
//       VURL=http://localhost:<port> node scripts/verify_weekend_entry.mjs
// 🔴 route 只攔 /api/weekend、data/events.json、與 weekend.html 三條,不要全攔
//    (ctx.route('**/*') 會把 CDN 的 Leaflet 一起擋掉,頁面 boot 永遠不 ready,這個 repo
//    2026-08-10 踩過)。
// 🔴 locale 釘 zh-TW:文案判準隨機器語系會假紅,與真回歸不可分辨。
// 🔴「點下去會怎樣」一律真的點一次並量新分頁的網址,不用 elementFromPoint
//    ——那答的是「點到誰」不是「點了會怎樣」。
// 🔴 每一節都包 try/catch(比照 verify_events.mjs 既有慣例):把入口列的處理器整個拿掉的
//    突變會讓 #expBody 永遠等不到 .row[data-weekend],row.waitFor() 逾時拋出——沒接住的話
//    整支腳本會在那裡當場中止,連 L 段與最後的總計行都不會印,看起來比「全部失敗」還糟
//    (這個坑在寫測試當下就實測撞到過一次:突變 A 直接讓 process 帶著未捕捉例外死掉)。
import { chromium } from 'playwright';

const BASE = process.env.VURL || 'http://localhost:5187';
let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}
const errMsg = e => String((e && e.message) || e).split('\n')[0].slice(0, 160);

// 🔴 span.label 刻意選一個「不等於 weekendRowHtml() 內建 fallback 文字(本週末)」的值——
// 若兩者相同,X2(顯示 API 給的標題)不管 ensureWeekendCount() 到底有沒有真的接到 API,
// 渲染出來的文字都會是同一個字串,判準會變成恆真(這正是這條產線 Task 5/6 反覆退件的
// 那種「判準看起來綠,其實沒驗到東西」形態)。'光復節連假' 是 span.label 實際會出現的
// 值之一(brief 原文列舉),用它就能真正分辨「API 值有沒有流進 DOM」。
const API = { today: '2026-09-04', span: { from: '2026-09-05', to: '2026-09-06', days: 2, label: '光復節連假' },
  events: [{ title: 'x', days: ['2026-09-05'], places: [], url: '', note: '', ids: ['1'] },
           { title: 'y', days: ['2026-09-06'], places: [], url: '', note: '', ids: ['2'] }],
  alsoOpen: [], updated: '2026-09-04', count: 2 };

// 🔴 X4(入口列排在近期活動之上)原始判準有一道逃生門:eventSecHtml() 在 activeEvents()
// 為空時回空字串,頁面上根本不會出現「近期活動」這個 sec,判準的 (order.sec < 0) 分支會
// 讓整條件恆真——完全沒比較到順序。activeEvents() 的時間窗跟著「真實的今天」浮動(見
// index.html EVENT_LEAD_DAYS),不能寫死日期,所以這裡用相對日期組一則「測試當下必定
// active」的活動,並攔 data/events.json 讓它一定被讀到(不依賴磁碟上 data/events.json
// 當天實際內容,也不依賴真實時鐘落在哪一天)。
const TPE = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
const isoDay = d => d.toISOString().slice(0, 10);
const shiftDay = n => { const d = new Date(Date.UTC(TPE.getFullYear(), TPE.getMonth(), TPE.getDate())); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };
const EVENTS_FIXTURE = {
  updated: shiftDay(0),
  events: [
    { id: 'entry-order-probe', source: 'official', title: '入口排序探針活動', start: shiftDay(0), end: shiftDay(2),
      anchor: { kind: 'system', sys: 'tra_sched' }, url: 'https://example.invalid/weekend-entry-probe' },
  ],
};

async function open(browser, { lang = '', w = 1280, h = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'zh-TW' });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await ctx.route('**/api/weekend*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(API) }));
  await ctx.route('**/data/events.json*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EVENTS_FIXTURE) }));
  await ctx.route(/railisland\.tw\/weekend\.html/, r =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>wk</title>ok' }));
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/index.html' + (lang ? '?lang=' + lang : ''), { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => state && state.ready === true, null, { timeout: 45000 });
  return { ctx, pg };
}
// 🔴 開抽屜的鈕【不是】一顆:桌面是 #toolsFab(index.html:700 全域 display:none,:4531 在
// body:not(.mobile-shell) 才重新啟用)、手機是 tab bar 的 #tabMore(.tabbar 在 :3633 的媒體查詢
// 才 display:flex)。#moreBtn 不存在。用「哪顆看得見就點哪顆」,一支測試同時吃兩種殼。
async function openMoreDrawer(pg) {
  const fab = pg.locator('#toolsFab');
  await (await fab.isVisible() ? fab : pg.locator('#tabMore')).click();
  await pg.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
}
async function urlOpenedBy(ctx, locator) {
  const [page] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    locator.click({ timeout: 5000 }).catch(() => {}),
  ]);
  return page ? page.url() : null;
}

const browser = await chromium.launch();
try {
  console.log('\n【M】更多抽屜（桌面殼與手機殼各一次）');
  for (const [shell, w, h] of [['桌面', 1280, 900], ['手機', 390, 844]]) try {
    const { ctx, pg } = await open(browser, { w, h });
    await openMoreDrawer(pg);
    const row = pg.locator('.ms-row[data-act="weekend"]');
    chk(`M1 ${shell} 抽屜有這一列`, (await row.count()) === 1);
    chk(`M2 ${shell} 列的文字`, (await row.textContent()).includes('週末鐵道活動'));
    chk(`M3 ${shell} 點了會開週末頁`, /weekend\.html/.test(await urlOpenedBy(ctx, row) || ''));
    await ctx.close();
  } catch (e) { chk(`M! ${shell} 這一節整節跑完不拋例外`, false, errMsg(e)); }

  console.log('\n【X】探索面板入口列');
  try {
    const { ctx, pg } = await open(browser);
    await pg.click('#exploreBtn');
    const row = pg.locator('#expBody .row[data-weekend]');
    await row.waitFor({ timeout: 10000 });
    chk('X1 面板有入口列', (await row.count()) === 1);
    chk('X2 顯示 API 給的標題', (await row.textContent()).includes('光復節連假'));
    chk('X3 顯示場次數', (await row.textContent()).includes('2 場'));
    // 排序:入口列必須在「近期活動」那個 sec 之前。data/events.json 已被攔成保證 active 的
    // fixture,「近期活動」sec 這次必定存在——X4a 先證明這件事,X4b 才是真正的順序比較,
    // 兩條都過才算真的驗到順序(拆成兩條是刻意的:X4b 單獨存在時,原本的逃生門
    // order.sec < 0 仍可能讓它意外恆真;X4a 把那道逃生門直接堵死)。
    const order = await pg.evaluate(() => {
      const kids = [...document.querySelectorAll('#expBody > *')];
      const wk = kids.findIndex(k => k.matches('.row[data-weekend]'));
      const sec = kids.findIndex(k => k.classList.contains('sec') && k.textContent.includes('近期活動'));
      return { wk, sec };
    });
    chk('X4a 近期活動區塊確實存在(逃生門沒有被觸發)', order.sec >= 0, JSON.stringify(order));
    chk('X4b 入口列排在近期活動之上', order.wk >= 0 && order.sec >= 0 && order.wk < order.sec, JSON.stringify(order));
    chk('X5 點了會開週末頁', /weekend\.html/.test(await urlOpenedBy(ctx, row) || ''));
    await ctx.close();
  } catch (e) { chk('X! 這一節整節跑完不拋例外', false, errMsg(e)); }

  console.log('\n【L】語言帶過去');
  try {
    const { ctx, pg } = await open(browser, { lang: 'ja' });
    await openMoreDrawer(pg);
    const u = await urlOpenedBy(ctx, pg.locator('.ms-row[data-act="weekend"]'));
    chk('L1 日文介面帶 ?lang=ja', /[?&]lang=ja/.test(u || ''), String(u));
    await ctx.close();
  } catch (e) { chk('L1! 這一節整節跑完不拋例外', false, errMsg(e)); }
  try {
    const { ctx, pg } = await open(browser);
    await openMoreDrawer(pg);
    const u = await urlOpenedBy(ctx, pg.locator('.ms-row[data-act="weekend"]'));
    chk('L2 中文介面不帶 lang 參數', !/[?&]lang=/.test(u || ''), String(u));
    await ctx.close();
  } catch (e) { chk('L2! 這一節整節跑完不拋例外', false, errMsg(e)); }
} finally {
  await browser.close();
}

console.log(`\n${fail ? '❌' : '✅'} weekend-entry：${pass} 過 / ${fail} 失敗`);
if (fail) { console.error('失敗項目：\n  - ' + bad.join('\n  - ')); process.exit(1); }
