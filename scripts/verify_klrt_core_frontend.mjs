#!/usr/bin/env node
// 高雄輕軌 C 線接上 Private Metro Core 的公開端專用驗收。
//
// 分兩層：
//   1. 390px 跑完整資料／生命週期／主圖與全台同框／三種 fallback 行為矩陣。
//   2. Chromium + WebKit 的 360/375/390/414/768 真手機 context，逐一用 page.tap()
//      驗站牌兩向、精確 vehicleId、匿名列不可跟車、命中、overflow 與主要控件碰撞。
//
// 只餵 synthetic canonical snapshot，不 stub renderer、position helper、draw 或點擊 handler。
// 瀏覽器一律 headless；Chromium 指定完整 Chrome，避免 headless shell 的 rAF／GPU 假陰性。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const { chromium, webkit } = await import(process.env.KLRT_TEST_PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const HTML = readFileSync(path.join(ROOT, 'index.html'));
const HTML_TEXT = HTML.toString('utf8');
const KRTC = JSON.parse(readFileSync(path.join(ROOT, 'data/krtc.json'), 'utf8'));
const C_DATA = KRTC.lines.find(line => String(line.id) === 'C');
assert(C_DATA, 'data/krtc.json 必須有 C 線');
assert.equal(C_DATA.loop, true, 'C 線必須保留環線契約');
assert.equal(C_DATA.stations.length, 38, '公開端 C 線真實站數必須是 38');

// 先用靜態契約讓「根本沒接 klrt/C」在啟動瀏覽器前就具名失敗；真正語意仍由下方真頁面驗。
assert.match(HTML_TEXT, /klrt\s*:\s*\['C'\]/, 'METRO_CORE_LINE_IDS 必須宣告 klrt:C');
assert.match(HTML_TEXT, /function metroCoreKlrtLoop\(/, '必須集中辨識 KLRT 環線');
assert.match(HTML_TEXT, /function metroCoreFlatMax\(/, '必須保留 Core 的 flat progress 上界 38');
assert.match(HTML_TEXT, /function metroCoreStationAt\(/, '必須集中做 flat 38 → 真實站 0 映射');
assert.match(HTML_TEXT, /function metroCoreBoardFlatIndex\(/, '站牌必須能把逆行起點 0 還原成 flat 38');

function extractFunction(name) {
  const start = HTML_TEXT.indexOf(`function ${name}(`);
  assert(start >= 0, `找不到 ${name}`);
  const open = HTML_TEXT.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < HTML_TEXT.length; index++) {
    if (HTML_TEXT[index] === '{') depth++;
    else if (HTML_TEXT[index] === '}' && --depth === 0) return HTML_TEXT.slice(start, index + 1);
  }
  throw new Error(`${name} 大括號未閉合`);
}

// 可選的 124-tick 真實 shadow replay。拒發 tick 沒有 result.snapshot，公開端在現實中會沿用
// 上一份已發布 canonical snapshot；replay 也採相同規則，因此會逐一驗完所有 tick，而不是只驗
// 117 個有新發布物的 tick。這一段只讀 JSONL，不啟動瀏覽器、不寫回任何私有產物。
function runShadowReplay(file) {
  if (!file) return;
  const records = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`shadow JSONL 第 ${index + 1} 行解析失敗：${error.message}`); }
  });
  assert(records.length > 0, 'shadow replay 不可為空');
  const adapter = vm.createContext({
    TRTC_BOARD_LINES: new Set(),
    freqSysIdOf: line => line && line._sys,
    posBetweenStations: (line, from, to, fraction) => {
      const a = line.stations[from], b = line.stations[to];
      if (!a || !b) return null;
      return { lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * fraction,
        lon: Number(a.lon) + (Number(b.lon) - Number(a.lon)) * fraction };
    },
  });
  vm.runInContext(['metroCoreSystemIdForLine', 'metroCoreSampleTrajectory', 'metroCoreSampleTrain',
    'metroCoreKlrtLoop', 'metroCoreFlatMax', 'metroCoreStationAt', 'metroCorePositionAt']
    .map(extractFunction).join('\n'), adapter);
  const line = { ...C_DATA, _sys: 'krtc' };
  let lastSnapshot = null, published = 0, retained = 0, trains = 0, trajectories = 0;
  let boardRows = 0, raw38 = 0, nullIds = 0, sampled = 0;
  for (let tick = 0; tick < records.length; tick++) {
    const fresh = records[tick]?.result?.snapshot || null;
    if (fresh) { lastSnapshot = fresh; published++; } else retained++;
    assert(lastSnapshot, `shadow tick ${tick + 1} 在第一份 canonical snapshot 前就拒發，無法 replay`);
    const snapshot = lastSnapshot;
    assert.equal(snapshot.schema, 'metro-snapshot/v1', `tick ${tick + 1} schema`);
    assert(String(snapshot.revision || '').trim(), `tick ${tick + 1} revision`);
    assert(Number(snapshot.generatedAt) > 0 && Number(snapshot.validUntil) >= Number(snapshot.generatedAt),
      `tick ${tick + 1} generatedAt/validUntil`);
    assert(Array.isArray(snapshot.systems), `tick ${tick + 1} systems`);
    const system = snapshot.systems.find(item => item?.systemId === 'klrt');
    assert(system, `tick ${tick + 1} 必須含 klrt system`);
    assert.deepEqual(system.lines, [{ id: 'C', stationCount: 38 }], `tick ${tick + 1} klrt line/station-count`);
    assert(Array.isArray(system.trains) && Array.isArray(system.boards), `tick ${tick + 1} trains/boards`);
    const byId = new Map();
    for (const train of system.trains) {
      trains++;
      const id = String(train?.vehicleId || '');
      assert(id && !byId.has(id), `tick ${tick + 1} vehicleId 必須非空且唯一：${id}`);
      byId.set(id, train);
      assert.equal(train.lineId, 'C', `tick ${tick + 1}/${id} lineId`);
      assert(train.direction === 1 || train.direction === 2, `tick ${tick + 1}/${id} direction`);
      assert.equal(Number(train.destinationStationIndex), train.direction === 2 ? 38 : 0,
        `tick ${tick + 1}/${id} raw destination`);
      assert(Array.isArray(train.trajectory) && train.trajectory.length > 0, `tick ${tick + 1}/${id} trajectory`);
      const step = train.direction === 2 ? 1 : -1;
      let prior = null;
      for (const point of train.trajectory) {
        trajectories++;
        const epoch = Number(point?.epoch), progress = Number(point?.progress);
        assert(Number.isFinite(epoch) && Number.isFinite(progress) && progress >= -1e-9 && progress <= 38 + 1e-9,
          `tick ${tick + 1}/${id} trajectory 必須在 0..38`);
        if (prior) {
          assert(epoch > prior.epoch, `tick ${tick + 1}/${id} epoch 必須嚴格遞增`);
          assert((progress - prior.progress) * step >= -1e-9,
            `tick ${tick + 1}/${id} direction ${train.direction} progress 不可反向`);
        }
        // 執行公開端真正的 metroCorePositionAt；posBetweenStations 只替換為確定性的線性幾何，
        // 受測的 flat38、37↔38、clamp 與取樣流程仍逐字來自 index.html。
        if (train.retireAt == null || epoch < Number(train.retireAt)) {
          const pos = adapter.metroCorePositionAt(line, train, epoch);
          assert(pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon) &&
            Math.abs(Number(pos.progress) - progress) < 1e-7,
          `tick ${tick + 1}/${id}@${epoch} 公開端 position adapter 必須可取樣且保留 raw progress`);
          sampled++;
        }
        prior = { epoch, progress };
      }
    }
    for (const board of system.boards) {
      assert.equal(board.lineId, 'C', `tick ${tick + 1} board lineId`);
      assert(Number.isInteger(Number(board.stationIndex)) && Number(board.stationIndex) >= 0 && Number(board.stationIndex) < 38,
        `tick ${tick + 1} board stationIndex`);
      assert(Array.isArray(board.rows), `tick ${tick + 1} board rows`);
      for (const row of board.rows) {
        boardRows++;
        assert(Number.isFinite(Number(row.arrivalEpoch)), `tick ${tick + 1} board arrivalEpoch`);
        assert(row.direction === 1 || row.direction === 2, `tick ${tick + 1} board direction`);
        const destination = Number(row.destinationStationIndex);
        assert.equal(destination, row.direction === 2 ? 38 : 0, `tick ${tick + 1} board raw destination`);
        if (destination === 38) raw38++;
        if (row.vehicleId == null) { nullIds++; continue; }
        const train = byId.get(String(row.vehicleId));
        assert(train, `tick ${tick + 1} board vehicleId 必須存在於同一 klrt system`);
        assert.equal(train.lineId, board.lineId, `tick ${tick + 1} board/train line 相容`);
        assert.equal(Number(train.direction), Number(row.direction), `tick ${tick + 1} board/train direction 相容`);
        assert.equal(Number(train.destinationStationIndex), destination, `tick ${tick + 1} board/train destination 相容`);
      }
    }
  }
  assert(raw38 > 0, 'shadow replay 必須真的含 raw destination 38 正向對照');
  assert(nullIds > 0, 'shadow replay 必須真的含 null vehicleId row 正向對照');
  assert(sampled > 0 && trains > 0 && boardRows > 0, 'shadow replay 語料不可空轉');
  console.log(`G1 shadow replay PASS ${records.length} ticks（${published} 新發布＋${retained} 沿用），` +
    `${trains} train-instances／${trajectories} trajectory points／${boardRows} board rows；raw38=${raw38} nullId=${nullIds}`);
}

