#!/usr/bin/env node
// 北捷逐班綁定提早收班驗收：fixture 診斷＋A–E 不變量＋source mutation controls。
// 不打網路、不起 listener；時間基準一律使用 fixture boardPos.at／dyn.at。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fixedLedger from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = path.join(ROOT, 'scripts/trtc_board_ledger.mjs');
const ROUNDS_PATH = path.join(ROOT, 'tmp/binder-fixtures/rounds');
const CAPTURE_PATH = path.join(ROOT, 'tmp/binder-fixtures/capture.sh');
const TIMES = readJson(path.join(ROOT, 'data/trtc_times.json'));
const DAY_TYPES = readJson(path.join(ROOT, 'data/tw_daytype.json'));
const MIN_DISTINCT_DYN_AT = 8; // 擷取驗收契約：少於 8 個 cron 版本不足以觀察身分轉換。
const BASE_EPOCH = Date.UTC(2026, 7, 13, 0, 0, 0) / 1000; // 台北 08:00，serviceSec=28800

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readD1(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('[')));
}
function fullKey(binding) { return `${binding.line}|${Number(binding.dir)}|${binding.tripKey}`; }
function tripTuple(line, dir, eta) {
  return JSON.stringify([line, Number(dir), Number(eta.from), Number(eta.to), Number(eta.run), Number(eta.arrEpoch)]);
}
function addCount(map, key, amount = 1) { map[key] = (map[key] || 0) + amount; }
function activeDuplicates(bindings) {
  const tracks = new Map(), trips = new Map();
  let active = 0;
  for (const binding of bindings || []) {
    if (!binding || binding.done) continue;
    active++;
    const track = String(binding.trackId || '');
    tracks.set(track, (tracks.get(track) || 0) + 1);
    trips.set(fullKey(binding), (trips.get(fullKey(binding)) || 0) + 1);
  }
  return {
    active,
    duplicateTrackIds: [...tracks.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0),
    duplicateTripKeys: [...trips.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0),
  };
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

const ids = declaredFixtureRoundIds();
validateFixtureTriplets(ids);
const manifestRounds = ids.map(id => {
  const dyn = JSON.parse(readD1(path.join(ROUNDS_PATH, `${id}_dyn.json`))[0].results[0].v);
  const aliases = new Map((readD1(path.join(ROUNDS_PATH, `${id}_alias.json`))[0].results || [])
    .map(row => [String(row.alias), String(row.track_id)]));
  return { id, dyn, aliases, live: readJson(path.join(ROUNDS_PATH, `${id}_live.json`)) };
});
const rounds = manifestRounds;

function sampleBindingIdentity(binding) {
  return [binding.line, Number(binding.dir), binding.tripKey, String(binding.trackId || '')].join('\0');
}

function normalizedSampleLastArrEpoch(binding) {
  return binding.lastArrEpoch != null && Number.isFinite(Number(binding.lastArrEpoch))
    ? Number(binding.lastArrEpoch) : null;
}

function eligibleSampleRows(roundSubset) {
  const byLine = {};
  for (const round of roundSubset) for (const row of round.live.boardPos.rows || []) {
    if (Number(row.from) === Number(row.to) && Number(row.run) === 0) continue;
    if (Number(row.arrEpoch) - Number(round.live.boardPos.at) < -5) continue;
    addCount(byLine, row.line);
  }
  return byLine;
}

function fixtureSampleProfile(roundSubset) {
  const dynByAt = new Map();
  for (const round of roundSubset) {
    const at = Number(round.dyn.at);
    if (!dynByAt.has(at)) dynByAt.set(at, round.dyn);
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
      addCount(trueUpdatesByLine, after.line);
    }
  }
  return { rounds: roundSubset.length, distinctDynAt: snapshots.length,
    eligibleRowsByLine: eligibleSampleRows(roundSubset), trueUpdatesByLine };
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

function tripMapFor(mod, day) {
  const { tripSets } = mod.buildTripSetsByLineDir(TIMES, DAY_TYPES, day);
  const tripByFullKey = new Map();
  for (const [gk, trips] of tripSets) for (const trip of trips) {
    tripByFullKey.set(`${gk}|${mod.tripKeyOf(trip)}`, trip);
  }
  return { tripSets, tripByFullKey };
}

function rowShift(mod, row, trip) {
  const arrSec = mod.trtcServiceSecOfEpoch(row.arrEpoch);
  const depSec = row.terminal ? arrSec : arrSec - Number(row.run);
  let scheduled;
  if (row.terminal) {
    if (Number(trip[0]) !== Number(row.from)) return null;
    scheduled = trip[1];
  } else {
    const k = mod.tripLegIndex(trip, Number(row.from), Number(row.to));
    if (k < 0) return null;
    scheduled = trip[(k - 1) * 2 + 1];
  }
  return depSec - scheduled;
}

function classifyTrigger(mod, binding, trip, at) {
  // 舊快照沒有保存 `_reachedEnd`／當輪 claims，不能用「欄位有變」冒充 updatedFullKeys。
  // 但 done 後 record 會凍結：lastTo 不是終點可結構性排除 reachedEnd；是終點則只列 possible。
  const reached = !!trip && Number(binding.lastTo) === Number(trip.at(-2)) &&
    Number.isFinite(Number(binding.lastArrEpoch)) && Number(binding.lastArrEpoch) <= Number(at);
  const schedule = !!trip && mod.trtcServiceSecOfEpoch(at) >=
    Number(trip.at(-1)) + Number(binding.lastShift) + 120;
  return reached && schedule ? 'both' : reached ? 'reachedEnd' : schedule ? 'scheduleGraceOver' : 'unknown';
}

function measureFixtures(mod) {
  const uniqueDyn = [];
  for (const round of rounds) if (!uniqueDyn.length || uniqueDyn.at(-1).dyn.at !== round.dyn.at) uniqueDyn.push(round);
  const finalRound = uniqueDyn.at(-1);
  const finalTrips = tripMapFor(mod, finalRound.dyn.day).tripByFullKey;
  const cumulative = {}, finalDone = finalRound.dyn.bindings.filter(binding => binding.done);
  for (const binding of finalDone) {
    if (!cumulative[binding.line]) cumulative[binding.line] = { done: 0, reachedEnd: 0, scheduleGraceOver: 0, both: 0, unknown: 0 };
    cumulative[binding.line].done++;
    const trip = finalTrips.get(fullKey(binding));
    const source = classifyTrigger(mod, binding, trip, finalRound.dyn.at);
    cumulative[binding.line][source]++;
  }

  const transitions = [], transitionByLine = {};
  for (let i = 1; i < uniqueDyn.length; i++) {
    const prior = new Map(uniqueDyn[i - 1].dyn.bindings.map(binding => [fullKey(binding), binding]));
    const current = uniqueDyn[i], trips = tripMapFor(mod, current.dyn.day).tripByFullKey;
    for (const binding of current.dyn.bindings) {
      if (!binding.done || prior.get(fullKey(binding))?.done) continue;
      const before = prior.get(fullKey(binding));
      const updated = !before || before.lastTo !== binding.lastTo || before.lastArrEpoch !== binding.lastArrEpoch ||
        before.lastShift !== binding.lastShift;
      const source = classifyTrigger(mod, binding, trips.get(fullKey(binding)), current.dyn.at);
      const future = [];
      for (const round of rounds) {
        if (Number(round.live.boardPos.at) <= Number(current.dyn.at)) continue;
        for (const row of round.live.boardPos.rows || []) {
          if (!row.no || round.aliases.get(String(row.no)) !== String(binding.trackId)) continue;
          future.push({ at: Number(round.live.boardPos.at), line: row.line, dir: Number(row.dir) });
        }
      }
      future.sort((a, b) => a.at - b.at);
      const firstFuture = future[0] || null;
      const continuedSameDirection = !!firstFuture && firstFuture.line === binding.line && firstFuture.dir === Number(binding.dir);
      const rec = { id: current.id, at: current.dyn.at, line: binding.line, dir: Number(binding.dir),
        trackId: binding.trackId, source, updated, firstFuture, continuedSameDirection };
      transitions.push(rec);
      if (!transitionByLine[binding.line]) transitionByLine[binding.line] =
        { doneTransitions: 0, reachedEnd: 0, scheduleGraceOver: 0, both: 0, unknown: 0,
          prematureSameDirection: 0, reverseFirst: 0, noFutureNumberedFeed: 0 };
      const line = transitionByLine[binding.line];
      line.doneTransitions++; line[source]++;
      if (continuedSameDirection) line.prematureSameDirection++;
      else if (firstFuture) line.reverseFirst++;
      else line.noFutureNumberedFeed++;
    }
  }

  // 題面 B 口徑：本輪有號 row 的 alias 找得到，但同 track 沒 active binding，只有同線同向 done。
  // 同一實體車會日內往返多趟，因此同時報 row observations 與唯一 implicated binding，不把 129 列
  // 冒充 129 個獨立 done transition。
  const suppressedByLine = {}, implicated = new Map(), suppressedCosts = [];
  for (const round of rounds) {
    const { tripByFullKey } = tripMapFor(mod, round.dyn.day);
    const activeTracks = new Set(round.dyn.bindings.filter(binding => !binding.done && binding.trackId)
      .map(binding => String(binding.trackId)));
    for (const row of round.live.boardPos.rows || []) {
      if (!row.no) continue;
      const trackId = round.aliases.get(String(row.no));
      if (!trackId || activeTracks.has(trackId)) continue;
      const candidates = [];
      for (const binding of round.dyn.bindings) {
        if (!binding.done || String(binding.trackId) !== trackId || binding.line !== row.line ||
            Number(binding.dir) !== Number(row.dir)) continue;
        const trip = tripByFullKey.get(fullKey(binding));
        if (!trip) continue;
        const shift = rowShift(mod, row, trip);
        if (shift == null) continue;
        candidates.push({ binding, trip, cost: Math.abs(shift - Number(binding.lastShift)) });
      }
      if (!candidates.length) continue;
      candidates.sort((a, b) => a.cost - b.cost || Number(b.binding.boundEpoch) - Number(a.binding.boundEpoch));
      const best = candidates[0], key = fullKey(best.binding);
      addCount(suppressedByLine, row.line);
      suppressedCosts.push(best.cost);
      implicated.set(key, { line: row.line, trigger: classifyTrigger(mod, best.binding, best.trip, round.dyn.at) });
    }
  }
  const implicatedByLine = {};
  for (const item of implicated.values()) {
    if (!implicatedByLine[item.line]) implicatedByLine[item.line] =
      { bindings: 0, reachedEnd: 0, scheduleGraceOver: 0, both: 0, unknown: 0 };
    implicatedByLine[item.line].bindings++;
    implicatedByLine[item.line][item.trigger]++;
  }

  let activeSamples = 0, duplicateTrackIds = 0, duplicateTripKeys = 0;
  for (const round of rounds) {
    const counts = activeDuplicates(round.dyn.bindings);
    activeSamples += counts.active;
    duplicateTrackIds += counts.duplicateTrackIds;
    duplicateTripKeys += counts.duplicateTripKeys;
  }
  return { rounds: rounds.length, uniqueDyn: uniqueDyn.length, cronTransitions: uniqueDyn.length - 1,
    fixtureWindow: { dynFirst: uniqueDyn[0]?.dyn.at ?? null, dynLast: uniqueDyn.at(-1)?.dyn.at ?? null,
      boardFirst: rounds[0]?.live.boardPos.at ?? null, boardLast: rounds.at(-1)?.live.boardPos.at ?? null },
    cumulative, totalDone: finalDone.length, transitions, transitionByLine,
    suppressedRows: Object.values(suppressedByLine).reduce((sum, n) => sum + n, 0), suppressedByLine,
    suppressedCostSec: {
      min: suppressedCosts.length ? Math.min(...suppressedCosts) : null,
      median: suppressedCosts.length ? [...suppressedCosts].sort((a, b) => a - b)[Math.floor(suppressedCosts.length / 2)] : null,
      max: suppressedCosts.length ? Math.max(...suppressedCosts) : null,
      withinJoinWindow: suppressedCosts.filter(cost => cost <= mod.TRIP_BIND_VISITOR_JOIN_WINDOW_SEC).length,
    },
    implicatedBindings: implicated.size, implicatedByLine,
    identity: { activeSamples, duplicateTrackIds, duplicateTripKeys } };
}

const DONE_GUARD_RE = /  \/\/ BINDER_DONE_GUARD_BEGIN[^\n]*\n[\s\S]*?  \/\/ BINDER_DONE_GUARD_END/;
const HANDOFF_RE = /      \/\/ BINDER_HANDOFF_BEGIN[^\n]*\n[\s\S]*?      \/\/ BINDER_HANDOFF_END/;
const NO_VETO_BLOCK = `  // BINDER_DONE_GUARD_BEGIN：mutation/no-observation-veto
  for (const [fullKey, rec] of records) {
    if (rec.done) continue;
    const tr = tripByFullKey.get(tripBindKey(rec.line, rec.dir, rec.tripKey));
    if (!tr) continue;
    const reachedEnd = rec.reachedEndEpoch != null;
    const scheduleGraceOver = nowSec >= tr[tr.length - 1] + rec.lastShift + TRIP_BIND_DONE_GRACE_SEC;
    if (reachedEnd || scheduleGraceOver) {
      rec.done = true;
      events.push({ type: 'done', reason: 'mutation-no-veto', day, line: rec.line, dir: rec.dir,
        tripKey: rec.tripKey, trackId: rec.trackId, epoch: nowEpoch });
      audit.done++;
    }
  }
  // BINDER_DONE_GUARD_END`;
const NEVER_DONE_BLOCK = `  // BINDER_DONE_GUARD_BEGIN：mutation/never-done
  // 故意讓所有收班條件永不成立。
  // BINDER_DONE_GUARD_END`;
const BROKEN_HANDOFF_BLOCK = `      // BINDER_HANDOFF_BEGIN：mutation/block-handoff
      // 故意不驅逐舊 trip，也不把 claim 送回出生路徑：換向交棒本體應失敗。
      // BINDER_HANDOFF_END`;

function replaceOnce(source, needle, replacement, label) {
  const hits = typeof needle === 'string' ? source.split(needle).length - 1 : (source.match(needle) || []).length;
  if (hits !== 1) throw new Error(`${label} mutation 錨點預期 1 處，實際 ${hits} 處`);
  return source.replace(needle, replacement);
}
async function mutatedModule(name, mutate) {
  const source = mutate(fs.readFileSync(LEDGER_PATH, 'utf8')) + `\n//# sourceURL=binder-done-${name}.mjs\n`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${name}`);
}

console.log('【Mutation 預期（建立 mutant 前宣告）】');
console.log('M-A 拿掉持續觀測否決：A、B 紅；C、D 綠。');
console.log('M-B 收班條件永不成立：B 紅；A、C、D 綠。');
console.log('M-C1 出生時允許同 track 綁多 trip：C 紅；A、B、D 綠。');
console.log('M-C2 輸出時允許同 trip 帶兩個 track：C 紅；A、B、D 綠。');
console.log('M-D 阻斷目的地改變時的驅逐／再出生：D 紅；A、B、C 綠。');
console.log('M-E 把 legMiss 觀測誤當失聯、容許 reclaim：A 紅；B、C、D 綠。');
console.log('M-Z 只餵 manifest 前 3 輪：Z 的輪數、dyn.at、每條有樣本線 eligible rows 與每條有真更新線的下限全部轉紅。');

const noVetoLedger = await mutatedModule('no-veto', source =>
  replaceOnce(source, DONE_GUARD_RE, NO_VETO_BLOCK, 'no-veto'));
const neverDoneLedger = await mutatedModule('never-done', source =>
  replaceOnce(source, DONE_GUARD_RE, NEVER_DONE_BLOCK, 'never-done'));
const duplicateLedger = await mutatedModule('duplicate-binding', source => replaceOnce(source,
  '    if (usedTracks.has(e.claim.trackId) || usedTripKeys.has(e.fullKey)) continue;',
  '    if (usedTripKeys.has(e.fullKey)) continue; // mutation：同 track 可同時拿多個 trip', 'duplicate-binding'));
const duplicateTripLedger = await mutatedModule('duplicate-trip', source => replaceOnce(source,
  '  const bindings = [...records.values()];',
  `  const bindings = [...records.values()];
  const mutationSeed = bindings.find(binding => !binding.done && binding.trackId);
  if (mutationSeed) bindings.push({ ...mutationSeed, trackId: \`${'${mutationSeed.trackId}'}:mutation\` });`,
  'duplicate-trip'));
const brokenHandoffLedger = await mutatedModule('broken-handoff', source =>
  replaceOnce(source, HANDOFF_RE, BROKEN_HANDOFF_BLOCK, 'broken-handoff'));
const legMissReclaimLedger = await mutatedModule('legmiss-reclaim', source => replaceOnce(source,
  '      if (rec.done || observedFullKeys.has(fullKey)) continue; // legMiss 也代表本輪仍被 feed 看見',
  '      if (rec.done || updatedFullKeys.has(fullKey)) continue; // mutation：legMiss 被誤當失聯',
  'legmiss-reclaim'));

function binding(mod, line, dir, trip, trackId, extra = {}) {
  return { line, dir, tripKey: mod.tripKeyOf(trip), trackId, boundEpoch: BASE_EPOCH - 600,
    birth: 'terminal', lastShift: 0, lastTo: trip[0], lastArrEpoch: BASE_EPOCH - 600,
    lastSeenEpoch: BASE_EPOCH - 60, reachedEndEpoch: null, badStreak: 0, done: false, rebinds: 0, ...extra };
}
function runBind(mod, { tripSets, tracks = [], priorBindings = [], nowEpoch, day = '2026-08-13' }) {
  return mod.bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks, priorBindings, nowEpoch, day });
}
function activeFor(result, trackId) { return result.bindings.filter(b => !b.done && b.trackId === trackId); }

