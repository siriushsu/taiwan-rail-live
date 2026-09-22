# 文湖線原始網格交付 · wenhu-v1

2026-09-06。供 `prototypes/taiwan-3d/` 的地景任務接入。**這份交付完成列車資產與單段測試介面；真實軌道高程尚未取得，不能宣稱已完成真實橋面／地形對齊。**所有新增內容僅在 `prototypes/tiny-trains/`，未接入正式頁或改動地景端。

## 固定版本及入口

來源固定為 commit `e5fada341c5aecdbccb0dc29cc692b7c57a1569e`（`v0906e-train-views`）的 `tiny-trains.js`。這是上一輪已驗證的模型與貼軌修正版本，不隨另一個任務的 checkout 變動。套件可直接載入，**執行時不需要 Git、車庫 HTML、atlas 或車庫 DOM**。

| 檔案 | 用途 |
| --- | --- |
| `wenhu.mesh.bin` | 125,040 bytes；3126 頂點／1042 個三角形，未索引原始網格 |
| `wenhu.model.json` | 模型來源、屬性排布、包圍盒、軸向、比例、單車及兩節編組 |
| `wenhu.mjs` | 載入、校驗、Three `BufferGeometry`／材質／車廂工廠；由呼叫端傳入 THREE |
| `muzha-wanfang.path.json` | 木柵—萬芳社區完整區段線形、里程、方向、站點、未知高程 |
| `muzha-wanfang.geojson` | 相同路徑及站點落軌位置，供地景疊圖；二維座標，不偽填 Z |
| `path.mjs` | 依里程取座標、切線、坡度及短編組位置；不建立相機或動畫循環 |
| `data-checksums.json` | 上述四個資料輸出的 SHA-256 |
| `release.json` | 整份交付程式、資料、文件、驗證產物及唯讀 vendor 依賴雜湊 |
| `preview.html`、`preview.mjs` | 列車端 MapLibre／Three 接線測試場；合成坡度與遮擋箱 |
| `build.mjs`、`verify.mjs`、`serve.mjs` | 固定來源重建、瀏覽器驗證、本機預覽 |

地景接入只需前六個檔案；`data-checksums.json` 可一起保留。Preview／驗證程式**僅唯讀引用**地景端已固定的 `vendor/maplibre-gl.js`、CSS 與 `three.module.js`（MapLibre 5.9.0／Three r170），不載入地景端 `app.js`。原始網格模組沒有這項路徑依賴，整合端繼續使用自己的 Three 實例。

## 車型、座標與比例

第一款選 `modelId: wenhu`，文湖線 **Bombardier APM 256**；不是另一款 Matra VAL 256。沿用軌島原有 Q 版塗裝和程序式細節，沒有重新擷取照片或把照片貼在車身。

