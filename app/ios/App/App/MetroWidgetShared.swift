import Foundation

// 捷運看板小工具的【資料層】:目錄(MetroWidgetData.json)與官方即時看板的抓取/快取。
// 原本住在 RailBoardWidget/MetroBoardIntent.swift 與 MetroBoardWidget.swift 裡,
// 2026-08-22 搬出來的唯一理由是——等車卡改成從小工具的按鈕【在背景】開卡
// (MetroWaitStartIntent),而 LiveActivityIntent 的 perform() 是在【App 行程】裡跑的,
// App target 於是也要抓得到班次、查得到別名與線色。
//
// 🔴 本檔與 MetroWaitAttributes／MetroWaitEndIntent 同一條鐵則:同時掛 App 與
//    RailBoardWidgetExtension 兩個 target(見 project.pbxproj),不可各複製一份。
//    MetroBoardModel.swift 與 MetroWidgetData.json 也同樣被加進 App target。
// 🔴 只 import Foundation:這裡的東西要能被 verify 腳本大括號抽取後裸編譯,
//    而且 App target 沒有 WidgetKit 的畫面層。畫面相關的(MetroPalette／MetroEntry／
//    各種 View)一律留在 MetroBoardWidget.swift。

struct MetroWidgetCatalog {
    struct System { let id: String; let label: String; let precision: String; let crowd: Bool
                    let stationNames: [String]; let destinations: [String] }
    struct Coord { let lat: Double; let lon: Double }
    let systems: [System]
    let alias: [String: [String: String]]
    let lastTrain: [String: String]
    /// "<sys>|<站名>" → 該站所有路線的色票(hex,去重、依線序)。
    /// 🔴 不可以只留第一條:台北車站同時是紅線與藍線,只留第一條會讓卡上畫紅點、
    ///    底下卻列著藍線的班次(真機回饋 08-15)。顏色是識別,識別不了就不畫,不能亂指一條。
    /// 只能在這裡(struct 本體)宣告,extension 放不了 stored property;
    /// 真正的查詢方法 `lineColorHexes` 在本檔下方的 extension。
    let lineColors: [String: [String]]
    /// "<sys>|<站名>" → 該站所有路線的 id(去重、依線序)。
    /// 為什麼不能只用色票:板南線與文湖線顏色不同、色票集合也是兩解,但只有「線 id 恰為
    /// {BL,BR}」這個條件才可以套用「沒車號＝文湖線」那條規則(見 MetroBoardModel.resolveLine)。
    let lineIDs: [String: [String]]
    /// "<sys>|<站名>" → 站座標(自動選站的最近站計算用)。同站多線座標相同,取第一筆。
    let coords: [String: Coord]
    /// "<sys>|<線 id>" → 該線色票。官方 `trains[].stn` 的字母前綴就是線 id(BL13 → BL),
    /// 用來把看板每一列對回它真正的路線色(見 MetroPalette.rowColor)。
    let lineColorByID: [String: String]
    /// "<sys>|<線 id>" → 該線的中文顯示名(「文湖線」)。與 lineColorByID 同一把鑰匙:
    /// 等車卡的標頭要「圓點＋線名」兩件,色票只給得起圓點。
    /// 🔴 只有【解得出唯一路線】的班次才配得到名字(見 MetroBoardModel.resolveLine),
    ///    解不出來就留空字串——標頭寧可少一行字,也不要掛一條猜的線。
    let lineNameByID: [String: String]

    static let shared: MetroWidgetCatalog = load()

    private static func load() -> MetroWidgetCatalog {
        guard let url = Bundle.main.url(forResource: "MetroWidgetData", withExtension: "json"),
              let raw = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
            // 🔴 讀不到就回空目錄,讓 provider 走「照樣給選項」那條(空 systems 時 use 也是空,
            //    ItemCollection 會是空的——這是唯一真的沒東西可列的情況,與 .empty 的語意不同)。
            return MetroWidgetCatalog(systems: [], alias: [:], lastTrain: [:], lineColors: [:],
                                      lineIDs: [:], coords: [:], lineColorByID: [:], lineNameByID: [:])
        }
        var out: [System] = []
        var colors: [String: [String]] = [:]
        var ids: [String: [String]] = [:]
        var coords: [String: Coord] = [:]
        var byLineID: [String: String] = [:]
        var nameByLineID: [String: String] = [:]
        for s in (obj["systems"] as? [[String: Any]] ?? []) {
            let sysID = s["id"] as? String ?? ""
            let lines = s["lines"] as? [[String: Any]] ?? []
            let stations = lines.flatMap { $0["stations"] as? [[String: Any]] ?? [] }
            var names: [String] = [], dests: Set<String> = []
            for st in stations {
                if let n = st["name"] as? String {
                    if !names.contains(n) { names.append(n) }
                    // 容錯讀:缺座標的站只是進不了最近站計算,不讓整個目錄載入失敗。
                    if let la = st["lat"] as? Double, let lo = st["lon"] as? Double {
                        let key = "\(sysID)|\(n)"
                        if coords[key] == nil { coords[key] = Coord(lat: la, lon: lo) }
                    }
                }
                for d in (st["dests"] as? [String] ?? []) { dests.insert(d) }
            }
            out.append(System(id: sysID, label: s["label"] as? String ?? "",
                              precision: s["precision"] as? String ?? "min",
                              crowd: s["crowd"] as? Bool ?? false,
                              stationNames: names, destinations: dests.sorted()))
            for line in lines {
                guard let color = line["color"] as? String else { continue }
                if let lid = line["id"] as? String {
                    byLineID["\(sysID)|\(lid)"] = color
                    if let nm = line["name"] as? String { nameByLineID["\(sysID)|\(lid)"] = nm }
                }
                for st in (line["stations"] as? [[String: Any]] ?? []) {
                    guard let n = st["name"] as? String else { continue }
                    let key = "\(sysID)|\(n)"
                    // 去重但保留線序:同一條線在目錄裡可能拆成多段(中和新蘆線的迴龍/蘆洲兩支
                    // 共用同一個色票),重複收進來會讓「單色才畫」的判準誤判成多線。
                    if !(colors[key] ?? []).contains(color) { colors[key, default: []].append(color) }
                    // 線 id 與色票分開收:同色的分支線(迴龍/蘆洲)在色票集合會塌成一項,
                    // 但候選路線的判定要看得到它們是兩條。
                    if let lid = line["id"] as? String, !(ids[key] ?? []).contains(lid) {
                        ids[key, default: []].append(lid)
                    }
                }
            }
        }
        return MetroWidgetCatalog(systems: out,
                                  alias: obj["alias"] as? [String: [String: String]] ?? [:],
                                  lastTrain: obj["lastTrain"] as? [String: String] ?? [:],
                                  lineColors: colors, lineIDs: ids, coords: coords,
                                  lineColorByID: byLineID, lineNameByID: nameByLineID)
    }
}

