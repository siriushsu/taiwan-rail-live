# 地景地圖 v0908j

2026/9/8，基於主線 `2105cd2e`，保留當日已上線的 3D 效能與沿軌修正。在分支 `codex/island-landscape-0908` 完成本機可操作版本，尚未部署正式站或發行 App。

「更多 → 地圖風格」新增明、暗、衛星、地景四項。地景使用米色陸地、藍綠水域、分層綠色植被、農地與暖色街廓，建物以高度分色並保留原色地標。它與介面外觀分開：暗色介面也可觀看自然色地景。

山體沿用既有地形檔，新增山色陰影；地景預設開啟起伏，也能從「地形」切回平坦。地景的起伏與透視偏好獨立記憶，切換其他底圖不覆蓋原有設定。列車共用原先的位置、股道、班表、編組與跟隨機制。

林地近景增加低多邊形樹冠與樹幹，使用同一個 Three.js 場景及 WebGL context 的兩個 InstancedMesh。地理種子固定，依已有 OSM 林地多邊形取樣，排除孔洞、道路、水域、建物與行車走廊。只在 z14.5 以上顯示，桌面最多 1,400 株、觸控裝置最多 700 株；相機停止 450ms 後才處理，持續移動最多延後 15 秒。沒有額外動畫時鐘或逐幀圖磚掃描，回切其他底圖會解除訂閱並釋放幾何與材質。

這是全台地景樣式與顯示細節的第一版，不是全台逐棟實測建模。單株樹木是示意，範圍與細節受既有圖資覆蓋影響；地表起伏也不等於已驗證所有橋梁、隧道與軌面高程。這輪沒有新的 iPhone／A54 真機 FPS 結論。

## 本機使用

```sh
node scripts/serve_landscape_preview.mjs
```

預覽僅監聽 `127.0.0.1:5228`，支援地形的 HTTP Range，僅提供公開檔案與指定唯讀 API。

- 河岸與森林：`http://127.0.0.1:5228/?map=landscape&scene=3d&g=all&at=24.9971,121.5784&z=17.5&lang=zh-TW`
- 列車：`http://127.0.0.1:5228/?map=landscape&scene=3d&g=all&train=117&t=12:00&z=19&lang=zh-TW`
- 地景樣式可由 `node scripts/build_landscape_style.mjs` 從本站原 OFM 樣式重建，保留同一組圖資與中文字標。

## 驗證

- `HEADFUL=1 node scripts/verify_landscape_basemap.mjs`：Chromium／WebKit **68/68**。含模型、DEM、實際拖曳中延後重建、靜止不重建、縮遠降細節、三次來回卸載、重整、360／375／390／414／520／768 手機真觸控與一般／全螢幕命中、全控件相交及溢出。
- `BASE_URL=http://127.0.0.1:5228/ WIDTHS=360,375,414,768 node scripts/verify_3d_integration.mjs`：既有 3D 回歸 **58/58**。
- 另以兩引擎使用既有衛星服務，實際按選單來回切換，保留 117 次與固定 12:00；兩引擎通過。
- 117／116 次南北兩方向在 12:00 → 12:00:03 的地理位置皆前進，3D 模型存在，無顯示錯誤。
- `node scripts/verify_landscape_preferences.mjs`：雙引擎 **10/10**，無選車深連結、平坦偏好、清除網址後重整、快速連切及重套底圖後透視保存。測試先重現兩引擎的透視被重設，再修正快取命中時的外觀同步。
- `node scripts/check_i18n.mjs`、`node scripts/verify_changelog_copy.mjs`、JS 語法與 `git diff --check` 通過。App 打包清單已加入新底圖檔與存在性檢查，尚未重新打包或上傳商店。

較早的測試使用不支援 Range 的伺服器、headless 軟體 GPU，以及會被既有鏡頭管理中止的程式化 easeTo，結果不作為最終驗收。最終使用具 Range 支援的預覽、有視窗瀏覽器與真正滑鼠拖曳，完整重跑上述 68 項。

MapLibre 樣式依照 [官方 fill-extrusion 與 hillshade 規格](https://maplibre.org/maplibre-style-spec/layers/)；沿用現有 OpenFreeMap／OpenMapTiles／OpenStreetMap 與 Mapterhorn／內政部地形署名。
