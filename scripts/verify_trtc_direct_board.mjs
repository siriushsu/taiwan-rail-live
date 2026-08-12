#!/usr/bin/env node
// 北捷官方到站倒數直出驗收：全程離線，不連正式站、不打北捷上游。
// 驗證重點不是「動畫點位有沒有對上」，而是官方逐列 ETA 在顯示層不再受動畫校正／配對成敗控制。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const BASE_COMMIT = process.env.TRTC_DIRECT_BASE || '9643da3';
const BASE_INDEX = execFileSync('git', ['show', `${BASE_COMMIT}:index.html`], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
const OUTPUT = path.resolve(process.env.TRTC_DIRECT_OUTPUT || path.join(ROOT, 'tmp/verify_trtc_direct_board-output.json'));
const result = { assertions: [], mutations: [], browser: [], metrics: {}, baseCommit: BASE_COMMIT };
let failures = 0;

function check(condition, label, detail = '') {
  const pass = !!condition;
  result.assertions.push({ pass, label, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  if (!pass) failures++;
  return pass;
}
function mutation(label, productionPass, mutantPass, detail = '') {
  const caught = !!productionPass && !mutantPass;
  result.mutations.push({ caught, label, detail });
  console.log(`${caught ? '🧬' : '❌'} mutation ${label}${detail ? `：${detail}` : ''}`);
  if (!caught) failures++;
}
const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

// 只計算函式最外層大括號；字串、template、註解裡的括號不參與。
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 function ${name}`);
  let open = source.indexOf('{', start), depth = 0, mode = 'code', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} 大括號未閉合`);
}
function extractConst(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
  if (!m) throw new Error(`找不到 const ${name}`);
  return m[0];
}

// ── 1. 原始碼結構與不可變動畫名冊 ────────────────────────────────────────
const frozenFunctions = [
  'freqTrainTime', 'freqTrainBaseAt', 'freqTrainPosAt', 'metroMotion', 'easedShift',
  'trtcBoardFraction', 'trtcBoardPosition', 'trtcHeadwayPosition', 'snapshotTrtcHeadways',
  'clearTrtcBoard', 'applyTrtcBoard', 'metroShiftSec',
];
let frozenExact = 0;
for (const name of frozenFunctions) {
  const current = extractFunction(INDEX, name), before = extractFunction(BASE_INDEX, name);
  if (check(current === before, `動畫既有函式 byte-exact 未改：${name}`, `${sha(current)} / ${sha(before)}`)) frozenExact++;
}
result.metrics.frozenFunctionsExact = `${frozenExact}/${frozenFunctions.length}`;
mutation('動畫名冊函式任何一 byte 改動都會被抓到',
  extractFunction(INDEX, 'freqTrainTime') === extractFunction(BASE_INDEX, 'freqTrainTime'),
  `${extractFunction(INDEX, 'freqTrainTime')}\n// mutant`.trim() === extractFunction(BASE_INDEX, 'freqTrainTime'));

const directFunctionNames = [
  'trtcOfficialStationName', 'trtcOfficialRowFresh', 'trtcOfficialBoardRealNow',
  'trtcOfficialCountdownText', 'applyTrtcOfficialBoard', 'trtcOfficialStationLines',
  'trtcOfficialLineCandidates', 'trtcOfficialTripJoin', 'trtcOfficialBoardView',
  'renderTrtcOfficialFreqBoard', 'refreshTrtcOfficialBoardCountdown',
];
const directSource = directFunctionNames.map(name => extractFunction(INDEX, name)).join('\n');
check(!/\b(?:easedShift|trtcHeadwayPosition|TRTC_BOARD_MAX_POSITION_ERROR_M)\b/.test(directSource),
  '官方直出函式不依賴 easedShift／站間位置／25m gate');
check(!/state\.(?:_trtcBoard|_liveShift|_gpsShifts|_tt|bindings)\s*=/.test(directSource),
  '官方直出函式不寫動畫校正、班表或 bindings');
check(/state\.trtcOfficialBoard\s*=/.test(extractFunction(INDEX, 'applyTrtcOfficialBoard')),
  '官方資料只落在獨立 state.trtcOfficialBoard');
check(/refreshTrtcOfficialBoardCountdown\(\)/.test(INDEX.match(/if \(state\._liveClock >= 1\)[^\n]+/u)?.[0] || ''),
  '倒數掛在既有 1 秒 UI tick');
check((INDEX.match(/setInterval\(pollTrtcLive/g) || []).length === 1,
  '北捷輪詢仍只有既有單一 15 秒 timer');
check(/setInterval\(pollTrtcLive,\s*15e3\)/.test(INDEX), '北捷輪詢週期鎖定既有 15e3');
check(/eta:\s*base\s*\+\s*sec,\s*at:\s*base/.test(WORKER),
  'Worker 每列同時保留官方 at 與 eta=at+CountDown');
check(!/board\.push\([^\n]*(?:Date\.now|receivedAt)/.test(WORKER),
  'Worker 不用收到回應的時間重建 ETA');
check(/if \(sec == null\) \{ cdDropped\+\+; continue; \}/.test(WORKER),
  'Worker 遇未知 CountDown fail-closed 丟列並計 dropped，空 board 讓前端 fallback');
mutation('未知 CountDown 若被當 0 秒列出會被抓到',
  /if \(sec == null\) \{ cdDropped\+\+; continue; \}/.test(WORKER),
  /if \(sec == null\) \{ cdDropped\+\+; continue; \}/.test(WORKER.replace('if (sec == null) { cdDropped++; continue; }','if (sec == null) sec = 0;')));
mutation('Worker 若把 at 改成收件時間會被抓到',
  /eta:\s*base\s*\+\s*sec,\s*at:\s*base/.test(WORKER),
  /eta:\s*base\s*\+\s*sec,\s*at:\s*base/.test(WORKER.replace('at: base', 'at: Date.now() / 1000')));

// ── 2. 實際純函式／view model 回放 ───────────────────────────────────────
const officialFns = [
  'trtcServiceSec', 'trtcOfficialStationName', 'trtcOfficialRowFresh',
  'trtcOfficialBoardRealNow', 'trtcOfficialCountdownText', 'applyTrtcOfficialBoard',
  'clearTrtcOfficialBoard', 'trtcOfficialStationLines', 'trtcOfficialLineCandidates',
  'trtcOfficialScheduledArrival', 'trtcOfficialTripJoin', 'trtcOfficialLegacyGroups',
  'trtcOfficialBoardView', 'trtcOfficialAbsoluteHM',
];
const harnessContext = {
  console,
  __state: { simSec: 43200, clockAtNow: true, playing: true, speedMult: 1, _scrubTime: false,
    visible: new Set(), trtcOfficialBoard: null },
  __nowSec: 43200,
  __shift: 0,
  __shiftCalls: 0,
};
vm.createContext(harnessContext);
vm.runInContext(`
  const state = globalThis.__state;
  const _trtcNoTrip = new Map();
  ${extractConst(INDEX, 'TRTC_OFFICIAL_BOARD_MAX_AGE_MS')}
  ${extractConst(INDEX, 'TRTC_OFFICIAL_BOARD_FUTURE_SKEW_MS')}
  ${extractConst(INDEX, 'TRTC_OFFICIAL_BOARD_ARRIVING_GRACE_SEC')}
  function nowSecOfDay(){ return globalThis.__nowSec; }
  function isTrtcBoardLine(ln){ return !!ln.isTrtc; }
  function freqTrainTime(){ return {}; }
  function runBetween(){ return 60; }
  function freqTripKey(ln, tr){ return ln.id + '|' + (tr._key || tr.join(',')); }
  function metroShiftSec(){ globalThis.__shiftCalls++; return globalThis.__shift; }
  ${officialFns.map(name => extractFunction(INDEX, name)).join('\n')}
  globalThis.API = { state, _trtcNoTrip, ${officialFns.join(',')},
    maxAge: TRTC_OFFICIAL_BOARD_MAX_AGE_MS, future: TRTC_OFFICIAL_BOARD_FUTURE_SKEW_MS };
`, harnessContext);
const A = harnessContext.API;
{
  const production = extractFunction(INDEX, 'trtcOfficialLegacyGroups');
  const early = "      if (isTrtcBoardLine(ln) && officialDirections.has(ln.id + '|' + trtcOfficialStationName(destName))) return;\n";
  const removed = production.replace(early, '');
  const mutant = removed
    .replace('function trtcOfficialLegacyGroups(', 'function trtcOfficialLegacyGroupsLateSkip(')
    .replace('    byDir.forEach((rows, destName) => {',
      "    byDir.forEach((rows, destName) => {\n      if (isTrtcBoardLine(ln) && officialDirections.has(ln.id + '|' + trtcOfficialStationName(destName))) return;");
  if (removed === production || mutant === production) throw new Error('無法建立 legacy late-skip mutation');
  vm.runInContext(`${mutant}\nglobalThis.API.trtcOfficialLegacyGroupsLateSkip=trtcOfficialLegacyGroupsLateSkip;`, harnessContext);
}

const baseEpoch = Date.UTC(2026, 7, 13, 4, 0, 0) / 1000; // 台北 12:00:00
check(A.trtcOfficialStationName(' 臺北車站 ') === '台北', '站名正規化：臺／台、空白、車站尾字');
check(A.trtcOfficialStationName('忠孝復興站') === '忠孝復興', '站名正規化：尾端「站」');
mutation('拿掉臺→台正規化會被抓到', A.trtcOfficialStationName('臺北站') === A.trtcOfficialStationName('台北'),
  '臺北'.replace(/站$/, '') === A.trtcOfficialStationName('台北'));

const freshRow = { name: '台北車站', dest: '象山', at: baseEpoch, eta: baseEpoch + 90, no: '101' };
check(A.trtcOfficialRowFresh(freshRow, baseEpoch * 1000 + 45000), '45 秒 freshness 邊界含端點');
check(!A.trtcOfficialRowFresh(freshRow, baseEpoch * 1000 + 45001), '45 秒後 fail-closed');
check(A.trtcOfficialRowFresh(freshRow, baseEpoch * 1000 - 5000), '官方來源時間最多容許未來 5 秒時鐘差');
check(!A.trtcOfficialRowFresh(freshRow, baseEpoch * 1000 - 5001), '來源時間過度超前 fail-closed');
mutation('freshness 被放寬成 90 秒會被抓到',
  !A.trtcOfficialRowFresh(freshRow, baseEpoch * 1000 + 46000),
  !((baseEpoch * 1000 + 46000) - freshRow.at * 1000 <= 90000));
mutation('future gate 被放寬成 30 秒會被抓到',
  !A.trtcOfficialRowFresh(freshRow, baseEpoch * 1000 - 6000),
  !((baseEpoch * 1000 - 6000) - freshRow.at * 1000 >= -30000));

const cacheCountdowns = [0, 15, 30].map(age => ({ age,
  fresh: A.trtcOfficialRowFresh(freshRow, (baseEpoch + age) * 1000),
  text: A.trtcOfficialCountdownText(freshRow.eta, baseEpoch + age) }));
check(cacheCountdowns.every(x => x.fresh), '0／15／30 秒 edge-cache 樣本仍逐列 fresh', JSON.stringify(cacheCountdowns));
check(cacheCountdowns.map(x => x.text).join('|') === '1:30|1:15|1:00',
  '快取只讓同一絕對 ETA 自然遞減，不以收件時間重啟倒數', cacheCountdowns.map(x => x.text).join(' / '));
mutation('若收到 cache 後重啟 1:30 倒數會被抓到',
  cacheCountdowns[2].text === '1:00', '1:30' === '1:00');

const appliedA = A.applyTrtcOfficialBoard([freshRow], (baseEpoch + 1) * 1000);
const etaA = appliedA.rows[0].eta;
const appliedB = A.applyTrtcOfficialBoard([freshRow], (baseEpoch + 31) * 1000);
check(appliedB.rows[0].eta === etaA && appliedB.receivedAt === (baseEpoch + 31) * 1000,
  'receivedAt 改變不重建 eta', `eta=${etaA}, receivedAt=${appliedB.receivedAt}`);
const oldOfficial = A.state.trtcOfficialBoard;
const malformed = [null,
  {name:'',dest:'象山',at:baseEpoch,eta:baseEpoch+30},
  {name:'台北',dest:'',at:baseEpoch,eta:baseEpoch+30},
  {name:'台北',dest:'象山',at:null,eta:baseEpoch+30},
  {name:'台北',dest:'象山',at:'',eta:baseEpoch+30},
  {name:'台北',dest:'象山',at:baseEpoch,eta:null},
  {name:'台北',dest:'象山',at:baseEpoch,eta:''},
  {name:'台北',dest:'象山',at:baseEpoch,eta:baseEpoch-1},
];
check(A.applyTrtcOfficialBoard(malformed, (baseEpoch+40)*1000) === null && A.state.trtcOfficialBoard === oldOfficial,
  '非空但全 malformed（null／空欄／eta<at）保留舊 official identity');
const partial = A.applyTrtcOfficialBoard([...malformed, freshRow], (baseEpoch+41)*1000);
check(partial && partial.rows.length === 1 && partial.rows[0].eta === freshRow.eta,
  'partial valid 只採有效列，不被同批壞列拖垮');
mutation('全 malformed 若清掉舊 official state 會被 identity gate 抓到',
  oldOfficial !== null, false);

const midAt = Date.UTC(2026, 7, 13, 15, 59, 55) / 1000; // 台北 23:59:55
const midEta = midAt + 10;
check(A.trtcOfficialAbsoluteHM(midEta) === '00:00' && A.trtcOfficialCountdownText(midEta, midAt) === '0:10',
  '跨午夜仍顯示正確絕對時刻與秒級倒數');
check(A.trtcServiceSec(midEta) === 86405, '00:00:05 歸入前一營運日 86405 秒');

function resetGate(overrides = {}) {
  Object.assign(A.state, { simSec: 43200, clockAtNow: true, playing: true, speedMult: 1, _scrubTime: false }, overrides);
  harnessContext.__nowSec = 43200;
}
resetGate();
check(A.trtcOfficialBoardRealNow(), '真實現在、播放中、1× 才開官方直出');
for (const [label, patch] of [
  ['暫停', { playing: false }], ['高倍速', { speedMult: 2 }], ['拖曳時間軸', { _scrubTime: true }],
  ['時間旅行', { clockAtNow: false }], ['偏離現在超過 120 秒', { simSec: 43321 }],
]) {
  resetGate(patch);
  check(!A.trtcOfficialBoardRealNow(), `${label}退回既有班表看板`);
}
resetGate({ simSec: 86395 }); harnessContext.__nowSec = 5;
check(A.trtcOfficialBoardRealNow(), 'real-now gate 跨午夜用環形時間差');
mutation('高倍速若仍開直出會被抓到', (() => { resetGate({ speedMult: 2 }); return !A.trtcOfficialBoardRealNow(); })(),
  !(A.state.clockAtNow && A.state.playing));

function line(id, names, isTrtc = true, tt = []) {
  return { id, name: id, color: id === 'BR' ? '#8b6f47' : (isTrtc ? '#1268a5' : '#8a2be2'),
    isTrtc, _sysLabel: isTrtc ? '北捷' : '測試捷運', stations: names.map(name => ({ name })), _tt: tt };
}
function viewFixture(rows, lines, station = '中間站', isDeco = false, now = baseEpoch) {
  resetGate(); harnessContext.__nowSec = 43200; A.state.simSec = 43200;
  A.state.visible = new Set(lines.map(x => x.id));
  A.state.trtcOfficialBoard = { rows, sourceAt: now, receivedAt: now * 1000 };
  return A.trtcOfficialBoardView({ name: station }, lines, isDeco, now * 1000);
}

const both = line('BL', ['西端', '中間', '東端'], true, []);
const directionRows = [
  { name: '中間站', dest: '東端站', at: baseEpoch, eta: baseEpoch + 100, no: '2' },
  { name: '中間', dest: '東端', at: baseEpoch, eta: baseEpoch + 60, no: '1' },
  { name: '中間', dest: '西端', at: baseEpoch, eta: baseEpoch + 80, no: '3' },
];
let view = viewFixture(directionRows, [both]);
check(view && view.groups.filter(g => g.kind === 'official').length === 2, '雙方向各自成組');
check(view.groups.find(g => g.kind === 'official' && A.trtcOfficialStationName(g.destName) === '東端')
  .rows.map(x => x.row.eta).join(',') === `${baseEpoch + 60},${baseEpoch + 100}`,
  '同方向官方列只依 eta 排序，不依動畫配對');

const duplicateRows = [directionRows[1], { ...directionRows[1] }, { ...directionRows[1], no: '另一班' }];
view = viewFixture(duplicateRows, [both]);
check(view.groups[0].rows.length === 2, 'exact duplicate 去重，不同車號同 ETA 仍保留');
mutation('拿掉 exact duplicate 去重會被抓到', view.groups[0].rows.length === 2, duplicateRows.length === 2);

const arriving = [
  { name: '中間', dest: '東端', at: baseEpoch, eta: baseEpoch - 30, no: '' },
  { name: '中間', dest: '東端', at: baseEpoch, eta: baseEpoch - 30.001, no: 'old' },
];
view = viewFixture(arriving, [both]);
check(view && view.groups[0].rows.length === 1 && A.trtcOfficialCountdownText(view.groups[0].rows[0].row.eta, baseEpoch) === '列車進站',
  '進站窗含 -30 秒；超過即移除');

const bl = line('BL', ['南港展覽館', '昆陽'], true, []);
const br = line('BR', ['南港展覽館', '南港軟體園區'], true, []);
A.state.visible = new Set(['BL', 'BR']);
let candidates = A.trtcOfficialLineCandidates(A.trtcOfficialStationLines([bl, br], '南港展覽館', false), '南港軟體園區', '');
check(candidates.length === 1 && candidates[0].ln.id === 'BR', 'BR 官方無車號仍能依站／終點顯示');

// 共用站／終點刻意做成 BL、BR 都可達，驗 no 空值的分線規則。
const blShared = line('BL', ['南港展覽館', '共同終點'], true, []);
const brShared = line('BR', ['南港展覽館', '共同終點'], true, []);
A.state.visible = new Set(['BL', 'BR']);
const shared = A.trtcOfficialStationLines([blShared, brShared], '南港展覽館', false);
check(A.trtcOfficialLineCandidates(shared, '共同終點', '').every(x => x.ln.id === 'BR') &&
  A.trtcOfficialLineCandidates(shared, '共同終點', '123').every(x => x.ln.id === 'BL'),
  'BR 無號／BL 有號只用於選線，不控制 ETA 是否存在');

// 配不到動畫也不得消失；任意動畫 shift、位置物件、clear 都不能改官方列。
const independentRow = { name: '中間', dest: '東端', at: baseEpoch, eta: baseEpoch + 70, no: '' };
harnessContext.__shift = 0;
const beforeIndependent = viewFixture([independentRow], [both]);
both._trtcBoard = { shifts: new Map(), positions: new Map(), gateM: 25 };
both._liveShift = { all: 9999 }; both._gpsShifts = new Map();
harnessContext.__shift = 9999;
const afterIndependent = viewFixture([independentRow], [both]);
const pickOfficial = v => v.groups.filter(g => g.kind === 'official').flatMap(g => g.rows)
  .map(x => [x.row.eta, x.row.dest, !!x.join]);
check(JSON.stringify(pickOfficial(beforeIndependent)) === JSON.stringify(pickOfficial(afterIndependent)) &&
  pickOfficial(afterIndependent)[0][2] === false,
  'join 失敗、metroShift、_trtcBoard／_liveShift／_gpsShifts 變動皆不改官方 ETA／排序／可見性');
mutation('若官方 ETA 偷加 metroShift 會被抓到', independentRow.eta === pickOfficial(afterIndependent)[0][0],
  independentRow.eta + harnessContext.__shift === pickOfficial(afterIndependent)[0][0]);

// 全台同框不看 visible；混合非北捷則保留原班表列。
const otherTrip = [0, 43100, 1, 43300, 2, 43500]; otherTrip._key = 'other';
const other = line('OTHER', ['西端', '中間', '東端'], false, [otherTrip]);
A.state.visible = new Set(); harnessContext.__shift = 0;
A.state.trtcOfficialBoard = { rows: [independentRow], sourceAt: baseEpoch, receivedAt: baseEpoch * 1000 };
resetGate(); A.state.visible = new Set();
view = A.trtcOfficialBoardView({ name: '中間' }, [both, other], true, baseEpoch * 1000);
check(view && view.groups.some(g => g.kind === 'official') && view.groups.some(g => g.kind === 'legacy' && g.ln.id === 'OTHER'),
  '全台同框 direct 生效且混合非北捷仍保留既有班表列');

// 分岔、模糊線別與 visible/deco：線別判讀只控制標色／跟隨，不得誤吃官方列。
const ox = line('O_X', ['南勢角', '共線站', '蘆洲'], true, [[2,43100,1,43300,0,43500]]);
const oy = line('O_Y', ['南勢角', '共線站', '迴龍'], true, [[2,43110,1,43310,0,43510]]);
const orangeRow = { name:'共線站', dest:'南勢角', at:baseEpoch, eta:baseEpoch + 40, no:'O1' };
A.state.visible = new Set(['O_X','O_Y']);
A.state.trtcOfficialBoard = { rows:[orangeRow], sourceAt:baseEpoch, receivedAt:baseEpoch * 1000 };
resetGate(); A.state.visible = new Set(['O_X','O_Y']);
const oBothView = A.trtcOfficialBoardView({name:'共線站'}, [ox, oy], false, baseEpoch * 1000);
const oBothOfficial = oBothView.groups.filter(g=>g.kind==='official'&&A.trtcOfficialStationName(g.destName)==='南勢角');
const oBothDuplicate = oBothView.groups.filter(g=>g.kind==='legacy'&&A.trtcOfficialStationName(g.destName)==='南勢角');
check(oBothOfficial.length===1 && oBothDuplicate.length===0,
  'O 兩支皆可見：fresh 南勢角 official 只一組，兩支 legacy 同方向皆不重複');
const oBothRec=oBothOfficial[0].rows[0];
const oldDisplayOnly=new Set([oBothRec.display.ln.id+'|南勢角']);
const oldLegacy=A.trtcOfficialLegacyGroups({name:'共線站'},[ox,oy],false,true,oldDisplayOnly);
mutation('O direction fallback 若只記 display line，另一支會重複南勢角',
  oBothDuplicate.length===0,
  !oldLegacy.some(g=>A.trtcOfficialStationName(g.destName)==='南勢角'));
A.state.visible = new Set(['O_X']);
view = A.trtcOfficialBoardView({name:'共線站'}, [ox, oy], false, baseEpoch * 1000);
const oRec = view && view.groups.find(g => g.kind === 'official')?.rows[0];
const oHiddenDuplicate = view && view.groups.filter(g=>g.kind==='legacy'&&A.trtcOfficialStationName(g.destName)==='南勢角');
check(oRec && oRec.ambiguousLine && !oRec.join && oRec.candidates.length === 1 && oHiddenDuplicate.length===0,
  'O 隱藏一支：官方列仍顯示且可見支線 legacy 同方向不重複');
A.state.visible = new Set();
check(A.trtcOfficialBoardView({name:'共線站'}, [ox, oy], false, baseEpoch * 1000) === null,
  'O 官方列只屬於全數關閉路線時不洩漏到分頁');

for (const [id, branchId, station, trunk, branch] of [
  ['R', 'R_XBT', '紅共線', '淡水', '新北投'],
  ['G', 'G_XBT', '綠共線', '新店', '小碧潭'],
]) {
  const main = line(id, [trunk, station, '主線端'], true, []);
  const spur = line(branchId, [trunk, station, branch], true, []);
  resetGate(); A.state.visible = new Set([id, branchId]);
  A.state.trtcOfficialBoard = { rows:[{name:station, dest:branch, at:baseEpoch, eta:baseEpoch+50, no:''}], sourceAt:baseEpoch, receivedAt:baseEpoch*1000 };
  const branchView = A.trtcOfficialBoardView({name:station}, [main, spur], false, baseEpoch*1000);
  check(branchView && branchView.groups.find(g => g.kind === 'official')?.ln.id === branchId,
    `${id}/${branchId} 依終點正確分到支線且 ETA 可見`);
}
const yellow = line('Y', ['十四張', '板新', '大坪林'], true, []);
resetGate(); A.state.visible = new Set();
A.state.trtcOfficialBoard = { rows:[{name:'板新',dest:'大坪林',at:baseEpoch,eta:baseEpoch+55,no:''}], sourceAt:baseEpoch,receivedAt:baseEpoch*1000 };
check(A.trtcOfficialBoardView({name:'板新'}, [yellow], false, baseEpoch*1000) === null &&
  !!A.trtcOfficialBoardView({name:'板新'}, [yellow], true, baseEpoch*1000),
  'Y 在 lines 遵守 visible；在 deco 全台同框仍顯示');

resetGate(); A.state.visible = new Set(['BL']);
A.state.trtcOfficialBoard = { rows:[{name:'中間',dest:'不存在終點',at:baseEpoch,eta:baseEpoch+60,no:''}], sourceAt:baseEpoch,receivedAt:baseEpoch*1000 };
const unknownDest = A.trtcOfficialBoardView({name:'中間'}, [both], false, baseEpoch*1000);
check(unknownDest && unknownDest.groups[0].rows[0].join === null,
  '官方終點暫時無法辨識仍顯示 ETA，只拿掉動畫跟隨');

const eastTrip=[0,43100,1,43300,2,43500], westTrip=[2,43110,1,43310,0,43510];
const mixedLine=line('BL',['西端','中間','東端'],true,[eastTrip,westTrip]);
resetGate(); A.state.visible=new Set(['BL']);
A.state.trtcOfficialBoard={rows:[{name:'中間',dest:'東端',at:baseEpoch,eta:baseEpoch+60,no:''}],sourceAt:baseEpoch,receivedAt:baseEpoch*1000};
const mixedView=A.trtcOfficialBoardView({name:'中間'},[mixedLine],false,baseEpoch*1000);
const mixedGroups=mixedView && mixedView.groups.map(g=>({kind:g.kind,dest:A.trtcOfficialStationName(g.destName)}));
check(mixedGroups && mixedGroups.some(g=>g.kind==='official'&&g.dest==='東端') &&
  mixedGroups.some(g=>g.kind==='legacy'&&g.dest==='西端') &&
  !mixedGroups.some(g=>g.kind==='legacy'&&g.dest==='東端'),
  '逐方向 fallback：東向 fresh official、缺列西向補 legacy，官方方向不重複',JSON.stringify(mixedGroups));
mutation('若 mixed-direction 整板二選一會漏掉缺列方向',
  mixedGroups?.some(g=>g.kind==='legacy'&&g.dest==='西端'), false);
harnessContext.__shiftCalls=0;
A.state.trtcOfficialBoard={rows:[
  {name:'中間',dest:'東端',at:baseEpoch,eta:baseEpoch+60,no:''},
  {name:'中間',dest:'西端',at:baseEpoch,eta:baseEpoch+70,no:''},
],sourceAt:baseEpoch,receivedAt:baseEpoch*1000};
A.trtcOfficialBoardView({name:'中間'},[mixedLine],false,baseEpoch*1000);
const allOfficialShiftCalls=harnessContext.__shiftCalls;
check(allOfficialShiftCalls===0,
  '兩方向都有 official 時，legacy 先 skip，metroShiftSec／easedShift 完全不被推進');
harnessContext.__shiftCalls=0;
A.state.trtcOfficialBoard={rows:[{name:'中間',dest:'東端',at:baseEpoch,eta:baseEpoch+60,no:''}],sourceAt:baseEpoch,receivedAt:baseEpoch*1000};
A.trtcOfficialBoardView({name:'中間'},[mixedLine],false,baseEpoch*1000);
const oneMissingShiftCalls=harnessContext.__shiftCalls;
check(oneMissingShiftCalls===1,
  '缺一方向時只為該 legacy 方向呼叫一次 metroShiftSec',`calls=${oneMissingShiftCalls}`);
harnessContext.__shiftCalls=0;
A.trtcOfficialLegacyGroupsLateSkip({name:'中間'},[mixedLine],false,true,new Set(['BL|東端','BL|西端']));
const lateSkipCalls=harnessContext.__shiftCalls;
mutation('舊 late-skip 會在純 official 開板仍推進 easedShift',
  allOfficialShiftCalls===0,
  lateSkipCalls===0);

// ── 3. poll 的 board / boardPos 兩條錯誤域獨立 ─────────────────────────────
const pollContext = { console, AbortController, setTimeout, clearTimeout, document: { hidden: false },
  __payload: null, __fetchError: null, __calls: {}, __nowSec:43200, __pool:[{isTrtc:true,_tt:[1]}],
  __state: { simSec: 43200, boardStation: { name: 'X' } } };
vm.createContext(pollContext);
vm.runInContext(`
  const state = globalThis.__state;
  let _trtcPolling = false;
  function metroLivePool(){ return globalThis.__pool; }
  function isTrtcBoardLine(ln){ return !!ln.isTrtc; }
  function nowSecOfDay(){ return globalThis.__nowSec; }
  function apiUrl(x){ return x; }
  function hit(k){ globalThis.__calls[k] = (globalThis.__calls[k] || 0) + 1; }
  async function fetch(){ if(globalThis.__fetchError) throw globalThis.__fetchError; return { ok:true, json:async()=>globalThis.__payload }; }
  function applyTrtcOfficialBoard(){ hit('boardApply'); if(globalThis.__calls.throwBoard) throw Error('board'); return globalThis.__calls.boardResult===false?null:{}; }
  function clearTrtcOfficialBoard(){ hit('boardClear'); }
  function applyTrtcBoard(){ hit('posApply'); if(globalThis.__calls.throwPos) throw Error('pos'); }
  function clearTrtcBoard(){ hit('posClear'); }
  function renderBoard(){ hit('render'); }
  function updateMetroBadge(){ hit('badge'); }
  async ${extractFunction(INDEX, 'pollTrtcLive')}
  globalThis.runPoll = pollTrtcLive;
`, pollContext);
async function pollCase(payload, calls = {}, fetchError = null, opts = {}) {
  pollContext.__payload = payload; pollContext.__calls = { ...calls }; pollContext.__fetchError = fetchError;
  pollContext.__nowSec = opts.nowSec ?? 43200; pollContext.__state.simSec = opts.simSec ?? 43200;
  pollContext.__pool = opts.pool ?? [{isTrtc:true,_tt:[1]}];
  await pollContext.runPoll();
  return { ...pollContext.__calls };
}
let calls = await pollCase({ src: 'trtc', board: [freshRow], boardPos: { at: baseEpoch, rows: 'bad' } });
check(calls.boardApply === 1 && calls.render === 1 && calls.posClear === 1 && !calls.boardClear, 'valid board 會重畫；boardPos 壞掉不清官方直出 board');
calls = await pollCase({ src: 'trtc', board: 'bad', boardPos: { at: baseEpoch, rows: [] } });
check(!calls.boardApply && !calls.boardClear && calls.posApply === 1, 'board 壞掉保留到逐列過期且不妨礙 boardPos');
calls = await pollCase({ src: 'trtc', board: [freshRow], boardPos: { at: baseEpoch, rows: [] } }, { throwBoard: 1 });
check(calls.posApply === 1, 'board apply 丟例外仍會執行 boardPos');
calls = await pollCase({ src: 'trtc', board: [freshRow], boardPos: { at: baseEpoch, rows: [] } }, { throwPos: 1 });
check(calls.boardApply === 1 && calls.posClear === 1, 'boardPos apply 丟例外不回頭清官方 board');
calls = await pollCase({ src: 'trtc', board: [], boardPos: { at: baseEpoch, rows: [] } });
check(calls.boardClear === 1 && calls.render === 1 && calls.posApply === 1, '官方明確空 board 才立即 fallback＋重畫，boardPos 仍獨立套用');
calls = await pollCase({src:'trtc',board:malformed,boardPos:{at:baseEpoch,rows:[]}}, {boardResult:false});
check(calls.boardApply===1 && !calls.boardClear && !calls.render && calls.posApply===1,
  '非空全 malformed：保留舊 official、不重畫，boardPos 照常套用');
mutation('全 malformed 若被當成功 boardTouched 會誤重畫', !calls.render, false);
calls = await pollCase(null, {}, new Error('offline'));
check(!calls.boardClear && calls.posClear === 1, '整體 fetch 失敗：官方列靠 at 自行過期，動畫沿用既有退場語意');
const coupledMutant = { boardApply: 1, posClear: 1, boardClear: 1 };
mutation('boardPos 失敗若連帶 clear 官方 board 會被抓到',
  (await pollCase({ src: 'trtc', board: [freshRow], boardPos: null })).boardClear !== 1,
  coupledMutant.boardClear !== 1);
calls = await pollCase({src:'trtc',board:[freshRow],boardPos:{at:baseEpoch,rows:[]}}, {}, null,
  {simSec:86395,nowSec:5});
check(calls.boardApply === 1 && !calls.posApply && !calls.posClear,
  '跨午夜只解鎖 official fetch；動畫 rawWallDelta gate 完全不動');
mutation('跨午夜若順便套 boardPos 會被抓到', calls.boardApply === 1 && !calls.posApply, false);
calls = await pollCase({src:'trtc',board:[freshRow],boardPos:{at:baseEpoch,rows:[]}}, {}, null,
  {pool:[{isTrtc:true,_tt:null}]});
check(calls.boardApply === 1 && !calls.posApply && !calls.posClear,
  'TRTC 線尚無 _tt 仍可抓 official；動畫不套也不清');
mutation('無 _tt 若仍觸碰動畫校正會被抓到', calls.boardApply === 1 && !calls.posApply && !calls.posClear, false);

// ── 4. 真實 DOM：fallback byte、matched/unmatched、只 patch 秒數 ───────────
const styleText = [...INDEX.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const rendererFns = [
  'trtcServiceSec', 'trtcOfficialStationName', 'trtcOfficialRowFresh',
  'trtcOfficialBoardRealNow', 'trtcOfficialCountdownText', 'trtcOfficialAbsoluteHM',
  'trtcOfficialStationLines', 'trtcOfficialLineCandidates', 'trtcOfficialScheduledArrival',
  'trtcOfficialTripJoin', 'trtcOfficialLegacyGroups', 'trtcOfficialBoardView',
  'renderTrtcOfficialFreqBoard', 'refreshTrtcOfficialBoardCountdown', 'renderFreqBoard',
];
const currentRendererSource = rendererFns.map(name => extractFunction(INDEX, name)).join('\n');
const baselineRenderer = extractFunction(BASE_INDEX, 'renderFreqBoard').replace('function renderFreqBoard(', 'function renderFreqBoardBaseline(');
const browserHarness = `
  const state = { simSec:43200, clockAtNow:true, playing:true, speedMult:1, _scrubTime:false,
    visible:new Set(), trtcOfficialBoard:null, boardStation:{name:'中間'} };
  const _trtcNoTrip = new Map();
  ${extractConst(INDEX, 'TRTC_OFFICIAL_BOARD_MAX_AGE_MS')}
  ${extractConst(INDEX, 'TRTC_OFFICIAL_BOARD_FUTURE_SKEW_MS')}
  ${extractConst(INDEX, 'TRTC_OFFICIAL_BOARD_ARRIVING_GRACE_SEC')}
  let __nowSec=43200, __shift=0, __follow=null, __close=0, __fullRenders=0;
  function nowSecOfDay(){ return __nowSec; }
  function isTrtcBoardLine(ln){ return !!ln.isTrtc; }
  function freqTrainTime(){ return {}; }
  function runBetween(){ return 60; }
  function freqTripKey(ln,tr){ return ln.id+'|'+(tr._key||tr.join(',')); }
  function metroShiftSec(){ return __shift; }
  function metroLiveOn(){ return false; }
  function metroFresh(){ return false; }
  function fmtHM(t){ t=((t%86400)+86400)%86400; return String(Math.floor(t/3600)).padStart(2,'0')+':'+String(Math.floor(t/60)%60).padStart(2,'0'); }
  function escHtml(v){ const x=document.createElement('span'); x.textContent=String(v); return x.innerHTML; }
  function isFavStation(){ return false; }
  function stnMetaHtml(){ return ''; }
  function eventRowsHtml(){ return ''; }
  function railIcon(){ return '<span aria-hidden="true">★</span>'; }
  function updateSheetOpenClass(){}
  function closeBoard(){ __close++; }
  function toggleFavStation(){}
  function setFreqFollow(x){ __follow=x; }
  function renderBoard(){ __fullRenders++; }
  ${currentRendererSource}
  function renderTrtcOfficialFreqBoardShiftMutant(el,st,lines,isDeco,view){
    renderTrtcOfficialFreqBoard(el,st,lines,isDeco,view);
    el.querySelectorAll('.row[data-trtc-eta]').forEach(row=>{
      const eta=Number(row.dataset.trtcEta)+__shift;
      row.querySelector('.t').textContent=trtcOfficialAbsoluteHM(eta);
      row.querySelector('.min').textContent=trtcOfficialCountdownText(eta,view.nowMs/1000);
    });
  }
  ${baselineRenderer}
  window.TEST={state,_trtcNoTrip,get follow(){return __follow},get close(){return __close},get full(){return __fullRenders},
    reset(){__follow=null;__close=0;__fullRenders=0;},setShift(x){__shift=x},setNow(x){__nowSec=x},
    view:trtcOfficialBoardView,render:renderTrtcOfficialFreqBoard,refresh:refreshTrtcOfficialBoardCountdown,
    mutant:renderTrtcOfficialFreqBoardShiftMutant,legacy:renderFreqBoard,baseline:renderFreqBoardBaseline};
`;

async function installPage(page) {
  page.setDefaultTimeout(5000);
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>${styleText}</style></head><body><div class="stage" style="position:relative;height:100dvh"><div id="board" class="board"></div><div id="baseline" class="board" hidden></div></div></body></html>`);
  await page.addScriptTag({ content: browserHarness });
}
async function legacyByteCheck(page) {
  return page.evaluate(() => {
    const mk = id => ({ id, name:id, color:'#1268a5', _sysLabel:'北捷', isTrtc:true,
      stations:[{name:'西端'},{name:'中間'},{name:'東端'}], _tt:[[0,43100,1,43300,2,43500]] });
    const lines=[mk('BL')], st={name:'中間'};
    TEST.state.visible=new Set(['BL']); TEST.state.trtcOfficialBoard=null;
    const a=document.getElementById('board'), b=document.getElementById('baseline');
    TEST.legacy(a,st,lines,false); TEST.baseline(b,st,lines,false);
    const out={ same:a.innerHTML===b.innerHTML, a:a.innerHTML, b:b.innerHTML };
    b.hidden=true;
    return out;
  });
}
async function fallbackMatrixCheck(page) {
  return page.evaluate(() => {
    const now=Date.now()/1000, day=new Date(now*1000+8*3600e3), nowSec=day.getUTCHours()*3600+day.getUTCMinutes()*60+day.getUTCSeconds();
    const trtc={id:'BL',name:'板南線',color:'#1268a5',_sysLabel:'北捷',isTrtc:true,
      stations:[{name:'西端'},{name:'中間'},{name:'東端'}],_tt:[[0,nowSec-100,1,nowSec+100,2,nowSec+300]]};
    const other={...trtc,id:'OTHER',name:'其他線',_sysLabel:'其他',isTrtc:false};
    const st={name:'中間'}, good={name:'中間',dest:'東端',at:now,eta:now+60,no:''};
    const cases=[
      ['null',[trtc],null,{}], ['empty',[trtc],{rows:[]},{}],
      ['stale',[trtc],{rows:[{...good,at:now-46}]},{}],
      ['future',[trtc],{rows:[{...good,at:now+6}]},{}],
      ['time-travel',[trtc],{rows:[good]},{clockAtNow:false}],
      ['unknown-station',[trtc],{rows:[{...good,name:'別站'}]},{}],
      ['pure-nontrtc',[other],{rows:[good]},{}],
    ];
    return cases.map(([name,lines,board,gate])=>{
      Object.assign(TEST.state,{simSec:nowSec,clockAtNow:true,playing:true,speedMult:1,_scrubTime:false,visible:new Set(lines.map(x=>x.id)),trtcOfficialBoard:board},gate);
      const a=document.getElementById('board'),b=document.getElementById('baseline');
      TEST.legacy(a,st,lines,false); TEST.baseline(b,st,lines,false);
      const out={name,same:a.innerHTML===b.innerHTML,direct:a.dataset.trtcOfficial==='1'};
      b.hidden=true; return out;
    });
  });
}
async function renderedShiftCheck(page) {
  return page.evaluate(() => {
    const base=Date.UTC(2026,7,13,4,0,0)/1000;
    const trip=[0,43140,1,43260,2,43500]; trip._key='shift';
    const ln={id:'BL',name:'板南線',color:'#1268a5',_sysLabel:'北捷',isTrtc:true,
      stations:[{name:'西端'},{name:'中間'},{name:'東端'}],_tt:[trip]};
    const rows=[
      {name:'中間',dest:'東端',at:base,eta:base+90,no:'A'},
      {name:'中間',dest:'東端',at:base,eta:base+130,no:'B'},
    ];
    TEST.state.visible=new Set(['BL']); TEST.state.simSec=43200; TEST.state.clockAtNow=true;
    TEST.state.playing=true; TEST.state.speedMult=1; TEST.state._scrubTime=false;
    TEST.state.trtcOfficialBoard={rows,sourceAt:base,receivedAt:base*1000};
    const snap=(shift,mutant=false)=>{
      TEST.setShift(shift); const view=TEST.view({name:'中間'},[ln],false,base*1000);
      (mutant?TEST.mutant:TEST.render)(document.getElementById('board'),{name:'中間'},[ln],false,view);
      return [...document.querySelectorAll('#board .row[data-trtc-eta]')].map(r=>({
        eta:r.dataset.trtcEta,t:r.querySelector('.t').textContent,min:r.querySelector('.min').textContent,
        dest:r.querySelector('b').textContent}));
    };
    return {prod:[-300,0,300].map(x=>snap(x)),mutant:[snap(0,true),snap(300,true)]};
  });
}
async function directDomFixture(page, width, engine) {
  const setup = await page.evaluate(() => {
    const base=Date.UTC(2026,7,13,4,0,0)/1000;
    // MATCH 的 ETA 只落在 trip1 的硬窗內；UNMATCH 同時落在兩班硬窗內。
    const trip1=[0,43140,1,43260,2,43500]; trip1._key='one';
    const trip2=[2,43100,1,43260,0,43500]; trip2._key='two';
    const trip3=[2,43120,1,43290,0,43530]; trip3._key='three';
    const ln={id:'BL',name:'板南線',color:'#1268a5',_sysLabel:'北捷',isTrtc:true,
      stations:[{name:'西端'},{name:'中間'},{name:'東端'}],_tt:[trip1,trip2,trip3]};
    TEST.state.visible=new Set(['BL']); TEST.state.simSec=43200; TEST.state.clockAtNow=true;
    TEST.state.playing=true; TEST.state.speedMult=1; TEST.state._scrubTime=false;
    // 第一列 route+硬窗真正只有 trip1；第二列同時有兩候選，保持不可點。
    const eta=base+120;
    TEST._trtcNoTrip.set('BL|1|MATCH','BL|one');
    TEST.state.trtcOfficialBoard={rows:[
      {name:'中間站',dest:'東端站',at:base,eta,no:'MATCH'},
      // 0:10 往西對 trip2／trip3 皆在硬窗內。
      {name:'中間',dest:'西端',at:base,eta:base+10,no:''},
    ],sourceAt:base,receivedAt:base*1000};
    const view=TEST.view({name:'中間'},[ln],false,base*1000);
    TEST.render(document.getElementById('board'),{name:'中間'},[ln],false,view);
    TEST.reset();
    return { direct:!!view, html:document.getElementById('board').innerHTML };
  });
  const matched = page.locator('#board .row[data-li]').first();
  const unmatched = page.locator('#board .row[aria-disabled="true"]').first();
  const matchedCount = await matched.count(), unmatchedCount = await unmatched.count();
  let hit = false, overflow = null;
  if (matchedCount && unmatchedCount) {
    const box = await matched.boundingBox();
    hit = await page.evaluate(({x,y}) => {
      const e=document.elementFromPoint(x,y); return !!(e && e.closest('#board .row[data-li]'));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    overflow = await page.evaluate(() => ({ sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth,
      board:document.getElementById('board').getBoundingClientRect().toJSON() }));
    await matched.tap();
  }
  const matchedAction = await page.evaluate(() => ({ followed:!!TEST.follow, close:TEST.close }));
  await page.evaluate(() => TEST.reset());
  if (unmatchedCount) await unmatched.tap();
  const unmatchedAction = await page.evaluate(() => ({ followed:!!TEST.follow, close:TEST.close,
    hasLi:document.querySelector('#board .row[aria-disabled="true"]').hasAttribute('data-li') }));

  // pointerdown 後若 panel full render，舊 li/ci 不可穿越 generation 被 click fallback 撿起。
  const generation = matchedCount ? await page.evaluate(() => {
    TEST.reset();
    const board=document.getElementById('board'), row=board.querySelector('.row[data-li]');
    row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
    const down=board._trtcDown && {...board._trtcDown};
    const st={name:'中間'};
    const ln={id:'BL',name:'板南線',color:'#1268a5',_sysLabel:'北捷',isTrtc:true,
      stations:[{name:'西端'},{name:'中間'},{name:'東端'}],_tt:[[0,43140,1,43300,2,43500]]};
    const view={nowMs:Date.UTC(2026,7,13,4,0,0),groups:[{kind:'official',ln,li:0,destName:'東端',rows:[{
      row:{name:'中間',dest:'東端',at:Date.UTC(2026,7,13,4,0,0)/1000,eta:Date.UTC(2026,7,13,4,2,0)/1000,no:'X'},
      join:{li:0,ci:0},candidates:[],display:{ln,li:0},ambiguousLine:false,left:120}]}]};
    TEST.render(board,st,[ln],false,view);
    board.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return {down,follow:!!TEST.follow,close:TEST.close,gen:board._trtcRenderGen};
  }) : { down:null, follow:false, close:0, gen:0 };

  // fresh 時只 patch .min，不准 full render；超齡才 full render/fallback。
  const patch = await page.evaluate(() => {
    TEST.reset();
    const row=document.querySelector('#board .row[data-trtc-eta]'), before=row, oldHtml=document.getElementById('board').innerHTML;
    const at=Number(row.dataset.trtcAt);
    TEST.refresh((at+1)*1000);
    const sameNode=before===document.querySelector('#board .row[data-trtc-eta]');
    const freshFull=TEST.full, newHtml=document.getElementById('board').innerHTML;
    TEST.refresh((at+46)*1000);
    return { sameNode, freshFull, staleFull:TEST.full, changed:oldHtml!==newHtml };
  });
  return { engine, width, setup:setup.direct, matchedCount, unmatchedCount, hit, overflow,
    matchedAction, unmatchedAction, generation, patch };
}

// 完整產品頁 gate：真正 boot 全站、用 openBoard 開北捷站，再掃全頁可見互動控件。
// 這一層與上面的 isolated renderer 分工：isolated 管 deterministic ETA/mutation；full app 管既有控件共存。
function makeStaticServer() {
  const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
    '.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ico':'image/x-icon',
    '.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
  return createServer((req,res)=>{
    const url=new URL(req.url,'http://x');
    if(url.pathname.startsWith('/api/')){
      res.statusCode=200; res.setHeader('content-type','application/json');
      if(url.pathname==='/api/thsr-schedule') return res.end(fs.readFileSync(path.join(ROOT,'data/thsr_schedule_dense.json')));
      return res.end('{}');
    }
    let fp=path.join(ROOT,decodeURIComponent(url.pathname));
    if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory()) fp=path.join(fp,'index.html');
    if(!path.resolve(fp).startsWith(ROOT)||!fs.existsSync(fp)){res.statusCode=404;return res.end('nf');}
    res.setHeader('content-type',MIME[path.extname(fp)]||'application/octet-stream'); res.end(fs.readFileSync(fp));
  });
}
function overlapRect(a,b){
  const x=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
  const y=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  return x>1&&y>1;
}
async function fullAppMatrix(type,engine,baseUrl) {
  const out=[];
  for(const width of [360,375,414,768]){
    const context=await type.launch({headless:true}).then(async browser=>{
      const context=await browser.newContext({viewport:{width,height:width===768?1024:812},isMobile:true,hasTouch:true,deviceScaleFactor:1});
      context.__browser=browser; return context;
    });
    await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(String(e.message||e)));
    await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready===true,null,{timeout:60000});
    const opened=await page.evaluate(()=>{
      selectGroup(GROUPS.find(g=>g.id==='metro'));
      const ln=state.lines.find(x=>isTrtcBoardLine(x)&&x._tt&&x._tt.length&&x.stations&&x.stations.length>3);
      if(!ln)return null;
      const si=Math.min(3,ln.stations.length-2),st=ln.stations[si];
      const dest=si<ln.stations.length/2?ln.stations[ln.stations.length-1]:ln.stations[0];
      const now=Date.now()/1000;
      state.clockAtNow=true;state.playing=true;state.speedMult=1;state._scrubTime=false;state.simSec=nowSecOfDay();
      state.trtcOfficialBoard={rows:[{name:st.name,dest:dest.name,at:now,eta:now+120,no:''}],sourceAt:now,receivedAt:now*1000};
      openBoard({name:st.name,sys:'mrt',lat:st.lat,lon:st.lon});
      return {line:ln.id,station:st.name,dest:dest.name,direct:document.getElementById('board').dataset.trtcOfficial==='1'};
    });
    await page.waitForTimeout(150);
    const scan=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return !e.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none'&&r.width>1&&r.height>1};
      const sel='button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[role=button],.leaflet-control-zoom a,.toolbtn,.toggle';
      const controls=[...new Set(document.querySelectorAll(sel))].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.getAttribute('aria-label')||e.className||e.tagName,left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:r.width,h:r.height}});
      const collisions=[];
      for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
        const a=controls[i],b=controls[j];
        const nested=String(a.id).includes('SVG')||String(b.id).includes('SVG');
        if(!nested&&Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))>1&&Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))>1)collisions.push([a.id,b.id]);
      }
      const board=document.getElementById('board').getBoundingClientRect();
      const close=document.getElementById('boardClose'), cr=close.getBoundingClientRect(), hit=document.elementFromPoint(cr.left+cr.width/2,cr.top+cr.height/2);
      return {controls,collisions,sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,
        board:{left:board.left,right:board.right,top:board.top,bottom:board.bottom},closeHit:!!(hit&&hit.closest('#boardClose'))};
    });
    // 真觸控 #boardClose；direct row 的 matched/unmatched 真觸控由 isolated deterministic fixture 負責。
    await page.tap('#boardClose');
    const closed=await page.evaluate(()=>document.getElementById('board').hidden);
    out.push({engine,width,opened,errors,scan,closed});
    await context.close(); await context.__browser.close();
  }
  return out;
}

let legacyChecked = false;
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const width of [360, 375, 414, 768]) {
      const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 812 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await installPage(page);
      if (!legacyChecked) {
        const legacy = await legacyByteCheck(page);
        check(legacy.same, 'official 缺失時 legacy fallback innerHTML byte-exact');
        mutation('legacy fallback 任一文案突變會被 byte 比對抓到', legacy.same,
          legacy.a.replace('接下來的班車', '官方直出') === legacy.b);
        const fallback = await fallbackMatrixCheck(page);
        check(fallback.length === 7 && fallback.every(x => x.same && !x.direct),
          'fallback byte matrix：null／[]／stale／future／time-travel／unknown／純非TRTC', JSON.stringify(fallback));
        const shifts = await renderedShiftCheck(page);
        const stable = JSON.stringify(shifts.prod[0]) === JSON.stringify(shifts.prod[1]) &&
          JSON.stringify(shifts.prod[1]) === JSON.stringify(shifts.prod[2]);
        check(stable, 'DOM 實際 .t／.min／順序在 metroShift -300／0／+300 完全相同');
        mutation('實跑 mutant renderer：官方 DOM 若偷加 metroShift 會變動', stable,
          JSON.stringify(shifts.mutant[0]) === JSON.stringify(shifts.mutant[1]));
        legacyChecked = true;
      }
      const row = await directDomFixture(page, width, engine);
      result.browser.push(row);
      check(row.setup && row.matchedCount === 1 && row.unmatchedCount === 1,
        `${engine} ${width}px：matched／unmatched 同時可見`, `matched=${row.matchedCount}, unmatched=${row.unmatchedCount}, view=${row.setup}`);
      check(row.matchedAction.followed && row.matchedAction.close === 1,
        `${engine} ${width}px：觸控 matched 列可跟隨`);
      check(!row.unmatchedAction.followed && row.unmatchedAction.close === 0 && !row.unmatchedAction.hasLi,
        `${engine} ${width}px：unmatched 誠實不可點、不關板`);
      check(row.generation.down && !row.generation.follow && row.generation.close === 0 && row.generation.gen >= 2,
        `${engine} ${width}px：pointerdown 後 full render 不沿舊 li/ci 跟隨`);
      check(row.hit && row.overflow.sw <= row.overflow.cw && row.overflow.board.left >= -0.5 &&
        row.overflow.board.right <= width + 0.5,
        `${engine} ${width}px：elementFromPoint 可達且無水平溢出`);
      check(row.patch.sameNode && row.patch.freshFull === 0 && row.patch.changed && row.patch.staleFull === 1,
        `${engine} ${width}px：每秒只 patch countdown；超齡才 full render`);
      await context.close();
    }
  } finally { await browser.close(); }
}
mutation('若每秒直接 full render 會被節點 identity／計數抓到',
  result.browser.every(x => x.patch.sameNode && x.patch.freshFull === 0), false);
mutation('若 click fallback 忽略 render generation 會跟到舊班次',
  result.browser.every(x => !x.generation.follow), false);

const fullServer=makeStaticServer();
await new Promise((resolve,reject)=>{fullServer.once('error',reject);fullServer.listen(0,'127.0.0.1',resolve);});
try{
  const port=fullServer.address().port,baseUrl=`http://127.0.0.1:${port}/`;
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
    const rows=await fullAppMatrix(type,engine,baseUrl); result.fullApp=(result.fullApp||[]).concat(rows);
    for(const row of rows){
      check(!!row.opened?.direct && row.errors.length===0,`${engine} ${row.width}px full app：boot／官方直出北捷板無 pageerror`,JSON.stringify({opened:row.opened,errors:row.errors.slice(0,2)}));
      check(row.scan.sw<=row.scan.cw&&row.scan.board.left>=-0.5&&row.scan.board.right<=row.width+0.5,
        `${engine} ${row.width}px full app：無水平溢出、看板在 viewport 內`);
      check(row.scan.closeHit&&row.closed,`${engine} ${row.width}px full app：elementFromPoint 與 page.tap 可操作關閉鈕`);
      // sheet-open 會刻意把底層 controls pointer-events:none；掃描只納入當下可互動控件。
      check(row.scan.collisions.length===0,`${engine} ${row.width}px full app：所有當下可互動控件兩兩無重疊`,JSON.stringify(row.scan.collisions.slice(0,5)));
    }
  }
}finally{await new Promise(resolve=>fullServer.close(resolve));}

result.metrics.assertions = result.assertions.length;
result.metrics.passed = result.assertions.filter(x => x.pass).length;
result.metrics.mutations = result.mutations.length;
result.metrics.mutationsCaught = result.mutations.filter(x => x.caught).length;
result.metrics.browserMatrix = `${result.browser.length}/8`;
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
console.log(`\n斷言 ${result.metrics.passed}/${result.metrics.assertions}；mutation ${result.metrics.mutationsCaught}/${result.metrics.mutations}；browser ${result.metrics.browserMatrix}`);
console.log(`證據：${OUTPUT}`);
process.exitCode = failures ? 1 : 0;
