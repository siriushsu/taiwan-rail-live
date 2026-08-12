# Android 1.4.2（internal testing v3）進度

> 工作樹：`/Users/xuxiang/Code/軌島-Android`；分支：`feat/android-shell`。本檔隨工作進展即時更新。

## 2026-08-12 起始盤點

- 現場 HEAD 是 `269ecd246df555f77d72d81cbc4060747b4f820f`；其父 `746642b` 才是 internal testing v2。多出的 HEAD 是本批派工書 `docs/android/codex-prompt-catchup-142.md`，保留不改寫歷史。
- 合併來源 `release/app-1.4.2` 已在本機，解析為指定的 `abf5f703fa6805f7070a229306a5f6bdbb50d232`。
- 工作樹起始僅有既存未追蹤 `.idea/`；不納入任何 commit。
- `node_modules` 與 `app/node_modules` 均已確認為 symlink；本批不執行 `npm install`、`npm ci` 或刪除動作。
- 禁止事項：不 push、不 rebase、不改寫既有歷史、不切換其他分支；不讀取、提交或回報本機 secret／policy 檔內容。

## 待完成

- [x] 合併 `release/app-1.4.2`，依派工原則解衝突並在 commit 前完成 Android verify。
- [x] 完成 Android 更新提示、評分入口、版號與 iOS-only 功能缺席適配。
- [x] 建立含授權底圖與授權音樂的 web/native 產物及 release AAB/APK。
- [x] 完成模擬器直向、橫向、通行證、評分跳轉、背景音樂與版號端到端驗收。
- [x] 核對產物 SHA-256、staged stat 與 commit numstat。

## 合併與平台適配（已提交）

- 已以 `git merge --no-commit --no-ff release/app-1.4.2` 合併來源 `abf5f703fa6805f7070a229306a5f6bdbb50d232`，並在所有 commit 前 gates 通過後建立 merge commit `61ae608833780bfc6944cf3a97e259ac9c641bf3`；未 push。
- 三個衝突已逐段處理：
  - `index.html`：採 release 的原生背景音樂首繪判斷；`PLUS_ENABLED` 仍逐字保留 Android fail-closed 早退行。
  - `app/scripts/verify-release.mjs`：保留 Android 的 `assertAndroidPlusGate`、production logging gate 與 `RAIL_VERIFY_NATIVE` 單平台 parity；併入 release 的 `RAIL_APP_VERSION` 注入斷言與所有 iOS 自製 plugin 註冊 gate。
  - 創始期判準採 8/11 release 新規則：先以 `false`／`null` 區分「明確不辦」與「尚未決定」，有錨點時檢查 build 日仍落在 30 天視窗內。舊的 `foundingLaunchPublished` helper 已移除，避免保留一條與新判準矛盾的死程式。
  - `revenuecat-config.js` 採 release 真相：`foundingLaunchAt: '2026-08-10T12:00:00+08:00'`，不保留已被新判準淘汰的 `foundingLaunchPublished` 欄位。
- Android 平台適配已落碼、待瀏覽器與模擬器驗證：
  - `appUpdateInit()` 在 `Capacitor.getPlatform()==='android'` 時於 Apple lookup 前短路，仍回傳只用來打開「軌島」段與評分列的 UI state；更新列與更新橫幅保持隱藏。
  - 評分列依平台選 URL；Android 指向 `https://play.google.com/store/apps/details?id=tw.railisland.app`。`maybeAskReview()` 對 Android 明確 no-op，本批沒有新增 Play In-App Review plugin。
  - Android 版號已改為 `versionCode 3`、`versionName "1.4.2"`；`minifyEnabled false` 未動。
  - BUILD 推為 `v0812a`，更新紀錄新增 8/12 Android 1.4.2 條目；近期清單仍維持八條。
  - `scripts/verify_app_update.mjs` 與 `scripts/verify_app_review.mjs` 已新增 Android 正負向斷言（Apple request=0、更新 UI 隱藏、評分列可見且紅粗體無 emoji、Play URL、原生邀請 no-op）。

## 分辨實驗：Android PLUS gate 的中文 worktree 路徑

