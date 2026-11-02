// 手機底部 sheet 高度的驗收。
//
// 歷史:2026-07-30「拉了沒反應」(段高只有上限、內容短時各段同高)→ 08-26 三段改兩段(大段 88% 留白退役)
// → 2026-11-02 改成連續拖拉(使用者:「大小調整可以直接用拖拉的,不是點擊後變成固定的大小」)。
// 規格與三邊一致的條文在 native repo docs/m9/lanes/sheet-drag-handoff.md。
//
// 判準寫「使用者看得到的行為」:拖曳中頂緣跟著手指、放開停在原處、重開記得、點一下不變、
// 內容短時貼合內容不留白、頂列露出、查詢 sheet 不寫偏好、跟隨小卡跟著 sheet 實際高度讓位。
// 數字只用「手指移了多少」與視窗本身,不用 30%/46% 這類實作常數(同源判準)。
//
// 用法:node scripts/verify_sheet_sizes.mjs [目標目錄]   ENGINES=chromium 只跑一個引擎
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

const SNAP = (id) => `(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  const r = el.getBoundingClientRect();
  return { cls: el.className, h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
    scrollH: el.scrollHeight, clientH: el.clientHeight, inline: el.style.getPropertyValue('--sheet-size'),
    pref: localStorage.getItem('trainmap-sheet-h-v1'), night: localStorage.getItem('trainmap-night-sheet-h-v1'),
    vh: innerHeight, rows: [...el.querySelectorAll('.row')].filter(x => x.getClientRects().length).length };
})()`;
const snap = (page, id = 'board') => page.evaluate(c => eval(c), SNAP(id));

async function boot(browser, { width, height, touch, init = {} }) {
  // 語系釘繁中:英文環境會跳出「語言提示卡」蓋在小高度 sheet 的卡頭上,拖曳的手指落在提示卡、量成假的拖不動
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript((init) => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-appearance', 'light');
      for (const k of ['trainmap-sheet-size', 'trainmap-night-sheet-size', 'trainmap-sheet-h-v1', 'trainmap-night-sheet-h-v1']) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v);
    } catch (e) {}
  }, init);
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

/// 從卡頭(頂緣下 12)按住、分 8 步移 dy、量一次拖曳中的樣子、放開。回傳 { during, after, fingerY }。
/// 手指夾在視窗內(上下各留 4):移到視窗外瀏覽器不送 pointermove,量到的會是假的「拖不動」。
async function drag(page, id, dy) {
  const box = await page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12, vh: innerHeight }; }, id);
  dy = Math.max(4 - box.y, Math.min(box.vh - 4 - box.y, dy));
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x, box.y + dy * i / 8); await page.waitForTimeout(16); }
  await page.waitForTimeout(60);
  const during = await snap(page, id);
  await page.mouse.up();
  await page.waitForTimeout(450);
  return { during, after: await snap(page, id), fingerY: box.y + dy };
}
async function tap(page, id) {
  const box = await page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; }, id);
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(450);
  return snap(page, id);
}
const open = n => `openBoard({ name: ${JSON.stringify(n)}, sys: 'tra_sched', lat: 25.0478, lon: 121.517 })`;

