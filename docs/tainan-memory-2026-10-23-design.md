# 台南地下化後第一個週五（2026-10-23）對照重播：資料與建置設計

狀態：預覽版資料與驗收完成（2026-10-18）。定版班表與實測 10/24 下午才有，換定版的步驟見第 5 節。分支 `memory/tainan-1023`。頁面（畫面、預覽標示）另一條線，只讀第 6 節的 snapshot 欄位。

## 1. 範圍

- 新目錄 `memories/tainan-2026-10-23/`：地下化通車（10/17）後的第一個週五，與 10/16（地面最後一天，同為週五）對照。
- 範圍與選班同 10/16：大橋—臺南—保安一帶；大橋、臺南、保安任一站（停靠或通過）的時刻落在當天內。
- 這一版是**預覽版**：每班車每一站的到離站時刻都是臺鐵 ODS 預覽班表的表定值，沒有實測。沒有單線雙向、重點車與時間軸事項（地下化後不存在）。
- `memories/tainan-2026-09-12/`、`memories/tainan-2026-10-16/` 不動：兩者的 verify、封存雜湊與股道重疊檢查結果照舊。
- 本文只管資料與建置；頁面怎麼畫地下段與預覽標示不在範圍。

## 2. 資料來源與暫代項

| 項目 | 來源 | 狀態 |
|---|---|---|
| 10/23 班表 | 臺鐵 ODS 預覽版逐日檔 `20261023.json`（UpdateTime 2026-10-15 16:33:22，2026-10-17 01:31 手動下載；938 列次，230 列次經過臺南）→ `scripts/tainan_ods_to_dense.py` 轉成只含 10/23 的密化班表 | **暫代**，定版換掉 |
| 10/22 跨午夜尾段 | commit `0bc3cfae` 的 `data/tra_schedule_dense.json` 裡的 10/22（該日 ODS UpdateTime 2026-10-15 14:24:59） | **暫代**，只供 3297、3786 兩班跨午夜 |
| 車站資料 | ODS `stations.json`（245 站） | 定版重抓 |
| 地下化結構與高程剖面 | `memories/tainan-2026-10-23/underground/model.json`、`profile.json`（股道取自 commit `2cd16884` 的 `rail-3d/physical/network.json`） | 深度與尺寸是估計／示意（profile 標「估計」），不隨定版變 |
| 車種極速與編組 | 主站 `index.html` 的 `PERF_RULES`／`PERF_BY_TYPE`（build 凍結進 `timingSource.speedCaps`）、`data/tra_special_trains.json`、車輛目錄 `fleet/catalog.json` | 不隨定版變 |

- 原始檔存檔在 `.cache/tainan-1023-raw/`（不進版控）：`prelim-20261017/` 附 `SHA256SUMS` 與 `DOWNLOADED_AT`，`README.txt` 記存檔規則（不覆蓋，每次下載放新子資料夾）。
- 雜湊前 8 碼：`20261023.json` `97cbfd84`、`stations.json` `ff0f4633`、轉出的密化班表 `2bbfeb38`、`0bc3cfae` 的密化班表 `3e206490`；完整值在 `snapshot.sources`。

轉換與比對：

- 轉換器 `scripts/tainan_ods_to_dense.py`：解析重用 `fetch_tra_schedule.py` 的 `main()`、密化重用 `densify_schedule.py` 的 `main()`，在暫存目錄原樣執行，只把下載換成讀本機檔、把「今天」固定成營運日（不固定的話，同樣的輸入每天轉出不同的檔）。只寫 `--out`，不碰 `data/`；同樣輸入重跑兩次逐 byte 相同。
  `python3 -I -B scripts/tainan_ods_to_dense.py --date 2026-10-23 --ods <20261023.json> --stations <stations.json> --out <輸出.json> --downloaded-at "<DOWNLOADED_AT 的內容>"`