runShadowReplay(process.env.KLRT_SHADOW_TICKS);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
let servedIndex = HTML;
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (pathname.startsWith('/api/')) {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ rows: [], trains: [], list: [], vehicles: [], src: null, boardPos: null }));
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    response.end(servedIndex); return;
  }
  let file = path.resolve(ROOT, '.' + pathname);
  if (file === ROOT || statSafe(file)?.isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file) || !statSafe(file)?.isFile()) {
    response.writeHead(404); response.end('not found'); return;
  }
  response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  response.end(readFileSync(file));
});
function statSafe(file) { try { return statSync(file); } catch { return null; } }
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const BASE = `http://127.0.0.1:${server.address().port}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const served = Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer());
assert.equal(sha(served), sha(HTML), 'local server 提供的必須是這棵 worktree 的 index.html');
console.log(`G0 HTML SHA256 ${sha(HTML)}；C 線 ${C_DATA.stations.length} 站`);

// 把整支測試固定在高雄輕軌有表定班次的 08:57（台北時間）；時間仍會正常往前走。
function taipeiSecondOfDay() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
  const get = type => Number(parts.find(part => part.type === type)?.value || 0);
  return (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
}
const CLOCK_SHIFT_SEC = 8 * 3600 + 57 * 60 - taipeiSecondOfDay();
const shiftedNow = () => Math.floor(Date.now() / 1000) + CLOCK_SHIFT_SEC;

const CW_ID = 'klrt:C:core-cw-stable';
const CCW_ID = 'klrt:C:core-ccw-stable';
const PHYSICAL_ID = 'klrt:C:core-physical-36-5';
const ARRIVAL_ID = 'klrt:C:core-arrival-stable';
let snapshotVariant = 'pending';
let revisionSerial = 0;

function trainRows(now, variant) {
  if (variant === 'closure') return [
    { vehicleId: CW_ID, lineId: 'C', direction: 2, destinationStationIndex: 38, publicLabel: '',
      trajectory: [{ epoch: now - 600, progress: 37, stateAfter: 'running' },
        { epoch: now + 600, progress: 38, stateAfter: 'running' }], nextCall: null, retireAt: null,
      quality: { source: 'gps' } },
    { vehicleId: CCW_ID, lineId: 'C', direction: 1, destinationStationIndex: 0, publicLabel: '',
      trajectory: [{ epoch: now - 600, progress: 38, stateAfter: 'running' },
        { epoch: now + 600, progress: 37, stateAfter: 'running' }], nextCall: null, retireAt: null,
      quality: { source: 'gps' } },
    { vehicleId: PHYSICAL_ID, lineId: 'C', direction: 2, destinationStationIndex: 38, publicLabel: '',
      trajectory: [{ epoch: now - 600, progress: 36, stateAfter: 'running' },
        { epoch: now + 600, progress: 37, stateAfter: 'running' }], nextCall: null, retireAt: null,
      quality: { source: 'gps' } },
  ];
  const moving = variant === 'moving' || variant === 'retired' || variant === 'originDeparted';
  const retired = variant === 'retired';
  const cwTrajectory = moving
    ? [{ epoch: now - 60, progress: 0, stateAfter: 'departed' },
      { epoch: now + 60, progress: 2, stateAfter: 'running' }]
    : [{ epoch: now - 60, progress: 0, stateAfter: 'predeparture' },
      { epoch: now + 60, progress: 0, stateAfter: 'predeparture' }];
  const ccwTrajectory = moving
    ? [{ epoch: now - 60, progress: 38, stateAfter: 'departed' },
      { epoch: now + 60, progress: 36, stateAfter: 'running' }]
    : [{ epoch: now - 60, progress: 38, stateAfter: 'predeparture' },
      { epoch: now + 60, progress: 38, stateAfter: 'predeparture' }];
  const trains = [
    { vehicleId: CW_ID, lineId: 'C', direction: 2, destinationStationIndex: 38, publicLabel: '',
      trajectory: cwTrajectory, nextCall: null, retireAt: retired ? now - 1 : null,
      quality: { source: moving ? 'gps' : 'board' } },
    { vehicleId: CCW_ID, lineId: 'C', direction: 1, destinationStationIndex: 0, publicLabel: '',
      trajectory: ccwTrajectory, nextCall: null, retireAt: retired ? now - 1 : null,
      quality: { source: moving ? 'gps' : 'hold' } },
  ];
  if (variant === 'originBoard' || variant === 'originDeparted') trains.push({
    vehicleId: ARRIVAL_ID, lineId: 'C', direction: 2, destinationStationIndex: 38, publicLabel: '',
    trajectory: [{ epoch: now - 60, progress: 38, stateAfter: 'terminal' },
      { epoch: now + 60, progress: 38, stateAfter: 'terminal' }], nextCall: null, retireAt: null,
    quality: { source: 'board' },
  });
  if (variant === 'countHealthy') for (let index = 0; index < 4; index++) trains.push({
    vehicleId: `klrt:C:core-count-${index}`, lineId: 'C', direction: 2, destinationStationIndex: 38,
    publicLabel: '', trajectory: [{ epoch: now - 60, progress: index + 1, stateAfter: 'running' },
      { epoch: now + 60, progress: index + 1, stateAfter: 'running' }], nextCall: null, retireAt: null,
    quality: { source: 'gps' },
  });
  return trains;
}

function boardRows(now, variant) {
  const rows = [
    { rowId: 'cw-linked', arrivalEpoch: now + 180, direction: 2, destinationStationIndex: 38,
      state: 'countdown', vehicleId: CW_ID, match: 'exact' },
    { rowId: 'ccw-linked', arrivalEpoch: now + 240, direction: 1, destinationStationIndex: 0,
      state: 'countdown', vehicleId: CCW_ID, match: 'exact' },
    { rowId: 'cw-unlinked', arrivalEpoch: now + 300, direction: 2, destinationStationIndex: 38,
      state: 'countdown', vehicleId: null, match: 'unmatched' },
  ];
  if (variant === 'blocked') {
    rows[1].vehicleId = null; rows[1].match = 'unmatched';
    rows.push({ rowId: 'ccw-unlinked-2', arrivalEpoch: now + 360, direction: 1,
      destinationStationIndex: 0, state: 'countdown', vehicleId: null, match: 'unmatched' });
  }
  return rows;
}

function originBoardRows(now) {
  return [
    { rowId: 'origin-cw', arrivalEpoch: now - 1, direction: 2, destinationStationIndex: 38,
      state: 'countdown', vehicleId: CW_ID, match: 'exact' },
    { rowId: 'origin-ccw', arrivalEpoch: now - 1, direction: 1, destinationStationIndex: 0,
      state: 'countdown', vehicleId: CCW_ID, match: 'exact' },
    { rowId: 'terminal-arrival', arrivalEpoch: now - 1, direction: 2, destinationStationIndex: 38,
      state: 'dwelling', vehicleId: ARRIVAL_ID, match: 'exact' },
  ];
}

function healthySystem(systemId, lineId, stationCount, now, variant) {
  const vehicleId = `${systemId}:${lineId}:${variant}:${now}`;
  return {
    systemId, lines: [{ id: lineId, stationCount }],
    trains: [{ vehicleId, lineId, direction: 2, destinationStationIndex: stationCount - 1,
      publicLabel: `TEST-${lineId}`, trajectory: [
        { epoch: now - 60, progress: 0, stateAfter: 'dwelling' },
        { epoch: now + 60, progress: 0, stateAfter: 'dwelling' },
      ], nextCall: null, retireAt: null, quality: { source: 'board' } }],
    boards: [{ lineId, stationIndex: 0, rows: [{ rowId: `${lineId}-linked`, arrivalEpoch: now + 60,
      direction: 2, destinationStationIndex: stationCount - 1, state: 'dwelling',
      vehicleId, match: 'exact' }] }],
  };
}

function makeSnapshot(variant = snapshotVariant) {
  const now = shiftedNow();
  const systems = [healthySystem('trtc', 'BL', 23, now, variant), healthySystem('krtc', 'KR', 25, now, variant)];
  if (variant !== 'absent') systems.push({
    systemId: 'klrt', lines: [{ id: 'C', stationCount: 38 }],
    trains: trainRows(now, variant),
    boards: [
      { lineId: 'C', stationIndex: 5, rows: boardRows(now, variant) },
      ...(variant === 'originBoard' || variant === 'originDeparted'
        ? [{ lineId: 'C', stationIndex: 0, rows: originBoardRows(now) }] : []),
    ],
  });
  if (variant === 'badLine') {
    const system = systems.find(item => item.systemId === 'klrt');
    system.lines[0].id = 'C_BAD';
    for (const train of system.trains) train.lineId = 'C_BAD';
    for (const board of system.boards) board.lineId = 'C_BAD';
  }
  if (variant === 'broken') {
    const system = systems.find(item => item.systemId === 'klrt');
    system.trains[0].trajectory = [];
    // 指到壞車的列也一併匿名化；隔離掉 KLRT 後，健康 trtc/krtc 應仍可更新。
    for (const board of system.boards) for (const row of board.rows) {
      if (row.vehicleId === CW_ID) { row.vehicleId = null; row.match = 'unmatched'; }
    }
  }
  if (variant === 'reference') {
    const system = systems.find(item => item.systemId === 'klrt');
    system.boards[0].rows[0].vehicleId = 'klrt:C:does-not-exist';
  }
  if (variant === 'duplicate') {
    const system = systems.find(item => item.systemId === 'klrt');
    systems.push(structuredClone(system));
  }
  if (variant === 'unknown') systems.push(healthySystem('future-metro', 'F', 2, now, variant));
  if (variant === 'noLines') {
    const system = systems.find(item => item.systemId === 'klrt');
    delete system.lines;
  }
  const generatedAt = variant === 'rollback' ? now - 3600 : now - 1;
  return {
    schema: 'metro-snapshot/v1', revision: `klrt-fe-${variant}-${now}-${revisionSerial++}`,
    generatedAt, sourceAt: generatedAt, validUntil: now + 600, systems,
  };
}

async function installRoutes(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/v1/metro/snapshot')) {
      if (snapshotVariant === 'missing') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'cache-control': 'no-store' }, body: JSON.stringify(makeSnapshot()) });
    }
    if (route.request().url().startsWith(BASE)) return route.continue();
    return route.abort(); // 圖磚／遙測等外部資源不是本驗收輸入，避免網路造成不確定性。
  });
}

async function bootPage(context) {
  await installRoutes(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error?.message || error)));
  await page.addInitScript(shiftMs => {
    localStorage.setItem('trainmap-howto-seen', '1');
    const RealDate = Date;
    const FakeDate = function (...args) {
      if (!(this instanceof FakeDate)) return new RealDate(RealDate.now() + shiftMs).toString();
      return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + shiftMs);
    };
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => RealDate.now() + shiftMs;
    FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
    window.Date = FakeDate;
  }, CLOCK_SHIFT_SEC * 1000);
  await page.goto(`${BASE}/index.html?g=metro&metrocore=1&lang=zh-TW`, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  try {
    await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.systems &&
      state.systems.some(system => system.id === 'tmrt' && system.data && system._times), null, { timeout: 120000 });
    await page.waitForTimeout(500); // 讓 boot 的群組還原完成，避免蓋掉下一行 selectGroup。
    await page.evaluate(() => {
      const group = GROUPS.find(item => item.id === 'metro');
      if (state.group !== 'metro') selectGroup(group, false);
    });
    await page.waitForFunction(() => state.lines?.some(line => line.id === 'C' && line._sys === 'krtc' && line._tt?.length),
      null, { timeout: 60000 });
  } catch (error) {
    console.error('boot 逾時；pageerror=' + JSON.stringify(errors.slice(0, 5)));
    throw error;
  }
  await page.evaluate(() => {
    state.clockAtNow = true; state.playing = true; state.speedMult = 1; state._scrubTime = false;
    state.simSec = nowSecOfDay();
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    if (line) { line._gpsShifts = null; line._liveShift = null; state.visible.add('C'); }
  });
  await pollVariant(page, 'pending');
  return { page, errors };
}

async function pollVariant(page, variant, { preserve = false } = {}) {
  snapshotVariant = variant;
  await page.evaluate(preserveSnapshot => {
    if (!preserveSnapshot) { state.metroCore.snapshot = null; state.metroCore.etag = null; }
    state.metroCore.error = null; state.metroCore.failedSince = 0;
    if (!preserveSnapshot) {
      state.metroCore.blockedLines = {}; state.metroCore.blockedSystems = {};
      state.metroCore.isolatedSystems = {};
      state.metroCore.stationMismatch = {}; state.metroCore.matchRatio = {};
      __railMetroCore.resetGates();
    }
    state.clockAtNow = true; state.playing = true; state.speedMult = 1; state._scrubTime = false;
    state.simSec = nowSecOfDay();
  }, preserve);
  const accepted = await page.evaluate(() => __railMetroCore.poll());
  return { accepted, status: await page.evaluate(() => __railMetroCore.status()) };
}

// Playwright WebKit 的 route.fulfill 拒絕 304（把它誤歸類成 redirect status）；用頁面原生
// Response 精確餵一次條件式請求，仍完整執行產品的 pollMetroCore 304 分支。
async function pollNotModified(page) {
  snapshotVariant = 'notModified';
  return page.evaluate(async () => {
    state.metroCore.error = null; state.metroCore.failedSince = 0;
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (url === __railMetroCore.endpoint) return Promise.resolve(new Response(null, {
        status: 304, headers: { etag: state.metroCore.etag || '' },
      }));
      return nativeFetch(input, init);
    };
    try {
      const accepted = await __railMetroCore.poll();
      return { accepted, status: __railMetroCore.status() };
    } finally { window.fetch = nativeFetch; }
  });
}

async function selectView(page, id) {
  await page.evaluate(groupId => {
    const group = GROUPS.find(item => item.id === groupId);
    if (state.group !== groupId) selectGroup(group, false);
  }, id);
  if (id === 'metro') {
    await page.waitForFunction(() => state.mode === 'freq' && state.lines?.some(line => line.id === 'C' && line._sys === 'krtc'));
    await page.evaluate(() => state.visible.add('C'));
  } else {
    await page.waitForFunction(() => state.mode === 'sched' && state.decoLines?.some(line => line.id === 'C' && line._sys === 'krtc'));
  }
  await pollVariant(page, 'pending');
}

async function openCBoard(page, deco = false, stationIndex = 5) {
  await page.evaluate(({ deco, stationIndex }) => {
    const pool = deco ? state.decoLines : state.lines;
    const line = pool.find(item => item.id === 'C' && item._sys === 'krtc');
    const station = line.stations[stationIndex];
    openBoard({ ...station, sys: deco ? 'deco' : 'freq', metroSysId: 'krtc' });
  }, { deco, stationIndex });
  await page.locator('#board .row').first().waitFor({ state: 'attached' });
}

async function closeBoardIfOpen(page) {
  await page.evaluate(() => { if (state.boardStation) closeBoard(); });
}

async function runContractAndLifecycle(page, engine) {
  const contract = await page.evaluate(({ cwId, ccwId }) => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    const mk = (id, direction, from, to) => ({ vehicleId: id, lineId: 'C', direction,
      destinationStationIndex: direction === 2 ? 38 : 0, retireAt: null,
      trajectory: [{ epoch: 100, progress: from }, { epoch: 200, progress: to }] });
    const at38 = metroCorePositionAt(line, mk(cwId, 2, 38, 38), 150);
    const forward = metroCorePositionAt(line, mk(cwId, 2, 37, 38), 150);
    const reverse = metroCorePositionAt(line, mk(ccwId, 1, 38, 37), 150);
    const expected = posBetweenStations(line, 37, 0, .5);
    const view = metroCoreBoardView(line.stations[5], [line], false, Date.now() / 1000);
    const rows = view ? view.groups.flatMap(group => group.rows) : [];
    return {
      systemId: metroCoreSystemIdForLine(line), lineIds: __railMetroCore.lineIds.klrt,
      flatMax: metroCoreFlatMax(line), station38Is0: metroCoreStationAt(line, 38) === line.stations[0],
      reverseOriginFlat: metroCoreBoardFlatIndex(line, 0, 1), forwardOriginFlat: metroCoreBoardFlatIndex(line, 0, 2),
      at38: { progress: at38?.progress, lat: at38?.lat, lon: at38?.lon,
        station0Lat: line.stations[0].lat, station0Lon: line.stations[0].lon },
      forward: forward && { progress: forward.progress, lat: forward.lat, lon: forward.lon,
        expectedLat: expected?.lat, expectedLon: expected?.lon, motionFrom: forward.motionFrom, motionTo: forward.motionTo },
      reverse: reverse && { progress: reverse.progress, lat: reverse.lat, lon: reverse.lon,
        expectedLat: expected?.lat, expectedLon: expected?.lon, motionFrom: reverse.motionFrom, motionTo: reverse.motionTo },
      raw38: rows.some(row => row.kind === 'core' && row.destinationStationIndex === 38 && row.destName === line.stations[0].name),
      nullRow: rows.some(row => row.kind === 'core' && row.row?.rowId === 'cw-unlinked' && row.vehicleId == null),
    };
  }, { cwId: CW_ID, ccwId: CCW_ID });
  assert.equal(contract.systemId, 'klrt', `${engine} C 線必須映射 klrt`);
  assert.deepEqual(contract.lineIds, ['C'], `${engine} lineId 契約`);
  assert.equal(contract.flatMax, 38, `${engine} progress 上界`);
  assert.equal(contract.station38Is0, true, `${engine} p=38 必須指到真實站0`);
  assert.equal(contract.reverseOriginFlat, 38, `${engine} 逆行站0待發必須用 flat38`);
  assert.equal(contract.forwardOriginFlat, 0, `${engine} 順行站0待發必須用 flat0`);
  assert.equal(contract.at38.progress, 38, `${engine} p=38 不得改寫 raw progress`);
  assert(Math.abs(contract.at38.lat - contract.at38.station0Lat) < 1e-10 &&
    Math.abs(contract.at38.lon - contract.at38.station0Lon) < 1e-10, `${engine} p=38 座標錯誤`);
  for (const [direction, sample] of [['37→38', contract.forward], ['38→37', contract.reverse]]) {
    assert(sample && Math.abs(sample.progress - 37.5) < 1e-9, `${engine} ${direction} progress 補間`);
    assert(Math.abs(sample.lat - sample.expectedLat) < 1e-9 && Math.abs(sample.lon - sample.expectedLon) < 1e-9,
      `${engine} ${direction} 必須沿實際 37↔0 尾段補間`);
    assert.deepEqual([sample.motionFrom, sample.motionTo], [direction === '37→38' ? 37 : 37, 38],
      `${engine} ${direction} 必須保留 flat motion 37↔38`);
  }
  assert.equal(contract.raw38, true, `${engine} 看板 rec 必須保留 raw destination 38`);
  assert.equal(contract.nullRow, true, `${engine} null vehicle row 必須保留官方倒數`);

  const pending = await page.evaluate(() => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    return metroCoreItemsForLine(line).map(item => ({ id: item.vehicleId, p: item.pos.progress,
      lat: item.pos.lat, lon: item.pos.lon }));
  });
  assert.deepEqual(pending.map(item => item.id).sort(), [CCW_ID, CW_ID].sort(), `${engine} 待發雙向原 ID`);
  assert.deepEqual(pending.map(item => item.p).sort((a, b) => a - b), [0, 38], `${engine} 待發必須靜止在 flat 兩端`);
  assert(Math.abs(pending[0].lat - pending[1].lat) < 1e-10 && Math.abs(pending[0].lon - pending[1].lon) < 1e-10,
    `${engine} p0/p38 必須是同一實體站`);

  let result = await pollVariant(page, 'moving');
  assert.equal(result.accepted, true, `${engine} moving snapshot 應被接受`);
  const moving = await page.evaluate(() => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    return metroCoreItemsForLine(line).map(item => ({ id: item.vehicleId, p: item.pos.progress }));
  });
  assert.deepEqual(moving.map(item => item.id).sort(), [CCW_ID, CW_ID].sort(), `${engine} 發車後必須沿用同一 ID`);
  assert(moving.find(item => item.id === CW_ID).p > 0 && moving.find(item => item.id === CW_ID).p < 2,
    `${engine} 順行發車後 progress 應遞增`);
  assert(moving.find(item => item.id === CCW_ID).p < 38 && moving.find(item => item.id === CCW_ID).p > 36,
    `${engine} 逆行發車後 progress 應遞減`);

  result = await pollVariant(page, 'retired');
  assert.equal(result.accepted, true, `${engine} retire snapshot 應被接受`);
  const retired = await page.evaluate(({ cwId, ccwId }) => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    const system = metroCoreSystem('klrt');
    return {
      ids: system.trains.map(train => train.vehicleId),
      samples: system.trains.map(train => metroCoreSampleTrain(train, Date.now() / 1000)),
      items: metroCoreItemsForLine(line), legacy: metroCoreLegacyCountForLine(line),
      followCw: metroCoreFollowRecord({ core: true, systemId: 'klrt', lineId: 'C', vehicleId: cwId }),
      followCcw: metroCoreFollowRecord({ core: true, systemId: 'klrt', lineId: 'C', vehicleId: ccwId }),
    };
  }, { cwId: CW_ID, ccwId: CCW_ID });
  assert.deepEqual(retired.ids.sort(), [CCW_ID, CW_ID].sort(), `${engine} retire 證據仍指同一 canonical ID`);
  assert(retired.samples.every(value => value === null), `${engine} retireAt 後不得再取樣`);
  assert.equal(retired.items, null, `${engine} 全退場後 Core 應讓路，不得以 [] 短路`);
  assert(retired.legacy > 0, `${engine} retire 時段必須有 legacy 正向對照`);
  assert.equal(retired.followCw, null); assert.equal(retired.followCcw, null);
  await pollVariant(page, 'pending');
  console.log(`PASS ${engine} helper／0..38／雙方向／待發→同 ID 發車→retire`);
}

async function runOriginBoardBoundary(page, engine) {
  let polled = await pollVariant(page, 'originBoard');
  assert.equal(polled.accepted, true, `${engine} 籬仔內待發 fixture 應被接受`);
  const negative = await page.evaluate(({ cwId }) => {
    const now = Date.now() / 1000;
    const cLine = state.lines.find(line => line.id === 'C' && line._sys === 'krtc');
    const trtcLine = state.lines.find(line => line.id === 'BL' && metroCoreSystemIdForLine(line) === 'trtc');
    const trtcTrain = metroCoreSystem('trtc').trains[0];
    const nonLoopOrigin = metroCoreCountdownText({ ln: trtcLine, systemId: 'trtc', stationIndex: 0,
      arrivalEpoch: now - 1, state: 'countdown', vehicleId: trtcTrain.vehicleId }, now);
    const klrt = metroCoreSystem('klrt'), midId = 'klrt:C:test-mid-arrival';
    klrt.trains.push({ vehicleId: midId, lineId: 'C', direction: 2, destinationStationIndex: 38,
      trajectory: [{ epoch: now - 60, progress: 5, stateAfter: 'dwelling' },
        { epoch: now + 60, progress: 5, stateAfter: 'dwelling' }], quality: { source: 'board' } });
    let midLoop;
    try {
      midLoop = metroCoreCountdownText({ ln: cLine, systemId: 'klrt', stationIndex: 5,
        arrivalEpoch: now - 1, state: 'countdown', vehicleId: midId }, now);
    } finally { klrt.trains.pop(); }
    const futureOrigin = metroCoreCountdownText({ ln: cLine, systemId: 'klrt', stationIndex: 0,
      arrivalEpoch: now + 30, state: 'countdown', vehicleId: cwId }, now);
    return { nonLoopOrigin, midLoop, futureOrigin };
  }, { cwId: CW_ID });
  assert.deepEqual(negative, { nonLoopOrigin: '列車進站', midLoop: '列車進站', futureOrigin: '0:30' },
    `${engine} 待發文案只准作用於 KLRT 站0且倒數歸零：${JSON.stringify(negative)}`);
  await openCBoard(page, false, 0);
  const before = await page.evaluate(() => {
    const board = document.getElementById('board');
    const rows = [...board.querySelectorAll('.row[data-core-record]')].map(node => {
      const rec = board._metroCoreRecords[Number(node.dataset.coreRecord)];
      return { id: rec.vehicleId, state: rec.state, text: node.querySelector('.min')?.textContent.trim() || '' };
    });
    const system = metroCoreSystem('klrt');
    return { rows, progress: Object.fromEntries(system.trains.map(train => [train.vehicleId,
      metroCoreSampleTrain(train, Date.now() / 1000)?.progress])) };
  });
  assert.equal(before.progress[CW_ID], 0, `${engine} 順行待發 DOM fixture 必須真在 p0`);
  assert.equal(before.progress[CCW_ID], 38, `${engine} 逆行待發 DOM fixture 必須真在 p38`);
  assert.equal(before.progress[ARRIVAL_ID], 38, `${engine} 終點到站正向對照必須真在 p38`);
  for (const id of [CW_ID, CCW_ID]) {
    const row = before.rows.find(item => item.id === id);
    assert.deepEqual(row && { state: row.state, text: row.text }, { state: 'countdown', text: '即將發車' },
      `${engine}/${id} 籬仔內 0 分待發不得誤寫列車進站：${JSON.stringify(before.rows)}`);
  }
  assert.deepEqual(before.rows.find(item => item.id === ARRIVAL_ID),
    { id: ARRIVAL_ID, state: 'dwelling', text: '列車進站' },
    `${engine} p38 終點到站仍須顯示列車進站，不得被待發特判吃掉`);

  for (const vehicleId of [CW_ID, CCW_ID]) {
    const row = page.locator(`#board .row[data-core-vehicle="${vehicleId}"]`).first();
    await row.scrollIntoViewIfNeeded(); await row.tap();
    assert.equal(await page.evaluate(() => state.freqFollow?.vehicleId), vehicleId,
      `${engine}/${vehicleId} 籬仔內兩向待發列都須以真觸控跟到原 ID`);
    await openCBoard(page, false, 0);
  }

  polled = await pollVariant(page, 'originDeparted');
  assert.equal(polled.accepted, true, `${engine} 籬仔內發車 fixture 應被接受`);
  await openCBoard(page, false, 0);
  const after = await page.evaluate(() => {
    const board = document.getElementById('board');
    return [...board.querySelectorAll('.row[data-core-record]')].map(node => {
      const rec = board._metroCoreRecords[Number(node.dataset.coreRecord)];
      return { id: rec.vehicleId, state: rec.state, text: node.querySelector('.min')?.textContent.trim() || '' };
    });
  });
  assert.deepEqual(after, [{ id: ARRIVAL_ID, state: 'dwelling', text: '列車進站' }],
    `${engine} 發車後 p0／p38 待發列須移除，終點到站列不得被誤刪：${JSON.stringify(after)}`);
  await closeBoardIfOpen(page);
  await page.evaluate(() => clearFreqFollow());
  await pollVariant(page, 'pending');
  console.log(`PASS ${engine} 籬仔內 p0／p38 待發文案、真觸控、離站移除與終點到站保留`);
}

