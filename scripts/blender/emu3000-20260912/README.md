# EMU3000 車頭考據修訂 2026-09-12

此目錄的 `build_models.py`、`blender_parts.py`、`model_specs.py` 是既有 fleet-v1 工坊的來源快照；`catalog-source.json` 只保留本車。`refine.py` 在既有 EMU3000 上替換本次確認的車頭部件，不修改其他車款或主工作目錄的原檔。

```sh
FLEET_RENDER=0 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 --python scripts/blender/emu3000-20260912/refine.py -- /absolute/output/directory
```

產生可編修 `.blend`、GLB、位置／法線網格、metadata 與物件清單。`FLEET_RENDER=1` 可額外產生 Cycles 渲染。匯入用 `scripts/import_garage_blender.py --source <output> --models emu3000`，source 另需 `catalog.json`（單筆原車款索引、metadata 與 thumbnail 路徑）及新版縮圖；勿重匯其餘 61 款。

## 比對依據

- [日立設計介紹](https://www.hitachi.com/rd/research/design/product/taiwan_tra/index.html)。
- [ED3012 正面原照](https://www.hitachi.com/rd/research/design/product/taiwan_tra/image/img_03.jpg)：本次確實以瀏覽器觀看，核對黑面罩下收輪廓、梯形前窗、額頭雙圓燈、窗下兩側白／紅燈組、中央雨刷及大 U 形鼻端蓋縫。
- [日立斜側設計圖](https://www.hitachi.com/rd/research/design/product/taiwan_tra/image/img_02.jpg)：輔助理解鼻端，不當作每個量產車門窗的獨立實車證據。

照片未下載打包或作貼圖。未新增商標與 ED3012 車號；本次以 ED3012 照片核對標準車頭的共通特徵，沒有宣稱整車已成為 ED3012 等比例模型。

## 修改範圍

方形面罩改為向下收窄的曲面；圓角矩形前窗改為上寬下窄；額燈改為雙圓燈，新增兩側腰部燈組；兩支分離雨刷改為中央單組雙連桿；小矩形車鉤蓋改為 U 形大蓋縫。三個曲面都封閉建模，逐層留深度間距。

尺寸仍為 Q 版展示單位。側窗數、兩側門位、車頂設備、鼻端整體車殼曲率及中間車未在本輪重製，須依外觀工作表續查。燈片為材質色，不是列車頭尾燈隨方向切換的完整模擬。

三角形 41,786 → 56,106。輪底 z=0、寬高與後端界線維持；前端最大 x 增加約 0.0224 展示單位，編組長度由 loader 重新量測。