function gateA(mod) {
  const scheduleTrip = [0, 27800, 1, 27900, 2, 28000];
  const endpointTrip = [0, 28500, 1, 28600, 2, 28700];
  const legMissTrip = [0, 29000, 1, 29200, 2, 29400];
  const tripSets = new Map([['A_SCHEDULE|2', [scheduleTrip]], ['A_ENDPOINT|2', [endpointTrip]],
    ['A_LEGMISS|2', [legMissTrip]]]);
  const priorBindings = [
    binding(mod, 'A_SCHEDULE', 2, scheduleTrip, 'track:schedule'),
    binding(mod, 'A_ENDPOINT', 2, endpointTrip, 'track:endpoint'),
    binding(mod, 'A_LEGMISS', 2, legMissTrip, 'track:legmiss'),
  ];
  const tracks = [
    { trackId: 'track:schedule', line: 'A_SCHEDULE', dir: 2, from: 0, to: 1, destIdx: 2,
      run: 100, arrEpoch: BASE_EPOCH - 900, terminal: false }, // schedule grace 已過，feed 仍在
    { trackId: 'track:endpoint', line: 'A_ENDPOINT', dir: 2, from: 1, to: 2, destIdx: 2,
      run: 100, arrEpoch: BASE_EPOCH - 10, terminal: false }, // reachedEnd=true，feed 仍在
    { trackId: 'track:legmiss', line: 'A_LEGMISS', dir: 2, from: 9, to: 8, destIdx: 2,
      run: 100, arrEpoch: BASE_EPOCH, terminal: false }, // 同線同向仍看見，但 leg 無法更新 shift
    { trackId: 'track:replacement', line: 'A_LEGMISS', dir: 2, from: 0, to: 0, destIdx: 2,
      run: 0, arrEpoch: BASE_EPOCH + 200, terminal: true }, // 不得趁 legMiss reclaim 舊 binding
  ];
  const result = runBind(mod, { tripSets, tracks, priorBindings, nowEpoch: BASE_EPOCH });
  const premature = result.events.filter(event => event.type === 'done').length;
  const legMissPreserved = activeFor(result, 'track:legmiss').length === 1;
  const legMissReattach = result.events.filter(event => event.type === 'reattach').length;
  return { pass: premature === 0 && activeFor(result, 'track:schedule').length === 1 &&
      activeFor(result, 'track:endpoint').length === 1 && legMissPreserved && legMissReattach === 0,
    candidateCases: 2, legMissCases: 1, premature, legMissPreserved, legMissReattach,
    active: result.bindings.filter(b => !b.done).length };
}

