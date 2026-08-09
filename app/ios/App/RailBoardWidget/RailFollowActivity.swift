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
    // 🔴 倒數只在真的有 ETA 時才畫。arrivalDate 為 nil ⇒ 整列不畫(不是畫 0、不是畫 1970)。
    @ViewBuilder
    private func countdown(_ date: Date?, maxWidth: CGFloat) -> some View {
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
                    Text(delayText(context.state.delaySec))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                countdown(context.state.arrivalDate, maxWidth: 88)
                    .font(.system(.title2, design: .rounded))
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
            } minimal: {
                Text(context.attributes.trainNo.prefix(3))
            }
        }
    }
}
