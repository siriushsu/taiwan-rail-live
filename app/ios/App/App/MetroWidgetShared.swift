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
    /// 每一站開得到的方向(目錄裡該站的 `dests`;轉乘站跨線合併、去重、保留線序),鍵 "sys|站名"。
    /// 方向格的選單只列這一份,不再把全系統的終點攤平(使用者 2026-09-02 回報選得到跨系統／跨線的方向)。
    let destsByStation: [String: [String]]
    /// "<sys>|<線 id>" → 該線色票。官方 `trains[].stn` 的字母前綴就是線 id(BL13 → BL),
    /// 用來把看板每一列對回它真正的路線色(見 MetroPalette.rowLine)。
    let lineColorByID: [String: String]
    /// "<sys>|<線 id>" → 該線的中文顯示名(「文湖線」)。與 lineColorByID 同一把鑰匙:
    /// 等車卡的標頭要「圓點＋線名」兩件,色票只給得起圓點。
    /// 🔴 只有【解得出唯一路線】的班次才配得到名字(見 MetroBoardModel.resolveLine),
    ///    解不出來就留空字串——標頭寧可少一行字,也不要掛一條猜的線。
    let lineNameByID: [String: String]
    /// "<sys>|<線 id>" → 該線依站序的每一站(名稱＋前一站到這一站的行駛秒＋停站秒)。
    /// 等車卡的進站軌道要知道「這班車的上一站」與「上一站到本站要開多久」,兩者都只能從站序推。
    let lineStops: [String: [LineStop]]
    /// 每個系統的線 id(目錄順序)。查上一站時要逐線找「同時有本站與終點站」的那幾條。
    let lineIDsBySys: [String: [String]]

    struct LineStop { let name: String; let run: Double?; let dwell: Double? }

    static let shared: MetroWidgetCatalog = load()

    private static func load() -> MetroWidgetCatalog {
        guard let url = Bundle.main.url(forResource: "MetroWidgetData", withExtension: "json"),
              let raw = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
            // 🔴 讀不到就回空目錄,讓 provider 走「照樣給選項」那條(空 systems 時 use 也是空,
            //    ItemCollection 會是空的——這是唯一真的沒東西可列的情況,與 .empty 的語意不同)。
            return MetroWidgetCatalog(systems: [], alias: [:], lastTrain: [:], lineColors: [:],
                                      lineIDs: [:], coords: [:], destsByStation: [:],
                                      lineColorByID: [:], lineNameByID: [:],
                                      lineStops: [:], lineIDsBySys: [:])
        }
        var out: [System] = []
        var colors: [String: [String]] = [:]
        var ids: [String: [String]] = [:]
        var coords: [String: Coord] = [:]
        var destsByStation: [String: [String]] = [:]
        var byLineID: [String: String] = [:]
        var nameByLineID: [String: String] = [:]
        var stopsByLine: [String: [LineStop]] = [:]
        var lineOrder: [String: [String]] = [:]
        for s in (obj["systems"] as? [[String: Any]] ?? []) {
            let sysID = s["id"] as? String ?? ""
            let lines = s["lines"] as? [[String: Any]] ?? []
            let stations = lines.flatMap { $0["stations"] as? [[String: Any]] ?? [] }
            var names: [String] = [], dests: Set<String> = []
            for st in stations {
                let stationDests = st["dests"] as? [String] ?? []
                if let n = st["name"] as? String {
                    if !names.contains(n) { names.append(n) }
                    let key = "\(sysID)|\(n)"
                    // 容錯讀:缺座標的站只是進不了最近站計算,不讓整個目錄載入失敗。
                    if let la = st["lat"] as? Double, let lo = st["lon"] as? Double {
                        if coords[key] == nil { coords[key] = Coord(lat: la, lon: lo) }
                    }
                    // 轉乘站在目錄裡每條線各一筆:方向跨線合併(去重、保留線序)。
                    for d in stationDests where !(destsByStation[key] ?? []).contains(d) {
                        destsByStation[key, default: []].append(d)
                    }
                }
                for d in stationDests { dests.insert(d) }
            }
            out.append(System(id: sysID, label: s["label"] as? String ?? "",
                              precision: s["precision"] as? String ?? "min",
                              crowd: s["crowd"] as? Bool ?? false,
                              stationNames: names, destinations: dests.sorted()))
            for line in lines {
                // 站序不看色票:缺色票的線照樣有上一站可查。
                if let lid = line["id"] as? String {
                    lineOrder[sysID, default: []].append(lid)
                    stopsByLine["\(sysID)|\(lid)"] = (line["stations"] as? [[String: Any]] ?? []).compactMap { st in
                        guard let n = st["name"] as? String else { return nil }
                        return LineStop(name: n, run: (st["run"] as? NSNumber)?.doubleValue,
                                        dwell: (st["dwell"] as? NSNumber)?.doubleValue)
                    }
                }
                guard let color = line["color"] as? String else { continue }
                if let lid = line["id"] as? String {
                    byLineID["\(sysID)|\(lid)"] = color
                    // 線名缺就不收(查不到時畫面層不畫這個元件,而不是畫一顆沒標籤的點)。
                    if let nm = line["name"] as? String, !nm.isEmpty {
                        nameByLineID["\(sysID)|\(lid)"] = nm
                    }
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
                                  destsByStation: destsByStation,
                                  lineColorByID: byLineID, lineNameByID: nameByLineID,
                                  lineStops: stopsByLine, lineIDsBySys: lineOrder)
    }
}

