#!/usr/bin/env node
// BR／Y 前端倒數 Entity Resolver 的決定性驗收。直接從 index.html 抽出正式函式，配一條
// 5 站合成線跑跨輪情境；不連正式 API，避免即時班距讓身分／退場判準時綠時紅。
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`抽取錨點不存在：${start} / ${end}`);
  return html.slice(a, b);
};
const builder = between('const _trtcCdArrived = new Map();', '// 🔴 文湖線(BR)的身分與存續:');
const along = between('function _trtcBrAlong(v, nowEpoch) {', '// 文湖線有 4 個與別條線共用的站');
const resolver = between('const _trtcCdRosters = new Map();', 'let _trtcCensusPrior = new Map();');
const coast = between('function trtcOfficialCoastCycle(vehicle, run) {', 'const _trtcCdDropped = new Map();');
const vehiclePosition = between('function trtcOfficialVehiclePosition(ln, vehicle, nowEpoch) {',
  'const _trtcOfficialDisplay = new Map();');

const prelude = `
const BUILD = 'test', window = {}, navigator = {}, state = { lines: [], decoLines: [] };
const document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
function showToast() {}
const _trtcCdDwell = new Map(), _trtcCdDropped = new Map(), _trtcOfficialDisplay = new Map();
const TRTC_BR_DWELL_FALLBACK = 25, TRTC_BR_SAME_TRAIN_RATIO = 1;
const _trtcCdDwellOf = id => _trtcCdDwell.has(id) ? _trtcCdDwell.get(id) : TRTC_BR_DWELL_FALLBACK;
const line = { id: 'Y', stations: Array.from({ length: 5 }, (_, i) =>
  ({ name: 'S' + i, dwell: 25, lat: 0, lon: i / 100, d: i / 20 })), segs: [] };
state.lines = [line];
function _trtcCensusNorm(v) { return String(v || '').trim(); }
function trtcCensusLine(id) { return id === line.id ? line : null; }
function trtcCensusNames(ln) { return ln.stations.map(s => s.name); }
function trtcCensusRun(ln, from, to) { return from === to ? 0 : 75; }
function trtcOfficialDwellAt() { return 25; }
function trtcCountdownFitsSegment() { return true; }
function runBetween(ln, from, to) { return trtcCensusRun(ln, from, to); }
function posBetweenStations(ln, from, to, fraction) {
  const a = ln.stations[from], b = ln.stations[to];
  return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
}
function _trtcBrSharedIdx() { return new Set(); }
function _trtcCdPrefix(id) { return 'mrt:' + id + ':'; }
`;
const expose = `
this.api = { trtcBrVehiclesFromBoard, trtcCensusRestampBr, trtcCdDiagPush,
  position: trtcOfficialVehiclePosition, line,
  snapshot: trtcEntityDiagnosticsSnapshot, frames: _trtcCdDiagFrames, rosters: _trtcCdRosters,
  displays: _trtcOfficialDisplay,
  constants: { grace: TRTC_CD_MISSING_GRACE_SEC, confirm: TRTC_CD_CANDIDATE_CONFIRM_FRAMES } };
`;
const context = vm.createContext({ console, Date, JSON, Math, Map, Set, Number, String, Array,
  Blob, File, URL, setTimeout, clearTimeout });
vm.runInContext(prelude + '\n' + coast + '\n' + vehiclePosition + '\n' + along + '\n' + builder + '\n' +
  resolver + '\n' + expose, context);
const api = context.api;

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
const vehicle = ({ from, to, dest = 4, arr, observed, dir = 2 }) => ({
  vehicleId: 'temp', line: 'Y', dir, dest, from, to, run: 75, arrEpoch: arr,
  terminal: false, officialNo: null, source: 'board-seg', observedEpoch: observed,
  timeline: [{ from, to, depEpoch: arr - 75, arrEpoch: arr, terminal: false }],
});
const reset = () => { api.rosters.clear(); api.frames.splice(0); api.displays.clear(); };
const lastResolve = () => [...api.frames].reverse().find(x => x.kind === 'resolve');

