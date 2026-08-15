#!/usr/bin/env node
// 2026-08-15 斷訊恢復幽靈車修法驗收：拿當日真語料（40 輪，含幽靈車隊現場）重放整條
// resolve→claim→collapse→attachTimelines→reduce 管線，證明
//   (1) 沒有任何一輪因組裝例外被丟掉（正式站當天 38 個有效輪次丟了 22 輪）；
//   (2) 冷啟動跑完 40 輪的名冊是健康的，且健康判準對「真實幽靈車現場」確實會變紅；
//   (3) 官方同時報兩台就是兩台，一台都不准少畫；
//   (4) 同一份出生證據被重放時不得再生一台。
// 判準全部對「最終產物」量，不看管線中段累加器；每條斷言都配突變控制組。
// 不打網路、不讀班表，只讀已保存的 fixtures。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ROUNDS_DIR = path.join(ROOT, 'fixtures/trtc-outage-20260815/rounds');
const GHOST_FIXTURE = 'fixtures/trtc-outage-20260815/d1_roster_backup_pre_reset.json';
const LEDGER_PATH = path.join(HERE, 'trtc_board_ledger.mjs');
const ROSTER_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const DAY = '2026-08-15';

// 🔴 實測定值，不是門檻區間。區間會讓真實回歸躲在裡面（心得 35：判準別綁在會漂移的量上，
// 非寫數字不可時要寫「量到的那個值」並強制人來重新解釋）。這些值改動＝必須說明為什麼。
const EXPECTED = {
  rounds: 40, assemblyError: 22, official: 16, outage: 2,
  finalVehicles: 106, minVehicles: 99, maxVehicles: 109, births: 138,
  ghostDuplicateGroups: 5, ghostExtraVehicles: 9,
};

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
const load = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

// ---- 管線驅動（與 worker.js:1398-1404 同形狀：同一組函式、同一個呼叫順序）----
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
  let state = prior, births = 0, duplicateRowsObserved = 0, replayBirthsBlocked = 0;
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR, file), 'utf8'));
    try {
      const { rows, nowEpoch } = pipeline.rowsOf(fixture.board);
      state = pipeline.reduce({ model: pipeline.model, rows, prior: state, day: DAY, nowEpoch,
        sourceRevision: String(nowEpoch) });
      births += state.diagnostics.births;
      duplicateRowsObserved += Number(state.diagnostics.duplicateRowsObserved) || 0;
      replayBirthsBlocked += Number(state.diagnostics.replayBirthsBlocked) || 0;
      perRound.push(state.vehicles.length);
    } catch (error) {
      errors.push(`${file}: ${(error && error.message) || String(error)}`);
    }
  }
  return { state, perRound, births, duplicateRowsObserved, replayBirthsBlocked, errors, rounds: files.length };
}

// 幽靈車的實際結構特徵：同一份官方出生證據對應多個活著的 ID。
// 這支函式同時用在「健康名冊必須為 0」與「真實幽靈現場必須非 0」兩邊——
// 後者是這條判準有沒有牙的唯一證據（實測：真實現場 5 組、多出 9 台）。
function ghostSignal(vehicles) {
  const counts = new Map();
  for (const vehicle of vehicles) {
    const evidence = vehicle.birthEvidence || {};
    const key = [evidence.sourceRevision, evidence.line, evidence.dir, evidence.from, evidence.to,
      evidence.arrEpoch, evidence.observedEpoch, Number(evidence.occurrence) || 0].join('|');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = [...counts.values()].filter(count => count > 1);
  return { groups: duplicates.length, extraVehicles: duplicates.reduce((sum, n) => sum + n - 1, 0) };
}

function health(state) {
  const parked = state.vehicles.filter(v => v.terminal && Number(v.from) === Number(v.to));
  return {
    vehicles: state.vehicles.length,
    ...ghostSignal(state.vehicles),
    parked: parked.length,
    duplicateIds: state.vehicles.length - new Set(state.vehicles.map(x => String(x.vehicleId))).size,
  };
}

console.log('北捷幽靈車修法驗收（2026-08-15 真語料 40 輪）：\n');

const base = await loadPipeline();
const baseline = replayRounds(base);

// ---- 1. 語料組成：逐類釘死，不用「至少 N 輪」（分母無聲縮水就再也發現不了）----
const classes = { 'assembly-error': 0, official: 0, outage: 0 };
for (const file of fs.readdirSync(ROUNDS_DIR).sort()) {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR, file), 'utf8'));
  const key = (fixture.boardPos && fixture.boardPos.holdReason) ||
    (fixture.boardPos && fixture.boardPos.feedMode) || 'unknown';
  classes[key] = (classes[key] || 0) + 1;
}
check(baseline.rounds === EXPECTED.rounds && classes['assembly-error'] === EXPECTED.assemblyError &&
  classes.official === EXPECTED.official && classes.outage === EXPECTED.outage,
  '語料組成與當天實況一致（含組裝失敗現場，否則這支 gate 沒在驗東西）',
  `${baseline.rounds} 輪＝assembly ${classes['assembly-error']}／正常 ${classes.official}／斷訊 ${classes.outage}`);
