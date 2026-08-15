#!/usr/bin/env node
// 2026-08-15 斷訊回接驗收：拿當天真事故語料證明「訊號回來就以訊號為準，畫面上不能有多的」。
//
// 這場事故的形狀是**部分斷訊**，而且它推翻了第一版設計：
//   06:27:31 起北捷自家六條線同時從官方站牌消失，但環狀線（新北捷運自己的 feed）照常在報
//   ⇒ 全域 sourceRevision 全程正常前進 ⇒ 任何「看全域資料落差」的判準對這場事故一次都不會
//   觸發。判準因此必須逐線量「這條線多久沒出現官方列了」。
//   本檔的 mutation `global-gap-instead` 就是把那個錯誤設計釘死成會轉紅的對照組。
//
// 正向控制組全部取自真語料，沒有合成情境：
//   fixtures/trtc-outage-20260815/outage_0649.json   斷訊中（只剩環狀線 9 列）
//   fixtures/trtc-outage-20260815/outage_0652.json   斷訊中（同上，且含當時真實的 77 台名冊）
//   fixtures/trtc-outage-20260815/recovered_0701.json 恢復輪（九線 92 列回來）
// 負向控制組：fixtures/.../rounds 的 40 輪健康語料必須零觸發（誤殺正常輪比漏接嚴重得多）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FX = path.join(ROOT, 'fixtures/trtc-outage-20260815');
const ROUNDS_DIR = path.join(FX, 'rounds');
const LEDGER_PATH = path.join(HERE, 'trtc_board_ledger.mjs');
const ROSTER_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const DAY = '2026-08-15';
// 與 worker.js 的 TRTC_OFFICIAL_REALIGN_SEC、index.html 的 TRTC_FEED_STALE_SEC 同一個數字。
const REALIGN_SEC = 180;

// 🔴 實測定值。這些數字改動＝有人動了行為，必須說明為什麼（心得 35）。
const EXPECTED = {
  deadLines: ['BL', 'BR', 'G', 'O_LUZHOU', 'O_XINZHUANG', 'R'], // 斷訊期間歸零的六條線
  aliveLine: 'Y',                       // 全程正常在報的那條（新北捷運 feed）
  outageRosterVehicles: 77,             // 06:52 真實生產名冊
  deadLineStaleSec: 1501,               // 六條線在 06:52 已經 1501 秒沒被觀測到
  midOutageGapSec: 165,                 // 0649→0652 環狀線的間隔，刻意小於門檻
  recoveryGapSec: 2011,                 // 06:27:31 → 07:01:02
  reattached: 57,                       // 恢復時被官方回來的列重新接上、保住原 vehicleId
  removed: 9,                           // 接不上、依裁示清掉的推估車（57＋9＝66，守恆）
};

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
const load = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const fixture = name => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8'));

// ---- 管線驅動（與 worker.js 同一組函式、同一個呼叫順序）----
const countdown = sec => sec === 0 ? '列車進站' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
let tempSeq = 0;
async function loadPipeline({ rosterMutation = null } = {}) {
  const temps = [];
  const ledger = await import(pathToFileURL(LEDGER_PATH).href);
  let roster;
  if (rosterMutation) {
    const file = path.join(HERE, `.tmp-outagerec-${tempSeq++}.mjs`);
    fs.writeFileSync(file, rosterMutation(fs.readFileSync(ROSTER_PATH, 'utf8')));
    temps.push(file);
    roster = await import(pathToFileURL(file).href);
  } else {
    roster = await import(pathToFileURL(ROSTER_PATH).href);
  }
  const model = ledger.buildTrtcModel(load('data/trtc.json'), load('data/trtc_times.json'),
    load('data/trtc_codes.json'), { includeY: true });
  const rowsOf = board => {
    const raw = (board || []).map(row => ({ StationName: row.name, DestinationName: row.dest,
      CountDown: countdown(Number(row.eta) - Number(row.at)), NowDateTime: Number(row.at),
      TrainNumber: row.no }));
    const nowEpoch = Math.max(...raw.map(row => Number(row.NowDateTime)));
    const resolved = ledger.resolveBoardRows(model, raw, value => Number(value), new Map());
    const claimed = ledger.claimBoardRows(model, resolved.rows, nowEpoch, new Map());
    const collapsed = ledger.collapseClaims(claimed.claims);
    return { rows: ledger.attachOfficialTimelines(model, collapsed, resolved.rows, new Map()), nowEpoch };
  };
  return { model, rowsOf, reduce: roster.reduceOfficialRoster,
    cleanup: () => temps.forEach(file => { try { fs.unlinkSync(file); } catch {} }) };
}

