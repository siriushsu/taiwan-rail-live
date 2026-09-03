#!/usr/bin/env node
// 北捷官方名冊前端驗收：直接抽 index.html 產品函式，另跑 Chromium/WebKit 手機真畫格。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const INDEX = fs.readFileSync(INDEX_PATH, 'utf8');
let failures = 0;

function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0, mode = 'code', escaped = false;
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
  throw new Error(`function ${name} 未閉合`);
}

function extractConst(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
  if (!match) throw new Error(`找不到 const ${name}`);
  return match[0];
}

function replaceExactly(source, before, after, label) {
  const pieces = source.split(before);
  if (pieces.length !== 2) throw new Error(`${label} mutation anchor 應恰好一處，實際 ${pieces.length - 1}`);
  return pieces[0] + after + pieces[1];
}

const UNIT_FUNCTIONS = [
  'trtcOfficialRosterEnabled', 'trtcOfficialRosterActive', 'trtcOfficialRosterForLine',
  'trtcOfficialCoastCycle', 'trtcOfficialCoastByCycle', 'trtcOfficialCoastPosition',
  'trtcOfficialDeparturePosition',
  'trtcOfficialTimelinePosition', 'trtcOfficialVehiclePosition', 'trtcOfficialPositionProgress',
  'trtcOfficialMotionStep', 'trtcOfficialPositionAtProgress', 'trtcOfficialSegmentSeconds', 'trtcOfficialForwardLimit', 'trtcOfficialDwellAt',
  'trtcOfficialArrivalTarget', 'trtcOfficialDwellUntil', 'trtcOfficialStopState',
  'trtcOfficialDirectionPrevious', 'trtcOfficialDirectionAnchor',
  'trtcCdTrackDisplayOverlap', 'trtcOfficialDisplaySet',
  'trtcOfficialDisplayPosition', 'trtcOfficialVehicleInfo',
  'trtcOfficialRenderItems', 'trtcOfficialVehicleGlyph', 'trtcOfficialSameTarget', 'dirAngOf',
  // 契約 5/6(2026-08-18):跨車順序與最小間距。放進同一個 bundle,否則 renderItems 會 ReferenceError。
  'trtcGapUnitsAt', 'trtcOfficialSeparate',
];

function buildUnitApi(overrides = {}, label = 'unit') {
  const sourceOf = name => overrides[name] || extractFunction(INDEX, name);
  const bundle = `
    ${sourceOf('trtcOfficialRosterEnabled')}
    ${extractConst(INDEX, 'OFFICIAL_ROSTER_ENABLED')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_DWELL_MIN_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_DWELL_DEFAULT_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_COAST_DWELL_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_RESYNC_MIN_COAST_SEC')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_CATCHUP_FACTOR')}
    ${extractConst(INDEX, 'TRTC_OFFICIAL_SNAP_FORWARD_M')}
    ${extractConst(INDEX, 'TRTC_RESYNC_TOAST_SETTLE_SEC')}
    ${extractConst(INDEX, '_trtcOfficialCorrect')}
    ${extractConst(INDEX, '_trtcOfficialResync')}
    ${extractConst(INDEX, '_trtcOfficialDisplay')}
    ${extractConst(INDEX, 'TRTC_MIN_GAP_KM')}
    ${extractFunction(INDEX, 'runBetween')}
    ${extractFunction(INDEX, 'posAlongShape')}
    ${extractFunction(INDEX, 'posBetweenStations')}
    ${extractFunction(INDEX, 'trtcServiceSec')}
    ${UNIT_FUNCTIONS.filter(name => name !== 'trtcOfficialRosterEnabled').map(sourceOf).join('\n')}
    globalThis.__api = { ${UNIT_FUNCTIONS.join(',')}, displayCache:_trtcOfficialDisplay,
      catchupFactor: TRTC_OFFICIAL_CATCHUP_FACTOR };
  `;
  const context = { URLSearchParams, location: { search: '?officialroster=1' }, Date, Math, Number,
    String, Array, Map, Set };
  vm.createContext(context);
  vm.runInContext(bundle, context, { filename: `${label}.product.js` });
  return context.__api;
}

function unitLine(id = 'L', count = 10, run = 60) {
  return { id, abbr:id, hasShape: false,
    stations: Array.from({ length: count }, (_, i) => ({ name: `${id}${i}`, lat: 25 + i / 100, lon: 121 + i / 100 })),
    segs: Array.from({ length: count - 1 }, () => ({ run })) };
}

const LINE = unitLine();
const XBT = unitLine('G_XBT', 2, 120);
const INGEST_LINE = unitLine('BL', 23, 60);
const timelineVehicle = {
  vehicleId: 'timeline', line: 'L', dir: 2, dest: 4, from: 0, to: 1, run: 60,
  arrEpoch: 1060, officialNo: '201', terminal: false, coastCycle: 80, retireEpoch: 1340,
  timeline: [
    { from: 0, to: 0, depEpoch: 1000, arrEpoch: 1000, terminal: true },
    { from: 0, to: 1, depEpoch: 1000, arrEpoch: 1060, terminal: false },
    { from: 1, to: 2, depEpoch: 1090, arrEpoch: 1170, terminal: false },
    { from: 2, to: 3, depEpoch: 1195, arrEpoch: 1250, terminal: false },
    { from: 3, to: 4, depEpoch: 1270, arrEpoch: 1340, terminal: false },
  ],
};
const reverseVehicle = {
  ...timelineVehicle, vehicleId: 'reverse', dir: 1, dest: 0, from: 4, to: 3,
  timeline: [
    { from: 4, to: 4, depEpoch: 1000, arrEpoch: 1000, terminal: true },
    { from: 4, to: 3, depEpoch: 1000, arrEpoch: 1060, terminal: false },
    { from: 3, to: 2, depEpoch: 1080, arrEpoch: 1140, terminal: false },
    { from: 2, to: 1, depEpoch: 1160, arrEpoch: 1220, terminal: false },
    { from: 1, to: 0, depEpoch: 1240, arrEpoch: 1300, terminal: false },
  ],
};
const xbtVehicle = { vehicleId: 'xbt', line: 'G_XBT', dir: 2, dest: 1, from: 0, to: 0,
  run: 0, arrEpoch: 2000, officialNo: '', terminal: true, departureRun: 120, coastCycle: 145,
  retireEpoch: 2120, timeline: [{ from: 0, to: 0, depEpoch: 2000, arrEpoch: 2000, terminal: true }] };
