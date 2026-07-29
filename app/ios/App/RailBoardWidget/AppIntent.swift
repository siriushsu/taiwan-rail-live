//
//  AppIntent.swift
//  RailBoardWidget
//
//  Created by 許翔 on 2026/7/29.
//

import AppIntents
import Foundation

struct StationEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "車站")
    static var defaultQuery = StationQuery()

    let id: Int
    let name: String
    let systemID: String
    let systemLabel: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(systemLabel)"
        )
    }

    init(id: Int, name: String, systemID: String, systemLabel: String) {
        self.id = id
        self.name = name
        self.systemID = systemID
        self.systemLabel = systemLabel
    }
}

struct StationQuery: EntityQuery {
    func entities(for identifiers: [StationEntity.ID]) async throws -> [StationEntity] {
        let entities = try RailBoardStore.shared.stationEntities()
        let byID = Dictionary(uniqueKeysWithValues: entities.map { ($0.id, $0) })
        return identifiers.compactMap { byID[$0] }
    }

    func suggestedEntities() async throws -> [StationEntity] {
        try RailBoardStore.shared.stationEntities()
    }
}

struct OriginOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> IntentItemCollection<StationEntity> {
        let entities = try RailBoardStore.shared.stationEntities()
        let tra = entities.filter { $0.systemID == "tra" }
        let thsr = entities.filter { $0.systemID == "thsr" }

        return IntentItemCollection {
            IntentItemSection("台鐵", items: tra)
            IntentItemSection("高鐵", items: thsr)
        }
    }
}

struct DestinationOptionsProvider: DynamicOptionsProvider {
    @IntentParameterDependency<ConfigurationAppIntent>(\.$origin)
    var intent

    func results() async throws -> IntentItemCollection<StationEntity> {
        guard let origin = intent?.origin else {
            return .empty
        }

        let destinations = try RailBoardStore.shared.destinationEntities(from: origin.id)
        return IntentItemCollection(
            promptLabel: "只顯示有直達列車的車站",
            items: destinations
        )
    }
}

struct ConfigurationAppIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "發車看板" }
    static var description: IntentDescription {
        IntentDescription("選擇起站；目的站可留空，以查看所有停靠、終到與通過列車。")
    }

    // WidgetConfigurationIntent 的 metadata 要求 entity 參數使用 optional；
    // Provider 仍把 nil 視為未完成設定，功能語意維持「起站必填」。
    @Parameter(title: "起站", optionsProvider: OriginOptionsProvider())
    var origin: StationEntity?

    @Parameter(title: "目的站（可留空）", optionsProvider: DestinationOptionsProvider())
    var destination: StationEntity?
}

extension ConfigurationAppIntent {
    static var previewCommute: ConfigurationAppIntent {
        let intent = ConfigurationAppIntent()
        intent.origin = StationEntity(id: 51, name: "竹北", systemID: "tra", systemLabel: "台鐵")
        intent.destination = StationEntity(id: 32, name: "臺北", systemID: "tra", systemLabel: "台鐵")
        return intent
    }

    static var previewWatching: ConfigurationAppIntent {
        let intent = ConfigurationAppIntent()
        intent.origin = StationEntity(id: 51, name: "竹北", systemID: "tra", systemLabel: "台鐵")
        intent.destination = nil
        return intent
    }
}
