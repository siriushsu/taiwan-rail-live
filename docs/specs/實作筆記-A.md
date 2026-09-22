# 單元 A 實作筆記：高鐵座位狀態與票價

分支 `feat/thsr-seat-fare`，基於 `69202efd`。設計依據：`docs/specs/2026-09-11-bus-widget-shared-layers.md` 單元 A。

## 環境驗證（動工前）

- `.env` symlink 指向 `/Users/xuxiang/Code/捷運小動畫/.env`，`TDX_CLIENT_ID`/`TDX_CLIENT_SECRET` 皆非空。
- token 端點 `POST /auth/realms/TDXConnect/protocol/openid-connect/token` 實測 200，`expires_in=86400`。
- 已快取 token 於 scratchpad（`/private/tmp/.../scratchpad/tdx_token_cache.json`），本輪探針全部重用同一顆，未重複取 token。

## 端點探針結果（2026-09-11 09:45-10:00 實測，全部真上游）

### AvailableSeatStatusList（無參數版，我們採用的端點）

- `GET /v2/Rail/THSR/AvailableSeatStatusList?%24format=JSON` → 200，`UpdateTime=2026-09-11T09:45:04+08:00`。
- 頂層鍵是 `AvailableSeats`（不是 spec 文字誤植的其他名稱），298 筆記錄。
- **同一 TrainNo 會出現多筆記錄**，每筆的頂層 `StationID` 是一個「可上車站」，`StopStations[]`
  是從那一站往後的每一停靠站各自的座位狀態——即 OD 矩陣攤平成「以每個可能起站為準」的清單。
  實測驗證：TrainNo=1202 在清單中出現 5 筆（左營/台南/嘉義/台中/台北 各一筆，終點南港不會是「起站」），
  與 `data/thsr_schedule_dense.json` 裡 1202 的完整停靠站序「左營→台南→嘉義→台中→台北→南港」
  （扣掉終點）逐一對應，覆蓋率 100%。
- 三態真實樣本（獨立統計 298 筆的 StopStations 展開後，共約 1500+ 個 origin×dest 配對）：
  - 標準座：O=619、L=90、X=388
  - 商務座：O=878、L=43、X=176
  - O 樣本：TrainNo 1202 台北→南港 08:07 車，標準座 O。
  - L 樣本：TrainNo 1202 台中→台北 07:21 車，標準座 L。
  - X 樣本：TrainNo 1210 台中→板橋 09:08 車，標準座 X。
  三態齊全，不需假資料。

### OD 版端點陷阱（英文站名／壞站碼，僅供文件參考，正式碼不呼叫這支）

實測結果（真上游，2026-09-11）：

| 呼叫 | HTTP | AvailableSeats | 頂層有無 UpdateTime/SrcUpdateTime |
|---|---|---|---|
| `.../OD/TaipeiStation/to/ZuoyingStation/TrainDate/2026-09-11` | 200 | `[]` | **無** |
| `.../OD/9999/to/1070/TrainDate/2026-09-11`（不存在的站碼） | 200 | `[]` | **無** |
| `.../OD/1000/to/1070/TrainDate/2026-09-11`（合法數字站碼） | 200 | 非空 | **有** |
| `.../OD/1000/to/1070/TrainDate/2027-06-01`（超出售票窗） | **400** | — | `{"Message":"TrainDate: 無提供查詢超過供應日期的資料"}` |

**分辨訊號**：壞站碼（不論英文名或不存在的數字碼）與合法站碼的差異不是 `AvailableSeats` 是否為空
（兩者理論上都可能為空），而是**頂層 `UpdateTime`/`SrcUpdateTime` 欄位存在與否**——
上游把「這個查詢有沒有被真正處理」這件事編碼在這兩個欄位上，不是編碼在 HTTP 狀態碼上。
日期超出售票窗是唯一會回非 200 的壞輸入。

