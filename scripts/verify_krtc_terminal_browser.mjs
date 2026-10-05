#!/usr/bin/env node
// 真頁面高捷終點生命週期：只替換 API 輸入及時鐘，不替換位置、繪圖或點擊 handler。
// KRTC_TEST_PLAYWRIGHT 可指定雲端完整 Chrome／WebKit launcher；預設使用專案 Playwright。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium, webkit } = await import(process.env.KRTC_TEST_PLAYWRIGHT || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const out = path.join(root, 'output/krtc-terminal');
mkdirSync(out, { recursive: true });
const lineData = JSON.parse(readFileSync(path.join(root, 'data/krtc.json'), 'utf8')).lines;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ rows: [], trains: [], list: [], vehicles: [], src: null, boardPos: null }));
    return;
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  let valid = false;
  try { valid = file.startsWith(root + path.sep) && statSync(file).isFile(); } catch {}
  if (!valid) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// 固定營運時段，並保留今天日期，避開班表日期與凌晨無車造成的不同退路。
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const start = Date.parse(`${date}T09:00:00+08:00`) / 1000;
let now = start, fixture = null, includeArrival = true, nearControl = false, serial = 0;
const results = [];

function makeSnapshot() {
  const trains = [], boards = [];
  for (const lineId of ['KR', 'KO']) {
    const max = lineData.find(line => line.id === lineId).stations.length - 1;
    for (const direction of [1, 2]) {
      const vehicleId = `krtc:${lineId}:control:${direction}`;
      const destinationStationIndex = direction === 2 ? max : 0;
      const progress = nearControl && fixture?.lineId === lineId && direction === fixture.train.direction
        ? fixture.destination - (direction === 2 ? 1 : -1) * 0.05 : 5.5 + direction;
      trains.push({ vehicleId, lineId, direction, destinationStationIndex, publicLabel: 'CONTROL',
        trajectory: [{ epoch: now - 600, progress, stateAfter: 'running' },
          { epoch: now + 600, progress, stateAfter: 'running' }],
        nextCall: null, retireAt: null, quality: { source: 'board' } });
      boards.push({ lineId, stationIndex: 7, rows: [{ rowId: vehicleId, vehicleId,
        direction, destinationStationIndex, arrivalEpoch: now + 60, state: 'running', match: 'inferred' }] });
    }
  }
  if (fixture && includeArrival) trains.push(fixture.train);
  return { schema: 'metro-snapshot/v1', revision: `krtc-terminal-${serial++}`,
    generatedAt: now, sourceAt: now, validUntil: now + 600,
    systems: [{ systemId: 'krtc', lines: ['KR', 'KO'].map(id => ({ id,
      stationCount: lineData.find(line => line.id === id).stations.length })), trains, boards }] };
}

async function setTime(page, value) {
  now = value;
  await page.evaluate(epoch => {
    window.__terminalTestNow = epoch * 1000;
    state.simSec = nowSecOfDay();
    state.clockAtNow = true; state.playing = true; state.speedMult = 1; state._scrubTime = false;
  }, now);
}

async function poll(page, reset = false) {
  const result = await page.evaluate(async reset => {
    // 保留產品的週期輪詢；測試主動刷新要先等既有請求完成，避免撞到正常 in-flight guard。
    const until = performance.now() + 10000;
    while (state.metroCore.polling && performance.now() < until)
      await new Promise(resolve => setTimeout(resolve, 10));
    if (reset) {
      state.metroCore.snapshot = null; state.metroCore.etag = null;
      state.metroCore.blockedLines = {}; state.metroCore.blockedSystems = {};
      state.metroCore.isolatedSystems = {}; state.metroCore.stationMismatch = {};
      state.metroCore.matchRatio = {}; __railMetroCore.resetGates();
    }
    state.metroCore.error = null; state.metroCore.failedSince = 0;
    return { accepted: await __railMetroCore.poll(), status: __railMetroCore.status() };
  }, reset);
  assert.equal(result.accepted, true, 'fixture snapshot 必須由產品 poll 接受 ' + JSON.stringify(result.status));
}

