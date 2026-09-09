# 沉浸感第一階段：日夜光影

基於主線 `792b95c6`，版本 `v0909g-light`。目前為本機可操作版本，未部署正式站。

## 已實作

- 更多 → 地圖顯示 →「日夜光影」，預設開啟，以 `trainmap-sunlight` 存在 localStorage；分享網址帶 `sun=on|off`，連結只覆蓋本次選擇。
- 太陽依台北曆日、`state.simSec` 與地圖中心計算；回放、直接指定時刻及快轉均沿用原本時間軸。沒有另外取一套真實時鐘，也不使用凌晨 04:00 換日的捷運營運日。
- 天空色彩依太陽高度連續變化；MapLibre 建築光源的 `anchor` 為 `map`，位置為 `[距離, 方位角, 極角]`。外觀明暗與地圖風格保留使用者選擇。
- 樣式載入後重新掛載；地景非同步建立時的原始光源交給同一個控制器，避免稍後蓋掉日夜光。關閉時還原當前底圖的基礎光源與天空。
- 定時檢查每秒一次，時間 30 秒／位置約 2 km 內去重；手動跳時立即更新，背景分頁跳過，回到前景補一次。
- 傾斜上限從 60° 放寬為 75°，預設視角不變。平坦視圖以引擎的地平線裁切，起伏視圖保留 DEM 投影，避免把山稜上的站名切成半截；點擊以實際地形覆蓋判定。列車與車牌座標未移動。
- 地景 hillshade 改用讀取太陽高度的 `basic` 方法，方向固定以地理北方為準，隨晨昏交換迎光坡，夜間降低亮度與坡面對比；關閉時完整還原原有 paint（包含原本未指定的預設欄位）。
- 傾角超過 30° 才逐漸限制標記距離，範圍隨縮放與視窗尺寸調整，外圈以 smoothstep 淡出；台鐵／高鐵、捷運一般與全台同框、官方與 Core 名冊、站名、平交道與園區均使用相同判斷。完全隱藏的標記不參與點擊或 hover。俯視恢復完整範圍。
- `M.toScreen` 契約保持原樣；只有標記用 `mapDetailPoint` 附加透明度，線形與移動物件座標不受影響。
- 新模組放在 `rail-3d/environment/`，沿用既有 App 打包整棵 `rail-3d` 的流程。

## 實測發現

1. 參考檔的兩元素光源位置缺少距離，已補為三元素。
2. MapLibre 5.9.0 的天空 validator 不接受 `sky-color-transition` 等屬性；拒收後 `getSky()` 仍回傳該設定。只檢查回傳值會誤判成功，這次改用內建 300 ms 漸變並檢查實際截圖像素及 console error。
3. 新主線的地景整合已有固定 `setLight()`，和規劃文件的較早盤點不同，必須納入控制器。
4. 舊傾角上限看不到天空。第一版只用水平裁切，且預覽網址指定 `ground=flat`，不足以驗收地景起伏；目前已改用實際台南與阿里山場景，依地理距離淡出遠方標記，並保留山稜上的完整標籤。
5. 地景切換時，舊 terrain 的深度／座標 framebuffer 仍引用已移除的 style projection，雙引擎均會拋出 `shaderPreludeCode` 例外。`setStyleKind` 在更換整份 style 前先 `setTerrain(null)`，由新樣式的 3D 接點依原有偏好重建。
6. `state.lines`／`state.decoLines` 的站點投影原本只複製 x/y，會丟掉透明度。已讓兩套快取都保留標記透明度，避免機捷／中捷等遠站漏出。

## 驗證

