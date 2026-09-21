import UIKit
import Capacitor
import WidgetKit

// iOS 27 SDK 強制要求 Scene Lifecycle——用 Xcode 27 編譯的 App 若不採用，
// 啟動時 UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption 會直接 SIGTRAP。
// 這是最小遷移：把原本 AppDelegate 的 window 管理搬到這裡，其餘邏輯維持原樣。
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // Capacitor 的 Main.storyboard 會自動建立 RailBridgeViewController，
        // 只要 Info.plist 的 UISceneStoryboardFile 指向 Main 即可。
        // 不需要手動設定 rootViewController。
        self.window = windowScene.windows.first

        // 處理冷啟動時的深連結（URL）
        if let urlContext = connectionOptions.urlContexts.first {
            handleURL(urlContext)
        }
        // 處理冷啟動時的 Universal Link
        if let userActivity = connectionOptions.userActivities.first {
            _ = handleUserActivity(userActivity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // 熱啟動時的深連結（URL scheme），比照原 AppDelegate.application(_:open:options:)
        guard let context = URLContexts.first else { return }
        handleURL(context)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // 熱啟動時的 Universal Link，比照原 AppDelegate.application(_:continue:restorationHandler:)
        _ = handleUserActivity(userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // 比照原 AppDelegate.applicationDidBecomeActive
        WidgetKit.WidgetCenter.shared.reloadAllTimelines()
        RailMetroWaitPlugin.flushPendingOpen()
        // 台鐵班表窗快到期時抓線上新窗（一天最多一次）；冷啟動那次已在 AppDelegate 跑過。
        RailBoardScheduleWriter.refreshOnForeground(application: UIApplication.shared)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        // 比照原 AppDelegate.applicationWillResignActive
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // 比照原 AppDelegate.applicationDidEnterBackground
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // 比照原 AppDelegate.applicationWillEnterForeground
    }

    // MARK: - Private

    private func handleURL(_ context: UIOpenURLContext) {
        // 捷運小工具深連結
        if RailMetroWaitPlugin.handleOpen(url: context.url) { return }
        // 其餘 URL（google-signin 等）交回 Capacitor
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, open: context.url,
            options: Self.openURLOptions(from: context.options)
        )
    }

    // 🔴 options 要原封帶過去，不可以傳 [:]。Capacitor 的 proxy 只是把它塞進
    //    .capacitorOpenURL 通知的 payload，今天沒有 plugin 在讀 sourceApplication，
    //    但少帶的壞法是「哪天有人讀了就讀到空的」——沒有編譯錯誤、沒有執行期訊號。
    private static func openURLOptions(from options: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
        var out: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let sourceApplication = options.sourceApplication { out[.sourceApplication] = sourceApplication }
        if let annotation = options.annotation { out[.annotation] = annotation }
        out[.openInPlace] = options.openInPlace
        return out
    }

    private func handleUserActivity(_ userActivity: NSUserActivity) -> Bool {
        return ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in }
        )
    }
}