async function selectView(page, groupId) {
  await page.evaluate(groupId => {
    if (state.group !== groupId) selectGroup(GROUPS.find(group => group.id === groupId), false);
  }, groupId);
  await page.waitForFunction(groupId => {
    const lines = groupId === 'all' ? state.decoLines : state.lines;
    return state.group === groupId && lines?.some(line => line.id === 'KR' && line._sys === 'krtc');
  }, groupId);
  await page.evaluate(() => { state.visible.add('KR'); state.visible.add('KO'); });
}

async function drawEvidence(page, { center = false } = {}) {
  return page.evaluate(async ({ lineId, vehicleId, destination, center }) => {
    const lines = state.deco ? state.decoLines : state.lines;
    const line = lines.find(line => line.id === lineId && line._sys === 'krtc');
    if (center) {
      const stop = line.stations[destination];
      M.setView([stop.lat, stop.lon], 15, { animate: false });
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    window.__terminalTestPaint = [];
    draw();
    const direct = metroCoreItemsForLine(line) || [];
    const displayed = metroCoreDisplayItemsForLine(line) || [];
    const target = displayed.find(item => item.vehicleId === vehicleId);
    const hit = (state._freqHits || []).find(hit => hit.core && hit.vehicleId === vehicleId);
    const rect = document.getElementById('overlay').getBoundingClientRect();
    const board = metroCoreBoardView(line.stations[destination], [line], !!state.deco, Date.now() / 1000);
    return { group: state.group, canonicalIds: direct.map(item => item.vehicleId),
      displayIds: displayed.map(item => item.vehicleId),
      target: target ? { terminalDisplay: !!target.terminalDisplay,
        displayOpacity: target.displayOpacity ?? 1, pos: target.pos } : null,
      hit: hit ? { x: rect.left + hit.x, y: rect.top + hit.y } : null,
      debug: { zoom: M.getZoom(), collectMap: state.collectMap, visible: state.visible.has(lineId),
        mode: state.mode, deco: !!state.deco, detailArea, dpr: state.dpr, pixels: [cv.width, cv.height],
        drawSource: drawFreq.toString().includes('metroCoreDisplayItemsForLine'),
        rect: { width: rect.width, height: rect.height }, bbox: line._bbox,
        cp: target ? mapDetailPoint([target.pos.lat, target.pos.lon]) : null,
        hits: (state._freqHits || []).filter(hit => hit.core).map(hit => hit.vehicleId) },
      paint: window.__terminalTestPaint.filter(row => row.vehicleId === vehicleId),
      boardIds: (board?.groups || []).flatMap(group => group.rows || []).map(row => row.vehicleId).filter(Boolean),
      follow: state.freqFollow?.vehicleId || null,
      next: document.getElementById('fcNext')?.textContent || '',
      status: document.getElementById('fcStatus')?.textContent || '',
      label: stationName(line.stations[destination].name, line._sys) };
  }, { lineId: fixture.lineId, vehicleId: fixture.train.vehicleId,
    destination: fixture.destination, center });
}

async function runCase(page, engine, lineId, direction, caseIndex) {
  const max = lineData.find(line => line.id === lineId).stations.length - 1;
  const destination = direction === 2 ? max : 0, step = direction === 2 ? 1 : -1;
  const arrival = start + 600 * caseIndex + 30;
  const vehicleId = `krtc:${lineId}:terminal:${engine}:${direction}`;
  fixture = { lineId, destination, train: { vehicleId, lineId, direction,
    destinationStationIndex: destination, publicLabel: `END-${lineId}-${direction}`,
    trajectory: [{ epoch: arrival - 20, progress: destination - step, stateAfter: 'running' },
      { epoch: arrival, progress: destination, stateAfter: 'terminal' }],
    nextCall: { stationIndex: destination, arrivalEpoch: arrival, basis: 'board' },
    retireAt: arrival, quality: { source: 'board' } } };
  includeArrival = true; nearControl = false;
  await page.evaluate(() => { clearFreqFollow(); if (state.boardStation) closeBoard(); });
  await setTime(page, arrival - 8);
  await selectView(page, 'metro');
  await poll(page, true);
  const before = await drawEvidence(page, { center: true });
  assert(before.target && before.canonicalIds.includes(vehicleId), '進站前必須有 canonical 車');
  assert(Math.abs(before.target.pos.progress - destination) > 0.1, 'fixture 必須實際還在最後一段');

  // API 在跑完進站前就移除目標：畫面仍須完成最後一段，且保留固定的到站 epoch。
  includeArrival = false;
  await setTime(page, arrival - 6); await poll(page);
  const removed = await drawEvidence(page);
  assert(removed.target && !removed.canonicalIds.includes(vehicleId), '移除名冊後保留只存在於顯示層');
  await setTime(page, arrival - 2);
  const approach = await drawEvidence(page);
  assert(approach.target, '最後一段不可因為名冊更新直接消失');
  assert((approach.target.pos.progress - removed.target.pos.progress) * step > 0,
    '保留車必須繼續進站，不能凍在資料消失的位置');

  await setTime(page, arrival);
  const terminal = await drawEvidence(page, { center: true });
  assert.equal(terminal.target?.pos.progress, destination, '終點到站那一刻必須真正畫出來');
  assert.equal(terminal.target?.terminalDisplay, true);
  assert.equal(terminal.target?.displayOpacity, 1);
  assert(terminal.hit && terminal.paint.length, '停留車必須由真正繪圖流程畫出且建立命中 ' + JSON.stringify(terminal));
  assert(!terminal.boardIds.includes(vehicleId), '停留車不得回頭認領看板');
  assert(terminal.paint.every(row => row.alpha > 0.99), '停留的真 Canvas 標籤不透明');

  await setTime(page, arrival + 4); await poll(page);
  await selectView(page, 'all');
  const allView = await drawEvidence(page, { center: true });
  assert(allView.target?.terminalDisplay && allView.hit && allView.paint.length,
    '切到全台同框必須保留同一車輛、命中與實際繪圖');
  await selectView(page, 'metro');
  await setTime(page, arrival + 9); await poll(page);
  const held = await drawEvidence(page, { center: true });
  assert.equal(held.target?.displayOpacity, 1, '到站第 9 秒仍需保持完整顯示');
  // 使用真實地圖點擊，不能直接 setFreqFollow 假造可命中與身分接手。
  await page.mouse.click(held.hit.x, held.hit.y);
  // 終點與列車重疊時產品正常會先提供「跟隨列車／車站看板」選單。
  const pick = page.locator('#tapPick:not([hidden]) button').filter({ hasText: '跟隨' }).first();
  if (await pick.isVisible()) await pick.click();
  try {
    await page.waitForFunction(id => state.freqFollow?.vehicleId === id, vehicleId, { timeout: 5000 });
  } catch (error) {
    const diagnostic = await page.evaluate(point => ({
      element: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 400),
      follow: state.freqFollow, board: state.boardStation, toast: document.getElementById('toast')?.textContent,
      targets: freqTrainsAt({ x: point.x - cv.getBoundingClientRect().left,
        y: point.y - cv.getBoundingClientRect().top }).map(hit => ({ vehicleId: hit.vehicleId, core: hit.core })),
    }), held.hit);
    throw new Error(error.message + '\n' + JSON.stringify(diagnostic));
  }
  const followed = await drawEvidence(page);
  assert.equal(followed.follow, vehicleId, '退場前仍能點到並跟隨同一 ID');
  assert(followed.next.includes(followed.label), '跟隨卡顯示正確終點');
  assert(/抵達|到達|到站/.test(followed.next + followed.status), '跟隨卡必須表明已到終點');

  await setTime(page, arrival + 10.5);
  const fading = await drawEvidence(page);
  assert(fading.target && Math.abs(fading.target.displayOpacity - 0.5) < 0.01,
    '固定到站時間後 10.5 秒必須進入半透明，不受刷新／換頁重設');
  assert(fading.paint.length && fading.paint.every(row => row.alpha > 0.45 && row.alpha < 0.55),
    '半透明必須傳到真 Canvas 標籤，而不只存在於 helper 回傳值');
  assert(!fading.canonicalIds.includes(vehicleId) && !fading.boardIds.includes(vehicleId));
  await page.screenshot({ path: path.join(out, `${engine}-${lineId}-${direction}-fade.png`) });
  const three = lineId === 'KO' && direction === 2 ? await run3DEvidence(page, engine) : null;
  await setTime(page, arrival + 11);
  await page.evaluate(() => updateFreqFollowCamera());
  const ended = await drawEvidence(page);
  assert(!ended.target && !ended.hit && !ended.paint.length, '第 11 秒圖像與命中都須清除');
  assert.equal(ended.follow, null, '顯示退場後正確結束跟隨');
  const result = { engine, lineId, direction, progressBefore: before.target.pos.progress,
    progressAfterRemoval: removed.target.pos.progress, progressApproach: approach.target.pos.progress,
    terminal: terminal.target, allViewHit: !!allView.hit, followed: followed.next,
    fadeAlpha: fading.paint.map(row => row.alpha), three, retired: !ended.target };
  results.push(result); console.log('PASS', JSON.stringify(result));
}

