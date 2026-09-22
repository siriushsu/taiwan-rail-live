# 臺北車站・自製外觀 v1

2026-09-06。S01 第一個階段，僅供本機地景原型。

[開啟地圖預覽](http://127.0.0.1:5193/?view=taipeistation&version=9)。也可在探索下拉選單選「臺北車站・自製模型」，操作立體、俯視、環繞及「半透明透視・看站房」。

## 已交付

- 自製紅色四面曲坡屋頂、白色簷口、中央採光區、站房柱列、窗帶、入口雨棚、中文站名。
- 大廳保留簡化空間與地板，屋頂／外殼、室內、基座分件；透視時外殼 alpha 0.18，仍可看出建物輪廓。恢復外觀後正常寫入深度並遮擋內部。
- 12 個合併網格，12,184 個三角形；沒有為每根柱子或窗格建立獨立 draw call。離開近景時不繪製。
- OSM 站房輪廓定位與旋轉，底座跟隨地形取樣。立體建物、地形開關與地形倍率會更新模型。
- 只排除完整位於站房範圍內的底圖建物；不影響街區其餘建物。向量 feature id 由當次載入的幾何辨識，不猜 OSM id 的轉換規則。樹木生成也排除站房範圍。
- 桌面與手機入口整合在既有探索面板，沒有另疊一張浮動控制卡。

## 來源與精度

`footprint.geojson` 保存 2026-09-06 取得的 [OSM way 23641610](https://www.openstreetmap.org/way/23641610)，© OpenStreetMap contributors，ODbL-1.0。主輪廓擬合約 157.45 × 127.45m，局部東軸旋轉約 −10.69°；它是開放地圖輪廓，不是測繪保證。

`metadata.json` 保留 TDX 站點與獨立站房中心：前者是站點定位參考，後者由 OSM 四角計算。細部輪廓、柱距、屋頂曲線、中央採光區、入口及大廳配置均為自製簡化。

展示總高 **48m 是造型參數**。OSM 原資料另標 `height=30`、`roof:height=18`，本版沒有把兩數相加宣稱為實測證據；真實建物高度與 `railElevationM` 均保留 `null`。

屋頂與中央天井的建築特徵參考 [臺鐵官方說明](https://www.railway.gov.tw/tra-tip-web/tip/tip005/tip511/detail/0999020200159)，外觀參考 [2016 年新聞照片](https://www.nownews.com/news/2291980)。照片未下載納入模型，也未作貼圖；中文站名以本機字型繪製。舊照片中的站前設施與施工狀態沒有照搬。

## 本階段邊界

尚無地下月台、地下街、臺北站列車進出、機捷 A1 或北捷地下站體。透視目前展示站房與簡化大廳；文湖線試跑仍留在原有木柵—萬芳社區區段，沒有移到臺北站。此模型並非臺北站地下樞紐的完整交付。

## 程式與驗證

- `../../../station-models.js`：以公尺、Z 向上產生網格，合併同材質，控制透視與釋放。
- `../../../station-layer.js`：MapLibre 共用 WebGL 投影、地形落位、近景顯示與底圖建物替換。
- `../../../verify-station-model.mjs`：Chromium／WebKit 真實引擎驗證。檢查大廳可見像素差、位置不變、半透明外殼、原建物排除、鄰棟保留、地形切換、靜止繪製、來源失敗與手機觸控。

在 repo 根目錄執行：

```sh
node prototypes/taiwan-3d/verify-station-model.mjs chromium --headed
node prototypes/taiwan-3d/verify-station-model.mjs webkit
```

結果及截圖寫入 `../../../qa/station-model/`。保留 `*-initial-report.json` 與 `*-initial.log` 作為初輪失敗紀錄；最新複驗以 `chromium-report.json`、`webkit-report.json` 為準。手機為真實引擎觸控模擬，尚未宣稱 iPhone 實機效能驗收。

最終驗收：Chromium、WebKit 各 **68／68**；全島探索與來源面板回歸各 **54／54**，共 **244／244**，摘要為 `qa/station-model/final-summary.json`（相對原型根目錄）。初輪等待了模型與圖磚，仍早於延後植被／符號過渡完成；最終驗收等待圖層 idle，並在 800ms 無新幀後量測接下來 2 秒，兩引擎皆為 **0 幀更新**。無限重繪會在 12 秒等待上限失敗，不會因縮短量測窗而被略過。
