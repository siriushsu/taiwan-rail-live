// RevenueCat 各平台 public API key 不是密鑰；秘密金鑰與 webhook 驗證值只能放伺服器環境變數。
// 訂閱制:建立 RevenueCat project、plus entitlement 與一個 plus offering(內含「月訂」「年訂」兩個
// package,慣例 identifier $rc_monthly / $rc_annual,或任何 packageType=MONTHLY/ANNUAL 的 package)後,
// 以 Dashboard 的公開設定取代 null。前端一律只顯示商店回傳的價格(含「創始價」由商店端定價),不硬編金額。
// Web Billing 另需連接 Stripe 並建立 Web app/public key；三平台商品都映射到同一個 plus entitlement,
// 且網站與 App 一律用 Firebase uid 當 RevenueCat App User ID,才能跨平台共用訂閱資格:
// musicRecordingLicensed 只有在 app/MUSIC_LICENSE_CHECKLIST.md 全部核對完成後才可設 true。
// { entitlement:'plus', offeringId:'plus', webApiKey:'...', iosApiKey:'...', androidApiKey:'...', musicRecordingLicensed:false }
//   （offeringId 指向的 offering 需含月/年兩個 package;entitlement 檢查走 entitlements.active,訂閱與買斷同路。）
// 未設定時不載入購買 SDK,Plus 入口也不公開。
window.RAIL_REVENUECAT_CONFIG = window.RAIL_REVENUECAT_CONFIG || null;
