# Android 階段二進度

日期：2026-08-05

## 執行邊界與起始基線

- 工作樹：`/Users/xuxiang/Code/軌島-Android`；分支 `feat/android-shell`，HEAD `c42c4ddf8729db62f8a535cf83f2d142308110da`（`c42c4dd feat(Android): 建立 Capacitor Android 殼——可編出 debug APK`）。
- 起始 `git status --porcelain=v1 -uall` 只有 `?? docs/android/codex-prompt-stage2.md`；這是使用者提供的本輪派工檔，尚未 staging。本輪截至目前沒有執行任何 git 寫操作。
- `app/node_modules` 仍是 symlink：`app/node_modules -> /Users/xuxiang/Code/捷運小動畫/app/node_modules`；未執行 npm install／npm ci／rm。
- 已完整讀取 `docs/android/PLATFORM-GAPS.md` 與 `docs/android/codex-prompt-stage2.md`；C-1 嚴格維持「先 Android 實測、後決定是否改碼」，目前未修改音量 class。

## A. 執行環境

- 第一次 `adb devices -l` 因 Codex sandbox 不允許 localhost:5037 而失敗，關鍵行 `could not install *smartsocket* listener: Operation not permitted`；解除該 sandbox 限制後，既有 adb 37.0.1 daemon 正常啟動，命令 exit 0。
- `adb devices -l` 的裝置清單為空：目前沒有實體 Android 裝置，也沒有正在執行的 emulator。
- 建 AVD 前 `df -h /Users/xuxiang/Code/軌島-Android` 實測：Data volume 可用 `83Gi`，高於派工的 20GB 停止線。
- 既有 `$ANDROID_HOME/emulator/emulator -list-avds` 無輸出；`$ANDROID_HOME/system-images` 與 `~/.android/avd` 皆沒有可重用的 system image／AVD。
- SDK 內有 emulator 與 platform-tools，但沒有 `cmdline-tools` 目錄；`$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager` 回 `no such file or directory`，對 SDK 與 Android Studio 安裝內容搜尋 `avdmanager`／`sdkmanager` 也都無結果。

### 預定 AVD 規格與理由

- 預定採 **Pixel 7、Android API 35、Google APIs、arm64-v8a**。
- 理由：Pixel 7 是接近主流的挖孔／手勢導覽裝置；API 35（Android 15）正好覆蓋 edge-to-edge 行為，又符合派工建議的 API 34／35；arm64-v8a 與目前 Apple Silicon host 同架構，避免 x86 轉譯假象。三鍵導覽與 360／375／414／768 寬度會在同一映像透過導航模式與解析度切換驗證。

### 阻擋與停止決策

- 建立 AVD 需要先安裝 Android SDK Command-line Tools（並下載 API 35 system image），屬派工〈停下回報〉第 3 項「需要安裝新的開發工具」。本輪沒有自行安裝、沒有手刻 AVD 設定、沒有用非官方映像繞過。
- 受影響範圍：冷啟動、logcat、地圖／列車截圖、C-1 audio.volume 數據、C-2 Android 截圖、真機矩陣與四寬度觸控掃描全部需要 Android 裝置，現階段無法開始。
- 目前沒有修改 C-1／C-2 或其他產品碼，也沒有製造任何假實測資料。

## 使用者解阻方式

請在 Android Studio 的 SDK Manager 安裝 **Android SDK Command-line Tools (latest)**，並用 Device Manager 建立／啟動上述 Pixel 7 API 35 AVD；完成後回覆即可續跑。也可以接上已開啟 USB debugging 並授權此 Mac 的實體 Android 裝置，會優先改用實體機。

## 2026-08-05 解阻續作

- 使用者已透過 Android Studio 安裝 Command-line Tools；`sdkmanager --version` 實測為 `22.0`，`avdmanager` 可正常列出 `pixel_7`。CLI 因 Homebrew JDK 21 是 keg-only，命令需單次指定 `JAVA_HOME=/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`；沒有建立 sudo symlink或修改 shell 設定。
- 下載並安裝官方 `system-images;android-35;google_apis;arm64-v8a` exit 0；建立 `RailIsland_API35_Pixel7` AVD exit 0。`avdmanager list avd` 確認 Device `pixel_7`、Android 15、Google APIs、arm64-v8a。
- 以 `-wipe-data -no-snapshot -no-boot-anim -no-window -no-audio` 做真正冷啟動；emulator 關鍵行 `Boot completed in 18586 ms`。ADB 實測 `sys.boot_completed=1`、Android `15`／API `35`、physical display `1080x2400 @ 420 dpi`，裝置狀態為 `device`。
- AVD 建立時曾輸出 system image 無 `devices.xml` 的警告，但命令 exit 0，且 emulator 與 avdmanager 都能完整解析、冷啟動成功；因此是工具相容性警告，不是需要重建的錯誤。
- A 項結論：執行環境完成，預定規格與實際一致。下方原「使用者解阻方式」為中斷時紀錄，現已解除。