- `node scripts/verify_sun.mjs`：NREL 獨立樣例、台北日期轉換、四季與南北逐 30 秒掃描、晨東暮西、午夜與連續配色，通過。
- `node scripts/verify_sunlight_browser.mjs`：Chromium／WebKit 共 56 項通過。四時段截圖有實際像素差異；明／暗／地景與 raster 衛星樣式重載、3D 延遲載入、關閉還原、圖層／來源／相機不因換光而增加或移動；360／375／390／414／520／768 px 真觸控、全畫面、可及性、可互動控件交集與橫向溢出。
- `node scripts/verify_sunlight_controls.mjs`：兩引擎共 16 項通過。直接操作時間欄位、偏好重載、分享覆蓋、全畫面 × 橫幅 × 車站卡與更多面板、真實跨午夜與單日回放、向南與向北移動、快轉更新頻率。
- `SCOPE=m2 node scripts/verify_map_orientation.mjs`：既有雙引擎指南針／3D 建築／觸控回歸全過。Chromium 跨層形心差 0.166 CSS px。
- `ENGINE_GATE_STATIC_ONLY=1 ENGINE_GATE_STRICT=1 node scripts/verify_engine_adapter.mjs`、`node scripts/check_i18n.mjs` 與 `git diff --check`：通過。
- `node scripts/verify_sunlight_terrain.mjs`：Chromium／WebKit 共 22 項通過。使用實際阿里山 DEM，驗證四時段山坡 paint、關閉還原、換光不改地形／相機，以及山稜可點、天空不接收點擊。隔離 hillshade 的實際像素對照中，約 98% 東西向坡面正確交換晨昏明暗。
- `node scripts/verify_sunlight_style_reload.mjs`：雙引擎共 14 項通過，反覆切換明亮與地景，各完成三輪，沒有 terrain projection 或 3D 渲染錯誤。
- `MAP=landscape WIDTHS=375 node scripts/verify_3d_terrain_browser.mjs`：雙引擎共 24 項通過，涵蓋阿里山林鐵兩個方向及 0°／45°／55° 傾角。實際軌道像素連續，車體與既有軌道高度差小於 2 cm；此項驗證的是繪製對齊，既有軌道離地高度仍是推估值。
- `node scripts/verify_map_detail_distance.mjs`：雙引擎、414／1280 px，平坦／起伏 × 45°／60°／75° 通過。台南近景保留、台北／基隆等遠站隱藏，兩套捷運站點快取與列車命中同步；漸變連續且投影位移為 0，附近車站真觸控可開看板，回到俯視恢復完整範圍。Chromium 1280 px 的 headless 截圖曾逾時，以 `ENGINE=chromium WIDTHS=1280 HEADFUL=1` 重跑全案通過。
- 車牌繪圖與 `13ae7f4b` 的像素 A/B：雙引擎、明暗配色共 28 項通過。近景圖示逐像素相同，半透明與完全隱藏均正確，canvas 狀態可還原；結果保留於本機 `output/marker-fade-results.json`。
- `node scripts/verify_sunlight_preview.mjs`：雙引擎共 60 項通過，360／375／390／414／520／768／1280 px 真觸控；四時段與台南／阿里山起伏、台北平坦可切換，切換保留時間。預覽全控件可點、無相交遮擋與橫向溢出，iframe 位於視窗內。

## 本機預覽

在工作樹根目錄執行：

```sh
ln -s scripts/sunlight-preview.html sunlight-preview.html
PORT=5236 node scripts/serve_landscape_preview.mjs
```

開啟 `http://127.0.0.1:5236/sunlight-preview.html`。預覽頁位於部署排除的 `scripts/`；根目錄連結與 `output/sunlight/` 畫面不加入 commit。日夜按鈕控制的是真正首頁場景；預設台南起伏，另可切阿里山起伏與台北平坦。

## 範圍與待驗

這一版控制天空、MapLibre extrusion 建築光照與地景 hillshade。列車、獨立地標模型的自訂材質與樹木仍沿用既有照明；沒有新增投射陰影、太陽圓盤、天氣觀測、雨或聲音。`atmosphere-blend` 的球面大氣散射不適用目前的 Mercator 場景；地形霧色仍由 `setSky` 提供。

色彩是視覺調校，不是氣象觀測。演算法未做大氣折射修正，不用來對訪客報精確日出時刻。A54／iPhone 實機長時間拖曳與耗電尚未驗證，桌面瀏覽器手機模擬不能代替這一項。

遠距顯示的改善不等於完整的山體遮蔽模型：近處覆蓋式站名仍沿用既有標記語意；不宣稱所有標籤皆經過逐點深度遮擋。既有軌道高程仍是顯示推估值，這次沒有改寫 DEM 或軌道資料。

## 查證來源

- [MapLibre 光源規格](https://maplibre.org/maplibre-style-spec/light/)：位置三元素與 `map` 錨定。
- [MapLibre 天空規格](https://maplibre.org/maplibre-style-spec/sky/)：色彩、霧及大氣參數；實際相容性另以 repo 固定版 5.9.0 驗證。
- [NREL Solar Position Algorithm，表 A5.1](https://docs.nlr.gov/docs/fy08osti/34302.pdf)：獨立太陽位置樣例；本實作為 NOAA 近似，驗證容許誤差 0.1°，未套用 SPA 的精度宣稱。
- [MapLibre hillshade 規格](https://maplibre.org/maplibre-style-spec/layers/#hillshade)：`basic` 坡面入射光、方向與高度、map 錨定；並以 repo 的 5.9.0 shader 核對相容性。