我們的正式端點不用 OD 版、不吃站碼參數，所以這個陷阱不會直接發生在 `/api/thsr-seat` 身上；
但同一個教訓（「上游 200+空陣列不代表『這個查詢有效且真的沒資料』」）套用到 List 版端點上，
變成「轉換後的表是空的，幾乎必是我們自己出錯，不是高鐵真的沒有任何一班車」——
List 版没有使用者輸入可能出錯，唯一的出錯來源是我們自己的 URL／解析，所以空表直接視為上游異常，
不快取、退回舊值（見 worker.js 的 `thsrSeat()` 實作與其註解）。

### ODFare（票價）

- `1000→1070`（台北→左營）一般票成人：標準座 1490／商務座 2440／自由座 1445；法優標準座 745／商務 1220／自由 720；
  團體票(TicketType 8) 成人標準座 1415／商務 2315（無自由座這個組合）。**與任務給的期望值逐字相符。**
- 反向 `1070→1000` 與正向逐價比對**完全相同**（只有 `Direction` 欄位與 Origin/Dest 欄位互換），
  故建置腳本只打「小站碼→大站碼」單一方向，票價表雙向共用同一份資料，省一半 TDX 呼叫。
- 相鄰短程 `1000→1010`（台北→板橋）一般票成人：標準 40／商務 260／自由 35——確認短程票價正常（非固定長程假設）。
- 同站到同站 `1000→1000` 回 `200 + []`（合理的退化情形，票價表產生腳本需能處理）。

## 已知取捨與設計決定（實作計畫留白處，本輪自行決定並記錄）

1. **精簡表鍵格式**：`` `${trainNo}|${originName}|${destName}` -> {std, biz} ``，站名一律用 TDX 給的
   `StationName.Zh_tw` 原始字面（與 `thsr_schedule_dense.json`／看板既有站名同源，不做二次翻譯）。
   std/biz 任一非 O/L/X 就各自記 null，兩者皆 null 才整筆跳過。
2. **看板每列的「目的地」**：沿用 `schedBoardRows()` 既有算好的 `r.dest`（該班次的實際終點站），
   不做 OD 選擇器 UI（spec 本文已載明「不需要讓使用者先選目的地」）。只有「有後續行程」的列
   （非 `r.isLast`、非停駛）才查表顯示徽章；到站列與停駛列一律不顯示，不用其他站頂替。
3. **徽章視覺**：只標「標準座」三態為主要徽章（有位/剩不多/售完三色階，複用既有 `--ok`/`--warn-*`
   token，不新增色板），商務座狀態放進 `title` tooltip。理由：訂不到票會流向自由座的是「標準座」
   買不到的人，商務座售完不會把人推去自由座（票價落差太大），標準座才是預測自由座擁擠度的訊號。
4. **大／特大字級不顯示徽章**：看板列在大／特大字級是全站最容易撞版的一處（index.html 既有註解
   明載此事、且有專門的 grid-area 佈局），座位徽章是加值資訊不是導航必要資訊，兩階直接隱藏
   （`html[data-fs] .seatTag/.fareBtn { display:none }`），避免在高風險版面硬塞新元素。
5. **票價入口**：規格「未決與風險」明文把擺放位置留給實作計畫決定。選擇：在座位徽章旁加一顆
   小型「票價」按鈕，沿用該列已知的 origin/dest，點擊後在該列下方插入展開區塊（比照既有
   `boardRxOpen` 的「持久化開關集合＋重繪時原樣掛回」寫法，新開一個 `boardFareOpen`），
   不做獨立的起訖選擇器 UI。

## 檔案清單（實作進行中逐步更新）

- `worker.js`：`/api/thsr-seat` 端點＋純函式（見下方「進度」）
- `scripts/build_thsr_fare.mjs`：新建，建置期產生 `data/thsr_fare.json`
- `data/thsr_fare.json`：建置產物
- `index.html`：CSS＋看板列徽章／票價展開
- `i18n/zh-TW.js` / `i18n/en.js` / `i18n/ja.js`：新增字典鍵
- `scripts/verify_thsr_seat.mjs`：新建，驗收腳本

