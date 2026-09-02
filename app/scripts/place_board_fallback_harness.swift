import Foundation

// RailBoardData extends this UI-owned enum. The production target gets it from
// RailWidgetKit.swift; this Foundation-only model harness supplies the same shape.
enum RailHeading {
    case north
    case south
}

@main
private struct PlaceBoardFallbackHarness {
    static func main() throws {
        guard CommandLine.arguments.count == 6 else {
            fatalError(
                "usage: fallback-harness <app-group-root> <place-index> "
                    + "<tra-track> <thsr-track> <report>"
            )
        }
        let baseRoot = URL(
            fileURLWithPath: CommandLine.arguments[1],
            isDirectory: true
        )
        let fileManager = FileManager.default
        let fixtureRoot = URL(
            fileURLWithPath: "/private/tmp/placeboard-g7-fixtures",
            isDirectory: true
        )
        if fileManager.fileExists(atPath: fixtureRoot.path) {
            try fileManager.removeItem(at: fixtureRoot)
        }
        try fileManager.createDirectory(
            at: fixtureRoot,
            withIntermediateDirectories: true
        )

        let missingRoot = fixtureRoot.appendingPathComponent(
            "missing-places",
            isDirectory: true
        )
        let farRoot = fixtureRoot.appendingPathComponent(
            "far-place",
            isDirectory: true
        )
        for root in [missingRoot, farRoot] {
            try fileManager.createDirectory(
                at: root,
                withIntermediateDirectories: true
            )
            for name in ["meta.json", "stations.json"] {
                try fileManager.copyItem(
                    at: baseRoot.appendingPathComponent(name),
                    to: root.appendingPathComponent(name)
                )
            }
            try fileManager.copyItem(
                at: baseRoot.appendingPathComponent(
                    "board",
                    isDirectory: true
                ),
                to: root.appendingPathComponent(
                    "board",
                    isDirectory: true
                )
            )
        }

        let missingKey = "place|24.800204,121.038010|家"
        let missingStore = RailBoardStore(rootURL: missingRoot)
        let missingPlaceBoard = try? missingStore.placeBoard(
            forKey: missingKey
        )
        guard
            missingPlaceBoard == nil,
            let missingSelection = try missingStore.stationSelection(
                forKey: missingKey
            )
        else {
            fatalError("missing places.json did not fall back to a station")
        }
        _ = try RailBoardEngine(store: missingStore).prepare(
            originID: missingSelection.station.index,
            destinationID: nil,
            originDisplayName: missingSelection.displayName,
            now: Date()
        )

        let index = try decode(
            RailBoardScheduleWriter.PlaceIndexDocument.self,
            path: CommandLine.arguments[2]
        )
        let tra = try decode(
            RailBoardScheduleWriter.TrackDocument.self,
            path: CommandLine.arguments[3]
        )
        let thsr = try decode(
            RailBoardScheduleWriter.TrackDocument.self,
            path: CommandLine.arguments[4]
        )
        let farPlace = RailBoardScheduleWriter.PlaceInput(
            label: "遠方",
            lat: 23.5711,
            lon: 119.5793,
            manual: true
        )
        let farBoards = RailBoardScheduleWriter.PlaceBoardBuilder.build(
            places: [farPlace],
            index: index,
            trackLines: tra.lines + thsr.lines
        )
        guard farBoards.count == 1, farBoards[0].lines.isEmpty else {
            fatalError("far place unexpectedly selected a rail line")
        }
        try Data(
            """
            {"v":1,"places":[{"label":"遠方","lat":23.5711,"lon":119.5793,"manual":true}]}
            """.utf8
        ).write(
            to: farRoot.appendingPathComponent("places.json"),
            options: .atomic
        )
        let farBoardDirectory = farRoot.appendingPathComponent(
            "place-board",
            isDirectory: true
        )
        try fileManager.createDirectory(
            at: farBoardDirectory,
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(farBoards[0]).write(
            to: farBoardDirectory.appendingPathComponent("0.json"),
            options: .atomic
        )
        let farStore = RailBoardStore(rootURL: farRoot)
        guard
            let decodedFar = try farStore.placeBoard(
                forKey: "place|23.571100,119.579300|遠方"
            ),
            decodedFar.lines.isEmpty,
            let providerMessage = decodedFar.unavailableMessage
        else {
            fatalError("far place-board did not decode as an empty line list")
        }

        let oldStore = RailBoardStore(rootURL: baseRoot)
        guard
            let oldSelection = try oldStore.stationSelection(
                forKey: "tra|竹北"
            ),
            oldSelection.station.key == "tra|竹北"
        else {
            fatalError("legacy station key did not resolve to 竹北")
        }
        let oldPrepared = try RailBoardEngine(store: oldStore).prepare(
            originID: oldSelection.station.index,
            destinationID: nil,
            now: Date()
        )

        let result = ResultDocument(
            missingPlaces: MissingResult(
                placeBoardWasNil: missingPlaceBoard == nil,
                fallbackStation: missingSelection.station.key,
                fallbackTitle: missingSelection.displayName
                    ?? missingSelection.station.name
            ),
            farPlace: FarResult(
                generatedLines: farBoards[0].lines.count,
                decodedLines: decodedFar.lines.count,
                providerMessage: providerMessage
            ),
            legacyStation: LegacyResult(
                key: oldSelection.station.key,
                stationIndex: oldSelection.station.index,
                preparedTitle: oldPrepared.title,
                futureJourneys: oldPrepared.journeys.count
            )
        )
        let reportURL = URL(fileURLWithPath: CommandLine.arguments[5])
        let reportEncoder = JSONEncoder()
        reportEncoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try reportEncoder.encode(result).write(
            to: reportURL,
            options: .atomic
        )
        print(String(data: try reportEncoder.encode(result), encoding: .utf8)!)
    }

    private static func decode<T: Decodable>(
        _ type: T.Type,
        path: String
    ) throws -> T {
        try JSONDecoder().decode(
            type,
            from: Data(contentsOf: URL(fileURLWithPath: path))
        )
    }
}

private struct ResultDocument: Encodable {
    let missingPlaces: MissingResult
    let farPlace: FarResult
    let legacyStation: LegacyResult
}

private struct MissingResult: Encodable {
    let placeBoardWasNil: Bool
    let fallbackStation: String
    let fallbackTitle: String
}

private struct FarResult: Encodable {
    let generatedLines: Int
    let decodedLines: Int
    let providerMessage: String
}

private struct LegacyResult: Encodable {
    let key: String
    let stationIndex: Int
    let preparedTitle: String
    let futureJourneys: Int
}
