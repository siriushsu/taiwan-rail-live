#!/usr/bin/env node
// 公車站牌搜尋的瀏覽器驗收（單元 C 第一批）。真的開 Chromium，真的打字，真的點下去。
//
// 🔴 語系與時鐘都釘死：
//    - 語系：用 ?lang= 指定，並且【不用中文字串找元件】——選取器一律是 .bus-row／.bus-eta-row
//      這類語系無關的 class。文案的期望值從 i18n/translations.js 讀出來比對，不寫死在本檔，
//      否則字典改了這支會紅得完全不像語系問題。
//    - 時鐘：API 走本檔自架的 fixture server，回傳固定內容，不打真上游（真上游此刻有幾班車
//      是會漂的，拿它當期望值等於判準綁在會漂的量上）。
//
// 用法：node scripts/verify_bus_stop_browser.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = process.env.WORKSPACE_NODE_MODULES;
const { chromium } = await import(modules ? pathToFileURL(path.join(modules, 'playwright/index.mjs')).href : 'playwright');

// 期望文案從字典讀，不寫死。
// 🔴 必須照 index.html 的 <script> 順序把三份字典都載入再合併：同一個鍵出現在多份字典時
//    後載入的那份才生效，只讀 translations.js 會拿到「看得到但不生效」的那一份，
//    紅起來看不出是字典遮蔽問題（本支第一次跑就是這樣紅的）。
const dict = (() => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="\.\/(i18n\/[a-z-]+\.js)"><\/script>/g)].map(m => m[1]);
  assert(files.length >= 2, `index.html 只掃到 ${files.length} 份字典，選取器可能過期`);
  const box = { window: {} };
  for (const f of files) vm.runInNewContext(readFileSync(path.join(ROOT, f), 'utf8'), box);
  return box.window.RAIL_I18N_MESSAGES;
})();
const say = (lang, zh) => (lang === 'zh-TW' ? zh : (dict[lang] && dict[lang][zh]) || zh);

// 四個官方負值各一筆 + 一筆倒數，證明五種語意在畫面上真的長得不一樣。
const FIXTURE_SEARCH = {
  query: 'fixture', total: 2,
  rows: [
    { stationUid: 'TPE-FIX-1', name: '固定站甲', city: 'Taipei', cityLabel: '臺北市', provider: 'direct-bulk', position: { lat: 25.047, lon: 121.517 }, routes: ['0東', '307'] },
    { stationUid: 'ILA-FIX-1', name: '固定站乙', city: 'YilanCounty', cityLabel: '宜蘭縣', provider: 'tdx-per-stop', position: { lat: 24.757, lon: 121.758 }, routes: ['綠19'] },
  ],
};
const live = (state, etaSec) => ({ state, sourceState: state, etaSec, estimateSecAtSource: etaSec, ageSec: 5, staleAfterSec: 180 });
const FIXTURE_LIVE = {
  stop: { stationUid: 'TPE-FIX-1', name: '固定站甲', city: 'Taipei', cityLabel: '臺北市', position: null, routes: [] },
  provider: 'direct-bulk',
  source: { kind: 'direct-bulk', attribution: '臺北市政府交通局公共運輸處「臺北市公車動態資訊」', license: '政府資料開放授權條款－第1版' },
  routes: [
    { routeId: '901', routeName: 'R-countdown', direction: 0, arrivals: [{ key: 'a', live: live('countdown', 420) }] },
    { routeId: '902', routeName: 'R-notdeparted', direction: null, arrivals: [{ key: 'b', live: live('not_departed', null) }] },
    { routeId: '903', routeName: 'R-skipped', direction: 1, arrivals: [{ key: 'c', live: live('skipped', null) }] },
    { routeId: '904', routeName: 'R-lastbus', direction: null, arrivals: [{ key: 'd', live: live('last_bus_passed', null) }] },
    { routeId: '905', routeName: 'R-notoperating', direction: 0, arrivals: [{ key: 'e', live: live('not_operating', null) }] },
  ],
  arrivals: [], totals: { arrivals: 5, providerStopIds: 2 },
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.bin': 'application/octet-stream', '.tsv': 'text/tab-separated-values' };
let searchCalls = 0, liveCalls = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/bus-stop-search') {
    searchCalls += 1;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ...FIXTURE_SEARCH, query: url.searchParams.get('q') || '' }));
  }
  if (url.pathname === '/api/bus-stop-live') {
    liveCalls += 1;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(FIXTURE_LIVE));
  }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 503; return res.end('{}'); }
  let fp = path.resolve(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (path.relative(ROOT, fp).startsWith('..')) { res.statusCode = 404; return res.end('nf'); }
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  const type = MIME[path.extname(fp)];
  if (!type || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', type);
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

const browser = await chromium.launch({ headless: true });
async function withPage(lang, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));   // 逾時訊息本身零資訊，先掛這個才看得到真因
  try {
    await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#trainSearch').waitFor({ state: 'visible', timeout: 30000 });
    // 🔴 開機途中好幾處會把 #trainSearch 清空，太早打字會被洗掉而看起來像「功能沒接上」。
    // 等到空查詢的建議鈕真的畫出來為止——那要 tra_sched 的班表載完才生得出來，是真的開機訊號。
    // 用 class 當訊號，不是中文字（語系無關）。
    await page.locator('#trainSearch').click();
    await page.locator('.rd-suggestions button').first().waitFor({ state: 'visible', timeout: 30000 });
    return await fn(page, errors);
  } finally { await context.close(); }
}
// fill() 在這個頁面不可靠（它一次設定完值再派事件，而開機途中的清空會蓋過去）；
// pressSequentially 一個字一個字打，與真人一致。
const typeQuery = (page, text) => page.locator('#trainSearch').pressSequentially(text, { delay: 40 });

