# Google Play Data safety 填答對照表（Android 1.4.11／versionCode 16 草稿）

> 盤點日期：2026-08-26。適用候選產物：`tw.railisland.app`、`versionName 1.4.11`、`versionCode 16`，採 Google Play Billing＋RevenueCat Android 通行證。這是尚未送進 Console 的填答草稿；正式 AAB、商店商品與 RevenueCat 尚未完成前不可把本表當成已提交事實。Console 欄位文字若改版，以送出當日畫面為準。

## 先做的兩項確認

以下兩題不是程式碼能替開發者決定，未確認前請把 Data safety 留在草稿，不要猜：

1. **待使用者確認：服務供應商角色。**確認 Google Firebase／Google Play、RevenueCat、Cloudflare、Stadia Maps 與 Esri 的實際帳號／合約，是否都只依軌島指示代為處理資料，符合 Google Play 的 service-provider sharing 例外。若皆符合，本文各資料類型的「分享」可填「否」；任一供應商不符合，就要把該供應商收到的資料列為「分享」。
2. **待使用者確認：獨立安全審查。**若沒有完成 Google Play 認可的獨立安全審查，Console 的「是否經過獨立安全審查」填「否」。不要把一般程式碼 review、APK 簽章或本輪測試當成獨立安全審查。

Google Play 將「收集」定義為資料離開裝置，包含 App 內的 SDK／WebView 直接傳給第三方；把資料交給只代開發者處理的服務供應商，通常可落在「分享」例外。官方說明：

- [Google Play Data safety 表單說明](https://support.google.com/googleplay/android-developer/answer/10787469?hl=zh-Hant)
- [Android 資料用途盤點指南](https://developer.android.com/privacy-and-security/declare-data-use)
- [Firebase Android Data safety 揭露](https://firebase.google.com/docs/android/play-data-disclosure)
- [Google Play 帳號刪除規定](https://support.google.com/googleplay/android-developer/answer/13327111?hl=zh-Hant)

## Console 首頁題目

| Console 題目 | 建議填答 | 程式／產物依據 |
|---|---|---|
| App 是否收集或分享必要的使用者資料類型？ | **是** | 核心列車輪詢會送出相機模式與縮放級別：`index.html:14458-14466`；Worker 記錄相機模式、裝置大類與 zoom：`worker.js:92-102`；Firebase 登入另依使用者選擇處理帳號資料：`app/src/native-bridge.mjs:31-43`、`index.html:7355-7367`。 |
| 所有收集的資料是否在傳輸途中加密？ | **是** | 原生 API base 是 HTTPS：`app/src/native-bridge.mjs:13-16`；Firebase 模組與軌島 API、Esri session／圖磚均使用 HTTPS：`index.html:7117-7129`、`index.html:16158-16173`、`index.html:17551-17576`；隱私政策亦明載 HTTPS：`privacy.html:120-121`。 |
| 使用者是否可要求刪除資料？ | **是** | App／Web 帳號面板提供刪除：`index.html:7461-7503`；公開刪除網址及範圍：`account-deletion.html:20-31`。Console URL 填 `https://railisland.tw/account-deletion.html`。Android 完整刪帳鏈曾實測成功：`docs/android/PROGRESS-STAGE2.md:146-152`。 |
| App 是否允許建立帳號？ | **是** | `?account=delete` 仍會延遲初始化帳號系統：`index.html:7506-7514`；登入畫面提供 Google 登入：`index.html:7140-7162`；Android 原生橋接要求 Google／Apple token：`app/src/native-bridge.mjs:31-43`。核心地圖不用登入，故帳號資料屬可選。 |
| 獨立安全審查 | **待使用者確認**；沒有正式認可報告就填「否」 | release 簽章、verifier 與 audit 不等於 Google Play 認可的獨立安全審查。 |

## 要勾選的資料類型

### 1. 位置

Google Play 將面積小於 3 平方公里的區域視為 precise location。軌島取得的原始座標留在裝置與 30 天本機快取：`index.html:6033-6038`、`index.html:6240-6256`；但地圖依定位移到附近後，release 的 Stadia／Esri 線上底圖會向供應商請求該區域圖磚：`index.html:6326-6353`、`index.html:17551-17576`。z14／z15 圖磚足以落在精確位置定義內，因此不能只依「原始 GPS 沒上傳」就填沒有收集。

| 欄位 | Approximate location | Precise location |
|---|---|---|
| 是否收集 | **是** | **是** |
| 是否分享 | **待使用者確認**；Stadia／Esri 都符合 service-provider 例外才填「否」，否則填「是」 | 同左 |
| 是否暫時處理（ephemeral） | **否（保守填法）**；未取得供應商不留存圖磚請求／IP 的證明 | **否（保守填法）** |
| 必要或可選 | **可選**；使用者可拒絕定位並用全台地圖／手動落釘 | **可選** |
| 用途 | **App functionality** | **App functionality** |

Android source manifest 同時請求 coarse／fine 前景定位：`app/android/app/src/main/AndroidManifest.xml:38-42`；release merged manifest 沒有 `ACCESS_BACKGROUND_LOCATION`：`app/android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml:13-20`。目前懸賞／GPS 校正旅程預設關閉：`index.html:6152-6167`；日後開啟前必須重做本表。

### 2. 個人資訊

| 資料類型 | 收集 | 分享 | ephemeral | 必要性 | 用途 |
|---|---:|---|---:|---|---|
| Name | **是** | Firebase 符合 service-provider 例外時填**否**；否則待使用者依合約改填 | **否** | **可選** | **App functionality、Account management** |
| Email address | **是** | 同上 | **否** | **可選** | **App functionality、Account management** |
| User IDs | **是** | 同上 | **否** | **可選** | **App functionality、Account management** |

依據：原生登入 scope 與 Firebase credential：`app/src/native-bridge.mjs:31-43`；登入畫面與名稱／email 顯示：`index.html:7140-7176`；Firebase uid 用於資料分區與 Firestore：`index.html:6707-6714`、`index.html:7268-7285`。Firebase 官方另說 Authentication SDK 會處理 IP、Firebase Android App ID、user agent，並依登入方式處理 display name、email 與 Firebase User ID。

不要勾 Phone number、Address 或 Other info：產品碼沒有要求這些欄位。

### 3. App activity

| 資料類型 | 收集 | 分享 | ephemeral | 必要性 | 用途 |
|---|---:|---|---:|---|---|
| App interactions | **是** | Cloudflare 符合 service-provider 例外時填**否**；否則**待使用者確認** | **否** | **必要**（核心即時列車輪詢） | **App functionality、Analytics** |
| Other user-generated content | **是** | Firebase 符合 service-provider 例外時填**否**；否則**待使用者確認** | **否** | **可選** | **App functionality** |

App interactions 的實際 payload 是相機模式與 zoom：`index.html:14458-14466`；Worker 另由 user-agent 歸類 mobile／desktop 並寫 Cloudflare Analytics Engine：`worker.js:92-102`。它不是廣告追蹤，但仍是使用量 analytics。

2026-09-03 起另有一筆**事件型** payload：街道底圖（OpenFreeMap）8 秒內載不出來或連續出錯、App 退回 Stadia 時，打一次 `/api/basemap-fallback`，內容是失敗原因（slow／error）與當時 zoom；Worker 端再由 Origin 歸類 app／web、由 user-agent 歸類 mobile／desktop，寫進同一個 Analytics Engine dataset（`index.html` 的 `ofmFailBeacon`、`worker.js` 的 `basemapFallback`）。每個 session 最多一兩發、不含識別資訊，用途仍是使用量 analytics（估 Stadia 成本），所以本表暫歸在 App interactions；若審核方認定「底圖載入逾時」屬 Diagnostics（loading time），要改勾 Diagnostics 並重做本表——待使用者裁示。

Other user-generated content 是最愛地點、最愛列車、最愛車站與完乘紀錄；資料類型及欄位白名單：`index.html:6492-6559`，Firestore transaction：`index.html:7268-7285`。versionCode 16 開啟 Android 通行證後，這條同步路徑會由使用者登入與有效資格觸發，因此維持保守申報。

### 4. Financial info

| 資料類型 | 收集 | 分享 | ephemeral | 必要性 | 用途 |
|---|---:|---|---:|---|---|
| Purchase history | **是** | Google Play 與 RevenueCat 均符合 service-provider 例外時填**否**；否則**待使用者確認** | **否** | **可選**（只有選擇訂閱的人） | **App functionality、Account management、Fraud prevention, security, and compliance** |

RevenueCat 以 Firebase uid 作為 App User ID，處理月票／年票商品、交易狀態、有效期間、購買環境與恢復購買；Worker 另向 RevenueCat Developer API 核對同一 uid 的有效資格。這些都屬購買紀錄／訂閱資格，必須勾 Purchase history。完整卡號、銀行帳戶等付款憑證留在 Google Play，軌島與 RevenueCat App 端不取得，因此 **Payment info 不勾**。

### 5. Device or other IDs

| 欄位 | 建議填答 |
|---|---|
| 是否收集 | **是** |
| 是否分享 | Firebase／Cloudflare／Stadia／Esri 全符合 service-provider 例外時填**否**；否則**待使用者確認** |
| ephemeral | **否（保守填法）** |
| 必要或可選 | **必要** |
| 用途 | **App functionality、Fraud prevention, security, and compliance、Analytics** |

依據：軌島 Worker 以來源 IP 當 rate-limit key：`worker.js:1360-1364`；Firebase Authentication 官方會自動處理 IP、Firebase Android App ID 與 user agent。App 自己也產生持久隨機 device ID：`index.html:6511-6524`；它目前隨本機資料 envelope 保存，未開放的 GPS 校正旅程日後才會上傳。Google Play 說 IP 應依實際用途分類；此處用於逐 client 限流與安全，保守列入 Device or other IDs。

## 本版不要勾選的資料類型

| 類型 | 本版結論 | 依據／重新評估觸發條件 |
|---|---|---|
| Payment info | **不勾** | Google Play 負責付款方式與完整卡號；軌島 App／Worker／RevenueCat 資格流程只處理商品、交易狀態與訂閱有效期，已在上節申報 Purchase history。若日後另接自行處理卡號或銀行資料的付款管道，必須重做本表。 |
| Crash logs、Diagnostics | **不勾** | `app/src/firebase-web.mjs:1-4` 只匯出 Firebase App/Auth/Firestore；release DEX 掃描 `com/google/firebase/analytics` 與 `com/google/firebase/crashlytics` 均 0。沒有 Crashlytics／Analytics SDK。 |
| Advertising data | **不勾** | release manifest 沒有 `com.google.android.gms.permission.AD_ID`，產品碼無廣告／跨 App 追蹤。DEX 內雖有 transitive `AdvertisingIdClient` class，但無 manifest 權限或軌島呼叫；不可把「class 存在」誤報成實際廣告資料流。隱私政策：`privacy.html:68-78`。 |
| Photos and videos、Audio files、Files and docs | **不勾** | App 不請求相機、麥克風、媒體或 storage 權限；source manifest 只有 Internet／coarse／fine：`app/android/app/src/main/AndroidManifest.xml:38-42`。Takeout 檔只在裝置解析：`privacy.html:39-48`。 |
| Messages、Contacts、Calendar、Health and fitness、Web browsing、Search history、Installed apps | **不勾** | manifest／產品資料流無對應權限或上傳路徑。 |

## 不算「收集／分享」但要留證據的功能

- **本地通知：**提醒只住 `localStorage`，不進 Firestore：`index.html:13849-13875`；排程直接交給 Android LocalNotifications：`app/src/native-bridge.mjs:57-74`、`index.html:13973-13990`。因此提醒文字與時刻不列為離開裝置的資料。
- **系統分享：**只在使用者按分享後交給 Android share sheet：`app/src/native-bridge.mjs:76-78`、`index.html:17919-17944`。這是使用者主動要求且可合理預期的傳輸，屬 Play 的 user-initiated sharing 例外；軌島伺服器不接收分享對象或 share-sheet 結果。
- **原始 GPS：**取得與 30 天快取在裝置端；但線上圖磚區域仍按上文申報 Approximate／Precise location，不能把兩件事混為一談。

## 送出前逐項核對

1. 在 Console 先按上表勾選資料類型，讓各子題展開；不要先選「不收集任何資料」。
2. 完成最上方兩個「待使用者確認」：四家供應商 service-provider 角色、獨立安全審查。
3. Privacy policy URL 填 `https://railisland.tw/privacy.html`；Account deletion URL 填 `https://railisland.tw/account-deletion.html`。
4. 在 Financial info 勾選 **Purchase history**；不要因 Google Play 處理卡號就把購買紀錄也一起漏掉。
5. 先以 Play 封閉式測試實際下載 versionCode 16，再重掃商店簽署 APK／split APK 的 manifest、SDK 與網路網域，確認後才送出本表。
6. 任何一項變更都要重做本表：調整 RevenueCat／Play Billing 資料流、重新開放 GPS 校正旅程、加入 analytics／crash SDK、改底圖供應商、加入背景定位或新增登入 provider。
