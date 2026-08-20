#!/usr/bin/env node
// 契約 5/6 驗收（2026-08-18 使用者裁示）：「不會有超車的情況，兩列車之間也不能黏在一起」。
// 直接抽 index.html 的產品函式進 VM 跑，不用替身重寫一份（判準與實作同源會集體失明）。
// 用法：node scripts/verify_trtc_separation.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

function extractFunction(source, name) {
  const head = `function ${name}(`;
  const start = source.indexOf(head);
  if (start < 0) throw new Error(`找不到函式 ${name}`);
  let i = source.indexOf('{', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`函式 ${name} 沒有收尾`);
}
function extractConst(source, name) {
  const m = source.match(new RegExp(`^const ${name} = .*?;$`, 'm'));
  if (!m) throw new Error(`找不到常數 ${name}`);
  return m[0];
}

// 🔴 bundle 要含**真實入口** trtcOfficialRenderItems 與它整條下游,不能只抽 trtcOfficialSeparate。
// 2026-08-18 的實際教訓:只單獨呼叫 separate、items 用手工造的,10/10 全綠;但產品裡 renderItems
// 會先跑 trtcOfficialDisplayPosition,那個函式每條路徑都把本格 progress 寫進 _trtcOfficialDisplay,
// separate 之後才讀就變成「底線＝本格位置」⇒ 恆 no-op。判準必須走產品的呼叫順序才照得到。
const DEPS = ['trtcOfficialRosterEnabled', 'trtcOfficialRosterActive', 'trtcOfficialRosterForLine',
  'runBetween', 'posAlongShape', 'posBetweenStations', 'trtcServiceSec',
  'trtcOfficialCoastCycle', 'trtcOfficialCoastByCycle', 'trtcOfficialCoastPosition',
  'trtcOfficialDeparturePosition', 'trtcOfficialTimelinePosition', 'trtcOfficialVehiclePosition',
  'trtcOfficialMotionStep', 'trtcOfficialPositionProgress', 'trtcOfficialPositionAtProgress',
  'trtcOfficialSegmentSeconds', 'trtcOfficialForwardLimit', 'trtcOfficialDwellAt',
  'trtcOfficialArrivalTarget', 'trtcOfficialDwellUntil', 'trtcOfficialStopState',
  'trtcCdTrackDisplayOverlap', 'trtcOfficialDisplaySet', 'trtcOfficialDisplayPosition',
  'trtcGapUnitsAt', 'trtcOfficialSeparate', 'trtcOfficialRenderItems'];
const CONSTS = ['OFFICIAL_ROSTER_ENABLED', 'TRTC_OFFICIAL_COAST_DWELL_MIN_SEC',
  'TRTC_OFFICIAL_COAST_DWELL_DEFAULT_SEC', 'TRTC_OFFICIAL_COAST_DWELL_SEC',
  'TRTC_OFFICIAL_RESYNC_MIN_COAST_SEC', 'TRTC_OFFICIAL_CATCHUP_FACTOR',
  'TRTC_OFFICIAL_SNAP_FORWARD_M', 'TRTC_RESYNC_TOAST_SETTLE_SEC',
  '_trtcOfficialCorrect', '_trtcOfficialResync', '_trtcOfficialDisplay',
  'TRTC_MIN_GAP_KM'];

function api(mutate = s => s) {
  const bundle = mutate(`
    ${extractFunction(INDEX, 'trtcOfficialRosterEnabled')}
    ${CONSTS.map(n => extractConst(INDEX, n)).join('\n')}
    ${DEPS.filter(n => n !== 'trtcOfficialRosterEnabled').map(n => extractFunction(INDEX, n)).join('\n')}
    globalThis.__api = { ${DEPS.join(',')}, display: _trtcOfficialDisplay };
  `);
  const ctx = { Date, Math, Number, String, Array, Map, Set, isFinite, parseFloat,
    URLSearchParams, location: { search: '?officialroster=1' } };
  vm.createContext(ctx);
  vm.runInContext(bundle, ctx, { filename: 'separation.product.js' });
  return ctx.__api;
}

// 一條 10 站的直線，每站間隔 1 公里（d 單位為公里，與 data/trtc.json 一致）、每區間 60 秒
const LINE = { id: 'L', abbr: 'L', hasShape: false,
  stations: Array.from({ length: 10 }, (_, i) => ({
    name: `S${i}`, lat: 25 + i * 0.01, lon: 121, d: i * 1.0 })),
  segs: Array.from({ length: 9 }, () => ({ run: 60 })) };