async function mapLayerEvidence(page, deco) {
  await selectView(page, deco ? 'all' : 'metro');
  return page.evaluate(async ({ deco, cwId, ccwId }) => {
    const pool = deco ? state.decoLines : state.lines;
    const line = pool.find(item => item.id === 'C' && item._sys === 'krtc');
    const station = line.stations[0];
    // 一律走專案自己的地圖 adapter；MapLibre raw map 的 setView 相容殼不接受 Leaflet 形狀，
    // 會無聲留在全台 fit zoom，導致 showTrain=false 而量不到真實 hit list。
    M.setView([station.lat, station.lon], 14, { animate: false });
    await new Promise(resolve => setTimeout(resolve, 350));
    draw();
    const direct = metroCoreItemsForLine(line) || [];
    const hits = (state._freqHits || []).filter(hit => hit.core && hit.systemId === 'klrt' && hit.ln === line);
    return { mode: state.mode, deco: !!state.deco, ids: direct.map(item => item.vehicleId).sort(),
      hitIds: [...new Set(hits.map(hit => hit.vehicleId))].sort(), expected: [cwId, ccwId].sort(),
      zoom: M.getZoom(), collectMap: !!state.collectMap, bbox: line._bbox,
      projected: direct.map(item => ({ id: item.vehicleId, cp: mapDetailPoint([item.pos.lat, item.pos.lon]) })),
      allCoreHits: (state._freqHits || []).filter(hit => hit.core).map(hit => ({ id: hit.vehicleId, line: hit.ln?.id, sys: hit.systemId })) };
  }, { deco, cwId: CW_ID, ccwId: CCW_ID });
}

