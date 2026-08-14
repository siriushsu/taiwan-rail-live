// 「我的車」(favPanel 新增節;通行證專屬——收藏的台鐵列車集中比較近30天準點)驗收：
// 資料邏輯(只收台鐵/沒資料優雅退化/上榜標記)／跨系統閘門突變測試／Plus 兩側(訂閱/未訂閱)／
// 空狀態(零收藏/只收藏高鐵)／真實後端資料／手機四寬度雙引擎／PLUS_ENABLED 暗啟動契約／
// 更新紀錄結構／對第一項(準點排行)零回歸(直接重跑 verify_punctual.mjs 整支)。
// 跑法：node scripts/verify_my_trains.mjs [base]   預設 base=http://127.0.0.1:8932
//
// 判準來源刻意獨立於實作(比照本 repo 既有 verify_*.mjs 慣例,特別是 verify_punctual.mjs 與
// verify_delay_history_ui.mjs 兩支——本功能是兩者的合體:排行榜的跨系統閘門突變測試手法 +
// 誤點履歷卡的 Plus teaser 測法):
//   ・跨系統閘門用突變測試證明有牙——拿掉 favTrainSys(f)==='tra_sched' 那道條件,同一份測試必須從
//     綠翻紅(測不出差別的判準等於沒有判準)。
//   ・PLUS_ENABLED 是網站暗啟動旗標(index.html 6182 行 IIFE:App 恆開、網站要 ?plus=1)——本功能
//     整節掛在這個旗標下,比照誤點履歷入口(.fp-dhlink)的既有驗法(E1/E4 pattern),證明「無 ?plus=1
//     時零存在」不是巧合,同一支收集器帶 ?plus=1 時必須真的抓得到(正向對照)。
//   ・Plus 兩側都要驗:訂閱狀態為真時完整清單可點進履歷卡;為假時模糊 teaser+CTA 呼叫 plusGateOpen,
//     解鎖後(模擬 plusFinishPending)重畫成完整清單——只驗一側測不出閘門壞掉。
//   ・零回歸不重寫一份弱化的準點排行檢查,直接子行程重跑 scripts/verify_punctual.mjs 整支
//     (那才是定義「準點排行對不對」的權威判準,不重新發明一份)。
//   ・真實資料:本機無後端,用 context.route 把 /api/delay-stats 轉發到 https://railisland.tw 同路徑,
//     渲染出的數字與直接向正式站要來的資料逐欄比對,不是全部只跑 mock。

import { chromium, webkit } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8932';
const MUTANT_PATH = '_mutant_mytrains_tmp.html';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p, msg }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const info = (n, msg) => console.log(`  ·    ${n} — ${msg}`);
const fmt1 = v => (v == null ? '?' : (Number.isInteger(v) ? String(v) : v.toFixed(1)));
let mutantWritten = false;

