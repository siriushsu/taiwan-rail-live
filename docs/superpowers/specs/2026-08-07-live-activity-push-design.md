# 跟車即時動態（Live Activity）鎖屏自動換站 — 設計書

**日期**：2026-08-07
**狀態**：設計完成，待實作
**前身**：LA-0（純客端跟車卡）已在 `origin/main`，本設計＝LA-1（加 APNs push）
**動快車位置／Live Activity／APNs 前必讀本檔**

---

## 0. 問題

現行 LA-0 的卡片在 App 進背景後就不再更新——**倒數由系統自走，但「下一站」的站名會凍在鎖屏那一刻**。
到站之後不會跳下一站，要等使用者把 App 拉回前景才會一次修正。

根因三條（都在 `origin/main` 可查）：

1. `RailLiveActivityPlugin.swift` 的 `Activity.request(attributes:content:)` **沒帶 `pushType:`** ⇒ 純本機更新，後端推不動。
2. `app/ios/App/App/Info.plist` **沒有 `UIBackgroundModes`** ⇒ App 進背景被系統暫停，WebView 每秒迴圈停止。
3. `RailFollowActivity.swift` 的 `context.state.nextStop` 是靜態文字，只有收到 `update()` 才變；唯一會自走的是 `Text(timerInterval:)`。

程式碼註解自己標過這個邊界（`index.html` 的 `laSync` 區塊）：
> 純客端:App 在前景時推更新,進背景後倒數由系統自走、誤點數字停在最後一次的值(LA-0 的已知邊界)

---

## 1. 三條承重牆

### 承重牆 1：站名來自「觀測」，不來自「推算」

**「下一站」由 TDX `TrainLiveBoard` 回報的 `StationID` 查表得出，不用表定時刻推算。**

設計初稿曾用「表定時刻 + 誤點 offset」推算車現在到哪一站，被使用者一句話推翻：
> 如果我們的資料沒有看到那輛誤點的車到達某一站，那為什麼我們會跳到他的下一站去？

推算的失效模式是**超前**：誤點估錯或凍結，就會提前跨過宜蘭、卡片顯示「下一站 羅東」。
而超前比 LA-0 現在的「落後」更危險——每站都推了新的 `arrivalDate`，倒數看起來活蹦亂跳，
使用者無從分辨真假。這正是專案已經明文拒絕過的東西（`RailLiveActivityPlugin.swift` 的註解）：
> 原稿的 `?? Date().addingTimeInterval(60)` 會在卡片上造出一個憑空捏造、而且真的在走的
> 「還有 1 分鐘」——使用者無從分辨真假。

改用觀測後，「還沒到宜蘭卻顯示羅東」在**結構上不可能發生**，除非 TDX 自己回錯 `StationID`。

### 承重牆 2：前端交「表定」時刻，誤點由後端每分鐘自己算

前端交給後端的是**剩餘各站的表定到站時刻**——一組常數，永不過期。
誤點完全不進這張表，由後端每分鐘從 `traLive` 讀出來當 offset 疊上去。

三個後果：
1. 表不過期 ⇒ 不需要「前端定期重傳」的機制（鎖屏時前端也重傳不了）
2. offset 是後端唯一的動態量，來源單一
3. **高鐵就是 `offset ≡ 0`**，不是另一條程式碼路徑，是同一段程式碼吃不同參數

### 承重牆 3：只有倒數是預測

站名＝觀測（事實）。倒數＝表定 + 當前誤點（預測）。
誤點估不準時，最壞情況是倒數差一兩分鐘，**站名不受影響**。

> **例外：高鐵沒有觀測源。** TDX 的 `TrainLiveBoard` 只涵蓋台鐵，高鐵沒有對應的即時逐車介接。
> 所以高鐵的站名**只能**用表定推算——正是承重牆 1 對台鐵拒絕的做法。
> 之所以可接受，是因為對高鐵而言「表定 ≈ 實際」這個前提成立（準點率極高，
> 且 TDX 本來就給不出高鐵的車次級誤點，`liveDelaySec` 對非 live 系統恆 0）。
> **這個豁免綁在「該系統表定可信」這個前提上，不是通則**——未來要加其他系統時，
> 得先問「這個系統的表定可不可信」，答案是否才准走推算路徑。

---

## 2. 已拍板的決定

