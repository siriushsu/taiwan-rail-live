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
        let names = ["日", "一", "二", "三", "四", "五", "六"]
        let weekday = calendar.component(.weekday, from: date)
        return names[max(0, min(names.count - 1, weekday - 1))]
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

struct StationRecord: Decodable {
    let n: String
    let s: String
    /// 縣市。v2（2026-07-30）才有，舊 App 寫的檔案是 nil ⇒ 設定畫面退回「依系統分組」。
    let c: String?
}

struct BoardDocument: Decodable {
    let v: Int
    let st: Int
    let sys: String
    let deps: [DepartureRecord]
    let arrs: [ArrivalRecord]
    let pass: [PassRecord]
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

    func stationOptions() throws -> [StationOption] {
        let meta = try meta()
        let stations = try stations().stations
        let labels = Dictionary(uniqueKeysWithValues: meta.systems.map { ($0.id, $0.label) })

        return stations.enumerated().map { index, station in
            StationOption(
                key: StationOption.makeKey(systemID: station.s, name: station.n),
                index: index,
                name: station.n,
                systemID: station.s,
                systemLabel: labels[station.s] ?? station.s,
                region: station.c
            )
        }
    }

    func destinationOptions(from originKey: String) throws -> [StationOption] {
        let allStations = try stationOptions()
        guard let origin = allStations.first(where: { $0.key == originKey }) else { return [] }
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

    /// 設定裡存的是車站鍵、不是班表陣列的索引：索引會因為班表重建而位移，鍵不會。
    /// 站被改名或撤站時回 nil，呼叫端要據此提示重新設定，不可退回索引 0。
    func stationIndex(forKey key: String) throws -> Int? {
        try stationOptions().first(where: { $0.key == key })?.index
    }
}

/// 小工具設定用的車站選項。`key` 是「系統|站名」，在班表更新之間保持穩定。
struct StationOption: Hashable {
    let key: String
    let index: Int
    let name: String
    let systemID: String
    let systemLabel: String
    /// 縣市（v2 起）。nil＝舊資料或查不到，分組時歸到「其他」。
    let region: String?

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
            return "班表只到 \(RailBoardClock.monthDayString(until)) · 請更新軌島"
        case .expired(let source):
            return "依 \(RailBoardClock.monthDayString(source))（同週\(RailBoardClock.weekdayString(source))）班表 · 請更新軌島"
        }
    }
}

struct PreparedBoard {
    let originName: String
    let destinationName: String?
    let system: SystemMetadata
    let typeColors: [String: String]
    let stations: [StationRecord]
    let templates: [JourneyTemplate]
    let journeys: [ScheduledJourney]
    let meta: MetaDocument

    var title: String {
        if let destinationName {
            return "\(originName) → \(destinationName)"
        }
        return originName
    }

    var isWatching: Bool {
        destinationName == nil
    }
}

/// 設定裡「只看這些」的一個勾選項。車種與車次共用同一個複選清單，所以值帶前綴區分。
/// 車種字串可能含 `/`（莒光/復興），但兩者都不含 `|`，用 `|` 當分隔是安全的。
enum BoardFilter: Hashable {
    case trainType(String)
    case trainNumber(String)

    var key: String {
        switch self {
        case .trainType(let value): return "ty|\(value)"
        case .trainNumber(let value): return "no|\(value)"
        }
    }

    init?(key: String) {
        guard let separator = key.firstIndex(of: "|") else { return nil }
        let value = String(key[key.index(after: separator)...])
        guard !value.isEmpty else { return nil }
        switch key[key.startIndex ..< separator] {
        case "ty": self = .trainType(value)
        case "no": self = .trainNumber(value)
        default: return nil
        }
    }
}

/// 勾選是 OR：勾了「自強」與「1112」＝所有自強再加上 1112 那班。全空＝不篩。
/// 認不得的鍵（例如改點後消失的車次）直接忽略，不讓整張看板變空。
struct BoardFilterSet {
    private let types: Set<String>
    private let numbers: Set<String>

    var isEmpty: Bool { types.isEmpty && numbers.isEmpty }

    init(keys: [String]?) {
        let parsed = (keys ?? []).compactMap(BoardFilter.init(key:))
        types = Set(parsed.compactMap { if case .trainType(let v) = $0 { return v } else { return nil } })
        numbers = Set(parsed.compactMap { if case .trainNumber(let v) = $0 { return v } else { return nil } })
    }

    func matches(_ template: JourneyTemplate) -> Bool {
        isEmpty || types.contains(template.trainType) || numbers.contains(template.trainNumber)
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

    func prepare(
        originID: Int,
        destinationID: Int?,
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
