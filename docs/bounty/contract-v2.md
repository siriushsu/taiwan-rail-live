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
| `actor` | `/^[A-Za-z0-9_-]{8,64}$/`，且不可為字面 `ephemeral`（網頁存不下裝置 id 時的共用值）。原生用匿名 installId（重裝後不變），登入後以 `/api/bounty-merge` 併進帳號 uid | `isActorId`、`resolveActor` |
| 登入身分 | 見下方「身分規則」。已登入時，錢包端點（`garage-redeem`、`cloud-ride`、`chips-me`）與 `bounty-merge` 帶 `Authorization: Bearer <Firebase idToken>`；**錄程送交與認領不要帶**（用不到，而且伺服器每收到一個 Bearer 就要向 Firebase 驗一次，每 60 秒一批會多一次外部呼叫）。Bearer 帶了但無效（過期、偽造）→ 401 `unauthorized`，更新 idToken 後重送 | `firebaseUid` |
| `requestId` | `/^[A-Za-z0-9_-]{8,64}$/`（不可含 `.`）。**同一個動作重送時必須不變**（同一批樣本、同一次兌換、同一次雲端搭乘），伺服器靠它去重 | `BOUNTY_REQUEST_ID_RE` |
| `client` | 只有 `bounty-submit` 與 `cloud-ride` 要帶（兌換、合併、查詢不讀）。`{platform:'ios'\|'android', app:'<版號，≤32 字>', simulator:boolean}`。沒帶或 platform 不是這兩個 → 400 `app_only`。`simulator` 由 App 自己判斷（iOS `targetEnvironment(simulator)`、Android `Build.FINGERPRINT` 等），為真時資料照收、**不發籌碼** | `sanitizeClient` |
| 座標 | `bounty-submit`、`garage-redeem`、`cloud-ride` 三支：請求 body 任何一層出現 `lat`／`lon`／`lng`／`latitude`／`longitude`／`coord(s)`／`position`／`geo` 鍵 → 400 `coordinates_not_accepted`。上傳的是沿線里程，不是座標。`bounty-claim`、`bounty-merge` 只讀 `actor`／`cardId`、不存其他欄位，不做這項檢查 | `hasGeoKeys` |
| 限流 | 429 `rate_limited`；客戶端退避重試 | `rateLimited` |
| 暫停 | 懸賞寫入總閘關著時，寫入端點回 503 `bounty_paused`；讀取端點照常。`bounty-merge` 不受總閘影響（登入後的合併不該因為暫停而失敗） | `bountyWritesOff` |
| 快取 | 個人資料端點一律 `Cache-Control: no-store` | — |
| 通行證 | 籌碼、價格、解鎖**完全不看通行證**。客戶端不要送任何通行證欄位，送了伺服器也不讀 | — |

### 身分規則（誰能動誰的籌碼）

帳號（uid）的籌碼只認帳號本人的 Bearer；uid 不是秘密，不能拿來當憑證。

| `actor` 是… | 錢包端點：`garage-redeem`、`cloud-ride`、`chips-me?actor=`、`bounty-me?actor=` | 錄程與認領：`bounty-submit`、`bounty-claim` |
|---|---|---|
| 還沒併進帳號的 installId | 照收，記在這個 installId 名下 | 照收 |
| 已經併進帳號的 installId | 沒帶 Bearer → 401 `auth_required`；Bearer 是別的帳號 → 403 `wrong_account`；本人 Bearer → 照收，記在帳號名下 | 不必帶 Bearer，照收，記在帳號名下；帶了**別的帳號**的 Bearer → 403 `wrong_account`，一列都不寫 |
| 帳號 uid 本身 | 同上（要本人 Bearer） | 要本人 Bearer（401 `auth_required`／403 `wrong_account`） |
| 從沒帶 Bearer 出現過的 uid | 伺服器分不出它是帳號，當成第一列（還沒併進帳號的 installId） | 同左 |

