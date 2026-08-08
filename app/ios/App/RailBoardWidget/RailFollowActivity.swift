import ActivityKit
import SwiftUI
import WidgetKit

private func delayText(_ sec: Int) -> String {
    if sec >= 60 { return "誤點 \(sec / 60) 分" }
    if sec <= -60 { return "早到 \(-sec / 60) 分" }
    return "準點"
}

@available(iOS 17.6, *)
struct RailFollowActivityWidget: Widget {
    // 距下一站的進度。兩端都有值才畫——系統會逐幀自走,不需要推播。
    // 🔴 ProgressView(timerInterval:) 與 Text(timerInterval:) 是【唯二】會自己動的元件;
    //    withAnimation/.repeatForever 等修飾子被系統忽略(ActivityKit 文件明文),跑馬燈做不到。
    // 🔴 修復輪次2:入參從 Date? 改 Double?(epoch 秒,對應後端 Math.floor(epochMs/1000) 送的
    //    Unix epoch)。Date 轉換收斂在這裡(唯一的 view 層),用 timeIntervalSince1970——
    //    不要用 Date(timeIntervalSinceReferenceDate:),那是 2001 年零點,對應到錯誤的年份。
    @ViewBuilder
    private func progress(_ fromSec: Double?, _ toSec: Double?) -> some View {
        let from = fromSec.map { Date(timeIntervalSince1970: $0) }
        let to = toSec.map { Date(timeIntervalSince1970: $0) }
        if let from, let to, to > from, to > Date() {
            ProgressView(timerInterval: from...to, countsDown: false)
                .labelsHidden()
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

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RailFollowAttributes.self) { context in
            // 鎖定畫面 / 橫幅
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(context.attributes.kind) \(context.attributes.trainNo)")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(context.state.nextStop).font(.headline)
                    progress(context.state.departedDate, context.state.arrivalDate)
                    Text(delayText(context.state.delaySec))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                countdown(context.state.arrivalDate, maxWidth: 88)
                    .font(.system(.title2, design: .rounded))
                    .contentTransition(.numericText())
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.trainNo).font(.caption).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    countdown(context.state.arrivalDate, maxWidth: 62).font(.caption)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("下一站 \(context.state.nextStop) · \(delayText(context.state.delaySec))")
                        .font(.caption2)
                }
            } compactLeading: {
                Text(context.state.nextStop.prefix(2))
            } compactTrailing: {
                countdown(context.state.arrivalDate, maxWidth: 44)
                    .contentTransition(.numericText())
            } minimal: {
                Text(context.attributes.trainNo.prefix(3))
            }
        }
    }
}
