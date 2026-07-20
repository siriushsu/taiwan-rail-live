// /api/delay-history(worker.js)離線回歸測試——純 Node,直接 import worker.js 的純函式導出。
// 不起伺服器、不打 D1:只驗 delayHistoryWindow 的視窗計算、buildDelayHistoryBody 的篩/排/型別轉換、
// isValidTrainNo 的白名單驗證。執行:node scripts/verify_delay_history.mjs;
// 全綠 exit 0,任一 FAIL exit 1(模式抄 verify_station_events.mjs)。
import { _delayHistory } from '../worker.js';
const { delayHistoryWindow, buildDelayHistoryBody, isValidTrainNo } = _delayHistory;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── A. delayHistoryWindow ───────────────────────────────────────────────
// 2026-07-19 往前 89 天(含首尾共 90 天窗)= 2026-04-21(day-of-year 200 - 111 = 89,手算驗過)。
{
  const win = delayHistoryWindow('2026-07-19', 90);
  ok('A1 90天窗起訖正確', win && win.startDate === '2026-04-21' && win.maxDate === '2026-07-19', JSON.stringify(win));
}
ok('A2 dbMaxDate=null 回 null', delayHistoryWindow(null, 90) === null);
ok('A3 dbMaxDate=空字串 回 null(falsy 防呆)', delayHistoryWindow('', 90) === null);

// ── B. buildDelayHistoryBody:視窗邊界、排序、型別、髒資料 ──────────────────
const win90 = delayHistoryWindow('2026-07-19', 90);   // {startDate:'2026-04-21', maxDate:'2026-07-19'}
const bRows = [
  { service_date: '2026-07-19', final_delay: 6, max_delay: 11 },   // = maxDate → 留
  { service_date: '2026-04-20', final_delay: 99, max_delay: 99 },  // 第 91 天(startDate 前一天)→ 切
  { service_date: '2026-06-01', final_delay: 3, max_delay: 5 },    // 窗中段 → 留
  { service_date: '2026-04-21', final_delay: 0, max_delay: 2 },    // = startDate 邊界 → 留(含頭)
  { service_date: '2026-07-20', final_delay: 50, max_delay: 50 },  // maxDate 之後(理論上 D1 查詢不會回,防禦性測試)→ 切
  { service_date: '2026-05-10', final_delay: 'abc', max_delay: 5 },// final_delay 非數字 → toInt null → 整列丟棄
  { service_date: '2026-05-11', final_delay: '7', max_delay: '12' }, // 數字字串 → 應轉成 number 留下
];
const bBody = buildDelayHistoryBody('152', bRows, 90, win90, '2026-07-20T01:00:00Z');

ok('B1 90天窗邊界正確(第91天切掉、maxDate後也切掉、髒資料切掉,剩4筆)', bBody.days.length === 4, JSON.stringify(bBody.days));
ok('B2 不含第91天(2026-04-20)', !bBody.days.some(d => d.d === '2026-04-20'));
ok('B3 不含 maxDate 之後(2026-07-20)', !bBody.days.some(d => d.d === '2026-07-20'));
ok('B4 不含髒資料列(2026-05-10)', !bBody.days.some(d => d.d === '2026-05-10'));
ok('B5 升冪排序(首筆=startDate 2026-04-21)', bBody.days[0] && bBody.days[0].d === '2026-04-21', JSON.stringify(bBody.days[0]));
ok('B6 升冪排序(末筆=maxDate 2026-07-19)', bBody.days[3] && bBody.days[3].d === '2026-07-19', JSON.stringify(bBody.days[3]));
{
  const sorted = bBody.days.every((d, i) => i === 0 || bBody.days[i - 1].d <= d.d);
  ok('B7 全序列嚴格升冪', sorted, JSON.stringify(bBody.days.map(d => d.d)));
}
{
  const allInt = bBody.days.every(d => Number.isInteger(d.fd) && Number.isInteger(d.md));
  ok('B8 全部 fd/md 為整數型別', allInt, JSON.stringify(bBody.days));
}
{
  const coerced = bBody.days.find(d => d.d === '2026-05-11');
  ok('B9 數字字串正確轉型(fd=7,md=12,皆為 number)', coerced && coerced.fd === 7 && coerced.md === 12 && typeof coerced.fd === 'number' && typeof coerced.md === 'number', JSON.stringify(coerced));
}
ok('B10 train 回填正確', bBody.train === '152');
ok('B11 _meta 正確(window_days/n/date_range/generated)',
  bBody._meta.window_days === 90 && bBody._meta.n === 4
  && bBody._meta.date_range[0] === '2026-04-21' && bBody._meta.date_range[1] === '2026-07-19'
  && bBody._meta.generated === '2026-07-20T01:00:00Z',
  JSON.stringify(bBody._meta));

// ── C. win=null(表內完全無資料):空結果形狀 ────────────────────────────
{
  const empty = buildDelayHistoryBody('152', bRows, 90, null, '2026-07-20T01:00:00Z');
  ok('C1 win=null 回空陣列', Array.isArray(empty.days) && empty.days.length === 0, JSON.stringify(empty.days));
  ok('C2 win=null 的 _meta.date_range 為 null', empty._meta.date_range === null, JSON.stringify(empty._meta));
  ok('C3 win=null 的 _meta.n=0', empty._meta.n === 0);
  ok('C4 win=null 的 _meta.window_days 仍帶正確值', empty._meta.window_days === 90);
  ok('C5 train 欄位即使空結果仍回填', empty.train === '152');
}

// ── D. win 有效但該車次窗內零列(表不空、僅這班車近期無資料):空陣列但 date_range 仍填 ──
{
  const zero = buildDelayHistoryBody('999', [], 90, win90, '2026-07-20T01:00:00Z');
  ok('D1 該車次零列 → days 空陣列', zero.days.length === 0);
  ok('D2 該車次零列 → date_range 仍是實際查過的窗(非 null)', zero._meta.date_range[0] === '2026-04-21' && zero._meta.date_range[1] === '2026-07-19', JSON.stringify(zero._meta));
}

// ── E. isValidTrainNo:白名單擋 SQL injection / path traversal / 空字串 / 超長 ──
ok('E1 合法車次(3碼數字)通過', isValidTrainNo('152') === true);
ok('E2 合法車次(6碼,長度上限)通過', isValidTrainNo('123456') === true);
ok('E3 合法車次(英數混合)通過', isValidTrainNo('A1') === true);
ok('E4 擋 SQL injection 片段(空格/引號)', isValidTrainNo("1' OR") === false);
ok('E5 擋 path traversal 片段', isValidTrainNo('../') === false);
ok('E6 擋空字串', isValidTrainNo('') === false);
ok('E7 擋超長(7碼)', isValidTrainNo('1234567') === false);

const failed = results.filter(r => !r.pass);
console.log(`\n${'═'.repeat(40)}\n總計 ${results.length} 項,PASS ${results.length - failed.length},FAIL ${failed.length}`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join('; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
