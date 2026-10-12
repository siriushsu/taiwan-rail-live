# 臺北車站 Blender 修訂樣站 02

這是可編輯的 3D 外觀樣本，目標是保留真實建築特徵，再以柔和邊角呈現可愛風格。**尚未完成逐面實拍校正，不是已驗收的真實站體模型。**

## 本次修訂

- 暫定材質改為磚紅屋頂、灰米色牆面與深灰玻璃；改用中性日光和 Standard 色彩檢視，降低前版偏粉、泛白的效果。色票是美術調整，未經照片取樣。
- 修正豎窗框比玻璃及橫框突出約 2.35 公尺的建模錯誤，避免立面變成浮空格柵。
- 補東、西二門。官方租用說明可確認門的存在，精確位置、尺度和門型仍需照片校正。
- 遠景移除細部倒角，保留屋頂輪廓及中央採光罩完整覆蓋。近景與 Blender 原檔仍保留可編輯倒角。
- 模型匯出、驗證與渲染分開執行，先保存已驗證模型，再輸出三視角與前後比較。

來源與證據限制見 [evidence-audit.json](evidence-audit.json)。不可把檔案驗證通過解讀為建築外觀正確。

## 產出

- `taipei-main-exterior-v2-preview02.blend`：可編輯部件、材質、倒角與主視角。
- `near.glb`、`far.glb`：以公尺為單位的地圖用 GLB。
- `near.mesh.bin`、`far.mesh.bin`、`model.json`：little-endian xyz/normal，每頂點 24 bytes。
- `hero.png`、`front.png`、`roof.png`、`preview02.jpg`、`comparison.jpg`：模型實際渲染與前後比較。
- `validation.json`：原檔重開、GLB 往返、法線、雜湊、窗框接合與中央覆蓋驗證。
- `placement-preview.json`：待校正定位資料，朝向維持 null。

本樣站尚未替換正式地圖資產，也未在手機上量測效能。GLB 為 +Y up；既有 +Z up 地圖載入器需 rotateX(+PI/2)。展示地面、相機與燈光不會匯入地圖。

## 重建

需要 Blender 4.x、NumPy 與可選的 Noto Sans CJK 字型；組合比較圖另需 Pillow。缺少中文字型時省略站名字形。

在本目錄執行：

```sh
blender -b --python-exit-code 1 --python build.py -- --out output --skip-render
blender -b --python-exit-code 1 --python verify.py -- output
blender -b --python-exit-code 1 --python render.py -- output
```

GitHub Actions 從專案根目錄執行，另由 `compose.py` 產生比較圖並把原始程式、來源與模型一起打包。完整 ZIP 由工作流程保存 90 天；原始程式保留於分支，可重新產出。

## 精度與待修項目

寬深沿用專案既有 OSM 矩形擬合值；高度、開間數、樓層線、門廊尺度、站名字形與位置、屋頂曲線、採光罩高程及分格仍是造型參數。近期照片目前僅核對來源資訊，尚未取得可實際檢視的照片內容，不能宣稱已完成實拍校色或逐面核對。

真實建築高度、工程尺寸、地面海拔與正面朝向均保留 null；`photoVisuallyVerified`、`geometryVisuallyVerified`、`productionReady` 均為 false。後續需用可檢視的近期白天正立面、側立面及高角度照片校正，再做地圖套合。

玻璃採不透明近似材質，以配合現行原生網格載入器。部件依材質合併以限制 draw calls。

## 前版與來源

[前版 01 預覽](preview01.jpg) · [前版 01 模型包](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38229745697/artifacts/11738436252)

前版近景 19,302、遠景 13,704 triangles；該包保留至 2026-11-11，僅供修訂比較。

參考資料見 [sources.md](sources.md)、[reference-input.json](reference-input.json)、[footprint.geojson](footprint.geojson) 與 [evidence-audit.json](evidence-audit.json)。未包含參考照片或照片貼圖。OSM 輪廓來源與 ODbL 署名隨檔保留；原創模型與程式適用專案根目錄 LICENSE。
