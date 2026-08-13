#!/usr/bin/env node
// 派工②第一步：用落盤 fixture 判別 45 秒 join 失敗的量級、出生 ref 密度、
// 綁定 shift 形態與固定站點班距。結果若為「乙」只交診斷，不改 join 窗或班表。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTripSetsByLineDir,
  joinBoardRowsToTrips,
  tripKeyOf,
  tripLegIndex,
  trtcServiceSecOfEpoch,
  TRIP_BIND_REF_WINDOW_SEC,
  TRIP_BIND_VISITOR_JOIN_WINDOW_SEC,
} from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS_PATH = path.join(ROOT, 'tmp/binder-fixtures/rounds');
const TIMES = readJson(path.join(ROOT, 'data/trtc_times.json'));
const DAY_TYPES = readJson(path.join(ROOT, 'data/tw_daytype.json'));
const TARGET_LINES = ['BR', 'Y', 'BL', 'R'];
const LIVE_WINDOW_GRACE_SEC = 5;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readD1(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('[')));
}
function median(values) { return quantile(values, 0.5); }
function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function mad(values) {
  const center = median(values);
  return center == null ? null : median(values.map(value => Math.abs(value - center)));
}
function summary(values) {
  return { n: values.length, p10: quantile(values, 0.1), p50: quantile(values, 0.5),
    p90: quantile(values, 0.9), min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null };
}
function bindingKey(binding) { return `${binding.line}|${Number(binding.dir)}|${binding.tripKey}`; }
function exactIdentity(binding) {
  return [String(binding.trackId), binding.line, Number(binding.dir), binding.tripKey].join('\0');
}
function tripIdentity(binding) {
  return [binding.line, Number(binding.dir), binding.tripKey].join('\0');
}
function normalizedLastArrEpoch(binding) {
  return binding.lastArrEpoch != null && Number.isFinite(Number(binding.lastArrEpoch))
    ? Number(binding.lastArrEpoch) : null;
}

const roundIds = [...new Set(fs.readdirSync(ROUNDS_PATH).map(file => file.slice(0, 2)))].sort();
const rounds = roundIds.map(id => {
  const dyn = JSON.parse(readD1(path.join(ROUNDS_PATH, `${id}_dyn.json`))[0].results[0].v);
  const aliases = new Map((readD1(path.join(ROUNDS_PATH, `${id}_alias.json`))[0].results || [])
    .map(row => [String(row.alias), String(row.track_id)]));
  const live = readJson(path.join(ROUNDS_PATH, `${id}_live.json`));
  return { id, dyn, aliases, live, boardAt: Number(live.boardPos.at) };
}).sort((a, b) => a.boardAt - b.boardAt || a.id.localeCompare(b.id));

function uniqueDynSnapshots() {
  const byAt = new Map();
  for (const round of rounds) if (!byAt.has(Number(round.dyn.at))) byAt.set(Number(round.dyn.at), round.dyn);
  return [...byAt.values()].sort((a, b) => Number(a.at) - Number(b.at));
}
const uniqueDyn = uniqueDynSnapshots();

function tripMapsFor(day) {
  const { tripSets } = buildTripSetsByLineDir(TIMES, DAY_TYPES, day);
  const tripByFullKey = new Map();
  for (const [groupKey, trips] of tripSets) {
    const separator = groupKey.lastIndexOf('|');
    const line = groupKey.slice(0, separator), dir = Number(groupKey.slice(separator + 1));
    for (const trip of trips) tripByFullKey.set(`${line}|${dir}|${tripKeyOf(trip)}`, trip);
  }
  return { tripSets, tripByFullKey };
}

function rowShift(row, trip) {
  const arrivalSec = trtcServiceSecOfEpoch(Number(row.arrEpoch));
  const departureSec = row.terminal ? arrivalSec : arrivalSec - Number(row.run);
  let scheduledEvent;
  if (row.terminal) {
    if (Number(trip[0]) !== Number(row.from)) return null;
    scheduledEvent = Number(trip[1]);
  } else {
    const leg = tripLegIndex(trip, Number(row.from), Number(row.to));
    if (leg < 0) return null;
    scheduledEvent = Number(trip[(leg - 1) * 2 + 1]);
  }
  return departureSec - scheduledEvent;
}

