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

1. Launch the app. iOS requests location permission at launch, because the app centers the map on the user's current location so they immediately see the trains and stations around them. Whatever you answer, the core animated map continues: allowing it centers the map on your location; denying it silently falls back to the Taiwan-wide view. Manual map pinning remains available, while Nearby Stations and GPS Calibration Journey recording require location permission. No sign-in is required or offered.
2. Tap a train to follow it, or tap a station to open the upcoming-train board.
3. Tap the Nearby Stations button on the map (top right, below Random Follow) to list the closest stations. Manual map pinning remains available if location was denied.
4. Open Passport, tap Bounty Board under Calibration Contributions, claim a segment, and open its pre-trip instructions. Only after boarding, tap Start Recording. This user action starts the foreground GPS Calibration Journey; tap Stop when the journey is finished.
5. While following a train, open its detail sheet and set an arrival or departure reminder; iOS will request notification permission only after this user action.
6. Enter full screen / ambient mode to verify the animated map and the offline Taiwan fallback.

### In-App Purchase

This version contains no in-app purchases and no subscriptions.

### Accounts

This version does not offer account creation or third-party sign-in. No Rail Island user accounts exist in this build, so there is no cross-device sync and no in-app account deletion flow in this version.

### Location and privacy

At a normal launch without a deep link or saved default place, Rail Island makes one low-accuracy `getCurrentPosition` request so the map can open near the user. Nearby Stations may make a separate high-accuracy one-shot request when a fresh position is not already available or when a cached position needs refreshing.

GPS Calibration Journey is a separate, opt-in workflow. The user must open Passport → Bounty Board, claim a route segment, board the train, and tap Start Recording before the app starts a high-accuracy `watchPosition`. The watch is used for this foreground journey and is cleared when the user taps Stop. If the page reloads while an unfinished journey is stored on the device, the app restores that journey and resumes its foreground watch. The app requests only When In Use access; it has no background location mode and never requests Always authorization.

Each raw latitude/longitude fix is projected on-device onto the selected railway line and is not retained in state, local storage, an account, or any request body. Approximately every 60 seconds during recording, the app uploads only the projected along-line distance, time of day, GPS-reported speed and horizontal accuracy, route/trip metadata, and a random app-generated device identifier for calibration quality review and contribution credit. The server rejects latitude/longitude coordinate keys and discards every non-whitelisted sample field before storage. Separately, the last one-shot map coordinate is cached in local device storage for 30 days so the next launch does not have to wait for a fix; that cache never leaves the device and is not part of sharing or sync. Denying the launch request is silent and does not block the core map or manual pinning, but location-dependent Nearby Stations and GPS Calibration Journey recording require permission. The app contains no advertising SDK and no behavioral analytics SDK.

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