extension MetroWidgetCatalog {
    func lineColorHexes(sys: String, station: String) -> [String] { lineColors["\(sys)|\(station)"] ?? [] }
    func lineIDsAt(sys: String, station: String) -> [String] { lineIDs["\(sys)|\(station)"] ?? [] }

    /// 線代碼 → 色票。官方 `stn` 給的是主代碼(O),目錄裡卻可能拆成子線(O_XINZHUANG／
    /// O_LUZHOU,共用同一個色票) ⇒ 先找完全相同的 id,沒有再收所有 `<code>_` 開頭的子線;
    /// 子線色票不一致就回 nil(例:R 與 R_XBT 顏色不同,但 R 本身存在故走第一條,不受影響)。
    func lineHex(sys: String, code: String) -> String? {
        if let exact = lineColorByID["\(sys)|\(code)"] { return exact }
        let kids = Set(lineColorByID.filter { $0.key.hasPrefix("\(sys)|\(code)_") }.map(\.value))
        return kids.count == 1 ? kids.first : nil
    }

    /// 線代碼 → 中文顯示名。同上的主/子線規則,再多一層:子線名一律長成「母線（支線）」
    /// (中和新蘆線（迴龍）／中和新蘆線（蘆洲）),官方只給得出主代碼 O 時取共同的母線名
    /// 「中和新蘆線」——那是兩條子線都同意的事實,不是猜的。母線名也不一致就回 nil。
    func lineName(sys: String, code: String) -> String? {
        if let exact = lineNameByID["\(sys)|\(code)"] { return exact }
        let kids = Set(lineNameByID.filter { $0.key.hasPrefix("\(sys)|\(code)_") }.map(\.value))
        if kids.isEmpty { return nil }
        if kids.count == 1 { return kids.first }
        let stems = Set(kids.map { String($0.prefix(while: { $0 != "（" })) })
        return stems.count == 1 ? stems.first : nil
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
        // 🔴 端點回 `max-age=14400`(給瀏覽器離線退路用),但這是即時看板:用戶端只要拿到
        //    一份四小時內的舊回應,裡面每一班的到站時刻都已經過去 ⇒ 每一站都空。
        //    網頁自己那三個消費者早就寫死 `cache: 'no-store'`(index.html 的 trtc-live／
        //    metro-live／ntmetro-live),Swift 這側漏了同一道防護,在此補齊。
        //    邊緣快取(s-maxage=15)不受影響,伺服器負載不變。
        req.cachePolicy = .reloadIgnoringLocalCacheData
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
            // 線代碼與車號要一起存,否則抓取失敗改畫退路那份時每一列都掉色
            // (車號是「板南／文湖」那一種列唯一的判別依據,見 MetroBoardModel.resolveLine)。
            if let l = r.lineCode { d["line"] = l }
            if let n = r.trainNo { d["no"] = n }
            return d
        }
        suite?.set(["at": s.dataAt, "rows": rows, "stale": s.stale], forKey: key(sys, station))
    }

    static func cached(sys: String, station: String) -> MetroSnapshot? {
        guard let o = suite?.dictionary(forKey: key(sys, station)),
              let at = o["at"] as? Double, let raw = o["rows"] as? [[String: Any]] else { return nil }
        let rows = raw.map { r in
            MetroRow(dest: r["dest"] as? String ?? "", etaEpoch: r["eta"] as? Double,
                     minutes: r["min"] as? Int, crowd: r["crowd"] as? [Int],
                     lineCode: r["line"] as? String, trainNo: r["no"] as? String)
        }
        // 🔴 Swift 的 memberwise init 必須照【宣告順序】給參數,不能重排:
        //    MetroSnapshot 是 station → dataAt → rows → stale。
        return MetroSnapshot(station: station, dataAt: at, rows: rows,
                             stale: o["stale"] as? Bool ?? false)
    }
}
