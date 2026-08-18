import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// MARK: - 版面的輸入（純值）

/// 等車卡版面吃的東西，全部是純值。
///
/// 🔴 為什麼要這一層：`ActivityViewContext` 與 `ActivityConfiguration` 都無法在算繪 harness
///    的裸執行檔裡構造 ⇒ 版面若直接讀 context，這張卡就【永遠沒有辦法在改版時被看見】
///    （改版前正是這樣：五種狀態全靠上真機才看得到）。把 context 攤平成純值之後，
///    出貨路徑與 harness 走的是同一個 `make(...)`，倒數形態與狀態詞的規則也一起被驗到。
struct MetroWaitDisplay {
    let lineLabel: String
    let station: String
    let color: Color?
    let dest: String?
    /// 主角倒數。arriving 時是 `.arriving`；資料過期時是 `.noData`。
    let countdown: RailCountdown
    /// 自走填色的區間（資料時刻…下一班到站）。算不出來時 nil，軌道退成靜態。
    let track: ClosedRange<Date>?
    /// 軌道填色比例（0…1），與 track 同一段。沒有 track 可用時與算繪 harness 用。
    let progress: Double
    let arriving: Bool
    /// 資料過期（設計稿：唯一會拿掉主角數字的狀態）⇒ 全卡降到 secondary。
    let expired: Bool
    let crowd: [Int]?
    /// 第三層那一句：「舒適 · 再下一班 往 南港展覽館 2 分」的後半段。
    let secondText: String?
    /// 底部左側：「追蹤至 12:03 · 11:33 更新」
    let footer: String?
    let notice: String?
    /// 到站後那句說明（接上推播與沒接上是兩種話，不可只留一種）。
    let staleHint: String?

    /// 資料過期的門檻。設計稿：「超過 90 秒沒有新資料就把倒數換成『暫無資料』」。
    static let expirySeconds: Double = 90

    /// 唯一的組裝入口。純值進、純值出——出貨的 ActivityConfiguration 與算繪 harness 共用它。
    static func make(
        lineLabel: String, station: String, colorHex: String?,
        nextDest: String?, nextEta: Double?, nextMinutes: Int?,
        secondDest: String?, secondEta: Double?, secondMinutes: Int?,
        crowd: [Int]?, dataAt: Double?, endAt: Double?,
        notice: String?, pushed: Bool?, isStale: Bool, now: Date
    ) -> MetroWaitDisplay {
        let nowSec = now.timeIntervalSince1970
        // 🔴 過期判定取【資料時刻】不取讀取端時鐘：後者對「被某層快取餵了舊主體」恆為新鮮，
        //    結構上不可能報壞（這個專案已經在原生用戶端吃過一次同樣的教訓）。
        let age = dataAt.map { nowSec - $0 }
        let expired = !isStale && (age.map { $0 > expirySeconds } ?? false)

        let countdown: RailCountdown
        if isStale {
            countdown = .arriving
        } else if expired {
            countdown = .noData
        } else if let eta = nextEta {
            // 北捷是官方秒級絕對時刻 ⇒ LA 可以逐秒自走（設計稿的示範就是「52 秒」）。
            countdown = RailCountdown.from(secondsLeft: eta - nowSec, surface: .liveActivity)
        } else if let m = nextMinutes {
            countdown = .approxMinutes(m)
        } else {
            countdown = .noData
        }

        var track: ClosedRange<Date>?
        var progress: Double = isStale ? 1 : 0
        if let eta = nextEta, let at = dataAt, eta > at, !isStale, !expired {
            track = Date(timeIntervalSince1970: at)...Date(timeIntervalSince1970: eta)
            progress = min(1, max(0, (nowSec - at) / (eta - at)))
        }

        // 第三層：再下一班。設計稿要它「沒有獨立倒數樣式」⇒ 一段純文字。
        // 🔴 用「再下一班」不是設計稿寫的「再下班」：後者在中文裡會先被讀成「下班」。
        var secondText: String?
        if let dest = secondDest {
            let c: RailCountdown? = secondEta.map {
                RailCountdown.from(secondsLeft: $0 - nowSec, surface: .liveActivity)
            } ?? secondMinutes.map { .approxMinutes($0) }
            if let c { secondText = "再下一班 往 \(dest) \(c.plainText)" }
        }

        var footerParts: [String] = []
        if let endAt { footerParts.append("追蹤至 \(RailBoardClock.updateTimeString(Date(timeIntervalSince1970: endAt)))") }
        if let dataAt { footerParts.append("\(RailBoardClock.updateTimeString(Date(timeIntervalSince1970: dataAt))) 更新") }

        // 🔴 這句話有兩種版本，不可以只留一種：接上伺服器推播的卡會自己換下一班，沒接上的
        //    （綁定失敗、沒網路、伺服器拒收）不會。`pushed` 只有在伺服器真的推過一發之後
        //    才是 true——它證明的正是「推播這條路是通的」，比任何客端旗標都可靠。
        let hint: String? = isStale
            ? (pushed == true ? "下一班會自動接上" : "卡片不會自己接下一班，要看後續請回軌島重開")
            : nil

        return MetroWaitDisplay(
            lineLabel: lineLabel, station: station, color: RailHex.color(colorHex),
            dest: nextDest, countdown: countdown, track: track, progress: progress,
            arriving: isStale, expired: expired, crowd: crowd,
            secondText: secondText,
            footer: footerParts.isEmpty ? nil : footerParts.joined(separator: " · "),
            notice: RailHex.trimmed(notice), staleHint: hint
        )
    }
}

