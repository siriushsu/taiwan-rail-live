# 跟車卡進站軌道：三端契約（2026-09-23）

使用者裁示（逐字）：
- 21:38「第一是不應該是等車才出現，應該是在跟車就要出現，到站以後就是往下一站，車子照樣在中間跑。第二是ios有兩節，android卻只有一節車廂，而且路程的標示用一個方塊看起來不太對，應該就是車子前面後面是不同顏色的路線。」
- 22:08 看過樣張（`~/Desktop/軌島小工具背景方案/跟車卡進站軌道樣張.html`）後：「1. 維持一節大車就好 2. a 3. Y」

所以：

| 題目 | 定案 |
|---|---|
| 系統範圍 | 跟車卡軌道只做 **台鐵（`tra_sched`）＋高鐵（`thsr_sched`）**；其他系統跟車卡維持現狀 |
| 一段的兩端 | **上一停靠站 → 下一停靠站**；通過站不畫 |
| Android 車 | **維持一節大車**（現在 `RailWaitTrack.car()` 那樣補成 2:1 畫布、寬撐滿 40dp）。不做兩節 |
| 路程標示 | **(a)**：拿掉方塊（`addProgressPoint`）。車後面（已走）＝軌道灰，車前面（未走）＝路線色 |
| 停站 | **Y**：到站後、發車前＝「停靠中」，軌道仍是「上一站 → 本站」、車停在本站站牌旁；**發車才換成**「本站 → 下一站」 |

iOS 與 Android 長得不一樣可以接受（裁示原話「這沒關係」）。

## 一、網頁（index.html）→ 原生／伺服器

### 1. 跟車卡 start／update payload（`laPayload(tr)`）新增

| 欄位 | 型別 | 內容 |
|---|---|---|
| `carModel` | string \| null | 網站 3D 列車 formations.js 的車型 id（同 `traWaitCarModel(tr)`；高鐵是 `700t`）。只在 `tr.sys` 是 `tra_sched`／`thsr_sched` 時送，其他一律 `null`。拿不到（模組載入失敗）送 `null`，卡片退回舊版面 |
| `plateLeft` | string \| null | `nextStop` 在實體路線上、車開過來那一側的鄰站（`tr.stops` 含通過站，取 `stops[i-1].name`）；沒有送 `null` |
| `plateRight` | string \| null | `nextStop` 車要去那一側的鄰站（`stops[i+1].name`）；終點送 `null` |
| `remainingStops[k].depAt` | number | 該站**自己的**發車 epoch 秒（`depSec`，沒有就等於 `arrivalAt`）。Android 背景推進用它實作 Y |
| `remainingStops[k].plateLeft`／`plateRight` | string \| null | 同上，對應該站 |
| `handoff`（native 那份）裡接續車的 `carModel` | string \| null | 轉乘交棒後換車，車型跟著換 |

`carModel` 是 async 取得（動態 import formations.js）；`laPayload` 是同步函式 ⇒ 用快取（例如以 `sys#train` 為鍵先算好存起來），第一次還沒算好就送 `null`，下一發 update 補上。**不准為了等它延後開卡。**

### 2. 交班給伺服器（`laBind` → `POST /api/la/bind`）的 `stops[]` 新增

| 欄位 | 內容 |
|---|---|
| `dep` | 該停靠站表定**發車** epoch 秒（`originSec + depSec`，沒有 `depSec` 就不送這個 key） |
| `pl`／`pr` | 該站站牌的左右鄰站（同上 `plateLeft`／`plateRight`），沒有就不送 |

另外 body 新增 `carModel`（同上）。舊前端不送這些 ⇒ 伺服器一律當 `null` 處理。

## 二、伺服器（worker.js `laPushAll`＋scripts/la_push_core.mjs）

