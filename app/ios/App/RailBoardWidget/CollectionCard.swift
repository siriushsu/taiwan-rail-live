import SwiftUI
import WidgetKit

// 「車站收集」小工具的資料模型與四種版面（小、中、鎖屏矩形、鎖屏圓形；純 SwiftUI，刻意不碰 UIKit／AppIntents）。
// 沒有大卡（systemLarge）。
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
// 契約（資料格式 v1）：docs/collect-widget-contract.md。

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
        /// 選用：這座站所屬的全部系統（轉乘站才有）。壞了（不是字串陣列）當沒有。
        let ks: [String]?
        let d: String

        private enum Keys: String, CodingKey { case name, line, k, ks, d }

        /// name／line／d 不是字串（含 null）就丟出——外層的 Lossy 會略過這一筆；k 缺或型別不對＝沒有歸屬（契約「畫法約定」10）。
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            name = try c.decode(String.self, forKey: .name)
            line = try c.decode(String.self, forKey: .line)
            d = try c.decode(String.self, forKey: .d)
            k = try? c.decodeIfPresent(String.self, forKey: .k)
            ks = try? c.decodeIfPresent([String].self, forKey: .ks)
        }
    }

    /// pts 的每個元素是 [x, y, "#色碼", s, sysIdx] 的異質陣列。
    /// x、y 為 0..1000（x 由西到東、y 由北到南）；s：0 未收集、1 跟完、2 搭過或到訪。
    struct Point: Decodable {
        let x: Double
        let y: Double
        let color: String
        let s: Int
        let sys: Int

        /// 先解成「永不 throw」的純量陣列再解讀（契約「畫法約定」10）：UnkeyedDecodingContainer.decode 失敗時游標不會前進，
        /// 在迴圈裡 try? 重試會卡在同一個元素。不是至少 4 個元素的陣列、x／y 不是數字、s 不是 0／1／2 → 丟出（外層 Lossy 略過這一點）；
        /// color 不是字串（含 null）→ 空字串，畫的時候解不出色碼就用品牌色；sysIdx 缺或不是整數 → -1（不屬於任何系統）。
        init(from decoder: Decoder) throws {
            let items = try decoder.singleValueContainer().decode([Scalar].self)
            guard items.count >= 4, case .number(let px) = items[0], case .number(let py) = items[1],
                  case .number(let ps) = items[3], ps == 0 || ps == 1 || ps == 2
            else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "pts 元素不合格")) }
            x = px; y = py; s = Int(ps)
            if case .string(let text) = items[2] { color = text } else { color = "" }
            if items.count > 4, case .number(let i) = items[4], i == i.rounded(), abs(i) < 1e9 { sys = Int(i) } else { sys = -1 }
        }
    }

    /// pts 元素的一格：數字、字串；其他（null、布林、巢狀）都是 other。init 永不 throw。
    private enum Scalar: Decodable {
        case number(Double), string(String), other
        init(from decoder: Decoder) {
            let c = try? decoder.singleValueContainer()
            if let d = try? c?.decode(Double.self) { self = .number(d) }
            else if let t = try? c?.decode(String.self) { self = .string(t) }
            else { self = .other }
        }
    }

    /// 陣列元素壞了不拖垮整包：解不出來就是 nil，外層濾掉。init 永不 throw，游標照常前進。
    private struct Lossy<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) { value = try? T(from: decoder) }
    }

    let v: Int
    let aspect: Double
    let n: Int
    let total: Int
    let sys: [System]
    let recent: [Recent]
    let pts: [Point]

    private enum CodingKeys: String, CodingKey { case v, aspect, n, total, sys, recent, pts }

    /// 結構欄位（v、aspect、n、total、sys、recent、pts）缺或型別不對、sys 任一筆壞了＝丟出（整包作廢，走「打開軌島一次」）；
    /// recent 與 pts 的元素壞了只略過那一個（契約「畫法約定」10）。
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = try c.decode(Int.self, forKey: .v)
        aspect = try c.decode(Double.self, forKey: .aspect)
        n = try c.decode(Int.self, forKey: .n)
        total = try c.decode(Int.self, forKey: .total)
        sys = try c.decode([System].self, forKey: .sys)
        recent = try c.decode([Lossy<Recent>].self, forKey: .recent).compactMap(\.value)
        pts = try c.decode([Lossy<Point>].self, forKey: .pts).compactMap(\.value)
    }
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
                recent: Array(snap.recent.filter { $0.k == sys.k || ($0.ks?.contains(sys.k) ?? false) }.prefix(4)),
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

