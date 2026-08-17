#!/usr/bin/env node
// 驗 segmentVehiclesFromCountdowns：從官方每站倒數切段還原逐車位置。
// 判準刻意**不與實作同源**——期望值由「我先擺好車，再依物理算出各站應有的倒數」正向產生，
// 而不是拿實作的輸出當基準（見 judgment 心得 29）。
//   擺車 → 算倒數 → 丟給實作切段 → 要求還原出原本擺的那些車。
// 用法：node scripts/verify_countdown_segmentation.mjs
import { segmentVehiclesFromCountdowns } from './trtc_board_ledger.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

const RUN = 90;   // 每區間行車秒（測試用固定值）
const N = 12;     // 站數
const runs = new Map();
for (let i = 0; i < N - 1; i++) { runs.set(`${i}>${i + 1}`, RUN); runs.set(`${i + 1}>${i}`, RUN); }
const model = { lines: new Map([['T', {
  id: 'T', stations: Array.from({ length: N }, (_, i) => ({ name: `S${i}` })), runs,
}]]) };

// 正向產生器：給定「車在 from→to 之間、還有 headSec 秒到 to」，算出這台車負責的每一站到站時刻。
// 責任區＝從 to 一路到「下一台車的位置」或終點為止。
function makeRows(trains, dir, now = 1000000) {
  const step = dir === 2 ? 1 : -1;
  const last = dir === 2 ? N - 1 : 0;
  const sorted = trains.slice().sort((a, b) => (a.to - b.to) * step); // 行進方向由後往前
  const rows = [];
  for (let t = 0; t < sorted.length; t++) {
    const tr = sorted[t];
    // 這台車的責任區止於下一台車的 to 之前（下一台比它更前面 ⇒ index 更大/更小）
    const limit = t + 1 < sorted.length ? sorted[t + 1].to - step : last;
    let eta = now + tr.headSec;
    for (let s = tr.to; (s - limit) * step <= 0; s += step) {
      rows.push({ line: 'T', dir, stationIdx: s, destIdx: last, destName: `S${last}`,
        no: '', arrEpoch: eta, baseEpoch: now, sec: eta - now, atStation: false });
      eta += RUN;
    }
  }
  return rows;
}

function check(label, trains, dir, opts = {}) {
  const rows = makeRows(trains, dir);
  const r = segmentVehiclesFromCountdowns(model, opts.mutate ? opts.mutate(rows) : rows, { lines: ['T'] });
  const got = r.vehicles.slice().sort((a, b) => a.to - b.to);
  const want = trains.slice().sort((a, b) => a.to - b.to);
  const expectN = opts.expectN == null ? want.length : opts.expectN;
  ok(`${label}：段數＝車數（${expectN}）`, got.length === expectN, `實得 ${got.length}`);
  if (got.length !== expectN) return r;
  if (opts.expectN != null) return r;
  const posOk = got.every((g, i) => g.to === want[i].to && g.from === want[i].to - (dir === 2 ? 1 : -1));
  ok(`${label}：每台車的 from→to 還原正確`, posOk,
    got.map(g => `${g.from}→${g.to}`).join(' ') + ' vs ' + want.map(w => `${w.to - (dir === 2 ? 1 : -1)}→${w.to}`).join(' '));
  const etaOk = got.every((g, i) => g.arrEpoch === 1000000 + want[i].headSec);
  ok(`${label}：到站時刻照抄官方不被改寫`, etaOk);
  return r;
}

console.log('\n【1】方向 2（站序遞增）三台車');
check('dir2', [{ to: 3, headSec: 20 }, { to: 6, headSec: 45 }, { to: 9, headSec: 70 }], 2);

console.log('\n【2】方向 1（站序遞減）三台車 — 心得 4：有序資料必驗兩個方向');
check('dir1', [{ to: 8, headSec: 20 }, { to: 5, headSec: 45 }, { to: 2, headSec: 70 }], 1);

console.log('\n【3】起點列不生車（段首落在線端 ⇒ from 掉出線外）');
{
  const rows = makeRows([{ to: 4, headSec: 30 }], 2);
  // 補一筆站 0 的「下一班」列，時刻比站 4 那台早 ⇒ 自成一段，且 from=-1
  rows.push({ line: 'T', dir: 2, stationIdx: 0, destIdx: N - 1, destName: `S${N - 1}`,
    no: '', arrEpoch: 1000000 + 5, baseEpoch: 1000000, sec: 5, atStation: false });
  const r = segmentVehiclesFromCountdowns(model, rows, { lines: ['T'] });
  ok('起點列被丟棄，只還原出 1 台真車', r.vehicles.length === 1, `實得 ${r.vehicles.length}`);
  ok('起點列有進 diagnostics（不是靜默丟）', r.diagnostics.originRows === 1,
    `originRows=${r.diagnostics.originRows}`);
}

console.log('\n【4】🔴 突變對照：判準有沒有牙');
// 4a 把兩台車的倒數改成單調遞增（抹掉分界）⇒ 應該只切出 1 台，測試必須看得見
{
  const rows = makeRows([{ to: 3, headSec: 20 }, { to: 7, headSec: 40 }], 2);
  const merged = rows.map(r => ({ ...r, arrEpoch: 1000000 + 20 + r.stationIdx * RUN }));
  const r = segmentVehiclesFromCountdowns(model, merged, { lines: ['T'] });
  ok('抹掉分界後只剩 1 台（證明分界偵測真的在做事）', r.vehicles.length === 1,
    `實得 ${r.vehicles.length}`);
}
// 4b 若把「嚴格遞增」誤寫成「非遞減」，相等的相鄰值會被併掉——這組驗它分得開
{
  const rows = [
    { line: 'T', dir: 2, stationIdx: 3, destIdx: N - 1, destName: 'S11', no: '', arrEpoch: 1000050, baseEpoch: 1000000, sec: 50 },
    { line: 'T', dir: 2, stationIdx: 4, destIdx: N - 1, destName: 'S11', no: '', arrEpoch: 1000050, baseEpoch: 1000000, sec: 50 },
  ];
  const r = segmentVehiclesFromCountdowns(model, rows, { lines: ['T'] });
  ok('相鄰兩站時刻相等 ⇒ 判成兩台（不是一台）', r.vehicles.length === 2, `實得 ${r.vehicles.length}`);
}

console.log('\n【5】中間站缺列（倒數解不出被丟）不應該讓車數暴增');
check('缺兩站', [{ to: 2, headSec: 15 }, { to: 6, headSec: 40 }, { to: 10, headSec: 65 }], 2,
  { mutate: rows => rows.filter(r => r.stationIdx !== 4 && r.stationIdx !== 8) });

console.log('\n【6】只處理指定的線，其他線原封不動');
{
  const rows = makeRows([{ to: 5, headSec: 30 }], 2).map(r => ({ ...r, line: 'OTHER' }));
  const r = segmentVehiclesFromCountdowns(model, rows, { lines: ['T'] });
  ok('非指定線一台都不生', r.vehicles.length === 0, `實得 ${r.vehicles.length}`);
}

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (!pass) { console.error('🔴 零斷言＝沒驗（見 assertion-blindspot-taxonomy）'); process.exit(3); }
process.exit(fail ? 1 : 0);