const coastVehicle = { vehicleId: 'coast', line: 'L', dir: 2, dest: 9, from: 0, to: 1,
  run: 80, arrEpoch: 3000, officialNo: '', terminal: false,
  history: [{ to: 0, arrEpoch: 2900 }, { to: 1, arrEpoch: 3000 }] };
const board = { feedMode: 'official', sourceRevision: 1000, vehicles: [timelineVehicle,
  { ...timelineVehicle, vehicleId: 'anonymous', officialNo: '' }, xbtVehicle] };

function evaluateUnit(api) {
  const sameStation = (pos, line, index) => !!pos && pos.lat === line.stations[index].lat &&
    pos.lon === line.stations[index].lon;
  // 官方往前修訂時「要漸進靠過去、不准瞬移」的上限。原本寫死 .51／.6，那是照一倍站間速度
  // 算出來的常數；追趕倍率一改就整組假紅（2026-08-18 改成 2 倍即如此）。改成從 fixture 的
  // 區間秒數(run=60)與產品常數推導，倍率再變也跟著走；另外獨立保留「fraction < 1」＝
  // 沒有直接瞬移到官方修訂後的位置，那一條與倍率無關，是這組斷言真正的牙。
  const easeCap = seconds => api.catchupFactor * seconds / 60;
  const active = api.trtcOfficialRosterActive;
  // 🔴 2026-08-17 使用者裁示：北捷列車位置暫時改用班表 ⇒ 官方名冊【出貨預設關閉】,
  //    只有 ?officialroster=1 才開。兩側都驗：關的那側必須真的關,開的那側必須真的開。
  //    位置邏輯修好要開回來時,這裡跟 index.html 那行一起改,不會有一邊改一邊沒改。
  // 🔴 2026-08-18 使用者裁示：北捷位置回到官方即時 ⇒ 預設【開】。兩側都要驗，只驗開的那側
  // 會讓「乾脆永遠回 true、逃生口失效」也全綠（judgment 心得 39(b)）。
  const A = api.trtcOfficialRosterEnabled('') && api.trtcOfficialRosterEnabled('?officialroster=1') &&
    !api.trtcOfficialRosterEnabled('?officialroster=0') && !api.trtcOfficialRosterEnabled('?census=0') &&
    active(board, true, 100000) &&
    !active({ ...board, feedMode: 'outage' }, true, 1000) && !active(board, false, 1000);

  const before = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 990);
  const half = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 1030);
  const at1 = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 1060);
  const dwell = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 1070);
  const at2 = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 1170);
  const reverseHalf = api.trtcOfficialVehiclePosition(LINE, reverseVehicle, 1030);
  const terminal = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 1340);
  const info = api.trtcOfficialVehicleInfo(LINE, timelineVehicle, 1090);
  api.displayCache.clear();
  const shown = api.trtcOfficialDisplayPosition(LINE, timelineVehicle, 1030);
  const revisedBack = { ...timelineVehicle, timeline:[
    { from:0,to:1,depEpoch:1000,arrEpoch:1150,terminal:false } ] };
  const held = api.trtcOfficialDisplayPosition(LINE, revisedBack, 1030.1);
  const heldAgain = api.trtcOfficialDisplayPosition(LINE, revisedBack, 1030.1);
  api.displayCache.clear();
  const beforeLongFrame = api.trtcOfficialDisplayPosition(LINE, timelineVehicle, 1030);
  const afterLongFrame = api.trtcOfficialDisplayPosition(LINE, revisedBack, 1036);
  api.displayCache.clear();
  api.trtcOfficialDisplayPosition(LINE, timelineVehicle, 1030);
  const revisedForward = { ...timelineVehicle, timeline:[
    { from:0,to:1,depEpoch:1000,arrEpoch:1035,terminal:false } ] };
  const eased = api.trtcOfficialDisplayPosition(LINE, revisedForward, 1030.2);
  const deadlineShown = api.trtcOfficialDisplayPosition(LINE, revisedForward, 1035);
  api.displayCache.clear();
  api.trtcOfficialDisplayPosition(LINE, reverseVehicle, 1030);
  const reverseRevisedForward = { ...reverseVehicle, timeline:[
    { from:4,to:3,depEpoch:1000,arrEpoch:1035,terminal:false } ] };
  const reverseEased = api.trtcOfficialDisplayPosition(LINE, reverseRevisedForward, 1030.2);
  const reverseDeadlineShown = api.trtcOfficialDisplayPosition(LINE, reverseRevisedForward, 1035);
  // 🔴 契約 3「跑過頭的停下來等、絕不倒退」——2026-08-19 補:整組 B gate 原本沒有任何情境
  // 讓目標站落在顯示位置**後方**(所有情境的官方修訂都只改時刻、不改目標站),於是「位置跟著
  // 倒退」的突變無論怎麼寫都攔不到。這裡直接種一個已經開過頭的顯示狀態。
  api.displayCache.clear();
  const overshootSeed = api.trtcOfficialVehiclePosition(LINE, timelineVehicle, 1030);
  api.displayCache.set(`${LINE.id}|${timelineVehicle.vehicleId}`,
    { epoch: 1030, progress: 1.5, pos: api.trtcOfficialPositionAtProgress(LINE, timelineVehicle, 1.5, overshootSeed),
      coasted: false, coastSince: null });
  const overshot = api.trtcOfficialDisplayPosition(LINE, timelineVehicle, 1031);
  const overshotProgress = overshot ? api.trtcOfficialPositionProgress(LINE, timelineVehicle, overshot) : null;
  api.displayCache.clear();
  const B = overshotProgress === 1.5 && sameStation(before, LINE, 0) && half && Math.abs(half.fraction - .5) < 1e-9 &&
    sameStation(at1, LINE, 1) && at1.atStation && sameStation(dwell, LINE, 1) &&
    sameStation(at2, LINE, 2) && reverseHalf && Math.abs(reverseHalf.fraction - .5) < 1e-9 &&
    terminal === null && info.pos && info.nextName === 'L2' && Number.isFinite(info.nextSec) &&
    // ETA 被往後修(1060→1150)⇒ 車不准倒退,但也不該凍住:照新模型它會放慢,慢慢開向同一站。
    // 上界取「照修訂後的速度走這段時間該走多遠」的兩倍,超過就是沒有真的放慢。
    shown && held && held.fraction >= shown.fraction - 1e-9 &&
      held.fraction <= shown.fraction + 2 * (1 - shown.fraction) * (0.1 / (1150 - 1030)) + 1e-9 &&
      held.coastArrEpoch === 1150 &&
    heldAgain && heldAgain.lat === held.lat && heldAgain.lon === held.lon && heldAgain.coastArrEpoch === 1150 &&
    beforeLongFrame && afterLongFrame && afterLongFrame.fraction >= beforeLongFrame.fraction - 1e-9 &&
      afterLongFrame.fraction <= beforeLongFrame.fraction +
        2 * (1 - beforeLongFrame.fraction) * (6 / (1150 - 1030)) + 1e-9 &&
    eased && eased.fraction > .5 && eased.fraction <= .5 + easeCap(.2) + 1e-9 &&
    deadlineShown && deadlineShown.fraction > eased.fraction &&
      deadlineShown.fraction <= eased.fraction + easeCap(4.8) + 1e-9 && deadlineShown.fraction < 1 &&
    reverseEased && reverseEased.fraction > .5 && reverseEased.fraction <= .5 + easeCap(.2) + 1e-9 &&
    reverseDeadlineShown && reverseDeadlineShown.fraction > reverseEased.fraction &&
      reverseDeadlineShown.fraction <= reverseEased.fraction + easeCap(4.8) + 1e-9 &&
      reverseDeadlineShown.fraction < 1;

  const rendered = api.trtcOfficialRenderItems(LINE, board, 1030, true) || [];
  const numbered = rendered.find(item => item.vehicleId === 'timeline');
  const anonymous = rendered.find(item => item.vehicleId === 'anonymous');
  const numberedGlyph = api.trtcOfficialVehicleGlyph(numbered?.officialNo, LINE.abbr);
  const anonymousGlyph = api.trtcOfficialVehicleGlyph(anonymous?.officialNo, LINE.abbr);
  const C = rendered.length === 2 && numberedGlyph.kind === 'tag' && numberedGlyph.label === '201' &&
    numberedGlyph.official === true && anonymousGlyph.kind === 'tag' && anonymousGlyph.label === 'L' &&
    anonymousGlyph.official === false;

  const xBefore = api.trtcOfficialVehiclePosition(XBT, xbtVehicle, 1990);
  const xHalf = api.trtcOfficialVehiclePosition(XBT, xbtVehicle, 2060);
  const xDone = api.trtcOfficialVehiclePosition(XBT, xbtVehicle, 2120);
  const D = sameStation(xBefore, XBT, 0) && xHalf && Math.abs(xHalf.fraction - .5) < 1e-9 && xDone === null;

  const E = api.trtcOfficialSameTarget({ lineId: 'L', vehicleId: 'timeline' },
    { ln: LINE, vehicleId: 'timeline' }) &&
    !api.trtcOfficialSameTarget({ lineId: 'OTHER', vehicleId: 'timeline' },
      { ln: LINE, vehicleId: 'timeline' }) &&
    !api.trtcOfficialSameTarget({ lineId: 'L', vehicleId: 'timeline' },
      { ln: LINE, vehicleId: 'anonymous' });

  const long = api.trtcOfficialVehiclePosition(LINE, coastVehicle, 3660);
  const done = api.trtcOfficialVehiclePosition(LINE, coastVehicle, 3800);
  const reverseCoast = api.trtcOfficialVehiclePosition(LINE,
    { ...coastVehicle, vehicleId: 'coast-r', dir: 1, dest: 0, from: 9, to: 8 }, 3660);
  // 續推節奏＝「該線每段自己的固定行車秒 ＋ 固定停站秒」，與這台車自己的 history 無關
  //（2026-08-15 斷訊修正）。期望站號直接從契約推導，不寫死——寫死的話下次調停站秒
  // 又會變成一個會被推翻的魔術數字（心得 35）。
  const coastDwell = Number(extractConst(INDEX, 'TRTC_OFFICIAL_COAST_DWELL_SEC').match(/=\s*(\d+)/)[1]);
  const coastCycleSec = 60 + coastDwell;            // unitLine 的固定段秒是 60
  const legsDone = Math.floor((3660 - coastVehicle.arrEpoch) / coastCycleSec);
  const hereIdx = coastVehicle.to + legsDone;
  const G = long && long.lat > LINE.stations[hereIdx].lat && long.lat < LINE.stations[hereIdx + 1].lat &&
    done === null && reverseCoast && reverseCoast.lat < LINE.stations[2].lat;
  // 錄影重現：位置明確走 0→1／4→3，但身分 dir 故意放成相反方向。箭頭必須信這一幀
  // 的實際 motionFrom→motionTo，不能再被落後一輪的 dir 或上一段 EMA 帶反。
  const wrongDirForward = { ...timelineVehicle, dir:1 };
  const wrongDirReverse = { ...reverseVehicle, dir:2 };
  const forwardPrevious = api.trtcOfficialDirectionPrevious(LINE, wrongDirForward, half);
  const reversePrevious = api.trtcOfficialDirectionPrevious(LINE, wrongDirReverse, reverseHalf);
  const projection = { worldPx:([lat, lon]) => ({ x:lon * 37, y:-lat * 29 }) };
  const cp = { x:100, y:80 };
  const forwardAnchor = api.trtcOfficialDirectionAnchor(projection, cp, half, forwardPrevious);
  const reverseAnchor = api.trtcOfficialDirectionAnchor(projection, cp, reverseHalf, reversePrevious);
  const anchorLength = anchor => anchor && Math.hypot(cp.x - anchor.x, cp.y - anchor.y);
  const officialDraw = extractFunction(INDEX, 'drawTrtcOfficialVehicle');
  const I = forwardPrevious && reversePrevious && forwardAnchor && reverseAnchor &&
    forwardPrevious.lat < half.lat && reversePrevious.lat > reverseHalf.lat &&
    api.trtcOfficialPositionProgress(LINE, wrongDirForward, forwardPrevious) <
      api.trtcOfficialPositionProgress(LINE, wrongDirForward, half) &&
    api.trtcOfficialPositionProgress(LINE, wrongDirReverse, reversePrevious) <
      api.trtcOfficialPositionProgress(LINE, wrongDirReverse, reverseHalf) &&
    Math.abs(anchorLength(forwardAnchor) - 8) < 1e-9 &&
    Math.abs(anchorLength(reverseAnchor) - 8) < 1e-9 &&
    officialDraw.includes('trtcOfficialDirectionAnchor(M, cp, item.pos, previous)') &&
    officialDraw.includes('Math.atan2(cp.y - cpB.y, cp.x - cpB.x)') &&
    !officialDraw.includes('dirAngOf(') && !officialDraw.includes('M.toScreen([previous.lat');

  const stale = { _dirAng:0 }, turnCp = { x:0, y:0 }, turnBehind = { x:1, y:-10 };
  const rawTurn = Math.atan2(10, -1), snapped = api.dirAngOf(stale, turnCp, turnBehind);
  const gentle = { _dirAng:0 }, gentleRaw = Math.PI / 4;
  const smoothed = api.dirAngOf(gentle, turnCp, { x:-10, y:-10 });
  const J = Math.abs(snapped - rawTurn) < 1e-12 && smoothed > 0 && smoothed < gentleRaw &&
    Math.cos(snapped - rawTurn) > 0;
  return { A, B, C, D, E, G, I, J };
}

