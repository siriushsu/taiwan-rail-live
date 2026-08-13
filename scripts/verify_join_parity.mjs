#!/usr/bin/env node
// joinBoardRowsToTrips 回歸驗收：20 輪 production fixture parity、rows 洗牌決定性、身分唯一性、
// 損壞 binding fail-closed，並以四個 source mutation 證明各 gate 真的能抓到對應退化。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fixedLedger from './trtc_board_ledger.mjs';
import * as originLedger from '../tmp/binder-fixtures/old_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = path.join(ROOT, 'scripts/trtc_board_ledger.mjs');
const ROUNDS_PATH = path.join(ROOT, 'tmp/binder-fixtures/rounds');
const CAPTURE_PATH = path.join(ROOT, 'tmp/binder-fixtures/capture.sh');
const TIMES = readJson(path.join(ROOT, 'data/trtc_times.json'));
const DAY_TYPES = readJson(path.join(ROOT, 'data/tw_daytype.json'));
const SHUFFLES_PER_ROUND = 24;
const MIN_DISTINCT_DYN_AT = 8; // 擷取驗收契約：少於 8 個 cron 版本不足以觀察身分轉換。

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readD1(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('[')));
}
function setDiff(a, b) { return [...a].filter(value => !b.has(value)); }
function sameSet(a, b) { return a.size === b.size && setDiff(a, b).length === 0; }
function fullKey(trip) { return `${trip.line}|${Number(trip.dir)}|${trip.key}`; }
function tupleKey(trip) {
  const eta = trip.eta || {};
  return JSON.stringify([trip.line, Number(trip.dir), trip.key, trip.shift,
    eta.from, eta.to, eta.run, eta.arrEpoch]);
}
function canonicalOutput(trips) {
  return JSON.stringify((trips || []).map(trip => ({
    line: trip.line, dir: Number(trip.dir), key: trip.key, trackId: trip.trackId, shift: trip.shift,
    eta: { from: trip.eta.from, to: trip.eta.to, run: trip.eta.run, arrEpoch: trip.eta.arrEpoch },
  })));
}
function addToMapSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(values, seed) {
  const out = [...values], random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function declaredFixtureRoundIds() {
  const source = fs.readFileSync(CAPTURE_PATH, 'utf8');
  const match = source.match(/seq\s+-w\s+(\d+)\s+(\d+)/);
  if (!match) throw new Error(`無法從 ${CAPTURE_PATH} 解析擷取輪次 manifest`);
  const first = Number(match[1]), last = Number(match[2]);
  const width = Math.max(match[1].length, match[2].length);
  return Array.from({ length: last - first + 1 }, (_, index) => String(first + index).padStart(width, '0'));
}

function validateFixtureTriplets(expectedIds) {
  const files = new Set(fs.readdirSync(ROUNDS_PATH));
  const missing = expectedIds.flatMap(id => ['dyn', 'alias', 'live']
    .map(kind => `${id}_${kind}.json`).filter(file => !files.has(file)));
  if (missing.length) throw new Error(`fixture manifest 缺檔: ${missing.join(', ')}`);
}

const roundIds = declaredFixtureRoundIds();
validateFixtureTriplets(roundIds);
const manifestRounds = roundIds.map(id => {
  const dynResult = readD1(path.join(ROUNDS_PATH, `${id}_dyn.json`));
  const aliasResult = readD1(path.join(ROUNDS_PATH, `${id}_alias.json`));
  const dyn = JSON.parse(dynResult[0].results[0].v);
  const live = readJson(path.join(ROUNDS_PATH, `${id}_live.json`));
  const aliasByHwNo = new Map((aliasResult[0].results || [])
    .map(row => [String(row.alias), String(row.track_id)]));
  return { id, dyn, live, aliasByHwNo };
});
const rounds = manifestRounds;

function sampleBindingIdentity(binding) {
  return [binding.line, Number(binding.dir), binding.tripKey, String(binding.trackId || '')].join('\0');
}

function normalizedSampleLastArrEpoch(binding) {
  return binding.lastArrEpoch != null && Number.isFinite(Number(binding.lastArrEpoch))
    ? Number(binding.lastArrEpoch) : null;
}

function fixtureSampleProfile(roundSubset) {
  const eligibleRowsByLine = {}, dynByAt = new Map();
  for (const round of roundSubset) {
    const at = Number(round.dyn.at);
    if (!dynByAt.has(at)) dynByAt.set(at, round.dyn);
    for (const row of round.live.boardPos.rows || []) {
      if (Number(row.from) === Number(row.to) && Number(row.run) === 0) continue;
      if (Number(row.arrEpoch) - Number(round.live.boardPos.at) < -5) continue;
      eligibleRowsByLine[row.line] = (eligibleRowsByLine[row.line] || 0) + 1;
    }
  }
  const snapshots = [...dynByAt.values()].sort((a, b) => Number(a.at) - Number(b.at));
  const trueUpdatesByLine = {};
  for (let index = 1; index < snapshots.length; index++) {
    const beforeByIdentity = new Map((snapshots[index - 1].bindings || [])
      .filter(binding => binding && !binding.done)
      .map(binding => [sampleBindingIdentity(binding), binding]));
    for (const after of snapshots[index].bindings || []) {
      if (!after || after.done) continue;
      const before = beforeByIdentity.get(sampleBindingIdentity(after));
      if (!before || normalizedSampleLastArrEpoch(before) === normalizedSampleLastArrEpoch(after)) continue;
      trueUpdatesByLine[after.line] = (trueUpdatesByLine[after.line] || 0) + 1;
    }
  }
  return { rounds: roundSubset.length, distinctDynAt: snapshots.length,
    eligibleRowsByLine, trueUpdatesByLine };
}

function gateZ(roundSubset, minimum) {
  const actual = fixtureSampleProfile(roundSubset), shortfalls = [];
  if (actual.rounds < minimum.rounds) shortfalls.push({ metric: 'rounds', actual: actual.rounds, minimum: minimum.rounds });
  if (actual.distinctDynAt < minimum.distinctDynAt) {
    shortfalls.push({ metric: 'distinctDynAt', actual: actual.distinctDynAt, minimum: minimum.distinctDynAt });
  }
  for (const [line, required] of Object.entries(minimum.eligibleRowsByLine)) {
    const observed = actual.eligibleRowsByLine[line] || 0;
    if (observed < required) shortfalls.push({ metric: `eligibleRows.${line}`, actual: observed, minimum: required });
  }
  for (const [line, required] of Object.entries(minimum.trueUpdatesByLine)) {
    const observed = actual.trueUpdatesByLine[line] || 0;
    if (observed < required) shortfalls.push({ metric: `trueUpdates.${line}`, actual: observed, minimum: required });
  }
  return { pass: shortfalls.length === 0, actual, minimum, shortfalls };
}

function sampleMinimumFromManifest(manifestRoundSubset) {
  const profile = fixtureSampleProfile(manifestRoundSubset);
  if (profile.distinctDynAt < MIN_DISTINCT_DYN_AT) {
    throw new Error(`fixture 只有 ${profile.distinctDynAt} 個相異 dyn.at，低於擷取契約 ${MIN_DISTINCT_DYN_AT}`);
  }
  return { ...profile, rounds: declaredFixtureRoundIds().length };
}

function threeRoundMutationHitsEverySampleDimension(result, minimum) {
  const metrics = new Set(result.shortfalls.map(item => item.metric));
  return !result.pass && metrics.has('rounds') && metrics.has('distinctDynAt') &&
    Object.keys(minimum.eligibleRowsByLine).every(line => metrics.has(`eligibleRows.${line}`)) &&
    Object.keys(minimum.trueUpdatesByLine).every(line => metrics.has(`trueUpdates.${line}`));
}

function joinRound(mod, round, rows = round.live.boardPos.rows) {
  const { tripSets } = mod.buildTripSetsByLineDir(TIMES, DAY_TYPES, round.dyn.day);
  return mod.joinBoardRowsToTrips({ tripSets, rows, bindings: round.dyn.bindings,
    aliasByHwNo: round.aliasByHwNo });
}

const DEDUPE_RE = /  \/\/ JOIN_DEDUPE_BEGIN[^\n]*\n[\s\S]*?  \/\/ JOIN_DEDUPE_END/;
const DROP_ALL_BLOCK = `  // JOIN_DEDUPE_BEGIN：mutation/drop-all（回歸版）
  const matchedKeyCounts = new Map(), matchedTrackCounts = new Map();
  for (const trip of stagedTrips) {
    const fullKey = tripBindKey(trip.line, Number(trip.dir), trip.key);
    matchedKeyCounts.set(fullKey, (matchedKeyCounts.get(fullKey) || 0) + 1);
    matchedTrackCounts.set(trip.trackId, (matchedTrackCounts.get(trip.trackId) || 0) + 1);
  }
  return stagedTrips.filter(trip =>
    matchedKeyCounts.get(tripBindKey(trip.line, Number(trip.dir), trip.key)) === 1 &&
    matchedTrackCounts.get(trip.trackId) === 1);
  // JOIN_DEDUPE_END`;
const FIRST_ROW_BLOCK = `  // JOIN_DEDUPE_BEGIN：mutation/first-row（順序相依版）
  const winnerByIdentity = new Map();
  for (const { trip, fullKey } of stagedWithFullKey) {
    if (fullKeysByTrackId.get(trip.trackId).size !== 1 || trackIdsByFullKey.get(fullKey).size !== 1) continue;
    const identity = \`${'${fullKey}'}\\u0000${'${trip.trackId}'}\`;
    if (!winnerByIdentity.has(identity)) winnerByIdentity.set(identity, trip);
  }
  const winners = [...winnerByIdentity.values()];
  winners.sort((a, b) => {
    const ak = \`${'${tripBindKey(a.line, Number(a.dir), a.key)}'}\\u0000${'${a.trackId}'}\`;
    const bk = \`${'${tripBindKey(b.line, Number(b.dir), b.key)}'}\\u0000${'${b.trackId}'}\`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  return winners;
  // JOIN_DEDUPE_END`;
const ALLOW_DUPLICATES_BLOCK = `  // JOIN_DEDUPE_BEGIN：mutation/allow-duplicates（無唯一性版）
  return stagedTrips;
  // JOIN_DEDUPE_END`;

function replaceOnce(source, needle, replacement, label) {
  const hits = typeof needle === 'string' ? source.split(needle).length - 1 : (source.match(needle) || []).length;
  if (hits !== 1) throw new Error(`${label} mutation 錨點預期 1 處，實際 ${hits} 處`);
  return source.replace(needle, replacement);
}
async function mutatedModule(name, mutate) {
  const source = mutate(fs.readFileSync(LEDGER_PATH, 'utf8')) + `\n//# sourceURL=join-parity-${name}.mjs\n`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${name}`;
  return import(url);
}

// 先宣告 mutation 預期，再建立／執行 mutant；若指定 gate 沒有轉紅，整支驗收即失敗。
console.log('【Mutation 預期（執行前宣告）】');
console.log('M-A 末段改回「重複全丟」：A 只在 production 的可比較身分數 > 0。');
console.log('M-B 改成「rows 第一列勝出」：B 洗牌後至少一輪逐筆輸出不同。');
console.log('M-C 直接允許重複：C 的 trackId／tripKey 至少一側出現重複。');
console.log('M-D 拆掉 binding 與末段一對多防線：D 損壞輸入不再回傳空陣列。');
console.log('M-Z 只餵 manifest／可比輪前 3 輪：Z 的輪數、dyn.at、每條有樣本線 eligible rows、每條有真更新線與 A 可比輪下限全部轉紅。');

const dropAllLedger = await mutatedModule('drop-all', source =>
  replaceOnce(source, DEDUPE_RE, DROP_ALL_BLOCK, 'drop-all'));
const firstRowLedger = await mutatedModule('first-row', source =>
  replaceOnce(source, DEDUPE_RE, FIRST_ROW_BLOCK, 'first-row'));
const allowDuplicatesLedger = await mutatedModule('allow-duplicates', source =>
  replaceOnce(source, DEDUPE_RE, ALLOW_DUPLICATES_BLOCK, 'allow-duplicates'));
const damagedIdentityLedger = await mutatedModule('damaged-identity', source => {
  source = replaceOnce(source,
    '    if (fullKeyCounts.get(fullKey) !== 1 || trackIdCounts.get(trackId) !== 1) continue;',
    '    // mutation：停用 active binding 一對一防線。', 'damaged active binding');
  return replaceOnce(source,
    '    if (fullKeysByTrackId.get(trip.trackId).size !== 1 || trackIdsByFullKey.get(fullKey).size !== 1) continue;',
    '    // mutation：停用 staged trip 一對一防線。', 'damaged staged relation');
});

// Production 是 origin/main 舊 join 算出的 payload。擷取順序是 D1→alias→HTTP；若舊 join 用落盤
// dyn 都無法重現同輪 production tuple，該輪就是跨 cron／快取版本邊界，不能拿來裁決新 join。
const faithfulRoundIds = new Set();
const skew = [];
const targetIdsByRound = new Map();
let deliberateTieExclusions = 0;
for (const round of rounds) {
  const production = round.live.boardPos.trips || [];
  const oldReplay = joinRound(originLedger, round);
  const productionTuples = new Set(production.map(tupleKey));
  const oldTuples = new Set(oldReplay.map(tupleKey));
  if (!sameSet(productionTuples, oldTuples)) {
    skew.push({ id: round.id, dynAt: round.dyn.at, boardAt: round.live.boardPos.at,
      responseAt: Date.parse(round.live.at) / 1000,
      onlyProduction: setDiff(productionTuples, oldTuples).length,
      onlyReplay: setDiff(oldTuples, productionTuples).length });
    continue;
  }
  faithfulRoundIds.add(round.id);
  const productionIds = new Set(production.map(fullKey));
  // allow-duplicates 只拆 C 的末段唯一化，bestCount===1 仍原封不動；用它排除 production 舊版
  // 「陣列第一個同分者」那一筆，避免把明令保留的並列拒絕誤報成這次回歸。
  const unambiguousIds = new Set(joinRound(allowDuplicatesLedger, round).map(fullKey));
  deliberateTieExclusions += setDiff(productionIds, unambiguousIds).length;
  targetIdsByRound.set(round.id, new Set([...productionIds].filter(id => unambiguousIds.has(id))));
}

function gateA(mod, selectedRoundIds = faithfulRoundIds, minimumComparableRounds = faithfulRoundIds.size) {
  let sample = 0, onlyProduction = 0, onlyReplay = 0, selectedTupleOutsideProduction = 0, exactRounds = 0;
  const details = [];
  for (const round of rounds) {
    if (!selectedRoundIds.has(round.id)) continue;
    const production = round.live.boardPos.trips || [];
    const target = targetIdsByRound.get(round.id);
    const productionIds = new Set(production.map(fullKey));
    const productionTuples = new Set(production.map(tupleKey));
    const output = joinRound(mod, round);
    const outputIds = new Set(output.map(fullKey));
    const missing = setDiff(target, outputIds).length;
    const extra = setDiff(outputIds, productionIds).length;
    const foreignTuple = output.filter(trip => !productionTuples.has(tupleKey(trip))).length;
    sample += target.size; onlyProduction += missing; onlyReplay += extra;
    selectedTupleOutsideProduction += foreignTuple;
    if (!missing && !extra && !foreignTuple) exactRounds++;
    if (missing || extra || foreignTuple) details.push({ id: round.id, missing, extra, foreignTuple });
  }
  const comparableSamplePass = selectedRoundIds.size >= minimumComparableRounds;
  return { pass: comparableSamplePass && onlyProduction === 0 && onlyReplay === 0 &&
      selectedTupleOutsideProduction === 0,
    sample, rounds: selectedRoundIds.size, minimumComparableRounds, comparableSamplePass,
    exactRounds, onlyProduction, onlyReplay,
    selectedTupleOutsideProduction, details };
}

function gateB(mod) {
  let comparisons = 0, changed = 0;
  const changedRounds = new Set();
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
    const round = rounds[roundIndex];
    const expected = canonicalOutput(joinRound(mod, round));
    for (let n = 0; n < SHUFFLES_PER_ROUND; n++) {
      const rows = shuffled(round.live.boardPos.rows, 0x13A0 + roundIndex * 1009 + n * 9176);
      const actual = canonicalOutput(joinRound(mod, round, rows));
      comparisons++;
      if (actual !== expected) { changed++; changedRounds.add(round.id); }
    }
  }
  return { pass: changed === 0, rounds: rounds.length, shufflesPerRound: SHUFFLES_PER_ROUND,
    comparisons, changed, changedRounds: [...changedRounds] };
}

function gateC(mod) {
  let outputs = 0, duplicateTrackIds = 0, duplicateTripKeys = 0;
  const duplicateRounds = new Set();
  for (const round of rounds) {
    const output = joinRound(mod, round);
    outputs += output.length;
    const trackCounts = new Map(), tripCounts = new Map();
    for (const trip of output) {
      trackCounts.set(String(trip.trackId), (trackCounts.get(String(trip.trackId)) || 0) + 1);
      tripCounts.set(fullKey(trip), (tripCounts.get(fullKey(trip)) || 0) + 1);
    }
    const trackDup = [...trackCounts.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
    const tripDup = [...tripCounts.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
    duplicateTrackIds += trackDup; duplicateTripKeys += tripDup;
    if (trackDup || tripDup) duplicateRounds.add(round.id);
  }
  return { pass: duplicateTrackIds === 0 && duplicateTripKeys === 0, rounds: rounds.length,
    outputs, duplicateTrackIds, duplicateTripKeys, duplicateRounds: [...duplicateRounds] };
}

function gateD(mod) {
  const line = 'DAMAGE', dir = 2;
  const tripA = [0, 28800, 1, 29000], tripB = [0, 29100, 1, 29300];
  const tripSets = new Map([[`${line}|${dir}`, [tripA, tripB]]]);
  const trackId = 'damaged-track';
  const bindings = [tripA, tripB].map(trip => ({ line, dir, tripKey: mod.tripKeyOf(trip), trackId,
    lastShift: 0, done: false }));
  const baseEpoch = Date.UTC(2026, 7, 13, 0, 0, 0) / 1000; // 台北 08:00，serviceSec=28800
  const rows = [
    { line, dir, from: 0, to: 1, run: 200, arrEpoch: baseEpoch + 200, no: '', terminal: false },
    { line, dir, from: 0, to: 1, run: 200, arrEpoch: baseEpoch + 500, no: '', terminal: false },
  ];
  const output = mod.joinBoardRowsToTrips({ tripSets, rows, bindings, aliasByHwNo: new Map() });
  return { pass: output.length === 0, damagedBindings: bindings.length, rows: rows.length,
    outputs: output.length, output };
}

function lineRates(mod, faithfulOnly = true) {
  const byLine = new Map();
  for (const round of rounds) {
    if (faithfulOnly && !faithfulRoundIds.has(round.id)) continue;
    const output = joinRound(mod, round);
    const production = round.live.boardPos.trips || [];
    const rowCounts = new Map();
    for (const row of round.live.boardPos.rows) rowCounts.set(row.line, (rowCounts.get(row.line) || 0) + 1);
    const outputCounts = new Map(), outputIds = new Map(), productionIds = new Map();
    for (const trip of output) {
      outputCounts.set(trip.line, (outputCounts.get(trip.line) || 0) + 1);
      addToMapSet(outputIds, trip.line, fullKey(trip));
    }
    for (const trip of production) addToMapSet(productionIds, trip.line, fullKey(trip));
    const lines = new Set([...rowCounts.keys(), ...outputCounts.keys(), ...productionIds.keys()]);
    for (const line of lines) {
      if (!byLine.has(line)) byLine.set(line, { rows: 0, outputs: 0, productionIdentities: 0, matchedIdentities: 0 });
      const rec = byLine.get(line), prod = productionIds.get(line) || new Set(), mine = outputIds.get(line) || new Set();
      rec.rows += rowCounts.get(line) || 0;
      rec.outputs += outputCounts.get(line) || 0;
      rec.productionIdentities += prod.size;
      rec.matchedIdentities += [...prod].filter(id => mine.has(id)).length;
    }
  }
  return Object.fromEntries([...byLine].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

const sampleMinimumZ = sampleMinimumFromManifest(manifestRounds);
const minimumComparableRoundsZ = faithfulRoundIds.size;
const comparableBaselineZ = gateA(fixedLedger, faithfulRoundIds, minimumComparableRoundsZ);
const rawSampleZ = gateZ(rounds, sampleMinimumZ);
const sampleZ = { ...rawSampleZ, pass: rawSampleZ.pass && comparableBaselineZ.comparableSamplePass,
  comparableRounds: comparableBaselineZ.rounds, minimumComparableRounds: minimumComparableRoundsZ };
const sampleZThreeRoundMutation = gateZ(rounds.slice(0, 3), sampleMinimumZ);
const threeComparableRoundIds = new Set([...faithfulRoundIds].slice(0, 3));
const comparableZThreeRoundMutation = gateA(fixedLedger, threeComparableRoundIds, minimumComparableRoundsZ);
const baseline = { Z: sampleZ, A: gateA(fixedLedger), B: gateB(fixedLedger), C: gateC(fixedLedger), D: gateD(fixedLedger) };
const before = { A: gateA(dropAllLedger), B: gateB(dropAllLedger), C: gateC(dropAllLedger), D: gateD(dropAllLedger) };
const mutations = {
  'M-Z': { expectedRed: 'Z', gates: { Z: { ...sampleZThreeRoundMutation,
    comparable: comparableZThreeRoundMutation,
    pass: !(threeRoundMutationHitsEverySampleDimension(sampleZThreeRoundMutation, sampleMinimumZ) &&
      !comparableZThreeRoundMutation.comparableSamplePass) } } },
  'M-A': { expectedRed: 'A', gates: { A: gateA(dropAllLedger) } },
  'M-B': { expectedRed: 'B', gates: { B: gateB(firstRowLedger) } },
  'M-C': { expectedRed: 'C', gates: { C: gateC(allowDuplicatesLedger) } },
  'M-D': { expectedRed: 'D', gates: { D: gateD(damagedIdentityLedger) } },
};

let failures = 0;
console.log('\n【Z、A–D baseline】');
for (const [gate, result] of Object.entries(baseline)) {
  console.log(`${result.pass ? '✅' : '❌'} ${gate} ${JSON.stringify(result)}`);
  if (!result.pass) failures++;
}
console.log('\n【改前（drop-all 回歸版）】');
for (const [gate, result] of Object.entries(before)) console.log(`${result.pass ? '✅' : '❌'} ${gate} ${JSON.stringify(result)}`);

console.log('\n【Mutation controls】');
for (const [name, mutation] of Object.entries(mutations)) {
  const result = mutation.gates[mutation.expectedRed];
  const red = !result.pass;
  console.log(`${red ? '✅' : '❌'} ${name} 預期 ${mutation.expectedRed} 轉紅：${JSON.stringify(result)}`);
  if (!red) failures++;
}

console.log('\n【fixture 時序／可比較範圍】');
console.log(JSON.stringify({ totalRounds: rounds.length, faithfulRounds: faithfulRoundIds.size,
  excludedVersionSkewRounds: skew, deliberateBestCountTieExclusions: deliberateTieExclusions }, null, 2));
console.log('\n【逐線接上率原始數據（僅 old replay 與 production tuple 忠實的輪次）】');
console.log(JSON.stringify({ before: lineRates(dropAllLedger), after: lineRates(fixedLedger),
  originMain: lineRates(originLedger) }, null, 2));

console.log(`\n${failures ? `FAIL ${failures}` : 'PASS'}: join parity Z、A–D 與 mutation controls`);
process.exitCode = failures ? 1 : 0;
