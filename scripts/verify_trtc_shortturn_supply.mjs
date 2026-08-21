#!/usr/bin/env node
// 短程／區間車補入 boardPos.vehicles 的驗收（純 replay，不打網路、不起 listener）。
//
// 故障：`boardPos.vehicles` 結構性缺短程車。`terminal` 只在「前一站掉出線外」時成立
// （trtc_board_ledger.mjs 的 claimOne），也就是**只有整條線的兩個實體端點**算起點；
// 而 reduceOfficialRoster 的生車閘門只放行 terminal 列。北投→大安這種從線中間發車的
// 短程車於是全天一台都生不出來（2026-08-21 21:49–23:19 正式站語料 536 輪：官方每輪報
// 10.6 筆 dest=大安 的看板列、管線做出 2.6 筆 claim，boardPos.vehicles 裡 R→大安 0 台）。
//
// 語料 fixtures/trtc-shortturn-20260821/rounds.jsonl.gz 是那 536 輪 /api/trtc-live 的
// **壓縮投影**（原始 203MB 在桌面稽核目錄；這裡只留驗收要用的欄位，536 輪 546KB）。
// 每列＝一輪：{ id, at, rev, day, unclaimed, b: 看板列, pv: 當時正式站名冊, tn: CarWeight 列 }。
// 原始目錄有 4 個 429 錯誤頁（HTML），建語料時已用 try/catch 濾掉，輪數 540→536。
//
// 判準基準（獨立來源）：`tn` 是同一份 payload 的 CarWeight `trains[]`，與看板列是兩條
// 不同的上游管線 ⇒ 拿它當「該有幾台短程車」的外部參照，不與受測實作同源（心得 29）。
//
// 用法：node scripts/verify_trtc_shortturn_supply.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER_PATH = path.join(ROOT, 'scripts/trtc_official_roster.mjs');
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// ── G0：驗的是這棵樹的模組（心得 32：驗收腳本吃到別棵樹的檔案會全綠卻什麼都沒驗）──
const rosterSource = fs.readFileSync(ROSTER_PATH, 'utf8');
console.log(`G0 target=${ROOT}\n   roster md5=${createHash('md5').update(rosterSource).digest('hex')}`);

// ── 基準版＝把補入邏輯拿掉的同一支模組（突變對照）───────────────────────────
const MUT_ANCHOR = `    const shortTurnOrigin = !coldStart && !current[index].terminal && !recoverable &&
      !!current[index].displayNo && !numberHeld(current[index]) && atServiceOrigin(current[index]) &&
      atMidLineTurnBack(current[index]);`;
if (!rosterSource.includes(MUT_ANCHOR)) throw new Error('補入邏輯的錨點不在——先確認那兩行還在');
const MUT_SOURCE = rosterSource.replace(MUT_ANCHOR,
  `    const shortTurnOrigin = false; // MUTATION shortturn`);
const MUT_PATH = path.join(ROOT, 'fixtures/trtc-shortturn-20260821/.roster_baseline.mjs');
fs.writeFileSync(MUT_PATH, MUT_SOURCE);

const L = await import(pathToFileURL(path.join(ROOT, 'scripts/trtc_board_ledger.mjs')).href);
const CUR = await import(pathToFileURL(ROSTER_PATH).href);
const BASE = await import(pathToFileURL(MUT_PATH).href);
fs.unlinkSync(MUT_PATH);

const j = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const trtc = j('data/trtc.json');
const model = L.buildTrtcModel(trtc, j('data/trtc_times.json'), j('data/trtc_codes.json'), { includeY: true });
const nameOf = {}; for (const ln of trtc.lines) nameOf[ln.id] = ln.stations.map(s => s.name);
const idxOf = {}; for (const ln of trtc.lines) idxOf[ln.id] = new Map(ln.stations.map((s, i) => [s.name, i]));
const label = v => `${v.line}→${(nameOf[v.line] || [])[v.dest] ?? '#' + v.dest}`;

