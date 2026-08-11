// 橫式（矮視窗）版面驗收 —— 2026-08-11。
//
// 背景：App 允許 iPhone 橫放（Info.plist 的 UISupportedInterfaceOrientations 含 LandscapeLeft/Right），
// 但整套手機殼是照直向的高瘦視窗設計的，橫放時量到四個互相獨立的缺陷（根因報告見 commit 訊息）：
//   A 底部 sheet 佔 46% 高 → 露出的地圖不足 MIN_MAP_STRIP → 讓位機制整個關掉 → 跟車時列車被面板蓋住
//   B 寬 >900 的 Pro Max 橫放掉出手機殼判定 → 走桌面長頁版面 → 列車真的在視窗外
//   C 跟隨小卡的「往上讓 46%」在矮視窗把卡推到頂端 → 壓住分頁列與時鐘徽章
//   D 讓位位移被 maxBounds 夾限吃掉（375 寬直向 zoom 6 實測 ΔLat 4.82°，相機一步都沒動）
//
// 🔴 判準刻意寫「行為」不寫「幾 px」（judgment 心得 35）：
//    「列車看得到」＝ elementFromPoint 命中地圖容器的子孫，不是「shift 等於某個數字」；
//    「側邊欄」＝ 面板讓出左半給地圖且撐到接近滿高，不是「width:360px」。
//    寫死實作值的判準跟實作同源，改一次公式就一起瞎（心得 29）。
//
// 🔴 零回歸基準取「改動前的 commit」另起同一支 server 的 /baseline.html（心得 23：
//    不可拿改後狀態自比）。BASE_REF 預設 ad63246，可用環境變數覆寫。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_REF = process.env.BASE_REF || 'ad63246';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const baselineHtml = execFileSync('git', ['show', `${BASE_REF}:index.html`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 對照組：改動前那顆 commit 的 index.html。相對路徑（data/…）仍解析到 /，資源共用同一份。
  if (url.pathname === '/baseline.html') {
    res.setHeader('content-type', 'text/html'); return res.end(baselineHtml);
  }
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
// listen(0)：這個 repo 有 30+ 個 worktree 各自跑驗收，固定埠遲早撞到別人的樹（見 verify-target-wrong-tree）
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// G0：伺服器吐的位元組必須 == 磁碟上的位元組，否則後面量什麼都不算數（心得 32：第一道 gate 自檢驗的是什麼）
{
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const wire = createHash('md5').update(Buffer.from(await (await fetch(BASE)).arrayBuffer())).digest('hex');
  if (wire !== disk) { console.error(`G0 FAIL wire=${wire} disk=${disk}`); process.exit(1); }
  const bmd5 = createHash('md5').update(baselineHtml).digest('hex');
  // 對照組與受測物同源時，L6/L7 的「零變化」必然成立＝零資訊（心得 32：不該相同卻相同是紅旗，
  // 這裡是它的反面——本來就相同的東西拿來比，會給出一片假綠）。預設硬擋；
  // ALLOW_SAME_BASE=1 只給「改動前先確認判準是紅的」那一趟用，並且把零回歸整組標成無效。
  if (bmd5 === disk && process.env.ALLOW_SAME_BASE !== '1') {
    console.error(`G0 FAIL 對照組與受測物同源（BASE_REF=${BASE_REF} 與工作樹一模一樣）——這種比對零資訊`);
    process.exit(1);
  }
  if (bmd5 === disk) console.log('[G0] ⚠️ 同源模式：L6/L7 零回歸這組不計入（改動前的紅燈基線專用）');
  console.log(`[G0] ROOT=${ROOT}`);
  console.log(`[G0] 受測 index.html md5=${disk}`);
  console.log(`[G0] 對照 ${BASE_REF}:index.html md5=${bmd5}`);
}
const SAME_SOURCE = createHash('md5').update(baselineHtml).digest('hex')
  === createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const errors = [];