- 客戶端收到 401 `auth_required`：請使用者登入（或更新 idToken）後重送，`requestId` 不變。
- 收到 403 `wrong_account`，或 `bounty-merge` 回 409 `merged_elsewhere`：這台裝置的 installId 已經屬於另一個帳號（同一台裝置換帳號登入）→ 產生新的 installId、呼叫一次 `bounty-merge`，之後都用新的。
- 已登入時讀籌碼與護照一律用 Bearer 讀 `chips-me`／`bounty-me`，不要用 `?actor=`。網頁登出狀態不讀籌碼（同一個瀏覽器的裝置 id 可能屬於前一位登入者）。
- 帳號第一次帶有效 Bearer 呼叫任何懸賞端點（包括只讀的 `chips-me`、`bounty-me`）時，伺服器建立帳號列，從此適用第三列。在那之前若有人拿這個 uid 當 installId 呼叫過 `bounty-merge`（把它標成併進自己的帳號），標記在這時清掉；之前掛在這個 uid 名下的東西歸帳號本人。原生一律送 installId，不會拿 uid 當 `actor`。

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
| `sys` | 系統 id：`tra_sched`（台鐵）、`thsr_sched`（高鐵）、`afr_sched`（阿里山林鐵）。**捷運與輕軌不收**（題庫沒有捷運線）。**每一批只能一條線**：直通車跨線（例如屏東線→南迴線、臺東線→北迴線）時，換線就換一批送，`trainNo`、`tripDate` 不變 | `bad_line`（形狀不對）、`unknown_line`（捷運／輕軌等題庫沒有的系統或線） |
| `lnId` | 線 id，`sys\|lnId` 必須是 `data/bounty_units.json` 的 `lines` 鍵之一。台鐵是中文線名（`南迴線`、`縱貫線北段`…）、高鐵只有 `THSR`、林鐵是 `AFR_MAIN` 等 | `bad_line`、`unknown_line` |
| `trainNo` | `/^[0-9A-Za-z]{1,8}$/` | `bad_train` |
| `tripDate` | 台北日期 `YYYY-MM-DD`，列車的**營運日**（發車那天）。只收「上傳當下的台北今天往前 7 天」到「明天」（例：7/28 的趟，7/27 00:00 到 8/4 23:59 之間上傳都收）。判定用同一條窗、以這班車在這條線上最晚那一批的上傳時間為基準，所以上傳時收下的趟不會在判定時被打成日期不合 | `bad_date` |
| `dir` | `0`＝里程遞增、`1`＝里程遞減。只是提示值：伺服器組回整趟後以首末里程重判 | `bad_dir` |
| `batch` | 整數，客戶端自己排序用；伺服器不讀 | — |
| `samples` | 1–600 筆；只留 `d`、`t`、`v`、`acc` 四個數值欄位，其他鍵丟掉不報錯 | `bad_samples` |
| `samples[].d` | 沿線里程（公尺），以該線 shape 投影求得。**App 端的投影演算法必須與網頁版 `projectOntoShape`（`index.html`）逐點相同**。伺服器四捨五入到 0.1 m | `sanitizeSamples` |
| `samples[].t` | 距 `tripDate` 台北 00:00 的秒數（整數）。**跨午夜的班次繼續往上加（可以超過 86400），不要歸零**——伺服器按 `t` 排序把各批接成一趟，也用 `max(t)−min(t)` 算這一趟的長度 | `assembleTrip` |
| `samples[].v` | 速度 m/s，可為 null | — |
| `samples[].acc` | 定位精度（公尺），可為 null | — |

回應：
- 200 `{ok:true, id, verdict:'pending', accepted, dropped}`。同一個 `requestId` 重送回同一個 `id`，資料庫只有一列（已收過的重送，就算當天批次額度剛好滿也回 200）。
- 400 `bad_json`／`bad_actor`／`app_only`／`bad_request_id`／`bad_line`／`bad_train`／`bad_date`／`bad_dir`／`bad_samples`／`coordinates_not_accepted`／`unknown_line`。
- 401 `unauthorized`：帶了 Bearer 但驗不過（不論 `actor` 是什麼）。原生照契約不帶 Bearer 就不會碰到。
- 401 `auth_required`：`actor` 本身是帳號 uid、沒帶 Bearer。
- 403 `wrong_account`：`actor` 是別人的帳號 uid；或 `actor` 是已經併進某個帳號的 installId、請求卻帶了**另一個**帳號的 Bearer（同一台裝置換人登入）。後者照「身分規則」換新的 installId；這一批不會被收下，換好之後用新的 installId 重送。
- 429 `rate_limited`、`daily_quota`（每人每營運日 720 批）；503 `bounty_paused`、`not_ready`（題庫讀不到，留在佇列重試）、`submit_failed`。
- **4xx（401、429 除外）不要重試；401 等登入後重送；429／503 與網路失敗留在裝置佇列，下次前景重傳，`requestId` 不變。**

