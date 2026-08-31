//
//  AppIntent.swift
//  RailBoardWidget
//
//  Created by 許翔 on 2026/7/29.
//

import AppIntents
import Foundation

// 為什麼參數型別是 String 而不是 AppEntity：
// 用 AppEntity（StationEntity）時，AppIntents 在小工具行程內每一次 InitializeAction 都會
// 丟 "Failed to build EntityIdentifier. StationEntity is not a registered AppEntity identifier"，
// 兩個參數一律被還原成 nil ⇒ 目的站選單永遠是空的、桌面上也永遠停在「請選擇起站」。
// 實測排除過：把 optionsProvider 拿掉走 EntityQuery（照舊失敗）、把 entity 同時編進 App target
// 讓 App bundle 也有 Metadata.appintents（照舊失敗）；Int 是合法 ID 型別（SDK interface 有
// `extension Swift.Int : EntityIdentifierConvertible`），linkd 也確實把兩份 metadata 都註冊了。
// 改走 Apple 小工具範本本身用的字串參數，繞開整套 EntityIdentifier 機制。
// 附帶好處：存的是「系統|站名」而不是班表陣列索引，班表重建造成的索引位移不再會讓設定指到別站。

// 起站與目的站共用的縣市分段。順序由北到南沿幹線走（regionOrder），名單外的縣市（改制／資料異常）
// 補在後面、查不到縣市的收在最後的「其他」——都不靜默丟掉，設定裡存的車站鍵才不會變成對不到標題的裸鍵。
// 回傳 nil＝這份資料沒有縣市欄（舊 App 寫的 stations.json v1），由呼叫端各自退回原本的分段方式。
@available(iOS 17.0, *)
func stationRegionSections(_ stations: [StationOption]) -> [IntentItemSection<String>]? {
    guard stations.contains(where: { $0.region != nil }) else { return nil }

    var byRegion: [String: [StationOption]] = [:]
    for station in stations {
        byRegion[station.region ?? "其他", default: []].append(station)
    }
    var order = StationOption.regionOrder.filter { byRegion[$0] != nil }
    order += byRegion.keys
        .filter { $0 != "其他" && !StationOption.regionOrder.contains($0) }
        .sorted()
    if byRegion["其他"] != nil { order.append("其他") }

    return order.compactMap { region -> IntentItemSection<String>? in
        guard let items = byRegion[region], !items.isEmpty else { return nil }
        return IntentItemSection(
            LocalizedStringResource(stringLiteral: RailNativeL10n.name(region)),
            items: items.map(\.intentItem)
        )
    }
}

@available(iOS 17.0, *)
func placeSection(_ stations: [StationOption]) -> IntentItemSection<String>? {
    let places = RailBoardStore.shared.placeStationOptions(from: stations)
    guard !places.isEmpty else { return nil }
    return IntentItemSection("我的地點", items: places.map(\.intentItem))
}

// 共站（台鐵與高鐵同一個地方，如台北、板橋、新烏日／高鐵台中）獨立成一段。
// 為什麼不是在縣市那幾段裡把同名的併掉：12 個高鐵站有 8 個與台鐵共站，其中 5 個名字不一樣
// （六家／新竹、豐富／苗栗、新烏日／台中、沙崙／台南、新左營／左營），靠站名比對會漏掉一半，
// 所以共站是 App 端用座標判的（≤800 公尺），這裡只是把結果列出來。
// 選了共站＝走地點看板那套（1.5 公里內每條線各一組），不是某一個系統的發車看板。
@available(iOS 17.0, *)
func compositeSection() -> IntentItemSection<String>? {
    let composites = RailBoardStore.shared.composites()
    guard !composites.isEmpty else { return nil }
    return IntentItemSection(
        "共站（台鐵＋高鐵一起看）",
        items: composites.map {
            IntentItem(
                $0.key,
                title: LocalizedStringResource(stringLiteral: RailNativeL10n.option($0.label)),
                subtitle: LocalizedStringResource(stringLiteral: RailNativeL10n.option($0.subtitle))
            )
        }
    )
}

