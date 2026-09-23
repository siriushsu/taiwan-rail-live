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
    /// 進站軌道（B 方案）。nil ＝ 開卡時沒有上一站資訊（本站就是起站、舊版網頁、沒有車模素材）
    /// ⇒ 維持原本的軌脊版面。與捷運等車卡共用同一個型別與同一條軌道（`MetroWaitTrack`）。
    /// 🔴 車的位置 ＝ 表定＋官方誤點推出來的（上一站開車 → 本站），跟地圖上畫車同一套；
    ///    官方沒有給台鐵列車位置。而且【只用推播的 tick 算】，不用重繪當下的時鐘（見 `make`）。
    let trackB: MetroWaitDisplay.TrackB?

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
    ///   - now: 只用來判斷資料齡與算軌道填色比例。**不參與 heroText，也不參與車的位置**。
    ///   - tick: 伺服器送出這一發推播的時刻（ContentState.tick）。車的位置只准用它算。
    ///   - hop: 進站軌道那一段（attributes 開卡時寫入）；nil 就是原本的軌脊版。
    static func make(
        trainType: String, station: String, colorHex: String?,
        trainNo: String, dest: String, schedSec: Double,
        delayMin: Int?, dataAt: Double?,
        notice: String?, pushed: Bool?, isStale: Bool, now: Date,
        tick: Double? = nil, hop: TraWaitHop? = nil
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

        // 進站軌道：車頭在「上一站實際開車 → 本站實際約到站」之間的比例，兩端都是表定＋官方誤點
        // （同一條算式也是伺服器每分鐘推一發的行駛段，見 scripts/tra_wait_core.mjs twRunWindow）。
        var trackB: MetroWaitDisplay.TrackB?
        if let hop, let aspect = TraWaitHop.carAspect(hop.carModel) {
            let car: MetroWaitDisplay.TrackB.Car
            if pushed != true || shown == nil {
                // 不畫車的兩種情形：
                //   · 沒接上推播：車會停在開卡那一刻的位置不動，等於說謊（同捷運等車卡）；
                //   · 沒有官方誤點（未知或過期）：照表定畫一台在走的車＝宣稱準點（精度紅線）。
                car = .none
            } else if isStale {
                car = .arrived
            } else if let t = tick, let m = shown {
                // 🔴 只用 tick（伺服器送出這一發的時刻）不用 now：系統會替同一份 ContentState 在
                //    不同時間各算一張快照（淺／深色、切外觀），用 now 同一次更新的車會前後跳甚至倒退
                //    （捷運 B 09-23 模擬器實見）。車只在收到推播時往前挪一格——那正是設計稿要的。
                let from = hop.prevDepSec + Double(m) * 60
                let to = schedSec + Double(m) * 60
                if t < from { car = .far }
                else if t >= to { car = .arrived }
                else { car = .running((t - from) / (to - from)) }
            } else {
                car = .none
            }
            let left = hop.plateLeft.map { RailNativeL10n.name($0) }
            let right = hop.plateRight.map { RailNativeL10n.name($0) }
            trackB = MetroWaitDisplay.TrackB(
                prev: RailNativeL10n.name(hop.prevStop), car: car,
                carModel: hop.carModel, carAspect: aspect, lineName: nil,
                color: RailHex.color(colorHex),
                // 上一站那個時刻是【表定】開車（時刻表上的字），不是實際——實際約到站只有主角那一個。
                prevSub: RailNativeL10n.text("{time} 開", [
                    "time": RailBoardClock.updateTimeString(Date(timeIntervalSince1970: hop.prevDepSec))
                ]),
                plateNeighbours: left == nil && right == nil ? nil
                    : .init(left: left, right: right))
        }

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
            notice: RailHex.trimmed(notice).map { RailNativeL10n.text($0) }, staleHint: hint,
            trackB: trackB)
    }
}

/// 進站軌道要的那一段：開卡當下由網頁從時刻表算好、寫進 `TraWaitAttributes`，整張卡的生命週期不變。
struct TraWaitHop: Equatable {
    let prevStop: String
    let prevDepSec: Double
    let plateLeft: String?
    let plateRight: String?
    let carModel: String

    /// attributes 那五欄湊成一段。缺上一站或車模、上一站開車不早於本站表定 ⇒ nil（不畫進站軌道，不猜）。
    init?(prevStop: String?, prevDepSec: Double?, plateLeft: String?, plateRight: String?,
          carModel: String?, schedSec: Double) {
        guard let prev = RailHex.trimmed(prevStop), let dep = prevDepSec, dep < schedSec,
              let model = RailHex.trimmed(carModel) else { return nil }
        self.prevStop = prev
        self.prevDepSec = dep
        self.plateLeft = RailHex.trimmed(plateLeft)
        self.plateRight = RailHex.trimmed(plateRight)
        self.carModel = model
    }

