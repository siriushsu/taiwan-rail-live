// 台鐵互穿家族棘輪：4 秒全日掃描、三個服務日。
// 2026-09-14 完整編組成為產品預設後，production 對照既存 long 基線；
// legacy-three 以明示的歷史車長探針保留原 production 基線回歸。所有基線數值不變。
// FORMATION_PROBE=long 是 production 的相容別名，不再注入較長的產品外觀。
// DATES=all 跑三日 × 兩種測量；TEST_DATE=YYYY-MM-DD 單跑完整產品，
// 加 FORMATION_PROBE=legacy-three 才跑歷史測量。本輪禁止 UPDATE_BASELINE。
// 產物 output/overlap-families/<日期>-<測量>.json / .log / -families.json。
// 120 秒閘門的退出碼不套到 4 秒取樣；仍檢查報告身分與每個家族，不允許新家族。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/fixtures/tra-overlap-families-baseline.json');
const OUT = path.join(ROOT, 'output/overlap-families'); mkdirSync(OUT, { recursive: true });
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
if (process.env.UPDATE_BASELINE === '1') throw Error('本次完整編組開放禁止改寫既有基線');
let runs;
if (process.env.DATES === 'all') runs = Object.entries(baseline.dates).flatMap(([d, byProbe]) => Object.keys(byProbe).map(p => [d, p === 'production' ? 'legacy-three' : 'production']));
else {
  const d = process.env.TEST_DATE; if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw Error('要 TEST_DATE=YYYY-MM-DD 或 DATES=all');
  runs = [[d, process.env.FORMATION_PROBE === 'legacy-three' ? 'legacy-three' : 'production']];
}
let port = Number(process.env.PORT || 5533), failed = 0;
const total = m => Object.values(m).reduce((a, b) => a + b, 0);
for (const [date, probe] of runs) {
  const tag = `${date}-${probe}`, report = path.join(OUT, tag + '.json'), fam = path.join(OUT, tag + '-families.json');
  const env = { ...process.env, TEST_DATE: date, SAMPLE: '4', PORT: String(port++), REPORT: report };
  delete env.NETWORK; delete env.DISPATCH; delete env.DATES; delete env.UPDATE_BASELINE;
  if (probe === 'legacy-three') env.FORMATION_PROBE = 'legacy-three'; else delete env.FORMATION_PROBE;
  if (existsSync(report)) unlinkSync(report);
  const sweep = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify_physical_no_overlap.mjs')], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(path.join(OUT, tag + '.log'), (sweep.stdout || '') + (sweep.stderr || ''));
  if (!existsSync(report)) { console.log(`FAIL  ${tag} 掃描沒有寫出事件報告（看 output/overlap-families/${tag}.log）`); failed++; continue; }
  const rep = JSON.parse(readFileSync(report, 'utf8'));
  if (rep.sample !== 4 || rep.serviceDate !== date || (rep.formationProbe || 'production') !== probe) { console.log(`FAIL  ${tag} 報告身分不符 sample=${rep.sample} serviceDate=${rep.serviceDate} probe=${rep.formationProbe}`); failed++; continue; }
  const sum = spawnSync(process.execPath, [path.join(ROOT, 'scripts/summarize_overlap_intervals.mjs'), report, '--json', fam], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (sum.status !== 0 || !existsSync(fam)) { console.log(`FAIL  ${tag} 家族整理失敗\n${sum.stderr}`); failed++; continue; }
  const now = Object.fromEntries(Object.entries(JSON.parse(readFileSync(fam, 'utf8')).families).map(([k, v]) => [k, v.n]));
  // 完整產品對照既存長編組基線；舊三節探針對照既存 production 基線。數值完全不變。
  const baselineKey = probe === 'legacy-three' ? 'production' : 'long';
  const base = baseline.dates[date]?.[baselineKey];
  if (!base) { console.log(`FAIL  ${tag} 基線沒有這個服務日／編組，須重新查核班表與測量依據`); failed++; continue; }
  console.log(`\n== ${tag}  取樣 ${rep.samples} 個時點 → 獨立事件 ${total(now)}（既存 ${baselineKey} 基線 ${total(base)}）`);
  console.log('      ' + '家族'.padEnd(40, '　') + '  基線   本次');
  let bad = 0;
  for (const k of [...new Set([...Object.keys(base), ...Object.keys(now)])].sort()) {
    const b = base[k], n = now[k] ?? 0, ok = b === undefined ? n === 0 : n <= b; if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(40, '　')} ${String(b ?? '（無）').padStart(5)}  ${String(n).padStart(5)}${b === undefined && n > 0 ? '  ← 基線沒有的家族' : ''}`);
  }
  if (bad) failed++;
}
console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${runs.length} 次掃描，${failed} 次退步`);
process.exit(failed ? 1 : 0);
