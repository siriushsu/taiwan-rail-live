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
        struct BoardRow: Decodable { let name: String; let dest: String; let eta: Double }
        struct Train: Decodable { let stn: String?; let dest: String?; let cars: [Int]? }
        let board: [BoardRow]
        let trains: [Train]?
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
        let rows = mine.map { b -> MetroRow in
            let dest = alias[b.dest] ?? b.dest
            return MetroRow(dest: dest, etaEpoch: b.eta, minutes: nil,
                            crowd: crowdFor(dest: b.dest, trains: r.trains))
        }
        return MetroSnapshot(station: station, dataAt: now, rows: rows, stale: rows.isEmpty)
    }

    /// 下一班的車廂擁擠度:官方 `trains[]` 裡往同一個終點、且還沒過本站的那一台。
    /// 配不到就回 nil——寧可不畫,也不要畫一台別的車的擁擠度。
    private static func crowdFor(dest: String, trains: [TrtcResponse.Train]?) -> [Int]? {
        guard let trains else { return nil }
        return trains.first { $0.dest == dest && ($0.cars?.isEmpty == false) }?.cars
    }

    // MARK: - 高捷／機捷(整數分鐘)

    private struct MinuteResponse: Decodable {
        struct Row: Decodable { let l: String?; let s: String; let d: String; let e: Int? }
        let rows: [Row]
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
        return MetroSnapshot(station: station, dataAt: now, rows: rows, stale: rows.isEmpty)
    }
}
