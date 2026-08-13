#!/usr/bin/env node
// 派工③：完整尖峰語料的 Y 身分連續性，以及關係表驅逐的冷啟動復活驗收。
// 只讀落盤 fixture；不打網路、不起 listener。時間一律取 dyn.at / boardPos.at。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ledger from './trtc_board_ledger.mjs';
import { _trtcLedger as workerLedger } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = path.join(ROOT, 'scripts/trtc_board_ledger.mjs');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const MIDDAY_DIR = path.join(ROOT, 'tmp/binder-fixtures/rounds');
const PEAK_DIR = path.join(ROOT, 'tmp/binder-fixtures/rounds-peak');
const TIMES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json'), 'utf8'));
const DAY_TYPES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json'), 'utf8'));
const lines = ['Y', 'BR', 'BL', 'R', 'G', 'O_LUZHOU', 'O_XINZHUANG'];
const allLines = [...lines, 'G_XBT', 'R_XBT'];
let failures = 0;
const checks = [];
function check(pass, label, detail = '') {
  if (!pass) failures++;
  checks.push({ pass, label, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
function d1(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('[')));
}
function parseDyn(file) { return JSON.parse(d1(file)[0].results[0].v); }
function q(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), z = (a.length - 1) * p;
  return a[Math.floor(z)] + (a[Math.ceil(z)] - a[Math.floor(z)]) * (z - Math.floor(z));
}
function stats(values) {
  return { n: values.length, min: values.length ? Math.min(...values) : null, p10: q(values, .1),
    p50: q(values, .5), p90: q(values, .9), max: values.length ? Math.max(...values) : null };
}
const keyOf = b => `${b.line}|${Number(b.dir)}|${b.tripKey}`;
const exactOf = b => `${keyOf(b)}|${String(b.trackId)}`;
function loadCorpus(dir, declaredRounds = null) {
  if (!fs.existsSync(dir)) return null;
  const ids = fs.readdirSync(dir).map(file => file.match(/^(\d+)_dyn\.json$/)?.[1]).filter(Boolean).sort();
  if (declaredRounds != null && ids.length !== declaredRounds) {
    throw new Error(`${dir} 輪數 ${ids.length}，應為 ${declaredRounds}`);
  }
  const rounds = ids.map(id => {
    for (const kind of ['dyn', 'alias', 'live']) {
      const file = path.join(dir, `${id}_${kind}.json`);
      if (!fs.existsSync(file)) throw new Error(`${dir} 缺 ${id}_${kind}.json`);
    }
    const dyn = parseDyn(path.join(dir, `${id}_dyn.json`));
    const live = JSON.parse(fs.readFileSync(path.join(dir, `${id}_live.json`), 'utf8'));
    return { id, dyn, live, boardAt: Number(live.boardPos.at) };
  }).sort((a, b) => a.boardAt - b.boardAt || a.id.localeCompare(b.id));
  const unique = [...new Map(rounds.map(round => [Number(round.dyn.at), round])).values()]
    .sort((a, b) => Number(a.dyn.at) - Number(b.dyn.at));
  return { dir, rounds, unique };
}

function captureAudit(corpus) {
  const intervalPath = path.join(corpus.dir, '_intervals.txt');
  const stamps = fs.readFileSync(intervalPath, 'utf8').trim().split(/\n+/).map(line => Number(line.trim().split(/\s+/)[1]));
  const gaps = stamps.slice(1).map((value, index) => value - stamps[index]);
  const tripletFiles = corpus.rounds.reduce((count, round) => count + ['dyn', 'alias', 'live']
    .filter(kind => fs.existsSync(path.join(corpus.dir, `${round.id}_${kind}.json`))).length, 0);
  const summaries = corpus.rounds.map(round => {
    const active = (round.dyn.bindings || []).filter(b => b.line === 'Y' && !b.done);
    return { id: round.id, boardRows: (round.live.boardPos.rows || []).length, yActive: active.length,
      yDir1: active.filter(b => Number(b.dir) === 1).length, yDir2: active.filter(b => Number(b.dir) === 2).length };
  });
  return { rounds: corpus.rounds.length, tripletFiles,
    intervalRows: stamps.length, gapSec: stats(gaps), over45: gaps.filter(gap => gap > 45).length,
    uniqueDynAt: corpus.unique.length, cronTransitions: corpus.unique.length - 1, summaries };
}

function sampleProfile(corpus) {
  const eligibleRows = Object.fromEntries(allLines.map(line => [line, 0]));
  for (const round of corpus.rounds) for (const row of round.live.boardPos.rows || []) {
    if (eligibleRows[row.line] != null) eligibleRows[row.line]++;
  }
  const trueUpdates = Object.fromEntries(allLines.map(line => [line, 0]));
  for (let i = 1; i < corpus.unique.length; i++) {
    const before = new Map((corpus.unique[i - 1].dyn.bindings || []).map(b => [exactOf(b), b]));
    for (const b of corpus.unique[i].dyn.bindings || []) {
      const old = before.get(exactOf(b)); if (!old || trueUpdates[b.line] == null) continue;
      if (Number(old.lastArrEpoch) !== Number(b.lastArrEpoch) || Number(old.lastTo) !== Number(b.lastTo) ||
          Number(old.lastShift) !== Number(b.lastShift)) trueUpdates[b.line]++;
    }
  }
  return { rounds: corpus.rounds.length, uniqueDynAt: corpus.unique.length, eligibleRows, trueUpdates };
}

function sampleGate(profile, full, declaredRounds) {
  const limits = { rounds: declaredRounds,
    uniqueDynAt: Math.max(32, Math.floor(Number(full.uniqueDynAt || 0) * .8)),
    eligibleRows: Object.fromEntries(allLines.map(line => [line, Math.max(declaredRounds,
      Math.floor(Number(full.eligibleRows[line] || 0) / 2))])),
    trueUpdates: Object.fromEntries(allLines.map(line => [line, Math.max(1,
      Math.floor(Number(full.trueUpdates[line] || 0) / 2))])) };
  const shortfalls = [];
  if (profile.rounds < limits.rounds) shortfalls.push(`rounds ${profile.rounds}<${limits.rounds}`);
  if (profile.uniqueDynAt < limits.uniqueDynAt) shortfalls.push(`dyn.at ${profile.uniqueDynAt}<${limits.uniqueDynAt}`);
  for (const line of allLines) {
    if (profile.eligibleRows[line] < limits.eligibleRows[line])
      shortfalls.push(`${line}.eligible ${profile.eligibleRows[line]}<${limits.eligibleRows[line]}`);
    if (profile.trueUpdates[line] < limits.trueUpdates[line])
      shortfalls.push(`${line}.updates ${profile.trueUpdates[line]}<${limits.trueUpdates[line]}`);
  }
  return { pass: shortfalls.length === 0, limits, actual: profile, shortfalls };
}

function sliceCorpus(corpus, count) {
  const rounds = corpus.rounds.slice(0, count);
  const unique = [...new Map(rounds.map(round => [Number(round.dyn.at), round])).values()]
    .sort((a, b) => Number(a.dyn.at) - Number(b.dyn.at));
  return { dir: corpus.dir, rounds, unique };
}

function tripContext(day) {
  const { tripSets } = ledger.buildTripSetsByLineDir(TIMES, DAY_TYPES, day);
  const byKey = new Map();
  for (const [group, trips] of tripSets) for (const tr of trips) byKey.set(`${group}|${ledger.tripKeyOf(tr)}`, tr);
  return { tripSets, byKey };
}

function duplicateCounts(bindings) {
  const tracks = new Map(), trips = new Map(); let active = 0;
  for (const b of bindings || []) {
    if (!b || b.done) continue;
    active++;
    tracks.set(String(b.trackId), (tracks.get(String(b.trackId)) || 0) + 1);
    trips.set(keyOf(b), (trips.get(keyOf(b)) || 0) + 1);
  }
  return { active, duplicateTrackIds: [...tracks.values()].reduce((n, x) => n + Math.max(0, x - 1), 0),
    duplicateTripKeys: [...trips.values()].reduce((n, x) => n + Math.max(0, x - 1), 0) };
}

function duplicateCorpus(corpus) {
  return corpus.unique.reduce((acc, round) => {
    const current = duplicateCounts(round.dyn.bindings);
    acc.snapshots++;
    acc.active += current.active;
    acc.duplicateTrackIds += current.duplicateTrackIds;
    acc.duplicateTripKeys += current.duplicateTripKeys;
    return acc;
  }, { snapshots: 0, active: 0, duplicateTrackIds: 0, duplicateTripKeys: 0 });
}

function identityTransitions(corpus, line = 'Y') {
  const out = { retainedTrips: 0, changes: 0, reclaim: 0, doneRebirth: 0,
    freshReplacementAmbiguous: 0, examples: {} };
  for (let i = 1; i < corpus.unique.length; i++) {
    const before = corpus.unique[i - 1].dyn, after = corpus.unique[i].dyn;
    const prior = new Map((before.bindings || []).filter(b => b.line === line).map(b => [keyOf(b), b]));
    const rows = corpus.rounds.filter(r => Number(r.dyn.at) === Number(after.at))
      .flatMap(r => r.live.boardPos.rows || []);
    for (const next of (after.bindings || []).filter(b => !b.done && b.line === line)) {
      const old = prior.get(keyOf(next)); if (!old) continue;
      out.retainedTrips++;
      if (String(old.trackId) === String(next.trackId)) continue;
      out.changes++;
      let reason;
      if (Number(old.boundEpoch) === Number(next.boundEpoch)) reason = 'reclaim';
      else if (old.done) reason = 'doneRebirth';
      else reason = 'freshReplacementAmbiguous';
      let structuralHint = null;
      if (reason === 'freshReplacementAmbiguous') {
        const oldTr = tripContext(before.day).byKey.get(keyOf(old));
        const sameTrackRows = rows.filter(r => r.line === old.line && Number(r.dir) === Number(old.dir));
        const destinations = new Set(sameTrackRows.map(r => Number(r.dest)));
        // live 是 cron 後的訪客 snapshot，不是兩個 binder pass 當刻 raw claim；只能列結構提示，
        // 不可把 safety/destMismatch 猜成確定出口。
        structuralHint = { oldBadStreak: Number(old.badStreak) || 0,
          visibleDestIncludesOldTerminal: !!(oldTr && destinations.has(Number(oldTr.at(-2)))),
          visibleDestinations: [...destinations].sort((a, b) => a - b) };
      }
      out[reason]++;
      if (!out.examples[reason]) out.examples[reason] = { at: Number(after.at), tripKey: next.tripKey,
        beforeTrackId: old.trackId, afterTrackId: next.trackId, beforeShift: old.lastShift,
        afterShift: next.lastShift, beforeBoundEpoch: old.boundEpoch, afterBoundEpoch: next.boundEpoch,
        beforeBadStreak: old.badStreak, structuralHint };
    }
  }
  return out;
}

function shiftPhase(corpus) {
  const result = {};
  for (const dir of [1, 2]) {
    const values = [], slots = [], residuals = [];
    for (const round of corpus.unique) {
      const { tripSets, byKey } = tripContext(round.dyn.day);
      const schedule = (tripSets.get(`Y|${dir}`) || []).filter(tr => Number(tr.at(-2)) === (dir === 1 ? 0 : 13));
      for (const b of (round.dyn.bindings || []).filter(x => !x.done && x.line === 'Y' && Number(x.dir) === dir)) {
        const tr = byKey.get(keyOf(b)); if (!tr || !Number.isFinite(Number(b.lastShift))) continue;
        values.push(Number(b.lastShift));
        if (!Number.isInteger(Number(b.lastTo))) continue;
        const station = Number(b.lastTo), boundIndex = schedule.findIndex(x => ledger.tripKeyOf(x) === b.tripKey);
        if (boundIndex < 0) continue;
        const stationIndex = tr.findIndex((v, k) => k % 2 === 0 && Number(v) === station);
        if (stationIndex < 0) continue;
        const terminal = stationIndex === 0;
        const from = terminal ? station : Number(tr[stationIndex - 2]);
        const boundEvent = terminal ? Number(tr[1]) : Number(tr[stationIndex - 1]);
        const actualDeparture = boundEvent + Number(b.lastShift), hit = [];
        for (let index = 0; index < schedule.length; index++) {
          const cand = schedule[index];
          if (terminal) {
            if (Number(cand[0]) === from) hit.push({ slot: index - boundIndex,
              residual: actualDeparture - Number(cand[1]) });
            continue;
          }
          const leg = ledger.tripLegIndex(cand, from, station);
          if (leg >= 0) hit.push({ slot: index - boundIndex,
            residual: actualDeparture - Number(cand[(leg - 1) * 2 + 1]) });
        }
        hit.sort((a, b2) => Math.abs(a.residual) - Math.abs(b2.residual) || a.slot - b2.slot);
        if (hit[0]) { slots.push(hit[0].slot); residuals.push(hit[0].residual); }
      }
    }
    result[dir] = { shifts: stats(values), phaseSamples: slots.length,
      slotOffsets: Object.fromEntries([...new Set(slots)].sort((a, b) => a - b).map(slot => [slot, slots.filter(x => x === slot).length])),
      residualSec: stats(residuals) };
  }
  return result;
}

