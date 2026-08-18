# 派工：軌島 Android 階段二——讓 App 真的跑起來並驗證

## 🔴 鐵則

1. **你是這輪的負責人**。要開子 agent 分工沒問題（矩陣驗證那種可平行的活特別適合），但每個子 agent 的 prompt **第一行**就要帶上鐵則 2、3、4；埋在中段的禁令視同不存在。子 agent 宣稱「我驗過了」的事實，你要自己抽測——它的驗證宣稱本身也可能是假的。
2. **只在 `/Users/xuxiang/Code/軌島-Android` 這棵樹裡工作**。這台機器上有 74 棵並行工作樹，絕對不要進入任何其他 `軌島-*` 或 `捷運小動畫` 目錄。
3. **git：本樹內可以 commit，但絕對不准 `push`、不准 `rebase`、不准改寫既有歷史、不准碰其他樹的分支。** commit 時：
   - **不要帶 pathspec**（`git commit -m "..."` 就好）。帶 pathspec 會改用工作樹內容、繞過你 staged 的東西。
   - commit 前先 `git diff --cached --stat`，commit 後比對 `git show --numstat HEAD`，**數字不符代表收到了不該收的東西**，`git reset --soft HEAD~1` 重來。
   - 若 `.git` 是唯讀導致 commit 失敗（會看到 `Operation not permitted`），**停下回報、把變更留在工作樹**即可，不要想辦法繞過。
4. **`app/node_modules` 是 symlink**（指向 `/Users/xuxiang/Code/捷運小動畫/app/node_modules`）。不要 `npm install`、不要 `npm ci`、不要 `rm`——動了會同時炸掉其他工作樹。
5. **隨做隨落檔**：每完成一項就更新 `docs/android/PROGRESS-STAGE2.md`。連線斷掉時那份檔案是唯一存活的成果。
6. `app/release-policy.json` 與 `app/NATIVE_PRIVACY_AND_PERMISSIONS.md` 不准 commit、不准把內容貼進回報。

## 現況

階段一已完成並 commit 在 `c42c4dd`（分支 `feat/android-shell`），工作樹乾淨。debug APK 可正常產出：
`app/android/app/build/outputs/apk/debug/app-debug.apk`，17,455,919 bytes，`tw.railisland.app` 1.3.2 (1)，compileSdk 36。

**你在階段一產出的 `docs/android/PLATFORM-GAPS.md` 就是這一輪的工作清單**，先完整讀它。

## 目標與動機

**「BUILD SUCCESSFUL」只證明編譯過，不證明 App 能跑。** 這一輪要拿到的是「它在真正的 Android 上開得起來、核心功能可用」的證據，以及把 `PLATFORM-GAPS.md` 裡標「待驗」的項目逐一變成「已驗」或「已知缺陷」。

動機講清楚方便你取捨：這個專案過去被**假綠**咬過很多次——headless 環境不跑 rAF、模擬器不渲染捲軸、computed style 顯示正常但元素其實被裁掉。所以本輪的判準一律要求**像素級或端到端證據**，不接受「computed style 正常」「元素 rect 在畫面內」這類間接推論。

---

## 任務

### A. 準備執行環境

1. 先 `adb devices` 看有沒有**實體 Android 裝置**。有的話優先用實體機（模擬器有已知的渲染與感測器假象）。
2. 沒有實體機才建 AVD。**建之前先 `df -h` 檢查磁碟**——系統映像檔約 5–8GB，若可用空間低於 20GB 就停下回報，不要硬下載。
3. AVD 建議用接近主流的規格（Pixel 系列、API 34 或 35）。**API 選擇要寫進 `PROGRESS-STAGE2.md` 並說明理由。**

### B. 冷啟動：它到底開不開得起來

安裝 debug APK 並冷啟動。**特別注意：這個 build 沒有 `google-services.json`**（Firebase Android 設定檔，需要使用者從 Console 下載）。

要回答的問題，每個都要有證據：

1. App 會不會 crash？完整抓 `adb logcat` 的例外堆疊。
2. 若不 crash，Firebase 相關程式碼是怎麼降級的？（memory 記載帳號入口 `ACCOUNT_ENABLED=false`，理論上不該擋開機——實測確認）
3. **地圖有沒有真的畫出來？** 用截圖確認，並且要證明畫面上**有列車**（不是只有底圖）。截圖存進 `docs/android/shots/`。
4. 首屏到可互動花多久？

### C. 兩個「光看程式碼就能斷定」的缺陷

`PLATFORM-GAPS.md` 標了兩項 **需要修正**，這輪處理：

**C-1 音量滑桿被一刀切**
`index.html:2902-2912` 對「iOS 或任何 native App」都加 `music-volume-unavailable`，CSS `:445-446` 據此隱藏滑桿。iOS 這樣做是對的（iOS 播放後會把 `audio.volume` 強制設回 1，滑桿真的失效）；但 Android WebView 未必有這個問題。

🔴 **順序不可顛倒**：**先在真 Android 上實測** `audio.volume` 到底有沒有被強制設回 1（播放後設 0.3，隔一段時間回讀，並實際聽/量音量），**拿到結果才決定要不要改**。不准憑「Android 應該沒問題」的推論就改——這個專案吃過「在自己引擎重現不了就出貨猜的修法」的虧，連錯三次。

