# 北捷列車依官方時間到站稽核（2026-08-13）

範圍：`feat/trtc-ontime`，base `feat/trtc-direct-board@f8a79ae`。本批延續上一批「車站看板直接顯示官方 ETA」的成果，只改北捷動畫如何消費 `boardPos.trips` 與官方站間端點；不改班表名冊、不改 BUILD、不改公開更新紀錄。

## 結論

北捷正常後端綁定路徑現在同時滿足兩個獨立契約：

1. 車站看板的時間仍只由官方 row 的 `eta - now` 產生，跟動畫身分、shift 與位置計算無關。
2. 地圖上的既有班表車若取得官方錨點，會沿軌道朝 `to` 站推進，並在 `arrEpoch` 所在的 UI tick 到達該站端點；官方 feed 不會生車或滅車。

`boardPos.trips[]` 現在是正常路徑唯一的逐班身分來源。前端以 `(line, dir, from, to, run, arrEpoch)` 唯一對回同輪 `boardPos.rows[]`，再以後端 trip key 找到班表中恰好一班車；tuple、trip key 或 `trackId` 任一步不唯一即 fail closed，不退回時間窗猜測。只有整包 `trips` 缺席或空陣列時，才保留舊 resolver 作相容 fallback。

後端 `trackId` 代表實體車，班表 trip key 代表該車目前佔用的班次。位置、最後畫格與 `easedShift` 都沿 `trackId` 接續，因此同一實體車換班次或 reclaim 時不會從 0 重爬。班表 `_tt` 仍是唯一動畫名冊。

## 1. 準時到站誤差：改前／改後

專測以 Chromium 真實頁面回放 9 條北捷營運線、每線兩個方向或兩個不同班次，共 18 個官方端點。取樣間隔 `tick = 0.25 秒`；抵站誤差門檻由一個 UI tick 推導，不另寫任意寬容窗。另量 `arrEpoch` 畫格的沿軌站點殘差，18/18 都是 0 公尺。

| 路線 | n | 改前 p50 | 改前 p90 | 改後 p50 | 改後 p90 | ≥60 秒誤點 n／改前 p90／改後 p90 |
|---|---:|---:|---:|---:|---:|---:|
| BR | 2 | 2.50 秒 | 266 秒 | 0.25 秒 | 0.25 秒 | 2／266／0.25 秒 |
| R | 2 | 2.25 秒 | 276 秒 | 0.25 秒 | 0.25 秒 | 2／276／0.25 秒 |
| R_XBT | 2 | 1.50 秒 | 1.50 秒 | 0.25 秒 | 0.25 秒 | 0／—／— |
| G | 2 | 2.00 秒 | 2.00 秒 | 0.25 秒 | 0.25 秒 | 2／2.00／0.25 秒 |
| G_XBT | 2 | 1.75 秒 | 1.75 秒 | 0.25 秒 | 0.25 秒 | 0／—／— |
| O_XINZHUANG | 2 | 1.75 秒 | 1.75 秒 | 0.25 秒 | 0.25 秒 | 2／1.75／0.25 秒 |
| O_LUZHOU | 2 | 1.75 秒 | 1.75 秒 | 0.25 秒 | 0.25 秒 | 2／1.75／0.25 秒 |
| BL | 2 | 2.50 秒 | 2.50 秒 | 0.25 秒 | 0.25 秒 | 2／2.50／0.25 秒 |
| Y | 2 | 1.00 秒 | 1,019 秒 | 0.25 秒 | 0.25 秒 | 2／1,019／0.25 秒 |
| **合計** | **18** | **1.75 秒** | **276 秒** | **0.25 秒** | **0.25 秒** | **14／276／0.25 秒** |

改前最差案例不是官方 ETA 本身不新鮮，而是 25 公尺 gate 拒收真正需要校正的官方端點。將產品碼突變回該 gate 後，≥60 秒誤點子群的 p90 回到 276 秒，專測如預期轉紅。

新端點 motion 使用軌道 shape 的里程 `startD → targetD`，不是站點經緯度直線 chord。18 個 production samples 的最大離軌距離為 0 公尺；故意改回 chord 的 mutation 產生 518.796562 公尺離軌。相鄰畫格速度違規為 0/18；故意在 deadline snap 到站的 mutation 產生 1,806.7518 公尺單格跳躍。

## 2. 身分連續與順序守恆：改前／改後

| 判準 | 改前 | 改後 |
|---|---:|---:|
| 同一實體車跨三輪、跨半個班距的 trip 變更 | `A→B→B`，1 次 | `A→A→A`，0 次 |
| 一般同線同向 FIFO 比較 | 459 組中 2 次反轉 | 459 組中 0 次反轉 |
| 兩台同時使用官方 motion | 舊路徑不適用 | 421 畫格，0 次交換 |
| 折返／rebind 的 eased 值 | trip-key mutation：目標 60、讀值 0 | 實體 track key：`60→60` |