// 自動選站與「我的地點」的服務半徑。
//
// 🔴 值【不住在程式碼裡】,住在 MetroWidgetData.json 的 `serviceRadii`
//    (唯一來源是 app/scripts/build_metro_widget_data.mjs 的 SERVICE_RADII),
//    iOS 與 Android 都從那份產物讀。在這之前是三份會各自漂移的字面值:
//    MetroNearest 12000、RailBoardData 5000、RailWidgetData.java 5000——再加公車就四份。
// 🔴 逐運具一個值,不是單一常數:捷運與台鐵的站密度差一個量級,公車又高一個量級,
//    公車那一個要另外實算(設計書單元 C),沒實算出來之前資料檔裡不會有 bus 這一把。
// 🔴 刻意【不】在這裡留字面值預設:留了就等於把那份字面值又複製回程式碼,
//    而「資料檔沒接上」會靜靜地看起來完全正常。查不到回 0 ⇒ 所有站都落在範圍外、
//    卡面當場說「不在服務範圍」,壞掉要壞得看得見。
// 🔴 自己解析而不是走 MetroWidgetCatalog.shared:台鐵看板小工具也要用這個半徑,
//    讓它為了一個數字去載整份捷運目錄是不必要的成本(這個檔 76KB,單獨解析一次可忽略)。
enum WidgetServiceRadius {
    static let metro = "metro"
    static let rail = "rail"

    static func meters(_ modality: String) -> Double { table[modality] ?? 0 }

    static let table: [String: Double] = load()

    private static func load() -> [String: Double] {
        guard let url = Bundle.main.url(forResource: "MetroWidgetData", withExtension: "json"),
              let raw = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let radii = obj["serviceRadii"] as? [String: Any] else { return [:] }
        var out: [String: Double] = [:]
        for (k, v) in radii {
            if let n = v as? Double { out[k] = n } else if let n = v as? Int { out[k] = Double(n) }
        }
        return out
    }
}

extension MetroWidgetCatalog {
    /// 該站開得到的方向;查不到(自動選站哨兵、舊鍵)回空陣列,退路由呼叫端決定。
    func destinations(sys: String, station: String) -> [String] { destsByStation["\(sys)|\(station)"] ?? [] }

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

/// 等車卡進站軌道的一段(上一站 → 本站)。見 `MetroWidgetCatalog.waitHop`。
struct MetroWaitHop: Equatable {
    let prev: String
    /// 上一站到本站的行駛秒(不含停站)。
    let runSec: Double
    /// 上一站的停站秒。倒數落在 (run, run+dwell] 之間＝車還停在上一站。
    let dwellSec: Double
    let lineID: String
    /// 站名牌帶子上的線名;共線段取母線名,解不出來是 nil(帶子只留色)。
    let lineName: String?
    let colorHex: String?

