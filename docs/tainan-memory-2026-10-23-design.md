# 台南地下化後第一個週五（2026-10-23）對照重播：資料與建置設計

狀態：預覽版資料與驗收完成（2026-10-18）。定版班表與實測 10/24 下午才有，換定版的步驟見第 5 節。分支 `memory/tainan-1023`。頁面（畫面、預覽標示）只讀第 6 節的 snapshot 欄位。

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
- 這份預覽快照是分支併入 main `6b6d9961` 之後重建的：`snapshot.sources` 與 `timingSource.speedCaps.indexSha256` 裡主站 `index.html`、`scripts/fetch_tra_schedule.py`、`scripts/build_tainan_memory.mjs`、物理下限檔、實測檔的雜湊是併入後的版本，與併入前的快照相比只有這幾處雜湊不同（做法見第 5 節「主站輸入變動時」）。

轉換與比對：

- 轉換器 `scripts/tainan_ods_to_dense.py`：解析重用 `fetch_tra_schedule.py` 的 `main()`、密化重用 `densify_schedule.py` 的 `main()`，在暫存目錄原樣執行，只把下載換成讀本機檔、把「今天」固定成營運日（不固定的話，同樣的輸入每天轉出不同的檔）。只寫 `--out`，不碰 `data/`；同樣輸入重跑兩次逐 byte 相同。
  `python3 -I -B scripts/tainan_ods_to_dense.py --date 2026-10-23 --ods <子資料夾>/20261023.json --stations <子資料夾>/stations.json --out <輸出.json> --downloaded-at "$(sed 's/^downloaded //' <子資料夾>/DOWNLOADED_AT)"`
- 轉換器的輸入在快取根目錄（repo 根目錄的 `.cache/`，或 `TAINAN_CACHE_DIR`）底下 `tainan-1023-raw/` 的子資料夾（預覽是 `prelim-20261017/`），每個子資料夾有 `SHA256SUMS`。`DOWNLOADED_AT` 的內容是 `downloaded 2026-10-17 01:31:01 +0800`，開頭的 `downloaded ` 要用 `sed` 去掉再傳入：整段原樣傳入的話，下載時間字串不同，轉出檔的雜湊是 `c145bc8c…`，不是設定檔記的 `2bbfeb38…`。
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

預覽的 `memories/tainan-2026-10-23/integrity.json` 是預覽版的封存。它存在時，`build_tainan_memory.mjs` 一律拒絕重建（輸出資料夾已有 `integrity.json` 就丟錯），所以重建前先刪掉它，驗收通過後再重新封存。刪掉之後頁面載入時比對不到資料檔的雜湊，載不起來；要在瀏覽器驗收，先用 `--seal-reviewed-snapshot` 暫時封一次，之後資料夾裡若又有任何檔案變動，最後要再封一次。

換定版的設定改動不改程式；但第 5 節末尾的程式面問題要先解決（預覽沒有實測，下列路徑都沒跑過）。

**抓資料**（存進 `.cache/tainan-1023-raw/` 的新子資料夾，每個子資料夾有 `SHA256SUMS`、`DOWNLOADED_AT`、`SUMMARY.json`）：

