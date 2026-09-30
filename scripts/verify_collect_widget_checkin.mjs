#!/usr/bin/env node
// 驗「車站收集」桌面小工具的蓋章鈕（railisland://checkin → waitOpen 事件 { view: 'checkin' }）在網頁端的行為。
//
// 規格（單座直接蓋、好幾座停在清單、一座都不到走既有距離提示、定位判定／距離／一天一次沿用單站打卡）：
// 判準的重心是「定位保鮮」——開 App 當下的位置（快取、系統吐的舊點、精度還沒收斂的點）都不能拿來蓋章，
// 只認處理事件那一刻之後、精度夠的新定位。期望值一律手寫（座標、站名、收集鍵、toast 字串取自 geojson 與頁面文案的字面），
// 不呼叫頁面自己的判定函式來算答案。
//
// 用法：node scripts/verify_collect_widget_checkin.mjs [驗哪個目錄，預設＝這個 repo 根目錄]
//   ENGINE=chromium|webkit（預設 chromium，無視窗）。突變測試把 index.html 複製到別處改，再用第一個參數指過去。
//
// 替身：Capacitor（原生殼）＋RailMetroWait（addListener 收 waitOpen）＋RAIL_NATIVE_GEOLOCATION（watchPosition 記下 callback，
// 由 window.__geo.emit 送定位：ts 可指定「幾毫秒前」「秒單位」「沒有時間戳」）。context 釘 zh-TW／Asia/Taipei，起跑前避開台北午夜。
//
// 判準：
//   G0  第一道 gate：印出目標路徑＋index.html md5，並確認伺服器吐的就是那份
//   C1  範圍內只有一座（香山）→ 直接蓋、跳「蓋章成功」、章的內容（鍵／次數／日期／非低信心）
//   C2  範圍內好幾座（臺北：台鐵＋高鐵＋北捷）→ 不蓋、停在清單；首次說明卡讓位（hidden、旗標仍 null）；
//       真的滑鼠點清單上的鈕 → 那一座被蓋（量狀態改變）；點擊前先證明點得到（命中自己）
//   C3  候選層替換成兩筆同鍵 → 去重後剛好一座 → 直接蓋（拿掉 checkinKey 去重就會停在清單）
//   C4  一座都不到 → 不蓋、toast 講最近那座還差幾公尺
//   C5  精度不足：先送精度 250 m 的點 → 不判定、繼續等；再送精度 30 m → 才蓋；一直等不到 → 15 秒後停手、留在清單
//   C6  舊定位陷阱：(甲) 開卡時的快取位置在 A 站範圍內，新定位在 B 站 → 只蓋 B；
//       (乙) 舊時間戳與沒有時間戳的點先到（精度夠、在 A 站）→ 不蓋，之後的新點在 B 站 → 只蓋 B；
//       (丙) iOS 可能給秒：新鮮的秒單位點算新、舊的秒單位點不算
//   C7  同一天第二次 → 「今天已經蓋過章了」，次數不增加
//   C8  停在高鐵／捷運分頁時，在台鐵站範圍內按蓋章 → 蓋到那一座台鐵站（候選不受目前分頁影響）
//   C9  沒有定位權限（有／沒有快取位置）→ 走既有的失敗說明，不蓋
//   C10 等待中使用者自己點了站／關掉卡片 → 取消自動蓋章（之後的新定位不會替他蓋）
//   C11 護照深連結 { view: 'passport' } 同樣讓首次說明卡讓位，旗標仍 null
//   C12 停在高鐵／捷運分頁時從小工具蓋章：那一次照樣切到全台，但「上次視野記憶」逐字不變（不改成全台、不改成蓋章時的地圖中心）；
//       真的重開一次：分頁回到原本那頁、地圖落在蓋章留下的定位快取；人自己真的點了頁籤才恢復記錄；本來就在全台的人記錄照舊；
//       沒有蓋章、單純開機（有定位快取＋上次停在高鐵）也一樣：開在高鐵、地圖在定位點
//   C13 原生字串目錄（iOS Localizable.xcstrings、Android RailNativeL10n.json）的「蓋章」：繁中 key、英文 Stamp、日文 スタンプ
//   C14 護照車站牆：台北與台中兩枚「市政府」三語都分得出城市（字與 title），3 個一般站＋1 個共構站的名字不變
//   C15 通行證（pass）、鐵路站看板（station）、捷運等車卡（沒有 view）三種深連結，桌面與手機都讓首次說明卡讓位：
//       說明卡收起來、旗標仍是 null、面板真的開了且中心點命中面板自己、看板開的是事件指名的那一站
//   C16 說明中心「車站收集小工具」一節（三語 × Android／iOS）：Android 有「範圍預設全台、之後長按小工具重新設定」那一步、iOS 有「編輯小工具」那一步、
//       兩個平台都有蓋章鈕那一步（逐字、不寫位置）；英文沒有漏翻、日文是日文、沒有水平捲動
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..'));
const ENGINE = (process.env.ENGINE || 'chromium').toLowerCase();
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p: !!p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const md5 = buf => createHash('md5').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── G0：驗哪個目錄 ─────────────────────────────────────────────────────────
console.log(`[G0] ROOT=${ROOT}`);
if (!existsSync(path.join(ROOT, 'index.html'))) { console.log('目標目錄沒有 index.html，停手'); process.exit(1); }
const DISK_MD5 = md5(readFileSync(path.join(ROOT, 'index.html')));
console.log(`[G0] index.html md5=${DISK_MD5}`);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
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
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
const BASE = `http://127.0.0.1:${server.address().port}/`;
{
  const served = md5(Buffer.from(await (await fetch(BASE + 'index.html')).arrayBuffer()));
  ok('G0 伺服器吐的 index.html ＝ 目標目錄那份', served === DISK_MD5, `${served.slice(0, 8)} vs ${DISK_MD5.slice(0, 8)}`);
  if (served !== DISK_MD5) { console.log('\n驗錯目標，停手'); process.exit(1); }
}

// ── 手寫的期望值（座標取自 data/track_stations.geojson；鄰站距離已量過：香山最近的別站 3.0 km、崎頂 4.2 km、紅樹林在北捷只有一座）──
const XS = { name: '香山', lat: 24.762919, lon: 120.91407, key: 'tra_sched|香山' };   // 台鐵
const QD = { name: '崎頂', lat: 24.723075, lon: 120.87174, key: 'tra_sched|崎頂' };   // 台鐵（離香山約 6 km）
const TP = { lat: 25.047931, lon: 121.517005 };                                     // 臺北：台鐵臺北、高鐵台北（29 m）、北捷台北車站（185 m）都在範圍內
const HSL = { name: '紅樹林', lat: 25.15399, lon: 121.4588, key: 'metro|紅樹林' };    // 北捷
const FAR = { lat: 24.767442, lon: 120.91407 };                                     // 香山正北 500 m
const todayTaipei = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
async function guardMidnight() { // 「今天」以台北為準；離午夜不到 45 秒就先等過去
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const left = 86400 - (+p.hour * 3600 + +p.minute * 60 + +p.second);
  if (left < 45) { console.log(`[guard] 距台北午夜 ${left} 秒，等過去`); await sleep((left + 2) * 1000); }
}

