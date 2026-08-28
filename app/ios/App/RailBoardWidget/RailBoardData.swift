//
//  RailBoardData.swift
//  RailBoardWidget
//
//  App Group 資料契約、班表日期計算與台鐵誤點讀取。
//

import Foundation

enum RailBoardConstants {
    static let appGroupID = "group.tw.railisland.app"
    static let liveURL = URL(string: "https://railisland.tw/api/tra-live")!
    static let liveWindow: TimeInterval = 30 * 60
    static let placePassWindow: TimeInterval = 60 * 60
    static let timelineWindow: TimeInterval = 24 * 60 * 60
    static let maximumEntries = 50
}

enum RailBoardClock {
    static let taipeiTimeZone = TimeZone(identifier: "Asia/Taipei")!

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = taipeiTimeZone
        return calendar
    }

    static func startOfDay(for date: Date) -> Date {
        calendar.startOfDay(for: date)
    }

    static func dateByAdding(days: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: days, to: startOfDay(for: date))!
    }

    static func absoluteDate(serviceDay: Date, seconds: Int) -> Date {
        // seconds 刻意不先取餘數：>= 86400 的值必須落在實際的隔日。
        calendar.date(byAdding: .second, value: seconds, to: startOfDay(for: serviceDay))!
    }

    static func timeString(seconds: Int) -> String {
        // 只在顯示鐘面時取餘數；絕對時間仍由 absoluteDate 保留跨日資訊。
        let normalized = ((seconds % 86_400) + 86_400) % 86_400
        return String(format: "%02d:%02d", normalized / 3_600, (normalized % 3_600) / 60)
    }

    static func updateTimeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hant_TW")
        formatter.timeZone = taipeiTimeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    static func monthDayString(_ date: Date) -> String {
        let components = calendar.dateComponents([.month, .day], from: date)
        return "\(components.month ?? 0)/\(components.day ?? 0)"
    }

    static func weekdayString(_ date: Date) -> String {
        if Locale.current.identifier.hasPrefix("zh") {
            let names = ["日", "一", "二", "三", "四", "五", "六"]
            let weekday = calendar.component(.weekday, from: date)
            return names[max(0, min(names.count - 1, weekday - 1))]
        }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.timeZone = taipeiTimeZone
        formatter.dateFormat = "EEE"
        return formatter.string(from: date)
    }

    static func parseDate(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(
            from: DateComponents(
                timeZone: taipeiTimeZone,
                year: parts[0],
                month: parts[1],
                day: parts[2]
            )
        )
    }
}

struct MetaDocument: Decodable {
    let v: Int
    let builtAt: String
    let appBuild: String
    let types: [String: String]
    let systems: [SystemMetadata]
}

struct SystemMetadata: Decodable {
    let id: String
    let label: String
    let from: String?
    let days: Int
    let live: Bool
}

struct StationsDocument: Decodable {
    let v: Int
    let stations: [StationRecord]
}

/// 小工具 extension 內建的輕量車站目錄。只供設定畫面在 App Group 班表尚未完成時選站；
/// 真正的車次與索引仍一律讀共享資料，絕不拿 fallback 猜班次。
private struct FallbackStationsDocument: Decodable {
    let v: Int
    let systems: [String: String]
    let stations: [StationRecord]
}

struct StationRecord: Decodable {
    let n: String
    let s: String
    /// 縣市。v2（2026-07-30）才有，舊 App 寫的檔案是 nil ⇒ 設定畫面退回「依系統分組」。
    let c: String?
    /// 座標。v3（2026-07-30）才有；缺任一欄就不參與「我的地點」最近站計算。
    let la: Double?
    let lo: Double?
}

private struct PlacesDocument: Decodable {
    let v: Int
    let places: [RailBoardPlace]
}

private struct RailBoardPlace: Decodable {
    let label: String
    let lat: Double
    let lon: Double
    let manual: Bool
}

private struct PlaceSelectionKey {
    let lat: Double
    let lon: Double
    let label: String

    init?(key: String) {
        let parts = key.split(
            separator: "|",
            maxSplits: 2,
            omittingEmptySubsequences: false
        )
        guard parts.count == 3, parts[0] == "place" else { return nil }
        let coordinates = parts[1].split(
            separator: ",",
            maxSplits: 1,
            omittingEmptySubsequences: false
        )
        guard
            coordinates.count == 2,
            let lat = Double(coordinates[0]),
            let lon = Double(coordinates[1]),
            lat.isFinite,
            lon.isFinite
        else {
            return nil
        }
        self.lat = lat
        self.lon = lon
        label = String(parts[2])
    }

    static func makeKey(lat: Double, lon: Double, label: String) -> String {
        let coordinates = String(
            format: "%.6f,%.6f",
            locale: Locale(identifier: "en_US_POSIX"),
            lat,
            lon
        )
        return "place|\(coordinates)|\(label)"
    }
}

struct BoardDocument: Decodable {
    let v: Int
    let st: Int
    let sys: String
    let deps: [DepartureRecord]
    let arrs: [ArrivalRecord]
    let pass: [PassRecord]
}

struct PlaceBoardDocument: Decodable {
    let v: Int
    let i: Int
    let label: String
    let lat: Double
    let lon: Double
    let lines: [PlaceBoardLineRecord]

    var unavailableMessage: String? {
        lines.isEmpty ? "1.5 公里內沒有台鐵或高鐵路線" : nil
    }
}

struct PlaceBoardLineRecord: Decodable {
    let id: String
    let sys: String
    let name: String
    let color: String
    let d: Int
    let perp: Int
    let pass: [PlaceBoardPassRecord]
}

struct PlaceBoardPassRecord: Decodable {
    let no: String
    let ty: String
    let to: String
    let at: Int
    let days: Int
    let sys: String
    /// 1＝里程遞增、0＝里程遞減。舊版 App 寫的看板沒有這個欄位，所以是 optional——
    /// 缺值時方向篩選一律放行，升級過程中不會有人看到空看板。
    let dir: Int?

    var isForward: Bool? { dir.map { $0 == 1 } }
}

struct DepartureRecord: Decodable {
    let no: String
    let ty: String
    let dep: Int
    let days: Int
    let to: [[Int]]
}