function activeBindingsByLineDir(bindings) {
  const staged = [], fullKeyCounts = new Map(), trackIdCounts = new Map();
  for (const binding of bindings || []) {
    if (!binding || binding.done || !binding.line || !binding.tripKey ||
        ![1, 2].includes(Number(binding.dir))) continue;
    const trackId = String(binding.trackId ?? '').trim();
    if (!trackId || trackId === String(binding.tripKey).trim()) continue;
    const fullKey = bindingKey(binding);
    staged.push({ binding, fullKey, trackId });
    fullKeyCounts.set(fullKey, (fullKeyCounts.get(fullKey) || 0) + 1);
    trackIdCounts.set(trackId, (trackIdCounts.get(trackId) || 0) + 1);
  }
  const result = new Map();
  for (const item of staged) {
    if (fullKeyCounts.get(item.fullKey) !== 1 || trackIdCounts.get(item.trackId) !== 1) continue;
    const groupKey = `${item.binding.line}|${Number(item.binding.dir)}`;
    if (!result.has(groupKey)) result.set(groupKey, []);
    result.get(groupKey).push(item);
  }
  return result;
}

function classifyG(roundSubset, windowSec = TRIP_BIND_VISITOR_JOIN_WINDOW_SEC) {
  const failures = [];
  let eligibleRows = 0, unlabeledEligibleRows = 0;
  for (const round of roundSubset) {
    const { tripByFullKey } = tripMapsFor(round.dyn.day);
    const active = activeBindingsByLineDir(round.dyn.bindings);
    for (const row of round.live.boardPos.rows || []) {
      if (Number(row.from) === Number(row.to) && Number(row.run) === 0) continue;
      if (Number(row.arrEpoch) - round.boardAt < -5 || row.no) continue;
      unlabeledEligibleRows++;
      const candidates = active.get(`${row.line}|${Number(row.dir)}`) || [];
      if (!candidates.length) continue;
      let compatible = 0, minCost = Infinity;
      for (const { binding, fullKey } of candidates) {
        const trip = tripByFullKey.get(fullKey);
        if (!trip) continue;
        const shift = rowShift(row, trip);
        if (shift == null) continue;
        compatible++;
        minCost = Math.min(minCost, Math.abs(shift - Number(binding.lastShift)));
      }
      if (!compatible || !(minCost > windowSec)) continue;
      failures.push({ id: round.id, line: row.line, dir: Number(row.dir), minCost,
        bucket: minCost < 60 ? '<60' : minCost < 180 ? '60-180' : '>=180' });
    }
  }
  // 上面的 row.no 早退會漏算有號母體；另以相同 eligibility 條件補回總列數。
  eligibleRows = roundSubset.reduce((sum, round) => sum + (round.live.boardPos.rows || []).filter(row =>
    !(Number(row.from) === Number(row.to) && Number(row.run) === 0) &&
    Number(row.arrEpoch) - round.boardAt >= -5).length, 0);
  const byLine = {};
  for (const failure of failures) {
    if (!byLine[failure.line]) byLine[failure.line] = { total: 0, '<60': 0, '60-180': 0, '>=180': 0, costs: [] };
    const rec = byLine[failure.line]; rec.total++; rec[failure.bucket]++; rec.costs.push(failure.minCost);
  }
  for (const rec of Object.values(byLine)) { rec.medianMinCost = median(rec.costs); delete rec.costs; }
  const bins = { '<60': 0, '60-180': 0, '>=180': 0 };
  for (const failure of failures) bins[failure.bucket]++;
  const result = { rounds: roundSubset.length, rawRows: roundSubset.reduce((sum, round) =>
      sum + (round.live.boardPos.rows || []).length, 0), eligibleRows, unlabeledEligibleRows,
    failures: failures.length, bins, byLine };
  result.verdict = isVerdictB(result) ? '乙：量級不對為多數' : '甲／乙未能由本批分開';
  return result;
}

// 結構判準：量級不對（>=180s）必須多於其餘兩桶合計，才能宣告乙。
// 這是比例關係，不是寫死本批 101/120 筆的觀測數字。
function isVerdictB(result) {
  return result.failures > 0 &&
    result.bins['>=180'] > result.bins['<60'] + result.bins['60-180'];
}

function activeGroup(snapshot, line, dir = null) {
  return (snapshot.bindings || []).filter(binding => binding && !binding.done &&
    binding.line === line && (dir == null || Number(binding.dir) === Number(dir)) &&
    Number.isFinite(Number(binding.lastShift)));
}

function snapshotDispersion(line, dir) {
  const snapshots = [], pooled = [];
  let observations = 0, far180 = 0;
  for (const snapshot of uniqueDyn) {
    const values = activeGroup(snapshot, line, dir).map(binding => Number(binding.lastShift));
    if (!values.length) continue;
    const center = median(values);
    snapshots.push({ at: Number(snapshot.at), n: values.length, median: center, mad: mad(values) });
    observations += values.length; pooled.push(...values);
    far180 += values.filter(value => Math.abs(value - center) > 180).length;
  }
  return { observations, pooledMedian: median(pooled), medianSnapshotMad: median(snapshots.map(x => x.mad)),
    far180, snapshots };
}

