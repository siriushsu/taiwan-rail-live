// 懸賞設定檔 v2 的結構檢查：每個線鍵真的在題庫裡、場景 id 真的在車庫場景表裡、價格是正整數、
// 去重門檻不含捷運（捷運不列入懸賞）。跑法：node scripts/verify_bounty_rules.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // 位置微分跟「至少 posSpeedWindowSec 秒以前的那一點」比（第十七批）：少了、不是數字、或不在 1–10 秒，兩邊一樣直接中止（上限是第十八批加的）。
  ok('R12 quality.dwell.posSpeedWindowSec 是 1–10 的數字（停靠判定的位置微分跟幾秒前的點比）',
    typeof D.posSpeedWindowSec === 'number' && Number.isFinite(D.posSpeedWindowSec) && D.posSpeedWindowSec >= 1 && D.posSpeedWindowSec <= 10,
    JSON.stringify({ posSpeedWindowSec: D.posSpeedWindowSec }));
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

// 單位檔的 perDay 是「各日班次數的中位數」（第十七批，第十一輪獨立驗收 P2-4）：台鐵班表是 14 天逐日的聯集
// （trains＝跨日去重的班次定義、dates＝日期 → 當天的班次索引），整份當成一天算的話，只開一天的臨時車、同車次改點的第二份定義
// 都會被算成每天一班，還會把尖峰時段推走。拿一份手寫的小班表在暫存目錄跑 build_bounty_units.mjs，期望值是手算的常數：
//   軌道檔一條線 甲(0)–乙(1)–丙(2)。五天（d1–d5）：
//   ・區間車：5–23 時每小時一班 甲→乙→丙（三站都停，同一小時內）；6、7、8、17、18、19 時再各加兩班。
//     d4 那天 12 時那一班改點成 12:10（另一份定義，當天取代原本那一份）→ 甲|乙、乙|丙 每天 31 班，中位數 31（聯集會是 32）。
//   ・其他：d4 才有的二十班 20 時 甲→乙（每兩分鐘一班，都在 20 時內）→ 中位數 0，不出單位（聯集會出一個 perDay 20 的單位、把 20 時變成尖峰；
//     尖峰改拿各日加總來切的話，20 時一樣會被切進去）。
//   ・自強：d1–d3 的 10 時 甲→丙、乙通過（stop:false）→ 中位數 1：甲|乙、乙|丙 各一個軌道單位；停站只有甲、丙。
//   ・莒光：d1、d5 才有 → 中位數 0，不出單位。
//   每小時停站數的中位數：尖峰 9、其他營運時段 3 → 尖峰＝6、7、8、17、18、19。
//   另十份壞班表要讓腳本非零離開，而且是腳本自己的檢查擋下（錯誤訊息指名是哪一種、哪一天、哪個索引），不是跑到後面才崩：
//   車次自帶行駛日（days）、dates 裡有超出範圍的索引、同一天同一個索引出現兩次（第十七批）；
//   dates 不是物件、dates 是空的、鍵不是日曆上的日期（2026-02-30）、某一天一班車都沒有（第十八批，第十二輪獨立驗收 P3-4）；
//   台鐵的檔 dates 缺鍵（帶 dateRange）、台鐵的檔 dates 是 null、高鐵的檔帶 dateRange 卻沒有 dates（第十九批，第十三輪 P3-2）。
//   擋下的時候舊的 data/bounty_units.json 原封不動（壞的一份不能寫出半套清單）。
//   高鐵、林鐵的軌道檔與班表放空的（一條線、一班車都沒有）：六個輸入檔少一個腳本就停（見 R13b）。
//   偶數天（台鐵實際是 14 天）另跑一份：四天裡兩天有莒光 → 中位數取中間兩個的平均 0.5，出單位（取下面那一個會是 0、不出）。
{
  const SCRIPT = join(fileURLToPath(new URL('.', import.meta.url)), 'build_bounty_units.mjs');
  const TRACK = { lines: [{ id: 'L', name: 'L', stations: [{ name: '甲', d: 0 }, { name: '乙', d: 1 }, { name: '丙', d: 2 }] }] };
  const tr = (kind, h, names, passAt = '', m = 0) => ({ train: `${kind}${h}${m}`, typeName: kind, carName: kind,
    stops: names.map((name, i) => ({ name, depSec: h * 3600 + m * 60 + i * 300, stop: name !== passAt })) });
  const trains = [], base = [];
  for (let h = 5; h <= 23; h++) base.push(trains.push(tr('區間車', h, ['甲', '乙', '丙'])) - 1);
  for (const h of [6, 7, 8, 17, 18, 19]) for (let k = 0; k < 2; k++) base.push(trains.push(tr('區間車', h, ['甲', '乙', '丙'], '', 20 + k)) - 1);
  const noon = base[7], noonMoved = trains.push(tr('區間車', 12, ['甲', '乙', '丙'], '', 10)) - 1;   // base[7]＝12 時那一班
  const other = Array.from({ length: 20 }, (_, k) => trains.push(tr('其他', 20, ['甲', '乙'], '', 2 * k)) - 1);
  const tze = trains.push(tr('自強', 10, ['甲', '乙', '丙'], '乙', 30)) - 1;
  const kg = trains.push(tr('莒光', 14, ['甲', '乙', '丙'])) - 1;
  const dates = {
    '2026-01-05': [...base, tze, kg], '2026-01-06': [...base, tze], '2026-01-07': [...base, tze],
    '2026-01-08': [...base.filter(i => i !== noon), noonMoved, ...other], '2026-01-09': [...base, kg],
  };
  const OLD = 'old-units-file';           // 預先放一份舊的單位檔：擋下的時候它要原封不動
  const run = (sched, { omit = [], files = {} } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'bounty-units-'));
    try {
      mkdirSync(join(dir, 'data'));
      const inputs = { 'data/tra.json': TRACK, 'data/tra_schedule_dense.json': sched,
        'data/thsr_track.json': { lines: [] }, 'data/thsr_schedule_dense.json': { date: '', trains: [] },
        'data/afr.json': { lines: [] }, 'data/afr_schedule_dense.json': { date: '', trains: [] }, ...files };
      for (const [f, v] of Object.entries(inputs)) if (!omit.includes(f)) writeFileSync(join(dir, f), JSON.stringify(v));
      writeFileSync(join(dir, 'data/bounty_units.json'), OLD);
      const p = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
      const raw = readFileSync(join(dir, 'data/bounty_units.json'), 'utf8');
      let out = null;
      try { out = JSON.parse(raw); } catch (e) {}
      const se = String(p.stderr || '');
      return { status: p.status, out, kept: raw === OLD, err: (se.match(/^Error: (.*)$/m) || [])[1] || se.split('\n').find(l => /Error/.test(l)) || '' };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const list = r => r.out ? r.out.units.map(u => `${u.segKey.split('|').slice(2).join('')}|${u.trainKind}|${u.kind}|${u.dir}|${u.slot}=${u.perDay}`).sort() : [];
  const good = run({ date: '2026-01-05', trains, dates }), got = list(good);
  const want = ['乙甲|區間車|track|0|=31', '丙乙|區間車|track|0|=31', '乙甲|自強|track|0|=1', '丙乙|自強|track|0|=1',   // segKey 兩站依字碼排序
    ...['甲甲', '乙乙', '丙丙'].flatMap(s => [`${s}|區間車|dwell|0|peak=18`, `${s}|區間車|dwell|0|off=13`, `${s}|區間車|dwell|0|holiday=31`]),
    ...['甲甲', '丙丙'].flatMap(s => [`${s}|自強|dwell|0|off=1`, `${s}|自強|dwell|0|holiday=1`])].sort();
  const peak = good.out && good.out.peakHoursBySys && good.out.peakHoursBySys.tra_sched;
  const even = run({ date: '2026-01-05', trains, dates: { '2026-01-05': [...base, kg], '2026-01-06': [...base, kg], '2026-01-07': base, '2026-01-08': base } });
  const gotEven = list(even), peakEven = even.out && even.out.peakHoursBySys && even.out.peakHoursBySys.tra_sched;
  const wantEven = ['乙甲|區間車|track|0|=31', '丙乙|區間車|track|0|=31', '乙甲|莒光|track|0|=0.5', '丙乙|莒光|track|0|=0.5',
    ...['甲甲', '乙乙', '丙丙'].flatMap(s => [`${s}|區間車|dwell|0|peak=18`, `${s}|區間車|dwell|0|off=13`, `${s}|區間車|dwell|0|holiday=31`,
      `${s}|莒光|dwell|0|off=0.5`, `${s}|莒光|dwell|0|holiday=0.5`])].sort();
  const WANT_ERR = { days: /帶了逐車行駛日/, index: new RegExp(`2026-01-09 有壞的班次索引：${trains.length}$`), dup: new RegExp(`2026-01-06 重複列了班次索引：${base[0]}$`),
    notObj: /dates 不是「日期 → 班次索引」$/, empty: /dates 是空的$/, badKey: /dates 有不是日期的鍵：2026-02-30$/, emptyDay: /2026-01-07 一班車都沒有$/,
    noDates: /^data\/tra_schedule_dense\.json 沒有 dates：/, nullDates: /^data\/tra_schedule_dense\.json 沒有 dates：/,
    thsrRange: /^data\/thsr_schedule_dense\.json 沒有 dates：/ };
  const bad = [
    ['days', run({ date: '2026-01-05', trains: trains.map((t, i) => i ? t : { ...t, days: ['2026-01-05'] }), dates })],
    ['index', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-01-09': [...dates['2026-01-09'], trains.length] } })],
    ['dup', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-01-06': [...dates['2026-01-06'], base[0]] } })],
    ['notObj', run({ date: '2026-01-05', trains, dates: Object.values(dates) })],
    ['empty', run({ date: '2026-01-05', trains, dates: {} })],
    ['badKey', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-02-30': base } })],
    ['emptyDay', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-01-07': [] } })],
    ['noDates', run({ date: '2026-01-05', trains, dateRange: ['2026-01-05', '2026-01-09'] })],
    ['nullDates', run({ date: '2026-01-05', trains, dates: null })],
    ['thsrRange', run({ date: '2026-01-05', trains, dates }, { files: { 'data/thsr_schedule_dense.json': { date: '', trains: [], dateRange: ['2026-01-05', '2026-01-09'] } } })],
  ];
  ok('R13 [第十七批 V11 P2-4] 單位檔的 perDay＝各日班次數的中位數：手寫的五天班表跑 build_bounty_units，只開一天的臨時車與兩天的車不出單位、改點的第二份定義不多算、尖峰照各日中位數切；四天班表開兩天的車 perDay 0.5；' +
    '十份壞班表（第十七批三份：車次自帶行駛日、索引超出範圍、同一天重複；第十八批四份：dates 不是物件、是空的、鍵不是日期、某天沒車；第十九批三份：台鐵缺 dates、台鐵 dates 是 null、高鐵帶 dateRange 卻沒有 dates）都由腳本自己的檢查擋下、非零離開，舊的單位檔原封不動',
    good.status === 0 && JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(peak) === '[6,7,8,17,18,19]' &&
      even.status === 0 && JSON.stringify(gotEven) === JSON.stringify(wantEven) && JSON.stringify(peakEven) === '[6,7,8,17,18,19]' &&
      bad.length === 10 && bad.every(([k, r]) => r.status !== 0 && WANT_ERR[k].test(r.err) && r.kept),
    JSON.stringify({ status: good.status, peak, extra: got.filter(x => !want.includes(x)), missing: want.filter(x => !got.includes(x)),
      even: { status: even.status, peak: peakEven, extra: gotEven.filter(x => !wantEven.includes(x)), missing: wantEven.filter(x => !gotEven.includes(x)) },
      bad: bad.map(([k, r]) => `${k}:${r.status}:${r.kept ? 'kept' : 'OVERWRITTEN'}:${r.err.slice(0, 80)}`) }));
  // R13b（第十九批，第十三輪 P3-5）：六個輸入檔少一個 → 停下來、點名缺哪一個、舊的單位檔原封不動。
  // 舊版印「略過」照樣寫出清單：少掉的系統在下一發估值會整個退場。軌道檔與班表各缺一次，分屬不同系統。
  const miss = [['data/thsr_track.json', run({ date: '2026-01-05', trains, dates }, { omit: ['data/thsr_track.json'] })],
    ['data/afr_schedule_dense.json', run({ date: '2026-01-05', trains, dates }, { omit: ['data/afr_schedule_dense.json'] })]];
  ok('R13b 輸入檔少一個（高鐵軌道檔、林鐵班表各試一次）→ 非零離開、錯誤訊息點名缺的那個檔、舊的單位檔原封不動',
    miss.every(([f, r]) => r.status !== 0 && r.err.startsWith(`缺 ${f}：`) && r.kept),
    JSON.stringify(miss.map(([f, r]) => `${f}:${r.status}:${r.kept ? 'kept' : 'OVERWRITTEN'}:${r.err.slice(0, 90)}`)));
}

const failed = R.filter(r => !r.p);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