    /// 車模寬高比（app/scripts/build_la_side_assets.py cut 印出來的值，重產素材要同步改這裡）。
    /// 沒有素材的車型回 nil ⇒ 不畫進站軌道（畫一塊空白比沒有軌道更糟）。
    /// id 是網站 3D 列車 formations.js 的 FORMATIONS[…].id（網頁 traWaitCarModel 送來的值）。
    static func carAspect(_ model: String) -> Double? {
        switch model {
        case "emu3000":  return 2.684
        case "temu1000": return 2.747
        case "temu2000": return 2.628
        case "e1000":    return 2.025
        case "dr3100":   return 2.414
        case "emu800":   return 2.565
        case "e200":     return 1.972
        case "dr1000":   return 2.236
        case "blue":     return 2.591
        case "haifeng":  return 2.470
        case "shanlan":  return 2.470
        case "mingri":   return 1.972
        case "e500":     return 2.003
        default:         return nil
        }
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
        Group {
            if let track = display.trackB {
                trackLayout(track)
            } else {
                spineLayout
            }
        }
        // 水平邊距不能省：鎖屏 LA 的內容區沒有系統預設 margins（見等車卡的同一條註解）。
        .padding(.horizontal, scale.pt(14))
        .padding(.vertical, scale.pt(7))
        .opacity(display.expired ? 0.62 : 1)
    }

    /// 主角：「實際約 21:27」。兩種版面同一顆（B 方案也不改成倒數——台鐵官方沒有預估到站）。
    /// B 版照設計稿縮到 32pt、行高壓到字級本身（設計稿 `.hero{line-height:1}`）：數字沒有下伸部，
    /// 系統預設行高上下多留的那幾 pt 是空的，卻會把「車應已到」那張擠破 160pt。
    private func hero(size: CGFloat, tight: Bool = false) -> some View {
        // 🔴 主角是【鐘面時刻】。這裡刻意不用 RailCountdownText：那顆會畫成
        //    「數字＋單位」兩級字階（給「3 分」「52 秒」用的），而 18:35 是一個
        //    不可拆的時刻；更重要的是它承載的是倒數語意，用在這裡會讓人把
        //    「18:35」讀成「18 分 35 秒」。
        HStack(alignment: .lastTextBaseline, spacing: scale.pt(4)) {
            Text(display.heroCaption)
                .font(.system(size: scale.pt(11)))
                .foregroundStyle(.secondary).lineLimit(1)
            Text(display.heroText)
                .font(.system(size: scale.pt(size), weight: .semibold))
                .monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
                .foregroundStyle(display.arrived
                                 ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                 : AnyShapeStyle(HierarchicalShapeStyle.primary))
        }
        .fixedSize(horizontal: true, vertical: false)
        .frame(height: tight ? scale.pt(size) : nil)
    }

