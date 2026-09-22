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

// 日期欄位守門。活動資料是每日半自動策展的,少補一個零(2026-9-5)、寫成「即日起」都是自然手滑,
// 而 addDays() 對這些輸入會拋 RangeError——在 filter 裡拋等於整份清單跟著一起空掉,
// 所以壞的那一筆要在進 addDays 之前就被濾掉。
// 正則擋非 ISO 寫法,Date.parse 再擋月/日超界,回寫比對擋「格式對但日子不存在」
// ——2026-02-29 不會被 Date 判為無效,會被靜靜滾成 03-01。
// (與 index.html 的 evValidDay 同一套判準;那邊管畫面,這邊管 API。)
export function evValidDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// 兩層分流:
//   onlyThis ＝「這段假期限定」——活動的 start 或 end 落在區間內(這個週末開始或結束的)
//   alsoOpen ＝「假期也開」——與區間相交,但頭尾都在區間外的長期檔
// 判準刻意不含任何天數門檻,不會隨資料漂移。
export function splitEvents(events, span) {
  const onlyThis = [], alsoOpen = [];
  for (const ev of (events || [])) {
    if (!ev || !evValidDay(ev.start) || !evValidDay(ev.end)) continue;
    if (ev.end < span.from || ev.start > span.to) continue;   // 與區間不相交
    const startsIn = ev.start >= span.from && ev.start <= span.to;
    const endsIn = ev.end >= span.from && ev.end <= span.to;
    (startsIn || endsIn ? onlyThis : alsoOpen).push(ev);
  }
  return { onlyThis, alsoOpen };
}

// 去重。同一活動連續多天、或同一活動掛在多個車站,在 events.json 都是【多筆】
// (實測:廣慈市集 09-05 一筆、09-06 一筆;林鐵×乖乖 北門一筆、阿里山一筆)。
// 按 title＋url 併成一則:日期取「該區間內真的有開的日子」聯集、地點取所有 anchor 聯集。
// 只按 title 併會把兩個剛好同名的不同活動誤併,所以 url 也進簽章。
export function dedupeEvents(list, span) {
  const bySig = new Map();
  for (const ev of (list || [])) {
    const sig = String(ev.title) + ' ' + String(ev.url || '');
    let g = bySig.get(sig);
    if (!g) {
      g = { title: ev.title, note: '', url: ev.url || '', days: [], places: [], ids: [] };
      bySig.set(sig, g);
    }
    g.ids.push(ev.id);
    if (!g.note && ev.note) g.note = ev.note;      // 多筆之中取第一個有填的
    for (const d of span.days) {
      if (d >= ev.start && d <= ev.end && !g.days.includes(d)) g.days.push(d);
    }
    const a = ev.anchor || {};
    const key = String(a.sys || '') + '|' + String(a.name || '');
    if (!g.places.some(p => String(p.sys || '') + '|' + String(p.station || '') === key)) {
      g.places.push({ sys: a.sys || null, station: a.name || null });
    }
  }
  return [...bySig.values()]
    .map(g => ({ ...g, days: g.days.slice().sort() }))
    .sort((a, b) => {
      const x = a.days[0] || '', y = b.days[0] || '';
      if (x !== y) return x < y ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
}

// 標題文案。holidayNames ＝ data/holiday_names.json(只有本功能讀,查不到就退回通用說法)。
// 🔴 名稱只是文案裝飾,不是判定依據——缺了不影響任何正確性,所以這裡不做任何錯誤處理。
// 四個分支(2026-09-04 使用者裁示,實測 2026-2027 兩年 730 天全部走過一遍):
//   ≥3 天有名稱 → 「光復節連假」    ≥3 天查無名稱 → 「這個連假」
//   <3 天有名稱 → 「光復節」        <3 天查無名稱 → 「本週末」或「假日」
// 🔴 最後那個分支【不能無條件寫「本週末」】:國定假日落在平日(週四的元旦)、或連假只剩
// 最後一天的補假(週一的光復節補假,而名稱在已經過去的前一天),都會走到這裡——實測兩年有
// 14 個這種日子,寫「本週末」是在說謊。所以查無名稱時還要看那幾天是不是真的週六日。
// 三天以上才叫「連假」:兩天的週六日在台灣不會被說成連假。
export function spanLabel(span, holidayNames) {
  const names = holidayNames || {};
  const hit = span.days.map(d => names[d]).find(Boolean);
  if (span.days.length >= 3) return hit ? hit + '連假' : '這個連假';
  if (hit) return hit;
  return span.days.every(d => weekday(d) === 0 || weekday(d) === 6) ? '本週末' : '假日';
}

// /api/weekend 端點回傳形狀的組裝。🔴 這是【唯一】一份——worker.js 的 weekendBoard 與
// scripts/verify_weekend_api.mjs 都呼叫這一支,不各自重算組裝邏輯(檔頭那句話對這支
// 複合函式同樣成立:兩份實作會慢慢長歪,而「兩邊一致」拿自己驗自己是零資訊)。
// span 為 null 的處理刻意不在這裡:那是「日曆表用完了」時的 HTTP 層決策(503),
// 屬於呼叫端的職責,不是這裡該管的純邏輯——呼叫端要自己先確認 span 非 null 才呼叫這裡。
export function weekendBody(today, span, eventsDoc, holidayNames) {
  const all = (eventsDoc && Array.isArray(eventsDoc.events)) ? eventsDoc.events : [];
  const { onlyThis, alsoOpen } = splitEvents(all, span);
  const body = {
    today,
    span: { from: span.from, to: span.to, days: span.days.length, label: spanLabel(span, holidayNames) },
    events: dedupeEvents(onlyThis, span),
    alsoOpen: dedupeEvents(alsoOpen, span),
    updated: (eventsDoc && eventsDoc.updated) || null,
  };
  body.count = body.events.length;
  return body;
}
