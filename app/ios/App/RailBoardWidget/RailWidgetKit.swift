import SwiftUI
import WidgetKit

// 軌島小工具與 Live Activity 的共用元件層（設計稿：Claude Design「軌島 iOS Widget 與 Live Activity」）
//
// 為什麼要有這一層：改版前狀態色（進站綠／誤點紅／末班橘／擁擠度四級）散在
// RailBoardWidget.swift／MetroBoardWidget.swift／MixedBoardWidget.swift／RailFollowActivity.swift／
// MetroWaitActivity.swift 五個檔案各寫一份 RGB，沒有共用常數 ⇒ 改一個色要記得改五處，
// 漏一處的症狀是「同一個 App 裡兩張卡的進站綠不一樣」，而且沒有任何測試會紅。
//
// 🔴 這一層【只放狀態色】。路線色與車種色一律【不進來】——它們是資料驅動的：
//    捷運線色來自 bundle 內 MetroWidgetData.json（MetroWidgetCatalog），
//    台鐵／高鐵車種色來自 App 寫出的 meta.json.types（BoardSnapshot.typeColors）。
//    把官方公告值抄成 Swift 常數＝官方改色時畫面默默錯掉，且違反「官方的值照抄不自己判斷」。
//    設計稿列出的那些 hex 是給設計師對稿用的，不是實作的來源。
//
// 設計稿的四條規則，這一層負責讓它們「難以違反」而不只是「建議」：
//  1. 一個主角——RailCountdown 的 .hero 尺寸只給主角列用，次列走 .row，兩者字級差一倍以上
//  2. 分鐘優先——RailCountdown 不提供 m:ss 形態，想畫碼表格式在這裡就找不到 API
//  3. 顏色不獨立表意——RailLineMark 一定同時畫點與線名；單色模式自動退成純文字
//  4. 軌脊代替分隔線——RailSpineCell 是每一列的固定寬子元素，列高改變不會脫位

// MARK: - 色票（狀態色三層，互不借用）

/// 狀態色。設計稿「色彩：三層用途，互不借用」的第一層。
/// 淺／深各一組，用 `\.colorScheme` 解析——刻意不用 UIColor 的 dynamic provider，
/// 因為版面驗收腳本（app/scripts/render_*.mjs）把 View 編成 macOS 裸執行檔算繪，那邊沒有 UIKit。
struct RailStateColors {
    /// 準點、可用、擁擠度低、進站
    let ok: Color
    /// 誤點、擁擠度中
    let warn: Color
    /// 停駛、擁擠度高
    let bad: Color
    /// 末班車、資料過期
    let dusk: Color
    /// 軌島藏青（品牌低調層）——只用在軌脊、進度線與 LA 的按鈕
    let brand: Color
}

enum RailTokens {
    static let light = RailStateColors(
        ok:    Color(.sRGB, red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255),
        warn:  Color(.sRGB, red: 0xFF / 255, green: 0x95 / 255, blue: 0x00 / 255),
        bad:   Color(.sRGB, red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255),
        dusk:  Color(.sRGB, red: 0xD2 / 255, green: 0xA1 / 255, blue: 0x2A / 255),
        brand: Color(.sRGB, red: 0x2A / 255, green: 0x4A / 255, blue: 0x73 / 255))

    static let dark = RailStateColors(
        ok:    Color(.sRGB, red: 0x30 / 255, green: 0xD1 / 255, blue: 0x58 / 255),
        warn:  Color(.sRGB, red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255),
        bad:   Color(.sRGB, red: 0xFF / 255, green: 0x45 / 255, blue: 0x3A / 255),
        dusk:  Color(.sRGB, red: 0xE8 / 255, green: 0xB8 / 255, blue: 0x4B / 255),
        brand: Color(.sRGB, red: 0x7F / 255, green: 0xA6 / 255, blue: 0xE0 / 255))

    static func colors(_ scheme: ColorScheme) -> RailStateColors {
        scheme == .dark ? dark : light
    }

    /// 官方擁擠度等級 → 狀態色。數值語意由官方定義，我們只上色不重新分級。
    /// 🔴 設計稿規則 3：這個顏色【永遠】要伴隨一個詞（RailCarriageMeter 的 label），
    ///    因為 tinted／單色模式下顏色會被系統吃掉。
    static func crowd(_ v: Int, _ scheme: ColorScheme) -> Color {
        let c = colors(scheme)
        switch v {
        case ...1: return c.ok
        case 2:    return c.warn
        case 3:    return c.warn.opacity(0.85)
        default:   return c.bad
        }
    }

