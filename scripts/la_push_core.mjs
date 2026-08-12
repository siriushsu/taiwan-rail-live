// 跟車即時動態的純邏輯。獨立成檔的理由:測試要能直接 import,而 worker.js 從 Node import 不可靠。
// 型態照抄 scripts/trtc_board_ledger.mjs(worker.js:2 就是這樣吃它的)。

// 「現在該顯示第幾個停靠站」。純函式,無副作用——這是唯一決定卡片站名的邏輯,必須驗得動。
// sta/status 來自 TDX TrainLiveBoard,語意(Swagger 原文):
//   TrainStationStatus = [0:'進站中', 1:'在站上', 2:'已離站']
//   StationID =「列車目前所在之車站」,且【含通過不停靠站】
// 🔴 lastObsIdx(第 6 參,選填)=「最後一次【真的被觀測到】的索引」。單調閘門的地板改綁它,
//    不綁 lastIdx。為什麼要分開:上游整批失效時 laSchedIdx 會拿表定把 lastIdx 往前推(卡片不能
//    凍住,見使用者裁示),推過頭之後舊寫法的 Math.max(idx, lastIdx) 會讓觀測【永遠】拉不回來——
//    錯的站名黏到列車真的追上為止,正是「顯示一件沒發生的事」。
//    改綁 lastObsIdx 之後:(a) 全程都有觀測時 lastObsIdx === lastIdx,行為與舊寫法逐字相同;
//    (b) 中間插過表定推算時,觀測可以把索引往回修,但【最低只能修回上一次真的觀測到的那一站】
//    ⇒ 閘門原本要擋的「觀測自己來回跳」(觀測序列必須單調不減)一格都沒放進來。
//    省略第 6 參時退回舊語意(地板＝lastIdx),既有的純函式驗收不受影響。
export function laNextIdx(sta, status, staMap, stopCodes, lastIdx, lastObsIdx) {
  const idx = laObsIdx(sta, status, staMap, stopCodes);
  if (idx == null) return lastIdx;              // 認不出來就維持現狀,不亂跳(此時沒有新觀測可用)
  const floor = lastObsIdx == null ? lastIdx : lastObsIdx;
  return Math.max(idx, floor);                  // 單調閘門:觀測序列只進不退(表定推過頭的部分可回收)
}

// 🔴 複審 I-1:「這一發觀測解出了哪個索引」必須能單獨問到。laNextIdx 的回傳值把
//    【認不出這個站碼】與【解出來了但被單調閘門擋下】壓成同一個值(都是 lastIdx),
//    呼叫端分不出來 ⇒ 會把「表定推過頭的舊值」當成新觀測寫回地板(last_obs_idx),
//    地板一被毒化,之後真觀測就再也拉不回來,工項 B 對那一趟永久失效。
//    回 null＝這一發沒有可用的新觀測(不是「觀測說車在第 -1 站」)。
// 進站中(0)或在站上(1)且該站是停靠站 ⇒ 車還沒離開它,卡片就顯示它。
// 這正是月台顯示器的語意:進站中「下一站 潮州」、停靠中仍是潮州、離站後才翻成屏東。
// 通過站不適用(own = -1),不論什麼 status 都走映射表。
export function laObsIdx(sta, status, staMap, stopCodes) {
  const own = stopCodes.indexOf(sta);
  if ((status === 0 || status === 1) && own >= 0) return own;
  const idx = staMap[sta];
  return idx == null ? null : idx;
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
// 🔴 修復輪次1(裁定):回傳值是 epoch 秒數字,不是 ISO 字串。原因:Swift 端 JSONDecoder 預設
// dateDecodingStrategy 是 .deferredToDate,委派給 Date 自己的 Decodable——那條路解的是單一
// Double(timeIntervalSinceReferenceDate,2001 起算),不是 ISO 8601。送 ISO 字串會在裝置端解碼
// 失敗(NSCocoaErrorDomain 4864),伺服器端完全看不到。前身叫 laArrivalIso,改名反映新契約
// (舊名字仍留著會誤導——一個叫「Iso」的函式卻回數字)。
export function laArrivalEpoch(atSec, delaySec, nowSec) {
  const arrive = atSec + delaySec;
  return arrive > nowSec ? arrive : null;
}

// APNs 的 provider token(ES256 JWT)。Apple 規定至少 20 分鐘才可換新、最長 60 分鐘,
// 所以快取 50 分鐘——每次都重簽會被 Apple 當濫用擋掉。
// 🔴 修復輪次1(Important 4):快取鍵加上 KEY_ID/TEAM_ID——金鑰輪替時舊快取不會被誤用;
// 另外提供 laJwtReset() 給 403 InvalidProviderToken 時強制作廢,不必等滿 50 分鐘。
let _laJwt = null, _laJwtAt = 0, _laJwtKey = '';
// 🔴 最終複審 A-I4:Apple 明文要求 provider token 的更新頻率不得高於每 20 分鐘,否則回
// 429 TooManyProviderTokenUpdates。持續 403(金鑰輪替、APNS_TEAM_ID/APNS_KEY_ID 設錯)時
// 舊碼每個 tick 都 laJwtReset() ⇒ 每分鐘重簽一把 ⇒ 幾乎必然被 Apple 節流,把一個「改個設定
// 就好」的故障變成「連改好之後也還要等節流解除」。冷卻期就是 Apple 那條 20 分鐘。
const LA_JWT_RESET_COOLDOWN_MS = 20 * 60 * 1000;
let _laJwtResetAt = 0;
export async function laJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const key = `${env.APNS_KEY_ID}:${env.APNS_TEAM_ID}`;
  if (_laJwt && _laJwtKey === key && now - _laJwtAt < 3000) return _laJwt;
  const pem = String(env.APNS_KEY_P8).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const b64u = o => btoa(typeof o === 'string' ? o : JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const head = b64u({ alg: 'ES256', kid: String(env.APNS_KEY_ID) });
  const body = b64u({ iss: String(env.APNS_TEAM_ID), iat: now });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey, new TextEncoder().encode(`${head}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  _laJwt = `${head}.${body}.${sigB64}`; _laJwtAt = now; _laJwtKey = key;
  return _laJwt;
}
// APNs 403(InvalidProviderToken,通常是金鑰輪替或時鐘偏移)時呼叫:強制作廢快取,
// 下一次 laJwt() 會無條件重簽,不必等滿 50 分鐘的自然快取期限。
// 🔴 最終複審 A-I4:帶 20 分鐘冷卻(見上方常數)。回傳值表示「這次真的作廢了嗎」,
// 呼叫端可據此決定要不要 log(在冷卻期內每分鐘噴一則「已重簽」是誤導的)。
export function laJwtReset() {
  const nowMs = Date.now();
  if (_laJwtResetAt && nowMs - _laJwtResetAt < LA_JWT_RESET_COOLDOWN_MS) return false;
  _laJwtResetAt = nowMs;
  _laJwt = null; _laJwtAt = 0; _laJwtKey = '';
  return true;
}
