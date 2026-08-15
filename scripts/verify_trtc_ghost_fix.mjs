#!/usr/bin/env node
// 2026-08-15 斷訊恢復幽靈車修法驗收：拿當日真語料（40 輪，含幽靈車隊現場）重放整條
// resolve→claim→collapse→attachTimelines→reduce 管線，證明
//   (1) 沒有任何一輪因組裝例外被丟掉（正式站當天 38 個有效輪次丟了 20 輪）；
//   (2) 冷啟動跑完 40 輪的名冊是健康的（車數、單起點停車數、重複出生證據）；
//   (3) 同一 frame 重複進 reducer 不會多生車。
// 判準全部對「最終產物」量，不看管線中段累加器；每條斷言都配突變控制組。
// 不打網路、不讀班表，只讀已保存的 fixtures。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ROUNDS_DIR = path.join(ROOT, 'fixtures/trtc-outage-20260815/rounds');
const LEDGER_PATH = path.join(HERE, 'trtc_board_ledger.mjs');
const ROSTER_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const DAY = '2026-08-15';

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
const load = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

// ---- 管線驅動（與 worker.js:1398-1401 同形狀：同一組函式、同一個呼叫順序）----
const countdown = sec => sec === 0 ? '列車進站' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const rawOfBoard = board => (board || []).map(row => ({
  StationName: row.name, DestinationName: row.dest,
  CountDown: countdown(Number(row.eta) - Number(row.at)),
  NowDateTime: Number(row.at), TrainNumber: row.no,
}));

let tempSeq = 0;
async function loadPipeline({ ledgerMutation = null, rosterMutation = null } = {}) {
  const temps = [];
  const importSource = async (sourcePath, mutate, tag) => {
    let source = fs.readFileSync(sourcePath, 'utf8');
    if (mutate) source = mutate(source);
    if (!mutate) return import(pathToFileURL(sourcePath).href);
    // 突變副本放在同目錄，維持相對 import 可解析（副本不可用 symlink：Node 會解回真實路徑）。
    const file = path.join(HERE, `.tmp-ghostfix-${tag}-${tempSeq++}.mjs`);
    fs.writeFileSync(file, source);
    temps.push(file);
    return import(pathToFileURL(file).href);
  };
  const ledger = await importSource(LEDGER_PATH, ledgerMutation, 'ledger');
  const roster = await importSource(ROSTER_PATH, rosterMutation, 'roster');
  const model = ledger.buildTrtcModel(load('data/trtc.json'), load('data/trtc_times.json'),
    load('data/trtc_codes.json'), { includeY: true });
  const rowsOf = board => {
    const raw = rawOfBoard(board);
    const nowEpoch = Math.max(...raw.map(row => Number(row.NowDateTime)));
    const resolved = ledger.resolveBoardRows(model, raw, value => Number(value), new Map());
    const claimed = ledger.claimBoardRows(model, resolved.rows, nowEpoch, new Map());
    const collapsed = ledger.collapseClaims(claimed.claims);
    return { rows: ledger.attachOfficialTimelines(model, collapsed, resolved.rows, new Map()), nowEpoch };
  };
  return { model, rowsOf, reduce: roster.reduceOfficialRoster,
    cleanup: () => temps.forEach(file => { try { fs.unlinkSync(file); } catch {} }) };
}

function replayRounds(pipeline, { prior = null } = {}) {
  const files = fs.readdirSync(ROUNDS_DIR).sort();
  const perRound = [], errors = [];
  let state = prior, births = 0, collapsedRows = 0;
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR, file), 'utf8'));
    try {
      const { rows, nowEpoch } = pipeline.rowsOf(fixture.board);
      state = pipeline.reduce({ model: pipeline.model, rows, prior: state, day: DAY, nowEpoch,
        sourceRevision: String(nowEpoch) });
      births += state.diagnostics.births;
      collapsedRows += Number(state.diagnostics.duplicateRowsCollapsed) || 0;
      perRound.push(state.vehicles.length);
    } catch (error) {
      errors.push(`${file}: ${(error && error.message) || String(error)}`);
    }
  }
  return { state, perRound, births, collapsedRows, errors, rounds: files.length };
}

