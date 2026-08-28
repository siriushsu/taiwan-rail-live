import AppIntents
import WidgetKit
import SwiftUI

struct MetroEntry: TimelineEntry {
    let date: Date
    let title: String          // 站名
    let lineColor: Color?
    let snapshot: MetroSnapshot?
    let precision: String      // "sec" | "min"
    let lastTrain: String?     // "23:58",不在末班窗內時 nil
    let failed: Bool           // 這一輪抓取失敗,畫的是上次的資料
    var deepLink: URL? = nil   // 點小工具 → App 開這一站的等車卡(railisland://metro-wait)
    var auto: Bool = false     // 這一站是「自動(最近的站)」解析出來的,標頭掛小徽章
    var autoHint: String? = nil // 自動選站解析失敗時的空狀態指引(蓋過通用的「沒有資料」)
    // 通行證閘門擋下時的明講 CTA(2026-08-15)。🔴 這個專案已經有三個「不給用也不說」的付費
    // 功能,這裡一律講清楚「為什麼看不到、去哪裡買」,不做靜默空白卡。
    var passCTA: String? = nil
    // 每一列的線色要靠「系統＋本站＋該列終點」推(見 MetroPalette.rowColor),故 entry 要帶系統 id。
    var sys: String? = nil
    // 點這張卡要在背景開等車卡的目標。nil ＝這一格沒有站可追(還沒選站、自動選站解析失敗、
    // 或被通行證閘門擋下要導去方案頁)⇒ 照舊走 widgetURL 深連結,見 MetroBoardView.body。
    var waitTarget: MetroWaitTarget? = nil
}

/// 「點卡就在背景開等車卡」的目標。dest ＝小工具那格選的方向(終點站名),沒選就是 nil
/// (不限方向,與網頁端 dest===null 同語意)。
struct MetroWaitTarget: Hashable {
    let sys: String
    let station: String
    let dest: String?
}

extension MetroEntry {
    /// 這張卡畫的資料已經幾秒了。dataAt 取自官方回應自帶的時刻(MetroBoardModel.payloadTime),
    /// 所以這是「資料的年紀」,不是「距離上次刷新多久」——後者對被快取餵舊主體的情況恆為 0。
    func dataAge(at date: Date) -> Double? {
        snapshot.map { date.timeIntervalSince1970 - $0.dataAt }
    }

    /// 🔴 空白看板的四種原因必須分得出來。以前「連不上」「資料過舊」「真的沒車」印同一句,
    ///    使用者回報「沒有班次資訊」時,查修的人無從判斷是哪一種,只能從頭猜——2026-08-15
    ///    小工具整天每一站都空白就卡在這裡,最後是靠把手機上的 URLCache 拉下來才定案。
    ///    門檻取 180 秒:大於邊緣快取最長的 s-maxage(機捷 110 秒)並留餘裕,正常刷新不會誤觸;
    ///    真被某層快取餵了舊主體時,畫面直說過舊,不再偽裝成「官方沒有班次」。
    ///    小卡與混合大卡共用這一份,兩張卡的說法不會分岔。
    func emptyText(at date: Date) -> String {
        if failed { return RailNativeL10n.text("連不上官方資料，稍後自動再試") }
        guard snapshot != nil else { return RailNativeL10n.text("沒有資料") }
        if let age = dataAge(at: date), age > 180 { return RailNativeL10n.text("資料過舊，打開軌島即更新") }
        return RailNativeL10n.text("官方目前沒有這一站的班次資訊")
    }
}

