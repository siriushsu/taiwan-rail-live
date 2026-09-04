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
//   動作列讓開量退回寫死 60px     → 解鎖後的「回到列車」膠囊又疊上去 22×12（L13b）
//   站名牌退回整寬                → 吃掉露出地圖 98% 寬（L14b，順帶 L14d/L15 也紅）
//   站名牌縮小但放回左上角        → **只有 L14d 紅**（L14b/L14c 全綠）：量體與可見度是兩個相反方向的
//                                  要求，只驗量體就會把可見度做壞——這正是本批第一版真的做出來的缺陷
//   拿掉 .topbar 的水平讓開       → 它回到動態島帶裡（L15）
//   --sa-l/--sa-r 改成常數 0px    → **只有 L15c 紅**（L15 全綠，因為驗收自己注入的 inline 值蓋過它）
//                                  ：模擬式判準驗不到「值真的來自 env()」，所以那條原始碼斷言不可省
// 控制組（只加一行註解）必須全綠——沒有控制組就不知道紅的是不是自己以為的那件事。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

// ── 2026-08-12 §04c 改寫 ──
// 版面照設計回包「§04c 橫式版面」重排(工具堆右欄/徽章併頂列/跟隨欄上下錨定/露出地圖相機+前瞻/
// search-land),原判準有一整批是照改動前的版面寫的,依「紅的三種互斥原因」逐條分類後重寫:
//   判準過期:L1b(容器中心→露出中心+前瞻)、L4/L1/L2 的搜尋列(search-land 依設計蓋右半、暫停相機)、
//            L5 分類器(前瞻位移被讀成 maxBounds 夾死)、L10b(want 與實作同源+兩邊制)、
//            L12 visMid(漏算工具欄)、L13b/c(跟隨鎖已是工具欄成員,「與動作列不相交」概念死亡)、
//            L15b 跟隨鎖選擇器(.follow-lock-ctl 手機上是空殼)
//   真缺陷(已修):L13/L14d 連鎖(拖曳起點打在新跟隨欄上→誤開列車 sheet→站名牌壓工具欄)、
//            L12 直式(兩段式開面板撞 80ms 快取,reframeFocus 補 invalidate)、
//            L6/L7 iPad直(搬走跟隨鎖後空 Leaflet 容器把右下角撐高 10px)
// 共用真值=window.__exposed():照契約從渲染 rect 推「露出地圖」,刻意不呼叫 mapInsets()(心得 29)。
//
// ── §04c 改寫後的突變驗證(2026-08-12,QUICK×獨立目錄複製腳本,對照組全綠) ──
//   小卡左界讓位拔掉(computeMapInsets) → P4 小卡態 err0 1.1→107(P4 相機)
//   前瞻方向寫死朝北(followAheadPx)    → L1b 六筆紅,err0 依實際航向 10.5~11.8(cos25° 穩定閘有效)
//   跟隨欄下錨拔掉(bottom→auto)        → L4c(上下錨定 220 寬)
//   placeBadge 改 no-op               → L3b 徽章不在頂列,連鎖 14 筆
//   transitionend 補位鉤子判恆假        → L10b 釘點偏 (26,0.6)=常數44之半、L12 開面板 y−25.5=膠囊高之半
//     ⚠ 前一版突變(拔 reframeFocus 開頭的 invalidate)零紅——不是判準沒牙,是被冗餘中和:
//       鉤子+80ms TTL 在 ≤500ms 內自癒,穩態判準結構上照不到暫態雙跳。突變要瞄準承重代碼,
//       「綠的突變」也有三種互斥原因(判準盲/代碼冗餘/突變無效),下結論前先分辨(心得 34 的鏡像)。
//   搜尋暫停相機的閘拔掉(recenterTo)   → L4s 相機暫停(車走 120s 鏡頭動了)
//   placeControlRail 改 no-op         → L13b/L13c(跟隨鎖不在工具欄)
//   契約8中線 --land-lb 238→150       → L14e/L14f 四筆(站名牌+速度膠囊雙雙偏離)
//   工具欄常數44(行為上不可觀測:膠囊只在相機關閉時存在) → L13d 原始碼斷言把關
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_REF = process.env.BASE_REF || 'b937719';
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
const preflightFailures = [];
let activeCheck = (pass, name, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} [preflight] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) preflightFailures.push({ name, detail });
};
let activeEngineUrl = null;
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); activeCheck(pass, name, detail); };
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
  // 兩輪抽車:嚴格輪只抽「行進中且離任何停站窗都遠」的車——停站中/進站前 2 分/離站後 30 秒
  // 的車,量測窗內會停站或方向記憶還在轉場,把 L9 行進多數與 L1b 前瞻方向變成掛在牆鐘上的
  // 判準(站站停時段實測 moving=28/dwell=38 假紅)。一台都抽不到才退回舊準則:
  // 寧可抽到站邊車,也不能沒車可跟(沒跟隨=後面整頁判準全滅)。
  const cand = (strict) => {
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
      if (!s || eff <= s[0].depSec + 120 || eff >= s[s.length - 1].arrSec - 180) continue;
      if (strict && s.some(st => eff >= st.arrSec - 120 && eff <= st.depSec + 30)) continue;
      if (strict) {
        // 邊界車出局:貼近 maxBounds 的車讓直式相機走「夾限」分支——合法行為,但 L9 的
        // 分布判準(看得見=6/夾死=0)就掛在牆鐘上(0812 21:52 webkit 抽到 2 台邊界車假紅)。
        // 0.12° ≈ z13 半視窗的三倍餘裕;嚴格輪抽不到才退回,寧可夾限也不能沒車可跟。
        const p = (typeof trainPos === 'function') ? trainPos(tr, state.simSec) : null;
        const mb = window.__M.engine === 'leaflet' && window.__M.raw.options.maxBounds ? L.latLngBounds(window.__M.raw.options.maxBounds) : null;
        if (p && mb && (p.lat - mb.getSouth() < 0.12 || mb.getNorth() - p.lat < 0.12
          || p.lon - mb.getWest() < 0.12 || mb.getEast() - p.lon < 0.12)) continue;
      }
      setFollow(tr, false, true); return String(tr.train);
    }
    return null;
  };
  return cand(true) || cand(false);
};

