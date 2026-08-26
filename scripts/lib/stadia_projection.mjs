// Stadia 期末推估的日窗選擇與速率計算（純函式，給 scripts/launch_watch.mjs 與其驗收共用）。
//
// 抽出來的理由：這裡有兩個方向相反、會互相掩蓋的坑，而它們原本埋在一段直接印到 stdout 的
// 流程裡，結構上無從驗證——上游是活的 API，一跑就變，沒有任何一組輸入是可重放的。
//
//  ① 進行中的 UTC 日不可當日速率。腳本在 UTC 01:30 跑（cron），那一格只有 1.5/24 天的量；
//     原本 `const hi = today[1]` 拿它當「若維持今日水準」會**低估**期末用量——而低估正是
//     危險的方向：Stadia 到 105% 是硬斷線不是超額計費，低估 ⇒ 沒升方案 ⇒ 當場全體白圖。
//     反過來把它外推成整天也不行：UTC 01:30 = 台北 09:30，那 1.5 小時全是早尖峰，×16 會
//     嚴重高估。partial 這一格唯一誠實的用法是「顯示」，不是「當速率」。
//
//  ② 零用量日不可從序列裡刪掉。原本 stadia() 的 `.filter(([, v]) => v > 0)` 把它們濾掉，
//     於是「近 3 完整日均值」實際上是「近 3 **有用量**日均值」，分母縮水 ⇒ 均值系統性偏高。
//     但「未來還沒到、上游也回 0」的日子若留著，又會把估計打到地上——
//     所以判準是**日期**（≤ 今天），不是**數值**（> 0）。這兩件事只差一個字，效果相反。

/**
 * 把上游的每日序列切成「完整日」與「進行中的那一格」。
 * @param {Array<[string, number]>} daily  [['2026-08-25', 12345], …]，日期升冪、UTC 日
 * @param {string} utcToday                'YYYY-MM-DD'（UTC）
 */
export function dayWindow(daily, utcToday) {
  // 只留到今天為止：上游若把整個計費期都列出來（未來日 = 0），那些格子不是「零用量」，
  // 是「還沒發生」，混進均值會系統性低估。
  const upTo = (daily || []).filter(([d]) => d <= utcToday);
  const last = upTo[upTo.length - 1];
  const partial = last && last[0] === utcToday ? last : null;
  return { complete: partial ? upTo.slice(0, -1) : upTo, partial };
}

/**
 * 從完整日算兩個情境速率。complete 為空時回 null——「資料不足」要說出來，
 * 不可退化成 0（0 會讓期末推估等於現在的累計，看起來像「很安全」）。
 * @param {Array<[string, number]>} complete
 */
export function rates(complete, window = 3) {
  if (!complete || !complete.length) return null;
  const last = complete.slice(-window);
  return {
    lo: last.reduce((a, [, v]) => a + v, 0) / last.length,
    loN: last.length,                                  // 實際取到幾日（期初可能不足 window）
    hi: complete[complete.length - 1][1],
    hiDay: complete[complete.length - 1][0],
  };
}