struct ArrivalRecord: Decodable {
    let no: String
    let ty: String
    let arr: Int
    let days: Int
    let fr: Int
}

struct PassRecord: Decodable {
    let no: String
    let ty: String
    let at: Int
    let days: Int
    let fr: Int
    let en: Int
}

struct LiveResponse: Decodable {
    let at: String
    let trains: [LiveTrain]
}

struct LiveTrain: Decodable {
    let no: String
    let delay: Int
    let sta: String
    let status: Int
}

enum RailBoardDataError: Error {
    case appGroupUnavailable
    case unreadableFile(String)
    case invalidStation
    case missingSystem
    case invalidScheduleStart
}

final class RailBoardStore {
    static let shared = RailBoardStore()

    private let explicitRootURL: URL?
    private let decoder = JSONDecoder()

    init(rootURL: URL? = nil) {
        explicitRootURL = rootURL
    }

    private var rootURL: URL? {
        explicitRootURL
            ?? FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: RailBoardConstants.appGroupID
            )
    }

    private func decode<T: Decodable>(_ type: T.Type, relativePath: String) throws -> T {
        guard let rootURL else {
            throw RailBoardDataError.appGroupUnavailable
        }

        let url = rootURL.appendingPathComponent(relativePath)
        guard let data = try? Data(contentsOf: url),
              let value = try? decoder.decode(type, from: data) else {
            throw RailBoardDataError.unreadableFile(relativePath)
        }
        return value
    }

    func meta() throws -> MetaDocument {
        try decode(MetaDocument.self, relativePath: "meta.json")
    }

    func stations() throws -> StationsDocument {
        try decode(StationsDocument.self, relativePath: "stations.json")
    }

    func board(stationID: Int) throws -> BoardDocument {
        try decode(BoardDocument.self, relativePath: "board/\(stationID).json")
    }

    /// 共站入口（台鐵與高鐵同一個地方）。App 每次重建班表時一併產生，找不到就當作沒有這個功能。
    func composites() -> [CompositeStationRecord] {
        (try? decode(
            [CompositeStationRecord].self,
            relativePath: "composites.json"
        )) ?? []
    }

    /// 鍵存的是站名而不是索引：共站清單會隨班表重建，索引會位移、站名不會
    /// （站名真的改了就當作這個入口消失，退回「找不到這個車站」而不是靜默指到別站）。
    func compositeBoard(forKey key: String) -> PlaceBoardDocument? {
        guard key.hasPrefix(Self.compositeKeyPrefix) else { return nil }
        let label = String(key.dropFirst(Self.compositeKeyPrefix.count))
        guard !label.isEmpty else { return nil }
        let matches = composites().filter { $0.label == label }
        guard matches.count == 1 else { return nil }
        let document = try? decode(
            PlaceBoardDocument.self,
            relativePath: "composite-board/\(matches[0].i).json"
        )
        guard let document, document.v == 1 else { return nil }
        return document
    }

    static let compositeKeyPrefix = "xsta|"
    static let placeKeyPrefix = "place|"

    /// 「我的地點」與「共站」在顯示與篩選上完全一樣，只差看板檔從哪個目錄讀。
    /// 集中在這裡判前綴，呼叫端就不會有人漏掉其中一種（時間軸、快照、篩選清單三處都要）。
    func placeLikeBoard(forKey key: String) -> PlaceBoardDocument? {
        if key.hasPrefix(Self.compositeKeyPrefix) {
            return compositeBoard(forKey: key)
        }
        guard key.hasPrefix(Self.placeKeyPrefix) else { return nil }
        return (try? placeBoard(forKey: key)) ?? nil
    }

    /// 只有仍能在目前 places.json 唯一命中的地點才讀對應索引；搬家後會取新座標，
    /// 改名／刪除／重名則回 nil，交給既有最近站路徑安全降級。
    func placeBoard(forKey key: String) throws -> PlaceBoardDocument? {
        guard
            let selection = PlaceSelectionKey(key: key),
            let rootURL,
            let places = RailBoardPlaces.document(rootURL: rootURL)
        else {
            return nil
        }

        let matches: [(offset: Int, element: RailBoardPlace)]
        if selection.label.isEmpty {
            matches = places.places.enumerated().filter {
                abs($0.element.lat - selection.lat) <= 0.000_001
                    && abs($0.element.lon - selection.lon) <= 0.000_001
            }
        } else {
            matches = places.places.enumerated().filter {
                $0.element.label == selection.label
            }
        }
        guard
            matches.count == 1,
            matches[0].element.lat.isFinite,
            matches[0].element.lon.isFinite
        else {
            return nil
        }

        let index = matches[0].offset
        let place = matches[0].element
        let document = try decode(
            PlaceBoardDocument.self,
            relativePath: "place-board/\(index).json"
        )
        guard
            document.v == 1,
            document.i == index,
            document.label == place.label,
            abs(document.lat - place.lat) <= 0.000_000_1,
            abs(document.lon - place.lon) <= 0.000_000_1
        else {
            return nil
        }
        return document
    }

    func stationOptions() throws -> [StationOption] {
        let meta = try meta()
        let stations = try stations().stations
        let labels = Dictionary(uniqueKeysWithValues: meta.systems.map { ($0.id, $0.label) })

        return makeStationOptions(stations: stations, labels: labels)
    }

    /// App 更新／首次開啟時，完整看板會在背景建立；那段空窗若把讀檔錯誤直接丟回
    /// DynamicOptionsProvider，iOS 會關掉整張小工具設定頁。設定清單因此必須是 no-throw：
    /// 共享資料可讀就用最新版本，否則讀 extension bundle 內的穩定車站鍵目錄。
    func configurationStationOptions() -> [StationOption] {
        if let current = try? stationOptions(), !current.isEmpty {
            return current
        }
        guard
            let url = Bundle.main.url(
                forResource: "RailBoardFallbackStations",
                withExtension: "json"
            ),
            let data = try? Data(contentsOf: url),
            let document = try? decoder.decode(FallbackStationsDocument.self, from: data),
            document.v == 1,
            !document.stations.isEmpty
        else {
            return []
        }
        return makeStationOptions(stations: document.stations, labels: document.systems)
    }

    private func makeStationOptions(
        stations: [StationRecord],
        labels: [String: String]
    ) -> [StationOption] {
        stations.enumerated().map { index, station in
            let coordinate: StationCoordinate?
            if let lat = station.la, let lon = station.lo {
                coordinate = StationCoordinate(lat: lat, lon: lon)
            } else {
                coordinate = nil
            }
            return StationOption(
                key: StationOption.makeKey(systemID: station.s, name: station.n),
                index: index,
                name: station.n,
                systemID: station.s,
                systemLabel: labels[station.s] ?? station.s,
                region: station.c,
                coordinate: coordinate
            )
        }
    }

    /// places.json 是選單捷徑的附加資料；任何讀取／解碼錯誤都回空，不能拖垮既有車站清單。
    func placeStationOptions(from stations: [StationOption]) -> [PlaceStationOption] {
        guard let rootURL else { return [] }
        // 看板只在共站平手時才需要讀，而且同一站會被多個地點重複問到 → 用 cache 擋掉重複解碼。
        var departuresByIndex: [Int: Int] = [:]
        return RailBoardPlaces.options(
            rootURL: rootURL,
            stations: stations,
            departureCount: { index in
                if let cached = departuresByIndex[index] { return cached }
                let count = (try? board(stationID: index))?.deps.count ?? 0
                departuresByIndex[index] = count
                return count
            },
            lineCount: { index in
                (try? self.decode(
                    PlaceBoardDocument.self,
                    relativePath: "place-board/\(index).json"
                ))?.lines.count
            }
        )
    }

    func destinationOptions(from originKey: String) throws -> [StationOption] {
        let allStations = try stationOptions()
        guard let origin = resolveStation(forKey: originKey, stations: allStations)?.station else {
            return []
        }
        let board = try board(stationID: origin.index)
        let reachable = Set(
            board.deps.flatMap { departure in
                departure.to.compactMap { pair in pair.first }
            }
        )

        return reachable.sorted().compactMap { stationID in
            guard allStations.indices.contains(stationID) else { return nil }
            return allStations[stationID]
        }
    }

    /// 舊設定的車站鍵與新設定的地點鍵都在這裡解析；timeline 每次建構都會重解，
    /// 所以同名地點搬家後不必重開設定畫面，就會跟到現在位置的最近站。
    func stationSelection(forKey key: String) throws -> StationSelection? {
        try resolveStation(forKey: key, stations: stationOptions())
    }

    /// 索引會因班表重建而位移，設定只存穩定鍵。解析失敗時回 nil，不可退回索引 0。
    func stationIndex(forKey key: String) throws -> Int? {
        try stationSelection(forKey: key)?.station.index
    }

    private func resolveStation(
        forKey key: String,
        stations: [StationOption]
    ) -> StationSelection? {
        var departuresByIndex: [Int: Int] = [:]
        return RailBoardPlaces.resolve(
            key: key,
            rootURL: rootURL,
            stations: stations
        ) { index in
            if let cached = departuresByIndex[index] { return cached }
            let count = (try? board(stationID: index))?.deps.count ?? 0
            departuresByIndex[index] = count
            return count
        }
    }
}

