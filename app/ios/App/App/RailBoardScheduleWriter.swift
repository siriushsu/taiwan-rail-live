import Foundation
import UIKit
import WidgetKit

/// 從 App bundle 的靜態班表建立發車看板資料，供 Widget extension 透過 App Group 讀取。
enum RailBoardScheduleWriter {
    private static let appGroupID = "group.tw.railisland.app"
    private static let workQueue = DispatchQueue(
        label: "tw.railisland.app.railboard-writer",
        qos: .utility
    )

    private enum RefreshResult: String {
        case written
        case unchanged
        case failed
    }

    static func refreshIfNeeded(application: UIApplication) {
        let backgroundTask = BackgroundTask(application: application)

        workQueue.async {
            let startedAt = ProcessInfo.processInfo.systemUptime
            let result = autoreleasepool {
                refreshIfNeeded()
            }
            let elapsed = ProcessInfo.processInfo.systemUptime - startedAt

            #if DEBUG
            print(String(
                format: "[RailBoardScheduleWriter] %@ in %.3f seconds",
                result.rawValue,
                elapsed
            ))
            #endif

            DispatchQueue.main.async {
                if result == .written {
                    WidgetCenter.shared.reloadAllTimelines()
                }
                backgroundTask.finish()
            }
        }
    }

    private static func refreshIfNeeded() -> RefreshResult {
        let fileManager = FileManager.default
        guard
            let rootURL = fileManager.containerURL(
                forSecurityApplicationGroupIdentifier: appGroupID
            ),
            let appBuild = currentAppBuild(),
            shouldRebuild(rootURL: rootURL, appBuild: appBuild)
        else {
            return .unchanged
        }

        let systemInputs = [
            SystemInput(
                id: "tra",
                label: "台鐵",
                resource: "public/data/tra_schedule_dense.json",
                live: true
            ),
            SystemInput(
                id: "thsr",
                label: "高鐵",
                resource: "public/data/thsr_schedule_dense.json",
                live: false
            ),
        ]

        var builder = BoardBuilder(existingStations: loadExistingStations(rootURL: rootURL))
        var loadedSystemCount = 0

        for input in systemInputs {
            guard
                let inputURL = Bundle.main.url(
                    forResource: input.resource,
                    withExtension: nil
                ),
                let data = try? Data(contentsOf: inputURL),
                let document = try? JSONDecoder().decode(ScheduleDocument.self, from: data)
            else {
                continue
            }

            builder.add(system: input, document: document)
            loadedSystemCount += 1
        }

        guard loadedSystemCount > 0 else {
            return .failed
        }

        do {
            try publish(
                builder: builder,
                rootURL: rootURL,
                appBuild: appBuild,
                fileManager: fileManager
            )
            return .written
        } catch {
            return .failed
        }
    }

    private static func currentAppBuild() -> String? {
        var webBuild: String?
        if
            let indexURL = Bundle.main.url(
                forResource: "public/index.html",
                withExtension: nil
            ),
            let html = try? String(contentsOf: indexURL, encoding: .utf8)
        {
            let pattern = #"const\s+BUILD\s*=\s*['"]([^'"]+)['"]"#
            if
                let expression = try? NSRegularExpression(pattern: pattern),
                let match = expression.firstMatch(
                    in: html,
                    range: NSRange(html.startIndex..., in: html)
                ),
                let range = Range(match.range(at: 1), in: html)
            {
                webBuild = String(html[range])
            }
        }

        let shortVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String
        let buildNumber = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String

        switch (webBuild, shortVersion, buildNumber) {
        case let (.some(webBuild), _, .some(buildNumber)):
            // 網頁 BUILD 會隨內容更新，CFBundleVersion 會隨原生發行更新；
            // 組合後可同時辨識兩種 build 變更，且同一顆 App 永遠得到同一值。
            return "\(webBuild)+\(buildNumber)"
        case let (.some(webBuild), _, .none):
            return webBuild
        case let (.none, .some(shortVersion), .some(buildNumber)):
            return "\(shortVersion)(\(buildNumber))"
        case let (.none, .some(shortVersion), .none):
            return shortVersion
        case let (.none, .none, .some(buildNumber)):
            return buildNumber
        case (.none, .none, .none):
            return nil
        }
    }

    private static func shouldRebuild(rootURL: URL, appBuild: String) -> Bool {
        let metaURL = rootURL.appendingPathComponent("meta.json")
        guard
            let data = try? Data(contentsOf: metaURL),
            let meta = try? JSONDecoder().decode(ExistingMeta.self, from: data)
        else {
            return true
        }
        return meta.appBuild != appBuild
    }

