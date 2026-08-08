// 手機底部 sheet 三段高的驗收：使用者 2026-07-30 回報「車站資訊做了可以拉大小，但實際上沒有作用」。
//
// 真因：段高原本只有 max-height（上限），內容比該段短時三段一律貼合內容 ⇒ 拉了完全沒反應。
// 判準刻意寫「使用者看得到的行為」而不是 CSS 公式（88% / min() 那串是實作，拿它當判準＝同源、
// 公式錯的話判準會跟著錯）：大段一定要明顯變大、三段要真的不同高、面板不得超出畫面。
//
// 用法：node scripts/verify_sheet_sizes.mjs [目標目錄]   ENGINES=chromium 只跑一個引擎
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
const PORT = Number(process.env.PORT || 5244);
const BASE = `http://localhost:${PORT}/`;
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 高鐵班表自 2026-08-07(9f05f2f)改以 apiUrl('api/thsr-schedule') 為主來源、靜態檔降級為 fallbackUrl。
  // 空物件是 200 ⇒ fetchJSONAt 視同成功 ⇒ fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的
  // sys.data.trains 拋錯 ⇒ boot 停在 state.ready=true 之前 ⇒ waitReady 逾時。這裡吐打包的那份(同 schema)。
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
await new Promise(r => server.listen(PORT, r));

