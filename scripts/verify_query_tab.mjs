// 查詢分頁（2026-09-06 spec §7）驗收：chromium＋webkit、手機視窗、真觸控。
// 用法：node scripts/verify_query_tab.mjs [目標目錄]   ENGINES=chromium 只跑一個引擎
// 每一段判準都寫「使用者看得到的行為」，並在 spec §7 對應一條「牙」（突變必紅）。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
const PORT = Number(process.env.PORT || 5266);
const BASE = `http://localhost:${PORT}/`;
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    // 高鐵班表主來源是 /api/thsr-schedule（空物件會讓 fallback 永不啟動 ⇒ boot 卡死），吐打包的那份；其餘 API 一律空物件（離線）。
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

// G0：先證明「驗的是這棵樹」——多 worktree 並行，硬編埠號很容易連到別人的伺服器。
{
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const served = createHash('md5').update(await (await fetch(BASE)).text()).digest('hex');
  const build = (readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
  ok(`G0 驗的是目標目錄（${ROOT}，BUILD ${build}，md5 ${disk.slice(0, 8)}）`, disk === served, `磁碟 ${disk.slice(0, 10)} / 伺服器 ${served.slice(0, 10)}`);
  if (disk !== served) { server.close(); process.exit(1); }
}

/**
 * 開機。opts：
 *   width/height 視窗；query 網址參數（含 ?geomock=lat,lon&geoacc=…）；
 *   howto=true 讓首訪教學卡出現（預設已看過）；storage 預先塞 localStorage；
 *   app=true 假裝原生殼（IS_NATIVE_APP）；plugins 假裝 Capacitor plugins（{RailMetroWait:{}, RailWidget:{…}}）；
 *   notify=true 注入本地提醒 mock（走 ?notifymock=1）。
 */
async function boot(browser, { width = 393, height = 852, query = '', howto = false, storage = {}, app = false, plugins = null, notify = false, platform = 'android' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'zh-TW' });
  await ctx.addInitScript(a => {
    try {
      if (!a.howto) localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('iabHintDismiss', String(Date.now() + 1e9));
      localStorage.setItem('trainmap-appearance', 'light');
      localStorage.setItem('trainmap-language', 'zh-TW');
      localStorage.removeItem('trainmap-sheet-size');
      for (const k of Object.keys(a.storage)) localStorage.setItem(k, a.storage[k]);
    } catch (e) {}
    // App 替身:IS_NATIVE_APP 只看這個 key 在不在(index.html 12284);值給 true 讓 onlineBasemapsAvailable() 維持正常路徑。
    // 不裝 isNativePlatform——IS_NATIVE_APP 已經由 key 成立,多裝只會把 PLUS 等別的原生分支一起打開。
    if (a.app) window.RAIL_ONLINE_BASEMAPS_AVAILABLE = true;
    if (a.plugins) window.Capacitor = { Plugins: a.plugins, getPlatform: () => a.platform };
  }, { howto, storage, app, plugins, platform });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const q = ['lang=zh-TW', notify ? 'notifymock=1' : '', query.replace(/^[?&]/, '')].filter(Boolean).join('&');
  await page.goto(BASE + '?' + q, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return { ctx, page, errs };
}

/** 由頁面本身取站座標——不手打常數（判準盲點 3）。sys：'tra_sched' | 'deco' | 'freq'。 */
async function stationOf(page, name, sys) {
  return page.evaluate(([n, s]) => { const c = nearbyStationCandidates().find(x => x.st.name === n && x.st.sys === s); return c ? { name: c.st.name, sys: c.st.sys, lat: c.st.lat, lon: c.st.lon } : null; }, [name, sys]);
}
/** 往北偏 meters 公尺（1 度緯度 ≈ 111,320 m）。 */
const offsetLatLon = (st, meters) => ({ lat: st.lat + meters / 111320, lon: st.lon });
const geomock = (p, acc = 65) => `geomock=${p.lat.toFixed(6)},${p.lon.toFixed(6)}&geoacc=${acc}`;

/** 真觸控點 tab「查詢」。 */
async function tapTab(page) {
  const box = await page.evaluate(() => { const r = document.getElementById('tabSearch').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(box.x, box.y);
  await page.waitForTimeout(400);
}
const SNAP = `(() => {
  const p = document.getElementById('searchPanel'), r = p.getBoundingClientRect(), tb = document.getElementById('tabbar');
  return { hidden: p.hidden, cls: p.className, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight,
    searchOpen: document.body.classList.contains('search-open'), sheetOpen: document.body.classList.contains('sheet-open'),
    tabbarVisible: !!tb && getComputedStyle(tb).display !== 'none',
    answerRows: [...document.querySelectorAll('#queryAnswer .qa-stn')].map(b => ({ head: (b.querySelector('.qa-head') || {}).textContent, rows: [...b.querySelectorAll('.row')].map(x => x.textContent.trim()) })),
    links: [...document.querySelectorAll('#queryLinks .ql-row')].map(b => b.dataset.act) };
})()`;
const snap = page => page.evaluate(c => eval(c), SNAP);

const sections = []; // 後續 task 各自 push({ name, run: async (browser, engineName) => {} })

// G1 瀏覽態幾何（spec §7-3）：點 tab 開 sheet 後 tab bar 仍可見、沒有 search-open、面板是底部 sheet（不是上錨全高）。
// 牙：開 sheet 就套 search-open ⇒ G1b 紅。
sections.push({ name: 'G1 瀏覽態', run: async (browser, en) => {
  for (const width of [360, 375, 414, 768]) {
    const { ctx, page, errs } = await boot(browser, { width, height: width === 768 ? 1024 : 852 });
    await tapTab(page);
    const s = await snap(page);
    ok(`[${en}/${width}] G1a 點 tab 後查詢 sheet 開著`, !s.hidden && s.sheetOpen, JSON.stringify({ hidden: s.hidden, sheetOpen: s.sheetOpen }));
    ok(`[${en}/${width}] G1b 瀏覽態沒有 search-open、tab bar 可見`, !s.searchOpen && s.tabbarVisible, JSON.stringify({ searchOpen: s.searchOpen, tabbar: s.tabbarVisible }));
    ok(`[${en}/${width}] G1c 面板是底部 sheet（高度 ≤ 視窗 60%，貼底）`, s.h <= s.vh * 0.6 && s.bottom >= s.vh - 120, JSON.stringify({ h: s.h, vh: s.vh, bottom: s.bottom }));
    ok(`[${en}/${width}] G1d tab「查詢」文字`, (await page.evaluate(() => document.querySelector('#tabSearch .tl').textContent.trim())) === '查詢');
    ok(`[${en}/${width}] G1e 無 pageerror`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  // 橫放(4183 起的 landscape 區塊;MOBILE_MQ 靠 max-height:500px 命中,開機自動套 body.fs)：
  // 瀏覽態要退回通用側欄(4190 那組)、tab bar 不被蓋住；打字態才換右半全高(§04c 契約9,4474 起)。
  // 牙：F1 修前 body.fs #searchPanel 的右半版面沒掛 search-open ⇒ 瀏覽態面板就貼到視窗底,蓋過 tab bar ⇒ G1f 紅。
  {
    const { ctx, page } = await boot(browser, { width: 852, height: 393 });
    await tapTab(page);
    let g = await page.evaluate(() => {
      const p = document.getElementById('searchPanel').getBoundingClientRect();
      const tb = document.getElementById('tabbar');
      const tbr = tb.getBoundingClientRect();
      return {
        searchOpen: document.body.classList.contains('search-open'),
        tabbarVisible: !!tb && getComputedStyle(tb).display !== 'none',
        panelBottom: Math.round(p.bottom), tabbarTop: Math.round(tbr.top),
        panelRight: Math.round(p.right), panelWidth: Math.round(p.width), vw: innerWidth,
      };
    });
    ok(`[${en}/landscape] G1f 瀏覽態是右側欄、沒被 tab bar 蓋住`,
      !g.searchOpen && g.tabbarVisible && g.panelBottom <= g.tabbarTop + 1 && g.panelRight >= g.vw - 40 && g.panelWidth < g.vw * 0.6,
      JSON.stringify(g));
    const inp = await page.evaluate(() => { const r = document.getElementById('trainSearch').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(inp.x, inp.y);
    await page.waitForTimeout(400);
    g = await page.evaluate(() => ({
      searchOpen: document.body.classList.contains('search-open'),
      tabbarDisplay: getComputedStyle(document.getElementById('tabbar')).display,
      panelBottom: Math.round(document.getElementById('searchPanel').getBoundingClientRect().bottom), vh: innerHeight,
    }));
    ok(`[${en}/landscape] G1g 打字態換右半全高、tab bar 藏`,
      g.searchOpen && g.tabbarDisplay === 'none' && g.panelBottom >= g.vh - 2,
      JSON.stringify(g));
    await ctx.close();
  }
}});

// G2 打字態（spec §7-4）：focus 輸入框 ⇒ search-open、tab bar 藏；blur 不離開；標題列輕點或關閉才離開。
// 牙：blur 就離開 ⇒ G2c 紅；focus 不進打字態 ⇒ G2a 紅。
sections.push({ name: 'G2 打字態', run: async (browser, en) => {
  const { ctx, page } = await boot(browser, {});
  await tapTab(page);
  const inp = await page.evaluate(() => { const r = document.getElementById('trainSearch').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(inp.x, inp.y);
  await page.waitForTimeout(400);
  let s = await snap(page);
  // 直式的打字態 tab bar 仍在(只有橫放的 body.fs.search-open .tabbar 會藏,那是 4182 起的 landscape 區塊,不動);判打字態看「上錨」
  ok(`[${en}] G2a 點輸入框 ⇒ 打字態（search-open、面板上錨到頂列之下）`, s.searchOpen && s.top <= 140, JSON.stringify({ searchOpen: s.searchOpen, top: s.top }));
  await page.evaluate(() => document.getElementById('trainSearch').blur());
  await page.waitForTimeout(300);
  s = await snap(page);
  ok(`[${en}] G2c blur 不離開打字態`, s.searchOpen, JSON.stringify({ searchOpen: s.searchOpen }));
  // 標題列輕點（抓把手勢）⇒ 回瀏覽態
  const head = await page.evaluate(() => { const r = document.querySelector('#searchPanel h3').getBoundingClientRect(); return { x: r.left + 30, y: r.top + 12 }; });
  await page.mouse.move(head.x, head.y); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(500);
  s = await snap(page);
  ok(`[${en}] G2d 標題列輕點 ⇒ 回瀏覽態（sheet 仍開、search-open 消失、回到底部 sheet 幾何）`, !s.hidden && !s.searchOpen && s.h <= s.vh * 0.6, JSON.stringify({ hidden: s.hidden, searchOpen: s.searchOpen, h: s.h, vh: s.vh }));
  // 牙：F6 修前 cycleSheetSize 對 search-open 分支呼叫 setSheetSize(el,'medium') 會持久化全站偏好 ⇒ G2f 紅
  const sheetSizeLS = await page.evaluate(() => { try { return localStorage.getItem('trainmap-sheet-size'); } catch (e) { return 'ERR'; } });
  ok(`[${en}] G2f 離開打字態不寫入全站段高偏好`, sheetSizeLS === null, JSON.stringify({ sheetSizeLS }));
  // 再進打字態，用 × 關閉 ⇒ 兩者皆清
  await page.touchscreen.tap(inp.x, inp.y); await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('searchPanelClose').click()); await page.waitForTimeout(300);
  s = await snap(page);
  ok(`[${en}] G2e × 關閉 ⇒ sheet 關、search-open 清`, s.hidden && !s.searchOpen && s.tabbarVisible);
  await ctx.close();
}});

// G7 更多抽屜（spec §7-7）：手機三列 display:none、桌面「今日台鐵動態」仍在可點；全日班次走勢手機仍在。
// 牙：拿掉媒體查詢 ⇒ G7a 紅；把 [data-home="query"] 隱藏規則放到 MOBILE_MQ 外面 ⇒ 桌面 todayBtn 也被關掉 ⇒ G7c 紅。
// 訂正（task-2 決議）：brief 原稿的 G7c 連桌面「全日班次走勢」也一併斷言存在，但桌面本來就有既有規則
// （4539 一帶 body:not(.mobile-shell) .ms-row[data-act="flow"]{display:none!important}）刻意把抽屜那列關掉——
// 桌面版面上已經有本體，不重複。那條規則與本 task 無關，G7c 只驗「今日台鐵動態」。
sections.push({ name: 'G7 更多抽屜', run: async (browser, en) => {
  const { ctx, page } = await boot(browser, { query: 'notifymock=1&' + 'geomock=25.0478,121.5170' });
  const m = await page.evaluate(() => {
    const disp = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'missing'; };
    return { notify: disp('.ms-row[data-act="notify"]'), today: disp('.ms-row[data-proxy="todayBtn"]'), near: disp('.ms-row[data-proxy="nearBtn"]'), flow: disp('.ms-row[data-act="flow"]') };
  });
  ok(`[${en}] G7a 手機:已排提醒/今日動態/附近車站三列 display:none`, m.notify === 'none' && m.today === 'none' && m.near === 'none', JSON.stringify(m));
  ok(`[${en}] G7b 手機:全日班次走勢仍在`, m.flow !== 'none' && m.flow !== 'missing', m.flow);
  await ctx.close();
  const d = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const dp = await d.newPage();
  await dp.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', 'zh-TW'); } catch (e) {} });
  await dp.goto(BASE + '?lang=zh-TW', { waitUntil: 'domcontentloaded' });
  await dp.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  const dm = await dp.evaluate(() => {
    document.getElementById('toolsFab') && document.getElementById('toolsFab').click();
    const disp = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'missing'; };
    return { today: disp('.ms-row[data-proxy="todayBtn"]') };
  });
  // 網站桌面沒有本地提醒(NOTIFY_LOCAL_ENABLED 假 ⇒ 該列被 setupLocalNotifications 移除),故只驗今日動態列存在
  ok(`[${en}] G7c 桌面:今日動態列存在且不是 display:none`, dm.today !== 'none' && dm.today !== 'missing', JSON.stringify(dm));
  await d.close();
}});

// G8a 快捷列閘門（spec §7-8）：網站沒有提醒/附近/小工具三列；App 替身有。牙：拿掉任一閘門 ⇒ 網站那半紅。
sections.push({ name: 'G8a 快捷列閘門', run: async (browser, en) => {
  let { ctx, page } = await boot(browser, {});
  await tapTab(page);
  let s = await snap(page);
  ok(`[${en}] G8a-web 網站只有「今日台鐵動態」`, JSON.stringify(s.links) === JSON.stringify(['today']), JSON.stringify(s.links));
  await ctx.close();
  ({ ctx, page } = await boot(browser, { app: true, notify: true, query: 'geomock=25.0478,121.5170', plugins: { RailMetroWait: {} } }));
  // 這個 boot 的 geomock 落在 Task 5 自動開門檻內,boot() 回傳前面板可能已經自動開好;
  // 裸 tapTab 會把它當「使用者要關」點掉(見 openQuery 定義處的說明),故改用 openQuery(page)。
  await openQuery(page);
  s = await snap(page);
  ok(`[${en}] G8a-app App 替身四列齊（notify/today/near/widget）`, JSON.stringify(s.links) === JSON.stringify(['notify', 'today', 'near', 'widget']) && !s.hidden, JSON.stringify({ links: s.links, hidden: s.hidden }));
  // 小工具列 ⇒ 說明中心開在 metrowidget 節（群組展開、節在可視區）；先量該列寬高 > 0——
  // 面板若仍是塌陷的隱藏態,子孫 rect 會全零,對零尺寸元素做合成點擊會測不出使用者其實點不到。
  const widgetRect = await page.evaluate(() => document.querySelector('#queryLinks .ql-row[data-act="widget"]').getBoundingClientRect());
  ok(`[${en}] G8a-widget 小工具列可見（寬高 > 0）`, widgetRect.width > 0 && widgetRect.height > 0, JSON.stringify({ w: widgetRect.width, h: widgetRect.height }));
  await page.evaluate(() => document.querySelector('#queryLinks .ql-row[data-act="widget"]').click());
  await page.waitForTimeout(500);
  const h = await page.evaluate(() => { const sec = document.querySelector('#helpBody .help-sec[data-sec="metrowidget"]'); const m = document.getElementById('helpModal'); const r = sec && sec.getBoundingClientRect(); return { open: !!m && !m.hidden, grpOpen: !!sec && sec.closest('.help-grp').classList.contains('open'), visible: !!r && r.top >= 0 && r.top < innerHeight }; });
  ok(`[${en}] G8a-help 小工具列 ⇒ openHelp('metrowidget') 展開並捲到該節`, h.open && h.grpOpen && h.visible, JSON.stringify(h));
  await ctx.close();
}});

// G3a 答案站退路鏈（spec §4.4）：定位 ⇒ 最近站；沒定位 ⇒ 最愛第一站；沒最愛 ⇒ 上次看過；都沒有 ⇒ none。
// 牙：拿掉任一層 ⇒ 對應那條紅。
// G3a-6/7 補的牙：G3a-2 是手寫好形狀的 storage 種子,測不到「開看板→saveLastBoard→寫入 localStorage」這段整合——
// 拿掉 openBoard 裡的 saveLastBoard(st) 呼叫,G3a-0～G3a-5 仍全綠;要靠真的呼叫 openBoard() 才咬得到。
sections.push({ name: 'G3a 答案站退路鏈', run: async (browser, en) => {
  let r = await boot(browser, {});
  const taipei = await stationOf(r.page, '臺北', 'tra_sched');
  ok(`[${en}] G3a-0 取得台鐵台北座標`, !!taipei, JSON.stringify(taipei));
  let a = await r.page.evaluate(() => queryAnswerStations());
  ok(`[${en}] G3a-1 網站無定位、無最愛、無上次 ⇒ src none`, a.src === 'none' && a.stations.length === 0, JSON.stringify(a));
  await r.ctx.close();
  r = await boot(browser, { storage: { 'trainmap-last-board-v1': JSON.stringify({ sys: 'tra_sched', name: '臺北' }) } });
  a = await r.page.evaluate(() => queryAnswerStations());
  ok(`[${en}] G3a-2 只有上次看過 ⇒ src last、站＝臺北`, a.src === 'last' && a.stations[0] && a.stations[0].st.name === '臺北', JSON.stringify(a));
  // 最愛蓋過上次:用頁面自己的 toggleFavStation 存一站(松山),再重載
  await r.page.evaluate(() => { const c = nearbyStationCandidates().find(x => x.st.name === '松山' && x.st.sys === 'tra_sched'); toggleFavStation(c.st); });
  await r.page.reload({ waitUntil: 'domcontentloaded' });
  await r.page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  a = await r.page.evaluate(() => queryAnswerStations());
  ok(`[${en}] G3a-3 有最愛 ⇒ src fav、站＝松山`, a.src === 'fav' && a.stations[0] && a.stations[0].st.name === '松山', JSON.stringify(a));
  await r.ctx.close();
  r = await boot(browser, { query: geomock(offsetLatLon(taipei, 100)), storage: { 'trainmap-last-board-v1': JSON.stringify({ sys: 'tra_sched', name: '松山' }) } });
  await r.page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
  a = await r.page.evaluate(() => queryAnswerStations());
  ok(`[${en}] G3a-4 有定位 ⇒ src geo、最近站＝臺北、距離約 100 m`, a.src === 'geo' && a.stations[0].st.name === '臺北' && a.m > 60 && a.m < 140, JSON.stringify({ src: a.src, first: a.stations[0] && a.stations[0].st.name, m: a.m }));
  ok(`[${en}] G3a-5 共構:台北另帶 200 m 內其他系統站(高鐵/捷運)`, a.stations.length >= 2 && new Set(a.stations.map(s => s.st.sys)).size === a.stations.length, JSON.stringify(a.stations.map(s => s.st.sys + '|' + s.st.name)));
  await r.ctx.close();
  // 往返:網頁空白開機(無 storage 種子、無定位),用真的 openBoard() 開台鐵臺北站,驗證 saveLastBoard 真的把它寫進
  // localStorage,且重載後 queryAnswerStations 的 last 退路真的讀得回來——這段整合 G3a-2 的手種 storage 測不到。
  r = await boot(browser, {});
  await r.page.evaluate(() => openBoard(nearbyStationCandidates().find(x => x.st.name === '臺北' && x.st.sys === 'tra_sched').st));
  const saved = await r.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('trainmap-last-board-v1')); } catch (e) { return null; } });
  ok(`[${en}] G3a-6 openBoard 真的寫入 trainmap-last-board-v1（sys＝tra_sched、站＝臺北）`, !!saved && saved.sys === 'tra_sched' && saved.name === '臺北', JSON.stringify(saved));
  await r.page.reload({ waitUntil: 'domcontentloaded' });
  await r.page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  a = await r.page.evaluate(() => queryAnswerStations());
  ok(`[${en}] G3a-7 重載後退路吃得到 openBoard 存的上次看過站 ⇒ src last、站＝臺北`, a.src === 'last' && a.stations[0] && a.stations[0].st.name === '臺北' && a.stations[0].st.sys === 'tra_sched', JSON.stringify(a));
  await r.ctx.close();
}});

// 開查詢並等答案區有內容。Task 5 之後,geomock 定位落在自動開門檻內時 boot() 回傳前就已經自動開好了
// (queryMaybeAutoOpen 掛在 applyBootGeo 尾端,boot() 的 500ms 收尾等待遠比它落地所需時間長)——
// 這裡先看現況再決定要不要點,tapTab 是真正的「切換」(給 G6 驗開關記憶用),不能在這裡盲點一次,
// 否則會把自動開好的面板點成關掉(#queryAnswer 自己的 hidden 屬性不隨祖先 [hidden] 變,
// 底下 waitForFunction 仍會在舊內容上假通過)。
async function openQuery(page) {
  const already = await page.evaluate(() => !document.getElementById('searchPanel').hidden);
  if (!already) await tapTab(page);
  await page.waitForFunction(() => { const w = document.getElementById('queryAnswer'); return w && !w.hidden && w.querySelector('.qa-stn'); }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}
// 看板某站的「每組第一列」文字:.bgrp/.grp 標題後第一個 .row
const firstRowsExpr = `(sel) => { const out = []; let seen = null; for (const n of document.querySelectorAll(sel + ' .bgrp, ' + sel + ' .grp, ' + sel + ' .row')) { if (n.classList.contains('row')) { if (seen !== null) { out.push(n.textContent.trim()); seen = null; } } else seen = n.textContent.trim(); } return out; }`;

// G3b 同源（spec §7-1）：同站同時刻(暫停播放),答案區每列文字＝看板同組第一列。sched(臺北)＋freq 班表路徑(東門,deco)。
// 牙：答案區改走另一條取數(或 compact 少切一列) ⇒ 紅。官方/Core 兩條 freq 路徑離線拿不到資料,由 G3c 的靜態斷言與線上模式補。
sections.push({ name: 'G3b 答案同源', run: async (browser, en) => {
  const r0 = await boot(browser, {});
  const taipei = await stationOf(r0.page, '臺北', 'tra_sched'); const dongmen = await stationOf(r0.page, '東門', 'deco');
  await r0.ctx.close();
  for (const [st, label] of [[taipei, 'sched 臺北'], [dongmen, 'freq 東門(班表路徑)']]) {
    if (!st) { ok(`[${en}] G3b-${label} 座標`, false, '候選集找不到'); continue; }
    const { ctx, page } = await boot(browser, { query: geomock(offsetLatLon(st, 50)) });
    await page.evaluate(() => { if (state.playing) togglePlay(); }); // 凍結 simSec,兩邊算同一刻
    await page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
    await openQuery(page);
    await page.evaluate(() => renderQueryAnswer());
    const ans = await page.evaluate(([f, n, s]) => { const blk = [...document.querySelectorAll('#queryAnswer .qa-stn')].find(b => b.dataset.name === n && b.dataset.sys === s); return blk ? eval('(' + f + ')')('#queryAnswer .qa-stn[data-name="' + n + '"][data-sys="' + s + '"] .qa-rows') : null; }, [firstRowsExpr, st.name, st.sys]);
    await page.evaluate(([n, s]) => { const c = nearbyStationCandidates().find(x => x.st.name === n && x.st.sys === s); openBoard(c.st); }, [st.name, st.sys]);
    await page.waitForTimeout(300);
    const board = await page.evaluate(f => eval('(' + f + ')')('#board'), firstRowsExpr);
    ok(`[${en}] G3b ${label}:答案區 ${ans ? ans.length : 'null'} 列＝看板每組第一列`, !!ans && ans.length > 0 && JSON.stringify(ans) === JSON.stringify(board.slice(0, ans.length)) && ans.length === board.length, JSON.stringify({ ans, board }).slice(0, 400));
    await ctx.close();
  }
}});
// G3c 三條 freq 路徑都吃到 compact 的結構斷言(離線替身):三個渲染器各有一個 compact 早退。
sections.push({ name: 'G3c compact 三路徑', run: async () => {
  const src = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const n = (src.match(/if \(compact\) return body;/g) || []).length;
  ok(`G3c 三個看板渲染器各一個 compact 早退（實際 ${n}）`, n === 3);
}});

// G4 上限（spec §7-2）：東門(多方向)可見 ≤4 列且可捲;牙:拿掉上限 ⇒ 紅。
sections.push({ name: 'G4 四列上限', run: async (browser, en) => {
  const r0 = await boot(browser, {}); const dongmen = await stationOf(r0.page, '東門', 'deco'); await r0.ctx.close();
  const { ctx, page } = await boot(browser, { query: geomock(offsetLatLon(dongmen, 50)) });
  await page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
  await openQuery(page);
  const m = await page.evaluate(() => { const box = document.querySelector('#queryAnswer .qa-stn .qa-rows'); const rows = [...box.querySelectorAll('.row')]; const br = box.getBoundingClientRect(); const visible = rows.filter(r => { const q = r.getBoundingClientRect(); return q.top >= br.top - 1 && q.bottom <= br.bottom + 1; }).length; return { total: rows.length, visible, scrollable: box.scrollHeight > box.clientHeight + 1 }; });
  ok(`[${en}] G4 東門:總列 ${m.total}、可見 ${m.visible} ≤ 4、多的可捲`, m.total > 4 ? (m.visible <= 4 && m.scrollable) : m.visible === m.total, JSON.stringify(m));
  // G4b(fix round 1、finding #3):重畫不能洗掉區內捲動位置——捲到底之後逼一次重畫(內容其實沒變,
  // 比照 G12c 的手法:_html=null 再 renderQueryAnswer()),捲動位置要原地不動。牙:拿掉 save/restore ⇒
  // 紅(新插入的 .qa-rows 天生 scrollTop=0)。
  const s1 = await page.evaluate(() => {
    const box = document.querySelector('#queryAnswer .qa-stn .qa-rows');
    box.scrollTop = box.scrollHeight;
    const before = box.scrollTop;
    document.getElementById('queryAnswer')._html = null;
    renderQueryAnswer();
    const after = document.querySelector('#queryAnswer .qa-stn .qa-rows').scrollTop;
    return { before, after };
  });
  ok(`[${en}] G4b 重畫不洗掉區內捲動(${s1.before} → ${s1.after})`, s1.before > 0 && s1.after === s1.before, JSON.stringify(s1));
  await ctx.close();
}});

// G8b 公車列只在 isSupported 站出現(spec §7-8)。正站由頁面自己的閘門挑(牙:拿掉閘門 ⇒ 紅)。
// 訂正(task-4 決議):brief 原稿另挑一個「不支援」的台鐵站做負案例,但 busTransferStationId 對
// 所有 tra_sched 站都有 fallback id(BUS_TRANSFER_APP_SYSTEMS 含 tra_sched),而 isSupported 只驗
// id 格式(/^[A-Z]+:[A-Za-z0-9_]+$/)——兩者疊起來讓任何台鐵候選都判「支援」,結構上找不到負站,
// `no = cs.find(c => !sup(c))` 恆為 undefined。改用頁內存根:正站驗完之後暫時把 isSupported 換成
// 恆假,逼重畫,驗 .qa-bus 消失,再還原——牙一樣咬得住 queryStationBlockHtml 不再問 isSupported 的情況。
sections.push({ name: 'G8b 公車列', run: async (browser, en) => {
  const r0 = await boot(browser, {});
  const pick = await r0.page.evaluate(() => { const cs = nearbyStationCandidates().filter(c => c.st.sys === 'tra_sched'); const sup = c => !!(window.BusTransferUI && window.BusTransferUI.isSupported(busTransferStationId(c.st))); const yes = cs.find(sup); return { yes: yes && { name: yes.st.name, sys: yes.st.sys, lat: yes.st.lat, lon: yes.st.lon } }; });
  await r0.ctx.close();
  const st = pick.yes;
  if (!st) { ok(`[${en}] G8b 找得到支援公車的台鐵站`, false); }
  else {
    const { ctx, page } = await boot(browser, { query: geomock(offsetLatLon(st, 30)) });
    await page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
    await openQuery(page);
    const has = await page.evaluate(([n, s]) => !!document.querySelector('#queryAnswer .qa-stn[data-name="' + n + '"][data-sys="' + s + '"] .qa-bus'), [st.name, st.sys]);
    ok(`[${en}] G8b ${st.name}(支援) 公車列存在`, has === true);
    // 瀏覽態面板矮(兩段高的短版),公車列常落在摺線以下,真實使用者也要先捲——tap 前先把它捲進可視區(#searchPanel 本身 overflow-y:auto)。
    const b = await page.evaluate(() => { const btn = document.querySelector('#queryAnswer .qa-bus'); btn.scrollIntoView({ block: 'center' }); const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(600);
    const o = await page.evaluate(() => ({ boardOpen: !document.getElementById('board').hidden, slot: !!document.querySelector('#board [data-bus-transfer-slot]'), queryClosed: document.getElementById('searchPanel').hidden }));
    ok(`[${en}] G8b 點公車列 ⇒ 看板開、公車槽在、查詢收起`, o.boardOpen && o.slot && o.queryClosed, JSON.stringify(o));
    // 負站(頁內存根):關掉 isSupported、逼重畫、驗 .qa-bus 消失,再還原。
    await openQuery(page);
    const stubbed = await page.evaluate(([n, s]) => {
      window.__isSup = window.BusTransferUI.isSupported;
      window.BusTransferUI.isSupported = () => false;
      document.getElementById('queryAnswer')._html = null;
      renderQueryAnswer();
      return !document.querySelector('#queryAnswer .qa-stn[data-name="' + n + '"][data-sys="' + s + '"] .qa-bus');
    }, [st.name, st.sys]);
    ok(`[${en}] G8b 存根關閉 isSupported ⇒ 公車列消失`, stubbed === true);
    await page.evaluate(() => { window.BusTransferUI.isSupported = window.__isSup; delete window.__isSup; document.getElementById('queryAnswer')._html = null; renderQueryAnswer(); });
    await ctx.close();
  }
}});

// G12 重畫不吃點擊(spec §7-12):開著 6 秒,DOM 寫入次數 ≤ 內容變化次數;之後真觸控站名列必開看板。牙:每幀重寫 ⇒ 紅。
sections.push({ name: 'G12 重畫不吃點擊', run: async (browser, en) => {
  const r0 = await boot(browser, {}); const taipei = await stationOf(r0.page, '臺北', 'tra_sched'); await r0.ctx.close();
  const { ctx, page } = await boot(browser, { query: geomock(offsetLatLon(taipei, 50)) });
  await page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
  await openQuery(page);
  await page.evaluate(() => { window.__qaWrites = 0; window.__qaHtml = new Set(); const w = document.getElementById('queryAnswer'); new MutationObserver(() => { window.__qaWrites++; window.__qaHtml.add(w.innerHTML); }).observe(w, { childList: true }); });
  await page.waitForTimeout(6000);
  const m = await page.evaluate(() => ({ writes: window.__qaWrites, distinct: window.__qaHtml.size }));
  ok(`[${en}] G12a 6 秒內 DOM 寫入 ${m.writes} 次 ≤ 內容變化 ${m.distinct} 種`, m.writes <= m.distinct, JSON.stringify(m));
  // G12a2:天然 6 秒節拍裡倒數文字可能剛好每秒都在變(此站此刻零重複內容 ⇒ G12a 測不到牙),
  // 改用凍結模擬時間後連續手動呼叫三次——內容真的沒變,DOM 應該 0 次寫入。牙:拿掉去重 ⇒ 紅。
  const m2 = await page.evaluate(() => {
    if (state.playing) togglePlay();
    // togglePlay() 之前排進去的那一格 rAF 可能還會多跑一拍,讓 simSec 在暫停生效前多走一點點——
    // 先落地渲染一次當「穩定基準」,之後才開始計次,免得那一拍的合理寫入被誤算成牙咬到的寫入。
    renderQueryAnswer();
    const w = document.getElementById('queryAnswer');
    const mo = new MutationObserver(() => {});
    mo.observe(w, { childList: true });
    renderQueryAnswer(); renderQueryAnswer(); renderQueryAnswer();
    // disconnect() 會把「已排進佇列但還沒送達 callback」的紀錄直接丟掉——三次呼叫都在同一段同步碼裡,
    // callback 要等下一個 microtask 才會被叫到,所以必須用 takeRecords() 同步取出佇列,不能靠 callback 計數。
    const records = mo.takeRecords();
    mo.disconnect();
    return { writes: records.length };
  });
  ok(`[${en}] G12a2 內容不變時連續呼叫 renderQueryAnswer 三次 ⇒ DOM 寫入 0 次`, m2.writes === 0, JSON.stringify(m2));
  const h = await page.evaluate(() => { const r = document.querySelector('#queryAnswer .qa-stn .qa-head').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(h.x, h.y); await page.waitForTimeout(500);
  ok(`[${en}] G12b 真觸控站名列 ⇒ 看板開`, await page.evaluate(() => !document.getElementById('board').hidden && !!state.boardStation));
  await ctx.close();
}});

// G12 續(fix round 1,審查者的兩個 Important):
// G12d(finding #1、死的預先渲染):先正常開一次建立內容與 _queryRenderedAt,暫停播放(simSec 凍結)後
//   關閉、換一個很遠的定位(模擬「看了別的看板、或 geo 移動」)、再重開——由於 simSec 沒變,主迴圈節拍
//   (15142 行)的觸發條件 |simSec − _queryRenderedAt| ≥ 1 恆為假,不會補跑,唯一能換出新內容的只剩
//   openSearchPanel 內那次 renderQueryAnswer()。
//   （原稿曾直接測「開起來那一刻有沒有 .qa-stn」,但 _queryRenderedAt 初始是 undefined,第一次開面板時
//   |simSec − 0| 幾乎必然 ≥ 1,主迴圈節拍下一幀就會補渲染,測不出這顆牙——牙只咬得住「重開後內容該換
//   但沒換」這個真正會影響使用者的情境,已改用這個情境。）
//   牙:renderQueryAnswer() 排回 hidden=false 之前 ⇒ 面板還沒露出,它自己的守門(panel.hidden)直接跳出,
//   重開後答案區停留在關閉前的舊站,不會換成新定位 ⇒ 紅。
// G12c(finding #2、按下到放開之間被重畫):click 目標會落到容器(wrap)上、.closest('.qa-stn') 落空,
//   靠 pointerdown 先記行、click 撈不到列時用記的補(照看板 el.onpointerdown/onclick,index.html≈28124
//   同一套)。牙:拿掉 pointerdown 補救 ⇒ 紅(鬆手時開不了看板,因為 click 目標是容器)。
//   實測記錄(brief 建議的 page.mouse 手法在本機兩種真實輸入管道都測不出「同一條牙」):
//   (a) page.mouse.down()＋逼重畫＋page.mouse.up():Chromium 對「mousedown 目標已從文件移除」乾脆不合成
//       click(pointerup/mouseup 有觸發,click 完全不發生)——比「目標變容器」更嚴重,onclick 掛什麼補救都
//       接不到,因為 handler 根本沒被呼叫。
//   (b) 改用 CDP Input.dispatchTouchEvent 真觸控:內容不變的重畫下 Chromium 會在放開當下對(x,y)重新
//       hit-test,直接命中「新長出來的」同位置 .qa-head,牙咬不到(直接路徑本來就會成功);把內容重畫成
//       結構整個坍縮的空狀態,click 改落到 #queryAnswer 以外的兄弟元素(class="search"),wrap.onclick 連
//       跑都不會跑,補救一樣派不上用場。
//   兩者都無法在本機穩定重現「click 落在容器本身、但仍在 wrap 子樹內」這個看板註解描述的確切情境
//   (研判是引擎特定的重新導向規則,例如行動 WebKit 的觸控→click 合成,在此驗收環境重現不了)。
//   改用 dispatchEvent 直接構造這個條件:對 .qa-head 派發真的 pointerdown(走 wrap.onpointerdown 那條
//   程式碼,不是直接呼叫函式)確認記下 qi,逼一次重畫,再直接對 wrap 本身派發 click(e.target===wrap,
//   .closest('.qa-stn') 結構上必為 null——這就是註解描述的「目標變容器」的精確狀態),驗證 onclick 讀
//   得到記下的資料並開對看板。這樣測的是「程式碼面對這個瀏覽器狀態時的反應」,不糾結能不能用某個引擎的
//   真實輸入去複現這個狀態本身的時序。
sections.push({ name: 'G12 續', run: async (browser, en) => {
  const r0 = await boot(browser, {}); const taipei = await stationOf(r0.page, '臺北', 'tra_sched'); await r0.ctx.close();

  {
    const { ctx, page } = await boot(browser, { query: geomock(offsetLatLon(taipei, 50)) });
    await page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
    await openQuery(page); // 先正常開一次,建立真實內容
    const before = await page.evaluate(([n, s]) => !!document.querySelector('#queryAnswer .qa-stn[data-name="' + n + '"][data-sys="' + s + '"]'), [taipei.name, taipei.sys]);
    const songshan = await stationOf(page, '松山', 'tra_sched');
    // 凍結+落地渲染一次當穩定基準(比照 G12a2 的做法,避開 togglePlay 生效前殘餘一拍造成的 flaky)。
    await page.evaluate(() => { if (state.playing) togglePlay(); renderQueryAnswer(); });
    await page.evaluate(() => closeSearchPanel());
    // 模擬「看了別的看板、或 geo 移動」:換一個遠站當定位,答案理應變成新站。
    await page.evaluate((s) => { state.geoLoc = { lat: s.lat, lon: s.lon, acc: 10 }; }, songshan);
    await tapTab(page); // 真正的 tab 點擊重開(面板此時已關,會走 openSearchPanel)
    const after = await page.evaluate(([n, s]) => ({
      hasOld: !!document.querySelector('#queryAnswer .qa-stn[data-name="' + n + '"][data-sys="' + s + '"]'),
      hasNew: !!document.querySelector('#queryAnswer .qa-stn[data-name="松山"][data-sys="tra_sched"]'),
    }), [taipei.name, taipei.sys]);
    ok(`[${en}] G12d 暫停播放中重開查詢 ⇒ 立刻換成新定位的內容(不停留在關閉前的舊站)`, before === true && after.hasNew === true && after.hasOld === false, JSON.stringify({ before, after }));
    await ctx.close();
  }

  {
    const { ctx, page } = await boot(browser, { query: geomock(offsetLatLon(taipei, 50)) });
    await page.waitForFunction(() => !!state.geoLoc, null, { timeout: 15000 });
    await openQuery(page);
    const r = await page.evaluate(([n, s]) => {
      const blk = document.querySelector('#queryAnswer .qa-stn[data-name="' + n + '"][data-sys="' + s + '"]');
      const head = blk.querySelector('.qa-head');
      const wrap = document.getElementById('queryAnswer');
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); // 真事件,走 wrap.onpointerdown
      const downAfterPress = wrap._down;
      wrap._html = null; renderQueryAnswer(); // 按下到放開之間逼一次重畫(內容其實沒變)
      wrap.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // e.target===wrap,.closest('.qa-stn') 結構上必為 null
      return { downAfterPress, downAfterClick: wrap._down };
    }, [taipei.name, taipei.sys]);
    await page.waitForTimeout(200);
    const o = await page.evaluate(() => ({ boardOpen: !document.getElementById('board').hidden, name: state.boardStation && state.boardStation.name, sys: state.boardStation && state.boardStation.sys }));
    ok(`[${en}] G12c 按下時記的 qi＝0、click 落在容器仍能靠記下的資料開對看板`, !!r.downAfterPress && r.downAfterPress.qi === '0' && r.downAfterClick === null && o.boardOpen === true && o.name === taipei.name && o.sys === taipei.sys, JSON.stringify({ r, o }));
    await ctx.close();
  }
}});

// G5 自動開正反對照(spec §7-5)。牙:每項各去掉一個條件 ⇒ 對應那條紅。
sections.push({ name: 'G5 自動開', run: async (browser, en) => {
  const r0 = await boot(browser, {}); const taipei = await stationOf(r0.page, '臺北', 'tra_sched'); const songshan = await stationOf(r0.page, '松山', 'tra_sched'); await r0.ctx.close();
  const cases = [
    ['100 m 內 ⇒ 開', { query: geomock(offsetLatLon(taipei, 100)) }, true],
    ['600 m 外 ⇒ 不開', { query: geomock(offsetLatLon(taipei, 600)) }, false],
    ['精度 900 m ⇒ 不開', { query: geomock(offsetLatLon(taipei, 100), 900) }, false],
    ['教學卡開著 ⇒ 不開', { query: geomock(offsetLatLon(taipei, 100)), howto: true }, false],
    ['帶 ?train= ⇒ 不開', { query: geomock(offsetLatLon(taipei, 100)) + '&train=152' }, false],
    ['同站曾被關掉 ⇒ 不開', { query: geomock(offsetLatLon(taipei, 100)), storage: { 'trainmap-query-dismissed-v1': 'tra_sched|臺北' } }, false],
    ['換站(松山)曾關的是臺北 ⇒ 開', { query: geomock(offsetLatLon(songshan, 100)), storage: { 'trainmap-query-dismissed-v1': 'tra_sched|臺北' } }, true],
  ];
  for (const [name, opts, expect] of cases) {
    const { ctx, page } = await boot(browser, opts);
    // 等 applyBootGeo 落地(_geoLanded 是它最後一行);?train= 那條 applyBootGeo 永不會跑(startBootGeo 自己的深連結守門),
    // 8 秒逾時後 catch 吞掉,讓否定判準照樣往下走——不用固定 sleep(判斷力 rubric 第八節)。
    await page.waitForFunction(() => state._geoLanded === true, null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r()))); // 讓 queryMaybeAutoOpen 觸發的 DOM 動作完全落地
    const s = await snap(page);
    ok(`[${en}] G5 ${name}`, !s.hidden === expect, JSON.stringify({ hidden: s.hidden, searchOpen: s.searchOpen }));
    if (expect) ok(`[${en}] G5 ${name}:自動開是瀏覽態`, !s.searchOpen);
    // ?train= 那條的「不開」不能只看 hidden——面板關也可能是因為定位根本沒跑,不是深連結真的擋下了自動開;
    // 直接量 _geoLanded,讓斷言說出它真正證明的事(它結構上永遠不會變 true,見 startBootGeo 的深連結守門)。
    if (/[?&]train=/.test(opts.query || '')) {
      const landed = await page.evaluate(() => state._geoLanded === true);
      ok(`[${en}] G5 ${name}:applyBootGeo 真的沒跑(深連結擋下,不是巧合)`, landed === false, String(landed));
    }
    await ctx.close();
  }
}});

// G6 記憶鍵(spec §7-6):使用者開→重載後開;使用者關→重載後關;自動開不寫鍵(重載後關)。牙:自動開也寫鍵 ⇒ G6c 紅。
sections.push({ name: 'G6 開關記憶', run: async (browser, en) => {
  let { ctx, page } = await boot(browser, {});
  await tapTab(page);
  let k = await page.evaluate(() => localStorage.getItem('trainmap-query-open'));
  ok(`[${en}] G6a 使用者點 tab 開 ⇒ 鍵=1`, k === '1', String(k));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 }); await page.waitForTimeout(500);
  let s = await snap(page);
  ok(`[${en}] G6a 重載後仍開(瀏覽態)`, !s.hidden && !s.searchOpen, JSON.stringify(s));
  await tapTab(page); // 再點=關
  k = await page.evaluate(() => localStorage.getItem('trainmap-query-open'));
  ok(`[${en}] G6b 使用者關 ⇒ 鍵=0`, k === '0', String(k));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 }); await page.waitForTimeout(500);
  s = await snap(page);
  ok(`[${en}] G6b 重載後關`, s.hidden);
  await ctx.close();
  const r0 = await boot(browser, {}); const taipei = await stationOf(r0.page, '臺北', 'tra_sched'); await r0.ctx.close();
  ({ ctx, page } = await boot(browser, { query: geomock(offsetLatLon(taipei, 100)) }));
  await page.waitForFunction(() => state._geoLanded === true, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  s = await snap(page); k = await page.evaluate(() => localStorage.getItem('trainmap-query-open'));
  ok(`[${en}] G6c 自動開 ⇒ 開著但不寫鍵`, !s.hidden && k === null, JSON.stringify({ hidden: s.hidden, k }));
  await page.evaluate(() => document.getElementById('searchPanelClose').click()); await page.waitForTimeout(200);
  const d = await page.evaluate(() => localStorage.getItem('trainmap-query-dismissed-v1'));
  ok(`[${en}] G6d 自動開後 × ⇒ 記下站鍵 tra_sched|臺北`, d === 'tra_sched|臺北', String(d));
  await ctx.close();
}});

// G9 桌面零改動（spec §7-9）：面板永不開、搜尋框留在 header、tab bar 不顯示。牙：手機 CSS 漏進桌面 ⇒ 紅。
sections.push({ name: 'G9 桌面不變量', run: async (browser, en) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', 'zh-TW'); } catch (e) {} });
  await page.goto(BASE + '?lang=zh-TW', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  const d = await page.evaluate(() => ({
    panelHidden: document.getElementById('searchPanel').hidden,
    searchRowExists: !!document.getElementById('searchRow'),
    searchInHeader: !document.getElementById('searchSlot').contains(document.getElementById('searchRow')),
    tabbar: getComputedStyle(document.getElementById('tabbar')).display,
  }));
  // 牙：searchInHeader 在 #searchRow 不存在時也會是 true(vacuous pass);多釘 searchRowExists 才堵得住
  ok(`[${en}] G9 桌面：面板關、搜尋框在 header、tab bar 不顯示`, d.panelHidden && d.searchRowExists && d.searchInHeader && d.tabbar === 'none', JSON.stringify(d));
  // G9b 牙：MOBILE_MQ 誤命中桌面尺寸 ⇒ focus 觸發 setSearchTyping(true),打字態洩漏到桌面
  await page.focus('#trainSearch');
  await page.waitForTimeout(200);
  const d2 = await page.evaluate(() => ({
    searchOpen: document.body.classList.contains('search-open'),
    panelHidden: document.getElementById('searchPanel').hidden,
  }));
  ok(`[${en}] G9b 桌面聚焦搜尋框不洩漏打字態`, !d2.searchOpen && d2.panelHidden === true, JSON.stringify(d2));
  await ctx.close();
  // G9c 桌面：帶開關記憶鍵＋靠近車站定位開機，面板仍關（spec §6 兩道 MOBILE_MQ 守門缺一不可）。
  // 牙：12663（自動開）或 32967（開機還原記憶）任一道守門被拿掉 ⇒ 這條紅。刻意不用 boot()——
  // 它固定 hasTouch/isMobile,會讓 MOBILE_MQ 的 (any-pointer:coarse) and (max-width:1400px) 那支意外命中,
  // 蓋掉桌面本該測到的東西;沿用本節既有的純滑鼠 context 寫法。
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', 'zh-TW'); localStorage.setItem('trainmap-query-open', '1'); } catch (e) {} });
  await page2.goto(BASE + '?lang=zh-TW&geomock=25.0478,121.5170', { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  await page2.waitForFunction(() => state._geoLanded === true, null, { timeout: 8000 }).catch(() => {});
  await page2.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  const hidden2 = await page2.evaluate(() => document.getElementById('searchPanel').hidden);
  ok(`[${en}] G9c 桌面：帶記憶鍵(trainmap-query-open=1)＋靠近車站定位開機，面板仍關`, hidden2 === true, String(hidden2));
  await ctx2.close();
}});

// G16 說明中心(task-6)：「查詢」節存在、緊接搜尋節之後；搜尋節提到底部「查詢」；沒有死掉的
// 「試一次」；HELP_TRY.query 的兩句吐司 en/ja 都在；helpRun('query') 開瀏覽態面板且面板已開時
// 再試一次不會被當 toggle 關掉；helpRun('search') 在面板關著時會先開面板才進打字態；桌面
// helpRun('query') 不開面板。
// 牙：HELP_TRY.query.run 改回 tabSearch.click() ⇒ G16e2 紅；HELP_TRY.search.run 拿掉
// openSearchPanel 那行 ⇒ G16f 紅；content-translations.js 任一句吐司缺一種語言 ⇒ G16d 紅。
sections.push({ name: 'G16 說明中心', run: async (browser, en) => {
  const { ctx, page } = await boot(browser, {});
  await page.evaluate(() => openHelp());
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => {
    const q = document.querySelector('#helpBody .help-sec[data-sec="query"]');
    const s = document.querySelector('#helpBody .help-sec[data-sec="search"]');
    const a = helpAudit();
    return { query: !!q, searchText: s ? s.textContent : '', dead: a.dead, secs: a.secs };
  });
  ok(`[${en}] G16a 「查詢」節存在且緊接搜尋節之後`, h.query && h.secs.indexOf('query') === h.secs.indexOf('search') + 1, JSON.stringify(h.secs));
  ok(`[${en}] G16b 搜尋節提到底部「查詢」`, /底部「查詢」/.test(h.searchText));
  ok(`[${en}] G16c 沒有死掉的「試一次」`, h.dead.length === 0, JSON.stringify(h.dead));

  // check_i18n 的說明中心掃描只展開到 HELP_TRY 之前(見 check_i18n.mjs evaluateConstBlock)，
  // HELP_TRY.query 的 run() 內文字面呼叫的 t('...') 不在它的說明中心分母裡，這裡自己補一條牙。
  const i18nOk = await page.evaluate(() => {
    const keys = ['這就是查詢面板——上面搜尋、中間下一班、下面入口', '桌面版沒有查詢面板，搜尋框在右上角'];
    const m = window.RAIL_I18N_MESSAGES;
    return !!m && keys.every(k => typeof m.en?.[k] === 'string' && !!m.en[k] && typeof m.ja?.[k] === 'string' && !!m.ja[k]);
  });
  ok(`[${en}] G16d 兩句「試一次」吐司的 en/ja 鍵都在`, i18nOk === true);

  // 手機:openHelp('query') 展開該節後按試一次 ⇒ 說明卡關、查詢面板開(瀏覽態,不是打字態)
  await page.evaluate(() => openHelp('query'));
  await page.waitForTimeout(300);
  await page.evaluate(() => helpRun('query'));
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => ({
    panelHidden: document.getElementById('searchPanel').hidden,
    searchOpen: document.body.classList.contains('search-open'),
    helpHidden: document.getElementById('helpModal').hidden,
  }));
  ok(`[${en}] G16e helpRun('query') ⇒ 查詢面板開(瀏覽態)、說明卡已關`, !s1.panelHidden && !s1.searchOpen && s1.helpHidden, JSON.stringify(s1));
  // 面板已開時再試一次(牙:run 改回 tabSearch.click() 會把已開的面板當 toggle 點成關掉)
  await page.evaluate(() => helpRun('query'));
  await page.waitForTimeout(300);
  const panelHidden2 = await page.evaluate(() => document.getElementById('searchPanel').hidden);
  ok(`[${en}] G16e2 面板已開時再試一次「查詢」⇒ 仍開著(不是被當 toggle 關掉)`, panelHidden2 === false, String(panelHidden2));

  // 手機:面板關著時試一次「搜尋」⇒ 先開面板才 focus(牙:拿掉 openSearchPanel 那行,面板關著
  // 時 #trainSearch 不可 focus,原本的 i.focus() 是空操作,進不了打字態)
  await page.evaluate(() => closeSearchPanel({ user: true }));
  await page.waitForTimeout(200);
  await page.evaluate(() => helpRun('search'));
  await page.waitForTimeout(300);
  const s3 = await page.evaluate(() => ({
    panelHidden: document.getElementById('searchPanel').hidden,
    searchOpen: document.body.classList.contains('search-open'),
    val: document.getElementById('trainSearch').value,
  }));
  ok(`[${en}] G16f 面板關著時試一次「搜尋」⇒ 開面板並進打字態、已帶字`, !s3.panelHidden && s3.searchOpen && !!s3.val, JSON.stringify(s3));
  await ctx.close();

  // 桌面(比照 G9 的 context 慣例:不帶 hasTouch/isMobile):helpRun('query') 時 tabSearch 零尺寸
  // (.tabbar 桌面 display:none) ⇒ 不開面板,只吐司指路。
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const dpage = await dctx.newPage();
  await dpage.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', 'zh-TW'); } catch (e) {} });
  await dpage.goto(BASE + '?lang=zh-TW', { waitUntil: 'domcontentloaded' });
  await dpage.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  await dpage.evaluate(() => helpRun('query'));
  await dpage.waitForTimeout(300);
  const dHidden = await dpage.evaluate(() => document.getElementById('searchPanel').hidden);
  ok(`[${en}] G16g 桌面 helpRun('query') ⇒ 查詢面板仍關(hidden)`, dHidden === true, String(dHidden));
  await dctx.close();
}});

// ── 執行 ──
for (const engineName of ENGINES) {
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  for (const s of sections) {
    try { await s.run(browser, engineName); }
    catch (e) { ok(`[${engineName}] ${s.name} 執行例外`, false, String(e).slice(0, 200)); }
  }
  await browser.close();
}
server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) { console.log('失敗：\n' + failed.map(f => ' - ' + f.name + (f.detail ? '（' + f.detail + '）' : '')).join('\n')); process.exit(1); }