// MARK: - 設定畫面「範圍」選單的名稱

/// 「範圍」選單：全台＋十個系統的簡稱，三語與網頁 COLLECT_SYS（index.html）同一組，開 App 前後看到的名稱一樣。
/// 有 collection.json 時系統名稱照抄 payload 的 label（網頁當下的語言）；沒有檔案（App 沒開過）用這裡的退回清單。
/// 「全台」沒有 payload，一律走這裡。
/// 語言：App 存的語言優先（網頁 setLanguage 經 RailLanguagePlugin 寫進 App Group 的 rail.language），
/// 沒存才看系統語言，都認不得就繁中。
/// 繁中簡稱由這裡給；英日文查目錄，key 是「範圍・」加繁中簡稱。加前綴是因為網站字典已有「台鐵／高鐵／北捷」，
/// 譯的是全名（High Speed Rail、台湾鉄路…），其他小工具在用，不能被簡稱覆寫。
enum CollectionScopeName {
    /// collection.json v1 的系統代碼與繁中簡稱，順序固定（契約）。
    static let systems: [(k: String, zh: String)] = [
        ("tra", "台鐵"), ("thsr", "高鐵"), ("trtc", "北捷"), ("tymc", "機捷"), ("tmrt", "中捷"),
        ("krtc", "高捷"), ("ntdlrt", "淡海"), ("ntalrt", "安坑"), ("sanying", "三鶯"), ("afr", "林鐵"),
    ]
    static let allTaiwan = "全台"
    static let catalogPrefix = "範圍・"

    /// 存的語言（en／ja／zh-TW）優先；沒存才取系統語言偏好裡第一個認得的；其餘繁中。
    /// 系統語言的對應與網頁 I18N_LANG 同一套（zh-* 一律繁中，App 只有繁中），App 第一次開啟網頁選出來的語言跟這裡一致。
    static func resolveLanguage(stored: String?, preferred: [String]) -> String {
        if let stored, ["zh-TW", "en", "ja"].contains(stored) { return stored }
        for tag in preferred {
            let v = tag.lowercased()
            if v == "zh-tw" || v == "zh-hant" || v.hasPrefix("zh-") { return "zh-TW" }
            if v == "ja" || v.hasPrefix("ja-") { return "ja" }
            if v == "en" || v.hasPrefix("en-") { return "en" }
        }
        return "zh-TW"
    }

    /// 設定畫面現在該用的語言。
    static func currentLanguage(suite: UserDefaults? = UserDefaults(suiteName: "group.tw.railisland.app"),
                                preferred: [String] = Locale.preferredLanguages) -> String {
        resolveLanguage(stored: suite?.string(forKey: "rail.language"), preferred: preferred)
    }

    /// 簡稱在該語言的寫法；目錄查不到就退回繁中簡稱（與 RailNativeL10n 的繁中 fallback 一致），不會露出帶前綴的 key。
    static func name(_ zh: String, language: String) -> String {
        guard language != "zh-TW",
              let path = Bundle.main.path(forResource: language, ofType: "lproj"),
              let bundle = Bundle(path: path) else { return zh }
        let key = catalogPrefix + zh
        let value = bundle.localizedString(forKey: key, value: key, table: nil)
        return value == key ? zh : value
    }