check(baseline.errors.length === 0, '40 輪全部組裝成功，沒有任何一輪被例外丟掉',
  `錯誤=${baseline.errors.length}／當天正式站在 38 個有效輪次丟了 ${classes['assembly-error']} 輪`);

// ---- 2. 冷啟動跑完 40 輪的名冊必須健康（釘實測定值，不是區間）----
const clean = health(baseline.state);
check(clean.vehicles === EXPECTED.finalVehicles &&
  Math.min(...baseline.perRound) === EXPECTED.minVehicles &&
  Math.max(...baseline.perRound) === EXPECTED.maxVehicles &&
  baseline.births === EXPECTED.births,
  '重放軌跡逐值等於實測基準（車數、逐輪上下界、累計出生）',
  `末輪 ${clean.vehicles}／逐輪 ${Math.min(...baseline.perRound)}–${Math.max(...baseline.perRound)}／` +
  `births ${baseline.births}`);
check(clean.groups === 0 && clean.extraVehicles === 0, '沒有任何一份出生證據對應多個活著的 ID',
  `重複組=${clean.groups}、多出=${clean.extraVehicles} 台`);
check(clean.duplicateIds === 0, '末輪名冊 vehicleId 唯一', `重複=${clean.duplicateIds}`);

// ---- 2b. 上面那條判準有沒有牙：拿當天真實的幽靈車名冊當正向控制組 ----
// 沒有這一條，「重複組=0」可能只是因為判準根本測不到幽靈車（我試過的
// 「單起點停放數」與「同起點 ETA 重複」兩個判準，對這份真實現場都是綠的＝沒牙，已棄用）。
const ghostFleet = load(GHOST_FIXTURE);
const ghost = ghostSignal(ghostFleet.vehicles);
check(ghost.groups === EXPECTED.ghostDuplicateGroups && ghost.extraVehicles === EXPECTED.ghostExtraVehicles,
  '健康判準對當天真實的幽靈車名冊確實會變紅（判準有牙的證據）',
  `${ghostFleet.vehicles.length} 台裡 ${ghost.groups} 組重複證據、多出 ${ghost.extraVehicles} 台`);

// ---- 3. 同一 frame 重複進 reducer 不得多生車 ----
// 注意：正式站真正倚賴的是 worker 的 CAS／barrier 短路，那一層的判準在
// verify_trtc_official_worker.mjs（含 CAS 敗退後重放已套用 frame 的注入測試）。
// 這裡驗的是 reducer 自己的性質——worker 那層若失效，這層是最後一道。
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
check(ghostSignal(thrice.vehicles).groups === 0, '同一 frame 重複 reduce 不製造重複出生證據');

// 註：重放閘門（同一份出生證據不得第二次生車）的契約**不放在這支**——這批語料裡
// 湊不出自然發生的重放條件，硬寫的斷言實測沒牙（突變拿掉閘門仍然全綠）。
// 它的判準在兩處各有一條、且都通過突變控制：
//   scripts/verify_trtc_official_roster.mjs 「同一份出生證據不得第二次生車」（合成情境）
//   scripts/verify_trtc_official_worker.mjs 「CAS 敗退後重放已套用的 frame…」（真的注入 CAS 衝突）
// ---- 4. 官方送出幾筆就是幾台：完全相同的兩列＝兩台真車，一台都不准少畫 ----
// 🔴 使用者裁示「車子有官方數據就是在」。2026-08-15 我一度把相同列合一當成幽靈車防線，
// 實測那會刪掉無車號路線（BR／Y）的真車——上游 collapseClaims 對這種列是原樣送過來的。
const plainRows = base.rowsOf(sampleFixture.board);
const plainState = base.reduce({ model: base.model, rows: plainRows.rows, prior: null, day: DAY,
  nowEpoch: plainRows.nowEpoch, sourceRevision: 'dup' });
const originRows = plainRows.rows.filter(row => row.terminal && Number(row.from) === Number(row.to));
const dupInput = [...plainRows.rows, ...originRows.map(row => JSON.parse(JSON.stringify(row)))];
const dupState = base.reduce({ model: base.model, rows: dupInput, prior: null, day: DAY,
  nowEpoch: plainRows.nowEpoch, sourceRevision: 'dup' });
check(originRows.length >= 5, '複製樣本本身有效（有夠多起點列可複製）',
  `${plainRows.rows.length} 列裡有 ${originRows.length} 筆起點列`);
check(dupState.vehicles.length === plainState.vehicles.length + originRows.length &&
  dupState.diagnostics.duplicateRowsObserved === originRows.length &&
  ghostSignal(dupState.vehicles).groups === 0,
  '起點列各送兩份＝官方報了兩台，名冊必須多出等量的車',
  `${plainState.vehicles.length} → ${dupState.vehicles.length} 台` +
  `（多 ${dupState.vehicles.length - plainState.vehicles.length}／複製 ${originRows.length}）`);