struct MetroBoardProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> MetroEntry {
        MetroEntry(date: Date(), title: "台北車站", lineColor: .blue, snapshot: nil,
                   precision: "sec", lastTrain: nil, failed: false)
    }

    func snapshot(for configuration: MetroBoardIntent, in context: Context) async -> MetroEntry {
        await entry(for: configuration)
    }

    func timeline(for configuration: MetroBoardIntent, in context: Context) async -> Timeline<MetroEntry> {
        let e = await entry(for: configuration)
        // 官方視野約 12 分鐘。刷新間隔壓在視野內,讓「下一次刷新之前資料還有效」。
        // 系統不保證照做——所以版面一律顯示資料時刻,不假裝即時。
        // 🔴 真機回饋(08-14):單一 entry ⇒ 倒數走完【全卡僵在 0:00】直到下次刷新。
        //    WidgetKit 的 timeline 可以預排未來 entries(Live Activity 做不到的,這裡做得到)。
        //    每個到站時刻排【兩個】邊界:eta+1(該列換「進站」)、eta+31(該列退場)——
        //    第二輪真機回饋:只排 +1 的話已到的車永遠掛著「進站」,整排都是進站。
        //    30 秒停留與 App 看板 TRTC_OFFICIAL_BOARD_ARRIVING_GRACE_SEC 同值。
        //    etas 不濾掉已過去的:剛到 10 秒的車還要它的 +31 退場邊界。只取前 8 個到站點。
        var entries = [e]
        var hasBounds = false
        if let rows = e.snapshot?.rows {
            let now = Date().timeIntervalSince1970
            let etas = Set(rows.compactMap(\.etaEpoch)).sorted().prefix(8)
            let bounds = Set(etas.flatMap { [$0 + 1, $0 + 31] }.filter { $0 > now }).sorted()
            hasBounds = !bounds.isEmpty
            entries += bounds.map { t in
                MetroEntry(date: Date(timeIntervalSince1970: t), title: e.title,
                           lineColor: e.lineColor, snapshot: e.snapshot, precision: e.precision,
                           lastTrain: e.lastTrain, failed: e.failed, deepLink: e.deepLink,
                           auto: e.auto, autoHint: e.autoHint, passCTA: e.passCTA, sys: e.sys,
                           waitTarget: e.waitTarget)
            }
        }
        // 🔴 刷新策略(真機回饋 08-14 第五輪:「只剩一兩班看起來像沒車」):有預排邊界時用 .atEnd
        //    ——資料視野走完的那一刻才向系統要下一輪,不提早浪費、也不晚於「畫面已空」;
        //    固定 .after(10min) 會在視野只剩 2 分鐘時還傻等 8 分鐘。搭配三個免預算的刷新源:
        //    開 App 即 reload(AppDelegate)、使用者正在看的小工具過期時系統常主動補抓、
        //    (待做)定位變化觸發。分鐘級系統沒有邊界,維持 10 分鐘節奏。
        return Timeline(entries: entries,
                        policy: hasBounds ? .atEnd : .after(Date().addingTimeInterval(10 * 60)))
    }

    private func entry(for cfg: MetroBoardIntent) async -> MetroEntry {
        let catalog = MetroWidgetCatalog.shared
        // 「自動(最近的站)」:先解析成具體的 sys|station 再續走原流程。
        // 🔴 這個分支必須在 sys 查表之前——混合大卡把 metroStation 原值拆出來的 sys 會是
        //    "auto",查表必落空;方向格是為手選站挑的,對自動解析出來的站不一定成立,一併忽略。
        var isAuto = false
        var sysID: String?, stationName: String?
        // 通行證閘門在【定位與抓取之前】:被擋下時不打官方 API、也不叫醒定位,
        // 卡上直接畫明講的升級說明(deepLink 指向 App 的通行證頁,點卡就能買)。
        let gate = await MetroPlusGate.evaluate(stationKey: cfg.station,
                                                isAuto: cfg.station == MetroNearest.sentinel)
        switch gate {
        case .needPassAuto:
            return MetroEntry(date: Date(), title: "自動選站", lineColor: nil, snapshot: nil,
                              precision: "sec", lastTrain: nil, failed: false,
                              deepLink: Self.passLink(), auto: true,
                              passCTA: "自動選最近的站是通行證功能。點一下開啟軌島看方案，或改選一個固定車站。")
        case .needPassMulti(let claimedName):
            return MetroEntry(date: Date(), title: "再加一站", lineColor: nil, snapshot: nil,
                              precision: "sec", lastTrain: nil, failed: false,
                              deepLink: Self.passLink(),
                              passCTA: claimedName.isEmpty
                                ? RailNativeL10n.text("免費版可設定一站。點一下開啟軌島，用通行證解鎖多站。")
                                : RailNativeL10n.text("免費版可設定一站（目前是「{station}」）。點一下開啟軌島，用通行證解鎖多站。", ["station": RailNativeL10n.name(claimedName)]))
        case .allowed, .claimFree:
            break
        }
        if cfg.station == MetroNearest.sentinel {
            isAuto = true
            if let hit = await MetroNearest.resolve(catalog: catalog) {
                sysID = hit.sys; stationName = hit.station
            } else {
                return MetroEntry(date: Date(), title: "自動選站", lineColor: nil, snapshot: nil,
                                  precision: "sec", lastTrain: nil, failed: false,
                                  autoHint: "開啟 App 一次，或到「設定 › 軌島」允許取用位置")
            }
        } else {
            let parts = (cfg.station ?? "").split(separator: "|", maxSplits: 1).map(String.init)
            if parts.count == 2 { sysID = parts[0]; stationName = parts[1] }
        }
        guard let sid = sysID, let station = stationName,
              let sys = catalog.systems.first(where: { $0.id == sid }) else {
            return MetroEntry(date: Date(), title: "請選擇車站", lineColor: nil, snapshot: nil,
                              precision: "sec", lastTrain: nil, failed: false)
        }
        let alias = catalog.alias[sys.id] ?? [:]
        let now = Date().timeIntervalSince1970
        var snap: MetroSnapshot?
        var failed = false
        do {
            let data = try await MetroFetcher.fetch(sys: sys.id)
            snap = sys.precision == "sec"
                ? try MetroBoardModel.trtc(json: data, station: station, alias: alias, now: now)
                : try MetroBoardModel.minuteSystem(json: data, station: station, alias: alias, now: now)
            // 🔴 只快取「真的有班次」的結果:零班次是合法但短暫的狀態(收班後、官方視野空窗),
            //    把它寫進去會污染退路——之後每次抓取失敗都拿這份空的出來,畫面就永遠是
            //    「官方目前沒有這一站的班次資訊」,而且看不出是失敗還是真的沒車。
            if !(snap?.rows.isEmpty ?? true) { MetroFetcher.cache(snap!, sys: sys.id, station: station) }
        } catch {
            // 🔴 抓取失敗顯示上次成功的資料＋當時的時刻,不清空、不留白。
            snap = MetroFetcher.cached(sys: sys.id, station: station)
            failed = true
        }
        let filtered = (isAuto ? nil : cfg.dir).flatMap { d in
            snap.map { MetroSnapshot(station: $0.station, dataAt: $0.dataAt,
                                     rows: $0.rows.filter { $0.dest == d }, stale: $0.stale) }
        } ?? snap
        return MetroEntry(date: Date(), title: station,
                          lineColor: MetroPalette.color(sys: sys.id, station: station),
                          snapshot: filtered, precision: sys.precision,
                          lastTrain: MetroLastTrain.within60min(catalog: catalog, sys: sys.id,
                                                               station: station, now: now),
                          failed: failed,
                          deepLink: Self.deepLink(sys: sys.id, station: station),
                          auto: isAuto, sys: sys.id,
                          // 自動選站解析出來的站不套方向格(方向是為手選的那一站挑的),
                          // 與上面 filtered 的條件同源,免得卡上列的與追蹤的不是同一批。
                          waitTarget: MetroWaitTarget(sys: sys.id, station: station,
                                                      dest: isAuto ? nil : cfg.dir))
    }

    // 🔴 站名是中文:URL(string:) 對非 ASCII 插值會回 nil ⇒ 深連結整條靜默死掉。
    //    一律走 URLComponents 讓它做 percent-encoding。
    // 被閘門擋下時點卡的去處:App 開通行證方案頁(railisland://pass)。與站別無關,故不帶參數。
    private static func passLink() -> URL? {
        var c = URLComponents(); c.scheme = "railisland"; c.host = "pass"; return c.url
    }

    private static func deepLink(sys: String, station: String) -> URL? {
        var c = URLComponents()
        c.scheme = "railisland"
        c.host = "metro-wait"
        c.queryItems = [URLQueryItem(name: "sys", value: sys),
                        URLQueryItem(name: "station", value: station)]
        return c.url
    }
}