function buildIngestApi(holdOverride = null, label = 'ingest') {
  const holdSource = holdOverride || extractFunction(INDEX, 'trtcOfficialRosterHold');
  const bundle = `
    const OFFICIAL_ROSTER_ENABLED = true;
    ${extractConst(INDEX, 'TRTC_BOARD_LINES')}
    ${extractConst(INDEX, '_trtcOfficialDisplay')}
    ${extractConst(INDEX, 'TRTC_MIN_GAP_KM')}
    const state = { systems:[{id:'mrt',data:{lines:globalThis.__lines}}], lines:[], decoLines:[],
      trtcOfficialRoster:null, trtcOfficialRosterRevisionHighWater:null, freqFollow:null };
    function clearFreqFollow(){ state.freqFollow = null; }
    function showToast(){}
    ${extractFunction(INDEX, 'trtcOfficialRosterGeometryLine')}
    ${extractFunction(INDEX, 'trtcOfficialRosterPayloadValid')}
    ${extractFunction(INDEX, 'trtcOfficialRosterOutage')}
    // 🔴 2026-08-18 補:這支腳本在 origin/main 上就已經整個拋 ReferenceError 中止
    // (applyTrtcOfficialRoster 會呼叫 trtcOfficialRosterRepairRun,但它從沒被放進這個 bundle)。
    // 症狀與「跑過且全過」幾乎同形——A~J 單元閘門照印綠字,只有最後才炸,很容易被當成環境問題。
    // 同族見 memory metro-shift-drags-trains-backwards 第三節(五支量畫面座標的 verify 全死在 import)。
    ${extractFunction(INDEX, 'trtcOfficialRosterRepairRun')}
    ${holdSource}
    ${extractFunction(INDEX, 'applyTrtcOfficialRoster')}
    globalThis.__api={state,apply:applyTrtcOfficialRoster};
  `;
  const context = { __lines: [INGEST_LINE, XBT], Date, Math, Number, String, Array, Set };
  vm.createContext(context);
  vm.runInContext(bundle, context, { filename: `${label}.product.js` });
  return context.__api;
}