function gateB(mod) {
  const scheduleTrip = [0, 27800, 1, 27900, 2, 28000];
  const reachedTrip = [0, 31500, 1, 31600, 2, 32000];
  const tripSets = new Map([['B_SCHEDULE|2', [scheduleTrip]], ['B_REACHED|2', [reachedTrip]]]);
  const starts = [
    binding(mod, 'B_SCHEDULE', 2, scheduleTrip, 'track:silent-schedule', {
      lastSeenEpoch: BASE_EPOCH, reachedEndEpoch: null,
    }),
    binding(mod, 'B_REACHED', 2, reachedTrip, 'track:silent-reached', {
      lastSeenEpoch: BASE_EPOCH, reachedEndEpoch: BASE_EPOCH, lastTo: 2, lastArrEpoch: BASE_EPOCH,
    }),
  ];
  const before = runBind(mod, { tripSets, priorBindings: starts,
    nowEpoch: BASE_EPOCH + mod.TRIP_BIND_FEED_SILENCE_SEC - 1 });
  const boundary = runBind(mod, { tripSets, priorBindings: before.bindings,
    nowEpoch: BASE_EPOCH + mod.TRIP_BIND_FEED_SILENCE_SEC });
  const after = runBind(mod, { tripSets, priorBindings: boundary.bindings,
    nowEpoch: BASE_EPOCH + mod.TRIP_BIND_FEED_SILENCE_SEC + 1 });
  const beforeActive = activeFor(before, 'track:silent-schedule').length +
    activeFor(before, 'track:silent-reached').length;
  const boundaryDone = boundary.events.filter(event => event.type === 'done').length;
  const boundaryReasons = boundary.events.filter(event => event.type === 'done').map(event => event.reason).sort();
  const repeatedDone = after.events.filter(event => event.type === 'done').length;
  return { pass: beforeActive === 2 && boundaryDone === 2 &&
      JSON.stringify(boundaryReasons) === JSON.stringify(['reachedEnd', 'scheduleGraceOver']) && repeatedDone === 0,
    cases: starts.length, boundSec: mod.TRIP_BIND_FEED_SILENCE_SEC, beforeActive, boundaryDone,
    boundaryReasons, repeatedDone,
    finalDone: boundary.bindings.filter(item => item.done).length === starts.length };
}