## B. 安裝、冷啟動與核心降級

- 安裝既有 `app/android/app/build/outputs/apk/debug/app-debug.apk` 成功；未重跑 npm 安裝、未加入任何 Firebase／Google 憑證。
- 以 `adb shell am start -S -W -n tw.railisland.app/.MainActivity` 實測真正冷啟動：`LaunchState: COLD`、`TotalTime: 950 ms`、`WaitTime: 953 ms`；logcat 的 `Displayed tw.railisland.app/.MainActivity` 亦為 `+950ms`。首次互動前 Android 會顯示約略位置權限 prompt，底下 WebView 已完成地圖與 onboarding 畫面；因此 Activity 首幀為 950 ms，含首次權限決策的使用者可互動時間取決於使用者回應，不以假定固定秒數冒充。
- 使用真實觸控選擇「使用應用程式時允許」約略位置，接著點擊 onboarding 的「開始看車」。`docs/android/shots/cold-start-initial.png` 留存首次權限 prompt 與已載入底圖；`docs/android/shots/map-live-trains.png` 留存解除 onboarding 後的地圖、路網與 `LIVE／2 班奔跑中` 即時狀態。
- `docs/android/shots/cold-start-logcat.txt` 留存完整首次冷啟動 logcat；查無 `FATAL EXCEPTION`、app process crash 或 WebView crash。無憑證安全建置如預期出現 `Default FirebaseApp failed to initialize because no default options were found`，以及 `FirebaseAuthenticationPlugin failed to load`，但 Capacitor/WebView 繼續啟動、核心地圖與列車資料可用，屬可見但非致命的安全降級。
- B 項結論：APK 可安裝與冷啟動，無 Firebase 憑證時核心功能仍存活；Firebase 警告需保留為已知安全建置噪音，不得用假設定檔消除。

## C-1. Android `audio.volume` 先實測、後決策

- 嚴格先測後改：第一筆 Android 數據取得前，`index.html` 的音量平台 class 沒有任何修改。安全 APK 的 `RAIL_MUSIC_AVAILABLE=false`、不含背景音樂檔，因此以 `docs/android/scripts/c1-audio-test.js` 在同一 WebView 產生本地 440 Hz／44.1 kHz PCM 音訊，並以真實 adb 觸控啟動，排除 autoplay 或外部網路因素。
- 數值輪次：播放以 `audio.volume=1` 成功進入 `paused=false`；播放進度 `7.922 s` 時設定 `audio.volume=0.3`，同一 tick 立即讀回 `0.3`，延遲 750 ms、播放進度 `8.674 s` 再讀仍為 `0.3`，且仍在播放。
- 實際輸出量測：AudioFlinger 顯示 active track 屬 `tw.railisland.app`（PID 1883／UID 10207）、route `AUDIO_DEVICE_OUT_SPEAKER`、44.1 kHz source 經 48 kHz mixer。HAL signal power 在 `volume=1.0` 穩定約 `-47.6 dB`，切為 `0.3` 後穩定約 `-58.0 dB`，實測差 `-10.4 dB`，與 `20 × log10(0.3) = -10.46 dB` 相符。原始狀態為 `docs/android/shots/c1-audioflinger-volume-1.0.txt` 與 `c1-audioflinger-volume-0.3.txt`；摘要為 `c1-audio-result.json`。
- emulator 的 `-record-session` WebM 雖含 44.1 kHz 雙聲道軌，但沒有抓到 WebView speaker output，只得到靜音；該路徑被判定無效，沒有拿它冒充幅度證據，改用 AudioFlinger HAL signal power 完成量測。
- 數據證明 Android WebView 正常套用 `HTMLMediaElement.volume`，因此量測完成後才把 `music-volume-unavailable` 改為只在 iOS 加入；iPhone／iPad／iPod 與 iPadOS Macintosh touch 判斷保持原樣。Android 不再因 `nativeApp` 被一刀切隱藏音量控制。
- `docs/android/scripts/verify-platform-bootstrap.mjs` 直接擷取並執行 `index.html` 的首繪 bootstrap：iPhone UA 與 touch Macintosh（iPadOS 桌面 UA）仍得到 `music-volume-unavailable`，Android WebView UA 不得到該 class。這是對修改後實際程式片段的可執行回歸證明，不是複寫同一判斷做自我驗證。

## C-2. 原生 Android 定位拒絕文案

