# EMU3000 車門可開闔機構 2026-09-24

目的：讓車庫 emu3000（頭／尾共用同一份資產）的側門在程式裡可以真的開闔——車殼真的挖洞、門後有
小空間、門扇本體可透過 metadata 由 shader 端位移滑動——供高架月台停站開門功能（車庫 viaduct
scene 03）使用。本輪只做「資產本身可開闔」，不含場景／App 觸發開闔時機的產品邏輯。

來源：以只讀方式讀取 `scripts/blender/emu3000-20260912/`（車頭考據修訂快照）重建 emu3000 頭車幾何，
再疊加車門結構；快照本身完全不動，不修改其原檔。本輪未新增外部照片考據，車門內部機構是合理簡化
（見下方「與快照的差異」第 4 點），不是逐車號查證的結果。

## 重跑方式

```sh
# 只產資產＋.blend，不算繪（快）
FLEET_RENDER=0 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/emu3000-doors-20260924/build_doors.py -- \
  /absolute/output/directory   # 預設 output/emu3000-doors/build

# 額外算繪 4 張驗收圖（較慢）
FLEET_RENDER=1 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/emu3000-doors-20260924/build_doors.py -- \
  /absolute/output/directory

# 「改動前」對照圖（round 3 D12 用，跟上面四張用同一套相機／太陽燈）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/emu3000-doors-20260924/render_baseline.py

# 把 build 輸出併入正式資產（只換 mesh 欄位＋新增 doors 欄位，其餘既有欄位原樣保留）
python3 scripts/blender/emu3000-doors-20260924/install_assets.py [build目錄，預設 output/emu3000-doors/build]

# 中間車與集電弓（見下方「中間車與集電弓」一節）。中間車讀的是已併入的頭車資產，頭車要先裝好
python3 scripts/blender/emu3000-doors-20260924/build_mid.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/emu3000-doors-20260924/build_pantograph.py
python3 scripts/blender/emu3000-doors-20260924/install_assets.py mid          # 預設讀 output/emu3000-doors/build-mid
python3 scripts/blender/emu3000-doors-20260924/install_assets.py pantograph   # 預設讀 output/emu3000-doors/build-pantograph
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python scripts/blender/emu3000-doors-20260924/render_mid_pantograph.py   # renders/10~13（讀已併入的資產）

# 驗收
node --no-warnings scripts/verify_garage_stop_assets.mjs D M # D1～D12 頭車門＋M1～M9 中間車與集電弓，共 21 項
node --no-warnings scripts/verify_garage_assets.mjs          # 62 款資產完整性
```

固定輸出（不受參數控制，皆在 `output/emu3000-doors/`，不進 repo）：`NOTES.md`（施工筆記，含依
`docs/garage-model-fidelity-20260912.md` 格式寫的參考／來源／差異／修改／驗證與逐項施工紀錄）、
`emu3000-doors.blend`（可編修場景另存）、`renders/01~04*.png`（FLEET_RENDER=1 時的四張驗收算繪：
關門、半開、全開、門內斜角特寫）、`renders/00-before-closed.png`（`render_baseline.py` 另外產生，
純快照未開門幾何，供 D12 與人工目視比對「改動前後」用）。

正式輸出（會進 repo）：`rail-3d/assets/garage-blender-v1/emu3000.{json,bin.gz}`——由 `install_assets.py`
寫入，只更新 `mesh.sha256`／`vertexCount`／`triangleCount`／`drawGroups[].start+count` 與新增的頂層
`doors` 欄位，其餘既有欄位（bounds、sizeM、specification、reference、formation……）原封不動搬過去；
不改 `emu3000.webp`，不跑 `import_garage_blender.py`（會重匯全部 62 款）。
併入時另外把門口以外的外觀改回 BASE（改動前的 commit）：範圍沒變、只是切法不同的平面整塊換回 BASE 的
三角形，其餘逐角把法向量改回 BASE 的內插值；位置不動、三角形數不變（見下方第 8 點）。
所以正式資產的 sha256 與 build 輸出的 `meta.json` 不同，這是預期的。

## 車門與門內尺寸（模型公尺，座標慣例：+X 車前、+Y 左、+Z 上、輪底 z=0，沿用快照）

