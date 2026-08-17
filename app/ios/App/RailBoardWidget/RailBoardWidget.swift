//
//  RailBoardWidget.swift
//  RailBoardWidget
//
//  Created by 許翔 on 2026/7/29.
//

import AppIntents
import SwiftUI
import WidgetKit

struct BoardRow: Identifiable {
    let trainNumber: String
    let trainType: String
    let scheduledSecond: Int
    let scheduledDate: Date
    let arrivalSecond: Int?
    let arrivalDate: Date?
    let destinationName: String?
    let relation: JourneyRelation
    let delay: Int?
    let isLastOfDay: Bool

    var id: String {
        "\(scheduledDate.timeIntervalSince1970)-\(relation.rawValue)-\(trainNumber)"
    }

    var scheduledTime: String {
        RailBoardClock.timeString(seconds: scheduledSecond)
    }

    var arrivalText: String? {
        guard let arrivalSecond else { return nil }
        let nextDay = arrivalSecond >= 86_400 ? " 隔日" : ""
        return "抵 \(RailBoardClock.timeString(seconds: arrivalSecond))\(nextDay)"
    }

    var watchingDestinationText: String {
        switch relation {
        case .arrival:
            return "終點"
        case .departure, .pass:
            return "往 \(destinationName ?? "未標示")"
        }
    }

    var isPassing: Bool {
        relation == .pass
    }

    /// 誤點分鐘（只取正值）。負值（早到）不推遲也不提前倒數：班表是對外承諾，早到不是可依賴的事實。
    var lateMinutes: Int { max(0, delay ?? 0) }

    /// 倒數要算的那個時刻。設計稿：「誤點 · 倒數已含誤點」——示範是
    /// 「11:35 開 → 11:41」配「4 分」，也就是倒數算到 11:41 不是 11:35。
    var effectiveDate: Date {
        scheduledDate.addingTimeInterval(Double(lateMinutes) * 60)
    }

    /// 誤點後的實際時刻（沒誤點時與 scheduledTime 相同）。
    var effectiveTime: String {
        RailBoardClock.timeString(seconds: scheduledSecond + lateMinutes * 60)
    }

    /// 這一列的動作詞。發車看板同時放得到三種關係，用錯詞會害人算錯時間：
    /// 停靠站是「開」、通過點是「通過」、終到列車是「抵」。
    var relationWord: String {
        switch relation {
        case .departure: return "開"
        case .pass:      return "通過"
        case .arrival:   return "抵"
        }
    }

    /// 設計稿：「11:35 開 → 11:41」。誤點時兩個時刻都給——只給誤點分鐘的話，
    /// 使用者要自己做加法才能對上月台廣播。
    var departureText: String {
        lateMinutes > 0
            ? "\(scheduledTime) \(relationWord) → \(effectiveTime)"
            : "\(scheduledTime) \(relationWord)"
    }

    /// 準點／誤點標。
    /// 🔴 `nil` 與「準點」是兩件事：nil＝官方沒有這班車的即時讀數（未發車、非即時系統如高鐵），
    ///    畫「準點」等於替官方背書一件沒查到的事。所以只有真的拿到讀數才畫。
    var statusKind: RailStatusTag.Kind? {
        delay.map { .delay($0) }
    }
}

/// 發車看板的倒數形態。與捷運的 `MetroCountdown` 平行，兩邊都只是把
/// 「還剩多久」對映到共用元件的 `RailCountdown`。
enum BoardCountdown {
    /// 超過這個距離就不倒數，改畫時刻。
    ///
    /// 🔴 為什麼要有門檻：`RailCountdown` 只有「分」這一個單位（設計稿：分／秒／進站／暫無資料
    ///    四型），而發車看板【真的會】排到幾小時後的班次——加了目的地與車種篩選之後，
    ///    深夜的下一班直達可能在 8 小時後，那時畫出來是「480 分」，讀不出來。
    ///    90 分鐘＝再遠就沒有人在月台上等了，時刻比倒數有用。
    static let clockThreshold: TimeInterval = 90 * 60

    static func of(effective: Date, clock: String, at date: Date) -> RailCountdown {
        let left = effective.timeIntervalSince(date)
        if left >= clockThreshold { return .scheduled(clock) }
        return .from(secondsLeft: left, surface: .widget)
    }

    static func of(row: BoardRow, at date: Date) -> RailCountdown {
        of(effective: row.effectiveDate, clock: row.effectiveTime, at: date)
    }

    static func of(row: PlaceBoardRow, at date: Date) -> RailCountdown {
        of(effective: row.scheduledDate, clock: row.scheduledTime, at: date)
    }

    /// 倒數是不是已經退成靜態時刻（呼叫端據此決定註腳要不要再重複一次時刻）。
    static func isClock(effective: Date, at date: Date) -> Bool {
        effective.timeIntervalSince(date) >= clockThreshold
    }

    /// 逐分鐘翻頁的 entry 時刻。
    ///
    /// 🔴 改版後倒數是【靜態文字】（設計稿：「Widget 用 TimelineProvider 逐分鐘 entry，
    ///    不做秒級」），不再是會自己走的 `Text(style: .relative)` ⇒ 每一次分鐘翻頁都必須
    ///    自己排一個 entry，否則畫面上的「5 分」會一直凍在那裡直到下一班發車。
    ///    只排 clockThreshold 以內的翻頁：更遠的班次畫的是時刻，不會變。
    static func minuteBoundaries(
        of dates: [Date],
        after now: Date,
        until horizon: Date
    ) -> [Date] {
        var set = Set<Date>()
        let steps = Int(clockThreshold / 60)
        for date in dates {
            for k in 1...steps {
                // +1 秒：落在翻頁【之後】，避免與邊界同秒時 Int(s/60) 還算成上一分鐘。
                let t = date.addingTimeInterval(-Double(k) * 60 + 1)
                if t > now && t <= horizon { set.insert(t) }
            }
            // 發車後 1 秒：讓這一列從卡上退場（否則「進站」會留在畫面上直到下次刷新）。
            let gone = date.addingTimeInterval(1)
            if gone > now && gone <= horizon { set.insert(gone) }
        }
        return set.sorted()
    }
}

struct BoardSnapshot {
    let title: String
    let isWatching: Bool
    let isLive: Bool
    let typeColors: [String: String]
    let rows: [BoardRow]
    let emptyMessage: String?
    let notice: ScheduleNotice?
    let generatedAt: Date
}

struct PlaceBoardRow: Identifiable {
    let trainNumber: String
    let trainType: String
    let destinationName: String
    let scheduledSecond: Int
    let scheduledDate: Date
    let systemID: String

    var id: String {
        "\(systemID)-\(scheduledDate.timeIntervalSince1970)-\(trainNumber)"
    }

    var scheduledTime: String {
        RailBoardClock.timeString(seconds: scheduledSecond)
    }
}

struct PlaceLineSnapshot: Identifiable {
    let id: String
    let name: String
    let color: String
    let perpendicularMeters: Int
    let rows: [PlaceBoardRow]
}

struct PlaceBoardSnapshot {
    let title: String
    let lines: [PlaceLineSnapshot]
    let typeColors: [String: String]
    let generatedAt: Date
}

enum RailBoardEntryContent {
    case board(BoardSnapshot)
    case place(PlaceBoardSnapshot)
    case unavailable(String)
}

struct RailBoardEntry: TimelineEntry {
    let date: Date
    let configuration: ConfigurationAppIntent
    let content: RailBoardEntryContent
}

struct Provider: AppIntentTimelineProvider {
    private let engine = RailBoardEngine()
    private let liveClient = RailBoardLiveClient()

    func placeholder(in context: Context) -> RailBoardEntry {
        RailBoardEntry(
            date: .now,
            configuration: .previewCommute,
            content: .board(.preview)
        )
    }

    func snapshot(
        for configuration: ConfigurationAppIntent,
        in context: Context
    ) async -> RailBoardEntry {
        if context.isPreview {
            return placeholder(in: context)
        }
        return await currentEntry(for: configuration, now: .now)
    }

