import UIKit
import Capacitor
import FirebaseCore
import WidgetKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // CapacitorFirebaseAuthentication plugin 在 load() 時無條件呼叫 FirebaseApp.configure()，
        // 專案裡還沒有正式 GoogleService-Info.plist 時會直接 NSException 閃退。
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") == nil {
            #if DEBUG
            // Debug/模擬器：缺正式 plist 時用占位 options 先 configure，讓 App 殼可本機開發/模擬器測試（占位值無法真登入）。
            let placeholder = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000", gcmSenderID: "000000000000")
            // 刻意不用 Google 金鑰的 AIza 前綴：這只是占位字串，用了前綴會被 GitHub secret scanning 誤報。
            placeholder.apiKey = "placeholder-not-a-real-api-key-000000000"
            placeholder.projectID = "railisland-placeholder"
            placeholder.bundleID = Bundle.main.bundleIdentifier ?? "tw.railisland.app"
            FirebaseApp.configure(options: placeholder)
            #else
            // Release：缺正式 plist 直接崩，不靜默用占位設定出貨一個登入全壞的 App。
            // GoogleService-Info.plist 為 gitignored（Xcode Cloud 由 GOOGLE_SERVICE_INFO_PLIST_B64 還原），
            // 乾淨 checkout 容易漏帶——這道防呆讓漏帶在測試階段就爆，不會溜到送審。
            fatalError("GoogleService-Info.plist 缺失：release build 必須帶入 Firebase Console 下載的正式 plist（見 app/STORE_SUBMISSION_CHECKLIST.md）")
            #endif
        }
        // 音訊 session 由 RailAudioPlugin 全權管理（分時：跟車讓位/正常播放卡）。
        // build 37 在這裡設全域 mixWithOthers 實測無效——WKWebView 播 <audio> 時 WebKit
        // 用自己的 session 蓋掉 App 層設定；音樂因此改走原生 AVPlayer（build 38）。
        RailBoardScheduleWriter.refreshIfNeeded(application: application)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // 捷運看板小工具的資料視野只有 ~12 分鐘,WidgetKit 又不保證照 policy 刷新——
        // 真機回饋(08-14):視野走完後小工具長時間掛著「沒有班次資訊」＋舊時戳。
        // 使用者開 App 就是最強的刷新訊號:每次回前景都叫小工具重抓一輪(這個 reload
        // 不吃 WidgetKit 的排程預算)。
        // 🔴 一律 reloadAllTimelines,不准指名 kind——真機回饋(08-14):只指名北捷小卡的
        //    結果就是混合大卡(kind 不同)開 App 也不刷新;之後每加一張卡這裡就會再漏一張,
        //    all 一次到位(發車看板吃 App Group 班表,回前景重讀同樣受益)。
        WidgetCenter.shared.reloadAllTimelines()
        // 小工具的背景開卡(MetroWaitStartIntent)若整條失敗,會留一筆待辦在 App Group;
        // 回前景補開一次,退回改版前「點小工具開 App 再開卡」的行為。
        RailMetroWaitPlugin.flushPendingOpen()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // 捷運小工具深連結(railisland://metro-wait):本專案沒裝 @capacitor/app,
        // appUrlOpen 沒人聽,由自家 plugin 轉運;不是我們的 scheme 才交回 Capacitor
        // (google-signin 等既有流程要照走)。
        if RailMetroWaitPlugin.handleOpen(url: url) { return true }
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
