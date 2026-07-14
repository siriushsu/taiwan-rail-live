# 軌島 · 台灣鐵道即時軌跡

**線上版：https://railisland.tw** （備援：https://siriushsu.github.io/taiwan-rail-live/）

> 在真實地圖上動畫化全台鐵道列車運行——台鐵（含每分鐘即時誤點）、高鐵，以及各捷運與輕軌，
> 依實際時刻表運行；可跟隨列車看待避交會、查平交道通過預測與附近火車班次。
> （靈感來源：Brilliant Maps 的 NYC transport／倫敦地鐵 timelapse。）
> 全部前端都在 `index.html` 一個檔案；資料在 `data/`；抓／建資料腳本在 `scripts/`。

## 怎麼跑

```bash
cd 捷運小動畫
python3 -m http.server 5178      # 或用 .claude/launch.json 的 "static" 設定
# 開 http://localhost:5178
```

需要網路（Leaflet CDN、CARTO／Esri 地圖圖磚）。資料檔已在 repo，離線也能載入列車。

## 涵蓋系統

系統選單以群組頁籤呈現：**全台同框（預設）／國家鐵路（台鐵＋高鐵）／北北桃／中南部**。

| 系統 | 模式 | 資料 |
|---|---|---|
| 台鐵 | 逐車次官方每日時刻表＋每分鐘即時誤點（TDX） | `data/tra_schedule_dense.json`、軌道幾何 `data/tra.json` |
| 高鐵 | 逐車次時刻表（無逐車即時誤點，TDX v2） | `data/thsr_schedule_dense.json`、`data/thsr_track.json` |
| 台北捷運 | 當日實際逐班時刻表 | `data/trtc.json` ＋ `data/trtc_times.json`（文湖線等無逐班時刻者以官方班距合成） |
| 桃園機場捷運 | 當日實際逐班時刻表 | `data/tymc.json` ＋ `data/tymc_times.json` |
| 台中捷運 | 當日實際逐班時刻表 | `data/tmrt.json` ＋ `data/tmrt_times.json` |
| 高雄捷運（＋高雄輕軌） | 實際時刻表／輕軌班距 | `data/krtc.json` ＋ `data/krtc_times.json` |
| 新北捷運・淡海輕軌 | 綠山線／藍海線分線，實際時刻表 | `data/ntdlrt.json` ＋ `data/ntdlrt_times.json` |
| 新北捷運・安坑輕軌 | 實際時刻表 | `data/ntalrt.json` ＋ `data/ntalrt_times.json` |
| 三鶯線 | 試營運（2026-06-30 通車），班距估算 | `data/sanying.json` ＋ `data/sanying_times.json` |
| 環狀線（Y） | 新北捷運營運；幾何與班距為 OSM＋估算 | 來源保留於 `data/mrt.json` |

`SCHED_K = 1` → **速度 1× ＝ 真實速度**，時鐘同步；開站即現在時刻、1×（可隨時調速快轉）。

## 主要功能

**時刻與模擬**
- 開站即現在時刻、1× 真實速度；台鐵每分鐘即時誤點（TDX）自動套用。
- **車種加減速模型**：不同車種依實際加速／減速特性運行（出站漸加速、進站漸減速、中段等速巡航），
  站區位置更貼近真實，跟隨時的即時時速與速度曲線也隨之起伏。

**跟隨列車**
- 點任一列車跟車：鏡頭精準置中、全程路線高亮、旅程進度（km）、FR24 式速度曲線、停靠站名牌。
- 跟隨鎖（Google 導航式）：跟隨中可自由拖曳地圖瀏覽，按「回到列車」恢復置中。
- 捷運／輕軌示意車也可點擊跟隨（輕量資訊卡：線名／方向／下一站）。

**探索與收集**
- 旅程護照＋成就徽章；**完乘章**（乗りつぶし）：跟一班車到終點自動蓋章，統計趟數／里程／車種。
- 「探」今日亮點面板＋特別列車故事；車站時刻板（點站看未來停靠班次）。

**放空模式**
- 跟車視角／群車視角（鏡頭掛在當下最繁忙路段看群車交錯）、日夜天色、背景音樂、隨機換車。

**平交道**（工具列「平」鈕）
- 全台平交道位置**依台鐵官方資料**標示——**可能與現場實際位置有落差，歡迎於 GitHub Issue 提出修改建議**。
- 點擊查未來通過列車（車次／方向／預計時刻／倒數）；圖示依軌道數與電化分類（單線／雙線以上・電化，由 OSM 逐處推算）。
- 通過時刻為依時刻表推算，僅供參考，請以現場號誌為準。

**附近火車**（工具列「釘」鈕）
- 地圖落釘，查 1.5 公里內、未來 60 分鐘經過的列車與方向；並行路線分組全標；★ 可存為最愛地點。

**分享與安裝**
- **分享畫面**：一鍵把目前地點／時間／路網（或正在跟隨的列車）打包成深連結，手機原生分享／桌面複製，對方開啟落回同一畫面。
- 縣市快速移動書籤；**PWA** 可安裝到主畫面；站內錄影（Beta）。
- 省電模式（降 30fps／手機預設開）、高速跟隨底圖預抓（加速播放不露白）。

