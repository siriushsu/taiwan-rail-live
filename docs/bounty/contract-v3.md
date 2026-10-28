# 校正懸賞 v3（點數制）：客戶端契約

給原生 App（iOS／Android）與網頁實作錄程送交、雲端搭乘、點數兌換與懸賞板分組用。讀這一份就能寫客戶端，不必再讀 `worker.js`。
每個欄位後面標了伺服器端對應的函式（`worker.js`）；規則數字一律讀 `data/bounty_rules.json`，不要寫死在客戶端。

- 規則設定：`data/bounty_rules.json`（`v` 3；`chips` 區塊見第 6 節）
- 點數規則純函式：`scripts/bounty_chips_core.mjs`（`tripPoints`、`applyDailyChipCap`、`priceOfNth`、`canRedeem`；伺服器入帳用，客戶端要預估顯示時照同一套算）
- 區段檔：`data/bounty_sections.json`（懸賞板分組，見 3.2）
- 本文件只寫欄位與行為，不含任何金額。

**v3 跟 v2 差在哪**（v2 契約 `contract-v2.md` 留著對照 App 1.7.3 的行為）：
- 「籌碼」改叫「點數」：錄程照**沿線里程**給點（1 公里 `chips.perKm` 點），不再一趟 1 顆；雲端搭乘一次 `chips.cloud.points` 點，不再 3 次換 1 顆。
- 端點、欄位名一個都沒改（`chips`、`dailyChipCap`、`today.chips`、`toNextChip` 都沿用），數字的單位改成點數；新增的欄位只有 `chips-me` 的 `unit`、`cloud.points` 與 `cloud-ride` 的 `points`。
- **客戶端判斷伺服器是不是 v3：看 `chips-me` 頂層 `unit === "point"`。** 沒有這個欄位＝舊伺服器，數字是籌碼。
- v2 的籌碼照 `chips.chipToPoints`（50）換成點數，伺服器自己換，客戶端不必做任何事（見第 2 節）。
- 新增區段檔，給懸賞板依地區、區段分組；看板 API 的分組不變。

---

## 0. 共通

| 項目 | 規則 | 伺服器 |
|---|---|---|
| `actor` | `/^[A-Za-z0-9_-]{8,64}$/`，且不可為字面 `ephemeral`（網頁存不下裝置 id 時的共用值）。原生用匿名 installId（重裝後不變），登入後以 `/api/bounty-merge` 併進帳號 uid | `isActorId`、`resolveActor` |
| 登入身分 | 見下方「身分規則」。已登入時，錢包端點（`garage-redeem`、`cloud-ride`、`chips-me`）與 `bounty-merge` 帶 `Authorization: Bearer <Firebase idToken>`；**錄程送交與認領不要帶**（用不到，而且伺服器每收到一個 Bearer 就要向 Firebase 驗一次，每 60 秒一批會多一次外部呼叫）。Bearer 帶了但無效（過期、偽造）→ 401 `unauthorized`，更新 idToken 後重送 | `firebaseUid` |
| `requestId` | `/^[A-Za-z0-9_-]{8,64}$/`（不可含 `.`）。**同一個動作重送時必須不變**（同一批樣本、同一次兌換、同一次雲端搭乘），伺服器靠它去重 | `BOUNTY_REQUEST_ID_RE` |
| `client` | 只有 `bounty-submit` 與 `cloud-ride` 要帶（兌換、合併、查詢不讀）。`{platform:'ios'\|'android', app:'<版號，≤32 字>', simulator:boolean}`。沒帶或 platform 不是這兩個 → 400 `app_only`。`simulator` 由 App 自己判斷（iOS `targetEnvironment(simulator)`、Android `Build.FINGERPRINT` 等），為真時資料照收、**不給點數** | `sanitizeClient` |
| 座標 | `bounty-submit`、`garage-redeem`、`cloud-ride` 三支：請求 body 任何一層出現 `lat`／`lon`／`lng`／`latitude`／`longitude`／`coord(s)`／`position`／`geo` 鍵 → 400 `coordinates_not_accepted`。上傳的是沿線里程，不是座標。`bounty-claim`、`bounty-merge` 只讀 `actor`／`cardId`、不存其他欄位，不做這項檢查 | `hasGeoKeys` |
| 限流 | 429 `rate_limited`；客戶端退避重試 | `rateLimited` |
| 暫停 | 懸賞寫入總閘關著時，寫入端點回 503 `bounty_paused`；讀取端點照常。`bounty-merge` 不受總閘影響（登入後的合併不該因為暫停而失敗） | `bountyWritesOff` |
| 規則檔不是 v3 | `chips` 缺 v3 的欄位、或 `chips.unit` 不是 `"point"`（規則檔被換回 v2）：`chips-me`、`garage-redeem`、`cloud-ride` 一律 503 `not_ready`，判定停在入帳之前（樣本留著，規則修好下一發照判）。寧可停，也不拿籌碼的價格扣點數 | `bountyPointsRulesOk` |
| 快取 | 個人資料端點一律 `Cache-Control: no-store` | — |
| 通行證 | 價格、解鎖、錢包**不看通行證**；只有錄程點數有通行證加成（見 1.1，伺服器判定時自己查）。客戶端不要送任何通行證欄位，送了伺服器也不讀 | `bountyPlusPct` |

