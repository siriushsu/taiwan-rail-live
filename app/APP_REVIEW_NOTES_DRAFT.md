# App Review／Play Review 審查備註草稿

> ⚠️ 2026-07-22 分版：第一版走「純免費先上」，實際要送審的備註在 `APP_REVIEW_NOTES_v1_FREE.md`。本檔保留為**含 Plus 完整版底稿**，日後開 Plus（1.1）時取用。

> 英文內容供 App Store Connect／Play Console。所有 `[PLACEHOLDER]` 必須在送出前替換；只保留該 build 實際可操作的段落。

## Apple App Review Notes

### Review access

Rail Island's core railway map is fully usable without creating an account or signing in. Please launch the app and wait for the railway data to load; trains will appear automatically on the Taiwan map.

An account is optional and is used only for cross-device synchronization and Rail Island Plus purchase restoration. The app offers both Sign in with Apple and Google Sign-In. No separate Rail Island username or password is required.

### What makes this more than a repackaged website

Rail Island is a real-time animated visualization rather than a static web-content wrapper. The App build includes:

- bundled Taiwan railway geometry and timetable data for offline startup;
- a bundled Natural Earth Taiwan land outline when online map tiles are unavailable;
- native iOS location permission and nearby-rail calculation;
- native local notifications for arrival/departure reminders;
- native system sharing;
- native Sign in with Apple and Google Sign-In;
- native StoreKit auto-renewable subscription purchase and restore through RevenueCat;
- cross-device Firebase synchronization and complete in-app account deletion.

The website remains available, but these native, offline, account, notification, and purchase workflows are integrated into the App experience.

### Suggested review steps

1. Launch the app without signing in. The Taiwan-wide railway animation loads automatically.
2. Tap a train to follow it, or tap a station to open the upcoming-train board.
3. Open the tools drawer and try Nearby Trains. iOS will request location only after this user action. Denying permission does not block the app; manual map pinning remains available.
4. While following a train, open its detail sheet and set an arrival or departure reminder; iOS will request notification permission only after this user action.
5. Enter full screen / ambient mode to verify the animated map and offline Taiwan fallback.
6. Open Rail Island Account to test Sign in with Apple or Google, synchronization, and the in-app account deletion path.

### In-App Purchase

Product: `[IAP_MONTHLY_PRODUCT_ID]` (auto-renewable subscription, 1 month), `[IAP_ANNUAL_PRODUCT_ID]` (auto-renewable subscription, 1 year)  
Entitlement: `plus`  
Offering: `plus` (contains both the monthly and annual package)

Rail Island Plus is an auto-renewable subscription, billed monthly or annually, managed entirely through StoreKit/RevenueCat. Subscribing unlocks per-train delay history with statistics charts, cross-device favorites sync, a satellite basemap, advanced location features, and a founding-member badge; the exact feature list and price are shown on the in-app paywall for this build. There is no external purchase link or alternative payment call to action inside the iOS app.

Review path:

1. Sign in with Apple or Google (required before purchase, so subscription status can sync across devices).
2. Open Rail Island Account, then tap View Plus.
3. Subscribe to either plan with the App Review sandbox account, or use Restore Purchases after a prior sandbox purchase.
4. After the entitlement activates, tap a train and open its delay-history chart, and toggle the satellite basemap from the map layer control, to confirm the paid features unlock.
5. Optionally, open Google List from the tools drawer and import the attached `google-takeout-review-sample.csv` to test the saved-list import flow.

Rail Island Plus does not currently include any music or video-recording feature in this build; recording is disabled (`RECORDING_ENABLED=false`) pending separate basemap/music licensing review and is not shown anywhere in the app.

### Account deletion

In-app path: Rail Island Account → Delete account and synced data → reauthenticate → confirm deletion.

The flow deletes the Firebase Authentication account, the user's Firestore synchronization documents, the RevenueCat customer profile associated with the verified Firebase UID, and private local collections on the current device. Store transaction records retained by Apple are not deleted or refunded by this action.

External information page: https://railisland.tw/account-deletion.html

### Location and privacy

Location is requested only after the user taps Nearby Trains. It is processed on-device to find nearby railway tracks and trains and is not saved to the Rail Island account. The app contains no advertising SDK and no behavioral analytics SDK.

Privacy Policy: https://railisland.tw/privacy.html  
Support: https://railisland.tw/app-support.html

### Map and content rights

The build uses `[FINAL_MAP_PROVIDER]`. Required attribution remains visible on the interactive map and in exported video. Written licensing confirmation and any supporting documents are attached in App Store Connect when required.

The app's bundled low-zoom Taiwan land outline comes from Natural Earth public-domain data. Scheduled railway and operational data sources are disclosed inside the app.

### Review contact

Name: Hsu Hsiang  
Email: `[PUBLIC_REVIEW_EMAIL]`  
Phone: `[REVIEW_PHONE]`

## Google Play Review / Internal Testing Notes

Rail Island's core animated Taiwan railway map does not require an account. Optional Google or Apple sign-in enables cross-device synchronization and purchase restoration.

Rail Island Plus is an auto-renewable subscription (monthly or annual) billed through Google Play Billing via RevenueCat. Reviewers can reach it through Rail Island Account → View Plus. After the entitlement activates, the per-train delay-history chart and satellite basemap toggle are the quickest ways to confirm the paid features unlock. Google saved-list import can also be tested with the attached `google-takeout-review-sample.csv` after Plus is active.

Account deletion is available inside the app under Rail Island Account → Delete account and synced data. The required external deletion resource is:

https://railisland.tw/account-deletion.html

The app requests location only after the user selects Nearby Trains. Core map use remains available without location or sign-in.

Support: https://railisland.tw/app-support.html  
Privacy Policy: https://railisland.tw/privacy.html

## 送審附件

- `review-assets/google-takeout-review-sample.csv`：無私人資料的匯入測試檔。
- 最終底圖商用、影片輸出與 attribution 書面確認。
- 若含 Suno 音樂：29 首逐首生成日期、付費方案與素材來源核對結果；沒有完整證明就送出不含音樂 build。
- 若審查人員無法以 SSO 測試帳號：提供只供審查的帳號流程或錄影，不可把個人 Google／Apple 密碼交給審查人員。