## 進度

### 前端接線（index.html）

- `renderFreeSeat()` 之後新增一個區塊：`_thsrSeatCache`/`_thsrSeatPromise`/`loadThsrSeat()`、
  `_thsrFareCache`/`_thsrFarePromise`/`loadThsrFare()`（打 `./data/thsr_fare.json` 靜態檔，
  非 worker 端點）、`_thsrStationIdByName`/`thsrStationId()`、`thsrFarePairKey()`、
  `thsrFareCodeName()`、`THSR_SEAT_LABEL`/`THSR_SEAT_CLASS`、
  `thsrSeatBadgeHtml(originName, destName, trainNo)`、`boardFareOpen` Set、
  `thsrFareBtnHtml()`、`thsrFareDefaultTrio()`、`thsrFareExpandHtml()`。
- `schedBoardListHtml()`：`rowHtml` 內加 `isThsr`/`thsrOnward`/`seatBadge`/`fareKey`/`showFare`/
  `fareBtn`/`fareExpand`，徽章插進 `.t`（時間欄，寬度不鎖死，見下方取捨record）、
  票價鈕插在 `.rmore` 之前、展開層接在整列 `</div>` 之後。
- `renderBoardBody()`：開到 `thsr_sched` 板時惰性觸發 `loadThsrSeat()`/`loadThsrFare()`
  （未抓過才抓，抓完只有「還在同一站」才 `renderBoard()`）。
- `openBoard()`/`closeBoard()`：`boardFareOpen.clear()` 比照既有 `boardRxOpen` 一起清。
- `onpointerdown`/`onclick`：`.fareBtn`/`.fareExpand`/`.fareMore` 都排除在跟車熱區之外，
  點擊改走 `boardFareOpen` 開關＋`renderBoard()` 整層重繪（理由：頻率遠低於 `.rmore`，
  用重繪換「不必手刻 DOM patch」的簡單）。
- CSS：`.seatTag`/`.seatTag-o/l/x`（複用 `--ok`/`--warn-ink`/`--warn-bg`/`--warn-line`/`--paper`，
  無新色板）、`.fareBtn`/`.fareExpand` 系列、`html[data-fs] .seatTag,.fareBtn,.fareExpand{display:none}`
  （大／特大字級隱藏，理由見上方取捨 4）。
- `scripts/check_i18n.mjs`：補 `thsrSeatBoardKeys`（座位三態＋票價三車廂短稱，這些是變數查表
  後才 `t(id)`，字面掃描照不到，比照既有 `thsrFareCodeKeys` 的「補成第一級來源」處理）。

### 驗收腳本 `scripts/verify_thsr_seat.mjs`（B/C/D/R 四層，全部跑法：`node scripts/verify_thsr_seat.mjs --only=B,C,D,R`）

**B 層（純函式＋靜態表，零網路）：23/23 PASS。** 用真實 fixture 獨立重算 key/值（不呼叫實作本身）、
O/L/X 三態各一筆真實樣本、`data/thsr_fare.json` 結構完整性、驗收條件4 的三個價逐值核對。

**C 層（`thsrSeat(request, env)` 直接呼叫，自備 fetch/caches/Date 替身）：19/19 PASS。**
`caches.default` 替身真的模擬 `s-maxage` TTL（讀 `cache-control` header、追蹤到期時間，不是永遠
miss），C7 用 T0/T0+300000/T0+600000 三點精確釘死「edge=300／mem=310 → 實際重打上游最小間隔
=600 秒」這個算式。**C8（驗收條件3，最重要）：突變測試**——regex 驗證空表守門人原始碼字面唯一，
寫一份拿掉守門人的副本到 `.thsr-seat-mutated-tmp-<pid>-<ts>.mjs`（**必須放 ROOT 而非
`os.tmpdir()`**，因為 `worker.js` 開頭有相對路徑 import，離開 ROOT 會 `ERR_MODULE_NOT_FOUND`）、
`import()` 成獨立模組實例、同樣「冷啟動+上游回空陣列」情境下證實變成 `200+真空表`
（對照 C2 的正確行為 `502`），`finally` 保證刪除暫存檔，`git status --porcelain` 驗證無殘留。

