// 橫式（矮視窗）版面驗收 —— 2026-08-11。
//
// 背景：App 允許 iPhone 橫放（Info.plist 的 UISupportedInterfaceOrientations 含 LandscapeLeft/Right），
// 但整套手機殼是照直向的高瘦視窗設計的，橫放時量到四個互相獨立的缺陷（根因報告見 commit 訊息）：
//   A 底部 sheet 佔 46% 高 → 露出的地圖不足 MIN_MAP_STRIP → 讓位機制整個關掉 → 跟車時列車被面板蓋住
//   B 寬 >900 的 Pro Max 橫放掉出手機殼判定 → 走桌面長頁版面 → 列車真的在視窗外
//   C 跟隨小卡的「往上讓 46%」在矮視窗把卡推到頂端 → 壓住分頁列與時鐘徽章
//   D 讓位位移被 maxBounds 夾限吃掉（375 寬直向 zoom 6 實測 ΔLat 4.82°，相機一步都沒動）
//     → 使用者 08-11 親自指認的「台灣沒有置中」就是 D 的可見形態：Leaflet 拿**整個容器**當可視框
//       去夾 maxBounds，於是把台灣釘在容器正中央，而容器正中央正好在面板底下。修法＝夾限改用
//       「露出來的那塊」（index.html 的 map._limitCenter 覆寫），無面板時原封走原生路徑。
//
// 🔴 判準刻意寫「行為」不寫「幾 px」（judgment 心得 35）：
//    「列車看得到」＝ elementFromPoint 命中地圖容器的子孫，不是「shift 等於某個數字」；
//    「側邊欄」＝ 面板讓出左半給地圖且撐到接近滿高，不是「width:360px」。
//    寫死實作值的判準跟實作同源，改一次公式就一起瞎（心得 29）。
//
// 🔴 零回歸基準取「改動前的 commit」另起同一支 server 的 /baseline.html（心得 23：
//    不可拿改後狀態自比）。BASE_REF 預設 ad63246，可用環境變數覆寫。
//
// ── 這些判準是怎麼被證明「有牙」的（下次改側欄相關程式碼前先看這段） ──
// 做法：把改壞的 index.html 放進一個獨立目錄（其餘資源 symlink 借用），用同一支腳本 QUICK 跑。
//   🔴 腳本本身要用**複製**不能用 symlink：Node 會把 import.meta.url 解析成真實路徑，
//      ROOT 直接指回工作樹 ⇒ 六輪突變全部在測原始檔、全綠、零資訊（心得 32 的驗錯目標）。
//      跑之前先斷言「G0 印出的受測 md5 == 突變檔的 md5」，這道 gate 當場就會抓到。
// 已驗證會轉紅的突變（括號內是抓到它的判準）：
//   側欄選擇器拿掉 #nearCard      → 它退回底部 sheet、只露 152px 地圖，讓位整組關掉（L4）
//   sheetHasSizeSteps 拿掉側欄閘  → 側欄又有三段高，點標題列就掛 sheet-full、頂列整組淡出（L10）
//   tab bar 第一顆 pointer-events:none → 搜尋分頁再也點不開（L11 逐顆真觸控＋覆蓋率）
//   側欄整組 opacity:.35          → 地圖透出來、字讀不了，而 rect 完全沒變（L4b／L10 可讀性）
//   resize 不重跑 updateSheetOpenClass → 直向大段轉橫後頂列點不到、讓位軸不對帳（L10／L10b）
//   停靠時小卡不淡出              → 852×393 實測與站名牌疊 176×12px（L2c）
//   拿掉 _limitCenter 覆寫        → 台灣被夾回容器中央：橫式偏 174px、直向偏 195.8px（L12）
// 控制組（只加一行註解）必須全綠——沒有控制組就不知道紅的是不是自己以為的那件事。
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
  { key: 'explore', label: '亮點', call: 'openExplorePanel()' },
  { key: 'fav', label: '最愛', call: 'openFavPanel()' },
  { key: 'ride', label: '護照', call: 'openRidePanel()' },
  { key: 'search', label: '搜尋', call: 'openSearchPanel()' },
  // 🔴 獨立驗收（2026-08-11）抓到的分母缺口：這兩個同樣是 SHEET_PANEL_IDS 成員、同樣吃側欄那組規則，
  //    只因為「開啟方式要帶參數」而從來沒被開起來量過形態。實測後果：把 #nearCard 從側欄選擇器拿掉，
  //    舊分母下整套 374/374 全綠，但它退回底部 sheet 只露出 152px 地圖（< MIN_MAP_STRIP 160）
  //    ⇒ mapInsets() 回全 0 ⇒ 讓位機制整組關掉＝這批要修的缺陷 A 原地復活。
  { key: 'near', label: '附近車站', call: 'openNearbyStations(25.0478, 121.5170, 50)', clearsFollow: true },
  { key: 'board', label: '車站看板', call: 'openBoard(state.schedStations[0])' },
];
// 開啟方式一律走真的入口函式（不是直接改 hidden）——形態是那些函式連同 updateSheetOpenClass 一起決定的
const openPanel = (page, P) => page.evaluate(src => {
  try { (0, eval)(src); return 'ok'; } catch (e) { return 'err:' + e.message; }
}, P.call);

