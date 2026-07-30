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

@available(iOS 17.0, *)
struct RegionOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        try RailBoardStore.shared.regionOptions()
    }
}

// 起站與目的站共用的縣市分段。順序由北到南沿幹線走（regionOrder），名單外的縣市（改制／資料異常）
// 補在後面、查不到縣市的收在最後的「其他」——都不靜默丟掉，設定裡存的車站鍵才不會變成對不到標題的裸鍵。
// hoist 有值＝把那一段提到最前面（只有起站用得到，見 DestinationOptionsProvider）。
// 回傳 nil＝這份資料沒有縣市欄（舊 App 寫的 stations.json v1），由呼叫端各自退回原本的分段方式。
@available(iOS 17.0, *)
func stationRegionSections(_ stations: [StationOption], hoist: String? = nil) -> [IntentItemSection<String>]? {
    guard stations.contains(where: { $0.region != nil }) else { return nil }

    var byRegion: [String: [StationOption]] = [:]
    for station in stations {
        byRegion[station.region ?? "其他", default: []].append(station)
    }
    var order = StationOption.regionOrder.filter { byRegion[$0] != nil }
    order += byRegion.keys
        .filter { $0 != "其他" && !StationOption.regionOrder.contains($0) }
        .sorted()
    if let hoist, byRegion[hoist] != nil { order = [hoist] + order.filter { $0 != hoist } }
    if byRegion["其他"] != nil { order.append("其他") }

    return order.compactMap { region -> IntentItemSection<String>? in
        guard let items = byRegion[region], !items.isEmpty else { return nil }
        return IntentItemSection(
            LocalizedStringResource(stringLiteral: region),
            items: items.map(\.intentItem)
        )
    }
}

// 起站選單：245 個台鐵站原本只分「台鐵／高鐵」兩段，只能一路下拉找（使用者 2026-07-30 回報）。
// 改成依縣市分段，並讓上面的「起站區域」把該縣市那段提到最前面。
// 為什麼是「提到最前面」而不是「只留該區域」：設定裡存的值是車站鍵，若選過的起站因為換了區域
// 而從清單消失，設定畫面就只剩一個對不到標題的裸鍵。永遠列出全部＝既有設定不會被弄壞。
// 為什麼沒有搜尋框：搜尋要 EntityStringQuery，那需要 AppEntity——在這個 extension 內
// EntityIdentifier 註冊一律失敗（見檔頭），所以搜尋這條路是關著的。
@available(iOS 17.0, *)
struct OriginOptionsProvider: DynamicOptionsProvider {
    @IntentParameterDependency<ConfigurationAppIntent>(\.$region)
    var intent

    func results() async throws -> IntentItemCollection<String> {
        let stations = try RailBoardStore.shared.stationOptions()

        // 舊 App 寫的 stations.json（v1）沒有縣市：退回原本的依系統分段，不是空清單。
        guard let sections = stationRegionSections(stations, hoist: intent?.region) else {
            let tra = stations.filter { $0.systemID == "tra" }
            let thsr = stations.filter { $0.systemID == "thsr" }
            return IntentItemCollection {
                IntentItemSection("台鐵", items: tra.map(\.intentItem))
                IntentItemSection("高鐵", items: thsr.map(\.intentItem))
            }
        }
        return IntentItemCollection(promptLabel: "先選上面的「起站區域」可以直接跳到該縣市", sections: sections)
    }
}

// 目的站：也依縣市分段（使用者 2026-07-30 回報「起訖站不同縣市這樣不好查」）。
//
// 🔴 為什麼沒有「目的站區域」那一格可以選縣市（使用者要過，2026-07-30 實測做不到）：
// 這一列的清單必須依賴 origin 才知道哪些站到得了，而 @IntentParameterDependency 一旦把
// 「目的站區域」也列進來（不管是跟 origin 一起兩個、或只留區域一個），設定畫面的「目的站」
// 那一列就整列點不動——點下去連 extension 都不會被喚醒（系統紀錄零活動），因為 AppIntents
// 判定依賴沒被滿足就直接停用那一列。改成 AppEnum＋預設值、把值存進設定再重開也一樣不動。
// 起站那格能用是因為它「就算 intent 解不出來也照樣列全部」，目的站沒有這個退路。
// 所以維持：清單照起站收窄、依縣市由北到南分段；清單長的時候 iOS 自己會給搜尋框可以打站名。
@available(iOS 17.0, *)
struct DestinationOptionsProvider: DynamicOptionsProvider {
    @IntentParameterDependency<ConfigurationAppIntent>(\.$origin)
    var intent

    func results() async throws -> IntentItemCollection<String> {
        guard let origin = intent?.origin else {
            return .empty
        }

        let destinations = try RailBoardStore.shared.destinationOptions(from: origin)
        guard let sections = stationRegionSections(destinations) else {
            return IntentItemCollection(promptLabel: "只顯示有直達列車的車站") {
                IntentItemSection(items: destinations.map(\.intentItem))
            }
        }
        return IntentItemCollection(promptLabel: "只顯示有直達列車的車站，依縣市分段", sections: sections)
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
        guard let origin = intent?.origin,
              let originID = try RailBoardStore.shared.stationIndex(forKey: origin) else {
            return .empty
        }
        let options = try RailBoardEngine().filterOptions(originID: originID, destinationID: nil)
        // 空的 section 不放進去（今天完全沒車的站）——寧可整格顯示「沒有可用的選項」，
        // 也不要塞一個空標題進 IntentItemCollection。
        let sections = [
            options.types.isEmpty ? nil : IntentItemSection<String>("車種", items: options.types.map(\.intentItem)),
            options.trains.isEmpty ? nil : IntentItemSection<String>("車次", items: options.trains.map(\.intentItem)),
        ].compactMap { $0 }
        if sections.isEmpty { return .empty }
        return IntentItemCollection(promptLabel: "留空就是全部都看", sections: sections)
    }
}

@available(iOS 17.0, *)
extension FilterOption {
    var intentItem: IntentItem<String> {
        IntentItem(
            key,
            title: LocalizedStringResource(stringLiteral: title),
            subtitle: subtitle.map { LocalizedStringResource(stringLiteral: $0) }
        )
    }
}

@available(iOS 17.0, *)
extension StationOption {
    /// 值是穩定鍵、顯示的是站名，兩者刻意不同——選單上不該出現 "tra|竹北"。
    var intentItem: IntentItem<String> {
        IntentItem(
            key,
            title: LocalizedStringResource(stringLiteral: name),
            subtitle: LocalizedStringResource(stringLiteral: systemLabel)
        )
    }
}

@available(iOS 17.0, *)
struct ConfigurationAppIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "發車看板" }
    static var description: IntentDescription {
        IntentDescription("先選起站區域可以快速找到起站；起訖站清單都依縣市分段。目的站可留空，以查看所有停靠、終到與通過列車。")
    }

    // 只是起站選單的導覽器，不影響看板內容：留空＝清單照北到南全列。
    // 目的站沒有對應的一格（iOS 做不到，見 DestinationOptionsProvider），但它自己也依縣市分段。
    @Parameter(title: "起站區域（可留空）", optionsProvider: RegionOptionsProvider())
    var region: String?

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
