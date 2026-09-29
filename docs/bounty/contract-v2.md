# 路段懸賞 v2：客戶端契約

給原生 App（iOS／Android）實作錄程送交、雲端搭乘與籌碼兌換用。讀這一份就能寫客戶端，不必再讀 `worker.js`。
每個欄位後面標了伺服器端對應的函式（`worker.js`）；規則數字一律讀 `data/bounty_rules.json`，不要寫死在客戶端。

- 規則設定：`data/bounty_rules.json`（`coverDistinct`、`chips`、`quality`、`integrity`、`qualityText`）
- 籌碼規則純函式：`scripts/bounty_chips_core.mjs`（伺服器入帳用；客戶端要預估顯示時照同一套算）
- 本文件只寫欄位與行為，不含任何金額。

---

## 0. 共通

| 項目 | 規則 | 伺服器 |
|---|---|---|
| `actor` | `/^[A-Za-z0-9_-]{8,64}$/`。原生用匿名 installId（重裝後不變），登入後以 `/api/bounty-merge` 併進帳號 uid | `isActorId`、`resolveActor` |
| `requestId` | `/^[A-Za-z0-9_-]{8,64}$/`（不可含 `.`）。**同一個動作重送時必須不變**（同一批樣本、同一次兌換、同一次雲端搭乘），伺服器靠它去重 | `BOUNTY_REQUEST_ID_RE` |
| `client` | `{platform:'ios'\|'android', app:'<版號，≤32 字>', simulator:boolean}`。沒帶或 platform 不是這兩個 → 400 `app_only`。`simulator` 由 App 自己判斷（iOS `targetEnvironment(simulator)`、Android `Build.FINGERPRINT` 等），為真時資料照收、**不發籌碼** | `sanitizeClient` |
| 座標 | 整包 payload 任何一層出現 `lat`／`lon`／`lng`／`latitude`／`longitude`／`coord(s)`／`position`／`geo` 鍵 → 400 `coordinates_not_accepted`。上傳的是沿線里程，不是座標 | `hasGeoKeys` |
| 限流 | 429 `rate_limited`；客戶端退避重試 | `rateLimited` |
| 暫停 | 懸賞寫入總閘關著時，寫入端點回 503 `bounty_paused`；讀取端點照常 | `bountyWritesOff` |
| 快取 | 個人資料端點一律 `Cache-Control: no-store` | — |
| 通行證 | 籌碼、價格、解鎖**完全不看通行證**。客戶端不要送任何通行證欄位，送了伺服器也不讀 | — |

## 1. `POST /api/bounty-submit`：錄程樣本（每 60 秒一批）

```json
{
  "actor": "installId",
  "sys": "tra_sched",
  "lnId": "南迴線",
  "trainNo": "3671",
  "tripDate": "2026-10-10",
  "dir": 0,
  "batch": 3,
  "samples": [{ "d": 12345.6, "t": 36012, "v": 21.4, "acc": 8 }],
  "client": { "platform": "ios", "app": "2.0.0", "simulator": false },
  "requestId": "b3f0c2a4-...-batch3"
}
```

| 欄位 | 規則 | 錯誤碼 |
|---|---|---|
| `sys` | 系統 id：`tra_sched`（台鐵）、`thsr_sched`（高鐵）、`afr_sched`（阿里山林鐵）。**捷運與輕軌不收**（題庫沒有捷運線） | `bad_line` |
| `lnId` | 線 id，`sys\|lnId` 必須是 `data/bounty_units.json` 的 `lines` 鍵之一。台鐵是中文線名（`南迴線`、`縱貫線北段`…）、高鐵只有 `THSR`、林鐵是 `AFR_MAIN` 等 | `bad_line`、`unknown_line` |
| `trainNo` | `/^[0-9A-Za-z]{1,8}$/` | `bad_train` |
| `tripDate` | 台北日期 `YYYY-MM-DD`，列車的**營運日**（發車那天）。只收「今天往前 7 天」到「明天」 | `bad_date` |
| `dir` | `0`＝里程遞增、`1`＝里程遞減。只是提示值：伺服器組回整趟後以首末里程重判 | `bad_dir` |
| `batch` | 整數，客戶端自己排序用；伺服器不讀 | — |
| `samples` | 1–600 筆；只留 `d`、`t`、`v`、`acc` 四個數值欄位，其他鍵丟掉不報錯 | `bad_samples` |
| `samples[].d` | 沿線里程（公尺），以該線 shape 投影求得。**投影演算法必須與網頁 `projectOntoShape`（`index.html`）相同**＝railcore `Geo.projectOntoShape`（`geo/LineGeometry.kt`）。伺服器四捨五入到 0.1 m | `sanitizeSamples` |
| `samples[].t` | 距 `tripDate` 台北 00:00 的秒數（整數）。**跨午夜的班次繼續往上加（可以超過 86400），不要歸零**——伺服器按 `t` 排序把各批接成一趟，也用 `max(t)−min(t)` 算這一趟的長度 | `assembleTrip` |
| `samples[].v` | 速度 m/s，可為 null | — |
| `samples[].acc` | 定位精度（公尺），可為 null | — |