// 舊架構的班表名冊／里程序只保留為 legacy schedule diagnostic。官方即時名冊優先後，
// active 數不應再以班表應有數量為 gate；現況 inversion 非零也不可包裝成「順序守恆」。
function rosterAndOrder(corpus) {
  const roster = { snapshots: 0, byDir: { 1: { expected: 0, active: 0, missing: 0, extra: 0 },
    2: { expected: 0, active: 0, missing: 0, extra: 0 } }, equalCount: 0 };
  let orderPairs = 0, inversions = 0;
  for (const round of corpus.unique) {
    const { tripSets, byKey } = tripContext(round.dyn.day), now = ledger.trtcServiceSecOfEpoch(round.dyn.at);
    roster.snapshots++;
    for (const dir of [1, 2]) {
      const expected = (tripSets.get(`Y|${dir}`) || []).filter(tr => ledger.tripRosterActive(tr, now));
      const active = (round.dyn.bindings || []).filter(b => !b.done && b.line === 'Y' && Number(b.dir) === dir);
      const expectedKeys = new Set(expected.map(ledger.tripKeyOf)), activeKeys = new Set(active.map(b => b.tripKey));
      const rec = roster.byDir[dir]; rec.expected += expectedKeys.size; rec.active += activeKeys.size;
      rec.missing += [...expectedKeys].filter(key => !activeKeys.has(key)).length;
      rec.extra += [...activeKeys].filter(key => !expectedKeys.has(key)).length;
      if (expectedKeys.size === activeKeys.size) roster.equalCount++;
      const updated = active.filter(b => {
        const oldRoundIndex = corpus.unique.indexOf(round) - 1;
        if (oldRoundIndex < 0) return false;
        const old = (corpus.unique[oldRoundIndex].dyn.bindings || []).find(x => keyOf(x) === keyOf(b));
        return old && Number(old.lastArrEpoch) !== Number(b.lastArrEpoch) && byKey.has(keyOf(b));
      }).sort((a, b) => byKey.get(keyOf(a))[1] - byKey.get(keyOf(b))[1]);
      for (let i = 0; i < updated.length; i++) for (let j = i + 1; j < updated.length; j++) {
        orderPairs++;
        const bad = dir === 2 ? Number(updated[i].lastTo) < Number(updated[j].lastTo)
          : Number(updated[i].lastTo) > Number(updated[j].lastTo);
        if (bad) inversions++;
      }
    }
  }
  return { roster, order: { comparableUpdatedPairs: orderPairs, inversions } };
}

function visibleBirthProxy(corpus) {
  const births = [];
  for (let i = 1; i < corpus.unique.length; i++) {
    const prev = corpus.unique[i - 1].dyn, cur = corpus.unique[i].dyn;
    for (const b of (cur.bindings || []).filter(x => x.line === 'Y' && Number(x.boundEpoch) > Number(prev.at))) {
      const n = (cur.bindings || []).filter(x => !x.done && x.line === 'Y' && Number(x.dir) === Number(b.dir) &&
        Number(x.boundEpoch) < Number(b.boundEpoch) && Number(b.boundEpoch) - Number(x.boundEpoch) <= ledger.TRIP_BIND_REF_WINDOW_SEC).length;
      births.push({ dir: Number(b.dir), refCount: n, pass: Number(b.boundEpoch) === Number(cur.at) ? 2 : 1 });
    }
  }
  return { births: births.length, sparseLe2: births.filter(x => x.refCount <= 2).length,
    refCounts: births.map(x => x.refCount).sort((a, b) => a - b), details: births,
    note: 'survivor proxy：快照未落盤 runtime refCount/ref/cost' };
}

function fixtureEvictionLowerBound(corpus) {
  const stale = new Map();
  for (let i = 1; i < corpus.unique.length; i++) {
    const before = corpus.unique[i - 1].dyn, after = corpus.unique[i].dyn;
    const afterKeys = new Set((after.bindings || []).map(keyOf));
    for (const b of (before.bindings || []).filter(x => !x.done && !afterKeys.has(keyOf(x)))) {
      stale.set(keyOf(b), { ...b, disappearedAfter: Number(before.at), absentAt: Number(after.at) });
    }
  }
  const finalKeys = new Set((corpus.unique.at(-1).dyn.bindings || []).map(keyOf));
  const rows = [...stale.values()].filter(b => !finalKeys.has(keyOf(b)));
  const fallback = rows.map(b => ({ line: b.line, dir: Number(b.dir), tripKey: b.tripKey, trackId: b.trackId,
    boundEpoch: Number(b.boundEpoch), birth: b.birth, done: false, rebinds: Number(b.rebinds) || 0,
    lastShift: 0, lastTo: null, lastArrEpoch: null, lastSeenEpoch: null, reachedEndEpoch: null, badStreak: 0 }));
  const final = corpus.unique.at(-1).dyn;
  const rebound = ledger.bindTracksToTrips({ model: null, tripSets: tripContext(final.day).tripSets,
    dayType: final.dayType, tracks: [], priorBindings: fallback, nowEpoch: Number(final.at), day: final.day });
  const relational = [...(final.bindings || []), ...rows].map(b => ({ line: b.line, dir: Number(b.dir),
    trip_key: b.tripKey, track_id: b.trackId, bound_epoch: Number(b.boundEpoch), birth: b.birth,
    done: b.done ? 1 : 0, rebinds: Number(b.rebinds) || 0 }));
  // 部署前 zombie 沒有新版 evict event；修復必須靠權威 final trip_dyn 與關係表做 diff。
  const plan = ledger.planTrtcTripBindingPersistence(final.bindings, [], relational, true);
  return { observedLowerBound: rows.length,
    byLine: Object.fromEntries(lines.map(line => [line, rows.filter(b => b.line === line).length]).filter(([, n]) => n)),
    identities: rows.map(keyOf).sort(), legacyFallbackActive: rebound.bindings.filter(b => !b.done).map(keyOf).sort(),
    fixedDeletes: plan.deletes.map(x => `${x.line}|${x.dir}|${x.tripKey}`).sort(),
    reconciliationUpserts: plan.upserts.length };
}