兩台官方 motion 仍經 `trtcHeadwayPosition()`，不可繞過順序 gate。移除 gate 的 actual-source mutation 在同一組 421 畫格中產生 179 次交換，最深穿越 86.9176 公尺；production 為 0 次。

跨輪另以一組曾被 headway 限位的雙車 fixture 重送 15 秒後 snapshot：新輪從最後實際畫格接手，刷新同格位移 0 公尺，後車仍連向原前車，後續 20 畫格交換 0 次。改回「未限位 previousMotion 優先」的 actual-source mutation，其新 motion 起點會與最後實畫位置相差 146.449 公尺。

另以三車 chain 驗證局部有無錨點的混合名冊：只有前車 A 有 endpoint，後方 B、C 皆無官方 row，production 仍建立 `C→B→A`，559 畫格中 AB／BC 交換都是 0。把 unmatched→unmatched 鏈截斷的 mutation 會造成 BC 交換 171 次，最深穿越 14.4462 公尺。

reclaim 的雙向 identity map 另驗三步：`A→old`、`A→new`、舊 track 再分配給 B。最終 A 仍指向 new、B 指向 old，沒有因 stale reverse map 刪掉 A；拿掉 forward ownership 檢查的 mutation 會使 A 變成 null。

## 3. 夾限開火與追不上案例

正常 18 個端點樣本中，0.25×／2× 夾限開火 **0/18（0%）**，`unreachable` 亦為 0/18。

專測另外強制造兩種物理上無法同時滿足「速度夾限」與「恰於 ETA 首次抵站」的邊界：

- **追不上（high clamp）**：BR 表定站間 172 秒，但只給 10 秒 deadline。這段 2× 平均速度會達 108.854 km/h，因此實際上限取 `min(2×, 80 km/h)`；最大單格 5.5556 公尺／0.25 秒，低於一格上限 5.6056 公尺。產品不 snap，deadline 時仍距站 1,804.1915 公尺，並明確記 `clamped=high`、`unreachable=true`。拆掉 80 km/h hard cap 的 mutation 會跑到 7.5593 公尺／格，如預期轉紅。
- **慢不下來（low clamp）**：若為了拖到 ETA 必須低於 0.25×，產品仍以 0.25× 前進，提前 122.3049 秒抵站後停留至官方時刻，並明確記 `clamped=low`、`unreachable=true`。故意停等後假裝準時的 mutation 會把 `unreachable` 吞成 false，專測會抓紅。

這兩例是夾限本身造成的不可達，不會被報成準時成功；正常樣本沒有觸發此例外。

## 4. 名冊雙向與邊界

- 名冊雙向共 45 次檢查，錯誤 0：官方有、班表無不生車；班表有、官方無不滅車；不存在的錨點不會夾到首末班而生成幽靈車。拿掉名冊 gate 的 mutation 產生 18 次 mismatch。
- feed 整批中斷會 carry 已開始的 motion；來源切換同畫格位移 0 公尺。故意立即清 motion 的 mutation 跳 620.3298 公尺。
- 正常 backend 輪後若下一輪 `trips=[]`，legacy resolver 可以接手其他班次，但既有 endpoint 會原物件 carry 到 release；刷新同格位移 0 公尺。改回 legacy 先刪 board 的 mutation 會中斷 endpoint 並跳 620.3298 公尺。
- reclaim 更換 `trackId` 的同畫格位移 0 公尺；舊 track 的 endpoint、rendered 與 eased state 不會污染重新分配後的新班次。
- 端點完成後 `arr → release → fallback` 共 19 案，跳位 0；錯把 release 設回 motion end 的 mutation 跳 634.5752 公尺。
- 跨午夜、首班前、首班當刻、末班當刻與末班後的 roster gate 全綠；跨午夜官方端點仍落在一個 tick 的沿軌距離內。
- 車已越過本次 target 時 fail closed：不建立倒走 endpoint、不留下 `Infinity`。突變回 Infinity endpoint 會被專測抓紅。
- App 長開跨過 04:00 時，前一營運日的 physical 四張 map、track／legacy eased channel 與 endpoint board 全數清除；即使當輪 `trips=[]` 也先清後 fallback，新 track 不繼承昨日誤點。
- 平日→週六的長開頁面會依同一 `boardPos.at` 重選 `_tt`；新日 backend key 可 exact match，舊 key 不再 match，指向舊 trip 物件的跟隨也靜默解除。poll 在舊日 `_tt=[]` 的反例仍能切新日並套用 endpoint；舊 eligibility 順序 mutation 則完全無法接線。
- 路線隱藏 60 秒後再顯示，snapshot 從舊 motion 在當下時刻的位置接手，刷新跳動 0 公尺；無 freshness gate 的 mutation 倒退 533.8693 公尺。方向箭頭查 `t−8`也不會覆寫 current 畫格，對照 mutation 倒退 80.4186 公尺。

