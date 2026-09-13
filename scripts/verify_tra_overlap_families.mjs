// 台鐵互穿家族棘輪（F4，docs/tra-overlap-rootcause-0914.md R4）。
//
// 為什麼要有這道：120 秒取樣的閘門（verify_physical_no_overlap.mjs）對一場 8 秒的迎面互穿有 93% 機率量不到，
// 2026-09-14 用 4 秒掃 9/13 全日，閘門看到的 55 對變成 635 場獨立事件。這裡把「4 秒全日掃描 →
// summarize_overlap_intervals.mjs 分家族」做成棘輪：每個家族的場次不得高於基線、不得出現基線沒有的家族。
// 基線在 scripts/fixtures/tra-overlap-families-baseline.json：三個服務日 × 生產編組／長編組探針（FORMATION_PROBE=long）。
//
// 跑法：
//   TEST_DATE=2026-09-13 node scripts/verify_tra_overlap_families.mjs                       # 生產編組
//   FORMATION_PROBE=long TEST_DATE=2026-09-13 node scripts/verify_tra_overlap_families.mjs  # 長編組探針
//   DATES=all node scripts/verify_tra_overlap_families.mjs                                   # 基線裡每個服務日 × 每種編組（約 6 × 45 s）
//   UPDATE_BASELINE=1 …  → 把本次結果寫進基線；只在重跑 F1／F2（repair_physical_directions → repair_physical_stations）
//                          或重抓班表之後、而且已經看過家族表確認沒有新家族時才用。
// 🔴 班表是 14 天逐日制，npm run fetch-schedule 之後基線裡的服務日會過期：重跑 F1／F2 → 重建基線。
// 一律量受測樹裝好的 rail-3d/physical/（不吃 NETWORK／DISPATCH 覆蓋，避免把別的檔驗成本樹）。
// 產物：output/overlap-families/<日期>-<編組>.{json,log} 與 -families.json。120 秒閘門的 G2/G5/G6/G7 在 4 秒取樣下會紅
//（那些棘輪按 120 秒取樣校準），這裡只取它寫出的事件報告、不看它的 exit code；報告的身分（sample／日期／編組）另驗。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/fixtures/tra-overlap-families-baseline.json');
const OUT = path.join(ROOT, 'output/overlap-families'); mkdirSync(OUT, { recursive: true });
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const update = process.env.UPDATE_BASELINE === '1';
let runs;
if (process.env.DATES === 'all') runs = Object.entries(baseline.dates).flatMap(([d, byProbe]) => Object.keys(byProbe).map(p => [d, p]));
else {
  const d = process.env.TEST_DATE; if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw Error('要 TEST_DATE=YYYY-MM-DD 或 DATES=all');
  runs = [[d, process.env.FORMATION_PROBE === 'long' ? 'long' : 'production']];
}
let port = Number(process.env.PORT || 5533), failed = 0;
const total = m => Object.values(m).reduce((a, b) => a + b, 0);
for (const [date, probe] of runs) {
  const tag = `${date}-${probe}`, report = path.join(OUT, tag + '.json'), fam = path.join(OUT, tag + '-families.json');
  const env = { ...process.env, TEST_DATE: date, SAMPLE: '4', PORT: String(port++), REPORT: report };
  delete env.NETWORK; delete env.DISPATCH; delete env.DATES; delete env.UPDATE_BASELINE;
  if (probe === 'long') env.FORMATION_PROBE = 'long'; else delete env.FORMATION_PROBE;
  if (existsSync(report)) unlinkSync(report);
  const sweep = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify_physical_no_overlap.mjs')], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(path.join(OUT, tag + '.log'), (sweep.stdout || '') + (sweep.stderr || ''));
  if (!existsSync(report)) { console.log(`FAIL  ${tag} 掃描沒有寫出事件報告（看 output/overlap-families/${tag}.log）`); failed++; continue; }
  const rep = JSON.parse(readFileSync(report, 'utf8'));
  if (rep.sample !== 4 || rep.serviceDate !== date || (rep.formationProbe || 'production') !== probe) { console.log(`FAIL  ${tag} 報告身分不符 sample=${rep.sample} serviceDate=${rep.serviceDate} probe=${rep.formationProbe}`); failed++; continue; }
  const sum = spawnSync(process.execPath, [path.join(ROOT, 'scripts/summarize_overlap_intervals.mjs'), report, '--json', fam], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (sum.status !== 0 || !existsSync(fam)) { console.log(`FAIL  ${tag} 家族整理失敗\n${sum.stderr}`); failed++; continue; }
  const now = Object.fromEntries(Object.entries(JSON.parse(readFileSync(fam, 'utf8')).families).map(([k, v]) => [k, v.n]));
  const base = baseline.dates[date]?.[probe];
  if (update) (baseline.dates[date] = baseline.dates[date] || {})[probe] = Object.fromEntries(Object.entries(now).sort());
  if (!base) { if (update) { console.log(`INFO  ${tag} 新基線 ${JSON.stringify(now)}`); continue; } console.log(`FAIL  ${tag} 基線沒有這個服務日／編組（重抓班表後先重跑 F1／F2，再 UPDATE_BASELINE=1 重建）`); failed++; continue; }
  console.log(`\n== ${tag}  取樣 ${rep.samples} 個時點 → 獨立事件 ${total(now)}（基線 ${total(base)}）`);
  console.log('      ' + '家族'.padEnd(40, '　') + '  基線   本次');
  let bad = 0;
  for (const k of [...new Set([...Object.keys(base), ...Object.keys(now)])].sort()) {
    const b = base[k], n = now[k] ?? 0, ok = b === undefined ? n === 0 : n <= b; if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(40, '　')} ${String(b ?? '（無）').padStart(5)}  ${String(n).padStart(5)}${b === undefined && n > 0 ? '  ← 基線沒有的家族' : ''}`);
  }
  if (bad) failed++;
}
if (update) { writeFileSync(BASELINE, JSON.stringify(baseline, null, 1) + '\n'); console.log(`\n基線已更新 ${BASELINE}`); }
console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${runs.length} 次掃描，${failed} 次退步`);
process.exit(failed ? 1 : 0);
