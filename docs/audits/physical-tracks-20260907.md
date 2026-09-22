# 真實股道與月台資料盤點（2026-09-07）

使用者選擇依真實軌道行駛，保留單線、雙線與待避配置。不可用中心線側移替代真實股道，也不可為了讓模型不相撞而挪動列車。

## 已取得資料

- OpenStreetMap 全台軌道：2026-09-07T02:28:39Z 快照，8,755 ways、53,896 nodes；包含 974 段 siding、433 段 crossover、2,716 段 yard。這些是來源標記的段數，**不是車站／單雙線區間數**。摘要及 SHA-256 見同目錄 JSON。
- `scripts/build_physical_track_graph.py` 保留原始 node ID、全部頂點、軌距、系統、橋隧／層級、側線及方向標記。接點以 node ID 為準，不把平面相交或相鄰的兩軌接起來。
- 8,755 段已逐頂點比對來源，座標與 node ID 沒有改動。愛河橋兩股 [224343173](https://www.openstreetmap.org/way/224343173)、[435657353](https://www.openstreetmap.org/way/435657353) 保留各自的 `oneway=yes`。
- 來源僅有 67 段 `oneway`、0 段 `railway:preferred_direction`、62 段 `railway:track_ref`。因此不能把任意 way 的原始座標順序當成營運方向。[OSM 方向欄位定義](https://wiki.openstreetmap.org/wiki/Key:railway:preferred_direction)
- 另一個 3D 原型已匯入國土測繪中心鐵路、高鐵、捷運與輕軌中心線，可核對走廊與構造；不能直接把中心線視為逐股道測量成果。[官方鐵路資料](https://data.gov.tw/dataset/73220)

資料建置方法（原始檔與完整路網底稿留在不部署的快取）：

```sh
python3 scripts/build_physical_track_graph.py --source <Overpass輸出.json> --output .cache/physical-tracks/network.json --summary docs/audits/physical-tracks-20260907.json
```

## 官方月台：欄位存在，但本次實測沒有號碼

TDX `v3/Rail/TRA/StationLiveBoard` 的 `Platform` 是停靠月台，`00` 代表未定；`TrainLiveBoard` 沒有該欄位。[官方 Swagger](https://tdx.transportdata.tw/api-service/swagger/basic/5fa88b0c-120b-43f1-b188-c379ddb2593d#/TRA/StationLiveBoardApiController_Get_3213)

2026-09-07 10:36 臺北、彰化、花蓮共四筆抽查均空白；10:37:32 的全台回應為 152 筆、90 站、33,520 bytes，152 筆 `Platform` 均為空字串。這只代表本次快照，不能斷言官方永遠不提供。

已新增網站／小工具共用的 `/api/tra-platforms`。只在有查看需求時抓取，55 秒記憶體／邊緣快取及同時請求去重，沒有新增 cron。TDX 憑證仍只在 Worker。快取按 colo 各自存在，不能宣稱全球每分鐘只一次。

顯示需要同時吻合系統、車站、車次、表訂到／離站日期時間；資料有效期限不因重新下載舊快照而延長。缺值、00、停駛、過期、回放全部隱藏欄位，不保留破折號或空位。測試中的 1A／2B 都是**明示的人工測試值**，不是本次官方實測結果。

## 分軌後續驗收條件

1. 沿各系統已核對的營運走廊建立有連接證據的候選路徑，保留分岔與側線，排除異系統、機廠與立交誤接。
2. 區分「幾何有證據」「一般方向推估」「當班月台有官方值」「已核對月台至股道」；月台編號不是 OSM track_ref，不可直接等同。
3. 有明確方向的區段先做雙向試跑；無方向資料處需要營運資料或可追溯的人工核對。單線保留單線，不能為了會車自動長出第二條。
4. 核對兩個方向、道岔連續性、環線／分岔、真實編組長度與模型寬度、跟隨相機與點擊位置。模型「容易辨認」放大仍可能超過真實兩軌淨距，必須處理車寬，不能挪動股道。

**目前沒有啟用全台分軌行駛，也沒有指定當班待避或進站股道。** 路網底稿與月台介接是後續分軌的資料基礎；既有列車位置與 3D 幾何維持原版本。

## 本輪驗證

- 核心與代理 9 項：午夜日期、號碼撤回、跨站／跨系統／隔日隔離、有效期、重複矛盾資料、併發去重與失敗退避。
- Chromium、WebKit：360／375／390／414／520／768／1280 寬度，實際觸控回到現在、跟車卡與車站看板、全畫面、亮色及空值零高度；工具抽屜以最前層控件的點擊命中驗證，不把被模態背景遮住的跟車卡誤當前景。
- Swift 直接編譯正式 `RailPlatformSnapshot`，7 個資料契約案例通過；22 個 iOS 原始檔完整 typecheck 通過。小工具各尺寸經正式 SwiftUI View 算圖並檢查邊界。
- Android API 35 模擬器：正式資料比對器與 RemoteViews，兩項 instrumented test 通過。標準／好讀版，150／320／380 dp 列寬，有號碼不裁切，無號碼為 `GONE`；另通過既有 20 項方向與編譯檢查。
- 小工具的背景更新仍由作業系統排程；本輪只更新程式碼，沒有發送商店版本。
