# 沉浸感第一階段：日夜光影

基於主線 `792b95c6`，版本 `v0909f-light`。目前為本機可操作版本，未部署正式站。

## 已實作

- 更多 → 地圖顯示 →「日夜光影」，預設開啟，以 `trainmap-sunlight` 存在 localStorage；分享網址帶 `sun=on|off`，連結只覆蓋本次選擇。
- 太陽依台北曆日、`state.simSec` 與地圖中心計算；回放、直接指定時刻及快轉均沿用原本時間軸。沒有另外取一套真實時鐘，也不使用凌晨 04:00 換日的捷運營運日。
- 天空色彩依太陽高度連續變化；MapLibre 建築光源的 `anchor` 為 `map`，位置為 `[距離, 方位角, 極角]`。外觀明暗與地圖風格保留使用者選擇。
- 樣式載入後重新掛載；地景非同步建立時的原始光源交給同一個控制器，避免稍後蓋掉日夜光。關閉時還原當前底圖的基礎光源與天空。
- 定時檢查每秒一次，時間 30 秒／位置約 2 km 內去重；手動跳時立即更新，背景分頁跳過，回到前景補一次。
- 傾斜上限從 60° 放寬為 75°，預設視角不變。天空邊界沿用固定版 MapLibre 的地表判定，裁掉地平線外的 canvas 車牌／站名，天空區不接受地圖選車與開站卡命中。列車與車牌座標未移動。
- 新模組放在 `rail-3d/environment/`，沿用既有 App 打包整棵 `rail-3d` 的流程。

## 實測發現

1. 參考檔的兩元素光源位置缺少距離，已補為三元素。
2. MapLibre 5.9.0 的天空 validator 不接受 `sky-color-transition` 等屬性；拒收後 `getSky()` 仍回傳該設定。只檢查回傳值會誤判成功，這次改用內建 300 ms 漸變並檢查實際截圖像素及 console error。
3. 新主線的地景整合已有固定 `setLight()`，和規劃文件的較早盤點不同，必須納入控制器。
4. 舊傾角上限看不到天空；提高上限後，原本未被裁切的遠方 canvas 標記會浮在天空，已補上裁切與命中邊界。

## 驗證

- `node scripts/verify_sun.mjs`：NREL 獨立樣例、台北日期轉換、四季與南北逐 30 秒掃描、晨東暮西、午夜與連續配色，通過。
- `node scripts/verify_sunlight_browser.mjs`：Chromium／WebKit 共 56 項通過。四時段截圖有實際像素差異；明／暗／地景與 raster 衛星樣式重載、3D 延遲載入、關閉還原、圖層／來源／相機不因換光而增加或移動；360／375／390／414／520／768 px 真觸控、全畫面、可及性、可互動控件交集與橫向溢出。
- `node scripts/verify_sunlight_controls.mjs`：兩引擎共 16 項通過。直接操作時間欄位、偏好重載、分享覆蓋、全畫面 × 橫幅 × 車站卡與更多面板、真實跨午夜與單日回放、向南與向北移動、快轉更新頻率。
- `SCOPE=m2 node scripts/verify_map_orientation.mjs`：既有雙引擎指南針／3D 建築／觸控回歸全過。Chromium 跨層形心差 0.166 CSS px。
- `ENGINE_GATE_STATIC_ONLY=1 ENGINE_GATE_STRICT=1 node scripts/verify_engine_adapter.mjs`、`node scripts/check_i18n.mjs` 與 `git diff --check`：通過。
- `node scripts/verify_sunlight_preview.mjs`：四個預覽按鈕實際切換場景並完成截圖。

## 本機預覽

在工作樹根目錄執行：

```sh
ln -s scripts/sunlight-preview.html sunlight-preview.html
PORT=5236 node scripts/serve_landscape_preview.mjs
```

開啟 `http://127.0.0.1:5236/sunlight-preview.html`。預覽頁位於部署排除的 `scripts/`；根目錄連結與 `output/sunlight/` 畫面不加入 commit。日夜按鈕控制的是真正首頁場景。

## 範圍與待驗

這一版控制天空與 MapLibre extrusion 建築光照。列車、獨立地標模型的自訂材質、樹木與地形 hillshade 仍沿用既有照明；沒有新增投射陰影、太陽圓盤、天氣觀測、雨或聲音。`atmosphere-blend` 的球面大氣散射不適用目前的 Mercator 場景；地形霧色仍由 `setSky` 提供。

色彩是視覺調校，不是氣象觀測。演算法未做大氣折射修正，不用來對訪客報精確日出時刻。A54／iPhone 實機長時間拖曳與耗電尚未驗證，桌面瀏覽器手機模擬不能代替這一項。

## 查證來源

- [MapLibre 光源規格](https://maplibre.org/maplibre-style-spec/light/)：位置三元素與 `map` 錨定。
- [MapLibre 天空規格](https://maplibre.org/maplibre-style-spec/sky/)：色彩、霧及大氣參數；實際相容性另以 repo 固定版 5.9.0 驗證。
- [NREL Solar Position Algorithm，表 A5.1](https://docs.nlr.gov/docs/fy08osti/34302.pdf)：獨立太陽位置樣例；本實作為 NOAA 近似，驗證容許誤差 0.1°，未套用 SPA 的精度宣稱。
