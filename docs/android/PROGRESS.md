# Android 殼階段一進度

日期：2026-08-04

## 執行邊界與基線

- 工作目錄實測：`pwd` → `/Users/xuxiang/Code/軌島-Android`。
- `git status --porcelain` 起始輸出只有 `?? docs/android/`；該目錄內既有使用者檔案 `codex-prompt-android-shell.md`，本輪保留不動。
- `app/node_modules` 實測仍為 symlink：`app/node_modules -> /Users/xuxiang/Code/捷運小動畫/app/node_modules`。本輪不執行 npm install／npm ci／刪除。
- `app/android` 起始時不存在（`test -d app/android` exit 1）。
- 來源圖尺寸實測：AppIcon `1024×1024`；Splash `2732×2732`（`sips -g pixelWidth -g pixelHeight`）。
- 未找到工作樹內 `AGENTS.md`；依派工單規範執行。
- 全程禁止 git 寫操作；本文件只記錄唯讀 git 檢查。

## 任務結果

後續按 A–I 完成即追加；若中斷，以本節內容為準。

### A. 產生 Android 專案

- 第一次 `cd app && npm run build`：exit 1。既有發行防呆拒絕已核准授權素材的專案直接產生安全 build，錯誤關鍵行為 `若確實要建安全 build，設 RAIL_ALLOW_SAFE_BUILD=1 再跑`。
- 判斷：本階段明確要求安全 build；`RAIL_ALLOW_SAFE_BUILD=1` 只確認此意圖，不是 `RAIL_INCLUDE_LICENSED_*` 授權內容旗標。列為同一錯誤第 1 輪處理。
- 第二次 `RAIL_ALLOW_SAFE_BUILD=1 npm run build`：exit 1。資料 manifest 閘門通過（`✅ data_manifest 與 27 個資料檔一致`），隨後 `build_place_index.mjs` 在 `server.listen(0, '127.0.0.1')` 遇到 `listen EPERM: operation not permitted 127.0.0.1`。證據：`app/scripts/build_place_index.mjs:65`；這是執行環境禁止綁定 loopback，不是應用程式編譯錯誤。
- loopback 錯誤的第 2 輪處理：曾暫時把本機 HTTP server 改成 Playwright route fulfillment，保留同一 HTTP origin／fetch 與真實頁面 runtime，不略過 `place_index`。重跑仍 exit 1，但錯誤前進到 Chromium 啟動：`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer... Permission denied (1100)`，並以 `SIGTRAP` 結束；表示 sandbox 同時禁止 listener 與 Chromium 所需的 macOS Mach service。
- 已用檔案補丁還原上述實驗性修改，不留下未驗證的產生器變更。為避免用舊 `place_index`、跳過發行閘門或無限重試，A 的 build 停在此處；假設是目前 Codex sandbox 能力限制，需在一般 Terminal／CI 執行同一安全 build 才能驗證。其餘不依賴 `www/` 的工作繼續。
- `ANDROID_HOME=… npx cap add android`：exit 0，關鍵行 `android platform added!`；因 `www/` 尚未產生，命令同時警告 `sync could not run--missing www directory`。
- 獨立 `ANDROID_HOME=… npx cap sync android`：exit 1，關鍵行 `Could not find the web assets directory: ./www.`。根因承接前述 loopback sandbox 阻擋；不建立假的 `www`。
- 後續驗收時偵測到安全產物已出現：`app/www/index.html` 與 `data/place_index.json` mtime 均為 `2026-08-04 23:32:20`；`www` 為 BUILD `v0804g`、134 檔，明確注入 `RAIL_MUSIC_AVAILABLE=false`／`RAIL_ONLINE_BASEMAPS_AVAILABLE=false`，且 release verifier 通過，故不是授權 build 或版本落後產物。
- 再跑指定 `ANDROID_HOME=… npx cap sync android`：exit 0。關鍵行：`Copying web assets from www …`、辨識五個指定外掛、`Sync finished in 0.048s`。
- `RAIL_ALLOW_SAFE_BUILD=1 npm run build` 的 loopback 第 2 次實測仍 exit 1、同為 `listen EPERM 127.0.0.1`，依規則停止。未帶確認旗標的原始 `npm run build` 也會先被本機 release-policy 防呆擋下；因此 A 的「build 命令 exit 0」仍不成立，但目前安全 `www` 本身已通過 verifier 並完成 sync。

