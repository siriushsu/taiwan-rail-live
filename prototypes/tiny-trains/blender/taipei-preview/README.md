# 臺北車站 Blender 外觀樣站 01

這是可編輯的 Blender 3D 外觀樣本，用於確認「真實站體量體＋自然柔和材質」的方向。中央採光區有完整覆蓋面，外圍紅色四坡屋頂、站體柱列和玻璃採光罩均可獨立修改。

![三視角實際渲染](preview.jpg)

[下載模型包（約 6.9 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38229745697/artifacts/11738436252) · [成功建置](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38229745697)

2026-10-12 已以 Blender 4.0.2 完成：534 個可編輯部件；近景 19,302 triangles／12 draw groups，遠景 13,704 triangles／8 draw groups。原檔重開、兩級 GLB 往返（界限誤差 0）、法線與雜湊、兩級中央覆蓋各 15 點檢查全數通過。尚未在正式地圖或手機中量測效能。

模型包由 commit `601ee142e8b5d2510f330500b1f5be673c3e2934` 產出，Actions artifact 保留至 2026-11-11；程式與本預覽保留在分支，可依下方指令重建。

## 產出

- `taipei-main-exterior-v2-preview01.blend`：保留各部件、材質、倒角修改器與三視角渲染設定。
- `near.glb`、`far.glb`：以公尺為單位的地圖用 GLB。
- `near.mesh.bin`、`far.mesh.bin`、`model.json`：與既有網格格式相同的 little-endian xyz/normal，每頂點 24 bytes。
- `hero.png`、`front.png`、`roof.png`、`preview.jpg`：模型實際渲染。
- `validation.json`：實際檔案驗證結果。
- `placement-preview.json`：待校正定位資料，朝向維持 null。

本樣站尚未替換正式地圖資產。GLB 為 +Y up；既有 +Z up 地圖載入器需 rotateX(+PI/2)。攝影棚與展示地面不會匯入地圖。

## 重建

需要 Blender 4.x 與可選的 Noto Sans CJK 字型。缺少中文字型時省略站名字形，不以方框代替。

```sh
blender -b --python-exit-code 1 --python build.py -- --out output
blender -b --python-exit-code 1 --python verify.py -- output
```

加上 `--skip-render` 可只產出模型。GitHub Actions 的樣站工作流程會安裝 Blender、重建、重新開啟原檔並匯入兩個 GLB，最後上傳完整 ZIP。

## 精度與待修項目

寬深採專案既有 OSM 矩形擬合值作初始造型基準；高度、開間數、樓層線、門廊尺寸、站名字形與位置、採光罩高程及分格仍是造型參數。近期照片的來源資訊已核對，本輪工具尚未提供可實際檢視的照片像素，因此不能宣稱已完成逐面照片校正。

真實建築高度、工程尺寸、地面海拔與正面朝向均保留 null。這一版先確認風格和模型製作流程，地圖套合與外觀精修仍需後續驗證。

遠景省略細瓦壟、細窗框、站名字形與採光罩細格；兩級皆保留中央覆蓋面。匯出將部件依材質合併，以限制 draw calls。所有玻璃採不透明近似材質，避免現行原生網格載入器的透明排序問題。

## 來源

參考資料見 [sources.md](sources.md)、[reference-input.json](reference-input.json) 與 [footprint.geojson](footprint.geojson)。不包含照片貼圖。OSM 輪廓來源與 ODbL 署名隨檔保留；原創模型與程式適用專案根目錄 LICENSE。