// 起站選單：245 個台鐵站原本只分「台鐵／高鐵」兩段，只能一路下拉找（使用者 2026-07-30 回報）。
// 改成依縣市由北到南分段（使用者裁示：不要多一格縣市選單）。
// 🔴 這一列「沒有」搜尋框（2026-07-30 使用者在真機設定畫面確認）：單選 String 參數的選單是
// 彈出式的，iOS 不給搜尋列，只有 [String] 多選（「只看這些」）才有。文案一度寫成「可以直接打
// 站名搜尋」，那是錯的、已改掉——要再寫「搜尋」兩個字之前，先回設定畫面確認它真的出現了。
// 目前的替代路徑是縣市分段，加上最上面那段「我的地點」直接選存過的地方。
// 刻意沒有依賴任何參數：這一列永遠列出全部車站，選過的起站就不會因為別格的值變動而從清單消失
// （消失＝設定畫面只剩一個對不到標題的裸鍵）。
@available(iOS 17.0, *)
struct OriginOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> IntentItemCollection<String> {
        let stations = RailBoardStore.shared.configurationStationOptions()
        guard !stations.isEmpty else { return .empty }
        // 順序：自己存的地點 → 共站 → 依縣市排的全部車站。前兩段是「一次看到附近全部路線」，
        // 第三段才是傳統的單一系統發車看板。
        let leading = [placeSection(stations), compositeSection()].compactMap { $0 }

        // 舊 App 寫的 stations.json（v1）沒有縣市：退回原本的依系統分段，不是空清單。
        guard let sections = stationRegionSections(stations) else {
            let tra = stations.filter { $0.systemID == "tra" }
            let thsr = stations.filter { $0.systemID == "thsr" }
            return IntentItemCollection(
                sections: leading + [
                    IntentItemSection("台鐵", items: tra.map(\.intentItem)),
                    IntentItemSection("高鐵", items: thsr.map(\.intentItem))
                ]
            )
        }
        return IntentItemCollection(
            promptLabel: "最上面是你存過的地點與共站，往下依縣市排",
            sections: leading + sections
        )
    }
}

// 目的站：也依縣市分段（使用者 2026-07-30 回報「起訖站不同縣市這樣不好查」）。
//
// 🔴 這裡不要再加「目的站區域」那一格（2026-07-30 實測做不到，使用者裁示改走縣市分段）：
// 這一列的清單必須依賴 origin 才知道哪些站到得了，而 @IntentParameterDependency 一旦把
// 「目的站區域」也列進來（不管是跟 origin 一起兩個、或只留區域一個），設定畫面的「目的站」
// 那一列就整列點不動——點下去連 extension 都不會被喚醒（系統紀錄零活動），因為 AppIntents
// 判定依賴沒被滿足就直接停用那一列。改成 AppEnum＋預設值、把值存進設定再重開也一樣不動。
// 2026-08-06 又找到兩種「載入一下就收起來」：App 更新後完整班表還在背景建立時，這裡可能
// ①讀檔丟錯，或 ②iOS 暫時還沒把 origin dependency 交進來／舊鍵一時對不到而得到空陣列。
// 任何一種若回 .empty，系統都會直接把目的站選單收掉。直達站連動本身保留；只有依賴值或
// 共享資料尚未就緒時才暫列內建的完整站表，讓使用者永遠有東西可選。
@available(iOS 17.0, *)
struct DestinationOptionsProvider: DynamicOptionsProvider {
    @IntentParameterDependency<ConfigurationAppIntent>(\.$origin)
    var intent

