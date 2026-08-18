# 軌島 Android 出貨路徑決策單

更新時間：2026-08-09 20:35（Asia/Taipei）

## 已完成的出貨基線

- Android release 版號為 `tw.railisland.app`／`versionName 1.4.1`／`versionCode 1`。
- release AAB 與 APK 均已由 upload key 簽章；APK 憑證 DN 的 CN 為 `railisland-upload`，AAB 驗證結果為 `jar verified`。
- 正式底圖 build、Android asset copy、Android-only release gates、`bundleRelease`、`assembleRelease` 均成功。
- Pixel 7／API 35 已安裝真正的 release APK：冷啟動、地圖／列車、定位同意、Firebase 初始化、三底圖與 44×44 最小集皆通過。
- AAB：`app/android/app/build/outputs/bundle/release/app-release.aab`。
- APK：`app/android/app/build/outputs/apk/release/app-release.apk`。
- 本文件不代表已上傳 Play Console；Play 帳號與 Console 操作仍由帳號持有人執行。

## Android 通行證入口的 release 實況

### 露出位置與控制鏈

- `index.html:6188-6190`：原生 App 的 `PLUS_ENABLED` 恆為 true，因此 Android 也會顯示通行證觸發面。
- `index.html:7622`：桌面工具列的「通行證」按鈕呼叫 `plusOpen('toolbar')`。
- `index.html:7628-7630`、`index.html:16693-16695`：手機「更多」內的「軌島通行證」列代理同一顆 `#accountBtn`，最後也呼叫 `plusOpen`。
- `index.html:7779-7788`：真正能不能買由 `plusConfigured()` 判斷；原生 adapter 不存在時為 false。
- `app/src/native-bridge.mjs:80-86`：只有目前平台存在對應 RevenueCat public SDK key 時才建立 `RAIL_NATIVE_PLUS_ADAPTER`。
- `index.html:8015-8074`：adapter 不存在時不畫月票、年票、購買或恢復購買鈕，只畫無購買通道說明。
- `index.html:8261-8264`：若有購買通道，月／年票與恢復購買才會分別進 `plusPurchase`／`plusRestore`。

### release 真實點擊結果

在 Pixel 7／API 35 的已簽章 release APK，以 WebView 真實 DOM click 分別觸發兩個產品入口：

1. 工具列 `#accountBtn`：面板有開啟，沒有報錯、沒有無反應、沒有跳 Web。
2. 手機「更多」→「軌島通行證」：sheet 正常關閉、面板有開啟，沒有報錯、沒有無反應、沒有跳 Web。

兩次結果相同：`PLUS_ENABLED=true`、`plusProjectConfigured=true`，但 `plusConfigured=false`、`RAIL_NATIVE_PLUS_ADAPTER` 不存在。面板內月票鈕 0、年票鈕 0、恢復購買鈕 0；唯一可按的是「已經在 App 訂閱了？登入以同步」。使用者仍會看到「目前請在軌島 App 內訂閱」、App Store 取消訂閱文案與 iOS 動態島功能敘述。結論是 Android 目前**看得到通行證，但買不到也恢復不了**；不應把這個狀態描述成 RevenueCat Android 已接好。

### 暫時 gate Android 購買入口的估算（本輪不實作）

最小且不漏入口的做法是在 `index.html:6188-6190` 的原生平台分支對 Android 回 false，讓 `PLUS_ENABLED` 在 Android 關閉。產品碼約 1–3 行；再補 verifier 的正／負樣本與 release UI 回歸，總改動約 15–30 行、約 0.5 天。這會連 Android 的通行證 teaser、誤點履歷付費 CTA、說明中心入口一併隱藏，但不影響免費地圖、列車與 30 天彙總。

只在 `index.html:7665` 隱藏工具列／「更多」槽位約 1–3 行雖更小，卻會漏掉帳號面板、誤點履歷、說明中心與其他 `plusGateOpen` 呼叫點，不建議用作 Play 合規 gate。

## 路徑 A：Google Play internal testing

### 剩餘工作

1. 在以下兩者選一：
   - 接好 Play Billing（RevenueCat Android）：建立／對應 Play 月票與年票、RevenueCat Android app 與 entitlement、Android public SDK key、Play service credentials，完整驗購買／恢復／取消／到期／退款與 webhook 資格落地。
   - 暫時 gate Android 通行證：採上節的 `PLUS_ENABLED` 平台 gate，重建並重跑 release 回歸。