function mutationModule(name, replacements) {
  let source = fs.readFileSync(LEDGER_PATH, 'utf8');
  for (const [needle, replacement, label] of replacements) {
    const hits = source.split(needle).length - 1;
    if (hits !== 1) throw new Error(`${name}/${label} mutation 錨點預期1處，實際${hits}處`);
    source = source.replace(needle, replacement);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${name}`);
}

function workerWiringAudit(source = fs.readFileSync(WORKER_PATH, 'utf8')) {
  const functionBlock = source.match(/async function persistTrtcTripBindingRound\([\s\S]*?\n}\n\n\/\/ 訪客 join 用/)?.[0] || '';
  const callHits = (source.match(/persistTrtcTripBindingRound\(env, day, now2, dayType, round1, round2\)/g) || []).length;
  return {
    exported: /export const _trtcLedger = \{[\s\S]*?loadTrtcTripBindingState, persistTrtcTripBindingRound,[\s\S]*?\n};/.test(source),
    ownsBothPassEvents: /const events = \[\.\.\.\(\(round1 && round1\.events\)[\s\S]*round2 && round2\.events/.test(functionBlock),
    relationalSelect: /SELECT line,dir,trip_key,track_id,bound_epoch,birth,done,rebinds[\s\S]*FROM trtc_trip_bindings WHERE day=\?/.test(functionBlock),
    plannerGetsRelational: /planTrtcTripBindingPersistence\(bindings, events, relationalBindings, reconciliation\)/.test(functionBlock),
    physicalDelete: /DELETE FROM trtc_trip_bindings[\s\S]*WHERE day=\? AND line=\? AND dir=\? AND trip_key=\?/.test(functionBlock),
    boundedBatches: /const TRTC_TRIP_BINDING_BATCH_SIZE = 80/.test(source) &&
      /statements\.slice\(i, i \+ TRTC_TRIP_BINDING_BATCH_SIZE\)/.test(functionBlock),
    markerLast: /for \(let i = 0; i < statements\.length; i \+= TRTC_TRIP_BINDING_BATCH_SIZE\)[\s\S]*await db\.batch\(stateStatements\)/.test(functionBlock),
    markerInvalidatedBeforeChunks: /DELETE FROM trtc_state WHERE k='trip_binding_reconcile_v1'[\s\S]*for \(let i = 0; i < statements\.length/.test(functionBlock),
    failClosedLegacy: /if \(!marker \|\| marker\.v !== day\) return \{ bindings: \[\], source: 'legacy-untrusted' \}/.test(source),
    callHits,
  };
}
function workerWiringPass(audit) {
  return audit.exported && audit.ownsBothPassEvents && audit.relationalSelect && audit.plannerGetsRelational &&
    audit.physicalDelete && audit.boundedBatches && audit.markerLast && audit.markerInvalidatedBeforeChunks &&
    audit.failClosedLegacy && audit.callHits === 1;
}

function replaceWorkerOnce(source, needle, replacement, label) {
  const hits = source.split(needle).length - 1;
  if (hits !== 1) throw new Error(`${label} worker mutation 錨點預期1處，實際${hits}處`);
  return source.replace(needle, replacement);
}

function makeD1Mock(seedRows = []) {
  const state = new Map();
  const relations = new Map(seedRows.map(row => [
    `${row.day}|${row.line}|${Number(row.dir)}|${row.trip_key}`, { ...row, dir: Number(row.dir) },
  ]));
  const batches = [];
  let relationSelects = 0;
  const prepare = (sql, args = []) => ({
    sql, args,
    bind: (...next) => prepare(sql, next),
    first: async () => {
      if (sql.includes("k='trip_dyn'")) return state.has('trip_dyn') ? { v: state.get('trip_dyn') } : null;
      if (sql.includes("k='trip_binding_reconcile_v1'")) return state.has('trip_binding_reconcile_v1')
        ? { v: state.get('trip_binding_reconcile_v1') } : null;
      throw new Error(`mock 未處理 first: ${sql}`);
    },
    all: async () => {
      if (!sql.includes('FROM trtc_trip_bindings WHERE day=?')) throw new Error(`mock 未處理 all: ${sql}`);
      relationSelects++;
      return { results: [...relations.values()].filter(row => row.day === args[0]).map(row => ({ ...row })) };
    },
  });
  const apply = statement => {
    const { sql, args } = statement;
    if (sql.includes('INSERT INTO trtc_trip_bindings')) {
      const [day, line, dir, trip_key, track_id, bound_epoch, birth, done, rebinds] = args;
      relations.set(`${day}|${line}|${Number(dir)}|${trip_key}`,
        { day, line, dir: Number(dir), trip_key, track_id, bound_epoch, birth, done, rebinds });
    } else if (sql.includes('DELETE FROM trtc_trip_bindings')) {
      const [day, line, dir, tripKey] = args;
      relations.delete(`${day}|${line}|${Number(dir)}|${tripKey}`);
    } else if (sql.includes("DELETE FROM trtc_state WHERE k='trip_binding_reconcile_v1'")) {
      state.delete('trip_binding_reconcile_v1');
    } else if (sql.includes("VALUES ('trip_dyn',?)")) state.set('trip_dyn', args[0]);
    else if (sql.includes("VALUES ('trip_binding_reconcile_v1',?)")) state.set('trip_binding_reconcile_v1', args[0]);
  };
  let mutationBatchIndex = 0;
  const db = { failWriteBatch: null, prepare, batch: async statements => {
    if (statements.some(statement => /(?:INSERT INTO|DELETE FROM) trtc_(?:trip_bindings|state)/.test(statement.sql))) {
      mutationBatchIndex++;
      if (db.failWriteBatch === mutationBatchIndex) throw new Error(`mock batch failure ${mutationBatchIndex}`);
    }
    batches.push(statements.map(statement => ({ sql: statement.sql, args: statement.args })));
    for (const statement of statements) apply(statement);
    return statements.map(() => ({ success: true }));
  } };
  return { db, state, relations, batches, get relationSelects() { return relationSelects; } };
}

async function workerPersistenceRuntime(corpus, fixture) {
  const final = corpus.unique.at(-1).dyn, day = final.day;
  const zombies = fixture.identities.map(identity => {
    const [line, dir, trip_key] = identity.split('|');
    return { day, line, dir: Number(dir), trip_key, track_id: `legacy:${identity}`,
      bound_epoch: Number(final.at) - 600, birth: 'legacy', done: 0, rebinds: 0 };
  });
  const mock = makeD1Mock(zombies), env = { TRTC_LEDGER: mock.db };
  const beforeSelects = mock.relationSelects;
  const untrusted = await workerLedger.loadTrtcTripBindingState(env, day);
  const failClosedAvoidedRelation = mock.relationSelects === beforeSelects;
  const round1 = { bindings: final.bindings, events: [] }, round2 = { bindings: final.bindings, events: [] };
  const persisted = await workerLedger.persistTrtcTripBindingRound(env, day, Number(final.at), final.dayType, round1, round2);
  const writeBatches = mock.batches.filter(batch => batch.some(x => /(?:INSERT INTO|DELETE FROM) trtc_(?:trip_bindings|state)/.test(x.sql)));
  const batchSizes = writeBatches.map(batch => batch.length);
  const markerBatches = writeBatches.map((batch, index) => batch.some(x =>
    x.sql.includes("VALUES ('trip_binding_reconcile_v1',?)")) ? index : -1)
    .filter(index => index >= 0);
  mock.state.delete('trip_dyn');
  const fallback = await workerLedger.loadTrtcTripBindingState(env, day);
  const normalize = value => (value || []).map(b => ({ line: b.line, dir: Number(b.dir), tripKey: b.tripKey,
    trackId: String(b.trackId), boundEpoch: Number(b.boundEpoch), birth: String(b.birth), done: !!b.done,
    rebinds: Number(b.rebinds) || 0 })).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const expectedExact = normalize(final.bindings), fallbackExact = normalize(fallback.bindings);
  const failureMock = makeD1Mock([]), failureDay = '2026-08-14';
  failureMock.db.failWriteBatch = 3;
  let failureMessage = null;
  try {
    await workerLedger.persistTrtcTripBindingRound({ TRTC_LEDGER: failureMock.db }, failureDay,
      Number(final.at) + 86400, final.dayType, round1, round2);
  } catch (error) { failureMessage = error && error.message; }
  // Marker 已存在的日內大量更新也必須先失效 marker；否則半套 relation 會被誤當可信。
  const dailyMock = makeD1Mock([]), dailyEnv = { TRTC_LEDGER: dailyMock.db };
  dailyMock.state.set('trip_binding_reconcile_v1', day);
  dailyMock.state.set('trip_dyn', JSON.stringify({ at: final.at - 60, day, dayType: final.dayType, bindings: [] }));
  const many = final.bindings.slice(0, 100);
  const manyEvents = many.map(b => ({ type: 'bind', line: b.line, dir: b.dir, tripKey: b.tripKey }));
  dailyMock.db.failWriteBatch = 3;
  let dailyError = null;
  try {
    await workerLedger.persistTrtcTripBindingRound(dailyEnv, day, Number(final.at), final.dayType,
      { bindings: many, events: manyEvents }, { bindings: many, events: [] });
  } catch (error) { dailyError = error && error.message; }
  dailyMock.state.delete('trip_dyn');
  const dailyFallback = await workerLedger.loadTrtcTripBindingState(dailyEnv, day);
  const corruptExact = fallbackExact.map((b, index) => index === 0 ? { ...b, trackId: `${b.trackId}:mutation` } : b);
  return { untrusted: { source: untrusted.source, bindings: untrusted.bindings.length, failClosedAvoidedRelation },
    persisted, batchSizes, markerBatches, markerIsLast: markerBatches.length === 1 && markerBatches[0] === writeBatches.length - 1,
    relationRows: mock.relations.size, fallback: { source: fallback.source, bindings: fallback.bindings.length,
      exactEqual: JSON.stringify(expectedExact) === JSON.stringify(fallbackExact) },
    exactMutationDetected: JSON.stringify(expectedExact) !== JSON.stringify(corruptExact),
    zombieKeysRemaining: fixture.identities.filter(identity => {
        const [line, dir, tripKey] = identity.split('|');
        return mock.relations.has(`${day}|${line}|${Number(dir)}|${tripKey}`);
      }),
    finalBindings: final.bindings.length,
    interrupted: { error: failureMessage, markerWritten: failureMock.state.has('trip_binding_reconcile_v1'),
      tripDynWritten: failureMock.state.has('trip_dyn'), partialRelationRows: failureMock.relations.size },
    dailyInterrupted: { error: dailyError, markerWritten: dailyMock.state.has('trip_binding_reconcile_v1'),
      fallbackSource: dailyFallback.source, fallbackBindings: dailyFallback.bindings.length,
      partialRelationRows: dailyMock.relations.size } };
}

function syntheticPersistence(mod) {
  const base = 1786579200, day = '2026-08-13';
  const destTrip = [0, 28800, 1, 28900], safetyTrip = [0, 29100, 1, 29200];
  const tripSets = new Map([['T_DEST|2', [destTrip]], ['T_SAFE|2', [safetyTrip]]]);
  const prior = [
    { line: 'T_DEST', dir: 2, tripKey: mod.tripKeyOf(destTrip), trackId: 'track:dest', boundEpoch: base - 600,
      birth: 'terminal', lastShift: 0, lastTo: 0, lastArrEpoch: base - 30, lastSeenEpoch: base - 30,
      reachedEndEpoch: null, badStreak: 0, done: false, rebinds: 0 },
    { line: 'T_SAFE', dir: 2, tripKey: mod.tripKeyOf(safetyTrip), trackId: 'track:safe', boundEpoch: base - 600,
      birth: 'terminal', lastShift: 700, lastTo: 0, lastArrEpoch: base - 30, lastSeenEpoch: base - 30,
      reachedEndEpoch: null, badStreak: 3, done: false, rebinds: 0 },
  ];
  const tracks = [
    { trackId: 'track:dest', line: 'T_DEST', dir: 2, from: 0, to: 0, destIdx: 0,
      arrEpoch: base, run: 0, terminal: true },
    { trackId: 'track:safe', line: 'T_SAFE', dir: 2, from: 0, to: 1, destIdx: 1,
      arrEpoch: base + 1600, run: 100, terminal: false },
  ];
  // 另放3個同組 ref，讓 safety track 第4次穩定超過600s。
  for (let i = 0; i < 3; i++) prior.push({ line: 'T_SAFE', dir: 2, tripKey: `ref${i}`, trackId: `ref${i}`,
    boundEpoch: base - 600, birth: 'terminal', lastShift: 0, lastTo: null, lastArrEpoch: null,
    lastSeenEpoch: base, reachedEndEpoch: null, badStreak: 0, done: false, rebinds: 0 });
  const result = mod.bindTracksToTrips({ model: null, tripSets, dayType: '平日', tracks,
    priorBindings: prior, nowEpoch: base, day });
  const plan = mod.planTrtcTripBindingPersistence(result.bindings, result.events);
  const evicts = result.events.filter(e => e.type === 'evict');
  const normalBinding = { ...prior[0], line: 'T_NORMAL', tripKey: 'normal', trackId: 'normal' };
  const normal = mod.planTrtcTripBindingPersistence([normalBinding], [{ type: 'done', line: 'T_NORMAL', dir: 2,
    tripKey: 'normal' }]);
  const replacement = { ...normalBinding, line: 'T_FINAL', tripKey: 'same', trackId: 'new' };
  const finalWins = mod.planTrtcTripBindingPersistence([replacement], [
    { type: 'evict', line: 'T_FINAL', dir: 2, tripKey: 'same' },
    { type: 'bind', line: 'T_FINAL', dir: 2, tripKey: 'same' },
  ]);
  const legacyZombie = mod.planTrtcTripBindingPersistence([], [], [
    { line: 'T_LEGACY', dir: 2, trip_key: 'zombie' },
  ]);
  const sameRows = mod.planTrtcTripBindingPersistence([normalBinding], [], [{
    line: normalBinding.line, dir: normalBinding.dir, trip_key: normalBinding.tripKey,
    track_id: normalBinding.trackId, bound_epoch: normalBinding.boundEpoch, birth: normalBinding.birth,
    done: normalBinding.done ? 1 : 0, rebinds: normalBinding.rebinds,
  }], true);
  return { evicts: evicts.map(e => `${e.reason}:${e.line}|${e.dir}|${e.tripKey}`).sort(),
    deletes: plan.deletes.map(x => `${x.line}|${x.dir}|${x.tripKey}`).sort(), upserts: plan.upserts.length,
    normal: { upserts: normal.upserts.length, deletes: normal.deletes.length },
    finalWins: { upserts: finalWins.upserts.length, deletes: finalWins.deletes.length,
      trackId: finalWins.upserts[0]?.trackId },
    legacyZombie: { upserts: legacyZombie.upserts.length, deletes: legacyZombie.deletes.length },
    sameRows: { upserts: sameRows.upserts.length, deletes: sameRows.deletes.length } };
}

console.log('【Mutation 預期（先宣告後執行）】');
console.log('M-T1 刪目的地 evict event：tombstone dest 子項紅。');
console.log('M-T2 刪安全閥 evict event：tombstone safety 子項紅。');
console.log('M-T3 persistence 對 final 缺列 no-op：兩個 delete 與 fixture 復活子項紅。');
console.log('M-T4 依第一事件刪同 key：final-wins 子項紅。');
console.log('M-T5 忽略當日關係表對帳：部署前 legacy zombie 子項紅。');
console.log('M-T7 對未變列也無條件 upsert：diff-only 子項紅。');
console.log('M-T8 竄改 fallback 任一持久欄位：逐筆 identity comparator 子項紅。');
console.log('M-T6 逐一破壞 worker 兩 pass events／relation SELECT／planner 傳參／DELETE SQL／80句分批／marker 失效／fail closed：七個 wiring 子項各自紅。');
console.log('M-C 自由複製身分：C 重複 track/trip 偵測兩項紅。');
console.log('M-Z 只餵完整尖峰語料前3輪：輪數、dyn.at 與逐線 eligible／true update 樣本不足項必須轉紅。');

const peak = loadCorpus(PEAK_DIR, 80);
const capture = captureAudit(peak), peakProfile = sampleProfile(peak);
const peakGate = sampleGate(peakProfile, peakProfile, 80);
const shortPeak = sliceCorpus(peak, 3), shortProfile = sampleProfile(shortPeak);
const shortGate = sampleGate(shortProfile, peakProfile, 80);
const peakPhase = shiftPhase(peak), peakChanges = identityTransitions(peak);
const peakRefProxy = visibleBirthProxy(peak), peakIdentity = duplicateCorpus(peak);
const peakLegacySchedule = rosterAndOrder(peak);
const midday = loadCorpus(MIDDAY_DIR, 20);
const phase = shiftPhase(midday), changes = identityTransitions(midday);
const refProxy = visibleBirthProxy(midday), identityBase = duplicateCorpus(midday);
const middayLegacySchedule = rosterAndOrder(midday);
const tombstoneFixture = fixtureEvictionLowerBound(midday);

const brokenDest = await mutationModule('no-dest-evict-event', [[
  "      events.push({ type: 'evict', reason: 'destMismatch', day, line: rec.line, dir: rec.dir,\n        tripKey: rec.tripKey, trackId: rec.trackId, epoch: nowEpoch });\n",
  '', 'dest-event' ]]);
const brokenSafety = await mutationModule('no-safety-evict-event', [[
  "        events.push({ type: 'evict', reason: 'badStreak', day, line: rec.line, dir: rec.dir,\n          tripKey: rec.tripKey, trackId: rec.trackId, epoch: nowEpoch });\n",
  '', 'safety-event' ]]);
const brokenDelete = await mutationModule('no-delete', [[
  '    else deletes.push(identity);', '    else { /* mutation: stale relation no-op */ }', 'delete-plan' ]]);
const brokenFinal = await mutationModule('first-event-delete', [[
  '    const rec = finalByKey.get(key);\n    if (rec) upserts.push(rec);\n    else deletes.push(identity);',
  "    const rec = finalByKey.get(key);\n    if (rec && !(events || [])[0]?.type?.includes('evict')) upserts.push(rec);\n    else deletes.push(identity);",
  'final-wins' ]]);
const brokenReconcile = await mutationModule('no-relational-reconcile', [[
  '  for (const rec of relationalBindings || []) {',
  '  for (const rec of [] /* mutation: ignore relational rows */) {', 'relational-reconcile' ]]);
const brokenRewrite = await mutationModule('rewrite-identical-relations', [[
  '    if (!same) touched.set(key, { line: rec.line, dir: Number(rec.dir), tripKey: rec.tripKey });',
  '    touched.set(key, { line: rec.line, dir: Number(rec.dir), tripKey: rec.tripKey }); /* mutation */',
  'diff-only-reconcile' ]]);
const persistence = syntheticPersistence(ledger), mt1 = syntheticPersistence(brokenDest),
  mt2 = syntheticPersistence(brokenSafety), mt3 = syntheticPersistence(brokenDelete), mt4 = syntheticPersistence(brokenFinal),
  mt5 = syntheticPersistence(brokenReconcile), mt7 = syntheticPersistence(brokenRewrite);
const workerSource = fs.readFileSync(WORKER_PATH, 'utf8'), workerAudit = workerWiringAudit(workerSource);
const workerMutationInputs = {
  onePass: [
    'const events = [...((round1 && round1.events) || []), ...((round2 && round2.events) || [])];',
    'const events = [...((round2 && round2.events) || [])];', 'ownsBothPassEvents'],
  noSelect: [
    'const relational = await db.prepare(`SELECT line,dir,trip_key,track_id,bound_epoch,birth,done,rebinds',
    'const relational = await db.prepare(`SELECT line,dir,trip_key /* mutation missing persistence columns */',
    'relationalSelect'],
  noPlannerRows: [
    'planTrtcTripBindingPersistence(bindings, events, relationalBindings, reconciliation)',
    'planTrtcTripBindingPersistence(bindings, events, null, reconciliation)', 'plannerGetsRelational'],
  noDeleteSql: ['statements.push(db.prepare(`DELETE FROM trtc_trip_bindings',
    'statements.push(db.prepare(`SELECT 1 /* mutation no delete */', 'physicalDelete'],
  noBatchBound: [
    'statements.slice(i, i + TRTC_TRIP_BINDING_BATCH_SIZE)',
    'statements.slice(i)', 'boundedBatches'],
  noMarkerInvalidation: [
    "await db.batch([db.prepare(`DELETE FROM trtc_state WHERE k='trip_binding_reconcile_v1'`)]); batches++;",
    '/* mutation: marker remains trusted during partial chunks */', 'markerInvalidatedBeforeChunks'],
  noFailClosed: [
    "if (!marker || marker.v !== day) return { bindings: [], source: 'legacy-untrusted' };",
    "if (!marker || marker.v !== day) { /* mutation: trust legacy relation */ }",
    'failClosedLegacy'],
};
const workerMutations = Object.fromEntries(Object.entries(workerMutationInputs).map(([name, [needle, replacement, property]]) => {
  const audit = workerWiringAudit(replaceWorkerOnce(workerSource, needle, replacement, name));
  const otherSame = Object.keys(workerAudit).filter(key => key !== property)
    .every(key => JSON.stringify(workerAudit[key]) === JSON.stringify(audit[key]));
  return [name, { property, baseline: workerAudit[property], mutant: audit[property], otherSame,
    fullPass: workerWiringPass(audit), audit }];
}));
const workerRuntime = await workerPersistenceRuntime(midday, tombstoneFixture);