// 把當時真實的生產名冊（boardPos）還原成 reducer 認得的 prior state。
// feedSeen 由每台車自己的 observedEpoch 逐線取最大值重建——真實系統記的就是這個值。
function priorFromBoardPos(boardPos, { feedSeenOverride = {} } = {}) {
  const feedSeen = {};
  for (const vehicle of boardPos.vehicles) {
    const line = vehicle.line, observed = Number(vehicle.observedEpoch);
    if (Number.isFinite(observed)) feedSeen[line] = Math.max(feedSeen[line] || 0, observed);
  }
  // tripKey 是 API 回應層才掛上的班次裝飾，D1 名冊本體沒有這一欄（已對兩者逐欄比對確認：
  // API 多出的欄位恰好只有 tripKey）。還原 prior 時剝掉它才是忠實還原 D1 的內容。
  return { schema: 4, day: DAY, nowEpoch: Number(boardPos.at), sourceRevision: Number(boardPos.sourceRevision),
    nextSequence: boardPos.vehicles.length + 1, feedSeen: { ...feedSeen, ...feedSeenOverride },
    vehicles: boardPos.vehicles.map(({ tripKey, ...vehicle }) => vehicle), aliases: [], diagnostics: {} };
}

function ghostSignal(vehicles) {
  const counts = new Map();
  for (const vehicle of vehicles) {
    const evidence = vehicle.birthEvidence || {};
    counts.set([evidence.sourceRevision, evidence.line, evidence.dir, evidence.from, evidence.to,
      evidence.arrEpoch, evidence.observedEpoch, Number(evidence.occurrence) || 0].join('|'),
      (counts.get([evidence.sourceRevision, evidence.line, evidence.dir, evidence.from, evidence.to,
        evidence.arrEpoch, evidence.observedEpoch, Number(evidence.occurrence) || 0].join('|')) || 0) + 1);
  }
  return [...counts.values()].filter(count => count > 1).length;
}

// ---- 情境：真事故重放 ----
async function replayIncident(pipeline, { realignSec = REALIGN_SEC, freshY = true } = {}) {
  const mid = fixture('outage_0652.json');
  // 語料只在 06:52 與 07:01 各取一張快照，中間那 510 秒的環狀線輪次沒有留下。真實系統每 15 秒
  // 就更新一次它，所以這裡把環狀線的 feedSeen 補成「恢復前 15 秒」——不補就會把「取樣間隔」
  // 誤當成「環狀線也斷了」寫進期望值。freshY=false 保留原值，用來證明這個修正確實有作用。
  const recovered = fixture('recovered_0701.json');
  const override = freshY ? { [EXPECTED.aliveLine]: Number(recovered.boardPos.at) - 15 } : {};
  const prior = priorFromBoardPos(mid.boardPos, { feedSeenOverride: override });
  const { rows, nowEpoch } = pipeline.rowsOf(recovered.board);
  const state = pipeline.reduce({ model: pipeline.model, rows, prior, day: DAY, nowEpoch,
    sourceRevision: String(nowEpoch), realignSec });
  return { prior, state, nowEpoch, rows };
}

// 「官方報了這一列，畫面上有沒有對應的車」——判準只用官方列本身與最終名冊，不讀 reducer
// 自己的計數器（那是同源的，它漏算就一起漏）。位置欄位取自官方列，車也是照著它建的，
// 所以對得起來的必然逐欄相同。
const rowKey = row => `${row.line}|${row.dir}|${row.from}|${row.to}|${row.arrEpoch}`;
const undrawnRows = (rows, vehicles) => {
  const drawn = new Set(vehicles.map(rowKey));
  return rows.filter(row => !drawn.has(rowKey(row)));
};

