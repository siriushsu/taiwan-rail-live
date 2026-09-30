// 籌碼純函式驗收（路段懸賞 v2 籌碼規則）。跑法：node scripts/verify_bounty_chips.mjs
// 期望值寫死在這裡，是定案的產品規則（每日上限 4、一趟至少 10 分鐘、第 1 座 4 之後每座 8、
// 南迴與臺東線 ×2、雲端搭乘 10 分鐘／每日 1 次／3 次換 1），不從設定檔或實作反推。
import { readFileSync } from 'node:fs';
import { tripChips, applyDailyChipCap, cloudRideCounts, cloudChipsEarned, priceOfNth, canRedeem, taipeiDay }
  from './bounty_chips_core.mjs';

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const chips = JSON.parse(readFileSync(new URL('../data/bounty_rules.json', import.meta.url), 'utf8')).chips;

const trip = (lineKeys, extra = {}) => ({ verdict: 'ok', lineKeys, durationSec: 1800, day: '2026-10-10', ...extra });

// C1 設定檔的數字就是定案的數字（設定檔被改掉時先在這裡紅，而不是默默改變行為）
ok('C1 設定＝定案數字', chips.perTrip === 1 && chips.minTripSec === 600 && chips.dailyChipCap === 4 &&
  chips.remoteMultiplier === 2 && JSON.stringify(chips.prices) === '[4,8]' &&
  chips.cloud.minSec === 600 && chips.cloud.dailyMax === 1 && chips.cloud.perChip === 3,
  JSON.stringify({ perTrip: chips.perTrip, minTripSec: chips.minTripSec, cap: chips.dailyChipCap, prices: chips.prices, cloud: chips.cloud }));

// C2 一趟值幾個籌碼
ok('C2a 一般趟（山線）＝1', tripChips(trip(['tra_sched|山線']), chips) === 1);
ok('C2b 南迴趟＝2', tripChips(trip(['tra_sched|南迴線']), chips) === 2);
ok('C2c 臺東線趟＝2', tripChips(trip(['tra_sched|臺東線']), chips) === 2);
ok('C2d 縱貫線趟＝1', tripChips(trip(['tra_sched|縱貫線南段']), chips) === 1);
ok('C2e 北迴線不算偏遠＝1', tripChips(trip(['tra_sched|北迴線']), chips) === 1);
ok('C2f 跨線趟只要有一段在南迴就 ×2', tripChips(trip(['tra_sched|屏東線', 'tra_sched|南迴線']), chips) === 2);
ok('C2g 高鐵趟＝1', tripChips(trip(['thsr_sched|THSR']), chips) === 1);
ok('C2h unusable＝0', tripChips(trip(['tra_sched|南迴線'], { verdict: 'unusable' }), chips) === 0);
ok('C2i suspect＝0', tripChips(trip(['tra_sched|南迴線'], { verdict: 'suspect' }), chips) === 0);
ok('C2j 599 秒＝0（未滿 10 分鐘）', tripChips(trip(['tra_sched|山線'], { durationSec: 599 }), chips) === 0);
ok('C2k 剛好 600 秒＝1', tripChips(trip(['tra_sched|山線'], { durationSec: 600 }), chips) === 1);
ok('C2l 沒有 durationSec＝0', tripChips(trip(['tra_sched|山線'], { durationSec: undefined }), chips) === 0);
ok('C2m null trip＝0', tripChips(null, chips) === 0);

// C3 每日上限（數的是 ×2 之後的籌碼）
ok('C3a 已得 3、再來一趟南迴只給 1', applyDailyChipCap(2, 3, chips) === 1);
ok('C3b 已得 4 給 0', applyDailyChipCap(1, 4, chips) === 0);
ok('C3c 已得 0、一般趟給 1', applyDailyChipCap(1, 0, chips) === 1);
ok('C3d 已經超過上限不會變負數', applyDailyChipCap(2, 9, chips) === 0);