// 挑一班行駛中的台鐵車來跟。抽成具名探針：clearsFollow 的面板（附近車站會依設計清掉跟隨）
// 測完要能把跟隨接回來，否則面板的先後順序會變成隱形的前置條件（後面每一項都沒車可量）。
const PICK_FOLLOW = async () => {
  let tries = 0;
  while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && tries < 80) { await new Promise(r => setTimeout(r, 60)); tries++; }
  for (const tr of (state.trains || [])) {
    if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
    const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
    if (s && eff > s[0].depSec + 120 && eff < s[s.length - 1].arrSec - 180) { setFollow(tr, false, true); return String(tr.train); }
  }
  return null;
};

async function boot(browser, { w, h, tag }, { url = BASE, follow = true, sheetSize = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(sz => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light');
      if (sz) localStorage.setItem('trainmap-sheet-size', sz);
    } catch (e) {}
  }, sheetSize);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${tag}] console.error: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  await page.waitForTimeout(300);
  if (follow) {
    const no = await page.evaluate(PICK_FOLLOW);
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

// 面板形態：寫成關係（讓出多少給地圖、佔多高、貼哪一邊）而不是 width:360px，
// 公式改了判準才不會跟著一起瞎（心得 29/35）。
const SIDE_RAIL_PROBE = () => {
  const el = activeSheetEl(); if (!el || el.hidden) return { err: 'no-sheet' };
  const r = el.getBoundingClientRect(), mc = map.getContainer().getBoundingClientRect();
  return {
    id: el.id,
    leftFreeRatio: +((r.left - mc.left) / mc.width).toFixed(3), // 左邊留給地圖的比例
    heightRatio: +(r.height / mc.height).toFixed(3),
    rightAnchored: Math.abs(mc.right - r.right) < 24,
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

// 相交掃描要量「穩定態」：`.dwell-plate` 用 opacity + **0.45s transition** 淡出，而 `dwell-show`
// 旗標是瞬間移除的 ⇒ 列車離站那半秒，站名牌還在淡出、跟隨小卡已經淡回來，橫式的矮視窗裡兩者
// 幾何上真的會交疊（實測 176×30）。那是交叉淡入淡出的過場，不是版面缺陷。
// 但也不能直接放寬判準——所以做法是：發現相交就等**超過最長 transition**再量一次，以第二次為準。
// 真缺陷等再久也還在（這個等待對它零影響），只有轉場中的假陽性會消失。
async function settledOverlap(page) {
  const first = await page.evaluate(OVERLAP_PROBE, OVERLAY_SEL);
  if (!first.inter.length && !first.off.length) return { ...first, reMeasured: false };
  await page.waitForTimeout(600); // > .45s（.dwell-plate 的 opacity transition）
  const second = await page.evaluate(OVERLAP_PROBE, OVERLAY_SEL);
  return { ...second, reMeasured: true };
}

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

    let coveredForm = 0, coveredTrain = 0;
    for (const P of PANELS) {
      const opened = await openPanel(page, P);
      if (opened !== 'ok') { ok(`L1 ${eng}/${S.tag} ${P.label}·開得起來`, false, opened); continue; }
      await page.waitForTimeout(650);
      coveredForm++;

      // 🔴 側欄必須讀得懂：整片面板被 opacity 淡掉（地圖整片透出來、字看不清）時，
      //    rect 完全沒變、命中測試照樣命中、相交掃描的 vis() 門檻（0.05）也照樣算它可見
      //    ⇒ 舊判準對「側欄變半透明」零鑑別力（獨立驗收的 G4 突變 374/374 全綠）。
      //    這裡只管「有沒有被 opacity 淡掉」；使用者明示的半透明契約（背景 alpha .30 + blur 3px）
      //    走 background-color，交給 L10 的「與直向形態同值」相對判準，不在這裡寫死數字。
      const readable = await page.evaluate(() => {
        const el = activeSheetEl(); if (!el || el.hidden) return { err: 'no-sheet' };
        let eff = 1;
        for (let e = el; e && e !== document.documentElement; e = e.parentElement) eff *= parseFloat(getComputedStyle(e).opacity) || 0;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        let onSelf = false;
        for (let e = hit; e; e = e.parentElement) if (e === el) { onSelf = true; break; }
        return { id: el.id, eff: +eff.toFixed(3), onSelf };
      });
      ok(`L4b ${eng}/${S.tag} ${P.label}·側欄沒被淡掉且擋得住底下`,
        !readable.err && readable.eff >= 0.99 && readable.onSelf === true, JSON.stringify(readable));

      if (P.clearsFollow) {
        // 依設計：開附近車站會清掉跟隨（openNearbyStations 內的互斥入口）。
        // 這類面板的形態／相交／可讀性照驗，列車那組判準不適用——但分母要分開具名，不能混在一起蓋掉。
        const o0 = await settledOverlap(page);
        ok(`L2 ${eng}/${S.tag} ${P.label}·浮層不相交`, o0.inter.length === 0, o0.inter.join(' | '));
        const side0 = await page.evaluate(SIDE_RAIL_PROBE);
        ok(`L4 ${eng}/${S.tag} ${P.label}·面板是右側欄`,
          !side0.err && side0.leftFreeRatio >= 0.4 && side0.heightRatio >= 0.6 && side0.rightAnchored, JSON.stringify(side0));
        await page.evaluate(() => { soloPanel(null); updateSheetOpenClass(); });
        const back = await page.evaluate(PICK_FOLLOW);
        ok(`L0 ${eng}/${S.tag} ${P.label}·測完接回跟隨`, !!back, back ? `車次 ${back}` : '接不回來→後面每一項都會沒車可量');
        await page.waitForTimeout(500);
        continue;
      }
      coveredTrain++;

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

      const o = await settledOverlap(page);
      ok(`L2 ${eng}/${S.tag} ${P.label}·浮層不相交`, o.inter.length === 0, o.inter.join(' | ') + (o.reMeasured ? '（已等轉場穩定後重量）' : ''));
      ok(`L2 ${eng}/${S.tag} ${P.label}·浮層不出視窗`, o.off.length === 0, o.off.join(' '));

      // L4：橫式的面板必須是「右側欄」——讓出左半給地圖、且撐到接近滿高。
      // 寫成關係（讓出多少、佔多高）而不是 width:360px，公式改了判準才不會一起瞎。
      const side = await page.evaluate(SIDE_RAIL_PROBE);
      ok(`L4 ${eng}/${S.tag} ${P.label}·面板是右側欄`,
        !side.err && side.leftFreeRatio >= 0.4 && side.heightRatio >= 0.6 && side.rightAnchored,
        JSON.stringify(side));

      await page.evaluate(() => { soloPanel(null); updateSheetOpenClass(); });
      await page.waitForTimeout(250);
    }
    // 兩個分母分開具名：形態這組每一顆都要驗到；列車那組只對「不會清掉跟隨」的面板成立。
    // 合成一個分母的話，只要有人把某顆面板改成會清跟隨，列車判準就會無聲少掉一顆而畫面照樣全綠。
    const trainable = PANELS.filter(p => !p.clearsFollow).length;
    ok(`L9 ${eng}/${S.tag} 面板形態覆蓋率`, coveredForm === PANELS.length, `${coveredForm}/${PANELS.length} 真的被開起來量過`);
    ok(`L9 ${eng}/${S.tag} 列車判準覆蓋率`, coveredTrain === trainable, `${coveredTrain}/${trainable}（附近車站依設計會清跟隨，不計入）`);

    // L11：tab bar 五顆逐一真觸控（心得 37b/c）。舊判準只對 tab bar **正中央**做一次命中測試，
    // 實測命中的是「最愛」那顆 ⇒ 對「其中一顆死掉」零鑑別力：把第一顆設成 pointer-events:none，
    // 舊分母下 374/374 全綠，實際上搜尋分頁再也點不開。這裡逐顆 tap 並斷言它真的做了該做的事。
    await page.evaluate(() => { soloPanel(null); if (document.body.classList.contains('tools-open')) document.getElementById('moreClose').click(); updateSheetOpenClass(); });
    await page.waitForTimeout(250);
    const TABS = [
      { id: 'tabSearch', want: 'searchPanel', label: '搜尋' },
      { id: 'tabExplore', want: 'explorePanel', label: '亮點' },
      { id: 'tabFav', want: 'favPanel', label: '最愛' },
      { id: 'tabRide', want: 'ridePanel', label: '護照' },
      { id: 'tabMore', want: null, label: '更多' },
    ];
    let tabHit = 0;
    for (const T of TABS) {
      let tapped = true;
      try { await page.tap('#' + T.id, { timeout: 3000 }); } catch (e) { tapped = false; }
      await page.waitForTimeout(450);
      const acted = await page.evaluate(w => w ? !document.getElementById(w).hidden : document.body.classList.contains('tools-open'), T.want);
      ok(`L11 ${eng}/${S.tag} tab「${T.label}」真觸控有反應`, tapped && acted, `tap=${tapped} 開了=${acted}`);
      if (tapped && acted) tabHit++;
      await page.evaluate(() => { soloPanel(null); if (document.body.classList.contains('tools-open')) document.getElementById('moreClose').click(); updateSheetOpenClass(); });
      await page.waitForTimeout(200);
    }
    ok(`L9 ${eng}/${S.tag} tab bar 覆蓋率`, tabHit === TABS.length, `${tabHit}/${TABS.length} 逐顆真觸控驗過`);
    const refollow = await page.evaluate(PICK_FOLLOW);
    ok(`L0 ${eng}/${S.tag} tab 測完接回跟隨`, !!refollow, refollow ? `車次 ${refollow}` : '接不回來');
    await page.waitForTimeout(500);

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

    // L2c：列車正在停靠站（body.dwell-show）。這個狀態純粹看跑的當下有沒有車在停站，
    // 靠運氣量不到——第一版就是這樣間歇性地紅過一次然後又自己消失（分母靠運氣＝沒有分母）。
    // 判準寫使用者看得到的性質：「站名牌與跟隨小卡不會同時搶同一塊畫面」。
    // 實現方式有兩種都可以（既有做法是讓小卡淡出，另一種是排開到不相交），所以判準不綁實現，
    // 但也因此不能只驗其中一種——先問淡了沒，沒淡就必須真的不相交。
    // （這條判準立起來的當天就打臉了一個「前提已失效」的假設：我一度以為側欄形態下兩者不再相交
    //   而加了豁免，852×393 實測仍疊 176×12px。判準比推論可靠。）
    const dwell = await page.evaluate(() => {
      const dp = document.getElementById('dwellPlate'), fp = document.getElementById('followPanel');
      if (!fp || fp.hidden) return { err: 'no-follow-panel' };
      const prevHidden = dp.hidden, prevVis = dp.style.visibility, prevHtml = dp.innerHTML;
      dp.hidden = false; dp.style.visibility = 'hidden'; // 量幾何不改畫面
      if (!dp.textContent.trim()) dp.textContent = '停靠中 臺北'; // 空的話 rect 會是 0，相交判準就沒牙
      document.body.classList.add('dwell-show');
      let eff = 1; for (let e = fp; e && e !== document.documentElement; e = e.parentElement) eff *= parseFloat(getComputedStyle(e).opacity) || 0;
      const a = fp.getBoundingClientRect(), b = dp.getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const out = { eff: +eff.toFixed(2), pe: getComputedStyle(fp).pointerEvents,
        plate: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        overlap: ox > 2 && oy > 2, ox: Math.round(ox), oy: Math.round(oy) };
      document.body.classList.remove('dwell-show');
      dp.hidden = prevHidden; dp.style.visibility = prevVis; dp.innerHTML = prevHtml;
      return out;
    });
    const faded = !dwell.err && (dwell.eff < 0.05 || dwell.pe === 'none');
    ok(`L2c ${eng}/${S.tag} 停靠中·站名牌與跟隨小卡不互搶畫面`,
      !dwell.err && (faded || dwell.overlap === false),
      `走「${faded ? '小卡淡出讓位' : '排開到不相交'}」 ${JSON.stringify(dwell)}`);
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
      const o = await settledOverlap(page);
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
      await openPanel(page, P);
      await page.waitForTimeout(650);
      const t = await page.evaluate(TRAIN_PROBE);
      // 🔴 條件式判準（心得 34：把期望值改成實測值之前，先做能分辨的實驗）。
      // 原本 375 寬直向開機取到 zoom 6，812px 的視窗在緯度上比整個 maxBounds 還高
      // ⇒ Leaflet 的 _limitCenter 把中心釘死、讓位在物理上做不到（曾標為「缺陷 D」）。
      // 2026-08-11 已從語意層修掉：夾限的可視框改成「露出來的那塊」而不是整個容器，
      // 於是 812px 的視窗被面板遮掉一半之後，剩下的 400px 遠小於 maxBounds ⇒ 又能自由平移了。
      // clamped 分支因此**應該恆為 0**，但刻意保留：它是「夾死又回來了」的哨兵，
      // 真的走進去時至少要保證帳面等於實況（帳實不符會讓後續所有差量記帳一起歪掉）。
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
  // 三個尺寸 × 兩個面板全部都要走主判準；clamped 是「夾死回來了」的哨兵，走進去就是回歸。
  // （這條斷言本身就是缺陷 D 修好的證據：修之前 375 那兩個必然落在 clamped。）
  ok(`L9 ${eng} 直向條件式判準的分支分佈`, branchCount.visible === 6 && branchCount.clamped === 0,
    `列車看得見=${branchCount.visible}（期望 6：375/393/414 各兩個面板）、maxBounds夾死=${branchCount.clamped}（期望 0）`);
}

// ─────────────────────────────────────────────────────────────
// L10：轉向（直↔橫）之後的形態對帳
//
// 🔴 這組是獨立驗收（2026-08-11，未參與實作的 agent）抓到的真缺陷所立的判準。
//    症狀：在直向把面板拉到大段（`trainmap-sheet-size` 是**跨 session 持久化的偏好**，
//    使用者按一下就會留著）之後轉成橫向，`body.sheet-full` 沒有被重算。側欄形態下面板只佔 40% 寬，
//    但 sheet-full 那組規則照樣把整條頂列、站名牌、隨機跟隨鈕、時鐘徽章、跟隨小卡淡出並關掉指標事件
//    ⇒ 地圖上方一片空白、分組頁籤真的點不到（雙引擎 page.tap 逾時）。
//    根因：resize 監聽只在跨越手機殼斷點時做事，從不重跑 updateSheetOpenClass()——
//    而 sheetHasSizeSteps() 依 sheetIsSideRail()，也就是「轉向」正好會讓它的前提整組翻面。
// 🔴 判準寫「使用者做得到什麼」不寫 class 名：既驗 body.sheet-full 這個直接原因，
//    也驗它的可見後果（常駐控件的有效 opacity／指標事件／真觸控），兩層都在才抓得住換一種寫法的回歸。
// 🔴 大段是實驗組、中段是控制組：修好前中段本來就該全綠（沒有 sheet-full），
//    兩組都紅代表判準抓到的是別的東西（心得 35b：沒有控制組就不知道紅的是不是自己以為的那件事）。
// ─────────────────────────────────────────────────────────────
// 🔴 選擇器要選到「手機殼裡的那一顆」：`.grouptabs` 全頁有兩組（桌面 header 一組、手機 topbar 一組，
//    共 8 顆 gtab），手機殼下桌面那組的 rect 是 0×0。第一版判準選到桌面那顆，於是對「頂列被淡出」
//    這件事完全沒有牙（它根本不在 .topbar 裡、不吃 sheet-full 規則），還讓 tap 永遠逾時。
const CHROME_SEL = [['分組頁籤', '.topbar .grouptabs'], ['站名牌', '.tb-plate'], ['隨機跟隨', '#randBtn'], ['時鐘', '#clock'], ['跟隨小卡', '#followPanel']];
const GTAB_SEL = '.topbar .grouptabs .gtab';
const CHROME_PROBE = () => {
  const eff = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0; return o; };
  const out = { __sheetFull: document.body.classList.contains('sheet-full') };
  for (const [name, sel] of [['分組頁籤', '.topbar .grouptabs'], ['站名牌', '.tb-plate'], ['隨機跟隨', '#randBtn'], ['時鐘', '#clock'], ['跟隨小卡', '#followPanel']]) {
    const el = document.querySelector(sel);
    if (!el || el.hidden || getComputedStyle(el).display === 'none') { out[name] = null; continue; }
    out[name] = { eff: +eff(el).toFixed(3), pe: getComputedStyle(el).pointerEvents };
  }
  const el = activeSheetEl();
  if (el && !el.hidden) {
    let eo = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) eo *= parseFloat(getComputedStyle(e).opacity) || 0;
    const bg = getComputedStyle(el).backgroundColor, m = bg.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map(s => parseFloat(s)) : [];
    out.__panel = { id: el.id, eff: +eo.toFixed(3), alpha: parts.length >= 4 ? parts[3] : 1,
      wRatio: +(el.getBoundingClientRect().width / innerWidth).toFixed(2) };
  } else out.__panel = null;
  return out;
};
// 🔴 相對判準：拿「同一次執行的直向乾淨態」當基準，只問「有沒有比原本更差」。
//    絕對判準（pe !== 'none'）會誤判——`#clock` 是徽章不是按鈕，它的 pointer-events 本來就是 none
//    （讓點擊穿透到地圖），寫死 pe 要求會把既有設計判成缺陷（心得 34：紅有三種互斥原因，
//    這是「判準過期」偽裝成「產品回歸」）。退化的定義只有兩種：本來看得到的變淡了、本來點得到的變不能點。
const degraded = (base, now) => CHROME_SEL.map(([k]) => [k, base[k], now[k]])
  .filter(([, b, n]) => b && (!n || n.eff < b.eff - 0.01 || (b.pe !== 'none' && n.pe === 'none')))
  .map(([k, b, n]) => n ? `${k}(opacity ${b.eff}→${n.eff}／pe ${b.pe}→${n.pe})` : `${k}(整個不見了)`);

