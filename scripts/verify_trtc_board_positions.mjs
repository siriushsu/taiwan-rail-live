#!/usr/bin/env node
// 北捷逐班位置校正驗收：只連本機 fixture / Wrangler，真實語料逐快照回放。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { buildTrtcModel, resolveBoardRows, claimBoardRows, collapseClaims } from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PORT = Number(process.env.TRTC_POS_FIXTURE_PORT || 43387);
const WORKER_PORT = Number(process.env.TRTC_POS_WORKER_PORT || 43389);
const INSPECTOR_PORT = Number(process.env.TRTC_POS_INSPECTOR_PORT || 43390);
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const BASE = `https://127.0.0.1:${WORKER_PORT}`;
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

function boardPositionPayload(raw) {
  const at = Math.max(...raw.map(row => epoch(row.NowDateTime) || 0));
  const resolved = resolveBoardRows(model, raw, epoch);
  const claimed = claimBoardRows(model, resolved.rows, at, new Map());
  const collapsed = collapseClaims(claimed.claims);
  return {
    at,
    rows: collapsed.map(x => ({ line: x.line, dir: x.dir, from: x.from, to: x.to,
      dest: x.destIdx, run: x.run, arrEpoch: x.arrEpoch, no: x.no || '', terminal: !!x.terminal })),
  };
}

const LEAFLET_DIST = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
const leafletJs = fs.readFileSync(path.join(LEAFLET_DIST, 'leaflet.js'));
const leafletCss = fs.readFileSync(path.join(LEAFLET_DIST, 'leaflet.css'));
async function preparePage(page) {
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
      '--var', 'TRTC_API_USER:fixture-user', '--var', 'TRTC_API_PASS:fixture-pass',
      '--var', `TRTC_API_BASE:${FIXTURE}`, '--var', 'TRTC_BOARD_SAMPLE_DELAY_MS:0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitFor(workerProc, /Ready on https:\/\/localhost/, 30000);

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

    const correctedErrors = [], baselineErrors = [], directions = new Set(), lineTotals = {};
    const invariantFailures = [];
    let mutationWitness = 0;
    for (let i = 1; i <= 17; i++) {
      const slot = `s${String(i).padStart(2, '0')}`;
      const payload = boardPositionPayload(await fixtureRows(slot));
      const result = await page.evaluate(({ rows, at }) => {
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
        const countRows = [], positions = [];
        let mutationHits = 0;
        for (const ln of pool) {
          const roster = ln._tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length;
          const screen = ln._tt.filter(tr => freqTrainPosAt(ln, tr, state.simSec) != null).length;
          countRows.push({ line: ln.id, roster, screen, matched: audit.byLine[ln.id] ? audit.byLine[ln.id].matched : 0 });
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
            correctedM: map.distance(actual, expected), baselineM: map.distance(baseline, expected), shift: a.shift });
        }
        return { audit, countRows, positions, mutationHits, zoom: map.getZoom() };
      }, payload);
      for (const row of result.countRows) {
        if (row.roster !== row.screen) invariantFailures.push({ slot, ...row });
        const rec = lineTotals[row.line] || (lineTotals[row.line] = { roster: 0, matched: 0 });
        rec.roster += row.roster; rec.matched += row.matched;
      }
      for (const p of result.positions) {
        correctedErrors.push(p.correctedM); baselineErrors.push(p.baselineM); directions.add(p.dir);
      }
      mutationWitness += result.mutationHits;
      output.samples.push({ slot, at: payload.at, rows: payload.rows.length, matched: result.audit.matched,
        contested: result.audit.contested, rejectedOrder: result.audit.overtakesRejected,
        roster: result.audit.roster, mutationHits: result.mutationHits, zoom: result.zoom });
    }

    output.metrics = {
      invariantFailures, mutationWitness, corrected: dist(correctedErrors), baseline: dist(baselineErrors),
      directions: [...directions].sort(), lineTotals,
    };
    check(invariantFailures.length === 0 && mutationWitness > 0, '車數恆等式（附真實偏移突變）',
      `17 snapshots，mismatch=${invariantFailures.length}；舊式 shift 決定存在的突變命中=${mutationWitness}`);
    check(correctedErrors.length > 0 && percentile(correctedErrors, .9) < percentile(baselineErrors, .9),
      '逐班校正位置優於純班表', `corrected=${JSON.stringify(dist(correctedErrors))}, baseline=${JSON.stringify(dist(baselineErrors))}`);
    check(directions.has(-1) && directions.has(1), '兩個行車方向皆有實測', `directions=${JSON.stringify([...directions].sort())}`);
    check(Object.values(lineTotals).every(x => x.roster === 0 || x.matched > 0), '各北捷線皆有真實錨點覆蓋', JSON.stringify(lineTotals));
    check(lineTotals.Y && lineTotals.Y.roster > 0 && lineTotals.Y.matched > 0,
      '環狀線 Y 已進入看板校正路徑', JSON.stringify(lineTotals.Y || null));

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
    // 異常偵測雙向：上面 17 槽正常語料跑完必須零告警（也順便把覆蓋率基線建起來），
    // 接著注入「文湖線列車大批從線上消失」必須叫、而且只叫被注入的那條線。
    // 🔴 注入一定要接在正常槽之後：從第一槽就注入的話基線本身就是低的，相對判準測不到「掉下去」。
    const anomNormal = await page.evaluate(() =>
      metroLivePool().filter(ln => isTrtcBoardLine(ln) && anomalyOf(ln)).map(ln => ln.id + ':' + anomalyOf(ln).kind));
    let anomAfter = [];
    for (let i = 15; i <= 17; i++) {
      const p = boardPositionPayload(await fixtureRows(`s${String(i).padStart(2, '0')}`));
      const rows = p.rows.filter((r, k) => r.line !== 'BR' || k % 5 === 0); // 文湖線錨點剩兩成
      anomAfter = await page.evaluate(({ rows, at }) => {
        state.simSec = trtcServiceSec(at); state.clockAtNow = true;
        _mlGate = true; _mlGateAt = Date.now();
        applyTrtcBoard(rows, at);
        return metroLivePool().filter(ln => isTrtcBoardLine(ln) && anomalyOf(ln)).map(ln => ln.id + ':' + anomalyOf(ln).kind);
      }, { rows, at: p.at });
    }
    check(anomNormal.length === 0 && anomAfter.length === 1 && anomAfter[0] === 'BR:gone',
      '異常偵測：正常日零告警、列車大批停駛會叫（且只叫該線）',
      `正常17槽=${JSON.stringify(anomNormal)}, 注入後=${JSON.stringify(anomAfter)}`);

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
    fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    output.failures = failures;
    fs.writeFileSync(path.join(ROOT, 'tmp/verify_trtc_board_positions-output.json'), JSON.stringify(output, null, 2) + '\n');
  }
  if (failures) process.exitCode = 1;
}

run().catch(error => {
  failures++;
  output.error = String(error && error.stack || error);
  output.failures = failures;
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp/verify_trtc_board_positions-output.json'), JSON.stringify(output, null, 2) + '\n');
  console.error(output.error);
  process.exitCode = 1;
});
