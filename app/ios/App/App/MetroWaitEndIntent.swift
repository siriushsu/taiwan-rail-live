import ActivityKit
import AppIntents

// 等車卡「結束」鈕(iOS 17 LiveActivityIntent):在鎖定畫面/動態島上直接收卡,【不】打開 App。
// perform() 由系統在 App 行程內背景執行——這是 LiveActivityIntent 與一般 AppIntent 的差別。
// 🔴 本檔必須同時掛 App 與 RailBoardWidgetExtension 兩個 target(見 project.pbxproj):
//    widget 端要看得到型別才畫得出 Button(intent:),App 端要有同一型別才執行得了;
//    比照 MetroWaitAttributes 的雙 target 鐵則,不可各複製一份。
@available(iOS 17.6, *)
struct MetroWaitEndIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "結束等車追蹤"
    static let isDiscoverable = false   // 只給卡片上的按鈕用,不進 Shortcuts/聚焦目錄

    func perform() async throws -> some IntentResult {
        // 同 plugin 的 endAll():掃 Activity.activities 而非自存 handle,孤兒卡一起收。
        for act in Activity<MetroWaitAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
        return .result()
    }
}
