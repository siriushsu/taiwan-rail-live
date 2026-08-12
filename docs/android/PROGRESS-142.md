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
- [ ] 完成模擬器直向、橫向、通行證、評分跳轉、背景音樂與版號端到端驗收。
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

## 分辨實驗：模擬器無法啟動 App

- 使用指定 `RailIsland_API35_Pixel7` 冷開後安裝 release APK 成功，package manager 讀到 `versionCode=3`；但以 launcher intent 啟動時回 activity not found。
- 補做分辨實驗：APK manifest 與 `dumpsys package` 的 resolver table 都確實有 exported launcher `tw.railisland.app/.MainActivity`；問題不是 manifest／合併回歸。模擬器 user 0 實際狀態是 `RUNNING_LOCKED`、credential-encrypted data 尚未掛載，畫面停在使用者既有的九宮格圖形鎖；這與 `docs/android/PROGRESS-STAGE2.md` 既有紀錄相同。
- 標準 wake、swipe、`KEYCODE_MENU` 與 `wm dismiss-keyguard` 均無法繞過使用者圖形鎖；不猜密碼、不擅自 `-wipe-data`。鎖屏證據：`docs/android/shots/v3-emulator-locked.png`。
- 因此下列真機 E2E **尚未驗收，不宣稱成功**：冷啟動地圖／列車、更多選單與 Play 商店跳轉、通行證入口全滅、模擬器橫放跟車／列車卡、背景音樂有聲。需要使用者解鎖該 AVD（或明示允許清除 AVD data）後才能續跑。

## Git 稽核

- merge commit 前 `git diff --cached --check` exit 0、無 unmerged path；`git diff --cached --stat` 為 88 files changed、50,023 insertions、267 deletions。既存 `.idea/` 仍是唯一未納入的起始未追蹤項目。
- 依派工規則使用不帶 pathspec 的 `git commit -m ...`；commit 後 `git show --numstat HEAD` 列出同一批 88 files。另將 commit 相對第一父的完整 numstat 與 commit 前 cached numstat 排序逐行比對，`PRE_CHARS=3474`、`POST_CHARS=3474`、`FIRST_PARENT_NUMSTAT_MATCH=true`，無多收或漏收。
- 全程未 push、未 rebase、未改寫歷史、未切換分支，也未納入本機 secret／policy 檔。