async function mixedHealthyEvidence(page) {
  return page.evaluate(() => {
    const evidence = {};
    for (const [systemId, lineId] of [['trtc', 'BL'], ['krtc', 'KR']]) {
      const line = state.lines.find(item => metroCoreSystemIdForLine(item) === systemId && item.id === lineId);
      const system = metroCoreSystem(systemId), items = line && metroCoreItemsForLine(line);
      const board = line && metroCoreBoardView(line.stations[0], [line], false, Date.now() / 1000);
      const coreRows = board?.groups?.filter(group => group.kind === 'core').flatMap(group => group.rows) || [];
      evidence[systemId] = { line: !!line, system: !!system, trains: items?.length || 0,
        boards: system?.boards?.length || 0, boardRows: coreRows.length,
        vehicleIds: items?.map(item => item.vehicleId) || [],
        boardVehicleIds: coreRows.map(row => row.vehicleId).filter(Boolean),
        boardKinds: board?.groups?.map(group => group.kind) || [] };
    }
    return { revision: __railMetroCore.status().revision, evidence };
  });
}

async function run3DAssertions(page, engine) {
  await selectView(page, 'metro');
  await page.waitForFunction(() => window.railIslandIntegration?.capture && window.railIslandPhysical?.metro,
    null, { timeout: 60000 });
  await pollVariant(page, 'pending');
  const stationary = await page.evaluate(async ({ cwId, ccwId }) => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    M.setView([line.stations[0].lat, line.stations[0].lon], 15, { animate: false });
    await new Promise(resolve => setTimeout(resolve, 300));
    const frame = window.railIslandIntegration.capture();
    const vehicle = id => frame.vehicles.find(item => item.sourceKind === 'core' && item.id.endsWith(':core:' + id));
    const cw = vehicle(cwId), ccw = vehicle(ccwId);
    return { cw: cw && { direction: cw.direction, railDirection: cw.railDirection, physical: !!cw.route?.physical },
      ccw: ccw && { direction: ccw.direction, railDirection: ccw.railDirection, physical: !!ccw.route?.physical } };
  }, { cwId: CW_ID, ccwId: CCW_ID });
  assert.equal(stationary.cw?.direction, 2, `${engine} 3D 順行 Core direction 正向對照`);
  assert.equal(stationary.cw?.railDirection, 1, `${engine} 靜止 direction2 的 3D railDirection 必須 +1`);
  assert.equal(stationary.cw?.physical, true, `${engine} 待發順行 p0 必須套用 physical C 股道`);
  assert.equal(stationary.ccw?.direction, 1, `${engine} 3D 逆行 Core direction 正向對照`);
  assert.equal(stationary.ccw?.railDirection, -1, `${engine} 靜止 direction1 的 3D railDirection 必須 -1`);
  assert.equal(stationary.ccw?.physical, false,
    `${engine} 待發逆行 raw p38 超出 physical endIndex=37，必須留在 original closure`);

  const polled = await pollVariant(page, 'closure');
  assert.equal(polled.accepted, true, `${engine} closure snapshot 應被接受`);
  const closure = await page.evaluate(async ({ cwId, ccwId, physicalId }) => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    const anchor = (metroCoreItemsForLine(line) || []).find(value => value.vehicleId === cwId);
    M.setView([anchor.pos.lat, anchor.pos.lon], 15, { animate: false });
    await new Promise(resolve => setTimeout(resolve, 350));
    const frame = window.railIslandIntegration.capture();
    const items = metroCoreItemsForLine(line, frame.clock.wallEpochSec) || [];
    const byId = id => items.find(value => value.vehicleId === id);
    const vehicle = id => frame.vehicles.find(value => value.sourceKind === 'core' && value.id.endsWith(':core:' + id));
    const physicalPair = [window.railIslandPhysical.metro.routeFor(line, 1),
      window.railIslandPhysical.metro.routeFor(line, -1)];
    const physicalRouteIds = new Set(physicalPair.filter(Boolean).map(item => item.route.id));
    const cRoutes = frame.routes.filter(route => route.id === 'krtc:C' || physicalRouteIds.has(route.id));
    const fallback = cRoutes.find(route => !route.physical);
    const lastD = Number(line.stations.at(-1).d) * 1000;
    const ranges = fallback?.drawingRanges || [];
    const detail = id => {
      const item = byId(id), rendered = vehicle(id);
      const projectedD = Number(projectOntoShape(line, item.pos.lat, item.pos.lon)?.d) * 1000;
      return {
        progress: item.pos.progress, direction: rendered?.direction, railDirection: rendered?.railDirection,
        physical: !!rendered?.route?.physical,
        // capture 為 drawingRanges 以 spread 複製 route；物件 identity 合法地不同，應比較
        // 穩定 route id 與同一份 coordinates reference，才是「車落在這條 original route」。
        sameFallbackRoute: rendered?.route?.id === fallback?.id && rendered?.route?.coordinates === fallback?.coordinates,
        coordinateError: rendered
          ? haversineKm({ lat: rendered.latitude, lon: rendered.longitude }, item.pos) * 1000 : Infinity,
        projectedD,
        closureVisible: ranges.some(([lo, hi]) => projectedD >= lo - .01 && projectedD <= hi + .01),
      };
    };
    return {
      zoom: M.raw.getZoom(), replacedLineKeys: frame.replacedLineKeys,
      physicalRouteCount: cRoutes.filter(route => route.physical).length,
      fallbackRouteCount: cRoutes.filter(route => !route.physical).length,
      lastD, ranges: ranges.map(([lo, hi]) => ({ lo, hi, infinite: hi === Infinity })),
      cw: detail(cwId), ccw: detail(ccwId), covered: detail(physicalId),
      pair: physicalPair.map(item => item?.record).map(record => record && ({ start: record.startIndex, end: record.endIndex })),
    };
  }, { cwId: CW_ID, ccwId: CCW_ID, physicalId: PHYSICAL_ID });
  assert(closure.zoom >= 14, `${engine} closure 必須在 near physical 視距：${JSON.stringify(closure)}`);
  assert(closure.replacedLineKeys.includes('krtc|C'),
    `${engine} 3D seam 必須宣告已抽換 krtc|C：${JSON.stringify(closure)}`);
  assert.deepEqual(closure.pair, [{ start: 0, end: 37 }, { start: 0, end: 37 }],
    `${engine} C 實體雙向路徑正向對照`);
  assert.equal(closure.physicalRouteCount, 2,
    `${engine} C 近景 routes 必須保留兩條 physical 股道：${JSON.stringify(closure)}`);
  assert.equal(closure.fallbackRouteCount, 1,
    `${engine} C 近景 routes 必須恰有一條 original fallback：${JSON.stringify(closure)}`);
  assert.equal(closure.ranges.length, 1,
    `${engine} C fallback 不可多畫非 closure 區間：${JSON.stringify(closure)}`);
  assert(Math.abs(closure.ranges[0].lo - closure.lastD) < .01 && closure.ranges[0].infinite,
    `${engine} original C route drawingRanges 必須精確為 [[lastStation.d*1000, Infinity]]：${JSON.stringify(closure)}`);
  for (const [name, expectedDirection, expectedRailDirection] of [['cw', 2, 1], ['ccw', 1, -1]]) {
    const sample = closure[name];
    assert(Math.abs(sample.progress - 37.5) < .01, `${engine} ${name} closure 測例必須真正在 p≈37.5`);
    assert.equal(sample.direction, expectedDirection, `${engine} ${name} p37.5 Core direction`);
    assert.equal(sample.railDirection, expectedRailDirection, `${engine} ${name} p37.5 railDirection`);
    assert.equal(sample.physical, false,
      `${engine} ${name} p37.5 超出 physical endIndex=37，不可假裝已套實體股道`);
    assert.equal(sample.sameFallbackRoute, true,
      `${engine} ${name} p37.5 必須引用仍可見的 original closure route：${JSON.stringify(closure)}`);
    assert(sample.coordinateError < .01 && sample.projectedD >= closure.lastD && sample.closureVisible,
      `${engine} ${name} p37.5 座標必須落在 original route 可見 closure：${JSON.stringify(closure)}`);
  }
  assert(Math.abs(closure.covered.progress - 36.5) < .01,
    `${engine} physical 正向對照必須真正在 p≈36.5`);
  assert.equal(closure.covered.direction, 2, `${engine} p36.5 Core direction 正向對照`);
  assert.equal(closure.covered.railDirection, 1, `${engine} p36.5 railDirection 必須 +1`);
  assert.equal(closure.covered.physical, true,
    `${engine} p36.5 尚在 physical 0..37 覆蓋內，必須套用實體股道：${JSON.stringify(closure)}`);
  await pollVariant(page, 'pending');
  console.log(`PASS ${engine} 3D 靜止方向／2 physical + 1 fallback seam／雙向 p37.5 closure`);
}

