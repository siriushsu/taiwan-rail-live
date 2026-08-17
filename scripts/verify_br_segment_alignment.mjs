#!/usr/bin/env node
// 文湖線「倒數切段 ↔ CarWeight 逐車列」對齊驗收。
//
// 為什麼要有這支：舊碼要求兩邊台數**全等**才配對，不等就整個方向零配對、全部退回落後
// 96–265 秒的站碼——那正是使用者 08-18 裁示禁止的事（「不可能拿什麼 carweight 慢那麼多的
// 時間去顯示給人看」）。本支用 repo 內 08-15 實況語料重播，量「救回多少方向」，
// 並且**在同一次執行裡跑舊閘門當對照組**（judgment 心得 34/35：事後補跑的對照組分不出
// 產品回歸／環境條件／判準過期）。
//
// 用法：node scripts/verify_br_segment_alignment.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrtcModel, resolveBoardRows, segmentVehiclesFromCountdowns,
  alignSegmentsToVehicles } from './trtc_board_ledger.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

const model = buildTrtcModel(J('data/trtc.json'), J('data/trtc_times.json'),
  J('data/trtc_codes.json'), { includeY: true });
const BR = model.lines.get('BR');
const idxOfCode = new Map();
for (const [code, rec] of model.codeMap) {
  const on = (rec.on || []).find(x => x.line === 'BR');
  if (on) idxOfCode.set(code, on.i);
}
const runs = [...BR.runs.values()].filter(v => v > 0).sort((a, b) => a - b);
const MEDIAN_RUN = runs[Math.floor(runs.length / 2)];
const trtcEpoch = s => {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : NaN;
};
const pad = n => String(n).padStart(2, '0');

console.log(`\n模型自檢：BR ${BR.stations.length} 站，區間中位 ${MEDIAN_RUN} 秒，站碼表 ${idxOfCode.size} 筆`);
// runs 的鍵是有向的（`i>i+1` 與 `i>i-1` 各一把）⇒ 23 個區間共 46 筆，不是 23 筆。
const fwd = [...Array(23).keys()].filter(i => BR.runs.get(`${i}>${i + 1}`) > 0).length;
const bwd = [...Array(23).keys()].filter(i => BR.runs.get(`${i + 1}>${i}`) > 0).length;
ok('讀到的是真模型（24 站、正反向各 23 個區間秒齊全）',
  BR.stations.length === 24 && fwd === 23 && bwd === 23,
  `站${BR.stations.length} 正向${fwd} 反向${bwd} 合計${runs.length}`);

// ── 單元：對齊規則本身 ─────────────────────────────────────────────
// 站序 0..23、往南港（step=+1）。CarWeight 落後 200 秒 ⇒ 最多可能前進 200/78+2 ≈ 4.5 站。
const V = (idx, lagSec) => ({ idx, at: 1000 - lagSec });
const D = to => ({ to, baseEpoch: 1000 });

