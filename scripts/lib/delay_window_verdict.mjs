// /api/delay-stats（台鐵近 30 天準點統計）的「統計窗有沒有停在過去」判定。
//
// 為什麼要有這條（2026-09-13）：每日 cron（台北 09:15）09-08～09-12 連五天在第一個 TDX 呼叫
// （取 token）就吃 HTTP 429、整發拋例外；09-13 那發成功了，但缺日自癒一發只補「最舊」3 天
// ⇒ 窗仍停在 09-08。每小時巡檢原本只看 `_meta.generated`（那發自己寫的時戳），當天是新的就判綠，
// 「跑成功了但窗沒追上」完全照不到。這支改問窗的迄日。
//
// 抽成純函式的理由同 tra_daily_verdict.mjs：內嵌 if/else 做不了突變測試。這支同時被
// scripts/scan_map_health.mjs（哨兵）與 scripts/verify_delay_window_sentinel.mjs（控制組）用。
//
// 門檻從 cron 時刻推導，不是手打常數：ingestDelayHistory 抓的是「到昨天為止」，
// 所以那發到期（台北 CRON_TW_HOUR 點再過一小時）之後迄日必須是昨天，還沒到期時至少是前天。
// 回放 2026-09-02～09-13 全部 197 筆巡檢明細：cron 正常的 60 筆（09-02、09-03、09-04 上午）全判 info，
// 窗落後的 137 筆（09-04 10 點起～09-13）全判 bad；舊判準在 09-13 cron 成功後判綠（實測 10:20、14:31）。
export const CRON_TW_HOUR = 9;   // wrangler.jsonc 的 `15 1 * * *`（UTC）＝台北 09:15

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// statsRange＝/api/delay-stats 的 _meta.date_range；todayTaipei＝台北今天 'YYYY-MM-DD'；twHour＝台北時（0–23）。
export function delayWindowVerdict(statsRange, todayTaipei, twHour) {
  const due = twHour >= CRON_TW_HOUR + 1;
  const expectedEnd = addDays(todayTaipei, due ? -1 : -2);
  const end = Array.isArray(statsRange) ? statsRange[1] : null;
  if (typeof end !== 'string' || !ISO_DAY.test(end))
    return { level: 'bad', due, expectedEnd, lagDays: null,
      msg: `台鐵誤點統計讀不到窗的迄日（date_range=${JSON.stringify(statsRange)}）＝回應格式變了或 blob 不在，` +
        '窗有沒有停住無從判定' };
  const lagDays = dayDiff(expectedEnd, end);
  if (lagDays <= 0)
    return { level: 'info', due, expectedEnd, lagDays,
      msg: `台鐵誤點統計窗 ${statsRange[0]}～${end}（台北 ${twHour} 點至少該到 ${expectedEnd}）` };
  return { level: 'bad', due, expectedEnd, lagDays,
    msg: `台鐵誤點統計窗停在 ${end}，台北 ${twHour} 點應已到 ${expectedEnd}（落後 ${lagDays} 天）＝「近 30 天準點率」是舊的。` +
      'generated 是新的不代表窗有追上：缺日自癒一發只補最舊 3 天。補跑法見 memory daily-cron-single-run-silent-failure' };
}
