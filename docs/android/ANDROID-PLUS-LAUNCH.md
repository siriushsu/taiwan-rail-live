# Android 通行證與正式版上架準備（versionCode 16）

> 更新：2026-08-26。這是一份執行清單，不代表 Play Console、RevenueCat 或 Cloudflare 已經改好。需要填法定姓名、地址、稅務、銀行帳戶、價格或第三方帳密的步驟，必須由擁有人本人操作並在送出當下確認。

## 目前已完成的程式準備

- Android 候選版號為 `versionName 1.4.11`、`versionCode 16`。
- Android 通行證改成 build-time 明確開關；沒有 `goog_…` RevenueCat Android public SDK key 就拒絕建置，不會再出現「看得到通行證但不能買」的半套版本。
- 月票、年票、恢復購買沿用既有 RevenueCat Capacitor adapter；方案價格只顯示 Google Play 回傳的當地價格。
- Android 方案頁改顯示 Google Play 的管理／取消說明，並移除 Android 不具備的 App Store、iPhone 與動態島權益文案。
- 同一顆 versionCode 16 AAB 可供封測與正式版使用；Sandbox 資格同時受 build 16、RevenueCat 測試 UID allowlist、Worker Firebase UID allowlist、RevenueCat 真實 sandbox subscription 四層限制。
- release gate 會拒絕：缺 public key、誤放 `sk_…` secret、Sandbox build 與 Gradle versionCode 不一致、Android Plus 半啟用、或 Android runtime 收斂判定消失。
- 已以 Chromium mobile touch context 掃過 360／375／414／768：兩個方案、恢復購買、關閉、隱私權與條款共 6 個互動目標都能實際 tap，無水平溢出或裁切。

## 一、必須由你完成的商家設定

Google Play Console 目前仍要求先建立商家帳戶。到「營利／付款設定」按「立即開始」後，依 Console 現場要求填寫：

1. 收款主體與法定名稱。
2. 地址、電話及身分／商業驗證資料。
3. 稅務資料。
4. 收款銀行帳戶。

這些資料不要貼進 repo、commit、聊天或螢幕錄影。建立完成後，只需回報「商家帳戶完成」與 Console 是否另有待驗證項目。