function ingestAudit(holdOverride = null) {
  const api = buildIngestApi(holdOverride);
  const ingestVehicle = { ...timelineVehicle, line:'BL' };
  const valid = { feedMode: 'official', sourceRevision: 100, at: 100, vehicles: [ingestVehicle] };
  const accepted = api.apply(structuredClone(valid));
  const roster = api.state.trtcOfficialRoster;
  const regressed = !api.apply({ ...structuredClone(valid), sourceRevision: 99 }) &&
    api.state.trtcOfficialRoster === roster;
  const malformed = !api.apply({ ...structuredClone(valid), sourceRevision: 101,
    vehicles: [{ ...ingestVehicle, to: 99 }] }) && api.state.trtcOfficialRoster === roster;
  const outage = !api.apply({ feedMode: 'outage', sourceRevision: 102, vehicles: [] }) &&
    api.state.trtcOfficialRoster === roster;
  return accepted && regressed && malformed && outage && api.state.trtcOfficialRosterRevisionHighWater === 100;
}

function sourceHoldAudit() {
  const apply = extractFunction(INDEX, 'applyTrtcOfficialRoster');
  const poll = extractFunction(INDEX, 'pollTrtcLive');
  const holdReasons = ['feed-outage', 'malformed', 'source-revision-regressed'];
  const pollReasons = ['fetch-error', 'missing-boardPos', 'frontend-apply-error'];
  return holdReasons.every(reason => apply.includes(`trtcOfficialRosterHold('${reason}')`)) &&
    pollReasons.every(reason => poll.includes(`trtcOfficialRosterHold('${reason}')`)) &&
    poll.includes("trtcOfficialRosterOutage('time-travel')");
}

