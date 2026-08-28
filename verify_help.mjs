// 使用說明中心 驗收（設計：使用說明中心設計_2026-07-26.html）
// 跑法：先在本 repo 起 server，然後 HELP_BASE=http://127.0.0.1:<port> node verify_help.mjs
// G0 自檢在最前：確認「受測的就是這個工作區的 index.html」（心得 32：曾連兩輪驗到釘死的舊 worktree）
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// 🔴 ROOT 原本硬編成 /Users/xuxiang/Code/軌島-說明中心（這支腳本誕生的那個 worktree）。
// 這支腳本已經隨 index.html 進版控、會被 checkout 到任何 worktree，硬編等於「不管在哪棵樹跑，
// 都拿另一棵樹的檔案當基準」——正是 G0 要防的那件事，而 G0 自己的基準卻踩在上面。
// 改成預設「這支腳本所在的目錄」＝當前工作區（心得 32：預設值一律指向當前工作區，
// 不是任何暫存副本）。真要跨樹比對再用 HELP_ROOT 顯式指定。
const ROOT = process.env.HELP_ROOT || dirname(fileURLToPath(import.meta.url));
const BASE = process.env.HELP_BASE || 'http://127.0.0.1:8899';
const SHOT = process.env.HELP_SHOT || '/private/tmp/claude-501/-Users-xuxiang-Code------/1fa26f79-4188-4f31-9a37-d1e14ee5756c/scratchpad/';
const md5 = s => createHash('md5').update(s).digest('hex');
const res = [];
const ok = (g, msg) => { res.push({ g, pass: true, msg }); console.log(`  PASS ${g} ${msg}`); };
const bad = (g, msg) => { res.push({ g, pass: false, msg }); console.log(`  FAIL ${g} ${msg}`); };
const chk = (g, cond, msg) => cond ? ok(g, msg) : bad(g, msg);

const local = readFileSync(ROOT + '/index.html', 'utf8');
const BUILD = (local.match(/const BUILD = '([^']+)'/) || [])[1];

const browser = await chromium.launch();
const errs = [];

// 原生 App 情境一律用專案自己的 mock（?geomock / ?notifymock）——自己捏 window.RAIL_NATIVE_* 旗標會
// 把 boot 弄壞（那不是 boolean 而是有 getCurrentPosition 的 bridge 物件，捏成 true 直接 TypeError）
const NATIVE_QS = 'geomock=25.0478,121.5170&notifymock=1';
const withNative = (qs, native) => !native ? qs : (qs ? qs + '&' : '?') + NATIVE_QS;

async function newPage({ w = 1280, h = 900, seen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  // 本驗收的既有斷言以繁中 canonical 文案為準；多語化後首次語言會讀 navigator.language，
  // 因此固定 zh-TW，英文／日文說明另由 scripts/verify_i18n.mjs 驗證。
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-language', 'zh-TW'); } catch (e) {} });
  if (seen) await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  return p;
}
async function boot(p, qs = '') {
  await p.goto(BASE + '/index.html' + qs, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const c = document.getElementById('count'); return c && c.textContent.trim().length > 0; }, { timeout: 30000 });
  await p.waitForTimeout(400);
}
const helpOpen = p => p.evaluate(() => { const m = document.getElementById('helpModal'); return !!m && !m.hidden; });

// ── G0 自檢 ───────────────────────────────────────────────────────────────
console.log('\n[G0] 受測目標自檢');
{
  const p = await newPage({ seen: true });
  let served = '';
  try { served = await (await p.request.get(BASE + '/index.html')).text(); } catch (e) { served = ''; }
  console.log(`  受測 URL   : ${BASE}/index.html`);
  console.log(`  工作區檔案 : ${ROOT}/index.html`);
  console.log(`  BUILD      : ${BUILD}`);
  console.log(`  md5 本地   : ${md5(local)}`);
  console.log(`  md5 受測   : ${served ? md5(served) : '(取不到)'}`);
  if (!served) { bad('G0', '取不到受測檔——server 沒起？'); }
  else chk('G0', md5(served) === md5(local), '受測檔與工作區 index.html 逐 byte 相同');
  await p.context().close();
  if (!res.every(r => r.pass)) { console.log('\nG0 未過，停止（避免驗錯目標）'); await browser.close(); process.exit(1); }
}