function exactShiftDynamics(line, countPersistedAsUpdate = false) {
  let previousActive = 0, retained = 0, persistedWithoutUpdate = 0;
  const deltas = [];
  for (let index = 1; index < uniqueDyn.length; index++) {
    const previous = activeGroup(uniqueDyn[index - 1], line);
    const current = activeGroup(uniqueDyn[index], line);
    const currentByIdentity = new Map();
    for (const binding of current) {
      const key = exactIdentity(binding);
      if (currentByIdentity.has(key)) throw new Error(`重複 active binding identity: ${key}`);
      currentByIdentity.set(key, binding);
    }
    previousActive += previous.length;
    for (const before of previous) {
      const after = currentByIdentity.get(exactIdentity(before));
      if (!after) continue;
      retained++;
      const updated = normalizedLastArrEpoch(before) !== normalizedLastArrEpoch(after);
      if (!updated) persistedWithoutUpdate++;
      if (!updated && !countPersistedAsUpdate) continue;
      deltas.push(Math.abs(Number(after.lastShift) - Number(before.lastShift)));
    }
  }
  return { previousActive, retained, persistedWithoutUpdate, updated: deltas.length,
    medianDelta: median(deltas), p90Delta: quantile(deltas, 0.9), maxDelta: deltas.length ? Math.max(...deltas) : null,
    over45: deltas.filter(delta => delta > TRIP_BIND_VISITOR_JOIN_WINDOW_SEC).length,
    atLeast180: deltas.filter(delta => delta >= 180).length };
}

function sameTripDynamics(line) {
  let previousActive = 0, retainedTrip = 0, trackChanged = 0;
  const deltas = [];
  for (let index = 1; index < uniqueDyn.length; index++) {
    const previous = activeGroup(uniqueDyn[index - 1], line);
    const current = activeGroup(uniqueDyn[index], line);
    const currentByTrip = new Map();
    for (const binding of current) {
      const key = tripIdentity(binding);
      if (currentByTrip.has(key)) throw new Error(`重複 active trip: ${key}`);
      currentByTrip.set(key, binding);
    }
    previousActive += previous.length;
    for (const before of previous) {
      const after = currentByTrip.get(tripIdentity(before));
      if (!after) continue;
      retainedTrip++;
      if (String(before.trackId) !== String(after.trackId)) trackChanged++;
      if (normalizedLastArrEpoch(before) === normalizedLastArrEpoch(after)) continue;
      deltas.push(Math.abs(Number(after.lastShift) - Number(before.lastShift)));
    }
  }
  return { previousActive, retainedTrip, trackChanged, updated: deltas.length,
    medianDelta: median(deltas), p90Delta: quantile(deltas, 0.9), maxDelta: deltas.length ? Math.max(...deltas) : null,
    over45: deltas.filter(delta => delta > TRIP_BIND_VISITOR_JOIN_WINDOW_SEC).length,
    atLeast180: deltas.filter(delta => delta >= 180).length };
}

function measureShiftShape(countPersistedAsUpdate = false) {
  const byLineDir = {}, dynamics = {};
  for (const line of TARGET_LINES) {
    byLineDir[line] = {};
    for (const dir of [1, 2]) byLineDir[line][dir] = snapshotDispersion(line, dir);
    dynamics[line] = exactShiftDynamics(line, countPersistedAsUpdate);
  }
  return { liveRounds: rounds.length, uniqueDyn: uniqueDyn.length, cronTransitions: uniqueDyn.length - 1,
    byLineDir, dynamics, sameTripY: sameTripDynamics('Y') };
}

function assertShiftShape(result) {
  return TARGET_LINES.every(line => {
    const rec = result.dynamics[line];
    return rec.updated > 0 && rec.updated + rec.persistedWithoutUpdate === rec.retained;
  }) && TARGET_LINES.every(line =>
    [1, 2].every(dir => result.byLineDir[line][dir].observations > 0));
}

function refMembers(bindings, birth, includeSamePassBirth = false) {
  const birthEpoch = Number(birth.boundEpoch);
  return (bindings || []).filter(binding => binding && !binding.done &&
    binding.line === birth.line && Number(binding.dir) === Number(birth.dir) &&
    Number.isFinite(Number(binding.boundEpoch)) &&
    (includeSamePassBirth ? Number(binding.boundEpoch) <= birthEpoch : Number(binding.boundEpoch) < birthEpoch) &&
    birthEpoch - Number(binding.boundEpoch) <= TRIP_BIND_REF_WINDOW_SEC);
}

function visibleBirthsBetween(previous, current, keySetOnly = false) {
  const previousKeys = new Set((previous.bindings || []).map(bindingKey));
  return (current.bindings || []).filter(binding => {
    if (!binding || !Number.isFinite(Number(binding.boundEpoch))) return false;
    return keySetOnly
      ? !previousKeys.has(bindingKey(binding))
      : Number(binding.boundEpoch) > Number(previous.at);
  });
}

