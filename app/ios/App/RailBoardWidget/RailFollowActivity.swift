import ActivityKit
import SwiftUI
import WidgetKit

private func delayText(_ sec: Int) -> String {
    if sec >= 60 { return "誤點 \(sec / 60) 分" }
    if sec <= -60 { return "早到 \(-sec / 60) 分" }
    return "準點"
}

// 車種代表色。來源是班表裡那台車自己的 color(#RRGGBB),與地圖上畫的是同一個值。
// 🔴 解析不出來就回 nil,呼叫端一律有不帶顏色的版面可走——絕不用「猜一個顏色」兜底:
//    卡片上出現一個與地圖不一致的顏色,比沒有顏色更難察覺也更誤導。
private func railColor(_ hex: String?) -> Color? {
    guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    return Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255,
                        green: Double((v >> 8) & 0xFF) / 255,
                        blue: Double(v & 0xFF) / 255)
}

// 同一個色在深底上當【文字】用會偏暗(自強 #C0392B 尤其明顯),往白色混三成再用。
// 圓點與進度條維持原色——那是色塊,不需要提亮,提了反而與地圖對不起來。
private func railInkColor(_ hex: String?) -> Color? {
    guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    let mix = { (c: UInt32) -> Double in
        let base = Double(c) / 255
        return base + (1 - base) * 0.35
    }
    return Color(.sRGB, red: mix((v >> 16) & 0xFF), green: mix((v >> 8) & 0xFF), blue: mix(v & 0xFF))
}

@available(iOS 17.6, *)
struct RailFollowActivityWidget: Widget {
    // 距下一站的進度。兩端都有值才畫——系統會逐幀自走,不需要推播。
    // 🔴 ProgressView(timerInterval:) 與 Text(timerInterval:) 是【唯二】會自己動的元件;
    //    withAnimation/.repeatForever 等修飾子被系統忽略(ActivityKit 文件明文),跑馬燈做不到。
    //    這也是為什麼進度條值得特地放進動態島展開版面:它是那裡唯一能「在跑」的東西。
    // 🔴 修復輪次2:入參從 Date? 改 Double?(epoch 秒,對應後端 Math.floor(epochMs/1000) 送的
    //    Unix epoch)。Date 轉換收斂在這裡(唯一的 view 層),用 timeIntervalSince1970——
    //    不要用 Date(timeIntervalSinceReferenceDate:),那是 2001 年零點,對應到錯誤的年份。
    // 🔴 這支【不能】標 @ViewBuilder:body 裡有顯式 return,而 result builder 的 body
    //    不允許 explicit return(編譯期直接報錯)。改成自己回一個 Group,分支交給 Group 的
    //    builder 處理,行為完全相同。
    private func progress(_ fromSec: Double?, _ toSec: Double?, tint: Color?, stopping: Bool) -> some View {
        let from = fromSec.map { Date(timeIntervalSince1970: $0) }
        let to = toSec.map { Date(timeIntervalSince1970: $0) }
        return Group {
            if stopping {
                // 停靠中沒有「往下一站的進度」可跑,但整條抽掉會讓版面在進站那一瞬間塌掉一列。
                // 畫成滿格的靜態條:語意是對的(這一段已經跑完),高度也不跳。
                ProgressView(value: 1).labelsHidden().tint(tint ?? .white)
            } else if let from, let to, to > from, to > Date() {
                ProgressView(timerInterval: from...to, countsDown: false)
                    .labelsHidden().tint(tint ?? .white)
            }
        }
    }

    // 🔴 倒數只在真的有 ETA 時才畫。arrivalDate 為 nil ⇒ 整列不畫(不是畫 0、不是畫 1970)。
    // 🔴 修復輪次3:入參從 Date? 改 Double?,理由與 progress() 相同(見上方)。
    @ViewBuilder
    private func countdown(_ dateSec: Double?, maxWidth: CGFloat) -> some View {
        let date = dateSec.map { Date(timeIntervalSince1970: $0) }
        if let date, date > Date() {
            Text(timerInterval: Date()...date, countsDown: true)
                .monospacedDigit().frame(maxWidth: maxWidth)
        }
    }

    // 上游即時資料中斷的告知。空字串視同沒有——後端正常時送 null,但不要讓「送了空字串」
    // 變成一行看不見的空白把版面撐開。
    private func noticeText(_ raw: String?) -> String? {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return raw
    }