// 串接版：0649 → 0652 → 0701 全部走 reducer 自己的狀態鏈。與上面那支的差別只有一個——
// 恢復輪的 prior 是 reducer 自己吐出來的，所以逐線觀測時刻必須真的被持久化在名冊裡才算得出
// 「這條線斷多久了」。不串接就測不到那件事（persistence 的突變會沒有牙）。
async function replayIncidentChained(pipeline, { realignSec = REALIGN_SEC } = {}) {
  let state = priorFromBoardPos(fixture('outage_0649.json').boardPos);
  for (const name of ['outage_0652.json', 'recovered_0701.json']) {
    const { rows, nowEpoch } = pipeline.rowsOf(fixture(name).board);
    state = pipeline.reduce({ model: pipeline.model, rows, prior: state, day: DAY, nowEpoch,
      sourceRevision: String(nowEpoch), realignSec });
  }
  return state;
}

async function replayMidOutage(pipeline, { realignSec = REALIGN_SEC } = {}) {
  const early = fixture('outage_0649.json');
  const later = fixture('outage_0652.json');
  const prior = priorFromBoardPos(early.boardPos);
  const { rows, nowEpoch } = pipeline.rowsOf(later.board);
  return pipeline.reduce({ model: pipeline.model, rows, prior, day: DAY, nowEpoch,
    sourceRevision: String(nowEpoch), realignSec });
}

function replayHealthy(pipeline, realignSec) {
  const files = fs.readdirSync(ROUNDS_DIR).sort();
  let state = null; const perRound = []; let realignEvents = 0, realignedTotal = 0, recoveryBirths = 0;
  for (const file of files) {
    const round = JSON.parse(fs.readFileSync(path.join(ROUNDS_DIR, file), 'utf8'));
    const { rows, nowEpoch } = pipeline.rowsOf(round.board);
    state = pipeline.reduce({ model: pipeline.model, rows, prior: state, day: DAY, nowEpoch,
      sourceRevision: String(nowEpoch), realignSec });
    perRound.push(state.vehicles.length);
    if ((state.diagnostics.realignedLines || []).length > 0) realignEvents++;
    realignedTotal += Number(state.diagnostics.realigned) || 0;
    recoveryBirths += Number(state.diagnostics.recoveryBirths) || 0;
  }
  return { perRound, realignEvents, realignedTotal, recoveryBirths };
}

const pipeline = await loadPipeline();

// ---- 1. 語料前提：這場事故確實是部分斷訊 ----
const midFixture = fixture('outage_0652.json');
const seenAtMid = priorFromBoardPos(midFixture.boardPos).feedSeen;
const deadStale = EXPECTED.deadLines.map(line => Number(midFixture.boardPos.at) - Number(seenAtMid[line]));
check(midFixture.boardPos.vehicles.length === EXPECTED.outageRosterVehicles &&
  deadStale.every(sec => sec === EXPECTED.deadLineStaleSec) &&
  Number(midFixture.boardPos.at) - Number(seenAtMid[EXPECTED.aliveLine]) === 0,
  '語料前提：斷訊中六條北捷線全部停在同一刻、環狀線是當下的',
  `六線各停 ${EXPECTED.deadLineStaleSec} 秒、環狀線 0 秒、名冊 ${midFixture.boardPos.vehicles.length} 台`);

// ---- 2. 斷訊進行中：一台都不准掉 ----
const midState = await replayMidOutage(pipeline);
const midDead = EXPECTED.deadLines.reduce((sum, line) =>
  sum + midState.vehicles.filter(vehicle => vehicle.line === line).length, 0);
check((midState.diagnostics.realignedLines || []).length === 0 && Number(midState.diagnostics.realigned) === 0,
  '斷訊進行中零觸發：環狀線間隔小於門檻、六條死線根本沒有列可回來',
  `realignedLines=[] realigned=0（環狀線間隔 ${EXPECTED.midOutageGapSec} 秒 < ${REALIGN_SEC}）`);
