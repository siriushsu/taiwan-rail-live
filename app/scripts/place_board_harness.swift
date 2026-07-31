import Foundation

private struct ProjectionQuery: Decodable {
    let id: Int
    let line: String
    let lat: Double
    let lon: Double
}

private struct ProjectionResult: Encodable {
    let id: Int
    let line: String
    let d: Double?
    let perp: Double?
}

private func decode<T: Decodable>(_ type: T.Type, path: String) throws -> T {
    try JSONDecoder().decode(
        type,
        from: Data(contentsOf: URL(fileURLWithPath: path))
    )
}

private func write<T: Encodable>(_ value: T, path: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    try encoder.encode(value).write(
        to: URL(fileURLWithPath: path),
        options: .atomic
    )
}

@main
private struct PlaceBoardHarness {
    static func main() throws {
        let arguments = CommandLine.arguments
        guard arguments.count >= 2 else {
            fatalError("usage: place_board_harness <build|project> ...")
        }

        switch arguments[1] {
        case "build":
            guard arguments.count == 7 else {
                fatalError(
                    "build <places.json> <place_index.json> <tra.json> "
                        + "<thsr_track.json> <output.json>"
                )
            }
            let places = try decode(
                RailBoardScheduleWriter.PlacesInputDocument.self,
                path: arguments[2]
            )
            let index = try decode(
                RailBoardScheduleWriter.PlaceIndexDocument.self,
                path: arguments[3]
            )
            let tra = try decode(
                RailBoardScheduleWriter.TrackDocument.self,
                path: arguments[4]
            )
            let thsr = try decode(
                RailBoardScheduleWriter.TrackDocument.self,
                path: arguments[5]
            )
            let boards = RailBoardScheduleWriter.PlaceBoardBuilder.build(
                places: places.places,
                index: index,
                trackLines: tra.lines + thsr.lines
            )
            try write(boards, path: arguments[6])

        case "project":
            guard arguments.count == 7 else {
                fatalError(
                    "project <queries.json> <tra.json> <thsr_track.json> "
                        + "<output.json> <production|mutant>"
                )
            }
            let queries = try decode([ProjectionQuery].self, path: arguments[2])
            let tra = try decode(
                RailBoardScheduleWriter.TrackDocument.self,
                path: arguments[3]
            )
            let thsr = try decode(
                RailBoardScheduleWriter.TrackDocument.self,
                path: arguments[4]
            )
            let lines = Dictionary(
                uniqueKeysWithValues: (tra.lines + thsr.lines).map { ($0.id, $0) }
            )
            let mutant = arguments[6] == "mutant"
            let output = queries.map { query -> ProjectionResult in
                guard
                    let line = lines[query.line],
                    let projection = RailBoardScheduleWriter.PlaceBoardBuilder.project(
                        line: line,
                        lat: query.lat,
                        lon: query.lon,
                        useSegmentMidpointLatitude: mutant
                    )
                else {
                    return ProjectionResult(
                        id: query.id,
                        line: query.line,
                        d: nil,
                        perp: nil
                    )
                }
                return ProjectionResult(
                    id: query.id,
                    line: query.line,
                    d: projection.dMeters,
                    perp: projection.perpKilometers * 1_000
                )
            }
            try write(output, path: arguments[5])

        default:
            fatalError("unknown command: \(arguments[1])")
        }
    }
}