check(tombstoneFixture.observedLowerBound > 0 &&
  JSON.stringify(tombstoneFixture.identities) === JSON.stringify(tombstoneFixture.legacyFallbackActive),
  'T.fixture 午間快照可重現關係舊列冷啟動復活',
  `n=${tombstoneFixture.observedLowerBound},byLine=${JSON.stringify(tombstoneFixture.byLine)}`);
check(JSON.stringify(tombstoneFixture.identities) === JSON.stringify(tombstoneFixture.fixedDeletes),
  'T.fixture 修後 planner 逐筆刪除可復活身分');
check(tombstoneFixture.reconciliationUpserts === 0,
  'T.fixture 全量對帳只寫差異，不重寫未變的數百列', `upserts=${tombstoneFixture.reconciliationUpserts}`);
check(persistence.evicts.filter(x => x.startsWith('destMismatch:')).length === 1 &&
  persistence.deletes.some(x => x.startsWith('T_DEST|')), 'T.dest 目的地驅逐有事件且有 physical DELETE');
check(persistence.evicts.filter(x => x.startsWith('badStreak:')).length === 1 &&
  persistence.deletes.some(x => x.startsWith('T_SAFE|')), 'T.safety 安全閥驅逐有事件且有 physical DELETE');
check(persistence.normal.upserts === 1 && persistence.normal.deletes === 0,
  'T.normal 非驅逐 bind/reattach/done 正常路徑仍 upsert');
