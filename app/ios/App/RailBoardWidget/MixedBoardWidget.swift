import AppIntents
import SwiftUI
import WidgetKit

struct MixedBoardIntent: AppIntent, WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "轉乘發車看板"
    static var description = IntentDescription("同時查看台鐵或高鐵發車資訊與捷運等車資訊。")

    // String 參數每格都掛 optionsProvider；設定頁沿用系統預設的完整參數列表。
    @Parameter(title: "台鐵／高鐵起站", optionsProvider: OriginOptionsProvider())
    var railOrigin: String?

    @Parameter(title: "捷運站", optionsProvider: MixedMetroStationOptionsProvider())
    var metroStation: String?

    @Parameter(title: "捷運方向（可留空）", optionsProvider: MetroDirectionOptionsProvider())
    var metroDirection: String?
}

/// 混合卡把系統 id 收在車站值裡（sys|station），所以不需要另一格系統參數或依賴。
struct MixedMetroStationOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> ItemCollection<String> {
        let catalog = MetroWidgetCatalog.shared
        return ItemCollection(sections: catalog.systems.map { system in
            IntentItemSection(
                LocalizedStringResource(stringLiteral: system.label),
                items: system.stationNames.map { station in
                    IntentItem<String>(
                        "\(system.id)|\(station)",
                        title: LocalizedStringResource(stringLiteral: station)
                    )
                }
            )
        })
    }
}

extension MixedBoardIntent {
    static var preview: MixedBoardIntent {
        let intent = MixedBoardIntent()
        intent.railOrigin = StationOption.makeKey(systemID: "tra", name: "板橋")
        intent.metroStation = "trtc|板橋"
        intent.metroDirection = nil
        return intent
    }
}

struct MixedBoardEntry: TimelineEntry {
    let date: Date
    let configuration: MixedBoardIntent
    let rail: RailBoardEntry
    let metro: MetroEntry
}

struct MixedBoardProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> MixedBoardEntry {
        MixedBoardEntry(
            date: .now,
            configuration: .preview,
            rail: Provider().placeholder(in: context),
            metro: MetroBoardProvider().placeholder(in: context)
        )
    }

    func snapshot(
        for configuration: MixedBoardIntent,
        in context: Context
    ) async -> MixedBoardEntry {
        let rail = await Provider().snapshot(
            for: railConfiguration(from: configuration),
            in: context
        )
        let metro = await MetroBoardProvider().snapshot(
            for: metroConfiguration(from: configuration),
            in: context
        )
        return MixedBoardEntry(
            date: max(rail.date, metro.date),
            configuration: configuration,
            rail: rail,
            metro: metro
        )
    }

    func timeline(
        for configuration: MixedBoardIntent,
        in context: Context
    ) async -> Timeline<MixedBoardEntry> {
        // 直接消費兩張既有卡的 timeline，讓 App Group 班表與捷運連網／快取管線保持獨立。
        let railTimeline = await Provider().timeline(
            for: railConfiguration(from: configuration),
            in: context
        )
        let metroTimeline = await MetroBoardProvider().timeline(
            for: metroConfiguration(from: configuration),
            in: context
        )

        let dates = Set(
            railTimeline.entries.map(\.date) + metroTimeline.entries.map(\.date)
        ).sorted()
        let entries = dates.map { date in
            MixedBoardEntry(
                date: date,
                configuration: configuration,
                rail: entry(in: railTimeline.entries, at: date),
                metro: entry(in: metroTimeline.entries, at: date)
            )
        }

        // 捷運固定十分鐘刷新；發車看板只有即時誤點窗的起點可能更早。
        let policyAnchor = Date()
        let metroReload = policyAnchor.addingTimeInterval(10 * 60)
        let nextReload = min(
            metroReload,
            nextRailReload(in: railTimeline, after: policyAnchor) ?? metroReload
        )
        return Timeline(entries: entries, policy: .after(nextReload))
    }

    private func railConfiguration(
        from configuration: MixedBoardIntent
    ) -> ConfigurationAppIntent {
        let intent = ConfigurationAppIntent()
        intent.origin = configuration.railOrigin
        intent.destination = nil
        intent.filters = nil
        return intent
    }

    private func metroConfiguration(
        from configuration: MixedBoardIntent
    ) -> MetroBoardIntent {
        let intent = MetroBoardIntent()
        intent.station = configuration.metroStation
        intent.dir = configuration.metroDirection
        intent.sys = configuration.metroStation?
            .split(separator: "|", maxSplits: 1)
            .first
            .map(String.init)
        return intent
    }

    private func entry<Entry: TimelineEntry>(
        in entries: [Entry],
        at date: Date
    ) -> Entry {
        entries.last(where: { $0.date <= date }) ?? entries[0]
    }

    private func nextRailReload(
        in timeline: Timeline<RailBoardEntry>,
        after date: Date
    ) -> Date? {
        if timeline.policy == .never { return nil }
        if timeline.policy == .atEnd { return timeline.entries.last?.date }

        // TimelineReloadPolicy 不公開 .after 的 associated date。發車看板唯一可能早於
        // 捷運十分鐘的 .after，是下一班進入 30 分鐘即時窗；從既有 snapshot 還原同一判準。
        return timeline.entries.flatMap { entry -> [Date] in
            guard case .board(let snapshot) = entry.content, snapshot.isLive else { return [] }
            return snapshot.rows.map {
                $0.scheduledDate.addingTimeInterval(-RailBoardConstants.liveWindow)
            }
        }
        .filter { $0 > date }
        .min()
    }
}

