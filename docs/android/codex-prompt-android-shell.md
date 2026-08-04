# 派工：軌島 Android 殼建立（階段一 · 全程不需任何憑證）

## 🔴 鐵則（違反即整輪作廢——先讀完這段再動手）

1. **你是這輪的負責人**。要開子 agent 分工沒問題——任務 I（平台差異盤點）那種大量讀檔的活特別適合。但兩件事必守：
   - **每個子 agent 的 prompt 第一行就要帶上鐵則 2、3、5**（禁 git 寫操作、不准離開這棵樹、不准動 `node_modules`）。埋在任務描述中段的禁令視同不存在——這是實際踩過的坑：一個子 agent 為了看自己的 diff 跑了 `git stash`，把另外兩個 agent 進行中的變更一併收走。
   - **子 agent 的產出你要自己驗，不要照單全收**。尤其它宣稱「我已經驗證過」的事實（檔案存在、指令跑過、尺寸對），你要自己抽測——agent 對「我驗過了」的宣稱本身也可能是假的。
2. **禁止一切 git 寫操作**——`commit` / `add` / `branch` / `checkout` / `switch` / `stash` / `reset` / `rebase` / `worktree` 全部不准碰。原因有兩個，都會讓你整輪白做：
   - 你的 sandbox 對 `.git` 是唯讀的，一執行就 `Operation not permitted` 秒退；
   - 這台機器上同時有 **70 個以上的並行工作樹**，`git stash` 會把別人未 commit 的變更整包收走。
   分支 `feat/android-shell` 已經幫你建好、也 checkout 好了。**你只負責改檔，commit 由主對話收尾。**
   `git status` / `git diff` / `git log` / `git ls-files` 這類**唯讀**指令可以放心用。
3. **只在 `/Users/xuxiang/Code/軌島-Android` 這棵樹裡工作**。絕對不要進入任何其他 `軌島-*` 或 `捷運小動畫` 目錄——那些是別的 session 正在寫的工作樹。
4. **隨做隨落檔**：每做完一項任務就更新 `docs/android/PROGRESS.md`（寫下結論＋證據＋指令輸出關鍵行），不要只在最終回報才輸出。連線斷掉時那份檔案是唯一存活的成果。
5. **`app/node_modules` 是 symlink**（指向主樹的同名目錄）。**不要 `npm install`、不要 `rm`、不要 `npm ci`**——動了會同時炸掉其他工作樹。缺套件就停下來回報。
6. **`app/release-policy.json` 與 `app/NATIVE_PRIVACY_AND_PERMISSIONS.md` 不准 commit、不准把內容貼進回報**。它們是 gitignored 的本機檔（含授權證據），我複製進來只是給你當參照。

---

## 目標與動機

軌島（railisland）是台灣鐵道即時動畫網站，iOS 版是 **Capacitor 殼**，目前 1.3.2 (19) 在 App Store 審查中。現在要開 **Android 版**。

殼很薄——自寫原生只有一個 `AppDelegate.swift`，其餘全是標準 Capacitor 官方外掛，所以 Android 的可行性高。**這一階段的目的是把「能編出 APK」這條路打通並留下可重現的紀錄**，不含任何需要後台帳號的事（Firebase 設定檔、RevenueCat 金鑰、簽章、Play Console 全部排除在外，見〈停下回報〉）。

動機講清楚，方便你在邊界情況做對取捨：**這個 App 在 App Store 的資料揭露是「不收集資料」**。所以任何會擴大權限面的決定（多宣告一個權限、多接一個 SDK）都要往保守的方向倒，寧可少宣告後續再補，也不要先加了再說。

---

## 已查證的現況（直接採用，不要再花時間重查）

