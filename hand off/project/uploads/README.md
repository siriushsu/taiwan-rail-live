# 台灣鐵道 · 列車流動動畫 — 進度總結

> 最後更新:2026-07-08。單頁互動網頁:在真實地圖上動畫化台灣鐵道列車運行
> (靈感來源:Brilliant Maps 的 NYC transport / 倫敦地鐵 timelapse)。
> 全部前端都在 `index.html` 一個檔案;資料在 `data/`;抓資料腳本在 `scripts/`。

## 怎麼跑

```bash
cd 捷運小動畫
python3 -m http.server 5178     # 或用 .claude/launch.json 的 "static" 設定
# 開 http://localhost:5178
```

需要網路(Leaflet CDN、CARTO 地圖圖磚)。資料檔已在 repo,離線也能載入列車。

## 三個系統

| 系統 | 模式 | 資料 |
|---|---|---|
| 台北捷運 | 班距模擬 | `data/mrt.json`(7 線,OSM 站點+彎道) |
| 台鐵(班距) | 班距模擬 | `data/tra.json`(15 線 = 9 主線 + 6 支線) |
| 台鐵 · 真實班表 | 逐車次真實時刻表 | `data/tra_schedule_dense.json`(905 車次,2026-07-08,5 車種) |

## 已完成功能

- **真實地圖底圖**:Leaflet 1.9.4(cdnjs)+ CARTO dark 圖磚;canvas overlay 畫軌道/車站/列車。
- **真實軌道幾何**:`scripts/fetch_shapes.py` 從 OSM Overpass 抓鐵軌、以 node id 建拓撲圖、
  相鄰站間 Dijkstra 尋路,存成每線 `shape` 折線 + 每站里程 `d`(km)。
  繞路防呆:路徑 > 直線 2.5×+1km 即退回直線。直線 fallback:台鐵 17 段、捷運 32 段(OSM 缺口)。
- **列車貼軌**:班距模式沿 shape 以里程前進(`posAlongShape`);真實班表模式把每個停靠站
  對到所屬線的里程(`assignSchedShapePaths`,28451 段貼軌 / 2112 段直線 ≈ 93%),
  實測行進中列車離軌 0 m。
- **寫實時間**:停站模擬(班距模式 DWELL 25s;真實班表用真實到離時刻)。
  `SCHED_K = 1` → **速度 1× = 真實速度**,時鐘同步;預設 50×(全日約 29 分鐘)。
- **車次搜尋+跟車**:905 車次 datalist 搜尋;相機每幀精準置中(誤差 0.5px,無抖動);
  雙圈高亮;時間不在運行區間自動跳到發車前;「取消跟隨」。
- **車站時刻板**:點地圖上任一站 → 右上面板列未來 3 小時停靠班次
  (車次/車種/往/時刻/幾分後),每 20 模擬秒自動更新。依時刻表,無誤點資訊。
- **現在時刻同步**:載入即跳到裝置目前時間;「現在」按鈕隨時跳回;班距模式同步目前時段。
- **尖峰流量圖**:全日 144 格(10 分/格)同時運行列車數;hover 顯示「HH:MM · 約 N 列」;
  點擊跳到該時刻;白色游標=目前時間。全日峰值約 155 列。
- **圖例**:真實班表分兩組——車種篩選(5)+ 軌道線顯示切換(15);班距模式為路線切換。
- **站名防重疊**:碰撞檢測(`tryLabel`)+ 同名去重;縮放門檻控制顯示密度。

## 資料管線(scripts/)

| 腳本 | 作用 |
|---|---|
| `fetch_tra.py` | 台鐵路線/站點(OSM) |
| `fetch_tra_schedule.py` | 台鐵每日時刻表(官方 ODS,ods.railway.gov.tw,免金鑰) |
| `densify_schedule.py` | 班表密化:快車經過的中途站補進 stops(`stop:false`),列車才能沿軌跡跑 |
| `fetch_shapes.py` | OSM 軌道幾何 → `shape`/`d`(Overpass 有快取 `scripts/.overpass_cache/`) |
| `fetch_tdx.py` | TDX 捷運資料(北捷/高捷/高雄輕軌/中捷),**待使用者帶金鑰執行** |

## 已知限制(誠實聲明)

- 時刻表推算,**無誤點/即時資訊**(需 TDX Live API 才有)。
- 內灣線「千甲」與「北新竹」在資料源共用同一座標。
- 4 個主線站名未匹配到班表:成功、百福、美術館、鼓山。
- 少數區段直線近似(上面 fallback 數字);山線/海線平行段個別站對可能吸錯軌。
- 捷運班距是官網公告估算(`headway_estimated:true`),非逐班資料。

## 待辦(下一步)

1. **TDX**(帳號已申請):跑 `scripts/fetch_tdx.py`(需 `TDX_CLIENT_ID`/`TDX_CLIENT_SECRET`
   環境變數,secret 不落檔)→ 北捷真實班距+站間時間升級、**新增高雄捷運/高雄輕軌/台中捷運**。
2. **設計打磨**:見 `DESIGN_BRIEF.md` + `design-mock.html`(帶去 Claude Design 用)。
3. 想做可做:高鐵、A→B 下一班查詢、匯出影片。

## 檔案地圖

```
index.html                  全部前端(HTML+CSS+JS,無 build)
design-mock.html            設計打磨用自包含模型(見 DESIGN_BRIEF.md)
DESIGN_BRIEF.md             Claude Design 交接指示
data/mrt.json               北捷 7 線(站點+shape)
data/tra.json               台鐵 15 線(站點+shape)
data/tra_schedule.json      班表原始檔(905 車次)
data/tra_schedule_dense.json 班表密化檔(前端實際載入)
data/*.bak-20260708         改 shape 前的備份
scripts/                    上面那五支 + .overpass_cache/
.claude/launch.json         dev server 設定(python http.server:5178)
```