### 身分規則（誰能動誰的點數）

帳號（uid）的點數只認帳號本人的 Bearer；uid 不是秘密，不能拿來當憑證。

| `actor` 是… | 錢包端點：`garage-redeem`、`cloud-ride`、`chips-me?actor=`、`bounty-me?actor=` | 錄程與認領：`bounty-submit`、`bounty-claim` |
|---|---|---|
| 還沒併進帳號的 installId | 照收，記在這個 installId 名下 | 照收 |
| 已經併進帳號的 installId | 沒帶 Bearer → 401 `auth_required`；Bearer 是別的帳號 → 403 `wrong_account`；本人 Bearer → 照收，記在帳號名下 | 不必帶 Bearer，照收，記在帳號名下；帶了**別的帳號**的 Bearer → 403 `wrong_account`，一列都不寫 |
| 帳號 uid 本身 | 同上（要本人 Bearer） | 要本人 Bearer（401 `auth_required`／403 `wrong_account`） |
| 從沒帶 Bearer 出現過的 uid | 伺服器分不出它是帳號，當成第一列（還沒併進帳號的 installId） | 同左 |

- 客戶端收到 401 `auth_required`：請使用者登入（或更新 idToken）後重送，`requestId` 不變。
- 收到 403 `wrong_account`，或 `bounty-merge` 回 409 `merged_elsewhere`：這台裝置的 installId 已經屬於另一個帳號（同一台裝置換帳號登入）→ 產生新的 installId、呼叫一次 `bounty-merge`，之後都用新的。
- 已登入時讀點數與護照一律用 Bearer 讀 `chips-me`／`bounty-me`，不要用 `?actor=`。網頁登出狀態不讀點數（同一個瀏覽器的裝置 id 可能屬於前一位登入者）。
- 帳號第一次帶有效 Bearer 呼叫任何懸賞端點（包括只讀的 `chips-me`、`bounty-me`）時，伺服器建立帳號列，從此適用第三列。在那之前若有人拿這個 uid 當 installId 呼叫過 `bounty-merge`（把它標成併進自己的帳號），標記在這時清掉；之前掛在這個 uid 名下的東西歸帳號本人。原生一律送 installId，不會拿 uid 當 `actor`。

## 1. `POST /api/bounty-submit`：錄程樣本（每 60 秒一批）

請求與回應跟 v2 完全相同。

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
| `samples[].d` | 沿線里程（公尺），以該線 shape 投影求得。**App 端的投影演算法必須與網頁版 `projectOntoShape`（`index.html`）逐點相同**——點數就是拿這個里程算的。伺服器四捨五入到 0.1 m | `sanitizeSamples` |
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

### 判定與點數（伺服器隔天做，客戶端只讀結果）

