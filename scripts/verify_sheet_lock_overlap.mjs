// 跟隨鎖 × .board 家族 sheet 相交通案驗證——fresh 驗收 finding①(4f20551 只修了誤點履歷個案)的通案化。
// 手機寬(360/375/414/768)跟車時逐一開啟每個 sheet,量 getBoundingClientRect 幾何相交 +
// elementFromPoint 像素真值(鎖鈕 z800 > sheet z650,相交時鎖鈕會浮在 sheet 上擋內容)。
// 高身情境:favs 塞 25 筆、rides 塞 30 筆、today 餵 40 班誤點假資料、board 開台北站(真班表)。
// 判準:幾何相交時鎖鈕必須已讓位(opacity≈0 + pointer-events:none),否則 FAIL。
// 迴歸:無 sheet 時鎖鈕可見可點、關 sheet 後復原、桌機(1280)完全不受影響、面板互斥不變。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5223;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const allErrors = [];

// 誤點履歷控制組用的假資料(沿 verify_delay_history_ui.mjs)
const FAKE_DAYS = (() => {
  const days = [], end = new Date(Date.UTC(2026, 6, 19));
  for (let i = 89; i >= 0; i--) {
    const dt = new Date(end); dt.setUTCDate(dt.getUTCDate() - i);
    if (i % 11 === 3) continue;
    const fd = i % 7 === 0 ? 8 + (i % 5) * 2 : i % 4;
    days.push({ d: dt.toISOString().slice(0, 10), fd, md: fd + (i % 3) });
  }
  return days;
})();
// today 看板 40 班假資料(撐出高身 sheet)
const FAKE_TODAY = Array.from({ length: 40 }, (_, i) => ({ no: String(1000 + i * 7), delay: (i % 9) * 3, delayMax: (i % 9) * 3 + 4 }));

