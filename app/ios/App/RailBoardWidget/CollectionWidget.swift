import SwiftUI
import WidgetKit

// 「車站收集」小工具的外殼：讀資料、排時間軸、選版面。版面與資料模型在 CollectionCard.swift
// （純 SwiftUI，給算繪 harness 整檔納入）；這裡有 AppIntents 與 Color(uiColor:)，所以不能被 harness 編。
//
// 資料流：網頁算好整包（同護照「車站 N 座」的同一個函式）→ RailCollection 外掛原子寫入
// App Group `group.tw.railisland.app` 根目錄的 collection.json → 呼叫
// `WidgetCenter.shared.reloadTimelines(ofKind: "CollectionWidget")`。這裡只讀，不重算任何數字。
//
// 點小工具：不設 widgetURL，打開 App 首頁。2026-09-29 查過：現有深連結只有 railisland://metro-wait、
// station、pass 三個 host（RailMetroWaitPlugin.handleOpen），網頁端 waitOpen 只認 view:'pass'
// （通行證方案頁，不是旅程護照）與 view:'station'，沒有任何路徑能直接開旅程護照（openRidePanel）。
// 要做得先動 AppDelegate／RailMetroWaitPlugin 與網頁路由，不在這一批範圍。

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
            case .systemLarge: LargeCollectionView(content: entry.content)
            case .accessoryRectangular: RectangularCollectionView(content: entry.content)
            case .accessoryCircular: CircularCollectionView(content: entry.content)
            default: SmallCollectionView(content: entry.content)
            }
        }
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
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular])
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

#Preview(as: .systemLarge) {
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
