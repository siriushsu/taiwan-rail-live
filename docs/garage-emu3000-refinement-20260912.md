# EMU3000 車頭精修

日期：2026-09-12。首發四款考據中的第一個實作項目，僅標示本輪完成的車頭範圍；不代表四款全部精修完成。

來源及可重建腳本：[Blender 修訂紀錄](../scripts/blender/emu3000-20260912/README.md)。

## 已匯入

- 依實際觀看的日立 ED3012 正面照片，校正面罩、梯形前窗、額頭雙圓燈、左右腰燈、中央雨刷及 U 形車鉤蓋縫。
- 更新 `rail-3d/assets/garage-blender-v1/emu3000.json`、`.bin.gz` 及 `.webp`，實際 loader 已載入新版，沒有只修改未接線的來源。
- 原生 Blender／GLB／metadata／六面檢視保存在 `output/emu3000-refinement-20260912/`；主工作目錄原始模型保留。
- 中間車、側門窗與車頂仍需後續考據，其他三款尚未精修。全車幾何未宣稱為等比例工程模型。

## 已完成的驗證

- 重開 `.blend`，新增面罩、膠邊與玻璃的非流形邊均為 0。
- 實際 loader 六面渲染檢視；資產 SHA、頂點資料、材質、索引來源與既有收藏門檻檢查通過。
- 場景驗證使用 `GARAGE_VIADUCT_URL=http://127.0.0.1:5251/prototypes/garage-viaduct/ node scripts/verify_garage_viaduct.mjs`，Chromium／WebKit 共 92 項全部通過，涵蓋三節可見像素、輪軌與車頂高度、日夜差異、跟車、資源釋放，以及 360／375／390／414／520／768／1280 的真觸控與可及性。結果保存在 `output/emu3000-refinement-20260912/scene-verification.log`。未做實體 iPhone 效能驗證。

## 下一項

繼續核對 EMU3000 側面門窗、黑色區域分布與車頂／中間車設備，取得對應車位實照再調整；其後依工作表處理 DR1000、林鐵、藍皮。
