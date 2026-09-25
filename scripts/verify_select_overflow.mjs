#!/usr/bin/env node
// <select> 選到長選項時,外層不能被左右拖動(2026-09-26,守 v0925p 那批修正)。
//
// WebKit(iPhone Safari、App 的 WKWebView、Mac Safari)把 select 選中那一項的整行字寬算進最近的 overflow:auto
// 祖先的捲動範圍:字在畫面上已經裁在箭頭前,容器卻能左右拖、左邊被切掉。修法是 select 本身 overflow:hidden:
// index.html 跟車卡的「接公車」#fpBusTo、「我上車了」#fpRideTo、到站提醒 #notifyStation,rail-3d.css 觀看面板的
// 車站／地標導覽 #riGuidePlace(車庫 .g-model-select 由 verify_garage_loop 守)。
// 修前 WebKit 英文實測:#fpBusTo 127px、#fpRideTo 61、#notifyStation 19(360 寬)、#riGuidePlace 50(1280 寬)。
// Chromium 的 select 計算後 overflow 恆為 visible、這個缺陷也不發生,這支只跑 WebKit。
//   S 每個 select 塞一個長選項並選它,對每個 overflow-x 為 auto／scroll 的祖先與文件本身寫 scrollLeft＝大數再讀回:
//     讀回值 ≤ 1px(＝使用者拖不動)。長選項是注入的(兩個實測最長的英文名接起來),不靠今天跟到哪班車、剩哪幾站。
//   N 正向對照,要紅才算數:同一格把那個 select 改回 overflow:visible ⇒ 讀回值必須 > 1px。
// 慣例照 verify_board_scroll_pad.mjs:自帶 node:http 靜態伺服器(埠號由系統挑)、語系與時鐘釘死、關首訪教學卡、
// 掛 pageerror、T0 身分自檢。瀏覽器一律無視窗。約 11 秒(2026-09-26 實測)。
import { webkit } from 'playwright';
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
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
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

const LONG = 'Chang Jung Christian University · Chiang Kai-shek Memorial Hall';

// 在頁面裡跑:等 select 出現 → 塞長選項並選它 → 量每個使用者拖得動的祖先(overflow-x auto／scroll)與文件本身
// 實際能往右捲多少(寫大數再讀回,量完放回原位)→ 同一格改回 overflow:visible 再量一次 → 全部還原
const PROBE = async ([sel, long]) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let s = null;
  for (let i = 0; i < 50 && !(s = document.querySelector(sel)); i++) await sleep(100);
  if (!s) return { missing: true };
  if (!s.getClientRects().length) return { hidden: true };
  const desc = e => e === document.scrollingElement ? 'document' : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '');
  const pannable = () => {
    const els = [];
    for (let a = s.parentElement; a && a !== document.documentElement; a = a.parentElement)
      if (a !== document.body && /(auto|scroll)/.test(getComputedStyle(a).overflowX)) els.push(a);
    els.push(document.scrollingElement);
    let worst = { px: 0, el: '—' };
    for (const e of els) {
      const x0 = e.scrollLeft;
      e.scrollLeft = 1e6;
      const px = e.scrollLeft;
      e.scrollLeft = x0;
      if (px > worst.px) worst = { px, el: desc(e) };
    }
    return worst;
  };
  const idx0 = s.selectedIndex, opt = new Option(long, '__verify_long');
  s.add(opt);
  s.value = '__verify_long';
  await raf();
  const held = s.value === '__verify_long';
  const fixed = pannable();
  const ov = getComputedStyle(s).overflow;
  s.style.overflow = 'visible';
  await raf();
  const heldMut = s.value === '__verify_long';
  const mutated = pannable();
  s.style.overflow = '';
  opt.remove();
  s.selectedIndex = idx0;
  return { held, heldMut, ov, fixed, mutated, selW: +s.getBoundingClientRect().width.toFixed(1) };
};

