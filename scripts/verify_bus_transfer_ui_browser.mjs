import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = process.env.WORKSPACE_NODE_MODULES;
if (!modules) throw new Error('請設定 WORKSPACE_NODE_MODULES 指向 bundled node_modules');
const { chromium, webkit } = await import(pathToFileURL(path.join(modules, 'playwright/index.mjs')).href);
const BASE = process.env.BUS_UI_BASE || 'http://127.0.0.1:8793';

const pass = message => console.log(`✓ ${message}`);
const stats = async () => {
  const response = await fetch(`${BASE}/__bus-test-stats`);
  assert.equal(response.ok, true);
  return response.json();
};

async function openStation(page, query, expected = query) {
  const start = page.getByRole('button', { name: '開始看車' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const input = page.locator('#trainSearch');
  if (!await input.isVisible()) await page.locator('#tabSearch').tap();
  await input.fill(query);
  const rows = page.locator('.stn-row');
  await rows.first().waitFor({ state: 'visible' });
  assert.match(await rows.first().innerText(), new RegExp(`${expected}.*台鐵`, 's'));
  await rows.first().click();
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
    pass('三站白名單外的臺中可查；無附近站牌的北湖照實顯示且不產生假班次');
  } finally {
    await browser.close();
  }
}

for (const width of [360, 375, 414, 768]) await touchAndLayout(chromium, 'Chromium', width);
await touchAndLayout(webkit, 'WebKit', 375);
await allStationCoverage();
await translated(chromium, 'en', 'See buses you can catch now', 'Occupancy not provided in this area');
await translated(webkit, 'ja', '今乗れるバスを見る', 'この地域は混雑度を提供していません');

console.log('公車轉乘 UI 真實瀏覽器守門全部通過。');
