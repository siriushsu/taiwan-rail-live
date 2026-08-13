# 北捷官方即時名冊與 Y 線身分穩定性稽核（2026-08-13）

## 1. 第零步能力自檢

本單開工時實際呼叫兩個端點，不是以過去經驗推定：

- `curl -sL -H 'Cache-Control: no-cache' https://railisland.tw/api/trtc-live -o /tmp/probe_live.json`：
  HTTP payload 可解析，`src="trtc"`，`boardPos.at=1786608809`，`boardPos.rows=136`，
  回應產生時間 `2026-08-13T08:13:40.254Z`。
- `arch -arm64 node /Users/xuxiang/Code/捷運小動畫/node_modules/wrangler/bin/wrangler.js d1 execute
  railisland-trtc-ledger --remote --json --command "SELECT k FROM trtc_state WHERE k='trip_dyn'"`：
  成功 200，原始 result 為 `[{k:"trip_dyn"}]`；`served_by=v3-prod`、`region=APAC`、
  `colo=ICN`、`sql_duration_ms=0.1164`、`rows_read=1`、`rows_written=0`。

## 2. 尖峰語料驗收

`tmp/binder-fixtures/rounds-peak/` 實際覆蓋
`2026-08-13 16:15:30–16:55:01 +08:00`：80/80 輪、240/240 個三件組檔可解析；
79 個間隔 min/p50/max = `30/30/31s`，`>45s=0`；`dyn.at` 有41個相異值，
可觀察40次 cron transition。逐輪 `boardPos.rows=129–164`；Y active binding=10–14
（dir1=4–7、dir2=5–8）。樣本 Z 以80輪完整語料通過；縮為前3輪時，
輪數、`dyn.at`、九條具名線的 eligible rows 與 true updates 共20項全部不足而轉紅。

尖峰官方 collapsed rows 共 11,669列，九條線、十八個方向都有樣本。
實測 feed 結構亦逐線驗出：七條一般線的14個方向都有起點停站列、
都有倒數第二段，但最後一段全部為0；`G_XBT/R_XBT` 四方向共320列全為停站列，
moving row=0。

## 3. 身分不穩的原因與兩批數字

### 3.1 Y dir1 的 1,848 秒

| 語料 | 方向 | active observations | `lastShift` min / p10 / p50 / p90 / max | 最近班表槽相對綁定槽 |
|---|---|---:|---:|---|
| 午間 | dir1 | 42 | 1,361 / 1,440.1 / **1,848.5** / 2,299.1 / 2,317s | +3:8、+4:27、+5:7 |
| 尖峰 | dir1 | 218 | 822 / 1,093.3 / **1,761** / 1,949 / 2,596s | +2:23、+3:66、+4:123、+5:2、+6:4 |
| 午間 | dir2 | 63 | -379 / -300 / 87 / 989 / 1,000s | -1..+2 共63/63 |
| 尖峰 | dir2 | 257 | -315 / -230.4 / 160 / 623 / 2,051s | -1..+2 共250/257 |

dir1 不是少數 outlier：午間42/42、尖峰218/218都綁到實際相位之前2–6班，
其最近班表槽殘差尖峰 p50=51.5s。方向映射本身沒有顛倒；錯的是舊 binder
把 dir1 整組身分綁在過早2–6班的班表槽。

程式機制與此一致：無號 claim 的 synth ID 含站點與分鐘，跨站／跨分鐘必然碎裂；
reclaim 只比較「新 shift 相對舊 `lastShift`≤180s」，認回後保留舊 `tripKey/boundEpoch`、
改寫 `trackId/lastShift`並把 `badStreak` 歸零，且不再套用出生的絕對 shift cap。
這是可以逐輪向前棘輪、又累積不了安全閥的完整原因鏈。

### 3.2 同一 `tripKey` 換 `trackId`

| 語料 | 保留的 trip 對 | 換 `trackId` | 可快照確證 reclaim | done→rebirth | 無兩 pass 中間態、只能列 fresh replacement |
|---|---:|---:|---:|---:|---:|
| 午間 | 93 | 43 | 42 | 0 | 1 |
| 尖峰 | 454 | 165 | 163 | 0 | 2 |

尖峰 reclaim 案例：`2026-08-13 16:15:59 +08:00`，
`0@55922>13@58209`，track 由 `...:10:29776767` 換為 `...:10:29776752`，
shift `556→614`，boundEpoch 同為 `1786606557`。無中間態案例：
`16:21:59`，`0@58202>13@60489`，track `...:1:29776373→...:2:29776688`，
shift `964→39`，boundEpoch `1786608628→1786609274`，old badStreak=3。該案結構上支持
safety replacement，但語料無 raw pass1/pass2 claims/events，故不冒充確定出口。