/// 小工具設定用的車站選項。`key` 是「系統|站名」，在班表更新之間保持穩定。
struct StationCoordinate: Hashable {
    let lat: Double
    let lon: Double
}

struct StationOption: Hashable {
    let key: String
    let index: Int
    let name: String
    let systemID: String
    let systemLabel: String
    /// 縣市（v2 起）。nil＝舊資料或查不到，分組時歸到「其他」。
    let region: String?
    /// 座標（v3 起）。用具名 Hashable 型別，避免 tuple 讓 StationOption 無法合成 Hashable。
    let coordinate: StationCoordinate?

    static func makeKey(systemID: String, name: String) -> String {
        "\(systemID)|\(name)"
    }

    /// 分組標題的順序：由北到南沿著幹線走，找站的人是照地理找不是照筆畫找。
    static let regionOrder = [
        "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
        "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
        "高雄市", "屏東縣", "臺東縣", "花蓮縣", "宜蘭縣",
    ]
}

struct StationSelection {
    let station: StationOption
    /// 只有地點鍵的 label 仍在 places.json 唯一命中時才有值；降級用內嵌座標時為 nil。
    let displayName: String?
}

/// 一個使用者地點解析到既有車站鍵後的選單捷徑。
/// 共站入口的一筆。`i` 只在同一次發布內有效，設定裡存的是 `label`。
struct CompositeStationRecord: Decodable {
    let i: Int
    let label: String
    let subtitle: String
    let lat: Double
    let lon: Double

    var key: String { RailBoardStore.compositeKeyPrefix + label }
}

struct PlaceStationOption {
    let key: String
    let station: StationOption
    let label: String
    let distanceMeters: Double
    let manual: Bool
    let lineCount: Int?

    var displayLabel: String { label.isEmpty ? "未命名地點" : label }

    var subtitle: String {
        guard let lineCount else {
            return "開啟軌島更新附近路線"
        }
        return lineCount == 0
            ? "1.5 公里內沒有路線"
            : "1.5 公里內 \(lineCount) 條路線"
    }
}

private enum RailBoardPlaces {
    private static let maximumDistanceMeters = 5_000.0
    private static let maximumOptions = 20
    /// 共站視為平手的門檻。實測全網 256 站有 12 對站距 < 365m，其中三對是 0.0m
    /// （臺北↔臺北-環島、左營↔左營(舊城)、新城↔新城 (太魯閣)——同一個實體站的兩筆記錄），
    /// 另有七對是台鐵與高鐵同一棟（新左營↔高鐵左營 24m、臺北↔高鐵台北 29m、板橋 56m、
    /// 南港 94m、沙崙↔高鐵台南 112m、六家↔高鐵新竹 122m、豐富↔高鐵苗栗 156m）。
    /// 這些站誰勝出本來由 `stations` 的陣列順序決定＝靠 dense 班表檔的出現順序，
    /// 座標再精準也解決不了。改成 300m 內一律視為平手，取發車數較多的那一筆。
    private static let tieBreakMeters = 300.0