- 只改前端文案分支，沒有新增原生介面；`app/src/native-bridge.mjs` 的 `RAIL_NATIVE_GEOLOCATION.openSettings` 保持 `null`。
- 原生 Android 用 `IS_NATIVE_APP + Android UA` 分流到純文字路徑「系統設定→應用程式→軌島→權限→位置允許」；一般 Android 網頁仍保留既有「網址列旁圖示→網站設定」指引，iOS 分支不變。
- 第一輪實機截圖雖已無「網址列」，但設定路徑放在長句尾端，被單行 toast 省略；沒有把它誤判為完成。第二輪把 Android App 路徑改成靜態字串並移到句首，release 的 toast sink gate 通過。
- 清除 App 資料後，實際走「開機 prompt 拒絕 → 關閉 onboarding → 點附近車站 → 精確定位 prompt 再拒絕」。`docs/android/shots/location-denied-native-copy-final.png` 顯示完整「系統設定→應用程式→軌島→權限→位置允許」，畫面不含「網址列」；主要路徑完整可見，尾端備援落釘句才被 toast 省略。
- `RAIL_ALLOW_SAFE_BUILD=1 npm run build`、`npx cap sync android`、Gradle `assembleDebug` 均成功；完整 `cap sync` 曾在 Android 已更新後卡於既有 iOS Podfile symlink 雙來源衝突，本輪未改 Podfile、未重裝依賴，改以 Android-only sync 收斂範圍。

## D. 真機驗證矩陣（完成）

### 安全區／edge-to-edge

- Pixel 7、Android 15、1080×2400／420 dpi，先以 `com.android.internal.systemui.navbar.gestural`，再用 overlay 切至 `navbar.threebutton` 真實截圖。
- `docs/android/shots/safe-area-gesture.png`：頂部 header 完整落在狀態列下方，底部 tab bar 完整落在手勢 pill 上方。
- `docs/android/shots/safe-area-three-button.png`：同一頁面頂部仍未被狀態列遮住，底部 tab bar 完整落在 Back／Home／Recents 三鍵區上方；切換導覽模式後未出現跳版或不可點區。
- 結論：本 AVD 的挖孔裝置 profile／Android 15 edge-to-edge 在手勢與三鍵導覽皆通過截圖檢查。

### 搜尋鍵盤／旋轉／返回鍵

- 直式真觸控打開搜尋後，焦點為 `#trainSearch`；用 Android IME 輸入 `431`，程式量得 visual viewport 高 `527.24 px`，結果下拉 `y=160.48..231.14`、tab bar top `480.38`，結果完整位於鍵盤／tab bar上方。畫面：`docs/android/shots/keyboard-search-portrait.png`。
- 保持 IME 開啟旋轉橫向後發現**待處理缺陷**：visual viewport 只剩 `122.29 px`，`#trainSearch y=114.48..154.48`、結果 `y=160.48..231.14`，兩者落到鍵盤後方；`#searchPanel` 可見高度也只剩 `15.81 px`。截圖 `keyboard-search-landscape.png` 可見搜尋內容被壓成細線。依派工不修 C-1／C-2 以外問題。
- 送出 Android Back 後，IME 正確先收起、Activity 沒離開；innerHeight 從 `122` 回到 `360`，輸入與結果幾何恢復完整可見，`431` 狀態保留。畫面：`keyboard-back-dismiss-landscape.png`。

### 定位權限三條路徑

- 每條路徑都先 `pm clear tw.railisland.app`，並以 `adb emu geo fix 121.5654 25.0330` 給台北有效測試座標，避免沿用前一路徑的 permission／localStorage。
- **完整同意**：開機約略定位選「使用應用程式時允許」，點附近車站後的升級 prompt 選「Change to precise location」。附近站卡與藍點正常顯示；`dumpsys package` 為 Fine `granted=true`、Coarse `granted=true`。畫面 `location-accepted-precise.png`。
- **拒絕**：開機約略定位選「Don’t allow」，核心地圖與 onboarding 仍已載入；點附近車站後再次拒絕，App 切到手動落釘並顯示 C-2 系統設定指引，地圖與列車持續運作。畫面 `cold-start-initial.png`、`location-denied-native-copy-final.png`。
- **只給約略位置**：開機允許 coarse；點附近車站後 Android 15 顯示的是「Change 軌島’s location access from approximate to precise?」升級 prompt，而非第二組 radio，選「Keep approximate location」。附近站卡、粗略藍點與精度圈正常顯示；Fine `granted=false`、Coarse `granted=true`。畫面 `location-accepted-approximate-final.png`。
- 曾有一次把升級 prompt 的中央示意圖誤認為 radio、隨後按到「Change to precise」，權限證據顯示 Fine 仍為 true，故未算通過並重跑；最終 coarse 結論以系統 UI dump 的實際按鈕語意與 Fine=false／Coarse=true 為準。
- 結論：三條權限路徑皆有獨立實測；開機 prompt 覆蓋畫面但 WebView 地圖已在後方完成載入，不會阻斷核心載入。coarse 能降級為較大精度圈與附近站清單，拒絕則有手動落釘退路。

### 分享／取消／無接收 App

