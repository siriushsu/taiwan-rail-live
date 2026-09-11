# 推估股道與逐節行駛

本資料將 OSM 實體股道幾何接到既有列車時刻與 3D 編組。來源時間、雜湊與 ODbL 歸屬保留在 `network.json`、`metro-network.json`；股道指派、停車中心與調度皆為推估，不能當作官方月台或實際行車指令。

- `motion.js` 透過 `plan-binding.js` 核對 `dispatch.json`（1,177 班派軌快照：台鐵 911、林鐵 52、高鐵六種日型聯集 214）。完整班表相符時使用原安排；台鐵只更新明確不停靠站的推估通過時間、站序與正式停靠不變且原計畫沒有待避時，可保留原股道並使用目前曲線時間。新加開車僅借用同系統、同方向、完整有序且連通的既有路徑切片，不繼承別班的待避、誤點或接車關係。正式停靠時間改動、站序不符、時間倒退或未知區間仍會退回原定位。
- `metro-motion.js` 保留 36 個路線方向，依完整編組限制終點停車中心。未涵蓋的端點沿用原定位；紅線廣慈段已於 2026-09-09 依 OSM 共用節點補齊雙向股道，來源見 `scripts/fixtures/guangci-osm-0909.json`。
- 單線、雙線與站場多股來自來源幾何。`profile-lines.js` 與車身共用固定地表高程。
- 車廂中心與方向依各自里程取樣，轉換股道只沿指派路徑中的實際連通岔道，前後車廂依序通過。禁止為了畫面交疊而整列側移；台鐵、高鐵與捷運在地表投影靠近，也不會互相觸發避讓。
- 全日台鐵派軌仍有未消除的占用交疊。渲染器保留指派位置，不偽造平行股道或改動班表來掩蓋它；後續派軌修正必須在路網中選擇連通且可用的股道。
- 日後重新產生派軌時，`assemble_physical_dispatch.mjs` 預設拒收未解完的結果；舊資料曾以 `--allow-visual-yield` 接受占用交疊，此旗標不會也不得重新啟用畫面側移。接著執行 `pack_physical_network.mjs`，只打包當班實際使用的路徑，保留所有來源股道供地圖繪製。
- `?tracks=legacy` 可供回歸比對；一般開啟網站即使用分軌。
- 高鐵車站股道規則（2026-09-12）：桃園、新竹、苗栗、台中、彰化、雲林、嘉義、台南、板橋這些有通過線的車站，停靠列車只停外側到發線（OSM `service=siding` 上的 `railway=stop`），不停站通過的列車走內側正線（`usage=main`），且只停行進方向左側的月台；台北、南港、左營沒有通過列車，四股到發線皆可停。候選路徑只在起訖站 1.5 km 內准進側線，中途站的側線與渡線不進候選，所以通過列車結構上到不了月台。守門人 `scripts/verify_thsr_station_tracks.mjs`（掛在 `ship_web` 高鐵綁定閘門之後）逐站數停靠側線／正線、通過正線／側線、對向月台與推估停車點，每一條反向判準都配正向對照。
- 高鐵派車改依 TDX 逐日時刻表：`scripts/rebuild_physical_cache.mjs` 從已出貨的 `network.json` 還原 `.cache/physical-tracks/`（OSM 快照與中繼檔不在磁碟時用；台鐵、林鐵路徑與派車原封不動還原成 `output/dispatch-passthrough.json`），把 `Rail/THSR/DailyTimetable/TrainDate/{日期}` 的原始回應轉成與 `index.html` 相同語意的班表（末站以外每站 depSec +30）並依班次集合分成日型；每個日型各跑一次 `SYSTEM=thsr_sched TIMETABLE=<日型檔> OUT=<結果檔> RUN_TAG=<標籤> node scripts/optimize_physical_dispatch.mjs`，再以 `assemble_physical_dispatch.mjs output/dispatch-passthrough.json <各日型結果>` 合併、`pack_physical_network.mjs` 打包。同一車次同時刻在不同日型的計畫以最後一個輸入為準（路徑幾乎相同，只有待避秒數可能不同）。重新 `pack_physical_network.mjs` 之後要跑 `node scripts/build_rail_levels.mjs`：`verify_rail_levels.mjs`（出貨鏈閘門）會比對 `network.json` 的 sha256，ways 沒動時層位內容不變、只換雜湊。

主要驗證：`verify_physical_motion.mjs`、`verify_metro_physical_motion.mjs`、`verify_passing_avoidance.mjs`、`verify_physical_tracks_browser.mjs`。瀏覽器檢查包含 Chromium、WebKit、兩個方向、捷運進停出與終端、股道上的車身點擊命中及手機寬度。原始來源與重建中間檔存於不發布的 `.cache/physical-tracks/`，測試輸出在 `output/`。
