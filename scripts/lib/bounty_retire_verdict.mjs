// /api/bounty-board 的 retireBlock、valuationOk 兩個欄位（懸賞每日估值有沒有在正常跑；worker.js 的 BOUNTY_RETIRE_BLOCK_KEY、
// BOUNTY_VALUATION_OK_KEY）的判定。
//
// 抽成純函式的理由：判準如果只是巡檢裡內嵌的 if／else，就沒有辦法做突變測試，而「判準有沒有牙」只有突變測試答得出來
// （同 tra_daily_verdict.mjs）。這支預備給巡檢 import，巡檢還沒接上：目前只有 scripts/verify_bounty_valuation.mjs 的 G 組在用它，
// 判準也在那一組。
//
// 為什麼要看兩個欄位：「沒有被擋下」不等於「估值正常」。清單檔或規則檔讀不到、內容無效、D1 出錯、估值沒有觸發器、跑到一半被平台中止，
// retireBlock 不會因此出現（可能是 null，也可能停在上一次擋下）；只有 valuationOk（最後一次成功跑完的時間）隔太久沒更新，才看得出估值停了。
//
// 輸入：看板那一發的 HTTP 狀態碼（沒量到就傳 null）、解析後的 body（解析不出來就傳 null）、現在的毫秒時間戳 now（呼叫端傳 Date.now()；
// 不是有限的數字就判不了新鮮度，回 unknown，不會放行）。輸出：{ level, line }。
//   n/a      非 200                                    ＝ 看板還沒上線或 not_ready，這次判不了估值有沒有在跑。
//            🔴 verdict 本身沒有跨次的狀態：連續幾次都是 n/a（看板一直沒有正常回應），要由呼叫端另外判。
//   unknown  200 但 body 不是物件、兩個欄位缺任何一個、或欄位的型別不認得 ＝ 不知道估值有沒有在跑
//   bad      retireBlock 是物件                         ＝ 估值被守門擋下中；line 帶擋下的時間（台北時間）、那份清單的 generatedAt、擋下的原因
//   bad      valuationOk 是 null                        ＝ 還沒有任何一次成功的估值
//   bad      valuationOk.at 不是有效的毫秒時間戳          ＝ 最後一次成功的時間不明
//   bad      valuationOk.at 比 now 晚超過 BOUNTY_VALUATION_FUTURE_TOLERANCE_MS ＝ 最後一次成功的時間在未來、判不了新鮮度（這一端的時鐘大幅落後，或這份資料壞了）；
//            晚在容忍以內（兩端的時鐘差）照常往下判，年齡當 0
//   bad      now − valuationOk.at 超過 BOUNTY_VALUATION_MAX_AGE_MS ＝ 太久沒有成功跑完；line 帶最後一次成功的時間（台北時間）、已經過了幾小時，並明寫「超過門檻」與門檻的小時數
//   ok       其餘                                       ＝ 沒被擋下、最近有成功跑完；line 帶最後一次成功的時間
// 🔴 「沒有這個欄位」不能當成「正常」：伺服器讀不到狀態那兩列時會把兩個欄位一起省略，還在跑舊版的時候也沒有它們——兩者都是「不知道」。

// 估值一天跑一次：26 小時＝一天再加兩小時，留給 cron 的延遲、估值本身的執行時間與看板 5 分鐘的邊緣快取。
// 剛好等於門檻還算新鮮，多 1 毫秒才算太久。
export const BOUNTY_VALUATION_MAX_AGE_MS = 26 * 3600 * 1000;

// valuationOk.at 比 now 晚多少以內不當成壞資料：寫入的 Worker 與讀看板的這一端各有各的時鐘，差幾分鐘是正常的（年齡當 0）。
// 超過就是時間錯亂：at 在未來的話年齡是負的，永遠不會超過門檻，估值停了也不會被看見，所以判 bad，不放行。
// 剛好等於容忍值還算正常，多 1 毫秒才算。
export const BOUNTY_VALUATION_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

// 毫秒時間戳 → 台北時間 'YYYY-MM-DD HH:mm'；不是有限的數字就回 null。
function taipeiTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace('T', ' ');
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const hoursOf = ms => (ms / 3600000).toFixed(1);

