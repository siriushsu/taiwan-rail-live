// 閘門：scripts/trip_impact.mjs 對測試向量 scripts/fixtures/trip_impact_vectors.json 逐條比對（verdict、legIndex、system、
// impactIndex、show、每段 verdict）。原生 railcore 的 TripImpactTest 跑同一份向量（native/scripts/sync-trip-impact.mjs 拷貝）。
// 用法：node scripts/verify_trip_impact.mjs；全過退出碼 0。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tripImpact, parseIsoSec } from './trip_impact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/trip_impact_vectors.json'), 'utf8'));

const sec = s => {
  const v = parseIsoSec(s);
  if (v === null) throw new Error('向量時刻解析不了：' + s);
  return v;
};
let pass = 0, fail = 0;
const groups = {};
for (const c of V.cases) {
  const systems = c.snapshot ? V.snapshots[c.snapshot].systems : c.systems;
  const legs = c.legs.map(l => ({ ...l, boardAt: sec(l.boardAt), alightAt: sec(l.alightAt) }));
  const r = tripImpact(legs, systems, sec(c.now));
  const got = { verdict: r.verdict, legIndex: r.legIndex, system: r.system, impactIndex: r.impactIndex, show: r.show, legs: r.legs.map(l => l.verdict) };
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  groups[c.group] = groups[c.group] || { pass: 0, fail: 0 };
  groups[c.group][ok ? 'pass' : 'fail']++;
  if (ok) pass++;
  else {
    fail++;
    console.error(`✗ ${c.id}（${c.rule}）\n   期望 ${JSON.stringify(c.expect)}\n   實際 ${JSON.stringify(got)}\n   理由：${c.reason}`);
  }
}
for (const [g, n] of Object.entries(groups)) console.log(`${g}: ${n.pass} 過、${n.fail} 不過`);
console.log(`${fail ? '❌' : '✅'} trip_impact 向量 ${pass}/${pass + fail} 過`);
process.exit(fail ? 1 : 0);