function gateC(mod) {
  const tripA = [0, 28800, 1, 30000], tripB = [0, 29100, 1, 30300];
  const tripSets = new Map([['C|2', [tripA, tripB]]]);
  const tracks = [{ trackId: 'track:duplicate', line: 'C', dir: 2, from: 0, to: 1, destIdx: 1,
    run: 0, arrEpoch: BASE_EPOCH + 350, terminal: true }];
  const result = runBind(mod, { tripSets, tracks, nowEpoch: BASE_EPOCH + 350 });
  const counts = activeDuplicates(result.bindings);
  const active = result.bindings.filter(b => !b.done);
  const seed = active[0];
  // C 有兩個獨立斷言。除 source mutant 讓同一 track 實際拿到兩個 trip 外，另注入一份
  // 壞輸出，確認檢查器也真的抓得到「同一 trip 兩台車」，不讓 Map 結構造成空判準。
  const detectorControl = seed ? activeDuplicates([
    ...active,
    { ...seed, trackId: 'track:other' },
    { ...seed, tripKey: `${seed.tripKey}:other` },
  ]) : { duplicateTrackIds: 0, duplicateTripKeys: 0 };
  const detectorRed = detectorControl.duplicateTrackIds > 0 && detectorControl.duplicateTripKeys > 0;
  return { pass: counts.duplicateTrackIds === 0 && counts.duplicateTripKeys === 0 && detectorRed,
    ...counts, detectorControl: { red: detectorRed, duplicateTrackIds: detectorControl.duplicateTrackIds,
      duplicateTripKeys: detectorControl.duplicateTripKeys },
    bindings: active.map(b => ({ tripKey: b.tripKey, trackId: b.trackId })) };
}

function gateD(mod) {
  const inbound = [0, 28800, 1, 28900], outbound = [1, 29000, 0, 29100];
  const tripSets = new Map([['D|2', [inbound]], ['D|1', [outbound]]]);
  const prior = binding(mod, 'D', 2, inbound, 'track:turnback', {
    lastTo: 1, lastArrEpoch: BASE_EPOCH + 100, lastSeenEpoch: BASE_EPOCH + 100,
    reachedEndEpoch: BASE_EPOCH + 100,
  });
  const claim = { trackId: 'track:turnback', line: 'D', dir: 1, from: 1, to: 1, destIdx: 0,
    run: 0, arrEpoch: BASE_EPOCH + 200, terminal: true };
  const handoff = runBind(mod, { tripSets, tracks: [claim], priorBindings: [prior], nowEpoch: BASE_EPOCH + 200 });
  const repeat = runBind(mod, { tripSets, tracks: [{ ...claim, arrEpoch: BASE_EPOCH + 230 }],
    priorBindings: handoff.bindings, nowEpoch: BASE_EPOCH + 230 });
  const handoffBind = handoff.events.filter(event => event.type === 'bind' && event.dir === 1);
  const repeatHandoff = repeat.events.filter(event => event.type === 'bind');
  const active = handoff.bindings.filter(b => !b.done && b.trackId === 'track:turnback');
  const oldPresent = handoff.bindings.some(b => fullKey(b) === fullKey(prior));
  return { pass: handoffBind.length === 1 && repeatHandoff.length === 0 && !oldPresent &&
      active.length === 1 && active[0].dir === 1 && active[0].tripKey === mod.tripKeyOf(outbound),
    handoffCount: handoffBind.length, repeatHandoff: repeatHandoff.length, oldPresent,
    active: active.map(b => ({ line: b.line, dir: b.dir, tripKey: b.tripKey })) };
}