官方說明：[建立或管理 Google Payments 商家資料](https://support.google.com/googleplay/android-developer/answer/7161426)

## 二、Google Play 商品建議

商品 ID 建立後不宜更改。以下先當建議，按下建立前再逐字確認：

| 項目 | 建議值 |
|---|---|
| 訂閱商品 ID | `railisland_pass` |
| 月票 base plan ID | `monthly` |
| 年票 base plan ID | `annual` |
| 顯示名稱 | 軌島通行證月票／軌島通行證年票 |
| 類型 | 自動續訂 |
| 權益 | 兩個週期都授予同一個 `plus` entitlement |

建立順序：

1. 建立 `railisland_pass` 訂閱商品。
2. 建立並啟用 `monthly`、`annual` 兩個 base plan。
3. 設定台灣與預計上架國家的價格；不要在程式碼硬寫金額。
4. 確認寬限期、帳戶保留、重新訂閱與價格變更規則。
5. 將實際 Console 顯示的 product／base plan 識別字記到發版紀錄，再接 RevenueCat。

RevenueCat 會把 Google Play subscription＋base plan 當成可掛到 entitlement／offering 的 Android products：[RevenueCat Android products](https://www.revenuecat.com/docs/getting-started/entitlements/android-products)

## 三、RevenueCat Android 設定

1. 在既有軌島 RevenueCat project 新增 Android app，package name 填 `tw.railisland.app`。
2. 依 RevenueCat 指示連接 Google Play service credentials，使 RevenueCat 能核對訂閱。
3. 匯入月票與年票的 Google Play base plan products。
4. 兩個 Android products 都掛到既有 entitlement `plus`。
5. 在既有 offering `plus` 裡，把月票設成 `$rc_monthly`、年票設成 `$rc_annual`。
6. 取得 Android public SDK key（格式 `goog_…`），只放本機 repo 根 `.env`：

   ```text
   RAIL_REVENUECAT_ANDROID_API_KEY=goog_請貼公開SDK金鑰
   ```

7. RevenueCat 的 Sandbox Testing Access 設成 **Allowed App User IDs only**，加入實際封測用的 Firebase uid；不可選 Anyone。
8. `sk_…` secret 只存在 RevenueCat／Worker 的伺服器設定，永遠不要放進 `.env` 的 Android public key 欄位、App、文件或 Console release notes。

RevenueCat 說明：public SDK key 可放在 App、secret key 必須保密；每個平台使用自己的 key：[API keys](https://www.revenuecat.com/docs/projects/authentication)、[SDK configuration](https://www.revenuecat.com/docs/getting-started/configuring-sdk)、[Sandbox access](https://www.revenuecat.com/docs/projects/sandbox-access)

## 四、Worker Sandbox UID allowlist

versionCode 16 的 sandbox 後端查詢還要命中 Worker runtime 的 `REVENUECAT_SANDBOX_ALLOWED_UIDS`。值是允許測試的 Firebase uid，以逗號分隔；建議當 secret 管理。

完成 RevenueCat 測試 UID 後，先列出「Cloudflare Worker、變數名稱、只含哪些測試帳號、使用哪個 Cloudflare 帳號」並取得 `go`，再更新與部署 Worker。沒有這個變數時 build 16 的 sandbox 後端資格會 fail closed。

## 五、versionCode 16 建置設定

真正出包前，環境必須包含：

```text
RAIL_ANDROID_PLUS_ENABLED=1
RAIL_ANDROID_PLUS_SANDBOX_POLICY=revenuecat-allowlist
RAIL_ANDROID_PLUS_SANDBOX_BUILD=16
RAIL_APP_VERSION_OVERRIDE=1.4.11
RAIL_EXPECT_APP_VERSION=1.4.11
RAIL_EXPECT_ANDROID_VERSION_CODE=16
```

`RAIL_REVENUECAT_ANDROID_API_KEY` 可由 repo 根 `.env` 讀取。正式建置仍照既有授權音樂、底圖、`cap copy android`、Android-only verifier、`bundleRelease`／`assembleRelease` 與簽章流程；不得拿本文件驗過的假 key 產物上傳。

## 六、封測驗收矩陣

Google 說 license tester 會走與一般使用者相同的購買流程，但可使用測試付款方式：[Test Google Play Billing](https://developer.android.com/google/play/billing/test)。正式版申請前至少完成：

| 情境 | 預期結果 |
|---|---|
| 未列入 RevenueCat／Worker UID allowlist 的帳號 | 不可取得 sandbox 通行證資格 |
| allowlist 帳號開啟方案頁 | 看得到 Google Play 當地月票／年票價格，沒有 App Store／動態島文案 |
| 月票測試購買 | 付款完成、`plus` entitlement 啟用、90 天誤點履歷與同步可用 |
| 年票測試購買 | 同上，方案週期與顯示價格正確 |
| 清除 App 資料或換裝置後登入並恢復購買 | 恢復同一 Firebase uid 的資格與雲端資料 |
| 取消／測試期到期 | CustomerInfo 更新後收回資格；既有雲端副本依隱私政策保留到刪帳 |
| 網路中斷／RevenueCat 失敗 | 不會誤開新資格；既有付費者不因單次查詢失敗被瞬間清空 |
| 捷運桌面小工具 | 免費一站；多站與自動最近站依通行證資格切換 |
| 360／375／414／768 與橫放 | 方案頁可捲、所有按鈕可觸控、無遮擋／溢出 |

license tester 務必同時加入 Play 封閉式測試。只加入測試 track、但沒加入 license testing 的帳號，在某些情況可能使用真實付款方式，不能把「封測」直接當成「一定不扣款」。

## 七、Play Console 送出前順序

1. 商家帳戶完成並通過驗證。
2. 訂閱商品／base plans 啟用，價格與國家完成。
3. RevenueCat Android app、products、entitlement、offering、public key 與 Sandbox UID allowlist 完成。
4. Worker UID allowlist 部署並通過測試。
5. 用真 key 建立、簽署 versionCode 16 AAB；上傳封閉式測試。
6. 從 Google Play 安裝商店簽署版本，完成上節矩陣；不要用 adb 側載包代替 Billing 驗收。
7. Data safety 新增 Purchase history，更新隱私政策／服務條款連結。
8. 填 production access 申請；未解決的平交道與糖鐵資料問題只能寫「已納入持續校正」，不可宣稱已修復。
9. Production release 建立後先停在草稿。真正「申請正式版／開始推出」仍是對外動作，必須另列送出清單並取得 `go`。

## 現在的阻擋項

- Google Play 商家帳戶尚未建立。
- Google Play 月票／年票商品與價格尚未建立。
- RevenueCat Android app、Google credentials、products、`goog_…` public key 與 Sandbox UID allowlist 尚未完成。
- Worker 的 versionCode 16 UID allowlist 尚未部署。
- 因此目前只有使用假 public key 的本機結構驗證產物，**沒有可上傳的正式 AAB**。