    func results() async throws -> IntentItemCollection<String> {
        let destinations: [StationOption]
        let promptLabel: LocalizedStringResource
        if let origin = intent?.origin,
           origin.hasPrefix(RailBoardStore.compositeKeyPrefix)
            || origin.hasPrefix("place|")
        {
            // 共站／我的地點走的是「附近路線」時間軸，目的站參數不參與渲染
            // （`RailBoardWidget.swift:151` 的 placeTimeline 在第 159 行讀 configuration.destination
            // 之前就早退）。
            //
            // 🔴 2026-08-07 使用者回報「起站選共站後，目的站一點就跳出去、打不開」：原本這裡回
            // `.empty` 想把這一格「停用」，但上面第 119 行自己的註解就寫了——回 .empty 系統會直接
            // 把選單收掉，那不是停用而是壞掉。改成照樣列出完整站表，並用 promptLabel 說明這格
            // 不生效。選到什麼都不影響渲染（早退路徑根本不讀），而且存進去的仍是合法站鍵 ⇒
            // 日後把起站改回一般車站時解得開，不會觸發 destinationLost 的「找不到這個車站」。
            //
            // 🔴 2026-08-08 使用者二度回報同一件事，原因不是修法錯而是**修正被擱在別的分支**：
            // 上面那顆只 commit 在 `feat/railboard-widget`（軌島-小工具 那棵樹）的 7c5c9af，
            // main 與 feat/la-push 都沒有 ⇒ 之後出的 27／28／29／31 全部照舊壞掉。
            // 出 build 的線目前是 feat/la-push，只在小工具樹修等於沒修。
            destinations = RailBoardStore.shared.configurationStationOptions()
            promptLabel = "共站看板不看目的站，這格可留空"
        } else if let origin = intent?.origin {
            do {
                let direct = try RailBoardStore.shared.destinationOptions(from: origin)
                if direct.isEmpty {
                    // 起站鍵剛寫入、共享 stations/board 還沒換成同一代時，解析會回空陣列而
                    // 不是丟錯。空集合交給 AppIntents 會讓目的站選單立即收起，照樣要降級。
                    destinations = RailBoardStore.shared.configurationStationOptions()
                    promptLabel = "班表準備中，先列出全部車站"
                } else {
                    destinations = direct
                    promptLabel = "只顯示有直達列車的車站"
                }
            } catch {
                // App 更新／首次開啟的完整班表尚未發布時，先用 bundle 內建目錄讓設定繼續。
                // 不可把錯誤丟回 AppIntents：iOS 會直接關掉整張小工具設定頁。
                destinations = RailBoardStore.shared.configurationStationOptions()
                promptLabel = "班表準備中，先列出全部車站"
            }
        } else {
            // IntentParameterDependency 的 wrappedValue 契約本來就是 optional；真機在開啟
            // 選單的第一拍可能先給 nil，下一拍才帶入已選起站。這一拍不能回 .empty。
            destinations = RailBoardStore.shared.configurationStationOptions()
            promptLabel = "正在讀取起站，先列出全部車站"
        }
        guard !destinations.isEmpty else { return .empty }

        let places = placeSection(destinations)
        guard let sections = stationRegionSections(destinations) else {
            var fallbackSections = [IntentItemSection(items: destinations.map(\.intentItem))]
            if let places { fallbackSections.insert(places, at: 0) }
            return IntentItemCollection(
                promptLabel: promptLabel,
                sections: fallbackSections
            )
        }
        return IntentItemCollection(
            promptLabel: promptLabel,
            sections: places.map { [$0] + sections } ?? sections
        )
    }
}

@available(iOS 17.0, *)
struct BoardFilterOptionsProvider: DynamicOptionsProvider {
    // 為什麼只宣告 origin、也不讀 destination（2026-07-30 兩種寫法都在模擬器上實測過）：
    //   ① 連 destination 一起宣告 ⇒ 目的站留空（本來就允許留空）時整個依賴解不出來、intent 為 nil，
    //      這一格顯示「沒有可用的選項。」＝最常見的用法反而不能用。
    //   ② 只宣告 origin 但照樣讀 intent?.destination ⇒ 整個 extension 當場崩潰，
    //      AppIntents 直接 fatalError：「Illegal use of the \ConfigurationAppIntent.destination
    //      parameter. Please make sure that it is included in the @IntentParameterDependency」。
    // 所以清單一律列「這一站的全部車種與車次」，不因目的站收窄。代價是設了目的站時這裡會多列幾班
    // 到不了那裡的車，但篩選之間是 OR、留空＝全部，看板本身仍會照目的站過濾，不會少列該有的。
    @IntentParameterDependency<ConfigurationAppIntent>(\.$origin)
    var intent