// 最終產物的健康指標——全部從末輪名冊重數，不用管線中段計數（心得 31）。
function health(state) {
  const signature = vehicle => {
    const evidence = vehicle.birthEvidence || {};
    return [evidence.sourceRevision, evidence.line, evidence.dir, evidence.from, evidence.to,
      evidence.arrEpoch, evidence.observedEpoch].join('|');
  };
  const bySignature = new Map(), parked = new Map();
  for (const vehicle of state.vehicles) {
    bySignature.set(signature(vehicle), (bySignature.get(signature(vehicle)) || 0) + 1);
    if (vehicle.terminal && Number(vehicle.from) === Number(vehicle.to)) {
      const key = `${vehicle.line}|${vehicle.dir}|${vehicle.from}`;
      parked.set(key, (parked.get(key) || 0) + 1);
    }
  }
  return {
    vehicles: state.vehicles.length,
    duplicateBirthSignatures: [...bySignature.values()].filter(count => count > 1).length,
    parkedMax: Math.max(0, ...parked.values()),
    duplicateIds: state.vehicles.length - new Set(state.vehicles.map(x => String(x.vehicleId))).size,
  };
}

console.log('北捷幽靈車修法驗收（2026-08-15 真語料 40 輪）：\n');

const base = await loadPipeline();
const baseline = replayRounds(base);

// ---- 1. 組裝例外：正式站當天 38 個有效輪次丟了 20 輪（holdReason=assembly-error）----
const prodHeld = fs.readdirSync(ROUNDS_DIR).sort().filter(file => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR, file), 'utf8'));
  return fixture.boardPos && fixture.boardPos.holdReason === 'assembly-error';
}).length;
check(baseline.errors.length === 0, '40 輪全部組裝成功，沒有任何一輪被例外丟掉',
  `錯誤=${baseline.errors.length}／當天正式站丟了 ${prodHeld} 輪`);
check(prodHeld >= 15, '語料本身確實含有當天的組裝失敗現場（否則這支 gate 沒在驗東西）',
  `assembly-error 輪次=${prodHeld}`);

// ---- 2. 冷啟動跑完 40 輪的名冊必須健康 ----
const clean = health(baseline.state);
// 正式站當天重建後實測穩定落在 103–109 台；放寬到 90–120 容納語料邊界，超出即異常。
check(clean.vehicles >= 90 && clean.vehicles <= 120, '末輪車數落在正式站實測的健康區間',
  `${clean.vehicles} 台（正式站重建後實測 103–109）`);
check(Math.max(...baseline.perRound) <= 120 && Math.min(...baseline.perRound) >= 90,
  '逐輪車數全程都在健康區間，不是末輪剛好正常',
  `min=${Math.min(...baseline.perRound)} max=${Math.max(...baseline.perRound)}`);
check(clean.duplicateBirthSignatures === 0, '沒有任何一份出生證據對應多個活著的 ID',
  `重複組=${clean.duplicateBirthSignatures}`);
check(clean.duplicateIds === 0, '末輪名冊 vehicleId 唯一', `重複=${clean.duplicateIds}`);
// 官方站牌本來就會同時列出兩班未來發車，2 台是正常的；當天幽靈現場曾在單一起點堆到 17 台。
check(clean.parkedMax <= 4, '單一起點停放的車數維持在官方站牌本來就有的量級',
  `最多 ${clean.parkedMax} 台（幽靈現場曾達 17 台）`);

// ---- 3. 同一 frame 重複進 reducer 不得多生車（worker 同 frame 冪等的 reducer 端保證）----
const sampleFixture = JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR,
  fs.readdirSync(ROUNDS_DIR).sort()[20]), 'utf8'));