async function boot(browser, { width, height, touch, tag }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; errs.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { const s = `[${tag}] console.error: ${m.text()}`; errs.push(s); allErrors.push(s); } });
  await page.route('**/api/today-board*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: FAKE_TODAY }) }));
  await page.route('**/api/delay-stats*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: {} }) }));
  await page.route('**/api/delay-history*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ train: 'x', days: FAKE_DAYS, _meta: { window_days: 90, n: FAKE_DAYS.length, generated: '2026-07-20T01:00:00Z' } }) }));
  await page.goto(BASE + '?plus=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(200);
  // 跟一班台鐵車(鎖鈕只在跟隨中顯示)
  const no = await page.evaluate(async () => {
    let tries = 0;
    while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && tries < 60) { await new Promise(r => setTimeout(r, 60)); tries++; }
    let running = null, any = null;
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      if (!any) any = String(tr.train);
      const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
      if (s && eff > s[0].depSec + 60 && eff < s[s.length - 1].arrSec - 120) { running = String(tr.train); break; }
    }
    const n = running || any;
    if (n) followTrainNo(n);
    return n;
  });
  await page.waitForTimeout(400);
  // 高身情境種子:25 筆收藏 + 30 筆乘車紀錄
  await page.evaluate(() => {
    userDataSaveCollection('favs', Array.from({ length: 25 }, (_, i) => ({ train: String(2000 + i), label: `自強${2000 + i}　台北→高雄` })));
    userDataSaveCollection('rides', Array.from({ length: 30 }, (_, i) => ({ train: String(3000 + i), sys: 'tra_sched', date: `2026-06-${String(1 + (i % 28)).padStart(2, '0')}`, kind: '自強', from: '台北', to: '高雄', km: 100 + i, dep: 21600, stops: 8 })));
  });
  return { ctx, page, errs, no };
}

// 每個 sheet 的開法(在頁內執行);board 開台北站(真班表,下午時段列多)
const SHEETS = [
  { id: 'board',          open: `openBoard({ name: '台北', sys: 'tra_sched' })` },
  { id: 'favPanel',       open: `openFavPanel()` },
  { id: 'ridePanel',      open: `openRidePanel()` },
  { id: 'explorePanel',   open: `openExplorePanel()` },
  { id: 'trackPanel',     open: `openTrackPanel()` },
  { id: 'todayPanel',     open: `openTodayPanel()` },
  { id: 'delayHistPanel', open: `openDelayHist(state.trains.find(t => String(t.train) === '__NO__'))` },
];

async function measureSheet(page, sheet, no) {
  await page.evaluate(code => eval(code), sheet.open.replace('__NO__', no));
  await page.waitForTimeout(700); // 待渲染 + opacity 過渡(.5s)走完再量
  const m = await page.evaluate(id => {
    const howto = document.getElementById('howtoWrap');
    const el = document.getElementById(id);
    const lb = document.getElementById('followLockBtn');
    const r = el.getBoundingClientRect();
    const overlap = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    let lock = null;
    if (lb) {
      const lr = lb.getBoundingClientRect(), cs = getComputedStyle(lb);
      const csCtl = getComputedStyle(lb.closest('.follow-lock-ctl'));
      const op = Math.min(parseFloat(cs.opacity), parseFloat(csCtl.opacity));
      const pe = (cs.pointerEvents === 'none' || csCtl.pointerEvents === 'none') ? 'none' : cs.pointerEvents;
      const ov = overlap(r, lr);
      let efp = null;
      if (ov) {
        const x = (Math.max(r.left, lr.left) + Math.min(r.right, lr.right)) / 2;
        const y = (Math.max(r.top, lr.top) + Math.min(r.bottom, lr.bottom)) / 2;
        const hit = document.elementFromPoint(x, y);
        efp = hit && hit.closest('#followLockBtn') ? 'lock' : (hit && hit.closest('#' + id) ? 'sheet' : (hit ? hit.tagName : 'null'));
      }
      lock = { rect: [lr.left, lr.top, lr.right, lr.bottom].map(v => Math.round(v)), op: +op.toFixed(2), pe, ov, efp };
    }
    return {
      howtoHidden: !howto || howto.hidden,
      hidden: el.hidden,
      rect: [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)),
      h: Math.round(r.height),
      contentH: el.scrollHeight,
      sheetOpen: document.body.classList.contains('sheet-open'),
      dhOpen: document.body.classList.contains('dh-open'),
      lock,
    };
  }, sheet.id);
  // 關閉(下一個 sheet 由 open 內的互斥自關,這裡顯式關乾淨)
  await page.evaluate(id => {
    const f = { board: 'closeBoard', favPanel: 'closeFavPanel', ridePanel: 'closeRidePanel', explorePanel: 'closeExplorePanel', trackPanel: 'closeTrackPanel', todayPanel: 'closeTodayPanel', delayHistPanel: 'closeDelayHist' }[id];
    window[f]();
  }, sheet.id);
  await page.waitForTimeout(80);
  return m;
}

const browser = await chromium.launch();
const webkitB = await webkit.launch();