- 右手座標：**+X 車頭、+Y 車身左側、+Z 向上**。
- `[0,0,0]` 是車身長度中心投影到輪底平面的點。輪底平面為 `z=0`；不是單一輪子，也不是車頭位置。JSON 另列全部原始輪底接觸頂點。
- 原始包圍盒：`[-1.7525,-0.985,0]` 至 `[1.7525,0.985,2.007]`；尺寸 `3.505 × 1.97 × 2.007` Q 版單位。
- 本輪採 **1 單位 = 1.2893401015228427 公尺**，XYZ 等比縮放。展示車身約 **4.519 × 2.540 × 2.588 公尺**。地景若改展示尺度，車長、偏移和間距也須一起換算。
- 真車參考為 **13.78 × 2.54 × 3.53 公尺**，與展示尺度分欄。這些尺寸不提供精確輪距、車鉤位置或工程碰撞外形。[臺北市政府／捷運工程局尺寸資料](https://www.gov.taipei/News_Content.aspx?n=EEC70A4186D4C828&s=64BA8365B018394B&sms=87415A8B9CE81B16)

網格為 little-endian Float32，每頂點 40 bytes：position XYZ、normal XYZ、sRGB RGB（0–1）、gloss。頂點、法線、顏色、gloss、三角形順序逐值保留。原模型有混合繞序（712 面順向、290 面反向、40 個退化三角形），因此材質使用 **DoubleSide**；不要直接背面剔除或重算所有法線。本次交付保留原始資料，沒有以修拓樸之名改外觀。

附帶 ShaderMaterial 保留原模型的色彩、局部光照和 gloss，`depthTest=true`、`depthWrite=true`、不透明。光照是原車庫的局部展示光，尚未接地景日照／陰影；地景端可另換材質，但應保留 vertex color、法線與正確色彩空間。

## 編組與反向

真實營運編組為四節；本次的單車與兩節都明列為**示意驗證編組**。[臺北捷運公司文湖線列車介紹](https://www.metro.taipei/cp.aspx?n=ccf30033e6ed8008&s=405306CC7ACD137B)

| 模式／車廂 | 參考里程偏移 | 車頭方向 | 車長 |
| --- | ---: | --- | ---: |
| `single` A | 0m | 跟隨行駛方向 ±1 | 4.519137m |
| `short2` A | +2.434569m | 固定朝正里程 | 4.519137m |
| `short2` B | −2.434569m | 固定朝負里程 | 4.519137m |

兩節中央距離 4.869137m，平直路徑包圍盒間隙 0.35m（示意設定），總長 9.388274m。參考里程是**整組中心**，每節依自己的里程取切線及坡度。反向時 A/B 身分、座標和端面不交換，只改行駛方向及領頭車；正向 A 領頭、反向 B 領頭。單車反向會在原地轉向，不平移。這不是車鉤或完整車輛動力學模擬。

## 最新平面路徑的確切位置

**主來源是 `data/trtc.json` 的 `lines[id='BR']`，不是 `data/mrt.json`。**

- 本工作目錄：`/Users/xuxiang/Code/捷運小動畫/data/trtc.json`。
- 上一輪貼軌修正工作樹：`/private/tmp/railisland-trains-3d/data/trtc.json`。
- 兩份 bytes 相同，SHA-256：`72a427411509f4ab1872f595ff891c00a5342c2e9b0e22c9ab0507911aa34a5a`。
- 原檔的 shape 座標順序是 **`[lat,lng]`**，630 點，從 **BR01 動物園 → BR24 南港展覽館**，里程遞增。交付 JSON／GeoJSON 已轉成 `[lng,lat]`。
- 舊 `data/mrt.json` 是另一份 OSM 衍生路徑，方向相反（南港展覽館 → 動物園）；不要與本檔的站序／里程混接。
- 站名、站點原始經緯度及 `d` 在 `trtc.json`；站號對照在 `data/trtc_codes.json`。來源索引是 `data/data_provenance.json`，建置腳本是 `scripts/build_tdx.mjs`。
- 目前來源註記為 2026-07 TDX 衍生資料；檔案後來加入信義線 R01 的更新，不是文湖線重新測量。`data/tdx/TRTC_Shape.json`、`TRTC_Station.json`、`TRTC_StationOfLine.json` 原始 payload 本機缺檔，不能重新逐筆核對原始官方資料。
- 前端將經緯度按 WGS84 使用；既有衍生檔沒有上游 CRS 聲明，JSON 保留 `upstreamDeclaration:null`。

**9/6 最新校正的是渲染／位置取樣，不是新增實測線形。**固定 commit `e5fada34` 的 `/private/tmp/railisland-trains-3d/index.html` 中：

| 函式 | 行號／責任 |
| --- | --- |
| `trainYaw3d`、`pathYaw3d` | 6835／6841：依實際路徑切線取得車頭方向 |
| `ensureCum`、`posAlongShape` | 7526／7551：沿原 shape 的累計里程與插值 |
| `posBetweenStations` | 7664：站間沿線取樣 |
| `metroStationTrackPose` | 9420：停站也使用軌道上的落點 |
| `trtcOfficialDisplayPosition` | 9433：舊官方名冊顯示位置入口 |
| `metroCorePositionAt` | 24448：Core 的貼軌／停站顯示位置入口 |

GL 路線衍生檔是 `/private/tmp/railisland-trains-3d/data/track_lines.geojson`（`scripts/build_track_geojson.mjs` 產生），選 `properties.sys='mrt' && properties.id='BR'`；可能拆成數個 feature。它將座標取到六位小數，SHA-256 `5402dbc515c07eaca6b15ce01b111a26ca5e448c2669b8f3b2bbb56be9f254d9`。本交付直接從完整 `trtc.json` 截段，以免把繪圖排序欄位當成工程高度。

## 木柵—萬芳社區段

`pathId: TRTC-BR-BR02-BR03-v1`。全線 670.6m 至 1184.0m，區段長 **513.4m**（既有前端球面里程算法，不是測量鏈距）。保留區段內全部 6 個原始折點，兩端依既有站點 `d` 插值，共 8 點；沒有抽稀或改寫共享原資料。

| 站點 | 正向順序 | 原始 `[lng,lat]` | 列車落軌 `[lng,lat]` | 來源站點與軌道差距 |
| --- | --- | --- | --- | ---: |
| BR02 木柵 | 區段 0m；全線 index 1 | `[121.573127,24.998240]` | `[121.573131446512,24.998259110488]` | 2.172m |
| BR03 萬芳社區 | 區段 513.4m；全線 index 2 | `[121.568088,24.998570]` | `[121.568086272227,24.998604011641]` | 3.786m |

正向 `+1` 往南港展覽館、負向 `-1` 往動物園。舊官方名冊介面 `dir=2` 對應正向、`dir=1` 對應負向；**這不是 TDX Direction，也不是 Core enum**。接 Core 時應由實際 trajectory progress 增減決定符號。

## 高程來源及尚未完成的地景驗收

**目前沒有可交付的實測軌道標高來源。**8 個頂點的 `railElevationM`、相對地形高度、verticalDatum、source 全部保留 `null`，可信程度 `unknown`。`samplePath`／`sampleCar` 保留未知值；`placeCarENU` 缺少高程會明示丟錯，不能靜默落到 0m。

木柵原路段的高架性質可由[捷運工程局文湖線工程介紹](https://www.dorts.gov.taipei/cp.aspx?n=DBAC040496EFAB94)確認；該說明沒有各墩、橋面或行走面標高。不能擴張成「整條文湖線全高架」。`data/rail_crossing_levels.json` 的 OSM layer／bridge／tunnel 是構造或排序資訊，並非以公尺表示的軌面高程。舊 `prototypes/wenhu3d.html` 的 `DECK_H=10` 和 `CAR_L=24` 都是示意設定，本次不沿用。

DTM 只代表地面，不代表高架行走面。地景任務取得工程高度後仍須查清垂直基準、進行可追溯換算；不要直接把來源不同的「公尺」相加。第一輪真實山丘、橋面、地形遮擋及 iPhone 持續效能驗收留在地景整合端；本套件測試不能替代它們。

## 接入介面

以下在地景端現有初始化／動畫流程內呼叫；模組本身沒有 rAF。不要同時啟動 preview 的相機或時間循環。

```js
import {loadWenhu,createWenhuGeometry,createWenhuMaterial,createWenhuCar}
  from '../tiny-trains/integration/wenhu-v1/wenhu.mjs';
import {sampleConsist,placeCarENU}
  from '../tiny-trains/integration/wenhu-v1/path.mjs';

const asset = await loadWenhu();
const railPath = await fetch('../tiny-trains/integration/wenhu-v1/muzha-wanfang.path.json').then(r=>r.json());
const geometry = createWenhuGeometry(THREE,asset);
const material = createWenhuMaterial(THREE);
const cars = [0,1].map(()=>createWenhuCar(THREE,asset,geometry,material));
cars.forEach(car=>scene.add(car));

// 每幀：由現有班表／模擬時間產生 centerM 和 direction。
// resolvedRailHeight 必須回傳已確認、共用垂直基準的行走面高度；未知時不要呼叫 placeCarENU。
const pose = sampleConsist(railPath,asset.meta,centerM,direction,'short2',resolvedRailHeight);
pose.cars.forEach((p,i)=>placeCarENU(THREE,cars[i],p,localOriginLngLat));
```

`centerM` 是區段起點以後的**編組中心里程**；若上游是全線里程，先減 670.6m；若上游參考點是車頭，先明確轉成中心再取樣。每節里程必須落在 0–513.4m，越界丟錯，不把多節車全部夾在端點。Preview 在兩端各保留 15m 往返緩衝。

整合端的每筆動態狀態至少保留 `trainId`、`pathId`、`timestampMs`、`referenceChainageM`、`direction`（±1）、`speedMps` 或帶時間戳的里程序列；不要因切換鏡頭重新生成車輛身分。車型對應應另註 `modelAssignment:'illustrative'`。這份套件**沒有真實文湖列車派遣資料**；既有 `data/trtc_times.json` 也說明 BR 不提供逐站官方班表，其班距推估不能改標為實際車次。

`placeCarENU` 使用局部 **東 X／北 Y／上 Z**，車廂 quaternion 始終右手系。接 MapLibre Mercator 時，只在共同 root 使用一次 `T(originMercator) × S(meterScale,-meterScale,meterScale)`，不要把舊 canvas 的北向負 Y／yaw 規則再套一次。Preview 以同一局部座標畫測試路面和列車；`localENU` 是短距離近似，跨更長路段應由地景端共同選用精確 Mercator／曲面投影。

MapLibre 5.9 的矩陣使用 `args.defaultProjectionData.mainMatrix`；車輛和地景必須共用相機及深度緩衝，材質需寫入深度。**不要呼叫 clearDepth，也不要加 depth-disabled 的第二份車身輪廓。**測試場使用 MapLibre fill-extrusion 遮擋 Three 原始網格，避免只驗同一個 Three 場景內部的遮擋。

本次另觀察到一個需由地景端留意的近景案例：MapLibre 5.9、zoom 20.5、pitch 60°、bearing 90°、相機中心抬到合成軌面約 34m，GeoJSON 預設切片的遮擋箱會缺少部分箱體。相同畫面把測試來源固定 `maxzoom:14`，讓箱體完整留在單一圖磚後，遮擋恢復。這是本測試場的切片對照結果，**不是所有建物圖層的通用修法**。正式地景應另驗實際來源、圖磚邊界及抬高相機時的可見範圍；不要把缺少建物幾何誤判為車輛材質深度錯誤。

## 重建與預覽

在 repo 根目錄執行：

```sh
node prototypes/tiny-trains/integration/wenhu-v1/build.mjs
node prototypes/tiny-trains/integration/wenhu-v1/serve.mjs
node prototypes/tiny-trains/integration/wenhu-v1/verify.mjs
```

預覽 `http://127.0.0.1:5194/`。Server 僅提供這個套件及上述 vendor 目錄，不開放 repo 其他檔案。驗證需現有 Playwright 的 Chromium／WebKit；報告及截圖在 `verification/`。

測試使用平面原始路徑及明確獨立的合成高度 `25 + 0.035 × 區段里程`；它沒有寫回軌道資料。驗證包括 1934 次雙向路徑／車頭／坡度取樣、固定車廂身分反向、過彎分節方向、原始網格與雜湊、未知高程拒絕落地、Chromium／WebKit 的實際像素及時間推進、俯仰 0°／60° × 方位 0°／90°／180° 的跨層遮擋。手機寬度 360／375／390／414／520／600／768 及橫向 900×414，掃描水平溢出、全部控件兩兩重疊、點擊命中及 44px 觸控高度，並用 `isMobile + hasTouch + tap` 實際操作反向、跟隨、遮擋與暫停。缺失網格另有失敗頁面驗證。

最終通過項數、執行時間與逐項結果以 `verification/report.json` 為準。`release.json` 凍結這一輪交付與驗證檔案；若模型、程式或依賴變更，應重新驗證並建立新版本，不能只沿用舊報告。

## 來源標示

模型署名沿用「軌島（Q 版示意）」。保留原有[APM 256 外觀參考頁](https://commons.wikimedia.org/wiki/File:TRTC_Bombardier_INNOVIA_APM_256_2015-04-13.jpg)連結；本次沒有重新確認該照片的授權條款，因此沒有把圖片隨套件散布，也沒有宣稱其授權適用於其他資產。真車尺寸、編組及構造的官方來源分別列於上文與 JSON。套件不新增任何獨立開源授權或官方認證聲明；地景端保留現有 vendor 授權檔。
