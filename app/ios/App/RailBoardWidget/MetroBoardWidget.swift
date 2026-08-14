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
        return Timeline(entries: [e], policy: .after(Date().addingTimeInterval(10 * 60)))
    }

    private func entry(for cfg: MetroBoardIntent) async -> MetroEntry {
        let catalog = MetroWidgetCatalog.shared
        let parts = (cfg.station ?? "").split(separator: "|", maxSplits: 1).map(String.init)
        guard parts.count == 2, let sys = catalog.systems.first(where: { $0.id == parts[0] }) else {
            return MetroEntry(date: Date(), title: "請選擇車站", lineColor: nil, snapshot: nil,
                              precision: "sec", lastTrain: nil, failed: false)
        }
        let station = parts[1]
        let alias = catalog.alias[sys.id] ?? [:]
        let now = Date().timeIntervalSince1970
        var snap: MetroSnapshot?
        var failed = false
        do {
            let data = try await MetroFetcher.fetch(sys: sys.id)
            snap = sys.precision == "sec"
                ? try MetroBoardModel.trtc(json: data, station: station, alias: alias, now: now)
                : try MetroBoardModel.minuteSystem(json: data, station: station, alias: alias, now: now)
            MetroFetcher.cache(snap!, sys: sys.id, station: station)
        } catch {
            // 🔴 抓取失敗顯示上次成功的資料＋當時的時刻,不清空、不留白。
            snap = MetroFetcher.cached(sys: sys.id, station: station)
            failed = true
        }
        let filtered = cfg.dir.flatMap { d in
            snap.map { MetroSnapshot(station: $0.station, dataAt: $0.dataAt,
                                     rows: $0.rows.filter { $0.dest == d }, stale: $0.stale) }
        } ?? snap
        return MetroEntry(date: Date(), title: station,
                          lineColor: MetroPalette.color(sys: sys.id, station: station),
                          snapshot: filtered, precision: sys.precision,
                          lastTrain: MetroLastTrain.within60min(catalog: catalog, sys: sys.id,
                                                               station: station, now: now),
                          failed: failed,
                          deepLink: Self.deepLink(sys: sys.id, station: station))
    }

    // 🔴 站名是中文:URL(string:) 對非 ASCII 插值會回 nil ⇒ 深連結整條靜默死掉。
    //    一律走 URLComponents 讓它做 percent-encoding。
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

enum MetroFetcher {
    // 端點已存在,Worker 零改動。edge cache s-maxage=15 ⇒ 小工具的請求絕大多數打在快取上。
    static func url(sys: String) -> URL {
        sys == "trtc"
            ? URL(string: "https://railisland.tw/api/trtc-live")!
            : URL(string: "https://railisland.tw/api/metro-live?sys=\(sys)")!
    }

    static func fetch(sys: String) async throws -> Data {
        var req = URLRequest(url: url(sys: sys))
        // 小工具的刷新機會很少,寧可失敗得快也不要卡住整條 timeline。
        req.timeoutInterval = 8
        req.setValue("RailIsland-Widget", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return data
    }

    // 🔴 快取放 App Group 的 UserDefaults,鍵前綴 metro.snapshot.——
    //    刻意不寫看板檔目錄,也不碰 meta.json／boardFormatVersion(那是發車看板的地盤)。
    private static let suite = UserDefaults(suiteName: "group.tw.railisland.app")
    private static func key(_ sys: String, _ station: String) -> String { "metro.snapshot.\(sys)|\(station)" }

    static func cache(_ s: MetroSnapshot, sys: String, station: String) {
        let rows = s.rows.map { r -> [String: Any] in
            var d: [String: Any] = ["dest": r.dest]
            if let e = r.etaEpoch { d["eta"] = e }
            if let m = r.minutes { d["min"] = m }
            if let c = r.crowd { d["crowd"] = c }
            return d
        }
        suite?.set(["at": s.dataAt, "rows": rows, "stale": s.stale], forKey: key(sys, station))
    }

    static func cached(sys: String, station: String) -> MetroSnapshot? {
        guard let o = suite?.dictionary(forKey: key(sys, station)),
              let at = o["at"] as? Double, let raw = o["rows"] as? [[String: Any]] else { return nil }
        let rows = raw.map { r in
            MetroRow(dest: r["dest"] as? String ?? "", etaEpoch: r["eta"] as? Double,
                     minutes: r["min"] as? Int, crowd: r["crowd"] as? [Int])
        }
        // 🔴 Swift 的 memberwise init 必須照【宣告順序】給參數,不能重排:
        //    MetroSnapshot 是 station → dataAt → rows → stale。
        return MetroSnapshot(station: station, dataAt: at, rows: rows,
                             stale: o["stale"] as? Bool ?? false)
    }
}

struct MetroBoardView: View {
    let entry: MetroEntry
    @Environment(\.widgetFamily) var family