實測若證實 Android 正常，才把平台 class 從 `nativeApp` 一刀切改成只對 iOS 加；改完要在 Android 與 iOS 兩邊都驗（iOS 那邊至少要證明你沒動到它的行為）。

**C-2 定位被拒後顯示 iOS 文字**
`index.html:6214-6229` 依 UA 顯示指引，原生 Android 被拒絕時會顯示「網址列旁圖示」——App 裡根本沒有網址列。`native-bridge.mjs:45-47` 的 `openSettings` 目前是 null。

這輪只要把**文案**改對（原生 Android 給正確的「系統設定 → 應用程式 → 權限」路徑指引）。**不要**為了這個去加原生 `openSettings` 方法——那是新增原生介面，屬下一階段，且要評估審核面。

### D. 真機驗證矩陣

`PLATFORM-GAPS.md` 裡標「待驗」的逐項驗證，每項的結論要更新回那份表（把「待驗」改成實測結果）。至少涵蓋：

- **安全區 / edge-to-edge**：挖孔螢幕、三鍵導覽與手勢導覽各測一次。要證明頂部沒被狀態列蓋、底部 tab bar 沒被手勢列蓋——**用截圖，不要只讀 CSS `env()` 的值**。
- **鍵盤**：開搜尋、打字、旋轉、按返回鍵收鍵盤。確認搜尋結果沒被 IME 蓋住。
- **定位權限流程**：首次啟動同意 / 拒絕 / 只給粗略位置，三條路各走一次。確認開機的定位詢問**不會擋住地圖載入**。
- **分享**：分享目前畫面與行程，測取消、以及沒有可接收 App 的情況。
- **in-app-browser 誤判回歸**：Android App 內**不應**出現「用瀏覽器開啟」的逃生提示（`index.html:17136-17157` 已用 `Capacitor.isNativePlatform()` 排除）。實際確認它沒跳出來。
- **地圖 pinch 縮放**：確認可用，且頁面本身不會被 pinch 縮放。

### E. 手機尺寸 UI 掃描

這個專案有一條明確鐵則：**新功能必驗手機版**。請在 **360 / 375 / 414 / 768** 四個寬度各做一次：

1. 全控件**相交掃描**（量 `getBoundingClientRect`，程式化比對有無重疊，不要裸眼看截圖）。
2. 每個可點控件做 **`elementFromPoint` 命中測試＋真實觸控**——「按鈕在正確位置」不等於「點它會發生正確的事」。這個專案踩過：兩顆並排鈕的 `::after` 熱區都撐成整條列，結果點哪裡都開到同一個面板，而幾何檢查完全正常。
3. 有偽元素熱區（`::before` / `::after`）的控件要**橫掃整列**看熱區分段。

發現的問題先記錄，**不要順手修**——除非它是 C-1／C-2 那兩項。其餘寫進 `PROGRESS-STAGE2.md` 的「待處理」，由使用者決定優先序。

---

## 🛑 停下回報，不要自己想辦法繞過

1. `google-services.json`、RevenueCat `androidApiKey`、簽章 keystore、Play Console——**全部要使用者的後台操作**。不要產生假的、不要從 iOS 的 plist 轉、不要沿用 iOS 的 key。
2. 磁碟不足 20GB。
3. 需要 `sudo`、需要帳號登入、需要安裝新的開發工具。
4. 任何需要 `git push` 或碰到其他工作樹的情況。
5. 同一個問題修兩輪還沒解決——**第三次動手前先停下回報**，寫下「錯誤訊息＋試過什麼＋你的假設」。

---

## ✅ 驗收條件

| # | 條件 | 判準 |
|---|---|---|
| 1 | App 冷啟動不 crash | `adb logcat` 無未捕捉例外；有則附完整堆疊 |
| 2 | 地圖與列車真的畫出來 | 截圖為證，且要指出畫面上哪些是列車 |
| 3 | C-1 的 Android `audio.volume` 行為 | **實測數據**（設定值 vs 回讀值），不是推論 |
| 4 | C-1 若有改 | Android 與 iOS 兩邊都驗；iOS 要證明行為沒變 |
| 5 | C-2 文案改對 | Android App 內截圖，不含「網址列」字樣 |
| 6 | `PLATFORM-GAPS.md` 的「待驗」清零 | 每項變成實測結論或明確的已知缺陷 |
| 7 | 四個寬度的相交掃描 | 程式化量測輸出，非裸眼 |
| 8 | 每個控件的觸控命中 | `elementFromPoint` + 真觸控，逐一列出 |
| 9 | `npm run verify` 仍過 | exit 0 |
| 10 | 沒動到不該動的 | `git status --porcelain` 輸出；`app/node_modules` 仍是 symlink（`ls -l` 證明） |

**任何一條驗不了，明說驗不了什麼、為什麼——不要假設成功，不要為了湊全綠而放寬判準。**

## 回報要求

- 只回：**結論、關鍵證據（檔案:行號、指令輸出關鍵行、截圖路徑）、風險與未確定點**
- 驗收表逐條標 PASS / FAIL / 驗不了（附一行理由）
- 長產物寫進 `docs/android/PROGRESS-STAGE2.md` 並更新 `docs/android/PLATFORM-GAPS.md`，回傳路徑，不要貼全文
- 明確列出「使用者接下來必須自己做的事」
- 若有 commit，附 commit hash 與 `git show --numstat HEAD` 的最後一行
- 不要過程流水帳