function assertMixedHealthy(value, variant, engine, { sameRevision = null, sameEvidence = null } = {}) {
  if (sameRevision == null) assert(String(value.revision || '').includes(`klrt-fe-${variant}-`),
    `${engine}/${variant} 必須接受新 mixed revision：${JSON.stringify(value)}`);
  else assert.equal(value.revision, sameRevision, `${engine}/${variant} 未換包時必須保留最後健康 revision`);
  for (const systemId of ['trtc', 'krtc']) {
    const row = value.evidence[systemId];
    assert(row?.line && row.system && row.trains > 0 && row.boards > 0 && row.boardRows > 0,
      `${engine}/${variant} 不可連坐 ${systemId} 的車與 Core 板：${JSON.stringify(row)}`);
    assert(row.boardKinds.includes('core') && row.boardVehicleIds.length > 0,
      `${engine}/${variant} ${systemId} 正向對照必須直接來自 kind=core，不可由 legacy 補綠：${JSON.stringify(row)}`);
    if (sameRevision == null) {
      assert(row.vehicleIds.every(id => id.includes(`:${variant}:`)) &&
        row.boardVehicleIds.every(id => id.includes(`:${variant}:`)),
      `${engine}/${variant} ${systemId} 的車與板身分必須來自新 revision：${JSON.stringify(row)}`);
    } else if (sameEvidence) {
      assert.deepEqual(row.vehicleIds, sameEvidence.evidence[systemId].vehicleIds,
        `${engine}/${variant} ${systemId} 未換包時必須保留車身分`);
      assert.deepEqual(row.boardVehicleIds, sameEvidence.evidence[systemId].boardVehicleIds,
        `${engine}/${variant} ${systemId} 未換包時必須保留 Core 站牌身分`);
    }
  }
}

