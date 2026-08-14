#!/usr/bin/env node
// 派工④：前端官方名冊驗收。A–E 直接抽 index.html 真源碼求值；F 以實際產品頁做雙引擎手機掃描。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { buildTrtcModel } from './trtc_board_ledger.mjs';
import { reduceOfficialRoster } from './trtc_official_roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const INDEX = fs.readFileSync(INDEX_PATH, 'utf8');
const BASE_INDEX = execFileSync('git', ['show', '008d5d6:index.html'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const OUTPUT = path.resolve(process.env.TRTC_OFFICIAL_FRONTEND_OUTPUT ||
  path.join(ROOT, 'tmp/verify_official_roster_frontend-output.json'));
const result = { assertions: [], mutations: [], browser: [], metrics: {}, source: INDEX_PATH };
let failures = 0;

function check(condition, label, detail = '') {
  const pass = !!condition;
  result.assertions.push({ pass, label, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  if (!pass) failures++;
  return pass;
}
function mutationCheck(label, expectedRed, baseline, mutant, detail = '') {
  const actualRed = Object.keys(baseline).filter(key => baseline[key] && !mutant[key]).sort();
  const expected = [...expectedRed].sort();
  const caught = JSON.stringify(actualRed) === JSON.stringify(expected);
  result.mutations.push({ caught, label, expectedRed: expected, actualRed, detail });
  console.log(`${caught ? '🧬' : '❌'} mutation ${label}：預期 ${expected.join(',')} / 實際 ${actualRed.join(',') || '無'}`);
  if (!caught) failures++;
  return caught;
}
const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

// 只計算函式最外層大括號；字串、template 與註解內的括號不參與。
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0, mode = 'code', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} 大括號未閉合`);
}
function extractConst(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
  if (!match) throw new Error(`找不到 const ${name}`);
  return match[0];
}
function replaceExactly(source, before, after, label) {
  const hits = source.split(before).length - 1;
  if (hits !== 1) throw new Error(`${label} mutation 錨點預期 1 處，實際 ${hits} 處`);
  return source.replace(before, after);
}
function compileGuard(source, label) {
  try { new vm.Script(source, { filename: `${label}.mutant.js` }); }
  catch (error) { throw new Error(`${label} mutation 編譯失敗（不得當成轉紅）：${error.stack || error}`); }
}

console.log(`【受測檔】${INDEX_PATH}`);
console.log(`【sha256】${sha(INDEX)}`);

const PRODUCT_FUNCTIONS = ['trtcOfficialRosterEnabled', 'trtcOfficialRosterActive',
  'trtcOfficialRosterForLine', 'trtcOfficialVehiclePosition', 'trtcOfficialVehicleInfo',
  'trtcOfficialRenderItems', 'trtcOfficialVehicleGlyph', 'trtcOfficialSameTarget'];
const MUTATION_PLAN = {
  'M-A1 feedMode 反轉': ['A', 'C', 'D'],
  'M-A2 age gate 失效': ['A'],
  'M-A3 畫車主迴圈繞過官方名冊': ['A'],
  'M-A4 旗標關閉改走官方多選命中': ['A'],
  'M-A5 略過逐車幾何邊界': ['A'],
  'M-A6 略過版本 high-water': ['A'],
  'M-A7 允許移動列零秒時間軸': ['A'],
  'M-A8 官方旗標波及非北捷命中': ['A'],
  'M-A9 允許 null 冒充數值': ['A'],
  'M-B arrEpoch 延後 30 秒才到站': ['B', 'G'],
  'M-B2 位置公式接受零秒時間軸': ['B'],
  'M-G1 續推卡在原站不前進': ['G'],
  'M-G2 續推衝過終點站': ['G'],
  'M-G3 續推沒有上限': ['G'],
  'M-G4 續推停站時間可為負': ['G'],
  'M-C 沒車號就不畫': ['A', 'C', 'D'],
  'M-C2 無號車錯畫成空白車牌': ['C'],
  'M-C3 renderer 不用 glyph 分流': ['C'],
  'M-D1 濾掉 extension': ['A', 'D'],
  'M-D2 濾掉兩站接駁線': ['A', 'D'],
  'M-D3 濾掉起點停站車': ['A', 'D'],
  'M-E 第三形忽略 vehicleId': ['E'],
  'M-E2 snapshot 刷新改用物件參照': ['E'],
  'M-E3 疊車只留陣列第一台': ['E'],
  'M-E4 跟隨路徑拿掉時光機把關': ['E'],
  'M-F 可互動控件上蓋遮擋層': ['F'],
};
console.log('【Mutation 預期（執行前先宣告）】');
for (const [name, red] of Object.entries(MUTATION_PLAN)) console.log(`- ${name} 應轉紅：${red.join('、')}`);
for (const marker of ['ROSTER_FRONTEND_ACTIVE', 'ROSTER_FRONTEND_POSITION',
  'ROSTER_FRONTEND_RENDER', 'ROSTER_FRONTEND_GLYPH', 'ROSTER_FRONTEND_TARGET',
  'ROSTER_FRONTEND_GEOMETRY', 'OFFICIAL_PAYLOAD_SCALAR_GUARD', 'OFFICIAL_PAYLOAD_TIMING_GUARD', 'OFFICIAL_POSITION_AXIS_GUARD',
  'ROSTER_FRONTEND_REVISION_HIGH_WATER']) {
  const hits = INDEX.split(marker).length - 1;
  if (hits !== 1) throw new Error(`${marker} 錨點預期 1 處，實際 ${hits} 處`);
}

function buildProductApi(overrides = {}, label = 'baseline') {
  const sourceOf = name => overrides[name] || extractFunction(INDEX, name);
  const bundle = `
    ${sourceOf('trtcOfficialRosterEnabled')}
    ${extractConst(INDEX, 'OFFICIAL_ROSTER_ENABLED')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_MAX_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_DWELL_MIN_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_DWELL_DEFAULT_SEC')}
    ${extractFunction(INDEX, 'posAlongShape')}
    ${extractFunction(INDEX, 'posBetweenStations')}
    ${extractFunction(INDEX, 'trtcServiceSec')}
    ${sourceOf('trtcOfficialCoastCycle')}
    ${sourceOf('trtcOfficialCoastPosition')}
    ${PRODUCT_FUNCTIONS.filter(name => name !== 'trtcOfficialRosterEnabled').map(sourceOf).join('\n')}
    globalThis.__api = { ${PRODUCT_FUNCTIONS.join(',')}, trtcOfficialCoastCycle, trtcOfficialCoastPosition,
      maxAge: TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC, coastMax: TRTC_OFFICIAL_COAST_MAX_SEC };
  `;
  compileGuard(bundle, label);
  const context = { URLSearchParams, location: { search: '?officialroster=1' }, Date, Math };
  vm.createContext(context);
  try { vm.runInContext(bundle, context, { filename: `${label}.product.js` }); }
  catch (error) { throw new Error(`${label} 產品函式匯入／執行失敗（不得當成轉紅）：${error.stack || error}`); }
  return context.__api;
}
function mutationApi(name, before, after, label) {
  const original = extractFunction(INDEX, name);
  const mutant = replaceExactly(original, before, after, label);
  return buildProductApi({ [name]: mutant }, label);
}
function mutationIndexFunction(name, before, after, label) {
  const original = extractFunction(INDEX, name);
  const mutant = replaceExactly(original, before, after, label);
  compileGuard(`(${mutant})`, label);
  return { source: INDEX.replace(original, mutant), fn: mutant };
}

const BL = { id: 'BL', hasShape: false, _tt: [['刻意無關的班表']], stations: [
  { name: '藍0', lat: 25, lon: 121 }, { name: '藍1', lat: 25.1, lon: 121.1 },
  { name: '藍2', lat: 25.2, lon: 121.2 }, { name: '藍3', lat: 25.3, lon: 121.3 },
] };
const XBT = { id: 'G_XBT', hasShape: false, stations: [
  { name: '小碧潭', lat: 24.95, lon: 121.53 }, { name: '七張', lat: 24.96, lon: 121.54 },
] };
const VEHICLES = [
  { vehicleId: 'v-number', line: 'BL', dir: 2, dest: 3, from: 0, to: 1, run: 20,
    arrEpoch: 1020, officialNo: 'A12', terminal: false, extension: false },
  { vehicleId: 'v-anon', line: 'BL', dir: 2, dest: 3, from: 1, to: 2, run: 30,
    arrEpoch: 1025, officialNo: '', terminal: false, extension: false },
  { vehicleId: 'v-extension', line: 'BL', dir: 2, dest: 3, from: 2, to: 3, run: 30,
    depEpoch: 1010, arrEpoch: 1040, officialNo: '', terminal: false, extension: true },
  { vehicleId: 'v-origin', line: 'BL', dir: 2, dest: 3, from: 0, to: 0, run: 0,
    arrEpoch: 1100, officialNo: '', terminal: true, extension: false },
  { vehicleId: 'v-reverse', line: 'BL', dir: 1, dest: 0, from: 3, to: 2, run: 20,
    arrEpoch: 1020, officialNo: 'B34', terminal: false, extension: false },
  { vehicleId: 'v-xbt-stop', line: 'G_XBT', dir: 2, dest: 1, from: 0, to: 0, run: 0,
    arrEpoch: 1100, officialNo: '', terminal: true, extension: false },
];
const NOW = 1010;
const BOARD = { at: 1000, sourceRevision: 1000, feedMode: 'official', rows: [],
  vehicles: VEHICLES, extensions: VEHICLES.filter(vehicle => vehicle.extension) };

// ── G 續推（coasting）fixture ──────────────────────────────────────────────
// 使用者裁示：有官方訊號就一直推算下去，車不准在中間消失——到站→停站→出發→維持速度→
// 準時到下一站。判準只用「站點座標」與「手算的時刻常數」，不重跑實作的公式（心得 29）。
const CO = { id: 'CO', hasShape: false, stations: [
  { name: '續0', lat: 25.0, lon: 121.0 }, { name: '續1', lat: 25.1, lon: 121.1 },
  { name: '續2', lat: 25.2, lon: 121.2 }, { name: '續3', lat: 25.3, lon: 121.3 },
  { name: '續4', lat: 25.4, lon: 121.4 }, { name: '續5', lat: 25.5, lon: 121.5 },
] };
// 官方最後一筆＝2000 秒到「續1」；自己 history 相鄰兩筆差 100 秒 ⇒ 週期 100（停 20、跑 80），
// 終點站「續4」還有 3 段。以下每個時刻的期望站別都是照這組常數手算的。
const COAST = { vehicleId: 'v-coast', line: 'CO', dir: 2, dest: 4, from: 0, to: 1, run: 80,
  arrEpoch: 2000, officialNo: 'C01', terminal: false, extension: false,
  history: [{ to: 0, arrEpoch: 1900 }, { to: 1, arrEpoch: 2000 }] };
const COAST_REVERSE = { ...COAST, vehicleId: 'v-coast-rev', dir: 1, dest: 1, from: 5, to: 4, run: 70,
  history: [{ to: 5, arrEpoch: 1910 }, { to: 4, arrEpoch: 2000 }] };      // 週期 90（停 20、跑 70）
const COAST_NOHIST = { ...COAST, vehicleId: 'v-coast-nohist', history: undefined }; // 退回 run+25=105
const COAST_RUNOVER = { ...COAST, vehicleId: 'v-coast-runover', run: 109 };  // run 比週期長（實測有）
const COAST_TERMINAL = { ...COAST, vehicleId: 'v-coast-term', dest: 1 };    // 官方最後一筆就是終點站
function coastAudit(api) {
  const P = (vehicle, now) => api.trtcOfficialVehiclePosition(CO, vehicle, now);
  const same = (pos, k) => !!pos && pos.lat === CO.stations[k].lat && pos.lon === CO.stations[k].lon;
  const failed = [];
  const want = (ok, label) => { if (!ok) failed.push(label); return ok; };

  const arrive = P(COAST, 2000);                       // ① 到站當格仍要 bit-exact 停在 to
  want(same(arrive, 1) && arrive.fraction === 1 && arrive.atStation === true && arrive.coastTo === 1, '到站當格');
  const dwell = P(COAST, 2010);                        // ② 停站 20 秒內留在原站
  want(same(dwell, 1) && dwell.atStation === true && dwell.coastTo === 1, '停站中');
  const depart = P(COAST, 2020), half = P(COAST, 2060);// ③ 停滿就開走、④ 中點在兩站正中央
  want(same(depart, 1) && depart.atStation === false && depart.coastTo === 2, '出發瞬間');
  want(half && half.atStation === false && half.coastTo === 2 && half.coastArrEpoch === 2100 &&
    Math.abs(half.lat - 25.15) < 1e-9 && Math.abs(half.lon - 121.15) < 1e-9, '行駛中點');
  const next1 = P(COAST, 2100), next2 = P(COAST, 2200);// ⑤ 準時到下一站、再下一站
  want(same(next1, 2) && next1.atStation === true && next1.coastArrEpoch === 2100, '準時到續2');
  want(same(next2, 3) && next2.atStation === true && next2.coastArrEpoch === 2200, '準時到續3');
  const term = P(COAST, 2300), beyond = P(COAST, 2560);// ⑥ 到終點站停住，不衝過頭
  want(same(term, 4) && same(beyond, 4), '終點站停住');
  want(P(COAST, 2000 + api.coastMax) !== null &&      // ⑦ 只有超過續推上限才交還班表
    P(COAST, 2000 + api.coastMax + 1) === null, '續推上限');
  let mono = true, prev = -Infinity;                   // ⑧ 逐秒單調前進（緯度沿線遞增，外部性質）
  for (let t = 2000; t <= 2300; t++) {
    const pos = P(COAST, t);
    if (!pos || pos.lat < prev - 1e-9) { mono = false; break; }
    prev = pos.lat;
  }
  want(mono, '單調不倒退');
  const rev1 = P(COAST_REVERSE, 2090), rev2 = P(COAST_REVERSE, 2180); // ⑨ 反方向同樣成立
  want(same(rev1, 3) && rev1.coastArrEpoch === 2090 && same(rev2, 2), '反方向準時到站');
  let monoRev = true; prev = Infinity;
  for (let t = 2000; t <= 2270; t++) {
    const pos = P(COAST_REVERSE, t);
    if (!pos || pos.lat > prev + 1e-9) { monoRev = false; break; }
    prev = pos.lat;
  }
  want(monoRev, '反方向單調');
  want(same(P(COAST_NOHIST, 2105), 2), 'history 缺席退路');            // ⑩ 沒 history 退回 run+25
  const runOver = [P(COAST_RUNOVER, 2010), P(COAST_RUNOVER, 2050), P(COAST_RUNOVER, 2100)];
  want(runOver.every(Boolean) && same(runOver[0], 1) && runOver[0].atStation === true &&
    runOver[1].atStation === false && same(runOver[2], 2), 'run 大於週期');  // ⑪ 不准算出負的停站
  want([P(COAST_TERMINAL, 2000), P(COAST_TERMINAL, 2300)]
    .every(pos => same(pos, 1) && pos.atStation === true), '終點站車不動');   // ⑫ 不倒退不消失
  const info = api.trtcOfficialVehicleInfo(CO, COAST, 2100);           // ⑬ 面板要跟著續推前進
  want(info && info.nextName === '續2' && info.pos, '面板跟著前進');

  return { pass: failed.length === 0, failed };
}

function buildIngestApi(overrides = {}, label = 'ingest-baseline', lines = [BL, XBT]) {
  const sourceOf = name => overrides[name] || extractFunction(INDEX, name);
  const bundle = `
    const OFFICIAL_ROSTER_ENABLED = true;
    ${extractConst(INDEX, 'TRTC_BOARD_LINES')}
    const state = { systems:[{id:'mrt', data:{lines:globalThis.__lines}}], lines:[], decoLines:null,
      trtcOfficialRoster:null, trtcOfficialRosterRevisionHighWater:null, freqFollow:null };
    function clearFreqFollow() { state.freqFollow = null; }
    function showToast() {}
    ${sourceOf('trtcOfficialRosterGeometryLine')}
    ${sourceOf('trtcOfficialRosterPayloadValid')}
    ${sourceOf('trtcOfficialRosterOutage')}
    ${sourceOf('applyTrtcOfficialRoster')}
    globalThis.__api = {
      state,
      valid:trtcOfficialRosterPayloadValid,
      apply:applyTrtcOfficialRoster,
      reset() {
        state.trtcOfficialRoster = null;
        state.trtcOfficialRosterRevisionHighWater = null;
        state.freqFollow = null;
      }
    };
  `;
  compileGuard(bundle, label);
  const context = { __lines: JSON.parse(JSON.stringify(lines)), Date, Math, Number, String, Array, Set };
  vm.createContext(context);
  try { vm.runInContext(bundle, context, { filename: `${label}.product.js` }); }
  catch (error) { throw new Error(`${label} ingest 產品函式匯入／執行失敗（不得當成轉紅）：${error.stack || error}`); }
  return context.__api;
}
function mutationIngestApi(name, before, after, label) {
  const original = extractFunction(INDEX, name);
  const mutant = replaceExactly(original, before, after, label);
  return buildIngestApi({ [name]: mutant }, label);
}
function ingestRuntimeAudit(api = buildIngestApi()) {
  const frame = JSON.parse(JSON.stringify({ ...BOARD, sourceRevision:100 }));
  api.reset();
  const accepted = api.apply(frame) && api.state.trtcOfficialRoster?.vehicles?.length === VEHICLES.length;
  const firstRegressionRejected = !api.apply({ ...frame, sourceRevision:90 }) &&
    api.state.trtcOfficialRoster?.reason === 'source-revision-regressed';
  const repeatedRegressionRejected = !api.apply({ ...frame, sourceRevision:90 }) &&
    api.state.trtcOfficialRoster?.reason === 'source-revision-regressed';
  const highWaterHeld = api.state.trtcOfficialRosterRevisionHighWater === 100;
  const invalidVehicles = [
    { ...VEHICLES[0], to:99 },
    { ...VEHICLES[0], from:0, to:2 },
    { ...VEHICLES[0], run:0 },
    { ...VEHICLES[0], from:1, to:0, dir:2 },
    { ...VEHICLES[0], depEpoch:VEHICLES[0].arrEpoch },
    { ...VEHICLES[0], arrEpoch:null },
    { ...VEHICLES[0], line:'NOT_A_LINE' },
  ];
  const malformedRejected = invalidVehicles.map((vehicle, index) => {
    const malformed = { ...frame, sourceRevision:101 + index, vehicles:[vehicle] };
    return !api.apply(malformed) && api.state.trtcOfficialRoster?.reason === 'malformed' &&
      api.state.trtcOfficialRosterRevisionHighWater === 100;
  });
  const stationary = { ...VEHICLES.find(vehicle => vehicle.vehicleId === 'v-origin') };
  const stationaryAccepted = api.apply({ ...frame, sourceRevision:105, vehicles:[stationary] }) &&
    api.state.trtcOfficialRoster?.vehicles?.length === 1;
  return { pass:accepted && firstRegressionRejected && repeatedRegressionRejected && highWaterHeld &&
      malformedRejected.every(Boolean) && stationaryAccepted,
    accepted, firstRegressionRejected, repeatedRegressionRejected, highWaterHeld,
    malformedRejected:`${malformedRejected.filter(Boolean).length}/${malformedRejected.length}`, stationaryAccepted };
}
const INGEST_RUNTIME = ingestRuntimeAudit();

function peakFrontendAudit(renderApi) {
  const peakDir = path.join(ROOT, 'tmp/binder-fixtures/rounds-peak');
  const ids = fs.readdirSync(peakDir).map(name => name.match(/^(\d+)_live\.json$/)?.[1])
    .filter(Boolean).sort();
  const trtcData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json'), 'utf8'));
  const model = buildTrtcModel(trtcData,
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json'), 'utf8')), { includeY:true });
  const ingest = buildIngestApi({}, 'peak-ingest', trtcData.lines);
  let prior = null, rows = 0, vehicleObservations = 0, renderedObservations = 0,
    acceptedFrames = 0, cardinalityMismatches = 0;
  for (const id of ids) {
    const live = JSON.parse(fs.readFileSync(path.join(peakDir, `${id}_live.json`), 'utf8'));
    const current = live.boardPos?.rows || [], at = Number(live.boardPos?.at);
    const roster = reduceOfficialRoster({ model, rows:current, prior, day:'2026-08-13',
      nowEpoch:at, sourceRevision:at });
    const frame = { at, sourceRevision:at, feedMode:'official', vehicles:roster.vehicles };
    const accepted = ingest.apply(frame);
    const rendered = trtcData.lines.reduce((sum, line) =>
      sum + (renderApi.trtcOfficialRenderItems(line, frame, at, true) || []).length, 0);
    rows += current.length; vehicleObservations += roster.vehicles.length; renderedObservations += rendered;
    if (accepted) acceptedFrames++;
    if (!accepted || ingest.state.trtcOfficialRoster?.vehicles?.length !== roster.vehicles.length ||
        rendered !== roster.vehicles.length) cardinalityMismatches++;
    prior = roster;
  }
  return { pass:ids.length > 0 && acceptedFrames === ids.length && cardinalityMismatches === 0 &&
      renderedObservations === vehicleObservations,
    rounds:ids.length, rows, vehicleObservations, renderedObservations, acceptedFrames, cardinalityMismatches };
}

function identitySourceAudit() {
  const apply = extractFunction(INDEX, 'applyFreqFollow');
  const camera = extractFunction(INDEX, 'updateFreqFollowCamera');
  const lock = extractFunction(INDEX, 'setFollowLock');
  const hits = extractFunction(INDEX, 'freqTrainsAt');
  const picker = extractFunction(INDEX, 'tapPickFreqTrain');
  const frozenNames = ['recordRide', 'followTrainNo', 'showFollowPanel', 'tripSysCode', 'tripSysId',
    'buildTripUrl', 'parseTripParam', 'applyTripLink'];
  const frozen = frozenNames.filter(name => extractFunction(INDEX, name) === extractFunction(BASE_INDEX, name));
  const officialSources = PRODUCT_FUNCTIONS.map(name => extractFunction(INDEX, name)).join('\n') + apply + camera + lock;
  const sameTargetCalls = (INDEX.match(/trtcOfficialSameTarget\s*\(/g) || []).length;
  const legacyInlineReaders = (INDEX.match(/f\s*&&\s*f\.ln\s*===\s*fh\.ln/g) || []).length;
  const multiHitBranches = (INDEX.match(/if\s*\(fhs\.length\s*>\s*1\)/g) || []).length;
  const pass = /target\.vehicleId\s*!=\s*null/.test(apply) && /official:\s*true/.test(apply) &&
    /f\.vehicleId\s*!=\s*null/.test(camera) && /trtcOfficialFollowRecord/.test(camera) &&
    /f\.vehicleId\s*!=\s*null/.test(lock) && /trtcOfficialSameTarget\(f,\s*fh\)/.test(picker) &&
    /halfW/.test(hits) && /vehicleId/.test(hits) && /\.sort\(/.test(hits) &&
    sameTargetCalls >= 4 && legacyInlineReaders === 0 && multiHitBranches >= 2 &&
    frozen.length === frozenNames.length && !/\bfollowTrainNo\s*\(|\brecordRide\s*\(/.test(officialSources);
  return { pass, frozen: `${frozen.length}/${frozenNames.length}`, sameTargetCalls, legacyInlineReaders,
    multiHitBranches, actualPlateHitbox: /halfW/.test(hits), deterministicHitSort: /\.sort\(/.test(hits) };
}
const IDENTITY_SOURCE = identitySourceAudit();
function integrationSourceAudit(source = INDEX) {
  const drawFreq = extractFunction(source, 'drawFreq'), drawDeco = extractFunction(source, 'drawDeco');
  const count = extractFunction(source, 'updateCount'), poll = extractFunction(source, 'pollTrtcLive');
  const renderer = extractFunction(source, 'drawTrtcOfficialVehicle');
  const roster = {
    drawFreq: /official !== null/.test(drawFreq) && /drawTrtcOfficialVehicle/.test(drawFreq),
    drawDeco: /official !== null/.test(drawDeco) && /drawTrtcOfficialVehicle/.test(drawDeco),
    count: /official !== null\) n \+= official\.length/.test(count),
    poll: /applyTrtcOfficialRoster\(d\.boardPos\)/.test(poll) &&
      /trtcOfficialRosterOutage\('fetch-error'\)/.test(poll),
  };
  const glyph = /trtcOfficialVehicleGlyph\(item\.officialNo\)/.test(renderer) &&
    /glyph\.kind === 'tag'/.test(renderer) && /else drawDot\(cp, ln\.color\)/.test(renderer);
  return { rosterPass: Object.values(roster).every(Boolean), glyphPass: glyph, roster, glyph };
}
const INTEGRATION_SOURCE = integrationSourceAudit();

function hitRuntime(functionSource = extractFunction(INDEX, 'freqTrainsAt'), search = '?officialroster=1', hitsOverride = null) {
  const bundle = `${extractFunction(INDEX, 'trtcOfficialRosterEnabled')}
    ${extractConst(INDEX, 'OFFICIAL_ROSTER_ENABLED')}
    ${functionSource}
    globalThis.__run = cp => freqTrainsAt(cp);`;
  compileGuard(bundle, 'hit-runtime');
  const line = { id: 'BL' }, stateValue = { _freqHits: hitsOverride || [
    { x: 101, y: 100, halfW: 20, halfH: 8, ln: line, vehicleId: 'v-b', officialNo: 'B' },
    { x: 103, y: 100, halfW: 20, halfH: 8, ln: line, vehicleId: 'v-a', officialNo: 'A' },
  ] };
  const context = { URLSearchParams, location: { search }, state: stateValue, Math, String, Number };
  vm.createContext(context); vm.runInContext(bundle, context);
  return context.__run({ x: 102, y: 100 });
}
function followRuntime(functionSource = extractFunction(INDEX, 'trtcOfficialFollowRecord')) {
  // 🔴 trtcOfficialFollowRecord 現在要過時光機把關。這裡刻意「帶進真的 trtcOfficialRosterLive
  // 原始碼、只把葉子述詞 trtcOfficialBoardRealNow 做成可控旗標」——不要整顆 stub 成 true，
  // 否則把關被拆掉時這支照樣綠（心得：stub 前提會過期／判準要打在受測物本身）。
  const bundle = `${extractFunction(INDEX, 'trtcOfficialRosterActive')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_MAX_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC')}
    const OFFICIAL_ROSTER_ENABLED = true;
    let __realNow = true;
    function trtcOfficialBoardRealNow() { return __realNow; }
    ${extractFunction(INDEX, 'trtcOfficialRosterLive')}
    const line = { id: 'BL' };
    function trtcOfficialLineForId(lineId) { return String(lineId) === 'BL' ? line : null; }
    ${functionSource}
    globalThis.__run = () => {
      const follow = { lineId: 'BL', vehicleId: 'stable' };
      state.trtcOfficialRoster = { feedMode:'official', sourceRevision:1000,
        vehicles:[{vehicleId:'stable', line:'BL', arrEpoch:1010}] };
      const first = trtcOfficialFollowRecord(follow, 1005);
      state.trtcOfficialRoster = { feedMode:'official', sourceRevision:1001,
        vehicles:[{vehicleId:'stable', line:'BL', arrEpoch:1020}] };
      const refreshed = trtcOfficialFollowRecord(follow, 1005);
      state.trtcOfficialRoster = { feedMode:'official', sourceRevision:1002, vehicles:[] };
      const gone = trtcOfficialFollowRecord(follow, 1005);
      // 時鐘離開「現在」時，跟隨也必須交還班表（同一份資料、只翻這顆旗標）。
      state.trtcOfficialRoster = { feedMode:'official', sourceRevision:1000,
        vehicles:[{vehicleId:'stable', line:'BL', arrEpoch:1010}] };
      __realNow = false;
      const travelled = trtcOfficialFollowRecord(follow, 1005);
      __realNow = true;
      const backAtNow = trtcOfficialFollowRecord(follow, 1005);
      return { first:first && first.vehicle.arrEpoch, refreshed:refreshed && refreshed.vehicle.arrEpoch,
        gone:gone == null, gated:travelled == null, backAtNow:backAtNow != null };
    };`;
  compileGuard(bundle, 'follow-runtime');
  const context = { state: {}, Date, Math, Number, String, Array };
  vm.createContext(context); vm.runInContext(bundle, context);
  return context.__run();
}
function identityRuntimeAudit(hitSource, followSource) {
  const officialHits = hitRuntime(hitSource, '?officialroster=1');
  // 旗標預設已開，「舊行為」要明寫 ?officialroster=0 才驅動得出來（空字串現在＝開）。
  const legacyHits = hitRuntime(hitSource, '?officialroster=0');
  const otherLine = { id:'A', _sys:'tymc' }, otherHits = [
    { x:101, y:100, ln:otherLine, k:1 }, { x:103, y:100, ln:otherLine, k:2 },
    // 同一幅全台畫面遠處有北捷 official，不得影響這個 cp 的機捷 legacy 命中。
    { x:300, y:300, halfW:20, halfH:8, ln:{id:'BL'}, vehicleId:'far-official' },
  ];
  const otherWithFlag = hitRuntime(hitSource, '?officialroster=1', otherHits);
  const otherWithoutFlag = hitRuntime(hitSource, '?officialroster=0', otherHits);
  const follow = followRuntime(followSource);
  return { pass: officialHits.length === 2 && officialHits.map(item => item.vehicleId).join(',') === 'v-a,v-b' &&
      legacyHits.length === 1 && legacyHits[0].vehicleId == null &&
      JSON.stringify(otherWithFlag) === JSON.stringify(otherWithoutFlag) && otherWithFlag.length === 1 &&
      follow.first === 1010 && follow.refreshed === 1020 && follow.gone &&
      follow.gated && follow.backAtNow,
    officialHits: officialHits.map(item => item.vehicleId), legacyHits: legacyHits.length,
    otherSystemFlagOn:otherWithFlag.length, otherSystemFlagOff:otherWithoutFlag.length, follow };
}
const IDENTITY_RUNTIME = identityRuntimeAudit();
function flagOffSourceAudit() {
  const hits = extractFunction(INDEX, 'freqTrainsAt');
  const oldHits = extractFunction(BASE_INDEX, 'freqTrainAt');
  const nearestBranch = /const officialHere = source\.some\(hit => hit && hit\.vehicleId != null && contains\(hit\)\)/.test(hits) &&
    /if \(!OFFICIAL_ROSTER_ENABLED \|\| !officialHere\)/.test(hits) &&
    /let best = null, bd = 18;/.test(hits) && /return best \? \[\{ ln: best\.ln/.test(hits);
  const oldNearestContract = /let best = null, bd = 18;/.test(oldHits) &&
    /if \(d < bd\) \{ bd = d; best = h; \}/.test(oldHits);
  const changedFrozenNames = ['recordRide', 'followTrainNo', 'showFollowPanel', 'tripSysCode',
    'tripSysId', 'buildTripUrl', 'parseTripParam', 'applyTripLink'].filter(name =>
    extractFunction(INDEX, name) !== extractFunction(BASE_INDEX, name));
  return { pass: nearestBranch && oldNearestContract && changedFrozenNames.length === 0,
    nearestBranch, oldNearestContract, changedFrozenNames };
}
const FLAG_OFF_SOURCE = flagOffSourceAudit();
function flagOffRuntimeAudit(functionSource = extractFunction(INDEX, 'freqTrainsAt')) {
  const oldSource = extractFunction(BASE_INDEX, 'freqTrainAt')
    .replace('function freqTrainAt(', 'function baselineFreqTrainAt(');
  const bundle = `const OFFICIAL_ROSTER_ENABLED = false;\n${functionSource}\n${oldSource}\n` +
    `globalThis.__run = points => points.map(cp => {
      const actual = freqTrainsAt(cp)[0] || null, expected = baselineFreqTrainAt(cp);
      const shape = item => item ? { line:item.ln && item.ln.id, k:item.k == null ? null : item.k,
        tr:item.tr && item.tr.id || null, dist:Number(item.dist.toFixed(9)) } : null;
      return { actual:shape(actual), expected:shape(expected) };
    });`;
  compileGuard(bundle, 'flag-off-runtime');
  const lines = [{ id:'BL' }, { id:'R' }], trips = [{ id:'t1' }, { id:'t2' }];
  const stateValue = { _freqHits: [
    { x:90, y:100, ln:lines[0], tr:trips[0] },
    { x:110, y:100, ln:lines[1], tr:trips[1] },
    // 旗標關閉時即使誤混入官方寬牌 hit，仍必須遵守舊 18px 半徑，不得改成矩形多選。
    { x:150, y:100, halfW:40, halfH:8, ln:lines[0], vehicleId:'official-wide' },
  ] };
  const points = [];
  for (let x = 70; x < 170; x += 5) for (let y = 90; y <= 110; y += 5) points.push({ x, y });
  const context = { state:stateValue, Math, Number, String, Array };
  vm.createContext(context); vm.runInContext(bundle, context);
  const samples = context.__run(points), mismatches = samples.filter(sample =>
    JSON.stringify(sample.actual) !== JSON.stringify(sample.expected));
  return { pass:mismatches.length === 0, samples:samples.length,
    matched:samples.length - mismatches.length, mismatches:mismatches.slice(0, 3) };
}
const FLAG_OFF_RUNTIME = flagOffRuntimeAudit();

function evaluateGates(api) {
  const render = (line, board = BOARD, now = NOW, enabled = true) =>
    api.trtcOfficialRenderItems(line, board, now, enabled);
  const bl = render(BL), xbt = render(XBT), all = [...(bl || []), ...(xbt || [])];
  const fakeAnchor = { line: 'BL', dir: 2, from: 2, to: 3, arrEpoch: 1050 };
  const boardWithFakeAnchor = { ...BOARD, rows: [fakeAnchor] };
  const pulled = { ...BOARD, vehicles: BOARD.vehicles.filter(vehicle => vehicle.vehicleId !== 'v-anon') };
  const active = api.trtcOfficialRosterActive;
  const a = FLAG_OFF_SOURCE.pass && FLAG_OFF_RUNTIME.pass && INTEGRATION_SOURCE.rosterPass && INGEST_RUNTIME.pass &&
    PEAK_FRONTEND.pass &&
    // 2026-08-13 上線後預設開啟：不帶參數＝開，只有明寫 ?officialroster=0 才退回班表路徑。
    // 三個都要驗——少了中間那條，把預設改回關也不會轉紅。
    api.trtcOfficialRosterEnabled('?officialroster=1') && api.trtcOfficialRosterEnabled('') &&
    !api.trtcOfficialRosterEnabled('?officialroster=0') &&
    active(BOARD, true, NOW) && !active({ ...BOARD, feedMode: 'outage' }, true, NOW) &&
    active(BOARD, true, BOARD.sourceRevision + api.maxAge) &&
    !active(BOARD, true, BOARD.sourceRevision + api.maxAge + 1 / 1000) && !active(BOARD, false, NOW) &&
    all.length === VEHICLES.length &&
    [...(render(BL, boardWithFakeAnchor) || []), ...(render(XBT, boardWithFakeAnchor) || [])].length === VEHICLES.length &&
    [...(render(BL, pulled) || []), ...(render(XBT, pulled) || [])].length === VEHICLES.length - 1 &&
    render(BL, { ...BOARD, feedMode: 'outage' }) === null && render(BL, BOARD, NOW, false) === null;

  const forward = VEHICLES.find(vehicle => vehicle.vehicleId === 'v-number');
  const reverse = VEHICLES.find(vehicle => vehicle.vehicleId === 'v-reverse');
  const dep = api.trtcOfficialVehiclePosition(BL, forward, forward.arrEpoch - forward.run);
  const mid = api.trtcOfficialVehiclePosition(BL, forward, forward.arrEpoch - forward.run / 2);
  const at = api.trtcOfficialVehiclePosition(BL, forward, forward.arrEpoch);
  const reverseAt = api.trtcOfficialVehiclePosition(BL, reverse, reverse.arrEpoch);
  const changedScheduleLine = { ...BL, _tt: [['完全不同']], runs: new Map([['0>1', 9999]]) };
  const atChangedSchedule = api.trtcOfficialVehiclePosition(changedScheduleLine, forward, forward.arrEpoch);
  const zeroDurationRejected = api.trtcOfficialVehiclePosition(BL,
    { ...forward, depEpoch:forward.arrEpoch }, forward.arrEpoch) == null;
  const b = dep && dep.lat === BL.stations[0].lat && dep.lon === BL.stations[0].lon && dep.fraction === 0 &&
    mid && Math.abs(mid.fraction - .5) < 1e-12 &&
    at && at.lat === BL.stations[1].lat && at.lon === BL.stations[1].lon && at.fraction === 1 && at.atStation &&
    reverseAt && reverseAt.lat === BL.stations[2].lat && reverseAt.lon === BL.stations[2].lon && reverseAt.fraction === 1 &&
    atChangedSchedule && atChangedSchedule.lat === at.lat && atChangedSchedule.lon === at.lon && zeroDurationRejected;

  const numbered = all.find(item => item.vehicleId === 'v-number');
  const anonymous = all.find(item => item.vehicleId === 'v-anon');
  const anonymousInfo = api.trtcOfficialVehicleInfo(BL,
    VEHICLES.find(vehicle => vehicle.vehicleId === 'v-anon'), NOW);
  const numberedInfo = api.trtcOfficialVehicleInfo(BL, forward, NOW);
  const numberedGlyph = api.trtcOfficialVehicleGlyph(numbered && numbered.officialNo);
  const anonymousGlyph = api.trtcOfficialVehicleGlyph(anonymous && anonymous.officialNo);
  const c = INTEGRATION_SOURCE.glyphPass && numbered && numbered.officialNo === 'A12' &&
    numberedGlyph.kind === 'tag' && numberedGlyph.label === 'A12' &&
    anonymous && anonymous.officialNo === '' && anonymousInfo.pos && anonymousInfo.officialNo === '' &&
    anonymousGlyph.kind === 'dot' && anonymousGlyph.label === '' &&
    numberedInfo.pos && numberedInfo.officialNo === 'A12';

  const extension = all.find(item => item.vehicleId === 'v-extension');
  const origin = all.find(item => item.vehicleId === 'v-origin');
  const shuttle = all.find(item => item.vehicleId === 'v-xbt-stop');
  const d = extension && extension.extension && extension.pos &&
    origin && origin.pos && origin.pos.lat === BL.stations[0].lat && origin.pos.lon === BL.stations[0].lon &&
    shuttle && shuttle.pos && shuttle.pos.lat === XBT.stations[0].lat && shuttle.pos.lon === XBT.stations[0].lon;

  const lnOther = { ...BL, id: 'R' }, tr = {}, trOther = {};
  const e = IDENTITY_SOURCE.pass && IDENTITY_RUNTIME.pass &&
    api.trtcOfficialSameTarget({ ln: BL, lineId: 'BL', vehicleId: 'v-anon' },
      { ln: BL, vehicleId: 'v-anon' }) &&
    !api.trtcOfficialSameTarget({ ln: BL, lineId: 'BL', vehicleId: 'v-anon' },
      { ln: BL, vehicleId: 'v-number' }) &&
    !api.trtcOfficialSameTarget({ ln: BL, lineId: 'BL', vehicleId: 'v-anon' },
      { ln: lnOther, vehicleId: 'v-anon' }) &&
    api.trtcOfficialSameTarget({ ln: BL, tr }, { ln: BL, tr }) &&
    !api.trtcOfficialSameTarget({ ln: BL, tr }, { ln: BL, tr: trOther }) &&
    api.trtcOfficialSameTarget({ ln: BL, k: 3 }, { ln: BL, k: 3 }) &&
    !api.trtcOfficialSameTarget({ ln: BL, k: 3 }, { ln: BL, k: 4 });

  const coast = coastAudit(api);
  return { gates: { A: !!a, B: !!b, C: !!c, D: !!d, E: !!e, G: coast.pass }, coast, metrics: {
    rosterVehicles: VEHICLES.length, rendered: all.length, numbered: all.filter(item => item.officialNo).length,
    anonymous: all.filter(item => !item.officialNo).length, extensions: all.filter(item => item.extension).length,
    xbtStopped: shuttle ? 1 : 0, originStopped: origin ? 1 : 0, ingest:INGEST_RUNTIME,
    peakFrontend:PEAK_FRONTEND,
  } };
}

const baselineApi = buildProductApi();
const PEAK_FRONTEND = peakFrontendAudit(baselineApi);
const baseline = evaluateGates(baselineApi);
console.log('\n【A–E 產品真函式】');
check(baseline.gates.A, 'A 名冊翻面／旗標關閉／outage／age gate／正反對照',
  JSON.stringify(baseline.metrics));
check(FLAG_OFF_SOURCE.pass, 'A 旗標關閉保留舊 18px nearest-one 命中與身分邊界',
  JSON.stringify(FLAG_OFF_SOURCE));
check(FLAG_OFF_RUNTIME.pass, 'A 旗標關閉與基底逐點命中結果一致', JSON.stringify(FLAG_OFF_RUNTIME));
check(INGEST_RUNTIME.pass, 'A malformed 整包退場／sourceRevision high-water 不復活',
  JSON.stringify(INGEST_RUNTIME));
check(PEAK_FRONTEND.pass, 'A 尖峰 80 輪後端 vehicles 全數通過前端 schema 且全數可畫',
  JSON.stringify(PEAK_FRONTEND));
check(baseline.gates.B, 'B 兩方向公式皆在 arrEpoch bit-exact 到 to（可視畫格尚待 F 真瀏覽器驗收）');
check(baseline.gates.C, 'C officialNo 只是選配標籤，無號車仍在名冊',
  JSON.stringify({ numbered: baseline.metrics.numbered, anonymous: baseline.metrics.anonymous }));
check(baseline.gates.D, 'D extension／兩站接駁線停站車／起點停站車皆有畫',
  JSON.stringify({ extensions: baseline.metrics.extensions, xbtStopped: baseline.metrics.xbtStopped,
    originStopped: baseline.metrics.originStopped }));
check(baseline.gates.G, 'G 訊號後續推：到站→停站→出發→準時到下一站→終點停住，全程不倒退不消失',
  JSON.stringify({ coastMaxSec: baselineApi.coastMax, failed: baseline.coast.failed }));
check(baseline.gates.E, 'E 第三形 vehicleId+line 與舊 {ln,tr}/{ln,k} 互不混用');
check(IDENTITY_SOURCE.pass, 'E 跟隨／完乘／行程分享／跨系統撞號／疊車命中五項身分契約',
  JSON.stringify(IDENTITY_SOURCE));

const mutantApis = {
  'M-A1 feedMode 反轉': mutationApi('trtcOfficialRosterActive',
    "boardPos.feedMode === 'official'", "boardPos.feedMode !== 'official'", 'M-A1'),
  'M-A2 age gate 失效': mutationApi('trtcOfficialRosterActive',
    'now - revision <= TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC', 'true', 'M-A2'),
  'M-B arrEpoch 延後 30 秒才到站': mutationApi('trtcOfficialVehiclePosition',
    'if (now >= arrEpoch) return', 'if (now >= arrEpoch + 30) return', 'M-B'),
  'M-C 沒車號就不畫': mutationApi('trtcOfficialRenderItems',
    '.filter(item => item.vehicleId && item.pos);',
    '.filter(item => item.vehicleId && item.pos && item.officialNo);', 'M-C'),
  'M-C2 無號車錯畫成空白車牌': mutationApi('trtcOfficialVehicleGlyph',
    "return label ? { kind: 'tag', label } : { kind: 'dot', label: '' };",
    "return { kind: 'tag', label };", 'M-C2'),
  'M-D1 濾掉 extension': mutationApi('trtcOfficialRenderItems',
    '.filter(item => item.vehicleId && item.pos);',
    '.filter(item => item.vehicleId && item.pos && !item.extension);', 'M-D1'),
  'M-D2 濾掉兩站接駁線': mutationApi('trtcOfficialRosterForLine',
    'vehicle && String(vehicle.line) === String(lineId)',
    "vehicle && !String(vehicle.line).endsWith('_XBT') && String(vehicle.line) === String(lineId)", 'M-D2'),
  'M-D3 濾掉起點停站車': mutationApi('trtcOfficialVehiclePosition',
    'if (from === to) return { lat: A.lat, lon: A.lon, fraction: 1, atStation: true };',
    "if (from === to && ln.id === 'BL') return null;\n  if (from === to) return { lat: A.lat, lon: A.lon, fraction: 1, atStation: true };", 'M-D3'),
  'M-G1 續推卡在原站不前進': mutationApi('trtcOfficialCoastPosition',
    'const done = Math.floor(elapsed / cycle)', 'const done = 0', 'M-G1'),
  'M-G2 續推衝過終點站': mutationApi('trtcOfficialCoastPosition',
    'if (done >= legsLeft)', 'if (false)', 'M-G2'),
  'M-G3 續推沒有上限': mutationApi('trtcOfficialCoastPosition',
    'if (elapsed > TRTC_OFFICIAL_COAST_MAX_SEC) return null;', 'if (false) return null;', 'M-G3'),
  'M-G4 續推停站時間可為負': mutationApi('trtcOfficialCoastCycle',
    'Math.min(Math.max(cycle - run, TRTC_OFFICIAL_COAST_DWELL_MIN_SEC), cycle / 2)',
    'cycle - run', 'M-G4'),
  'M-E 第三形忽略 vehicleId': mutationApi('trtcOfficialSameTarget',
    "String(follow.vehicleId) === String(hit.vehicleId || '')", 'String(follow.vehicleId) === String(follow.vehicleId)', 'M-E'),
};
console.log('\n【A–E mutation matrix】');
for (const [name, api] of Object.entries(mutantApis)) {
  mutationCheck(name, MUTATION_PLAN[name], baseline.gates, evaluateGates(api).gates);
}
const mA3 = mutationIndexFunction('drawFreq', 'if (official !== null) {', 'if (false) {', 'M-A3');
const mA3Audit = integrationSourceAudit(mA3.source);
mutationCheck('M-A3 畫車主迴圈繞過官方名冊', MUTATION_PLAN['M-A3 畫車主迴圈繞過官方名冊'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA3Audit.rosterPass });
const mA4 = mutationIndexFunction('freqTrainsAt',
  'if (!OFFICIAL_ROSTER_ENABLED || !officialHere) {',
  'if (false) {', 'M-A4');
const mA4Audit = flagOffRuntimeAudit(mA4.fn);
mutationCheck('M-A4 旗標關閉改走官方多選命中', MUTATION_PLAN['M-A4 旗標關閉改走官方多選命中'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA4Audit.pass });
const mA5 = mutationIngestApi('trtcOfficialRosterPayloadValid',
  '!Number.isFinite(arr) || !geometryValid ||', '!Number.isFinite(arr) || false ||', 'M-A5');
const mA5Audit = ingestRuntimeAudit(mA5);
mutationCheck('M-A5 略過逐車幾何邊界', MUTATION_PLAN['M-A5 略過逐車幾何邊界'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA5Audit.pass });
const mA6 = mutationIngestApi('applyTrtcOfficialRoster',
  'if (highWater != null && Number.isFinite(Number(highWater)) && revision < Number(highWater))',
  'if (false)', 'M-A6');
const mA6Audit = ingestRuntimeAudit(mA6);
mutationCheck('M-A6 略過版本 high-water', MUTATION_PLAN['M-A6 略過版本 high-water'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA6Audit.pass });
const mA7 = mutationIngestApi('trtcOfficialRosterPayloadValid',
  '(from === to ? dep <= arr : dep < arr)', '(from === to ? dep <= arr : dep <= arr)', 'M-A7');
const mA7Audit = ingestRuntimeAudit(mA7);
mutationCheck('M-A7 允許移動列零秒時間軸', MUTATION_PLAN['M-A7 允許移動列零秒時間軸'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA7Audit.pass });
const mA8 = mutationIndexFunction('freqTrainsAt',
  'const officialHere = source.some(hit => hit && hit.vehicleId != null && contains(hit));',
  'const officialHere = source.some(hit => hit && hit.vehicleId != null);', 'M-A8');
const mA8Audit = identityRuntimeAudit(mA8.fn, undefined);
mutationCheck('M-A8 官方旗標波及非北捷命中', MUTATION_PLAN['M-A8 官方旗標波及非北捷命中'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA8Audit.pass });
const mA9 = mutationIngestApi('trtcOfficialRosterPayloadValid',
  'const scalarValid = Array.isArray(rawNumbers) && rawNumbers.every(value =>\n      typeof value === \'number\' && Number.isFinite(value));',
  'const scalarValid = true;', 'M-A9');
const mA9Audit = ingestRuntimeAudit(mA9);
mutationCheck('M-A9 允許 null 冒充數值', MUTATION_PLAN['M-A9 允許 null 冒充數值'],
  baseline.gates, { ...baseline.gates, A: baseline.gates.A && mA9Audit.pass });
const mB2 = mutationApi('trtcOfficialVehiclePosition',
  'if (!(depEpoch < arrEpoch)) return null;', 'if (!(depEpoch <= arrEpoch)) return null;', 'M-B2');
mutationCheck('M-B2 位置公式接受零秒時間軸', MUTATION_PLAN['M-B2 位置公式接受零秒時間軸'],
  baseline.gates, evaluateGates(mB2).gates);
const mC3 = mutationIndexFunction('drawTrtcOfficialVehicle',
  'const glyph = trtcOfficialVehicleGlyph(item.officialNo), label = glyph.label;',
  "const glyph = { kind: 'tag', label: String(item.officialNo || '') }, label = glyph.label;", 'M-C3');
const mC3Audit = integrationSourceAudit(mC3.source);
mutationCheck('M-C3 renderer 不用 glyph 分流', MUTATION_PLAN['M-C3 renderer 不用 glyph 分流'],
  baseline.gates, { ...baseline.gates, C: baseline.gates.C && mC3Audit.glyphPass });
const mE2 = mutationIndexFunction('trtcOfficialFollowRecord',
  'String(item.vehicleId) === String(follow.vehicleId)', 'item === follow.vehicle', 'M-E2');
const mE2Audit = identityRuntimeAudit(undefined, mE2.fn);
mutationCheck('M-E2 snapshot 刷新改用物件參照', MUTATION_PLAN['M-E2 snapshot 刷新改用物件參照'],
  baseline.gates, { ...baseline.gates, E: baseline.gates.E && mE2Audit.pass });
const mE3 = mutationIndexFunction('freqTrainsAt', 'return hits.sort(', 'return hits.slice(0, 1).sort(', 'M-E3');
const mE3Audit = identityRuntimeAudit(mE3.fn, undefined);
mutationCheck('M-E3 疊車只留陣列第一台', MUTATION_PLAN['M-E3 疊車只留陣列第一台'],
  baseline.gates, { ...baseline.gates, E: baseline.gates.E && mE3Audit.pass });
// 使用者裁示②（2026-08-13）：時鐘離開「現在」時官方名冊整體退場。這一發證明 E 真的在守它，
// 而不是靠 sandbox 把 trtcOfficialBoardRealNow stub 成 true 混過去。
const mE4 = mutationIndexFunction('trtcOfficialFollowRecord',
  '!trtcOfficialRosterLive(nowEpoch)', 'false', 'M-E4');
const mE4Audit = identityRuntimeAudit(undefined, mE4.fn);
mutationCheck('M-E4 跟隨路徑拿掉時光機把關', MUTATION_PLAN['M-E4 跟隨路徑拿掉時光機把關'],
  baseline.gates, { ...baseline.gates, E: baseline.gates.E && mE4Audit.pass });

function makeStaticServer() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/thsr-schedule') {
        return res.end(fs.readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
      }
      if (url.pathname === '/api/trtc-live') {
        const at = Date.now() / 1000;
        const vehicles = [
          { vehicleId: 'browser-number', line: 'BL', dir: 2, from: 0, to: 1, dest: 22,
            run: 60, arrEpoch: at + 30, officialNo: 'A12', terminal: false, extension: false },
          { vehicleId: 'browser-anon', line: 'BL', dir: 1, from: 22, to: 21, dest: 0,
            run: 60, arrEpoch: at + 30, officialNo: null, terminal: false, extension: false },
          { vehicleId: 'browser-extension', line: 'BL', dir: 2, from: 21, to: 22, dest: 22,
            run: 60, depEpoch: at, arrEpoch: at + 60, officialNo: null, terminal: false, extension: true },
          { vehicleId: 'browser-xbt', line: 'G_XBT', dir: 2, from: 0, to: 0, dest: 1,
            run: 0, arrEpoch: at + 300, officialNo: null, terminal: true, extension: false },
        ];
        return res.end(JSON.stringify({ src: 'trtc', board: [], boardPos: {
          at, sourceRevision: at, rows: [], trips: [], vehicles,
          extensions: vehicles.filter(vehicle => vehicle.extension), feedMode: 'official',
        } }));
      }
      return res.end('{}');
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!path.resolve(file).startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
}

function controlsOverlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 1 &&
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 1;
}

async function browserMatrix(baseUrl) {
  const rows = [];
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [360, 375, 414, 768]) {
        const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 812 },
          isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
        await context.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(String(error.message || error)));
        await page.goto(`${baseUrl}?officialroster=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
        await page.waitForFunction(() => state.trtcOfficialRoster && state.trtcOfficialRoster.feedMode === 'official',
          null, { timeout: 30000 });
        const frameDeadline = await page.evaluate(async () => {
          const vehicle = state.trtcOfficialRoster.vehicles.find(item => item.vehicleId === 'browser-number');
          const ln = (state.mode === 'sched' ? state.decoLines : state.lines).find(item => item.id === 'BL');
          // 把同一筆官方車的 deadline 調到約 120ms 後，連續取每個真 rAF畫格。
          // before 必須尚未到站；第一個 now>=arrEpoch 的 frame 必須 bit-exact 在 to。
          const now = Date.now() / 1000, arrEpoch = now + .12;
          vehicle.run = .12; vehicle.arrEpoch = arrEpoch; delete vehicle.depEpoch;
          let before = null, after = null, frames = 0;
          await new Promise(resolve => {
            const sample = () => {
              const epoch = Date.now() / 1000, pos = trtcOfficialVehiclePosition(ln, vehicle, epoch); frames++;
              if (epoch < arrEpoch) before = { epoch, fraction: pos && pos.fraction };
              else { after = { epoch, fraction: pos && pos.fraction,
                exact: !!pos && pos.lat === ln.stations[vehicle.to].lat && pos.lon === ln.stations[vehicle.to].lon };
                resolve(); return; }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          return { frames, arrEpoch, before, after, delaySec: after.epoch - arrEpoch,
            frameSec: before ? after.epoch - before.epoch : null };
        });
        // .leaflet-control-zoom 在 @media (max-width:400px) 內是 display:none（刻意的設計，
        // index.html:2552）⇒ 360/375 這兩欄不能拿它當觸控標的，否則 tap 必然逾時。
        const zoomVisible = await page.evaluate(() => {
          const el = document.querySelector('.leaflet-control-zoom-in');
          return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 1;
        });
        let beforeZoom = null, afterZoom = null;
        if (zoomVisible) {
          beforeZoom = await page.evaluate(() => map.getZoom());
          await page.locator('.leaflet-control-zoom-in').tap();
          await page.waitForTimeout(50);
          afterZoom = await page.evaluate(() => map.getZoom());
        }
        const stateScans = await page.evaluate(() => {
          const visible = element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
              style.pointerEvents !== 'none' && Number(style.opacity) > .02 && rect.width > 1 && rect.height > 1;
          };
          const selector = 'button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[role=button],.leaflet-control-zoom a,.toolbtn,.toggle';
          const body = document.body, alert = document.getElementById('alertBanner'),
            alertChip = document.getElementById('alertChip'), sheet = document.getElementById('favPanel');
          const initial = { className:body.className, alertHidden:alert && alert.hidden,
            alertText:alert && alert.textContent, chipHidden:alertChip && alertChip.hidden,
            sheetHidden:sheet && sheet.hidden };
          const reset = () => {
            body.className = initial.className;
            if (alert) { alert.hidden = initial.alertHidden; alert.textContent = initial.alertText; }
            if (alertChip) alertChip.hidden = initial.chipHidden;
            if (sheet) sheet.hidden = initial.sheetHidden;
          };
          const capture = name => {
            const nodes = [...new Set(document.querySelectorAll(selector))].filter(visible);
            const controls = nodes.map((element, index) => {
              const r = element.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return { id: element.id || element.getAttribute('aria-label') || `${element.tagName}-${index}`,
                left:r.left, right:r.right, top:r.top, bottom:r.bottom,
                hit:!!(hit && (hit === element || element.contains(hit))) };
            });
            const collisions = [];
            for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
              if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
              // 疊在遮罩上方的面板與底下的控件本來就會幾何相交，那是刻意的層疊不是撞版。
              const a = controls[i], b = controls[j];
              const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 1 &&
                Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 1;
              if (overlap) collisions.push([a.id, b.id]);
            }
            return { name, controls, collisions, scrollWidth:document.documentElement.scrollWidth,
              clientWidth:document.documentElement.clientWidth };
          };
          const scans = [];
          reset(); scans.push(capture('auto'));
          reset(); body.classList.add('fs'); scans.push(capture('fullscreen'));
          reset(); if (alert) { alert.hidden = false; alert.textContent = '營運通阻公告測試'; }
          if (alertChip) alertChip.hidden = false; scans.push(capture('banner'));
          reset(); body.classList.add('tools-open'); scans.push(capture('drawer'));
          reset(); body.classList.add('sheet-open'); if (sheet) sheet.hidden = false; scans.push(capture('sheet'));
          reset();
          return { enabled:typeof OFFICIAL_ROSTER_ENABLED !== 'undefined' && OFFICIAL_ROSTER_ENABLED === true,
            scans, rosterVehicles:state.trtcOfficialRoster.vehicles.length,
            renderedVehicles:[...new Map(((state.mode === 'sched' ? state.decoLines : state.lines) || [])
              .filter(isTrtcBoardLine).map(line => [line.id, line])).values()]
              .reduce((sum, line) => sum + (trtcOfficialRenderItems(line, state.trtcOfficialRoster,
                Date.now() / 1000, true) || []).length, 0) };
        });
        const scan = { enabled:stateScans.enabled, rosterVehicles:stateScans.rosterVehicles,
          renderedVehicles:stateScans.renderedVehicles, ...stateScans.scans[0] };
        // F mutation：在 zoom-in 正中央蓋一顆可互動按鈕，原控制的 elementFromPoint 必須立刻失敗。
        const mutation = await page.evaluate(() => {
          const visible = el => { const s = getComputedStyle(el), b = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 1 && b.height > 1; };
          // 窄寬度沒有 zoom 鈕，改拿當下真的可見的第一顆互動控件當遮擋標的。
          const target = [document.querySelector('.leaflet-control-zoom-in'),
            ...document.querySelectorAll('button:not([disabled]),[role=button],.toolbtn')]
            .find(el => el && visible(el));
          const r = target.getBoundingClientRect();
          const cover = document.createElement('button'); cover.id = 'official-roster-f-mutant'; cover.textContent = '×';
          Object.assign(cover.style, { position: 'fixed', zIndex: '999999', left: `${r.left}px`, top: `${r.top}px`,
            width: `${r.width}px`, height: `${r.height}px` });
          document.body.appendChild(cover);
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const caught = !(hit === target || target.contains(hit)); cover.remove(); return caught;
        });
        await page.goto(`${baseUrl}?officialroster=0`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
        const flagOff = await page.evaluate(() => ({
          enabled: typeof OFFICIAL_ROSTER_ENABLED !== 'undefined' && OFFICIAL_ROSTER_ENABLED === true,
          roster: state.trtcOfficialRoster,
          countText: document.getElementById('count').textContent,
        }));
        rows.push({ engine, width, errors, beforeZoom, afterZoom, zoomVisible, scan, stateScans:stateScans.scans,
          mutation, flagOff, frameDeadline });
        await context.close();
      }
    } finally { await browser.close(); }
  }
  return rows;
}

console.log('\n【F 雙引擎手機矩陣】');
let browserFailure = null;
const server = makeStaticServer();
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  result.browser = await browserMatrix(baseUrl);
  for (const row of result.browser) {
    // 🔴 合成的 drawer 態（body.classList.add('tools-open')）不納入命中／相交斷言：抽屜是刻意疊在
    // 地圖上的面板＋遮罩，底下的控件本來就點不到、幾何也本來就相交。這不是本批造成的——基底樹
    // 008d5d6 用同一段掃描量到逐項相同的數字（375px misses=27/collisions=15、768px 24/14），
    // 證據見 tmp/diag_drawer_control.mjs。留在 stateScans 裡供人工檢視，但不當成 gate。
    const SCAN_GATED = scan => scan.name !== 'drawer';
    const hitFailures = row.stateScans.filter(SCAN_GATED)
      .flatMap(scan => scan.controls.filter(control => !control.hit)
        .map(control => `${scan.name}:${control.id}`));
    const collisions = row.stateScans.filter(SCAN_GATED)
      .flatMap(scan => scan.collisions.map(pair => [scan.name, ...pair]));
    const overflows = row.stateScans.filter(scan => scan.scrollWidth > scan.clientWidth)
      .map(scan => ({ name:scan.name, scrollWidth:scan.scrollWidth, clientWidth:scan.clientWidth }));
    check(row.scan.enabled && row.scan.rosterVehicles === 4 && row.scan.renderedVehicles === 4 &&
        !row.flagOff.enabled && row.flagOff.roster == null && row.errors.length === 0,
      `F ${row.engine} ${row.width}px：旗標開時 4/4 官方車可畫／旗標關時未注入官方名冊／零 pageerror`,
      JSON.stringify({ enabled: row.scan.enabled, rosterVehicles: row.scan.rosterVehicles,
        renderedVehicles: row.scan.renderedVehicles, flagOff: row.flagOff, errors: row.errors.slice(0, 3) }));
    check(row.frameDeadline.before && row.frameDeadline.after && row.frameDeadline.after.exact &&
        row.frameDeadline.after.fraction === 1 && row.frameDeadline.before.fraction < 1 &&
        row.frameDeadline.delaySec >= 0 && row.frameDeadline.delaySec <= row.frameDeadline.frameSec + .005,
      `B/F ${row.engine} ${row.width}px：連續 rAF 第一個 deadline 畫格 bit-exact 到站`,
      JSON.stringify(row.frameDeadline));
    check(overflows.length === 0 && collisions.length === 0 && row.stateScans.length === 5,
      `F ${row.engine} ${row.width}px：auto／全畫面／橫幅／sheet 零溢出且控件不相交（drawer 合成態見上方註解）`,
      JSON.stringify({ states:row.stateScans.map(scan => `${scan.name}:${scan.controls.length}`),
        overflows:overflows.slice(0, 3), collisions:collisions.slice(0, 5) }));
    // zoom 鈕在 <400px 是設計上隱藏：那兩欄只驗「確實依設計隱藏」，≥400px 才驗真觸控改變 zoom。
    // 判準綁的是「這個寬度該不該看得見」而不是寫死通過，所以 400px 以上被誤藏一樣會轉紅。
    // Leaflet +/- 鈕的父層在手機一律 display:none（index.html:2552 註解「手機改用雙指縮放」，
    // 基底樹亦然）⇒ 期望值由頁面自己決定：看得見才驗 tap 會改 zoom，看不見就不假裝驗過。
    // 官方車的真觸控跟隨由 tmp/verify_roster_indep.mjs 在四個寬度 × 雙引擎全數實點覆蓋。
    const zoomOk = row.zoomVisible ? row.afterZoom > row.beforeZoom : row.beforeZoom === null;
    check(hitFailures.length === 0 && zoomOk,
      `F ${row.engine} ${row.width}px：可觸及控件全數命中／${row.zoomVisible ? '真觸控 tap 改變 zoom' : 'zoom 鈕手機不渲染（雙指縮放）'}`,
      JSON.stringify({ hitFailures: hitFailures.slice(0, 5), zoomVisible: row.zoomVisible,
        beforeZoom: row.beforeZoom, afterZoom: row.afterZoom }));
  }
  const fBase = result.browser.length === 8 && result.browser.every(row => row.scan.enabled &&
    row.scan.rosterVehicles === 4 && row.scan.renderedVehicles === 4 &&
    row.frameDeadline.before && row.frameDeadline.after?.exact && row.frameDeadline.after.fraction === 1 &&
    row.frameDeadline.before.fraction < 1 && row.frameDeadline.delaySec >= 0 &&
    row.frameDeadline.delaySec <= row.frameDeadline.frameSec + .005 &&
    !row.flagOff.enabled && row.flagOff.roster == null && !row.errors.length &&
    row.stateScans.length === 5 && row.stateScans.filter(scan => scan.name !== 'drawer').every(scan =>
      scan.scrollWidth <= scan.clientWidth && scan.collisions.length === 0 &&
      scan.controls.every(control => control.hit)) &&
    (row.zoomVisible ? row.afterZoom > row.beforeZoom : row.beforeZoom === null));
  const fMutantFails = result.browser.length === 8 && result.browser.every(row => row.mutation);
  mutationCheck('M-F 可互動控件上蓋遮擋層', MUTATION_PLAN['M-F 可互動控件上蓋遮擋層'],
    { F: fBase }, { F: fBase && !fMutantFails });
} catch (error) {
  browserFailure = String(error && (error.stack || error));
  failures++;
  result.browserFailure = browserFailure;
  console.error(`❌ F 無法執行（不得假設通過）：${browserFailure}`);
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

result.metrics = { ...baseline.metrics, identity: IDENTITY_SOURCE,
  assertions: result.assertions.length, passed: result.assertions.filter(item => item.pass).length,
  mutations: result.mutations.length, mutationsCaught: result.mutations.filter(item => item.caught).length,
  browserMatrix: `${result.browser.length}/8`, browserFailure };
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
console.log(`\n${failures ? `FAIL ${failures}` : 'PASS'}：A–F official roster frontend；` +
  `斷言 ${result.metrics.passed}/${result.metrics.assertions}；mutation ${result.metrics.mutationsCaught}/${result.metrics.mutations}；` +
  `browser ${result.metrics.browserMatrix}`);
console.log(`證據：${OUTPUT}`);
process.exitCode = failures ? 1 : 0;