1. `node scripts/fetch_tainan_raw.mjs --date 2026-10-23 ods`：定版逐日檔、車站資料、清單頁。清單每天約 03:40 改版，舊檔之後回 HTTP 400，**10/24 約 03:40 之前要抓到**。
2. `… --date 2026-10-23 tdx`：TDX 歷史 LiveTrainDelay，約 10/24 釋出；結束碼 3＝還沒釋出。
3. `… --date 2026-10-23 d1 --wrangler <乾淨安裝的 wrangler>`：D1 `tra_station_events`，一次匯出 10/23 與 10/24 兩個 service_date。
4. 跨午夜尾段（10/22 的 3297、3786）需要 10/22 的資料：`--date 2026-10-22 ods`（10/23 約 03:40 之前）、`tdx`、`d1`。沒帶 `--out` 時存進主樹的 `.cache/tainan-1022-raw/`（`fetch_tainan_raw.mjs` 第 25–26 行：主樹由 git common dir 推得，資料夾名依日期），跟 10/23 的分開；在 worktree 裡跑也一樣寫主樹。抓不到就維持 `0bc3cfae` 的 10/22 並保留 `temporary` 說明；這兩班午夜前沒有實測，缺實測的站由重建內插或照表定。
5. `tainan_actuals.py` 用 `gzip.open` 讀歷史檔，而 `fetch_tainan_raw.mjs` 存的是純 JSONL：把 TDX 檔轉成 `.cache/tra_hist/<日期>.jsonl.gz`（`gzip -n -c`，輸出可重現）。TDX 歷史檔按臺北時間的日曆日收錄（10/17 那份從 00:00:11 到 23:59:59），所以只要 10/22、10/23 兩份：10/23 那份涵蓋整個重播窗，10/22 那份給 3297、3786 午夜前的錨點。10/24 那份不在重播窗內，不列。開頭的 BOM 由 `utf-8-sig` 處理，不用先去掉。

**轉班表**：用第 2 節的指令把定版 ODS 檔轉成密化班表（10/22 同樣各轉一份），`--out` 寫到快取根目錄的 `tainan-1023-work/inputs/`、換新檔名，不要覆蓋預覽的轉出檔；重跑第 2 節的比對，差異逐項說明。

**設定**（`scripts/tainan_memory_config.mjs` 的 `'2026-10-23'`）：

- 刪 `preview` 整項（不是設 null）；`timing` 由 `'scheduled'` 改 `'observed'`。
- `note` 現在是預覽專屬的句子（頁面不顯示，但寫進快照），改成實測版。草稿（比照 10/16；不回報的站照 10/23 的實測資料確認後再填）：「依 TDX 即時動態的逐站紀錄推算 2026-10-23 的到離站時刻（到站誤差約半分鐘；大橋、仁德站不回報，時間為內插），不是 GPS 軌跡；股道位置是推演。南下與北上列車依地下化後的線形行駛，臺南站停靠位置在月台中央；地下段高程、車站與隧道尺寸為示意。編組依車種推估。道路與輪廓為 OSM 資料，背景高度簡化；範圍為大橋至保安周邊，非工程計畫邊界。」
- `schedules`：兩筆的 `cache`、`sha256` 換成定版轉出檔，刪 `temporary`；保留 `convertedFrom: 'ods'`（build 因此繼續把轉換用的三支腳本記進 `snapshot.sources`）。
- `actuals`：`stations` 換成定版 `ods-<時間>/stations.json`；`hist` 填 `tra_hist/2026-10-22.jsonl.gz`、`tra_hist/2026-10-23.jsonl.gz` 兩份（抓資料第 5 點）；`d1` 填 `d1-<時間>/d1-tra_station_events-<日期>.json` 三份：10/22 取 `tainan-1022-raw` 那次匯出、10/23 與 10/24 取 `tainan-1023-raw` 那次（10/23 兩次都有時用 `tainan-1023-raw` 的，比照 10/16 列前一日、當日、次日）。列了、磁碟上卻沒有的檔，`tainan_actuals.py` 會停下來列出缺哪幾個（第 623–628 行）；真的沒有就從設定拿掉那一項。第 2 步跑完仍核對實測檔（`actuals.out`）的 `histFilesUsed` 與 `inputs`；`recordOnly` 的 `20261023.json`、`SHA256SUMS`、`DOWNLOADED_AT` 換成定版 ODS 子資料夾的那三份，`README.txt` 維持根目錄那份（`tainan-1023-raw/README.txt`，存檔規則只有一份）；`recordOnly` 列了、磁碟上卻沒有的檔，build 會停下來；`calibration` 填 `tainan-1016-work/backtest-2026-09-12.json`（重建演算法沒變，同 10/16；檔案在快取根目錄）。
- `defaultSec` 重挑：開頁那一秒畫面內有車、至少一班在地下、臺南月台有停車，前後 30 秒不在 `uncertainty.json` 的時段內。預覽的 30420（08:27:00）是用預覽班表挑的，定版時刻會變。`defaultSec` 屬產生資料的欄位，改了要重建。
- `verify`：`trains`、`overnight`、`directions`、`uncertaintyIntervals`、`underground.{tainanStops, offscreenStops, trainsUnderground, abruptArrivals, defaultScene}` 照新 build 的報表與 verify 輸出更新；實測模式另需 `anchorToleranceSec`（10/16 是 60）。
- 主站入口：重播頁確認後在 `index.html` 加入口，再把 `verify.entry` 由 `null` 改成 `{id, cl}`（`verify` 欄位不影響快照雜湊）。
- `selection`、`underground`、`ambiguity` 不動。