**D 層（Playwright chromium+webkit，`dev_server.mjs`）：79/79 PASS（本輪修完後）。**
本輪在這一層抓到並修掉兩個測試腳本自己的 bug（都不是產品程式碼問題）：

1. **D2 價格格式**：`expectPrice()` 原本用 `` `NT$${f.price}` `` 裸數字插值，得到 `NT$1490`；
   實際頁面（`thsrFareExpandHtml` 用 `i18nNumber(price)` = `Intl.NumberFormat(I18N_LANG).format()`）
   正確顯示千分位 `NT$1,490`。修法：改用 `` `NT$${new Intl.NumberFormat('zh-TW').format(f.price)}` ``
   ——直接呼叫瀏覽器標準 API 獨立重算（不是呼叫頁面的 `i18nNumber` 包裝函式本身），`openPage`
   預設語系正是 `zh-TW`，判準不同源。
2. **D1/D4 間歇性找不到徽章**：根因是 `openBoard()` 之後固定 `waitForTimeout(300)` 賭「非同步
   loadThsrSeat 一定在 300ms 內做完＋重繪完」，同一支程式碼前後兩輪跑出不同結果（一次全綠、一次
   chromium 五條全紅）——判準綁在猜的時間長度上（judgment.md 第七節第3條的實例）。修法：新增
   `waitThsrLoaded(page)`，改成 `page.waitForFunction(() => typeof _thsrSeatCache !== 'undefined'
   && typeof _thsrFareCache !== 'undefined')`（5 秒逾時），等真正的完成訊號，4 個呼叫點全部替換。
   替換後 D 層連跑兩輪皆 79/79 全綠（含之前跑法就會抓到的兩個假紅樣本）。
3. **B+C+D 合跑時 D0 必假紅**：C 段的 `makeFetchMock`/`makeEdgeCache` 會整段覆寫
   `globalThis.fetch`/`globalThis.caches`，原本沒有還原（`Date.now` 有還原、這兩個沒有）——
   單獨 `--only=D` 因為沒跑過 C，`globalThis.fetch` 還是原生的，測不出來；`--only=B,C,D` 一起跑時
   D 的 `dev_server.mjs` `waitReady()` 自己呼叫的 `fetch()` 被 C 留下的最後一個 mock 攔截
   （對 `/index.html` 這種未預期網址直接 throw，被 `catch{}` 吞掉，於是 30 秒內每次重試都失敗）。
   修法：C 段開頭存 `realFetch`/`realCaches`，結尾與 `Date.now` 一起還原。修好後
   `--only=B,C,D` 三輪穩定重跑皆只剩下方記錄的兩個「確認為既有、非本單元」的 D5 失敗。

**D5 零回歸子檢查：2 個已知失敗，均已用「跑在乾淨 base commit 上」的方法確認為既有、與單元 A
無關**（見下一節「D5 兩個既有失敗的排查證據」），未動這兩支腳本本身（超出單元 A 範圍，已用
`spawn_task` 開一張後續票 `task_83ff896b` 交給獨立 session 處理）。

**R 層（`--real`，真上游）：3/3 PASS。** 見下方「驗收條件逐條證據」的條件1/2。

### D5 兩個既有失敗的排查證據（`verify_punctual.mjs`／`verify_my_trains.mjs`）

