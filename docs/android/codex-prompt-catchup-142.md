# 派工：軌島 Android 追上 1.4.2(44) 內容——合併、平台適配、出 internal testing v3

## 🔴 鐵則（第一行就要遵守，埋在中段的禁令視同不存在）

1. **你是這輪唯一負責人**。可開子 agent，但每個子 agent 的 prompt **第一行**必須帶上鐵則 2、3、4。子 agent 宣稱「已驗過」的事實你要自己抽測。
2. **只在 `/Users/xuxiang/Code/軌島-Android` 這棵樹裡工作**。這台機器有 70+ 棵並行工作樹（含主樹 `/Users/xuxiang/Code/捷運小動畫`，正被其他 session 使用），絕對不要進入或修改任何其他目錄。
3. **git：本樹內可 merge、可 commit，但絕對不准 `push`、不准 `rebase`、不准改寫既有歷史、不准切換或動到其他樹 checked-out 的分支。**
   - commit **不要帶 pathspec**（`git commit -m "..."` 就好）；commit 前 `git diff --cached --stat`、commit 後比對 `git show --numstat HEAD`，數字不符＝收到不該收的東西，`git reset --soft HEAD~1` 重來。
   - 合併衝突解完先跑驗證再 commit，不要「先 commit 再修」。
4. **`node_modules` 與 `app/node_modules` 都是 symlink**（指向主樹）。不要 `npm install`／`npm ci`／`rm`——動了會同時炸掉其他工作樹。
5. **隨做隨落檔**：每完成一項就更新 `docs/android/PROGRESS-142.md`（新開這份）。連線斷掉時那份檔案是唯一存活的成果。
6. `app/android/key.properties`、`app/release-policy.json` 是本機檔（gitignored）：不准 commit、不准把內容貼進回報。
7. **需要判斷「這是產品回歸／環境條件／判準過期」時先做分辨實驗**（補環境條件重量一次），不要直接改期望值。

## 現況

- 本樹：分支 `feat/android-shell`，HEAD `746642b`（internal testing v2，versionCode 2 / versionName 1.4.1，已上傳 Play）。工作樹乾淨（`.idea/` 未追蹤，忽略它、不要 commit）。
- 合併來源：**本 repo 的分支 `release/app-1.4.2`，commit `abf5f70`**（不需要網路，`git merge release/app-1.4.2` 即可；該分支在另一棵樹 checked out，merge 只讀不動它）。內容＝origin/main 全部（含 8/11 橫式側欄版面五連發）＋ iOS 1.4.2 App 批次（背景音樂原生化、App 更新提示與評分入口、動態島）＋ 8/12 的「更多選單移除 emoji」修正。
- Android 落後這條線約 80 顆 main commit，這輪就是把 web 層內容整批追上，並做 Android 平台適配後出 v3。

## 目標與動機

iOS 1.4.2(44) 已上架，Android 還停在 7 月底的內容。**目標：Android internal testing v3（versionCode 3 / versionName 1.4.2），web 層內容與 iOS 1.4.2 同源，iOS-only 的原生功能在 Android 上優雅缺席（不是壞掉）。**「BUILD SUCCESSFUL」只證明編譯過；這個專案被假綠咬過很多次，驗收一律要端到端證據（實跑截圖、命中測試、實際點擊的行為）。

## 任務

### A. 合併

`git merge release/app-1.4.2`。衝突解法原則：

1. **`index.html` 的 PLUS_ENABLED initializer**：Android 早退這一行**必須原封存活**（現在本樹 index.html:6189）：
   ```js
   if (IS_NATIVE_APP && window.Capacitor?.getPlatform?.() === 'android') return false;
   ```
   其餘 initializer 內容以 release 側為準。合併後 `app/scripts/verify-release.mjs` 的 `assertAndroidPlusGate`（本樹 :73，:317 呼叫）是**逐字比對整段 initializer**——若 release 側改過該段導致比對失敗，把 verifier 期望字串更新成「合併後的真相」（保留 Android 早退行），這是該 gate 自己文件寫明的維護方式。
2. **`app/scripts/verify-release.mjs`**：取**聯集**——本樹的 Android gates（assertAndroidPlusGate 等）＋ release 側新增的 gates（RailReviewPlugin 註冊閘門、`RAIL_APP_VERSION` 注入斷言）兩邊都要留。
3. `app/ios/**`、`*.pbxproj`、iOS plugin Swift 檔：一律取 release 側（theirs）。
4. `app/scripts/prepare-web.mjs`、`set-release-mode.mjs`：取 release 側，解完檢查 Android 用得到的部分沒被退掉。
5. 解完衝突先跑 `RAIL_VERIFY_NATIVE=android` 的驗證（見 D）再 commit。

### B. Android 平台適配（合併後逐項）