判定的時程、次序、批數與大小上限、模擬器、收滿門檻都跟 v2 相同：
- 判定每天台北 03:30 跑一次（`bountyVerifyCron`），只判 `tripDate` 早於台北今天的趟：還在車上的趟不會被切成兩半判。所以點數最快在乘車隔天清晨入帳。每一發有查詢量與時間預算，量大時判不完的留到下一發接著判；上傳當下已經擋過日期窗，之後判定延後幾天不會讓誠實的趟變成可疑。
- 判定次序：帳號（併進帳號的裝置算在帳號裡，共用名額與輪次）與以前入帳過錄程點數的人，兩者合稱可信身分；每個可信身分最早的 8 班優先判（優先的部分最多用掉每一發剩下預算的一半；用完之後，還沒判的優先班車改按輪次與其他班車交錯，同一輪裡排在非優先的班車之後）；其餘每個人輪流（每個人的第 1 班排在任何人的第 2 班之前），同一輪裡可信身分先、其餘先後隨機；判定時出錯兩次以上的班車一律排在最後。
- 一趟＝同一個人（併過帳號就以帳號計）＋`tripDate`＋`trainNo` 的所有批次。每條線各自判出 `ok`／`unusable`／`suspect`；直通車跨兩條線仍算**一趟**。
- 一班車超過 720 批、或資料總長超過 4 MB：整班判 `suspect`、不給點數。
- `simulator:true`：這一班車只要有任何一批自報模擬器，就只留判定結果——不給點數、不算收滿人數、不動看板、不給舊的貢獻點數。已經入帳的點數不會因為之後才到的模擬器批次被收回。
- 每段收滿的門檻是「交過 ok 的不同人數」≥ `coverDistinct`（台鐵 50、高鐵 15）；同一人同一段交幾趟都只算一人。看板上有沒有這一段、收滿了沒，都不影響點數（滿板照發）。

**一趟幾點**（`bountyCreditTripChips` → `tripPoints`）：
1. 條件：至少一條線 `ok`、**沒有任何一條線 `suspect`**、長度（整班車所有批次 `max(t)−min(t)`）≥ `chips.minTripSec` 秒、各條 `ok` 線的里程**加總** ≥ `chips.minTripMoveM` 公尺（整趟停在一站不算）。不合條件就是 0 點。
2. 每條 `ok` 線（`sys|lnId`）的里程＝那條線**防偽閘收下的點**的最大里程減最小里程。同一條線分幾發判（例如前半段先傳、後半段隔天才傳）時，各發 `ok` 的範圍先取聯集再算跨距；判成不採用的一發不計入。
   防偽閘不收每一段開頭兩點與斷訊（相鄰兩點差 ≥ 10 秒）後的兩點，孤立的壞點也丟掉，所以收下的里程比原始首末差一點（1 Hz、時速 72 公里，每段開頭少約 40 m）。前次判過的組用判定當下記下的範圍（`bounty_samples.kept_d0`／`kept_d1`），不從原始點重算。
3. 每條線的公里數 × `chips.perKm`；那條線在 `chips.remoteLines`（南迴線、臺東線）就再 × `chips.remoteMultiplier`（直通車只有偏遠那段加倍）；期間活動 `chips.events`（乘車日落在 `from`–`to`，有 `lines` 的只套那幾條線）再相乘。
4. 各線相加，**最後捨去一次**成整數（伺服器用整數公寸算，98.4 km 是 98 點，不會因浮點誤差變 97）。
5. 每個人每個營運日的錄程點數上限 `chips.dailyChipCap`（算的是加倍之後的點數），這一趟給 `min(這一趟, 上限 − 當天已入帳)`，不到 1 點就不寫。v3 上線當天 v2 已經入帳的籌碼照 `chipToPoints` 換算後計入。登入合併前後同一班車不會發兩次；合併之前各裝置同一天已領的不回溯。
6. 整班車只入帳一次。**已經入帳的班車，後半段晚到不補發**（前半段當時就夠長、夠遠的話已經照前半段的里程入帳）；當時沒入帳（例如前半段不到 `minTripSec`）的，後半段到了會連同前半段一起判、一起算里程。

例：只走一條線、收下 98.4 km → 98 點；同樣 98.4 km 走在南迴線 → 196.8 → 196 點；直通車各線先各自乘倍率，加總之後才捨去。

### 1.1 通行證錄程加成（`bountyCreditTripChips` → `bountyPlusPct`、`bountyCreditPlusBonus`）

2026-10-28 使用者定案（規格：native repo `build/bounty-v3/通行證錄程加成-規格.html`，不進版控）。開關是規則檔 `chips.plusBonusPct`（整數百分比；沒有這個鍵或是 0＝關）。

