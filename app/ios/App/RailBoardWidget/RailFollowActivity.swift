import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - 版面的輸入（純值）

/// 跟車卡版面吃的東西，全部是純值（理由見 MetroWaitDisplay 的型別註解：
/// ActivityViewContext 在算繪 harness 裡構造不出來，版面直接讀 context 就等於永遠看不見）。
struct RailFollowDisplay {
    let kind: String
    let trainNo: String
    let color: Color?
    let inkColor: Color?
    let terminus: String
    /// 「下一站」／「目前」——停靠中時車就在這一站，叫它「下一站」是錯的。
    let stopLabel: String
    let stopName: String
    /// 主角倒數。停靠中是 nil（車已經到了，沒有倒數可言）。
    let countdown: RailCountdown?
    /// 誤點分鐘（0＝準點、負＝早到）。固定放第一行最右，13pt 文字、不做膠囊。
    let delayMinutes: Int
    let track: ClosedRange<Date>?
    /// 軌道填色比例（0…1），與 track 同一段。給沒有 track 可用時與算繪 harness 用。
    let progress: Double
    let phase: RailSpineTrack.Phase
    /// 軌道左端：「臺北 11:35」（上一站＋發車時刻）。始發站時 nil，該處留白不畫佔位符。
    let originLabel: String?
    /// 軌道右端：「板橋 11:42」（下一站＋預計到站）。算不出 ETA 時只有站名。
    let targetLabel: String
    /// 底部狀態詞：行駛中／即將進站／停靠中／資料未更新。
    let stateWord: String
    /// 資料過期（見 staleGraceSeconds）⇒ 全卡降到 62%，與候車卡同一條規則。
    let expired: Bool
    let notice: String?

    /// 即將進站的門檻。臺鐵的 ETA 是分鐘級（TDX），畫秒數是假精度 ⇒ 不足一分鐘一律
    /// 收斂成「進站」，與 widget 那一側同一條分界（RailCountdown.Surface.widget）。
    static let arrivingSeconds: Double = 60

    /// 資料過期的寬限。定義與理由在 `RailFollowStale`（那個檔同屬 App 與 widget 兩個 target，
    /// 所以「設 staleDate 的人」與「畫過期樣式的人」拿的是同一個值）。
    static var staleGraceSeconds: Double { RailFollowStale.graceSeconds }