    func timeline(
        for configuration: ConfigurationAppIntent,
        in context: Context
    ) async -> Timeline<RailBoardEntry> {
        let now = Date()

        guard let originKey = configuration.origin else {
            let message = (try? RailBoardStore.shared.meta()) == nil
                ? "開啟軌島以載入班表"
                : "請選擇起站"
            let entry = RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable(message)
            )
            return Timeline(entries: [entry], policy: .never)
        }

        do {
            if
                let placeBoard = RailBoardStore.shared.placeLikeBoard(forKey: originKey)
            {
                return placeTimeline(
                    placeBoard: placeBoard,
                    configuration: configuration,
                    now: now
                )
            }

            let filters = BoardFilterSet(keys: configuration.filters)
            let prepared: PreparedBoard
            if RailBoardStore.shared.isCompositeKey(originKey) {
                // 🔴 共站走成員站的官方發車看板。舊格式（沒有成員站）就明說要開一次 App，
                //    不准退回幾何共站看板——那條路會把有月台的車站寫成「經過」。
                guard let composite = RailBoardStore.shared.compositeSelection(forKey: originKey) else {
                    let entry = RailBoardEntry(
                        date: now,
                        configuration: configuration,
                        content: .unavailable("開啟軌島一次以更新共站班表")
                    )
                    return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(15 * 60)))
                }
                prepared = try engine.prepare(composite: composite, filters: filters, now: now)
            } else {
                let originSelection = try RailBoardStore.shared.stationSelection(forKey: originKey)
                let destinationSelection = try configuration.destination.flatMap {
                    try RailBoardStore.shared.stationSelection(forKey: $0)
                }
                let destinationLost = configuration.destination != nil && destinationSelection == nil
                guard let originSelection, !destinationLost else {
                    let entry = RailBoardEntry(
                        date: now,
                        configuration: configuration,
                        content: .unavailable("找不到這個車站，請重新設定")
                    )
                    return Timeline(entries: [entry], policy: .never)
                }
                prepared = try engine.prepare(
                    originID: originSelection.station.index,
                    destinationID: destinationSelection?.station.index,
                    originDisplayName: originSelection.displayName,
                    destinationDisplayName: destinationSelection?.displayName,
                    filters: filters,
                    now: now
                )
            }
            guard !prepared.journeys.isEmpty || filters.isEmpty else {
                let entry = RailBoardEntry(
                    date: now,
                    configuration: configuration,
                    content: .unavailable("所選班次近期沒有行駛")
                )
                return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(60 * 60)))
            }

            let nextJourney = prepared.journeys.first
            let shouldFetchLive = prepared.anyLive
                && nextJourney.map {
                    $0.scheduledDate.timeIntervalSince(now) <= RailBoardConstants.liveWindow
                } == true
            let delays = shouldFetchLive ? await liveClient.fetchDelays() : [:]
            let entries = makeEntries(
                prepared: prepared,
                configuration: configuration,
                generatedAt: now,
                delays: delays
            )

            return Timeline(
                entries: entries,
                policy: reloadPolicy(prepared: prepared, entries: entries, now: now)
            )
        } catch {
            let entry = RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable("開啟軌島以載入班表")
            )
            return Timeline(
                entries: [entry],
                policy: .after(now.addingTimeInterval(15 * 60))
            )
        }
    }

    private func currentEntry(
        for configuration: ConfigurationAppIntent,
        now: Date
    ) async -> RailBoardEntry {
        guard let originKey = configuration.origin else {
            let message = (try? RailBoardStore.shared.meta()) == nil
                ? "開啟軌島以載入班表"
                : "請選擇起站"
            return RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable(message)
            )
        }

        do {
            if
                let placeBoard = RailBoardStore.shared.placeLikeBoard(forKey: originKey)
            {
                return placeEntry(
                    placeBoard: placeBoard,
                    configuration: configuration,
                    now: now
                )
            }

            let filters = BoardFilterSet(keys: configuration.filters)
            let prepared: PreparedBoard
            if RailBoardStore.shared.isCompositeKey(originKey) {
                guard let composite = RailBoardStore.shared.compositeSelection(forKey: originKey) else {
                    return RailBoardEntry(
                        date: now,
                        configuration: configuration,
                        content: .unavailable("開啟軌島一次以更新共站班表")
                    )
                }
                prepared = try engine.prepare(composite: composite, filters: filters, now: now)
            } else {
                let originSelection = try RailBoardStore.shared.stationSelection(forKey: originKey)
                let destinationSelection = try configuration.destination.flatMap {
                    try RailBoardStore.shared.stationSelection(forKey: $0)
                }
                let destinationLost = configuration.destination != nil && destinationSelection == nil
                guard let originSelection, !destinationLost else {
                    return RailBoardEntry(
                        date: now,
                        configuration: configuration,
                        content: .unavailable("找不到這個車站，請重新設定")
                    )
                }
                prepared = try engine.prepare(
                    originID: originSelection.station.index,
                    destinationID: destinationSelection?.station.index,
                    originDisplayName: originSelection.displayName,
                    destinationDisplayName: destinationSelection?.displayName,
                    filters: filters,
                    now: now
                )
            }
            guard !prepared.journeys.isEmpty || filters.isEmpty else {
                return RailBoardEntry(
                    date: now,
                    configuration: configuration,
                    content: .unavailable("所選班次近期沒有行駛")
                )
            }

            let shouldFetchLive = prepared.anyLive
                && prepared.journeys.first.map {
                    $0.scheduledDate.timeIntervalSince(now) <= RailBoardConstants.liveWindow
                } == true
            let delays = shouldFetchLive ? await liveClient.fetchDelays() : [:]
            return entry(
                prepared: prepared,
                configuration: configuration,
                at: now,
                generatedAt: now,
                delays: delays
            )
        } catch {
            return RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable("開啟軌島以載入班表")
            )
        }
    }

    private func makeEntries(
        prepared: PreparedBoard,
        configuration: ConfigurationAppIntent,
        generatedAt: Date,
        delays: [String: Int]
    ) -> [RailBoardEntry] {
        let horizon = generatedAt.addingTimeInterval(RailBoardConstants.timelineWindow)
        // 🔴 倒數改成靜態文字之後，光排「發車那一刻」不夠：畫面上的「5 分」會從現在一路凍到
        //    那班車開走。所以改排每一次分鐘翻頁（只排 90 分鐘內的，更遠的畫的是時刻不會變）。
        //    誤點會推遲那個時刻 ⇒ 邊界要用 effectiveDate 算，不是 scheduledDate。
        let anchors = prepared.journeys
            .prefix(RailBoardConstants.maximumEntries)
            .map { journey -> Date in
                let late = max(0, prepared.isLive(systemID: journey.systemID)
                    ? (delays[journey.trainNumber] ?? 0) : 0)
                return journey.scheduledDate.addingTimeInterval(Double(late) * 60)
            }
        let transitionDates = BoardCountdown
            .minuteBoundaries(of: Array(anchors), after: generatedAt, until: horizon)
            .prefix(RailBoardConstants.maximumEntries - 1)

        let dates = [generatedAt] + transitionDates
        return dates.map { entryDate in
            let delaySnapshot = entryDate.timeIntervalSince(generatedAt) <= RailBoardConstants.liveWindow
                ? delays
                : [:]
            return entry(
                prepared: prepared,
                configuration: configuration,
                at: entryDate,
                generatedAt: generatedAt,
                delays: delaySnapshot
            )
        }
    }

    private func placeTimeline(
        placeBoard: PlaceBoardDocument,
        configuration: ConfigurationAppIntent,
        now: Date
    ) -> Timeline<RailBoardEntry> {
        if let message = placeBoard.unavailableMessage {
            let entry = RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable(message)
            )
            return Timeline(
                entries: [entry],
                policy: .after(now.addingTimeInterval(60 * 60))
            )
        }

        do {
            let filters = BoardFilterSet(keys: configuration.filters)
            let prepared = try engine.prepare(
                placeBoard: placeBoard,
                filters: filters,
                now: now
            )
            guard !prepared.allPasses.isEmpty || filters.isEmpty else {
                let entry = RailBoardEntry(
                    date: now,
                    configuration: configuration,
                    content: .unavailable("所選班次近期沒有行駛")
                )
                return Timeline(
                    entries: [entry],
                    policy: .after(now.addingTimeInterval(60 * 60))
                )
            }
            let entries = makePlaceEntries(
                prepared: prepared,
                configuration: configuration,
                generatedAt: now
            )
            return Timeline(
                entries: entries,
                policy: entries.count > 1
                    ? .atEnd
                    : .after(now.addingTimeInterval(60 * 60))
            )
        } catch {
            let entry = RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable("開啟軌島以載入附近路線")
            )
            return Timeline(
                entries: [entry],
                policy: .after(now.addingTimeInterval(15 * 60))
            )
        }
    }

    private func placeEntry(
        placeBoard: PlaceBoardDocument,
        configuration: ConfigurationAppIntent,
        now: Date
    ) -> RailBoardEntry {
        if let message = placeBoard.unavailableMessage {
            return RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable(message)
            )
        }
        do {
            let filters = BoardFilterSet(keys: configuration.filters)
            let prepared = try engine.prepare(
                placeBoard: placeBoard,
                filters: filters,
                now: now
            )
            guard !prepared.allPasses.isEmpty || filters.isEmpty else {
                return RailBoardEntry(
                    date: now,
                    configuration: configuration,
                    content: .unavailable("所選班次近期沒有行駛")
                )
            }
            return placeEntry(
                prepared: prepared,
                configuration: configuration,
                at: now,
                generatedAt: now
            )
        } catch {
            return RailBoardEntry(
                date: now,
                configuration: configuration,
                content: .unavailable("開啟軌島以載入附近路線")
            )
        }
    }

    private func makePlaceEntries(
        prepared: PreparedPlaceBoard,
        configuration: ConfigurationAppIntent,
        generatedAt: Date
    ) -> [RailBoardEntry] {
        let horizon = generatedAt.addingTimeInterval(
            RailBoardConstants.timelineWindow
        )
        // 同 makeEntries：倒數是靜態文字 ⇒ 每一次分鐘翻頁都要有自己的 entry。
        // （舊版只排「進入 60 分鐘窗」與「經過那一刻」兩個時點，中間的分鐘全部凍住。）
        let transitionDates = BoardCountdown
            .minuteBoundaries(
                of: prepared.allPasses
                    .prefix(RailBoardConstants.maximumEntries)
                    .map(\.scheduledDate),
                after: generatedAt,
                until: horizon
            )
            .prefix(RailBoardConstants.maximumEntries - 1)

        return ([generatedAt] + transitionDates).map {
            placeEntry(
                prepared: prepared,
                configuration: configuration,
                at: $0,
                generatedAt: generatedAt
            )
        }
    }

    private func placeEntry(
        prepared: PreparedPlaceBoard,
        configuration: ConfigurationAppIntent,
        at entryDate: Date,
        generatedAt: Date
    ) -> RailBoardEntry {
        let horizon = entryDate.addingTimeInterval(
            RailBoardConstants.placePassWindow
        )
        let rowLimit = prepared.lines.count == 1 ? 5 : 3
        let lines = prepared.lines.map { line in
            var seenTrains = Set<String>()
            let upcoming = line.passes.filter {
                $0.scheduledDate > entryDate
                    && $0.scheduledDate <= horizon
                    && seenTrains.insert(
                        "\($0.systemID)|\($0.trainNumber)"
                    ).inserted
            }
            return PlaceLineSnapshot(
                id: line.id,
                name: line.name,
                color: line.color,
                perpendicularMeters: line.perpendicularMeters,
                rows: Array(
                    upcoming
                        .prefix(rowLimit)
                        .map {
                            PlaceBoardRow(
                                trainNumber: $0.trainNumber,
                                trainType: $0.trainType,
                                destinationName: $0.destinationName,
                                scheduledSecond: $0.scheduledSecond,
                                scheduledDate: $0.scheduledDate,
                                systemID: $0.systemID
                            )
                        }
                )
            )
        }
        return RailBoardEntry(
            date: entryDate,
            configuration: configuration,
            content: .place(PlaceBoardSnapshot(
                title: prepared.title,
                lines: lines,
                typeColors: prepared.typeColors,
                generatedAt: generatedAt
            ))
        )
    }

    private func entry(
        prepared: PreparedBoard,
        configuration: ConfigurationAppIntent,
        at entryDate: Date,
        generatedAt: Date,
        delays: [String: Int]
    ) -> RailBoardEntry {
        let upcoming = prepared.journeys
            .filter { $0.scheduledDate > entryDate }
            .prefix(3)
        let rows = upcoming.map { journey in
            BoardRow(
                trainNumber: journey.trainNumber,
                trainType: journey.trainType,
                scheduledSecond: journey.scheduledSecond,
                scheduledDate: journey.scheduledDate,
                arrivalSecond: journey.arrivalSecond,
                arrivalDate: journey.arrivalDate,
                destinationName: journey.destinationName,
                relation: journey.relation,
                delay: prepared.isLive(systemID: journey.systemID)
                    ? delays[journey.trainNumber] : nil,
                isLastOfDay: journey.isLastOfDay
            )
        }

        let emptyMessage: String?
        if rows.isEmpty {
            emptyMessage = prepared.isWatching
                ? "今天沒有列車經過"
                : "查無直達班次"
        } else {
            emptyMessage = nil
        }

        let snapshot = BoardSnapshot(
            title: prepared.title,
            isWatching: prepared.isWatching,
            isLive: prepared.anyLive,
            typeColors: prepared.typeColors,
            rows: rows,
            emptyMessage: emptyMessage,
            notice: engine.notice(for: entryDate, systems: prepared.systems),
            generatedAt: generatedAt
        )
        return RailBoardEntry(
            date: entryDate,
            configuration: configuration,
            content: .board(snapshot)
        )
    }

    private func reloadPolicy(
        prepared: PreparedBoard,
        entries: [RailBoardEntry],
        now: Date
    ) -> TimelineReloadPolicy {
        // 逐分鐘 entry 用完就重抓。最後一個 entry 最多在 50 分鐘後（maximumEntries 的上限），
        // 重抓時順便重新取誤點 ⇒ 不必再另外排一個「進入誤點窗」的時點。
        if entries.count > 1 { return .atEnd }

        // 只剩一個 entry＝最近的班次遠在 90 分鐘之外（畫的是時刻不是倒數，畫面不會變）。
        // 睡到它進入倒數範圍，最長一小時——這是 WidgetKit 刷新預算最省的那一段。
        let wake = prepared.journeys.first.map {
            $0.scheduledDate.addingTimeInterval(-BoardCountdown.clockThreshold)
        }
        let hour = now.addingTimeInterval(60 * 60)
        let candidates = [wake, hour].compactMap { $0 }.filter { $0 > now }
        return .after(candidates.min() ?? hour)
    }
}

