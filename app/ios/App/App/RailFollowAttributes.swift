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
        // 終點站。目前四個版面(鎖定畫面／compact／minimal／expanded)都沒畫它——留著是因為
        // ContentState 是跨行程的編碼型別,事後加欄位會讓「App 更新前開的卡」解不出來;先佔位比較安全。
        var terminus: String
    }
    var trainNo: String           // 車次
    var kind: String              // 車種(自強/區間/…);建立後不變的放這裡
    var sys: String               // 系統別(tra_sched/thsr_sched/…)
}
