# 單元 D 實作筆記 — 最近站解析共用層

分支 `feat/widget-nearest`，基於 `69202efd`。設計書：`docs/specs/2026-09-11-bus-widget-shared-layers.md`「單元 D」。

## 動工前的現況覆核（自己重查，不採信設計書的轉述）

| 斷言 | 我實查的結果 |
|---|---|
| Android 從未主動要過定位 | `MetroWidgetData.java:382`／`RailWidgetData.java:1066` 都只有 `getLastKnownLocation`，全 `app/android` 無 `requestLocationUpdates`／`FusedLocation` |
| Android 無服務範圍概念 | `MetroWidgetData.nearest()` 回最近站不套門檻；`RailWidgetData.nearest()` 同。唯一的 5km 是「我的地點」`PLACE_MAX_METERS`（`RailWidgetData.java:51`），與自動選站是兩回事 |
| iOS 12km | `MetroNearest.swift:82` `serviceRadiusMeters = 12_000.0` |
| iOS 台鐵「我的地點」5km | `RailBoardData.swift:644` `maximumDistanceMeters = 5_000.0` ← **設計書沒點名的第三份字面值** |
| 守門人只守 iOS | `verify_metro_nearest.mjs:70` 正則抽 Swift 字面值 |
| 台鐵小工具同病 | 確認。`RailBoardWidgetProvider.java:94` 與 `MixedBoardWidgetProvider.java:89` 兩個呼叫點 |
| **`verify_metro_nearest.mjs` 不在任何出貨鏈上** | 全 repo 只有註解提到它，`package.json` 沒有對應 script，`verify-release.mjs` 沒引用 ⇒ 依 `app/出貨規則.md` 第四節等於不存在。本批一併掛上 |

### 資料檔的可行性（決定把半徑放哪裡的關鍵事實）

`app/ios/App/RailBoardWidget/MetroWidgetData.json`（76KB）**兩端都已經在讀**：

- iOS：`Bundle.main`，同時掛 App 與 RailBoardWidgetExtension 兩個 target。
- Android：`app/android/app/build.gradle:81-86` 的 `syncMetroWidgetData` Copy task 在 `preBuild` 把它複製進 assets。

⇒ 半徑放這裡**零新增打包風險**（不必動 `project.pbxproj`、不必新增 gradle task）。
代價是名字叫 Metro 卻裝了跨運具的表，已在產生腳本與兩端讀取處各寫一句說明。

## 四項變更的落點

1. **前景取位並落地**：`RailPlacesPlugin.fix()`（照抄 `sync()` 的形狀：收 lat/lon、驗台灣範圍、寫 SharedPreferences、刷新小工具）← `native-bridge.mjs` 的 `RAIL_NATIVE_PLACES.fix` ← `index.html` `acceptGeoFix()`（前景定位的唯一漏斗）。
2. **快取「上次解析出的最近站」**：`WidgetNearest` 的 slot 快取，存站鍵字串不存座標。
3. **範圍外清快取**：`WidgetNearest.resolve()` 判到 outOfRange 就 `clearStation()`。
4. **退快取標示**：`MetroWidgetPlate.Chip.AUTO_STALE`／`chipText = 上次位置`（與 iOS `MetroBoardWidget.swift:458` 同一個詞）。台鐵走 `RailWidgetData.Snapshot.autoStale` → 卡面副標。

## 常數單一來源

`build_metro_widget_data.mjs` 的 `SERVICE_RADII = { metro: 12000, rail: 5000 }` → 產物的 `serviceRadii`。

- iOS：`WidgetServiceRadius`（`MetroWidgetShared.swift`，兩個 target 都有）→ `MetroNearestMath.serviceRadiusMeters`、`RailBoardPlaces.maximumDistanceMeters`。
- Android：`WidgetNearest.radiusMeters(ctx, modality)` → 捷運自動選站、`RailWidgetData` 的我的地點與台鐵自動選站。
- **逐運具一個值**，不是單一常數。公車這一輪不填（設計書明寫要實算，屬單元 C）。

讀不到就回 **0**（＝全部落在範圍外、卡面當場說話），刻意不留字面值預設：留了就是在程式碼裡再放一份，而「資料檔沒接上」會靜靜地看起來完全正常。

（以下各節在實作過程中追加。）