### 3.3 舊班表名冊診斷與 ref proxy

依後續「官方即時優先」裁示，班表已不是名冊真值；下列只診斷舊 binder
錯槽的幅度，不作驗收 gate。午間 dir1 expected/active=55/42，missing/extra=43/30；
dir2=55/63，missing/extra=3/11。尖峰 dir1=205/218，missing/extra=106/119；
dir2=247/257，missing/extra=30/40。

ref 仍只能做 survivor proxy：午間Y可見 birth 4，`N≤2` 為3/4，counts=`1,2,2,4`；
尖峰13筆，`N≤2` 為6/13，counts=`1,1,2,2,2,2,3,3,3,4,4,4,5`，且 dir1
為4/5稀疏。BR對照午間0/5、尖峰0/19。runtime 未落盤 `refCount/ref/cost`，
故這是特異嫌疑訊號，不宣稱認車正確率或精確 runtime ref。

## 4. 第二步之二：前三單遺留項

### 4.1 冷啟動 tombstone 復活

午間11個狀態快照可觀察下限3列（BR 2、Y 1）從權威 `trip_dyn` 消失，
舊關係表 fallback 會把3/3重建為 active。修正後：

- 目的地不符與安全閥驅逐都產生可持久化 `evict` event；關係表依最終狀態
  physical DELETE，同輪先 evict 後同 key 重生則 final state 勝出。
- 部署前已留下、沒有新 event 的 zombie 以當日 `trip_dyn` 全量對帳刪除；
  866 個 final rows 只寫差異，觀察到的3個 zombie 精確刪3個。
- D1 大批寫每批不超過80句；本 fixture 用13批
  `[1,80,80,80,80,80,80,80,80,80,80,69,2]`，marker 只在最後恢復。
  首次移轉或 marker 已存在的日內大寫於第3批人工中斷時，marker/trip_dyn 均不被誤信，
  fallback 為 `legacy-untrusted`、bindings=0。

### 4.2 分母無聲縮水

三支舊驗收都會被縮水語料穿過：

- `verify_binder_done`：3輪/2個 `dyn.at`/304 eligible 原本 PASS。
- `verify_join_parity`：3輪時 A=249、B=72次洗牌、C=249 outputs 仍 PASS。
- `verify_binder_join_window`：題面16輪縮成3輪、20輪縮成2輪仍 PASS。

三支均已加完整輪數、11個 `dyn.at`、逐具名線 eligible 與 true-update 下限；
各自 M-Z 縮成3輪後全紅。新 identity verifier 亦仨用尖峰80輪同樣驗出20項 shortfall。

### 4.3 motion round2 可重現基準

`verify_trtc_motion_round2.mjs` 不再依賴已刪除的外部 worktree；改由 repo 內
`git show bf2dd6f^:index.html` 讀固定基準，輸出改到 gitignored
`tmp/CODEX-北捷運動-第二輪.json`。本環境實跑到開 listener 時仍因
`listen EPERM 127.0.0.1:6420` 中止，故不宣稱浏覽器段通過。

### 4.4 舊 C/D/E 翻面

舊 binder 身分唯一性基線：尖峰41快照、5,133 active samples，重複 track/trip=0/0；
午間11快照、1,170 samples，亦為0/0。但舊「active binding 必須等於班表名冊」E已被使用者
明確作廢，不再把 missing/extra 寫成錯誤。新 E 為「官方 fresh 時名冊 = collapsed rows +
可逐筆列舉的末段 extension」，見下節。

## 5. 修法與理由

根因診斷並不支持在舊 binder 上再加一種猜法。本單依最新設計裁示把「存在性」
與「班次標籤」拆開，並套給北捷全線：

1. `collapseClaims()` 的每一列就是本輪必須顯示的一台官方車；不讀班表、
   `tripKey`、shift 或45秒窗來決定車是否存在。
2. 有號車以官方 no 當硬 alias；無號車以同線/同向/同終點的 canonical 保序一對一
   roster slot 延續 opaque `vehicleId`。無法外部證成車廂真身時不假裝證成，
   但也不丟官方列；未配 current 當輪立即 birth，一般未配 prior 當輪退出，無 ghost coasting。
