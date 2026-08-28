# Android 通行證與正式版上架準備（versionCode 16）

> 更新：2026-08-26。這是一份執行清單，不代表 Play Console、RevenueCat 或 Cloudflare 已經改好。需要填法定姓名、地址、稅務、銀行帳戶、價格或第三方帳密的步驟，必須由擁有人本人操作並在送出當下確認。

## 目前已完成的程式準備

- Android 候選版號為 `versionName 1.4.11`、`versionCode 16`。
- Android 通行證版強制啟用 Metro Core；漏帶 `RAIL_ENABLE_METRO_CORE=1` 時建置會直接失敗，不會安靜退回舊捷運位置模型。
- Android 通行證改成 build-time 明確開關；沒有 `goog_…` RevenueCat Android public SDK key 就拒絕建置，不會再出現「看得到通行證但不能買」的半套版本。
- 月票、年票、恢復購買沿用既有 RevenueCat Capacitor adapter；方案價格只顯示 Google Play 回傳的當地價格。
- Android 方案頁改顯示 Google Play 的管理／取消說明，並移除 Android 不具備的 App Store、iPhone 與動態島權益文案。
- 同一顆 versionCode 16 AAB 可供封測與正式版使用；Sandbox 資格同時受 build 16、RevenueCat 測試 UID allowlist、Worker Firebase UID allowlist、RevenueCat 真實 sandbox subscription 四層限制。
- release gate 會拒絕：缺 public key、誤放 `sk_…` secret、Sandbox build 與 Gradle versionCode 不一致、Android Plus 半啟用、或 Android runtime 收斂判定消失。
- 已以 Chromium mobile touch context 掃過 360／375／414／768：兩個方案、恢復購買、關閉、隱私權與條款共 6 個互動目標都能實際 tap，無水平溢出或裁切。

## 一、必須由你完成的商家設定

Google Play Console 目前仍要求先建立商家帳戶。必須用帳戶擁有人身分進入「設定」→「付款資料」（部分帳戶顯示「營利」→「付款設定」或「Google Play billing」），按「建立付款資料」／「立即開始」後，依 Console 現場要求填寫：

1. 收款主體與法定名稱。
2. 地址、電話及身分／商業驗證資料。
3. 稅務資料。
4. 收款銀行帳戶。

建立前先核對付款資料的國家；建立後不能直接更改國家，收款銀行也必須在同一國家。個人開發者開始營利後，Google Play 可能公開顯示付款資料中的完整地址。銀行驗證可能要求小額入帳確認或官方銀行文件，官方說明可能需要最多 5 天，因此這一步要先做。

這些資料不要貼進 repo、commit、聊天或螢幕錄影。建立完成後，只需回報「商家帳戶完成」與 Console 是否另有待驗證項目。

