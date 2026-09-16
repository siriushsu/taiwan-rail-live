import UIKit
import Capacitor
import FirebaseCore
import WidgetKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    // 🔴 iOS 27 Scene Lifecycle 遷移：window 改由 SceneDelegate 管理，這裡不再持有。
    // var window: UIWindow?  // 已移至 SceneDelegate

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

    // MARK: - Scene Configuration（iOS 27 必須）

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    func application(_ application: UIApplication,
                     didDiscardSceneSessions sceneSessions: Set<UISceneSession>) {
        // 不需做什麼，但宣告此方法是 Scene Lifecycle 的完整性要求
    }

    // MARK: - 以下生命週期已遷至 SceneDelegate（sceneDidBecomeActive 等），AppDelegate 版不再被呼叫
    // 保留空殼以防 Capacitor 或第三方 SDK 有殘留呼叫

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Scene Lifecycle 下這個不會被系統呼叫，但保留以防第三方框架直接調用。
        // 真正的邏輯在 SceneDelegate.sceneDidBecomeActive。
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if RailMetroWaitPlugin.handleOpen(url: url) { return true }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