#### 2026-08-04 負責人重新驗證

- 依既有發行閘門的明示提示，以 `RAIL_ALLOW_SAFE_BUILD=1 npm run build` 表達本階段刻意產生安全 build；沒有設定任何 `RAIL_INCLUDE_LICENSED_*` 旗標。
- 允許既有 build 流程在 sandbox 外使用 loopback 與 bundled Chromium 後重跑：exit 0。關鍵輸出：`place_index v1 samples=16 trains=1151 segments=36436 lines=17 bytes=8952635`、`App 發行檢查通過：app/www，v0804g，134 個檔案，41.0 MB，音樂 關閉，線上底圖 關閉`、`App web assets ready`。
- 結論更新：安全 web build 已通過；先前失敗確定是 Codex sandbox 的 loopback／Mach service 限制，並非產品程式錯誤。Android sync 待下一步實測。
- `ANDROID_HOME="$HOME/Library/Android/sdk" npx cap sync android`：exit 0。關鍵輸出：`Copying web assets from www to android/app/src/main/assets/public`、辨識到指定的 5 個 Capacitor plugins、`Sync finished in 0.05s`。
- A 最終結論：既有 Android 骨架已由 `npx cap add android` 成功產生，重新安全 build 與本次 Android sync 均已通過，沒有建立或要求任何憑證檔。

### B. 版號與識別

- `app/android/app/build.gradle:4,7,10-11`：`namespace`／`applicationId` 均為 `tw.railisland.app`，`versionCode 1`，`versionName "1.3.2"`。
- `app/android/app/src/main/res/values/strings.xml:3-6`：顯示名稱／Activity 標題為 `軌島`，package name 與 URL scheme 為 `tw.railisland.app`。
- 結論：符合指定值；Android 首次 Play 上架採獨立 `versionCode 1`，未改用 iOS build 19。
- 負責人於成功 `cap sync android` 後重驗：`app/android/app/build.gradle:4,7,10-11` 仍為 namespace／applicationId `tw.railisland.app`、versionCode `1`、versionName `1.3.2`；`strings.xml:3-6` 仍為顯示名稱 `軌島` 與指定 package。B = PASS。

### C. 圖示與啟動畫面

- 來源尺寸（`sips` 實測）：`AppIcon-512@2x.png` = `1024x1024`；`splash-2732x2732.png` = `2732x2732`。
- legacy launcher（同尺寸亦產生 `ic_launcher_round.png`）：`mipmap-mdpi/ic_launcher.png` `48x48`、hdpi `72x72`、xhdpi `96x96`、xxhdpi `144x144`、xxxhdpi `192x192`。
- adaptive foreground：mdpi `108x108`（圖示內容 71px）、hdpi `162x162`（107px）、xhdpi `216x216`（143px）、xxhdpi `324x324`（214px）、xxxhdpi `432x432`（285px）；內容約佔畫布 66%，以 `#f4edda` 補邊。`mipmap-anydpi-v26/ic_launcher*.xml` 的 background 指向 `@color/ic_launcher_background`、foreground 指向上述 mipmap；`values/ic_launcher_background.xml:3` 與 `drawable/ic_launcher_background.xml:8` 均為 `#F4EDDA`。
- splash（全部由指定 2732px 來源以 `sips` 等比縮放加白邊）：fallback `drawable/splash.png` `480x320`；portrait mdpi `320x480`、hdpi `480x800`、xhdpi `720x1280`、xxhdpi `960x1600`、xxxhdpi `1280x1920`；landscape mdpi `480x320`、hdpi `800x480`、xhdpi `1280x720`、xxhdpi `1600x960`、xxxhdpi `1920x1280`。
- 所有上述尺寸均來自逐檔 `sips -g pixelWidth -g pixelHeight` 的 exit 0 輸出，不以檔名推定。
- 負責人於成功 sync 後再以 `sips` 逐檔抽驗，legacy 兩組、adaptive foreground 五組、portrait／landscape splash 十組與 fallback 全部維持上述尺寸；並實際檢視 `xxxhdpi` foreground，確認完整圖示已置中內縮、未把 1024px 原圖直接貼滿 adaptive 畫布。`mipmap-anydpi-v26/ic_launcher*.xml:3-4` 分別引用純色背景與 foreground。C = PASS。