async function boot(browser, { w, h, tag }, { url = BASE, follow = true, sheetSize = null, fontScale = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(a => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light');
      localStorage.setItem('trainmap-language', 'zh-TW');
      if (a.sz) localStorage.setItem('trainmap-sheet-size', a.sz);
      // 字級是開機第一行就讀進去的(首繪腳本),事後塞 localStorage 來不及
      if (a.fs) localStorage.setItem('trainmap-fontscale', a.fs);
    } catch (e) {}
  }, { sz: sheetSize, fs: fontScale });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${tag}] console.error: ${m.text()}`); });
  // goto 90s+一次重試:webkit 對 1.4MB 單檔頁的首次載入在機器有載時偶發 >30s(0812 兩輪
  // 各在不同 suite 撞到,零 FAIL 純 goto 逾時=環境不是產品;預設 30s 會讓整支腳本 uncaught 崩潰)
  const targetUrl = activeEngineUrl(url);
  try { await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
  catch (e) { await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  // 這支 gate 原本直接拿牆鐘挑「此刻行駛中」的台鐵車，深夜收班後整組 60+ 情境會一起假紅。
  // 從頁面已載入的真實時刻表挑最長的站間，停在該站間中央；兩引擎與歷史對照頁都用同一規則，
  // 因而仍量真實幾何／相機行為，只移除執行時段這個無關變因。
  await page.evaluate(() => {
    let best = null;
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train || !Array.isArray(tr.stops)) continue;
      for (let i = 0; i + 1 < tr.stops.length; i++) {
        const dep = Number(tr.stops[i].depSec), arr = Number(tr.stops[i + 1].arrSec);
        const span = arr - dep;
        if (Number.isFinite(span) && span > 420 && (!best || span > best.span))
          best = { span, sec: dep + span / 2 };
      }
    }
    if (!best) return false;
    state.playing = false;
    setSimSec(best.sec % 86400);
    if (typeof draw === 'function') draw();
    return true;
  });
  // 零回歸基準 b937719 早於 M0，沒有 window.__M；Task 1 的驗收投影已全面改走 M，
  // 因此只替舊基準頁補最小 Leaflet shim。受測頁本來就有正式 M，永遠不進這條。
  await page.evaluate(() => {
    if (window.__M || !window.__map) return;
    const raw = window.__map;
    window.__M = {
      engine: 'leaflet', raw,
      toScreen: ll => raw['latLngToContainerPoint'](ll),
      fromScreen: px => raw['containerPointToLatLng'](px),
      getCenter: () => raw.getCenter(), getContainer: () => raw.getContainer(), getSize: () => raw.getSize(), getZoom: () => raw.getZoom(),
      setView: (center, zoom, options) => raw.setView(center, zoom, options),
    };
  });
  await page.waitForTimeout(300);
  await page.evaluate(INSTALL_EXPOSED); // 判準側的露出地圖真值(對照組頁面也裝:同一把尺量兩邊)
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
  const cp = window.__M.toScreen([p.lat, p.lon]);
  const mc = window.__M.getContainer().getBoundingClientRect();
  const cx = mc.left + cp.x, cy = mc.top + cp.y;
  const inVP = cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
  const hit = inVP ? document.elementFromPoint(cx, cy) : null;
  let onMap = false;
  for (let e = hit; e; e = e.parentElement) if (e === window.__M.getContainer()) { onMap = true; break; }
  return {
    cx: +cx.toFixed(0), cy: +cy.toFixed(0), inVP, onMap,
    hit: hit ? (hit.id ? '#' + hit.id : (hit.className?.toString?.().slice(0, 28) || hit.tagName)) : null,
  };
};

// 面板形態：寫成關係（讓出多少給地圖、佔多高、貼哪一邊）而不是 width:360px，
// 公式改了判準才不會跟著一起瞎（心得 29/35）。
const SIDE_RAIL_PROBE = () => {
  const el = activeSheetEl(); if (!el || el.hidden) return { err: 'no-sheet' };
  const r = el.getBoundingClientRect(), mc = window.__M.getContainer().getBoundingClientRect();
  return {
    id: el.id,
    leftFreeRatio: +((r.left - mc.left) / mc.width).toFixed(3), // 左邊留給地圖的比例
    heightRatio: +(r.height / mc.height).toFixed(3),
    rightAnchored: Math.abs(mc.right - r.right) < 24,
  };
};

// §04c「露出地圖」(判準側)。逐字照設計契約從**渲染出來的 rect** 推導,刻意不呼叫 mapInsets()/
// sheetIsSideRail()/focusShift()——判準與實作共用推導就會一起瞎(心得 29;兩邊唯一共用的是 DOM 這份
// 渲染事實)。邊界規則=契約原文:上=頂列/時鐘徽章底+8;下=min(底部sheet頂,速度膠囊頂)−8,否則
// tabbar 頂−8;左=跟隨欄/跟車小卡右+8(展開時;收合=左界回視窗左緣);右=側欄左−8 與工具欄左−8,
// 工具欄一律以「右緣起算常數 44」計(「回到列車」膠囊是暫態,契約明定不因它推相機)。
// 兩軸各 64px 最小露出,不足就該軸放棄讓位(與實作同值的契約常數)。速度膠囊的 cexp 展開是操作暫態,
// 比照常數 44 的理由不計(判準跑的流程裡沒人去點膠囊,結果是確定性的)。
const INSTALL_EXPOSED = () => {
  const eff = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0; return o; };
  const vis = el => {
    if (!el || el.hidden || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && eff(el) >= 0.5;
  };
  window.__exposed = () => {
    const mc = window.__M.getContainer().getBoundingClientRect();
    let top = 0, bottom = 0, left = 0, right = 0;
    for (const el of [document.getElementById('topbar'), document.querySelector('.badge')])
      if (vis(el)) top = Math.max(top, el.getBoundingClientRect().bottom - mc.top + 8);
    const ma = document.getElementById('mapActions');
    if (ma && [...ma.children].some(vis)) right = Math.max(right, mc.right - ma.getBoundingClientRect().right + 44 + 8);
    const sh = typeof activeSheetEl === 'function' ? activeSheetEl() : null;
    if (vis(sh)) {
      const r = sh.getBoundingClientRect();
      const isRail = r.height / mc.height > 0.6 && r.width / mc.width < 0.6; // 形態從 rect 推,不問實作
      if (isRail) right = Math.max(right, mc.right - r.left + 8);
      else bottom = Math.max(bottom, mc.bottom - r.top + 8);
    }
    // 小卡/跟隨欄:可見即計入(行為契約 2)。直式 sheet 開著時小卡被抬到 sheet 上方=仍可見=照算;
    // 88% 淡出時 vis() 自然除名——與實作各自獨立推導,但同樣只走「可見性」一條規則。
    for (const el of [document.getElementById('followPanel'), document.getElementById('freqCard')]) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0.5 && r.height > 0.5)) continue;
      if (el.classList.contains('fp-min')) {
        // 收合:直式 pill 貼下緣家具堆=記下界;橫式膠囊貼頂不佔(契約 8 收合=中線與左界回歸)。
        // 位置從 rect 判(下半部才算下緣家具),不問實作的 sideRail 旗標
        if (r.top > mc.top + mc.height * 0.6) bottom = Math.max(bottom, mc.bottom - r.top + 8);
        continue;
      }
      // v3(2026-08-27 裁示):跟隨欄升格右側欄——在容器右半=右界;留在左半(直式小卡/捷運 freq-card)
      // =左界。照本檔慣例從 rect 判,不問實作的 sideRail 旗標。
      if ((r.left + r.right) / 2 > mc.left + mc.width / 2) right = Math.max(right, mc.right - r.left + 8);
      else left = Math.max(left, r.right - mc.left + 8);
    }
    const cap = document.querySelector('.controls');
    if (vis(cap) && !document.body.classList.contains('cexp')) {
      const r = cap.getBoundingClientRect();
      if (r.width > 0.5) bottom = Math.max(bottom, mc.bottom - r.top + 8);
    }
    const tb = document.querySelector('.tabbar');
    if (vis(tb)) bottom = Math.max(bottom, mc.bottom - tb.getBoundingClientRect().top + 8);
    if (mc.height - top - bottom < 64) { top = 0; bottom = 0; }
    if (mc.width - left - right < 64) { left = 0; right = 0; }
    return { top: +top.toFixed(1), bottom: +bottom.toFixed(1), left: +left.toFixed(1), right: +right.toFixed(1),
      cx: +(left + (mc.width - left - right) / 2).toFixed(1), cy: +(top + (mc.height - top - bottom) / 2).toFixed(1),
      w: +(mc.width - left - right).toFixed(1), h: +(mc.height - top - bottom).toFixed(1) };
  };
  // 前瞻期望:相機瞄準點=露出中心沿行進方向前移 0.15×露出短邊(契約:「讓前方路線多露一段」)
  // ⇒ **列車**落在露出中心的行進**反**方向 m 處:trainPt = center − m·dir。
  // 方向用「路徑上往後 45 秒的位置」經 Leaflet 公開投影自算——與實作唯一共用的是 trainPos 這份
  // 資料(它的正確性由整套其他判準守著);投影、方向、幅度、正負號全部獨立推導。
  // 列車停靠(兩點重合)時回 dir:null,呼叫端退回「距中心 ≤ 幅度」的弱判——實作此時沿用上一個
  // 方向記憶(有記憶=偏 m,從跟上就停靠=偏 0),判準讀不到那份記憶也不該讀,兩端點間都算合法。
  window.__aheadExpect = () => {
    const ex = window.__exposed();
    const tr = state.followTrain; if (!tr) return { err: 'no-follow' };
    const p0 = trainPos(tr, state.simSec); if (!p0) return { err: 'no-pos' };
    const a = window.__M.toScreen([p0.lat, p0.lon]);
    const m = 0.15 * Math.min(ex.w, ex.h);
    const dirTo = dt => {
      const p1 = trainPos(tr, state.simSec + dt);
      if (!p1) return null;
      const b = window.__M.toScreen([p1.lat, p1.lon]);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      return len > 0.5 ? { x: dx / len, y: dy / len } : null;
    };
    const dir = dirTo(45), dirB = dirTo(10);
    // 方向穩定度:進出站/彎道的過渡窗裡,實作沿用的方向記憶與判準取樣的窗必然對不齊
    // (實測站點邊緣差過 31°)——兩個取樣窗方向一致才走強判,否則退「距中心 ≤ 幅度」弱判。
    const stable = !!(dir && dirB && (dir.x * dirB.x + dir.y * dirB.y) >= 0.906); // cos 25°
    return { ex, m: +m.toFixed(1),
      dir: dir ? { x: +dir.x.toFixed(3), y: +dir.y.toFixed(3) } : null, stable,
      trainX: +a.x.toFixed(1), trainY: +a.y.toFixed(1),
      dist: +Math.hypot(a.x - ex.cx, a.y - ex.cy).toFixed(1),
      err0: dir ? +Math.hypot(a.x - (ex.cx - m * dir.x), a.y - (ex.cy - m * dir.y)).toFixed(1) : null };
  };
};
// 相機判準的共用判定與分支計數(心得 37d:弱判是分支,分佈要有具名斷言,不能無聲全滑進弱判)
const aheadBranch = { moving: 0, dwell: 0 };
const aheadPass = c => !c.err && (c.stable ? c.err0 <= 10 : c.dist <= c.m + 10);
const aheadCount = c => { if (!c.err) aheadBranch[c.stable ? 'moving' : 'dwell']++; };

// 可見浮層（供相交掃描）。刻意不含 header/.stage/leaflet 容器——它們是別人的父層，相交無意義。
const OVERLAY_SEL = ['#topbar', '#clock', '#randBtn', '#nearBtn', '#alertBanner', '#dwellPlate',
  '#followPanel', '#freqCard', '#trainCard', '.tabbar', '.controls',
  '#explorePanel', '#favPanel', '#ridePanel', '#searchPanel', '#nearCard', '.follow-lock-ctl'];
const OVERLAP_PROBE = (SELS) => {
  // 🔴 可見性要算**有效** opacity(沿祖先連乘):§04c 的讓位淡出掛在父層(.map-actions 整欄、
  //    search-open 的工具堆/站名牌),單看自身 opacity 會把已讓位的當成還在
  //    (實測假相交:#randBtn∩#searchPanel 44×44,randBtn 自己 opacity=1、父欄=0)。
  const vis = el => {
    if (!el || el.hidden) return false;
    let o = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      o *= parseFloat(cs.opacity) || 0;
    }
    if (o < 0.05) return false;
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
// v3(2026-08-27 裁示)「橫式點開車輛或車站資訊的時候,是可以擋住右上角那些按鈕沒關係的」＋
// 頂列=背景層(右半是透明空白,內容都靠左):側欄家族(上錨到頂後必然疊頂列右半)與
// #topbar/工具欄成員(#randBtn/#nearBtn/#followLockBtn)的相交=裁示行為,集中豁免。
// followLockBtn 是 v5 補的:直欄時代它在側欄右緣外碰不到,橫排後(列向左長)與側欄水平相交
// ——它與另外兩顆同屬一個工具欄,「側欄可蓋右上角那些按鈕」的裁示本來就涵蓋它。
// 其餘配對(卡疊卡、跟隨欄疊分頁面板…)一律留著抓真疊——sheet-open 讓位若壞掉要在這裡現形。
const RAIL_RE = /#(followPanel|favPanel|ridePanel|explorePanel|searchPanel|nearCard|trainCard|board)\b/;
const RULED_RE = /#(topbar|randBtn|nearBtn|followLockBtn)\b/;
const filterRuled = o => ({ ...o, inter: (o.inter || []).filter(s => !(RAIL_RE.test(s) && RULED_RE.test(s))) });
async function settledOverlap(page) {
  const first = filterRuled(await page.evaluate(OVERLAP_PROBE, OVERLAY_SEL));
  if (!first.inter.length && !first.off.length) return { ...first, reMeasured: false };
  await page.waitForTimeout(600); // > .45s（.dwell-plate 的 opacity transition）
  const second = filterRuled(await page.evaluate(OVERLAP_PROBE, OVERLAY_SEL));
  return { ...second, reMeasured: true };
}

// ─────────────────────────────────────────────────────────────
// L1／L2／L4：橫式跟車 × 逐一開面板
// ─────────────────────────────────────────────────────────────
// 合併卡「四段固定」的共用探針:塞 2000px 受控內容 → 量卡高不變、真的捲得動、三段不位移。
// 兩處共用(牌沒亮／牌亮著各量一次),不可各寫一份——判準漂掉時只有一邊會被改。
const CARD_FIX_PROBE = () => {
      const bd = document.getElementById('board');
      if (!bd || bd.hidden) return { err: 'no-board' };
      const tabs = bd.querySelector('.uni-tabs'), h3 = bd.querySelector(':scope > h3');
      const plate = bd.querySelector(':scope > .dwell-plate');
      const shown = e => e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
      const tb = document.getElementById('topbar').getBoundingClientRect();
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      const H0 = Math.round(bd.getBoundingClientRect().height);
      // 🔴 「高度與內容無關／捲得動」不能靠當下剛好有幾班車來證明——少班次的站 scrollH 本來就
      //    比可視區短(實測 16ProMax scrollH 314 === client 314),那時整條判準只是在量資料。
      //    改成自己塞 2000px 當受控變因。塞的位置是**最後一個看得見的直接子元素的下內距**:
      //    卡的捲動容器就是 #board 本身,而 .uni-slot 在「車站」頁籤時是 display:none
      //    (往它塞 min-height 完全沒作用,第一版就是這樣假紅)。
      const kids = [...bd.children].filter(shown);
      const padEl = kids[kids.length - 1] || null;
      const prevPB = padEl ? padEl.style.paddingBottom : null;
      if (padEl) padEl.style.paddingBottom = '2000px';
      const r = bd.getBoundingClientRect();
      const t0 = tabs ? Math.round(tabs.getBoundingClientRect().top) : null;
      const h0 = h3 ? Math.round(h3.getBoundingClientRect().top) : null;
      const plateVis = shown(plate);
      const p0 = plateVis ? Math.round(plate.getBoundingClientRect().top) : null;
      bd.scrollTop = 400;
      const t1 = tabs ? Math.round(tabs.getBoundingClientRect().top) : null;
      const h1 = h3 ? Math.round(h3.getBoundingClientRect().top) : null;
      const p1 = plateVis ? Math.round(plate.getBoundingClientRect().top) : null;
      const scrolled = Math.round(bd.scrollTop);
      const scrollH = bd.scrollHeight, client = bd.clientHeight;
      bd.scrollTop = 0;
      if (padEl) padEl.style.paddingBottom = prevPB;
      const H1 = Math.round(bd.getBoundingClientRect().height);
      return { top: Math.round(r.top), h: Math.round(r.height), H0, H1, scrollH, client,
        gapTop: Math.round(r.top - tb.bottom), gapBottom: Math.round(bar.top - r.bottom),
        tabsPos: tabs ? getComputedStyle(tabs).position : null, tabsTop0: t0, tabsTop1: t1,
        h3Top0: h0, h3Top1: h1, plateVis, plateTop0: p0, plateTop1: p1,
        scrolled, hasTabs: !!tabs, padded: !!padEl };
};

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

    // L3b(§04c 契約3):橫式時鐘徽章不再獨立絕對定位,是頂列的 flex 子項。
    // 突變證齒:placeBadge 改 no-op → 徽章留在老家絕對定位,這條當場紅。
    const badge = await page.evaluate(() => {
      const b = document.querySelector('.badge'); if (!b) return { err: 'no-badge' };
      const tR = document.getElementById('topbar').getBoundingClientRect(), r = b.getBoundingClientRect();
      return { parent: b.parentNode.id, pos: getComputedStyle(b).position,
        inBar: r.top >= tR.top - 1 && r.bottom <= tR.bottom + 1 };
    });
    ok(`L3b ${eng}/${S.tag} 時鐘徽章是頂列的 flex 子項`,
      badge.parent === 'topbar' && badge.pos === 'static' && badge.inBar, JSON.stringify(badge));

    // L3c(契約3):窄機收斂順序——899 摘尖峰徽章、819 摘「N 班奔跑中」、739 摘軌島牌副標。
    // .peak 是資料閘(尖峰時段才亮),只驗「該摘的有摘」;.plate-foot 恆在,兩向都驗。
    // 🔴 2026-08-27:班數(.count)那一格作廢——手機殼頂列有一條**無條件**的
    //    `body.fs .topbar .badge .count{display:none}`(不是寬度閘門),而且它在改版基準樹
    //    23ac887 裡一字不差 ⇒ 班數在手機殼裡任何寬度都不顯示,「819 才摘」這個階梯早就不成立,
    //    十二格橫式一律紅(count=none)。改成正面陳述當下的契約:手機殼頂列不放班數,**每個寬度都要成立**
    //    ——這樣「哪天有人把它放回來」照樣抓得到,而不是把期望值改成當下實測(心得 35)。
    const nc = await page.evaluate(() => {
      const d = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'missing'; };
      return { peak: d('.topbar .badge .peak'), count: d('.topbar .badge .count'), foot: d('.topbar .tb-plate .plate-foot') };
    });
    const ncBad = [];
    if (S.w <= 899 && nc.peak !== 'none' && nc.peak !== 'missing') ncBad.push(`peak該摘沒摘(${nc.peak})`);
    if (nc.count !== 'missing' && nc.count !== 'none') ncBad.push(`班數不該出現在手機殼頂列(${nc.count})`);
    if (nc.foot !== 'missing' && (S.w <= 739) !== (nc.foot === 'none')) ncBad.push(`foot=${nc.foot}`);
    ok(`L3c ${eng}/${S.tag} 窄機收斂順序(899摘峰/739摘副標;班數一律不放)`, ncBad.length === 0, ncBad.join('、') || JSON.stringify(nc));

    // L3d:頂列可讀底跟「面板半透明」開關走(2026-08-12 實機退回恆玻璃版:開關關著、衛星圖上
    // 字看不清)。兩態都驗:預設(關)=實心 alpha≥.9 且無 blur;開=玻璃 alpha .2–.45+blur
    // (使用者凍結值 .30/3px)。
    // 🔴 2026-08-27 裁示:「可以直接改文字的顏色,不要加光暈來做」⇒ 判準從「要有 halo」翻成
    //    「兩態都不准有 text-shadow」。這一條就是防它回來的棘輪:光暈是實作自己加的,
    //    使用者 07-30 的原始指示本來就是調字色。
    // 讀值前關 transition(拔規則的突變別在過渡起點讀到舊值=假綠)。
    const badgeBg = await page.evaluate(() => {
      const bar = document.getElementById('topbar');
      if (!bar) return { err: 'no-topbar' };
      const alpha = color => {
        if (!color || color === 'transparent') return 0;
        const n = color.match(/[\d.]+/g)?.map(Number) || [];
        return color.startsWith('rgba') || color.includes('/') ? (n[3] ?? 0) : 1;
      };
      const bdg = document.querySelector('.topbar .badge');
      const read = () => {
        const cs = getComputedStyle(bar);
        const cb = bdg ? getComputedStyle(bdg) : null;
        return { a: +alpha(cs.backgroundColor).toFixed(2), blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none', halo: cs.textShadow,
                 ba: cb ? +alpha(cb.backgroundColor).toFixed(2) : null, bhalo: cb ? cb.textShadow : 'none' };
      };
      const prevTr = bar.style.transition; bar.style.transition = 'none';
      const solid = read();
      document.body.classList.add('panel-translucent');
      const glass = read();
      document.body.classList.remove('panel-translucent');
      bar.style.transition = prevTr;
      return { solid: { a: solid.a, blur: solid.blur, ba: solid.ba, halo: solid.halo !== 'none' || solid.bhalo !== 'none' },
               glass: { a: glass.a, blur: glass.blur, ba: glass.ba, halo: glass.halo !== 'none' || glass.bhalo !== 'none' } };
    });
    // v3(2026-08-27 契約7退役):頂列自身的玻璃帶=雙重底的空玻璃(徽章自帶紙面 pill),整條退役。
    // 可讀底的責任人改為 .badge:恆實心 paper(兩態都 ≥.9);頂列兩態都必須透明、無 blur、無字外圈。
    ok(`L3d ${eng}/${S.tag} 頂列帶退役:兩態頂列透明,徽章自帶實心可讀底,無字外圈`,
      !badgeBg.err && badgeBg.solid.a === 0 && !/blur\(/.test(badgeBg.solid.blur)
        && badgeBg.glass.a === 0 && !/blur\(/.test(badgeBg.glass.blur)
        && badgeBg.solid.ba >= 0.9 && badgeBg.glass.ba >= 0.9
        && !badgeBg.solid.halo && !badgeBg.glass.halo,
      JSON.stringify(badgeBg));

    // L3e:把資料條件控制的公告鈕暫時顯示後，只量三組真實 rect；不讀定位公式或呼叫實作函式。
    const topRight = await page.evaluate(() => {
      const chip = document.getElementById('alertChip');
      const visible = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
      // 🔴 2026-08-27 起手機殼（橫式也算）把四顆分頁收成一顆 #gtabOne。寫死 #topTabs 的話這裡量到的是
      //    0×0，`rightError` 會變成「工具堆右緣 − 0」＝整個視窗寬的假紅，而重疊判準同時變成恆真的假綠。
      const tabs = [document.getElementById('gtabOne'), document.getElementById('topTabs')].find(visible);
      const firstTool = [...document.querySelectorAll('#mapActions > button')].find(visible);
      if (!chip || !tabs || !firstTool) return { err: 'missing-top-right-control' };
      const wasHidden = chip.hidden; chip.hidden = false;
      const rect = el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const rs = { alert: rect(chip), tabs: rect(tabs), tool: rect(firstTool) };
      chip.hidden = wasHidden;
      const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left)
        && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      const bad = [['alert', 'tabs'], ['alert', 'tool'], ['tabs', 'tool']]
        .filter(([a, b]) => overlaps(rs[a], rs[b])).map(p => p.join('∩'));
      return { bad, which: tabs.id, rightError: +Math.abs(rs.tool.right - rs.tabs.right).toFixed(2), rects: rs };
    });
    ok(`L3e ${eng}/${S.tag} 公告/群組/工具堆互不重疊且右緣對齊`,
      !topRight.err && topRight.bad.length === 0 && topRight.rightError <= 8, JSON.stringify(topRight));

    // ── §04c v2「改·第 4 條」(2026-08-26):跟隨欄在橫式**廢除**,原本 L4c/L4d 問的是
    //    「那條欄的上下錨定與三段結構」——欄不存在之後那兩條的紅是判準過期不是缺陷(w=0)。
    //    換成 v2 的核心保證:**左緣除安全區外沒有任何 HUD**(左邊 228px 還給地圖),
    //    以及跟隨欄真的退場了。這條保證最容易被下一個「順手擺左上角」的元件破壞,值得具名把關。
    //    🔴 判準寫「左緣帶」不寫「整個露出矩形」:速度膠囊本來就置中於露出地圖(設計 下緣),
    //       拿整塊當分母會把它一起判紅。帶寬 60=原跟隨欄左錨 10 + 一點餘裕,欄若復活必然踩到。
    //    ⚠ 已知豁免:捷運跟車小卡 .freq-card 仍錨在左下(設計沒提它,本輪未動)——本段跟的是台鐵車,
    //       它不會出現;哪天要把它也搬進卡裡,這條判準就是那件事的起點。
    const leftBand = await page.evaluate(() => {
      const cs0 = getComputedStyle(document.body);
      const sl = parseFloat(cs0.getPropertyValue('--sa-l')) || 0;
      const tb = document.getElementById('topbar').getBoundingClientRect();
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      const band = { left: sl, right: sl + 60, top: tb.bottom, bottom: bar.top };
      const vis = e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05
          && r.width > 2 && r.height > 2; };
      const SEL = '.follow-panel, .freq-card, .traincard, .board, #nearCard, #searchPanel, .dwell-plate,'
        + ' .xing-card, .alert-detail, .alert-banner, .iab-hint, .map-actions, .trip-banner';
      const hits = [...document.querySelectorAll(SEL)].filter(e => !e.hidden && vis(e)).filter(e => {
        const r = e.getBoundingClientRect();
        return Math.min(r.right, band.right) - Math.max(r.left, band.left) > 2
          && Math.min(r.bottom, band.bottom) - Math.max(r.top, band.top) > 2;
      }).map(e => (e.id || e.className) + ' ' + Math.round(e.getBoundingClientRect().left));
      const fp = document.getElementById('followPanel');
      const fr = fp.getBoundingClientRect();
      return { hits, band: [Math.round(band.left), Math.round(band.right), Math.round(band.top), Math.round(band.bottom)],
        fpDisplay: getComputedStyle(fp).display, fpInSlot: !!fp.closest('.uni-slot'),
        fpW: Math.round(fr.width), fpRight: Math.round(fr.right), fpTop: Math.round(fr.top),
        vw: innerWidth, saR: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sa-r')) || 0 };
    });
    ok(`L4c ${eng}/${S.tag} 左緣淨空:安全區到 +60px 這條帶裡沒有任何 HUD(跟隨欄廢除後的核心保證)`,
      leftBand.hits.length === 0, leftBand.hits.join('／') || `帶=${leftBand.band.join(',')} 逐一掃過無元件`);
    // v3(2026-08-27 裁示)推翻 v2「跟隨欄退役」:「橫式點開車輛或車站資訊的時候,是可以擋住右上角
    // 那些按鈕沒關係的。不然捲軸太短空間太小了」⇒ 跟車無板時它就是右側欄:上錨到頂(≤20 容 sa-t)、
    // 右錨(視口右緣−8−sa-r ±2)、rail 寬(≥200)。開著別的 sheet 時讓位隱藏(display:none)由 L2/L4 段覆蓋。
    ok(`L4d ${eng}/${S.tag} 跟隨欄=右側欄(v3):跟車無板時上錨右錨`,
      leftBand.fpInSlot ? leftBand.fpW > 0
        : (leftBand.fpDisplay !== 'none' && leftBand.fpW >= 200
           && Math.abs(leftBand.vw - leftBand.fpRight - 8 - leftBand.saR) <= 2 && leftBand.fpTop <= 20),
      JSON.stringify({ display: leftBand.fpDisplay, 在槽裡: leftBand.fpInSlot, w: leftBand.fpW,
        right: leftBand.fpRight, top: leftBand.fpTop, vw: leftBand.vw, saR: leftBand.saR }));

    // ── §04c v2「改·第 6 條」四段固定 ＋「改·第 8 條」站名牌雙錨點(2026-08-26)─────────
    //    原本這裡驗的是跟隨欄的收合膠囊(220×44/記憶/中線重算),欄廢除後整組概念死亡。
    //    v2 把跟隨資訊搬進合併卡,所以改驗那張卡:高度是版面常數、頭與分頁列捲不走。
    await page.evaluate(() => openBoard(state.schedStations[0]));
    await page.waitForTimeout(800);
    const card = await page.evaluate(CARD_FIX_PROBE);
    // 「高度與內容無關」的證據:塞進 2000px 內容之後卡高一格不動(H0===h===H1),只有 scrollH 變長;
    // 「四段固定」的證據:真的捲 400px 之後,頭/站名列/分頁列的螢幕座標都沒動(捲的是身)。
    // v3(2026-08-27 裁示)上緣基準改視口頂:「上錨到頂——可以擋住右上角那些按鈕,不然捲軸太短」
    // ⇒ 卡頂=8+sa-t(sa-t 注入前=8;≤20 容它),gapTop(對頂列底)允許為負=疊上頂列透明右半,不再 gate。
    ok(`L4e ${eng}/${S.tag} 合併卡:上錨到頂、塞長內容也不長高,且真的捲得動`,
      !card.err && card.hasTabs && card.padded && card.H0 === card.h && card.H1 === card.H0
        && card.scrollH > card.client + 100 && card.scrolled > 100
        && card.top <= 20 && card.gapBottom >= 4 && card.gapBottom <= 14, JSON.stringify(card));
    // 站名牌沒亮著時(沒車停靠)它是 display:none,rect 恆 0 ⇒ 那半條判準是空的,據實標明不算數。
    ok(`L4f ${eng}/${S.tag} 四段固定:捲動之後卡頭/站名列/分頁列原地不動(捲的是身)`,
      !card.err && card.tabsPos === 'sticky' && card.tabsTop1 === card.tabsTop0
        && card.h3Top1 === card.h3Top0 && card.plateTop1 === card.plateTop0,
      JSON.stringify({ 分頁列: [card.tabsTop0, card.tabsTop1], 卡頭: [card.h3Top0, card.h3Top1],
        站名列: card.plateVis ? [card.plateTop0, card.plateTop1] : '沒車停靠·牌未亮(這半未涵蓋)',
        pos: card.tabsPos, 捲了: card.scrolled }));
    // 🔴 上面那組是在「沒車停靠」時量的——牌 display:none,四段裡少了一段,那半根本沒被涵蓋
    //    (心得 37d:分母要有具名斷言)。這裡自己把牌點亮(只填它自己的欄位＋加 .show,不動產品程式碼)
    //    再量一次:① 牌真的把分頁列往下推(證明它在固定段裡);② 捲動後三段都還在原位。
    // 🔴 基準要自己造,不可重用上面那一次的 `card`:站名牌是用 **opacity** 開關的(不是 display),
    //    所以只要它 **docked** 就佔版面——而 dock 與否由 mount/unmountUniCard 決定,也就是
    //    「當下有沒有在跟一班車」。同一支腳本因此會量到 99(沒 dock)或 141(已 dock),
    //    「牌把分頁列往下推」這半在已 dock 的那一半永遠比不出來(2026-08-27 實測:full run 六個
    //    橫式尺寸兩個紅、QUICK 兩個全紅,而產品一行都沒改)。改用產品自己的 dockDwellPlate()
    //    做出兩個**只差「牌在不在固定段裡」**的狀態,各量一次。
    await page.evaluate(() => dockDwellPlate(false));
    await page.waitForTimeout(350);
    const cardOff = await page.evaluate(CARD_FIX_PROBE);
    ok(`L4g2 ${eng}/${S.tag} 前置·牌搬出卡外時它不佔卡頭的版位(下面那條的基準)`,
      !cardOff.err && !cardOff.plateVis, // 牌不在卡裡時探針回 null(不是 false)
      JSON.stringify({ 牌在卡裡: cardOff.plateVis, 分頁列: cardOff.tabsTop0 }));
    await page.evaluate(() => {
      dockDwellPlate(true);
      const dp = document.getElementById('dwellPlate');
      document.getElementById('dpName').textContent = '板橋';
      document.getElementById('dpPrev').textContent = '萬華';
      document.getElementById('dpNext').textContent = '浮洲';
      document.getElementById('dpPrevKm').textContent = '4.3 km';
      document.getElementById('dpNextKm').textContent = '2.5 km';
      // 🔴 不能用 .show:跟車渲染迴圈每一幀都會對「沒在停靠的車」remove('show'),450ms 後必被刷掉
      //    (第一版就是這樣量到 plateVis=false)。改用行內 display 直接壓過 :not(.show) 那條,
      //    迴圈只動 class 不動行內樣式 ⇒ 撐得住,而且 RO 會因為尺寸 0→實高而重量 --board-head-h。
      dp.style.transition = 'none'; dp.style.display = 'block';
    });
    await page.waitForTimeout(450); // 等 ResizeObserver 把 --board-head-h 重量一次
    const cardP = await page.evaluate(CARD_FIX_PROBE);
    await page.evaluate(() => {
      const dp = document.getElementById('dwellPlate');
      dp.style.display = ''; dp.style.transition = '';
    });
    ok(`L4h ${eng}/${S.tag} 站名牌亮著時它也是固定段:分頁列讓開它,捲動後三段都不動`,
      !cardP.err && cardP.plateVis === true && cardP.plateTop1 === cardP.plateTop0
        && cardP.tabsTop1 === cardP.tabsTop0 && cardP.h3Top1 === cardP.h3Top0
        && cardP.tabsTop0 > cardOff.tabsTop0 + 4 && cardP.scrolled > 100,
      JSON.stringify({ 分頁列: [cardP.tabsTop0, cardP.tabsTop1], 卡頭: [cardP.h3Top0, cardP.h3Top1],
        站名列: [cardP.plateTop0, cardP.plateTop1], 牌搬出卡外時分頁列: cardOff.tabsTop0,
        L4f那次: card.tabsTop0, 捲了: cardP.scrolled }));
    // 🔴 往返:牌再搬出去,分頁列要**回得到**原位。少了這半,--board-head-h 一旦被牌撐高就再也
    //    降不回來也會全綠——而那正是真的發生過的缺陷:sticky 元素的 offsetTop 含它自己被 top
    //    推下去的量,拿它回算 top 會自我維持(旋轉回直式後分頁列上方留一條 42px 空白)。
    //    修法是量測期間暫時 position:static(index.html 的 natTop)。
    await page.evaluate(() => dockDwellPlate(false));
    await page.waitForTimeout(400);
    const cardBack = await page.evaluate(CARD_FIX_PROBE);
    ok(`L4i ${eng}/${S.tag} 往返:牌搬出去之後分頁列回得到原位(值不會被牌撐高就卡住)`,
      !cardBack.err && !cardBack.plateVis && Math.abs(cardBack.tabsTop0 - cardOff.tabsTop0) <= 1,
      JSON.stringify({ 搬出前基準: cardOff.tabsTop0, 牌在裡面時: cardP.tabsTop0,
        再搬出去: cardBack.tabsTop0, 牌還在卡裡: cardBack.plateVis }));
    // 站名牌雙錨點:卡開＝併進卡頭(DOM 在 h3 之後、position 從 absolute 變成 sticky ⇒ 進入卡的
    // 版面流、跟著卡頭一起釘住,見 L4h);卡關＝回到獨立牌(absolute 浮在露出地圖上)。
    // 🔴 反向對照不可省:少了「關掉要回去」那一半,「牌永遠釘在卡裡」(停靠時看不到牌)也會全綠。
    // 🔴 2026-08-27 修判準:上一條(L4i)刻意呼叫 dockDwellPlate(false) 把牌搬出卡外,而這裡沒有
    //    重新 dock 就直接讀 anchorIn ⇒ docked 恆為 false,**這條在任何引擎、任何寬度都不可能綠**
    //    (實測 12/12 全紅,而單獨呼叫 dockDwellPlate(true) 量到 docked/parentIsBoard/afterH3/sticky
    //    全部正確 ⇒ 是判準少了一步,不是產品回歸)。補回「卡開」那一半的前置。
    await page.evaluate(() => dockDwellPlate(true));
    await page.waitForTimeout(250);
    const anchorIn = await page.evaluate(() => {
      const dp = document.getElementById('dwellPlate'), bd = document.getElementById('board');
      const h3 = bd.querySelector(':scope > h3');
      return { docked: dp.classList.contains('dp-docked'), parentIsBoard: dp.parentElement === bd,
        afterH3: dp.previousElementSibling === h3, pos: getComputedStyle(dp).position };
    });
    await page.evaluate(() => { closeBoard(); });
    await page.waitForTimeout(400);
    const anchorOut = await page.evaluate(() => {
      const dp = document.getElementById('dwellPlate'), bd = document.getElementById('board');
      return { docked: dp.classList.contains('dp-docked'), parentIsBoard: dp.parentElement === bd,
        pos: getComputedStyle(dp).position };
    });
    ok(`L4g ${eng}/${S.tag} 站名牌雙錨點:卡開＝併進卡頭,卡關＝回到獨立牌`,
      anchorIn.docked && anchorIn.parentIsBoard && anchorIn.afterH3 && anchorIn.pos === 'sticky'
        && !anchorOut.docked && !anchorOut.parentIsBoard && anchorOut.pos === 'absolute',
      JSON.stringify({ 卡開: anchorIn, 卡關: anchorOut }));

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

      // ── §04c 契約9:搜尋橫放是新元件 search-land——右半全高、輸入框釘頂、tab bar 藏起、
      //    打字中**暫停跟車置中**。所以「列車看得見/在露出中心」對它依設計不成立(列車可以在面板
      //    底下),「浮層不相交」也要豁免頂列(它退為 .35 的背景層,被面板壓住是設計)。
      //    換上的判準:形態、讓位淡出、以及「相機真的暫停」的差分實驗。
      if (P.key === 'search') {
        const s = await page.evaluate(() => {
          const el = activeSheetEl(); if (!el || el.hidden || el.id !== 'searchPanel') return { err: 'not-search:' + (el && el.id) };
          const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight;
          const eff = n => { let o = 1; for (let e = n; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0; return o; };
          const tb = document.querySelector('.tabbar');
          const inp = el.querySelector('input');
          const ir = inp ? inp.getBoundingClientRect() : null;
          return {
            w: Math.round(r.width), wantW: Math.round(Math.max(420, W / 2)),
            right: Math.round(W - r.right), top: Math.round(r.top), bottom: Math.round(H - r.bottom),
            tbGone: !tb || !tb.getClientRects().length || getComputedStyle(tb).display === 'none',
            topbarEff: +eff(document.getElementById('topbar')).toFixed(2),
            topbarPE: getComputedStyle(document.getElementById('topbar')).pointerEvents,
            toolsEff: +eff(document.getElementById('mapActions')).toFixed(2),
            plateEff: +eff(document.getElementById('dwellPlate')).toFixed(2),
            inputTopGap: ir ? Math.round(ir.top - r.top) : null,
          };
        });
        ok(`L4s ${eng}/${S.tag} 搜尋·右半全高 search-land,輸入框釘頂`,
          !s.err && Math.abs(s.w - s.wantW) <= 2 && s.right <= 8 && s.top <= 8 && s.bottom <= 8
          && s.inputTopGap != null && s.inputTopGap <= 70, JSON.stringify(s));
        // §04c v2:降級值從 .35 改成 .55(仍讀得出時間與班數),而且設計明寫「不可互動」——
        // 只調不透明度不關 pointer-events 的話,看起來是背景卻按得到,是最糟的中間態。
        ok(`L4s ${eng}/${S.tag} 搜尋·tab bar 藏起、頂列退成不可互動的背景、工具堆與站名牌讓位`,
          s.tbGone === true && s.topbarEff <= 0.6 && s.topbarEff >= 0.4 && s.topbarPE === 'none'
            && s.toolsEff <= 0.05 && s.plateEff <= 0.05,
          JSON.stringify({ tbGone: s.tbGone, topbar: s.topbarEff, 頂列可互動: s.topbarPE, tools: s.toolsEff, plate: s.plateEff }));
        // 相機暫停的差分:把車撥快 120 秒(未暫停的話跟車鏡頭必動),量固定地理錨點的螢幕位置。
        // 心得:寫 simSec 必同時 clockAtNow=false;量完交還牆鐘,下一幀自動回到現在。
        const pause = await page.evaluate(async () => {
          const anchor = window.__M.getCenter();
          const at = () => window.__M.toScreen(anchor);
          const a0 = at();
          state.clockAtNow = false; state.simSec += 120;
          await new Promise(r => setTimeout(r, 900));
          const a1 = at();
          state.clockAtNow = true;
          await new Promise(r => setTimeout(r, 400));
          return { dx: +(a1.x - a0.x).toFixed(1), dy: +(a1.y - a0.y).toFixed(1) };
        });
        ok(`L4s ${eng}/${S.tag} 搜尋·打字中相機暫停(車走 120 秒鏡頭不動)`,
          Math.abs(pause.dx) <= 2 && Math.abs(pause.dy) <= 2, JSON.stringify(pause));
        const oS = await settledOverlap(page);
        const realS = oS.inter.filter(pair => !(/#searchPanel/.test(pair) && /#topbar/.test(pair)));
        ok(`L2 ${eng}/${S.tag} 搜尋·浮層不相交(頂列=設計上的背景層,豁免)`, realS.length === 0, realS.join(' | '));
        ok(`L2 ${eng}/${S.tag} 搜尋·浮層不出視窗`, oS.off.length === 0, oS.off.join(' '));
        await page.evaluate(() => { soloPanel(null); updateSheetOpenClass(); });
        await page.waitForTimeout(300);
        continue;
      }

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
      //    露出區裡（852 寬時容器中心 426 < 側欄左緣 504）⇒「看得見」對讓位機制零鑑別力。
      //    §04c 契約：置中目標＝露出地圖矩形幾何中心＋前瞻（沿行進方向偏 15% 短邊），
      //    四邊都讓（頂列/tabbar/速度膠囊/跟隨欄/工具堆/側欄），照 __aheadExpect 的契約推導驗。
      // 🔴 必須在「放大之後」量：橫向開機是 zoom 6（台灣的南北向要塞進 393px 高），
      //    那個縮放下視窗經度跨幅 18.7° 比整個 maxBounds(10.75°) 還寬 ⇒ Leaflet 把中心完全釘死、
      //    地圖一格都不能平移，讓位在物理上不可能發生。使用者跟車時本來就會放大，
      //    這裡就照那個真實狀態驗（心得 28：只驗初始乾淨狀態＝沒驗）。
      await page.evaluate(() => { state._autoPan = true; window.__M.setView(window.__M.getCenter(), 11, { animate: false }); state._autoPan = false; });
      await page.waitForTimeout(700);
      const cam = await page.evaluate(() => window.__aheadExpect());
      aheadCount(cam);
      ok(`L1b ${eng}/${S.tag} ${P.label}·放大後列車在露出中心＋前瞻`, aheadPass(cam),
        JSON.stringify({ err0: cam.err0, dist: cam.dist, m: cam.m, dir: cam.dir, ex: cam.ex }));

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
    const trainable = PANELS.filter(p => !p.clearsFollow && p.key !== 'search').length;
    ok(`L9 ${eng}/${S.tag} 面板形態覆蓋率`, coveredForm === PANELS.length, `${coveredForm}/${PANELS.length} 真的被開起來量過`);
    ok(`L9 ${eng}/${S.tag} 列車判準覆蓋率`, coveredTrain === trainable,
      `${coveredTrain}/${trainable}（附近車站清跟隨、搜尋暫停相機——依設計不計入，各走自己的具名判準）`);

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
      const measure = (name, el, isPlate) => {
        if (!el) { out.push({ name, missing: true }); return; }
        // 站名牌的側欄契約 2026-08-26 換了(§04c v2「改·第 8 條」):原本是「側欄開著時整顆淡出」,
        // 現在是**併進卡頭**——牌變成卡的一列,結構上不可能鑽到卡底下。
        if (isPlate && el.classList.contains('dp-docked') && el.closest('.board')) {
          out.push({ name, ox: 0, oy: 0, overlaps: false, w: 0, docked: true });
          return;
        }
        // 沒併進去的情形(開的是亮點/最愛等別的面板,不是車站看板)牌仍是獨立牌,新契約下它**不再淡出**
        // ⇒ 要驗的就回到本題:那張獨立牌會不會鑽進側欄底下。舊版在這裡驗「有沒有淡出」,
        // 契約換掉之後那條等於在要求一個已經廢掉的行為(實測 op=1 恆紅)。
        // 🔴 量它的幾何一定要先補 .show:牌的橫式中線靠 .show 的 translateX(-50%) 才成立,
        //    不補就會量到往右偏半個牌寬的假 rect(那正好會假疊上側欄)。
        if (isPlate) {
          const hadShow = el.classList.contains('show');
          const prevTr = el.style.transition;
          el.style.transition = 'none'; // 牌有 opacity/transform 過渡:不關掉會量到過渡中的中間值
          el.classList.add('show');
          const r = el.getBoundingClientRect();
          const ox = Math.min(r.right, rail.right) - Math.max(r.left, rail.left);
          const oy = Math.min(r.bottom, rail.bottom) - Math.max(r.top, rail.top);
          if (!hadShow) el.classList.remove('show');
          el.style.transition = prevTr;
          out.push({ name, ox: Math.round(ox), oy: Math.round(oy), overlaps: ox > 2 && oy > 2,
            w: Math.round(r.width), plate: true });
          return;
        }
        const prevHidden = el.hidden, prevDisplay = el.style.display, prevVis = el.style.visibility;
        el.hidden = false; el.style.display = 'block'; el.style.visibility = 'hidden'; // 量幾何不改畫面
        const r = el.getBoundingClientRect();
        const ox = Math.min(r.right, rail.right) - Math.max(r.left, rail.left);
        const oy = Math.min(r.bottom, rail.bottom) - Math.max(r.top, rail.top);
        out.push({ name, ox: Math.round(ox), oy: Math.round(oy), overlaps: ox > 2 && oy > 2, w: Math.round(r.width) });
        el.hidden = prevHidden; el.style.display = prevDisplay; el.style.visibility = prevVis;
      };
      for (const id of targets) measure('#' + id, document.getElementById(id), id === 'dwellPlate');
      for (const sel of bySel) measure(sel, document.querySelector(sel));
      return out;
    });
    const found = wideOverlays.filter(o => !o.missing);
    const clash = found.filter(o => o.overlaps);
    ok(`L2b ${eng}/${S.tag} 整寬浮層不鑽進側欄底下`, clash.length === 0,
      clash.map(c => `${c.name}疊${c.ox}×${c.oy}`).join(' ')
        || `逐一驗過 ${found.map(o => o.name).join('/')}`);
    ok(`L9 ${eng}/${S.tag} 整寬浮層覆蓋率`, found.length >= 5,
      `${found.length}/6 找得到並量到（缺的：${wideOverlays.filter(o => o.missing).map(o => o.name).join(',') || '無'}）`);

    // L2c：列車正在停靠站（body.dwell-show）。這個狀態純粹看跑的當下有沒有車在停站，
    // 靠運氣量不到——第一版就是這樣間歇性地紅過一次然後又自己消失（分母靠運氣＝沒有分母）。
    // 判準寫使用者看得到的性質：「站名牌與跟隨欄不會同時搶同一塊畫面」。
    // §04c 起合法實現有三種：站名牌淡出（側欄開著時的新做法）、跟隨欄淡出（直式沿用）、
    // 或兩者排開到不相交（契約8 中線帶的常態）。判準不綁實現，三個都問，全不成立才紅。
    const dwell = await page.evaluate(() => {
      const dp = document.getElementById('dwellPlate'), fp = document.getElementById('followPanel');
      if (!fp || fp.hidden) return { err: 'no-follow-panel' };
      const prevHidden = dp.hidden, prevVis = dp.style.visibility, prevHtml = dp.innerHTML;
      dp.hidden = false; dp.style.visibility = 'hidden'; // 量幾何不改畫面
      if (!dp.textContent.trim()) dp.textContent = '停靠中 臺北'; // 空的話 rect 會是 0，相交判準就沒牙
      document.body.classList.add('dwell-show');
      const effOf = n => { let o = 1; for (let e = n; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0; return o; };
      const eff = effOf(fp), plateEff = +getComputedStyle(dp).opacity; // 牌的淡出掛在自身(sheet-open 那條)
      const a = fp.getBoundingClientRect(), b = dp.getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const out = { eff: +eff.toFixed(2), pe: getComputedStyle(fp).pointerEvents, plateEff: +plateEff.toFixed(2),
        fpDisplay: getComputedStyle(fp).display, plateDocked: dp.classList.contains('dp-docked') && !!dp.closest('.board'),
        plate: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        overlap: ox > 2 && oy > 2, ox: Math.round(ox), oy: Math.round(oy) };
      document.body.classList.remove('dwell-show');
      dp.hidden = prevHidden; dp.style.visibility = prevVis; dp.innerHTML = prevHtml;
      return out;
    });
    const fpFaded = !dwell.err && (dwell.eff < 0.05 || dwell.pe === 'none' || dwell.fpDisplay === 'none');
    const plateFaded = !dwell.err && dwell.plateEff <= 0.05;
    const plateDocked = !dwell.err && dwell.plateDocked === true;
    // §04c v2 起合法實現多一種、也少一種:跟隨欄本身廢除(display:none 也算「不搶畫面」),
    // 而站名牌在卡開著時是**併進卡頭**——那時它是卡的一列,談不上互搶。四種都不成立才紅。
    ok(`L2c ${eng}/${S.tag} 停靠中·站名牌與跟車資訊不互搶畫面`,
      !dwell.err && (plateDocked || fpFaded || plateFaded || dwell.overlap === false),
      `走「${plateDocked ? '站名牌併進卡頭' : plateFaded ? '站名牌淡出' : fpFaded ? '跟隨欄不現身' : '排開到不相交'}」 ${JSON.stringify(dwell)}`);
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
      const mc = window.__M.getContainer().getBoundingClientRect();
      const x = mc.left + (r.left - mc.left) / 2, y = mc.top + mc.height / 2; // 露出區的正中
      const hit = document.elementFromPoint(x, y);
      let onMap = false;
      for (let e = hit; e; e = e.parentElement) if (e === window.__M.getContainer()) { onMap = true; break; }
      return { x: Math.round(x), y: Math.round(y), onMap, hit: hit ? (hit.id || hit.tagName) : null };
    });
    ok(`L8 ${eng}/${S.tag} 側欄開著時仍點得到露出的地圖`, tap.onMap === true, JSON.stringify(tap));

    await ctx.close();
  }
}

// ─────────────────────────────────────────────────────────────
// F：0812 實機退回三修(build47)——更多抽屜撞動態島/實機字級膨脹/跟隨相機卡死
// ─────────────────────────────────────────────────────────────
async function fix0812Suite(browser, eng) {
  const b = await boot(browser, { w: 852, h: 393, tag: '16橫' });
  if (!b) { ok(`F0 ${eng} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件'); return; }
  const { ctx, page } = b;
  // F1 更多抽屜:模擬動態島——--sa-l/--sa-r 是 env(safe-area-inset-*) 的 :root 別名(Playwright 給
  // 不了 env 真值,蓋別名層即可)。橫放兩種握持方向動態島各在一側,兩側都要驗(Codex 複審:只驗
  // 左島=右島越界/偏心全放行);置中=左右留白差 ≤8px。F2 順帶讀 text-size-adjust。
  let adjVal = '';
  for (const isl of [{ sal: 59, sar: 0, tag: '左島' }, { sal: 0, sar: 59, tag: '右島' }]) {
    const m1 = await page.evaluate(cfg => {
      document.documentElement.style.setProperty('--sa-l', cfg.sal + 'px');
      document.documentElement.style.setProperty('--sa-r', cfg.sar + 'px');
      document.body.classList.add('tools-open');
      const el = document.querySelector('.more-sheet');
      const r = el.getBoundingClientRect();
      const row = el.querySelector('.ms-row');
      const fs = row ? parseFloat(getComputedStyle(row).fontSize) : 0;
      const rootCs = getComputedStyle(document.documentElement);
      const adj = (rootCs.getPropertyValue('-webkit-text-size-adjust') || rootCs.getPropertyValue('text-size-adjust') || '').trim();
      const vw = window.innerWidth;
      document.body.classList.remove('tools-open');
      document.documentElement.style.removeProperty('--sa-l');
      document.documentElement.style.removeProperty('--sa-r');
      const safeL = Math.max(16, cfg.sal), safeR = vw - Math.max(16, cfg.sar);
      return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: Math.round(r.width), fs, adj, vw,
        safeL, safeR, skew: +((r.left - safeL) - (safeR - r.right)).toFixed(1) };
    }, isl);
    adjVal = m1.adj;
    ok(`F1 ${eng}/16橫/${isl.tag} 更多抽屜讓開安全區+限寬+置中(歪斜≤8px)`,
      m1.left >= m1.safeL - 0.5 && m1.right <= m1.safeR + 0.5 && m1.w <= 481 && m1.fs <= 14.5 && Math.abs(m1.skew) <= 8,
      JSON.stringify(m1));
  }
  // 桌面 WebKit 不支援 iOS 專屬的 text autosizing 屬性(computed 讀空),chromium 讀得到 100%
  ok(`F2 ${eng} text-size-adjust=100%(治實機橫放字級膨脹)`, adjVal === '100%' || (eng === 'webkit' && adjVal === ''), `adj=${adjVal || '(空)'}`);
  // F3 相機自癒 v2 三情境(Codex 複審:v1 讀累計值+只測健康路徑=假綠入口;改記前後差 delta):
  // (a) 手勢持續中按兵不動(負對照),手勢一停立即開火——驗 _gestureAt 禁救閘的兩側;
  // (b) _zoomAnim 卡死(>5s):v1 把它抄成前置閘=永不開火(實機正是這型),v2 須開火+清旗標;
  // (c) _transition 卡死:updateFollowCamera 開頭 triage 清旗標+撤遮幕,recenterTo 同幀接手。
  const f3a = await page.evaluate(async () => {
    const tr = state.followTrain; if (!tr) return { err: 'no-follow' };
    window.__origRecenter = recenterTo;
    recenterTo = () => {}; // 癱瘓主置中路徑:能救回來的只剩自癒
    const p = trainPos(tr, state.simSec);
    const rs0 = state._camRescues || 0;
    window.__M.setView([p.lat + 0.4, p.lon - 0.4], 11, { animate: false });
    const iv = setInterval(() => { state._gestureAt = performance.now(); }, 400); // 模擬使用者持續操作
    await new Promise(r => setTimeout(r, 4300));
    clearInterval(iv);
    const held = (state._camRescues || 0) - rs0;
    state._gestureAt = 0; // 手勢停止(禁救期已過):離屏計時早已滿,下一拍就該開火
    await new Promise(r => setTimeout(r, 1600));
    const fired = (state._camRescues || 0) - rs0;
    const p2 = trainPos(tr, state.simSec) || p;
    const cp = window.__M.toScreen([p2.lat, p2.lon]);
    const sz = window.__M.getSize();
    recenterTo = window.__origRecenter;
    return { held, fired, z: +window.__M.getZoom().toFixed(1),
      inView: cp.x >= 0 && cp.x <= sz.x && cp.y >= 0 && cp.y <= sz.y };
  });
  ok(`F3a ${eng}/16橫 自癒:手勢持續中按兵不動(0 次),手勢停止即開火貼車 z≥13`,
    !f3a.err && f3a.held === 0 && f3a.fired >= 1 && f3a.inView && f3a.z >= 13, JSON.stringify(f3a));
  const f3b = await page.evaluate(async () => {
    const tr = state.followTrain; if (!tr) return { err: 'no-follow' };
    const p = trainPos(tr, state.simSec);
    const rs0 = state._camRescues || 0;
    // 模擬縮放旗標卡死:recenterTo 被它天然否決(函式開頭 return),zoomAnimFrame 可能逐幀丟例外
    // ——相機段(9039)在 draw 分支(9064)之前,自癒仍會跑到;這正是實機凍結的擬真形態。
    // 🔴 注旗標必須在 setView 之後:setView 改 zoom 會發 zoomend→endZoomAnim 把假旗標清掉
    // (首輪突變在 v1 上量到 za:false 才揭穿——先 setView 的版本連 v2 都會假紅)
    window.__M.setView([p.lat + 0.4, p.lon - 0.4], 11, { animate: false });
    state._zoomAnim = true; state._zaAt = performance.now() - 6000; state._zaCal = null; state._zaCalPend = null;
    state._gestureAt = 0;
    await new Promise(r => setTimeout(r, 4300));
    const p2 = trainPos(tr, state.simSec) || p;
    const cp = window.__M.toScreen([p2.lat, p2.lon]);
    const sz = window.__M.getSize();
    return { d: (state._camRescues || 0) - rs0, za: !!state._zoomAnim, z: +window.__M.getZoom().toFixed(1),
      inView: cp.x >= 0 && cp.x <= sz.x && cp.y >= 0 && cp.y <= sz.y };
  });
  ok(`F3b ${eng}/16橫 自癒:_zoomAnim 卡死(>5s)不再否決——開火貼車+旗標清除`,
    !f3b.err && f3b.d >= 1 && !f3b.za && f3b.inView && f3b.z >= 13, JSON.stringify(f3b));
  const f3c = await page.evaluate(async () => {
    const tr = state.followTrain; if (!tr) return { err: 'no-follow' };
    const p = trainPos(tr, state.simSec);
    state._transition = true; state._traAt = performance.now() - 6000;
    document.getElementById('veil').style.opacity = 1;
    window.__M.setView([p.lat + 0.4, p.lon - 0.4], 11, { animate: false });
    state._gestureAt = 0;
    await new Promise(r => setTimeout(r, 1600)); // veil 過渡 .7s+首拍 triage,留一倍餘裕
    const p2 = trainPos(tr, state.simSec) || p;
    const cp = window.__M.toScreen([p2.lat, p2.lon]);
    const sz = window.__M.getSize();
    return { tra: !!state._transition, veil: getComputedStyle(document.getElementById('veil')).opacity,
      inView: cp.x >= 0 && cp.x <= sz.x && cp.y >= 0 && cp.y <= sz.y };
  });
  ok(`F3c ${eng}/16橫 轉場旗標卡死(>5s):triage 清旗標+撤遮幕+跟隨鏡頭同幀接手`,
    !f3c.err && !f3c.tra && parseFloat(f3c.veil) < 0.05 && f3c.inView, JSON.stringify(f3c));
  await ctx.close();
  // F4 直式對照組:更多維持全寬底抽屜——橫式收斂規則不得外漏到直式
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  await ctx2.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); localStorage.setItem('trainmap-language', 'zh-TW'); } catch (e) {} });
  const pg2 = await ctx2.newPage();
  await pg2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  const p4 = await pg2.evaluate(() => {
    document.body.classList.add('tools-open');
    const r = document.querySelector('.more-sheet').getBoundingClientRect();
    document.body.classList.remove('tools-open');
    return { left: +r.left.toFixed(1), w: Math.round(r.width), vw: window.innerWidth };
  });
  ok(`F4 ${eng}/16直 更多維持全寬底抽屜(橫式規則零外漏)`, p4.left <= 2 && p4.w >= p4.vw * 0.98, JSON.stringify(p4));
  await ctx2.close();
}