回應：
- 200 `{ok:true, id, verdict:'pending', accepted, dropped}`。同一個 `requestId` 重送回同一個 `id`，資料庫只有一列（已收過的重送，就算當天批次額度剛好滿也回 200）。
- 400 `bad_json`／`bad_actor`／`app_only`／`bad_request_id`／`bad_line`／`bad_train`／`bad_date`／`bad_dir`／`bad_samples`／`coordinates_not_accepted`／`unknown_line`。
- 429 `rate_limited`、`daily_quota`（每人每營運日 720 批）；503 `bounty_paused`、`not_ready`（題庫讀不到，留在佇列重試）、`submit_failed`。
- **4xx（429 除外）不要重試；429／503 與網路失敗留在裝置佇列，下次前景重傳，`requestId` 不變。**

### 判定與籌碼（伺服器隔天做，客戶端只讀結果）
- 一趟＝同一個 `actor`＋`tripDate`＋`trainNo` 的所有批次。判定結果 `ok`／`unusable`／`suspect`（`bountyVerifyCron`）。
- 每一趟 `ok` 且長度（`max(t)−min(t)`）≥ `chips.minTripSec` 秒，得 `chips.perTrip` 籌碼；這一趟任何一段落在 `chips.remoteLines`（南迴線、臺東線）就 ×`chips.remoteMultiplier`；期間活動 `chips.events` 相乘。
- 每個 actor 每個營運日的錄程籌碼上限 `chips.dailyChipCap`（算的是加倍之後的籌碼），超過的不給。
- 看板上有沒有這一段、這一段收滿了沒，都不影響籌碼（滿板照發）。`simulator:true` 的趟不發。
- 每段收滿的門檻是「交過 ok 的不同 actor 人數」≥ `coverDistinct`（台鐵 50、高鐵 15）；同一人同一段交幾趟都只算一人。

## 2. `GET /api/chips-me`：籌碼與解鎖現況

身分：`?actor=<installId>`，或 `Authorization: Bearer <Firebase idToken>`（已登入）。

```json
{
  "balance": 5,
  "unlocked": [{ "scene": "south-coast", "nth": 1, "at": 1791600000000 }],
  "nextCost": 8,
  "cloud": { "rides": 4, "toNextChip": 2 },
  "today": { "chips": 2, "cap": 4 }
}
```

- `balance`：帳本加總（錄程、雲端搭乘、兌換扣除、合併退款）。
- `unlocked`：依 `nth`（第幾座）排序；`at` 是 epoch 毫秒。
- `nextCost`：下一座的價格（`priceOfNth`：第 1 座與之後每座的價格見 `chips.prices`，最後一格沿用）。全部場景都解鎖之後它仍回最後一格的價格；判斷「全解鎖」請比 `unlocked.length` 與 `chips.scenes.length`。
- `today`：台北今天已得的錄程籌碼與每日上限。
- 車庫判斷只看 `unlocked[].scene`；原生殼開嵌入的網頁場景時，把 scene 陣列注入 `window.RAIL_NATIVE_UNLOCKED_SCENES`。

## 3. `POST /api/garage-redeem`：用籌碼解鎖一座場景

```json
{ "actor": "installId", "scene": "south-coast", "requestId": "..." }
```

- `scene` 必須在 `chips.scenes`，否則 400 `unknown_scene`。`requestId` 必填。
- 200 `{ok:true, scene, nth, cost, balance, unlocked}`（`unlocked` 形狀同 `chips-me`）。同一個 `requestId` 重送不重扣，回的 `scene`／`nth`／`cost` 與第一次相同，`balance`／`unlocked` 是重送當下的現況。
- 同一個 `requestId` 拿去兌換別的場景 → 409 `conflict`（客戶端 bug；每次兌換都要產生新的 `requestId`）。
- 其他：400 `bad_actor`／`bad_request_id`／`bad_json`／`coordinates_not_accepted`；405 `method`（只收 POST）；503 `bounty_paused`／`not_ready`／`redeem_failed`。
- 409 `already`（已解鎖，不扣）、409 `not_enough`（附 `cost`、`balance`）、409 `conflict`（同時有別的兌換搶先，重讀 `chips-me` 後讓使用者再按一次）。
- 解鎖永久；與通行證無關。

## 3.1 `GET /api/bounty-board`：看板（只讀）

v2 新增的卡片欄位（舊欄位 `samples`、`coverN` 保留給舊客端）：
- `need`：這張卡所屬系統的收滿人數門檻（台鐵 50、高鐵 15）。
- `distinctOk`：這張卡各單位「交過 ok 的不同人數」的最小值。
- `covered`：只有 `chips.evergreen` 的線（南迴線、臺東線）會出現收滿的卡，這時為 `true`，排在未收滿的卡之後；**`covered:true` 的卡不能認領**（`/api/bounty-claim` 回 404 `no_open_units`），畫面上只當「還可以錄、照樣拿籌碼」的提示。一般線收滿的段直接不出現在板上。