### 判定與籌碼（伺服器隔天做，客戶端只讀結果）
- 判定每天台北 03:30 跑一次（`bountyVerifyCron`），只判 `tripDate` 早於台北今天的趟：還在車上的趟不會被切成兩半判。所以籌碼最快在乘車隔天清晨入帳。每一發有查詢量與時間預算，量大時判不完的留到下一發接著判；上傳當下已經擋過日期窗，之後判定延後幾天不會讓誠實的趟變成可疑。
- 判定次序：帳號（併進帳號的裝置算在帳號裡，共用名額與輪次）與以前入帳過錄程籌碼的人，兩者合稱可信身分；每個可信身分最早的 8 班優先判（優先的部分最多用掉每一發剩下預算的一半；用完之後，還沒判的優先班車改按輪次與其他班車交錯，同一輪裡排在非優先的班車之後）；其餘每個人輪流（每個人的第 1 班排在任何人的第 2 班之前），同一輪裡可信身分先、其餘先後隨機；判定時出錯兩次以上的班車一律排在最後。所以一個人上傳再多班，也擠不掉新使用者的第一趟；同一個人一天上傳很多班時，後面幾班可能晚一兩天才判。
- 一趟＝同一個人（併過帳號就以帳號計）＋`tripDate`＋`trainNo` 的所有批次。每條線各自判出 `ok`／`unusable`／`suspect`；直通車跨兩條線仍算**一趟**。
- 一班車（同一個人、同一營運日、同一車次）超過 720 批、或資料總長超過 4 MB：整班判 `suspect`、不發籌碼。誠實的客戶端每 60 秒送一批，720 批已經是同一班車連續錄 12 小時；上傳端點的每日批次額度也是 720，超過的只可能是同時灌進來的請求。
- 一趟得籌碼的條件：至少一條線 `ok`、**沒有任何一條線 `suspect`**、長度（整班車所有批次 `max(t)−min(t)`）≥ `chips.minTripSec` 秒、沿線移動距離 ≥ `chips.minTripMoveM` 公尺（整趟停在一站不算）——移動距離只看 `ok` 線組、只用防偽閘收下的點（判定當下把那一組收下點的最小與最大里程寫進 `bounty_samples.kept_d0`／`kept_d1`（schema/0016_bounty_kept_range.sql），之後的發次讀前次組時用這兩欄，不從原始點重算）；同一條線（`sys|ln_id`）這一發與先前已判定的 `ok` 組把里程範圍取聯集、算 `max−min`，各線再取最大值，不同線不相加（各線里程基準不同）。移動距離只看判成 `ok` 的那幾發各自收下的點，同一條線各發的 `ok` 範圍合起來算，所以「分幾次上傳」本身不影響結果；但單獨一發若判成不採用（例如尾段太短），它的移動不計入 → 得 `chips.perTrip`；`ok` 的那幾條線任何一段落在 `chips.remoteLines`（南迴線、臺東線）就 ×`chips.remoteMultiplier`；期間活動 `chips.events` 相乘。整班車只發一次。
- 後半段隔天才傳上來（車上沒訊號、隔天才開 App）也沒關係：後一次判定會把同一班車之前判過的批次一起算長度，整班車合起來夠長就補發；之前已經發過就不再發。
- 每個人每個營運日的錄程籌碼上限 `chips.dailyChipCap`（算的是加倍之後的籌碼），超過的不給。登入合併前後同一班車不會發兩次；合併之前各裝置同一天已領的不回溯。
- 看板上有沒有這一段、這一段收滿了沒，都不影響籌碼（滿板照發）。
- `simulator:true`：判定當下，這一班車（這一發讀到的批次，加上之前已經判過的批次）只要有任何一批自報模擬器，就只留判定結果——不發籌碼、不算收滿人數、不動看板、不給舊點數。已經入帳的籌碼不會因為之後才到的模擬器批次被收回（旗標是客戶端自報的，這不是防作弊機制，只是讓開發與審查的資料不要算進收滿人數）。
- 每段收滿的門檻是「交過 ok 的不同人數」≥ `coverDistinct`（台鐵 50、高鐵 15）；同一人同一段交幾趟都只算一人。

## 2. `GET /api/chips-me`：籌碼與解鎖現況