1. 只加錄程。雲端搭乘、v2 籌碼換算、人工調整、兌換都沒有加成。
2. 只給帳號：這班車記在帳號（uid）名下，或記在已併進帳號的裝置名下（記進帳號）。匿名裝置查不到通行證，不加。
3. 資格在判定當下向 RevenueCat 查，跟 `/api/plus-status` 同一條路：訂閱 `gives_access`，或終身仍 `owned`。正式環境沒有時，sandbox 只給 `REVENUECAT_SANDBOX_ALLOWED_UIDS` 裡的帳號。同一發 cron 每個帳號只查一次。這趟沒點數就不查。
4. 查不完整（上游錯誤、回應不合規格、secret 沒設）時，**這班車整班留 pending、下一發再判**，一列都不寫。錄程列一旦寫下去，這班車就不會再判，少給的加成補不回來。
5. 數額＝這班車帳本上那列錄程的 `delta` × `plusBonusPct` ÷ 100，捨去成整數，不到 1 點不寫。用的是已經套過偏遠線、期間活動、每日上限之後實際入帳的錄程點數。加成本身**不算進每日上限**（`dailyChipCap` 與 `chips-me` 的 `today.chips` 只數錄程）。
6. 帳本另寫一列：`kind:'adjust'`、`ref`＝`'plus|'`＋那列錄程的 ref、`id`＝`'adjust|'`＋ref、`day`＝乘車日、`unit:'point'`。帳本 kind 的 CHECK 只收五種，所以沿用 `adjust`、用 ref 前綴分辨。`UNIQUE(kind, ref)` 保證一趟只有一列；錄程列寫了、加成還沒寫就中斷的話，下一發重判時補上。
7. `chips-me` 的回應不變：`balance` 本來就是帳本加總，自然含加成。
8. 退款、退訂之後，已發的加成不收回；開關打開之前已經判完的趟不補發。

例（加成 50%）：一般線 13 點 → 加成 6（6.5 捨去）；南迴線 27 點 → 加成 13；當天上限只剩 10、這趟錄程入帳 10 → 加成 5。

## 2. `GET /api/chips-me`：點數與解鎖現況

身分：已登入用 `Authorization: Bearer <Firebase idToken>`（讀帳號本人的帳，不看 `?actor=`）；未登入用 `?actor=<installId>`。已經併進帳號的 installId 用 `?actor=` 讀 → 401 `auth_required`（見「身分規則」）。

```json
{
  "unit": "point",
  "balance": 250,
  "unlocked": [{ "scene": "south-coast", "nth": 1, "at": 1791600000000 }],
  "nextCost": 300,
  "cloud": { "rides": 4, "toNextChip": 1, "points": 20 },
  "today": { "chips": 0, "cap": 500 }
}
```

- `unit`：固定 `"point"`，v3 的記號。**沒有這個欄位＝v2 伺服器，下面的數字是籌碼**（新 App 先上架、伺服器還沒換的過渡期）。
- `balance`：點數餘額＝帳本加總（錄程、雲端搭乘、兌換扣除、合併退款），v2 的籌碼 1 顆算 `chips.chipToPoints` 點。
- `unlocked`：依 `nth`（第幾座）排序；`at` 是 epoch 毫秒。
- `nextCost`：下一座的價格（點數；`priceOfNth`：第 1 座與之後每座見 `chips.prices`，最後一格沿用）。全部場景都解鎖之後它仍回最後一格的價格；判斷「全解鎖」請比 `unlocked.length` 與 `chips.scenes.length`。
- `cloud.rides`：算次數的雲端搭乘總次數（不含模擬器）。`cloud.points`：一次合格的雲端搭乘入帳幾點（＝`chips.cloud.points`）。
  `cloud.toNextChip` 固定 `1`：v3 每一次都入帳，這個欄位只留給 App 1.7.3（它要求 ≥ 1 的整數，小於 1 會一直退避重查）。**新客端不要讀它。**
