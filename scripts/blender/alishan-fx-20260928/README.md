# 阿里山雲海＋螢火蟲零件庫 2026-09-28

目的：供車庫「阿里山之字形」場景（`rail-3d/garage-scenes/alishan.js`）用——山谷雲海與林間螢火蟲
兩個氛圍特效，全部零件（雲團、螢火蟲光點）都是 Blender 建模匯出，場景端 JS 只負責用
`InstancedMesh` 擺位置／縮放／飄動／依時段切換可見度，不做任何程序化生成的可見幾何（南迴海岸景
的棕櫚樹被使用者退件「看起來像笑話」之後，車庫計畫明訂這條鐵則）。

5 個零件，`garage-parts-v1` schema：
- `cloud-a`／`cloud-b`／`cloud-c`／`cloud-d`：4 種低面數雲團（各由數顆橢球疊成，底部較平、頂部
  圓潤蓬鬆），260/200/240/200 三角形。
- `firefly`：極小圓球光點，20 三角形，場景端用 `MeshBasicMaterial`＋`AdditiveBlending`＋
  `instanceColor` 控制亮度閃爍，本身不含材質。

沿用 `people-20260924/build_people.py` 的自製匯出模式（`calc_loop_triangles`＋`corner_normals`，
non-indexed、24 bytes/vertex＝pos.xyz+normal.xyz）與 `blender_parts.py` 的 icosphere 橢球輔助
（`bmesh.ops.create_icosphere`＋非等比 `scale`）。雲團與螢火蟲都不需要 pivot／rig——場景端直接把
整個零件當一個物件擺位置/縮放，沒有姿勢合成，比 people／pantograph 簡單很多。

**重要 gotcha**：`bmesh.ops.create_icosphere` 的 `subdivisions` 是 **1-indexed**
（1→20 個三角形的基礎二十面體，2→80 面），跟 `THREE.IcosahedronGeometry(radius, detail)` 的
0-indexed 慣例不同——本次是靠 build 腳本印出的實際三角形數才發現算錯，重新建模前留意這個換算。

## 重跑方式

```sh
# 建 5 個零件、P4/P5/P6 自檢、寫出中繼 .blend 與正式資產（快，數秒）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/alishan-fx-20260928/build_alishan_fx.py

# 讀已安裝的正式資產（不是 build 階段的 .blend——沿用 people 系列的教訓：匯出後的檔案才是唯一
# 真相）重建幾何，畫三張審查圖（overview／low-angle／firefly 特寫）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/alishan-fx-20260928/render_alishan_fx_sheet.py

# 場景整合驗收（四個判準：雲海時段／雲海位置／雲海飄動／螢火蟲，見腳本內註解）
node scripts/verify_garage_alishan_fx.mjs
# 既有阿里山場景 baseline 迴歸（改動雲/螢火蟲資產或 alishan.js 之後都要重跑，確認零回歸）
node scripts/verify_garage_alishan.mjs
```

固定輸出（不受參數控制）：
- `output/alishan-fx/NOTES.md`：施工筆記（append-only）。
- `output/alishan-fx/build/alishan-fx.raw.bin` + `.meta.json` + `.blend`：中繼產物，不進 repo。
- `/Users/xuxiang/Desktop/車庫B-檢查點/02-阿里山/fx-sheet-overview.png`：4 種雲團一字排開，各自
  旁邊配一位 `garage-people-v1` 站姿乘客當比例尺，斜角俯視看整體圓潤蓬鬆的頂部。
- `.../fx-sheet-medium.png`：只留一顆雲（cloud-a）＋一位參考乘客站在正旁邊，鏡頭拉近到人可以看
  清楚的距離，直接讀出「雲比人大幾倍」的比例感（總覽圖人縮成色塊看不清楚，補這張中距特寫）。
- `.../fx-sheet-low-angle.png`：單獨一顆雲＋一位參考乘客，相機貼地水平看過去，專看「底部較平」
  的剪影——呼應阿里山場景實際會用到的低角度截圖構圖。
- `.../fx-sheet-firefly.png`：firefly 零件單獨放大一格（暗色背景），確認渾圓、讀起來像光點。

正式輸出（會進 repo）：`rail-3d/assets/garage-alishan-fx-v1/alishan-fx.json` + `alishan-fx.bin.gz`，
`garage-parts-v1` schema，由 `build_alishan_fx.py` 直接寫出（沒有既有資料要合併，一次到位）。

## 審圖兩輪（2026-09-28）

第一輪：雲看起來像脫節的扁平岩石／冰塊——body 橢球太寬太扁、跟頂部的 puff 分離，相鄰雲團
（`fx-sheet-overview.png` 的 `COL=6` 排列）彼此重疊。

