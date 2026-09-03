import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../bus-transfer-ui.js', import.meta.url), 'utf8');
const translations = fs.readFileSync(new URL('../i18n/bus-transfer-translations.js', import.meta.url), 'utf8');

const pass = message => console.log(`✓ ${message}`);
const check = (condition, message) => { assert.ok(condition, message); pass(message); };

check(index.indexOf('i18n/bus-transfer-translations.js') < index.indexOf('bus-transfer-ui.js'),
  '公車翻譯在 UI 模組之前載入');
check(index.indexOf('bus-transfer-ui.js') < index.indexOf('<script>\n// 版本戳記'),
  '公車 UI 模組在主程式之前載入');

check(/function busTransferStationId\(st\)/.test(index) && /transferAnchorForStop\(sourceSystem, st\)/.test(index)
  && /busTransferFallbackStationId\(appSystem, st\.name\)/.test(index),
  '入口由全系統官方站碼與穩定 fallback 自動掛載，不複製逐站白名單');
check(!/BUS_TRANSFER_PILOT_STATIONS/.test(index), '前端已移除三站 pilot 白名單');
check(/BUS_TRANSFER_APP_SYSTEMS = new Set/.test(index) && /'tra_sched', 'thsr_sched', 'afr_sched', 'mrt', 'tymc'/.test(index),
  '車站看板入口涵蓋台鐵、高鐵、林鐵與全部捷運輕軌系統');
check((index.match(/renderFreqBoard\([^;]+; appendBusTransferBoard\(el, st, busTransferId\); return;/g) || []).length === 2,
  '一般捷運分頁與全台同框裝飾層都在看板完成後掛上公車卡');
check(/COVERAGE = 'all_active_rail_stations'/.test(ui) && /\^\[A-Z\]\+:\[A-Za-z0-9_\]\+\$/.test(ui),
  'UI 接受全鐵路安全 StationID，Worker manifest 再做實站 gate');
check(/phase:\s*'arrived'/.test(index), '第一階段只掛載已抵達查詢，不推算未來接車');
check(/id="fpBus"[\s\S]*id="fpBusTo"[\s\S]*id="fpBusTransfer"/.test(index),
  '跟車卡提供先選轉乘站、再承接動態助手的完整入口');
check(/function busTransferStartJourney\(tr, stopIndex\)/.test(index)
  && /busTransferStopTarget\(tr, stopIndex\)/.test(index),
  '公車動態綁定使用者選定的單一轉乘站，不沿途逐站查');
check(/!TRANSFER_SCHED_SYSTEM\[tr\.sys\]/.test(index) && /高鐵時刻表推估/.test(index) && /林鐵時刻表推估/.test(index),
  '跟車轉乘助手同時支援台鐵、高鐵與林鐵');
check(/remainSec <= 0 \? 'arrived' : remainSec <= 5 \* 60 \? 'near-5' : 'near-15'/.test(index),
  '自動查詢只有抵達前 15 分、5 分與到站三個里程碑');
check(/state\.clockAtNow && state\.playing && state\.speedMult === 1[\s\S]{0,100}!document\.hidden/.test(index),
  '時光機、暫停、加速與背景頁不查公車即時');
check(/requestKeys:\s*new Set\(\)/.test(ui) && /instance\.requestKeys\.has\(key\)/.test(ui),
  '同一個轉乘里程碑只查一次，不受每幀重繪影響');
check(/Math\.floor\(\(busMs - trainMs\) \/ 60000\) - walkMin - SAFETY_BUFFER_MIN/.test(ui),
  '轉乘裕度向下取整並扣站外步行與安全緩衝，不高估時間');
check(/translate:\s*t/.test(index), '公車卡沿用 App 既有多語系函式');
check(/busTransferCloseBoard\(\);[\s\S]{0,160}state\.boardStation = null/.test(index),
  '關閉車站看板會清除該站公車查詢狀態');

// 去掉註解與字串後檢查可執行程式碼，避免契約說明裡的文字造成假紅。
const executable = ui
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '');
check(!/\bsetInterval\s*\(/.test(executable), 'UI 沒有 setInterval 背景輪詢');
check(!/\bsetTimeout\s*\(/.test(executable), 'UI 沒有 setTimeout 背景輪詢');
check(!/visibilitychange/.test(executable), 'UI 不會因分頁可見性背景重取');
check(/\['live', 'ok', 'available'\]\.includes\(source\.state\)/.test(ui),
  'Worker 的 live 狀態不會被誤標成來源降級');
check(/QUERY_REFRESH_AFTER_SEC = 20/.test(ui), '再次明示展開時以 20 秒為資料刷新界線');
check(/controller:\s*null,\s*legs:\s*new Map/.test(ui) && /請求屬於 station／arrival 共用 store/.test(ui),
  '請求生命週期綁在共用資料狀態，不綁在會被重繪的 DOM');
check(/function sweepDisconnectedInstances\(\)/.test(ui) && /sweepDisconnectedInstances\(\);[\s\S]{0,160}const phase/.test(ui),
  '每次看板重新 mount 都會回收斷線 instance 與 ResizeObserver');
check(/if \(typeof opts\.translate === 'function'\) translateImpl = opts\.translate/.test(ui),
  '模組接受宿主翻譯函式');
check(!/查不到附近公車：\{error\}|查不到這一路的車輛位置：\{error\}/.test(ui),
  '錯誤畫面不再內插 Worker、HTTP 或瀏覽器原始訊息');
check(/rememberRequestError\(state, 'station', error\)/.test(ui) && /rememberRequestError\(leg, 'leg', error\)/.test(ui),
  '原始錯誤只保留供 console 診斷');

for (const key of ['查看現在可搭公車', '步行導航到站牌', '此縣市未提供擁擠度', '資料已過期', '暫時無法取得附近公車資訊，請稍後重試。', '暫時無法取得這一路的車輛位置，請稍後重試。', '目前靜態索引在本站 600 公尺內沒有找到可用公車站牌，因此這次沒有發出即時查詢。你仍可改用地圖查看更遠的站牌。', '預估可轉乘・保守裕度 {n} 分', '轉乘時間偏緊・保守裕度 {n} 分', '這一班目前可能接不上', '轉乘助手 · {station}', '高鐵時刻表推估', '林鐵時刻表推估']) {
  check(translations.includes(`'${key}'`), `英日翻譯表包含「${key}」`);
}

console.log('公車轉乘 UI 靜態守門全部通過。');