官方說明：[建立或管理 Google Payments 商家資料](https://support.google.com/googleplay/android-developer/answer/7161426)

## 二、Google Play 商品建議

商品 ID 建立後不宜更改。以下先當建議，按下建立前再逐字確認：

| 項目 | 建議值 |
|---|---|
| 訂閱商品 ID | `railisland_pass` |
| 月票 base plan ID | `monthly-autorenewing` |
| 年票 base plan ID | `annual-autorenewing` |
| 顯示名稱 | 軌島通行證月票／軌島通行證年票 |
| 類型 | 自動續訂 |
| 權益 | 兩個週期都授予同一個 `plus` entitlement |

建立順序：

1. 進入軌島 App →「透過 Play 營利」→「產品」→「訂閱」→「建立訂閱」。
2. 先逐字確認商品 ID `railisland_pass`；建立後不能刪除，只能封存。
3. 填顯示名稱與最多四項權益，不要在權益文字寫死價格或試用期。
4. 建立並啟用 `monthly-autorenewing`、`annual-autorenewing` 兩個自動續訂 base plan。
5. 月票週期選 1 個月、年票週期選 1 年；逐一設定台灣與預計上架國家的價格。
6. 確認寬限期、帳戶保留、重新訂閱與價格變更規則，再按「啟用」。
7. 將實際 Console 顯示的 product／base plan 識別字記到發版紀錄，再接 RevenueCat。

按下建立前仍要由你確認月／年價格與上述三個識別字；目前文件中的值只是建議。

官方操作說明：[建立與管理訂閱](https://support.google.com/googleplay/android-developer/answer/140504)、[訂閱與 base plan 概念](https://support.google.com/googleplay/android-developer/answer/12154973)。RevenueCat 會把 Google Play subscription＋base plan 當成可掛到 entitlement／offering 的 Android products：[RevenueCat Android products](https://www.revenuecat.com/docs/getting-started/entitlements/android-products)

## 三、RevenueCat Android 設定

1. 在既有軌島 RevenueCat project 新增 Android app，package name 填 `tw.railisland.app`。
2. 依 RevenueCat 指示建立 Google service account、在 Play Console「使用者與權限」授予軌島所需權限，並把 service-account JSON 只上傳到 RevenueCat。JSON 是伺服器憑證，不可放進 repo／聊天／App。
3. 等 RevenueCat credential validator 通過；新 credentials 最長可能約 36 小時才完全生效。
4. 匯入月票與年票的 Google Play base plan products；新式識別字會是 `railisland_pass:monthly-autorenewing` 與 `railisland_pass:annual-autorenewing`。
5. 兩個 Android products 都掛到既有 entitlement `plus`。
6. 在既有 offering `plus` 裡，把月票設成 `$rc_monthly`、年票設成 `$rc_annual`，並確認該 offering 是 App 目前讀取的 offering。
7. 取得 Android app-specific public SDK key（格式 `goog_…`），只放本機 repo 根 `.env`；不可使用 RevenueCat Test Store key 出正式包：

   ```text
   RAIL_REVENUECAT_ANDROID_API_KEY=goog_請貼公開SDK金鑰
   ```

8. RevenueCat 的 Sandbox Testing Access 設成 **Allowed App User IDs only**，加入實際封測用的 Firebase uid；不可選 Anyone。
9. `sk_…` secret 只存在 RevenueCat／Worker 的伺服器設定，永遠不要放進 `.env` 的 Android public key 欄位、App、文件或 Console release notes。

RevenueCat 說明：public SDK key 可放在 App、secret key 必須保密；每個平台使用自己的 key：[API keys](https://www.revenuecat.com/docs/projects/authentication)、[SDK configuration](https://www.revenuecat.com/docs/getting-started/configuring-sdk)、[Sandbox access](https://www.revenuecat.com/docs/projects/sandbox-access)

Google service account 與權限的 RevenueCat 官方步驟：[Google Play service credentials](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials)

## 四、Worker Sandbox UID allowlist

versionCode 16 的 sandbox 後端查詢還要命中 Worker runtime 的 `REVENUECAT_SANDBOX_ALLOWED_UIDS`。值是允許測試的 Firebase uid，以逗號分隔；建議當 secret 管理。

完成 RevenueCat 測試 UID 後，先列出「Cloudflare Worker、變數名稱、只含哪些測試帳號、使用哪個 Cloudflare 帳號」並取得 `go`，再更新與部署 Worker。沒有這個變數時 build 16 的 sandbox 後端資格會 fail closed。

## 五、versionCode 16 建置設定

真正出包前，環境必須包含：

```text
RAIL_ANDROID_PLUS_ENABLED=1
RAIL_ANDROID_PLUS_SANDBOX_POLICY=revenuecat-allowlist
RAIL_ANDROID_PLUS_SANDBOX_BUILD=16
RAIL_ENABLE_METRO_CORE=1
RAIL_EXPECT_METRO_CORE=1
RAIL_APP_VERSION_OVERRIDE=1.4.11
RAIL_EXPECT_APP_VERSION=1.4.11
RAIL_EXPECT_ANDROID_VERSION_CODE=16
```

`RAIL_REVENUECAT_ANDROID_API_KEY` 可由 repo 根 `.env` 讀取。正式建置仍照既有授權音樂、底圖、`cap sync android`、Android-only verifier、`bundleRelease`／`assembleRelease` 與簽章流程；不得拿本文件驗過的假 key 產物上傳。

正式出包指令（商家、商品、RevenueCat、Worker 與真實 `.env` 都完成後才能執行）：

```bash
cd app
RAIL_ANDROID_PLUS_ENABLED=1 \
RAIL_ANDROID_PLUS_SANDBOX_POLICY=revenuecat-allowlist \
RAIL_ANDROID_PLUS_SANDBOX_BUILD=16 \
RAIL_ENABLE_METRO_CORE=1 \
RAIL_EXPECT_METRO_CORE=1 \
RAIL_APP_VERSION_OVERRIDE=1.4.11 \
RAIL_EXPECT_APP_VERSION=1.4.11 \
RAIL_EXPECT_ANDROID_VERSION_CODE=16 \
RAIL_REQUIRE_NATIVE=1 \
RAIL_WHATS_NEW='軌島 1.4.11：Android 新增 Google Play 軌島通行證，補回 App 功能、地圖同步修正並鎖定統一捷運即時動畫。' \
npm run build:release

node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/Users/xuxiang/Library/Android/sdk \
./gradlew clean bundleRelease assembleRelease
```

出包後逐一核對：

```bash
/Users/xuxiang/Library/Android/sdk/build-tools/36.0.0/aapt dump badging app/build/outputs/apk/release/app-release.apk
/Users/xuxiang/Library/Android/sdk/build-tools/36.0.0/apksigner verify --verbose app/build/outputs/apk/release/app-release.apk
jarsigner -verify app/build/outputs/bundle/release/app-release.aab
```

另外必須從 AAB／APK 內嵌的 `assets/public/index.html` 核對：`RAIL_METRO_CORE_ENABLED=true`、`RAIL_ANDROID_PLUS_ENABLED=true`、versionCode 16、versionName 1.4.11；不得只看原始碼環境變數。

## 六、封測驗收矩陣

Google 說 license tester 會走與一般使用者相同的購買流程，但可使用測試付款方式：[Test Google Play Billing](https://developer.android.com/google/play/billing/test)。正式版申請前至少完成：

| 情境 | 預期結果 |
|---|---|
| 未列入 RevenueCat／Worker UID allowlist 的帳號 | 不可取得 sandbox 通行證資格 |
| allowlist 帳號開啟方案頁 | 看得到 Google Play 當地月票／年票價格，沒有 App Store／動態島文案 |
| 北捷／高捷即時動畫 | 內嵌 `RAIL_METRO_CORE_ENABLED=true`，實機與網站同一時刻的列車身分、位置與到站資訊一致；斷訊時只讓異常路線降級 |
| 月票測試購買 | 付款完成、`plus` entitlement 啟用、90 天誤點履歷與同步可用 |
| 年票測試購買 | 同上，方案週期與顯示價格正確 |
| 清除 App 資料或換裝置後登入並恢復購買 | 恢復同一 Firebase uid 的資格與雲端資料 |
| 取消／測試期到期 | CustomerInfo 更新後收回資格；既有雲端副本依隱私政策保留到刪帳 |
| 網路中斷／RevenueCat 失敗 | 不會誤開新資格；既有付費者不因單次查詢失敗被瞬間清空 |
| 捷運桌面小工具 | 免費一站；多站與自動最近站依通行證資格切換 |
| 360／375／414／768 與橫放 | 方案頁可捲、所有按鈕可觸控、無遮擋／溢出 |

License tester 設定路徑是 Play Console 全域「設定」→「License testing」，選擇 Email list 或 Google Group。測試帳號還必須同時加入軌島的封閉式測試並開啟 opt-in 連結；用哪個 Google 帳號從 Play 商店下載 App，購買就會走哪個帳號。只加入測試 track、但沒加入 License testing 的帳號，可能使用真實付款方式，不能把「封測」直接當成「一定不扣款」。

官方說明：[設定封閉式測試](https://support.google.com/googleplay/android-developer/answer/9845334)、[設定 License testing](https://support.google.com/googleplay/android-developer/answer/6062777)

## 七、Play Console 送出前順序

1. 商家帳戶完成並通過驗證。
2. 訂閱商品／base plans 啟用，價格與國家完成。
3. RevenueCat Android app、products、entitlement、offering、public key 與 Sandbox UID allowlist 完成。
4. Worker UID allowlist 部署並通過測試。
5. 用真 key 建立、簽署 versionCode 16 AAB，保存 SHA-256；不得使用本機假 key APK。
6. Play Console「測試與發布」→「測試」→「封閉式測試」→現有 track「管理」→「建立新版本」，上傳該 AAB、貼入版本資訊並檢查警告。
7. 先停在草稿並列出 `[對象, 內容, 來源, 帳號]` 取得 `go`，再按「開始推出至封閉式測試」。
8. 測試者用 opt-in 連結加入，從 Google Play 安裝商店簽署版本，完成上節矩陣；不要用 adb 側載包代替最終 Billing 驗收。
9. Play Console「政策與計畫」→「應用程式內容」→「資料安全性」新增 Purchase history，確認 Payment info 維持否，並更新隱私政策／服務條款連結。
10. 填 production access 申請；未解決的平交道與糖鐵資料問題只能寫「已納入持續校正」，不可宣稱已修復。
11. 正式版存取權通過後，到「正式版」建立 release，從 App Bundle library 選用**封測已驗過的同一顆 versionCode 16 AAB**；不要重建另一顆內容不同但同版號的檔案。
12. 填國家／地區、正式版版本資訊與 rollout 設定，先停在草稿。真正「申請正式版／開始推出」仍是對外動作，必須另列送出清單並取得 `go`。

資料安全性要依 App 實際資料流申報，官方表格特別將 purchase history 列為 financial info 類別：[資料安全性資料類型](https://support.google.com/googleplay/android-developer/answer/10787469)。個人開發者正式版資格的官方流程與測試門檻見：[申請 production access](https://support.google.com/googleplay/android-developer/answer/14151465)。

若封測後需要修改任何會進 AAB 的內容，versionCode 16 即作廢，必須升 versionCode 17、重新建置並重新跑 Billing／Metro Core／地圖矩陣，不能把另一個檔案冒充已驗過的 v16。

## 現在的阻擋項

- Google Play 商家帳戶尚未建立。
- Google Play 月票／年票商品與價格尚未建立。
- RevenueCat Android app、Google credentials、products、`goog_…` public key 與 Sandbox UID allowlist 尚未完成。
- Worker 的 versionCode 16 UID allowlist 尚未部署。
- 因此目前只有使用假 public key 的本機結構驗證產物，**沒有可上傳的正式 AAB**。