// 橫式（矮視窗）：真實 iPhone 橫放的 logical point 尺寸
let LANDSCAPE = [
  { w: 667, h: 375, tag: 'SE3橫' },
  { w: 812, h: 375, tag: '13mini橫' },
  { w: 852, h: 393, tag: '16橫' },
  { w: 896, h: 414, tag: '11橫' },
  { w: 932, h: 430, tag: '16ProMax橫' }, // 寬 >900：缺陷 B 的機型
  { w: 956, h: 440, tag: '17ProMax橫' },
];
// 直向對照：375 那顆是缺陷 D 的機型，必須跟其他直向一樣綠
const PORTRAIT = [
  { w: 375, h: 812, tag: '13mini直' },
  { w: 393, h: 852, tag: '16直' },
  { w: 414, h: 896, tag: '11直' },
];
// 面板覆蓋率的分母：每一個都要真的被測到（心得 37d：覆蓋率要有具名斷言，不能只印在 detail）
const PANELS = [
  { key: 'explore', fn: 'openExplorePanel', label: '亮點' },
  { key: 'fav', fn: 'openFavPanel', label: '最愛' },
  { key: 'ride', fn: 'openRidePanel', label: '護照' },
  { key: 'search', fn: 'openSearchPanel', label: '搜尋' },
];

async function boot(browser, { w, h, tag }, { url = BASE, follow = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${tag}] console.error: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  await page.waitForTimeout(300);
  if (follow) {
    const no = await page.evaluate(async () => {
      let tries = 0;
      while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && tries < 80) { await new Promise(r => setTimeout(r, 60)); tries++; }
      for (const tr of (state.trains || [])) {
        if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
        const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
        if (s && eff > s[0].depSec + 120 && eff < s[s.length - 1].arrSec - 180) { setFollow(tr, false, true); return String(tr.train); }
      }
      return null;
    });
    if (!no) { await ctx.close(); return null; } // 沒有行駛中的台鐵車（深夜）＝環境條件，讓呼叫端明說
    await page.waitForTimeout(800);
  }
  return { ctx, page };
}

// 列車看不看得到：命中測試才算數（心得 33：驗按鈕是驗點它會發生什麼；rect 不相交只證明「看起來沒疊」）
const TRAIN_PROBE = () => {
  const tr = state.followTrain; if (!tr) return { err: 'no-follow' };
  const p = trainPos(tr, state.simSec); if (!p) return { err: 'no-pos' };
  const cp = map.latLngToContainerPoint([p.lat, p.lon]);
  const mc = map.getContainer().getBoundingClientRect();
  const cx = mc.left + cp.x, cy = mc.top + cp.y;
  const inVP = cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
  const hit = inVP ? document.elementFromPoint(cx, cy) : null;
  let onMap = false;
  for (let e = hit; e; e = e.parentElement) if (e === map.getContainer()) { onMap = true; break; }
  return {
    cx: +cx.toFixed(0), cy: +cy.toFixed(0), inVP, onMap,
    hit: hit ? (hit.id ? '#' + hit.id : (hit.className?.toString?.().slice(0, 28) || hit.tagName)) : null,
  };
};

// 可見浮層（供相交掃描）。刻意不含 header/.stage/leaflet 容器——它們是別人的父層，相交無意義。
const OVERLAY_SEL = ['#topbar', '#clock', '#randBtn', '#nearBtn', '#alertBanner', '#dwellPlate',
  '#followPanel', '#freqCard', '#trainCard', '.tabbar', '.controls',
  '#explorePanel', '#favPanel', '#ridePanel', '#searchPanel', '#nearCard', '.follow-lock-ctl'];
const OVERLAP_PROBE = (SELS) => {
  const vis = el => {
    if (!el || el.hidden) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const b = el.getBoundingClientRect();
    return b.width > 1 && b.height > 1;
  };
  const items = [];
  for (const sel of SELS) for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    const b = el.getBoundingClientRect();
    items.push({ el, n: el.id ? '#' + el.id : sel, x: b.x, y: b.y, w: b.width, h: b.height });
  }
  const inter = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue; // 父子不算相交
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 2 && oy > 2) inter.push(`${a.n}∩${b.n}=${Math.round(ox)}×${Math.round(oy)}`);
  }
  const off = items.filter(it => it.y < -1 || it.y + it.h > innerHeight + 1 || it.x < -1 || it.x + it.w > innerWidth + 1)
    .map(it => `${it.n}[${Math.round(it.x)},${Math.round(it.y)},${Math.round(it.w)}×${Math.round(it.h)}]`);
  return { inter, off, names: items.map(i => i.n) };
};