- `today`：`chips` 是乘車日＝台北今天、而且判定已經入帳的錄程點數；判定隔天清晨才跑，所以白天幾乎都是 0。**不要拿它算「今天還能賺幾點」**，要顯示今日進度請客戶端自己數當天已完成的合格趟。`cap` 是每日上限（點）。
- v2 籌碼的換算：伺服器在驗完身分之後、寫入總閘開著時，替這個人補一筆換算記錄（帳本 `kind:'adjust'`，冪等，重讀不會重算）。換算記錄寫沒寫進去，`balance` 都一樣（餘額公式本身就把還沒換的部分算進去），客戶端什麼都不用做。
- 錯誤：400 `bad_actor`；401 `unauthorized`（Bearer 無效）／`auth_required`（`?actor=` 是帳號或已併進帳號的 installId）；429 `rate_limited`（兩條路徑都有限流）；503 `not_ready`（規則檔讀不到或不是 v3）。帶 Bearer 時一律讀那個帳號本人的帳，所以這支端點不會回 403。
- 帶 Bearer 讀取也會建立帳號列（見「身分規則」最後一條），所以登入後第一件事讀一次 `chips-me` 就夠，不必等第一次兌換。
- 車庫判斷只看 `unlocked[].scene`；原生殼開嵌入的網頁場景時，把 scene 陣列注入 `window.RAIL_NATIVE_UNLOCKED_SCENES`。

## 2.1 `GET /api/bounty-me`：護照的校正貢獻（只讀）

跟 v2 相同。注意回應裡的 `points` 是**舊的校正貢獻點數**（`bounty_points`，校正段數換的），不是錢包的點數；錢包看 `chips-me` 的 `balance`。

身分規則同 `chips-me`：已登入帶 Bearer（讀帳號本人，不看 `?actor=`）；`?actor=` 只給還沒併進帳號的 installId，帳號或已併進帳號的 installId → 401 `auth_required`。

- 200 `{actor, points, corrected:{segs, adopted}, dwellStops, lines:[{sys, lnId, segs, adopted}], firsts:[段鍵], trips:[{id, tripDate, trainNo, sys, lnId, verdict, quality}]}`：`trips` 是最近 60 批（新的在前）；`quality` 是 `null` 或 `{code, …qualityText[code]}`；判成 `suspect` 的批次不算進 `corrected`、`dwellStops`、`lines`。回應裡永遠沒有拒絕原因碼。
- `dwellStops`：停站記錄涵蓋的不同站數（鍵 `sys|線|站|站` 去重、不分時段；`ok` 與 `unusable` 的批次都算，`suspect` 不算）。舊版回應沒有這個欄位，讀的一方當 0。
- 錯誤：400 `bad_actor`；401 `unauthorized`／`auth_required`；429 `rate_limited`（帶 Bearer 時）；503 `not_ready`。

## 3. `POST /api/garage-redeem`：用點數解鎖一座場景

```json
{ "actor": "installId", "scene": "south-coast", "requestId": "..." }
```

- `scene` 必須在 `chips.scenes`，否則 400 `unknown_scene`。`requestId` 必填。
- 已登入時帶 Bearer；已經併進帳號的 installId 或帳號 uid 不帶 Bearer → 401 `auth_required`、別人的 Bearer → 403 `wrong_account`（見「身分規則」）。網頁一律登入後才兌換，`actor` 送 `user.uid`。
- 200 `{ok:true, scene, nth, cost, balance, unlocked}`（`unlocked` 形狀同 `chips-me`；`cost`、`balance` 是點數）。同一個 `requestId` 重送不重扣，回的 `scene`／`cost` 與第一次相同（v2 用籌碼兌換的那一筆，`cost` 換算成點數回）；`nth` 是這一座**現在**的第幾座（登入合併後會依解鎖時間重排，可能與第一次不同）；`balance`／`unlocked` 是重送當下的現況。
- 同一個 `requestId` 拿去兌換別的場景 → 409 `conflict`（客戶端 bug；每次兌換都要產生新的 `requestId`）。
- 其他：400 `bad_actor`／`bad_request_id`／`bad_json`／`coordinates_not_accepted`；401 `unauthorized`；405 `method`（只收 POST）；503 `bounty_paused`／`not_ready`／`redeem_failed`。
- 409 `already`（已解鎖，不扣）、409 `not_enough`（附 `cost`、`balance`，都是點數）、409 `conflict`（同時有別的兌換搶先，重讀 `chips-me` 後讓使用者再按一次）。
- 扣點與餘額的判斷在同一筆交易裡做，跟 v2 籌碼換算的那一筆也在同一筆交易（第一次花點數時一定留下換算記錄）。
- 解鎖永久；與通行證無關。

## 3.1 `GET /api/bounty-board`：看板（只讀）

