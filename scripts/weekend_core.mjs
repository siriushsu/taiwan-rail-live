// 週末／連假活動的純判定層。worker 的 /api/weekend、weekend.html 與（批次 3 的）推播
// cron 共用同一份實作——若頁面在客端算一次、推播在伺服器再算一次,兩邊會慢慢長歪,
// 而「兩邊一致」這種判準拿自己驗自己是零資訊。
//
// 🔴 這個檔不做任何 I/O:日曆表、活動清單、節日名稱都由呼叫端讀好傳進來。
//    這讓整支模組在沒有 Cloudflare runtime、沒有網路的情況下也能逐條測試。

// 台北營運日字串。台灣無日光節約,UTC+8 固定,所以直接加 8 小時再取日期即可。
// 🔴 不可改用 toLocaleDateString 之類會看裝置時區的作法(海外裝置會差一天)。
export function twDayStr(nowMs) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 星期幾(0=日)。輸入已是台北營運日字串,用 UTC 取值才不會再被裝置時區偏移一次。
export function weekday(day) {
  return new Date(day + 'T00:00:00Z').getUTCDay();
}

// dayTypeTable ＝ data/tw_daytype.json(扁平 {日期:1|2})。
// 1=放假(國定假日與補假,落在平日也算放假) 2=補行上班的週六(→ 上班日)。
// 表裡沒有的日子退回只看週幾——日曆表只涵蓋兩年,用完之後仍要能運作。
export function isWorkday(day, dayTypeTable) {
  const t = dayTypeTable && dayTypeTable[day];
  if (t === 1) return false;
  if (t === 2) return true;
  const w = weekday(day);
  return w !== 0 && w !== 6;
}

// 從 fromDay(含)起算,往後找第一段連續的非上班日。
// 🔴 刻意「只往後、不往回補」:站在週日時只回週日,不把已經過完的週六算進來——
//    週日開頁面卻列出昨天已結束的活動是錯的。代價是標題那天會寫成單日,可接受。
// maxScan 上限存在的理由:輸入異常(例如整張表都是 2)時不要無限找。
// 單段上限 30 天同理——真實最長連假是春節六天,超過 30 天代表資料壞了。
export function nextHolidaySpan(fromDay, dayTypeTable, maxScan = 400) {
  let d = fromDay;
  for (let i = 0; i < maxScan; i++) {
    if (!isWorkday(d, dayTypeTable)) {
      const days = [d];
      let n = addDays(d, 1);
      while (!isWorkday(n, dayTypeTable) && days.length < 30) { days.push(n); n = addDays(n, 1); }
      return { from: days[0], to: days[days.length - 1], days };
    }
    d = addDays(d, 1);
  }
  return null;
}