| 題目 | 決定 | 日期 |
|---|---|---|
| 更新粒度 | **只換下一站**。誤點值綁在同一發推播裡順帶更新，不另外推 | 08-07 |
| 支援範圍 | **台鐵 + 高鐵**。其他系統維持 LA-0 行為（卡片照開、鎖屏後站名凍住） | 08-07 |
| 台鐵 offset | **含**。高鐵不含（無逐車誤點來源，且表定 ≈ 實際） | 08-07 |
| 12 小時上限 | **不特別處理**。使用者裁示「12 小時一直開著的人應該不太存在」 | 08-07 |
| Plus 驗證時機 | **只在 bind 時驗一次**，cron 不重驗 | 08-07 |
| 動畫 | 進度條 + numericText 轉場。跑馬燈系統層級不給，見 §7 | 08-07 |

---

## 3. 架構

```
[iOS 原生]  Activity.request(pushType:.token)          ← 改一行
     │      pushTokenUpdates → notifyListeners         ← 新增 App→JS 通道
     ↓
[前端 JS]   拿到 token → 算兩張表 → POST /api/la/bind
     │      前景每 10 秒本機 update：完全不動
     ↓
[Worker]    D1 存 binding；cron 每分鐘：
     │        台鐵 → traLive 查 sta 與 delay
     │        高鐵 → 純表定
     │        映射表查下一停靠站 → 單調閘門 → 變了才推 APNs
     ↓
[Widget]    只加一個 Optional 欄位（進度條用），版面邏輯不動
```

### 誰不動

- **前景路徑一行不動**。`laSync` 每 10 秒走本機 `update()` 那條路完全保留。
  推播只在 App 不在前景時發揮作用；回到前景後前端第一發 `update` 自然覆蓋後端的值。
- **`verify_live_activity.mjs` 那 15 組案例必須全數維持通過**，這是第一道回歸閘門。

### 單調閘門

後端記 `last_idx`，停靠站序只增不減。角色是防 TDX 偶發回舊快照、以及守住 fallback 路徑。
（初稿時它的角色是防誤點震盪，改用觀測後那條路已廢，但閘門仍保留，成本三行。）

---

## 4. 資料流

### 4.1 開卡（bind）

```
1. laSync 偵測到換車 → api.start(p)            ← 現有邏輯不動
2. 原生開卡成功 → 開始監聽 pushTokenUpdates
3. token 到達 → notifyListeners('pushToken', {token, key})
4. JS 比對 key（換車了就丟掉）→ 算兩張表 → POST /api/la/bind
5. Worker 驗 Plus entitlement → 寫 D1
```

**開卡不等 token。** `start` 照舊立刻回 `ok:true`，卡片先開起來（就是現有 LA-0 行為），
token 到了才註冊後端。token 永遠不來（權限關閉、模擬器）就自然退化成現況，不是壞掉。

Swift 端：

```swift
tokenTask = Task { @MainActor in
    for await data in activity.pushTokenUpdates {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        self.notifyListeners("pushToken", data: ["token": hex, "key": key])
    }
}
```

**三個陷阱**：
1. `pushTokenUpdates` 是 AsyncSequence，**會多次 yield**（token 會輪替），不是一次性 callback。
2. 換車時必須 `tokenTask?.cancel()`，否則舊卡的 token task 還活著，會把舊 token 當新的送上來，
   推到一張已收掉的卡。token task 的建立與取消**必須掛在現有的 `enqueue` 序列鏈上**，不能另開。
3. JS 端收到時要比對 `_laKey`，沿用現有那條「比較新的那張卡不能被舊的失敗回呼清掉」的同一個思路。

### 4.2 換站推播（cron 每分鐘）

```
撈未過期 bindings → 讀 traLive 快取（一次，全部共用，零新增 TDX 呼叫）
  ├ 該車在 feed：idx = staMap[sta]
  │    status 0/1 且 sta 本身是停靠站 → idx 指向 sta 自己（車還沒離開它）
  ├ 不在 feed（支線 92 站缺口）：表定 + last_delay 推算
  └ 高鐵：純表定推算（無觀測源，見承重牆 3 的例外；last_delay 恆 0）
單調閘門 idx = max(idx, last_idx) → 變了才推 APNs
```

**`/api/la/bind` 是外部可打的端點**，必須掛 rate limiter（專案已有五個可比照）
並驗 Plus entitlement。未驗證的請求不得寫入 D1——否則任何人都能塞爆 `la_bindings`。

`traLive` 可由 cron 直接內部呼叫，專案已有此 pattern（`worker.js` 裡 `traAlert(new Request(base + '/api/tra-alert'), env)`）。
與訪客共用同一份雙層快取（邊緣 55 秒 + 記憶體），**零新增 TDX 呼叫**。

