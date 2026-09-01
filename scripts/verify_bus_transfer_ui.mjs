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

for (const [name, stationId] of [['台北', 'TRA:1000'], ['台南', 'TRA:4220'], ['花蓮', 'TRA:7000']]) {
  check(index.includes(`${name}: '${stationId}'`), `${name} pilot 對應 ${stationId}`);
}
check(/st\.sys !== 'tra_sched'/.test(index), 'pilot 入口只出現在台鐵站看板');
check(/phase:\s*'arrived'/.test(index), '第一階段只掛載已抵達查詢，不推算未來接車');
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

for (const key of ['查看現在可搭公車', '步行導航到站牌', '此縣市未提供擁擠度', '資料已過期']) {
  check(translations.includes(`'${key}'`), `英日翻譯表包含「${key}」`);
}

console.log('公車轉乘 UI 靜態守門全部通過。');
