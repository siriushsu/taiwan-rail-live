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
                originKey.hasPrefix("place|"),
                let placeBoard = try? RailBoardStore.shared.placeBoard(forKey: originKey)
            {
                return placeTimeline(
                    placeBoard: placeBoard,
                    configuration: configuration,
                    now: now
                )
            }

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

            let filters = BoardFilterSet(keys: configuration.filters)
            let prepared = try engine.prepare(
                originID: originSelection.station.index,
                destinationID: destinationSelection?.station.index,
                originDisplayName: originSelection.displayName,
                destinationDisplayName: destinationSelection?.displayName,
                filters: filters,
                now: now
            )
            guard !prepared.journeys.isEmpty || filters.isEmpty else {
                let entry = RailBoardEntry(
                    date: now,
                    configuration: configuration,
                    content: .unavailable("所選班次近期沒有行駛")
                )
                return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(60 * 60)))
            }

            let nextJourney = prepared.journeys.first
            let shouldFetchLive = prepared.system.live
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
                policy: reloadPolicy(prepared: prepared, now: now)
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
                originKey.hasPrefix("place|"),
                let placeBoard = try? RailBoardStore.shared.placeBoard(forKey: originKey)
            {
                return placeEntry(
                    placeBoard: placeBoard,
                    configuration: configuration,
                    now: now
                )
            }

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

            let filters = BoardFilterSet(keys: configuration.filters)
            let prepared = try engine.prepare(
                originID: originSelection.station.index,
                destinationID: destinationSelection?.station.index,
                originDisplayName: originSelection.displayName,
                destinationDisplayName: destinationSelection?.displayName,
                filters: filters,
                now: now
            )
            guard !prepared.journeys.isEmpty || filters.isEmpty else {
                return RailBoardEntry(
                    date: now,
                    configuration: configuration,
                    content: .unavailable("所選班次近期沒有行駛")
                )
            }

            let shouldFetchLive = prepared.system.live
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
        var seenDates = Set<Date>()
        let transitionDates = prepared.journeys
            .map(\.scheduledDate)
            .filter { $0 <= horizon && seenDates.insert($0).inserted }
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
        var seenDates = Set<Date>()
        let transitionDates = prepared.allPasses
            .flatMap {
                [
                    $0.scheduledDate.addingTimeInterval(
                        -RailBoardConstants.placePassWindow
                    ),
                    $0.scheduledDate,
                ]
            }
            .filter {
                $0 > generatedAt
                    && $0 <= horizon
                    && seenDates.insert($0).inserted
            }
            .sorted()
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
                delay: prepared.system.live ? delays[journey.trainNumber] : nil,
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
            isLive: prepared.system.live,
            typeColors: prepared.typeColors,
            rows: rows,
            emptyMessage: emptyMessage,
            notice: engine.notice(for: entryDate, system: prepared.system),
            generatedAt: generatedAt
        )
        return RailBoardEntry(
            date: entryDate,
            configuration: configuration,
            content: .board(snapshot)
        )
    }

    private func reloadPolicy(prepared: PreparedBoard, now: Date) -> TimelineReloadPolicy {
        guard prepared.system.live else {
            return .atEnd
        }

        // 找下一個「剛進入 30 分鐘誤點窗」的班次；避免下一班已在窗內時排入過去日期，
        // 造成 WidgetKit 立即重抓的迴圈。
        let nextRefresh = prepared.journeys
            .map { $0.scheduledDate.addingTimeInterval(-RailBoardConstants.liveWindow) }
            .first { $0 > now }
        return nextRefresh.map(TimelineReloadPolicy.after) ?? .atEnd
    }
}

struct RailBoardWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Provider.Entry

    var body: some View {
        Group {
            switch entry.content {
            case .unavailable(let message):
                unavailableView(message)
            case .place(let snapshot):
                switch family {
                case .systemMedium:
                    MediumPlaceBoardView(
                        snapshot: snapshot,
                        entryDate: entry.date
                    )
                case .accessoryRectangular:
                    RectangularPlaceBoardView(
                        snapshot: snapshot,
                        entryDate: entry.date
                    )
                default:
                    SmallPlaceBoardView(
                        snapshot: snapshot,
                        entryDate: entry.date
                    )
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
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }

    @ViewBuilder
    private func unavailableView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("軌島")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.headline)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(family == .accessoryRectangular ? 0 : 12)
    }
}

