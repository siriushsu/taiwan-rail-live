# 南迴海岸棕櫚零件庫 2026-09-28

目的：取代 `rail-3d/garage-scenes/south-coast.js` 原本用程式拼出的棕櫚樹（細方柱樹幹＋薄三角形葉片，
從側面看葉片變成一條線、樹幹比山還高，使用者：「那個樹看起來像是個笑話」）。改用 Blender 建模、
真正有體積的資產，供執行期 `InstancedMesh` 使用（跟乘客零件庫、集電弓走同一套 `garage-parts-v1`
schema 與載入器 `rail-3d/garage-model.js` 的 `loadGarageParts`）。

6 個零件：`betel-trunk`／`betel-crownshaft`／`betel-fronds`（檳榔，含最好認的綠色葉鞘）、
`coco-trunk`／`coco-fronds`／`coco-fruit`（椰子，含樹冠下的椰子果）。沒有頂點色／材質貼圖，
顏色由 `south-coast.js` 的 `InstancedMesh` 材質決定（同一份幾何、六個各自上色的 InstancedMesh）。

沿用 `scripts/blender/people-20260924/build_people.py` 的自製匯出模式（`calc_loop_triangles` +
`corner_normals`，非索引匯出、24 bytes/vertex＝pos.xyz+normal.xyz）與 P5／P6 自檢（無退化三角形、
逐零件朝外且封閉）；`blender_parts.py` 的 `mesh()` 原語（`bevel=0`、`smooth=True`）。

## 執行期幾何慣例

- **trunk／crownshaft**：unit 高度 z:0→1（底 z=0、頂 z=1，兩端封蓋的漸縮圓柱），JS 端
  `instance.scale=[半徑,半徑,高度]`——跟舊版 `trunkGeo`（`CylinderGeometry` 的 unit 高度慣例）
  同一套，最小改動接進既有的 instance 陣列寫法。
- **fronds**：unit 長度沿 +X（hub 在 x=0，葉尖在 x=1），剖面是「風箏」四點（左尖 L／上摺痕 Top／
  右尖 R／下摺痕 Bot，形成有厚度的摺痕造型），3 環（base/mid/tip）內建一點弧度（先拱起、葉尖再垂/
  降），**JS 端 instance.scale 三軸相同＝len**（均勻縮放）——跟舊版 `frondGeo` 的 `[len,len,1]`
  不同，均勻縮放才能讓摺痕厚度跟著葉長等比例縮放，不會小葉子摺痕過深、大葉子摺痕過淺。
- **fruit**：unit 半徑 1 的 icosphere（0 細分，20 面），JS 端 `instance.scale=[r,r,r]`。

真正的彎曲樹幹（椰子「略彎」）刻意沒有烘進幾何：非均勻的 instance scale（半徑用 xy、高度用 z）
會讓烘進局部 X/Y 的彎曲偏移量跟著半徑縮放而不是高度縮放，各棵樹的彎曲角度會因此不一致而失真；
改用場景既有的 per-instance `lean`（繞世界 X 軸整棵旋轉）表現「傾斜」，簡單、角度不失真，
且真實的椰子樹本來就常見「直幹但傾斜」的樣子。

## 三角形預算（`build_palms.py` 內建自檢，2026-09-28 實測）

- 檳榔整棵＝trunk(28)+crownshaft(28)+9 片葉×20＝**236**（上限 350）。
- 椰子整棵＝trunk(28)+13 片葉×20+8 顆果×20＝**448**（上限 600）。

## 重跑方式

```sh
# 建 6 個零件、自檢三角形預算/無退化三角形/逐零件朝外封閉，寫出中繼檔與正式資產（快，數秒）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/build_palms.py

# 讀已安裝的正式資產，組一棵中等尺寸檳榔＋一棵中等尺寸椰子（跟 south-coast.js 同量級公式），
# 各配一個簡化人形比例尺（身高 .754，取自 south-coast.js peopleBounds() 量到的站姿乘客身高），
# 拍側面＋斜上方兩張到 Desktop（純視覺複核，不是最終驗收——最終驗收讀瀏覽器裡真正的 InstancedMesh）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/render_palms_sheet.py

# 驗收（南迴景的棕櫚判準；停站/候車/看板等其餘判準不受影響）
node --no-warnings scripts/verify_garage_south_coast_stop.mjs
node --no-warnings scripts/verify_garage_south_coast.mjs
node --no-warnings scripts/verify_garage_follow_camera.mjs
node --no-warnings scripts/verify_garage_train_lights.mjs
```

固定輸出（不受參數控制）：
- `output/palms/NOTES.md`：施工筆記（append-only）。
- `output/palms/build/palms.raw.bin` + `.meta.json` + `.blend`：中繼產物，不進 repo。
- `/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/palms-sheet-{side,oblique}.png`：審查圖（兩檔，
  不是單一 `palms-sheet.png`——省去在 Blender 內用像素陣列合成兩張圖的複雜度，兩張各自看過）。
- `output/palms/palms-sheet.blend`：`render_palms_sheet.py` 的場景另存。

正式輸出（會進 repo）：`rail-3d/assets/garage-palms-v1/palms.json` + `palms.bin.gz`，schema
`garage-parts-v1`，由 `build_palms.py` 直接寫出（無安裝步驟，沒有既有資產要合併）。

## 物種與尺寸公式（`rail-3d/garage-scenes/south-coast.js` 的 `palmSize()`）

高度／樹冠直徑取自使用者裁示：檳榔整棵 2.2～2.8、椰子 1.8～2.6（縮景比例，跟舊闊葉樹同一種壓縮，
不是真實比例）；樹冠直徑＝整棵高度 ×（檳榔 .35～.55、椰子 .5～.9）。兩者都用同一個 `s`
（原本就用來決定樹幹粗細的隨機值）內插，樹越高冠越寬是同一個尺寸因子帶出來的，不是獨立抽樣。

檳榔／椰子的物種與是否要種（密度控制）改成看已抽出的 `x/y/z/s`（地形高度、既有隨機值）與樹的序號
`i` 做**決定性**判斷（雜湊／取餘數，不呼叫新的 `rand()`），跟原本「每次都種、g=i%3 決定顏色」比起來，
`rand()` 呼叫的次數與順序完全不變——場景裡棕櫚以外的所有道具（欄杆、石頭…）沿用同一條隨機序列，
位置與尺寸逐一相同。