    func results() async throws -> IntentItemCollection<String> {
        guard let origin = intent?.origin else {
            return .empty
        }
        let options: (types: [FilterOption], trains: [FilterOption])
        // 方向只有地點看板有：車站看板本來就是「這一站的發車」，方向由目的站決定。
        var directions: [FilterOption] = []
        // 「含通過列車」不是篩掉什麼、是多顯示什麼，所以獨立一段，也不算進「留空就是全部」。
        var passSwitch: [FilterOption] = []
        if let placeBoard = RailBoardStore.shared.placeLikeBoard(forKey: origin) {
            let engine = RailBoardEngine()
            options = try engine.filterOptions(placeBoard: placeBoard)
            directions = engine.directionOptions(placeBoard: placeBoard)
        } else {
            guard let originID = try RailBoardStore.shared.stationIndex(forKey: origin) else {
                return .empty
            }
            let engine = RailBoardEngine()
            options = try engine.filterOptions(
                originID: originID,
                destinationID: nil
            )
            // 只有通過車的小站，車種與車次兩段都會是空的——沒有這一段就整格「沒有可用的選項」，
            // 使用者連把通過列車叫回來的入口都沒有。
            if engine.hasPassTrains(originID: originID) {
                passSwitch = [FilterOption(
                    key: BoardFilter.includePass.key,
                    title: "含通過列車",
                    subtitle: "預設只顯示停靠與終到"
                )]
            }
        }
        // 空的 section 不放進去（今天完全沒車的站）——寧可整格顯示「沒有可用的選項」，
        // 也不要塞一個空標題進 IntentItemCollection。
        // 方向排在最前面：它是最粗的一刀（一次砍掉一半），車種車次是在那之上再細分。
        let sections = [
            directions.isEmpty ? nil : IntentItemSection<String>("方向（與下面的條件同時成立）", items: directions.map(\.intentItem)),
            passSwitch.isEmpty ? nil : IntentItemSection<String>("通過本站的列車", items: passSwitch.map(\.intentItem)),
            options.types.isEmpty ? nil : IntentItemSection<String>("車種", items: options.types.map(\.intentItem)),
            options.trains.isEmpty ? nil : IntentItemSection<String>("車次", items: options.trains.map(\.intentItem)),
        ].compactMap { $0 }
        if sections.isEmpty { return .empty }
        return IntentItemCollection(
            promptLabel: passSwitch.isEmpty ? "留空就是全部都看" : "留空就是這一站的停靠與終到列車",
            sections: sections
        )
    }
}

@available(iOS 17.0, *)
extension FilterOption {
    var intentItem: IntentItem<String> {
        IntentItem(
            key,
            title: LocalizedStringResource(stringLiteral: RailNativeL10n.option(title)),
            subtitle: subtitle.map { LocalizedStringResource(stringLiteral: RailNativeL10n.option($0)) }
        )
    }
}

@available(iOS 17.0, *)
extension StationOption {
    /// 值是穩定鍵、顯示的是站名，兩者刻意不同——選單上不該出現 "tra|竹北"。
    var intentItem: IntentItem<String> {
        IntentItem(
            key,
            title: LocalizedStringResource(stringLiteral: RailNativeL10n.name(name)),
            subtitle: LocalizedStringResource(stringLiteral: RailNativeL10n.name(systemLabel))
        )
    }
}

@available(iOS 17.0, *)
extension PlaceStationOption {
    var intentItem: IntentItem<String> {
        IntentItem(
            key,
            title: LocalizedStringResource(stringLiteral: displayLabel),
            subtitle: LocalizedStringResource(stringLiteral: RailNativeL10n.option(subtitle))
        )
    }
}

@available(iOS 17.0, *)
struct ConfigurationAppIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "發車看板" }
    static var description: IntentDescription {
        IntentDescription("起訖站清單依縣市由北到南分段，最上面可以直接選你在軌島存過的地點。目的站可留空，以查看接下來的停靠與終到列車；想一併看通過本站不停靠的車，或起站選共站或我的地點時，請用「只看這些」篩選。")
    }

    @Parameter(title: "起站", optionsProvider: OriginOptionsProvider())
    var origin: String?

    @Parameter(title: "目的站（可留空）", optionsProvider: DestinationOptionsProvider())
    var destination: String?

    // 車種與車次刻意合成同一格：通勤族要的是「我那幾班」，等車族要的是「只看自強」，
    // 兩者共用一個入口，勾選之間是 OR。
    @Parameter(title: "只看這些（可留空）", optionsProvider: BoardFilterOptionsProvider())
    var filters: [String]?
}

@available(iOS 17.0, *)
extension ConfigurationAppIntent {
    static var previewCommute: ConfigurationAppIntent {
        let intent = ConfigurationAppIntent()
        intent.origin = StationOption.makeKey(systemID: "tra", name: "竹北")
        intent.destination = StationOption.makeKey(systemID: "tra", name: "臺北")
        return intent
    }

    static var previewWatching: ConfigurationAppIntent {
        let intent = ConfigurationAppIntent()
        intent.origin = StationOption.makeKey(systemID: "tra", name: "竹北")
        intent.destination = nil
        return intent
    }
}
