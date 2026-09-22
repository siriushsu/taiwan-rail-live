# 第一批核心站區：外觀 v1

2026-09-06，地景預覽版本 10。**12 個站區、44 個定位分件**，使用免費輪廓與軌島自製的程序幾何。

| 站區 | 本版外觀 | 預覽 |
|---|---|---|
| 臺北車站 | 紅色大屋頂・柱列・中央採光區 | [開啟](http://127.0.0.1:5193/?view=taipeistation&version=10) |
| 臺鐵臺中 | 弧形大屋頂・新舊站並列 | [開啟](http://127.0.0.1:5193/?view=taichungstation&version=10) |
| 高雄車站 | 綠化天棚・開口・舊站房 | [開啟](http://127.0.0.1:5193/?view=kaohsiungstation&version=10) |
| 新烏日・高鐵臺中 | 高鐵・臺鐵・中捷分件 | [開啟](http://127.0.0.1:5193/?view=xinwuri&version=10) |
| 左營・新左營 | 主站房・雙鐵站體分件 | [開啟](http://127.0.0.1:5193/?view=zuoyingstation&version=10) |
| 南港車站 | 共構基座・雙塔・分棟量體 | [開啟](http://127.0.0.1:5193/?view=nangangstation&version=10) |
| 板橋車站 | 主站基座・雙塔・環狀線分件 | [開啟](http://127.0.0.1:5193/?view=banqiaostation&version=10) |
| 高鐵桃園・A18 | 金屬挑簷・採光頂・A18 分件 | [開啟](http://127.0.0.1:5193/?view=hsrtaoyuan&version=10) |
| 高鐵新竹・六家 | 曲面長屋頂・六家分件 | [開啟](http://127.0.0.1:5193/?view=hsrhsinchu&version=10) |
| 高鐵臺南・沙崙 | 挑簷站房・沙崙分件 | [開啟](http://127.0.0.1:5193/?view=hsrtainan&version=10) |
| 花蓮車站 | 跨站廊道・迎客大傘・月台棚 | [開啟](http://127.0.0.1:5193/?view=hualienstation&version=10) |
| 臺東車站 | 站房・前廊雨棚・三座月台棚 | [開啟](http://127.0.0.1:5193/?view=taitungstation&version=10) |

## 精度及接車範圍

- 每個分件保留獨立經緯度輪廓、方向與來源；相鄰的臺鐵、高鐵、捷運沒有合併成同一座標。
- OSM 輪廓 © OpenStreetMap contributors，採 ODbL 1.0。`footprint.geojson` 僅保存選用建築的輪廓、名稱、識別碼及擷取日期，不攜帶周邊商家的聯絡資料。
- `station-models.js` 自製曲頂、挑簷、格柵、柱列、窗帶與展示大廳，使用本機產生的站名招牌；沒有把參考照片當貼圖。
- 所有 `displayHeightM`、`baseM` 都是示意參數。`realBuildingHeightM`、`railElevationM` 仍為 `null`，不因 OSM 標示樓層或高度就冒充測繪成果。
- 本版是外觀示意，尚未完成實際軌面、列車與月台對齊、地下站體、精確室內、所有出入口及轉乘廊道。臺中舊站、高雄舊站僅保留簡化的地標量體。
- 高鐵新竹的公車雨遮有施工版本，未把整體雨遮重做列入本次模型；輪廓快照與真實現況仍可能不同。

## 載入與遮擋

建物開關同時控制自製站房。近景依地形高程落位，GPU 只保留最近三站；離開站區後恢復原始底圖篩選。

站房繪製在地圖文字之後，文湖線列車層仍在更上層。站區文字預留屋頂投影與字幅淨空；半透明模式保留外殼，文字不會透進室內，站房自己的實體招牌維持原位。

向量圖磚常把站房與鄰房合成一筆 MultiPolygon。替換時逐多邊形拆分，將站外分件連同原始高度屬性原位重畫，不刪除整組鄰房。凹形輪廓僅容許 1.5m 邊界量化差，不用中心放大冒充幾何緩衝。

## 驗收入口

- `verify-station-batch.mjs`：12 站切換、幾何量、三站 GPU 快取、底圖拆分保留、正常／透視文字畫素比較、手機真實觸控。
- `verify-station-model.mjs`：臺北站室內遮擋、多角度、地形倍率、8 個手機／平板／橫向尺寸、全部控件相交與點擊命中、失敗降級、文湖線回歸。
- `verify-landscape.mjs`：42 個入口、全台地形及既有手機控制回歸。
- `verify-station-context.mjs`：大量站外分件保留後的點擊互動與靜止停止重繪。

最終 Chromium 與 WebKit 合計 **402/402 通過**，包含正常／透視與手機操作；總報告 `qa/station-batch-v10/final-summary.json`。

結果保存在 `qa/station-batch-v10/`、`qa/station-model-v10/` 與 `qa/landscape-v10/`；`qa/` 不列入版控。
