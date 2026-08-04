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
// 埠位可用 PORT env 覆寫(這台機器 30+ worktree 並行,硬編埠位會撞到別的 session——
// 獨立驗收期間就實際撞過一次 `EADDRINUSE :::5195`,整輪白跑)。比照 verify_account_sync_race.mjs。
const WORK_PORT = Number(process.env.PORT || 5195), HEAD_PORT = WORK_PORT + 1;
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
        const tod = rectOf('.tod-wrap'), sr = rectOf('.speedrail'), tr = rectOf('.timerail');
        const out = { tod, sr, tr };
        // 讀數區:不只問「命中誰」,還要問那顆命中的東西**當下是不是真的可用**——
        // 只比對 id 的話,把 #todPick 加上 disabled(原生選時器再也打不開)仍會命中同一個 id 而全綠。
        if (tod) {
          const el = document.elementFromPoint(tod.x + tod.w / 2, tod.y + tod.h / 2);
          out.todCenter = el ? { id: el.id || null, tag: el.tagName.toLowerCase(), disabled: !!el.disabled, pe: getComputedStyle(el).pointerEvents } : null;
        }
        if (sr) { const cx = sr.x + sr.w / 2, cy = sr.y + sr.h / 2; out.srHits = { center: hit(cx, cy, '.speedrail'), up: hit(cx, cy - 21, '.speedrail'), down: hit(cx, cy + 21, '.speedrail') }; }
        return out;
      });
      // 🔴 熱區用**真的拖一次**來驗,不用 elementFromPoint 取樣:`.tod-wrap` 是 `.timerail` 的子孫,
      // 三點命中測試對「整列可拖」這件事恆真(中心那兩點其實落在讀數區,而產品刻意把讀數排除在拖曳之外),
      // 於是把拖曳守衛整個拿掉、尺完全拖不動時,取樣式判準照樣全綠(獨立驗收實測)。
      // 改成在 44px 帶的**上下緣各拖一次**:同時驗到「帶真的有 44 高」與「整條帶真的都能拖」。
      // x 取在讀數區之外(產品的 pointerdown 守衛會跳過 .tod-wrap),取樣點失效時 A6a 必須轉紅而不是默默通過。
      // 取樣點沿帶**橫掃**(每 STEP px 一發)× 上下緣兩個 y,不是只取兩端:只取端點的話,「中間一整片
      // 死區、只有最外緣拖得動」仍會全綠(獨立驗收實測:`if (e.clientX>45 && e.clientX<270) return;`
      // 讓 ~170px 拖不動,四角版仍 71/71)。橫掃把「測不到的死區」上限壓到 STEP,並把這個上限講明。
      // 落在 `.tod-wrap` 內的取樣點要跳過——讀數區是產品刻意排除拖曳的區域(index.html 的 pointerdown 守衛),
      // 所以這條斷言講的是「讀數區以外沿帶每 ≤STEP px 都能拖」,不是字面上的每一個像素。
      const trR = snap2.tr, todR = snap2.tod;
      const STEP = 40, DRAG_PX = 6, EXPECT_SEC = DRAG_PX * 60; // 產品規格:時刻尺「左右拖 1px=1 分鐘」(index.html 該 IIFE 的開頭註解)
      const outsideTod = (x) => !!(todR && (x < todR.x - 2 || x > todR.x + todR.w + 2));
      const xs = [];
      if (trR) for (let x = trR.x + 8; x <= trR.x + trR.w - 8; x += STEP) if (outsideTod(x)) xs.push(Math.round(x));
      const dragProbe = async (x, yOff, tag) => {
        if (!trR) return null;
        const y = trR.y + yOff;
        const before = await page.evaluate(() => ({ sec: state.simSec, cexp: document.body.classList.contains('cexp') }));
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + DRAG_PX, y, { steps: 3 });
        await page.mouse.up();
        const after = await page.evaluate(() => state.simSec);
        // 不只問「有沒有動」,還要問「動的量對不對」:單位寫錯(1px 當 1 小時)時尺完全不能用,
        // 但 moved 仍是 true(獨立驗收實測:`dMin*3600` 讓 delta=21600,四角版仍 71/71)。
        return { tag, x, y, cexpBefore: before.cexp, moved: after !== before.sec, delta: after - before.sec, deltaOk: Math.abs((after - before.sec) - EXPECT_SEC) <= 1 };
      };
      const drags = [];
      for (const [yOff, lab] of [[3, '上緣'], [trR ? trR.h - 3 : 0, '下緣']]) {
        for (const x of xs) drags.push(await dragProbe(x, yOff, `${lab}@x${x}`));
      }
      // 取樣本身也要有下限:版面一變、xs 縮到剩一兩點時,上面的「全部都能拖」會變成很弱的宣稱而不自知。
      const sweepOk = !!(trR && xs.length >= Math.floor((trR.w - (todR ? todR.w : 0) - 16) / STEP));
      // 🔴 2026-08-05 判準改綁「誰承載這個觸控目標」。原判準量 `.tod-wrap` 自己的 ±21 命中,那是 v0718i
      // (讀數 opacity:0 的 time input 撐成 44px)的形狀;2026-07-25 手機版面重整(63fb861)導入時刻尺後,
      // index.html 明文把展開態的讀數命中框收回原尺寸——「否則 44px 命中框會蓋住刻度尺讓它拖不動」,
      // 而 ≥44 的觸控目標改由整列可拖的 `.timerail` 承擔(body.cexp .timerail{height:44px})。
      // 也就是說原判準測的是一個**已被刻意換掉的實作細節**,不是使用者拿得到什麼。
      // 44 是外部常數(觸控目標下限),不是從當下實測抄回來的數字;承載者則實地量兩引擎皆 h=44、
      // 中心與 ±21 三點全命中。第二條補回「讀數本身仍打得開原生選時器」——這是舊判準的 center 命中
      // 隱含涵蓋、但只驗到 `.tod-wrap` 這個容器的部分,改成驗命中的**身分**是 #todPick,強度更高。
      ok(`${engName} A6a 展開態時刻控制熱區≥44(讀數區以外沿帶每≤${STEP}px×上下緣各拖一次,都要真的改變時間且改對量:拖${DRAG_PX}px=${EXPECT_SEC}秒)`,
        !!(trR && trR.h >= 44 && sweepOk && drags.length > 0 && drags.every(d => d && d.cexpBefore === true && d.moved === true && d.deltaOk === true)),
        JSON.stringify({ tr: trR, sweepOk, probes: xs.length, bad: drags.filter(d => !d || !d.cexpBefore || !d.moved || !d.deltaOk).slice(0, 4), sample: drags[0] }));
      ok(`${engName} A6a2 展開態讀數區仍打得開原生選時器(點中心命中 #todPick,且它當下真的可用:未 disabled、pointer-events 沒被關掉)`,
        !!(snap2.todCenter && snap2.todCenter.id === 'todPick' && snap2.todCenter.disabled === false && snap2.todCenter.pe !== 'none'),
        JSON.stringify({ tod: snap2.tod, center: snap2.todCenter }));
      ok(`${engName} A6b 展開態速度滑桿熱區≥44`, !!(snap2.sr && snap2.srHits && Object.values(snap2.srHits).every(Boolean)), snap2.sr ? JSON.stringify({ sr: snap2.sr, hits: snap2.srHits }) : '.speedrail 不存在');
    } else {
      ok(`${engName} A6a 展開態時刻控制熱區≥44(讀數區以外沿帶橫掃×上下緣各拖一次,都要真的改變時間且改對量)`, false, '膠囊未成功展開,略過');
      ok(`${engName} A6a2 展開態讀數區仍打得開原生選時器(點中心命中 #todPick,且它當下真的可用:未 disabled、pointer-events 沒被關掉)`, false, '膠囊未成功展開,略過');
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

  // 🔴 2026-08-05 環境條件:衛星鈕(工具列 #satBtn 與抽屜 .ms-row[data-proxy="satBtn"])在 boot 時
  // fetch('/api/basemap-token'),要不到 esri token 就**把兩者整顆 remove**(index.html 的 .catch)。
  // 本機沒有 Worker、靜態伺服器對 /api/ 一律回 {},於是 HEAD 與工作樹兩側同時少掉這顆鈕——
  // 下面的 rect 比對就永遠拿不到 msSat。給一顆假 token 讓它存在,這一格才真的被比對到
  // (預設底圖是 map,不會有任何衛星圖磚請求送出去,假 token 不會外連)。
  const routeBasemapToken = (page) => page.route('**/api/basemap-token', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ esri: 'VERIFY_FAKE_TOKEN' }) }));

  // 🔴 2026-08-05 量 rect 之前先把時鐘釘死(心得 31:跨 build 比幾何前要把所有即時狀態釘死)。
  // `#todOut` 是即時時刻讀數,而它的**數字寬度**會餵進 `.tod-wrap` 與 `.controls` 的寬:窮舉 1440 個分鐘
  // 量相鄰分鐘的 `.controls` 寬變化,WebKit 有 44.2%(chromium 23.9%)超過本檔 1px 的容差,最大 2.6px。
  // HEAD 與 WORK 是**先後兩次擷取**(相隔十幾秒),跨過分鐘邊界就會冒出
  // `controls:Δw=1.1 ; todWrap:Δw=1.1` 這種與改動無關的假紅(獨立驗收實測重現)。
  // `clockAtNow` 必須先清掉再撥(專案既有鐵則:任何直接改時間都要同時清它),否則下一個 tick 會把讀數
  // 寫回真實時間,等於沒釘。
  const pinClock = (page) => page.evaluate(() => {
    try { state.clockAtNow = false; setSimSec(8 * 3600); } catch (e) {}
  });

  async function captureState(url, tag) {
    const out = {};
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
      await ctx.addInitScript(seedInit(), false);
      const page = await ctx.newPage();
      await routeBasemapToken(page);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await pinClock(page);
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
      await routeBasemapToken(page);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await pinClock(page);
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
  const diffs = [], bothAbsent = [];
  for (const k of Object.keys(headOut)) {
    const a = headOut[k], b = workOut[k];
    // 🔴 2026-08-05:「兩邊一致地不存在」不是視覺變化——本檔量的是 HEAD 與工作樹的**差異**,
    // 一個元素在兩側同樣不存在時,它對這個問題的答案是「沒變」。原本 `if (!a || !b)` 把它算成差異,
    // 於是任何因環境(缺 token／缺後端)而在兩側同時消失的元素都會讓 D1 恆紅,而那與本次改動無關。
    // 但不可以靜默跳過:兩邊都沒有代表這一格**沒被比對到**(覆蓋率損失),具名列出來讓人看得到。
    if (!a && !b) { bothAbsent.push(k); continue; }
    if (!a || !b) { diffs.push(`${k}:單邊缺失(head=${!!a},work=${!!b})——這才是真的變了`); continue; }
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), dw = Math.abs(a.w - b.w), dh = Math.abs(a.h - b.h);
    if (dx > 1 || dy > 1 || dw > 1 || dh > 1) diffs.push(`${k}:Δx=${dx.toFixed(1)},Δy=${dy.toFixed(1)},Δw=${dw.toFixed(1)},Δh=${dh.toFixed(1)}`);
  }
  const total = Object.keys(headOut).length, cmp = total - bothAbsent.length;
  ok(`${engName} D1 視覺零變化(HEAD vs 工作樹,佈局位移≤1px)`, diffs.length === 0,
    diffs.join(' ; ') || `比對 ${cmp}/${total} 個元素`);
  // 覆蓋率自己也要有一條具名紅燈:上面把「兩側同樣不存在」放行(那確實不是視覺變化),但它同時代表
  // **這一格根本沒被比對到**。不 gate 的話,選擇器打錯字、或某個元素因環境消失,分母會無聲地縮水而 D1 照樣綠
  // (獨立驗收實測:塞一個打錯的選擇器進清單,D1 仍 PASS、只在 detail 印 16/17)。
  ok(`${engName} D2 比對覆蓋率:每一格都真的被比對到(兩側同時不存在=沒驗到,不是沒變)`,
    bothAbsent.length === 0, bothAbsent.length ? `兩側皆不存在故未比對:${bothAbsent.join(',')}(${cmp}/${total})` : `${cmp}/${total} 全數比對`);
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