| 項目 | 值 |
|---|---|
| 工作樹 | `/Users/xuxiang/Code/軌島-Android` |
| 分支 / base | `feat/android-shell`，基於 `origin/main` = `11a3139` |
| Capacitor | `@capacitor/android` **8.4.2 已在 `app/package.json` 相依裡**（不用另外裝） |
| appId | `tw.railisland.app` |
| appName | `軌島` |
| 背景色 | `#f4edda`（`app/capacitor.config.json` 的 `backgroundColor`） |
| iOS 現行版號 | `MARKETING_VERSION = 1.3.2`、`CURRENT_PROJECT_VERSION = 19` |
| 已存在的 script | `app/package.json` 裡 `open:android` 早就寫好了 |

已經幫你確認過的三個「前人預留的洞」，都要在本輪補上：

1. `app/scripts/verify-release.mjs` 約 300–301 行有註解
   `// Android 生成後補上 ['Android', join(appRoot, 'android/app/src/main/assets/public/index.html')]`
2. `app/src/native-bridge.mjs:59` 已經預留 `platform === 'android' ? rc.androidApiKey : ''`（值來自 `window.RAIL_REVENUECAT_CONFIG`，本階段**不需要**填）
3. `app/scripts/prepare-web.mjs` 的 esbuild target 已含 `chrome100`，Android WebView 相容性沒問題

環境（使用者剛裝好 Android Studio，若指令找不到就停下回報，不要自己去下載安裝）：

```
ANDROID_HOME=$HOME/Library/Android/sdk
```

若 `ANDROID_HOME` 沒設，請在你自己的指令裡帶上（`ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew ...`），不要去改使用者的 shell 設定檔。

**Gradle 需要工作區以外的寫入權**：`~/.gradle`（快取）、`~/Library/Android/sdk`（licenses 與 build-tools）、`~/.android`。如果 build 以權限錯誤失敗，**停下來回報是哪個路徑被擋**，讓使用者去授權——不要試圖用 `sudo`、也不要把 Gradle 的 home 改到工作區裡繞過。

**已知落差（已實測，第一次 build 大機率會撞到）**：Capacitor 8.4.2 預設 `compileSdk = 36`、`targetSdk = 36`、`minSdk = 24`（來源：`app/node_modules/@capacitor/android/android/capacitor/build.gradle`），但這台目前**只裝了 `platforms/android-37.0`，沒有 android-36**；`build-tools` 是 `36.0.0`，`android-sdk-license` 已接受。

正確處理順序：

1. 先讓 Gradle 自己下載缺的 platform（授權已接受，只要有 SDK 目錄寫入權就會自動抓）。
2. 若自動下載失敗，用 `"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platforms;android-36"` 補（找不到 `cmdline-tools` 就回報，不要自己去下載安裝）。
3. **不要**為了避開這件事就把 `compileSdkVersion` 改成 37 —— 那是未經驗證的版本跳躍，會牽動 AGP／Gradle 相容性。真的要改，先在 `PROGRESS.md` 寫下理由與證據再改，並在回報裡標成風險項。

---

## 任務

### A. 產生 Android 專案

```
cd /Users/xuxiang/Code/軌島-Android/app
npm run build          # = node scripts/prepare-web.mjs，產出 www/
npx cap add android
npx cap sync android
```

`npm run build` 不帶授權旗標時建的是「安全 build」（不含 Stadia／Esri 衛星底圖），這一輪**刻意就是要這樣**，先確認流程通。不要自己加 `RAIL_INCLUDE_LICENSED_*` 旗標。

### B. 版號與識別

- `versionName` = `1.3.2`（對齊 iOS 與網站，使用者看到的版本才一致）
- `versionCode` = `1`（Android 在 Play Console 是**獨立計數**、首次上架，從 1 起最乾淨）
- 確認 `applicationId` = `tw.railisland.app`
- App 顯示名稱 = `軌島`

若你認為 `versionCode` 從 1 起有問題，**寫進回報說明理由，但仍照上面做**——不要自作主張改成別的數字。

### C. 圖示與啟動畫面

來源素材（已在版控裡）：

- 圖示：`app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`（1024×1024）
- 啟動圖：`app/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`

用 macOS 內建的 `sips` 產各密度資源（不要去裝 ImageMagick 之類的新工具）：