- 轉換結果 938 車次（只含 10/23），`fallback_segments=0`、`unmatched_names=0`；`source_notes` 開頭多一則【轉換】說明（含原始檔雜湊與下載時間）。轉換結果依賴 repo 的 `data/tra.json` 等三個路網檔，換了就要重轉。
- 對 `0bc3cfae` 的 10/23 密化班表逐項比對：車次集合相同（938＝938）；停靠站序列、通過站序列、stops 逐欄位（含 lat/lon/order）的差異都是 0。
- 唯一差異是 20 列次的車種標籤：`自強(3000親障)`→`自強(3000障)` 13 列、`自強(PP親)`→`自強(PP障)` 6 列、`110M`→`110K` 1 列。兩種寫法在 `resolvePerf` 命中同一條規則，`formationFor`／`assembleFormation` 配出的編組逐班相同（20/20；其中 12 班在本快照內），所以車種、極速上限與編組都不變。
- 兩份來源的 10/23 UpdateTime 同為 2026-10-15 16:33:22，內容卻有上列差異：UpdateTime 不能當「內容沒變」的證據。定版檔到手照樣重轉、重比（比對維度同上）。
- 暫代項在資料裡都有記號：`snapshot.preview`、`timingSource.scheduledTimeSource`，以及 `snapshot.sources`、`source-schedule.json` 的 `schedules[].temporary`。

## 3. 軌道面高程 z（`routes[i].z`、`rails[i].z`）

- 單位公尺，地面＝0，向上為正；與 `coordinates` 逐頂點對應；整條都是 0 的不寫 `z`。
- 規則（`profile.json` 的 `howToComputeZ`）：頂點落在 `model.json` 的 tunnel／station／trough 外框內（含邊上 0.02 m）時取 `z(d)`，框外是 0。`d` 是頂點投影到參考線（`reference.points` 折線，西側一股，全長 7754.493 m）的累計長度。
- `z(d)` 在控制點之間線性（沒有豎曲線）：d 0→0、166.006→0、791.095→−7、3511.091→−16、5002.96→−18、5693.96→−18、7285.582→−7、7585.299→0、7754.493→0。−7／−16／−18 是估計值，0 來自 OSM。最大坡度 23.355‰（北端 7285.582→7585.299）。
- 四股、引道兩股與隧道內兩條正線共用同一條參考線與同一個 `z(d)`；框內頂點離參考線最遠 15.66 m（臺南站一帶的外側股道）。
- 只放在原頂點，不補點：verify 要求 `routes` 與 `rails` 的頂點 7 位小數逐點相同。頁面在頂點之間線性內插 z，與真實剖面最大差 0.078 m（2124 段、21240 個取樣點，144 點在 0.05–0.1 m，其餘小於 0.05 m）。
- 外框邊緣的頂點 z 不一定是 0（絕對值最大 0.307 m）；回到地面的過渡由相鄰頂點的坡度檢查把關。
- routes 58 條全有 `z`；rails 43 條有 9 條有 `z`（OSM way 1102288952–955、1413211240／241、1413215949／950／952）。
- build（`zCheck`）：相鄰頂點的坡度不得超過 profile 上限加容差 0.05 m，否則中止。

## 4. 臺南站停靠點

- 問題：股道資料推定的臺南停靠點投影到參考線 d＝5221.33–5221.50，在 profile 的月台中央 `centerD`＝5348.46（月台 d 5198.46–5498.46，長 300 m）以南約 127 m；原樣畫，整列會停在月台南端外。
- 要求：停車時整列的**中心**在 `centerD`，整列落在月台範圍內。
- 做法（`build_tainan_memory.mjs` 的 `withTainanStop`，包住 `motion.sample`，不是事後平移停站位置）：
  - 路線在臺南站的邊界里程（`route.offsets[b]`）換成里程 N，使 d(N)＝`centerD`：取離原值最近的解，0.5 m 步長加二分法，搜尋 ±600 m；只有路段真的用到這個邊界時才換。報表 `underground.tainanStops` 記 24 條路線的移動量（絕對值 126.81–126.99 m）。
  - 到站前後兩段照同一個時間比例伸縮，位置對時間連續，沒有瞬移；停站期間位置不動。
  - 路徑變長的一段（北上進站 116 段、南下離站 112 段，各 +127 m）把 `physKm` 補成新路徑長並重算剖面（`tainanFit`，與 10/16 單線雙向改變路徑長度的做法相同），速度才不超過車種極速。報表 `underground.tainanFits` 逐段記錄。