### D. 權限與 AndroidManifest

- 已讀本機參照 `app/NATIVE_PRIVACY_AND_PERMISSIONS.md` 核對既有平台決策；依限制不在本文件摘錄或引用其內容。另以版控內 `app/ios/App/App/Info.plist:45-49` 確認 iOS 只有使用中定位用途，沒有背景定位 capability／Always 請求。
- App 主 manifest 的最小明示權限為 `INTERNET`、`ACCESS_COARSE_LOCATION`、`ACCESS_FINE_LOCATION`（`app/android/app/src/main/AndroidManifest.xml:38-42`）。沒有加入 `ACCESS_BACKGROUND_LOCATION`：現行功能是 App 開啟/前景使用中定位，沒有 Android 背景定位需求證據。
- Local Notifications 8.2.1 自帶 `RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`、`POST_NOTIFICATIONS`（`app/node_modules/@capacitor/local-notifications/android/src/main/AndroidManifest.xml:17-19`）；Android 13 的通知請求由 plugin annotation 與方法處理（`LocalNotificationsPlugin.java:33-36,207-225`）。開機 receiver 會處理 `LOCKED_BOOT_COMPLETED`／`BOOT_COMPLETED`／`QUICKBOOT_POWERON`（plugin manifest `:6-15`），符合排程提醒在重開機後恢復的需求。
- App 的提醒 payload 使用指定 `schedule.at`（`index.html:12900-12909`）。plugin 對單次 `at` 呼叫 `setExactIfPossible`（`LocalNotificationManager.java:335-347`）；Android 12+ 若 `canScheduleExactAlarms()` 為 false，明確降級成 `setAndAllowWhileIdle`／`set`，不會移除提醒功能（同檔 `:374-395`）。
- **不加入** `SCHEDULE_EXACT_ALARM`：plugin 自己沒有宣告它，README 說只有要求精準觸發才需由 App 另加（`README.md:18-24`），而現行 UI/bridge 沒有 `checkExactNotificationSetting`／`changeExactNotificationSetting` 的使用路徑。保守採 plugin 的非精準 fallback，避免 Play exact-alarm 特殊權限審查；風險是發車提醒在省電/系統批次排程下可能延遲，需實機待驗。
- **不加入** `USE_EXACT_ALARM`：plugin README 明確限定 exact alarm 為 App 核心功能時才用（`README.md:26`）；目前沒有足夠證據符合 Play 政策資格。
- 其他四個直接 plugin manifest（Geolocation、Share、Firebase Authentication、RevenueCat）皆為空 manifest，未直接宣告額外權限。Gradle 8.14.3 wrapper 後來已成功下載，但 Android Studio JBR 25 對該 Gradle 過新，以 `Unsupported class file major version 69` 停在 build script 解析；因此 transitive AAR 的 merged manifest 仍尚無法實測。

#### 可考慮 remove 的權限（本階段不移除）

- `android.permission.WAKE_LOCK`：Local Notifications manifest 直接帶入（`:18`），但對該 plugin Android 原始碼全文搜尋 `WakeLock`／`PowerManager`／`WAKE_LOCK` 沒有使用點；列為下一階段在 merged manifest 與實機排程/重開機回歸後可考慮以 manifest merger `tools:node="remove"` 移除的候選。
- 其餘直接帶入權限目前都有用途：`POST_NOTIFICATIONS` 顯示提醒、`RECEIVE_BOOT_COMPLETED` 恢復排程。Transitive AAR 權限因缺少相容 JDK 而尚無 merged manifest，待補 JDK 後再盤點；此處不猜測、不先移除。

