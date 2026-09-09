// RevenueCat 各平台 public API key 不是密鑰；秘密金鑰與 webhook 驗證值只能放伺服器環境變數。
// 訂閱制:建立 RevenueCat project、plus entitlement 與一個 plus offering(內含「月訂」「年訂」兩個
// package,慣例 identifier $rc_monthly / $rc_annual,或任何 packageType=MONTHLY/ANNUAL 的 package)後,
// 以 Dashboard 的公開設定取代 null。前端一律只顯示商店回傳的價格(含「創始價」由商店端定價),不硬編金額。
// Web Billing 另需連接 Stripe 並建立 Web app/public key；三平台商品都映射到同一個 plus entitlement,
// 且網站與 App 一律用 Firebase uid 當 RevenueCat App User ID,才能跨平台共用訂閱資格:
// { entitlement:'plus', offeringId:'plus', webApiKey:'...', iosApiKey:'...', androidApiKey:'...' }
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
//   · ISO8601 字串 + foundingWindowClosed:true → 創始期辦過且已經收了。錨點原封留著給
//     既有創始會員判定用,閘門不再要求 build 當天落在窗內。窗過了之後要出 build 就補這個,
//     **不是**把 foundingLaunchAt 改成 false(理由見下面那條紅字)。
// 🔴 2026-09-09 裁示:窗尾從 9/9 12:00 挪到 2026-09-10 00:00(今晚 12 點),錨點 8/10 12:00 → 8/11 00:00。
// 原因:App Store Connect 的改價最早只能排到隔天(官方原文 "generally 1 to 2 days in advance"),
// 原窗尾比任何可能的漲價時點都早,中間買到創始價 290 的人會拿不到徽章。
// 補發不需要遷移:founding 每次都用 RevenueCat 的 originalPurchaseDate 現算,
// 換到帶新錨點的載體(網站部署／下一顆 App build)徽章就自己出現。
// 🔴 2026-08-09 的兩次裁示,後者為準:14:20 一度裁示「創始期取消——來不及在窗內上線」
// (本檔曾填 false),19:00 改主意訂在 8/10 中午並已上正式站,故此處回到 ISO8601 字串。
// **上面那三種合法值的區分要留著**——它是那次來回真正的產物:false 是「決定不辦」、
// null 是「忘了填」,兩者若共用同一個值,發版閘門就再也分不出這兩件事。
// 創始期「還沒開始」就要取消,把這裡改成 false(不是 null),程式碼其他地方都不用動。
// 🔴 但創始期「已經辦過」之後不可以改成 false:foundingFrom() 對解析不出時刻的安全預設是
// 「沒人是創始會員」,填 false 會讓已經拿到徽章的島民整批失去徽章(徽章是每次現算的衍生值,
// 不是存下來的)。窗過了就讓錨點留著——過去的購買時刻仍然判得出來,不必也不可以清掉。
// 網站端沒有等效閘門(部署不經過 prepare-web.mjs),但 index.html 的 foundingFrom() 對
// 「解析不出時刻」有安全預設:一律不判定為創始會員,不會誤判成「沒設定=人人都是」。
window.RAIL_REVENUECAT_CONFIG = window.RAIL_REVENUECAT_CONFIG || {
  entitlement: 'plus',
  offeringId: 'plus',
  iosApiKey: 'appl_YEaudYjWyOOPGRoMORPzdDgggvQ',
  foundingLaunchAt: '2026-08-11T00:00:00+08:00',
  // 2026-09-09 裁示:徽章窗到 9/10 00:00 為止,之後創始期收掉。錨點原封留著給既有創始會員
  // 判定(不可改 false),這個旗標只是告訴發版閘門「窗過期是故意的,不是忘了更新」。
  // 之後若又要重開創始期,改錨點的同輪要把這行拿掉,否則閘門就不再幫你盯窗尾了。
  foundingWindowClosed: true
};
