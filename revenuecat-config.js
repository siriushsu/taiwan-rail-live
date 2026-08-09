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
//
// foundingLaunchAt:創始會員資格判定的「上線錨點」——創始價視窗＝這個時刻起算固定 30 天
// (裁示 2026-08-03,取代先前寫死在 index.html 的猜測日期)。ISO8601 時刻字串,建議台北時區
// 午夜整點(如 '2026-09-01T00:00:00+08:00')。
// 三種合法值,語意不同、發版閘門待遇也不同:
//   · ISO8601 字串 → 要辦創始期,窗從這個時刻起算 30 天(閘門要求它不得早於 build 當天)
//   · false        → 明確裁示「這一版不辦創始期」(閘門放行)
//   · null / 未設定 → 還沒決定(閘門擋下,不讓需要人為決定的值靠安全預設溜上線)
// 🔴 2026-08-09 裁示:創始期取消——來不及在窗內上線。故填 false 而不是 null:null 代表
// 「忘了填」,兩者若共用同一個值,這道閘門就再也分不出「決定不辦」與「忘了決定」。
// 之後要恢復創始期,把這裡改回實際上線日的 ISO8601 字串即可,程式碼其他地方都不用動。
// 網站端沒有等效閘門(部署不經過 prepare-web.mjs),但 index.html 的 foundingFrom() 對
// 「解析不出時刻」有安全預設:一律不判定為創始會員,不會誤判成「沒設定=人人都是」。
window.RAIL_REVENUECAT_CONFIG = window.RAIL_REVENUECAT_CONFIG || {
  entitlement: 'plus',
  offeringId: 'plus',
  iosApiKey: 'appl_YEaudYjWyOOPGRoMORPzdDgggvQ',
  // 2026-07-26：29 首 Suno 曲目核對完成（依據＝擁有人明示聲明全部生成於 Pro 訂閱期間，
  // 非逐首文件證據；證據強度與殘留待查項見 app/MUSIC_LICENSE_CHECKLIST.md）。
  musicRecordingLicensed: true,
  foundingLaunchAt: false
};
