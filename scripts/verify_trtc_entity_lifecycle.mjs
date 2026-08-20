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

const prelude = `
const BUILD = 'test', window = {}, navigator = {}, state = { lines: [], decoLines: [] };
const document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
function showToast() {}
const _trtcCdDwell = new Map(), _trtcCdDropped = new Map();
const TRTC_BR_DWELL_FALLBACK = 25, TRTC_BR_SAME_TRAIN_RATIO = 1;
const _trtcCdDwellOf = id => _trtcCdDwell.has(id) ? _trtcCdDwell.get(id) : TRTC_BR_DWELL_FALLBACK;
const line = { id: 'Y', stations: Array.from({ length: 5 }, (_, i) => ({ name: 'S' + i, dwell: 25 })), segs: [] };
state.lines = [line];
function _trtcCensusNorm(v) { return String(v || '').trim(); }
function trtcCensusLine(id) { return id === line.id ? line : null; }
function trtcCensusNames(ln) { return ln.stations.map(s => s.name); }
function trtcCensusRun(ln, from, to) { return from === to ? 0 : 75; }
function trtcOfficialDwellAt() { return 25; }
function trtcCountdownFitsSegment() { return true; }
function _trtcBrSharedIdx() { return new Set(); }
function _trtcCdPrefix(id) { return 'mrt:' + id + ':'; }
`;
const expose = `
this.api = { trtcBrVehiclesFromBoard, trtcCensusRestampBr, trtcCdDiagPush,
  snapshot: trtcEntityDiagnosticsSnapshot, frames: _trtcCdDiagFrames, rosters: _trtcCdRosters,
  constants: { grace: TRTC_CD_MISSING_GRACE_SEC, confirm: TRTC_CD_CANDIDATE_CONFIRM_FRAMES } };
`;
const context = vm.createContext({ console, Date, JSON, Math, Map, Set, Number, String, Array,
  Blob, File, URL, setTimeout, clearTimeout });
vm.runInContext(prelude + '\n' + along + '\n' + builder + '\n' + resolver + '\n' + expose, context);
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
const reset = () => { api.rosters.clear(); api.frames.splice(0); };
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
check(rescueAudit.directions.some(d => d.rescued.length === 1), '診斷：記下 bounded-rescue 的配對理由');

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
check(lastResolve().directions.some(d => d.retired.some(x => x.reason === 'missing-expired')),
  '診斷：退場原因記為 missing-expired');

// 4. 舊車前進會撞進新鮮官方車區間時，不再把舊車 arrEpoch 改成 now+1 永久釘站。
reset();
const old = [vehicle({ from: 0, to: 1, dest: 4, arr: 2990, observed: 3000 })];
api.trtcCensusRestampBr('Y', old, 3000, '2026-08-20', true);
const conflict = [vehicle({ from: 1, to: 2, dest: 3, arr: 3075, observed: 3015 })];
api.trtcCensusRestampBr('Y', conflict, 3015, '2026-08-20', true);
const conflictAudit = lastResolve();
check(!conflict.some(v => v.source === 'board-coast'), '衝突退場：被新鮮車擋住的舊車不再卡站');
check(conflictAudit.directions.some(d => d.retired.some(x => x.reason === 'blocked-by-fresh')),
  '診斷：卡站舊車記為 blocked-by-fresh');

// 5. 同方向仍有失聯舊車時，無法接上的新觀測需連續兩輪才出生。
reset();
const activeOld = [vehicle({ from: 0, to: 1, dest: 3, arr: 4060, observed: 4000 })];
api.trtcCensusRestampBr('Y', activeOld, 4000, '2026-08-20', true);
const candidate1 = [vehicle({ from: 3, to: 4, dest: 4, arr: 4050, observed: 4015 })];
api.trtcCensusRestampBr('Y', candidate1, 4015, '2026-08-20', true);
check(candidate1.length === 1 && candidate1[0].source === 'board-coast',
  '候選第一輪：只保留原實體，新觀測暫不另生一台');
check(lastResolve().directions.some(d => d.candidates.some(x => x.action === 'wait')),
  '診斷：候選第一輪記為 wait');
const candidate2 = [vehicle({ from: 3, to: 4, dest: 4, arr: 4065, observed: 4030 })];
api.trtcCensusRestampBr('Y', candidate2, 4030, '2026-08-20', true);
check(candidate2.some(v => v.source === 'board-seg' && v.vehicleId !== 'temp'),
  '候選第二輪：確認為新實體後才出生');
check(lastResolve().directions.some(d => d.births.some(x => x.confirmed === 2)),
  '診斷：新實體記下連續兩輪確認');

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
check(reverseRevised.length === 1 && reverseRevised[0].vehicleId === reverseId &&
  lastResolve().directions.find(d => d.dir === 1)?.rescued.length === 1,
  '反向驗收：里程遞減方向同樣以 bounded-rescue 保住 ID', `id=${reverseId}`);

// 8. 環形紀錄硬上限十分鐘。
api.frames.splice(0);
api.trtcCdDiagPush('test', 'Y', 100, { n: 1 });
api.trtcCdDiagPush('test', 'Y', 701, { n: 2 });
const snap = api.snapshot();
check(snap.windowSec === 600 && snap.frames.length === 1 && snap.frames[0].n === 2,
  '診斷環形紀錄：超過十分鐘的 frame 已淘汰', `frames=${snap.frames.length}`);

console.log(failures ? `\n❌ ${failures} 項未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
