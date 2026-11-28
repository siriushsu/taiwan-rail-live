#!/usr/bin/env node
// /api/thsr-schedule?date=YYYY-MM-DD(App 排別天行程用)的守門。跑法:node scripts/verify_thsr_schedule_day.mjs
// 跟 verify_thsr_schedule.mjs 分開:那支要 TDX fixture、wrangler、Playwright,這支只要 node:sqlite 的 D1 替身。
// 判準:有那天＝原樣給那天(不加 served_date);沒有那天＝404 no_day(不退最近日);格式錯、前天以前、太遠＝400;
// 昨天放行(issue #127:App 凌晨冷開機借昨夜跨午夜的高鐵班,v1128b);
// 快取鍵帶日期(不同日期不能共用一份快取);不帶 date 的行為不變(仍給今天)。
import { _thsr } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

const { thsrSchedule } = _thsr;
let fail = 0;
const ok = (name, pass, detail = '') => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// 台北今天(獨立算,不呼叫 worker 的 twToday)
function taipeiIso(deltaDays) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + deltaDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const key = iso => iso.replace(/-/g, '');
const today = taipeiIso(0), d3 = taipeiIso(3), d5 = taipeiIso(5), yest = taipeiIso(-1);

const puts = [];
globalThis.caches = { default: { match: async () => undefined, put: async (k) => { puts.push(k.url); } } };
const req = (p) => new Request('https://railisland.tw' + p);
const doc = (iso, train) => ({ system: '高鐵時刻表', date: key(iso), trains: [{ train }] });
const blob = JSON.stringify({ fetchedAt: new Date().toISOString(), days: { [key(yest)]: doc(yest, 'T-YEST'), [key(today)]: doc(today, 'T-TODAY'), [key(d3)]: doc(d3, 'T-D3') } });
const seed = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched', '${blob.replace(/'/g, "''")}', datetime('now'));`;

{
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + d3), { DELAY_DB });
  const body = await res.json();
  ok('有那天→200 給那天', res.status === 200 && body.date === key(d3) && body.trains[0].train === 'T-D3' && !('served_date' in body),
    `status=${res.status} date=${body.date}`);
  ok('快取鍵帶日期', puts.length === 1 && puts[0].endsWith('/api/thsr-schedule?date=' + key(d3)), JSON.stringify(puts));
}
{
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + d5), { DELAY_DB });
  const body = await res.json();
  ok('沒有那天→404 no_day(不退最近日)', res.status === 404 && body.error === 'no_day', `status=${res.status} body=${JSON.stringify(body)}`);
}
{
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + today), { DELAY_DB });
  const body = await res.json();
  ok('指定今天→200 今天', res.status === 200 && body.trains[0].train === 'T-TODAY', `status=${res.status}`);
}
{
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + yest), { DELAY_DB });
  const body = await res.json();
  ok('昨天→200 給昨天(issue #127)', res.status === 200 && body.date === key(yest) && body.trains[0].train === 'T-YEST', `status=${res.status} date=${body.date}`);
}
for (const [name, v] of [['格式錯', '2026-1-5'], ['不存在的日期', taipeiIso(0).slice(0, 5) + '02-30'], ['前天', taipeiIso(-2)],
  ['15 天後', taipeiIso(15)], ['空字串', ''], ['YYYYMMDD', key(d3)]]) {
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + v), { DELAY_DB });
  ok(`${name}→400`, res.status === 400, `date=${v} status=${res.status}`);
}
{
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + taipeiIso(14)), { DELAY_DB });
  ok('14 天後(範圍內、沒有資料)→404', res.status === 404, `status=${res.status}`);
}
{
  const { DELAY_DB } = openTestDb();
  const res = await thsrSchedule(req('/api/thsr-schedule?date=' + d3), { DELAY_DB });
  ok('blob 不存在→404', res.status === 404, `status=${res.status}`);
}
{
  puts.length = 0;
  const { DELAY_DB } = openTestDb(seed);
  const res = await thsrSchedule(req('/api/thsr-schedule'), { DELAY_DB });
  const body = await res.json();
  ok('不帶 date→今天(行為不變)', res.status === 200 && body.trains[0].train === 'T-TODAY', `status=${res.status}`);
  ok('不帶 date→快取鍵不變', puts.length === 1 && puts[0].endsWith('/api/thsr-schedule'), JSON.stringify(puts));
}

console.log(fail ? `\n${fail} 項 FAIL` : '\n全部通過');
process.exit(fail ? 1 : 0);
