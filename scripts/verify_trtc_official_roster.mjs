#!/usr/bin/env node
// 北捷官方名冊生命週期驗收：倒數出生、同方向沿用 ID、到已知終點收車、反向另生新 ID。
// 純合成測試不打網路、不讀班表；尖峰 replay 只讀已保存的官方語料。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTrtcModel, claimBoardRows, collapseClaims, attachOfficialTimelines } from './trtc_board_ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SOURCE_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const INDEX_PATH = path.join(ROOT, 'index.html');
const PEAK_DIR = path.join(ROOT, 'tmp/binder-fixtures/rounds-peak');
const DAY = '2026-08-13';

function line(stations, segmentSeconds = 60) {
  const runs = new Map();
  for (let i = 0; i + 1 < stations; i++) {
    runs.set(`${i}>${i + 1}`, segmentSeconds);
    runs.set(`${i + 1}>${i}`, segmentSeconds);
  }
  return { stations: Array.from({ length: stations }, (_, i) => ({ name: String(i) })), runs };
}

function fixtureModel(segmentSeconds = 60) {
  return { lines: new Map([
    ['L', line(5, segmentSeconds)],
    ['G_XBT', line(2, segmentSeconds)],
    ['R_XBT', line(2, segmentSeconds)],
  ]) };
}

function row({ line: lineId = 'L', dir, from, to, dest, arrEpoch, no = '', terminal = false, run = 60,
  timeline = null }) {
  return { line: lineId, dir, from, to, dest, arrEpoch, no, terminal, run: terminal ? 0 : run,
    ...(timeline ? { timeline } : {}) };
}

function args(rows, prior, nowEpoch, sourceRevision, model = fixtureModel()) {
  return { model, rows, prior, day: DAY, nowEpoch, sourceRevision };
}

function same(value) { return JSON.stringify(value); }
function byId(state, id) { return state.vehicles.find(vehicle => vehicle.vehicleId === id); }
function uniqueIds(state) {
  const ids = state.vehicles.map(vehicle => vehicle.vehicleId);
  return ids.length === new Set(ids).size;
}

function scenarioDeterminism(reduce) {
  const rows = [
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 1000, terminal: true }),
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 1040, no: '201' }),
    row({ dir: 1, from: 4, to: 3, dest: 0, arrEpoch: 1050, no: '101' }),
    row({ dir: 1, from: 2, to: 1, dest: 0, arrEpoch: 1060 }),
  ];
  const normal = reduce(args(rows, null, 900, 'deterministic'));
  const reversed = reduce(args([...rows].reverse(), null, 900, 'deterministic'));
  return { rows, normal, reversed };
}

function scenarioLifecycle(reduce) {
  const born = reduce(args([
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 1000, terminal: true }),
  ], null, 900, 'life-1'));
  const id = born.vehicles[0].vehicleId;
  const departureCorrected = reduce(args([
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 1005, terminal: true }),
  ], born, 950, 'life-2'));
  const firstStation = reduce(args([
    row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 1065 }),
  ], departureCorrected, 1010, 'life-3'));
  const secondStationAndDestCorrection = reduce(args([
    row({ dir: 2, from: 1, to: 2, dest: 3, arrEpoch: 1125,
      timeline: [{ from: 2, to: 3, depEpoch: 1150, arrEpoch: 1185, terminal: false }] }),
  ], firstStation, 1070, 'life-4'));
  const carried = reduce(args([], secondStationAndDestCorrection, 1179, 'life-5'));
  const completed = reduce(args([], carried, 1185, 'life-6'));
  return { id, born, departureCorrected, firstStation, secondStationAndDestCorrection, carried, completed };
}

function scenarioEtaRollback(reduce) {
  const first = reduce(args([
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 2100 }),
  ], null, 2000, 'rollback-1'));
  const id = first.vehicles[0].vehicleId;
  const correctedBack = reduce(args([
    row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 2130 }),
  ], first, 2015, 'rollback-2'));
  return { id, first, correctedBack };
}

function scenarioLongOfficialInterval(reduce) {
  const first = reduce(args([
    row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 3000 }),
  ], null, 2900, 'long-1'));
  const second = reduce(args([
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 4000, timeline: [
      { from: 2, to: 3, depEpoch: 4500, arrEpoch: 5000, terminal: false },
      { from: 3, to: 4, depEpoch: 5500, arrEpoch: 6000, terminal: false },
    ] }),
  ], first, 3001, 'long-2'));
  const id = second.vehicles[0].vehicleId;
  const silentButEnroute = reduce(args([], second, 3702, 'long-3'));
  const completed = reduce(args([], silentButEnroute, 6000, 'long-4'));
  return { id, second, silentButEnroute, completed };
}

function scenarioNewDepartureAndReverse(reduce) {
  const old = reduce(args([
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 7000, terminal: true, no: '777' }),
  ], null, 6900, 'turn-1'));
  const oldId = old.vehicles[0].vehicleId;
  const oldEnrouteAndNextDeparture = reduce(args([
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 7300, terminal: true, no: '777' }),
  ], old, 7010, 'turn-2'));
  const sameDirectionNew = oldEnrouteAndNextDeparture.vehicles.find(vehicle =>
    vehicle.terminal && vehicle.vehicleId !== oldId);

  const crossDirectionWhileOldActive = reduce(args([
    row({ dir: 1, from: 4, to: 4, dest: 0, arrEpoch: 7350, terminal: true, no: '777' }),
  ], old, 7010, 'turn-3'));
  const reverse = crossDirectionWhileOldActive.vehicles.find(vehicle => vehicle.dir === 1);
  return { oldId, oldEnrouteAndNextDeparture, sameDirectionNew, crossDirectionWhileOldActive, reverse };
}