struct MetroBoardWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "MetroBoardWidget", intent: MetroBoardIntent.self,
                               provider: MetroBoardProvider()) { entry in
            MetroBoardView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("捷運看板")
        .description("選一個捷運站，看下一班還有多久。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// 🔴 MetroFetcher(官方看板抓取與 App Group 快取)已搬到 App/MetroWidgetShared.swift,
//    MetroWidgetCatalog 的 lineColorHexes／lineIDsAt 兩個查詢方法也一併過去了——
//    等車卡的背景開卡走 App target,那邊沒有本檔(WidgetKit 畫面層)。呼叫方式零變化。

struct MetroBoardView: View {
    let entry: MetroEntry
    @Environment(\.widgetFamily) var family

    private var rowLimit: Int { family == .systemSmall ? 2 : (family == .systemMedium ? 4 : 6) }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                if let c = entry.lineColor { Circle().fill(c).frame(width: 8, height: 8) }
                Text(RailNativeL10n.name(entry.title)).font(.headline).lineLimit(1)
                if entry.auto {
                    // 自動解析出來的站掛小徽章,跟手選站區分(文字徽章,UI 控件不用 emoji)。
                    Text(RailNativeL10n.text("自動")).font(.system(size: 9)).foregroundStyle(.secondary)
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Capsule().fill(.quaternary))
                }
                Spacer(minLength: 4)
                // 🔴 資料時刻永遠顯示。WidgetKit 不保證刷新頻率,不標時刻就是在假裝即時。
                Text(stampText).font(.caption2).foregroundStyle(.secondary)
            }
            if let last = entry.lastTrain {
                Text(RailNativeL10n.text("末班 {time}", ["time": last])).font(.caption2).foregroundStyle(.orange).lineLimit(1)
            }
            if !visibleRows.isEmpty {
                ForEach(Array(visibleRows.prefix(rowLimit).enumerated()), id: \.offset) { _, r in
                    MetroRowView(row: r, precision: entry.precision,
                                 showCrowd: family != .systemSmall,
                                 entryDate: entry.date,
                                 lineColor: entry.sys.flatMap {
                                     MetroPalette.rowColor(sys: $0, station: entry.title,
                                                           dest: r.dest, lineCode: r.lineCode,
                                                           trainNo: r.trainNo)
                                 })
                }
            } else if entry.snapshot?.rows.isEmpty == false {
                // 有資料但全被「到站+30秒退場」濾光=資料視野(≈12分鐘)用完了,WidgetKit 還沒給
                // 下一次刷新——這不是「官方沒班次」,寫成那樣會被讀成末班已過(真機回饋 08-14)。
                Text(RailNativeL10n.text("資料過舊，打開軌島即更新")).font(.caption).foregroundStyle(.secondary)
            } else if let cta = entry.passCTA {
                // 通行證閘門:明講「為什麼看不到、點下去去哪」。用主色而非 secondary——
                // 它是行動邀請不是錯誤訊息;小卡容得下三行,大卡更寬鬆,故不設 lineLimit。
                Text(RailNativeL10n.text(cta)).font(.caption).foregroundStyle(.primary)
            } else {
                // autoHint:自動選站解析失敗的指引(定位權限/從沒定位過),比通用文案可行動。
                Text(RailNativeL10n.text(entry.autoHint ?? entry.emptyText(at: entry.date)))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
    }

    var body: some View {
        // 🔴 點整張卡 ＝ 在【背景】開等車卡,不打開 App(MetroWaitStartIntent)。
        //    舊做法是 widgetURL 深連結,得先把 App 叫到前景才開得了卡——而使用者「點完小工具
        //    就鎖屏、一直沒回 App」時,App 永遠停在背景,iOS 就永遠拒絕 Activity.request。
        // 沒有 waitTarget 的兩種卡照舊走深連結:通行證 CTA 要把人送到方案頁(railisland://pass),
        // 未選站時 deepLink 為 nil、widgetURL(nil) 就是預設行為(單純開 App)。
        if let t = entry.waitTarget {
            Button(intent: MetroWaitStartIntent(sys: t.sys, station: t.station, dest: t.dest)) {
                cardBody
            }
            // 🔴 .plain:不加的話 button 的 UA 樣式會把整張卡染成強調色並加上按壓底,
            //    版面與現況不再逐像素相同。
            .buttonStyle(.plain)
        } else {
            cardBody.widgetURL(entry.deepLink)
        }
    }

    /// 依 entry 時刻過濾:到站超過 30 秒的列整列退場(timeline 在 eta+31 有預排邊界 entry)。
    /// 分鐘級(etaEpoch nil)不過濾——沒有絕對時刻可判,列到下次刷新為止。
    private var visibleRows: [MetroRow] {
        guard let rows = entry.snapshot?.rows else { return [] }
        return rows.filter { $0.etaEpoch == nil || $0.etaEpoch! + 30 > entry.date.timeIntervalSince1970 }
    }

    private var stampText: String {
        guard let at = entry.snapshot?.dataAt else { return "—" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        // 時區錨定 Asia/Taipei,不用裝置時鐘(timezone-anchor 契約;人在國外看家鄉班次時尤其重要)。
        f.timeZone = TimeZone(identifier: "Asia/Taipei")
        return (entry.failed ? "⚠ " : "") + RailNativeL10n.text("{time} 更新", [
            "time": f.string(from: Date(timeIntervalSince1970: at))
        ])
    }
}

struct MetroRowView: View {
    let row: MetroRow
    let precision: String
    let showCrowd: Bool
    var entryDate: Date = Date()
    // 混合大卡(systemLarge)整列等比放大用;預設 1=北捷卡原樣(既有呼叫端零變化)。
    // 字級與槽寬(56pt trailing 槽、38pt 擁擠欄)一起縮放,對齊鐵則才不會在放大後破掉。
    var fontScale: CGFloat = 1
    /// 這一班所屬路線的色票。推不出唯一解時為 nil ⇒ 不畫點(見 MetroPalette.rowColor)。
    var lineColor: Color? = nil

    var body: some View {
        HStack(spacing: 6) {
            // 🔴 轉乘站(台北車站=紅+藍)的每一列各屬不同路線,線色必須逐列畫;
            //    站別標頭那顆點只在單線站出現。沒有色票時佔位保持不變,列與列的文字仍對齊。
            Circle().fill(lineColor ?? .clear).frame(width: 7 * fontScale, height: 7 * fontScale)
            // 🔴 小尺寸卡的可用寬本來就緊(「往 南港展覽館」＋倒數槽幾乎填滿),多了色點更緊 ⇒
            //    允許小幅縮字,寧可字小一點也不要把站名截成「往 南港展覽…」。
            Text(RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(row.dest)]))
                .font(.system(size: 13 * fontScale))
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            if precision == "sec", let eta = row.etaEpoch {
                // 🔴 真機回饋(08-14):倒數歸零後停在 0:00 是殭屍——已到點的列改顯示「進站」。
                //    判準用 entry.date(timeline 在每個到站時刻+1s 預排了 entry),
                //    不用 Date()(封存時刻,不會隨時間重算)。
                // 🔴 進站字樣與倒數共用同一個 56pt trailing 槽——真機回饋(08-14 第三輪):
                //    倒數有 frame、進站沒有 ⇒ 兩種列的右緣對不齊。
                if eta <= entryDate.timeIntervalSince1970 + 1 {
                    Text(RailNativeL10n.text("進站")).font(.system(size: 13 * fontScale, weight: .semibold))
                        .foregroundStyle(Color(.sRGB, red: 0.29, green: 0.87, blue: 0.50))
                        .frame(maxWidth: 56 * fontScale, alignment: .trailing)
                } else {
                    // 北捷是絕對時刻 ⇒ 交給系統自走,刷新之間也是對的。
                    // 🔴 range 起點必須 clamp:模型層濾掉 eta<=now 用的是「entry 建立時」的 now,
                    //    body 實際被封存(archive)可能晚幾秒;ClosedRange 下界大於上界會當場 crash。
                    let end = Date(timeIntervalSince1970: eta)
                    Text(timerInterval: min(Date(), end)...end, countsDown: true)
                        .monospacedDigit().font(.system(size: 14 * fontScale, design: .rounded))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 56 * fontScale, alignment: .trailing)
                }
            } else if let m = row.minutes {
                // 🔴 官方只給整數分鐘 ⇒ 顯示「約 N 分」的靜態文字,不換算成秒、不自走。
                Text(RailNativeL10n.text("約 {n} 分", ["n": String(m)]))
                    .monospacedDigit().font(.system(size: 14 * fontScale, design: .rounded))
            }
            if showCrowd {
                // 使用者真機回饋(08-14):同一張卡混到沒有擁擠度的線(北捷卡的文湖線)時,
                // 那一列的時間被推到最右、跟其他列的時間欄對不齊。
                // ⇒ 擁擠區固定寬佔位:沒資料的列維持【透明空白】(不畫灰格,
                //    灰格會被讀成「量到了但沒人」),但佔住等寬讓每列時間縱向對齊。
                HStack(spacing: 1.5) {
                    if let c = row.crowd, !c.isEmpty {
                        ForEach(Array(c.enumerated()), id: \.offset) { _, v in
                            RoundedRectangle(cornerRadius: 1.5)
                                .fill(MetroPalette.crowd(v)).frame(width: 5 * fontScale, height: 9 * fontScale)
                        }
                    }
                }
                .frame(width: 38 * fontScale, alignment: .trailing)
            }
            // showCrowd=false 的整卡(高捷/機捷)全卡都沒有擁擠欄,時間本來就對齊,不佔位。
        }
    }
}