check(midDead === 66,
  '斷訊進行中六條死線的車一台都沒掉（缺訊不退場的契約沒被動到）', `六線共 ${midDead} 台`);

// ---- 3. 訊號回來：以訊號為準 ----
const { prior, state: recState, rows: recRows } = await replayIncident(pipeline);
const realignedLines = (recState.diagnostics.realignedLines || []).slice().sort();
check(JSON.stringify(realignedLines) === JSON.stringify(EXPECTED.deadLines.slice().sort()),
  '恢復輪只對齊「剛回來的那六條線」，一直正常的環狀線不受影響',
  `realignedLines=${JSON.stringify(realignedLines)}`);

const survivingDead = recState.vehicles.filter(vehicle => EXPECTED.deadLines.includes(vehicle.line));
const notFromThisRound = survivingDead.filter(vehicle => Number(vehicle.sourceRevision) !== Number(recState.sourceRevision) ||
  vehicle.carried === true);
check(notFromThisRound.length === 0,
  '恢復後六條線上的每一台車都出自本輪官方列，沒有推估殘留',
  `六線 ${survivingDead.length} 台、殘留 ${notFromThisRound.length} 台`);

const yBefore = prior.vehicles.filter(vehicle => vehicle.line === EXPECTED.aliveLine).length;
const yAfter = recState.vehicles.filter(vehicle => vehicle.line === EXPECTED.aliveLine).length;
check(yAfter >= yBefore - 1,
  '沒斷的環狀線照舊沿用，不被恢復動作波及', `恢復前 ${yBefore} → 恢復後 ${yAfter} 台`);

// 「以訊號為準」不等於「全部砍掉重生」：官方名單回來後，接得上的車保住原本的 vehicleId
// （使用者的「從他早上一發車就認得他」），只有接不上的才清掉。這裡驗的是守恆式而不是魔術數字：
// 斷訊前六條線的每一台，恢復後不是被接回就是被清掉，沒有第三種下場、也不會兩邊都算。
const priorDeadIds = new Set(prior.vehicles.filter(vehicle => EXPECTED.deadLines.includes(vehicle.line))
  .map(vehicle => String(vehicle.vehicleId)));
const reattached = recState.vehicles.filter(vehicle => EXPECTED.deadLines.includes(vehicle.line) &&
  priorDeadIds.has(String(vehicle.vehicleId))).length;
check(reattached + Number(recState.diagnostics.realigned) === priorDeadIds.size &&
  reattached === EXPECTED.reattached && Number(recState.diagnostics.realigned) === EXPECTED.removed &&
  recState.vehicles.length === Number(recState.diagnostics.accepted) - Number(recState.diagnostics.completed) +
    Number(recState.diagnostics.carried),
  '斷訊前的車不是被官方接回就是被清掉，沒有第三種下場（守恆）',
  `六條線 ${priorDeadIds.size} 台 = 接回 ${reattached} ＋ 清掉 ${recState.diagnostics.realigned}；` +
  `carried=${recState.diagnostics.carried}（都在沒斷的線上）、總車數 ${prior.vehicles.length} → ${recState.vehicles.length}`);

check(ghostSignal(recState.vehicles) === 0,
  '恢復輪零幽靈：沒有任何一份出生證據對應兩台活車', `重複組=${ghostSignal(recState.vehicles)}`);

