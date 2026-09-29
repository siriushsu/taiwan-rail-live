import SwiftUI
import WidgetKit

// 「車站收集」小工具的資料模型與五種版面（純 SwiftUI，刻意不碰 UIKit／AppIntents）。
//
// 為什麼獨立成一個檔：app/scripts/render_collect_widget.mjs 把這個檔【整檔逐字】連同
// RailWidgetKit.swift、RailNativeL10n.swift 一起交給 swiftc 編成 macOS 執行檔算圖，
// 不抽宣告——抽取有「抽到舊版」的風險，整檔納入則檔案哪天開始依賴別的檔，編譯當場失敗。
// Widget／Provider／EntryView（要 AppIntents 與 Color(uiColor:)）放在 CollectionWidget.swift。
//
// 架構：網頁算、原生只畫。數字只有一個來源——網頁 stationCollection(loadRides())，
// 也就是護照「車站 N 座」用的那個函式；網頁整包算好經外掛寫成 App Group 的 collection.json，
// 這裡【只讀不算】：n／total／各系統 v／n／recent／點位一律照抄，唯一自己算的是
// 「百分比四捨五入」與「進度條填滿比例」這兩個純顯示量（由驗收腳本從 payload 獨立重算比對）。
// 契約（資料格式 v1）：docs/superpowers/plans/2026-09-29-車站收集小工具.md。

// MARK: - 資料模型（collection.json v1）

struct CollectionSnapshot: Decodable {
    struct System: Decodable {
        let k: String
        let label: String
        let v: Int
        let n: Int
    }

    struct Recent: Decodable {
        let name: String
        let line: String
        let k: String?
        let d: String
    }

    /// pts 的每個元素是 [x, y, "#色碼", s, sysIdx] 的異質陣列。
    /// x、y 為 0..1000（x 由西到東、y 由北到南）；s：0 未收集、1 跟完、2 搭過或到訪。
    struct Point: Decodable {
        let x: Double
        let y: Double
        let color: String
        let s: Int
        let sys: Int

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            x = try c.decode(Double.self)
            y = try c.decode(Double.self)
            color = try c.decode(String.self)
            s = try c.decode(Int.self)
            sys = c.isAtEnd ? -1 : try c.decode(Int.self)
        }
    }

    let v: Int
    let aspect: Double
    let n: Int
    let total: Int
    let sys: [System]
    let recent: [Recent]
    let pts: [Point]
}

enum CollectionStore {
    static let fileName = "collection.json"

    /// 只收 v == 1；版本不認得、寬高比不合理都當「沒有資料」，走「打開軌島一次」那個畫面，
    /// 不畫一張長得像有資料、其實是壞的卡。
    static func decode(_ data: Data) -> CollectionSnapshot? {
        guard let snap = try? JSONDecoder().decode(CollectionSnapshot.self, from: data),
              snap.v == 1, snap.aspect > 0.1, snap.aspect < 10, snap.total >= 0, snap.n >= 0
        else { return nil }
        return snap
    }

    static func load(rootURL: URL?) -> CollectionSnapshot? {
        guard let rootURL,
              let data = try? Data(contentsOf: rootURL.appendingPathComponent(fileName))
        else { return nil }
        return decode(data)
    }
}

// MARK: - 由 payload 得到「這張卡要顯示的數字」

struct CollectionDot: Equatable {
    let x: Double
    let y: Double
    let color: String
    let s: Int
}

struct CollectionFigures {
    /// nil＝全台
    let scopeKey: String?
    /// 全台，或該系統在 payload 裡的名稱（已是網頁當下的語言）。
    let title: String
    let collected: Int
    let total: Int
    let percent: Int
    let aspect: Double
    let dots: [CollectionDot]
    let systems: [CollectionSnapshot.System]
    /// 最近蓋章：全台＝payload 全部（最多 4 筆）；單一系統＝只留 k 相符的。
    let recent: [CollectionSnapshot.Recent]
    /// 中卡的進度條：有收集的系統，依總站數大到小，最多 5 個。
    let topSystems: [CollectionSnapshot.System]
    /// 一站都還沒收集的系統數（「還有 K 個系統還沒去過」的 K）。
    let untouchedSystems: Int

    var isAll: Bool { scopeKey == nil }
    var isEmpty: Bool { collected == 0 }
    var remaining: Int { max(0, total - collected) }
}

enum CollectionScope {
    /// 設定選單裡「全台」的存值。nil（沒動過設定）與讀不懂的值都當全台。
    static let allKey = "all"

    /// 整數百分比，半數進位（與網頁 Math.round 一致）。整數運算，不經浮點。
    static func percent(_ v: Int, of total: Int) -> Int {
        guard total > 0, v > 0 else { return 0 }
        return min(100, (v * 200 + total) / (2 * total))
    }

    /// 進度條／直立條的填滿比例：v/n，但「有收集」時至少畫 3%，不然 1/241 是看不見的一條線。
    static func fill(_ v: Int, of n: Int) -> Double {
        guard n > 0, v > 0 else { return 0 }
        return min(1, max(Double(v) / Double(n), 0.03))
    }

