# 地標辨識模型 v1

本批增加台北 101、中正紀念堂、國父紀念館、台北車站前的新光摩天大樓及高雄 85 大樓。與既有 12 個核心站區共用地形、深度、圖磚替換、半透明與標籤遮擋。切換地點選單的「自製地標」，或沿附近鐵道拉近即可看到。

| 地標 | 預覽 | 平面來源 | 顯示高度 |
|---|---|---|---|
| 台北 101 | `?view=taipei101&version=16` | [OSM 1159328965](https://www.openstreetmap.org/way/1159328965) | 508m，總高依官方資料；分件比例示意 |
| 中正紀念堂 | `?view=cksmh&version=16` | [OSM 1052759757](https://www.openstreetmap.org/way/1052759757) | 70m，總高依官方資料；分件比例示意 |
| 國父紀念館 | `?view=sunyatsen&version=16` | [OSM 189788192](https://www.openstreetmap.org/way/189788192) | 30.4m，總高依官方資料；分件比例示意 |
| 新光摩天大樓 | `?view=shinkong&version=16` | [OSM 204711206](https://www.openstreetmap.org/way/204711206) | 244.15m 展示值；測繪高度仍為 null |
| 高雄 85 大樓 | `?view=tower85&version=16` | [OSM 34170948](https://www.openstreetmap.org/way/34170948) | 378m 暫定展示值；測繪高度仍為 null |

總高參考：[台北 101](https://www.taipei-101.com.tw/tw/corporate/about)、[中正紀念堂](https://www.cksmh.gov.tw/cp.aspx?Create=1&n=5882)、[國父紀念館](https://www.yatsen.gov.tw/cp.aspx?n=6503)。85 大樓外觀參考：[交通部觀光署旅遊資料](https://www.tad.gov.tw/m1.aspx?id=9328&sNo=0001016)。未把照片製成材質。

五份原始輪廓、來源 ID 與 OSM 快照時間 2026-06-01T08:52:28Z 保存在 `landmark-osm-source.json`，依 ODbL 署名使用。只保留本批五個公開元素，不依賴 `/tmp` 工作檔。各目錄 `metadata.json` 保留來源與高度品質，`footprint.geojson` 保留原始平面輪廓。重建入口：`python3 scripts/build-landmark-catalog.py [可選的原始 JSON 路徑]`，使用既有 Shapely／pyproj 環境。

`landmark-models.js` 自製低面數外觀，保留主要分節、藍瓦八角頂、黄色飛簷、退縮塔冠及雙塔鏤空。它不是逐棟測繪模型，未建立室內或月台，也不能從外觀推定列車軌面。所有 `railElevationM` 仍為 null。地標底座依 DEM 落位，總高不等於海拔。

手機相機依面板外的可用寬高取景，對準建物中段；減少動態效果使用 `jumpTo`，避免本地 MapLibre 的 `flyTo` 快速分支丟棄 padding。相機只影響觀看位置，不移動地標或鐵道路徑。