- 里程到座標用頁面同一份 `vendor/train-path.js` 的 `makePath`（haversine 里程），不是平面距離（兩者差約千分之一，月台位置會差好幾公尺）。
- 驗證（`verify_tainan_memory_1023_data.mjs`，不信公式，用頁面的 `formationPoses` 實跑）：每班在臺南停車的每一秒——
  - 位置不動（±0.002 m）；整列中心的 d 與 `centerD` 相差 ≤ 1 m（實測最大 0.0005 m）；
  - 取樣點是整列中心；整列前後端的 d 在月台範圍內（實測 5205.4–5491.5）；
  - 編組長度＝車輛目錄各節 `pitchM` 加總（最長 285.84 m，班次 `10/23:281`，小於 300 m）。
- 連續性：相鄰兩秒位移 ≤ 車種極速；點速增加 ≤ 2.5 m/s²（實測最大 1.082）；點速減少超過 2.5 m/s² 只准發生在停靠站的到站那一秒。
- 既有的瞬停：8 班（`10/23:1038、110、114、124、137、154、162、178`）在臺南到站那一秒由行駛速度直接停住（最大 29.8 m/s）。這是既有物理模型對「前一站是通過站、時刻排得很緊」的班次的樣子：不移動停靠點的對照建置中，同一批 8 班也是在到站那一秒由行駛速度（1.5–31.2 m/s）停住，其中 6 班的掉幅超過 2.5 m/s²；移動停靠點後，`10/23:110`、`10/23:154` 的進站速度由 1.6、1.5 m/s 增為 2.8 m/s，才也超過。沒有修；班數釘在 `verify.underground.abruptArrivals`，數字變了要重看。

## 5. 換成定版資料的步驟

換定版的設定改動不改程式；但第 5 節末尾的程式面問題要先解決（預覽沒有實測，下列路徑都沒跑過）。

**抓資料**（存進 `.cache/tainan-1023-raw/` 的新子資料夾，每個子資料夾有 `SHA256SUMS`、`DOWNLOADED_AT`、`SUMMARY.json`）：

1. `node scripts/fetch_tainan_raw.mjs --date 2026-10-23 ods`：定版逐日檔、車站資料、清單頁。清單每天約 03:40 改版，舊檔之後回 HTTP 400，**10/24 約 03:40 之前要抓到**。
2. `… --date 2026-10-23 tdx`：TDX 歷史 LiveTrainDelay，約 10/24 釋出；結束碼 3＝還沒釋出。
3. `… --date 2026-10-23 d1 --wrangler <乾淨安裝的 wrangler>`：D1 `tra_station_events`，一次匯出 10/23 與 10/24 兩個 service_date。
4. 跨午夜尾段（10/22 的 3297、3786）需要 10/22 的資料：`--date 2026-10-22 ods`（10/23 約 03:40 之前）、`tdx`、`d1`。抓不到就維持 `0bc3cfae` 的 10/22 並保留 `temporary` 說明；這兩班午夜前沒有實測，缺實測的站由重建內插或照表定。
5. `tainan_actuals.py` 用 `gzip.open` 讀歷史檔，而 `fetch_tainan_raw.mjs` 存的是純 JSONL：把 TDX 檔轉成 `.cache/tra_hist/<日期>.jsonl.gz`（`gzip -n -c`，輸出可重現），10/22、10/23、10/24 各一份。

