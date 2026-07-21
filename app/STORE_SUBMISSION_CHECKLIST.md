# 軌島商店送審檢查表

> 每次 TestFlight／Play internal build 都從頭核對。勾選只代表該次 build 有直接證據，不可沿用舊版推定。

官方規範入口（送審當天再重讀一次）：

- Apple App Review Guidelines：https://developer.apple.com/app-store/review/guidelines/
- Apple 帳號刪除：https://developer.apple.com/support/offering-account-deletion-in-your-app
- Apple App Privacy：https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Apple 必填 metadata：https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties
- Google Play Data safety：https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play 帳號刪除：https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play 付款：https://support.google.com/googleplay/android-developer/answer/10281818

---

## 🔴 登入版 v1：執行順序與三個陷阱（2026-07-17 安全稽核產出）

> 這些「送審會被退」的項目**全部是登入功能的附屬要求**：4.8 只在有第三方登入時觸發、5.1.1(v) 只在有帳號建立時觸發。
> 決定：第一版含登入。以下按**依賴順序**執行，順序錯會踩陷阱。標記 `[外部]`=只有你能在帳號/後台做，`[程式]`=改碼。

### 步驟 0（硬前提）：Apple Developer 帳號
- [ ] `[外部]` 加入 Apple Developer Program（$99/年）。**這是共同鑰匙**：沒有它連 App 都送不了審，而且它才能開 Sign in with Apple。在此之前下面 Apple 相關步驟全部做不了。

### 步驟 1：Sign in with Apple（Guideline 4.8，三層都要，缺一即退）
- [x] `[外部]` Apple Developer 後台：App ID `tw.railisland.app` 開啟 **Sign in with Apple** capability。（2026-07-20 完成，Team `UCD3GAKML6`）
- [x] `[程式]` entitlements 接線（2026-07-20 改為直接改檔完成，未走 Xcode GUI）：`App/App.entitlements`（applesignin）＋pbxproj 兩個 config 的 `CODE_SIGN_ENTITLEMENTS`；sim build 驗證 `App.app-Simulated.xcent` 含 applesignin。備份在 `app/src/ios-patches/`（ios/ 重生後照 README 蓋回）。⚠️ 真機建置前 Xcode 的 Team 要選 `UCD3GAKML6`（sim 建置抓到的前綴 39273ZKKXW 疑為個人 team，免費 team 簽不了 applesignin）。
- [x] `[外部]` Firebase Console → Authentication → **Apple provider 已啟用**（2026-07-20）。註：iOS 原生流程不需 Service ID/.p8；**只有網站版 Apple 登入（web OAuth）才需要**——網站帳號入口復活時再建 Service ID＋Key 補進 Firebase。
- [ ] `[程式]` `firebase-config.js` 的 `RAIL_APPLE_LOGIN = false` → `true`。（放最後，見步驟 3；verify-release 已有半套登入 gate 擋忘記）
- 現況：Google 登入 iOS 端已完整接好（正式 GoogleService-Info.plist、REVERSED_CLIENT_ID URL scheme 都在）；缺的只有 Apple 這一路。

### 步驟 2（⚠️ 陷阱一）：帳號刪除 secrets 必須在 RevenueCat 之前
- [ ] `[外部]` **先**在 Cloudflare 設好 Worker 三個 secret（值自 Firebase／RevenueCat 後台取得）：
      ```
      npx wrangler secret put FIREBASE_WEB_API_KEY
      npx wrangler secret put REVENUECAT_PROJECT_ID
      npx wrangler secret put REVENUECAT_V2_SECRET_KEY
      ```
      設好後 `curl -X POST https://railisland.tw/api/account-delete` 應回 **401**（不再是現在的 503）。
- [ ] `[外部]` **之後才**填 `revenuecat-config.js`（設 iosApiKey 等）。
- **為什麼是這個順序**：今天刪帳號正常，只因 RevenueCat=null 會跳過那個端點。一旦先填 RevenueCat／iosApiKey，`plusProjectConfigured()` 翻 true，刪帳號就會呼叫 `/api/account-delete`；若 Worker secrets 還沒設 → 回 503 → 前端 throw → **帳號刪不掉**（Apple 使用者更慘：Apple token 在呼叫前已撤銷，留下「授權撤銷＋帳號沒刪」的破碎狀態）→ 直接違反 5.1.1(v)。

### 步驟 3：翻開登入開關（放最後，等上面後端都就緒）
- [ ] `[程式]` `index.html` 的 `ACCOUNT_ENABLED = false` → `true`（現在提早翻只會載入 Firebase 打一個 Apple 還沒配好的登入，把站弄壞）。
- [ ] `[程式]` 上兩個旗標與 RevenueCat 都就緒後，`npm run build && npx cap sync` 重建 App bundle。