async function runMapAndFallbackMatrix(page, engine) {
  const main = await mapLayerEvidence(page, false);
  assert.equal(main.mode, 'freq');
  assert.deepEqual(main.ids, main.expected, `${engine} 主圖必須讀 KLRT Core`);
  assert.deepEqual(main.hitIds, main.expected, `${engine} 主圖真 draw 命中必須保留 exact vehicleId`);
  const deco = await mapLayerEvidence(page, true);
  assert.equal(deco.mode, 'sched'); assert.equal(deco.deco, true);
  assert.deepEqual(deco.ids, deco.expected, `${engine} 全台同框必須讀 KLRT Core`);
  assert.deepEqual(deco.hitIds, deco.expected, `${engine} 全台同框真 draw 命中必須保留 exact vehicleId：${JSON.stringify(deco)}`);

  await selectView(page, 'metro');
  const absentPoll = await pollVariant(page, 'absent');
  assert.equal(absentPoll.accepted, true, `${engine} absent mixed snapshot 應通過 schema`);
  assertMixedHealthy(await mixedHealthyEvidence(page), 'absent', engine);
  const absent = await page.evaluate(() => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    const html = renderFreqBoard(null, line.stations[5], [line], false, { compact: true });
    return { core: metroCoreItemsForLine(line), legacy: metroCoreLegacyCountForLine(line), html };
  });
  assert.equal(absent.core, null, `${engine}/absent 必須退回 legacy，不得回 []`);
  assert(absent.legacy > 0 && /data-ci=/.test(absent.html) && !/data-core-vehicle=/.test(absent.html),
    `${engine}/absent 必須真的產生 legacy 班次`);

  // KLRT 官方站牌天然可能有大量匿名列；這是合法資料，不得因 match ratio 低就整個 system
  // fallback。匿名 ETA 照顯示但不可跟車，能對上身分的那一列仍須可點擊跟同一台車。
  const blockedPoll = await pollVariant(page, 'blocked');
  assert.equal(blockedPoll.accepted, true, `${engine} null-heavy KLRT snapshot 應通過 schema`);
  assertMixedHealthy(await mixedHealthyEvidence(page), 'blocked', engine);
  const nullHeavy = await page.evaluate(({ cwId, ccwId }) => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    const board = metroCoreBoardView(line.stations[5], [line], false, Date.now() / 1000);
    const rows = board?.groups?.filter(group => group.kind === 'core').flatMap(group => group.rows) || [];
    return { ids: (metroCoreItemsForLine(line) || []).map(item => item.vehicleId).sort(),
      blocked: __railMetroCore.status().blockedSystems?.klrt || null,
      rows: rows.map(row => ({ vehicleId: row.vehicleId, dtm: row.dtm, arrivalEpoch: row.arrivalEpoch,
        kind: row.kind, match: row.match })), expected: [cwId, ccwId].sort() };
  }, { cwId: CW_ID, ccwId: CCW_ID });
  assert.equal(nullHeavy.blocked, null, `${engine} KLRT 不可套用 generic match-ratio system gate`);
  assert.deepEqual(nullHeavy.ids, nullHeavy.expected, `${engine} null-heavy 看板不可讓 KLRT 地圖車 fallback`);
  assert.equal(nullHeavy.rows.length, 4, `${engine} 四筆 Core ETA 都必須保留：${JSON.stringify(nullHeavy)}`);
  assert.equal(nullHeavy.rows.filter(row => row.vehicleId == null).length, 3,
    `${engine} 三筆匿名 Core ETA 必須留在看板`);
  assert.deepEqual(nullHeavy.rows.filter(row => row.vehicleId != null).map(row => row.vehicleId), [CW_ID],
    `${engine} 唯一 matched 列必須保留 exact vehicleId`);
  assert(nullHeavy.rows.every(row => row.kind === 'core' && Number.isFinite(row.dtm) && Number.isFinite(row.arrivalEpoch)),
    `${engine} null-heavy 正向對照必須是真 Core ETA`);
  await openCBoard(page, false);
  const matched = page.locator(`#board .klrt-board-row[data-core-vehicle="${CW_ID}"]`).first();
  await matched.scrollIntoViewIfNeeded(); await matched.tap();
  assert.equal(await page.evaluate(() => state.freqFollow?.vehicleId), CW_ID,
    `${engine} null-heavy 中 matched Core 列仍須可跟隨`);
  await openCBoard(page, false);
  await page.evaluate(() => { state.freqFollow = null; });
  const anonymous = page.locator('#board .klrt-board-row[data-core-record]:not([data-core-vehicle])').first();
  await anonymous.scrollIntoViewIfNeeded(); await anonymous.tap();
  assert.equal(await page.evaluate(() => state.freqFollow), null, `${engine} 匿名 Core ETA 不可跟隨`);
  await closeBoardIfOpen(page);

  // 503 不是新 revision；正確隔離語意是保留上一份 mixed snapshot，TRTC/KRTC 車與板繼續可用。
  await pollVariant(page, 'pending');
  const before503 = await mixedHealthyEvidence(page);
  const failed = await pollVariant(page, 'missing', { preserve: true });
  assert.equal(failed.accepted, false, `${engine} 503 應回報 poll 失敗`);
  assert(/snapshot 503/.test(String(failed.status.error)), `${engine} 503 錯誤應具名`);
  assertMixedHealthy(await mixedHealthyEvidence(page), 'missing', engine,
    { sameRevision: before503.revision, sameEvidence: before503 });

  // KLRT 自己壞 schema 或送出契約外 C_BAD 時，只准隔離 KLRT；同包健康的 trtc/krtc
  // revision、車與板都必須更新。舊的 whole-package validator 會讓這兩條具名轉紅。
  for (const variant of ['broken', 'badLine']) {
    const polled = await pollVariant(page, variant);
    assert.equal(polled.accepted, true, `${engine}/${variant} KLRT 壞資料不得讓 mixed snapshot 整包退回：${polled.status.error || ''}`);
    assertMixedHealthy(await mixedHealthyEvidence(page), variant, engine);
    const klrt = await page.evaluate(() => {
      const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
      return { items: metroCoreItemsForLine(line), legacy: metroCoreLegacyCountForLine(line),
        blocked: __railMetroCore.status().blockedSystems?.klrt || null,
        isolated: __railMetroCore.status().isolatedSystems?.klrt || null };
    });
    assert.equal(klrt.items, null, `${engine}/${variant} 壞 KLRT 必須單獨回 legacy`);
    assert(klrt.legacy > 0, `${engine}/${variant} KLRT legacy 正向對照`);
    assert.equal(klrt.isolated?.reason, variant === 'broken' ? 'schema' : 'lineId',
      `${engine}/${variant} status.isolatedSystems.klrt.reason 必須具名`);
  }
  await pollVariant(page, 'pending');
  console.log(`PASS ${engine} 主圖／全台同框／mixed absent-null-heavy-broken-C_BAD-503 isolation`);
}

