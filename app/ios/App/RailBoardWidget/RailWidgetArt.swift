import SwiftUI
import WidgetKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// 小工具背景：A 車模頭帶／C 小世界場景／素色。
//
// 2026-09-23 使用者裁示：「就用 A 跟 C，開始實作到 App 小工具」「三題都照建議」——
//  1. 小工具設定加「背景」：車模（A，預設）／場景（C）／素色（改版前的樣子）
//  2. A 的車模跟著【下一班的車種】換；小工具資料只有車種（區間車／自強／區間快／莒光/復興／
//     其他／高鐵），沒有車型欄位 ⇒ 每個車種一台代表車
//  3. 捷運卡不提供「場景」（現有三個場景都是台鐵題材）
// 定稿：~/Desktop/軌島小工具背景方案/小工具背景方案.html（Artifact 第 2 版）。
//
// 🔴 這個檔依賴 RailWidgetKit.swift（RailScale、railMonochrome），反過來不行：
//    render_widget_kit.mjs 只編 RailWidgetKit.swift 一個檔。
// 🔴 素材由 app/scripts/build_widget_art.py 產生（尺寸＝小工具實際像素，理由寫在那支腳本裡），
//    不要手動丟圖進 asset catalog。

// MARK: - 樣式與環境值

/// 小工具背景。rawValue 與設定畫面的存值一致（兩平台同一組 ASCII：model／scene／plain）。
enum RailBackdrop: String {
    case model
    case scene
    case plain
}

private struct RailBackdropKey: EnvironmentKey { static let defaultValue: RailBackdrop = .plain }
private struct RailContainerShownKey: EnvironmentKey { static let defaultValue = true }
private struct RailArtDirectoryKey: EnvironmentKey { static let defaultValue: String? = nil }
private struct RailArtHiddenKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// 這張卡要畫哪一種背景。由最外層的 entry view 決定（好讀版、鎖屏、我的地點一律 .plain）。
    var railBackdrop: RailBackdrop {
        get { self[RailBackdropKey.self] }
        set { self[RailBackdropKey.self] = newValue }
    }

    /// 系統這一次有沒有畫出 containerBackground。
    /// 🔴 著色（accented）模式、StandBy 等情境系統會把整張背景拿掉，C 的場景跟著消失——
    ///    這時版面要退回一般版面，不能留一個「給場景看的空洞」。出貨路徑由根 View 從
    ///    `\.showsWidgetContainerBackground` 抄過來（那個值對外唯讀，harness 設不了，
    ///    跟 railFamilyOverride 同一個理由）；單色模式另外由 railMonochrome 蓋掉。
    var railContainerShown: Bool {
        get { self[RailContainerShownKey.self] }
        set { self[RailContainerShownKey.self] = newValue }
    }

    /// 🔴 只給算繪 harness：asset catalog 的資料夾路徑。swiftc 編出的裸執行檔沒有編譯過的
    ///    Assets.car，`Image(name)` 會靜靜畫出空白 ⇒ harness 直接讀 imageset 裡的 @3x 檔。
    ///    出貨路徑恆為 nil。
    var railArtDirectory: String? {
        get { self[RailArtDirectoryKey.self] }
        set { self[RailArtDirectoryKey.self] = newValue }
    }

    /// 🔴 只給算繪 harness 的破版 gate：車模刻意超出內容框（小卡的車被卡片圓角裁掉才是設計），
    ///    gate 量墨跡時要先把車藏起來，量的才是文字有沒有溢出。藏法是透明度 0，版面不變。
    ///    站名牌的投影同理（半徑 4pt，貼著內容框左上角時會溢進邊距）：一起收掉，量牌子本體。
    var railArtHidden: Bool {
        get { self[RailArtHiddenKey.self] }
        set { self[RailArtHiddenKey.self] = newValue }
    }
}

// MARK: - 代表車與場景