    static func make(
        kind: String, trainNo: String, colorHex: String?, terminus: String,
        nextStop: String, prevStop: String?,
        arrivalDate: Double?, departedDate: Double?,
        delaySec: Int, stopping: Bool, notice: String?, isStale: Bool, now: Date
    ) -> RailFollowDisplay {
        let nowSec = now.timeIntervalSince1970
        let left = arrivalDate.map { $0 - nowSec }

        // 過期的兩條路，任一成立就算過期：
        // 1. `isStale`：ActivityKit 依 staleDate 翻的旗標。🔴 它才是【零推播】情境唯一有效的
        //    那一條——下面第 2 條要「有人重繪」才會被算到一次，而零推播正好就是沒有重繪
        //    （實機症狀：到站時刻過去之後，卡片停在「0 秒／行駛中」直到下一發推播進來）。
        //    staleDate 到期會讓系統主動重繪一次，這個分支就是那一次重繪要顯示的東西。
        // 2. 到站時刻早就過去（代理指標，見 RailFollowStale.graceSeconds）：涵蓋
        //    「有在重繪、但手上內容已經舊了」，例如前景每分鐘 update 卻拿不到新 ETA。
        //    刻意保留兩條而不是只留 isStale：staleDate 是 nil 的舊卡（App 更新前開的）沒有第 1 條。
        let stale = isStale || (!stopping && (left.map { $0 < -RailFollowStale.graceSeconds } ?? false))

        let countdown: RailCountdown?
        if stopping {
            countdown = nil
        } else if stale {
            // 設計稿：唯一會拿掉主角數字的狀態。凍住的「0 分」比空白更糟——它看起來還在跑。
            countdown = .noData
        } else if let left, let a = arrivalDate {
            // 🔴 分界仍是 60 秒（＝`.widget` 那條）：**不是**因為這裡是 widget，而是因為臺鐵 ETA
            //    只有分鐘級，不足一分鐘顯示「37 秒」等於把 ±2 分的推估講成秒級精度。
            // 🔴 ≥60 秒交給 `.until`（自走）而不是 `.minutes`（算好的死數字）：
            //    這張卡在交班給伺服器之後就沒有本機 update 了，而伺服器「四個量都沒變就不推」
            //    ⇒ 準點車跑完整段可以零推播。`.minutes` 會凍在最後一次推播算出的分鐘數，
            //    旁邊的進度條卻自己爬到 90%——使用者實機回報的正是這個畫面。
            //    <60 秒維持 `.arriving`：實心「進站」色塊是重繪時才畫得出的形態（見 railLiveCountdownStyle）。
            countdown = left < arrivingSeconds ? .arriving
                                               : .until(Date(timeIntervalSince1970: a))
        } else {
            // 算不出 ETA ⇒ 不畫 0、不畫 1970，整個倒數不出現。
            countdown = nil
        }

        let phase: RailSpineTrack.Phase
        if stopping { phase = .stopping }
        else if stale { phase = .running }   // 過期不准畫成「即將進站」的綠點
        else if let left, left < arrivingSeconds { phase = .arriving }
        else { phase = .running }

        var track: ClosedRange<Date>?
        var progress: Double = 0
        if let from = departedDate, let to = arrivalDate, to > from {
            track = Date(timeIntervalSince1970: from)...Date(timeIntervalSince1970: to)
            progress = min(1, max(0, (nowSec - from) / (to - from)))
        } else if arrivalDate != nil {
            // 只有到站時刻、沒有上一站發車時刻（始發站）：填色沒有起點可算，不假造中間值。
            progress = stopping ? 1 : 0
        }
        if stale { track = nil }   // 過期就不要那條會自己走的填色條，它會繼續往前爬

        // 🔴 軌道畫的是【上一站 → 下一站】這一段，不是設計稿那條「起站 → 終點」的全程線：
        //    全程線要起站發車與終點到達兩個時刻，卡片的 state 裡沒有（只有 departedDate
        //    與 arrivalDate 這一段）。畫成全程等於把一段的進度謊稱成全程的進度。
        //    終點站的名字沒有損失——它就在第一行「往 臺東」那裡。
        let originLabel: String? = prevStop.map { name in
            let localizedName = RailNativeL10n.name(name)
            guard let d = departedDate else { return localizedName }
            return "\(localizedName) \(RailBoardClock.updateTimeString(Date(timeIntervalSince1970: d)))"
        }
        let localizedNextStop = RailNativeL10n.name(nextStop)
        var targetLabel = localizedNextStop
        if let a = arrivalDate {
            let t = RailBoardClock.updateTimeString(Date(timeIntervalSince1970: a))
            targetLabel = stopping
                ? RailNativeL10n.text("{station} {time} 到", ["station": localizedNextStop, "time": t])
                : "\(localizedNextStop) \(t)"
        }

        let word: String
        if stale {
            // 不寫「行駛中」——那是在宣稱一件我們已經不知道的事。
            word = RailNativeL10n.text("資料未更新")
        } else {
            switch phase {
            case .stopping: word = RailNativeL10n.text("停靠中")
            case .arriving: word = RailNativeL10n.text("即將進站")
            case .running:  word = RailNativeL10n.text("行駛中")
            }
        }

        return RailFollowDisplay(
            kind: RailNativeL10n.name(kind), trainNo: trainNo,
            color: RailHex.color(colorHex), inkColor: RailHex.ink(colorHex),
            terminus: RailNativeL10n.name(terminus),
            stopLabel: RailNativeL10n.text(stopping ? "目前" : "下一站"),
            stopName: localizedNextStop,
            countdown: countdown, delayMinutes: delaySec / 60,
            track: track, progress: progress, phase: phase,
            originLabel: originLabel, targetLabel: targetLabel,
            stateWord: word, expired: stale,
            notice: RailHex.trimmed(notice).map { RailNativeL10n.text($0) }
        )
    }
}

// MARK: - 鎖定畫面／橫幅