- **分享目前畫面**：從「更多」面板真實滑動到「分享畫面」，先做 `elementFromPoint` 命中，再真觸控；top resumed activity 為 `com.android.intentresolver/.ChooserActivityLauncher`。畫面 `share-view-chooser.png`。Android Back 取消後回 `tw.railisland.app/.MainActivity`，沒有崩潰。
- **分享行程**：以專案既有 `?tripshare=1` 測試旗標啟用發起端，真實搜尋並跟隨台鐵 431 次；`#fpTripShare` 顯示後真觸控，目的站列的 `elementFromPoint` 正確命中「高雄」，選取後同樣開 Android Chooser。畫面 `share-trip-chooser.png`；取消後回 MainActivity。
- **沒有可接收 App**：先由 `cmd package query-activities ... ACTION_SEND text/plain` 得到 9 activities；暫時對這台 AVD 的 7 個接收套件做 `disable-user`，重查為 `No activities found`。再從 App UI 真觸控分享，原生 Chooser 顯示 `No apps can perform this action.`（`share-no-targets.png`），沒有 crash。測完立即逐一 `pm enable --user 0`，重查恢復 `9 activities found`。

### in-app-browser 誤判

- Android UA 含 `; wv)`，但 `Capacitor.isNativePlatform()` 實測為 true；`#iabHint.hidden=true`、`#iabBtns.children.length=0`、提示 rect `0×0`。App 內沒有產生「用瀏覽器開啟」逃生卡。全頁文字搜尋會命中更新紀錄中的歷史說明，故結論以實際提示元件狀態為準，不把 changelog 文字誤算成 UI。

### 地圖 pinch 與頁面縮放

- 先把 Leaflet 設到 zoom 8；雙觸點起訖位置的 `elementFromPoint` 全部命中 `#map.leaflet-touch-zoom`。`docs/android/scripts/webview-pinch.mjs` 經 CDP `Input.dispatchTouchEvent` 送兩指由 48 px 張開到 210 px 的 12 階 gesture。
- 手勢後 Leaflet zoom `8→10`，地圖中心只微移；同時 `visualViewport.scale` 維持 `1`、`innerWidth` 與 `documentElement.clientWidth` 都維持 `412`。結論：地圖 pinch 可用，頁面本身沒有跟著 pinch zoom。畫面 `map-pinch-zoomed.png`。

### GPS watch／前景恢復／停止

- `docs/android/scripts/stage2-gps-bridge-audit.mjs` 在 Fine/Coarse 均 granted 的精確定位狀態，直接呼叫產品實際 `RAIL_NATIVE_GEOLOCATION.watchPosition`，並以 emulator location 依序移動座標。
- 前景、Home 後重新進前景、熄屏後喚醒各收到新 fix，accuracy 皆為 5 m；`document.hidden=true` 的背景與熄屏 callback 都是 0。一次標記為 background 的 callback 本身 `hidden=false`，座標是切 Home 前的前景移動點，屬前景 looper 已排隊後延遲送達，未計成背景取樣。
- 呼叫 `clearWatch` 後 callback 數停在 3，再注入一個新座標仍為 3；watch id 可清除。完整事件、權限與摘要在 `docs/android/shots/gps-bridge-audit.json`。功能旗標目前關閉，產品 UI 不對外開放；本輪只驗保留中的 bridge 行為，不把它說成 OEM 長時間背景保證。

### 本地通知權限／primer／排程

- API 35 初始 `checkPermissions=prompt`；第一次實際系統 prompt 點拒絕，request 回 `denied`，隨後 check 為 `prompt-with-rationale`；重試 prompt 點允許後 request 與 check 均為 `granted`。
- 另把權限重置到首次狀態，從產品提醒 sheet 真實 ADB 點擊「設定提醒」：先顯示產品 primer（`notification-primer.png`），再真實點「好，提醒我」才出 Android 系統 prompt（`notification-permission-after-primer.png`）。允許後產品排入 `2551 次 新竹 開車前 10 分鐘`；測完用產品刪除流程清到 native pending 與 localStorage 都為空。
- bridge 另排一則 7 秒通知並實際在通知欄看到標題／內文（`notification-delivered.png`）；第二則遠期通知在 cancel 前存在、cancel 後消失，已送達通知則從 pending 清單移除。結構化摘要為 `notification-bridge-audit.json`。
- Android 12 以下沒有對應映像，故「request 直接 granted」分支本輪明確未覆蓋；這是裝置矩陣缺口，不以 API 35 結果外推。

### 必須後台設定、此階段驗不了

- Apple 登入撤銷鏈需要真實 Firebase Android 設定與 provider 回傳憑證；本安全 APK 無 `google-services.json` 且 `ACCOUNT_ENABLED=false`，依鐵則不造假、不從 iOS 轉用，因此本階段明確驗不了。
- RevenueCat Android configure／purchase／restore 需要正式 Android public SDK key；本輪不注入假 key，且 Plus 入口關閉，因此只確認缺 key 時 adapter 不掛載，交易鏈留待使用者提供正式後台設定。

