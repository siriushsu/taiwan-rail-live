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
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true });
const pageErrors = [];
// howto：'seen'＝已看過（旗標寫 1）、'unseen'＝沒看過（旗標不寫，首次說明卡會在開機時跳出來）。
// deny：開機前就讓定位替身回「權限被拒」（開機時的第一次 watch 就失敗，之後每次重試也失敗）。
async function open({ tag, seed = {}, howto = 'seen', mobile = false, deny = false }) {
  await guardMidnight();
  const ctx = await browser.newContext({ ...(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }), locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(({ seed, howto, deny }) => {
    if (howto === 'seen') { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} }
    if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }
    const listeners = window.__mwListeners = {};
    window.__mwFire = (name, evt) => (listeners[name] || []).forEach(fn => fn(evt));
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
    window.RAIL_NATIVE_COLLECTION = { sync() { return Promise.resolve(); } };
    window.Capacitor.Plugins.RailMetroWait = {
      start: async () => ({ ok: true }), stop: async () => ({ ok: true }), status: async () => ({ active: false }), setPlus: async () => ({}),
      addListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return { remove() {} }; },
    };
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
  }, { seed, howto, deny });
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
async function multiAndHowto(tag, mobile) {
  const { ctx, page } = await open({ tag, howto: 'unseen', mobile });
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
  await page.locator(sel).scrollIntoViewIfNeeded();
  const box = await page.locator(sel).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const hitSelf = await page.evaluate(([x, yy, s]) => { const e = document.elementFromPoint(x, yy), b = document.querySelector(s); return !!(e && b && (e === b || b.contains(e))) && !b.disabled; }, [cx, cy, sel]);
  ok(`${tag} 前提：那顆鈕在畫面上、可點、點下去命中的就是它（沒被說明卡蓋住）`, hitSelf, `(${Math.round(cx)},${Math.round(cy)})`);
  await page.mouse.click(cx, cy);
  const clicked = await waitStamp(page, 'thsr_sched|台北');
  const after = await stamps(page);
  ok(`${tag} 真滑鼠點鈕 → 高鐵台北被蓋（次數 1、今天），其他站沒被蓋`, clicked && keysOf(after) === 'thsr_sched|台北' && after['thsr_sched|台北'].n === 1 && after['thsr_sched|台北'].d === todayTaipei(), keysOf(after));
  const btn = await page.evaluate(s => { const b = document.querySelector(s); return b ? { cls: b.className, dis: b.disabled, txt: b.textContent } : null; }, sel);
  ok(`${tag} 點擊造成畫面變化：那顆鈕變成「今天已蓋 ✓」且停用`, !!btn && /done/.test(btn.cls) && btn.dis && btn.txt.includes('今天已蓋'), JSON.stringify(btn));
  ok(`${tag} 整段流程之後已讀旗標仍是 null`, (await flag(page)) === null);
  await ctx.close();
}
await multiAndHowto('C2 桌面 1280', false);
await multiAndHowto('C2 手機 375', true);

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

await browser.close();
server.close();
ok('Z 全程零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
const pass = R.filter(x => x.p).length;
console.log(`\n${pass}/${R.length} 通過（引擎 ${ENGINE}）`);
process.exit(pass === R.length ? 0 : 1);