    /// "2026-09-27" → "9/27"；格式不對就原樣顯示（不猜、不丟）。
    static func shortDate(_ iso: String) -> String {
        let p = iso.split(separator: "-")
        guard p.count == 3, let m = Int(p[1]), let d = Int(p[2]) else { return iso }
        return "\(m)/\(d)"
    }

    static func figures(_ snap: CollectionSnapshot, scope: String?) -> CollectionFigures {
        let index = scope.flatMap { key in snap.sys.firstIndex { $0.k == key } }
        let ranked = snap.sys.enumerated()
            .filter { $0.element.v > 0 }
            .sorted { a, b in a.element.n != b.element.n ? a.element.n > b.element.n : a.offset < b.offset }
            .prefix(5)
            .map(\.element)
        let untouched = snap.sys.filter { $0.v == 0 }.count

        if let index {
            let sys = snap.sys[index]
            let dots = snap.pts.filter { $0.sys == index }
                .map { CollectionDot(x: $0.x, y: $0.y, color: $0.color, s: $0.s) }
            return CollectionFigures(
                scopeKey: sys.k, title: sys.label,
                collected: sys.v, total: sys.n, percent: percent(sys.v, of: sys.n),
                aspect: snap.aspect, dots: dots, systems: snap.sys,
                recent: snap.recent.filter { $0.k == sys.k },
                topSystems: ranked, untouchedSystems: untouched)
        }
        return CollectionFigures(
            scopeKey: nil, title: RailNativeL10n.text("全台"),
            collected: snap.n, total: snap.total, percent: percent(snap.n, of: snap.total),
            aspect: snap.aspect,
            dots: snap.pts.map { CollectionDot(x: $0.x, y: $0.y, color: $0.color, s: $0.s) },
            systems: snap.sys, recent: snap.recent,
            topSystems: ranked, untouchedSystems: untouched)
    }
}

enum CollectionContent {
    /// 沒有 collection.json（App 還沒開過、或版本不認得）
    case unavailable
    case data(CollectionFigures)

    /// Provider 與算繪 harness 共用這一個入口，兩邊不會各自決定「沒檔案長什麼樣」。
    static func make(_ snap: CollectionSnapshot?, scope: String?) -> CollectionContent {
        guard let snap else { return .unavailable }
        return .data(CollectionScope.figures(snap, scope: scope))
    }
}

// MARK: - 驗收專用（出貨路徑恆為預設值，與 railFamilyOverride 同一種做法）
//
// 🔴 這一段只給 app/scripts/render_collect_widget.mjs 用。出貨時三個環境值都是預設，
//    對版面與算繪零影響；harness 把它們打開，才量得到「字形實際落在哪」「畫了幾個點」。

/// 打開後，每個文字與每條進度條把自己的實際範圍回報上來。
struct CollectionMeasureKey: EnvironmentKey { static let defaultValue = false }
/// 打開後，地圖只佔位不畫點：算繪出來的墨跡就只剩文字，才能量「文字有沒有壓進地圖框」。
struct CollectionMapHiddenKey: EnvironmentKey { static let defaultValue = false }
/// 打開後，Canvas 每畫一個點就記一筆（量的是真的 fill 呼叫，不是事先算好的長度）。
struct CollectionProbeKey: EnvironmentKey { static let defaultValue: CollectionDrawProbe? = nil }

final class CollectionDrawProbe: @unchecked Sendable {
    var off = 0
    var follow = 0
    var solid = 0
}

extension EnvironmentValues {
    var collectMeasure: Bool {
        get { self[CollectionMeasureKey.self] }
        set { self[CollectionMeasureKey.self] = newValue }
    }
    var collectMapHidden: Bool {
        get { self[CollectionMapHiddenKey.self] }
        set { self[CollectionMapHiddenKey.self] = newValue }
    }
    var collectProbe: CollectionDrawProbe? {
        get { self[CollectionProbeKey.self] }
        set { self[CollectionProbeKey.self] = newValue }
    }
}

struct CollectionFrameReport: Equatable {
    var id: String
    var text: String?
    var key: Bool
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

struct CollectionFramesKey: PreferenceKey {
    static var defaultValue: [CollectionFrameReport] { [] }
    static func reduce(value: inout [CollectionFrameReport], nextValue: () -> [CollectionFrameReport]) {
        value += nextValue()
    }
}

enum CollectionSpace {
    static let card = "collectCard"
}

struct CollectionReporter: View {
    let id: String
    var text: String? = nil
    var key = false

    var body: some View {
        GeometryReader { g in
            let f = g.frame(in: .named(CollectionSpace.card))
            Color.clear.preference(
                key: CollectionFramesKey.self,
                value: [CollectionFrameReport(id: id, text: text, key: key,
                                              x: f.minX, y: f.minY, w: f.width, h: f.height)])
        }
    }
}

struct CollectionReportModifier: ViewModifier {
    let id: String
    @Environment(\.collectMeasure) private var measure

