# 官方即時名冊前端稽核（2026-08-13）

範圍：基底 `008d5d6`，暗啟動參數 `?officialroster=1`。本批不改 BUILD、公開更新紀錄、車站看板資料路徑、後端名冊、班距或 45 秒 visitor join。

## 1. 名冊翻面

- 開機第一段固定讀取 `officialroster=1`；未開旗標時不建立官方前端名冊，仍走原班表路徑。
- 開旗標且 `feedMode === 'official'`、`vehicles` 合法、`sourceRevision` 未超過 30 秒時，`boardPos.vehicles` 是唯一畫車母體。一筆 vehicle 畫一台；`rows`、`trips` 或班表均不增減這個母體。payload 逐次整包原子換入，ID 重複、站序越界、方向逆行、非相鄰移動、移動列 `run<=0`或 `depEpoch>=arrEpoch`、欄位壞掉均整體 fail closed 到 outage，不會逐車靜默漏畫。
- 另存最後成功接受的 `sourceRevision` high-water；outage 只改當前顯示狀態，不把 high-water 倒退。合成序列 `100→90→90` 的兩個 90 均被拒絕，舊 frame 不會第二輪復活。
- 每台位置只讀自己的 `from/to/run/depEpoch?/arrEpoch`。一般列以 `arrEpoch-run` 當出發時間，extension 優先用後端明列的 `depEpoch`；`now >= arrEpoch` 直接回傳 `to` 站原座標，因此 deadline 不受班表、速度 cap 或 tripKey 影響。
- `drawFreq`、全台同框 `drawDeco`、畫面計數、命中與跟隨共用同一份官方 render items。`feedMode=outage`、資料 malformed、倒退或 age >30 秒時，render items 回 `null`，整體才落回既有班表路徑；不逐線混補班表車。
- 旗標開啟且使用者拖離真實時刻時，另以只更新名冊的輪詢分支繼續抓資料；車站看板的既有 apply/clear 區塊不經該分支。既有官方看板核心／renderer 的 byte-exact gate 仍通過。

## 2. 五個身分相依功能

1. **點擊跟隨**：新增第三形 `{lineId, vehicleId}`；不保存每輪換掉的 vehicle 物件。每幀按 ID 從最新 snapshot 查回，ID 消失或 outage 即結束跟隨。既有 `{ln,tr}`／`{ln,k}` 保留。車站看板仍送 `{ln,tr}`，只有 optional `tripKey` 在官方名冊中唯一時才轉成 vehicleId；0／多筆 fail closed，不硬跟另一台。
2. **完乘／成就**：現行捷運 `freqFollow` 本來就不呼叫 `recordRide`；本批維持這條邊界，不替自產 vehicleId 新增蓋章規則。國鐵的 `recordRide`／成就函式與基底逐函式一致。
3. **行程分享深連結**：捷運現行沒有車次深連結，本批不新增 URL 契約。既有 `?trip=`、`?train=` 的國鐵函式與基底一致；官方名冊只讀開機第一段的 `officialroster` 旗標。
4. **跨系統車次撞號**：`officialNo` 只供畫牌，不傳給 `followTrainNo`，也不寫 `followTrain/followId`；不會因北捷 A12 撞到其他系統同號而切系統。
5. **重疊車點擊**：北捷官方 hitbox 使用實際牌寬；同點多車全部保留，以距離、vehicleId 決定性排序後開選單。車牌／圓點位置完全不位移。旗標關閉，或旗標開啟但命中集只有機捷／高捷等非北捷 legacy 車時，仍是舊 18px 半徑只取最近一台。

身分靜態／純函式證據：8/8 國鐵完乘與分享函式 byte-identical、5 處 equality 走集中 helper、舊 inline reader 0、疊車入口 2；兩台北捷疊車皆可命中且排序固定，snapshot 同 ID 由 ETA 1010 更新到 1020，ID 消失後查無。旗標關閉命中與 `008d5d6` 100/100 個探針相同；即使 hit pool 另有一台遠處北捷 official 車，游標附近兩筆機捷 legacy hit 在旗標開／關都只取同一筆最近車。