enum RailWidgetArt {
    /// 台鐵／高鐵車種 → 代表車。車種字串是 App 寫出的 meta.json types 的鍵。
    /// 「其他」多半是普快 ⇒ 藍皮；畫 EMU900 會被讀成區間車。
    /// 莒光/復興用 E400 車頭：斜角看客車只是一個橘色箱子，車頭才認得出是莒光。
    static func traModel(type: String) -> String {
        switch type {
        case "自強": return "emu3000"
        case "區間快": return "emu800"
        case "區間車": return "emu900"
        case "莒光/復興": return "e400"
        case "高鐵": return "700t"
        default: return "blue"
        }
    }

    /// 捷運路線 → 代表車。線碼是 MetroWidgetData.json 的 lines[].id。
    /// 對不到（新系統、新線）回 nil ⇒ 頭帶照畫、不畫車，不拿別條線的車充數。
    static func metroModel(sys: String, line: String) -> String? {
        switch sys {
        case "trtc":
            switch line {
            case "BR": return "val256"
            case "R", "R_XBT", "G", "G_XBT": return "c381"
            case "O_XINZHUANG", "O_LUZHOU": return "c371"
            case "BL": return "c341"
            case "Y": return "y100"
            default: return nil
            }
        case "krtc": return line == "C" ? "citadis" : "kaohsiung"
        case "tymc": return "airportlocal"
        default: return nil
        }
    }

    /// 轉乘站分不出是哪一條線時：候選路線全部對到同一台車才畫，否則不畫（不猜）。
    static func metroModel(sys: String, candidates: [String]) -> String? {
        let models = Set(candidates.map { metroModel(sys: sys, line: $0) })
        guard models.count == 1, let only = models.first else { return nil }
        return only
    }

    /// 各尺寸的場景（mockup 定稿：大卡高架月台、小卡平交道；中卡多良）。
    static func sceneAsset(_ family: WidgetFamily) -> String {
        switch family {
        case .systemLarge: return "widget-scene-viaduct-l"
        case .systemMedium: return "widget-scene-duoliang-m"
        default: return "widget-scene-crossing-s"
        }
    }

    /// 場景露出的高度（設計基準 pt，會乘寬度係數）。下緣 60% 淡出到卡片底色。
    static func sceneHeight(_ family: WidgetFamily) -> CGFloat {
        family == .systemLarge ? 150 : 96
    }

    /// A 頭帶的高度（從卡片上緣算起，設計基準 pt）。小卡沒有頭帶，車停在右下角。
    static func bandHeight(_ family: WidgetFamily) -> CGFloat {
        family == .systemLarge ? 86 : 60
    }

    /// 卡片內容邊距。與 RailBoardInsets.content 同值；捷運卡走系統預設邊距，在 iPhone 上也是 16。
    static let cardInset: CGFloat = 16

    static func contentReference(_ family: WidgetFamily) -> CGFloat {
        family == .systemSmall ? RailScale.smallReference : RailScale.mediumReference
    }
}

// MARK: - 站名牌資料

/// C 左上角琺瑯站名牌要寫什麼。
struct RailPlateInfo {
    enum Band {
        /// 鄰站帶「◀ 萬華　松山 ▶」：左＝往南那一側的鄰站，右＝往北。某一側沒有就只寫一側。
        case neighbors(left: String?, right: String?)
        /// 單一句（直達模式寫「往 臺北」）。
        case text(String)
    }

    let name: String
    let band: Band?
}

// MARK: - 圖片

/// 從 asset catalog 取圖。harness 設了 railArtDirectory 時改讀檔案（見該環境值的紅字）。
struct RailArtImage: View {
    let name: String
    /// 著色模式下的畫法。車模要 `.accentedDesaturated`（留下灰階細節）——不加會變成一整塊
    /// 強調色剪影；場景在著色模式本來就被系統拿掉，給 nil。
    var accented: Bool = false