身分：已登入用 `Authorization: Bearer <Firebase idToken>`（讀帳號本人的帳，不看 `?actor=`）；未登入用 `?actor=<installId>`。已經併進帳號的 installId 用 `?actor=` 讀 → 401 `auth_required`（見「身分規則」）。

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
- `today`：`chips` 是乘車日＝台北今天、而且判定已經入帳的錄程籌碼；判定隔天清晨才跑，所以白天幾乎都是 0。**不要拿它算「今天還能賺幾顆」**，要顯示今日進度請客戶端自己數當天已完成的合格趟。`cap` 是每日上限。
- 錯誤：400 `bad_actor`；401 `unauthorized`（Bearer 無效）／`auth_required`（`?actor=` 是帳號或已併進帳號的 installId）；429 `rate_limited`（兩條路徑都有限流）；503 `not_ready`。帶 Bearer 時一律讀那個帳號本人的帳，所以這支端點不會回 403。
- 帶 Bearer 讀取也會建立帳號列（見「身分規則」最後一條），所以登入後第一件事讀一次 `chips-me` 就夠，不必等第一次兌換。
- 車庫判斷只看 `unlocked[].scene`；原生殼開嵌入的網頁場景時，把 scene 陣列注入 `window.RAIL_NATIVE_UNLOCKED_SCENES`。

## 2.1 `GET /api/bounty-me`：護照的校正貢獻（只讀）

身分規則同 `chips-me`：已登入帶 Bearer（讀帳號本人，不看 `?actor=`）；`?actor=` 只給還沒併進帳號的 installId，帳號或已併進帳號的 installId → 401 `auth_required`（行程史同樣不該讓拿著裝置 id 的任何人讀）。

- 200 `{actor, points, corrected:{segs, adopted}, lines:[{sys, lnId, segs, adopted}], firsts:[段鍵], trips:[{id, tripDate, trainNo, sys, lnId, verdict, quality}]}`：`trips` 是最近 60 批（新的在前）；`quality` 是 `null` 或 `{code, …qualityText[code]}`；判成 `suspect` 的批次不算進 `corrected`、`lines`。回應裡永遠沒有拒絕原因碼。
- 錯誤：400 `bad_actor`；401 `unauthorized`／`auth_required`；429 `rate_limited`（帶 Bearer 時）；503 `not_ready`。

## 3. `POST /api/garage-redeem`：用籌碼解鎖一座場景

```json
{ "actor": "installId", "scene": "south-coast", "requestId": "..." }
```

- `scene` 必須在 `chips.scenes`，否則 400 `unknown_scene`。`requestId` 必填。
- 已登入時帶 Bearer；已經併進帳號的 installId 或帳號 uid 不帶 Bearer → 401 `auth_required`、別人的 Bearer → 403 `wrong_account`（見「身分規則」）。網頁一律登入後才兌換，`actor` 送 `user.uid`。
- 200 `{ok:true, scene, nth, cost, balance, unlocked}`（`unlocked` 形狀同 `chips-me`）。同一個 `requestId` 重送不重扣，回的 `scene`／`cost` 與第一次相同；`nth` 是這一座**現在**的第幾座（登入合併後會依解鎖時間重排，可能與第一次不同）；`balance`／`unlocked` 是重送當下的現況。
- 同一個 `requestId` 拿去兌換別的場景 → 409 `conflict`（客戶端 bug；每次兌換都要產生新的 `requestId`）。
- 其他：400 `bad_actor`／`bad_request_id`／`bad_json`／`coordinates_not_accepted`；401 `unauthorized`；405 `method`（只收 POST）；503 `bounty_paused`／`not_ready`／`redeem_failed`。
- 409 `already`（已解鎖，不扣）、409 `not_enough`（附 `cost`、`balance`）、409 `conflict`（同時有別的兌換搶先，重讀 `chips-me` 後讓使用者再按一次）。
- 解鎖永久；與通行證無關。

## 3.1 `GET /api/bounty-board`：看板（只讀）