## 4. `POST /api/cloud-ride`：雲端搭乘（前景跟同一班真實列車連續 `chips.cloud.minSec` 秒）

計時由客戶端做（railcore `CloudRide.tick`）：App 在前景、跟同一班車，連續滿 `chips.cloud.minSec` 秒才送；切背景、換車、兩次更新間隔過長都從 0 重來。**不需要定位權限。**

```json
{
  "actor": "installId",
  "day": "2026-10-10",
  "trainKey": "tra_sched|123",
  "startedAt": 1791600000000,
  "sec": 612,
  "requestId": "...",
  "client": { "platform": "android", "app": "2.0.0", "simulator": false }
}
```

| 欄位 | 規則 |
|---|---|
| `day` | 台北日期，這班車的營運日；只收台北今天或昨天 |
| `startedAt` | 開始連續跟車的 epoch 毫秒 |
| `sec` | 整數秒，0–86400，且 ≥ `chips.cloud.minSec`；`startedAt + sec×1000` 不可晚於伺服器現在＋60 秒 |
| `trainKey` | 總長 ≤96。台鐵 `tra_sched\|<車次>`、高鐵 `thsr_sched\|<車次>`、林鐵 `afr_sched\|<車次>`（車次 `/^[0-9A-Za-z]{1,8}$/`）；捷運／輕軌 `<sysId>\|<線 id>\|<車輛識別>`，sysId ∈ `mrt`、`tymc`、`ntdlrt`、`ntalrt`、`sanying`、`krtc`、`tmrt`（＝`index.html` 的 `SYS_DEFS` 裡 `mode:'freq'` 的系統），線 id 1–32 字、車輛識別 1–64 字，都不可含 `\|` 與控制字元 |

伺服器驗證（`cloudRideTrainOk`）：
- 台鐵：`data/tra_widget_schedule.json` 有這一天 → 這班車當天要開，且 `startedAt` 落在「首站時刻 −30 分」到「末站時刻 ＋30 分」之間；班表檔沒有這一天（檔過期）→ 降級成只驗車次存在。
- 高鐵：伺服器的逐日班表有這一天 → 同上；沒有 → 降級成只驗車次存在。林鐵：車次＋時間窗。
- 捷運：只驗格式與台北時間 05:00–次日 01:30。伺服器本來就驗不到「前景連續 10 分鐘」，這是已知的信任邊界；每天只算一次讓它最多值 1/3 籌碼。

回應：
- 200 `{ok:true, day, rides, toNextChip, chipAwarded}`：`rides` 是算進換籌碼的累計次數（不含模擬器），`toNextChip` 是再幾次換下一顆（1–3），`chipAwarded` 是這一次有沒有讓籌碼 +1。同一個 `requestId` 重送回同形狀的 200、不重記。
- 400 `bad_json`／`bad_actor`／`coordinates_not_accepted`／`app_only`／`bad_request_id`／`bad_day`／`bad_time`／`bad_sec`／`too_short`／`unknown_train`；405 `method`；409 `already_today`（這個營運日已經記過一次，模擬器的也佔格）、409 `conflict`（同一個 `requestId` 拿去送別天）；429 `rate_limited`；503 `bounty_paused`／`not_ready`（班表或規則讀不到）／`cloud_ride_failed`。
- `simulator:true`：照記、佔當天那格，但不計次、不發籌碼。
- 換籌碼：累計次數每滿 `chips.cloud.perChip` 次得 1 顆，進同一個籌碼池。

## 5. `POST /api/bounty-merge`：匿名 installId 併進登入帳號

- Header `Authorization: Bearer <Firebase idToken>`；body `{actor:<installId>}`（只有這一個欄位）。登入成功後呼叫一次；伺服器冪等，重呼叫不會重搬。
- 200 `{ok:true, uid, points, merged}`：`merged` 是這次有沒有真的併了東西（重跑為 `false`）。installId 等於 uid 本人時直接回 `merged:false`。錯誤：400 `bad_json`／`bad_actor`、401 `unauthorized`、429 `rate_limited`、503 `merge_failed`。
- 併過之後，用舊 installId 呼叫的所有端點都會轉到 uid 的帳（`resolveActor`）。
- 伺服器在同一筆交易裡搬：籌碼帳本、車庫解鎖、雲端搭乘、每段貢獻、舊點數與樣本。兩邊都解鎖同一座 → 保留較早那筆，較晚那筆的籌碼退回（帳本 `kind:'merge'`），第幾座依解鎖時間重排；同一天兩邊都有雲端搭乘 → 只留一筆；每日錄程籌碼上限不回溯。
- 刪帳號（`/api/account-delete`）時，這個 uid 與併進來的 installId 在上述各表的資料一併刪除；路段的收滿人數是匿名彙總，不回扣。