const veh = (id, dir, from, to) => ({ vehicleId: id, line: 'L', dir, from, to, dest: dir === 2 ? 9 : 0 });
const posAt = (from, to, fraction) => ({
  lat: LINE.stations[from].lat + (LINE.stations[to].lat - LINE.stations[from].lat) * fraction,
  lon: 121, fraction, atStation: false, motionFrom: from, motionTo: to });

console.log('\n【0】間距換算自檢（100 公尺 ÷ 1 公里區間 = 0.1 站序單位）');
{
  const A = api();
  const g = A.trtcGapUnitsAt(LINE, 3.5, 1);
  ok('gapUnits ≈ 0.1', Math.abs(g - 0.1) < 1e-9, String(g));
}

console.log('\n【1】兩台車貼在一起（相距 0.02 站序 = 20 公尺）⇒ 後車被推開到 100 公尺');
{
  const A = api();
  const items = [
    { vehicleId: 'lead', vehicle: veh('lead', 2, 3, 4), pos: posAt(3, 4, 0.52) },
    { vehicleId: 'back', vehicle: veh('back', 2, 3, 4), pos: posAt(3, 4, 0.50) },
  ];
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const p = out.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  const gap = Math.abs(p[0] - p[1]);
  ok('分離後間距 ≥ 0.1 站序（100 公尺）', gap >= 0.1 - 1e-9, `實得 ${gap.toFixed(4)}`);
  ok('前車沒被動到', Math.abs(p[0] - 3.52) < 1e-9, String(p[0]));
  ok('動的是後車', p[1] < 3.50 + 1e-9, String(p[1]));
}

console.log('\n【2】🔴 契約 3：後車已經畫到某位置時不准被往回拉');
{
  // 底線走 item.floor（renderItems 在寫快取之前抓的「上一格位置」）。
  // 2026-08-18 前是在 separate 裡才讀 _trtcOfficialDisplay，那時快取已被本格覆蓋 ⇒ 恆 no-op。
  // 端到端的同一條契約由第 8 條「第二格後車不倒退」覆蓋。
  const A = api();
  const items = [
    { vehicleId: 'lead', vehicle: veh('lead', 2, 3, 4), pos: posAt(3, 4, 0.52) },
    { vehicleId: 'back', vehicle: veh('back', 2, 3, 4), pos: posAt(3, 4, 0.50), floor: 3.50 },
  ];
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const pb = A.trtcOfficialPositionProgress(LINE, out[1].vehicle, out[1].pos);
  ok('後車維持在已畫到的 3.50，不被拉回 3.42', Math.abs(pb - 3.50) < 1e-9, String(pb));
}

console.log('\n【3】間距本來就夠 ⇒ 一台都不動（不可無故位移）');
{
  const A = api();
  const items = [
    { vehicleId: 'lead', vehicle: veh('lead', 2, 6, 7), pos: posAt(6, 7, 0.5) },
    { vehicleId: 'back', vehicle: veh('back', 2, 3, 4), pos: posAt(3, 4, 0.5) },
  ];
  const before = items.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const after = out.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  ok('兩台位置皆不變', before.every((b, i) => Math.abs(b - after[i]) < 1e-12),
    `${before} → ${after}`);
}

console.log('\n【4】方向 1（站序遞減）也要生效 — 心得 4：有序資料必驗兩個方向');
{
  const A = api();
  const items = [
    { vehicleId: 'lead', vehicle: veh('lead', 1, 5, 4), pos: posAt(5, 4, 0.52) },
    { vehicleId: 'back', vehicle: veh('back', 1, 5, 4), pos: posAt(5, 4, 0.50) },
  ];
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const p = out.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  ok('dir1 分離後間距 ≥ 0.1', Math.abs(p[0] - p[1]) >= 0.1 - 1e-9,
    `${p[0].toFixed(4)} vs ${p[1].toFixed(4)}`);
}

console.log('\n【5】對向兩台車靠很近不算疊車（交會是正常的，不准被推開）');
{
  const A = api();
  const items = [
    { vehicleId: 'up', vehicle: veh('up', 2, 3, 4), pos: posAt(3, 4, 0.50) },
    { vehicleId: 'down', vehicle: veh('down', 1, 4, 3), pos: posAt(4, 3, 0.50) },
  ];
  const before = items.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const after = out.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  ok('對向兩台都不動', before.every((b, i) => Math.abs(b - after[i]) < 1e-12));
}

console.log('\n【6】三台連續擠在一起 ⇒ 逐一撐開，兩兩都達標');
{
  const A = api();
  const items = [0.54, 0.52, 0.50].map((f, i) =>
    ({ vehicleId: `v${i}`, vehicle: veh(`v${i}`, 2, 3, 4), pos: posAt(3, 4, f) }));
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const p = out.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos))
    .sort((a, b) => b - a);
  ok('相鄰兩兩間距皆 ≥ 0.1', p.every((v, i) => i === 0 || (p[i - 1] - v) >= 0.1 - 1e-9),
    p.map(x => x.toFixed(4)).join(' '));
}