// 看板列 → TrackInfo 原始列。worker.js:863-875 是 1:1 投影（丟掉的只有 CountDown／NowDateTime
// 解不出來的列），所以反推回去餵 resolveBoardRows 與產品吃到的是同一組列。
const toRaw = ([name, dest, sec, at, no]) => ({ StationName: name, DestinationName: dest, TrainNumber: no,
  NowDateTime: Number(at), CountDown: Number(sec) === 0 ? '列車進站'
    : `${Math.floor(Number(sec) / 60)}:${String(Number(sec) % 60).padStart(2, '0')}` });

function pipelineRows(board, nowEpoch) {
  const resolved = L.resolveBoardRows(model, board.map(toRaw), v => Number(v), new Map());
  const claimed = L.claimBoardRows(model, resolved.rows, nowEpoch, new Map());
  return { rows: L.attachOfficialTimelines(model, L.collapseClaims(claimed.claims), resolved.rows, new Map()),
    unclaimed: claimed.unclaimed.length };
}

function replay(R, rounds) {
  let prior = null;
  const out = { rounds: 0, thrown: 0, dest: new Map(), unclaimed: [], crowd: [], shortTurnBirths: 0,
    dupBirthSig: 0, idRuns: new Map(), noToIds: new Map(), byDirDest: new Map(), sameRoundNoClash: 0,
    byLine: {}, series: [] };
  for (const round of rounds) {
    const { rows, unclaimed } = pipelineRows(round.b, round.at);
    let roster;
    try {
      roster = R.reduceOfficialRosterSelfHealing({ model, rows, prior, day: round.day, nowEpoch: round.at,
        sourceRevision: round.rev, realignSec: 180, crowdLimit: 0, officialOnly: false });
    } catch (e) { out.thrown++; continue; }
    prior = roster; out.rounds++;
    out.unclaimed.push(unclaimed);
    out.crowd.push(R.segmentCrowding(roster.vehicles, 3).worst);
    out.shortTurnBirths += Number(roster.diagnostics.shortTurnBirths) || 0;
    out.dupBirthSig += Number(roster.diagnostics.duplicateBirthSignatures) || 0;
    for (const [line, n] of Object.entries(roster.diagnostics.shortTurnBirthsByLine || {})) {
      out.byLine[line] = (out.byLine[line] || 0) + Number(n);
    }
    let roundDaan = 0, roundBeitou = 0;
    const seenThisRound = new Set();
    for (const v of roster.vehicles) {
      out.dest.set(label(v), (out.dest.get(label(v)) || 0) + 1);
      if (v.line === 'R') { if (Number(v.dest) === DAAN) roundDaan++; else if (Number(v.dest) === BEITOU) roundBeitou++; }
      if (!out.idRuns.has(v.vehicleId)) out.idRuns.set(v.vehicleId, { first: out.rounds, label: label(v) });
      if (v.officialNo) {
        const key = `${v.line}|${v.dir}|${v.officialNo}`;
        if (!out.noToIds.has(key)) out.noToIds.set(key, new Set());
        out.noToIds.get(key).add(v.vehicleId);
        if (seenThisRound.has(key)) out.sameRoundNoClash++;
        seenThisRound.add(key);
      }
      const dk = `${v.line}|${v.dir}|${v.dest}`;
      out.byDirDest.set(dk, (out.byDirDest.get(dk) || 0) + 1);
    }
    out.series.push(`${roundDaan},${roundBeitou}`);
  }
  out.lastRoster = prior;
  return out;
}

// ── 語料載入 ───────────────────────────────────────────────────────────────
const CORPUS = path.join(ROOT, 'fixtures/trtc-shortturn-20260821/rounds.jsonl.gz');
const rounds = zlib.gunzipSync(fs.readFileSync(CORPUS)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));

const R_ID = 'R', DAAN = idxOf.R.get('大安'), BEITOU = idxOf.R.get('北投');
const ENDPOINTS = new Set([0, (nameOf.R.length - 1)]);

