#!/usr/bin/env node
// 災害警報觸發驗收：全程只用合成 NCDR feed、本機靜態 server 與 Playwright route。
// 不連 NCDR、TDX、北捷或任何其他真實上游。長結果寫入 tmp/verify_hazard_trigger-output.json。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAZARD_VERIFY_PORT || 43417);
const BASE = `http://127.0.0.1:${PORT}`;
const NOW = Date.parse('2026-08-04T04:00:00Z'); // 台北 2026-08-04 12:00:00
const OUT = path.join(ROOT, 'tmp/verify_hazard_trigger-output.json');
const output = { assertions: [], worker: {}, browser: {}, blockedExternal: [] };
let failures = 0;

function check(pass, label, detail = '') {
  const row = { pass: !!pass, label, detail };
  output.assertions.push(row);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
  return !!pass;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const asJson = async response => JSON.parse(await response.text());

function ncdrEntry({
  id, type, title = `${type}測試警報`, updated = '2026/8/4 下午 12:01:00',
  effective = '2020/1/1 上午 12:00:00', expires = '2099/1/1 上午 12:00:00',
  status = 'Actual', msgType = 'Alert', prefixed = true, omit = [],
}) {
  const entry = {
    id, title, updated,
    category: { '@term': type },
    link: { '@rel': 'alternate', '@href': `https://fixture.invalid/${encodeURIComponent(id)}.cap` },
  };
  const cap = prefixed ? 'cap:' : '';
  Object.assign(entry, {
    [`${cap}status`]: status,
    [`${cap}msgType`]: msgType,
    [`${cap}effective`]: effective,
    [`${cap}expires`]: expires,
  });
  for (const key of omit) delete entry[`${cap}${key}`];
  return entry;
}
const ncdrFeed = (entries, updated = '2026/8/4 下午 12:01:00') => ({
  id: 'fixture-feed', title: 'NCDR fixture', updated, entry: entries,
});
const activeEntries = () => [
  ncdrEntry({ id: 'typhoon-1', type: '颱風' }),
  // 官方 Atom JSON 通常是 cap:*；保留一筆舊式無前綴鍵，鎖住向後相容。
  ncdrEntry({ id: 'quake-1', type: '地震', prefixed: false }),
  ncdrEntry({ id: 'rain-1', type: '降雨' }),
  ncdrEntry({ id: 'thunder-1', type: '雷雨' }),
];

class MemoryCache {
  constructor() { this.map = new Map(); }
  key(request) {
    const r = request instanceof Request ? request : new Request(request);
    return `${r.method} ${r.url}`;
  }
  async match(request) {
    const response = this.map.get(this.key(request));
    return response ? response.clone() : undefined;
  }
  async put(request, response) { this.map.set(this.key(request), response.clone()); }
  clear() { this.map.clear(); }
}

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const memoryCache = new MemoryCache();
globalThis.caches = { default: memoryCache };

let nodeFeed = ncdrFeed([]), nodeFetches = [];
function classifyUrl(raw) {
  const u = String(raw instanceof Request ? raw.url : raw);
  if (/JSONAtomFeeds|ncdr|fixture\.invalid\/hazard/i.test(u)) return 'ncdr';
  if (/openid-connect\/token|auth\/realms/i.test(u)) return 'auth';
  if (/Rail\/TRA\/Alert/i.test(u)) return 'tra-alert';
  if (/Rail\/THSR\/AlertInfo/i.test(u)) return 'thsr-alert';
  if (/Rail\/Metro\/Alert\//i.test(u)) return 'metro-alert';
  if (/Rail\/Metro\/News\//i.test(u)) return 'metro-news';
  return 'unexpected';
}
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const kind = classifyUrl(input);
  nodeFetches.push({ url, kind, method: String((init && init.method) || (input instanceof Request && input.method) || 'GET') });
  if (kind === 'ncdr') return new Response(JSON.stringify(nodeFeed), { status: 200, headers: { 'content-type': 'application/json' } });
  if (kind === 'auth') return new Response(JSON.stringify({ access_token: 'fixture-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (kind === 'tra-alert') return new Response(JSON.stringify({ UpdateTime: '2026-08-04T12:00:00+08:00', Alerts: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (kind === 'thsr-alert') return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  if (kind === 'metro-alert') return new Response(JSON.stringify({ Alerts: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (kind === 'metro-news') return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error(`離線驗收攔到未宣告 outbound fetch：${url}`);
};

let server = null, browser = null;
try {
  const workerUrl = pathToFileURL(path.join(ROOT, 'worker.js'));
  workerUrl.searchParams.set('verify_hazard', String(Date.now()));
  const worker = await import(workerUrl.href);
  const hz = worker._hazard;
  check(!!hz, 'W0 worker.js 有導出 _hazard');
  const required = ['ncdrTimeMs', 'normalizeNcdrHazards', 'hazardAlert', 'hazardMonitorScheduled', 'resetHazardMem'];
  check(!!hz && required.every(name => typeof hz[name] === 'function'), 'W0 _hazard 介面完整',
    hz ? required.map(name => `${name}:${typeof hz[name]}`).join(', ') : 'missing');
  if (!hz || !required.every(name => typeof hz[name] === 'function')) throw new Error('_hazard interface incomplete');

  // ── Worker 純函式：中文在地時間、狀態、類別與到期時間 ──
  const timeCases = [
    ['2026/8/4 上午 12:05:06', '2026-08-03T16:05:06.000Z'],
    ['2026/8/4 下午 12:05:06', '2026-08-04T04:05:06.000Z'],
    ['2026/8/4 下午 03:04:05', '2026-08-04T07:04:05.000Z'],
    ['2026-08-04T15:04:05+08:00', '2026-08-04T07:04:05.000Z'],
  ];
  for (const [raw, iso] of timeCases) {
    const got = hz.ncdrTimeMs(raw);
    check(got === Date.parse(iso), `W1 NCDR 時間解析：${raw}`, `${got} == ${Date.parse(iso)}`);
  }

  const mixed = ncdrFeed([
    ...activeEntries(),
    ncdrEntry({ id: 'cancel-1', type: '地震', msgType: 'Cancel' }),
    ncdrEntry({ id: 'test-1', type: '雷雨', status: 'Test' }),
    ncdrEntry({ id: 'expired-1', type: '颱風', expires: '2000/1/1 上午 12:00:00' }),
    ncdrEntry({ id: 'missing-status-1', type: '地震', omit: ['status'] }),
    ncdrEntry({ id: 'invalid-status-1', type: '地震', status: 'DefinitelyNotActual' }),
    ncdrEntry({ id: 'missing-msgtype-1', type: '地震', omit: ['msgType'] }),
    ncdrEntry({ id: 'missing-effective-1', type: '降雨', omit: ['effective'] }),
    ncdrEntry({ id: 'invalid-effective-1', type: '降雨', effective: '不是時間' }),
    ncdrEntry({ id: 'missing-expires-1', type: '雷雨', omit: ['expires'] }),
    ncdrEntry({ id: 'invalid-expires-1', type: '雷雨', expires: '不是時間' }),
    ncdrEntry({ id: 'irrelevant-1', type: '空氣品質' }),
  ]);
  const normalized = hz.normalizeNcdrHazards(mixed, NOW);
  const normalizedIds = (normalized || []).map(x => x.id).sort();
  const normalizedTypes = new Set((normalized || []).map(x => x.type));
  check(Array.isArray(normalized) && ['quake-1', 'rain-1', 'thunder-1', 'typhoon-1'].every(id => normalizedIds.includes(id)),
    'W2 Actual 且生效中的四類警報會保留', JSON.stringify(normalizedIds));
  check(normalizedIds.includes('quake-1'),
    'W2 無 cap: 前綴的舊式欄位仍相容', JSON.stringify(normalizedIds));
  check(!normalizedIds.some(id => /cancel|test|expired|irrelevant|missing|invalid/.test(id)),
    'W2 Cancel／Test／過期／非目標／缺失或壞欄位會 fail-closed', JSON.stringify(normalizedIds));
  check(['颱風', '地震', '降雨', '雷雨'].every(type => normalizedTypes.has(type)),
    'W2 正規化保留四種警報類別', JSON.stringify([...normalizedTypes]));
  check((normalized || []).every(x => ['id', 'type', 'title', 'updated', 'effective', 'expires', 'effectiveAt', 'expiresAt'].every(k => Object.hasOwn(x, k))),
    'W2 normalized entry 欄位契約完整', JSON.stringify(normalized && normalized[0]));
  check((normalized || []).every(x => typeof x.effectiveAt === 'string' && typeof x.expiresAt === 'string' &&
      Date.parse(x.effectiveAt) === hz.ncdrTimeMs(x.effective) && Date.parse(x.expiresAt) === hz.ncdrTimeMs(x.expires)),
    'W2 effectiveAt／expiresAt 是可核對的 ISO 契約', JSON.stringify(normalized && normalized[0]));

  // ── Worker endpoint：全 fetch stub，第二次必須命中 cache ──
  hz.resetHazardMem(); memoryCache.clear(); nodeFetches = []; nodeFeed = mixed;
  const env = {
    NCDR_ALERT_URL: 'https://fixture.invalid/hazard',
    TDX_CLIENT_ID: 'fixture-id', TDX_CLIENT_SECRET: 'fixture-secret',
  };
  const req = new Request('https://local.test/api/hazard-alert');
  const firstResponse = await hz.hazardAlert(req, env);
  const firstBody = await asJson(firstResponse.clone());
  const secondResponse = await hz.hazardAlert(req, env);
  const secondBody = await asJson(secondResponse.clone());
  const ncdrCalls = nodeFetches.filter(x => x.kind === 'ncdr').length;
  const endpointExpectedIds = hz.normalizeNcdrHazards(mixed, Date.now()).map(x => x.id).sort();
  const endpointActualIds = Array.isArray(firstBody.hazards) ? firstBody.hazards.map(x => x.id).sort() : [];
  check(firstResponse.ok && firstBody.source === 'NCDR' && JSON.stringify(endpointActualIds) === JSON.stringify(endpointExpectedIds),
    'W3 /api/hazard-alert 回傳正式 shape', JSON.stringify({ status: firstResponse.status, keys: Object.keys(firstBody), n: firstBody.hazards && firstBody.hazards.length }));
  check(['at', 'observedAt', 'source', 'stale', 'hazards'].every(k => Object.hasOwn(firstBody, k)),
    'W3 endpoint 欄位契約完整', JSON.stringify(Object.keys(firstBody)));
  check((firstBody.hazards || []).every(x => typeof x.effectiveAt === 'string' && typeof x.expiresAt === 'string' &&
      Number.isFinite(Date.parse(x.effectiveAt)) && Number.isFinite(Date.parse(x.expiresAt))),
    'W3 endpoint 每筆 hazard 回傳 effectiveAt／expiresAt', JSON.stringify(firstBody.hazards && firstBody.hazards[0]));
  check(ncdrCalls === 1 && JSON.stringify(firstBody) === JSON.stringify(secondBody),
    'W3 endpoint 第二次命中快取，不重打 NCDR', `ncdrCalls=${ncdrCalls}`);
  output.worker.endpoint = { calls: nodeFetches, firstBody, secondBody };

  // ── Worker scheduled：無 hazard 不碰三種公告；有 hazard 才重查 ──
  hz.resetHazardMem(); memoryCache.clear(); nodeFetches = []; nodeFeed = ncdrFeed([]);
  await hz.hazardMonitorScheduled({ scheduledTime: NOW }, env);
  const quietCounts = Object.fromEntries(['tra-alert', 'thsr-alert', 'metro-alert'].map(kind =>
    [kind, nodeFetches.filter(x => x.kind === kind).length]));
  check(Object.values(quietCounts).every(n => n === 0), 'W4 scheduled 無生效警報時不呼叫三種鐵道公告', JSON.stringify(quietCounts));

  hz.resetHazardMem(); memoryCache.clear(); nodeFetches = []; nodeFeed = ncdrFeed([activeEntries()[1]]);
  await hz.hazardMonitorScheduled({ scheduledTime: NOW }, env);
  const activeCounts = Object.fromEntries(['tra-alert', 'thsr-alert', 'metro-alert'].map(kind =>
    [kind, nodeFetches.filter(x => x.kind === kind).length]));
  check(Object.values(activeCounts).every(n => n > 0), 'W4 scheduled 有生效警報時才呼叫台鐵／高鐵／捷運公告', JSON.stringify(activeCounts));
  check(nodeFetches.every(x => x.kind !== 'unexpected'), 'W5 Worker 測試零未宣告 outbound', JSON.stringify(nodeFetches));
  output.worker.scheduled = { quietCounts, activeCounts, calls: nodeFetches };

  // Worker 測完立即還原；瀏覽器層另由 route 封鎖所有外網。
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;

  // ── Playwright：純靜態 server + 所有 API route stub ──
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  };
  server = createServer((request, response) => {
    const url = new URL(request.url, BASE);
    if (url.pathname.startsWith('/api/')) { response.statusCode = 500; return response.end('API 必須由 Playwright route 攔截'); }
    let file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
    if (file === ROOT || (fs.existsSync(file) && fs.statSync(file).isDirectory())) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { response.statusCode = 404; return response.end('not found'); }
    response.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    const body = fs.readFileSync(file);
    // route 供應本機 Leaflet，hash 與 CDN SRI 不同；比照既有 verify harness 只在受測 document 拿掉 integrity。
    response.end(path.extname(file) === '.html' ? body.toString('utf8').replace(/\s+integrity="[^"]+"/g, '') : body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });

  const leafletRoot = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
  const leafletJs = fs.readFileSync(path.join(leafletRoot, 'leaflet.js'));
  const leafletCss = fs.readFileSync(path.join(leafletRoot, 'leaflet.css'));
  let browserHazard = { at: '', observedAt: '2026-08-04T04:00:00.000Z', source: 'NCDR', stale: false, hazards: [] };
  let browserHazardStatus = 200;
  const apiCalls = [];

  const installOfflineRoutes = (targetPage, callsSink = apiCalls) => targetPage.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('leaflet.min.js'))
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs });
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('leaflet.min.css'))
      return route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss });
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      if (url.pathname === '/api/hazard-alert') {
        callsSink.push({ path: url.pathname, status: browserHazardStatus, at: Date.now() });
        return route.fulfill({ status: browserHazardStatus, contentType: 'application/json', body: JSON.stringify(browserHazard) });
      }
      if (url.pathname.startsWith('/api/')) {
        callsSink.push({ path: url.pathname, status: 200, at: Date.now() });
        const body = url.pathname.endsWith('-alert')
          ? { at: '', alerts: [] }
          : url.pathname === '/api/trtc-live'
            ? { at: '', src: null, trains: [], board: [], boardPos: { at: null, rows: [], dropped: {} } }
            : { at: '', rows: [], trains: [] };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return route.continue();
    }
    output.blockedExternal.push(url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
  await installOfflineRoutes(page);

  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && typeof pollHazard === 'function' && typeof runHazardChecks === 'function'; }
    catch (e) { return false; }
  }, null, { timeout: 10000 });
  try {
    await page.waitForFunction(() => state.ready, null, { timeout: 60000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      ready: !!state.ready, mode: state.mode, group: state.group,
      systems: (state.systems || []).length, lines: (state.lines || []).length,
    })).catch(e => ({ evaluateError: String(e) }));
    throw new Error(`boot 未完成：${JSON.stringify(diagnostic)}；pageErrors=${JSON.stringify(pageErrors)}；${error.message}`);
  }
  await sleep(300);
  await page.waitForFunction(() => typeof _hazardPolling !== 'undefined' && !_hazardPolling, null, { timeout: 5000 });

  await page.evaluate(() => {
    window.__hazardCalls = { live: 0, trtc: 0, metro: 0, ntm: 0, alert: 0 };
    window.__hazardOriginalChecks = { pollLive, pollTrtcLive, pollMetroLive, pollNtmLive, pollAlert, runHazardChecks };
    pollLive = window.pollLive = async () => { window.__hazardCalls.live++; };
    pollTrtcLive = window.pollTrtcLive = async () => { window.__hazardCalls.trtc++; };
    pollMetroLive = window.pollMetroLive = async () => { window.__hazardCalls.metro++; };
    pollNtmLive = window.pollNtmLive = async () => { window.__hazardCalls.ntm++; };
    pollAlert = window.pollAlert = async () => { window.__hazardCalls.alert++; };
    state.playing = false;
    state.simSec = 8 * 3600 + 30 * 60;
    state.clockAtNow = false;
  });
  apiCalls.length = 0; // boot 的初始 poll 不算本組

  const calls = () => page.evaluate(() => ({ ...window.__hazardCalls }));
  const countsEqual = (a, b) => ['live', 'trtc', 'metro', 'ntm', 'alert'].every(k => a[k] === b[k]);
  // 災害不能把同一份 cached 即時 snapshot 額外餵進 2-strike 狀態機；只立即重查官方公告。
  const hazardDeltaOne = (a, b) => b.alert === a.alert + 1 &&
    ['live', 'trtc', 'metro', 'ntm'].every(k => b[k] === a[k]);
  const endpointHazard = (id, updated, title = '臺北市地震警報', times = {}) => {
    const effectiveAt = times.effectiveAt ?? Date.parse('2020-01-01T00:00:00+08:00');
    const expiresAt = times.expiresAt ?? Date.parse('2099-01-01T00:00:00+08:00');
    return {
      at: updated, observedAt: '2026-08-04T04:00:00.000Z', source: 'NCDR', stale: false,
      hazards: [{ id, type: '地震', title, updated,
        effective: new Date(effectiveAt).toISOString(), expires: new Date(expiresAt).toISOString(),
        effectiveAt: new Date(effectiveAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() }],
    };
  };
  const trainCountSnapshot = () => page.evaluate(() => {
    const pool = metroLivePool().filter(ln => ln && ln._tt && ln._tt.length);
    return Object.fromEntries(pool.map((ln, i) => {
      const key = `${freqSysIdOf(ln)}:${ln.id}:${i}`;
      const roster = ln._tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length;
      const screen = ln._tt.filter(tr => freqTrainPosAt(ln, tr, state.simSec) != null).length;
      return [key, { roster, screen }];
    }));
  });

  const trainBefore = await trainCountSnapshot();
  const beforeFirst = await calls();
  browserHazard = endpointHazard('quake-ui-1', '2026-08-04T12:01:00+08:00');
  await page.evaluate(() => pollHazard());
  const afterFirst = await calls();
  check(hazardDeltaOne(beforeFirst, afterFirst), 'B1 首見警報只立即重查官方公告一次，不重餵即時 snapshot',
    JSON.stringify({ beforeFirst, afterFirst }));

  const ui = await page.evaluate(() => {
    renderAlertBanner();
    const entries = hazardWatchEntries();
    const banner = document.getElementById('alertBanner');
    return {
      entries, watch: state.hazardWatch,
      text: `${entries.map(x => `${x.title || ''} ${x.desc || ''}`).join(' ')} ${(banner && banner.textContent) || ''}`,
    };
  });
  check(Array.isArray(ui.entries) && ui.entries.length > 0 && /地震|災害/.test(ui.text),
    'B2 hazardWatchEntries 與公告 UI 顯示災害監看文字', ui.text.slice(0, 240));

  const beforeSame = await calls();
  await page.evaluate(() => pollHazard());
  const afterSame = await calls();
  check(countsEqual(beforeSame, afterSame), 'B3 相同事件重送會 dedupe', JSON.stringify({ beforeSame, afterSame }));

  browserHazard = endpointHazard('quake-ui-1', '2026-08-04T12:02:00+08:00', '臺北市地震警報（更新）');
  const beforeUpdate = await calls();
  await page.evaluate(() => pollHazard());
  const afterUpdate = await calls();
  check(hazardDeltaOne(beforeUpdate, afterUpdate), 'B4 同事件 updated 改變會再觸發一次公告重查', JSON.stringify({ beforeUpdate, afterUpdate }));

  // hidden 時要記 pending，但不能重查；回前景後以直接 pollHazard 精準驗證只補一次公告。
  browserHazard = endpointHazard('quake-ui-2', '2026-08-04T12:03:00+08:00', '第二起地震警報');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); });
  const beforeHidden = await calls();
  await page.evaluate(() => pollHazard());
  const afterHidden = await calls();
  const hiddenState = await page.evaluate(() => ({ pending: !!_hazardPending, entries: hazardWatchEntries() }));
  check(countsEqual(beforeHidden, afterHidden) && hiddenState.pending,
    'B5 hidden 時不重查並保留 pending', JSON.stringify({ beforeHidden, afterHidden, hiddenState }));
  await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    await pollHazard(); // 精準模擬 hazard 的 foreground 補跑，不混入其他既有 visibility listeners
  });
  const afterForeground = await calls();
  const foregroundState = await page.evaluate(() => ({ pending: !!_hazardPending }));
  check(hazardDeltaOne(beforeHidden, afterForeground) && !foregroundState.pending,
    'B5 回前景精確補跑一個 hazard batch', JSON.stringify({ beforeHidden, afterForeground, foregroundState }));

  // 突變控制：no-op 必須讓「updated 事件會觸發公告重查」這個條件變紅；再還原並用下一版事件驗綠。
  browserHazard = endpointHazard('quake-ui-2', '2026-08-04T12:04:00+08:00', '第二起地震警報（更新一）');
  await page.evaluate(() => {
    window.__hazardSavedRun = runHazardChecks;
    runHazardChecks = window.runHazardChecks = async () => {};
  });
  const beforeMutation = await calls();
  await page.evaluate(() => pollHazard());
  const afterMutation = await calls();
  const mutatedWouldPass = hazardDeltaOne(beforeMutation, afterMutation);
  check(!mutatedWouldPass, 'B6 突變控制：runHazardChecks=no-op 時核心條件確實會紅',
    JSON.stringify({ beforeMutation, afterMutation }));
  await page.evaluate(() => { runHazardChecks = window.runHazardChecks = window.__hazardSavedRun; delete window.__hazardSavedRun; });
  browserHazard = endpointHazard('quake-ui-2', '2026-08-04T12:05:00+08:00', '第二起地震警報（更新二）');
  const beforeRestore = await calls();
  await page.evaluate(() => pollHazard());
  const afterRestore = await calls();
  check(hazardDeltaOne(beforeRestore, afterRestore), 'B6 還原後 updated 事件恢復觸發公告重查',
    JSON.stringify({ beforeRestore, afterRestore }));

  // hazard endpoint 掛掉時不能把「來源失敗」當成「示警解除」；仍有效者標 stale，已過期者淘汰。
  browserHazardStatus = 503;
  await page.evaluate(() => { _hazardCheckedAt = Date.now() - HAZARD_RECHECK_MS - 1; });
  const beforeStaleDue = await calls();
  await page.evaluate(() => pollHazard());
  const afterStaleDue = await calls();
  const staleActive = await page.evaluate(() => {
    const entries = hazardWatchEntries();
    return { watch: state.hazardWatch, entries,
      text: entries.map(x => `${x.title || ''} ${x.desc || ''}`).join(' ') };
  });
  check(!!staleActive.watch && staleActive.watch.stale === true && staleActive.watch.list.length > 0 &&
      /暫時無法更新|沿用上次/.test(staleActive.text),
    'B7 hazard endpoint 失敗：未過期舊警報保留並標 stale', JSON.stringify(staleActive));
  check(hazardDeltaOne(beforeStaleDue, afterStaleDue),
    'B7 stale 且複查到期時只重查公告，不重餵即時 snapshot', JSON.stringify({ beforeStaleDue, afterStaleDue }));

  await page.evaluate(() => {
    if (state.hazardWatch && Array.isArray(state.hazardWatch.list)) {
      // 模擬「上次成功後時間流逝至 expiresAt」；下一輪仍由同一個 503 failure path 處理。
      for (const hazard of state.hazardWatch.list) hazard.expiresAt = new Date(Date.now() - 1).toISOString();
    }
  });
  await page.evaluate(() => pollHazard());
  const staleExpired = await page.evaluate(() => ({
    watch: state.hazardWatch,
    entries: hazardWatchEntries(),
  }));
  check((!staleExpired.watch || !staleExpired.watch.list || staleExpired.watch.list.length === 0) && staleExpired.entries.length === 0,
    'B8 hazard endpoint 失敗：已過期舊警報淘汰', JSON.stringify(staleExpired));

  browserHazardStatus = 200;
  browserHazard = { at: '', observedAt: new Date().toISOString(), source: 'NCDR', stale: false, hazards: [] };
  await page.evaluate(() => pollHazard());

  const alertKeys = await page.evaluate(() => {
    const previous = { mode: state.mode, sysId: state.sysId, freqSel: state.freqSel };
    try {
      state.mode = 'freq'; state.sysId = 'trtc'; state.freqSel = new Set(['trtc']);
      const before = alertPollKey();
      state.freqSel = new Set(['trtc', 'krtc']);
      const after = alertPollKey();
      return { before, after };
    } finally {
      state.mode = previous.mode; state.sysId = previous.sysId; state.freqSel = previous.freqSel;
    }
  });
  check(alertKeys.before === alertKeys.after,
    'B9 freq 勾選變更不改 alertPollKey（聚合公告請求仍是同一份）', JSON.stringify(alertKeys));

  const trainAfter = await trainCountSnapshot();
  const rosterOk = Object.values(trainAfter).every(x => x.roster === x.screen);
  check(Object.keys(trainBefore).length > 0 && rosterOk && JSON.stringify(trainBefore) === JSON.stringify(trainAfter),
    'B10 警報／dedupe／hidden／failure／突變全程名冊與畫面車數逐線不變',
    `lines=${Object.keys(trainAfter).length}, parity=${JSON.stringify(trainBefore) === JSON.stringify(trainAfter)}`);
  check(pageErrors.length === 0, 'B11 瀏覽器測試期間無 pageerror', JSON.stringify(pageErrors));
  check(apiCalls.filter(x => x.path === '/api/hazard-alert').length >= 5,
    'B12 pollHazard 全部命中本機攔截端點', JSON.stringify(apiCalls));
  check(output.blockedExternal.length > 0, 'B13 外部圖磚請求確實被離線 route 攔截（正向控制）',
    `aborted=${output.blockedExternal.length}`);
  output.browser = { beforeFirst, afterFirst, beforeSame, afterSame, beforeUpdate, afterUpdate,
    beforeHidden, afterHidden, afterForeground, hiddenState, foregroundState,
    beforeMutation, afterMutation, beforeRestore, afterRestore, beforeStaleDue, afterStaleDue, staleActive, staleExpired, alertKeys,
    ui, trainBefore, trainAfter, apiCalls, pageErrors };

  // ── 手機觸控矩陣：真 touch context + page.tap；警報 UI 的任何互動都不得碰列車存在性 ──
  await context.close(); // 停掉桌面頁面的 interval，讓四個手機案例彼此獨立。
  browserHazardStatus = 200;
  browserHazard = endpointHazard('quake-mobile-1', '2026-08-04T12:06:00+08:00', '行動版地震警報');
  const mobileRows = [];
  for (const width of [360, 375, 414, 768]) {
    let mobileContext = null;
    const row = { width, configured: { isMobile: true, hasTouch: true }, apiCalls: [], pageErrors: [] };
    try {
      mobileContext = await browser.newContext({
        viewport: { width, height: width === 768 ? 1024 : 844 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 1,
      });
      await mobileContext.addInitScript(() => {
        localStorage.setItem('trainmap-howto-seen', '1');
        localStorage.setItem('trainmap-appearance', 'light');
      });
      const mobilePage = await mobileContext.newPage();
      mobilePage.on('pageerror', error => row.pageErrors.push(String(error && error.stack || error)));
      await installOfflineRoutes(mobilePage, row.apiCalls);
      await mobilePage.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await mobilePage.waitForFunction(() => {
        try { return typeof state !== 'undefined' && state.ready && typeof pollHazard === 'function'; }
        catch (e) { return false; }
      }, null, { timeout: 60000 });
      await mobilePage.waitForFunction(() => typeof _hazardPolling !== 'undefined' && !_hazardPolling,
        null, { timeout: 10000 });
      await mobilePage.evaluate(async () => {
        state.playing = false; state.simSec = 8 * 3600 + 30 * 60; state.clockAtNow = false;
        await pollHazard(); renderAlertBanner();
      });
      await mobilePage.waitForFunction(() => {
        const chip = document.getElementById('alertChip');
        return !!chip && !chip.hidden && chip.getBoundingClientRect().width > 0;
      }, null, { timeout: 10000 });

      const snapshot = () => mobilePage.evaluate(() => {
        const pool = metroLivePool().filter(ln => ln && ln._tt && ln._tt.length);
        return Object.fromEntries(pool.map((ln, i) => {
          const key = `${freqSysIdOf(ln)}:${ln.id}:${i}`;
          const roster = ln._tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length;
          const screen = ln._tt.filter(tr => freqTrainPosAt(ln, tr, state.simSec) != null).length;
          return [key, { roster, screen }];
        }));
      });
      row.trainBefore = await snapshot();
      row.entry = await mobilePage.evaluate(() => {
        const chip = document.getElementById('alertChip');
        const r = chip.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          visible: !chip.hidden && r.width > 0 && r.height > 0,
          hitSelf: hit === chip || chip.contains(hit),
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          maxTouchPoints: navigator.maxTouchPoints,
          mobileMedia: matchMedia(MOBILE_MQ).matches,
        };
      });
      await mobilePage.tap('#alertChip');
      await mobilePage.waitForFunction(() => {
        const detail = document.getElementById('alertDetail');
        return !!detail && !detail.hidden && detail.textContent.trim().length > 0;
      }, null, { timeout: 5000 });
      row.detail = await mobilePage.evaluate(() => {
        const detail = document.getElementById('alertDetail');
        const r = detail.getBoundingClientRect();
        const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        return {
          open: !detail.hidden, text: detail.textContent.slice(0, 240),
          inViewportX: r.left >= -1 && r.right <= innerWidth + 1,
          horizontalOverflow: scrollWidth - innerWidth,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
      row.trainAfter = await snapshot();
      row.trainParity = Object.keys(row.trainBefore).length > 0 &&
        Object.values(row.trainAfter).every(x => x.roster === x.screen) &&
        JSON.stringify(row.trainBefore) === JSON.stringify(row.trainAfter);
      row.pass = row.entry.visible && row.entry.hitSelf && row.entry.maxTouchPoints > 0 && row.entry.mobileMedia &&
        row.detail.open && /地震|災害/.test(row.detail.text) && row.detail.inViewportX &&
        row.detail.horizontalOverflow <= 1 && row.trainParity && row.pageErrors.length === 0;
      check(row.pass, `M${width} touch 警報入口可點、詳情可開、零水平 overflow、車數不變`,
        JSON.stringify({ entry: row.entry, detail: row.detail, trainParity: row.trainParity, pageErrors: row.pageErrors }));
    } catch (error) {
      row.error = String(error && error.stack || error);
      check(false, `M${width} touch 警報入口可點、詳情可開、零水平 overflow、車數不變`, row.error);
    } finally {
      mobileRows.push(row);
      if (mobileContext) await mobileContext.close().catch(() => {});
    }
  }
  output.mobile = mobileRows;
} catch (error) {
  failures++;
  output.error = String(error && error.stack || error);
  console.error(output.error);
} finally {
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve)).catch(() => {});
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  output.failures = failures;
  output.summary = { total: output.assertions.length, passed: output.assertions.filter(x => x.pass).length, failed: failures };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
}

console.log(`\n合計 ${output.summary.passed}/${output.summary.total} PASS，${failures} FAIL`);
console.log(`長結果：${OUT}`);
if (failures) process.exitCode = 1;