// ref 在 sticky 更新之後、safety/reclaim/done 之前計算。快照只有整輪最終狀態，
// 因此只能排除「可觀測」的時序歧義；通過仍只稱 conditional proxy，不冒充 runtime audit。
function reconstructedRef(previous, current, birth, ignoreAmbiguity = false,
  includeSamePassBirth = false) {
  const birthEpoch = Number(birth.boundEpoch);
  const previousByKey = new Map((previous.bindings || []).map(binding => [bindingKey(binding), binding]));
  const currentByKey = new Map((current.bindings || []).map(binding => [bindingKey(binding), binding]));
  const eligible = binding => binding && !binding.done && binding.line === birth.line &&
    Number(binding.dir) === Number(birth.dir) && Number.isFinite(Number(binding.boundEpoch)) &&
    Number(binding.boundEpoch) < birthEpoch &&
    birthEpoch - Number(binding.boundEpoch) <= TRIP_BIND_REF_WINDOW_SEC;
  const issues = [];

  for (const before of (previous.bindings || []).filter(eligible)) {
    const after = currentByKey.get(bindingKey(before));
    if (!after) {
      issues.push({ type: 'active-disappeared', key: bindingKey(before) });
      continue;
    }
    if (after.done && Number(after.boundEpoch) === Number(before.boundEpoch)) {
      issues.push({ type: 'active-to-done', key: bindingKey(before) });
      continue;
    }
    if (Number(after.boundEpoch) !== Number(before.boundEpoch)) {
      // 同 key 在兩個 pass 內換人：若 badStreak 從 0/1 起跑，兩 pass 內不可能達
      // safety 的連續 4 次；可結構性排除「先貢獻 ref 再被 safety 拔掉」。
      const explainedPreRefReplacement = bindingKey(after) === bindingKey(birth) &&
        Number(after.boundEpoch) === birthEpoch && Number(before.badStreak || 0) < 2;
      if (!explainedPreRefReplacement) {
        issues.push({ type: 'bound-epoch-changed', key: bindingKey(before) });
      }
      continue;
    }
    if (String(after.trackId) !== String(before.trackId)) {
      issues.push({ type: 'track-reattached', key: bindingKey(before) });
    }
  }

  // 前後快照間的 round1 newborn 沒有中間狀態。即使最終 active，也無法區分
  // round2 ref 前的 sticky 更新，與 ref 後的 reclaim 改寫 lastShift，故一律 fail closed。
  for (const after of current.bindings || []) {
    if (!after || after.line !== birth.line || Number(after.dir) !== Number(birth.dir)) continue;
    const epoch = Number(after.boundEpoch);
    if (!(epoch > Number(previous.at) && epoch < birthEpoch && birthEpoch - epoch <= TRIP_BIND_REF_WINDOW_SEC)) continue;
    if (!previousByKey.has(bindingKey(after))) {
      issues.push({ type: 'intermediate-birth-no-midstate', key: bindingKey(after), finalDone: !!after.done });
    }
  }

  const members = refMembers(current.bindings, birth, includeSamePassBirth);
  const pass = birthEpoch === Number(current.at) ? 2 : 1;
  const conditional = pass === 2 && (ignoreAmbiguity || issues.length === 0);
  const ref = conditional ? median(members.map(item => Number(item.lastShift))) || 0 : null;
  return { pass, conditional, members, issues, ref,
    samePassMembers: members.filter(item => Number(item.boundEpoch) === birthEpoch).length };
}

function measureBirthRefs({ keySetOnly = false, includeSamePassBirth = false,
  ignoreAmbiguity = false } = {}) {
  const births = [];
  for (let index = 1; index < uniqueDyn.length; index++) {
    const previous = uniqueDyn[index - 1], current = uniqueDyn[index];
    for (const binding of visibleBirthsBetween(previous, current, keySetOnly)) {
      if (!TARGET_LINES.includes(binding.line)) continue;
      const rebuilt = reconstructedRef(previous, current, binding, ignoreAmbiguity, includeSamePassBirth);
      const ref = rebuilt.ref;
      births.push({ line: binding.line, dir: Number(binding.dir), boundEpoch: Number(binding.boundEpoch),
        persistedAt: Number(current.at), pass: rebuilt.pass, refCount: rebuilt.members.length,
        samePassMembers: rebuilt.samePassMembers, observableAmbiguities: rebuilt.issues,
        conditionalProxy: rebuilt.conditional, ref,
        shift: rebuilt.conditional ? Number(binding.lastShift) : null,
        cost: rebuilt.conditional ? Math.abs(Number(binding.lastShift) - ref) : null });
    }
  }
  const byLine = {};
  for (const line of TARGET_LINES) {
    const lineBirths = births.filter(birth => birth.line === line);
    byLine[line] = { births: lineBirths.length, refCounts: lineBirths.map(birth => birth.refCount).sort((a, b) => a - b),
      sparseLe2: lineBirths.filter(birth => birth.refCount <= 2).length,
      pass2Candidates: lineBirths.filter(birth => birth.pass === 2).length,
      conditionalRound2: lineBirths.filter(birth => birth.conditionalProxy).length,
      conditionalCosts: lineBirths.filter(birth => birth.cost != null).map(birth => birth.cost),
      observableAmbiguities: lineBirths.reduce((sum, birth) => sum + birth.observableAmbiguities.length, 0) };
  }
  return { liveRounds: rounds.length, uniqueDyn: uniqueDyn.length, cronTransitions: uniqueDyn.length - 1,
    firstSnapshotBindingsExcluded: (uniqueDyn[0]?.bindings || []).length, births: births.length, byLine,
    observableAmbiguities: births.reduce((sum, birth) => sum + birth.observableAmbiguities.length, 0),
    details: births };
}