    /// 正側面車模(asset `la-side-<id>`)。對照網站 3D 列車的路線→車型
    /// (rail-3d/integration/formations.js baseFormation):文湖線在 fleet-v1 只有 VAL256 一款。
    var carModel: String {
        switch lineID {
        case "BR": return "val256"
        case "BL": return "c321"
        case "Y":  return "y100"
        default:   return "c381"   // R／G／O 兩支線／新北投、小碧潭支線
        }
    }
    /// 車模的寬高比(裁切後的實際像素比;app/scripts/build_la_side_assets.py 產圖時印出來的值,
    /// 重產素材後要同步改這裡)。
    var carAspect: Double {
        switch carModel {
        case "val256": return 2.255
        case "y100":   return 2.499
        default:       return 2.765
        }
    }
}

// 🔴 刻意放在【第二個】extension:算繪腳本(render_metro_widget／render_mixed_widget)只抽
//    第一個 extension 與 struct 本體裸編譯（它們用字串找宣告頭，這行註解刻意不寫出完整宣告頭）,這一段要用到 MetroWaitHop,
//    放進第一個會讓那兩支腳本編不過(它們不畫等車卡,用不到這段)。
extension MetroWidgetCatalog {
    /// 等車卡進站軌道要的那一段:下一班車從哪一站開過來、開多久、是哪條線。
    ///
    /// 只用目錄的站序推——不需要伺服器多給欄位,推播也不用改形狀(ContentState 本來就有 nextDest)。
    /// 方向由終點決定:終點在本站的哪一側,車就從另一側的鄰站開過來。
    /// 🔴 解不出唯一答案就回 nil,呼叫端不畫車(不猜):
    ///    - 分鐘級系統(高捷/機捷)沒有秒級到站時刻,推不出位置 ⇒ 一律 nil;
    ///    - 本站是這個方向的起點(淡水往象山):車就停在本站等發車,沒有「上一站」;
    ///    - 兩條線都同時經過本站與終點、而上一站不同(忠孝復興往南港展覽館:文湖線從大安來、
    ///      板南線從忠孝新生來;大橋頭往南勢角:兩條支線各自一站)——ContentState 只有終點,分不出是哪條線。
    ///    共線段(中和新蘆線兩支線在古亭往南勢角)上一站相同,不算歧義。
    func waitHop(sys: String, station: String, dest: String?) -> MetroWaitHop? {
        guard systems.first(where: { $0.id == sys })?.precision == "sec",
              let rawDest = dest, !rawDest.isEmpty else { return nil }
        let lines = (lineIDsBySys[sys] ?? []).compactMap { id in lineStops["\(sys)|\(id)"].map { (id, $0) } }
        let names = Set(lines.flatMap { $0.1.map(\.name) })
        guard let here = canonicalStation(sys: sys, raw: station, known: names),
              let to = canonicalStation(sys: sys, raw: rawDest, known: names), here != to else { return nil }
        var found: [MetroWaitHop] = []
        for (id, stops) in lines {
            guard let i = stops.firstIndex(where: { $0.name == here }),
                  let j = stops.firstIndex(where: { $0.name == to }) else { continue }
            let p = j > i ? i - 1 : i + 1
            guard stops.indices.contains(p) else { return nil }   // 本站是這個方向的起點
            // run 記在「站序較後」的那一站(= 前一站到它);兩個方向同值(TDX S2STravelTime)。
            guard let run = (j > i ? stops[i].run : stops[p].run), run > 0 else { return nil }
            found.append(MetroWaitHop(prev: stops[p].name, runSec: run, dwellSec: stops[p].dwell ?? 0,
                                      lineID: id, lineName: lineNameByID["\(sys)|\(id)"],
                                      colorHex: lineColorByID["\(sys)|\(id)"]))
        }
        guard let first = found.first,
              found.allSatisfy({ $0.prev == first.prev && $0.runSec == first.runSec }) else { return nil }
        // 共線段的兩條支線:線名取母線名(「中和新蘆線（迴龍）」「中和新蘆線（蘆洲）」都同意「中和新蘆線」)。
        let stems = Set(found.compactMap { $0.lineName.map { String($0.prefix(while: { $0 != "（" })) } })
        let colors = Set(found.compactMap(\.colorHex))
        return MetroWaitHop(prev: first.prev, runSec: first.runSec, dwellSec: first.dwellSec,
                            lineID: first.lineID, lineName: stems.count == 1 ? stems.first : nil,
                            colorHex: colors.count == 1 ? colors.first : nil)
    }

    /// 站名對回目錄:先直接比對,不中才走別名、臺→台、去尾綴「站」(順序同 MetroBoardModel:
    /// 無條件去尾會弄丟「台北車站」)。
    private func canonicalStation(sys: String, raw: String, known: Set<String>) -> String? {
        if known.contains(raw) { return raw }
        if let a = alias[sys]?[raw], known.contains(a) { return a }
        let tai = raw.replacingOccurrences(of: "臺", with: "台")
        if known.contains(tai) { return tai }
        if tai.hasSuffix("站") {
            let stripped = String(tai.dropLast())
            if known.contains(stripped) { return stripped }
        }
        return nil
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
            // approx 不存就會在退路那份掉旗標——合成的「約」列會被畫成秒級倒數冒充官方精度。
            if r.approx { d["approx"] = true }
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
                     lineCode: r["line"] as? String, trainNo: r["no"] as? String,
                     approx: r["approx"] as? Bool ?? false)
        }
        // 🔴 Swift 的 memberwise init 必須照【宣告順序】給參數,不能重排:
        //    MetroSnapshot 是 station → dataAt → rows → stale。
        return MetroSnapshot(station: station, dataAt: at, rows: rows,
                             stale: o["stale"] as? Bool ?? false)
    }
}
