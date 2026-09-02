// WebMCP 網站工具驗收：
//  1. Chromium / WebKit 一般瀏覽器沒有 modelContext 時零副作用、零 pageerror。
//  2. 注入最小 modelContext 宿主後，七個工具都能註冊並執行，唯讀工具不動畫面，兩個 action 有 UI 證據。
//  3. 手機 360/375/414/768 以 isMobile+hasTouch 與 page.tap 實測預設、公告、開板、更多 sheet；
//     全部可見控制項做兩兩相交、elementFromPoint 與水平溢出掃描。
//
// 用法：node scripts/verify_webmcp.mjs
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const TOOL_NAMES = ['get_current_rail_view', 'search_rail_stations', 'get_station_departures', 'get_train_status',
  'get_service_alerts', 'open_station_board', 'follow_train'];
const failures = [];
const pass = (label, detail = '') => console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`);
const check = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? ' — ' + detail : ''}`);
  pass(label, detail);
};

check(/const BUILD = 'v\d{4}[a-z]';/.test(SOURCE), 'G0 BUILD 維持公開版號格式');
for (const fragment of [
  'function setupWebMcp()', 'document.modelContext',
  ...TOOL_NAMES.map(name => `name: '${name}'`), 'data-cl="webmcp"', 'data-cl-of="webmcp"',
]) check(SOURCE.includes(fragment), `G0 原始碼含 ${fragment}`);

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local.test');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 404; res.setHeader('content-type', 'application/json'); return res.end('{"error":"stubbed"}');
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!path.resolve(file).startsWith(ROOT) || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, resolve));
const BASE = `http://127.0.0.1:${server.address().port}/?lang=zh-TW&webmcptest=1`;

async function contextFor(browser, viewport, modelContext = true) {
  const context = await browser.newContext({ viewport, locale: 'zh-TW',
    isMobile: viewport.width <= 768, hasTouch: viewport.width <= 768, deviceScaleFactor: viewport.width <= 768 ? 2 : 1 });
  await context.addInitScript(useModelContext => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.removeItem('trainmap-last-view');
    if (!useModelContext) return;
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool: async tool => {
        window.__webMcpTestTools = window.__webMcpTestTools || {};
        window.__webMcpTestTools[tool.name] = tool;
      },
    } });
  }, modelContext);
  return context;
}
async function load(context, expectTools = true) {
  const page = await context.newPage(), pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(expectTools
    ? () => typeof state !== 'undefined' && state.ready && Object.keys(window.__webMcpTestTools || {}).length === 7
    : () => typeof state !== 'undefined' && state.ready,
  null, { timeout: 90_000 });
  return { page, pageErrors };
}
async function call(page, name, input = {}) {
  return page.evaluate(async ({ name, input }) => {
    const tool = window.__webMcpTestTools && window.__webMcpTestTools[name];
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.execute(input);
  }, { name, input });
}
async function stateSignature(page) {
  return page.evaluate(() => {
    const center = map.getCenter();
    return { group: state.group, follow: state.followTrain && `${state.followTrain.sys}|${state.followTrain.train}`,
      freqFollow: !!state.freqFollow, board: state.boardStation && `${state.boardStation.sys}|${state.boardStation.name}`,
      lat: +center.lat.toFixed(5), lon: +center.lng.toFixed(5), zoom: map.getZoom() };
  });
}
async function controlAudit(page, scope = 'body') {
  return page.evaluate(scope => {
    const root = document.querySelector(scope);
    if (!root) return { missing: scope, overflow: 0, blocked: [], overlaps: [], visible: 0 };
    const all = [...root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[role="button"]')];
    const visible = all.filter(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return !el.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .05 &&
        style.pointerEvents !== 'none' && rect.width >= 4 && rect.height >= 4 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth;
    });
    const blocked = [];
    for (const el of visible) {
      const rect = el.getBoundingClientRect();
      const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) blocked.push(el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24));
    }
    const overlaps = [];
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const w = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const h = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (w > 3 && h > 3) overlaps.push(`${a.id || a.textContent.trim().slice(0, 12)}↔${b.id || b.textContent.trim().slice(0, 12)}(${Math.round(w)}×${Math.round(h)})`);
    }
    return { missing: null, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), blocked, overlaps, visible: visible.length };
  }, scope);
}
async function assertAudit(page, engine, width, stateName, scope = 'body', allowInitiallyClipped = false) {
  const audit = await controlAudit(page, scope);
  check(!audit.missing && audit.overflow <= 1 && (allowInitiallyClipped || !audit.blocked.length) && !audit.overlaps.length,
    `${engine} ${width}px ${stateName} 控制項可達且不重疊`, JSON.stringify(audit));
}
async function scrollableControlsReachable(page, scope) {
  return page.evaluate(async scope => {
    const root = document.querySelector(scope), blocked = [];
    for (const el of root ? root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])') : []) {
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
  }, scope);
}