    /// - Parameter departureCount: 站索引 → 該站看板的發車班次數。共站平手時用它決勝，
    ///   讓「家在板橋」落到台鐵板橋而不是只有幾班車的高鐵板橋（使用者 2026-07-30 裁示）。
    static func options(
        rootURL: URL,
        stations: [StationOption],
        departureCount: (Int) -> Int,
        lineCount: (Int) -> Int?
    ) -> [PlaceStationOption] {
        guard let document = document(rootURL: rootURL) else { return [] }

        var candidates: [PlaceStationOption] = []
        for (placeIndex, place) in document.places.enumerated() {
            guard place.lat.isFinite, place.lon.isFinite else { continue }
            guard let nearest = nearestStation(
                lat: place.lat,
                lon: place.lon,
                stations: stations,
                departureCount: departureCount
            ) else {
                continue
            }
            candidates.append(PlaceStationOption(
                key: PlaceSelectionKey.makeKey(
                    lat: place.lat,
                    lon: place.lon,
                    label: place.label
                ),
                station: nearest.station,
                label: place.label,
                distanceMeters: nearest.meters,
                manual: place.manual,
                lineCount: lineCount(placeIndex)
            ))
        }

        return Array(candidates.sorted {
            if $0.manual != $1.manual { return $0.manual && !$1.manual }
            if $0.distanceMeters != $1.distanceMeters {
                return $0.distanceMeters < $1.distanceMeters
            }
            if $0.displayLabel != $1.displayLabel { return $0.displayLabel < $1.displayLabel }
            return $0.key < $1.key
        }.prefix(maximumOptions))
    }

    static func resolve(
        key: String,
        rootURL: URL?,
        stations: [StationOption],
        departureCount: (Int) -> Int
    ) -> StationSelection? {
        guard key.hasPrefix("place|") else {
            return stations.first(where: { $0.key == key }).map {
                StationSelection(station: $0, displayName: nil)
            }
        }
        guard let placeKey = PlaceSelectionKey(key: key) else { return nil }

        let currentPlace: RailBoardPlace?
        if
            !placeKey.label.isEmpty,
            let rootURL,
            let document = document(rootURL: rootURL)
        {
            let matches = document.places.filter { $0.label == placeKey.label }
            if
                matches.count == 1,
                matches[0].lat.isFinite,
                matches[0].lon.isFinite
            {
                currentPlace = matches[0]
            } else {
                currentPlace = nil
            }
        } else {
            currentPlace = nil
        }

        guard let nearest = nearestStation(
            lat: currentPlace?.lat ?? placeKey.lat,
            lon: currentPlace?.lon ?? placeKey.lon,
            stations: stations,
            departureCount: departureCount
        ) else {
            return nil
        }
        return StationSelection(
            station: nearest.station,
            displayName: currentPlace == nil ? nil : placeKey.label
        )
    }

    static func document(rootURL: URL) -> PlacesDocument? {
        let url = rootURL.appendingPathComponent("places.json")
        guard
            let data = try? Data(contentsOf: url),
            let document = try? JSONDecoder().decode(PlacesDocument.self, from: data),
            document.v == 1
        else {
            return nil
        }
        return document
    }

    /// 選單產生與地點鍵解析共用同一支最近站演算法，避免 5 公里／300 公尺平手規則漂移。
    private static func nearestStation(
        lat: Double,
        lon: Double,
        stations: [StationOption],
        departureCount: (Int) -> Int
    ) -> (station: StationOption, meters: Double)? {
        let scored = stations.compactMap { station -> (station: StationOption, meters: Double)? in
            guard let coordinate = station.coordinate else { return nil }
            return (station, haversineMeters(
                lat1: lat,
                lon1: lon,
                lat2: coordinate.lat,
                lon2: coordinate.lon
            ))
        }
        guard
            let closest = scored.min(by: { $0.meters < $1.meters }),
            closest.meters <= maximumDistanceMeters
        else {
            return nil
        }

        // 平手窗內全部視為候選，再依「發車數多 → 距離近 → 車站鍵」決勝。
        // 三段都排完才取第一筆，結果才不依賴 stations 的陣列順序。
        return scored
            .filter { $0.meters <= closest.meters + tieBreakMeters }
            .sorted { lhs, rhs in
                let lhsDepartures = departureCount(lhs.station.index)
                let rhsDepartures = departureCount(rhs.station.index)
                if lhsDepartures != rhsDepartures { return lhsDepartures > rhsDepartures }
                if lhs.meters != rhs.meters { return lhs.meters < rhs.meters }
                return lhs.station.key < rhs.station.key
            }[0]
    }

    private static func haversineMeters(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double
    ) -> Double {
        let radians = Double.pi / 180
        let deltaLat = (lat2 - lat1) * radians
        let deltaLon = (lon2 - lon1) * radians
        let firstLat = lat1 * radians
        let secondLat = lat2 * radians
        let a = sin(deltaLat / 2) * sin(deltaLat / 2)
            + cos(firstLat) * cos(secondLat) * sin(deltaLon / 2) * sin(deltaLon / 2)
        let bounded = min(1, max(0, a))
        return 6_371_000 * 2 * atan2(sqrt(bounded), sqrt(1 - bounded))
    }
}

enum JourneyRelation: String {
    case departure
    case arrival
    case pass
}

struct JourneyTemplate {
    let trainNumber: String
    let trainType: String
    let scheduledSecond: Int
    let daysMask: Int
    let arrivalSecond: Int?
    let destinationID: Int?
    let relation: JourneyRelation
}

struct ScheduledJourney {
    let trainNumber: String
    let trainType: String
    let scheduledSecond: Int
    let scheduledDate: Date
    let arrivalSecond: Int?
    let arrivalDate: Date?
    let destinationName: String?
    let relation: JourneyRelation
    var isLastOfDay: Bool
}

enum ScheduleNotice: Equatable {
    case expiring(until: Date)
    case expired(source: Date)