function coverage(mod) {
  const byLine = {};
  let eligible = 0, matched = 0;
  for (const round of rounds) {
    const { tripSets } = tripMapFor(mod, round.dyn.day);
    const trips = mod.joinBoardRowsToTrips({ tripSets, rows: round.live.boardPos.rows,
      bindings: round.dyn.bindings, aliasByHwNo: round.aliases });
    const tuples = new Set(trips.map(trip => tripTuple(trip.line, trip.dir, trip.eta)));
    for (const row of round.live.boardPos.rows || []) {
      if (row.from === row.to && row.run === 0) continue;
      if (Number(row.arrEpoch) - Number(round.live.boardPos.at) < -5) continue;
      eligible++;
      if (!byLine[row.line]) byLine[row.line] = { eligible: 0, matched: 0 };
      byLine[row.line].eligible++;
      if (tuples.has(tripTuple(row.line, row.dir, row))) { matched++; byLine[row.line].matched++; }
    }
  }
  return { rounds: rounds.length, eligible, matched, rate: eligible ? matched / eligible : 0, byLine };
}

function selectObservedDoneCases(mod, round, tripByFullKey) {
  const activeTracks = new Set(round.dyn.bindings.filter(item => !item.done && item.trackId)
    .map(item => String(item.trackId)));
  const bestByTrack = new Map();
  for (const row of round.live.boardPos.rows || []) {
    if (!row.no) continue;
    const trackId = round.aliases.get(String(row.no));
    if (!trackId || activeTracks.has(trackId)) continue;
    for (const item of round.dyn.bindings) {
      if (!item.done || String(item.trackId) !== trackId || item.line !== row.line ||
          Number(item.dir) !== Number(row.dir)) continue;
      const trip = tripByFullKey.get(fullKey(item));
      if (!trip || Number(trip.at(-2)) !== Number(row.dest)) continue;
      const shift = rowShift(mod, row, trip);
      if (shift == null || classifyTrigger(mod, item, trip, round.live.boardPos.at) !== 'scheduleGraceOver') continue;
      const candidate = { binding: item, row, trackId, cost: Math.abs(shift - Number(item.lastShift)) };
      const prior = bestByTrack.get(trackId);
      const candidateKey = fullKey(item), priorKey = prior && fullKey(prior.binding);
      const better = !prior || candidate.cost < prior.cost ||
        (candidate.cost === prior.cost && Number(item.boundEpoch) > Number(prior.binding.boundEpoch)) ||
        (candidate.cost === prior.cost && Number(item.boundEpoch) === Number(prior.binding.boundEpoch) &&
          (candidateKey < priorKey || (candidateKey === priorKey && Number(row.arrEpoch) < Number(prior.row.arrEpoch))));
      if (better) bestByTrack.set(trackId, candidate);
    }
  }
  return [...bestByTrack.values()];
}

