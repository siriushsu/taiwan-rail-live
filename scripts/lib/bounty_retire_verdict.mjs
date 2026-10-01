// /api/bounty-board 的 retireBlock 欄位（懸賞估值有沒有被清單的守門擋下，worker.js 的 BOUNTY_RETIRE_BLOCK_KEY）的判定。
//
// 抽成純函式的理由：判準如果只是巡檢裡內嵌的 if／else，就沒有辦法做突變測試，而「判準有沒有牙」只有突變測試答得出來
// （同 tra_daily_verdict.mjs）。這支給每小時的巡檢 import；判準在 scripts/verify_bounty_valuation.mjs 的 G 組。
//
// 輸入：看板那一發的 HTTP 狀態碼（沒量到就傳 null）、解析後的 body（解析不出來就傳 null）。輸出：{ level, line }。
//   ok       200 且 retireBlock 是 null          ＝ 估值沒有被擋下
//   bad      200 且 retireBlock 是物件           ＝ 估值被擋下中；line 帶擋下的時間（台北時間）、那份清單的 generatedAt、擋下的原因
//   unknown  200 但沒有 retireBlock（body 讀不出來、欄位不是 null 也不是物件也算）＝ 不知道有沒有被擋下
//   n/a      非 200                              ＝ 看板還沒上線或 not_ready，這次判不了；line 帶狀態碼
// 🔴 「沒有這個欄位」不能當成「沒被擋」：伺服器讀不到狀態那一列時會省略欄位，還在跑舊版的時候也沒有它——兩者都是「不知道」。

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

// 毫秒時間戳 → 台北時間 'YYYY-MM-DD HH:mm'；不是有限的數字就回 null。
function taipeiTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace('T', ' ');
}

export function bountyRetireVerdict(status, body) {
  if (status !== 200) {
    return { level: 'n/a',
      line: `懸賞看板沒有正常回應（${status == null ? '沒有狀態碼' : 'HTTP ' + status}）：看板還沒上線或 not_ready，這次判不了估值有沒有被擋下` };
  }
  const block = body && typeof body === 'object' ? body.retireBlock : undefined;
  if (block === null) return { level: 'ok', line: '懸賞估值沒有被守門擋下（retireBlock 是 null）' };
  if (block && typeof block === 'object' && !Array.isArray(block)) {
    const when = taipeiTime(block.at);
    return { level: 'bad',
      line: `懸賞估值被守門擋下：台北時間 ${when ?? '時間不明'}、` +
        (block.generatedAt == null ? '清單沒有 generatedAt' : `清單 generatedAt ${block.generatedAt}`) +
        `；${block.msg ?? '（沒有訊息）'}。擋下期間新單位不上架、沒接懸賞的錄程在缺卡的段拿 0 點，要盡快處理` };
  }
  return { level: 'unknown',
    line: '懸賞看板沒有 retireBlock 欄位（看板還是舊版，或伺服器讀不到擋下的狀態）：不知道估值有沒有被擋下' };
}