async function run3DEvidence(page, engine) {
  nearControl = true;
  await poll(page);
  await page.waitForFunction(() => window.railIslandIntegration?.capture, null, { timeout: 30000 });
  const frame = await page.evaluate(({ targetId, controlId }) => {
    const vehicles = railIslandIntegration.capture().vehicles;
    const read = id => {
      const vehicle = vehicles.find(value => value.sourceKind === 'core' && value.id.endsWith(':core:' + id));
      return vehicle && { id: vehicle.id, displayOpacity: vehicle.displayOpacity, terminalDisplay: vehicle.terminalDisplay };
    };
    return { target: read(targetId), control: read(controlId) };
  }, { targetId: fixture.train.vehicleId, controlId: `krtc:${fixture.lineId}:control:${fixture.train.direction}` });
  assert.equal(frame.target?.displayOpacity, 0.5, '3D frame 必須攜帶保留車的淡出透明度');
  assert.equal(frame.target?.terminalDisplay, true);
  assert.equal(frame.control?.displayOpacity, 1, '一般列車的 3D frame 維持正常透明度');
  await page.evaluate(async () => {
    const THREE = await import('./rail-3d/vendor/three.module.js');
    const after = THREE.Mesh.prototype.onAfterRender;
    window.__terminalTestMeshes = new Map();
    THREE.Mesh.prototype.onAfterRender = function (...args) {
      const material = args[4] || this.material;
      if (this.geometry?.attributes?.windowLight && this.userData.displayOpacity != null && material?.colorWrite) {
        window.__terminalTestMeshes.set(this.uuid, { opacity: this.userData.displayOpacity,
          uniform: material.uniforms?.trainOpacity?.value,
          transparent: material.transparent, depthWrite: material.depthWrite, layers: this.layers.mask });
      }
      return after.apply(this, args);
    };
    railIslandIntegration.setInspection(false);
    railIslandIntegration.setMode(true);
    setMap3d(true);
    M.raw.jumpTo({ zoom: 17, pitch: 45 });
    railIslandIntegration.render(); M.raw.triggerRepaint();
  });
  try {
    await page.waitForFunction(() => {
      const meshes = [...window.__terminalTestMeshes.values()];
      return meshes.some(mesh => mesh.opacity === 0.5) && meshes.some(mesh => mesh.opacity === 1);
    }, null, { timeout: 30000 });
    const meshes = await page.evaluate(() => [...window.__terminalTestMeshes.values()]);
    const faded = meshes.filter(mesh => mesh.opacity === 0.5);
    const opaque = meshes.filter(mesh => mesh.opacity === 1);
    assert(faded.every(mesh => mesh.uniform === 0.5 && mesh.transparent && !mesh.depthWrite && !(mesh.layers & (1 << 2))),
      '實際 3D mesh shader 必須半透明且不污染後面的深度');
    assert(opaque.every(mesh => mesh.uniform === 1 && !mesh.transparent && mesh.depthWrite && (mesh.layers & (1 << 2))),
      '同一畫格的一般車不得被淡出材質污染');
    await page.screenshot({ path: path.join(out, `${engine}-3d-fade.png`) });
    return { frame, fadedCars: faded.length, opaqueCars: opaque.length };
  } finally {
    await page.evaluate(() => { railIslandIntegration.setMode(false); setMap3d(false); M.raw.jumpTo({ pitch: 0 }); });
    nearControl = false;
  }
}

