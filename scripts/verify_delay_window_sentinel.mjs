// 每小時巡檢 -1 條「台鐵誤點統計窗有沒有停在過去」的控制組＋突變測試。
//
// 為什麼要單獨一支:這條判準守的是**cron 成功也照樣會發生**的靜默故障——2026-09-13 那發成功、
// generated 是新的,窗卻停在 09-08(缺日自癒一發只補最舊 3 天)。舊判準只看 generated,那天整日判綠。
// 判準有沒有牙只有突變測試答得出來(心得 35)。
//
// 用法:node scripts/verify_delay_window_sentinel.mjs          （純函式,秒級）
//       LIVE=https://railisland.tw node scripts/verify_delay_window_sentinel.mjs   （加驗線上窗此刻沒停住）
import { readFileSync } from 'node:fs';
import { delayWindowVerdict, CRON_TW_HOUR } from './lib/delay_window_verdict.mjs';

let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };
const DUE = CRON_TW_HOUR + 1;   // 到期後的第一個整點
const NOT_DUE = CRON_TW_HOUR;   // 那發排定的小時(還沒過一小時)

console.log('── G0 判準真的被接進巡檢腳本');
{
  const s = readFileSync(new URL('./scan_map_health.mjs', import.meta.url), 'utf8');
  ck(/import\s*\{\s*delayWindowVerdict\s*,\s*CRON_TW_HOUR\s*\}\s*from\s*'\.\/lib\/delay_window_verdict\.mjs'/.test(s),
    'scan 有 import 判準與 cron 時刻(同一個常數,不是各寫一份)');
  ck(!/const\s+CRON_TW_HOUR\s*=/.test(s), 'scan 沒有自己再定義一份 CRON_TW_HOUR');
  ck(/statsRange:\s*ds\?\._meta\?\.date_range/.test(s), 'scan 的窗取自 /api/delay-stats 的 _meta.date_range');
  ck(/delayWindowVerdict\(daily\.statsRange, today, twHour\)/.test(s), 'scan 把線上窗、台北今天、台北時一起餵進判準');
  ck(/noteLoud\(w\.level, w\.msg/.test(s), '判定結果有進 noteLoud(bad 會計入離開碼,不是只印出來)');
}

const T = '2026-09-13';
console.log('\n── 正向對照:正常的窗必須是 info(沒有這段,「一律 bad」也能全綠)');
const P = [
  ['到期後、迄日＝昨天', ['2026-08-14', '2026-09-12'], DUE],
  ['晚上 23 點、迄日＝昨天', ['2026-08-14', '2026-09-12'], 23],
  ['到期前、迄日＝前天(今天那發還沒跑)', ['2026-08-13', '2026-09-11'], NOT_DUE],
  ['清晨 6 點、迄日＝前天', ['2026-08-13', '2026-09-11'], 6],
  ['到期前、迄日已是昨天(那發剛跑完)', ['2026-08-14', '2026-09-12'], NOT_DUE],
];
for (const [label, range, hour] of P) {
  const v = delayWindowVerdict(range, T, hour);
  ck(v.level === 'info', `${label} ⇒ ${v.level}｜${v.msg.slice(0, 40)}…`);
}

console.log('\n── 突變:窗停在過去的每一種形狀都要被抓到');
const M = [
  ['🔴 09-13 實況:cron 成功、generated 新、窗停在 09-08', ['2026-08-10', '2026-09-08'], DUE],
  ['到期後只落後一天(單發失敗,09-04 那種)', ['2026-08-13', '2026-09-11'], DUE],
  ['到期前連前天都沒有(昨天那發也掛了)', ['2026-08-12', '2026-09-10'], NOT_DUE],
  ['沒有 date_range(blob 不在/503 not_ready)', null, DUE],
  ['date_range 只有一個元素', ['2026-09-12'], DUE],
  ['迄日格式壞掉', ['2026-08-14', '2026/09/12'], DUE],
];
for (const [label, range, hour] of M) {
  const v = delayWindowVerdict(range, T, hour);
  ck(v.level === 'bad', `${label} ⇒ ${v.level}｜${v.msg.slice(0, 46)}…`);
}
ck(/落後 4 天/.test(delayWindowVerdict(['2026-08-10', '2026-09-08'], T, DUE).msg), '訊息講得出落後幾天(09-13 實況＝4 天)');

console.log('\n── 到期閘門兩側都要驗(只驗紅的那側,「乾脆不分時段」也會過)');
{
  const r = ['2026-08-13', '2026-09-11'];
  ck(delayWindowVerdict(r, T, NOT_DUE).level === 'info', `迄日＝前天、台北 ${NOT_DUE} 點(未到期)⇒ info`);
  ck(delayWindowVerdict(r, T, DUE).level === 'bad', `同一個窗、台北 ${DUE} 點(已到期)⇒ bad`);
}

console.log('\n── 跨月不算錯天數');
ck(delayWindowVerdict(['2026-09-01', '2026-09-30'], '2026-10-01', DUE).level === 'info', '10-01 到期後、迄日 09-30 ⇒ info');
ck(delayWindowVerdict(['2026-08-31', '2026-09-29'], '2026-10-01', DUE).level === 'bad', '10-01 到期後、迄日 09-29 ⇒ bad');

console.log('\n── 巡檢明細回放(2026-09-02～09-13 正式站真值;最後兩格舊判準判的是綠)');
const H = [
  ['09-02 22:20', '2026-09-02', 22, ['2026-08-03', '2026-09-01'], 'info'],
  ['09-03 06:00', '2026-09-03', 6, ['2026-08-03', '2026-09-01'], 'info'],
  ['09-04 10:20(cron 掛)', '2026-09-04', 10, ['2026-08-04', '2026-09-02'], 'bad'],
  ['09-10 10:20(09-08 起連掛三天)', '2026-09-10', 10, ['2026-08-07', '2026-09-05'], 'bad'],
  ['🔴 09-13 09:30(成功但沒追上)', '2026-09-13', 9, ['2026-08-10', '2026-09-08'], 'bad'],
  ['🔴 09-13 10:20(成功但沒追上)', '2026-09-13', 10, ['2026-08-10', '2026-09-08'], 'bad'],
];
for (const [label, today, hour, range, want] of H) {
  const v = delayWindowVerdict(range, today, hour);
  ck(v.level === want, `${label} ⇒ ${v.level}(期望 ${want})`);
}

// 🔴 分級不是裝飾:少了正向那一級,「一律 bad」也能通過上面每一格突變。
ck(P.length >= 2 && M.length >= 2 && H.some(h => h[4] === 'info') && H.some(h => h[4] === 'bad'),
  `正向 ${P.length} 例／突變 ${M.length} 例／回放兩級都有`);

if (process.env.LIVE) {
  console.log('\n── 線上實測(證明窗正常時這條不會誤報)');
  const u = new URL('/api/delay-stats', process.env.LIVE);
  u.search = 'cb=' + Date.now();
  let d = null;
  try { d = await (await fetch(u, { headers: { 'cache-control': 'no-cache' } })).json(); } catch (e) { d = { error: e.message }; }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }));
  const range = d && d._meta && d._meta.date_range;
  const v = delayWindowVerdict(range, today, hour);
  console.log(`     ↳ date_range=${JSON.stringify(range)}｜generated=${d && d._meta && d._meta.generated}｜台北 ${today} ${hour} 點`);
  ck(v.level === 'info', `${process.env.LIVE} ⇒ ${v.level}:${v.msg}`);
}

console.log(fail ? `\n❌ ${fail} 項失敗` : '\n✅ 全部通過');
process.exit(fail ? 1 : 0);