// A1 分母正向對照
let boardShortTurn = 0, cwShortTurn = 0;
for (const r of rounds) {
  boardShortTurn += r.b.filter(x => x[1] === '大安站').length;
  cwShortTurn += r.tn.filter(t => String(t[0] || '').startsWith('R') && t[1] === '大安站').length;
}
ok('A1 分母正向對照：官方看板列裡真的有「往大安」的短程列（否則下面全是空判準）',
  boardShortTurn > 0 && cwShortTurn > 0,
  `看板列 ${boardShortTurn} 筆（${(boardShortTurn / rounds.length).toFixed(1)}/輪）、CarWeight ${(cwShortTurn / rounds.length).toFixed(2)} 台/輪`);
ok('A2 語料完整性：536 輪、桌面原始目錄的 4 個 429 錯誤頁已濾除',
  rounds.length === 536, `${rounds.length} 輪`);

// A3 正式站當時的實況（第三方證據：pv 是那一輪真的送給使用者的名冊）
let prodDaan = 0, prodBeitou = 0;
for (const r of rounds) for (const [line, , dest] of r.pv) {
  if (line !== R_ID) continue;
  if (dest === DAAN) prodDaan++; else if (dest === BEITOU) prodBeitou++;
}
ok('A3 重現故障：那 536 輪的正式站名冊裡「往大安」恆為 0 台（結構性缺席，不是時段性）',
  prodDaan === 0 && prodBeitou > 0,
  `正式站 R→大安 ${prodDaan} 台次、R→北投 ${prodBeitou} 台次（${(prodBeitou / rounds.length).toFixed(2)}/輪）`);

const base = replay(BASE, rounds), cur = replay(CUR, rounds);
ok('A4 兩版都跑完全部輪次、零例外（reducer 自帶的守恆／重複 ID 檢查都沒被觸發）',
  base.rounds === rounds.length && cur.rounds === rounds.length && base.thrown === 0 && cur.thrown === 0,
  `基準 ${base.rounds}/${base.thrown}、補入 ${cur.rounds}/${cur.thrown}`);

const per = (m, k) => (m.get(k) || 0) / rounds.length;
const cwDaan = cwShortTurn / rounds.length;
let cwBeitou = 0;
for (const r of rounds) cwBeitou += r.tn.filter(t => String(t[0] || '').startsWith('R') && t[1] === '北投站').length;
cwBeitou /= rounds.length;
const curDaan = per(cur.dest, 'R→大安'), curBeitou = per(cur.dest, 'R→北投');

// 判準用「冷啟之後才出生的台數」而不是「名冊裡的站數」：這支 replay 是從**營運中途**
// 起手的，第 1 輪 prior=null ⇒ coldStart ⇒ 生車閘門整個被繞過（trtc_official_roster.mjs
// 的 `!coldStart &&`），於是兩版的第 1 輪都會生出一批大安短程並一路 carry 下去——那是
// replay 的假象，不是基準版有生車能力。正式站是 04:00 空名冊冷啟、當時線上沒有短程車，
// 所以它整晚 0 台（A3 已用第三方證據 pv 獨立證明）。把窗口切在第 2 輪之後，兩版的差別
// 就只剩「閘門放不放行」這一個變因。
const lateBirths = (o, lbl) => [...o.idRuns.values()].filter(r => r.first > 1 && r.label === lbl).length;
const [bD, bB, cD, cB] = [lateBirths(base, 'R→大安'), lateBirths(base, 'R→北投'),
  lateBirths(cur, 'R→大安'), lateBirths(cur, 'R→北投')];
ok('A5 突變對照有牙：冷啟輪之後，基準版一台短程車都生不出來，補入版兩個折返點都生得出來',
  bD === 0 && bB === 0 && cD > 0 && cB > 0,
  `冷啟後新生 往大安 ${bD}→${cD} 台、往北投 ${bB}→${cB} 台；` +
  `名冊站數 大安 ${per(base.dest, 'R→大安').toFixed(2)}→${curDaan.toFixed(2)} 台/輪（基準的非零＝冷啟假象，見上方註解與 A3）`);