    @Environment(\.railArtDirectory) private var directory
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let image = resolved.resizable()
        if accented, #available(iOS 18.0, macOS 15.0, *) {
            image.widgetAccentedRenderingMode(.accentedDesaturated)
        } else {
            image
        }
    }

    private var resolved: Image {
        guard let directory else { return Image(name) }
        let folder = "\(directory)/\(name).imageset/"
        let dark = scheme == .dark ? ["\(name)-dark@3x.jpg", "\(name)-dark@3x.png"] : []
        for file in dark + ["\(name)@3x.jpg", "\(name)@3x.png"] {
            #if os(macOS)
            if let image = NSImage(contentsOfFile: folder + file) { return Image(nsImage: image) }
            #else
            if let image = UIImage(contentsOfFile: folder + file) { return Image(uiImage: image) }
            #endif
        }
        return Image(name)
    }
}

/// 車模（透明底、車頭朝左下的斜角）。等比縮進給定的框，靠框的右下角。
struct RailTrainArt: View {
    let model: String

    @Environment(\.railMonochrome) private var mono
    @Environment(\.railArtHidden) private var hidden

    var body: some View {
        RailArtImage(name: "widget-train-\(model)", accented: true)
            .aspectRatio(contentMode: .fit)
            // 單色的鎖屏／著色模式：系統會依 widgetAccentedRenderingMode 去飽和；這裡再保一層，
            // 讓 harness 的單色圖（沒有系統那一步）看得到真正的明暗。
            .saturation(mono ? 0 : 1)
            .opacity(hidden ? 0 : 1)
            .accessibilityHidden(true)
    }
}

// MARK: - 卡片底圖（containerBackground 裡畫的那一層）

/// 🔴 這一層只放「系統可以整個拿掉」的東西（頭帶底色、場景）。車模與站名牌在內容層：
///    著色模式背景被拿掉時，它們仍要留著。
struct RailCardBackdrop: View {
    let style: RailBackdrop
    let family: WidgetFamily

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        GeometryReader { geo in
            let scale = RailScale(width: geo.size.width - 2 * RailWidgetArt.cardInset,
                                  reference: RailWidgetArt.contentReference(family))
            VStack(spacing: 0) {
                if !mono {
                    switch style {
                    case .model where family != .systemSmall:
                        band(height: scale.pt(RailWidgetArt.bandHeight(family)))
                    case .scene:
                        RailArtImage(name: RailWidgetArt.sceneAsset(family))
                            .aspectRatio(contentMode: .fill)
                            .frame(width: geo.size.width, height: scale.pt(RailWidgetArt.sceneHeight(family)))
                            .clipped()
                            // mockup：linear-gradient(180deg, transparent 40%, 卡片底色 100%)。
                            // 用遮罩淡成透明而不是疊一層卡片色——底下的系統底色是什麼都對得上。
                            .mask(LinearGradient(stops: [.init(color: .black, location: 0),
                                                         .init(color: .black, location: 0.4),
                                                         .init(color: .clear, location: 1)],
                                                 startPoint: .top, endPoint: .bottom))
                    default:
                        EmptyView()
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityHidden(true)
    }

    private func band(height: CGFloat) -> some View {
        let colors: [Color] = scheme == .dark
            ? [rgb(0x26303F), rgb(0x1F2227)]
            : [rgb(0xEEF3FB), rgb(0xF6F1E7)]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            .frame(height: height)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.primary.opacity(scheme == .dark ? 0.14 : 0.08)).frame(height: 1)
            }
    }
}

// MARK: - 琺瑯站名牌

/// C 左上角的站名牌。App 頂端站名牌（網站 `.plate`）同一組色票：
/// 白底深藍大字＋框、下緣一條藏青色鄰站帶。
///
/// 🔴 高度是固定的（每一段都用 frame 夾住），版面預算才算得準：`height(_:band:scale:)`
///    與實際畫出來的高度逐 pt 相同。字太長時靠 minimumScaleFactor 縮，不長高。
struct RailStationPlate: View {
    enum Size { case large, small }

    let info: RailPlateInfo
    var size: Size = .large
    /// 捷運卡的帶子改用路線色；nil＝台鐵藏青。
    var bandColor: Color? = nil
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono
    @Environment(\.railArtHidden) private var artHidden