// chromium 掃四寬度;WebKit(手機主場引擎)抽 375 全 sheet 佐證,防 UA 樣式差異(心得 23/24 家族)
const RUNS = [[360, 780, true, browser, 'M360'], [375, 812, true, browser, 'M375'], [414, 896, true, browser, 'M414'], [768, 1024, true, browser, 'M768'], [375, 812, true, webkitB, 'WK375']];
for (const [width, height, touch, eng, tag] of RUNS) {
  const { ctx, page, errs, no } = await boot(eng, { width, height, touch, tag });
  ok(`${tag}.0 跟到台鐵車、鎖鈕可見`, !!no && await page.locator('.follow-lock-ctl').isVisible(), `no=${no}`);
  // 基線:無 sheet 時鎖鈕可見可互動
  const base = await page.evaluate(() => {
    const lb = document.getElementById('followLockBtn');
    const cs = getComputedStyle(lb), r = lb.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { op: parseFloat(cs.opacity), pe: cs.pointerEvents, rect: [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)), efpLock: !!(hit && hit.closest('#followLockBtn')) };
  });
  ok(`${tag}.1 基線(無 sheet):鎖鈕不透明可點且 elementFromPoint 命中`, base.op > 0.9 && base.pe !== 'none' && base.efpLock, `op=${base.op} pe=${base.pe} rect=${base.rect.join(',')}`);
  for (const sheet of SHEETS) {
    const m = await measureSheet(page, sheet, no);
    if (m.hidden) { ok(`${tag} ${sheet.id} 開啟失敗`, false, 'hidden'); continue; }
    const line = `sheet=[${m.rect.join(',')}] h=${m.h} contentH=${m.contentH} lock=[${m.lock.rect.join(',')}] ov=${m.lock.ov} op=${m.lock.op} pe=${m.lock.pe} efp=${m.lock.efp} howtoHidden=${m.howtoHidden}`;
    // 判準:幾何相交 → 鎖鈕必須讓位(op<0.02 或 pe:none),且 elementFromPoint 不命中鎖鈕
    const yielded = m.lock.op < 0.02 || m.lock.pe === 'none';
    const pass = m.howtoHidden && (!m.lock.ov || (yielded && m.lock.efp !== 'lock'));
    ok(`${tag} ${sheet.id} 相交時鎖鈕已讓位`, pass, line);
  }
  // 迴歸:全關後鎖鈕復原
  const after = await page.evaluate(() => {
    const lb = document.getElementById('followLockBtn');
    const cs = getComputedStyle(lb);
    return { op: parseFloat(cs.opacity), pe: cs.pointerEvents, sheetOpen: document.body.classList.contains('sheet-open') };
  });
  ok(`${tag}.9 全關後鎖鈕復原(op=1, 可點, sheet-open 已卸)`, after.op > 0.9 && after.pe !== 'none' && !after.sheetOpen, JSON.stringify(after));
  // 迴歸:鎖鈕真的可點(點一下 → followLock 翻轉)
  const beforeLock = await page.evaluate(() => state.followLock);
  await page.evaluate(() => document.getElementById('followLockBtn').click());
  const afterLock = await page.evaluate(() => state.followLock);
  ok(`${tag}.10 鎖鈕點擊功能不變(followLock 翻轉)`, beforeLock !== afterLock, `${beforeLock}→${afterLock}`);
  // 迴歸:面板互斥(開 fav 再開 today → fav 自關)
  await page.evaluate(() => { openFavPanel(); openTodayPanel(); });
  const mutex = await page.evaluate(() => ({ fav: document.getElementById('favPanel').hidden, today: document.getElementById('todayPanel').hidden }));
  await page.evaluate(() => closeTodayPanel());
  ok(`${tag}.11 面板互斥不變(開 today 自關 fav)`, mutex.fav === true && mutex.today === false, JSON.stringify(mutex));
  if (errs.length) ok(`${tag}.Z 零 pageerror/console.error`, false, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// 桌機控制組:sheet 開啟不得影響鎖鈕(規則只在手機媒體塊)
{
  const { ctx, page, errs, no } = await boot(browser, { width: 1280, height: 800, touch: false, tag: 'D1280' });
  ok('D1280.0 跟到台鐵車、鎖鈕可見', !!no && await page.locator('.follow-lock-ctl').isVisible(), `no=${no}`);
  for (const sheet of SHEETS) {
    await page.evaluate(code => eval(code), sheet.open.replace('__NO__', no));
    await page.waitForTimeout(250);
    const d = await page.evaluate(() => {
      const lb = document.getElementById('followLockBtn');
      const cs = getComputedStyle(lb);
      return { op: parseFloat(cs.opacity), pe: cs.pointerEvents };
    });
    ok(`D1280 ${sheet.id} 開啟時鎖鈕不受影響(桌機)`, d.op > 0.9 && d.pe !== 'none', `op=${d.op} pe=${d.pe}`);
    await page.evaluate(id => {
      const f = { board: 'closeBoard', favPanel: 'closeFavPanel', ridePanel: 'closeRidePanel', explorePanel: 'closeExplorePanel', trackPanel: 'closeTrackPanel', todayPanel: 'closeTodayPanel', delayHistPanel: 'closeDelayHist' }[id];
      window[f]();
    }, sheet.id);
  }
  if (errs.length) ok('D1280.Z 零 pageerror/console.error', false, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

server.close();
await browser.close();
await webkitB.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