**轉班表**：用第 2 節的指令把定版 ODS 檔轉成密化班表（10/22 同樣各轉一份），重跑第 2 節的比對，差異逐項說明。

**設定**（`scripts/tainan_memory_config.mjs` 的 `'2026-10-23'`）：

- 刪 `preview` 整項（不是設 null）；`timing` 由 `'scheduled'` 改 `'observed'`。
- `schedules`：兩筆的 `cache`、`sha256` 換成定版轉出檔，刪 `temporary`；保留 `convertedFrom: 'ods'`（build 因此繼續把轉換用的三支腳本記進 `snapshot.sources`）。
- `actuals`：`stations` 換成定版 `ods-<時間>/stations.json`；`hist` 填 `tra_hist/2026-10-22…24.jsonl.gz`；`d1` 填 `d1-<時間>/d1-tra_station_events-<日期>.json`；`recordOnly` 換成定版 ODS 子資料夾的 `20261023.json`、`SHA256SUMS`、`DOWNLOADED_AT` 與 `README.txt`；`calibration` 填 `tainan-1016-work/backtest-2026-09-12.json`（重建演算法沒變，同 10/16；檔案在主樹的 `.cache/`）。
- `defaultSec` 重挑：開頁那一秒畫面內有車、至少一班在地下、臺南月台有停車，前後 30 秒不在 `uncertainty.json` 的時段內。預覽的 30420（08:27:00）是用預覽班表挑的，定版時刻會變。`defaultSec` 屬產生資料的欄位，改了要重建。
- `verify`：`trains`、`overnight`、`directions`、`uncertaintyIntervals`、`underground.{tainanStops, offscreenStops, trainsUnderground, abruptArrivals, defaultScene}` 照新 build 的報表與 verify 輸出更新；實測模式另需 `anchorToleranceSec`（10/16 是 60）。
- 主站入口：重播頁確認後在 `index.html` 加入口，再把 `verify.entry` 由 `null` 改成 `{id, cl}`（`verify` 欄位不影響快照雜湊）。
- `selection`、`underground`、`ambiguity` 不動。

**重建**（`TAINAN_CACHE_DIR` 指到放 `.cache/` 內容的資料夾；每步的離開碼存進變數）：

```
node scripts/build_tainan_memory.mjs --date 2026-10-23 --export-run-floor
python3 -I -B scripts/tainan_actuals.py --date 2026-10-23
node scripts/build_tainan_memory.mjs --date 2026-10-23 --replace-local-snapshot
node scripts/build_tainan_track_ambiguities.mjs --date 2026-10-23
node scripts/verify_tainan_memory.mjs --date 2026-10-23 --data-only
```

- 輸出目錄沒有 `snapshot.json` 時，build 不帶 `--replace-local-snapshot`；有 `integrity.json`（封存後）一律拒絕重建。
- 同樣的指令跑兩遍，`snapshot.json`、`source-schedule.json`、`source-observations.json`、`uncertainty.json` 要逐 byte 相同。
- 封存用 `scripts/seal_tainan_memory.mjs --date 2026-10-23 --seal-reviewed-snapshot`，由接手者在驗收後執行。

**程式面問題**（定版 observed 路徑要先解決）：