enum MetroPalette {
    /// 線代碼 → 色票。規則(含主/子線退路)搬到 MetroWidgetCatalog.lineHex —— 等車卡的背景
    /// 開卡在 App target 也要同一條規則,不可以兩邊各留一份會各自漂移的複本。
    private static func lineHex(sys: String, code: String) -> String? {
        MetroWidgetCatalog.shared.lineHex(sys: sys, code: code)
    }

    private static func parse(_ raw: String) -> Color? {
        var s = raw; if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255,
                            green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }

    /// 站別標頭的點:【只有單一路線的站才畫】。
    /// 🔴 真機回饋(08-15):台北車站原本畫紅點,底下卻列著藍線(板南線)的班次——
    ///    轉乘站取第一條線等於隨機指定一條,是錯的識別而不是不精確的識別。
    ///    識別不了就不畫;每一列自己的線色由 rowColor 負責,資訊不會因此消失。
    static func color(sys: String, station: String) -> Color? {
        let hexes = MetroWidgetCatalog.shared.lineColorHexes(sys: sys, station: station)
        guard hexes.count == 1 else { return nil }
        return parse(hexes[0])
    }

    /// 單一班次的線色。路線本身怎麼判在 `MetroBoardModel.resolveLine`(純函式,被驗收腳本
    /// 逐案測);這裡只負責把線 id 換成色票,以及最後那層「路線分不出、但候選路線同色」的退路。
    static func rowColor(sys: String, station: String, dest: String, lineCode: String?,
                         trainNo: String?) -> Color? {
        let cat = MetroWidgetCatalog.shared
        if let code = MetroBoardModel.resolveLine(joined: lineCode, trainNo: trainNo,
                                                  station: station, dest: dest,
                                                  stationLines: cat.lineIDsAt(sys: sys, station: station),
                                                  destLines: cat.lineIDsAt(sys: sys, station: dest)),
           let hex = lineHex(sys: sys, code: code) { return parse(hex) }
        // 退路:路線分不出唯一解,但候選路線【色票相同】時照樣上色——中和新蘆線在目錄裡
        // 拆成迴龍/蘆洲兩支、共用同一個色票(實測 300 種真實組合中有 11 種是這樣)。
        // 色票也不唯一就回 nil、那一列不畫點,寧可不畫也不猜。
        let here = cat.lineColorHexes(sys: sys, station: station)
        let there = cat.lineColorHexes(sys: sys, station: dest)
        let shared = here.filter(there.contains)
        guard shared.count == 1 else { return nil }
        return parse(shared[0])
    }
    /// 官方擁擠度等級。數值語意由官方定義,我們只上色不重新分級。
    static func crowd(_ v: Int) -> Color {
        switch v {
        case ...1: return Color(.sRGB, red: 0.29, green: 0.80, blue: 0.45)   // 舒適
        case 2: return Color(.sRGB, red: 0.95, green: 0.75, blue: 0.20)      // 普通
        case 3: return Color(.sRGB, red: 0.94, green: 0.49, blue: 0.20)      // 略擁擠
        default: return Color(.sRGB, red: 0.85, green: 0.25, blue: 0.25)     // 擁擠
        }
    }
}

