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
    /// 第三層那一句：「舒適 · 再下一班 往 南港展覽館 2 分鐘」的後半段。
    let second: SecondTrain?

    /// 第三層那一句拆成兩塊：「再下一班 往 南港展覽館」＋倒數。
    ///
    /// 🔴 為什麼不再是一整串 String（改版前是）：那個倒數也必須會自走。字串在被組出來的
    ///    那一刻就凍住了，而這張卡在交班給伺服器之後【可以整段沒有任何推播】——
    ///    worker 的 `mwShouldPush` 對 eta 有 20 秒遲滯（scripts/metro_wait_core.mjs），
    ///    綁定失敗（沒網路／伺服器拒收）時更是零推播。要自走就只能交給 Text 自己算，
    ///    而 Text 拿到的必須是【絕對到站時刻】而不是拼好的句子。
    /// 🔴 也【不可以】用 `Text(前綴) + Text(.currentDate, format:)` 把它串回一句：
    ///    WidgetKit 的自走時間文字不支援 `+`，串起來會退化成組字當下的靜態快照
    ///    ——那正是這次要修的東西。畫法見 `MetroWaitSecondLine`。
    struct SecondTrain: Equatable {
        /// 「再下一班 往 南港展覽館」
        let lead: String
        /// 句尾的倒數。設計稿：第三層「沒有獨立倒數樣式」⇒ 由 `MetroWaitSecondLine` 畫成
        /// 句子裡的一段字，不走 `RailCountdownText`（那個會畫實心色塊與兩級字階）。
        let countdown: RailCountdown
    }
    /// 底部左側：「追蹤至 12:03 · 11:33 更新」
    let footer: String?
    let notice: String?
    /// 到站後那句說明（接上推播與沒接上是兩種話，不可只留一種）。
    let staleHint: String?
    /// 進站軌道（B 方案：上一站 → 本站站名牌，車畫在軌道上）。nil ⇒ 退回原本的軌脊版面
    /// ——分鐘級系統（高捷／機捷）沒有秒級到站時刻推不出位置，以及解不出上一站的少數站
    /// （見 `MetroWidgetCatalog.waitHop`）。兩種都【不畫車】，不偽造位置。
    let trackB: TrackB?

    /// 進站軌道的純值。車的位置只在算繪當下算一次（見 `Car`）。
    struct TrackB: Equatable {
        /// 🔴 Live Activity 裡的圖片不會自己移動（能自走的只有 `ProgressView(timerInterval:)`
        ///    與時間文字），所以車【只在收到推播重繪時】往前挪一格；路線色那段也改成跟車同一個
        ///    靜態比例，不再用自走填色——自走填色會跑到車前面，看起來像車被丟下。倒數文字照舊自走。
        enum Car: Equatable {
            /// 不畫車：沒接上推播（車會停在開卡那一刻不動，等於說謊）或資料過期。
            case none
            /// 行駛中（或還停在上一站＝0）：車頭在「上一站 → 本站」的比例。
            case running(Double)
            /// 還沒到上一站：畫在左側虛線段上，車頭不碰上一站。
            case far
            /// 進站：車頭對齊本站。
            case arrived
        }
        let prev: String
        let car: Car
        /// 正側面車模 asset `la-side-<carModel>`，寬高比 carAspect。
        let carModel: String
        let carAspect: Double
        /// 站名牌帶子上的線名（下一班那條線）；解不出來就只留色。
        let lineName: String?
        /// 路線色：站名牌帶子、還沒走完的那段、本站圓點。
        let color: Color?
        /// 上一站站名後面的小字（台鐵等站卡：「21:19 開」＝上一站表定開車；捷運沒有）。
        var prevSub: String? = nil
        /// 站名牌帶子改寫本站的鄰站（台鐵站牌「◀ 萬華　松山 ▶」，帶子用站牌本色不用路線色）。
        /// nil＝捷運那種「線名＋路線色」帶子。
        var plateNeighbours: PlateNeighbours? = nil

        /// 本站在實體路線上的兩個鄰站：left＝車開過來的那一側，right＝車要去的那一側（終點站沒有）。
        struct PlateNeighbours: Equatable {
            let left: String?
            let right: String?
        }
    }

    /// 資料過期的門檻。設計稿：「超過 90 秒沒有新資料就把倒數換成『暫無資料』」。
    static let expirySeconds: Double = 90

    /// 唯一的組裝入口。純值進、純值出——出貨的 ActivityConfiguration 與算繪 harness 共用它。
    static func make(
        lineLabel: String, station: String, colorHex: String?,
        nextDest: String?, nextEta: Double?, nextMinutes: Int?,
        secondDest: String?, secondEta: Double?, secondMinutes: Int?,
        crowd: [Int]?, dataAt: Double?, endAt: Double?,
        notice: String?, pushed: Bool?, isStale: Bool, now: Date,
        tick: Double? = nil, hop: MetroWaitHop? = nil
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
            // 🔴 交給 `.until`（錨定絕對到站時刻、由系統自走）而不是 `.from(secondsLeft:)`
            //    （在組 ContentState 的那一刻折成 `.seconds(52)`／`.minutes(3)` 的死數字）：
            //    Live Activity 的視圖只在收到新 ContentState 時重繪一次，而這張卡的更新
            //    全靠伺服器推播——`mwShouldPush` 對 eta 有 20 秒遲滯，綁定失敗時是零推播，
            //    App 又不在背景做任何事 ⇒ 鎖屏上那個「52 秒」會整段不動。
            //    （worker 的遲滯本身是對的：它的註解寫著「卡片的 Text(timerInterval:)
            //     本來就自己在走」——08-17 小工具改版把自走文字換成靜態字串之後，
            //     那個前提才失效。修在客戶端，不要去改成每分鐘硬推。）
            //    不足一分鐘系統自己會換成「52 秒」，不必也不可以在這裡分支
            //    （分支＝又把它折回死數字）。到站時刻已過由 RailCountdownText 畫「進站」。
            countdown = .until(Date(timeIntervalSince1970: eta))
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

        // 第三層：再下一班。設計稿要它「沒有獨立倒數樣式」⇒ 讀起來是一句話
        // （但畫的時候是前綴＋倒數兩個 Text，理由見 SecondTrain）。
        // 🔴 用「再下一班」不是設計稿寫的「再下班」：後者在中文裡會先被讀成「下班」。
        var second: SecondTrain?
        if let dest = secondDest {
            // 🔴 與主角同一個理由走 `.until`：次班的 eta 也是官方絕對時刻，折成字串就會凍住。
            let c: RailCountdown? = secondEta.map { RailCountdown.until(Date(timeIntervalSince1970: $0)) }
                ?? secondMinutes.map { RailCountdown.approxMinutes($0) }
            if let c {
                second = SecondTrain(
                    lead: RailNativeL10n.text("再下一班 往 {station}", ["station": RailNativeL10n.name(dest)]),
                    countdown: c
                )
            }
        }

        var footerParts: [String] = []
        if let endAt {
            footerParts.append(RailNativeL10n.text("追蹤至 {time}", [
                "time": RailBoardClock.updateTimeString(Date(timeIntervalSince1970: endAt))
            ]))
        }
        if let dataAt {
            footerParts.append(RailNativeL10n.text("{time} 更新", [
                "time": RailBoardClock.updateTimeString(Date(timeIntervalSince1970: dataAt))
            ]))
        }

        // 🔴 這句話有兩種版本，不可以只留一種：接上伺服器推播的卡會自己換下一班，沒接上的
        //    （綁定失敗、沒網路、伺服器拒收）不會。`pushed` 只有在伺服器真的推過一發之後
        //    才是 true——它證明的正是「推播這條路是通的」，比任何客端旗標都可靠。
        let hint: String? = isStale
            ? RailNativeL10n.text(pushed == true ? "下一班會自動接上" : "卡片不會自己接下一班，要看後續請回軌島重開")
            : nil

        // 進站軌道：車的位置＝官方倒數推回（剩餘秒數 ÷ 上一站到本站的行駛秒）。
        // 🔴 車只在 pushed == true 時畫：那是「伺服器真的推過一發」的證據，之後每次推播都會重繪、
        //    車跟著往前挪。nil（剛開卡、綁定還沒完成或失敗）時畫了車，綁定一旦失敗就再也不會重繪，
        //    車會停在開卡那一刻的位置而倒數照走——那正是要避免的「停住的車騙人」。代價是開卡後
        //    第一發推播前（最多約一分鐘）只有軌道沒有車。
        var trackB: TrackB?
        if let hop {
            let car: TrackB.Car
            if pushed != true || expired {
                car = .none
            } else if isStale {
                car = .arrived
            } else if let eta = nextEta {
                // 🔴 剩餘秒數取【這一發推播的時刻】不取重繪時刻：系統會替同一份 ContentState 在不同時間
                //    各算一張快照（淺／深色、切外觀），用 Date() 會讓同一次更新的車停在不同位置、甚至倒退
                //    （09-23 模擬器實見：已畫到站牌的車，切回淺色後退到 0.83）。
                //    取 tick 不取 dataAt：進站窗內伺服器每 30 秒推一發（2026-09-23 裁示「那就改30秒吧」），
                //    北捷看板的 dataAt 卻不一定每 30 秒換 ⇒ 用 dataAt 兩發之間車會停在原地。
                //    舊伺服器不送 tick（nil）⇒ 退回 eta − dataAt（官方看板當下的倒數），與改版前一樣。
                //    過期判定仍看 dataAt（上面的 expired），tick 只管車畫在哪。
                let left = eta - (tick ?? dataAt ?? nowSec)
                if left <= 0 { car = .arrived }
                else if left <= hop.runSec { car = .running(1 - left / hop.runSec) }
                // 倒數落在 (行駛, 行駛＋停站]：車還停在上一站，車頭貼著上一站。
                else if left <= hop.runSec + hop.dwellSec { car = .running(0) }
                else { car = .far }
            } else {
                car = .none
            }
            trackB = TrackB(prev: RailNativeL10n.name(hop.prev), car: car,
                            carModel: hop.carModel, carAspect: hop.carAspect,
                            lineName: hop.lineName.map { RailNativeL10n.name($0) },
                            color: RailHex.color(hop.colorHex) ?? RailHex.color(colorHex))
        }

        return MetroWaitDisplay(
            lineLabel: RailNativeL10n.name(lineLabel), station: RailNativeL10n.name(station), color: RailHex.color(colorHex),
            dest: nextDest.map { RailNativeL10n.name($0) }, countdown: countdown, track: track, progress: progress,
            arriving: isStale, expired: expired, crowd: crowd,
            second: second,
            footer: footerParts.isEmpty ? nil : footerParts.joined(separator: " · "),
            notice: RailHex.trimmed(notice).map { RailNativeL10n.text($0) }, staleHint: hint,
            trackB: trackB
        )
    }
}

/// 第三層那一句：「· 再下一班 往 南港展覽館 2 分」。鎖屏與動態島展開版共用。
///
/// 🔴 這裡是 HStack 拼句子，不是一個 Text——倒數那一段必須是【獨立的一個 Text】才會自走，
///    而 WidgetKit 的自走時間文字不支援 `+` 串接（見 `MetroWaitDisplay.SecondTrain`）。
/// 設計稿：第三層「沒有獨立倒數樣式」⇒ 全句同一個字級、同一個 secondary 色；
///    不畫實心「進站」色塊、不做數字／單位兩級字階（那兩件是主角 `RailCountdownText` 的事）。
struct MetroWaitSecondLine: View {
    let second: MetroWaitDisplay.SecondTrain
    /// 擁擠度排在前面時的分隔符。鎖屏與島上用同一個，兩處讀起來才是同一句話。
    var separator: String = ""
    let fontSize: CGFloat

    var body: some View {
        // spacing 0：分界由 lead 尾端那個空格給，避免與「· 」的間距疊成兩倍。
        HStack(spacing: 0) {
            Text(separator + second.lead + " ")
            countdownText
        }
        .font(.system(size: fontSize))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    @ViewBuilder
    private var countdownText: some View {
        if case .until(let d) = second.countdown, d > Date() {
            if #available(iOS 18.0, macOS 15.0, *) {
                Text(.currentDate, format: railLiveCountdownStyle(until: d)).monospacedDigit()
            } else {
                // iOS 17.6–17.x：唯一會自走的是系統 relative（zh-Hant 畫「2 分鐘」）。
                Text(d, style: .relative).monospacedDigit()
            }
        } else {
            // 🔴 落到這裡只有兩種：(a) `.until` 的到站時刻已過 ⇒ plainText 回「進站」；
            //    (b) 整數分鐘系統（高捷／機捷）的 `.approxMinutes`——官方只給「約 N 分」、
            //    沒有絕對時刻可錨，硬換算成倒數就是製造假精度（精度誠實見 RailCountdown）。
            //    這一種確實不會自走，是資料的限制不是畫法的限制。
            Text(second.countdown.plainText).monospacedDigit()
        }
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
        Group {
            if let track = display.trackB {
                trackLayout(track)
            } else {
                spineLayout
            }
        }
        // 🔴 水平邊距不能省：鎖屏 Live Activity 的內容區沒有系統預設 margins，
        //    模擬器實測左緣會被卡片圓角裁掉半個字。8pt 仍大於圓角吃掉的量
        //    （半徑 r 的圓角要求邊距 ≥ 0.293r，r=22 ⇒ 6.4pt）。
        .padding(.horizontal, scale.pt(14))
        // 進站軌道版少了站名列、多了 64pt 的軌道，上下各讓 1pt 才守得住 160pt。
        .padding(.vertical, scale.pt(display.trackB == nil ? 8 : 7))
        // 設計稿：資料過期時全卡降到 secondary（唯一會整卡降級的狀態）。
        .opacity(display.expired ? 0.62 : 1)
    }

