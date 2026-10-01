# RevenueCat 一次性（終身）購買實測 fixture（2026-10-01 sandbox）

終身通行證是 Apple Non-consumable／Play 一次性商品，掛 entitlement `plus`。這裡收的是 sandbox 實際買、實際退款時
RevenueCat REST v2、webhook、Capacitor SDK 回來的原文（已去識別化），以及從中讀出的結論。
Worker 要認得終身（T3），以這頁的實測為準，不以讀碼推論為準。

標記 **〔觀察〕** 的句子，來源是測試當下在 RevenueCat 後台、App Store Connect 或裝置畫面上看到的內容，fixture 檔裡沒有對應資料；
其餘斷言都能在下方列出的檔案裡找到。

- 測試環境〔觀察〕：Android emulator＋Play 授權測試帳號；iPhone 實機＋App Store sandbox 帳號；iOS 26.5 模擬器（只讀 offering）
- SDK：`@revenuecat/purchases-capacitor` 13.2.2、Capacitor 8.4.2（見 `app/package.json`）
- 時間：2026-10-01 15:12–16:40 UTC（SDK 檔的 `stamp`）

## 結論

### 1. 一次性購買只在 `/purchases`，不在 `/subscriptions`

| 端點（`/v2/projects/{project}/customers/{uid}/…`） | 終身有效時 | 終身已退款時 |
|---|---|---|
| `subscriptions?environment=sandbox`／`production` | **0 筆**（買了兩筆終身的 iOS 帳號也是 0） | 0 筆 |
| `purchases?environment=sandbox` | 每筆購買一個 `object: "purchase"` | 同一筆仍在，`status` 改成 `refunded` |
| `active_entitlements` | `[{entitlement_id, expires_at: null}]` | 沒有其他有效購買時是空陣列 |

`purchase` 物件裡 T3 會用到的欄位：

| 欄位 | 值 | 備註 |
|---|---|---|
| `status` | `owned`／`refunded` | 退款不會刪掉這一筆 |
| `entitlements.items[].lookup_key` | `plus` | 退款後 `items` 變成 `[]` |
| `environment` | 這次全是 `sandbox`（小寫） | 正式購買推測是 `production`，這次沒有出現 |
| `store` | `app_store`／`play_store` | |
| `product_id` | `prod…`（**RevenueCat 內部商品 ID，不是商店商品 ID**） | 見第 3 點 |
| `store_purchase_identifier` | Apple 交易號／Play 訂單號 `GPA.…` | 與 webhook 的 `transaction_id` 相同 |
| `purchased_at` | 毫秒 | |
| `revenue_in_usd` | 退款後歸 0 | **沒有退款時間欄位** |

`/subscriptions` 一筆都沒有。現行 Worker 的資格查詢只打 `/subscriptions`（`worker.js` 約 2793 行），所以對終身買家一定判成無效。

### 2. 環境（sandbox／production）怎麼分

- `/purchases?environment=sandbox|production` 會依環境過濾。這次全是 sandbox 購買，帶 `production` 一律 0 筆。不帶 `environment` 時，sandbox 購買也會回，`purchases_noenv.json` 與 `purchases_sandbox.json` 內容相同。不帶參數時會不會連 production 購買一起回，這次沒有正式購買，無法驗證。每一筆另有自己的 `environment` 欄位。
- **`/active_entitlements` 沒有環境欄位**，sandbox 買的終身也會出現在這裡。正式環境判斷資格時不能直接用它，否則 sandbox 購買會在正式環境生效。
- webhook 的 `environment` 這次全是大寫的 `SANDBOX`。

### 3. 怎麼認出是哪一種終身

- `/purchases` 的 `product_id` 是 `prod…`。帶 `expand=items.product` 會回 400 `parameter_error`，訊息說 `expand` 只接受 `items.redemption`（`rest/expand-probe/`）。所以這支端點沒辦法順便帶出商店商品 ID。
- `prod…` 和商店商品 ID 的對照，可以從 `offerings?expand=items.package.product` 讀到（`rest/*/offerings.json`）。fixture 裡的 `prod…` 已換成替身，但同一個原值在所有檔案裡都換成同一個替身，所以檔案之間對得起來：

| 替身 | 商店商品 ID | 平台 | 台灣價（來源：SDK offering、webhook） |
|---|---|---|---|
| `prod0000000003` | `tw.railisland.app.plus.lifetime` | iOS | 1,490 |
| `prod0000000002` | `tw.railisland.app.plus.lifetime_upgrade` | iOS | 990 |
| `prod0000000004` | `railisland_pass_lifetime` | Play | 1,490 |
| `prod0000000001` | `railisland_pass_lifetime_upgrade` | Play | 990 |

