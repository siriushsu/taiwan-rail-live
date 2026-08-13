# 環狀線／文湖線 join window 第一階段稽核（2026-08-13）

## 1. 甲／乙分辨與上游診斷

本輪只做裁示要求的第一步。樣本為 `tmp/binder-fixtures/rounds/` 20 輪：看板時間
`1786593845–1786594445`（2026-08-13 12:04:05–12:14:05 +08:00），共 2,296 列，
排除停站列與過期列後 1,962 列。`trip_dyn` 只有 11 個相異 `at`，所以 shift／birth
動態只有 10 次真正 cron 轉換；所有時間均取同輪 `live.boardPos.at`，未用執行當下時鐘。

### 1.1 minCost：精確重現題面，判別為乙

前 16 輪、1,563 個 eligible rows 精確重現題面 167 個 G observations：`<60s=29`、
`60–180s=37`、`≥180s=101`。20 輪擴充結果如下；一筆是官方預報 row，不等於一台車。

| 線 | G observations | `<60s` | `60–180s` | `≥180s` | minCost 中位 |
|---|---:|---:|---:|---:|---:|
| BR | 116 | 25 | 16 | 75 | 203.5s |
| Y | 59 | 8 | 21 | 30 | 315s |
| BL | 6 | 0 | 2 | 4 | 210.5s |
| R | 9 | 2 | 0 | 7 | 269.5s |
| G | 2 | 0 | 2 | 0 | 87.5s |
| O_XINZHUANG | 3 | 0 | 0 | 3 | 524s |
| O_LUZHOU | 1 | 0 | 0 | 1 | 526s |
| **合計** | **196** | **35（17.9%）** | **41（20.9%）** | **120（61.2%）** | — |

`≥180s` 遠多於擦邊列，故仍是乙：主要不是 45 秒窗太窄，放寬只會讓量級錯誤的
候選進場。

### 1.2 綁錯形態：不是整線單一 offset

下表的 MAD 是每個唯一快照內、同 `line+dir` active bindings 對該組中位數的 raw MAD，
再取 11 個快照中位；`>180s` 也相對各自快照中位計算。

| 組別 | pooled lastShift 中位 | 快照 MAD 中位 | 距同輪中位 `>180s` |
|---|---:|---:|---:|
| BR dir1 | 184.5s | 28s | 8/118 |
| BR dir2 | 354s | 91.5s | 51/135 |
| Y dir1 | 1,848.5s | 198.5s | 17/42 |
| Y dir2 | 87s | 248.5s | 36/63 |
| BL dir1 | 21s | 14.5s | 0/111 |
| BL dir2 | 51.25s | 39.5s | 29/108（單一持續 outlier 反覆入樣） |
| R dir1 | 20s | 11s | 0/104 |
| R dir2 | 24s | 16.75s | 0/114 |

只比較相鄰唯一 dyn 裡「同 `trackId+tripKey` 仍存在，且 `lastArrEpoch` 真的更新」的樣本：

| 線 | 保留身分／前輪 active | 真更新 | `|Δshift|` p50／p90 | `>45s` | `≥180s` |
|---|---:|---:|---:|---:|---:|
| BR | 193/231 | 149 | 15.5／42s | 14/149（9.4%） | 1 |
| Y | 50/95 | 15 | 65／480s | 9/15（60.0%） | 7 |
| BL | 181/199 | 158 | 13.5／43.3s | 15/158（9.5%） | 0 |
| R | 189/198 | 168 | 14.75／35.65s | 6/168（3.6%） | 0 |

- BR 同一綁定的輪間漂移與 BL 接近；大量 G 與「不同綁定落在穩定 offset 分群」
  較一致，不能由自然輪間抖動單獨解釋，且 dir2 最明顯。但現有資料無法把特定 G row
  追回實體車，所以這是形態證據，不是已閉合根因；亦不符合「全線只加一個固定相位即可修好」。
- Y 同時有車間離散與大幅輪間跳動。以同 `tripKey` 追蹤時 93/95 班仍存在，卻有 43 次
  換 `trackId`；55 次真更新中 23 次（41.8%）超過 45 秒，p90 412.8 秒。這只能證明
  synthetic 身分連續性不穩，不能冒充實體車外部真值。

### 1.3 可見 birth 與 ref survivor proxy

以 `boundEpoch > 前一個 dyn.at` 找到 19 個可見 birth；不能只做 tripKey set diff，否則會
漏掉同一 tripKey 換人的 birth。但 runtime 未落盤 `refCount/ref/cost` 或兩個 pass 中間狀態，
下表是依落盤後仍可見、同線同向、非 done、最近 1,200 秒的 survivor 重建 proxy，
並排除 `boundEpoch` 等於該 birth 的同 pass newborn；**不把 proxy 冒充官方 runtime audit 真值**。

