#!/usr/bin/env node
// 北捷逐班位置校正驗收：只連本機 fixture / Wrangler，真實語料逐快照回放。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { buildTrtcModel, resolveBoardRows, claimBoardRows, collapseClaims,
  branchLineHintsFromLedger } from './trtc_board_ledger.mjs';

const ROOT = path.resolve(process.env.TRTC_POS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const OUTPUT = path.resolve(process.env.TRTC_POS_OUTPUT || path.join(ROOT, 'tmp/verify_trtc_board_positions-output.json'));
const PAGE_ROOT = path.resolve(process.env.TRTC_POS_PAGE_ROOT || ROOT);
const PAGE_HTML = PAGE_ROOT === ROOT ? null : fs.readFileSync(path.join(PAGE_ROOT, 'index.html'), 'utf8');
const FIXTURE_PORT = Number(process.env.TRTC_POS_FIXTURE_PORT || 43387);
const WORKER_PORT = Number(process.env.TRTC_POS_WORKER_PORT || 43389);
const INSPECTOR_PORT = Number(process.env.TRTC_POS_INSPECTOR_PORT || 43390);
const PERSIST_DIR = process.env.TRTC_POS_PERSIST_DIR || fs.mkdtempSync('/tmp/railisland-trtc-pos-');
const CLEAN_PERSIST_DIR = !process.env.TRTC_POS_PERSIST_DIR;
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const BASE = `https://127.0.0.1:${WORKER_PORT}`;
const SCREEN_BASELINE_REF = process.env.TRTC_SCREEN_BASELINE_REF || '45f0fc1';
// hold-out 的預測視野上限。舊值 4*60+15=255 秒是人為的，會讓「7 分以上」永遠 n=0；
// UI 來車看板每方向顯示兩班，第二班在 4 分班距的線上約 8 分、5 分班距約 10 分，
// 全都落在舊上限之外 ⇒ 產品上看得到的東西從來沒被驗過。拉到 30 分鐘才量得到衰減曲線。
const HOLDOUT_HORIZON_SEC = Number(process.env.TRTC_HOLDOUT_HORIZON_SEC || 1800);
const output = { fixture: FIXTURE, base: BASE, assertions: [], samples: [], mobile: [], metrics: {} };
let failures = 0;

function check(condition, label, detail) {
  output.assertions.push({ pass: !!condition, label, detail });
  console.log(`${condition ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  if (!condition) failures++;
}
const percentile = (values, p) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
};
const dist = values => ({ count: values.length, p50: percentile(values, .5), p90: percentile(values, .9), max: percentile(values, 1) });
const signedDist = values => ({ count: values.length, p50: percentile(values, .5),
  p90: percentile(values, .9), min: percentile(values, 0), max: percentile(values, 1),
  mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null });
const haversineM = (a, b) => {
  const rad = x => x * Math.PI / 180, p1 = rad(a.lat), p2 = rad(b.lat);
  const dp = p2 - p1, dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

function scanPositionSanity(frames) {
  const range = frames.flatMap(f => f.rangeFailures || []);
  const jumps = [], backwards = [], crossings = [];
  let eligibleFramePairs = 0;
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1], after = frames[i], dt = after.at - before.at;
    if (!(dt > 0 && dt <= 30)) continue;
    eligibleFramePairs++;
    const a = new Map(before.positions.map(x => [x.tripKey, x]));
    const b = new Map(after.positions.map(x => [x.tripKey, x]));
    for (const [key, next] of b) {
      const prev = a.get(key); if (!prev) continue;
      const meters = haversineM(prev, next);
      if (meters > 2000) jumps.push({ fromSlot: before.slot, toSlot: after.slot, tripKey: key,
        line: next.line, dt, meters: Math.round(meters), fromOrd: prev.ord, toOrd: next.ord });
      if (next.ord < prev.ord - .75) backwards.push({ fromSlot: before.slot, toSlot: after.slot,
        tripKey: key, line: next.line, fromOrd: prev.ord, toOrd: next.ord });
    }
    const groups = new Map();
    for (const next of b.values()) {
      const prev = a.get(next.tripKey); if (!prev || prev.routeKey !== next.routeKey) continue;
      let list = groups.get(next.routeKey); if (!list) groups.set(next.routeKey, list = []);
      list.push({ prev, next });
    }
    for (const [routeKey, list] of groups) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const p = list[x], q = list[y];
      if ((p.prev.ord - q.prev.ord) * (p.next.ord - q.next.ord) < -1e-6)
        crossings.push({ fromSlot: before.slot, toSlot: after.slot, routeKey,
          a: p.next.tripKey, b: q.next.tripKey });
    }
  }
  return { eligibleFramePairs, range, jumps, backwards, crossings };
}

function summarizeHoldout(frames, predictedMutationSec = 0, truthMutationSec = 0) {
  const forecasts = frames.flatMap((frame, frameIndex) => (frame.predictions || []).map(x => ({ ...x,
    frameIndex, slot: frame.slot, issuedSec: frame.issuedSec, predictedSec: x.predictedSec + predictedMutationSec })));
  const truths = frames.flatMap((frame, frameIndex) => (frame.truths || []).map(x => ({ ...x,
    frameIndex, slot: frame.slot, actualSec: x.actualSec + truthMutationSec })));
  const samples = [];
  for (const f of forecasts) {
    const future = truths.filter(t => t.frameIndex > f.frameIndex && t.line === f.line && t.dir === f.dir && t.to === f.to &&
      t.actualSec >= f.issuedSec && t.actualSec - f.issuedSec <= HOLDOUT_HORIZON_SEC &&
      (f.no ? (t.no && t.no === f.no) : (!t.no && t.tripKey === f.tripKey)))
      .sort((a, b) => a.frameIndex - b.frameIndex || a.actualSec - b.actualSec)[0];
    if (!future) continue;
    const horizonSec = f.predictedSec - f.issuedSec;
    if (!(horizonSec >= 0 && horizonSec <= HOLDOUT_HORIZON_SEC)) continue;
    const signedErrorSec = f.predictedSec - future.actualSec;
    samples.push({ line: f.line, source: f.source, identity: f.no ? 'official_no' : 'anonymous_schedule_assignment',
      slot: f.slot, truthSlot: future.slot, tripKey: f.tripKey, no: f.no || '', to: f.to,
      issuedSec: f.issuedSec, predictedSec: f.predictedSec, actualSec: future.actualSec,
      horizonSec, signedErrorSec, absErrorSec: Math.abs(signedErrorSec) });
  }
  const group = rows => ({ absolute: dist(rows.map(x => x.absErrorSec)), signed: signedDist(rows.map(x => x.signedErrorSec)),
    bias: { early: rows.filter(x => x.signedErrorSec < 0).length, exact: rows.filter(x => x.signedErrorSec === 0).length,
      late: rows.filter(x => x.signedErrorSec > 0).length } });
  const byLine = {};
  for (const line of [...new Set(samples.map(x => x.line))].sort()) {
    byLine[line] = {};
    for (const source of ['own', 'fallback']) byLine[line][source] = group(samples.filter(x => x.line === line && x.source === source));
  }
  const bySource = Object.fromEntries(['own', 'fallback'].map(source => [source, group(samples.filter(x => x.source === source))]));
  const byIdentity = Object.fromEntries(['official_no', 'anonymous_schedule_assignment']
    .map(identity => [identity, group(samples.filter(x => x.identity === identity))]));
  return { samples, byLine, bySource, byIdentity };
}
const epoch = value => {
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : null;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server ready timeout: ${buf.slice(-2000)}`)), timeoutMs);
    const onData = chunk => { buf += String(chunk); if (pattern.test(buf)) { clearTimeout(timer); resolve(buf); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${buf.slice(-2000)}`)); });
  });
}

// 就緒＝**這台 server 對任何請求給得出一個 HTTP 回應**：不看狀態碼、不比對 wrangler 的 log 措辭。
//
// 🔴 2026-08-05：原本等 `/Ready on https:\/\/localhost/` **只等 30 秒**，於是這支長期在任何一條
// 斷言跑到之前就 exit 1（覆蓋率＝0），症狀偽裝成「環境問題」。受控實驗（每 10 秒探一次）量到：
// wrangler **立刻就 bind 好埠**（`lsof` 馬上看得到 LISTEN），但要**約 50 秒**才真的能服務，
// 暖機期間單一發請求會卡 13～50 秒。真因就是等太短。
//   · 我一度誤判成「這版 wrangler 不印 Ready on 了」——手動觀察只等 45 秒。它有印，只是很慢。
//   · 每一發必須自帶 timeout：node 的 `fetch` 沒有預設 timeout，三發卡住就把整個 deadline 用光。
//   · 刻意**不**把「非 503」當就緒條件——`/api/delay-stats` 在全新的本機 D1 上本來就回 503，
//     那是環境條件不是暖機狀態，寫進就緒條件會讓這支永遠等不到（試過，是上一版的紅因）。
// 總 deadline 給 300 秒：50 秒是機器閒置時的值，這台常有 2 個 session 併跑，實測會更久。
async function waitForHttp(url, timeoutMs, child) {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';                 // 本機 wrangler 是自簽憑證
  try {
    const deadline = Date.now() + timeoutMs;
    let last = '(還沒送出任何請求)';
    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        await r.text();
        return r.status;
      } catch (e) { last = String((e && e.message) || e); }
      await new Promise(res => setTimeout(res, 1000));
    }
    throw new Error(`server ready timeout：${timeoutMs}ms 內 ${url} 一個 HTTP 回應都沒給（最後一次：${last}）`);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

const model = buildTrtcModel( // includeY 必須與 worker.js 的 trtcBoardModel 一致，否則本地錨點少一條線
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json'))),
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json'))),
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json'))),
  { includeY: true },
);

async function fixtureRows(slot) {
  await fetch(`${FIXTURE}/__config?slot=${slot}&advance=0&failTk=`, { method: 'POST' });
  const r = await fetch(`${FIXTURE}/metroapi/TrackInfo.asmx`, {
    method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8' },
    body: '<getTrackInfo><userName>fixture-user</userName><passWord>fixture-pass</passWord></getTrackInfo>',
  });
  if (!r.ok) throw new Error(`fixture TrackInfo ${slot}: ${r.status}`);
  const text = await r.text();
  const json = text.slice(0, text.indexOf('<?xml'));
  return JSON.parse(json);
}

function boardPositionPayload(raw, branchHints = null) {
  const at = Math.max(...raw.map(row => epoch(row.NowDateTime) || 0));
  const resolved = resolveBoardRows(model, raw, epoch, branchHints || new Map());
  if (branchHints) {
    branchHints.clear();
    for (const [no, line] of resolved.lineHints) branchHints.set(no, line);
  }
  const claimed = claimBoardRows(model, resolved.rows, at, new Map());
  const collapsed = collapseClaims(claimed.claims);
  return {
    at,
    rows: collapsed.map(x => ({ line: x.line, dir: x.dir, from: x.from, to: x.to,
      dest: x.destIdx, run: x.run, arrEpoch: x.arrEpoch, no: x.no || '', terminal: !!x.terminal })),
    atStation: collapsed.flatMap(owner => (owner.eventClaims.length ? owner.eventClaims : [owner])
      .filter(event => event.atStation).map(event => ({ line: event.line, to: event.to,
        arrEpoch: event.arrEpoch, no: event.no || owner.no || '', owner: { line: owner.line, dir: owner.dir,
          from: owner.from, to: owner.to, dest: owner.destIdx, arrEpoch: owner.arrEpoch, no: owner.no || '' } }))),
    branch: resolved.branch,
  };
}

const brRowsCache = new WeakMap();
function brRowIndexes(raw) { // 注入在原始 TrackInfo 層做；逐列 resolve，避免把其他線同批對照組一起改掉
  let indexes = brRowsCache.get(raw);
  if (indexes) return indexes;
  indexes = new Set();
  raw.forEach((row, index) => {
    const resolved = resolveBoardRows(model, [row], epoch);
    if (resolved.rows.length && resolved.rows[0].line === 'BR') indexes.add(index);
  });
  brRowsCache.set(raw, indexes);
  return indexes;
}
function injectBrDrop(raw, count) {
  const br = brRowIndexes(raw); let seen = 0;
  return raw.filter((row, index) => !br.has(index) || seen++ >= count);
}
function injectBrHalf(raw) {
  const br = brRowIndexes(raw); let seen = 0;
  return raw.filter((row, index) => !br.has(index) || seen++ % 2 === 1);
}
function injectBrDelay(raw, seconds) {
  const br = brRowIndexes(raw);
  return raw.map((row, index) => {
    if (!br.has(index)) return row;
    const m = String(row.CountDown == null ? '' : row.CountDown).match(/^(\d+):(\d+)$/);
    const old = m ? +m[1] * 60 + +m[2] : (String(row.CountDown) === '列車進站' ? 0 : null);
    if (old == null) return row;
    const next = old + seconds;
    return { ...row, CountDown: `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}` };
  });
}

const LEAFLET_DIST = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
const leafletJs = fs.readFileSync(path.join(LEAFLET_DIST, 'leaflet.js'));
const leafletCss = fs.readFileSync(path.join(LEAFLET_DIST, 'leaflet.css'));
async function preparePage(page, documentHtml = PAGE_HTML) {
  await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('leaflet.min.js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs });
    }
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('leaflet.min.css')) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss });
    }
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      if (route.request().resourceType() === 'document') {
        if (documentHtml != null) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
          body: documentHtml.replace(/\s+integrity="[^"]+"/g, '') });
        const response = await route.fetch();
        const html = (await response.text()).replace(/\s+integrity="[^"]+"/g, '');
        return route.fulfill({ response, body: html,
          headers: { ...response.headers(), 'content-type': 'text/html; charset=utf-8' } });
      }
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/trtc-live') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: [], rows: [], trains: [] }) });
      }
      return route.continue();
    }
    return route.abort('blockedbyclient');
  });
}

async function waitForBoot(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    ((state.decoLines || []).concat(state.lines || [])).some(ln => ln._sys === 'mrt' && ln._tt && ln._tt.length),
    null, { timeout: 30000 });
}

async function mobileMatrix(browserType, workerName) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await preparePage(page);
  page.on('pageerror', error => console.error(`[${workerName} pageerror]`, error.message));
  for (const width of [360, 375, 414, 768]) {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 800 });
    await waitForBoot(page);
    const selector = 'button.gtab[title="捷運與輕軌"]:visible';
    await page.waitForSelector(selector, { state: 'visible' });
    const hit = await page.$eval(selector, el => {
      const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(top && (top === el || top.closest('button') === el));
    });
    await page.tap(selector);
    await page.waitForFunction(() => state.mode === 'freq', null, { timeout: 10000 });
    const layout = await page.evaluate(() => {
      const badge = document.getElementById('metroBadge');
      const r = badge && !badge.hidden ? badge.getBoundingClientRect() : null;
      return {
        group: state.group, mode: state.mode,
        noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth + 1,
        badgeInside: !r || (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
      };
    });
    const rec = { engine: workerName, width, elementFromPoint: hit, ...layout };
    output.mobile.push(rec);
    check(hit && layout.mode === 'freq' && layout.noHorizontalScroll && layout.badgeInside,
      `${workerName} 觸控 ${width}px`, JSON.stringify(rec));
  }
  await browser.close();
}

async function run() {
  let fixtureProc, workerProc, browser;
  try {
    fixtureProc = spawn(process.execPath, [path.join(ROOT, 'scripts/fixture_trtc_board_ledger.mjs'), String(FIXTURE_PORT)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitFor(fixtureProc, /"ready":true/, 10000);
    workerProc = spawn('arch', ['-arm64', process.execPath, path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local-protocol', 'https', '--port', String(WORKER_PORT), '--inspector-port', String(INSPECTOR_PORT), '--test-scheduled',
      '--persist-to', PERSIST_DIR,
      '--var', 'TRTC_API_USER:fixture-user', '--var', 'TRTC_API_PASS:fixture-pass',
      '--var', `TRTC_API_BASE:${FIXTURE}`, '--var', 'TRTC_BOARD_SAMPLE_DELAY_MS:0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForHttp(`${BASE}/api/delay-stats`, 300000, workerProc);   // 這台實測閒置約 50 秒才能服務;兩個 session 併跑時更久

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await preparePage(page);
    page.on('pageerror', error => console.error('[Chromium pageerror]', error.message));
    await waitForBoot(page);
    await page.waitForFunction(() => state._trtcBoardAudit && state._trtcBoardAudit.matched > 0, null, { timeout: 30000 });
    const integrated = await page.evaluate(() => ({ ...state._trtcBoardAudit, assignments: undefined }));
    check(integrated.rows > 0 && integrated.matched > 0, '前後端 boardPos payload 已接通',
      `rows=${integrated.rows}, matched=${integrated.matched}, roster=${integrated.roster}`);
    await page.evaluate(() => { _trtcPolling = true; }); // 後續逐槽由測試明確注入，避免 15 秒輪詢改動 fixture call 順序
    await page.evaluate(() => { _lineAnom.clear(); _trtcNoTrip.clear(); _easedShift.clear(); });

    const anchorResiduals = [], baselineDistances = [], directions = new Set(), lineTotals = {};
    const invariantFailures = [], rawSnapshots = [], currentScreenCounts = [], normalAnomalyFrames = [];
    const auditFrames = [], branchFrames = [], branchHints = new Map();
    let mutationWitness = 0;
    for (let i = 1; i <= 17; i++) {
      const slot = `s${String(i).padStart(2, '0')}`;
      const raw = await fixtureRows(slot); rawSnapshots.push(raw);
      const payload = boardPositionPayload(raw, branchHints);
      branchFrames.push({ slot, ...payload.branch, hints: branchHints.size,
        luzhou: payload.rows.filter(x => x.line === 'O_LUZHOU' && !x.terminal).length,
        xinzhuang: payload.rows.filter(x => x.line === 'O_XINZHUANG' && !x.terminal).length });
      const result = await page.evaluate(({ rows, at, atStation, horizonCap }) => {
        map.setView([25.0478, 121.5170], 16, { animate: false });
        state.simSec = trtcServiceSec(at); state.clockAtNow = true;
        _easedShift.clear(); _metroGateEp.on = false; _metroGateEp.at = 0;
        _mlGate = true; _mlGateAt = Date.now();
        const audit = applyTrtcBoard(rows, at);
        // 回放的是歷史語料，但要模擬的是「這份 snapshot 剛剛才到」：資料齡以牆鐘計，
        // 不覆寫的話整批語料都會被判成幾十小時前的舊資料、shift 全歸零。
        // 資料齡本身另有專屬斷言（含新鮮/過期兩側對照），不靠這裡的主迴圈驗。
        for (const ln of metroLivePool()) if (ln._trtcBoard) ln._trtcBoard.at = Date.now();
        _mlGate = true; _mlGateAt = Date.now();
        const pool = metroLivePool().filter(ln => isTrtcBoardLine(ln) && ln._tt);
        const countRows = [], positions = [], predictions = [], screenPositions = [], rangeFailures = [];
        let mutationHits = 0;
        for (const ln of pool) {
          const roster = ln._tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length;
          const screen = ln._tt.filter(tr => freqTrainPosAt(ln, tr, state.simSec) != null).length;
          countRows.push({ line: ln.id, roster, screen,
            anchors: audit.byLine[ln.id] ? audit.byLine[ln.id].anchors : 0,
            movingAnchors: rows.filter(x => x.line === ln.id && !x.terminal).length,
            matched: audit.byLine[ln.id] ? audit.byLine[ln.id].matched : 0 });
          for (const tr of ln._tt) {
            const rosterTime = freqTrainTime(tr, state.simSec);
            if (rosterTime == null) continue;
            const board = ln._trtcBoard;
            const own = !!(board && board.shifts.has(tr));
            const targetShift = board ? (own ? board.shifts.get(tr) : board.all) : 0;
            const shifted = Math.max(tr[1], Math.min(tr[tr.length - 1], rosterTime - targetShift));
            const tripKey = freqTripKey(ln, tr), pos = freqTrainPosAt(ln, tr, state.simSec);
            if (!(shifted >= tr[1] && shifted <= tr[tr.length - 1]) || !pos ||
                !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon))
              rangeFailures.push({ line: ln.id, tripKey, shifted, start: tr[1], end: tr[tr.length - 1], pos });
            let ord = tr.length / 2 - 1;
            for (let k = 1; k < tr.length / 2; k++) {
              const dep = tr[(k - 1) * 2 + 1], nextDep = tr[k * 2 + 1], run = runBetween(ln, tr[(k - 1) * 2], tr[k * 2]);
              const move = run && run < nextDep - dep ? run : nextDep - dep;
              if (shifted < nextDep) { ord = k - 1 + Math.max(0, Math.min(1, (shifted - dep) / Math.max(1, move))); break; }
            }
            screenPositions.push({ line: ln.id, dir: tr[0] <= tr[tr.length - 2] ? 1 : -1,
              dest: tr[tr.length - 2], routeKey: ln.id + '|' + (tr[0] <= tr[tr.length - 2] ? 1 : -1) + '|' + tr[tr.length - 2],
              tripKey, ord, lat: pos && pos.lat, lon: pos && pos.lon });
            if (!board) continue;
            let no = '';
            const currentAssignment = audit.assignments.find(a => a.tripKey === tripKey);
            if (own && currentAssignment) no = currentAssignment.no || '';
            else for (const [key, value] of _trtcNoTrip) if (value === tripKey) { no = key.split('|').slice(2).join('|'); break; }
            for (let k = 1; k < tr.length / 2; k++) {
              const from = tr[(k - 1) * 2], to = tr[k * 2], dep = tr[(k - 1) * 2 + 1], nextDep = tr[k * 2 + 1];
              const run = runBetween(ln, from, to), move = run && run < nextDep - dep ? run : nextDep - dep;
              const predictedSec = dep + move + targetShift;
              if (predictedSec + .5 < state.simSec) continue;
              if (predictedSec - state.simSec > horizonCap) break;
              predictions.push({ line: ln.id, dir: tr[0] <= tr[tr.length - 2] ? 1 : -1, tripKey, no, to, predictedSec,
                source: own ? 'own' : 'fallback', targetShift });
            }
          }
        }
        for (const a of audit.assignments) {
          const ln = pool.find(x => x.id === a.line);
          const tr = ln && ln._tt.find(x => freqTripKey(ln, x) === a.tripKey);
          if (!ln || !tr) continue;
          if (a.shift > 0) {
            if (freqTrainPosAt(ln, tr, tr[1]) && !freqTrainPosRaw(ln, tr, tr[1] - a.shift)) mutationHits++;
          } else if (a.shift < 0) {
            const end = tr[tr.length - 1];
            if (freqTrainPosAt(ln, tr, end) && !freqTrainPosRaw(ln, tr, end - a.shift)) mutationHits++;
          }
          const actual = freqTrainPosAt(ln, tr, state.simSec);
          const baseline = freqTrainPosRaw(ln, tr, state.simSec);
          let expected;
          if (a.from === a.to) expected = posBetweenStations(ln, a.from, a.to, 0);
          else {
            const progress = Math.max(0, Math.min(1, 1 - (a.arrSec - state.simSec) / a.run));
            expected = posBetweenStations(ln, a.from, a.to, progress);
          }
          if (actual && baseline && expected) positions.push({ line: a.line, dir: a.dir, no: a.no,
            anchorResidualM: map.distance(actual, expected), baselineDistanceM: map.distance(baseline, expected), shift: a.shift });
        }
        const truths = [];
        for (const truth of atStation || []) {
          const actualSec = trtcServiceSec(truth.arrEpoch);
          const owner = truth.owner, ownerSec = trtcServiceSec(owner.arrEpoch);
          const hit = audit.assignments.find(a => a.line === owner.line && a.dir === (owner.dir === 2 ? 1 : -1) &&
            a.from === owner.from && a.to === owner.to && a.dest === owner.dest && a.arrSec === ownerSec &&
            (!owner.no || a.no === owner.no));
          truths.push({ line: truth.line, dir: owner.dir === 2 ? 1 : -1, to: truth.to, no: truth.no || '', actualSec,
            tripKey: hit ? hit.tripKey : '', assignmentMatched: !!hit });
        }
        const anomalies = pool.filter(ln => anomalyOf(ln)).map(ln => ln.id + ':' + anomalyOf(ln).kind);
        return { audit, countRows, positions, predictions, truths, screenPositions, rangeFailures, simSec: state.simSec,
          mutationHits, zoom: map.getZoom(), anomalies };
      }, { ...payload, horizonCap: HOLDOUT_HORIZON_SEC });
      auditFrames.push({ slot, at: payload.at, issuedSec: result.simSec, predictions: result.predictions, truths: result.truths,
        positions: result.screenPositions, rangeFailures: result.rangeFailures });
      currentScreenCounts.push(Object.fromEntries(result.countRows.map(row => [row.line, row.screen])));
      normalAnomalyFrames.push({ slot, anomalies: result.anomalies });
      for (const row of result.countRows) {
        if (row.roster !== row.screen) invariantFailures.push({ slot, ...row });
        const rec = lineTotals[row.line] || (lineTotals[row.line] = { roster: 0, anchors: 0, movingAnchors: 0, matched: 0 });
        rec.roster += row.roster; rec.anchors += row.anchors;
        rec.movingAnchors += row.movingAnchors; rec.matched += row.matched;
      }
      for (const p of result.positions) {
        anchorResiduals.push(p.anchorResidualM); baselineDistances.push(p.baselineDistanceM); directions.add(p.dir);
      }
      mutationWitness += result.mutationHits;
      output.samples.push({ slot, at: payload.at, rows: payload.rows.length, matched: result.audit.matched,
        contested: result.audit.contested, rejectedOrder: result.audit.overtakesRejected,
        roster: result.audit.roster, mutationHits: result.mutationHits, zoom: result.zoom });
    }

    output.metrics = {
      invariantFailures, mutationWitness, anchorConsistencyOnly: dist(anchorResiduals), baselineDistance: dist(baselineDistances),
      directions: [...directions].sort(), lineTotals, orangeBranchHints: branchFrames,
    };
    check(invariantFailures.length === 0 && mutationWitness > 0, '車數恆等式（附真實偏移突變）',
      `17 snapshots，mismatch=${invariantFailures.length}；舊式 shift 決定存在的突變命中=${mutationWitness}`);
    const warm = branchFrames.slice(8);
    const hintControl = resolveBoardRows(model, [{ TrainNumber: '431', StationName: '行天宮站',
      DestinationName: '南勢角站', CountDown: '00:30', NowDateTime: '2026-08-03 08:17:53' }], epoch,
      new Map([['431', 'O_LUZHOU']]));
    const hintMutation = resolveBoardRows(model, [{ TrainNumber: '431', StationName: '行天宮站',
      DestinationName: '南勢角站', CountDown: '00:30', NowDateTime: '2026-08-03 08:17:53' }], epoch,
      new Map([['431', 'O_XINZHUANG']]));
    const ledgerHint = branchLineHintsFromLedger(
      [{ track_id: 'trk-l', line: 'O_LUZHOU', official_no: '431' }],
      [{ alias_type: 'hw_no', alias: '431', track_id: 'trk-l' }]);
    check(branchFrames[0].fallback > 0 && branchFrames.some(x => x.hinted > 0) &&
      warm.every(x => x.fallback === 0 && x.conflicts === 0),
      '橘線跨輪分支身分：無證據首輪保留退路，暖機後共線列全數有提示',
      `firstFallback=${branchFrames[0].fallback}, warm=${JSON.stringify(warm.map(x => ({ slot: x.slot, hinted: x.hinted, fallback: x.fallback, conflicts: x.conflicts })))}`);
    check(hintControl.rows[0] && hintControl.rows[0].line === 'O_LUZHOU' &&
      hintMutation.rows[0] && hintMutation.rows[0].line === 'O_XINZHUANG' && ledgerHint.get('431') === 'O_LUZHOU',
      '橘線分支提示控制組／突變組／帳本復原組',
      `control=${hintControl.rows[0] && hintControl.rows[0].line}, mutation=${hintMutation.rows[0] && hintMutation.rows[0].line}, ledger=${ledgerHint.get('431')}`);
    const positionSanity = scanPositionSanity(auditFrames);
    const sanityControl = scanPositionSanity([
      { slot: 'c1', at: 0, positions: [
        { tripKey: 'a', line: 'T', routeKey: 'T|1|2', ord: 0, lat: 25, lon: 121 },
        { tripKey: 'b', line: 'T', routeKey: 'T|1|2', ord: 1, lat: 25.001, lon: 121 }], rangeFailures: [] },
      { slot: 'c2', at: 15, positions: [
        { tripKey: 'a', line: 'T', routeKey: 'T|1|2', ord: .1, lat: 25.0001, lon: 121 },
        { tripKey: 'b', line: 'T', routeKey: 'T|1|2', ord: 1.1, lat: 25.0011, lon: 121 }], rangeFailures: [] },
    ]);
    const sanityMutation = scanPositionSanity([
      { slot: 'm1', at: 0, positions: [
        { tripKey: 'a', line: 'T', routeKey: 'T|1|2', ord: 0, lat: 25, lon: 121 },
        { tripKey: 'b', line: 'T', routeKey: 'T|1|2', ord: 1, lat: 25.001, lon: 121 }], rangeFailures: [] },
      { slot: 'm2', at: 15, positions: [
        { tripKey: 'a', line: 'T', routeKey: 'T|1|2', ord: 2, lat: 25.1, lon: 121 },
        { tripKey: 'b', line: 'T', routeKey: 'T|1|2', ord: -.1, lat: 25.0011, lon: 121 }],
        rangeFailures: [{ line: 'T', tripKey: 'mutated' }] },
    ]);
    output.metrics.positionSanity = positionSanity;
    output.metrics.positionSanityMutation = { control: sanityControl, mutated: sanityMutation };
    const sanityCount = x => x.range.length + x.jumps.length + x.backwards.length + x.crossings.length;
    check(anchorResiduals.length > 0 && percentile(anchorResiduals, .9) < 1500 && positionSanity.range.length === 0,
      '位置區間契約：不出班表行程範圍（跨槽跳站／倒退／穿越因 210 秒槽距無法下結論）',
      `anchor 同源殘差只作契約檢查=${JSON.stringify(dist(anchorResiduals))}；sanity=${JSON.stringify(positionSanity)}`);
    check(sanityCount(sanityControl) === 0 && sanityCount(sanityMutation) >= 4,
      '位置離譜收集器控制組／突變組', `control=${sanityCount(sanityControl)}, mutation=${sanityCount(sanityMutation)}`);

    // A 主菜：第 k 槽只以當下 shift 預測下一站到站秒；真值只取後續槽 CountDown=列車進站。
    // 有官方車號的列直接用車號跨槽對齊（不經後槽班表 matcher）；文湖線無車號，只能另列為
    // anonymous_schedule_assignment，不能把它與官方車號組混成同等強度的獨立真值。
    const holdout = summarizeHoldout(auditFrames);
    const predictionMutation = summarizeHoldout(auditFrames, 60, 0);
    const truthMutation = summarizeHoldout(auditFrames, 0, 60);
    const sampleKey = x => `${x.slot}|${x.truthSlot}|${x.tripKey}|${x.to}|${x.source}`;
    const baseByKey = new Map(holdout.samples.map(x => [sampleKey(x), x]));
    const predWitness = predictionMutation.samples.filter(x => baseByKey.has(sampleKey(x)) &&
      x.signedErrorSec - baseByKey.get(sampleKey(x)).signedErrorSec === 60).length;
    const truthWitness = truthMutation.samples.filter(x => baseByKey.has(sampleKey(x)) &&
      x.signedErrorSec - baseByKey.get(sampleKey(x)).signedErrorSec === -60).length;
    const holdoutFutureOnly = holdout.samples.every(x => Number(x.truthSlot.slice(1)) > Number(x.slot.slice(1)));
    output.metrics.arrivalHoldout = holdout;
    output.metrics.arrivalHoldoutFrameCounts = auditFrames.map(f => ({ slot: f.slot,
      predictions: f.predictions.length, truths: f.truths.length,
      predictionWithNo: f.predictions.filter(x => x.no).length,
      truthMatched: f.truths.filter(x => x.assignmentMatched).length,
      truthWithNo: f.truths.filter(x => x.no).length }));
    output.metrics.arrivalHoldoutDebug = auditFrames.slice(0, 2).map(f => ({ slot: f.slot,
      predictions: f.predictions.slice(0, 8), truths: f.truths.slice(0, 8) }));
    output.metrics.arrivalHoldoutFrames = auditFrames.map(f => ({ slot: f.slot, at: f.at, issuedSec: f.issuedSec,
      predictions: f.predictions, truths: f.truths }));
    output.metrics.arrivalHoldoutMutation = { predictionPlus60Witness: predWitness, truthPlus60Witness: truthWitness };
    check(holdout.samples.length > 0 && holdoutFutureOnly,
      '到站時間 hold-out：預測只用第 k 槽、真值只來自後續「列車進站」槽',
      `forecasts=${holdout.samples.length}, official-no=${holdout.samples.filter(x => x.identity === 'official_no').length}, ` +
      `anonymous=${holdout.samples.filter(x => x.identity !== 'official_no').length}`);
    check(predWitness > 0 && truthWitness > 0,
      '時間誤差收集器控制組／雙向突變組',
      `prediction+60s witnesses=${predWitness}, future-truth+60s witnesses=${truthWitness}`);
    check(directions.has(-1) && directions.has(1), '兩個行車方向皆有實測', `directions=${JSON.stringify([...directions].sort())}`);
    check(Object.values(lineTotals).every(x => x.roster === 0 || x.matched > 0), '各北捷線皆有真實錨點覆蓋', JSON.stringify(lineTotals));
    check(lineTotals.Y && lineTotals.Y.roster > 0 && lineTotals.Y.matched > 0,
      '環狀線 Y 已進入看板校正路徑', JSON.stringify(lineTotals.Y || null));
    check(normalAnomalyFrames.every(frame => frame.anomalies.length === 0),
      '異常偵測：正常語料 17 槽逐線零告警',
      JSON.stringify(normalAnomalyFrames.filter(frame => frame.anomalies.length)));

    // 資料齡與逐班未命中的退路：兩者都只准改「校正量」，不准改「車在不在」。
    // 判準刻意不看 metroLiveOn 自己回什麼（那會與實作同源）——只看畫面上的車數與實際 shift 值。
    const gates = await page.evaluate(() => {
      const pool = metroLivePool().filter(ln => isTrtcBoardLine(ln) && ln._trtcBoard && ln._trtcBoard.n > 0);
      const resync = () => { // easedShift 只在 gate 剛開啟的 5 秒內直接對齊 target，否則從 0 慢慢爬
        _easedShift.clear(); _metroGateEp.on = false; _metroGateEp.at = 0;
        _mlGate = true; _mlGateAt = Date.now();
      };
      const countAll = () => pool.reduce((n, ln) => n + ln._tt.filter(tr => freqTrainPosAt(ln, tr, state.simSec) != null).length, 0);
      const roster = pool.reduce((n, ln) => n + ln._tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length, 0);
      const maxShift = () => { // 正向對照：沒有它，staleShift===0 可能只是「本來就全 0」的空斷言
        let m = 0;
        for (const ln of pool)
          for (const tr of ln._tt) if (ln._trtcBoard.shifts.has(tr)) m = Math.max(m, Math.abs(metroShiftSec(ln, tr)));
        return Math.round(m);
      };
      resync();
      const fresh = countAll();
      resync();
      const freshShift = maxShift();
      // ① 未被看板認到的班次，target 應退回全線中位數 all，不是 0
      const ln0 = pool.find(ln => ln._trtcBoard.all !== 0 &&
        ln._tt.some(tr => freqTrainTime(tr, state.simSec) != null && !ln._trtcBoard.shifts.has(tr)));
      let fallback = null;
      if (ln0) {
        const miss = ln0._tt.find(tr => freqTrainTime(tr, state.simSec) != null && !ln0._trtcBoard.shifts.has(tr));
        resync();
        fallback = { line: ln0.id, all: ln0._trtcBoard.all, applied: Math.round(metroShiftSec(ln0, miss)) };
      }
      // ④ 把資料齡推到 40 分前：校正應整批歸零，車數一台都不准變
      const saved = pool.map(ln => ln._trtcBoard.at);
      pool.forEach(ln => { ln._trtcBoard.at = Date.now() - 40 * 60e3; });
      resync();
      const staleShift = maxShift();
      const stale = countAll();
      pool.forEach((ln, i) => { ln._trtcBoard.at = saved[i]; });
      resync();
      return { roster, fresh, stale, freshShift, staleShift, fallback, lines: pool.length };
    });
    check(gates.fallback && gates.fallback.applied === gates.fallback.all,
      '未認到的班次退回全線中位數（非 0）', JSON.stringify(gates.fallback));
    check(gates.roster === gates.fresh && gates.fresh === gates.stale && gates.freshShift > 0 && gates.staleShift === 0,
      '資料齡到期只關校正、不動車數（附新鮮側正向對照）', JSON.stringify(gates));
    // 異常偵測：2026-08-04 移除「車數腰斬」的自家推定（誤報率過高），大批停駛改由官方公告承擔。
    // 這裡剩兩件事要守：① 舊三訊號的接線還活著（九條看板線唯一的入口就是 applyTrtcBoard 這一處，
    // 曾經整整九線斷線而 verify_anomaly 18/18 照樣全綠）；② 任何注入都不准再產生 'gone'。
    const resetAnomalyState = () => page.evaluate(() => {
      _lineAnom.clear(); _trtcNoTrip.clear(); _easedShift.clear();
      for (const ln of metroLivePool()) delete ln._anomaly;
    });
    const applyAnomalyRaw = async raw => {
      const p = boardPositionPayload(raw);
      return page.evaluate(({ rows, at }) => {
        state.simSec = trtcServiceSec(at); state.clockAtNow = true;
        _mlGate = true; _mlGateAt = Date.now();
        const audit = applyTrtcBoard(rows, at);
        return {
          anomalies: metroLivePool().filter(ln => isTrtcBoardLine(ln) && anomalyOf(ln))
            .map(ln => ln.id + ':' + anomalyOf(ln).kind),
          br: audit.byLine.BR || null,
        };
      }, p);
    };
    const runAnomalyScenario = async mutate => {
      await resetAnomalyState();
      const baseline = [], injected = [];
      for (let i = 0; i < 10; i++) baseline.push(await applyAnomalyRaw(rawSnapshots[i]));
      for (let i = 10; i < rawSnapshots.length; i++) injected.push(await applyAnomalyRaw(mutate(rawSnapshots[i])));
      return { baseline, injected, final: injected.at(-1) };
    };
    // ① 車數型注入一律不准再叫（這正是被移除的那個判準會開火的三種情境）
    const scenarios = [
      ['BR 少 3 列', raw => injectBrDrop(raw, 3)],
      ['BR 半數消失', injectBrHalf],
      ['BR 全線 +10 分', raw => injectBrDelay(raw, 600)],
    ];
    output.metrics.anomalyAfterRemoval = {};
    for (const [label, mutate] of scenarios) {
      const result = await runAnomalyScenario(mutate);
      const goneHits = [...result.baseline, ...result.injected]
        .flatMap(step => step.anomalies.filter(value => value.endsWith(':gone')));
      output.metrics.anomalyAfterRemoval[label] = result;
      check(goneHits.length === 0, `車數判定已移除：${label}不再產生 'gone'`,
        `goneHits=${JSON.stringify(goneHits)}, final=${JSON.stringify(result.final)}`);
    }

    // ② 接線斷了沒：applyTrtcBoard 是九條看板線唯一的異常評估入口（pollMetroLive 排除 mrt、
    // Y 移出 pollNtmLive 之後就只剩這裡），曾經整整九線斷線而 verify_anomaly 18/18 照樣全綠。
    // 用 spy 直接數呼叫，判準是「恰好等於這 9 條線的 id 集合」——接線斷掉是 0，多接一處會多。
    await resetAnomalyState();
    const wired = await page.evaluate(({ rows, at }) => {
      const saved = evalLineAnomaly, seen = [];
      evalLineAnomaly = (ln, ...rest) => { seen.push(ln.id); return saved(ln, ...rest); };
      try { applyTrtcBoard(rows, at); } finally { evalLineAnomaly = saved; }
      return { seen: seen.sort(), expected: metroLivePool().filter(isTrtcBoardLine).map(ln => ln.id).sort() };
    }, boardPositionPayload(rawSnapshots[0]));
    output.metrics.anomalyWiring = wired;
    check(wired.seen.length > 0 && JSON.stringify(wired.seen) === JSON.stringify(wired.expected),
      '異常評估接線仍在：applyTrtcBoard 逐線呼叫 evalLineAnomaly（斷線=0，判準為恰好等於 9 線 id 集合）',
      `seen=${JSON.stringify(wired.seen)}`);

    // ③ 把「舊三訊號對看板路徑結構性打不到」寫成斷言，免得日後有人把 ② 的綠誤讀成「偵測還會動」。
    // 誤點的車不是產生矛盾樣本，而是倒數超過區間行駛時間 ⇒ 在 claim 階段整批被丟掉（實測：
    // 隔列 +10 分與半數消失的 anchors 同為 23）⇒ acc 沒有那群車，MAD 不升、rej 也不升。
    const structurallyBlind = Object.values(output.metrics.anomalyAfterRemoval)
      .every(r => r.final.anomalies.length === 0);
    check(structurallyBlind,
      '已知限制：移除車數判定後，看板九線對停駛／誤點型事故不再自行告警（改由官方公告承擔）',
      `三種注入的告警數皆為 0 = ${structurallyBlind}`);

    // 最重要的存在性對照：同一批 17 槽在派工基準 45f0fc1 與目前 index 上逐槽逐線數車，必須完全相同。
    // 基準頁只替換 document；資料、fixture、payload 與瀏覽器引擎都和目前頁一致。
    const baselineHtml = execFileSync('git', ['show', `${SCREEN_BASELINE_REF}:index.html`],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const baselinePage = await context.newPage();
    await preparePage(baselinePage, baselineHtml); await waitForBoot(baselinePage);
    await baselinePage.evaluate(() => {
      _trtcPolling = true; _lineAnom.clear(); _trtcNoTrip.clear(); _easedShift.clear();
    });
    const oldScreenCounts = [];
    for (const raw of rawSnapshots) {
      const p = boardPositionPayload(raw);
      oldScreenCounts.push(await baselinePage.evaluate(({ rows, at }) => {
        state.simSec = trtcServiceSec(at); state.clockAtNow = true;
        _mlGate = true; _mlGateAt = Date.now(); applyTrtcBoard(rows, at);
        return Object.fromEntries(metroLivePool().filter(ln => isTrtcBoardLine(ln) && ln._tt)
          .map(ln => [ln.id, ln._tt.filter(tr => freqTrainPosAt(ln, tr, state.simSec) != null).length]));
      }, p));
    }
    await baselinePage.close();
    const screenParityFailures = [];
    for (let i = 0; i < currentScreenCounts.length; i++) {
      for (const line of new Set([...Object.keys(currentScreenCounts[i]), ...Object.keys(oldScreenCounts[i])])) {
        if (currentScreenCounts[i][line] !== oldScreenCounts[i][line]) screenParityFailures.push({
          slot: `s${String(i + 1).padStart(2, '0')}`, line,
          before: oldScreenCounts[i][line], after: currentScreenCounts[i][line],
        });
      }
    }
    output.metrics.screenCountParity = { baselineRef: SCREEN_BASELINE_REF, before: oldScreenCounts,
      after: currentScreenCounts, failures: screenParityFailures };
    check(screenParityFailures.length === 0, `畫面車數與改動前 ${SCREEN_BASELINE_REF} 逐槽逐線完全相同`,
      `17 槽 × ${Object.keys(currentScreenCounts[0] || {}).length} 線，差異=${JSON.stringify(screenParityFailures)}`);

    const serviceDays = await page.evaluate(() => ({
      saturdayAfterMidnight: taipeiServiceDayStr(Date.parse('2026-08-01T17:00:00Z')),
      mondayMorning: taipeiServiceDayStr(Date.parse('2026-08-03T00:30:00Z')),
    }));
    check(serviceDays.saturdayAfterMidnight === '2026-08-01' && serviceDays.mondayMorning === '2026-08-03',
      '04:00 北捷營運日切點', JSON.stringify(serviceDays));
    await context.close(); await browser.close(); browser = null;

    // 靜態分層掃描只看本次新增行；零命中旁邊放同一掃描器的突變，證明規則真的會開火。
    // 🔴 基準必須是 origin/main 不是工作樹：用 `git diff`(無基準) 的話，一 commit 下去 added 就
    // 變空字串，staticHits 恆 0、字串突變仍回 2 ⇒ 這條斷言會永久全綠卻一行程式碼都沒看。
    // 同理要自檢「掃到的真的是本次新程式碼」，否則基準漂掉時同樣是假綠（心得 32）。
    const diff = execFileSync('git', ['diff', '--unified=0', 'origin/main', '--', 'index.html', 'worker.js'], { cwd: ROOT, encoding: 'utf8' });
    const added = diff.split('\n').filter(x => x.startsWith('+') && !x.startsWith('+++')).join('\n');
    const scansNewCode = /applyTrtcBoard/.test(added) && /trtcBoardPositionAnchors/.test(added);
    const forbidden = /last_seen|confidence|retention|retainSec|staleSec|windowSec|保留秒數|過舊門檻|信心分數/g;
    const parallel = /tr\._board|boardTrainPos|drawBoardGhost|boardLineOn/g;
    const staticHits = [...added.matchAll(forbidden), ...added.matchAll(parallel)].map(x => x[0]);
    const mutatedHits = [...(added + '\nconst last_seen = 1;\ntr._board = [];').matchAll(forbidden),
      ...(added + '\nconst last_seen = 1;\ntr._board = [];').matchAll(parallel)].map(x => x[0]);
    check(scansNewCode && staticHits.length === 0 && mutatedHits.length >= 2, '無存在性旋鈕／無平行車陣列（附靜態突變）',
      `掃到本次新程式碼=${scansNewCode}（added ${added.split('\n').filter(Boolean).length} 行）, ` +
      `hits=${JSON.stringify(staticHits)}, mutationHits=${JSON.stringify(mutatedHits)}`);

    await mobileMatrix(chromium, 'Chromium');
    await mobileMatrix(webkit, 'WebKit');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (workerProc && !workerProc.killed) workerProc.kill('SIGTERM');
    if (fixtureProc && !fixtureProc.killed) fixtureProc.kill('SIGTERM');
    await sleep(100);
    if (CLEAN_PERSIST_DIR) fs.rmSync(PERSIST_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    output.failures = failures;
    fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  }
  if (failures) process.exitCode = 1;
}

run().catch(error => {
  failures++;
  output.error = String(error && error.stack || error);
  output.failures = failures;
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.error(output.error);
  process.exitCode = 1;
});
