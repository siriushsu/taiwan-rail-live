#!/usr/bin/env node
// 2026-08-15 北捷起點身分驗收：畫面上「同段擠三台、其中一台無號」的幽靈車，根因全在起點站。
//
// 官方站牌在起點站每個終點各報「下一班」（頂埔／亞東醫院、新店／台電大樓…），起點列永遠沒有車號，
// 「列車進站」時 arrEpoch＝當下（不是發車錨點），而且第一段（起點→第一站）的官方到站間隔普遍短於
// 模型段秒（08-15 語料 BL/G/O/R 逐列比值 0.5–0.8、中途段 p50 1.28；舊門檻拒絕 15/20 次真實接手）。舊碼在四個地方一起把它做壞：
//   L1 collapseClaims 把同起點兩筆終點不同的倒數合成一筆（arr 取一班、timeline 取另一班的 chimera），
//      被吃掉那班翻回來時以新 ID 出生，舊 ID 釘死起點；
//   L2 起點列與第一段列用 progress<=0.25 判同車，起點列的 arr 不是發車錨點，同一台車 progress 0.31 就被拆成兩筆；
//   R1 physicallyReachable 用段秒門檻擋起點車接自己的第一段——真車釘死起點，第一段身分被後方舊車搶走；
//   R2 alignOrdered 兩側同位置排序鍵不一致（rows 走 dest 序、名冊走 arr 遞增序），保序 DP 天天交叉。
// 本檔每一條契約都配突變控制組；語料段用 40 輪真健康語料整段重放（與 worker 同一組函式、同一呼叫順序）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ROUNDS_DIR = path.join(ROOT, 'fixtures/trtc-outage-20260815/rounds');
const PEAK_DIR = path.join(ROOT, 'tmp/binder-fixtures/rounds-peak'); // 未追蹤的 08-13 尖峰語料，有就多驗一組
const LEDGER_PATH = path.join(HERE, 'trtc_board_ledger.mjs');
const ROSTER_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const DAY = '2026-08-15';
const SAME_ARRIVAL_SEC = 90;

// 🔴 實測定值（心得 35：非寫數字不可時寫「量到的那個值」並強制人來重新解釋）。改動＝必須說明為什麼。
const EXPECTED = {
  rounds: 40,
  sharedPairsTotal: 0,      // 同 track 同向兩台 timeline 共用同站到站（≤90 秒）的配對數，逐輪累計
  staleTotal: 0,            // observedEpoch 距本輪 >300 秒仍在名冊，逐輪累計
  stuckOriginTotal: 7,      // 非 XBT、timeline 只有 1 筆、from==to、當輪沒被官方列配到，逐輪累計
                            // （全部是同一台：BL 亞東 08:14:32 的車在第 25–26、32–36 輪官方亞東列暫缺／翻到下下班時
                            //   的合法 carried，第 37 輪 08:09:34 接回原 ID）
  births: 136,              // 冷啟動 99＋17 分鐘內 37 次真出生（**不含**短程起點例外，見下一行）
  shortTurnBirths: 3,       // 短程／區間車起點例外（2026-08-21）在這份語料放行的台數
};

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
const load = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const countdown = sec => sec <= 0 ? '列車進站' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

let tempSeq = 0;
function mustReplace(source, from, to, tag) {
  if (!source.includes(from)) throw new Error(`${tag} mutation anchor 不存在`);
  if (source.split(from).length - 1 !== 1) throw new Error(`${tag} mutation anchor 不唯一`);
  return source.replace(from, to);
}
async function loadPipeline({ ledgerMutation = null, rosterMutation = null } = {}) {
  const temps = [];
  const importSource = async (sourcePath, mutate, tag) => {
    if (!mutate) return import(pathToFileURL(sourcePath).href);
    // 突變副本放同目錄（副本不可用 symlink：Node 會解回真實路徑）。
    const file = path.join(HERE, `.tmp-originid-${tag}-${tempSeq++}.mjs`);
    fs.writeFileSync(file, mutate(fs.readFileSync(sourcePath, 'utf8')));
    temps.push(file);
    return import(pathToFileURL(file).href);
  };
  const ledger = await importSource(LEDGER_PATH, ledgerMutation, 'ledger');
  const roster = await importSource(ROSTER_PATH, rosterMutation, 'roster');
  const model = ledger.buildTrtcModel(load('data/trtc.json'), load('data/trtc_times.json'),
    load('data/trtc_codes.json'), { includeY: true });
  return { ledger, roster, model, reduce: roster.reduceOfficialRoster,
    cleanup: () => temps.forEach(file => { try { fs.unlinkSync(file); } catch {} }) };
}