形狀、分組、認領都跟 v2 相同（App 1.7.3 照舊畫）。新客端要依地區、區段分組時，用卡片的 `unitKeys` 對 3.2 的區段檔自己分，**不要在客戶端重寫一套切段規則**。

v2 的卡片欄位（舊欄位 `samples`、`coverN` 保留給舊客端）：
- `need`：這張卡所屬系統的收滿人數門檻（台鐵 50、高鐵 15）。
- `distinctOk`：這張卡各單位「交過 ok 的不同人數」的最小值。
- `covered`：只有 `chips.evergreen` 的線（南迴線、臺東線）會出現收滿的卡，這時為 `true`，排在未收滿的卡之後；**`covered:true` 的卡不能認領**（`/api/bounty-claim` 回 404 `no_open_units`），畫面上只當「還可以錄、照樣拿點數」的提示。一般線收滿的段直接不出現在板上。
- 認領（`POST /api/bounty-claim`，回應形狀不變）：同一個人把同一張卡再接一次＝取代自己在那些單位上還開著的舊認領；登入合併之後，帳號名下同一個單位也只留最近的一筆。

回應頂層的 `retireBlock`、`valuationOk`（每日估值有沒有在正常跑）跟 v2 相同，規則見 `contract-v2.md` 3.1。

## 3.2 區段檔 `data/bounty_sections.json`（瀏覽與顯示用；給點照里程，不照區段）

正式站路徑 `https://railisland.tw/data/bounty_sections.json`。`scripts/build_bounty_units.mjs` 跟單位檔同一發產出（`npm run build-bounty-units`），網頁與 App 都讀這一份。

```json
{ "v": 1, "generatedAt": 1793017426452, "rule": "<一句話說明切法>",
  "regions": [ {"id":"north","name":"北部"}, {"id":"central","name":"中部"}, {"id":"south","name":"南部"},
               {"id":"east","name":"東部"}, {"id":"thsr","name":"高鐵"}, {"id":"afr","name":"阿里山林鐵"} ],
  "lines": { "tra_sched|縱貫線南段": [ {"a":"彰化","b":"員林","dA":0,"dB":14.760257881209345,"km":14.8,"regions":["central"]}, … ] } }
```

- `lines` 的鍵、站名、里程跟 `data/bounty_units.json` 的 `lines` 同一套：每條有兩站以上的線都在，`a`→`b` 里程遞增，從線的第一站鋪到最後一站、前一段的 `b` 是下一段的 `a`。
  `dA`／`dB` 是那一站里程的原值（不取位，可以直接比對），`km` 取一位。站名照軌道檔原字（高鐵「台北」、台鐵「臺北」）。
- 單位歸屬：區段的分界都是車站，所以一個路段單位（`segKey`＝`sys|lnId|站|站`，兩站相鄰）一定整個落在同一條線的某一段裡：兩站在這條線上的里程都在那一段的 `[dA, dB]` 之內。
- `regions`：台鐵看兩端站的縣市（`data/tra_station_info.json` 的地址），兩端分屬兩區就兩區都列；高鐵一律 `["thsr"]`、林鐵一律 `["afr"]`。分頁順序照頂層 `regions`。
- 切法（`rule` 是同一件事的一句話版）：
  - 台鐵：線的兩端＋自強號常停的站（班表各日停靠數的中位數 ≥ 8）為界；< 8 km 的段從最短的開始併，拿掉兩端裡停靠較少的那站（線的端點不拿）；
    > 30 km 的段在「切下去兩邊都還有 8 km」的站裡挑停靠最多的切（一樣多挑離中點近的）。停靠多寡先比自強、再比全部車種。
  - 支線（內灣、六家、平溪、深澳、集集、沙崙、成追）整條一段；高鐵每站一段；林鐵以有車發車、到底的站為界，再照 8／30 km 併、切。
  - 8–30 km 以外的段只有高鐵站距、整條一段的短線，與南迴線 枋山–大武 30.1 km（兩個條件同時成立只能以沒有車停的號誌站為界）。
- 班表每週更新，自強停靠數跨過門檻時分界會變；客戶端每次讀新的，不要把段寫死。

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

伺服器驗證（`cloudRideTrainOk`）跟 v2 相同：台鐵、高鐵驗當天有開、`startedAt` 落在首站 −30 分到末站 ＋30 分（班表沒有這一天就只驗車次存在）；林鐵驗車次＋時間窗；捷運只驗格式與台北時間 05:00–次日 01:30。控管靠價值上限（每天最多 `chips.cloud.dailyMax` 次、一次 `chips.cloud.points` 點）加上限流與寫入總閘。