    var text: String {
        switch self {
        case .expiring(let until):
            return RailNativeL10n.text("班表只到 {date} · 請更新軌島", [
                "date": RailBoardClock.monthDayString(until)
            ])
        case .expired(let source):
            return RailNativeL10n.text("依 {date}（同週{weekday}）班表 · 請更新軌島", [
                "date": RailBoardClock.monthDayString(source),
                "weekday": RailBoardClock.weekdayString(source)
            ])
        }
    }
}

struct PreparedBoard {
    let originName: String
    let destinationName: String?
    let originDisplayName: String?
    let destinationDisplayName: String?
    let system: SystemMetadata
    let typeColors: [String: String]
    let stations: [StationRecord]
    let templates: [JourneyTemplate]
    let journeys: [ScheduledJourney]
    let meta: MetaDocument

    var title: String {
        if let destinationName {
            return "\(originDisplayName ?? originName) → \(destinationDisplayName ?? destinationName)"
        }
        return originDisplayName ?? originName
    }

    var isWatching: Bool {
        destinationName == nil
    }
}

struct ScheduledPlacePass {
    let trainNumber: String
    let trainType: String
    let destinationName: String
    let scheduledSecond: Int
    let scheduledDate: Date
    let systemID: String
}

struct PreparedPlaceLine {
    let id: String
    let systemID: String
    let name: String
    let color: String
    let perpendicularMeters: Int
    let passes: [ScheduledPlacePass]
}

struct PreparedPlaceBoard {
    let title: String
    let lines: [PreparedPlaceLine]
    let typeColors: [String: String]
    let meta: MetaDocument

    var allPasses: [ScheduledPlacePass] {
        lines.flatMap(\.passes).sorted {
            if $0.scheduledDate == $1.scheduledDate {
                if $0.systemID != $1.systemID {
                    return $0.systemID < $1.systemID
                }
                return $0.trainNumber.localizedStandardCompare($1.trainNumber)
                    == .orderedAscending
            }
            return $0.scheduledDate < $1.scheduledDate
        }
    }
}

/// 設定裡「只看這些」的一個勾選項。車種、車次與方向共用同一個複選清單，所以值帶前綴區分。
/// 車種字串可能含 `/`（莒光/復興），但都不含 `|`，用 `|` 當分隔是安全的。
enum BoardFilter: Hashable {
    case trainType(String)
    case trainNumber(String)
    /// 方向綁在線上：同一個地點可能同時有台鐵與高鐵，兩條線的「順里程」是不同的方向。
    case direction(line: String, forward: Bool)

    var key: String {
        switch self {
        case .trainType(let value): return "ty|\(value)"
        case .trainNumber(let value): return "no|\(value)"
        case .direction(let line, let forward): return "dir|\(line)|\(forward ? 1 : 0)"
        }
    }

    init?(key: String) {
        guard let separator = key.firstIndex(of: "|") else { return nil }
        let value = String(key[key.index(after: separator)...])
        guard !value.isEmpty else { return nil }
        switch key[key.startIndex ..< separator] {
        case "ty": self = .trainType(value)
        case "no": self = .trainNumber(value)
        case "dir":
            // 線 id 本身不含 `|`，但用 last 而不是 first 仍比較安全：真的哪天出現含分隔字元的
            // 線 id，壞掉的會是最後一段的旗標而不是靜默對到別條線。
            guard
                let mark = value.lastIndex(of: "|"),
                case let line = String(value[value.startIndex ..< mark]),
                !line.isEmpty
            else {
                return nil
            }
            self = .direction(
                line: line,
                forward: value[value.index(after: mark)...] == "1"
            )
        default: return nil
        }
    }
}

/// 車種與車次之間是 OR：勾了「自強」與「1112」＝所有自強再加上 1112 那班。
/// **方向是另一個維度、與前兩者 AND**——「只看往左營方向的自強」才是使用者要的意思，
/// 若也做成 OR，勾了方向反而會把反方向的自強一起放進來。
/// 全空＝不篩。認不得的鍵（例如改點後消失的車次）直接忽略，不讓整張看板變空。
struct BoardFilterSet {
    private let types: Set<String>
    private let numbers: Set<String>
    /// 鍵是線 id，值是被勾選的方向（可能兩個都勾＝等於沒篩）。
    private let directionsByLine: [String: Set<Bool>]

    var isEmpty: Bool {
        types.isEmpty && numbers.isEmpty && directionsByLine.isEmpty
    }

    init(keys: [String]?) {
        let parsed = (keys ?? []).compactMap(BoardFilter.init(key:))
        types = Set(parsed.compactMap { if case .trainType(let v) = $0 { return v } else { return nil } })
        numbers = Set(parsed.compactMap { if case .trainNumber(let v) = $0 { return v } else { return nil } })
        var directions: [String: Set<Bool>] = [:]
        for filter in parsed {
            if case .direction(let line, let forward) = filter {
                directions[line, default: []].insert(forward)
            }
        }
        directionsByLine = directions
    }

    private var hasTrainFilter: Bool { !types.isEmpty || !numbers.isEmpty }

    private func matchesTrain(trainType: String, trainNumber: String) -> Bool {
        !hasTrainFilter || types.contains(trainType) || numbers.contains(trainNumber)
    }

    func matches(_ template: JourneyTemplate) -> Bool {
        matchesTrain(
            trainType: template.trainType,
            trainNumber: template.trainNumber
        )
    }

    func matches(trainType: String, trainNumber: String) -> Bool {
        matchesTrain(trainType: trainType, trainNumber: trainNumber)
    }

    /// 地點看板專用：多帶一個方向維度。
    /// 沒有勾這條線的方向就不篩這條線——一個地點可能同時有台鐵與高鐵，
    /// 只勾了高鐵方向不該把台鐵整條清空。
    /// `direction` 為 nil＝舊版 App 寫的看板沒有這個欄位，一律視為通過，不讓升級過程中看板變空。
    func matches(
        trainType: String,
        trainNumber: String,
        lineID: String,
        direction: Bool?
    ) -> Bool {
        guard matchesTrain(trainType: trainType, trainNumber: trainNumber) else {
            return false
        }
        guard let allowed = directionsByLine[lineID] else { return true }
        guard let direction else { return true }
        return allowed.contains(direction)
    }
}