// G0：先證明「驗的是當前工作區」——20+ 個 worktree 並行，硬編埠號很容易連到別人的伺服器。
{
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const served = createHash('md5').update(await (await fetch(BASE)).text()).digest('hex');
  const build = (readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
  ok(`G0 驗的是目標目錄（${ROOT}，BUILD ${build}）`, disk === served, `磁碟 ${disk.slice(0, 10)} / 伺服器 ${served.slice(0, 10)}`);
  if (disk !== served) { server.close(); process.exit(1); }
}

const SNAP = `(() => {
  const el = document.getElementById('board');
  const r = el.getBoundingClientRect();
  return { cls: el.className, h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
    scrollH: el.scrollHeight, rows: el.querySelectorAll('.row').length,
    pref: localStorage.getItem('trainmap-sheet-size'), vh: innerHeight };
})()`;

async function boot(browser, { width, height, touch }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-appearance', 'light');
      localStorage.removeItem('trainmap-sheet-size'); // 每次從「中」起手，不吃上一輪殘留
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  return { ctx, page, errs };
}

/// 台鐵群組才有車站看板（預設「全台同框」會走捷運來車看板邏輯，台鐵站在那裡是空的——
/// 2026-07-30 第一次量就踩到這個取樣退化，量出「三段都 179px」的假象）。
async function selectTRA(page) {
  await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
  await page.waitForFunction(() => state.mode === 'sched' && (state.trains || []).some(t => t.sys === 'tra_sched'), null, { timeout: 45000 });
}

async function tapHandle(page) {
  const box = await page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(450);
  return await page.evaluate(c => eval(c), SNAP);
}

/// 開看板 → 中/大/小 三段各量一次（點抓把循環：中→大→小→中）
async function cycle(page, openExpr) {
  await page.evaluate(c => eval(c), openExpr);
  await page.waitForTimeout(800);
  const medium = await page.evaluate(c => eval(c), SNAP);
  const large = await tapHandle(page);
  const small = await tapHandle(page);
  const back = await tapHandle(page);
  return { medium, large, small, back };
}

for (const engineName of ENGINES) {
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();

  // ── 手機 390×844 ──
  {
    const { ctx, page, errs } = await boot(browser, { width: 390, height: 844, touch: true });
    await selectTRA(page);

    // 取兩個對照站：當下停靠最多的（內容撐得起段高）與最少的（內容比 30% 還短＝原本的病灶）
    const [busy, quiet] = await page.evaluate(() => {
      const cnt = {};
      for (const tr of state.trains) { if (tr.sys !== 'tra_sched') continue; for (const s of tr.stops) { if (s.stop === false) continue; cnt[s.name] = (cnt[s.name] || 0) + 1; } }
      const arr = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
      return [arr[0][0], arr[arr.length - 1][0]];
    });
    const open = n => `openBoard({ name: ${JSON.stringify(n)}, sys: 'tra_sched', lat: 25.0478, lon: 121.517 })`;

    for (const [label, station] of [[`台鐵・多班次 ${busy}`, busy], [`台鐵・少班次 ${quiet}`, quiet]]) {
      const c = await cycle(page, open(station));
      const tag = `${engineName}/mobile/${label}`;
      const dims = `中 ${c.medium.h} / 大 ${c.large.h} / 小 ${c.small.h}（內容 ${c.medium.scrollH}，視窗 ${c.medium.vh}）`;

      // 這是使用者的原話翻成的判準：拉到最大要「真的變大」。門檻取視窗的 80%，
      // 不寫 88%／743px——那是實作的數字，寫進來就變成同源判準。
      ok(`G1 ${tag} 大段真的撐開（不受內容長度影響）`,
        c.large.h >= 0.8 * c.large.vh && c.large.h > c.medium.h,
        dims);
      ok(`G2 ${tag} 小段比中段矮或相等，且大＞中＞≥小`,
        c.small.h <= c.medium.h && c.large.h > c.medium.h,
        dims);
      ok(`G3 ${tag} 三段都沒有超出畫面`,
        c.large.top >= 0 && c.large.bottom <= c.large.vh + 1 && c.small.bottom <= c.small.vh + 1,
        `大段 top ${c.large.top} bottom ${c.large.bottom} / 小段 bottom ${c.small.bottom}`);
      ok(`G4 ${tag} 段高偏好有記住（大→small→回中）`,
        c.large.pref === 'large' && c.small.pref === 'small' && c.back.pref === 'medium',
        `${c.large.pref} → ${c.small.pref} → ${c.back.pref}`);
      ok(`G5 ${tag} 循環回到中段時高度與一開始相同`,
        c.back.h === c.medium.h, `${c.medium.h} → ${c.back.h}`);
      // 班次多的那站才驗「多給班次」：安靜的站本來就沒有第 13 班可列
      if (station === busy) {
        ok(`G6 ${tag} 大段的看板多列班次（12 → 最多 24）`,
          c.large.rows > c.medium.rows && c.large.rows <= 24 && c.medium.rows <= 12,
          `中 ${c.medium.rows} 筆 → 大 ${c.large.rows} 筆 → 小 ${c.small.rows} 筆`);
      }
    }

    // 捷運來車看板：內容天生短，是「拉了沒反應」的第二個常見現場
    await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'metro')));
    await page.waitForFunction(() => state.mode === 'freq' && (state.lines || []).length > 0, null, { timeout: 45000 });
    const metro = await page.evaluate(() => {
      for (const ln of state.lines) { const s = (ln.stations || [])[3]; if (s && s.name) return { name: s.name, sys: ln.sys || 'mrt' }; }
      return null;
    });
    if (metro) {
      const c = await cycle(page, `openBoard(${JSON.stringify({ ...metro, lat: 25.0478, lon: 121.517 })})`);
      const tag = `${engineName}/mobile/捷運來車看板 ${metro.name}`;
      ok(`G7 ${tag} 大段真的撐開`, c.large.h >= 0.8 * c.large.vh && c.large.h > c.medium.h,
        `中 ${c.medium.h} / 大 ${c.large.h} / 小 ${c.small.h}（內容 ${c.medium.scrollH}）`);
    } else {
      ok('G7 捷運來車看板取得到樣本', false, '找不到捷運站樣本');
    }

    ok(`G8 ${engineName}/mobile 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 桌機 1280×800：段高是手機專屬，桌面不得掛上 class、也不得改變高度 ──
  {
    const { ctx, page, errs } = await boot(browser, { width: 1280, height: 800, touch: false });
    await selectTRA(page);
    await page.evaluate(() => openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 }));
    await page.waitForTimeout(700);
    const before = await page.evaluate(c => eval(c), SNAP);
    // 直接呼叫 API 也不該生效（不是只有「點不到把手」而已）
    await page.evaluate(() => setSheetSize(document.getElementById('board'), 'large'));
    await page.waitForTimeout(400);
    const after = await page.evaluate(c => eval(c), SNAP);
    ok(`G9 ${engineName}/desktop 桌面不套段高`,
      !/sheet-small|expand/.test(after.cls) && after.h === before.h,
      `class="${after.cls}" 高 ${before.h} → ${after.h}`);
    ok(`G10 ${engineName}/desktop 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
}

server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
if (failed.length) { console.log(failed.map(f => '  FAIL ' + f.name).join('\n')); process.exit(1); }
