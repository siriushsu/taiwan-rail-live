import ActivityKit
import Foundation

// 🔴 這個檔同時屬於 App target 與 RailBoardWidgetExtension target(見 project.pbxproj)。
//    兩邊必須是「同一個型別」,ActivityKit 才配得起來——不可各複製一份
//    (複製的症狀是「request() 成功但畫面永遠空白」,比編譯失敗難查十倍)。
@available(iOS 17.6, *)
struct MetroWaitAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 🔴 每一欄都必須是 Optional,而且新欄位只准加在最後。
        //    非 Optional 的新欄位會讓「App 更新前就開著的卡」整包解碼失敗——
        //    那不是這一欄變 nil,是整張卡不再更新。插在中間則會改變 memberwise init
        //    的參數順序,呼叫端編不過。這條在 RailFollowAttributes 已經吃過一次教訓。
        var nextEta: Double?        // 北捷:官方絕對到站時刻(epoch 秒)
        var nextMinutes: Int?       // 高捷／機捷:官方整數分鐘
        var secondEta: Double?
        var secondMinutes: Int?
        var nextDest: String?       // 下一班往哪
        var secondDest: String?
        var crowd: [Int]?           // 每節車廂鬆緊,官方沒給就 nil
        var dataAt: Double?         // 這批資料的時刻
        var notice: String?         // 整句文案由 App 開卡時寫入,改字不必重出 App
    }
    var sys: String                 // trtc / krtc / tymc
    var station: String             // 正規化站名
    var lineLabel: String           // 顯示用的線代號,如 "BL"
    var color: String?              // 線路代表色 #RRGGBB;解不出來就不畫,絕不猜一個
    var endAt: Double?              // 追蹤時段終點(epoch 秒)=開卡時刻+durationMin。整段固定故放
                                    // attributes 不放 ContentState;同樣只准 Optional、只准加在最後
}