- 修改後的三支 `.mjs` 先以 `node --check` 檢查，並跑 `git diff --check`，皆 exit 0。
- 首次執行 `node app/scripts/verify-android-plus-gate.mjs` 在讀檔階段失敗，錯誤目標含字面 `%E8%BB%8C...`；同一時點 `app/www/index.html` 實際存在，且直接把根目錄 `index.html` 傳給 `assertAndroidPlusGate()` 可通過。因此判定為 gate 用 `URL.pathname` 未解碼中文路徑，不是 PLUS 產品回歸，也不是該放寬期望值。
- 修法只改測具路徑解析：改用 Node `fileURLToPath(new URL(...))`；Android／iOS／Web 正負樣本與逐字 gate 判準均未改。

## 分辨實驗：Android 快速短路與「更多」測試時序

- `node scripts/verify_app_update.mjs` 首跑為 64 pass / 2 fail；Android 的 Apple request=0、state、更新列與橫幅判準全過，只有打開「更多」後的段名／評分列可見性失敗。
- Android 專屬路徑不等待 Apple lookup，`window.__appverLast` 會在 `setupMapTools()` 綁定 `#tabMore.onclick` 前出現；iOS 測試因 lookup 延遲而沒撞到。這是測具等待錯誤，不是產品回歸。
- 補環境條件後重量：Android 情境先等 `state.ready===true`（使用者真正可操作的 boot 完成訊號），再做原本同一條可見性斷言；沒有改產品程式，也沒有降低期望值。
- 第二次仍只有同兩條可見性失敗；進一步對照既有 helper 發現新 Android page 沒設定 viewport，Playwright 預設桌面寬度使 `#tabMore` 本來就隱藏，`.click().catch()` 因此被吞掉。再補真實手機 viewport `390×844` 後重量；這仍是補齊環境條件，不改判準。
- 補齊 boot-ready 與 `390×844` 後，`node scripts/verify_app_update.mjs` exit 0：`66 通過 / 0 失敗`（含 Chromium／WebKit 四寬度既有回歸）。

## 分辨實驗：評分列品牌紅判準

- `node scripts/verify_app_review.mjs` 首跑為 28 pass / 1 fail；Android 的實得顏色 `rgb(210, 60, 42)`、字重 800，產品 CSS 明確寫 `color: var(--red); font-weight: 800`。失敗來自新增測試把品牌紅手打成另一個舊色碼 `rgb(194, 58, 47)`。
- 判定為測試判準未與設計 token 同源，不是產品回歸。修正測具改為在瀏覽器內解析 `var(--red)` 後與評分列 computed color 比對，粗體下限 `>=700` 與無 emoji／Play URL 判準均保持不變。
- 重量 `node scripts/verify_app_review.mjs` exit 0：`29 通過 / 0 失敗`。Android 正向證據包含「軌島」節與評分列可見、更新列隱藏、品牌紅粗體、無 emoji、Play URL；負向證據包含 Apple request=0 與 `maybeAskReview()` no-op。

## 靜態、平台與 release gates

- `node app/scripts/verify-android-plus-gate.mjs` 修正中文路徑測具後 exit 0：Android=false、iOS=true、web query 行為全過；負向突變確實被拒（`negativeRejected:true`），不是無牙 gate。
- `RAIL_VERIFY_NATIVE=android npm run verify` exit 0：目標 `app/www`、BUILD `v0812a`、167 files／144.9 MB、production logging 關閉、授權音樂與授權底圖均 enabled；Android PLUS initializer 與 release 新增的 `RAIL_APP_VERSION`／iOS plugin gates 一併全綠。
- `node scripts/verify_landscape.mjs` 以該腳本隨 release 指定的 main 系 baseline `ad63246` 執行，避免用 Android 舊殼 `746642b` 做錯樹零回歸；Chromium＋WebKit 完整矩陣 exit 0，`795/795`。涵蓋 667×375 至 956×440 六個橫向、375／393／414 三個直向、真觸控、列車 elementFromPoint 命中地圖、右側欄、露出區置中、頂列／時鐘／動作列、旋轉來回與 iPad／桌面零回歸。

## 出貨鏈與產物