struct SmallBoardView: View {
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(snapshot.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            if let row = snapshot.rows.first {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(row.scheduledDate, style: .relative)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.68)
                    Spacer(minLength: 0)
                    if row.isLastOfDay,
                       RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                        LastTrainBadge(compact: true)
                    }
                }

                HStack(spacing: 3) {
                    if !RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                        Text("明天")
                            .fontWeight(.bold)
                    }
                    Text(row.scheduledTime)
                        .monospacedDigit()
                    Text(row.trainType)
                        .foregroundStyle(trainColor(row.trainType))
                    Text(row.trainNumber)
                        .monospacedDigit()
                    if row.isPassing {
                        PassBadge()
                    }
                    if snapshot.isWatching {
                        Text("· \(row.watchingDestinationText)")
                            .lineLimit(1)
                    }
                }
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
                .minimumScaleFactor(0.72)

                details(for: row)

                if snapshot.rows.count > 1 {
                    Divider()
                    let next = snapshot.rows[1]
                    HStack(spacing: 3) {
                        Text("下一班")
                        Text(next.scheduledTime)
                            .monospacedDigit()
                        Text(next.trainType)
                        if next.isPassing {
                            Text("通過")
                        }
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                }
            } else if let emptyMessage = snapshot.emptyMessage {
                Spacer(minLength: 4)
                Text(emptyMessage)
                    .font(.headline)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 4)
            }

            if let notice = snapshot.notice {
                NoticeView(notice: notice, compact: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(12)
    }

    @ViewBuilder
    private func details(for row: BoardRow) -> some View {
        let hasDelay = (row.delay ?? 0) > 0
        if hasDelay || !snapshot.isWatching {
            HStack(spacing: 3) {
                if let delay = row.delay, delay > 0 {
                    Text("誤點 \(delay) 分")
                }
                if !snapshot.isWatching, let arrival = row.arrivalText {
                    if hasDelay {
                        Text("·")
                    }
                    Text(arrival)
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(hasDelay ? Color.red : Color.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
        }
    }

    private func trainColor(_ type: String) -> Color {
        Color(hex: snapshot.typeColors[type] ?? snapshot.typeColors["其他"] ?? "#8E44AD")
    }
}

struct SmallPlaceBoardView: View {
    let snapshot: PlaceBoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Text(snapshot.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 2)
                Text("\(snapshot.lines.count) 條線")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }

            ForEach(Array(snapshot.lines.prefix(2)).indices, id: \.self) { index in
                if index > 0 {
                    Divider()
                }
                SmallPlaceLineView(
                    line: Array(snapshot.lines.prefix(2))[index],
                    entryDate: entryDate,
                    typeColors: snapshot.typeColors
                )
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .topLeading
        )
        .padding(12)
    }
}

private struct SmallPlaceLineView: View {
    let line: PlaceLineSnapshot
    let entryDate: Date
    let typeColors: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Capsule()
                    .fill(Color(hex: line.color))
                    .frame(width: 13, height: 5)
                Text(line.name)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 2)
                Text(distanceText)
                    .font(.system(size: 8))
                    .foregroundStyle(.tertiary)
                    .fixedSize()
            }

            if let row = line.rows.first {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(row.scheduledDate, style: .relative)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    Spacer(minLength: 1)
                    Text(row.scheduledTime)
                        .font(.system(size: 10, weight: .semibold))
                        .monospacedDigit()
                }

                HStack(spacing: 3) {
                    if !RailBoardClock.calendar.isDate(
                        row.scheduledDate,
                        inSameDayAs: entryDate
                    ) {
                        Text("明天")
                            .fontWeight(.bold)
                    }
                    Text("\(row.trainType) \(row.trainNumber)")
                        .foregroundStyle(trainColor(row.trainType))
                        .monospacedDigit()
                        .lineLimit(1)
                    Text("· 往 \(row.destinationName)")
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    if line.rows.count > 1 {
                        Text("另 \(line.rows.count - 1) 班")
                            .fixedSize()
                    }
                }
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            } else {
                Text("未來 60 分鐘沒有列車")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 31, alignment: .leading)
            }
        }
    }

    private var distanceText: String {
        if line.perpendicularMeters < 1_000 {
            return "\(line.perpendicularMeters) m"
        }
        return String(
            format: "%.1f km",
            locale: Locale(identifier: "en_US_POSIX"),
            Double(line.perpendicularMeters) / 1_000
        )
    }

    private func trainColor(_ type: String) -> Color {
        Color(hex: typeColors[type] ?? typeColors["其他"] ?? "#8E44AD")
    }
}