    func body(content: Content) -> some View {
        if measure {
            content.background(CollectionReporter(id: id))
        } else {
            content
        }
    }
}

extension View {
    func collectReport(_ id: String) -> some View { modifier(CollectionReportModifier(id: id)) }
}

// MARK: - 共用小元件

enum CollectionMetrics {
    /// 內容邊距。與 RailBoardInsets.content 同值（這個小工具同樣 contentMarginsDisabled，邊距由 View 自帶）；
    /// 驗收腳本會比對兩處數值，不一樣就紅。
    static let inset: CGFloat = 16
    /// 地圖點的半徑 = 地圖高 × 這個比例，但至少 1pt；已收集的點再放大 solidScale 倍。
    static let dotRadiusRatio: CGFloat = 0.0075
    static let dotRadiusFloor: CGFloat = 1.0
    static let solidScale: CGFloat = 1.3
    /// 跟完（s=1）用線色但畫淡：不透明度。
    static let followAlpha = 0.6
    /// 為文字欄預留給地圖的寬度佔（地圖高）的比例。台灣點陣寬高比 0.5516，取 0.6 留餘裕。
    static let mapReserveRatio: CGFloat = 0.6

    /// 一段文字的粗估寬度：CJK 一字一個字級寬，其餘（拉丁字母）取 0.62 個字級寬（半粗體平均，偏寬一點）。
    /// 只用來決定「系統名那一欄要多寬」——繁中兩字的簡稱估出來小於下限，版面與加這個函式之前一樣。
    static func estimatedWidth(_ text: String, fontSize: CGFloat) -> CGFloat {
        var em: CGFloat = 0
        for u in text.unicodeScalars { em += u.value >= 0x2E80 ? 1.0 : 0.62 }
        return em * fontSize
    }
}

enum CollectionTone {
    case primary, secondary, tertiary

    var style: AnyShapeStyle {
        switch self {
        case .primary: return AnyShapeStyle(HierarchicalShapeStyle.primary)
        case .secondary: return AnyShapeStyle(HierarchicalShapeStyle.secondary)
        case .tertiary: return AnyShapeStyle(HierarchicalShapeStyle.tertiary)
        }
    }
}

/// 單行文字。`key` 標的是「關鍵數字」：百分比、已收集座數、進度數字——這些不准被縮放或截成「…」
/// （harness 量到實際寬度小於理想寬度就紅）。其餘文字（標題、站名、線名）允許縮到 minScale。
struct CollectionText: View {
    let id: String
    /// 回報用的純文字（數字判準與版面判準看它）。
    let text: String
    /// 已套字型的 Text（讓百分比可以「大數字＋小符號」串成一個 Text）。
    let content: Text
    var key = false
    var lines = 1
    var minScale: CGFloat = 0.8
    var tone: CollectionTone = .primary

    @Environment(\.collectMeasure) private var measure

    var body: some View {
        // 🔴 關鍵數字用 fixedSize(vertical:)：高度不夠時讓它【溢出】而不是被 minimumScaleFactor 悄悄壓扁——
        //    壓扁是無聲的（中卡 393pt 機型實測過：列高 13pt 塞 14pt 的字，數字縮 3% 沒人發現），
        //    溢出則會被 harness 的「超出內容框」與「文字互疊」兩道閘門抓到。
        let base = Group {
            if key {
                content.lineLimit(lines).minimumScaleFactor(minScale).fixedSize(horizontal: false, vertical: true)
            } else {
                content.lineLimit(lines).minimumScaleFactor(minScale)
            }
        }
        .foregroundStyle(tone.style)
        if measure {
            base
                .background(CollectionReporter(id: id, text: text, key: key))
                .overlay(alignment: .topLeading) {
                    if key && lines == 1 {
                        // 理想寬度：同一段文字不受任何限制時的寬，拿來對照實際寬度。
                        content.lineLimit(1).fixedSize().hidden()
                            .background(CollectionReporter(id: id + "#ideal", text: text, key: key))
                    }
                }
        } else {
            base
        }
    }
}

/// 橫向進度條（中卡系統列、鎖屏矩形、單一系統的整條）。
struct CollectionBar: View {
    let id: String
    let fraction: Double
    let height: CGFloat
    var dimmed = false

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        let brand = RailTokens.colors(scheme).brand
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(CollectionPalette.off(scheme))
                Capsule()
                    .fill(mono ? AnyShapeStyle(HierarchicalShapeStyle.primary) : AnyShapeStyle(brand))
                    .opacity(dimmed ? 0.4 : 1)
                    .frame(width: geo.size.width * fraction)
                    .collectReport(id + ".fill")
                    .widgetAccentable()
            }
        }
        .frame(height: height)
        .collectReport(id + ".track")
    }
}

/// 大卡底部的直立填滿條（一個系統一根）。
struct CollectionPill: View {
    let id: String
    let fraction: Double
    let height: CGFloat
    var dimmed = false

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        let brand = RailTokens.colors(scheme).brand
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                Rectangle().fill(CollectionPalette.off(scheme))
                Rectangle()
                    .fill(mono ? AnyShapeStyle(HierarchicalShapeStyle.primary) : AnyShapeStyle(brand))
                    .opacity(dimmed ? 0.4 : 1)
                    .frame(height: geo.size.height * fraction)
                    .collectReport(id + ".fill")
                    .widgetAccentable()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: height)
        .clipShape(Capsule())
        .collectReport(id + ".track")
    }
}