1. **Y 語意（沒有觀測、只能照表定時）**：`laSchedIdx` 改成以「發車」判斷那站過了沒：`(stops[i].dep ?? stops[i].at) + delay > now` 才停在第 i 站；同時 `now >= stops[i].at + delay`（已到、未開）⇒ `stopping = true`。有觀測時（TDX status 0/1 在停靠站上）本來就是 Y，不動。舊 binding 沒有 `dep` ⇒ 行為與現在逐字相同。
2. **`departedDate`** 改用 `prev.dep ?? prev.at`（現在用的是上一站**到站**時刻，網頁前景用的是發車，兩邊不一致）。
3. **推播節奏**：行駛中（`stopping` 為假、有 `prev`、`arrivalDate` 非 null、非 `transferWaiting`）的列，**每分鐘都推**（不再「沒變就不推」），再加上同一次 cron 內 +30 秒的只挪車那一輪——比照 `waitCardHalfMinute`（worker.js 約 4323 行），第二輪吃第一輪交下來的 `live`，**零額外上游呼叫**；優先度維持 5。停靠中與其他狀態維持「變了才推」。
4. **content-state 新增**（Swift 端全是 Optional、只加在尾端；一律送 key，沒有就送 `null`）：

| key | 型別 | 內容 |
|---|---|---|
| `tick` | number | 這一發送出的 epoch 秒（iOS 用它算車位，不用 `Date()`） |
| `carModelOverride` | string \| null | 交棒換車後的車型；一般單段送 `null` |
| `plateLeft`／`plateRight` | string \| null | 目前 `nextStop` 的站牌鄰站（取 binding `stops[idx].pl/pr`） |

5. 驗收：`scripts/verify_la_push_loop.mjs`、`scripts/verify_la_backend.mjs` 全綠，並新增：Y 表定三段（未到／停靠中／已開）、每分鐘推＋半分鐘那一輪的次數與零上游呼叫、`tick`／新 key 永遠存在、舊 binding（沒有 dep/pl/pr）行為不變。突變至少各一發指名考哪一條。

## 三、iOS（RailBoardWidget／App）

1. `RailFollowAttributes`：Attributes 尾端加 `var carModel: String?`；ContentState 尾端加 `tick: Double?`、`carModelOverride: String?`、`plateLeft: String?`、`plateRight: String?`。**全部 Optional、只加在尾端**（1.6.11 已開著的卡要解得開）。
2. `RailLiveActivityPlugin`：start 讀 `carModel` 進 attributes；`state(from:)` 讀 `plateLeft`／`plateRight`，`tick` 填呼叫當下的 epoch（前景由 App 自己更新時，車照樣會動）。
3. 版面（鎖定畫面 ≤160pt）：`sys` 是台鐵／高鐵且 `TraWaitHop.carAspect(carModelOverride ?? carModel)` 有值 ⇒ 新版面；否則維持現在的 `RailSpineTrack` 版面不動。新版面照 1.6.11 台鐵等站卡 B（`TraWaitActivity.swift`）：
   - 第一列：車種標＋車次＋「往 終點」＋右側倒數（停靠中＝實心「停靠中」、即將進站＝實心「進站」）。
   - 軌道：`MetroWaitTrack`（`MetroWaitDisplay.TrackB`）。左＝`prevStop`＋「HH:MM 開」（`departedDate`），右＝站牌（`nextStop`，台鐵帶鄰站 `plateNeighbours`；高鐵不帶鄰站、帶子用車種色），右下＝「HH:MM 到」。
   - 最後一列：狀態詞 · 誤點 ＋ notice ＋ 結束鈕。
   - 動態島展開版同樣換成 `MetroWaitTrack(island: true)`。