struct MixedBoardEntryView: View {
    let entry: MixedBoardEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            MixedRailSection(entry: entry.rail, displayDate: entry.date)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            Divider()

            MixedMetroSection(entry: entry.metro, displayDate: entry.date)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .widgetURL(entry.metro.deepLink)
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }
}

private struct MixedRailSection: View {
    let entry: RailBoardEntry
    let displayDate: Date

    var body: some View {
        switch entry.content {
        case .board(let snapshot):
            board(snapshot)
        case .place(let snapshot):
            place(snapshot)
        case .unavailable(let message):
            VStack(alignment: .leading, spacing: 8) {
                header(title: "台鐵／高鐵", stamp: "—")
                Text(message)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
            }
        }
    }

    private func board(_ snapshot: BoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            header(
                title: snapshot.title,
                stamp: "\(RailBoardClock.updateTimeString(snapshot.generatedAt)) 更新"
            )

            if snapshot.rows.isEmpty, let emptyMessage = snapshot.emptyMessage {
                Text(emptyMessage)
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ForEach(snapshot.rows.prefix(4)) { row in
                    MediumTrainRow(row: row, snapshot: snapshot, entryDate: displayDate)
                }
                Spacer(minLength: 0)
            }

            if let notice = snapshot.notice {
                NoticeView(notice: notice, compact: false)
            }
        }
    }

    private func place(_ snapshot: PlaceBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            header(
                title: snapshot.title,
                stamp: "\(RailBoardClock.updateTimeString(snapshot.generatedAt)) 更新"
            )

            ForEach(Array(snapshot.lines.prefix(2))) { line in
                ForEach(line.rows.prefix(snapshot.lines.count == 1 ? 3 : 2)) { row in
                    HStack(spacing: 5) {
                        Text(row.scheduledTime)
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .frame(width: 40, alignment: .leading)
                        Capsule()
                            .fill(Color(hex: line.color))
                            .frame(width: 12, height: 5)
                        Text("\(row.trainType) \(row.trainNumber)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(trainColor(row.trainType, in: snapshot))
                            .lineLimit(1)
                        Text("往 \(row.destinationName)")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 2)
                        Text(row.scheduledDate, style: .relative)
                            .font(.system(size: 10, weight: .semibold))
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                    .frame(minHeight: 22)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func trainColor(_ type: String, in snapshot: PlaceBoardSnapshot) -> Color {
        Color(hex: snapshot.typeColors[type] ?? snapshot.typeColors["其他"] ?? "#8E44AD")
    }

    private func header(title: String, stamp: String) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(stamp)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .fixedSize()
        }
    }
}

private struct MixedMetroSection: View {
    let entry: MetroEntry
    let displayDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                if let color = entry.lineColor {
                    Circle().fill(color).frame(width: 8, height: 8)
                }
                Text(entry.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(stampText)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .fixedSize()
            }

            if let lastTrain = entry.lastTrain {
                Text("末班 \(lastTrain)")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .lineLimit(1)
            }

            if visibleRows.isEmpty {
                Text(entry.snapshot != nil ? "官方目前沒有這一站的班次資訊" : "沒有資料")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(visibleRows.prefix(3).enumerated()), id: \.offset) { _, row in
                    MetroRowView(
                        row: row,
                        precision: entry.precision,
                        showCrowd: true,
                        entryDate: displayDate
                    )
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var visibleRows: [MetroRow] {
        guard let rows = entry.snapshot?.rows else { return [] }
        return rows.filter {
            $0.etaEpoch == nil || $0.etaEpoch! + 30 > displayDate.timeIntervalSince1970
        }
    }

    private var stampText: String {
        guard let timestamp = entry.snapshot?.dataAt else { return "—" }
        let time = RailBoardClock.updateTimeString(Date(timeIntervalSince1970: timestamp))
        return entry.failed ? "上次 \(time) 更新" : "\(time) 更新"
    }
}

struct MixedBoardWidget: Widget {
    let kind = "MixedBoardWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: MixedBoardIntent.self,
            provider: MixedBoardProvider()
        ) { entry in
            MixedBoardEntryView(entry: entry)
        }
        .configurationDisplayName("轉乘發車看板")
        .description("同時查看台鐵或高鐵發車資訊與捷運下一班。")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