for (const engineName of ENGINES) {
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();

  // ── 手機 390×844 ──
  {
    const { ctx, page, errs } = await boot(browser, { width: 390, height: 844, touch: true });
    await selectTRA(page);
    // 兩個對照站：當下停靠最多的（內容夠長，拖多少就該長多少）與最少的（內容短＝貼合內容的現場）
    const [busy, busy2, quiet] = await page.evaluate(() => {
      const cnt = {};
      for (const tr of state.trains) { if (tr.sys !== 'tra_sched') continue; for (const s of tr.stops) { if (s.stop === false) continue; cnt[s.name] = (cnt[s.name] || 0) + 1; } }
      const arr = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
      return [arr[0][0], arr[1][0], arr[arr.length - 1][0]];
    });
    const tag = `${engineName}/mobile`;
    await page.evaluate(c => eval(c), open(busy)); await page.waitForTimeout(800);
    const start = await snap(page);

    // D1 拖曳中：頂緣跟著手指（往上 150）
    const up = await drag(page, 'board', -150);
    ok(`D1 ${tag} 拖曳中高度跟著手指走（${busy}）`,
      Math.abs(up.during.h - (start.h + 150)) <= 4 && Math.abs(up.during.top - (up.fingerY - 12)) <= 4,
      `起 ${start.h} → 拖曳中 ${up.during.h}（期望 ${start.h + 150}），頂緣 ${up.during.top}／手指 ${up.fingerY}`);
    // D2 放開不吸附
    ok(`D2 ${tag} 放開後停在原處（不跳段）`, Math.abs(up.after.h - up.during.h) <= 2, `拖曳中 ${up.during.h} → 放開 ${up.after.h}`);
    // D3 記住：偏好是比例，換一站重開同高
    const frac = Number(up.after.pref);
    ok(`D3a ${tag} 高度偏好寫成比例`, Math.abs(frac - up.after.h / up.after.vh) <= 0.01, `pref ${up.after.pref}，實際 ${(up.after.h / up.after.vh).toFixed(3)}`);
    await page.evaluate(() => closeBoard()); await page.waitForTimeout(300);
    await page.evaluate(c => eval(c), open(busy2)); await page.waitForTimeout(800);
    const reopen = await snap(page);
    ok(`D3b ${tag} 換站重開記得高度（${busy2}）`, Math.abs(reopen.h - up.after.h) <= 2, `${up.after.h} → ${reopen.h}`);
    // D4 點一下不改高度
    const tapped = await tap(page, 'board');
    ok(`D4 ${tag} 點卡頭不改高度`, Math.abs(tapped.h - reopen.h) <= 1 && tapped.pref === reopen.pref, `${reopen.h} → ${tapped.h}，pref ${reopen.pref} → ${tapped.pref}`);
    // D5 往下拖到底：停在最小高度、內容沒被藏起來
    const down = await drag(page, 'board', 900);
    ok(`D5 ${tag} 往下拖到底停在下限且仍在畫面內`, down.after.h >= 100 && down.after.h < 0.25 * down.after.vh && down.after.bottom <= down.after.vh,
      `高 ${down.after.h}，bottom ${down.after.bottom}`);
    ok(`D5b ${tag} 小高度只捲動、不藏班次列`, down.after.rows > 0 && down.after.scrollH > down.after.clientH, `可見列 ${down.after.rows}，內容 ${down.after.scrollH}／可視 ${down.after.clientH}`);
    // D6 往上拖到頂：頂列那一排要露出（頂緣離視窗頂至少 56）、底緣不出畫面
    const top = await drag(page, 'board', -1200);
    ok(`D6 ${tag} 拖到最高時明顯變高、頂列仍露出、底緣在畫面內`, top.after.h > 0.6 * top.after.vh && top.after.top >= 56 && top.after.bottom <= top.after.vh,
      `高 ${top.after.h} top ${top.after.top} bottom ${top.after.bottom}（手指到 ${top.fingerY}）`);
    // D7 偏好拉到最高後開安靜的站：貼合內容、不留白
    await page.evaluate(() => closeBoard()); await page.waitForTimeout(300);
    await page.evaluate(c => eval(c), open(quiet)); await page.waitForTimeout(800);
    const q = await snap(page);
    ok(`D7 ${tag} 內容短時貼合內容（${quiet}）`, q.h < top.after.h - 40 && q.scrollH <= q.clientH + 1, `高 ${q.h}（偏好高 ${top.after.h}），內容 ${q.scrollH}／可視 ${q.clientH}`);
    await page.evaluate(() => closeBoard()); await page.waitForTimeout(300);

    // D8 查詢 sheet：拖曳不寫偏好、關掉再開回到原本的打開高度（瀏覽態內容短,往下拖才看得出變化）
    const prefBefore = await page.evaluate(() => localStorage.getItem('trainmap-sheet-h-v1'));
    await page.evaluate(() => openSearchPanel({ user: true })); await page.waitForTimeout(700);
    const s0 = await snap(page, 'searchPanel');
    const sd = await drag(page, 'searchPanel', 120);
    await page.evaluate(() => closeSearchPanel({ user: true })); await page.waitForTimeout(300);
    await page.evaluate(() => openSearchPanel({ user: true })); await page.waitForTimeout(700);
    const s1 = await snap(page, 'searchPanel');
    ok(`D8 ${tag} 查詢 sheet 拖得動、不寫全站偏好、重開回原高`,
      sd.after.h < s0.h - 60 && sd.after.pref === prefBefore && Math.abs(s1.h - s0.h) <= 2,
      `開 ${s0.h} → 拖 ${sd.after.h} → 重開 ${s1.h}；pref ${prefBefore} → ${sd.after.pref}`);
    await page.evaluate(() => closeSearchPanel({ user: true })); await page.waitForTimeout(300);

    // D9 夜間另存一份
    await page.evaluate(() => { state.mapDark = true; }); 
    await page.evaluate(c => eval(c), open(busy)); await page.waitForTimeout(800);
    const n0 = await snap(page);
    const nd = await drag(page, 'board', -80);
    ok(`D9 ${tag} 夜間拖曳寫夜間偏好、不動白天偏好`, nd.after.night != null && nd.after.pref === n0.pref && Math.abs(Number(nd.after.night) - nd.after.h / nd.after.vh) <= 0.01,
      `白天 ${n0.pref} → ${nd.after.pref}；夜間 ${n0.night} → ${nd.after.night}`);
    await page.evaluate(() => { state.mapDark = false; closeBoard(); }); await page.waitForTimeout(300);

    // D10 跟隨小卡照 sheet 實際高度讓位；sheet 拉到最高時小卡淡出
    await page.evaluate(() => document.getElementById('randBtn').click());
    await page.waitForTimeout(1500);
    const followed = await page.evaluate(() => !!state.followTrain && !document.getElementById('followPanel').hidden);
    if (followed) {
      await page.evaluate(() => openExplorePanel()); await page.waitForTimeout(900);
      // 透明度只看「sheet 高度」這條規則:停靠中(body.dwell-show)小卡本來就讓位給站名牌,先暫時拿掉;
      // 過場動畫關掉,否則剛切 class 讀到的是動畫起點的舊值(兩邊都會量成 0 ⇒ 假綠)。
      const lift = async () => page.evaluate(() => {
        const fpEl = document.getElementById('followPanel'), body = document.body, dwell = body.classList.contains('dwell-show');
        fpEl.style.transition = 'none'; body.classList.remove('dwell-show');
        const fp = fpEl.getBoundingClientRect(), sh = document.getElementById('explorePanel').getBoundingClientRect();
        const out = { fpBottom: Math.round(fp.bottom), shTop: Math.round(sh.top), fpOpacity: getComputedStyle(fpEl).opacity, tall: body.classList.contains('sheet-tall'), dwell };
        if (dwell) body.classList.add('dwell-show');
        fpEl.style.transition = '';
        return out;
      });
      await drag(page, 'explorePanel', 200); // 先拉矮,讓小卡放得下
      const low = await lift();
      ok(`D10a ${tag} 跟隨小卡貼在 sheet 頂上（不重疊、看得到）`, low.fpBottom <= low.shTop && low.shTop - low.fpBottom <= 24 && !low.tall && Number(low.fpOpacity) > 0.95, JSON.stringify(low));
      await drag(page, 'explorePanel', -1200);
      const high = await lift();
      ok(`D10b ${tag} sheet 拉到最高時小卡讓開（淡出）`, high.tall && Number(high.fpOpacity) < 0.05, JSON.stringify(high));
    } else ok(`D10 ${tag} 隨機跟隨有跟到車`, false, '按了隨機跟隨,state.followTrain 或 #followPanel 沒出現');

    ok(`G8 ${tag} 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 舊兩段偏好換算：存過 medium 的人打開約為視窗 46%（內容夠長的站） ──
  {
    const { ctx, page, errs } = await boot(browser, { width: 390, height: 844, touch: true, init: { 'trainmap-sheet-size': 'medium' } });
    await selectTRA(page);
    const busy = await page.evaluate(() => { const cnt = {}; for (const tr of state.trains) { if (tr.sys !== 'tra_sched') continue; for (const s of tr.stops) if (s.stop !== false) cnt[s.name] = (cnt[s.name] || 0) + 1; } return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]; });
    await page.evaluate(c => eval(c), open(busy)); await page.waitForTimeout(800);
    const m = await snap(page);
    ok(`D11 ${engineName} 舊鍵 medium 換算成同樣的高度`, Math.abs(m.h / m.vh - 0.46) <= 0.01, `高 ${m.h}／視窗 ${m.vh}`);
    ok(`D11b ${engineName} 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 橫式 844×390：右側欄沒有高度可拖 ──
  {
    const { ctx, page, errs } = await boot(browser, { width: 844, height: 390, touch: true });
    await selectTRA(page);
    await page.evaluate(() => openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 }));
    await page.waitForTimeout(700);
    const before = await snap(page);
    const d = await drag(page, 'board', -100);
    ok(`G9a ${engineName}/landscape 側欄拖了不變高、不掛 inline 高度`, Math.abs(d.after.h - before.h) <= 1 && !d.after.inline && !/sheet-small/.test(d.after.cls), `高 ${before.h} → ${d.after.h} inline "${d.after.inline}"`);
    ok(`G9b ${engineName}/landscape 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 桌機 1280×800：高度是手機專屬，直接呼叫 API 也不得生效 ──
  {
    const { ctx, page, errs } = await boot(browser, { width: 1280, height: 800, touch: false });
    await selectTRA(page);
    await page.evaluate(() => openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 }));
    await page.waitForTimeout(700);
    const before = await snap(page);
    await page.evaluate(() => setSheetPx(document.getElementById('board'), 600));
    await page.waitForTimeout(400);
    const after = await snap(page);
    ok(`G10 ${engineName}/desktop 桌面不套高度`, !/sheet-small|expand/.test(after.cls) && after.h === before.h && !after.inline, `class="${after.cls}" 高 ${before.h} → ${after.h}`);
    ok(`G10b ${engineName}/desktop 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
}

server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
if (failed.length) { console.log(failed.map(f => '  FAIL ' + f.name).join('\n')); process.exit(1); }