// MARK: - 點陣地圖

enum CollectionPalette {
    /// 未收集的中性淡灰（軌道底色用同一組灰）。
    static func off(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(white: 0.24) : Color(white: 0.88)
    }

    /// 線色 → Color。深色模式提亮（網頁 mockup 的 brightness(1.3)，這裡取 1.25 再夾住），
    /// 不然藏青與深綠在深底上看不見。解不出來就用品牌藏青：點要照畫，不能丟（畫出的點數是判準）。
    static func color(_ hex: String, scheme: ColorScheme) -> Color {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return RailTokens.colors(scheme).brand }
        let gain = scheme == .dark ? 1.25 : 1.0
        func channel(_ shift: UInt32) -> Double { min(1, Double((v >> shift) & 0xFF) / 255 * gain) }
        return Color(.sRGB, red: channel(16), green: channel(8), blue: channel(0))
    }
}

struct CollectionMapView: View {
    let dots: [CollectionDot]

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono
    @Environment(\.collectMapHidden) private var hidden
    @Environment(\.collectProbe) private var probe

    static func radius(forHeight h: CGFloat) -> CGFloat {
        max(CollectionMetrics.dotRadiusFloor, h * CollectionMetrics.dotRadiusRatio)
    }

    /// 點的畫面座標：x、y 為 0..1000，留出已收集點的半徑當內距，最邊上的點才不會被裁掉。
    static func center(_ dot: CollectionDot, in size: CGSize) -> CGPoint {
        let inset = radius(forHeight: size.height) * CollectionMetrics.solidScale
        return CGPoint(x: inset + dot.x / 1000 * (size.width - 2 * inset),
                       y: inset + dot.y / 1000 * (size.height - 2 * inset))
    }

    var body: some View {
        let dots = self.dots, scheme = self.scheme, mono = self.mono
        let hidden = self.hidden, probe = self.probe
        // 🔴 未收集的點用【不透明】淡灰，不用 primary 加透明度：台北一帶幾十個點疊在一起，
        //    半透明會疊成一團黑（實測 small 空狀態），看起來像有東西被收集了。
        let off = CollectionPalette.off(scheme)
        ZStack {
            // 未收集：中性淡灰，畫在底層。
            Canvas { ctx, size in
                probe?.off = 0
                guard !hidden else { return }
                let r = Self.radius(forHeight: size.height)
                for d in dots where d.s == 0 {
                    let c = Self.center(d, in: size)
                    ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                             with: .color(off))
                    probe?.off += 1
                }
            }
            // 已收集（含跟完）：線色。單獨一層是為了讓「著色」模式只把這一層染成強調色。
            Canvas { ctx, size in
                probe?.follow = 0
                probe?.solid = 0
                guard !hidden else { return }
                let r = Self.radius(forHeight: size.height) * CollectionMetrics.solidScale
                // 先畫淡的、再畫實心，實心疊在淡的上面。
                for pass in [1, 2] {
                    for d in dots where d.s == pass {
                        let c = Self.center(d, in: size)
                        let base = mono ? Color.primary : CollectionPalette.color(d.color, scheme: scheme)
                        let paint = pass == 1 ? base.opacity(CollectionMetrics.followAlpha) : base
                        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                                 with: .color(paint))
                        if pass == 1 { probe?.follow += 1 } else { probe?.solid += 1 }
                    }
                }
            }
            .widgetAccentable()
        }
        .collectReport("map")
    }
}

// MARK: - 文案

enum CollectionCopy {
    static func heading(_ f: CollectionFigures) -> String {
        let name = RailNativeL10n.text("車站收集")
        return f.isAll ? name : "\(f.title) · \(name)"
    }

    static func count(_ f: CollectionFigures) -> String {
        RailNativeL10n.text("已收集 {n} 座", ["n": "\(f.collected)"])
    }

    static func countOf(_ f: CollectionFigures) -> String {
        RailNativeL10n.text("已收集 {v}／{n} 座", ["v": "\(f.collected)", "n": "\(f.total)"])
    }

    static func remaining(_ f: CollectionFigures) -> String {
        RailNativeL10n.text("還有 {n} 座", ["n": "\(f.remaining)"])
    }

    static func totalLine(_ f: CollectionFigures) -> String {
        RailNativeL10n.text("{scope} {total} 座 · 還有 {remain} 座",
                            ["scope": f.title, "total": "\(f.total)", "remain": "\(f.remaining)"])
    }

    /// 「37」大、「%」小的百分比。用 AttributedString 串，不用 Text + Text（macOS／iOS 26 起 `+` 標為棄用）。
    static func bigPercent(_ pct: Int, big: CGFloat, small: CGFloat) -> Text {
        var number = AttributedString("\(pct)")
        number.font = .system(size: big, weight: .bold).monospacedDigit()
        var sign = AttributedString("%")
        sign.font = .system(size: small, weight: .semibold)
        sign.foregroundColor = .secondary
        return Text(number + sign)
    }