    private static func loadExistingStations(rootURL: URL) -> [Station] {
        let stationsURL = rootURL.appendingPathComponent("stations.json")
        guard
            let data = try? Data(contentsOf: stationsURL),
            let document = try? JSONDecoder().decode(
                ExistingStationsDocument.self,
                from: data
            )
        else {
            return []
        }
        return document.stations
    }

    private static func publish(
        builder: BoardBuilder,
        rootURL: URL,
        appBuild: String,
        fileManager: FileManager
    ) throws {
        let stagingURL = rootURL.appendingPathComponent(
            ".railboard-staging-\(UUID().uuidString)",
            isDirectory: true
        )
        let stagingBoardURL = stagingURL.appendingPathComponent(
            "board",
            isDirectory: true
        )

        try fileManager.createDirectory(
            at: stagingBoardURL,
            withIntermediateDirectories: true
        )
        defer {
            try? fileManager.removeItem(at: stagingURL)
        }

        let stationsData = Data(JSONOutput.stations(builder.stations).utf8)
        try stationsData.write(
            to: stagingURL.appendingPathComponent("stations.json"),
            options: .atomic
        )

        let builtAt = ISO8601DateFormatter().string(from: Date())
        let metaData = Data(
            JSONOutput.meta(
                builtAt: builtAt,
                appBuild: appBuild,
                types: builder.types,
                systems: builder.systems
            ).utf8
        )
        try metaData.write(
            to: stagingURL.appendingPathComponent("meta.json"),
            options: .atomic
        )

        for index in builder.stations.indices {
            let station = builder.stations[index]
            let board = builder.boards[index]
                ?? MutableBoard(stationIndex: index, systemID: station.s)
            let data = Data(JSONOutput.board(board).utf8)
            try data.write(
                to: stagingBoardURL.appendingPathComponent("\(index).json"),
                options: .atomic
            )
        }

        let boardURL = rootURL.appendingPathComponent("board", isDirectory: true)
        try fileManager.createDirectory(
            at: boardURL,
            withIntermediateDirectories: true
        )

        // 每一站都是獨立原子替換；既有站索引永不改指向，因此發布途中讀到的
        // 新舊 board 都仍對應同一站。meta 最後替換，作為整批完成的發布標記。
        for index in builder.stations.indices {
            try atomicallyInstall(
                stagedURL: stagingBoardURL.appendingPathComponent("\(index).json"),
                destinationURL: boardURL.appendingPathComponent("\(index).json"),
                fileManager: fileManager
            )
        }
        try atomicallyInstall(
            stagedURL: stagingURL.appendingPathComponent("stations.json"),
            destinationURL: rootURL.appendingPathComponent("stations.json"),
            fileManager: fileManager
        )
        try atomicallyInstall(
            stagedURL: stagingURL.appendingPathComponent("meta.json"),
            destinationURL: rootURL.appendingPathComponent("meta.json"),
            fileManager: fileManager
        )
    }

    private static func atomicallyInstall(
        stagedURL: URL,
        destinationURL: URL,
        fileManager: FileManager
    ) throws {
        if fileManager.fileExists(atPath: destinationURL.path) {
            _ = try fileManager.replaceItemAt(
                destinationURL,
                withItemAt: stagedURL,
                backupItemName: nil,
                options: .usingNewMetadataOnly
            )
        } else {
            try fileManager.moveItem(at: stagedURL, to: destinationURL)
        }
    }
}

private extension RailBoardScheduleWriter {
    final class BackgroundTask {
        private weak var application: UIApplication?
        private var identifier = UIBackgroundTaskIdentifier.invalid

        init(application: UIApplication) {
            self.application = application
            identifier = application.beginBackgroundTask(
                withName: "Build RailBoard schedules"
            ) { [weak self] in
                self?.finish()
            }
        }

        func finish() {
            guard
                let application,
                identifier != .invalid
            else {
                return
            }
            application.endBackgroundTask(identifier)
            identifier = .invalid
        }
    }

    struct SystemInput {
        let id: String
        let label: String
        let resource: String
        let live: Bool
    }

    struct ScheduleDocument: Decodable {
        let types: [ScheduleType]
        let trains: [ScheduleTrain]
        let dates: [String: [Int]]?
    }

    struct ScheduleType: Decodable {
        let key: String
        let color: String
    }