現象：`scripts/verify_punctual.mjs` 在 C4 段對 `window.__map.setView(...)` 拋
`TypeError: window.__map.setView is not a function`（整支腳本直接 crash，非受控 FAIL）；
`scripts/verify_my_trains.mjs` 內部 G1 零回歸子檢查因此連帶回報未過項
`C3 drawFeaturedRing 原始碼與改動前 commit 逐字相同`。

**排查方法**：`git -C <worktree> archive HEAD | tar -x` 匯出目前分支 HEAD（`69202efd`，
完全不含任何單元 A 程式碼，逐一 `grep -c _thsrSeatCache` 確認為 0）到 scratchpad 的乾淨目錄，
symlink `.git`（供腳本內部 `git show` 讀物件，唯讀操作）與 `node_modules`，在該目錄起
`dev_server.mjs`，直接跑 `node scripts/verify_punctual.mjs <url>`。

**結果**：在完全沒有單元 A 任何一行改動的乾淨 base commit 上，**逐字重現相同的崩潰**
（同一行號 `verify_punctual.mjs:335`、同一段錯誤訊息）與同一個 `C3` 長度落差
（改動前438 vs 現在628）。結論：這兩個失敗**確認是既有、與單元 A 無關**——`window.__map`
已migrate 到 MapLibre GL（見 memory `rail-3d-shipped-production-20260907.md`），沒有 Leaflet 的
`.setView()`；`verify_punctual.mjs` 的 C4 段從未跟著這個 migration 更新。`C3` 的比對基準
`BASE_REF='24e9c2c'` 本身就已經過期，與單元 A 的改動無關。已用 `spawn_task` 記錄
`task_83ff896b`（修 `verify_punctual.mjs` 的過期 Leaflet API 呼叫）供後續獨立處理，
本單元不動這兩支既有腳本。

### 瀏覽器實看（驗收條件6）——過程中發現的一個環境陷阱

用 `mcp__Claude_Browser__preview_start` 起 `.claude/launch.json` 的 `dev` 設定時，起出來的
process **cwd 落在 `.claude/worktrees/ship-main`（另一個 worktree），不是本單元的
`thsr-seat-fare`**——`lsof -p <pid> | grep cwd` 實測證實。症狀：`openBoard`/`state`/`schedBoardRows`
等既有函式都正常（兩個 worktree 都有），但 `loadThsrSeat`/`_thsrSeatCache`/`thsrSeatBadgeHtml`
在該分頁的 `javascript_tool` 裡一律 `ReferenceError`／`typeof` 回 `undefined`，一度誤判是
Claude Browser pane 的 JS 執行環境對新宣告的頂層 `let`/`function` 有隔離；用
`fetch('/index.html',{cache:'no-store'}).then(r=>r.text()).includes('loadThsrSeat')` 直接比對
伺服器實際吐出的內容，才發現根本是另一棵樹的 `index.html`（不含這次改動）。**修法**：改用
Bash 手動在正確的絕對路徑 `cd` 後起 `node scripts/dev_server.mjs`（獨立埠號），
再用 `mcp__Claude_Browser__navigate` 指到該埠號，不要依賴 `preview_start` 的具名設定解析相對路徑。
此坑與本單元的程式碼無關，是 harness 對「目前是哪一棵工作樹」的判定與我在 Bash 裡 `cd` 到的
路徑不同步；已在下方風險與未確定點記錄，值得寫進 memory（本次執行者為子 agent、依鐵則不可
修改 worktree 以外的檔案，故未動 `~/.claude` 記憶檔，留給主控 agent 判斷是否落檔）。

改到正確的 worktree 後，實測（`10:00`模擬時鐘、台北站板、`10:01` 1309 次往左營）：

- 座位徽章：`<span class="seatTag seatTag-x" title="標準座 售完・商務座 有位（每 10 分鐘更新，
  非即時）">售完</span>`——真實 TDX 資料（`/api/thsr-seat` 打真上游，406 筆表），非 mock。
