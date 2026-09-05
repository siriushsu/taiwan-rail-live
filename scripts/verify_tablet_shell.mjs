#!/usr/bin/env node
// iPad／Android 平板殼驗收：
//  1. Chromium 驗 Android 平板，WebKit 驗 iPad；手機與桌面同時作正反對照。
//  2. 直式走底部 sheet、橫式走右側欄；大型觸控視窗跨 1400 時能正確換殼。
//  3. 可見控制項逐一做 elementFromPoint、兩兩相交與水平溢出掃描。
//  4. 「更多」內所有可用控制項捲到畫面後都點得到，極簡沉浸可開也可關。
//  5. 桌面主動全畫面仍維持桌面工具配置，不被 mobile-shell 誤傷。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PBX = readFileSync(path.join(ROOT, 'app/ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const MOBILE_MQ = '(max-width: 900px), (max-height: 500px), (any-pointer: coarse) and (max-width: 1400px)';
const RAIL_MQ = '(orientation: landscape) and (max-height: 500px), (orientation: landscape) and (min-width: 700px) and (max-width: 1400px) and (any-pointer: coarse)';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};
const escRe = value => value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');

const build = (SOURCE.match(/const BUILD = 'v(\d{4})([a-z])';/) || []).slice(1);
const tabletBuildReached = build.length === 2
  && (Number(build[0]) > 904 || (Number(build[0]) === 904 && build[1] >= 'b'));
ok('T0 BUILD 不早於平板版 v0904b', tabletBuildReached, build.length ? `v${build.join('')}` : '找不到 BUILD');
ok('T0 MOBILE_MQ 五處同式', (SOURCE.match(new RegExp(escRe(MOBILE_MQ), 'g')) || []).length === 5,
  'matches=' + (SOURCE.match(new RegExp(escRe(MOBILE_MQ), 'g')) || []).length);
ok('T0 RAIL_MQ CSS／JS 同式', (SOURCE.match(new RegExp(escRe(RAIL_MQ), 'g')) || []).length === 2,
  'matches=' + (SOURCE.match(new RegExp(escRe(RAIL_MQ), 'g')) || []).length);
ok('T0 iOS App Debug／Release 皆為 Universal',
  (PBX.match(/TARGETED_DEVICE_FAMILY = "1,2";/g) || []).length === 4
  && !/TARGETED_DEVICE_FAMILY = 1;/.test(PBX));
// 2026-09-05(M4-B)：原本同時要求第一層的 data-cl-of。第一層「最近更新」是**上限 8 條的輪替檢視**,
// 設計上每加一條新的就會擠掉最舊的一條（index.html foot-recent 註解與 check_i18n 的 CL2 都寫明）,
// 所以把任何一個 id 釘死在第一層,等於保證第 9 條新功能上線那天這條判準會紅——今天就是那一天。
// 永久紀錄在第二層,改只釘正本;兩層的對映完整性(CL1 每條第一層都指得到正本、CL1b 正本不重複、
// CL2 第一層不超過 8 條)由 scripts/check_i18n.mjs 專責,不在這支重複一遍。
ok('T0 公開更新紀錄的完整歷史有平板條目(正本)',
  SOURCE.includes('data-cl="tabletshell"'));

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local.test');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') {
      return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    }
    return res.end('{}');
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!path.resolve(file).startsWith(ROOT) || !existsSync(file)) {
    res.statusCode = 404;
    return res.end('not found');
  }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = 'http://127.0.0.1:' + server.address().port + '/?lang=zh-TW&g=nat&tablet-audit=1';

async function boot(browser, testCase) {
  const touch = !!testCase.touch;
  const context = await browser.newContext({
    viewport: { width: testCase.w, height: testCase.h },
    locale: 'zh-TW', hasTouch: touch, isMobile: touch,
    deviceScaleFactor: touch ? 2 : 1,
  });
  await context.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', 'zh-TW');
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.removeItem('trainmap-last-view');
    localStorage.removeItem('trainmap-immersive');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready && !!map; } catch (error) { return false; }
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(250);
  return { context, page, errors };
}