## E. 四寬度 UI 掃描

- `docs/android/scripts/stage2-width-audit.mjs` 在同一台 Pixel 7 AVD 以 Android `wm density` 取得精確 CSS viewport 360／375／414／768；每組重新冷啟 Activity、連到實際 WebView，掃描當下所有可見 `button`／link／輸入與 role 控件。
- 程式化結果分別寫入 `docs/android/shots/ui-audit-360.json`、`ui-audit-375.json`、`ui-audit-414.json`、`ui-audit-768.json`。四組實際寬度均與要求一致；每組 12 個可見控件、`overlapCount=0`、`centerHitFailures=[]`、`touchFailures=[]`。
- 每個控件都先以中心與四側共 5 點做 `elementFromPoint` 擁有者檢查，再以 ADB `input tap` 點實際裝置座標；逐項捕捉 `pointerdown`／`pointerup`／`click`，確認三種事件都回到同一控件。四組合計 48 次真實點擊全部通過。
- `#randBtn` 與 `#nearBtn` 各有 `::after` 擴張熱區。每隔 2 CSS px 橫掃整列：360 寬分段為 `c5 139..239`、空隙 `241..247`、`c6 249..349`；375 為 `155..255`、空隙 `257..263`、`265..365`；414 為 `195..293`、空隙 `295..301`、`303..403`；768 為 `547..647`、空隙 `649..655`、`657..757`。兩顆按鈕的偽元素熱區沒有重疊或互搶。
- 第一輪 360 掃描曾因 `Page.navigate` 讓長連線 WebSocket 隨 WebView 導頁關閉而 exit 13；改為 Android force-stop／start 後不再由 CDP 導頁。第二輪發現 live header 在逐項點擊期間重建節點，舊 audit key 失效而讓「高／捷」呈假陰性；改為每次實體點擊前重掃並對當下節點重新掛 key。依停損規則在第三輪前停下並取得使用者明確同意；第三輪 360 與後續三種寬度全數通過。AVD 曾在核准後退出，重啟同一個非 wipe AVD 後續跑，並非第三次相同 harness 邏輯失敗。
- 414 的第一次 DPI 校準得到實際 415；只把 density 417 微調為 418，未改產品或 harness 判準，重跑後得到精確 414。全部完成後已執行 `wm density reset`，恢復 AVD 預設 420 dpi。

## F. 最終驗證

- 原樣 `npm run verify` 被既有 release policy 的安全建置門檻擋下，關鍵理由是目前產物刻意不含授權線上底圖、必須明確宣告安全 build；它在內容檢查前 exit 1。依錯誤訊息使用 `RAIL_ALLOW_SAFE_BUILD=1 npm run verify` 後 exit 0：`App 發行檢查通過：app/www，v0804g，134 個檔案，41.0 MB，音樂 關閉，線上底圖 關閉`。本階段全程無憑證，不能把 bare verify 的授權門檻說成無條件通過。
- `verify-platform-bootstrap.mjs` exit 0：iPhone／iPadOS 都保留 `music-volume-unavailable`，Android WebView 沒有。所有新增 JS／MJS 腳本均通過 `node --check`。
- `jq -e` 對四份 UI audit JSON 做最終硬斷言：actualWidth=requestedWidth、overlap=0、中心與觸控失敗清單皆空、每組恰 12 個 touch 且全數 pass；四份都回 true。
- 最終 Gradle 第一次因 shell 未設 keg-only JDK 的 `JAVA_HOME`，在 Gradle 啟動前回 `Unable to locate a Java Runtime`；以本輪固定的 JDK 21 與 Android SDK 單次環境重跑 `./gradlew assembleDebug`，`BUILD SUCCESSFUL in 36s`、245 tasks up-to-date。debug APK 為 17,455,919 bytes。
- `git diff --check` exit 0。`app/release-policy.json` 與 `app/NATIVE_PRIVACY_AND_PERMISSIONS.md` 的 status 均無輸出；沒有修改或 staging。`app/node_modules` 仍是原 symlink，目標仍為 `/Users/xuxiang/Code/捷運小動畫/app/node_modules`；本輪沒有執行 npm install／npm ci／rm node_modules。
- `cap sync` 曾把 symlink 的解析後實體路徑寫進 Android settings 與 iOS Podfile；兩者相對起始基線都是工具產物，已精確還原。Android Studio 自動建立的 `.idea` 與無效靜音 WebM／被最終重跑取代的截圖也已移除，不會進 commit。

## G. Firebase Android 設定後的 Apple 登入／刪帳實測

