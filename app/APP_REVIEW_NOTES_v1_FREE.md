# App Review Notes — Version 1（純免費，無登入／無 IAP）

> 對應「免費先上」策略（2026-07-22 拍板）。含 Plus／登入的完整版底稿見 `APP_REVIEW_NOTES_DRAFT.md`。
> 送出前替換所有 `[PLACEHOLDER]`。英文內容供 App Store Connect 貼上。

## Apple App Review Notes

### Review access

Rail Island is fully usable immediately. No account, sign-in, or purchase is required. Please launch the app and wait for the railway data to load; trains will appear automatically on the Taiwan map.

### What makes this more than a repackaged website

Rail Island is a real-time animated visualization rather than a static web-content wrapper. The App build includes:

- bundled Taiwan railway geometry and timetable data for offline startup;
- a bundled Natural Earth Taiwan land outline when online map tiles are unavailable;
- native iOS location permission and nearby-rail calculation;
- native local notifications for arrival/departure reminders;
- native system sharing.

The website remains available, but these native, offline, location, and notification workflows are integrated into the App experience.

### Suggested review steps

1. Launch the app. The Taiwan-wide railway animation loads automatically. No sign-in is required or offered.
2. Tap a train to follow it, or tap a station to open the upcoming-train board.
3. Open the tools drawer and try Nearby Trains. iOS will request location only after this user action. Denying permission does not block the app; manual map pinning remains available.
4. While following a train, open its detail sheet and set an arrival or departure reminder; iOS will request notification permission only after this user action.
5. Enter full screen / ambient mode to verify the animated map and the offline Taiwan fallback.

### In-App Purchase

This version contains no in-app purchases and no subscriptions.

### Accounts

This version does not offer account creation or third-party sign-in. No Rail Island user accounts exist in this build, so there is no cross-device sync and no in-app account deletion flow in this version.

### Location and privacy

Location is requested only after the user taps Nearby Trains. It is processed on-device to find nearby railway tracks and trains and is not sent to any Rail Island server or account. The app contains no advertising SDK and no behavioral analytics SDK.

Privacy Policy: https://railisland.tw/privacy.html  
Support: https://railisland.tw/app-support.html

### Map and content rights

The build uses Stadia Maps for the street basemap (licensed for commercial use under the Stadia Starter plan) and Esri World Imagery for the satellite basemap (licensed via the ArcGIS Location Platform). Required attribution for both remains visible on the interactive map. The bundled low-zoom Taiwan land outline comes from Natural Earth public-domain data. Scheduled railway and operational data sources are disclosed inside the app.

### Review contact

Name: Hsu Hsiang  
Email: `[PUBLIC_REVIEW_EMAIL]`  
Phone: `[REVIEW_PHONE]`

## 送審附件（第一版）

- 最終底圖商用與 attribution 的書面確認（Stadia Starter 商用授權）。
- 本版不含音樂、不含錄影、不含 IAP，無須另附 Suno 或 RevenueCat 相關證明。

## Google Play Review Notes（Android 線擱置）

Android 身分驗證卡關、已擱置（2026-07-20）。重啟 Android 時，比照本檔「無登入／無 IAP」原則改寫。
