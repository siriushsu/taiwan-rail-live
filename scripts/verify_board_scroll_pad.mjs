#!/usr/bin/env node
// .board 家族面板的 sticky 固定段讓位守門(2026-09-25,v0925n)。
//
// 瀏覽器自己把內容捲進來時(Tab／Shift+Tab 聚焦、scrollIntoView)不認 sticky 標題。index.html 的
// syncBoardScrollPad 量整疊固定段(h3;橫式合併卡另有站名牌與分頁列)的底緣寫進 --board-scroll-pad,
// CSS 拿它給內容當 scroll-margin-top;WebKit 聚焦文字欄位不看 scroll-margin,由 boardRevealField 補捲。
// 只有真瀏覽器量得到,兩個引擎各跑一輪:
//   W 鍵盤往回走(Shift+Tab;WebKit 要 Option+Shift+Tab 才走得到按鈕):焦點中心落在固定段上的拍數＝0。
//     360 直式標準／特大字級(特大另走直式合併卡:分頁列在直式是一般內容,要讓位)、844×390 橫式合併卡;
//     走過的內容拍數要夠多,否則是沒走到的假綠。
//   J 面板捲到下面時把焦點放進標題裡的 ×(＝選單關掉時 opener.focus()、從面板外 Tab 進來):捲動量 ≤ 8px。
//     容器 scroll-padding-top 那種寫法會跳 128–130px(v0925k 的護照就是那樣上線的)。
//   F 文字欄位(軌道面板 #rdSearch)被蓋住時聚焦:下一拍之後不再被蓋,半秒後也沒被捲回去。
//   P 讓位值＝捲到中段時實際卡住的固定段底緣(差 ≤ 1px):站名牌出現／消失之後(syncBoardHeadVar 尾端那一刀)、
//     護照重繪換掉 h3 再換字級之後(MutationObserver 重掛)。換字級走設定面板的真入口 state._setFontScale。
//   N 正向對照,要紅才算數:拿掉讓位 ⇒ W 紅;分頁列的排除規則移出側欄 media 段 ⇒ 直式合併卡 W 紅;
//     改回容器 scroll-padding ⇒ J 紅(兩個引擎都做——WebKit 的聚焦捲動是非同步的,要證明等得夠久);
//     拿掉 boardRevealField ⇒ F 紅(只做 WebKit:Chromium 聚焦文字欄位本來就看 scroll-margin);
//     拿掉那一刀／拿掉重掛 ⇒ P 紅(只做 Chromium)。
//   三張清單面板(今日台鐵動態、公車站牌、行程分享;v0926e 起列可聚焦,假資料由本機伺服器的 /api 供應):
//     W 每一列都可聚焦、往回走過每一列而且零拍被蓋(360 標準／特大、844×390 三種版面都走);
//     E 從標題的 × 用鍵盤走進第一列,Enter／空白鍵做的事跟點一下一樣(今日動態展開逐站、焦點留在那一列,再按一次收合;
//     行程分享拿那一站分享),空白鍵不順便切播放／暫停,按住空白鍵連發也只分享一次、播放一次都不切;
//     C 滑鼠點公車列再按鍵,焦點不留在列上、不亮框(點列跟改版前一樣;在 1280 桌面量,Chromium 手機模擬點一下不給焦點、量不到);
//     R 公車站牌重抓後焦點留在同一列,焦點列被捲出畫面時也不把清單捲回去。
//     N:拿掉兩張的鍵盤接線 ⇒ E 紅;重畫後不放回焦點 ⇒ E、R 紅;放回焦點不帶 preventScroll ⇒ R 紅;空白鍵改回按下就觸發 ⇒ 按住那格紅;
//     拿掉公車列的點擊放焦點 ⇒ C 紅;列拿掉 tabindex ⇒ W 紅;拿掉讓位 ⇒ 今日動態 W 紅。兩個引擎都做。
// 慣例照 verify_transfer_collapse.mjs:自帶 node:http 靜態伺服器(埠號由系統挑)、語系與時鐘釘死、關首訪教學卡、
// 掛 pageerror、T0 身分自檢。瀏覽器一律無視窗。約 2–3 分鐘(2026-09-26 補直式合併卡與兩個突變後實測 126s;
// 同日補三張清單面板後 158s,機器負載約 32;再補按住空白鍵、桌面點擊、重抓的格子與突變後 175s,負載約 18)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
// 三張清單面板(今日台鐵動態、公車站牌、行程分享)的假資料:/api 一律回 {} 的話今日動態與公車站牌都是空的,量不到列。
// 筆數刻意比手機 sheet 放得下的多,往回走才會捲、才考得到標題會不會蓋住列。
const API_FIX = {
  '/api/today-board': () => ({ trains: Array.from({ length: 30 }, (_, i) => ({ no: String(101 + i * 11), delay: i % 7, delayMax: (i % 7) + (i % 3),
    sta: '1000', status: i % 3, at: `2026-09-26T09:${String(10 + i).padStart(2, '0')}:00+08:00` })) }),
  '/api/station-events': () => ({ events: Array.from({ length: 6 }, (_, i) => ({ at: `2026-09-26T08:${String(10 + i * 5).padStart(2, '0')}:00+08:00`,
    sta: '1000', status: 1, delay: i, delayMax: i + 1 })) }),
  '/api/bus-stop-live': () => ({ stop: { position: { lat: 25.0478, lon: 121.517 } }, source: { attribution: 'TDX', snapshotAt: new Date().toISOString() },
    routes: Array.from({ length: 16 }, (_, i) => ({ routeId: 'R' + i, routeName: String(200 + i * 7), direction: i % 2,
      arrivals: [{ live: { state: 'countdown', etaSec: 60 * (i + 1) } }, { live: { state: 'countdown', etaSec: 60 * (i + 12) } }] })) }),
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (API_FIX[url.pathname]) return res.end(JSON.stringify(API_FIX[url.pathname]()));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(Number(process.env.PORT || 0), '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ── T0 目標自檢:先證明「我在驗誰」 ──────────────────────────────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}\n`);

// 頁內工具:固定段、可聚焦元素、焦點是否被蓋、讓位值與實際卡住的底緣
const HELPERS = `window.__bsp = (() => {
  const heads = p => [...p.children].filter(n => n.matches('h3, .dwell-plate, .uni-tabs') && getComputedStyle(n).position === 'sticky' && n.getBoundingClientRect().height > 0);
  const desc = e => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : '') : null;
  const tabbables = p => [...p.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable="true"]')]
    .filter(e => !e.disabled && e.tabIndex >= 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0);
  const measure = id => {
    const p = document.getElementById(id), a = document.activeElement;
    if (!p || p.hidden || !a || a === p || !p.contains(a)) return { left: true };
    const hs = heads(p), inHead = hs.some(h => h.contains(a));
    const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = !inHead && hs.some(h => hit && h.contains(hit));
    return { inHead, covered, el: desc(a), over: hs.length ? +(Math.max(...hs.map(h => h.getBoundingClientRect().bottom)) - r.top).toFixed(1) : 0 };
  };
  const padOf = p => parseFloat(p.style.getPropertyValue('--board-scroll-pad')) || 0;
  // 捲到中段量實際卡住的固定段底緣(＋最下面那段的下邊界),量完捲回原位
  const stuck = id => {
    const bd = document.getElementById(id);
    const st0 = bd.scrollTop, max = bd.scrollHeight - bd.clientHeight;
    bd.scrollTop = Math.floor(max / 2);
    const hs = heads(bd), base = bd.getBoundingClientRect().top + bd.clientTop;
    let bottom = 0;
    for (const h of hs) bottom = Math.max(bottom, h.getBoundingClientRect().bottom - base + (parseFloat(getComputedStyle(h).marginBottom) || 0));
    bd.scrollTop = st0;
    return { pad: padOf(bd), stuck: +bottom.toFixed(1), max, n: hs.length };
  };
  return { heads, desc, tabbables, measure, padOf, stuck };
})();`;

const OPEN = {
  favPanel: `(() => {
    const stns = [['臺北', 25.0478, 121.517], ['板橋', 25.0143, 121.4637], ['桃園', 24.9892, 121.3136], ['新竹', 24.8016, 120.9716], ['臺中', 24.1372, 120.6869],
      ['彰化', 24.0817, 120.5386], ['嘉義', 23.4791, 120.4411], ['臺南', 22.9971, 120.2126], ['高雄', 22.6394, 120.3025], ['花蓮', 23.9929, 121.6011]];
    userDataSaveCollection('stations', stns.map(([name, lat, lon]) => ({ name, lat, lon, sys: 'tra_sched', label: '台鐵' })));
    saveFavs(state.trains.filter(t => t.sys === 'tra_sched').slice(0, 10).map(t => ({ train: String(t.train), sys: 'tra_sched' })));
    savePins(Array.from({ length: 6 }, (_, i) => ({ lat: 25.0 + i * 0.01, lon: 121.5 + i * 0.01, label: '地點' + (i + 1) })));
    openFavPanel();
  })()`,
  board: `openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 })`,
  trackPanel: `openTrackPanel()`,
  searchPanel: `openSearchPanel({ user: true })`,
  ridePanel: `openRidePanel()`,
  // 跟車中打開車站看板＝合併卡(橫式時 h3 下還有 sticky 的站名牌與分頁列)
  // 挑已發車、沒在停站、下一站至少 3 分鐘後才到的車:收牌那一格才不會被停靠牌(跟車迴圈自己亮的)混進來
  uni: `(async () => {
    const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
    const tr = cands.find(t => {
      const tt = effTLive(t), info = nextStopInfo(t, tt);
      return tt >= t.stops[0].depSec && !dwellInfoOf(t, tt) && info && info.min >= 3;
    }) || cands[0];
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    await new Promise(r => setTimeout(r, 400));
    openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 });
    await new Promise(r => setTimeout(r, 300));
  })()`,
};
const ELEM = { favPanel: 'favPanel', board: 'board', trackPanel: 'trackPanel', searchPanel: 'searchPanel', ridePanel: 'ridePanel', uni: 'board' };
const CLOSE_ALL = `(() => {
  for (const f of ['closeBoard', 'closeFavPanel', 'closeRidePanel', 'closeExplorePanel', 'closeTrackPanel', 'closeTodayPanel', 'closeDelayHist', 'closeFontPanel', 'closeTripSharePanel', 'closeBusStopPanel', 'closeSearchPanel'])
    try { if (typeof window[f] === 'function') window[f](); } catch (e) {}
  try { if (state.followTrain || state.freqFollow) clearFollow(); } catch (e) {}
  try { document.activeElement && document.activeElement.blur(); } catch (e) {}
})()`;
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

// ── 三張清單面板的列(2026-09-26,v0926e):列是 div,掛 tabindex＋role 之後鍵盤才走得到 ──────────────────
// 修前三張的 W 量到 0 是因為根本沒有可聚焦的列(兩個引擎、360–1280 都只走得到 × 與地圖連結),不是能用。
// 行程分享直接開面板:入口在跟車卡上、要通行證(或 ?tripshare=1),那道閘門不歸這支管。
Object.assign(OPEN, {
  todayPanel: `openTodayPanel()`,
  busStopPanel: `openBusStopPanel({ name: '臺北車站', city: 'Taipei', cityLabel: '臺北市', stationUid: 'TPE0001', position: { lat: 25.0478, lon: 121.517 } })`,
  tripPanel: `(async () => {
    const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
    const tr = cands.find(t => effT(t) >= t.stops[0].depSec && tripRemainingStops(t).length >= 12) || cands[0];
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    await new Promise(r => setTimeout(r, 400));
    openTripSharePanel();
  })()`,
});
Object.assign(ELEM, { todayPanel: 'todayPanel', busStopPanel: 'busStopPanel', tripPanel: 'tripPanel' });
const LIST_ROWS = { todayPanel: '.td-row[data-no]', busStopPanel: '.bus-eta-row', tripPanel: '.row[data-dest]' };
const LIST_MIN = { todayPanel: 30, busStopPanel: 16, tripPanel: 12 };      // 假資料的筆數;行程分享看那班車還剩幾站
const HOPS = { todayPanel: 1, busStopPanel: 2, tripPanel: 1 };            // 從標題的 × 往前幾步到第一列(公車站牌中間隔著地圖連結)
const rowCount = ([id, sel]) => { const rs = [...document.getElementById(id).querySelectorAll(sel)]; return { rows: rs.length, focusable: rs.filter(e => e.tabIndex >= 0).length }; };
const ROW_STATE = ([id, sel]) => {
  const p = document.getElementById(id), a = document.activeElement;
  return { open: !!(p && !p.hidden), onRow: !!(p && a && p.contains(a) && a.matches(sel)), key: (a && (a.dataset.no || a.dataset.dest || a.dataset.route)) || null,
    exp: a ? a.getAttribute('aria-expanded') : null, todayOpen: state._todayOpen, playing: state.playing, shared: window.__bspShared ? window.__bspShared.slice() : null };
};
// 跟使用者一樣用鍵盤走進去:焦點先放在標題的 ×,再按 Tab(WebKit 要 Option+Tab)走 hops 步,然後按 key
async function rowPress(page, eng, id, key, hops = HOPS[id]) {
  const sel = LIST_ROWS[id];
  const first = await page.evaluate(([id, sel, i]) => { const r = document.getElementById(id).querySelectorAll(sel)[i]; return r ? (r.dataset.no || r.dataset.dest || r.dataset.route) : null; }, [id, sel, hops - HOPS[id]]);
  await page.evaluate(id => document.querySelector(`#${id} > h3 .close`).focus(), id);
  for (let i = 0; i < hops; i++) await page.keyboard.press(eng === 'webkit' ? 'Alt+Tab' : 'Tab');
  await settle(page);
  const at = await page.evaluate(ROW_STATE, [id, sel]);
  if (key) { await page.keyboard.press(key); await settle(page); await page.waitForTimeout(150); }
  const after = await page.evaluate(ROW_STATE, [id, sel]);
  return { first, at, after };
}
const fmtTd = r => `走到 ${r.at.onRow ? r.at.key : '(不在列上)'}／第一列 ${r.first}；按下後 展開=${r.after.todayOpen} aria-expanded=${r.after.exp} 焦點=${r.after.onRow ? r.after.key : '離開了列'}`;
const tdOk = r => r.at.onRow && r.at.key === r.first && r.after.todayOpen === r.first && r.after.exp === 'true' && r.after.onRow && r.after.key === r.first;
const fmtTp = r => `走到 ${r.at.onRow ? r.at.key : '(不在列上)'}；按下後 面板${r.after.open ? '還開著' : '關了'}、分享了 ${JSON.stringify(r.after.shared)}`;
const tpOk = r => r.at.onRow && !r.after.open && !!r.after.shared && r.after.shared.length === 1 && r.after.shared[0] === r.first;
const STUB_SHARE = () => { window.__bspShared = []; if (!window.__bspShareTrip) window.__bspShareTrip = shareTrip; window.shareTrip = (tr, d) => { window.__bspShared.push(d); }; };
// 公車站牌每 30 秒重畫一次:鍵盤停在第 3 列時重抓,畫完焦點要還在同一列(路線＋方向)、捲動不動。
// away:重抓前先把清單捲到焦點列跑出畫面(使用者拿滾輪／手指捲過)——焦點列還在畫面裡時,放回焦點本來就不會捲,
// 「捲動不動」要在這個情況下才考得到放回時有沒有 preventScroll。WebKit 的聚焦捲動是非同步的,重抓完多等一下才讀。
async function busRefresh(page, away) {
  const b = await page.evaluate(away => {
    const p = document.getElementById('busStopPanel'), a = document.activeElement;
    if (away && a && p.contains(a)) p.scrollTop += a.getBoundingClientRect().bottom - p.getBoundingClientRect().top + 40;
    return { k0: (a && p.contains(a) && a.dataset.route) || null, st0: p.scrollTop };
  }, away);
  await settle(page);
  await page.evaluate(() => refreshBusStopPanel());
  await settle(page); await page.waitForTimeout(200);
  const a = await page.evaluate(() => { const p = document.getElementById('busStopPanel'), a = document.activeElement; return { k1: (a && p.contains(a) && a.dataset.route) || null, st1: p.scrollTop }; });
  return { ...b, ...a };
}
const busOk = r => !!r.k0 && r.k1 === r.k0 && Math.abs(r.st1 - r.st0) <= 1;
const fmtBus = r => `${r.k0}→${r.k1} 捲動 ${Math.round(r.st0)}→${Math.round(r.st1)}`;
// 全站快捷鍵的空白鍵叫的是全域的 togglePlay:換成計數器,數它被叫了幾次(只看最後的播放狀態,偶數次連發會切回原狀、看不出來)
const COUNT_PLAY = () => { window.__bspPlay = 0; if (!window.__bspPlayOrig) { window.__bspPlayOrig = togglePlay; window.togglePlay = function () { window.__bspPlay++; return window.__bspPlayOrig.apply(this, arguments); }; } };
const UNCOUNT_PLAY = () => { if (window.__bspPlayOrig) { window.togglePlay = window.__bspPlayOrig; window.__bspPlayOrig = null; } };
// 行程分享:鍵盤走到第一列後按住空白鍵(按下＋連發 4 下＋放開)。只能分享一次、全站播放一次都不能切
async function tripHoldSpace(page, eng) {
  await page.evaluate(STUB_SHARE);
  const r = await rowPress(page, eng, 'tripPanel', null);
  await page.evaluate(COUNT_PLAY);
  await page.keyboard.down(' ');
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(40); await page.keyboard.down(' '); }
  await page.keyboard.up(' ');
  await settle(page); await page.waitForTimeout(150);
  const h = await page.evaluate(() => ({ plays: window.__bspPlay, shared: window.__bspShared.slice(), open: !document.getElementById('tripPanel').hidden }));
  await page.evaluate(UNCOUNT_PLAY);
  return { first: r.first, onRow: r.at.onRow, ...h };
}
const holdOk = h => h.onRow && !h.open && h.shared.length === 1 && h.shared[0] === h.first && h.plays === 0;
const fmtHold = h => `走到 ${h.onRow ? h.first : '(不在列上)'}；放開後 面板${h.open ? '還開著' : '關了'}、分享了 ${JSON.stringify(h.shared)}、播放被切 ${h.plays} 次`;
// 公車列點了沒有動作:滑鼠點一列、再按一個沒有快捷鍵的字母,焦點不能留在列上、面板裡不能有亮框(跟改版前一樣回到頁面)
async function busClickKey(page) {
  const pt = await page.evaluate(() => { const r = document.querySelectorAll('#busStopPanel .bus-eta-row')[1]; const b = r.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; });
  await page.mouse.click(pt.x, pt.y); await settle(page);
  await page.keyboard.press('a'); await settle(page);
  return page.evaluate(() => {
    const p = document.getElementById('busStopPanel'), a = document.activeElement;
    let ring = 0; for (const e of p.querySelectorAll('*')) { try { if (e.matches(':focus-visible')) ring++; } catch (err) {} }
    return { onRow: !!(a && p.contains(a) && a.matches('.bus-eta-row')), ring, active: a ? a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).split(' ')[0] : '') : null };
  });
}
const clickOk = c => !c.onRow && c.ring === 0;
const fmtClick = c => `點完按鍵後焦點在 ${c.active}${c.onRow ? '(公車列)' : ''}、面板裡亮框 ${c.ring} 個`;
// W(三張清單):先數列,每一列都要可聚焦;往回走要走過每一列,而且沒有一拍被標題蓋住。walk 定義在下面(函式宣告會提升)
async function listWalk(page, eng, P, key, tag) {
  const opened = await open(page, key);
  const c = opened ? await page.evaluate(rowCount, [key, LIST_ROWS[key]]) : { rows: 0, focusable: 0 };
  ok(P(`W ${tag} ${key} 打得開、列數夠、每一列都可聚焦`), opened && c.rows >= LIST_MIN[key] && c.focusable === c.rows,
    `列 ${c.rows}(至少 ${LIST_MIN[key]})、可聚焦 ${c.focusable}`);
  if (!opened) return;
  const w = await walk(page, eng, key);
  ok(P(`W ${tag} ${key} 鍵盤往回走過每一列,焦點不被固定段蓋住`), w.covered === 0 && w.content >= c.rows,
    `被蓋 ${w.covered}/${w.content} 拍(列 ${c.rows}、可聚焦 ${w.n})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
}

async function boot(browser, { width, height, tier = 'std' }) {
  const mobile = width < 1000;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(t => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-language', 'zh-TW');
      localStorage.removeItem('trainmap-sheet-size');
      if (t !== 'std') localStorage.setItem('trainmap-fontscale', t);
    } catch (e) {}
  }, tier);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}?lang=zh-TW&t=09:41`, { waitUntil: 'domcontentloaded' });
  // 等開機收尾:finishLoad 會 closeRidePanel(),太早開護照會量到被關掉的空面板
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.mode === 'sched' && state.ready === true && (state.trains || []).length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
  await page.evaluate(HELPERS);
  return { ctx, page, errors };
}
async function open(page, key) {
  await page.evaluate(CLOSE_ALL);
  await page.evaluate(OPEN[key]);
  await settle(page); await page.waitForTimeout(250);
  return page.evaluate(id => { const p = document.getElementById(id); return !!(p && !p.hidden); }, ELEM[key]);
}
// W:從最後一個可聚焦元素一路往回走到焦點離開面板
async function walk(page, eng, id) {
  const n = await page.evaluate(id => { const p = document.getElementById(id); const tb = __bsp.tabbables(p); if (tb.length) tb[tb.length - 1].focus(); return tb.length; }, id);
  let steps = 0, content = 0, covered = 0; const bad = [];
  for (let i = 0; i < 80; i++) {
    await settle(page);
    const m = await page.evaluate(id => __bsp.measure(id), id);
    if (m.left) break;
    steps++;
    if (!m.inHead) content++;
    if (m.covered) { covered++; if (bad.length < 3) bad.push(`${m.el} 壓 ${m.over}px`); }
    await page.keyboard.press(eng === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  }
  return { n, steps, content, covered, bad };
}
// J:捲到 80% 再把焦點放進標題(或固定段裡)的某個鈕;WebKit 的聚焦捲動是非同步的,等 450ms 再量
const JUMP = async ([id, sel]) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p = document.getElementById(id);
  const btns = [...p.querySelectorAll(sel)].filter(e => !e.disabled && e.getClientRects().length);
  const btn = btns[btns.length - 1];
  if (!btn) return { none: true };
  if (document.activeElement) document.activeElement.blur();
  const max = p.scrollHeight - p.clientHeight;
  p.scrollTop = Math.floor(max * 0.8);
  await sleep(150);
  const before = p.scrollTop;
  btn.focus();
  await sleep(450);
  const after = p.scrollTop;
  btn.blur();
  return { btn: __bsp.desc(btn), max, before, after, jump: before - after };
};
const H3_BTN = ':scope > h3 button, :scope > h3 a[href]';
// F:#rdSearch 在 #rdSystem 正上方;把 #rdSystem 捲到剛好貼著固定段,#rdSearch 就整顆壓在標題下,再聚焦它
const FIELD = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bd = document.getElementById('trackPanel'), el = document.getElementById('rdSearch'), nxt = document.getElementById('rdSystem');
  if (!bd || bd.hidden || !el || !nxt || !el.getClientRects().length) return { none: true };
  const hs = __bsp.heads(bd), stackBottom = () => Math.max(...hs.map(h => h.getBoundingClientRect().bottom));
  bd.scrollTop = 0; await sleep(50);
  bd.scrollTop = Math.max(0, nxt.getBoundingClientRect().top - stackBottom() - 2 + bd.scrollTop);
  await sleep(150);
  const over = () => +(stackBottom() - el.getBoundingClientRect().top).toFixed(1);
  const over0 = over();
  el.focus();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await sleep(50);
  const over1 = over();
  await sleep(500);
  const over2 = over();
  el.blur();
  return { over0, over1, over2 };
};
// 站名牌出現／消失:照 index.html flashRandomNextPlate 的契約(設 _randomNextPlate、清 _plateStop、立刻 updateFollowPanel),
// 只是期限拉長、自己指定報哪一站;不等跟車迴圈下一輪刷新(那一輪多久來一次不歸這支管)。
const PLATE = async on => {
  const tr = state.followTrain;
  state._randomNextPlate = on ? { tr, until: performance.now() + 600000, stop: tr.stops[Math.min(2, tr.stops.length - 1)] } : null;
  state._plateStop = null;
  updateFollowPanel(tr);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 250));
  const dp = document.getElementById('dwellPlate');
  return { ...__bsp.stuck('board'), plate: (dp.classList.contains('dp-docked') ? '併入' : '未併') + (dp.classList.contains('show') ? '亮' : '暗') };
};
// 換字級走設定面板用的那個入口(setFontScale 在閉包裡,只經 state._setFontScale 露出來);
// 入口不見了就回報,不自己改 data-fs 冒充——那樣量不到真路徑多做的事(寫 localStorage、重量地圖與面板)。
const FONT = async tier => {
  if (typeof state === 'undefined' || typeof state._setFontScale !== 'function') return { noEntry: true };
  state._setFontScale(tier);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 150));
  return __bsp.stuck('ridePanel');
};
const padFits = s => !s.noEntry && Math.abs(s.pad - s.stuck) <= 1;
const fmtS = s => s.noEntry ? '換字級入口 state._setFontScale 不見了' : `pad ${s.pad} 實際 ${s.stuck}(${s.n} 段, 可捲 ${s.max}${s.plate ? ', 牌' + s.plate : ''})`;
// 分頁列的排除規則原本只在側欄 media 段裡;原樣複製一份到 media 外＝「有人把它移出側欄段」。找不到那條就回 null
const TABS_RULE_OUT = () => {
  const find = rules => {
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes('.board > .uni-tabs') && r.style.scrollMarginTop === '0px') return r;
      if (r.cssRules && !r.selectorText) { const hit = find(r.cssRules); if (hit) return hit; }
    }
    return null;
  };
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule)) continue;
      const hit = find(r.cssRules);
      if (!hit) continue;
      const el = document.createElement('style'); el.id = '__bspTabsOut'; el.textContent = hit.cssText;
      document.head.appendChild(el);
      return hit.selectorText;
    }
  }
  return null;
};