function scenarioTerminal(reduce) {
  const approaching = reduce(args([
    row({ dir: 2, from: 3, to: 4, dest: 4, arrEpoch: 8050, no: '888' }),
  ], null, 8000, 'terminal-1'));
  const id = approaching.vehicles[0].vehicleId;
  const before = reduce(args([], approaching, 8049, 'terminal-2'));
  const at = reduce(args([], before, 8050, 'terminal-3'));
  const reverse = reduce(args([
    row({ dir: 1, from: 4, to: 4, dest: 0, arrEpoch: 8100, terminal: true, no: '888' }),
  ], at, 8060, 'terminal-4'));
  return { id, before, at, reverse };
}

function scenarioXbt(reduce, lineId, dir) {
  const origin = dir === 2 ? 0 : 1, dest = dir === 2 ? 1 : 0;
  const born = reduce(args([
    row({ line: lineId, dir, from: origin, to: origin, dest, arrEpoch: 9000,
      terminal: true, no: 'X1' }),
  ], null, 8900, `${lineId}-${dir}-1`, fixtureModel(120)));
  const id = born.vehicles[0].vehicleId;
  const enroute = reduce(args([], born, 9119, `${lineId}-${dir}-2`, fixtureModel(120)));
  const arrived = reduce(args([], enroute, 9120, `${lineId}-${dir}-3`, fixtureModel(120)));
  const reverseDir = dir === 2 ? 1 : 2;
  const reverseOrigin = dest;
  const reverse = reduce(args([
    row({ line: lineId, dir: reverseDir, from: reverseOrigin, to: reverseOrigin, dest: origin,
      arrEpoch: 9200, terminal: true, no: 'X1' }),
  ], arrived, 9130, `${lineId}-${dir}-4`, fixtureModel(120)));
  return { id, born, enroute, arrived, reverse };
}

function scenarioMultipleBoards(reduce) {
  const base = { line: 'L', dir: 2, destIdx: 4, no: '201', terminal: false, run: 60, baseEpoch: 10000 };
  const claims = [
    { ...base, from: 0, to: 1, arrEpoch: 10060, progress: 0.8, ix: 0.8, eventClaims: [] },
    { ...base, from: 1, to: 2, arrEpoch: 10120, progress: 0.1, ix: 1.1, eventClaims: [] },
  ];
  const collapsed = collapseClaims(claims);
  const attached = attachOfficialTimelines(fixtureModel(), collapsed, claims);
  const state = reduce(args(attached, null, 10000, 'multiple-boards'));
  return { claims, collapsed, attached, state };
}

function scenarioScheduleIndependent(reduce) {
  const rows1 = [row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 11000 })];
  const rows2 = [row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 11080 })];
  const a1 = reduce(args(rows1, null, 10900, 'schedule-1', fixtureModel(60)));
  const a2 = reduce(args(rows2, a1, 11001, 'schedule-2', fixtureModel(60)));
  const b1 = reduce(args(rows1, null, 10900, 'schedule-1', fixtureModel(600)));
  const b2 = reduce(args(rows2, b1, 11001, 'schedule-2', fixtureModel(600)));
  return { a2, b2 };
}

function scenarioShortAdjacentReject(reduce, dir) {
  const model = { lines: new Map([['BR', line(10, 75)]]) };
  const forward = dir === 2, firstTo = forward ? 2 : 7, secondTo = firstTo + (forward ? 1 : -1);
  const dest = forward ? 9 : 0;
  const first = reduce(args([row({ line:'BR', dir, from:firstTo + (forward ? -1 : 1), to:firstTo,
    dest, arrEpoch:17000, run:75 })], null, 16950, `br-short-${dir}-1`, model));
  const id = first.vehicles[0].vehicleId;
  // 15 秒後若下一站的到站 epoch 也只多 15 秒，這是分組邊界把下一班接錯，不是本車超速。
  const second = reduce(args([row({ line:'BR', dir, from:firstTo, to:secondTo,
    dest, arrEpoch:17015, run:75 })], first, 16965, `br-short-${dir}-2`, model));
  return { id, second };
}

function scenarioShortCycleFloor(reduce) {
  const model = { lines:new Map([['BR', line(10, 75)]]) };
  const state = reduce(args([row({ line:'BR', dir:2, from:1, to:2, dest:9, arrEpoch:18010, run:75,
    timeline:[
      { from:0, to:1, depEpoch:17925, arrEpoch:18000, terminal:false },
      { from:1, to:2, depEpoch:18000, arrEpoch:18010, terminal:false },
    ] })], null, 17990, 'br-short-cycle', model));
  return state.vehicles[0];
}

function scenarioDuplicateRows(reduce) {
  const duplicate = row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 12000, no: 'DUP' });
  return reduce(args([{ ...duplicate }, { ...duplicate }], null, 11900, 'duplicate'));
}

// 合一修法的控制組：同起點但 ETA 不同的兩筆端點列是可區分的兩班發車，
// 必須仍是兩個唯一 ID。沒有這一條，「全部合掉」也會綠。
function scenarioDistinctOriginRows(reduce) {
  return reduce(args([
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 12000, terminal: true }),
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 12240, terminal: true }),
  ], null, 11900, 'distinct-origin'));
}

