// 活動公告(events)驗證:時間窗 × 日期格式 × 錨點解析(含跨系統同名站) × 三條看板路徑
// (sched / freq / 全台同框 deco) × 今日亮點 × 原文連結 × 手機四寬 × 空狀態 × endGuess 兩側
// 用法:node scripts/verify_events.mjs            (預設 http://localhost:5187)
//       VURL=http://localhost:<port> node scripts/verify_events.mjs
// 🔴 route 只攔 data/events.json 與 fixture 的 example.invalid 兩條:全攔式 ctx.route('**/*')
//    會把 CDN 的 Leaflet 一起擋掉,頁面 boot 會拋錯而永遠不 ready(2026-08-10 的教訓)。
import { chromium, webkit } from 'playwright';

const BASE = process.env.VURL || 'http://localhost:5187';
let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

// 今天(台北)與相對日期,測試資料用它組出「已結束/太早/剛好在窗內」三種
const TPE = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
const iso = d => d.toISOString().slice(0, 10);
const shift = n => { const d = new Date(Date.UTC(TPE.getFullYear(), TPE.getMonth(), TPE.getDate())); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// 跨系統同名站:真實資料有 5 組(台北車站 mrt/tymc 412m、紅樹林 mrt/ntdlrt 179m、
// 頂埔 mrt/sanying 68m、十四張 mrt/ntalrt 40m、市政府 mrt/tmrt 134702m)。
// 兩種樣本都要有:市政府是「不同城市的兩顆站」(必須分家)、頂埔是「同一座共構站」(必須合體)。
// 站名相同 ⇒ name 比對擋不掉 ⇒ sys 比對真的會被執行到(舊 fixture 的花蓮 vs 大安森林公園
// 站名就不同,sys 比對從未跑過,B2 是恆真的假對照)。
const CITYHALL_TPE_LAT = 25.041135, CITYHALL_TCH_LAT = 24.16199, CITYHALL_LAT_SPLIT = 24.5;

const FIXTURE = {
  updated: shift(0),
  events: [
    { id: 'in-window-metro', source: 'official', title: '窗內捷運活動', start: shift(1), end: shift(3),
      anchor: { kind: 'station', sys: 'mrt', name: '大安森林公園' }, url: 'https://example.invalid/a' },
    { id: 'in-window-tra', source: 'official', title: '窗內台鐵活動', start: shift(0), end: shift(2),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/b' },
    { id: 'ended', source: 'official', title: '已結束活動', start: shift(-9), end: shift(-1),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/c' },
    { id: 'too-early', source: 'official', title: '太早活動', start: shift(15), end: shift(16),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/d' },
    { id: 'edge-13', source: 'official', title: '窗邊活動', start: shift(13), end: shift(14),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/e' },
    { id: 'sys-level', source: 'official', title: '系統級活動', start: shift(0), end: shift(5),
      anchor: { kind: 'system', sys: 'tra_sched' }, url: 'https://example.invalid/f' },
    { id: 'guess-end', source: 'official', title: '推定結束活動', start: shift(-1), end: shift(20), endGuess: true,
      anchor: { kind: 'station', sys: 'tra_sched', name: '台東' }, url: 'https://example.invalid/g' },
    { id: 'partner-one', source: 'partner', title: '合作活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'tra_sched', name: '台東' }, url: 'https://example.invalid/h' },
    // 跨系統同名站配對(Section L/N 用):兩則站名一模一樣、只有 anchor.sys 不同
    { id: 'cityhall-mrt', source: 'official', title: '北捷市政府活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'mrt', name: '市政府' }, url: 'https://example.invalid/i' },
    { id: 'cityhall-tmrt', source: 'official', title: '中捷市政府活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'tmrt', name: '市政府' }, url: 'https://example.invalid/j' },
    // 同名站的另一半:頂埔是北捷↔三鶯線的同一座轉乘站(實測相距 68 公尺),兩家的活動都該掛上去。
    // 這一對管住座標閘門的下界(收太緊就會把共構站拆成兩顆),市政府那一對管上界。
    { id: 'dingpu-mrt', source: 'official', title: '北捷頂埔活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'mrt', name: '頂埔' }, url: 'https://example.invalid/k' },
    { id: 'dingpu-sanying', source: 'official', title: '三鶯線頂埔活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'sanying', name: '頂埔' }, url: 'https://example.invalid/l' },
    // 沒有原文連結 / 原文連結不是 http(s)(Section A/K 用):兩者都不得渲染成 <a>
    { id: 'no-url', source: 'official', title: '無連結活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' } },
    { id: 'bad-url', source: 'official', title: '惡意連結活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'javascript:window.__pwned = 1' },
    { id: 'bad-url-sys', source: 'official', title: '惡意系統活動', start: shift(0), end: shift(5),
      anchor: { kind: 'system', sys: 'tra_sched' }, url: 'javascript:window.__pwned = 1' },
  ],
};
const evOf = id => FIXTURE.events.find(x => x.id === id);

// 壞日期格式(Section M 用)。資料是每日半自動產生的,少補一個零是自然手滑;
// 一筆壞掉不得把整份清單(含正常那筆)一起拖垮。start / end 兩側各掃一遍。
// 2026-02-29 是「格式對但那天不存在」:Date 不當它無效,會靜靜滾成 03-01,所以要單獨列一種。
const BAD_DAYS = ['2026-8-15', '2026/08/15', '2026-13-01', '2026-08-32', '2026-02-29', '即日起', '暑假期間'];
const BAD_DAY_FIXTURE = {
  updated: shift(0),
  events: [
    ...BAD_DAYS.map((d, i) => ({ id: 'bad-start-' + i, source: 'official', title: '壞開始日' + i, start: d, end: shift(3),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/bs' + i })),
    ...BAD_DAYS.map((d, i) => ({ id: 'bad-end-' + i, source: 'official', title: '壞結束日' + i, start: shift(0), end: d,
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/be' + i })),
    { id: 'no-days', source: 'official', title: '沒有日期', anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' },
      url: 'https://example.invalid/nd' },
    { id: 'good-day', source: 'official', title: '好日期活動', start: shift(0), end: shift(3),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/ok' },
  ],
};

async function openPage(browser, { events = FIXTURE, w = 1280, h = 800, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'zh-TW', hasTouch: touch });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await ctx.route('**/data/events.json*', r =>
    events === null ? r.fulfill({ status: 404, body: 'not found' })
                    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) }));
  // 活動原文連結的落地頁。.invalid 是保證不可解析的 TLD,不攔的話「真的點一次」只會量到
  // 導向失敗,分不出「連結對不對」與「網路不通」;攔了才拿得到「導向確實發生」的確定觀測值。
  await ctx.route(/example\.invalid/, r =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>ev-target</title>ok' }));
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message || e)));
  await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => state && state.ready === true, null, { timeout: 45000 });
  pg._errs = errs;
  return { ctx, pg };
}

// 真的點一次,回傳被開起來的那個分頁的網址(沒開起來回 null)。
// 用 context 的 'page' 事件不是 page 的 'popup':活動列是 rel="noopener",Chromium 會把新分頁
// 與 opener 切斷,'popup' 不保證會發;context 的 'page' 對同 context 內任何新分頁都會發。
// 不用 elementFromPoint 代替——那答的是「點到誰」不是「點了會怎樣」(設計書驗收條件開頭)。
async function urlOpenedBy(ctx, locator, { tap = false } = {}) {
  const [page] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    (tap ? locator.tap() : locator.click({ timeout: 5000 })).catch(() => {}),
  ]);
  if (!page) return null;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const u = page.url();
  await page.close().catch(() => {});
  return u;
}
// 看板上某一則活動的那一列(用標題挑,不靠 DOM 順序——順序會隨 fixture 增減而變)
const evRow = (pg, title) => pg.locator('#board .ev-row').filter({ hasText: title });
// 那一列渲染成什麼標籤:有原文＝A(連結),沒有＝DIV(純資訊列)
const evRowTag = (pg, title) => pg.evaluate(t => {
  const n = [...document.querySelectorAll('#board .ev-row')].find(x => x.textContent.includes(t));
  return n ? n.tagName : null;
}, title);

// 等活動資料真的載完:ensureEvents() 是非同步的,fetch 回來才在 .then 裡把 _events 填好、
// 若面板還開著才補畫一次(見 index.html ensureEvents 定義)。openStationBoard() 呼叫的 openBoard()
// 會同步觸發 ensureEvents() 但不等它,兩者之間有個實測約 30-40ms 的窗口,openStationBoard() 一
// 返回就查 DOM 會不穩定命中這個窗口(fix round 1 的根因)。
// 用裸 _events 不是 window._events —— classic script 的頂層 let/const 不會掛到 window
// (Task 1 對 state 已踩過同一坑,見 openPage() 的寫法)。
// 404 情境已讀 index.html 源碼確認(非假設):fetchJSONAt() 對非 200 一律回傳 null(不會拋例外),
// ensureEvents() 的 .then 拿到 null 仍會把 _events 設成 []而不是留在 null,所以這個等待條件在
// 404 時一樣會成立,不會卡到 timeout。
async function awaitEvents(pg) {
  await pg.waitForFunction(() => typeof _events !== 'undefined' && _events !== null, null, { timeout: 10000 });
}

// 直接開某站的看板(繞過地圖點擊,那是另一件事的測試)。openBoard() 會觸發 ensureEvents(),
// 這裡順便等它載完,呼叫端不必自己補等待。
// 🔴 這裡刻意不在 openExplorePanel() 之後也呼叫 awaitEvents——目前 renderExplorePanel()
// 完全沒有呼叫 ensureEvents()(接上今日亮點是 Task 3 的範圍,尚未實作;grep index.html 確認
// ensureEvents 只有一個呼叫點,在 renderBoard() 內)。若在 openExplorePanel() 後面也等 _events,
// 凡是該 test block 從未呼叫過 openStationBoard() 的情境(Section E/F 正是如此),_events 永遠
// 不會離開 null,會卡滿 10 秒 timeout 甚至讓整支腳本因未捕捉的 rejection 中止、不印總計行。
// latMin/latMax:同名跨系統站(台北的市政府 vs 台中的市政府)不能用站名挑,用緯度挑。
// 刻意不用實作判系統歸屬的那個欄位(ln._sys / freqSysIdOf)來挑——判準的真值來源不得與
// 受測實作同源,否則把那個欄位改壞時測試會跟著一起錯、量出假的「對齊」。緯度是外部地理事實。
async function openStationBoard(pg, sysId, name, { latMin = null, latMax = null } = {}) {
  const ok = await pg.evaluate(([sysId, name, latMin, latMax]) => {
    const k = name.replace(/臺/g, '台');
    const inLat = s => (latMin == null || s.lat >= latMin) && (latMax == null || s.lat <= latMax);
    let st = null;
    if (state.mode === 'sched') st = state.schedStations.find(s => s.sys === sysId && s.name.replace(/臺/g, '台') === k && inLat(s)) || null;
    if (!st) {
      const lines = state.mode === 'sched' ? (state.decoLines || []) : (state.lines || []);
      for (const ln of lines) {
        const s = (ln.stations || []).find(x => x.name.replace(/臺/g, '台') === k && inLat(x));
        if (s) { st = { name: s.name, lat: s.lat, lon: s.lon, sys: state.mode === 'sched' ? 'deco' : 'freq' }; break; }
      }
    }
    if (!st) return false;
    openBoard(st);
    return true;
  }, [sysId, name, latMin, latMax]);
  if (ok) await awaitEvents(pg);
  return ok;
}

// 每一節都包 try/catch:實作在 render 時拋例外(例如 activeEvents() 的 filter 裡拋)會讓
// pg.evaluate() reject,沒接住就整支腳本中止、連總計行都不印——那看起來像「這支腳本不存在」,
// 比紅還糟。包起來之後同一件事會變成一條具名 FAIL(`X! 這一節整節跑完不拋例外`),其餘各節照跑。
// 拋出時該節的 context 不會被關掉,由 browser.close() 一起收(每輪最多十來個,不影響結果)。
async function run(browser, engine) {
  console.log(`\n── ${engine} ──`);

  // A. 台鐵站(renderBoard sched 路徑)
  try {
    const { ctx, pg } = await openPage(browser);
    const ok = await openStationBoard(pg, 'tra_sched', '花蓮');
    chk(`${engine} A0 花蓮站看板開得起來`, ok);
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} A1 窗內台鐵活動出現`, rows.includes('窗內台鐵活動'), JSON.stringify(rows));
    chk(`${engine} A2 已結束活動不出現`, !rows.includes('已結束活動'), JSON.stringify(rows));
    chk(`${engine} A3 太早(15天)活動不出現`, !rows.includes('太早活動'), JSON.stringify(rows));
    chk(`${engine} A4 窗邊(13天)活動出現`, rows.includes('窗邊活動'), JSON.stringify(rows));
    chk(`${engine} A5 系統級活動不進車站看板`, !rows.includes('系統級活動'), JSON.stringify(rows));
    // 活動列唯一的功能就是連回官方原文(設計書的版權與誠實線)——href 是誰、點下去去哪,兩件都要驗
    const hrefs = await pg.$$eval('#board a.ev-row', ns => ns.map(n => n.getAttribute('href')));
    chk(`${engine} A6 活動列連回該活動的官方原文`, hrefs.includes(evOf('in-window-tra').url), JSON.stringify(hrefs));
    // 正向對照(hrefs.length > 0)與白名單同一條:沒有連結型活動列時,every() 恆真等於沒驗
    chk(`${engine} A7 每條活動連結都是 http(s) 開頭`,
      hrefs.length > 0 && hrefs.every(h => /^https?:\/\//i.test(h || '')), JSON.stringify(hrefs));
    chk(`${engine} A8 有原文的活動列渲染成連結`, await evRowTag(pg, '窗內台鐵活動') === 'A');
    chk(`${engine} A9 沒有原文的活動列不是連結`, await evRowTag(pg, '無連結活動') === 'DIV',
      String(await evRowTag(pg, '無連結活動')));
    chk(`${engine} A10 javascript: 原文的活動列不是連結`, await evRowTag(pg, '惡意連結活動') === 'DIV',
      String(await evRowTag(pg, '惡意連結活動')));
    // 真的點一次(擺最後:會開出新分頁)
    const opened = await urlOpenedBy(ctx, evRow(pg, '窗內台鐵活動'));
    chk(`${engine} A11 真的點一次會導向該活動的官方原文`, opened === evOf('in-window-tra').url, String(opened));
    const badOpened = await urlOpenedBy(ctx, evRow(pg, '惡意連結活動'));
    const pwned = await pg.evaluate(() => window.__pwned);
    chk(`${engine} A12 點 javascript: 原文的活動列不導向也不執行`,
      badOpened === null && pwned === undefined, `opened=${badOpened} pwned=${pwned}`);
    await ctx.close();
  } catch (e) { chk(`${engine} A! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // B. 捷運站(renderFreqBoard 路徑) —— 必須切到捷運分頁
  try {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'metro')));
    await pg.waitForFunction(() => state.mode === 'freq' && state.lines.length > 0, null, { timeout: 30000 });
    const ok = await openStationBoard(pg, 'mrt', '大安森林公園');
    chk(`${engine} B0 大安森林公園站看板開得起來`, ok);
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} B1 捷運活動出現在 freq 看板`, rows.includes('窗內捷運活動'), JSON.stringify(rows));
    chk(`${engine} B2 台鐵活動不出現在捷運站`, !rows.includes('窗內台鐵活動'), JSON.stringify(rows));
    await ctx.close();
  } catch (e) { chk(`${engine} B! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // C. 反向對照:沒有活動的站不得有活動列(含不得有空容器)
  try {
    const { ctx, pg } = await openPage(browser);
    const ok = await openStationBoard(pg, 'tra_sched', '瑞芳');
    chk(`${engine} C0 瑞芳站看板開得起來`, ok);
    const n = await pg.$$eval('#board .ev-row, #board .ev-rows', ns => ns.length);
    chk(`${engine} C1 無活動的站零活動節點`, n === 0, `找到 ${n} 個`);
    await ctx.close();
  } catch (e) { chk(`${engine} C! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // D. endGuess 兩側 + partner 標記
  try {
    const { ctx, pg } = await openPage(browser);
    await openStationBoard(pg, 'tra_sched', '台東');
    const txt = await pg.$$eval('#board .ev-row', ns => ns.map(n => n.textContent.trim()));
    const guessRow = txt.find(t => t.includes('推定結束活動')) || '';
    const partnerRow = txt.find(t => t.includes('合作活動')) || '';
    chk(`${engine} D1 endGuess 顯示「進行中」`, guessRow.includes('進行中'), guessRow);
    chk(`${engine} D2 endGuess 不顯示精確結束日`, !/\d+\/\d+–\d+\/\d+/.test(guessRow), guessRow);
    chk(`${engine} D3 非 endGuess 顯示日期區間`, /\d+\/\d+/.test(partnerRow), partnerRow);
    chk(`${engine} D4 partner 有可見差別`, partnerRow.includes('合作'), partnerRow);
    await ctx.close();
  } catch (e) { chk(`${engine} D! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // E. 今日亮點:活動節、排序位置、系統級也在
  try {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const secs = await pg.$$eval('#expBody .sec', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} E1 今日亮點有「近期活動」節`, secs.includes('近期活動'), JSON.stringify(secs));
    const titles = await pg.$$eval('#expBody .row[data-ev] b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} E2 系統級活動出現在清單`, titles.includes('系統級活動'), JSON.stringify(titles));
    chk(`${engine} E3 已結束活動不在清單`, !titles.includes('已結束活動'), JSON.stringify(titles));
    // 排序:活動節必須在「今日之最」之前
    const iEv = secs.indexOf('近期活動'), iBest = secs.indexOf('今日之最');
    chk(`${engine} E4 活動節排在今日之最之前`, iEv >= 0 && (iBest < 0 || iEv < iBest), `ev=${iEv} best=${iBest}`);
    await ctx.close();
  } catch (e) { chk(`${engine} E! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // F. 今日亮點點一列 → 真的開了那站的看板(不是只驗命中)
  try {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const sel = '#expBody .row[data-ev="in-window-tra"]';
    const exists = await pg.$(sel);
    chk(`${engine} F0 找得到台鐵活動那一列`, !!exists);
    if (exists) {
      await pg.click(sel);
      await pg.waitForTimeout(600);
      const opened = await pg.evaluate(() => state.boardStation ? state.boardStation.name : null);
      chk(`${engine} F1 點一列後開啟花蓮站看板`, opened === '花蓮', String(opened));
    }
    await ctx.close();
  } catch (e) { chk(`${engine} F! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // G. 空狀態:events 為空陣列
  try {
    const { ctx, pg } = await openPage(browser, { events: { updated: shift(0), events: [] } });
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const secs = await pg.$$eval('#expBody .sec', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} G1 空陣列不產生活動節`, !secs.includes('近期活動'), JSON.stringify(secs));
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const n = await pg.$$eval('#board .ev-row, #board .ev-rows', ns => ns.length);
    chk(`${engine} G2 空陣列時看板零活動節點`, n === 0, `找到 ${n} 個`);
    await ctx.close();
  } catch (e) { chk(`${engine} G! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // H. 資料檔 404 不得壞頁
  try {
    const { ctx, pg } = await openPage(browser, { events: null });
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg); // 404 也會 resolve(見 awaitEvents 上方註解),不會卡 timeout
    // 查 #expBody 必須搶在 openStationBoard 之前:openBoard() 內部會呼叫 closeExplorePanel(),
    // 後者會清空 #expBody(el.innerHTML=''),晚查一步 secs 恆為 0,H1 不管實作對錯都測不出東西。
    const secs = await pg.$$eval('#expBody .sec', ns => ns.length);
    chk(`${engine} H1 404 時今日亮點照常有內容`, secs > 0, `節數 ${secs}`);
    await openStationBoard(pg, 'tra_sched', '花蓮');
    chk(`${engine} H2 404 時無未捕捉錯誤`, pg._errs.length === 0, pg._errs.join(' | '));
    await ctx.close();
  } catch (e) { chk(`${engine} H! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // I. 時區:裝置時鐘設在不同日期,結果不變
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', timezoneId: 'Pacific/Kiritimati' });
    await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    await ctx.route('**/data/events.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
    const pg = await ctx.newPage();
    await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => state && state.ready === true, null, { timeout: 45000 });
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} I1 裝置時區不影響時間窗`, rows.includes('窗內台鐵活動') && !rows.includes('已結束活動'), JSON.stringify(rows));
    await ctx.close();
  } catch (e) { chk(`${engine} I! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // J. 手機四寬(360/375/414/768):活動列不與看板任何其他區塊相交,且真的觸控點得動。
  //    相交對象取「#board 的其他直接子元素」而不是點名 h3/.sub——判準寫「怎麼排」,
  //    看板日後多一個區塊也照樣算得到,不必回頭改測試。
  for (const w of [360, 375, 414, 768]) try {
    const { ctx, pg } = await openPage(browser, { w, h: 812, touch: true });
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const geo = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('#board .ev-row')];
      if (!rows.length) return null;
      const others = [...document.querySelectorAll('#board > *')].filter(n => !n.classList.contains('ev-rows'));
      const hits = [];
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        for (const o of others) {
          const b = o.getBoundingClientRect();
          if (!(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom))
            hits.push((o.className || o.tagName) + '↕' + row.textContent.slice(0, 8));
        }
      }
      return { n: rows.length, hits };
    });
    chk(`${engine} J${w}-1 有活動列`, !!geo, 'null');
    if (geo) chk(`${engine} J${w}-2 不與看板其他區塊相交`, geo.hits.length === 0, geo.hits.join(' , '));
    const opened = await urlOpenedBy(ctx, evRow(pg, '窗內台鐵活動'), { tap: true });
    chk(`${engine} J${w}-3 真的觸控點一次會開到官方原文`, opened === evOf('in-window-tra').url, String(opened));
    await ctx.close();
  } catch (e) { chk(`${engine} J${w}! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // L. 跨系統同名站(捷運分頁):兩則活動站名一模一樣、只有 anchor.sys 不同 ⇒ name 比對擋不掉,
  //    sys 比對真的會被執行到。兩側都驗:對的那家看得到、錯的那家看不到。
  try {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'metro')));
    // 等到「台中那顆市政府真的在 state.lines 裡」為止:只等 lines.length>0 會在 tmrt 資料還沒到時
    // 就往下跑,量到的「中捷活動不出現」是資料沒載完,不是系統歸屬判對了(環境條件偽裝成通過)
    await pg.waitForFunction(([split]) => state.mode === 'freq' &&
      (state.lines || []).some(l => (l.stations || []).some(s => s.name === '市政府' && s.lat < split)) &&
      (state.lines || []).some(l => (l.stations || []).some(s => s.name === '市政府' && s.lat > split)),
      [CITYHALL_LAT_SPLIT], { timeout: 30000 });
    const okT = await openStationBoard(pg, 'mrt', '市政府', { latMin: CITYHALL_LAT_SPLIT });
    chk(`${engine} L0 台北的市政府站看板開得起來`, okT);
    const tpe = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} L1 北捷市政府活動出現在台北的市政府`, tpe.includes('北捷市政府活動'), JSON.stringify(tpe));
    chk(`${engine} L2 中捷市政府活動不出現在台北的市政府`, !tpe.includes('中捷市政府活動'), JSON.stringify(tpe));
    const okC = await openStationBoard(pg, 'tmrt', '市政府', { latMax: CITYHALL_LAT_SPLIT });
    chk(`${engine} L3 台中的市政府站看板開得起來`, okC);
    const tch = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} L4 中捷市政府活動出現在台中的市政府`, tch.includes('中捷市政府活動'), JSON.stringify(tch));
    chk(`${engine} L5 北捷市政府活動不出現在台中的市政府`, !tch.includes('北捷市政府活動'), JSON.stringify(tch));
    // 共構/轉乘的同名站(頂埔:北捷↔三鶯線,同一座站,實測相距 68 公尺)反過來:兩家的活動
    // 都要掛上去,不能因為「站名同、業者不同」就被當成別家的站濾掉——市政府那一對管座標閘門的
    // 上界(收太鬆就把兩個城市串在一起),這一對管下界(收太緊就把共構站拆成兩顆)。
    const okD = await openStationBoard(pg, 'mrt', '頂埔');
    chk(`${engine} L6 頂埔站看板開得起來`, okD);
    const dp = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} L7 頂埔看得到北捷那則`, dp.includes('北捷頂埔活動'), JSON.stringify(dp));
    chk(`${engine} L8 頂埔也看得到三鶯線那則(共構站不拆成兩顆)`, dp.includes('三鶯線頂埔活動'), JSON.stringify(dp));
    // 今日亮點那一列點下去要飛對城市(緯度是外部地理事實,不問實作拿哪個欄位判的)
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const sel = '#expBody .row[data-ev="cityhall-tmrt"]';
    chk(`${engine} L9 今日亮點找得到中捷市政府那一列`, !!(await pg.$(sel)));
    if (await pg.$(sel)) {
      await pg.click(sel);
      await pg.waitForTimeout(600);
      const lat = await pg.evaluate(() => state.boardStation ? state.boardStation.lat : null);
      chk(`${engine} L10 點中捷那則飛到台中的市政府`, lat != null && lat < CITYHALL_LAT_SPLIT,
        `lat=${lat}(台北 ${CITYHALL_TPE_LAT} / 台中 ${CITYHALL_TCH_LAT})`);
    }
    await ctx.close();
  } catch (e) { chk(`${engine} L! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // N. 全台同框裝飾層(sys === 'deco'):設計書驗收條件 #2 的第三條 render 路徑,三者缺一不算過。
  //    開站預設就是「全台同框」群組(boot 的 bootGroup),故直接驗;順帶在 deco 上再驗一次跨系統分家。
  try {
    const { ctx, pg } = await openPage(browser);
    const deco = await pg.evaluate(() => state.deco === true && (state.decoLines || []).length > 0);
    chk(`${engine} N0 全台同框的裝飾捷運層在場`, deco);
    const ok = await openStationBoard(pg, 'mrt', '大安森林公園');
    chk(`${engine} N1 裝飾層捷運站走 deco 看板路徑`,
      ok && await pg.evaluate(() => state.boardStation && state.boardStation.sys === 'deco'),
      String(await pg.evaluate(() => state.boardStation && state.boardStation.sys)));
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} N2 捷運活動出現在裝飾層看板`, rows.includes('窗內捷運活動'), JSON.stringify(rows));
    chk(`${engine} N3 台鐵活動不出現在裝飾層捷運站`, !rows.includes('窗內台鐵活動'), JSON.stringify(rows));
    await openStationBoard(pg, 'mrt', '市政府', { latMin: CITYHALL_LAT_SPLIT });
    const tpe = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} N4 裝飾層台北的市政府有北捷那則`, tpe.includes('北捷市政府活動'), JSON.stringify(tpe));
    chk(`${engine} N5 裝飾層台北的市政府沒有中捷那則`, !tpe.includes('中捷市政府活動'), JSON.stringify(tpe));
    // eventStation() 的裝飾層分支也要挑對業者那一顆(與 L10 同一件事,但走的是另一條 render 路徑)
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const sel = '#expBody .row[data-ev="cityhall-tmrt"]';
    chk(`${engine} N6 今日亮點找得到中捷市政府那一列`, !!(await pg.$(sel)));
    if (await pg.$(sel)) {
      await pg.click(sel);
      await pg.waitForTimeout(600);
      const lat = await pg.evaluate(() => state.boardStation ? state.boardStation.lat : null);
      chk(`${engine} N7 裝飾層點中捷那則飛到台中的市政府`, lat != null && lat < CITYHALL_LAT_SPLIT,
        `lat=${lat}(台北 ${CITYHALL_TPE_LAT} / 台中 ${CITYHALL_TCH_LAT})`);
    }
    await ctx.close();
  } catch (e) { chk(`${engine} N! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // M. 壞日期格式:一筆壞掉不得把整份清單一起拖垮(evDayShift 對非 ISO 輸入會拋 RangeError,
  //    在 activeEvents 的 filter 裡拋 ⇒ 看板與今日亮點一起空掉)。start/end 兩側各掃 BAD_DAYS 全部寫法。
  try {
    const { ctx, pg } = await openPage(browser, { events: BAD_DAY_FIXTURE });
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    // 查 #expBody 必須搶在 openStationBoard 之前(openBoard 會關掉今日亮點並清空 #expBody)
    const secs = await pg.$$eval('#expBody .sec', ns => ns.map(n => n.textContent.trim()));
    const titles = await pg.$$eval('#expBody .row[data-ev] b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} M1 今日亮點仍有近期活動節`, secs.includes('近期活動'), JSON.stringify(secs));
    chk(`${engine} M2 今日亮點只留下格式正確的那一筆`,
      JSON.stringify(titles) === JSON.stringify(['好日期活動']), JSON.stringify(titles));
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} M3 看板只留下格式正確的那一筆`,
      JSON.stringify(rows) === JSON.stringify(['好日期活動']), JSON.stringify(rows));
    chk(`${engine} M4 壞日期不產生未捕捉錯誤`, pg._errs.length === 0, pg._errs.join(' | '));
    await ctx.close();
  } catch (e) { chk(`${engine} M! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }

  // K. 今日亮點點系統級活動(anchor.kind:'system' ⇒ eventStation() 依定義恆回 null,不受哪個分頁載入影響)
  //    → 解析不到站的 else 分支:不切分頁、不開站看板、不關今日亮點面板,只呼叫 window.open。
  //    不用 in-window-metro(大安森林公園)當「解析不到」樣本:sched 模式下 eventStation 還會掃裝飾層,
  //    全台同框開著時它可能真的解析得到,不是可靠的陰性樣本。
  try {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    // window.open 換成記錄呼叫的替身,回傳 null 模擬被瀏覽器擋掉,避免真的開新分頁
    await pg.evaluate(() => { window.__openCalls = []; window.open = (...a) => { window.__openCalls.push(a); return null; }; });
    const before = await pg.evaluate(() => ({
      group: state.group,
      board: state.boardStation ? state.boardStation.name : null,
      panelOpen: !document.getElementById('explorePanel').hidden,
    }));
    const sel = '#expBody .row[data-ev="sys-level"]';
    const exists = await pg.$(sel);
    chk(`${engine} K0 找得到系統級活動那一列`, !!exists);
    if (exists) {
      await pg.click(sel);
      await pg.waitForTimeout(300);
      const after = await pg.evaluate(() => ({
        group: state.group,
        board: state.boardStation ? state.boardStation.name : null,
        panelOpen: !document.getElementById('explorePanel').hidden,
        opens: window.__openCalls,
      }));
      chk(`${engine} K1 沒有切分頁`, after.group === before.group, `before=${before.group} after=${after.group}`);
      chk(`${engine} K2 沒有開站看板`, after.board === before.board, `before=${before.board} after=${after.board}`);
      chk(`${engine} K3 今日亮點面板仍開著`, after.panelOpen === before.panelOpen, `before=${before.panelOpen} after=${after.panelOpen}`);
      chk(`${engine} K4 window.open 被呼叫且網址正確`,
        after.opens.length >= 1 && after.opens[0][0] === evOf('sys-level').url, JSON.stringify(after.opens));
    }
    // 同一個分支的反面:解析不到站、原文又不是 http(s) ⇒ 這一列什麼都做不了,就不該裝成可以點。
    // K4 是它的正向對照(同一條 else 分支,好網址真的會 window.open),兩者一起才證得出白名單有牙。
    const badRow = await pg.evaluate(() => {
      const n = [...document.querySelectorAll('#expBody .row')].find(x => x.textContent.includes('惡意系統活動'));
      return n ? { hasEv: n.hasAttribute('data-ev') } : null;
    });
    chk(`${engine} K5 惡意連結的系統級活動仍列在清單上`, !!badRow, 'null');
    if (badRow) {
      chk(`${engine} K6 那一列不掛可點屬性(data-ev)`, badRow.hasEv === false, `hasEv=${badRow.hasEv}`);
      const opensBefore = await pg.evaluate(() => window.__openCalls.length);
      await pg.locator('#expBody .row', { hasText: '惡意系統活動' }).click({ timeout: 5000 }).catch(() => {});
      await pg.waitForTimeout(300);
      const after2 = await pg.evaluate(() => ({ opens: window.__openCalls.length, pwned: window.__pwned }));
      chk(`${engine} K7 點它不 window.open 也不執行 javascript:`,
        after2.opens === opensBefore && after2.pwned === undefined, `before=${opensBefore} ${JSON.stringify(after2)}`);
    }
    await ctx.close();
  } catch (e) { chk(`${engine} K! 這一節整節跑完不拋例外`, false, String((e && e.message) || e).split('\n')[0].slice(0, 160)); }
}

const cr = await chromium.launch();
await run(cr, 'chromium');
await cr.close();
const wk = await webkit.launch();
await run(wk, 'webkit');
await wk.close();

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (fail) { console.log('失敗項：' + bad.join('、')); process.exit(1); }