// ── 瀏覽器端 ──────────────────────────────────────────────────────────────
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch(ENGINE === 'webkit' ? { headless: true } : { channel: 'chrome', headless: true });
const pageErrors = [];
// howto：'seen'＝已看過（旗標寫 1）、'unseen'＝沒看過（旗標不寫，首次說明卡會在開機時跳出來）。
// deny：開機前就讓定位替身回「權限被拒」（開機時的第一次 watch 就失敗，之後每次重試也失敗）。
async function open({ tag, seed = {}, howto = 'seen', mobile = false, mobileWidth = 375, deny = false, platform = null }) {
  await guardMidnight();
  const ctx = await browser.newContext({ ...(mobile ? { viewport: { width: mobileWidth, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }), locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(({ seed, howto, deny, platform }) => {
    if (howto === 'seen') { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} }
    if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }
    const listeners = window.__mwListeners = {};
    window.__mwFire = (name, evt) => (listeners[name] || []).forEach(fn => fn(evt));
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform || 'ios', Plugins: {} };
    window.RAIL_NATIVE_COLLECTION = { sync() { return Promise.resolve(); } };
    window.Capacitor.Plugins.RailMetroWait = {
      start: async () => ({ ok: true }), stop: async () => ({ ok: true }), status: async () => ({ active: false }), setPlus: async () => ({}),
      addListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return { remove() {} }; },
    };
    if (platform) window.Capacitor.Plugins.RailWidget = { pinSupported: async () => ({ supported: true }), pin: async () => ({ requested: true }) };
    // 定位替身：watchPosition 記下 callback；emit(lat, lon, acc, spec) 送一筆。spec：{ ago } 幾毫秒前算出的、{ sec } 時間戳給秒、{ none } 沒有時間戳。
    const geo = window.__geo = { cb: null, deny, calls: 0 };
    geo.emit = (lat, lon, acc, spec) => {
      let ts = Date.now();
      if (spec && spec.ago != null) ts -= spec.ago;
      if (spec && spec.sec) ts = Math.floor(ts / 1000);
      if (spec && spec.none) ts = undefined;
      return geo.cb && geo.cb({ coords: { latitude: lat, longitude: lon, accuracy: acc }, timestamp: ts }, null);
    };
    window.RAIL_NATIVE_GEOLOCATION = {
      requestPermissions: async () => 'granted', checkPermissions: async () => 'granted',
      getCurrentPosition: async () => { throw { code: 2, message: 'stub' }; },
      watchPosition: (opts, cb) => { geo.cb = cb; geo.calls++; if (geo.deny) setTimeout(() => cb(null, { code: 1, message: 'User denied Geolocation' }), 0); return 'w' + geo.calls; },
      clearWatch: () => {}, openSettings: null,
    };
    // 記下所有 toast（畫面上的 toast 幾秒就消失，事後讀不到）
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('toasts'); if (!el) return;
      new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) { const s = (n.textContent || '').trim(); if (s) window.__toasts.push(s); } })
        .observe(el, { childList: true }); // 每則 toast 是 #toasts 底下新增的一個 div.toast（innerHTML＝訊息）
    });
  }, { seed, howto, deny, platform });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(`[${tag}] ${e}`));
  await page.goto(BASE + '?gltracks=0');
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000, polling: 50 });
  const L = await page.evaluate(() => (window.__mwListeners.waitOpen || []).length);
  if (L !== 1) ok(`${tag} 前提：waitOpen listener 接在外掛替身上`, false, `${L} 個`);
  return { ctx, page };
}
// 送 checkin 深連結，等到流程真的開始（閘門之後的處理時刻＝t0）才回來——之後送的定位時間戳才會 ≥ t0
async function fireCheckin(page, view = 'checkin', wait = true) {
  await page.evaluate(v => window.__mwFire('waitOpen', { view: v }), view);
  if (view === 'checkin' && wait) await page.waitForFunction(() => { try { return !!state._wcWait; } catch (e) { return false; } }, null, { timeout: 20000, polling: 50 });
}
const fix = (page, p, acc, spec) => page.evaluate(([lat, lon, a, s]) => window.__geo.emit(lat, lon, a, s), [p.lat, p.lon, acc, spec || null]);
const stamps = page => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('trainmap-checkins-v1') || 'null') || {}).st || {}; } catch (e) { return null; } });
const toasts = page => page.evaluate(() => window.__toasts.slice());
const flag = page => page.evaluate(() => localStorage.getItem('trainmap-howto-seen'));
const waiting = page => page.evaluate(() => !!state._wcWait);
const cardVisible = page => page.evaluate(() => { const c = document.getElementById('nearCard'); return !!c && !c.hidden && c.innerHTML.length > 0; });
const keysOf = o => Object.keys(o || {}).sort().join(',');
async function waitStamp(page, key, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await stamps(page))[key]) return true; await sleep(80); }
  return false;
}
const lastView = page => page.evaluate(() => localStorage.getItem('trainmap-last-view'));
const mapCenter = page => page.evaluate(() => { const c = M.getCenter(); return { lat: c.lat, lon: c.lng }; });
const groupNow = page => page.evaluate(() => state.group);
// 真滑鼠在地圖上拖一下，回傳「這一拖真的拖動了地圖」（沒拖動就是拖到別的東西，後面的判準沒意義）：
// dragstart 要發（只有真的手動拖曳才會發，程式化的 setView／flyTo 不會），而且地圖中心真的變了。
// 只看中心變了不夠：蓋章之後地圖自己的動畫也會讓中心變，滑鼠就算被透明蓋板擋住、根本沒拖到地圖，這一項照樣綠
// （突變測試抓到的：擋住滑鼠，舊寫法沒紅）——那時「上次視野沒被改寫」就可能是零資訊。
async function dragMap(page, dx = 70, dy = 25) {
  await page.evaluate(() => { if (!window.__dragstarts) { window.__dragstarts = { n: 0 }; M.on('dragstart', () => { window.__dragstarts.n++; }); } });
  const n0 = await page.evaluate(() => window.__dragstarts.n);
  const at = await page.evaluate(() => { const r = M.getContainer().getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const a = await mapCenter(page);
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + dx, at.y + dy, { steps: 6 }); await page.mouse.up();
  // 放手之後 MapLibre 還會慣性滑行一小段（實測 400 到 500 毫秒）才發 moveend、上次視野記錄才追上目前中心：
  // 等地圖中心連續 300 毫秒不動（最多 5 秒）再量。不能用固定秒數——固定 500 毫秒在 webkit 全跑時量到滑行途中
  // （中心已經動了、記錄還停在上一次 moveend），紅過一次。moveend 的寫入是同步的，最後多留一拍給事件派發。
  let prev = await mapCenter(page), still = 0;
  for (let i = 0; i < 50 && still < 3; i++) {
    await sleep(100);
    const cur = await mapCenter(page);
    still = Math.abs(cur.lat - prev.lat) + Math.abs(cur.lon - prev.lon) < 1e-9 ? still + 1 : 0;
    prev = cur;
  }
  await sleep(100);
  const b = await mapCenter(page);
  const n1 = await page.evaluate(() => window.__dragstarts.n);
  return n1 > n0 && Math.abs(b.lat - a.lat) + Math.abs(b.lon - a.lon) > 1e-4;
}
// 真滑鼠點頁籤列（桌面 #systems）上寫著 text 的那顆；先證明點得到（命中自己、沒停用）
async function clickGroupTab(page, text, tag) {
  const r = await page.evaluate(t => {
    const b = [...document.querySelectorAll('#systems .gtab')].find(x => x.textContent === t);
    if (!b) return null;
    const q = b.getBoundingClientRect(), x = q.x + q.width / 2, y = q.y + q.height / 2, e = document.elementFromPoint(x, y);
    return { x, y, hit: !!e && (e === b || b.contains(e)) && !b.disabled };
  }, text);
  ok(`${tag} 前提：「${text}」頁籤在畫面上、可點、點下去命中的就是它`, !!r && r.hit, r ? `(${Math.round(r.x)},${Math.round(r.y)})` : '找不到');
  if (r) await page.mouse.click(r.x, r.y);
  await sleep(400);
}

// ── C1 單座直接蓋 ＋ C7 同一天第二次 ─────────────────────────────────────────
{
  const { ctx, page } = await open({ tag: 'C1' });
  ok('C1 前提：一開始沒有任何章', keysOf(await stamps(page)) === '');
  await fireCheckin(page);
  ok('C1 流程開始後、還沒有新定位之前，不蓋章', keysOf(await stamps(page)) === '');
  await fix(page, XS, 30);
  const hit = await waitStamp(page, XS.key);
  const st = await stamps(page);
  ok('C1 香山範圍內只有一座 → 只蓋香山（鍵 tra_sched|香山）', hit && keysOf(st) === XS.key, keysOf(st));
  const e = st[XS.key] || {};
  ok('C1 章的內容：次數 1、日期＝今天（台北）、狀態 visit、精度 30 m 不標低信心', e.n === 1 && e.d === todayTaipei() && e.s === 'visit' && e.lo === undefined, JSON.stringify(e));
  ok('C1 跳出「蓋章成功 · 香山」', (await toasts(page)).some(x => x === '蓋章成功 · 香山'), JSON.stringify((await toasts(page)).slice(-3)));
  ok('C1 蓋完之後不再等（不會被下一筆定位重複觸發）', !(await waiting(page)));
  await fix(page, XS, 30);
  await sleep(500);
  ok('C1 流程結束後再來一筆新定位，次數仍是 1', (await stamps(page))[XS.key]?.n === 1);
  // C7 同一天第二次
  const before = (await toasts(page)).length;
  await fireCheckin(page);
  await fix(page, XS, 30);
  await sleep(900);
  const t7 = (await toasts(page)).slice(before);
  ok('C7 同一天第二次 → 「今天已經蓋過章了」', t7.some(x => x === '「香山」今天已經蓋過章了'), JSON.stringify(t7));
  ok('C7 次數不增加（仍是 1）、沒有第二則「蓋章成功」', (await stamps(page))[XS.key]?.n === 1 && !t7.some(x => x.startsWith('蓋章成功')));
  await ctx.close();
}

// ── C2 好幾座停在清單 ＋ 首次說明卡讓位 ＋ 真滑鼠點擊 ────────────────────────────
async function multiAndHowto(tag, mobile, mobileWidth = 375) {
  const { ctx, page } = await open({ tag, howto: 'unseen', mobile, mobileWidth });
  const pre = await page.evaluate(() => { const w = document.getElementById('howtoWrap'); return { shown: !!w && !w.hidden, flag: localStorage.getItem('trainmap-howto-seen') }; });
  ok(`${tag} 前提：首次說明卡在開機時跳出來、已讀旗標是 null（不然讓位測不出差別）`, pre.shown && pre.flag === null, JSON.stringify(pre));
  await fireCheckin(page);
  const y = await page.evaluate(() => ({ hidden: document.getElementById('howtoWrap').hidden, flag: localStorage.getItem('trainmap-howto-seen') }));
  ok(`${tag} checkin 深連結 → 首次說明卡收起來（hidden）且已讀旗標仍是 null（沒有替使用者記成已讀）`, y.hidden === true && y.flag === null, JSON.stringify(y));
  await fix(page, TP, 30);
  await sleep(1200);
  ok(`${tag} 臺北範圍內好幾座 → 不蓋章`, keysOf(await stamps(page)) === '', keysOf(await stamps(page)));
  ok(`${tag} 停在附近車站清單（卡片開著）`, await cardVisible(page));
  const rows = await page.evaluate(() => [...document.querySelectorAll('#nearCard .nx-ck')].map(b => b.dataset.st));
  ok(`${tag} 清單上有台鐵臺北與高鐵台北兩顆蓋章鈕`, rows.includes('tra_sched|臺北') && rows.includes('thsr_sched|台北'), rows.join(' / '));
  ok(`${tag} 沒有「蓋章成功」toast`, !(await toasts(page)).some(x => x.startsWith('蓋章成功')));
  // 真滑鼠：先證明點得到（命中自己），再點，量狀態改變
  const sel = '#nearCard .nx-ck[data-st="thsr_sched|台北"]';
  // 鈕不存在或捲不進畫面（Playwright 預設會等 30 秒才逾時、整支腳本崩潰）：兩步各等 10 秒（機器忙時頁面主執行緒會卡住、太短會假紅），
  // 逾時記成這一條紅，其餘區塊照跑、總表照印
  let box = null, boxWhy = '';
  try { await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 10000 }); box = await page.locator(sel).boundingBox({ timeout: 10000 }); } catch (e) { boxWhy = String(e.message || e).split('\n')[0].slice(0, 120); }
  ok(`${tag} 前提：那顆鈕捲得進畫面、有位置可點（逾時或量不到位置＝紅，腳本不崩潰）`, !!box, boxWhy);
  if (!box) { await ctx.close(); return; }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const hitSelf = await page.evaluate(([x, yy, s]) => { const e = document.elementFromPoint(x, yy), b = document.querySelector(s); return !!(e && b && (e === b || b.contains(e))) && !b.disabled; }, [cx, cy, sel]);
  ok(`${tag} 前提：那顆鈕在畫面上、可點、點下去命中的就是它（沒被說明卡蓋住）`, hitSelf, `(${Math.round(cx)},${Math.round(cy)})`);
  if (mobile) await page.tap(sel); else await page.mouse.click(cx, cy);
  const clicked = await waitStamp(page, 'thsr_sched|台北');
  const after = await stamps(page);
  ok(`${tag} 真滑鼠點鈕 → 高鐵台北被蓋（次數 1、今天），其他站沒被蓋`, clicked && keysOf(after) === 'thsr_sched|台北' && after['thsr_sched|台北'].n === 1 && after['thsr_sched|台北'].d === todayTaipei(), keysOf(after));
  const btn = await page.evaluate(s => { const b = document.querySelector(s); return b ? { cls: b.className, dis: b.disabled, txt: b.textContent } : null; }, sel);
  ok(`${tag} 點擊造成畫面變化：那顆鈕變成「今天已蓋 ✓」且停用`, !!btn && /done/.test(btn.cls) && btn.dis && btn.txt.includes('今天已蓋'), JSON.stringify(btn));
  ok(`${tag} 整段流程之後已讀旗標仍是 null`, (await flag(page)) === null);
  await ctx.close();
}
await multiAndHowto('C2 桌面 1280', false);
for (const width of [360, 375, 390, 414, 520, 768]) await multiAndHowto(`C2 手機 ${width} 真觸控`, true, width);

