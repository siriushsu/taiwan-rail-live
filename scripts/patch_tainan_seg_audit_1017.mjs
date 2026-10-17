// 臺南地下化改了縱貫線南段的 2D 線形（reshape_tainan_underground_2d_1017.mjs），站間距稽核只換進受影響的兩段。
// 不整檔採用重跑結果：data/seg_distance_audit.json 自 09-07 之後沒重產，重跑會一併帶進縱貫線北段平鎮臨時站、
// 汐科座標等跟這次無關的變動，而 tra_seg_cumdist.json 會因為 TDX 沒有平鎮而掉一段官方里程。
// 2026-10-17 實測：同一份 data/tdx 快取在 BASE_REF 與改動後各重跑一次，兩次只差大橋–臺南、臺南–保安兩段
// 與縱貫線南段的 lines 統計，totals、top20 相同；這裡只換這三筆。
// 跑法（data/tdx/ 要有各系統的 *_StationOfLine.json 快取）：
//   node scripts/audit_seg_distance.mjs && BASE_REF=<改動前已驗證commit> node scripts/patch_tainan_seg_audit_1017.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const ref = process.env.BASE_REF; assert(ref, '必須明確指定改動前已驗證的 BASE_REF');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const sha = execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding: 'utf8'}).trim();
const show = f => execFileSync('git', ['-C', root, 'show', `${sha}:${f}`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const AUDIT = 'data/seg_distance_audit.json', TABLE = 'data/tra_seg_cumdist.json';
const rerun = JSON.parse(fs.readFileSync(AUDIT, 'utf8')), baseText = show(AUDIT), base = JSON.parse(baseText);
const LINE = '縱貫線南段', PAIRS = ['大橋|臺南', '臺南|保安'];
const key = s => `${s.system}|${s.lineId}|${s.from}|${s.to}`, fresh = new Map(rerun.segments.map(s => [key(s), s]));
const changed = [];
base.segments = base.segments.map(s => {
  if (s.system !== 'TRA' || s.lineId !== LINE) return s;
  const n = fresh.get(key(s)); assert(n, `重跑少了 ${key(s)}`);
  if (JSON.stringify(n) === JSON.stringify(s)) return s;
  changed.push(`${s.from}|${s.to}`); return n;
});
assert.deepEqual(changed, PAIRS, `縱貫線南段有變的區間跟預期不同：${changed}`);
const li = base.lines.findIndex(l => l.system === 'TRA' && l.lineId === LINE);
base.lines[li] = rerun.lines.find(l => l.system === 'TRA' && l.lineId === LINE);
fs.writeFileSync(AUDIT, JSON.stringify(base, null, 2) + '\n');
fs.writeFileSync(TABLE, show(TABLE));   // 官方里程查表不動
assert.equal(JSON.stringify(JSON.parse(baseText), null, 2) + '\n', baseText, '稽核檔序列化方式跟腳本不同');
for (const p of PAIRS) { const s = base.segments.find(x => x.lineId === LINE && `${x.from}|${x.to}` === p); console.log(`${p}：網站 ${s.currentKm} km，官方 ${s.officialKm} km，差 ${(s.error.signedCurrentMinusOfficialKm * 1000).toFixed(1)} m（${s.error.percent}%）`); }
