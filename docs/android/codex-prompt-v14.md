# Codex 派工書：軌島 Android v14（versionName 1.4.9 / versionCode 14）

> 2026-08-22 建。上一顆 Android＝v13（versionCode 13，已上 Play，基準 commit `b0ca0f5`，
> web bundle 是 v0821d）。這一顆把 v13 之後的全部網站與 App 更新帶上 Android，
> 並讓 Android 小工具跟上 iOS 的「再下一班・約 N 分」。

## 第 0 步：環境自檢（打不到就回報停手，不要硬做）

你只是執行者，先驗自己的環境，任何一項不成立就在回報裡寫明並停手：

1. 可寫根：本任務的工作樹（派工時會告訴你路徑）。**樹外任何檔案不准建立／修改／刪除。**
2. `git switch -c`、`git commit` 打得動（若 `.git` 唯讀＝環境沒配好，回報停手，不是任務失敗）。
3. `env JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.12/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Users/xuxiang/Library/Android/sdk ./gradlew --version` 走得通（**必須 JDK 21**，不可用系統 Java 8、不可用 Android Studio JBR）。
4. 需要抓網路資源時先抓一次試試（例如 `curl -s https://api.railisland.tw/api/metro-live?sys=trtc | head -c 200`），抓不到就回報，不要拿「連不到」推論成「資料不存在」。

## 一、目標與動機

**目標**：從分支 `app/1.4.9-71-waitcard` 出 Android v14——重建 web bundle（帶入 v13 之後
的全部修法）、Android 小工具新增「再下一班・約 N 分」第二班顯示、versionCode 遞增到 14，
產出可上傳 Play 的 AAB（簽章有 key.properties 就簽，沒有就 unsigned，**不准 fallback debug 簽**）。

**動機**：v13 的 web bundle 停在 v0821d。之後主線上了一大批捷運模型與 App 功能修法
（見第二節清單）；同時 iOS 小工具已於 1.4.9 帶上「約 N 分」第二班，Android 小工具要對齊，
且**精度規則絕不可踩錯**（見第三節，這是本案最重要的一條紅線）。

## 二、v13 → 現在的更新內容（web bundle 重建自動帶入，不用逐項手做）

分支 `app/1.4.9-71-waitcard` 的 `index.html` 已含以下全部（你只要照第四節流程重建 bundle）：

- **捷運 Metro Core 統一動畫**：boardPos 補短程／區間車、共站辨線與地圖點車的 Core 身分、
  Core 跟隨 30 秒寬限、Core 空結果逐線退回閘門、即時徽章 0 台與連線失敗顯示、收班豁免。
  伺服端另有三發漂移修法已部署（App 自動受益，無需動作）。
- **等車追蹤**：「點了卻沒出現」三條路徑修復＋逾時與幽靈卡防線；iOS 小工具一鍵開卡（iOS 專屬
  Swift，Android 不編譯、無害）。
- **worker／資料**：邊緣快取 clone 修法、data_provenance 資料來源清單、台鐵通過站回填不取整、
  誤點漸變鍵補名冊日、TYMC 班表快照。
- **本版新增（1.4.9 build 75 同批，web 層，Android 重建 bundle 即帶入）**：
  - 內建「更新了什麼」：`RAIL_WHATS_NEW` 由 `set-release-mode.mjs` 注入，開機彈本版文案
    （不再抓 iTunes lookup 的線上版舊文）；「更多」面板「已是最新版」列可點看本版內容。
  - **強制更新閘門**：`/api/basemap-src` 回 `minAppVersion`（現值 null＝不擋），本機版本較舊
    就全螢幕擋＋「前往更新」。fail-open：抓不到／格式壞一律不擋。
  - **跨平台分流（Android 相關，要驗收）**：商店連結 `storeUrl()` 在 Android 開
    `https://play.google.com/store/apps/details?id=tw.railisland.app`；
    `fetchLatestAppVersion()` 在 Android 一律回 null（iTunes lookup 查的是 iOS 版號，
    給 Android 用戶看是錯資訊）——升級橫幅在 Android 不出現，是刻意行為不是缺陷。

## 三、Android 小工具「再下一班・約 N 分」（本案唯一新原生功能）

### 資料契約（伺服端已上線，欄位已存在）

看板 API 的北捷列可能帶**額外欄位 `eta2`**（epoch 秒）：同月台「再下一班」的**伺服端推導值**，
從在途官方車推導、推不出就沒有這個欄位。既有欄位語意完全不變（additive）。

### 🔴 精度紅線（iOS 卡片在 build 73 踩過，當天被抓包重出——你不准再踩）

`eta2` 是**推導投影，不是官方站牌原文**。規則：

1. eta2 合成的第二班列**只准顯示「約 N 分」**（N＝`ceil((eta2 − now) / 60)`，N ≥ 1），
   **絕不准畫成 mm:ss 秒級倒數**——那等於拿推估冒充官方精度。
2. 投影已到期（N < 1）**整行不畫**：推導表達不了「進站」，「約 0 分」比留白更誤導。
3. 官方列（本來就有的第一班）維持原樣，**不准順手把官方列也降級成分鐘**——
   「有資訊就一定要對」，官方秒級倒數是產品的核心價值。