function wantsShell(testCase) {
  return testCase.w <= 900 || testCase.h <= 500 || (!!testCase.touch && testCase.w <= 1400);
}
function wantsRail(testCase) {
  const landscape = testCase.w > testCase.h;
  return landscape && (testCase.h <= 500
    || (!!testCase.touch && testCase.w >= 700 && testCase.w <= 1400));
}
async function shellState(page) {
  return page.evaluate(() => {
    const visible = selector => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) > .05;
    };
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;height:1px;width:var(--rail-w);';
    document.body.appendChild(probe);
    const railW = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      mobileShell: document.body.classList.contains('mobile-shell'),
      fs: document.body.classList.contains('fs'),
      mobileMq: matchMedia(MOBILE_MQ).matches,
      railMq: matchMedia(RAIL_MQ).matches,
      rail: typeof sheetIsSideRail === 'function' ? sheetIsSideRail() : null,
      railW,
      tabbar: visible('.tabbar'),
      toolsFab: visible('#toolsFab'),
      stageTools: visible('.stage-tools'),
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  });
}

async function controlAudit(page, scope = 'body') {
  return page.evaluate(scope => {
    const root = document.querySelector(scope);
    if (!root) return { missing: scope, visible: 0, blocked: [], overlaps: [], overflow: 0 };
    const selector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[role="button"]';
    const visible = [...root.querySelectorAll(selector)].filter(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > .05 && style.pointerEvents !== 'none'
        && rect.width >= 4 && rect.height >= 4 && rect.right > 0 && rect.bottom > 0
        && rect.left < innerWidth && rect.top < innerHeight;
    });
    const label = element => element.id || element.getAttribute('aria-label')
      || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 22);
    const blocked = [];
    for (const element of visible) {
      const rect = element.getBoundingClientRect();
      const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === element || element.contains(hit))) blocked.push(label(element));
    }
    const overlaps = [];
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (width > 3 && height > 3) {
        overlaps.push(label(a) + '↔' + label(b) + '(' + Math.round(width) + '×' + Math.round(height) + ')');
      }
    }
    return {
      missing: null, visible: visible.length, blocked, overlaps,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  }, scope);
}

async function scrollableControlsReachable(page, scope) {
  return page.evaluate(async scope => {
    const root = document.querySelector(scope), blocked = [];
    const controls = root ? [...root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary')] : [];
    for (const element of controls) {
      const style = getComputedStyle(element);
      // <details> 收合時，內層 link/button 不是當下可互動控件；要驗的是會打開它的 summary。
      // 不能只看子項自己的 computed style，兩個引擎都可能保留非零 rect。
      let hiddenByClosedDetails = false;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!ancestor.matches('details:not([open])')) continue;
        const summary = ancestor.querySelector(':scope > summary');
        if (!summary || !summary.contains(element)) { hiddenByClosedDetails = true; break; }
      }
      if (hiddenByClosedDetails || element.closest('[hidden]') || style.display === 'none' || style.visibility === 'hidden') continue;
      element.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
        ? document.elementFromPoint(x, y) : null;
      if (!hit || !(hit === element || element.contains(hit))) {
        blocked.push(element.id || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 24));
      }
    }
    return blocked;
  }, scope);
}

const PHONE_CASES = [
  { name: 'iPhone 直', w: 390, h: 844, touch: true },
  { name: 'iPhone SE 橫', w: 667, h: 375, touch: true },
  { name: 'iPhone Pro Max 橫', w: 932, h: 430, touch: true },
];
const IPAD_CASES = [
  { name: 'iPad mini 橫', w: 1133, h: 744, touch: true },
  { name: 'iPad 11 橫', w: 1210, h: 834, touch: true },
  { name: 'iPad 13 橫', w: 1376, h: 1032, touch: true },
  { name: 'iPad 11 直', w: 834, h: 1210, touch: true },
  { name: 'iPad 13 直', w: 1032, h: 1376, touch: true },
  { name: 'iPad Slide Over', w: 320, h: 1024, touch: true },
  { name: 'iPad Split 1/2', w: 678, h: 1032, touch: true },
];
const ANDROID_CASES = [
  { name: 'Android 8吋直', w: 800, h: 1280, touch: true },
  { name: 'Android 8吋橫', w: 1280, h: 800, touch: true },
  { name: 'Android 平板橫 1024', w: 1024, h: 600, touch: true },
  { name: 'Android 大平板橫', w: 1376, h: 900, touch: true },
  { name: 'Android 分割視窗', w: 600, h: 1000, touch: true },
];
const DESKTOP_CASES = [
  { name: '桌面 1280', w: 1280, h: 800, touch: false },
  { name: '觸控筆電 1440', w: 1440, h: 900, touch: true },
];

