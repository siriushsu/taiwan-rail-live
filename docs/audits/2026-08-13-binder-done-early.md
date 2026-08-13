# 北捷逐班綁定提早收班修正稽核（2026-08-13）

## 1. 誤收量測

樣本為 `tmp/binder-fixtures/rounds/` 20 輪、30 秒一輪；看板窗為
`1786593845–1786594445`（2026-08-13 12:04:05–12:14:05 +08:00）。`trip_dyn`
只有 11 個相異 `at`（`1786593815–1786594415`），所以直接可觀察的是 10 次 cron
轉換，不是 20 次。舊版沒有持久化 `_reachedEnd` 或當輪 cron claims；以下只在
`lastTo` 不是班次終點時結構性排除 `reachedEnd`，不以欄位有無變化冒充觸發證據。

| 線 | 最終累計 done | 可見 false→true | 其中 schedule-only | 後續同向有號 feed | 題面 B row observations | 涉及唯一舊 binding |
|---|---:|---:|---:|---:|---:|---:|
| BR | 151 | 4 | 4 | 0 | 0 | 0 |
| R | 129 | 4 | 4 | 0 | 3 | 3 |
| G | 115 | 3 | 3 | 0 | 21 | 2 |
| O_LUZHOU | 74 | 1 | 1 | 0 | 4 | 3 |
| O_XINZHUANG | 58 | 1 | 1 | 0 | 54 | 5 |
| BL | 154 | 4 | 4 | 0 | 47 | 6 |
| Y | 78 | 1 | 1 | 0 | 0 | 0 |
| **合計** | **759** | **18** | **18** | **0** | **129** | **19** |

- 18 個視窗內新 done 的 `lastTo` 均非終點，故 `reachedEnd=0`、`scheduleGraceOver=18`。
  其中 9 車之後先以反方向再現，延遲 60–225 秒（p50 135 秒），符合終點折返而非
  「同一趟同方向仍在跑」。
- 題面 B 口徑在 20 輪找到 129 列；它們指向 19 個日內舊 done binding，19/19 的
  `lastTo` 均非終點。可是同一官方車號 alias 在一天內會跨趟復用；row 與該舊 binding
  的 `|shift-lastShift|` 為 4,029.5–18,132 秒（中位 9,988，45 秒窗內 0）。因此
  129 是「done 狀態造成的靜態抑制暴露」，不可冒充 129 個已證實的同趟誤收事件。
- fixture 缺 cron 當輪 claims，無法忠實重跑 binder 得到真正修後 `trip_dyn`。這項資料
  限制也使 10 個轉換裡可直接證成的「done 後同趟同向仍持續回報」為 0；本修正的
  liveness 因果由下列 source mutation 與受控反事實承擔。

## 2. 改法與理由

每筆 binding 新增並持久化 `lastSeenEpoch`、`reachedEndEpoch`：同 `trackId` 且同線同向的
合法官方 claim 一出現即更新 liveness，即使 leg 查無也不會誤當失聯；後者亦不得被
reclaim 換車。`reachedEnd` 與 `scheduleGraceOver` 改為收班候選，只有從最後觀測沉默滿
180 秒才真正 `done`。舊 `trip_dyn`／關係表 fallback 缺新欄位時，保守以本輪時間初始化
`lastSeenEpoch`，最多多留一個 180 秒窗，仍有界。終點證據跨輪保存，避免本輪有 feed 否決
後下一輪證據遺失。

未改出生 `cost=|shift-ref|`、三硬約束、45 秒 visitor join、合成班距、前端與既有
目的地改變驅逐／再出生流程。

## 3. A–F 改前／改後

### A. 持續觀測否決

| 測試 | 改前 | 改後 | mutation control |
|---|---:|---:|---|
| schedule-over＋feed 持續 | 1/1 提早 done | 0/1 | 拿掉觀測否決後 1/1 紅 |
| reachedEnd＋feed 持續 | 1/1 提早 done | 0/1 | 拿掉觀測否決後 1/1 紅 |
| 同向 legMiss＋另一 fresh track | 1/1 被 reattach 取代（舊 liveness 判法） | 0/1；舊 track 保留 | 改回 `updatedFullKeys` 判失聯後紅 |

### B. 有界收班

兩種候選各 1 筆（schedule-only、reachedEnd-only）：改前在 179 秒前已收 2/2；改後
179 秒仍 active 2/2、180 秒恰好 done 2/2，下一輪重複 done 0。mutation「永不收班」
在 180 秒仍 done 0/2，B 轉紅。

### C. 身分唯一性

原始 20 輪 active binding samples 2,126 筆，重複 `trackId=0`、重複
`(line,dir,tripKey)=0`。20 輪受控反事實改前／改後各掃 2,255 筆，兩種重複均為 0。
兩個獨立 mutation 分別造成同 track 多 trip（1）與同 trip 多 track（1），C 各自轉紅。

### D. 折返交棒