check(persistence.finalWins.upserts === 1 && persistence.finalWins.deletes === 0 && persistence.finalWins.trackId === 'new',
  'T.final-wins 同輪先 evict 後同 key 重生以最終 binding 為準');
check(persistence.legacyZombie.upserts === 0 && persistence.legacyZombie.deletes === 1,
  'T.reconcile 部署前 legacy zombie 無新 evict event 也會對帳刪除');
check(persistence.sameRows.upserts === 0 && persistence.sameRows.deletes === 0,
  'T.diff-only 關係列與 final 完全相同時零重寫');
check(!mt1.evicts.some(x => x.startsWith('destMismatch:')), 'M-T1 預期 dest 子項轉紅');
check(!mt2.evicts.some(x => x.startsWith('badStreak:')), 'M-T2 預期 safety 子項轉紅');
check(mt3.deletes.length === 0, 'M-T3 預期 persistence delete 子項轉紅');
check(mt4.finalWins.deletes === 1 && mt4.finalWins.upserts === 0, 'M-T4 預期 final-wins 子項轉紅');
check(mt5.legacyZombie.deletes === 0, 'M-T5 預期 legacy reconciliation 子項轉紅');
check(mt7.sameRows.upserts > 0, 'M-T7 預期未變列重寫子項轉紅', JSON.stringify(mt7.sameRows));
check(workerWiringPass(workerAudit), 'T.worker worker 編排連上兩 pass、relation 對帳、有界分批與 marker 最後提交',
  `子項=${Object.values(workerAudit).filter(Boolean).length}/${Object.keys(workerAudit).length}`);
