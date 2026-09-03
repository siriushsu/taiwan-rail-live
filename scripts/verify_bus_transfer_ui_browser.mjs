import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = process.env.WORKSPACE_NODE_MODULES;
const playwrightUrl = modules
  ? pathToFileURL(path.join(modules, 'playwright/index.mjs')).href
  : 'playwright';
const { chromium, webkit } = await import(playwrightUrl);
const BASE = process.env.BUS_UI_BASE || 'http://127.0.0.1:8793';

const pass = message => console.log(`✓ ${message}`);
const stats = async () => {
  const response = await fetch(`${BASE}/__bus-test-stats`);
  assert.equal(response.ok, true);
  return response.json();
};

async function openStation(page, query, expected = query, system = '台鐵') {
  const start = page.getByRole('button', { name: '開始看車' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const input = page.locator('#trainSearch');
  if (!await input.isVisible()) await page.locator('#tabSearch').tap();
  await input.fill(query);
  const rows = page.locator('.stn-row');
  await rows.first().waitFor({ state: 'visible' });
  const target = rows.filter({ hasText: expected }).filter({ hasText: system }).first();
  assert.equal(await target.count(), 1, `找不到 ${system} ${expected}`);
  await target.click();
  await page.locator('[data-bus-transfer-slot]').waitFor({ state: 'visible' });
}

const openTainan = page => openStation(page, '臺南');

async function touchAndLayout(browserType, engine, width) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(`${BASE}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
    await openTainan(page);
    const before = await stats();
    assert.equal(await page.getByRole('button', { name: '查看現在可搭公車' }).isVisible(), true);
    assert.equal((await stats()).station, before.station, '只開站不得查公車');

    const transferResponse = page.waitForResponse(response => response.url().includes('/api/bus-transfer'));
    await page.tap('button.btu-primary');
    await transferResponse;
    await page.locator('.btu-rowbtn').first().waitFor({ state: 'visible' });
    const afterStation = await stats();
    assert.equal(afterStation.station, before.station + 1);
    assert.equal(afterStation.leg, before.leg);

    // 看板 20 模擬秒會整段重建；主動重畫一次，必須保存資料且不能重打 API。
    await page.evaluate(() => renderBoard());
    await page.locator('.btu-rowbtn').first().waitFor({ state: 'visible' });
    assert.deepEqual(await stats(), afterStation);
    const retained = await page.evaluate(() => window.BusTransferUI.getState('TRA:4220').phases.length);
    assert.equal(retained, 1, 'DOM 重繪後只保留一個活著的 UI instance');

    const legResponse = page.waitForResponse(response => response.url().includes('/api/bus-leg-live'));
    await page.locator('.btu-rowbtn').first().tap();
    await legResponse;
    await page.getByText('TNN-001', { exact: true }).waitFor({ state: 'visible' });
    const afterLeg = await stats();
    assert.equal(afterLeg.station, afterStation.station);
    assert.equal(afterLeg.leg, afterStation.leg + 1);
    assert.equal(await page.getByText('車上普通', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText(/來源降級/).count(), 0, 'live 來源不得誤標降級');

    const routeResponse = page.waitForResponse(response => response.url().includes('/api/bus-route-stops'));
    await page.getByRole('button', { name: '接續這班' }).tap();
    await routeResponse;
    const alight = page.getByRole('combobox', { name: '選擇下車站' });
    await alight.waitFor({ state: 'visible' });
    await alight.selectOption('TNN-B');
    await page.getByRole('button', { name: '開始接續旅程' }).tap();
    await page.getByText('等公車', { exact: true }).waitFor({ state: 'visible' });
    assert.match(await page.locator('.btu-journey').innerText(), /億載金城/);
    const afterRoute = await stats();
    assert.equal(afterRoute.route, afterLeg.route + 1, '只有明確選接續路線才多查一次完整站序');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rail-island-bus-journey-v1')).phase), 'waiting');

    await page.getByRole('button', { name: '我上車了' }).tap();
    await page.getByText('公車行駛中', { exact: true }).waitFor({ state: 'visible' });
    assert.match(await page.locator('.btu-journey').innerText(), /距億載金城還有8站|距 億載金城 還有 8 站/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rail-island-bus-journey-v1')).phase), 'aboard');

    const nav = page.getByRole('link', { name: /步行導航到站牌/ });
    const href = await nav.getAttribute('href');
    assert.match(href, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    assert.match(href, /destination=22\.99794%2C120\.21315/);
    assert.match(href, /dir_action=navigate/);
    assert.match(href, /travelmode=walking/);

    const layout = await page.evaluate(() => {
      const root = document.querySelector('[data-bus-transfer-slot]');
      const board = document.getElementById('board');
      const controls = [...root.querySelectorAll('button,a')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const occluded = [];
      const short = [];
      for (const el of controls) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!(hit === el || el.contains(hit))) occluded.push(el.textContent.trim().slice(0, 30));
        if (r.height < 43.5) short.push({ text: el.textContent.trim().slice(0, 30), height: r.height });
      }
      const rr = root.getBoundingClientRect(), br = board.getBoundingClientRect();
      return {
        density: root.dataset.btuDensity,
        rootWithinBoard: rr.left >= br.left - 1 && rr.right <= br.right + 1,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        occluded, short,
      };
    });
    assert.equal(layout.rootWithinBoard, true);
    assert.ok(layout.horizontalOverflow <= 1, `水平溢出 ${layout.horizontalOverflow}px`);
    assert.deepEqual(layout.occluded, []);
    assert.deepEqual(layout.short, []);

    // 全畫面 class 與公告橫幅同時存在時重驗；這是手機最容易互蓋的狀態。
    await page.evaluate(() => document.body.classList.add('fs'));
    const fullscreen = await page.evaluate(() => {
      const root = document.querySelector('[data-bus-transfer-slot]');
      const buttons = [...root.querySelectorAll('button,a')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      const reachable = buttons.every(el => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit === el || el.contains(hit);
      });
      return { reachable, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.equal(fullscreen.reachable, true);
    assert.ok(fullscreen.overflow <= 1);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: '我下車了' }).tap();
    assert.equal(await page.evaluate(() => localStorage.getItem('rail-island-bus-journey-v1')), null);
    pass(`${engine} ${width}px：觸控、按需查詢、DOM 重繪續接、可達性與溢出`);
  } finally {
    await browser.close();
  }
}

async function translated(browserType, lang, primary, occupancy) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 860 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'domcontentloaded' });
    // 搜尋框與站名也會翻譯，直接用穩定 selector；操作仍是真實 fill/click/tap。
    const start = page.locator('#howtoGo');
    if (await start.isVisible().catch(() => false)) await start.click();
    const input = page.locator('#trainSearch');
    if (!await input.isVisible()) await page.locator('#tabSearch').tap();
    await input.fill('臺南');
    await page.locator('.stn-row').first().click();
    await page.getByRole('button', { name: primary }).tap();
    await page.locator('.btu-rowbtn').nth(1).waitFor({ state: 'visible' });
    const occupancyLabels = page.getByText(occupancy, { exact: true });
    assert.ok(await occupancyLabels.count() > 0);
    assert.equal(await occupancyLabels.first().isVisible(), true);
    pass(`${lang} 公車卡與動態狀態文案完整切換`);
  } finally {
    await browser.close();
  }
}

async function assistantMilestoneDedupe() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
    const before = await stats();
    await page.evaluate(() => {
      const root = document.createElement('div');
      root.id = 'assistant-fixture';
      root.style.cssText = 'position:fixed;left:8px;top:8px;width:176px;max-height:780px;overflow:auto;z-index:99999';
      document.body.appendChild(root);
      window.BusTransferUI.mount({
        root, stationId: 'TRA:4220', stationName: '臺南', phase: 'approaching', assistant: true,
        viewKey: 'TRA:4220|assistant-fixture',
        trainEta: { arrivalAt: new Date(Date.now() + 60_000).toISOString(), ageSec: 4, source: '台鐵時刻表推估' },
      });
    });
    assert.deepEqual(await stats(), before, 'mount 助手不得自行查詢');

    const response = page.waitForResponse(item => item.url().includes('/api/bus-transfer'));
    await page.evaluate(() => window.BusTransferUI.refresh(document.getElementById('assistant-fixture'), 'near-15'));
    await response;
    await page.getByText('這一班目前可能接不上', { exact: true }).first().waitFor({ state: 'visible' });
    const afterFirst = await stats();
    assert.equal(afterFirst.station, before.station + 1, '第一個明確里程碑只查一站');

    // 真實 App 的 updateFollowPanel 每幀執行。重複 mount 與重複送同一個里程碑，都不能再發請求。
    await page.evaluate(() => {
      const root = document.getElementById('assistant-fixture');
      for (let i = 0; i < 30; i++) {
        window.BusTransferUI.mount({
          root, stationId: 'TRA:4220', stationName: '臺南', phase: 'approaching', assistant: true,
          viewKey: 'TRA:4220|assistant-fixture',
          trainEta: { arrivalAt: new Date(Date.now() + 60_000).toISOString(), ageSec: 4, source: '台鐵時刻表推估' },
        });
        window.BusTransferUI.refresh(root, 'near-15');
      }
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await stats(), afterFirst, '同一里程碑經過 30 幀仍不得重打');

    const layout = await page.evaluate(() => {
      const root = document.getElementById('assistant-fixture');
      const controls = [...root.querySelectorAll('button,a')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      const blocked = [], short = [];
      for (const el of controls) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!(hit === el || el.contains(hit))) blocked.push(el.textContent.trim().slice(0, 24));
        if (r.height < 43.5) short.push({ text: el.textContent.trim().slice(0, 24), height: r.height });
      }
      return { blocked, short, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.deepEqual(layout.blocked, []);
    assert.deepEqual(layout.short, []);
    assert.ok(layout.overflow <= 1);
    pass('動態轉乘助手：mount 零查詢、里程碑單發、30 幀去重與 176px 觸控可達');
  } finally {
    await browser.close();
  }
}

async function allStationCoverage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 860 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
    const before = await stats();
    await openStation(page, '臺中');
    assert.equal(await page.getByRole('button', { name: '查看現在可搭公車' }).isVisible(), true);
    assert.equal((await stats()).station, before.station, '新擴充站只開看板不得查 API');
    await page.getByRole('button', { name: '查看現在可搭公車' }).tap();
    await page.locator('.btu-rowbtn').first().waitFor({ state: 'visible' });
    assert.equal((await stats()).lastStation, 'TRA:3300', '臺中應由既有站碼自動對到 TRA:3300');

    await page.locator('#boardClose').tap();
    await openStation(page, '北湖');
    const noStopResponse = page.waitForResponse(response => response.url().includes('/api/bus-transfer'));
    await page.getByRole('button', { name: '查看現在可搭公車' }).tap();
    await noStopResponse;
    await page.getByText(/600 公尺內沒有找到可用公車站牌/).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.btu-rowbtn').count(), 0);
    assert.equal((await stats()).lastStation, 'TRA:1150', '北湖應由既有站碼自動對到 TRA:1150');

    await page.locator('#boardClose').tap();
    await openStation(page, '台中', '台中', '高鐵');
    const hsrResponse = page.waitForResponse(response => response.url().includes('/api/bus-transfer'));
    await page.getByRole('button', { name: '查看現在可搭公車' }).tap();
    await hsrResponse;
    assert.equal((await stats()).lastStation, 'THSR:1040', '高鐵台中必須接到高鐵 StationID');

    await page.locator('#boardClose').tap();
    await openStation(page, '廣慈', '廣慈/奉天宮', '台北捷運');
    const metroResponse = page.waitForResponse(response => response.url().includes('/api/bus-transfer'));
    await page.getByRole('button', { name: '查看現在可搭公車' }).tap();
    await metroResponse;
    assert.equal((await stats()).lastStation, 'RI:MRT_94D3C0FE', '官方名冊尚未收錄的新捷運站必須走穩定 fallback id');
    pass('台鐵、高鐵、捷運與無附近站牌四種入口皆可用，且仍是點開才查');
  } finally {
    await browser.close();
  }
}

async function journeySurvivesReload() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 860 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
    await openTainan(page);
    await page.getByRole('button', { name: '查看現在可搭公車' }).tap();
    await page.locator('.btu-rowbtn').first().waitFor({ state: 'visible' });
    await page.locator('.btu-rowbtn').first().tap();
    await page.getByRole('button', { name: '接續這班' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '接續這班' }).tap();
    const alight = page.getByRole('combobox', { name: '選擇下車站' });
    await alight.waitFor({ state: 'visible' });
    await alight.selectOption('TNN-B');
    await page.getByRole('button', { name: '開始接續旅程' }).tap();
    await page.getByText('等公車', { exact: true }).waitFor({ state: 'visible' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const dock = page.locator('#busJourneyPanel');
    await dock.waitFor({ state: 'visible' });
    assert.match(await dock.innerText(), /等公車|Waiting for bus/);
    assert.match(await dock.innerText(), /億載金城/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rail-island-bus-journey-v1')).phase), 'waiting');
    await dock.locator('[data-btu-act="journey-board"]').tap();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rail-island-bus-journey-v1')).phase), 'aboard');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dock.waitFor({ state: 'visible' });
    assert.match(await dock.innerText(), /公車行駛中|On the bus/);
    assert.match(await dock.innerText(), /億載金城/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rail-island-bus-journey-v1')).phase), 'aboard');
    await dock.locator('[data-btu-act="journey-complete"]').tap();
    await dock.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => localStorage.getItem('rail-island-bus-journey-v1')), null);
    pass('公車接續旅程在等車與搭車階段重開 App 都能恢復，且可明確完成');
  } finally {
    await browser.close();
  }
}

const RAW_ERROR_TEXT = /bus transfer live unavailable|bus transfer index unavailable|bus leg live unavailable|bus route stops unavailable|HTTP 50[23]|Failed to fetch/i;
const FAULTS = [
  { name: '502 JSON', fulfill: { status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'bus transfer live unavailable' }) } },
  { name: '502 非 JSON', fulfill: { status: 502, contentType: 'text/plain', body: 'upstream exploded' } },
  { name: '503 JSON', fulfill: { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'bus transfer index unavailable' }) } },
  { name: '網路斷線', abort: 'connectionfailed' },
];

async function faultMessagesStayPrivate(target) {
  for (const fault of FAULTS) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 393, height: 860 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
    const page = await context.newPage();
    try {
      const endpoint = target === 'station'
        ? '/api/bus-transfer'
        : target === 'leg' ? '/api/bus-leg-live' : '/api/bus-route-stops';
      await page.route(url => new URL(url).pathname === endpoint, route => {
        if (fault.abort) return route.abort(fault.abort);
        return route.fulfill(fault.fulfill);
      });
      await page.goto(`${BASE}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
      await openTainan(page);
      await page.getByRole('button', { name: '查看現在可搭公車' }).tap();
      if (target === 'leg' || target === 'route') {
        await page.locator('.btu-rowbtn').first().waitFor({ state: 'visible' });
        await page.locator('.btu-rowbtn').first().tap();
      }
      if (target === 'route') {
        await page.getByRole('button', { name: '接續這班' }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '接續這班' }).tap();
      }
      const friendly = target === 'station'
        ? '暫時無法取得附近公車資訊，請稍後重試。'
        : target === 'leg'
          ? '暫時無法取得這一路的車輛位置，請稍後重試。'
          : '暫時無法取得這一路的完整站序，請稍後重試。';
      const errorBox = page.locator('.btu-err');
      await errorBox.waitFor({ state: 'visible' });
      assert.match(await errorBox.innerText(), new RegExp(friendly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${target} ${fault.name} 應顯示固定友善文案`);
      assert.doesNotMatch(await page.locator('body').innerText(), RAW_ERROR_TEXT,
        `${target} ${fault.name} 不得把原始錯誤顯示給使用者`);
    } finally {
      await browser.close();
    }
  }
  const label = target === 'station' ? '附近公車' : target === 'leg' ? '路線車況' : '完整站序';
  pass(`${label}：502 JSON／非 JSON、503 與斷網都只顯示固定文案`);
}

for (const width of [360, 375, 414, 768]) await touchAndLayout(chromium, 'Chromium', width);
await touchAndLayout(webkit, 'WebKit', 375);
await allStationCoverage();
await assistantMilestoneDedupe();
await journeySurvivesReload();
await faultMessagesStayPrivate('station');
await faultMessagesStayPrivate('leg');
await faultMessagesStayPrivate('route');
await translated(chromium, 'en', 'See buses you can catch now', 'Occupancy not provided in this area');
await translated(webkit, 'ja', '今乗れるバスを見る', 'この地域は混雑度を提供していません');

console.log('公車轉乘 UI 真實瀏覽器守門全部通過。');