    private var rowLimit: Int { family == .systemSmall ? 2 : (family == .systemMedium ? 4 : 6) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                if let c = entry.lineColor { Circle().fill(c).frame(width: 8, height: 8) }
                Text(entry.title).font(.headline).lineLimit(1)
                Spacer(minLength: 4)
                // 🔴 資料時刻永遠顯示。WidgetKit 不保證刷新頻率,不標時刻就是在假裝即時。
                Text(stampText).font(.caption2).foregroundStyle(.secondary)
            }
            if let last = entry.lastTrain {
                Text("末班 \(last)").font(.caption2).foregroundStyle(.orange).lineLimit(1)
            }
            if let snap = entry.snapshot, !snap.rows.isEmpty {
                ForEach(Array(snap.rows.prefix(rowLimit).enumerated()), id: \.offset) { _, r in
                    MetroRowView(row: r, precision: entry.precision,
                                 showCrowd: family != .systemSmall)
                }
            } else {
                Text(entry.snapshot?.stale == true ? "官方目前沒有這一站的班次資訊" : "沒有資料")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
        // 點小工具 → App 直開這一站的等車卡。未選站時 deepLink 為 nil,widgetURL(nil) 就是
        // 預設行為(單純開 App),不必分支。
        .widgetURL(entry.deepLink)
    }

    private var stampText: String {
        guard let at = entry.snapshot?.dataAt else { return "—" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        // 時區錨定 Asia/Taipei,不用裝置時鐘(timezone-anchor 契約;人在國外看家鄉班次時尤其重要)。
        f.timeZone = TimeZone(identifier: "Asia/Taipei")
        return (entry.failed ? "⚠ " : "") + f.string(from: Date(timeIntervalSince1970: at)) + " 更新"
    }
}

struct MetroRowView: View {
    let row: MetroRow
    let precision: String
    let showCrowd: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text("往 \(row.dest)").font(.system(size: 13)).lineLimit(1)
            Spacer(minLength: 4)
            if precision == "sec", let eta = row.etaEpoch {
                // 北捷是絕對時刻 ⇒ 交給系統自走,刷新之間也是對的。
                // 🔴 range 起點必須 clamp:模型層濾掉 eta<=now 用的是「entry 建立時」的 now,
                //    body 實際被封存(archive)可能晚幾秒;ClosedRange 下界大於上界會當場 crash。
                //    到期後 timerInterval 自己會停在 0:00,顯示語意不變。
                let end = Date(timeIntervalSince1970: eta)
                Text(timerInterval: min(Date(), end)...end, countsDown: true)
                    .monospacedDigit().font(.system(size: 14, design: .rounded))
                    .frame(maxWidth: 56)
            } else if let m = row.minutes {
                // 🔴 官方只給整數分鐘 ⇒ 顯示「約 N 分」的靜態文字,不換算成秒、不自走。
                Text("約 \(m) 分").monospacedDigit().font(.system(size: 14, design: .rounded))
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
                                .fill(MetroPalette.crowd(v)).frame(width: 5, height: 9)
                        }
                    }
                }
                .frame(width: 38, alignment: .trailing)
            }
            // showCrowd=false 的整卡(高捷/機捷)全卡都沒有擁擠欄,時間本來就對齊,不佔位。
        }
    }
}

enum MetroPalette {
    /// 站所屬路線的代表色。跨線轉乘站取第一條——顏色只是識別,不是資料。
    static func color(sys: String, station: String) -> Color? {
        guard let raw = MetroWidgetCatalog.shared.lineColorHex(sys: sys, station: station) else { return nil }
        var s = raw; if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255,
                            green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
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

extension MetroWidgetCatalog {
    func lineColorHex(sys: String, station: String) -> String? { lineColors["\(sys)|\(station)"] }
}