- `RAIL_INCLUDE_LICENSED_BASEMAPS=1 RAIL_INCLUDE_LICENSED_MUSIC=1 npm run build:release`：首次在 sandbox 因本機 listen `EPERM` 失敗；補同一條指令所需的本機服務權限後重量 exit 0。資料 manifest 28 files 一致，`place_index` v1 samples=16／trains=1157／segments=36758／lines=17，release check 為 167 files／144.9 MB、BUILD `v0812a`、授權音樂與底圖 enabled。
- `npx cap copy android` 首次 CLI 雖回 exit 0，但內文有舊資產 unlink `EPERM`，依內容判為失敗；補檔案權限後原指令重量成功，web assets copy 74.51 ms、Android copy 81.76 ms。未執行任何 install／ci。
- JDK 21（`/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`）＋既有 Android SDK：
  - `./gradlew bundleRelease --console=plain`：exit 0，`BUILD SUCCESSFUL in 37s`，302 tasks。
  - `./gradlew assembleRelease --console=plain`：exit 0，`BUILD SUCCESSFUL in 6s`，327 tasks。
- AAB：`/Users/xuxiang/Code/軌島-Android/app/android/app/build/outputs/bundle/release/app-release.aab`，121,180,941 bytes，SHA-256 `018a8019636388622be90a3a65a47d9acbdb56d7aa0cdfc6c4f9cd2503ebc22b`。
- APK：`/Users/xuxiang/Code/軌島-Android/app/android/app/build/outputs/apk/release/app-release.apk`，121,818,645 bytes，SHA-256 `f5cc78ff94218b539ae8627a990b23e6a428d4b61404497f1bcbe2155a3bdcee`。
- bundletool 直接 dump AAB manifest，exit 0：`package="tw.railisland.app" android:versionCode="3" android:versionName="1.4.2"`、minSdk 24、targetSdk 36；不是拿 APK 版號代替。
- `jarsigner -verify` AAB exit 0 且輸出 `jar verified.`；警告為 upload 自簽憑證鏈／無 timestamp 與 JDK 對 AAB zip 結構的一致性提醒。APK 的 `apksigner verify` 亦 exit 0，signer 憑證 SHA-256 已核對。
- AAB／APK 各含 29 個 `.mp3`；APK 內 `index.html` 的 BUILD `v0812a`、`RAIL_MUSIC_ENABLED=true`、`RAIL_BASEMAPS_ENABLED=true` 均各命中一次，且 `app/www/index.html` 與 Android assets 逐 byte 相同。

## 分辨實驗：既有 AVD 鎖定與可見 E2E 環境

- 使用指定 `RailIsland_API35_Pixel7` 冷開後安裝 release APK 成功，package manager 讀到 `versionCode=3`；原 userdata 的 user 0 實際狀態為 `RUNNING_LOCKED`，credential-encrypted data 尚未掛載。APK manifest 與 `dumpsys package` resolver table 均確實有 exported launcher `tw.railisland.app/.MainActivity`，因此不是 manifest／合併回歸。
- 保留原 AVD userdata／snapshot 不動，改用同一 Pixel 7／API 35 system image，將全新隔離 userdata 放在本工作樹 `.tmp-avd-v3/`；啟動後 17.762 秒進入 `RUNNING_UNLOCKED`，畫面可見且不需盲操作。
- release APK 安裝成功後由 launcher intent 冷啟動：`Status: ok`、`LaunchState: COLD`、`Activity: tw.railisland.app/.MainActivity`、`TotalTime: 651 ms`、`WaitTime: 654 ms`。首次原生定位權限提示以畫面上可見的「使用應用程式時」按鈕實際點擊，onboarding 的「不再顯示」亦以畫面位置實點。
- 直式主畫面已實跑確認：底圖、全台路網、站點與列車均正常可見，時鐘顯示 `LIVE`，畫面當下為 `159 班奔跑中`，底部五個導覽入口可見。證據：`docs/android/shots/v3-portrait-main.png`。
- 既有黑色鎖屏證據保留於 `docs/android/shots/v3-emulator-locked.png`，用來記錄原環境條件；後續 E2E 全部在上述隔離、可見、已解鎖環境執行。

## 模擬器 E2E：更多選單與 Android App 區