第二輪修正：body 橢球改成大小相近、只輕度壓扁（.75～.95× 而非 .22～.3×）、緊緊疊在一起；頂部
puff 明確疊進 body 上緣，不再分離；`render_alishan_fx_sheet.py` 的 Workbench 燈光從 `FLAT` 改
`STUDIO`、關閉 `show_cavity`（`FLAT`＋cavity 在雲這種大面積淺色物體上陰影對比過硬，容易讀成
石頭而非雲）；一覽圖 `COL` 間距加大避免相鄰雲團重疊。結果可接受（低面數但符合本專案 Q 版
美學），決定不用第三輪，留給場景實際整合後的截圖做最終視覺判斷（見下方「與場景整合的教訓」）。

同一輪順手修掉 `fx-sheet-overview.png` 的參考乘客站姿無頭的 bug——原因是 `head`／`hair-*` 零件
沒有套自己的 pivot 平移，跟本次雲海/螢火蟲的建模邏輯無關，是重用 `garage-people-v1` 組裝程式碼
時的既有裝配錯誤，順手修在這支 render 腳本裡（不影響 `garage-people-v1` 正式資產本身）。

## 與場景整合的教訓（寫給之後要調整雲團形狀/大小的人）

雲團在 `alishan.js` 場景端的擺放規則跟這裡建的模型形狀緊密耦合，改模型前務必先讀
`rail-3d/garage-scenes/alishan.js` 裡 `cloudLocalRadius`／`RADIUS_MIN`／`RADIUS_MAX`／
`RAIL_BUFFER`／`LIFT` 這組常數的用法：

- 場景端用**局部包圍盒最大半軸**（`geometry.boundingBox` 算出來，不是手抄常數）當「這顆雲的
  模型半徑」，再用 `radius/cloudLocalRadius` 算縮放比例——**改模型的比例尺或整體大小會直接改變
  場景裡雲的實際縮放**，不需要同步修改 JS 常數，但改完一定要重跑
  `node scripts/verify_garage_alishan_fx.mjs` 的「阿里山-雲海位置」判準（會動態掃全程最近點，
  量跟車鏡頭下列車的遮擋比例，門檻 ≥0.9）。
- 雲團的「頂部圓潤、底部較平」造型是刻意設計，因為場景端拿雲的局部包圍盒半徑當縮放依據，
  且用一個簡單球心＋半徑模型判斷離軌淨空與地面高度（`ground=groundHeight(x,y)`，
  `z=ground+radius*LIFT`）——如果之後把雲改成非常不對稱或扁平的形狀，包圍盒半徑會跟視覺大小
  脫節，場景端的淨空/離地計算會變得不準，需要一併檢視。
- 正交相機下「雲跟火車的世界座標距離遠」不代表「畫面上不重疊」——場景整合時曾經把雲放在一片
  跟軌道同高甚至更高的山坡（誤用「附近有沒有更高地形」當谷地判準），跟車鏡頭下列車遮擋比例
  一度只有 0.09～0.40（門檻 ≥0.9）。改模型或改放置規則後，一律用
  `verify_garage_alishan_fx.mjs` 的動態最近點掃描重新驗證，不要只看世界座標距離或單一時間點的
  肉眼截圖。

## 第三輪：協調端退件重做（同日稍後，2026-09-28）

協調端看了場景實際截圖後退件兩項（不是微調參數，是整個放置演算法重做）：
- 雲海（`4-側面低角度.png`）看起來是牆角一團不透明棉花球，不是雲海——要求「山頭浮在一片雲海上」
  的經典構圖：連續扁平半透明雲層沿山塊下坡端與整圈外圍鋪開，邊緣可以互相重疊融合、可以稍微
  溢出板子邊緣貼著底座側面。
- 螢火蟲（`3-夜晚近景.png`）幾乎看不見——要求跟車夜景鏡頭下同時看得到一打以上，柔光光暈、
  更亮更大、貼近軌道兩側 0.8~2.5 單位分布。

**Blender 側**：`make_cloud()` 整個換成扁平「薄餅狀」設計（多顆橢球徑向排列成扁平簇），新增
P7 自檢（height/width≤0.4，`sys.exit()` 不過）。三角數不變(260/200/240/200/20=920)，新
SHA256 `6f1df71f6456b9bf6662a6663c062338d47c2ec6d51e50ee888a4e78fc2acede`。

