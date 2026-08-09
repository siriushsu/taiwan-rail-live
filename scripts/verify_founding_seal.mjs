// 創始會員徽章驗證(Task 4)——Playwright 真引擎 + 本機靜態伺服器。
// 背景:徽章＝state.plus.founding,由 foundingFrom(info) 依訂閱起始時刻判定,渲染進
//   buildFoundingSeal() → renderPassport() 的 stamps 組裝行最前面。
//
// 本腳本涵蓋 brief Step 5(三態+純函式)、Step 6(手機四寬度)、Step 4 暗色對比,
// 並依協調者的追加要求把「只驗 .ph-founding 自己」擴大為「驗對整個護照的效果」:
//   1. 桌面(#passport,真正被 patch 的容器)三態 + 全部可見後代逐一量測(溢出/裁切)
//      + 對照組(founding:true vs founding:false)比對「除了徽章自己的高度位移外,
//      其他元素不應該有非預期位移或新遮蔽」。
//   2. 手機四寬度(360/375/414/768)的「可及性稽核」——不是假設 .ph-founding 會出現在
//      手機上再驗它溢出與否,而是先驗它到底出不出現在使用者真正看得到的地方
//      (見下方「重大發現」)。
//
// ── 第二輪(裁示後修復)──renderRidePanel()/#ridePanel 已接上 buildFoundingSeal(),
// Group 2 改為真路徑驗證:真的點 #rideBtn 開面板(不是呼叫 renderRidePanel() 繞過
// `if (el.hidden) return;` 早退),斷言 .ph-founding 存在 + 命中測試 + 像素非底色
// (elementHandle.screenshot() 解碼,免原生 PNG 依賴,技法照抄
// verify_translucent_contrast.mjs 已驗證過的做法);每條新斷言配一發瞄準它的突變
// (founding:false 控制組必須翻紅、外加一發驗「像素檢查本身有沒有牙」的自檢)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// M-6:第一道 gate 印出驗的是哪棵樹(本專案多 worktree 並行常態,踩過驗錯樹的虧;ROOT 由
// 本檔自身路徑推導,結構上不會誤驗別的 worktree,這行是便宜的可稽核紀錄,不是唯一防線)。
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);
// 埠位改成可用 PORT env 覆寫(比照 verify_sat_retina / verify_plus_refresh_lifecycle /
// verify_account_sync_race):這台機器 30+ worktree 並行,2026-08-04 實測 5417 被另一棵樹的常駐
// static server 佔住,寫死埠位會讓這支腳本在別人開著 server 時完全跑不起來。
const PORT = Number(process.env.PORT || 5417);
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
const BASE = `http://localhost:${PORT}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
// 純資訊、不計入分母:量得出來但沒有「有牙的判準」可寫的數字(例如兩個幾乎同亮度的填色,
// 分層其實靠 1px 邊框而不是填色對比)。刻意不用 ok(..., true) 充數——恆真的 PASS 會讓
// 「N/N」這個數字虛胖,而且會讓人以為那個維度已經有閘門守著。
const info = (name, detail) => { console.log(`INFO ${name}${detail ? ' — ' + detail : ''}`); };

// 測試用固定「上線錨點」:動態取「今天的台北午夜整點」,不寫死字面值——這裡只需要一個
// FOUNDING_UNTIL_MS 算得出來的有效輸入,日期本身無意義,但寫死字面值遲早變成過去式
// (跟本任務要修的「猜的日期會過期」是同一個坑,連測試 fixture 都不該再犯)。
// 2026-08-03 起 FOUNDING_UNTIL_MS 已從 index.html 寫死的日期改成讀 revenuecat-config.js 的
// foundingLaunchAt(見該檔與 index.html foundingFrom() 旁的說明);正式站現在(且應該)是
// foundingLaunchAt:null(上線日未定,發版時才填)。
const TEST_FOUNDING_LAUNCH_AT = `${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date())}T00:00:00+08:00`;

async function boot(browser, { width = 1280, height = 900, touch = false, theme = 'light', query = '', foundingLaunchAt = TEST_FOUNDING_LAUNCH_AT } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((th) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    try { localStorage.setItem('trainmap-appearance', th); } catch (e) {}
  }, theme);
  // 在頁面自己的 <script src="revenuecat-config.js">(其 `window.X = window.X || {...}`)執行前
  // (addInitScript 保證先於頁面任何 <script>)注入 window.RAIL_REVENUECAT_CONFIG,讓後者因為
  // 已存在而短路——測試值才會生效,且與正式站 revenuecat-config.js 現在的真實內容脫鉤(Group 7
  // 測的正是「這個欄位是 null」那個安全預設,不依賴/不斷言正式站現在真的填了什麼)。
  // foundingLaunchAt 傳 null ⇒ 注入物件裡這個欄位也是 null,模擬「尚未設定」(Group 7 專用)。
  await ctx.addInitScript((launchAt) => {
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus', foundingLaunchAt: launchAt };
  }, foundingLaunchAt);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console:' + m.text()); });
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.mode === 'sched'; } catch (e) { return false; } }, null, { timeout: 30000 });
  return { ctx, page, errors };
}

// 確保整個文件都在視窗內(避免 elementFromPoint 因為捲動而落空,不靠猜測固定高度)
async function fitViewport(page) {
  const need = await page.evaluate(() => document.documentElement.scrollHeight);
  const vp = page.viewportSize();
  if (need > vp.height) await page.setViewportSize({ width: vp.width, height: Math.min(need + 60, 8000) });
}

// 在頁面內收集「可見後代」+ 對每個有文字的做多點 elementFromPoint 命中測試(角落內縮,抓局部遮蔽)
const COLLECT_SRC = `
function __rlVisibleDescendants(rootSel) {
  const root = document.querySelector(rootSel);
  if (!root) return [];
  const all = Array.from(root.querySelectorAll('*'));
  const out = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rects = Array.from(el.getClientRects());
    if (!rects.length) continue;
    const hasArea = rects.some(r => r.width > 0.5 && r.height > 0.5);
    if (!hasArea) continue;
    out.push(el);
  }
  return out;
}
function __rlSig(el, root) {
  const cls = (el.className && typeof el.className === 'string') ? el.className.trim() : '';
  const ds = ['sec','cat','id','v'].map(k => el.dataset && el.dataset[k] ? k+'='+el.dataset[k] : '').filter(Boolean).join(',');
  const ownText = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').slice(0, 14);
  let path = []; let n = el;
  while (n && n !== root) { path.unshift(n.tagName); n = n.parentElement; }
  return el.tagName + '.' + cls + (ds ? '[' + ds + ']' : '') + '|' + ownText + '|' + path.length;
}
function __rlSamplePoints(rect, inset, round) {
  const pts = [[rect.left + rect.width/2, rect.top + rect.height/2]];
  // 圓形/膠囊(border-radius 相對邊長很大,如 .pf-mark 的 999px 圖示圓):box 幾何角落本來就
  // 屬於父層背景,不是缺陷——只驗中心點,不做角落取樣(角落取樣是為了抓矩形文字被局部遮蔽,
  // 對圓形圖示沒有意義,硬做只會製造測試自己的假陽性)。
  if (round) return pts;
  const ix = Math.min(inset, rect.width / 3), iy = Math.min(inset, rect.height / 3);
  if (rect.width > 1 && rect.height > 1) {
    pts.push([rect.left + ix, rect.top + iy], [rect.right - ix, rect.top + iy],
              [rect.left + ix, rect.bottom - iy], [rect.right - ix, rect.bottom - iy]);
  }
  return pts;
}
function __rlHitTest(rootSel, opts) {
  const scrollFirst = !!(opts && opts.scrollIntoView); // 選擇性:見下方說明,預設不開,不動桌面既有行為
  const root = document.querySelector(rootSel);
  const rootRect = root.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const els = __rlVisibleDescendants(rootSel);
  const report = [];
  for (const el of els) {
    // 手機 sheet(#ridePanel 這類 overflow-y:auto、高度封頂的底部面板)裡,getBoundingClientRect
    // 量到的座標對「捲動位置沒對到那裡」的元素來說,數學上正確但畫面上當下是別的東西(固定
    // 的 tabbar、底圖)——沒先捲進可視窗就做 elementFromPoint,會把「使用者要捲一下才碰得到」
    // 誤判成「碰不到」。只在 opts.scrollIntoView 開啟時做(桌面 #passport 是一般文件流+
    // fitViewport 已經讓全部內容進視窗,不需要也不應該多這道)。
    if (scrollFirst) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    const ownText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    const inFounding = !!el.closest('.ph-founding');
    // .ph-body 本身的頂邊不會因為第一個子元素(徽章)被插入而移動——只有它「內部」的子孫
    // (排除它自己)才會被徽章往下推。closest() 對自己也會命中,故要排除 el===bodyAnc。
    const bodyAnc = el.closest('.ph-body');
    const bodyDescendant = !!bodyAnc && bodyAnc !== el;
    const csEl = getComputedStyle(el);
    // 取四角最大值,不是只看 top-left——非對稱圓角(如 .board h3 的 13px 13px 0 0)只讀
    // top-left 剛好會讀到有值的那個,但换個角就會漏,乾脆四角都讀取最大的。
    const radiusPx = Math.max(0, ...['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(k => parseFloat(csEl[k]) || 0));
    const isRound = radiusPx >= Math.min(rect.width, rect.height) * 0.35 && rect.width < 60 && rect.height < 60;
    const overflowH = rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1;
    let hitFails = [];
    if (ownText) {
      const rects = Array.from(el.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
      // 角落取樣的內縮量至少要蓋過這個元素自己的圓角半徑,不然「角落」樣本點其實落在被圓角切掉
      // 的區域裡,elementFromPoint 命中的是圓角背後的東西,是取樣點幾何算錯,不是真的遮蔽
      // (踩過一次:.board h3 的 13px 圓角讓固定 3px 內縮的角落點命中到 #ridePanel 本身)。
      const cornerInset = Math.max(3, radiusPx + 1);
      for (const r of rects) {
        for (const [x, y] of __rlSamplePoints(r, cornerInset, isRound)) {
          if (x < 0 || y < 0 || x > vw || y > vh) { hitFails.push('offscreen@' + Math.round(x) + ',' + Math.round(y)); continue; }
          const hit = document.elementFromPoint(x, y);
          const okHit = hit && (hit === el || el.contains(hit));
          if (!okHit) hitFails.push((Math.round(x)) + ',' + Math.round(y) + '=>' + (hit ? (hit.id ? '#'+hit.id : hit.tagName+'.'+String(hit.className).slice(0,30)) : 'null'));
        }
      }
    }
    report.push({
      sig: __rlSig(el, root),
      rect: [rect.left, rect.top, rect.right, rect.bottom].map(v => Math.round(v * 10) / 10),
      overflowH, hitFails, ownText, inFounding, bodyDescendant, isRound,
      position: csEl.position, // 給「窮舉定位元素兩兩相交」用(不手挑名單,見協調者 tripBanner 教訓)
    });
  }
  return { rootRect: [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].map(v => Math.round(v*10)/10), report };
}
window.__rlHitTest = __rlHitTest;
`;

async function injectCollector(page) { await page.addScriptTag({ content: COLLECT_SRC }); }

// 「非底色」像素檢查:computed style(opacity/visibility/display)照不到「DOM 都對、但視覺上
// 跟背景無法分辨」這種情況(見協調者要求＋本專案既有教訓 panel-translucent-contract)。
// 技法照抄 verify_translucent_contrast.mjs 已驗證過的做法(免原生 PNG 依賴):Playwright
// 對元素截圖 → base64 丟進頁面內用 <canvas> decode → getImageData 讀真實渲染像素。
// 回傳「16 階粗量化後的相異色數」與「亮度全距」——兩者都低代表這塊區域視覺上是一片死色,
// 不是真的有內容畫出來(即使 DOM 存在、rect 正確、elementFromPoint 也命中)。
async function pixelStats(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  const buf = await el.screenshot();
  const b64 = buf.toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    const seen = new Set();
    let minL = 255, maxL = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < minL) minL = lum; if (lum > maxL) maxL = lum;
      seen.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
    }
    return { distinctColors: seen.size, lumRange: Math.round((maxL - minL) * 10) / 10, w: cv.width, h: cv.height };
  }, b64);
}

const results_dir = path.join(ROOT, 'scratchpad'); // repo 的 scratchpad/ 已在 .gitignore,產物不進版控

// ═══════════════ Group 0:foundingFrom() 純函式測試 ═══════════════
{
  const cr = await chromium.launch();
  const { ctx, page, errors } = await boot(cr);
  const untilMs = await page.evaluate(() => { try { return FOUNDING_UNTIL_MS; } catch (e) { return null; } });
  // G0.0 舊版把資格截止日的字面值又抄了一份進這個公開的測試檔,而且出貨前依實際開賣日校正
  // index.html 的常數時,它會為了正確的理由轉紅。改成不重寫那個日期的兩件事:
  //   (a) 結構(這一條):常數解析得出來,而且落在台北時間的午夜整點——「是個能當日界用的時點」
  //       這件事本身可驗,不必知道是哪一天;
  //   (b) 行為:邊界兩側各測一次,由下面 G0.1(前一天→true)／G0.2(後一天→false)／G0.7(邊界本身
  //       嚴格小於)負責,它們的輸入全部由現讀的 untilMs 推導,常數改成任何日期都仍然成立。
  // ⚠️ 刻意不寫成「從頁面讀出來再跟自己比」:那種斷言的資訊量是零(判準落在受測物的下游)。
  const tpeParts = Number.isFinite(untilMs)
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(untilMs))
    : '(不是有限數字)';
  ok('G0.0 FOUNDING_UNTIL_MS 解析得出來,且落在台北時間的午夜整點(不重寫日期字面值)',
    Number.isFinite(untilMs) && tpeParts === '00:00:00' && untilMs % 1000 === 0,
    `讀到=${untilMs} 台北時刻=${tpeParts} 毫秒餘=${Number.isFinite(untilMs) ? untilMs % 1000 : 'n/a'}`);

  const r = await page.evaluate((until) => {
    const info = t => ({ entitlements: { active: { plus: { originalPurchaseDate: t } } } });
    const infoLatest = t => ({ entitlements: { active: { plus: { latestPurchaseDate: t } } } });
    const dayBefore = new Date(until - 86400000).toISOString();
    const dayAfter = new Date(until + 86400000).toISOString();
    return {
      before: foundingFrom(info(dayBefore)),
      after: foundingFrom(info(dayAfter)),
      undef: foundingFrom(undefined),
      noEntitlement: foundingFrom({ entitlements: { active: {} } }),
      latestFallback: foundingFrom(infoLatest(dayBefore)),
      malformed: foundingFrom('not an object'),
      exactBoundary: foundingFrom(info(new Date(until).toISOString())), // 邊界本身(< 而非 <=)→ 應為 false
    };
  }, untilMs);
  ok('G0.1 截止日前一天 → true', r.before === true, JSON.stringify(r));
  ok('G0.2 截止日後一天 → false', r.after === false, JSON.stringify(r));
  ok('G0.3 undefined → false(不丟例外)', r.undef === false, JSON.stringify(r));
  ok('G0.4 entitlement 不存在 → false', r.noEntitlement === false, JSON.stringify(r));
  ok('G0.5 只有 latestPurchaseDate(無 originalPurchaseDate)→ 仍可判定 true', r.latestFallback === true, JSON.stringify(r));
  ok('G0.6 傳入非物件(字串)→ false(catch 生效,不丟例外)', r.malformed === false, JSON.stringify(r));
  ok('G0.7 邊界本身(=截止時刻)→ false(嚴格小於)', r.exactBoundary === false, JSON.stringify(r));
  ok('G0 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close(); await cr.close();
}

// ═══════════════ Group 1:桌面 #passport 三態 + 對照組(founding:true vs false) ═══════════════
{
  const cr = await chromium.launch();
  // 固定夠高的視窗(2200px,實測整頁含護照約 1700px 以內),讓 s1/s2/s3 三次量測全程視窗尺寸
  // 相同、零捲動——對照組要逐 px 比較座標,視窗尺寸或捲動位置在三次量測之間變動就會污染 dy/dx。
  const { ctx, page, errors } = await boot(cr, { width: 1280, height: 2200 });
  await injectCollector(page);
  // 展開護照(預設收合,.ph-body 才會顯示)
  await page.evaluate(() => { try { localStorage.setItem('trainmap-passport-open', '1'); } catch (e) {} });

  async function renderState(plusState) {
    await page.evaluate((p) => { state.plus = p; renderPassport(); window.scrollTo(0, 0); }, plusState);
    await fitViewport(page); // 安全網:若某天內容遠超 2200px,補高,但正常情況下不觸發、視窗維持不變
    return page.evaluate(() => window.__rlHitTest('#passport'));
  }

  // 狀態 1:{active:false} → 不存在
  const s1 = await renderState({ active: false });
  const has1 = s1.report.some(e => e.sig.startsWith('DIV.ph-founding'));
  ok('G1.1 {active:false} → .ph-founding 不存在', !has1, `count=${s1.report.filter(e=>e.sig.includes('ph-founding')).length}`);

  // 狀態 2:{active:true, founding:false} → 不存在(對照組基準)
  const s2 = await renderState({ active: true, founding: false });
  const has2 = s2.report.some(e => e.sig.startsWith('DIV.ph-founding'));
  ok('G1.2 {active:true,founding:false} → .ph-founding 不存在', !has2, `count=${s2.report.filter(e=>e.sig.includes('ph-founding')).length}`);

  // 狀態 3:{active:true, founding:true} → 存在,elementFromPoint 命中自己
  const s3 = await renderState({ active: true, founding: true });
  const badge3 = s3.report.find(e => e.sig.startsWith('DIV.ph-founding|'));
  ok('G1.3 {active:true,founding:true} → .ph-founding 存在', !!badge3, badge3 ? JSON.stringify(badge3.rect) : 'not found');

  // 全部可見後代:零水平溢出、零命中失敗(含邊角取樣,不只中心)
  const overflow3 = s3.report.filter(e => e.overflowH);
  ok('G1.4 桌面三態(founding:true)全部可見後代零水平溢出護照容器', overflow3.length === 0,
    overflow3.length ? overflow3.map(e => e.sig + ' rect=' + e.rect.join(',')).join(' ; ') : `rootRect=${s3.rootRect.join(',')}`);
  const hitFail3 = s3.report.filter(e => e.hitFails && e.hitFails.length);
  ok('G1.5 桌面三態(founding:true)全部有文字的可見後代,多點 elementFromPoint 皆命中自己(含邊角)', hitFail3.length === 0,
    hitFail3.length ? hitFail3.map(e => e.sig + ':' + e.hitFails.join('/')).join(' ; ') : `測了 ${s3.report.filter(e=>e.ownText).length} 個有文字元素`);

  // ── 對照組比較:founding:true(s3) vs founding:false(s2),排除 .ph-founding 整個子樹 ──
  // 用 inFounding(el.closest('.ph-founding'),DOM 血緣關係)排除,不用字串比對 class 名
  // ——.pf-txt 內的 <b>/<i> 沒有自己的 class,字串比對會漏掉(已踩過一次,見報告)。
  const s3rest = s3.report.filter(e => !e.inFounding);
  const sigMatch = s3rest.length === s2.report.length && s3rest.every((e, i) => e.sig === s2.report[i].sig);
  ok('G1.6 對照組結構比對:排除徽章後,founding:true 與 founding:false 的元素簽名序列一致(同一份資料生成)',
    sigMatch, sigMatch ? `${s3rest.length} 個元素逐一比對相符` : `s3rest=${s3rest.length} s2=${s2.report.length} 首個不符=${JSON.stringify(s3rest.find((e,i)=>e.sig!==s2.report[i]?.sig))}`);

  if (sigMatch) {
    // 因為 s2/s3 是先後兩次獨立渲染(非同頁同時存在),用 DOM 血緣(bodyDescendant,不是像素猜測)分兩群:
    // 「.ph-body 的子孫」(徽章是它的第一個子元素,把其餘全部往下推)應統一位移某個量;
    // 「其餘(.ph-head 及其內容、.ph-body 容器本身)」的頂邊不受影響,應 deltaY≈0。水平 deltaX 全部應≈0。
    // 注意:「統一位移某個量」不預先手算徽章 outerHeight 當期望值——CSS margin collapsing(徽章的
    // margin-bottom 與下一個 .ph-sec 的 margin-top 會 collapse 成 max(),不是相加)會讓手算值系統性
    // 偏高,已實測踩過一次;改成「量到的位移量本身必須對所有子孫一致」,不依賴任何手算公式。
    const deltas = s3rest.map((e, i) => {
      const b = s2.report[i];
      return { sig: e.sig, dx: e.rect[0] - b.rect[0], dyTop: e.rect[1] - b.rect[1], bodyDescendant: e.bodyDescendant };
    });
    const badHoriz = deltas.filter(d => Math.abs(d.dx) > 1);
    ok('G1.7 對照組:零水平位移(dx≈0)', badHoriz.length === 0,
      badHoriz.length ? badHoriz.slice(0,5).map(d => `${d.sig} dx=${d.dx.toFixed(1)}`).join(' ; ') : `n=${deltas.length}`);
    const bodyDeltas = deltas.filter(d => d.bodyDescendant);
    const nonBodyDeltas = deltas.filter(d => !d.bodyDescendant);
    const badNonBody = nonBodyDeltas.filter(d => Math.abs(d.dyTop) > 2);
    ok('G1.7b 對照組:.ph-head 與 .ph-body 容器本身零垂直位移(徽章只撐高內部,不移動外部頂邊)',
      badNonBody.length === 0,
      badNonBody.length ? badNonBody.slice(0,5).map(d => `${d.sig} dy=${d.dyTop.toFixed(1)}`).join(' ; ') : `n=${nonBodyDeltas.length}`);
    const shiftVals = bodyDeltas.map(d => d.dyTop);
    // M-5:原本寫 `shiftVals.length ? ... : true`——.ph-body 若哪天沒有子孫(選擇器改名、護照改版),
    // 樣本為空這條會真空為真。改成「必須真的量到樣本」也是通過條件的一部分;另外 badVert 原本算了
    // 卻沒參與 pass/fail(只出現在失敗訊息裡),一併納入判準:全距小 ≠ 沒有離群值。
    const hasSamples = shiftVals.length > 0;
    const spreadOk = hasSamples && Math.max(...shiftVals) - Math.min(...shiftVals) <= 2;
    const medianShift = hasSamples ? shiftVals.slice().sort((a,b)=>a-b)[Math.floor(shiftVals.length/2)] : 0;
    const badVert = bodyDeltas.filter(d => Math.abs(d.dyTop - medianShift) > 2);
    const uniformShift = hasSamples && spreadOk && badVert.length === 0;
    ok('G1.8 對照組:.ph-body 內所有子孫元素統一位移同一個量(無非預期跳動——不是各元素各移各的;樣本為空視同不通過)',
      uniformShift,
      uniformShift ? `n=${bodyDeltas.length} 皆位移≈${medianShift.toFixed(1)}px(徽章自身高度+collapse 後的間距)` :
        !hasSamples ? '量不到任何 .ph-body 子孫,樣本為空(判準真空,不算通過)' :
        `位移量不一致,不符:` + badVert.slice(0,5).map(d => `${d.sig} dy=${d.dyTop.toFixed(1)}`).join(' ; ') + ` (中位數=${medianShift.toFixed(1)}、全距=${(Math.max(...shiftVals)-Math.min(...shiftVals)).toFixed(1)})`);
    // 對照組本身(founding:false)也要零命中失敗——分辨「本來就有的缺陷」vs「我造成的」
    const hitFail2 = s2.report.filter(e => e.hitFails && e.hitFails.length);
    ok('G1.9 對照組(founding:false)本身也零命中失敗(排除既有缺陷的可能性)', hitFail2.length === 0,
      hitFail2.length ? hitFail2.map(e => e.sig + ':' + e.hitFails.join('/')).join(' ; ') : 'clean baseline');
  }

  ok('G1 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close(); await cr.close();
}

// ═══════════════ Group 2:手機四寬度——可及性稽核(不是假設它會出現,是先驗它出不出現) ═══════════════
{
  const cr = await chromium.launch();
  for (const [w, h] of [[360, 780], [375, 812], [414, 896], [768, 1024]]) {
    const { ctx, page, errors } = await boot(cr, { width: w, height: h, touch: true });
    await injectCollector(page);
    await page.evaluate(() => { try { localStorage.setItem('trainmap-passport-open', '1'); } catch (e) {} });

    const fsOn = await page.evaluate(() => document.body.classList.contains('fs'));
    ok(`G2.${w}.0 body.fs 於開站時啟動(≤900px 手機殼)`, fsOn === true, `fs=${fsOn}`);

    // 即使把 state.plus.founding 設為 true 並重繪桌面 #passport(Step 3 實際做的事),
    // #passport 容器本身在 body.fs 下是否仍完全不可見?
    const passportState = await page.evaluate(() => {
      state.plus = { active: true, founding: true };
      renderPassport();
      const el = document.getElementById('passport');
      const cs = getComputedStyle(el);
      const containsBadge = !!el.querySelector('.ph-founding');
      return { display: cs.display, containsBadge, rect: (() => { const r = el.getBoundingClientRect(); return [r.width, r.height]; })() };
    });
    ok(`G2.${w}.1 #passport 內容確實含 .ph-founding(證明 Step 3 的程式碼本身沒問題)`,
      passportState.containsBadge === true, JSON.stringify(passportState));
    ok(`G2.${w}.2 但 #passport 在 body.fs 下 display:none(內容有徽章≠使用者看得到)`,
      passportState.display === 'none', JSON.stringify(passportState));

    // 使用者在手機上實際會點的「旅程護照」入口:真的點 #tabRide(手機底部分頁鍵,不是
    // #rideBtn——實測 #rideBtn 在手機殼下 display:flex 但 rect 是 [0,0,0,0](已被 tabbar
    // 取代,不可點),#tabRide 才是使用者真正看得到、點得到的元素;它的 onclick 內部才轉呼叫
    // #rideBtn.click(),見 index.html「document.getElementById('tabRide').onclick」那行)。
    // 不呼叫 openRidePanel() 繞過真實點擊路徑——renderRidePanel() 開頭有
    // `if (el.hidden) return;` 早退,必須真的開面板才會跑到組裝行;真點也順便驗證點擊鏈路
    // (tabRide → rideBtn.click() → openRidePanel())本身沒有壞掉,不只驗渲染函式。
    await page.evaluate(() => { state.plus = { active: true, founding: true }; });
    await page.click('#tabRide');
    await page.waitForFunction(() => document.getElementById('ridePanel').hidden === false, null, { timeout: 10000 });
    await fitViewport(page);
    const ride3 = await page.evaluate(() => window.__rlHitTest('#ridePanel', { scrollIntoView: true }));
    const hiddenAfterOpen = await page.evaluate(() => document.getElementById('ridePanel').hidden);
    const badge3 = ride3.report.find(e => e.sig.startsWith('DIV.ph-founding|'));
    ok(`G2.${w}.3 真點 #tabRide 開面板後,#ridePanel 不再 hidden 且含 .ph-founding`,
      hiddenAfterOpen === false && !!badge3, `hidden=${hiddenAfterOpen} badge=${!!badge3}`);

    // 不手挑「只驗徽章自己」——窮舉 #ridePanel 內全部可見後代(與 Group 1 對 #passport 的做法
    // 一致),才驗得到「插入徽章有沒有連帶把旁邊既有元素擠出範圍/蓋住」,不是只驗新元素自己。
    const overflow3 = ride3.report.filter(e => e.overflowH);
    ok(`G2.${w}.4 #ridePanel 全部可見後代(不只徽章)零水平溢出`,
      overflow3.length === 0,
      overflow3.length ? overflow3.map(e => e.sig + ' rect=' + e.rect.join(',')).join(' ; ') : `rootRect=${ride3.rootRect.join(',')}(共 ${ride3.report.length} 個元素)`);

    const hitFail3 = ride3.report.filter(e => e.hitFails && e.hitFails.length);
    ok(`G2.${w}.5 #ridePanel 全部有文字的可見後代(不只徽章),多點 elementFromPoint(不只中心,含邊角)皆命中自己,零裁切/遮蔽`,
      hitFail3.length === 0,
      hitFail3.length ? hitFail3.map(e => e.sig + ':' + e.hitFails.join('/')).join(' ; ') : `測了 ${ride3.report.filter(e => e.ownText).length} 個有文字元素`);

    // 「非底色」:computed style 都對不代表看得見(見 panel-translucent-contract 教訓)——
    // 對元素實際截圖解碼,確認真的畫出多種色調(金色圓章/深色標題/淺色副標/面板底色),
    // 不是一片與背景無法分辨的死色。
    const px3 = await pixelStats(page, '.ph-founding');
    const visiblyDistinct = !!px3 && px3.distinctColors >= 4 && px3.lumRange >= 20;
    ok(`G2.${w}.6 .ph-founding 實際渲染像素非底色(≥4 種相異色調、亮度全距≥20,非 computed style)`,
      visiblyDistinct, JSON.stringify(px3));

    // ── 控制組/突變:founding:false 重繪同一個已開啟的面板,.ph-founding 必須消失 ──
    // 證明上面「存在+可見」那幾條斷言真的在測這個功能開關,不是恆為真的死規則
    // (與桌面 Group 1 的 G1.1/G1.2 同一套邏輯,鏡射到手機路徑)。
    const ride3b = await page.evaluate(() => { state.plus = { active: true, founding: false }; renderRidePanel(); return window.__rlHitTest('#ridePanel', { scrollIntoView: true }); });
    const badge3b = ride3b.report.some(e => e.sig.startsWith('DIV.ph-founding'));
    ok(`G2.${w}.7(突變)founding:false 重繪同一面板 → .ph-founding 從 #ridePanel 消失(證明 G2.${w}.3 有牙)`,
      !badge3b, `count=${ride3b.report.filter(e => e.sig.includes('ph-founding')).length}`);

    // ── 窮舉「定位元素」兩兩相交,不手挑名單(另一個 session 今天的 #tripBanner/.map-actions
    // 教訓:手挑清單漏一個,54/54 全綠但兩顆鈕被壓住 2772px² 都測不到)。position≠static 的
    // 元素才可能脫離文件流互相重疊(sticky 的 <h3> 就是一個,不是假設性風險)。用控制組
    // (founding:true vs founding:false)差分,只有「這組相交在 founding:false 沒有、
    // founding:true 才出現」才算徽章造成的新問題——區分既有版面設計與插入造成的回歸。
    const positionedRects = report => report.filter(e => e.position && e.position !== 'static').map(e => ({ sig: e.sig, rect: e.rect }));
    const rectsIntersect = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const pairwiseOverlaps = rects => {
      const out = [];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        if (rectsIntersect(rects[i].rect, rects[j].rect)) out.push([rects[i].sig, rects[j].sig].sort().join(' × '));
      }
      return out;
    };
    const posTrue = positionedRects(ride3.report), posFalse = positionedRects(ride3b.report);
    const overlapsTrue = new Set(pairwiseOverlaps(posTrue)), overlapsFalse = new Set(pairwiseOverlaps(posFalse));
    const newOverlaps = [...overlapsTrue].filter(p => !overlapsFalse.has(p));
    // M-3:`newOverlaps.length === 0` 是「數量必須為 0」型斷言——收集器若沒在收(report 的 position
    // 欄位哪天沒填、選擇器改名),newOverlaps 會恆空而恆綠。加正向對照當閘門:對照組本身必須真的
    // 撈到定位元素(≥2)、而且偵測器真的開過火(founding:false 這一態本來就有 1 組既有相交——
    // sticky <h3> 與它自己的關閉鈕)。這兩個數字是這個面板的結構事實,不是量出來湊的門檻;
    // 面板改版到連 sticky 標題都沒有時它會翻紅,那正是「這條斷言已經沒有東西可測」該被知道的時候。
    const collectorAlive = posTrue.length >= 2 && overlapsFalse.size >= 1;
    // 措辭修正:這裡窮舉的是 position≠static 的元素(全 report 173 個裡的 2 個),不是「全部元素」
    // ——靜態流裡的重疊/遮蔽由 .5 的多點命中測試負責,兩條合起來才是完整覆蓋。
    ok(`G2.${w}.8 #ridePanel 內全部 position≠static 元素(不手挑名單)兩兩相交,對照 founding:false 零新增重疊;含收集器正向對照(靜態流重疊由 .5 命中測試負責)`,
      newOverlaps.length === 0 && collectorAlive,
      !collectorAlive ? `收集器正向對照失敗:定位元素 true=${posTrue.length}/false=${posFalse.length}(需≥2)、對照組既有相交=${overlapsFalse.size} 組(需≥1)——這條可能是恆綠的死規則`
        : newOverlaps.length ? newOverlaps.join(' ; ')
        : `founding:true 共 ${posTrue.length} 個定位元素(含既有相交 ${overlapsTrue.size} 組)、founding:false 共 ${posFalse.length} 個,新增相交=0`);

    if (w === 375) {
      // ── 第二重突變,只在一個寬度做:專門驗證 pixelStats() 這個新技法本身有沒有牙 ──
      // 這是本輪唯一真正「新」的量測工具(hit-test/溢出檢查在 Group 1 已驗證過很多次)。
      // 恢復 founding:true 讓徽章重新出現,再故意 opacity:0——DOM/rect/hit-test 全部維持
      // 正常(elementFromPoint 依然會命中,因為它量的是命中測試而非可見度),但視覺上跟
      // 背景無法分辨,這正是「computed style 抓不到、pixelStats 應該要抓到」的那種情況。
      // 只測一個寬度,因為這是驗證「檢查工具本身有沒有鑑別力」,與版面寬度無關。
      // 注意(協調者提醒的 #tripBanner 教訓,不同用法但同一警覺):這裡用 opacity 是當一次性
      // 「刻意破壞」的突變手段,不是拿它當可見性判準去篩選要不要測——兩者是不同的事,判準本身
      // (__rlVisibleDescendants)全程只認 display/visibility/rect 面積,見上方定義。但仍加一道
      // 讀回確認突變真的生效,防範任何我沒預期到的 re-render 把手動加的 inline style 蓋掉
      // (對方在別的元件上就實測過 render loop 會拔掉手動加的 class)。
      await page.evaluate(() => { state.plus = { active: true, founding: true }; renderRidePanel(); });
      await page.evaluate(() => { const el = document.querySelector('.ph-founding'); if (el) el.style.opacity = '0'; });
      const opacityStuck = await page.evaluate(() => getComputedStyle(document.querySelector('.ph-founding')).opacity);
      const pxBroken = opacityStuck === '0' ? await pixelStats(page, '.ph-founding') : null;
      const correctlyFlat = opacityStuck === '0' && !!pxBroken && pxBroken.distinctColors <= 2;
      ok(`G2.${w}.9(harness 自檢,不是產品缺陷)opacity:0 後 pixelStats 正確判定為近乎底色(distinctColors≤2,證明 G2.${w}.6 不是死規則)`,
        correctlyFlat, JSON.stringify(pxBroken));
      await page.evaluate(() => { const el = document.querySelector('.ph-founding'); if (el) el.style.opacity = ''; });

      // ── 第三重突變:G2.*.4/G2.*.5 是本輪把「只驗徽章」擴大成「窮舉整個容器」的兩條——擴大
      // 範圍不等於自動有牙,沒有一發專門瞄準它們的突變,等於只驗了「當下沒破」沒驗「壞了抓不抓得到」。
      await page.evaluate(() => { state.plus = { active: true, founding: true }; renderRidePanel(); });
      // 10. 逼 .ph-founding 撐寬到遠超容器,證明「溢出」真的會被 overflowH 量到
      await page.evaluate(() => { const el = document.querySelector('.ph-founding'); if (el) { el.style.width = '3000px'; el.style.whiteSpace = 'nowrap'; el.style.flex = 'none'; } });
      const rideOverflowBroken = await page.evaluate(() => window.__rlHitTest('#ridePanel', { scrollIntoView: true }));
      const badgeOverflowEntry = rideOverflowBroken.report.find(e => e.sig.startsWith('DIV.ph-founding|'));
      ok(`G2.${w}.10(突變)刻意撐寬 .ph-founding 到 3000px → overflowH 正確變 true(證明 G2.${w}.4 不是死規則)`,
        !!badgeOverflowEntry && badgeOverflowEntry.overflowH === true,
        badgeOverflowEntry ? `overflowH=${badgeOverflowEntry.overflowH} rect=${badgeOverflowEntry.rect.join(',')}` : '找不到 .ph-founding');
      await page.evaluate(() => { const el = document.querySelector('.ph-founding'); if (el) { el.style.width = ''; el.style.whiteSpace = ''; el.style.flex = ''; } });

      // 11. 逼 .ph-founding 的 elementFromPoint 命不中自己(pointer-events:none 讓命中測試
      // 穿透到它後面的元素),證明「命中測試」真的會被 hitFails 量到。
      // 注意:.ph-founding 本身是純容器(<div><span>創</span><span>...</span></div>),沒有
      // 直接文字子節點,__rlHitTest 的 ownText 判斷(只認直接 text node)因此不會對 .ph-founding
      // 這個 DIV 自己取樣——真正被取樣、會反映 pointer-events 遮蔽的是它的子孫(.pf-mark 的
      // 「創」、.pf-txt 內 <b>/<i> 的文字),要用 inFounding 撈全部子孫項,不能只挑 DIV.ph-founding
      // 這一條(第一次寫成只挑它自己,結果 hitFails 恆空——不是斷言沒牙,是找錯了要看的元素)。
      await page.evaluate(() => { const el = document.querySelector('.ph-founding'); if (el) el.style.pointerEvents = 'none'; });
      const rideHitBroken = await page.evaluate(() => window.__rlHitTest('#ridePanel', { scrollIntoView: true }));
      const foundingDescendants = rideHitBroken.report.filter(e => e.inFounding);
      const brokenHitEntries = foundingDescendants.filter(e => e.hitFails && e.hitFails.length > 0);
      ok(`G2.${w}.11(突變)刻意讓 .ph-founding 的 pointer-events:none → 底下子孫的 hitFails 正確非空(證明 G2.${w}.5 不是死規則)`,
        brokenHitEntries.length > 0,
        brokenHitEntries.length ? brokenHitEntries.map(e => e.sig + ':' + e.hitFails.join('/')).join(' ; ') : `founding 子孫共 ${foundingDescendants.length} 個,全部 hitFails 皆空`);
      await page.evaluate(() => { const el = document.querySelector('.ph-founding'); if (el) el.style.pointerEvents = ''; });
      // 還原乾淨狀態,避免污染下面的「無 JS 例外」檢查
      await page.evaluate(() => { renderRidePanel(); });
    }

    ok(`G2.${w} 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await cr.close();
}

// ═══════════════ Group 3:暗色主題——實際渲染 + 對比計算(僅在真正會被使用者看到的桌面 #passport) ═══════════════
{
  const cr = await chromium.launch();
  const { ctx, page, errors } = await boot(cr, { width: 1280, height: 900, theme: 'dark' });
  await page.evaluate(() => { try { localStorage.setItem('trainmap-passport-open', '1'); } catch (e) {} });
  await page.evaluate(() => { state.plus = { active: true, founding: true }; renderPassport(); });
  const themeOn = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok('G3.0 暗色主題確實生效(html[data-theme=dark])', themeOn === 'dark', `data-theme=${themeOn}`);

  const colors = await page.evaluate(() => {
    const mark = document.querySelector('.ph-founding .pf-mark');
    const founding = document.querySelector('.ph-founding');
    const b = document.querySelector('.ph-founding .pf-txt b');
    const i = document.querySelector('.ph-founding .pf-txt i');
    const passport = document.getElementById('passport');
    const get = (el, prop) => el ? getComputedStyle(el)[prop] : null;
    return {
      markColor: get(mark, 'color'), markBg: get(mark, 'backgroundColor'),
      foundingBg: get(founding, 'backgroundColor'), passportBg: get(passport, 'backgroundColor'),
      borderColor: get(founding, 'borderTopColor'), borderWidth: get(founding, 'borderTopWidth'),
      bColor: get(b, 'color'), iColor: get(i, 'color'),
    };
  });
  function parseRgb(s) { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; }
  function relLum([r, g, b]) { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; const [R, G, B] = [f(r), f(g), f(b)]; return 0.2126 * R + 0.7152 * G + 0.0722 * B; }
  function contrast(c1, c2) { const L1 = relLum(c1), L2 = relLum(c2); const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1]; return (hi + 0.05) / (lo + 0.05); }
  const markContrast = contrast(parseRgb(colors.markColor), parseRgb(colors.markBg));
  const bContrast = contrast(parseRgb(colors.bColor), parseRgb(colors.foundingBg));
  const iContrast = contrast(parseRgb(colors.iColor), parseRgb(colors.foundingBg));
  // brief Step 4 唯一點名的暗色風險就是這條:金圓(--gold 填色)在暗色 stage 底上夠不夠醒目。
  // 它不是文字疊底色,所以判準取 WCAG 1.4.11「非文字對比」的 3:1(圖形物件/UI 元件邊界的外部常數),
  // 不是文字用的 4.5——判準來自外部標準,不是拿今天量到的數字回填(那種門檻下次改色一樣抓不到)。
  const markOnStage = contrast(parseRgb(colors.markBg), parseRgb(colors.foundingBg));
  const stageOnPaper = contrast(parseRgb(colors.foundingBg), parseRgb(colors.passportBg)); // 見文末 INFO
  const lineOnStage = contrast(parseRgb(colors.borderColor), parseRgb(colors.foundingBg));
  const lineOnPaper = contrast(parseRgb(colors.borderColor), parseRgb(colors.passportBg));
  ok('G3.1 暗色 .pf-mark 文字(--paper)對底色(--gold)對比比',
    markContrast >= 4.5, `ratio=${markContrast.toFixed(2)}:1 (WCAG AA 文字門檻 4.5:1) colors=${colors.markColor} on ${colors.markBg}`);
  ok('G3.2 暗色「創始島民」標題(--ink-strong)對底色(--bg-stage)對比比',
    bContrast >= 4.5, `ratio=${bContrast.toFixed(2)}:1 colors=${colors.bColor} on ${colors.foundingBg}`);
  // M-1:原本第二個參數直接傳 true,量到什麼都不會紅,卻計進分母。副標是 11.5px 的一般文字,
  // WCAG AA 的門檻就是 4.5——直接用它當閘門,不再寫「資訊性參考」自我豁免。
  ok('G3.3 暗色副標(--faint)對徽章底(--bg-stage)對比比 ≥ WCAG AA 文字門檻 4.5:1',
    iContrast >= 4.5, `ratio=${iContrast.toFixed(2)}:1 colors=${colors.iColor} on ${colors.foundingBg}`);
  ok('G3.4 暗色金圓章(--gold 填色)對徽章底(--bg-stage)對比比 ≥ WCAG 1.4.11 非文字門檻 3:1(brief Step 4 點名的風險)',
    markOnStage >= 3, `ratio=${markOnStage.toFixed(2)}:1 colors=${colors.markBg} on ${colors.foundingBg}`);
  // 「徽章底 vs 護照底」這組填色亮度幾乎一樣(暗色 --bg-stage #0E1526 vs --paper #141D31),
  // 分層實際上是 1px 的 --line 邊框做出來的,不是填色對比——這個維度沒有可寫的亮度門檻
  // (寫任何數字都是回填今天的量測值),故列為 INFO 不計分,數字留給人眼稽核。
  info('G3.i 暗色分層數字(不計分,供人眼稽核)',
    `徽章底 vs 護照底=${stageOnPaper.toFixed(2)}:1(幾乎同亮度,分層靠邊框);邊框 vs 徽章底=${lineOnStage.toFixed(2)}:1、邊框 vs 護照底=${lineOnPaper.toFixed(2)}:1;截圖 scratchpad/founding_seal_dark.png`);

  // 截圖存證(供人眼複查)
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(results_dir, { recursive: true });
  } catch (e) {}
  const el = await page.$('.ph-founding');
  if (el) await el.screenshot({ path: path.join(results_dir, 'founding_seal_dark.png') });
  await page.screenshot({ path: path.join(results_dir, 'passport_dark_full.png') });

  ok('G3 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // 亮色對照(同樣截圖,供比對)
  const { ctx: ctxL, page: pageL } = await boot(cr, { width: 1280, height: 900, theme: 'light' });
  await pageL.evaluate(() => { try { localStorage.setItem('trainmap-passport-open', '1'); } catch (e) {} });
  await pageL.evaluate(() => { state.plus = { active: true, founding: true }; renderPassport(); });
  const elL = await pageL.$('.ph-founding');
  if (elL) await elL.screenshot({ path: path.join(results_dir, 'founding_seal_light.png') });
  await ctxL.close();
  await cr.close();
}

// ═══════════════ Group 4:契約檢查(brief 的「不要碰」邊界有沒有被誤觸) ═══════════════
{
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refreshStart = html.indexOf('async function plusRefresh()');
  const refreshBranchEnd = html.indexOf("return p.active;\n  }\n  p.loading = true");
  const restoreStart = html.indexOf('async function plusRestore()');
  const restoreEnd = html.indexOf('async function plusRequire(');
  // M-2:這兩條都是「必須不存在 / 必須符合形狀」的原始碼掃描,靠 indexOf 錨點切片——錨點被改名時
  // indexOf 回 -1,`slice(-1, end)` 在 end 較小時回空字串,`!/foundingFrom/.test('')` 恆真 ⇒ 靜默 PASS。
  // 先把「切片本身是不是有效的」變成一條自己的斷言(壞了要指得出是錨點壞了,不是產品壞了),
  // 而且下面 G4.1 的通過條件也把它包進去,免得 G4.0 紅了 G4.1 還在真空放行。
  // 兩段切片各自獨立判定,不共用一個 anchorsOk——共用的話「plusRefresh 被改名」會連帶把 G4.2 也
  // 打紅,訊息變成「plusRestore 沒寫入」而誤導診斷方向。壞哪一段就只紅哪一段。
  const refreshAnchorOk = refreshStart >= 0 && refreshBranchEnd > refreshStart;
  const restoreAnchorOk = restoreStart >= 0 && restoreEnd > restoreStart;
  const apiStatusBranch = refreshAnchorOk ? html.slice(refreshStart, refreshBranchEnd) : '';
  const restoreBody = restoreAnchorOk ? html.slice(restoreStart, restoreEnd) : '';
  // 切片必須真的是我以為的那段:早退分支要含 /api/plus-status,plusRestore() 本文要含 p.active 賦值。
  const refreshSliceSane = refreshAnchorOk && apiStatusBranch.includes('api/plus-status');
  const restoreSliceSane = restoreAnchorOk && restoreBody.includes('p.active = plusActiveFrom(info)');
  ok('G4.0 契約掃描的原始碼錨點有效(plusRefresh 早退分支切片含 api/plus-status、plusRestore 本文含 p.active 賦值)',
    refreshSliceSane && restoreSliceSane,
    `refresh: start=${refreshStart} end=${refreshBranchEnd} 切片長=${apiStatusBranch.length} sane=${refreshSliceSane} ; restore: start=${restoreStart} end=${restoreEnd} 切片長=${restoreBody.length} sane=${restoreSliceSane}`);
  ok('G4.1 /api/plus-status 分支(無 info 那條)沒有被加上 foundingFrom(brief 明確禁止,那裡沒 info 可傳)',
    refreshSliceSane && !/foundingFrom/.test(apiStatusBranch),
    !refreshSliceSane ? '切片無效(見 G4.0),這條不算通過——不是「乾淨」' : apiStatusBranch.includes('foundingFrom') ? '出現在不該出現的地方' : `乾淨(切片 ${apiStatusBranch.length} 字元)`);
  // 裁示二:plusRestore() 補齊第 3 個同形寫入點。用較嚴格的 regex(要求形狀與另兩處一致,
  // 不是隨便找到一個 `p.founding =` 就算數)——tighten 到「= p.active && foundingFrom(info)」。
  const restoreHasFounding = restoreSliceSane && /p\.founding\s*=\s*p\.active\s*&&\s*foundingFrom\(info\)/.test(restoreBody);
  ok('G4.2 plusRestore() 現在也寫入 p.founding(裁示二補齊的第 3 個同形寫入點,形狀與 plusRefresh/plusPurchase 一致)',
    restoreHasFounding, !restoreSliceSane ? '切片無效(見 G4.0),這條不算通過' : restoreHasFounding ? '有' : '沒有(裁示二應已補上,見 index.html plusRestore() 內)');
}

// ═══════════════ Group 5:WebKit(創始徽章唯一的真實受眾——App 全部走 WKWebView)═══════════════
// 前面 71 條全是 chromium。這個功能的判定(founding)只有 App 拿得到,全部受眾都在 App=WKWebView
// =WebKit,chromium 全綠對這個功能的真實使用者等於沒驗到目標引擎——本專案有明確前例:WebKit
// 算 flex 容器內在寬度時不認子項的 flex-basis、只認顯式 width,曾把一排按鈕壓成 14px、chromium
// 全綠使用者截圖才發現。CSS 現況(index.html:1013-1019)風險具體且已核對:.pf-mark 有
// flex:none+顯式 width:30px(安全);.pf-txt 是同一個 flex row 裡的 item,只有
// `display:flex;flex-direction:column;line-height:1.35`,沒有顯式 width、沒有 flex 覆寫——
// 形狀與踩過的坑一致,必須實測,不能用「應該沒事」帶過。
try {
  const wk = await webkit.launch();
  const webkitPfMetrics = {}; // 存每個寬度量到的 .pf-txt 數據,給後面跨引擎比對用
  for (const [w, h] of [[360, 780], [375, 812], [414, 896]]) {
    const { ctx, page, errors } = await boot(wk, { width: w, height: h, touch: true });
    await injectCollector(page);

    // 真觸控(hasTouch/isMobile 由 boot() 的 touch:true 設好)+ 真點 #tabRide,不繞過
    // renderRidePanel() 開頭的 `if (el.hidden) return;` 早退,與 G2.*.3 同一套邏輯。
    await page.evaluate(() => { state.plus = { active: true, founding: true }; });
    await page.tap('#tabRide');
    await page.waitForFunction(() => document.getElementById('ridePanel').hidden === false, null, { timeout: 10000 });
    await fitViewport(page);

    const ride = await page.evaluate(() => window.__rlHitTest('#ridePanel', { scrollIntoView: true }));
    const hiddenAfterOpen = await page.evaluate(() => document.getElementById('ridePanel').hidden);
    const badge = ride.report.find(e => e.sig.startsWith('DIV.ph-founding|'));
    ok(`G5.${w}.0(webkit 真觸控)真點 #tabRide 開面板後,#ridePanel 不再 hidden 且含 .ph-founding`,
      hiddenAfterOpen === false && !!badge, `hidden=${hiddenAfterOpen} badge=${!!badge}`);

    const overflow = ride.report.filter(e => e.overflowH);
    ok(`G5.${w}.1(webkit)#ridePanel 全部可見後代零水平溢出`,
      overflow.length === 0,
      overflow.length ? overflow.map(e => e.sig + ' rect=' + e.rect.join(',')).join(' ; ') : `共 ${ride.report.length} 個元素`);

    const hitFail = ride.report.filter(e => e.hitFails && e.hitFails.length);
    ok(`G5.${w}.2(webkit)#ridePanel 全部有文字的可見後代,多點 elementFromPoint 皆命中自己`,
      hitFail.length === 0,
      hitFail.length ? hitFail.map(e => e.sig + ':' + e.hitFails.join('/')).join(' ; ') : `測了 ${ride.report.filter(e => e.ownText).length} 個有文字元素`);

    const px = await pixelStats(page, '.ph-founding');
    const visiblyDistinct = !!px && px.distinctColors >= 4 && px.lumRange >= 20;
    ok(`G5.${w}.3(webkit).ph-founding 實際渲染像素非底色`, visiblyDistinct, JSON.stringify(px));

    // 直接量協調者點名的那個坑:.pf-txt 有沒有被 WebKit 已知的 flex-basis:auto 內在寬度算法
    // 縮到只剩 min-content(理論上限:CJK 換行幾乎不受限,崩壞可以窄到剩一個字)。
    // 第一版在這裡假設「健康情況=吃滿剩餘空間」算了個 expectedTxtW 直接比對,結果 360/375/414
    // 全 FAIL——但同一個 formula 拿去 chromium(已知沒有這個坑的引擎)當正向對照,一樣 FAIL
    // 且兩個引擎的 txtW 幾乎一模一樣(webkit 182.75px vs chromium 184px,誤差 1.25px)。
    // 這證明錯的是 formula 本身,不是版面:.pf-txt 沒有設 flex-grow,預設 `flex:0 1 auto`
    // 本來就不會撐滿剩餘空間(那段空白留白是 CSS 規格下的正確行為,不是 bug),两個引擎在這點上
    // 完全一致。改成兩層真正有鑑別力的檢查:①「有沒有崩到不合理窄」的樓地板(遠低於健康值
    // 183px 才會觸發)②「有沒有超出剩餘空間」的天花板(超出就會被 G5.*.1 的窮舉溢出檢查連帶
    // 抓到,這裡多一層對 .pf-txt 專屬的直接證據)。真正回答「WebKit 算得跟 chromium 不一樣嗎」
    // 的是下面 G5.control 的跨引擎數字比對,不是這裡自證的樓地板。
    const pfMetrics = await page.evaluate(() => {
      const founding = document.querySelector('.ph-founding');
      const mark = document.querySelector('.pf-mark');
      const txt = document.querySelector('.pf-txt');
      const iEl = document.querySelector('.pf-txt i');
      const csF = getComputedStyle(founding);
      const contentW = founding.clientWidth - parseFloat(csF.paddingLeft) - parseFloat(csF.paddingRight);
      const gap = parseFloat(csF.columnGap || csF.gap) || 10;
      const markW = mark.getBoundingClientRect().width;
      const txtW = txt.getBoundingClientRect().width;
      return { contentW, markW, txtW, remainingSpace: contentW - markW - gap, iLines: iEl ? Array.from(iEl.getClientRects()).length : -1 };
    });
    webkitPfMetrics[w] = pfMetrics;
    const MIN_SANE_PX = 100; // 健康值 183px 的樓地板,遠高於「崩成 min-content」會落到的範圍(單一 CJK 字約 15-20px)
    const notCollapsed = pfMetrics.txtW > MIN_SANE_PX;
    const notOverflowing = pfMetrics.txtW <= pfMetrics.remainingSpace + 2; // +2px 容錯
    ok(`G5.${w}.4(webkit).pf-txt 寬度沒有崩到不合理窄(>${MIN_SANE_PX}px,排除 min-content 崩塌)且沒有超出剩餘空間(≤剩餘空間+2px)`,
      notCollapsed && notOverflowing, JSON.stringify(pfMetrics));

    // 突變:founding:false 重繪同一面板,徽章消失——證明上面幾條在 WebKit 這個引擎上真的在測
    // 這個開關,不是恰好通過的死規則。chromium 已證明過的突變不能直接套用到另一個引擎,
    // 兩者是獨立的渲染/JS 引擎,各自要有自己的牙。
    const ride2 = await page.evaluate(() => { state.plus = { active: true, founding: false }; renderRidePanel(); return window.__rlHitTest('#ridePanel', { scrollIntoView: true }); });
    const badgeGone = !ride2.report.some(e => e.sig.startsWith('DIV.ph-founding'));
    ok(`G5.${w}.5(webkit,突變)founding:false 重繪同一面板 → .ph-founding 消失(證明上面幾條在 WebKit 上有牙)`,
      badgeGone, `count=${ride2.report.filter(e => e.sig.includes('ph-founding')).length}`);

    ok(`G5.${w} 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 真正回答「WebKit 是不是把 .pf-txt 算得跟 chromium 不一樣」的檢查:同一寬度(375)下,
  // 兩個引擎的 .pf-txt 實測寬度/換行數直接比對數字,不是各自跟自己的假設比。誤差容許 5px
  // (次像素字型渲染/kerning 的正常引擎間差異,不是版面 bug)。
  const crCheck = await chromium.launch();
  {
    const { ctx, page, errors } = await boot(crCheck, { width: 375, height: 812, touch: true });
    await page.evaluate(() => { state.plus = { active: true, founding: true }; });
    await page.click('#tabRide');
    await page.waitForFunction(() => document.getElementById('ridePanel').hidden === false, null, { timeout: 10000 });
    const pfMetrics = await page.evaluate(() => {
      const founding = document.querySelector('.ph-founding');
      const mark = document.querySelector('.pf-mark');
      const txt = document.querySelector('.pf-txt');
      const iEl = document.querySelector('.pf-txt i');
      const csF = getComputedStyle(founding);
      const contentW = founding.clientWidth - parseFloat(csF.paddingLeft) - parseFloat(csF.paddingRight);
      const gap = parseFloat(csF.columnGap || csF.gap) || 10;
      const markW = mark.getBoundingClientRect().width;
      const txtW = txt.getBoundingClientRect().width;
      return { contentW, markW, txtW, remainingSpace: contentW - markW - gap, iLines: iEl ? Array.from(iEl.getClientRects()).length : -1 };
    });
    const wkAt375 = webkitPfMetrics[375];
    const widthDiff = Math.abs(pfMetrics.txtW - wkAt375.txtW);
    ok(`G5.control(375).pf-txt 實測寬度跨引擎一致(誤差≤5px)`,
      widthDiff <= 5, `chromium=${pfMetrics.txtW} webkit=${wkAt375.txtW} diff=${widthDiff.toFixed(2)}px`);
    ok(`G5.control(375).pf-txt 副標換行數跨引擎一致`,
      pfMetrics.iLines === wkAt375.iLines, `chromium iLines=${pfMetrics.iLines} webkit iLines=${wkAt375.iLines}`);
    ok('G5.control 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await crCheck.close();

  await wk.close();
} catch (e) {
  ok('G5 webkit 手機路徑全項', false, 'webkit 啟動或執行失敗:' + String(e).slice(0, 300));
}

// ═══════ Group 6:寫入鏈路 customerInfo → foundingFrom() → p.founding → 徽章 真的被走過 ═══════
// 為什麼非有這組不可(複審用突變證明過,不是推測):把三個
// `p.founding = p.active && foundingFrom(info);`(plusRefresh/plusPurchase/plusRestore)**全部刪光**,
// 前面 95 條裡只有 G4.2 會紅——而 G4.2 是原始碼文字 regex,只證明「字串還在」,不證明「值會被填對」。
// 原因是 G1/G2/G5 全部用 page.evaluate 手動塞 state.plus 再叫渲染器,驗的是「渲染器拿到
// founding:true 會不會畫」;G0 只驗純函式(輸入是手寫 fixture)。「誰把 founding 填進去」這一段
// 從來沒有行為斷言。渲染器再對,鏈路斷掉一樣是所有創始會員都拿不到徽章、而驗收全綠。
//
// 做法用 repo 既有慣例 window.RAIL_PLUS_TEST_ADAPTER(index.html:7163 的 plusAdapterFor 短路;
// verify_plus_subscription.mjs:108、verify_sat_retina.mjs:192、verify_delay_history_ui.mjs:94
// 三支既有腳本都這樣用),注入帶 originalPurchaseDate 的假 customerInfo,然後呼叫**真正的**
// plusRefresh()/plusPurchase()/plusRestore(),斷言 state.plus.founding 真的被填成 true/false,
// 並一路驗到徽章有沒有出現在護照上(端到端,不是只看欄位)。
//
// 哨兵(SENTINEL):每次呼叫前把 state.plus.founding 設成字串 'UNWRITTEN',斷言一律用 ===true /
// ===false 嚴格比對。這樣「沒有被寫入」與「寫成 false」是兩個可分辨的結果——刪掉任一個寫入點,
// 對應的那組斷言必然翻紅(哨兵留著,true 與 false 兩種期望值都對不上),而不是靠某個值恰好相同蒙混。
// PLUS_ENABLED 在網站端只認 ?plus=1(index.html:6055),沒有它 plusConfigured() 恆假、plusRefresh
// 會走 /api/plus-status 早退分支根本到不了寫入點——所以這組一律帶 query 開站,並用 G6.0 把這個
// 前置條件變成一條會紅的斷言,不讓它默默失效(前置條件不成立時的「全綠」是最貴的假綠)。
{
  const cr = await chromium.launch();
  const SENTINEL = 'UNWRITTEN';
  const DAY = 86400000;

  // days<0 = 截止日前開始訂閱(創始會員);days>0 = 截止日後(不是創始會員)
  // vp 只換視窗尺寸/觸控,不改注入內容——6C 要的是「同一條真鏈路換一個容器」,鏈路本身必須一模一樣。
  async function plusPage(days, vp = {}) {
    const { ctx, page, errors } = await boot(cr, { width: 1280, height: 2200, ...vp, query: '?plus=1' });
    await page.evaluate(() => { try { localStorage.setItem('trainmap-passport-open', '1'); } catch (e) {} });
    await page.evaluate((d) => {
      const iso = new Date(FOUNDING_UNTIL_MS + d * 86400000).toISOString();
      window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
      // 形狀照 RevenueCat customerInfo:entitlements.active[entitlement].originalPurchaseDate 是
      // ISO8601 字串(App/Capacitor 路徑,型別宣告已查證)。價格用非真實佔位值——repo 公開,定價不進版控。
      const info = () => ({
        entitlements: { active: { plus: { identifier: 'plus', originalPurchaseDate: iso } } },
        managementURL: 'https://example.invalid/manage',
      });
      const offering = { availablePackages: [
        { identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: 'STUB-MONTH' } } },
        { identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: 'STUB-YEAR' } } },
      ] };
      // 每一支的回傳形狀都對著它在 app/src/native-bridge.mjs 的真身,不是「差不多就好」——
      // fixture 與真身形狀不符時,產品碼裡為了吃真身而寫的正規化就沒有東西在守它,刪掉也全綠
      // (N-2 實測過)。三支逐一對照(型別宣告 @revenuecat/purchases-capacitor definitions.d.ts):
      //   getCustomerInfo → native-bridge 有 unwrap() ⇒ **裸** CustomerInfo(SDK 原回 {customerInfo})
      //   getOfferings    → PurchasesOfferings = { all, current }
      //   purchase        → purchasePackage() ⇒ MakePurchaseResult(含 customerInfo)
      //   restore         → restorePurchases() ⇒ **{ customerInfo }**(definitions.d.ts:348-350)
      // 這樣 plusPurchase()/plusRestore() 的 `result.customerInfo || result` 兩個分支各自被覆蓋到:
      // 裸的那支走 `|| result`,包起來的兩支走 `.customerInfo`——正規化行變成承重的,刪掉會翻紅。
      window.RAIL_PLUS_TEST_ADAPTER = {
        calls: { getCustomerInfo: 0, getOfferings: 0, purchase: 0, restore: 0 },
        purchaseDate: iso,
        setUser: async () => {},
        getCustomerInfo: async function () { this.calls.getCustomerInfo++; return info(); },
        getOfferings: async function () { this.calls.getOfferings++; return { all: { plus: offering }, current: offering }; },
        purchase: async function () { this.calls.purchase++; return { customerInfo: info() }; },
        restore: async function () { this.calls.restore++; return { customerInfo: info() }; },
      };
      state.plus = null;
      state.account = { ready: true, user: { uid: 'founding-test-uid', email: 'tester@example.com', displayName: '測試員' }, syncing: false, lastSync: 0, actionError: '', error: '' };
      plusState();
    }, days);
    return { ctx, page, errors };
  }

  // 呼叫真正的寫入函式,前後夾哨兵。回傳的 wrote 表示「這一次呼叫真的動過 p.founding」。
  async function callWriter(page, which, sentinel) {
    return page.evaluate(async ({ which, sentinel }) => {
      state.plus.founding = sentinel;
      if (which === 'refresh') await plusRefresh();
      else if (which === 'purchase') await plusPurchase('annual');
      else if (which === 'restore') await plusRestore();
      const f = state.plus.founding;
      return {
        active: state.plus.active, founding: f, wrote: f !== sentinel,
        error: state.plus.error || '',
        calls: JSON.parse(JSON.stringify(window.RAIL_PLUS_TEST_ADAPTER.calls)),
      };
    }, { which, sentinel });
  }

  const readSeal = page => page.evaluate(() => {
    renderPassport();
    const el = document.querySelector('#passport .ph-founding');
    const r = el && el.getBoundingClientRect();
    return {
      exists: !!el,
      display: el ? getComputedStyle(el).display : null,
      area: r ? Math.round(r.width) * Math.round(r.height) : 0,
      passportHidden: document.getElementById('passport').hidden,
    };
  });

  // ── 6A:截止日前一天開始訂閱 → 是創始會員 ──
  {
    const { ctx, page, errors } = await plusPage(-1);
    const pre = await page.evaluate(() => ({ enabled: PLUS_ENABLED, configured: plusConfigured(), founding: state.plus.founding }));
    ok('G6.0 前置條件:?plus=1 讓 PLUS_ENABLED 為真、plusConfigured() 成立(否則 plusRefresh 走 /api/plus-status 早退分支,三個寫入點一個都到不了)',
      pre.enabled === true && pre.configured === true && pre.founding === false,
      `PLUS_ENABLED=${pre.enabled} plusConfigured=${pre.configured} plusState() 初始 founding=${JSON.stringify(pre.founding)}`);

    const r1 = await callWriter(page, 'refresh', SENTINEL);
    ok('G6.1 真呼叫 plusRefresh()(截止日前訂閱)→ state.plus.founding 被寫成 true',
      r1.active === true && r1.founding === true,
      `active=${r1.active} founding=${JSON.stringify(r1.founding)} wrote=${r1.wrote} calls=${JSON.stringify(r1.calls)} err=${r1.error}`);

    const seal1 = await readSeal(page);
    ok('G6.2 端到端:上一步之後 renderPassport() 畫得出徽章(customerInfo → foundingFrom → p.founding → .ph-founding 全鏈路,不是手動塞 state)',
      seal1.exists === true && seal1.display !== 'none' && seal1.area > 0 && seal1.passportHidden === false,
      JSON.stringify(seal1));

    const r2 = await callWriter(page, 'purchase', SENTINEL);
    ok('G6.3 真呼叫 plusPurchase(\'annual\')→ state.plus.founding 被寫成 true(呼叫前已重設哨兵,不吃 plusRefresh 的殘留值)',
      r2.active === true && r2.founding === true && r2.calls.purchase === 1,
      `active=${r2.active} founding=${JSON.stringify(r2.founding)} wrote=${r2.wrote} calls=${JSON.stringify(r2.calls)} err=${r2.error}`);

    const r3 = await callWriter(page, 'restore', SENTINEL);
    ok('G6.4 真呼叫 plusRestore()→ state.plus.founding 被寫成 true(呼叫前已重設哨兵)',
      r3.active === true && r3.founding === true && r3.calls.restore === 1,
      `active=${r3.active} founding=${JSON.stringify(r3.founding)} wrote=${r3.wrote} calls=${JSON.stringify(r3.calls)} err=${r3.error}`);

    // ── 登出路徑與渲染守門(N-1)──
    // 這兩處在第 3 輪修好但零斷言:整個修回去,108/108 照樣全綠。刻意拆成兩條,因為兩處會**互相遮蔽**,
    // 合成一條就會有一半沒牙:
    //   ‧ 登出清理少清 founding 時,buildFoundingSeal() 的 active 守門仍會擋下徽章
    //     ⇒ 畫面上看不出來,只有直接讀欄位才抓得到 ⇒ G6.9 斷言欄位值。
    //   ‧ 反過來守門被拿掉時,founding 早就被清成 false ⇒ 欄位與畫面都正常 ⇒ 要另外造出
    //     active:false + founding:true 這個「只有壞掉的寫入點才生得出來」的狀態去打它 ⇒ G6.10。
    // 前一條剛好是後一條的前置:先登出(狀態已是 active:false),再手動把 founding 掰回 true。
    const cleared = await page.evaluate(() => {
      accountEndSession(); // 內含 renderPassport(),登出當下的畫面就是這裡讀到的畫面(2026-08-04 複審輪2 前叫 accountClearLocal)
      return { active: state.plus.active, founding: state.plus.founding };
    });
    const sealCleared = await readSeal(page);
    ok('G6.9 登出(accountEndSession())把 state.plus.founding 一起清成 false,護照上的徽章當場消失(active 與 founding 是兩個欄位;只清 active 會留下「已登出卻還掛著創始徽章」的畫面)',
      cleared.active === false && cleared.founding === false && sealCleared.exists === false && sealCleared.passportHidden === false,
      `active=${JSON.stringify(cleared.active)} founding=${JSON.stringify(cleared.founding)} seal=${JSON.stringify(sealCleared)}`);

    const sealStale = await page.evaluate(() => {
      state.plus.founding = true; // 只有「寫入點漏清 founding」才生得出來的殘留態
      renderPassport();
      const el = document.querySelector('#passport .ph-founding');
      return { active: state.plus.active, founding: state.plus.founding, exists: !!el, passportHidden: document.getElementById('passport').hidden };
    });
    ok('G6.10 殘留態 active:false + founding:true(寫入點漏清時的樣子)→ buildFoundingSeal() 的 active 守門擋下,護照不畫徽章(不變式的第二道防線:不依賴每個寫入點都記得同步兩個欄位)',
      sealStale.active === false && sealStale.founding === true && sealStale.exists === false && sealStale.passportHidden === false,
      JSON.stringify(sealStale));

    ok('G6A 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── 6B:截止日後一天才開始訂閱 → 不是創始會員(擋「無條件寫 true」的實作) ──
  {
    const { ctx, page, errors } = await plusPage(+1);
    const r1 = await callWriter(page, 'refresh', SENTINEL);
    ok('G6.5 真呼叫 plusRefresh()(截止日後訂閱)→ active 仍為 true,但 founding 被寫成 false(不是哨兵殘留)',
      r1.active === true && r1.founding === false && r1.wrote === true,
      `active=${r1.active} founding=${JSON.stringify(r1.founding)} wrote=${r1.wrote} calls=${JSON.stringify(r1.calls)} err=${r1.error}`);

    const seal1 = await readSeal(page);
    ok('G6.6 端到端:上一步之後 renderPassport() 不畫徽章(非創始會員不得誤發)',
      seal1.exists === false && seal1.passportHidden === false, JSON.stringify(seal1));

    const r2 = await callWriter(page, 'purchase', SENTINEL);
    ok('G6.7 真呼叫 plusPurchase(\'annual\')(截止日後)→ founding 被寫成 false(wrote=true 才算數,否則是寫入點被刪掉)',
      r2.active === true && r2.founding === false && r2.wrote === true && r2.calls.purchase === 1,
      `active=${r2.active} founding=${JSON.stringify(r2.founding)} wrote=${r2.wrote} calls=${JSON.stringify(r2.calls)} err=${r2.error}`);

    const r3 = await callWriter(page, 'restore', SENTINEL);
    ok('G6.8 真呼叫 plusRestore()(截止日後)→ founding 被寫成 false(wrote=true 才算數)',
      r3.active === true && r3.founding === false && r3.wrote === true && r3.calls.restore === 1,
      `active=${r3.active} founding=${JSON.stringify(r3.founding)} wrote=${r3.wrote} calls=${JSON.stringify(r3.calls)} err=${r3.error}`);

    ok('G6B 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── 6C:同一條真鏈路,換成 App 使用者真正看得到的容器(#ridePanel)(N-4)──
  // 6A/6B 的端到端收尾查的是 #passport,而同一支腳本的 G2.*.2 自己就斷言了「#passport 在 body.fs 下
  // display:none」——也就是那兩條「全鏈路」驗的正是 App 使用者看不到的那顆容器。這個功能的唯一受眾
  // 是 App(WKWebView、≤900px)。G2/G5 驗過手機容器但用的是**手動塞 state**;兩半都有,缺的就是
  // 「真 customerInfo 鏈路 × 手機容器」這個交集,補這一條。
  // 面板刻意不再手動 renderRidePanel():點開當下就該有徽章,要靠補一次重繪才出現本身就是缺陷。
  // passportDisplay==='none' 是這條的正向對照——它同時證明「我們真的在手機殼裡」,
  // 否則視窗設定哪天失效,這條會退化成又一條桌面斷言而恆綠。
  {
    const { ctx, page, errors } = await plusPage(-1, { width: 375, height: 812, touch: true });
    const fsOn = await page.evaluate(() => document.body.classList.contains('fs'));
    const r1 = await callWriter(page, 'refresh', SENTINEL);
    await page.click('#tabRide');
    await page.waitForFunction(() => document.getElementById('ridePanel').hidden === false, null, { timeout: 10000 });
    const seal = await page.evaluate(() => {
      const el = document.querySelector('#ridePanel .ph-founding');
      const r = el && el.getBoundingClientRect();
      return {
        exists: !!el,
        display: el ? getComputedStyle(el).display : null,
        area: r ? Math.round(r.width) * Math.round(r.height) : 0,
        panelHidden: document.getElementById('ridePanel').hidden,
        passportDisplay: getComputedStyle(document.getElementById('passport')).display,
      };
    });
    ok('G6.11 端到端 × 手機 App 殼:375 觸控寬真呼叫 plusRefresh() 後點 #tabRide,徽章直接出現在使用者真正看得到的 #ridePanel(#passport 在 body.fs 下 display:none,6A 的收尾照不到這裡)',
      fsOn === true && r1.active === true && r1.founding === true
      && seal.exists === true && seal.display !== 'none' && seal.area > 0
      && seal.panelHidden === false && seal.passportDisplay === 'none',
      `fs=${fsOn} active=${r1.active} founding=${JSON.stringify(r1.founding)} ${JSON.stringify(seal)}`);

    ok('G6C 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await cr.close();
}

// ═══════════════ Group 7:foundingLaunchAt 未設定(revenuecat-config.js 現況)→ 安全預設,
// 不得誤判成「沒設定＝人人都是創始會員」(B-4,2026-08-03 裁示第 4 條)═══════════════
// 用 boot() 的 foundingLaunchAt:null 明確模擬「這個欄位是 null」,不依賴/不斷言正式站
// revenuecat-config.js 現在真的長怎樣——那件事本身會隨發版流程改變,不該是這組測試通不通過
// 的前提(該檔現在確實是 null,見其註解,但這裡故意不用「讀真實檔案」的方式驗證這件事,
// 一律走 boot() 的明確覆寫,兩者脫鉤)。
{
  const cr = await chromium.launch();
  const { ctx, page, errors } = await boot(cr, { foundingLaunchAt: null });
  const r = await page.evaluate(() => {
    const info = t => ({ entitlements: { active: { plus: { originalPurchaseDate: t } } } });
    return {
      configValue: plusConfig().foundingLaunchAt,
      untilMs: (() => { try { return FOUNDING_UNTIL_MS; } catch (e) { return 'threw:' + String(e); } })(),
      epoch: foundingFrom(info(new Date(0).toISOString())), // 1970 年購買——理論上最早、最該判定為創始會員的輸入,仍必須是 false
      justNow: foundingFrom(info(new Date().toISOString())),
      noThrow: (() => { try { foundingFrom(info(new Date().toISOString())); return true; } catch (e) { return false; } })(),
    };
  });
  ok('G7.0 前置條件:注入的 revenuecat-config.js 確實不含 foundingLaunchAt(讀到 null),不是巧合通過',
    r.configValue === null, JSON.stringify(r));
  ok('G7.1 未設定 ⇒ FOUNDING_UNTIL_MS 為 NaN(不落地一個猜的日期當退路)', Number.isNaN(r.untilMs), JSON.stringify(r));
  ok('G7.2 未設定 ⇒ 即使購買時刻是 1970 年(理論上最早、最該算創始會員的輸入)foundingFrom() 仍回傳 false——證明是安全預設擋下所有輸入,不是巧合沒觸發到判定式',
    r.epoch === false, JSON.stringify(r));
  ok('G7.3 未設定 ⇒ 購買時刻是現在,foundingFrom() 仍回傳 false(不是只有極端輸入才安全)',
    r.justNow === false, JSON.stringify(r));
  ok('G7.4 未設定 ⇒ foundingFrom() 不丟例外(NaN 比較走的是正常回傳路徑,不是靠 catch 兜底)',
    r.noThrow === true, JSON.stringify(r));
  ok('G7 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close(); await cr.close();
}

server.close();

// ═══════════════ 斷言總數閘門(M-4) ═══════════════
// 為什麼需要:G1.7/G1.7b/G1.8/G1.9 藏在 `if (sigMatch)` 內、G5 整組包在 try 內、G2 的三發突變只在
// w===375 跑——這些區塊的前置條件一旦不成立,斷言是「整批從結果集消失」而不是「變紅」,分母悄悄
// 變小,「N/N PASS」看起來一模一樣漂亮。斷言數本身就是要被守住的東西,所以下面這張表是刻意手寫的:
// 新增/刪除斷言時必須同步改它——改不動就代表有東西沒被跑到,那正是這道閘門要攔的。
// (表不含這條閘門自己;它在把自己 push 進去之前先數,所以不會自我計數。)
const EXPECTED_COUNTS = { G0: 9, G1: 11, G2: 43, G3: 6, G4: 3, G5: 24, G6: 15, G7: 6 };
const actualCounts = {};
// `\d+`(不是 `\d`):只吃一位數的話,日後加的 G10 會被歸進 G1 ⇒ G1 被灌水,而 G1 自己少跑幾條時
// 反而不會紅——一道用來防假綠的閘門自己製造假綠。
for (const r of results) { const m = /^(G\d+)/.exec(r.name); const k = m ? m[1] : '(未分組)'; actualCounts[k] = (actualCounts[k] || 0) + 1; }
const groupKeys = [...new Set([...Object.keys(EXPECTED_COUNTS), ...Object.keys(actualCounts)])].sort();
const countMismatch = groupKeys.filter(g => (EXPECTED_COUNTS[g] || 0) !== (actualCounts[g] || 0));
ok('G9 斷言總數閘門:每組實跑條數符合預期(條件式區塊整批消失時,分母變小不會被當成全綠)',
  countMismatch.length === 0,
  countMismatch.length
    ? countMismatch.map(g => `${g}:預期 ${EXPECTED_COUNTS[g] || 0} 實跑 ${actualCounts[g] || 0}`).join(' ; ')
    : groupKeys.map(g => `${g}=${actualCounts[g]}`).join(' '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); }
writeFileSync(path.join(results_dir, 'results.json'), JSON.stringify(results, null, 2));
process.exit(fail.length ? 1 : 0);