export function bountyRetireVerdict(status, body, now) {
  if (status !== 200) {
    return { level: 'n/a',
      line: `懸賞看板沒有正常回應（${status == null ? '沒有狀態碼' : 'HTTP ' + status}）：這次判不了估值有沒有在跑` };
  }
  if (!isObject(body)) {
    return { level: 'unknown', line: '懸賞看板的回應內容讀不出來（不是 JSON 物件）：不知道估值有沒有在跑' };
  }
  const missing = ['retireBlock', 'valuationOk'].filter(k => body[k] === undefined);
  if (missing.length) {
    return { level: 'unknown',
      line: `懸賞看板沒有 ${missing.join('、')} 欄位（看板還是舊版，或伺服器讀不到估值的狀態）：不知道估值有沒有在跑` };
  }
  const block = body.retireBlock, okv = body.valuationOk;
  if (block !== null && !isObject(block)) {
    return { level: 'unknown', line: '懸賞看板的 retireBlock 欄位不是 null 也不是物件，格式不認得：不知道估值有沒有在跑' };
  }
  if (block !== null) {
    const when = taipeiTime(block.at);
    return { level: 'bad',
      line: `懸賞估值被守門擋下：台北時間 ${when ?? '時間不明'}、` +
        (block.generatedAt == null ? '清單沒有 generatedAt' : `清單 generatedAt ${block.generatedAt}`) +
        `；${block.msg ?? '（沒有訊息）'}。擋下期間新單位不上架、沒接懸賞的錄程在缺卡的段拿 0 點，要盡快處理` };
  }
  if (okv !== null && !isObject(okv)) {
    return { level: 'unknown', line: '懸賞看板的 valuationOk 欄位不是 null 也不是物件，格式不認得：不知道估值有沒有在跑' };
  }
  if (okv === null) {
    return { level: 'bad',
      line: '懸賞估值還沒有任何一次成功跑完的紀錄（valuationOk 是 null）：估值沒有跑起來；新版剛上線、第一次估值還沒跑完時也會這樣' };
  }
  const when = taipeiTime(okv.at);
  if (when === null) {
    return { level: 'bad', line: '懸賞估值最後一次成功的時間不明（valuationOk.at 不是有效的毫秒時間戳）：判不了估值是不是還在跑' };
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return { level: 'unknown', line: `沒有現在的時間（now 不是有限的數字），判不了估值新不新鮮；最後一次成功是台北時間 ${when}` };
  }
  // at 在未來：晚在容忍以內照常往下判（年齡當 0）；超過容忍就判不了新鮮度。放行的話，這份時間一旦壞成未來，估值停了也再沒有人看得見。
  if (okv.at - now > BOUNTY_VALUATION_FUTURE_TOLERANCE_MS) {
    return { level: 'bad',
      line: `懸賞估值最後一次成功的時間在未來（valuationOk.at 是台北時間 ${when}，比現在晚超過 ${BOUNTY_VALUATION_FUTURE_TOLERANCE_MS / 60000} 分鐘）：` +
        '判不了估值新不新鮮；可能是這一端的時鐘大幅落後，或這份資料壞了' };
  }
  const age = now - okv.at;
  if (age > BOUNTY_VALUATION_MAX_AGE_MS) {
    // 年齡只印一位小數，多 1 毫秒到約 3 分鐘會印成跟門檻同一個數字、讀起來像沒超過，所以「超過門檻」要寫出來
    return { level: 'bad',
      line: `懸賞估值已經 ${hoursOf(age)} 小時沒有成功跑完（最後一次成功：台北時間 ${when}），超過門檻（${BOUNTY_VALUATION_MAX_AGE_MS / 3600000} 小時）：` +
        '估值可能停了（清單或規則檔壞掉、D1 出錯、沒有觸發、被平台中止都會這樣），新單位不上架、沒接懸賞的錄程在缺卡的段拿 0 點，要盡快處理' };
  }
  return { level: 'ok', line: `懸賞估值正常：沒有被守門擋下，最後一次成功是台北時間 ${when}（${hoursOf(Math.max(0, age))} 小時前）` };
}