**場景端（`alishan.js`）雲團擺放整個重寫**（不再沿用上面「與場景整合的教訓」那組
`cloudLocalRadius`／`RADIUS_MIN`／`RADIUS_MAX`／`RAIL_BUFFER`／`LIFT` 常數，那組是第一版
「山谷小口袋」擺法專用，已被取代）：
- 沿板子真實外框（重用 skirt 那條 `boundary`／`positions` 多邊形，算累積弧長）鋪成一整圈，
  分 12 段，下坡端(y<-8)加密。
- 雲頂天花板改成**全域常數** `CLOUD_CEIL = minTrackZ(全路網最低軌道) - 0.8`，取代舊版「當地
  最近軌道」局部天花板——結構上保證雲永遠低於全路網任一點的軌道。
- 雲底下限改用 `BASE_BOTTOM=-1.6`（skirt 側面畫到的物理下緣），不再用 `groundHeight(x,y)`
  ——新雲團大多落在地形網格範圍以外，那裡的 `groundHeight` 只是外推值沒有實體意義。
- `radius` 語意變更為**水平半寬**（不再是舊版近似球半徑），新增 `halfHeight`（垂直半高）
  欄位——牽動 `verify_garage_alishan_fx.mjs` 既有「阿里山-雲海位置」判準的 `groundOk` 公式
  （改用 `halfHeight` 而非 `radius`，否則會把「雲很寬」誤判成「探到地底下」）。

**螢火蟲整個重寫**：
- 拒絕取樣範圍從「離軌≥2.8（避開軌道走廊）」反轉成「離軌 0.8~2.5」，改成沿
  `route.sample(s)` 取點＋垂直於 heading 偏移，取代舊版整個 bounding box 的亂數點。
- 新增「光暈」第二層 `InstancedMesh`（同一個螢火蟲網格，放大~4.5倍、更暗、additive
  blending）疊在核心層上，兩層疊加自然形成中心亮、外圍暗的放射狀衰減。
- **z 座標踩到的關鍵坑**：`z`（螢火蟲高度）在新舊兩版都是寫死的 `.2+rand()*1`，但舊版
  螢火蟲刻意避開軌道走廊、撒點範圍集中在地勢平緩處，這個絕對世界高度剛好大多還在地面之上；
  這次改成貼著軌道（沿整條之字形路線，含爬升到 10+ 高度的路段）撒點後，同一個絕對高度公式
  會讓大部分螢火蟲被埋在爬升段的地形網格底下（三角形數/draw call 確實有算，像素卻完全被地形
  擋住，`fireflyVisible(true)`/`(false)` 兩張截圖逐 pixel diff 得到的變動像素數是 0——這個
  「有算圖但零像素差異」的訊號才抓到問題不是遮擋巧合而是系統性埋在地下）。修法：`z` 改成
  「離當地地面的相對高度」，實際世界高度＝`groundHeight(x,y)＋z`，在 `updateFireflies` 裡
  合成，`z` 本身數值範圍不變（跟既有「阿里山-螢火蟲」判準的高度區間定義維持一致）。
- 亮度/光暈強化：核心 `.4+br*2`→`.45+br*2.2`、光暈 `.08+br*.55`→`.1+br*.65`、光暈縮放倍率
  3.6~4.8×→4.2~5.6×。FIREFLY_COUNT 92→120（卡在既有「阿里山-螢火蟲」判準數量區間 60~120
  上緣，沒動那條判準本身）。
- 新增 `setForceFireflies`(fx 物件)／`fireflyVisible`(main.js `window.alishanPreview`)，
  跟既有 `cloudsVisible` 同一個模式——驗收用強制開關，不受時段影響。

**驗收新增兩條判準**（`verify_garage_alishan_fx.mjs`，各自附突變測試）：
- **阿里山-雲海覆蓋**：12 段外框≥8段有雲（實測 12/12）、全部雲頂<minTrackZ、每朵
  height/width≤0.4。突變（`seg<SEGMENTS`→`seg<1`，雲全擠一段）只讓這條紅，其餘 6 條
  （含既有 4 條＋螢火蟲可見）維持綠。