// ── C3 去重（替換候選層，塞兩筆同鍵）────────────────────────────────────────
{
  const { ctx, page } = await open({ tag: 'C3' });
  const prem = await page.evaluate(([h]) => {
    window.nearbyStationCandidates = () => [
      { st: { name: h.name, lat: h.lat, lon: h.lon, sys: 'freq', _i18nSys: 'mrt' }, label: '北捷' },
      { st: { name: h.name, lat: h.lat, lon: h.lon, sys: 'deco', _i18nSys: 'ntdlrt' }, label: '淡海' },
    ];
    return nearbyStationCandidates().map(c => checkinKey(c.st));
  }, [HSL]);
  ok('C3 前提：替換後的候選有兩筆、收集鍵都是 metro|紅樹林（不然去重測不出差別）', prem.length === 2 && prem.every(k => k === HSL.key), prem.join(' / '));
  await fireCheckin(page);
  await fix(page, HSL, 30);
  const hit = await waitStamp(page, HSL.key);
  const st = await stamps(page);
  ok('C3 兩筆同鍵候選 → 去重後剛好一座 → 直接蓋（不是停在清單）', hit && keysOf(st) === HSL.key && st[HSL.key].n === 1, keysOf(st));
  await ctx.close();
}

// ── C4 一座都不到 ─────────────────────────────────────────────────────────
{
  const { ctx, page } = await open({ tag: 'C4' });
  await fireCheckin(page);
  await fix(page, FAR, 30);
  await sleep(1200);
  const t = await toasts(page);
  const m = t.map(x => /^離「香山」還有 (\d+) 公尺，走近一點再蓋（這站的範圍 \d+ 公尺）$/.exec(x)).find(Boolean);
  // 台鐵站的距離量到「月台線段」（資料層有月台幾何），不是站點座標，所以只能斷言落在合理區間：
  // 比範圍加精度（約 150 m）遠、不超過到站點的 500 m。
  ok('C4 香山正北 500 m → toast 講最近的是香山、還差 150–510 公尺', !!m && +m[1] > 150 && +m[1] <= 510, JSON.stringify(t.slice(-2)));
  ok('C4 不蓋章', keysOf(await stamps(page)) === '');
  await ctx.close();
}

