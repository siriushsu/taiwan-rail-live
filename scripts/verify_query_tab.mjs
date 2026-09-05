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
  await tapTab(page);
  s = await snap(page);
  ok(`[${en}] G8a-app App 替身四列齊（notify/today/near/widget）`, JSON.stringify(s.links) === JSON.stringify(['notify', 'today', 'near', 'widget']), JSON.stringify(s.links));
  // 小工具列 ⇒ 說明中心開在 metrowidget 節（群組展開、節在可視區）
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