// 2026-08-15 幽靈車根因的正面契約：起點倒數的 ETA 每輪修訂（官方本來就會修），
// 身分不得跟著換。舊版把端點 ID 讓給全線 DP，於是每輪的起點列都落到出生迴圈。
// 線上實際形狀：起點停一台等發車，同時第一段上已有前一班在跑。舊版全線 DP 會把
// 起點 ID 讓給那筆前進列（尤其 ETA 滑過 now 觸發 rollover 拒配時），起點列遂每輪再出生。
function scenarioOriginEtaSlide(reduce) {
  const originRow = arrEpoch => row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch, terminal: true });
  const aheadRow = arrEpoch => row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch });
  let state = reduce(args([originRow(12300), aheadRow(12060)], null, 12000, 'slide-0'));
  const parked = state.vehicles.find(vehicle => vehicle.terminal);
  const id = parked && parked.vehicleId;
  const ids = new Set(state.vehicles.map(vehicle => vehicle.vehicleId));
  let births = 0;
  // 20 輪、每 15 秒一拍，起點 ETA 前後修訂並滑過 now（官方實際行為）；前車同步前進。
  for (let round = 1; round <= 20; round++) {
    const nowEpoch = 12000 + round * 15;
    const arrEpoch = 12285 + (round % 4) * 15;
    state = reduce(args([originRow(arrEpoch), aheadRow(12060 + Math.ceil(round / 4) * 60)],
      state, nowEpoch, `slide-${round}`));
    births += state.diagnostics.births;
    state.vehicles.forEach(vehicle => ids.add(vehicle.vehicleId));
  }
  return { state, id, ids, births, parkedNow: state.vehicles.find(vehicle => vehicle.terminal) };
}

// 起點 pending ID 要由「第一段離站列」消耗；消耗後同起點的下一筆倒數才是新一班。
function scenarioOriginHandoff(reduce) {
  const parked = reduce(args([row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 12300, terminal: true })],
    null, 12000, 'handoff-0'));
  const id = parked.vehicles[0].vehicleId;
  // 離站：第一段 0→1，同輪另有下一班的起點倒數 ⇒ 恰好 +1 台。
  const departed = reduce(args([
    row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 12360 }),
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 12600, terminal: true }),
  ], parked, 12310, 'handoff-1'));
  const moved = departed.vehicles.find(vehicle => vehicle.vehicleId === id);
  const next = departed.vehicles.find(vehicle => vehicle.vehicleId !== id);
  return { id, departed, moved, next };
}

function scenarioNoMidRouteBirth(reduce) {
  const prior = reduce(args([
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 13000, terminal: true, no: 'A' }),
  ], null, 12900, 'mid-route-1'));
  const id = prior.vehicles[0].vehicleId;
  const next = reduce(args([
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 13100, no: 'B' }),
  ], prior, 12910, 'mid-route-2'));
  return { id, next };
}

function scenarioAnonymousTimelinePartitions() {
  const model = { lines: new Map([['L', line(8, 120)]]) };
  // 重現 8/14 環狀線：7→6 的模型 run=75s、6→5 被舊班表高估為 275s；官方逐站
  // 到站其實是 10082／10195，同一台車。舊門檻會把兩站各生一台，還把 10404 的
  // 下一班起點倒數錯吞進第一台。
  model.lines.get('L').runs.set('7>6', 75);
  model.lines.get('L').runs.set('6>5', 275);
  const raw = [
    { line:'L', dir:1, stationIdx:7, destIdx:0, destName:'0', no:'', arrEpoch:10404,
      baseEpoch:10000, sec:404, atStation:false },
    { line:'L', dir:1, stationIdx:6, destIdx:0, destName:'0', no:'', arrEpoch:10082,
      baseEpoch:10000, sec:82, atStation:false },
    { line:'L', dir:1, stationIdx:5, destIdx:0, destName:'0', no:'', arrEpoch:10195,
      baseEpoch:10000, sec:195, atStation:false },
  ];
  const claimed = claimBoardRows(model, [...raw].reverse(), 10000, new Map());
  const collapsed = collapseClaims(claimed.claims);
  const attached = attachOfficialTimelines(model, collapsed, raw, new Map());
  return { claimed, collapsed, attached };
}

function scenarioNumberJumpProtection(reduce) {
  const model = fixtureModel();
  model.lines.set('L', line(21, 60));
  const first = reduce(args([
    row({ dir:2, from:1, to:2, dest:20, arrEpoch:15000, no:'403' }),
  ], null, 14950, 'number-jump-1', model));
  const id = first.vehicles[0].vehicleId;
  // 15 秒後，同號 403 突然從永安市場（index 2）出現在丹鳳（index 19）；
  // 真正相鄰的 row 號碼若變成 408，身分仍必須跟位置並清掉不可信標籤。
  const conflict = reduce(args([
    row({ dir:2, from:2, to:3, dest:20, arrEpoch:15060, no:'408' }),
    row({ dir:2, from:18, to:19, dest:20, arrEpoch:15120, no:'403' }),
  ], first, 14965, 'number-jump-2', model));
  const farOnly = reduce(args([
    row({ dir:2, from:18, to:19, dest:20, arrEpoch:15120, no:'403' }),
  ], first, 14965, 'number-jump-far-only', model));
  const later = reduce(args([
    row({ dir:2, from:3, to:4, dest:20, arrEpoch:15140, no:'403' }),
  ], conflict, 15030, 'number-jump-3', model));
  return { id, first, conflict, farOnly, later };
}

function scenarioIntermittentNumber(reduce) {
  const first = reduce(args([
    row({ dir:2, from:0, to:1, dest:4, arrEpoch:15600, no:'134' }),
  ], null, 15540, 'number-gap-1'));
  const id = first.vehicles[0].vehicleId;
  const blank = reduce(args([
    row({ dir:2, from:1, to:2, dest:4, arrEpoch:15680, no:'' }),
  ], first, 15601, 'number-gap-2'));
  const restored = reduce(args([
    row({ dir:2, from:2, to:3, dest:4, arrEpoch:15760, no:'134' }),
  ], blank, 15681, 'number-gap-3'));
  return { id, first, blank, restored };
}