| 線 | 可見 birth | survivor proxy 數 | proxy `N≤2` | pass2 候選 | 無可觀測歧義的條件式 cost proxy |
|---|---:|---|---:|---:|---:|
| BR | 5 | 3、4、4、5、5 | 0/5 | 1 | 0/1 |
| Y | 4 | 1、2、2、4 | 3/4 | 1 | 0/1 |
| BL | 6 | 3、3、3、4、4、4 | 0/6 | 3 | 2/3（34.5／5.25s） |
| R | 4 | 4、4、5、5 | 0/4 | 1 | 0/1 |

Y 的 survivor proxy 稀疏是本批特異嫌疑訊號；BR 5/5 的 proxy 都至少有 3 筆，因此「稀疏」不能
概括兩線，但缺 raw claims 與正式 telemetry，不將其宣告為 Y 的已證實根因。19 個 birth context
共標出 17 個可觀測時序歧義（同一變化可影響多個 context）；6 個 pass2 候選只有 2 個未見
歧義，仍只報「條件式 proxy」。另 13 個 pass1 birth 沒有中間快照，不計算 ref/cost。

### 1.4 合成班表 vs 固定站點官方預報 episode 推定間隔

班距只在同一 `(line,dir,to,dest)` 站流內相減，絕不跨站。BL/R 有號控制組中，同車 ETA
更新 534 筆、最大向後修訂 45 秒；換車 71 筆、最小跳升 184 秒，兩群完全分離，故無號
BR/Y episode 門檻取兩群中點 `floor((45+184)/2)=114s`。live 與 schedule 都要求前一個
episode/班次落在同一捕捉窗（`boardPos.at` 開頭前 5 秒至末輪）。每個站流各貢獻一個
`live median / schedule median`，避免某一站流因捕到較多 interval 而額外加權；不代表消除了
同一列車跨站的相關性。這是 ETA 預報 episode 的推定間隔，
不是列車實際通過站點的 event log。

| 線 | 配對站流 n／raw live interval n | live p10／p50／p90 | raw schedule p50（n） | station-pair ratio p10／p50／p90 |
|---|---:|---:|---:|---:|
| BR | 46／82 | 238／263.5／304.45s | 276s（101） | 0.872／0.963／1.097 |
| Y | 17／17 | 431.7／450／467.6s | 420s（29；混合 420/480） | 0.956／1.009／1.063 |
| BL（只用有號） | 32／43 | 229.2／290／548.5s | 300s（67；服務混合） | 0.882／0.997／1.101 |
| R（只用有號） | 28／28 | 513.8／538／552.8s | 540s（43） | 0.951／0.996／1.024 |

這 20 輪首末相隔 600 秒，事件窗另含開頭 5 秒 grace。午間樣本看不到 Y 班距錯位；
BR 全站配對中位只比表密 3.7%，本窗未見班距量級差。
題面引用的「BR 實際尖峰 2.2 分、表 3.0 分」是舊狀態：祖先 commit `c93d20c` 已把
BR 平日 07–09 設為 132 秒、09–17 設為 276 秒，且實測帶優先。本 fixture 是
12:04–12:14，不能重驗尖峰，也不能拿午間 10 分鐘外推全日。

## 2. 本輪改法與理由

**沒有改 production 行為。** `TRIP_BIND_VISITOR_JOIN_WINDOW_SEC=45`、出生 cost 與三硬約束、
派工①收班判定、班表、worker 與前端皆未動。新增的只有唯讀診斷／mutation harness
`scripts/verify_binder_join_window.mjs` 與本報告。

理由是甲／乙判別仍明確為乙，依派工要求必須停在第一步等裁示；而且上游形態不同：Y 有
ref survivor proxy 稀疏嫌疑與 synthetic identity churn，BR 的 proxy 不稀疏、單 binding 漂移不大，
但不同 binding 呈 offset 分群形態。這些都還不是已閉合根因；現有午間班距又與表大致吻合，
沒有證據可自行改班距或用同一個 binder fallback 同時處理兩線。

## 3. A–F 改前／改後