console.log('BR／Y Entity Resolver 驗收：\n');

// 1. 冷啟動有官方證據就出生，不讓確認機制把整條線空白 15 秒。
reset();
const cold = [vehicle({ from: 0, to: 1, arr: 1050, observed: 1000 })];
api.trtcCensusRestampBr('Y', cold, 1000, '2026-08-20', true);
const stableId = cold[0] && cold[0].vehicleId;
check(cold.length === 1 && stableId && stableId !== 'temp', '冷啟動：官方車立即取得穩定 ID', `id=${stableId}`);

// 2. ETA 單輪修訂使位置超出主 DP 容差，但仍在同方向／同終點的一輪可達走廊：沿用舊 ID。
const revised = [vehicle({ from: 1, to: 2, arr: 1060, observed: 1015 })];
api.trtcCensusRestampBr('Y', revised, 1015, '2026-08-20', true);
const rescueAudit = lastResolve();
check(revised.length === 1 && revised[0].vehicleId === stableId,
  '有界救援：ETA 跳動後仍接回同一個 ID、不另生車', `id=${revised[0]?.vehicleId}`);
check(rescueAudit.output.some(x => x.id === stableId),
  '診斷：解析後名冊仍記住同一個 ID');

// 3. 缺訊可短暫續推，但 45 秒仍無官方證據就退場，不留下永久幽靈。
reset();
const missingStart = [vehicle({ from: 1, to: 2, arr: 2010, observed: 2000 })];
api.trtcCensusRestampBr('Y', missingStart, 2000, '2026-08-20', true);
const missingId = missingStart[0].vehicleId;
const grace = [];
api.trtcCensusRestampBr('Y', grace, 2030, '2026-08-20', true);
check(grace.length === 1 && grace[0].vehicleId === missingId && grace[0].source === 'board-coast',
  '有限續推：缺兩輪內保留同一台車', `age=30s count=${grace.length}`);
const expired = [];
api.trtcCensusRestampBr('Y', expired, 2046, '2026-08-20', true);
check(expired.length === 0, '有限退場：缺訊超過 45 秒不再保留舊車');
check(lastResolve().directions.some(d => d.carried.some(x => x.id === missingId && x.dormant)),
  '診斷：畫面退場後短暫保留不可配對墓碑，供生命週期稽核');
const identityExpired = [];
api.trtcCensusRestampBr('Y', identityExpired, 2146, '2026-08-20', true);
check(!api.rosters.get('Y')?.prior.has(missingId) &&
  lastResolve().directions.some(d => d.retired.some(x => x.reason === 'identity-expired')),
  '身分槽有上限：超過一個最慢站間週期仍無觀測就真正刪除');

// 3b. 45 秒後留在名冊裡的是不可見墓碑，只防舊 ID 復活搶車；生命週期已結束，
//     不能把同位置的新鮮官方觀測永遠擋在 near-existing。
reset();
const tombstoneStart = [vehicle({ from: 1, to: 2, arr: 2020, observed: 2000 })];
api.trtcCensusRestampBr('Y', tombstoneStart, 2000, '2026-08-20', true);
const tombstoneId = tombstoneStart[0].vehicleId;
api.trtcCensusRestampBr('Y', [], 2046, '2026-08-20', true);
const returningFresh = [vehicle({ from: 2, to: 3, arr: 2100, observed: 2047 })];
api.trtcCensusRestampBr('Y', returningFresh, 2047, '2026-08-20', true);
check(returningFresh.length === 1 && returningFresh[0].source === 'board-seg' &&
  returningFresh[0].vehicleId !== tombstoneId,
  '失聯墓碑：不阻擋同位置的新鮮觀測立即出生',
  `old=${tombstoneId} fresh=${returningFresh[0]?.vehicleId}`);