3. 一般線只有一個例外：車從最後可見區間消失、且該 `vehicleId` 已有自己相鄰兩次
   官方 arrival epoch，才以這台車自己前一段秒數補唯一最後一段；無自身證據就不補。
   `G_XBT/R_XBT` 沒有任何 moving 證據，故絕對不套通則，只在官方回報端點停著，
   官方列消失即退場；同端點預報 rollover 時才換 occurrence ID。
4. Worker 保留 `TrackInfo` 成功（含合法空列）與失敗的差別；`feedMode=official`
   時不混班表，`outage` 時整包回空官方名冊，交由前端整體切 schedule fallback。
   CarWeight 只是 legacy/擁擠度裝飾，雙空不會再拖垮 TrackInfo 名冊。
5. `official_roster_v1` 以 D1 單列 optimistic CAS 延續跨 isolate `vehicleId`；相同 revision
   仍以完整 canonical frame key 區分內容，只有「同 revision、同 frame、同 acquisition order」才零寫；
   較晚觀測的同 frame 會更新 freshness barrier，同秒內容改變及 nonempty→合法空列都會更新，
   舊 revision 不回退，CAS 競爭有限4次重試。D1 不可用時仍保留全部 rows，
   但明列 `deterministic-read-only/degraded`。
6. 舊 `joinBoardRowsToTrips()` 只剩「唯一對得上時加 `tripKey`」的選配裝飾；
   miss/並列/損壞只少標籤，不少車。

尖峰80輪重播結果：11,669/11,669 collapsed rows 全保留；每輪
`vehicles = rows + extensions` 的80/80輪全通過，extension observations=283、單輪最多7、
own-span 最大256秒；
rows 逆序80/80輪輸出差異0；跨輪共同身分保序對53,317、inversion=0；
XBT extension=0。合成結構判準20/20通過，9/9 core mutations 只在事先列出的子項轉紅；
Worker 行為判準25/25及12/12各自獨立 wiring mutations通過；上游 acquisition order
在發 request 前以毫秒記錄，遲到的舊 request 不因慢回而覆蓋較晚開始的 frame。

## 6. Z、A–G 實測數字

| 判準 | 舊基線 | 修後／新判準 | 結果 |
|---|---:|---:|---|
| Z 樣本 | 3輪可穿過三支舊 verifier | 80輪/240檔/41 dyn；3輪 M-Z 在 identity 紅20項不足 | PASS |
| A 診斷 | 午間 Y 變更43次，dir1 p50=1,848.5s | 尖峰變更165/454（163 reclaim），dir1 218/218早2–6班 | PASS（診斷閉合） |
| B 顯示覆蓋 | 尖峰 trip 標籤 8,148/11,669=69.8%；Y 513/895=57.3% | official roster rows 11,669/11,669=100%；trip 標籤仍選配 | PASS（shadow API） |
| C 身分唯一 | 舊 binder 尖峰5,133 samples，duplicate track/trip=0/0 | 新 roster 80輪 duplicate `vehicleId`=0；duplicate rows 仍一列一 ID | PASS |
| D 保序 | 舊 schedule diagnostic 尖峰359對中8 inversion（不作新 gate） | 新 official roster 跨輪53,317對、0 inversion | PASS |
| E 名冊 | 舊強制等於班表，已作廢 | 80/80輪精確等於 rows+extensions；丟 current/ghost/XBT motion mutation 均紅 | PASS |
| F 全線控制 | 只處理 Y 會違反新裁示 | 9線、18方向、11,669 rows 全量通過；BR 2,946、其他線8,723 | PASS |
| G 零回歸 | 見下表 | 可離線完整執行者全綠；listener/browser/R4 明列阻擋 | 部分環境阻擋 |

尖峰逐線官方 rows（修後名冊各保留100%）：`BL 1,960`、`BR 2,946`、
`G 1,265`、`G_XBT 160`、`O_LUZHOU 921`、`O_XINZHUANG 1,116`、`R 2,246`、
`R_XBT 160`、`Y 895`。新 opaque roster 在首輪之後的延續/新出生觀察分別為：
BL `1883/54`、BR `2818/98`、G `1202/50`、G_XBT `153/5`、O_LUZHOU `871/39`、
O_XINZHUANG `1055/47`、R `2134/84`、R_XBT `150/8`、Y `825/59`。
這是 roster slot 連續性，不是實體車認車正確率。