check(Object.values(workerMutations).every(result => result.baseline === true && result.mutant === false &&
  result.otherSame && !result.fullPass),
  'M-T6 預期 worker wiring 七種突變各只靠目標子項轉紅',
  Object.entries(workerMutations).map(([name, result]) => `${name}:${result.property}`).join(','));
check(workerRuntime.untrusted.source === 'legacy-untrusted' && workerRuntime.untrusted.bindings === 0 &&
  workerRuntime.untrusted.failClosedAvoidedRelation,
  'T.worker trip_dyn 與 marker 同時缺失時 fail closed，不載入 legacy zombie', JSON.stringify(workerRuntime.untrusted));
check(workerRuntime.persisted.bindingDeletes === tombstoneFixture.observedLowerBound &&
  workerRuntime.relationRows === workerRuntime.finalBindings && workerRuntime.fallback.source === 'relation' &&
  workerRuntime.fallback.exactEqual && workerRuntime.zombieKeysRemaining.length === 0,
  'T.worker fresh final 全量種回後，舊 zombie 消失且可信 fallback 可完整載回',
  `rows=${workerRuntime.finalBindings},deletes=${workerRuntime.persisted.bindingDeletes},batches=${workerRuntime.batchSizes.length}`);
check(workerRuntime.exactMutationDetected,
  'M-T8 預期 fallback 任一持久欄位錯誤會被逐筆 comparator 抓到');