尖峰 headway chain 另做效能複核：08:30 同量級 173 車、158 個 headway links，兩方向都有 endpoint，每車查 current 與 `t−8`。本次無 memo mutation 首輪兩個時刻分別需 15.1／14.4 ms，同時刻重查仍需 14.4／14.5 ms；board-local 保留最近四個時刻後，首輪為 3.0／2.1 ms，重查為 0.2／0 ms。時間只作同機診斷且會受系統負載波動；hard gate 鎖定的是下方可重算的 compute 放大率與位置等價性。cache 隨 snapshot board 物件更換自然失效，不跨輪污染位置。

## 5. 驗收、mutation 與既有回歸

專測命令 `node scripts/verify_trtc_ontime.mjs`：**45/45 assertions、27/27 mutation controls 全綠**，共 25 個模型（baseline、current、23 個 actual-source mutants）；Chromium pageerror 0。每個 mutation 都紅在對應不變量，沒有以固定人造答案代替產品執行。詳細機器可讀證據位於 `tmp/verify_trtc_ontime-output.json`。

memo 專測的 08:30 名冊為 173 車、158 個 headway links、兩方向都有 endpoint。production 在 current／`t−8` 各對每個 linked trip 計算一次（合計 316），同時刻重查 compute 為 0；拆 memo 的 mutation 四輪合計 4,564 次，放大 14.44×。兩者位置結果 byte-equivalent，158 組 FIFO 交換均為 0；故這項優化沒有以快取代替正確性。

memo 也以 live／stale 狀態分區：同一 `simSec` 由 fresh 跨過 180 秒門檻後，production 會捨棄官方 endpoint cache 並重算班表 fallback，與預期位置誤差 0 公尺；移除狀態分區的 actual-source mutation 會錯留在舊官方位置，偏差 146.6452 公尺。

上一批官方看板專測 `node scripts/verify_trtc_direct_board.mjs` 維持 **151/151 assertions、22/22 mutations、isolated Chromium＋WebKit 8/8、full-app direct 8/8**。官方 `eta`、倒數、排序、freshness 與 fallback 路徑不讀取本批 motion state。

既有回歸：

- `node scripts/verify_all_metro_motion.mjs`：Chromium＋WebKit 各 18 線、54,551 moving steps，stalls/backwards 為 0，0.25×–2× gate 全綠。
- `node scripts/verify_trtc_board_positions.mjs`：payload、位置與 Chromium＋WebKit 360／375／414／768 手機矩陣全綠。
- `node scripts/verify_board_ledger.mjs`：V1–V9 全綠。
- `node scripts/verify_trtc_motion_round2.mjs`：Chromium＋WebKit 各 111,313 samples、490,518 次順序比較、0 violations；`position_off` 與「恢復官方 25 m gate」兩個 mutation 都抓紅。
- `node scripts/verify_trip_binding.mjs`：完整 detached-HEAD 驗收全綠；乾淨 worktree 的 ledger md5 與本 commit 一致，R1／R2／R3／R4／R7a／R7b／R8／R11／R12、trackId／重複 binding／多 row 競用／同分歧義與 `/api/trtc-live` E2E 均通過。R4 的 D1 round-trip 有 152 筆延續綁定且 `boundEpoch` 全數不變；清空動態 state 後的退化重建仍有 145 筆延續綁定且 `boundEpoch` 全數還原。

## 6. 未處理邊界與風險

- 這次證明的是「在 fixture 的官方 `arrEpoch`，地圖上既有班表車到達相同站端點」，不是實體列車穿越月台偵測器的零誤差。既有 TrackInfo 與 CW 兩種官方事件語意比較為 p50 22 秒、p90 35 秒，不能把 UI tick 精度冒稱為物理真值精度。
- 官方 feed 的 station-to-station 更新仍約 15 秒一輪；站間中途位置只是從目前沿軌位置到下一官方端點的平滑路徑，本批不宣稱中途位置準確。
- 正常 payload 的 `trips` 若局部 malformed、tuple 不唯一、backend key 不唯一或 `trackId` 衝突，該筆 fail closed 且不吃舊 winner-search；其車仍依班表存在。整包 `trips` 缺席或空陣列才走 legacy fallback，這是部署相容性保留，精度仍是舊水準。
- 0.25×–`min(2×, 80 km/h)` 是視覺與防瞬移硬上界，因此極端短 deadline 或極端超前資料在數學上可能無法準時首次抵站。產品會保留速度上界、記錄 clamp／unreachable，不以 snap 或停等掩飾。若上游提供的站間 `run` 本身不合理到使 0.25× 仍超過 80 km/h，這是目前未特別建 plausible-speed gate 的防禦性風險；正常北捷資料未觸發。
- `trackId` 的正確性依賴後端 binder；本批驗證身分穩定、唯一性、reclaim 與前端消費一致，不宣稱後端綁定有外部真值正確率。