### 步驟 4（⚠️ 陷阱二）：別被 app/www/ 舊副本騙過綠燈
- 檢查登入設定要看**重建後**的 `app/www/`，不是舊副本。建議 `verify-release.mjs` 加一條 gate：若 `ACCOUNT_ENABLED=true` 但 `RAIL_APPLE_LOGIN!=true` 就中止（半套登入＝被退主因）。這條 gate 我可以在你翻開關那輪一起加。

### 步驟 5（⚠️ 陷阱三，已修一半）：release 缺 plist 靜默壞
- [x] `[程式]` AppDelegate 已改為「DEBUG 才用占位、release 缺 plist 直接 fatalError」（2026-07-17）——避免乾淨 checkout（`ios/` 為 gitignored）漏帶 plist 卻靜默出貨登入全壞的 App。**注意此改動在 `ios/`（gitignored），未進 git；若 `cap add ios` 重生會遺失，需重套。**

### 步驟 6：隱私與文案（含登入版，多數已就位）
- [x] `[程式]` privacy.html 已補第四類同步資料「最愛車站」（2026-07-17）。
- [ ] 送審前確認 `STORE_DATA_DISCLOSURES.md`／App Privacy 問卷宣告的 Email／Name／User ID 與實際登入版一致（現有 drafts 已按登入版寫）。

### 步驟 7：真機端到端 QA（讀碼替代不了）
- [ ] `[你]` 真機測完整鏈：Google 登入、Apple 登入、取消登入、登出、重新登入、同步、**刪帳號＋Apple token 撤銷**（`accountDelete` 的 Apple revoke 路徑在拿不到憑證時會 throw，必須真機驗過）。

### 未涵蓋（本次稽核盲區，登入版前一併處理）
- iOS google-signin 自訂 URL scheme 理論上可被同機惡意 App 搶註（Google SDK 以 idToken 綁定緩解，風險低）。
- RevenueCat 伺服器端 entitlement/webhook 目前不存在，Plus 純 client 判定（賣 Plus 前評估是否需要）。
- Android 專案尚未 scaffold。

---

## 不可逆識別與帳號

- [ ] Bundle ID／Application ID 已由使用者確認：`[FINAL_APP_ID]`
- [ ] Apple Developer、App Store Connect 與 Google Play Console 的個人／組織身分資料一致
- [ ] App 名稱、SKU、預設語言與發行國家已確認
- [ ] 公開 support／privacy 聯絡信箱已建立並可收信
- [ ] 開發者帳號使用的私密管理信箱與商店公開客服信箱分離

## 原生 build

- [ ] iOS／Android 專案從目前鎖定的 Capacitor 版本生成並 commit
- [ ] iOS 以 CocoaPods 生成，Firebase Authentication 只加入 Google subspec；archive 不含 Facebook SDK
- [ ] iOS deployment target、Android min／target SDK 符合當期商店規定
- [ ] iPhone 360／375／414、iPad 768 與實際 Android 手機／平板版面驗證
- [ ] iOS PrivacyInfo.xcprivacy 與所有第三方 SDK privacy manifests 實際掃描
- [ ] Xcode Privacy Report 與 `NATIVE_PRIVACY_AND_PERMISSIONS.md` 逐項核對；Android merged manifest／依賴樹另存證據
- [ ] Android Data safety 依最終 binary／SDK 重做，不只照草稿填
- [ ] 正式 build 關閉 debug logging，不含測試 API key、密碼、收據或內部文件
- [ ] `npm run build:verify` 通過；其結果與該次 archive／AAB 使用的 `app/www/` 完全相同
- [ ] App 頁尾的第三方軟體授權可開啟；CocoaPods／Gradle transitive dependency acknowledgements 也已核對
- [ ] `app/www/` 不含 `TODO.md`、`火車頭/`、AGENTS.md、內部授權／安全筆記
- [ ] 未完成 Suno 授權時，`app/www/suno musics/` 不存在且音樂控制隱藏

## Firebase 與登入

- [ ] Firebase production project 已建立，Google／Apple provider 已啟用
- [ ] iOS `GoogleService-Info.plist` 與 Android `google-services.json` 僅使用正式 app id
- [ ] Android 正式簽章 SHA-1／SHA-256 已登記
- [ ] iOS Sign in with Apple capability、Google reversed client URL scheme 與 AppDelegate callback 已驗
- [ ] Google 登入、Apple 登入、取消登入、登出、重新登入均在真機測過
- [ ] 同步衝突、離線修改、前景恢復與換機同步均測過
- [ ] 不登入、拒絕登入與拒絕定位時，核心地圖仍完整可用

## 帳號刪除與隱私

