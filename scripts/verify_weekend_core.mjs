// 週末／連假核心判定的表格驅動測試(純 node,不開瀏覽器)。
// 用法:node scripts/verify_weekend_core.mjs   /   npm run check-weekend-core
// 這支刻意不讀 data/tw_daytype.json 當唯一輸入:真實日曆會逐年變,把它當測試輸入等於
// 判準跟著資料漂移。真實日曆另有一條專屬檢查(見 Section R),其餘全用手寫小表。
import { twDayStr, addDays, isWorkday, nextHolidaySpan, weekday, evValidDay, splitEvents, dedupeEvents } from './weekend_core.mjs';

let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

// 手寫小表:只放這幾條測試會用到的日子,值的語意與 data/tw_daytype.json 相同
// (1=放假含補假、2=補行上班的週六)。
const T = {
  '2026-09-25': 1,             // 中秋(週五)
  '2026-10-09': 1, '2026-10-10': 1,   // 國慶(週五、週六)
  '2026-10-25': 1, '2026-10-26': 1,   // 光復節(週日、週一補假)
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1,
  '2026-02-18': 1, '2026-02-19': 1, '2026-02-20': 1,  // 春節六天
  '2026-11-07': 2,             // 補行上班的週六(真實日曆沒有,這裡刻意造一個)
};

console.log('\n【A】台北日期字串');
// 2026-09-04T15:30:00Z ＝ 台北 2026-09-04 23:30 ⇒ 仍是 09-04
chk('A1 UTC 15:30 → 台北同日', twDayStr(Date.parse('2026-09-04T15:30:00Z')) === '2026-09-04');
// 2026-09-04T16:30:00Z ＝ 台北 2026-09-05 00:30 ⇒ 跨到隔日
chk('A2 UTC 16:30 → 台北隔日', twDayStr(Date.parse('2026-09-04T16:30:00Z')) === '2026-09-05');

console.log('\n【B】日期加減');
chk('B1 跨月', addDays('2026-09-30', 1) === '2026-10-01');
chk('B2 跨年', addDays('2026-12-31', 1) === '2027-01-01');
chk('B3 倒退', addDays('2026-03-01', -1) === '2026-02-28');
chk('B4 星期幾', weekday('2026-09-04') === 5 && weekday('2026-09-06') === 0);  // 五、日

console.log('\n【C】上班日判定');
chk('C1 一般週三是上班日', isWorkday('2026-09-02', T) === true);
chk('C2 一般週六不是上班日', isWorkday('2026-09-05', T) === false);
chk('C3 一般週日不是上班日', isWorkday('2026-09-06', T) === false);
chk('C4 國定假日(週五)不是上班日', isWorkday('2026-09-25', T) === false);
chk('C5 補行上班的週六是上班日', isWorkday('2026-11-07', T) === true);

console.log('\n【D】假期區間');
const eq = (span, from, to, n) => !!span && span.from === from && span.to === to && span.days.length === n;
chk('D1 一般週五 → 六日兩天', eq(nextHolidaySpan('2026-09-04', T), '2026-09-05', '2026-09-06', 2));
chk('D2 中秋前一天(週四) → 9/25-9/27 三天', eq(nextHolidaySpan('2026-09-24', T), '2026-09-25', '2026-09-27', 3));
chk('D3 國慶(週五+週六) → 10/9-10/11 三天', eq(nextHolidaySpan('2026-10-08', T), '2026-10-09', '2026-10-11', 3));
chk('D4 光復節(週日+週一補假) → 10/24-10/26 三天', eq(nextHolidaySpan('2026-10-23', T), '2026-10-24', '2026-10-26', 3));
// 🔴 fromDay 取 02-13（週五、上班日）。02-14 本身是週六，拿它當起點等於站在假期裡。
// 期望值 9 天不是 6 天：春節那六個放假日的前後各黏著一個自然週末（02-14 週六、02-21+02-22），
// 連成一段。這正是連假該有的樣子——頁面標題會寫「春節連假 02/14–02/22（9 天）」。
chk('D5 春節連假吃進前後週末共九天', eq(nextHolidaySpan('2026-02-13', T), '2026-02-14', '2026-02-22', 9));
// 補班週六:11/7 上班 ⇒ 那個週末只剩週日 11/8
chk('D6 補班週六 → 只剩週日一天', eq(nextHolidaySpan('2026-11-06', T), '2026-11-08', '2026-11-08', 1));
// 已經在假期中間:只回剩下的日子,不往回補
// (刻意如此——週日開頁面時列出昨天已結束的活動是錯的,見計畫 Task 1 註解)
chk('D7 站在週日 → 只回週日', eq(nextHolidaySpan('2026-09-06', T), '2026-09-06', '2026-09-06', 1));
chk('D8 站在假期第一天 → 回整段', eq(nextHolidaySpan('2026-09-25', T), '2026-09-25', '2026-09-27', 3));
// 日曆表用完:退回只看週幾,仍找得到週末
chk('D9 表外日期退回週幾', eq(nextHolidaySpan('2030-01-01', {}), '2030-01-05', '2030-01-06', 2));

console.log('\n【E】日期欄位守門');
chk('E1 正常日期', evValidDay('2026-09-05') === true);
chk('E2 少補零', evValidDay('2026-9-5') === false);
chk('E3 斜線', evValidDay('2026/09/05') === false);
chk('E4 月份超界', evValidDay('2026-13-01') === false);
chk('E5 日子超界', evValidDay('2026-08-32') === false);
// 2026-02-29 不存在,但 Date 會靜靜滾成 03-01 ⇒ 要靠回寫比對擋掉
chk('E6 不存在的閏日', evValidDay('2026-02-29') === false);
chk('E7 中文', evValidDay('即日起') === false);
chk('E8 非字串', evValidDay(null) === false);

