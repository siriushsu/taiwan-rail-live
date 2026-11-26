// 重釘 scripts/fixtures/remaining-routes-0913.json 的 afterPlans：F2c（repair_tra_pass_main.mjs）把驗收進路在「驗收站與鄰站以外」
// 的通過站搬回正線之後，閘門 verify_remaining_station_routes.mjs 第一條逐份比 afterPlans 會紅。這支只做這一種重釘：
//   * 只換 pathIds；其餘欄位（stopSignature、holds…）不同就中止。
//   * 四份受保護模板不得有任何不同（fixture 的恆等式 beforePlans===afterPlans）。
//   * 驗收站（changes 的 station）的進站段與出站段不得不同（F2c 不搬驗收站與它前後各一站，這兩段就不會變）。
//   * beforePlans、newPaths、changes、sourceStops、waysSha256 不動；閘門的動態判準（道岔不倒車、進出站不跳、每秒位移）照舊對新進路驗。
// 用法：node scripts/repin_remaining_routes.mjs <dispatch.json> "<重釘說明，會接在 refreshed 後面>"
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stationKey } from '../rail-3d/physical/timing.js';

const [dispatchFile, note] = process.argv.slice(2);
assert.ok(dispatchFile && note, '用法：node scripts/repin_remaining_routes.mjs <dispatch.json> "<重釘說明>"');
const file = new URL('./fixtures/remaining-routes-0913.json', import.meta.url), proof = JSON.parse(fs.readFileSync(file, 'utf8'));
const plans = JSON.parse(fs.readFileSync(dispatchFile, 'utf8')).plans, templates = new Set(proof.protectedTemplates), guardedOf = new Map();
for (const c of proof.changes) { const set = guardedOf.get(c.key) || guardedOf.set(c.key, new Set()).get(c.key); for (const n of c.station.split(/[—→]/)) set.add(stationKey('tra_sched', n)); }
const changed = [];
for (const [key, was] of Object.entries(proof.afterPlans)) {
  const now = plans[key]; assert.ok(now, '派車表少了驗收計畫 ' + key);
  if (templates.has(key)) { assert.deepEqual(now, was, '受保護模板被改了 ' + key); continue; }
  const { pathIds: a, ...restA } = was, { pathIds: b, ...restB } = now;
  assert.deepEqual(restB, restA, key + ' 除了 pathIds 以外的欄位不同'); assert.equal(b.length, a.length, key + ' 段數不同');
  const names = JSON.parse(was.stopSignature).map(x => x[0]), guard = guardedOf.get(key); assert.ok(guard, key + ' 沒有驗收站');
  names.forEach((n, j) => { if (guard.has(n)) for (const k of [j - 1, j]) if (k >= 0 && k < a.length) assert.equal(b[k], a[k], `${key} 驗收站 ${n} 前後的路徑不同（第 ${k} 段）`); });
  const diff = a.reduce((n, p, k) => n + (p !== b[k] ? 1 : 0), 0);
  if (diff) { proof.afterPlans[key] = now; changed.push(`${key}(${diff})`); }
}
if (!changed.length) { console.log('afterPlans 與派車表相同，不用重釘'); process.exit(0); }
proof.refreshed += ` ${note}（重釘 afterPlans ${changed.length} 份；beforePlans／newPaths／changes／protectedTemplates／sourceStops／waysSha256 不動）`;
fs.writeFileSync(file, JSON.stringify(proof));
console.log(`重釘 afterPlans ${changed.length} 份（計畫鍵(換掉的段數)）：${changed.join('、')}`);
