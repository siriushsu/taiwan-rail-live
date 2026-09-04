import ActivityKit
import Foundation

/// 跟車卡內容的保鮮期,以及它算出來的 ActivityKit `staleDate`。
///
/// 🔴 為什麼住在這個檔:它同屬 App 與 RailBoardWidgetExtension 兩個 target(見下方註解),
///    所以【結構上】保證兩側同值——寫卡的那側(RailLiveActivityPlugin 設 staleDate)與
///    畫卡的那側(RailFollowDisplay 判「資料未更新」)拿的是同一個常數,不是兩個碰巧相等的字面值。
///    各寫一份的失敗形態很安靜:改了一邊,卡片會在「系統說過期」與「版面說還在跑」之間打架。
/// 🔴 後端 worker.js 送的 `stale-date` 也必須是同一個寬限(它是另一個語言、抄不到這裡),
///    那條跨語言的一致性由 scripts/verify_la_push_loop.mjs 的常數斷言守著。
enum RailFollowStale {
    /// 到站時刻【再過這麼久】仍然沒有任何新推播 ⇒ 手上這份必定是舊的。
    ///
    /// 跟車卡的 state 裡沒有資料時戳(候車卡有 dataAt),所以拿「預計到站已經過去多久」當代理:
    /// 車真的到了會推「停靠中」,誤點會推新的 arrivalDate,兩者都沒來就是沒有新資料。
    /// 取 150 秒不取 90:臺鐵 ETA 本身是分鐘級、且到站瞬間的推播有延遲,90 秒會讓正常的
    /// 最後一哩路誤報過期。這是代理指標的必要保守,不是把設計稿的門檻放寬。
    static let graceSeconds: Double = 150

    /// 算不出 ETA 時的兜底。它的職責只有一個:讓「App 被系統終止後遺留的孤兒卡」不會永遠留在
    /// 鎖定畫面上。有 ETA 時一律用 ETA 那條,因為它才是這份內容真正的保鮮期。
    static let orphanFallbackSeconds: Double = 8 * 3600

    /// 這一份內容該在什麼時候被系統標成 stale。
    ///
    /// - Parameter arrival: 預計到站(epoch 秒)。nil＝這台車此刻算不出 ETA。
    /// 🔴 取 min 而不是「有 ETA 就用 ETA」:兜底的 8 小時是上界,不可以被一個遠得離譜的
    ///    到站時刻(資料異常)頂過去,那會讓孤兒卡的保護消失。
    static func date(arrival: Double?, now: Date = Date()) -> Date {
        let cap = now.addingTimeInterval(orphanFallbackSeconds)
        guard let arrival else { return cap }
        return min(cap, Date(timeIntervalSince1970: arrival + graceSeconds))
    }
}

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
        // ActivityAttributes 建立後不可變；跨車轉乘若仍把車次／車種放在 attributes，鎖屏卡就只能
        // 永遠顯示第一段。交棒後由後端把下列 override 寫進 ContentState，同一張卡才能換成接續車。
        // 全部 Optional 且只加在尾端，讓更新前已開著的卡仍能解碼並自然退回 attributes。
        var trainNoOverride: String?
        var kindOverride: String?
        var sysOverride: String?
        var colorOverride: String?
        // true＝人已到轉乘站、目前倒數的是接續班次發車，不是下一站到站。
        var transferWaiting: Bool?
    }
    var trainNo: String           // 車次
    var kind: String              // 車種(自強/區間/…);建立後不變的放這裡
    var sys: String               // 系統別(tra_sched/thsr_sched/…)
    // 車種代表色(#RRGGBB)。來源是班表裡那台車自己的 color,與地圖上畫的同一個值——
    // 卡片與地圖看起來才是同一台車。🔴 Optional 的理由與 ContentState 那幾欄相同:
    // Attributes 也是跨行程編碼型別,非 Optional 的新欄位會讓既有的卡解不出來。
    var color: String?
}