check(workerRuntime.batchSizes.length > 1 && workerRuntime.batchSizes.every(size => size <= 80) && workerRuntime.markerIsLast,
  'T.worker 大型首次移轉每批不超過80句且 marker 只在最後一批', JSON.stringify(workerRuntime.batchSizes));
check(!!workerRuntime.interrupted.error && !workerRuntime.interrupted.markerWritten && !workerRuntime.interrupted.tripDynWritten &&
  workerRuntime.interrupted.partialRelationRows > 0,
  'T.worker 分批中途失敗不寫 marker／trip_dyn，下輪仍會 fail closed 重試', JSON.stringify(workerRuntime.interrupted));
check(!!workerRuntime.dailyInterrupted.error && !workerRuntime.dailyInterrupted.markerWritten &&
  workerRuntime.dailyInterrupted.fallbackSource === 'legacy-untrusted' && workerRuntime.dailyInterrupted.fallbackBindings === 0,
  'T.worker 日內 marker 已存在的大型分批若中斷，也先失效 marker 並 fail closed',
  JSON.stringify(workerRuntime.dailyInterrupted));

check(capture.rounds === 80 && capture.tripletFiles === 240 && capture.intervalRows === 80 &&
  capture.gapSec.n === 79 && capture.gapSec.min > 0 && capture.gapSec.max <= 45 && capture.over45 === 0 &&
  capture.uniqueDynAt === 41 && capture.cronTransitions === 40,
  'Z.capture 尖峰語料完整且零時間洞',
  `輪=${capture.rounds},檔=${capture.tripletFiles},間隔=${capture.gapSec.n},max=${capture.gapSec.max}s,dyn=${capture.uniqueDynAt},transition=${capture.cronTransitions}`);
check(peakGate.pass, 'Z.sample 完整尖峰逐線樣本門檻通過',
  peakGate.pass ? `rounds=${peakProfile.rounds},dyn=${peakProfile.uniqueDynAt}` : peakGate.shortfalls.join('; '));
const expectedShortfalls = ['rounds ', 'dyn.at ',
  ...allLines.flatMap(line => [`${line}.eligible `, `${line}.updates `])];
check(!shortGate.pass && expectedShortfalls.every(prefix => shortGate.shortfalls.some(item => item.startsWith(prefix))),
  'M-Z 預期只取3輪時，總量與逐具名線 eligible／true update 子項全數轉紅',
  shortGate.shortfalls.join('; '));

check(peakPhase[1].shifts.n > 0 && Object.keys(peakPhase[1].slotOffsets).length > 0 &&
  peakPhase[2].shifts.n > 0 && Object.keys(peakPhase[2].slotOffsets).length > 0,
  'A.1 尖峰 dir1/dir2 shift 與班次相位有可觀測樣本');
check(peakChanges.changes > 0 &&
  peakChanges.changes === peakChanges.reclaim + peakChanges.doneRebirth + peakChanges.freshReplacementAmbiguous,
  'A.2 尖峰身分變更只把快照可確證的 reclaim/done 分類，其餘明列無中間態歧義',
  `changes=${peakChanges.changes},reclaim=${peakChanges.reclaim},done=${peakChanges.doneRebirth},ambiguous=${peakChanges.freshReplacementAmbiguous}`);
check(peakRefProxy.births > 0 && refProxy.births > 0,
  'A.3 尖峰與午間 ref survivor proxy 均有樣本',
  `peak=${peakRefProxy.births},midday=${refProxy.births}`);
check(peakIdentity.duplicateTrackIds === 0 && peakIdentity.duplicateTripKeys === 0 &&
  identityBase.duplicateTrackIds === 0 && identityBase.duplicateTripKeys === 0,
  'C 尖峰／午間 active binding 身分唯一',
  `peak track/trip=${peakIdentity.duplicateTrackIds}/${peakIdentity.duplicateTripKeys},midday=${identityBase.duplicateTrackIds}/${identityBase.duplicateTripKeys}`);
const cMut = duplicateCounts([{ line: 'Y', dir: 1, tripKey: 'a', trackId: 'x', done: false },
  { line: 'Y', dir: 1, tripKey: 'b', trackId: 'x', done: false },
  { line: 'Y', dir: 1, tripKey: 'a', trackId: 'z', done: false }]);
check(cMut.duplicateTrackIds > 0 && cMut.duplicateTripKeys > 0, 'M-C 預期 C 兩子項轉紅', JSON.stringify(cMut));

const output = { peak: { capture, sample: { baseline: peakGate, mutationThreeRounds: shortGate },
  phase: peakPhase, identityTransitions: peakChanges, refProxy: peakRefProxy,
  duplicateCounts: peakIdentity, legacyScheduleDiagnostic: peakLegacySchedule },
midday: { rounds: midday.rounds.length, uniqueDynAt: midday.unique.length,
  cronTransitions: midday.unique.length - 1, phase, identityTransitions: changes, refProxy,
  duplicateCounts: identityBase, legacyScheduleDiagnostic: middayLegacySchedule },
tombstone: { fixture: tombstoneFixture, synthetic: persistence,
  workerWiring: { baseline: workerAudit, mutations: workerMutations },
  workerRuntime,
  mutations: { noDestEvent: mt1, noSafetyEvent: mt2, noDelete: mt3, firstEventDelete: mt4,
    noRelationalReconcile: mt5, rewriteIdentical: mt7 } }, checks };
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp/verify_binder_identity.json'), JSON.stringify(output, null, 2) + '\n');
console.log('\n【精簡結果】');
console.log(`尖峰 ${capture.rounds}輪/${capture.uniqueDynAt}個 dyn.at；間隔 ${capture.gapSec.n}筆，max=${capture.gapSec.max}s`);
console.log(`Y 相位樣本 dir1=${peakPhase[1].phaseSamples}, dir2=${peakPhase[2].phaseSamples}；身分變更=${peakChanges.changes}`);
console.log(`尖峰 active=${peakIdentity.active}，重複 track/trip=${peakIdentity.duplicateTrackIds}/${peakIdentity.duplicateTripKeys}`);
console.log(`M-Z shortfalls=${shortGate.shortfalls.length}（明細已寫 tmp/verify_binder_identity.json）`);
console.log(`legacy schedule diagnostic：peak inversions=${peakLegacySchedule.order.inversions}，不作 gate`);
if (failures) {
  console.error(`\nFAIL: binder identity ${failures} 項失敗`);
  process.exit(1);
}
console.log('\nPASS: binder identity 尖峰 Z/A/C、tombstone 與 mutation controls；legacy schedule 僅診斷');