async function runCase(browser, engine, testCase) {
  const { context, page, errors } = await boot(browser, testCase);
  try {
    const wantShell = wantsShell(testCase), wantRail = wantsRail(testCase);
    const got = await shellState(page);
    ok(engine + ' ' + testCase.name + ' 殼落點',
      got.mobileShell === wantShell && got.fs === wantShell && got.mobileMq === wantShell,
      JSON.stringify({ shell: got.mobileShell, fs: got.fs, mq: got.mobileMq, wantShell }));
    ok(engine + ' ' + testCase.name + ' 面板軸',
      got.rail === wantRail && got.railMq === wantRail,
      JSON.stringify({ rail: got.rail, railMq: got.railMq, wantRail }));
    ok(engine + ' ' + testCase.name + ' 導覽載體互斥',
      got.tabbar === wantShell && got.toolsFab === !wantShell && got.stageTools === !wantShell,
      JSON.stringify({ tabbar: got.tabbar, toolsFab: got.toolsFab, stageTools: got.stageTools }));
    ok(engine + ' ' + testCase.name + ' 無水平溢出', got.overflow <= 1, 'overflow=' + got.overflow);
    if (wantRail) {
      const lower = Math.min(340, testCase.w * .42);
      const expected = Math.max(lower, Math.min(testCase.w * .30, 420));
      ok(engine + ' ' + testCase.name + ' 側欄寬度', Math.abs(got.railW - expected) < 1.5,
        'actual=' + got.railW.toFixed(1) + ' expected=' + expected.toFixed(1));
    }
    const audit = await controlAudit(page);
    ok(engine + ' ' + testCase.name + ' 控制項可達且不重疊',
      !audit.missing && audit.overflow <= 1 && !audit.blocked.length && !audit.overlaps.length,
      JSON.stringify(audit));

    if (wantShell) {
      await page.tap('#tabSearch');
      await page.waitForFunction(() => {
        const element = document.getElementById('searchPanel');
        return element && !element.hidden && element.getBoundingClientRect().width > 0;
      });
      await page.waitForTimeout(200);
      const shape = await page.evaluate(() => {
        const rect = document.getElementById('searchPanel').getBoundingClientRect();
        const tb = document.getElementById('tabbar');
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height,
          gapRight: innerWidth - rect.right, vw: innerWidth, vh: innerHeight,
          tabbarTop: tb ? tb.getBoundingClientRect().top : null };
      });
      // 查詢分頁兩態(2026-09-06 Fix round 1,F1):單點 tab 只到瀏覽態——rail 情境該長得跟其他
      // 側欄 sheet 一樣寬(同一顆 --rail-w,見上面「側欄寬度」量到的 got.railW)、不蓋到 tab bar；
      // 右半全高的「search-land」是打字態才有的版面,得再聚焦輸入框才看得到(見下面 typing 分支)。
      const shapeOk = wantRail
        ? Math.abs(shape.w - got.railW) < 2 && shape.tabbarTop != null && shape.y + shape.h <= shape.tabbarTop + 1
        : shape.w >= shape.vw * .88 && shape.y > 8;
      ok(engine + ' ' + testCase.name + ' 搜尋面板形態(瀏覽態)', shapeOk, JSON.stringify({ ...shape, railW: got.railW }));

      if (wantRail) {
        await page.tap('#trainSearch');
        await page.waitForFunction(() => document.body.classList.contains('search-open'));
        await page.waitForTimeout(200);
        const typing = await page.evaluate(() => {
          const rect = document.getElementById('searchPanel').getBoundingClientRect();
          const tb = document.getElementById('tabbar');
          return { w: rect.width, h: rect.height, gapRight: innerWidth - rect.right,
            vw: innerWidth, vh: innerHeight, tabbarDisplay: tb ? getComputedStyle(tb).display : null };
        });
        const typingOk = typing.gapRight < 3 && typing.h >= typing.vh * .9 && typing.w <= typing.vw * .8 && typing.tabbarDisplay === 'none';
        ok(engine + ' ' + testCase.name + ' 搜尋面板形態(打字態)', typingOk, JSON.stringify(typing));
      }
    }
    ok(engine + ' ' + testCase.name + ' 零 pageerror', errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
  }
}