| 項目 | 數值 |
| --- | --- |
| 門扇尺寸（寬×高） | 0.625 × 2.2 |
| 門扇底部 z ／中心 z | 0.92 ／ 2.02 |
| 門洞切割尺寸（寬×高） | 0.635 × 2.21（每邊多留 .005 淨空，EXACT 布林） |
| 車內地板 z（＝門檻高，D8 驗收值） | 0.921 |
| 門廳天花板 z | 約 3.12 |
| 門廳淨深（\|y\|，車寬半幅 1.5155 往車內收） | 1.425 → 0.875（外側貼車殼實際曲面，見下方第 7 點） |
| 車廂中心側隔間走道開口（\|y\|，寬 0.55） | 0.875 ~ 1.225 |
| 壁袋（門扇全開收納淨空帶，\|y\|） | 1.29 ~ 1.40 |
| 門扇可動 ranges（門扇＋玻璃＋框條＋把手，快照原幾何）範圍（\|y\|） | 1.454 ~ 1.5155（把手凸到車寬邊界；量自正式資產） |
| 門扇內收量 inward（先退，往車內） | 0.14 |
| 門扇滑移量 slide travel（再滑，往車廂中心） | 0.66 |
| 全開總位移 | inward + slide × travel（= 0.14 退 ＋ 0.66 滑，兩段式） |
| 四扇門中心 x／側別 | R1 (-4.2,-1)／L1 (-4.2,+1)／R2 (3.44,-1)／L2 (3.44,+1) |
| 三角形數 | 56106（BASE）→ 59006（本輪，上限 62106） |

`doors` metadata 完整結構（`schema:"garage-doors-v1"`, `type:"slide-pocket"`）見
`rail-3d/assets/garage-blender-v1/emu3000.json` 的頂層 `doors` 欄位，或
`output/emu3000-doors/build/emu3000-doors.meta.json`。

## 與快照的差異

1. 車殼從「實心＋貼死不動的門扇貼片」改為四個真實 EXACT 布林開洞，門後有可進出的小空間（門廳：
   地板、天花板、端牆、隔間、扶手、頂燈，材質全部沿用既有分組，未新增 drawGroup）。
2. 原本 4 片獨立門扇（`side_door` 標記）連同門窗玻璃、框條、把手，維持快照原本的幾何與位置
   （\|y\| 1.454～1.5155），整組成為可由 `doors` metadata 控制、shader 端位移的可動 ranges。
3. 車寬邊界（驗收 D2 要求與 BASE 逐分量差 ≤1e-4）量的是關門狀態，把手本身就撐住邊界，不另加零件。
   round 1 曾把門扇壓進 \|y\| 1.454～1.478 的薄層、再加一個固定把手座複製件撐邊界；全開時那個複製件
   浮在門口中央、像門沒開，round 2 已移除（D5 加嚴後會抓到）。
4. **門扇滑動方向是推論簡化，不是特定車號的考據結果**：本輪選擇「先退 0.14 再往車廂中心滑移 0.66」
   （壁袋式），是通勤電聯車常見機構的合理猜測；日立官方設計頁（`emu3000-20260912/README.md` 引用的
   來源）沒有描述這批車門的內部機構細節。之後如果查到確切機構（例如外掛式而非壁袋式、或滑動方向
   相反），需要同時更新 `doors` metadata 的 `inward`／`slide`／`travel` 三個向量與可動頂點範圍，
   不能只改算繪相機角度。
5. 腰帶色帶（連續腰線）在四個門洞位置各補切一個缺口，避免色帶浮空貫穿開著的門口。
6. 車體其餘外觀（鼻端曲面、前窗、燈具、車頂、腰帶走向本身）沿用快照既有考據結果，本輪未變更、
   未重新查證。
7. **（round 3）門廳地板／天花板／端牆／隔間牆框條改貼車殼實際曲面、不再是常數 `|y|=1.425` 平板**：
   round 2 這四個物件的外側都做在車殼標稱外表面（常數 1.425），在車殼上下圓弧、車端圓角處會凸出
   實際曲面最多 7.8cm，平直處又跟車殼共面造成 z-fighting／閃爍黑線（coordinator 用新增的 D12
   逐格比對抓到）。round 3 改成對「挖洞前車殼往內縮 12mm 的曲面」做 EXACT INTERSECT 裁切，門洞
   以外一律貼齊實際曲面內側、不再是平板。同輪在 Blender 裡用 Data Transfer 從挖洞前的車殼抄回法向量，
   只救回一部分，其餘見第 8 點；嘗試過程記在 `output/emu3000-doors/NOTES.md` 的「Round 3 完整記錄」。
8. **（round 4，併入時處理）門口以外的外觀改回 BASE**：EXACT 布林把只有 921 面的車殼整片重新三角化，
   造成兩種跟門無關的外觀改變，`install_assets.py` 併入時各自改回：
   - 車端端牆（x=-4.8，94 個三角形）範圍、頂點、面積都沒變，只有切法不同；它的角落法向量跟圓角一起
     平滑、往外傾 45～50°，整面明暗由切法決定，所以整塊換回 BASE 的三角形（`restore_base_triangulation`）。
     Blender 裡試過的抄法向量做法在門 1 端一律零反應，原因就是角落法向量本來就一樣。
   - 車頭側面與鼻部的折線被重新平滑：逐角找 BASE 裡同群組、同平面、同朝向的三角形，按重心座標
     內插出 BASE 的法向量寫回（`restore_base_normals`）。
   結果：D12 在門口外（含 6 cm 邊界）逐格與 BASE 相同；法向量門檻從 12° 收緊到 2° 也全過。

## 中間車與集電弓（2026-09-26）