/// 設定畫面上的一列。`key` 存進設定，`title`／`subtitle` 只給人看。
struct FilterOption: Hashable {
    let key: String
    let title: String
    let subtitle: String?
}

struct RailBoardEngine {
    let store: RailBoardStore

    init(store: RailBoardStore = .shared) {
        self.store = store
    }

    /// 篩選清單刻意跟看板取同一份 templates：設定裡選得到的，就是看板上會出現的。
    /// 車次取 14 天窗的聯集而不是只有今天——不然週末設定不了平日的通勤車。
    func filterOptions(
        originID: Int,
        destinationID: Int?
    ) throws -> (types: [FilterOption], trains: [FilterOption]) {
        let stations = try store.stations().stations
        let board = try store.board(stationID: originID)
        let templates = matchingTemplates(board: board, destinationID: destinationID)

        var countByType: [String: Int] = [:]
        for template in templates {
            countByType[template.trainType, default: 0] += 1
        }
        let sortedTypes: [(type: String, count: Int)] = countByType
            .map { (type: $0.key, count: $0.value) }
            .sorted { lhs, rhs in
                lhs.count == rhs.count ? lhs.type < rhs.type : lhs.count > rhs.count
            }
        let types: [FilterOption] = sortedTypes.map { entry in
            FilterOption(
                key: BoardFilter.trainType(entry.type).key,
                title: entry.type,
                subtitle: "\(entry.count) 班"
            )
        }

        var seen = Set<String>()
        let trains = templates.compactMap { template -> FilterOption? in
            guard seen.insert(template.trainNumber).inserted else { return nil }
            let time = RailBoardClock.timeString(seconds: template.scheduledSecond)
            let terminus = template.destinationID.flatMap { id in
                stations.indices.contains(id) ? stations[id].n : nil
            }
            let subtitle: String?
            if let arrivalSecond = template.arrivalSecond {
                subtitle = "\(RailBoardClock.timeString(seconds: arrivalSecond)) 抵達"
            } else {
                switch template.relation {
                case .departure: subtitle = terminus.map { "往\($0)" }
                case .arrival: subtitle = "終到本站"
                case .pass: subtitle = terminus.map { "通過 · 往\($0)" } ?? "通過"
                }
            }
            return FilterOption(
                key: BoardFilter.trainNumber(template.trainNumber).key,
                title: "\(time)　\(template.trainType) \(template.trainNumber)",
                subtitle: subtitle
            )
        }

        return (types, trains)
    }

    /// 每條線每個方向一個選項。標題用「往 X 方向」，X 取這條線這個方向裡最常見的終點站——
    /// 不寫死「北上／南下」是因為支線（平溪、集集、深澳）根本沒有南北可言，
    /// 而終點站名是資料自己講的話，換班表也不會過期。
    /// 旗標值（順里程／逆里程）才是存進設定的鍵，終點站名只拿來顯示，
    /// 所以就算某天最常見的終點換人，既有設定仍指著同一個方向。
    func directionOptions(
        placeBoard: PlaceBoardDocument
    ) -> [FilterOption] {
        placeBoard.lines.flatMap { line -> [FilterOption] in
            var byDirection: [Bool: [String: Int]] = [:]
            for pass in line.pass {
                guard let forward = pass.isForward else { continue }
                byDirection[forward, default: [:]][pass.to, default: 0] += 1
            }
            // 只有一個方向的線（支線末端、單向環島）不必給選項——勾了等於沒勾。
            guard byDirection.count > 1 else { return [] }

            return byDirection.keys.sorted { lhs, _ in lhs }.compactMap { forward in
                guard let destinations = byDirection[forward] else { return nil }
                let total = destinations.values.reduce(0, +)
                let dominant = destinations.max {
                    if $0.value != $1.value { return $0.value < $1.value }
                    return $1.key < $0.key
                }
                guard let dominant else { return nil }
                return FilterOption(
                    key: BoardFilter.direction(line: line.id, forward: forward).key,
                    title: "往 \(dominant.key) 方向",
                    subtitle: "\(line.name) · \(total) 班"
                )
            }
        }
    }

    func filterOptions(
        placeBoard: PlaceBoardDocument
    ) throws -> (types: [FilterOption], trains: [FilterOption]) {
        var countByType: [String: Int] = [:]
        for pass in placeBoard.lines.flatMap(\.pass) {
            countByType[pass.ty, default: 0] += 1
        }
        let typeCounts: [(type: String, count: Int)] = countByType.map {
            (type: $0.key, count: $0.value)
        }
        let sortedTypeCounts = typeCounts.sorted { lhs, rhs in
            if lhs.count != rhs.count { return lhs.count > rhs.count }
            return lhs.type < rhs.type
        }
        let types: [FilterOption] = sortedTypeCounts.map { entry in
            FilterOption(
                key: BoardFilter.trainType(entry.type).key,
                title: entry.type,
                subtitle: "\(entry.count) 班"
            )
        }

        var seen = Set<String>()
        let trains = placeBoard.lines.flatMap { line in
            line.pass.map { (line, $0) }
        }.sorted {
            if $0.1.at != $1.1.at { return $0.1.at < $1.1.at }
            if $0.1.sys != $1.1.sys { return $0.1.sys < $1.1.sys }
            return $0.1.no.localizedStandardCompare($1.1.no) == .orderedAscending
        }.compactMap { line, pass -> FilterOption? in
            let identity = "\(pass.sys)|\(pass.no)"
            guard seen.insert(identity).inserted else { return nil }
            return FilterOption(
                key: BoardFilter.trainNumber(pass.no).key,
                title: "\(RailBoardClock.timeString(seconds: pass.at))　\(pass.ty) \(pass.no)",
                subtitle: "\(line.name) · 往\(pass.to)"
            )
        }
        return (types, trains)
    }