// ─────────────────────────────────────────────────────────────
// L1／L2／L4：橫式跟車 × 逐一開面板
// ─────────────────────────────────────────────────────────────
async function landscapeSuite(browser, eng) {
  for (const S of LANDSCAPE) {
    const b = await boot(browser, S);
    if (!b) { ok(`L0 ${eng}/${S.tag} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件，非產品回歸'); continue; }
    const { ctx, page } = b;

    // L3：矮視窗一律走手機殼（缺陷 B）——tabbar 要真的在、真的點得到，不是只有 class 在
    const shell = await page.evaluate(() => {
      const tb = document.querySelector('.tabbar');
      const r = tb ? tb.getBoundingClientRect() : null;
      const hit = r && r.height > 1 ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
      let onTab = false;
      for (let e = hit; e; e = e.parentElement) if (e === tb) { onTab = true; break; }
      return { fs: document.body.classList.contains('fs'), tabVisible: !!(r && r.height > 1), onTab };
    });
    ok(`L3 ${eng}/${S.tag} 走手機殼且 tab bar 點得到`, shell.fs && shell.tabVisible && shell.onTab, JSON.stringify(shell));

    // L1 乾淨態
    const clean = await page.evaluate(TRAIN_PROBE);
    ok(`L1 ${eng}/${S.tag} 無面板·列車看得見`, clean.onMap === true, JSON.stringify(clean));

    let covered = 0;
    for (const P of PANELS) {
      const opened = await page.evaluate(fn => { try { window[fn](); return 'ok'; } catch (e) { return 'err:' + e.message; } }, P.fn);
      if (opened !== 'ok') { ok(`L1 ${eng}/${S.tag} ${P.label}·開得起來`, false, opened); continue; }
      await page.waitForTimeout(650);
      covered++;

      const t = await page.evaluate(TRAIN_PROBE);
      ok(`L1 ${eng}/${S.tag} ${P.label}·列車看得見`, t.onMap === true, JSON.stringify(t));

      // 🔴 L1b：「看得見」還不夠——側欄在右邊，列車就算完全不讓位、待在容器正中央，也剛好還在
      //    露出區裡（852 寬時容器中心 426 < 側欄左緣 504）。於是「看得見」這條判準對
      //    「JS 的兩軸讓位有沒有生效」完全沒有牙：把 sheetIsSideRail() 改成恆假，44/44 照樣全綠。
      //    （心得 37：突變測試若只由實作者自己設計，會系統性漏掉他沒想到的那個維度。）
      //    讓位機制真正保證的是「主體落在露出來那塊的**正中央**」，就照這個定義驗，
      //    而且量的是實際 rect 與實際列車座標，不碰實作的帳本。
      // 🔴 必須在「放大之後」量：橫向開機是 zoom 6（台灣的南北向要塞進 393px 高），
      //    那個縮放下視窗經度跨幅 18.7° 比整個 maxBounds(10.75°) 還寬 ⇒ Leaflet 把中心完全釘死、
      //    地圖一格都不能平移，讓位在物理上不可能發生（也正是缺陷 D 的同一個根）。
      //    全島視角下整個台灣都落在側欄左邊，所以「看得見」恆真、對讓位機制零鑑別力。
      //    使用者跟車時本來就會放大，這裡就照那個真實狀態驗（心得 28：只驗初始乾淨狀態＝沒驗）。
      await page.evaluate(() => { state._autoPan = true; map.setZoom(11, { animate: false }); state._autoPan = false; });
      await page.waitForTimeout(700);
      const centered = await page.evaluate(() => {
        const el = activeSheetEl(); if (!el || el.hidden) return { err: 'no-sheet' };
        const r = el.getBoundingClientRect(), mc = map.getContainer().getBoundingClientRect();
        const tr = state.followTrain, p = trainPos(tr, state.simSec);
        if (!p) return { err: 'no-pos' };
        const cp = map.latLngToContainerPoint([p.lat, p.lon]);
        const visMidX = (Math.max(0, r.left - mc.left)) / 2; // 露出區＝容器扣掉側欄遮住的那塊
        return { zoom: map.getZoom(), trainX: +cp.x.toFixed(0), visMidX: +visMidX.toFixed(0),
                 offX: +Math.abs(cp.x - visMidX).toFixed(0), offY: +Math.abs(cp.y - mc.height / 2).toFixed(0) };
      });
      // 兩軸都要對：offX 證明水平讓位真的生效（把 sheetIsSideRail 改成恆假就會爆掉），
      // offY 證明它**沒有**順手做垂直讓位（側欄不遮上下，垂直不該動）。
      ok(`L1b ${eng}/${S.tag} ${P.label}·放大後列車在露出區正中央`,
        !centered.err && centered.offX <= 24 && centered.offY <= 24, JSON.stringify(centered));

      const o = await page.evaluate(OVERLAP_PROBE, OVERLAY_SEL);
      ok(`L2 ${eng}/${S.tag} ${P.label}·浮層不相交`, o.inter.length === 0, o.inter.join(' | '));
      ok(`L2 ${eng}/${S.tag} ${P.label}·浮層不出視窗`, o.off.length === 0, o.off.join(' '));

      // L4：橫式的面板必須是「右側欄」——讓出左半給地圖、且撐到接近滿高。
      // 寫成關係（讓出多少、佔多高）而不是 width:360px，公式改了判準才不會一起瞎。
      const side = await page.evaluate(() => {
        const el = activeSheetEl(); if (!el || el.hidden) return { err: 'no-sheet' };
        const r = el.getBoundingClientRect(), mc = map.getContainer().getBoundingClientRect();
        return {
          id: el.id,
          leftFreeRatio: +((r.left - mc.left) / mc.width).toFixed(3), // 左邊留給地圖的比例
          heightRatio: +(r.height / mc.height).toFixed(3),
          rightAnchored: Math.abs(mc.right - r.right) < 24,
        };
      });
      ok(`L4 ${eng}/${S.tag} ${P.label}·面板是右側欄`,
        !side.err && side.leftFreeRatio >= 0.4 && side.heightRatio >= 0.6 && side.rightAnchored,
        JSON.stringify(side));

      await page.evaluate(() => { soloPanel(null); updateSheetOpenClass(); });
      await page.waitForTimeout(250);
    }
    ok(`L9 ${eng}/${S.tag} 面板覆蓋率`, covered === PANELS.length, `${covered}/${PANELS.length} 真的被測到`);

    // L2b：整寬／右錨的浮層會鑽到側欄底下——這是結構性的一族，不能只驗「剛好出現的那一個」。
    // 驗收第一版就是碰運氣抓到 #dwellPlate（剛好有車停靠），換個時間點就照不到（分母靠運氣＝沒有分母）。
    // 這裡把它們逐一**強制顯示**再量真實 rect，讓覆蓋率是確定的。
    await page.evaluate(() => { openExplorePanel(); });
    await page.waitForTimeout(600);
    const wideOverlays = await page.evaluate(() => {
      const rail = activeSheetEl().getBoundingClientRect();
      const targets = ['dwellPlate', 'alertDetail', 'alertBanner'];
      const bySel = ['.xing-card', '.xing-help', '.controls'];
      const out = [];
      const measure = (name, el) => {
        if (!el) { out.push({ name, missing: true }); return; }
        const prevHidden = el.hidden, prevDisplay = el.style.display, prevVis = el.style.visibility;
        el.hidden = false; el.style.display = 'block'; el.style.visibility = 'hidden'; // 量幾何不改畫面
        const r = el.getBoundingClientRect();
        const ox = Math.min(r.right, rail.right) - Math.max(r.left, rail.left);
        const oy = Math.min(r.bottom, rail.bottom) - Math.max(r.top, rail.top);
        out.push({ name, ox: Math.round(ox), oy: Math.round(oy), overlaps: ox > 2 && oy > 2, w: Math.round(r.width) });
        el.hidden = prevHidden; el.style.display = prevDisplay; el.style.visibility = prevVis;
      };
      for (const id of targets) measure('#' + id, document.getElementById(id));
      for (const sel of bySel) measure(sel, document.querySelector(sel));
      return out;
    });
    const found = wideOverlays.filter(o => !o.missing);
    const clash = found.filter(o => o.overlaps);
    ok(`L2b ${eng}/${S.tag} 整寬浮層不鑽進側欄底下`, clash.length === 0,
      clash.map(c => `${c.name}疊${c.ox}×${c.oy}`).join(' ') || `逐一驗過 ${found.map(o => o.name).join('/')}`);
    ok(`L9 ${eng}/${S.tag} 整寬浮層覆蓋率`, found.length >= 5,
      `${found.length}/6 找得到並量到（缺的：${wideOverlays.filter(o => o.missing).map(o => o.name).join(',') || '無'}）`);
    await page.evaluate(() => { soloPanel(null); updateSheetOpenClass(); });
    await page.waitForTimeout(250);

    // 列車 sheet（點跟隨小卡展開）——它不在 SHEET_PANEL_IDS，容易漏
    const tcOpen = await page.evaluate(() => {
      const fp = document.getElementById('followPanel');
      if (!fp || fp.hidden) return 'no-fp';
      fp.click(); return 'ok';
    });
    if (tcOpen === 'ok') {
      await page.waitForTimeout(650);
      const t = await page.evaluate(TRAIN_PROBE);
      ok(`L1 ${eng}/${S.tag} 列車sheet·列車看得見`, t.onMap === true, JSON.stringify(t));
      const o = await page.evaluate(OVERLAP_PROBE, OVERLAY_SEL);
      ok(`L2 ${eng}/${S.tag} 列車sheet·浮層不相交`, o.inter.length === 0, o.inter.join(' | '));
    } else ok(`L1 ${eng}/${S.tag} 列車sheet·開得起來`, false, tcOpen);

    // L8：真互動——側邊欄開著時，點地圖露出來那半要真的點到地圖（不是被透明側欄擋住）
    await page.evaluate(() => { soloPanel(null); openExplorePanel(); });
    await page.waitForTimeout(600);
    const tap = await page.evaluate(() => {
      const el = activeSheetEl(); const r = el.getBoundingClientRect();
      const mc = map.getContainer().getBoundingClientRect();
      const x = mc.left + (r.left - mc.left) / 2, y = mc.top + mc.height / 2; // 露出區的正中
      const hit = document.elementFromPoint(x, y);
      let onMap = false;
      for (let e = hit; e; e = e.parentElement) if (e === map.getContainer()) { onMap = true; break; }
      return { x: Math.round(x), y: Math.round(y), onMap, hit: hit ? (hit.id || hit.tagName) : null };
    });
    ok(`L8 ${eng}/${S.tag} 側欄開著時仍點得到露出的地圖`, tap.onMap === true, JSON.stringify(tap));

    await ctx.close();
  }
}

// ─────────────────────────────────────────────────────────────
// L5：直向零回歸（含缺陷 D 的 375 寬）
// ─────────────────────────────────────────────────────────────
async function portraitSuite(browser, eng) {
  // 條件式判準的分支分佈要具名把關（心得 37d）：一個 if 就能讓主判準整批消失在分母裡，
  // 而畫面上還是一片 PASS。這裡釘死「只有 375 那顆會走進 clamped 分支」。
  const branchCount = { visible: 0, clamped: 0 };
  for (const S of PORTRAIT) {
    const b = await boot(browser, S);
    if (!b) { ok(`L5 ${eng}/${S.tag} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件'); continue; }
    const { ctx, page } = b;
    ok(`L5 ${eng}/${S.tag} 直向仍走手機殼`, await page.evaluate(() => document.body.classList.contains('fs')), '');
    for (const P of [PANELS[0], PANELS[2]]) {
      await page.evaluate(fn => window[fn](), P.fn);
      await page.waitForTimeout(650);
      const t = await page.evaluate(TRAIN_PROBE);
      // 🔴 條件式判準（心得 34：把期望值改成實測值之前，先做能分辨的實驗）。
      // 375 寬直向開機取到 zoom 6，那個尺度下 812px 的視窗在緯度上已經跟整個 maxBounds 一樣高
      // ⇒ Leaflet 的 _limitCenter 把中心釘死，**地圖在垂直方向一格都動不了**，讓位在物理上不可能達成。
      // 那不是回歸也不是判準過期，是「這個縮放下做不到」的環境條件（缺陷 D，需要獨立決策：
      // 改開機縮放？開面板時改成重新框景而不是平移？兩者都會動到全站行為，不在本批次範圍）。
      // 所以判準寫成：**能讓位的就必須看得見；讓不動的，至少帳面要等於實況**（帳實不符會讓
      // 後續所有差量記帳一起歪掉，那才是會擴散的傷害）。
      // 🔴 這個探針**必須量渲染出來的幾何**，不能問實作自己的帳本（state._focusShift），
      //    也不能從「已經讓位過的中心」再推一次——第一版就是那樣寫的，於是 393×852／414×896
      //    這些本來讓位成功的尺寸被判成「不可行」而跳過主判準，300/300 裡混了假綠（分母無聲縮水）。
      //    正確問法：列車現在離「容器正中央」多遠？那個距離就是**真正生效的讓位量**，
      //    與 want 相符就是讓位成功（來源＝實際 rect，與實作的公式無關，心得 29）。
      const yieldable = await page.evaluate(() => {
        const i = mapInsets(); const want = (i.bottom - i.top) / 2;
        if (!want) return { want: 0, actual: 0, canPan: true };
        const tr = state.followTrain, p = trainPos(tr, state.simSec);
        const cp = map.latLngToContainerPoint([p.lat, p.lon]);
        const mc = map.getContainer().getBoundingClientRect();
        const actual = mc.height / 2 - cp.y; // 列車比容器中心高多少＝實際讓位量
        return { want: +want.toFixed(1), actual: +actual.toFixed(1), canPan: Math.abs(actual - want) < 6 };
      });
      if (yieldable.canPan) {
        ok(`L5 ${eng}/${S.tag} ${P.label}·列車看得見`, t.onMap === true, JSON.stringify(t));
      } else {
        const honest = await page.evaluate(() => {
          const s = state._focusShift || { x: 0, y: 0 };
          const i = mapInsets(); const want = (i.bottom - i.top) / 2;
          // 帳面記的位移不得超過實際做得到的量（做不到卻記成做到＝帳實不符）
          return { logged: +(s.y || 0).toFixed(1), want: +want.toFixed(1) };
        });
        ok(`L5 ${eng}/${S.tag} ${P.label}·讓位不可行時帳面誠實`,
          Math.abs(honest.logged) <= Math.abs(honest.want) + 1,
          `maxBounds 夾死（缺陷 D，需獨立決策）: 想讓 ${yieldable.want}px 實際只讓到 ${yieldable.actual}px；帳面記 ${honest.logged}px`);
      }
      branchCount[yieldable.canPan ? 'visible' : 'clamped']++;
      // 直向的面板必須維持底部 sheet（不可被橫式規則波及）
      const bottomSheet = await page.evaluate(() => {
        const el = activeSheetEl(); const r = el.getBoundingClientRect(), mc = map.getContainer().getBoundingClientRect();
        return { fullWidth: (r.width / mc.width) > 0.85, bottomAnchored: Math.abs(mc.bottom - r.bottom) < 120 };
      });
      ok(`L5 ${eng}/${S.tag} ${P.label}·仍是底部 sheet`, bottomSheet.fullWidth && bottomSheet.bottomAnchored, JSON.stringify(bottomSheet));
      await page.evaluate(() => { soloPanel(null); updateSheetOpenClass(); });
      await page.waitForTimeout(250);
    }
    await ctx.close();
  }
  // 375 寬那顆（缺陷 D）走 clamped、其餘兩顆必須走主判準；分佈一變就是有東西悄悄跳過主判準了
  ok(`L9 ${eng} 直向條件式判準的分支分佈`, branchCount.visible === 4 && branchCount.clamped === 2,
    `列車看得見=${branchCount.visible}（期望 4：393/414 各兩個面板）、maxBounds夾死=${branchCount.clamped}（期望 2：375 兩個面板）`);
}

// ─────────────────────────────────────────────────────────────
// L6／L7：iPad 橫向與桌面「對改動前逐值零變化」
// 心得 31：比幾何前把即時狀態旗標釘死（班次數文字、LIVE 徽章、尖峰徽章都會改寬度）
// ─────────────────────────────────────────────────────────────
const FREEZE = () => {
  const c = document.getElementById('clock'); if (c) c.textContent = '00:00';
  for (const id of ['liveBadge', 'peak', 'replayBadge', 'metroBadge']) {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  }
  const n = document.querySelector('.badge .n'); if (n) n.textContent = '000';
};
const GEOM = () => {
  const out = {};
  for (const sel of ['header', '.stage', '.controls', '.tabbar', '#followPanel', '#trainCard',
    '.plate', '#lead', '.grouptabs', '#explorePanel', '#board', '.leaflet-bottom.leaflet-right']) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    out[sel] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), cs.position, cs.display];
  }
  out['__fs'] = document.body.classList.contains('fs');
  out['__mq'] = matchMedia('(max-width: 900px)').matches;
  return out;
};
async function zeroRegressionSuite(browser, eng) {
  if (SAME_SOURCE) { console.log(`SKIP L6/L7 ${eng} 零回歸（同源模式，這組現在毫無資訊量）`); return; }
  for (const S of [{ w: 1024, h: 768, tag: 'iPad橫' }, { w: 1280, h: 800, tag: '桌面1280' }, { w: 768, h: 1024, tag: 'iPad直' }]) {
    const cur = await boot(browser, S, { follow: false });
    await cur.page.evaluate(FREEZE);
    const a = await cur.page.evaluate(GEOM);
    await cur.ctx.close();
    const bas = await boot(browser, S, { url: BASE + 'baseline.html', follow: false });
    await bas.page.evaluate(FREEZE);
    const c = await bas.page.evaluate(GEOM);
    await bas.ctx.close();
    const diff = [];
    for (const k of Object.keys(c)) if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) diff.push(`${k}: ${JSON.stringify(c[k])} → ${JSON.stringify(a[k])}`);
    ok(`L6/L7 ${eng}/${S.tag} 對 ${BASE_REF} 逐值零變化`, diff.length === 0, diff.join(' | '));
  }
}