- legacy launcher icon：mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192
- adaptive icon：background 用純色 `#f4edda`，foreground 用圖示內縮到安全區（Android adaptive icon 的可視圓形只有中間 66%，直接把 1024 圖塞進去邊緣會被裁掉——請確實處理內縮）
- splash 依 Capacitor 的 Android 慣例放置

做完在 `PROGRESS.md` 附上「產出了哪些檔、各是什麼尺寸」的清單（用 `sips -g pixelWidth -g pixelHeight` 實測，不要憑檔名宣稱）。

### D. 權限與 AndroidManifest

專案實際用到的 Capacitor 外掛只有這五個：
`@capacitor/geolocation`、`@capacitor/local-notifications`、`@capacitor/share`、`@capacitor-firebase/authentication`、`@revenuecat/purchases-capacitor`。

要做的事：

1. 讀 `app/NATIVE_PRIVACY_AND_PERMISSIONS.md`（本機參照檔，**不要 commit、不要引用內容進回報**），確認 iOS 那邊實際宣告了什麼權限、用途是什麼。
2. 依此決定 Android 的最小權限集。定位與通知是確定要的（開機自動定位＋發車本地提醒是既有功能）。
3. **`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` 特別小心**：Google Play 對它有政策限制，誤加會卡審查。請**實際查 `@capacitor/local-notifications` 8.2.1 的 Android 需求**（讀 `app/node_modules/@capacitor/local-notifications/android/` 底下的 manifest 與原始碼，**唯讀**），確認到底需不需要，把證據（檔案:行號）寫進 `PROGRESS.md`。需不需要都要有依據，不要憑印象加也不要憑印象不加。
4. 任何**外掛自己帶進來、但這個 App 用不到**的權限，列在 `PROGRESS.md` 的「可考慮 remove 的權限」一節，**先不要動手移除**（移除要驗功能沒壞，那是下一階段的事）。

### E. 補上 verify-release.mjs 的 Android 斷言

把上面〈已查證的現況〉第 1 點那行註解實作出來，讓 `npm run verify` 也會檢查 Android 的 `assets/public/index.html`。

**照著 iOS 那條既有的寫法改**，不要重新設計驗證機制。改完要證明它有牙：故意把該檔改壞（或暫時改名）跑一次 `npm run verify` 確認**變紅**，再還原確認**變綠**——兩邊都要在 `PROGRESS.md` 附上實際輸出。只跑綠的那次不算驗證。

### F. `android/` 的版控決策（已定案，照做）

`app/.gitignore` 第 3 行目前是整包 `android/`。**請改成比照 iOS 的細部忽略**——理由跟 iOS 一樣（專案本體進版控，CI 從 git clone 就能建；而且沒進版控的東西在這個 70+ 工作樹的環境很容易弄丟）。

保留忽略的應該是建置產物與機密，至少包含：

```
android/build/
android/app/build/
android/.gradle/
android/local.properties
android/app/google-services.json
android/app/*.jks
android/app/*.keystore
android/.idea/
android/captures/
**/.cxx/
```

在 `.gitignore` 裡用註解寫清楚理由（比照檔案裡 iOS 那段的寫法與語氣，中文）。

改完用 `git status --porcelain app/android | head -20` 與 `git check-ignore -v` 實際驗證：專案本體要顯示成 `??`（未追蹤但**不**被忽略），`android/build/` 之類要確實**還是**被忽略。**只看 `.gitignore` 的文字不算驗證，要用 `git check-ignore` 實測。**

### G. 編出 APK

```
cd /Users/xuxiang/Code/軌島-Android/app/android
./gradlew assembleDebug
```

回報 exit code、APK 完整路徑、檔案大小（`ls -lh` 實測）。並用 `unzip -l <apk> | grep -c 'assets/public'` 之類的方式證明 **web 資產真的被打包進去了**——「build SUCCEEDED」只代表編譯過，不代表內容對。

### H. 修 build 錯誤

同一個錯誤**最多修兩輪**。第三次動手之前先停下來，把「錯誤訊息 + 你試過什麼 + 你的假設」寫進 `PROGRESS.md` 並回報——不要無限重試，也不要為了讓它過而拿掉功能或降版套件。

