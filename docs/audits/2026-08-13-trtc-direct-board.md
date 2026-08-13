# 北捷官方到站倒數與動畫校正脫鉤稽核（2026-08-13）

範圍：`feat/trtc-direct-board`，base `origin/main@9643da3`。本工項只改北捷車站看板的到站時間與倒數；不改地圖上列車的名冊、身分或位置模型。下列行號已依最終專測版本的本分支檔案重抓。

## 結論與脫鉤契約

修改前，Worker 已把 TrackInfo 每列的 `NowDateTime + CountDown` 算成絕對 `eta`，但前端 `pollTrtcLive()` 只消費 `boardPos`；車站看板反而以班表時間加 `metroShiftSec()` 顯示。因此 matching、`easedShift` 追趕與 25 m 防瞬移 gate 原本都會間接改變看板時間。

修改後的契約是：

- **車站看板路徑**：Worker 對每列 `board[]` 同時保留 `eta = base + CountDown` 與 `at = base`，其中 `base` 就是該列的官方 `NowDateTime`（`worker.js:833-843`）。前端存入獨立 `state.trtcOfficialBoard`（`index.html:4068`, `index.html:15568-15584`），篩出點開車站的官方 row，直接以 `row.eta - Date.now()/1000` 產生倒數（`index.html:17197-17250`, `index.html:17252-17271`）。
- **動畫路徑**：`boardPos.rows` 仍照舊進入 `applyTrtcBoard()`（`index.html:15598-15720`, `index.html:15746-15752`）。班表 `_tt` 仍是唯一動畫名冊；`_trtcNoTrip`、`metroShiftSec()`、`easedShift`、速率 0.25×–2× 限制、25 m gate 與 `trtcHeadwayPosition()` 均未因本工項改算法。
- **唯一交會點是互動，不是時間**：官方 row 若能唯一對到班表 trip，才附上點擊跟隨身分；無法唯一對應時仍顯示同一筆官方 ETA，但明示為「未連結動畫」且不可點（`index.html:17261-17271`, `index.html:17295-17308`）。Matching 不參與 ETA、排序或顯示與否。
- **分流失敗不連坐**：`pollTrtcLive()` 對 `board` 與 `boardPos` 各自驗收；其中一邊格式壞掉不會清掉另一邊（`index.html:15722-15758`）。

## 真實時鐘、資料鮮度與 fallback

官方直顯只在 real-now、1×、播放中且非拖曳時使用；時間旅行、高倍速、資料缺席或失效時，走修改前原樣保留的 `renderFreqBoard()` 班表路徑（`index.html:15556-15560`, `index.html:17335-17375`）。非北捷系統不進入官方直顯分支。

鮮度依**每列** `at` 與當下真實 epoch 判斷，不使用 Worker 或瀏覽器收件時刻冒充來源時刻。具名純函式 `trtcOfficialRowFresh()` 的上限是 **45 秒**，並只容忍官方鐘比瀏覽器超前 5 秒（`index.html:15544-15555`）。45 秒等於北捷約 15 秒更新節奏的三個週期：可容忍短暫失包，又不會把 5 分鐘 stale response 標成官方即時。

絕對時間保留 `HH:MM`，倒數顯示 `m:ss`；未超過 30 秒事件窗的非正剩餘時間顯示「列車進站」（`index.html:15561-15566`, `index.html:17114-17117`, `index.html:17206-17210`）。倒數由已有的一秒 UI tick 更新（`index.html:8829-8830`, `index.html:17311-17334`），沒有增加 API polling。

## A0 可跟隨唯一配班率 gate

方法：使用離線語料 `trtc-peak-0803` 的 TrackInfo raw rows，依路線、方向、車站、終點篩選當日班表，並以 production join 的硬條件 `shift >= -90 && abs(shift) <= 1800`（即 `[-90, +1800]`）計算是否恰好只剩一個 trip。主樣本為 **s02 08:17:56**，敏感度再掃全部 17 輪快照；這不是另一天正式站 318 rows 的 22:12 快照。這個 gate 只衡量「可否安全點擊跟隨」，不是 ETA 是否可顯示的門檻。