function scenarioAnonymousFleetContinuity(reduce, dir) {
  const model = { lines: new Map([['BR', line(10, 75)]]) };
  const forward = dir === 2;
  const firstTargets = forward ? [2, 5, 8] : [7, 4, 1];
  const secondTargets = firstTargets.map(value => value + (forward ? 1 : -1));
  const makeRows = (targets, baseEpoch) => targets.map((to, index) => row({
    line: 'BR', dir, from: to + (forward ? -1 : 1), to,
    dest: forward ? 9 : 0, arrEpoch: baseEpoch + index * 20, no: '', run: 75,
  }));
  const first = reduce(args(makeRows(firstTargets, 16075), null, 16000,
    `br-anonymous-${dir}-1`, model));
  const second = reduce(args(makeRows(secondTargets, 16150), first, 16020,
    `br-anonymous-${dir}-2`, model));
  const ordered = state => [...state.vehicles].sort((a, b) =>
    Number(a.routePosition) - Number(b.routePosition));
  const before = ordered(first), after = ordered(second);
  return {
    first, second,
    sameOrder: before.length === 3 && after.length === 3 &&
      before.every((vehicle, index) => vehicle.vehicleId === after[index]?.vehicleId),
    advances: before.map((vehicle, index) =>
      Number(after[index]?.routePosition) - Number(vehicle.routePosition)),
  };
}

