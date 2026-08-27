import { chromium, webkit } from 'playwright';

const BASE = process.env.RAIL_I18N_URL || 'http://127.0.0.1:5178/';
const results = [];
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function record(engine, scenario, detail = '') {
  results.push({ engine, scenario, detail });
  console.log(`✓ ${engine} · ${scenario}${detail ? ` · ${detail}` : ''}`);
}
async function preparePage(context) {
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready && (state.trains.length || state.lines.length), null, { timeout: 90_000 });
  return { page, pageErrors };
}
async function setLanguage(page, lang) {
  await page.evaluate(value => window.__i18n.setLanguage(value), lang);
  await page.waitForFunction(value => document.documentElement.lang === value, lang);
}
async function bodyText(page, selector) {
  return (await page.locator(selector).innerText()).replace(/\s+/g, ' ').trim();
}
async function visibleEnglishCjk(page, rootSelector = 'body') {
  return page.evaluate(rootSelector => {
    const root = document.querySelector(rootSelector);
    if (!root) return [`找不到 ${rootSelector}`];
    const excluded = '.site-foot, #msAbout, .sys-chip, .addr, .feat, [data-lang], script, style, noscript, [hidden]';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!text || !/[\u3400-\u9fff]/.test(text) || !parent || parent.closest(excluded)) continue;
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= .05 || rect.width < 2 || rect.height < 2) continue;
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue;
      found.push(text);
    }
    for (const el of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
      if (el.closest(excluded)) continue;
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= .05 || rect.width < 2 || rect.height < 2) continue;
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const value = el.getAttribute(attr) || '';
        if (/[\u3400-\u9fff]/.test(value)) found.push(`@${attr}: ${value}`);
      }
    }
    return [...new Set(found)];
  }, rootSelector);
}