    /// 整列擁擠度的一個詞。
    ///
    /// 🔴 用【四捨五入的平均】不用最大值：官方逐節資料實務上幾乎不會六節同級，取 max 的話
    ///    六節裡只要有一節是 2，整台車就標成「普通」——「舒適」會變成幾乎不出現的詞，
    ///    而那個詞正是要讓顏色不必獨立表意的東西（設計稿規則 3），失效等於白做。
    ///    取平均的代價是「五節空、一節爆滿」會讀成舒適；逐節色塊仍然畫得出那一節是紅的，
    ///    所以資訊沒有消失——詞負責「大致上」，色塊負責「具體哪一節」。
    ///
    /// 這個詞是我們的摘要，不是官方欄位（官方只給每節等級，沒有整列的詞），
    /// 所以不受「官方的值照抄不自己判斷」約束。
    static func crowdWord(_ v: [Int]) -> String? {
        guard !v.isEmpty else { return nil }
        let mean = Double(v.reduce(0, +)) / Double(v.count)
        switch Int(mean.rounded()) {
        case ...1: return "舒適"
        case 2:    return "普通"
        case 3:    return "略擠"
        default:   return "擁擠"
        }
    }
}

// MARK: - 比例（430pt 機型是設計基準，其餘機型等比縮）

/// 設計稿的字級與列高全部標在 430pt 寬機型（15／16 Pro Max）上。
/// 393pt 機型的內容框窄約 7%（Medium 338 vs 364），硬寫死會在小機型溢出。
/// 🔴 用「實際量到的內容寬 ÷ 設計基準寬」求比例，不用機型判斷——widget 的可用寬還受
///    accessory family 與系統邊距影響，判機型會漏掉這些情形。
struct RailScale {
    /// 設計基準：Medium／Large 的內容框寬 332pt、Small 138pt。
    static let mediumReference: CGFloat = 332
    static let smallReference: CGFloat = 138

    let k: CGFloat

    /// 下限 0.86 是 393pt 機型（338/364 ≈ 0.928）再留一點餘裕；上限 1 不放大，
    /// 因為設計稿的字級是「這個版面容得下的最大值」，放大只會讓長站名更早截斷。
    init(width: CGFloat, reference: CGFloat) {
        guard width > 0, reference > 0 else { self.k = 1; return }
        self.k = min(1, max(0.86, width / reference))
    }

    init(k: CGFloat) { self.k = min(1, max(0.86, k)) }

    func pt(_ v: CGFloat) -> CGFloat { (v * k).rounded() }

    /// 主角倒數的下限。設計稿：`.minimumScaleFactor(0.85)`，下限不低於 34pt。
    static let heroFloor: CGFloat = 34
}

// MARK: - 單色模式

/// tinted／accented 與部分玻璃情境下，系統會把所有顏色壓成單一色調 ⇒ 路線色與狀態色全部失效。
/// 設計稿：「每個狀態都必須另有形狀或文字備援」。這個 flag 讓元件自己決定怎麼退化，
/// 呼叫端不必在每個地方各判一次。
private struct RailMonochromeKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var railMonochrome: Bool {
        get { self[RailMonochromeKey.self] }
        set { self[RailMonochromeKey.self] = newValue }
    }
}

// MARK: - family 覆寫（只給算繪驗收用）

/// 🔴 2026-08-17 受控實驗結果：`previewContext(WidgetPreviewContext(family:))` 在
///    swiftc 編出的裸 macOS 執行檔裡【完全沒有作用】——三種 family 分別要求一次，
///    `@Environment(\.widgetFamily)` 讀回來都是 `.systemMedium`
///    （探針：畫一個把 family 印成字的 View，三張圖文字一模一樣）。
///    後果是 app/scripts/render_*.mjs 的 `family:` 參數一直是裝飾品：Small 與 Large
///    的版面【從來沒有被真的算繪過】，畫出來的一律是 Medium 分支套在小／大畫布上。
///    改版前那兩支腳本因此照不到 rowLimit(2/4/6) 與 showCrowd 的任何差異，而圖看起來
///    完全正常——這是心得 32「驗收腳本驗到的不是產物」的同一種假綠。
///
///    修法：出貨路徑照舊讀 `\.widgetFamily`（那是唯一正確的來源），另開一個【只在算繪
///    harness 設定】的覆寫值。用 Optional 當哨兵，nil＝不覆寫，所以出貨時不可能誤觸。
///    對應的 harness 端必須有一道「Small 與 Medium 算出來的圖必須不同」的 gate，
///    否則這個機制哪天再壞掉，症狀又會是一片全綠。
private struct RailFamilyOverrideKey: EnvironmentKey {
    static let defaultValue: WidgetFamily? = nil
}

extension EnvironmentValues {
    var railFamilyOverride: WidgetFamily? {
        get { self[RailFamilyOverrideKey.self] }
        set { self[RailFamilyOverrideKey.self] = newValue }
    }
}

extension View {
    /// 掛在每個 widget／LA 的根 View 上，把 `\.widgetRenderingMode` 翻譯成 railMonochrome。
    /// 🔴 不在元件內部各自讀 widgetRenderingMode：Live Activity 的鎖定畫面不吃那個環境值，
    ///    但它同樣有「系統會調色」的情形，統一由根 View 決定才不會兩邊行為分岔。
    func railRenderingMode(_ mode: WidgetRenderingMode) -> some View {
        // 🔴 用 transformEnvironment 做 OR 而不是直接 environment 覆寫：覆寫會在 fullColor 時
        //    把外部設好的 true 洗成 false，驗收腳本就沒辦法算繪單色版面（那正是四個缺陷裡
        //    兩個只在單色現形的地方）。
        transformEnvironment(\.railMonochrome) { v in if mode != .fullColor { v = true } }
    }
}