    static var emptyTitle: String { RailNativeL10n.text("還沒有收集的車站") }
    static var emptyHint: String { RailNativeL10n.text("跟一班車到終點，或到車站打卡就會蓋章") }
    static var unavailable: String { RailNativeL10n.text("打開軌島一次，就會出現你的車站收集") }
}

// MARK: - Small（小卡）

struct SmallCollectionView: View {
    let content: CollectionContent

    var body: some View {
        GeometryReader { geo in
            let k = RailScale(width: geo.size.width, reference: RailScale.smallReference)
            Group {
                switch content {
                case .unavailable: CollectionUnavailableBody(k: k, big: false)
                case .data(let f): dataBody(f, k, geo.size)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(CollectionMetrics.inset)
        .coordinateSpace(name: CollectionSpace.card)
    }

    @ViewBuilder
    private func dataBody(_ f: CollectionFigures, _ k: RailScale, _ size: CGSize) -> some View {
        let gap = k.pt(6)
        let bodyH = size.height - k.pt(16) - gap
        let mapH = (bodyH * 0.86).rounded()
        let mapW = (mapH * f.aspect).rounded()
        // 文字欄與地圖是兩份獨立的預算：文字欄固定佔 58%，地圖靠右下；地圖寬過頭就會壓到字，
        // 那正是 harness 第一道閘門要抓的事。
        let textW = (size.width * 0.58).rounded()

        VStack(alignment: .leading, spacing: gap) {
            header(f, k)
            ZStack(alignment: .bottomTrailing) {
                textColumn(f, k)
                    .frame(width: textW, alignment: .leading)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                CollectionMapView(dots: f.dots)
                    .frame(width: mapW, height: mapH)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// 標題列：範圍名＋「車站收集」。兩個放不下（英日文較長）就只留範圍名，不讓兩者互相擠。
    private func header(_ f: CollectionFigures, _ k: RailScale) -> some View {
        let title = CollectionText(
            id: "title", text: f.title,
            content: Text(f.title).font(.system(size: k.pt(13), weight: .semibold)), minScale: 0.75)
        let name = RailNativeL10n.text("車站收集")
        let subtitle = CollectionText(
            id: "subtitle", text: name,
            content: Text(name).font(.system(size: k.pt(11))), tone: .secondary)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: k.pt(4)) {
                title.fixedSize()
                Spacer(minLength: 2)
                subtitle.fixedSize()
            }
            title.frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: k.pt(16))
    }

    @ViewBuilder
    private func textColumn(_ f: CollectionFigures, _ k: RailScale) -> some View {
        if f.isEmpty {
            VStack(alignment: .leading, spacing: k.pt(4)) {
                CollectionText(
                    id: "empty.title", text: CollectionCopy.emptyTitle,
                    content: Text(CollectionCopy.emptyTitle).font(.system(size: k.pt(13), weight: .semibold)),
                    lines: 3, minScale: 0.75)
                CollectionText(
                    id: "empty.hint", text: CollectionCopy.emptyHint,
                    content: Text(CollectionCopy.emptyHint).font(.system(size: k.pt(11))),
                    lines: 4, minScale: 0.75, tone: .secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                CollectionText(
                    id: "pct", text: "\(f.percent)%",
                    content: CollectionCopy.bigPercent(f.percent, big: k.pt(f.percent >= 100 ? 28 : 34), small: k.pt(15)),
                    key: true)
                Color.clear.frame(height: k.pt(5))
                CollectionText(
                    id: "count", text: CollectionCopy.count(f),
                    content: Text(CollectionCopy.count(f)).font(.system(size: k.pt(11), weight: .semibold)),
                    key: true)
                CollectionText(
                    id: "remain", text: CollectionCopy.remaining(f),
                    content: Text(CollectionCopy.remaining(f)).font(.system(size: k.pt(11))),
                    key: true, tone: .secondary)
            }
        }
    }
}

// MARK: - Medium（中卡）

struct MediumCollectionView: View {
    let content: CollectionContent

    var body: some View {
        GeometryReader { geo in
            let k = RailScale(width: geo.size.width, reference: RailScale.mediumReference)
            Group {
                switch content {
                case .unavailable: CollectionUnavailableBody(k: k, big: true)
                case .data(let f): dataBody(f, k, geo.size)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(CollectionMetrics.inset)
        .coordinateSpace(name: CollectionSpace.card)
    }

    @ViewBuilder
    private func dataBody(_ f: CollectionFigures, _ k: RailScale, _ size: CGSize) -> some View {
        let gap = k.pt(12)
        let mapH = size.height
        let mapW = (mapH * f.aspect).rounded()
        let colW = (size.width - (mapH * CollectionMetrics.mapReserveRatio).rounded() - gap).rounded()

        ZStack(alignment: .leading) {
            column(f, k)
                .frame(width: colW, alignment: .topLeading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            CollectionMapView(dots: f.dots)
                .frame(width: mapW, height: mapH)
        }
    }

    private func column(_ f: CollectionFigures, _ k: RailScale) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: k.pt(6)) {
                let heading = CollectionCopy.heading(f)
                CollectionText(
                    id: "title", text: heading,
                    content: Text(heading).font(.system(size: k.pt(14), weight: .bold)), minScale: 0.7)
                Spacer(minLength: 0)
                CollectionText(
                    id: "pct", text: "\(f.percent)%",
                    content: Text("\(f.percent)%").font(.system(size: k.pt(14), weight: .bold)).monospacedDigit(),
                    key: true)
            }
            CollectionText(
                id: "countOf", text: CollectionCopy.countOf(f),
                content: Text(CollectionCopy.countOf(f)).font(.system(size: k.pt(10.5))),
                key: true, tone: .secondary)
            Spacer(minLength: k.pt(4))
            middle(f, k)
        }
    }

    @ViewBuilder
    private func middle(_ f: CollectionFigures, _ k: RailScale) -> some View {
        if f.isEmpty {
            VStack(alignment: .leading, spacing: k.pt(3)) {
                CollectionText(
                    id: "empty.title", text: CollectionCopy.emptyTitle,
                    content: Text(CollectionCopy.emptyTitle).font(.system(size: k.pt(13), weight: .semibold)),
                    lines: 2, minScale: 0.75)
                CollectionText(
                    id: "empty.hint", text: CollectionCopy.emptyHint,
                    content: Text(CollectionCopy.emptyHint).font(.system(size: k.pt(11))),
                    lines: 3, minScale: 0.75, tone: .secondary)
            }
        } else if f.isAll {
            // 系統名那一欄：繁中兩字取下限 30pt（與之前相同）；英文簡稱（Kaohsiung）比較長，隨最長的那個放寬，上限 58pt。
            let labelWidth = min(k.pt(58), max(k.pt(30), f.topSystems
                .map { CollectionMetrics.estimatedWidth($0.label, fontSize: k.pt(11.5)) }.max() ?? 0))
            VStack(alignment: .leading, spacing: 0) {
                VStack(spacing: k.pt(2)) {
                    ForEach(Array(f.topSystems.enumerated()), id: \.offset) { _, s in
                        systemRow(s, k, labelWidth: labelWidth)
                    }
                }
                if f.untouchedSystems > 0 {
                    let note = RailNativeL10n.text("還有 {n} 個系統還沒去過", ["n": "\(f.untouchedSystems)"])
                    Color.clear.frame(height: k.pt(4))
                    CollectionText(
                        id: "untouched", text: note,
                        content: Text(note).font(.system(size: k.pt(10.5))),
                        key: true, minScale: 0.75, tone: .tertiary)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: k.pt(5)) {
                CollectionBar(id: "scopebar", fraction: CollectionScope.fill(f.collected, of: f.total),
                              height: k.pt(8))
                CollectionText(
                    id: "remain", text: CollectionCopy.remaining(f),
                    content: Text(CollectionCopy.remaining(f)).font(.system(size: k.pt(12), weight: .semibold)),
                    key: true)
                ForEach(Array(f.recent.prefix(2).enumerated()), id: \.offset) { i, r in
                    CollectionRecentRow(record: r, index: i, k: k)
                }
            }
        }
    }

    private func systemRow(_ s: CollectionSnapshot.System, _ k: RailScale, labelWidth: CGFloat) -> some View {
        HStack(spacing: k.pt(6)) {
            CollectionText(
                id: "sys.\(s.k).label", text: s.label,
                content: Text(s.label).font(.system(size: k.pt(11.5), weight: .semibold)), minScale: 0.6)
                .frame(width: labelWidth, alignment: .leading)
            CollectionBar(id: "sys.\(s.k)", fraction: CollectionScope.fill(s.v, of: s.n), height: k.pt(6))
            CollectionText(
                id: "sys.\(s.k).count", text: "\(s.v)/\(s.n)",
                content: Text("\(s.v)/\(s.n)").font(.system(size: k.pt(10.5))).monospacedDigit(),
                key: true, tone: .secondary)
                .frame(width: k.pt(52), alignment: .trailing)
        }
        .frame(height: k.pt(13))
    }
}

/// 一列最近蓋章：日期 M/D＋站名＋線名。日期是關鍵數字；站名、線名太長可以縮或截。
struct CollectionRecentRow: View {
    let record: CollectionSnapshot.Recent
    let index: Int
    let k: RailScale

    var body: some View {
        let date = CollectionScope.shortDate(record.d)
        HStack(alignment: .firstTextBaseline, spacing: k.pt(6)) {
            CollectionText(
                id: "recent.\(index).date", text: date,
                content: Text(date).font(.system(size: k.pt(12))).monospacedDigit(),
                key: true, tone: .secondary)
                .frame(width: k.pt(38), alignment: .leading)
            CollectionText(
                id: "recent.\(index).name", text: record.name,
                content: Text(record.name).font(.system(size: k.pt(13), weight: .semibold)), minScale: 0.7)
            CollectionText(
                id: "recent.\(index).line", text: record.line,
                content: Text(record.line).font(.system(size: k.pt(11))),
                minScale: 0.7, tone: .secondary)
                .layoutPriority(-1)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Large（大卡）

struct LargeCollectionView: View {
    let content: CollectionContent

    var body: some View {
        GeometryReader { geo in
            let k = RailScale(width: geo.size.width, reference: RailScale.mediumReference)
            Group {
                switch content {
                case .unavailable: CollectionUnavailableBody(k: k, big: true)
                case .data(let f): dataBody(f, k, geo.size)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(CollectionMetrics.inset)
        .coordinateSpace(name: CollectionSpace.card)
    }

    @ViewBuilder
    private func dataBody(_ f: CollectionFigures, _ k: RailScale, _ size: CGSize) -> some View {
        let mapH = k.pt(204)
        let mapW = (mapH * f.aspect).rounded()
        let gap = k.pt(14)
        let sideW = (size.width - (mapH * CollectionMetrics.mapReserveRatio).rounded() - gap).rounded()

        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: k.pt(6)) {
                let heading = CollectionCopy.heading(f)
                CollectionText(
                    id: "title", text: heading,
                    content: Text(heading).font(.system(size: k.pt(15), weight: .bold)), minScale: 0.7)
                Spacer(minLength: 0)
                CollectionText(
                    id: "pct", text: "\(f.percent)%",
                    content: Text("\(f.percent)%").font(.system(size: k.pt(28), weight: .bold)).monospacedDigit(),
                    key: true)
            }
            Color.clear.frame(height: k.pt(8))
            ZStack(alignment: .topLeading) {
                side(f, k)
                    .frame(width: sideW, alignment: .topLeading)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                CollectionMapView(dots: f.dots)
                    .frame(width: mapW, height: mapH)
            }
            .frame(height: mapH)
            Spacer(minLength: k.pt(8))
            pills(f, k)
            Color.clear.frame(height: k.pt(6))
            legend(k)
        }
    }

    private func side(_ f: CollectionFigures, _ k: RailScale) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            CollectionText(
                id: "count", text: CollectionCopy.count(f),
                content: Text(CollectionCopy.count(f)).font(.system(size: k.pt(15), weight: .bold)),
                key: true)
            CollectionText(
                id: "totalLine", text: CollectionCopy.totalLine(f),
                content: Text(CollectionCopy.totalLine(f)).font(.system(size: k.pt(12))),
                key: true, tone: .secondary)
            if f.isEmpty {
                Color.clear.frame(height: k.pt(14))
                CollectionText(
                    id: "empty.title", text: CollectionCopy.emptyTitle,
                    content: Text(CollectionCopy.emptyTitle).font(.system(size: k.pt(13), weight: .semibold)),
                    lines: 2, minScale: 0.75)
                Color.clear.frame(height: k.pt(3))
                CollectionText(
                    id: "empty.hint", text: CollectionCopy.emptyHint,
                    content: Text(CollectionCopy.emptyHint).font(.system(size: k.pt(12))),
                    lines: 4, minScale: 0.75, tone: .secondary)
            } else if !f.recent.isEmpty {
                let head = RailNativeL10n.text("最近蓋章")
                Color.clear.frame(height: k.pt(14))
                CollectionText(
                    id: "recent.head", text: head,
                    content: Text(head).font(.system(size: k.pt(11), weight: .semibold)),
                    tone: .secondary)
                Color.clear.frame(height: k.pt(6))
                VStack(alignment: .leading, spacing: k.pt(5)) {
                    ForEach(Array(f.recent.prefix(4).enumerated()), id: \.offset) { i, r in
                        CollectionRecentRow(record: r, index: i, k: k)
                    }
                }
            }
        }
    }

    /// 10 個系統各一根直立填滿條（依 v/n）。選了單一系統時，其餘系統退淡，選中的那根照常。
    private func pills(_ f: CollectionFigures, _ k: RailScale) -> some View {
        HStack(alignment: .bottom, spacing: k.pt(5)) {
            ForEach(Array(f.systems.enumerated()), id: \.offset) { _, s in
                let dim = f.scopeKey != nil && f.scopeKey != s.k
                VStack(spacing: k.pt(4)) {
                    CollectionPill(id: "pill.\(s.k)", fraction: CollectionScope.fill(s.v, of: s.n),
                                   height: k.pt(46), dimmed: dim)
                    CollectionText(
                        id: "pill.\(s.k).label", text: s.label,
                        content: Text(s.label).font(.system(size: k.pt(s.label.count > 2 ? 9 : 10.5))),
                        minScale: 0.5, tone: s.v > 0 ? .secondary : .tertiary)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    /// 圖例一行。資料沒有「第一次收集日期」，所以不做「今年新增」，只解釋兩種深淺。
    private func legend(_ k: RailScale) -> some View {
        let solid = RailNativeL10n.text("實心＝搭過／到訪")
        let follow = RailNativeL10n.text("淡色＝跟完")
        return HStack(spacing: k.pt(4)) {
            CollectionLegendDot(faded: false, k: k)
            CollectionText(
                id: "legend.solid", text: solid,
                content: Text(solid).font(.system(size: k.pt(11))), minScale: 0.7, tone: .secondary)
            Color.clear.frame(width: k.pt(8), height: 1)
            CollectionLegendDot(faded: true, k: k)
            CollectionText(
                id: "legend.follow", text: follow,
                content: Text(follow).font(.system(size: k.pt(11))), minScale: 0.7, tone: .secondary)
            Spacer(minLength: 0)
        }
        .frame(height: k.pt(14))
    }
}

struct CollectionLegendDot: View {
    let faded: Bool
    let k: RailScale
    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        let base = mono ? AnyShapeStyle(HierarchicalShapeStyle.primary)
                        : AnyShapeStyle(RailTokens.colors(scheme).brand)
        Circle()
            .fill(base)
            .opacity(faded ? CollectionMetrics.followAlpha : 1)
            .frame(width: k.pt(8), height: k.pt(8))
            .widgetAccentable()
    }
}

// MARK: - 沒有資料（打開軌島一次）

struct CollectionUnavailableBody: View {
    let k: RailScale
    let big: Bool

    var body: some View {
        let name = RailNativeL10n.text("車站收集")
        VStack(alignment: .leading, spacing: k.pt(6)) {
            CollectionText(
                id: "title", text: name,
                content: Text(name).font(.system(size: k.pt(11))), tone: .secondary)
            CollectionText(
                id: "unavailable", text: CollectionCopy.unavailable,
                content: Text(CollectionCopy.unavailable)
                    .font(.system(size: k.pt(big ? 15 : 13), weight: .semibold)),
                lines: 5, minScale: 0.75)
        }
    }
}

// MARK: - 鎖屏

/// 鎖屏矩形（三行高，沒有內容邊距，家族本身就是單色）。
struct RectangularCollectionView: View {
    let content: CollectionContent

    var body: some View {
        Group {
            switch content {
            case .unavailable:
                VStack(alignment: .leading, spacing: 1) {
                    let name = RailNativeL10n.text("車站收集")
                    CollectionText(id: "title", text: name,
                                   content: Text(name).font(.system(size: 11, weight: .medium)), tone: .secondary)
                    CollectionText(id: "unavailable", text: CollectionCopy.unavailable,
                                   content: Text(CollectionCopy.unavailable).font(.system(size: 12, weight: .semibold)),
                                   lines: 3, minScale: 0.7)
                }
            case .data(let f):
                dataBody(f)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .coordinateSpace(name: CollectionSpace.card)
    }

    private func dataBody(_ f: CollectionFigures) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                let heading = CollectionCopy.heading(f)
                CollectionText(id: "title", text: heading,
                               content: Text(heading).font(.system(size: 11, weight: .medium)), minScale: 0.7, tone: .secondary)
                Spacer(minLength: 2)
                CollectionText(id: "pct", text: "\(f.percent)%",
                               content: Text("\(f.percent)%").font(.system(size: 11, weight: .semibold)).monospacedDigit(),
                               key: true)
            }
            .widgetAccentable()
            if f.isEmpty {
                CollectionText(id: "empty.title", text: CollectionCopy.emptyTitle,
                               content: Text(CollectionCopy.emptyTitle).font(.system(size: 13, weight: .semibold)),
                               minScale: 0.7)
                CollectionText(id: "empty.hint", text: CollectionCopy.emptyHint,
                               content: Text(CollectionCopy.emptyHint).font(.system(size: 11)),
                               lines: 2, minScale: 0.7, tone: .secondary)
            } else {
                CollectionText(id: "countOf", text: CollectionCopy.countOf(f),
                               content: Text(CollectionCopy.countOf(f)).font(.system(size: 13, weight: .semibold)),
                               key: true)
                CollectionBar(id: "bar", fraction: CollectionScope.fill(f.collected, of: f.total), height: 5)
                    .padding(.top, 2)
            }
        }
    }
}

/// 鎖屏圓形：Gauge 圓環，中間放百分比。
struct CircularCollectionView: View {
    let content: CollectionContent

    var body: some View {
        switch content {
        case .unavailable:
            Text("—").font(.system(size: 18, weight: .semibold)).widgetAccentable()
        case .data(let f):
            Gauge(value: Double(min(f.collected, max(f.total, 1))), in: 0...Double(max(f.total, 1))) {
                Text(RailNativeL10n.text("車站"))
            } currentValueLabel: {
                // 「100%」四個字元在圓環內側放不下預設字級，會被截成「10…」——滿分時字級再降一階。
                CollectionText(id: "pct", text: "\(f.percent)%",
                               content: Text("\(f.percent)%")
                                   .font(.system(size: f.percent >= 100 ? 11 : 15, weight: .semibold)),
                               minScale: 0.6)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
            .coordinateSpace(name: CollectionSpace.card)
        }
    }
}