    func prepare(
        placeBoard: PlaceBoardDocument,
        filters: BoardFilterSet = BoardFilterSet(keys: nil),
        now: Date
    ) throws -> PreparedPlaceBoard {
        let meta = try store.meta()
        let systems = Dictionary(
            uniqueKeysWithValues: meta.systems.map { ($0.id, $0) }
        )
        let today = RailBoardClock.startOfDay(for: now)
        let horizon = now.addingTimeInterval(RailBoardConstants.timelineWindow)

        let lines = placeBoard.lines.map { line in
            guard let system = systems[line.sys] else {
                return PreparedPlaceLine(
                    id: line.id,
                    systemID: line.sys,
                    name: line.name,
                    color: line.color,
                    perpendicularMeters: line.perp,
                    passes: []
                )
            }

            var scheduled: [ScheduledPlacePass] = []
            for dayOffset in -1 ... 2 {
                let serviceDay = RailBoardClock.dateByAdding(
                    days: dayOffset,
                    to: today
                )
                guard let sourceIndex = sourceIndex(
                    actualServiceDay: serviceDay,
                    system: system
                ) else {
                    continue
                }
                for pass in line.pass where
                    pass.sys == line.sys
                        && filters.matches(
                            trainType: pass.ty,
                            trainNumber: pass.no,
                            lineID: line.id,
                            direction: pass.isForward
                        )
                {
                    if system.days > 0 {
                        guard
                            sourceIndex >= 0,
                            sourceIndex < system.days,
                            (pass.days & (1 << sourceIndex)) != 0
                        else {
                            continue
                        }
                    }
                    let scheduledDate = RailBoardClock.absoluteDate(
                        serviceDay: serviceDay,
                        seconds: pass.at
                    )
                    guard scheduledDate > now, scheduledDate <= horizon else {
                        continue
                    }
                    scheduled.append(ScheduledPlacePass(
                        trainNumber: pass.no,
                        trainType: pass.ty,
                        destinationName: pass.to,
                        scheduledSecond: pass.at,
                        scheduledDate: scheduledDate,
                        systemID: pass.sys
                    ))
                }
            }
            scheduled.sort {
                if $0.scheduledDate == $1.scheduledDate {
                    return $0.trainNumber.localizedStandardCompare($1.trainNumber)
                        == .orderedAscending
                }
                return $0.scheduledDate < $1.scheduledDate
            }
            return PreparedPlaceLine(
                id: line.id,
                systemID: line.sys,
                name: line.name,
                color: line.color,
                perpendicularMeters: line.perp,
                passes: scheduled
            )
        }

        return PreparedPlaceBoard(
            title: placeBoard.label.isEmpty ? "未命名地點" : placeBoard.label,
            lines: lines,
            typeColors: meta.types,
            meta: meta
        )
    }

    func prepare(
        originID: Int,
        destinationID: Int?,
        originDisplayName: String? = nil,
        destinationDisplayName: String? = nil,
        filters: BoardFilterSet = BoardFilterSet(keys: nil),
        now: Date
    ) throws -> PreparedBoard {
        let meta = try store.meta()
        let stations = try store.stations().stations
        let board = try store.board(stationID: originID)

        guard stations.indices.contains(originID), board.st == originID else {
            throw RailBoardDataError.invalidStation
        }
        guard let system = meta.systems.first(where: { $0.id == board.sys }) else {
            throw RailBoardDataError.missingSystem
        }

        let destinationName: String?
        if let destinationID {
            guard stations.indices.contains(destinationID) else {
                throw RailBoardDataError.invalidStation
            }
            destinationName = stations[destinationID].n
        } else {
            destinationName = nil
        }

        let templates = matchingTemplates(board: board, destinationID: destinationID)
            .filter { filters.matches($0) }
        let today = RailBoardClock.startOfDay(for: now)
        var allJourneys: [ScheduledJourney] = []

        // 前一天用來接住 seconds >= 86400 的跨日車；後兩天涵蓋 24 小時窗與「明天第一班」。
        for dayOffset in -1 ... 2 {
            let serviceDay = RailBoardClock.dateByAdding(days: dayOffset, to: today)
            allJourneys.append(
                contentsOf: journeys(
                    templates: templates,
                    system: system,
                    stations: stations,
                    actualServiceDay: serviceDay
                )
            )
        }

        allJourneys.sort { lhs, rhs in
            if lhs.scheduledDate == rhs.scheduledDate {
                return lhs.trainNumber.localizedStandardCompare(rhs.trainNumber) == .orderedAscending
            }
            return lhs.scheduledDate < rhs.scheduledDate
        }
        markLastJourneysByCalendarDay(&allJourneys)

        let future = allJourneys.filter { $0.scheduledDate > now }
        let horizon = now.addingTimeInterval(RailBoardConstants.timelineWindow)
        var visibleJourneys = future.filter { $0.scheduledDate <= horizon }

        // 若整個今天都沒有車，仍保留明天第一班，即使它略超出嚴格的 24 小時窗。
        if visibleJourneys.isEmpty, let firstFuture = future.first {
            visibleJourneys = [firstFuture]
        }

        return PreparedBoard(
            originName: stations[originID].n,
            destinationName: destinationName,
            originDisplayName: originDisplayName,
            destinationDisplayName: destinationDisplayName,
            system: system,
            typeColors: meta.types,
            stations: stations,
            templates: templates,
            journeys: visibleJourneys,
            meta: meta
        )
    }

    func matchingTemplates(board: BoardDocument, destinationID: Int?) -> [JourneyTemplate] {
        if let destinationID {
            return board.deps.compactMap { departure in
                guard let destination = departure.to.first(where: {
                    $0.count >= 2 && $0[0] == destinationID
                }) else {
                    return nil
                }

                return JourneyTemplate(
                    trainNumber: departure.no,
                    trainType: departure.ty,
                    scheduledSecond: departure.dep,
                    daysMask: departure.days,
                    arrivalSecond: destination[1],
                    destinationID: destinationID,
                    relation: .departure
                )
            }
        }

        var watching: [JourneyTemplate] = board.deps.map { departure in
            JourneyTemplate(
                trainNumber: departure.no,
                trainType: departure.ty,
                scheduledSecond: departure.dep,
                daysMask: departure.days,
                arrivalSecond: nil,
                destinationID: departure.to.last?.first,
                relation: .departure
            )
        }
        watching.append(
            contentsOf: board.arrs.map { arrival in
                JourneyTemplate(
                    trainNumber: arrival.no,
                    trainType: arrival.ty,
                    scheduledSecond: arrival.arr,
                    daysMask: arrival.days,
                    arrivalSecond: nil,
                    destinationID: nil,
                    relation: .arrival
                )
            }
        )
        watching.append(
            contentsOf: board.pass.map { passing in
                JourneyTemplate(
                    trainNumber: passing.no,
                    trainType: passing.ty,
                    scheduledSecond: passing.at,
                    daysMask: passing.days,
                    arrivalSecond: nil,
                    destinationID: passing.en,
                    relation: .pass
                )
            }
        )
        return watching.sorted {
            if $0.scheduledSecond == $1.scheduledSecond {
                return $0.trainNumber.localizedStandardCompare($1.trainNumber) == .orderedAscending
            }
            return $0.scheduledSecond < $1.scheduledSecond
        }
    }

