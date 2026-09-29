import SwiftUI
import WidgetKit

// 「車站收集」小工具的外殼：讀資料、排時間軸、選版面。版面與資料模型在 CollectionCard.swift
// （純 SwiftUI，給算繪 harness 整檔納入）；這裡有 AppIntents 與 Color(uiColor:)，所以不能被 harness 編。
//
// 資料流：網頁算好整包（同護照「車站 N 座」的同一個函式）→ RailCollection 外掛原子寫入
// App Group `group.tw.railisland.app` 根目錄的 collection.json → 呼叫
// `WidgetCenter.shared.reloadTimelines(ofKind: "CollectionWidget")`。這裡只讀，不重算任何數字。
//
// 點小工具：所有尺寸都開 railisland://passport（旅程護照）。使用者 09-29 裁示「打開旅程護照（建議）」。
// RailMetroWaitPlugin.handleOpen 收 host `passport`、轉成 waitOpen 事件（data.view = "passport"），
// 網頁端收到就開 openRidePanel()。只在下面 EntryView 的最外層掛一次 widgetURL，四種家族共用；
// 驗收腳本 render_collect_widget.mjs 的 u 閘門靜態掃這裡（拿掉或改掛在單一家族分支上都會紅）。

extension CollectionStore {
    /// App Group 容器根目錄的 collection.json。
    static func loadShared() -> CollectionSnapshot? {
        load(rootURL: FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: RailBoardConstants.appGroupID))
    }

    /// 小工具圖庫預覽與 placeholder 用的內建示意資料（201／538，示意收集）。
    /// 不是使用者的資料：只在 context.isPreview 與 placeholder 用，真實畫面一律讀 loadShared()。
    static func loadPreviewSample() -> CollectionSnapshot? {
        guard let url = Bundle.main.url(forResource: "CollectionWidgetPreview", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return decode(data)
    }
}

struct CollectionEntry: TimelineEntry {
    let date: Date
    let configuration: CollectionIntent
    let content: CollectionContent
}

struct CollectionProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> CollectionEntry {
        CollectionEntry(date: .now, configuration: CollectionIntent(),
                        content: CollectionContent.make(CollectionStore.loadPreviewSample(), scope: nil))
    }

    func snapshot(for configuration: CollectionIntent, in context: Context) async -> CollectionEntry {
        // 圖庫裡（還沒加上桌面）沒有使用者的資料可看，放示意資料；已加上桌面的快照走真資料。
        let snap = context.isPreview ? (CollectionStore.loadPreviewSample() ?? CollectionStore.loadShared())
                                     : CollectionStore.loadShared()
        return CollectionEntry(date: .now, configuration: configuration,
                               content: CollectionContent.make(snap, scope: configuration.scope))
    }

    func timeline(for configuration: CollectionIntent, in context: Context) async -> Timeline<CollectionEntry> {
        let entry = CollectionEntry(
            date: .now, configuration: configuration,
            content: CollectionContent.make(CollectionStore.loadShared(), scope: configuration.scope))
        // 內容只在 App 寫檔並 reloadTimelines 時才會變；六小時一次只是保險（檔案被外力換掉時自癒）。
        return Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(6 * 3600)))
    }
}

struct CollectionEntryView: View {
    let entry: CollectionEntry

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode

    private var isLockScreen: Bool { family == .accessoryRectangular || family == .accessoryCircular }

    var body: some View {
        Group {
            switch family {
            case .systemMedium: MediumCollectionView(content: entry.content)
            case .accessoryRectangular: RectangularCollectionView(content: entry.content)
            case .accessoryCircular: CircularCollectionView(content: entry.content)
            default: SmallCollectionView(content: entry.content)
            }
        }
        // 點小工具 → 旅程護照。掛在家族 switch 的外面：四種尺寸（含鎖屏兩款）一律生效。
        .widgetURL(URL(string: "railisland://passport"))
        // 著色（tinted／accented）與鎖屏：系統會把所有顏色壓成單一色調 ⇒ 由元件層統一退成單色版面。
        .railRenderingMode(renderingMode)
        .containerBackground(for: .widget) {
            if isLockScreen { Color.clear } else { Color(uiColor: .systemBackground) }
        }
    }
}

struct CollectionWidget: Widget {
    let kind = "CollectionWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: CollectionIntent.self,
            provider: CollectionProvider()
        ) { entry in
            CollectionEntryView(entry: entry)
        }
        .configurationDisplayName("車站收集")
        .description("看你收集了幾成全台鐵道車站。點陣照車站的真實位置排出鐵道網，收集過的站亮起線色；範圍可選全台或單一系統。")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
        .contentMarginsDisabled()
    }
}

#Preview(as: .systemSmall) {
    CollectionWidget()
} timeline: {
    CollectionEntry(date: .now, configuration: CollectionIntent(),
                    content: CollectionContent.make(CollectionStore.loadPreviewSample(), scope: nil))
}

#Preview(as: .systemMedium) {
    CollectionWidget()
} timeline: {
    CollectionEntry(date: .now, configuration: CollectionIntent(),
                    content: CollectionContent.make(CollectionStore.loadPreviewSample(), scope: nil))
}

#Preview(as: .accessoryRectangular) {
    CollectionWidget()
} timeline: {
    CollectionEntry(date: .now, configuration: CollectionIntent(),
                    content: CollectionContent.make(CollectionStore.loadPreviewSample(), scope: nil))
}

#Preview(as: .accessoryCircular) {
    CollectionWidget()
} timeline: {
    CollectionEntry(date: .now, configuration: CollectionIntent(),
                    content: CollectionContent.make(CollectionStore.loadPreviewSample(), scope: nil))
}