    struct ScheduleTrain: Decodable {
        let train: String
        let typeName: String
        let stops: [ScheduleStop]
    }

    struct ScheduleStop: Decodable {
        let name: String
        let arrSec: Int
        let depSec: Int
        let stop: Bool
    }

    struct ExistingMeta: Decodable {
        let appBuild: String
    }

    struct ExistingStationsDocument: Decodable {
        let stations: [Station]
    }

    struct Station: Decodable, Hashable {
        let n: String
        let s: String
    }

    struct SystemMeta {
        let id: String
        let label: String
        let from: String?
        let days: Int
        let live: Bool
    }

    struct TypeColor {
        let key: String
        var color: String
    }

    struct Departure {
        let no: String
        let ty: String
        let dep: Int
        let days: Int
        let to: [(Int, Int)]
        let sourceOrder: Int
    }

    struct Arrival {
        let no: String
        let ty: String
        let arr: Int
        let days: Int
        let fr: Int
        let sourceOrder: Int
    }

    struct Pass {
        let no: String
        let ty: String
        let at: Int
        let days: Int
        let fr: Int
        let en: Int
        let sourceOrder: Int
    }

    final class MutableBoard {
        let stationIndex: Int
        let systemID: String
        var departures: [Departure] = []
        var arrivals: [Arrival] = []
        var passes: [Pass] = []

        init(stationIndex: Int, systemID: String) {
            self.stationIndex = stationIndex
            self.systemID = systemID
        }
    }

    struct BoardBuilder {
        private(set) var stations: [Station]
        private(set) var boards: [Int: MutableBoard] = [:]
        private(set) var types: [TypeColor] = []
        private(set) var systems: [SystemMeta] = []

        private var stationIndices: [Station: Int]
        private var typeIndices: [String: Int] = [:]
        private var sourceOrder = 0

        init(existingStations: [Station]) {
            stations = existingStations
            stationIndices = [:]
            for (index, station) in existingStations.enumerated()
                where stationIndices[station] == nil
            {
                stationIndices[station] = index
            }
        }

        mutating func add(system: SystemInput, document: ScheduleDocument) {
            for type in document.types {
                if let index = typeIndices[type.key] {
                    types[index].color = type.color
                } else {
                    typeIndices[type.key] = types.count
                    types.append(TypeColor(key: type.key, color: type.color))
                }
            }

            let dayKeys = document.dates?.keys.sorted() ?? []
            var maskByTrain: [Int: Int] = [:]
            for (dayIndex, day) in dayKeys.enumerated() {
                for trainIndex in document.dates?[day] ?? [] {
                    maskByTrain[trainIndex, default: 0] |= 1 << dayIndex
                }
            }

            systems.append(
                SystemMeta(
                    id: system.id,
                    label: system.label,
                    from: dayKeys.first,
                    days: dayKeys.count,
                    live: system.live
                )
            )

            // 先完整走過所有 stop 建站索引，順序才會與 JS 參考實作一致。
            for train in document.trains {
                for stop in train.stops {
                    _ = stationIndex(systemID: system.id, name: stop.name)
                }
            }

            let fullMask = (1 << 14) - 1
            for (trainIndex, train) in document.trains.enumerated() {
                let days = dayKeys.isEmpty
                    ? fullMask
                    : maskByTrain[trainIndex, default: 0]
                guard days != 0 else {
                    continue
                }

                let calls = train.stops.filter(\.stop)
                guard calls.count >= 2 else {
                    continue
                }

                let originIndex = stationIndex(
                    systemID: system.id,
                    name: calls[0].name
                )
                let finalIndex = stationIndex(
                    systemID: system.id,
                    name: calls[calls.count - 1].name
                )

                for (stopIndex, stop) in train.stops.enumerated() {
                    let index = stationIndex(
                        systemID: system.id,
                        name: stop.name
                    )
                    let board = boardAt(index: index, systemID: system.id)
                    let order = nextSourceOrder()

                    if !stop.stop {
                        board.passes.append(
                            Pass(
                                no: train.train,
                                ty: train.typeName,
                                at: stop.arrSec,
                                days: days,
                                fr: originIndex,
                                en: finalIndex,
                                sourceOrder: order
                            )
                        )
                        continue
                    }

                    let downstream = train.stops[(stopIndex + 1)...].filter(\.stop)
                    if downstream.isEmpty {
                        board.arrivals.append(
                            Arrival(
                                no: train.train,
                                ty: train.typeName,
                                arr: stop.arrSec,
                                days: days,
                                fr: originIndex,
                                sourceOrder: order
                            )
                        )
                    } else {
                        board.departures.append(
                            Departure(
                                no: train.train,
                                ty: train.typeName,
                                dep: stop.depSec,
                                days: days,
                                to: downstream.map {
                                    (
                                        stationIndex(
                                            systemID: system.id,
                                            name: $0.name
                                        ),
                                        $0.arrSec
                                    )
                                },
                                sourceOrder: order
                            )
                        )
                    }
                }
            }
        }