// MARK: - RailSpine 軌脊

/// 軌脊上的一顆站點。
///
/// 設計稿：2pt 線＋站點；主角站 11pt 實心圓、次列 8pt 空心環、LA 的列車是帶方向三角的白色圓標。
///
/// 🔴 與設計稿的一處實作偏離（視覺結果相同）：設計稿寫「環心填卡片底色把軌線遮住」，
///    但 widget 的底色由系統的 containerBackground 決定，玻璃／tinted 模式下拿不到那個顏色 ⇒
///    改成【軌脊線在圓點處斷開】（上下兩段各留缺口），不依賴任何背景色，四種顯示模式都成立。
struct RailSpineCell: View {
    enum Kind {
        /// 主角列：11pt 實心圓，吃路線色（單色模式退成 primary）
        case lead(Color?)
        /// 次列：8pt 空心環
        case follow
        /// 已過站：6pt 實心，用軌脊色（LA 進度用）
        case passed
        /// 列車現在的位置：白色圓標＋方向三角
        case train(Color?)
        /// 只有軌線、沒有站點。Large 混合卡的分區標題與分區 hairline 用它讓
        /// 「一條軌脊貫穿兩區」成立——那兩列不是站，所以不可以長出圓點。
        case line
    }

    let kind: Kind
    var lineAbove: Bool = true
    var lineBelow: Bool = true
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    /// 設計稿「三欄對齊」的第一欄：軌脊欄固定 12pt。
    static let column: CGFloat = 12

    private var spineColor: Color {
        mono ? Color.primary.opacity(0.45) : RailTokens.colors(scheme).brand.opacity(0.55)
    }

    private var dotDiameter: CGFloat {
        switch kind {
        case .lead:   return scale.pt(11)
        case .follow: return scale.pt(8)
        case .passed: return scale.pt(6)
        case .train:  return scale.pt(13)
        case .line:   return 0
        }
    }

    /// 軌線在圓點處讓出的缺口。`.line` 必須是 0——留 1.5pt 缺口就會在分區標題那一列
    /// 出現一段 3pt 的斷點，「一條連續的軌脊」當場破掉（那正是這個 kind 存在的理由）。
    private var lineGap: CGFloat {
        if case .line = kind { return 0 }
        return dotDiameter / 2 + scale.pt(1.5)
    }

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let cx = RailSpineCell.column / 2
            let cy = h / 2
            let d = dotDiameter
            // 缺口＝圓點半徑再加 1.5pt，讓線不要貼著圓點邊緣收尾（`.line` 為 0，見 lineGap）。
            let gap = lineGap
            let w = scale.pt(2)

            ZStack(alignment: .topLeading) {
                if lineAbove, cy - gap > 0 {
                    Rectangle().fill(spineColor)
                        .frame(width: w, height: cy - gap)
                        .offset(x: cx - w / 2, y: 0)
                }
                if lineBelow, h - (cy + gap) > 0 {
                    Rectangle().fill(spineColor)
                        .frame(width: w, height: h - (cy + gap))
                        .offset(x: cx - w / 2, y: cy + gap)
                }
                dot.frame(width: d, height: d).offset(x: cx - d / 2, y: cy - d / 2)
            }
        }
        .frame(width: RailSpineCell.column)
    }

    @ViewBuilder private var dot: some View {
        switch kind {
        case .line:
            EmptyView()
        case .lead(let c):
            Circle().fill(mono ? Color.primary : (c ?? RailTokens.colors(scheme).brand))
        case .follow:
            // 空心環：只有環，中間透空，所以軌線的缺口才是必要的（見型別註解）。
            Circle().strokeBorder(spineColor, lineWidth: scale.pt(1.6))
        case .passed:
            Circle().fill(spineColor)
        case .train(let c):
            // 🔴 圓盤固定是白的（設計稿：「列車是帶方向三角的白色圓標」）⇒ 環與三角一律用
            //    【固定的深色】，不可用 Color.primary：primary 在深色模式是白的，會變成
            //    白盤上的白三角，整個方向指示消失（單色模式的展示廊實測抓到）。
            let ink = mono ? Color(white: 0.15) : (c ?? RailTokens.colors(scheme).brand)
            ZStack {
                Circle().fill(Color.white)
                Circle().strokeBorder(ink, lineWidth: scale.pt(2))
                // 方向三角：朝下＝順著列表往前（Widget 的列由近到遠）。
                Triangle().fill(ink).frame(width: scale.pt(5), height: scale.pt(4.5))
            }
        }
    }
}

/// 方向三角。SwiftUI 沒有內建三角形，且 SF Symbol 在這個 extension 一律不用
/// （全 widget 目錄零 Image(systemName:)，視覺語言純靠形狀與色彩，不引進圖示系統）。
struct Triangle: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.closeSubpath()
        return p
    }
}