ok('A6 台數對得上獨立來源 CarWeight（不與看板管線同源；容忍 ±35%）',
  Math.abs(curDaan - cwDaan) / cwDaan <= 0.35 && Math.abs(curBeitou - cwBeitou) / cwBeitou <= 0.35,
  `大安 ${curDaan.toFixed(2)} vs CarWeight ${cwDaan.toFixed(2)}；北投 ${curBeitou.toFixed(2)} vs ${cwBeitou.toFixed(2)}`);

// A7 兩方向：大安短程是 dir=1、北投短程是 dir=2；兩邊都要有車
const dirDaan1 = cur.byDirDest.get(`R|1|${DAAN}`) || 0, dirBeitou2 = cur.byDirDest.get(`R|2|${BEITOU}`) || 0;
ok('A7 兩方向都補得到：往大安（dir=1）與往北投（dir=2）各自都有車',
  dirDaan1 > 0 && dirBeitou2 > 0, `R|1|大安=${dirDaan1} 台次、R|2|北投=${dirBeitou2} 台次`);

// A8 折返點：短程車的終點必須是非端點站（那正是「短程」的定義）
const shortTurnDests = [...cur.byDirDest.keys()].filter(k => k.startsWith('R|'))
  .map(k => Number(k.split('|')[2])).filter(d => !ENDPOINTS.has(d));
ok('A8 折返點正確：補進來的 R 短程車終點是非端點站（大安 idx3／北投 idx20）',
  shortTurnDests.length > 0 && shortTurnDests.every(d => d === DAAN || d === BEITOU),
  `非端點終點=${[...new Set(shortTurnDests)].map(d => `${nameOf.R[d]}(${d})`).join('、')}`);

// A9 零附帶影響：其餘每一個「線×終點」組合逐格與基準完全相同
const keys = [...new Set([...base.dest.keys(), ...cur.dest.keys()])].sort();
const drift = keys.filter(k => k !== 'R→大安' && k !== 'R→北投' && (base.dest.get(k) || 0) !== (cur.dest.get(k) || 0));
ok('A9 零附帶影響：R→大安／R→北投 以外的每一個線×終點組合逐格與基準完全相同',
  drift.length === 0,
  drift.length ? drift.map(k => `${k} ${base.dest.get(k) || 0}→${cur.dest.get(k) || 0}`).join('、')
    : `${keys.length - 2} 個組合全部逐格相同`);

// A10 dropped.unclaimed 不得暴增（本批完全沒動 claim 階段，所以應該逐輪一模一樣）
const unclaimedSame = base.unclaimed.length === cur.unclaimed.length &&
  base.unclaimed.every((v, i) => v === cur.unclaimed[i]);
const prodUnclaimed = rounds.reduce((s, r) => s + r.unclaimed, 0) / rounds.length;
ok('A10 dropped.unclaimed 逐輪與基準完全相同（生車閘門在 claim 之後，本批沒動 claim 階段）',
  unclaimedSame, `replay ${(cur.unclaimed.reduce((a, b) => a + b, 0) / rounds.length).toFixed(1)}/輪、正式站當時 ${prodUnclaimed.toFixed(1)}/輪`);

// A11 疊車不得變差
const worseCrowd = cur.crowd.filter((v, i) => v > base.crowd[i]).length;
ok('A11 疊車不得變差：逐輪「同一行進區間最多幾台」不高於基準',
  worseCrowd === 0, `最差 基準 ${Math.max(...base.crowd)} / 補入 ${Math.max(...cur.crowd)}、變差輪次 ${worseCrowd}`);