終點反向 terminal 情境：改後交棒 1 次、方向 2→1、重送後新增交棒 0、舊方向 binding
不存在。阻斷既有「目的地改變時驅逐／再出生」的 mutation 使交棒 0、舊方向仍 active，D
轉紅。核心程式未改這段既有行為，只加 mutation anchor。

### E. 接上率（效果證據，不作 gate）

原始快照靜態 join 為 1,554/1,962（79.2%）；因 `dyn` 已在修前持久化，直接換程式不會
倒改歷史狀態。為看見收班 guard 的影響，另做 20 輪受控反事實：每輪每個實體車最多暫復
一個「本輪仍見同車、同線同向、可排除 reachedEnd」的舊 binding，只把同輪 row 當
`lastSeen` 證據後跑新舊 guard。舊 guard 為 1,554/1,962（79.2%），新 guard 為
1,683/1,962（85.8%，+129，+6.6pp）。若把 visitor row 當完整 cron claim，兩版都會先
更新 shift 而成 1,683/1,962，證明 fixture 不足以做忠實 cron before/after；所以本表只稱
「受控反事實」，不宣稱認車正確率或正式站實際提升。

### F. 零回歸

| 命令 | 結果 |
|---|---|
| `node scripts/verify_binder_done.mjs` | PASS；29 個綠燈、0 紅，A–E 與 6 個 mutation controls 全符預期 |
| `node scripts/verify_join_parity.mjs` | PASS；task⓪ A–D 與 mutations 全綠 |
| `node scripts/verify_trip_binding.mjs` | 未能全跑：純函式段 87 項通過；內嵌 board ledger 起 `127.0.0.1:43187` 得 `listen EPERM`，R4 執行 `git worktree add --detach <tmp> HEAD` 得 `Operation not permitted`（本單亦禁止 git 寫） |
| `TRTC_BIND_SKIP_R4=1 node scripts/verify_trip_binding.mjs` | R1/R2/R3/R5/R7a/R7b/R8/R10/R11/R12/R13/R14/HG 全通過；只有內嵌 board ledger 的同一 `listen EPERM`，故整支 exit 1，不宣稱全綠 |
| `node scripts/verify_board_ledger.mjs` | 純函式 V2–V8 10 項通過；listener `127.0.0.1:43187` `EPERM`，exit 1 |
| `node scripts/verify_trtc_ontime.mjs` | 靜態 9 項通過；listener `127.0.0.1:6740` `EPERM`，exit 1 |
| `node scripts/verify_trtc_direct_board.mjs` | 靜態 68 項通過；Chromium `MachPortRendezvousServer ... Permission denied (1100)`，exit 1 |
| `node scripts/verify_trtc_motion_round2.mjs` | 未跑到判準：`ENOENT /Users/xuxiang/Code/軌島-北捷運動-基準/index.html`；未改期望值 |

## 4. 逐線接上率

| 線 | 原始 persisted 快照 | 舊 guard 受控反事實 | 新 guard 受控反事實 |
|---|---:|---:|---:|
| BR | 316/471（67.1%） | 316/471（67.1%） | 316/471（67.1%） |
| R | 355/389（91.3%） | 355/389（91.3%） | 358/389（92.0%） |
| G | 166/199（83.4%） | 166/199（83.4%） | 187/199（94.0%） |
| O_LUZHOU | 142/152（93.4%） | 142/152（93.4%） | 146/152（96.1%） |
| O_XINZHUANG | 132/192（68.8%） | 132/192（68.8%） | 186/192（96.9%） |
| BL | 333/387（86.0%） | 333/387（86.0%） | 380/387（98.2%） |
| Y | 110/172（64.0%） | 110/172（64.0%） | 110/172（64.0%） |
| **合計** | **1,554/1,962（79.2%）** | **1,554/1,962（79.2%）** | **1,683/1,962（85.8%）** |

## 5. 未處理邊界與風險

- fixture 無 cron claims，不能忠實產出修後 20 輪 `trip_dyn`；正式 cron replay／部署後影子
  數據仍是唯一能確認真實逐線提升的來源。本報告沒有把受控反事實當成正式站實績。
- 新版部署後的第一輪，舊狀態缺 `lastSeenEpoch`，會保守多留最多 180 秒；這是為避免冷啟動
  當輪 feed 空洞立刻誤收的有界代價。
- 安全閥 rebind 與既有目的地改變交棒仍直接刪舊 record；若日中 `trip_dyn` 遺失而走低頻
  `trtc_trip_bindings` fallback，舊列可能復活。這是既存冷啟動 tombstone 風險，本單未擴修。
- 180 秒沿用既有 §5.3「失聯 >3 分鐘」設計值；本 10 分鐘樣本觀察到正常反向再現最慢
  225 秒，但換向／目的地改變由既有即時交棒處理，不靠舊方向 binding 撐過整段靜默。
- listener、browser 與 R4 D1 round-trip 因本環境／本單 git 禁令未完成，須由主對話依上表
  原命令在可起服務、可建立隔離 worktree 的環境補跑。
