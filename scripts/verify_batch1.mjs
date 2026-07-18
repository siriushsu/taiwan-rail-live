// Batch 1 (v0718i) 驗證:觸控熱區(A)＋今日看板失敗態(B)＋鍵盤/旁白(C)＋視覺零變化(D)。
// Playwright 真引擎 chromium+webkit、自起本機靜態伺服器(不依賴 worker.js/D1,/api 一律 route 攔截)。
// 用法:node scripts/verify_batch1.mjs
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK_PORT = 5195, HEAD_PORT = 5196;
const WORK_URL = `http://localhost:${WORK_PORT}/`, HEAD_URL = `http://localhost:${HEAD_PORT}/`;
const SHOT_DIR = path.join(os.tmpdir(), 'railisland-verify-batch1-shots');
mkdirSync(SHOT_DIR, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// ── 伺服器 #1:工作樹(當前 index.html,即本批修正)──
function makeServer(indexOverride) {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); } // 一律由 Playwright route() 蓋過,這裡只是保底
    let fp = (indexOverride && (url.pathname === '/' || url.pathname === '/index.html'))
      ? indexOverride
      : path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!indexOverride && (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp))) { res.statusCode = 404; return res.end('nf'); }
    if (!existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
    res.end(readFileSync(fp));
  });
}

const workServer = makeServer(null);
await new Promise(r => workServer.listen(WORK_PORT, r));