console.log('【產品真函式】');
const baselineApi = buildUnitApi();
const baseline = evaluateUnit(baselineApi);
for (const [gate, pass] of Object.entries(baseline)) check(pass, `${gate} gate`);
check(ingestAudit() && sourceHoldAudit(), 'H gate：失敗、畸形、舊版本都保留既有名冊；只有時光機退回班表');

// K gate：使用者裁示第 4 條「跑慢的就追上去」。
// 🔴 這一條只有在「官方位置也在以站間速度前進」時才驗得出來——官方靜止的話連一倍速都會收斂，
// 那種情境全綠也證明不了任何事（2026-08-18 早尖峰實測 BR 有車恆定落後 877m 連 4 次取樣一公尺沒縮，
// 就是因為兩邊同速）。所以下面讓官方與顯示都跟著時間走，只有追趕倍率 >1 才可能收斂。
{
  const api = buildUnitApi({}, 'catchup');
  const veh = { ...timelineVehicle, timeline: [{ from: 0, to: 1, depEpoch: 1000, arrEpoch: 1060, terminal: false }] };
  // 種一個「落後官方 0.3 個站距」的顯示狀態(產品裡是由斷訊續推/名冊修訂造成的)
  // 顯示層停在起點(progress 0)、官方此刻已走到 1/3 ⇒ 起始落後約 0.32 個站距。
  api.displayCache.set(`${LINE.id}|${veh.vehicleId}`,
    { epoch: 1020, progress: 0, pos: api.trtcOfficialVehiclePosition(LINE, veh, 1000), coasted: false, coastSince: null });
  const gaps = [];
  let arrived = null;
  for (let t = 1021; t <= 1060; t++) {
    const shown = api.trtcOfficialDisplayPosition(LINE, veh, t);
    const official = api.trtcOfficialVehiclePosition(LINE, veh, t);
    if (!shown || !official) { gaps.push(NaN); continue; }
    gaps.push(Number((official.fraction - shown.fraction).toFixed(6)));
    arrived = shown;
  }
  const first = gaps[0], last = gaps[gaps.length - 1];
  const monotonic = gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 1e-9);
  // 🔴 判準是**結果**不是機制:落後的車要在「官方說的到站時刻」出現在那一站上(1060 是官方 arrEpoch)。
  // 舊判準寫的是「30 秒內收斂到官方的瞬時位置」——那是舊棘輪+兩倍速追趕的形狀,不是使用者的要求;
  // 使用者要的是「站牌時間完全照官方,車依那個時間到站」(08-07 裁示)。
  const converged = !!arrived && arrived.atStation === true &&
    arrived.lat === LINE.stations[1].lat && arrived.lon === LINE.stations[1].lon;
  const noOvershoot = gaps.every(g => g >= -1e-9);   // 追趕不准超過官方位置
  check(first > .3 && monotonic && converged && noOvershoot,
    `K gate：落後的車準時到站（起始落後 ${first}、到站時刻在站上 ${converged}、單調收斂 ${monotonic}、零超越 ${noOvershoot}）`);
  // 控制組：把追趕倍率壓回 1（＝改動前的行為），同一情境必須**追不上**，否則這條判準沒有牙
  const oneX = extractFunction(INDEX, 'trtcOfficialDisplayPosition')
    .replace('dt * TRTC_OFFICIAL_CATCHUP_FACTOR', 'dt');
  const api1 = buildUnitApi({ trtcOfficialDisplayPosition: oneX }, 'catchup-control');
  api1.displayCache.set(`${LINE.id}|${veh.vehicleId}`,
    { epoch: 1020, progress: 0, pos: api1.trtcOfficialVehiclePosition(LINE, veh, 1000), coasted: false, coastSince: null });
  let ctlGap = null;
  for (let t = 1021; t <= 1060; t++) {
    const shown = api1.trtcOfficialDisplayPosition(LINE, veh, t);
    const official = api1.trtcOfficialVehiclePosition(LINE, veh, t);
    if (shown && official) ctlGap = Number((official.fraction - shown.fraction).toFixed(6));
  }
  check(ctlGap != null && ctlGap > .3 - 1e-6,
    `K gate 控制組：倍率 1 時追不上（30 秒後仍落後 ${ctlGap}）`);
}