/// LA 的水平行程進度：一條 2pt 線，兩端與中間站點。
/// 設計稿：「行程進度是一條 2pt 線，兩端站名 11pt——存在但不搶」。
struct RailSpineTrack: View {
    /// 0…1，列車在整段行程上的位置。超出範圍會被夾。
    let progress: Double
    var lineColor: Color? = nil
    /// 停靠中＝空心環（設計稿：實心圓 → 綠實心 → 空心環＝停靠）
    var stopping: Bool = false
    /// 即將進站＝綠實心
    var arriving: Bool = false
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    private var spineColor: Color {
        mono ? Color.primary.opacity(0.45) : RailTokens.colors(scheme).brand.opacity(0.55)
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let t = min(1, max(0, progress))
            let d = scale.pt(9)
            let x = d / 2 + (w - d) * t
            ZStack(alignment: .leading) {
                Capsule().fill(spineColor.opacity(0.35))
                    .frame(width: w, height: scale.pt(2))
                    .offset(y: h / 2 - scale.pt(1))
                Capsule().fill(spineColor)
                    .frame(width: max(0, x), height: scale.pt(2))
                    .offset(y: h / 2 - scale.pt(1))
                // 兩端站點
                Circle().fill(spineColor).frame(width: scale.pt(5), height: scale.pt(5))
                    .offset(x: 0, y: h / 2 - scale.pt(2.5))
                Circle().strokeBorder(spineColor, lineWidth: scale.pt(1.4))
                    .frame(width: scale.pt(6), height: scale.pt(6))
                    .offset(x: w - scale.pt(6), y: h / 2 - scale.pt(3))
                marker.frame(width: d, height: d)
                    .offset(x: x - d / 2, y: h / 2 - d / 2)
            }
        }
    }

    @ViewBuilder private var marker: some View {
        let c = RailTokens.colors(scheme)
        if stopping {
            // 停靠中：空心環。環色與 RailSpineCell.train 同理用固定深色，不用 Color.primary
            // （白盤＋深色模式的 primary＝白環，等於整顆消失）。
            ZStack {
                Circle().fill(Color.white)
                Circle().strokeBorder(mono ? Color(white: 0.15) : (lineColor ?? c.brand),
                                      lineWidth: scale.pt(2))
            }
        } else if arriving {
            // 🔴 單色模式必須加形狀備援：「即將進站」與「行駛中」在設計稿裡只靠綠 vs 藏青區分，
            //    顏色被系統吃掉後兩態長得【一模一樣】（放大量測抓到）。設計稿自己的規則是
            //    「每個狀態都必須另有形狀或文字備援」⇒ 單色時多一圈外環，全彩維持原樣。
            if mono {
                ZStack {
                    Circle().fill(Color.primary)
                    Circle().strokeBorder(Color.primary.opacity(0.45), lineWidth: scale.pt(2))
                        .scaleEffect(1.7)
                }
            } else {
                Circle().fill(c.ok)
            }
        } else {
            Circle().fill(mono ? Color.primary : (lineColor ?? c.brand))
        }
    }
}

// MARK: - RailCountdown 倒數

/// 倒數的四種形態。設計稿：分／秒／進站／暫無資料。
///
/// 🔴 刻意【不提供】m:ss 形態。改版前捷運看板畫的是 `Text(timerInterval:)`，系統格式固定成
///    m:ss（畫面上是「2:37」），而「1:30」在候車情境會被讀成 1 小時 30 分。想畫碼表格式
///    在這個型別上找不到 case，是刻意的。
///
/// 分鐘取 floor 不取 ceil：ceil 會讓「1 分」只在剩 60 秒那一瞬出現一秒鐘就跳成秒，
/// floor 則是 120–179 秒→2 分、60–119 秒→1 分，單調且不高估。
enum RailCountdown: Equatable {
    /// ≥60 秒。value 已經是分鐘整數。
    case minutes(Int)
    /// 官方只給整數分鐘的系統（高捷／機捷）。
    /// 🔴 必須與 `.minutes` 分開：把整數分鐘畫成跟秒級絕對時刻一樣的樣子＝製造假精度。
    ///    畫面上多一個「約」字是精度差異的唯一顯形處，不可省。
    case approxMinutes(Int)
    /// <60 秒。🔴 只有 Live Activity 用——widget 不做秒級（見 `from(secondsLeft:surface:)`）。
    case seconds(Int)
    /// 已到站／即將進站。設計稿唯一給實心色塊的形態。
    case arriving
    /// 超過 90 秒沒有新資料。設計稿：唯一會拿掉主角數字的狀態。
    case noData
    /// 官方視野外，退回班表。照抄官方原字串（如「11:38」）並另標「表定」。
    case scheduled(String)

    enum Surface {
        /// Widget：分鐘制。<60 秒直接進「進站」，不顯示會凍住的秒數。
        case widget
        /// Live Activity：可以逐秒自走，所以 <60 秒顯示秒。
        case liveActivity
    }

    /// 從「還剩幾秒」求形態。
    /// - Parameter surface: widget 與 LA 的分界見 Surface 的說明。
    static func from(secondsLeft s: Double, surface: Surface) -> RailCountdown {
        if s < 60 { return surface == .widget ? .arriving : .seconds(max(0, Int(s.rounded(.down)))) }
        return .minutes(Int(s / 60))
    }
}

