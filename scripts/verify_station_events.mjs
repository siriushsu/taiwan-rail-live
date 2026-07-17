// 台鐵逐站觀測事件擷取(worker.js)離線回歸測試——純 Node,直接 import worker.js 的純函式導出。
// 不起伺服器、不打 D1/TDX:只驗 diffTrains 的發事件/播種/跳過邏輯與 twDayFromMemAt 台北日換算。
// 執行:node scripts/verify_station_events.mjs;全綠 exit 0,任一 FAIL exit 1(模式抄 verify_anomaly.mjs)。
import { _stationEvents } from '../worker.js';
const { diffTrains, twDayFromMemAt } = _stationEvents;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
// prev 快照 Map(鏡射 worker 內 snapshotTrains 的形狀:key=String(no),值 {sta:String,status,delay})
const mkPrev = (arr) => new Map(arr.map(t => [String(t.no), { sta: String(t.sta), status: t.status, delay: t.delay }]));

// T1 首輪 prev=null:只播種、零事件(避免 isolate 重生把整批當新事件)
ok('T1 首輪(prev=null)零事件', diffTrains(null, [{ no: '110', sta: '1000', status: 1, delay: 0 }]).length === 0);

// T2 換站 → 發事件(帶新站)
{
  const out = diffTrains(mkPrev([{ no: '110', sta: '1000', status: 2, delay: 3 }]),
    [{ no: '110', sta: '1010', status: 0, delay: 3 }]);
  ok('T2 換站發事件', out.length === 1 && out[0].no === '110' && out[0].sta === '1010', JSON.stringify(out));
}

// T3 換狀態(同站)→ 發事件
{
  const out = diffTrains(mkPrev([{ no: '110', sta: '1000', status: 1, delay: 3 }]),
    [{ no: '110', sta: '1000', status: 2, delay: 3 }]);
  ok('T3 換狀態發事件', out.length === 1 && out[0].status === 2, JSON.stringify(out));
}

// T4 只變誤點(同站同狀態)→ 發 delay_max 升級列(diff 帶當下誤點,是否升級由 SQL upsert 判定)
{
  const out = diffTrains(mkPrev([{ no: '110', sta: '1000', status: 1, delay: 3 }]),
    [{ no: '110', sta: '1000', status: 1, delay: 8 }]);
  ok('T4 只變誤點發列(delay=當下)', out.length === 1 && out[0].delay === 8 && out[0].sta === '1000' && out[0].status === 1, JSON.stringify(out));
}

// T5 完全無變化 → 零輸出
{
  const out = diffTrains(mkPrev([{ no: '110', sta: '1000', status: 1, delay: 3 }]),
    [{ no: '110', sta: '1000', status: 1, delay: 3 }]);
  ok('T5 無變化零輸出', out.length === 0, JSON.stringify(out));
}

// T6 空/缺 sta、空 no 一律跳過(即使是新車)
{
  const out = diffTrains(new Map(), [
    { no: '201', sta: '', status: 1, delay: 0 },     // sta 空
    { no: '202', status: 1, delay: 0 },              // sta 缺
    { no: '', sta: '1000', status: 1, delay: 0 },    // no 空
    { no: '203', sta: '1000', status: 1, delay: 0 }, // 正常新車 → 唯一應發
  ]);
  ok('T6 空/缺 sta、空 no 跳過', out.length === 1 && out[0].no === '203', JSON.stringify(out));
}

// T7 新出現車 → 發事件(prev 沒這車);既有未變車不重發
{
  const out = diffTrains(mkPrev([{ no: '110', sta: '1000', status: 1, delay: 3 }]), [
    { no: '110', sta: '1000', status: 1, delay: 3 }, // 未變
    { no: '888', sta: '2000', status: 0, delay: 1 }, // 新車
  ]);
  ok('T7 新出現車發事件、未變車不重發', out.length === 1 && out[0].no === '888', JSON.stringify(out));
}

// T8 台北日換算:+08:00 直取(不可再 +8;跨午夜的凌晨場景防「誤回 UTC 日」)
ok('T8a +08:00 直取(01:00 屬當日)', twDayFromMemAt('2026-07-18T01:00:00+08:00') === '2026-07-18', twDayFromMemAt('2026-07-18T01:00:00+08:00'));
// UTC ISO fallback:+8 小時後取日期。18:00Z+8=次日 02:00 → 跨午夜;10:00Z+8=當日 18:00 → 不跨
ok('T8b UTC fallback +8 跨午夜', twDayFromMemAt('2026-07-17T18:00:00Z') === '2026-07-18', twDayFromMemAt('2026-07-17T18:00:00Z'));
ok('T8c UTC fallback +8 同日', twDayFromMemAt('2026-07-17T10:00:00Z') === '2026-07-17', twDayFromMemAt('2026-07-17T10:00:00Z'));

const failed = results.filter(r => !r.pass);
console.log(`\n${'═'.repeat(40)}\n總計 ${results.length} 項,PASS ${results.length - failed.length},FAIL ${failed.length}`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join('; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
