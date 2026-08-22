import ActivityKit
import AppIntents
import Foundation

// 捷運小工具「點一下就開等車卡」——iOS 17 的 LiveActivityIntent:在【背景】把卡開起來,
// 全程【不】打開 App。
//
// 為什麼非走這條不可:iOS 禁止背景 Activity.request(ActivityAuthorizationError.visibility
// ＝「The app tried to start the Live Activity while it was in the background.」),而舊路徑是
// widgetURL 深連結 ⇒ 先開 App ⇒ 使用者點完小工具就鎖屏、之後一直沒回 App 的話,卡永遠開不成
// (2026-08-22 修的三條根因只保證「回到 App 時補開」,補不到人不回來的那一種)。
// Apple 對 LiveActivityIntent 的原文正是缺的那一塊:「the system launches your app process
// without opening the app, performs the intent, and starts the Live Activity.」
//
// 🔴 本檔同時掛 App 與 RailBoardWidgetExtension 兩個 target(見 project.pbxproj):
//    widget 端要看得到型別才畫得出 Button(intent:),perform() 則由系統在 App 行程裡執行。
//    比照 MetroWaitAttributes／MetroWaitEndIntent 的雙 target 鐵則,不可各複製一份。
// 🔴 這條路【不取代】深連結,是疊在它上面:沒有站可追(未選站)、或被通行證閘門擋下要導去
//    方案頁的那兩種卡,照舊走 widgetURL(見 MetroBoardWidget 的 waitTarget);而 Intent 自己
//    失敗時會把這次點擊記進 App Group,下次 App 到前景補開一次(MetroWaitPending)。

/// 背景開卡失敗時留下的待辦。刻意放在可用性閘門【外面】——RailMetroWaitPlugin 與 AppDelegate
/// 都要讀它,而那兩處不是 iOS 17.6 限定的程式碼。
enum MetroWaitPending {
    static let key = "metro.pendingWaitOpen"
    /// 保鮮期。與網頁端 _mwPendingOpen 同值:太舊的點擊補開出來只會是使用者早就不要的那一站。
    static let maxAgeSec: Double = 600
    private static var suite: UserDefaults? { UserDefaults(suiteName: "group.tw.railisland.app") }

    static func write(sys: String, station: String, dest: String?) {
        suite?.set(["sys": sys, "station": station, "dest": dest ?? "",
                    "at": Date().timeIntervalSince1970], forKey: key)
    }

    /// 讀出並【清掉】。清在前面是刻意的:補開自己若又失敗,由該條路徑重新寫一次待辦,
    /// 不可以留著讓它每次回前景都重開一次(比照網頁端 metroWaitFlushPending 的先清再開)。
    static func take() -> (sys: String, station: String, dest: String?)? {
        guard let o = suite?.dictionary(forKey: key) else { return nil }
        suite?.removeObject(forKey: key)
        guard let at = o["at"] as? Double,
              Date().timeIntervalSince1970 - at <= maxAgeSec else { return nil }
        let sys = o["sys"] as? String ?? "", station = o["station"] as? String ?? ""
        guard !sys.isEmpty, !station.isEmpty else { return nil }
        let dest = o["dest"] as? String ?? ""
        return (sys, station, dest.isEmpty ? nil : dest)
    }
}

