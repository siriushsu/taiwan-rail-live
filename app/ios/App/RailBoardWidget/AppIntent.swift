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

// 起站選單：245 個台鐵站原本只分「台鐵／高鐵」兩段，只能一路下拉找（使用者 2026-07-30 回報）。
// 改成依縣市分段，並讓上面的「區域」把該縣市那段提到最前面。
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
        guard stations.contains(where: { $0.region != nil }) else {
            let tra = stations.filter { $0.systemID == "tra" }
            let thsr = stations.filter { $0.systemID == "thsr" }
            return IntentItemCollection {
                IntentItemSection("台鐵", items: tra.map(\.intentItem))
                IntentItemSection("高鐵", items: thsr.map(\.intentItem))
            }
        }

        var byRegion: [String: [StationOption]] = [:]
        for station in stations {
            byRegion[station.region ?? "其他", default: []].append(station)
        }
        let present = try RailBoardStore.shared.regionOptions()
        let picked = intent?.region
        // 選了區域就把那一段拉到最前面；其餘維持由北到南，最後才是查不到縣市的「其他」。
        var order = present.filter { $0 != picked }
        if let picked, byRegion[picked] != nil { order.insert(picked, at: 0) }
        if byRegion["其他"] != nil { order.append("其他") }

        let sections = order.compactMap { region -> IntentItemSection<String>? in
            guard let items = byRegion[region], !items.isEmpty else { return nil }
            return IntentItemSection(
                LocalizedStringResource(stringLiteral: region),
                items: items.map(\.intentItem)
            )
        }
        return IntentItemCollection(promptLabel: "先選上面的「區域」可以直接跳到該縣市", sections: sections)
    }
}

@available(iOS 17.0, *)
struct DestinationOptionsProvider: DynamicOptionsProvider {
    @IntentParameterDependency<ConfigurationAppIntent>(\.$origin)
    var intent

    func results() async throws -> IntentItemCollection<String> {
        guard let origin = intent?.origin else {
            return .empty
        }

        let destinations = try RailBoardStore.shared.destinationOptions(from: origin)
        return IntentItemCollection(promptLabel: "只顯示有直達列車的車站") {
            IntentItemSection(items: destinations.map(\.intentItem))
        }
    }
}

@available(iOS 17.0, *)
struct BoardFilterOptionsProvider: DynamicOptionsProvider {
    @IntentParameterDependency<ConfigurationAppIntent>(\.$origin, \.$destination)
    var intent

    func results() async throws -> IntentItemCollection<String> {
        guard let origin = intent?.origin,
              let originID = try RailBoardStore.shared.stationIndex(forKey: origin) else {
            return .empty
        }
        var destinationID: Int?
        if let destinationKey = intent?.destination {
            destinationID = try RailBoardStore.shared.stationIndex(forKey: destinationKey)
        }
        let options = try RailBoardEngine().filterOptions(
            originID: originID,
            destinationID: destinationID
        )

        return IntentItemCollection(promptLabel: "留空就是全部都看") {
            IntentItemSection("車種", items: options.types.map(\.intentItem))
            IntentItemSection("車次", items: options.trains.map(\.intentItem))
        }
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
        IntentDescription("先選區域可以快速找到起站；目的站可留空，以查看所有停靠、終到與通過列車。")
    }

    // 區域只是起站選單的導覽器，不影響看板內容：留空＝清單照北到南全列。
    @Parameter(title: "區域（可留空）", optionsProvider: RegionOptionsProvider())
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