- **阿里山-螢火蟲可見**：night+train+t=86.15（跟退件那張 3-夜晚近景同一顆鏡頭），對每隻
  螢火蟲的投影點做「關/開強制切換各拍一張、逐像素 diff」（跟雲海遮擋判準同一招，不用顏色
  門檻掃描——上一輪教訓：門檻掃描會把路燈/車燈也算成螢火蟲），量光暈直徑≥4px＋中心比外圍亮
  15%。實測 13/120 隻同時滿足（門檻 12）。**突變測試踩到一個坑**：第一次嘗試「亮度砍半＋
  光暈縮小到 1.05x」沒讓判準變紅——因為原本的色彩 scalar 值（如 `.45+br*2.2`，尖峰時
  超過 1.0）已經被 WebGL framebuffer 的 [0,1] clamp 頂到全白，亮度砍半後仍多半 >1.0、
  clamp 後還是全白，等於沒改到實際渲染結果；核心縮小到 1.05x 光暈倍率後單靠核心本身仍有
  ~6-10px，還是過了 4px 門檻。真正有效的突變是把 coreScale/haloScale 都乘 0.3、亮度除以
  12（讓 scalar 峰值降到遠低於 1.0 的 clamp 線，變成真正意義上的「更暗」）——才讓
  visibleCount 歸零、只有這條判準紅，其餘 6 條（含新的雲海覆蓋）維持綠。

**控制組**（兩次突變都還原、md5 核對回原檔後）：baseline `verify_garage_alishan.mjs`
66/66（兩次不同階段各重跑一次都過）；`verify_garage_alishan_fx.mjs` 7/7（原 4 條＋新 2
條＋無 JS 錯誤全綠）。5 張截圖重拍（同檔名）並逐張目視確認：雲海讀起來是連續扁平的雲海
而非棉花球（尤其側面低角度那張，整圈外框都貼著雲）；夜景近景清楚看到 8~10+ 顆帶柔光暈的
螢火蟲同時在畫面上，不再「幾乎看不見」。

## 已知取捨／未完成事項

- 雲團頂部「明顯低於附近稜線」這條比較偏視覺品味的要求，跟「跟車鏡頭下列車遮擋比例 ≥0.9」這條
  量化安全要求，在目前找到的谷地地形上有衝突（該處是平緩南側平地，`ridgeAround` 掃描不到明顯
  更高地形）。已優先滿足量化安全要求，`ridge` 數值仍算出來並存在場景診斷 state 裡供除錯，但
  沒有做成 verify 腳本的硬性判準。之後若要把雲團移到更接近山谷型地形（有明顯高於雲團的稜線）
  的區域，可以把這條也收緊成硬性判準。
- 目前只做了兩輪 Blender 審圖（未做第三輪微調），場景實際截圖（`/Users/xuxiang/Desktop/
  車庫B-檢查點/02-阿里山/1-日出全景.png` 等 5 張）已再次確認雲團在遊戲內實際材質（半透明、
  emissive 壓低陰影對比）下的觀感是可接受的柔和雲霧感，若之後要再精修形狀，建議先看那 5 張
  而不是只看 `fx-sheet-*.png`（那組圖用的是審圖階段的不透明材質，跟場景實際的半透明材質觀感
  不同）。

## 第四輪：螢火蟲改柔光、雲邊加細分（2026-09-28 05:4x，預算到頂停手）

協調端第二次退件：螢火蟲是直徑 17～24 px 的淡白硬邊八角圓盤，擠在列車旁、像氣球；雲帶近看有八角形輪廓。
- **雲**：`make_cloud()` 各 lobe 的 icosphere 細分 1→2（20→80 面），三角形預算 300→550，輪廓變圓；
  資產重建（alishan-fx.bin.gz sha256 開頭 ffe3011f10b75259）。雲海四條判準照舊全過。
- **螢火蟲**：Blender 的 `firefly` 零件仍是小小的蟲身；**光改由場景端產生**——`alishan.js` 用
  `CanvasTexture` 畫放射漸層，做成核心＋外暈兩層 `SpriteMaterial`（AdditiveBlending），黃綠色、無硬邊。
  離地高度用 `setTrainScale(1.25/primary.size.y)` 換成真實公尺（0.37～2.1 m）。
  上面第一節「場景端用 MeshBasicMaterial＋AdditiveBlending」那句只適用第一～三輪，已被取代。
- **判準**：`verify_garage_alishan_fx.mjs` 的「螢火蟲可見」加四條子判準——外暈直徑上限（實測 4.2～7.6 px，1440 寬）、
  核心 ≤3 px（1.1～2.8 px）、柔邊度（半徑 75% 處高出背景亮度 ≤ 中心的 40%，實測 .135～.382）、顏色黃綠（G>R>B、B≤0.6G）。
- **沒做完（預算到頂，照規則停手）**：突變只做了一發「外暈改回大圓盤」——尺寸上限會紅，但核心、柔邊度也跟著紅
  （核心判準用相對峰值門檻，跟外暈大小耦合），沒能各自隔離；「硬邊」「改白」兩發沒做。主對話在檢查點
  （alishan.js md5 b335f36f…）重跑：fx 11/11、alishan 66/66、sign_motion 2/2、turnouts 12/12，這就是控制組。