// 🔴「車子有官方數據就是在」在恢復輪的另一半：清掉推估車之後，官方此刻報的每一列都要有車。
// reducer 平常禁止站間出生（半途配不到就只能等它下一次到起點），但剛被清空的那幾條線上
// 沒有任何舊 ID 可接——實測 11 筆官方站間列會整輪畫不出來，其中 9 筆還帶官方車號
// （O_XINZHUANG 435/436/439/440/407、BL 204/210、R 109/120）。恢復輪因此開放一次性出生。
const recUndrawn = undrawnRows(recRows, recState.vehicles);
const recDupIds = recState.vehicles.length - new Set(recState.vehicles.map(v => String(v.vehicleId))).size;
const noSlots = new Map();
for (const vehicle of recState.vehicles) {
  if (!vehicle.officialNo) continue;
  const key = `${vehicle.line}|${vehicle.dir}|${vehicle.officialNo}`;
  noSlots.set(key, (noSlots.get(key) || 0) + 1);
}
const recDupNos = [...noSlots.values()].filter(count => count > 1).length;
check(recUndrawn.length === 0 && recDupIds === 0 && recDupNos === 0 &&
  Number(recState.diagnostics.recoveryBirths) > 0,
  '恢復輪不留「官方有列、畫面沒車」，且補出來的車沒有重複身分',
  `官方 ${recRows.length} 列全部有車、站間補生 ${recState.diagnostics.recoveryBirths} 台、` +
  `重複 vehicleId ${recDupIds}、同線同向重複車號 ${recDupNos}`);

// ---- 4. 恢復通知的素材 ----
const seenPrior = prior.feedSeen;
const outageSec = Math.max(...EXPECTED.deadLines.map(line => Number(recState.nowEpoch) - Number(seenPrior[line])));
check(outageSec === EXPECTED.recoveryGapSec &&
  realignedLines.length < Number(recState.diagnostics.linesWithRows),
  '通知素材：斷了多久算得出來，且判定為「部分斷訊」（同輪還有別條線一直正常在報）',
  `outageSec=${outageSec}、本輪有列的線=${recState.diagnostics.linesWithRows} 條、對齊 ${realignedLines.length} 條`);

// ---- 5. 取樣修正本身有作用（不把語料的取樣間隔寫成期望值）----
const rawY = await replayIncident(pipeline, { freshY: false });
check((rawY.state.diagnostics.realignedLines || []).includes(EXPECTED.aliveLine),
  '對照：不補環狀線的取樣間隔，它就會被誤判成也斷了——證明第 3 條的修正不是裝飾',
  `未修正時 realignedLines=${JSON.stringify((rawY.state.diagnostics.realignedLines || []).sort())}`);

// ---- 5b. 逐線觀測時刻要真的持久化在名冊裡 ----
const chained = await replayIncidentChained(pipeline);
const chainedLines = (chained.diagnostics.realignedLines || []).slice().sort();
check(EXPECTED.deadLines.every(line => chainedLines.includes(line)),
  '整條鏈跑下來仍認得出那六條線斷過（逐線觀測時刻確實跟著名冊持久化）',
  `串接重放後 realignedLines=${JSON.stringify(chainedLines)}`);

// ---- 6. 負向控制：健康語料零觸發 ----
const healthyOn = replayHealthy(pipeline, REALIGN_SEC);
const healthyOff = replayHealthy(pipeline, 0);
check(healthyOn.realignEvents === 0 && healthyOn.realignedTotal === 0 &&
  healthyOn.recoveryBirths === 0 &&
  JSON.stringify(healthyOn.perRound) === JSON.stringify(healthyOff.perRound),
  '健康的 40 輪完全不觸發，逐輪車數與關掉這道機制時一模一樣',
  `觸發輪=${healthyOn.realignEvents}、清掉=${healthyOn.realignedTotal}、` +
  `站間補生=${healthyOn.recoveryBirths}、逐輪車數逐一相同`);

pipeline.cleanup();