1. **更新檢查資料源是 Apple**：`APPVER_LOOKUP`（grep 這個常數名）打 `itunes.apple.com/lookup?bundleId=...`，查回來的版本與 `latest.url` 都是 iOS 商店的。**Android 上不可以拿它來顯示「有新版」或開 App Store 連結。**做法：平台分支——Android 上不打 Apple lookup、更新那一列與更新橫幅維持不出現（Play 會自動更新，先不自建版本源），**但「軌島」那節（`#msAppSec`）與評分列必須照樣現身**。注意：現行唯一讓它們現身的路徑是 `appUpdateRender(res)`（res 非 null 才跑），所以 Android 要有自己的顯示路徑（例如 `appUpdateInit` 對 android 回一個「只亮入口、hasUpdate:false、不顯示 update 列」的分支）。
2. **評分列**：`REVIEW_WRITE_URL`（grep 常數名）是 Apple write-review 深連結；Android 點評分列改開 `https://play.google.com/store/apps/details?id=tw.railisland.app`。自動評分邀請 `maybeAskReview` 在 Android 沒有原生 plugin、會安靜返回（scripts/verify_app_review.mjs 的【B】已有此斷言）——**維持 no-op，這輪不要加 Play In-App Review 原生件**。
3. **版號**：`app/android/app/build.gradle` `versionCode 2 → 3`、`versionName "1.4.1" → "1.4.2"`（每次上傳 Play 必遞增 versionCode）。
4. **R8 刻意不動**（build.gradle `minifyEnabled false` 維持）：開 R8 需要完整 release 回歸，另開批次，這輪不做。
5. **橫式版面**：AndroidManifest 沒鎖向（configChanges 含 orientation），合併帶進來的橫式側欄在 Android 會生效——列入 D 的實測清單。
6. **背景音樂**：iOS 原生 AVPlayer plugin 在 Android 不存在，web 層播放要照常；v2 已含授權音樂，出貨鏈的音樂旗標照 v2。

### C. 出貨 build

**照本樹既有紀錄執行，不要自己發明指令**：`docs/android/PROGRESS-STAGE2.md` 末段記載的 Android-only 完整鏈＝
`RAIL_INCLUDE_LICENSED_BASEMAPS=1 npm run build` → `npx cap copy android` → `RAIL_VERIFY_NATIVE=android npm run verify` → Gradle `bundleRelease`／`assembleRelease`（v2 另含授權音樂旗標 `RAIL_INCLUDE_LICENSED_MUSIC=1`，這輪照 v2；確切指令以 `docs/android/PROGRESS.md`／`PROGRESS-STAGE2.md` 的紀錄為準）。`key.properties` 已在本樹，release 會自動簽 upload 簽章。

### D. 驗收（每項要證據，截圖存 `docs/android/shots/`）

1. `RAIL_VERIFY_NATIVE=android npm run verify` 全綠（含 assertAndroidPlusGate 與 release 側新 gates）。
2. release APK 裝進模擬器（`RailIsland_API35_Pixel7` 供 adb install；`RailIsland_API35_Pixel7_Play` 是 Play 安裝鏈用）冷啟動：不 crash、地圖畫出來**且畫面上有列車**。
3. 「更多」選單：「軌島」節與評分列**在**（紅字粗體、**無任何 emoji**——這是 8/12 使用者裁決，合併內容已含）；更新列與更新橫幅**不出現**；點評分列開出 **Play 商店頁**（不是 App Store）。
4. 通行證入口全滅（gate 生效）：入口×2、誤點履歷付費 CTA、說明中心通行證節都不存在。
5. **橫放**（模擬器轉橫向）：跟一班車、點跟隨小卡開列車卡＝**右側欄**、列車落在露出地圖的中心（elementFromPoint 命中地圖）、頂列／時鐘／動作列互不重疊。網頁層可先跑 `node scripts/verify_landscape.mjs`（合併後就在樹裡，需 playwright；BASE_REF 用合併前的 `746642b` 當桌面零回歸基準不適用——那支的基準是 main 系，若 baseline 比對紅了先判斷是不是基準錯樹，照鐵則 7）。
6. 背景音樂：開關不炸、有聲（模擬器抓 audio dump 或 logcat 佐證即可）。
7. AAB 的 versionCode/versionName 實際值（`bundletool dump manifest` 或 aapt）＝3／1.4.2。

### E. 回報格式

- 只回：結論、關鍵證據（檔案:行號、截圖路徑、指令 exit code 與關鍵輸出行）、風險與未確定點。
- AAB 與 APK 的完整路徑＋SHA-256。
- 長內容一律寫進 `docs/android/PROGRESS-142.md`，回報只給路徑。
- 做不到的事（環境缺件、權限擋住）**如實回報停下**，不要繞過、不要假設成功。