// ── C5 精度 ───────────────────────────────────────────────────────────────
{
  const { ctx, page } = await open({ tag: 'C5' });
  await fireCheckin(page);
  await fix(page, XS, 250);
  await sleep(1500);
  ok('C5 精度 250 m 的新定位 → 不判定、不蓋章', keysOf(await stamps(page)) === '');
  ok('C5 仍在等（沒有因為收到一筆不夠準的點就放棄）', await waiting(page));
  await fix(page, XS, 30);
  ok('C5 之後精度 30 m 的新定位 → 蓋香山', await waitStamp(page, XS.key));
  await ctx.close();
}
{
  const { ctx, page } = await open({ tag: 'C5 逾時' });
  await fireCheckin(page);
  await fix(page, XS, 250);
  await sleep(15600);
  ok('C5 一直只有不夠準的點：15 秒後停手（不再等）、沒有蓋章', !(await waiting(page)) && keysOf(await stamps(page)) === '');
  ok('C5 等不到就改成讓使用者選：清單留在畫面上', await cardVisible(page));
  await fix(page, XS, 30);
  await sleep(700);
  ok('C5 停手之後才來的準點不會替使用者自動蓋', keysOf(await stamps(page)) === '');
  await ctx.close();
}

// ── C6 舊定位陷阱 ─────────────────────────────────────────────────────────
{
  // 甲：開卡時的快取位置在香山範圍內，新定位在崎頂
  const cache = JSON.stringify({ lat: XS.lat, lon: XS.lon, acc: 30, t: Date.now() });
  const { ctx, page } = await open({ tag: 'C6甲', seed: { 'trainmap-last-geo': cache } });
  await fireCheckin(page);
  await sleep(700);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#nearCard .nx-ck')].map(b => b.dataset.st));
  ok('C6甲 前提：開卡時清單是用快取位置畫的（香山那一列在）', rows.includes(XS.key), rows.slice(0, 4).join(' / '));
  ok('C6甲 沒有新定位之前不蓋章（不拿開卡當下的位置直接判）', keysOf(await stamps(page)) === '');
  await fix(page, QD, 30);
  const hit = await waitStamp(page, QD.key);
  const st = await stamps(page);
  ok('C6甲 新定位在崎頂 → 只蓋崎頂，香山沒被蓋', hit && keysOf(st) === QD.key, keysOf(st));
  await ctx.close();
}
{
  // 乙：舊時間戳、沒有時間戳的點先到（精度夠、在香山）
  const { ctx, page } = await open({ tag: 'C6乙' });
  await fireCheckin(page);
  await fix(page, XS, 20, { ago: 120000 });
  await fix(page, XS, 20, { none: true });
  await sleep(1000);
  ok('C6乙 兩分鐘前算出的點、沒有時間戳的點（精度都夠、都在香山）→ 不蓋章', keysOf(await stamps(page)) === '', keysOf(await stamps(page)));
  ok('C6乙 仍在等新定位', await waiting(page));
  await fix(page, QD, 20);
  const hit = await waitStamp(page, QD.key);
  const st = await stamps(page);
  ok('C6乙 之後的新定位在崎頂 → 只蓋崎頂', hit && keysOf(st) === QD.key, keysOf(st));
  await ctx.close();
}
{
  // 丙：iOS 可能把時間戳給成秒
  const { ctx, page } = await open({ tag: 'C6丙' });
  await fireCheckin(page);
  await fix(page, XS, 20, { sec: true, ago: 120000 });
  await sleep(700);
  ok('C6丙 舊的秒單位時間戳（兩分鐘前）→ 不算新', keysOf(await stamps(page)) === '');
  // 秒單位的時間戳會被捨去到整秒（最多比實際早 999 毫秒），所以要算新，得落在處理事件那一刻（t0）之後的下一個整秒：
  // 先等到 t0 後 1.05 秒再送。不等的話，依開始時刻落在秒內的哪裡，約一到兩成的機率會被當成舊點（webkit 全跑時紅過一次）。
  const t0 = await page.evaluate(() => state._wcWait && state._wcWait.t0);
  await sleep(Math.max(0, t0 + 1050 - Date.now()));
  await fix(page, XS, 20, { sec: true });
  ok('C6丙 新鮮的秒單位時間戳 → 算新、蓋香山', await waitStamp(page, XS.key));
  await ctx.close();
}