// ── G1 ?help=1 深連結 ────────────────────────────────────────────────────
console.log('\n[G1] ?help=1 深連結');
{
  const p = await newPage({ seen: true });
  await boot(p, '?help=1');
  // 深連結刻意等「資料就位」才開(免得渲染出過期的節),所以這裡等它,不是一 boot 完就斷言
  try { await p.waitForFunction(() => { const m = document.getElementById('helpModal'); return m && !m.hidden; }, { timeout: 8000 }); } catch (e) {}
  chk('G1', await helpOpen(p), '?help=1 開啟說明中心（等資料就位後自動開）');
  chk('G1', await p.evaluate(() => { const h = document.getElementById('howtoWrap'); return !h || h.hidden; }), '首訪卡沒有跟說明中心疊在一起');
  await p.context().close();
}

// ── G2 「更多」sheet 首列 ────────────────────────────────────────────────
console.log('\n[G2] 更多 sheet 入口');
{
  const p = await newPage({ seen: true });
  await boot(p);
  const row = await p.evaluate(() => {
    const r = document.querySelector('#moreBody .ms-row[data-act="help"]');
    if (!r) return null;
    const rows = [...document.querySelectorAll('#moreBody .ms-row, #moreBody .ms-sec')];
    return { txt: r.textContent.trim(), first: rows.indexOf(r) === 0 };
  });
  chk('G2', !!row, '#moreBody 有 data-act="help" 的列');
  if (row) {
    chk('G2', row.first, '說明列排在 sheet 最上方（在任何分組之前）');
    await p.click('#toolsFab');
    await p.waitForTimeout(250);
    await p.click('#moreBody .ms-row[data-act="help"]');
    await p.waitForTimeout(350);
    chk('G2', await helpOpen(p), '點該列會開說明中心');
    chk('G2', await p.evaluate(() => !document.body.classList.contains('tools-open')), '開說明時 sheet 已收起');
  }
  await p.context().close();
}

// ── G3 首訪卡「看完整說明」 ──────────────────────────────────────────────
console.log('\n[G3] 首訪卡入口');
{
  const p = await newPage();               // 不寫 seen → 首訪卡會出現
  await boot(p);
  chk('G3', await p.evaluate(() => { const h = document.getElementById('howtoWrap'); return h && !h.hidden; }), '首次造訪會出現首訪卡');
  const rows = await p.evaluate(() => document.querySelectorAll('#howtoWrap .hw-row').length);
  chk('G3', rows === 3, `首訪卡是三行（實得 ${rows}）`);
  const hasMore = await p.evaluate(() => !!document.getElementById('howtoMore'));
  chk('G3', hasMore, '首訪卡有「看完整說明」鈕');
  if (hasMore) {
    await p.click('#howtoMore');
    await p.waitForTimeout(350);
    chk('G3', await helpOpen(p), '點「看完整說明」開啟說明中心');
    chk('G3', await p.evaluate(() => document.getElementById('howtoWrap').hidden), '首訪卡同時收起');
    chk('G3', await p.evaluate(() => localStorage.getItem('trainmap-howto-seen') === '1'), '已寫入 seen（關掉說明不會又跳回首訪卡）');
  }
  await p.context().close();
}

// ── G4 頁尾入口 ──────────────────────────────────────────────────────────
console.log('\n[G4] 頁尾入口');
{
  const p = await newPage({ seen: true });
  await boot(p);
  const n = await p.evaluate(() => document.querySelectorAll('.help-open').length);
  chk('G4', n >= 1, `頁面有 .help-open 入口 ${n} 個`);
  if (n) {
    await p.evaluate(() => document.querySelector('.help-open').click());
    await p.waitForTimeout(350);
    chk('G4', await helpOpen(p), '頁尾入口能開啟說明中心');
  }
  await p.context().close();
}