| 路線 | s02 raw nominal | s02 production 保守可點 | 17 輪 raw nominal | 17 輪 nominal 比率 |
|---|---:|---:|---:|---:|
| BR | 0 / 46（0.0%） | 0 / 46（0.0%） | 7 / 782 | 0.9% |
| BL | 5 / 78（6.4%） | 5 / 78（6.4%） | 87 / 1,232 | 7.1% |
| R | 3 / 74（4.1%） | 3 / 74（4.1%） | 76 / 1,258 | 6.0% |
| G | 4 / 49（8.2%） | 4 / 49（8.2%） | 93 / 825 | 11.3% |
| O | 5 / 61（8.2%） | 2 / 61（3.3%） | 80 / 1,037 | 7.7% |
| Y | 5 / 26（19.2%） | 5 / 22（22.7%）¹ | 44 / 442 | 10.0% |
| **合計** | **22 / 334（6.59%）** | **19 / 334（5.69% raw）；19 / 330（5.76% UI）²** | **387 / 5,576** | **6.94%** |

¹ Y 的 raw 26 rows 含 4 列「資料擷取中」；Worker 對這類非時間 `CountDown` fail-closed，實際不會進 `board[]`，所以 production UI 分母為 22。

² nominal resolver 把 O 線 3 筆 branch fallback 當成唯一，但前端對 O 共線往南勢角的 `allCandidates.length !== 1` 一律不附上跟隨身分，故 production 保守可點只有 2/61。依 raw 分母表示為 `19/334 = 5.69%`；表中 `19/330 = 5.76%` 則是排除 Y 四列 Worker 根本不會顯示的 row，才是實際 UI 可點比率。17 輪欄保留離線 nominal resolver 敏感度，不冒稱為 production 可點率。

s02 失敗原因分布如下；括號依序為「不可用、0 候選、2–4 候選、≥5 候選」，不含上表已唯一配班的 rows：

- BR：`0 / 0 / 6 / 40`
- BL：`0 / 2 / 28 / 43`
- R：`0 / 1 / 21 / 49`
- G：`0 / 2 / 17 / 26`
- O：`0 / 0 / 23 / 33`；11 列 branch fallback 中有 3 列被 nominal resolver 算成唯一，production 不讓其可點，故實際保守值為 `2 / 61 = 3.3%`
- Y：`4 / 0 / 7 / 10`；4 列「資料擷取中」為不可用資料

主因是**同時有多個班表候選**，不是找不到路線、也不是 cache 讓 row 過舊。s02 的 row age `p50/p90/max = 3/3/3 秒`；17 輪為 `2/17/17 秒`，全數遠低於 45 秒鮮度上限。即使先合併同站、同終點的 rows，s02 也只有 `13 / 183 = 7.1%` 唯一配班。

改動時間窗可以人為改變這個數字：`[-90,+90]` 逐線 BR/BL/R/G/O/Y 為 `50.0/75.6/91.9/85.7/72.1/30.8%`，但放寬為 `[-90,+180]` 即變成 `4.3/70.5/89.2/75.5/90.2/61.5%`。窗口改動會平白增減候選，不會產生列車身分真值，因此不以調窄窗口虛構高配班率。

gate 的結果遠低於 50%，故 UI 採用保守方案：**官方 ETA 全顯示，只有唯一候選的 row 可點；其餘 row 明示「未連結動畫」且不提供假跟隨**。這保留了有用的官方到站資訊，同時不把不確定 matching 包裝成列車身分。

## 驗收與 mutation

專測命令為 `node scripts/verify_trtc_direct_board.mjs`，證據檔為 `tmp/verify_trtc_direct_board-output.json`。最終完整重跑結果是 **151/151 斷言、22/22 mutation、isolated browser 8/8、full-app direct=true 8/8**。