function accumulateCoverage(mod, round, tripSets, mergedBindings, byLine) {
  const trips = mod.joinBoardRowsToTrips({ tripSets, rows: round.live.boardPos.rows,
    bindings: mergedBindings, aliasByHwNo: round.aliases });
  const tuples = new Set(trips.map(trip => tripTuple(trip.line, trip.dir, trip.eta)));
  let eligible = 0, matched = 0;
  for (const row of round.live.boardPos.rows || []) {
    if (row.from === row.to && row.run === 0) continue;
    if (Number(row.arrEpoch) - Number(round.live.boardPos.at) < -5) continue;
    eligible++;
    if (!byLine[row.line]) byLine[row.line] = { eligible: 0, matched: 0 };
    byLine[row.line].eligible++;
    if (tuples.has(tripTuple(row.line, row.dir, row))) { matched++; byLine[row.line].matched++; }
  }
  return { eligible, matched };
}

function counterfactualReplay(mod, mode) {
  const byLine = {}, selectedByLine = {};
  let eligible = 0, matched = 0, selectedCases = 0;
  let activeSamples = 0, duplicateTrackIds = 0, duplicateTripKeys = 0;
  for (const round of rounds) {
    const { tripSets, tripByFullKey } = tripMapFor(mod, round.dyn.day);
    // 一個實體車一輪只復原一筆；這是「若該舊 binding 在本輪前仍 active」的受控反事實，
    // 不是把 day-stable alias 的所有歷史 done 同時復活。
    const selected = selectObservedDoneCases(mod, round, tripByFullKey);
    const selectedKeys = new Set(selected.map(item => fullKey(item.binding)));
    const priorBindings = selected.map(item => ({ ...item.binding, done: false,
      lastSeenEpoch: mode === 'guard' ? Number(round.live.boardPos.at)
        : Number(round.live.boardPos.at) - mod.TRIP_BIND_FEED_SILENCE_SEC,
      reachedEndEpoch: null }));
    const tracks = mode === 'guard' ? [] : selected.map(item => ({ trackId: item.trackId, line: item.row.line,
      dir: Number(item.row.dir), from: Number(item.row.from), to: Number(item.row.to),
      destIdx: Number(item.row.dest), run: Number(item.row.run), arrEpoch: Number(item.row.arrEpoch),
      terminal: !!item.row.terminal }));
    const rebound = runBind(mod, { tripSets, tracks, priorBindings,
      nowEpoch: Number(round.live.boardPos.at), day: round.dyn.day });
    const mergedBindings = [
      ...round.dyn.bindings.filter(item => !selectedKeys.has(fullKey(item))),
      ...rebound.bindings,
    ];
    const identity = activeDuplicates(mergedBindings);
    activeSamples += identity.active;
    duplicateTrackIds += identity.duplicateTrackIds;
    duplicateTripKeys += identity.duplicateTripKeys;
    selectedCases += selected.length;
    for (const item of selected) addCount(selectedByLine, item.row.line);
    const counts = accumulateCoverage(mod, round, tripSets, mergedBindings, byLine);
    eligible += counts.eligible; matched += counts.matched;
  }
  return { rounds: rounds.length, selectedCases, selectedByLine, eligible, matched,
    rate: eligible ? matched / eligible : 0, byLine,
    identity: { activeSamples, duplicateTrackIds, duplicateTripKeys } };
}

function syntheticCoverage(mod) {
  const scheduleTrip = [0, 27800, 1, 27900, 2, 28000];
  const endpointTrip = [0, 28500, 1, 28600, 2, 28700];
  const tripSets = new Map([['A_SCHEDULE|2', [scheduleTrip]], ['A_ENDPOINT|2', [endpointTrip]]]);
  const priorBindings = [binding(mod, 'A_SCHEDULE', 2, scheduleTrip, 'track:schedule'),
    binding(mod, 'A_ENDPOINT', 2, endpointTrip, 'track:endpoint')];
  const rows = [
    { line: 'A_SCHEDULE', dir: 2, from: 0, to: 1, dest: 2, run: 100, arrEpoch: BASE_EPOCH - 900, no: '', terminal: false },
    { line: 'A_ENDPOINT', dir: 2, from: 1, to: 2, dest: 2, run: 100, arrEpoch: BASE_EPOCH - 10, no: '', terminal: false },
  ];
  const tracks = rows.map(row => ({ trackId: row.line === 'A_SCHEDULE' ? 'track:schedule' : 'track:endpoint',
    line: row.line, dir: row.dir, from: row.from, to: row.to, destIdx: row.dest,
    run: row.run, arrEpoch: row.arrEpoch, terminal: row.terminal }));
  const bound = runBind(mod, { tripSets, tracks, priorBindings, nowEpoch: BASE_EPOCH });
  const joined = mod.joinBoardRowsToTrips({ tripSets, rows, bindings: bound.bindings, aliasByHwNo: new Map() });
  return { rows: rows.length, joined: joined.length };
}