for (const [engine, launcher, cases] of [
  ['Chromium', chromium, [...PHONE_CASES, ...ANDROID_CASES, ...DESKTOP_CASES]],
  ['WebKit', webkit, [...PHONE_CASES, ...IPAD_CASES, ...DESKTOP_CASES]],
]) {
  const browser = await launcher.launch();
  try {
    for (const testCase of cases) await runCase(browser, engine, testCase);

    const representative = engine === 'WebKit'
      ? { name: 'iPad 11 橫', w: 1210, h: 834, touch: true }
      : { name: 'Android 8吋橫', w: 1280, h: 800, touch: true };
    const { context, page, errors } = await boot(browser, representative);
    try {
      await page.tap('#tabMore');
      await page.waitForFunction(() => document.body.classList.contains('tools-open'));
      const blocked = await scrollableControlsReachable(page, '#moreBody');
      ok(engine + ' 平板「更多」所有控制項捲得到且點得到', blocked.length === 0,
        JSON.stringify(blocked));
      const immersiveRow = '#moreBody .ms-row[data-proxy="immBtn"]';
      await page.locator(immersiveRow).scrollIntoViewIfNeeded();
      await page.tap(immersiveRow);
      const on = await page.evaluate(() => document.body.classList.contains('immersive'));
      await page.tap(immersiveRow);
      const off = await page.evaluate(() => !document.body.classList.contains('immersive'));
      ok(engine + ' 平板極簡沉浸可開可關', on && off, JSON.stringify({ on, off }));
      ok(engine + ' 平板「更多」互動零 pageerror', errors.length === 0, errors.join(' | '));
    } finally {
      await context.close();
    }

    const resizeCase = { name: '平板換殼', w: 1210, h: 834, touch: true };
    const resized = await boot(browser, resizeCase);
    try {
      await resized.page.setViewportSize({ width: 1441, height: 900 });
      await resized.page.waitForTimeout(250);
      const wide = await shellState(resized.page);
      await resized.page.setViewportSize({ width: 1210, height: 834 });
      await resized.page.waitForTimeout(250);
      const tablet = await shellState(resized.page);
      ok(engine + ' 1400 斷點往返會搬家',
        !wide.mobileShell && !wide.fs && !wide.tabbar && wide.toolsFab
        && tablet.mobileShell && tablet.fs && tablet.tabbar && !tablet.toolsFab,
        JSON.stringify({ wide, tablet }));
    } finally {
      await resized.context.close();
    }
  } finally {
    await browser.close();
  }
}

const desktopBrowser = await chromium.launch();
const desktop = await boot(desktopBrowser, { name: '桌面全畫面', w: 1280, h: 800, touch: false });
try {
  await desktop.page.evaluate(() => state._setFs(true));
  await desktop.page.waitForTimeout(200);
  const fullscreen = await shellState(desktop.page);
  ok('桌面主動全畫面不誤套觸控平板殼',
    fullscreen.fs && !fullscreen.mobileShell && !fullscreen.tabbar && fullscreen.toolsFab,
    JSON.stringify(fullscreen));
} finally {
  await desktop.context.close();
  await desktopBrowser.close();
}

server.close();
const failed = results.filter(result => !result.pass);
console.log('\n總計 ' + (results.length - failed.length) + '/' + results.length);
if (failed.length) {
  console.log('FAIL 清單:\n' + failed.map(result => '  ' + result.name + ' — ' + result.detail).join('\n'));
  process.exitCode = 1;
}