APNs 請求：

```
POST https://api.push.apple.com/3/device/{token}
apns-topic: tw.railisland.app.push-type.liveactivity
apns-push-type: liveactivity
apns-priority: 5          ← 刻意：priority 5 不計入更新預算，不指定則預設 10 且計入
authorization: bearer <ES256 JWT，用 p8 金鑰簽>
```

### 4.3 收卡（unbind）四個觸發

1. 使用者停止跟車 → JS `laStop` → `POST /api/la/unbind`
2. 車到終點 → 前端偵測（`nextStopInfo` 回 null）**＋** 後端偵測（`staMap` 走完）雙保險
   （鎖屏時前端不在，只靠前端會漏）
3. APNs 回 `410 Unregistered` / `BadDeviceToken` / `DeviceTokenNotForTopic` → 後端自刪該列
   （🔴 修復輪次2：這三者都可能是單一設定錯誤——host 或 apns-topic 打錯——讓整批同時回報，
   不是個別 token 失效；已加批次熔斷擋這種情況，見 §6）
4. `expire_at`（開卡 + 8 小時）到期 → 停推清列

---

## 5. 資料契約

### 5.1 ContentState（Widget 側）

> 🔴 **修復輪次2 契約修訂**（原文 → 現在 → 為什麼；Task 7 讀這份規格前必看）
>
> - **原文**：`arrivalDate` / `departedDate` 是 `Date?`，後端送 `toISOString()` ISO-8601 字串。
> - **改成**：Swift 端型別改 `Double?`（Unix epoch 秒數）；後端對應送純數字
>   （`Math.floor(epochMs/1000)`），`Date` 轉換收斂到 SwiftUI view 層（見 `plan.md` Task 7 的
>   `progress()` helper）。
> - **為什麼**：Apple 官方（WWDC23 session 10185）明講 Live Activity 的 content-state 一律用
>   `JSONDecoder`**預設**編碼策略解碼，自訂策略「會導致更新失敗」；而預設 `.deferredToDate`
>   策略解碼單一數字時，是當成 `timeIntervalSinceReferenceDate`（2001-01-01 為零點），
>   不是 ISO-8601、也不是 1970 epoch。Apple 開發者論壇有真實案例：字串誤餵進 `Date` 欄位在
>   真機上以 `NSCocoaErrorDomain (4864)` 解碼崩潰，且伺服器端完全看不出來（送出當下仍是 200）。
>   選數字契約可以從根本避開這整類「型別看起來對、解碼卻默默解錯」的風險。
> - **影響範圍**：本節 struct、`plan.md` Task 7 的欄位宣告與 `progress()` helper，三處已同步。
> - 🔴 **Task 6 與 Task 7 必須同批上線**——原因見 §10 新增那條。

```swift
struct ContentState: Codable, Hashable {
    var nextStop: String
    var arrivalDate: Double?    // Unix epoch 秒數，nil = 算不出 ETA，不畫倒數。
                                 // 型別刻意不用 Date——見上方修訂註記。
    var departedDate: Double?   // 【新增】上一站表定發車 + 當前誤點，進度條起點，同樣是 epoch 秒數。
    var delaySec: Int
    var terminus: String
}
```

**只加 Optional 欄位。** `RailFollowAttributes.swift` 的註解警告過「事後加欄位會讓
App 更新前開的卡解不出來」——那條對**非 Optional** 欄位成立；Swift 自動生成的 Codable
對 Optional 屬性走 `decodeIfPresent`，舊 payload 缺 key 會解成 `nil` 而非失敗。

> ⚠️ 這是對 Swift 語意的判斷，**不是實測**。實作時必須跨版本真機測一次：
> 舊版開卡 → 換新版 Widget → 確認卡片沒變空白。

### 5.2 bind payload

```json
{
  "token": "…",
  "sys": "tra_sched",
  "trainNo": "270",
  "stops":  [{"name":"彰化","arrSec":81000}, …],
  "staMap": {"1150": 3, "1160": 3, "1170": 4, …}
}
```

`staMap` 涵蓋這班車**所有經過站（含通過站）**，值是「下一個停靠站在 `stops` 裡的索引」。
由前端 `tr.stops` 算出（它本來就含 `stop:false` 的通過站）。莒光 554 那種 146 站的長途車約 1.5KB。

> ⚠️ **實作前要驗**：dense 班表的 `stops` 裡有沒有 TDX 的 `StationID`。
> 映射表要用站碼當鍵；若班表只有站名，得多一張站名→站碼對照
> （TDX `Rail/TRA/Station` 專案本來就抓過）。