    /// 選單項目（存值、名稱）：全台在最前面；有 payload 的系統名稱照抄，沒有才用退回清單。
    static func menu(payload: [(k: String, label: String)]?, language: String) -> [(k: String, title: String)] {
        var items: [(k: String, title: String)] = [(CollectionScope.allKey, name(allTaiwan, language: language))]
        if let payload, !payload.isEmpty {
            items += payload.map { (k: $0.k, title: $0.label) }
        } else {
            items += systems.map { (k: $0.k, title: name($0.zh, language: language)) }
        }
        return items
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
/// 打開後，只關掉台灣輪廓（點照畫）：驗收腳本拿「有輪廓」與「關掉輪廓」兩張逐像素比，才量得到輪廓有沒有
/// 侵入文字、進度條與蓋章鈕；量點的位置也用關掉輪廓的那張——輪廓的填色與海岸線本身就是離底色很遠的墨跡，
/// 留著會讓「沒畫出來的點」被輪廓的墨跡蓋過去。
struct CollectionOutlineHiddenKey: EnvironmentKey { static let defaultValue = false }

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
    var collectOutlineHidden: Bool {
        get { self[CollectionOutlineHiddenKey.self] }
        set { self[CollectionOutlineHiddenKey.self] = newValue }
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
    /// 蓋章鈕的字級與高度（參考尺寸下的 pt，實際乘 RailScale）。高度固定、不隨字型行高走：
    /// 中卡要替鈕讓出地圖的高度，行高會因語言而異，量到多高就預留多高的做法會在別的語言留縫或溢出。
    /// 31＝15pt 粗體字的行高約 19pt，上下各留 6pt。
    static let stampFontSize: CGFloat = 15
    static let stampHeight: CGFloat = 31

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
    /// 非關鍵文字也回報理想寬度（標題列的名稱：harness 要知道「不受限時它要多寬」，才判得出縮了多少、放不放得下）。
    var reportIdeal = false

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
                    if (key || reportIdeal) && lines == 1 {
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
        center(x: dot.x, y: dot.y, in: size, viewport: viewport)
    }

    /// 同一條公式的 (x, y) 版本：點（CollectionDot）與台灣輪廓（CollectionOutlineLayer）都走這裡，
    /// 兩者的座標轉換因此在結構上就是同一份，輪廓不會跟點錯位。
    static func center(x: Double, y: Double, in size: CGSize, viewport: CollectionViewport? = nil) -> CGPoint {
        let inset = radius(forHeight: size.height) * CollectionMetrics.solidScale
        let u: Double, v: Double
        if let vp = viewport {
            u = (x - vp.x0) / vp.size
            v = (y - vp.y0) / vp.size
        } else {
            u = x / 1000
            v = y / 1000
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
            // 最底層：台灣輪廓。座標公式與點相同；不加 widgetAccentable（著色模式下它只是淡淡的墊圖）。
            CollectionOutlineLayer(viewport: viewport, hidden: hidden)
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

// MARK: - 台灣輪廓（點陣地圖最底層的墊圖）

// 卡片背景一層淡淡的台灣輪廓：全台範圍畫淡色陸地填色，單一系統範圍改畫細海岸線並把四邊淡出——
// 單一系統放大到某個區域時，填色的邊緣會變成一塊柔邊方框，還會蓋掉其他系統的淡灰點。
// 資料是 CollectionOutlineData.polygons（build_collect_outline.mjs 產生，iOS、Android 共用同一份多邊形）。

enum CollectionOutlineMetrics {
    /// 全台範圍：畫布往四邊各多開「地圖高 × 這個比例」，恆春半島南端（超出點陣框約 10%）與嘉南西岸才不會被切平。
    /// 只是畫得出去；版面大小不變，也不接收點擊。
    static let overflowRatio: CGFloat = 0.12
    /// 單一系統範圍：輪廓只畫在地圖框內，四邊各淡出「地圖寬 × 這個比例」，不留硬邊方框。
    static let fadeRatio: CGFloat = 0.16
    /// 單一系統範圍的海岸線寬（pt）。
    static let lineWidth: CGFloat = 0.75
}

enum CollectionOutlinePalette {
    /// 全台的陸地填色：介於卡底（淺 0.98／深 0.09）與未收集灰點（淺 0.88／深 0.24）之間、靠近卡底，
    /// 灰點放在填色上的對比仍有放在卡底上的九成以上。
    /// 著色模式（mono）：系統會把顏色壓成單一色調，改用 primary 加低透明度，畫出來仍是淡淡的一層。
    static func fill(_ scheme: ColorScheme, mono: Bool) -> Color {
        if mono { return Color.primary.opacity(0.05) }
        return scheme == .dark ? Color(white: 0.125) : Color(white: 0.945)
    }

    /// 單一系統的海岸線：比未收集灰點再淡一點（點是主角，線只是輪廓）。
    static func line(_ scheme: ColorScheme, mono: Bool) -> Color {
        if mono { return Color.primary.opacity(0.10) }
        return scheme == .dark ? Color(white: 0.19) : Color(white: 0.905)
    }
}

struct CollectionOutlineLayer: View {
    /// nil＝整島框（全台，畫填色）；非 nil＝單一系統的取景視窗（畫細線、四邊淡出）。
    /// 與 CollectionMapView 傳給點的是同一個視窗。
    var viewport: CollectionViewport?
    /// 地圖整個藏起來（驗收用）時輪廓也一起藏。
    var hidden: Bool

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono
    @Environment(\.collectOutlineHidden) private var outlineHidden

    var body: some View {
        GeometryReader { geo in
            let mapSize = geo.size
            let margin = viewport == nil ? mapSize.height * CollectionOutlineMetrics.overflowRatio : 0
            let scheme = self.scheme, mono = self.mono, viewport = self.viewport
            let skip = hidden || outlineHidden
            faded(
                Canvas { ctx, _ in
                    guard !skip else { return }
                    // 畫布比地圖框大一圈（全台）：把座標系平移回地圖框的左上角，轉換公式才與點完全一致。
                    ctx.translateBy(x: margin, y: margin)
                    let path = Self.path(in: mapSize, viewport: viewport)
                    if viewport == nil {
                        ctx.fill(path, with: .color(CollectionOutlinePalette.fill(scheme, mono: mono)))
                    } else {
                        ctx.stroke(path, with: .color(CollectionOutlinePalette.line(scheme, mono: mono)),
                                   style: StrokeStyle(lineWidth: CollectionOutlineMetrics.lineWidth,
                                                      lineCap: .round, lineJoin: .round))
                    }
                }
                .frame(width: mapSize.width + 2 * margin, height: mapSize.height + 2 * margin)
                .offset(x: -margin, y: -margin),
                in: mapSize)
        }
        .allowsHitTesting(false)
    }

    /// 單一系統範圍才淡出：橫向、縱向各一道漸層遮罩，四邊都柔和收掉；全台範圍原樣。
    @ViewBuilder
    private func faded<Content: View>(_ content: Content, in size: CGSize) -> some View {
        if viewport == nil {
            content
        } else {
            let d = size.width * CollectionOutlineMetrics.fadeRatio
            content
                .mask(Self.ramp(d / max(size.width, 1), .leading, .trailing))
                .mask(Self.ramp(d / max(size.height, 1), .top, .bottom))
        }
    }

    private static func ramp(_ f: CGFloat, _ from: UnitPoint, _ to: UnitPoint) -> LinearGradient {
        LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: f),
                               .init(color: .black, location: 1 - f), .init(color: .clear, location: 1)],
                       startPoint: from, endPoint: to)
    }

    /// 所有多邊形串成一條路徑，每個頂點都走 CollectionMapView.center（與點同一條公式）。
    static func path(in size: CGSize, viewport: CollectionViewport?) -> Path {
        var path = Path()
        for poly in CollectionOutlineData.polygons {
            var i = 0
            while i + 1 < poly.count {
                let p = CollectionMapView.center(x: poly[i], y: poly[i + 1], in: size, viewport: viewport)
                if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
                i += 2
            }
            path.closeSubpath()
        }
        return path
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

struct SmallCollectionView<Stamp: View>: View {
    let content: CollectionContent
    /// 蓋章鈕要怎麼「被點」由外殼決定：小卡只有 widgetURL 一個點擊範圍（Link 在小卡不生效），
    /// 要讓鈕與其餘地方各走各的，只能包 iOS 17 的 Button(intent:)，而 AppIntents 不能進這個檔。
    /// 算繪 harness 傳 { $0 }（只畫外觀），Widget 傳包了 Button(intent:) 的版本。
    let stamp: (CollectionStampChip) -> Stamp

    @Environment(\.collectMeasure) private var measure

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
        // 文字欄右緣到地圖左緣的空隙（兩欄之間沒有別的東西）：蓋章鈕可點範圍往右最多補這麼多，再多就壓到地圖的框。
        let gutter = max(0, size.width - textW - mapW)

        VStack(alignment: .leading, spacing: gap) {
            header(f, k)
            ZStack(alignment: .bottomTrailing) {
                textColumn(f, k, hitTrailing: min(4, gutter))
                    .frame(width: textW, alignment: .leading)
                    // 量測用：蓋章鈕所在那一欄（文字欄）自己的框，harness 判「鈕寬＝欄寬」要用；id 帶 # 的框不參與文字／進度條的相交判準。
                    .collectReport("column#stamp")
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                CollectionMapView(dots: f.dots, viewport: f.viewport, others: f.others)
                    .frame(width: mapW, height: mapH)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// 標題列（契約畫法約定 8）：範圍名＋「車站收集」，同一行放得下（理想寬度放得下，不靠縮字硬塞）就都放；
    /// 放不下只留一個：全台省略「全台」、只留「車站收集」；單一系統省略「車站收集」、只留系統名。
    /// 只剩的那一個用標題字級、靠左；它仍放不下才縮字（下限 75%）再截斷，不再省略。
    private func header(_ f: CollectionFigures, _ k: RailScale) -> some View {
        let name = RailNativeL10n.text("車站收集")
        let scopeFont = Font.system(size: k.pt(13), weight: .semibold)
        let appFont = Font.system(size: k.pt(11))
        let scope = CollectionText(
            id: "title", text: f.title, content: Text(f.title).font(scopeFont), minScale: 0.75, reportIdeal: true)
        let app = CollectionText(
            id: "subtitle", text: name, content: Text(name).font(appFont), tone: .secondary, reportIdeal: true)
        // 只剩一個時：全台留「車站收集」（id 仍叫 subtitle，harness 由 id 認出哪個名稱活下來），單一系統留系統名。
        let soleApp = CollectionText(
            id: "subtitle", text: name, content: Text(name).font(scopeFont), minScale: 0.75, reportIdeal: true)
        return ViewThatFits(in: .horizontal) {
            Self.bothNames(k, scope, app)
            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .topLeading) {
            // 量測用：兩個名稱並排要的寬（與上面第一個候選同一個版面函式），不論最後畫了哪個都回報，
            // harness 才判得出「放得下 ⟺ 兩個都在」。
            if measure {
                Self.bothNames(
                    k,
                    Text(f.title).font(scopeFont).background(CollectionReporter(id: "header.scope#ideal")),
                    Text(name).font(appFont).background(CollectionReporter(id: "header.app#ideal")))
                    .fixedSize().hidden()
                    .background(CollectionReporter(id: "header#ideal"))
            }
        }
        .frame(height: k.pt(16))
    }

    /// 兩個名稱並排的一行：範圍名靠左、「車站收集」靠右，中間至少留一點空。兩個都用理想寬度（fixedSize）。
    private static func bothNames<A: View, B: View>(_ k: RailScale, _ a: A, _ b: B) -> some View {
        HStack(spacing: k.pt(4)) {
            a.fixedSize()
            Spacer(minLength: 2)
            b.fixedSize()
        }
    }

    /// 文字欄：數字（或空狀態說明）在上，蓋章鈕在最下面，寬度撐滿整個文字欄（契約畫法約定 11）。
    /// 整欄靠左下，地圖在右下，鈕只佔文字欄的寬，不會碰到地圖。
    /// `hitTrailing`：可點範圍往右補多少，由呼叫端依兩欄之間的空隙決定。
    private func textColumn(_ f: CollectionFigures, _ k: RailScale, hitTrailing: CGFloat) -> some View {
        let gap = k.pt(6)
        // 可點範圍：上緣只能到文字欄的間距——再高就壓到「還有 N 座」那一行的框；
        // 下緣延伸到卡片下緣（內距 16pt，下面沒有任何東西）；左邊補 4pt（左邊是卡片邊，沒有鄰居）；右邊見 hitTrailing。
        // 高度＝鈕高＋間距＋內距，430pt 機型 53pt（31＋6＋16），遠超過 44pt。
        let chip = CollectionStampChip(k: k, hit: EdgeInsets(top: gap, leading: 4, bottom: CollectionMetrics.inset, trailing: hitTrailing))
        return VStack(alignment: .leading, spacing: gap) {
            numbers(f, k)
            stamp(chip).padding(chip.hitCompensation)
        }
    }

    @ViewBuilder
    private func numbers(_ f: CollectionFigures, _ k: RailScale) -> some View {
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

struct MediumCollectionView<Stamp: View>: View {
    let content: CollectionContent
    /// 蓋章鈕的點擊包裝，由外殼傳入：Widget 傳 Link(railisland://checkin)，算繪 harness 傳 { $0 }。
    /// 不直接寫在這個檔裡是因為 ImageRenderer 畫不出 Link（會換成黃底的禁止符號），harness 就量不到鈕。
    let stamp: (CollectionStampChip) -> Stamp

    @Environment(\.collectMeasure) private var measure

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
        // 左欄（地圖＋蓋章鈕）的寬沿用原本地圖保留的寬：右邊文字欄的位置與寬度都不動。
        let leftW = (size.height * CollectionMetrics.mapReserveRatio).rounded()
        // 地圖貼左欄上緣、鈕貼左欄下緣（契約畫法約定 11），鈕高固定，所以地圖高＝整欄高減鈕高再減間距。
        // 間距至少 10pt：全台輪廓的恆春半島會畫到地圖框下緣之外約 6%（地圖高 97pt 時約 6pt），
        // 間距 8pt 時 393pt 機型的輪廓會碰到鈕。
        let barGap = k.pt(10)
        let barH = k.pt(CollectionMetrics.stampHeight)
        let mapH = size.height - barH - barGap
        let mapW = (mapH * f.aspect).rounded()
        let colW = (size.width - leftW - gap).rounded()
        // 可點範圍：上緣到地圖框的下緣（＝barGap）；下緣延伸到卡片下緣（內距 16pt，下面沒有任何東西）；
        // 左右各補 4pt（左邊是卡片邊，右邊離文字欄還有 gap）。高度＝鈕高＋間距＋內距，430pt 機型 57pt（31＋10＋16）。
        let chip = CollectionStampChip(k: k, hit: EdgeInsets(top: barGap, leading: 4, bottom: CollectionMetrics.inset, trailing: 4))

        ZStack(alignment: .topLeading) {
            column(f, k)
                .frame(width: colW, alignment: .topLeading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            VStack(spacing: 0) {
                CollectionMapView(dots: f.dots, viewport: f.viewport, others: f.others)
                    .frame(width: mapW, height: mapH)
                Spacer(minLength: barGap)
                stamp(chip).padding(chip.hitCompensation)
            }
            .frame(width: leftW, height: size.height)
            // 量測用：蓋章鈕所在那一欄（地圖欄）自己的框，用途同小卡。
            .collectReport("column#stamp")
        }
    }

    /// 單一系統範圍的最近蓋章「放得下幾筆就畫幾筆」（契約畫法約定 9，上限 4）：整欄各備 4、3、2、1、0 筆的版本，
    /// 由 ViewThatFits 取第一個高度放得下的（不手算高度）。選整欄而不只選那幾列：欄裡的 Spacer 是彈性的，
    /// 只讓幾列自己去搶剩餘高度，會與 Spacer 平分，永遠少畫。全台範圍與空狀態沒有最近蓋章，不必選。
    @ViewBuilder
    private func column(_ f: CollectionFigures, _ k: RailScale) -> some View {
        if f.isAll || f.isEmpty {
            columnBody(f, k, recentRows: 0)
        } else {
            ViewThatFits(in: .vertical) {
                columnBody(f, k, recentRows: 4)
                columnBody(f, k, recentRows: 3)
                columnBody(f, k, recentRows: 2)
                columnBody(f, k, recentRows: 1)
                columnBody(f, k, recentRows: 0)
            }
        }
    }

    /// 標題列（契約畫法約定 8）：全台只有「車站收集」；單一系統是「系統 · 車站收集」，同一行放得下
    /// （理想寬度加上百分比放得進欄寬，不靠縮字硬塞）就整段放，放不下先省略「 · 車站收集」、只留系統名，
    /// 只剩一個名稱仍放不下才縮字（下限 75%）再截斷，不再省略。
    private func titleRow(_ f: CollectionFigures, _ k: RailScale) -> some View {
        let font = Font.system(size: k.pt(14), weight: .bold)
        let whole = CollectionCopy.heading(f)
        let pctContent = Text(f.percentText).font(font).monospacedDigit()
        let pct = CollectionText(id: "pct", text: f.percentText, content: pctContent, key: true)
        let wholeTitle = CollectionText(
            id: "title", text: whole, content: Text(whole).font(font), minScale: 0.75, reportIdeal: true)
        let scopeTitle = CollectionText(
            id: "title", text: f.title, content: Text(f.title).font(font), minScale: 0.75, reportIdeal: true)
        return Group {
            if f.isAll {
                Self.headRow(k, title: wholeTitle, pct: pct)
            } else {
                ViewThatFits(in: .horizontal) {
                    Self.headRow(k, title: wholeTitle.fixedSize(), pct: pct)
                    Self.headRow(k, title: scopeTitle, pct: pct)
                }
            }
        }
        .overlay(alignment: .topLeading) {
            // 量測用：整段標題加百分比並排要的寬（與單一系統第一個候選同一個版面函式），不論最後畫了哪個都回報，
            // harness 才判得出「放得下 ⟺ 整段都在」；兩個零件的理想寬另報，用來推兩者之間最少要留多寬。
            if measure {
                Self.headRow(
                    k,
                    title: Text(whole).font(font).fixedSize().background(CollectionReporter(id: "header.title#ideal")),
                    pct: pctContent.background(CollectionReporter(id: "header.pct#ideal")))
                    .fixedSize().hidden()
                    .background(CollectionReporter(id: "header#ideal"))
            }
        }
    }

    /// 標題列的一行：標題靠左、百分比靠右，中間的空白是彈性的。
    private static func headRow<T: View, P: View>(_ k: RailScale, title: T, pct: P) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: k.pt(6)) {
            title
            Spacer(minLength: 0)
            pct
        }
    }

    private func columnBody(_ f: CollectionFigures, _ k: RailScale, recentRows: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            titleRow(f, k)
            // 蓋章鈕在左欄（地圖下面，見 dataBody），這一欄只有文字；「已收集 N／M 座」這一列回到只有一行字高。
            CollectionText(
                id: "countOf", text: CollectionCopy.countOf(f),
                content: Text(CollectionCopy.countOf(f)).font(.system(size: k.pt(10.5))),
                key: true, tone: .secondary)
            // 這一行與圖例上面的間距都是 2pt：沿用加蓋章鈕那一版縮的值（鈕還在這一列的時候），鈕搬走後沒有放回去。
            Spacer(minLength: k.pt(2))
            middle(f, k, recentRows: recentRows)
            // 圖例：有收集的卡才有東西要解釋（空狀態沒有實心也沒有空心）。放不下時 e／h 兩道閘門會紅。
            if !f.isEmpty {
                Spacer(minLength: k.pt(2))
                CollectionLegend(k: k)
            }
        }
    }

    @ViewBuilder
    private func middle(_ f: CollectionFigures, _ k: RailScale, recentRows: Int) -> some View {
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
                ForEach(Array(f.recent.prefix(recentRows).enumerated()), id: \.offset) { i, r in
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

// MARK: - 蓋章鈕（小卡、中卡）

enum CollectionStamp {
    /// 中卡的蓋章鈕點下去開這條深連結（CollectionWidget.swift 把它包成 Link）；小卡沒有 Link 可用，
    /// 改走 Button(intent: CollectCheckinIntent())。兩條路在原生殼（RailMetroWaitPlugin）匯到同一個
    /// waitOpen { view: "checkin" }。鈕以外的地方仍是最外層的 widgetURL（旅程護照）。
    static let checkinURL = URL(string: "railisland://checkin")!
}

/// 蓋章鈕的外觀（純 SwiftUI，不含點擊行為）：整條的膠囊，一行字置中。寬撐滿呼叫端給的寬（小卡是文字欄、
/// 中卡是地圖欄），高固定（CollectionMetrics.stampHeight）。點擊由外殼包上去——小卡包 Button(intent:)
///（AppIntents 不能進這個檔），中卡包 Link。字色一律用明確的 Color（品牌藍；著色模式用 primary），
/// 不吃環境的階層色，免得被 Link／Button 的預設 tint 染成別的顏色。膠囊底加描邊，著色模式底色被系統壓平時仍看得見。
struct CollectionStampChip: View {
    let k: RailScale
    /// 可點範圍往外擴的量（pt，四邊）。外觀（膠囊）不變，只有包在外面的 Button／Link 的 label 框變大——
    /// 系統的點擊範圍就是 label 的框，加上這裡的 contentShape。各邊能擴多少由呼叫端依鄰居決定
    /// （不准蓋到數字、標題、進度條的框），預設不外擴。
    var hit = EdgeInsets()

    /// 抵銷 hit 的負內距：呼叫端套在「已包好 Button／Link」的外面，鈕在版面上佔的位置與大小就跟沒外擴一樣，
    /// 旁邊的元素不會被推開；外擴的部分只是伸出去的可點範圍。
    var hitCompensation: EdgeInsets {
        EdgeInsets(top: -hit.top, leading: -hit.leading, bottom: -hit.bottom, trailing: -hit.trailing)
    }

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        let label = RailNativeL10n.text("蓋章")
        let brand = RailTokens.colors(scheme).brand
        let ink: Color = mono ? .primary : brand
        CollectionText(
            id: "stamp", text: label,
            content: Text(label).font(.system(size: k.pt(CollectionMetrics.stampFontSize), weight: .semibold)),
            key: true)
            .foregroundStyle(ink)
            // 左右各留 8pt：膠囊兩端是半圓，字的上下緣只會被削進去約 3pt，不必留多。日文「スタンプ」在 393pt 機型的小卡要 53pt，
            // 鈕寬 73pt：留 8pt 剩 58pt 放得下，留 12pt 只剩約 51pt 放不下（突變 M65，d 閘門的日文版會紅）。
            .padding(.horizontal, k.pt(8))
            .frame(maxWidth: .infinity)
            .frame(height: k.pt(CollectionMetrics.stampHeight))
            .background(Capsule().fill(ink.opacity(mono ? 0.16 : 0.14)))
            .overlay(Capsule().strokeBorder(ink.opacity(0.55), lineWidth: 0.8))
            .collectReport("stamp.chip")
            .widgetAccentable()
            .padding(hit)
            .contentShape(Rectangle())
            .collectReport("stamp.hit")
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
