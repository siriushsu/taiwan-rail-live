// 點數純函式驗收（路段懸賞 v3：沿線 1 公里 1 點）。跑法：node scripts/verify_bounty_chips.mjs
// 期望值寫死在這裡，是定案的產品規則（1 公里 1 點、各線里程各乘自己的倍率之後加總再捨去、南迴與臺東線 ×2、
// 一趟至少 10 分鐘而且沿線至少移動 1000 m、每日上限 500 點、第 1 座 200 之後每座 300、雲端搭乘 10 分鐘／每日 1 次／每次 20 點、
// v2 的 1 顆籌碼換 50 點），不從設定檔或實作反推。
import { readFileSync } from 'node:fs';
import { tripPoints, applyDailyChipCap, cloudRideCounts, priceOfNth, canRedeem, taipeiDay }
  from './bounty_chips_core.mjs';

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const chips = JSON.parse(readFileSync(new URL('../data/bounty_rules.json', import.meta.url), 'utf8')).chips;

// 一趟：預設 30 分鐘。lines 是 [線鍵, 收下的沿線里程（公尺）] 的清單，一條線一筆。
const trip = (lines, extra = {}) => ({ verdict: 'ok', durationSec: 1800, day: '2026-10-10', lines: lines.map(([key, m]) => ({ key, m })), ...extra });
const pts = (lines, extra, c = chips) => tripPoints(trip(lines, extra), c);

// C1 設定檔的數字就是定案的數字（設定檔被改掉時先在這裡紅，而不是默默改變行為）。
// perTrip 0 與 cloud.perChip 1 是給舊客端讀的相容值（docs/bounty/contract-v3.md），伺服器不用。
ok('C1 設定＝定案數字', chips.unit === 'point' && chips.perKm === 1 && chips.perTrip === 0 &&
  chips.minTripSec === 600 && chips.minTripMoveM === 1000 && chips.dailyChipCap === 500 &&
  chips.remoteMultiplier === 2 && JSON.stringify(chips.remoteLines) === '["tra_sched|南迴線","tra_sched|臺東線"]' &&
  JSON.stringify(chips.prices) === '[200,300]' && chips.chipToPoints === 50 &&
  chips.cloud.minSec === 600 && chips.cloud.dailyMax === 1 && chips.cloud.perChip === 1 && chips.cloud.points === 20,
  JSON.stringify({ unit: chips.unit, perKm: chips.perKm, perTrip: chips.perTrip, cap: chips.dailyChipCap, prices: chips.prices,
    chipToPoints: chips.chipToPoints, cloud: chips.cloud }));

// C2 一趟值幾點
ok('C2a 98.4 km＝98 點、98.9 km 也是 98（捨去，不四捨五入）、99 km＝99',
  pts([['tra_sched|山線', 98400]]) === 98 && pts([['tra_sched|山線', 98900]]) === 98 && pts([['tra_sched|山線', 99000]]) === 99,
  [98400, 98900, 99000].map(m => pts([['tra_sched|山線', m]])).join('/'));
// 伺服器的里程是兩個收下點的沿線里程相減（存到 0.1 m），浮點相減差一個尾數不能少給一點
// （8302.3 − 3302.3 ＝ 4999.999999999999、2200.2 − 1200.2 ＝ 999.9999999999998）
ok('C2b 里程是浮點相減的結果：差一個尾數不少給（5 km＝5 點），剛好 1 km 也過門檻',
  pts([['tra_sched|山線', 8302.3 - 3302.3]]) === 5 && pts([['tra_sched|山線', 2200.2 - 1200.2]]) === 1,
  [8302.3 - 3302.3, 2200.2 - 1200.2].map(m => pts([['tra_sched|山線', m]])).join('/'));
ok('C2c 南迴線 ×2：50.6 km＝101 點（先乘倍率再捨去，不是 50×2）', pts([['tra_sched|南迴線', 50600]]) === 101,
  String(pts([['tra_sched|南迴線', 50600]])));