    /// 官方值那一列：「表定 18:32 · 誤點 3 分」。
    private var officialValues: some View {
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
        }
        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
    }

    /// 公告或到站說明：只有一位（鎖屏 160pt 上限），優先序＝服務異常 ＞ 到站後怎麼辦。
    @ViewBuilder private var noticeOrHint: some View {
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
    }

    /// B 方案：原本的站名列拿掉（站名改由軌道右端的站名牌說），車種標併進主角列；
    /// 「更新時間」移到軌道下方右側，官方值與「結束」同一列。
    private func trackLayout(_ track: MetroWaitDisplay.TrackB) -> some View {
        VStack(alignment: .leading, spacing: scale.pt(3)) {
            HStack(alignment: .center, spacing: scale.pt(6)) {
                RailLineMark(name: display.trainType, color: display.color,
                             fontSize: 11, scale: scale)
                Text(display.lead)
                    .font(.system(size: scale.pt(20), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: scale.pt(4))
                hero(size: 32, tight: true)
            }
            // 到站那一刻明講。用「應」不是漏字：這個時刻是「表定＋官方誤點」推出來的估計值，
            // 官方沒有說過車真的到了，卡片就不可以替它宣告。
            MetroWaitTrack(track: track, station: display.station, trailing: display.footer,
                           trailingAccent: display.arrived ? RailNativeL10n.text("車應已到") : nil,
                           scale: scale)
            HStack(spacing: scale.pt(6)) {
                officialValues
                Spacer(minLength: scale.pt(4))
                TraWaitEndButton(scale: scale, height: 24)
            }
            noticeOrHint
        }
    }

    private var spineLayout: some View {
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
                hero(size: 34)
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

            HStack(spacing: 0) {
                officialValues
                Spacer(minLength: 0)
            }

            // 🔴 只有一位——理由同等車卡：鎖屏 Live Activity 只有 160pt 高，超過就被系統截掉。
            //    優先序＝服務異常 ＞ 到站後怎麼辦。
            noticeOrHint

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
                    Text(RailNativeL10n.text("結束"))
                        .font(.system(size: scale.pt(11), weight: .semibold))
                        .lineLimit(1)
                }
                .buttonStyle(.bordered).controlSize(.mini).tint(.secondary)
                .fixedSize(horizontal: true, vertical: false)
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

/// 進站軌道版的主角：放在動態島 trailing（鏡頭右側那一格），不在下半。理由見 `TraWaitIslandBottom`。
struct TraWaitIslandHero: View {
    let display: TraWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: scale.pt(3)) {
            Text(display.heroCaption)
                .font(.system(size: scale.pt(10)))
                .foregroundStyle(.secondary)
            // 22 不是 24：這一格與鏡頭同高，字再高一點就把整條鏡頭帶撐高、吃掉下半的預算。
            Text(display.heroText)
                .font(.system(size: scale.pt(22), weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(display.arrived
                                 ? AnyShapeStyle(RailTokens.colors(scheme).ok)
                                 : AnyShapeStyle(HierarchicalShapeStyle.primary))
        }
        // 鏡頭右側只有約 95pt；英文說明字較長時整組等比縮，不截字。
        .lineLimit(1).minimumScaleFactor(0.7)
    }
}

/// 展開版面的下半（主角＋軌道＋官方兩值＋結束）。
///
/// 🔴 進站軌道版【沒有主角列】：09-23 模擬器（iPhone 17 Pro）實測，島的內容在距島頂約 133pt 處
///    被系統裁掉，而下半從鏡頭帶底下（約 42pt）才開始 ⇒ 下半只有約 91pt。設計稿的
///    「主角列＋軌道 60＋官方值列」要 125pt，官方值與「結束」會被切掉一半。所以：
///    主角搬到 trailing（`TraWaitIslandHero`，與鏡頭同一帶、本來就空著）；
///    「172 次 往 花蓮」疊進軌道左上角——站名牌在右、車在軌面上，那一塊本來就是空的。
///    改版後同一台模擬器實測：下半 83pt，最底一列（含結束鈕）完整，墨跡到距島頂約 137pt。
///    算繪 harness 對這個版面另有一道實測預算 gate（`islandBottomUnderBandMax`）。
struct TraWaitIslandBottom: View {
    let display: TraWaitDisplay
    var scale: RailScale = RailScale(k: 1)

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: scale.pt(display.trackB == nil ? 4 : 3)) {
            if display.trackB == nil {
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
            }
            if let track = display.trackB {
                // 進站軌道縮小版（動態島永遠黑底）；「車應已到」在島上由主角轉綠表達，不另寫。
                MetroWaitTrack(track: track, station: display.station, island: true, scale: scale)
                    .overlay(alignment: .topLeading) {
                        // 右側讓出站名牌：牌框 92pt 貼右緣、長站名會再往左長，留 128pt 才不會碰到。
                        // 高度只到約 21pt，車頂在 27pt（軌面 43 − 車高 16），不會壓到車。
                        Text(display.lead)
                            .font(.system(size: scale.pt(17), weight: .semibold))
                            .lineLimit(1).minimumScaleFactor(0.6)
                            .padding(.trailing, scale.pt(128))
                    }
            } else {
                RailSpineTrack(interval: display.track,
                               progress: display.progress,
                               phase: display.arrived ? .arriving : .running,
                               lineColor: display.color, scale: scale)
            }
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
        // 與捷運等車卡共用 22pt 圓角安全線；10pt 在實機會讓最右側按鈕進入斜切區。
        .padding(.horizontal, scale.pt(22))
        // 進站軌道版不留底：系統在裁切線下方本來就留了約 27pt 的島底，這 6pt 只會把結束鈕往外推。
        .padding(.bottom, scale.pt(display.trackB == nil ? 6 : 0))
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
            isStale: ctx.isStale, now: Date(),
            // 車的位置只看伺服器這一發的 tick（不看 Date()，理由見 make）。
            tick: ctx.state.tick,
            hop: TraWaitHop(prevStop: ctx.attributes.prevStop, prevDepSec: ctx.attributes.prevDepSec,
                            plateLeft: ctx.attributes.plateLeft, plateRight: ctx.attributes.plateRight,
                            carModel: ctx.attributes.carModel, schedSec: ctx.attributes.schedSec))
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
                DynamicIslandExpandedRegion(.trailing) {
                    // 只有進站軌道版把主角放這裡；沒有軌道時主角仍在下半的主角列（見 TraWaitIslandBottom）。
                    if d.trackB != nil {
                        TraWaitIslandHero(display: d).padding(.trailing, 4)
                    }
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