- 使用者已完成 Firebase Android App、`google-services.json` 與 Apple provider 正式設定；設定檔與帳號功能測試產物均為 ignored，未進版控、未複製到 iOS 資產。
- Pixel 7／Android 15 實測 Apple 首次登入成功；點刪除帳號後的 Apple 重新驗證成功，Android Firebase provider 確實回傳可供撤銷的 `credential.accessToken`。`accountDelete()` 要等原生 `revokeAccessToken` resolve 才呼叫後端；本次已進入 `/api/account-delete`，故 Android 的 Apple 重驗與撤銷分支均已實測到。
- 刪除最終失敗點在正式 Worker：從 App 內同一已驗證 session 重現得到 `HTTP 502`，回應精確為 `entitlement deletion failed`。前端因此沒有繼續刪 Firestore user docs 與 Firebase Auth user，帳號仍保留。Worker 在失敗前已先嘗試清 D1 與 RevenueCat，那兩段可能已完成；端點的 404 處理與清理操作為可重試設計，後端修正後應重跑整條刪帳。
- 這個錯誤對應另一已有 commit `6a64ab691f8ad671e339a94931581c7aac8ba35b` 的 `deletePlusEntitlement()` 錯誤分支；該 commit 不是本工作樹 HEAD 的 ancestor，本輪未 cherry-pick、未碰其他工作樹。正式 Worker 日誌會記下 `google oauth <status>`、私鑰格式／憑證錯誤，或 `firestore entitlement delete <status>` 之一；必須取得這行才能在 IAM、service-account secret 與 Firestore DELETE 之間做事實判定。未取得前不繞過 API 單獨刪 Firebase user。
- 診斷時發現 `app/capacitor.config.json` 的 `loggingBehavior: "production"` 並不是「只在開發版記錄」，而是正式版也會將 Capacitor plugin call/result 完整寫入 logcat，Firebase Authentication 回傳內容也會被序列化。已立即清空裝置 logcat，把設定改為 `none`，並在 `verify-release.mjs` 加入 fail-closed 閣門。
- 修正後 `RAIL_ALLOW_SAFE_BUILD=1 npm run verify` exit 0；閣門的 `none` 正向與 `production` 負向樣本都通過。`npx cap copy android` 後重編 Debug APK，Gradle `BUILD SUCCESSFUL`；複蓋安裝後從 APK 讀回設定確認為 `none`，啟動 App 後只計數不輸出 payload 內容，`bridge_payload_log_lines=0`。診斷用 CDP forward、暫存探針與裝置日誌均已清除。
- Cloudflare Observability 取得的精確根因為 `[plus-entitlement] account-delete entitlement deletion failed: google oauth 400`，證明還沒有走到 Firestore IAM，是 Google 拒絕 Worker 用 service-account JWT 換 token。使用者於 Worker Settings 的 Variables and Secrets 中，將 `FIRESTORE_PROJECT_ID`、`FIRESTORE_SERVICE_ACCOUNT_EMAIL`、`FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY` 改為同一份 Firebase Admin service-account JSON 的對應欄位（私鑰為 Secret）並部署。
- 設定修正後從 Android App 重跑同一條 Apple 重驗／撤銷／`account-delete`／Firebase user 刪除流程，使用者於 2026-08-05 確認「刪除成功」。Apple Android 撤銷與完整刪帳鏈由「後台阻斷」改列 PASS；未繞過後端單獨刪 Firebase user。

## H. 正式授權底圖設定與 Android build（2026-08-09）

- 使用者在工作樹根目錄的 ignored `.env` 填入 Android 專用 Stadia 與 Esri public client keys；檔案權限已收斂為 `0600`。`git check-ignore` 確認 `.env` 由 `.gitignore` 排除，並以精確值比對所有 `git ls-files`，兩把 key 的 tracked 命中數均為 0。未輸出 key 值。
- 邊界已向使用者說明：`.env` 可避免把 key 提交到 Git，但 `prepare-web.mjs` 會把正式底圖 client key 注入 Android APK 的網頁資產，因此公開 APK 可被提取；仍須在 Stadia／Esri 後台限制用途與監控用量，不能把 client key 當 server secret。
- 以 `RAIL_INCLUDE_LICENSED_BASEMAPS=1 npm run build` 建立正式底圖包。第一次因 sandbox 不允許 place-index 綁 `127.0.0.1` 而 `listen EPERM`，解除該限制後原命令 exit 0；沒有跳過 Esri 真 key／decoy liveness 檢查。輸出為 `v0804g`、134 files、41.0 MB、音樂關閉、線上底圖開啟。
- `npx cap copy android` exit 0，只把這份生成資產同步進 Android；沒有同步或覆寫 iOS。獨立 `npm run verify` 第一次同樣被 sandbox 網路限制擋下，解除限制後原判準 exit 0，沒有用 skip 旗標放行。Gradle `assembleDebug` 以 JDK 21／Android SDK 完成，`BUILD SUCCESSFUL`、246 tasks。
- debug APK 已安裝到既有 Pixel 7 API 35 AVD。AVD 冷啟後停在使用者設定的圖形鎖，Android user state 為 `RUNNING_LOCKED`；Package Manager 因 credential-encrypted storage 尚未解鎖而不解析 launcher Activity。診斷途中曾移除並乾淨重裝模擬器內的 `tw.railisland.app`，因此該 App 的模擬器本機資料已清除，Firebase／Cloudflare／iOS 與其他模擬器 App 未受影響。
- 使用者解開既有圖形鎖後完成 Android WebView 畫面驗收。亮色 Stadia、暗色 Stadia、Esri 衛星各有 8/8 張當前 Leaflet 圖磚 `complete && naturalWidth > 0`；host 分別為 `tiles.stadiamaps.com`、`tiles.stadiamaps.com`、`ibasemaps-api.arcgis.com`，沒有輸出含 key／token 的完整 URL。三種授權署名與畫面相符，截圖為 `basemap-stadia-light.png`、`basemap-stadia-dark.png`、`basemap-esri-satellite.png`。
- 另以 ADB 真實觸控點擊 `#tabMore` 中心，再點「衛星影像」列中心；`elementFromPoint` 事前分別命中正確控制，產品從衛星切回暗色 Stadia，sheet 行為與 8/8 圖磚重載通過。正式授權底圖由「build gate 通過、待畫面」改列 Android PASS。