ok('C2d 臺東線 ×2：30 km＝60 點', pts([['tra_sched|臺東線', 30000]]) === 60);
ok('C2e 北迴線不算偏遠：30 km＝30 點', pts([['tra_sched|北迴線', 30000]]) === 30);
ok('C2f 兩條線里程相加：山線 30.5 km＋縱貫線南段 40.7 km＝71 點（加總後捨去）',
  pts([['tra_sched|山線', 30500], ['tra_sched|縱貫線南段', 40700]]) === 71,
  String(pts([['tra_sched|山線', 30500], ['tra_sched|縱貫線南段', 40700]])));
ok('C2g 跨線趟只有偏遠那段 ×2：屏東線 20.3 km＋南迴線 30.4 km＝81 點',
  pts([['tra_sched|屏東線', 20300], ['tra_sched|南迴線', 30400]]) === 81,
  String(pts([['tra_sched|屏東線', 20300], ['tra_sched|南迴線', 30400]])));
ok('C2h 高鐵 150 km＝150 點', pts([['thsr_sched|THSR', 150000]]) === 150);
ok('C2i unusable／suspect＝0', pts([['tra_sched|南迴線', 50000]], { verdict: 'unusable' }) === 0 &&
  pts([['tra_sched|南迴線', 50000]], { verdict: 'suspect' }) === 0);
ok('C2j 599 秒＝0（未滿 10 分鐘）、剛好 600 秒照給', pts([['tra_sched|山線', 20000]], { durationSec: 599 }) === 0 &&
  pts([['tra_sched|山線', 20000]], { durationSec: 600 }) === 20);
ok('C2k 沒有 durationSec＝0、null trip＝0', pts([['tra_sched|山線', 20000]], { durationSec: undefined }) === 0 && tripPoints(null, chips) === 0);
// 整趟停在一站不給：各線里程加總不到 1000 m 就是 0，剛好 1000 m 照給；兩條線各 600 m 加起來夠。偏遠線同樣。
ok('C2l 移動 999 m＝0、剛好 1000 m＝1 點', pts([['tra_sched|山線', 999]]) === 0 && pts([['tra_sched|山線', 1000]]) === 1);
ok('C2m 兩條線各 600 m：加總 1.2 km 過門檻＝1 點', pts([['tra_sched|山線', 600], ['tra_sched|海線', 600]]) === 1);
ok('C2n 偏遠線只停一站＝0、移動 1000 m＝2 點', pts([['tra_sched|南迴線', 0]]) === 0 && pts([['tra_sched|南迴線', 1000]]) === 2);
ok('C2o 沒有 lines、里程缺值或不是數字＝0', tripPoints({ ...trip([]), lines: undefined }, chips) === 0 &&
  pts([['tra_sched|山線', undefined]]) === 0 && pts([['tra_sched|山線', null]]) === 0 && pts([['tra_sched|山線', NaN]]) === 0 &&
  pts([['tra_sched|山線', -5000]]) === 0);

// C3 每日上限 500 點（數的是加倍之後的點數）
ok('C3a 已得 450、這一趟 98 → 只給 50', applyDailyChipCap(98, 450, chips) === 50);
ok('C3b 一趟就超過上限（南迴 300 km＝600 點）→ 截在 500', applyDailyChipCap(pts([['tra_sched|南迴線', 300000]]), 0, chips) === 500,
  String(applyDailyChipCap(pts([['tra_sched|南迴線', 300000]]), 0, chips)));
ok('C3c 已得 500 → 0；已經超過上限不會變負數', applyDailyChipCap(10, 500, chips) === 0 && applyDailyChipCap(10, 900, chips) === 0);

// C4 期間活動（雙倍週）與偏遠相乘；限線活動只加在那條線
{
  const ev = { ...chips, events: [{ id: 'dbl', from: '2026-10-09', to: '2026-10-11', multiplier: 2 }] };
  ok('C4a 雙倍週 × 南迴 10 km＝40 點', pts([['tra_sched|南迴線', 10000]], {}, ev) === 40);
  ok('C4b 雙倍週 × 一般 10 km＝20 點', pts([['tra_sched|山線', 10000]], {}, ev) === 20);
  ok('C4c 活動期間外＝10 點', pts([['tra_sched|山線', 10000]], { day: '2026-10-12' }, ev) === 10);
  ok('C4d 活動首日與末日都算', pts([['tra_sched|山線', 10000]], { day: '2026-10-09' }, ev) === 20 &&
    pts([['tra_sched|山線', 10000]], { day: '2026-10-11' }, ev) === 20);
  const evLine = { ...chips, events: [{ id: 'nl', from: '2026-10-01', to: '2026-10-31', multiplier: 3, lines: ['tra_sched|北迴線'] }] };
  ok('C4e 限線活動：跨線趟只有那條線 ×3（宜蘭線 10 km＋北迴線 10 km＝40 點）',
    pts([['tra_sched|宜蘭線', 10000], ['tra_sched|北迴線', 10000]], {}, evLine) === 40 && pts([['tra_sched|山線', 10000]], {}, evLine) === 10);
}