function evaluate(reduce) {
  const result = {};
  const assess = (name, fn) => {
    try { result[name] = Boolean(fn()); } catch { result[name] = false; }
  };

  let deterministic;
  try { deterministic = scenarioDeterminism(reduce); } catch { deterministic = null; }
  assess('輸入順序不影響名冊', () => deterministic && same(deterministic.normal) === same(deterministic.reversed));
  assess('冷啟動每列都有唯一 ID', () => deterministic &&
    deterministic.normal.vehicles.length === deterministic.rows.length && uniqueIds(deterministic.normal));
  assess('兩個方向都建立列車', () => deterministic && [1, 2].every(dir =>
    deterministic.normal.vehicles.some(vehicle => vehicle.dir === dir)));
  assess('官方車次只作顯示', () => deterministic &&
    deterministic.normal.vehicles.filter(vehicle => vehicle.officialNo).length === 2 &&
    deterministic.normal.vehicles.every(vehicle => vehicle.tripKey == null && vehicle.scheduleKey == null));
  assess('每台車都有可稽核的官方站牌出生證據', () => deterministic &&
    deterministic.normal.vehicles.every(vehicle => vehicle.birthEvidence?.source === 'official-board' &&
      vehicle.birthEvidence.sourceRevision === 'deterministic'));

  let life;
  try { life = scenarioLifecycle(reduce); } catch { life = null; }
  assess('發車到逐站更新始終沿用同一 ID', () => life &&
    [life.departureCorrected, life.firstStation, life.secondStationAndDestCorrection, life.carried]
      .every(state => byId(state, life.id)));
  assess('終點標示修訂不重發 ID', () => life &&
    byId(life.secondStationAndDestCorrection, life.id)?.dest === 3);
  assess('當輪沒有資料仍沿既有時間軸保留', () => life &&
    byId(life.carried, life.id)?.carried === true);
  assess('抵達已知終點才收車', () => life && !byId(life.completed, life.id));

  let rollback;
  try { rollback = scenarioEtaRollback(reduce); } catch { rollback = null; }
  assess('ETA 回修一站仍是同一 ID', () => rollback &&
    byId(rollback.correctedBack, rollback.id)?.from === 0);

  let long;
  try { long = scenarioLongOfficialInterval(reduce); } catch { long = null; }
  assess('長時間缺訊不得先於官方終點時刻刪車', () => long &&
    byId(long.silentButEnroute, long.id)?.carried === true);
  assess('再久也只按終點時刻收車', () => long && !byId(long.completed, long.id));

  let turn;
  try { turn = scenarioNewDepartureAndReverse(reduce); } catch { turn = null; }
  assess('同方向下一個起點倒數建立新 ID', () => turn && turn.sameDirectionNew &&
    turn.sameDirectionNew.vehicleId !== turn.oldId && byId(turn.oldEnrouteAndNextDeparture, turn.oldId));
  assess('同車號跨方向也必須建立新 ID', () => turn && turn.reverse &&
    turn.reverse.vehicleId !== turn.oldId && byId(turn.crossDirectionWhileOldActive, turn.oldId));

  let terminal;
  try { terminal = scenarioTerminal(reduce); } catch { terminal = null; }
  assess('終點到達前一秒仍在', () => terminal && byId(terminal.before, terminal.id));
  assess('終點到達當秒退場', () => terminal && !byId(terminal.at, terminal.id));
  assess('折返只在反向倒數出現後另生新車', () => terminal && terminal.reverse.vehicles.length === 1 &&
    terminal.reverse.vehicles[0].dir === 1 && terminal.reverse.vehicles[0].vehicleId !== terminal.id);

  for (const lineId of ['G_XBT', 'R_XBT']) for (const dir of [1, 2]) {
    let xbt;
    try { xbt = scenarioXbt(reduce, lineId, dir); } catch { xbt = null; }
    assess(`${lineId} 方向${dir}用單段秒移動後收車`, () => xbt &&
      byId(xbt.enroute, xbt.id) && !byId(xbt.arrived, xbt.id));
    assess(`${lineId} 方向${dir}反向倒數另生 ID`, () => xbt && xbt.reverse.vehicles.length === 1 &&
      xbt.reverse.vehicles[0].vehicleId !== xbt.id);
  }

  let boards;
  try { boards = scenarioMultipleBoards(reduce); } catch { boards = null; }
  assess('同車出現在多站倒數先合成一輛', () => boards && boards.collapsed.length === 1 &&
    boards.collapsed[0].eventClaims.length === 2 && boards.attached[0].timeline.length === 2 &&
    boards.state.vehicles.length === 1);

  let schedule;
  try { schedule = scenarioScheduleIndependent(reduce); } catch { schedule = null; }
  assess('跨輪相鄰站時間不得短於該段官方行車秒', () => schedule &&
    schedule.a2.vehicles[0].coastCycle === 80 && schedule.a2.diagnostics.ignoredObservations === 0 &&
    schedule.b2.vehicles[0].to === 1 && schedule.b2.vehicles[0].carried === true &&
    schedule.b2.diagnostics.ignoredObservations === 1);

  for (const dir of [1, 2]) {
    let short;
    try { short = scenarioShortAdjacentReject(reduce, dir); } catch { short = null; }
    assess(`BR 方向${dir}十五秒內不得把同一 ID 推進一站`, () => short &&
      byId(short.second, short.id)?.to === (dir === 2 ? 2 : 7) &&
      byId(short.second, short.id)?.carried === true && short.second.diagnostics.ignoredObservations === 1);
  }
  let shortCycle;
  try { shortCycle = scenarioShortCycleFloor(reduce); } catch { shortCycle = null; }
  assess('異常逐站 timeline 也不得產生短於段秒的續推週期', () => shortCycle &&
    shortCycle.coastCycle === 75);

  let duplicate;
  try { duplicate = scenarioDuplicateRows(reduce); } catch { duplicate = null; }
  // 2026-08-15 翻面：完全相同的兩列以前各發一個 ID，正是斷訊恢復後端點疊車的來源之一。
  // 不可區分的證據只能建立一個身分；顯示一台永遠比製造幽靈安全（fail closed）。
  assess('完全相同的官方列合一，不得變成兩個身分', () => duplicate && duplicate.vehicles.length === 1 &&
    uniqueIds(duplicate) && duplicate.diagnostics.duplicateRowsCollapsed === 1 &&
    duplicate.diagnostics.duplicateBirthSignatures === 0);

  let slide;
  try { slide = scenarioOriginEtaSlide(reduce); } catch { slide = null; }
  assess('起點倒數 ETA 逐輪修訂不得換 ID', () => slide && slide.ids.size === 2 &&
    slide.births === 0 && slide.state.vehicles.length === 2 &&
    slide.parkedNow && slide.parkedNow.vehicleId === slide.id);

  let handoff;
  try { handoff = scenarioOriginHandoff(reduce); } catch { handoff = null; }
  assess('起點車被第一段官方列帶走後，下一班才輪到新 ID', () => handoff &&
    handoff.departed.vehicles.length === 2 && handoff.departed.diagnostics.births === 1 &&
    handoff.moved && Number(handoff.moved.to) === 1 && !handoff.moved.terminal &&
    handoff.next && handoff.next.terminal && Number(handoff.next.arrEpoch) === 12600);

  let distinctOrigin;
  try { distinctOrigin = scenarioDistinctOriginRows(reduce); } catch { distinctOrigin = null; }
  assess('同起點但 ETA 不同的兩班仍是兩個唯一 ID', () => distinctOrigin &&
    distinctOrigin.vehicles.length === 2 && uniqueIds(distinctOrigin) &&
    distinctOrigin.diagnostics.duplicateRowsCollapsed === 0 &&
    distinctOrigin.diagnostics.births === 2);

  let midRoute;
  try { midRoute = scenarioNoMidRouteBirth(reduce); } catch { midRoute = null; }
  assess('營運中配不到的站間列不得另生新車', () => midRoute && midRoute.next.vehicles.length === 1 &&
    byId(midRoute.next, midRoute.id)?.carried === true && midRoute.next.diagnostics.ignoredObservations === 1 &&
    midRoute.next.diagnostics.births === 0);

  let anonymous;
  try { anonymous = scenarioAnonymousTimelinePartitions(); } catch { anonymous = null; }
  assess('無車號逐站倒數按 epoch 單調區段合成，不產相鄰重複車', () => anonymous &&
    anonymous.collapsed.length === 2 && anonymous.collapsed.filter(value => value.terminal).length === 1 &&
    anonymous.collapsed.filter(value => !value.terminal).length === 1 &&
    anonymous.collapsed.find(value => !value.terminal)?.eventClaims.length === 2 &&
    anonymous.attached.find(value => !value.terminal)?.timeline.length === 2);
  assess('兩站官方時間直接決定中間一段，不吃錯誤舊 run', () => anonymous &&
    anonymous.attached.find(value => !value.terminal)?.timeline.find(value => value.from === 6 && value.to === 5)?.depEpoch === 10107);

  let numberJump;
  try { numberJump = scenarioNumberJumpProtection(reduce); } catch { numberJump = null; }
  assess('官方號碼不得把 403 在 15 秒內從永安市場拖到丹鳳', () => numberJump &&
    byId(numberJump.conflict, numberJump.id)?.to === 3 && numberJump.conflict.diagnostics.ignoredObservations === 1);
  assess('同一 ID 的號碼衝突就永久退回路線代號', () => numberJump &&
    byId(numberJump.conflict, numberJump.id)?.officialNo == null &&
    byId(numberJump.conflict, numberJump.id)?.officialNoLockedOut === true &&
    byId(numberJump.later, numberJump.id)?.officialNo == null &&
    byId(numberJump.later, numberJump.id)?.officialNoLockedOut === true);
  assess('當輪只剩遠方同號時不生幽靈，舊車沿原時間線保留但退牌', () => numberJump &&
    numberJump.farOnly.vehicles.length === 1 &&
    byId(numberJump.farOnly, numberJump.id)?.carried === true &&
    byId(numberJump.farOnly, numberJump.id)?.to === 2 &&
    byId(numberJump.farOnly, numberJump.id)?.officialNo == null &&
    byId(numberJump.farOnly, numberJump.id)?.officialNoLockedOut === true &&
    numberJump.farOnly.diagnostics.ignoredObservations === 1 &&
    numberJump.farOnly.diagnostics.rejectedNumberJumps === 1 &&
    numberJump.farOnly.diagnostics.rejectedNumberJumpDetails?.[0]?.priorTo === 2 &&
    numberJump.farOnly.diagnostics.rejectedNumberJumpDetails?.[0]?.currentTo === 19);

  let intermittentNumber;
  try { intermittentNumber = scenarioIntermittentNumber(reduce); } catch { intermittentNumber = null; }
  assess('已認到的 134 遇到後續站牌空白仍保留原號碼', () => intermittentNumber &&
    byId(intermittentNumber.blank, intermittentNumber.id)?.officialNo === '134' &&
    byId(intermittentNumber.blank, intermittentNumber.id)?.officialNoLockedOut === false &&
    byId(intermittentNumber.restored, intermittentNumber.id)?.officialNo === '134' &&
    byId(intermittentNumber.restored, intermittentNumber.id)?.officialNoLockedOut === false &&
    intermittentNumber.blank.diagnostics.numberConflicts === 0);

  for (const dir of [1, 2]) {
    let fleet;
    try { fleet = scenarioAnonymousFleetContinuity(reduce, dir); } catch { fleet = null; }
    assess(`BR 無號三列方向${dir}跨輪各自接回原 ID、不交叉飛奔`, () => fleet &&
      fleet.sameOrder && fleet.advances.every(value => value === 1) &&
      fleet.second.diagnostics.births === 0 && fleet.second.diagnostics.ignoredObservations === 0);
  }
  return result;
}