// ── C8 停在高鐵／捷運分頁 ──────────────────────────────────────────────────
for (const [g, lat, lon] of [['hsr', 24.6, 120.8], ['metro', 25.05, 121.5]]) {
  const { ctx, page } = await open({ tag: `C8 ${g}`, seed: { 'trainmap-last-view': JSON.stringify({ g, lat, lon, z: 10, sel: null }) } });
  const pre = await page.evaluate(() => ({ group: state.group, sys: [...new Set(nearbyStationCandidates().map(c => c.st.sys))].sort().join(',') }));
  ok(`C8 前提：App 開在 ${g} 分頁，且該頁的附近候選裡沒有台鐵站（不然分頁測不出差別）`, pre.group === g && !pre.sys.includes('tra_sched'), JSON.stringify(pre));
  await fireCheckin(page);
  await fix(page, XS, 30);
  const hit = await waitStamp(page, XS.key);
  const st = await stamps(page);
  ok(`C8 停在 ${g} 分頁、人在香山（台鐵）按蓋章 → 蓋到香山`, hit && keysOf(st) === XS.key, keysOf(st));
  ok(`C8 ${g}：頁籤跳到全台同框（候選是全台的那一份）`, (await page.evaluate(() => state.group)) === 'all');
  await ctx.close();
}

// ── C9 沒有定位權限 ───────────────────────────────────────────────────────
for (const [label, seed] of [['沒有快取位置', {}], ['有快取位置', { 'trainmap-last-geo': JSON.stringify({ lat: XS.lat, lon: XS.lon, acc: 30, t: Date.now() }) }]]) {
  const { ctx, page } = await open({ tag: `C9 ${label}`, seed, deny: true });
  await fireCheckin(page, 'checkin', false); // 定位一失敗流程就取消，不能等它「還在等」
  const t0 = Date.now(); let t = [];
  while (Date.now() - t0 < 5000) { t = await toasts(page); if (t.some(x => x.startsWith('無法自動定位'))) break; await sleep(100); }
  ok(`C9 權限被拒（${label}）→ 走既有的失敗說明「無法自動定位…」`, t.some(x => x.startsWith('無法自動定位')), JSON.stringify(t.slice(-2)));
  ok(`C9 權限被拒（${label}）→ 不蓋章`, keysOf(await stamps(page)) === '');
  await ctx.close();
}

// ── C10 等待中使用者自己動手 → 取消自動蓋章 ───────────────────────────────────
{
  const cache = JSON.stringify({ lat: XS.lat, lon: XS.lon, acc: 30, t: Date.now() });
  for (const how of ['點站列', '關掉卡片']) {
    const { ctx, page } = await open({ tag: `C10 ${how}`, seed: { 'trainmap-last-geo': cache } });
    await fireCheckin(page);
    await sleep(600);
    ok(`C10 前提（${how}）：清單開著、還在等新定位`, (await cardVisible(page)) && (await waiting(page)));
    if (how === '點站列') await page.locator('#nearCard .nx-top').first().click();
    else await page.locator('#nearClose').click();
    await sleep(300);
    ok(`C10 ${how} → 不再等（自動蓋章取消）`, !(await waiting(page)));
    await fix(page, XS, 30);
    await sleep(800);
    ok(`C10 ${how} 之後才來的準點不會替使用者自動蓋章`, keysOf(await stamps(page)) === '', keysOf(await stamps(page)));
    await ctx.close();
  }
}

// ── C11 護照深連結同樣讓說明卡讓位 ───────────────────────────────────────────
{
  const { ctx, page } = await open({ tag: 'C11', howto: 'unseen' });
  await fireCheckin(page, 'passport');
  await sleep(1500);
  const r = await page.evaluate(() => ({ hidden: document.getElementById('howtoWrap').hidden, flag: localStorage.getItem('trainmap-howto-seen'), ride: !document.getElementById('ridePanel').hidden }));
  ok('C11 passport 深連結 → 說明卡收起來、旗標仍是 null、護照面板開著', r.hidden === true && r.flag === null && r.ride === true, JSON.stringify(r));
  await ctx.close();
}

