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
    // 這一站是【退快取】來的:這一輪拿不到定位,畫的是上次解析出來的位置。徽章要改口說
    // 「上次位置」,不能與剛定位到的狀態長得一樣(見 MetroNearest.resolve 的紅字)。
    var autoStale: Bool = false
    var autoHint: String? = nil // 自動選站解析失敗時的空狀態指引(蓋過通用的「沒有資料」)
    // 通行證閘門擋下時的明講 CTA(2026-08-15)。🔴 這個專案已經有三個「不給用也不說」的付費
    // 功能,這裡一律講清楚「為什麼看不到、去哪裡買」,不做靜默空白卡。
    var passCTA: String? = nil
    // 每一列的線色要靠「系統＋本站＋該列終點」推(見 MetroPalette.rowLine),故 entry 要帶系統 id。
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

    /// 空白看板要顯示的那一行，以及它是不是「行動邀請」（通行證 CTA 用主色，不是錯誤訊息）。
    ///
    /// 🔴 小卡與混合大卡共用這一份。改版前混合卡自己只印一句 emptyText，於是通行證閘門
    ///    （needPassAuto／needPassMulti）與自動選站失敗的指引在大卡上【完全不講】——
    ///    「付費功能被擋住卻不說」是這個專案反覆踩的坑，兩張卡的說法一律走同一個出口。
    func emptyBody(at date: Date) -> (text: String, isCTA: Bool) {
        // 有資料但全被「到站+30 秒退場」濾光＝資料視野用完了，不是官方沒班次。
        if snapshot?.rows.isEmpty == false { return (RailNativeL10n.text("資料過舊，打開軌島即更新"), false) }
        if let cta = passCTA { return (RailNativeL10n.text(cta), true) }
        // autoHint：自動選站解析失敗的指引（定位權限／從沒定位過），比通用文案可行動。
        return (RailNativeL10n.text(autoHint ?? emptyText(at: date)), false)
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
        //
        // 🔴 改版後(2026-08-17)邊界從兩個變成一整排。原因:改版前倒數是 Text(timerInterval:),
        //    系統自己逐秒重畫,所以只需要「進站」與「退場」兩個轉折;改版後畫的是
        //    RailCountdown 的靜態「N 分」(設計稿明令不做 m:ss 碼錶格式),而靜態文字【不會自己變】
        //    ⇒ 每一次分鐘翻頁都必須有一個 entry,否則卡上那個數字會停在原地不動,
        //    正是設計稿說的「停住的數字比空白更危險」。
        //    每個到站時刻要排:
        //      · 分鐘翻頁 eta − 60k + 1(k=1…12):此刻 floor((eta−t)/60) 恰好翻成 k−1。
        //        k=1 給的 eta−59 就是換「進站」的那一刻(RailCountdown.from 在 <60 秒進 arriving),
        //        所以不必再排舊版的 eta+1。
        //      · eta+31 該列退場。30 秒停留與 App 看板 TRTC_OFFICIAL_BOARD_ARRIVING_GRACE_SEC 同值。
        //    etas 不濾掉已過去的:剛到 10 秒的車還要它的 +31 退場邊界。
        //    entries 上限 60:官方視野約 12 分鐘、8 個到站點各 12 個翻頁點會超過 90 個,
        //    而 policy 是 .atEnd ⇒ 被截掉的尾段會由「用完就重新要一輪」自動補上,
        //    不是靜默漏畫(截斷點取【時間最早的 60 個】,近未來完整、遠未來交給下一輪)。
        var entries = [e]
        var hasBounds = false
        if let rows = e.snapshot?.rows {
            let now = Date().timeIntervalSince1970
            let etas = Set(rows.compactMap(\.etaEpoch)).sorted().prefix(8)
            // 🔴 這一段刻意寫成明確型別的迴圈，不要收回 flatMap 一行式：
            //    `Set(etas.flatMap { (1...12).map { … } + [eta + 31] })` 會讓 Swift 對
            //    「Double 算式 × 陣列相加 × Set/sorted/prefix」的多載組合爆搜，回
            //    "the compiler is unable to type-check this expression in reasonable time"
            //    ⇒ 整個 widget target 編不過（實測 arm64-apple-ios17.6 必現）。
            var raw: [Double] = []
            for eta in etas {
                for k in 1...12 { raw.append(eta - Double(k) * 60.0 + 1.0) }
                raw.append(eta + 31.0)
            }
            let bounds = Set(raw.filter { $0 > now }).sorted().prefix(60)
            hasBounds = !bounds.isEmpty
            entries += bounds.map { t in
                MetroEntry(date: Date(timeIntervalSince1970: t), title: e.title,
                           lineColor: e.lineColor, snapshot: e.snapshot, precision: e.precision,
                           lastTrain: e.lastTrain, failed: e.failed, deepLink: e.deepLink,
                           auto: e.auto, autoStale: e.autoStale, autoHint: e.autoHint,
                           passCTA: e.passCTA, sys: e.sys,
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
        var isAutoStale = false
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
                              passCTA: RailNativeL10n.text("自動選最近的站是通行證功能。點一下開啟軌島看方案，或改選一個固定車站。"))
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
            switch await MetroNearest.resolve(catalog: catalog) {
            case .some((.serviceable(let sys, let station), let stale)):
                sysID = sys; stationName = station; isAutoStale = stale
            // 定位到了但最近的站太遠(出了雙北／高雄／機捷沿線)。硬解析下去只會畫出一張
            // 幾十公里外那一站的秒級倒數——看起來正常但對使用者零意義,故直說範圍外並
            // 給出路(改選固定車站)。這一支不打官方 API。
            case .some((.outOfRange(let station, let meters), _)):
                return MetroEntry(date: Date(), title: "不在服務範圍", lineColor: nil,
                                  snapshot: nil, precision: "sec", lastTrain: nil, failed: false,
                                  autoHint: MetroNearestMath.outOfRangeHint(station: station,
                                                                            meters: meters))
            case .none:
                return MetroEntry(date: Date(), title: "自動選站", lineColor: nil, snapshot: nil,
                                  precision: "sec", lastTrain: nil, failed: false,
                                  autoHint: RailNativeL10n.text("開啟 App 一次，或到「設定 › 軌島」允許取用位置"))
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
        // 「不指定」哨兵在這裡收成 nil;自動選站解析出來的站也不套方向(方向是為手選的那一站挑的)。
        let dir = isAuto ? nil : MetroBoardIntent.direction(cfg.dir)
        let filtered = dir.flatMap { d in
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
                          auto: isAuto, autoStale: isAutoStale, sys: sys.id,
                          // 自動選站解析出來的站不套方向格(方向是為手選的那一站挑的),
                          // 與上面 filtered 的條件同源,免得卡上列的與追蹤的不是同一批。
                          waitTarget: MetroWaitTarget(sys: sys.id, station: station,
                                                      dest: dir))
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

// 🔴 MetroFetcher(官方看板抓取與 App Group 快取,含 approx 旗標的往返)已搬到
//    App/MetroWidgetShared.swift,MetroWidgetCatalog 的查詢 extension 也一併過去了——
//    等車卡的背景開卡走 App target,那邊沒有本檔(WidgetKit 畫面層)。呼叫方式零變化。

// ── 改版後的版面（2026-08-17，依 Claude Design「軌島 iOS Widget 與 Live Activity」）─────
//
// 設計稿對改版前這張卡的三個具體批評，逐條對應在下面：
//  1.「2:37」這種碼錶格式讀不出「還有多久」——`Text(timerInterval:)` 的格式由系統定死成
//     m:ss，而「1:30」在候車情境會被讀成一小時半。改成一個大數字＋小單位（「3 分」），
//     由 timeline 預排的【分鐘邊界】推進（見 provider 的 minuteBounds）。
//  2. 忠孝復興那張兩列都寫「往 南港展覽館」，只靠咖啡點與藍點區分文湖線與板南線 ⇒ 讀不出來，
//     而且 tinted 模式下顏色整個失效。改成路線色一定伴隨線名（RailLineMark）。
//  3. 全卡視覺重量一致、留大片空白 ⇒ 一主多從：主班用 hero 字級，後續班次小一號。
//
// 版面高度預算（設計稿的硬約束，超出一律【砍列】不縮字）：
//  Small  內容 138×138：識別 20 ／站名 24 ／方向 19 ／倒數 44 ／註腳 16 ＝ 123＋間距
//  Medium 內容 332×138：卡頭 21 ＋ 8 ＋ 主班 43 ＋ hairline 9 ＋ 從班 28×2 ＝ 137
//  Large  內容 332×346：同骨架，從班 32pt、最多 6 列
//
// 🔴 Small 從「兩列列表」改成「單班大卡」是【內容減量】：改版前小卡列兩列（可能是兩個方向），
//    改版後只講一班。設計稿的取捨是「小卡上兩列都讀不清，不如一班讀得準」，而代價是
//    雙向站的小卡使用者少看到一個方向。已在交付時明講給使用者裁示。

struct MetroBoardView: View {
    let entry: MetroEntry
    @Environment(\.widgetFamily) var widgetFamily
    @Environment(\.widgetRenderingMode) var renderingMode
    // 🔴 算繪 harness 的覆寫哨兵。出貨路徑恆為 nil ⇒ 一律讀真正的 \.widgetFamily。
    //    為什麼需要它見 RailWidgetKit.swift 的 railFamilyOverride（previewContext 對裸執行檔無效）。
    @Environment(\.railFamilyOverride) var familyOverride

    private var family: WidgetFamily { familyOverride ?? widgetFamily }

    private var cardBody: some View {
        GeometryReader { geo in
            let scale = RailScale(width: geo.size.width,
                                  reference: family == .systemSmall ? RailScale.smallReference
                                                                    : RailScale.mediumReference)
            Group {
                if family == .systemSmall {
                    smallCard(scale)
                } else {
                    listCard(scale)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .railRenderingMode(renderingMode)
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

    // MARK: - Small：單班大卡

    @ViewBuilder private func smallCard(_ scale: RailScale) -> some View {
        if let lead = visibleRows.first {
            let ln = line(lead)
            VStack(alignment: .leading, spacing: scale.pt(3)) {
                // 識別列：路線標（點＋線名）＋資料時刻。線名認不出來時整顆撤掉，不畫沒標籤的點。
                HStack(spacing: scale.pt(4)) {
                    if let name = ln.name {
                        RailLineMark(name: name, color: ln.color, fontSize: 12, scale: scale)
                    }
                    Spacer(minLength: scale.pt(2))
                    // 🔴 suffix 不可省成裸時刻:「15:33」單獨出現會被讀成【發車時刻】,
                    //    而它是資料時刻。量過寬度:「環狀線」46＋「15:33 更新」55＝101,138pt 放得下。
                    RailStamp(text: stampTime, warn: entry.failed, scale: scale)
                }
                .frame(height: scale.pt(20))

                // accented 模式：站名、方向與倒數是主角（設計稿「主角與倒數加
                // .widgetAccentable()」），識別列與註腳留在 base 群組。
                stationName(scale, size: 20)
                    .frame(height: scale.pt(24), alignment: .leading)
                    .widgetAccentable()

                Text(RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(lead.dest)]))
                    .font(.system(size: scale.pt(15)))
                    .foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.85)
                    .frame(height: scale.pt(19), alignment: .leading)
                    .widgetAccentable()

                RailCountdownText(value: countdown(lead), size: .heroCard, scale: scale)
                    .frame(height: scale.pt(44), alignment: .leading)
                    .widgetAccentable()

                // 註腳：擁擠度＋同方向的再下一班。兩者都沒有時整列留空（不寫佔位文字）。
                HStack(spacing: scale.pt(6)) {
                    if let c = lead.crowd, !c.isEmpty {
                        RailCarriageMeter(levels: c, scale: scale)
                    }
                    if let nxt = nextSameDirection(after: lead) {
                        Text(nextText(nxt)).font(.system(size: scale.pt(12)))
                            .foregroundStyle(.secondary).lineLimit(1).fixedSize()
                    }
                    Spacer(minLength: 0)
                }
                .frame(height: scale.pt(16))
            }
        } else {
            VStack(alignment: .leading, spacing: scale.pt(6)) {
                HStack(spacing: scale.pt(4)) {
                    stationName(scale, size: 17)
                    Spacer(minLength: scale.pt(2))
                }
                .frame(height: scale.pt(21))
                emptyBody(scale)
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: - Medium／Large：一主多從

    @ViewBuilder private func listCard(_ scale: RailScale) -> some View {
        let rows = visibleRows
        let follows = Array(rows.dropFirst().prefix(followLimit))
        VStack(alignment: .leading, spacing: 0) {
            RailCardTitle(title: RailNativeL10n.name(entry.title), scale: scale) {
                HStack(spacing: scale.pt(4)) {
                    if entry.auto { autoBadge(scale) }
                    RailStamp(text: stampTime, warn: entry.failed, scale: scale)
                }
            }
            if let last = entry.lastTrain {
                // 末班車是【車站層】的事實，不屬於任何一列 ⇒ 掛在標題底下、與標題同一個左緣，
                // 不掛進某一列的內容欄（掛進去會被讀成「那一班是末班車」）。
                RailStatusTag(kind: .lastTrainAt(last), fontSize: 12, scale: scale)
                    .frame(height: scale.pt(18), alignment: .leading)
                Spacer().frame(height: scale.pt(4))
            } else {
                Spacer().frame(height: scale.pt(4))
            }
            if let lead = rows.first {
                MetroRowView(row: lead, precision: entry.precision, role: .hero,
                             entryDate: entry.date, sys: entry.sys, station: entry.title,
                             scale: scale)
                // 主班與從班之間沒有分隔線也沒有固定間距（v2：看板類卡片不畫分列線），
                // 剩下的高度全推到這裡，從班貼著卡底對齊。
                Spacer(minLength: 0)
                ForEach(Array(follows.enumerated()), id: \.offset) { i, r in
                    MetroRowView(row: r, precision: entry.precision,
                                 role: family == .systemLarge ? .followLarge : .follow,
                                 entryDate: entry.date, sys: entry.sys, station: entry.title,
                                                                  disambiguate: ambiguousDests.contains(r.dest), scale: scale)
                }
            } else {
                emptyBody(scale)
                // 🔴 空狀態才在末尾補彈簧。有班次時末尾【不能】再放一個——兩個 Spacer
                //    會把剩餘高度對半分，從班就浮在卡片中間而不是貼著卡底。
                Spacer(minLength: 0)
            }
        }
    }

    /// 從班列數上限。從【實測的內容框高度】推，不是手打的常數：
    ///   Medium 內容框 138：卡頭 21 ＋ 4 ＋ 主班 44 ＝ 69 ⇒ 剩 69 ÷ 22 ＝ 3 列（共四班）
    ///   Large  內容框 350：同上 69 ⇒ 剩 281 ÷ 32 ＝ 8 列
    /// 🔴 v2 把 Medium 從三班改成四班：分隔線那 9pt 與列高的 6pt 都拿去換一列。
    /// 🔴 末班車那一行把「4pt 間距」換成「18＋4」＝多吃 18pt ⇒ 依設計稿「超出先砍列不縮字」
    ///    少列一班，不是把列高壓小（壓小會讓同一張卡在兩種狀態下列高不同，縱向對齊當場破掉）。
    /// 🔴 Large 一開始寫 6 是照設計稿字面，但實測那樣底部會空 77pt——正是設計稿自己批評的
    ///    「留大片空白」。官方視野約 12 分鐘、台北車站這種大站排得滿，8 列排得下就排。
    private var followLimit: Int {
        let hasLast = entry.lastTrain != nil
        return family == .systemLarge ? (hasLast ? 7 : 8) : (hasLast ? 2 : 3)
    }

    // MARK: - 零件

    private func stationName(_ scale: RailScale, size: CGFloat) -> some View {
        HStack(spacing: scale.pt(4)) {
            Text(RailNativeL10n.name(entry.title))
                .font(.system(size: scale.pt(size), weight: .semibold))
                .lineLimit(1).minimumScaleFactor(0.8)
            if entry.auto { autoBadge(scale) }
        }
    }

    /// 自動解析出來的站掛小徽章,跟手選站區分(文字徽章,UI 控件不用 emoji)。
    /// 退快取時改口說「上次位置」——這一輪沒拿到定位,站名是上次的,必須看得出來。
    private func autoBadge(_ scale: RailScale) -> some View {
        Text(RailNativeL10n.text(entry.autoStale ? "上次位置" : "自動"))
            .font(.system(size: scale.pt(9)))
            .foregroundStyle(.secondary)
            .padding(.horizontal, scale.pt(4)).padding(.vertical, scale.pt(1))
            .background(Capsule().fill(.quaternary))
            .fixedSize()
    }

    /// 四種空白原因＋通行證 CTA 的判準住在 MetroEntry.emptyBody（混合大卡共用同一份）。
    /// 這裡只負責畫：CTA 用主色（它是行動邀請不是錯誤訊息），其餘 secondary。
    /// 小卡容得下三行、大卡更寬鬆，故不設 lineLimit。
    @ViewBuilder private func emptyBody(_ scale: RailScale) -> some View {
        let body = entry.emptyBody(at: entry.date)
        Text(RailNativeL10n.text(body.text))
            .font(.system(size: scale.pt(13)))
            .foregroundStyle(body.isCTA ? AnyShapeStyle(HierarchicalShapeStyle.primary)
                                        : AnyShapeStyle(HierarchicalShapeStyle.secondary))
    }

    /// 依 entry 時刻過濾:到站超過 30 秒的列整列退場(timeline 在 eta+31 有預排邊界 entry)。
    /// 分鐘級(etaEpoch nil)不過濾——沒有絕對時刻可判,列到下次刷新為止。
    private var visibleRows: [MetroRow] {
        guard let rows = entry.snapshot?.rows else { return [] }
        return rows.filter { $0.etaEpoch == nil || $0.etaEpoch! + 30 > entry.date.timeIntervalSince1970 }
    }

    /// 這張卡上看得見的列裡,出現過兩次以上的終點。只有這些列的次列要補線名。
    /// 判準取【看得見的那幾列】不是全部 rows:第七列也叫「往 南港展覽館」不會讓第二列變得難讀。
    private var ambiguousDests: Set<String> {
        let visible = Array(visibleRows.prefix(1 + followLimit))
        var seen: [String: Int] = [:]
        for r in visible { seen[r.dest, default: 0] += 1 }
        return Set(seen.filter { $0.value > 1 }.keys)
    }

    private func line(_ r: MetroRow) -> (color: Color?, name: String?) {
        guard let sys = entry.sys else { return (nil, nil) }
        return MetroPalette.rowLine(sys: sys, station: entry.title, dest: r.dest,
                                    lineCode: r.lineCode, trainNo: r.trainNo)
    }

    private func countdown(_ r: MetroRow) -> RailCountdown {
        MetroCountdown.of(row: r, precision: entry.precision, at: entry.date)
    }

    /// 小卡註腳的「再 N 分」＝【同一個方向】的下一班。
    /// 🔴 不能取「下一列」：沒設方向的雙向站，下一列很可能是反方向，寫成「再 3 分」等於謊報。
    private func nextSameDirection(after lead: MetroRow) -> MetroRow? {
        visibleRows.dropFirst().first { $0.dest == lead.dest }
    }

    private func nextText(_ r: MetroRow) -> String {
        switch countdown(r) {
        case .minutes(let m):       return RailNativeL10n.text("· 再 {n} 分", ["n": String(m)])
        case .approxMinutes(let m): return RailNativeL10n.text("· 再約 {n} 分", ["n": String(m)])
        case .seconds:              return RailNativeL10n.text("· 下一班即將進站")
        case .arriving:             return RailNativeL10n.text("· 下一班進站")
        // .until 只有跟車 Live Activity 會產生（`countdown(_:)` 這條路徑走不到），
        // 這裡只是讓 switch 窮盡；真要畫也不能畫成靜態字串（那正是 .until 要修的東西）。
        // .clock 只有台鐵／高鐵發車看板的「主要顯示發車時刻」設定會產生（捷運看板的
        // MetroBoardIntent 沒有那個選項），這條路徑走不到，列在這裡只為窮盡。
        case .noData, .scheduled, .clock, .until: return ""
        }
    }

    /// 資料時刻(HH:mm)。時區錨定 Asia/Taipei,不用裝置時鐘(timezone-anchor 契約;
    /// 人在國外看家鄉班次時尤其重要)。⚠ 前綴與警示色由 RailStamp 依 warn 負責。
    private var stampTime: String {
        guard let at = entry.snapshot?.dataAt else { return "—" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "Asia/Taipei")
        return f.string(from: Date(timeIntervalSince1970: at))
    }
}

/// 一列的倒數形態。抽成獨立型別，讓小卡、列表列與混合大卡走同一條規則
/// （改版前這段邏輯在 MetroRowView 與 MixedBoardWidget 各寫一份）。
enum MetroCountdown {
    static func of(row r: MetroRow, precision: String, at date: Date) -> RailCountdown {
        // 🔴 判準用 entry 的時刻,不用 Date():body 是被封存(archive)起來的,Date() 只會是
        //    封存那一刻,不會隨時間重算。timeline 已在每個分鐘邊界預排 entry。
        // 🔴 approx 列(伺服端推導的「再下一班」)必須先攔在秒級路徑前面:它的 etaEpoch 是
        //    投影值不是官方站牌原文,畫成 mm:ss 就是拿「約」的精度冒充官方精度。
        //    對映規則與分鐘級系統同一條:>0 畫「約 N 分」,≤0 畫「進站」。
        if r.approx, let eta = r.etaEpoch {
            let m = Int(ceil((eta - date.timeIntervalSince1970) / 60))
            return m <= 0 ? .arriving : .approxMinutes(m)
        }
        if precision == "sec", let eta = r.etaEpoch {
            return .from(secondsLeft: eta - date.timeIntervalSince1970, surface: .widget)
        }
        // 🔴 官方只給整數分鐘的系統走 .approxMinutes（畫面上多一個「約」字）——
        //    那個字是秒級與分鐘級精度差異在畫面上的唯一顯形處，不可省。
        //    🔴 但 0 分要畫「進站」不是「約 0 分」：官方給的 0 就是「現在到」，
        //    而「約 0 分」是讀不出意思的（哈瑪星那張實際算出來就是這個字樣）。
        //    這是官方值的【顯示對映】不是改值，與秒級 <60 秒進 arriving 同一條規則。
        if let m = r.minutes { return m <= 0 ? .arriving : .approxMinutes(m) }
        return .noData
    }
}

/// 看板的一列。三欄骨架由 RailRow 提供（軌脊 12 ／內容彈性 ／數字靠右）。
///
/// 🔴 線色與線名在這裡【一起查】(MetroPalette.rowLine)，呼叫端拿不到「只有顏色」的路徑——
///    設計稿規則 3「路線色一定伴隨線名」要靠介面讓它難以違反，不是靠註解提醒。
struct MetroRowView: View {
    enum Role { case hero, follow, followLarge }

    let row: MetroRow
    let precision: String
    var role: Role = .follow
    var entryDate: Date = Date()
    /// 線別要靠「系統＋本站＋該列終點」推，故兩者都要帶（見 MetroPalette.rowLine）。
    var sys: String? = nil
    var station: String = ""
    /// 這一列的終點在【同一張卡上看得見的其他列】裡也出現過 ⇒ 次列要補線名才分得出來。
    ///
    /// 🔴 設計稿的次列刻意【不畫線名、軌脊環也是灰的】（「主角有副標，次列沒有」），
    ///    而規則 3「路線色一定伴隨線名」在那裡是空成立的——次列根本不上路線色。
    ///    但設計稿的 Medium 示範用的是台北車站，三列三個不同終點；忠孝復興那張兩列
    ///    都寫「往 南港展覽館」（文湖線與板南線都到），照設計稿字面畫，次列會完全無從分辨
    ///    ——那正是這次改版要解決的那個缺陷。所以只在【真的撞名】時補線名，
    ///    常見情況維持設計稿的乾淨次列。
    var disambiguate: Bool = false
    var scale: RailScale = RailScale(k: 1)

    private var isHero: Bool { role == .hero }

    private var height: CGFloat {
        switch role {
        case .hero:        return RailRowHeight.hero
        case .follow:      return RailRowHeight.follow
        case .followLarge: return RailRowHeight.followLarge
        }
    }

    var body: some View {
        let ln = sys.map {
            MetroPalette.rowLine(sys: $0, station: station, dest: row.dest,
                                 lineCode: row.lineCode, trainNo: row.trainNo)
        } ?? (color: nil, name: nil)
        RailRow(height: height,
                numberWidth: isHero ? RailNumberColumn.wide(scale) : RailNumberColumn.narrow(scale),
                scale: scale) {
            if isHero {
                // 設計稿：「主角與倒數加 .widgetAccentable()，其餘留在 base 群組」——
                // accented 模式下系統把 accentable 群組染上使用者選的色、其餘壓成白，
                // 所以這裡只點名「往 X」與倒數，副標那一行（線名＋擁擠度）留在 base。
                Text(RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(row.dest)]))
                    .font(.system(size: scale.pt(20), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .widgetAccentable()
                HStack(spacing: scale.pt(6)) {
                    if let name = ln.name {
                        RailLineMark(name: RailNativeL10n.name(name), color: ln.color, fontSize: 13, scale: scale)
                    }
                    if let c = row.crowd, !c.isEmpty {
                        // 🔴 showWord 一律 true：設計稿規則 3「顏色不獨立表意」，六節色塊在
                        //    tinted／單色模式只剩深淺三階，那個詞是唯一還讀得出來的東西。
                        //    量過寬度：內容欄 232pt，「淡水信義線」＋六節＋「舒適」約 152pt，放得下。
                        RailCarriageMeter(levels: c, showWord: true, scale: scale)
                    }
                }
            } else {
                HStack(spacing: scale.pt(6)) {
                    Text(RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(row.dest)]))
                        .font(.system(size: scale.pt(17), weight: .medium))
                        .lineLimit(1).minimumScaleFactor(0.85)
                    if disambiguate, let name = ln.name {
                        RailLineMark(name: RailNativeL10n.name(name), color: ln.color, fontSize: 11, scale: scale)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: scale.pt(4))
                    // 次列的擁擠度【去詞留節】：設計稿的次列是單行,放不下詞;
                    // 色塊靠右貼著數字欄,與主角列的色塊左緣不同源是刻意的(主角有副標那一行)。
                    if let c = row.crowd, !c.isEmpty {
                        RailCarriageMeter(levels: c, showWord: false, scale: scale)
                    }
                }
            }
        } trailing: {
            RailCountdownText(value: MetroCountdown.of(row: row, precision: precision, at: entryDate),
                              size: isHero ? .heroRow : .row, scale: scale)
                .widgetAccentable()
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
    ///    識別不了就不畫;每一列自己的線色由 rowLine 負責,資訊不會因此消失。
    static func color(sys: String, station: String) -> Color? {
        let hexes = MetroWidgetCatalog.shared.lineColorHexes(sys: sys, station: station)
        guard hexes.count == 1 else { return nil }
        return parse(hexes[0])
    }

    /// 一列的路線識別：色票與線名【一起回】。
    ///
    /// 🔴 刻意合成一個回傳值而不是兩個查詢：改版後的規則是「路線色一定伴隨線名」
    ///    (設計稿規則 3)。拆成 rowColor()／rowName() 兩支，就會有呼叫端只叫其中一支、
    ///    畫出一顆沒有標籤的色點——那正是改版前忠孝復興那張讀不出線別的成因。
    ///    名字查不到時 name 為 nil，畫面層要連點一起不畫（見 MetroRowView）。
    static func rowLine(sys: String, station: String, dest: String, lineCode: String?,
                        trainNo: String?) -> (color: Color?, name: String?) {
        let cat = MetroWidgetCatalog.shared
        if let code = MetroBoardModel.resolveLine(joined: lineCode, trainNo: trainNo,
                                                  station: station, dest: dest,
                                                  stationLines: cat.lineIDsAt(sys: sys, station: station),
                                                  destLines: cat.lineIDsAt(sys: sys, station: dest)) {
            let name = cat.lineNameByID["\(sys)|\(code)"]
            if let hex = lineHex(sys: sys, code: code) { return (parse(hex), name) }
            return (nil, name)
        }
        // 退路:路線分不出唯一解,但候選路線【色票相同】時照樣上色——中和新蘆線在目錄裡
        // 拆成迴龍/蘆洲兩支、共用同一個色票(實測 300 種真實組合中有 11 種是這樣)。
        // 色票也不唯一就回 nil、那一列不畫點,寧可不畫也不猜。
        let here = cat.lineColorHexes(sys: sys, station: station)
        let there = cat.lineColorHexes(sys: sys, station: dest)
        let shared = here.filter(there.contains)
        guard shared.count == 1 else { return (nil, nil) }
        // 走到這裡代表線 id 不唯一（例：迴龍/蘆洲），色票相同但【線名不同】⇒ 名字一律不給。
        // 猜一個線名比不寫更糟：它是識別，錯的識別比沒有識別危險（同 color(sys:station:) 的理由）。
        return (parse(shared[0]), nil)
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