## I. 近期共享更新追趕稽核（2026-08-09）

- 唯讀 refs 稽核：`feat/android-shell` 相對 `main` 為本分支 2 commits、`main` 164 commits；當前包仍是 `v0804g / Android 1.3.2 (1)`，`main` 已是 `v0808a / iOS 1.4.1 (28)`。另有 `feat/la-push` 到 `v0808e`，相對 `main` 為側分支 54 commits、`main` 1 commit。
- Android 應追 `main` 的共享頁面、資料、Worker 契約、Plus／登入同步、分享、捷運運動與班表修正；iOS Widget／Live Activity／APNs／entitlements 不直接移植。`feat/la-push` 的共享 UI 新功能等它們進 `main` 再同步，不從側分支挑進 Android。
- 正確後續是 merge `main` into `feat/android-shell`。唯讀 `git merge-tree` 的雙方同改路徑只有 `index.html` 與 `app/scripts/verify-release.mjs`，看起來可控；但本輪禁止 rebase／push，且共用 git metadata 目前不可寫，因此沒有啟動 merge 或用替代 git index 繞過。

## J. 第三輪底圖 UI audit（2026-08-09）

- 新增可重跑的 `docs/android/scripts/stage3-basemap-ui-audit.mjs`；它只記錄圖磚 hostname／載入數、授權署名與 UI 幾何，不保存完整圖磚 URL，因此不會把 `.env` key 寫進 JSON。結果為 `docs/android/shots/basemap-ui-audit.json`。
- Pixel 7／API 35、412.19×839 CSS viewport，亮色／暗色／衛星三種模式各掃到 12 個可見產品控制。每種模式皆為 `overlapCount=0`、`centerHitFailures=[]`、`clippedControls=[]`；圖磚各 8/8 載入。
- audit 如實以 exit 1 留下一項 UI 缺口：`#alertChip` 視覺與有效命中區約 38.29×36 CSS px，「全／台／高／捷」各約 43.28×36，五顆都未達 44×44。`#randBtn`／`#nearBtn` 的視覺框雖小於 44，但偽元素命中區量得至少 44 px；底部五個 tab 亦至少 44 px，故不列缺陷。
- 本輪只稽核與記錄，沒有憑審查結果擅自改共享 `index.html`。修法應維持目前視覺尺寸與間距，只以偽元素或等效方式擴張五顆控制的 hit area，再用同一腳本重跑三種底圖。

## K. 合併 main、Android 全鏈回歸與 44×44 修復（2026-08-09）

### 提交與整合證據

- 權限自檢對共用 `.git/worktrees/軌島-Android` 與 `.git/objects` 的精確 `.wtest` 建立／刪除均 exit 0；沒有使用替代 index 或碰其他 worktree。
- 指定 9 檔提交為 `fa10d427b6648573c6602871c3c1886a015b81aa`。commit 前 `git diff --cached --numstat` 與 commit 後 `git show --numstat HEAD` 完全一致：`capacitor.config.json` 1/1、`verify-release.mjs` 11/0、`PLATFORM-GAPS.md` 17/5、`PROGRESS-STAGE2.md` 34/0、audit script 176/0、三張 PNG binary、audit JSON 788/0；未 stage `.idea/`。
- `git merge --no-edit main` 零衝突，merge commit 為 `641d7ce91187de55169d5abdadb1862bd7c6660b`。語意閘門全通過：`index.html:6363` 保留 `const nativeAndroid = android && IS_NATIVE_APP`，`:6367` 保留「系統設定→應用程式→軌島」，舊 `if (iOS || nativeApp)` 不存在，`:2945` 為 iOS-only `music-volume-unavailable`，`:6141` 與 `:17041` 分別仍是 `IS_NATIVE_APP`、`state._setDropMode` 定義；`app/capacitor.config.json:6` 仍為 `loggingBehavior: "none"`。`verify-release.mjs` 同時保留 logcat fail-closed gate（`:13,487`）、Android native assets 同步檢查（`:446`），以及 main 的 `assertPlusSandboxOff`／`assertPlusSandboxTestBuild`（`:48,61`）。
- main 帶入的發行錨點已過期，依使用者指定改成臺北時間 2026-08-10 12:00；commit `17caea05212a18277e18a86c2bfba20d7951b947`，`revenuecat-config.js` numstat 1/1。沒有同步或驗證 iOS 日期；本輪範圍經使用者再次確認為 Android-only。