async function desktopCore(browser, engine) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
  const { page, pageErrors } = await preparePage(context);
  try {
    await setLanguage(page, 'en');
    const core = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title,
      tabs: [...document.querySelectorAll('#systems button')].map(button => button.textContent.trim()),
      topTabs: [...document.querySelectorAll('#topTabs button')].map(button => button.textContent.trim()),
      lead: document.getElementById('lead').textContent.trim(),
      station: stationName('臺北', 'tra_sched'),
      route: routeName('高鐵', 'thsr_sched'),
      type: trainTypeName('自強'),
    }));
    assert(core.lang === 'en' && core.title === 'Rail Island', `英文基本狀態錯誤：${JSON.stringify(core)}`);
    assert(core.tabs.join('|') === 'All|TRA|HSR|Metro', `英文分頁錯誤：${core.tabs.join('|')}`);
    assert(core.topTabs.join('|') === 'All|TRA|HSR|Metro', `英文頂部分頁錯誤：${core.topTabs.join('|')}`);
    assert(core.lead.includes('railways across Taiwan') && core.station === 'Taipei', `英文首屏或站名錯誤：${JSON.stringify(core)}`);
    assert(core.route.includes('High Speed Rail') && core.type.includes('Tze-Chiang'), `英文路線／車種錯誤：${JSON.stringify(core)}`);
    const cjkCore = await visibleEnglishCjk(page);
    assert(cjkCore.length === 0, `英文可見核心仍有中文：${cjkCore.join(' ｜ ')}`);
    record(engine, '英文首屏、分頁、站名、路線與車種');

    await page.locator('#trainSearch').fill('Taipei');
    await page.locator('#trainSearch').dispatchEvent('input');
    await page.waitForFunction(() => !document.getElementById('searchDrop').hidden && document.getElementById('searchDrop').textContent.includes('Taipei'));
    const searchText = await bodyText(page, '#searchDrop');
    assert(searchText.includes('Taipei') && searchText.includes('臺北'), `英文站名搜尋未保留雙語辨識：${searchText}`);
    await page.evaluate(() => closeSearchDrop());
    record(engine, '外語站名搜尋');

    const opened = await page.evaluate(() => {
      const station = state.schedStations.find(item => item.sys === 'tra_sched' && /[臺台]北/.test(item.name));
      if (!station) return false;
      openBoard(station);
      return true;
    });
    assert(opened, '找不到臺北測試站');
    await page.waitForFunction(() => !document.getElementById('board').hidden);
    const boardEn = await bodyText(page, '#board');
    assert(boardEn.includes('Taipei') && boardEn.includes('Arrivals in the next 3 hours'), `英文來車看板未即時翻譯：${boardEn.slice(0, 500)}`);
    assert(!/undefined|\bi18n\./i.test(boardEn), `英文來車看板洩漏內部值：${boardEn}`);
    record(engine, '英文車站來車看板');

    const followed = await page.evaluate(() => {
      const train = state.trains.find(item => !item.loop && item.sys === 'tra_sched') || state.trains.find(item => !item.loop);
      if (!train) return false;
      setFollow(train, false, true);
      return true;
    });
    assert(followed, '找不到可跟隨列車');
    await page.waitForFunction(() => !document.getElementById('followPanel').hidden);
    const followEn = await bodyText(page, '#followPanel');
    assert(/Next station|On time|Running|Terminus|arrives|Departs/i.test(followEn), `英文跟隨卡缺核心動態文字：${followEn}`);
    assert(!/undefined|\bi18n\./i.test(followEn), `英文跟隨卡洩漏內部值：${followEn}`);
    record(engine, '英文列車跟隨卡');

    await page.evaluate(() => {
      state.alert = { list: [{ sysLabel: '台鐵', title: '營運通阻公告', desc: '網路連線失敗，請稍後再試', lines: ['高鐵'] }] };
      renderAlertBanner();
    });
    const alertEn = await bodyText(page, '#alertBanner');
    assert(/service|disruption|operating/i.test(alertEn), `英文營運異常橫幅未翻譯：${alertEn}`);
    await page.locator('#alertBanner').click();
    const alertDetailEn = await bodyText(page, '#alertDetail');
    assert(/Network .*failed/i.test(alertDetailEn), `英文異常詳情未翻譯：${alertDetailEn}`);
    record(engine, '英文營運異常與資料降級文字');

    await page.evaluate(() => {
      state.plus = { active: false, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null };
      document.getElementById('plusModal').hidden = false;
      plusRender();
    });
    const plusEn = await bodyText(page, '#plusModal');
    assert(/renew automatically/i.test(plusEn) && /remain free/i.test(plusEn), `英文通行證決策文字不完整：${plusEn.slice(0, 800)}`);
    assert(plusEn.includes('Privacy Policy') && plusEn.includes('Terms of Use'), `英文 Plus 法務連結未翻譯：${plusEn}`);
    record(engine, '英文 Plus、續訂、免費層與法務入口');

    await setLanguage(page, 'ja');
    const immediate = await page.evaluate(() => ({
      title: document.title,
      tabs: [...document.querySelectorAll('#systems button')].map(button => button.textContent.trim()),
      station: stationName('臺北', 'tra_sched'),
      board: document.getElementById('board').textContent,
      plus: document.getElementById('plusModal').textContent,
    }));
    assert(immediate.title === '軌島' && immediate.tabs.join('|') === '全|台鉄|高鉄|メトロ', `日文即時切換失敗：${JSON.stringify(immediate)}`);
    assert(immediate.station === '台北', `日文官方站名未套用：${immediate.station}`);
    assert(immediate.plus.includes('自動更新') && immediate.plus.includes('無料'), '已開啟 Plus 面板沒有跟著即時切成日文');
    record(engine, '日文即時切換（已開啟動態面板同步）');

    await page.evaluate(() => onLocateFail({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
    const toastJa = await bodyText(page, '#toasts');
    assert(toastJa.includes('位置情報') && toastJa.includes('ピン'), `日文定位錯誤／落釘降級提示未翻譯：${toastJa}`);
    record(engine, '日文定位權限／錯誤與落釘降級提示');

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready, null, { timeout: 90_000 });
    assert(await page.getAttribute('html', 'lang') === 'ja', '手動選擇日文後，無 lang query 重整未保存');
    record(engine, 'localStorage 手動語言優先與重整保存');
    assert(pageErrors.length === 0, `pageerror：${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function navigatorDetection(browser, engine) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'ja-JP' });
  const { page, pageErrors } = await preparePage(context);
  try {
    assert(await page.getAttribute('html', 'lang') === 'ja', '首次開啟沒有依 navigator.language 選日文');
    assert((await bodyText(page, '#lead')).length > 20, '日文首次首屏沒有內容');
    assert(pageErrors.length === 0, `pageerror：${pageErrors.join(' | ')}`);
    record(engine, '首次依 navigator.language 選語言');
  } finally {
    await context.close();
  }
}

async function legalPages(browser, engine) {
  const mobile = engine === 'WebKit';
  const context = await browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1024, height: 900 }, locale: 'zh-TW', isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto(new URL('privacy.html?lang=en', BASE).href, { waitUntil: 'domcontentloaded' });
    assert(await page.getAttribute('html', 'lang') === 'en', '英文隱私頁 lang 錯誤');
    const privacyEn = await bodyText(page, 'main');
    assert(privacyEn.includes('Raw coordinates obtained directly from system location do not leave your device') && privacyEn.includes('does not sell personal data'), '英文隱私頁缺少定位／資料用途核心條款');
    assert(!/[\u3400-\u9fff]/.test(privacyEn), `英文隱私頁仍有中文：${privacyEn.match(/[\u3400-\u9fff][^.!?]{0,80}/)?.[0] || ''}`);
    assert((await page.locator('a[href*="terms.html"]').first().getAttribute('href')).includes('lang=en'), '法務頁連結沒有保留語言');

    await page.goto(new URL('terms.html?lang=en', BASE).href, { waitUntil: 'domcontentloaded' });
    const termsEn = await bodyText(page, 'main');
    assert(termsEn.includes('auto-renewing') && termsEn.includes('Deleting a Rail Island account does not cancel'), '英文服務條款缺少自動續訂／刪帳不取消核心說明');
    assert(!/[\u3400-\u9fff]/.test(termsEn), `英文條款頁仍有中文：${termsEn.match(/[\u3400-\u9fff][^.!?]{0,80}/)?.[0] || ''}`);

    await page.goto(new URL('privacy.html?lang=ja', BASE).href, { waitUntil: 'domcontentloaded' });
    const privacyJa = await bodyText(page, 'main');
    assert(await page.getAttribute('html', 'lang') === 'ja' && privacyJa.includes('システム位置情報から直接得た生の座標は端末外へ送信しません') && privacyJa.includes('個人データを販売せず'), '日文隱私頁核心條款未翻譯');
    await page.goto(new URL('terms.html?lang=ja', BASE).href, { waitUntil: 'domcontentloaded' });
    const termsJa = await bodyText(page, 'main');
    assert(termsJa.includes('自動更新サブスクリプション') && termsJa.includes('自動解約'), '日文服務條款核心說明未翻譯');
    assert(pageErrors.length === 0, `法務頁 pageerror：${pageErrors.join(' | ')}`);
    record(engine, '隱私權政策與服務條款（英文／日文）');
  } finally {
    await context.close();
  }
}

async function controlAudit(page, scopeSelector = 'body') {
  return page.evaluate(scope => {
    const root = document.querySelector(scope);
    if (!root) return { missing: scope, overflow: 0, blocked: [], overlaps: [] };
    const all = [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [role="button"]')];
    const visible = all.filter(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .05 && style.pointerEvents !== 'none' &&
        rect.width >= 4 && rect.height >= 4 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    });
    const blocked = [];
    for (const el of visible) {
      const rect = el.getBoundingClientRect();
      const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit))) blocked.push(el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24));
    }
    const overlaps = [];
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const w = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const h = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (w > 3 && h > 3) overlaps.push(`${a.id || a.textContent.trim().slice(0, 12)}↔${b.id || b.textContent.trim().slice(0, 12)} (${Math.round(w)}×${Math.round(h)})`);
    }
    return { overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), blocked, overlaps, visible: visible.length };
  }, scopeSelector);
}

async function assertAudit(page, scope, label, allowInitiallyClipped = false) {
  const audit = await controlAudit(page, scope);
  assert(!audit.missing, `${label} 找不到 audit scope：${audit.missing}`);
  assert(audit.overflow <= 1, `${label} 水平溢出 ${audit.overflow}px`);
  if (!allowInitiallyClipped) assert(audit.blocked.length === 0, `${label} 控制項中心不可點：${audit.blocked.join(', ')}`);
  assert(audit.overlaps.length === 0, `${label} 控制項重疊：${audit.overlaps.join(', ')}`);
  return audit.visible;
}

async function scrollableControlsReachable(page, rootSelector) {
  return page.evaluate(async rootSelector => {
    const root = document.querySelector(rootSelector);
    const controls = root ? [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])')] : [];
    const blocked = [];
    for (const el of controls) {
      const style = getComputedStyle(el);
      if (el.closest('[hidden]') || style.display === 'none' || style.visibility === 'hidden' ||
        (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue;
      el.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
      if (!hit || !(hit === el || el.contains(hit))) blocked.push(el.id || el.textContent.trim().slice(0, 24));
    }
    return blocked;
  }, rootSelector);
}

async function mobileScenario(browser, engine, width) {
  const height = width === 768 ? 1024 : 844;
  const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-TW', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const { page, pageErrors } = await preparePage(context);
  try {
    assert(await page.evaluate(() => document.body.classList.contains('fs')), `${width}px 手機態沒有 body.fs`);
    const baseVisible = await assertAudit(page, 'body', `${engine} ${width}px 預設態`);

    await page.evaluate(() => {
      state.alert = { list: [{ sysLabel: '台鐵', title: '營運通阻公告', desc: '網路連線失敗，請稍後再試', lines: [] }] };
      renderAlertBanner();
    });
    await assertAudit(page, '.stage', `${engine} ${width}px 橫幅態`);

    await page.tap('#tabMore');
    await page.waitForFunction(() => document.body.classList.contains('tools-open'));
    const moreVisible = await assertAudit(page, '#moreSheet', `${engine} ${width}px 更多設定`, true);
    const unreachable = await scrollableControlsReachable(page, '#moreSheet');
    assert(unreachable.length === 0, `${engine} ${width}px 更多設定裁切不可點：${unreachable.join(', ')}`);
    await page.locator('#msLangSeg').scrollIntoViewIfNeeded();
    await page.tap('#msLangSeg button[data-lang="en"]');
    assert(await page.getAttribute('html', 'lang') === 'en', `${width}px page.tap 英文切換失敗`);
    assert((await bodyText(page, '#tabMore .tl')) === 'More', `${width}px 動態 tab 未立即更新`);
    const cjkSettings = await visibleEnglishCjk(page, '#moreSheet');
    assert(cjkSettings.length === 0, `${width}px 英文設定仍有中文：${cjkSettings.join(' ｜ ')}`);

    await page.tap('#moreClose');
    await page.tap('#tabRide');
    await page.waitForFunction(() => !document.getElementById('ridePanel').hidden);
    await assertAudit(page, '#ridePanel', `${engine} ${width}px 護照 sheet`);
    const rideText = await bodyText(page, '#ridePanel');
    assert(rideText.includes('Travel passport') && !rideText.includes('還沒有完乘記錄'), `${width}px 護照 sheet 未即時翻譯：${rideText}`);

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready, null, { timeout: 90_000 });
    assert(await page.getAttribute('html', 'lang') === 'en', `${width}px 無 query 重整未保留手動英文`);
    assert(pageErrors.length === 0, `${width}px pageerror：${pageErrors.join(' | ')}`);
    record(engine, `手機 ${width}px：觸控切換、橫幅、設定與 sheet`, `${baseVisible}/${moreVisible} 個可見控制項`);
  } finally {
    await context.close();
  }
}

for (const [engine, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
    if (engine === 'Chromium') {
      await desktopCore(browser, engine);
      await navigatorDetection(browser, engine);
      await legalPages(browser, engine);
      for (const width of [360, 375, 414, 768]) await mobileScenario(browser, engine, width);
    } else {
      await navigatorDetection(browser, engine);
      await legalPages(browser, engine);
      for (const width of [375, 768]) await mobileScenario(browser, engine, width);
    }
  } catch (error) {
    failures.push(`${engine}：${error.stack || error.message}`);
    console.error(`✗ ${engine}：${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

if (failures.length) {
  console.error('\ni18n 瀏覽器驗證失敗：');
  failures.forEach(message => console.error(message));
  process.exit(1);
}
console.log(`\ni18n 瀏覽器驗證通過：${results.length} 個情境。`);