struct RailBoardWidgetEntryView: View {
    @Environment(\.widgetFamily) private var widgetFamily
    @Environment(\.widgetRenderingMode) private var renderingMode
    // 🔴 算繪 harness 的覆寫哨兵，出貨路徑恆為 nil。為什麼需要它見 RailWidgetKit.swift 的
    //    railFamilyOverride（previewContext 對 swiftc 裸執行檔設不了 \.widgetFamily）。
    @Environment(\.railFamilyOverride) private var familyOverride
    let entry: Provider.Entry

    private var family: WidgetFamily { familyOverride ?? widgetFamily }

    var body: some View {
        Group {
            switch entry.content {
            case .unavailable(let message):
                unavailableView(message)
            case .place(let snapshot):
                switch family {
                case .systemMedium:
                    MediumPlaceBoardView(snapshot: snapshot, entryDate: entry.date)
                case .accessoryRectangular:
                    RectangularPlaceBoardView(snapshot: snapshot, entryDate: entry.date)
                default:
                    SmallPlaceBoardView(snapshot: snapshot, entryDate: entry.date)
                }
            case .board(let snapshot):
                switch family {
                case .systemMedium:
                    MediumBoardView(snapshot: snapshot, entryDate: entry.date)
                case .accessoryRectangular:
                    RectangularBoardView(snapshot: snapshot, entryDate: entry.date)
                default:
                    SmallBoardView(snapshot: snapshot, entryDate: entry.date)
                }
            }
        }
        // 單色（tinted／accented）模式：鎖屏那個家族恆為單色，路線色與狀態色全部失效
        // ⇒ 由元件層的 railMonochrome 統一把顏色換成文字與深淺（設計稿規則）。
        .railRenderingMode(renderingMode)
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }

    @ViewBuilder
    private func unavailableView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("軌島")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.system(size: 15, weight: .semibold))
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(family == .accessoryRectangular ? 0 : RailBoardInsets.content)
    }
}

/// 🔴 內容邊距為什麼由 View 自己補：這個小工具 `contentMarginsDisabled()`（鎖屏的
///    accessoryRectangular 只有三行高，多一圈 16pt 邊距會直接吃掉一行），代價是系統家族
///    也一起失去 WidgetKit 的預設邊距、必須自己補回來。
///
/// 補在 View 內而不是 Widget 外殼上，是為了讓算繪腳本（直接算繪這些 View、不經過
/// AppIntents 外殼）看到的版面與出貨【逐 pt 相同】——邊距寫在外殼上時，算繪那邊得自己
/// 記得補一份，而忘記補的症狀是「每張圖都比出貨寬一圈、緊繃程度被系統性低估」，
/// 不會有任何錯誤訊息（捷運那支腳本改版前就是這樣）。
///
/// 值是 16 不是 12：設計稿的內容框（Small 138、Medium 332×138）正是 170／364×170
/// 扣掉 16pt 邊距得到的。08-14 真機回饋「上緣只留 12pt，首行貼著圓角」講的就是舊值。
enum RailBoardInsets {
    static let content: CGFloat = 16
}

/// 班表過期／即將過期的警示。
///
/// 設計稿的狀態一律「純文字，沒有底色膠囊」，所以不再畫黃色橫幅——但顏色在單色模式會
/// 失效，故警示由「⚠」這個形狀承擔（與 RailStamp 同一套做法）。
struct BoardNotice: View {
    let notice: ScheduleNotice
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        Text("⚠ " + notice.text)
            .font(.system(size: scale.pt(11), weight: .medium))
            .foregroundStyle(mono ? AnyShapeStyle(HierarchicalShapeStyle.primary)
                                  : AnyShapeStyle(RailTokens.colors(scheme).warn))
            .lineLimit(1)
            .minimumScaleFactor(0.62)
    }
}

// MARK: - 發車看板 · Small（單班大卡）

/// 設計稿 A：「138pt 高只放得下五列：識別 20、站名 24、方向 19、倒數 44、註腳 16」。
/// 五列是硬預算，想加第六列必須先砍一列。
struct SmallBoardView: View {
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        GeometryReader { geo in
            let scale = RailScale(width: geo.size.width, reference: RailScale.smallReference)
            content(scale)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(RailBoardInsets.content)
    }