// A12 出生證據不得被重放；身分不得因補入而更 churn。
// 注意判準的邊界：「同一車號跨輪對到不同 ID」本身是**合法**的——reduceOfficialRoster
// 自己的契約寫明「官方 no 只在同線、同方向、同一趟生命週期內是硬 alias。到終點收車後，
// 反方向倒數必須建新 ID」，所以一個車號一晚被不同趟重用很正常（基準版自己就有 31 個）。
// 真正的不變量是兩條：(1) 同一輪內不得有兩台車頂同一個（線,向,車號）；(2) 補入不得比
// 基準更 churn——多出來的「一號多 ID」不得超過新增的短程車台數。
const multiNo = o => [...o.noToIds.values()].filter(ids => ids.size > 1).length;
ok('A12 身分穩定：同一輪不得同號兩台；跨輪「一號多 ID」的增量不超過新增短程車台數',
  cur.dupBirthSig === 0 && base.sameRoundNoClash === 0 && cur.sameRoundNoClash === 0 &&
  multiNo(cur) - multiNo(base) <= cur.shortTurnBirths,
  `duplicateBirthSignatures=${cur.dupBirthSig}、同輪同號 基準 ${base.sameRoundNoClash}／補入 ${cur.sameRoundNoClash}、` +
  `一號多 ID 基準 ${multiNo(base)}→補入 ${multiNo(cur)}（增 ${multiNo(cur) - multiNo(base)} ≤ 新增 ${cur.shortTurnBirths} 台）`);

// A13 生車不失控：新路徑放行的台數要是「短程車班次」的量級，不是每輪都在生
ok('A13 生車不失控：短程起點例外全程只放行少量出生（不是每輪重生）',
  cur.shortTurnBirths > 0 && cur.shortTurnBirths <= rounds.length / 10,
  `shortTurnBirths=${cur.shortTurnBirths} 台／${rounds.length} 輪，總出生 基準 ${base.idRuns.size} → 補入 ${cur.idRuns.size}`);

// A14 既有 ID 不得因補入而變動：同一份 warm prior，兩版各跑一輪
{
  const warmIndex = Math.floor(rounds.length / 2);
  let prior = null;
  for (let i = 0; i <= warmIndex; i++) {
    const { rows } = pipelineRows(rounds[i].b, rounds[i].at);
    prior = BASE.reduceOfficialRosterSelfHealing({ model, rows, prior, day: rounds[i].day,
      nowEpoch: rounds[i].at, sourceRevision: rounds[i].rev, realignSec: 180, crowdLimit: 0, officialOnly: false });
  }
  const next = rounds[warmIndex + 1];
  const { rows } = pipelineRows(next.b, next.at);
  const args = { model, rows, prior, day: next.day, nowEpoch: next.at, sourceRevision: next.rev,
    realignSec: 180, crowdLimit: 0, officialOnly: false };
  const a = BASE.reduceOfficialRosterSelfHealing(args), b = CUR.reduceOfficialRosterSelfHealing(args);
  const aById = new Map(a.vehicles.map(v => [v.vehicleId, v]));
  const bById = new Map(b.vehicles.map(v => [v.vehicleId, v]));
  const missing = [...aById.keys()].filter(id => !bById.has(id));
  const changed = [...aById.entries()].filter(([id, v]) => bById.has(id) &&
    JSON.stringify([v.line, v.dir, v.dest, v.from, v.to, v.arrEpoch, v.officialNo]) !==
    JSON.stringify([bById.get(id).line, bById.get(id).dir, bById.get(id).dest, bById.get(id).from,
      bById.get(id).to, bById.get(id).arrEpoch, bById.get(id).officialNo]));
  const added = [...bById.keys()].filter(id => !aById.has(id));
  ok('A14 既有車 ID 不因補入而變動：同一份 warm prior 下，補入版只多不少、交集逐台完全相同',
    missing.length === 0 && changed.length === 0,
    `基準 ${aById.size} 台、補入 ${bById.size} 台（新增 ${added.length}、消失 ${missing.length}、內容變動 ${changed.length}）`);
}

// ── 三個放行條件各自要有判準守著（2026-08-22 獨立驗收補洞）──────────────────
// 獨立驗收量到：弱化 (1)a `numberHeld`／(1)b `!!displayNo`／(3) `atMidLineTurnBack`
// 任一條，上面 16 項照樣全綠。機制是 A9 把 R→大安／R→北投 兩格整個豁免掉，而這三條的
// 作用範圍恰好只在那兩格內；A5（>0 即可）、A6（±35%）、A13（只看總量）都太鬆接不住。
// 下面三條各自對準一個沒被守住的面向。
const GOLDEN = {
  byLine: { R: 12 },        // 短程起點例外只該在 R 線放行（BR／Y 沒車號，其他線沒有線中間折返）
  daan: 1360, beitou: 2087, // 逐輪台次總和
  seriesMd5: '2f6579392aa0dc63ce45e7ced70697b9', // 536 輪「大安,北投」逐輪序列的 md5
};