let browser;
try {
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    now = start; fixture = null;
    browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/v1/metro/snapshot')) return route.fulfill({ status: 200,
        contentType: 'application/json', body: JSON.stringify(makeSnapshot()) });
      return route.request().url().startsWith(base) ? route.continue() : route.abort();
    });
    await context.addInitScript(epoch => {
      localStorage.setItem('trainmap-howto-seen', '1');
      window.__terminalTestNow = epoch * 1000;
      const OriginalDate = Date;
      const FixtureDate = function (...args) {
        if (!(this instanceof FixtureDate)) return new OriginalDate(window.__terminalTestNow).toString();
        return args.length ? new OriginalDate(...args) : new OriginalDate(window.__terminalTestNow);
      };
      FixtureDate.prototype = OriginalDate.prototype;
      FixtureDate.now = () => window.__terminalTestNow;
      FixtureDate.parse = OriginalDate.parse; FixtureDate.UTC = OriginalDate.UTC;
      window.Date = FixtureDate;
    }, now);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/?g=metro&metrocore=1&scene=2d&lang=zh-TW', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.ready &&
      state.systems?.some(system => system.id === 'krtc' && system.data && system._times), null, { timeout: 120000 });
    await page.waitForTimeout(500);
    await selectView(page, 'metro');
    await page.evaluate(() => {
      window.__terminalTestPaint = [];
      const originalDraw = drawMetroCoreVehicle, originalText = ctx.fillText;
      // 只觀察原繪圖實際送出的 alpha；所有原繪圖 API 及命中建立邏輯照常執行。
      drawMetroCoreVehicle = function (line, item, ...args) {
        window.__terminalTestDrawing = item;
        try { return originalDraw.call(this, line, item, ...args); }
        finally { window.__terminalTestDrawing = null; }
      };
      ctx.fillText = function (...args) {
        const item = window.__terminalTestDrawing;
        if (item && String(args[0]) === item.publicLabel) window.__terminalTestPaint.push({
          vehicleId: item.vehicleId, alpha: this.globalAlpha, text: String(args[0]) });
        return originalText.apply(this, args);
      };
    });
    let caseIndex = 0;
    for (const lineId of ['KR', 'KO']) for (const direction of [1, 2])
      await runCase(page, engine, lineId, direction, ++caseIndex);
    assert.deepEqual(errors, [], `${engine} 不得有瀏覽器未處理例外`);
    await context.close(); await browser.close(); browser = null;
  }
  console.log(`PASS 高捷終點真瀏覽器：${results.length} 個雙引擎／紅橘線／雙向案例`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2) + '\n');
}