**其他**
- 捷運營運告警橫幅：即時聚合北捷、桃捷、中捷、高捷、新北捷官方公告。

## 近日資料改正

- **山線改走現行新線**：移除 1998 年停用的舊山線（勝興、舊泰安），泰安歸位新站，
  補齊百福、南樹林、暖暖、精武、仁德、內惟、美術館、鼓山、三塊厝 9 個通勤車站。
- **成功站補登山線**：成追線跨線班次（如 2234）不再繞行追分／彰化瞬移跳動，114 個受影響班次歸正。
- **臺東線玉里–三民段改走現行線**（原 OSM 繞行樂合／安通舊線偏約 800m）。
- **淡海輕軌拆為綠山線／藍海線**：Y 字路網不再壓成一條線，淡海新市鎮／崁頂端軌道與列車回歸。
- **機捷新北產業園區折返段移除**（TDX 原始碎片同段重複收錄致列車繞圈）。
- **環狀線營運方正名**為新北捷運（不再歸為台北捷運路線）。
- **平交道校正**到官方現役資料，並移除已停用／貨運線上、本圖未繪軌道處的浮空道口。

## 資料管線（scripts/）

| 腳本 | 作用 |
|---|---|
| `fetch_tra.py` | 台鐵路線／站點（OSM；站座標以 TDX 覆寫） |
| `fetch_tra_schedule.py` | 台鐵每日時刻表（官方 ODS，ods.railway.gov.tw，免金鑰） |
| `densify_schedule.py` | 班表密化：快車經過的中途站補進 stops，列車才能沿軌跡跑 |
| `fetch_tra_station_info.mjs` | 台鐵車站地址／基本資料 |
| `fetch_station_class.mjs` | 台鐵車站分級（特等站等） |
| `fetch_shapes.py` | OSM 軌道幾何 → `shape`／里程 `d`（Overpass，有快取） |
| `despike_shapes.mjs` | 清除 shape 折返毛刺（站場側線繞行）＋重投影站點里程 |
| `repair_shape_holes.mjs` | 補軌道折線斷洞 |
| `fetch_thsr.py` ／ `build_thsr_schedule.mjs` | 高鐵軌道幾何與逐車次時刻表 |
| `fetch_tdx.py` | TDX 捷運原始資料（北捷／機捷／新北捷／中捷／高捷含輕軌）→ `data/tdx/` |
| `build_tdx.mjs` | `data/tdx/*` → 各捷運路網 JSON：碎片縫合、支線接合、去重疊、折返防呆、官方班距 |
| `build_metro_times.mjs` | TDX StationTimeTable → 各系統當日實際逐班時刻 `*_times.json` |
| `build_crossings.mjs` ／ `enrich_crossings_osm.mjs` | 平交道資料建置＋OSM 軌道數／電化推算 → `data/crossings.json` |

## 已知限制（誠實聲明）

- 位置皆為**時刻表推演，非即時動態**——僅台鐵有每分鐘即時誤點；高鐵與捷運無逐車即時車況。
- 部分捷運（文湖線等）無公開逐班時刻，以官方班距合成並標示。
- 環狀線與部分輕軌的幾何／班距為 OSM＋估算。
- 少數平行區段為直線近似；山線／海線平行段個別站對可能吸錯軌。
- 內灣線「千甲」與「北新竹」在資料源共用同一座標。
- 平交道位置依台鐵官方資料標示，可能與現場實際有落差；歡迎於 GitHub 提出修改建議。

## 部署

- 前端為純靜態單頁（`index.html`，無 build step）。
- 部署於 **Cloudflare Workers**（靜態資產），正式網域 **railisland.tw**；GitHub Pages 為備援站。
- 安全標頭走 `_headers` 檔（靜態資產不經 Worker 計費）；設定見 `wrangler.jsonc`。
- 版本戳記 `BUILD`（`index.html` 內，字母序遞增）顯示於畫面時鐘徽章與 console，供比對線上是否為最新版。

## 檔案地圖

```
index.html                   全部前端（HTML+CSS+JS，無 build）
design-mock.html             設計打磨用自包含模型（見 DESIGN_BRIEF.md）
DESIGN_BRIEF.md              Claude Design 交接指示
data/tra*.json               台鐵：軌道幾何／時刻表／車站分級／站資訊／特別列車
data/thsr_*.json             高鐵：軌道幾何／時刻表
data/{trtc,tymc,tmrt,krtc}*  北捷／機捷／中捷／高捷（含輕軌）路網＋實際時刻
data/{ntdlrt,ntalrt,sanying}* 淡海輕軌／安坑輕軌／三鶯線 路網＋時刻
data/mrt.json                OSM 北捷（環狀線來源保留）
data/crossings.json          全台平交道（位置＋軌道數／電化）
data/tdx/                     TDX 捷運原始資料（fetch_tdx.py 抓取）
scripts/                      上表抓／建資料腳本＋ dev_server.mjs
wrangler.jsonc / _headers     Cloudflare Workers 部署與安全標頭
.claude/launch.json          dev server 設定（static:5178 / dev:5179）
```