const byLineKeys = Object.keys(cur.byLine).sort();
ok('A15 短程起點例外只在 R 線放行：shortTurnBirthsByLine 的鍵集合與台數都釘死',
  byLineKeys.join(',') === Object.keys(GOLDEN.byLine).sort().join(',') &&
  byLineKeys.every(k => cur.byLine[k] === GOLDEN.byLine[k]),
  `實測 ${JSON.stringify(cur.byLine)}、釘死 ${JSON.stringify(GOLDEN.byLine)}`);

// 語料是釘死的 536 輪、reducer 對它是純函式（同一份輸入跑兩次逐輪 md5 相同，已實測），
// 所以逐輪值可以當 golden 釘住——這是唯一接得住「只在 R→大安／R→北投 兩格內多生幾台」
// 那種變化的判準（A9 豁免那兩格、A6 的 ±35% 吸收得掉，門檻式判準結構上照不到）。
// 數字變了不代表一定是壞的，但**必須有人來重新解釋**（心得 35）。
{
  const md5 = createHash('md5').update(cur.series.join('|')).digest('hex');
  const [daan, beitou] = cur.series.reduce((acc, x) => {
    const [d, b] = x.split(',').map(Number); return [acc[0] + d, acc[1] + b];
  }, [0, 0]);
  const firstDiff = md5 === GOLDEN.seriesMd5 ? -1
    : cur.series.findIndex((v, i) => v !== (GOLDEN.series ? GOLDEN.series[i] : v));
  ok('A16 R→大安／R→北投 逐輪台數對釘死語料完全相同（golden：唯一接得住兩格內變化的判準）',
    md5 === GOLDEN.seriesMd5 && daan === GOLDEN.daan && beitou === GOLDEN.beitou,
    `md5 ${md5}${md5 === GOLDEN.seriesMd5 ? '（相符）' : ` ≠ 釘死 ${GOLDEN.seriesMd5}`}、` +
    `總台次 大安 ${daan}/${GOLDEN.daan}、北投 ${beitou}/${GOLDEN.beitou}` +
    (firstDiff >= 0 ? `、首個不同的輪次 #${firstDiff + 1}` : ''));
}