回應：
- 已登入時帶 Bearer；已經併進帳號的 installId 或帳號 uid 不帶 Bearer → 401 `auth_required`、別人的 Bearer → 403 `wrong_account`（見「身分規則」）。
- 200 `{ok:true, day, rides, toNextChip, chipAwarded, points}`：
  - `points`：這一次入帳幾點（合格就是 `chips.cloud.points`；模擬器 0）。`chipAwarded`＝`points > 0`。
  - `rides`：算次數的總次數（不含模擬器）。`toNextChip` 固定 `1`（只留給 App 1.7.3，新客端不要讀）。
  - 搭乘紀錄與入帳在同一筆交易寫：同一個營運日兩個不同的請求同時到，只有搶到那一格的那一個入帳。
  - 同一個 `requestId` 重送回同形狀的 200、不重記，`points` 是第一次入帳的值——**隔了幾天才重送也一樣**（伺服器先查重送、再查日期窗）。v3 上線前（v2）送的搭乘重送回 `points: 0`。例外：那一筆在登入合併時因為帳號同一天已有一筆而被丟掉，重送就照一般流程判，通常回 409 `already_today`。
- 400 `bad_json`／`bad_actor`／`coordinates_not_accepted`／`app_only`／`bad_request_id`／`bad_day`／`bad_time`／`bad_sec`／`too_short`／`unknown_train`；401 `unauthorized`；405 `method`；409 `already_today`（這個營運日已經記過一次，模擬器的也佔格）、409 `conflict`（同一個 `requestId` 拿去送別天）；429 `rate_limited`；503 `bounty_paused`／`not_ready`（班表或規則讀不到）／`cloud_ride_failed`。
- `simulator:true`：照記、佔當天那格，但不計次、不給點數。
- v2 的「累積 3 次換 1 顆」不延續：上線前已經搭了、還沒湊滿 3 次的零頭（至多 2 次）不補發。

## 5. `POST /api/bounty-merge`：匿名 installId 併進登入帳號

跟 v2 相同，只差在合併退款的單位：
- Header `Authorization: Bearer <Firebase idToken>`；body `{actor:<installId>}`（只有這一個欄位）。登入成功後呼叫一次；伺服器冪等，重呼叫不會重搬。
- 200 `{ok:true, uid, points, merged}`：`points` 是舊的校正貢獻點數（同 2.1），不是錢包；要看餘額請讀 `chips-me`。`merged` 是這次呼叫有沒有把這個 installId 新連到帳號（第一次 `true`，重跑 `false`）。installId 等於 uid 本人時直接回 `merged:false`（這時 `points` 固定回 0）。
- 錯誤：400 `bad_json`／`bad_actor`；400 `not_a_device`；401 `unauthorized`；409 `merged_elsewhere`（同一台裝置換帳號登入 → 產生新的 installId 再呼叫一次）；429 `rate_limited`；503 `merge_failed`。不受懸賞寫入總閘影響。
- 伺服器在同一筆交易裡搬：點數帳本、車庫解鎖、雲端搭乘、每段貢獻、舊的貢獻點數與樣本。兩邊都解鎖同一座 → 保留較早那筆，較晚那筆的花費退回（帳本 `kind:'merge'`，**照那一座付款時的單位**：v2 用籌碼付的退回籌碼，之後照樣換算成點數），第幾座依解鎖時間重排；同一天兩邊都有雲端搭乘 → 只留一筆；每日錄程點數上限不回溯。
- 兩台裝置各自解鎖不同場景、各付了「第 1 座」的價，合併後不補差價。
- 刪帳號（`/api/account-delete`）的範圍跟 v2 相同（見 `contract-v2.md` 第 5 節最後兩條）。

## 6. 規則檔 `data/bounty_rules.json`（v3 的 `chips` 區塊）

區塊名與鍵名沿用 v2（舊客端讀得下去），數字都是點數。`prices`、`dailyChipCap`、`cloud.points`、`chipToPoints` 是 10-26 已確認的設定值。