// ---- 5. 斷訊整輪沒有官方列時，未到終點的車一台都不准少（永久廢棄的 timeout 規則）----
// 判準寫「是哪幾台」不寫「還剩幾台」；期望集合的來源必須獨立於產品自己算的 retireEpoch
// （心得 29：判準不得與實作共用推導假設），故改由官方 timeline 的最後一段到站時刻推出。
// 獨立來源＝官方 arrEpoch／to／dest ＋ 路線段秒的**下界**（model 的原始資料）。
// 「連用全線最快的段秒都到不了終點」的車，物理上不可能已經收車，一律必須存活。
// 用 retireEpoch 當期望值就是拿產品自己算的東西驗自己（心得 29）。
const outageEpoch = baseline.state.nowEpoch + 11 * 60;
const minSegmentSec = new Map([...base.model.lines].map(([id, line]) => {
  const runs = [...(line.runs ? line.runs.values() : [])].map(Number).filter(n => Number.isFinite(n) && n > 0);
  return [id, runs.length ? Math.min(...runs) : 60];
}));
const cannotHaveArrived = vehicle => Number(vehicle.arrEpoch) +
  Math.abs(Number(vehicle.dest) - Number(vehicle.to)) * (minSegmentSec.get(vehicle.line) ?? 60) > outageEpoch;
const expectedIds = baseline.state.vehicles.filter(cannotHaveArrived).map(x => String(x.vehicleId));
const outageState = base.reduce({ model: base.model, rows: [], prior: baseline.state, day: DAY,
  nowEpoch: outageEpoch, sourceRevision: String(outageEpoch) });
const survivingIds = new Set(outageState.vehicles.map(x => String(x.vehicleId)));
const missing = expectedIds.filter(id => !survivingIds.has(id));
check(expectedIds.length >= 40, '斷訊樣本本身有效（有夠多不可能已抵達終點的車可被誤刪）',
  `${expectedIds.length} 台以最快段秒也到不了終點`);
check(missing.length === 0, '斷訊整輪無官方列時，不可能已抵達終點的車一台都沒少',
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
  }, 'replay', result => result.errors.length > 0],
  ['把完全相同的兩列合一（會刪掉官方報上來的真車）', {
    rosterMutation: source => mustReplace(source,
      '  return { rows: normalized.sort(compareRows), duplicateRowsObserved };',
      '  const deduped = normalized.filter((row, index) =>\n' +
      '    normalized.findIndex(other => rowKey(other) === rowKey(row)) === index);\n' +
      '  return { rows: deduped.sort(compareRows), duplicateRowsObserved };', 'collapse'),
  }, 'dup'],
  ['缺訊就刪車（永久廢棄的規則）', {
    rosterMutation: source => mustReplace(source,
      '  // 這是「到已知終點」的時刻，不是資料齡或缺訊 timeout。',
      '  if (nowEpoch - Number(vehicle.observedEpoch) > 600) return null;', 'silence-limit'),
  }, 'outage'],
];

for (const [label, mutation, mode, predicate] of MUTATIONS) {
  let pipeline = null;
  try {
    pipeline = await loadPipeline(mutation);
    if (mode === 'dup') {
      const mutated = pipeline.reduce({ model: pipeline.model, rows: dupInput, prior: null, day: DAY,
        nowEpoch: plainRows.nowEpoch, sourceRevision: 'dup' });
      check(mutated.vehicles.length < dupState.vehicles.length, `${label} 會被具名契約攔下`,
        `複製後 ${dupState.vehicles.length} → 突變後 ${mutated.vehicles.length} 台`);
    } else if (mode === 'replay-gate') {
      const mutatedAdvanced = pipeline.reduce({ model: pipeline.model, rows: sample.rows,
        prior: baseline.state, day: DAY, nowEpoch: sample.nowEpoch + 40,
        sourceRevision: String(sample.nowEpoch + 40) });
      const mutatedReplay = pipeline.reduce({ model: pipeline.model, rows: sample.rows,
        prior: mutatedAdvanced, day: DAY, nowEpoch: sample.nowEpoch, sourceRevision: String(sample.nowEpoch) });
      check(mutatedReplay.vehicles.length > mutatedAdvanced.vehicles.length ||
        ghostSignal(mutatedReplay.vehicles).groups > 0, `${label} 會被具名契約攔下`,
        `${mutatedAdvanced.vehicles.length} → ${mutatedReplay.vehicles.length} 台、` +
        `重複證據 ${ghostSignal(mutatedReplay.vehicles).groups} 組`);
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
  `累計 births=${baseline.births}、擋下重放出生=${baseline.replayBirthsBlocked}、` +
  `官方重複列=${baseline.duplicateRowsObserved}、重複出生證據=${clean.groups} 組。`);
if (failures) { console.log(`\n❌ ${failures} 項未通過`); process.exit(1); }
console.log('\n✅ 幽靈車修法驗收全數通過');