function assertBirthRefs(result) {
  return result.firstSnapshotBindingsExcluded > 0 && TARGET_LINES.every(line => result.byLine[line].births > 0) &&
    result.details.every(item => Number.isInteger(item.refCount) && item.refCount >= 0 &&
      item.samePassMembers === 0 && (item.pass === 1
        ? item.cost == null && item.ref == null && !item.conditionalProxy
        : item.conditionalProxy
          ? Number.isFinite(item.cost) && Number.isFinite(item.ref) && Number.isFinite(item.shift)
          : item.observableAmbiguities.length > 0)) &&
    result.details.some(item => item.conditionalProxy);
}

function stationStreamKey(row) {
  return [row.line, Number(row.dir), Number(row.to), Number(row.dest)].join('\0');
}
function observationsByStream(lines, numberedOnly = false) {
  const streams = new Map();
  for (const round of rounds) {
    const seenThisRound = new Set();
    for (const row of round.live.boardPos.rows || []) {
      if (!lines.includes(row.line) || (numberedOnly && !row.no)) continue;
      const key = stationStreamKey(row);
      if (seenThisRound.has(key)) throw new Error(`同輪固定站流重複，拒絕採陣列第一列: ${round.id} ${key}`);
      seenThisRound.add(key);
      if (!streams.has(key)) streams.set(key, []);
      streams.get(key).push({ ...row, at: round.boardAt, no: String(row.no || '') });
    }
  }
  return streams;
}

function calibrateEpisodeJump() {
  const streams = observationsByStream(['BL', 'R'], true);
  const sameVehicle = [], changedVehicle = [];
  let changedNonPositive = 0;
  for (const observations of streams.values()) {
    observations.sort((a, b) => a.at - b.at);
    for (let index = 1; index < observations.length; index++) {
      const before = observations[index - 1], after = observations[index];
      const delta = Number(after.arrEpoch) - Number(before.arrEpoch);
      if (before.no === after.no) sameVehicle.push(delta);
      else if (delta > 0) changedVehicle.push(delta);
      else changedNonPositive++;
    }
  }
  const maxSame = Math.max(...sameVehicle), minChanged = Math.min(...changedVehicle);
  if (!sameVehicle.length || !changedVehicle.length || changedNonPositive > 0 || !(maxSame < minChanged)) {
    throw new Error('有號控制組的同車 ETA 修訂與換車區間沒有分離，無號 episode 必須 fail closed');
  }
  return { sameVehicle: summary(sameVehicle), changedVehicle: summary(changedVehicle), maxSame, minChanged,
    changedNonPositive, episodeJumpSec: Math.floor((maxSame + minChanged) / 2) };
}

function episodesOf(observations, hasIdentity, jumpSec, streamKey) {
  const episodes = [];
  for (const observation of [...observations].sort((a, b) => a.at - b.at)) {
    let episode = episodes.at(-1);
    const switched = episode && (hasIdentity
      ? observation.no !== episode.no
      : Number(observation.arrEpoch) - episode.lastEta > jumpSec);
    if (!episode || switched) {
      episode = { no: observation.no || '', etas: [], lastEta: Number(observation.arrEpoch), streamKey };
      episodes.push(episode);
    }
    episode.etas.push(Number(observation.arrEpoch));
    episode.lastEta = Number(observation.arrEpoch);
  }
  return episodes.map(episode => ({ ...episode, center: median(episode.etas) }));
}

