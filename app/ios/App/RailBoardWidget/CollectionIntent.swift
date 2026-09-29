import AppIntents
import WidgetKit

// 🔴 參數一律 String＋optionsProvider，不用 AppEntity／AppEnum：這個 extension 每次 InitializeAction 都會
//    「Failed to build EntityIdentifier … is not a registered AppEntity identifier」，參數被還原成 nil
//    （細節與實測見 AppIntent.swift 檔頭、MetroBoardIntent.swift 檔頭）。
// 🔴 String 參數沒掛 optionsProvider 就是自由輸入框——這一格有掛。
// 🔴 刻意不定義 parameterSummary（定義了，沒被列進 Summary 的參數會整格被藏起來）；不給預設值
//    （String 的預設值只有值沒有顯示名稱，設定畫面會直接露出 "all"）——沒選過（nil）就是全台，
//    標題自己講出預設是什麼。
// 存值：`all`＝全台，其餘是 collection.json 裡 sys[].k（tra／thsr／trtc／tymc／tmrt／krtc／ntdlrt／
// ntalrt／sanying／afr），兩平台共用，不要改名。

struct CollectionIntent: AppIntent, WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "車站收集"
    static var description = IntentDescription("看你收集了幾成鐵道車站；範圍可選全台或單一系統。")

    @Parameter(title: "範圍", optionsProvider: CollectionScopeOptionsProvider())
    var scope: String?
}

/// 「範圍」選單：全台＋collection.json 裡有的系統。還沒有檔案（App 沒開過）時退回固定的十個系統，
/// 讓使用者一加上小工具就能先選好；選單標題用 payload 的 label（網頁當下語言），退回時走原生目錄。
struct CollectionScopeOptionsProvider: DynamicOptionsProvider {
    /// collection.json v1 的系統順序與代碼（契約固定值）。
    static let fallbackSystems: [(k: String, label: String)] = [
        ("tra", "台鐵"), ("thsr", "高鐵"), ("trtc", "北捷"), ("tymc", "機捷"), ("tmrt", "中捷"),
        ("krtc", "高捷"), ("ntdlrt", "淡海"), ("ntalrt", "安坑"), ("sanying", "三鶯"), ("afr", "林鐵"),
    ]

    func results() async throws -> ItemCollection<String> {
        let systems: [(k: String, label: String)]
        if let snapshot = CollectionStore.loadShared(), !snapshot.sys.isEmpty {
            systems = snapshot.sys.map { ($0.k, $0.label) }
        } else {
            systems = Self.fallbackSystems.map { ($0.k, RailNativeL10n.name($0.label)) }
        }
        var items = [IntentItem<String>(
            CollectionScope.allKey,
            title: LocalizedStringResource(stringLiteral: RailNativeL10n.text("全台")))]
        items += systems.map {
            IntentItem<String>($0.k, title: LocalizedStringResource(stringLiteral: $0.label))
        }
        return ItemCollection(sections: [IntentItemSection(items: items)])
    }
}