### Android 全鏈與版本

- 合併前正式底圖產物為 `v0804g`；合併後 `RAIL_INCLUDE_LICENSED_BASEMAPS=1 npm run build` exit 0，輸出 `v0808a`、135 files、41.2 MB，接著 `npx cap copy android` exit 0。以 release verifier 的完整內容／政策閘門、但依 Android-only 範圍略過雙平台 native parity loop，檢查 exit 0；另以硬斷言逐一比對 `app/www` 與 `app/android/app/src/main/assets/public` 均為 `v0808a`，兩處都沒有 `v0804g`。
- 原樣 `npm run verify` 會因未同步的 iOS native public 仍是 `v0804g` 而 fail closed；這不是 Android 失敗，也沒有為了讓指令變綠而覆寫 iOS。此偏離來自使用者明確指示「略過這同步，這邊只驗證 android」，故 Android 發行驗證改由上一項的完整 gates（略過 native 雙平台 loop）加 Android hard parity assertion 組成。
- JDK 21／Android SDK 下 `./gradlew assembleDebug` exit 0，246 tasks；44×44 修改後又完整重跑 build、Android copy 與 Gradle，三段再次 exit 0，APK 已覆蓋安裝至 `RailIsland_API35_Pixel7`。

### Pixel 7／API 35 回歸

- 冷啟後 WebView 為 `v0808a`，`state.ready=true`；資料含 1,163 班列車，畫面可命中 190 個已渲染列車，狀態顯示「190 班奔跑中」，地圖、路網、canvas 均正常。
- 修復前重跑 `stage3-basemap-ui-audit.mjs`：亮／暗 Stadia、Esri 衛星各 8/8 圖磚，署名正確，三模式均重疊 0、裁切 0、中心命中失敗 0；唯一 fail 是既知五顆小於 44 px 控件。
- 定位同意路徑以 emulator GPS `121.5654,25.0330` 得到 5 m 精度並顯示附近 8 站；拒絕兩次後進入落釘模式，完整顯示「系統設定→應用程式→軌島→權限→位置允許；或用『釘』手動點位置」。測後已恢復 Fine／Coarse 權限。
- 分享由產品入口實際開啟 Android chooser，公開網址與文字正確，Back 可返回 App。本地通知由原生 bridge 排程，pending queue 可見，背景後 `dumpsys notification --noredact` 確認 package `tw.railisland.app`、id `990001`、標題「軌島回歸測試」與指定內文；測後由產品 bridge cancel，pending 測試 id 為空。

### 44×44 修復與行為證據

- `index.html` 只替 `.topbar .alert-chip` 與 `.topbar .grouptabs .gtab` 加入 `position: relative`，再用以自身為 containing block 的 44×44 絕對定位 `::after` 擴熱區；沒有更動 padding、字級、gap、視覺框或版面。
- 修復後底圖 audit exit 0：三種底圖各 12/12 當前圖磚、12 個控制，重疊／裁切／中心命中失敗皆 0，`effectiveBelow44Controls=[]`。完整結果在 `docs/android/shots/basemap-ui-audit.json`。
- 新增可重跑的 `docs/android/scripts/stage3-topbar-hit-audit.mjs`。Pixel 7 真實 WebView 對五顆逐一做中心＋四邊 `elementFromPoint`，失敗 0；相鄰中線越界 0；再用 ADB 點每顆視覺框上方、但仍在擴張熱區內的點，click owner 均為自己。「全／台／高／捷」各切到自己的 group，`#alertChip` 實際打開公告詳情，action failure 0。結構化證據為 `docs/android/shots/topbar-44px-audit.json`。
- 共享 UI 另以內建瀏覽器掃 360／375／414／768／1280。因當下正式資料沒有營運公告，前四個尺寸使用一次性的 `app/www` 本機副本注入單筆測試公告以顯示 `#alertChip`；副本與伺服器測後已刪除，來源與正式產物未修改。360／375／414／768 五顆都可見且有效 44×44，合計 100 個中心／四邊命中點失敗 0、重疊 0、裁切 0、與軌島牌重疊 0；1280 依既有桌面設計隱藏整組手機 topbar。證據為 `docs/android/shots/topbar-browser-width-audit.json`。