function intervalHeads(episodes, jumpSec, lower, upper) {
  const result = [];
  for (let index = 1; index < episodes.length; index++) {
    const before = episodes[index - 1], after = episodes[index];
    const interval = after.center - before.center;
    if (interval > jumpSec && before.center >= lower && before.center <= upper) {
      result.push({ seconds: interval, fromStreamKey: before.streamKey, toStreamKey: after.streamKey,
        fromCenter: before.center, toCenter: after.center });
    }
  }
  return result;
}

function selectScheduleHeads(arrivals, lower, upper, ignoreWindow = false) {
  const heads = [];
  let outsideWindowIncluded = 0;
  for (let index = 1; index < arrivals.length; index++) {
    const inside = arrivals[index - 1] >= lower && arrivals[index - 1] <= upper;
    if ((ignoreWindow || inside) && arrivals[index] > arrivals[index - 1]) {
      heads.push(arrivals[index] - arrivals[index - 1]);
      if (!inside) outsideWindowIncluded++;
    }
  }
  return { heads, outsideWindowIncluded };
}

function scheduleHeads(line, dayType, stream, lower, upper, ignoreWindow = false) {
  const arrivals = [];
  let repeatedStationTrips = 0;
  for (const trip of TIMES.lines?.[line]?.sets?.[dayType] || []) {
    const dir = Number(trip.at(-2)) > Number(trip[0]) ? 2 : 1;
    if (Number(trip.at(-2)) !== stream.dest || dir !== stream.dir) continue;
    const hits = [];
    for (let index = 0; index < trip.length; index += 2) {
      if (Number(trip[index]) === stream.to) hits.push(Number(trip[index + 1]));
    }
    if (hits.length !== 1) { if (hits.length > 1) repeatedStationTrips++; continue; }
    arrivals.push(hits[0]);
  }
  arrivals.sort((a, b) => a - b);
  return { ...selectScheduleHeads(arrivals, lower, upper, ignoreWindow), repeatedStationTrips };
}

function collectLiveHeads(streams, hasIdentity, jumpSec, lower, upper, crossStreams = false) {
  const episodesByStream = new Map();
  for (const [key, observations] of streams) {
    episodesByStream.set(key, episodesOf(observations, hasIdentity, jumpSec, key));
  }
  const headsByStream = new Map();
  if (crossStreams) {
    const mixed = [...episodesByStream.values()].flat().sort((a, b) => a.center - b.center);
    for (const head of intervalHeads(mixed, jumpSec, lower, upper)) {
      if (!headsByStream.has(head.fromStreamKey)) headsByStream.set(head.fromStreamKey, []);
      headsByStream.get(head.fromStreamKey).push(head);
    }
  } else {
    for (const [key, episodes] of episodesByStream) {
      headsByStream.set(key, intervalHeads(episodes, jumpSec, lower, upper));
    }
  }
  const all = [...headsByStream.values()].flat();
  return { headsByStream,
    crossStreamIntervals: all.filter(head => head.fromStreamKey !== head.toStreamKey).length };
}

function measureHeadways({ crossStreams = false, ignoreScheduleWindow = false } = {}) {
  const calibration = calibrateEpisodeJump();
  const dayTypes = new Set(rounds.map(round => round.live.boardPos.dayType));
  if (dayTypes.size !== 1) throw new Error(`fixture 跨日型，拒絕混算班距: ${[...dayTypes]}`);
  const dayType = [...dayTypes][0], liveLower = rounds[0].boardAt - LIVE_WINDOW_GRACE_SEC,
    liveUpper = rounds.at(-1).boardAt, lower = trtcServiceSecOfEpoch(liveLower),
    upper = trtcServiceSecOfEpoch(liveUpper);
  const byLine = {};
  for (const line of TARGET_LINES) {
    const hasIdentity = line === 'BL' || line === 'R';
    const streams = observationsByStream([line], hasIdentity);
    const live = collectLiveHeads(streams, hasIdentity, calibration.episodeJumpSec,
      liveLower, liveUpper, crossStreams);
    const rawLive = [], rawSchedule = [], pairs = [];
    let liveStreams = 0, scheduleStreams = 0, repeatedStationTrips = 0, outsideScheduleIntervalsIncluded = 0;
    for (const [key, headRecords] of live.headsByStream) {
      const parts = key.split('\0');
      const stream = { line: parts[0], dir: Number(parts[1]), to: Number(parts[2]), dest: Number(parts[3]) };
      const liveHeads = headRecords.map(head => head.seconds);
      if (!liveHeads.length) continue;
      liveStreams++; rawLive.push(...liveHeads);
      const scheduled = scheduleHeads(line, dayType, stream, lower, upper, ignoreScheduleWindow);
      repeatedStationTrips += scheduled.repeatedStationTrips;
      outsideScheduleIntervalsIncluded += scheduled.outsideWindowIncluded;
      if (scheduled.heads.length) { scheduleStreams++; rawSchedule.push(...scheduled.heads); }
      if (!scheduled.heads.length) continue;
      const liveMedian = median(liveHeads), scheduleMedian = median(scheduled.heads);
      pairs.push({ key, liveMedian, scheduleMedian, ratio: liveMedian / scheduleMedian,
        differenceSec: liveMedian - scheduleMedian });
    }
    byLine[line] = { liveIntervals: summary(rawLive), liveStreams, scheduleIntervals: summary(rawSchedule),
      scheduleStreams, pairedStreams: pairs.length, ratio: summary(pairs.map(pair => pair.ratio)),
      differenceSec: summary(pairs.map(pair => pair.differenceSec)), repeatedStationTrips,
      crossStreamIntervals: live.crossStreamIntervals, outsideScheduleIntervalsIncluded };
  }
  return { rounds: rounds.length, startAt: rounds[0].boardAt, endAt: rounds.at(-1).boardAt,
    liveWindowStartAt: liveLower, liveWindowEndAt: liveUpper,
    scheduleWindowStartSec: lower, scheduleWindowEndSec: upper,
    spanSec: rounds.at(-1).boardAt - rounds[0].boardAt, dayType, calibration, byLine };
}