- 依 `#tabMore` 的真實 `getBoundingClientRect()` 校正實體點位後，以 ADB 觸控實點開啟；`document.elementsFromPoint()` 顯示抽屜在頁籤、遮罩與地圖之上。software GPU 首次未立即合成 fixed layer，送出無破壞性的選單鍵觸發 redraw 後，畫面確實可見完整「更多」抽屜；不以 DOM 狀態冒充肉眼證據。抽屜頂部證據：`docs/android/shots/v3-more-redraw.png`。
- 在可見抽屜內實際向上滑動三次，`#moreBody.scrollTop=695.238`；畫面可見「軌島」段與紅色粗體「給軌島評分」，字樣無 emoji。Android 更新列仍存在於 DOM 供其他平台共用，但實得 `display:none`、矩形 `0×0`；PLUS 的更多入口已不存在。證據：`docs/android/shots/v3-more-rate.png`。
- 在畫面上實際點擊「給軌島評分」後，Android `ActivityTaskManager` 收到 `android.intent.action.VIEW`，完整 URI 為 `https://play.google.com/store/apps/details?id=tw.railisland.app`，前景由軌島切至 Chrome；不是 App Store URL。全新 userdata 的 Chrome 首次啟動先顯示歡迎頁，點選可見的「不使用帳戶」後，`dumpsys activity` 再次顯示相同完整 Play URL，Chrome 網址列亦為 `play.google.com`。Play 網頁回報 requested URL 找不到，判定為 v3 尚未上 internal testing 前的外部商店狀態，不改產品 URL／期望值。證據：`docs/android/shots/v3-rating-result.png`、`docs/android/shots/v3-rating-play.png`。

## 模擬器 E2E：Android PLUS fail-closed

- 對 release APK 的實際 WebView 執行既有 `stage4-android-plus-gate-audit.mjs`，exit 0、`failures=[]`。實得 `platform=android`、`IS_NATIVE_APP=true`、`PLUS_ENABLED=false`。
- 兩個通行證入口皆已從 DOM 移除：工具列 `#accountBtn exists=false`、更多列 `data-proxy=accountBtn exists=false`；使用說明的 PLUS section 可用數為 0；全頁可見付費誤點 CTA 數為 0。
- 以真實台鐵班次建立 30 天誤點摘要的命中測試仍可開啟免費資訊：文字為「近30天平均誤點 2分・準點 90%（30天）」；付費連結數 0、列車卡付費入口 hidden。免費地圖／Leaflet 存活，runtime 當下有 1,116 班列車。完整機上報告：`docs/android/shots/v3-android-plus-gate-audit.json`。

## 模擬器 E2E：橫式跟車與列車卡

- 以 Android 系統 rotation 將實機 WebView 由直式旋轉為 `landscape-primary`，實得 CSS viewport `863×360`、`body.fs=true`；乾淨態可見全台地圖、路線、列車、完整 topbar 與五顆 tab，證據：`docs/android/shots/v3-landscape-clean.png`。
- 在橫式畫面上實際點擊「隨機跟隨」，成功跟到台鐵 `121` 次（非測具直接塞 state）；跟隨卡顯示 EMU3000 新自強號、速度、下一站與 30 天準點摘要。列車實際 viewport 座標 `(431,180)`，該點 `elementFromPoint` 命中 `#map`，不是被浮層蓋住；證據：`docs/android/shots/v3-landscape-follow.png`。
- 再於畫面實際點擊跟隨卡，`body` 進入 `train-open sheet-open`，列車卡成為右側欄：rect `left=515.2, top=52, width=340, height=248`，地圖左側露出比例 `0.597`、高度比例 `0.689`、右緣錨定成功。跟隨列車移至 `(257,180)`，與露出地圖中心 `(257.6,180)` 相差不到 1px，兩點 `elementFromPoint` 都命中 `#map`。
- 同一穩定態逐一量 topbar、clock、「換一班」、followPanel、trainCard，兩兩相交清單為空；列車卡與頂列／時鐘／動作列均未重疊。可見畫面證據：`docs/android/shots/v3-landscape-train-card.png`。

## 模擬器 E2E：背景音樂開／關與實際輸出

