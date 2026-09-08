# 公開資料地景 v0908k

在 `codex/island-landscape-0908` 的地景原型接入 ESA WorldCover 2021 v200。後續已整合進 v0909b 網站版本；App 未重新打包。

## 資料與呈現

- 山體沿用已打包的 Mapterhorn／內政部 2024 年 20 公尺 DTM，不變更列車位置或軌面高程。
- 新增 ESA WorldCover 2021 土地覆蓋：森林、草地、農田、建成區、水域等。原始資料為 10 公尺分類；顯示圖磚依 zoom 概化，最高 z11 約 70 公尺，不宣稱是逐株或現況調查。
- 僅保留既有內政部台灣縣市海岸輪廓內的資料，含離島。海岸遮罩原已簡化約 150 公尺，海岸細節仍以既有街道底圖為主。
- OSM 水域、公園、道路、林地與建物畫在 ESA 基礎分類之上。一般建物延用已有輪廓、高度與樓層；缺乏高度的建物仍為估計值，外觀配色為美術呈現。
- 樹群可取自 OSM 或 ESA 林地，固定地理種子，沿用水域、道路、建物與行車走廊排除。樹種、樹高、單株位置是示意。

## 載入與效能

- 918 個 z6–11 向量圖磚，276 個有內容，總計 22,967,839 bytes；最大圖磚 391,261 bytes。空白磚明確存在，避免海域請求 404。
- 向量磚同源、按視野載入；切換明／暗／衛星會移除該來源。外部 ESA 伺服器不參與使用者執行時的請求。
- 樹群仍為 2 個 InstancedMesh，桌面最多 1,400 株，觸控最多 700 株，z14.5 以下不顯示。
- 加入 ESA 後，原同步取樣一度量到 150–220ms。現改為約 5ms 預算的短批次，以 timer 讓出主執行緒；完成後一次提交，避免半成品閃動。鏡頭移出取樣區、地形或軌道版本變更、場景卸載時捨棄舊工作。
- 桌面地景署名列限制在右半側並可橫捲，保留中央隨機跟隨的空間。完整指定署名與授權位於「資料來源與授權」。

## 重建與驗證

使用 `scripts/build_worldcover.py`；依賴版本與操作方式寫在檔頭。原始四份 GeoTIFF 放在指定 cache，不納入版控。每個來源的網址與 SHA-256、分類統計、處理說明保存在 `rail-3d/landcover/worldcover-2021/manifest.json`。

- `scripts/verify_worldcover_data.py --cache <來源目錄>`：獨立解碼 918 個成品圖磚，2,261 個抽樣點與原始 GeoTIFF 分類一致，涵蓋林地、草地、農田、建成區、裸地、水域、濕地。
- `HEADFUL=1 node scripts/verify_landscape_basemap.mjs`：Chromium／WebKit 68/68，包含桌面切換、保留列車與時間、DEM、林冠、拖曳延後重建、卸載，以及 360／375／390／414／520／768 真觸控與一般／全螢幕命中、控件相交和溢出。
- `node scripts/verify_worldcover.mjs`：雙引擎 **24/24**，實測單批工作最長 Chromium 6.8ms／WebKit 8ms。實際分類渲染、完整署名展開、來源連結命中、圖層順序、ESA 單獨產生樹群、短批次工作時間、靜止不重掃、請求數量、切換卸載與斷線降級。
- `node scripts/check_i18n.mjs`、`node scripts/verify_changelog_copy.mjs`、`git diff --check`。

瀏覽器數據不是 iPhone／Android 真機 FPS 保證。

## 公開來源

- [ESA WorldCover 資料與授權](https://esa-worldcover.org/en/data-access)
- [WorldCover 2021 v200 正式引用](https://doi.org/10.5281/zenodo.7254221)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [內政部縣市界線](https://data.gov.tw/dataset/7442)
- [OpenMapTiles 地物欄位](https://openmaptiles.org/schema/)

© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium
