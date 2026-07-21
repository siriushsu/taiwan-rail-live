# 軌島原生 App 工作區

這個目錄把根目錄的單檔網站包成 Capacitor App。網站仍維持「無 build step」；只有準備原生 App 時才進入本目錄執行指令。

## 目前完成狀態

- iOS／Android 共用的 Capacitor 8 工作區與固定版號依賴。
- App 內自帶網站程式、鐵道資料、Leaflet、fflate、固定版號 Firebase 與 Natural Earth 台灣海陸輪廓；沒有網路時仍能看到台灣、軌道與時刻表動畫，啟用帳號後也不會在 runtime 下載 Firebase JavaScript。Suno 音樂在授權核對完成前預設不打包。
- CARTO／Esri 商業授權未確認前，一般 App build 不建立或請求線上底圖，也隱藏衛星切換；App 仍以 Natural Earth 台灣輪廓呈現海陸形狀，不會退回米色空白畫面。
- 即時誤點與營運公告會連到 `https://railisland.tw/api/`，網站版仍使用原本的相對路徑。
- 原生定位、系統分享、Google／Apple 登入與 RevenueCat 訂閱（月訂／年訂）橋接。
- 登入後可同步最愛地點、最愛列車與完乘紀錄；Plus 訂閱後可用每班車誤點歷史統計、衛星底圖、進階定位與 Google Takeout 匯入等功能。
- Plus 訂閱、取消續訂、恢復購買、登入後續接原操作皆已有瀏覽器測試；錄影目前整體下架中（`RECORDING_ENABLED=false`），復開時另受逐首商用授權閘門保護。

`ios/` 已生成：完整的 Capacitor iOS Xcode workspace、CocoaPods 與同步後的 `App/App/public` 資產都在 repo 現場，Bundle ID 已定案為 `tw.railisland.app`。`android/` 尚未生成；在使用者確認前，不要執行 `cap add android`。每次改動根目錄網站後，都要 `npm run sync`（build + cap sync）讓 `app/www` 與 iOS `public` 一起更新到最新版號，否則發行包會落後。

## 仍需使用者決定或申請

1. 確認永久不變的 Bundle ID／Application ID（目前候選 `tw.railisland.app`）。
2. Apple Developer 與 Google Play Console 帳號、簽章與商店後台資料。
3. Plus 訂閱的月訂／年訂售價，以及 App Store／Google Play 的 auto-renewable subscription product ID。
4. Firebase project 與 RevenueCat project 的正式公開設定。
5. CARTO／Esri／國土測繪中心的商業與離線授權回覆。收到明確授權前，不做大量圖磚預下載；App 離線時使用內建的 Natural Earth 台灣輪廓。
6. 完成 `MUSIC_LICENSE_CHECKLIST.md` 的 29 首 Suno 曲目逐首核對；證據齊全以前不得把 `musicRecordingLicensed` 設為 `true`，也不得以 `RAIL_INCLUDE_LICENSED_MUSIC=1` 打包 App。

## 第三方設定

### Firebase

1. 建立 Firebase project，啟用 Authentication 的 Google 與 Apple provider、建立 Firestore。
2. 建立 Web app，把公開設定填入根目錄 `firebase-config.js`。這些識別資訊不是秘密；資料權限由 `firestore.rules` 控制。
3. 部署根目錄 `firestore.rules`。規則只允許本人讀寫三份同步文件，Plus entitlement 不允許前端寫入。
4. iOS 放入 `GoogleService-Info.plist`；Android 放入 `google-services.json`，並在 Firebase 登記正式簽章的 SHA-1。
5. Android 的 `android/variables.gradle` 加入 `rgcfaIncludeGoogle = true` 與 `androidxCredentialsVersion = '1.3.0'`，再執行 `npx cap update android`。
6. iOS 固定採 CocoaPods，不用 SwiftPM：目前 authentication 套件的 SwiftPM 宣告會把未使用的 Facebook SDK 一起連入。生成後在 `ios/App/Podfile` 的 `target 'App'`、`# Add your Pods here` 下加入 `pod 'CapacitorFirebaseAuthentication/Google', :path => '../../node_modules/@capacitor-firebase/authentication'`，再執行 `npx cap update ios`。
7. iOS 在 Xcode 加入 Google reversed client ID URL scheme 與 Sign in with Apple capability。
8. 確認 iOS `AppDelegate.swift` 的 `application(_:open:options:)` 會轉交 `ApplicationDelegateProxy.shared`。
9. iOS `Info.plist` 同時加入 `NSLocationWhenInUseUsageDescription` 與 `NSLocationAlwaysAndWhenInUseUsageDescription`；後者是 geolocation plugin 的 library 要求，但軌島不請求 Always 權限、也不開背景定位。完整文案與權限表見 `NATIVE_PRIVACY_AND_PERMISSIONS.md`。

### RevenueCat

1. 建立 `plus` entitlement。
2. 在 iOS／Android 商店各建立月訂與年訂兩個 auto-renewable subscription 商品；Web 端建立 RevenueCat Billing 並連接 Stripe，建立對應的月／年訂閱商品。
3. 把三個平台的月／年商品都映射到同一個 `plus` entitlement，並放進同一個 `plus` offering（package 慣例 identifier `$rc_monthly`／`$rc_annual`，或 packageType=MONTHLY／ANNUAL）；設為 current offering（或維持程式指定的 offering ID）。
4. 把各平台 public API key 與 entitlement／offering ID 填入根目錄 `revenuecat-config.js`。只有 iOS／Android key 時網站入口會保持隱藏；正式開放網站付款必須另有 Web Billing public key。`musicRecordingLicensed` 預設保持 `false`，完成逐首授權核對後才能改為 `true`。
5. 秘密金鑰與 webhook 驗證值不可放進 repo。App 與網站必須用同一個 Firebase uid 當 RevenueCat App User ID；現有橋接已處理登入、登出、購買與使用者明示的「恢復購買」。
6. 在 Cloudflare Worker runtime 設定 `FIREBASE_WEB_API_KEY`、`REVENUECAT_PROJECT_ID` 與 `REVENUECAT_V2_SECRET_KEY`。RevenueCat v2 key 只授予 `customer_information:customers:read_write`；刪除帳號流程會先驗證 Firebase ID token，再刪除同 uid 的 RevenueCat customer。

## 產生與同步原生專案

確認 Bundle ID 後，先把 `capacitor.config.json` 的 `appId` 改成最終值（已定案 tw.railisland.app），再執行：

```sh
cd app
npm install
npx cap add ios --packagemanager CocoaPods
npx cap add android
npm run sync
```

每次根目錄網站程式或資料更新後，重新執行：

```sh
cd app
npm run sync
```

`npm run build` 只重建 `app/www/`，不動原生專案。打包腳本採明確 allowlist，不會帶入 `TODO.md`、`火車頭/`、AGENTS.md、內部授權筆記或安全審查檔。

原生 App build 會移除網站頁尾的 Ko-fi／銀行贊助區；App 內數位功能只使用 App Store／Google Play 的原生訂閱購買，不提供外部付款 call to action。網站版贊助區不受影響。

一般 `npm run build` 會刻意排除 `suno musics/`，App 內也會隱藏音樂控制。只有在 29 首曲目的商用證明全部完成、`musicRecordingLicensed` 已設為 `true` 後，才可用下列指令建立含音樂版本：

```sh
RAIL_INCLUDE_LICENSED_MUSIC=1 npm run build
```

`release-policy.json` 是第二道不可繞過的發行閘門：逐首證據與設定未完成時，即使誤設環境變數，build 仍會直接失敗。線上底圖也必須逐項確認付費 App、Leaflet／Capacitor、錄影輸出與 attribution 權利，才能把政策欄位改為 `true`。

一般 build 同時停用 CARTO／Esri 線上底圖。收到適用於付費 App、Leaflet／Capacitor 與影片輸出的書面授權，並確認 attribution 後，才可建立含線上底圖版本：

```sh
RAIL_INCLUDE_LICENSED_BASEMAPS=1 npm run build
```

若音樂與底圖都已完成授權，可同時設定兩個環境變數；這些開關只控制 App build，網站版不受影響。大量預下載或內建圖磚仍需另外取得明確離線授權，不能因線上底圖開關已啟用就推定允許。

每次 build 結尾會自動執行發行檢查；也可對現有 `app/www/` 單獨執行 `npm run verify`。檢查會拒絕未授權功能、外部贊助內容、內部文件、未完成素材、符號連結、source map 與疑似伺服器密鑰。

build 會依鎖定版本產生 `third-party-notices.txt`，並只在 App 頁尾加入入口；網站原始頁尾不受影響。iOS／Android 原生依賴的 transitive acknowledgements 仍要在 archive／AAB 階段再核對。

## 上架前驗收

- 先部署新版 Worker，確認 Capacitor 的 `capacitor://localhost` 與 `https://localhost` 能讀取正式 API；只 push main 不會更新正式站。
- iPhone 真機驗 Google／Apple 登入、刪除帳號、原生定位、到站／離站通知、系統分享與背景／鎖屏中斷處理。
- 付費版文案與錄影含音樂測試前，核對 29 首音樂皆是在 Suno Pro／Premier 有效訂閱期間由使用者生成，並留存生成頁或帳單證明。
- App Store sandbox 與 Google Play internal testing 各驗首次訂閱、取消續訂、離線啟動、換機後恢復購買。
- 斷網啟動時確認台灣輪廓、軌道與列車可用；授權核對完成並建立含音樂版本後，再確認內建音樂可用。CARTO／Esri 圖磚缺少時不能出現米色空白畫面。
- 準備隱私權政策、服務條款、支援網址、帳號刪除說明、商店截圖與審查備註。
- 隱私權政策、商店資料揭露與服務條款初稿已在本目錄；公開前必須由使用者確認聯絡信箱、售價與最終服務供應商。
- 原生權限、SDK 資料流與 privacy manifest 的 binary 驗證底稿在 `NATIVE_PRIVACY_AND_PERMISSIONS.md`；iOS 固定用 CocoaPods Google-only 路徑，避免把未使用的 Facebook SDK 帶進 App。
- 商店文案、審查備註、逐項送審檢查表與無個資的 Google 匯入審查範例也已在本目錄；送審時必須替換所有 placeholder，且只保留該 build 實際可用的功能。
- App Store／Google Play 的公開 Support URL 使用 `https://railisland.tw/app-support.html`。
- Google Play 的 App 外帳號刪除網址使用 `https://railisland.tw/account-deletion.html`；它會帶使用者回網站登入並執行與 App 相同的完整刪除流程。
- App Store Connect 說明軌島不是單純網站殼：含原生定位、到站／離站通知、跨裝置同步、離線鐵道資料、原生訂閱購買與 Google 清單匯入。