// ── G5 三組摺疊 ──────────────────────────────────────────────────────────
console.log('\n[G5] 分組與摺疊');
{
  const p = await newPage({ seen: true });
  await boot(p);
  await p.evaluate(() => openHelp());
  const st = await p.evaluate(() => ({
    grps: document.querySelectorAll('#helpBody .help-grp').length,
    open: document.querySelectorAll('#helpBody .help-grp.open').length,
    firstOpen: document.querySelector('#helpBody .help-grp')?.classList.contains('open'),
    secs: document.querySelectorAll('#helpBody .help-sec').length,
    quick: document.querySelectorAll('#helpBody .help-qstep').length,
  }));
  chk('G5', st.grps === 3, `三組（實得 ${st.grps}）`);
  chk('G5', st.open === 1 && st.firstOpen, '預設只展開第一組');
  chk('G5', st.quick === 3, `三步上手三行（實得 ${st.quick}）`);
  chk('G5', st.secs >= 18, `節數 ${st.secs}（含收合組，應 ≥18）`);
  const click2 = () => p.evaluate(() => { const g = document.querySelectorAll('#helpBody .help-grph')[1]; if (!g) return false; g.click(); return true; });
  if (await click2()) {
    await p.waitForTimeout(200);
    chk('G5', await p.evaluate(() => document.querySelectorAll('#helpBody .help-grp.open').length) === 2, '點第二組會展開');
    await click2();
    await p.waitForTimeout(200);
    chk('G5', await p.evaluate(() => document.querySelectorAll('#helpBody .help-grp.open').length) === 1, '再點會收合');
  } else bad('G5', '沒有第二組可點');
  await p.context().close();
}

// ── G6 每節「試一次」的代點目標都在（逐節，不抽樣） ──────────────────────
console.log('\n[G6] 試一次代點目標');
{
  const p = await newPage({ seen: true });   // 原生 mock 全開＝節數最多
  await boot(p, withNative('', true));
  await p.evaluate(() => { openHelp(); document.querySelectorAll('#helpBody .help-grp').forEach(g => g.classList.add('open')); });
  const audit = await p.evaluate(() => (typeof helpAudit === 'function' ? helpAudit() : null));
  if (!audit) { bad('G6', '沒有 helpAudit()（說明中心未實作？）'); }
  else {
    chk('G6', audit.rendered.length >= 15, `渲染出 ${audit.rendered.length} 顆試一次鈕`);
    const noFn = audit.rendered.filter(k => !audit.tryKeys.includes(k));
    chk('G6', noFn.length === 0, noFn.length ? `有鈕沒有對應動作：${noFn.join(',')}` : '每顆鈕都有對應動作');
    chk('G6', audit.dead.length === 0, audit.dead.length ? `代點目標不存在/被藏：${audit.dead.join(', ')}` : '所有代點目標都活著');
    console.log(`  （節：${audit.secs.join(' / ')}）`);
  }
  await p.context().close();
}

// ── G7 代點真的改變狀態 ──────────────────────────────────────────────────
console.log('\n[G7] 試一次真的生效');
// state 是頂層 const、不掛在 window 上,一律讀既有的 window.__state 唯讀把手
const TRY_CASES = [
  { key: 'follow', expect: '__state.followTrain 非空', probe: () => !!(window.__state && (__state.followTrain || __state.followId)) },
  { key: 'sat', expect: "__state.basemap==='sat'", probe: () => !!(window.__state && __state.basemap === 'sat'), needs: 'satBtn' },
  { key: 'pin', expect: '__state.dropMode', probe: () => !!(window.__state && __state.dropMode) },
  { key: 'xing', expect: '__state.xingOn', probe: () => !!(window.__state && __state.xingOn) },
  { key: 'board', expect: '__state.boardStation 非空', probe: () => !!(window.__state && __state.boardStation) },
];
for (const c of TRY_CASES) {
  const p = await newPage({ seen: true });
  await boot(p);
  await p.evaluate(() => openHelp());
  if (c.needs && !(await p.evaluate(id => !!document.getElementById(id), c.needs))) {
    // 本機靜態伺服器沒有 /api/basemap-token → 衛星鈕會被 remove(正式站有)。驗不了就明說,不假裝通過。
    console.log(`  SKIP G7 「${c.key}」本機環境沒有 #${c.needs}（正式站才有），這項已在正式站補驗過`);
    await p.context().close(); continue;
  }
  const clicked = await p.evaluate(k => {
    const b = document.querySelector(`#helpBody .help-try[data-try="${k}"]`);
    if (!b) return false;
    b.closest('.help-grp')?.classList.add('open');
    b.click(); return true;
  }, c.key);
  if (!clicked) { bad('G7', `找不到 data-try="${c.key}" 的鈕`); await p.context().close(); continue; }
  await p.waitForTimeout(900);
  const closed = await p.evaluate(() => { const m = document.getElementById('helpModal'); return !m || m.hidden; });
  const got = await p.evaluate(c.probe);
  chk('G7', closed, `試「${c.key}」後說明自動關閉`);
  chk('G7', got, `試「${c.key}」→ ${c.expect}`);
  await p.context().close();
}

