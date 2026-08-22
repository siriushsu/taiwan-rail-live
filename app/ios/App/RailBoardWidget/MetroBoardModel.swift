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
    /// 官方看板列自帶的車次(空字串一律收成 nil)。
    /// 只給 `resolveLine` 分辨「板南線與文湖線同時服務同一組站與終點」的那一種列用,
    /// 不作顯示用途——北捷的「車次」在文湖線其實是車廂編號,不是給人看的車次。
    public let trainNo: String?
    /// 「再下一班」(2026-08-22 裁示):伺服端從【已發車在途】的官方名冊推導的第二班,
    /// 沿線累加行車＋停靠秒的投影值,不是官方站牌原文 ⇒ 畫面必須帶「約」字
    /// (MetroCountdown 對 approx 列一律走 .approxMinutes),絕不能畫成秒級倒數冒充官方精度。
    /// 離峰第二班還沒發車時伺服端不給值 ⇒ 這裡就沒有這一列——留白是裁示的一部分,不是缺陷。
    public let approx: Bool

    public init(dest: String, etaEpoch: Double?, minutes: Int?, crowd: [Int]?, lineCode: String? = nil,
                trainNo: String? = nil, approx: Bool = false) {
        self.dest = dest; self.etaEpoch = etaEpoch; self.minutes = minutes
        self.crowd = crowd; self.lineCode = lineCode; self.trainNo = trainNo; self.approx = approx
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
        struct BoardRow: Decodable {
            let name: String; let dest: String; let eta: Double; let no: String?
            /// 伺服端推導的「再下一班」到站時刻(epoch 秒)。舊版 worker 沒有這個欄位 ⇒ nil,
            /// 整個第二班功能自然不存在——小工具不做任何退路推算(裁示:推不出就留白)。
            let eta2: Double?
        }
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
        var keyed: [(eta: Double, rawDest: String, row: MetroRow)] = []
        keyed.reserveCapacity(mine.count * 2)
        for b in mine {
            let train = b.no.flatMap { $0.isEmpty ? nil : trainByNo[$0] }
            let cars = train?.cars
            let lineCode = train?.stn.flatMap { stn -> String? in
                let code = String(stn.prefix(while: { $0.isLetter }))
                return code.isEmpty ? nil : code
            }
            keyed.append((b.eta, b.dest,
                MetroRow(dest: alias[b.dest] ?? b.dest, etaEpoch: b.eta, minutes: nil,
                         crowd: (cars?.isEmpty == false) ? cars : nil,
                         lineCode: lineCode,
                         trainNo: b.no.flatMap { $0.isEmpty ? nil : $0 })))
            // 「再下一班」合成列(2026-08-22 裁示:每條線每個方向至少兩班,第二班寫「約N分」)。
            // 🔴 lineCode 繼承第一班 join 出來的線別——伺服端保證第二班同線同向同終點,
            //    這是唯一能把忠孝復興 BL/BR 兩列的次班標對線色的來源(沒 join 到就 nil,
            //    由 resolveLine 的 {BL,BR}+無車號 ⇒ BR 規則接手,恰好也是對的那一半)。
            // 🔴 crowd/trainNo 一律 nil:那是第一班那台車的資料,拿來標第二班就是貼錯車。
            if let e2 = b.eta2, e2 > now, e2 > b.eta {
                keyed.append((e2, b.dest,
                    MetroRow(dest: alias[b.dest] ?? b.dest, etaEpoch: e2, minutes: nil,
                             crowd: nil, lineCode: lineCode, trainNo: nil, approx: true)))
            }
        }
        // 合成列插回時間順序。排序鍵與 `mine` 那次完全同一套(eta 平手比【原始】dest 字串)——
        // 沒有 eta2 時輸出逐列等同改版前;平手規則絕不能換成 alias 後的字串
        // (差分驗收的期望值用原始欄位算,鍵不同套會在平手案例假紅,也是無謂的行為改變)。
        keyed.sort { $0.eta == $1.eta ? $0.rawDest < $1.rawDest : $0.eta < $1.eta }
        let rows = keyed.map(\.row)
        return MetroSnapshot(station: station, dataAt: payloadTime(r.at, fallback: now),
                             rows: rows, stale: rows.isEmpty)
    }

    // MARK: - 逐列線別

    /// 這一列到底屬於哪一條線。三層,由強到弱:
    /// 1. `joined`——車號 join 官方 `trains[]` 得到的線代碼(見 `MetroRow.lineCode`),逐列權威。
    /// 2. 同時服務【本站】與【該列終點】的路線只剩一條 ⇒ 就是它。
    /// 3. 只剩「板南線＋文湖線」兩解時:官方 TrackInfo 只對高運量給車次,文湖線各列
    ///    TrainNumber 恆為空字串 ⇒ 有車號＝BL、沒車號＝BR。
    ///
    /// 🔴 第 3 條**只在候選集恰為 {BL,BR} 時**成立,不准擴大成「沒車號就是文湖線」——
    ///    板南線自己也有沒車號的列(2026-08-15 連取六輪、1523 列去重:板南 334 列中 15 列
    ///    沒車號,4.5%,全部落在頂埔／永寧／土城／海山／南港／南港展覽館這些端點區)。
    ///    無條件反推會把那些列畫成棕色。
    /// 🔴 這條規則不是這裡發明的:正式站地圖的官方站牌解析器(worker.js 呼叫
    ///    scripts/trtc_board_ledger.mjs 的 `pickBoardCandidate`)一直是這樣分的,更新紀錄 8/14
    ///    也對外寫明「文湖線沒有車次時顯示 BR 路線牌」。小工具照抄同一條規則,才不會
    ///    跟 App 畫出不同顏色。同一批實測:文湖線 248 列【零列】帶車號;{BL,BR} 兩解的
    ///    12 列裡帶車號的全部 join 到 BL(BL14／BL12),零反例。
    /// 全線只有「忠孝復興→南港展覽館」會落到第 3 條(BR 與 BL 只共用這兩站)。
    public static func resolveLine(joined: String?, trainNo: String?, station: String, dest: String,
                                   stationLines: [String], destLines: [String]) -> String? {
        if let joined, !joined.isEmpty { return joined }
        // 終點就是本站的列不談方向,也就分不出線;官方 feed 現況沒有這種列,防禦性擋掉。
        guard station != dest else { return nil }
        let shared = stationLines.filter(destLines.contains)
        if shared.count == 1 { return shared[0] }
        if Set(shared) == ["BL", "BR"] { return (trainNo?.isEmpty == false) ? "BL" : "BR" }
        return nil
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