const fixtures = measureFixtures(fixedLedger);
const sampleMinimumZ = sampleMinimumFromManifest(manifestRounds);
const sampleZ = gateZ(rounds, sampleMinimumZ);
const sampleZThreeRoundMutation = gateZ(rounds.slice(0, 3), sampleMinimumZ);
const modules = { fixed: fixedLedger, noVeto: noVetoLedger, neverDone: neverDoneLedger,
  duplicateTrack: duplicateLedger, duplicateTrip: duplicateTripLedger,
  brokenHandoff: brokenHandoffLedger, legMissReclaim: legMissReclaimLedger };
const results = Object.fromEntries(Object.entries(modules).map(([name, mod]) => [name,
  { A: gateA(mod), B: gateB(mod), C: gateC(mod), D: gateD(mod) }]));
const expected = {
  fixed: { A: true, B: true, C: true, D: true },
  noVeto: { A: false, B: false, C: true, D: true },
  neverDone: { A: true, B: false, C: true, D: true },
  duplicateTrack: { A: true, B: true, C: false, D: true },
  duplicateTrip: { A: true, B: true, C: false, D: true },
  brokenHandoff: { A: true, B: true, C: true, D: false },
  legMissReclaim: { A: false, B: true, C: true, D: true },
};

let failures = 0;
console.log('\n【Z 樣本量下限（從 capture manifest 與完整 fixture 結構推導）】');
console.log(`${sampleZ.pass ? '✅' : '❌'} baseline ${JSON.stringify(sampleZ)}`);
if (!sampleZ.pass) failures++;
const sampleZMutationRed = threeRoundMutationHitsEverySampleDimension(sampleZThreeRoundMutation,
  sampleMinimumZ);
console.log(`${sampleZMutationRed ? '✅' : '❌'} M-Z 預期 Z 轉紅 ${JSON.stringify(sampleZThreeRoundMutation)}`);
if (!sampleZMutationRed) failures++;
console.log('\n【Fixture 基線】');
console.log(JSON.stringify(fixtures, null, 2));
console.log('\n【A–D 與 mutation matrix】');
for (const [name, gates] of Object.entries(results)) for (const [gate, result] of Object.entries(gates)) {
  const matchedExpectation = result.pass === expected[name][gate];
  console.log(`${matchedExpectation ? '✅' : '❌'} ${name}.${gate} pass=${result.pass} expected=${expected[name][gate]} ${JSON.stringify(result)}`);
  if (!matchedExpectation) failures++;
}

const staticPersisted = coverage(fixedLedger);
const fullClaimBefore = counterfactualReplay(noVetoLedger, 'full-claim');
const fullClaimAfter = counterfactualReplay(fixedLedger, 'full-claim');
const guardBefore = counterfactualReplay(noVetoLedger, 'guard');
const guardAfter = counterfactualReplay(fixedLedger, 'guard');
const syntheticBefore = syntheticCoverage(noVetoLedger), syntheticAfter = syntheticCoverage(fixedLedger);
const identityReplayPass = fixtures.identity.duplicateTrackIds === 0 && fixtures.identity.duplicateTripKeys === 0 &&
  fullClaimBefore.identity.duplicateTrackIds === 0 && fullClaimBefore.identity.duplicateTripKeys === 0 &&
  fullClaimAfter.identity.duplicateTrackIds === 0 && fullClaimAfter.identity.duplicateTripKeys === 0 &&
  guardBefore.identity.duplicateTrackIds === 0 && guardBefore.identity.duplicateTripKeys === 0 &&
  guardAfter.identity.duplicateTrackIds === 0 && guardAfter.identity.duplicateTripKeys === 0;
console.log(`${identityReplayPass ? '✅' : '❌'} C fixture／反事實重播改前改後身分皆唯一 ` +
  JSON.stringify({ persisted: fixtures.identity, fullClaimBefore: fullClaimBefore.identity,
    fullClaimAfter: fullClaimAfter.identity, guardBefore: guardBefore.identity, guardAfter: guardAfter.identity }));
if (!identityReplayPass) failures++;
console.log('\n【E 覆蓋率（效果證據，不作 gate）】');
console.log(JSON.stringify({
  note: 'fixture 沒有 cron 當輪 claims，不能忠實產出修後 dyn。staticPersisted 是原快照；fullClaim 把同輪 visitor row 當完整 claim（會同時更新 shift），guard 則只把該 row 當 lastSeen 證據後跑收班 guard。兩者都是受控反事實，不是正確率真值。',
  staticPersisted, fullClaimBefore, fullClaimAfter, guardBefore, guardAfter,
  syntheticBefore, syntheticAfter,
}, null, 2));

console.log(`\n${failures ? `FAIL ${failures}` : 'PASS'}: binder done Z、A–E 與 mutation controls`);
process.exitCode = failures ? 1 : 0;