async function rotationSuite(browser, eng) {
  // 🔴 基準必須是「同一個形態下的常態」＝橫式側欄開著面板時，本來就該看得到／點得到什麼。
  //    不能拿直向的任何狀態當基準：直向底部 sheet 蓋住下半，跟隨小卡讓位淡出是**設計**，
  //    拿它比會把正常行為算成退化；而 large 的直向態自己就是淡出的，拿它當基準又會把 F1 一起放行。
  //    也不能在受測頁面上「關掉面板再開」來取基準——那等於替它跑了一次 updateSheetOpenClass，
  //    正好把要測的殘留洗掉（基準的取得方式不得干擾受測狀態，心得 29 的同族）。
  let railBase = null;
  {
    const lb = await boot(browser, { w: 852, h: 393, tag: '橫式常態基準' });
    if (lb) {
      await lb.page.tap('#tabExplore');
      await lb.page.waitForTimeout(750);
      railBase = await lb.page.evaluate(CHROME_PROBE);
      ok(`L10 ${eng} 橫式常態基準·面板開著且不掛 sheet-full`, !!railBase.__panel && railBase.__sheetFull === false, JSON.stringify({ full: railBase.__sheetFull, panel: railBase.__panel }));
      await lb.ctx.close();
    } else ok(`L10 ${eng} 橫式常態基準`, false, '深夜無台鐵車＝環境條件');
  }
  for (const sz of ['large', 'medium']) {
    const b = await boot(browser, { w: 393, h: 852, tag: `直→橫(${sz})` }, { sheetSize: sz });
    if (!b) { ok(`L10 ${eng}/${sz} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件'); continue; }
    const { ctx, page } = b;
    // 全程走使用者做得到的動作：點 tab bar 開面板，然後轉向。不碰任何內部 API。
    await page.tap('#tabExplore');
    await page.waitForTimeout(750);
    const pre = await page.evaluate(CHROME_PROBE);
    ok(`L10 ${eng}/${sz} 直向前置·面板開著且段高是 ${sz}`,
      !!pre.__panel && pre.__sheetFull === (sz === 'large'), JSON.stringify({ full: pre.__sheetFull, panel: pre.__panel }));

    await page.setViewportSize({ width: 852, height: 393 });
    await page.waitForTimeout(900);
    const post = await page.evaluate(CHROME_PROBE);
    ok(`L10 ${eng}/${sz} 轉橫後不再掛 body.sheet-full`, post.__sheetFull === false, JSON.stringify({ full: post.__sheetFull, panel: post.__panel }));
    ok(`L10 ${eng}/${sz} 轉橫後常駐控件沒有比橫式常態差`, !railBase || degraded(railBase, post).length === 0,
      (railBase ? degraded(railBase, post).join(' ') : '無基準') || `對橫式常態逐一比過：${CHROME_SEL.map(s => s[0]).join('/')}`);

    // 側欄可讀性：相對於同一顆面板在直向底部 sheet 形態的值（不寫死數字——
    // 使用者明示的半透明契約走 background alpha .30，寫死 ≥0.95 會把那個契約判成缺陷）
    ok(`L10 ${eng}/${sz} 側欄可讀性不低於直向形態`,
      !!post.__panel && !!pre.__panel && post.__panel.eff >= pre.__panel.eff - 0.01 && post.__panel.alpha >= pre.__panel.alpha - 0.01,
      JSON.stringify({ 直向: pre.__panel, 橫向: post.__panel }));

    // 轉回直向：形態與段高偏好都要回來（單向修好、反向卡住也是缺陷）
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(900);
    const back = await page.evaluate(() => {
      const el = activeSheetEl(); if (!el || el.hidden) return { err: 'no-sheet' };
      const r = el.getBoundingClientRect(), mc = map.getContainer().getBoundingClientRect();
      return { id: el.id, wRatio: +(r.width / mc.width).toFixed(2), bottomAnchored: Math.abs(mc.bottom - r.bottom) < 120,
        size: el.classList.contains('expand') ? 'large' : el.classList.contains('sheet-small') ? 'small' : 'medium' };
    });
    ok(`L10 ${eng}/${sz} 轉回直向·回到底部 sheet 且段高偏好還在`,
      !back.err && back.wRatio > 0.85 && back.bottomAnchored && back.size === sz, JSON.stringify(back));

    // 真觸控收尾（換組會關掉面板，所以放在所有形態斷言之後）：分組頁籤按下去要真的換組。
    // 心得 37a：命中測試對祖先容器恆真，答不了「做得到嗎」——只有真的按一次並看它改變狀態才算數。
    await page.setViewportSize({ width: 852, height: 393 });
    await page.waitForTimeout(900);
    let tapped = true, switched = false;
    try {
      const idx = await page.evaluate(sel => [...document.querySelectorAll(sel)].findIndex(g => !g.classList.contains('active')), GTAB_SEL);
      if (idx < 0) tapped = false;
      else {
        await page.tap(`${GTAB_SEL} >> nth=${idx}`, { timeout: 3000 });
        await page.waitForTimeout(500);
        switched = await page.evaluate(([sel, i]) => [...document.querySelectorAll(sel)][i].classList.contains('active'), [GTAB_SEL, idx]);
      }
    } catch (e) { tapped = false; }
    ok(`L10 ${eng}/${sz} 來回轉兩次後分組頁籤真的按得動`, tapped && switched, `tap=${tapped} 換組了=${switched}`);
    await ctx.close();
  }

  // L10b：讓位軸向的對帳。跟車／放空每幀都會重新取景所以會自癒，**沒在跟車**時才看得到——
  // 轉向後讓位軸從垂直換成水平，若沒有重跑一次差量記帳，鏡頭會停在舊的垂直位移上。
  // 🔴 真值取「固定地理點實際渲染在哪」，不問實作自己的帳本 state._focusShift（心得 29：判準不得與實作同源）。
  const b2 = await boot(browser, { w: 393, h: 852, tag: '轉向讓位對帳' }, { follow: false });
  const { ctx: c2, page: p2 } = b2;
  const ANCHOR = [24.5, 121.0]; // 台灣中部：zoom 9 下四周都還在 maxBounds 內，不會被夾（缺陷 D 的干擾排除）
  await p2.evaluate(a => { state._autoPan = true; map.setView(a, 9, { animate: false }); state._autoPan = false; }, ANCHOR);
  await p2.waitForTimeout(400);
  const OFFSET = a => {
    const cp = map.latLngToContainerPoint(a), mc = map.getContainer().getBoundingClientRect();
    const i = mapInsets();
    return { offX: +(cp.x - mc.width / 2).toFixed(0), offY: +(cp.y - mc.height / 2).toFixed(0),
      wantX: +((i.right - i.left) / 2).toFixed(0), wantY: +((i.bottom - i.top) / 2).toFixed(0) };
  };
  const o0 = await p2.evaluate(OFFSET, ANCHOR);
  ok(`L10b ${eng} 起手·錨點在容器正中央`, Math.abs(o0.offX) <= 4 && Math.abs(o0.offY) <= 4, JSON.stringify(o0));
  await p2.tap('#tabExplore');
  await p2.waitForTimeout(800);
  const o1 = await p2.evaluate(OFFSET, ANCHOR);
  ok(`L10b ${eng} 直向開面板·鏡頭往上讓（錨點下移量 = 想讓的量）`,
    o1.wantY > 40 && Math.abs(-o1.offY - o1.wantY) <= 8, JSON.stringify(o1));
  await p2.setViewportSize({ width: 852, height: 393 });
  await p2.waitForTimeout(900);
  const o2 = await p2.evaluate(OFFSET, ANCHOR);
  // 轉橫後：讓位改成水平（錨點左移 wantX），垂直那份必須被退掉（offY 回到 0）
  ok(`L10b ${eng} 轉橫後·讓位軸真的從垂直換成水平`,
    o2.wantX > 40 && o2.wantY === 0 && Math.abs(-o2.offX - o2.wantX) <= 8 && Math.abs(o2.offY) <= 8,
    JSON.stringify(o2));
  await c2.close();
}

// ─────────────────────────────────────────────────────────────
// L12：全島視角下，台灣要置中於「露出來的那塊地圖」
//
// 🔴 使用者 2026-08-11 親自指出：橫放開著面板時，台灣整個偏右貼著側欄。
//    根因＝maxBounds 的夾限用「整個容器」當可視範圍，於是被面板蓋住的那塊也被要求塞在框內，
//    結果把台灣釘在容器正中央；而容器正中央在側欄底下。全島視角（開機 zoom）時視窗比
//    maxBounds 還大 ⇒ 相機完全不能平移 ⇒ 讓位機制想推也推不動（就是原本標為「缺陷 D」的那個）。
// 🔴 真值來源刻意不碰實作：maxBounds 是設定值（外部常數），露出區從**面板與容器的實際 rect**
//    推出來（面板貼右且撐滿高＝側欄遮右，否則＝底部 sheet 遮下），完全不呼叫 mapInsets()／
//    sheetIsSideRail()。判準與實作同源會一起瞎（心得 29）。
// 🔴 不跟車：跟車時鏡頭跟著列車走，「台灣在哪」由列車決定，量了沒有意義。
//    這一組量的是開機那個全島視角，也就是使用者截圖裡的那個狀態。
// ─────────────────────────────────────────────────────────────
// 🔴 相對判準：不問「台灣中心應該在哪個絕對座標」，只問「開面板前後，它在**看得到的那塊**裡的
//    相對位置有沒有變」。這樣就不必為兩件事訂容差——(a) maxBounds 是平移硬牆不是台灣本身、
//    (b) `getCenter()` 取的是經緯度中點，而 Mercator 下緯度中點不等於像素中點（實測 zoom6→7
//    偏差 5→10px 剛好倍增＝固定的世界像素量，正是這個效應）。前後同一種量法，誤差自動抵銷。
const CENTER_PROBE = () => {
  const mb = map.options.maxBounds; if (!mb) return { err: 'no-maxbounds' };
  const b = L.latLngBounds(mb), z = map.getZoom();
  const p1 = map.project(b.getNorthWest(), z), p2 = map.project(b.getSouthEast(), z);
  const cp = map.latLngToContainerPoint(map.unproject(L.point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2), z));
  const mc = map.getContainer().getBoundingClientRect();
  const el = typeof activeSheetEl === 'function' ? activeSheetEl() : null;
  let visMidX = mc.width / 2, visMidY = mc.height / 2, isRail = null;
  if (el && !el.hidden) {
    // 形態從 rect 推，不問實作：撐滿高又只佔窄幅一欄＝右側欄，其餘＝底部 sheet
    const pr = el.getBoundingClientRect();
    isRail = (pr.height / mc.height) > 0.6 && (pr.width / mc.width) < 0.6;
    visMidX = isRail ? (pr.left - mc.left) / 2 : mc.width / 2;
    visMidY = isRail ? mc.height / 2 : (pr.top - mc.top) / 2;
  }
  return { isRail, zoom: z, degraded: !!state._limitCenterDegraded,
    dx: +(cp.x - visMidX).toFixed(1), dy: +(cp.y - visMidY).toFixed(1) };
};
async function centeringSuite(browser, eng) {
  const SIZES = QUICK ? [{ w: 852, h: 393, tag: '16橫' }, { w: 375, h: 812, tag: '13mini直' }]
    : [{ w: 667, h: 375, tag: 'SE3橫' }, { w: 852, h: 393, tag: '16橫' }, { w: 932, h: 430, tag: 'ProMax橫' },
       { w: 375, h: 812, tag: '13mini直' }, { w: 393, h: 852, tag: '16直' }, { w: 414, h: 896, tag: '11直' }];
  let rail = 0, sheet = 0;
  for (const S of SIZES) {
    const b = await boot(browser, S, { follow: false });
    const { ctx, page } = b;
    const before = await page.evaluate(CENTER_PROBE); // 無面板：露出區＝整個容器
    await page.tap('#tabExplore');
    await page.waitForTimeout(900);
    const r = await page.evaluate(CENTER_PROBE);
    // degraded 是「Leaflet 升級把私有 API 拿掉了」的旗標：那會讓夾限靜默退回原生行為、
    // 缺陷悄悄回來。把它併進同一條斷言，退化就是紅，不會只剩一個沒人看的 detail。
    const shiftX = r.dx - before.dx, shiftY = r.dy - before.dy;
    ok(`L12 ${eng}/${S.tag} 全島視角·開面板前後台灣在可視區的位置不變`,
      !r.err && !before.err && r.degraded === false && Math.abs(shiftX) <= 4 && Math.abs(shiftY) <= 4,
      `位移 x${shiftX.toFixed(1)} y${shiftY.toFixed(1)}；無面板=${JSON.stringify(before)} 開面板=${JSON.stringify(r)}`);
    if (!r.err) (r.isRail ? rail++ : sheet++);
    await ctx.close();
  }
  // 形態分佈具名把關：橫的必須全走側欄、直的必須全走底部 sheet，
  // 否則「兩種形態各驗過」是假的（心得 37d：條件式判準的分支分佈要有具名斷言）
  const wantRail = SIZES.filter(s => s.w > s.h).length;
  ok(`L9 ${eng} 置中判準的形態分佈`, rail === wantRail && sheet === SIZES.length - wantRail,
    `側欄=${rail}（期望 ${wantRail}）、底部sheet=${sheet}（期望 ${SIZES.length - wantRail}）`);
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
  await rotationSuite(browser, eng); // QUICK 也跑：這組是獨立驗收抓到的真缺陷，突變測試一定要涵蓋
  await centeringSuite(browser, eng); // QUICK 也跑：使用者親自指出的置中缺陷
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