2. 帳號持有人在 Play Console 建立 App、填 store listing、App content、Data safety、隱私權政策、測試人員名單，並上傳 AAB；本 repo 不代做 Console 操作。
3. 發佈 internal track，取得 opt-in link，讓測試者逐一加入並安裝。internal testing 最多 100 人；已發佈後，更新通常在數分鐘內到達測試者。
4. 測 internal 版的 Play 安裝、升級、Firebase 登入、底圖、定位、通知、Play Billing 或 gate 後 UI。
5. 升 closed／production 前，確認帳號是否受「新 personal account：closed test 至少 12 人連續 14 天」門檻約束；以 Console 顯示為準。

### 預估時程

- 採 gate：程式、release 重建與回歸約 0.5 天；Play Console 首次資料準備約 0.5–1 天；internal release 發佈後通常數分鐘可測。
- 接 RevenueCat Android：工程與後台串接約 3–7 個工作天，再加 internal 測試 1–2 天。
- closed／production 首次審查經驗值抓 1–7 天，但不是承諾；新 personal account 若命中上述規則，另有至少 14 天 closed test，最終以 Console 實際要求為準。

### 風險

- production 前必須「Play Billing／合規替代方案接好」或「隱藏購買入口」二選一。Google Play 一般要求 Play 發佈 App 的數位功能與訂閱使用 Play Billing；特定地區替代方案須另行加入方案並遵守附加規則，不能預設自動適用。
- 目前 release 的 Android 通行證面板仍寫 App Store／iOS 功能；即使沒有付款鈕，也會造成審查與使用者理解風險。
- `versionCode` 仍為 1；第一次上傳可用，之後每次 Play 更新都必須遞增。
- upload keystore、alias 與兩組密碼遺失會讓後續更新非常麻煩；必須保存在密碼管理器並做異地備份。

官方依據：

- [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en-EN)
- [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)

## 路徑 B：官網 sideload APK

### 剩餘工作

1. 將 release APK 放到官方 HTTPS 網站，提供檔案大小、版本、SHA-256、更新日期與安裝教學。
2. 說明 Android 8+ 必須對瀏覽器／檔案管理器允許「安裝未知的應用程式」，並建議安裝後關回權限。
3. 決定現有通行證面板如何處理。雖然不受 Google Play Payments policy 的 Play 發佈限制，仍建議先 gate 或改成明確的「Android 尚未開放」，避免 App Store 文案與死路徑。
4. 建立人工版本發布與下載頁更新流程；目前 App 內更新提示仍在另一分支，尚未上線。

### 預估時程

- APK 已可用；若沿用現狀，建立下載頁、校驗碼與安裝說明約 2–4 小時，今天可發。
- 若先加 Android gate 並重跑 release 回歸，約再加 0.5 天。

### 風險

- 使用者會遇到未知來源警告／逐來源授權，轉換率與信任感低於 Play。
- 沒有自動更新；每次新版本都要重新下載、手動覆蓋安裝，且簽章必須永遠沿用同一把 release key。
- 需自己負責下載主機、完整性說明、版本通知與交易／退款流程。

官方依據：

- [Publish your app outside a marketplace](https://developer.android.com/studio/publish)
- [Alternative distribution options](https://developer.android.com/distribute/marketing-tools/alternative-distribution)
- [Google Play Payments policy FAQ（Play 外可自行散佈）](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)

## 路徑 C：暫不對外

### 剩餘工作

1. 完成 RevenueCat Android／Play Billing 的後台、public SDK key、月／年訂閱與完整生命週期測試。
2. 修復已知橫向 IME：橫向且鍵盤開啟時搜尋框／結果會被壓到鍵盤後方。
3. 再升 `versionCode`、重出 AAB／APK、重跑簽章／內容／release 模擬器回歸。
4. 完成 Play Console 上架資料與 closed／production 流程。

### 預估時程

- RevenueCat Android／Play Billing 約 3–7 個工作天。
- 橫向 IME 修復與跨寬度回歸約 1–2 個工作天。
- 整體工程與 QA 約 5–10 個工作天；另加 Play 測試門檻與審查時間。

### 風險

- 延後公開會錯過原訂曝光時點，但能避免先發一個買不到通行證、橫向搜尋仍有已知缺陷的版本。
- Billing、Firebase、RevenueCat 與 Play Console 涉及多個後台；時程最大不確定性是帳號權限、產品／base plan 狀態與審查，而不是目前的 Android shell build。

## 建議

如果目標是最快取得真實 Play 安裝與升級證據，先做 **Android Plus gate → Play internal testing**。它只需半天級改動，又能保留目前已通過的 release 基線；internal 可先驗商店散佈，不必假裝 Billing 已完成。等 RevenueCat Android 完整接好後，再以遞增的 `versionCode` 發第二顆 internal／closed build。

如果今天一定要對外，sideload 技術上已可行，但至少先處理 Android 通行證的 App Store／iOS 誤導文案，並清楚揭露沒有自動更新。若品質優先，選路徑 C，連橫向 IME 一起收斂後再公開。