| 命令 | 結果 |
|---|---|
| `node scripts/verify_trtc_official_roster.mjs` | exit 0；20/20、9/9 mutations、80輪11,669 rows、末段 own-span max 256s |
| `node scripts/verify_trtc_official_worker.mjs` | exit 0；25/25行為判準、12/12獨立 wiring mutations，含實際空列 revision／同 revision 改列、遲到 frame、同毫秒 deterministic rank與 freshness barrier／nonempty→empty／匿名跨 isolate／日切／同 snapshot join |
| `node scripts/verify_binder_identity.mjs` | exit 0；Z/A/C/tombstone 與 mutations PASS |
| `node scripts/verify_binder_done.mjs` | exit 0；20輪/11 dyn，guard join 1,554→1,683，mutations PASS |
| `node scripts/verify_join_parity.mjs` | exit 0；17/17 parity，480次洗牌diff=0，duplicate=0/0 |
| `node scripts/verify_binder_join_window.mjs` | exit 0；20輪1,962 eligible，乙判定與 mutations PASS |
| `node scripts/verify_trip_binding.mjs` | exit 1；核心判準綠；內嵌 board listener `EPERM 127.0.0.1:43187`，R4 內建 `git worktree add` 被 `Operation not permitted` 拒絕，未產生 worktree |
| `node scripts/verify_board_ledger.mjs` | exit 1；listener 前判準綠；`listen EPERM 127.0.0.1:43187` |
| `node scripts/verify_trtc_ontime.mjs` | exit 1；靜態9項綠；`listen EPERM 127.0.0.1:6740` |
| `node scripts/verify_trtc_direct_board.mjs` | exit 1；瀏覽器前判準綠；Chromium MachPort `Permission denied (1100)`/SIGTRAP |
| `node scripts/verify_trtc_motion_round2.mjs` | exit 1；`listen EPERM 127.0.0.1:6420` |
| `node --check worker.js` / `git diff --check` | exit 0 / exit 0 |

## 7. 未處理邊界與風險

- **畫面還沒有切換。** 本單明禁修改 `index.html`；現行前端仍只迭代 `_tt`，
  車輛生命窗、繪圖、車數、hit-test、跟隨與看板點選仍依賴班表/trip。
  因此本報告只宣稱 core + Worker shadow payload 已完成，不宣稱正式畫面已修好。
- 現行前端 `trtcBuildEndpointMotion` 會以速度 cap 把高需求軌跡的 `endSec`
  延後，並改寫 handoff/visualShift；這與「官方 `arrEpoch` 是不可移動 deadline」不相容。
  前端整合單必須同時修，並驗雙方向在 `arrEpoch` 精確到站。
- Y/BR 沒有官方車號；新 ID 是決定性 ordered roster slot，只證「不丟列、不重複、
  不依賴輸入順序」，不證實體車廂真身。轉折、短時重見與線網異常仍需正式影子期觀測。
- 通用末段 extension 僅在該車有兩個相鄰官方 arrival epoch、且 own-span `1–600s` 時生成；
  cold start 恰落最後可見段或 span 可疑時寧可不補。匿名 row 在 extension 期間重現，只有
  ETA 與最後官方預報相差 `≤30s` 才收回原 ordered slot；`>30s` 會保留尚未到點的舊 extension
  並將 current row 當新 slot，這是避免吞掉下一班的 fail-closed 取捨，不宣稱外部可驗的車廂真身。
- freshness barrier 使跨 PoP 的同 revision／同 frame 較晚觀測也會更新 D1；這避免遲到異 frame
  復活舊車，但相較「同 frame 一律零寫」會增加低頻熱點與寫入量，部署前需觀察 D1 配額。
- `feedMode=official` 目前以 TrackInfo HTTP/parse 成功判定，尚未對 `NowDateTime` 最大值做 age gate；
  若上游不是報錯，而是以 HTTP 200 重播凍結陣列，仍會被視為 official。現有語料未證實這種
  outage 形狀，故本單不憑空訂 stale 秒數；shadow 期需監測 `sourceRevision` 是否停止前進後再定門檻。
- XBT 現在只能誠實顯示官方回報的端點停車，不會有站間動畫。若要動畫，
  必須另外授權一個標成 inferred 的非官方行駛時間來源；本單沒有偷用班表。
- `official_roster_v1` 在 D1 不可用時退成 read-only ID；列不會丟，但跨 revision
  的全局 ID 延續不再由共享寫入保證，必須用 `degraded` 監測。
- listener、Chromium/WebKit、R4 D1 實際 round-trip 的完整驗收本環境無法完成；
  部署前須在可啟 listener/browser 且允許隔離 worktree 的主對話補跑。