## 3. age gate 量測與裁示

語料為午間 20 輪＋尖峰 80 輪，共 100 輪、13,965 列；整包空列 0 輪。`sourceRevision` 是該 frame 官方 `NowDateTime` 最大值，不是 ETA。正常樣本無版本倒退、無相鄰重複。

| age 定義 | n | min | p50 | p90 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| Worker envelope `live.at-sourceRevision` | 100 | 0.767s | 8.311s | 14.824s | 15.269s | 16.254s | 16.608s |
| fixture mtime 輔助模擬 client observation | 100 | 3.536s | 18.404s | 19.861s | 21.155s | 26.584s | 28.441s |

mtime 不是 payload 契約，只用來估計 edge/cache 額外延遲。若以 client age 判：15 秒會誤退 75/100 輪，20 秒誤退 7/100，30／45／60 秒均為 0/100；30 秒只比觀測 max 多 1.559 秒。使用者裁示採 **30 秒**（2026-08-13 實際裁示；先前寫「45 秒」是誤記，當時並無此裁示）：每秒以 `Date.now()/1000-sourceRevision` 重算，`<=30` 保留官方名冊，超過即整體班表備案；不是只在 fetch 當刻算一次。

`arrEpoch-sourceRevision` 是預報 horizon，n=13,965，min/p50/p90/p95/p99/max = -1/58/155.6/255/556.36/1058 秒，不能拿來判 freshness。

## 4. A–G 旗標開／關與 mutation

### A–F

| 判準 | 旗標開 | 旗標關／對照 | 樣本與結果 |
|---|---|---|---|
| A 名冊守恆 | `vehicles=6`、render=6；灌入不存在 row 仍6，抽一 vehicle 變5；outage 不走官方 render；malformed 7/7 整包退場；`100→90→90` 兩次倒退皆拒絕 | 官方 render=`null`；舊 nearest-one 命中 100/100 與基底相同 | 純函式 6 車＋7 個 malformed 反例＋1 個停站正例；另尖峰 80 輪、11,669 rows＋283 extensions=11,952 vehicle-observations，前端接受 80/80、render 11,952/11,952、cardinality mismatch=0，rows 逆序 diff=0 |
| B 官方 deadline | 兩方向各一例；dep=from、中點 fraction=.5、`arrEpoch` bit-exact 等於 to；改班表後結果不變 | 原班表位置公式未改 | 2 方向、6 個時間／班表探針；真 rAF 0/8，未驗 |
| C 車次選配 | 有號 2 台畫牌；無號 4 台畫點且全保留 | 舊班表牌面路徑保留 | 6 車 |
| D feed 缺口 | extension 1、XBT 停站 1、起點停站 1，皆可畫 | 沿用舊班表備案 | 3 個具名正例 |
| E 身分零破壞 | 第三形跟隨刷新／退場、疊車兩筆命中；`officialNo` 不進國鐵身分 | 8/8 國鐵完乘／分享函式未變；舊兩形仍通過 | source＋VM，旗標關命中100探針 |
| F 手機 | harness 已寫 Chromium＋WebKit × 360/375/414/768，且每組含 auto／全畫面／橫幅／抽屜／sheet 五態、觸控與 rAF deadline | 每組另重開無旗標頁 | **0/8，listener EPERM，未通過亦未假設** |

產品真函式 A–E 斷言 **10/10**；先宣告的 source mutation **20/20** 精確命中預期紅集：A1 feedMode、A2 age、A3 render wiring、A4 flag-off 多選、A5 略過幾何邊界、A6 略過 revision high-water、A7 允許移動列零秒時間軸、A8 遠處北捷 official 車波及非北捷命中、A9 允許 `null` 冒充數值、B deadline、B2 位置公式接受零秒時間軸、C 無號丟車、C2 glyph、C3 renderer、D1 extension、D2 XBT、D3 起點停站、E vehicleId、E2 物件參照、E3 陣列第一台。A5／A6／A7／A8／A9 各只使 A 轉紅，B2 只使 B 轉紅。F 的遮擋 mutation 因瀏覽器未啟動，沒有算通過。

