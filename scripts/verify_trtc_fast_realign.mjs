#!/usr/bin/env node
// 「迅速重置」驗收（2026-08-17 使用者要求）：
//   「我們需要一個迅速重置的方式，就像我昨天要求的斷訊後回歸，
//     依照現在當下的北捷資訊來判斷現在路線上有哪些車」
//   判準：「兩站之間有兩台車就已經要懷疑了 我們一堆三台連在一起的」
//   約束：「你收掉車子 但是需要知道現在官方資料有的車子都要在」
//
// 語料是 2026-08-17 07:42 正式站真實名冊（boardPos）＋同輪官方站牌（board）。
// 那三輪的 boardPos 自己就有「一段軌道 5–6 台車」，是使用者截圖症狀的直接對應物。
//
// 判準與實作不同源：擁擠度由本檔自己數 vehicles 算出來，不讀 reducer 的計數器；
// 「官方有的車都要在」由官方 row 的 key 反查 vehicles，也不讀 diagnostics。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FX = path.join(ROOT, 'fixtures/trtc-fastrealign-20260817');
const LEDGER_PATH = path.join(HERE, 'trtc_board_ledger.mjs');
const ROSTER_PATH = path.join(HERE, 'trtc_official_roster.mjs');
const DAY = '2026-08-17';
const REALIGN_SEC = 180;
const LIMIT = 3;

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}

// 第一道 gate（心得 32）：先證明驗的是當前工作區的檔案，不是某棵釘死的舊樹。
const rosterHash = crypto.createHash('md5').update(fs.readFileSync(ROSTER_PATH)).digest('hex').slice(0, 12);
console.log(`驗收對象 ROOT=${ROOT}`);
console.log(`  roster=${path.relative(ROOT, ROSTER_PATH)} md5=${rosterHash} (${fs.statSync(ROSTER_PATH).size} bytes)`);
console.log(`  語料=${path.relative(ROOT, FX)}\n`);

const load = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const countdown = sec => sec === 0 ? '列車進站' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

let tempSeq = 0;
async function loadPipeline({ rosterMutation = null } = {}) {
  const temps = [];
  const ledger = await import(pathToFileURL(LEDGER_PATH).href);
  let roster;
  if (rosterMutation) {
    const file = path.join(HERE, `.tmp-fastrealign-${tempSeq++}.mjs`);
    const before = fs.readFileSync(ROSTER_PATH, 'utf8');
    const after = rosterMutation(before);
    if (after === before) throw new Error('突變沒有改到任何字元＝這個突變本身失效');
    fs.writeFileSync(file, after);
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
    const collapsed = ledger.collapseClaims(ledger.claimBoardRows(model, resolved.rows, nowEpoch, new Map()).claims);
    return { rows: ledger.attachOfficialTimelines(model, collapsed, resolved.rows, new Map()), nowEpoch };
  };
  return { model, rowsOf, roster, cleanup: () => temps.forEach(f => { try { fs.unlinkSync(f); } catch {} }) };
}

const rounds = fs.readdirSync(FX).filter(f => /^round_\d+\.json$/.test(f)).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8')))
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));

// boardPos＝當時正式站的名冊，天然就是 reducer 的 prior。feedSeen 由每台車的 observedEpoch 逐線取最大。
function priorOf(boardPos, { feedSeenOverride = {} } = {}) {
  const feedSeen = {};
  for (const v of boardPos.vehicles) {
    const observed = Number(v.observedEpoch);
    if (Number.isFinite(observed)) feedSeen[v.line] = Math.max(feedSeen[v.line] || 0, observed);
  }
  return { schema: 4, day: DAY, nowEpoch: Number(boardPos.at), sourceRevision: String(boardPos.sourceRevision),
    nextSequence: boardPos.vehicles.length + 1, feedSeen: { ...feedSeen, ...feedSeenOverride },
    vehicles: boardPos.vehicles.map(({ tripKey, ...rest }) => rest), aliases: [], diagnostics: {} };
}