async function open(browser, { width = 1440, height = 900, path: p = '/index.html', qs = '?plus=1', hasTouch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + p + qs, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
  await page.evaluate(() => {
    const h = document.getElementById('howtoWrap'); if (h) h.remove();
    state.playing = false; // 凍結模擬時鐘
  });
  await page.waitForTimeout(200);
  return { ctx, page, errors };
}

const setFavs = (page, favs) => page.evaluate(f => { saveFavs(f); }, favs);
const setStats = (page, ds) => page.evaluate(d => { state.delayStats = d; state._punctual = null; }, ds);
const setPlus = (page, active) => page.evaluate(a => { state.plus = Object.assign(state.plus || {}, { active: a }); }, active);
const openFav = page => page.evaluate(() => openFavPanel());
const favHtml = page => page.evaluate(() => document.getElementById('favPanel').innerHTML);
const favSnap = page => page.evaluate(() => {
  const el = document.getElementById('favPanel');
  const secs = [...el.querySelectorAll('.sec')].map(s => s.textContent);
  const hasSection = secs.some(t => t.includes('我的車'));
  const rows = [...el.querySelectorAll('.row.myt')].map(r => ({
    no: r.dataset.no, text: r.textContent, hasRank: !!r.querySelector('.okTag'),
  }));
  const lockedEl = el.querySelector('.myt-locked');
  const cs = lockedEl ? getComputedStyle(lockedEl) : null;
  return {
    hasSection, rows,
    hasLock: !!el.querySelector('.myt-lock'),
    lockedBlur: cs ? cs.filter : null,
    lockedPointerEvents: cs ? cs.pointerEvents : null,
    hasCtaBtn: !!el.querySelector('.myt-cta-btn'),
    ctaText: (el.querySelector('.myt-cta-txt') || {}).textContent || null,
    html: el.innerHTML,
  };
});

try {

// ══════════ Section A：基本資料邏輯(只收台鐵/沒資料優雅退化/上榜標記) ══════════
{
  const browser = await chromium.launch();
  const { ctx, page, errors } = await open(browser, { width: 1440 });

  // 湊 10 班合格候選(d>=20)撐滿準點排行前10,third 班排第 5 名、eleventh 班(d 足但不夠擠進前10)當「有資料但沒上榜」對照
  const ds = {};
  for (let i = 1; i <= 10; i++) ds['R' + i] = { a: i, d: 25, m: i };
  ds['R11'] = { a: 50, d: 25, m: 50 }; // 合格但排不進前10(m=50 遠大於 R1~R10)
  await setStats(page, ds);

  await setFavs(page, [
    { train: 'R5', sys: 'tra_sched', label: '五號測試車　起點→終點' },   // 上榜
    { train: 'R11', sys: 'tra_sched', label: '十一號測試車　起點→終點' }, // 有資料但不上榜
    { train: 'R99', sys: 'tra_sched', label: '無資料測試車　起點→終點' }, // 不在 delayStats 裡
    { train: 'R5', sys: 'thsr_sched', label: '高鐵同號測試車　起點→終點' }, // 跨系統同號車:不可混入
  ]);
  await openFav(page);
  const snap = await favSnap(page);

  ok('A1 「我的車」節存在(Plus 訂閱中)', snap.hasSection, '');
  ok('A2 只收台鐵:高鐵同號 R5 不出現,恰 3 列', snap.rows.length === 3 && snap.rows.every(r => r.no !== 'R5' || true), `rows=${JSON.stringify(snap.rows.map(r => r.no))}`);
  const noDup = new Set(snap.rows.map(r => r.no)).size === snap.rows.length;
  ok('A2b 三列車次恰為 R5/R11/R99(無高鐵混入、無重複)', noDup && ['R5', 'R11', 'R99'].every(n => snap.rows.some(r => r.no === n)), JSON.stringify(snap.rows.map(r => r.no)));

  const r5 = snap.rows.find(r => r.no === 'R5'), r11 = snap.rows.find(r => r.no === 'R11'), r99 = snap.rows.find(r => r.no === 'R99');
  ok('A3 上榜車(R5)標「上榜」', !!(r5 && r5.hasRank), JSON.stringify(r5));
  ok('A4 有資料但未上榜(R11)不標「上榜」', !!(r11 && !r11.hasRank), JSON.stringify(r11));
  ok('A5 R5 三數字正確(最糟5分・平均5分・25天)', !!(r5 && r5.text.includes('最糟5分・平均5分・25天')), r5 && r5.text);

  ok('A6 沒資料要優雅:R99(不在 delayStats 裡)顯示?不顯示NaN', !!(r99 && r99.text.includes('?') && !r99.text.includes('NaN')), r99 && r99.text);
  ok('A7 全文無 NaN 字樣', !snap.html.includes('NaN'), '');
  ok('A8 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));

  // A9：state.delayStats 尚未載入(null)——不可拋錯、不可顯示 NaN,三數字全部退化成 ?
  await page.route('**/api/delay-stats*', r => r.fulfill({ status: 500, body: '{}' })); // 擋掉本機 fetch,避免 ensureDelayStats 意外把它填回非 null
  const nullSafe = await page.evaluate(() => {
    state.delayStats = null; state._delayStatsFetching = true; // 順便擋 ensureDelayStats 的 guard,確保接下來的 render 讀到的就是 null
    try { renderFavPanel(); return { ok: true, html: document.getElementById('favPanel').innerHTML }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ok('A9 delayStats 為 null 時 renderFavPanel 不拋錯', nullSafe.ok, nullSafe.err || '');
  ok('A9b delayStats 為 null 時仍顯示?且無 NaN', nullSafe.ok && nullSafe.html.includes('最糟?分・平均?分・?天') && !nullSafe.html.includes('NaN'), '');

  await ctx.close();
  await browser.close();
}

// ══════════ Section B：跨系統閘門突變測試(整支腳本最重要的一段) ══════════
{
  const browser = await chromium.launch();
  const crossGateCheck = page => page.evaluate(() => {
    saveFavs([
      { train: 'X1', sys: 'tra_sched', label: '台鐵測試車' },
      { train: 'X1', sys: 'thsr_sched', label: '高鐵同號測試車' },
    ]);
    const nos = myTrainFavs().map(f => f.sys + '|' + f.train);
    return { nos, leaked: nos.includes('thsr_sched|X1'), hasReal: nos.includes('tra_sched|X1') };
  });

  // B1：原始碼——正確行為
  {
    const { ctx, page } = await open(browser, { width: 1440 });
    const r = await crossGateCheck(page);
    ok('B1 原始碼:myTrainFavs() 只收台鐵,高鐵同號車不會混入', r.hasReal && !r.leaked, JSON.stringify(r));
    await ctx.close();
  }

  const GATE = "favTrainSys(f) === 'tra_sched'";
  const REPLACEMENT = 'true';
  const orig = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const occurrences = orig.split(GATE).length - 1;
  if (occurrences !== 1) {
    ok('B2 突變目標字串在檔案中恰好出現一次(找不到就不硬做突變)', false, `實際出現 ${occurrences} 次`);
  } else {
    writeFileSync(path.join(ROOT, MUTANT_PATH), orig.replace(GATE, REPLACEMENT));
    mutantWritten = true;
    const { ctx, page } = await open(browser, { width: 1440, path: '/' + MUTANT_PATH });
    const r = await crossGateCheck(page);
    ok('B2 突變版(拿掉跨系統閘門):測試如預期翻紅——高鐵同號車混入 myTrainFavs()', r.leaked,
       r.leaked ? '確認翻紅(高鐵同號車混入,證明判準有牙)' : JSON.stringify(r));
    await ctx.close();

    const { ctx: ctx2, page: page2 } = await open(browser, { width: 1440 });
    const r2 = await crossGateCheck(page2);
    ok('B3 還原後(對照原始 index.html 再跑一次):確認變回綠', r2.hasReal && !r2.leaked, JSON.stringify(r2));
    await ctx2.close();
  }
  await browser.close();
}

// ══════════ Section C：Plus 兩側(訂閱中 vs 未訂閱)＋解鎖後重畫 ══════════
{
  const browser = await chromium.launch();
  const ds = { P1: { a: 3, d: 22, m: 6 } };
  const favs = [{ train: 'P1', sys: 'tra_sched', label: 'Plus測試車　起點→終點' }];

  // C1：已訂閱——完整清單、可點進履歷卡
  {
    const { ctx, page, errors } = await open(browser, { width: 1440 });
    await setStats(page, ds); await setFavs(page, favs); await setPlus(page, true);
    await openFav(page);
    const snap = await favSnap(page);
    ok('C1a 已訂閱:不出現模糊遮罩', !snap.hasLock, '');
    ok('C1b 已訂閱:列完整可見(帶三數字)', snap.rows.length === 1 && snap.rows[0].text.includes('最糟6分'), JSON.stringify(snap.rows));
    await page.click('#favPanel .row.myt[data-no="P1"]');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      hidden: document.getElementById('delayHistPanel').hidden,
      open: state._delayHistOpen,
      favHidden: document.getElementById('favPanel').hidden,
    }));
    ok('C1c 點列 → 開既有 90 天誤點履歷卡(delayHistPanel 顯示、_delayHistOpen=P1)', after.hidden === false && after.open === 'P1', JSON.stringify(after));
    ok('C1d 點列 → favPanel 隨之關閉(openDelayHist 既有行為)', after.favHidden === true, '');
    ok('C1e 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // C2：未訂閱——模糊 teaser、CTA 呼叫 plusGateOpen('my-trains',...)、解鎖後重畫成完整清單
  {
    const { ctx, page, errors } = await open(browser, { width: 1440 });
    await setStats(page, ds); await setFavs(page, favs); await setPlus(page, false);
    await openFav(page);
    const snap = await favSnap(page);
    ok('C2a 未訂閱:出現模糊遮罩(myt-lock/myt-locked)', snap.hasLock, '');
    ok('C2b 未訂閱:遮罩內容確實模糊且不可互動(blur>0、pointer-events:none)', /blur\(/.test(snap.lockedBlur || '') && snap.lockedPointerEvents === 'none', JSON.stringify({ blur: snap.lockedBlur, pe: snap.lockedPointerEvents }));
    ok('C2c 未訂閱:CTA 按鈕存在', snap.hasCtaBtn, '');
    ok('C2d 未訂閱:遮罩內仍看得到收藏班數(入口可見,不是空白)', /1\s*班台鐵車/.test(snap.ctaText || ''), snap.ctaText);

    await page.click('#favPanel .myt-cta-btn');
    await page.waitForTimeout(150);
    const gate = await page.evaluate(() => ({ modalHidden: document.getElementById('plusModal').hidden, source: state.plus && state.plus.source }));
    ok('C2e 點 CTA → 開出 Plus 訂閱視窗且 source=my-trains(證明走的是 plusGateOpen(\'my-trains\',…))', gate.modalHidden === false && gate.source === 'my-trains', JSON.stringify(gate));

    // 模擬解鎖成功(plusFinishPending 的既有回路):favPanel 應該重畫成完整清單,不必使用者手動重開面板
    await page.evaluate(() => { state.plus.active = true; plusFinishPending(); });
    await page.waitForTimeout(100);
    const after = await favSnap(page);
    ok('C2f 模擬解鎖後(plusFinishPending):favPanel 自動重畫成完整清單(不再模糊)', !after.hasLock && after.rows.length === 1, JSON.stringify({ hasLock: after.hasLock, rows: after.rows }));
    ok('C2g 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
}

// ══════════ Section D：空狀態(零收藏 / 只收藏高鐵車)——兩種情況都不可壞 ══════════
{
  const browser = await chromium.launch();

  // D1：完全零收藏
  {
    const { ctx, page, errors } = await open(browser, { width: 1440 });
    await setStats(page, {}); await setFavs(page, []); await setPlus(page, true);
    await openFav(page);
    const snap = await favSnap(page);
    ok('D1a 零收藏:「我的車」節仍存在(不是空白區塊)', snap.hasSection, '');
    ok('D1b 零收藏:零列,且有說明如何收藏的提示文字', snap.rows.length === 0 && snap.html.includes('收藏台鐵列車後'), '');
    ok('D1c 零收藏:不出現模糊遮罩(沒東西可鎖)', !snap.hasLock, '');
    ok('D1d 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // D2：只收藏高鐵車(myTrainFavs 應為空,同 D1 的空狀態分支,不因為「有收藏」就誤判有台鐵資料)
  {
    const { ctx, page, errors } = await open(browser, { width: 1440 });
    await setStats(page, {}); await setPlus(page, true);
    await setFavs(page, [{ train: 'H1', sys: 'thsr_sched', label: '高鐵測試車　起點→終點' }]);
    await openFav(page);
    const snap = await favSnap(page);
    // 注意:「列車」節標題本身只在「同時也有收藏車站」時才顯示(既有邏輯,見 renderFavPanel 的
    // `stns.length ? sec : ''`)——這裡只收藏了一班車、零車站,所以不斷言節標題,只斷言 fv 列本身
    // 存在(既有功能真正的觀察點:H1 這班高鐵車有沒有被列在一般「我的最愛」清單裡)。
    const hasGeneralFvRow = snap.html.includes('data-no="H1"') && snap.html.includes('class="row fv"');
    ok('D2a 只收藏高鐵車:一般最愛列車清單仍列出該高鐵收藏(既有功能不受影響)', hasGeneralFvRow, '');
    ok('D2b 只收藏高鐵車:「我的車」節走空狀態分支(零列+收藏提示),不誤判有台鐵資料', snap.rows.length === 0 && snap.html.includes('收藏台鐵列車後'), '');
    ok('D2c 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
}

// ══════════ Section E：真實後端資料(至少一組非 mock 的斷言) ══════════
{
  let real;
  try {
    const res = await fetch('https://railisland.tw/api/delay-stats');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    real = await res.json();
  } catch (e) {
    ok('E0 正式站 /api/delay-stats 可達(接外部 API 前置驗證)', false, e.message);
    real = null;
  }
  if (real) {
    ok('E0 正式站 /api/delay-stats 可達,回傳有 trains 物件', !!(real.trains && Object.keys(real.trains).length > 0), `n_trains=${real.trains ? Object.keys(real.trains).length : 0}`);
    const trains = real.trains || {};
    const candNo = Object.keys(trains).find(k => trains[k] && trains[k].d >= 20) || Object.keys(trains)[0];
    if (candNo) {
      const truth = trains[candNo];
      const browser = await chromium.launch();
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.route('**/api/delay-stats*', async route => {
        try {
          const r = await fetch('https://railisland.tw/api/delay-stats');
          const body = await r.text();
          await route.fulfill({ status: r.status, contentType: r.headers.get('content-type') || 'application/json', body });
        } catch (e) { await route.fulfill({ status: 502, body: '{}' }); }
      });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/index.html?plus=1', { waitUntil: 'load' });
      await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
      await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); state.playing = false; });
      await setFavs(page, [{ train: candNo, sys: 'tra_sched', label: '真實資料測試車' }]);
      await setPlus(page, true);
      await openFav(page); // 這裡才觸發 ensureDelayStats() → 被 route 轉發到正式站
      try {
        await page.waitForFunction(() => state.delayStats && Object.keys(state.delayStats).length > 0, { timeout: 15000 });
      } catch (e) { /* 下面的斷言會自然失敗並回報 */ }
      const snap = await favSnap(page);
      const row = snap.rows.find(r => r.no === candNo);
      const expected = `最糟${fmt1(truth.m)}分・平均${fmt1(truth.a)}分・${truth.d}天`;
      ok(`E1 真實資料(車次${candNo}):透過 context.route 轉發到 railisland.tw,渲染數字與正式站原始回應逐欄一致`,
         !!(row && row.text.includes(expected)), `期望片段「${expected}」／實際列文字「${row && row.text}」`);
      ok('E2 真實資料下無 NaN、無例外', !snap.html.includes('NaN') && errors.length === 0, errors.slice(0, 3).join(' | '));
      await ctx.close(); await browser.close();
    } else {
      ok('E1 真實資料:正式站回應至少有一班車可用於比對', false, '');
    }
  }
}

// ══════════ Section F：手機四寬度(360/375/414/768)× 雙引擎——不溢出、真點擊命中、點了開履歷卡 ══════════
for (const engineName of ['chromium', 'webkit']) {
  const browser = await (engineName === 'chromium' ? chromium.launch() : webkit.launch());
  for (const width of [360, 375, 414, 768]) {
    const height = width === 768 ? 1024 : 812;
    const { ctx, page, errors } = await open(browser, { width, height, hasTouch: true });
    const ds = { M1: { a: 2, d: 21, m: 4 } };
    await setStats(page, ds);
    await setFavs(page, [{ train: 'M1', sys: 'tra_sched', label: '手機測試車　起點→終點' }]);
    await setPlus(page, true);

    const opener = (await page.$('#tabFav')) ? '#tabFav' : '#favBtn';
    await page.click(opener);
    await page.waitForTimeout(300);

    const geom = await page.evaluate(() => {
      const panel = document.getElementById('favPanel');
      const pr = panel.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth,
        panelInView: pr.left >= -1 && pr.right <= innerWidth + 1,
        hasRow: !!document.querySelector('#favPanel .row.myt[data-no="M1"]'),
      };
    });
    ok(`F1 手機${width}px(${engineName}):面板不造成頁面橫向溢出`, geom.scrollWidth <= geom.innerWidth + 1, `scrollWidth=${geom.scrollWidth} vs ${geom.innerWidth}`);
    ok(`F2 手機${width}px(${engineName}):面板完整落在視窗寬度內`, geom.panelInView, '');
    ok(`F3 手機${width}px(${engineName}):「我的車」列存在`, geom.hasRow, '');

    if (geom.hasRow) {
      const hit = await page.evaluate(() => {
        const row = document.querySelector('#favPanel .row.myt[data-no="M1"]');
        row.scrollIntoView({ block: 'center' });
        const b = row.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
        return { hitInRow: !!(el && (row.contains(el) || el === row)) };
      });
      ok(`F4 手機${width}px(${engineName}):列捲進視野後真的點得到(elementFromPoint)`, hit.hitInRow, '');
      if (hit.hitInRow) {
        await page.tap('#favPanel .row.myt[data-no="M1"]');
        await page.waitForTimeout(250);
        const after = await page.evaluate(() => ({ hidden: document.getElementById('delayHistPanel').hidden, open: state._delayHistOpen }));
        ok(`F5 手機${width}px(${engineName}):實點觸控後開啟誤點履歷卡`, after.hidden === false && after.open === 'M1', JSON.stringify(after));
      }
    }
    ok(`F6 手機${width}px(${engineName}):無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
}

// ══════════ Section H：PLUS_ENABLED 暗啟動契約——網站無 ?plus=1 時「我的車」節必須零存在 ══════════
{
  const browser = await chromium.launch();
  const ds = { H1: { a: 1, d: 21, m: 2 } };
  const favs = [{ train: 'H1', sys: 'tra_sched', label: '暗啟動測試車　起點→終點' }];

  // H1：預設網址(無 ?plus=1,＝真實網站訪客)→ 節不存在
  {
    const { ctx, page } = await open(browser, { width: 1440, qs: '' });
    await setStats(page, ds); await setFavs(page, favs); await setPlus(page, true);
    await openFav(page);
    const snap = await favSnap(page);
    ok('H1 預設網址(無 ?plus=1):「我的車」節不存在(myt-* 零蹤跡,不只是 CTA 被藏)', !snap.hasSection && !snap.hasCtaBtn && snap.rows.length === 0, JSON.stringify({ hasSection: snap.hasSection, rows: snap.rows.length }));
    await ctx.close();
  }
  // H2 正向對照:同一支收集器帶 ?plus=1 時必須真的抓得到,證明 H1 的「不存在」是產品行為不是收集器失靈
  {
    const { ctx, page } = await open(browser, { width: 1440, qs: '?plus=1' });
    await setStats(page, ds); await setFavs(page, favs); await setPlus(page, true);
    await openFav(page);
    const snap = await favSnap(page);
    ok('H2 正向對照:帶 ?plus=1 → 「我的車」節確實存在', snap.hasSection && snap.rows.length === 1, '');
    await ctx.close();
  }
  await browser.close();
}

// ══════════ Section I：更新紀錄結構完整性(比照 verify_punctual.mjs Section G) ══════════
{
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const foot = (html.match(/<ul class="foot-list foot-recent">([\s\S]*?)<\/ul>/) || [, ''])[1];
  const ofIds = [...foot.matchAll(/data-cl-of="([^"]+)"/g)].map(m => m[1]);
  const allClIds = [...html.matchAll(/data-cl="([^"]+)"/g)].map(m => m[1]);
  ok('I1 首層(最近更新)≤8 條', ofIds.length <= 8, `實際 ${ofIds.length} 條`);
  // 🔴 2026-08-14 改判準:原本另有一條「I2 首層有本次 mytrains 條目」。首層(.foot-recent)是「最近更新」
  //    的滾動檢視,硬上限 8 條(CL2),新功能一進榜舊的就會被合法擠出去——CL1 明文允許,只要正本還在
  //    第二層。綁「我的功能在第一層」等於保證幾批更新之後永久假紅,已一併移除(同批也修了
  //    verify_punctual.mjs 的 G2,比照 verify_live_activity.mjs 2026-08-04)。真正該保證的事是正本在
  //    第二層恰好一條,即下面這條;首層自身的結構完整性由 I1(≤8 條)與 I4(每條都找得到正本)覆蓋。
  const canonCount = allClIds.filter(id => id === 'mytrains').length;
  ok('I2 第二層有「mytrains」正本(恰好一條)', canonCount === 1, `實際 ${canonCount} 條`);
  const dupes = [...new Set(allClIds.filter((id, i) => allClIds.indexOf(id) !== i))];
  ok('I3 第二層 data-cl id 不重複', dupes.length === 0, dupes.join('、'));
  const missing = ofIds.filter(id => !allClIds.includes(id));
  ok('I4 首層每條都找得到第二層正本', missing.length === 0, missing.join('、'));
  // 判準寫「有沒有相對基準遞增」,不寫死當下那個字串——BUILD 每次出貨都會動,寫死等於替下一個
  // session 埋一顆必然假紅的地雷(心得 35:判準要從當下量到的東西推導,不要手打常數)。
  // verify_punctual.mjs 的 A0 原本就是寫死的,已在同一批一併改成這個作法。
  const buildMatch = html.match(/const BUILD = '([^']+)'/);
  const baseBuild = (execSync('git show 24e9c2c:index.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .match(/const BUILD = '([^']+)'/) || [])[1] || null;
  ok('I5 BUILD 相對基準已遞增', !!buildMatch && !!baseBuild && buildMatch[1] !== baseBuild,
    `${baseBuild} → ${buildMatch ? buildMatch[1] : '找不到 BUILD'}`);
}

// ══════════ Section G：對第一項(準點排行)零回歸——直接重跑整支 verify_punctual.mjs ══════════
// 🔴 這裡刻意「零例外」:verify_punctual.mjs 的每一條都必須過。
// 原本有一條具名白名單放行它寫死的 `BUILD === 'v0807b'` 斷言(那條在 BUILD 遞增後必然過期)。
// 白名單本身是個漏洞——那條測試哪天為了真正的原因翻紅,也會被同一條例外靜默放行。
// 正解是修掉根因:兩支腳本的 BUILD 斷言都已改成「相對基準 commit 有沒有遞增」(判準不再綁在
// 會漂移的量上,心得 35),例外因此不再需要,一併移除以免留下靜默放行的縫。
{
  const scriptPath = path.join(ROOT, 'scripts', 'verify_punctual.mjs');
  if (!existsSync(scriptPath)) {
    ok('G1 零回歸:scripts/verify_punctual.mjs 存在', false, '找不到檔案,無法重跑第一項驗收');
  } else {
    const runAndCollectFails = () => {
      try {
        const out = execSync(`node "${scriptPath}" "${BASE}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        return { out, fails: [...out.matchAll(/^FAIL {2}(.+?)( —.*)?$/gm)].map(m => m[1].trim()) };
      } catch (e) {
        const out = String(e.stdout || '');
        return { out, fails: [...out.matchAll(/^FAIL {2}(.+?)( —.*)?$/gm)].map(m => m[1].trim()) };
      }
    };
    const { out, fails } = runAndCollectFails();
    const m = out.match(/=== (\d+)\/(\d+) 通過 ===/);
    ok('G1 零回歸:重跑 verify_punctual.mjs 全數通過(零例外)',
       fails.length === 0, `${m ? m[1] + '/' + m[2] + ' 通過；' : ''}未過項=${JSON.stringify(fails)}`);
  }
}

} finally {
  if (mutantWritten) { try { unlinkSync(path.join(ROOT, MUTANT_PATH)); } catch (e) {} }
}

const bad = R.filter(r => !r.p);
console.log(`\n=== ${R.length - bad.length}/${R.length} 通過 ===`);
if (bad.length) { console.log('未過：'); bad.forEach(b => console.log(' ・' + b.n + ' — ' + b.msg)); process.exit(1); }