    func journeys(
        templates: [JourneyTemplate],
        system: SystemMetadata,
        stations: [StationRecord],
        actualServiceDay: Date
    ) -> [ScheduledJourney] {
        guard let sourceDay = scheduleSourceDay(for: actualServiceDay, system: system) else {
            return []
        }

        let sourceIndex: Int
        if system.days == 0 {
            sourceIndex = 0
        } else {
            guard let fromValue = system.from,
                  let fromDate = RailBoardClock.parseDate(fromValue) else {
                return []
            }
            sourceIndex = RailBoardClock.calendar.dateComponents(
                [.day],
                from: fromDate,
                to: sourceDay
            ).day ?? -1
        }

        return templates.compactMap { template in
            if system.days > 0 {
                guard sourceIndex >= 0,
                      sourceIndex < system.days,
                      (template.daysMask & (1 << sourceIndex)) != 0 else {
                    return nil
                }
            }

            let scheduledDate = RailBoardClock.absoluteDate(
                serviceDay: actualServiceDay,
                seconds: template.scheduledSecond
            )
            let arrivalDate = template.arrivalSecond.map {
                RailBoardClock.absoluteDate(serviceDay: actualServiceDay, seconds: $0)
            }
            let destinationName = template.destinationID.flatMap { stationID -> String? in
                guard stations.indices.contains(stationID) else { return nil }
                return stations[stationID].n
            }

            return ScheduledJourney(
                trainNumber: template.trainNumber,
                trainType: template.trainType,
                scheduledSecond: template.scheduledSecond,
                scheduledDate: scheduledDate,
                arrivalSecond: template.arrivalSecond,
                arrivalDate: arrivalDate,
                destinationName: destinationName,
                relation: template.relation,
                isLastOfDay: false
            )
        }
    }

    func notice(for date: Date, system: SystemMetadata) -> ScheduleNotice? {
        guard system.days > 0,
              let fromValue = system.from,
              let fromDate = RailBoardClock.parseDate(fromValue) else {
            return nil
        }

        let day = RailBoardClock.startOfDay(for: date)
        let endExclusive = RailBoardClock.dateByAdding(days: system.days, to: fromDate)
        if day >= endExclusive {
            guard let source = scheduleSourceDay(for: day, system: system) else { return nil }
            return .expired(source: source)
        }

        guard day >= fromDate else { return nil }
        let daysRemaining = RailBoardClock.calendar.dateComponents(
            [.day],
            from: day,
            to: endExclusive
        ).day ?? Int.max
        if daysRemaining <= 3 {
            let lastDay = RailBoardClock.dateByAdding(days: -1, to: endExclusive)
            return .expiring(until: lastDay)
        }
        return nil
    }

    func scheduleSourceDay(for actualDay: Date, system: SystemMetadata) -> Date? {
        let actualDay = RailBoardClock.startOfDay(for: actualDay)
        guard system.days > 0 else {
            return actualDay
        }
        guard let fromValue = system.from,
              let fromDate = RailBoardClock.parseDate(fromValue) else {
            return nil
        }

        let endExclusive = RailBoardClock.dateByAdding(days: system.days, to: fromDate)
        if actualDay >= fromDate, actualDay < endExclusive {
            return actualDay
        }
        guard actualDay >= endExclusive else {
            return nil
        }

        let targetWeekday = RailBoardClock.calendar.component(.weekday, from: actualDay)
        return (0 ..< system.days)
            .map { RailBoardClock.dateByAdding(days: $0, to: fromDate) }
            .filter { RailBoardClock.calendar.component(.weekday, from: $0) == targetWeekday }
            .min { lhs, rhs in
                abs(lhs.timeIntervalSince(actualDay)) < abs(rhs.timeIntervalSince(actualDay))
            }
    }

    private func sourceIndex(
        actualServiceDay: Date,
        system: SystemMetadata
    ) -> Int? {
        guard let sourceDay = scheduleSourceDay(
            for: actualServiceDay,
            system: system
        ) else {
            return nil
        }
        guard system.days > 0 else { return 0 }
        guard
            let fromValue = system.from,
            let fromDate = RailBoardClock.parseDate(fromValue)
        else {
            return nil
        }
        return RailBoardClock.calendar.dateComponents(
            [.day],
            from: fromDate,
            to: sourceDay
        ).day
    }

    private func markLastJourneysByCalendarDay(_ journeys: inout [ScheduledJourney]) {
        var lastIndexByDay: [Date: Int] = [:]
        for index in journeys.indices {
            let day = RailBoardClock.startOfDay(for: journeys[index].scheduledDate)
            lastIndexByDay[day] = index
        }
        for index in lastIndexByDay.values {
            journeys[index].isLastOfDay = true
        }
    }
}

struct RailBoardLiveClient {
    func fetchDelays() async -> [String: Int] {
        var request = URLRequest(url: RailBoardConstants.liveURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200 else {
                return [:]
            }
            let live = try JSONDecoder().decode(LiveResponse.self, from: data)
            return live.trains.reduce(into: [String: Int]()) { delays, train in
                if train.delay > 0 {
                    delays[train.no] = max(delays[train.no] ?? 0, train.delay)
                }
            }
        } catch {
            return [:]
        }
    }
}
