# 實體股道互穿修復與車站資料覆核（2026-09-12）

本輪修正 10 班車的派軌，補回太麻里兩條來源月台股道，並修正驗收車型識別。區間車 8 節、莒光 9 節仍未啟用：修復後的長編組全日重放依然超過棘輪。BUILD v0912p；此紀錄不代表已部署正式站。

## 已落地的修復

- 太麻里原來只有 `9267198336` 一個停車點。加入 OSM 原有 `1175179822`／停車點 `9267198334`（電化），以及 `179533237`／停車點 `9267198335`（來源標非電化）。兩條線都直接接回原有 `81151575` 的兩個道岔，保留來源節點、座標及標籤，不以位置接近合併或平移列車。
- 非電化股道只派給藍皮解憂號 5898／5899。這兩份計畫標 `templateEligible:false`，其他加開車不能借入。301、3021、410、431 使用新增電化股道；其餘列車保持主線。14 天班表的太麻里同停同點配對由 98 降為 0。這是停站時窗交集，不是全日連續車身零衝突的宣告。
- 1208（埔心—中壢）、411（枋野—大武）、2608（日南—苑裡）、4234（七堵—八堵）改用同起終點、可經道岔通行的來源路徑，各增加約 3.21／5.81／0.72／5.29 公尺。不能再把所有對向互穿都歸因為「南迴、花東單線無解」。
- 同步 34 份 PP 計畫的車長中繼資料：54.8→274.8 公尺；兩份環島之星 60→57 公尺。這是與畫面現有模型對齊，沒有宣稱重新求解所有車長預約。
- 舊股道座標及既有路徑紀錄完全保留；新增 11 條路徑。非台鐵計畫、groups、handoffs 不變，未增加 hold。重建顯示與層位剖面，既有剖面僅太麻里主線 `81151575`、相接 `146741725` 因共用道岔高度而更新。

## 車站股道資料來源

