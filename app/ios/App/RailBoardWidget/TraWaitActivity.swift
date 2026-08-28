import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// MARK: - 版面的輸入（純值）

/// 等站卡版面吃的東西，全部是純值。理由與 `MetroWaitDisplay` 完全相同：
/// `ActivityViewContext` 在算繪 harness 的裸執行檔裡構造不出來 ⇒ 版面若直接讀 context，
/// 這張卡就【結構上沒有辦法在改版時被看見】。出貨路徑與 harness 走同一個 `make(...)`。
///
/// 🔴 精度紅線（memory: `tra-thsr-no-official-eta`）。台鐵官方【只有】表定時刻與誤點分鐘，
///    沒有預估到站、沒有秒級倒數。所以這張卡與捷運等車卡最大的差別是：
///    **主角是一個固定的時刻（`heroText`，HH:mm），不是倒數**。
///    連帶的三件事都是刻意的，不是漏做：
///      1. 本檔【完全沒有】`RailCountdownText`／`Text(.currentDate, format:)`／
///         `Text(_, style: .relative)`／`timerInterval:` ——一個自走文字都沒有。
///         沒有自走文字，就沒有 `la-countdown-static-text-freeze` 那一族的凍住問題。
///      2. `heroText` 不吃 `now`：同一份資料在任何時刻算出來都是同一個字串。
///         這一條由算繪 harness 的 `traPrecisionGate()` 用兩個相差一小時的 now 驗。
///      3. 誤點分鐘一律照抄官方，不平滑、不內插、不猜（使用者長期裁示）。
struct TraWaitDisplay {
    /// 車種標：自強／莒光／區間…（開卡當下就定了，不會變）
    let trainType: String
    let station: String
    let color: Color?
    /// 主角左側那一句：「123 次 往 潮州」
    let lead: String
    /// 主角左上那兩個字：「實際約」或「表定」。
    /// 🔴 這一欄不是裝飾，是精度紅線的一部分。誤點未知（或資料過期）時主角退回表定本人，
    ///    而一個 34pt 的「18:32」在使用者眼裡就是「這班車 18:32 到」——那是官方沒說過的話
    ///    （官方只說了表定是 18:32，沒說它準不準）。所以主角必須自己講清楚它是哪一種值：
    ///    有官方誤點 ⇒「實際約」（表定＋誤點，兩個輸入都是官方值）；
    ///    沒有       ⇒「表定」（就只是時刻表上的那個數字）。
    let heroCaption: String
    /// 主角：實際約到站的鐘面時刻「18:35」。誤點未知時就是表定本人。
    /// 🔴 這是【時刻】不是倒數：18:35 指的是 18 點 35 分，不是「還有 18 分 35 秒」。
    let heroText: String
    /// 第三列前半：「表定 18:32」。
    /// 🔴 nil 的唯一情形是「主角本身就是表定」（誤點未知／資料過期，見 `heroCaption`）——
    ///    那時再印一次就是同一個數字並排兩份。**表定這個值本身永遠看得見**，
    ///    只是它有時住在主角那一列；算繪 harness 的 `traPrecisionGate()` 用
    ///    「表定時刻在卡上恰好出現一次」這條不變量守著，不是靠這一欄非 nil。
    let schedText: String?
    /// 第三列後半：「誤點 3 分」／「準點」／「目前無即時誤點資訊」／「誤點資訊已過期」
    let delayText: String
    let delayTone: DelayTone
    /// 誤點資訊是否已過齡（見 `TraWaitStale.delayMaxAgeSeconds`）。
    /// 過齡時主角退回表定，且整卡降到 secondary——與捷運卡的 `expired` 同一個處置。
    let expired: Bool
    /// 自走填色的區間（資料時刻…實際約到站）。算不出來時 nil，軌道退成靜態。
    /// 🔴 軌道填色【是】自走的（`ProgressView(timerInterval:)`），而主角【不是】。
    ///    兩者不衝突：填色表達的是「時間在過」這個沒有精度問題的事實，
    ///    而主角那個數字是官方值，一秒都不准自己往前跑。
    let track: ClosedRange<Date>?
    let progress: Double
    /// 系統已把卡標成 stale ＝ 實際約到站時刻已過 ＝「車應該到了」。
    /// 🔴 這裡的 isStale 語意與捷運卡一致，是「車到了」不是「資料舊了」——後者是 `expired`。
    let arrived: Bool
    /// 底部左側：「11:33 更新」
    let footer: String?
    let notice: String?
    /// 到站後那句說明（接上推播與沒接上是兩種話，不可只留一種）。
    let staleHint: String?