// ---- 合成模型：一條 5 站線，段秒 60 ----
function syntheticModel(segmentSeconds = 60) {
  const runs = new Map();
  for (let i = 0; i + 1 < 5; i++) { runs.set(`${i}>${i + 1}`, segmentSeconds); runs.set(`${i + 1}>${i}`, segmentSeconds); }
  return { lines: new Map([['L', { stations: Array.from({ length: 5 }, (_, i) => ({ name: `S${i}`, dwell: 25 })), runs }]]) };
}
// dir 2 由站 0 出發；起點 claim 與 claimBoardRows 產出同形狀（from==to、run 0、progress 0、terminal）。
const originClaim = ({ dest, arr, no = '' }) => ({ line: 'L', dir: 2, stationIdx: 0, destIdx: dest, no,
  from: 0, to: 0, run: 0, depEpoch: arr, arrEpoch: arr, progress: 0, ix: 0, terminal: true, eventClaims: [] });
const firstHopClaim = ({ dest, arr, progress, no = '' }) => ({ line: 'L', dir: 2, stationIdx: 1, destIdx: dest, no,
  from: 0, to: 1, run: 60, depEpoch: arr - 60, arrEpoch: arr, progress, ix: progress, terminal: false, eventClaims: [] });
function assemble(pipeline, model, claims) {
  return pipeline.ledger.attachOfficialTimelines(model, pipeline.ledger.collapseClaims(claims), [], new Map());
}
const row = ({ from, to, dest, arr, terminal = false, run = 60, no = '' }) =>
  ({ line: 'L', dir: 2, from, to, dest, arrEpoch: arr, no, terminal, run: terminal ? 0 : run });

// ---- 語料重放（與 worker.js 同一組函式、同一呼叫順序；分支 hint 跨輪保留＝worker 的 trtcBoardBranchHints）----
function replayCorpus(pipeline, dir, { rowsFrom = 'board', day = DAY } = {}) {
  const files = fs.readdirSync(dir).filter(name => name.endsWith('_live.json') || /^round_\d+\.json$/.test(name)).sort();
  let hints = new Map(), state = null;
  const totals = { rounds: 0, births: 0, shortTurnBirths: 0, stuck: 0, stale: 0, sharedPairs: 0, maxVehicles: 0 };
  const stuckExamples = [], sharedExamples = [];
  const trackOf = line => line.startsWith('O_') ? 'O' : line;
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const frameAt = Number(fixture.boardPos && fixture.boardPos.at);
    const raw = (fixture.board || []).map(item => {
      const at = Number.isFinite(Number(item.at)) ? Number(item.at) : frameAt;
      return { StationName: item.name, DestinationName: item.dest, CountDown: countdown(Number(item.eta) - at),
        NowDateTime: at, TrainNumber: item.no };
    });
    if (!raw.length) continue;
    const nowEpoch = Math.max(...raw.map(item => Number(item.NowDateTime)));
    const resolved = pipeline.ledger.resolveBoardRows(pipeline.model, raw, value => Number(value), hints);
    hints = resolved.lineHints;
    const claimed = pipeline.ledger.claimBoardRows(pipeline.model, resolved.rows, nowEpoch, new Map());
    const rows = pipeline.ledger.attachOfficialTimelines(pipeline.model, pipeline.ledger.collapseClaims(claimed.claims),
      resolved.rows, new Map());
    state = pipeline.reduce({ model: pipeline.model, rows, prior: state, day, nowEpoch, sourceRevision: String(nowEpoch),
      realignSec: 180 });
    totals.rounds++;
    totals.births += state.diagnostics.births;
    totals.shortTurnBirths += Number(state.diagnostics.shortTurnBirths) || 0;
    totals.maxVehicles = Math.max(totals.maxVehicles, state.vehicles.length);
    const vehicles = state.vehicles;
    const matched = new Set(vehicles.filter(v => String(v.sourceRevision) === String(nowEpoch) && !v.carried).map(v => v.vehicleId));
    for (const v of vehicles) {
      if ((v.timeline || []).length <= 1 && Number(v.from) === Number(v.to) && !matched.has(v.vehicleId) && !/_XBT$/.test(v.line)) {
        totals.stuck++;
        if (stuckExamples.length < 3) stuckExamples.push(`${v.line}/${v.vehicleId.slice(-4)}@${totals.rounds}`);
      }
      if (nowEpoch - Number(v.observedEpoch) > 300) totals.stale++;
    }
    const byTrack = new Map();
    for (const v of vehicles) {
      const key = `${trackOf(v.line)}|${v.dir}`;
      if (!byTrack.has(key)) byTrack.set(key, []);
      byTrack.get(key).push(v);
    }
    for (const list of byTrack.values()) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const arrivals = new Map((list[a].timeline || []).map(seg => [Number(seg.to), Number(seg.arrEpoch)]));
        const hit = (list[b].timeline || []).find(seg => arrivals.has(Number(seg.to)) &&
          Math.abs(arrivals.get(Number(seg.to)) - Number(seg.arrEpoch)) <= SAME_ARRIVAL_SEC);
        if (hit) {
          totals.sharedPairs++;
          if (sharedExamples.length < 3) sharedExamples.push(`${list[a].line}/${list[a].vehicleId.slice(-4)}×${list[b].vehicleId.slice(-4)}@${hit.to}`);
        }
      }
    }
  }
  return { ...totals, stuckExamples, sharedExamples, state };
}