#### 2026-08-04 負責人重新驗證

- 成功 Android sync 後重讀五個直接 plugin manifest：只有 Local Notifications 8.2.1 宣告權限，仍是 `RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`、`POST_NOTIFICATIONS`（plugin manifest `:17-19`）；其餘四個 manifest 均無 `uses-permission`。
- App manifest 最小明示集維持 `INTERNET`、`ACCESS_COARSE_LOCATION`、`ACCESS_FINE_LOCATION`（`app/android/app/src/main/AndroidManifest.xml:40-42`），沒有背景定位、媒體、相機、麥克風或儲存權限。
- App 只排單次 `schedule.at`（`index.html:12908`，bridge 在 `app/src/native-bridge.mjs:59`）；沒有呼叫 plugin 的 exact-alarm 設定檢查／跳轉 API。plugin README `:18-26` 說 exact 才另加 `SCHEDULE_EXACT_ALARM`，`USE_EXACT_ALARM` 僅限 exact 是核心功能；原始碼在沒有 exact 設定時會走非精確 `setAndAllowWhileIdle`／`set` fallback（`LocalNotificationManager.java:380-395`）。因此兩個 exact-alarm 權限都不加入。
- 「可考慮 remove」候選維持 `WAKE_LOCK`：plugin manifest 直接帶入，但對其 Android 目錄全文搜尋只有 manifest 自己命中，沒有 `WakeLock`／`PowerManager` 使用點。此輪不移除；下一階段須以 merged manifest 加上實機排程、休眠、重開機回歸後才可決定。`RECEIVE_BOOT_COMPLETED` 與 `POST_NOTIFICATIONS` 有明確功能用途，不列候選。
- D 結論：最小權限決策與 exact-alarm 政策風險已有鎖定版本的檔案／行號證據，未擴大權限面。Merged manifest 待 Gradle build 成功後再補實測。
- 2026-08-05 merged manifest／APK 實測：最終權限為 `INTERNET`、coarse／fine location、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`、`POST_NOTIFICATIONS`、`ACCESS_NETWORK_STATE`、`BILLING`、`READ_GSERVICES`，以及 AndroidX Core 自建的 app-signature dynamic-receiver permission（`app/android/app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml:13-37`）。`aapt2 dump permissions` 對實際 APK 得到同一組；**沒有** `ACCESS_BACKGROUND_LOCATION`、`SCHEDULE_EXACT_ALARM`、`USE_EXACT_ALARM`、相機、麥克風、媒體或儲存權限。
- Manifest merger 來源：`ACCESS_NETWORK_STATE` 由 Firebase Auth 24.0.1 首先加入，亦被 Geolocation／reCAPTCHA 使用（`manifest-merger-debug-report.txt:434-438`）；`BILLING` 由 BillingClient 8.3.0 加入（`:594-597`），是 RevenueCat 購買功能必要；`READ_GSERVICES` 由 Firebase Auth 的 reCAPTCHA 18.6.1 加入（`:646-649`）；dynamic-receiver permission 由 AndroidX Core 1.17.0 加入（`:690-709`），是 signature protection，不是系統 runtime prompt。
- 「可考慮 remove」仍只有 `WAKE_LOCK` 有直接的未使用證據。`ACCESS_NETWORK_STATE`、`BILLING`、`READ_GSERVICES` 分別服務已選定的 Firebase／Geolocation、RevenueCat Billing、Firebase reCAPTCHA 依賴；dynamic-receiver permission 是 AndroidX 安全機制，均不列移除候選。本階段按要求未移除任何 transitive 權限。D 最終 = PASS。

### E. verify-release Android 斷言

- 已依 iOS 同一陣列寫法加入 `['Android', join(appRoot, 'android/app/src/main/assets/public/index.html')]`（`app/scripts/verify-release.mjs:369-372`）；`node --check scripts/verify-release.mjs` exit 0。
- 紅燈實測：負責人只把 Android generated public 的 `const BUILD` 暫改為 `v0804g-android-red-test`，`RAIL_ALLOW_SAFE_BUILD=1 npm run verify` exit 1；關鍵輸出：`Android 內嵌資產版本不一致 ... 為 v0804g-android-red-test,app/www 為 v0804g`，失敗位置 `verify-release.mjs:385`。
- 立即還原為 `v0804g` 後同命令 exit 0；關鍵輸出：`App 發行檢查通過：app/www，v0804g，134 個檔案，41.0 MB，音樂 關閉，線上底圖 關閉`。`rg` 實測 repo、www、Android public 三份 BUILD 均為 `v0804g`，暫改內容已完整還原。不帶環境變數時會先被既有 release-policy 的安全 build 防呆拒絕；`RAIL_ALLOW_SAFE_BUILD=1` 是依閘門指示明示刻意安全 build，未使用任何 `RAIL_INCLUDE_LICENSED_*`。

### F. Android 版控邊界

- `app/.gitignore:5-16` 已改為「原生專案本體進版控，只忽略建置產物、本機設定與機密」，包含指定的 build、`.gradle`、`local.properties`、Firebase JSON、JKS/keystore、`.idea`、captures、`.cxx`。
- `git status --porcelain app/android | head -20` 實測 exit 0，輸出 `?? app/android/`：專案骨架是未追蹤且未被忽略。
- `git check-ignore -v` 實測 project body：`app/android/app/build.gradle`、`app/android/settings.gradle`、`app/android/app/src/main/AndroidManifest.xml` 全部 exit 1（`NOT_IGNORED`）。
- 同一命令實測忽略項：`android/build/probe.txt`、`android/app/build/probe.txt`、`android/.gradle/probe.txt`、`android/local.properties`、`android/app/google-services.json`、`release.jks`、`release.keystore`、`.idea/workspace.xml`、`captures/probe.png`、`app/.cxx/probe.txt` 全部 exit 0 且有命中規則輸出。部分 build/captures/.cxx 先命中 Capacitor 生成的 `app/android/.gitignore` 同義規則，其餘機密命中 `app/.gitignore:11-14`；實際忽略結果符合要求。

### I. 平台差異盤點

- 已建立 `docs/android/PLATFORM-GAPS.md`，逐項表列 `項目 | iOS 現況（檔案:行號）| Android 是否需要 | 建議做法 | 風險`；範圍為根 `index.html` 與 `app/src/native-bridge.mjs`，本階段未實作差異修正。
- 程式碼直接可判定的兩個優先缺口：`index.html:2902-2912` 把任何 native App 都當成 iOS 隱藏音量滑桿；`index.html:6214-6229` 在原生 Android 定位拒絕後仍顯示網站網址列設定指引。其餘安全區、鍵盤、前景定位、通知、分享、wake lock 均標成 Android APK/真機待驗。
- iOS-only `RailPlaces` 桌面小工具同步（`app/src/native-bridge.mjs:17-22`、`index.html:7320-7344`）明確列為 Android 現階段不需；RevenueCat Android key 與 Firebase 登入則列為後台設定到位後才驗，不用假值。

### G/H. APK 組建與錯誤處理

- 第一次 Gradle 診斷 `./gradlew :app:processDebugMainManifest`：shell 未設定 Java，exit 1，關鍵行 `Unable to locate a Java Runtime`。唯讀確認 Android Studio 已附 JBR 25 後，改用單次命令 `JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home`；未下載/安裝 JDK。
- 設定 JBR 後的 manifest task 與正式 `./gradlew assembleDebug --console=plain` 都在 wrapper 階段 exit 1：`Downloading https://services.gradle.org/distributions/gradle-8.14.3-all.zip` 後 `java.net.UnknownHostException: services.gradle.org`。本機 `~/.gradle/wrapper/dists/gradle-8.14.3-all/...` 只有 `.zip.part`／`.lck`，沒有可用 distribution。
- 同一 wrapper 無網路錯誤已達兩次，依任務 H 不再第三次重試。假設：一般 Terminal 有網路時 wrapper 可取得專案鎖定的 Gradle 8.14.3；不可改 wrapper 版本、降套件或移除功能來繞過。
- 結論：`assembleDebug` exit 1；**沒有 APK**，因此 APK 路徑／大小與 `unzip -l ... assets/public/index.html` 均驗不了。安全 build、web assets 與 Capacitor sync 目前已完成；唯一剩餘的直接阻擋是 sandbox 無法下載 Gradle 8.14.3 distribution。