4. **快取 round-trip 必須保留 approx 身分**：如果你的快取層存列資料，approx 旗標要一起存
   一起讀——否則斷網時從快取重畫，「約 N 分」會變成秒級倒數（iOS 的 MetroFetcher 踩過，
   修法就是 cache 寫入/讀出各補一行）。
5. `RailWaitNotification.java` 目前的 secondEta/secondMinutes 餵入端（index.html 的
   `metroWaitPayload`）只送官方列、無 approx——**維持現狀就安全**；若你讓通知也消費 eta2，
   上面四條同樣適用。

### iOS 參照實作（照抄語意，不用照抄結構）

- 合成：`app/ios/App/App/MetroWidgetShared.swift` 的 `MetroBoardModel.trtc()`——
  approx 列帶 `etaEpoch=eta2, approx:true`，無擁擠度、無車號。
- 渲染：`app/ios/App/RailBoardWidget/MetroBoardWidget.swift` 的 `MetroCountdown`——
  **approx 分支在秒級分支之前**。
- 快取：同檔 `MetroFetcher`——寫入 `if r.approx { d["approx"] = true }`、
  讀出 `approx: r["approx"] as? Bool ?? false`。

### Android 落點

- `app/android/app/src/main/java/tw/railisland/app/MetroWidgetData.java`：解析 `eta2` 合成
  approx 列（或等價結構），快取層同步 round-trip。
- `MetroWidgetPlateRender.java`／`MetroWidgetPlate.java`：第二班行渲染「約 N 分」
  （樣式比照既有第二列，前綴「約」，不出秒數）。
- 版面塞不下第二行的尺寸就不畫（比照 iOS：小尺寸只有第一班）。

## 四、建置流程（逐條照做）

```bash
# 1) 分支（從 app/1.4.9-71-waitcard 最新 tip 起）
git switch -c codex/android-1.4.9-v14 app/1.4.9-71-waitcard

# 2) versionCode 13 → 14（app/android/app/build.gradle；versionName 維持 "1.4.9"）

# 3) 重建 web bundle＋同步（在 app/ 目錄）
node scripts/set-release-mode.mjs feature     # 產 www＋跑 verify-release（178 檔閘門）
npx cap sync android

# 4) 檢查 capacitor.settings.gradle：cap sync 可能把 node_modules 寫成【絕對路徑】，
#    出貨前必須恢復 ../node_modules/... 相對路徑（這是已知陷阱，不是你造成的）

# 5) build（在 app/android/）
env JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.12/libexec/openjdk.jdk/Contents/Home \
  ANDROID_HOME=/Users/xuxiang/Library/Android/sdk \
  ./gradlew clean assembleRelease bundleRelease
```

注意：`key.properties`（gitignored）在才簽章、不在產 unsigned；keystore 在 repo 外
（`/Users/xuxiang/Keys/railisland/`），你不需要也不應該碰它。

## 五、驗收條件（全部要有證據，做不到的寫明做不到）

1. **AAB/APK 產出**：`bundleRelease` 成功，回報產物路徑＋SHA-256＋versionCode=14 的證明
   （`aapt dump badging` 或 gradle 輸出）。
2. **web bundle 身分**：`app/android/app/src/main/assets/public/index.html` 含
   `window.RAIL_APP_WHATS_NEW="軌島 1.4.9`、`appGateCheck`、`PLAY_STORE_URL`，
   且 md5 與 `app/www/index.html` 一致。
3. **小工具第二班**：模擬器（`RailIsland_API35_Pixel7_Play`）實掛小工具截圖——
   (a) 有 eta2 的站顯示「約 N 分」第二行；(b) 無 eta2 的站第二行留白；
   (c) **反向對照：第二行絕不出現 mm:ss 形式**（正則掃渲染輸出或截圖逐字）。
4. **精度突變測試**：把你的 approx 分支故意改成走秒級渲染，對應判準要變紅；改回來要全綠
   （沒有控制組的判準不算判準）。
5. **快取 round-trip**：斷網重畫（或單元測試）證明 approx 列從快取出來仍是「約 N 分」。
6. **強更閘門 Android 行為**：WebView 內注入 `appGateCheck({minAppVersion:'99.0.0'})`，
   截圖確認全螢幕擋出現；點「前往更新」確認外開的是 **Play 商店頁不是 App Store**。
7. **既有功能回歸**：開 App 確認地圖畫車正常、等車追蹤通知正常（點站→追蹤這站→通知出現）。
8. Data safety 不變（本批無新蒐集項）；16KB page size 維持通過。

## 六、回報格式

- 只回：結論、關鍵證據（檔案:行號／截圖路徑／SHA-256）、風險與未確定點。
- 長產物寫到檔案，回傳路徑（不要貼全文）。
- 不要過程流水帳。
- 關鍵結論隨做隨寫入 `docs/android/v14-progress.md`，不要只在最終回報才輸出。
- Play 上傳由使用者親自執行，你只交付 AAB 與證據。
