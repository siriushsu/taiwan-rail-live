// 行程分享 v1 驗證 — Playwright 真引擎 + 本機靜態伺服器。
// 背景(2026-07-18 設計定案,暗啟動):分享「班次＋目的站」不分享 GPS;接收端 ?trip= 解碼→強制 live、
//   自動跟車、行程橫幅(追蹤中/已到達/行程已結束)。發起端受 TRIP_SHARE_ENABLED 旗標(?tripshare=1 測試開),
//   接收端不受旗標。連結格式 ?trip=<sys>.<車次>.<目的站>.<yyyymmdd>[.<起站>],sys∈tra|thsr。
// 決定性:用 addInitScript 覆寫 Date(固定台北 08:30,尖峰大量在跑班次)——只固定 Date.now/new Date(),
//   不動 performance/rAF/timer,故動畫時鐘照常;sharer 與 receiver 同一固定鐘,班次一致可重現。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5194;
const FIXED_MS = Date.parse('2026-07-18T08:30:00+08:00'); // 台北營運日 08:30(sharer/receiver 同鐘)
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

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const base = `http://localhost:${PORT}/`;

async function boot(browser, urlPath, { width = 1280, height = 800, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript((F) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    // 固定 Date(不動 performance/rAF/timer):new Date()/Date.now() 回固定台北 08:30
    const _Date = Date;
    class FakeDate extends _Date { constructor(...a) { if (a.length === 0) super(F); else super(...a); } static now() { return F; } }
    window.Date = FakeDate;
    // 攔截剪貼簿(headless 常擋 writeText):記錄行程連結供斷言
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__tripCopied = t; return Promise.resolve(); } } }); } catch (e) {}
  }, FIXED_MS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
  await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
  return { ctx, page, errors };
}

// 找一班「正在跑、且還有 ≥1 個 ≥3 分後才到的停靠站」的台鐵車;回傳車次與可選目的站
async function findRunningTrain(page) {
  return page.evaluate(() => {
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched' || tr.loop) continue;
      const s = tr.stops, first = s[0], last = s[s.length - 1];
      const eff = effT(tr);
      if (eff < first.depSec + 60 || eff > last.arrSec - 120) continue; // 明確在途中(避開發車/抵達邊界)
      const rem = s.filter(x => x.stop !== false && x.arrSec > eff + 180);
      if (rem.length < 1) continue;
      const dest = rem[Math.min(1, rem.length - 1)]; // 取第二個剩餘停站(較穩,非最近一站)
      return { no: String(tr.train), typeName: tr.typeName, dest: dest.name, destArr: dest.arrSec, sys: tr.sys };
    }
    return null;
  });
}
async function followInPage(page, no) {
  return page.evaluate((no) => { followTrainNo(no); return state.followTrain ? { no: String(state.followId), sys: state.followTrain.sys } : null; }, no);
}
function parseHM(txt) { const m = /(\d{1,2}):(\d{2})/.exec(txt || ''); return m ? (+m[1] % 24) * 60 + (+m[2]) : null; }

// ══════════════ chromium 主體 ══════════════
const cr = await chromium.launch();

