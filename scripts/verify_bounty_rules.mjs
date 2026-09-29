// 懸賞設定檔 v2 的結構檢查：每個線鍵真的在題庫裡、場景 id 真的在車庫場景表裡、價格是正整數、
// 去重門檻不含捷運（09-29「捷運不用懸賞」）。跑法：node scripts/verify_bounty_rules.mjs
import { readFileSync } from 'node:fs';

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const rules = JSON.parse(read('data/bounty_rules.json'));
const units = JSON.parse(read('data/bounty_units.json'));
const sceneIds = new Set([...read('train-garage-scenes.js').matchAll(/scene:\s*'([a-z0-9-]+)'/g)].map(m => m[1]));
const c = rules.chips || {};

ok('R1 coverDistinct 台鐵 50、高鐵 15，沒有捷運鍵',
  rules.coverDistinct && rules.coverDistinct.TRA === 50 && rules.coverDistinct.THSR === 15 &&
  Object.keys(rules.coverDistinct).sort().join() === 'THSR,TRA', JSON.stringify(rules.coverDistinct));
ok('R2 舊客端讀的 coverN 仍在', rules.coverN && typeof rules.coverN.TRA === 'number');
for (const f of ['remoteLines', 'evergreen']) {
  const bad = (c[f] || []).filter(k => !units.lines[k]);
  ok(`R3 chips.${f} 每個鍵都在 bounty_units.lines`, Array.isArray(c[f]) && c[f].length > 0 && bad.length === 0,
    `${(c[f] || []).length} 個，缺：${bad.join(',') || '無'}`);
}
ok('R4 prices 是非空正整數陣列', Array.isArray(c.prices) && c.prices.length > 0 &&
  c.prices.every(p => Number.isInteger(p) && p > 0), JSON.stringify(c.prices));
{
  const bad = (c.scenes || []).filter(s => !sceneIds.has(s));
  ok('R5 chips.scenes 每個 id 都在 train-garage-scenes.js', Array.isArray(c.scenes) && c.scenes.length > 0 &&
    bad.length === 0 && new Set(c.scenes).size === c.scenes.length,
    `場景表 ${sceneIds.size} 個 id；缺：${bad.join(',') || '無'}`);
}
ok('R6 events 是陣列，每筆有 id/from/to/multiplier', Array.isArray(c.events) &&
  c.events.every(e => e.id && /^\d{4}-\d\d-\d\d$/.test(e.from) && /^\d{4}-\d\d-\d\d$/.test(e.to) && e.multiplier > 0));
ok('R7 整數欄位都是正整數', ['perTrip', 'minTripSec', 'remoteMultiplier', 'dailyChipCap'].every(k => Number.isInteger(c[k]) && c[k] > 0) &&
  ['minSec', 'dailyMax', 'perChip'].every(k => c.cloud && Number.isInteger(c.cloud[k]) && c.cloud[k] > 0));
ok('R8 設定檔不含金額欄位（PUBLIC repo）', !/price(Twd|NTD)|NT\$|lifetime|訂閱/i.test(JSON.stringify(rules)));

const failed = R.filter(r => !r.p);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
