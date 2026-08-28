import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 17.6, *)
struct MetroWaitActivityWidget: Widget {
    // 倒數:北捷有絕對時刻 ⇒ Text(timerInterval:) 自走;分鐘級系統只印靜態「約 N 分」。
    // 🔴 Text(timerInterval:) 與 ProgressView(timerInterval:) 是唯二會自己動的元件,
    //    withAnimation／.repeatForever 等修飾子被 ActivityKit 明文忽略。
    // 🔴 range 起點 clamp:eta 若在封存當下已過(更新晚到),ClosedRange 下界大於上界會
    //    當場 crash;min() 之後 timerInterval 自己停在 0:00,語意不變。
    @ViewBuilder
    private func countdown(eta: Double?, minutes: Int?, size: CGFloat) -> some View {
        if let eta {
            let end = Date(timeIntervalSince1970: eta)
            Text(timerInterval: min(Date(), end)...end, countsDown: true)
                .monospacedDigit().font(.system(size: size, design: .rounded))
        } else if let minutes {
            Text(RailNativeL10n.text("約 {n} 分", ["n": String(minutes)]))
                .monospacedDigit().font(.system(size: size, design: .rounded))
        }
    }

    /// 島上顯示的方向:恆為首班——到站後島上顯示「進站」,指的就是首班。
    /// 08-14 第六輪裁示起不再駁次班(次班倒數留在鎖屏,那裡的 timer 自走不需系統重繪)。
    private func islandDest(_ ctx: ActivityViewContext<MetroWaitAttributes>) -> String? {
        ctx.state.nextDest
    }

    private func tint(_ hex: String?) -> Color? {
        guard var s = hex, !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255,
                            green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }

    @ViewBuilder
    private func crowdBar(_ c: [Int]?) -> some View {
        if let c, !c.isEmpty {
            HStack(spacing: 2) {
                ForEach(Array(c.enumerated()), id: \.offset) { _, v in
                    RoundedRectangle(cornerRadius: 2).fill(MetroPalette.crowd(v))
                        .frame(width: 7, height: 11)
                }
            }
        }
        // 官方沒給就整段不畫——灰色空格會被讀成「量到了但沒人」。
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MetroWaitAttributes.self) { ctx in
            // ── 鎖定畫面 ──
            // 🔴 staleDate 到期【不會】自動變灰:ActivityKit 只把 ctx.isStale 翻成 true,
            //    視覺要自己畫。staleDate=下一班到站整點(真機回饋 08-14):
            //    isStale=「列車進站」不是「資料過期」——倒數換成綠字「進站」,
            //    次班列【保留】(絕對時刻的倒數在 stale 後照樣自走,還有用),
            //    說明文字則依 state.pushed 分兩種:接上推播的卡會自己接下一班,
            //    沒接上的要回 App 重開(見下方那段註解)。
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    if let c = tint(ctx.attributes.color) {
                        Circle().fill(c).frame(width: 9, height: 9)
                    }
                    Text(RailNativeL10n.name(ctx.attributes.lineLabel)).font(.caption).fontWeight(.semibold)
                    Text(RailNativeL10n.name(ctx.attributes.station)).font(.headline)
                    Spacer(minLength: 6)
                    if ctx.isStale {
                        Text(RailNativeL10n.text("進站")).font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
                    } else {
                        countdown(eta: ctx.state.nextEta, minutes: ctx.state.nextMinutes, size: 22)
                    }
                }
                HStack(spacing: 6) {
                    Text(RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(ctx.state.nextDest ?? "—")])).font(.caption)
                    Spacer(minLength: 6)
                    crowdBar(ctx.state.crowd)
                }
                if ctx.state.secondEta != nil || ctx.state.secondMinutes != nil {
                    HStack(spacing: 6) {
                        Text(RailNativeL10n.text("再下一班 往 {station}", ["station": RailNativeL10n.name(ctx.state.secondDest ?? "—")]))
                            .font(.caption2).foregroundStyle(.secondary)
                        Spacer(minLength: 6)
                        countdown(eta: ctx.state.secondEta, minutes: ctx.state.secondMinutes, size: 13)
                            .foregroundStyle(.secondary)
                    }
                }
                if ctx.isStale {
                    // 🔴 這句話有兩種版本,不可以只留一種:接上伺服器推播的卡會自己換下一班,
                    //    沒接上的(綁定失敗、沒網路、伺服器拒收)不會。state.pushed 只有在
                    //    伺服器真的推過一發之後才是 true——它證明的正是「推播這條路是通的」,
                    //    比任何客端旗標都可靠(客端只知道自己送出了綁定,不知道有沒有生效)。
                    Text(RailNativeL10n.text(ctx.state.pushed == true
                         ? "下一班會自動接上"
                         : "卡片不會自己接下一班，要看後續請回軌島重開"))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if let n = ctx.state.notice, !n.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text(RailNativeL10n.text(n)).font(.caption2).foregroundStyle(.orange).lineLimit(2)
                }
                HStack(spacing: 6) {
                    if let endAt = ctx.attributes.endAt {
                        Text(RailNativeL10n.text("追蹤至 {time}", [
                            "time": RailNativeL10n.time(Date(timeIntervalSince1970: endAt))
                        ]))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 6)
                    // 「結束」鈕:LiveActivityIntent 當場收卡不開 App(08-14 使用者回饋:
                    // 非得回車站看板才能關太難找)。鎖屏本來就能左滑清除,這顆給找不到滑的人。
                    Button(intent: MetroWaitEndIntent()) {
                        Text(RailNativeL10n.text("結束")).font(.system(size: 12, weight: .semibold))
                    }
                    .buttonStyle(.bordered).controlSize(.mini).tint(.secondary)
                }
            }
            // 🔴 水平邊距不能省:鎖屏 Live Activity 的內容區沒有系統預設 margins,
            //    模擬器實測「往/再下一班」兩行左緣直接被卡片圓角裁掉半個字。
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 4) {
                        if let c = tint(ctx.attributes.color) { Circle().fill(c).frame(width: 8, height: 8) }
                        Text(RailNativeL10n.name(ctx.attributes.station)).font(.caption).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // 08-14 第六輪裁示:到站(isStale)一律翻靜態綠「進站」,不駁次班倒數——
                    // 駁次班在「次班也到站」後會凍在 0:00(staleDate 只有首班那一次重繪,
                    // 次班到站沒有第二次),凍 0:00 比停在「進站」更糟。次班資訊鎖屏還在。
                    if ctx.isStale {
                        Text(RailNativeL10n.text("進站")).font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
                    } else {
                        countdown(eta: ctx.state.nextEta, minutes: ctx.state.nextMinutes, size: 18)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(islandDest(ctx) ?? "—")])).font(.caption2)
                        Spacer()
                        if !ctx.isStale { crowdBar(ctx.state.crowd) } // 擁擠度屬首班,首班走了就不掛著
                        Button(intent: MetroWaitEndIntent()) {
                            Text(RailNativeL10n.text("結束")).font(.system(size: 11, weight: .semibold))
                        }
                        .buttonStyle(.bordered).controlSize(.mini).tint(.secondary)
                    }
                }
            } compactLeading: {
                // 使用者實機回饋:動態島平常(compact)不顯示方向,等車情報就少了最關鍵的一半。
                // compact 區寬度由系統硬裁,長站名(南港展覽館)會截尾——有開頭仍比沒有好。
                HStack(spacing: 3) {
                    if let c = tint(ctx.attributes.color) { Circle().fill(c).frame(width: 8, height: 8) }
                    if let d = islandDest(ctx), !d.isEmpty {
                        Text(RailNativeL10n.text("往{station}", ["station": RailNativeL10n.name(d)]))
                            .font(.system(size: 12, weight: .medium)).lineLimit(1)
                            .frame(maxWidth: 60)
                    }
                }
            } compactTrailing: {
                if ctx.isStale {
                    Text(RailNativeL10n.text("進站")).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
                } else {
                    countdown(eta: ctx.state.nextEta, minutes: ctx.state.nextMinutes, size: 13)
                        .frame(maxWidth: 44)
                }
            } minimal: {
                if ctx.isStale {
                    Text(RailNativeL10n.text("進站")).font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
                } else {
                    countdown(eta: ctx.state.nextEta, minutes: ctx.state.nextMinutes, size: 12)
                        .frame(maxWidth: 32)
                }
            }
        }
    }
}