- REST 的商品型別：iOS 兩個是 `non_consumable`，Play 兩個是 `one_time`。**SDK 回報的 `productType` 不一樣**：Play 兩個是 `CONSUMABLE`，iOS 兩個是 `NON_CONSUMABLE`（`sdk/*/…offerings.json` 的 `rawPlus`）。判斷商品種類不要用 SDK 的 `productType`。
- webhook 的 `product_id` 直接就是商店商品 ID，不需要對照表。

### 4. webhook

| 情境 | `type` | 重點欄位 |
|---|---|---|
| 購買（兩平台、兩種價格都一樣） | `NON_RENEWING_PURCHASE` | `expiration_at_ms: null`、`entitlement_ids: ["plus"]`、`entitlement_id: null`、`period_type: "NORMAL"`、價格為正 |
| 退款（Play；〔觀察〕是在 RevenueCat 後台按退款） | `CANCELLATION` | `cancel_reason: "CUSTOMER_SUPPORT"`、`price`／`price_in_purchased_currency` 為負、`transaction_id` 與購買那筆相同、`entitlement_ids` 仍是 `["plus"]` |
| 退款（iOS；〔觀察〕是在 App 內向 Apple 申請） | `CANCELLATION` | 欄位與 Play 相同：`CUSTOMER_SUPPORT`、價格為負、`transaction_id` 同購買那筆 |

- 兩次退款都是 `CANCELLATION` 加 `cancel_reason`，沒有出現叫 `REFUND` 的 type。樣本只有兩筆。
- `entitlement_ids` 在退款事件裡也是 `["plus"]`，只看它分不出是買還是退，要看 `type`。
- 〔觀察〕後台事件頁的「Event Data」和實際送出的「Request body」不一樣：前者退款金額顯示 0，後者是負值。fixture 存的是 Request body。
- 〔觀察〕後台送達紀錄：Android 兩則（回應內容 `{"ok":true}`）與 iOS 退款那則，Worker 都回 200；iOS 兩則購買的送達紀錄沒有查看。

### 5. 買兩筆、退一筆

iOS 帳號先後買了 1,490 與 990，再退 990（`rest/ios-refunded/`）：

- `/purchases`：1,490 那筆 `owned`、`entitlements` 有 `plus`；990 那筆 `refunded`、`entitlements` 空。
- `/active_entitlements`：仍有 `plus`，`expires_at: null`。
- SDK `CustomerInfo`（`sdk/ios-device/…163950…_customerInfo.json`）：
  - `entitlements.active.plus` 仍有效；
  - `productIdentifier` 從 990 那筆換回 1,490 那筆；
  - **退掉的那筆從 `nonSubscriptionTransactions` 與 `allPurchasedProductIdentifiers` 消失**。

所以 Worker 判斷資格時，要看「還有沒有任何一筆 `owned` 的終身」，不能只看最新的一筆。前端若用 `allPurchasedProductIdentifiers` 判斷「曾經付過費」，退過款的商品不會被算進去。

### 6. SDK

- **offering `plus`**：Android、iOS 模擬器、iPhone 實機三處都讀得到 `$rc_lifetime` 與 `lifetime_upgrade`，月票、年票 package 照舊。
  - iPhone 上 `currencyCode` 是 `TWD`，`priceString` 卻是 `$990.00` 這種格式，貨幣符號跟著裝置語系走。
  - Android 是 `NT$990.00`。
  - 模擬器是 USD。
- **購買後的 `CustomerInfo`**：
  - `entitlements.active.plus` 的 `expirationDate: null`、`willRenew: false`、`periodType: "NORMAL"`、`isSandbox: true`；
  - `productIdentifier` 是最近一次買的商品；
  - 每筆購買在 `nonSubscriptionTransactions` 各有一條；
  - `activeSubscriptions` 是空的。
- **`beginRefundRequestForProduct` 的回傳值不可信**：
  - 第一次申請，SDK 回 `1`（`REFUND_REQUEST_STATUS.USER_CANCELLED`），但這筆後來真的被記為退款（第 7 點）。
  - 第二次申請，SDK 回 `2`（`ERROR`）。〔觀察〕這次 Apple 畫面顯示這筆已經申請過退款。
  - enum 定義在 `@revenuecat/purchases-typescript-internal-esm/dist/enums.d.ts`：`SUCCESS=0`、`USER_CANCELLED=1`、`ERROR=2`。
  - 前端不能用這個值判斷申請有沒有送出。

### 7. iOS 退款怎麼傳到 RevenueCat（未定論）

時間軸（UTC）：

