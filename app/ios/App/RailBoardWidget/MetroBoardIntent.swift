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

    /// 免費層可設定的車站數。nil ＝全免費。
    /// 🔴 2026-08-15 定價落地:改成 1(免費一站)。同批必須有明講的 CTA——
    /// 判定在 MetroPlusGate/MetroPlusCore,擋下時卡上畫升級說明並可點進通行證面板,
    /// 不做靜默空白卡(這個專案已經有三個「不給用也不說」的付費功能,不再加第四個)。
    static let freeStationLimit: Int? = 1

    // 🔴 真機實測(08-14):String 參數【沒掛 optionsProvider 就是自由輸入框】——
    //    使用者看到空白格要自己打字。三格每一格都要有 provider,少一個就漏一格。
    @Parameter(title: "系統", optionsProvider: MetroSystemOptionsProvider())
    var sys: String?

    @Parameter(title: "車站", optionsProvider: MetroStationOptionsProvider())
    var station: String?

    @Parameter(title: "方向（可留空）", optionsProvider: MetroDirectionOptionsProvider())
    var dir: String?

    // 🔴 刻意【不定義】parameterSummary——定義了它,沒被列進 Summary 的參數那一格
    //    會被整格藏起來(原規劃稿只列 station/dir,「系統」格就消失了)。
    //    出貨的發車看板同樣不定義,三格全部預設顯示(AppIntent.swift:278-286)。
}

struct MetroSystemOptionsProvider: DynamicOptionsProvider {
    // 值=系統 id(station provider 的依賴用 id 過濾、看板 entry 也吃 id),顯示=中文全名。
    func results() async throws -> ItemCollection<String> {
        ItemCollection(sections: [
            IntentItemSection("捷運系統", items: MetroWidgetCatalog.shared.systems.map {
                IntentItem<String>($0.id, title: LocalizedStringResource(stringLiteral: RailNativeL10n.name($0.label)))
            })
        ])
    }
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
        // 「自動(最近的站)」恆在最上,不受系統格過濾——它跨系統解析,選了它系統格就無作用
        //    (entry() 的 auto 分支在 sys 查表之前,方向格也一併忽略)。
        return ItemCollection(sections: [MetroNearest.optionSection()] + use.map { s in
            IntentItemSection(LocalizedStringResource(stringLiteral: RailNativeL10n.name(s.label)), items: s.stationNames.map {
                IntentItem<String>("\(s.id)|\($0)", title: LocalizedStringResource(stringLiteral: RailNativeL10n.name($0)))
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
                IntentItemSection(LocalizedStringResource(stringLiteral: RailNativeL10n.name(s.label)), items: s.destinations.map { d in
                    IntentItem<String>(d, title: LocalizedStringResource(stringLiteral: RailNativeL10n.text("往 {station}", ["station": RailNativeL10n.name(d)])))
                })
            }
        )
    }
}

// 🔴 MetroWidgetCatalog(目錄載入)已搬到 App/MetroWidgetShared.swift —— App target 也要用它
//    (等車卡從小工具背景開卡時,perform() 在 App 行程裡跑)。這裡只留指標,不留複本。
