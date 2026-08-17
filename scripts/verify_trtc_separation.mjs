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

function api(mutate = s => s) {
  const bundle = mutate(`
    ${extractConst(INDEX, 'TRTC_MIN_GAP_KM')}
    ${extractConst(INDEX, '_trtcOfficialDisplay')}
    ${extractFunction(INDEX, 'posAlongShape')}
    ${extractFunction(INDEX, 'posBetweenStations')}
    ${extractFunction(INDEX, 'trtcOfficialMotionStep')}
    ${extractFunction(INDEX, 'trtcOfficialPositionProgress')}
    ${extractFunction(INDEX, 'trtcOfficialPositionAtProgress')}
    ${extractFunction(INDEX, 'trtcGapUnitsAt')}
    ${extractFunction(INDEX, 'trtcOfficialSeparate')}
    globalThis.__api = { trtcOfficialSeparate, trtcOfficialPositionProgress,
      trtcGapUnitsAt, display: _trtcOfficialDisplay };
  `);
  const ctx = { Date, Math, Number, String, Array, Map, Set, isFinite, parseFloat };
  vm.createContext(ctx);
  vm.runInContext(bundle, ctx, { filename: 'separation.product.js' });
  return ctx.__api;
}

// 一條 10 站的直線，每站間隔 1 公里（d 單位為公里，與 data/trtc.json 一致）
const LINE = { id: 'L', stations: Array.from({ length: 10 }, (_, i) => ({
  name: `S${i}`, lat: 25 + i * 0.01, lon: 121, d: i * 1.0 })) };
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
  const A = api();
  A.display.set('L|back', { epoch: 999, progress: 3.50, pos: posAt(3, 4, 0.50) });
  const items = [
    { vehicleId: 'lead', vehicle: veh('lead', 2, 3, 4), pos: posAt(3, 4, 0.52) },
    { vehicleId: 'back', vehicle: veh('back', 2, 3, 4), pos: posAt(3, 4, 0.50) },
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

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (!pass) { console.error('🔴 零斷言＝沒驗'); process.exit(3); }
process.exit(fail ? 1 : 0);