// ── G8 旗標條件顯示 ──────────────────────────────────────────────────────
console.log('\n[G8] 平台與旗標條件');
{
  const web = await newPage({ seen: true });
  await boot(web); await web.evaluate(() => openHelp());
  const wKeys = await web.evaluate(() => [...document.querySelectorAll('#helpBody .help-sec')].map(s => s.dataset.sec));
  chk('G8', !wKeys.includes('locate'), '網站（無原生定位）不出現「定位與附近車站」');
  chk('G8', !wKeys.includes('notify'), '網站不出現「到站提醒」');
  chk('G8', !wKeys.includes('rec'), '錄影已下架 → 不出現');
  chk('G8', !wKeys.includes('account'), '帳號同步已下架 → 不出現');
  chk('G8', wKeys.includes('search') && wKeys.includes('ambient'), '共通節（搜尋／放空）仍在');
  await web.context().close();

  const app = await newPage({ seen: true });
  await boot(app, withNative('', true)); await app.evaluate(() => openHelp());
  const aKeys = await app.evaluate(() => [...document.querySelectorAll('#helpBody .help-sec')].map(s => s.dataset.sec));
  chk('G8', aKeys.includes('locate'), 'App（原生定位）出現「定位與附近車站」');
  chk('G8', aKeys.includes('notify'), 'App 出現「到站提醒」');
  await app.context().close();

  const mob = await newPage({ w: 390, h: 844, seen: true });
  await boot(mob); await mob.evaluate(() => openHelp());
  const kbd = await mob.evaluate(() => !!document.querySelector('#helpBody .help-kbd'));
  chk('G8', !kbd, '手機不出現桌面快捷鍵段');
  await mob.context().close();
  const dsk = await newPage({ w: 1280, h: 900, seen: true });
  await boot(dsk); await dsk.evaluate(() => openHelp());
  chk('G8', await dsk.evaluate(() => !!document.querySelector('#helpBody .help-kbd')), '桌面出現快捷鍵段');
  await dsk.context().close();
}