    /// B 方案：原本的站名列拿掉（站名改由軌道右端的站名牌說），線別併進主角列；
    /// 更新時間移到軌道下方右側。
    private func trackLayout(_ track: MetroWaitDisplay.TrackB) -> some View {
        VStack(alignment: .leading, spacing: scale.pt(3)) {
            HStack(alignment: .center, spacing: scale.pt(6)) {
                RailLineMark(name: track.lineName ?? display.lineLabel, color: track.color ?? display.color,
                             fontSize: 11, scale: scale)
                Text(RailNativeL10n.text("下一班"))
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.secondary)
                Text(RailNativeL10n.text("往 {station}", ["station": display.dest ?? "—"]))
                    .font(.system(size: scale.pt(22), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: scale.pt(4))
                RailCountdownText(value: display.countdown, size: .heroCard, scale: scale)
            }
            MetroWaitTrack(track: track, station: display.station, trailing: display.footer, scale: scale)
            HStack(spacing: scale.pt(6)) {
                MetroWaitThirdRow(display: display, scale: scale)
                Spacer(minLength: scale.pt(4))
                MetroWaitEndButton(scale: scale, height: 24)
            }
        }
    }

    private var spineLayout: some View {
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
                Text(RailNativeL10n.text("下一班"))
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(.secondary)
                Text(RailNativeL10n.text("往 {station}", ["station": display.dest ?? "—"]))
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
                Text(display.arriving
                     ? RailNativeL10n.text("{station} 進站中", ["station": display.station])
                     : display.station)
                    .font(.system(size: scale.pt(11)))
                    .foregroundStyle(display.arriving
                                     ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                     : AnyShapeStyle(HierarchicalShapeStyle.tertiary))
                    .lineLimit(1)
            }