**重建**（快取根目錄是 repo 根目錄的 `.cache/`，或 `TAINAN_CACHE_DIR` 指到的資料夾；在 worktree 裡沒設 `TAINAN_CACHE_DIR` 時是主樹的 `.cache/`。每步的離開碼存進變數）：

```
node scripts/build_tainan_memory.mjs --date 2026-10-23 --export-run-floor
python3 -I -B scripts/tainan_actuals.py --date 2026-10-23
node scripts/build_tainan_memory.mjs --date 2026-10-23 --replace-local-snapshot
node scripts/build_tainan_track_ambiguities.mjs --date 2026-10-23
node scripts/verify_tainan_memory.mjs --date 2026-10-23 --data-only
```

- 快取裡要先有設定 `schedules` 指到的兩份密化班表：build 照各筆的 `cache` 讀檔，雜湊和 `sha256` 不符就停（`班表雜湊不符`）。`0bc3cfae` 那份不在快取裡時，用 `git show 0bc3cfae:data/tra_schedule_dense.json > <快取根目錄>/tainan-1023-work/inputs/tra_schedule_dense_0bc3cfae.json` 取出；ODS 轉出的那份用第 2 節的指令轉，`--out` 寫成 `<快取根目錄>/` 加上設定裡的 `cache`。
- 輸出目錄沒有 `snapshot.json` 時，build 不帶 `--replace-local-snapshot`；有 `integrity.json`（封存後）一律拒絕重建。
- 同樣的指令跑兩遍，`snapshot.json`、`source-schedule.json`、`source-observations.json`、`uncertainty.json` 要逐 byte 相同。
- 在 worktree 裡設 `TAINAN_CACHE_DIR=<worktree>/.cache` 重建時，先在那個快取根目錄備好：`tainan-1022-raw`、`tainan-1023-raw` 兩個指回主樹 `.cache` 的連結（`ln -sn`，只讀）、`tra_hist/2026-10-22.jsonl.gz` 與 `2026-10-23.jsonl.gz`（抓資料第 5 點）、`tainan-1016-work/backtest-2026-09-12.json`（從主樹 `.cache` 複製）。
- 頁面驗收：`PORT=<埠> node scripts/verify_tainan_memory_1023_browser.mjs`。快照沒有 `preview` 時走實測模式的檢查：跟車卡全部班次逐列比時刻與標示（期望值從磁碟上的 `snapshot.json` 推）；關於視窗只出現實測段與實測來源行，車次清單等於 `timingSource.scheduledTrains`；「大橋與仁德兩站不回報」那句會對資料（這兩站在快照裡沒有任何實測、其餘各站至少一筆，約第 664 行）。若定版資料裡永康、臺南、保安有一站 0 筆，這項會紅，要改的是頁面那句與 `note`，不是檢查。`DIR`、`VURL` 可以把它指到別的資料夾或網址。
- 封存用 `scripts/seal_tainan_memory.mjs --date 2026-10-23 --seal-reviewed-snapshot`，驗收通過後封存；封存後跑一次 `--check`。

**主站輸入變動時**（例如分支併入新的 main）：