// C4 期間活動（雙倍週）與偏遠相乘
{
  const ev = { ...chips, events: [{ id: 'dbl', from: '2026-10-09', to: '2026-10-11', multiplier: 2 }] };
  ok('C4a 雙倍週 × 南迴＝4', tripChips(trip(['tra_sched|南迴線']), ev) === 4);
  ok('C4b 雙倍週 × 一般＝2', tripChips(trip(['tra_sched|山線']), ev) === 2);
  ok('C4c 活動期間外＝1', tripChips(trip(['tra_sched|山線'], { day: '2026-10-12' }), ev) === 1);
  ok('C4d 活動首日與末日都算', tripChips(trip(['tra_sched|山線'], { day: '2026-10-09' }), ev) === 2 &&
    tripChips(trip(['tra_sched|山線'], { day: '2026-10-11' }), ev) === 2);
  const evLine = { ...chips, events: [{ id: 'nl', from: '2026-10-01', to: '2026-10-31', multiplier: 3, lines: ['tra_sched|北迴線'] }] };
  ok('C4e 限線活動：別的線不加', tripChips(trip(['tra_sched|山線']), evLine) === 1 &&
    tripChips(trip(['tra_sched|北迴線']), evLine) === 3);
}

// C5 價格：第 1 座 4、之後每座 8（最後一格沿用）
ok('C5 價格 4/8/8/8', priceOfNth(1, chips) === 4 && priceOfNth(2, chips) === 8 &&
  priceOfNth(5, chips) === 8 && priceOfNth(9, chips) === 8,
  [1, 2, 5, 9].map(n => priceOfNth(n, chips)).join('/'));

// C6 canRedeem 四種結果
{
  const a = canRedeem('south-coast', [], 5, chips);
  ok('C6a 餘額 5 兌第一座 → ok, cost 4', a.ok === true && a.cost === 4, JSON.stringify(a));
  const b = canRedeem('shifen', ['south-coast'], 7, chips);
  ok('C6b 餘額 7 兌第二座（價 8）→ not_enough', b.ok === false && b.why === 'not_enough' && b.cost === 8, JSON.stringify(b));
  const c = canRedeem('south-coast', ['south-coast'], 99, chips);
  ok('C6c 已解鎖 → already', c.ok === false && c.why === 'already', JSON.stringify(c));
  const d = canRedeem('taipei-under', [], 99, chips);
  ok('C6d 不在可兌換清單 → unknown_scene', d.ok === false && d.why === 'unknown_scene', JSON.stringify(d));
  const e = canRedeem('alishan', ['south-coast', 'shifen', 'viaduct'], 8, chips);
  ok('C6e 第四座剛好 8 → ok', e.ok === true && e.cost === 8, JSON.stringify(e));
}

// C7 通行證沒有倍率：trip 或 chips 帶 plus:true，結果逐項不變
{
  const plusTrip = t => ({ ...t, plus: true, plusActive: true });
  const plusChips = { ...chips, plus: true };
  const cases = [['tra_sched|山線'], ['tra_sched|南迴線'], ['thsr_sched|THSR']];
  ok('C7a tripChips 不看 plus', cases.every(k => tripChips(plusTrip(trip(k)), plusChips) === tripChips(trip(k), chips)));
  ok('C7b 價格與兌換不看 plus', priceOfNth(1, plusChips) === 4 &&
    JSON.stringify(canRedeem('shifen', ['south-coast'], 7, plusChips)) === JSON.stringify(canRedeem('shifen', ['south-coast'], 7, chips)));
}

// C8 雲端搭乘
ok('C8a 600 秒、今天沒領過 → 算', cloudRideCounts({ sec: 600, day: '2026-10-10' }, [], chips) === true);
ok('C8b 599 秒 → 不算', cloudRideCounts({ sec: 599, day: '2026-10-10' }, [], chips) === false);
ok('C8c 今天已領過 → 不算', cloudRideCounts({ sec: 900, day: '2026-10-10' }, ['2026-10-10'], chips) === false);
ok('C8d 昨天領過不影響今天', cloudRideCounts({ sec: 900, day: '2026-10-10' }, ['2026-10-09'], chips) === true);
ok('C8e 次數換籌碼 0/1/2/3/5/6 → 0/0/0/1/1/2',
  [0, 1, 2, 3, 5, 6].map(n => cloudChipsEarned(n, chips)).join('') === '000112');

// C9 台北日期：UTC 16:00 前後跨日
ok('C9 taipeiDay 以台北午夜換日', taipeiDay(Date.parse('2026-10-09T15:59:59Z')) === '2026-10-09' &&
  taipeiDay(Date.parse('2026-10-09T16:00:00Z')) === '2026-10-10');

const failed = R.filter(r => !r.p);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