// ── 伺服器 #2:git HEAD 版 index.html(視覺零變化基準;其餘資產仍吃工作樹的 data/*、firebase-config.js 等)──
const HEAD_HTML_PATH = path.join(os.tmpdir(), 'railisland-verify-batch1-head-index.html');
let headAvailable = true;
try {
  const headContent = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  writeFileSync(HEAD_HTML_PATH, headContent);
} catch (e) { headAvailable = false; console.warn('git show HEAD:index.html 失敗,略過視覺零變化檢查:', String(e).slice(0, 200)); }
const headServer = makeServer(HEAD_HTML_PATH);
if (headAvailable) await new Promise(r => headServer.listen(HEAD_PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`); };

const READY = () => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } };
async function waitReady(page) { await page.waitForFunction(READY, null, { timeout: 30000 }); }
function seedInit(seedHowto = true) {
  return (seed) => {
    try {
      localStorage.setItem('trainmap-appearance', 'light');
      if (seed) localStorage.setItem('trainmap-howto-seen', '1'); else localStorage.removeItem('trainmap-howto-seen');
    } catch (e) {}
  };
}
async function newPage(browser, { width = 1280, height = 800, touch = false, seedHowto = true, url = WORK_URL } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(seedInit(), seedHowto);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(200);
  return { ctx, page, errors };
}
async function getRect(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
}

// ══════════════════════ PART A:觸控熱區(375,collapsed/expanded)══════════════════════
// 注意:收合膠囊 5s 無互動會自動淡成 cfaint(#pp display:none),展開後也有獨立 5s 自動收回計時。
// 為避免多次 round-trip 累積耗時撞上這兩個計時器,同一狀態的幾何+命中測試一律併一次 page.evaluate 同步取完。
async function partA(browser, engName) {
  const { ctx, page, errors } = await newPage(browser, { width: 375, height: 812, touch: true, seedHowto: true });
  try {
    const snap = await page.evaluate(() => {
      const rectOf = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const hit = (x, y, sel) => { const el = document.elementFromPoint(x, y); const t = document.querySelector(sel); return !!(el && t && (el === t || t.contains(el))); };
      const pp = rectOf('#pp'), rb = rectOf('#randBtn'), cap = rectOf('.controls');
      const out = { hscroll: document.documentElement.scrollWidth - window.innerWidth, pp, rb, cap };
      if (pp) {
        const cx = pp.x + pp.w / 2, cy = pp.y + pp.h / 2;
        // 右側刻意不強制:#pp 緊鄰 #speedOut(點膠囊展開的既有行為),熱區右擴會偷走鄰居的命中——
        // 已用 z-index 分層讓真手足內容優先(diag_c3.mjs 對照 HEAD 驗證過,行為零迴歸),故右側改記錄
        // 實際命中誰(应落在 .controls 內、非死區)而非強制等於 #pp 本身。
        const rightEl = document.elementFromPoint(cx + 21, cy);
        out.ppHits = { center: hit(cx, cy, '#pp'), up: hit(cx, cy - 21, '#pp'), down: hit(cx, cy + 21, '#pp'), left: hit(cx - 21, cy, '#pp') };
        out.ppRightYieldsTo = rightEl ? (rightEl.id || rightEl.tagName) : null;
        out.ppRightInsideControls = hit(cx + 21, cy, '.controls');
      }
      if (rb) { const cx = rb.x + rb.w / 2, cy = rb.y + rb.h / 2; out.rbHits = { center: hit(cx, cy, '#randBtn'), up: hit(cx, cy - 21, '#randBtn'), down: hit(cx, cy + 21, '#randBtn') }; }
      if (cap) { const x = cap.x + cap.w - 18, cy = cap.y + cap.h / 2; out.capHits = { center: hit(x, cy, '.controls'), up: hit(x, cy - 21, '.controls'), down: hit(x, cy + 21, '.controls') }; }
      return out;
    });

    ok(`${engName} A1 375 無橫向溢出(overlay 未撐寬)`, snap.hscroll <= 1, `overflow=${snap.hscroll}px`);
    ok(`${engName} A2a #pp 收合態存在`, !!snap.pp, JSON.stringify(snap.pp));
    if (snap.ppHits) ok(`${engName} A2b #pp 熱區≥44(上下左三向+中心,收合態實框僅約24×27)`, Object.values(snap.ppHits).every(Boolean), JSON.stringify({ pp: snap.pp, hits: snap.ppHits }));
    // 右側刻意讓給 #speedOut(既有「點膠囊展開」行為),只要求命中仍落在 .controls 內(非死區),不要求是 #pp 本身
    ok(`${engName} A2c #pp 熱區右側讓給鄰居真內容(非偷走展開行為,仍落在膠囊內非死區)`, snap.ppRightInsideControls === true, `yieldsTo=${snap.ppRightYieldsTo}`);
    ok(`${engName} A3a #randBtn 收合態存在`, !!snap.rb, JSON.stringify(snap.rb));
    if (snap.rbHits) ok(`${engName} A3b #randBtn 熱區垂直≥44`, Object.values(snap.rbHits).every(Boolean), JSON.stringify({ rb: snap.rb, hits: snap.rbHits }));
    ok(`${engName} A4a 收合膠囊本體存在`, !!snap.cap, JSON.stringify(snap.cap));
    if (snap.capHits) ok(`${engName} A4b 膠囊整體熱區垂直≥44(z-index:-1 不擋子元素)`, Object.values(snap.capHits).every(Boolean), JSON.stringify({ cap: snap.cap, hits: snap.capHits }));

    // A5:行為不變(真滑鼠事件,isTrusted:true,膠囊點擊守衛才會放行)——
    // 點 #pp 新熱區邊緣(原框外)=切播放不展開;點膠囊其他處(讀數文字區)=展開不切播放
    let afterOther = null;
    if (snap.pp && snap.cap) {
      const cx = snap.pp.x + snap.pp.w / 2, edgeY = snap.pp.y + snap.pp.h / 2 - 20;
      const before = await page.evaluate(() => ({ playing: state.playing, cexp: document.body.classList.contains('cexp') }));
      await page.mouse.click(cx, edgeY);
      await page.waitForTimeout(120);
      const afterPp = await page.evaluate(() => ({ playing: state.playing, cexp: document.body.classList.contains('cexp') }));
      ok(`${engName} A5a 點#pp邊緣採樣點=切播放、不展開`, afterPp.playing !== before.playing && afterPp.cexp === false, JSON.stringify({ before, afterPp }));

      const rx = snap.cap.x + snap.cap.w - 12, ry = snap.cap.y + snap.cap.h / 2;
      await page.mouse.click(rx, ry);
      await page.waitForTimeout(200);
      afterOther = await page.evaluate(() => ({ playing: state.playing, cexp: document.body.classList.contains('cexp') }));
      ok(`${engName} A5b 點膠囊其他處=展開、不切播放`, afterOther.cexp === true && afterOther.playing === afterPp.playing, JSON.stringify(afterOther));
    } else {
      ok(`${engName} A5a 點#pp邊緣採樣點=切播放、不展開`, false, '#pp 或 .controls 不存在');
      ok(`${engName} A5b 點膠囊其他處=展開、不切播放`, false, '#pp 或 .controls 不存在');
    }

    // A6:展開態(cexp)剛觸發,又是新的獨立 5s 自動收回計時,同樣併一次 evaluate 取完
    if (afterOther && afterOther.cexp) {
      const snap2 = await page.evaluate(() => {
        const rectOf = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const hit = (x, y, sel) => { const el = document.elementFromPoint(x, y); const t = document.querySelector(sel); return !!(el && t && (el === t || t.contains(el))); };
        const tod = rectOf('.tod-wrap'), sr = rectOf('.speedrail');
        const out = { tod, sr };
        if (tod) { const cx = tod.x + tod.w / 2, cy = tod.y + tod.h / 2; out.todHits = { center: hit(cx, cy, '.tod-wrap'), up: hit(cx, cy - 21, '.tod-wrap'), down: hit(cx, cy + 21, '.tod-wrap') }; }
        if (sr) { const cx = sr.x + sr.w / 2, cy = sr.y + sr.h / 2; out.srHits = { center: hit(cx, cy, '.speedrail'), up: hit(cx, cy - 21, '.speedrail'), down: hit(cx, cy + 21, '.speedrail') }; }
        return out;
      });
      ok(`${engName} A6a 展開態時刻控制熱區≥44`, !!(snap2.tod && snap2.todHits && Object.values(snap2.todHits).every(Boolean)), snap2.tod ? JSON.stringify({ tod: snap2.tod, hits: snap2.todHits }) : '.tod-wrap 不存在');
      ok(`${engName} A6b 展開態速度滑桿熱區≥44`, !!(snap2.sr && snap2.srHits && Object.values(snap2.srHits).every(Boolean)), snap2.sr ? JSON.stringify({ sr: snap2.sr, hits: snap2.srHits }) : '.speedrail 不存在');
    } else {
      ok(`${engName} A6a 展開態時刻控制熱區≥44`, false, '膠囊未成功展開,略過');
      ok(`${engName} A6b 展開態速度滑桿熱區≥44`, false, '膠囊未成功展開,略過');
    }

    ok(`${engName} A7 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally { await ctx.close(); }
}

// ══════════════════════ PART B:今日看板失敗態/重試/上次成功更新/定位我死列 ══════════════════════
async function partB(browser, engName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(seedInit(), true);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  // 本 part 刻意用 route() 製造多次 500 來測失敗態 UI(B1/B3/B4/B6/B7),瀏覽器會自動把這類網路失敗
  // 記一筆 console error(與頁面 JS 是否正確處理無關,是瀏覽器自己的診斷雜訊)——過濾掉,只留真的例外訊號。
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console:' + m.text()); });
  try {
    await page.route('**/api/today-board', route => route.fulfill({ status: 500, body: 'err' }));
    await page.goto(WORK_URL, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(150);

    await page.click('#todayBtn');
    await page.waitForTimeout(400);
    const fail1 = await page.evaluate(() => ({
      failText: !!document.querySelector('#todayPanel .td-fail'),
      retryBtn: !!document.querySelector('#todayPanel [data-today-retry]'),
      lastOkMeta: !!document.querySelector('#todayPanel .td-fail-meta'),
    }));
    ok(`${engName} B1 首次失敗顯示失敗文字+重試鈕`, fail1.failText && fail1.retryBtn, JSON.stringify(fail1));
    ok(`${engName} B2 從未成功不顯示「上次成功更新」`, fail1.lastOkMeta === false, JSON.stringify(fail1));

    // 點重試(route 延遲後仍失敗)→ 應短暫顯示載入中文案
    await page.unroute('**/api/today-board');
    await page.route('**/api/today-board', async route => { await new Promise(r => setTimeout(r, 350)); route.fulfill({ status: 500, body: 'err' }); });
    await page.click('#todayPanel [data-today-retry]');
    await page.waitForTimeout(90);
    const loadingTxt = await page.evaluate(() => (document.querySelector('#todayPanel')?.textContent || '').includes('載入中'));
    ok(`${engName} B3 點重試立即顯示載入中文案`, loadingTxt === true, `loadingTxt=${loadingTxt}`);
    await page.waitForTimeout(500);
    const fail2 = await page.evaluate(() => !!document.querySelector('#todayPanel .td-fail'));
    ok(`${engName} B4 重試後仍失敗回到失敗態`, fail2 === true, `fail2=${fail2}`);

    // 成功一次:記錄成功時刻+板面正常
    await page.unroute('**/api/today-board');
    const mockTrains = [{ no: '1234', sta: '1000', status: 0, delay: 6, delayMax: 9, at: '2026-07-18T08:00:00+08:00' }];
    await page.route('**/api/today-board', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: mockTrains }) }));
    await page.click('#todayPanel [data-today-retry]');
    await page.waitForTimeout(400);
    const succ = await page.evaluate(() => ({ isArray: Array.isArray(state.todayBoard), lastOk: state._todayLastOkSec, rowVisible: !!document.querySelector('#todayPanel .td-row[data-no="1234"]') }));
    ok(`${engName} B5 成功後板面正常顯示+記錄成功時刻`, succ.isArray && succ.lastOk != null && succ.rowVisible, JSON.stringify(succ));
    const expectedHM = await page.evaluate(() => fmtHM(state._todayLastOkSec));

    // 人為讓 todayBoard 回到未載入態(曾成功過的前提下再次失敗),改失敗 route,重抓
    await page.unroute('**/api/today-board');
    await page.route('**/api/today-board', route => route.fulfill({ status: 500, body: 'err' }));
    // state 直改不會自動重繪(renderTodayPanel 非響應式),須手動補畫才會出現失敗態的重試鈕
    await page.evaluate(() => { state.todayBoard = null; renderTodayPanel(); });
    await page.click('#todayPanel [data-today-retry]');
    await page.waitForTimeout(400);
    const fail3 = await page.evaluate(() => ({ failText: !!document.querySelector('#todayPanel .td-fail'), metaText: document.querySelector('#todayPanel .td-fail-meta')?.textContent || '' }));
    ok(`${engName} B6 曾成功後失敗顯示「上次成功更新 HH:MM」`, fail3.failText && fail3.metaText.includes(expectedHM), JSON.stringify({ fail3, expectedHM }));

    // renderTodayEvents 失敗態+重試
    await page.unroute('**/api/today-board');
    await page.route('**/api/today-board', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: mockTrains }) }));
    await page.route('**/api/station-events**', route => route.fulfill({ status: 500, body: 'err' }));
    await page.click('#todayPanel [data-today-retry]');
    await page.waitForTimeout(400);
    await page.click('#todayPanel .td-row[data-no="1234"]');
    await page.waitForTimeout(300);
    const evFail = await page.evaluate(() => ({ fail: !!document.querySelector('#todayPanel .td-detail .td-fail'), retry: !!document.querySelector('#todayPanel [data-events-retry="1234"]') }));
    ok(`${engName} B7 逐站事件失敗顯示失敗文字+重試鈕`, evFail.fail && evFail.retry, JSON.stringify(evFail));

    await page.unroute('**/api/station-events**');
    const mockEvents = [{ at: '2026-07-18T08:05:00+08:00', sta: '1000', status: 1, delay: 3, delayMax: 3 }];
    await page.route('**/api/station-events**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: mockEvents }) }));
    await page.click('#todayPanel [data-events-retry="1234"]');
    await page.waitForTimeout(300);
    const evOk = await page.evaluate(() => !!document.querySelector('#todayPanel .td-detail .td-ev'));
    ok(`${engName} B8 逐站事件重試後成功顯示`, evOk === true, `evOk=${evOk}`);

    const locate = await page.evaluate(() => ({ row: !!document.querySelector('.ms-row[data-proxy="locateBtn"]'), btn: !!document.getElementById('locateBtn') }));
    ok(`${engName} B9 「定位我」死列與鈕一併移除`, locate.row === false && locate.btn === false, JSON.stringify(locate));

    ok(`${engName} B10 無 JS 例外`, errors.length === 0, errors.slice(0, 5).join(' | '));
  } finally { await ctx.close(); }
}

// ══════════════════════ PART C:鍵盤/旁白(更多抽屜 Tab/Enter/aria-pressed;教學彈窗 role/focus/Esc)══════════════════════
async function partC(browser, engName) {
  // C1-C4: 更多抽屜(seedHowto=true 跳過教學彈窗)
  {
    const { ctx, page, errors } = await newPage(browser, { width: 375, height: 812, touch: true, seedHowto: true });
    try {
      await page.click('#tabMore');
      await page.waitForTimeout(150);
      const sheetOpen = await page.evaluate(() => document.body.classList.contains('tools-open'));
      ok(`${engName} C1 更多抽屜開啟`, sheetOpen === true, '');

      const expected = await page.evaluate(() => Array.from(document.querySelectorAll('#moreBody .ms-row')).filter(el => {
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && el.tagName === 'BUTTON';
      }).map(el => el.dataset.proxy || el.dataset.act));
      ok(`${engName} C2 可見列已改真 button(theme 列除外)`, expected.length >= 8, JSON.stringify(expected));

      await page.evaluate(() => document.getElementById('moreClose').focus());
      const visited = new Set();
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const id = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || !el.classList || !el.classList.contains('ms-row')) return null;
          return el.dataset.proxy || el.dataset.act || null;
        });
        if (id) visited.add(id);
      }
      const missing = expected.filter(id => !visited.has(id));
      if (engName === 'chromium') {
        ok(`${engName} C3 Tab 依序走訪所有可見列`, missing.length === 0, `missing=${JSON.stringify(missing)} visited=${JSON.stringify([...visited])}`);
      } else {
        // WebKit/Safari 預設「完整鍵盤取用」關閉時,Tab 鍵序列本就跳過所有 <button>/<a>(只留文字框/清單),
        // 這是使用者可在系統偏好設定自行開啟的作業系統層級設定,不是頁面可控的缺陷、也不應該用非標準手法覆寫。
        // 已用 diag_c4.mjs 獨立確認此引擎的 Tab 序列(#citySel/#trainSearch/#map/<summary>...)完全不含按鈕,
        // 與本頁是否為 button 無關。故 WebKit 只記錄觀察、不列入 PASS/FAIL 統計(VoiceOver 有獨立導覽模型不受此設定影響)。
        console.log(`INFO ${engName} C3 (不計入統計)Tab 依預設「完整鍵盤取用」關閉不含 button,屬 macOS/Safari 平台設定非頁面缺陷 — missing=${JSON.stringify(missing)}`);
      }

      const before = await page.evaluate(() => ({ xingOn: !!state.xingOn, aria: document.querySelector('.ms-row[data-proxy="xingBtn"]')?.getAttribute('aria-pressed') }));
      await page.evaluate(() => document.querySelector('.ms-row[data-proxy="xingBtn"]').focus());
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => ({ xingOn: !!state.xingOn, aria: document.querySelector('.ms-row[data-proxy="xingBtn"]')?.getAttribute('aria-pressed') }));
      ok(`${engName} C4 Enter 觸發列動作+aria-pressed 隨狀態翻轉`, before.xingOn !== after.xingOn && after.aria === String(after.xingOn), JSON.stringify({ before, after }));

      ok(`${engName} C5 無 JS 例外(更多抽屜)`, errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }

  // C6-C9: 首訪教學彈窗(seedHowto=false)
  {
    const { ctx, page, errors } = await newPage(browser, { width: 375, height: 812, touch: true, seedHowto: false });
    try {
      await page.waitForFunction(() => { const w = document.getElementById('howtoWrap'); return w && !w.hidden; }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);

      const attrs = await page.evaluate(() => {
        const wrap = document.getElementById('howtoWrap');
        const dlg = wrap ? wrap.querySelector('.howto') : null;
        return {
          wrapHidden: wrap ? wrap.hidden : null,
          role: dlg ? dlg.getAttribute('role') : null,
          modal: dlg ? dlg.getAttribute('aria-modal') : null,
          labelledby: dlg ? dlg.getAttribute('aria-labelledby') : null,
          labelExists: dlg ? !!document.getElementById(dlg.getAttribute('aria-labelledby') || '') : false,
        };
      });
      ok(`${engName} C6 教學彈窗首訪自動顯示`, attrs.wrapHidden === false, JSON.stringify(attrs));
      ok(`${engName} C7 role=dialog/aria-modal=true/aria-labelledby 齊全`, attrs.role === 'dialog' && attrs.modal === 'true' && attrs.labelExists === true, JSON.stringify(attrs));

      const focusIn = await page.evaluate(() => { const dlg = document.querySelector('.howto'); return dlg ? dlg.contains(document.activeElement) : false; });
      ok(`${engName} C8 開啟後 focus 落在彈窗內(主要按鈕)`, focusIn === true, '');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const closed = await page.evaluate(() => ({ hidden: document.getElementById('howtoWrap').hidden, seen: (() => { try { return localStorage.getItem('trainmap-howto-seen'); } catch (e) { return null; } })() }));
      ok(`${engName} C9 Esc 關閉彈窗`, closed.hidden === true && closed.seen === '1', JSON.stringify(closed));

      ok(`${engName} C10 無 JS 例外(教學彈窗)`, errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally { await ctx.close(); }
  }
}

// ══════════════════════ PART D:視覺零變化(HEAD vs 工作樹,375/1024 關鍵狀態截圖+rect 比對)══════════════════════
// v0718m 起手機殼上限 640→900:原 768 量測點已改屬手機殼,「桌面工具列」量測改在 1024(維持原測試精神:量桌面帶版面)
async function partD(browser, engName) {
  if (!headAvailable) { ok(`${engName} D1 視覺零變化`, false, 'git show HEAD 失敗,略過'); return; }

  async function captureState(url, tag) {
    const out = {};
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
      await ctx.addInitScript(seedInit(), false);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await page.waitForFunction(() => { const w = document.getElementById('howtoWrap'); return w && !w.hidden; }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);
      out.howto = await getRect(page, '.howto');
      await page.screenshot({ path: path.join(SHOT_DIR, `${tag}_375_howto.png`) });
      await page.evaluate(() => { const b = document.getElementById('howtoSkip'); if (b) b.click(); });
      await page.waitForTimeout(150);
      // 收合膠囊 5s 無互動會自動淡成 cfaint(#pp display:none)——併一次 evaluate 同步取完 5 個 rect,
      // 避免逐一 round-trip 累積耗時撞上這個計時器(比照 partA 的作法)。
      const collapsed = await page.evaluate(() => {
        const rectOf = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        return { controls: rectOf('.controls'), pp: rectOf('#pp'), randBtn: rectOf('#randBtn'), speedOut: rectOf('#speedOut'), todWrap: rectOf('.tod-wrap') };
      });
      Object.assign(out, collapsed);
      await page.screenshot({ path: path.join(SHOT_DIR, `${tag}_375_collapsed.png`) });
      await page.click('#tabMore');
      await page.waitForTimeout(150);
      out.msSat = await getRect(page, '.ms-row[data-proxy="satBtn"]');
      out.msTrack = await getRect(page, '.ms-row[data-act="track"]');
      out.msPower = await getRect(page, '.ms-row[data-proxy="powerBtn"]');
      out.msThemeSeg = await getRect(page, '#msThemeSeg');
      out.moreSheet = await getRect(page, '.more-sheet');
      await page.screenshot({ path: path.join(SHOT_DIR, `${tag}_375_drawer.png`) });
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
      await ctx.addInitScript(seedInit(), true);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await page.waitForTimeout(200);
      out.controls1024 = await getRect(page, '.controls');
      out.stageTools1024 = await getRect(page, '.stage-tools');
      out.toolsFab1024 = await getRect(page, '#toolsFab');
      out.themeBtn1024 = await getRect(page, '#themeBtn');
      out.pp1024 = await getRect(page, '#pp');
      await page.screenshot({ path: path.join(SHOT_DIR, `${tag}_1024_toolbar.png`) });
      await ctx.close();
    }
    return out;
  }

  const headOut = await captureState(HEAD_URL, `${engName}_head`);
  const workOut = await captureState(WORK_URL, `${engName}_work`);
  const diffs = [];
  for (const k of Object.keys(headOut)) {
    const a = headOut[k], b = workOut[k];
    if (!a || !b) { diffs.push(`${k}:缺失(head=${!!a},work=${!!b})`); continue; }
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), dw = Math.abs(a.w - b.w), dh = Math.abs(a.h - b.h);
    if (dx > 1 || dy > 1 || dw > 1 || dh > 1) diffs.push(`${k}:Δx=${dx.toFixed(1)},Δy=${dy.toFixed(1)},Δw=${dw.toFixed(1)},Δh=${dh.toFixed(1)}`);
  }
  ok(`${engName} D1 視覺零變化(HEAD vs 工作樹,佈局位移≤1px)`, diffs.length === 0, diffs.join(' ; ') || `比對 ${Object.keys(headOut).length} 個元素`);
}

// ══════════════════════ 主流程 ══════════════════════
for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await engine.launch();
    console.log(`\n═══ ${engName} ═══`);
    try { await partA(browser, engName); } catch (e) { ok(`${engName} PartA 整體`, false, 'partA 例外:' + String(e).slice(0, 200)); }
    try { await partB(browser, engName); } catch (e) { ok(`${engName} PartB 整體`, false, 'partB 例外:' + String(e).slice(0, 200)); }
    try { await partC(browser, engName); } catch (e) { ok(`${engName} PartC 整體`, false, 'partC 例外:' + String(e).slice(0, 200)); }
    try { await partD(browser, engName); } catch (e) { ok(`${engName} PartD 整體`, false, 'partD 例外:' + String(e).slice(0, 200)); }
  } catch (e) {
    ok(`${engName} 全項`, false, `引擎啟動失敗:${String(e).slice(0, 150)}`);
  } finally {
    if (browser) await browser.close();
  }
}

workServer.close();
if (headAvailable) headServer.close();

const fail = results.filter(r => !r.pass);
console.log(`\n${'═'.repeat(40)}\n總計 ${results.length} 項,PASS ${results.length - fail.length},FAIL ${fail.length}`);
console.log(`截圖存於:${SHOT_DIR}`);
if (fail.length) { console.log('FAILED:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