    /// 第三列後半的語氣。顏色由視圖決定，這裡只說是哪一種事實。
    enum DelayTone {
        /// 官方說誤點（> 0 分）
        case late
        /// 官方說準點（0 分）
        case onTime
        /// 官方沒說（不在動態窗裡、資料過舊、或整份資料拿不到）
        case unknown
    }

    /// 唯一的組裝入口。純值進、純值出。
    ///
    /// - Parameters:
    ///   - schedSec: 表定到站（epoch 秒，絕對時刻）
    ///   - delayMin: 官方誤點分鐘。**nil 與 0 是兩件事**——nil ＝ 沒有資訊，0 ＝ 準點。
    ///   - dataAt: 官方那份資料的時刻
    ///   - now: 只用來判斷資料齡與算軌道填色比例。**不參與 heroText**。
    static func make(
        trainType: String, station: String, colorHex: String?,
        trainNo: String, dest: String, schedSec: Double,
        delayMin: Int?, dataAt: Double?,
        notice: String?, pushed: Bool?, isStale: Bool, now: Date
    ) -> TraWaitDisplay {
        let nowSec = now.timeIntervalSince1970
        // 🔴 過期判定取【資料時刻】不取讀取端時鐘：後者對「被某層快取餵了舊主體」恆為新鮮，
        //    結構上不可能報壞（本專案已經在原生用戶端吃過一次同樣的教訓）。
        let age = dataAt.map { nowSec - $0 }
        let expired = age.map { $0 > TraWaitStale.delayMaxAgeSeconds } ?? false
        // 過期就不再宣稱誤點——連帶主角退回表定。這一步刻意放在最前面：底下每一件事都
        // 只看 `shown`，不再各自判斷一次過期（判斷散在多處＝遲早有一處忘了改）。
        let shown: Int? = expired ? nil : delayMin

        let sched = Date(timeIntervalSince1970: schedSec)
        // 🔴 實際約到站 ＝ 表定 ＋ 誤點。兩個輸入都是官方值 ⇒ 可以顯示。
        //    再往下一層（換算成「還有幾分幾秒」）就是在製造官方沒有的精度，絕不可以做。
        let eta = Date(timeIntervalSince1970: schedSec + Double(shown ?? 0) * 60)

        let tone: DelayTone
        let delayText: String
        if let m = shown {
            if m > 0 {
                tone = .late
                delayText = RailNativeL10n.text("誤點 {n} 分", ["n": String(m)])
            } else if m < 0 {
                tone = .late
                delayText = RailNativeL10n.text("早到 {n} 分", ["n": String(-m)])
            } else {
                tone = .onTime
                delayText = RailNativeL10n.text("準點")
            }
        } else {
            tone = .unknown
            delayText = RailNativeL10n.text(expired ? "誤點資訊已過期" : "目前無即時誤點資訊")
        }

        var track: ClosedRange<Date>?
        var progress: Double = isStale ? 1 : 0
        if let at = dataAt, eta.timeIntervalSince1970 > at, !isStale, !expired {
            track = Date(timeIntervalSince1970: at)...eta
            progress = min(1, max(0, (nowSec - at) / (eta.timeIntervalSince1970 - at)))
        }

        // 🔴 這句話有兩種版本，不可以只留一種：接上伺服器推播的卡會自己更新誤點分鐘、
        //    到站後也會自己收；沒接上的（綁定失敗、沒網路、伺服器拒收）兩件都不會。
        //    `pushed` 只有在伺服器真的推過一發之後才是 true——它證明的正是「這條路是通的」。
        let hint: String? = isStale
            ? RailNativeL10n.text(pushed == true
                                  ? "追蹤到此結束，卡片會自動關閉"
                                  : "誤點分鐘不會自己更新，要看最新請回軌島")
            : nil

        let localizedStation = RailNativeL10n.name(station)
        let localizedDestination = RailNativeL10n.name(dest)
        return TraWaitDisplay(
            trainType: RailNativeL10n.name(trainType), station: localizedStation,
            color: RailHex.color(colorHex),
            lead: RailNativeL10n.text("{trainNo} 次 往 {station}", [
                "trainNo": trainNo, "station": localizedDestination
            ]),
            // 🔴 綁在 shown 上（不是綁在 delayMin 上）：過期時 shown 是 nil、主角已經退回表定，
            //    標籤必須跟著退回「表定」，否則卡片會拿一個過期的值宣稱「實際約」。
            heroCaption: RailNativeL10n.text(shown == nil ? "表定" : "實際約"),
            heroText: RailBoardClock.updateTimeString(eta),
            schedText: shown == nil ? nil : RailNativeL10n.text("表定 {time}", [
                "time": RailBoardClock.updateTimeString(sched)
            ]),
            delayText: delayText, delayTone: tone, expired: expired,
            track: track, progress: progress, arrived: isStale,
            footer: dataAt.map { RailNativeL10n.text("{time} 更新", [
                "time": RailBoardClock.updateTimeString(Date(timeIntervalSince1970: $0))
            ]) },
            notice: RailHex.trimmed(notice).map { RailNativeL10n.text($0) }, staleHint: hint)
    }
}