enum MetroLastTrain {
    /// 末班車發車前 60 分鐘內才顯示。回傳最早的那個方向的末班時刻(官方原字串,照抄不重排)。
    static func within60min(catalog: MetroWidgetCatalog, sys: String, station: String, now: Double) -> String? {
        var best: (String, Double)?
        for (k, hhmm) in catalog.lastTrain where k.hasPrefix("\(sys)|\(station)|") {
            // 🔴 TDX 把跨午夜末班存成 "00:00"／"01:08"(TRTC 檔前幾列就是),不是 "24:xx"。
            //    只算「今天」的話,23:20 查 00:00 的末班會得到負 delta 而永遠不顯示——
            //    對凌晨收班的線,末班提醒在收班前的黃金一小時反而全滅。
            //    修法:過去的時刻一律往後推一天(下一次出現),再套 60 分鐘窗。
            guard let t = nextOccurrence(hhmm, now: now) else { continue }
            let delta = t - now
            if delta >= 0, delta <= 3600, best == nil || t < best!.1 { best = (hhmm, t) }
        }
        return best?.0
    }

    /// "23:58" → 下一次出現的 epoch(Asia/Taipei)。已過就推到隔天;"24:10" 型也自然落在隔天。
    private static func nextOccurrence(_ hhmm: String, now: Double) -> Double? {
        let p = hhmm.split(separator: ":")
        guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Taipei")!
        let base = cal.startOfDay(for: Date(timeIntervalSince1970: now))
        var t = base.timeIntervalSince1970 + Double(h * 3600 + m * 60)
        if t < now { t += 86_400 }
        return t
    }
}