function assertHeadways(result) {
  return result.calibration.changedNonPositive === 0 &&
    result.scheduleWindowStartSec === trtcServiceSecOfEpoch(result.liveWindowStartAt) &&
    result.scheduleWindowEndSec === trtcServiceSecOfEpoch(result.liveWindowEndAt) &&
    TARGET_LINES.every(line => result.byLine[line].pairedStreams > 0 &&
      result.byLine[line].crossStreamIntervals === 0 &&
      result.byLine[line].outsideScheduleIntervalsIncluded === 0);
}

function currentCoverage() {
  const byLine = {};
  let eligible = 0, matched = 0;
  for (const round of rounds) {
    const { tripSets } = tripMapsFor(round.dyn.day);
    const joined = joinBoardRowsToTrips({ tripSets, rows: round.live.boardPos.rows,
      bindings: round.dyn.bindings, aliasByHwNo: round.aliases });
    const tupleCounts = new Map();
    for (const trip of joined) {
      const tuple = JSON.stringify([trip.line, Number(trip.dir), Number(trip.eta.from),
        Number(trip.eta.to), Number(trip.eta.run), Number(trip.eta.arrEpoch)]);
      tupleCounts.set(tuple, (tupleCounts.get(tuple) || 0) + 1);
    }
    for (const row of round.live.boardPos.rows || []) {
      if (Number(row.from) === Number(row.to) && Number(row.run) === 0) continue;
      if (Number(row.arrEpoch) - round.boardAt < -5) continue;
      eligible++;
      if (!byLine[row.line]) byLine[row.line] = { eligible: 0, matched: 0 };
      byLine[row.line].eligible++;
      const tuple = JSON.stringify([row.line, Number(row.dir), Number(row.from), Number(row.to),
        Number(row.run), Number(row.arrEpoch)]);
      if ((tupleCounts.get(tuple) || 0) > 0) {
        matched++; byLine[row.line].matched++;
        tupleCounts.set(tuple, tupleCounts.get(tuple) - 1);
      }
    }
  }
  for (const rec of Object.values(byLine)) rec.rate = rec.eligible ? rec.matched / rec.eligible : 0;
  return { rounds: rounds.length, eligible, matched, rate: eligible ? matched / eligible : 0, byLine };
}

function syntheticBirthDetectorGate(keySetOnly) {
  const previous = { at: 100, bindings: [
    { line: 'TEST', dir: 1, tripKey: 'SAME', trackId: 'OLD', boundEpoch: 50 },
    { line: 'TEST', dir: 1, tripKey: 'STABLE', trackId: 'KEEP', boundEpoch: 50 },
  ] };
  const current = { at: 200, bindings: [
    { line: 'TEST', dir: 1, tripKey: 'SAME', trackId: 'NEW', boundEpoch: 150 },
    { line: 'TEST', dir: 1, tripKey: 'STABLE', trackId: 'KEEP', boundEpoch: 50 },
  ] };
  const births = visibleBirthsBetween(previous, current, keySetOnly);
  return births.length === 1 && births[0].tripKey === 'SAME';
}

function syntheticAmbiguityGate(ignoreAmbiguity) {
  const contributor = { line: 'TEST', dir: 1, tripKey: 'OLD', trackId: 'T1',
    boundEpoch: 50, lastShift: 10, done: false };
  const birth = { line: 'TEST', dir: 1, tripKey: 'NEW', trackId: 'T2',
    boundEpoch: 200, lastShift: 20, done: false };
  const previous = { at: 100, bindings: [contributor] };
  const current = { at: 200, bindings: [{ ...contributor, done: true }, birth] };
  const rebuilt = reconstructedRef(previous, current, birth, ignoreAmbiguity);
  return !rebuilt.conditional && rebuilt.issues.some(issue => issue.type === 'active-to-done');
}

