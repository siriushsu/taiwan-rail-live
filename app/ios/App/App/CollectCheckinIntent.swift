import AppIntents
import Foundation

// 車站收集小工具(小卡)的「蓋章」鈕。
//
// 為什麼是 Button(intent:) 而不是 Link:systemSmall 只有 widgetURL 一個點擊範圍,Link 在小卡不生效;
// 要在同一張小卡上讓「按鈕」與「其餘地方(開旅程護照)」各走各的,只有 iOS 17 的互動按鈕做得到。
// 中卡沒有這個限制,直接用 Link(railisland://checkin),兩條路在網頁端匯到同一個 waitOpen 事件。
//
// 這個 intent 只做兩件事:(1) 把「使用者要蓋章」記進 App Group;(2) openAppWhenRun 把 App 帶到前景。
// 到站判定與蓋章都在網頁端,原生殼只負責把意圖轉成 waitOpen { view: "checkin" }(RailMetroWaitPlugin)。
//
// 🔴 本檔同時掛 App 與 RailBoardWidgetExtension 兩個 target(見 project.pbxproj):widget 端要看得到型別才畫得出
//    Button(intent:);perform() 由系統在 App 行程裡執行(openAppWhenRun)。比照 MetroWaitStartIntent 的雙 target 做法,
//    App Group 一律經 MetroWaitPending.suite,本檔不新增任何 App Group 字面。

/// 蓋章請求的待辦。刻意放在可用性閘門【外面】——RailMetroWaitPlugin 與 SceneDelegate 那兩處不是 iOS 17 限定的程式碼。
enum CollectCheckinPending {
    static let key = "collect.pendingCheckin"
    /// 保鮮期 120 秒。蓋章是依「此刻的位置」判定的:點了鈕、App 卻沒被帶到前景(系統擋下、使用者立刻鎖屏)時,
    /// 待辦會留在 App Group;若不設期限,使用者過很久才因別的原因打開 App,就會在完全不相干的地點與時間冒出一次蓋章。
    /// 兩分鐘足夠涵蓋冷啟動與解鎖,超過就當作使用者已經不想蓋了。
    static let maxAgeSec: Double = 120
    /// App 行程內 perform() 寫完待辦後發出的通知:App 已在前景、RailMetroWaitPlugin 也已載入時,
    /// 沒有任何生命週期事件會再讀待辦,靠這個通知立刻交出去。
    static let didWrite = Notification.Name("tw.railisland.collectCheckinPending")

    static func write(now: Date = Date()) {
        MetroWaitPending.suite?.set(now.timeIntervalSince1970, forKey: key)
    }

    /// 讀出並【清掉】:只能消費一次。清在前面——交出去的那一條路徑若又失敗,不可以留著讓每次回前景都重蓋一次。
    /// 回 true＝有一筆還在保鮮期內的待辦。時間往回撥(age < 0)一併當作過期。
    static func take(now: Date = Date()) -> Bool {
        guard let suite = MetroWaitPending.suite, let at = suite.object(forKey: key) as? Double else { return false }
        suite.removeObject(forKey: key)
        let age = now.timeIntervalSince1970 - at
        return age >= 0 && age <= maxAgeSec
    }
}

@available(iOS 17.0, *)
struct CollectCheckinIntent: AppIntent {
    static let title: LocalizedStringResource = "蓋章"
    static let isDiscoverable = false   // 只給小工具的按鈕用,不進 Shortcuts/聚焦目錄
    static let openAppWhenRun = true

    init() {}

    func perform() async throws -> some IntentResult {
        CollectCheckinPending.write()
        NotificationCenter.default.post(name: CollectCheckinPending.didWrite, object: nil)
        // 一律回 .result():這條路沒有可以 throw 的失敗,而且 throw 會在使用者面前跳系統錯誤。
        return .result()
    }
}