function replaceExactly(source, from, to, label) {
  const pieces = source.split(from);
  if (pieces.length !== 2) throw new Error(`${label} mutation anchor 應恰好一處，實際 ${pieces.length - 1}`);
  return pieces[0] + to + pieces[1];
}

async function mutatedReducer(kind) {
  let source = fs.readFileSync(SOURCE_PATH, 'utf8');
  if (kind === 'drop-carried') {
    source = replaceExactly(source,
      'vehicles.push(alive); usedIds.add(String(alive.vehicleId)); carried++;',
      'exits++;', kind);
  } else if (kind === 'silence-limit') {
    source = replaceExactly(source,
      '// 這是「到已知終點」的時刻，不是資料齡或缺訊 timeout。',
      'if (nowEpoch - Number(vehicle.observedEpoch) > 600) return null;\n  // mutation: 以缺訊時間刪車', kind);
  } else if (kind === 'dest-group') {
    source = replaceExactly(source,
      'function groupKey(item) { return `${item.line}|${Number(item.dir)}`; }',
      'function groupKey(item) { return `${item.line}|${Number(item.dir)}|${Number(item.dest)}`; }', kind);
  } else if (kind === 'forward-only') {
    source = replaceExactly(source,
      '  if (advance < -1) return false;',
      '  if (advance < 0) return false;', kind);
  } else if (kind === 'global-no') {
    source = replaceExactly(source,
      'vehicle.line === row.line && Number(vehicle.dir) === Number(row.dir) &&\n      String(vehicle.officialNo || \'\') === row.displayNo',
      'String(vehicle.officialNo || \'\') === row.displayNo', kind);
    source = replaceExactly(source,
      '  return physicallyReachable(model, prior, current, nowEpoch);',
      '  return true;', kind);
  } else if (kind === 'keep-terminal') {
    source = replaceExactly(source,
      'if (timing.retireEpoch != null && Number.isFinite(Number(timing.retireEpoch)) &&\n      nowEpoch >= Number(timing.retireEpoch)) return null;',
      'if (false && timing.retireEpoch != null && Number.isFinite(Number(timing.retireEpoch)) &&\n      nowEpoch >= Number(timing.retireEpoch)) return null;', kind);
  } else if (kind === 'no-xbt-fallback') {
    source = replaceExactly(source,
      'function segmentRun(model, lineId, from, to) {\n  const line =',
      "function segmentRun(model, lineId, from, to) {\n  if (/_XBT$/.test(lineId)) return null;\n  const line =", kind);
  } else if (kind === 'duplicate-id') {
    source = replaceExactly(source,
      'const vehicleId = allocateVehicleId(state);\n    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;',
      'const vehicleId = births ? [...usedIds][0] : allocateVehicleId(state);\n    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;', kind);
  } else if (kind === 'collapse-everything') {
    // 合一過寬：連 ETA 不同的兩班也併掉。控制組必須因此變紅。
    source = replaceExactly(source,
      'const key = rowKey(row);\n    if (byKey.has(key)) { duplicateRowsCollapsed++; continue; }',
      "const key = [row.line, row.dir, row.from, row.to].join('|');\n" +
      '    if (byKey.has(key)) { duplicateRowsCollapsed++; continue; }', kind);
  } else if (kind === 'no-row-collapse') {
    source = replaceExactly(source,
      'if (byKey.has(key)) { duplicateRowsCollapsed++; continue; }',
      'if (byKey.has(key)) { duplicateRowsCollapsed++; byKey.set(key + Math.random(), row); continue; }', kind);
  } else if (kind === 'birth-mid-route') {
    source = replaceExactly(source,
      'if (!coldStart && !current[index].terminal) { ignoredObservations++; continue; }',
      'if (false && !coldStart && !current[index].terminal) { ignoredObservations++; continue; }', kind);
  } else if (kind === 'allow-number-jump') {
    source = replaceExactly(source,
      '  return physicallyReachable(model, prior, current, nowEpoch);',
      '  return true;', kind);
  } else if (kind === 'replace-number') {
    source = replaceExactly(source,
      '  return { officialNo: null, officialNoLockedOut: true };',
      '  return { officialNo: current || null, officialNoLockedOut: false };', kind);
  } else if (kind === 'drop-number-on-blank') {
    source = replaceExactly(source,
      '  if (!current) return { officialNo: prior, officialNoLockedOut: false };',
      '  if (!current) return { officialNo: null, officialNoLockedOut: true };', kind);
  } else if (kind === 'keep-carried-number') {
    source = replaceExactly(source,
      '    ...(numberContradicted ? { officialNo: null, officialNoLockedOut: true } : {}) };',
      '    ...(numberContradicted ? {} : {}) };', kind);
  } else if (kind === 'erase-birth-evidence') {
    source = replaceExactly(source,
      "source: 'official-board', sourceRevision, observedEpoch: nowEpoch,",
      "source: 'unverified', sourceRevision, observedEpoch: nowEpoch,", kind);
  } else if (kind === 'allow-short-adjacent') {
    source = replaceExactly(source,
      '  if (Number(current.arrEpoch) - Number(prior.arrEpoch) + elapsed < required) return false;',
      '  if (false) return false;', kind);
  } else if (kind === 'allow-short-cycle') {
    source = replaceExactly(source,
      '? Math.max(own, Number(physicalFloor) > 0 ? Number(physicalFloor) : 0)',
      '? own', kind);
  } else throw new Error(`未知 mutation ${kind}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=trtc-roster-${kind}.mjs`).toString('base64')}`;
  return (await import(url)).reduceOfficialRoster;
}

function loadJson(relative) { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')); }

function peakReplay(reduce) {
  if (!fs.existsSync(PEAK_DIR)) return null;
  const rounds = fs.readdirSync(PEAK_DIR).map(name => name.match(/^(\d+)_live\.json$/)?.[1])
    .filter(Boolean).sort();
  const model = buildTrtcModel(loadJson('data/trtc.json'), loadJson('data/trtc_times.json'),
    loadJson('data/trtc_codes.json'), { includeY: true });
  let prior = null, rows = 0, maxVehicles = 0, births = 0, carried = 0, completed = 0;
  let shuffleMismatches = 0, duplicateRounds = 0, crossDirectionChanges = 0, resurrected = 0;
  let impossibleAdvances = 0, shortCoastCycles = 0;
  const impossibleAdvanceExamples = [];
  const directionById = new Map(), retired = new Set();
  let previousIds = new Set();
  const feed = new Map();
  const normalizeName = value => String(value || '').replace(/站$/, '').replace(/臺/g, '台');
  const lineStationIndex = new Map([...model.lines].map(([lineId, line]) => [lineId,
    new Map(line.stations.map((station, index) => [normalizeName(station.name), index]))]));
  for (const round of rounds) {
    const live = loadJson(`tmp/binder-fixtures/rounds-peak/${round}_live.json`);
    const rawCurrent = live.boardPos?.rows || [], at = Number(live.boardPos?.at);
    const identityByNo = new Map(rawCurrent.filter(value => value.no).map(value => [String(value.no), value]));
    const resolved = (live.board || []).map(value => {
      const identity = identityByNo.get(String(value.no || ''));
      const stationIdx = identity && lineStationIndex.get(identity.line)?.get(normalizeName(value.name));
      return identity && Number.isInteger(stationIdx) ? { line: identity.line, dir: Number(identity.dir),
        stationIdx, arrEpoch: Number(value.eta), no: String(value.no) } : null;
    }).filter(Boolean);
    const current = attachOfficialTimelines(model, rawCurrent, resolved, new Map());
    const call = { model, rows: current, prior, day: DAY, nowEpoch: at, sourceRevision: `${round}:${at}` };
    const state = reduce(call);
    const shuffled = reduce({ ...call, rows: [...current].reverse() });
    if (same(state) !== same(shuffled)) shuffleMismatches++;
    if (!uniqueIds(state)) duplicateRounds++;
    const ids = new Set(state.vehicles.map(vehicle => vehicle.vehicleId));
    for (const id of previousIds) if (!ids.has(id)) retired.add(id);
    const priorById = new Map((prior?.vehicles || []).map(vehicle => [vehicle.vehicleId, vehicle]));
    for (const vehicle of state.vehicles) {
      if (retired.has(vehicle.vehicleId) && !previousIds.has(vehicle.vehicleId)) resurrected++;
      const signature = `${vehicle.line}|${vehicle.dir}`;
      if (directionById.has(vehicle.vehicleId) && directionById.get(vehicle.vehicleId) !== signature)
        crossDirectionChanges++;
      directionById.set(vehicle.vehicleId, signature);
      const before = priorById.get(vehicle.vehicleId);
      const advance = before ? Number(vehicle.routePosition) - Number(before.routePosition) : 0;
      if (before && advance > 0) {
        const step = Number(vehicle.dir) === 2 ? 1 : -1;
        let station = Number(before.to), required = 0;
        for (let moved = 0; moved < advance; moved++) {
          const next = station + step;
          const run = model.lines.get(vehicle.line)?.runs?.get(`${station}>${next}`);
          if (!(Number(run) > 0)) { required = NaN; break; }
          required += Number(run); station = next;
        }
        const allowance = Number(vehicle.arrEpoch) - Number(before.arrEpoch) +
          Math.max(0, Number(state.nowEpoch) - Number(before.observedEpoch));
        if (Number.isFinite(required) && allowance < required) {
          impossibleAdvances++;
          if (impossibleAdvanceExamples.length < 8) impossibleAdvanceExamples.push({ line:vehicle.line,
            dir:vehicle.dir, from:Number(before.to), to:Number(vehicle.to), allowance, required,
            id:vehicle.vehicleId });
        }
      }
      const actual = model.lines.get(vehicle.line)?.runs?.get(`${Number(vehicle.from)}>${Number(vehicle.to)}`);
      if (Number(actual) > 0 && Number(vehicle.coastCycle) > 0 && Number(vehicle.coastCycle) < Number(actual))
        shortCoastCycles++;
    }
    for (const value of current) {
      const key = `${value.line}|${value.dir}`;
      if (!feed.has(key)) feed.set(key, { moving: 0, stopped: 0 });
      feed.get(key)[Number(value.from) === Number(value.to) ? 'stopped' : 'moving']++;
    }
    rows += current.length;
    maxVehicles = Math.max(maxVehicles, state.vehicles.length);
    births += state.diagnostics.births;
    carried += state.diagnostics.carried;
    completed += state.diagnostics.completed + state.diagnostics.exits;
    previousIds = ids;
    prior = state;
  }
  return { rounds: rounds.length, rows, maxVehicles, births, carried, completed, shuffleMismatches,
    duplicateRounds, crossDirectionChanges, resurrected, impossibleAdvances, shortCoastCycles,
    impossibleAdvanceExamples, streams: feed.size,
    xbt: Object.fromEntries([...feed].filter(([key]) => /_XBT\|/.test(key))) };
}

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}

const { reduceOfficialRoster } = await import(pathToFileURL(SOURCE_PATH));
const baseline = evaluate(reduceOfficialRoster);
console.log('正式生命週期契約：');
for (const [label, pass] of Object.entries(baseline)) check(pass, label);

const forbidden = [
  ['後端缺訊秒數上限常數', 'OFFICIAL_CARRY_MAX_SEC'],
  ['後端舊續推秒數上限常數', 'OFFICIAL_OWN_SPAN_MAX_SEC'],
  ['前端缺訊秒數上限常數', 'TRTC_OFFICIAL_COAST_MAX_SEC'],
  ['前端名冊資料齡上限常數', 'TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC'],
  ['舊驗收「配不到就退場」名稱', 'unmatchedPriorExited'],
];
const productSource = fs.readFileSync(SOURCE_PATH, 'utf8') + '\n' + fs.readFileSync(INDEX_PATH, 'utf8');
console.log('\n錯誤規則清除 gate：');
for (const [label, needle] of forbidden) check(!productSource.includes(needle), label);

const mutations = [
  ['刪掉當輪未配到的既有車', 'drop-carried', '當輪沒有資料仍沿既有時間軸保留'],
  ['加入缺訊秒數刪車', 'silence-limit', '長時間缺訊不得先於官方終點時刻刪車'],
  ['把終點納入身分群組', 'dest-group', '終點標示修訂不重發 ID'],
  ['ETA 只能向前', 'forward-only', 'ETA 回修一站仍是同一 ID'],
  ['官方車號跨方向共用 ID', 'global-no', '同車號跨方向也必須建立新 ID'],
  ['抵達終點仍保留', 'keep-terminal', '終點到達當秒退場'],
  ['移除 XBT 單段 fallback', 'no-xbt-fallback', 'G_XBT 方向2用單段秒移動後收車'],
  ['重複分配 vehicleId', 'duplicate-id', '同起點但 ETA 不同的兩班仍是兩個唯一 ID'],
  ['把可區分的兩班也合掉', 'collapse-everything', '同起點但 ETA 不同的兩班仍是兩個唯一 ID'],
  ['取消相同列合一', 'no-row-collapse', '完全相同的官方列合一，不得變成兩個身分'],
  ['站間列配不到就另生新車', 'birth-mid-route', '營運中配不到的站間列不得另生新車'],
  ['同號可跨站瞬移', 'allow-number-jump', '官方號碼不得把 403 在 15 秒內從永安市場拖到丹鳳'],
  ['號碼衝突時直接換號', 'replace-number', '同一 ID 的號碼衝突就永久退回路線代號'],
  ['後續站牌空白就清掉已認到號碼', 'drop-number-on-blank', '已認到的 134 遇到後續站牌空白仍保留原號碼'],
  ['遠方同號被拒後仍保留舊牌', 'keep-carried-number', '當輪只剩遠方同號時不生幽靈，舊車沿原時間線保留但退牌'],
  ['移除官方出生證據', 'erase-birth-evidence', '每台車都有可稽核的官方站牌出生證據'],
  ['容許十五秒內推進一站', 'allow-short-adjacent', 'BR 方向2十五秒內不得把同一 ID 推進一站'],
  ['續推週期可短於實際段秒', 'allow-short-cycle', '異常逐站 timeline 也不得產生短於段秒的續推週期'],
];
console.log('\nMutation control：');
for (const [label, kind, expectedRed] of mutations) {
  try {
    const observed = evaluate(await mutatedReducer(kind));
    check(observed[expectedRed] === false, `${label} 會被具名契約攔下`, expectedRed);
  } catch (error) {
    check(false, `${label} mutation 可執行`, String(error && error.message || error));
  }
}

const replay = peakReplay(reduceOfficialRoster);
console.log('\n保存的尖峰官方語料：');
check(replay && replay.rounds === 80 && replay.rows > 0 && replay.streams === 18,
  '80 輪／九線雙向語料完整', replay && `${replay.rounds}輪/${replay.rows}列/${replay.streams}流`);
check(replay && replay.shuffleMismatches === 0, '每輪 rows 逆序結果完全一致', replay && `diff=${replay.shuffleMismatches}`);
check(replay && replay.duplicateRounds === 0, '每輪 vehicleId 唯一', replay && `bad=${replay.duplicateRounds}`);
check(replay && replay.crossDirectionChanges === 0, '任何 ID 都不跨方向', replay && `bad=${replay.crossDirectionChanges}`);
check(replay && replay.resurrected === 0, '已退場 ID 不復活', replay && `bad=${replay.resurrected}`);
check(replay && replay.impossibleAdvances === 0 && replay.shortCoastCycles === 0,
  '任何跨輪推進都要通過實際經過秒＋段秒，續推週期不得超速', replay &&
    `advance=${replay.impossibleAdvances},coast=${replay.shortCoastCycles},examples=${JSON.stringify(replay.impossibleAdvanceExamples)}`);
check(replay && Object.keys(replay.xbt).length === 4 &&
  Object.values(replay.xbt).every(shape => shape.moving === 0 && shape.stopped > 0),
  'XBT 四個方向官方語料只有起點倒數、沒有對端到站時間', replay && JSON.stringify(replay.xbt));

const passed = Object.values(baseline).filter(Boolean).length;
console.log(`\nofficial roster：${passed}/${Object.keys(baseline).length} 契約通過；` +
  `${mutations.length}/${mutations.length} mutation 已執行；peak max=${replay && replay.maxVehicles}、` +
  `births=${replay && replay.births}、carried=${replay && replay.carried}、completed=${replay && replay.completed}。`);
if (failures) process.exit(1);