const sample = base.rowsOf(sampleFixture.board);
const once = base.reduce({ model: base.model, rows: sample.rows, prior: baseline.state, day: DAY,
  nowEpoch: sample.nowEpoch, sourceRevision: String(sample.nowEpoch) });
const twice = base.reduce({ model: base.model, rows: sample.rows, prior: once, day: DAY,
  nowEpoch: sample.nowEpoch, sourceRevision: String(sample.nowEpoch) });
const thrice = base.reduce({ model: base.model, rows: sample.rows, prior: twice, day: DAY,
  nowEpoch: sample.nowEpoch, sourceRevision: String(sample.nowEpoch) });
check(twice.diagnostics.births === 0 && thrice.diagnostics.births === 0,
  '同一 frame 重複 reduce 不再生車', `二次=${twice.diagnostics.births} 三次=${thrice.diagnostics.births}`);
check(twice.nextSequence === once.nextSequence && thrice.nextSequence === once.nextSequence,
  '同一 frame 重複 reduce 不推進 nextSequence',
  `${once.nextSequence}/${twice.nextSequence}/${thrice.nextSequence}`);
check(health(thrice).duplicateBirthSignatures === 0, '同一 frame 重複 reduce 不製造重複出生證據');

// ---- 4. 完全相同的 reducer 入口列合一（fail closed 的第二道防線）----
// 注意：上游 collapseClaims 本來就會併掉完全相同的 raw 看板列（實測複製三份仍是同一組
// reducer rows），所以這道防線只在「證據直接送到 reducer 入口」時才看得到，判準也下在那裡。
const plainRows = base.rowsOf(sampleFixture.board);
const plainState = base.reduce({ model: base.model, rows: plainRows.rows, prior: null, day: DAY,
  nowEpoch: plainRows.nowEpoch, sourceRevision: 'dup' });
const dupInput = (() => {
  const origins = plainRows.rows.filter(row => row.terminal && Number(row.from) === Number(row.to));
  return [...plainRows.rows, ...origins.map(row => JSON.parse(JSON.stringify(row))),
    ...origins.map(row => JSON.parse(JSON.stringify(row)))];
})();
const dupState = base.reduce({ model: base.model, rows: dupInput, prior: null, day: DAY,
  nowEpoch: plainRows.nowEpoch, sourceRevision: 'dup' });
check(dupInput.length > plainRows.rows.length, '複製樣本本身有效（確實多送了起點列）',
  `${plainRows.rows.length} → ${dupInput.length} 列`);
check(dupState.vehicles.length === plainState.vehicles.length &&
  dupState.diagnostics.duplicateRowsCollapsed === dupInput.length - plainRows.rows.length,
  '同一份起點證據送三份，名冊台數不變',
  `複製後=${dupState.vehicles.length} 原始=${plainState.vehicles.length} ` +
  `合掉=${dupState.diagnostics.duplicateRowsCollapsed}`);

// ---- 5. 斷訊整輪沒有官方列時，未到終點的車一台都不准少（永久廢棄的 timeout 規則）----
// 判準寫「是哪幾台」不寫「還剩幾台」：逐一比對 vehicleId，不用數量門檻（心得 35）。
const outageEpoch = baseline.state.nowEpoch + 11 * 60;
const stillDue = vehicle => vehicle.retireEpoch == null || !Number.isFinite(Number(vehicle.retireEpoch)) ||
  Number(vehicle.retireEpoch) > outageEpoch;
const expectedIds = baseline.state.vehicles.filter(stillDue).map(x => String(x.vehicleId));
const outageState = base.reduce({ model: base.model, rows: [], prior: baseline.state, day: DAY,
  nowEpoch: outageEpoch, sourceRevision: String(outageEpoch) });
