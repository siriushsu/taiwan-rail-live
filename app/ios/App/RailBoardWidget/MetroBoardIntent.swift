import AppIntents
import WidgetKit

// 🔴 參數一律 String,不用 AppEntity:這個 extension 每次 InitializeAction 都會
//    「Failed to build EntityIdentifier … is not a registered AppEntity identifier」,
//    兩個參數被還原成 nil,桌面永遠停在「請選擇車站」。已實測排除過三種變體。
// 🔴 每個 @IntentParameterDependency 只准綁【一個】keypath——綁兩個,那一列整列點不動
//    (iOS 判定依賴沒滿足直接停用該列,extension 連喚醒都不會;發車看板
//    AppIntent.swift:113-116 與 193-195 兩處實測)。「全檔只能一個依賴」是誤讀——
//    出貨檔就有兩個 provider 各帶一個依賴,都正常。

struct MetroBoardIntent: AppIntent, WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "捷運看板"
    static var description = IntentDescription("選一個捷運站，看下一班還有多久。")

    /// 免費層可設定的車站數。nil ＝全免費(現行預設)。
    /// 定價未決(見設計書 §7)——要改成「免費一站」就把這裡改成 1，其餘程式碼不必動。
    static let freeStationLimit: Int? = nil

    @Parameter(title: "系統")
    var sys: String?

    @Parameter(title: "車站", optionsProvider: MetroStationOptionsProvider())
    var station: String?

    @Parameter(title: "方向（可留空）", optionsProvider: MetroDirectionOptionsProvider())
    var dir: String?

    // 🔴 刻意【不定義】parameterSummary——定義了它,沒被列進 Summary 的參數那一格
    //    會被整格藏起來(原規劃稿只列 station/dir,「系統」格就消失了)。
    //    出貨的發車看板同樣不定義,三格全部預設顯示(AppIntent.swift:278-286)。
}

struct MetroStationOptionsProvider: DynamicOptionsProvider {
    // 本檔唯一的依賴(單一 keypath,與出貨檔同形狀)。車站清單依系統分段。
    // 🔴 變數名照出貨慣例叫 intent(AppIntent.swift:124/202)——驗收 L3 的 regex 鎖這個名字。
    @IntentParameterDependency<MetroBoardIntent>(\.$sys)
    var intent

    func results() async throws -> ItemCollection<String> {
        let data = MetroWidgetCatalog.shared
        // 🔴 沒選系統、或系統值認不得時,照樣列出全部車站——不准回 .empty,
        //    回空集合等於 iOS 把整張選單收掉,使用者看到的是「點下去選單打不開」。
        //    (真機開選單第一拍 intent 可能就是 nil,出貨檔 AppIntent.swift:168-171 實測。)
        let systems = data.systems.filter { intent?.sys == nil || $0.id == intent?.sys }
        let use = systems.isEmpty ? data.systems : systems
        // 🔧 用 .map 組陣列、走 sections: 參數,不用 ItemCollection{ for ... } 的 builder 語法:
        //    AppIntents.swiftinterface 裡 IntentItemSection<Result>.Builder 只有 buildBlock,
        //    沒有 buildArray——for 迴圈沒辦法在這層 builder 裡展開成動態筆數的 section 陣列
        //    (typecheck 實測:trailing closure passed to parameter of type
        //    '[IntentItemSection<String>]' that does not accept a closure)。出貨的發車看板
        //    同樣全部走 .map 組陣列這條路,不用這層 builder DSL。
        return ItemCollection(sections: use.map { s in
            IntentItemSection(LocalizedStringResource(stringLiteral: s.label), items: s.stationNames.map {
                IntentItem<String>("\(s.id)|\($0)", title: LocalizedStringResource(stringLiteral: $0))
            })
        })
    }
}

struct MetroDirectionOptionsProvider: DynamicOptionsProvider {
    // 🔴 這裡刻意【不帶依賴】。發車看板證明「單一依賴讀前一格」的形狀可行
    //    (DestinationOptionsProvider 依賴 origin),所以依賴 \.$station 來收窄方向
    //    「可能」可行——但那個形狀用在這裡沒真機驗過,而且要在目錄裡多留 per-station
    //    的 dests 表。先出保守版:列出所有系統的所有終點,依系統分段;選錯方向時
    //    看板會是空的,用 promptLabel 說明。真機驗收(Task 7)若嫌清單太長再升級。
    //    無論如何【不能】偷讀 intent?.station——讀沒宣告的參數當場 fatalError
    //    (出貨檔 AppIntent.swift:196-198 實測)。
    func results() async throws -> ItemCollection<String> {
        let data = MetroWidgetCatalog.shared
        // 🔧 同上一個 provider:改用 .map 組陣列走 sections: 參數,理由與實測錯誤同上。
        return ItemCollection(
            promptLabel: "留空＝兩個方向都看",
            sections: data.systems.map { s in
                IntentItemSection(LocalizedStringResource(stringLiteral: s.label), items: s.destinations.map { d in
                    IntentItem<String>(d, title: LocalizedStringResource(stringLiteral: "往 \(d)"))
                })
            }
        )
    }
}

struct MetroWidgetCatalog {
    struct System { let id: String; let label: String; let precision: String; let crowd: Bool
                    let stationNames: [String]; let destinations: [String] }
    let systems: [System]
    let alias: [String: [String: String]]
    let lastTrain: [String: String]

    static let shared: MetroWidgetCatalog = load()

    private static func load() -> MetroWidgetCatalog {
        guard let url = Bundle.main.url(forResource: "MetroWidgetData", withExtension: "json"),
              let raw = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
            // 🔴 讀不到就回空目錄,讓 provider 走「照樣給選項」那條(空 systems 時 use 也是空,
            //    ItemCollection 會是空的——這是唯一真的沒東西可列的情況,與 .empty 的語意不同)。
            return MetroWidgetCatalog(systems: [], alias: [:], lastTrain: [:])
        }
        var out: [System] = []
        for s in (obj["systems"] as? [[String: Any]] ?? []) {
            let lines = s["lines"] as? [[String: Any]] ?? []
            let stations = lines.flatMap { $0["stations"] as? [[String: Any]] ?? [] }
            var names: [String] = [], dests: Set<String> = []
            for st in stations {
                if let n = st["name"] as? String, !names.contains(n) { names.append(n) }
                for d in (st["dests"] as? [String] ?? []) { dests.insert(d) }
            }
            out.append(System(id: s["id"] as? String ?? "", label: s["label"] as? String ?? "",
                              precision: s["precision"] as? String ?? "min",
                              crowd: s["crowd"] as? Bool ?? false,
                              stationNames: names, destinations: dests.sorted()))
        }
        return MetroWidgetCatalog(systems: out,
                                  alias: obj["alias"] as? [String: [String: String]] ?? [:],
                                  lastTrain: obj["lastTrain"] as? [String: String] ?? [:])
    }
}