console.log('北捷起點身分驗收：\n');
const base = await loadPipeline();
const model = syntheticModel();

// ---- 1. ledger：起點兩筆終點不同的倒數＝兩台車，不合併 ----
{
  const rows = assemble(base, model, [originClaim({ dest: 4, arr: 1300 }), originClaim({ dest: 3, arr: 1000 })]);
  check(rows.length === 2 && rows.every(r => r.terminal) && new Set(rows.map(r => Number(r.destIdx))).size === 2,
    'ledger：同一起點兩筆終點不同的倒數保持兩筆、各帶自己的終點',
    `rows=${rows.length} dest=[${rows.map(r => r.destIdx).join(',')}] arr=[${rows.map(r => r.arrEpoch).join(',')}]`);
  const chimera = rows.some(r => (r.timeline || []).some(seg => Number(seg.arrEpoch) !== Number(r.arrEpoch)));
  check(!chimera, 'ledger：起點列的 timeline 不會混進另一終點那班的時刻（無 chimera）');
  // 起點「列車進站」的頂埔車 ＋ 剛離站的亞東車第一段：終點不同＝兩台，時間軸條件（b.arr>=a.arr）成立也不准合。
  const crossDest = assemble(base, model, [originClaim({ dest: 4, arr: 1500 }), firstHopClaim({ dest: 3, arr: 1540, progress: 0.3 })]);
  check(crossDest.length === 2 && crossDest.some(r => r.terminal && Number(r.destIdx) === 4) && crossDest.some(r => !r.terminal && Number(r.destIdx) === 3),
    'ledger：起點進站列不會被另一終點的第一段列吞掉（終點不同＝兩台）', `rows=${crossDest.length}`);
}
// ---- 2. ledger：起點「列車進站」＋同終點第一段列＝同一台，即使 progress 超過舊門檻 0.25 ----
{
  const now = 2000;
  const rows = assemble(base, model, [originClaim({ dest: 4, arr: now }), firstHopClaim({ dest: 4, arr: now + 41, progress: 0.31 })]);
  const merged = rows.length === 1 && !rows[0].terminal && Number(rows[0].from) === 0 && Number(rows[0].to) === 1;
  const legs = merged ? rows[0].timeline.map(seg => `${seg.from}>${seg.to}@${seg.arrEpoch}`).join(' ') : '';
  check(merged && rows[0].timeline.some(seg => seg.terminal && Number(seg.arrEpoch) === now) &&
    rows[0].timeline.some(seg => !seg.terminal && Number(seg.to) === 1),
    'ledger：起點進站列＋同終點第一段列（progress 0.31）合成同一台、timeline 含起點與第一段', `rows=${rows.length} ${legs}`);
}
// ---- 3. ledger：起點還沒進站的下一班（未來倒數）不得被剛離站的前一班吞掉 ----
{
  const now = 3000;
  const rows = assemble(base, model, [originClaim({ dest: 4, arr: now + 300 }), firstHopClaim({ dest: 4, arr: now + 54, progress: 0.1 })]);
  check(rows.length === 2 && rows.some(r => r.terminal && Number(r.arrEpoch) === now + 300) && rows.some(r => !r.terminal),
    'ledger：起點未來倒數（下一班）與剛離站的前一班（progress 0.1）保持兩筆', `rows=${rows.length}`);
}
// ---- 4. reducer：起點車前進到第一段不受段秒門檻約束（官方第一段間隔短於模型段秒是常態）----
{
  const born = base.reduce({ model, rows: [row({ from: 0, to: 0, dest: 4, arr: 4000, terminal: true })], prior: null,
    day: DAY, nowEpoch: 3990, sourceRevision: 'origin-1' });
  const id = born.vehicles[0].vehicleId;
  // 官方第一段到站 4040：比模型段秒 60 早 20 秒；經過秒 15；4040−4000+15=55 < 60。
  const departed = base.reduce({ model, rows: [row({ from: 0, to: 1, dest: 4, arr: 4040 })], prior: born,
    day: DAY, nowEpoch: 4005, sourceRevision: 'origin-2' });
  const same = departed.vehicles.find(v => v.vehicleId === id);
  check(departed.vehicles.length === 1 && same && Number(same.to) === 1 && departed.diagnostics.births === 0,
    'reducer：起點車接自己的第一段（官方間隔 40 秒 < 段秒 60）沿用同一 ID、不另生車',
    `vehicles=${departed.vehicles.length} births=${departed.diagnostics.births} to=${same ? same.to : 'n/a'}`);
}
// ---- 5. reducer：兩台起點車（不同終點）中較早發車那台離站，兩邊 ID 都保住（保序 DP 不交叉）----
{
  const both = base.reduce({ model, rows: [row({ from: 0, to: 0, dest: 4, arr: 5100, terminal: true }),
    row({ from: 0, to: 0, dest: 3, arr: 5400, terminal: true })], prior: null, day: DAY, nowEpoch: 5000, sourceRevision: 'two-1' });
  const idA = both.vehicles.find(v => Number(v.dest) === 4).vehicleId, idB = both.vehicles.find(v => Number(v.dest) === 3).vehicleId;
  const departed = base.reduce({ model, rows: [row({ from: 0, to: 0, dest: 3, arr: 5400, terminal: true }),
    row({ from: 0, to: 1, dest: 4, arr: 5160 })], prior: both, day: DAY, nowEpoch: 5110, sourceRevision: 'two-2' });
  const a = departed.vehicles.find(v => v.vehicleId === idA), b = departed.vehicles.find(v => v.vehicleId === idB);
  check(departed.vehicles.length === 2 && departed.diagnostics.births === 0 && a && Number(a.to) === 1 && b && b.terminal,
    'reducer：起點兩台車（終點不同）中先發車那台離站，兩邊都沿用原 ID、零出生',
    `vehicles=${departed.vehicles.length} births=${departed.diagnostics.births}`);
}
// ---- 6. reducer：另一終點的起點列缺一輪時，這台起點車不得被拿去配別終點的倒數 ----
{
  const one = base.reduce({ model, rows: [row({ from: 0, to: 0, dest: 3, arr: 6400, terminal: true })], prior: null,
    day: DAY, nowEpoch: 6000, sourceRevision: 'dest-1' });
  const idB = one.vehicles[0].vehicleId;
  const other = base.reduce({ model, rows: [row({ from: 0, to: 0, dest: 4, arr: 6700, terminal: true })], prior: one,
    day: DAY, nowEpoch: 6015, sourceRevision: 'dest-2' });
  const b = other.vehicles.find(v => v.vehicleId === idB);
  check(other.vehicles.length === 2 && other.diagnostics.births === 1 && b && Number(b.dest) === 3 && b.carried,
    'reducer：終點不同的起點倒數是另一台車：新倒數出生、原車沿用（不換終點）',
    `vehicles=${other.vehicles.length} births=${other.diagnostics.births} priorDest=${b ? b.dest : 'n/a'}`);
}