### 5.3 D1

```sql
CREATE TABLE la_bindings (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  sys TEXT NOT NULL,
  train_no TEXT NOT NULL,
  stops TEXT NOT NULL,                     -- JSON
  sta_map TEXT NOT NULL,                   -- JSON
  last_idx INTEGER NOT NULL DEFAULT -1,
  last_delay INTEGER NOT NULL DEFAULT 0,   -- fallback 用的最後已知誤點（秒）
  bound_at INTEGER NOT NULL,
  expire_at INTEGER NOT NULL
);
CREATE INDEX ix_la_expire ON la_bindings(expire_at);
```

每分鐘每張卡最多 1 write（只在換站時），讀是一次全表掃未過期列。
同時一百張卡也遠在 D1 免費額度內。

Plus 驗證用既有的 `checkPlusEntitlement()`（Firebase ID token → RevenueCat）。
**只在 bind 時驗一次**——重驗等於每分鐘每張卡打一次 RevenueCat，太貴。
代價：使用者退訂後手上那張卡最多殘留到該趟車結束。

---

## 6. 錯誤處理與降級

**原則：每條路徑都往「誠實」那側倒——寧可少顯示，不可顯示假的。**

| 情況 | 行為 |
|---|---|
| 拿不到 push token（權限關閉／舊裝置／模擬器） | 卡片照開，退化成 LA-0。不報錯、不重試洗版 |
| `traLive` 掛掉 | offset 沿用 `last_delay`，**不歸零**（歸零會讓卡片跳） |
| 車不在 feed（支線 92 站缺口） | 退回表定 + `last_delay` 推算，精度下降但仍前進 |
| **到站時刻已過**（交會待避、臨時停車、資料延遲） | 推一發 `arrivalDate = nil` ⇒ 卡片只剩站名，不畫假倒數 |
| APNs 回 410 / BadDeviceToken / DeviceTokenNotForTopic（**個別**幾個 token） | 後端自刪該列，停止推送 |
| 🔴 同一 tick 內**大比例** token 同時回報上述永久失敗 reason（修復輪次2新增；懷疑是 host/topic 設定錯，不是個別 token 失效） | 批次熔斷：本輪不刪任何列，只記警告 log（含比例與總列數），等人工排查——避免一次設定錯誤掃空整張表 |

### 為什麼要有「到站時刻已過 → 收掉倒數」這條

非計畫的交會待避無法預測（表定只含計畫中的交會）。更陰險的是：
**車停在站上不動時，`DelayTime` 可能根本不更新**——CTC 是**離站**觸發的。
車卡在站上十分鐘，誤點數字可能一動不動，倒數卻顯示「還有 2 分鐘」。

這一條規則同時吃掉交會待避、臨時停車、資料延遲所有「車比預期慢」的情況，不必分別處理。
Widget 端不用改：`countdown()` 本來就寫著「`arrivalDate` 為 nil ⇒ 整列不畫」。

---

## 7. 動畫：能做什麼、不能做什麼

### 做不到（官方層級禁止）

ActivityKit 文件原文：
> the system ignores any animation modifiers — for example, `withAnimation(_:_:)` and
> `animation(_:value:)` — and uses the system's animation timing instead.

HIG 另訂**最長兩秒**，且 Always-On Display 不執行動畫。
⇒ **跑馬燈、脈動、旋轉等裝飾性持續動畫，一條都做不到。**

`TimelineView` 在 ActivityKit 官方頁逐字搜尋**零命中**，論壇回報 `.periodic` 只觸發兩次就停，
Apple 工程師未確認也未否認 ⇒ **完全避開**。

### 做得到

系統會自己隨時間更新、不需推播的元件**只有兩個**：

1. `Text(timerInterval:countsDown:)` —— 已在用
2. `ProgressView(timerInterval:)` —— 官方原文「Creates a progress view for showing
   continuous progress as time passes」

### 採用的做法

```
自強 270                        ⏱ 3:24
彰化 ●━━━━━━━━━🚆━━━━━━○ 花壇
     準點
```

- **進度條**（`departedDate` → `arrivalDate`）：逐幀連續、不靠推播，是「一直在跑」的主要來源
- **倒數**：本來就在動
- **換站那一刻**：`.contentTransition(.numericText())` 做數字滾動（WWDC23 官方推薦的兩種轉場之一）

