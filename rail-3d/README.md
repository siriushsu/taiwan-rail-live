# 軌島立體列車整合

2026-09-07 從 `prototypes/taiwan-3d` v24 移植到主站的原生 MapLibre 地圖。保留主站亮暗設計、時刻表、站點看板、選車與跟車，未引入原型的第二張地圖、外部時鐘或另一套工具列。原型工作目錄不由此模組回寫。

- `../rail-3d.js` 將台鐵／高鐵、捷運分頁、全台同框裝飾路網，以及即時／班表車輛轉成共用影格；車體仍在原班表位置。
- MapLibre 固定 5.9.0；Three.js 固定 0.170.0。外觀更換前釋放舊 renderer，非同步載入以世代取消，站房只操作自己擁有的 source。
- 引擎縮放 14 起按近景載入列車網格。62 款車型、110 個衍生網格來自原型已驗證的 Blender 地圖資產。每件核對 SHA-256，閒置幾何快取上限 18 件。
- 完整編組使用車型／路線標準，並非即時派車實測。未知當班編組明示三節示意；三節模式可隨時切換。
- `integration/display-profiles.json` 為原型的固定平滑地表取樣。地形只表示地表起伏，不代表隧道、高架或實測軌面高程；`railElevationM` 仍為 null。沒有相符線形取樣時回到原標記。
- 地形 PMTiles 位元組原封拆成 8 MiB 片，見 `terrain/manifest.json`。`terrain-source.js` 只取需要的 Range，支援跨片與伺服器回整片的情況；模型與地形不在首頁全部下載。來源及署名在 `terrain/source.json`、`terrain-attribution.json`。
- 透明建物會寫深度，因此列車先在建物下畫一次供玻璃混色，再在路線上方按正常深度補畫可見部分。不透明建物仍遮擋列車。
- 「跟車時車頭朝上」預設關閉，以 localStorage 記憶。開啟後才自動轉向；指北覆寫當次跟車方向，手動近景旋轉可保留側拍。
- 設定沿用主站面板。近景使用同一 MapLibre 相機與原始路線座標；完整編組靠車頭構圖，不移動車身來避讓 UI。

驗收腳本位於 `scripts/verify_3d_*`、`verify_follow_heading_toggle.mjs`、`verify_compass_selection.mjs`、`verify_station_targets.mjs`。涵蓋 Chromium／WebKit、雙向完整編組、地形對齊、透明遮擋像素、模型實際觸控與亮暗快速切換；手機含 360、375、390、414、520、768 寬。

出貨仍使用 `npm run ship-web -- --preview --ref <commit>`。原始檔保留註解，乾淨出貨樹才去註解。Native prepare-web 已加入本模組以免遺漏引用，離線資產約增加 199 MB；本次只發布網站預覽，未建置或發布原生 App。
