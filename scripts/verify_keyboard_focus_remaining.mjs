#!/usr/bin/env node
// 2026-09-26 鍵盤焦點交棒剩餘項目的獨立瀏覽器驗收。
// - .board：鍵盤開啟後焦點進面板；Esc 關閉並回入口（含 input 內按 Esc）
// - 觀看設定子列：收起觀看設定後，軌道／字級面板仍收到焦點
// - 公車搜尋列、最愛車站列、兩個誤點履歷入口可用 Tab 到達、Enter 開啟
// - 直式合併卡收合後，焦點落在可見的「結束」鈕
// - 六顆原本只念「×」的 close 有可翻譯 accessible name
//
// 用法：
// WORKSPACE_NODE_MODULES=/path/to/node_modules node scripts/verify_keyboard_focus_remaining.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = process.env.WORKSPACE_NODE_MODULES;
const { chromium, webkit } = await import(modules ? pathToFileURL(path.join(modules, 'playwright/index.mjs')).href : 'playwright');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
};
const BUS_SEARCH = {
  total: 2,
  rows: [
    { stationUid: 'TPE-KF-1', name: '固定站甲', city: 'Taipei', cityLabel: '臺北市', position: { lat: 25.0478, lon: 121.517 }, routes: ['307', '0東'] },
    { stationUid: 'TPE-KF-2', name: '固定站乙', city: 'Taipei', cityLabel: '臺北市', position: { lat: 25.05, lon: 121.52 }, routes: ['49'] },
  ],
};
const BUS_LIVE = {
  stop: BUS_SEARCH.rows[0], source: { attribution: 'fixture', snapshotAt: '2026-09-26T09:41:00+08:00' },
  routes: [{ routeId: '307', routeName: '307', direction: 0, arrivals: [{ live: { state: 'countdown', etaSec: 180 } }] }],
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/bus-stop-search') {
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ...BUS_SEARCH, query: url.searchParams.get('q') || '' }));
  }
  if (url.pathname === '/api/bus-stop-live') {
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(BUS_LIVE));
  }
  if (url.pathname.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.resolve(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (path.relative(ROOT, fp).startsWith('..')) { res.statusCode = 404; return res.end('nf'); }
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)))));
const STEP = eng => eng === 'webkit' ? 'Alt+Tab' : 'Tab';
const RO_LOOP = /^(?:Error:\s*)?ResizeObserver loop completed with undelivered notifications\.?$/;
const RESET = () => {
  for (const f of ['closeBoard', 'closeFavPanel', 'closeRidePanel', 'closeExplorePanel', 'closeTrackPanel',
    'closeTodayPanel', 'closeDelayHist', 'closeFontPanel', 'closeTripSharePanel', 'closeBusStopPanel']) {
    try { if (typeof window[f] === 'function') window[f](); } catch (e) {}
  }
  try { closeSearchPanel({ user: true }); } catch (e) {}
  try { closeSearchDrop(); } catch (e) {}
  try { window.railViewControls.close(); } catch (e) {}
  document.body.classList.remove('tools-open');
  const input = document.getElementById('trainSearch'); if (input) input.value = '';
  try { document.activeElement && document.activeElement.blur(); } catch (e) {}
};
const FOCUS_STATE = ([panel, wanted]) => {
  const p = document.getElementById(panel), a = document.activeElement;
  let fv = false; try { fv = !!a && a.matches(':focus-visible'); } catch (e) {}
  return { open: !!p && !p.hidden, active: __kbdDesc(), wanted: !!a && a.matches(wanted), fv,
    aria: a && a.getAttribute ? a.getAttribute('aria-label') : null };
};

