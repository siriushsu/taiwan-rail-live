import ActivityKit
import Foundation

// 🔴 這個檔同時屬於 App target 與 RailBoardWidgetExtension target(見 project.pbxproj)。
//    兩邊必須是「同一個型別」,ActivityKit 才配得起來——不可各複製一份。
@available(iOS 17.6, *)
struct RailFollowAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var nextStop: String      // 下一站站名
        var arrivalDate: Double?  // 預計抵達時刻(epoch 秒);🔴 可為 nil＝這台車此刻算不出 ETA,不畫倒數
        // 進度條起點(上一站表定發車＋當前誤點)。🔴 必須是 Optional——
        // 非 Optional 欄位會讓「App 更新前開的卡」解不出來(Codable 對 Optional 走 decodeIfPresent)。
        // 🔴 型別是 Double(epoch 秒數),不是 Date——見上方修訂註記,Date 轉換收斂到 Step 2 的 view 層。
        var departedDate: Double?
        var delaySec: Int         // 誤點秒數;0=準點、負值=早到
        // 終點站。目前四個版面(鎖定畫面／compact／minimal／expanded)都沒畫它——留著是因為
        // ContentState 是跨行程的編碼型別,事後加欄位會讓「App 更新前開的卡」解不出來;先佔位比較安全。
        var terminus: String
        // 上游即時資料中斷時的告知(後端每分鐘決定;正常時是 nil)。
        // 🔴 必須是 Optional:非 Optional 的新欄位會讓「App 更新前就開著的卡」整包解碼失敗
        //    (Codable 對 Optional 走 decodeIfPresent),那不是這一欄變 nil,是整張卡不再更新。
        // 🔴 刻意用字串不用布林:文案由後端寫,日後改字不必重出 App。
        //    也刻意放在最後一個欄位——memberwise init 的參數順序即呼叫端契約,
        //    RailLiveActivityPlugin.state(from:) 省略它(Optional var 預設 nil),插在中間會編不過。
        var notice: String?
        // 停靠中。後端依 TDX TrainStationStatus=1(在站上)且該站就是卡片正顯示的那一站才給 true;
        // 前景時由前端依班表停站模型(dwellInfoOf)算,兩邊語意一致。
        // 🔴 同 notice:必須 Optional,而且只能加在最後——非 Optional 的新欄位會讓
        //    「App 更新前就開著的卡」整包解碼失敗(不是這一欄變 nil,是整張卡不再更新);
        //    插在中間則會改變 memberwise init 的參數順序,呼叫端(state(from:))編不過。
        var stopping: Bool?
        // 進度條左端＝上一個停靠站站名。沒有(始發站)時是 nil,版面該處留白不畫。
        var prevStop: String?
    }
    var trainNo: String           // 車次
    var kind: String              // 車種(自強/區間/…);建立後不變的放這裡
    var sys: String               // 系統別(tra_sched/thsr_sched/…)
    // 車種代表色(#RRGGBB)。來源是班表裡那台車自己的 color,與地圖上畫的同一個值——
    // 卡片與地圖看起來才是同一台車。🔴 Optional 的理由與 ContentState 那幾欄相同:
    // Attributes 也是跨行程編碼型別,非 Optional 的新欄位會讓既有的卡解不出來。
    var color: String?
}