/// 倒數文字。
struct RailCountdownText: View {
    /// 🔴 字級住在型別裡，呼叫端【沒有】自由指定 pt 的路徑（原本是帶 CGFloat 參數的 hero case）。
    ///    理由是突變測試實測到的盲點：呼叫端傳 40 時，驗收 gate 也只能自己寫 40 去測
    ///    ——那是 gate 自己供的值，不是生產程式碼傳的值。於是把呼叫端改成 96
    ///    （數字被固定寬欄位裁掉、版面實際上壞了）所有 gate 依然全綠。改成列舉之後，
    ///    gate 窮舉 Size 的每一個 case，量的就是出貨路徑真正會用到的字級。
    ///    設計稿只有兩種主角字級（單班大卡 44、列表首列 40），開放 CGFloat 只是邀請漂移。
    enum Size: CaseIterable {
        /// 主角·單班大卡：Small 與 Live Activity 的 44pt
        case heroCard
        /// 主角·列表首列：Medium／Large 的 40pt
        case heroRow
        /// 次列：20pt（設計稿「拉開重量的三個手段」：主角列 20/40pt、次列 17/20pt
        /// ——斜線前是內容欄字級、後面是數字欄字級，所以次列的【數字】是 20pt 不是 17pt）
        case row
        /// 第三層（LA 的第二班、compact 島）：13pt
        case minor

        var pt: CGFloat {
            switch self {
            case .heroCard: return 44
            case .heroRow:  return 40
            case .row:      return 20
            case .minor:    return 13
            }
        }

        var isHero: Bool { self == .heroCard || self == .heroRow }
    }

    let value: RailCountdown
    var size: Size = .row
    /// `.arriving` 的字樣。預設「進站」（車站看板）；「我的地點」是落在鐵路旁的一根釘子、
    /// 沒有月台可進 ⇒ 那裡要傳「經過」。
    /// 🔴 這是【字樣】不是狀態：實心色塊、字級、槽位都不變，所以不必多開一個 case。
    var arrivingWord: String = "進站"
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    private var numberSize: CGFloat {
        size.isHero ? max(RailScale.heroFloor, scale.pt(size.pt)) : scale.pt(size.pt)
    }

    /// 單位字（分／秒）比數字小一階。設計稿的 mock 是數字大、單位小且貼在右下。
    private var unitSize: CGFloat {
        switch size {
        case .heroCard, .heroRow: return max(scale.pt(13), numberSize * 0.32)
        case .row:                return scale.pt(11)
        case .minor:              return scale.pt(10)
        }
    }

    private var isHero: Bool { size.isHero }