const forbidden = ['TRTC_OFFICIAL_COAST_MAX_SEC', 'TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC',
  'OFFICIAL_CARRY_MAX_SEC', 'unmatchedPriorExited'];
check(forbidden.every(value => !INDEX.includes(value)), '錯誤的時間刪車／配不到刪車識別字已從前端清除');

const mutations = [];
async function mutation(label, expectedGate, name, before, after) {
  try {
    const original = extractFunction(INDEX, name);
    const api = buildUnitApi({ [name]: replaceExactly(original, before, after, label) }, label);
    const observed = evaluateUnit(api);
    const pass = baseline[expectedGate] && !observed[expectedGate];
    mutations.push(pass); check(pass, `${label} 被 ${expectedGate} gate 攔下`);
  } catch (error) { mutations.push(false); check(false, `${label} mutation 可執行`, String(error.message || error)); }
}

await mutation('加入 30 秒資料齡到期', 'A', 'trtcOfficialRosterActive',
  'Number.isFinite(now) && Number.isFinite(revision)',
  'Number.isFinite(now) && Number.isFinite(revision) && now - revision <= 30');
await mutation('忽略官方多站 timeline', 'B', 'trtcOfficialVehiclePosition',
  'if (timeline.handled) return timeline.pos;', 'if (false) return timeline.pos;');
await mutation('終點站仍停著不退場', 'B', 'trtcOfficialTimelinePosition',
  'if (destination && now >= destination.arrEpoch) return { handled: true, pos: null };',
  'if (false) return { handled: true, pos: null };');
await mutation('ETA 回修時位置跟著倒退', 'B', 'trtcOfficialDisplayPosition',
  'plan && plan.progress > prior.progress + 1e-9 &&', 'plan &&');
await mutation('同一畫格第二個讀者繞過防倒退', 'B', 'trtcOfficialDisplayPosition',
  'if (!prior || now < prior.epoch) {',
  'if (!prior || now <= prior.epoch) {');
await mutation('畫面停頓超過五秒就退回修訂後方', 'B', 'trtcOfficialDisplayPosition',
  'if (!prior || now < prior.epoch) {',
  'if (!prior || now < prior.epoch || now - prior.epoch > 5) {');
await mutation('拿掉物理上限,deadline 一到就瞬移到站', 'B', 'trtcOfficialDisplayPosition',
  `    shown = Math.min(prior.progress + (plan.progress - prior.progress) * ratio,
      trtcOfficialForwardLimit(ln, vehicle, prior.progress, dt * TRTC_OFFICIAL_CATCHUP_FACTOR));`,
  '    shown = prior.progress + (plan.progress - prior.progress) * ratio;');
await mutation('續推超過任意秒數就消失', 'G', 'trtcOfficialCoastPosition',
  'const elapsed = now - arrEpoch;', 'const elapsed = now - arrEpoch;\n  if (elapsed > 600) return null;');
await mutation('移除 XBT 單段 fallback', 'D', 'trtcOfficialDeparturePosition',
  'const departureRun = Number.isFinite(explicit) && explicit > 0 ? explicit : runBetween(ln, origin, next);',
  'const departureRun = Number.isFinite(explicit) && explicit > 0 ? null : runBetween(ln, origin, next);');
await mutation('無官方車次就不畫', 'C', 'trtcOfficialRenderItems',
  '.filter(item => item.vehicleId && item.pos);',
  '.filter(item => item.vehicleId && item.pos && item.officialNo);');
await mutation('無官方車次就把橢圓牌降成圓點', 'C', 'trtcOfficialVehicleGlyph',
  "const official = String(officialNo || ''), fallback = String(lineAbbr || '');",
  "const official = String(officialNo || ''), fallback = '';");
await mutation('vehicleId 相同就忽略路線', 'E', 'trtcOfficialSameTarget',
  "String(followLine || '') === String(hitLine || '')",
  "String(followLine || '') === String(followLine || '')");
await mutation('官方箭頭改指向路線前方而不是後方', 'I', 'trtcOfficialDirectionPrevious',
  'progress - delta, pos', 'progress + delta, pos');
await mutation('官方箭頭重新只信可能落後的 dir', 'I', 'trtcOfficialMotionStep',
  'if (Number.isInteger(from) && Number.isInteger(to) && from !== to) return Math.sign(to - from);',
  'if (Number.isInteger(from) && Number.isInteger(to) && from !== to) return Number(vehicle && vehicle.dir) === 2 ? 1 : -1;');
await mutation('箭頭向量重新受目前倍率像素大小影響', 'I', 'trtcOfficialDirectionAnchor',
  'const scale = 8 / distance;', 'const scale = 0.01;');
await mutation('共用箭頭在轉彎後仍慢慢朝車尾平滑', 'J', 'dirAngOf',
  'ang = Math.cos(d) <= 0 ? raw : ang + d * 0.08;',
  'ang = Math.abs(d) > 2.1 ? raw : ang + d * 0.08;');

const holdOriginal = extractFunction(INDEX, 'trtcOfficialRosterHold');
const holdMutant = replaceExactly(holdOriginal,
  'state.trtcOfficialRosterHold = { reason, epoch: Date.now() / 1000 };',
  "state.trtcOfficialRoster = { feedMode:'outage', vehicles:[] };", 'hold-outage');
check(!ingestAudit(holdMutant), '讀取失敗清空名冊 mutation 被 H gate 攔下');