// ---- 本檔自己算的判準（不讀 reducer 的計數器）----
function crowdOf(vehicles) {
  const counts = new Map();
  for (const v of vehicles) {
    const from = Number(v.from), to = Number(v.to);
    if (from === to) continue;                 // 端點排隊合法
    const k = `${v.line}|${Number(v.dir)}|${from}|${to}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let worst = 0; const over = [];
  for (const [k, c] of counts) { if (c > worst) worst = c; if (c >= LIMIT) over.push(`${k}×${c}`); }
  return { worst, over: over.sort() };
}
const rowKey = r => `${r.line}|${r.dir}|${r.from}|${r.to}|${r.arrEpoch}`;
const routePos = x => Number(x.dir) === 2 ? Number(x.to) : -Number(x.to);
function goneRows(rows, vehicles) {
  const drawn = new Set(vehicles.map(rowKey));
  return rows.filter(r => !drawn.has(rowKey(r)))
    .filter(r => !vehicles.some(v => v.line === r.line && Number(v.dir) === Number(r.dir) &&
      Math.abs(routePos(v) - routePos(r)) <= 1));
}
const perLine = items => items.reduce((m, x) => (m[x.line] = (m[x.line] || 0) + 1, m), {});

function reduceRound(pipeline, snap, { heal = true, force = null, prior = null, board = null } = {}) {
  const { rows, nowEpoch } = pipeline.rowsOf(board || snap.board);
  const args = { model: pipeline.model, rows, prior: prior || priorOf(snap.boardPos), day: DAY, nowEpoch,
    sourceRevision: String(snap.boardPos.sourceRevision), realignSec: REALIGN_SEC,
    ...(force ? { forceRealignLines: force } : {}) };
  const state = heal ? pipeline.roster.reduceOfficialRosterSelfHealing(args)
    : pipeline.roster.reduceOfficialRoster(args);
  return { state, rows, nowEpoch };
}

const pipeline = await loadPipeline();

// ---- 1. 語料代表性：這幾輪的正式站名冊真的有使用者說的那種畫面 ----
console.log('---- 1. 語料代表性（正式站當時的真實名冊）----');
for (const snap of rounds) {
  const c = crowdOf(snap.boardPos.vehicles);
  check(c.worst >= LIMIT, `${snap.at.slice(11, 19)} 正式站名冊有 ≥${LIMIT} 台同區間`,
    `最擠 ${c.worst} 台；${c.over.slice(0, 3).join(' ')}`);
}

// ---- 2. 不自癒＝症狀留著（對照組；沒有它就證明不了自癒有做事）----
console.log('\n---- 2. 對照組：關掉自癒，症狀仍在 ----');
const baseline = rounds.map(snap => ({ snap, ...reduceRound(pipeline, snap, { heal: false }) }));
for (const b of baseline) {
  const c = crowdOf(b.state.vehicles);
  check(c.worst >= LIMIT, `${b.snap.at.slice(11, 19)} 未自癒仍有 ≥${LIMIT} 台同區間`,
    `最擠 ${c.worst} 台；${c.over.slice(0, 3).join(' ')}`);
}

// ---- 3. 自癒＝使用者的判準歸零 ----
console.log('\n---- 3. 自癒後：行進中區間不得有 ≥3 台 ----');
const healed = rounds.map(snap => ({ snap, ...reduceRound(pipeline, snap, { heal: true }) }));
for (const h of healed) {
  const c = crowdOf(h.state.vehicles);
  check(c.over.length === 0, `${h.snap.at.slice(11, 19)} 自癒後零超標`,
    `最擠 ${c.worst} 台${c.over.length ? `；殘留 ${c.over.slice(0, 3).join(' ')}` : ''}`);
}

// ---- 4. 使用者的約束：官方有的車都要在（不得比對照組差）----
console.log('\n---- 4. 約束：官方報了、畫面整段沒車——不得變差 ----');
for (let i = 0; i < rounds.length; i++) {
  const b = goneRows(baseline[i].rows, baseline[i].state.vehicles).length;
  const h = goneRows(healed[i].rows, healed[i].state.vehicles).length;
  check(h <= b, `${rounds[i].at.slice(11, 19)} 「官方有車畫面沒車」未惡化`, `對照 ${b} → 自癒 ${h}`);
}

// ---- 5. 被重置的線：官方這輪報的每一列都要有車 ----
// 這是「重置」的定義本身——依當下官方資料重建 ⇒ 官方報幾列就該有幾台配得上。
console.log('\n---- 5. 被重置的線：官方每一列都有車 ----');
let healedLineChecks = 0;
for (let i = 0; i < rounds.length; i++) {
  const lines = healed[i].state.diagnostics.crowdHealedLines || [];
  const realigned = healed[i].state.diagnostics.realignedLines || [];
  // crowdHealedLines 會被 worker 拿去發「這條線剛被重置」的告警，所以它必須誠實：
  // 回報重置了哪幾條線，就必須真的重排了那幾條。內層 linesWithRows 閘會擋掉不合格的線，
  // 若外層沒同步過濾，這裡就會出現「宣稱重置了、其實沒動」的假帳。
  check(lines.every(line => realigned.includes(line)),
    `${rounds[i].at.slice(11, 19)} crowdHealedLines 回報的線都真的被重排`,
    `宣稱 ${JSON.stringify(lines)} / 實際 ${JSON.stringify(realigned)}`);
  for (const line of lines) {
    healedLineChecks++;
    const rows = healed[i].rows.filter(r => r.line === line);
    const drawn = new Set(healed[i].state.vehicles.map(rowKey));
    const miss = rows.filter(r => !drawn.has(rowKey(r)));
    check(miss.length === 0, `${rounds[i].at.slice(11, 19)} ${line} 官方 ${rows.length} 列全部有車`,
      miss.length ? `缺 ${miss.length} 列：${miss.slice(0, 3).map(rowKey).join(' ')}` : '');
  }
}
check(healedLineChecks > 0, '語料至少觸發過一次重置（否則上面幾條全是空跑）', `觸發 ${healedLineChecks} 條線次`);

// ---- 6. 🔴 安全不變量：對「這輪沒有官方列」的線強制重排，不得清空它 ----
// 這道閘擋的是永久廢棄的「缺訊就刪車」。沒有它，一次誤觸發就會讓整條線消失。
console.log('\n---- 6. 安全不變量：沒有官方列的線不得被重排清空 ----');
{
  const snap = rounds[0];
  const { rows } = pipeline.rowsOf(snap.board);
  const linesWithRows = new Set(rows.map(r => r.line));
  const prior = priorOf(snap.boardPos);
  const silent = [...new Set(prior.vehicles.map(v => v.line))].filter(l => !linesWithRows.has(l));
  // 語料裡若每條線都有列，就人工造一條：把某條線的官方列整批拿掉。
  const victim = silent[0] || [...linesWithRows][0];
  const board = silent.length ? snap.board
    : snap.board.filter((_, idx) => true);   // 佔位，下面用 rows 過濾版重跑
  const forced = new Set([victim]);
  let before, after;
  if (silent.length) {
    before = prior.vehicles.filter(v => v.line === victim).length;
    const r = reduceRound(pipeline, snap, { heal: false, force: forced });
    after = r.state.vehicles.filter(v => v.line === victim).length;
  } else {
    // 造一輪「victim 線完全沒有官方列」的 board
    const keep = new Set(rows.filter(r => r.line !== victim).map(r => `${r.line}`));
    const rowsFiltered = pipeline.rowsOf(board).rows.filter(r => r.line !== victim);
    const { nowEpoch } = pipeline.rowsOf(board);
    before = prior.vehicles.filter(v => v.line === victim).length;
    const state = pipeline.roster.reduceOfficialRoster({ model: pipeline.model, rows: rowsFiltered,
      prior, day: DAY, nowEpoch, sourceRevision: String(snap.boardPos.sourceRevision),
      realignSec: REALIGN_SEC, forceRealignLines: forced });
    after = state.vehicles.filter(v => v.line === victim).length;
    void keep;
  }
  check(before > 0, `控制組成立：${victim} 重排前有車`, `${before} 台`);
  check(after >= before * 0.5, `🔴 ${victim} 這輪沒有官方列，強制重排未清空它`, `${before} → ${after} 台`);
}

// ---- 7. 端點排隊不算擁擠（from==to 是起訖站等發車，本來就會排）----
console.log('\n---- 7. 端點排隊不得觸發重置 ----');
{
  const fake = Array.from({ length: 6 }, (_, i) => ({ line: 'BR', dir: 2, from: 0, to: 0, vehicleId: `x${i}` }));
  const c = pipeline.roster.segmentCrowding(fake, LIMIT);
  check(c.lines.size === 0 && c.worst === 0, '端點 6 台車不算超標', `lines=${[...c.lines].join(',') || '空'} worst=${c.worst}`);
  const mid = Array.from({ length: 3 }, (_, i) => ({ line: 'BR', dir: 2, from: 5, to: 6, vehicleId: `y${i}` }));
  const c2 = pipeline.roster.segmentCrowding(mid, LIMIT);
  check(c2.lines.has('BR') && c2.worst === 3, '行進中區間 3 台會被抓到', `worst=${c2.worst}`);
}

// ---- 8. 決定性：同輸入兩次結果相同（worker 的 CAS 重試會重跑同一輪）----
console.log('\n---- 8. 決定性 ----');
{
  const a = reduceRound(pipeline, rounds[0], { heal: true });
  const b = reduceRound(pipeline, rounds[0], { heal: true });
  const norm = s => JSON.stringify(s.vehicles.map(v => [v.vehicleId, v.line, v.from, v.to, v.arrEpoch]));
  check(norm(a.state) === norm(b.state), '同一輪重跑結果逐項相同');
}

// ---- 9. 冷啟動不受影響（沒有 prior 就沒有「重排」可言）----
console.log('\n---- 9. 冷啟動 ----');
{
  const { rows, nowEpoch } = pipeline.rowsOf(rounds[0].board);
  const cold = pipeline.roster.reduceOfficialRosterSelfHealing({ model: pipeline.model, rows, prior: null,
    day: DAY, nowEpoch, sourceRevision: 'cold', realignSec: REALIGN_SEC, forceRealignLines: new Set(['BR']) });
  check((cold.diagnostics.realignedLines || []).length === 0, '冷啟動不執行重排',
    `realignedLines=${JSON.stringify(cold.diagnostics.realignedLines)}`);
  check(cold.vehicles.length > 0, '冷啟動仍接回整批車', `${cold.vehicles.length} 台`);
}

// ---- 9b. 有倒數才畫（使用者 2026-08-17 裁示）----
// 「有出現倒數的車子,我們才畫在那一段軌道上,然後每十五秒會看一次他現在倒數的狀態」
console.log('\n---- 9b. 有倒數才畫 ----');
{
  for (const snap of rounds) {
    const { rows } = pipeline.rowsOf(snap.board);
    const args = { model: pipeline.model, rows, prior: priorOf(snap.boardPos), day: DAY,
      nowEpoch: pipeline.rowsOf(snap.board).nowEpoch, sourceRevision: String(snap.boardPos.sourceRevision),
      realignSec: REALIGN_SEC };
    const off = pipeline.roster.reduceOfficialRosterSelfHealing(args);
    const on = pipeline.roster.reduceOfficialRosterSelfHealing({ ...args, officialOnly: true });
    const t = snap.at.slice(11, 19);
    // (a) 這一輪倒數沒報到的車不得留在畫面上（線是活的才算——整條線沉默時照舊 hold）
    const live = new Set(rows.map(r => r.line));
    const ghosts = on.vehicles.filter(v => v.carried && live.has(v.line));
    check(ghosts.length === 0, `${t} 沒有「這輪倒數沒報、卻還畫著」的車`,
      ghosts.length ? `殘留 ${ghosts.length} 台：${ghosts.slice(0, 3).map(v => `${v.line} ${v.from}>${v.to}`).join(' ')}` : '');
    // (b) 官方報的每一列都要有車（收車不得靠刪真車達成）
    const drawn = new Set(on.vehicles.map(rowKey));
    const miss = rows.filter(r => !drawn.has(rowKey(r)));
    check(miss.length === 0, `${t} 官方 ${rows.length} 列全部有車`,
      miss.length ? `缺 ${miss.length} 列` : '');
    // (c) 連在一起的車要比舊行為少（這就是使用者看到的症狀）
    const co = crowdOf(off.vehicles), cn = crowdOf(on.vehicles);
    check(cn.worst <= co.worst, `${t} 同段疊車未惡化`, `舊 ${co.worst} 台 → 新 ${cn.worst} 台`);
  }
  // (d) 整條線沉默時仍然 hold——這是 08-14 裁示的底線,不得被本開關推翻
  const snap = rounds[0];
  const { rows, nowEpoch } = pipeline.rowsOf(snap.board);
  const prior = priorOf(snap.boardPos);
  const victim = [...new Set(prior.vehicles.map(v => v.line))].find(l => rows.some(r => r.line === l));
  const silent = rows.filter(r => r.line !== victim);
  const before = prior.vehicles.filter(v => v.line === victim).length;
  const st = pipeline.roster.reduceOfficialRosterSelfHealing({ model: pipeline.model, rows: silent, prior,
    day: DAY, nowEpoch, sourceRevision: 'x', realignSec: REALIGN_SEC, officialOnly: true });
  const after = st.vehicles.filter(v => v.line === victim).length;
  check(before > 0 && after === before, `🔴 ${victim} 整條線沒有倒數時仍然保留（不是缺訊就刪車）`,
    `${before} → ${after} 台`);
}

// ---- 10. 突變控制組：每條斷言都要有牙 ----
console.log('\n---- 10. 突變控制組 ----');
const MUTATIONS = [
  ['never-heal', '自癒從不觸發（等於沒做）',
    src => src.replace('const before = segmentCrowding(first.vehicles, Number(crowdLimit));',
      'const before = { lines: new Set(), worst: 0, suspicious: 0, over: [] };')],
  ['limit-off-by-one', '把 >=3 寫成 >3（三台連在一起放行）',
    src => src.replace('if (count >= limit) { lines.add(key.split(\'|\')[0]); over.push({ segment: key, count }); }',
      'if (count > limit) { lines.add(key.split(\'|\')[0]); over.push({ segment: key, count }); }')],
  ['count-terminals', '把端點排隊也算成擁擠',
    src => src.replace('if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;',
      'if (!Number.isFinite(from) || !Number.isFinite(to)) continue;')],
  ['force-any-line', '強制重排不檢查該線這輪有沒有官方列',
    src => src.replace('if (forced && !coldStart) for (const line of linesWithRows) if (forced.has(line)) realignLines.add(line);',
      'if (forced && !coldStart) for (const line of forced) realignLines.add(line);')],
  ['officialOnly-noop', '有倒數才畫的開關沒接上（沒倒數的車照樣留著）',
    src => src.replace('if (officialOnly && !coldStart) for (const line of linesWithRows) realignLines.add(line);',
      '')],
  ['officialOnly-kills-silent-line', '有倒數才畫誤及整條沉默的線（缺訊就刪車）',
    src => src.replace('if (officialOnly && !coldStart) for (const line of linesWithRows) realignLines.add(line);',
      'if (officialOnly && !coldStart) for (const v of priorVehicles) realignLines.add(v.line);')],
  ['dishonest-diagnostics', '自癒自己另算一份「重置了哪幾條線」而不採信 reducer 的回報',
    src => src.replace("healed.diagnostics.crowdHealedLines = (healed.diagnostics.forcedRealignLines || []).slice();",
      'healed.diagnostics.crowdHealedLines = [...before.lines].sort();')],
];

for (const [tag, label, mutate] of MUTATIONS) {
  const mutPipeline = await loadPipeline({ rosterMutation: mutate });
  const reasons = [];
  try {
    // 判準 A：自癒後不得有 ≥3 台
    for (const snap of rounds) {
      const { state } = reduceRound(mutPipeline, snap, { heal: true });
      const c = crowdOf(state.vehicles);
      if (c.over.length > 0) { reasons.push(`${snap.at.slice(11, 19)} 自癒後仍有 ${c.over.length} 段超標`); break; }
    }
    // 判準 B：端點不算擁擠
    const fake = Array.from({ length: 6 }, (_, i) => ({ line: 'BR', dir: 2, from: 0, to: 0, vehicleId: `x${i}` }));
    if (mutPipeline.roster.segmentCrowding(fake, LIMIT).lines.size > 0) reasons.push('端點排隊被誤判成擁擠');
    // 判準 C：沒有官方列的線不得被清空
    {
      const snap = rounds[0];
      const prior = priorOf(snap.boardPos);
      const { rows, nowEpoch } = mutPipeline.rowsOf(snap.board);
      const linesWithRows = new Set(rows.map(r => r.line));
      const victim = [...new Set(prior.vehicles.map(v => v.line))].find(l => !linesWithRows.has(l))
        || [...linesWithRows][0];
      const rowsFiltered = rows.filter(r => r.line !== victim);
      const before = prior.vehicles.filter(v => v.line === victim).length;
      const state = mutPipeline.roster.reduceOfficialRoster({ model: mutPipeline.model, rows: rowsFiltered,
        prior, day: DAY, nowEpoch, sourceRevision: String(snap.boardPos.sourceRevision),
        realignSec: REALIGN_SEC, forceRealignLines: new Set([victim]) });
      const after = state.vehicles.filter(v => v.line === victim).length;
      if (before > 0 && after < before * 0.5) reasons.push(`${victim} 沒有官方列卻被清空 ${before}→${after}`);
    }
    // 判準 E：有倒數才畫——沒報到的不留、沉默的線要留
    {
      const snap = rounds[0];
      const prior = priorOf(snap.boardPos);
      const { rows, nowEpoch } = mutPipeline.rowsOf(snap.board);
      const on = mutPipeline.roster.reduceOfficialRosterSelfHealing({ model: mutPipeline.model, rows,
        prior, day: DAY, nowEpoch, sourceRevision: 'm', realignSec: REALIGN_SEC, officialOnly: true });
      const live = new Set(rows.map(r => r.line));
      const ghosts = on.vehicles.filter(v => v.carried && live.has(v.line)).length;
      if (ghosts > 0) reasons.push(`有倒數才畫沒生效：仍有 ${ghosts} 台沒被倒數報到卻畫著`);
      const victim = [...new Set(prior.vehicles.map(v => v.line))].find(l => live.has(l));
      const silent = rows.filter(r => r.line !== victim);
      const before = prior.vehicles.filter(v => v.line === victim).length;
      const st2 = mutPipeline.roster.reduceOfficialRosterSelfHealing({ model: mutPipeline.model,
        rows: silent, prior, day: DAY, nowEpoch, sourceRevision: 'm', realignSec: REALIGN_SEC, officialOnly: true });
      const after = st2.vehicles.filter(v => v.line === victim).length;
      if (before > 0 && after < before) reasons.push(`整條沉默的 ${victim} 被刪了 ${before}→${after}`);
    }
    // 判準 D：自癒不得清空「這輪沒有官方列」的線
    {
      const snap = rounds[0];
      const prior = priorOf(snap.boardPos);
      const { rows, nowEpoch } = mutPipeline.rowsOf(snap.board);
      // 造出「某條擁擠的線這輪整批沒有官方列」：先找出基準擁擠的線
      const baseState = mutPipeline.roster.reduceOfficialRoster({ model: mutPipeline.model, rows, prior,
        day: DAY, nowEpoch, sourceRevision: 'm', realignSec: REALIGN_SEC });
      const crowdedLine = [...crowdOf(baseState.vehicles).over].map(s => s.split('|')[0])[0];
      if (crowdedLine) {
        const rowsFiltered = rows.filter(r => r.line !== crowdedLine);
        const before = prior.vehicles.filter(v => v.line === crowdedLine).length;
        const state = mutPipeline.roster.reduceOfficialRosterSelfHealing({ model: mutPipeline.model,
          rows: rowsFiltered, prior, day: DAY, nowEpoch, sourceRevision: 'm', realignSec: REALIGN_SEC });
        const after = state.vehicles.filter(v => v.line === crowdedLine).length;
        if (before > 0 && after < before * 0.5) reasons.push(`自癒把沒有官方列的 ${crowdedLine} 清空 ${before}→${after}`);
        const claimed = state.diagnostics.crowdHealedLines || [];
        const actual = state.diagnostics.realignedLines || [];
        const lying = claimed.filter(line => !actual.includes(line));
        if (lying.length) reasons.push(`診斷謊報重置了 ${lying.join(',')}（實際沒重排）`);
      }
    }
  } catch (error) {
    reasons.push(`突變版拋例外：${error.message}`);
  }
  mutPipeline.cleanup();
  check(reasons.length > 0, `突變「${label}」會被具名斷言攔下`,
    reasons.join('；') || '⚠ 沒有任何斷言變紅＝這條判準沒有牙');
}

pipeline.cleanup();
console.log(`\n${failures === 0 ? '✅ 迅速重置驗收全數通過' : `❌ 共 ${failures} 項未通過`}`);
process.exit(failures === 0 ? 0 : 1);