4. 車位（`TrackB.Car`）：`tick` 為 nil ⇒ `.none`（不畫車）；`stopping` 或 `tick >= arrivalDate` 或 `arrivalDate` 為 nil ⇒ `.arrived`；資料過期 ⇒ `.arrived`（同台鐵等站卡）；否則 `.running((tick - departedDate) / (arrivalDate - departedDate))`；沒有 `prevStop`（始發前）⇒ `.none`。`transferWaiting` ⇒ `.none`。
5. `MetroWaitTrack` 加一個參數讓上一站內縮（跟車卡用約 100pt＝一列車長，車剛發車時整列看得到）；預設值維持 12，等車卡外觀不變。
6. `TraWaitHop.carAspect` 補 `case "700t": return 2.701`（素材已在 `la-side-700t.imageset`）。
7. 驗收：`app/scripts/render_activity_widget.mjs` 算繪行駛中／即將進站／停靠中／剛發車四態 × 淺深 × 鎖屏＋動態島，量高度 ≤160pt；舊版面（捷運跟車卡、沒有 carModel）截圖與改前逐像素相同或說明差異；1.6.11 的 ContentState JSON（沒有新 key）解得開。

## 四、Android（RailFollowNotification.java／RailWaitTrack.java）

1. **等車卡 (a)**：`RailWaitTrack.style()` 的 `pos == -2`（還沒到上一站）拿掉 `addProgressPoint`，整條 1000 一段路線色，車在最左。其他狀態不動。
2. **跟車卡**：Android 16（SDK 36）且 `sys` 是台鐵／高鐵且車型有素材 ⇒ 用 `RailWaitTrack` 同一套：tracker＝**一節大車**（`car()` 補 2:1 畫布）、start 圖示＝空心圓 `ring()`、end 圖示＝站牌 `plate()`；分段在車頭切開：車後 `rail` 灰、車前路線色（`color`）；站牌帶子台鐵用站牌深藍 `0xFF26497E`、高鐵用車種色。沒有車型素材或其他系統 ⇒ 維持現在的通用樣式。
   - 車位＝`(now - departedAt) / (arrivalAt - departedAt)`；停靠中 ⇒ 1（車在站牌旁、整條灰）；沒有 `prevStop` 或 `transferWaiting` ⇒ 不畫車。
   - `traCarDrawable` 補 `case "700t": return R.drawable.la_side_700t`（素材已在 drawable-nodpi）。
3. **車會動**：行駛中每 `RailWaitTrack.MOVE_TICK_MS`（20 秒）本機重貼一次（只重算位置、不連網），用 AlarmManager 比照等車卡。停靠中、沒畫車時不排。
4. **Y（背景推進）**：`advance()` 改成：現在 < 本站 `arrivalAt` ⇒ 往本站跑；`arrivalAt` ≤ 現在 < 本站 `depAt` ⇒ 停靠中（`stopping=true`，仍顯示本站）；≥ `depAt` ⇒ 換下一站。沒有 `depAt`（舊 payload）⇒ 行為與現在相同。鬧鐘排在「下一個狀態轉換」時刻。台鐵每分鐘 `refreshOfficial` 的觀測（在站上）與此一致，不准互相打架。
5. 驗收：`RailFollowNotificationInstrumentedTest`、`RailWaitNotificationInstrumentedTest` 補案例（分段顏色與切點、沒有 Point、tracker 有設、Y 三段、舊 payload 不變），在自己開的模擬器跑（`emulator -avd RailIsland_API35_Pixel7 -read-only -no-snapshot -no-window -no-audio -no-boot-anim -port <自選>`，跑完 `adb -s emulator-<port> emu kill`）；API 35 沒有 ProgressStyle 的斷言要說明怎麼驗到。**不准碰 A54／任何實體手機**。

## 五、共通鐵則

- 不准 `git stash`、不准 `reset`／`checkout` 別人的東西、不准 `pkill`／`kill` 不是自己啟動的程序；寫入類 git 一律 `git -C <自己的 worktree 絕對路徑>`。
- 只在自己的 worktree、自己的分支 commit；**不 push、不部署、不上傳**。
- 改了等車卡或跟車卡外觀要同步更新紀錄（index.html 的 `data-cl`），由整合端統一加，各線不要自己加。