- 物理下限檔記了六個輸入的雜湊：兩份密化班表、`data/tra.json`、`data/tra_track_sections.json`、`data/tra_special_trains.json`、主站 `index.html`。任何一個變了，build 就停在「物理下限檔過期（… 已變）」。
- 10/23 的輸入本來就是地下化之後的，所以在目前的 `HEAD` 就能重建：重跑 `--export-run-floor` 與 `tainan_actuals.py`（上面重建指令的前兩行），再 build。10/16 相反：它必須用地面時代的輸入，在 `HEAD` 重建不了（見 `docs/tainan-memory-2026-10-16-design.md` 第 6 節「重建要用地面版的輸入」）。
- 重跑之前先確認變動與物理無關：用 `git log` 與 `git diff <上次建置時的 commit> HEAD -- index.html data/tra.json data/tra_track_sections.json data/tra_special_trains.json scripts/fetch_tra_schedule.py` 看，只動更新紀錄、`BUILD` 字串與註解才能照做；動到車種極速（`PERF_RULES`／`PERF_BY_TYPE`）、路網或班表，就不是單純重建，要先弄清楚改了什麼。
- 重建後把新舊 `snapshot.json` 逐欄比對：除了 `snapshot.sources` 與 `timingSource.speedCaps.indexSha256` 裡的雜湊，其餘要全部相同；`source-schedule.json`、`source-observations.json`、`uncertainty.json` 要逐 byte 相同。
- 實例：2026-10-18 併入 main `6b6d9961`。`index.html` 只動更新紀錄與 `BUILD`（`v1018a`→`v1018c`），`scripts/fetch_tra_schedule.py` 只動一行註解，三個 `data/` 檔沒變。重建後有 6 處雜湊不同（`index.html` 兩處，`scripts/fetch_tra_schedule.py`、`scripts/build_tainan_memory.mjs`、物理下限檔、實測檔各一處；`scripts/build_tainan_memory.mjs` 是同一輪改的一行註解），其餘逐欄相同。

**程式面問題**（定版 observed 路徑要先解決）。五點都已修，並在已有實測的 10/17、10/18 彩排上跑過 observed 路徑；換定版後照上面的重建與驗收再跑一次：

- 第 1 點：`5a450619`，同一車次的前一日尾段與當天頭段各自重建，passObs、tainanFit 與自訂計畫照班次分開。
- 第 2、3 點：`df9a2ef9`，`checkObserved()` 拆成通用與單線專屬兩部分；沒有單線的日期每段補 `reason`（9/12 的輸出不變）。
- 第 4 點：`5a450619` 在 10/17 彩排重驗 `knotCheck`（130 顆，最大偏差 0.5 秒）；定版資料要再看一次 build 報表的同一項。
- 第 5 點：`fa4efbf3`，頁面依 `snapshot.preview` 切換預覽／實測的段落、徽章、字幕與來源行，沒有實測紀錄的車次在執行時從 `timingSource.scheduledTrains` 填。

原本的問題描述：

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

- 預覽時刻全是表定：沒有誤點，但表定班表裡排好的待避與越行照樣在。場景內三站共 18 次（大橋 0、臺南 9、保安 9；判定是同方向兩班，一班先到、另一班後到卻先開）：臺南是兩班都停靠，保安是慢車停靠、快車通過（通過時刻來自物理模型）。到離站時刻不是實際運行紀錄。
- 地下段的深度、車站與隧道尺寸是估計／示意；臺南的停靠位置是月台中央的推演，不是實測。
- 8 班在臺南到站那一秒瞬停（第 4 節）；定版時刻不同，班數會變。
- 10/22 尾段與 10/23 頭段的 3297、3786 在預覽共用同一組定義；定版改成各自重建（第 5 節第 1 點，`5a450619`）。兩段都有實測的情形還沒在彩排跑過：10/18 彩排做的時候只有 10/17 的 TDX 歷史，只有前一日尾段的兩班有實測。
- 4 段不確定時段只標股道重疊；沒有單線雙向。
- 頁面由 `scripts/verify_tainan_memory_1023_browser.mjs` 在預覽資料上驗（兩引擎）。實測模式只在 10/17、10/18 的彩排資料上跑過（彩排輸出不進版控），定版資料到了要再跑一次。
- 關於視窗實測段沿用 10/16 的「到站時間的誤差約半分鐘」，這個數字來自 10/16 用的校準回測（`backtest-2026-09-12.json`），不是對 10/23 量的；開車時刻標「推定」是因為 TDX 誤點只記到分鐘。