> ⚠️ **兩個要真機驗的但書**：
> (a) 官方註明 date-relative 的 ProgressView「don't support custom styles」，
>     社群說 `.linear` 可用，兩邊有張力 ⇒ 進度條能做多少視覺客製必須真機試過才知道。
> (b) `.contentTransition(.numericText())` 在 iOS 17 beta 有過動畫失效的 bug，
>     正式版已修，同樣要真機確認。

WWDC23 另示範過「地圖圖釘平滑移動到新位置」——列車圖示放固定路線上，每次推播更新位置，
系統自動補平滑過渡。但**每 6.5 分鐘才換一站**，圖示動一次停很久，只能當換站點綴，
撐不起「持續在跑」。

---

## 8. 驗收

### 第一層：回歸閘門（現成，最重要）

`scripts/verify_live_activity.mjs` 那 **15 組案例必須全數維持通過**。
前景路徑一行都不該動，它們紅了就是被改壞了。不用新寫。

### 第二層：後端邏輯（新寫，合成資料，不打真 API）

必須有牙的案例：
- `sta` 落在通過站 → 正確跳到下一個**停靠**站
- `sta` 落在停靠站 + status 0/1 → 下一站是**它自己**，不是後一站
- `sta` 倒退（模擬 TDX 回舊快照）→ 單調閘門擋住，不推
- 車不在 feed → 走 fallback 而不是崩掉
- 到站時刻已過 → 推 `arrivalDate = nil`

**每條都要配突變測試**：把閘門拿掉、把映射改錯，確認對應案例真的變紅。
（本次設計期間踩過一次「零樣本其實是我解析錯」——全綠不等於有驗到。）

### 第三層：真機（不可省）

模擬器對 Live Activity 的結論不可信。要在真 iPhone 跟一趟真車，確認：
- 鎖屏後站名真的會換
- 動態島 compact / minimal / expanded 三態版面沒破
- 進度條真的在走
- ContentState 跨版本相容（舊版開卡 → 換新版 Widget → 卡片沒變空白）

---

## 9. 硬前置（使用者必須親自做）

1. **APNs p8 金鑰**：到 Apple Developer → Keys → 新增 → 勾 Apple Push Notifications service，
   下載 `.p8`（**只能下載一次**）。之後放進 Cloudflare secret。
2. **App ID 勾選 Push Notifications 能力**。
3. **entitlements 補 `aps-environment`**：`App.entitlements` 與
   `RailBoardWidgetExtension.entitlements` 目前**兩份都沒有**，是必補的第一刀。

---

## 10. 已知邊界（刻意不處理）

| 邊界 | 理由 |
|---|---|
| 8 小時後停止更新（Apple 一手：active 上限 8 小時、鎖屏最多顯示 12 小時）。環島之星 13 小時會在終點前斷 | ActivityKit 硬限制。使用者 08-07 裁示「12 小時一直開著的人應該不太存在」⇒ 不做「快到期提示續開」的 UI |
| 退訂後卡片殘留到該趟車結束 | cron 重驗 Plus 太貴，見 §5.3 |
| 支線 92 站無即時觀測 | TDX 資料源硬天花板，見 §11 |
| 非計畫交會待避無法預測 | 無資料源。已用「到站時刻已過 → 收掉倒數」降級，見 §6 |
| 動態島僅 iPhone 14 Pro 以上 | Apple 硬體限制。**定價文案不可拿動態島當主視覺** |
| 🔴 Task 6 與 Task 7 必須同批上線（修復輪次2新增） | Task 7 之前，後端已經在送 epoch 數字時，Swift 端若還是舊版 `Date?`，`.deferredToDate` 會把它解成 `timeIntervalSinceReferenceDate`（2001 年零點）⇒ 卡片顯示約 2058 年的倒數——不會解碼失敗、不會崩潰，**所以現象上看不出哪裡錯**，見 §5.1 修訂註記 |

---

## 11. 附錄：本次查證與實測的證據

> 這一節存在的理由：下次有人想改架構時，不必重測一遍。

### 11.1 TDX 給不出「逐站預計到站時刻」（Swagger 原文查證）

台鐵 v3 共 35 條端點，名稱含 Live / Arrival / Estimate / Delay 的只有 `StationLiveBoard`
與 `TrainLiveBoard`。逐字 grep「Estimate」「預估」跨全部 49 條路徑與 schema：**零命中**。

- `StationLiveBoard` 欄位＝`ScheduleArrivalTime`（表訂到站時刻）+ `DelayTime`（延誤分鐘），
  且以**站**為單位查（回傳該站此刻有哪些車要來），與「一班車未來各站」方向相反。
