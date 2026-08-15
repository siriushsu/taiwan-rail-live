import Foundation

// 🔴 這支刻意只 import Foundation:它要能被 swiftc 單獨編成命令列 harness 驗收
//    (見 app/scripts/verify_metro_board_logic.mjs)。不准在這裡 import SwiftUI/WidgetKit。

public struct MetroRow: Equatable {
    /// 終點站名(已正規化)。捷運的「方向」就是終點,不另外編方向碼。
    public let dest: String
    /// 北捷:官方站牌的絕對到站時刻(epoch 秒)。其他系統為 nil。
    public let etaEpoch: Double?
    /// 高捷／機捷:官方只給整數分鐘。北捷為 nil。
    /// 🔴 絕不把它換算成 etaEpoch——那是把整數分鐘偽裝成秒級精度。
    public let minutes: Int?
    /// 每節車廂擁擠度。官方沒給就是 nil,不得補零、不得猜。
    public let crowd: [Int]?
    /// 這一班所屬的官方路線代碼(BL/BR/R/G/O/Y)。
    /// 來源:看板列的車號 join 官方 `trains[]`,取該車 `stn` 的字母前綴(如 "BL13" → "BL")。
    /// 🔴 對不到就是 nil,不准用站別或終點去猜——轉乘站(忠孝復興同時有文湖線與板南線,
    ///    兩者都開往南港展覽館)猜錯就是畫錯線色,那正是這個欄位要解決的問題。
    ///    文湖線的車在官方 `trains[]` 裡「車號」其實是車廂編號("43,36")且 dest 為 null,
    ///    所以文湖線的看板列一律 join 不到 ⇒ 恆為 nil,由畫面層的目錄退路處理。
    public let lineCode: String?

    public init(dest: String, etaEpoch: Double?, minutes: Int?, crowd: [Int]?, lineCode: String? = nil) {
        self.dest = dest; self.etaEpoch = etaEpoch; self.minutes = minutes
        self.crowd = crowd; self.lineCode = lineCode
    }
}

public struct MetroSnapshot: Equatable {
    public let station: String
    /// 這批資料的時刻(epoch 秒)。畫面一律顯示它,不假裝即時。
    public let dataAt: Double
    public let rows: [MetroRow]
    /// 官方視野內已經沒有任何未來班次。畫面要換成表定並標明,不是繼續倒數。
    public let stale: Bool
}

public enum MetroBoardModel {

    // MARK: - 北捷(絕對 epoch)

    private struct TrtcResponse: Decodable {
        struct BoardRow: Decodable { let name: String; let dest: String; let eta: Double; let no: String? }
        struct Train: Decodable { let no: String?; let stn: String?; let cars: [Int]? }
        let board: [BoardRow]
        let trains: [Train]?
        /// 官方回應自帶的產生時刻(ISO8601)。三個端點都有。
        let at: String?
    }

    /// 這批資料是「什麼時候產生的」——不是「我什麼時候抓的」。
    /// 🔴 兩者混用會讓時刻戳變成謊言:任何一層快取(URLCache／CDN／stale-while-revalidate)
    ///    送來的舊主體,都會被戳上當下時刻 ⇒ 畫面顯示「剛剛更新」、內容卻是幾小時前的班次,
    ///    而且沒有任何判準看得出來。2026-08-15 小工具「每一站都沒有班次」整天沒被診斷出來,
    ///    就是被這個假時刻擋住的(真兇是 URLCache 吃了端點的 max-age=14400)。
    ///    解析不出來才退回抓取時刻——寧可少一點資訊,不要讓整份資料因為時戳格式變動而作廢。
    private static func payloadTime(_ at: String?, fallback: Double) -> Double {
        guard let at else { return fallback }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: at) { return d.timeIntervalSince1970 }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: at) { return d.timeIntervalSince1970 }
        return fallback
    }

    public static func trtc(json: Data, station: String, alias: [String: String], now: Double) throws -> MetroSnapshot {
        let r = try JSONDecoder().decode(TrtcResponse.self, from: json)
        // 官方站名帶「站」尾綴,但不是全部(「台北車站」去尾會變成不存在的「台北車」)。
        // 規則已在 build 時算成別名表,這裡只查表;查不到就丟掉該列,絕不自己猜。
        let mine = r.board
            .filter { alias[$0.name] == station && $0.eta > now }
            // 🔴 必須是全序:Swift 的 sorted 不保證穩定,Node 的 Array.sort 保證穩定
            //    ⇒ 只比 eta 時,同時刻的並列在兩邊可能排出不同順序,逐列比對就會假紅。
            //    平手時再比原始 dest 字串(兩邊用同一個欄位、同一條規則)。
            .sorted { $0.eta == $1.eta ? $0.dest < $1.dest : $0.eta < $1.eta }
        // 🔴 每一列都對回【它自己那台車】(車號 join 官方 `trains[]`),線色與擁擠度都從那台車取。
        //    以前擁擠度是用「終點」配的——同一個終點的所有列都拿到同一台車的資料,實測 211 條
        //    可比對的列裡有 140 條畫的是別台車的擁擠度(2026-08-15),違反本檔自己的規定。
        //    線色同理:轉乘站(忠孝復興同時有文湖線與板南線,兩者都開往南港展覽館)用終點分不出來。
        //    對不到車就兩者皆 nil——寧可不畫,也不要畫別台車的資料。
        var trainByNo: [String: TrtcResponse.Train] = [:]
        for t in r.trains ?? [] {
            guard let no = t.no, !no.isEmpty, trainByNo[no] == nil else { continue }
            trainByNo[no] = t
        }
        let rows = mine.map { b -> MetroRow in
            let train = b.no.flatMap { $0.isEmpty ? nil : trainByNo[$0] }
            let cars = train?.cars
            return MetroRow(dest: alias[b.dest] ?? b.dest, etaEpoch: b.eta, minutes: nil,
                            crowd: (cars?.isEmpty == false) ? cars : nil,
                            lineCode: train?.stn.flatMap { stn in
                                let code = String(stn.prefix(while: { $0.isLetter }))
                                return code.isEmpty ? nil : code
                            })
        }
        return MetroSnapshot(station: station, dataAt: payloadTime(r.at, fallback: now),
                             rows: rows, stale: rows.isEmpty)
    }

    // MARK: - 高捷／機捷(整數分鐘)

    private struct MinuteResponse: Decodable {
        struct Row: Decodable { let l: String?; let s: String; let d: String; let e: Int? }
        let rows: [Row]
        let at: String?
    }

    public static func minuteSystem(json: Data, station: String, alias: [String: String], now: Double) throws -> MetroSnapshot {
        let r = try JSONDecoder().decode(MinuteResponse.self, from: json)
        let mine = r.rows
            .filter { alias[$0.s] == station && $0.e != nil }
            // 🔴 同上:整數分鐘的並列比 epoch 常見得多(凍結樣本裡高捷哈瑪星就有兩筆 e=12),
            //    沒有平手規則時 Swift／Node 兩邊排序結果不保證一致。
            .sorted { ($0.e ?? 0) == ($1.e ?? 0) ? $0.d < $1.d : ($0.e ?? 0) < ($1.e ?? 0) }
        // 🔴 etaEpoch 一律 nil、crowd 一律 nil:這兩個系統官方都沒有。
        let rows = mine.map {
            MetroRow(dest: alias[$0.d] ?? $0.d, etaEpoch: nil, minutes: $0.e, crowd: nil)
        }
        return MetroSnapshot(station: station, dataAt: payloadTime(r.at, fallback: now),
                             rows: rows, stale: rows.isEmpty)
    }
}
