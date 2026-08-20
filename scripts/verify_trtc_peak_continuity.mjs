#!/usr/bin/env node
// 2026-08-20 尖峰實測回歸：官方 15/30 秒刷新不能讓車整段前跳，也不能把車凍在舊位置。
// 直接抽 index.html 的產品函式進 VM，避免測試另寫一套動畫公式而集體失明。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
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

const DEPS = ['runBetween', 'posAlongShape', 'posBetweenStations', 'trtcServiceSec',
  'trtcOfficialCoastCycle', 'trtcOfficialCoastByCycle', 'trtcOfficialCoastPosition',
  'trtcOfficialDeparturePosition', 'trtcOfficialTimelinePosition', 'trtcOfficialVehiclePosition',
  'trtcOfficialMotionStep', 'trtcOfficialPositionProgress', 'trtcOfficialPositionAtProgress',
  'trtcOfficialSegmentSeconds', 'trtcOfficialForwardLimit', 'trtcOfficialDwellAt',
  'trtcOfficialArrivalTarget', 'trtcOfficialDwellUntil', 'trtcOfficialStopState',
  'trtcCdTrackDisplayOverlap', 'trtcOfficialDisplaySet', 'trtcOfficialDisplayPosition',
  'trtcGapUnitsAt'];
const CONSTS = ['TRTC_OFFICIAL_COAST_DWELL_MIN_SEC', 'TRTC_OFFICIAL_COAST_DWELL_DEFAULT_SEC',
  'TRTC_OFFICIAL_COAST_DWELL_SEC', 'TRTC_OFFICIAL_RESYNC_MIN_COAST_SEC',
  'TRTC_OFFICIAL_CATCHUP_FACTOR', 'TRTC_OFFICIAL_SNAP_FORWARD_M',
  'TRTC_RESYNC_TOAST_SETTLE_SEC', '_trtcOfficialCorrect', '_trtcOfficialResync',
  '_trtcOfficialDisplay', 'TRTC_MIN_GAP_KM'];
const bundle = `
  ${CONSTS.map(n => extractConst(INDEX, n)).join('\n')}
  ${DEPS.map(n => extractFunction(INDEX, n)).join('\n')}
  globalThis.__api = { trtcOfficialDisplayPosition, trtcOfficialPositionProgress,
    display: _trtcOfficialDisplay };
`;
const ctx = { Date, Math, Number, String, Array, Map, Set, isFinite, parseFloat };
vm.createContext(ctx);
vm.runInContext(bundle, ctx, { filename: 'peak-continuity.product.js' });
const A = ctx.__api;

// 每段 1 公里、60 秒；兩個方向都要驗，避免有號 progress 只顧到遞增方向。
const LINE = { id: 'L', abbr: 'L', hasShape: false,
  stations: Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, lat: 25 + i * 0.009, lon: 121, d: i })),
  segs: Array.from({ length: 3 }, () => ({ run: 60 })) };
const vehicle = (id, dir, from, to, depEpoch, arrEpoch, observedEpoch = 900) => ({
  vehicleId: id, line: 'L', dir, from, to, run: 60, depEpoch, arrEpoch, observedEpoch,
  dest: dir === 2 ? 3 : 0,
});
const progress = (v, p) => A.trtcOfficialPositionProgress(LINE, v, p);

console.log('\n【1】ETA 刷新成已過期：不得把剩餘路段一格吃完');
for (const [dir, from, to] of [[2, 0, 1], [1, 3, 2]]) {
  const id = `expired-${dir}`;
  const first = vehicle(id, dir, from, to, 970, 1030);
  const p0 = progress(first, A.trtcOfficialDisplayPosition(LINE, first, 1000));
  const revised = vehicle(id, dir, from, to, 939, 999, 1000);
  const p1 = progress(revised, A.trtcOfficialDisplayPosition(LINE, revised, 1000.5));
  const advance = p1 - p0;
  ok(`方向 ${dir} 仍往前`, advance > 0, `advance=${advance}`);
  ok(`方向 ${dir} 單格不超過 2× 追趕上限`, advance <= 2 * 0.5 / 60 + 1e-9,
    `advance=${advance.toFixed(6)}`);
}

console.log('\n【2】官方刷新位置落在顯示水位後：不倒退，也不原地停一輪');
for (const [dir, from, to] of [[2, 1, 2], [1, 2, 1]]) {
  const id = `behind-${dir}`;
  const first = vehicle(id, dir, from, to, 940, 1000);
  const p0 = progress(first, A.trtcOfficialDisplayPosition(LINE, first, 988));
  // 新 ETA 大幅後延，原始時間軸會落到舊顯示位置後方；畫面只能平滑降速，不能倒退或凍住。
  const revised = vehicle(id, dir, from, to, 980, 1100, 1000);
  const p1 = progress(revised, A.trtcOfficialDisplayPosition(LINE, revised, 989));
  const advance = p1 - p0;
  ok(`方向 ${dir} 不倒退`, advance >= 0, `advance=${advance}`);
  ok(`方向 ${dir} 至少維持半速`, advance >= 0.5 / 60 - 1e-9,
    `advance=${advance.toFixed(6)}`);
  ok(`方向 ${dir} 不超過 2× 追趕上限`, advance <= 2 / 60 + 1e-9,
    `advance=${advance.toFixed(6)}`);
}

console.log(`\n尖峰連續性：${pass} 通過、${fail} 失敗`);
if (fail) process.exit(1);