#### 2026-08-04 負責人解除網路阻擋後重驗

- 經核准讓 Gradle 使用正常的外部 cache／網路後，`gradle-8.14.3-all.zip` 已從 `services.gradle.org` 完整下載到 100%，wrapper 正常顯示 `Welcome to Gradle 8.14.3!`；先前的 `UnknownHostException` 已解除。
- 同一次 `JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew assembleDebug --console=plain` 最終 exit 1，新的關鍵錯誤是 `Unsupported class file major version 69`，發生在 Gradle build script semantic analysis、尚未進入 AGP／SDK platform 解析。
- 環境唯讀盤點：Android Studio JBR 是 OpenJDK `25.0.2`，Homebrew 既有 OpenJDK 是 `26.0.2`；`/usr/libexec/java_home -V` 與系統／使用者 JDK 目錄搜尋均找不到 JDK 17／21／24。Gradle 8.14.3 啟動畫面只宣告 Java 24 支援，故目前兩個既有 runtime 都過新。
- 依「不下載安裝新開發工具」與不得改 wrapper／降依賴規則停止；沒有再用 Java 26 重複同一個已知不相容錯誤。新阻擋是缺少相容 JDK（建議 JDK 21），不是網路、SDK license 或應用程式碼。APK 仍不存在，G = FAIL，APK 內容驗證 = 驗不了。