- 點「票價」：展開層 `台北 → 左營・一般票成人／標準座 NT$1,490／商務座 NT$2,440／
  自由座 NT$1,445／其他票種`；再點「其他票種」：`一般票(單程票)‧法優‧標準座車廂 NT$745／
  ‧商務座車廂 NT$1,220／‧自由座車廂 NT$720／團體票‧成人‧標準座車廂 NT$1,415／
  ‧商務座車廂 NT$2,315`——與 `data/thsr_fare.json`／B4f-h／D2c-e 逐值相符。
- 兩張截圖已附在最終回報。視覺上徽章（橘色「售完」小標籤）與展開層（面板內清單＋千分位金額）
  排版正常，未見溢版或色彩衝突。

## 驗收條件逐條證據（六項）

1. **端點真的打到 TDX**：R1 `status=200 耗時=153ms`；R2 `table` 非空（390 筆）。前兩筆真實紀錄：
   `1202|台北|南港 => {"std":"O","biz":"O"}`、`1210|台北|南港 => {"std":"O","biz":"O"}`。
2. **O/L/X 三態各至少一筆真實樣本**：B1d 用 fixture 逐值核對（`1202|台北|南港`→O/O、
   `1202|台中|台北`→L/O、`1210|台中|板橋`→X/X）；R4 即時抓取分布 `O=208 L=24 X=158`，三態齊全。
3. **正向對照（最重要）**：C8 突變測試——拿掉空表守門人後，同樣「冷啟動+上游回空陣列」情境
   從 C2 的 `502`（正確）翻成 `200+真空表`（bug 重現），證明守門人真的有牙，不是只能一路綠燈。
4. **票價逐值核對**：`1000→1070`（台北→左營）一般票成人 標準1490／商務2440／自由座1445，
   與任務給的期望值**完全相符**，無需回報停手。B4f-h＋D2c-e＋瀏覽器實看三處交叉核對一致。
5. **驗證腳本語系與時鐘雙釘**：`?lang=` URL 參數＋Playwright context `locale:` 雙保險（A0 閘門
   逐語系驗證 `window.__i18n.lang`／`t('票價')` 隨語系正確變化）、`setSimSec()` 釘時鐘；全程用
   `.row[data-no]`/`.seatTag`/`.fareBtn` 等 class／data 屬性定位元件，`grep` 確認腳本內零中文字面
   元件查找。
6. **前端實際用瀏覽器看過**：見上方「瀏覽器實看」小節，兩張截圖（座位徽章＋預設三車廂票價、
   展開其他票種後的完整 8 組票價），對著正確 worktree 的 `dev_server.mjs`、真實 TDX 資料。

## 未做／未驗到的事

- `verify_punctual.mjs`／`verify_my_trains.mjs` 的既有失敗未修（超出單元 A 範圍，已排查證實
  與本單元無關，已用 `spawn_task` 記錄後續票）。
- 未對 O／L 兩態（非 X）額外截圖——B1d／R4 已用數值逐一核對，視覺截圖只取了當下即時資料剛好
  命中的 X 態那一班；若要三態各一張截圖需額外用 fixture mock 才能保證三態同時出現在同一次截圖裡，
  本輪判斷數值核對已足夠佐證，未做這一步額外截圖。
- 未做 App（Capacitor 殼）驗證——spec 範圍是網站看板，未提及 App 端，且 App 出貨線與本分支無關。
- 未對「其他票種」按鈕的手機窄版（360/375/414px）截圖——D3 已用 Playwright 逐寬度量過
  `scrollWidth`/`right` 不溢版（含 X 態徽章＋票價鈕同時存在的最壞情況），但 D3 沒有點開展開層，
  所以「展開層本身在窄版會不會溢版」這一項純用寬度計算沒有直接驗到，只驗過桌面寬度
  （瀏覽器實看用的是桌面尺寸）；風險評估見下方。