| 驗收項 | 樣本／命令 | 結果 |
|---|---|---|
| Cache／傳輸延遲抵銷 | 收件延遲 0/15/30 秒＋跨午夜 | **PASS**：同一 ETA 依序顯示 `1:30 / 1:15 / 1:00`；每例與 `eta-now` 的差異為 0 秒，最大 0 秒；00:00:05 仍正確歸入前一營運日 86,405 秒 |
| 收件時間 mutation | 故意改成 `receivedAt + CountDown` | **PASS（會轉紅）**：重啟 1:30 倒數的 mutant 在 15/30 秒延遲案分別多 15/30 秒；production 還原後全綠 |
| 直顯 ETA | 修改後顯示與 `row.eta - currentEpochSec` | **PASS**：合成樣本最大差異 0 秒，低於 1.1 秒 UI-tick 門檻；一秒 tick 只 patch 原 countdown node，資料超齡才 full render |
| 脫鉤 mutation | `metroShiftSec=±300`、`easedShift` 追趕、25 m gate 拒絕、matching 全失敗、`_trtcBoard` 清除 | **PASS**：實際 DOM 的 `.t/.min/排序` 在 -300/0/+300 完全相同；重讀 `metroShiftSec` mutant 確實轉紅 |
| 名冊雙向與 row 獨立性 | 修改前後名冊；官方有/班表無、班表有/官方無 | **PASS**：12 支動畫承重函式均 byte-exact（包含 `applyTrtcBoard`、`metroShiftSec`、`easedShift`），名冊讀寫隔離斷言全綠；兩方向各自成組，未配 row 照顯示且不生動畫身分 |
| Fallback 字節／語意對照 | `board` 缺席/空陣列/過期/超前/時間旅行/非北捷/未知站名 | **PASS**：7/7 matrix 的 direct flag 均關閉、fallback `innerHTML` 與 base byte-exact；任一字句突變的 mutation 會轉紅 |
| Malformed 分流保存 | 非空但全為 malformed（`null`/空欄/`eta<at`）；同 payload 的 `boardPos` 合法 | **PASS**：舊 official state identity 保留、不誤觸發重畫，`boardPos` 仍照常套用；「清舊 state」與「誤當 boardTouched」兩個 mutation 均轉紅 |
| 逐方向 fallback | 同站東向有 fresh official、西向官方缺列 | **PASS**：東向只顯示 official，西向以 legacy 補列，官方方向不重複；「整板二選一」mutation 會抓到漏方向 |
| O 共線去重 | 往南勢角 fresh official；O 兩支都可見／只可見一支 | **PASS**：兩支可見時 official 只有一組、兩支同方向 legacy 都不重複；隱藏一支時 official 仍顯示，可見支線也不補重複 legacy。「只記 display line」mutation 會造成另一支重複並轉紅 |
| Official-covered 方向不觸動畫 shift | 兩方向都有 official／只缺一方向 | **PASS**：兩方向都被 official 覆蓋時先 skip legacy，`metroShiftSec()`/`easedShift` 完全不被推進；只缺一方向時，只為該 legacy 方向呼叫 `metroShiftSec()` 1 次。「先算 shift 再 skip」mutation 會在純 official 開板時誤推 `easedShift` 並轉紅 |
| 跨午夜動畫凍結契約 | real-now 在午夜邊界開啟 official fetch | **PASS**：只解鎖 official board；動畫 `boardPos` 仍沿用原 `rawWallDelta` gate，不因本批補環形時差；「順便套 boardPos」mutation 會轉紅 |
| 站名與排序 | 臺/台、有/無「站」、轉乘/支線共線、兩方向、BR 空車號、重複與過窗 | **PASS**：R/G 支線終點、O 共線、Y visible/deco、BR 空號、exact duplicate、-30 秒事件窗均有專測 |
| 專測 mutation control | 22 個獨立 mutation | **22/22 全數在預期斷言轉紅，還原後 production 全綠** |

Cache-delay mutation 是本工項的關鍵證據：正常式應回答 `eta - now`，因此傳輸延遲已自然從剩餘秒數中扣除；故意改成收件時間加原倒數時，顯示必然慢一個完整收件延遲。這能驗證 cache 誤差已被抵銷，但**不代表 cache 是修改前不準的主因**；A0 新鮮快照的 nominal 唯一配班只有 6.59%，production 可顯示 rows 的保守可點率更只有 5.76%，修改前的主要問題是已有官方 ETA 卻未被直接顯示。