#### 2026-08-05 使用者授權後續作業

- 使用者明確授權安裝相容 JDK；執行 `brew install openjdk@21` exit 0，Homebrew 安裝 `openjdk@21 21.0.12` 至 `/usr/local/Cellar/openjdk@21/21.0.12`。
- 直接執行 keg 內 Java，實測 `openjdk version "21.0.12"`。沒有執行 Homebrew 建議的 sudo 系統 symlink、沒有 `brew link`，也沒有修改 shell 設定；後續只在 Gradle 單次命令指定 `/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` 為 `JAVA_HOME`。
- 以該 JDK 執行 `JAVA_HOME=… ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew assembleDebug --console=plain`：exit 0，關鍵輸出 `BUILD SUCCESSFUL in 3m 32s`、`245 actionable tasks: 245 executed`。
- Gradle 依指定順序自動安裝缺少的 `Android SDK Platform 36 (revision 2)` 與 `Android SDK Build-Tools 35.0.0`，兩者 license 均已接受；沒有把 compileSdk 改成 37，也沒有手動執行 sdkmanager。
- 非阻擋警告：Kotlin Gradle plugin 在 Geolocation／RevenueCat subproject 重複載入；RevenueCat 帶入的 Amazon Appstore SDK 3.0.5 在 D8 發出多筆 `Expected stack map table for method with non-linear control flow`。Gradle仍完成 dex、package 與 debug assemble；本階段不移除 SDK 或降版來消警告，列為後續依賴升級風險。
- APK 實測路徑：`/Users/xuxiang/Code/軌島-Android/app/android/app/build/outputs/apk/debug/app-debug.apk`；`ls -lh` 為 `17M`，精確大小 `17,455,919 bytes`，SHA-256 `17b3dd9cc4bd60f9ad617d27d5982da8e2f63434279b871e4d7b5199feece676`。
- `unzip -l` 實測明確列出 `assets/public/index.html`（未壓縮尺寸 `1,165,001` bytes），`assets/public` 共 136 筆；`unzip -p ... assets/public/index.html` 讀到 `const BUILD = 'v0804g'`。G 與 APK web 資產封裝驗證均 = PASS。
- `aapt2 dump badging` 對實際 APK：package `tw.railisland.app`、versionCode `1`、versionName `1.3.2`、compileSdk `36`、minSdk `24`、targetSdk `36`、application label `軌島`，與 B 的原始設定一致。