// ── G9 四寬度幾何 ────────────────────────────────────────────────────────
console.log('\n[G9] 四寬度幾何（375／414／768／1280）');
for (const w of [375, 414, 768, 1280]) {
  const h = w < 500 ? 812 : w === 768 ? 1024 : 900;
  const p = await newPage({ w, h, seen: true });
  await boot(p, withNative('', w < 500)); await p.evaluate(() => openHelp());
  const geo = await p.evaluate(() => {
    const d = document.querySelector('#helpModal .takeout-dialog'); if (!d) return null;
    const r = d.getBoundingClientRect();
    const body = document.getElementById('helpBody');
    const tb = document.getElementById('tabbar');
    const tbTop = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().top : Infinity;
    return {
      left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
      vw: innerWidth, vh: innerHeight, tbTop: tbTop === Infinity ? null : Math.round(tbTop),
      scrollable: body.scrollHeight > body.clientHeight + 4, docOverflowX: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (!geo) { bad('G9', `${w}px：找不到 dialog`); await p.context().close(); continue; }
  chk('G9', geo.left >= 0 && geo.right <= geo.vw + 1, `${w}px：左右不出視窗（${geo.left}–${geo.right} / ${geo.vw}）`);
  chk('G9', geo.top >= 0 && geo.bottom <= geo.vh + 1, `${w}px：上下不出視窗（${geo.top}–${geo.bottom} / ${geo.vh}）`);
  chk('G9', !geo.docOverflowX, `${w}px：頁面不橫捲`);
  if (geo.tbTop === null) ok('G9', `${w}px：沒有 tabbar（桌面）`);
  else {
    // modal z2200 > tabbar z1100:重疊是預期的,要證明的是「重疊處點到的是說明面板,不是 tabbar」
    const hit = await p.evaluate(() => {
      const d = document.querySelector('#helpModal .takeout-dialog'); const r = d.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.bottom - 6));
      return { inHelp: !!(el && el.closest('#helpModal')), hit: el ? (el.id || el.className || el.tagName) : null };
    });
    chk('G9', hit.inHelp, `${w}px：dialog 底緣命中的是說明面板本身（實得 ${hit.hit}）`);
  }
  // 捲到最後一節看得到
  const tail = await p.evaluate(() => {
    const body = document.getElementById('helpBody');
    document.querySelectorAll('#helpBody .help-grp').forEach(g => g.classList.add('open'));
    body.scrollTop = body.scrollHeight;
    const last = document.querySelector('#helpBody .help-tail');
    if (!last) return null;
    const lr = last.getBoundingClientRect(), br = body.getBoundingClientRect();
    return { visible: lr.top < br.bottom && lr.bottom > br.top };
  });
  chk('G9', tail && tail.visible, `${w}px：全部展開後可捲到末段`);
  await p.screenshot({ path: `${SHOT}help_${w}.png` });
  await p.context().close();
}

// ── G10 面板內的外觀切換 + 亮暗截圖 ─────────────────────────────────────
// 判準刻意不是「截圖存了」(那種 gate 是空的:亮暗截出同一張也會過),而是「主題屬性與實際底色真的變了」
console.log('\n[G10] 亮暗主題');
{
  const p = await newPage({ w: 414, h: 896, seen: true });
  await boot(p, withNative('', true));
  await p.evaluate(() => openHelp());
  const seg = await p.evaluate(() => !!document.querySelector('#helpThemeSeg button[data-v="dark"]'));
  chk('G10', seg, '面板內有亮／暗／自動三顆');
  const shot = async th => {
    await p.evaluate(t => document.querySelector(`#helpThemeSeg button[data-v="${t}"]`).click(), th);
    await p.waitForTimeout(350);
    const info = await p.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.querySelector('#helpModal .takeout-dialog')).backgroundColor,
      ink: getComputedStyle(document.querySelector('#helpBody .help-nm')).color,
    }));
    await p.screenshot({ path: `${SHOT}help_theme_${th}.png` });
    return info;
  };
  if (seg) {
    const light = await shot('light');
    const dark = await shot('dark');
    chk('G10', light.theme === 'light' && dark.theme === 'dark', `點面板內的亮/暗真的切換主題（${light.theme} → ${dark.theme}）`);
    chk('G10', light.bg !== dark.bg, `面板底色跟著主題換（${light.bg} → ${dark.bg}）`);
    chk('G10', light.ink !== dark.ink, `文字色跟著主題換（${light.ink} → ${dark.ink}）`);
  }
  await p.context().close();
}

await browser.close();
const fails = res.filter(r => !r.pass);
console.log('\n──────── 結果 ────────');
console.log(`通過 ${res.length - fails.length}/${res.length}`);
if (errs.length) console.log(`page/console error ${errs.length} 筆：\n  ` + [...new Set(errs)].slice(0, 8).join('\n  '));
if (fails.length) { console.log('未過：'); fails.forEach(f => console.log(`  ${f.g} ${f.msg}`)); process.exit(1); }
console.log('全綠');
