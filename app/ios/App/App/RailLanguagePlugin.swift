import ActivityKit
import Capacitor
import Foundation
import WidgetKit

/// 把網頁內的手動語言選擇同步給 Widget／Live Activity extension。
///
/// WKWebView 的 localStorage 與 App Group 不互通；若少了這層，網頁切成英文後，
/// 鎖定畫面仍會跟著系統語言顯示繁中。只保存三個白名單值，不接收任意 locale。
@objc(RailLanguagePlugin)
public final class RailLanguagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailLanguagePlugin"
    public let jsName = "RailLanguage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setLanguage", returnType: CAPPluginReturnPromise),
    ]

    private static let suite = UserDefaults(suiteName: "group.tw.railisland.app")
    private static let allowed = Set(["zh-TW", "en", "ja"])

    @objc public func setLanguage(_ call: CAPPluginCall) {
        guard let language = call.getString("language"), Self.allowed.contains(language) else {
            call.reject("Unsupported language")
            return
        }
        Self.suite?.set(language, forKey: "rail.language")
        WidgetCenter.shared.reloadAllTimelines()

        // 已經顯示中的卡也用原 state 觸發一次重畫，切換後不必等下一筆列車資料。
        if #available(iOS 17.6, *) {
            Task {
                for activity in Activity<RailFollowAttributes>.activities {
                    await activity.update(ActivityContent(
                        state: activity.content.state,
                        staleDate: activity.content.staleDate
                    ))
                }
                for activity in Activity<MetroWaitAttributes>.activities {
                    await activity.update(ActivityContent(
                        state: activity.content.state,
                        staleDate: activity.content.staleDate
                    ))
                }
            }
        }
        call.resolve()
    }
}