async function boot(browser, width, lang = 'zh-TW') {
  const mobile = width < 1000;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 780 : 800 }, isMobile: mobile, hasTouch: mobile,
    locale: lang, timezoneId: 'Asia/Taipei' });
  await context.addInitScript(l => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', l);
    localStorage.setItem('trainmap-fprail-min', '0');
  }, lang);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}?lang=${lang}&t=09:41&plus=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return state.ready === true && state.mode === 'sched' && state.trains.length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
  await page.waitForFunction(() => !!document.getElementById('viewDock'), null, { timeout: 30000 });
  await page.evaluate(() => { window.__kbdDesc = () => { const e = document.activeElement; if (!e || e === document.body) return 'body';
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''); }; });
  return { context, page, errors };
}
async function focusKeyboard(page, selector) {
  await page.keyboard.press('Shift');
  const found = await page.evaluate(sel => {
    const shown = e => !!(e && e.getClientRects().length && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden');
    const e = [...document.querySelectorAll(sel)].find(shown); if (e) e.focus({ preventScroll: true }); return !!e;
  }, selector);
  await settle(page);
  return found;
}
async function activate(page, selector) {
  if (!(await focusKeyboard(page, selector))) return false;
  await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(120); return true;
}
async function tabUntil(page, eng, selector, boundary, max = 100) {
  for (let i = 0; i <= max; i++) {
    const at = await page.evaluate(([sel, boundary]) => { const a = document.activeElement; return {
      target: !!a && a.matches(sel), inside: !boundary || (!!a && !!a.closest(boundary)) }; }, [selector, boundary]);
    if (at.target) return i;
    if (i > 0 && !at.inside) return -1;
    await page.keyboard.press(STEP(eng)); await settle(page);
  }
  return -1;
}
async function reset(page) { await page.evaluate(RESET); await settle(page); }
async function panelOpenEsc(page, tag, panel, closeSelector, returnSelector, open) {
  await reset(page); await open();
  await page.waitForFunction(id => { const p = document.getElementById(id); return p && !p.hidden; }, panel, { timeout: 10000 });
  await settle(page);
  const a = await page.evaluate(FOCUS_STATE, [panel, closeSelector]);
  check(`${tag} 鍵盤開啟後焦點進面板 close`, a.open && a.wanted && a.fv && !!a.aria, `${a.active}, aria=${a.aria || '無'}`);
  await page.keyboard.press('Escape'); await settle(page);
  const b = await page.evaluate(([id, sel]) => {
    const p = document.getElementById(id), a = document.activeElement; let fv = false;
    try { fv = !!a && a.matches(':focus-visible'); } catch (e) {}
    return { closed: !p || p.hidden, back: !!a && a.matches(sel), fv, active: __kbdDesc() };
  }, [panel, returnSelector]);
  check(`${tag} Esc 關閉並回入口`, b.closed && b.back && b.fv, b.active);
}
async function setupFollow(page) {
  return page.evaluate(async () => {
    state.plus = { active: true };
    if (!state.followTrain) {
      const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
      const tr = cands.find(t => effT(t) >= t.stops[0].depSec && tripRemainingStops(t).length >= 12) || cands[0];
      followTrainNo(String(tr.train), { sys: 'tra_sched' });
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const tr = state.followTrain;
    updateFollowPanel(tr);
    state.delayStats = { ...(state.delayStats || {}), [String(tr.train)]: { a: 2, p: 80, d: 10, m: 9 } };
    renderDelayRow();
    return String(tr.train);
  });
}

async function core(browserType, eng) {
  const browser = await browserType.launch({ headless: true });
  for (const width of [360, 1280]) {
    const mobile = width < 1000, tag = `${eng} ${width}`;
    const { context, page, errors } = await boot(browser, width);
    const button = async (sel, panel, close, back, label) => panelOpenEsc(page, `${tag} ${label}`, panel, close, back, () => activate(page, sel));
    await button(mobile ? '#tabFav' : '#favBtn', 'favPanel', '#favClose', mobile ? '#tabFav' : '#favBtn', '我的最愛');
    await button(mobile ? '#tabRide' : '#rideBtn', 'ridePanel', '#rideClose', mobile ? '#tabRide' : '#rideBtn', '旅程護照');
    await button(mobile ? '#tabExplore' : '#exploreBtn', 'explorePanel', '#exploreClose', mobile ? '#tabExplore' : '#exploreBtn', '今日亮點');
    await button(mobile ? '#tabSearch' : '#todayBtn', mobile ? 'searchPanel' : 'todayPanel', mobile ? '#searchPanelClose' : '#todayClose', mobile ? '#tabSearch' : '#todayBtn', mobile ? '查詢' : '今日動態');

    const viewPanel = async (kind, panel, close, label) => {
      await panelOpenEsc(page, `${tag} ${label}`, panel, close,
        mobile ? '#viewSettingsBtn' : `.view-rail [aria-controls="view-${kind}"]`, async () => {
          if (mobile) { await activate(page, '#viewSettingsBtn'); await activate(page, `.view-tabs .view-tab[data-view="${kind}"]`); }
          else await activate(page, `.view-rail [aria-controls="view-${kind}"]`);
          await activate(page, kind === 'labels' ? '[data-act="track"]' : '[data-act="fontscale"]');
        });
    };
    await viewPanel('labels', 'trackPanel', '#trackClose', '軌道與路線');
    await viewPanel('display', 'fontPanel', '#fontClose', '顯示與字級');

    // 文字欄位內按 Esc：這是明確鍵盤關閉，要走同一條焦點退路；直接／觸控 close 仍不強送。
    if (mobile) {
      await reset(page); await activate(page, '#tabSearch'); await focusKeyboard(page, '#trainSearch');
      const drop0 = await page.evaluate(() => !document.getElementById('searchDrop').hidden);
      await page.keyboard.press('Escape'); await settle(page);
      const s0 = await page.evaluate(() => ({ panelOpen: !document.getElementById('searchPanel').hidden,
        dropClosed: document.getElementById('searchDrop').hidden, onInput: document.activeElement === document.getElementById('trainSearch') }));
      check(`${tag} searchPanel 第一發 Esc 只收搜尋下拉`, drop0 && s0.panelOpen && s0.dropClosed && s0.onInput, JSON.stringify(s0));
      await page.keyboard.press('Escape'); await settle(page);
      const s = await page.evaluate(() => ({ closed: document.getElementById('searchPanel').hidden,
        back: document.activeElement === document.getElementById('tabSearch'), active: __kbdDesc() }));
      check(`${tag} searchPanel 第二發 Esc 關閉並回 #tabSearch`, s.closed && s.back, s.active);
    }
    await reset(page);
    if (mobile) { await activate(page, '#viewSettingsBtn'); await activate(page, '.view-tabs .view-tab[data-view="labels"]'); }
    else await activate(page, '.view-rail [aria-controls="view-labels"]');
    await activate(page, '[data-act="track"]'); await focusKeyboard(page, '#rdSearch');
    await page.keyboard.press('Escape'); await settle(page);
    const ti = await page.evaluate(sel => ({ closed: document.getElementById('trackPanel').hidden,
      back: document.activeElement && document.activeElement.matches(sel), active: __kbdDesc() }),
      mobile ? '#viewSettingsBtn' : '.view-rail [aria-controls="view-labels"]');
    check(`${tag} trackPanel input 內 Esc 關閉並回觀看入口`, ti.closed && ti.back, ti.active);

    // ridePanel 內的成就說明 tooltip 也是暫態層：第一發只收 tooltip，第二發才收整張護照。
    await reset(page); await activate(page, mobile ? '#tabRide' : '#rideBtn');
    const ach = await focusKeyboard(page, '#ridePanel [data-ach]'); await settle(page);
    const hp0 = await page.evaluate(() => !!state._helpPopFor && !document.getElementById('helpPop').hidden);
    await page.keyboard.press('Escape'); await settle(page);
    const hp1 = await page.evaluate(() => ({ panelOpen: !document.getElementById('ridePanel').hidden,
      popClosed: !state._helpPopFor && document.getElementById('helpPop').hidden }));
    check(`${tag} ridePanel 第一發 Esc 只收成就說明`, ach && hp0 && hp1.panelOpen && hp1.popClosed, JSON.stringify(hp1));
    await page.keyboard.press('Escape'); await settle(page);
    const hp2 = await page.evaluate(sel => ({ closed: document.getElementById('ridePanel').hidden,
      back: document.activeElement && document.activeElement.matches(sel), active: __kbdDesc() }), mobile ? '#tabRide' : '#rideBtn');
    check(`${tag} ridePanel 第二發 Esc 關閉並回入口`, hp2.closed && hp2.back, hp2.active);

    // 真搜尋 Enter 開車站看板，打開即聚焦 close，再用 Esc 回原入口。
    await reset(page); if (mobile) await activate(page, '#tabSearch');
    await focusKeyboard(page, '#trainSearch'); await page.keyboard.type('臺北', { delay: 20 }); await page.waitForTimeout(350);
    await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(120);
    const bo = await page.evaluate(FOCUS_STATE, ['board', '#boardClose']);
    check(`${tag} 車站看板鍵盤開啟後焦點在 close`, bo.open && bo.wanted && bo.fv && !!bo.aria, `${bo.active}, aria=${bo.aria || '無'}`);
    await page.keyboard.press('Escape'); await settle(page);
    const bc = await page.evaluate(sel => ({ closed: document.getElementById('board').hidden,
      back: document.activeElement && document.activeElement.matches(sel), active: __kbdDesc() }), mobile ? '#tabSearch' : '#trainSearch');
    check(`${tag} 車站看板 Esc 關閉並回入口`, bc.closed && bc.back, bc.active);

    if (mobile) {
      // 最愛車站列：從 close 真的按 Tab 走到列，Enter 開看板。
      await reset(page);
      await page.evaluate(() => userDataSaveCollection('stations', [{ name: '臺北', lat: 25.0478, lon: 121.517, sys: 'tra_sched', group: 'all', label: '台鐵' }]));
      await activate(page, '#tabFav');
      const ft = await tabUntil(page, eng, '#favPanel .fvst-go[data-stkey]', '#favPanel');
      const fa = await page.evaluate(() => ({ tab: document.activeElement && document.activeElement.matches('#favPanel .fvst-go'),
        native: document.activeElement && document.activeElement.tagName === 'BUTTON', type: document.activeElement && document.activeElement.type }));
      check(`${tag} 最愛車站原生按鈕可由 Tab 到達`, ft >= 0 && fa.tab && fa.native && fa.type === 'button', `步數 ${ft}`);
      await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(120);
      const fb = await page.evaluate(FOCUS_STATE, ['board', '#boardClose']);
      check(`${tag} 最愛車站列 Enter 開看板並聚焦 close`, fb.open && fb.wanted && fb.fv, fb.active);

      // 公車搜尋列：從 input 真的按 Tab 到結果列，Enter 開站牌 sheet。
      await reset(page); await activate(page, '#tabSearch'); await focusKeyboard(page, '#trainSearch');
      await page.keyboard.type('固定站', { delay: 20 });
      await page.waitForSelector('#searchDrop .bus-row', { state: 'visible', timeout: 5000 });
      await focusKeyboard(page, '#searchClear');
      const bt = await tabUntil(page, eng, '#searchDrop .bus-row[role="button"]', '#searchDrop');
      const ba = await page.evaluate(() => ({ tab: document.activeElement && document.activeElement.matches('#searchDrop .bus-row'),
        role: document.activeElement && document.activeElement.getAttribute('role'), aria: document.activeElement && document.activeElement.getAttribute('aria-label') }));
      check(`${tag} 公車搜尋列可由 Tab 到達`, bt >= 0 && ba.tab && ba.role === 'button' && !!ba.aria, `步數 ${bt}, aria=${ba.aria || '無'}`);
      await page.keyboard.press('Escape'); await settle(page);
      const be1 = await page.evaluate(() => ({ panelOpen: !document.getElementById('searchPanel').hidden,
        dropClosed: document.getElementById('searchDrop').hidden, onInput: document.activeElement === document.getElementById('trainSearch'), active: __kbdDesc() }));
      check(`${tag} 公車列第一發 Esc 收下拉並回搜尋框`, be1.panelOpen && be1.dropClosed && be1.onInput, JSON.stringify(be1));
      await page.keyboard.press('Escape'); await settle(page);
      const be2 = await page.evaluate(() => ({ panelClosed: document.getElementById('searchPanel').hidden,
        onTab: document.activeElement === document.getElementById('tabSearch'), active: __kbdDesc() }));
      check(`${tag} 公車列第二發 Esc 關查詢面板`, be2.panelClosed && be2.onTab, JSON.stringify(be2));

      // 重開同一條真路徑，接著驗 Enter。
      await activate(page, '#tabSearch'); await focusKeyboard(page, '#trainSearch'); await page.keyboard.type('固定站', { delay: 20 });
      await page.waitForSelector('#searchDrop .bus-row', { state: 'visible', timeout: 5000 });
      await focusKeyboard(page, '#searchClear');
      await tabUntil(page, eng, '#searchDrop .bus-row[role="button"]', '#searchDrop');
      await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(120);
      const bp = await page.evaluate(FOCUS_STATE, ['busStopPanel', '#busStopClose']);
      check(`${tag} 公車搜尋列 Enter 開站牌並聚焦 close`, bp.open && bp.wanted && bp.fv, bp.active);
      await page.keyboard.press('Escape'); await settle(page);

      // 跟車卡與列車 sheet 的兩個誤點履歷入口都必須能用 Tab 抵達。
      await setupFollow(page); await reset(page); await setupFollow(page);
      await focusKeyboard(page, '#fpClose');
      const dt = await tabUntil(page, eng, '#followPanel .fp-dhlink[role="button"]', '#followPanel');
      check(`${tag} 跟車卡誤點履歷入口可由 Tab 到達`, dt >= 0, `步數 ${dt}`);
      await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(120);
      const dh = await page.evaluate(FOCUS_STATE, ['delayHistPanel', '#delayHistClose']);
      check(`${tag} 跟車卡誤點履歷 Enter 開面板並聚焦 close`, dh.open && dh.wanted && dh.fv, dh.active);
      await page.keyboard.press('Escape'); await settle(page);
      await page.evaluate(() => openTrainSheet()); await settle(page);
      await page.evaluate(() => setSheetSize(document.getElementById('trainCard'), 'medium')); await settle(page);
      await focusKeyboard(page, '#tcSheetClose');
      const tt = await tabUntil(page, eng, '#tcDelayHist[role="button"]', '#trainCard');
      check(`${tag} 列車 sheet 誤點履歷入口可由 Tab 到達`, tt >= 0, `步數 ${tt}`);
      await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(120);
      const th = await page.evaluate(FOCUS_STATE, ['delayHistPanel', '#delayHistClose']);
      check(`${tag} 列車 sheet 誤點履歷 Enter 開面板並聚焦 close`, th.open && th.wanted && th.fv, th.active);
      await page.keyboard.press('Escape'); await settle(page);

      // 行程分享也走真入口，補齊第 11 張 .board。
      await setupFollow(page); await panelOpenEsc(page, `${tag} 行程分享`, 'tripPanel', '#tripPanelClose', '#fpTripShare', () => activate(page, '#fpTripShare'));

      // 合併卡「這班車」按 × 收合：不能把焦點留在隱藏的 ×。
      await reset(page); await setupFollow(page);
      await page.evaluate(() => openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 })); await settle(page);
      await activate(page, '#board .uni-tabs [data-t="train"]');
      await focusKeyboard(page, '#fpClose'); await page.keyboard.press('Enter'); await settle(page);
      const uc = await page.evaluate(() => {
        const a = document.activeElement, e = document.getElementById('fpEnd'), r = e.getBoundingClientRect();
        let fv = false; try { fv = a === e && e.matches(':focus-visible'); } catch (x) {}
        return { collapsed: document.body.classList.contains('uni-collapsed') && document.getElementById('followPanel').classList.contains('fp-min'),
          boardHidden: document.getElementById('board').hidden, onEnd: a === e, fv, shown: !!e.getClientRects().length,
          hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e, active: __kbdDesc() };
      });
      check(`${tag} 合併卡收合後焦點在可見的「結束」鈕`, uc.collapsed && uc.boardHidden && uc.onEnd && uc.fv && uc.shown && uc.hit, JSON.stringify(uc));
    }
    const ro = errors.filter(e => RO_LOOP.test(e));
    const other = errors.filter(e => !RO_LOOP.test(e));
    check(`${tag} 無非 ResizeObserver pageerror`, other.length === 0, other.slice(0, 2).join(' | '));
    check(`${tag} ResizeObserver exact pageerror 為 0`, ro.length === 0, `次數=${ro.length}`);
    console.log(`INFO  ${tag} ResizeObserver exact pageerror=${JSON.stringify(ro)} count=${ro.length}`);
    await context.close();
  }
  await browser.close();
}