// C5 價格：第 1 座 200、之後每座 300（最後一格沿用）
ok('C5 價格 200/300/300/300', priceOfNth(1, chips) === 200 && priceOfNth(2, chips) === 300 &&
  priceOfNth(5, chips) === 300 && priceOfNth(9, chips) === 300,
  [1, 2, 5, 9].map(n => priceOfNth(n, chips)).join('/'));

// C6 canRedeem 四種結果
{
  const a = canRedeem('south-coast', [], 250, chips);
  ok('C6a 餘額 250 兌第一座 → ok, cost 200', a.ok === true && a.cost === 200, JSON.stringify(a));
  const b = canRedeem('shifen', ['south-coast'], 299, chips);
  ok('C6b 餘額 299 兌第二座（價 300）→ not_enough', b.ok === false && b.why === 'not_enough' && b.cost === 300, JSON.stringify(b));
  const c = canRedeem('south-coast', ['south-coast'], 9999, chips);
  ok('C6c 已解鎖 → already', c.ok === false && c.why === 'already', JSON.stringify(c));
  const d = canRedeem('no-such-scene', [], 9999, chips);
  ok('C6d 不在可兌換清單 → unknown_scene', d.ok === false && d.why === 'unknown_scene', JSON.stringify(d));
  const e = canRedeem('alishan', ['south-coast', 'shifen', 'viaduct'], 300, chips);
  ok('C6e 第四座剛好 300 → ok', e.ok === true && e.cost === 300, JSON.stringify(e));
}

// C7 通行證沒有倍率：trip 或 chips 帶 plus:true，結果逐項不變
{
  const plusTrip = t => ({ ...t, plus: true, plusActive: true });
  const plusChips = { ...chips, plus: true };
  const cases = [[['tra_sched|山線', 20000]], [['tra_sched|南迴線', 20000]], [['thsr_sched|THSR', 20000]]];
  ok('C7a tripPoints 不看 plus', cases.every(l => tripPoints(plusTrip(trip(l)), plusChips) === tripPoints(trip(l), chips)));
  ok('C7b 價格與兌換不看 plus', priceOfNth(1, plusChips) === 200 &&
    JSON.stringify(canRedeem('shifen', ['south-coast'], 299, plusChips)) === JSON.stringify(canRedeem('shifen', ['south-coast'], 299, chips)));
}

// C8 雲端搭乘（每次入帳 cloud.points＝20 點，見 C1；入帳本身在 verify_bounty_cloud.mjs）
ok('C8a 600 秒、今天沒領過 → 算', cloudRideCounts({ sec: 600, day: '2026-10-10' }, [], chips) === true);
ok('C8b 599 秒 → 不算', cloudRideCounts({ sec: 599, day: '2026-10-10' }, [], chips) === false);
ok('C8c 今天已領過 → 不算', cloudRideCounts({ sec: 900, day: '2026-10-10' }, ['2026-10-10'], chips) === false);
ok('C8d 昨天領過不影響今天', cloudRideCounts({ sec: 900, day: '2026-10-10' }, ['2026-10-09'], chips) === true);

// C9 台北日期：UTC 16:00 前後跨日
ok('C9 taipeiDay 以台北午夜換日', taipeiDay(Date.parse('2026-10-09T15:59:59Z')) === '2026-10-09' &&
  taipeiDay(Date.parse('2026-10-09T16:00:00Z')) === '2026-10-10');

const failed = R.filter(r => !r.p);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