`node scripts/verify_official_roster_frontend.mjs` 的完整機器證據：`tmp/verify_official_roster_frontend-output.json`。失敗原文：

```text
Error: listen EPERM: operation not permitted 127.0.0.1
    at Server.setupListenHandle [as _listen2] (node:net:1926:21)
    at listenInCluster (node:net:2005:12)
    at node:net:2214:7
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
```

in-app Browser 另嘗試直接載入本機 `file:///.../index.html?officialroster=1`，被 browser URL security policy 明確拒絕；依工具規則未繞過。

### G 零回歸

| 命令 | 結果 | 數字／完整阻擋原因 |
|---|---|---|
| `node scripts/verify_binder_done.mjs` | PASS | 20 輪／11 dyn；mutation matrix 全命中 |
| `node scripts/verify_join_parity.mjs` | PASS | 20 輪／11 dyn；production-only=0，洗牌與唯一性突變全命中 |
| `node scripts/verify_binder_join_window.mjs` | PASS | 20 輪／11 dyn；現況 1,554/1,962=79.20%，診斷／mutation 全通過 |
| `node scripts/verify_binder_identity.mjs` | PASS | 尖峰80輪／240檔／41 dyn；active 5,133，track/trip duplicate=0/0 |
| `node scripts/verify_trtc_official_roster.mjs` | PASS | 20/20 結構判準、9/9 mutation；尖峰80輪／11,669列，extension observations=283，XBT extension=0 |
| `node scripts/verify_trtc_official_worker.mjs` | PASS | 25/25 integration、12/12 source mutation |
| `node scripts/verify_board_ledger.mjs` | BLOCKED | V2–V8 純量測先通過；`Error: listen EPERM: operation not permitted 127.0.0.1:43187`，stack 起於 `Server.setupListenHandle (node:net:1926:21)` |
| `node scripts/verify_trtc_ontime.mjs` | BLOCKED | browser前10項通過；`Error: listen EPERM: operation not permitted 127.0.0.1:6740`，stack 起於 `Server.setupListenHandle (node:net:1926:21)` |
| `node scripts/verify_trtc_direct_board.mjs` | BLOCKED | browser前所有靜態／VM項通過；Chromium `bootstrap_check_in ... Permission denied (1100)`，`browserType.launch: Target page, context or browser has been closed`，process `SIGTRAP`，kill亦 `EPERM` |
| `node scripts/verify_trip_binding.mjs` | FAIL 2（環境） | 核心 R1–R14／HG 通過；內嵌 board-ledger 同上 listener EPERM；R4 執行 `git worktree add --detach ... HEAD` 時 `fatal: could not create directory of '.../.git/worktrees/trip-binding-vtree-*': Operation not permitted` |

`verify_trip_binding` 的 additive schema 已改為「required 9 欄 own-property 子集合」，並寫入額外第10欄仍綠、刪除 required `arrEpoch` 轉紅的正反控制；獨立抽取同一 helper 的 VM probe 為 `base=true / extra=true / missing=false`。整支 E2E 尚未走到這段便被上述 R4 `git worktree add` 權限阻擋，故不把它算成整支通過。`node --check` 與 `git diff --check` 皆通過。

## 5. 未處理邊界與風險