for (const lang of ['zh-TW', 'en']) {
  await check(`[${lang}] 打字 → 出現公車站牌列，且列上帶縣市與路線`, () => withPage(lang, async (page, errors) => {
    const before = searchCalls;
    await typeQuery(page, '固定站');
    await page.locator('.bus-row').first().waitFor({ state: 'visible', timeout: 15000 });
    assert(searchCalls > before, '沒有打搜尋端點');
    const rows = page.locator('.bus-row');
    assert.equal(await rows.count(), 2, '應該有兩列');
    const first = await rows.first().innerText();
    assert(first.includes('固定站甲'), `第一列少了站名：${first}`);
    assert(first.includes('臺北市'), `第一列少了縣市：${first}`);   // cityLabel 由 API 給，非 i18n key
    assert(first.includes('0東'), `第一列少了路線：${first}`);
    assert.deepEqual(errors, [], `有 pageerror：${errors.join(' | ')}`);
  }));

  await check(`[${lang}] 點站牌 → 出現到站卡，四種官方負值各自是不同文案`, () => withPage(lang, async (page, errors) => {
    const before = liveCalls;
    await typeQuery(page, '固定站');
    await page.locator('.bus-row').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.bus-row').first().click();
    await page.locator('.bus-eta-row').first().waitFor({ state: 'visible', timeout: 15000 });
    assert(liveCalls > before, '沒有打到站端點');
    const texts = await page.locator('.bus-eta-row').allInnerTexts();
    assert.equal(texts.length, 5, `應該五列，實際 ${texts.length}`);
    // 四個負值的文案兩兩不同——收斂成同一句正是設計書點名禁止的事。
    const negatives = texts.slice(1).map(s => s.split('\n').pop().trim());
    assert.equal(new Set(negatives).size, 4, `四種語意共用了文案：${JSON.stringify(negatives)}`);
    // 文案必須真的是這個語系的那一份（期望值從字典讀，不寫死）。
    const expect = ['尚未發車', '交管不停靠', '末班已過', '今日未營運'].map(zh => say(lang, zh));
    assert.deepEqual(negatives, expect, `文案與 ${lang} 字典不符：${JSON.stringify(negatives)} vs ${JSON.stringify(expect)}`);
    // 倒數那一列要顯示分鐘（420 秒 → 7 分）；斷言只看「有數字 7」，不綁單位字。
    assert(/\b7\b/.test(texts[0]), `倒數列沒顯示分鐘：${texts[0]}`);
    // 署名必須在卡片上
    const card = await page.locator('.sd-named').innerText();
    assert(card.includes('臺北市政府交通局公共運輸處'), `卡片少了來源署名：${card}`);
    assert.deepEqual(errors, [], `有 pageerror：${errors.join(' | ')}`);
  }));
}

// 反向判準的正向對照：搜尋不到東西時不可以有 .bus-row（證明上面的 count===2 不是恆真）。
await check('查無公車站牌時不得出現 bus-row（正向對照）', () => withPage('zh-TW', async page => {
  FIXTURE_SEARCH.rows = []; FIXTURE_SEARCH.total = 0;
  try {
    await typeQuery(page, '固定站');
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.bus-row').count(), 0, '空結果卻畫出了 bus-row');
  } finally {
    FIXTURE_SEARCH.total = 2;
    FIXTURE_SEARCH.rows = [
      { stationUid: 'TPE-FIX-1', name: '固定站甲', city: 'Taipei', cityLabel: '臺北市', provider: 'direct-bulk', position: null, routes: ['0東', '307'] },
      { stationUid: 'ILA-FIX-1', name: '固定站乙', city: 'YilanCounty', cityLabel: '宜蘭縣', provider: 'tdx-per-stop', position: null, routes: ['綠19'] },
    ];
  }
}));

await browser.close();
server.close();
if (failures) { console.error(`\n${failures} 項未過`); process.exit(1); }
console.log('\nGREEN 全部通過');