for (const [type, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) await core(type, name);

// 真觸控與四個直式寬度：Chromium／WebKit 都用 page.tap，並掃新面板與既有可見控制的
// 命中、兩兩相交及 viewport 水平溢出。先後兩個狀態的 coverage 取聯集：公車面板打開後
// 某些既有控制會按產品規則隱藏，不能把「正確隱藏」誤判成沒測到。
for (const [browserType, eng] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const browser = await browserType.launch({ headless: true });
  for (const width of [360, 375, 414, 768]) {
    const { context, page, errors } = await boot(browser, width);
    await setupFollow(page);
    // 固定一顆手機公告入口，讓有／無公告版面都真正進入幾何掃描；只改 UI fixture，
    // 不改產品事件或定位規則。
    await page.evaluate(() => {
      const chip = document.getElementById('alertChip');
      if (chip) { chip.hidden = false; document.getElementById('alertChipN').textContent = '1'; }
    });
    await settle(page);
    const audit = (label, kinds) => page.evaluate(({ label, kinds }) => {
      const selectors = {
        tab: '#tabSearch,#tabExplore,#tabFav,#tabRide,#tabMore',
        view: '#viewSettingsBtn',
        random: '#randBtn',
        clock: '#statBadge',
        city: '#msCities button[data-city]',
        zoom: '.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out,.leaflet-control-zoom-in,.leaflet-control-zoom-out',
        follow: '#followPanel button',
        alert: '#alertChip,#alertBanner button',
        bus: '#busStopPanel button,#busStopPanel a[href],#busStopPanel [role="button"]',
        fav: '#favPanel .fvst-go,#favPanel .row.fvst > .rm',
      };
      const shown = e => {
        if (e.closest('[hidden],[inert]')) return false;
        const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (r.width <= 0 || r.height <= 0 || getComputedStyle(e).visibility === 'hidden') return false;
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === 'none' || Number(s.opacity) <= .05) return false;
          // html/body 的 overflow 會傳播成 viewport 捲動根，getBoundingClientRect 並不是
          // 實際裁切盒；viewport 另由 inViewport 檢查。只套真正的內層捲動容器。
          if (n !== e && n !== document.body && n !== document.documentElement) {
            const nr = n.getBoundingClientRect(), clippedX = /^(auto|scroll|hidden|clip)$/.test(s.overflowX), clippedY = /^(auto|scroll|hidden|clip)$/.test(s.overflowY);
            if ((clippedX && (cx < nr.left || cx > nr.right)) || (clippedY && (cy < nr.top || cy > nr.bottom))) return false;
          }
        }
        // 可見與可點分開判斷：祖先 pointer-events:none 可由子鈕 pointer-events:auto
        // 重新開啟；反過來，可見卻被遮住／不可點也必須進 items，交給 badHit 報錯。
        return true;
      };
      const seen = new Set(), items = [], coverage = {};
      for (const [kind, selector] of Object.entries(selectors)) {
        coverage[kind] = 0;
        if (!kinds.includes(kind)) continue;
        for (const e of document.querySelectorAll(selector)) {
          if (!shown(e)) continue;
          coverage[kind]++;
          if (seen.has(e)) continue;
          seen.add(e);
          const r = e.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          items.push({ e, kind, name: e.id ? `#${e.id}` : e.dataset.city ? `[data-city="${e.dataset.city}"]` : `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`,
            r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
            inViewport: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
            hit: hit === e || e.contains(hit), at: hit ? (hit.id ? `#${hit.id}` : `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}`) : 'null' });
        }
      }
      const overlaps = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > .5 && h > .5) overlaps.push({ kinds: [a.kind, b.kind], name: `${a.name}×${b.name}:${Math.round(w * h)}` });
      }
      return { label, coverage, overlaps, badHit: items.filter(x => !x.hit).map(x => ({ kind: x.kind, name: `${x.name}→${x.at}` })),
        out: items.filter(x => !x.inViewport).map(x => ({ kind: x.kind, name: x.name })),
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth };
    }, { label, kinds });
    await page.evaluate(() => userDataSaveCollection('stations', [{ name: '臺北', lat: 25.0478, lon: 121.517, sys: 'tra_sched', group: 'all', label: '台鐵' }]));

    // 手機全畫面刻意隱藏 header 的 #citySel；走使用者真正可用的「觀看 → 導覽 →
    // 縣市快速移動」入口，展開後逐顆驗證 chip，而不是覆寫 CSS 造出不存在的狀態。
    await page.tap('#viewSettingsBtn'); await settle(page);
    await page.tap('.view-tabs .view-tab[data-view="places"]'); await settle(page);
    await page.tap('#view-places [data-act="cities"]'); await settle(page);
    const cityKinds = ['tab', 'view', 'random', 'clock', 'city', 'follow', 'alert'];
    const city = await audit('city-drawer', cityKinds);
    const cityChips = page.locator('#msCities button[data-city]');
    const cityCount = await cityChips.count();
    // 360／375 最後一顆會合理地落在可捲面板摺線下；逐顆捲入並驗中心命中，
    // 才能證明所有控制真的可及，而不是只數 DOM 或只驗首屏 16 顆。
    for (let i = 0; i < cityCount; i++) {
      const chip = cityChips.nth(i);
      await chip.scrollIntoViewIfNeeded(); await settle(page);
      const one = await chip.evaluate(e => {
        const r = e.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { name: e.dataset.city || e.textContent.trim(), hit: at === e || e.contains(at),
          inViewport: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 };
      });
      if (!one.hit) city.badHit.push({ kind: 'city', name: one.name });
      if (!one.inViewport) city.out.push({ kind: 'city', name: one.name });
    }
    const cityScrolled = await audit('city-drawer-scrolled', cityKinds);
    city.coverage.city = cityCount;
    city.overlaps.push(...cityScrolled.overlaps);
    city.badHit.push(...cityScrolled.badHit);
    city.out.push(...cityScrolled.out);
    city.overflow = Math.max(city.overflow, cityScrolled.overflow);
    check(`${eng} touch ${width} 真手機縣市入口可展開且 chips 可命中、零相交、在 viewport 內`,
      city.coverage.city >= 17 && !city.badHit.length && !city.overlaps.length && !city.out.length && city.overflow <= 1,
      `coverage=${city.coverage.city} hit=${city.badHit.map(x => x.name).join(',') || '-'} overlap=${city.overlaps.map(x => x.name).join(',') || '-'} out=${city.out.map(x => x.name).join(',') || '-'} overflow=${city.overflow}`);
    await page.tap('#viewSettingsPanel .view-close'); await settle(page);

    await page.tap('#tabFav'); await settle(page);
    const fav = await audit('favorite-station', ['fav']);
    check(`${eng} touch ${width} 最愛車站主動作與移除鍵是可命中的 sibling`, fav.coverage.fav >= 2 && !fav.badHit.length && !fav.overlaps.length,
      `coverage=${fav.coverage.fav} hit=${fav.badHit.map(x => x.name).join(',') || '-'} overlap=${fav.overlaps.map(x => x.name).join(',') || '-'}`);
    await page.tap('#favClose'); await settle(page);
    const pre = await audit('before-bus', ['tab', 'view', 'random', 'clock', 'city', 'follow', 'alert']);

    await page.tap('#tabSearch'); await settle(page);
    const touchSearch = await page.evaluate(() => { const c = document.getElementById('searchPanelClose'); let fv = false;
      try { fv = c.matches(':focus-visible'); } catch (e) {} return { open: !document.getElementById('searchPanel').hidden,
        notClose: document.activeElement !== c, closeFocusVisible: fv, active: __kbdDesc() }; });
    check(`${eng} touch ${width} 觸控開查詢不強送焦點到 close`, touchSearch.open && touchSearch.notClose && !touchSearch.closeFocusVisible, JSON.stringify(touchSearch));
    await page.tap('#trainSearch'); await page.fill('#trainSearch', '固定站');
    const row = page.locator('#searchDrop .bus-row').first(); await row.waitFor({ state: 'visible', timeout: 5000 });
    const hit = await row.evaluate(e => { const r = e.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return at === e || e.contains(at); });
    await row.tap(); await settle(page);
    const touchBus = await page.evaluate(() => { const c = document.getElementById('busStopClose'); let fv = false;
      try { fv = c.matches(':focus-visible'); } catch (e) {} return { open: !document.getElementById('busStopPanel').hidden,
        notClose: document.activeElement !== c, closeFocusVisible: fv, active: __kbdDesc() }; });
    check(`${eng} touch ${width} 公車列可命中並以 page.tap 開站牌`, hit && touchBus.open, JSON.stringify(touchBus));
    check(`${eng} touch ${width} 觸控開站牌不強送焦點到 close`, touchBus.open && touchBus.notClose && !touchBus.closeFocusVisible, JSON.stringify(touchBus));
    const post = await audit('after-bus', ['tab', 'view', 'random', 'clock', 'city', 'follow', 'alert', 'bus']);
    const allCoverage = Object.fromEntries(Object.keys(pre.coverage).map(k => [k, city.coverage[k] + fav.coverage[k] + pre.coverage[k] + post.coverage[k]]));
    const required = ['tab', 'view', 'random', 'clock', 'city', 'follow', 'alert', 'bus', 'fav'];
    const missing = required.filter(k => !allCoverage[k]);
    const problems = [...city.overlaps, ...fav.overlaps, ...pre.overlaps, ...post.overlaps,
      ...city.badHit, ...fav.badHit, ...pre.badHit, ...post.badHit,
      ...city.out, ...fav.out, ...pre.out, ...post.out];
    check(`${eng} touch ${width} 新面板與既有可見控制零相交、可命中、無水平溢出`,
      !missing.length && !problems.length && city.overflow <= 1 && fav.overflow <= 1 && pre.overflow <= 1 && post.overflow <= 1,
      `coverage=${JSON.stringify(allCoverage)} missing=${missing.join(',') || '-'} overflow=${city.overflow}/${fav.overflow}/${pre.overflow}/${post.overflow} problems=${problems.slice(0, 8).map(x => x.name).join(' | ') || '-'}`);
    const ro = errors.filter(e => RO_LOOP.test(e));
    const other = errors.filter(e => !RO_LOOP.test(e));
    check(`${eng} touch ${width} 無非 ResizeObserver pageerror`, other.length === 0, other.slice(0, 2).join(' | '));
    check(`${eng} touch ${width} ResizeObserver exact pageerror 為 0`, ro.length === 0, `次數=${ro.length}`);
    console.log(`INFO  ${eng} touch ${width} ResizeObserver exact pageerror=${JSON.stringify(ro)} count=${ro.length}`);
    await context.close();
  }
  // 手機刻意隱藏 +/-、改用雙指縮放；另以產品真實的桌面斷點涵蓋 zoom，不覆寫 CSS 造出不存在的狀態。
  {
    const { context, page, errors } = await boot(browser, 1280);
    await page.click('#statBadge'); await settle(page);
    const statOpen = await page.evaluate(() => !document.getElementById('statPop').hidden);
    check(`${eng} 1280 桌面時鐘徽章可實際點開資料狀態卡`, statOpen);
    await page.click('#statPopClose'); await settle(page);
    const z = await page.evaluate(() => {
      const selectors = '#citySel,#randBtn,#statBadge,#viewDock button,.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out,.leaflet-control-zoom-in,.leaflet-control-zoom-out,#alertBanner button';
      const shown = e => {
        if (e.closest('[hidden],[inert]')) return false;
        const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (r.width <= 0 || r.height <= 0 || getComputedStyle(e).visibility === 'hidden') return false;
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === 'none' || Number(s.opacity) <= .05) return false;
          if (n !== e && n !== document.body && n !== document.documentElement) {
            const nr = n.getBoundingClientRect(), clippedX = /^(auto|scroll|hidden|clip)$/.test(s.overflowX), clippedY = /^(auto|scroll|hidden|clip)$/.test(s.overflowY);
            if ((clippedX && (cx < nr.left || cx > nr.right)) || (clippedY && (cy < nr.top || cy > nr.bottom))) return false;
          }
        }
        return true;
      };
      const items = [...document.querySelectorAll(selectors)].filter(shown).map(e => {
        const r = e.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { e, name: e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`,
          zoom: e.matches('.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out,.leaflet-control-zoom-in,.leaflet-control-zoom-out'),
          hit: at === e || e.contains(at), inViewport: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
          r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
      });
      const overlaps = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > .5 && h > .5) overlaps.push(`${a.name}×${b.name}:${Math.round(w * h)}`);
      }
      return { zoom: items.filter(x => x.zoom).length, overlaps,
        badHit: items.filter(x => !x.hit).map(x => x.name), out: items.filter(x => !x.inViewport).map(x => x.name),
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth };
    });
    check(`${eng} 1280 桌面真實 zoom 控制與既有可見控制幾何正常`, z.zoom >= 2 && !z.overlaps.length && !z.badHit.length && !z.out.length && z.overflow <= 1,
      `zoom=${z.zoom} overflow=${z.overflow} overlap=${z.overlaps.join(' | ') || '-'} hit=${z.badHit.join(',') || '-'} out=${z.out.join(',') || '-'}`);
    const ro = errors.filter(e => RO_LOOP.test(e));
    const other = errors.filter(e => !RO_LOOP.test(e));
    check(`${eng} 1280 zoom 幾何段無其他 pageerror`, other.length === 0, other.slice(0, 2).join(' | '));
    check(`${eng} 1280 zoom 幾何段 ResizeObserver exact pageerror 為 0`, ro.length === 0, `次數=${ro.length}`);
    await context.close();
  }
  await browser.close();
}

// 靜態與動態 close 的 aria-label 都要跟著語系翻譯，不只繁中有名字。
{
  const browser = await chromium.launch({ headless: true });
  const { context, page, errors } = await boot(browser, 360, 'en');
  const staticLabels = await page.evaluate(() => ['exploreClose', 'searchPanelClose', 'trackClose', 'fontClose'].map(id => document.getElementById(id).getAttribute('aria-label')));
  await page.evaluate(() => { openTodayPanel(); }); await settle(page);
  const today = await page.locator('#todayClose').getAttribute('aria-label');
  await setupFollow(page); await page.evaluate(() => openTripSharePanel()); await settle(page);
  const trip = await page.locator('#tripPanelClose').getAttribute('aria-label');
  check('英文語系六顆 close accessible name 都是 Close', [...staticLabels, today, trip].every(x => x === 'Close'), JSON.stringify([...staticLabels, today, trip]));
  check('英文 accessible-name 段零 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close(); await browser.close();
}

server.close();
console.log(`\n${failed ? `未過 ${failed} 條` : '全部通過'}`);
process.exitCode = failed ? 1 : 0;