        private mutating func stationIndex(systemID: String, name: String) -> Int {
            let station = Station(n: name, s: systemID)
            if let index = stationIndices[station] {
                return index
            }

            let index = stations.count
            stations.append(station)
            stationIndices[station] = index
            return index
        }

        private mutating func boardAt(
            index: Int,
            systemID: String
        ) -> MutableBoard {
            if let board = boards[index] {
                return board
            }
            let board = MutableBoard(
                stationIndex: index,
                systemID: systemID
            )
            boards[index] = board
            return board
        }

        private mutating func nextSourceOrder() -> Int {
            defer { sourceOrder += 1 }
            return sourceOrder
        }
    }

    enum JSONOutput {
        static func stations(_ stations: [Station]) -> String {
            let records = stations.map {
                #"{"n":\#(string($0.n)),"s":\#(string($0.s))}"#
            }.joined(separator: ",")
            return #"{"v":1,"stations":[\#(records)]}"#
        }

        static func meta(
            builtAt: String,
            appBuild: String,
            types: [TypeColor],
            systems: [SystemMeta]
        ) -> String {
            let typeValues = types.map {
                "\(string($0.key)):\(string($0.color))"
            }.joined(separator: ",")
            let systemValues = systems.map {
                let from = $0.from.map(string) ?? "null"
                return """
                {"id":\(string($0.id)),"label":\(string($0.label)),"from":\(from),"days":\($0.days),"live":\($0.live)}
                """
            }.joined(separator: ",")

            return """
            {"v":1,"builtAt":\(string(builtAt)),"appBuild":\(string(appBuild)),"types":{\(typeValues)},"systems":[\(systemValues)]}
            """
        }

        static func board(_ board: MutableBoard) -> String {
            let departures = board.departures.sorted {
                ($0.dep, $0.sourceOrder) < ($1.dep, $1.sourceOrder)
            }.map { departure in
                let destinations = departure.to.map {
                    "[\($0.0),\($0.1)]"
                }.joined(separator: ",")
                return """
                {"no":\(string(departure.no)),"ty":\(string(departure.ty)),"dep":\(departure.dep),"days":\(departure.days),"to":[\(destinations)]}
                """
            }.joined(separator: ",")

            let arrivals = board.arrivals.sorted {
                ($0.arr, $0.sourceOrder) < ($1.arr, $1.sourceOrder)
            }.map { arrival in
                """
                {"no":\(string(arrival.no)),"ty":\(string(arrival.ty)),"arr":\(arrival.arr),"days":\(arrival.days),"fr":\(arrival.fr)}
                """
            }.joined(separator: ",")

            let passes = board.passes.sorted {
                ($0.at, $0.sourceOrder) < ($1.at, $1.sourceOrder)
            }.map { pass in
                """
                {"no":\(string(pass.no)),"ty":\(string(pass.ty)),"at":\(pass.at),"days":\(pass.days),"fr":\(pass.fr),"en":\(pass.en)}
                """
            }.joined(separator: ",")

            return """
            {"v":1,"st":\(board.stationIndex),"sys":\(string(board.systemID)),"deps":[\(departures)],"arrs":[\(arrivals)],"pass":[\(passes)]}
            """
        }

        private static func string(_ value: String) -> String {
            var result = "\""
            result.reserveCapacity(value.utf8.count + 2)

            for scalar in value.unicodeScalars {
                switch scalar.value {
                case 0x08:
                    result += "\\b"
                case 0x09:
                    result += "\\t"
                case 0x0A:
                    result += "\\n"
                case 0x0C:
                    result += "\\f"
                case 0x0D:
                    result += "\\r"
                case 0x22:
                    result += "\\\""
                case 0x5C:
                    result += "\\\\"
                case 0x00...0x1F:
                    result += String(format: "\\u%04x", scalar.value)
                default:
                    result.unicodeScalars.append(scalar)
                }
            }

            result += "\""
            return result
        }
    }
}