正式輸出：`rail-3d/assets/garage-blender-v1/emu3000-mid.{json,bin.gz}`（中間車，動力車）與
`emu3000-pantograph.{json,bin.gz}`（單臂集電弓零件庫）。頭車 `emu3000.*` 不動。

**中間車 `emu3000-mid`（`build_mid.py`，純 Python，不用 Blender）**

1. 直接讀已併入的頭車資產（含上面第 8 點的還原），取 x≤0 那半（含門 1），對 x=0 鏡射出另一半；
   跨過 x=0 的三角形沿平面裁開，接縫逐點重合。沒有重做布林，所以門洞、門廳、壁袋和頭車門 1 那端一模一樣。
2. 車門：R1／L1 在 x=−4.2、往 +x 滑；R2／L2 在 x=+4.2（鏡射），往 −x 滑。都往車廂中心收。
3. 頭燈、尾燈角色的 drawGroup 整組拿掉，`lighting: null`；其餘 drawGroup 名稱、順序、材質值都沿用頭車。
4. 車頂只留一個車頂單元（+X 端）。−X 端那座用 roof 群組 x<0、z>3.55 的三角形量出腳印（外擴 1 cm），
   腳印內 z≥3.385 的三角形不分群組全部刪除；底下 z=3.40 的車頂面本來就連續，刪完是平車頂。
5. 鏡射接縫正中那扇窗（window9）原本兩半玻璃貼在一起、沒有窗柱：x<0 那半的玻璃＋窗框整塊往外
   平移 0.105，鏡射後兩側留出 0.2134 寬的窗柱，跟其他窗柱同寬。平移在外層窗框 T 形接點留下的
   約 0.5 mm 裂縫，用縫合三角形補起來（第三輪）。
6. 集電弓座 `pantograph.mount = [−2.9881, 0, 3.68]`：x＝−X 端轉向架兩軸（−3.5252、−2.4510）的平均，
   z＝該點車頂 3.40＋底座高 `BASE_H` 0.28。`features.pantographsOnThisAsset: 1`、`articulatedSections: 1`。
7. 37380 個三角形（上限 56106，M8）。

**集電弓 `emu3000-pantograph`（`build_pantograph.py`，Blender）**

- `schema: garage-parts-v1`，四個部件 base／lower／upper／head，各自以自己的轉軸為局部原點，由場景端組裝。
- `rig = {lower: 1.10, upper: .81, headRise: .052}`：方案 A（使用者 09-25 裁示，電車線降到離軌頂約
  1.95 世界單位）的字面值。base 從下臂轉軸 z=0 往下延伸 `BASE_H`（0.28）到車頂；這個值 `build_mid.py`
  也用來算 mount.z，兩邊必須一致。
- 256 個三角形（上限 1500）。電車線 1.95 伸不伸得到由 M7 驗（兩節連桿，肘朝 +x）。

## 已知限制

- 場景／App 目前沒有接線播放這個開闔動畫（跟車卡、車庫展示尚未讀取 `doors` metadata）；本輪只交付
  「資產本身可以被開闔」，觸發時機的產品邏輯不在本輪範圍。
- 4 張驗收算繪用同一組正交相機與攝影棚燈光，門扇與門廳都是相近的淺灰材質，肉眼快速掃視「關門」
  與「全開」兩張圖可能覺得差異不明顯（門扇全開後確實收進壁袋、被車殼實心外殼擋住視線，這是壁袋式
  滑門的正常表現，不是穿幫）。像素比對顯示三張圖之間存在隨開度單調遞增的真實差異（01 vs 02 有
  25831 個像素 diff>20、01 vs 03 有 45161 個），細節與洋紅材質追蹤診斷記在 `output/emu3000-doors/NOTES.md`
  第 5 節。這是算繪呈現上的已知限制，不是機構缺陷。
- 未做瀏覽器／App 場景實際接線驗收；本輪驗收方式為 `verify_garage_stop_assets.mjs D`（12 項幾何
  自動化檢查）＋ `verify_garage_assets.mjs`（62 款資產完整性）＋ 5 張算繪圖（00 改動前對照＋01~04）
  人工檢視。
- **`renders/` 的 Cycles 圖來自 `.blend`，不含併入時的還原（第 8 點）**：04 門內特寫裡鼻端那條淡漸層
  就是還原前的樣子，正式資產裡已經改回 BASE。要看正式資產，用 D12 的光線追蹤或車庫頁。
- 中間車中央窗柱的內層窗框（|y|≈1.434）在平移後留了 4 道縫，只有從車廂裡面往外看才看得到；
  外觀用 0.5 mm 光線掃描驗過是乾淨的（第三輪只補了外層）。
- 集電弓底座高 `BASE_H` 0.28 與底座、礙子尺寸是示意值，沒有考據；部件外形也是簡化的示意等級。
- `renders/10~13` 是 Blender Cycles 算繪，讀的是已併入的資產；集電弓姿勢由 `render_mid_pantograph.py`
  自己解兩節連桿（取肘朝前那組解），跟車庫頁實際的升降弓程式是兩份實作。
