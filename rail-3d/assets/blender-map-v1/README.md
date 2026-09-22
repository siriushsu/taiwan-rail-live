# Blender 地圖衍生資產 v1

從已交付的 `prototypes/tiny-trains/blender/fleet-v1` 62 款車庫唯讀產生，沒有改原始 `.blend`、GLB 或 Raw。包含歷史／收藏車，**不代表全部都應出現在即時營運班表**。

- `manifest.json`：62 款外觀、110 個車體／中間車／輕軌分節網格，每項附來源與 SHA-256。
- `*.bin`：little-endian Float32 `[x,y,z,nx,ny,nz,r,g,b,gloss]`；+X 前、+Y 左、+Z 上，輪底為 0。
- 原車身經 Blender Decimate，單車目標 8,000 三角形；鏡射／裁切衍生件最多約 10,524。材質色由線性轉 sRGB，保留簡化光澤；不是原車庫攝影棚的完整 PBR 效果。
- 中間車以不含駕駛端的後半車體鏡射組合，保持同款外觀、平直車端；窗位／屋頂設備仍屬示意。DR1000、DR2700 保留雙端駕駛室。
- 輕軌依交付 metadata 的車體長度與鉸接間隙中線分開，首尾已朝外；不把剛性五節模型當一節車。
- 來源的展示車籍字牌排除，避免看起來像即時派車；車號由原站資料顯示。
- 尺寸由 `integration/formations.js` 給定。來源大部分是縮短的 Q 版比例，**包圍盒不是工程車長**；地圖沿縱軸調整到編組要求的公尺長度，近景外觀仍是簡化模型。
- 執行期只載入畫面中需要的部件，所有車廂共用幾何；換車時將閒置網格快取控制在 18 件。整份 86 MB 資產不會隨首頁一次下載。

重建：

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 --python prototypes/taiwan-3d/scripts/build-blender-map-fleet.py
```

來源與簡化範圍請見原車庫的 `README.md`、`references.json`。原圖沒有封裝為貼圖。地圖衍生檔保留來源連結，不改變原資料的授權或適用範圍。

## 2026-09-08 藍皮外觀校正

本輪只更新 `blue` 與 `bluecoach`，來源為 Blender 精修包的 R135 第二輪修正版及復古客車。機車改短鼻、外凸燈組、深海軍藍、白飛翼及黃黑 V 紋；客車為全藍側牆、白腰線與銀灰拱頂。
地圖沿用既有規則移除範例車籍文字，由行車資料顯示車次；燈座、字牌框及塗裝仍保留。單車目標 8,000 三角形。逐款來源 Raw 與 release SHA 記錄在 manifest，不改班表或編組規則。

增量重建：`Blender -b --python scripts/import_blender_map.py -- --source <Blender 精修包> --models blue bluecoach`。