    // 車種識別列(色點＋車種＋車次)。鎖定畫面與動態島共用同一個組件,兩處看起來才是同一張卡。
    @ViewBuilder
    private func ident(_ attrs: RailFollowAttributes, size: CGFloat) -> some View {
        HStack(spacing: 5) {
            if let c = railColor(attrs.color) {
                Circle().fill(c).frame(width: size * 0.62, height: size * 0.62)
            }
            Text(attrs.kind)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(railInkColor(attrs.color) ?? .primary)
            Text(attrs.trainNo)
                .font(.system(size: size)).foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .lineLimit(1)
    }

    // 「停靠中」徽章。綠色是刻意的:它表達的是「可以上下車」而不是車種,用車種色會與識別列打架。
    private var stoppingBadge: some View {
        Text("停靠中")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RailFollowAttributes.self) { context in
            // ── 鎖定畫面 / 橫幅 ──
            let stopping = context.state.stopping ?? false
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .center) {
                    ident(context.attributes, size: 13)
                    Spacer(minLength: 8)
                    if stopping {
                        stoppingBadge
                    } else {
                        countdown(context.state.arrivalDate, maxWidth: 92)
                            .font(.system(.title2, design: .rounded))
                            .contentTransition(.numericText())
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    // 停靠中時標籤改成「目前」——車就在這一站,叫它「下一站」是錯的。
                    Text(stopping ? "目前" : "下一站")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(context.state.nextStop).font(.title3).fontWeight(.bold)
                    Spacer(minLength: 6)
                    Text(delayText(context.state.delaySec))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                progress(context.state.departedDate, context.state.arrivalDate,
                         tint: railColor(context.attributes.color), stopping: stopping)
                // 進度條的兩端:左＝從哪來、右＝往哪去。沒有上一站(始發站)時左邊留白,不畫佔位符。
                HStack {
                    Text(context.state.prevStop ?? "")
                    Spacer(minLength: 8)
                    Text("往 \(context.state.terminus)")
                }
                .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                // 🔴 文案整句由後端決定(改字不必重出 App)。橘色在鎖定畫面的深淺兩種底
                //    都讀得到,且與既有的 .secondary 灰明顯分得開;放在最後一列,站名與
                //    倒數的版面完全不動(橫幅高度自適應)。
                if let notice = noticeText(context.state.notice) {
                    Text(notice)
                        .font(.caption2).foregroundStyle(.orange)
                        .lineLimit(2).minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { context in
            let stopping = context.state.stopping ?? false
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ident(context.attributes, size: 13).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // 停靠中沒有倒數可言(車已經到了),改掛徽章;不留空白讓版面塌掉。
                    Group {
                        if stopping {
                            stoppingBadge
                        } else {
                            countdown(context.state.arrivalDate, maxWidth: 66).font(.caption)
                                .contentTransition(.numericText())
                        }
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(stopping ? "目前" : "下一站")
                                .font(.system(size: 10)).foregroundStyle(.secondary)
                            Text(context.state.nextStop)
                                .font(.system(size: 19, weight: .bold)).lineLimit(1)
                            Spacer(minLength: 6)
                            Text(delayText(context.state.delaySec))
                                .font(.system(size: 10)).foregroundStyle(.secondary)
                        }
                        // 🔴 這條進度條是展開版面唯一會自己動的東西(見 progress() 的註解)。
                        //    原本只畫在鎖定畫面,動態島一格都沒有 ⇒ 展開後整個版面是靜止的。
                        progress(context.state.departedDate, context.state.arrivalDate,
                                 tint: railColor(context.attributes.color), stopping: stopping)
                        HStack {
                            Text(context.state.prevStop ?? "")
                            Spacer(minLength: 8)
                            Text("往 \(context.state.terminus)")
                        }
                        .font(.system(size: 10)).foregroundStyle(.tertiary).lineLimit(1)
                        // 🔴 動態島塞不下後端那一整句(會爆版),這裡用寫死的短標。
                        //    compact 與 minimal 刻意不動——那兩個版面連站名都只放得下兩三個字。
                        if noticeText(context.state.notice) != nil {
                            Text("資料中斷・位置為預估")
                                .font(.system(size: 10)).foregroundStyle(.orange).lineLimit(1)
                        }
                    }
                }
            } compactLeading: {
                // 站名前兩字仍是這裡最有用的資訊(compact 是最常看到的狀態),只在前面補一顆
                // 車種色點——多一個色點的成本遠低於少兩個字。
                HStack(spacing: 3) {
                    if let c = railColor(context.attributes.color) {
                        Circle().fill(c).frame(width: 6, height: 6)
                    }
                    Text(context.state.nextStop.prefix(2))
                }
            } compactTrailing: {
                Group {
                    if stopping {
                        Text("停靠").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
                    } else {
                        countdown(context.state.arrivalDate, maxWidth: 44)
                            .contentTransition(.numericText())
                    }
                }
            } minimal: {
                Text(context.attributes.trainNo.prefix(3))
            }
        }
    }
}