            HStack(spacing: 0) {
                // 🔴 第三列沒內容時也要佔一行字高：沒有擁擠度也沒有再下一班的卡（末班、資料缺）
                //    翻進站會從空白變成一句到站說明，卡片長高 10pt。這是保險不是已證實的 bug：09-23 台鐵
                //    等站卡【進站軌道版】在鎖屏亮著時翻轉，實見外框長高、內容仍按舊高度裁（新列只露上緣）；
                //    但同一天它的【軌脊版】翻轉長高卻完整（iOS 26.5 模擬器各一次，差別原因未明）。
                //    捷運這張沒實拍過翻轉 ⇒ 讓翻轉前後等高，不必賭系統怎麼重畫。
                //    進站軌道版不必：它的第三列跟 24pt 的「結束」鈕同列，本來就等高。
                ZStack(alignment: .leading) {
                    Text(verbatim: " ").font(.system(size: scale.pt(11))).hidden()
                    MetroWaitThirdRow(display: display, scale: scale)
                }
                Spacer(minLength: 0)
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
    }
}

/// 鎖屏卡的第三層。
///
/// 🔴 這一列只有一位——三種內容互斥，不准疊。理由是硬的：鎖屏 Live Activity 只有
///    160pt 高（官方：超過就被系統截掉），而主角列＋軌道（或抬頭＋軌脊）＋底列已經吃掉
///    大半 ⇒ 全卡只剩一列的預算。優先序＝服務異常 ＞ 進站後怎麼辦 ＞ 加值資訊。
///    每一句都保持一行（最窄 330pt 機型的可用寬 302pt，17–21 字的中文放得下），
///    不然折行又會把上下緣吃掉。進站軌道版與軌脊版共用這一份，兩種版面讀起來是同一句話。
struct MetroWaitThirdRow: View {
    let display: MetroWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if let notice = display.notice {
            Text("⚠ " + notice)
                .font(.system(size: scale.pt(11), weight: .medium))
                .foregroundStyle(RailTokens.colors(scheme).warn)
                .lineLimit(1).minimumScaleFactor(0.8)
        } else if let hint = display.staleHint {
            Text(hint)
                .font(.system(size: scale.pt(11))).foregroundStyle(.secondary)
                .lineLimit(1).minimumScaleFactor(0.8)
        } else if display.crowd != nil || display.second != nil {
            HStack(spacing: scale.pt(6)) {
                if let c = display.crowd, !c.isEmpty {
                    RailCarriageMeter(levels: c, showWord: true, scale: scale)
                }
                if let second = display.second {
                    MetroWaitSecondLine(
                        second: second,
                        separator: display.crowd?.isEmpty == false ? "· " : "",
                        fontSize: scale.pt(13))
                }
            }
        }
    }
}