v2 新增的卡片欄位（舊欄位 `samples`、`coverN` 保留給舊客端）：
- `need`：這張卡所屬系統的收滿人數門檻（台鐵 50、高鐵 15）。
- `distinctOk`：這張卡各單位「交過 ok 的不同人數」的最小值。
- `covered`：只有 `chips.evergreen` 的線（南迴線、臺東線）會出現收滿的卡，這時為 `true`，排在未收滿的卡之後；**`covered:true` 的卡不能認領**（`/api/bounty-claim` 回 404 `no_open_units`），畫面上只當「還可以錄、照樣拿籌碼」的提示。一般線收滿的段直接不出現在板上。
- 認領（`POST /api/bounty-claim`，回應形狀不變）：同一個人把同一張卡再接一次＝取代自己在那些單位上還開著的舊認領（鎖的點數與期限換成這一次的）；登入合併之後，帳號名下同一個單位也只留最近的一筆。判定一向只看每個單位最近的那一筆，所以結果不受影響。

回應頂層另有兩個欄位，讓讀的人分辨每日估值有沒有在正常跑：`retireBlock`（被單位清單的守門擋下的狀態）與 `valuationOk`（最後一次成功跑完的估值）。擋下期間停住的是估值的部分（點數、上架、退場）：新單位不上架、沒接懸賞的錄程在缺卡的段拿 0 點，要有人處理；判定照跑，認領人數、樣本數、收滿狀態仍會變。

`retireBlock`：每日估值被單位清單的守門擋下（清單是空的、某個系統或某條線一次退場太多）的狀態。
- `null`：目前沒有被擋下。**這不代表估值正常**：估值沒跑成（清單讀不到、規則檔壞了、排程沒觸發……）時，`retireBlock` 也可能是 `null`；要看估值有沒有在跑，看 `valuationOk`。
- `{at, generatedAt, msg}`：擋下中。`at` 是最近一次擋下的毫秒時間戳；`generatedAt` 是被擋下的那份清單的 `generatedAt`（清單沒有就 `null`）；`msg` 是給維運看的診斷文字，措辭會變，不要顯示在畫面上、也不要拿來解析。估值正常跑完才會回到 `null`。

`valuationOk`：最後一次成功跑完的估值。
- `null`：從沒有任何一次成功跑完的紀錄（剛上線，或一直沒成功）。不是正常。
- `{at, generatedAt}`：`at` 是那一次跑完的毫秒時間戳，`generatedAt` 是當時用的那份清單的 `generatedAt`（清單沒有就 `null`）。估值排定一天跑一次，`at` 過了一天多還沒更新就是估值停了，不論 `retireBlock` 是不是 `null`；從沒排過排程、或排了但從沒成功過時，`valuationOk` 是 `null`，排程拿掉之後則停在最後一次成功的值，過了門檻就看得出估值停了。判斷用的門檻在 `scripts/lib/bounty_retire_verdict.mjs`（`BOUNTY_VALUATION_MAX_AGE_MS`，26 小時：一天一次，留兩小時給排程延遲、執行時間與下面說的快取）。

兩個欄位的共同規則：
- 欄位不存在：伺服器讀不到這些狀態（讀取失敗時兩個欄位會**一起**省略，看板其餘內容照常回 200），或還在跑舊版（只有 `retireBlock`、沒有 `valuationOk`）。不知道有沒有被擋下、估值有沒有在跑，不等於沒被擋、也不等於正常。
- 快取：兩個欄位跟著看板一起快取。看板走 Workers 的 Cache API（邊緣快取），每個機房各自快取、內容不會複製到其他機房，所以在這一層，狀態變化最多約 5 分鐘後看得到。回應標頭仍帶 `s-maxage=300`、`stale-while-revalidate=900`，但 Cloudflare 官方文件寫明 `cache.put`、`cache.match` 不支援 `stale-while-revalidate` 與 `stale-if-error`（https://developers.cloudflare.com/workers/runtime-apis/cache/），所以邊緣那一份過了 5 分鐘就重建，不會再多回一段舊內容。標頭既然帶了 `stale-while-revalidate=900`，瀏覽器、WebView 等下游的快取可能照它再多回一段舊內容，客戶端實際看到的狀態變化可能比 5 分鐘再晚一點。

## 4. `POST /api/cloud-ride`：雲端搭乘（前景跟同一班真實列車連續 `chips.cloud.minSec` 秒）

計時由 App 端做：App 在前景、跟同一班車，連續滿 `chips.cloud.minSec` 秒才送；切背景、換車、兩次更新間隔過長都從 0 重來。**不需要定位權限。**

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
- 捷運：只驗格式與台北時間 05:00–次日 01:30。各系統的 `sec` 都由客戶端回報，控管靠的是價值上限（每天最多 1 次、3 次才換 1 個籌碼）加上限流與寫入總閘。

