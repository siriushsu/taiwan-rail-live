#!/usr/bin/env node
// 「官方即時優先」名冊的純合成驗收；不打網路、不讀班表、不起 listener。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTrtcModel } from './trtc_board_ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const ROOT = path.resolve(HERE, '..');
const PEAK_DIR = path.join(ROOT, 'tmp/binder-fixtures/rounds-peak');
const DAY = '2026-08-13';

const mutationPlan = [
  ['M1 station-minute ID', ['canonicalShuffle', 'rowCardinality', 'uniqueIds', 'opaqueSequentialIds',
    'bothDirections', 'freshNoSchedule', 'hardAliasStable', 'anonymousOrderStable', 'unmatchedCurrentBorn',
    'unmatchedPriorExited', 'duplicateRowsGuard']],
  ['M2 丟掉未配 current', ['canonicalShuffle', 'rowCardinality', 'uniqueIds', 'opaqueSequentialIds',
    'bothDirections', 'freshNoSchedule', 'hardAliasStable', 'anonymousOrderStable', 'unmatchedCurrentBorn',
    'unmatchedPriorExited', 'lastExtensionOwnSpan', 'extensionOnce', 'extensionReappearanceSingle',
    'extensionNextTrainDistinct', 'noEvidenceNoExtension', 'boundedOwnSpan',
    'scheduleIndependent', 'xbtZeroMotion', 'terminalRolloverNewId', 'duplicateRowsGuard']],
  ['M3 保留未配 prior ghost', ['hardAliasStable', 'anonymousOrderStable', 'unmatchedCurrentBorn',
    'unmatchedPriorExited', 'lastExtensionOwnSpan', 'extensionOnce', 'extensionReappearanceSingle',
    'extensionNextTrainDistinct', 'noEvidenceNoExtension', 'boundedOwnSpan',
    'scheduleIndependent', 'xbtZeroMotion', 'terminalRolloverNewId']],
  ['M4 拿掉 ID duplicate guard', ['canonicalShuffle', 'rowCardinality', 'uniqueIds', 'opaqueSequentialIds',
    'bothDirections', 'freshNoSchedule', 'hardAliasStable', 'anonymousOrderStable', 'unmatchedCurrentBorn',
    'unmatchedPriorExited', 'xbtZeroMotion', 'terminalRolloverNewId', 'duplicateRowsGuard']],
  ['M5 改用 schedule duration 補末段', ['lastExtensionOwnSpan', 'extensionOnce',
    'extensionReappearanceSingle', 'extensionNextTrainDistinct', 'scheduleIndependent']],
  ['M6 讓 XBT 停站列產生 motion', ['xbtZeroMotion']],
  ['M7 extension 後 row 重現卻另生 ID', ['extensionReappearanceSingle']],
  ['M8 extension 吃掉下一班', ['extensionNextTrainDistinct']],
  ['M9 允許無界 own span', ['boundedOwnSpan']],
];

console.log('Mutation control 預期（先寫再跑）：');
for (const [name, labels] of mutationPlan) console.log(`- ${name} 應轉紅：${labels.join('、')}`);
console.log('');

function line(stations, scheduleRun = 777) {
  const runs = new Map();
  for (let i = 0; i + 1 < stations; i++) {
    runs.set(`${i}>${i + 1}`, scheduleRun);
    runs.set(`${i + 1}>${i}`, scheduleRun);
  }
  return { stations: Array.from({ length: stations }, (_, i) => ({ name: String(i) })), runs };
}

function model(scheduleRun = 777) {
  return { lines: new Map([
    ['L', line(5, scheduleRun)],
    ['G_XBT', line(2, scheduleRun)],
    ['R_XBT', line(2, scheduleRun)],
  ]) };
}

function row({ line: lineId = 'L', dir, from, to, dest, arrEpoch, no = '', terminal = false, run = 60 }) {
  return { line: lineId, dir, from, to, dest, run: terminal ? 0 : run, arrEpoch, no, terminal };
}

