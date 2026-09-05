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