function makeServer() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/thsr-schedule')
        return res.end(fs.readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
      if (url.pathname === '/api/trtc-live') {
        const now = Date.now() / 1000;
        const vehicles = [
          { vehicleId:'browser-number',line:'BL',dir:2,dest:22,from:0,to:1,run:60,arrEpoch:now+30,
            officialNo:'201',terminal:false,retireEpoch:null,timeline:[{from:0,to:1,depEpoch:now-30,arrEpoch:now+30,terminal:false}] },
          { vehicleId:'browser-anon',line:'BL',dir:1,dest:0,from:22,to:21,run:60,arrEpoch:now+30,
            officialNo:null,terminal:false,retireEpoch:null,timeline:[{from:22,to:21,depEpoch:now-30,arrEpoch:now+30,terminal:false}] },
          { vehicleId:'browser-second',line:'R',dir:2,dest:26,from:0,to:1,run:80,arrEpoch:now+40,
            officialNo:'101',terminal:false,retireEpoch:null,timeline:[{from:0,to:1,depEpoch:now-40,arrEpoch:now+40,terminal:false}] },
          { vehicleId:'browser-xbt',line:'G_XBT',dir:2,dest:1,from:0,to:0,run:0,arrEpoch:now+300,
            officialNo:null,terminal:true,departureRun:120,coastCycle:145,retireEpoch:now+420,
            timeline:[{from:0,to:0,depEpoch:now+300,arrEpoch:now+300,terminal:true}] },
        ];
        return res.end(JSON.stringify({ src:'trtc', board:[], boardPos:{ at:now, sourceRevision:now,
          feedMode:'official', rows:[], trips:[], extensions:[], vehicles } }));
      }
      return res.end('{}');
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!path.resolve(file).startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
}

async function browserMatrix(baseUrl) {
  const results = [];
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [360, 375, 414, 768]) {
        const context = await browser.newContext({ viewport:{ width, height:width === 768 ? 1024 : 812 },
          isMobile:true, hasTouch:true, deviceScaleFactor:1, locale:'zh-TW', timezoneId:'Asia/Taipei' });
        await context.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(String(error.message || error)));
        await page.goto(`${baseUrl}?officialroster=1`, { waitUntil:'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout:60000 });
        await page.waitForFunction(() => state.trtcOfficialRoster?.feedMode === 'official', null, { timeout:30000 });
        const deadline = await page.evaluate(async () => {
          const liveVehicle = state.trtcOfficialRoster.vehicles.find(item => item.vehicleId === 'browser-number');
          // 用獨立 ID 測試，避免地圖自己的 draw() 同時以正式路線段秒更新同一 display cache。
          const vehicle = { ...liveVehicle, vehicleId:'browser-deadline-test' };
          const pools = [...(state.lines || []), ...(state.decoLines || [])];
          const line = pools.find(item => item.id === 'BL');
          const motionLine = { ...line, segs:line.segs.map((segment, index) =>
            index === 0 ? { ...segment, run:.14 } : segment) };
          const now = Date.now() / 1000, arrEpoch = now + .14;
          vehicle.from = 0; vehicle.to = 1; vehicle.dest = 22; vehicle.run = .14; vehicle.arrEpoch = arrEpoch;
          vehicle.timeline = [{ from:0, to:1, depEpoch:now, arrEpoch, terminal:false }];
          _trtcOfficialDisplay.delete(`${line.id}|${vehicle.vehicleId}`);
          let before = null, after = null, previous = -1, monotonic = true;
          await new Promise(resolve => {
            const sample = () => {
              const epoch = Date.now() / 1000, pos = trtcOfficialDisplayPosition(motionLine, vehicle, epoch);
              if (pos && pos.fraction < previous - 1e-9) monotonic = false;
              if (pos) previous = pos.fraction;
              if (epoch < arrEpoch) before = pos && pos.fraction;
              else { after = { fraction:pos && pos.fraction, exact:!!pos &&
                pos.lat === line.stations[1].lat && pos.lon === line.stations[1].lon }; resolve(); return; }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          const rendered = [...new Map(pools.filter(isTrtcBoardLine).map(line => [line.id, line])).values()]
            .reduce((sum, line) => sum + (trtcOfficialRenderItems(line, state.trtcOfficialRoster,
              Date.now() / 1000, true) || []).length, 0);
          const brLine = pools.find(item => item.id === 'BR');
          const oldTag = drawTag, oldDot = drawDot, oldArrow = drawArrowAt, tagLabels = [];
          let dotCalls = 0, directionAngles = [], directionErrors = [];
          try {
            drawTag = (_point, label) => tagLabels.push(label);
            drawDot = () => { dotCalls++; };
            drawArrowAt = (_point, angle) => { directionAngles.push(angle); };
            drawTrtcOfficialVehicle(brLine, {
              pos:{ lat:brLine.stations[0].lat, lon:brLine.stations[0].lon },
              officialNo:'', vehicleId:'browser-br-fallback', vehicle:{ dir:2 }
            }, true, () => true, false, Date.now() / 1000);
            const fallbackLabels = [...tagLabels], fallbackDots = dotCalls;
            // 直接用錄影中的 BR 萬芳醫院(3)↔辛亥(4)實際幾何跑兩個方向，並故意把 dir
            // 都寫反。箭頭只能服從本畫格 motionFrom→motionTo，兩向都不可被身分欄位帶反。
            for (const [from, to, wrongDir, id] of [[3,4,1,'north'], [4,3,2,'south']]) {
              const directionPos = { ...posBetweenStations(brLine, from, to, .5),
                fraction:.5, motionFrom:from, motionTo:to, coastTo:to, atStation:false };
              const directionVehicle = { vehicleId:`browser-direction-${id}`, dir:wrongDir, from, to };
              drawTrtcOfficialVehicle(brLine, { pos:directionPos, officialNo:'',
                vehicleId:directionVehicle.vehicleId, vehicle:directionVehicle },
              true, () => true, false, Date.now() / 1000);
              const directionPrevious = trtcOfficialDirectionPrevious(brLine, directionVehicle, directionPos);
              const projectedNow = window.__map.project([directionPos.lat, directionPos.lon], 18);
              const projectedBefore = window.__map.project([directionPrevious.lat, directionPrevious.lon], 18);
              const expected = Math.atan2(projectedNow.y - projectedBefore.y,
                projectedNow.x - projectedBefore.x);
              const directionAngle = directionAngles[directionAngles.length - 1];
              let delta = Number(directionAngle) - expected;
              while (delta > Math.PI) delta -= 2 * Math.PI;
              while (delta < -Math.PI) delta += 2 * Math.PI;
              directionErrors.push(Math.abs(delta));
            }
            tagLabels.splice(0, tagLabels.length, ...fallbackLabels); dotCalls = fallbackDots;
          } finally { drawTag = oldTag; drawDot = oldDot; drawArrowAt = oldArrow; }
          return { before, after, monotonic, rendered, roster:state.trtcOfficialRoster.vehicles.length,
            fallbackTag:{ tagLabels, dotCalls, halfWidth:trtcOfficialTagHalfWidth('BR'),
              directionAngles, directionErrors, zoom:window.__map.getZoom() } };
        });
        const tapTarget = await page.evaluate(() => [...document.querySelectorAll('button[id],a[id],[role=button][id]')]
          .find(element => { const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
              style.pointerEvents !== 'none' && rect.width > 8 && rect.height > 8; })?.id || null);
        if (!tapTarget) throw new Error('找不到可見的手機觸控目標');
        await page.tap(`#${tapTarget}`);
        // 點擊可能打開 sheet／抽屜；重載回預設態後再做全控件碰撞掃描。
        // 🔴 不可用 page.reload()：開機時 clearFollow() 的 replaceState 會把 query string 整條抹掉
        //    （實測 location.search 開機後即為 ''），reload 等於重載成「沒有旗標」的那一版。
        //    官方名冊 2026-08-17 起出貨預設關閉，旗標一掉這裡就永遠等不到 feedMode==='official'。
        await page.goto(`${baseUrl}?officialroster=1`, { waitUntil:'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout:60000 });
        await page.waitForFunction(() => state.trtcOfficialRoster?.feedMode === 'official', null, { timeout:30000 });
        const layout = await page.evaluate(() => {
          const visible = element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
              style.pointerEvents !== 'none' && Number(style.opacity) > .02 && rect.width > 1 && rect.height > 1;
          };
          const nodes = [...new Set(document.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[role=button],.toolbtn,.toggle'))]
            .filter(visible);
          const records = nodes.map((element, index) => {
            const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2,
              rect.top + rect.height / 2);
            return { id:element.id || element.getAttribute('aria-label') || `${element.tagName}-${index}`,
              left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
              hit:!!(hit && (hit === element || element.contains(hit))) };
          });
          const collisions = [];
          for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
            if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
            const a = records[i], b = records[j];
            if (Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left)) > 1 &&
                Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) > 1)
              collisions.push([a.id,b.id]);
          }
          return { misses:records.filter(item => !item.hit).map(item => item.id), collisions,
            scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth };
        });
        results.push({ engine:name, width, errors, deadline, layout, tapTarget });
        await context.close();
      }
    } finally { await browser.close(); }
  }
  return results;
}

