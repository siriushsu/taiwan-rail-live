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
/// 讓使用者一加上小工具就能先選好。名稱一律是網頁 COLLECT_SYS 的簡稱：有檔案照抄 payload 的 label（網頁當下語言），
/// 沒檔案走原生目錄，語言跟 App 設定、沒設定才看系統語言——開 App 前後是同一組名稱。選單內容與語言的決定都在
/// CollectionCard.swift 的 CollectionScopeName（純函式，給驗收腳本編）。
struct CollectionScopeOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> ItemCollection<String> {
        let payload = CollectionStore.loadShared().map { $0.sys.map { (k: $0.k, label: $0.label) } }
        let menu = CollectionScopeName.menu(payload: payload, language: CollectionScopeName.currentLanguage())
        let items = menu.map { IntentItem<String>($0.k, title: LocalizedStringResource(stringLiteral: $0.title)) }
        return ItemCollection(sections: [IntentItemSection(items: items)])
    }
}