    private struct Metrics {
        let name: CGFloat, tracking: CGFloat, nameRow: CGFloat, padTop: CGFloat, padH: CGFloat
        let bandFont: CGFloat, bandTracking: CGFloat, bandRow: CGFloat, bandPadH: CGFloat, gap: CGFloat
        let arrow: CGFloat, border: CGFloat, radius: CGFloat, minWidth: CGFloat, maxName: CGFloat
    }

    // mockup 的 CSS（.eplate／.eplate.sm）逐項換算：框線 2px＋外圈 1px ring ＝ 3pt。
    private static let large = Metrics(name: 21, tracking: 6, nameRow: 26, padTop: 5, padH: 12,
                                       bandFont: 9.5, bandTracking: 1.5, bandRow: 17, bandPadH: 8, gap: 3,
                                       arrow: 7, border: 3, radius: 8, minWidth: 104, maxName: 180)
    private static let small = Metrics(name: 14, tracking: 3, nameRow: 18, padTop: 3, padH: 8,
                                       bandFont: 8, bandTracking: 0.5, bandRow: 13, bandPadH: 6, gap: 2,
                                       arrow: 6, border: 2.5, radius: 6, minWidth: 0, maxName: 100)

    private var m: Metrics { size == .large ? Self.large : Self.small }

    /// 整面牌子的高度（含框）。沒有帶子時下緣補一段與上緣相同的留白。
    static func height(_ size: Size, band: Bool, scale: RailScale) -> CGFloat {
        let m = size == .large ? large : small
        let inner = scale.pt(m.padTop) + scale.pt(m.nameRow)
            + (band ? scale.pt(m.gap) + scale.pt(m.bandRow) : scale.pt(m.padTop))
        return inner + 2 * m.border
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(RailNativeL10n.name(info.name))
                .font(.system(size: scale.pt(m.name), weight: .black))
                .tracking(scale.pt(m.tracking))
                // CSS 的 text-indent：tracking 會在最後一個字後面多留一格，左邊補同樣一格才置中。
                .padding(.leading, scale.pt(m.tracking))
                .lineLimit(1).minimumScaleFactor(0.6)
                .foregroundStyle(nameInk)
                // 共站的標題可能很長：牌子最寬到這裡，再長就縮字（fixedSize 底下 Text 會被提議這個寬）。
                .frame(maxWidth: scale.pt(m.maxName))
                .frame(height: scale.pt(m.nameRow))
                .padding(.horizontal, scale.pt(m.padH))
                .padding(.top, scale.pt(m.padTop))
                .frame(maxWidth: .infinity)
            if let band = info.band {
                bandRow(band)
                    .padding(.top, scale.pt(m.gap))
            } else {
                Spacer().frame(height: scale.pt(m.padTop))
            }
        }
        // 🔴 minWidth 要放在 fixedSize【裡面】：放外面時多出來的寬只有牌子底色，帶子不會跟著拉長。
        .frame(minWidth: scale.pt(m.minWidth))
        .fixedSize()
        .background(plateFill)
        .clipShape(RoundedRectangle(cornerRadius: scale.pt(m.radius) - m.border / 2, style: .continuous))
        .padding(m.border)
        .background(frame)
        .compositingGroup()
        .shadow(color: mono || artHidden ? .clear : rgb(0x282218).opacity(0.28), radius: 4, x: 0, y: 3)
        .widgetAccentable()
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func bandRow(_ band: RailPlateInfo.Band) -> some View {
        Group {
            switch band {
            case .neighbors(let left, let right):
                HStack(spacing: scale.pt(m.gap)) {
                    if let left {
                        HStack(spacing: scale.pt(2)) {
                            Text(verbatim: "◀").font(.system(size: scale.pt(m.arrow)))
                            Text(RailNativeL10n.name(left))
                        }
                    }
                    Spacer(minLength: scale.pt(size == .large ? 12 : 8))
                    if let right {
                        HStack(spacing: scale.pt(2)) {
                            Text(RailNativeL10n.name(right))
                            Text(verbatim: "▶").font(.system(size: scale.pt(m.arrow)))
                        }
                    }
                }
            case .text(let text):
                Text(verbatim: text)
            }
        }
        .font(.system(size: scale.pt(m.bandFont), weight: .heavy))
        .tracking(scale.pt(m.bandTracking))
        .lineLimit(1).minimumScaleFactor(0.7)
        .foregroundStyle(mono ? AnyShapeStyle(HierarchicalShapeStyle.primary) : AnyShapeStyle(rgb(0xFFF8EC)))
        .padding(.horizontal, scale.pt(m.bandPadH))
        .frame(height: scale.pt(m.bandRow))
        .frame(maxWidth: .infinity)
        .background {
            if mono {
                // 著色模式只留外框與字：帶子退成一條分隔線。
                VStack { Rectangle().fill(Color.primary.opacity(0.5)).frame(height: 1); Spacer(minLength: 0) }
            } else if let bandColor {
                bandColor
            } else {
                LinearGradient(stops: [.init(color: rgb(0x2C4F86), location: 0),
                                       .init(color: rgb(0x26497E), location: 0.55),
                                       .init(color: rgb(0x1F3D6B), location: 1)],
                               startPoint: .top, endPoint: .bottom)
            }
        }
    }