function reduceArgs(rows, prior, nowEpoch, revision, sourceModel = model()) {
  return { model: sourceModel, rows, prior, day: DAY, nowEpoch, sourceRevision: revision };
}

function publicShape(state) {
  return JSON.stringify(state);
}

function vehicleAt(state, predicate) { return state.vehicles.find(predicate); }
function idsUnique(state) {
  const ids = state.vehicles.map(x => x.vehicleId);
  return ids.length === new Set(ids).size;
}

function loadJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function peakReplay(reduce) {
  const ids = fs.readdirSync(PEAK_DIR).map(name => name.match(/^(\d+)_live\.json$/)?.[1])
    .filter(Boolean).sort();
  const sourceModel = buildTrtcModel(loadJson('data/trtc.json'), loadJson('data/trtc_times.json'),
    loadJson('data/trtc_codes.json'), { includeY: true });
  let prior = null, priorIds = new Set(), rows = 0, extensionObservations = 0, maxExtensions = 0,
    maxExtensionRun = 0,
    shuffleMismatches = 0, orderedPairComparisons = 0, orderInversions = 0;
  const byLine = new Map(), byDir = new Map(), extensionByLine = new Map();
  const continuityByLine = new Map(), feedStructure = new Map();
  for (let roundIndex = 0; roundIndex < ids.length; roundIndex++) {
    const id = ids[roundIndex];
    const live = JSON.parse(fs.readFileSync(path.join(PEAK_DIR, `${id}_live.json`), 'utf8'));
    const current = live.boardPos?.rows || [], at = Number(live.boardPos?.at);
    const args = { model: sourceModel, rows: current, prior, day: DAY, nowEpoch: at, sourceRevision: `${id}:${at}` };
    const state = reduce(args);
    const shuffled = reduce({ ...args, rows: [...current].reverse() });
    if (publicShape(state) !== publicShape(shuffled)) shuffleMismatches++;
    const extensions = state.vehicles.filter(vehicle => vehicle.extension);
    if (state.vehicles.length !== current.length + extensions.length || !idsUnique(state)) {
      throw new Error(`peak ${id} official roster cardinality/identity 不守恆`);
    }
    rows += current.length; extensionObservations += extensions.length;
    maxExtensions = Math.max(maxExtensions, extensions.length);
    for (const extension of extensions) maxExtensionRun = Math.max(maxExtensionRun, Number(extension.run));
    for (const rowValue of current) {
      byLine.set(rowValue.line, (byLine.get(rowValue.line) || 0) + 1);
      const key = `${rowValue.line}|${Number(rowValue.dir)}`;
      byDir.set(key, (byDir.get(key) || 0) + 1);
      if (!feedStructure.has(key)) feedStructure.set(key,
        { rows: 0, previousToTerminal: 0, finalLeg: 0, originStopped: 0, moving: 0, stopped: 0 });
      const shape = feedStructure.get(key), count = sourceModel.lines.get(rowValue.line).stations.length;
      shape.rows++;
      if (Number(rowValue.from) !== Number(rowValue.to)) shape.moving++; else shape.stopped++;
      if (Number(rowValue.dir) === 1) {
        if (Number(rowValue.from) === 2 && Number(rowValue.to) === 1) shape.previousToTerminal++;
        if (Number(rowValue.from) === 1 && Number(rowValue.to) === 0) shape.finalLeg++;
        if (Number(rowValue.from) === count - 1 && Number(rowValue.to) === count - 1 && Number(rowValue.run) === 0)
          shape.originStopped++;
      } else {
        if (Number(rowValue.from) === count - 3 && Number(rowValue.to) === count - 2) shape.previousToTerminal++;
        if (Number(rowValue.from) === count - 2 && Number(rowValue.to) === count - 1) shape.finalLeg++;
        if (Number(rowValue.from) === 0 && Number(rowValue.to) === 0 && Number(rowValue.run) === 0)
          shape.originStopped++;
      }
    }
    for (const vehicle of state.vehicles.filter(vehicle => !vehicle.extension)) {
      if (!continuityByLine.has(vehicle.line)) continuityByLine.set(vehicle.line,
        { initial: 0, continued: 0, newAfterInitial: 0 });
      const rec = continuityByLine.get(vehicle.line);
      if (roundIndex === 0) rec.initial++;
      else if (priorIds.has(vehicle.vehicleId)) rec.continued++;
      else rec.newAfterInitial++;
    }
    if (prior) {
      const group = values => {
        const groups = new Map();
        for (const vehicle of values.filter(vehicle => !vehicle.extension)) {
          const key = `${vehicle.line}|${Number(vehicle.dir)}|${Number(vehicle.dest)}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(vehicle);
        }
        for (const list of groups.values()) list.sort((a, b) => Number(a.routePosition) - Number(b.routePosition) ||
          Number(a.arrEpoch) - Number(b.arrEpoch) || String(a.vehicleId).localeCompare(String(b.vehicleId)));
        return groups;
      };
      const beforeGroups = group(prior.vehicles), afterGroups = group(state.vehicles);
      for (const [key, after] of afterGroups) {
        const before = beforeGroups.get(key) || [], beforeIndex = new Map(before.map((vehicle, index) => [vehicle.vehicleId, index]));
        const common = after.map(vehicle => beforeIndex.get(vehicle.vehicleId)).filter(index => index != null);
        for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) {
          orderedPairComparisons++;
          if (common[i] > common[j]) orderInversions++;
        }
      }
    }
    for (const vehicle of extensions) extensionByLine.set(vehicle.line,
      (extensionByLine.get(vehicle.line) || 0) + 1);
    priorIds = new Set(state.vehicles.map(vehicle => vehicle.vehicleId));
    prior = state;
  }
  return { rounds: ids.length, rows, extensionObservations, maxExtensions, maxExtensionRun, shuffleMismatches,
    orderedPairComparisons, orderInversions,
    lines: Object.fromEntries([...byLine].sort()), directions: Object.fromEntries([...byDir].sort()),
    continuityByLine: Object.fromEntries([...continuityByLine].sort()),
    feedStructure: Object.fromEntries([...feedStructure].sort()),
    extensionByLine: Object.fromEntries([...extensionByLine].sort()),
    xbtExtensions: (extensionByLine.get('G_XBT') || 0) + (extensionByLine.get('R_XBT') || 0) };
}

function scenarioFresh(reduce) {
  const rows = [
    row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 1040 }),
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 1050, no: 'H-7' }),
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 1080, terminal: true }),
    row({ dir: 1, from: 4, to: 3, dest: 0, arrEpoch: 1045 }),
    row({ dir: 1, from: 3, to: 2, dest: 0, arrEpoch: 1060 }),
  ];
  const normal = reduce(reduceArgs(rows, null, 1000, 'fresh'));
  const shuffled = reduce(reduceArgs([rows[3], rows[0], rows[4], rows[2], rows[1]], null, 1000, 'fresh'));
  return { rows, normal, shuffled };
}

function scenarioContinuity(reduce) {
  const firstRows = [
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 1080, terminal: true }), // A
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 1050 }),               // B
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 1070, no: 'H-7' }),    // hard no
    row({ dir: 1, from: 4, to: 4, dest: 0, arrEpoch: 1085, terminal: true }), // C
    row({ dir: 1, from: 3, to: 2, dest: 0, arrEpoch: 1055 }),               // D
    row({ dir: 2, from: 0, to: 1, dest: 3, arrEpoch: 1040 }),               // 應立即退出的 ghost 候選
  ];
  const first = reduce(reduceArgs(firstRows, null, 1000, 'continuity-1'));
  const id = {
    a: vehicleAt(first, x => x.dir === 2 && x.dest === 4 && x.terminal).vehicleId,
    b: vehicleAt(first, x => x.dir === 2 && x.dest === 4 && x.from === 1 && x.to === 2).vehicleId,
    hard: vehicleAt(first, x => x.officialNo === 'H-7').vehicleId,
    c: vehicleAt(first, x => x.dir === 1 && x.terminal).vehicleId,
    d: vehicleAt(first, x => x.dir === 1 && !x.terminal).vehicleId,
    ghost: vehicleAt(first, x => x.dest === 3).vehicleId,
  };
  const secondRows = [
    row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 1090 }),
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 1110 }),
    row({ dir: 2, from: 0, to: 0, dest: 4, arrEpoch: 1300, terminal: true }), // ETA rollover，立即 birth
    row({ dir: 1, from: 4, to: 3, dest: 0, arrEpoch: 1095 }),
    row({ dir: 1, from: 2, to: 1, dest: 0, arrEpoch: 1115 }),
    // 即使跨方向與位置，硬 no 仍優先認回同一身分。
    row({ dir: 1, from: 4, to: 3, dest: 0, arrEpoch: 1120, no: 'H-7' }),
  ];
  const second = reduce(reduceArgs(secondRows, first, 1100, 'continuity-2'));
  return { firstRows, secondRows, first, second, id };
}

function scenarioExtension(reduce, sourceModel = model()) {
  const d2a = reduce(reduceArgs([
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 2050 }),
  ], null, 2000, 'ext-d2-1', sourceModel));
  const d2b = reduce(reduceArgs([
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 2110 }),
  ], d2a, 2030, 'ext-d2-2', sourceModel));
  const d2c = reduce(reduceArgs([], d2b, 2060, 'ext-d2-3', sourceModel));
  const d2d = reduce(reduceArgs([], d2c, 2090, 'ext-d2-4', sourceModel));
  const d2e = reduce(reduceArgs([], d2d, 2170, 'ext-d2-5', sourceModel));
  const d2Reappeared = reduce(reduceArgs([
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 2112 }),
  ], d2c, 2070, 'ext-d2-reappear', sourceModel));
  const d2Reextended = reduce(reduceArgs([], d2Reappeared, 2080, 'ext-d2-reextend', sourceModel));
  const d2NextTrain = reduce(reduceArgs([
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 2350 }),
  ], d2c, 2070, 'ext-d2-next-train', sourceModel));

  const d1a = reduce(reduceArgs([
    row({ dir: 1, from: 3, to: 2, dest: 0, arrEpoch: 2050 }),
  ], null, 2000, 'ext-d1-1', sourceModel));
  const d1b = reduce(reduceArgs([
    row({ dir: 1, from: 2, to: 1, dest: 0, arrEpoch: 2120 }),
  ], d1a, 2030, 'ext-d1-2', sourceModel));
  const d1c = reduce(reduceArgs([], d1b, 2060, 'ext-d1-3', sourceModel));

  const noEvidence = reduce(reduceArgs([
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 2050 }),
  ], null, 2000, 'no-evidence-1', sourceModel));
  const noEvidenceGone = reduce(reduceArgs([], noEvidence, 2030, 'no-evidence-2', sourceModel));
  const longA = reduce(reduceArgs([
    row({ dir: 2, from: 1, to: 2, dest: 4, arrEpoch: 2050 }),
  ], null, 2000, 'long-1', sourceModel));
  const longB = reduce(reduceArgs([
    row({ dir: 2, from: 2, to: 3, dest: 4, arrEpoch: 2651 }),
  ], longA, 2030, 'long-2', sourceModel));
  const longGone = reduce(reduceArgs([], longB, 2040, 'long-3', sourceModel));
  return { d2a, d2b, d2c, d2d, d2e, d2Reappeared, d2Reextended, d2NextTrain,
    d1a, d1b, d1c, noEvidence, noEvidenceGone, longA, longB, longGone };
}

function scenarioXbt(reduce) {
  const firstRows = [
    row({ line: 'G_XBT', dir: 2, from: 0, to: 0, dest: 1, arrEpoch: 3020, terminal: true }),
    row({ line: 'R_XBT', dir: 1, from: 1, to: 1, dest: 0, arrEpoch: 3025, terminal: true }),
  ];
  const first = reduce(reduceArgs(firstRows, null, 3000, 'xbt-1'));
  const secondRows = [
    row({ line: 'G_XBT', dir: 2, from: 0, to: 0, dest: 1, arrEpoch: 3022, terminal: true }),
    row({ line: 'R_XBT', dir: 1, from: 1, to: 1, dest: 0, arrEpoch: 3027, terminal: true }),
  ];
  const second = reduce(reduceArgs(secondRows, first, 3010, 'xbt-2'));
  const rolloverRows = [
    row({ line: 'G_XBT', dir: 2, from: 0, to: 0, dest: 1, arrEpoch: 3400, terminal: true }),
    row({ line: 'R_XBT', dir: 1, from: 1, to: 1, dest: 0, arrEpoch: 3410, terminal: true }),
  ];
  const rollover = reduce(reduceArgs(rolloverRows, second, 3200, 'xbt-3'));
  const gone = reduce(reduceArgs([], rollover, 3230, 'xbt-4'));
  return { first, second, rollover, gone };
}

function scenarioDuplicates(reduce) {
  const duplicateAnonymous = row({ dir: 2, from: 0, to: 1, dest: 4, arrEpoch: 4040 });
  const duplicateNo = row({ dir: 1, from: 4, to: 3, dest: 0, arrEpoch: 4050, no: 'DUP' });
  const rows = [{ ...duplicateAnonymous }, { ...duplicateAnonymous }, { ...duplicateNo }, { ...duplicateNo }];
  return { rows, state: reduce(reduceArgs(rows, null, 4000, 'duplicates')) };
}

function evaluate(reduce) {
  const results = {};
  const assess = (name, fn) => {
    try { results[name] = Boolean(fn()); }
    catch (error) { results[name] = false; }
  };

  let fresh;
  try { fresh = scenarioFresh(reduce); } catch { fresh = null; }
  assess('canonicalShuffle', () => fresh && publicShape(fresh.normal) === publicShape(fresh.shuffled));
  assess('rowCardinality', () => fresh && fresh.normal.vehicles.length === fresh.rows.length &&
    fresh.normal.diagnostics.rows === fresh.rows.length && fresh.normal.diagnostics.extensions === 0);
  assess('uniqueIds', () => fresh && idsUnique(fresh.normal));
  assess('opaqueSequentialIds', () => fresh && fresh.normal.vehicles.every(x => /^ov:2026-08-13:[0-9a-z]{6}$/.test(x.vehicleId)) &&
    !fresh.normal.vehicles.some(x => x.vehicleId.includes(x.line) || x.vehicleId.includes(`:${x.to}:`)));
  assess('bothDirections', () => fresh && [1, 2].every(dir => fresh.normal.vehicles.some(x => x.dir === dir)));
  assess('freshNoSchedule', () => fresh && fresh.normal.vehicles.every(x => x.source === 'official' && !x.extension &&
    x.tripKey == null && x.scheduleKey == null));

  let continuity;
  try { continuity = scenarioContinuity(reduce); } catch { continuity = null; }
  assess('hardAliasStable', () => continuity && vehicleAt(continuity.second, x => x.officialNo === 'H-7').vehicleId === continuity.id.hard);
  assess('anonymousOrderStable', () => continuity &&
    vehicleAt(continuity.second, x => x.dir === 2 && x.from === 0 && x.to === 1).vehicleId === continuity.id.a &&
    vehicleAt(continuity.second, x => x.dir === 2 && x.from === 2 && x.to === 3 && !x.officialNo).vehicleId === continuity.id.b &&
    vehicleAt(continuity.second, x => x.dir === 1 && x.from === 4 && x.to === 3 && !x.officialNo).vehicleId === continuity.id.c &&
    vehicleAt(continuity.second, x => x.dir === 1 && x.from === 2 && x.to === 1).vehicleId === continuity.id.d);
  assess('unmatchedCurrentBorn', () => continuity && continuity.second.diagnostics.births === 1 &&
    !new Set(continuity.first.vehicles.map(x => x.vehicleId)).has(
      vehicleAt(continuity.second, x => x.dir === 2 && x.terminal).vehicleId));
  assess('unmatchedPriorExited', () => continuity && !continuity.second.vehicles.some(x => x.vehicleId === continuity.id.ghost));

  let extension, extensionOtherSchedule;
  try { extension = scenarioExtension(reduce, model(777)); } catch { extension = null; }
  try { extensionOtherSchedule = scenarioExtension(reduce, model(333)); } catch { extensionOtherSchedule = null; }
  assess('lastExtensionOwnSpan', () => extension && extension.d2c.vehicles.length === 1 &&
    extension.d2c.vehicles[0].extension && extension.d2c.vehicles[0].run === 60 &&
    extension.d2c.vehicles[0].arrEpoch === 2170 && extension.d2c.vehicles[0].source === 'official-derived-own-last-span' &&
    extension.d1c.vehicles.length === 1 && extension.d1c.vehicles[0].run === 70 && extension.d1c.vehicles[0].to === 0);
  assess('extensionOnce', () => extension && extension.d2d.vehicles.length === 1 &&
    extension.d2d.vehicles[0].arrEpoch === extension.d2c.vehicles[0].arrEpoch && extension.d2e.vehicles.length === 0);
  assess('extensionReappearanceSingle', () => extension && extension.d2Reappeared.vehicles.length === 1 &&
    !extension.d2Reappeared.vehicles[0].extension &&
    extension.d2Reappeared.vehicles[0].vehicleId === extension.d2c.vehicles[0].vehicleId &&
    extension.d2Reextended.vehicles.length === 1 && extension.d2Reextended.vehicles[0].extension &&
    extension.d2Reextended.vehicles[0].vehicleId === extension.d2c.vehicles[0].vehicleId);
  assess('extensionNextTrainDistinct', () => extension && extension.d2NextTrain.vehicles.length === 2 &&
    extension.d2NextTrain.vehicles.some(vehicle => vehicle.extension &&
      vehicle.vehicleId === extension.d2c.vehicles[0].vehicleId && vehicle.run === 60) &&
    extension.d2NextTrain.vehicles.some(vehicle => !vehicle.extension &&
      vehicle.vehicleId !== extension.d2c.vehicles[0].vehicleId));
  assess('noEvidenceNoExtension', () => extension && extension.noEvidenceGone.vehicles.length === 0);
  assess('boundedOwnSpan', () => extension && extension.longGone.vehicles.length === 0);
  assess('scheduleIndependent', () => extension && extensionOtherSchedule &&
    extension.d2c.vehicles[0].run === extensionOtherSchedule.d2c.vehicles[0].run &&
    extension.d2c.vehicles[0].arrEpoch === extensionOtherSchedule.d2c.vehicles[0].arrEpoch);

  let xbt;
  try { xbt = scenarioXbt(reduce); } catch { xbt = null; }
  assess('xbtZeroMotion', () => xbt && [xbt.first, xbt.second, xbt.rollover].every(state =>
    state.vehicles.every(x => x.from === x.to && x.run === 0 && !x.extension)) && xbt.gone.vehicles.length === 0);
  assess('terminalRolloverNewId', () => xbt && xbt.first.vehicles.every(first =>
    xbt.second.vehicles.some(second => second.line === first.line && second.vehicleId === first.vehicleId)) &&
    xbt.rollover.vehicles.every(next => !xbt.second.vehicles.some(old => old.vehicleId === next.vehicleId)));

  let duplicates;
  try { duplicates = scenarioDuplicates(reduce); } catch { duplicates = null; }
  assess('duplicateRowsGuard', () => duplicates && duplicates.state.vehicles.length === duplicates.rows.length &&
    idsUnique(duplicates.state) && duplicates.state.diagnostics.duplicateOfficialNos === 1 &&
    duplicates.state.vehicles.filter(x => x.officialNo).length === 0);
  return results;
}

function replaceExactly(source, from, to, label) {
  const pieces = source.split(from);
  if (pieces.length !== 2) throw new Error(`${label} mutation anchor 應恰好一處，實際 ${pieces.length - 1}`);
  return pieces[0] + to + pieces[1];
}

async function mutatedReducer(kind) {
  let source = fs.readFileSync(SOURCE_PATH, 'utf8');
  if (kind === 'station-minute') {
    source = replaceExactly(source,
      'const vehicleId = allocateVehicleId(state);\n    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;',
      'const rowForId = current[index];\n    const vehicleId = `ov:${state.day}:${rowForId.line}:${rowForId.to}:${Math.floor(rowForId.arrEpoch / 60)}`;\n    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;', kind);
  } else if (kind === 'drop-current') {
    source = replaceExactly(source,
      'const vehicleId = allocateVehicleId(state);\n    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;',
      'const vehicleId = null;\n    births++;', kind);
    source = replaceExactly(source,
      'const row = current[index], vehicleId = assigned.get(index), base = priorById.get(vehicleId) || null;\n    const vehicle = officialVehicle(row, vehicleId, base, sourceRevision, epoch);\n    vehicles.push(vehicle);',
      'const row = current[index], vehicleId = assigned.get(index), base = priorById.get(vehicleId) || null;\n    if (!vehicleId) continue;\n    const vehicle = officialVehicle(row, vehicleId, base, sourceRevision, epoch);\n    vehicles.push(vehicle);', kind);
  } else if (kind === 'keep-ghost') {
    source = replaceExactly(source, 'else exits++;',
      'else { vehicles.push({ ...old, sourceRevision }); usedIds.add(String(old.vehicleId)); }', kind);
  } else if (kind === 'duplicate-id') {
    source = replaceExactly(source, 'const vehicleId = allocateVehicleId(state);',
      'const vehicleId = births === 0 ? allocateVehicleId(state) : [...usedIds][0];', kind);
  } else if (kind === 'schedule-duration') {
    source = replaceExactly(source,
      'const ownLastSpan = Number(last.arrEpoch) - Number(previous.arrEpoch);',
      'const ownLastSpan = Number((model.lines instanceof Map ? model.lines.get(vehicle.line) : model.lines[vehicle.line])?.runs?.get?.(`${vehicle.from}>${vehicle.to}`)) || 1;', kind);
  } else if (kind === 'xbt-motion') {
    source = replaceExactly(source,
      'run: row.run, arrEpoch: row.arrEpoch, terminal: row.terminal,',
      "run: /_XBT$/.test(row.line) ? 60 : row.run, arrEpoch: row.arrEpoch, terminal: row.terminal,", kind);
  } else if (kind === 'exclude-extension-reentry') {
    source = replaceExactly(source,
      'const priorGroup = priorVehicles.map(vehicle => matchingPriorVehicle(vehicle, currentGroup))\n      .filter(x => x && !usedIds.has(String(x.vehicleId)) && groupKey(x) === key)',
      'const priorGroup = priorVehicles.filter(x => !x.extension)\n      .filter(x => x && !usedIds.has(String(x.vehicleId)) && groupKey(x) === key)', kind);
  } else if (kind === 'extension-eats-next') {
    source = replaceExactly(source,
      'Math.abs(Number(item.row.arrEpoch) - Number(last.arrEpoch)) <= EXTENSION_REAPPEAR_ETA_TOLERANCE_SEC',
      'true', kind);
  } else if (kind === 'unbounded-own-span') {
    source = replaceExactly(source,
      'ownLastSpan > 0 && ownLastSpan <= OFFICIAL_OWN_SPAN_MAX_SEC',
      'ownLastSpan > 0', kind);
  } else throw new Error(`未知 mutation ${kind}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=trtc_official_roster-${kind}.mjs`).toString('base64')}`;
  return (await import(url)).reduceOfficialRoster;
}

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}

const { reduceOfficialRoster } = await import(pathToFileURL(SOURCE_PATH));
const baseline = evaluate(reduceOfficialRoster);
console.log('正式實作：');
for (const [label, pass] of Object.entries(baseline)) check(pass, label);

const mutations = [
  ['M1 station-minute ID', 'station-minute'],
  ['M2 丟掉未配 current', 'drop-current'],
  ['M3 保留未配 prior ghost', 'keep-ghost'],
  ['M4 拿掉 ID duplicate guard', 'duplicate-id'],
  ['M5 改用 schedule duration 補末段', 'schedule-duration'],
  ['M6 讓 XBT 停站列產生 motion', 'xbt-motion'],
  ['M7 extension 後 row 重現卻另生 ID', 'exclude-extension-reentry'],
  ['M8 extension 吃掉下一班', 'extension-eats-next'],
  ['M9 允許無界 own span', 'unbounded-own-span'],
];
console.log('\nMutation control：');
for (let index = 0; index < mutations.length; index++) {
  const [name, kind] = mutations[index], expected = mutationPlan[index][1];
  let observed;
  try { observed = evaluate(await mutatedReducer(kind)); }
  catch (error) {
    check(false, `${name} mutation 必須成功載入並執行`, String(error && error.message || error));
    continue;
  }
  const red = Object.entries(observed).filter(([, pass]) => !pass).map(([label]) => label);
  check(JSON.stringify(red) === JSON.stringify(expected), `${name} 只在事先列出的子項轉紅`,
    `紅燈=${red.join(',')}`);
}

const replay = peakReplay(reduceOfficialRoster);
check(replay.rounds === 80 && replay.rows > 0 && Object.keys(replay.lines).length === 9 &&
  Object.keys(replay.directions).length === 18,
  '尖峰全線語料完整', `${replay.rounds}輪/${replay.rows}列/${Object.keys(replay.lines).length}線`);
check(replay.shuffleMismatches === 0, '尖峰全80輪 rows 逆序後逐筆輸出不變', `diff=${replay.shuffleMismatches}`);
check(replay.orderedPairComparisons > 0 && replay.orderInversions === 0,
  '尖峰全線跨輪共同身分保序', `pairs=${replay.orderedPairComparisons},inversions=${replay.orderInversions}`);
const normalFeed = Object.entries(replay.feedStructure).filter(([key]) => !/_XBT\|/.test(key));
const shuttleFeed = Object.entries(replay.feedStructure).filter(([key]) => /_XBT\|/.test(key));
check(normalFeed.length === 14 && normalFeed.every(([, shape]) => shape.previousToTerminal > 0 && shape.finalLeg === 0 &&
  shape.originStopped > 0),
  '七條一般線兩向皆看得到起點，且只缺最後一段', `streams=${normalFeed.length}`);
check(shuttleFeed.length === 4 && shuttleFeed.every(([, shape]) => shape.moving === 0 && shape.stopped > 0),
  '兩條 XBT 四方向只有停站列、零行進區間', `streams=${shuttleFeed.length}`);
check(replay.xbtExtensions === 0, 'G_XBT/R_XBT 尖峰語料不生任何末段移動',
  `extensions=${replay.xbtExtensions}`);
check(replay.maxExtensionRun > 0 && replay.maxExtensionRun <= 600,
  '尖峰末段 own span 保持有界', `maxRun=${replay.maxExtensionRun}s`);
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp/verify_trtc_official_roster.json'),
  JSON.stringify({ baseline, replay }, null, 2) + '\n');

const passed = Object.values(baseline).filter(Boolean).length;
console.log(`\nofficial roster：${passed}/${Object.keys(baseline).length} 結構判準通過；9/9 mutation controls 命中；` +
  `peak ${replay.rounds}輪/${replay.rows}列，extension observations=${replay.extensionObservations}。`);
if (failures) process.exit(1);