// MARK: - 進站軌道（B 方案）

/// 進站軌道：左端＝這班車的上一站，右端＝本站（琺瑯站名牌），正側面車模畫在軌道上、
/// 車頭對齊目前位置；車頭到本站那段用路線色＝還沒走完的路。
/// 設計正本：桌面/軌島小工具背景方案/等車卡進站軌道.html（產生器 build_la.py 的 `track()`），
/// 下面的座標常數都照那裡的 CSS（寬度以外全部是固定 pt）。
///
/// 🔴 整條都是靜態的（見 `MetroWaitDisplay.TrackB`）：不准在這裡放 `ProgressView(timerInterval:)`
///    ——自走填色會跑到車前面。車與路線色那段只在收到推播重繪時一起往前挪。
struct MetroWaitTrack: View {
    let track: MetroWaitDisplay.TrackB
    /// 本站站名（站名牌上的字）。
    let station: String
    /// 軌道下方右側那一句（鎖屏：「追蹤至 21:40 · 21:23 更新」；動態島不放）。
    var trailing: String? = nil
    /// 接在 trailing 前面、用 ok 綠的那一段（台鐵等站卡到站後的「車應已到」）。
    var trailingAccent: String? = nil
    /// 動態島展開版：永遠黑底，軌道縮小（車高 16、整條 60、軌面 43）。
    var island: Bool = false
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    private func s(_ v: CGFloat) -> CGFloat { scale.pt(v) }
    private var carH: CGFloat { s(island ? 16 : 18) }
    private var height: CGFloat { s(island ? 60 : 64) }
    /// 軌面（2pt 軌道的上緣）。
    private var railY: CGFloat { s(island ? 43 : 44) }
    /// 軌道中心線：站點、路線色那段、車輪底都對齊這條。
    private var railC: CGFloat { railY + s(1) }
    private var dark: Bool { island || scheme == .dark }
    /// 軌道色／站點底色。站點底色要跟卡片底色一致，圓點外那一圈才像把軌道「切開」。
    private var railColor: Color { island ? Color(red: 0.29, green: 0.30, blue: 0.33)
        : dark ? Color(red: 0.33, green: 0.35, blue: 0.37) : Color(red: 0.76, green: 0.78, blue: 0.80) }
    private var dotBG: Color { island ? .black
        : dark ? Color(red: 0.15, green: 0.15, blue: 0.16) : Color(red: 0.95, green: 0.95, blue: 0.96) }
    private var tint: Color { track.color ?? RailTokens.colors(scheme).brand }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            // 本站（站名牌中心）距右緣 46pt；上一站距左緣 12pt，還沒到上一站時內縮到 96pt，
            // 讓出左側那段虛線代表更遠的路。
            let sx = w - s(46)
            let far = track.car == .far
            let px = far ? s(96) : s(12)
            let nose: CGFloat? = {
                switch track.car {
                case .none: return nil
                case .running(let f): return px + (sx - px) * CGFloat(min(1, max(0, f)))
                case .far: return px - s(10)
                case .arrived: return sx
                }
            }()
            ZStack(alignment: .topLeading) {
                // 軌道：虛線段（更遠的路）＋實線段。
                if far {
                    Path { p in p.move(to: CGPoint(x: 0, y: railC)); p.addLine(to: CGPoint(x: px, y: railC)) }
                        .stroke(railColor, style: StrokeStyle(lineWidth: s(2), dash: [s(4), s(4)]))
                }
                Rectangle().fill(railColor)
                    .frame(width: max(0, w - (far ? px : 0)), height: s(2))
                    .offset(x: far ? px : 0, y: railY)
                // 還沒走完的路（車頭 → 本站）。沒畫車時不畫：那一段的起點就是車頭，沒有車就是在編位置。
                if let nose, track.car != .arrived, sx > nose {
                    Capsule().fill(tint)
                        .frame(width: sx - max(nose, 0), height: s(4))
                        .offset(x: max(nose, 0), y: railC - s(2))
                }
                // 上一站：空心小圓。
                Circle().fill(dotBG)
                    .overlay(Circle().strokeBorder(railColor, lineWidth: s(2)))
                    .frame(width: s(9), height: s(9))
                    .position(x: px, y: railC)
                // 車：兩節（領頭那節車頭朝右＝朝本站，後面那節鏡像，讀起來是一列車）。
                if let nose {
                    let cw = carH * CGFloat(track.carAspect)
                    ForEach(0..<2, id: \.self) { i in
                        MetroWaitCarImage(model: track.carModel)
                            .frame(width: cw, height: carH)
                            .scaleEffect(x: i == 1 ? -1 : 1, y: 1)
                            .offset(x: nose - cw * CGFloat(i + 1) - s(1.5) * CGFloat(i), y: railC - carH)
                    }
                }
                // 本站：路線色實心圓＋一圈卡片底色（把軌道切開），立柱撐著站名牌。
                Rectangle().fill(Color(red: 0.46, green: 0.44, blue: 0.38))
                    .frame(width: s(2), height: s(12))
                    .position(x: sx, y: railY - s(6))
                Circle().fill(tint)
                    .frame(width: s(12), height: s(12))
                    .padding(s(3)).background(Circle().fill(dotBG))
                    .position(x: sx, y: railC)
                // 站名牌：中心對齊本站；站名長到塞不進右側 46pt 時改成右緣貼齊，往左長。
                ViewThatFits(in: .horizontal) {
                    plate
                    plate.frame(width: s(92), alignment: .trailing)
                }
                .frame(width: s(92), height: railY - s(12) - s(1), alignment: .bottom)
                .position(x: sx, y: s(1) + (railY - s(12) - s(1)) / 2)
                // 標籤：左＝上一站站名（台鐵另帶「21:19 開」），右＝更新時間。
                prevLabel
                    .lineLimit(1)
                    .offset(x: max(0, px - s(12)), y: railY + s(6))
                if let trailingAccent {
                    accentLabel(trailingAccent)
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                        .frame(width: w, alignment: .trailing)
                        .offset(y: railY + s(6))
                } else if let trailing {
                    Text(trailing)
                        .font(.system(size: s(10.5)))
                        .foregroundStyle(.secondary)
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                        .frame(width: w, alignment: .trailing)
                        .offset(y: railY + s(6))
                }
            }
            .frame(width: w, height: height, alignment: .topLeading)
        }
        .frame(height: height)
        // 左右照舊切齊（遠處的車會伸出左緣），上緣多留 6pt：站名牌的上框會凸出軌道區，
        // 用 .clipped() 會把上框切掉一截（09-23 台鐵等車卡 session 發現，同一個修法）。
        .mask(Rectangle().padding(.top, -s(6)))
    }

    /// 「車應已到 · 21:26 更新」：前半 ok 綠、後半同 trailing 的 secondary。
    private func accentLabel(_ accent: String) -> Text {
        let head = Text(accent).font(.system(size: s(10.5), weight: .semibold))
            .foregroundStyle(RailTokens.colors(scheme).ok)
        guard let trailing else { return head }
        return Text("\(head)\(Text(" · " + trailing).font(.system(size: s(10.5))).foregroundStyle(.secondary))")
    }

    private var prevLabel: Text {
        let name = Text(track.prev).font(.system(size: s(10.5), weight: .semibold))
        guard let sub = track.prevSub else { return name }
        return Text("\(name)\(Text(" " + sub).font(.system(size: s(10.5))).monospacedDigit().foregroundStyle(.secondary))")
    }

    private var plate: some View {
        // 台鐵站牌的帶子是站牌本色（深藍），路線色只給還沒走完的那段與本站圓點。
        MetroWaitPlate(name: station, band: track.lineName,
                       bandColor: track.plateNeighbours == nil ? track.color : nil,
                       neighbours: track.plateNeighbours, dark: dark, scale: scale)
    }
}

