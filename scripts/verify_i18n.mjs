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
    const excluded = '.site-foot, #msAbout, .sys-chip, .addr, .feat, [data-lang], [data-source-lang], script, style, noscript, [hidden]';
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
      officialDestinationA: stationName('動物園站', 'mrt'),
      officialDestinationB: stationName('南港展覽館站', 'mrt'),
      route: routeName('高鐵', 'thsr_sched'),
      type: trainTypeName('自強'),
      count: document.getElementById('count').textContent.trim(),
      metadata: GROUPS.map(group => t(group.plate?.lead || '')).filter(Boolean),
      official: METRO_OFFICIAL.map(item => t(item.label)),
    }));
    assert(core.lang === 'en' && core.title === 'Rail Island', `英文基本狀態錯誤：${JSON.stringify(core)}`);
    assert(core.tabs.join('|') === 'All|TRA|HSR|Metro', `英文分頁錯誤：${core.tabs.join('|')}`);
    assert(core.topTabs.join('|') === 'All|TRA|HSR|Metro', `英文頂部分頁錯誤：${core.topTabs.join('|')}`);
    assert(core.lead.includes('railways across Taiwan') && core.station === 'Taipei', `英文首屏或站名錯誤：${JSON.stringify(core)}`);
    assert(core.officialDestinationA === 'Taipei Zoo' && core.officialDestinationB === 'Taipei Nangang Exhibition Center', `英文官方終點站「站」字尾 fallback 錯誤：${JSON.stringify(core)}`);
    assert(core.route.includes('High Speed Rail') && core.type.includes('Tze-Chiang'), `英文路線／車種錯誤：${JSON.stringify(core)}`);
    assert(/trains? running/.test(core.count) && core.metadata.every(text => !/[\u3400-\u9fff]/.test(text)) && core.official.every(text => !/[\u3400-\u9fff]/.test(text)), `英文動態列車數／系統導言／官方連結錯誤：${JSON.stringify(core)}`);
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
    assert(boardEn.includes('Taiwan High Speed Rail') && boardEn.includes('Bannan Line') && boardEn.includes('Airport MRT Line'), `英文轉乘路線未翻譯：${boardEn.slice(0, 500)}`);
    assert(!/undefined|\bi18n\./i.test(boardEn), `英文來車看板洩漏內部值：${boardEn}`);
    const attributionEn = await bodyText(page, '.leaflet-control-attribution');
    assert(attributionEn.includes('Taiwan outline: Ministry of the Interior') && !/[臺台]灣輪廓/.test(attributionEn), `英文地圖署名在圖層重繪後退回中文：${attributionEn}`);
    record(engine, '英文車站來車看板、轉乘路線與地圖署名');

    const metroBoards = await page.evaluate(() => {
      const lines = state.decoLines.length ? state.decoLines : state.lines;
      const candidate = lines.find(line => line.stations?.length > 1 && line._sysLabel);
      if (!candidate) return null;
      const li = lines.indexOf(candidate), station = { ...candidate.stations[0], sys: state.decoLines.length ? 'deco' : 'freq' };
      const destName = candidate.stations[candidate.stations.length - 1].name;
      const legacy = { kind: 'legacy', ln: candidate, li, ci: 0, t: state.simSec + 120, dtm: 120, destName };
      const coreView = { groups: [{ kind: 'legacy', ln: candidate, li, destName, rows: [legacy] }], stationLines: [{ ln: candidate, li, si: 0 }], linked: 0 };
      renderMetroCoreFreqBoard(document.getElementById('board'), station, lines, state.decoLines.length > 0, coreView);
      const core = document.getElementById('board').textContent.replace(/\s+/g, ' ').trim();
      const coreTitle = document.querySelector('#board .row')?.title || '';
      const trtcView = { groups: [{ kind: 'legacy', ln: candidate, li, destName, rows: [legacy] }], nowMs: Date.now() };
      renderTrtcOfficialFreqBoard(document.getElementById('board'), station, lines, state.decoLines.length > 0, trtcView);
      const official = document.getElementById('board').textContent.replace(/\s+/g, ' ').trim();
      const officialTitle = document.querySelector('#board .row')?.title || '';
      return { core, coreTitle, official, officialTitle };
    });
    assert(metroBoards && /Platform arrivals|Tap a linked service/.test(metroBoards.core), `英文 Metro Core 看板未翻譯：${JSON.stringify(metroBoards)}`);
    assert(/Taipei Metro services use the official live countdown/.test(metroBoards.official), `英文北捷官方倒數看板未翻譯：${JSON.stringify(metroBoards)}`);
    assert(/Follow service to/.test(metroBoards.coreTitle) && /Follow service to/.test(metroBoards.officialTitle), `英文捷運看板 title 未翻譯：${JSON.stringify(metroBoards)}`);
    const cjkMetroBoard = await visibleEnglishCjk(page, '#board');
    assert(cjkMetroBoard.length === 0, `英文捷運即時看板仍有中文：${cjkMetroBoard.join(' ｜ ')}`);
    record(engine, '英文捷運即時倒數、方向、路線與操作標籤');

    const tapPickerEn = await page.evaluate(() => {
      const line = (state.decoLines || state.lines || []).find(item => item._sys === 'mrt' && /淡水信義/.test(item.name || ''));
      if (!line || !line.pts?.length) return null;
      const stationIndex = line.stations.findIndex(item => item.name === '士林');
      const destinationIndex = line.stations.findIndex(item => item.name === '淡水');
      if (stationIndex < 0 || destinationIndex < 0) return null;
      const p = line.pts[stationIndex], st = line.stations[stationIndex];
      const previous = {
        mode: state.mode, lines: state.lines, visible: state.visible, hits: state._freqHits,
        roster: state.trtcOfficialRoster, follow: state.freqFollow,
      };
      try {
        state.mode = 'freq'; state.lines = [line]; state.visible = new Set([line.id]); state.freqFollow = null;
        state.trtcOfficialRoster = { vehicles: [{ vehicleId: 'i18n-picker', officialNo: '107', dest: destinationIndex }] };
        state._freqHits = [{ x: p.x, y: p.y, ln: line, vehicleId: 'i18n-picker', officialNo: '107', halfW: 24, halfH: 10 }];
        map.fire('click', { containerPoint: L.point(p.x, p.y), latlng: L.latLng(st.lat, st.lon) });
        return document.getElementById('tapPick').textContent.replace(/\s+/g, ' ').trim();
      } finally {
        state.mode = previous.mode; state.lines = previous.lines; state.visible = previous.visible;
        state._freqHits = previous.hits; state.trtcOfficialRoster = previous.roster; state.freqFollow = previous.follow;
        const picker = document.getElementById('tapPick'); picker.hidden = true; picker.innerHTML = '';
      }
    });
    assert(tapPickerEn && tapPickerEn.includes('Follow train') && tapPickerEn.includes('Taipei Metro') && tapPickerEn.includes('Tamsui') && tapPickerEn.includes('Shilin') && tapPickerEn.includes('Station board'), `英文地圖點選列車／車站卡未翻譯：${tapPickerEn}`);
    assert(!/[\u3400-\u9fff]/.test(tapPickerEn), `英文地圖點選卡仍有中文：${tapPickerEn}`);
    record(engine, '英文地圖點選列車、方向、終點與車站看板');

    const metroWaitEn = await page.evaluate(() => {
      const previousPlugin = window.Capacitor;
      window.Capacitor = { Plugins: { RailMetroWait: { start: () => Promise.resolve({ ok: true }), stop: () => Promise.resolve({ ok: true }) } } };
      const st = { name: '動物園', sys: 'freq' };
      const bundle = { rows: [
        { dest: '南港展覽館', eta: Math.floor(Date.now() / 1000) + 120 },
        { dest: '淡水', eta: Math.floor(Date.now() / 1000) + 240 },
      ], dataAt: Math.floor(Date.now() / 1000) };
      state.metroWait = null;
      const start = (() => { const host = document.createElement('div'); host.innerHTML = metroWaitBoardHtml(st, 'trtc'); return host.textContent.trim(); })();
      state.metroWait = { sys: 'trtc', station: st.name };
      const end = (() => { const host = document.createElement('div'); host.innerHTML = metroWaitBoardHtml(st, 'trtc'); return host.textContent.trim(); })();
      state.metroWait = null;
      metroWaitOpenPicker('trtc', st, [], false, bundle, null);
      const picker = document.getElementById('metroWaitPicker').textContent.replace(/\s+/g, ' ').trim();
      metroWaitClosePicker(false);
      window.Capacitor = previousPlugin;
      return { start, end, picker };
    });
    const metroWaitEnText = Object.values(metroWaitEn).join(' ');
    assert(metroWaitEn.start === 'Track this station' && metroWaitEn.end === 'End tracking' && metroWaitEn.picker.includes('Track for') && metroWaitEn.picker.includes('Choose a direction') && metroWaitEn.picker.includes('Nangang Exhibition Center'), `英文追蹤這站／等車選單未翻譯：${JSON.stringify(metroWaitEn)}`);
    assert(!/[\u3400-\u9fff]/.test(metroWaitEnText), `英文追蹤這站仍有中文：${metroWaitEnText}`);
    record(engine, '英文追蹤這站、結束追蹤與等車方向／時長選單');

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
      state.hazardWatch = null;
      renderAlertBanner();
    });
    const alertEn = await bodyText(page, '#alertBanner');
    assert(/service|disruption|operating/i.test(alertEn), `英文營運異常橫幅未翻譯：${alertEn}`);
    await page.locator('#alertBanner').click();
    const alertDetailEn = await bodyText(page, '#alertDetail');
    assert(/Network .*failed/i.test(alertDetailEn), `英文異常詳情未翻譯：${alertDetailEn}`);
    record(engine, '英文營運異常與資料降級文字');

    await page.evaluate(() => {
      state.alert = { list: [] }; state.metroAlert = { list: [] };
      state.hazardWatch = { stale: true, list: [
        { id: 'rain', type: '降雨', updated: '1', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        { id: 'wind', type: '強風', updated: '1', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      ] };
      renderAlertBanner(); renderAlertDetail(); document.getElementById('alertDetail').hidden = false;
    });
    const hazardEn = `${await bodyText(page, '#alertBanner')} ${await bodyText(page, '#alertDetail')}`;
    assert(hazardEn.includes('Rainfall') && hazardEn.includes('Strong wind') && hazardEn.includes('enhanced monitoring') && hazardEn.includes('do not mean that train service has been suspended') && hazardEn.includes('temporarily unavailable'), `英文災害監看內容未翻譯：${hazardEn}`);
    assert(!/[\u3400-\u9fff]/.test(hazardEn), `英文災害監看仍有中文：${hazardEn}`);
    await page.evaluate(() => { state.hazardWatch = null; document.getElementById('alertDetail').hidden = true; renderAlertBanner(); });
    record(engine, '英文災害類型、監看說明與 stale 降級');

    await page.evaluate(() => {
      state.plus = { active: false, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null };
      document.getElementById('plusModal').hidden = false;
      plusRender();
    });
    const plusEn = await bodyText(page, '#plusModal');
    assert(/renew automatically/i.test(plusEn) && /remain free/i.test(plusEn), `英文通行證決策文字不完整：${plusEn.slice(0, 800)}`);
    assert(plusEn.includes('Privacy Policy') && plusEn.includes('Terms of Use'), `英文 Plus 法務連結未翻譯：${plusEn}`);
    record(engine, '英文 Plus、續訂、免費層與法務入口');

    const dynamicEn = await page.evaluate(() => {
      document.getElementById('plusModal').hidden = true;

      const takeout = document.getElementById('takeoutModal');
      takeout.hidden = false;
      i18nTranslateTree(takeout);
      state.takeoutResult = {
        files: ['saved.csv'], outside: [], incomplete: [], includeUnshown: false,
        resolved: [{ selected: true, title: 'My station', list: 'Weekend list', coord: { lat: 25.0478, lon: 121.517 }, url: '' }],
      };
      takeoutRenderPreview();
      const takeoutText = takeout.textContent.replace(/\s+/g, ' ').trim();
      takeout.hidden = true;

      const account = document.getElementById('accountModal');
      account.hidden = false;
      state.account = { ready: true, user: null, error: '' };
      accountRender();
      i18nTranslateTree(account);
      const accountText = account.textContent.replace(/\s+/g, ' ').trim();
      account.hidden = true;

      const fav = document.getElementById('favPanel');
      fav.hidden = false;
      renderFavPanel();
      const favText = fav.textContent.replace(/\s+/g, ' ').trim();
      const favStored = favTrainLabel({ train: '1', sys: 'tra_sched', label: '平原號　臺北→枋寮' });
      fav.hidden = true;

      const stationCode = Object.keys(state.stnIdToName || {}).find(code => /[臺台]北/.test(state.stnIdToName[code])) || '1000';
      const today = document.getElementById('todayPanel');
      today.hidden = false;
      state.todayBoard = [{ no: '9998', delayMax: 12, delay: 5, sta: stationCode, status: 1, at: '2026-08-28T11:00:00' }];
      state._todayTried = true; state._todayFetching = false;
      renderTodayPanel();
      const todayText = today.textContent.replace(/\s+/g, ' ').trim();
      today.hidden = true;

      const day = todayStr('Asia/Taipei');
      _events = [{ id: 'verify-source', title: '官方中文活動', start: day, end: day,
        anchor: { kind: 'station', sys: 'tra_sched', name: '臺北' }, source: 'official' }];
      const eventHost = document.createElement('div');
      eventHost.innerHTML = eventSecHtml();
      const eventText = eventHost.textContent.replace(/\s+/g, ' ').trim();
      const eventMarked = !!eventHost.querySelector('[data-source-lang="zh-TW"]');
      return { takeoutText, accountText, favText, favStored, todayText, eventText, eventMarked };
    });
    assert(dynamicEn.takeoutText.includes('Import Google saved lists') && dynamicEn.takeoutText.includes('My station'), `英文 Takeout 匯入流程未翻譯：${dynamicEn.takeoutText}`);
    assert(dynamicEn.accountText.includes('Sign in to sync') && dynamicEn.accountText.includes('Sign in with Google'), `英文帳號入口未翻譯：${dynamicEn.accountText}`);
    assert(dynamicEn.favText.includes('My favourites') && dynamicEn.favStored.includes('Plains Explorer') && dynamicEn.favStored.includes('Taipei'), `英文最愛動態內容未翻譯：${JSON.stringify(dynamicEn)}`);
    assert(dynamicEn.todayText.includes('TRA today') && dynamicEn.todayText.includes('5 min late') && dynamicEn.todayText.includes('Taipei'), `英文今日台鐵動態未翻譯：${dynamicEn.todayText}`);
    assert(dynamicEn.eventMarked && dynamicEn.eventText.includes('Recent events (Chinese source text)') && dynamicEn.eventText.includes('Chinese source text'), `中文原文活動未清楚標示：${dynamicEn.eventText}`);
    record(engine, '英文最愛、今日台鐵、Takeout、帳號與中文原文活動標示');

    await page.waitForFunction(() => state.special?.namedTrains?.length && state.special?.rollingStock?.length);
    const contentEn = await page.evaluate(() => {
      const asText = html => { const node = document.createElement('div'); node.innerHTML = html; return node.textContent.replace(/\s+/g, ' ').trim(); };
      const shanlan = state.special.namedTrains.find(item => item.id === 'shanlan');
      renderNamedIntro(shanlan);
      const stock = state.special.rollingStock.find(item => state.trains.some(train => item.carNames.includes(train.carName)));
      const stockTrain = stock && state.trains.find(train => stock.carNames.includes(train.carName));
      if (stockTrain) renderTrainCard(stockTrain);
      document.getElementById('plusModal').hidden = true;
      openHelp();
      document.querySelectorAll('.site-foot details').forEach(detail => { detail.open = true; });
      const footerCjk = [];
      const footerWalker = document.createTreeWalker(document.querySelector('.site-foot'), NodeFilter.SHOW_TEXT);
      let footerNode;
      while ((footerNode = footerWalker.nextNode())) {
        const value = footerNode.nodeValue.replace(/\s+/g, ' ').trim(), parent = footerNode.parentElement;
        if (!value || !/[\u3400-\u9fff]/.test(value) || !parent) continue;
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width && rect.height) footerCjk.push(value);
      }
      const achievementHost = document.createElement('div');
      achievementHost.id = 'verifyAchv'; achievementHost.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999;background:white;padding:8px';
      achievementHost.innerHTML = buildAchv([], 'chip'); document.body.appendChild(achievementHost);
      return {
        station: asText(stationIntroText('十分')),
        named: document.getElementById('searchDrop').textContent.replace(/\s+/g, ' ').trim(),
        train: stockTrain ? document.getElementById('tcIntro').textContent.replace(/\s+/g, ' ').trim() : '',
        stamps: asText(buildStamps([])),
        achievements: asText(buildAchv([], 'chip')),
        achievementTitles: [...achievementHost.querySelectorAll('.achv-chip')].map(item => item.title),
        achievementLabels: [...achievementHost.querySelectorAll('.achv-chip')].map(item => item.getAttribute('aria-label')),
        help: document.getElementById('helpBody').textContent.replace(/\s+/g, ' ').trim(),
        footer: document.querySelector('.site-foot').textContent.replace(/\s+/g, ' ').trim(),
        recent: document.querySelector('.foot-recent').textContent.replace(/\s+/g, ' ').trim(),
        history: document.querySelector('.foot-more').textContent.replace(/\s+/g, ' ').trim(),
        footerCjk: [...new Set(footerCjk)],
      };
    });
    assert(contentEn.station.includes('Station highlight') && contentEn.station.includes('sky-lantern'), `英文特色車站未翻譯：${contentEn.station}`);
    assert(contentEn.named.includes('Shanlan') && contentEn.named.includes('East Rift Valley'), `英文觀光列車圖鑑未翻譯：${contentEn.named}`);
    assert(contentEn.train && !/undefined|i18n\./i.test(contentEn.train), `英文特色車種卡未正確渲染：${contentEn.train}`);
    assert(/Breezy\s*Blue/.test(contentEn.stamps) && /Pingxi\s*Line/.test(contentEn.stamps) && contentEn.stamps.includes('EMU3000'), `英文護照圖鑑未翻譯：${contentEn.stamps}`);
    await page.locator('#verifyAchv .achv-chip').first().hover();
    assert(contentEn.achievements.includes('First journey') && contentEn.achievementTitles.includes('Complete your first full journey') && contentEn.achievementLabels.some(label => label.includes('First journey') && label.includes('Complete your first full journey')), `英文成就 hover／輔助說明未翻譯：${JSON.stringify(contentEn.achievementTitles.slice(0, 3))}`);
    await page.evaluate(() => document.getElementById('verifyAchv')?.remove());
    assert(contentEn.help.includes('Search stations, train numbers and train names') && contentEn.help.includes('Journey Passport and completion stamps') && contentEn.help.includes('Background music'), `英文使用說明未完整翻譯：${contentEn.help.slice(0, 1000)}`);
    assert(contentEn.footer.includes('Data sources and licences') && contentEn.footer.includes('independent hobby project'), `英文資料來源介紹未翻譯：${contentEn.footer.slice(-1200)}`);
    assert(contentEn.footerCjk.length === 0, `英文頁尾展開後仍有中文：${contentEn.footerCjk.join(' ｜ ')}`);
    assert(contentEn.recent.includes('English and Japanese now cover') && contentEn.history.includes('Earlier updates by topic') && contentEn.history.includes('Map and live data'), `英文公開更新紀錄未精簡翻譯：${contentEn.recent} ｜ ${contentEn.history}`);
    record(engine, '英文品牌、說明、特色站車、圖鑑、護照、成就與精簡更新紀錄');

    // 選單保持開啟時切換語言，驗證不是只在下次開啟／重整才更新。
    await page.evaluate(() => {
      window.__verifyMetroWaitCapacitor = window.Capacitor;
      window.__verifyNativeLanguageCalls = [];
      window.Capacitor = { Plugins: {
        RailMetroWait: {},
        RailLanguage: { setLanguage: payload => { window.__verifyNativeLanguageCalls.push(payload.language); return Promise.resolve(); } },
      } };
      metroWaitOpenPicker('trtc', { name: '動物園', sys: 'freq' }, [], false, { rows: [
        { dest: '南港展覽館', eta: Math.floor(Date.now() / 1000) + 120 },
        { dest: '淡水', eta: Math.floor(Date.now() / 1000) + 240 },
      ], dataAt: Math.floor(Date.now() / 1000) }, null);
    });
    await setLanguage(page, 'ja');
    const immediate = await page.evaluate(() => ({
      title: document.title,
      tabs: [...document.querySelectorAll('#systems button')].map(button => button.textContent.trim()),
      station: stationName('臺北', 'tra_sched'),
      board: document.getElementById('board').textContent,
      plus: document.getElementById('plusModal').textContent,
      help: document.getElementById('helpBody').textContent.replace(/\s+/g, ' ').trim(),
      named: document.getElementById('searchDrop').textContent.replace(/\s+/g, ' ').trim(),
      achievements: (() => { const node = document.createElement('div'); node.innerHTML = buildAchv([], 'chip'); return node.textContent.replace(/\s+/g, ' ').trim(); })(),
      achievementTitles: (() => { const node = document.createElement('div'); node.innerHTML = buildAchv([], 'chip'); return [...node.querySelectorAll('.achv-chip')].map(item => item.title); })(),
      officialDestination: stationName('動物園站', 'mrt'),
      history: document.querySelector('.foot-more').textContent.replace(/\s+/g, ' ').trim(),
      metroWait: document.getElementById('metroWaitPicker').textContent.replace(/\s+/g, ' ').trim(),
      nativeLanguage: window.__verifyNativeLanguageCalls.at(-1),
    }));
    assert(immediate.title === '軌島' && immediate.tabs.join('|') === '全|台鉄|高鉄|メトロ', `日文即時切換失敗：${JSON.stringify(immediate)}`);
    assert(immediate.station === '台北', `日文官方站名未套用：${immediate.station}`);
    assert(immediate.help.includes('駅・列車番号・列車名を検索') && immediate.help.includes('旅程パスポートと完乗スタンプ'), '已開啟使用說明沒有跟著即時切成日文');
    assert(immediate.named.includes('山嵐号') && immediate.named.includes('花東縦谷'), '已開啟觀光列車介紹沒有跟著即時切成日文');
    assert(immediate.achievements.includes('初乗り記念') && immediate.history.includes('これまでの更新'), '日文成就或精簡更新歷史未翻譯');
    assert(immediate.achievementTitles.includes('最初の完乗を達成') && immediate.officialDestination === '動物園', `日文成就 hover 或官方終點站 fallback 未翻譯：${JSON.stringify(immediate)}`);
    assert(immediate.metroWait.includes('追跡時間') && immediate.metroWait.includes('方向を選択') && immediate.metroWait.includes('南港展覧館') && !immediate.metroWait.includes('追蹤'), `日文等車選單未即時翻譯：${immediate.metroWait}`);
    assert(immediate.nativeLanguage === 'ja', `網頁語言沒有同步到 iPhone 小工具／即時動態：${immediate.nativeLanguage}`);
    await page.evaluate(() => {
      metroWaitClosePicker(false);
      window.Capacitor = window.__verifyMetroWaitCapacitor;
      delete window.__verifyMetroWaitCapacitor;
      delete window.__verifyNativeLanguageCalls;
    });
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
    const dataDetails = page.locator('#msAbout details').filter({ hasText: 'Data sources and licences' }).first();
    await dataDetails.locator('summary').tap();
    const mobileAbout = (await dataDetails.innerText()).replace(/\s+/g, ' ').trim();
    assert(mobileAbout.includes('Data sources and licences') && mobileAbout.includes('independent hobby project'), `${width}px 手機品牌／資料來源介紹未翻譯：${mobileAbout.slice(-1000)}`);

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
