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


## 驗收腳本（兩支，都已掛上出貨鏈）

| 腳本 | 需要的工具鏈 | 內容 | 我跑出來的數字 |
|---|---|---|---|
| `app/scripts/verify_widget_nearest.mjs` | `javac`（JDK 21） | D 半徑單一來源／W 靜態接線／G 前景取位鏈／R·S·K 判定差分 | **PASS=88 FAIL=0** |
| `app/scripts/verify_metro_nearest.mjs` | `xcrun swiftc` | 既有差分測試＋改寫後的半徑判準 | **PASS=63 FAIL=0**（改版前 56） |

掛法：`app/scripts/verify-release.mjs` 的 `runNearestGates()`（呼叫點就在 `verifyAndroidWidgetParity()` 下一行），
另加 `npm run verify:widget-nearest` / `verify:metro-nearest` 兩個別名。
**工具鏈缺席一律紅，不准靜默跳過**——「環境不合就跳過」的閘門在最需要它的那台機器上恰好什麼都不做。

### 為什麼 Android 那一支能在沒有模擬器的情況下跑

判定全部搬進 `WidgetNearestMath`（零 `android.*` import，沿用 `MetroWidgetPlate` 的既有慣例），
`javac` 單獨編、單獨跑。服務範圍那個 `<=` 與深連結的 `__auto__` 守門都刻意放在這一層——
留在 provider 的 `Uri.Builder` 旁邊時，它們只有真機看得見。

期望值由 JS 側**獨立實作**一次（`judge()`），Java 只負責輸出自己的答案；
判準表 `EXPECT = { metro: 12000, rail: 5000 }` 是刻意的第四份（資料檔／iOS／Android 之外），
所以改資料檔而沒改判準表會紅。判準與實作同源時「相等」是零資訊。

## 突變測試（11 發，逐層各一發，全部指名）

做之前先 commit（`adb3a697`）——未 commit 的樹沒有還原點。

| # | 突變 | 紅的具名判準 |
|---|---|---|
| 1 | `WidgetNearestMath.inRange` `<=` → `>=` | **R1 門檻內側 11900m**、**R2 門檻外側 12100m**（＋R4/K1/K2） |
| 2 | iOS `MetroNearestMath.classify` `<=` → `>=` | **H6 邊界內-岡山正北11.9km**、**H7 邊界外-岡山正北12.1km**（＋11 條） |
| 3 | 資料檔 `serviceRadii.metro` 12000 → 9000 | Android **D1＋A1**、iOS **D1＋H13** ← 兩端同時紅＝常數真的單一來源 |
| 4 | `linkable()` 拿掉 `!AUTO.equals(station)` | **L2 哨兵 ⇒ 深連結不帶站** |
| 5 | `Outcome.outOfRange` 的 `clearCache` true → false | **K1 清快取旗標**（＋R2/R4） |
| 6 | `Outcome.fromCache` 的 `stale` true → false | **S1／S3／S5 退快取旗標** |
| 7 | `index.html` 拿掉 `pushNativeGeoFix(loc, now)`（＝issue #55 原狀） | **G1** |
| 8 | `native-bridge.mjs` 的 `fix` 改成 `null` | **G2** |
| 9 | `fix()` 不呼叫 `rememberFix` | **G3** |
| 10 | `fix()` 只刷捷運那顆小工具 | **G4 收到座標後刷新 RailBoardWidgetProvider** |
| 11 | 時戳改用原生收到的那一刻 | **G5** |

**第 1 發驗證了兩側探針的必要性**：`R3 門檻上恰好相等` 在 `>=` 之下**仍然全綠**（等號兩邊都成立）。
只有單側探針或只有等號探針的話，「乾脆全部放行」與「乾脆全部擋掉」都能過關。

### 突變 10 第一次沒紅——判準自己的缺陷，已修