async function coreGateInternals(page) {
  return page.evaluate(() => ({
    history: [...metroCoreCountHistory.entries()].filter(([key]) => key === 'klrt:C')
      .map(([key, values]) => [key, [...values]]),
    strikes: [...metroCoreCountStrikes.entries()].filter(([key]) => key === 'klrt:C')
      .map(([key, value]) => [key, { ...value }]),
    blocked: __railMetroCore.status().blockedLines?.['klrt:C'] || null,
    isolated: __railMetroCore.status().isolatedSystems?.klrt || null,
  }));
}

async function runIsolationBoundaryMatrix(page, engine) {
  // 先用六台車養出可判斷的 count baseline；reference／duplicate 被 prepareSnapshot
  // 隔離後，不得把「這輪沒有 KLRT」誤餵成 0，也不得污染遲滯 blockedLines。
  await pollVariant(page, 'countHealthy');
  for (let index = 1; index < 4; index++) await pollVariant(page, 'countHealthy', { preserve: true });
  let baseline = await coreGateInternals(page);
  assert.deepEqual(baseline.history, [['klrt:C', [6, 6, 6, 6]]],
    `${engine} count baseline 必須先有四輪六台：${JSON.stringify(baseline)}`);
  assert.equal(baseline.blocked, null, `${engine} 健康 count baseline 不可 blocked`);

  for (const [variant, reason] of [['reference', 'reference'], ['duplicate', 'duplicate']]) {
    const isolatedPoll = await pollVariant(page, variant, { preserve: true });
    assert.equal(isolatedPoll.accepted, true,
      `${engine}/${variant} 只隔離 KLRT，mixed envelope 必須接受`);
    assertMixedHealthy(await mixedHealthyEvidence(page), variant, engine);
    const isolated = await page.evaluate(() => {
      const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
      return { items: metroCoreItemsForLine(line), legacy: metroCoreLegacyCountForLine(line),
        reason: __railMetroCore.status().isolatedSystems?.klrt?.reason || null };
    });
    assert.equal(isolated.reason, reason,
      `${engine}/${variant} status().isolatedSystems.klrt.reason 必須是 ${reason}`);
    assert.equal(isolated.items, null, `${engine}/${variant} KLRT 必須單獨 fallback`);
    assert(isolated.legacy > 0, `${engine}/${variant} KLRT legacy 正向對照`);
    const afterIsolation = await coreGateInternals(page);
    assert.deepEqual(afterIsolation.history, baseline.history,
      `${engine}/${variant} 隔離輪不可把 0 寫入 KLRT count history`);
    assert.equal(afterIsolation.blocked, null,
      `${engine}/${variant} 隔離輪不可污染 klrt:C blockedLines`);

    const recoveredPoll = await pollVariant(page, 'countHealthy', { preserve: true });
    assert.equal(recoveredPoll.accepted, true, `${engine}/${variant} 後健康 KLRT 必須立即恢復`);
    const recovered = await page.evaluate(() => {
      const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
      return { count: metroCoreItemsForLine(line)?.length || 0,
        isolated: __railMetroCore.status().isolatedSystems?.klrt || null };
    });
    assert.deepEqual(recovered, { count: 6, isolated: null },
      `${engine}/${variant} 恢復時不得殘留 isolation 或掉車`);
    const afterRecovery = await coreGateInternals(page);
    const previousValues = baseline.history[0][1];
    assert.deepEqual(afterRecovery.history, [['klrt:C', [...previousValues, 6]]],
      `${engine}/${variant} 恢復只應追加健康 count，不可含隔離輪的 0`);
    assert.equal(afterRecovery.blocked, null, `${engine}/${variant} 恢復不可殘留 blockedLines`);
    baseline = afterRecovery;
  }

  const noLinesPoll = await pollVariant(page, 'noLines');
  assert.equal(noLinesPoll.accepted, true, `${engine} 舊 Core 缺 lines 仍須相容`);
  assertMixedHealthy(await mixedHealthyEvidence(page), 'noLines', engine);
  const noLines = await page.evaluate(() => {
    const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
    const system = metroCoreSystem('klrt');
    return { hasLines: Object.hasOwn(system, 'lines'), count: metroCoreItemsForLine(line)?.length || 0,
      stationMismatch: __railMetroCore.status().stationMismatch?.['klrt:C'] || null };
  });
  assert.deepEqual(noLines, { hasLines: false, count: 2, stationMismatch: null },
    `${engine} 舊版缺 lines 不可誤判站列或 fallback`);

  const unknownPoll = await pollVariant(page, 'unknown');
  assert.equal(unknownPoll.accepted, true, `${engine} 未知 system 不可連坐已知系統`);
  const before304 = await mixedHealthyEvidence(page);
  assertMixedHealthy(before304, 'unknown', engine);
  const unknown = await page.evaluate(() => ({
    retained: !!state.metroCore.snapshot.systems.find(system => system.systemId === 'future-metro'),
    klrtCount: (() => {
      const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
      return metroCoreItemsForLine(line)?.length || 0;
    })(),
  }));
  assert.deepEqual(unknown, { retained: true, klrtCount: 2 },
    `${engine} 未知 system 可保留但不得干擾 KLRT`);

  const notModified = await pollNotModified(page);
  assert.equal(notModified.accepted, true, `${engine} 304 必須視為成功並沿用快照`);
  assert.equal(notModified.status.error, null, `${engine} 304 必須清除連線錯誤`);
  assertMixedHealthy(await mixedHealthyEvidence(page), 'notModified', engine,
    { sameRevision: before304.revision, sameEvidence: before304 });

  const rollback = await pollVariant(page, 'rollback', { preserve: true });
  assert.equal(rollback.accepted, false, `${engine} generatedAt rollback 必須拒收`);
  assert(/snapshot rollback/.test(String(rollback.status.error)), `${engine} rollback 錯誤必須具名`);
  assertMixedHealthy(await mixedHealthyEvidence(page), 'rollback', engine,
    { sameRevision: before304.revision, sameEvidence: before304 });
  await pollVariant(page, 'pending');
  console.log(`PASS ${engine} reference／duplicate isolation + count 恢復／304／rollback／unknown／no-lines`);
}