console.log('\n【1】台數相等且位置吻合 ⇒ 位移 0');
ok('三對三、各前進 2 站', alignSegmentsToVehicles(
  [D(5), D(11), D(17)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN) === 0);

console.log('\n【2】🔴 少一台（頭或尾觀測不到）⇒ 仍要對得起來，且選對視窗');
ok('少的是【頭】(最靠終點那台) ⇒ 位移 0',
  alignSegmentsToVehicles([D(5), D(11)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN) === 0,
  String(alignSegmentsToVehicles([D(5), D(11)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN)));
ok('少的是【尾】(剛發車那台) ⇒ 位移 1',
  alignSegmentsToVehicles([D(11), D(17)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN) === 1,
  String(alignSegmentsToVehicles([D(11), D(17)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN)));

console.log('\n【3】🔴 反向控制：推導位置在站碼【後方】＝不可能（車不會倒退）⇒ 必須拒絕');
ok('全部落後 3 站 ⇒ 回 -1（寧可不配也不貼錯）',
  alignSegmentsToVehicles([D(0), D(6), D(12)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN) === -1);
ok('落後 1 站仍接受（站碼整站量化誤差）',
  alignSegmentsToVehicles([D(2), D(8), D(14)], [V(3, 200), V(9, 200), V(15, 200)], 1, MEDIAN_RUN) === 0);

console.log('\n【4】🔴 反向控制：前進得比「落後秒數 × 速度」還多 ⇒ 不可能，必須拒絕');
ok('站碼只落後 0 秒卻前進 8 站 ⇒ 回 -1',
  alignSegmentsToVehicles([D(11)], [V(3, 0)], 1, MEDIAN_RUN) === -1);
ok('同樣前進 8 站，但站碼落後 600 秒 ⇒ 接受',
  alignSegmentsToVehicles([D(11)], [V(3, 600)], 1, MEDIAN_RUN) === 0);

console.log('\n【5】方向 1（站序遞減）也要成立 — 心得 4：有序資料必驗兩個方向');
ok('dir1 少一台（尾）⇒ 位移 1', alignSegmentsToVehicles(
  [D(12), D(6)], [V(20, 200), V(14, 200), V(8, 200)], -1, MEDIAN_RUN) === 1,
  String(alignSegmentsToVehicles([D(12), D(6)], [V(20, 200), V(14, 200), V(8, 200)], -1, MEDIAN_RUN)));

console.log('\n【6】邊界：段數多於車數／空輸入 ⇒ 一律不配（不准無中生有）');
ok('段數 3 > 車數 2 ⇒ -1', alignSegmentsToVehicles([D(5), D(11), D(17)], [V(3, 200), V(9, 200)], 1, MEDIAN_RUN) === -1);
ok('空的段 ⇒ -1', alignSegmentsToVehicles([], [V(3, 200)], 1, MEDIAN_RUN) === -1);
ok('空的車列 ⇒ -1', alignSegmentsToVehicles([D(5)], [], 1, MEDIAN_RUN) === -1);
ok('medianRun 無效 ⇒ -1（不要用壞掉的尺去量）', alignSegmentsToVehicles([D(5)], [V(3, 200)], 1, 0) === -1);

// ── 實況語料重播：新舊閘門同一次執行併排比較 ──────────────────────
console.log('\n【7】🔴 08-15 實況語料重播：新對齊 vs 舊「全等才配」（同一次執行的對照組）');
const dir0 = path.join(ROOT, 'fixtures/trtc-outage-20260815/rounds');
const files = fs.readdirSync(dir0).filter(f => f.endsWith('.json')).sort();
let dirs = 0, newOK = 0, oldOK = 0, newTrains = 0, oldTrains = 0, cwTotal = 0, overCount = 0;
const dupNo = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir0, f), 'utf8'));
  if (!Array.isArray(j.board) || !Array.isArray(j.trains)) continue;
  const tk = j.board.map(r => {
    const sec = Math.max(0, Math.round(Number(r.eta) - Number(r.at)));
    const d = new Date((Number(r.at) + 8 * 3600) * 1000);
    return { StationName: r.name, DestinationName: r.dest, TrainNumber: String(r.no || ''),
      CountDown: sec === 0 ? '列車進站' : `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`,
      NowDateTime: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` };
  });
  const seg = segmentVehiclesFromCountdowns(model,
    resolveBoardRows(model, tk, trtcEpoch, new Map()).rows, { lines: ['BR'] });
  for (const dir of [1, 2]) {
    const step = dir === 2 ? 1 : -1;
    const derived = seg.vehicles.filter(v => v.dir === dir).sort((a, b) => (a.to - b.to) * step);
    const rows = j.trains.filter(t => t.sys === 'br' && Number(t.dir) === dir &&
      idxOfCode.has(String(t.stn)));
    const cw = rows.map(t => ({ idx: idxOfCode.get(String(t.stn)), at: Number(t.at), no: String(t.no || '') }))
      .sort((a, b) => (a.idx - b.idx) * step);
    if (!cw.length) continue;
    dirs++; cwTotal += cw.length;
    if (derived.length > cw.length) overCount++;
    // 舊閘門：全等才配
    if (derived.length && derived.length === cw.length) { oldOK++; oldTrains += derived.length; }
    // 新對齊
    const off = alignSegmentsToVehicles(derived, cw, step, MEDIAN_RUN);
    if (off >= 0) {
      newOK++; newTrains += derived.length;
      const used = new Set();
      for (let i = 0; i < derived.length; i++) {
        const no = cw[off + i].no;
        if (used.has(no)) dupNo.push(`${f} dir${dir} ${no}`);
        used.add(no);
      }
    }
  }
}
console.log(`  方向樣本 ${dirs}｜CarWeight 車次合計 ${cwTotal}`);
console.log(`  舊「全等才配」：${oldOK} 個方向 (${(oldOK / dirs * 100).toFixed(0)}%)，${oldTrains} 台拿到新鮮位置`);
console.log(`  新「連續視窗對齊」：${newOK} 個方向 (${(newOK / dirs * 100).toFixed(0)}%)，${newTrains} 台拿到新鮮位置`);
ok('語料真的跑到了（方向樣本 > 0）', dirs > 0, String(dirs));
ok('舊閘門重現得出 Codex 量到的 ~38%（證明重播忠實）',
  Math.abs(oldOK / dirs - 0.375) < 0.06, `${(oldOK / dirs * 100).toFixed(0)}%`);
ok('🔴 新對齊嚴格優於舊閘門（救回的方向數 > 0）', newOK > oldOK, `${newOK} vs ${oldOK}`);
ok('🔴 段數一次都沒有多於車數（不會多生車）', overCount === 0, `${overCount} 次`);
ok('🔴 同一輪同方向不會有兩段配到同一台車', dupNo.length === 0, dupNo.slice(0, 3).join('；'));
ok('新對齊拿到新鮮位置的台數 ≤ CarWeight 總台數（不憑空生車）', newTrains <= cwTotal,
  `${newTrains} vs ${cwTotal}`);

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (!pass) { console.error('🔴 零斷言＝沒驗'); process.exit(3); }
process.exit(fail ? 1 : 0);