// 跟車卡三個 select 的選項是被跟那班車的後續停站:挑一班還有 4 站以上沒到的台鐵車
const FOLLOW = `(async () => {
  const tr = state.trains.find(t => {
    if (t.sys !== 'tra_sched' || t.loop || !t.stops || t.stops.length < 6) return false;
    try { return t.stops.length - ridingBoardIdx(t) - 1 >= 4; } catch (e) { return false; }
  });
  if (!tr) return null;
  followTrainNo(String(tr.train), { sys: 'tra_sched' });
  await new Promise(r => setTimeout(r, 500));
  return state.followTrain ? String(state.followTrain.train) : null;
})()`;
const CELLS = [
  { key: 'fpRideTo', sel: '#fpRideTo', width: 360, open: `(async () => { openRideBox(state.followTrain); await new Promise(r => setTimeout(r, 200)); })()`,
    close: `closeRideBox()` },
  { key: 'fpBusTo', sel: '#fpBusTo', width: 360, open: `(async () => { busTransferOpenPicker(state.followTrain); await new Promise(r => setTimeout(r, 200)); })()`,
    close: `(() => { const c = document.getElementById('fpBusCancel'); if (c && !document.getElementById('fpBusBox').hidden) c.click(); })()` },
  { key: 'notifyStation', sel: '#notifyStation', width: 360, open: `(async () => { await openLocalReminderSheet(state.followTrain, 'verify'); await new Promise(r => setTimeout(r, 200)); })()`,
    close: `(() => { document.getElementById('notifyModal').hidden = true; })()` },
  // 觀看面板的「導覽」頁,rail-3d 載入後才掛上;修前只在桌面寬度(Mac Safari)漏
  { key: 'riGuidePlace', sel: '#riGuidePlace', width: 1280, open: `(async () => {
      for (let i = 0; i < 150 && !(window.railViewControls && document.getElementById('riGuidePlace')); i++) await new Promise(r => setTimeout(r, 100));
      if (window.railViewControls) window.railViewControls.open('places');
      await new Promise(r => setTimeout(r, 300));
    })()`, close: `(() => { if (window.railViewControls) window.railViewControls.close(); })()` },
];

async function boot(browser, width) {
  const height = width < 1000 ? 780 : 800, mobile = width < 1000;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: 'en-US', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-language', 'en');
      localStorage.removeItem('trainmap-sheet-size');
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  // demo=bounty:以 App 身分跑(「我上車了」只在 App 有);notifymock=1:到站提醒的原生橋接 mock
  await page.goto(`${BASE}?lang=en&t=09:41&demo=bounty&notifymock=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.mode === 'sched' && state.ready === true && (state.trains || []).length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
  return { ctx, page, errors };
}

const browser = await webkit.launch({ headless: true });
let t0Done = false;
for (const width of [...new Set(CELLS.map(c => c.width))]) {
  const { ctx, page, errors } = await boot(browser, width);
  if (!t0Done) {
    t0Done = true;
    const [served, lang] = await page.evaluate(() => [typeof BUILD !== 'undefined' ? BUILD : '?', document.documentElement.lang]);
    ok('T0 服務端 BUILD 與本機檔案一致、介面是英文', served === localBuild && lang === 'en', `served=${served} local=${localBuild} lang=${lang}`);
  }
  const cells = CELLS.filter(c => c.width === width);
  if (cells.some(c => c.key.startsWith('fp') || c.key === 'notifyStation')) {
    const train = await page.evaluate(FOLLOW);
    ok(`${width} 跟得到一班還有後續停站的台鐵車`, !!train, `跟 ${train} 次`);
  }
  for (const c of cells) {
    await page.evaluate(c.open);
    const r = await page.evaluate(PROBE, [c.sel, LONG]);
    try { await page.evaluate(c.close); } catch (e) {}
    const where = r.missing ? '找不到' : r.hidden ? '不在畫面上' : null;
    ok(`S ${width} ${c.key} 選到長選項,外層拖不動`, !where && r.held && r.fixed.px <= 1,
      where || `${r.held ? '' : '長選項被重繪洗掉；'}可拖 ${r.fixed.px}px(${r.fixed.el}),select overflow=${r.ov}、寬 ${r.selW}`);
    if (!where) ok(`N ${width} ${c.key} 對照:改回 overflow:visible ⇒ 外層拖得動(S 量得到紅)`, r.heldMut && r.mutated.px > 1,
      `${r.heldMut ? '' : '長選項被重繪洗掉；'}可拖 ${r.mutated.px}px(${r.mutated.el})`);
  }
  ok(`${width} 全程零 pageerror`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${failed.length ? `未過 ${failed.length} 條` : '全部通過'}(共 ${results.length} 條)`);
process.exitCode = failed.length ? 1 : 0;