| 時間 | 事件 | 來源 |
|---|---|---|
| 16:26:23 | App 內申請退款 990，SDK 回 1 | `sdk/ios-device/…162623…_refund…` |
| 16:26:43 | REST 查詢：990 仍是 `owned` | `rest/ios-after-refund-req/`（時間取自原始檔的修改時間） |
| 16:27:58 | 再申請一次，SDK 回 2 | `sdk/ios-device/…162758…_refund…` |
| 16:29、16:32 | REST 再查兩次：990 仍是 `owned` | 未收進 fixture，內容同上 |
| 約 16:35 | 〔觀察〕在 App Store Connect 設定 App Store 伺服器通知 URL，正式與沙箱都指向 RevenueCat | — |
| 16:35:53 | RevenueCat 記下退款，送出 `CANCELLATION` webhook；iPhone 上 SDK 的 `CustomerInfo.requestDate` 也是 16:35:53 | `webhook/ios_CANCELLATION…` 的 `event_timestamp_ms`、`sdk/ios-device/…163950…` 的 `requestDate` |
| 約 16:41 | 〔觀察〕RevenueCat 後台的 Apple Server Notification 一欄仍顯示 *No notifications received* | — |

退款被記下的時間，和 SDK 向 RevenueCat 重新取資料的時間相同，而且當時 RevenueCat 還沒收到任何 Apple 伺服器通知。比較可能的解釋是：App 重新取資料時，RevenueCat 向 Apple 重查交易，才發現已經退款。

這表示**買家不開 App 時，iOS 退款可能不會即時反映到 RevenueCat**。通知 URL 已經設好，但還沒觀察到 Apple 透過它送來任何一則通知，所以「設好之後退款會即時送達」目前**未驗**。

### 8. 其他觀察

- 〔觀察〕模擬器的 sandbox 購買失敗：iOS 26.5 模擬器登入 sandbox 帳號後，購買時 AMS 回 401（`AMSErrorDomain` 100）。所以購買改在 iPhone 實機做，`sdk/ios-simulator/` 只有 configure 和 offering。
- iPhone 帳號的 `first_seen_at` 是 2013-08-01（`rest/ios-*/…_customer.json`），明顯不是真實時間。同樣是 sandbox 的 Android 帳號和模擬器帳號，都是測試當天的時間。這個欄位不要拿來做資料檢查。
- 樣本很小：購買 3 筆（Android 1、iOS 2）、退款 2 筆、客戶 3 個。

## 檔案

| 路徑 | 內容 |
|---|---|
| `rest/active/` | Android 帳號買完 990、尚未退款；iOS 模擬器帳號（沒有買成）當對照。這一輪的 offerings 讀取被拒（403），沒有收 |
| `rest/refunded/` | Android 帳號退款後 |
| `rest/ios-owned/` | iPhone 帳號買完 1,490 與 990 |
| `rest/ios-after-refund-req/` | iPhone 帳號申請退款後，RevenueCat 尚未反映（990 仍 `owned`） |
| `rest/ios-refunded/` | RevenueCat 記下 iOS 退款後（990 `refunded`、1,490 `owned`） |
| `rest/expand-probe/` | `/purchases?expand=items.product` 的 400 回應 |
| `rest/*/offerings.json` | `offerings?expand=items.package.product`，用來對照 `prod…` 與商店商品 ID |
| `webhook/` | RevenueCat 送給 Worker 的 Request body：Android 購買與退款各一筆、iOS 購買兩筆與退款一筆 |
| `sdk/android/`、`sdk/ios-device/`、`sdk/ios-simulator/` | SDK 回傳值：`configure`、`getOfferings`、`purchasePackage`、`getCustomerInfo`、`beginRefundRequestForProduct` |

每個 REST 檔的格式都是 `{request: {method, path}, status, body}`，`body` 是 API 原文。

## 去識別化

用本機一支腳本產生。這支腳本不進版控，因為它內含原始值。規則如下：

- **依形狀換成替身**：
  - app user id → `t2sbx_{android|ios}_userN`
  - Play 訂單號 → `GPA.0000-0000-0000-0000N`
  - UUID → `00000000-0000-4000-8000-…`
  - Apple 16 位交易號
  - RevenueCat 的 `otp…`／`o1_…`／`prod…`／`entl…`／`ofrng…`／`pkge…`／`app…`
  - RevenueCat 專案 ID → `00000000`
- **依欄位名整值換成 `REDACTED_n`**：`signature`、`purchaseToken`、`obfuscatedAccountId` 等簽章與 token 欄位。`originalJson` 這種「字串裡包 JSON」的內層也一起換。
- 同一個原值在所有檔案中都換成同一個替身。
- 產生時會自我檢查：每個被換掉的原值，在原始檔裡至少出現一次（正向對照），在輸出裡出現 0 次。
- 保留：價格、幣別、國家（TW）、時間戳、商店商品 ID、App 版本與作業系統版本。