| 判準 | 本輪結果 | mutation／執行狀態 |
|---|---|---|
| A 分辨實驗 | PASS；前16輪 167 筆精確重現，20輪 196 筆；結論乙 | 8 個 mutation（無限窗、key-set birth detector、同 pass newborn、忽略 ref 時序歧義、忽略缺中間態、假 shift update、跨站流、班表窗外樣本）全依預期轉紅 |
| B 接上率提升 | 尚未進入第二步；沒有 after 數字 | 非 gate；見第4節靜態基線 |
| C 不以誤配換覆蓋 | 尚未進入第二步，未宣稱通過 | 「極大窗須使 C 紅」留待修法確定後實作，沒有拿 A 的無限窗 mutation 冒充 C |
| D 順序守恆 | 尚未進入第二步，未宣稱通過 | 未執行 |
| E 名冊守恆 | 尚未進入第二步，未宣稱通過 | 未執行 |
| F 零回歸 | 可純函式執行者通過；listener/browser 項受環境阻擋 | 詳下表 |

| 命令 | 結果 |
|---|---|
| `node scripts/verify_binder_join_window.mjs` | PASS；A 四組基線綠、8/8 mutation 如預期紅 |
| `node scripts/verify_binder_done.mjs` | PASS；exit 0 |
| `node scripts/verify_join_parity.mjs` | PASS；17 個可比較輪、1,473 身分只在 production 有 0；480 次洗牌差異 0；身分重複 0；4/4 mutations 紅 |
| `node scripts/verify_trip_binding.mjs` | 未直接執行：R4 會做本單明禁的 `git worktree add`。替代 `TRTC_BIND_SKIP_R4=1 node scripts/verify_trip_binding.mjs` 得 87 個綠燈，內嵌 board ledger 因 `listen EPERM 127.0.0.1:43187`，exit 1；R4 明確跳過，不宣稱整支通過 |
| `node scripts/verify_board_ledger.mjs` | 純函式 10 項綠；`listen EPERM 127.0.0.1:43187`，exit 1 |
| `node scripts/verify_trtc_ontime.mjs` | 靜態 9 項綠、1 個 mutation 有反應；`listen EPERM 127.0.0.1:6740`，exit 1 |
| `node scripts/verify_trtc_direct_board.mjs` | 靜態 68 項綠、18 個 mutation 有反應；Chromium `MachPortRendezvousServer ... Permission denied (1100)`，exit 1 |

## 4. 逐線接上率

落盤 fixture 是派工①修正前已持久化的 dyn，缺 cron raw claims，不能忠實倒推出派工①修後
dyn；所以只列目前靜態 join 基線，不捏造派工② after。派工①報告的 guard 受控反事實對
BR/Y 都沒有增量，故本單兩個目標線的可量基線不受該反事實影響。

| 線 | 目前靜態基線 | 派工② after |
|---|---:|---:|
| BR | 316/471（67.1%） | 未實作 |
| Y | 110/172（64.0%） | 未實作 |
| BL | 333/387（86.0%） | 未實作 |
| R | 355/389（91.3%） | 未實作 |
| G | 166/199（83.4%） | 未實作 |
| O_LUZHOU | 142/152（93.4%） | 未實作 |
| O_XINZHUANG | 132/192（68.8%） | 未實作 |
| **合計** | **1,554/1,962（79.2%）** | **未實作** |

## 5. 未處理邊界與風險

- 20 組 fixture 沒有 cron 當輪 raw claims，無法忠實重跑 binder、產生派工①修後 dyn，亦無法
  外部真值式地追 BR/Y 的某個 G row 到同一台實體車。
- BR/Y 沒官方車號；`trackId` 是 synthetic identity。`trackId` churn 是 binder／上游連續性
  訊號，不是認車正確率。
- birth 的正式 audit/event/trip_dyn 沒落 `refCount/ref/cost`，13 個 pass1 無中間快照，pass2 亦只能
  排除可觀測歧義；報告全部降級為 survivor/conditional proxy，未把缺資料當成零或真值。
- 班距只有午間 600 秒：BR 46、Y 17 個「站流配對」不是 46／17 個獨立列車對，且 Y
  每個有效站流最多只有 1 個 headway；這是預報 episode 推定值，不是實際通過 event。不能外推
  尖峰或全日。BR 尖峰 132 秒表值已存在，但本批沒有尖峰官方樣本可重驗。
- BR 的 offset 分群形態根因仍未閉合；可疑範圍是出生選邊／上游無號 track 碎裂，而不是已被
  本批排除的單純 45 秒窗或午間班距。Y 的 ref survivor proxy 稀疏雖有訊號，但只有 4 個可見 birth，尚不足以
  在缺 raw claims 下安全設計 fallback。
- 下一步需主對話裁示：補收含 raw cron claims、尖峰與持久 ref telemetry 的語料，或授權針對
  Y ref survivor proxy 稀疏嫌疑／BR synthetic identity 分開設計；在此之前不改班表、不放寬窗。