### I. 平台差異盤點（不實作，只盤點）

產出 `docs/android/PLATFORM-GAPS.md`：掃過 `index.html`（在工作樹根目錄，很大，用 grep 找）與 `app/src/native-bridge.mjs`，把**iOS 專屬處理**逐一列出來，每項標註 Android 是否需要對應處理。

已知至少有這些方向，請自己再找完整（每項都要附 `檔案:行號`）：

- `Capacitor.getPlatform() === 'ios'` 的分支
- 音訊：iOS 上 `audio.volume` 被系統強制設回 1，所以音量滑桿在 iOS 失效（Android WebView 大機率沒這問題，請查程式碼確認目前怎麼處理的）
- 安全區 / 瀏海 / 手勢列的 CSS（`env(safe-area-inset-*)`）
- 鍵盤行為（iOS 鍵盤會蓋掉底部面板，程式碼裡有對應處理）
- 分享、定位、通知的權限請求時機

格式：一列一項，欄位 = `項目 | iOS 現況（檔案:行號）| Android 是否需要 | 建議做法 | 風險`。
**這份是給下一階段當工作清單用的，寫清楚比寫多重要。** 不確定的標「待驗」，不要猜一個答案填進去。

---

## 🛑 停下回報，不要自己想辦法繞過

碰到以下任何一項，**立刻停下該項、寫進回報，繼續做其他不受影響的任務**（不要卡死整輪，也不要用假資料硬推）：

1. `google-services.json`（Firebase Android 設定檔）——要從 Firebase Console 下載，只有使用者能拿。**不要產生假的、不要從 iOS 的 plist 轉。**
2. RevenueCat 的 `androidApiKey`——要 RevenueCat 後台。本階段不需要，留空即可。
3. 簽章 keystore、release build、Google Play Console——本階段完全不碰，`assembleDebug` 就好。
4. Esri App 金鑰的 Android package 白名單——要後台操作。
5. 任何需要帳號登入、或需要 `sudo`、或要下載安裝新開發工具的事。

---

## ✅ 驗收條件（逐條可檢查，都要在回報裡給證據）

| # | 條件 | 判準 |
|---|---|---|
| 1 | `cd app && npm run build` | exit 0 |
| 2 | `npx cap sync android` | exit 0 |
| 3 | `cd app/android && ./gradlew assembleDebug` | exit 0 且 APK 存在、`ls -lh` 大小合理（不是 0 bytes） |
| 4 | APK 內含 web 資產 | `unzip -l` 能看到 `assets/public/index.html` |
| 5 | `cd app && npm run verify` | exit 0 |
| 6 | 任務 E 的斷言有牙 | 改壞→紅、還原→綠，**兩次輸出都附上** |
| 7 | `.gitignore` 改對 | `git check-ignore -v` 實測：專案本體不被忽略、建置產物仍被忽略 |
| 8 | 圖示齊全 | `sips` 實測各密度尺寸清單 |
| 9 | 沒有動到不該動的 | `git status --porcelain` 的輸出貼在回報裡，且 `app/node_modules` 仍是 symlink（`ls -l` 證明） |
| 10 | 兩份文件存在 | `docs/android/PROGRESS.md`、`docs/android/PLATFORM-GAPS.md` |

**任何一條驗不了，就明說驗不了什麼、為什麼——不要假設成功，不要為了湊全綠而放寬判準。**

---

## 回報要求

- 只回：**結論、關鍵證據（檔案:行號 或 指令輸出關鍵行）、風險與未確定點**
- 上面驗收表逐條標 PASS / FAIL / 驗不了（附一行理由）
- 長產物寫進 `docs/android/PROGRESS.md` 與 `docs/android/PLATFORM-GAPS.md`，回傳路徑（**不要把全文貼進回報**）
- 明確列出「使用者接下來必須自己做的事」清單（就是〈停下回報〉裡實際擋到你的那幾項）
- 不要過程流水帳
- **再提醒一次：整輪都不要執行任何 git 寫操作。**
