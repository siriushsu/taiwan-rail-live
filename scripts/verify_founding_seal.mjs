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
function __rlHitTest(rootSel) {
  const root = document.querySelector(rootSel);
  const rootRect = root.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const els = __rlVisibleDescendants(rootSel);
  const report = [];
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    const ownText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    const inFounding = !!el.closest('.ph-founding');
    // .ph-body 本身的頂邊不會因為第一個子元素(徽章)被插入而移動——只有它「內部」的子孫
    // (排除它自己)才會被徽章往下推。closest() 對自己也會命中,故要排除 el===bodyAnc。
    const bodyAnc = el.closest('.ph-body');
    const bodyDescendant = !!bodyAnc && bodyAnc !== el;
    const csEl = getComputedStyle(el);
    const radiusPx = parseFloat(csEl.borderTopLeftRadius) || 0;
    const isRound = radiusPx >= Math.min(rect.width, rect.height) * 0.35 && rect.width < 60 && rect.height < 60;
    const overflowH = rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1;
    let hitFails = [];
    if (ownText) {
      const rects = Array.from(el.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
      for (const r of rects) {
        for (const [x, y] of __rlSamplePoints(r, 3, isRound)) {
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
    });
  }
  return { rootRect: [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].map(v => Math.round(v*10)/10), report };
}
window.__rlHitTest = __rlHitTest;
`;

async function injectCollector(page) { await page.addScriptTag({ content: COLLECT_SRC }); }

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

    // 使用者在手機上實際會點的「旅程護照」入口 = openRidePanel() → #ridePanel(renderRidePanel())
    const rideState = await page.evaluate(() => {
      state.plus = { active: true, founding: true };
      openRidePanel();
      const el = document.getElementById('ridePanel');
      return { hidden: el.hidden, containsBadge: !!el.querySelector('.ph-founding'), htmlHead: el.innerHTML.slice(0, 40) };
    });
    ok(`G2.${w}.3 使用者真正看得到的手機護照(#ridePanel)不含 .ph-founding`,
      rideState.hidden === false && rideState.containsBadge === false, JSON.stringify(rideState));

    // ── 補充(非驗收,供修復參考):buildFoundingSeal() 的 CSS 本身若被塞進 #ridePanel,寬度安不安全? ──
    // 這裡直接呼叫已存在的函式並手動插入 DOM(不是改原始碼),純粹回答「CSS 本身在這個寬度下有沒有問題」,
    // 與「使用者看不看得到」是兩個獨立問題,見報告。
    await page.evaluate(() => {
      document.getElementById('ridePanel').insertAdjacentHTML('afterbegin', buildFoundingSeal());
    });
    await fitViewport(page);
    const cssProbe = await page.evaluate(() => window.__rlHitTest('#ridePanel'));
    const badgeProbe = cssProbe.report.find(e => e.sig.startsWith('DIV.ph-founding|'));
    const overflowProbe = cssProbe.report.filter(e => e.sig.includes('ph-founding') || e.sig.includes('pf-')).filter(e => e.overflowH);
    const hitFailProbe = cssProbe.report.filter(e => (e.sig.includes('ph-founding') || e.sig.includes('pf-')) && e.hitFails.length);
    ok(`G2.${w}.4(補充,假設性)若手動塞進 #ridePanel:徽章存在且零水平溢出`,
      !!badgeProbe && overflowProbe.length === 0,
      `badge=${!!badgeProbe} overflow=${overflowProbe.map(e=>e.sig).join(',')}`);
    ok(`G2.${w}.5(補充,假設性)若手動塞進 #ridePanel:文字零裁切/遮蔽(多點取樣)`,
      hitFailProbe.length === 0,
      hitFailProbe.length ? hitFailProbe.map(e => e.sig + ':' + e.hitFails.join('/')).join(' ; ') : 'clean');

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
  const restoreHasFounding = /p\.founding\s*=/.test(restoreBody);
  ok('G4.2(資訊性,非 PASS/FAIL 判準)plusRestore() 是否也寫入 p.founding——brief 只要求 2 處,這是第 3 個同形寫入點',
    true, restoreHasFounding ? '有(超出 brief 範圍)' : '沒有(與 brief 字面一致;若使用者在此裝置只呼叫過 restore 從未呼叫過 refresh,徽章會延遲到下次登入才出現,見報告)');
}

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); }
writeFileSync(path.join(results_dir, 'results.json'), JSON.stringify(results, null, 2));
process.exit(fail.length ? 1 : 0);