- [ ] App 內可找到完整帳號刪除，不是只停用帳號
- [ ] 刪除前重新驗證；取消重新驗證不會刪任何資料
- [ ] RevenueCat customer 刪除失敗時 fail closed，Firebase 帳號與文件仍保留
- [ ] 成功刪除 Firebase Auth、三份同步文件、RevenueCat customer 與目前裝置私人收藏
- [ ] `https://railisland.tw/account-deletion.html` 在未安裝 App 的手機可完成流程
- [ ] `https://railisland.tw/privacy.html` 為公開、非 PDF、無登入牆且內容與 Data safety／App Privacy 一致
- [ ] `https://railisland.tw/app-support.html` 可用且不要求使用者在公開 Issue 張貼個資
- [ ] 隱私政策列出開發者、資料類型、用途、供應商、安全、保存／刪除與聯絡管道

## Plus 與商店付款

- [ ] 訂閱售價（月訂／年訂）與不可變 product ID 已確認
- [ ] iOS／Android 自動續訂訂閱商品都映射到 RevenueCat `plus` entitlement／`plus` offering（含 monthly／annual 兩個 package）
- [ ] iOS App 內沒有網站付款連結、價格比較或繞過 StoreKit 的 call to action
- [ ] Android App 內數位功能購買只走 Google Play Billing
- [ ] App bundle 不含網站版 Ko-fi／銀行贊助區；網站版是否保留不影響原生 build
- [ ] 首次訂閱、取消續訂、pending、付款失敗、退款後失權、恢復購買與換機均用 sandbox／license tester 實測
- [ ] 網站 Web Billing 與 App 使用同一 Firebase uid，可跨平台恢復 entitlement
- [ ] 刪除帳號不宣稱會刪商店依法保留的交易紀錄，也不自動承諾退款

## 地圖、音樂與內容授權

- [ ] 最終一般底圖、衛星底圖、錄影輸出、商業 App 與 attribution 均有可保存的授權依據
- [ ] 未獲書面允許前不做圖磚大量預下載或低縮放衛星圖包
- [ ] `release-policy.json` 的授權欄位只依可保存的書面證據調整，不以環境變數或口頭推定代替
- [ ] 未完成線上底圖授權時不使用 `RAIL_INCLUDE_LICENSED_BASEMAPS=1`；確認 App runtime 沒有 CARTO／Esri 圖磚請求且衛星按鈕隱藏
- [ ] 離線 fallback 使用 Natural Earth public-domain 台灣輪廓，attribution 正確
- [ ] 29 首 Suno 曲目全部完成 `MUSIC_LICENSE_CHECKLIST.md`
- [ ] 每首都證明在 Pro／Premier 有效期間生成；extension／remix／上傳素材另查原始權利
- [ ] 未完成音樂核對時不設 `musicRecordingLicensed:true`，也不使用 `RAIL_INCLUDE_LICENSED_MUSIC=1`
- [ ] 商店截圖與描述不出現尚未取得授權或尚未開放的內容

## 功能與媒體驗收

- [ ] 核心資料載入完成後才判定首屏與 CLS
- [ ] 360／375／414／768 寬度掃所有控件交疊、viewport overflow 與 `elementFromPoint`
- [ ] 手機使用 `isMobile + hasTouch + tap`，並含全畫面、橫幅、抽屜、sheet 狀態矩陣
- [ ] iPhone WKWebView 真機錄影：有聲／靜音、開始／停止、背景、鎖屏、來電中斷與分享
- [ ] Android WebView 真機錄影與分享
- [ ] 斷網冷啟動仍看到台灣、軌道與列車；即時 API 失敗不阻斷核心畫面
- [ ] 原生定位只在使用者動作後請求；拒絕／永久拒絕時有可理解的退路
- [ ] iOS 只有 When In Use 實際授權、沒有背景定位；Android 只有 coarse／fine、沒有 background／媒體／儲存權限
- [ ] App Store 4.2 審查備註已列出原生定位、分享、IAP、離線資料、同步、刪除與媒體輸出

## 商店素材與送出

- [ ] 商店文案與該 build 功能完全一致，清楚揭露位置為時刻表推演
- [ ] App Store iPhone／iPad 與 Play phone／tablet 截圖尺寸符合當期規定
- [ ] 每張地圖截圖保留必要 attribution
- [ ] Support URL、Privacy URL、Account deletion URL 皆從外網與手機複驗
- [ ] App Review Notes 已替換所有 `[PLACEHOLDER]` 並附測試路徑／必要文件
- [ ] IAP 商品與 app version 依當期 App Store Connect 流程一併送審
- [ ] Play Data safety、content rating、target audience、ads、app access 與 account deletion 問卷完成
- [ ] 上傳後以 TestFlight／internal testing 下載商店簽署的實際 binary 再做一次完整驗收