/// 設計稿 D：「狀態差異只做在三個地方：倒數的形態、軌脊上列車點的形狀、底部狀態詞。
/// 位置與版面完全不動，所以連續看不會跳。」
/// 「誤點固定放在第一行最右，永遠是 13pt 橘色文字，不做膠囊、不進主角區。」
struct RailFollowLockView: View {
    let display: RailFollowDisplay
    var scale: RailScale = RailScale(k: 1)

    var body: some View {
        VStack(alignment: .leading, spacing: scale.pt(4)) {
            HStack(spacing: scale.pt(6)) {
                RailTrainMark(kind: display.kind, number: display.trainNo,
                              color: display.color, fontSize: 12, numberSize: 15, scale: scale)
                Text(RailNativeL10n.text("往 {station}", ["station": display.terminus]))
                    .font(.system(size: scale.pt(13)))
                    .foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: scale.pt(4))
                RailStatusTag(kind: .delay(display.delayMinutes), fontSize: 13, scale: scale)
            }

            HStack(alignment: .center, spacing: scale.pt(8)) {
                // 🔴 `stopLabel`（下一停靠站／終點站…）刻意跟站名同一列，不獨立一列：
                //    鎖屏 Live Activity 只有 160pt 高（官方：超過就被系統截掉），而這張卡
                //    量到 162–180pt ⇒ 使用者看到的是上下緣被切掉。動態島那版本來就是這樣排
                //    （見下方 RailFollowIslandBottom），兩處一致。
                Text(display.stopLabel)
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.secondary)
                Text(display.stopName)
                    .font(.system(size: scale.pt(26), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: scale.pt(4))
                if let c = display.countdown {
                    RailCountdownText(value: c, size: .heroCard, scale: scale)
                } else if display.phase == .stopping {
                    // 停靠中沒有倒數，但整列抽掉會讓版面在進站那一瞬間塌一列 ⇒ 用同一個
                    // 實心色塊承接（RailCountdownText 的 .arriving 就是設計稿唯一的實心形態）。
                    RailCountdownText(value: .arriving, size: .heroCard,
                                      arrivingWord: "停靠中", scale: scale)
                }
            }

            RailSpineTrack(interval: display.track,
                           progress: display.progress,
                           phase: display.phase,
                           lineColor: display.color, scale: scale)

            HStack(spacing: scale.pt(8)) {
                Text(display.originLabel ?? "")
                Spacer(minLength: scale.pt(6))
                Text(display.targetLabel)
            }
            .font(.system(size: scale.pt(11)))
            .foregroundStyle(.tertiary)
            .monospacedDigit()
            .lineLimit(1)

            // 狀態詞與通知同一列：兩者都是 11pt 的一句話，分兩列會讓有通知的狀態多吃 18pt，
            // 那正是 160pt 上限唯一守不住的狀態（量到 180pt）。狀態詞短、通知長，通知吃剩下的寬。
            HStack(alignment: .firstTextBaseline, spacing: scale.pt(6)) {
                Text(display.stateWord)
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.secondary)
                if let notice = display.notice {
                    // 🔴 文案整句由後端決定（改字不必重出 App）。
                    Text("⚠ " + notice)
                        .font(.system(size: scale.pt(11), weight: .medium))
                        .foregroundStyle(.orange)
                        .lineLimit(2).minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, scale.pt(14))
        .padding(.vertical, scale.pt(10))
        // 設計稿：資料過期時「整張卡降到 secondary」。與候車卡同一個值，不然同一件事在兩張卡上
        // 長得不一樣，使用者要學兩次。
        .opacity(display.expired ? 0.62 : 1)
    }
}

// MARK: - 動態島

struct RailFollowIslandBottom: View {
    let display: RailFollowDisplay
    var scale: RailScale = RailScale(k: 1)