/// 琺瑯站名牌（色票同網站頂端的 `.plate`、小工具 C 方案同一組）：白瓷底＋深藍字，
/// 下緣帶子用路線色＋線名。深色模式與動態島用同一塊白瓷壓暗一階（09-23 使用者裁示：網站那組深藍瓷
/// 放在黑灰卡片上跟原本的樣式不搭；壓暗是為了夜裡不刺眼）。
struct MetroWaitPlate: View {
    let name: String
    let band: String?
    let bandColor: Color?
    /// 有值時帶子改寫兩個鄰站「◀ 萬華　松山 ▶」（台鐵站牌），取代線名。
    var neighbours: MetroWaitDisplay.TrackB.PlateNeighbours? = nil
    let dark: Bool
    var scale: RailScale = RailScale(k: 1)

    private func s(_ v: CGFloat) -> CGFloat { scale.pt(v) }
    private static func rgb(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
              blue: Double(hex & 0xff) / 255)
    }
    /// 中文站名字距拉開（站牌的樣子）；英文站名本來就長，照常字距。
    private var latin: Bool { name.unicodeScalars.contains { $0.isASCII && CharacterSet.letters.contains($0) } }

    /// 帶子內容：捷運＝線名置中；台鐵＝左右兩個鄰站，箭頭小一號（同設計稿 .pf .l／.r）。
    @ViewBuilder private var bandContent: some View {
        let font = Font.system(size: s(8), weight: .heavy)
        if let n = neighbours {
            HStack(spacing: s(8)) {
                if let l = n.left {
                    Text("\(Text("◀").font(.system(size: s(6))).baselineOffset(s(1)))\(Text(" " + l).font(font))")
                        .tracking(s(0.5))
                }
                Spacer(minLength: 0)
                if let r = n.right {
                    Text("\(Text(r + " ").font(font))\(Text("▶").font(.system(size: s(6))).baselineOffset(s(1)))")
                        .tracking(s(0.5))
                }
            }
        } else {
            Text(band ?? " ").font(font).tracking(s(0.5))
        }
    }

    var body: some View {
        let ink = Self.rgb(0x26497e)
        let frame = Self.rgb(dark ? 0x6b6557 : 0x767061)
        let glaze = dark ? [Self.rgb(0xe6e3da), Self.rgb(0xdcd8cc), Self.rgb(0xd0ccbf)]
                         : [Self.rgb(0xffffff), Self.rgb(0xf7f5ee), Self.rgb(0xedebe0)]
        VStack(spacing: s(2)) {
            Text(name)
                .font(.system(size: s(13), weight: .black))
                .tracking(latin ? s(0.3) : s(3))
                .foregroundStyle(ink)
                .lineLimit(1)
                // tracking 在最後一個字後面也留了字距 ⇒ 左邊補同樣的量才置中。
                .padding(.leading, latin ? 0 : s(3))
                .padding(.horizontal, s(8))
                .padding(.top, s(3))
            bandContent
                .foregroundStyle(Self.rgb(0xfff8ec))
                .lineLimit(1)
                .padding(.horizontal, s(6))
                .padding(.top, s(1)).padding(.bottom, s(2))
                .frame(maxWidth: .infinity)
                .background(bandColor ?? Self.rgb(0x26497e))
        }
        // 帶子要跟站名一樣寬：先取兩者的理想寬，再讓帶子撐滿（VStack＋maxWidth＋fixedSize 的慣用法）。
        .fixedSize()
        .background(LinearGradient(colors: glaze, startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: s(6)))
        .overlay(RoundedRectangle(cornerRadius: s(6)).strokeBorder(frame, lineWidth: s(2)))
        .shadow(color: Color(red: 0.16, green: 0.13, blue: 0.09).opacity(0.25), radius: s(2.5), y: s(2))
    }
}