console.log('\n【F】兩層分流');
const SPAN = { from: '2026-09-05', to: '2026-09-06', days: ['2026-09-05', '2026-09-06'] };
const EVENTS = [
  { id: 'a1', title: '市集', start: '2026-09-05', end: '2026-09-05', url: 'https://x.invalid/1',
    anchor: { kind: 'station', sys: 'mrt', name: '廣慈/奉天宮' } },
  { id: 'a2', title: '市集', start: '2026-09-06', end: '2026-09-06', url: 'https://x.invalid/1',
    note: '輕食與文創', anchor: { kind: 'station', sys: 'mrt', name: '廣慈/奉天宮' } },
  { id: 'b1', title: '音樂會', start: '2026-09-05', end: '2026-09-05', url: 'https://x.invalid/2',
    anchor: { kind: 'station', sys: 'mrt', name: '廣慈/奉天宮' } },
  { id: 'c1', title: '長期特展', start: '2026-08-15', end: '2026-09-13', url: 'https://x.invalid/3',
    anchor: { kind: 'station', sys: 'mrt', name: '大安森林公園' } },
  { id: 'd1', title: '兩站聯名', start: '2026-09-01', end: '2026-12-31', url: 'https://x.invalid/4',
    anchor: { kind: 'station', sys: 'afr_sched', name: '北門' } },
  { id: 'd2', title: '兩站聯名', start: '2026-09-01', end: '2026-12-31', url: 'https://x.invalid/4',
    anchor: { kind: 'station', sys: 'afr_sched', name: '阿里山' } },
  { id: 'e1', title: '已結束', start: '2026-08-01', end: '2026-08-31', url: 'https://x.invalid/5',
    anchor: { kind: 'station', sys: 'mrt', name: '中山' } },
  { id: 'f1', title: '還沒開始', start: '2026-10-01', end: '2026-10-02', url: 'https://x.invalid/6',
    anchor: { kind: 'station', sys: 'mrt', name: '中山' } },
  { id: 'g1', title: '壞日期', start: '2026-9-5', end: '2026-09-06', url: 'https://x.invalid/7',
    anchor: { kind: 'station', sys: 'mrt', name: '中山' } },
  { id: 'h1', title: '週末開跑', start: '2026-09-06', end: '2026-09-20', url: 'https://x.invalid/8',
    anchor: { kind: 'system', sys: 'tymc' } },
  // 🔴 這一筆是【只靠 endsIn 入選】的唯一一筆:它在區間之前就開始,在區間內結束。
  // 沒有它的話 `startsIn || endsIn` 的第二個運算元零覆蓋——把 endsIn 整個拿掉測試照樣全綠。
  // 產品上這也是最該進限定層的一類:「這是最後一個週末」正是使用者最需要知道的事。
  { id: 'j1', title: '最後一個週末', start: '2026-08-20', end: '2026-09-05', url: 'https://x.invalid/10',
    anchor: { kind: 'station', sys: 'mrt', name: '淡水' } },
  { id: 'i1', title: '市集', start: '2026-09-05', end: '2026-09-05', url: 'https://x.invalid/9',
    anchor: { kind: 'station', sys: 'tmrt', name: '市政府' } },
];
const split = splitEvents(EVENTS, SPAN);
chk('F1 限定層 6 筆', split.onlyThis.length === 6, `實得 ${split.onlyThis.length}`);
chk('F2 限定層含週末開跑那筆', split.onlyThis.some(e => e.id === 'h1'));
chk('F3 長期檔進 alsoOpen', split.alsoOpen.some(e => e.id === 'c1'));
chk('F4 兩站聯名兩筆都進 alsoOpen', split.alsoOpen.filter(e => e.title === '兩站聯名').length === 2);
chk('F5 已結束不入選', ![...split.onlyThis, ...split.alsoOpen].some(e => e.id === 'e1'));
chk('F6 還沒開始不入選', ![...split.onlyThis, ...split.alsoOpen].some(e => e.id === 'f1'));
// 壞日期那筆必須整筆被丟掉,而且不得把其他筆一起拖垮(它會讓 addDays 拋 RangeError)
chk('F7 壞日期整筆被濾掉', ![...split.onlyThis, ...split.alsoOpen].some(e => e.id === 'g1'));
chk('F8 這個週末結束的長期檔也進限定層', split.onlyThis.some(e => e.id === 'j1'));

console.log('\n【G】去重');
const merged = dedupeEvents(split.onlyThis, SPAN);
chk('G1 6 筆併成 5 場', merged.length === 5, `實得 ${merged.length}`);
const mkt = merged.find(m => m.title === '市集');
chk('G2 市集併出兩天', mkt && mkt.days.join(',') === '2026-09-05,2026-09-06');
chk('G3 市集只保留一個地點', mkt && mkt.places.length === 1);
chk('G4 note 取有填的那份', mkt && mkt.note === '輕食與文創');
chk('G5 保留兩個原始 id', mkt && mkt.ids.length === 2);
const two = dedupeEvents(split.alsoOpen, SPAN).find(m => m.title === '兩站聯名');
chk('G6 兩站聯名併成一則、兩個地點', two && two.places.length === 2);
chk('G7 依首日排序', merged[0].days[0] <= merged[merged.length - 1].days[0]);

console.log(`\n${fail ? '❌' : '✅'} weekend-core：${pass} 過 / ${fail} 失敗`);
if (fail) { console.error('失敗項目：\n  - ' + bad.join('\n  - ')); process.exit(1); }
