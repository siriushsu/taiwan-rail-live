# 推估股道與近景避讓

本資料將 OSM 實體股道幾何接到既有列車時刻與 3D 編組。來源時間、雜湊與 ODbL 歸屬保留在 `network.json`、`metro-network.json`；股道指派、停車中心與調度皆為推估，不能當作官方月台或實際行車指令。

- `motion.js` 按車次、日期班表的起訖時間及完整停站簽章套用 `dispatch.json`。目前資料含 1,123 班。班表更新而簽章不符時沿用原始定位，避免錯套舊派軌。
- `metro-motion.js` 保留 36 個路線方向，依完整編組限制終點停車中心。未涵蓋的端點沿用原定位；目前紅線廣慈段未納入這份連通股道。
- 單線、雙線與站場多股來自來源幾何。`profile-lines.js` 與車身共用固定地表高程。
- 全日台鐵派軌仍有未消除的占用交疊。依使用者接受的預覽範圍，`passing-avoidance.js` 在近景比較完整車身，讓其中一車平順靠旁，通過後回位。這是示意呈現，沒有修改官方班表或誤點。
- 日後重新產生派軌時，`assemble_physical_dispatch.mjs` 預設拒收未解完的結果；只有明示 `--allow-visual-yield` 才允許這種預覽。接著執行 `pack_physical_network.mjs`，只打包當班實際使用的路徑，保留所有來源股道供地圖繪製。
- `?tracks=legacy` 可供回歸比對；一般開啟網站即使用分軌。

主要驗證：`verify_physical_motion.mjs`、`verify_metro_physical_motion.mjs`、`verify_passing_avoidance.mjs`、`verify_physical_tracks_browser.mjs`。瀏覽器檢查包含 Chromium、WebKit、兩個方向、捷運進停出與終端、偏移車身的點擊命中及手機寬度。原始來源與重建中間檔存於不發布的 `.cache/physical-tracks/`，測試輸出在 `output/`。
