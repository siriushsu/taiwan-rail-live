# 南迴海岸棕櫚零件庫（第三版，2026-09-28）

目的：`rail-3d/garage-scenes/south-coast.js`（車庫「南迴（藍皮）」景）的椰子與檳榔。使用者 09-28 原話：
「那個樹看起來像是個笑話 這什麼東西？」「細節還是都需要用blender製作」「只有藍皮的樹 感覺還是不太對」
「棕梠樹的比例跟樣貌太奇怪 其他的樹不用動」。主對話讀截圖歸納的問題：椰子葉從頂端直接往下垂（像濕拖把）、
葉色藍綠、檳榔只有一小撮刺刺的星形葉（像牙籤）、棕櫚比旁邊的闊葉樹矮一大截。

這一版把**整棵樹**（樹幹、環紋、樹冠、檳榔葉鞘、椰子果、枯葉）在 Blender 建好；執行期只做擺放：
位置、yaw、等比縮放、每棵一個色調深淺（`instanceColor`）。

## 零件

5 款樹，每款是同一個前綴的幾個子零件（`<款>/<子零件>`）：

| 款 | 子零件 | 三角形（上限） | 原生高度 | 樹冠寬 |
|---|---|---|---|---|
| `coco-straight` 直幹椰子 | trunk rings knob fronds young dry fruit | 784（900） | 2.81 | 2.28 |
| `coco-curved-a` 彎幹椰子 | 同上 | 804（900） | 2.85 | 2.27 |
| `coco-curved-b` 彎幹椰子 | 同上 | 808（900） | 2.89 | 2.27 |
| `betel-a` 檳榔 | trunk rings shaft fronds young | 422（450） | 3.16 | 1.72 |
| `betel-b` 檳榔 | 同上 | 442（450） | 3.25 | 1.76 |

（`output/palms/build/shape-report.json` 是每次建置的完整量測：葉數、葉片上揚角、相鄰葉最大方位角缺口、
椰子果位置…）三角形上限是主對話派工訂的。

- 子零件：trunk 樹幹淺色段／rings 環紋（葉痕深色細帶）／knob 椰子樹冠基部／shaft 檳榔葉鞘（亮綠）／
  fronds 成熟葉／young 新葉／dry 乾掉下垂的褐葉／fruit 椰子果。
- `garage-parts-v1` 只有位置＋法向量、沒有頂點色，所以顏色不同的部分分成不同子零件存；
  `south-coast.js` 載入後把同一款的子零件接成一份幾何、每個子零件上一個頂點色
  （顏色表 `PALM_COLORS` 在 `south-coast.js`，只有那一份），**一款樹＝一個 InstancedMesh＝一次 draw call**。
- 局部座標：原點＝樹幹底部中心，+Z 朝上，椰子的傾斜／彎曲一律朝局部 +X（場景用 yaw 把 +X 轉向海側）。
  單位＝場景單位（`UNITS_PER_METER`=0.4435；站姿乘客 0.754＝1.70 m）。
- 葉片：葉軸在「該葉方位角的鉛直面」內先上揚、拱到最高後外側才下垂；小葉一段葉軸一片三角形，
  Λ 形斷面、相鄰小葉間留 V 形缺口。小葉是單面三角形，場景材質用 DoubleSide。

闊葉樹 4 個零件（`broadleaf-a/b-trunk/canopy`）也在同一份資產裡，由
`scripts/blender/coast-20260928/build_coast_flora.py` 建；`build_palms.py` 不重建它們，
從現有資產把那 4 段 bytes 原封不動搬進新檔（寫完再比一次 sha256）。

## 場景裡的尺寸與擺放（`south-coast.js`）

- 每棵等比縮放到 `COCO_HEIGHT=[2.8,3.5]`、`BETEL_HEIGHT=[3.0,3.7]`（前排）；後排小椰子再乘 `BACK_ROW_SCALE`=.45。
  這組數字是 09-28 這一輪為了滿足主對話派工的驗收條件「棕櫚不比同一帶的闊葉樹矮」而訂的，**不是使用者給的數字**
  （更早的「檳榔 2.2～2.8、椰子 1.8～2.6」也是主對話 09-27 派工時自己訂的，舊註解寫成使用者裁示是錯的）。
- 哪棵種在哪、是哪一種：跟 HEAD（c3050359）逐棵相同，植被迴圈的 `rand()` 次數與順序不變
  （闊葉樹、礫石等後續道具的位置因此不動）；`verify_garage_south_coast_stop.mjs` 用字面雜湊鎖住這三件事。

## 重跑方式

```sh
# 建 5 款棕櫚、自檢（三角形上限、無退化三角形、樹冠造型量測），直接覆寫正式資產（數秒）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/build_palms.py

# 審查圖：讀正式資產，5 款各接成一棵（顏色讀 south-coast.js 的 PALM_COLORS），
# 側面／斜上 35°／正上三張，每款左邊一根站姿乘客比例尺。純視覺複核，不是驗收。
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/render_palms_sheet.py [-- <輸出前綴>]

# 驗收
node --no-warnings scripts/verify_garage_south_coast_stop.mjs     # 棕櫚判準在這支
node --no-warnings scripts/verify_garage_south_coast.mjs
node --no-warnings scripts/verify_garage_follow_camera.mjs
node --no-warnings scripts/verify_garage_train_lights.mjs
```

輸出：
- 正式（進 repo）：`rail-3d/assets/garage-palms-v1/palms.json` + `palms.bin.gz`（schema `garage-parts-v1`）。
- 中繼：`output/palms/build/palms.raw.bin`、`.meta.json`、`.blend`、`shape-report.json`；`output/palms/NOTES.md`
  （施工筆記，append-only）；`output/palms/palms-sheet-{side,oblique,top}.png`。
  注意：`output/` 在這棵樹**沒有**被 `.gitignore` 擋（`git status` 顯示 `?? output/`），commit 時不要整包 add。

`palms.json` 沒有 cache-buster：換資產後，已經開著的預覽頁要強制重新整理才會拿到新檔。