check(!lastResolve().directions.some(d => d.candidates.some(x => x.action === 'near-existing')),
  '診斷：超過 45 秒的墓碑不再產生 near-existing 卡候選');

// 4. 連續訊號下，舊車前進會撞進新鮮車區間時只保留不可見 ID 槽位；期限到仍會收，
//    不把兩台畫在同一區間，也不回到永久釘站。
reset();
const old = [vehicle({ from: 0, to: 1, dest: 4, arr: 2990, observed: 3000 })];
api.trtcCensusRestampBr('Y', old, 3000, '2026-08-20', true);
const blockedId = old[0].vehicleId;
const conflict = [vehicle({ from: 1, to: 2, dest: 4, arr: 3020, observed: 3015 })];
api.trtcCensusRestampBr('Y', conflict, 3015, '2026-08-20', true);
const conflictAudit = lastResolve();
check(conflict.some(v => v.vehicleId === blockedId && v.source === 'board-seg') &&
  !conflict.some(v => v.vehicleId === blockedId && v.source === 'board-coast'),
  '身分交接：重疊的新鮮觀測沿用舊 ID，不另畫 coast 車或讓跟隨換號');
check(conflictAudit.output.filter(x => x.id === blockedId).length === 1,
  '診斷：交接後名冊只保留一個舊 ID 槽位');

// 4b. 兩個都已跨批存在且活躍的 ID，即使短暫靠近也禁止互換／合併。
//     只有 dormant 舊槽或本格剛出生的臨時 ID 可隱藏；真實前後車可能短暫接近。
reset();
const existing = [
  vehicle({ from: 0, to: 1, dest: 4, arr: 3150, observed: 3100 }),
  vehicle({ from: 3, to: 4, dest: 4, arr: 3150, observed: 3100 }),
];
api.trtcCensusRestampBr('Y', existing, 3100, '2026-08-20', true);
const olderId = existing[0].vehicleId, newerId = existing[1].vehicleId;
api.displays.set(`Y|${olderId}`, { progress: 2, epoch: 3100 });
api.displays.set(`Y|${newerId}`, { progress: 2.1, epoch: 3100 });
const converged = [
  vehicle({ from: 0, to: 1, dest: 4, arr: 3165, observed: 3115 }),
  vehicle({ from: 3, to: 4, dest: 4, arr: 3165, observed: 3115 }),
];
api.trtcCensusRestampBr('Y', converged, 3115, '2026-08-20', true);
check(converged.length === 2 && converged.some(v => v.vehicleId === olderId) &&
  converged.some(v => v.vehicleId === newerId),
  '既有活躍 ID：100m 內仍各自保留，禁止互換／合併',
  `ids=${converged.map(v => v.vehicleId).join(',')}`);
check(!lastResolve().directions.some(d => d.retired.some(x =>
  [olderId, newerId].includes(x.id) && x.reason === 'fresh-overlap')),
  '診斷：兩個成立過的活躍 ID 不產生 fresh-overlap 合併');

// 5. 同方向仍有失聯舊車時，無法接上的新觀測需連續兩輪才出生。
reset();
const activeOld = [vehicle({ from: 2, to: 3, dest: 4, arr: 4060, observed: 4000 })];
api.trtcCensusRestampBr('Y', activeOld, 4000, '2026-08-20', true);
const candidate1 = [vehicle({ from: 0, to: 1, dest: 4, arr: 4090, observed: 4015 })];
api.trtcCensusRestampBr('Y', candidate1, 4015, '2026-08-20', true);
check(candidate1.length === 1 && candidate1[0].source === 'board-coast',
  '候選第一輪：只保留原實體，新觀測暫不另生一台');
check(lastResolve().directions.some(d => d.candidates.some(x => x.action === 'wait')),
  '診斷：候選第一輪記為 wait');
