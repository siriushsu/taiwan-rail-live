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
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5417;
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

async function boot(browser, { width = 1280, height = 900, touch = false, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((th) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    try { localStorage.setItem('trainmap-appearance', th); } catch (e) {}
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console:' + m.text()); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
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
  const expected = Date.parse('2026-09-15T00:00:00+08:00');
  ok('G0.0 FOUNDING_UNTIL_MS 可讀取且等於 brief 給的值(2026-09-15 台北 00:00)', untilMs === expected, `讀到=${untilMs} 期望=${expected}`);

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
    const uniformShift = shiftVals.length ? Math.max(...shiftVals) - Math.min(...shiftVals) <= 2 : true;
    const medianShift = shiftVals.length ? shiftVals.slice().sort((a,b)=>a-b)[Math.floor(shiftVals.length/2)] : 0;
    const badVert = bodyDeltas.filter(d => Math.abs(d.dyTop - medianShift) > 2);
    ok('G1.8 對照組:.ph-body 內所有子孫元素統一位移同一個量(無非預期跳動——不是各元素各移各的)',
      uniformShift,
      uniformShift ? `n=${bodyDeltas.length} 皆位移≈${medianShift.toFixed(1)}px(徽章自身高度+collapse 後的間距)` :
        `位移量不一致,不符:` + badVert.slice(0,5).map(d => `${d.sig} dy=${d.dyTop.toFixed(1)}`).join(' ; ') + ` (中位數=${medianShift.toFixed(1)})`);
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
    ok(`G2.${w}.8 窮舉 #ridePanel 內所有 position≠static 元素兩兩相交測試,徽章插入沒有製造新重疊(對照 founding:false)`,
      newOverlaps.length === 0,
      newOverlaps.length ? newOverlaps.join(' ; ') : `founding:true 共 ${posTrue.length} 個定位元素(含既有相交 ${overlapsTrue.size} 組)、founding:false 共 ${posFalse.length} 個,新增相交=0`);

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
      bColor: get(b, 'color'), iColor: get(i, 'color'),
    };
  });
  function parseRgb(s) { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; }
  function relLum([r, g, b]) { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; const [R, G, B] = [f(r), f(g), f(b)]; return 0.2126 * R + 0.7152 * G + 0.0722 * B; }
  function contrast(c1, c2) { const L1 = relLum(c1), L2 = relLum(c2); const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1]; return (hi + 0.05) / (lo + 0.05); }
  const markContrast = contrast(parseRgb(colors.markColor), parseRgb(colors.markBg));
  const bContrast = contrast(parseRgb(colors.bColor), parseRgb(colors.foundingBg));
  const iContrast = contrast(parseRgb(colors.iColor), parseRgb(colors.foundingBg));
  const stageOnPaper = contrast(parseRgb(colors.foundingBg), parseRgb(colors.passportBg)); // 視覺分層對比(非文字)
  ok('G3.1 暗色 .pf-mark 文字(--paper)對底色(--gold)對比比',
    markContrast >= 4.5, `ratio=${markContrast.toFixed(2)}:1 (WCAG AA 文字門檻 4.5:1) colors=${colors.markColor} on ${colors.markBg}`);
  ok('G3.2 暗色「創始會員」標題(--ink-strong)對底色(--bg-stage)對比比',
    bContrast >= 4.5, `ratio=${bContrast.toFixed(2)}:1 colors=${colors.bColor} on ${colors.foundingBg}`);
  ok('G3.3 暗色副標(--faint)對底色(--bg-stage)對比比(資訊性參考,非強制 4.5)',
    true, `ratio=${iContrast.toFixed(2)}:1 colors=${colors.iColor} on ${colors.foundingBg}`);
  ok('G3.4 暗色徽章底(--bg-stage)與護照底(--paper)有可視分層(非純文字對比,資訊性參考)',
    true, `ratio=${stageOnPaper.toFixed(2)}:1 colors=${colors.foundingBg} vs ${colors.passportBg}`);

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
  const apiStatusBranch = html.slice(refreshStart, refreshBranchEnd);
  ok('G4.1 /api/plus-status 分支(無 info 那條)沒有被加上 foundingFrom(brief 明確禁止,那裡沒 info 可傳)',
    !/foundingFrom/.test(apiStatusBranch), apiStatusBranch.includes('foundingFrom') ? '出現在不該出現的地方' : '乾淨');
  const restoreStart = html.indexOf('async function plusRestore()');
  const restoreEnd = html.indexOf('async function plusRequire(');
  const restoreBody = html.slice(restoreStart, restoreEnd);
  // 裁示二:plusRestore() 補齊第 3 個同形寫入點。用較嚴格的 regex(要求形狀與另兩處一致,
  // 不是隨便找到一個 `p.founding =` 就算數)——tighten 到「= p.active && foundingFrom(info)」。
  const restoreHasFounding = /p\.founding\s*=\s*p\.active\s*&&\s*foundingFrom\(info\)/.test(restoreBody);
  ok('G4.2 plusRestore() 現在也寫入 p.founding(裁示二補齊的第 3 個同形寫入點,形狀與 plusRefresh/plusPurchase 一致)',
    restoreHasFounding, restoreHasFounding ? '有' : '沒有(裁示二應已補上,見 index.html plusRestore() 內)');
}

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); }
writeFileSync(path.join(results_dir, 'results.json'), JSON.stringify(results, null, 2));
process.exit(fail.length ? 1 : 0);