console.log('\n【7】🔴 突變對照：把最小間距設成 0，上面第 1 條就該紅（證明判準有牙）');
{
  const A = api(src => src.replace(/const TRTC_MIN_GAP_KM = [\d.]+;/, 'const TRTC_MIN_GAP_KM = 0;'));
  const items = [
    { vehicleId: 'lead', vehicle: veh('lead', 2, 3, 4), pos: posAt(3, 4, 0.52) },
    { vehicleId: 'back', vehicle: veh('back', 2, 3, 4), pos: posAt(3, 4, 0.50) },
  ];
  const out = A.trtcOfficialSeparate(LINE, items, 1000);
  const p = out.map(it => A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos));
  ok('間距設 0 後兩車仍黏著（0.02）⇒ 第 1 條測的是真的分離行為',
    Math.abs(p[0] - p[1]) < 0.1, `實得 ${Math.abs(p[0] - p[1]).toFixed(4)}`);
}

// ── 以下走產品真實入口 trtcOfficialRenderItems（上面第 1–7 條是手工造 items 的單元測試）──
const boardOf = vehicles => ({ feedMode: 'official', sourceRevision: 1, vehicles });
// 兩台同區間同向的車：lead 還有 30 秒到 S4、back 還有 28 秒到「S3→S4」⇒ back 反而更前面…
// 不是：兩台都跑 3→4，arrEpoch 越小代表越靠近 S4。lead 30 秒、back 32 秒 ⇒ 相距僅 2 秒＝
// 0.0333 站序＝33 公尺，遠低於 100 公尺門檻，必須被撐開。
const T = 1_700_000_000;
const pairAt = t => boardOf([
  { vehicleId: 'lead', line: 'L', dir: 2, dest: 9, from: 3, to: 4, run: 60, arrEpoch: t + 30 },
  { vehicleId: 'back', line: 'L', dir: 2, dest: 9, from: 3, to: 4, run: 60, arrEpoch: t + 32 },
]);
const progressesAt = (A, t) => {
  const items = A.trtcOfficialRenderItems(LINE, pairAt(T), t, true) || [];
  return items.map(it => ({ id: it.vehicleId,
    p: A.trtcOfficialPositionProgress(LINE, it.vehicle, it.pos) }));
};

console.log('\n【8】🔴 回歸：走產品呼叫順序（renderItems→displayPosition→separate）也必須真的撐開');
{
  const A = api();
  const f1 = progressesAt(A, T);
  ok('第一格畫出兩台', f1.length === 2, JSON.stringify(f1));
  const gap1 = Math.abs(f1[0].p - f1[1].p);
  ok('第一格間距 ≥ 0.1 站序（100 公尺）', gap1 >= 0.1 - 1e-9,
    `實得 ${gap1.toFixed(4)}（未修版是 0.0333＝分離整個 no-op）`);
  // 第二格：確認撐開沒有變成「畫面倒退」——後車的 progress 只能往前
  const backF1 = f1.find(x => x.id === 'back').p;
  const f2 = progressesAt(A, T + 10);
  const backF2 = f2.find(x => x.id === 'back').p;
  ok('第二格後車不倒退（契約 3）', backF2 >= backF1 - 1e-9, `${backF1.toFixed(4)} → ${backF2.toFixed(4)}`);
  const gap2 = Math.abs(f2[0].p - f2[1].p);
  ok('第二格仍維持間距 ≥ 0.1', gap2 >= 0.1 - 1e-9, `實得 ${gap2.toFixed(4)}`);
}

console.log('\n【9】🔴 突變對照：把底線改回「分離時才讀快取」（= 出貨當下的錯法）⇒ 第 8 條必須紅');
{
  const A = api(src => {
    const before = 'const floor = Number(back.it.floor);';
    if (!src.includes(before)) throw new Error('突變錨點不存在——實作已改，這條要跟著改');
    return src.replace(before,
      'const floor = Number((_trtcOfficialDisplay.get(`${ln.id}|${back.it.vehicleId}`) || {}).progress);');
  });
  const f1 = progressesAt(A, T);
  const gap = Math.abs(f1[0].p - f1[1].p);
  ok('錯法下間距 < 0.1（證明第 8 條測的是真的行為，不是恆真）', gap < 0.1 - 1e-9,
    `實得 ${gap.toFixed(4)}`);
}

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (!pass) { console.error('🔴 零斷言＝沒驗'); process.exit(3); }
process.exit(fail ? 1 : 0);