// A17 專門守 (1)a `numberHeld`。這一條在這 536 輪上是 inert 的（獨立驗收量到弱化它之後
// 逐輪指紋 md5 一字不差）⇒ 任何**跨語料統計式**判準結構上都接不住它，只能造一個真的會
// 踩到它的情境：把同線同向最遠處的一台車掛上「即將出生那台」的官方車號，讓它變成
// 「這個號已經有人拿著」。挑最遠的那台是為了讓 hardNoMatches 的 matchFeasible 過不了
// ——否則那一列會被配走，兩種結果都是「沒出生」，判準就分不出來了；
// 所以除了台數，還要驗那一列真的走進 ignoredObservations（＝被閘門擋下，不是被配走）。
{
  let prior = null, hit = -1, before = null;
  for (let i = 0; i < rounds.length; i++) {
    const { rows } = pipelineRows(rounds[i].b, rounds[i].at);
    const next = CUR.reduceOfficialRosterSelfHealing({ model, rows, prior, day: rounds[i].day,
      nowEpoch: rounds[i].at, sourceRevision: rounds[i].rev, realignSec: 180, crowdLimit: 0, officialOnly: false });
    if (i > 0 && Number(next.diagnostics.shortTurnBirths) === 1) { hit = i; before = prior; break; }
    prior = next;
  }
  const round = rounds[hit];
  const { rows } = pipelineRows(round.b, round.at);
  const args = { model, rows, prior: before, day: round.day, nowEpoch: round.at,
    sourceRevision: round.rev, realignSec: 180, crowdLimit: 0, officialOnly: false };
  const control = CUR.reduceOfficialRosterSelfHealing(args);
  const had = new Set(before.vehicles.map(v => String(v.vehicleId)));
  const born = control.vehicles.find(v => !had.has(String(v.vehicleId)));
  const clone = JSON.parse(JSON.stringify(before));
  const far = clone.vehicles.filter(v => v.line === born.line && Number(v.dir) === Number(born.dir))
    .sort((a, b) => Math.abs(Number(b.to) - Number(born.to)) - Math.abs(Number(a.to) - Number(born.to)))[0];
  if (far) far.officialNo = String(born.officialNo);
  const held = CUR.reduceOfficialRosterSelfHealing({ ...args, prior: clone });
  ok('A17 車號已被同線同向的車持有 ⇒ 不得再生一台（正向對照：不動車號時同一輪真的會生 1 台）',
    !!born && !!born.officialNo && !!far && Number(control.diagnostics.shortTurnBirths) === 1 &&
    Number(held.diagnostics.shortTurnBirths) === 0 &&
    Number(held.diagnostics.ignoredObservations) === Number(control.diagnostics.ignoredObservations) + 1,
    `第 ${hit + 1} 輪 ${born && born.line}/${born && born.dir} 車號 ${born && born.officialNo}：` +
    `正向對照生 ${control.diagnostics.shortTurnBirths} 台 → 掛號後生 ${held.diagnostics.shortTurnBirths} 台、` +
    `ignoredObservations ${control.diagnostics.ignoredObservations}→${held.diagnostics.ignoredObservations}`);
}

// ── B 殭屍尖峰語料重放（repo 內既有兩份 fixture）─────────────────────────────
for (const [tag, dir] of [['殭屍尖峰 23:42', 'fixtures/trtc-fastrealign-20260817'],
  ['斷訊恢復 08-15', 'fixtures/trtc-outage-20260815/rounds']]) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) { ok(`B ${tag} 語料存在`, false, `找不到 ${dir}`); continue; }
  const items = [];
  for (const f of fs.readdirSync(full).filter(x => x.endsWith('.json')).sort()) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')); } catch (e) { continue; }
    if (!Array.isArray(d.board) || !d.boardPos || !Array.isArray(d.boardPos.vehicles)) continue;
    items.push({ b: d.board.map(x => [x.name, x.dest, x.eta - x.at, x.at, x.no]), at: Number(d.boardPos.at),
      rev: Number(d.boardPos.sourceRevision),
      day: String((d.boardPos.vehicles[0] || {}).vehicleId || '').split(':')[1] || '2026-08-15',
      unclaimed: 0, pv: [], tn: [] });
  }
  const a = replay(BASE, items), b = replay(CUR, items);
  const ks = [...new Set([...a.dest.keys(), ...b.dest.keys()])].sort();
  const dr = ks.filter(k => k !== 'R→大安' && k !== 'R→北投' && (a.dest.get(k) || 0) !== (b.dest.get(k) || 0));
  const crowdWorse = b.crowd.filter((v, i) => v > a.crowd[i]).length;
  ok(`B ${tag}（${items.length} 輪）：零例外、其餘線×終點逐格不變、疊車不變差`,
    items.length > 0 && a.thrown === 0 && b.thrown === 0 && dr.length === 0 && crowdWorse === 0,
    `例外 ${a.thrown}/${b.thrown}、漂移 ${dr.length}、疊車最差 ${Math.max(...a.crowd)}→${Math.max(...b.crowd)}、` +
    `短程出生 ${b.shortTurnBirths} 台、R→北投 ${(a.dest.get('R→北投') || 0)}→${(b.dest.get('R→北投') || 0)} 台次`);
}

const failed = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - failed.length}/${results.length} 通過`);
if (failed.length) { console.error('失敗項：' + failed.map(r => r.name).join('、')); process.exit(1); }