    @ViewBuilder
    private func content(_ scale: RailScale) -> some View {
        if let row = snapshot.rows.first {
            VStack(alignment: .leading, spacing: scale.pt(3)) {
                // 識別 20：車種標＋車次（設計稿：兩者是不同角色，不再同色同大小）＋資料時刻。
                // 識別 20：整列都給車種標＋車次。
                // 🔴 資料時刻不掛在這一列（設計稿的示範是這樣，但它的車種只有兩個字）：
                //    「莒光/復興」那顆標本身就要 64pt、四碼車次 38pt，加上時刻就溢出 14pt
                //    （破版 gate 在直達那張抓到）。車種標依設計稿【不准縮】，所以是時刻讓位。
                HStack(spacing: scale.pt(5)) {
                    RailTrainMark(kind: row.trainType, number: row.trainNumber,
                                  color: trainColor(row.trainType), fontSize: 12,
                                  numberSize: 16, scale: scale)
                    Spacer(minLength: 0)
                }
                .frame(height: scale.pt(20))

                // 站名 24 ＋右側資料時刻。與 Medium 的 RailCardTitle 同一個安排：
                // 時刻 fixedSize 佔死、站名先縮（直達模式的「竹北 → 臺北」是最長的那個）。
                // 🔴 時刻【沒有】「更新」後綴：加上去要 61pt，這一列放不下（Small 只有 138）。
                //    設計稿的 Small 也是裸時刻；歧義由旁白（RailStamp 的 accessibilityLabel）
                //    與註腳的動詞承擔——註腳寫「14:33 開」，右上那個沒有動詞。
                HStack(alignment: .firstTextBaseline, spacing: scale.pt(5)) {
                    Text(snapshot.title)
                        .font(.system(size: scale.pt(20), weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    Spacer(minLength: scale.pt(2))
                    RailStamp(text: RailBoardClock.updateTimeString(snapshot.generatedAt),
                              suffix: "", scale: scale)
                        .fixedSize()
                }
                .frame(height: scale.pt(24))

                // 方向 19：「往 臺東」／終到列車是「終點」。
                // 🔴 通過標掛在這一列不是識別列：138pt 的識別列放不下「車種標＋車次＋通過＋
                //    資料時刻」四件東西（實測資料時刻被截成「14:28…」），而「這班車不會停」
                //    講的正是這個方向的這一班，掛在方向旁邊讀起來也更順。
                HStack(spacing: scale.pt(5)) {
                    Text(row.watchingDestinationText)
                        .font(.system(size: scale.pt(15)))
                        .foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    if row.isPassing { PassBadge(scale: scale) }
                    Spacer(minLength: 0)
                }
                .frame(height: scale.pt(19), alignment: .leading)

                // 倒數 44 ＋右側狀態。設計稿：誤點永遠是 13pt 純文字，不做膠囊、不進主角區。
                HStack(alignment: .lastTextBaseline, spacing: scale.pt(4)) {
                    RailCountdownText(value: BoardCountdown.of(row: row, at: entryDate),
                                      size: .heroCard, scale: scale)
                        .widgetAccentable()
                    Spacer(minLength: scale.pt(2))
                    if showsClock(row) {
                        // 倒數退成靜態時刻時，右側標「表定」——否則畫面上會有兩個
                        // 一模一樣的時刻（數字欄一個、註腳一個），讀不出哪個才是重點。
                        RailStatusTag(kind: .custom(sameDay(row) ? "表定" : "明天"),
                                      fontSize: 12, scale: scale)
                    } else if let kind = row.statusKind {
                        RailStatusTag(kind: kind, fontSize: 12, scale: scale)
                    }
                }
                .frame(height: scale.pt(44))

                footer(row, scale)
                    .frame(height: scale.pt(16), alignment: .leading)
            }
        } else {
            VStack(alignment: .leading, spacing: scale.pt(6)) {
                Text(snapshot.title)
                    .font(.system(size: scale.pt(17), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .frame(height: scale.pt(21), alignment: .leading)
                Text(snapshot.emptyMessage ?? "查無班次")
                    .font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary)
                if let notice = snapshot.notice {
                    BoardNotice(notice: notice, scale: scale)
                }
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder
    private func footer(_ row: BoardRow, _ scale: RailScale) -> some View {
        if let notice = snapshot.notice {
            // 🔴 班表過期比「幾點開」重要：整張卡的每一個數字都是那份班表算出來的。
            //    五列預算沒有第六列 ⇒ 它佔用註腳這一列（兩者都在設計稿的「其他」層）。
            BoardNotice(notice: notice, scale: scale)
        } else {
            Text(footerText(row))
                .font(.system(size: scale.pt(12)))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }

    private func sameDay(_ row: BoardRow) -> Bool {
        RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate)
    }

    private func showsClock(_ row: BoardRow) -> Bool {
        BoardCountdown.isClock(effective: row.effectiveDate, at: entryDate)
    }

    private func footerText(_ row: BoardRow) -> String {
        let today = sameDay(row)
        // 數字欄已經在畫那個時刻（>90 分鐘的班次）⇒ 註腳不再重複一次。
        var parts = showsClock(row)
            ? []
            : [today ? row.departureText : "明天 " + row.departureText]
        // 末班車優先於抵達時刻：錯過它今天就沒有下一班，而抵達時刻只是行程資訊。
        if row.isLastOfDay, today {
            parts.append("末班車")
        } else if !snapshot.isWatching, let arrival = row.arrivalText {
            parts.append(arrival)
        }
        return parts.joined(separator: " · ")
    }

    private func trainColor(_ type: String) -> Color {
        BoardPalette.trainColor(type, in: snapshot.typeColors)
    }
}

// MARK: - 發車看板 · Medium（一主兩從）

/// 設計稿 B 的高度預算：21（標題）＋8＋43（主角）＋9（hairline）＋28＋28 ＝ 137，留 1pt。
struct MediumBoardView: View {
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        GeometryReader { geo in
            let scale = RailScale(width: geo.size.width, reference: RailScale.mediumReference)
            content(scale)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(RailBoardInsets.content)
    }

    /// 🔴 班表警示那一行把 8pt 間距換成 18＋4（多吃 14pt）⇒ 依設計稿「超出先砍列而不是縮字」
    ///    少列一班。壓列高會讓同一張卡在兩種狀態下縱向對齊不同，那比少一班難看得多。
    private var followLimit: Int { snapshot.notice == nil ? 2 : 1 }

    @ViewBuilder
    private func content(_ scale: RailScale) -> some View {
        let follows = Array(snapshot.rows.dropFirst().prefix(followLimit))
        VStack(alignment: .leading, spacing: 0) {
            RailCardTitle(title: snapshot.title, scale: scale) {
                RailStamp(text: RailBoardClock.updateTimeString(snapshot.generatedAt), scale: scale)
            }
            if let notice = snapshot.notice {
                BoardNotice(notice: notice, scale: scale)
                    .frame(height: scale.pt(18), alignment: .leading)
                Spacer().frame(height: scale.pt(4))
            } else {
                Spacer().frame(height: scale.pt(8))
            }

            if let lead = snapshot.rows.first {
                BoardRowView(row: lead, snapshot: snapshot, entryDate: entryDate,
                             role: .hero, lineAbove: false, lineBelow: !follows.isEmpty,
                             scale: scale)
                RailHairline(scale: scale)
                ForEach(Array(follows.enumerated()), id: \.offset) { index, row in
                    BoardRowView(row: row, snapshot: snapshot, entryDate: entryDate,
                                 role: .follow, lineBelow: index < follows.count - 1,
                                 scale: scale)
                }
            } else {
                Text(snapshot.emptyMessage ?? "查無班次")
                    .font(.system(size: scale.pt(15)))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            Spacer(minLength: 0)
        }
    }
}

/// 看板的一列。三欄骨架由 RailRow 提供（軌脊 12 ／內容彈性 ／數字靠右）。
///
/// 設計稿「拉開重量的三個手段」：主角列 20/40pt、次列 17/20pt；主角有副標、次列沒有；
/// 主角的軌脊點是 11pt 實心車種色，次列是灰環。
struct BoardRowView: View {
    enum Role { case hero, follow, followLarge }

    let row: BoardRow
    let snapshot: BoardSnapshot
    var entryDate: Date = Date()
    var role: Role = .follow
    var lineAbove: Bool = true
    var lineBelow: Bool = true
    var scale: RailScale = RailScale(k: 1)

    private var isHero: Bool { role == .hero }

    private var height: CGFloat {
        switch role {
        case .hero:        return RailRowHeight.hero
        case .follow:      return RailRowHeight.follow
        case .followLarge: return RailRowHeight.followLarge
        }
    }

    private var color: Color {
        BoardPalette.trainColor(row.trainType, in: snapshot.typeColors)
    }

    private var sameDay: Bool {
        RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate)
    }

    /// 倒數已經退成靜態時刻（>90 分鐘）⇒ 內容欄不要再寫一次同一個時刻，改標「表定」。
    private var showsClock: Bool {
        BoardCountdown.isClock(effective: row.effectiveDate, at: entryDate)
    }

    var body: some View {
        RailRow(spine: isHero ? .lead(color) : .follow,
                lineAbove: lineAbove, lineBelow: lineBelow,
                height: height,
                numberWidth: isHero ? RailNumberColumn.wide : RailNumberColumn.narrow,
                scale: scale) {
            if isHero {
                HStack(spacing: scale.pt(6)) {
                    // 車次與「往 X」同級 20pt、車種標 13pt——設計稿的示範裡「0814」與
                    // 「往 南港」是同一個大小，只有車種標明顯小一階。
                    RailTrainMark(kind: row.trainType, number: row.trainNumber,
                                  color: color, fontSize: 13, numberSize: 20, scale: scale)
                    Text(row.watchingDestinationText)
                        .font(.system(size: scale.pt(20), weight: .medium))
                        .lineLimit(1).minimumScaleFactor(0.7)
                    if row.isPassing { PassBadge(scale: scale) }
                }
                .widgetAccentable()
                subtitle
            } else {
                HStack(spacing: scale.pt(6)) {
                    RailTrainMark(kind: row.trainType, number: row.trainNumber,
                                  color: color, fontSize: 12, scale: scale)
                    Text(row.watchingDestinationText)
                        .font(.system(size: scale.pt(17)))
                        .foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    if row.isPassing { PassBadge(scale: scale) }
                    Spacer(minLength: scale.pt(4))
                    followStatus
                }
            }
        } trailing: {
            RailCountdownText(value: BoardCountdown.of(row: row, at: entryDate),
                              size: isHero ? .heroRow : .row, scale: scale)
                .widgetAccentable()
        }
    }

    /// 主角列副標：「11:38 開 · 準點 · 抵 12:34」。誤點時前段變成「11:35 開 → 11:41」。
    private var subtitle: some View {
        HStack(spacing: scale.pt(5)) {
            if showsClock {
                RailStatusTag(kind: .custom(sameDay ? "表定" : "明天"), fontSize: 13, scale: scale)
            } else {
                Text(sameDay ? row.departureText : "明天 " + row.departureText)
                    .monospacedDigit()
            }
            if let kind = row.statusKind {
                dot
                RailStatusTag(kind: kind, fontSize: 13, scale: scale)
            }
            if row.isLastOfDay, sameDay {
                dot
                RailStatusTag(kind: .lastTrain, fontSize: 13, scale: scale)
            } else if !snapshot.isWatching, row.lateMinutes == 0,
                      let arrival = row.arrivalText {
                // 🔴 誤點時【不】再加抵達時刻：那一行已經有「11:35 開 → 11:41」與
                //    「誤點 +3 分」兩組，第三組時間會把整行擠爆（實測 243pt 對內容欄 224pt，
                //    畫面上「開 →…」被截掉——而那個箭頭後面的實際發車時刻正是最該讀到的東西）。
                dot
                Text(arrival).monospacedDigit()
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: scale.pt(13)))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }

    /// 次列的狀態槽。設計稿：「捷運看倒數，臺鐵看時刻——臺鐵列把時刻留在右側倒數旁」，
    /// 誤點時那個位置換成誤點分鐘（示範是「誤點 +3」與「11:40」交替出現的那兩列）。
    @ViewBuilder
    private var followStatus: some View {
        if showsClock {
            RailStatusTag(kind: .custom(sameDay ? "表定" : "明天"), fontSize: 12, scale: scale)
        } else if let delay = row.delay, delay != 0 {
            RailStatusTag(kind: .delay(delay), fontSize: 12, scale: scale)
        } else if row.isLastOfDay, sameDay {
            RailStatusTag(kind: .lastTrain, fontSize: 12, scale: scale)
        } else {
            Text(sameDay ? row.scheduledTime : "明天 " + row.scheduledTime)
                .font(.system(size: scale.pt(12)))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .fixedSize()
        }
    }

    private var dot: some View {
        Text("·").foregroundStyle(.tertiary)
    }
}

// MARK: - 發車看板 · accessoryRectangular（鎖屏）

struct RectangularBoardView: View {
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(snapshot.title)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 2)
                if let notice = snapshot.notice {
                    // 鎖屏三行放不下整句班表警示 ⇒ 只留形狀，全文交給旁白。
                    Text("⚠").font(.system(size: 10)).accessibilityLabel(notice.text)
                }
            }
            .foregroundStyle(.secondary)

            if let row = snapshot.rows.first {
                HStack(spacing: 4) {
                    RailTrainMark(kind: row.trainType, number: row.trainNumber, fontSize: 9)
                    Text(row.watchingDestinationText)
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.7)
                    if row.isPassing { PassBadge() }
                }
                .widgetAccentable()

                HStack(spacing: 4) {
                    RailCountdownText(value: BoardCountdown.of(row: row, at: entryDate),
                                      size: .minor)
                    Text(row.departureText)
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    if let kind = row.statusKind {
                        RailStatusTag(kind: kind, fontSize: 11)
                    }
                    if row.isLastOfDay,
                       RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                        RailStatusTag(kind: .lastTrain, fontSize: 11)
                    }
                }
                .lineLimit(1).minimumScaleFactor(0.7)
            } else {
                Text(snapshot.emptyMessage ?? "查無班次")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.75)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - 我的地點 · Small

/// 「站名」那一列換成【線名】：地點沒有車站，使用者要先認出「這是哪一條鐵路」
/// 才讀得懂下面的車次與時刻。其餘四列與車站小卡同一套硬預算。
struct SmallPlaceBoardView: View {
    let snapshot: PlaceBoardSnapshot
    let entryDate: Date

    var body: some View {
        GeometryReader { geo in
            let scale = RailScale(width: geo.size.width, reference: RailScale.smallReference)
            content(scale)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(RailBoardInsets.content)
    }

    @ViewBuilder
    private func content(_ scale: RailScale) -> some View {
        // lines 已依垂距排序 ⇒ first 就是最近的那條。
        if let line = snapshot.lines.first, let row = line.rows.first {
            VStack(alignment: .leading, spacing: scale.pt(3)) {
                HStack(spacing: scale.pt(4)) {
                    Text(snapshot.title)
                        .font(.system(size: scale.pt(15), weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    Spacer(minLength: scale.pt(2))
                    // 垂距是使用者判斷「這條線是不是真的在我家旁邊」的依據，地點名先縮。
                    Text(PlaceDistance.text(line.perpendicularMeters))
                        .font(.system(size: scale.pt(11)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit().fixedSize().layoutPriority(1)
                }
                .frame(height: scale.pt(20))

                RailLineMark(name: line.name, color: Color(hex: line.color),
                             fontSize: 20, scale: scale)
                    .frame(height: scale.pt(24), alignment: .leading)

                HStack(spacing: scale.pt(5)) {
                    RailTrainMark(kind: row.trainType, number: row.trainNumber,
                                  color: trainColor(row.trainType), fontSize: 11, scale: scale)
                    Text("往 \(row.destinationName)")
                        .font(.system(size: scale.pt(14)))
                        .foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                .frame(height: scale.pt(19))

                RailCountdownText(value: BoardCountdown.of(row: row, at: entryDate),
                                  size: .heroCard, arrivingWord: PlaceDistance.passWord,
                                  scale: scale)
                    .widgetAccentable()
                    .frame(height: scale.pt(44), alignment: .leading)

                Text(footerText(line, row))
                    .font(.system(size: scale.pt(12)))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(height: scale.pt(16), alignment: .leading)
            }
        } else {
            VStack(alignment: .leading, spacing: scale.pt(6)) {
                Text(snapshot.title)
                    .font(.system(size: scale.pt(17), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .frame(height: scale.pt(21), alignment: .leading)
                if let line = snapshot.lines.first {
                    RailLineMark(name: line.name, color: Color(hex: line.color),
                                 fontSize: 13, scale: scale)
                }
                Text("60 分鐘內無車")
                    .font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
    }

    private func footerText(_ line: PlaceLineSnapshot, _ row: PlaceBoardRow) -> String {
        let sameDay = RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate)
        let head = "\(row.scheduledTime) \(PlaceDistance.passWord)"
        var parts = [sameDay ? head : "明天 " + head]
        // 🔴 第二條線在五列預算裡放不進一整列，但「旁邊還有另一條鐵路」不能整個消失
        //    ⇒ 壓成註腳一段。它比「同一條線還有 N 班」有資訊量，所以兩者只留前者。
        if let other = snapshot.lines.dropFirst().first, let next = other.rows.first {
            parts.append("\(other.name) \(next.scheduledTime)")
        } else if line.rows.count > 1 {
            parts.append("另 \(line.rows.count - 1) 班")
        }
        return parts.joined(separator: " · ")
    }

    private func trainColor(_ type: String) -> Color {
        BoardPalette.trainColor(type, in: snapshot.typeColors)
    }
}

// MARK: - 我的地點 · Medium

/// 兩種版面，由「這個地點旁邊有幾條線」決定：
///
/// - 一條線：走設計稿的軌脊列表（主角 43＋hairline＋兩班次要 28），與車站卡同一個骨架。
///   一條線本來就是一串時間序列，那正是軌脊在表達的東西。
/// - 兩條以上：並排欄。平行的兩條鐵路不是一串序列，硬排成一條軌脊會謊報先後關係。
///
/// 🔴 字級改成設計稿的固定 pt（原本是由欄寬反解的 PlaceColumnMetrics，8–15pt 浮動）。
///    當初那套是為了修「medium 的字比 small 還小」（使用者 2026-07-31 回報），做法是
///    照最壞情況反解；新的固定級距比它【更大】（12–20pt 對 8–15pt），那個回饋仍然被滿足，
///    而且不再有「同一張卡在不同機型上字級不同」這件事——RailScale 的等比縮放取代它。
struct MediumPlaceBoardView: View {
    let snapshot: PlaceBoardSnapshot
    let entryDate: Date

    var body: some View {
        GeometryReader { geo in
            let scale = RailScale(width: geo.size.width, reference: RailScale.mediumReference)
            Group {
                if snapshot.lines.count == 1, let line = snapshot.lines.first {
                    singleLine(line, scale)
                } else {
                    columns(Array(snapshot.lines.prefix(3)), scale)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(RailBoardInsets.content)
    }

    @ViewBuilder
    private func singleLine(_ line: PlaceLineSnapshot, _ scale: RailScale) -> some View {
        let rows = Array(line.rows.prefix(3))
        let follows = Array(rows.dropFirst())
        VStack(alignment: .leading, spacing: 0) {
            RailCardTitle(title: snapshot.title, scale: scale) {
                HStack(spacing: scale.pt(6)) {
                    RailLineMark(name: line.name, color: Color(hex: line.color),
                                 fontSize: 12, scale: scale)
                    Text(PlaceDistance.text(line.perpendicularMeters))
                        .font(.system(size: scale.pt(11)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            Spacer().frame(height: scale.pt(8))
            if let lead = rows.first {
                PlaceRowView(row: lead, typeColors: snapshot.typeColors, entryDate: entryDate,
                             role: .hero, lineColor: Color(hex: line.color),
                             lineAbove: false, lineBelow: !follows.isEmpty, scale: scale)
                RailHairline(scale: scale)
                ForEach(Array(follows.enumerated()), id: \.offset) { index, row in
                    PlaceRowView(row: row, typeColors: snapshot.typeColors, entryDate: entryDate,
                                 role: .follow, lineBelow: index < follows.count - 1, scale: scale)
                }
            } else {
                Text("60 分鐘內無車")
                    .font(.system(size: scale.pt(15)))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func columns(_ lines: [PlaceLineSnapshot], _ scale: RailScale) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RailCardTitle(title: snapshot.title, scale: scale) {
                RailStamp(text: RailBoardClock.updateTimeString(snapshot.generatedAt), scale: scale)
            }
            Spacer().frame(height: scale.pt(8))
            HStack(alignment: .top, spacing: scale.pt(8)) {
                ForEach(lines.indices, id: \.self) { index in
                    if index > 0 {
                        Rectangle()
                            .fill(Color.primary.opacity(0.12))
                            .frame(width: 1)
                            .frame(maxHeight: .infinity)
                    }
                    PlaceColumnView(line: lines[index], typeColors: snapshot.typeColors,
                                    entryDate: entryDate, scale: scale)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// 並排欄裡的一條線。
///
/// 🔴 為什麼一欄只有一個「完整列」＋其餘壓成單行：三欄時每欄只有約 96pt
///    （332 − 兩條分隔線與四段間距，再除以三），而車種標【不准縮】（設計稿：
///    「路線點與車種標永不縮」）——「莒光/復興」那顆標本身就要 60pt，
///    車種標＋車次＋往 X 排在同一行結構上排不下。所以完整列改成三行堆疊，
///    後續班次壓成「11:52 區間 1284」單行。兩欄與三欄共用同一個形狀，
///    不做「兩欄才有的第二種列」——那種依欄數分岔的版面很難驗，而且沒有人看得出差別。
private struct PlaceColumnView: View {
    let line: PlaceLineSnapshot
    let typeColors: [String: String]
    let entryDate: Date
    let scale: RailScale

    var body: some View {
        // 高度預算（內容框 138 − 標題 21 − 間距 8 ＝ 109）：
        //   18（線名）＋2＋18（車種標）＋15（往 X）＋24（時刻＋倒數）＋15＋15（後續兩班）＝ 107。
        // 🔴 刻意留 2pt：RailScale 的 k 是由【寬度】導出的，而 393pt 機型的小工具長寬比
        //    與 430pt 差一點（306/332＝0.922 對 126/138＝0.913）⇒ 把 109 排滿的話，
        //    窄機型上等比放大後會高出約 1.3pt（破版 gate 在 393pt 那張抓到）。
        // 🔴 VStack 的 spacing 一律 0、每一列自己帶 frame 高度：spacing 會加在【每一對】
        //    子元素之間，六個間隙就是 12pt——第一版把它當成「只有幾個地方會用到」，
        //    結果整欄多出 6pt 而墨跡溢出內容框 8pt（破版 gate 抓到）。
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: scale.pt(4)) {
                RailLineMark(name: line.name, color: Color(hex: line.color),
                             fontSize: 13, scale: scale)
                Spacer(minLength: scale.pt(2))
                Text(PlaceDistance.text(line.perpendicularMeters))
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.secondary)
                    .monospacedDigit().fixedSize().layoutPriority(1)
            }
            .frame(height: scale.pt(18))

            if let lead = line.rows.first {
                Spacer().frame(height: scale.pt(2))
                // 車種標 10pt（不是主角列的 13）：三欄時每欄只有約 90pt，而「莒光/復興」
                // 那顆標在 11pt 就要 60pt，加上四碼車次就排不進去。
                RailTrainMark(kind: lead.trainType, number: lead.trainNumber,
                              color: BoardPalette.trainColor(lead.trainType, in: typeColors),
                              fontSize: 10, scale: scale)
                    .frame(height: scale.pt(18), alignment: .leading)
                Text("往 \(lead.destinationName)")
                    .font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(height: scale.pt(15), alignment: .leading)
                HStack(alignment: .lastTextBaseline, spacing: scale.pt(3)) {
                    Text(timeText(lead))
                        .font(.system(size: scale.pt(12)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit().fixedSize()
                    Spacer(minLength: scale.pt(2))
                    RailCountdownText(value: BoardCountdown.of(row: lead, at: entryDate),
                                      size: .row, arrivingWord: PlaceDistance.passWord,
                                      scale: scale)
                }
                .frame(height: scale.pt(24))

                // 後續班次壓成單行：三欄時每欄只剩約 89pt，車種標【不准縮】（設計稿），
                // 車種標＋車次＋往 X 排不進一行 ⇒ 只留「時刻 車種 車次」。
                ForEach(line.rows.dropFirst().prefix(2)) { row in
                    HStack(spacing: scale.pt(4)) {
                        Text(timeText(row))
                            .monospacedDigit().fixedSize()
                        Text("\(row.trainType) \(row.trainNumber)")
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.tertiary)
                    .frame(height: scale.pt(15), alignment: .leading)
                }
            } else {
                Text("60 分鐘內無車")
                    .font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.75)
                    .padding(.top, scale.pt(6))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func timeText(_ row: PlaceBoardRow) -> String {
        RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate)
            ? row.scheduledTime
            : "明天 " + row.scheduledTime
    }
}

/// 單線地點的軌脊列。與 BoardRowView 同一個骨架，差別只在地點沒有誤點資料，
/// 而「經過時刻」佔用臺鐵列的狀態槽。
struct PlaceRowView: View {
    enum Role { case hero, follow, followLarge }

    let row: PlaceBoardRow
    let typeColors: [String: String]
    var entryDate: Date = Date()
    var role: Role = .follow
    var lineColor: Color? = nil
    var lineAbove: Bool = true
    var lineBelow: Bool = true
    var scale: RailScale = RailScale(k: 1)

    private var isHero: Bool { role == .hero }

    private var height: CGFloat {
        switch role {
        case .hero:        return RailRowHeight.hero
        case .follow:      return RailRowHeight.follow
        case .followLarge: return RailRowHeight.followLarge
        }
    }

    private var sameDay: Bool {
        RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate)
    }

    private var timeText: String {
        sameDay ? row.scheduledTime : "明天 " + row.scheduledTime
    }

    var body: some View {
        RailRow(spine: isHero ? .lead(lineColor) : .follow,
                lineAbove: lineAbove, lineBelow: lineBelow,
                height: height,
                numberWidth: isHero ? RailNumberColumn.wide : RailNumberColumn.narrow,
                scale: scale) {
            HStack(spacing: scale.pt(6)) {
                RailTrainMark(kind: row.trainType, number: row.trainNumber,
                              color: BoardPalette.trainColor(row.trainType, in: typeColors),
                              fontSize: isHero ? 13 : 12, scale: scale)
                Text("往 \(row.destinationName)")
                    .font(.system(size: scale.pt(isHero ? 20 : 17),
                                  weight: isHero ? .medium : .regular))
                    .foregroundStyle(isHero ? AnyShapeStyle(HierarchicalShapeStyle.primary)
                                            : AnyShapeStyle(HierarchicalShapeStyle.secondary))
                    .lineLimit(1).minimumScaleFactor(0.8)
                if !isHero {
                    Spacer(minLength: scale.pt(4))
                    Text("\(timeText) \(PlaceDistance.passWord)")
                        .font(.system(size: scale.pt(12)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit().fixedSize()
                }
            }
            .widgetAccentable()
            if isHero {
                Text("\(timeText) \(PlaceDistance.passWord)")
                    .font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
        } trailing: {
            RailCountdownText(value: BoardCountdown.of(row: row, at: entryDate),
                              size: isHero ? .heroRow : .row,
                              arrivingWord: PlaceDistance.passWord, scale: scale)
                .widgetAccentable()
        }
    }
}

// MARK: - 我的地點 · accessoryRectangular（鎖屏）

struct RectangularPlaceBoardView: View {
    let snapshot: PlaceBoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(snapshot.title)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                Spacer(minLength: 2)
                if snapshot.lines.count > 1 {
                    Text("\(snapshot.lines.count) 條線")
                        .font(.system(size: 10))
                        .fixedSize()
                }
            }
            .foregroundStyle(.secondary)

            if let line = snapshot.lines.first, let row = line.rows.first {
                HStack(spacing: 4) {
                    RailLineMark(name: line.name, color: Color(hex: line.color), fontSize: 12)
                        .fontWeight(.semibold)
                    Spacer(minLength: 2)
                    RailCountdownText(value: BoardCountdown.of(row: row, at: entryDate),
                                      size: .minor, arrivingWord: PlaceDistance.passWord)
                }
                .lineLimit(1).minimumScaleFactor(0.7)
                .widgetAccentable()

                HStack(spacing: 4) {
                    RailTrainMark(kind: row.trainType, number: row.trainNumber, fontSize: 9)
                    Text("往 \(row.destinationName)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 2)
                    Text(row.scheduledTime)
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .fixedSize()
                }
                .lineLimit(1).minimumScaleFactor(0.7)
            } else {
                Text("60 分鐘內無車")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - 小零件

/// 車種色只有一個來源：App 寫出的 meta.json `types`。查不到才退到「其他」。
/// 抽成一處是為了不讓同一張卡上兩個地方各自查出不同的顏色。
enum BoardPalette {
    static func trainColor(_ type: String, in typeColors: [String: String]) -> Color {
        Color(hex: typeColors[type] ?? typeColors["其他"] ?? "#8E44AD")
    }
}

enum PlaceDistance {
    /// 「我的地點」的列車是從釘子旁邊【經過】，沒有月台可進 ⇒ 不能寫「進站」「開」。
    static let passWord = "經過"

    static func text(_ meters: Int) -> String {
        if meters < 1_000 { return "\(meters) m" }
        return String(
            format: "%.1f km",
            locale: Locale(identifier: "en_US_POSIX"),
            Double(meters) / 1_000
        )
    }
}

/// 「通過不停靠」。
///
/// 設計稿的狀態標一律純文字，但這個【不是狀態】而是分類（像車種標一樣回答「這是什麼車」），
/// 而且它承載的是「這班車不會停，別在月台上等」——漏讀的代價是錯過一班車。
/// 所以保留外框膠囊：它要在餘光裡就與旁邊的灰字分開。
struct PassBadge: View {
    var scale: RailScale = RailScale(k: 1)

    var body: some View {
        Text("通過")
            .font(.system(size: scale.pt(9), weight: .bold))
            .padding(.horizontal, scale.pt(3))
            .padding(.vertical, scale.pt(1))
            .overlay(
                Capsule().strokeBorder(.secondary, lineWidth: 0.8)
            )
            .fixedSize()
            .accessibilityLabel("通過不停靠")
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)

        let red: Double
        let green: Double
        let blue: Double
        switch cleaned.count {
        case 3:
            red = Double((value >> 8) * 17) / 255
            green = Double(((value >> 4) & 0xF) * 17) / 255
            blue = Double((value & 0xF) * 17) / 255
        default:
            red = Double((value >> 16) & 0xFF) / 255
            green = Double((value >> 8) & 0xFF) / 255
            blue = Double(value & 0xFF) / 255
        }
        self.init(red: red, green: green, blue: blue)
    }
}

extension BoardSnapshot {
    static var preview: BoardSnapshot {
        let now = Date()
        return BoardSnapshot(
            title: "竹北 → 臺北",
            isWatching: false,
            isLive: true,
            typeColors: [
                "自強": "#C0392B",
                "區間車": "#2E6FB0",
                "其他": "#8E44AD"
            ],
            rows: [
                BoardRow(
                    trainNumber: "152",
                    trainType: "自強",
                    scheduledSecond: 26_100,
                    scheduledDate: now.addingTimeInterval(12 * 60),
                    arrivalSecond: 29_400,
                    arrivalDate: now.addingTimeInterval(67 * 60),
                    destinationName: "臺北",
                    relation: .departure,
                    delay: 8,
                    isLastOfDay: false
                ),
                BoardRow(
                    trainNumber: "1112",
                    trainType: "區間車",
                    scheduledSecond: 27_660,
                    scheduledDate: now.addingTimeInterval(38 * 60),
                    arrivalSecond: 32_220,
                    arrivalDate: now.addingTimeInterval(114 * 60),
                    destinationName: "臺北",
                    relation: .departure,
                    delay: nil,
                    isLastOfDay: false
                )
            ],
            emptyMessage: nil,
            notice: nil,
            generatedAt: now
        )
    }
}

extension PlaceBoardSnapshot {
    static var preview: PlaceBoardSnapshot {
        let now = Date()
        func row(
            _ number: String,
            _ type: String,
            _ destination: String,
            after minutes: Int,
            systemID: String
        ) -> PlaceBoardRow {
            let date = now.addingTimeInterval(Double(minutes * 60))
            let components = RailBoardClock.calendar.dateComponents(
                [.hour, .minute, .second],
                from: RailBoardClock.startOfDay(for: date),
                to: date
            )
            let second = (components.hour ?? 0) * 3_600
                + (components.minute ?? 0) * 60
                + (components.second ?? 0)
            return PlaceBoardRow(
                trainNumber: number,
                trainType: type,
                destinationName: destination,
                scheduledSecond: second,
                scheduledDate: date,
                systemID: systemID
            )
        }

        return PlaceBoardSnapshot(
            title: "家",
            lines: [
                PlaceLineSnapshot(
                    id: "tra-western-north",
                    name: "縱貫線北段",
                    color: "#2E6FB0",
                    perpendicularMeters: 180,
                    rows: [
                        row("4037", "區間快", "桃園", after: 4, systemID: "tra"),
                        row("1282", "區間車", "南港", after: 13, systemID: "tra"),
                        row("1283", "區間車", "楊梅", after: 18, systemID: "tra"),
                    ]
                ),
                PlaceLineSnapshot(
                    id: "thsr-main",
                    name: "台灣高鐵",
                    color: "#F06A22",
                    perpendicularMeters: 920,
                    rows: [
                        row("0567", "高鐵", "左營", after: 7, systemID: "thsr"),
                        row("0862", "高鐵", "南港", after: 22, systemID: "thsr"),
                        row("0294", "高鐵", "南港", after: 41, systemID: "thsr"),
                    ]
                ),
            ],
            // 值必須與 App 實際寫出的 meta.json `types` 一致——預覽假資料一旦跟真值分岔，
            // 用截圖審版面就會被誤導（2026-07-31 就發生過：這裡把區間快寫成橘色，
            // 真值其實是 #16A085 青綠，害審查者以為 production 的 type→color 查表壞了）。
            typeColors: [
                "區間快": "#16A085",
                "區間車": "#2E6FB0",
                "高鐵": "#E85D0D",
                "其他": "#8E44AD",
            ],
            generatedAt: now
        )
    }
}

struct RailBoardWidget: Widget {
    let kind = "RailBoardWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: ConfigurationAppIntent.self,
            provider: Provider()
        ) { entry in
            RailBoardWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("發車看板")
        .description("查看台鐵或高鐵接下來的直達、停靠、終到與通過列車。")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

#Preview(as: .systemSmall) {
    RailBoardWidget()
} timeline: {
    RailBoardEntry(
        date: .now,
        configuration: .previewCommute,
        content: .place(.preview)
    )
}

#Preview(as: .systemMedium) {
    RailBoardWidget()
} timeline: {
    RailBoardEntry(
        date: .now,
        configuration: .previewCommute,
        content: .place(.preview)
    )
}

#Preview(as: .accessoryRectangular) {
    RailBoardWidget()
} timeline: {
    RailBoardEntry(
        date: .now,
        configuration: .previewWatching,
        content: .board(.preview)
    )
}