    var body: some View {
        switch value {
        case .minutes(let m): number("\(m)", unit: "分")
        case .approxMinutes(let m): number("\(m)", unit: "分", prefix: "約")
        case .seconds(let s): number("\(s)", unit: "秒")
        case .noData:
            // 🔴 尺寸【刻意不隨 hero 放大】：主角倒數的槽只有 76pt 寬，「暫無資料」四個字
            //    在 20pt 就要 80pt ⇒ 會被截成「暫無…」（展示廊實測到）。截斷的過期提示
            //    比沒有提示更糟，所以這裡一律 17pt＋fixedSize（永不出現刪節號）。
            //    設計稿那張把「暫無資料」畫得很大是因為它同時把整卡降級、讓那行獨佔內容欄；
            //    要那個效果由版面層決定（把 noData 放進內容欄而不是數字欄），不由元件放大。
            // 🔴 次列（56pt 槽）要再降一階到 13pt：17pt 的「暫無資料」實測 65pt 寬，
            //    而 frame 修飾詞不裁切 ⇒ 那 9pt 會直接畫到終點站名上面（slotGate 抓到）。
            //    主角欄 84／138pt 放得下 17pt，維持不動。
            Text("暫無資料")
                .font(.system(size: scale.pt(size.isHero ? 17 : 13), weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1).fixedSize()
        case .scheduled(let t):
            // 只畫時刻。「表定」標記由呼叫端用 RailStatusTag(.custom("表定")) 放在內容欄——
            // 塞進這個 76pt 槽裡一定會截字，且標記本來就是 StatusTag 的職責。
            Text(t)
                .font(.system(size: min(scale.pt(17), numberSize), weight: .semibold,
                              design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1).fixedSize()
        case .arriving: arriving
        }
    }

    private func number(_ n: String, unit: String, prefix: String? = nil) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: scale.pt(2)) {
            if let p = prefix {
                Text(p).font(.system(size: unitSize, weight: .medium)).foregroundStyle(.secondary)
            }
            Text(n)
                .font(.system(size: numberSize,
                              weight: isHero ? .semibold : .medium,
                              design: .rounded))
                .monospacedDigit()
                // 設計稿：主角倒數 minimumScaleFactor(0.85)，下限不低於 34pt。
                .minimumScaleFactor(isHero ? 0.85 : 1)
                .lineLimit(1)
            Text(unit)
                .font(.system(size: unitSize, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    /// 設計稿：「只有『進站』因為要當主角才給實心」。
    private var arriving: some View {
        let c = RailTokens.colors(scheme)
        return Text(arrivingWord)
            .font(.system(size: isHero ? max(scale.pt(19), numberSize * 0.48) : numberSize,
                          weight: .semibold))
            .foregroundStyle(mono ? Color.primary : Color.white)
            .padding(.horizontal, scale.pt(isHero ? 10 : 6))
            .padding(.vertical, scale.pt(isHero ? 5 : 2))
            .background(
                RoundedRectangle(cornerRadius: scale.pt(isHero ? 9 : 6), style: .continuous)
                    .fill(mono ? Color.primary.opacity(0.18) : c.ok))
            .lineLimit(1)
            .fixedSize()
    }
}

// MARK: - RailCarriageMeter 車廂擁擠度

/// 六節車廂逐節上色。
///
/// 設計稿：「六節＝六節車廂，依編組順序排列，車頭那節帶圓鼻標出行進方向。逐節上色才用得到
/// 既有的車廂資料；整列的一個詞放在旁邊，讓顏色不必獨立表意。」
///
/// 🔴 `levels` 一律照官方 `trains[].cars[]` 的順序畫，不重排。節數也照官方——文湖線是四節，
///    不補到六節（補格會被讀成「量到了但沒人」）。
///
/// 🔴 【與設計稿的偏離】「車頭那節帶圓鼻標出行進方向」沒有實作。兩個獨立理由，任一都足夠：
///    1. 尺寸上做不到：一節是 5×9pt，圓鼻與其他節的差別只有 1pt 圓角半徑
///       ——實際算繪放大 2 倍實看，六節【完全一模一樣】，那個線索傳不出去。
///    2. 資料上不該做：官方 `cars[]` 只給編組順序，【沒有】哪一端是車頭。畫圓鼻等於主張
///       一件我們不知道的事，而使用者會照著它站月台。看不見的裝飾只是白費，
///       看得見卻是猜的方向指示會害人走錯月台頭尾。
///    等官方（或實測）給得出車頭方向再加，那時也要一併把節寬放大到看得出圓鼻。
struct RailCarriageMeter: View {
    let levels: [Int]
    /// 設計稿：顏色不獨立表意 ⇒ 旁邊固定附一個詞。AX1 放大字體時才允許去詞留節。
    var showWord: Bool = true
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    private var carW: CGFloat { scale.pt(5) }
    private var carH: CGFloat { scale.pt(9) }

    var body: some View {
        // 🔴 外層間距【不可】沿用節與節之間的 1.5pt:那會讓擁擠度詞緊貼最後一節色塊,
        //    讀起來像第七節車廂(算繪放大實看抓到)。節距 1.5、詞距 5,兩者語意不同。
        HStack(spacing: scale.pt(5)) {
            HStack(spacing: scale.pt(1.5)) {
                ForEach(Array(levels.enumerated()), id: \.offset) { _, v in
                    car(level: v)
                }
            }
            if showWord, let w = RailTokens.crowdWord(levels) {
                Text(w).font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary).lineLimit(1).fixedSize()
            }
        }
    }

    /// 單色模式下改用深淺三階承擔——設計稿：「這也是六節車廂在單色下改用深淺三階、
    /// 並固定附詞的原因」。
    private func fill(_ v: Int) -> Color {
        guard mono else { return RailTokens.crowd(v, scheme) }
        switch v {
        case ...1: return Color.primary.opacity(0.28)
        case 2:    return Color.primary.opacity(0.55)
        default:   return Color.primary.opacity(0.9)
        }
    }

    private func car(level: Int) -> some View {
        RoundedRectangle(cornerRadius: scale.pt(1.5), style: .continuous)
            .fill(fill(level)).frame(width: carW, height: carH)
    }
}

// MARK: - RailLineMark 路線標

/// 路線點＋線名。
///
/// 🔴 設計稿規則 3：「路線色一定伴隨線名或車種文字」。改版前的看板只畫一顆色點不寫線名，
///    忠孝復興那張兩列都寫「往 南港展覽館」、只靠咖啡色點與藍色點區分文湖線與板南線 ⇒
///    實際上讀不出來是哪一條。所以這個元件【不提供「只有點」的用法】：name 是必填。
///    識別不出線名時呼叫端就不要畫這個元件（而不是畫一顆沒有標籤的點）。
struct RailLineMark: View {
    let name: String
    var color: Color? = nil
    var fontSize: CGFloat = 13
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        HStack(spacing: scale.pt(4)) {
            // 單色模式下顏色失效 ⇒ 點沒有資訊了，整顆撤掉、只留線名（設計稿：
            // 「單色模式自動退為純文字」）。
            if !mono, let c = color {
                Circle().fill(c).frame(width: scale.pt(7), height: scale.pt(7))
            }
            Text(name).font(.system(size: scale.pt(fontSize), weight: .medium))
                .lineLimit(1).minimumScaleFactor(0.85)
        }
    }
}

// MARK: - RailTrainMark 車次標

/// 車種標＋車次。
/// 設計稿：「現在車種與車次同色同大小，讀起來像一團。改成標＋車次兩種角色。」
struct RailTrainMark: View {
    let kind: String
    let number: String?
    /// 車種色。來源是 App 寫出的 meta.json.types，不是這一層的常數。
    var color: Color? = nil
    var fontSize: CGFloat = 13
    /// 車次字級。預設比車種標大兩級；主角列要傳 20（與旁邊的「往 X」同級——設計稿的示範裡
    /// 「0814」與「往 南港」是同一個大小，而車種標明顯比它們小）。
    var numberSize: CGFloat? = nil
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.railMonochrome) private var mono

    var body: some View {
        HStack(spacing: scale.pt(5)) {
            Text(kind)
                .font(.system(size: scale.pt(fontSize), weight: .semibold))
                .foregroundStyle(mono ? Color.primary : Color.white)
                .padding(.horizontal, scale.pt(5))
                .padding(.vertical, scale.pt(1.5))
                .background(RoundedRectangle(cornerRadius: scale.pt(4), style: .continuous)
                    .fill(mono ? Color.primary.opacity(0.18) : (color ?? Color.secondary)))
                .lineLimit(1).fixedSize()
            if let n = number, !n.isEmpty {
                // 🔴 車次也 fixedSize（不准縮、不准截）。曾經改成 minimumScaleFactor 想讓
                //    三欄的「我的地點」擠得下最長車種，結果是【所有卡】的車次都被旁邊的
                //    資料時刻壓成「08…」「4…」，甚至整個消失（算繪實看抓到）——車次是識別，
                //    截一碼就變成另一班車。窄欄要靠字級（那裡的車種標是 10pt）與欄寬去解，
                //    不是靠讓識別縮水。
                Text(n).font(.system(size: scale.pt(numberSize ?? fontSize + 2), weight: .medium))
                    .monospacedDigit().lineLimit(1).fixedSize()
            }
        }
    }
}

// MARK: - RailStatusTag 狀態標

/// 準點／誤點／末班／停駛／過期。設計稿：「純文字，沒有底色膠囊。」
struct RailStatusTag: View {
    enum Kind: Equatable {
        case onTime
        /// 誤點分鐘（正＝誤點、負＝早到）
        case delay(Int)
        case lastTrain
        /// 末班車＋官方時刻字串（照抄不重排）
        case lastTrainAt(String)
        case suspended
        /// 資料時刻（如「11:28 資料」）
        case stamp(String)
        case custom(String)
    }