// MARK: - 鎖定畫面／橫幅

/// 設計稿 E：「和跟車完全同一套：同樣的 11pt label／26pt 主體／44pt 倒數，
/// 同樣一條 2pt 軌脊。差別只在軌脊的方向意義——跟車是『我在移動』，候車是『車在靠近我』，
/// 所以候車版的終點圓點吃路線色並加白環，代表你站的位置。」
struct MetroWaitLockView: View {
    let display: MetroWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: scale.pt(4)) {
            HStack(spacing: scale.pt(6)) {
                RailLineMark(name: display.lineLabel, color: display.color,
                             fontSize: 11, scale: scale)
                Text(display.station)
                    .font(.system(size: scale.pt(15), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }

            HStack(alignment: .center, spacing: scale.pt(8)) {
                // 🔴 「下一班」跟主角同一列，不獨立一列：鎖屏 Live Activity 只有 160pt 高
                //    （官方：超過就被系統截掉），而這張卡量到 198–216pt ⇒ 使用者看到的是
                //    上下緣被切掉。跟車卡與動態島本來就是「小標＋大站名」同列。
                Text("下一班")
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.secondary)
                Text("往 \(display.dest ?? "—")")
                    .font(.system(size: scale.pt(26), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: scale.pt(4))
                RailCountdownText(value: display.countdown, size: .heroCard, scale: scale)
            }

            // 端點標籤挪到軌脊同一列的尾端——它標的就是右端那顆圓點（＝你站的位置），
            // 貼著圓點比在整列下方更接近設計意圖，也省下 18pt。
            HStack(spacing: scale.pt(6)) {
                RailSpineTrack(interval: display.track,
                               progress: display.progress,
                               phase: display.arriving ? .arriving : .running,
                               lineColor: display.color, scale: scale)
                // 進站時明講「進站中」——設計稿把狀態同時放在倒數、軌脊圓點與這裡三處。
                Text(display.arriving ? "\(display.station) 進站中" : display.station)
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(display.arriving
                                     ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                     : AnyShapeStyle(HierarchicalShapeStyle.tertiary))
                    .lineLimit(1)
            }

            // 🔴 這一列只有一位——三種內容互斥，不准疊。理由是硬的：鎖屏 Live Activity 只有
            //    160pt 高（官方：超過就被系統截掉），而主角列 52pt＋抬頭＋軌脊＋底列已經吃掉
            //    ~139pt ⇒ 全卡只剩一列的預算。優先序＝服務異常 ＞ 進站後怎麼辦 ＞ 加值資訊。
            //    每一句都保持一行（最窄 330pt 機型的可用寬 302pt，17–21 字的中文放得下），
            //    不然折行又會把上下緣吃掉。
            if let notice = display.notice {
                Text("⚠ " + notice)
                    .font(.system(size: scale.pt(11), weight: .medium))
                    .foregroundStyle(RailTokens.colors(scheme).warn)
                    .lineLimit(1).minimumScaleFactor(0.8)
            } else if let hint = display.staleHint {
                Text(hint)
                    .font(.system(size: scale.pt(11))).foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.8)
            } else if display.crowd != nil || display.secondText != nil {
                HStack(spacing: scale.pt(6)) {
                    if let c = display.crowd, !c.isEmpty {
                        RailCarriageMeter(levels: c, showWord: true, scale: scale)
                    }
                    if let second = display.secondText {
                        Text((display.crowd?.isEmpty == false ? "· " : "") + second)
                            .font(.system(size: scale.pt(13)))
                            .foregroundStyle(.secondary)
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                    Spacer(minLength: 0)
                }
            }

            HStack(spacing: scale.pt(6)) {
                if let footer = display.footer {
                    Text(footer)
                        .font(.system(size: scale.pt(11)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: scale.pt(4))
                MetroWaitEndButton(scale: scale, height: 24)
            }
        }
        // 🔴 水平邊距不能省：鎖屏 Live Activity 的內容區沒有系統預設 margins，
        //    模擬器實測左緣會被卡片圓角裁掉半個字。8pt 仍大於圓角吃掉的量
        //    （半徑 r 的圓角要求邊距 ≥ 0.293r，r=22 ⇒ 6.4pt）。
        .padding(.horizontal, scale.pt(14))
        .padding(.vertical, scale.pt(8))
        // 設計稿：資料過期時全卡降到 secondary（唯一會整卡降級的狀態）。
        .opacity(display.expired ? 0.62 : 1)
    }
}

/// 「結束」鈕：LiveActivityIntent 當場收卡不開 App（08-14 使用者回饋：非得回車站看板
/// 才能關太難找）。鎖屏本來就能左滑清除，這顆給找不到滑的人。
///
/// 🔴 為什麼單獨一個型別：LiveActivityIntent 需要 ActivityKit，算繪 harness 的裸
///    macOS 執行檔編不起來 ⇒ harness 用【同名替身】畫同一顆 RailEndButton（視覺完全相同，
///    差的只有點下去的行為，而那不是版面）。出貨端真的接了 intent，由算繪腳本的
///    intentGate() 在原始碼層驗。
struct MetroWaitEndButton: View {
    var scale: RailScale = RailScale(k: 1)
    /// 動態島用的小尺寸（島上沒有鎖屏那麼多餘裕）。
    var compact: Bool = false
    /// 膠囊高度。鎖屏那張卡的總高有 160pt 硬上限，這顆是唯一可以讓的核心列。
    var height: CGFloat = 30

    @ViewBuilder var body: some View {
        if #available(iOS 17.6, *) {
            if compact {
                Button(intent: MetroWaitEndIntent()) {
                    Text("結束").font(.system(size: scale.pt(11), weight: .semibold))
                }
                .buttonStyle(.bordered).controlSize(.mini).tint(.secondary)
            } else {
                Button(intent: MetroWaitEndIntent()) {
                    RailEndButton(scale: scale, height: height) { Text("結束") }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - 動態島

/// 展開版面的下半（主角＋軌道＋第三層＋結束）。
/// 設計稿：「四行就結束：識別、主角、進度、次要。不填滿，底部留白讓 44pt 圓角有呼吸。」
struct MetroWaitIslandBottom: View {
    let display: MetroWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    var body: some View {
        VStack(alignment: .leading, spacing: scale.pt(4)) {
            HStack(alignment: .center, spacing: scale.pt(6)) {
                Text("往 \(display.dest ?? "—")")
                    .font(.system(size: scale.pt(20), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: scale.pt(4))
                RailCountdownText(value: display.countdown, size: .row, scale: scale)
            }
            RailSpineTrack(interval: display.track,
                           progress: display.progress,
                           phase: display.arriving ? .arriving : .running,
                           lineColor: display.color, scale: scale)
            HStack(spacing: scale.pt(6)) {
                if let c = display.crowd, !c.isEmpty {
                    RailCarriageMeter(levels: c, showWord: true, scale: scale)
                }
                // 🔴 島上這一列還要塞「結束」鈕，位置比鎖屏少一截 ⇒ 車正在進站時捨棄「再下一班」
                //    而不是捨棄擁擠度：車就在眼前的那幾秒，該往哪節車廂走比下一班幾分到重要，
                //    而下一班的資訊在鎖屏那張卡上完整保留。
                if let second = display.secondText, !display.arriving {
                    // 與鎖屏那張同一個分隔符，兩處讀起來才是同一句話。
                    Text((display.crowd?.isEmpty == false ? "· " : "") + second)
                        .font(.system(size: scale.pt(12)))
                        .foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: scale.pt(4))
                MetroWaitEndButton(scale: scale, compact: true)
            }
        }
        // 🔴 展開版面的下緣是圓角，系統預設內距沒有替圓角讓路 ⇒ 最後一列會被切掉
        //    （實機 1.4.1(30) 實測）。設計稿：「expanded 的內容欄內縮 22pt，避開 44pt 圓角」。
        .padding(.horizontal, scale.pt(10))
        .padding(.bottom, scale.pt(6))
    }
}

/// minimal：只剩一顆圓。設計稿：「環的顏色＝路線色，數字＝分鐘。只剩一顆圓時仍答得出
/// 『哪條線、還有幾分』。」進站時整顆填滿——形狀本身就是狀態，不必塞字。
struct RailIslandMinimal: View {
    let countdown: RailCountdown
    let color: Color?
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme
    @Environment(\.railMonochrome) private var mono

    /// 環裡放得下的字。分鐘只放數字（單位由環的存在暗示），秒級一律當「快到了」不印秒數
    /// ——minimal 只有約 22pt，兩位數＋「秒」必截。
    private var inner: String? {
        switch countdown {
        case .minutes(let m), .approxMinutes(let m): return "\(m)"
        case .seconds:   return nil
        case .arriving:  return nil
        case .noData:    return "—"
        case .scheduled: return nil
        case .until:     return nil   // 走下面的自走 Text，不進這個靜態字串路徑
        }
    }

    var body: some View {
        let c = RailTokens.colors(scheme)
        let ring = mono ? Color.primary : (color ?? c.brand)
        ZStack {
            switch countdown {
            case .arriving, .seconds:
                // 快到了／已到＝實心。綠色是「可以上車了」，不是路線色。
                Circle().fill(mono ? Color.primary : c.ok)
            default:
                Circle().strokeBorder(ring, lineWidth: scale.pt(2))
            }
            if let inner {
                Text(inner)
                    .font(.system(size: scale.pt(11), weight: .semibold))
                    .monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            // 🔴 .until 必須也走自走路徑，否則 minimal 上的數字會跟鎖屏卡一起凍住。
            //    已知取捨：環只有約 22pt，塞不下系統給的「16分鐘」全字串 ⇒ 字級壓到 7pt
            //    再交給 minimumScaleFactor；不足一分鐘時系統自己會換成「59秒」。
            //    （不准改用自訂 FormatStyle 省字：那會讓整張卡變灰塊，見 railLiveCountdownStyle。）
            if case .until(let d) = countdown, d > Date() {
                if #available(iOS 18.0, macOS 15.0, *) {
                    Text(.currentDate, format: railLiveCountdownStyle(until: d))
                        .font(.system(size: scale.pt(7), weight: .semibold))
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                        .multilineTextAlignment(.trailing)
                } else {
                    Text(d, style: .relative)
                        .font(.system(size: scale.pt(7), weight: .semibold))
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }
}

@available(iOS 17.6, *)
struct MetroWaitActivityWidget: Widget {
    private func display(_ ctx: ActivityViewContext<MetroWaitAttributes>) -> MetroWaitDisplay {
        MetroWaitDisplay.make(
            lineLabel: ctx.attributes.lineLabel, station: ctx.attributes.station,
            colorHex: ctx.attributes.color,
            nextDest: ctx.state.nextDest, nextEta: ctx.state.nextEta,
            nextMinutes: ctx.state.nextMinutes,
            secondDest: ctx.state.secondDest, secondEta: ctx.state.secondEta,
            secondMinutes: ctx.state.secondMinutes,
            crowd: ctx.state.crowd, dataAt: ctx.state.dataAt, endAt: ctx.attributes.endAt,
            notice: ctx.state.notice, pushed: ctx.state.pushed,
            // 🔴 staleDate 到期【不會】自動變灰：ActivityKit 只把 isStale 翻成 true，視覺要
            //    自己畫。而這張卡的 staleDate 是「下一班到站整點」（RailMetroWaitPlugin）
            //    ⇒ isStale 的語意是「列車進站」，不是「資料過期」。過期是另一條路
            //    （dataAt 超過 90 秒），兩者在版面上長得不一樣。
            isStale: ctx.isStale, now: Date()
        )
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MetroWaitAttributes.self) { ctx in
            MetroWaitLockView(display: display(ctx))
        } dynamicIsland: { ctx in
            let d = display(ctx)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        RailLineMark(name: d.lineLabel, color: d.color, fontSize: 11)
                        Text(d.station).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    MetroWaitIslandBottom(display: d)
                }
            } compactLeading: {
                // 設計稿：「左：路線點＋方向（長站名截字，點不縮）」。
                HStack(spacing: 3) {
                    if let c = d.color {
                        Circle().fill(c).frame(width: 8, height: 8)
                    }
                    if let dest = d.dest, !dest.isEmpty {
                        Text("往\(dest)")
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1).frame(maxWidth: 60)
                    }
                }
            } compactTrailing: {
                // 設計稿：「右：倒數。進站時右側換成綠色『進站』」——`.arriving` 本身就是那個
                // 綠色塊，所以這裡不必分支。
                RailCountdownText(value: d.countdown, size: .minor)
                    .frame(maxWidth: 52)
            } minimal: {
                RailIslandMinimal(countdown: d.countdown, color: d.color)
            }
        }
    }
}