1. `build_tainan_memory.mjs` 的「範圍內同一車次出現兩次」檢查：預覽只放行兩份定義逐項相同的。定版 observed 下，3297、3786 在 10/22 尾段與 10/23 頭段是兩次不同的重建，passObs 與自訂計畫以車次為鍵會互蓋，build 會直接停。要把鍵改成營運日加車次，或只留一份。
2. `verify_tainan_memory.mjs` 的 `checkObserved()`（`timing` 為 `observed` 時呼叫）假設 10/16 的結構：`cfg.singleLine`、`cfg.marks`、`verify.markedTrains`、`cfg.officialEvents`／`observedEvents`、`uncertainty.json` 每段都有 `reason`。10/23 沒有這些。要把前半（timingSource、逐站時刻、原始列、實測精度）和 10/16 專屬的後半（重點車、單線雙向、時間軸、股道占用）拆開。
3. `build_tainan_track_ambiguities.mjs` 在沒有 `singleLine` 的日期輸出的時段沒有 `reason`（頁面端用 `i.reason||'track-overlap'` 處理）。第 2 點的後半若仍要檢查 `reason`，只為 10/23 補，不要動 9/12 的輸出（`--check` 會紅）。
4. 實測模式的剖面走 `buildObsProfile`；臺南停靠點的移動與 `tainanFit` 只在預覽（全表定）資料上驗過，換定版後要重驗 `knotCheck` 與點速檢查。
5. 預覽才有的欄位消失是預期的：頂層 `preview`、`timingSource.scheduledTimeSource`。`timingSource.primary` 變 `tdx-historical` 或 `d1`，`calibration` 有值。頁面不要寫死預覽欄位。

## 6. snapshot 新欄位（給頁面用）

| 欄位 | 內容 | 預覽→定版 |
|---|---|---|
| `preview` | `{kind: 'ods-preview', reason}`；有這個欄位＝整份資料沒有實測，頁面要顯示預覽標示，`reason` 是來源說明 | 欄位消失 |
| `timingSource.scheduledTimeSource` | `{kind, reason, schedules: [{serviceDate, file, commit, sha256, temporary}]}`，表定時刻的來源檔 | 欄位消失 |
| `timingSource` 其他 | `primary: 'scheduled'`、`calibration: null`、`histRows`／`d1Rows` 為 0 | 變實測值 |
| `underground.model`、`underground.profile` | `{file, sha256}`，檔案相對於資料夾（`underground/model.json`、`underground/profile.json`） | 不變 |
| `underground.platform` | `{centerD, d0, d1, lengthM}`＝`{5348.46, 5198.46, 5498.46, 300}`；`d` 是投影到參考線的累計長度（公尺） | 不變 |
| `underground.maxAbsSlopePermille` | 23.355 | 不變 |
| `underground.elevation` | `z` 的說明：`field`、`unit`、`datum`、`appliesTo`、`rule` | 不變 |
| `underground.stop` | `{station: '臺南', point: 'formation-center', centerD, rule}`：臺南站停車時整列中心在 `centerD` | 不變 |
| `routes[i].z`、`rails[i].z` | 第 3 節 | 不變 |
| `defaultSec` | 30420（08:27:00）：畫面內 4 班全在地下（北上 2、南下 2），其中 3 班同時停在臺南月台，另 1 班在月台以南的隧道裡；前後 30 秒也各有 4 班在地下，且不在不確定時段內 | 重挑 |
| `sources[]` | 新增 underground 的 model／profile、兩份班表（含 `temporary`）、轉換用的三支腳本、中間檔與原始檔的雜湊 | 隨設定 |

- 沒有 `singleLine`；`events` 是空陣列；`trains[i]` 沒有 `mark`。
- 每班車 `timing` 是 `'scheduled'`，每站 `src` 是 `'sched'`、`holdSec` 是 0；臺南站的 `arrSec`／`depSec` 是表定時刻，位置在月台中央（第 4 節）。
- `uncertainty.json`：4 段（09:54:18–09:57:32、17:08:20–17:08:33、17:15:36–17:16:27、21:04:59–21:05:43），每段的欄位是 `start`、`end`、`trains`、`trainNos`，沒有 `reason`（10/16 的有）。
- 預覽數字：選班 232 班（北上 117、南下 115），其中 2 班是 10/22 跨午夜的尾段（3297、3786）；232 班都停臺南，畫面內 230 班（北上 116、南下 114），另 2 班（`10/23:3297`、`10/23:3786`）停臺南時已過午夜；232 班都穿過地下段。routes 58、rails 43、取樣 170,983 點。

## 7. 驗收