@available(iOS 17.6, *)
struct MetroWaitStartIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "追蹤這一站的車"
    static let isDiscoverable = false   // 只給小工具的按鈕用,不進 Shortcuts/聚焦目錄

    // 🔴 三個欄位打包成【一個 Base64 參數】,不是三個中文參數——這不是潔癖,是實測出來的:
    //    2026-08-22 在 iOS 26.5 模擬器上做單一變因對照(同一顆 build 只換參數值),
    //      參數值 = ""(預設)          → 小工具正常畫出來
    //      參數值 = "TRTC"/"TESTASCII" → 正常畫出來
    //      參數值 = "TRTC"/"大安"      → 【整張小工具變佔位圖】
    //    壞掉時 widget extension 的 log 是:-[INAppIntent linkAction] No LinkAction; returning nil
    //    (NSCocoaErrorDomain 4097) → Unable to get LNAction from intent → chronod 收到
    //    CHSErrorDomain 1101「Returned view collection was either nil or empty.」整份畫面存檔被丟掉。
    //    也就是說:Button(intent:) 帶【非 ASCII 參數值】會讓這張卡連畫都畫不出來,連帶
    //    把「點一下開等車卡」整條路廢掉。Base64 後全是 ASCII,問題消失。
    //    (對照組:同一顆 build 換成無參數的 MetroWaitEndIntent 也正常 ⇒ 不是 Button 或
    //     LiveActivityIntent 本身的問題,就是參數值的字元集。)
    @Parameter(title: "追蹤目標", default: "") var payload: String

    init() {}
    init(sys: String, station: String, dest: String?) {
        self.payload = Self.encode(sys: sys, station: station, dest: dest)
    }

    /// sys \t station \t dest(空字串＝不限方向)→ UTF-8 → Base64。分隔符用 tab:站名不可能有。
    static func encode(sys: String, station: String, dest: String?) -> String {
        Data("\(sys)\t\(station)\t\(dest ?? "")".utf8).base64EncodedString()
    }

    /// 解不開就回 nil,由呼叫端當成「這次點擊沒有目標」靜靜略過(不 throw,見 perform 的註解)。
    static func decode(_ s: String) -> (sys: String, station: String, dest: String?)? {
        guard let d = Data(base64Encoded: s), let t = String(data: d, encoding: .utf8) else { return nil }
        let p = t.components(separatedBy: "\t")
        guard p.count == 3, !p[0].isEmpty, !p[1].isEmpty else { return nil }
        return (p[0], p[1], p[2].isEmpty ? nil : p[2])
    }

    func perform() async throws -> some IntentResult {
        if let t = Self.decode(payload) {
            await MetroWaitStarter.start(sys: t.sys, station: t.station, dest: t.dest)
        }
        // 🔴 一律回 .result():開不成也不 throw。throw 會讓系統在鎖定畫面彈系統錯誤,
        //    而使用者此刻多半看不到、也無法處理;開不成的補救是 MetroWaitPending。
        return .result()
    }
}

/// 背景開卡的完整流程:抓一份【新鮮的】官方班次 → 開卡 → 把 push token 交給伺服器接班。
/// 刻意不重用 RailMetroWaitPlugin.start():那支吃 CAPPluginCall(網頁端算好的 payload),
/// 而這裡沒有網頁——資料要自己抓、線名線色要自己查。共用的是同一組 MetroWaitAttributes
/// 與同一套「先收舊卡再開新卡」的單卡不變量。
@available(iOS 17.6, *)
enum MetroWaitStarter {
    /// 追蹤時長。小工具不經方向/時長選單,與深連結同樣預設 30 分。
    static let durationMin = 30
    /// 等 push token 的上限。拿不到就讓卡退回零推播行為(倒數照樣自走,只是不接下一班),
    /// 不可以無限等——perform() 的背景時間是有限的,卡住等於整個 intent 被系統砍掉。
    private static let tokenWaitSec: UInt64 = 6