/// 正側面車模（asset `la-side-<model>`，車頭朝右）。
/// 🔴 單獨一個型別的理由同 `MetroWaitEndButton`：算繪 harness 的裸執行檔沒有 asset catalog，
///    harness 用【同名替身】直接讀 imageset 裡的同一張 PNG。
struct MetroWaitCarImage: View {
    let model: String
    var body: some View {
        Image("la-side-\(model)").resizable().interpolation(.high).aspectRatio(contentMode: .fit)
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
                    Text(RailNativeL10n.text("結束"))
                        .font(.system(size: scale.pt(11), weight: .semibold))
                        .lineLimit(1)
                }
                .buttonStyle(.bordered).controlSize(.mini).tint(.secondary)
                // 次班與擁擠度再長都先讓位，不能把唯一能當場收卡的按鈕壓到零寬。
                .fixedSize(horizontal: true, vertical: false)
            } else {
                Button(intent: MetroWaitEndIntent()) {
                    RailEndButton(scale: scale, height: height) { Text(RailNativeL10n.text("結束")) }
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
        VStack(alignment: .leading, spacing: scale.pt(display.trackB == nil ? 4 : 3)) {
            HStack(alignment: .center, spacing: scale.pt(6)) {
                if display.trackB != nil {
                    // 進站軌道版：站名在軌道右端的站名牌上，主角列補「下一班」小標（同鎖屏）。
                    Text(RailNativeL10n.text("下一班"))
                        .font(.system(size: scale.pt(11)))
                        .foregroundStyle(.secondary)
                }
                Text(RailNativeL10n.text("往 {station}", ["station": display.dest ?? "—"]))
                    .font(.system(size: scale.pt(display.trackB == nil ? 20 : 18), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: scale.pt(4))
                RailCountdownText(value: display.countdown, size: .row, scale: scale)
            }
            if let track = display.trackB {
                MetroWaitTrack(track: track, station: display.station, island: true, scale: scale)
            } else {
                RailSpineTrack(interval: display.track,
                               progress: display.progress,
                               phase: display.arriving ? .arriving : .running,
                               lineColor: display.color, scale: scale)
            }
            HStack(spacing: scale.pt(6)) {
                if let c = display.crowd, !c.isEmpty {
                    RailCarriageMeter(levels: c, showWord: true, scale: scale)
                }
                // 🔴 島上這一列還要塞「結束」鈕，位置比鎖屏少一截 ⇒ 車正在進站時捨棄「再下一班」
                //    而不是捨棄擁擠度：車就在眼前的那幾秒，該往哪節車廂走比下一班幾分到重要，
                //    而下一班的資訊在鎖屏那張卡上完整保留。
                if let second = display.second, !display.arriving {
                    // 與鎖屏那張同一個分隔符，兩處讀起來才是同一句話。
                    MetroWaitSecondLine(
                        second: second,
                        separator: display.crowd?.isEmpty == false ? "· " : "",
                        fontSize: scale.pt(12))
                }
                Spacer(minLength: scale.pt(4))
                MetroWaitEndButton(scale: scale, compact: true)
            }
        }
        // 🔴 展開版面的四角是 44pt 級圓角，system region 沒有替 bottom 內容保留安全區。
        //    10pt 實機仍會讓右側「結束」膠囊進入圓角斜切區（1.5.0(80) 取證），所以照
        //    原設計規格完整內縮 22pt；文字長短不同的繁中／英文／日文共用同一條安全線。
        .padding(.horizontal, scale.pt(22))
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
        case .clock:     return nil   // 捷運等車卡沒有「主要顯示發車時刻」設定，走不到
        case .until:     return nil   // 走下面的自走 Text，不進這個靜態字串路徑
        }
    }

    /// 快到了／已到＝實心（設計稿：「形狀本身就是狀態」）。
    ///
    /// 🔴 `.until` 也要算進來，否則等車卡改成自走倒數之後，「不足一分鐘變實心綠」這個訊號會
    ///    【靜默消失】——改版前 <60 秒走的是 `.seconds`，本來就在這一格。
    /// 🔴 已知取捨：填色不是自走型別，所以這是「算繪當下為真」而不是「永遠為真」：
    ///    在 T-16 分算繪的那張卡，到 T-30 秒時環仍是空心、而環裡的字已經自己走到「30 秒」。
    ///    最遲在到站那一刻 `staleDate` 會讓 ActivityKit 翻 isStale 重繪成 `.arriving` 補上。
    ///    不因為「填色補不上」就整個放棄實心：那等於為了消滅一個時間差而拿掉一個狀態。
    private var nearlyHere: Bool {
        switch countdown {
        case .arriving, .seconds: return true
        case .until(let d):       return d.timeIntervalSinceNow < 60
        default:                  return false
        }
    }

    var body: some View {
        let c = RailTokens.colors(scheme)
        let ring = mono ? Color.primary : (color ?? c.brand)
        ZStack {
            if nearlyHere {
                // 綠色是「可以上車了」，不是路線色。
                Circle().fill(mono ? Color.primary : c.ok)
            } else {
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
            // 🔴 `!nearlyHere`：實心那一格照設計稿【不印字】（「形狀本身就是狀態，不必塞字」），
            //    在綠底上再疊一串 7pt 的「52 秒」既讀不到也把那個訊號弄糊了。
            if case .until(let d) = countdown, d > Date(), !nearlyHere {
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
            isStale: ctx.isStale, now: Date(),
            // 車的位置只看伺服器這一發的 tick（不看 Date()，理由見 make）。
            tick: ctx.state.tick,
            // 上一站與站間時間從目錄的站序推（終點決定方向），推播與 ContentState 都不用改形狀。
            hop: MetroWidgetCatalog.shared.waitHop(sys: ctx.attributes.sys, station: ctx.attributes.station,
                                                   dest: ctx.state.nextDest)
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
                        // 進站軌道版：站名已在軌道右端的站牌上，頂列只留線名（兩者並排時線名被截成
                        // 「淡水信…」，09-23 使用者裁示留線名）。沒有站牌的舊版面照舊顯示站名。
                        if d.trackB == nil {
                            Text(d.station).font(.system(size: 12, weight: .medium)).lineLimit(1)
                        }
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
                        Text(RailNativeL10n.text("往{station}", ["station": dest]))
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