- `TrainLiveBoard` 官方描述：「本項資料為『列車目前所在之車站』資料」

⇒ **全域 offset 平移不是我們選的架構，是 TDX 資料結構本身的限制。** 台鐵自己也只發佈這一個數字。

### 11.2 `StationID` / `TrainStationStatus` 語意（Swagger 原文）

- `TrainStationStatus`：`"列車目前所在之車站狀態 : [0:'進站中',1:'在站上',2:'已離站']"`
  （語意內嵌在 description 字串，非結構化 enum；查無官方英文定義）
- `StationID` 唯一的官方例子明確排除「下一站」解讀：
  「145車次剛從萬華**離開**，而不是正前往萬華」
- **官方明文含通過站**：「本項資料**並非僅提供列車停靠站資料**」
  「提供所有經過站資料是為確保車次的準誤點資料都會是最新的」

實測佐證：莒光 554 班表經過 146 站、僅 54 站停靠，今日觀測到 87 個不重複 `StationID`。

**實務**：2026-08-07 當日 783 筆全是 `status=2`，此欄位鑑別力低，主要情境就是「剛離開某站」。

### 11.3 誤點震盪（2026-08-07 21:55–22:08，`/api/tra-live` 取樣 14 次，去重後 12 份）

```
每次上游刷新（實測平均 66 秒）之間：
  1451 組車次-對，有變動 166 組 = 11.4%
  上升 93 組 (6.4%)   下降 73 組 (5.0%)
  |變動| 中位 1 分、p90 1 分、最大 15 分
  分布：-13:1  -3:1  -2:2  -1:69  |  +1:85  +2:7  +15:1
```

⇒ **誤點不是單向累積的**（上升:下降 = 1.27:1）。設計初稿曾假設「車越晚越晚」，實測不成立。

### 11.4 凍結 offset 的誤差（今日 D1 觀測，等距抽樣 90 班／47 班有效）

量的是「在某站鎖屏、把當時誤點當常數用到後面各站」的誤差，只納入觀測時刻相隔 10–60 分鐘的配對。

```
全體 47 班：每班典型誤差 中位 0 分、p90 1 分、最大 2 分
            每班最壞誤差 中位 2 分、p90 5 分、最大 12 分
            典型誤差 ≥3 分的車：0/47 = 0%
分層：準點車 典型 0 分 ｜ 誤點 3-9 分的車 典型 1 分
```

⇒ **典型誤差 0–1 分鐘，遠小於台鐵站間 4–10 分鐘**；但**十班有一班**在途中某刻會差 5 分以上。
offset 的價值在保護這條尾巴，不在典型情況。

> ⚠️ **方法論警告**：初版取樣挑了「今日誤點最嚴重的 60 班」，得到「典型 3 分、p90 34 分」——
> 與無偏取樣差一個數量級。**拿排序後的頭部樣本下結論會嚴重高估。**

### 11.5 `TrainLiveBoard` 的更新頻率與站涵蓋（同一批取樣）

```
每班車平均每 6.5 分鐘經過一個站（含通過站）
相鄰刷新間 sta 有變的比例 13.5%
我們的刷新間隔 55–66 秒 ⇒ 觀測延遲最多約 1 分鐘
站涵蓋：554 班 87/146 = 59.6%（歷史 API 是 152/244 = 62.3%，同一套 CTC 源）
```

### 11.6 動畫限制

見 §7。完整逐字引用與來源在
`scratchpad/la_animation_limits.md`（本次 session 產物，未進版控）。

---

## 12. 相關

- **即時通過觀測拿來錨快車位置**：另一件事，使用者裁示「先收完 LA」再做。
  重點：現有 `tra_pass_obs` 是**離線**建模（59 天歷史），而 `sta` 是**即時**觀測，
  目前只用來顯示誤點與存 D1 歷程，**沒有拿來即時校正跑段中的位置**。
  實測：即時錨定可把誤差從「最壞 4.7 公里」壓到「最壞 1.7 公里」，錨點每 6.5 分鐘一個。
  會動到 `buildObsProfile` / `assignRunProfiles` / `easedShift` 核心，且需處理
  「即時錨點與 easedShift 時間軸校正會不會打架」。

- memory：`notification-design`（LA 四階規劃、§9 車次訂閱）、`tra-pass-obs-model`（快車位置模型）、
  `app-ios-shell-progress`（build 版號）、`monetization-cost-decisions`（Plus 分層）