| 鍵 | v3 值 | 意思 |
|---|---|---|
| `unit` | `"point"` | v3 的記號。客戶端讀到別的值（或沒有）就當 v2 規則：不顯示預估點數 |
| `perKm` | 1 | 沿線 1 公里幾點 |
| `minTripSec`／`minTripMoveM` | 600／1000 | 一趟的最短長度（秒）、各線里程加總的下限（公尺） |
| `remoteLines`／`remoteMultiplier` | 南迴線、臺東線／2 | 偏遠線加倍（逐線套） |
| `dailyChipCap` | 500 | 每人每營運日錄程點數上限 |
| `prices` | [200, 300] | 第 1 座、之後每座的價格（點） |
| `cloud` | `{minSec:600, dailyMax:1, perChip:1, points:20}` | 雲端搭乘：連續秒數、每天次數、一次幾點。`perChip` 是給 App 1.7.3 的相容值（它要 ≥ 1 的整數） |
| `perTrip` | 0 | 相容值：v3 不按趟給點。舊網頁讀到 0 就不畫「一趟得 N 顆」 |
| `chipToPoints` | 50 | v2 的 1 顆籌碼值幾點。**上線後只准調高**：已補的換算記錄是寫死的數額，調低不會收回、新舊兩種人會不一致 |
| `plusBonusPct` | 0（上線時先關） | 通行證錄程加成的百分比（整數，0＝關），見 1.1 |
| `scenes`／`events`／`evergreen` | 同 v2 | 場景清單、期間活動（`{id, from, to, multiplier, lines?}`）、收滿也照常顯示的線 |

客戶端預估一趟點數：照第 1 節「一趟幾點」，用 `scripts/bounty_chips_core.mjs` 的 `tripPoints` 同一套算；里程用客戶端自己投影的沿線里程（伺服器只算防偽閘收下的點，實際入帳可能少 1 點）。

## 7. 跟 App 1.7.3 的相容（伺服器換 v3 之後舊 App 看到什麼）

1.7.3 的規則檔打包在 App 裡（不向伺服器讀），錢包欄位一個都不能少（`balance`、`unlocked`、`nextCost`、`cloud.rides`、`cloud.toNextChip`、`today.chips`、`today.cap` 都要是非負整數，少一個整份錢包解析失敗）。v3 的 `chips-me` 全部保留，所以 1.7.3 照樣能看板、錄程、看錢包（1.7.3 本來就沒有車庫兌換入口）：

| 畫面 | 顯示 | 數字 |
|---|---|---|
| 錢包列 | 「籌碼 250」 | 對（點數，舊字眼） |
| 錢包列 | 「雲端搭乘 N 次・再 1 次拿 1 顆」 | 「1 顆」寫死在 App 裡，實際每次 20 點（偏低） |
| 錢包列 | 「錄程每天最多 500 顆」 | 對（點數，舊字眼） |
| 車庫兌換 | 沒有這個入口 | 1.7.3 兩平台的可兌換場景都是空清單，iOS 端點白名單沒有 `garage-redeem`；`nextCost` 只在解析時檢查、畫面不顯示 |
| 出發前說明 | 「合格的一趟得 1 顆籌碼。」「每天最多 4 顆。」 | 寫死在 1.7.3：句子在 App 裡，1 和 4 來自 App 內建的 v2 規則檔，伺服器改不到。實際照沿線里程給點、每天最多 500 點（偏低） |
| 停站卡的錄法 | 「…在同一條線上移動…才有籌碼」 | v3 看各線合計（偏嚴，照做一定合格） |

入帳、餘額、兌換都對；偏低、偏嚴的字只會讓人少期待，不會讓人少拿點數。出發前說明要等使用者更新 App 才會變。

## 8. 上線順序

1. 正式 D1 先套 `schema/0017_bounty_points.sql`（`chip_ledger`、`garage_unlocks` 各加 `unit`，預設 `'chip'`），再部署 v3 的 Worker。反過來的話 v3 Worker 每一句帳本 SQL 都缺欄失敗（錢包端點 503、判定停在入帳之前，補套之後下一發重判）。
2. `data/bounty_rules.json`（v3）、`data/bounty_sections.json` 跟 Worker 同一次出貨（靜態資產）。
3. v2 籌碼不在 migration 一次換：v2 Worker 還在線上時寫換算記錄，它會把每個人的籌碼看成 50 倍。v3 Worker 在每個人第一次讀 `chips-me` 或兌換時換。
