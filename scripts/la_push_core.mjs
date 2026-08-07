// 跟車即時動態的純邏輯。獨立成檔的理由:測試要能直接 import,而 worker.js 從 Node import 不可靠。
// 型態照抄 scripts/trtc_board_ledger.mjs(worker.js:2 就是這樣吃它的)。

// 「現在該顯示第幾個停靠站」。純函式,無副作用——這是唯一決定卡片站名的邏輯,必須驗得動。
// sta/status 來自 TDX TrainLiveBoard,語意(Swagger 原文):
//   TrainStationStatus = [0:'進站中', 1:'在站上', 2:'已離站']
//   StationID =「列車目前所在之車站」,且【含通過不停靠站】
export function laNextIdx(sta, status, staMap, stopCodes, lastIdx) {
  let idx;
  const own = stopCodes.indexOf(sta);
  // 進站中(0)或在站上(1)且該站是停靠站 ⇒ 車還沒離開它,卡片就顯示它。
  // 這正是月台顯示器的語意:進站中「下一站 潮州」、停靠中仍是潮州、離站後才翻成屏東。
  // 通過站不適用(own = -1),不論什麼 status 都走映射表。
  if ((status === 0 || status === 1) && own >= 0) idx = own;
  else idx = staMap[sta];
  if (idx == null) return lastIdx;              // 認不出來就維持現狀,不亂跳
  return Math.max(idx, lastIdx);                // 單調閘門:只進不退
}

// 車不在即時 feed 時的退路(支線 92 站無觀測)。純表定推進:表定到站＋最後已知誤點已過 ⇒ 那站算過了。
// 精度會下降,但卡片【仍然前進】——凍住不動比慢一兩分鐘更糟,使用者會直接認定功能壞了。
// 回傳值可能等於 stops.length(全部過完),呼叫端據此收卡。
export function laSchedIdx(stops, delaySec, nowSec, lastIdx) {
  for (let i = 0; i < stops.length; i++)
    if (stops[i].at + delaySec > nowSec) return Math.max(i, lastIdx);
  return Math.max(stops.length, lastIdx);
}

// 到站時刻 → 卡片上的 arrivalDate。【已過就回 null】,讓 Widget 只畫站名不畫假倒數。
// 這一條同時吃掉交會待避、臨時停車、以及「車停在站上時 DelayTime 不更新」(CTC 是離站觸發)三種情況。
export function laArrivalIso(atSec, delaySec, nowSec) {
  const arrive = atSec + delaySec;
  return arrive > nowSec ? new Date(arrive * 1000).toISOString() : null;
}
