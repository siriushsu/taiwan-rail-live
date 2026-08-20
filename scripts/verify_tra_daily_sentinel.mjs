// 每小時巡檢第十條判準（/api/tra-daily-trains）的控制組＋突變測試。
//
// 為什麼要單獨一支:這條判準守的是一個**靜默**故障——端點壞掉時前端 fail-open,畫面完全正常,
// 只是官方停駛的車又變回幽靈車。判準沒牙 = 這個功能沒有哨兵（心得 35:判準有沒有牙只有突變測試答得出來）。
//
// 用法:node scripts/verify_tra_daily_sentinel.mjs        （純函式,秒級）
//       LIVE=https://railisland.tw node scripts/verify_tra_daily_sentinel.mjs   （加驗線上端點真的餵得出 info）
import { readFileSync } from 'node:fs';
import { traDailyVerdict, TRA_DAILY_MIN, TRA_DAILY_MAX } from './lib/tra_daily_verdict.mjs';

let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };
const TODAY = '2026-08-20';
const good = (n = 910) => ({ date: TODAY, updateTime: '2026-08-19 14:38:08', count: n,
  trains: Array.from({ length: n }, (_, i) => String(1000 + i)) });

console.log('── G0 判準真的被接進巡檢腳本');
{
  const s = readFileSync(new URL('./scan_map_health.mjs', import.meta.url), 'utf8');
  ck(/import\s*\{\s*traDailyVerdict\s*\}\s*from\s*'\.\/lib\/tra_daily_verdict\.mjs'/.test(s), 'scan 有 import 這支純函式');
  ck(/\/api\/tra-daily-trains/.test(s) && /traDailyVerdict\(td, twToday/.test(s), 'scan 有打端點並把結果丟進判準');
  ck(/tdStatus = r\.status/.test(s) && /traDailyVerdict\(td, twToday, tdStatus\)/.test(s),
    'scan 有把 HTTP 狀態碼一起餵進判準（404 才分得出「還沒上線」與「上游壞了」）');
  ck(/noteLoud\(v\.level, v\.msg/.test(s), '判定結果有進 noteLoud（會計入告警等級,不是只印出來）');
}

console.log('\n── 正向對照:健康的回應必須是 info（沒有這條,「什麼都嫌」也能全綠）');
{
  const v = traDailyVerdict(good(), TODAY);
  ck(v.level === 'info', `910 班、日期相符 ⇒ ${v.level}`);
  ck(/910/.test(v.msg), `訊息帶得出班次數:${v.msg}`);
  for (const n of [TRA_DAILY_MIN, TRA_DAILY_MAX, 907, 927])
    ck(traDailyVerdict(good(n), TODAY).level === 'info', `${n} 班（實測區間內／邊界）⇒ info`);
}

console.log('\n── 突變:每一種壞法都要被抓到,而且分級要對');
const M = [
  ['端點 502／整包抓不到',            { error: 'ods day 502' },                       'warn'],
  ['🔴 端點 404（版本還沒上線）',      { error: 'Unexpected token <' },                 'warn', 404],
  ['fetch 直接爆掉（null）',          null,                                            'warn'],
  ['回應格式變了（沒有 trains）',      { date: TODAY, count: 910 },                     'bad'],
  ['🔴 日期落在昨天（前端會整個跳過）', { ...good(), date: '2026-08-19' },               'bad'],
  ['count 與實際長度對不上',           { ...good(), count: 3 },                         'bad'],
  ['官方檔被截斷（只剩 12 班）',       good(12),                                        'bad'],
  ['班次數暴增到 5000（格式錯讀）',    good(5000),                                      'bad'],
  ['空名冊',                          { date: TODAY, count: 0, trains: [] },           'bad'],
];
for (const [label, payload, want, st] of M) {
  const v = traDailyVerdict(payload, TODAY, st);
  ck(v.level === want, `${label} ⇒ ${v.level}（期望 ${want}）｜${v.msg.slice(0, 46)}…`);
}
ck(/404/.test(traDailyVerdict({ error: 'x' }, TODAY, 404).msg) &&
   !/上游|ods/.test(traDailyVerdict({ error: 'ods day 502' }, TODAY, 404).msg),
  '404 走專屬訊息（講「端點不存在」而不是通用的「抓不到」）');
ck(traDailyVerdict(good(), TODAY, 200).level === 'info', '帶 status=200 的健康回應仍是 info（狀態碼沒有蓋掉正常路徑）');

// 🔴 分級不是裝飾:warn 與 bad 的差別就是「要不要有人立刻看」。
// 少了這條,把全部壞法一律標 bad（或一律 warn）也能通過上面每一格。
{
  const by = l => M.filter(m => m[2] === l).length;
  ck(by('warn') >= 2 && by('bad') >= 2,
    `突變表兩級各至少兩例（warn ${by('warn')}／bad ${by('bad')}）——單一分級的表,「一律 bad」也能全綠`);
}

if (process.env.LIVE) {
  console.log('\n── 線上端點實測（證明正常情況下這條不會誤報）');
  const u = new URL('/api/tra-daily-trains', process.env.LIVE);
  u.search = 'cb=' + Date.now();
  const t0 = Date.now();
  let d = null;
  try { d = await (await fetch(u, { headers: { 'cache-control': 'no-cache' } })).json(); } catch (e) { d = { error: e.message }; }
  const tw = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const v = traDailyVerdict(d, tw);
  console.log(`     ↳ ${Date.now() - t0}ms｜date=${d && d.date}｜count=${d && d.count}｜updateTime=${d && d.updateTime}`);
  ck(v.level === 'info', `${process.env.LIVE} ⇒ ${v.level}：${v.msg}`);
}

console.log(fail ? `\n❌ ${fail} 項失敗` : '\n✅ 全部通過');
process.exit(fail ? 1 : 0);