const survivingIds = new Set(outageState.vehicles.map(x => String(x.vehicleId)));
const missing = expectedIds.filter(id => !survivingIds.has(id));
check(expectedIds.length >= 20, '斷訊樣本本身有效（有夠多未到終點的車可被誤刪）',
  `${expectedIds.length} 台未到終點`);
check(missing.length === 0, '斷訊整輪無官方列時，未到終點的車一台都沒少',
  `少了 ${missing.length} 台`);

// ---- 突變控制組：每條斷言都要有牙 ----
console.log('\nMutation control：');
function mustReplace(source, from, to, tag) {
  if (!source.includes(from)) throw new Error(`${tag} mutation anchor 不存在`);
  if (source.split(from).length - 1 !== 1) throw new Error(`${tag} mutation anchor 不唯一`);
  return source.replace(from, to);
}

const MUTATIONS = [
  ['接鏈改寫起點列 depEpoch（修法前的正式站行為）', {
    ledgerMutation: source => mustReplace(source, '      if (current.terminal) continue;',
      '      if (false) continue;', 'terminal-dep'),
  }, result => result.errors.length > 0],
  ['取消相同列合一', {
    rosterMutation: source => mustReplace(source,
      'if (byKey.has(key)) { duplicateRowsCollapsed++; continue; }',
      'if (byKey.has(key)) { duplicateRowsCollapsed++; byKey.set(key + duplicateRowsCollapsed, row); continue; }',
      'no-collapse'),
  }, null, 'dup'],
  ['缺訊就刪車（永久廢棄的規則）', {
    rosterMutation: source => mustReplace(source,
      '  // 這是「到已知終點」的時刻，不是資料齡或缺訊 timeout。',
      '  if (nowEpoch - Number(vehicle.observedEpoch) > 600) return null;', 'silence-limit'),
  }, null, 'outage'],
];

for (const [label, mutation, predicate, mode] of MUTATIONS) {
  let pipeline = null;
  try {
    pipeline = await loadPipeline(mutation);
    if (mode === 'dup') {
      // 合一被關掉時，同一份起點證據送三份必須多出車來（否則那條斷言沒有牙）。
      const mutated = pipeline.reduce({ model: pipeline.model, rows: dupInput, prior: null, day: DAY,
        nowEpoch: plainRows.nowEpoch, sourceRevision: 'dup' });
      check(mutated.vehicles.length > plainState.vehicles.length, `${label} 會被具名契約攔下`,
        `複製後=${mutated.vehicles.length} 原始=${plainState.vehicles.length}`);
    } else if (mode === 'outage') {
      const mutated = pipeline.reduce({ model: pipeline.model, rows: [], prior: baseline.state, day: DAY,
        nowEpoch: outageEpoch, sourceRevision: String(outageEpoch) });
      const ids = new Set(mutated.vehicles.map(x => String(x.vehicleId)));
      const lost = expectedIds.filter(id => !ids.has(id));
      check(lost.length > 0, `${label} 會被具名契約攔下`, `少了 ${lost.length} 台`);
    } else {
      const result = replayRounds(pipeline);
      check(predicate(result), `${label} 會被具名契約攔下`,
        `錯誤=${result.errors.length} 末輪車數=${result.state ? result.state.vehicles.length : 'n/a'}`);
    }
  } catch (error) {
    check(false, `${label} mutation 可執行`, String((error && error.message) || error));
  } finally {
    if (pipeline) pipeline.cleanup();
  }
}

base.cleanup();
console.log(`\n幽靈車修法：${baseline.rounds} 輪重放、末輪 ${clean.vehicles} 台、` +
  `累計 births=${baseline.births}、合掉重複列=${baseline.collapsedRows}、` +
  `重複出生證據=${clean.duplicateBirthSignatures}、單起點最多 ${clean.parkedMax} 台。`);
if (failures) { console.log(`\n❌ ${failures} 項未通過`); process.exit(1); }
console.log('\n✅ 幽靈車修法驗收全數通過');