async function desktopScenario(browser, engine) {
  const plainContext = await contextFor(browser, { width: 1280, height: 900 }, false);
  const plain = await load(plainContext, false);
  try {
    check(await plain.page.evaluate(() => !document.modelContext && !window.__webMcpTestTools), `${engine} 一般瀏覽器零 WebMCP 副作用`);
    check(!plain.pageErrors.length, `${engine} 一般瀏覽器零 pageerror`, plain.pageErrors.join(' | '));
  } finally { await plainContext.close(); }

  const context = await contextFor(browser, { width: 1280, height: 900 });
  const { page, pageErrors } = await load(context);
  try {
    const meta = await page.evaluate(() => Object.values(window.__webMcpTestTools).map(tool => ({
      name: tool.name, schema: tool.inputSchema, readOnly: tool.annotations && tool.annotations.readOnlyHint,
    })));
    check(meta.map(item => item.name).sort().join('|') === [...TOOL_NAMES].sort().join('|'), `${engine} 七個工具完整註冊`);
    check(meta.every(item => item.schema && item.schema.type === 'object' && item.schema.additionalProperties === false), `${engine} 七個 schema 拒絕額外欄位`);
    check(meta.filter(item => item.readOnly === true).length === 5 && meta.filter(item => item.readOnly === false).length === 2,
      `${engine} 五個唯讀、兩個可逆 action 註記正確`);

    const before = await stateSignature(page);
    const current = await call(page, 'get_current_rail_view');
    const search = await call(page, 'search_rail_stations', { query: '市政府', limit: 10 });
    const ambiguousStation = await call(page, 'get_station_departures', { station: '市政府' });
    const board = await call(page, 'get_station_departures', { station: '臺北', system: '台鐵', limit: 6 });
    const ambiguousTrain = await call(page, 'get_train_status', { input: { train_number: '1238' } });
    const alerts = await call(page, 'get_service_alerts');
    const after = await stateSignature(page);
    check(current.ok && /^v\d{4}[a-z]$/.test(current.build) && current.ready, `${engine} get_current_rail_view 回傳版本與狀態`);
    check(search.ok && search.stations.some(st => st.system_id === 'mrt') && search.stations.some(st => st.system_id === 'tmrt'),
      `${engine} search_rail_stations 保留跨系統同名站`);
    check(ambiguousStation.error === 'ambiguous_station' && ambiguousStation.candidates.length >= 2,
      `${engine} 車站歧義要求 system`);
    check(board.ok && board.board_kind === 'rail_departures' && Array.isArray(board.departures), `${engine} 台鐵車站看板可讀`);
    check(ambiguousTrain.error === 'ambiguous_train' && ambiguousTrain.candidates.length >= 2, `${engine} 火車重號要求 system`);
    check(alerts.ok && Array.isArray(alerts.alerts), `${engine} 營運公告可讀`);
    check(JSON.stringify(before) === JSON.stringify(after), `${engine} 五個唯讀工具不改畫面狀態`);

    const train = await page.evaluate(() => {
      const tr = state.trains.find(item => item.sys === 'tra_sched' && trainPos(item, state.simSec))
        || state.trains.find(item => item.sys === 'tra_sched');
      return tr && { train_number: String(tr.train), system: tr.sys };
    });
    check(!!train, `${engine} 找到 action 測試車次`);
    const opened = await call(page, 'open_station_board', { station: '市政府', system: 'mrt' });
    check(opened.ok && await page.locator('#board').isVisible(), `${engine} open_station_board 有可見看板證據`);
    await page.evaluate(() => setSimSec(17 * 3600 + 24 * 60));
    const metroBoard = await call(page, 'get_station_departures', { station: '市政府', system: 'mrt', limit: 4 });
    check(metroBoard.ok && metroBoard.departures.length > 0 && metroBoard.departures.every(row => row.system_id === 'mrt'),
      `${engine} 捷運看板使用公開系統 id`);
    const followed = await call(page, 'follow_train', train);
    check(followed.ok && await page.locator('#followPanel').isVisible() &&
      await page.evaluate(train => state.followTrain && String(state.followTrain.train) === train.train_number && state.followTrain.sys === train.system, train),
    `${engine} follow_train 有跟隨狀態與可見面板證據`);
    check(!pageErrors.length, `${engine} WebMCP 桌面情境零 pageerror`, pageErrors.join(' | '));
  } finally { await context.close(); }
}

async function mobileScenario(browser, engine, width) {
  const context = await contextFor(browser, { width, height: width === 768 ? 1024 : 844 });
  const { page, pageErrors } = await load(context);
  try {
    check(await page.evaluate(() => document.body.classList.contains('fs')), `${engine} ${width}px 為手機全畫面態`);
    await assertAudit(page, engine, width, '預設態');
    await page.evaluate(() => { state.alert = { list: [{ sysLabel: '台鐵', title: '營運通阻公告', desc: '測試公告', lines: [] }] }; renderAlertBanner(); });
    await assertAudit(page, engine, width, '公告態', '.stage');
    const opened = await call(page, 'open_station_board', { station: '市政府', system: 'mrt' });
    check(opened.ok && await page.locator('#board').isVisible(), `${engine} ${width}px WebMCP 開板成功`);
    await assertAudit(page, engine, width, '看板態', '.stage');
    await page.tap('#boardClose');
    check(!(await page.locator('#board').isVisible()), `${engine} ${width}px page.tap 關閉看板`);
    await page.tap('#tabMore');
    await page.waitForFunction(() => document.body.classList.contains('tools-open'));
    await assertAudit(page, engine, width, '更多 sheet', '#moreSheet', true);
    const unreachable = await scrollableControlsReachable(page, '#moreSheet');
    check(!unreachable.length, `${engine} ${width}px 更多 sheet 全部控制項捲動後可點`, unreachable.join(' | '));
    check(!pageErrors.length, `${engine} ${width}px 零 pageerror`, pageErrors.join(' | '));
  } finally { await context.close(); }
}

try {
  for (const [engine, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
    let browser;
    try {
      browser = await launcher.launch({ headless: true });
      await desktopScenario(browser, engine);
      for (const width of [360, 375, 414, 768]) await mobileScenario(browser, engine, width);
    } catch (error) {
      failures.push(`${engine}: ${error.stack || error.message}`);
      console.error(`FAIL ${engine} — ${error.message}`);
    } finally { if (browser) await browser.close(); }
  }
} finally { server.close(); }

if (failures.length) {
  console.error('\nWebMCP 驗證失敗：'); failures.forEach(failure => console.error(failure)); process.exit(1);
}
console.log('\nWebMCP 驗證全部通過。');