// ── C12 從小工具蓋章：那一次照樣切到全台，但「上次視野記憶」不被改寫成全台；人自己點頁籤才恢復記錄 ───────────
// 下次開 App 要回到原本的分頁。記錄的寫入點是地圖 moveend，所以每一格都用真滑鼠拖地圖來觸發它，
// 並先量「拖完地圖真的動了」；沒有這一步，「沒被改寫」是零資訊（沒有任何寫入時機也會相同）。
for (const [g, lat, lon] of [['hsr', 24.6, 120.8], ['metro', 25.05, 121.5]]) {
  const seed = { 'trainmap-last-view': JSON.stringify({ g, lat, lon, z: 10, sel: null }) };
  const { ctx, page } = await open({ tag: `C12 ${g}`, seed });
  await sleep(600); // 開機還原視野的動作安定下來
  const pre = await lastView(page);
  ok(`C12 ${g} 前提：App 開在 ${g} 分頁，已存的上次視野也是 ${g}`, (await groupNow(page)) === g && !!pre && JSON.parse(pre).g === g, String(pre));
  await fireCheckin(page);
  ok(`C12 ${g} 流程開始 → 畫面切到全台（讓人看到蓋章結果）`, (await groupNow(page)) === 'all');
  await fix(page, XS, 30);
  ok(`C12 ${g} 蓋章那一次照樣完成（香山）`, await waitStamp(page, XS.key));
  ok(`C12 ${g} 蓋完畫面在全台`, (await groupNow(page)) === 'all');
  ok(`C12 ${g} 前提：真滑鼠拖地圖，地圖真的動了`, await dragMap(page));
  ok(`C12 ${g} 蓋章與拖地圖之後，上次視野記憶跟蓋章前逐字相同（沒被改成全台、也沒被改成蓋章時的地圖中心）`, (await lastView(page)) === pre, `前 ${pre} ／後 ${await lastView(page)}`);
  // 記憶沒被改寫還不夠：開機時定位快取的優先序若蓋過上次視野，記憶再完整也回不去。所以真的重開一次，量開機後的分頁與地圖中心。
  // 蓋章那一筆定位會留下定位快取（香山），重開時地圖應該落在那裡，分頁則回到蓋章前的那一頁。
  const geoC = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('trainmap-last-geo') || 'null'); } catch (e) { return null; } });
  ok(`C12 ${g} 前提：蓋章留下了定位快取（香山）`, !!geoC && Math.abs(geoC.lat - XS.lat) < 1e-4 && Math.abs(geoC.lon - XS.lon) < 1e-4, JSON.stringify(geoC));
  // 蓋章會讓小工具資料重送，重送要先抓收集站點清單（track_stations.geojson）。換頁打斷這一抓，WebKit 會記一筆 pageerror，
  // 所以等清單抓完、沒有進行中的請求才重開（Z 的零 pageerror 判準不放寬）。
  const geoReady = await page.waitForFunction(() => { try { return !!NATIVE_COLLECTION.geo && NATIVE_COLLECTION.geoP === null; } catch (e) { return false; } }, null, { timeout: 20000, polling: 50 }).then(() => true, () => false);
  ok(`C12 ${g} 前提：重開前收集站點清單已載完（不讓換頁打斷載入）`, geoReady);
  await page.reload();
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000, polling: 50 });
  await sleep(600);
  const rc = await mapCenter(page);
  ok(`C12 ${g} 重開 App → 分頁回到 ${g}（不是蓋章時的全台）`, (await groupNow(page)) === g, await groupNow(page));
  ok(`C12 ${g} 重開 App → 地圖中心在定位快取（香山，誤差 < 0.01 度），不是上次視野的中心`, Math.abs(rc.lat - XS.lat) < 0.01 && Math.abs(rc.lon - XS.lon) < 0.01, JSON.stringify(rc));
  await clickGroupTab(page, '台', `C12 ${g}`);
  ok(`C12 ${g} 人自己點了「台」頁籤 → 分頁真的換過去（tra）`, (await groupNow(page)) === 'tra');
  ok(`C12 ${g} 前提：點完頁籤後再拖一次地圖，地圖真的動了`, await dragMap(page, -50, 30));
  const after = JSON.parse(await lastView(page) || 'null'), c2 = await mapCenter(page);
  ok(`C12 ${g} 恢復正常記錄：上次視野記成 tra、中心跟著目前地圖走（不再凍住）`, !!after && after.g === 'tra' && Math.abs(after.lat - c2.lat) < 2e-5 && Math.abs(after.lon - c2.lon) < 2e-5, JSON.stringify(after));
  await ctx.close();
}
{
  // 本來就停在全台的人：沒有切換、沒有凍結，記錄照舊
  const { ctx, page } = await open({ tag: 'C12 全台' });
  await sleep(600);
  ok('C12 全台 前提：App 開在全台', (await groupNow(page)) === 'all');
  await fireCheckin(page);
  await fix(page, XS, 30);
  ok('C12 全台 蓋章完成（香山）', await waitStamp(page, XS.key));
  ok('C12 全台 前提：真滑鼠拖地圖，地圖真的動了', await dragMap(page));
  const rec = JSON.parse(await lastView(page) || 'null'), c = await mapCenter(page);
  ok('C12 全台 本來就在全台 → 上次視野照常記錄（all、中心＝目前地圖中心）', !!rec && rec.g === 'all' && Math.abs(rec.lat - c.lat) < 2e-5 && Math.abs(rec.lon - c.lon) < 2e-5, JSON.stringify(rec));
  await ctx.close();
}
{
  // 沒有蓋章、單純開機：有定位快取、上次停在高鐵 → 開在高鐵分頁，地圖放在定位快取的位置（不是上次視野的中心）
  const seed = {
    'trainmap-last-view': JSON.stringify({ g: 'hsr', lat: 24.6, lon: 120.8, z: 10, sel: null }),
    'trainmap-last-geo': JSON.stringify({ lat: XS.lat, lon: XS.lon, acc: 30, t: Date.now() }),
  };
  const { ctx, page } = await open({ tag: 'C12 開機', seed });
  await sleep(600);
  const c = await mapCenter(page);
  ok('C12 開機 有定位快取＋上次停在高鐵 → 開在高鐵分頁', (await groupNow(page)) === 'hsr', await groupNow(page));
  ok('C12 開機 地圖中心＝定位快取（香山，誤差 < 0.01 度），不是上次視野的中心', Math.abs(c.lat - XS.lat) < 0.01 && Math.abs(c.lon - XS.lon) < 0.01, JSON.stringify(c));
  await ctx.close();
}

// ── C13 原生字串目錄裡的「蓋章」（原生小工具的蓋章鈕用）──────────────────────────
// 蓋章鈕在 iOS 讀 Localizable.xcstrings（小工具 extension 的字串目錄）、在 Android 讀 RailNativeL10n.json；
// 兩份都由 app/scripts/build_native_localizations.mjs 產生，來源語言是繁中（key 就是繁中原文）。
// 產生器的 native 表把「蓋章」釘死（不靠網站字典碰巧有這個詞）；InfoPlist.xcstrings 只放權限說明，本來就沒有小工具字串，不在此列。
{
  const rd = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
  const xc = rd('app/ios/App/RailBoardWidget/Localizable.xcstrings');
  const an = rd('app/android/app/src/main/assets/RailNativeL10n.json');
  const e = xc.strings['蓋章'];
  ok('C13 iOS 小工具字串目錄：來源語言繁中，且有「蓋章」這個 key', xc.sourceLanguage === 'zh-Hant' && !!e, `sourceLanguage=${xc.sourceLanguage}`);
  ok('C13 iOS 小工具字串目錄：「蓋章」英文是 Stamp', e?.localizations?.en?.stringUnit?.value === 'Stamp', JSON.stringify(e?.localizations?.en));
  ok('C13 iOS 小工具字串目錄：「蓋章」日文是 スタンプ', e?.localizations?.ja?.stringUnit?.value === 'スタンプ', JSON.stringify(e?.localizations?.ja));
  ok('C13 Android RailNativeL10n.json：來源語言繁中（zh-TW），英文「蓋章」是 Stamp', an.sourceLanguage === 'zh-TW' && an.languages?.en?.['蓋章'] === 'Stamp', `${an.sourceLanguage} / ${an.languages?.en?.['蓋章']}`);
  ok('C13 Android RailNativeL10n.json：「蓋章」日文是 スタンプ', an.languages?.ja?.['蓋章'] === 'スタンプ', String(an.languages?.ja?.['蓋章']));
}