// ─────────────────────────────────────────────────────────────
// F5：旋轉版面延遲 → Leaflet 尺寸過期自癒（獨立套件：深夜也要跑得到，不掛在 F0 取車之下）
// ─────────────────────────────────────────────────────────────
async function sizeGuardSuite(browser, eng) {
  // ── F5 版面尺寸過期自癒（2026-08-13 使用者實機回報「按隨機跟車後直橫都看不到軌道與車」的根因）──
  // iOS 轉向是**動畫**的：resize 事件送達時容器往往還是舊尺寸 ⇒ Leaflet 在那一幀把舊值寫進 _size
  // 後就再也不重讀（getSize 只在 _sizeChanged 為真時重量）⇒ 整套系統活在過期座標系：
  //   setView 用舊半尺寸算像素原點（車被瞄到實體螢幕外）、相機自癒的在場判定用同一個舊尺寸
  //   （判定為在場 ⇒ 永不開火，實機診斷條 rs 恆 0）、reproject 用它配畫布（軌道畫進不再覆蓋螢幕那塊）。
  // 擬真手法：先把版面釘死成舊尺寸再改視窗 ⇒ 所有 resize 監聽者（含 Leaflet trackResize）量到舊值，
  // 之後無聲放開版面（不再發 resize）——這就是實機旋轉動畫的時序。
  // 🔴 判準只認**物理事實**（Leaflet 尺寸=容器實測、畫布=容器實測×dpr、車點落在實體容器內）。
  //    不看 of/rs：那兩個值在過期座標系裡會自洽地說謊——修法前實測 of=1（「完美置中」）而車在螢幕外。
  const ctx3 = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: false });
  await ctx3.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {} });
  const pg3 = await ctx3.newPage();
  await pg3.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg3.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  await pg3.waitForTimeout(600);
  // 真按鈕路徑：此前所有判準都直呼 setFollow，randBtn→setAutoTour→nextTourTrain 這條從沒被走過
  // （使用者按的正是這顆）。抽到的車若不在行進中（深夜/剛發車）才退回 PICK_FOLLOW，確保後面量得到車點。
  const f5btn = await pg3.evaluate(async () => {
    const b = document.getElementById('randBtn'); if (b) b.click();
    await new Promise(r => setTimeout(r, 1600));
    const tr = state.followTrain;
    return (tr && trainPos(tr, state.simSec)) ? String(tr.train) : null;
  });
  const f5pick = f5btn || await pg3.evaluate(PICK_FOLLOW);
  await pg3.waitForTimeout(1200);
  const SIZE_PROBE = () => {
    const el = window.__M.getContainer(), sz = window.__M.getSize(), cv = document.getElementById('overlay');
    // MapLibre 的適配層 getSize 回容器實測,與 cw 同源、恆相等=零資訊;引擎自己的尺寸住在 transform,改讀它。
    const raw = window.__M.raw, ml = window.__ENGINE === 'maplibre' && raw && raw.transform;
    const szx = ml ? raw.transform.width : sz.x, szy = ml ? raw.transform.height : sz.y;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tr = state.followTrain, p = tr ? trainPos(tr, state.simSec) : null;
    const cp = p ? window.__M.toScreen([p.lat, p.lon]) : null;
    return {
      engine: window.__ENGINE || 'leaflet', cw: el.clientWidth, ch: el.clientHeight, szx, szy, cvw: cv.width, cvh: cv.height,
      wantW: Math.round(el.clientWidth * dpr), wantH: Math.round(el.clientHeight * dpr),
      inPhys: cp ? (cp.x >= 0 && cp.x <= el.clientWidth && cp.y >= 0 && cp.y <= el.clientHeight) : null,
      heals: state._sizeHeals || 0,
    };
  };
  const f5base = await pg3.evaluate(SIZE_PROBE);
  await pg3.evaluate(() => {
    const s = document.createElement('style'); s.id = '__lag';
    s.textContent = 'html,body{width:402px !important;height:874px !important;overflow:hidden !important}'
      + '.stage{width:402px !important;height:874px !important}';
    document.head.appendChild(s);
  });
  await pg3.setViewportSize({ width: 874, height: 402 });
  await pg3.waitForTimeout(900); // 讓 resize 監聽者全部量到「舊尺寸」
  await pg3.evaluate(() => { const s = document.getElementById('__lag'); if (s) s.remove(); });
  await pg3.waitForTimeout(1500); // 守衛每 200ms 量一次，留七倍餘裕
  const f5 = await pg3.evaluate(SIZE_PROBE);
  // 「守衛開過火」只對 Leaflet 有意義:MapLibre 用自己的 ResizeObserver 追容器(無聲放開版面也會 resize),
  // 適配層 getSize 又是容器實測 ⇒ syncMapSizeIfStale 結構上量不到過期、_sizeHeals 恆 0(M4-A 切預設後
  // 每個訪客都走這條路,不能拿 Leaflet 專屬的計數當紅)。MapLibre 那條路由 transform 尺寸＋畫布＋車點三項守。
  const f5healed = f5.engine === 'maplibre' ? true : f5.heals > f5base.heals;
  ok(`F5 ${eng}/旋轉版面延遲 尺寸自癒：Leaflet 尺寸=容器＋畫布重配＋車落在實體畫面內`,
    !!f5pick && f5.szx === f5.cw && f5.szy === f5.ch && f5.cvw === f5.wantW && f5.cvh === f5.wantH
    && f5.inPhys === true && f5healed,
    JSON.stringify({ pick: f5pick, viaRandBtn: !!f5btn, base: f5base, after: f5 }));
  // F5b 負面側：守衛不得空轉。尺寸本來就同步時每 200ms 都 invalidateSize＋reproject＝把整張圖
  // 每秒重投影五次（效能災難，且 reproject 會重配畫布清空當幀）。量「穩定後計數不再增加」。
  const f5b1 = await pg3.evaluate(SIZE_PROBE);
  await pg3.waitForTimeout(1300);
  const f5b2 = await pg3.evaluate(SIZE_PROBE);
  ok(`F5b ${eng}/尺寸同步時守衛零空轉（不重複 invalidateSize）`,
    f5b2.heals === f5b1.heals && f5b2.szx === f5b2.cw && f5b2.szy === f5b2.ch,
    JSON.stringify({ h1: f5b1.heals, h2: f5b2.heals, sz: `${f5b2.szx}x${f5b2.szy}`, cc: `${f5b2.cw}x${f5b2.ch}` }));
  await ctx3.close();
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
      // 缺陷 D（zoom 6 視窗比 maxBounds 高 ⇒ 相機釘死）已由「夾限改用露出的那塊」修掉，
      // clamped 分支**應該恆為 0**，但刻意保留：它是「夾死又回來了」的哨兵，
      // 真的走進去時至少要保證帳面等於實況（帳實不符會讓後續所有差量記帳一起歪掉）。
      // 🔴 分類器照 §04c 契約用 __aheadExpect（露出中心＋前瞻）判：第一版拿「離容器中心的
      //    垂直距離 == (bottom−top)/2」判 canPan，§04c 之後前瞻會把車帶離中心至多 15% 短邊、
      //    水平也會讓位——舊式一律誤判成「夾死」，把讓位成功的尺寸整批推進 honest 分支（分母無聲縮水）。
      const cam = await page.evaluate(() => window.__aheadExpect());
      const canPan = aheadPass(cam);
      if (canPan) {
        aheadCount(cam);
        ok(`L5 ${eng}/${S.tag} ${P.label}·列車看得見`, t.onMap === true,
          JSON.stringify(t) + `｜相機 ${JSON.stringify({ err0: cam.err0, dist: cam.dist, m: cam.m })}`);
      } else {
        const honest = await page.evaluate(() => {
          const s = state._focusShift || { x: 0, y: 0 };
          const i = mapInsets();
          // 帳面記的位移不得超過實際做得到的量（做不到卻記成做到＝帳實不符）
          return { loggedY: +(s.y || 0).toFixed(1), wantY: +((i.bottom - i.top) / 2).toFixed(1) };
        });
        ok(`L5 ${eng}/${S.tag} ${P.label}·讓位不可行時帳面誠實`,
          Math.abs(honest.loggedY) <= Math.abs(honest.wantY) + 1,
          `相機沒到位（哨兵分支，需獨立決策）: ${JSON.stringify({ err0: cam.err0, dist: cam.dist, m: cam.m })}；帳面記 ${honest.loggedY}px`);
      }
      branchCount[canPan ? 'visible' : 'clamped']++;
      // 直向的面板必須維持底部 sheet（不可被橫式規則波及）
      const bottomSheet = await page.evaluate(() => {
        const el = activeSheetEl(); const r = el.getBoundingClientRect(), mc = window.__M.getContainer().getBoundingClientRect();
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
//
// 🔴 2026-08-26 段高三段改兩段：大段 88% 與 body.sheet-full 一起退役（那組淡出規則存在的唯一理由
//    是「88% 的 sheet 會蓋滿整個畫面」）。原本的實驗組因此不存在了——但**根因那條掛點還在**
//    （resize 要重跑 updateSheetOpenClass 才會清掉段高 class），所以判準改綁還活著的那顆：
//    直向留著 `.sheet-small` 轉橫，側欄下必須被清掉。掛點被拿掉這條就會紅，牙沒有掉。
//    同時保留 sheet-full 的退役守門（它若被誰加回來，整組 HUD 會再次淡出且沒有別條判準照得到）。
// 🔴 判準寫「使用者做得到什麼」不寫 class 名：既驗 class 這個直接原因，
//    也驗它的可見後果（常駐控件的有效 opacity／指標事件／真觸控），兩層都在才抓得住換一種寫法的回歸。
// ─────────────────────────────────────────────────────────────
// 🔴 選擇器要選到「手機殼裡的那一顆」：`.grouptabs` 全頁有兩組（桌面 header 一組、手機 topbar 一組，
//    共 8 顆 gtab），手機殼下桌面那組的 rect 是 0×0。第一版判準選到桌面那顆，於是對「頂列被淡出」
//    這件事完全沒有牙（它根本不在 .topbar 裡、不吃 sheet-full 規則），還讓 tap 永遠逾時。
// 🔴 2026-08-27 起手機殼（橫式也算手機殼：MQ 是 max-width:900 **或** max-height:500）把四顆群組
//    分頁收成一顆 `#gtabOne`，點開才出選單。選擇器一律寫成「兩種形態都涵蓋」的複選，
//    只寫其中一種的話，另一種上線時 querySelector 會回 null ⇒ CHROME_PROBE 把它記成 null ⇒
//    `degraded()` 因為基準也是 null 而整條**靜默跳過**：判準沒有變紅，只是不再檢查任何東西（心得 37d）。
const GROUPSW_SEL = '.topbar .gtab-one, .topbar .grouptabs';
const CHROME_SEL = [['分組切換', GROUPSW_SEL], ['站名牌', '.tb-plate'], ['隨機跟隨', '#randBtn'], ['時鐘', '#clock'], ['跟隨小卡', '#followPanel']];
const CHROME_PROBE = () => {
  const eff = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0; return o; };
  const out = { __sheetFull: document.body.classList.contains('sheet-full') };
  // 🔴 只回「有沒有 .sheet-small」這個**可觀測事實**，不回推導出來的段名：
  //    中段根本沒有自己的 class，於是「中段」與「段高已被清掉」在 DOM 上完全同形，
  //    拿它當「轉橫後有沒有清掉」的判準是不可證偽的（第一版就這樣寫，兩組都假紅）。
  {
    const s = typeof activeSheetEl === 'function' ? activeSheetEl() : null;
    out.__smallCls = s && !s.hidden ? s.classList.contains('sheet-small') : null;
  }
  for (const [name, sel] of [['分組切換', '.topbar .gtab-one, .topbar .grouptabs'], ['站名牌', '.tb-plate'], ['隨機跟隨', '#randBtn'], ['時鐘', '#clock'], ['跟隨小卡', '#followPanel']]) {
    // 複選時取「真的渲染出來的那一個」（收合鈕與四顆分頁互斥，另一個必定 display:none）
    const el = [...document.querySelectorAll(sel)].find(e => e && !e.hidden && getComputedStyle(e).display !== 'none') || document.querySelector(sel);
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
  //    拿它比會把正常行為算成退化（舊的 large 直向態自己就是淡出的，拿它當基準會把 F1 一起放行）。
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
  for (const sz of ['small', 'medium']) {
    const b = await boot(browser, { w: 393, h: 852, tag: `直→橫(${sz})` }, { sheetSize: sz });
    if (!b) { ok(`L10 ${eng}/${sz} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件'); continue; }
    const { ctx, page } = b;
    // 全程走使用者做得到的動作：點 tab bar 開面板，然後轉向。不碰任何內部 API。
    await page.tap('#tabExplore');
    await page.waitForTimeout(750);
    const pre = await page.evaluate(CHROME_PROBE);
    ok(`L10 ${eng}/${sz} 直向前置·面板開著且段高真的是 ${sz}`,
      !!pre.__panel && pre.__smallCls === (sz === 'small') && pre.__sheetFull === false,
      JSON.stringify({ small: pre.__smallCls, full: pre.__sheetFull, panel: pre.__panel }));

    await page.setViewportSize({ width: 852, height: 393 });
    await page.waitForTimeout(900);
    const post = await page.evaluate(CHROME_PROBE);
    // 直接原因層：退役的 body.sheet-full 不得出現（它若被誰加回來，整組 HUD 會再次淡出）。
    // 🔴 刻意**不**驗「段高 class 有沒有被清掉」：中段與已清掉在 DOM 上同形（都沒有 class），
    //    而且側欄 CSS 已把 .sheet-small 的效果整個蓋掉（max-height:none/min-height:0）⇒
    //    殘留與否使用者看不出差別，寫成判準只是實作瑣事。resize 掛點的真實後果由 L10b
    //    （讓位軸換成水平、釘點回到露出中心）與下面的真觸控收尾負責。
    ok(`L10 ${eng}/${sz} 轉橫後沒掛已退役的 body.sheet-full`,
      post.__sheetFull === false,
      JSON.stringify({ small: post.__smallCls, full: post.__sheetFull, panel: post.__panel }));
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
      const r = el.getBoundingClientRect(), mc = window.__M.getContainer().getBoundingClientRect();
      return { id: el.id, wRatio: +(r.width / mc.width).toFixed(2), bottomAnchored: Math.abs(mc.bottom - r.bottom) < 120,
        size: el.classList.contains('sheet-small') ? 'small' : 'medium' };
    });
    ok(`L10 ${eng}/${sz} 轉回直向·回到底部 sheet 且段高偏好還在`,
      !back.err && back.wRatio > 0.85 && back.bottomAnchored && back.size === sz, JSON.stringify(back));

    // 真觸控收尾（換組會關掉面板，所以放在所有形態斷言之後）：分組切換按下去要真的換組。
    // 心得 37a：命中測試對祖先容器恆真，答不了「做得到嗎」——只有真的按一次並看它改變狀態才算數。
    await page.setViewportSize({ width: 852, height: 393 });
    await page.waitForTimeout(900);
    // 兩種形態各走各的路徑，但判準同一條：**state.group 真的變了**。
    // 不判 class（收合鈕沒有 .active，判 class 會讓收合形態永遠假紅）。
    // v3(2026-08-27 裁示):側欄可以蓋住右上角(分組收合鈕右緣對齊工具堆,一起被蓋)——
    // 使用者的實際操作序=先收面板/跟車再換組,判準照那個序走;逃生門(fp 可收合)由裁示背書。
    await page.evaluate(() => { try { soloPanel(null); updateSheetOpenClass(); clearFollow(); } catch (e) {} });
    await page.waitForTimeout(400);
    let tapped = true, switched = false, how = '';
    try {
      const before = await page.evaluate(() => state.group);
      const one = await page.evaluate(() => {
        const b = document.querySelector('.topbar .gtab-one');
        return !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getClientRects().length > 0;
      });
      if (one) {
        how = '收合鈕';
        await page.tap('.topbar .gtab-one', { timeout: 3000 });
        await page.waitForTimeout(320);
        const rows = page.locator('#gtabPop .gp-row:not([aria-current=true])');
        if (await rows.count() === 0) tapped = false; else await rows.first().tap({ timeout: 3000 });
      } else {
        how = '四顆分頁';
        const tabs = page.locator('.topbar .grouptabs .gtab:not(.active)');
        if (await tabs.count() === 0) tapped = false; else await tabs.first().tap({ timeout: 3000 });
      }
      if (tapped) {
        await page.waitForTimeout(700);
        switched = (await page.evaluate(() => state.group)) !== before;
      }
    } catch (e) { tapped = false; }
    ok(`L10 ${eng}/${sz} 來回轉兩次後分組切換（${how}）真的按得動`, tapped && switched, `tap=${tapped} 換組了=${switched}`);
    await ctx.close();
  }

  // L10b：讓位軸向的對帳。跟車／放空每幀都會重新取景所以會自癒，**沒在跟車**時才看得到——
  // 轉向後讓位軸從垂直換成水平，若沒有重跑一次差量記帳，鏡頭會停在舊的垂直位移上。
  // 🔴 §04c 判準寫成不變量：「露出中心當下釘著的地理點」在面板開關／轉向之後**仍在新露出中心**。
  //    真值＝渲染 rect 推的露出區（__exposed）＋ Leaflet 公開投影，不讀 state._focusShift（心得 29）。
  //    舊寫法拿 (i.bottom-i.top)/2 對「容器中心」記帳——§04c 後乾淨態就有頂列/tabbar/膠囊/工具堆
  //    的常駐讓位，那套兩邊制的絕對量對不上了；不變量式把基準內生化，每一步只問「跟上了沒」。
  const b2 = await boot(browser, { w: 393, h: 852, tag: '轉向讓位對帳' }, { follow: false });
  const { ctx: c2, page: p2 } = b2;
  const ANCHOR = [24.5, 121.0]; // 台灣中部：zoom 9 下四周都還有平移餘裕，不會被 maxBounds 夾住干擾
  await p2.evaluate(a => { state._autoPan = true; window.__M.setView(a, 9, { animate: false }); state._autoPan = false; }, ANCHOR);
  await p2.waitForTimeout(400);
  const PIN = () => {
    const ex = window.__exposed();
    const ll = window.__M.fromScreen(L.point(ex.cx, ex.cy));
    return { lat: ll.lat, lng: ll.lng, ex };
  };
  const AT = pin => {
    const ex = window.__exposed();
    const cp = window.__M.toScreen([pin.lat, pin.lng]);
    return { dx: +(cp.x - ex.cx).toFixed(1), dy: +(cp.y - ex.cy).toFixed(1), ex };
  };
  const pin = await p2.evaluate(PIN);
  await p2.tap('#tabExplore');
  await p2.waitForTimeout(800);
  const a1 = await p2.evaluate(AT, pin);
  // 面板開在下方 ⇒ 露出中心上移(bottom inset 大幅成長)；釘點必須被相機帶著走到新中心
  ok(`L10b ${eng} 直向開面板·垂直讓位把釘點帶到新露出中心`,
    a1.ex.bottom > pin.ex.bottom + 40 && Math.abs(a1.dx) <= 8 && Math.abs(a1.dy) <= 8,
    `釘點偏移 (${a1.dx},${a1.dy})；下界 ${pin.ex.bottom}→${a1.ex.bottom}`);
  await p2.setViewportSize({ width: 852, height: 393 });
  await p2.waitForTimeout(900);
  const a2 = await p2.evaluate(AT, pin);
  // 轉橫後面板變右側欄 ⇒ 讓位軸換成水平(right inset 取代 bottom inset)；釘點仍要在新露出中心
  ok(`L10b ${eng} 轉橫後·讓位軸換成水平且釘點仍在露出中心`,
    a2.ex.right > 100 && a2.ex.bottom < a1.ex.bottom - 100 && Math.abs(a2.dx) <= 8 && Math.abs(a2.dy) <= 8,
    `釘點偏移 (${a2.dx},${a2.dy})；右界 ${a1.ex.right}→${a2.ex.right}、下界 ${a1.ex.bottom}→${a2.ex.bottom}`);
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
  const map = window.__M;
  const b = state._panFence; if (!b) return { err: 'no-maxbounds' };
  const z = map.getZoom();
  const p1 = map.worldPx(b.getNorthWest(), z), p2 = map.worldPx(b.getSouthEast(), z);
  const cp = map.toScreen(map.worldUnpx({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, z));
  const mc = map.getContainer().getBoundingClientRect();
  const el = typeof activeSheetEl === 'function' ? activeSheetEl() : null;
  let isRail = null;
  if (el && !el.hidden) {
    // 形態從 rect 推，不問實作：撐滿高又只佔窄幅一欄＝右側欄，其餘＝底部 sheet
    const pr = el.getBoundingClientRect();
    isRail = (pr.height / mc.height) > 0.6 && (pr.width / mc.width) < 0.6;
  }
  // 可視中線=§04c 露出區中心(共用契約推導;第一版只扣側欄,漏了工具欄/頂列/tabbar/膠囊,
  // 於是側欄形態下永遠差「工具欄那份/2」——判準比實作少讓一塊,x 恆差 ~27px 的假紅)
  const ex = window.__exposed();
  return { isRail, zoom: z, degraded: !!state._limitCenterDegraded,
    dx: +(cp.x - ex.cx).toFixed(1), dy: +(cp.y - ex.cy).toFixed(1) };
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
// L13–L15：使用者 2026-08-11 橫放實機回報的三件事
//   E 解鎖後的「回到列車」膠囊 72px 寬，而動作列的讓開量是照「鎖定時的 44px 小方鈕」寫死的 60px
//     ⇒ 實測疊 22×12px。這是心得 28 那族：只驗了乾淨態（剛跟車＝鎖著），沒驗「使用者拖過地圖之後」。
//   F 停靠站名牌沿用直向的「左右各 8px 整寬」寫法，在 393 高的視窗吃掉 98% 寬。
//   G 橫放時動態島吃掉左右各 59px，而全檔 env(safe-area-inset-left/right) 使用次數 = 0。
//     模擬法：覆寫 --sa-l／--sa-r 兩個變數（實作用它們包住 env()）。這只驗得到「版面有讀這兩個值」，
//     驗不到「值真的來自 env()」——後者另用一條原始碼斷言把守（G3），兩條缺一不可。
// ─────────────────────────────────────────────────────────────
const ISLAND = 59; // iPhone 14 Pro 起橫放的左右安全區(pt)。iPhone X 世代是 44，取大的當判準。

// 必須待在動態島安全區外的 UI。'SHEET' 是當下那張面板（側欄），由 activeSheetEl() 取。
// 第三欄 'L' ＝只驗左帶：v4/v5（08-27 裁示）後，頂列右群與工具欄（橫排）右緣貼實體螢幕邊
// （right:10px，不再讓 sa-r）。這個帶檢查把整條右緣豎帶當禁區，但真島只佔該帶的垂直中央
// （y≈170–230）；v5 的工具橫排收在頂帶 y≈56–100、頂列在 y≈8–48，兩種持法都不會碰到實體島
// ——粗粒度的帶檢查照不到這件事，故這三項右帶檢查廢除；左帶（軌島牌／時鐘側）照舊必須讓。
const ISLAND_SEL = [
  ['頂列', '.topbar', 'L'], ['時鐘', '#clock'], ['分頁列按鈕', '.tabbar button'],
  // 跟隨鎖 §04c 起住在工具欄裡:選 #followLockBtn 本尊——老家 .follow-lock-ctl 在手機上是被藏掉的
  // 空殼,選它=永遠量不到(L15b 具名覆蓋率就是為了抓這種分母缺口)
  // 跟隨小卡 .follow-panel 2026-08-26 起在橫式廢除(§04c v2「改·第 4 條」),它的內容併進合併卡
  // ⇒ 這份清單裡永遠量不到它(L15b 的具名覆蓋率會如實轉紅)。卡本身以 'SHEET' 那一項涵蓋。
  ['停靠站名牌', '#dwellPlate'], ['跟隨鎖', '#followLockBtn', 'L'],
  ['動作列', '.map-actions', 'L'], ['站台帶', '.controls'], ['側欄', 'SHEET'],
];

const ISLAND_PROBE = ({ sels, inset }) => {
  const W = innerWidth, out = [], seen = [];
  const vis = el => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && el.getBoundingClientRect().width > 0.5;
  };
  for (const [name, sel, sides] of sels) {
    let els;
    if (sel === 'SHEET') { const e = typeof activeSheetEl === 'function' ? activeSheetEl() : null; els = e && !e.hidden ? [e] : []; }
    else els = [...document.querySelectorAll(sel)];
    els = els.filter(vis);
    if (!els.length) continue;
    seen.push(name);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const l = inset - r.left, rr = r.right - (W - inset);
      const badL = l > 0.5, badR = sides !== 'L' && rr > 0.5;
      if (badL || badR) { out.push(`${name}${badL ? ` 左壓${Math.round(l)}` : ''}${badR ? ` 右壓${Math.round(rr)}` : ''}`); break; }
    }
  }
  return { bad: out, seen };
};

// 跟隨鎖與工具欄：§04c 之後鎖鈕**是**工具欄成員（不再是 Leaflet 控制角的獨立浮件），
// 「與動作列不相交」這個判準概念死亡。改驗欄內秩序：成員互不相疊、右緣對齊（「回到列車」膠囊
// 變寬只准往左長）、每顆 ≥44（合約11），且兩顆都真的按得到（心得 33：驗按鈕是驗點它會發生什麼）。
const LOCK_PROBE = () => {
  const lb = document.getElementById('followLockBtn'), ma = document.getElementById('mapActions');
  const rb = document.getElementById('randBtn');
  if (!lb || !ma) return { err: 'missing' };
  const owns = (el, root) => { for (let e = el; e; e = e.parentElement) if (e === root) return true; return false; };
  const at = (r, root) => owns(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), root);
  const kids = [...ma.children].filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none');
  const rects = kids.map(el => ({ id: el.id || el.className.toString().slice(0, 16), r: el.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i].r, b = rects[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 0.5 && h > 0.5) overlaps.push(`${rects[i].id}∩${rects[j].id}=${Math.round(w)}×${Math.round(h)}`);
  }
  const maR = ma.getBoundingClientRect(), Lr = lb.getBoundingClientRect();
  // v5(08-27 裁示「一排橫的在右上方」):橫式工具欄從直欄改橫排——直欄契約「右緣對齊」死亡,
  // 列契約=上緣對齊＋整欄單列高(≤46=44+捨入)＋角落顆(最右)是隨機跟隨(row-reverse 的 DOM 首顆)。
  const sorted = rects.slice().sort((a, b) => b.r.right - a.r.right);
  return {
    unlocked: lb.classList.contains('unlocked'), label: (lb.textContent || '').trim(),
    inRail: lb.parentNode === ma, lockW: Math.round(Lr.width), lockH: Math.round(Lr.height),
    topAligned: rects.every(k => Math.abs(k.r.top - maR.top) <= 2),
    singleRow: Math.round(maR.height) <= 46,
    cornerId: sorted.length ? sorted[0].id : null,
    minSize: Math.round(Math.min(...rects.map(k => Math.min(k.r.width, k.r.height)))),
    overlaps,
    lockTappable: at(Lr, lb), randTappable: rb && rb.getClientRects().length ? at(rb.getBoundingClientRect(), rb) : null,
  };
};

// 停靠站名牌：把時鐘撥進跟隨列車的某個停靠窗，量它相對「露出的地圖」有多大
const DWELL_PROBE = async () => {
  const tr = state.followTrain; if (!tr) return { err: 'no-follow' };
  let hit = false;
  for (const st of tr.stops) {
    if (st.arrSec != null && st.depSec != null && st.depSec > st.arrSec + 20) {
      state.simSec = st.arrSec + Math.floor((st.depSec - st.arrSec) / 2);
      state.clockAtNow = false; // 記憶 clock-jump-must-clear-clockatnow：直接寫 simSec 必同時清
      hit = true; break;
    }
  }
  if (!hit) return { err: 'no-dwell-window' };
  await new Promise(r => setTimeout(r, 1300)); // > .45s 淡入
  const dp = document.getElementById('dwellPlate'); const r = dp.getBoundingClientRect();
  const el = typeof activeSheetEl === 'function' ? activeSheetEl() : null;
  const railL = el && !el.hidden ? el.getBoundingClientRect().left : innerWidth;
  // 🔴 縮小之後還要「看得見」。第一版把它縮到 129px 卻留在左上角,結果整個躲進跟隨小卡後面
  //    ——小卡不透明,而「停靠時小卡淡出」那條契約只在另有面板開著(body.sheet-open)時生效。
  //    量體判準完全照不到這件事:寬高比越小越綠,而越小越容易被蓋掉。所以要另量遮蔽。
  //    dwellPlate 是 pointer-events:none,elementFromPoint 會直接穿過去 ⇒ 只能用矩形相交,
  //    且只跟「當下真的看得到的」遮蔽者比(淡出中的小卡不算遮蔽)。
  const boxes = [];
  for (const sel of ['.follow-panel', '.freq-card', '.map-actions', '.controls']) {
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity <= .05) continue;
      const b2 = el.getBoundingClientRect(); if (b2.width < 0.5) continue;
      const w = Math.min(r.right, b2.right) - Math.max(r.left, b2.left);
      const h = Math.min(r.bottom, b2.bottom) - Math.max(r.top, b2.top);
      if (w > 0.5 && h > 0.5) boxes.push(`${sel} ${Math.round(w)}×${Math.round(h)}`);
    }
  }
  const el2 = typeof activeSheetEl === 'function' ? activeSheetEl() : null;
  if (el2 && !el2.hidden) {
    const b3 = el2.getBoundingClientRect();
    const w = Math.min(r.right, b3.right) - Math.max(r.left, b3.left);
    const h = Math.min(r.bottom, b3.bottom) - Math.max(r.top, b3.top);
    if (w > 0.5 && h > 0.5) boxes.push(`側欄 ${Math.round(w)}×${Math.round(h)}`);
  }
  // §04c 契約8/合約11:站名牌中心 x=中線帶([跟隨欄右緣+8, 側欄左緣−8])中點;速度膠囊共用同一中線。
  // 判準側從 rect 自算,不讀實作的 --land-lb/--rail-occupy 兩顆變數(心得 29)。
  const fpEl = document.getElementById('followPanel');
  const fpOn = fpEl && !fpEl.hidden && !fpEl.classList.contains('fp-min') && getComputedStyle(fpEl).display !== 'none';
  const fpR2 = fpOn ? fpEl.getBoundingClientRect() : null;
  // v3:跟隨欄可能是右側欄(rect 判,不問實作)——右形=右界之一;左形(捷運小卡)=左界,同 v2。
  const fpIsRight = fpR2 && (fpR2.left + fpR2.right) / 2 > innerWidth / 2;
  const mlLeft = fpR2 && !fpIsRight ? fpR2.right + 8 : 0;
  let mlRight = (el2 && !el2.hidden) ? el2.getBoundingClientRect().left - 8 : innerWidth;
  if (fpIsRight) mlRight = Math.min(mlRight, fpR2.left - 8);
  const midX = +((mlLeft + mlRight) / 2).toFixed(1);
  const capEl = document.querySelector('.controls');
  const capR = capEl && capEl.getClientRects().length ? capEl.getBoundingClientRect() : null;
  return {
    show: dp.classList.contains('show') && +getComputedStyle(dp).opacity > .5,
    w: Math.round(r.width), h: Math.round(r.height),
    露出地圖寬: Math.round(railL), 視窗高: innerHeight,
    寬佔比: +(r.width / railL).toFixed(2), 高佔比: +(r.height / innerHeight).toFixed(2),
    被蓋: boxes,
    plateCx: +(r.left + r.width / 2).toFixed(1), midX,
    capCx: capR ? +(capR.left + capR.width / 2).toFixed(1) : null,
  };
};

// ── natTop():量「自然版位」時必須先把 sticky 拿掉 ────────────────────────────────
// 為什麼要獨立一組:L4i(牌搬出去之後分頁列回得到原位)是這個修法的端到端判準,但它整組掛在
// 「抓得到一台行駛中的台鐵車」底下 ⇒ 深夜收班時整組跳過,修法等於沒有任何守門人。這一組用
// 頁內自建的 fixture 驗**機制本身**,不需要車、不需要卡,任何時段都跑得動。
// ①(反向對照)證明陷阱真的在:同一顆元素用 offsetTop 讀到的是被 sticky top 推下去之後的值。
// ② 證明 natTop 讀到的是自然版位。③④ 證明它不留殘渣(產品的 .uni-tabs 走的是 CSS 那個分支)。
async function stickySuite(browser, eng) {
  const S = { w: 852, h: 393, tag: '16橫' };
  const b = await boot(browser, S, { follow: false });
  if (!b) { ok(`L4s0 ${eng}/${S.tag} 開頁`, false, 'boot 回 null'); return; }
  const { ctx, page } = b;
  const r = await page.evaluate(() => {
    if (typeof natTop !== 'function') return { err: 'natTop 不存在' };
    const HEAD = 99, TOP = 141;
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px;height:200px;overflow:auto;';
    box.innerHTML = `<div style="height:${HEAD}px"></div>`
      + `<div id="_ntA" style="position:sticky;top:${TOP}px;height:30px"></div>`
      + '<div style="height:900px"></div>';
    document.body.appendChild(box);
    const a = document.getElementById('_ntA');
    const snap = e => { const d = {}; for (const k of e.style) d[k] = e.style.getPropertyValue(k); return d; };
    const beforeA = snap(a), offA = a.offsetTop, natA = natTop(a), afterA = snap(a);
    const csA = getComputedStyle(a).position;

    // 產品真正走的分支:position 來自 CSS 檔、沒有 inline 值 ⇒ natTop 走 removeProperty
    const st = document.createElement('style');
    st.textContent = '#_ntB{position:sticky;top:' + TOP + 'px}';
    document.head.appendChild(st);
    const c = document.createElement('div');
    c.id = '_ntB'; c.style.height = '30px'; // 一個無關的 inline 屬性,確認沒被順手清掉
    box.insertBefore(c, a.nextSibling);
    const expectB = HEAD + a.offsetHeight;   // 期望值由 fixture 現場推導,不寫死
    const offB = c.offsetTop, natB = natTop(c);
    const inlineB = c.style.getPropertyValue('position'), hB = c.style.height, csB = getComputedStyle(c).position;
    st.remove(); box.remove();
    return { HEAD, TOP, offA, natA, sameA: JSON.stringify(beforeA) === JSON.stringify(afterA), csA,
             offB, natB, expectB, inlineB, hB, csB };
  });
  if (r.err) { ok(`L4s0 ${eng}/${S.tag} 前置·natTop 存在`, false, r.err); await ctx.close(); return; }
  ok(`L4s1 ${eng}/${S.tag} 反向對照·sticky 的 offsetTop 含被 top 推下去的量(所以不能拿它回算 top)`,
    r.offA === r.TOP && r.TOP > r.HEAD, JSON.stringify({ offsetTop: r.offA, 自然版位: r.HEAD, stickyTop: r.TOP }));
  ok(`L4s2 ${eng}/${S.tag} natTop() 回的是自然版位,不受 sticky top 影響`,
    r.natA === r.HEAD, JSON.stringify({ natTop: r.natA, 該有的值: r.HEAD }));
  ok(`L4s3 ${eng}/${S.tag} 有 inline position 時:量完逐屬性原封還原、computed 仍是 sticky`,
    r.sameA === true && r.csA === 'sticky', JSON.stringify({ 逐屬性相同: r.sameA, position: r.csA }));
  ok(`L4s4 ${eng}/${S.tag} position 來自 CSS(產品的情形):陷阱一樣在、natTop 一樣對、且不留殘渣`,
    r.offB === r.TOP && r.natB === r.expectB && r.offB > r.natB
      && r.inlineB === '' && r.hB === '30px' && r.csB === 'sticky',
    JSON.stringify({ offsetTop: r.offB, natTop: r.natB, 該有的自然版位: r.expectB,
                     inline殘渣: r.inlineB, 其他inline屬性: r.hB, computed: r.csB }));
  await ctx.close();
}

// 這支 gate 的 context 是 hasTouch+isMobile；Playwright 的 page.mouse 在 Chromium 此時不會送出
// canvas 可收到的 mouse/pointer 事件，拿它驗「使用者拖地圖」會把真綠判成紅。Chromium 走 CDP
// 送可信的 touch sequence。Playwright WebKit 只公開 touchscreen.tap、沒有 drag；該分支保留原生
// mouse sequence 驗同一套 MapLibre dragPan/dragstart 語意，真觸控由 Chromium 與最後的實機錄影守住。
async function touchDrag(page, eng, x0, y0, x1, y1) {
  const steps = 14;
  if (eng === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    try {
      // browser.newContext({ hasTouch:true }) 只影響頁面能力偵測；直接走 CDP 時仍須明示開啟
      // touch emulation，否則 dispatchTouchEvent 會成功回傳卻完全不產生 DOM 事件。
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
      });
      for (let i = 1; i <= steps; i++) {
        const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    return;
  }
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

async function deviceSuite(browser, eng) {
  const seenAll = new Set();
  for (const S of LANDSCAPE) {
    const b = await boot(browser, S, { follow: true });
    if (!b) { ok(`L13 ${eng}/${S.tag} 環境：有行駛中的台鐵車可跟`, false, '深夜無車＝環境條件，不是產品回歸'); continue; }
    const { ctx, page } = b;

    // ── E：走使用者的實際操作序（拖曳地圖→自動解鎖→膠囊變寬），不是直接改 class ──
    // 🔴 拖曳起點必須在**露出的地圖**上：§04c 跟隨欄佔掉左緣 [10,230]，0.3×667=200 落在欄內，
    //    按下去點到的是 fpStatus——不但解不了鎖，還會誤開列車 sheet，把後面 L14 的版面整個帶歪
    //    （SE3 那對 L13/L14d 假紅就是這條連鎖）。起點取 max(0.3W, 跟隨欄右緣+40)。
    // v3:跟隨欄右側欄化——露出地圖=[0, 欄左緣),起點取露出帶中心;欄不在(未跟車/收合)或仍在左形
    //    (捷運小卡)時沿用舊式「0.3W 與欄右緣+40 取大」。位置從 rect 判,不問實作。
    const fpBox = await page.evaluate(() => {
      const fp = document.getElementById('followPanel');
      if (!fp || fp.hidden || getComputedStyle(fp).display === 'none') return null;
      const r = fp.getBoundingClientRect();
      return r.width > 2 ? { left: r.left, right: r.right } : null;
    });
    const fpIsRightRail = fpBox && (fpBox.left + fpBox.right) / 2 > S.w / 2;
    const sx = fpIsRightRail
      ? Math.max(100, Math.round(fpBox.left / 2))
      : Math.max(Math.round(S.w * 0.3), Math.round((fpBox ? fpBox.right : 0) + 40));
    await touchDrag(page, eng, sx, Math.round(S.h * 0.5), sx - 80, Math.round(S.h * 0.66));
    await page.waitForTimeout(700);
    // v3(2026-08-27 裁示):解鎖後跟隨欄(右側欄)蓋著工具堆——「可以擋住右上角那些按鈕沒關係」。
    // 使用者要按「回到列車/隨機跟隨」的實際操作序=先點 ×(fpClose)把欄收合成膠囊(跟隨不中斷、
    // 契約4 記憶收合),工具堆露出再按。判準照這個序走;fpClose 不存在/不可見時照舊直量。
    await page.evaluate(() => {
      const x = document.getElementById('fpClose');
      const fp = document.getElementById('followPanel');
      if (x && fp && !fp.hidden && !fp.classList.contains('fp-min')
        && (fp.getBoundingClientRect().left + fp.getBoundingClientRect().right) / 2 > innerWidth / 2) x.click();
    });
    await page.waitForTimeout(400);
    const L = await page.evaluate(LOCK_PROBE);
    // 前置閘門：沒真的解鎖的話，下面的欄內秩序判準是恆真的假綠（心得 17）
    ok(`L13 ${eng}/${S.tag} 前置：拖曳地圖真的解了鎖`, L.unlocked === true && L.label === '回到列車',
      `unlocked=${L.unlocked}／文字=${JSON.stringify(L.label)}／膠囊寬=${L.lockW}`);
    // v5:直欄契約「右緣對齊」→ 列契約「上緣對齊＋單列高＋角落顆=隨機跟隨」
    ok(`L13b ${eng}/${S.tag} 「回到列車」在工具欄內·橫排上緣對齊·單列·角落顆=隨機跟隨·互不相疊`,
      L.inRail === true && L.topAligned === true && L.singleRow === true
      && L.cornerId === 'randBtn' && L.overlaps.length === 0,
      L.overlaps.join(' | ') || `inRail=${L.inRail} topAligned=${L.topAligned} singleRow=${L.singleRow} corner=${L.cornerId} 膠囊 ${L.lockW}×${L.lockH}`);
    ok(`L13c ${eng}/${S.tag} 兩顆都按得到且 ≥44`, L.lockTappable === true && L.randTappable !== false && L.minSize >= 44,
      `回到列車=${L.lockTappable}／隨機跟隨=${L.randTappable}／最小邊=${L.minSize}`);

    // ── F：停靠站名牌的量體 ──
    const D = await page.evaluate(DWELL_PROBE);
    if (D.err) ok(`L14 ${eng}/${S.tag} 前置：跟隨車有停靠窗可量`, false, D.err);
    else {
      ok(`L14 ${eng}/${S.tag} 前置：站名牌真的亮著`, D.show === true, JSON.stringify(D));
      // 判準寫意圖不寫 px（心得 35）：停靠時地圖仍是主角 ⇒ 站名牌不得吃掉露出地圖的一半寬、
      // 也不得吃掉視窗的四分之一高。兩個分母都是當下量到的，不是手打常數。
      ok(`L14b ${eng}/${S.tag} 站名牌不吃掉露出地圖的一半寬`, D.寬佔比 <= 0.5,
        `${D.w}px／露出 ${D.露出地圖寬}px＝${(D.寬佔比 * 100).toFixed(0)}%`);
      ok(`L14c ${eng}/${S.tag} 站名牌不吃掉視窗的四分之一高`, D.高佔比 <= 0.25,
        `${D.h}px／${D.視窗高}px＝${(D.高佔比 * 100).toFixed(0)}%`);
      // 縮小與看得見是**兩個相反方向**的要求，只驗其中一個必然會把另一個做壞（第一版就是）
      ok(`L14d ${eng}/${S.tag} 站名牌沒有被別的可見元件蓋住`, D.被蓋.length === 0, D.被蓋.join('／') || '無遮蔽');
      // 合約11 寫 ±1px；±1.5 = ±1 + 子像素捨入（rect 是浮點、translateX(-50%) 會落半像素）
      ok(`L14e ${eng}/${S.tag} 站名牌中心＝契約8中線`, Math.abs(D.plateCx - D.midX) <= 1.5,
        `牌中心 ${D.plateCx} vs 中線 ${D.midX}`);
      ok(`L14f ${eng}/${S.tag} 速度膠囊共用同一條中線`, D.capCx != null && Math.abs(D.capCx - D.midX) <= 1.5,
        `膠囊中心 ${D.capCx} vs 中線 ${D.midX}`);
    }

    // ── G：動態島。停靠態（站名牌＋小卡＋跟隨鎖都在）先量一次 ──
    await page.evaluate(i => {
      document.documentElement.style.setProperty('--sa-l', i + 'px');
      document.documentElement.style.setProperty('--sa-r', i + 'px');
    }, ISLAND);
    await page.waitForTimeout(400);
    const g1 = await page.evaluate(ISLAND_PROBE, { sels: ISLAND_SEL, inset: ISLAND });
    // 再開一張面板量側欄那一側
    await openPanel(page, PANELS[1]);
    await page.waitForTimeout(500);
    const g2 = await page.evaluate(ISLAND_PROBE, { sels: ISLAND_SEL, inset: ISLAND });
    [...g1.seen, ...g2.seen].forEach(n => seenAll.add(n));
    const bad = [...new Set([...g1.bad, ...g2.bad])];
    ok(`L15 ${eng}/${S.tag} 注入動態島安全區後沒有 UI 進到那兩條帶裡`, bad.length === 0, bad.join('／') || `${g1.seen.length}+${g2.seen.length} 個元件全部讓開了`);

    await ctx.close();
  }
  // 分母要有具名斷言（心得 37d）：清單裡有元件從頭到尾沒被量到＝那條判準的覆蓋是假的
  const never = ISLAND_SEL.map(([n]) => n).filter(n => !seenAll.has(n));
  ok(`L15b ${eng} 動態島清單每一項都真的被量到`, never.length === 0, never.length ? `從沒量到：${never.join('、')}` : `${ISLAND_SEL.length}/${ISLAND_SEL.length}`);
}

// ─────────────────────────────────────────────────────────────
// §04c v2（2026-08-26）新增契約的驗收：觀察模式、字級三階、特大提示卡
// ─────────────────────────────────────────────────────────────
async function landV2Suite(browser, eng) {
  const S = { w: 956, h: 440, tag: '17ProMax橫' };
  // ── ① 觀察模式（＝既有放空模式）：只留頂列 ──────────────────────────
  {
    const b = await boot(browser, S);
    if (!b) ok(`V1 ${eng} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件');
    else {
      const { ctx, page } = b;
      await page.evaluate(() => openBoard(state.schedStations[0]));
      await page.waitForTimeout(600);
      // 進場前／進場後／離場後三個「樣子」都要等家具的 opacity transition(.7s)走完再量:固定 600／700／800 ms
      // 正好卡在轉場中途(V3 膠囊量到 0.47 vs 門檻 0.5、V3d 的 before 量到 0.65 而 out 是 0),機器安靜時險過、
      // 有負載時轉場起步晚一點就假紅。穩態＝連兩拍(150 ms)四項都沒動,上限 3 s。
      const settled = async () => {
        for (let last = null, same = 0, t0 = Date.now(); same < 2 && Date.now() - t0 < 3000;) {
          const now = await page.evaluate(AMBIENT_PROBE);
          same = last && ['topbar', 'tools', 'card', 'capsule'].every(k => Math.abs(now[k] - last[k]) < 0.01) ? same + 1 : 0;
          last = now; await page.waitForTimeout(150);
        }
        return page.evaluate(AMBIENT_PROBE);
      };
      const before = await settled();
      await page.evaluate(() => setAmbient(true));
      await page.waitForTimeout(700);
      const after = await settled();
      // 正向對照先確認「進模式前這些東西本來看得見」——少了這半，元件本來就不在也會全綠
      ok(`V1 ${eng} 前置·進觀察模式前頂列與 HUD 都看得見`,
        before.topbar > 0.9 && before.tools > 0.9 && before.card > 0.9, JSON.stringify(before));
      // 設計 17f：頂列留著（「現在幾點、幾班在跑」），其餘淡到 0、DOM 保留
      ok(`V1 ${eng} 觀察模式·頂列留著且仍可互動`,
        after.topbar > 0.9 && after.topbarDisplay !== 'none' && after.topbarHit === true, JSON.stringify(after));
      ok(`V2 ${eng} 觀察模式·工具堆與合併卡淡到 0 但 DOM 還在`,
        after.tools <= 0.05 && after.card <= 0.05 && after.toolsInDom && after.cardInDom, JSON.stringify(after));
      // 🔴 使用者裁示（2026-08-26）：速度膠囊**不淡出**——離開放空模式的鈕就在裡面，
      //    設計靠「點畫面任一處復原」把它叫回來，本專案沒有那套狀態機，全淡＝把人關在裡面。
      ok(`V3 ${eng} 觀察模式·膠囊留著當出口(離開鈕點得到)`,
        after.capsule > 0.5 && after.exitHit === true, JSON.stringify(after));
      // 🔴 出口的「明顯」要拆成兩件各自驗:看得懂(字寫著「離開」)＋按下去真的出得來。
      //    命中測試只答「這個點打到誰」,答不了「按了會發生什麼」(心得 37a),而一顆還寫著
      //    入口字樣的鈕就算點得到,使用者也不會知道那是出口。
      const label = await page.evaluate(() =>
        (document.getElementById('ambientBtn').textContent || '').trim());
      ok(`V3b ${eng} 觀察模式·出口的字改成「離開放空」(不是還留著入口的字)`,
        /離開/.test(label) && !/^放空模式$/.test(label), label);
      const exitBox = await page.evaluate(() => {
        const r = document.getElementById('ambientBtn').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.click(exitBox.x, exitBox.y);
      await page.waitForTimeout(800);
      const out = await settled();
      const outState = await page.evaluate(() => ({
        cls: document.body.classList.contains('ambient'),
        st: !!state.ambient,
        label: (document.getElementById('ambientBtn').textContent || '').trim(),
      }));
      // 真的按下去 ⇒ 狀態與字都要回去,不能只是視覺變回來(反之亦然)
      ok(`V3c ${eng} 觀察模式·真的按出口就離開(class／state／字三者一致回復)`,
        outState.cls === false && outState.st === false && /放空模式/.test(outState.label),
        JSON.stringify(outState));
      // 進出是一趟往返:淡掉的東西要回得來。只驗「進去有淡出」等於沒驗出口
      //(cross-runtime 那條教訓的同族:true 推得出、推不回)。
      // 🔴 判準是「回到進場前那個樣子」,不是「每一項都 >0.9」:看板開著時膠囊本來就該讓位到 0
      //    (body.sheet-open .controls{opacity:0}),寫死門檻會把正確行為判成紅(第一版就是這樣紅的)。
      const RT = ['topbar', 'tools', 'card', 'capsule'];
      const drift = RT.filter(k => Math.abs(out[k] - before[k]) > 0.05);
      ok(`V3d ${eng} 觀察模式·離開後每一項都回到進場前的樣子(往返還原)`,
        drift.length === 0 && out.toolsInDom && out.cardInDom,
        drift.length ? `沒回來:${drift.map(k => `${k} ${before[k]}→${out[k]}`).join('、')}`
          : RT.map(k => `${k}=${out[k]}`).join(' '));
      await ctx.close();
    }
  }
  // ── ② 字級三階：卡裡不出現被自己框切掉的文字 ────────────────────────
  for (const fs of ['std', 'large', 'xlarge']) {
    const b = await boot(browser, S, { fontScale: fs === 'std' ? null : fs });
    if (!b) { ok(`V4 ${eng}/${fs} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件'); continue; }
    const { ctx, page } = b;
    await page.evaluate(() => openBoard(state.schedStations[0]));
    await page.waitForTimeout(800);
    const clip = await page.evaluate(() => {
      const bd = document.getElementById('board');
      if (!bd || bd.hidden) return { err: 'no-board' };
      const cs0 = getComputedStyle(bd);
      const cb = bd.getBoundingClientRect();
      const clipL = cb.left + (parseFloat(cs0.borderLeftWidth) || 0);
      const clipR = cb.right - (parseFloat(cs0.borderRightWidth) || 0);
      const vis = e => { const cs = getComputedStyle(e);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && e.getClientRects().length; };
      const all = [...bd.querySelectorAll('*')].filter(e => vis(e) && e.textContent.trim());
      // ── 模式 A:元件自己的框把自己的字切掉(scrollWidth 溢出)──────────────────
      // 🔴 有絕對定位偽元素的元件要排除:44px 觸控熱區(.rmore::after)是 content:'' 的透明方塊,
      //    它會計進 scrollWidth(28→36) 但一個字都沒被切 ⇒ 不排除的話這條判準恆紅在裝飾上。
      const modeA = all.filter(e => {
        // 只看**葉子**(沒有帶字的元素小孩):容器的 scrollWidth 會把整個子樹的絕對定位溢出算進來,
        // 實測 .row 316>308 全部來自孫層 .rmore::after 那個 44px 透明熱區,一個字都沒被切。
        if ([...e.children].some(c => c.textContent.trim())) return false;
        const cs = getComputedStyle(e);
        if (cs.textOverflow === 'ellipsis') return false;            // 省略號是刻意的收斂,不算裁切
        if (cs.overflowX !== 'visible' && cs.overflowX !== 'clip') return false; // 自己會捲的容器不算
        for (const q of ['::before', '::after']) {
          const ps = getComputedStyle(e, q);
          if (ps.content !== 'none' && ps.position === 'absolute') return false; // 透明觸控熱區同理
        }
        if ([...e.children].some(c => getComputedStyle(c).position === 'absolute')) return false;
        return e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2;
      }).map(e => 'A:' + (e.className || e.tagName) + ` ${e.scrollWidth}>${e.clientWidth}`);
      // ── 模式 B:字在卡的裁切線外(卡橫向不捲 ⇒ 這一段使用者永遠看不到)────────────
      //    只看有文字的葉子,避免把「容器很寬但字在裡面」算成裁切。
      const modeB = all.filter(e => {
        if ([...e.children].some(c => c.textContent.trim())) return false;
        const r = e.getBoundingClientRect();
        return r.right > clipR + 1 || r.left < clipL - 1;
      }).map(e => 'B:' + (e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().right) + '>' + Math.round(clipR));
      const bad = [...modeA, ...modeB];
      return { bad: bad.slice(0, 6), n: bad.length, scanned: all.length,
        fs: document.documentElement.getAttribute('data-fs') || 'std' };
    });
    ok(`V4 ${eng}/${fs} 合併卡裡沒有被自己的框切掉的文字`, !clip.err && clip.n === 0,
      clip.err || (clip.bad.join('／') || `逐一掃過 ${clip.scanned} 個有字的元件（data-fs=${clip.fs}）`));
    // 特大階要出提示卡；標準與大不得出現（反向對照）
    const hint = await page.evaluate(() => {
      const el = document.getElementById('landFsHint');
      return { exists: !!el, shown: !!el && !el.hidden && el.getClientRects().length > 0,
        fs: document.documentElement.getAttribute('data-fs') || 'std' };
    });
    ok(`V5 ${eng}/${fs} 特大提示卡只在特大階出現（${fs === 'xlarge' ? '要出' : '不可出'}）`,
      hint.exists && hint.shown === (fs === 'xlarge'), JSON.stringify(hint));
    if (fs === 'xlarge') {
      const dismissed = await page.evaluate(async () => {
        document.getElementById('landFsHintOk').click();
        await new Promise(r => setTimeout(r, 200));
        const el = document.getElementById('landFsHint');
        return { hidden: el.hidden, ls: localStorage.getItem('trainmap-land-xl-hint') };
      });
      ok(`V6 ${eng} 特大提示卡·按「知道了」收掉並記住`,
        dismissed.hidden === true && dismissed.ls === '1', JSON.stringify(dismissed));
    }
    await ctx.close();
  }
}
const AMBIENT_PROBE = () => {
  const eff = n => { if (!n) return 0; let o = 1;
    for (let e = n; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none') return 0;
      o *= parseFloat(cs.opacity) || 0;
    } return o; };
  const tb = document.getElementById('topbar'), tools = document.getElementById('mapActions');
  const bd = document.getElementById('board'), cap = document.querySelector('.controls');
  const exit = document.getElementById('ambientBtn');
  let exitHit = false;
  if (exit && exit.getClientRects().length) {
    const r = exit.getBoundingClientRect();
    const q = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    exitHit = !!(q && (q === exit || exit.contains(q)));
  }
  // 🔴 頂列本體的 pointer-events 恆為 none(它是整條橫帶,不能吃掉底下地圖的拖曳),
  //    可互動性住在它的**子元件**上 ⇒ 判「還能不能點」要對子元件做命中測試,不是讀容器的 PE。
  let topbarHit = null;
  const kid = tb && [...tb.querySelectorAll('button, .tb-tab, .tb-plate, #clockBadge')]
    .find(e => e.getClientRects().length && getComputedStyle(e).pointerEvents !== 'none');
  if (kid) {
    const r = kid.getBoundingClientRect();
    const q = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    topbarHit = !!(q && (q === kid || kid.contains(q) || (q.contains && q.contains(kid))));
  }
  return {
    topbar: +eff(tb).toFixed(2), topbarPE: tb ? getComputedStyle(tb).pointerEvents : null,
    topbarKid: kid ? (kid.id || kid.className) : null, topbarHit,
    topbarDisplay: tb ? getComputedStyle(tb).display : null,
    tools: +eff(tools).toFixed(2), toolsInDom: !!(tools && tools.isConnected),
    card: +eff(bd && !bd.hidden ? bd : null).toFixed(2), cardInDom: !!(bd && bd.isConnected),
    capsule: +eff(cap).toFixed(2), exitHit,
  };
};

// G3：原始碼斷言——四邊安全區必須優先讀 Capacitor Android fallback，再退回標準 env()。
// 只有 L15 的話，把 --sa-l 寫成常數 0px 也會全綠（注入時被測試自己覆寫掉），實機上完全沒作用。
{
  const src = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const edges = [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']];
  const safeArea = Object.fromEntries(edges.map(([short, edge]) => [short,
    new RegExp(`--sa-${short}:\\s*var\\(--safe-area-inset-${edge},\\s*env\\(safe-area-inset-${edge},\\s*0px\\)\\)`).test(src)]));
  ok('L15c 原始碼：四邊安全區由 Capacitor fallback → env() 定義', Object.values(safeArea).every(Boolean),
    JSON.stringify(safeArea));
  // L13d：工具欄讓位「以右緣起算常數 44」的契約（回到列車膠囊是暫態，不推相機）。
  // 行為面照不到：膠囊只在解鎖態出現，而解鎖態相機本來就不動；能觀測到差異的只有「解鎖瞬間
  // 一幀的抽動」，非同步渲染下量不穩。比照 L15c 用原始碼斷言把守這一格（模擬式判準的盲區）。
  const const44 = /mc\.right - r\.right \+ 44 \+ 8/.test(src);
  ok('L13d 原始碼：computeMapInsets 的工具欄讓位以右緣＋常數 44 計', const44, `pattern=${const44}`);
}

// ─────────────────────────────────────────────────────────────
// L6／L7：iPad 橫向與桌面「對改動前逐值零變化」
// 心得 31：比幾何前把即時狀態旗標釘死（班次數文字、LIVE 徽章、尖峰徽章都會改寬度）
// ─────────────────────────────────────────────────────────────
const FREEZE = () => {
  // 先綁空 syncTimeUI 再釘值——否則下一幀 tick 就把 #clock 改回即時值(釘了等於沒釘)。
  // iPad直 的時鐘住在寬度 auto 的 .controls,分鐘數字比例寬('1'比'4'窄)⇒兩頁渲染差幾秒
  // 就差 3px 假紅(0812 solo 輪 122→119 歸因至此;頂列版時鐘定寬所以從沒炸過)。
  try { window.syncTimeUI = () => {}; } catch (e) {}
  const c = document.getElementById('clock'); if (c) c.textContent = '00:00';
  for (const id of ['liveBadge', 'peak', 'replayBadge', 'metroBadge']) {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  }
  const n = document.querySelector('.badge .n'); if (n) n.textContent = '000';
  // 版權列文字隨圖磚 attribution 載入時序變(內容變⇒寬變⇒右錨佈局 x 跟著變):兩頁各自載入
  // 讀到不同瞬間=假紅(0827 兩輪紅的視口/引擎都不同、且互不重疊)。兩頁對稱釘同一字串後才可比。
  const at = document.querySelector('.leaflet-control-attribution'); if (at) at.textContent = 'ATTR';
};
const GEOM = eng => {
  const out = {};
  const sels = ['header', '.stage', '.controls', '.tabbar', '#followPanel', '#trainCard',
    '.plate', '#lead', '.grouptabs', '#explorePanel', '#board'];
  // 對照 commit 早於 MapLibre、即使 query 帶 engine=maplibre 仍只會建立 Leaflet 家具。
  // L6/L7 要守的是共用 HUD 零回歸；Leaflet 自己仍額外逐值守右下 attribution 容器，
  // MapLibre 不拿「舊頁有 Leaflet 容器、新頁沒有」這個預期引擎差異冒充產品回歸。
  if (eng === 'leaflet') sels.push('.leaflet-bottom.leaflet-right');
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    // 版權列容器的 x/寬=attribution 動態文字寬(FREEZE 釘完 Leaflet 的 layer 事件仍會重寫,
    // 兩頁時序不可控——0827 三輪紅的引擎×視口互不重疊、方向還互換)。右下錨的版面事實=
    // y/高/position/display,只比這四樣;「推出視窗」類回歸由 L2 浮層不出視窗涵蓋。
    if (sel === '.leaflet-bottom.leaflet-right') out[sel] = [0, Math.round(r.y), 0, Math.round(r.height), cs.position, cs.display];
    else out[sel] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), cs.position, cs.display];
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
    const a = await cur.page.evaluate(GEOM, eng);
    await cur.ctx.close();
    const bas = await boot(browser, S, { url: BASE + 'baseline.html', follow: false });
    await bas.page.evaluate(FREEZE);
    const c = await bas.page.evaluate(GEOM, eng);
    await bas.ctx.close();
    const diff = [];
    for (const k of Object.keys(c)) if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) diff.push(`${k}: ${JSON.stringify(c[k])} → ${JSON.stringify(a[k])}`);
    ok(`L6/L7 ${eng}/${S.tag} 對 ${BASE_REF} 逐值零變化`, diff.length === 0, diff.join(' | '));
  }
}

// ─────────────────────────────────────────────────────────────
// P4：§04c-P 直式相機矩陣——小卡態／46% sheet 兩態的露出中心＋前瞻。
// 設計回包行為契約 1：「四個方向都要讓位——直式跟隨小卡態的位移是往右上，不是只往上」。
// __exposed 判準側自帶同一條閘門規則（契約常數），所以這裡問的是「實作真的照閘門行為」——
// 實作若半讓位，err0 直接爆表；若閘門值改了，兩邊常數對不上也會紅。
//
// 🔴 2026-08-26：原本第三態「88% sheet·走 64px 最小露出閘門（垂直軸整個放棄）」隨大段退役而移除
//    ——兩段制最高 46%，直向再也做不出「露出帶低於 MIN_MAP_STRIP」的情境，留著只會是一條
//    前置閘門恆紅（或更糟：把 46% 量成 88% 而恆綠）的假判準。閘門常數本身仍由橫式側欄那幾組
//    覆蓋（露出帶在水平軸上被壓窄）；若日後新增全螢幕態，這一格要跟著補回來。
// ─────────────────────────────────────────────────────────────
async function portraitCameraSuite(browser, eng) {
  const S = { w: 393, h: 852, tag: '16直' };
  for (const [sz, states] of [[null, ['card', 'mid']]]) {
    const b = await boot(browser, S, sz ? { sheetSize: sz } : {});
    if (!b) { ok(`P4 ${eng}/${sz || 'medium'} 取得行駛中列車`, false, '深夜無台鐵車＝環境條件'); continue; }
    const { ctx, page } = b;
    await page.evaluate(() => { state._autoPan = true; window.__M.setView(window.__M.getCenter(), 11, { animate: false }); state._autoPan = false; });
    await page.waitForTimeout(800);
    for (const st of states) {
      if (st !== 'card') {
        await openPanel(page, PANELS[0]);
        await page.waitForTimeout(800);
      }
      const cam = await page.evaluate(() => window.__aheadExpect());
      aheadCount(cam);
      if (st === 'card') {
        ok(`P4 ${eng} 小卡態·左界=小卡右緣(相機往右上讓)`,
          !cam.err && cam.ex.left >= 150 && cam.ex.cx > S.w / 2 + 20, JSON.stringify(cam.ex));
        ok(`P4 ${eng} 小卡態·列車在露出中心＋前瞻`, aheadPass(cam),
          JSON.stringify({ err0: cam.err0, dist: cam.dist, m: cam.m, ex: cam.ex }));
      } else if (st === 'mid') {
        // 出貨行為:46% 態小卡被 placeFsOverlays 抬到 sheet 上方,**仍可見** ⇒ 行為契約 2
        // (可見 HUD 一律實測計入)優先於 mock 畫面裡的「sheet 態沒畫小卡」——左界維持小卡右緣。
        const lifted = await page.evaluate(() => {
          const fp = document.getElementById('followPanel'), sh2 = activeSheetEl();
          if (!fp || fp.hidden || !sh2) return { err: 'missing' };
          return { fpBottom: Math.round(fp.getBoundingClientRect().bottom), sheetTop: Math.round(sh2.getBoundingClientRect().top) };
        });
        ok(`P4 ${eng} 46%sheet·小卡抬到 sheet 上方仍可見`,
          !lifted.err && lifted.fpBottom <= lifted.sheetTop + 2, JSON.stringify(lifted));
        ok(`P4 ${eng} 46%sheet·左界=小卡右緣、下界=sheet 頂`,
          !cam.err && cam.ex.left >= 150 && cam.ex.bottom > S.h * 0.35, JSON.stringify(cam.ex));
        ok(`P4 ${eng} 46%sheet·列車在露出中心＋前瞻`, aheadPass(cam),
          JSON.stringify({ err0: cam.err0, dist: cam.dist, m: cam.m, ex: cam.ex }));
      }
    }
    await ctx.close();
  }
}

// QUICK=1：突變測試用的縮減版（單引擎、兩個橫向尺寸）。突變測試要跑很多輪，
// 全套一輪約五分鐘會讓人偷懶不做——但縮減版**不可**用來下「全綠」的結論。
const QUICK = process.env.QUICK === '1';
if (QUICK) { LANDSCAPE.splice(0, LANDSCAPE.length, { w: 852, h: 393, tag: '16橫' }, { w: 932, h: 430, tag: '16ProMax橫' }); }
const matrix = await runEngineMatrix(async ({ engineUrl, check }) => {
  activeEngineUrl = engineUrl;
  activeCheck = check;
  results.length = 0;
  errors.length = 0;
  aheadBranch.moving = 0;
  aheadBranch.dwell = 0;
for (const [eng, B] of (QUICK ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
  const browser = await B.launch();
  await landscapeSuite(browser, eng);
  await fix0812Suite(browser, eng); // QUICK 也跑:0812 實機退回三修(更多撞島/字級膨脹/相機自癒)
  await sizeGuardSuite(browser, eng); // QUICK 也跑:0813 旋轉版面延遲→尺寸過期自癒(F5/F5b)
  await rotationSuite(browser, eng); // QUICK 也跑：這組是獨立驗收抓到的真缺陷，突變測試一定要涵蓋
  await centeringSuite(browser, eng); // QUICK 也跑：使用者親自指出的置中缺陷
  await stickySuite(browser, eng);   // QUICK 也跑:natTop 機制(L4i 的守門人,深夜無車也跑得動)
  await deviceSuite(browser, eng);    // QUICK 也跑：使用者橫放實機回報的三缺陷
  await portraitCameraSuite(browser, eng); // QUICK 也跑：§04c-P 直式相機矩陣（m1/m6 這族突變的靶）
  await landV2Suite(browser, eng);         // QUICK 也跑：§04c v2 的三條新契約（觀察模式／字級三階／提示卡）
  if (!QUICK) { await portraitSuite(browser, eng); await zeroRegressionSuite(browser, eng); }
  await browser.close();
}
// 相機判準的分支分佈（心得 37d）：dwell 弱判只驗「距中心 ≈ 幅度」不驗方向，
// 樣本若多數滑進弱判，「前瞻方向對不對」整個維度等於沒驗——具名把關，不能只印在 detail。
ok('L9 相機判準分支分佈：行進中強判佔多數', aheadBranch.moving >= (aheadBranch.moving + aheadBranch.dwell) * 0.5,
  `moving=${aheadBranch.moving}／dwell=${aheadBranch.dwell}`);
check(errors.length === 0, '全情境零 pageerror/console.error', errors.slice(0, 10).join(' | '));
});
server.close();

const passed = matrix.passed && preflightFailures.length === 0;
const failureCount = matrix.failures.length + preflightFailures.length;
console.log(passed ? '\n全部通過' : `\n${failureCount} 項未過`);
process.exit(passed ? 0 : 1);
