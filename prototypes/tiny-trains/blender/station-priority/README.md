# 特色車站第一批：冬山、士林、美麗島

延續 station-manifest.json 的全量製作清單。此次產出是三組站體／入口構型的 Blender 建模候選，不能計成三站已完成實拍驗收。

- 冬山：交叉圓拱、白色膜頂、V 型支撐、兩座島式月台及分開的下層站房。
- 士林：依官方工程資料採懸山式屋頂，保留屋脊天窗、中央抬高屋頂與兩端出入口。舊清單「歇山式黃琉璃瓦」註記已修正；本次色票仍為美術估值。
- 美麗島：地面四個主要入口的配置研究；四個可移動模組目前共用估算曲面原型，尚未逐一校正真實外形、出口編號與朝向。地下光之穹頂為另一個待做資產，沒有把它當地上站頂。

每組包含原生可編輯 .blend、近／遠 GLB、地圖 mesh.bin、模型／來源資料、三視角 PNG；根目錄有 contact-sheet.jpg 與 review.html。

## 真實資料與估值

stations.json 把官方／設計方文字確認特徵、次級資料與估算參數分開。照片來源連結保留，但工具仍僅回傳文字與圖片占位符，沒有完成照片像素目視校正。未量測的長寬高、柱距、雨棚覆蓋、玻璃色、出入口細節及方位均不冒充工程尺寸。

stationPositionLonLat 是原站點定位，anchor 與 rotationDeg 維持 null。這些資產可供地圖載入開發與後續放樣；尚未接入正式地圖，也未更動軌道高程。模型原點是相對地面 Z=0。軌道導引僅在 Blender 攝影棚，GLB／mesh.bin 不含導引軌道。美麗島未虛構中央池塘及額外七個小入口。

## 重建

在 repo 根目錄執行，依序建立三組模型：

```sh
blender -b -t 2 --python-exit-code 1 --python prototypes/tiny-trains/blender/station-priority/build.py -- output/station-priority
blender -b -t 2 --python-exit-code 1 --python prototypes/tiny-trains/blender/station-priority/verify.py -- output/station-priority
python3 prototypes/tiny-trains/blender/station-priority/compose.py
```

沿用 building-batch/core.py，原檔維持細分件，地圖匯出依材質合併。驗證包括 GLB 往返界限、法線與雜湊、近遠景面數、棚頂射線覆蓋、月台／拱架／入口分件數及攝影棚排除；這些是格式與模型結構檢查，不是實拍精度或手機幀率驗收。
