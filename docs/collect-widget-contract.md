# 車站收集桌面小工具：資料契約（payload v1）

網頁、iOS、Android 三方共同遵守的資料格式與畫法約定。改這份，三方要一起改。
網頁端的產生邏輯在 `index.html` 的 `collectionWidgetPayload()`；獨立驗證在 `scripts/verify_collect_widget_payload.mjs`。

## 架構：網頁算、原生只畫

- **數字只有一個來源**：`n` 就是旅程護照「車站 N 座」用的同一個函式 `stationCollection(loadRides()).size`。
  原生端不重算——別名併回（`checkinAliasMap`）吃隨分頁變動的 `state.schedStations`，原生端另算會與護照差 1～2 站。
- 原生端只做三件事：驗形狀、原樣寫檔、讀檔來畫。唯一自己算的是三個純顯示量：百分比字串、進度條（圓環）填滿比例、
  單一系統範圍的取景視窗（見〈畫法約定〉）。
- 純網站沒有原生橋接：這整段功能不啟動（不抓站點清單、不掛 listener、零副作用）。

## 通道

`app/src/native-bridge.mjs` 在 iOS／Android 註冊 Capacitor 外掛 `RailCollection`，並暴露

```js
window.RAIL_NATIVE_COLLECTION = { sync: json => RailCollection.sync({ json }) }; // json 是字串
```

原生端驗過形狀就原樣寫檔、不解碼內容（格式演進不用動外掛）。兩個平台用同一套驗證，下列任一情況一律 reject：
沒有 `json`、空字串、超過 512 KB、不是 JSON 物件、物件後面還有多餘文字、`v` 不是數字 `1`。

| 平台 | 寫到哪裡 | 寫完 |
|---|---|---|
| iOS | App Group `group.tw.railisland.app` 容器根目錄的 `collection.json`（原子寫入） | `WidgetCenter.shared.reloadTimelines(ofKind: "CollectionWidget")` |
| Android | App 私有儲存 `files/collection.json`（原子寫入） | 通知小、中兩個 Provider 重畫 |

## 推送時機（網頁端）

開機資料就緒後；`writeCheckin`；完乘紀錄與帳號同步合併（`rail-user-data-changed`）；切換語言；
`userDataRenderAll`（登出、刪帳號、換帳號）；換分頁後 `schedStations` 更新（別名併回吃它，護照數字可能跟著變）。
去抖 2 秒；內容（不含 `at`）與上一包相同就不送；送失敗（舊版 App 沒有這個外掛）下次觸發重送。

## 收集鍵與站點清單（分母）

- 清單來自 `data/track_stations.geojson`。收集鍵是 `系統段|站名`：`tra_sched`、`thsr_sched`、`afr_sched` 各自一段，
  各捷運與輕軌系統一律併成 `metro`——同一座站掛在兩個系統（台北車站、紅樹林、頂埔等）只算一枚章，清單裡兩個系統各有一點。
- **同名但實體是兩座的站另立系統段**。目前只有台中的「市政府」：收集鍵 `tmrt|市政府`，與台北的 `metro|市政府` 各算一座。
  沒有記錄城市的舊紀錄（含舊版 App 同步進來的 `metro|市政府`）一律歸台北，不需遷移；舊版用戶端收到 `tmrt|市政府`
  會把它當獨立的一座站，不會當機、也不會與台北重複計算。單一定義：`index.html` 的 `collectSysSeg`／`COLLECT_SPLIT`。
- 清單站名 → 收集鍵站名的規則是**靜態的，不隨目前分頁變**：台鐵的台北一族（台北、臺北、臺北-環島）併成「臺北」，
  其餘台鐵舊名去掉括號別名（`左營(舊城)` → `左營`、`新城 (太魯閣)` → `新城`）。清單是全台固定的一份；
  若吃 `schedStations`，捷運分頁（空的）與高鐵分頁（只有高鐵站）查不到台鐵別名，清單會多出兩個永遠收不到的站。
- 清單外的已收集站（清單裡找不到座標）照算進 `n` 與 `total`，只是地圖上畫不出來。

## payload v1

```jsonc
{
  "v": 1,
  "at": 1790690000000,          // 產生時間 ms
  "lang": "zh-TW",              // 網頁當下語言；以下所有文字已是這個語言
  "box": [120.15, 22.2, 122.0, 25.27],  // 投影框 lon0, lat0, lon1, lat1（固定值）
  "aspect": 0.5516,             // 點陣寬高比 = (lon1-lon0)*cos(緯度中點)/(lat1-lat0)
  "n": 201,                     // 已收集座數 = 護照「車站 N 座」= stationCollection(loadRides()).size
  "total": 539,                 // 全站座數：清單（收集鍵去重）與已收集的鍵的聯集
  "sys": [                      // 固定順序 tra, thsr, trtc, tymc, tmrt, krtc, ntdlrt, ntalrt, sanying, afr（清單裡有站的才列）
    { "k": "tra", "label": "台鐵", "v": 77, "n": 241 }   // v/n = 該系統的已收集／全部（收集鍵去重）
  ],
  "recent": [                   // 每個系統各取最近 4 筆，合併後整體排序
    { "name": "菁桐", "line": "平溪線", "k": "tra", "d": "2026-09-27" }
  ],
  "pts": [                      // 每個系統每座站一點
    [412, 236, "#E4572E", 2, 0]   // [x, y, color, s, sysIdx]
  ]
}
```