function syntheticIntermediateBirthGate(ignoreAmbiguity) {
  const birth = { line: 'TEST', dir: 1, tripKey: 'ROUND2', trackId: 'T2',
    boundEpoch: 200, lastShift: 20, done: false };
  const round1 = { line: 'TEST', dir: 1, tripKey: 'ROUND1', trackId: 'T1',
    boundEpoch: 150, lastShift: 10, done: false };
  const previous = { at: 100, bindings: [] };
  const current = { at: 200, bindings: [round1, birth] };
  const rebuilt = reconstructedRef(previous, current, birth, ignoreAmbiguity);
  return !rebuilt.conditional &&
    rebuilt.issues.some(issue => issue.type === 'intermediate-birth-no-midstate');
}

console.log('【Mutation 預期（執行前宣告）】');
console.log('M-G 將 join window 放到無限大：同一乙判準轉紅。');
console.log('M-BIRTH 改用 tripKey set diff：同 tripKey 換人的 birth detector control 轉紅。');
console.log('M-REF 把同 pass newborn 算進 ref：同一 fixture ref 不變量轉紅。');
console.log('M-AMBIG 忽略 active→done 時序歧義：fail-closed ref control 轉紅。');
console.log('M-MIDSTATE 忽略 round1 newborn 缺中間態：fail-closed ref control 轉紅。');
console.log('M-SHIFT 把未更新的持久 state 算成 shift 更新：同一 fixture partition 轉紅。');
console.log('M-HEADWAY 跨固定站流相減 ETA：同一 fixture stream identity 轉紅。');
console.log('M-SCHED-WINDOW 納入捕捉窗外班表：同一 fixture 時間窗不變量轉紅。');

const g16 = classifyG(rounds.slice(0, 16));
const g20 = classifyG(rounds);
const shiftShape = measureShiftShape();
const birthRefs = measureBirthRefs();
const headways = measureHeadways();
const coverage = currentCoverage();

const gates = {
  G: isVerdictB(g20) && g20.bins['<60'] > 0 && g20.bins['60-180'] > 0 &&
    (g20.byLine.BR?.total || 0) > 0 && (g20.byLine.Y?.total || 0) > 0,
  REF: assertBirthRefs(birthRefs) && syntheticBirthDetectorGate(false) && syntheticAmbiguityGate(false) &&
    syntheticIntermediateBirthGate(false),
  SHIFT: assertShiftShape(shiftShape),
  HEADWAY: assertHeadways(headways),
};
const mutations = {
  'M-G': !isVerdictB(classifyG(rounds, Infinity)),
  'M-BIRTH': !syntheticBirthDetectorGate(true),
  'M-REF': !assertBirthRefs(measureBirthRefs({ includeSamePassBirth: true })),
  'M-AMBIG': !syntheticAmbiguityGate(true),
  'M-MIDSTATE': !syntheticIntermediateBirthGate(true),
  'M-SHIFT': !assertShiftShape(measureShiftShape(true)),
  'M-HEADWAY': !assertHeadways(measureHeadways({ crossStreams: true })),
  'M-SCHED-WINDOW': !assertHeadways(measureHeadways({ ignoreScheduleWindow: true })),
};
let failures = 0;
for (const [name, pass] of Object.entries(gates)) {
  console.log(`${pass ? '✅' : '❌'} A.${name} baseline`);
  if (!pass) failures++;
}
for (const [name, red] of Object.entries(mutations)) {
  console.log(`${red ? '✅' : '❌'} ${name} 預期 gate 轉紅`);
  if (!red) failures++;
}

console.log('\n【A1 甲／乙 minCost 分辨】');
console.log(JSON.stringify({ first16: g16, all20: g20 }, null, 2));
console.log('\n【A2 shift 形態】');
console.log(JSON.stringify(shiftShape, null, 2));
console.log('\n【A3 出生 ref 樣本數】');
console.log(JSON.stringify(birthRefs, null, 2));
console.log('\n【A4 固定站點班距】');
console.log(JSON.stringify(headways, null, 2));
console.log('\n【目前逐線接上率（尚未修，非 before/after）】');
console.log(JSON.stringify(coverage, null, 2));
console.log(`\n【裁示停點】${g20.verdict}；${isVerdictB(g20)
  ? '本腳本未修改 45 秒窗、binder、班表或前端，B–E 尚未進入。'
  : '不得無條件宣告乙，需回報本批差異。'}`);
console.log(`\n${failures ? `FAIL ${failures}` : 'PASS'}: 派工②第一步診斷與 mutation controls`);
process.exitCode = failures ? 1 : 0;