// ── C14 護照車站牆：台北與台中的「市政府」兩枚分得出城市；其他站的名字一個字都不變 ──────────────
// 種一本護照：兩枚市政府（收集鍵 metro|市政府＝台北、tmrt|市政府＝台中；用不同次數 ×3／×2 認人，牆上是依次數排序的）＋
// 3 個一般站（台鐵香山、高鐵左營、北捷動物園）＋1 個共構站（台北車站）。牆上每一枚的字（seal）與 title 都要對。
// 期望值手寫：市政府兩枚是規格（繁中「市政府（北捷）」「市政府（中捷）」、英文 Taipei／Taichung City Hall、日文「台北市政府」「市政府（台中）」）；
// 其他站的期望值是這次修改之前，用同一份資料在舊程式上量到的字面，改動之後必須逐字相同。
{
  const CITY = 'metro|市政府', TAICHUNG = 'tmrt|市政府';
  const st = {
    [CITY]: { name: '市政府', sys: 'metro', s: 'visit', n: 3, d: '2026-09-29' },
    [TAICHUNG]: { name: '市政府', sys: 'tmrt', s: 'visit', n: 2, d: '2026-09-29' },
    'tra_sched|香山': { name: '香山', sys: 'tra_sched', s: 'visit', n: 1, d: '2026-09-29' },
    'thsr_sched|左營': { name: '左營', sys: 'thsr_sched', s: 'visit', n: 1, d: '2026-09-29' },
    'metro|動物園': { name: '動物園', sys: 'metro', s: 'visit', n: 1, d: '2026-09-29' },
    'metro|台北車站': { name: '台北車站', sys: 'metro', s: 'visit', n: 1, d: '2026-09-29' },
  };
  const WALL = {
    'zh-TW': { taipei: '市政府（北捷）', taichung: '市政府（中捷）', others: ['香山', '左營', '動物園', '台北車站'] },
    en: { taipei: 'Taipei City Hall', taichung: 'Taichung City Hall', others: ['Xiangshan', 'Zuoying', 'Taipei Zoo', 'Taipei Main Station'] },
    ja: { taipei: '台北市政府', taichung: '市政府（台中）', others: ['香山', '左營', '動物園', '台北駅'] },
  };
  const strip = s => String(s).replace(/\s/g, ''); // 牆上的字依圓內寬度折行、行尾空白會被吃掉，比對時兩邊都去掉空白
  const first = title => String(title).split(/\s*[・·]\s*/)[0].trim(); // title＝「站名＋分隔＋狀態…」，取站名那一段
  for (const lang of ['zh-TW', 'en', 'ja']) {
    const { ctx, page } = await open({ tag: `C14 ${lang}`, seed: { 'trainmap-checkins-v1': JSON.stringify({ v: 1, st }) } });
    if (lang !== 'zh-TW') await page.evaluate(l => setLanguage(l), lang);
    await page.evaluate(() => openRidePanel());
    await sleep(600);
    const seals = await page.evaluate(() => [...document.querySelectorAll('#ridePanel .stn-seal')].map(el => {
      const r = el.getBoundingClientRect();
      return { text: el.querySelector('b').textContent, cnt: (el.querySelector('.cnt') || {}).textContent || '', title: el.getAttribute('title') || '', vis: r.width > 0 && r.height > 0 };
    }));
    const w = WALL[lang];
    ok(`C14 ${lang} 前提：護照車站牆有 6 枚章、都看得見`, seals.length === 6 && seals.every(s => s.vis), `${seals.length} 枚`);
    const tp = seals.find(s => s.cnt === '×3'), tc = seals.find(s => s.cnt === '×2');
    ok(`C14 ${lang} 台北市政府那枚（×3）的字＝「${w.taipei}」`, !!tp && strip(tp.text) === strip(w.taipei), tp && tp.text);
    ok(`C14 ${lang} 台北市政府那枚的 title 站名＝「${w.taipei}」`, !!tp && first(tp.title) === w.taipei, tp && tp.title);
    ok(`C14 ${lang} 台中市政府那枚（×2）的字＝「${w.taichung}」`, !!tc && strip(tc.text) === strip(w.taichung), tc && tc.text);
    ok(`C14 ${lang} 台中市政府那枚的 title 站名＝「${w.taichung}」`, !!tc && first(tc.title) === w.taichung, tc && tc.title);
    ok(`C14 ${lang} 兩枚市政府的字不一樣（分得出城市）`, !!tp && !!tc && strip(tp.text) !== strip(tc.text));
    const rest = seals.filter(s => s.cnt === '');
    ok(`C14 ${lang} 3 個一般站＋共構站（香山、左營、動物園、台北車站）的字一個字都沒變`, rest.map(s => strip(s.text)).sort().join('|') === w.others.map(strip).sort().join('|'), rest.map(s => s.text).join(' / '));
    ok(`C14 ${lang} 這四枚的 title 站名也沒變`, rest.map(s => first(s.title)).sort().join('|') === [...w.others].sort().join('|'), rest.map(s => first(s.title)).join(' / '));
    await ctx.close();
  }
}

// ── C15 通行證、鐵路站看板、捷運等車卡的深連結同樣讓首次說明卡讓位 ──────────────────────────
// 小工具的深連結有五種（護照、蓋章、通行證、鐵路站看板、捷運等車卡），都是使用者點了明確要去的地方，
// 首次說明卡（#howtoWrap，z 800）不能蓋在上面。C2／C11 已驗蓋章與護照；這裡驗另外三種，桌面與手機各一遍。
// 每一格量：說明卡收起來、已讀旗標仍是 null（讓位不是讀過，沒讀過說明的人下次開 App 照常看得到）；
// 該去的面板真的開了，而且面板中心點命中的是面板自己、不是說明卡；看板類再對站名（期望值手寫，取自事件本身）。
// 事件的 sys／station 是原生小工具送來的字面：鐵路看板 sys＝tra、station＝香山；等車卡沒有 view、sys＝trtc、station＝台北車站。
for (const mobile of [false, true]) {
  const vp = mobile ? '手機' : '桌面';
  const LINKS = [
    { id: 'pass', evt: { view: 'pass' }, panel: '#plusModal', label: '通行證面板' },
    { id: 'station', evt: { view: 'station', sys: 'tra', station: '香山' }, panel: '#board', label: '車站看板', stn: '香山' },
    { id: 'wait', evt: { sys: 'trtc', station: '台北車站' }, panel: '#board', label: '車站看板（等車卡）', stn: '台北車站' },
  ];
  for (const L of LINKS) {
    const tag = `C15 ${vp} ${L.id}`;
    const { ctx, page } = await open({ tag, howto: 'unseen', mobile });
    const pre = await page.evaluate(() => { const w = document.getElementById('howtoWrap'), b = w.getBoundingClientRect(); return { shown: !w.hidden && b.width > 0 && b.height > 0, flag: localStorage.getItem('trainmap-howto-seen') }; });
    ok(`${tag} 前提：首次說明卡在畫面上、已讀旗標是 null`, pre.shown && pre.flag === null, JSON.stringify(pre));
    await page.evaluate(e => window.__mwFire('waitOpen', e), L.evt);
    // 等面板真的開了（等完成訊號，不等固定秒數）；等不到就往下讓判準去紅
    await page.waitForFunction(sel => { const el = document.querySelector(sel); if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; }, L.panel, { timeout: 15000, polling: 100 }).catch(() => {});
    await sleep(400);
    const r = await page.evaluate(sel => {
      const hw = document.getElementById('howtoWrap'), p = document.querySelector(sel), b = p.getBoundingClientRect();
      const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { howtoHidden: hw.hidden, flag: localStorage.getItem('trainmap-howto-seen'), panelVisible: !p.hidden && b.width > 0 && b.height > 0, hitPanel: !!e && p.contains(e) && !hw.contains(e), stn: state.boardStation ? state.boardStation.name : null };
    }, L.panel);
    ok(`${tag} 深連結 → 說明卡收起來、已讀旗標仍是 null`, r.howtoHidden === true && r.flag === null, JSON.stringify(r));
    ok(`${tag} ${L.label}真的開了，面板中心點命中面板自己（沒被說明卡蓋住）`, r.panelVisible && r.hitPanel, JSON.stringify(r));
    if (L.stn) ok(`${tag} 開的是「${L.stn}」`, r.stn === L.stn, String(r.stn));
    await ctx.close();
  }
}

