import SwiftUI
import WidgetKit

// 「車站收集」小工具的資料模型與四種版面（小、中、鎖屏矩形、鎖屏圓形；純 SwiftUI，刻意不碰 UIKit／AppIntents）。
// 2026-09-29 23:04 使用者：「路線收集我覺得只需要做小跟中的版面就好 不用大的」→ 大卡（systemLarge）整個拿掉。
//
// 為什麼獨立成一個檔：app/scripts/render_collect_widget.mjs 把這個檔【整檔逐字】連同
// RailWidgetKit.swift、RailNativeL10n.swift 一起交給 swiftc 編成 macOS 執行檔算圖，
// 不抽宣告——抽取有「抽到舊版」的風險，整檔納入則檔案哪天開始依賴別的檔，編譯當場失敗。
// Widget／Provider／EntryView（要 AppIntents 與 Color(uiColor:)）放在 CollectionWidget.swift。
//
// 架構：網頁算、原生只畫。數字只有一個來源——網頁 stationCollection(loadRides())，
// 也就是護照「車站 N 座」用的那個函式；網頁整包算好經外掛寫成 App Group 的 collection.json，
// 這裡【只讀不算】：n／total／各系統 v／n／recent／點位一律照抄，唯一自己算的是
// 「百分比字串」、「進度條填滿比例」與「單一系統的取景視窗」這三個純顯示量（由驗收腳本從 payload 獨立重算比對）。
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

/// 單一系統範圍的取景視窗：0..1000 正規化空間裡的【正方形】（規格第二輪第 3 點，三平台共同約定）。
/// 正方形視窗的道理：整島框 1000×1000 是照 aspect 畫進地圖框的，兩軸各放大 1000/size 倍，
/// 真實比例就不變形。全台範圍不用視窗（nil＝整島框 0..1000）。
struct CollectionViewport: Equatable {
    let x0: Double
    let y0: Double
    let size: Double

    /// 該系統所有點的外框，四邊各加 pad = max(0.12×max(寬,高), 10)；
    /// 邊長 S = max(寬+2pad, 高+2pad, 40)，以外框中心為中心；超出 0..1000 不夾回。沒有點回 nil。
    static func fitting(_ points: [CollectionDot]) -> CollectionViewport? {
        guard let first = points.first else { return nil }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for p in points {
            minX = min(minX, p.x); maxX = max(maxX, p.x)
            minY = min(minY, p.y); maxY = max(maxY, p.y)
        }
        let w = maxX - minX, h = maxY - minY
        let pad = max(0.12 * max(w, h), 10)
        let side = max(w + 2 * pad, h + 2 * pad, 40)
        return CollectionViewport(x0: (minX + maxX) / 2 - side / 2, y0: (minY + maxY) / 2 - side / 2, size: side)
    }

    func contains(_ d: CollectionDot) -> Bool {
        d.x >= x0 && d.x <= x0 + size && d.y >= y0 && d.y <= y0 + size
    }
}

struct CollectionFigures {
    /// nil＝全台
    let scopeKey: String?
    /// 全台，或該系統在 payload 裡的名稱（已是網頁當下的語言）。
    let title: String
    let collected: Int
    let total: Int
    /// 百分比的數字部分：「37」、邊界「<1」（有收集但四捨五入成 0）與「99」（還沒收滿但四捨五入成 100）。
    /// 不含「%」——大數字加小符號的版面自己接。
    let percentNumber: String
    let aspect: Double
    /// 這個範圍自己的點（全台＝全部；單一系統＝該系統的點）：三態照畫。
    let dots: [CollectionDot]
    /// 單一系統範圍：取景視窗（nil＝全台整島框）。
    let viewport: CollectionViewport?
    /// 單一系統範圍：視窗內【其他系統】的點，畫成更淡的中性灰墊底。全台範圍恆為空。
    let others: [CollectionDot]
    let systems: [CollectionSnapshot.System]
    /// 最近蓋章：payload 每系統各送最近 4 筆——全台＝取整體前 4 筆；單一系統＝只留 k 相符的前 4 筆。
    let recent: [CollectionSnapshot.Recent]
    /// 中卡的進度條：有收集的系統，依總站數大到小，最多 5 個。
    let topSystems: [CollectionSnapshot.System]
    /// 一站都還沒收集的系統數（「還有 K 個系統還沒去過」的 K）。
    let untouchedSystems: Int