    private var nameInk: AnyShapeStyle {
        if mono { return AnyShapeStyle(HierarchicalShapeStyle.primary) }
        return AnyShapeStyle(scheme == .dark ? rgb(0xCFE0F8) : rgb(0x26497E))
    }

    @ViewBuilder
    private var plateFill: some View {
        if mono {
            Color.clear
        } else {
            let stops = scheme == .dark
                ? [rgb(0x1B2740), rgb(0x141D31), rgb(0x10182A)]
                : [rgb(0xFFFFFF), rgb(0xF7F5EE), rgb(0xEDEBE0)]
            LinearGradient(stops: [.init(color: stops[0], location: 0),
                                   .init(color: stops[1], location: 0.72),
                                   .init(color: stops[2], location: 1)],
                           startPoint: .top, endPoint: .bottom)
        }
    }

    @ViewBuilder
    private var frame: some View {
        let shape = RoundedRectangle(cornerRadius: scale.pt(m.radius) + m.border / 2, style: .continuous)
        if mono {
            shape.strokeBorder(Color.primary.opacity(0.6), lineWidth: 1.5)
        } else {
            shape.fill(scheme == .dark ? rgb(0x3A4E76) : rgb(0x767061))
        }
    }
}

// MARK: - 小工具

/// 0xRRGGBB → Color。這一層的色票是設計稿的固定值（站名牌、頭帶），不是資料驅動的路線色／車種色。
// MARK: - 場景上的小字墊底

/// C 場景上的小字（班表警示、中卡的更新時間）墊一塊半透明底：場景是一整張圖，
/// 11pt 的橘字／灰字直接壓在樹叢與屋頂上讀不出來（算繪 harness 第一輪就看到）。
/// 色票照 mockup 的 `.pill`：淺 rgba(255,255,255,.8)、深 rgba(28,28,30,.72)。
/// 🔴 只有場景真的畫出來時才墊：著色模式與系統拿掉背景時，這塊底會被算成一塊實心色塊。
struct RailSceneBacking: ViewModifier {
    let scale: RailScale

    @Environment(\.railBackdrop) private var backdrop
    @Environment(\.railMonochrome) private var mono
    @Environment(\.railContainerShown) private var containerShown
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        if backdrop == .scene && containerShown && !mono {
            content
                .padding(.horizontal, scale.pt(6))
                .padding(.vertical, scale.pt(1.5))
                .background(RoundedRectangle(cornerRadius: scale.pt(7), style: .continuous)
                    .fill(scheme == .dark ? rgb(0x1C1C1E).opacity(0.72) : Color.white.opacity(0.8)))
        } else {
            content
        }
    }
}

extension View {
    func railSceneBacking(_ scale: RailScale) -> some View { modifier(RailSceneBacking(scale: scale)) }
}

private func rgb(_ hex: UInt32) -> Color {
    Color(.sRGB,
          red: Double((hex >> 16) & 0xFF) / 255,
          green: Double((hex >> 8) & 0xFF) / 255,
          blue: Double(hex & 0xFF) / 255,
          opacity: 1)
}