    var body: some View {
        VStack(alignment: .leading, spacing: scale.pt(4)) {
            HStack(alignment: .center, spacing: scale.pt(6)) {
                Text(display.stopLabel)
                    .font(.system(size: scale.pt(10)))
                    .foregroundStyle(.secondary)
                Text(display.stopName)
                    .font(.system(size: scale.pt(19), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: scale.pt(4))
                if let c = display.countdown {
                    RailCountdownText(value: c, size: .row, scale: scale)
                } else if display.phase == .stopping {
                    RailCountdownText(value: .arriving, size: .row,
                                      arrivingWord: "停靠", scale: scale)
                }
            }
            RailSpineTrack(interval: display.track,
                           progress: display.progress,
                           phase: display.phase,
                           lineColor: display.color, scale: scale)
            HStack(spacing: scale.pt(8)) {
                Text(display.originLabel ?? "")
                Spacer(minLength: scale.pt(6))
                Text(display.targetLabel)
            }
            .font(.system(size: scale.pt(10)))
            .foregroundStyle(.tertiary)
            .monospacedDigit().lineLimit(1)
            if display.notice != nil {
                // 🔴 動態島塞不下後端那一整句（會爆版），這裡用寫死的短標。
                //    compact 與 minimal 刻意不動——那兩個版面連站名都只放得下兩三個字。
                Text(RailNativeL10n.text("⚠ 資料中斷・位置為預估"))
                    .font(.system(size: scale.pt(10)))
                    .foregroundStyle(.orange).lineLimit(1)
            }
        }
        // 🔴 展開版面四角沒有 system 安全內距；三張 Live Activity 統一退到 22pt 安全線，
        //    避免長站名與外語文字進入圓角斜切區。
        .padding(.horizontal, scale.pt(22))
        .padding(.bottom, scale.pt(6))
    }
}

@available(iOS 17.6, *)
struct RailFollowActivityWidget: Widget {
    private func display(_ ctx: ActivityViewContext<RailFollowAttributes>) -> RailFollowDisplay {
        RailFollowDisplay.make(
            kind: ctx.attributes.kind, trainNo: ctx.attributes.trainNo,
            colorHex: ctx.attributes.color, terminus: ctx.state.terminus,
            nextStop: ctx.state.nextStop, prevStop: ctx.state.prevStop,
            arrivalDate: ctx.state.arrivalDate, departedDate: ctx.state.departedDate,
            delaySec: ctx.state.delaySec, stopping: ctx.state.stopping ?? false,
            notice: ctx.state.notice,
            // 🔴 這張卡的 staleDate 是「預計到站＋寬限」（RailLiveActivityPlugin／worker 兩側
            //    都送同一個值）⇒ isStale 的語意就是「資料過期」。候車卡的 staleDate 是
            //    「下一班到站整點」，那裡的 isStale 語意是「列車進站」——兩張卡不可互抄。
            isStale: ctx.isStale, now: Date()
        )
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RailFollowAttributes.self) { ctx in
            RailFollowLockView(display: display(ctx))
                .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { ctx in
            let d = display(ctx)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RailTrainMark(kind: d.kind, number: d.trainNo, color: d.color,
                                  fontSize: 11, numberSize: 13)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RailStatusTag(kind: .delay(d.delayMinutes), fontSize: 11)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    RailFollowIslandBottom(display: d)
                }
            } compactLeading: {
                // 站名前兩字仍是這裡最有用的資訊（compact 是最常看到的狀態），前面補一顆
                // 車種色點——多一個色點的成本遠低於少兩個字。
                HStack(spacing: 3) {
                    if let c = d.color {
                        Circle().fill(c).frame(width: 6, height: 6)
                    }
                    Text(RailNativeL10n.name(d.stopName).prefix(2))
                }
            } compactTrailing: {
                Group {
                    if let c = d.countdown {
                        RailCountdownText(value: c, size: .minor)
                    } else if d.phase == .stopping {
                        RailCountdownText(value: .arriving, size: .minor, arrivingWord: RailNativeL10n.text("停靠"))
                    }
                }
                .frame(maxWidth: 52)
            } minimal: {
                // 2026-08-10 使用者裁示：「車站倒數才是重點」⇒ minimal 只留倒數那一顆圓
                // （設計稿：「環的顏色＝路線色，數字＝分鐘」）。
                RailIslandMinimal(countdown: d.countdown ?? .arriving, color: d.color)
            }
        }
    }
}