// ---- 7. 突變：每條斷言都要有牙 ----
const MUTATIONS = [
  ['no-realign', '整個逐線對齊拿掉（回到只會沿用的舊行為）',
    source => source.replace('if (realignLines.has(old.line)) { realigned++; continue; }', '')],
  ['global-gap-instead', '改用「全域資料落差」判斷斷訊（第一版設計，對部分斷訊全盲）',
    source => source.replace(
      /for \(const line of linesWithRows\) \{\s*const last = Number\(priorSeen\[line\]\);\s*if \(Number\.isFinite\(last\) && epoch - last >= realignSec\) realignLines\.add\(line\);\s*\}/,
      `const globalLast = Math.max(...Object.values(priorSeen).map(Number).filter(Number.isFinite), -Infinity);
    if (Number.isFinite(globalLast) && epoch - globalLast >= realignSec) {
      for (const line of linesWithRows) realignLines.add(line);
    }`)],
  ['forget-feedseen', '不把逐線觀測時刻持久化（每輪從零記，永遠算不出斷多久）',
    source => source.replace('nextSequence: state.nextSequence, feedSeen, vehicles,',
      'nextSequence: state.nextSequence, vehicles,')],
  ['realign-always', '門檻失效（每輪都當成剛恢復，正常輪合法離板的車也一起清掉）',
    source => source.replace('if (Number.isFinite(last) && epoch - last >= realignSec) realignLines.add(line);',
      'if (Number.isFinite(last)) realignLines.add(line);')],
  ['no-recovery-birth', '恢復輪不放行站間出生（清掉推估車之後，官方報的車補不回來）',
    source => source.replace('const recoverable = !coldStart && realignLines.has(current[index].line);',
      'const recoverable = false;')],
  ['recovery-birth-always', '站間出生不限剛恢復的線（正常輪也放行，每輪都複製一批重複的車）',
    source => source.replace('const recoverable = !coldStart && realignLines.has(current[index].line);',
      'const recoverable = !coldStart;')],
];

console.log('\n突變控制組：');
for (const [tag, label, mutate] of MUTATIONS) {
  const mutated = await loadPipeline({ rosterMutation: mutate });
  const reasons = [];
  try {
    const incident = await replayIncident(mutated);
    const lines = (incident.state.diagnostics.realignedLines || []).slice().sort();
    if (JSON.stringify(lines) !== JSON.stringify(EXPECTED.deadLines.slice().sort())) {
      reasons.push(`恢復輪對齊的線變成 ${JSON.stringify(lines)}`);
    }
    const leftovers = incident.state.vehicles.filter(vehicle =>
      EXPECTED.deadLines.includes(vehicle.line) && vehicle.carried === true);
    if (leftovers.length > 0) reasons.push(`六條線留下 ${leftovers.length} 台推估殘留`);
    const missing = undrawnRows(incident.rows, incident.state.vehicles);
    if (missing.length > 0) reasons.push(`恢復輪有 ${missing.length} 筆官方列畫不出車`);
    const ids = incident.state.vehicles.map(vehicle => String(vehicle.vehicleId));
    if (ids.length !== new Set(ids).size) reasons.push(`恢復輪出現 ${ids.length - new Set(ids).size} 個重複 vehicleId`);
    const chainedMutant = (await replayIncidentChained(mutated)).diagnostics.realignedLines || [];
    if (!EXPECTED.deadLines.every(line => chainedMutant.includes(line))) {
      reasons.push(`串接重放認不出六條線斷過（realignedLines=${JSON.stringify(chainedMutant.slice().sort())}）`);
    }
    const healthy = replayHealthy(mutated, REALIGN_SEC);
    if (healthy.realignEvents !== 0) reasons.push(`健康語料誤觸發 ${healthy.realignEvents} 輪、清掉 ${healthy.realignedTotal} 台`);
    if (healthy.recoveryBirths !== 0) reasons.push(`健康語料誤生 ${healthy.recoveryBirths} 台站間車`);
    if (JSON.stringify(healthy.perRound) !== JSON.stringify(healthyOff.perRound)) {
      reasons.push(`健康語料逐輪車數被改變（最大 ${Math.max(...healthy.perRound)} vs 基準 ${Math.max(...healthyOff.perRound)}）`);
    }
    const midOutage = await replayMidOutage(mutated);
    if (Number(midOutage.diagnostics.realigned) !== 0) reasons.push(`斷訊進行中誤清 ${midOutage.diagnostics.realigned} 台`);
  } catch (error) {
    reasons.push(`擲例外：${(error && error.message) || String(error)}`);
  }
  mutated.cleanup();
  check(reasons.length > 0, `突變「${label}」會被具名斷言攔下`, reasons.join('；') || '⚠ 沒有任何斷言變紅＝這條判準沒有牙');
}

console.log(`\n斷訊回接驗收：${failures === 0 ? '全數通過' : `${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