const candidate2 = [vehicle({ from: 0, to: 1, dest: 4, arr: 4105, observed: 4030 })];
api.trtcCensusRestampBr('Y', candidate2, 4030, '2026-08-20', true);
check(candidate2.some(v => v.source === 'board-seg' && v.vehicleId !== 'temp'),
  '候選第二輪：確認為新實體後才出生');
check(lastResolve().directions.some(d => d.births.some(x => x.confirmed === 2)),
  '診斷：新實體記下連續兩輪確認');

// 5b. 同一批官方倒數已明確形成同 from→to 的兩個分離位置，就是同路段兩班的直接證據；
//     若仍各等一輪，短倒數那班會白白少 15 秒、之後兩倍速也追不到站。
reset();
const peerDistances = api.line.stations.map(st => st.d);
api.line.stations.forEach((st, i) => { st.d = i; });
const peerBlocker = [vehicle({ from: 0, to: 1, dest: 4, arr: 5075, observed: 5000 })];
api.trtcCensusRestampBr('Y', peerBlocker, 5000, '2026-08-20', true);
const sameSegment = [
  vehicle({ from: 2, to: 3, dest: 4, arr: 5080, observed: 5050 }),
  vehicle({ from: 2, to: 3, dest: 4, arr: 5140, observed: 5050 }),
];
api.trtcCensusRestampBr('Y', sameSegment, 5050, '2026-08-20', true);
check(sameSegment.filter(v => v.source === 'board-seg').length === 2,
  '同路段雙車：兩個相隔四分之一段以上的官方觀測第一輪都出生');
api.line.stations.forEach((st, i) => { st.d = peerDistances[i]; });

// 6. 使用上游觀測時戳，超過 60 秒的舊列不再被當成剛看到的新車。
reset();
const freshBoard = [{ name: 'S1', dest: 'S4', eta: 5050, at: 4990, no: '' }];
const fresh = api.trtcBrVehiclesFromBoard('Y', freshBoard, 5000, '2026-08-20');
check(fresh?.length === 1 && fresh[0].observedEpoch === 4990,
  '新鮮度：合成車沿用官方 observedEpoch，不拿抓取當下冒充', `observed=${fresh?.[0]?.observedEpoch}`);
const stale = api.trtcBrVehiclesFromBoard('Y', [{ ...freshBoard[0], at: 4939 }], 5000, '2026-08-20');
check(stale === null, '新鮮度：資料齡超過 60 秒不生車');
check([...api.frames].reverse().find(x => x.kind === 'observe')?.rows.some(x => x.reason === 'stale'),
  '診斷：過期列保留為 stale 證據');

// 7. 同一套保序與可達走廊也要涵蓋里程遞減方向。
reset();
const reverseCold = [vehicle({ from: 4, to: 3, dest: 0, arr: 6050, observed: 6000, dir: 1 })];
api.trtcCensusRestampBr('Y', reverseCold, 6000, '2026-08-20', true);
const reverseId = reverseCold[0].vehicleId;
const reverseRevised = [vehicle({ from: 3, to: 2, dest: 0, arr: 6060, observed: 6015, dir: 1 })];
api.trtcCensusRestampBr('Y', reverseRevised, 6015, '2026-08-20', true);
check(reverseRevised.some(v => v.vehicleId === reverseId && v.source === 'board-coast') &&
  !reverseRevised.some(v => v.source === 'board-seg'),
  '反向驗收：單輪跨整站的觀測不得搬動舊 ID，原槽位繼續有限保留', `id=${reverseId}`);