既有回歸實跑紀錄：

- `node scripts/verify_board_ledger.mjs`：PASS。舊 `src/trains/board/cd` 投影在新 `at` 欄位加入後仍與 golden 一致；330 rows 的 `at/eta` 有效，V1–V9 全綠。
- `node scripts/verify_trtc_board_positions.mjs`：修正 commit-after scanner 相容後已完整重跑全綠；證據 `/private/tmp/trtc-direct-board-positions-final.json` 為 **30/30 assertions、8/8 mobile、failures=0**，mutation witness 2,586。初跑 scanner 假紅不是產品行為失敗，且最終證據已覆寫該待辦。
- `node scripts/verify_all_metro_motion.mjs`：Chromium 與 WebKit 的 18 條線均綠；每引擎 54,551 moving steps，zero stalls/backwards，0.25×–2× 速率限制通過。
- `verify_usage_split`：PASS。
- `verify_plus_redirect_policy`：唯一紅燈為 `worker.js:2422` 的既有 baseline 問題，base 上同樣失敗，非本分支引入；本報告不把這支驗收器冒稱全綠。
- 現場沒有名為 `verify_trtc_board` 或 `verify_trtc_freshness` 的獨立檔案；相同契約由 `verify_trtc_direct_board.mjs`、`verify_board_ledger.mjs` 與 `verify_trtc_board_positions.mjs` 覆蓋。

## 瀏覽器與手機驗收

| 引擎／狀態 | 360 | 375 | 414 | 768 |
|---|---:|---:|---:|---:|
| Chromium，`isMobile:true + hasTouch:true` | PASS | PASS | PASS | PASS |
| WebKit，`isMobile:true + hasTouch:true` | PASS | PASS | PASS | PASS |

isolated direct-board matrix 共 **8/8**：每個組合都同時測 matched/unmatched row 的 `page.tap()`、`elementFromPoint`、pointerdown 後重 render 的 generation 防跟錯車、viewport/水平 overflow，以及一秒只 patch countdown node。這個 isolated matrix 只針對看板決定性 fixture，**不冒稱為全 App 控件矩陣**。完整 App 的補證來自 `verify_trtc_board_positions` 八組手機矩陣，以及 full motion 兩引擎頁面零例外、零停滯/倒退；專測的 **full-app direct=true 8/8** 在真實 App boot 後注入 fresh official board，確認北捷直出分支真正生效，並驗了當下可互動控件全集相交掃描、水平 overflow、關閉鈕 `elementFromPoint` 與真觸控。

## 精度聲明、風險與回退

- 這次可主張的是「**車站看板與官方 TrackInfo 倒數同步，不再被我方動畫平滑額外拖慢**」，不是列車物理抵達月台的零誤差。既有 board-vs-CW 真值樣本的 `p50 = 22 秒`、`p90 = 35 秒`，說明兩種官方事件語意仍有差距；本批不可宣稱物理到站誤差為 0。
- 本工項**完全不以地圖動畫改精度**。站間行駛時間模型仍是獨立誤差源；已知板南線往西十二段對 CW 真值累積為 -117 秒，應另立工項，不可拿本次看板成果混同。
- A0 顯示 BR／Y 的車號不能當可靠 binder，O 共線與支線也存在路線歸屬歧義。風險控制是「照顯示 ETA、不假造跟隨」；代價是當前多數官方 rows 無法點擊跟隨，UI 已直說。
- TrackInfo 日後若更改站名或終點命名，會影響路線歸屬與跟隨可用性，但不應影響符合站名的官方 row ETA 顯示。未知 `CountDown` 繼續在 Worker fail-closed 並計數，不猜測時間。
- 若上線後發現官方 feed 語意或 UI 有未覆蓋問題，回退點是關閉 `renderFreqBoard()` 開頭的官方直顯分支（`index.html:17335-17339`），讓所有看板立即回到原班表 HTML；`boardPos → applyTrtcBoard()` 動畫路徑無須回退。