    let kind: Kind
    var fontSize: CGFloat = 13
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    private var text: String {
        switch kind {
        case .onTime:        return "準點"
        // 🔴 `delay(0)` 是「官方讀數＝零分誤點」也就是準點，不是「誤點 +0 分」。
        //    tint 早就把 0 判成 ok 色了，文字卻還在講誤點——顏色與字互相矛盾。
        //    交給這裡統一，呼叫端就不必自己先把 0 換成 .onTime（漏換就會出現綠色的「誤點」）。
        case .delay(let m):
            if m == 0 { return "準點" }
            return m > 0 ? "誤點 +\(m) 分" : "早到 \(-m) 分"
        case .lastTrain:     return "末班車"
        case .lastTrainAt(let t): return "末班 \(t)"
        case .suspended:     return "停駛"
        case .stamp(let s):  return s
        case .custom(let s): return s
        }
    }

    private var tint: Color {
        if mono { return .secondary }
        let c = RailTokens.colors(scheme)
        switch kind {
        case .onTime:     return c.ok
        case .delay(let m): return m == 0 ? c.ok : c.warn
        case .lastTrain, .lastTrainAt: return c.dusk
        case .suspended:  return c.bad
        case .stamp, .custom: return .secondary
        }
    }

    var body: some View {
        Text(text)
            .font(.system(size: scale.pt(fontSize), weight: .medium))
            .foregroundStyle(tint)
            .lineLimit(1).fixedSize()
    }
}

// MARK: - RailSectionHeader 分區標題

/// 11pt 分區標題。設計稿：只在 Large 出現。
struct RailSectionHeader: View {
    let text: String
    var scale: RailScale = RailScale(k: 1)