struct MediumBoardView: View {
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(snapshot.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(RailBoardClock.updateTimeString(snapshot.generatedAt)) 更新")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            if snapshot.rows.isEmpty, let emptyMessage = snapshot.emptyMessage {
                Spacer()
                Text(emptyMessage)
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                ForEach(snapshot.rows.prefix(3)) { row in
                    MediumTrainRow(
                        row: row,
                        snapshot: snapshot,
                        entryDate: entryDate
                    )
                }
                Spacer(minLength: 0)
            }

            if let notice = snapshot.notice {
                NoticeView(notice: notice, compact: false)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

struct MediumPlaceBoardView: View {
    let snapshot: PlaceBoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(snapshot.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(RailBoardClock.updateTimeString(snapshot.generatedAt)) 更新")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            HStack(alignment: .top, spacing: 8) {
                ForEach(Array(snapshot.lines.prefix(3)).indices, id: \.self) { index in
                    if index > 0 {
                        Divider()
                    }
                    MediumPlaceLineView(
                        line: Array(snapshot.lines.prefix(3))[index],
                        entryDate: entryDate,
                        typeColors: snapshot.typeColors
                    )
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

private struct MediumPlaceLineView: View {
    let line: PlaceLineSnapshot
    let entryDate: Date
    let typeColors: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Capsule()
                    .fill(Color(hex: line.color))
                    .frame(width: 15, height: 5)
                Text(line.name)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                Spacer(minLength: 2)
                // 垂距要跟 small 一樣顯示：落釘卡的「約 1.0 公里」是使用者判斷「這條線
                // 是不是真的在我家旁邊」的依據,兩條線並列時尤其需要。名字先縮不讓距離被擠掉。
                Text(distanceText)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .layoutPriority(1)
            }

            if line.rows.isEmpty {
                Text("60 分鐘內無車")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            } else {
                ForEach(line.rows.prefix(3)) { row in
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 3) {
                            Text(row.scheduledTime)
                                .fontWeight(.semibold)
                                .monospacedDigit()
                            Text(row.trainType)
                                .foregroundStyle(trainColor(row.trainType))
                                .lineLimit(1)
                            Text(row.trainNumber)
                                .monospacedDigit()
                                .lineLimit(1)
                        }
                        .font(.system(size: 10))
                        .minimumScaleFactor(0.65)

                        HStack(spacing: 3) {
                            if !RailBoardClock.calendar.isDate(
                                row.scheduledDate,
                                inSameDayAs: entryDate
                            ) {
                                Text("明天")
                                    .fontWeight(.bold)
                            }
                            Text("往 \(row.destinationName)")
                                .lineLimit(1)
                            Spacer(minLength: 2)
                            Text(row.scheduledDate, style: .relative)
                                .monospacedDigit()
                                .lineLimit(1)
                        }
                        .font(.system(size: 8))
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var distanceText: String {
        if line.perpendicularMeters < 1_000 {
            return "\(line.perpendicularMeters) m"
        }
        return String(
            format: "%.1f km",
            locale: Locale(identifier: "en_US_POSIX"),
            Double(line.perpendicularMeters) / 1_000
        )
    }

    private func trainColor(_ type: String) -> Color {
        Color(hex: typeColors[type] ?? typeColors["其他"] ?? "#8E44AD")
    }
}

struct MediumTrainRow: View {
    let row: BoardRow
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        HStack(spacing: 5) {
            VStack(alignment: .leading, spacing: 0) {
                Text(row.scheduledTime)
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                if !RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                    Text("明天")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 44, alignment: .leading)

            HStack(spacing: 4) {
                Circle()
                    .fill(trainColor)
                    .frame(width: 6, height: 6)
                Text("\(row.trainType) \(row.trainNumber)")
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                if row.isPassing {
                    PassBadge()
                }
            }
            .font(.system(size: 11, weight: .medium))
            .frame(maxWidth: .infinity, alignment: .leading)

            if let delay = row.delay, delay > 0 {
                Text("+\(delay)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(Color.red.opacity(0.14), in: Capsule())
                    .monospacedDigit()
            }

            Text(snapshot.isWatching ? row.watchingDestinationText : (row.arrivalText ?? "—"))
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: snapshot.isWatching ? 66 : 54, alignment: .trailing)

            Text(row.scheduledDate, style: .relative)
                .font(.system(size: 10, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: 40, alignment: .trailing)

            if row.isLastOfDay,
               RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                Text("末")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.orange)
            }
        }
        .frame(minHeight: 22)
    }

    private var trainColor: Color {
        Color(hex: snapshot.typeColors[row.trainType] ?? snapshot.typeColors["其他"] ?? "#8E44AD")
    }
}

struct RectangularPlaceBoardView: View {
    let snapshot: PlaceBoardSnapshot
    let entryDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(snapshot.title)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if
                let line = snapshot.lines.first,
                let row = line.rows.first
            {
                HStack(spacing: 3) {
                    Capsule()
                        .fill(Color(hex: line.color))
                        .frame(width: 12, height: 4)
                    Text(line.name)
                        .lineLimit(1)
                    Text(row.scheduledTime)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                }
                .font(.system(size: 10))
                HStack(spacing: 3) {
                    Text("\(row.trainType) \(row.trainNumber)")
                    Text("· 往 \(row.destinationName)")
                    Spacer(minLength: 2)
                    Text(row.scheduledDate, style: .relative)
                        .monospacedDigit()
                }
                .font(.system(size: 9))
                .lineLimit(1)
            } else {
                Text("60 分鐘內無車")
                    .font(.system(size: 10, weight: .semibold))
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .leading
        )
    }
}

struct RectangularBoardView: View {
    let snapshot: BoardSnapshot
    let entryDate: Date

    var body: some View {
        let hasNotice = snapshot.notice != nil
        VStack(alignment: .leading, spacing: hasNotice ? 0 : 1) {
            Text(snapshot.title)
                .font(.system(size: hasNotice ? 9 : 10, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            if let row = snapshot.rows.first {
                HStack(spacing: 3) {
                    if !RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                        Text("明天")
                            .fontWeight(.bold)
                    }
                    Text(row.scheduledTime)
                        .monospacedDigit()
                    Text(row.trainType)
                    Text(row.trainNumber)
                        .monospacedDigit()
                    if row.isPassing {
                        Text("· 通過")
                            .fontWeight(.bold)
                    }
                    if snapshot.isWatching {
                        Text("· \(row.watchingDestinationText)")
                    }
                }
                .font(.system(size: hasNotice ? 11 : 12, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.65)

                HStack(spacing: 3) {
                    Text(row.scheduledDate, style: .relative)
                        .monospacedDigit()
                    if let delay = row.delay, delay > 0 {
                        Text("· 誤點 \(delay) 分")
                    }
                    if row.isLastOfDay,
                       RailBoardClock.calendar.isDate(row.scheduledDate, inSameDayAs: entryDate) {
                        Text("· 今天最後一班")
                    }
                }
                .font(.system(size: hasNotice ? 9 : 11))
                .lineLimit(1)
                .minimumScaleFactor(0.68)
            } else if let emptyMessage = snapshot.emptyMessage {
                Text(emptyMessage)
                    .font(.system(size: hasNotice ? 11 : 12, weight: .semibold))
                    .lineLimit(1)
            }

            if let notice = snapshot.notice {
                Text(notice.text)
                    .font(.system(size: 7, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct PassBadge: View {
    var body: some View {
        Text("通過")
            .font(.system(size: 8, weight: .bold))
            .padding(.horizontal, 3)
            .padding(.vertical, 1)
            .overlay(
                Capsule()
                    .strokeBorder(.secondary, lineWidth: 0.8)
            )
            .accessibilityLabel("通過不停靠")
    }
}

struct LastTrainBadge: View {
    let compact: Bool

    var body: some View {
        Text("今天最後一班")
            .font(.system(size: compact ? 8 : 9, weight: .bold))
            .foregroundStyle(.orange)
            .padding(.horizontal, compact ? 4 : 6)
            .padding(.vertical, 2)
            .background(Color.orange.opacity(0.16), in: Capsule())
            .lineLimit(1)
    }
}

struct NoticeView: View {
    let notice: ScheduleNotice
    let compact: Bool

    var body: some View {
        Text(notice.text)
            .font(.system(size: compact ? 8 : 9, weight: .semibold))
            .foregroundStyle(Color(uiColor: .darkText))
            .lineLimit(1)
            .minimumScaleFactor(0.62)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Color.yellow.opacity(0.72), in: RoundedRectangle(cornerRadius: 4))
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