let t0Done = false;
for (const [eng, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch({ headless: true });
  const P = s => `${eng} ${s}`;

  // ── 360×780 直式標準字級 ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780 });
    if (!t0Done) {
      t0Done = true;
      const served = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
      ok('T0 服務端 BUILD 與本機檔案一致', served === localBuild, `served=${served} local=${localBuild}`);
    }
    // W:走過的內容拍數下限(當下量到的可聚焦數推導,不寫死):長面板至少走完一半,短面板至少 2 拍
    for (const key of ['favPanel', 'board', 'trackPanel', 'searchPanel', 'ridePanel']) {
      const opened = await open(page, key);
      if (!opened) { ok(P(`W 360 ${key} 打得開`), false); continue; }
      const w = await walk(page, eng, ELEM[key]);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W 360 ${key} 鍵盤往回走,焦點不被固定段蓋住`), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
    }
    // J
    for (const key of ['favPanel', 'board', 'trackPanel', 'ridePanel']) {
      await open(page, key);
      const j = await page.evaluate(JUMP, [ELEM[key], H3_BTN]);
      ok(P(`J 360 ${key} 捲在下面時聚焦標題的鈕,內容不跳`), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
        j.none ? '標題裡找不到鈕' : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
    }
    // F
    await open(page, 'trackPanel');
    const f = await page.evaluate(FIELD);
    ok(P('F 360 被蓋住的文字欄位 #rdSearch 聚焦後讓出來、半秒後也沒被捲回去'), !f.none && f.over0 > 20 && f.over1 <= 0.5 && f.over2 <= 0.5,
      f.none ? '#rdSearch 不在畫面上' : `聚焦前壓 ${f.over0}px → 下一拍 ${f.over1} → 半秒後 ${f.over2}(≤0 才算讓出)`);
    if (eng === 'webkit') {
      // N:拿掉聚焦補捲 ⇒ WebKit 只剩 scroll-margin,文字欄位聚焦後仍壓在標題下(F 要量得到紅);量完掛回去
      await open(page, 'trackPanel');
      await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) b.removeEventListener('focusin', boardRevealField); });
      const fm = await page.evaluate(FIELD);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) b.addEventListener('focusin', boardRevealField); });
      ok(P('N 突變:拿掉 boardRevealField ⇒ #rdSearch 聚焦後仍壓在標題下(F 量得到紅)'), !fm.none && fm.over0 > 20 && (fm.over1 > 0.5 || fm.over2 > 0.5),
        fm.none ? '#rdSearch 不在畫面上' : `聚焦前壓 ${fm.over0}px → 下一拍 ${fm.over1} → 半秒後 ${fm.over2}`);
    }
    // W:三張清單面板
    for (const key of ['todayPanel', 'busStopPanel', 'tripPanel']) await listWalk(page, eng, P, key, '360');
    // E:列可以用鍵盤觸發,做的事跟點一下一樣——今日動態展開逐站歷程、行程分享拿那一站分享(shareTrip 換成記錄器,不叫出真的分享)。
    // 空白鍵同樣觸發,而且不能順便切到全站快捷鍵的播放／暫停。公車站牌的列點了本來就沒有動作,只驗重畫後焦點留在原列(R)。
    await open(page, 'todayPanel');
    const te = await rowPress(page, eng, 'todayPanel', 'Enter');
    ok(P('E 360 今日動態:鍵盤走到第一列按 Enter,展開逐站歷程、焦點留在那一列'), tdOk(te), fmtTd(te));
    await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(150);
    const tc = await page.evaluate(ROW_STATE, ['todayPanel', LIST_ROWS.todayPanel]);
    ok(P('E 360 今日動態:再按一次 Enter 收合,焦點還在那一列'), tdOk(te) && tc.todayOpen === null && tc.exp === 'false' && tc.onRow && tc.key === te.first,
      `收合後 展開=${tc.todayOpen} aria-expanded=${tc.exp} 焦點=${tc.onRow ? tc.key : '離開了列'}`);
    await open(page, 'todayPanel');
    const ts = await rowPress(page, eng, 'todayPanel', ' ');
    ok(P('E 360 今日動態:空白鍵一樣展開,不動播放／暫停'), tdOk(ts) && ts.after.playing === ts.at.playing, `${fmtTd(ts)} 播放 ${ts.at.playing}→${ts.after.playing}`);
    for (const k of ['Enter', ' ']) {
      await open(page, 'tripPanel'); await page.evaluate(STUB_SHARE);
      const r = await rowPress(page, eng, 'tripPanel', k);
      ok(P(`E 360 行程分享:鍵盤走到第一列按${k === ' ' ? '空白鍵' : ' Enter'},拿那一站分享、面板收起、不動播放／暫停`),
        tpOk(r) && r.after.playing === r.at.playing, `${fmtTp(r)} 播放 ${r.at.playing}→${r.after.playing}`);
    }
    await open(page, 'tripPanel');
    const th = await tripHoldSpace(page, eng);
    ok(P('E 360 行程分享:按住空白鍵(連發 4 下)只分享一次、全站播放一次都沒切'), holdOk(th), fmtHold(th));
    // R:公車站牌重抓後焦點留在同一列;焦點列被捲出畫面時重抓,清單也不能被捲回去
    await open(page, 'busStopPanel');
    await rowPress(page, eng, 'busStopPanel', null, HOPS.busStopPanel + 2);
    const br = await busRefresh(page, false);
    ok(P('R 360 公車站牌:鍵盤停在第 3 列時重抓,焦點留在同一列、捲動不動'), busOk(br), fmtBus(br));
    const bra = await busRefresh(page, true);
    ok(P('R 360 公車站牌:焦點列被捲出畫面後重抓,焦點留在那一列、清單不被捲回去'), busOk(bra), fmtBus(bra));
    // N:每個突變都要紅——拿掉今日動態列的鍵盤接線 ⇒ Enter 不展開;拿掉行程分享列的 ⇒ Enter 不分享;
    //   重畫後不放回焦點(boardRefocus 換成空的) ⇒ 今日動態 Enter 後焦點離開列、公車站牌重抓後焦點不見;
    //   放回焦點不帶 preventScroll ⇒ 焦點列捲出畫面後重抓,清單被捲回去;空白鍵改回按下就觸發 ⇒ 按住時播放被連發一直切;
    //   拿掉公車列的點擊放焦點 ⇒ 點一列再按鍵亮框;列拿掉 tabindex ⇒ 往回走一列都走不到
    await open(page, 'todayPanel');
    await page.evaluate(() => { const p = document.getElementById('todayPanel'); p.onkeydown = p.onkeyup = null; });
    const nte = await rowPress(page, eng, 'todayPanel', 'Enter');
    ok(P('N 突變:拿掉今日動態列的鍵盤接線 ⇒ Enter 不展開(E 量得到紅)'), !tdOk(nte), fmtTd(nte));
    await open(page, 'tripPanel'); await page.evaluate(STUB_SHARE);
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); window.__bspTripKD = p.onkeydown; window.__bspTripKU = p.onkeyup; p.onkeydown = p.onkeyup = null; });
    const ntp = await rowPress(page, eng, 'tripPanel', 'Enter');
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); p.onkeydown = window.__bspTripKD; p.onkeyup = window.__bspTripKU; });
    ok(P('N 突變:拿掉行程分享列的鍵盤接線 ⇒ Enter 不分享(E 量得到紅)'), !tpOk(ntp), fmtTp(ntp));
    await page.evaluate(() => { window.__bspRefocus = boardRefocus; window.boardRefocus = () => {}; });
    await open(page, 'todayPanel');
    const ntf = await rowPress(page, eng, 'todayPanel', 'Enter');
    await open(page, 'busStopPanel');
    await rowPress(page, eng, 'busStopPanel', null, HOPS.busStopPanel + 2);
    const nbr = await busRefresh(page, false);
    await page.evaluate(() => { window.boardRefocus = window.__bspRefocus; });
    ok(P('N 突變:重畫後不放回焦點 ⇒ 今日動態 Enter 後焦點離開列、公車站牌重抓後焦點不見(E、R 量得到紅)'),
      !tdOk(ntf) && !!nbr.k0 && nbr.k1 !== nbr.k0, `${fmtTd(ntf)}；公車 ${nbr.k0}→${nbr.k1}`);
    await page.evaluate(() => { window.__bspRefocus = boardRefocus; window.boardRefocus = (el, sel) => { const n = sel && el.querySelector(sel); if (n && n !== document.activeElement) n.focus(); }; });
    await open(page, 'busStopPanel');
    await rowPress(page, eng, 'busStopPanel', null, HOPS.busStopPanel + 2);
    const nba = await busRefresh(page, true);
    await page.evaluate(() => { window.boardRefocus = window.__bspRefocus; });
    ok(P('N 突變:放回焦點不帶 preventScroll ⇒ 焦點列捲出畫面後重抓,清單被捲回去(R 量得到紅)'),
      !!nba.k0 && nba.k1 === nba.k0 && Math.abs(nba.st1 - nba.st0) > 1, fmtBus(nba));
    await open(page, 'tripPanel');
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); window.__bspTripKD = p.onkeydown; window.__bspTripKU = p.onkeyup; p.onkeyup = null;
      p.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.row[data-dest]')) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) e.target.click(); } }; });
    const nth = await tripHoldSpace(page, eng);
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); p.onkeydown = window.__bspTripKD; p.onkeyup = window.__bspTripKU; });
    ok(P('N 突變:空白鍵改回按下就觸發 ⇒ 按住時面板收起後的連發一直切播放(E 按住那格量得到紅)'), !holdOk(nth) && nth.plays > 0, fmtHold(nth));
    await open(page, 'todayPanel');
    await page.evaluate(() => { for (const r of document.querySelectorAll('#todayPanel .td-row')) r.removeAttribute('tabindex'); });
    const ntw = await walk(page, eng, 'todayPanel');
    ok(P('N 突變:列拿掉 tabindex ⇒ 今日動態往回走一列都走不到(W 量得到紅)'), ntw.content < LIST_MIN.todayPanel, `走過內容 ${ntw.content} 拍(可聚焦 ${ntw.n})`);
    await page.evaluate(() => { if (window.__bspShareTrip) window.shareTrip = window.__bspShareTrip; });
    await page.evaluate(CLOSE_ALL);
    // P:護照重繪換掉 h3(新節點)之後換字級,讓位要跟著長高
    await open(page, 'ridePanel');
    const rideStuck = async mutate => {
      await page.evaluate(() => renderRidePanel());
      if (mutate) await page.evaluate(() => boardPadRO.unobserve(document.querySelector('#ridePanel > h3')));
      await settle(page);
      const std = await page.evaluate(FONT, 'std');
      const xl = await page.evaluate(FONT, 'xlarge');
      await page.evaluate(FONT, 'std');
      return { std, xl };
    };
    const rs = await rideStuck(false);
    ok(P('P 360 護照重繪後換特大字級,讓位＝實際固定段底緣'), padFits(rs.std) && padFits(rs.xl) && rs.xl.stuck > rs.std.stuck + 3,
      `標準 ${fmtS(rs.std)}；特大 ${fmtS(rs.xl)}`);
    if (eng === 'chromium') {
      const rm = await rideStuck(true);
      ok(P('N 突變:重繪後新 h3 沒被觀察 ⇒ 特大字級的讓位停在舊值(P 量得到紅)'), !rm.xl.noEntry && !padFits(rm.xl), `特大 ${fmtS(rm.xl)}`);
    }
    // N:改回容器 scroll-padding-top(v0925k 的寫法) ⇒ J 必須紅
    await open(page, 'board');
    await page.evaluate(() => {
      window.syncBoardScrollPad = function () {};
      for (const b of document.querySelectorAll('.board')) { b.style.scrollPaddingTop = b.style.getPropertyValue('--board-scroll-pad'); b.style.removeProperty('--board-scroll-pad'); }
    });
    const jn = await page.evaluate(JUMP, ['board', H3_BTN]);
    ok(P('N 對照:容器 scroll-padding-top ⇒ 聚焦標題的鈕內容會跳(J 量得到紅)'), !jn.none && Math.abs(jn.jump) > 20,
      jn.none ? '標題裡找不到鈕' : `${jn.btn} 捲動 ${jn.before}→${jn.after}`);
    // N:讓位整個拿掉 ⇒ W 必須紅
    await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) { b.style.scrollPaddingTop = ''; b.style.removeProperty('--board-scroll-pad'); } });
    await open(page, 'favPanel');
    const wn = await walk(page, eng, 'favPanel');
    ok(P('N 對照:拿掉讓位 ⇒ 我的最愛鍵盤往回走會被蓋(W 量得到紅)'), wn.covered > 0, `被蓋 ${wn.covered}/${wn.content} 拍`);
    await open(page, 'todayPanel');
    const wnt = await walk(page, eng, 'todayPanel');
    ok(P('N 對照:拿掉讓位 ⇒ 今日動態鍵盤往回走,列會被蓋(三張清單的 W 量得到紅)'), wnt.covered > 0, `被蓋 ${wnt.covered}/${wnt.content} 拍`);
    ok(P('360 標準字級全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 360×780 直式特大字級 ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780, tier: 'xlarge' });
    for (const key of ['favPanel', 'ridePanel']) {
      const opened = await open(page, key);
      if (!opened) { ok(P(`W 360 特大 ${key} 打得開`), false); continue; }
      const w = await walk(page, eng, ELEM[key]);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W 360 特大 ${key} 鍵盤往回走,焦點不被固定段蓋住`), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
    }
    // 三張清單面板:特大字級的標題與列都變高
    for (const key of ['todayPanel', 'busStopPanel', 'tripPanel']) await listWalk(page, eng, P, key, '360 特大');
    // 直式合併卡:分頁列不 sticky(只在側欄 media 段釘住),是一般內容,Shift+Tab 走到分頁鈕時要讓出標題
    const portUni = async () => (await open(page, 'uni'))
      && page.evaluate(() => { const t = document.querySelector('#board > .uni-tabs'); return t ? getComputedStyle(t).position : null; });
    const tabsPos = await portUni();
    ok(P('360 特大 直式合併卡打得開、分頁列不是 sticky'), !!tabsPos && tabsPos !== 'sticky', `分頁列 position=${tabsPos}`);
    if (tabsPos && tabsPos !== 'sticky') {
      const w = await walk(page, eng, 'board');
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P('W 360 特大 直式合併卡鍵盤往回走,焦點不被固定段蓋住'), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
      // N:把分頁列的排除規則移出側欄段 ⇒ 直式分頁鈕不再讓位,停在標題底下
      const moved = await page.evaluate(TABS_RULE_OUT);
      ok(P('N 突變目標:側欄 media 段裡找得到分頁列的排除規則'), !!moved, moved || '找不到');
      if (moved) {
        await portUni();
        const wm = await walk(page, eng, 'board');
        await page.evaluate(() => document.getElementById('__bspTabsOut').remove());
        ok(P('N 突變:分頁列的排除規則移出側欄段 ⇒ 直式合併卡往回走會被蓋(W 量得到紅)'), wm.covered > 0,
          `被蓋 ${wm.covered}/${wm.content} 拍${wm.bad.length ? '；' + wm.bad.join('、') : ''}`);
      }
    }
    ok(P('360 特大字級全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 844×390 橫式合併卡(h3＋站名牌＋分頁列三段固定段) ──────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 844, height: 390 });
    const opened = await open(page, 'uni');
    const isUni = opened && await page.evaluate(() => { const t = document.querySelector('#board > .uni-tabs'); return !!(t && getComputedStyle(t).position === 'sticky'); });
    ok(P('844×390 合併卡打得開、分頁列是 sticky'), isUni);
    if (isUni) {
      const w = await walk(page, eng, 'board');
      ok(P('W 844×390 合併卡鍵盤往回走,焦點不被固定段蓋住'), w.covered === 0 && w.content >= 2,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
      await page.evaluate(CLOSE_ALL); await page.evaluate(OPEN.uni); await settle(page); await page.waitForTimeout(250);
      for (const [label, sel] of [['標題的鈕', H3_BTN], ['分頁鈕', ':scope > .uni-tabs button']]) {
        const j = await page.evaluate(JUMP, ['board', sel]);
        ok(P(`J 844×390 合併卡捲在下面時聚焦${label},內容不跳`), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
          j.none ? `找不到${label}` : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
      }
      const off = await page.evaluate(PLATE, false), on = await page.evaluate(PLATE, true), off2 = await page.evaluate(PLATE, false);
      ok(P('P 844×390 站名牌出現／消失,讓位＝實際固定段底緣'), padFits(off) && padFits(on) && padFits(off2) && on.n === off.n + 1 && on.stuck > off.stuck + 10,
        `無牌 ${fmtS(off)}；有牌 ${fmtS(on)}；再收 ${fmtS(off2)}`);
      if (eng === 'chromium') {
        const src = await page.evaluate(() => syncBoardHeadVar.toString());
        const LINE = 'if (on) syncBoardScrollPad(bd);';
        ok(P('N 突變目標那一行還在 syncBoardHeadVar 裡'), src.includes(LINE));
        if (src.includes(LINE)) {
          await page.evaluate(([s, line]) => { window.__origSBHV = syncBoardHeadVar; window.syncBoardHeadVar = (0, eval)('(' + s.replace(line, '') + ')'); }, [src, LINE]);
          await page.evaluate(PLATE, false);
          const mOn = await page.evaluate(PLATE, true);
          ok(P('N 突變:拿掉 syncBoardHeadVar 尾端那一刀 ⇒ 站名牌出現時讓位停在舊值(P 量得到紅)'), !padFits(mOn), `有牌 ${fmtS(mOn)}`);
          await page.evaluate(() => { window.syncBoardHeadVar = window.__origSBHV; });
        }
      }
    }
    // 三張清單面板:橫式畫面矮,標題佔的比例最大
    for (const key of ['todayPanel', 'busStopPanel', 'tripPanel']) await listWalk(page, eng, P, key, '844×390');
    ok(P('844×390 全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 1280×800 桌面:滑鼠點公車列 ─────────────────────────────────────────────
  // C 放在桌面量:Chromium 的手機模擬點一下不會把焦點交給 tabindex 列,在 360 量不到東西、突變也紅不了
  {
    const { ctx, page, errors } = await boot(browser, { width: 1280, height: 800 });
    await open(page, 'busStopPanel');
    const bc = await busClickKey(page);
    ok(P('C 1280 公車站牌:滑鼠點一列再按鍵,焦點不留在列上、不亮框(點列跟改版前一樣)'), clickOk(bc), fmtClick(bc));
    await open(page, 'busStopPanel');
    await page.evaluate(() => document.getElementById('busStopPanel').removeEventListener('focusin', busRowDropPointerFocus));
    const nbc = await busClickKey(page);
    await page.evaluate(() => document.getElementById('busStopPanel').addEventListener('focusin', busRowDropPointerFocus));
    ok(P('N 突變:拿掉公車列的點擊放焦點 ⇒ 點一列再按鍵,焦點留在列上而且亮框(C 量得到紅)'), nbc.onRow && nbc.ring > 0, fmtClick(nbc));
    ok(P('1280 全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await browser.close();
}
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${failed.length ? `未過 ${failed.length} 條` : '全部通過'}(共 ${results.length} 條)`);
process.exitCode = failed.length ? 1 : 0;