// QUICK=1：突變測試用的縮減版（單引擎、兩個橫向尺寸）。突變測試要跑很多輪，
// 全套一輪約五分鐘會讓人偷懶不做——但縮減版**不可**用來下「全綠」的結論。
const QUICK = process.env.QUICK === '1';
if (QUICK) { LANDSCAPE.splice(0, LANDSCAPE.length, { w: 852, h: 393, tag: '16橫' }, { w: 932, h: 430, tag: '16ProMax橫' }); }
for (const [eng, B] of (QUICK ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
  const browser = await B.launch();
  await landscapeSuite(browser, eng);
  if (!QUICK) { await portraitSuite(browser, eng); await zeroRegressionSuite(browser, eng); }
  await browser.close();
}
server.close();

const pass = results.filter(r => r.pass).length;
console.log(`\n===== ${pass}/${results.length} =====`);
if (errors.length) { console.log(`\n主控台錯誤 ${errors.length} 筆：`); errors.slice(0, 10).forEach(e => console.log('  ' + e)); }
const failed = results.filter(r => !r.pass);
if (failed.length) { console.log(`\n未過 ${failed.length} 項：`); failed.forEach(f => console.log(`  ${f.name} — ${f.detail}`)); }
process.exit(failed.length || errors.length ? 1 : 0);
