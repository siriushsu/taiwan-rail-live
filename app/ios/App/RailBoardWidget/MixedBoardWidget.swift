import AppIntents
import SwiftUI
import WidgetKit

struct MixedBoardIntent: AppIntent, WidgetConfigurationIntent {
    // 08-14 真機回饋:不叫「轉乘」——真轉乘要知道「我這班車幾點到這站」,這張卡給的是
    // 兩張即時看板並排(鐵路發車＋捷運進站),名字不可以承諾它沒做的事。
    static var title: LocalizedStringResource = "鐵路＋捷運看板"
    static var description = IntentDescription("同一張卡查看台鐵／高鐵發車與捷運進站倒數。")

    // String 參數每格都掛 optionsProvider；設定頁沿用系統預設的完整參數列表。
    @Parameter(title: "台鐵／高鐵起站", optionsProvider: OriginOptionsProvider())
    var railOrigin: String?

    @Parameter(title: "捷運站", optionsProvider: MixedMetroStationOptionsProvider())
    var metroStation: String?

    @Parameter(title: "捷運方向（可留空）", optionsProvider: MetroDirectionOptionsProvider())
    var metroDirection: String?
}

/// 混合卡把系統 id 收在車站值裡（sys|station），所以不需要另一格系統參數或依賴。
/// 「自動（最近的站）」哨兵值同樣收得下——entry() 的 auto 分支在 sys 查表之前。
struct MixedMetroStationOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> ItemCollection<String> {
        let catalog = MetroWidgetCatalog.shared
        return ItemCollection(sections: [MetroNearest.optionSection()] + catalog.systems.map { system in
            IntentItemSection(
                LocalizedStringResource(stringLiteral: RailNativeL10n.name(system.label)),
                items: system.stationNames.map { station in
                    IntentItem<String>(
                        "\(system.id)|\(station)",
                        title: LocalizedStringResource(stringLiteral: RailNativeL10n.name(station))
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

// MARK: - Large 混合卡（設計稿 C · LARGE 364×382 · 內容框 332×346）

/// 「為什麼不是兩張表疊起來：軌脊是連續的一條，兩區只是它的兩段，分區靠 11pt 標題與
/// 一條內縮 hairline，不用第二層卡片或色塊。兩區的欄寬相同，但節奏刻意不同——
/// 捷運列有擁擠度、沒有時刻；臺鐵列有車種標與時刻、沒有擁擠度。」
///
/// 閱讀順序（設計稿）：站名 → 捷運主角 → 次要 → 臺鐵主角 → 次要。每一區只有一個大字。
struct MixedBoardEntryView: View {
    let entry: MixedBoardEntry
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        GeometryReader { geo in
            MixedBoardCard(
                entry: entry,
                scale: RailScale(width: geo.size.width, reference: RailScale.mediumReference),
                box: geo.size.height
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        // 內距在 view 內部（與其他卡同一套）：算繪 harness 量到的就是上線版面。
        // 16 是 WidgetKit 的預設內距，contentMarginsDisabled 後由我們自己補回來。
        .padding(RailBoardInsets.content)
        .railRenderingMode(renderingMode)
        .widgetURL(entry.metro.deepLink)
        .containerBackground(for: .widget) {
            Color(uiColor: .systemBackground)
        }
    }
}

private enum MixedMetrics {
    /// 卡片標題與第一個分區標題之間
    static let titleGap: CGFloat = 5
    /// 分區之間那條內縮 hairline 佔的高
    static let divider: CGFloat = 8
    /// 末班車這種「車站層級」的單行
    static let extraLine: CGFloat = 18
    /// 空狀態訊息（通行證 CTA 可能兩行）
    static let message: CGFloat = 34
}

/// 兩區共用一份次列名額。
///
/// 🔴 設計稿畫的是「每區主角＋兩班次要」，但 08-15 真機回饋是大卡下半留白太多
///    （「台北車站這種多線大站班次很多，大卡下半還有空位卻只列三班」）⇒ 名額改從
///    【實測內容框高】推：有餘裕就多列，餘裕被末班車／告示／空狀態吃掉就少列。
///    依設計稿「超出先砍列不縮字」，這裡只動列數，不動任何字級或列高。
private struct MixedPlan {
    let metroFollows: Int
    let railFollows: Int

    init(box: CGFloat, fixed: CGFloat, metroAvailable: Int, railAvailable: Int) {
        let slots = max(0, Int((box - fixed) / RailRowHeight.followLarge))
        // 對半分，奇數時多的一格給捷運（它在前，而且是兩區裡唯一即時的一半）；
        // 另一區用不到的名額讓出來——單線小站不該讓對面空著。
        let wanted = min(metroAvailable, (slots + 1) / 2)
        self.railFollows = min(railAvailable, max(0, slots - wanted))
        self.metroFollows = min(metroAvailable, max(0, slots - railFollows))
    }
}

private struct MixedBoardCard: View {
    let entry: MixedBoardEntry
    let scale: RailScale
    let box: CGFloat

    private var metro: MetroEntry { entry.metro }

    var body: some View {
        // 列高全走 scale.pt() ⇒ 預算要換回設計點再算，否則小機型會以為自己還有餘裕。
        let plan = MixedPlan(box: box / max(scale.k, 0.01),
                             fixed: fixedHeight,
                             metroAvailable: max(0, metroRows.count - 1),
                             railAvailable: max(0, railCount - 1))
        VStack(alignment: .leading, spacing: 0) {
            RailCardTitle(title: RailNativeL10n.name(metro.title), scale: scale) {
                RailStamp(text: stamp.text, suffix: stamp.suffix, warn: stamp.warn, scale: scale)
            }
            Spacer().frame(height: scale.pt(MixedMetrics.titleGap))

            metroHalf(follows: plan.metroFollows)

            sectionDivider

            sectionHeader(railHeader)
            railSection(follows: plan.railFollows)

            Spacer(minLength: 0)
        }
    }

    // MARK: - 兩區

    /// 捷運那半點下去 ＝ 在背景直接開等車卡,不打開 App(同小卡,見 MetroBoardView.body)。
    /// 🔴 只包捷運那半:整張卡都包起來的話,鐵路那半也會變成「開捷運等車卡」的按鈕;
    ///    鐵路那半維持整卡的 widgetURL 深連結(見 MixedBoardEntryView)。
    /// 🔴 內層 VStack 與外層同參數(.leading／spacing 0),包 Button(.plain) 不改變幾何——
    ///    Button 的 label 若直接收兩個子 view 會被塞進隱式橫排,分區標題就跑到列的旁邊去。
    @ViewBuilder private func metroHalf(follows: Int) -> some View {
        let content = VStack(alignment: .leading, spacing: 0) {
            sectionHeader(metroHeader)
            metroSection(follows: follows)
        }
        if let t = metro.waitTarget {
            Button(intent: MetroWaitStartIntent(sys: t.sys, station: t.station, dest: t.dest)) {
                content
            }
            .buttonStyle(.plain)
        } else {
            content
        }
    }

    @ViewBuilder private func metroSection(follows: Int) -> some View {
        if let last = metro.lastTrain {
            // 末班車是【車站層】的事實，不屬於任何一列 ⇒ 掛在分區標題底下，
            // 不掛進某一列的內容欄（掛進去會被讀成「那一班是末班車」）。
            plainLine(height: MixedMetrics.extraLine) {
                RailStatusTag(kind: .lastTrainAt(last), fontSize: 12, scale: scale)
            }
        }
        if metroRows.isEmpty {
            emptyLine(metro.emptyBody(at: entry.date))
        } else {
            let shown = Array(metroRows.dropFirst().prefix(follows))
            MetroRowView(row: metroRows[0], precision: metro.precision, role: .hero,
                         entryDate: entry.date, sys: metro.sys, station: metro.title,
                         scale: scale)
            ForEach(Array(shown.enumerated()), id: \.offset) { _, row in
                MetroRowView(row: row, precision: metro.precision, role: .followLarge,
                             entryDate: entry.date, sys: metro.sys, station: metro.title,
                             disambiguate: ambiguousDests.contains(row.dest), scale: scale)
            }
        }
    }

    @ViewBuilder private func railSection(follows: Int) -> some View {
        switch entry.rail.content {
        case .board(let snapshot):
            if let notice = snapshot.notice {
                plainLine(height: MixedMetrics.extraLine) { BoardNotice(notice: notice, scale: scale) }
            }
            if snapshot.rows.isEmpty {
                emptyLine((snapshot.emptyMessage ?? "今天沒有更晚的班次了", false))
            } else {
                let shown = Array(snapshot.rows.dropFirst().prefix(follows))
                BoardRowView(row: snapshot.rows[0], snapshot: snapshot, entryDate: entry.date,
                             role: .hero, scale: scale)
                ForEach(Array(shown.enumerated()), id: \.offset) { index, row in
                    BoardRowView(row: row, snapshot: snapshot, entryDate: entry.date,
                                 role: .followLarge,                                  scale: scale)
                }
            }
        case .place(let snapshot):
            if placeRows.isEmpty {
                emptyLine(("這個地點附近今天沒有更晚的班次", false))
            } else {
                let shown = Array(placeRows.dropFirst().prefix(follows))
                PlaceRowView(row: placeRows[0].row, typeColors: snapshot.typeColors,
                             entryDate: entry.date, role: .hero, lineColor: placeRows[0].color,
                             scale: scale)
                ForEach(Array(shown.enumerated()), id: \.offset) { index, item in
                    PlaceRowView(row: item.row, typeColors: snapshot.typeColors,
                                 entryDate: entry.date, role: .followLarge, lineColor: item.color,
                                 scale: scale)
                }
            }
        case .unavailable(let message):
            emptyLine((message, false))
        }
    }

    // MARK: - 分區骨架

    private func sectionHeader(_ text: String) -> some View {
        plainLine(height: RailRowHeight.sectionHeader) {
            RailSectionHeader(text: text, scale: scale)
        }
    }

    /// 分區之間的內縮 hairline。軌脊已撤除（見 RailRow 的註解）⇒ 不再需要替它讓出左欄。
    private var sectionDivider: some View {
        Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 1)
            .frame(height: scale.pt(MixedMetrics.divider))
    }

    private func plainLine<Content: View>(
        height: CGFloat,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: scale.pt(6)) {
            content()
            Spacer(minLength: 0)
        }
        .frame(height: scale.pt(height))
    }

    private func emptyLine(_ body: (text: String, isCTA: Bool)) -> some View {
        plainLine(height: MixedMetrics.message) {
            Text(RailNativeL10n.text(body.text))
                .font(.system(size: scale.pt(13)))
                .foregroundStyle(body.isCTA ? AnyShapeStyle(HierarchicalShapeStyle.primary)
                                            : AnyShapeStyle(HierarchicalShapeStyle.secondary))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - 資料

    /// 依 entry 時刻過濾：到站超過 30 秒的列整列退場（與小卡同一個判準）。
    private var metroRows: [MetroRow] {
        guard let rows = metro.snapshot?.rows else { return [] }
        return rows.filter {
            $0.etaEpoch == nil || $0.etaEpoch! + 30 > entry.date.timeIntervalSince1970
        }
    }

    /// 這張卡上看得見的列裡出現過兩次以上的終點 ⇒ 只有這些次列要補線名。
    private var ambiguousDests: Set<String> {
        var seen: [String: Int] = [:]
        for row in metroRows { seen[row.dest, default: 0] += 1 }
        return Set(seen.filter { $0.value > 1 }.keys)
    }

    /// 「我的地點」在混合卡上攤平成一串：半張卡塞不下設計稿的多欄版面，而這裡的閱讀
    /// 重點是「下一班什麼時候經過」⇒ 各線合併後按時刻排，線色留在軌脊點上。
    private var placeRows: [(row: PlaceBoardRow, color: Color)] {
        guard case .place(let snapshot) = entry.rail.content else { return [] }
        return snapshot.lines
            .flatMap { line in line.rows.map { (row: $0, color: Color(hex: line.color)) } }
            .sorted { $0.row.scheduledDate < $1.row.scheduledDate }
    }

    private var railCount: Int {
        switch entry.rail.content {
        case .board(let s):  return s.rows.count
        case .place:         return placeRows.count
        case .unavailable:   return 0
        }
    }

    private var railTitle: String? {
        switch entry.rail.content {
        case .board(let s):  return s.title
        case .place(let s):  return s.title
        case .unavailable:   return nil
        }
    }

    private var metroHeader: String {
        guard metro.auto else { return RailNativeL10n.text("捷運 · 倒數") }
        // 小卡的徽章與大卡的分區標題講同一件事,不分岔(MetroBoardView.autoBadge)。
        return RailNativeL10n.text(metro.autoStale ? "捷運 · 上次位置" : "捷運 · 自動選站")
    }

    /// 兩半可以設在不同車站（板橋台鐵＋板橋捷運是常態，但設成不同站也合法）。
    /// 站名不同時分區標題就是唯一講得清楚的地方 ⇒ 站名優先於「時刻／經過」這種量度字。
    private var railHeader: String {
        if let name = railTitle, name != metro.title {
            let shown: String
            if case .place = entry.rail.content { shown = name }
            else { shown = RailNativeL10n.name(name) }
            return RailNativeL10n.text("臺鐵・高鐵 · {name}", ["name": shown])
        }
        if case .place = entry.rail.content { return RailNativeL10n.text("臺鐵・高鐵 · 經過") }
        return RailNativeL10n.text("臺鐵・高鐵 · 時刻")
    }

    /// 卡片只放一個資料時刻。取捷運那一份：它是官方回應自帶的時刻（會真的變舊），
    /// 而發車看板的 generatedAt 只是這張卡上次重建的時間（班表本身不會過期）。
    private var stamp: (text: String, suffix: String, warn: Bool) {
        if let at = metro.snapshot?.dataAt {
            let time = RailBoardClock.updateTimeString(Date(timeIntervalSince1970: at))
            return (time, metro.failed ? "上次更新" : "更新", metro.failed)
        }
        switch entry.rail.content {
        case .board(let s):
            return (RailBoardClock.updateTimeString(s.generatedAt), "更新", false)
        case .place(let s):
            return (RailBoardClock.updateTimeString(s.generatedAt), "更新", false)
        case .unavailable:
            return ("—", "", false)
        }
    }

    private var fixedHeight: CGFloat {
        var h = RailRowHeight.cardTitle + MixedMetrics.titleGap + MixedMetrics.divider
            + 2 * RailRowHeight.sectionHeader
        if metro.lastTrain != nil { h += MixedMetrics.extraLine }
        h += metroRows.isEmpty ? MixedMetrics.message : RailRowHeight.hero
        if case .board(let s) = entry.rail.content, s.notice != nil { h += MixedMetrics.extraLine }
        h += railCount == 0 ? MixedMetrics.message : RailRowHeight.hero
        return h
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
        .configurationDisplayName("鐵路＋捷運看板")
        .description("同一張卡看台鐵／高鐵發車與捷運進站倒數。")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
