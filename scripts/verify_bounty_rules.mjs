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
// multiplier 必須是正整數：帳本 delta 是 INTEGER，小數倍率會讓 tripChips 回小數、SQLite 存成 REAL。
ok('R6 events 是陣列，每筆有 id/from/to、multiplier 是正整數', Array.isArray(c.events) &&
  c.events.every(e => e.id && /^\d{4}-\d\d-\d\d$/.test(e.from) && /^\d{4}-\d\d-\d\d$/.test(e.to) &&
    Number.isInteger(e.multiplier) && e.multiplier > 0));
ok('R7 整數欄位都是正整數', ['perTrip', 'minTripSec', 'remoteMultiplier', 'dailyChipCap'].every(k => Number.isInteger(c[k]) && c[k] > 0) &&
  ['minSec', 'dailyMax', 'perChip'].every(k => c.cloud && Number.isInteger(c.cloud[k]) && c.cloud[k] > 0));
ok('R8 設定檔不含金額欄位（PUBLIC repo）', !/price(Twd|NTD)|NT\$|lifetime|訂閱/i.test(JSON.stringify(rules)));
// 都卜勒那一重（worker.js integrityGate 第四重，第十四批）：相關係數＞dopplerCorrMax 而且逐點差中位數 ≤ dopplerResidMaxMps 才判。
// 設定檔少了 dopplerResidMaxMps 時比較式恆為假、那一重等於關掉（寫法刻意寧可放行），所以在這裡釘住兩個鍵都在、而且是合理的數。
{
  const I = rules.integrity || {};
  ok('R9 integrity.dopplerCorrMax 在 (0, 1)、dopplerResidMaxMps 是正的有限數（少了這個鍵，都卜勒那一重等於關掉）',
    typeof I.dopplerCorrMax === 'number' && I.dopplerCorrMax > 0 && I.dopplerCorrMax < 1 &&
      typeof I.dopplerResidMaxMps === 'number' && Number.isFinite(I.dopplerResidMaxMps) && I.dopplerResidMaxMps > 0,
    JSON.stringify({ dopplerCorrMax: I.dopplerCorrMax, dopplerResidMaxMps: I.dopplerResidMaxMps }));
}
// 停靠判定的位置微分否決（worker.js coverageOf 與 index.html bountyUpdateDwellProgress，第十五批）：回報的速度再低，位置微分超過 posSpeedVetoMps 就不信它。
// 少了這個鍵兩邊都直接中止（Worker 丟 invalid bounty rule、前端丟 dwell rules unavailable）；比 stopSpeedMaxMps 小的話否決會蓋掉真的停靠。
{
  const D = (rules.quality || {}).dwell || {};
  ok('R10 quality.dwell.posSpeedVetoMps 是有限數、而且大於 stopSpeedMaxMps（Android 沒有速度送 0 時靠它擋掉假停靠）',
    typeof D.posSpeedVetoMps === 'number' && Number.isFinite(D.posSpeedVetoMps) && D.posSpeedVetoMps > D.stopSpeedMaxMps,
    JSON.stringify({ posSpeedVetoMps: D.posSpeedVetoMps, stopSpeedMaxMps: D.stopSpeedMaxMps }));
}
// 站表同源（第十輪獨立驗收 P1-3）：Worker 判停靠用 bounty_units.json 的 lines，前端錄製當下用軌道檔（lineNetwork()）——
// 兩邊的站里程只要差過站窗，同一趟車就一邊算停靠、一邊不算（09-14 改過 tra.json、units 沒重產，汐科差了 326 m）。
// 期望值直接讀前端載入的那三份軌道檔（index.html SYS_DEFS 的 track），照 build_bounty_units.mjs 的篩法（有站名、有里程）排好比對。
{
  const SRC = [['data/tra.json', 'tra_sched'], ['data/thsr_track.json', 'thsr_sched'], ['data/afr.json', 'afr_sched']];
  const bad = [];
  let nLines = 0, nSts = 0;
  for (const [file, sys] of SRC) {
    const t = JSON.parse(read(file));
    const want = new Map((t.lines || []).map(ln => [`${sys}|${ln.id}`,
      (ln.stations || []).filter(s => s.d != null && s.name).map(s => ({ name: s.name, d: s.d })).sort((a, b) => a.d - b.d)]));
    for (const [lk, sts] of want) {
      nLines++; nSts += sts.length;
      const got = units.lines[lk];
      if (!got) { bad.push(`${lk} 不在 units`); continue; }
      if (JSON.stringify(got.stations) === JSON.stringify(sts)) continue;
      const gm = new Map((got.stations || []).map(s => [s.name, s.d]));
      const diff = sts.filter(s => gm.get(s.name) !== s.d).slice(0, 3).map(s => `${s.name} 軌道 ${s.d}／units ${gm.get(s.name)}`);
      bad.push(`${lk}：${diff.join('、') || '站序或站數不同'}`);
    }
    for (const lk of Object.keys(units.lines)) if (lk.startsWith(sys + '|') && !want.has(lk)) bad.push(`${lk} 只在 units`);
  }
  ok('R11 bounty_units.json 的站表與前端的軌道檔逐站相同（站名、里程；台鐵、高鐵、林鐵），不同就要重跑 npm run build-bounty-units',
    nLines > 0 && nSts > 100 && bad.length === 0, `${nLines} 條線、${nSts} 站；不同：${bad.slice(0, 5).join('；') || '無'}${bad.length > 5 ? `（共 ${bad.length} 條）` : ''}`);
}

const failed = R.filter(r => !r.p);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