    @MainActor
    static func start(sys: String, station: String, dest: String?) async {
        guard !sys.isEmpty, !station.isEmpty else { return }
        // 使用者在 iOS 設定裡關掉「即時動態」:開不了也補不了,但下次開 App 時網頁端那條路
        // 會給出可讀的 toast(請到設定開啟),所以照樣留待辦。
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            MetroWaitPending.write(sys: sys, station: station, dest: dest); return
        }
        guard let seed = await seed(sys: sys, station: station, dest: dest) else {
            MetroWaitPending.write(sys: sys, station: station, dest: dest); return
        }
        // 單卡不變量:等車卡最多一張,換站＝舊卡確實收掉才開新的(同 plugin 的 endAll)。
        for act in Activity<MetroWaitAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
        // 🔴 endAt 只算這一次,而且【同一個值】要一路帶到伺服器:卡片印的「追蹤至 HH:mm」
        //    與伺服器收卡的時刻必須是同一個數(見 RailMetroWaitPlugin 的同一條註解)。
        let endAt = Date().timeIntervalSince1970 + Double(durationMin) * 60
        let attrs = MetroWaitAttributes(sys: sys, station: station,
                                        lineLabel: seed.lineLabel, color: seed.color, endAt: endAt)
        do {
            let act = try Activity.request(
                attributes: attrs,
                content: .init(state: seed.state, staleDate: seed.staleDate),
                // 少了 .token 伺服器就永遠接不了手(卡片仍能開,只是停在開卡當下那一班)。
                pushType: .token)
            await bind(act, sys: sys, station: station, dest: dest, endAt: endAt)
        } catch {
            // 走到這裡最可能的還是 visibility(理論上不該發生,LiveActivityIntent 就是為此存在)、
            // 或 targetMaximumExceeded。留待辦讓下次開 App 補開,是唯一還救得回來的路。
            MetroWaitPending.write(sys: sys, station: station, dest: dest)
        }
    }

    // MARK: - 班次

    private struct Seed {
        let state: MetroWaitAttributes.ContentState
        let staleDate: Date
        let lineLabel: String
        let color: String?
    }

    /// 現抓一份官方班次來開卡。
    /// 🔴 刻意【不】用小工具 entry 裡現成的那份:timeline entry 可能是十幾分鐘前算的,
    ///    拿它開卡會開出一張一進來就「進站」的假卡。這裡是一發打在邊緣快取上的 GET
    ///    (s-maxage=15),成本遠低於畫錯。
    private static func seed(sys: String, station: String, dest: String?) async -> Seed? {
        let catalog = MetroWidgetCatalog.shared
        guard let system = catalog.systems.first(where: { $0.id == sys }) else { return nil }
        let alias = catalog.alias[sys] ?? [:]
        let now = Date().timeIntervalSince1970
        var snap: MetroSnapshot?
        do {
            let data = try await MetroFetcher.fetch(sys: sys)
            snap = system.precision == "sec"
                ? try MetroBoardModel.trtc(json: data, station: station, alias: alias, now: now)
                : try MetroBoardModel.minuteSystem(json: data, station: station, alias: alias, now: now)
        } catch {
            // 抓不到就退小工具上一輪存下來的那份(同一個 App Group)。下面兩道新鮮度檢查
            // 會把過舊的擋掉 ⇒ 過舊＝當作沒資料去留待辦,不會拿它畫一張騙人的倒數。
            snap = MetroFetcher.cached(sys: sys, station: station)
        }
        guard let snap else { return nil }
        // 🔴 兩種精度的「過期」是兩件事,不可以共用一道檢查:
        //    北捷給的是【絕對到站時刻】,資料放多久都不會漂,只要把已經過去的列濾掉就對;
        //    高捷/機捷給的是【相對分鐘】,資料放了 N 秒那個數字就少了 N 秒 ⇒ 必須看年紀。
        //    150 秒與網頁端 metroWaitLiveBundle 的保鮮期同值。
        var rows = snap.rows
        if system.precision == "sec" {
            rows = rows.filter { $0.etaEpoch == nil || $0.etaEpoch! > now }
        } else if now - snap.dataAt > 150 {
            return nil
        }
        if let dest, !dest.isEmpty { rows = rows.filter { $0.dest == dest } }
        guard let a = rows.first else { return nil }
        let b = rows.dropFirst().first

        var st = MetroWaitAttributes.ContentState()
        // 精度誠實:北捷帶 nextEta(絕對時刻),分鐘級系統帶 nextMinutes,不互相換算。
        st.nextEta = a.etaEpoch
        st.nextMinutes = a.minutes
        st.secondEta = b?.etaEpoch
        st.secondMinutes = b?.minutes
        st.nextDest = a.dest
        st.secondDest = b?.dest
        st.crowd = a.crowd            // 官方沒給就是 nil,不補零、不猜(逐列各自對回自己那台車)
        st.dataAt = snap.dataAt
        // notice 與 pushed 一律不寫:前者是網頁端才有的整句文案,後者要等伺服器真的推過才算數。

        // staleDate＝下一班【到站整點】。isStale 翻真＝視圖畫「進站」,不是「資料過期」。
        let stale = a.etaEpoch.map { Date(timeIntervalSince1970: $0) }
            ?? Date().addingTimeInterval(Double((a.minutes ?? 5) * 60))

        // 線名與線色走與小工具逐列上色【同一條】規則(MetroBoardModel.resolveLine),
        // 解不出唯一路線就兩者皆空——寧可標頭少一行字,也不要掛一條猜的線。
        // 🔴 而且「這一列解得出來」還不夠:ActivityKit 的 attributes 開卡後就【凍住】,
        //    列卻會跟著官方看板一直換。大安 2026-08-22 13:08 模擬器實見——開卡當下第一列是
        //    文湖線往動物園,一分鐘後第一列變成往淡水站(淡水信義線),標頭還寫著「文湖線」。
        //    所以只有「這張卡往後每一列都必然同一條線」才准掛:
        //      (a) 這站只有一條線(單線站,怎麼換都還是那條);或
        //      (b) 有指定方向,且這站通往那個終點只有一條線可走。
        //    其餘一律留空(共站站不指定方向就是這種)。同 [[interchange-needs-per-train-key]]:
        //    轉乘站不能用「站」當線的識別。
        let stationLines = Set(catalog.lineIDsAt(sys: sys, station: station))
        let pinned: Bool = {
            if stationLines.count <= 1 { return true }
            guard let dest, !dest.isEmpty else { return false }
            return stationLines.intersection(catalog.lineIDsAt(sys: sys, station: dest)).count == 1
        }()
        let code = !pinned ? nil : MetroBoardModel.resolveLine(
            joined: a.lineCode, trainNo: a.trainNo, station: station, dest: a.dest,
            stationLines: catalog.lineIDsAt(sys: sys, station: station),
            destLines: catalog.lineIDsAt(sys: sys, station: a.dest))
        return Seed(state: st, staleDate: stale,
                    lineLabel: code.flatMap { catalog.lineName(sys: sys, code: $0) } ?? "",
                    color: code.flatMap { catalog.lineHex(sys: sys, code: $0) })
    }

    // MARK: - 交班

    /// 把 push token 交給伺服器,之後由它每分鐘接續班次、時段到點推 end 收卡。
    /// 🔴 一定要在 perform() 裡面等到 token:回傳之後行程隨時可能被系統暫停,
    ///    pushTokenUpdates 的迴圈會跟著死,那張卡就永遠停在開卡當下那一班。
    /// 整段是純附加能力,任何一步失敗都只讓卡片退回零推播行為(視圖會照 state.pushed
    /// 如實說明「不會自己接下一班」),不影響卡片本身。
    private static func bind(_ act: Activity<MetroWaitAttributes>,
                             sys: String, station: String, dest: String?, endAt: Double) async {
        var token = act.pushToken.map(hex)
        if token == nil { token = await firstPushToken(act) }
        guard let token, !token.isEmpty else { return }
        var req = URLRequest(url: URL(string: "https://railisland.tw/api/metro-wait/bind")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.timeoutInterval = 8
        // dest 的 null 與空字串在伺服器端都收(都代表「不限方向」),但這裡送 NSNull 對齊
        // 網頁端的形狀,免得日後有人拿 D1 的值去比對時多出一種寫法。
        let body: [String: Any] = ["token": token, "sys": sys, "station": station,
                                   "dest": (dest?.isEmpty == false) ? dest! : NSNull(),
                                   "endAt": Int(endAt.rounded())]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
        // 🔴 這顆 token 網頁端不知道(它只認自己 p.start() 那張卡的 key)。使用者之後回 App 按
        //    「結束追蹤」時,卡會被原生收掉、而伺服器那一列要等下一發推播撞到 Unregistered
        //    才被刪(最多一分鐘、一次白打的 APNs)。刻意不為此在 status() 上多開一個回傳欄位:
        //    自癒路徑已經存在(LA_PERM_FAIL_REASONS),多一條跨語言的 token 交接只會多一種錯法。
    }

    private static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

    /// 等第一顆 push token,最多 tokenWaitSec 秒。
    private static func firstPushToken(_ act: Activity<MetroWaitAttributes>) async -> String? {
        await withTaskGroup(of: String?.self) { group in
            group.addTask {
                for await d in act.pushTokenUpdates { return hex(d) }
                return nil
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: tokenWaitSec * 1_000_000_000)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}