回應：
- 已登入時帶 Bearer；已經併進帳號的 installId 或帳號 uid 不帶 Bearer → 401 `auth_required`、別人的 Bearer → 403 `wrong_account`（見「身分規則」）。
- 200 `{ok:true, day, rides, toNextChip, chipAwarded}`：`rides` 是算進換籌碼的累計次數（不含模擬器），`toNextChip` 是再幾次換下一顆（1–3），`chipAwarded` 是這一次有沒有讓籌碼 +1。同一個 `requestId` 重送回同形狀的 200、不重記——**隔了幾天才重送也一樣**（伺服器先查重送、再查日期窗）。例外：那一筆在登入合併時因為帳號同一天已有一筆而被丟掉，重送就照一般流程判，通常回 409 `already_today`。
- 400 `bad_json`／`bad_actor`／`coordinates_not_accepted`／`app_only`／`bad_request_id`／`bad_day`／`bad_time`／`bad_sec`／`too_short`／`unknown_train`；401 `unauthorized`；405 `method`；409 `already_today`（這個營運日已經記過一次，模擬器的也佔格）、409 `conflict`（同一個 `requestId` 拿去送別天）；429 `rate_limited`；503 `bounty_paused`／`not_ready`（班表或規則讀不到）／`cloud_ride_failed`。
- `simulator:true`：照記、佔當天那格，但不計次、不發籌碼。
- 換籌碼：累計次數每滿 `chips.cloud.perChip` 次得 1 顆，進同一個籌碼池。

## 5. `POST /api/bounty-merge`：匿名 installId 併進登入帳號

- Header `Authorization: Bearer <Firebase idToken>`；body `{actor:<installId>}`（只有這一個欄位）。登入成功後呼叫一次；伺服器冪等，重呼叫不會重搬。
- 200 `{ok:true, uid, points, merged}`：`merged` 是這次呼叫有沒有把這個 installId 新連到帳號（第一次 `true`，重跑 `false`；installId 從沒用過懸賞也算新連上，之後它送的東西都歸帳號）。installId 等於 uid 本人時直接回 `merged:false`（這時 `points` 固定回 0，不讀帳；要看餘額請讀 `chips-me`）。
- 錯誤：400 `bad_json`／`bad_actor`；400 `not_a_device`（`actor` 是某個帳號的 uid，不是裝置——帳號不能被併走）；401 `unauthorized`；409 `merged_elsewhere`（這個 installId 已經併進別的帳號：同一台裝置換帳號登入 → 產生新的 installId 再呼叫一次）；429 `rate_limited`；503 `merge_failed`。不受懸賞寫入總閘影響。
- 併過之後：錄程送交與認領用舊 installId 照收、記到帳號；錢包端點（兌換、雲端搭乘、`chips-me?actor=`）要帶帳號本人的 Bearer（見「身分規則」）。
- 伺服器在同一筆交易裡搬：籌碼帳本、車庫解鎖、雲端搭乘、每段貢獻、舊點數與樣本。兩邊都解鎖同一座 → 保留較早那筆，較晚那筆的籌碼退回（帳本 `kind:'merge'`），第幾座依解鎖時間重排；同一天兩邊都有雲端搭乘 → 只留一筆；每日錄程籌碼上限不回溯。
- 兩台裝置各自解鎖不同場景、各付了「第 1 座」的價，合併後不補差價（cost 保留當時實際付的價，只重排第幾座）。
- 刪帳號（`/api/account-delete`）時，這個 uid 與**已經併進它**的 installId 在上述各表的資料一併刪除；請求裡帶的 installId 若沒有併進這個帳號，它的籌碼與解鎖不會被刪。路段的收滿人數是匿名彙總，不回扣。
- 例外是舊的兩張明細表（錄程樣本與認領）：請求 body 帶的 installId 只要還沒併進任何帳號（而且不是帳號），它名下的樣本——**包括還沒判定的趟**——與認領會一起刪掉，那些趟之後不會再判、不會入帳。原因：installId 本身就是憑證，知道它的人本來就能把這台裝置併進自己的帳號、整包帶走；而從沒合併過的舊使用者，只能靠這個欄位刪掉自己的錄程紀錄。已經併進別的帳號的 installId、或帳號 uid，一列都不刪。
