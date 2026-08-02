import ActivityKit
import Foundation

// 🔴 這個檔同時屬於 App target 與 RailBoardWidgetExtension target(見 project.pbxproj)。
//    兩邊必須是「同一個型別」,ActivityKit 才配得起來——不可各複製一份。
@available(iOS 17.6, *)
struct RailFollowAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var nextStop: String      // 下一站站名
        var arrivalDate: Date?    // 預計抵達時刻;🔴 可為 nil＝這台車此刻算不出 ETA,不畫倒數
        var delaySec: Int         // 誤點秒數;0=準點、負值=早到
        var terminus: String      // 終點站,用於 minimal 版面
    }
    var trainNo: String           // 車次
    var kind: String              // 車種(自強/區間/…);建立後不變的放這裡
    var sys: String               // 系統別(tra_sched/thsr_sched/…)
}