async function boardLayout(page, tag) {
  const report = await page.evaluate(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const rect = element => element.getBoundingClientRect();
    const unclipped = element => {
      const own = rect(element);
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
        const clip = rect(parent);
        if (own.left < clip.left - 1 || own.right > clip.right + 1 || own.top < clip.top - 1 || own.bottom > clip.bottom + 1) return false;
      }
      return true;
    };
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const board = document.getElementById('board'), boardRect = rect(board);
    // 「主要控件」取實際操作 UI；頁尾／資料來源文字連結位於可捲內容底層，固定 mobile tabs
    // 本來就會覆過它們，納入會把既有頁面捲動語意誤報成本次看板碰撞。
    const all = [...document.querySelectorAll('button, input, select, [role="button"], .row[data-core-record]')]
      .filter(element => !element.closest('.foot-links') && !element.closest('#note')).filter(visible).filter(unclipped);
    // Sheet 覆住的底層地圖控件不列為「應可點」；板內控件及板外未被 sheet 蓋住者全部納入。
    const controls = all.filter(element => board.contains(element) || !intersects(rect(element), boardRect));
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const name = element => `${element.tagName.toLowerCase()}#${element.id || ''}.${String(element.className || '')}` +
        (element.tagName === 'A' ? `[${element.getAttribute('href') || ''}|${element.textContent.trim()}|parent=${element.parentElement?.className || ''}]` : '');
      if (intersects(rect(a), rect(b))) overlaps.push([name(a), name(b)]);
    }
    // 這裡驗板頭按鈕；限高 sheet 摺線下方的每一向／匿名列會在下方逐列
    // scrollIntoViewIfNeeded + elementFromPoint + page.tap。單看 row 的 viewport rect 不會反映
    // overflow ancestor 的裁切，曾會把摺線下方列誤報成「已可點」。
    const targets = [...board.querySelectorAll('button')].filter(visible).filter(unclipped)
      .filter(element => { const r = rect(element); return r.top >= 0 && r.bottom <= innerHeight; });
    const missed = targets.map(element => {
      const r = rect(element), x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      return element.contains(hit) ? null : { target: element.id || element.getAttribute('data-core-record') || element.className,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        hit: hit && `${hit.tagName.toLowerCase()}#${hit.id || ''}.${String(hit.className || '')}` };
    }).filter(Boolean);
    const clipped = [...board.querySelectorAll('.row[data-core-record]')].filter(visible).filter(element => {
      const r = rect(element); return element.scrollWidth > element.clientWidth + 1 || r.left < -1 || r.right > innerWidth + 1;
    }).map(element => element.textContent);
    return { pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      boardOverflow: board.scrollWidth > board.clientWidth + 1, controls: controls.length,
      rows: board.querySelectorAll('.row[data-core-record]').length, overlaps, missed, clipped };
  });
  assert.equal(report.pageOverflow, false, `${tag} 頁面水平 overflow ${JSON.stringify(report)}`);
  assert.equal(report.boardOverflow, false, `${tag} 看板水平 overflow ${JSON.stringify(report)}`);
  assert(report.controls > 4 && report.rows >= 3, `${tag} 版面正向對照不足 ${JSON.stringify(report)}`);
  assert.deepEqual(report.overlaps, [], `${tag} 主要控件不得碰撞`);
  assert.deepEqual(report.missed, [], `${tag} 可見控件中心必須 elementFromPoint 命中自己`);
  assert.deepEqual(report.clipped, [], `${tag} Core row 不得被水平裁切`);
}

async function runMobileBoard(page, engine, width) {
  await selectView(page, 'metro');
  await openCBoard(page, false);
  const tag = `${engine}/${width}`;
  const summary = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#board .klrt-board-row > b')].map(node => node.textContent.trim()),
    ids: [...document.querySelectorAll('#board .klrt-board-row[data-core-vehicle]')].map(node => node.dataset.coreVehicle).sort(),
    nullRows: document.querySelectorAll('#board .klrt-board-row[data-core-record]:not([data-core-vehicle])').length,
    rawDest38: (document.getElementById('board')._metroCoreRecords || []).some(row =>
      row.destinationStationIndex === 38 && row.destName === row.ln.stations[0].name),
  }));
  assert(summary.labels.includes('順行') && summary.labels.includes('逆行'), `${tag} 必須同時顯示順／逆行`);
  assert.deepEqual(summary.ids, [CCW_ID, CW_ID].sort(), `${tag} DOM 必須保留兩個 exact Core ID`);
  assert(summary.nullRows >= 1, `${tag} null vehicle row 必須顯示但無跟隨屬性`);
  assert.equal(summary.rawDest38, true, `${tag} renderer 不得改掉 raw destination 38`);
  for (const full of [false, true]) {
    await page.evaluate(value => { document.body.classList.toggle('fs', value); dispatchEvent(new Event('resize')); }, full);
    await page.waitForTimeout(80);
    await boardLayout(page, `${tag}/fs=${full}`);
  }
  await page.evaluate(() => document.body.classList.remove('fs'));

  for (const vehicleId of [CW_ID, CCW_ID]) {
    const linked = page.locator(`#board .klrt-board-row[data-core-vehicle="${vehicleId}"]`).first();
    await linked.scrollIntoViewIfNeeded();
    assert(await linked.evaluate(element => {
      const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }), `${tag}/${vehicleId} matched row 真觸控命中`);
    await linked.tap();
    const follow = await page.evaluate(() => state.freqFollow && ({ core: state.freqFollow.core,
      systemId: state.freqFollow.systemId, lineId: state.freqFollow.lineId, vehicleId: state.freqFollow.vehicleId }));
    assert.deepEqual(follow, { core: true, systemId: 'klrt', lineId: 'C', vehicleId }, `${tag} page.tap 必須跟同一 ID`);
    const expectedCard = vehicleId === CW_ID
      ? { dir: '順行', next: '凱旋瑞田', status: '● 已依官方到站看板逐站倒數推算' }
      : { dir: '逆行', next: '輕軌機廠站', status: '官方資料暫時中斷，沿用最後一次官方位置' };
    await page.waitForFunction(expected => {
      const value = id => document.getElementById(id)?.textContent?.trim() || '';
      return value('fcDir') === expected.dir && value('fcNext') === expected.next && value('fcStatus') === expected.status;
    }, expectedCard, { timeout: 10000 });
    const card = await page.evaluate(() => ({
      dir: document.getElementById('fcDir')?.textContent.trim(),
      next: document.getElementById('fcNext')?.textContent.trim(),
      status: document.getElementById('fcStatus')?.textContent.trim(),
    }));
    assert.deepEqual(card, expectedCard,
      `${tag}/${vehicleId} 跟車卡必須顯示環線方向、正確下一站與 quality.source 文案`);
    await openCBoard(page, false);
  }

  const unlinked = page.locator('#board .klrt-board-row[data-core-record]:not([data-core-vehicle])').first();
  await unlinked.scrollIntoViewIfNeeded();
  assert(await unlinked.evaluate(element => {
    const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }), `${tag} null row 必須看得到且命中自己`);
  await page.evaluate(() => { state.freqFollow = null; });
  await unlinked.tap();
  assert.equal(await page.evaluate(() => state.freqFollow), null, `${tag} null vehicle row 不可跟隨`);
  await closeBoardIfOpen(page);
  console.log(`PASS ${tag}px 真觸控／elementFromPoint／overflow／控件碰撞`);
}

async function runPreChangeCompatibility() {
  const preChangeRef = 'be03f400581dbb6bfe50fb79512bd8e958cc26fe';
  const previous = execFileSync('git', ['show', `${preChangeRef}:index.html`], {
    cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
  });
  assert(!/klrt\s*:\s*\['C'\]/.test(previous.toString('utf8')),
    `${preChangeRef} 必須是 KLRT Core 接線前 fixture`);
  servedIndex = previous;
  snapshotVariant = 'pending';
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 },
      isMobile: true, hasTouch: true, locale: 'zh-TW' });
    try {
      const { page, errors } = await bootPage(context);
      const accepted = await pollVariant(page, 'pending');
      assert.equal(accepted.accepted, true, `pre-change client 必須忽略不認得的 klrt system：${accepted.status.error || ''}`);
      assertMixedHealthy(await mixedHealthyEvidence(page), 'pending', 'pre-change/origin-main');
      const c = await page.evaluate(() => {
        const line = state.lines.find(item => item.id === 'C' && item._sys === 'krtc');
        const html = renderFreqBoard(null, line.stations[5], [line], false, { compact: true });
        return { mapping: metroCoreSystemIdForLine(line), items: metroCoreItemsForLine(line),
          legacy: metroCoreLegacyCountForLine(line), html };
      });
      assert.equal(c.mapping, null, 'pre-change client 不應誤把 C 當成已支援 Core');
      assert.equal(c.items, null, 'pre-change client 的 C 必須走 legacy');
      assert(c.legacy > 0 && /data-ci=/.test(c.html), 'pre-change client 的 C legacy 必須真的有班次');
      assert.deepEqual(errors, [], 'pre-change fixture 不得有頁面例外');
      console.log(`G2 pre-change ${preChangeRef.slice(0, 12)} PASS：含 klrt mixed snapshot 不影響既有 trtc/krtc，C 保持 legacy`);
    } finally { await context.close(); }
  } finally {
    await browser.close();
    servedIndex = HTML;
    snapshotVariant = 'pending';
  }
}

let browserCases = 0;
try {
  await runPreChangeCompatibility();
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true,
      ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
    try {
      for (const width of [360, 375, 390, 414, 768]) {
        snapshotVariant = 'pending';
        const context = await browser.newContext({ viewport: { width, height: 900 },
          isMobile: true, hasTouch: true, locale: 'zh-TW' });
        try {
          const { page, errors } = await bootPage(context);
          if (width === 390) {
            await runContractAndLifecycle(page, engine);
            await runOriginBoardBoundary(page, engine);
            await run3DAssertions(page, engine);
            await runMapAndFallbackMatrix(page, engine);
            await runIsolationBoundaryMatrix(page, engine);
          }
          await pollVariant(page, 'pending');
          await runMobileBoard(page, engine, width);
          assert.deepEqual(errors, [], `${engine}/${width} 頁面不得有執行例外`);
          browserCases++;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  console.log(`PASS KLRT Core 公開端專用驗收：${browserCases} 個雙引擎手機 context；390px 各跑完整功能矩陣`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