## 最終驗收

| # | 狀態 | 證據／理由 |
|---|---|---|
| 1 `npm run build` | **PASS** | 依專案防呆明示以 `RAIL_ALLOW_SAFE_BUILD=1` 確認本階段刻意安全 build，exit 0；輸出含 `place_index ... trains=1151 segments=36436`、`App 發行檢查通過 ... 41.0 MB`、`App web assets ready`，未設任何 licensed 旗標。 |
| 2 `npx cap sync android` | **PASS** | exit 0：`Copying web assets from www`、辨識五個指定外掛、`Sync finished in 0.05s`。 |
| 3 `assembleDebug`＋APK | **PASS** | 使用 JDK 21 後 exit 0：`BUILD SUCCESSFUL in 3m 32s`；APK 位於 `app/android/app/build/outputs/apk/debug/app-debug.apk`，大小 17M／17,455,919 bytes。 |
| 4 APK 內含 web assets | **PASS** | `unzip -l` 列出 `assets/public/index.html`，包內 BUILD 為 `v0804g`，`assets/public` 共 136 筆。 |
| 5 `npm run verify` | **PASS** | exit 0：`App 發行檢查通過 ... v0804g ... 134 個檔案 ... 音樂 關閉，線上底圖 關閉`。 |
| 6 Android 斷言紅→綠 | **PASS** | Android BUILD 暫改 `v0804g-android-red-test` 時，驗證明確因 Android 內嵌資產版本不一致 exit 1；還原 `v0804g` 後 exit 0，三份 BUILD 再比對一致。 |
| 7 `.gitignore` | **PASS** | project body 三路徑 `git check-ignore` exit 1；build／local config／Firebase JSON／keystore／IDE／captures／cxx 測試路徑 exit 0。 |
| 8 圖示齊全 | **PASS** | launcher 48/72/96/144/192、adaptive foreground 108/162/216/324/432、11 個 splash 全部逐檔 `sips` 實測符合。 |
| 9 未動不該動的項目 | **PASS** | 下方完整 status 只有預期程式/Android/docs；兩份本機參照仍被 root `.gitignore` 忽略；`app/node_modules` 仍為原 symlink。全程未執行 Git 寫操作。 |
| 10 兩份文件 | **PASS** | `docs/android/PROGRESS.md` 與 `docs/android/PLATFORM-GAPS.md` 均存在。 |

### 最終唯讀檢查

- `git diff --check` exit 0；`node --check app/scripts/verify-release.mjs` exit 0。
- 最後一次 `RAIL_ALLOW_SAFE_BUILD=1 npm run verify` 仍 exit 0；Android manifest、strings、styles、adaptive icon XML 全部逐檔 `xmllint --noout` exit 0。
- 2026-08-05 APK 完成後再次總驗：release verify exit 0；`unzip -t app-debug.apk` 為 `No errors detected in compressed data`；`aapt2 dump permissions` 對背景定位與兩種 exact-alarm 權限搜尋均無命中；`git diff --check` exit 0。
- `app/node_modules`：`lrwxr-xr-x ... app/node_modules -> /Users/xuxiang/Code/捷運小動畫/app/node_modules`；未安裝、刪除或改寫依賴。
- `git check-ignore -v`：本機參照分別命中 root `.gitignore:76` 與 `:24`；`google-services.json`／JKS 測試路徑命中 `app/.gitignore:11-12`。
- 最終 `git status --porcelain=v1 -uall` 原樣如下（Android 的 generated assets/config 仍依 `app/android/.gitignore:95-101` 保持 build-time ignored，故不在清單）：