- 轉回直式後實點「更多」，在抽屜內實際滑到「♪ 背景音樂」。第一次點位未補 Android status bar 的實體像素偏移，實際切到上一列「省電模式」；音樂仍為 `paused=true/currentTime=0`，因此不算通過。補做分辨實驗，以 WebView rect 中心加狀態列偏移校正實體點位，沒有改產品或放寬期望值。
- 校正後實點同一可見音樂列，產品開始播放 release APK 內的授權曲目 `Untitled-2.mp3`：`src=https://localhost/suno musics/Untitled-2.mp3`、duration `102.384s`、volume `0.5`、readyState `4`、`paused=false`。播放時間由 `22.740s` 前進到 `57.558s`，工具列 `#musicBtn.playing=true`、更多列 toggle 為 `on`；可見證據：`docs/android/shots/v3-music-playing.png`。
- Android `AudioFlinger` 同時顯示 notification client `tw.railisland.app` PID `4532`／UID `10207`，track `56` 為 active，48kHz、輸出路由 `AUDIO_DEVICE_OUT_SPEAKER`；HAL signal power 連續為非靜音值（約 `-55` 至 `-70 dB`），不是只有 UI 狀態。原始證據：`docs/android/shots/v3-music-audioflinger.txt`。
- 再次實點同一音樂列並等待 800ms 淡出後，實得 `enabled=false`、`paused=true`、volume `0`、按鈕 playing=false、更多列 toggle 關閉；可見證據：`docs/android/shots/v3-music-stopped.png`。背景音樂開／關兩向均已實跑。

## 模擬器 E2E：版號、更新 UI 與 crash 收尾

- `dumpsys package tw.railisland.app` 實得 `versionCode=3 minSdk=24 targetSdk=36`、`versionName=1.4.2`；WebView 實得 `platform=android`、`RAIL_APP_VERSION=1.4.2`、BUILD `v0812a`。與 AAB manifest 的直接 dump 結果一致。
- Android App 更新 state 實得 `hasUpdate=false`、`showBanner=false`、`showWhatsNew=false`、`showUpdateRow=false`、`latest=null`；全頁唯一 update candidate 是共用的更多列，但 computed `display:none`、不可見，未找到更新橫幅。
- E2E 完成後以 `logcat` 掃 `FATAL EXCEPTION`、`AndroidRuntime`、軌島 process crash 與 Chromium crash，無命中。平台收尾報告：`docs/android/shots/v3-platform-audit.json`；橫式與音訊結構化報告分別為 `v3-landscape-audit.json`、`v3-music-audit.json`。

## 最終結論與已知外部條件

- internal testing v3 的 web／native 內容、平台降級、release build、簽章、版號與要求的真機 E2E 均已完成。App Store 更新來源沒有在 Android 上發 request／露出 UI；評分只送 Google Play URL；iOS-only 原生功能在 Android 安靜缺席。
- Google Play 網頁目前對 `tw.railisland.app` 回 requested URL 找不到；完整 Android VIEW intent 與網址列已證明產品送出的 package URL 正確，判定為 v3 尚未上傳 internal testing 前的商店外部狀態。本輪鐵則禁止 push，派工也沒有授權代為操作 Play Console，因此不將外部頁面尚未可見誤改成產品 URL。
- software GPU 模擬器第一次顯示 fixed「更多」抽屜時，DOM／命中狀態已切換但合成畫面延遲；無破壞性的 Android menu key 觸發 redraw 後，抽屜與後續滑動、開關、側欄都能正常實際顯示。這項記為模擬器合成環境條件；產品行為另有實畫面、ADB 觸控與 elementFromPoint 三重證據。
- E2E 完成後已關閉本輪隔離模擬器，並只清除本工作樹內由本輪建立的 `.tmp-avd-v3/`；原本有圖形鎖的 AVD userdata／snapshot 未修改。三張未被引用、且只代表校正過程的中間圖（`v3-current.png`、未重繪的 `v3-more.png`、誤點前的 `v3-music-off.png`）已移除，正式證據集保留 5.4 MB。

## Git 稽核

- merge commit 前 `git diff --cached --check` exit 0、無 unmerged path；`git diff --cached --stat` 為 88 files changed、50,023 insertions、267 deletions。既存 `.idea/` 仍是唯一未納入的起始未追蹤項目。
- 依派工規則使用不帶 pathspec 的 `git commit -m ...`；commit 後 `git show --numstat HEAD` 列出同一批 88 files。另將 commit 相對第一父的完整 numstat 與 commit 前 cached numstat 排序逐行比對，`PRE_CHARS=3474`、`POST_CHARS=3474`、`FIRST_PARENT_NUMSTAT_MATCH=true`，無多收或漏收。
- 全程未 push、未 rebase、未改寫歷史、未切換分支，也未納入本機 secret／policy 檔。
