// RevenueCat 各平台 public API key 不是密鑰；秘密金鑰與 webhook 驗證值只能放伺服器環境變數。
// 建立 RevenueCat project、plus entitlement 與 lifetime offering 後，以 Dashboard 的公開設定取代 null。
// Web Billing 另需連接 Stripe 並建立 Web app/public key；三平台商品都映射到同一個 plus entitlement，
// 且網站與 App 一律用 Firebase uid 當 RevenueCat App User ID，才能跨平台共用永久資格：
// musicRecordingLicensed 只有在 app/MUSIC_LICENSE_CHECKLIST.md 全部核對完成後才可設 true。
// { entitlement:'plus', offeringId:'lifetime', webApiKey:'...', iosApiKey:'...', androidApiKey:'...', musicRecordingLicensed:false }
// 未設定時不載入購買 SDK，Plus 入口也不公開。
window.RAIL_REVENUECAT_CONFIG = window.RAIL_REVENUECAT_CONFIG || null;