// ── Test A:無 tripshare 參數 → 頁面無發起入口;?trip= 解碼仍作用 ──
let sharedUrl = null, pick = null;
{
  const { ctx, page, errors } = await boot(cr, '');
  pick = await findRunningTrain(page);
  if (!pick) { ok('A0 找到在跑的台鐵班次(固定鐘 08:30)', false, '08:30 竟無在途台鐵車'); }
  else {
    ok('A0 找到在跑的台鐵班次(固定鐘 08:30)', true, `${pick.typeName}${pick.no} → ${pick.dest}`);
    const f = await followInPage(page, pick.no);
    ok('A1 無旗標時可跟車(既有功能不破壞)', !!f && f.no === pick.no, JSON.stringify(f));
    const entry = await page.evaluate(() => { const b = document.getElementById('fpTripShare'); return { exists: !!b, hidden: b ? b.hidden : null, visible: b ? !!b.offsetParent : null }; });
    ok('A2 無 tripshare → 發起入口不顯示(暗啟動)', entry.exists && entry.hidden === true && entry.visible === false, JSON.stringify(entry));
    sharedUrl = await page.evaluate((dest) => buildTripUrl(state.followTrain, dest), pick.dest);
    ok('A3 in-page buildTripUrl 產出 ?trip= 連結', !!sharedUrl && /\?trip=tra\./.test(sharedUrl), sharedUrl);
  }
  ok('A 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
// ?trip= 解碼在「無 tripshare」下仍作用(接收端不受旗標)
if (sharedUrl) {
  const rpath = sharedUrl.slice(base.length);
  const { ctx, page, errors } = await boot(cr, rpath);
  const r = await page.evaluate(() => ({ hidden: document.getElementById('tripBanner').hidden, following: state.followTrain ? String(state.followId) : null, hasTrip: !!(state._trip && state._trip.tr) }));
  ok('A4 接收端 ?trip= 不受旗標(無 tripshare 仍解碼顯示橫幅+跟車)', r.hidden === false && r.following === pick.no && r.hasTrip, JSON.stringify(r));
  ok('A4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── Test B:?tripshare=1 + 跟台鐵車 → 入口出現 → 選目的站 → 產連結、格式正確 ──
{
  const { ctx, page, errors } = await boot(cr, '?tripshare=1');
  const p = await findRunningTrain(page); // 同固定鐘→同一批在跑班次
  await followInPage(page, p.no);
  const entry = await page.evaluate(() => { const b = document.getElementById('fpTripShare'); return { hidden: b.hidden, visible: !!b.offsetParent }; });
  ok('B1 ?tripshare=1 + 跟台鐵車 → 入口出現', entry.hidden === false && entry.visible === true, JSON.stringify(entry));
  await page.click('#fpTripShare');
  const panelUp = await page.evaluate(() => { const el = document.getElementById('tripPanel'); return { open: !el.hidden, rows: el.querySelectorAll('.row[data-dest]').length, closeInH3: !!el.querySelector('h3 .close') }; });
  ok('B2 選目的站面板開啟(有剩餘停站列)', panelUp.open && panelUp.rows > 0, JSON.stringify(panelUp));
  ok('B2b ×鈕在 sticky h3 內(v0717p 鐵則)', panelUp.closeInH3 === true, `closeInH3=${panelUp.closeInH3}`);
  // 目的站在列表內才點(用 findRunningTrain 的 dest)
  const expUrl = await page.evaluate((dest) => buildTripUrl(state.followTrain, dest), p.dest);
  await page.locator('#tripPanel .row[data-dest]', { hasText: p.dest }).first().click();
  await page.waitForTimeout(120);
  const copied = await page.evaluate(() => window.__tripCopied || null);
  ok('B3 點目的站 → 觸發分享(剪貼簿收到連結)', copied === expUrl, `copied=${copied}`);
  // 格式:<sys>.<no>.<encoded dest>.<yyyymmdd>[.<from>]
  const q = copied && new URL(copied).searchParams.get('trip');
  const seg = q ? q.split('.') : [];
  const fmtOk = seg.length >= 4 && seg[0] === 'tra' && seg[1] === p.no && decodeURIComponent(seg[2]) === p.dest && /^\d{8}$/.test(seg[3]);
  ok('B4 連結格式正確(sys.車次.目的站.日期[.起站])', fmtOk, `seg=${JSON.stringify(seg)} 期望dest=${p.dest}`);
  ok('B4b 日期=台北營運日 20260718', seg[3] === '20260718', `date=${seg[3]}`);
  ok('B 選站面板點站後關閉', await page.evaluate(() => document.getElementById('tripPanel').hidden === true), '');
  ok('B 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── Test C:開該連結(乾淨 context)→ 自動跟車 + 橫幅起訖/車次正確 + ETA 與時刻表一致(≤1 分) ──
{
  const rpath = sharedUrl.slice(base.length);
  const { ctx, page, errors } = await boot(cr, rpath);
  await page.waitForFunction(() => { try { return !document.getElementById('tripBanner').hidden; } catch (e) { return false; } }, null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const out = {
      following: state.followTrain ? String(state.followId) : null,
      hidden: document.getElementById('tripBanner').hidden,
      stateTxt: document.getElementById('tripState').textContent,
      routeTxt: document.getElementById('tripRoute').textContent,
      etaTxt: document.getElementById('tripEta').textContent,
    };
    const trip = state._trip;
    if (trip && trip.tr) {
      const tr = trip.tr, dest = trip.dest;
      const dl = tr.sys === 'tra_sched' ? liveDelaySec(tr) : 0;
      out.expEta = fmtHM((dest.arrSec + Math.round(dl / 60) * 60) % 86400);
      out.destName = dest.name; out.typeNo = tr.typeName + ' ' + tr.train; out.from = trip.from;
    }
    return out;
  });
  ok('C1 接收端自動跟車(正確車次)', r.following === pick.no, `following=${r.following} 期望=${pick.no}`);
  ok('C2 橫幅顯示(追蹤中)', r.hidden === false && r.stateTxt.trim() === '追蹤中', `hidden=${r.hidden} state=${r.stateTxt}`);
  ok('C3 橫幅起訖含目的站', r.routeTxt.includes(r.destName), `route="${r.routeTxt}" dest=${r.destName}`);
  ok('C4 橫幅含車種車次', r.routeTxt.includes(r.typeNo), `route="${r.routeTxt}" typeNo=${r.typeNo}`);
  const etaMin = parseHM(r.etaTxt), expMin = parseHM(r.expEta);
  const diff = etaMin != null && expMin != null ? Math.min(Math.abs(etaMin - expMin), 1440 - Math.abs(etaMin - expMin)) : 999;
  ok('C5 ETA 與時刻表+當前誤點一致(≤1 分)', diff <= 1, `banner=${r.etaTxt.trim()} 期望=${r.expEta} diff=${diff}分`);
  // 鐵則:中途加入不得觸發完乘成就(既有規則=從發車跟起才算;確認隔離未破壞,不改成就邏輯)
  const qual = await page.evaluate(() => { const tr = state.followTrain; if (!tr) return null; const first = tr.stops[0]; return { qualified: state.followStartEff <= first.depSec + 60 && !state.followTimeJumped, startEff: state.followStartEff, dep: first.depSec, jumped: state.followTimeJumped }; });
  ok('C6 中途加入完乘資格關閉(不蓋章)', qual && qual.qualified === false, JSON.stringify(qual));
  ok('C 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── Test D:邊界三態各自優雅、console 零 error ──
{
  // D1 亂寫車次 → 查無班次
  {
    const { ctx, page, errors } = await boot(cr, '?trip=tra.9999999.' + encodeURIComponent('臺北') + '.20260718');
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('tripBanner').hidden, st: document.getElementById('tripState').textContent }));
    ok('D1 亂寫車次 → 「查無班次」橫幅(不崩)', r.hidden === false && r.st.trim() === '查無班次', JSON.stringify(r));
    ok('D1 console 零 error', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // D2 過期日期 → 行程已結束
  {
    const { ctx, page, errors } = await boot(cr, '?trip=tra.' + pick.no + '.' + encodeURIComponent(pick.dest) + '.20200101');
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('tripBanner').hidden, st: document.getElementById('tripState').textContent }));
    ok('D2 過期日期 → 「行程已結束」橫幅(不崩)', r.hidden === false && r.st.trim() === '行程已結束', JSON.stringify(r));
    ok('D2 console 零 error', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // D3 已到達(車過目的站):真流程開連結後,凍結時鐘推進到過站,驗狀態
  {
    const rpath = sharedUrl.slice(base.length);
    const { ctx, page, errors } = await boot(cr, rpath);
    await page.waitForFunction(() => { try { return !!(state._trip && state._trip.tr); } catch (e) { return false; } }, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const tr = state._trip.tr, dest = state._trip.dest, last = tr.stops[tr.stops.length - 1];
      state.playing = false;                       // 凍結,tick 不再推進
      // 目的站非終點時,推到「過目的站但未到終點」→ 已到達;是終點則測收班
      const target = (dest.arrSec < last.arrSec - 60) ? dest.arrSec + 90 : last.arrSec + 120;
      state.simSec = target; renderTripBanner();    // 直接設 simSec(避開 setSimSec 取模;08:30 班次不跨午夜)
      const arrivedTxt = document.getElementById('tripState').textContent.trim();
      // 再推到全程收班 → 行程已結束
      state.simSec = last.arrSec + 300; renderTripBanner();
      const endedTxt = document.getElementById('tripState').textContent.trim();
      return { arrivedTxt, endedTxt, destIsLast: !(dest.arrSec < last.arrSec - 60) };
    });
    ok('D3 車過目的站 → 「已到達」(或終點站直接收班)', r.destIsLast ? r.arrivedTxt === '行程已結束' : r.arrivedTxt === '已到達', JSON.stringify(r));
    ok('D3b 全程收班 → 「行程已結束」', r.endedTxt === '行程已結束', `ended=${r.endedTxt}`);
    ok('D3 console 零 error', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // D4 結構壞掉的 trip 參數 → 當作無 trip(正常載入,不顯橫幅、不崩)
  {
    const { ctx, page, errors } = await boot(cr, '?trip=garbage');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('tripBanner').hidden, hasTrip: !!state._trip }));
    ok('D4 壞掉的 ?trip= → 優雅忽略(不顯橫幅、正常載入)', r.hidden === true && !r.hasTrip, JSON.stringify(r));
    ok('D4 console 零 error', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

// ── Test E:手機四寬度 橫幅 vs 既有 overlay 兩兩不相交(chromium 360/375/414/768 + webkit 390) ──
function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}
async function overlapCheck(browser, label, width, height, touch) {
  const rpath = sharedUrl.slice(base.length);
  const { ctx, page, errors } = await boot(browser, rpath, { width, height, touch });
  await page.waitForFunction(() => { try { return !document.getElementById('tripBanner').hidden; } catch (e) { return false; } }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const rects = await page.evaluate(() => {
    const pick = sel => { const el = document.querySelector(sel); if (!el || el.hidden || !el.offsetParent) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; };
    return {
      banner: pick('#tripBanner'),
      toolbar: pick('.controls'), clock: pick('.badge'), alert: pick('#alertBanner'),
      follow: pick('#followPanel'), tabbar: pick('#tabbar'),
    };
  });
  const b = rects.banner;
  ok(`E ${label} 橫幅存在且渲染`, !!b, JSON.stringify(b));
  if (b) {
    const others = { 工具列: rects.toolbar, 時鐘: rects.clock, 公告條: rects.alert, 跟隨面板: rects.follow, tabbar: rects.tabbar };
    const hits = [];
    for (const [k, r] of Object.entries(others)) if (r && overlapArea(b, r) > 0.5) hits.push(`${k}(${overlapArea(b, r).toFixed(0)}px²)`);
    ok(`E ${label} 橫幅與既有 overlay 兩兩不相交`, hits.length === 0, hits.length ? '相交:' + hits.join(', ') : `對照:${Object.entries(others).filter(([, r]) => r).map(([k]) => k).join('/')}`);
  }
  ok(`E ${label} 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
for (const [w, h] of [[360, 780], [375, 812], [414, 896], [768, 1024]]) await overlapCheck(cr, `chromium ${w}`, w, h, true);
await cr.close();

// ── webkit 390 抽測(macOS/iOS 預設引擎) ──
try {
  const wk = await webkit.launch();
  await overlapCheck(wk, 'webkit 390', 390, 844, true);
  // webkit 也跑一輪接收端基本流程(解碼+跟車+橫幅)
  {
    const rpath = sharedUrl.slice(base.length);
    const { ctx, page, errors } = await boot(wk, rpath, { width: 390, height: 844, touch: true });
    await page.waitForFunction(() => { try { return !document.getElementById('tripBanner').hidden; } catch (e) { return false; } }, null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ following: state.followTrain ? String(state.followId) : null, st: document.getElementById('tripState').textContent.trim(), route: document.getElementById('tripRoute').textContent }));
    ok('E webkit 390 接收端解碼+跟車+橫幅', r.following === pick.no && r.st === '追蹤中' && r.route.includes(pick.dest), JSON.stringify(r));
    ok('E webkit 390 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await wk.close();
} catch (e) { ok('E webkit 全項', false, 'webkit 啟動失敗:' + String(e).slice(0, 120)); }

// ── Test F:契約 grep(新增 ETA 代碼只經 easedShift;日期走 todayStr('Asia/Taipei')) ──
{
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // 抽出行程分享 JS 區塊(從標記到 renderTripBanner 結束前)
  const start = html.indexOf('行程分享(2026-07-18)');
  const end = html.indexOf("function closeTripBanner()");
  const blk = start >= 0 && end > start ? html.slice(start, end) : '';
  ok('F0 找到行程分享 JS 區塊', blk.length > 500, `len=${blk.length}`);
  ok('F1 ETA 誤點修正經 easedShift(呼叫 liveDelaySec,禁讀 raw shift)', blk.includes('liveDelaySec(tr)'), '含 liveDelaySec(tr)');
  ok('F2 未直讀 raw shift(state.live.map / _easedShift.get)', !/state\.live\.map|_easedShift\.get/.test(blk), '未見 raw 偏移直取');
  ok('F3 日期走 todayStr(\'Asia/Taipei\')(v0718d 錨定,禁裝置時區 new Date 直算)', blk.includes("todayStr('Asia/Taipei')"), '含 todayStr(Asia/Taipei)');
  ok('F4 高鐵不顯逐車誤點(thsr 誤點=0)', /tr\.sys === 'tra_sched' \? liveDelaySec\(tr\) : 0/.test(blk), 'thsr delay 恆 0');
  ok('F5 旗標暗啟動預設關(TRIP_SHARE_ENABLED 由 ?tripshare=1 決定)', /const TRIP_SHARE_ENABLED = \(\(\) => \{ try \{ return new URLSearchParams\(location\.search\)\.get\('tripshare'\) === '1'/.test(html), '旗標定義符合 ?breath 慣例');
}

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);