| 車站 | 已查到的資料 | 可支持的範圍與限制 |
| --- | --- | --- |
| 太麻里 | [OSM 電化股道](https://www.openstreetmap.org/way/1175179822)、[既有停車點](https://www.openstreetmap.org/node/9267198334)、[月台面](https://www.openstreetmap.org/way/547476108)；[非電化股道](https://www.openstreetmap.org/way/179533237)、[既有停車點](https://www.openstreetmap.org/node/9267198335)、[月台面](https://www.openstreetmap.org/way/547476109) | 來源節點與月台面可核對；每條線兩端都有原有道岔。不是官方當班月台指派。 |
| 藍皮解憂號 | [台鐵官方通訊](https://tip.railway.gov.tw/tra-tip-web/tip/file/0048eeb6-562d-4e32-abae-b2b6ef1c373c)、[官方車次時刻表](https://tip.railway.gov.tw/tra-tip-web/tip/tip00N/tipN01/blue/index?lang=zh_TW) | 官方資料說明柴油機車牽引；5898／5899 的車次身分及太麻里停靠時段也可核對。因此非電化新候選只給這兩班。 |
| 花壇 | [官方站內配置圖](https://tip.railway.gov.tw/tra-tip-web/tip/img/cbc766a1-69a9-4468-af0c-28681ac5e667/1140x900)、[車站頁](https://tip.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/3370) | 圖示三條旅客月台股道；現有路網有四個停車候選，不能把四個都直接當旅客月台。仍需月台面與節點的一對一核對。 |
| 大村 | [官方配置圖](https://tip.railway.gov.tw/tra-tip-web/tip/img/f3beb112-6879-4278-9750-a03ae7a597f0/1140x900)、[車站頁](https://tip.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/3380) | 圖示兩側式月台；現有路網也有兩個停車候選，但不提供每日列車指派。 |
| 埔心 | [官方配置圖](https://tip.railway.gov.tw/tra-tip-web/tip/img/5ad27d8f-948f-4529-b1cf-4b04102dabae/1140x900)、[車站頁](https://tip.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/1110) | 圖示兩島式月台、四股旅客軌道；已有四個候選。本輪 1208 保持原停車點。 |
| 中壢 | [官方配置圖](https://tip.railway.gov.tw/tra-tip-web/tip/img/1316094f-c1a7-4c69-b032-7eedd69a792d/1140x900)、[車站頁](https://tip.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/1100) | 圖示側式一股、島式兩股。施工期間配置可能變動；本輪不改停車點，也不自行編造官方股道編號。 |

太麻里採用的 OSM 小範圍快照、時間、來源連結及用途限制保存在 `scripts/fixtures/taimali-platform-track-0912.json`，標示 ODbL 授權。官方配置圖只引用連結，沒有將圖片包進產品。

鐵道局 113 年知本—太麻里路基流失調查 PDF 的搜尋摘要可找到，但本輪下載未取得有效 PDF，沒有將未讀圖面當成幾何依據。後續花壇 Overpass 查詢回 406，因此未完成四個候選與月台面的精確對照；不能據一張示意圖直接刪除來源停車節點。

## 驗收結果

全日閘門固定服務日、4 秒重放步長、120 秒取樣、570 個時點。只把超過棘輪視為失敗，PASS 不等於零互穿。

| 服務日／編組 | 同向 A | 對向 A′ | 兩車同停 B | 一停一跑 C |
| --- | ---: | ---: | ---: | ---: |
| 9/12 原派軌、現行編組 | 5 | 19 | 48 | 44 |
| 9/12 修復後、現行編組 | 5 | 17 | 42 | 44 |
| 9/12 修復後、區間 8 節／莒光 9 節探針 | 9 | 26 | 42 | 56 |
| 9/14 平日原派軌、現行編組 | 1 | 16 | 37 | 40 |
| 9/14 平日修復後、現行編組 | 1 | 14 | 31 | 40 |

長編組仍使 A 超過 5、A′ 超過 24，保留紅燈，不調大 120 秒上限，也不放寬棘輪。

補充驗證：

- Chromium、WebKit 都用實際 renderer 畫出 11 對具名案例，並以長編組重播各 61 秒。22 次對照的原互穿都能重現，修復後該窗口的配對互穿均為 0；不是只看兩分鐘一次的總數。
- 太麻里 12:54:30–12:55:00 有 5899、410、423 三車同停；原兩分鐘抽樣會漏掉 410／423。補充檢查在 12:54:45 量到兩班 EMU3000 共用 245.7 公尺，修復後為 0。
- 10 班修復車的來源路徑與接站檢查共 21,763 個逐秒位置；正反方向都有驗，接站前後 ±1 毫秒最大位移約 0.053 公尺。各點平面／地形高度都有效。
- Chromium／WebKit 各驗 360、375、414、768 寬度；真的以觸控切換平面／地形模式，檢查命中位置、水平溢出及 renderer 錯誤。
- 退回 1208 舊派軌、退回太麻里 301 舊月台、允許借走藍皮路徑、把 PP 改回 54.8 公尺，四種突變都被具名閘門拒絕。
- 台鐵綁定與連續性、高鐵綁定、列車編組、層位閘門通過。執行期快取以同一份現行班表的剖面資料比較新舊實作。

閘門修正兩個盲點：`formationFor` 補帶畫面使用的 `stockId`／`branchId`／`namedId`，避免把支線或觀光車一併放長；手動重放時凍結自動 rAF，避免每個重放區塊之間多出 `dSim=0` 的 snap，造成 B 在 48／49 間漂移。報告輸出每筆事件，保留分母與服務日。

## 重現與後續

```sh
# 產生候選，輸出到 output，不直接改產品檔
node scripts/repair_verified_station_routes.mjs

# 採用候選後必須重建高程／層位
node scripts/build_physical_display_profiles.mjs
node scripts/build_rail_levels.mjs
node scripts/verify_verified_station_routes.mjs
node scripts/verify_verified_station_routes_browser.mjs
TEST_DATE=2026-09-12 node scripts/verify_physical_no_overlap.mjs
FORMATION_PROBE=long TEST_DATE=2026-09-12 node scripts/verify_physical_no_overlap.mjs
```

`verify_verified_station_routes.mjs` 已接入出貨管線。重新抓班表後，應重新驗證及修復派軌；不要只拷貝舊計畫、只依總數收緊棘輪，或把本輪停站配對 98→0 說成全台零互穿。

仍待處理：同向追撞 5 筆，以及尚未修掉的對向／一停一跑／其他站同停互穿。花壇、大村的一些對向衝突需要一起調整連續站的停車點，固定原端點找不到短距離替代；本輪只做了候選探索，沒有把未確認的月台候選派給列車。沒有重啟先前已量出假紅的全局 CP-SAT 佔用模型。

合併 main 的 `ef6349d4` 平坦地圖短橋坡度修復後，以合併後的建置器重建層位，保留新股道與橋梁修正；版本升為 v0912p。