// MARK: - 鎖定畫面／橫幅

/// 版面與跟車卡／等車卡同一套（11pt 標籤／26pt 主體／44pt 主角／一條 2pt 軌脊），
/// 差別只在主角是一個時刻而不是倒數，而軌脊的方向意義是「車在靠近我」（同等車卡）。
struct TraWaitLockView: View {
    let display: TraWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    private var delayColor: AnyShapeStyle {
        let c = RailTokens.colors(scheme)
        switch display.delayTone {
        case .late:    return AnyShapeStyle(c.warn)
        case .onTime:  return AnyShapeStyle(c.ok)
        case .unknown: return AnyShapeStyle(HierarchicalShapeStyle.secondary)
        }
    }

    var body: some View {
        // 🔴 列距與主角字級是【被 160pt 逼出來的】,不是美感選擇:六列全滿(車種列／主角列／
        //    軌脊列／官方值列／公告或到站說明／底列)時,鎖屏卡片超過 160pt 就會被系統截掉
        //    上下緣。算繪 harness 對「公告」與「最壞值」兩個情境有 160pt 硬 gate,
        //    往上調任何一個數字都會當場轉紅。
        VStack(alignment: .leading, spacing: scale.pt(3)) {
            HStack(spacing: scale.pt(6)) {
                RailLineMark(name: display.trainType, color: display.color,
                             fontSize: 11, scale: scale)
                Text(display.station)
                    .font(.system(size: scale.pt(15), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }

            HStack(alignment: .center, spacing: scale.pt(8)) {
                Text(display.lead)
                    .font(.system(size: scale.pt(22), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: scale.pt(4))
                // 🔴 主角是【鐘面時刻】。這裡刻意不用 RailCountdownText：那顆會畫成
                //    「數字＋單位」兩級字階（給「3 分」「52 秒」用的），而 18:35 是一個
                //    不可拆的時刻；更重要的是它承載的是倒數語意，用在這裡會讓人把
                //    「18:35」讀成「18 分 35 秒」。
                HStack(alignment: .lastTextBaseline, spacing: scale.pt(4)) {
                    Text(display.heroCaption)
                        .font(.system(size: scale.pt(11)))
                        .foregroundStyle(.secondary).lineLimit(1)
                    Text(display.heroText)
                        .font(.system(size: scale.pt(34), weight: .semibold))
                        .monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .foregroundStyle(display.arrived
                                         ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                         : AnyShapeStyle(HierarchicalShapeStyle.primary))
                }
                .fixedSize(horizontal: true, vertical: false)
            }

            HStack(spacing: scale.pt(6)) {
                RailSpineTrack(interval: display.track,
                               progress: display.progress,
                               phase: display.arrived ? .arriving : .running,
                               lineColor: display.color, scale: scale)
                // 到站那一刻明講。用「應」不是漏字：這個時刻是「表定＋官方誤點」推出來的
                // 估計值，官方沒有說過車真的到了，卡片就不可以替它宣告。
                Text(display.arrived
                     ? RailNativeL10n.text("{station} 車應已到", ["station": display.station])
                     : display.station)
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(display.arrived
                                     ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                     : AnyShapeStyle(HierarchicalShapeStyle.tertiary))
                    .lineLimit(1)
            }

            // 🔴 這一列是這張卡的良心：官方給的兩個值原文照登。主角那個 18:35 是我們算的，
            //    18:32 與「誤點 3 分」才是官方說的話——兩者並列，使用者才驗得了我們。
            //    ⚠️ 三種語氣（誤點／準點／沒有資訊）必須在畫面上真的不一樣，
            //    「沒有資訊」尤其不可以長得像「準點」（那是宣稱一個官方沒說過的事實）。
            HStack(spacing: 0) {
                if let sched = display.schedText {
                    Text(sched + " · ")
                        .font(.system(size: scale.pt(13)))
                        .foregroundStyle(.secondary)
                }
                Text(display.delayText)
                    .font(.system(size: scale.pt(13), weight: .medium))
                    .foregroundStyle(delayColor)
                Spacer(minLength: 0)
            }
            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)

            // 🔴 只有一位——理由同等車卡：鎖屏 Live Activity 只有 160pt 高，超過就被系統截掉。
            //    優先序＝服務異常 ＞ 到站後怎麼辦。
            if let notice = display.notice {
                Text("⚠ " + notice)
                    .font(.system(size: scale.pt(11), weight: .medium))
                    .foregroundStyle(RailTokens.colors(scheme).warn)
                    .lineLimit(1).minimumScaleFactor(0.8)
            } else if let hint = display.staleHint {
                Text(hint)
                    .font(.system(size: scale.pt(11))).foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }

            HStack(spacing: scale.pt(6)) {
                if let footer = display.footer {
                    Text(footer)
                        .font(.system(size: scale.pt(11)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: scale.pt(4))
                TraWaitEndButton(scale: scale, height: 24)
            }
        }
        // 水平邊距不能省：鎖屏 LA 的內容區沒有系統預設 margins（見等車卡的同一條註解）。
        .padding(.horizontal, scale.pt(14))
        .padding(.vertical, scale.pt(7))
        .opacity(display.expired ? 0.62 : 1)
    }
}

/// 「結束」鈕：LiveActivityIntent 當場收卡不開 App。與等車卡同一顆 `RailEndButton`。
///
/// 🔴 單獨一個型別的理由同 `MetroWaitEndButton`：LiveActivityIntent 需要 ActivityKit，
///    算繪 harness 的裸 macOS 執行檔編不起來 ⇒ harness 用同名替身畫同一顆按鈕，
///    intent 有沒有真的接上由算繪腳本的 `intentGate()` 在原始碼層驗。
struct TraWaitEndButton: View {
    var scale: RailScale = RailScale(k: 1)
    var compact: Bool = false
    var height: CGFloat = 30

    @ViewBuilder var body: some View {
        if #available(iOS 17.6, *) {
            if compact {
                Button(intent: TraWaitEndIntent()) {
                    Text(RailNativeL10n.text("結束")).font(.system(size: scale.pt(11), weight: .semibold))
                }
                .buttonStyle(.bordered).controlSize(.mini).tint(.secondary)
            } else {
                Button(intent: TraWaitEndIntent()) {
                    RailEndButton(scale: scale, height: height) { Text(RailNativeL10n.text("結束")) }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - 動態島

/// 展開版面的下半（主角＋軌道＋官方兩值＋結束）。
struct TraWaitIslandBottom: View {
    let display: TraWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: scale.pt(4)) {
            HStack(alignment: .center, spacing: scale.pt(6)) {
                Text(display.lead)
                    .font(.system(size: scale.pt(17), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: scale.pt(4))
                HStack(alignment: .lastTextBaseline, spacing: scale.pt(3)) {
                    Text(display.heroCaption)
                        .font(.system(size: scale.pt(10)))
                        .foregroundStyle(.secondary).lineLimit(1)
                    Text(display.heroText)
                        .font(.system(size: scale.pt(24), weight: .semibold))
                        .monospacedDigit().lineLimit(1)
                        .foregroundStyle(display.arrived
                                         ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                         : AnyShapeStyle(HierarchicalShapeStyle.primary))
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            RailSpineTrack(interval: display.track,
                           progress: display.progress,
                           phase: display.arrived ? .arriving : .running,
                           lineColor: display.color, scale: scale)
            HStack(spacing: 0) {
                if let sched = display.schedText {
                    Text(sched + " · ")
                        .font(.system(size: scale.pt(12))).foregroundStyle(.secondary)
                }
                Text(display.delayText)
                    .font(.system(size: scale.pt(12), weight: .medium))
                    .foregroundStyle(display.delayTone == .late
                                     ? AnyShapeStyle(RailTokens.colors(scheme).warn)
                                     : (display.delayTone == .onTime
                                        ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                        : AnyShapeStyle(HierarchicalShapeStyle.secondary)))
                Spacer(minLength: scale.pt(4))
                TraWaitEndButton(scale: scale, compact: true)
            }
            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
        }
        // 展開版面的下緣是圓角，系統預設內距沒有替圓角讓路 ⇒ 最後一列會被切掉。
        .padding(.horizontal, scale.pt(10))
        .padding(.bottom, scale.pt(6))
    }
}

/// minimal：只剩一顆圓。
///
/// 🔴 這裡【不畫數字】，與等車卡的 `RailIslandMinimal` 刻意不同：那顆圓約 22pt，
///    塞得下「3」這種分鐘數，塞不下「18:35」這種時刻；而把時刻截成「18」或「35」
///    都會被讀成別的意思。所以這一顆只答「車種色 ＋ 到了沒有」，
///    形狀本身就是狀態（空心＝還沒到、實心綠＝車應已到）。
struct TraWaitIslandMinimal: View {
    let arrived: Bool
    let color: Color?
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    var body: some View {
        let c = RailTokens.colors(scheme)
        let ring = mono ? Color.primary : (color ?? c.brand)
        ZStack {
            if arrived {
                Circle().fill(mono ? Color.primary : c.ok)
            } else {
                Circle().strokeBorder(ring, lineWidth: scale.pt(2))
            }
        }
    }
}

@available(iOS 17.6, *)
struct TraWaitActivityWidget: Widget {
    private func display(_ ctx: ActivityViewContext<TraWaitAttributes>) -> TraWaitDisplay {
        TraWaitDisplay.make(
            trainType: ctx.attributes.trainType, station: ctx.attributes.station,
            colorHex: ctx.attributes.color,
            trainNo: ctx.attributes.trainNo, dest: ctx.attributes.dest,
            schedSec: ctx.attributes.schedSec,
            delayMin: ctx.state.delayMin, dataAt: ctx.state.dataAt,
            notice: ctx.state.notice, pushed: ctx.state.pushed,
            // 🔴 這張卡的 staleDate 是「實際約到站時刻」（RailTraWaitPlugin／worker 的
            //    stale-date 同一個值）⇒ isStale 的語意是「車應該到了」，不是「資料過期」。
            //    過期是另一條路（dataAt 超過 30 分鐘），兩者在版面上長得不一樣。
            isStale: ctx.isStale, now: Date())
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TraWaitAttributes.self) { ctx in
            TraWaitLockView(display: display(ctx))
        } dynamicIsland: { ctx in
            let d = display(ctx)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        RailLineMark(name: d.trainType, color: d.color, fontSize: 11)
                        Text(d.station).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TraWaitIslandBottom(display: d)
                }
            } compactLeading: {
                HStack(spacing: 3) {
                    if let c = d.color {
                        Circle().fill(c).frame(width: 8, height: 8)
                    }
                    Text(d.station)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1).frame(maxWidth: 52)
                }
            } compactTrailing: {
                // 右側是到站時刻，不是倒數。窄，但 5 個等寬數字塞得下。
                Text(d.heroText)
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit().lineLimit(1)
                    .frame(maxWidth: 46)
            } minimal: {
                TraWaitIslandMinimal(arrived: d.arrived, color: d.color)
            }
        }
    }
}