// ---- 7. 真語料：40 輪健康重放的幽靈指標 ----
console.log('\n真語料重放（2026-08-15 07:53–08:10，40 輪）：');
const healthy = replayCorpus(base, ROUNDS_DIR);
check(healthy.rounds === EXPECTED.rounds, '語料輪數與釘死值一致', `${healthy.rounds}`);
check(healthy.sharedPairs === EXPECTED.sharedPairsTotal,
  '同 track 同向沒有兩台車共用同一站到站時刻（同一台實體車拆成兩個身分＝0）',
  `sharedPairs=${healthy.sharedPairs} ${healthy.sharedExamples.join(' ')}`);
check(healthy.stale === EXPECTED.staleTotal, '沒有車超過 300 秒沒被官方列觀測仍留在名冊', `stale=${healthy.stale}`);
check(healthy.stuck === EXPECTED.stuckOriginTotal, '非 XBT 的起點車只有官方列暫缺時才 carried（逐輪累計恰為釘死值）',
  `stuck=${healthy.stuck} ${healthy.stuckExamples.join(' ')}`);
// 2026-08-21 短程／區間車補入後，這份語料多了 3 次出生，全部來自新開的那條路徑
// （diagnostics.shortTurnBirths）。釘死值守的是「起點身分有沒有被拆」，所以扣掉新路徑
// 明確歸帳的那幾台再比——這樣新路徑若哪天多生一台，這條照樣會紅，而不是被我調高門檻蓋掉。
check(healthy.births - healthy.shortTurnBirths === EXPECTED.births,
  '扣掉短程起點例外後，累計出生等於釘死值（多出生＝有身分被拆）',
  `births=${healthy.births}－shortTurn=${healthy.shortTurnBirths}=${healthy.births - healthy.shortTurnBirths}`);
