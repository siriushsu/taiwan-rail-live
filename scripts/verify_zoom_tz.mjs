// 鎖頁面縮放 + 時區錨定(Asia/Taipei)驗證 — Playwright timezoneId 模擬台灣/海外裝置。
// 背景(v0718d):nowSecOfDay/todayStr 預設分支原用裝置本地時鐘,海外訪客的「現在」對到當地時間,
//   與台鐵誤點/看板校正的台灣時間軸整個錯開;改為未設 tz 一律錨定 Asia/Taipei(台灣裝置數值恆等)。
//   特別列車週幾判定(prepFreqTimes)同步改以台北日推週幾。
// 鎖縮放:viewport maximum-scale/user-scalable + body touch-action + iOS gesturestart preventDefault。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5192;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
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

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
async function bootTz(timezoneId, { touch = false, width = 1280, height = 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
  return { ctx, page, errors };
}

// ── A. 台灣裝置:行為恆等(修正對台灣使用者零變化) ──
{
  const { ctx, page, errors } = await bootTz('Asia/Taipei');
  const r = await page.evaluate(() => {
    const d = new Date();
    const localSec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    return { now: nowSecOfDay(), localSec, today: todayStr(), localDate: d.toLocaleDateString('sv'), sim: state.simSec };
  });
  ok('A1 台灣 nowSecOfDay 與裝置本地恆等(±2s)', Math.abs(r.now - r.localSec) <= 2, `now=${r.now} local=${r.localSec}`);
  ok('A2 台灣 todayStr 與裝置本地日期恆等', r.today === r.localDate, `${r.today}`);
  ok('A3 台灣 simSec 起播=現在(±120s)', Math.abs(r.sim - r.now) <= 120, `sim=${r.sim}`);
  ok('A4 台灣無 JS 例外', errors.length === 0, errors.join(' | ').slice(0, 120));
  await ctx.close();
}

// ── B. 海外裝置(倫敦):「現在」錨定台北 ──
{
  const { ctx, page, errors } = await bootTz('Europe/London');
  const r = await page.evaluate(() => {
    const d = new Date();
    const deviceSec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    // 台北牆鐘真值:Intl 直算(與實作的 tzOffsetSec 路徑獨立)
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)) if (x.type !== 'literal') p[x.type] = x.value;
    const tpeSec = (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second;
    const tpeDate = `${p.year}-${p.month}-${p.day}`;
    const clockTxt = (document.querySelector('#clock') || {}).textContent || '';
    // 週幾:prepFreqTimes 的算式 vs Intl 台北週幾
    const wkCalc = new Date(todayStr() + 'T00:00:00Z').getUTCDay();
    const wkTruth = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(d)];
    return { now: nowSecOfDay(), deviceSec, tpeSec, today: todayStr(), tpeDate, sim: state.simSec, clockTxt, wkCalc, wkTruth };
  });
  ok('B1 倫敦 nowSecOfDay=台北牆鐘(±2s)', Math.abs(r.now - r.tpeSec) <= 2, `now=${r.now} 台北=${r.tpeSec} 裝置=${r.deviceSec}`);
  ok('B2 倫敦 nowSecOfDay≠裝置本地(時差存在才有意義)', Math.abs(r.now - r.deviceSec) > 3600, `差=${Math.abs(r.now - r.deviceSec)}s`);
  ok('B3 倫敦 todayStr=台北日期', r.today === r.tpeDate, `${r.today} vs ${r.tpeDate}`);
  ok('B4 倫敦 simSec 起播=台北現在(±120s)', Math.abs(r.sim - r.now) <= 120, `sim=${r.sim} now=${r.now}`);
  const hh = String(Math.floor(r.tpeSec / 3600)).padStart(2, '0');
  ok('B5 倫敦時鐘徽章顯示台北時', r.clockTxt.includes(hh + ':'), `clock="${r.clockTxt.trim().slice(0, 12)}" 期望含 ${hh}:`);
  ok('B6 倫敦特別列車週幾=台北週幾', r.wkCalc === r.wkTruth, `calc=${r.wkCalc} truth=${r.wkTruth}`);
  ok('B7 倫敦無 JS 例外', errors.length === 0, errors.join(' | ').slice(0, 120));
  await ctx.close();
}

// ── C. 鎖頁面縮放 ──
{
  const { ctx, page, errors } = await bootTz('Asia/Taipei', { touch: true, width: 390, height: 844 });
  const r = await page.evaluate(() => {
    const meta = (document.querySelector('meta[name=viewport]') || {}).content || '';
    const ta = getComputedStyle(document.body).touchAction;
    const ev = new Event('gesturestart', { cancelable: true });
    document.dispatchEvent(ev);
    const ev2 = new Event('gesturechange', { cancelable: true });
    document.dispatchEvent(ev2);
    const mapTa = getComputedStyle(document.querySelector('#map')).touchAction;
    return { meta, ta, prevented: ev.defaultPrevented, prevented2: ev2.defaultPrevented, mapTa };
  });
  ok('C1 viewport 含 maximum-scale=1 + user-scalable=no', /maximum-scale=1/.test(r.meta) && /user-scalable=no/.test(r.meta), r.meta);
  ok('C2 body touch-action 禁 pinch(pan-x pan-y)', r.ta === 'pan-x pan-y', r.ta);
  ok('C3 iOS gesturestart/gesturechange 已 preventDefault', r.prevented && r.prevented2, `${r.prevented}/${r.prevented2}`);
  ok('C4 地圖容器 touch-action 不受影響(Leaflet 自設)', r.mapTa !== 'pan-x pan-y', `#map=${r.mapTa}`);
  ok('C5 手機無 JS 例外', errors.length === 0, errors.join(' | ').slice(0, 120));
  await ctx.close();
}

await browser.close();
server.close();
const fails = results.filter(x => !x.pass);
console.log(`\n──────── ${results.length - fails.length}/${results.length} PASS ────────`);
if (fails.length) { console.log('FAIL: ' + fails.map(f => f.name).join(' ; ')); process.exit(1); }
