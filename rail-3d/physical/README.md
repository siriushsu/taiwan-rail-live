# 推估股道與逐節行駛

本資料將 OSM 實體股道幾何接到既有列車時刻與 3D 編組。來源時間、雜湊與 ODbL 歸屬保留在 `network.json`、`metro-network.json`；股道指派、停車中心與調度皆為推估，不能當作官方月台或實際行車指令。

- `motion.js` 透過 `plan-binding.js` 核對 `dispatch.json`（1,123 班派軌快照）。完整班表相符時使用原安排；台鐵只更新明確不停靠站的推估通過時間、站序與正式停靠不變且原計畫沒有待避時，可保留原股道並使用目前曲線時間。新加開車僅借用同系統、同方向、完整有序且連通的既有路徑切片，不繼承別班的待避、誤點或接車關係。正式停靠時間改動、站序不符、時間倒退或未知區間仍會退回原定位。
- `metro-motion.js` 保留 36 個路線方向，依完整編組限制終點停車中心。未涵蓋的端點沿用原定位；紅線廣慈段已於 2026-09-09 依 OSM 共用節點補齊雙向股道，來源見 `scripts/fixtures/guangci-osm-0909.json`。
- 單線、雙線與站場多股來自來源幾何。`profile-lines.js` 與車身共用固定地表高程。
- 車廂中心與方向依各自里程取樣，轉換股道只沿指派路徑中的實際連通岔道，前後車廂依序通過。禁止為了畫面交疊而整列側移；台鐵、高鐵與捷運在地表投影靠近，也不會互相觸發避讓。
- 全日台鐵派軌仍有未消除的占用交疊。渲染器保留指派位置，不偽造平行股道或改動班表來掩蓋它；後續派軌修正必須在路網中選擇連通且可用的股道。
- 日後重新產生派軌時，`assemble_physical_dispatch.mjs` 預設拒收未解完的結果；舊資料曾以 `--allow-visual-yield` 接受占用交疊，此旗標不會也不得重新啟用畫面側移。接著執行 `pack_physical_network.mjs`，只打包當班實際使用的路徑，保留所有來源股道供地圖繪製。
- `?tracks=legacy` 可供回歸比對；一般開啟網站即使用分軌。

主要驗證：`verify_physical_motion.mjs`、`verify_metro_physical_motion.mjs`、`verify_passing_avoidance.mjs`、`verify_physical_tracks_browser.mjs`。瀏覽器檢查包含 Chromium、WebKit、兩個方向、捷運進停出與終端、股道上的車身點擊命中及手機寬度。原始來源與重建中間檔存於不發布的 `.cache/physical-tracks/`，測試輸出在 `output/`。
