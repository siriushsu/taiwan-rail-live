import UIKit
import AVFoundation
import Capacitor
import FirebaseCore

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
        // 音樂隱形化（2026-08-10 裁示）：mixWithOthers 讓網頁 <audio> 不註冊系統「正在播放」，
        // 動態島與鎖定畫面不出現音樂卡，跟車 Live Activity 獨占動態島。
        // 代價（使用者已知情）：鎖定畫面無播放控制、不會中斷其他 App 的聲音。
        // 只設 category 不 setActive——啟動就 setActive 會無故打斷別家正在播的音訊。
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
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
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
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