| 項目 | 指令與結果 |
|---|---|
| 建置兩遍 | export-run-floor → `tainan_actuals.py` → build → ambiguities（第二遍 build 帶 `--replace-local-snapshot`）：離開碼全 0；`snapshot.json`、`source-schedule.json`、`source-observations.json`、`uncertainty.json` 與兩個中間檔逐 byte 相同 |
| 資料驗收 | `node scripts/verify_tainan_memory.mjs --date 2026-10-23 --data-only`：離開碼 0 |
| 9/12、10/16 不變 | 兩日各跑 verify、`verify --data-only`、ambiguities `--check`、seal `--check`（共 8 條）：改動前後離開碼皆 0、輸出逐 byte 相同 |
| 快照過期偵測 | 改設定的產生欄位（例如 `defaultSec`）而不重建：verify 紅在「設定欄位雜湊與目前的設定檔不符」；還原後回綠 |

`verify_tainan_memory_1023_data.mjs` 由 `verify_tainan_memory.mjs` 在設定有 `underground` 時呼叫；訊息一律以「地下化：」開頭。判準與被驗的 build 各算各的：z、框內判斷、月台位置都照 `profile.json` 在驗收端再實作一次，不引用 build 的函式。

突變測試（對快照副本做，用 `--dir`；每項必須紅在對的那一條，乾淨副本前後各跑一次當控制組，都必須綠）：

| 突變 | 應紅的判準 |
|---|---|
| 臺南停靠點整段 +5 m（單段車次） | 臺南停靠點不在月台中央 |
| 只把停站秒的里程 +5 m（事後平移停站位置） | 里程不能倒退（既有檢查） |
| 到站前一秒起之後的里程 +5 m（銜接一致，進站多跳 5 m） | 點速突然增加 |
| 第 30 秒起整段 +8 m（未超過極速） | 點速突然增加 |
| 第 30 秒起整段 +60 m | 位置跳點（超過極速） |
| 對照建置：不移動停靠點（連續，停在股道資料推定的位置） | 臺南停靠點不在月台中央（差約 127 m） |
| 67 條 `z` 全歸零 | `z` 全是 0，應省略 |
| 刪掉 67 條 `z` | 框內頂點卻沒有 `z` |
| 一個頂點 `z` +3 m（尖刺） | 坡度超過上限 |
| 站體深度的 5 個頂點 `z` +0.3 m（整體偏移，無尖刺） | 與獨立重算差 0.3 m |
| 刪 `snapshot.preview` | `preview` 與設定不同 |
| `underground.model.sha256` 改全 0 | 雜湊與檔案不符 |
| `sources` 的設定欄位雜湊改全 0 | 設定欄位雜湊不符 |
| `defaultSec` 改成別的值 | `defaultSec` 與設定不同 |
| 拿掉涵蓋開頁那一秒的一班車的路段 | 開頁畫面的班數不符 |
| 南下、北上各一班只留第 1 段且臺南改通過 | 穿過地下段的班數少 1 |
| 一班瞬停班進站前一秒 +0.5 m（不再瞬停） | 瞬停班數應為 8，實為 7 |
| 一班瞬停班的臺南 `arrSec` 提早 1 秒 | 點速突然減少，而且不是到站那一秒 |

## 8. 已知限制

- 預覽時刻全是表定：沒有誤點、待避、越行；到離站時刻不是實際運行紀錄。
- 地下段的深度、車站與隧道尺寸是估計／示意；臺南的停靠位置是月台中央的推演，不是實測。
- 8 班在臺南到站那一秒瞬停（第 4 節）；定版時刻不同，班數會變。
- 10/22 尾段與 10/23 頭段的 3297、3786 共用同一組定義，預覽放行；定版會碰到第 5 節第 1 點。
- 4 段不確定時段只標股道重疊；沒有單線雙向。
- 本文的驗證只涵蓋資料與建置；頁面渲染、瀏覽器行為、實測模式都沒有驗。