// 8. 最後一段不受固定 45 秒提前收車：保留到已知終點 arrEpoch，到點即收。
for (const dir of [1, 2]) {
  reset();
  const last = dir === 2
    ? [vehicle({ from: 3, to: 4, dest: 4, arr: 7120, observed: 7000, dir })]
    : [vehicle({ from: 1, to: 0, dest: 0, arr: 7120, observed: 7000, dir })];
  api.trtcCensusRestampBr('Y', last, 7000, '2026-08-20', true);
  const id = last[0].vehicleId, beforeArrival = [];
  api.trtcCensusRestampBr('Y', beforeArrival, 7060, '2026-08-20', true);
  check(beforeArrival.some(v => v.vehicleId === id),
    `終點退場：${dir === 2 ? '里程遞增' : '里程遞減'}方向超過 45 秒仍保留`, `until=7120`);
  const arrived = [];
  api.trtcCensusRestampBr('Y', arrived, 7121, '2026-08-20', true);
  check(!arrived.some(v => v.vehicleId === id),
    `終點退場：${dir === 2 ? '里程遞增' : '里程遞減'}方向到站後立即收車`);
}

// 9. Y 起點允許在一個停站窗內提前出現，但只能在「倒數=該段行車秒」時發車。
reset();
const predeparture = api.trtcBrVehiclesFromBoard('Y',
  [{ name: 'S1', dest: 'S4', eta: 8095, at: 8000, no: '' }], 8000, '2026-08-20');
const waiting = predeparture && api.position(api.line, predeparture[0], 8019);
const departed = predeparture && api.position(api.line, predeparture[0], 8021);
check(waiting?.atStation && waiting.lon === api.line.stations[0].lon,
  'Y 起點：可提前出現，發車時刻前仍在月台');
check(departed && !departed.atStation && departed.lon > api.line.stations[0].lon,
  'Y 起點：倒數縮到區間行車秒後才出發');

// 9b. 路線起點自己的倒數列沒有「前一站」，舊版 flush 直接丟掉，造成動物園看板歸零時
//     畫面只剩第二段的舊車可被誤認。最後 20 秒應另立月台實體，且不可借用已在前方的 ID。
reset();
const tooEarlyOrigin = api.trtcBrVehiclesFromBoard('Y',
  [{ name: 'S0', dest: 'S4', eta: 9021, at: 9000, no: '' }], 9000, '2026-08-20');
check(!tooEarlyOrigin || !tooEarlyOrigin.length, '起點列：超過 20 秒不提早畫成在線車');
const origin = api.trtcBrVehiclesFromBoard('Y',
  [{ name: 'S0', dest: 'S4', eta: 9020, at: 9000, no: '' }], 9000, '2026-08-20');
check(origin?.length === 1 && origin[0].originDeparture && origin[0].depEpoch === 9020,
  '起點列：最後 20 秒建立月台實體，倒數歸零才發車');
const oldAhead = [vehicle({ from: 1, to: 2, dest: 4, arr: 9060, observed: 9000 })];
api.trtcCensusRestampBr('Y', oldAhead, 9000, '2026-08-20', true);
const aheadId = oldAhead[0].vehicleId;
const originNow = api.trtcBrVehiclesFromBoard('Y',
  [{ name: 'S0', dest: 'S4', eta: 9015, at: 9005, no: '' }], 9005, '2026-08-20');
api.trtcCensusRestampBr('Y', originNow, 9005, '2026-08-20', true);
check(originNow.some(v => v.originDeparture && v.vehicleId !== aheadId),
  '起點拓撲：月台新車不借用已離開第一段的舊 ID',
  `ahead=${aheadId} origin=${originNow.find(v => v.originDeparture)?.vehicleId}`);

// 10. 環形紀錄硬上限十分鐘。
api.frames.splice(0);
api.trtcCdDiagPush('test', 'Y', 100, { n: 1 });
api.trtcCdDiagPush('test', 'Y', 701, { n: 2 });
const snap = api.snapshot();
check(snap.windowSec === 600 && snap.frames.length === 1 && snap.frames[0].n === 2,
  '診斷環形紀錄：超過十分鐘的 frame 已淘汰', `frames=${snap.frames.length}`);

console.log(failures ? `\n❌ ${failures} 項未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