| 欄位 | 語意 |
|---|---|
| `v` | 格式版本，整數，固定 `1`。 |
| `at` | 產生時間（ms）。內容是否變動的比對不含這一欄。 |
| `lang` | `zh-TW`、`en` 或 `ja`。`sys[].label`、`recent[].name`、`recent[].line` 都已是這個語言。 |
| `box`、`aspect` | 固定值。點位座標是這個投影框正規化到 0..1000 的結果；`aspect` 用來把框畫進地圖區不變形。 |
| `n` | 已收集座數（跟完、搭過、到訪都算），含清單外的已收集站。 |
| `total` | 分母。清單與已收集的鍵去重後的座數。 |
| `sys[]` | `k` 系統代碼；`label` 晶片用的簡稱（網頁自帶三語）；`v` 該系統已收集座數；`n` 該系統清單座數。 |
| `recent[]` | `name` 站名（當下語言）；`line` 線名（線名取不到、或長得像代碼時退回系統簡稱）；`k` 歸屬系統；`d` 最後一次蓋章日（`YYYY-MM-DD`，只有最後一次、沒有第一次）。 |
| `pts[]` | `x`、`y`：0..1000 整數，x 由西到東、y 由北到南；`color`：線色 `#RRGGBB`；`s`：0 未收集、1 跟完、2 搭過或到訪；`sysIdx`：對應 `sys` 陣列索引。 |

`pts` 的細節：同名的捷運站在不同系統各一點（位置不同）；轉乘站一線一筆，只留第一筆（位置與線色）。
`s` 由 `stationCollection` 每站的狀態轉成：`follow` → 1、`pass`（搭過）→ 2、`visit`（到訪）→ 2、清單裡沒有紀錄 → 0。

`recent` 的細節：

- 排序：`d` 新到舊、同日依該站累計次數 `n` 大到小、再依收集鍵字典序。
- 每個系統各取最近 4 筆，合併後整體再依同一規則排序，欄位形狀不變。
- 系統歸屬：清單裡第一個有這把收集鍵的系統；清單外的站退到同鍵的第一個系統。
- 原生端：全台範圍取前 4 筆；單一系統範圍取 `k` 相符的前 4 筆（中卡放得下幾筆就畫幾筆）。

## 畫法約定（iOS、Android 必須一致）

座標都在 `pts` 的 0..1000 正規化空間；整島框 1000×1000 是照 `aspect` 畫進地圖框的，所以正方形視窗＝真實比例不變形。

1. **尺寸**：iOS 有 systemSmall、systemMedium、accessoryRectangular、accessoryCircular；Android 有小、中兩款。
2. **全台範圍**：整島框。
3. **單一系統範圍**（放大到該系統，附近畫灰點）：
   - 取該系統所有點的外框 `[minX, maxX] × [minY, maxY]`，寬 `w`、高 `h`；邊距 `pad = max(0.12 × max(w, h), 10)`，四邊各加 `pad`。
   - 視窗邊長 `S = max(w + 2·pad, h + 2·pad, 40)`（正規化單位下的正方形），以外框中心為中心；超出 0..1000 不必夾回。
   - 地圖框的位置與大小跟全台範圍相同（版面不跳），框內把視窗 `[cx − S/2, cx + S/2] × [cy − S/2, cy + S/2]` 等比放大填滿。
   - 視窗內其他系統的點畫成中性灰（比該系統未收集的灰更淡一階），先畫；該系統的點照三態畫在上面；視窗外的點不畫。
4. **三態**：`s = 2` 線色實心圓；`s = 1` 線色**空心圈**（圈寬約半徑的 0.45 倍，圈外徑＝實心圓直徑）；`s = 0` 灰色小實心點。
   淺色、深色、著色模式都要分得出空心與實心。圖例：實心＝搭過或到訪、空心＝跟完（中卡放得下才放一行）。
5. **百分比顯示**：`p = n / total × 100`。`n > 0` 且四捨五入為 0 → 顯示「<1%」；`n < total` 且四捨五入為 100 → 顯示「99%」；
   其餘四捨五入。進度條與圓環照實際比例，至少 3% 才看得見（下限維持）。
6. **點小工具**：所有尺寸都開 `railisland://passport`。原生把它轉成既有的 `waitOpen` 事件，資料帶 `view: "passport"`
   （iOS `RailMetroWaitPlugin.swift`；Android `RailMetroWaitPlugin.java` 與 `AndroidManifest.xml` 的 intent-filter）；
   網頁 `waitOpen` 收到 `view === 'passport'` 就打開旅程護照（`openRidePanel()`）。
7. **字串**：原生端的靜態字串來源是 `app/scripts/build_native_localizations.mjs`（重產 xcstrings 與 Android `RailNativeL10n.json`，不直接改產物）；
   站名、線名由網頁送當下語言。

## 驗證

- 網頁端：`scripts/verify_collect_widget_payload.mjs`（`ENGINE=chromium|webkit`）。
- iOS 算繪：`app/scripts/render_collect_widget.mjs`；Android：`app/scripts/verify_android_collect_widget.mjs`。
  兩邊的百分比、進度條、取景視窗都從 payload 用另一份實作獨立重算比對。