- **瀏覽器尚未驗**：可宣稱公式在 `arrEpoch` bit-exact 到站；不能宣稱 Chromium／WebKit 真畫格已驗。手機四寬、五狀態 UI、觸控、F mutation 均需主對話在可 listener／可 browser 的環境補跑。
- **客端時鐘**：30 秒 gate 以 `Date.now()` 對官方來源時刻；裝置時鐘超前會提早 fallback，落後會延後 stale 退場。目前未另加 future-skew 下界。
- **成功空 frame**：fresh `vehicles=[]` 是權威空名冊；現有100輪沒有整包空樣本。若上游故障卻 HTTP 200 持續回合法空列，僅靠 age 無法與真空班分辨。
- **凍結但 HTTP 200**：若上游持續重播舊列，sourceRevision 不前進會在 30 秒退場；若錯誤地同步刷新 `NowDateTime`，本層無法辨識內容凍結。
- **靜態幾何版本錯配**：payload 現會逐筆對全部北捷線路檢查 `from/to/dest`、相鄰性與 `run`；任一筆不可定位就整包 outage。因此不會靜默少畫車，但若後端與靜態資料不同版，整體會暫時退班表，部署時仍須保持同版。
- **XBT**：官方只發起點／終點停站列、沒有任何行進區間；本批只誠實畫在站上，不推測途中位置。
- **extension 退場**：到 `arrEpoch` 時位置準時到終點，但直到下一份 roster snapshot 才從名冊移除，可能在終點多停一個 fetch/cache 間隔。
- **模擬時間**：~~官方路徑刻意採 wall clock；拖動時刻尺時脫軸~~ —— 2026-08-13 使用者裁示②已加 gate，見下節；本項風險已關閉。
- **身分宣稱邊界**：BR／Y 無官方車號，vehicleId 是決定性自產身分；本批只證身分連續不變量，不宣稱認車正確率或位置準確。

## 6. 使用者裁示落實（2026-08-13）

| 裁示 | 落實 | 驗證 |
|---|---|---|
| ① 資料齡上限改 30 秒 | `TRTC_OFFICIAL_ROSTER_MAX_AGE_SEC = 30`，三處 UI 文案同步 | 100 輪語料實測 max 28.441s，30 秒誤退 0/100（既有量測，門檻收緊不改結論） |
| ② 時鐘離開「現在」就整體交還班表 | 新增 `trtcOfficialRosterLive()`（沿用既有 `trtcOfficialBoardRealNow()`，不另發明判準），五個讀 state 的入口全部改走它；輪詢層 `pollTrtcLive` 時光機分支改呼叫 `trtcOfficialRosterOutage('time-travel')`，並撤掉原本兩處 `\|\| OFFICIAL_ROSTER_ENABLED` 繞道 | 獨立驗收 `tmp/verify_roster_indep.mjs`：撥離現在 → 官方車畫 0 台、班表車 159–162 台接手、徽章轉「班表備案」，回到現在自動接回（chromium／webkit × 360/375/414/768 共 8 組全綠）。突變 N3 把渲染層與輪詢層兩道 gate 一起拆掉，該判準準確轉紅；A–F 另加 M-E4 證明跟隨路徑的 gate 也有牙 |
| ③ 看板點班次配不到官方身分時不跟隨 | 維持現行（吐 toast、不跟隨） | 使用者接受，但要求持續觀察強化 → 見下節 |

### 裁示③的後續：為什麼會配不到，量到什麼

尖峰語料（`軌島-語料/trtc-peak-0803`，17 輪）逐輪重放 `buildLedgerFromRaw → bindTracksToTrips`：

- 「照班表順序對上就好」的兩個前提實測都不成立：**軌道台數與班表台數相等的輪次只佔 34.6%**（106/306 個 line+dir×輪；BR|2 是 0%，平均多 2.5 台）；且 4/18 個桶同方向有 2 種以上終點站，「班表上的下一班」與「這段軌道上的下一台」不同序。軌道那張清單本身也會碎：316 個 track 身分中 20.9% 只活一輪。
- 純序號法真的做過而且更差：`trtc_board_ledger.mjs:872-874` 記著 v1.0「前驅單調水位線」實測 unbound 67.8%，其中 98.2% 明明有合理候選卻被水位線擋死——它把「出生順序」當「發車順序」，車在終點折返／身分碎裂重生時兩者脫鉤。
- 現行配不到的案例裡，**80.4% 是「有空著的班次可配、但被無反轉約束擋下」**，只有 11.0% 是真的沒班次可搶。控制實驗（唯一變因＝關掉 `violatesNoReversal`）：出生綁定率 45.1% → 59.3%，**畫面覆蓋率 82.6% → 89.8%**。
- 但那 7 個百分點是拿「可能把車認成前後班」換的，本輪**沒有絕對真值可判斷多出來的綁定對不對**，所以不建議直接放寬。可觀察的下一步是把無反轉擋掉的案例記成計數哨兵（不改行為），累積後再判斷該不該放寬。
