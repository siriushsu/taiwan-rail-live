import ActivityKit
import Foundation

// 🔴 這個檔同時屬於 App target 與 RailBoardWidgetExtension target(見 project.pbxproj)。
//    兩邊必須是「同一個型別」,ActivityKit 才配得起來——不可各複製一份
//    (複製的症狀是「request() 成功但畫面永遠空白」,比編譯失敗難查十倍)。
//
// 🔴 精度紅線(memory: tra-thsr-no-official-eta):台鐵官方【只有】表訂時刻與誤點分鐘,
//    沒有預估到站時刻、更沒有秒級倒數。所以這張卡的 ContentState 裡:
//      · 只有 delayMin(官方值照抄),沒有任何「還有幾分幾秒」的欄位;
//      · 主角「實際約到站」由視圖現算 = schedSec + delayMin×60,兩個輸入都是官方值;
//      · 絕不新增秒級倒數欄位——那是在製造官方沒有的精度。
@available(iOS 17.6, *)
struct TraWaitAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 🔴 每一欄都必須是 Optional,而且新欄位只准加在最後(同 MetroWaitAttributes)。
        //    非 Optional 的新欄位會讓「App 更新前就開著的卡」整包解碼失敗——
        //    那不是這一欄變 nil,是整張卡不再更新。
        // 🔴 delayMin 的 nil 與 0 是【兩件不同的事】,視圖不可合併:
        //      nil = 目前沒有即時誤點資訊(這班車不在官方動態窗裡,或資料過舊)
        //      0   = 官方說準點
        //    把 nil 畫成「準點」就是在宣稱一個官方沒說過的事實。
        var delayMin: Int?
        var dataAt: Double?         // 這批官方資料的時刻(卡片底列「HH:mm 更新」)
        var notice: String?         // 整句文案由 App 開卡時寫入,改字不必重出 App
        // 🔴 pushed:這張卡有沒有伺服器在餵。唯一的消費點是到站後那句說明——
        //    沒接上推播的卡必須老實說「誤點分鐘不會自己更新」,接上了還說那句就是說謊。
        //    App 開卡時【不寫】(nil＝還不知道,綁定是開卡之後才非同步完成的),
        //    伺服器每一發推播都送 true。
        var pushed: Bool?
    }
    var station: String             // 使用者在哪一站等
    var trainNo: String             // 台鐵車次號(也是伺服器每分鐘 join 官方誤點的鍵)
    var trainType: String           // 車種標:自強／莒光／區間…(開卡當下就定了)
    var dest: String                // 終點站,顯示成「往 潮州」
    // schedSec:表訂到站時刻(epoch 秒)。
    // 🔴 放 attributes 不放 ContentState 是刻意的——它在整張卡的生命週期裡【不會變】。
    //    會變的只有誤點分鐘;主角時刻 = schedSec + delayMin×60 由視圖現算。
    var schedSec: Double
    var color: String?              // 車種代表色 #RRGGBB;解不出來就不畫,絕不猜一個
    // endAt:追蹤時段終點(epoch 秒)。
    // 🔴 這張卡【不把它畫出來】:伺服器會隨誤點把它往後延(見 twNextEndAt),印出來就會
    //    與伺服器對不上。捷運等車卡那條「endAt 只算一次、兩邊同一個數」的鐵則,守的是
    //    「卡片印出來的承諾」;這裡的解法是不對使用者承諾這個數。留著只給 App 端自己
    //    做本地兜底用。同樣只准 Optional、只准加在最後。
    var endAt: Double?
}