```text
 M app/.gitignore
 M app/scripts/verify-release.mjs
?? app/android/.gitignore
?? app/android/app/.gitignore
?? app/android/app/build.gradle
?? app/android/app/capacitor.build.gradle
?? app/android/app/proguard-rules.pro
?? app/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java
?? app/android/app/src/main/AndroidManifest.xml
?? app/android/app/src/main/java/tw/railisland/app/MainActivity.java
?? app/android/app/src/main/res/drawable-land-hdpi/splash.png
?? app/android/app/src/main/res/drawable-land-mdpi/splash.png
?? app/android/app/src/main/res/drawable-land-xhdpi/splash.png
?? app/android/app/src/main/res/drawable-land-xxhdpi/splash.png
?? app/android/app/src/main/res/drawable-land-xxxhdpi/splash.png
?? app/android/app/src/main/res/drawable-port-hdpi/splash.png
?? app/android/app/src/main/res/drawable-port-mdpi/splash.png
?? app/android/app/src/main/res/drawable-port-xhdpi/splash.png
?? app/android/app/src/main/res/drawable-port-xxhdpi/splash.png
?? app/android/app/src/main/res/drawable-port-xxxhdpi/splash.png
?? app/android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml
?? app/android/app/src/main/res/drawable/ic_launcher_background.xml
?? app/android/app/src/main/res/drawable/splash.png
?? app/android/app/src/main/res/layout/activity_main.xml
?? app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
?? app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
?? app/android/app/src/main/res/mipmap-hdpi/ic_launcher.png
?? app/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png
?? app/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
?? app/android/app/src/main/res/mipmap-mdpi/ic_launcher.png
?? app/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png
?? app/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
?? app/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
?? app/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png
?? app/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
?? app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
?? app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png
?? app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
?? app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
?? app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png
?? app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
?? app/android/app/src/main/res/values/ic_launcher_background.xml
?? app/android/app/src/main/res/values/strings.xml
?? app/android/app/src/main/res/values/styles.xml
?? app/android/app/src/main/res/xml/file_paths.xml
?? app/android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java
?? app/android/build.gradle
?? app/android/capacitor.settings.gradle
?? app/android/gradle.properties
?? app/android/gradle/wrapper/gradle-wrapper.jar
?? app/android/gradle/wrapper/gradle-wrapper.properties
?? app/android/gradlew
?? app/android/gradlew.bat
?? app/android/settings.gradle
?? app/android/variables.gradle
?? docs/android/PLATFORM-GAPS.md
?? docs/android/PROGRESS.md
?? docs/android/codex-prompt-android-shell.md
```

### 同步後可攜性補檢

- `cap sync` 因本工作樹的 `app/node_modules` 是 symlink，曾把 `app/android/capacitor.settings.gradle:3-18` 生成为指向另一工作樹的路徑；已改回標準且可由乾淨 clone 使用的 `../node_modules/...` 相對路徑。六個 plugin projectDir 逐一 `test -d` 均成功，`rg` 確認 Android 版控專案沒有 `/Users/xuxiang` 或其他工作樹路徑。注意：在目前 symlink 環境再次執行 `cap sync` 可能重生該檔，commit 前需再做同一個 `rg` 檢查。
- `app/android/variables.gradle:16` 依既有 provider 範圍只設 `rgcfaIncludeGoogle = true`；Facebook 維持 plugin 預設 false，不新增 SDK 或權限。

## 使用者接下來必須自行完成

階段一沒有剩餘必須由使用者補做的阻擋：JDK 21、Android 36、Debug APK 與 web asset 封裝證據均已完成。Firebase `google-services.json`、RevenueCat Android key、release keystore、Play Console 與 Esri package 白名單仍刻意留到需要正式後台設定的後續階段，本輪沒有用假資料處理。