check(healthy.shortTurnBirths === EXPECTED.shortTurnBirths,
  '短程起點例外在這份語料放行的台數等於釘死值', `shortTurnBirths=${healthy.shortTurnBirths}`);

let peak = null;
if (fs.existsSync(PEAK_DIR)) {
  console.log('\n尖峰語料（tmp/binder-fixtures/rounds-peak，未追蹤、僅本機）：');
  peak = replayCorpus(base, PEAK_DIR, { day: '2026-08-13' });
  console.log(`   rounds=${peak.rounds} births=${peak.births} stuck=${peak.stuck} stale=${peak.stale} sharedPairs=${peak.sharedPairs} max=${peak.maxVehicles}`);
} else {
  console.log('\n（尖峰語料 tmp/binder-fixtures/rounds-peak 不在本機，略過那組數字）');
}

// ---- 8. 突變控制組：每條新規則單獨拆掉都要有具名契約轉紅 ----
console.log('\nMutation control：');
const MUTATIONS = [
  ['ledger 不看終點就合併起點列（舊碼）', {
    ledgerMutation: source => mustReplace(source, '        if (Number(a.destIdx) !== Number(b.destIdx)) continue;\n', '', 'ledger-dest'),
  }, pipeline => {
    // 兩筆起點倒數另有 !b.terminal 擋著（下一條突變會證明），這條要用「起點進站列＋另一終點的第一段列」才照得到。
    const rows = assemble(pipeline, model, [originClaim({ dest: 4, arr: 1500 }), firstHopClaim({ dest: 3, arr: 1540, progress: 0.3 })]);
    return { red: rows.length !== 2, detail: `rows=${rows.length}（頂埔進站列被亞東第一段吞掉）` };
  }],
  ['ledger 起點列與第一段列退回 progress<=0.25 判同車（舊碼）', {
    ledgerMutation: source => mustReplace(source,
      "          (a.terminal && !b.terminal && b.from === a.to && Number(b.arrEpoch) >= Number(a.arrEpoch));",
      '          (a.terminal && b.from === a.to && b.progress <= 0.25);', 'ledger-progress'),
  }, pipeline => {
    const split = assemble(pipeline, model, [originClaim({ dest: 4, arr: 2000 }), firstHopClaim({ dest: 4, arr: 2041, progress: 0.31 })]);
    const eaten = assemble(pipeline, model, [originClaim({ dest: 4, arr: 3300 }), firstHopClaim({ dest: 4, arr: 3054, progress: 0.1 })]);
    // 舊條款沒有 !b.terminal：同一起點兩筆同終點……不會有（每站每終點只報一班），但兩筆終點不同的倒數在
    // 舊碼（連 destIdx 守衛也沒有）就是靠這條被合成一筆；這裡拆的是條款本身，destIdx 守衛仍在，所以只驗前兩項。
    return { red: split.length !== 1 || eaten.length !== 2, detail: `同車被拆成 ${split.length} 筆、下一班被吞成 ${eaten.length} 筆` };
  }],
  ['reducer 起點前進一站也套段秒門檻（舊碼）', {
    rosterMutation: source => mustReplace(source, '  if (prior.terminal && advance === 1) return true;\n', '', 'roster-origin-reach'),
  }, pipeline => {
    const born = pipeline.reduce({ model, rows: [row({ from: 0, to: 0, dest: 4, arr: 4000, terminal: true })], prior: null,
      day: DAY, nowEpoch: 3990, sourceRevision: 'origin-1' });
    const departed = pipeline.reduce({ model, rows: [row({ from: 0, to: 1, dest: 4, arr: 4040 })], prior: born,
      day: DAY, nowEpoch: 4005, sourceRevision: 'origin-2' });
    // 舊碼的症狀不是多生車（營運中配不到的站間列會被忽略、不出生），而是起點車接不到第一段、釘在起點：
    // 官方第一段列被 ignoredObservations 吃掉、真車畫不出來。
    const stuck = departed.vehicles.find(v => v.vehicleId === born.vehicles[0].vehicleId);
    const corpus = replayCorpus(pipeline, ROUNDS_DIR);
    return { red: stuck && Number(stuck.to) !== 1 && corpus.stuck > EXPECTED.stuckOriginTotal,
      detail: `合成情境起點車 to=${stuck ? stuck.to : 'n/a'}（第一段被忽略 ${departed.diagnostics.ignoredObservations} 筆）、語料 stuck ${corpus.stuck}（釘死 ${EXPECTED.stuckOriginTotal}）` };
  }],
  ['reducer 同位置改回 arr 遞增排（先發車的排最前，離站就與留下的車交叉）', {
    rosterMutation: source => mustReplace(source, 'const laterFirst = (a, b) => Number(b.arrEpoch) - Number(a.arrEpoch);',
      'const laterFirst = (a, b) => Number(a.arrEpoch) - Number(b.arrEpoch);', 'roster-sort'),
  }, pipeline => {
    const both = pipeline.reduce({ model, rows: [row({ from: 0, to: 0, dest: 4, arr: 5100, terminal: true }),
      row({ from: 0, to: 0, dest: 3, arr: 5400, terminal: true })], prior: null, day: DAY, nowEpoch: 5000, sourceRevision: 'two-1' });
    const departed = pipeline.reduce({ model, rows: [row({ from: 0, to: 0, dest: 3, arr: 5400, terminal: true }),
      row({ from: 0, to: 1, dest: 4, arr: 5160 })], prior: both, day: DAY, nowEpoch: 5110, sourceRevision: 'two-2' });
    // 交叉的症狀：先發車那台的第一段列配不到（被忽略），它釘在起點；不是多生車。
    const idA = both.vehicles.find(v => Number(v.dest) === 4).vehicleId;
    const a = departed.vehicles.find(v => v.vehicleId === idA);
    return { red: !a || Number(a.to) !== 1,
      detail: `先發車那台 to=${a ? a.to : 'n/a'}（第一段被忽略 ${departed.diagnostics.ignoredObservations} 筆）` };
  }],
  ['reducer 起點列終點不同也可配（舊碼）', {
    rosterMutation: source => mustReplace(source,
      '  if (prior.terminal && current.terminal && Number(prior.dest) !== Number(current.dest)) return false;\n', '', 'roster-dest'),
  }, pipeline => {
    const one = pipeline.reduce({ model, rows: [row({ from: 0, to: 0, dest: 3, arr: 6400, terminal: true })], prior: null,
      day: DAY, nowEpoch: 6000, sourceRevision: 'dest-1' });
    const other = pipeline.reduce({ model, rows: [row({ from: 0, to: 0, dest: 4, arr: 6700, terminal: true })], prior: one,
      day: DAY, nowEpoch: 6015, sourceRevision: 'dest-2' });
    return { red: other.diagnostics.births === 0, detail: `births=${other.diagnostics.births}（被拿去配另一終點）` };
  }],
];
for (const [label, mutation, probe] of MUTATIONS) {
  let pipeline = null;
  try {
    pipeline = await loadPipeline(mutation);
    const { red, detail } = probe(pipeline);
    check(red, `突變「${label}」會被具名契約攔下`, detail);
  } catch (error) {
    check(false, `突變「${label}」可執行`, String((error && error.message) || error));
  } finally {
    if (pipeline) pipeline.cleanup();
  }
}
base.cleanup();

console.log(`\n起點身分：合成 7 條契約＋語料 40 輪（sharedPairs=${healthy.sharedPairs}、stale=${healthy.stale}、stuck=${healthy.stuck}、births=${healthy.births}）` +
  (peak ? `＋尖峰 ${peak.rounds} 輪（stuck=${peak.stuck}、stale=${peak.stale}）` : ''));
if (failures) { console.log(`\n❌ ${failures} 項未通過`); process.exit(1); }
console.log('\n✅ 起點身分驗收全數通過');
