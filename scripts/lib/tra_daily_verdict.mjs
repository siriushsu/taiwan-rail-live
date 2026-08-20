// /api/tra-daily-trains（台鐵今日官方車次名冊，停駛偵測的資料源）的健康判定。
//
// 抽成獨立純函式的理由:每小時巡檢裡的判準如果只是內嵌的 if/else,就沒有辦法做突變測試——
// 而「判準有沒有牙」只有突變測試答得出來（心得 35）。這支同時被
// scripts/scan_map_health.mjs（哨兵）與 scripts/verify_tra_daily_sentinel.mjs（控制組）用。
//
// 分級沿用巡檢既有語意:
//   bad  = 產品／上游格式壞了,停駛偵測正在給錯的答案或已經不會生效（要人看）
//   warn = 環境條件（上游一時抓不到）——前端 fail-open,使用者看到的與沒有這個功能時一樣
//   info = 正常
// 🔴 刻意的取捨:「抓不到」只給 warn。這條沿用「上游短暫斷訊屬環境條件」的既有慣例;
// 但 date 對不上或車次數離譜是**我們這邊的判斷會出錯**,那要吵。
export const TRA_DAILY_MIN = 700;    // 台鐵實測一天 907–927 班（2026-08-20 量 14 天）
export const TRA_DAILY_MAX = 1200;

// status = HTTP 狀態碼（沒量到就傳 null）。刻意把 404 與其他失敗分開:
// 404 ＝「這個站上的版本還沒有這個端點」（部署狀態），不是上游壞掉,訊息要講對,
// 否則升正式站之前的每一輪巡檢都會印一句與事實不符的「上游抓不到」。仍然是 warn 不是 info——
// 端點在正式站消失本身就該有人知道（路由被拿掉也長這樣）。
export function traDailyVerdict(d, todayTaipei, status) {
  if (status === 404)
    return { level: 'warn', msg: '台鐵今日官方名冊端點不存在（404）＝這個站上的版本還沒有停駛偵測，' +
      '或路由被拿掉;前端照原樣全畫（fail-open）' };
  if (!d || d.error || typeof d !== 'object')
    return { level: 'warn', msg: `台鐵今日官方名冊抓不到（${(d && d.error) || '無回應'}）＝停駛偵測這輪不生效，` +
      '前端會照原樣全畫（fail-open，與沒有這個功能時相同）' };
  if (!Array.isArray(d.trains))
    return { level: 'bad', msg: '台鐵今日官方名冊沒有 trains 陣列＝回應格式已變,停駛偵測不會生效' };
  if (d.date !== todayTaipei)
    return { level: 'bad', msg: `台鐵今日官方名冊的日期是 ${d.date}、台北今天是 ${todayTaipei}` +
      '＝前端會因為營運日對不上而整個跳過,停駛偵測靜默失效' };
  if (d.count !== d.trains.length)
    return { level: 'bad', msg: `台鐵今日官方名冊 count=${d.count} 與 trains 長度 ${d.trains.length} 不一致` };
  if (d.trains.length < TRA_DAILY_MIN || d.trains.length > TRA_DAILY_MAX)
    return { level: 'bad', msg: `台鐵今日官方名冊只有 ${d.trains.length} 班（正常 ${TRA_DAILY_MIN}–${TRA_DAILY_MAX}）` +
      '＝官方檔可能被截斷;前端的量級守門會擋住不套用,但這代表上游有事' };
  return { level: 'info', msg: `台鐵今日官方名冊 ${d.trains.length} 班（官方更新 ${d.updateTime || '?'}）` };
}