// ── C16 說明中心「車站收集小工具」一節：三語 × 兩平台 ──────────────────────────────────
// 這一節的步驟隨平台（Capacitor.getPlatform）與語言變，畫面上的文字就是使用者讀到的東西；期望值手寫逐字，不從頁面的字典取。
// Android：範圍預設是全台，之後長按小工具重新設定才換成單一系統（小工具宣告了可重新設定、設定頁可略過）；
// iOS：長按小工具 →「編輯小工具」換範圍；兩個平台的小、中尺寸都有「蓋章」鈕（步驟不寫按鈕在卡片的哪個位置，位置由各平台自己畫）。
const HELP_SCOPE = {
  android: {
    'zh-TW': '選「車站收集」，有小、中兩種尺寸；範圍預設是全台，之後長按小工具開啟設定，就能換成單一系統（台鐵、北捷、高捷……）',
    en: 'Choose Station collection, in small or medium size. The scope starts as all of Taiwan; later, touch and hold the widget to open its settings and switch it to a single system (TRA, Taipei Metro, Kaohsiung Metro…)',
    ja: '「駅コレクション」を選びます。サイズは小・中の2種類。範囲は最初は台湾全体で、あとからウィジェットを長押しして設定を開くと、1つの路線網（台鉄、台北メトロ、高雄メトロ…）に切り替えられます',
  },
  ios: {
    'zh-TW': '選「車站收集」，有小、中兩種尺寸；長按小工具 →「編輯小工具」可以把範圍換成單一系統（台鐵、北捷、高捷……）',
    en: 'Choose Station collection, in small or medium size. Touch and hold the widget, then Edit Widget to switch to a single system (TRA, Taipei Metro, Kaohsiung Metro…)',
    ja: '「駅コレクション」を選びます。サイズは小・中の2種類。ウィジェットを長押しして「ウィジェットを編集」から、1つの路線網（台鉄、台北メトロ、高雄メトロ…）に切り替えられます',
  },
};
const HELP_STAMP = {
  'zh-TW': '小、中尺寸上有「蓋章」鈕：按一下會打開軌島，直接在附近的車站蓋章；附近有好幾座車站時，讓你選要蓋哪一座',
  en: 'The small and medium sizes have a “Stamp” button. Tap it to open Rail Island and stamp a nearby station right away; if several stations are nearby, you pick which one',
  ja: '小・中サイズには「スタンプ」ボタンがあります。タップすると軌島が開き、近くの駅でそのままスタンプできます。近くに駅が複数あるときは、スタンプする駅を選べます',
};
const HELP_POSITION = /右上|左上|右下|左下|上方|下方|角落|標題列|旁邊|top right|top left|bottom|corner|upper|lower/i;
const HELP_CJK = /[぀-ヿ㐀-鿿]/;
async function helpChecks(platform) {
  const { ctx, page } = await open({ tag: `C16 ${platform}`, platform, mobile: true });
  for (const lang of ['zh-TW', 'en', 'ja']) {
    const tag = `C16 ${platform} ${lang}`;
    await page.evaluate(l => { closeHelp(); setLanguage(l); openHelp('collectwidget'); }, lang);
    await sleep(500);
    const steps = await page.evaluate(() => { const sec = document.querySelector('.help-sec[data-sec="collectwidget"]'); return sec ? [...sec.querySelectorAll('ol li')].map(li => li.textContent) : null; });
    ok(`${tag} 說明中心有「車站收集小工具」這一節、有步驟`, !!steps && steps.length > 0, steps ? `${steps.length} 步` : '沒有這一節');
    if (!steps) continue;
    const scope = HELP_SCOPE[platform][lang], stamp = HELP_STAMP[lang], shown = steps.join(' ／ ').slice(0, 160);
    ok(`${tag} ${platform === 'android' ? 'Android 有「範圍預設全台、之後長按小工具重新設定」那一步' : 'iOS 有「長按小工具 → 編輯小工具」那一步'}（逐字）`, steps.includes(scope), steps.includes(scope) ? '' : `畫面：${shown}`);
    ok(`${tag} 有「蓋章」鈕那一步（小、中尺寸，逐字）`, steps.includes(stamp), steps.includes(stamp) ? '' : `畫面：${shown}`);
    const stampStep = steps.find(x => /蓋章|Stamp|スタンプ/.test(x));
    ok(`${tag} 蓋章那一步沒有寫按鈕在卡片的哪個位置`, !!stampStep && !HELP_POSITION.test(stampStep), stampStep ? stampStep.slice(0, 40) : '沒有蓋章那一步');
    if (platform === 'android') ok(`${tag} Android 不再寫舊的「加入時可以選範圍」`, !/加入時可以選|When adding it, pick|追加するときに台湾全体/.test(steps.join('|')), shown);
    if (lang === 'en') ok(`${tag} 英文版步驟沒有漏翻（不含中日文字）`, steps.every(x => !HELP_CJK.test(x.replace(/[「」“”]/g, ''))), steps.filter(x => HELP_CJK.test(x)).join(' | ').slice(0, 80));
    if (lang === 'ja') ok(`${tag} 日文版蓋章那一步是日文（含假名）`, !!stampStep && /[぀-ヿ]/.test(stampStep));
    ok(`${tag} 沒有水平捲動`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  }
  await ctx.close();
}
await helpChecks('android');
await helpChecks('ios');

await browser.close();
server.close();
ok('Z 全程零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
const pass = R.filter(x => x.p).length;
console.log(`\n${pass}/${R.length} 通過（引擎 ${ENGINE}）`);
process.exit(pass === R.length ? 0 : 1);