    var body: some View {
        Text(text)
            .font(.system(size: scale.pt(11), weight: .semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .frame(height: scale.pt(16), alignment: .leading)
    }
}

// MARK: - 版面骨架

/// 設計稿「間距與高度預算」的列高。
/// 🔴「不靠 flex 壓縮」：每一列都給定高度，總和必須小於內容框，否則先砍一行而不是縮字。
enum RailRowHeight {
    static let hero: CGFloat = 43
    static let follow: CGFloat = 28
    static let followLarge: CGFloat = 32
    static let sectionHeader: CGFloat = 16
    static let cardTitle: CGFloat = 21
}

/// 數字欄寬。設計稿「三欄對齊」：軌脊欄 12pt、內容欄彈性、數字欄靠右 56／76pt。
enum RailNumberColumn {
    /// Small 與次列
    static let narrow: CGFloat = 56
    /// Medium／Large 主角列。
    /// 🔴 84 不是設計稿的 76：76 只夠「12 分」，但整數分鐘系統（高捷／機捷）畫的是
    ///    「約 12 分」——多出來的「約」字讓最寬形【實測 80pt】，76 會把數字裁掉。
    ///    這個值是從 app/scripts/render_metro_widget.mjs 的 slotGate 量出來的最寬形
    ///    再加 4pt 餘裕，不是手感調的；改字級或改單位字樣時那道 gate 會再算一次。
    ///    代價是 Medium 內容欄從 232 縮到 224pt，量過仍放得下最長的「往 南港展覽館」＋線名＋六節＋詞。
    static let wide: CGFloat = 84
}

/// 一列的三欄骨架：軌脊 → 內容（彈性）→ 數字（固定寬靠右）。
///
/// 🔴 破版防線（設計稿）：數字欄固定寬並取得 layoutPriority，內容欄先截；
///    每一列都給定高度，超出就先砍列而不是縮字。
struct RailRow<Content: View, Trailing: View>: View {
    let spine: RailSpineCell.Kind
    var lineAbove: Bool = true
    var lineBelow: Bool = true
    var height: CGFloat = RailRowHeight.follow
    var numberWidth: CGFloat = RailNumberColumn.narrow
    var scale: RailScale = RailScale(k: 1)
    @ViewBuilder var content: () -> Content
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: scale.pt(6)) {
            RailSpineCell(kind: spine, lineAbove: lineAbove, lineBelow: lineBelow, scale: scale)
            VStack(alignment: .leading, spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(0)
            trailing()
                .frame(width: scale.pt(numberWidth), alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
        }
        .frame(height: scale.pt(height))
    }
}

/// 卡片標題列：站名（或車站＋方向）＋右側資料時刻。
/// 🔴 設計稿破版防線：「卡片標題單獨一行，不與更新時間搶寬度」——所以時刻用 fixedSize 佔死，
///    站名才是先被截的那一個。
struct RailCardTitle<Trailing: View>: View {
    let title: String
    var scale: RailScale = RailScale(k: 1)
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: scale.pt(6)) {
            Text(title)
                .font(.system(size: scale.pt(17), weight: .semibold))
                .lineLimit(1).minimumScaleFactor(0.85)
            Spacer(minLength: scale.pt(4))
            trailing().fixedSize()
        }
        .frame(height: scale.pt(RailRowHeight.cardTitle))
    }
}

/// 資料時刻。設計稿最小字級 11pt，且「資料時刻永遠顯示」。
struct RailStamp: View {
    /// 已經格式化好的時刻（HH:mm）。時區錨定由呼叫端負責（Asia/Taipei，非裝置時鐘）。
    let text: String
    var suffix: String = "更新"
    var warn: Bool = false
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        // 單色模式下警示色失效 ⇒ 靠「⚠」這個形狀承擔（設計稿：每個狀態都要有形狀或文字備援）。
        Text((warn ? "⚠ " : "") + text + (suffix.isEmpty ? "" : " " + suffix))
            .font(.system(size: scale.pt(11)))
            .monospacedDigit()
            .foregroundStyle(warn && !mono ? AnyShapeStyle(RailTokens.colors(scheme).warn)
                                           : AnyShapeStyle(HierarchicalShapeStyle.secondary))
            .lineLimit(1)
            // suffix 省掉時（138pt 的識別列放不下「更新」那兩個字）畫面上只剩一個裸時刻，
            // 而同一張卡上還有發車時刻 ⇒ 至少讓旁白講清楚這是哪一個時間。
            .accessibilityLabel(suffix.isEmpty ? "資料時刻 \(text)" : "\(text) \(suffix)")
    }
}

/// 分區之間的內縮 hairline。
///
/// 設計稿：「分區靠留白與一條 hairline，不用重框」；Large 是「一條軌脊貫穿兩區」，
/// 所以 hairline 必須【從內容欄才開始】——畫滿整寬會把軌脊切斷，那條連續的線正是
/// 「兩區只是它的兩段」這個講法的全部。
/// 玻璃／透明模式下設計稿要求「去掉所有 hairline 以外的分隔」——這就是那條 hairline 本身，
/// 所以它在所有顯示模式都畫。
struct RailHairline: View {
    /// 高度預算裡的那個 9pt（Medium：21＋8＋43＋9＋28＋28＝137）。
    var height: CGFloat = 9
    var scale: RailScale = RailScale(k: 1)

    var body: some View {
        HStack(spacing: 0) {
            Spacer().frame(width: RailSpineCell.column + scale.pt(6))
            Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 1)
        }
        .frame(height: scale.pt(height))
    }
}

// MARK: - RailEndButton

/// LA 的「結束」膠囊。設計稿：30pt 高，只在 Live Activity 出現。
struct RailEndButton<Label: View>: View {
    var scale: RailScale = RailScale(k: 1)
    @ViewBuilder var label: () -> Label

    var body: some View {
        label()
            .font(.system(size: scale.pt(13), weight: .semibold))
            .padding(.horizontal, scale.pt(14))
            .frame(height: scale.pt(30))
            .background(Capsule().fill(Color.primary.opacity(0.12)))
    }
}