    var isAll: Bool { scopeKey == nil }
    var isEmpty: Bool { collected == 0 }
    var remaining: Int { max(0, total - collected) }
    /// 顯示用的整段百分比字串（「37%」「<1%」「99%」）。
    var percentText: String { percentNumber + "%" }
}

enum CollectionScope {
    /// 設定選單裡「全台」的存值。nil（沒動過設定）與讀不懂的值都當全台。
    static let allKey = "all"

    /// 整數百分比，半數進位（與網頁 Math.round 一致）。整數運算，不經浮點。
    static func percent(_ v: Int, of total: Int) -> Int {
        guard total > 0, v > 0 else { return 0 }
        return min(100, (v * 200 + total) / (2 * total))
    }

    /// 百分比的數字部分（規格第二輪第 5 點）：p = v/total×100 四捨五入，兩個邊界例外——
    /// 有收集（v>0）卻四捨五入成 0 → 「<1」；還沒收滿（v<total）卻四捨五入成 100 → 「99」。
    /// 「0%」只留給真的一站都沒收，「100%」只留給真的收滿。
    static func percentNumber(_ v: Int, of total: Int) -> String {
        let p = percent(v, of: total)
        if v > 0 && p == 0 { return "<1" }
        if v < total && p >= 100 { return "99" }
        return "\(p)"
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
        func dot(_ p: CollectionSnapshot.Point) -> CollectionDot {
            CollectionDot(x: p.x, y: p.y, color: p.color, s: p.s)
        }

        if let index {
            let sys = snap.sys[index]
            let own = snap.pts.filter { $0.sys == index }.map(dot)
            let viewport = CollectionViewport.fitting(own)
            // 視窗內的其他系統點墊底；視窗外的不畫。該系統一個點都沒有（不該發生）就退回整島框，其他系統全畫。
            let others = snap.pts.filter { $0.sys != index }.map(dot).filter { viewport?.contains($0) ?? true }
            return CollectionFigures(
                scopeKey: sys.k, title: sys.label,
                collected: sys.v, total: sys.n, percentNumber: percentNumber(sys.v, of: sys.n),
                aspect: snap.aspect, dots: own, viewport: viewport, others: others,
                systems: snap.sys,
                recent: Array(snap.recent.filter { $0.k == sys.k }.prefix(4)),
                topSystems: ranked, untouchedSystems: untouched)
        }
        return CollectionFigures(
            scopeKey: nil, title: RailNativeL10n.text("全台"),
            collected: snap.n, total: snap.total, percentNumber: percentNumber(snap.n, of: snap.total),
            aspect: snap.aspect,
            dots: snap.pts.map(dot), viewport: nil, others: [],
            systems: snap.sys, recent: Array(snap.recent.prefix(4)),
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
/// 打開後，Canvas 每畫一個點就記一筆（量的是真的 fill／stroke 呼叫，不是事先算好的長度）：
/// 筆數之外，連每個點的圓心（Canvas 座標，pt）一起記下，驗收腳本拿去跟 payload 獨立算出的座標比。
struct CollectionProbeKey: EnvironmentKey { static let defaultValue: CollectionDrawProbe? = nil }

final class CollectionDrawProbe: @unchecked Sendable {
    /// 各層畫出的圓心：other＝視窗內其他系統的淡灰點、off＝未收集、follow＝跟完（空心圈）、solid＝搭過／到訪。
    var other: [CGPoint] = []
    var off: [CGPoint] = []
    var follow: [CGPoint] = []
    var solid: [CGPoint] = []
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
    /// 跟完（s=1）畫線色空心圈：圈外徑＝實心圓直徑，圈寬＝實心半徑的這個倍數（規格第二輪第 4 點）。
    static let hollowRingRatio: CGFloat = 0.45
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

// MARK: - 點陣地圖

enum CollectionPalette {
    /// 未收集的中性淡灰（軌道底色用同一組灰）。
    static func off(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(white: 0.24) : Color(white: 0.88)
    }

    /// 單一系統視窗裡「其他系統」的點：比 off 更淡一階（更靠近底色），只當位置參照，不搶主角。
    static func otherOff(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(white: 0.165) : Color(white: 0.925)
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
    /// nil＝整島框（全台）；單一系統＝取景視窗，視窗內容等比放大填滿地圖框。
    var viewport: CollectionViewport? = nil
    /// 視窗內其他系統的點（已由 figures 濾掉視窗外的），畫成更淡的中性灰墊在最底。
    var others: [CollectionDot] = []

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono
    @Environment(\.collectMapHidden) private var hidden
    @Environment(\.collectProbe) private var probe

    static func radius(forHeight h: CGFloat) -> CGFloat {
        max(CollectionMetrics.dotRadiusFloor, h * CollectionMetrics.dotRadiusRatio)
    }

    /// 點的畫面座標：0..1000（全台）或視窗內（單一系統）先正規化成 0..1，再留出已收集點的半徑當內距，
    /// 最邊上的點才不會被裁掉。全台與單一系統共用這一條公式，只差 u、v 的來源。
    static func center(_ dot: CollectionDot, in size: CGSize, viewport: CollectionViewport? = nil) -> CGPoint {
        let inset = radius(forHeight: size.height) * CollectionMetrics.solidScale
        let u: Double, v: Double
        if let vp = viewport {
            u = (dot.x - vp.x0) / vp.size
            v = (dot.y - vp.y0) / vp.size
        } else {
            u = dot.x / 1000
            v = dot.y / 1000
        }
        return CGPoint(x: inset + u * (size.width - 2 * inset),
                       y: inset + v * (size.height - 2 * inset))
    }

    var body: some View {
        let dots = self.dots, others = self.others, viewport = self.viewport
        let scheme = self.scheme, mono = self.mono
        let hidden = self.hidden, probe = self.probe
        // 🔴 未收集的點用【不透明】淡灰，不用 primary 加透明度：台北一帶幾十個點疊在一起，
        //    半透明會疊成一團黑（實測 small 空狀態），看起來像有東西被收集了。
        let off = CollectionPalette.off(scheme)
        let otherOff = CollectionPalette.otherOff(scheme)
        ZStack {
            // 底層：其他系統的淡灰點（單一系統視窗才有），再來是這個範圍未收集的中性灰。
            Canvas { ctx, size in
                probe?.other = []
                probe?.off = []
                guard !hidden else { return }
                let r = Self.radius(forHeight: size.height)
                for d in others {
                    let c = Self.center(d, in: size, viewport: viewport)
                    ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                             with: .color(otherOff))
                    probe?.other.append(c)
                }
                for d in dots where d.s == 0 {
                    let c = Self.center(d, in: size, viewport: viewport)
                    ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                             with: .color(off))
                    probe?.off.append(c)
                }
            }
            // 已收集（含跟完）：線色。單獨一層是為了讓「著色」模式只把這一層染成強調色。
            // 三態：s=2 實心圓；s=1 空心圈（外徑同實心、圈寬 0.45 倍半徑）。深淺色與著色都靠形狀分，不靠深淺。
            Canvas { ctx, size in
                probe?.follow = []
                probe?.solid = []
                guard !hidden else { return }
                let r = Self.radius(forHeight: size.height) * CollectionMetrics.solidScale
                let ring = r * CollectionMetrics.hollowRingRatio
                // 先畫空心的、再畫實心，實心疊在空心上面。
                for pass in [1, 2] {
                    for d in dots where d.s == pass {
                        let c = Self.center(d, in: size, viewport: viewport)
                        let paint = mono ? Color.primary : CollectionPalette.color(d.color, scheme: scheme)
                        if pass == 1 {
                            // 描邊置中在路徑上：路徑半徑 = 外徑 − 圈寬/2，外緣才會剛好落在 r。
                            let mid = r - ring / 2
                            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - mid, y: c.y - mid, width: 2 * mid, height: 2 * mid)),
                                       with: .color(paint), lineWidth: ring)
                            probe?.follow.append(c)
                        } else {
                            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                                     with: .color(paint))
                            probe?.solid.append(c)
                        }
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
    /// number 是 CollectionFigures.percentNumber（「37」「<1」「99」），不含「%」。
    static func bigPercent(_ number: String, big: CGFloat, small: CGFloat) -> Text {
        var digits = AttributedString(number)
        digits.font = .system(size: big, weight: .bold).monospacedDigit()
        var sign = AttributedString("%")
        sign.font = .system(size: small, weight: .semibold)
        sign.foregroundColor = .secondary
        return Text(digits + sign)
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
                CollectionMapView(dots: f.dots, viewport: f.viewport, others: f.others)
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
                    id: "pct", text: f.percentText,
                    content: CollectionCopy.bigPercent(f.percentNumber, big: k.pt(f.percentNumber.count >= 3 ? 28 : 34), small: k.pt(15)),
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
            CollectionMapView(dots: f.dots, viewport: f.viewport, others: f.others)
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
                    id: "pct", text: f.percentText,
                    content: Text(f.percentText).font(.system(size: k.pt(14), weight: .bold)).monospacedDigit(),
                    key: true)
            }
            CollectionText(
                id: "countOf", text: CollectionCopy.countOf(f),
                content: Text(CollectionCopy.countOf(f)).font(.system(size: k.pt(10.5))),
                key: true, tone: .secondary)
            Spacer(minLength: k.pt(3))
            middle(f, k)
            // 圖例：有收集的卡才有東西要解釋（空狀態沒有實心也沒有空心）。放不下時 e／h 兩道閘門會紅。
            if !f.isEmpty {
                Spacer(minLength: k.pt(3))
                CollectionLegend(k: k)
            }
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
                // 列距 1pt（原 2）：加了圖例那一行之後，全台中卡在 430 寬會多出 4pt 溢出，靠這裡與下面兩處各省一點。
                VStack(spacing: k.pt(1)) {
                    ForEach(Array(f.topSystems.enumerated()), id: \.offset) { _, s in
                        systemRow(s, k, labelWidth: labelWidth)
                    }
                }
                if f.untouchedSystems > 0 {
                    let note = RailNativeL10n.text("還有 {n} 個系統還沒去過", ["n": "\(f.untouchedSystems)"])
                    Color.clear.frame(height: k.pt(3))
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

// MARK: - 圖例（中卡）

/// 圖例一行：「實心＝搭過／到訪」「空心＝跟完」。資料沒有「第一次收集日期」，所以不做「今年新增」，
/// 只解釋兩種畫法。圖例的點用品牌色（著色模式跟著壓成單色），形狀與地圖上的三態畫法同一套：
/// 實心圓、外徑相同的空心圈（圈寬＝半徑的 0.45 倍）。
struct CollectionLegend: View {
    let k: RailScale

    var body: some View {
        let solid = RailNativeL10n.text("實心＝搭過／到訪")
        let follow = RailNativeL10n.text("空心＝跟完")
        HStack(spacing: k.pt(4)) {
            CollectionLegendDot(hollow: false, k: k)
            CollectionText(
                id: "legend.solid", text: solid,
                content: Text(solid).font(.system(size: k.pt(10))), minScale: 0.7, tone: .secondary)
            Color.clear.frame(width: k.pt(6), height: 1)
            CollectionLegendDot(hollow: true, k: k)
            CollectionText(
                id: "legend.follow", text: follow,
                content: Text(follow).font(.system(size: k.pt(10))), minScale: 0.7, tone: .secondary)
            Spacer(minLength: 0)
        }
        .frame(height: k.pt(12))
    }
}

struct CollectionLegendDot: View {
    let hollow: Bool
    let k: RailScale
    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        let base = mono ? AnyShapeStyle(HierarchicalShapeStyle.primary)
                        : AnyShapeStyle(RailTokens.colors(scheme).brand)
        let d = k.pt(8)
        Group {
            if hollow {
                // 圈寬 = 半徑 × 0.45 = 直徑 × 0.225，與地圖上的空心圈同比例。
                Circle().strokeBorder(base, lineWidth: d * CollectionMetrics.hollowRingRatio / 2)
            } else {
                Circle().fill(base)
            }
        }
        .frame(width: d, height: d)
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
                CollectionText(id: "pct", text: f.percentText,
                               content: Text(f.percentText).font(.system(size: 11, weight: .semibold)).monospacedDigit(),
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
            // 圓環照實際比例，有收集時至少畫 3%（與進度條同一個 fill 規則）。
            Gauge(value: CollectionScope.fill(f.collected, of: f.total), in: 0...1) {
                Text(RailNativeL10n.text("車站"))
            } currentValueLabel: {
                // 「100%」四個字元在圓環內側放不下預設字級，會被截成「10…」——四個字元時字級再降一階
                // （「<1%」「99%」都只有三個字元，照預設字級）。
                CollectionText(id: "pct", text: f.percentText,
                               content: Text(f.percentText)
                                   .font(.system(size: f.percentText.count >= 4 ? 11 : 15, weight: .semibold)),
                               minScale: 0.6)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
            .coordinateSpace(name: CollectionSpace.card)
        }
    }
}