console.log('\n【Chromium／WebKit 手機矩陣】');
const server = makeServer();
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const rows = await browserMatrix(`http://127.0.0.1:${server.address().port}/`);
  for (const result of rows) {
    check(result.errors.length === 0 && result.deadline.roster === 4 && result.deadline.rendered === 4 &&
      result.deadline.before < 1 && result.deadline.after?.fraction === 1 && result.deadline.after.exact &&
      result.deadline.monotonic && result.deadline.fallbackTag?.tagLabels?.join(',') === 'BR' &&
      result.deadline.fallbackTag.dotCalls === 0 && result.deadline.fallbackTag.halfWidth > 6 &&
      result.deadline.fallbackTag.directionAngles.length === 2 &&
      result.deadline.fallbackTag.directionErrors.length === 2 &&
      result.deadline.fallbackTag.directionErrors.every(error => error < 1e-9),
    `${result.engine} ${result.width}px：4/4 車可畫、BR 橢圓牌、萬芳醫院↔辛亥兩向箭頭正向、真 rAF 準時到站、位置單調、零 pageerror`,
    JSON.stringify({ errors:result.errors.slice(0,2), deadline:result.deadline }));
    check(result.layout.scrollWidth <= result.layout.clientWidth && !result.layout.misses.length &&
      !result.layout.collisions.length,
    `${result.engine} ${result.width}px：真觸控 tools、零水平溢出、控件可命中且不相交`,
    JSON.stringify(result.layout));
  }
  check(rows.length === 8, '手機矩陣覆蓋 2 引擎 × 360/375/414/768');
} catch (error) {
  failures++;
  console.error(`❌ 手機矩陣無法執行：${error.stack || error}`);
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

console.log(`\n${failures ? `FAIL ${failures}` : 'PASS'}：official roster frontend；` +
  `unit ${Object.values(baseline).filter(Boolean).length}/${Object.keys(baseline).length}；` +
  `mutation ${mutations.filter(Boolean).length + (ingestAudit(holdMutant) ? 0 : 1)}/${mutations.length + 1}`);
if (failures) process.exit(1);