第一版的 G4 寫成「`RailPlacesPlugin.java` 這個**檔案**裡有沒有 `RailBoardWidgetProvider.updateAll`」。
同一個檔案裡的既有 `sync()` 本來就三顆都刷，所以把 `fix()` 裡那一行整個刪掉，G4 照樣全綠。
判準沒有先回答「我在量的是誰」。修法：`methodBody()` 大括號抽取，G3/G4/G5 只量 `fix()` 的方法本體，
並加 `G0` 斷言抽得到本體（否則那三條會恆假地紅，紅得沒有道理）。

### 控制組

三個階段各跑一次「全部還原 → `git status --porcelain` 為空 → 兩支閘門重跑」：
**Android 88/0、iOS 63/0**，全部回到全綠。還原基準是 commit，不是突變前的磁碟快照。

## 這一批踩到、順手修掉的既有問題

- **`verify_android_widget_direction.mjs` 的自動補檔迴圈漏一種 javac 錯誤形狀**：
  靜態方法呼叫（`WidgetNearest.radiusMeters(...)`）在 javac 眼裡是 `symbol: variable` 不是 `symbol: class`，
  原本的正則只收 class，於是補檔迴圈當場停住、A 段報「編譯不過」。補一條 `symbol:\s*variable` 即可
  （下游本來就要求 `JAVA_DIR` 有同名 `.java` 才收，真正的區域變數筆誤不會有對應檔案）。
  修後 **8/9 → 20/20**（編譯過了，後面的執行期探針才跑得到）。

## 跑不動 / 沒能力驗的（交接用）

| 項目 | 為什麼 | 建議的驗法 |
|---|---|---|
| `WidgetNearest` 真的從 assets 讀到 `serviceRadii` | 要 `Context`／`AssetManager`／`org.json` 執行期，`javac` 只證明型別對 | 真機或模擬器：裝上後看捷運卡在 12km 外會不會出「不在服務範圍」；或 `adb shell` 觸發一次小工具刷新 |
| `MetroWidgetData.json` 的 gradle Copy task 實際有跑 | 同上，靜態只驗得到 `build.gradle` 裡那段還在 | 出一次 debug APK 後 `unzip -l app-debug.apk \| grep MetroWidgetData` |
| iOS 端 `Bundle.main` 真的找得到那份 JSON | 閘門用裸執行檔模擬（`Bundle.main` ＝執行檔所在目錄），不等於 widget extension 的 bundle | 真機小工具：自動選站在 12km 外要出範圍外卡面；值讀不到會退成 0 ⇒ 到處都是範圍外，很好認 |
| 「開 App → 回桌面小工具更新」端到端 | 需要真機＋桌面小工具 | Android：開 App 等藍點出現 → 回桌面 → 捷運/台鐵/混合三顆卡都要換成最近的站 |
| `MetroWidgetData.json` 無法重新產生 | 這棵樹的 `data/tdx/` 是空的（已知的「移出版控」危害） | 已改用外科式 patch：node 腳本照產生器的鍵序重建物件，並斷言其餘每個鍵逐 byte 相同（結果：1 行差異、+43 字元）。**下次有人跑得動產生器時要重跑一次確認鍵序一致** |

## 這棵樹上本來就紅、與本批無關的閘門（併入前不要誤記在本批頭上）

| 閘門 | 紅的原因 | 證據 |
|---|---|---|
| `verify_metro_widget_data.mjs` | `data/tdx/` 在這棵樹是空的（`0fe8e6b3` 把它移出版控） | ENOENT `TRTC_FirstLastTimetable.json`；該目錄根本不存在 |
| `verify_widget_logic.mjs` | 同上：`RailBoardFallbackStations.json` 判定過期，來源資料不在 | 本批沒動 `build_widget_station_fallback.mjs` 也沒動那份 JSON |
| `verify_widget_layouts.mjs` | `wl_r7_*` 綁定與第 7 張版面 `widget_board_4x4`——別人在 base 上的進行中工作 | **控制實驗**：把 `RailWidgetRender.java` 還原成 `69202efd` 的版本重跑，一樣紅 |
