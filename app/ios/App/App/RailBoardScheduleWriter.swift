import CryptoKit
import Foundation
#if canImport(UIKit)
import UIKit
import WidgetKit
#endif

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

    #if canImport(UIKit)
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
    #endif

    private static func refreshIfNeeded() -> RefreshResult {
        let fileManager = FileManager.default
        guard
            let rootURL = fileManager.containerURL(
                forSecurityApplicationGroupIdentifier: appGroupID
            ),
            let appBuild = currentAppBuild()
        else {
            return .unchanged
        }
        let placesData = try? Data(
            contentsOf: rootURL.appendingPathComponent("places.json")
        )
        let placesFingerprint = fingerprint(placesData)
        guard shouldRebuild(
            rootURL: rootURL,
            appBuild: appBuild,
            placesFingerprint: placesFingerprint
        ) else {
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
            let placeBoards = loadPlaceBoards(placesData: placesData)
            let composites = CompositeStationFinder.find(
                coordinates: builder.coordinates,
                systemOrder: systemInputs.map(\.id),
                systemLabels: Dictionary(
                    uniqueKeysWithValues: systemInputs.map { ($0.id, $0.label) }
                )
            )
            let compositeBoards = buildPlaceBoards(
                places: composites.map(\.place)
            )
            try publish(
                builder: builder,
                placeBoards: placeBoards,
                compositeBoards: compositeBoards,
                compositeRecords: zip(composites, compositeBoards).map {
                    CompositeStationRecord(
                        i: $0.1.i,
                        label: $0.0.place.label,
                        subtitle: $0.0.subtitle,
                        lat: $0.0.place.lat,
                        lon: $0.0.place.lon
                    )
                },
                rootURL: rootURL,
                appBuild: appBuild,
                placesFingerprint: placesFingerprint,
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

    private static func fingerprint(_ data: Data?) -> String {
        guard let data else { return "missing" }
        return SHA256.hash(data: data).map {
            String(format: "%02x", $0)
        }.joined()
    }

    /// 看板檔的格式版本。**動到 board／place-board／composite-board 的欄位或語意就 +1。**
    ///
    /// 為什麼需要它：重算閘門原本只比 `appBuild`（網頁 BUILD＋CFBundleVersion）與地點指紋，
    /// 而**改 Swift 邏輯不會動到這三者中的任何一個** ⇒ 重裝後閘門判「不必重算」，
    /// 磁碟上舊格式的看板檔原封不動留著，新功能在桌面上看起來像沒生效。
    /// 2026-07-31 的方向欄位（`dir`）與共站入口就差點這樣出貨——當時的解法是手動推 build 號，
    /// 但那要靠人記得。改成把版本寫在格式旁邊，改格式的那一手就會看到它。
    ///
    /// 2＝加入 `PlaceBoardPass.dir` 與 composite-board（2026-07-31）。
    private static let boardFormatVersion = 2

    private static func shouldRebuild(
        rootURL: URL,
        appBuild: String,
        placesFingerprint: String
    ) -> Bool {
        let metaURL = rootURL.appendingPathComponent("meta.json")
        guard
            let data = try? Data(contentsOf: metaURL),
            let meta = try? JSONDecoder().decode(ExistingMeta.self, from: data)
        else {
            return true
        }
        return meta.appBuild != appBuild
            || meta.boardFormat != boardFormatVersion
            || meta.placesFingerprint != placesFingerprint
    }

    /// 索引與線形對「使用者的地點」與「共站入口」是同一份，讀一次就好。
    /// 缺任何一份就回 nil，兩邊各自降級成空清單——寧可少一個入口，不要半套資料的看板。
    private static func loadPlaceIndex() -> (
        index: PlaceIndexDocument,
        trackLines: [TrackLine]
    )? {
        guard
            let indexURL = Bundle.main.url(
                forResource: "public/data/place_index.json",
                withExtension: nil
            ),
            let indexData = try? Data(contentsOf: indexURL),
            let index = try? JSONDecoder().decode(
                PlaceIndexDocument.self,
                from: indexData
            ),
            index.v == 1
        else {
            return nil
        }

        let trackResources = [
            "public/data/tra.json",
            "public/data/thsr_track.json",
        ]
        let tracks = trackResources.compactMap {
            resource -> TrackDocument? in
            guard
                let url = Bundle.main.url(
                    forResource: resource,
                    withExtension: nil
                ),
                let data = try? Data(contentsOf: url)
            else {
                return nil
            }
            return try? JSONDecoder().decode(
                TrackDocument.self,
                from: data
            )
        }
        guard tracks.count == trackResources.count else { return nil }
        return (index, tracks.flatMap(\.lines))
    }

    private static func buildPlaceBoards(
        places: [PlaceInput]
    ) -> [PlaceBoardDocument] {
        guard !places.isEmpty, let loaded = loadPlaceIndex() else { return [] }
        return PlaceBoardBuilder.build(
            places: places,
            index: loaded.index,
            trackLines: loaded.trackLines
        )
    }

    private static func loadPlaceBoards(
        placesData: Data?
    ) -> [PlaceBoardDocument] {
        guard
            let placesData,
            let places = try? JSONDecoder().decode(
                PlacesInputDocument.self,
                from: placesData
            ),
            places.v == 1
        else {
            return []
        }
        return buildPlaceBoards(places: places.places)
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
        placeBoards: [PlaceBoardDocument],
        compositeBoards: [PlaceBoardDocument],
        compositeRecords: [CompositeStationRecord],
        rootURL: URL,
        appBuild: String,
        placesFingerprint: String,
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
        let stagingPlaceBoardURL = stagingURL.appendingPathComponent(
            "place-board",
            isDirectory: true
        )
        let stagingCompositeBoardURL = stagingURL.appendingPathComponent(
            "composite-board",
            isDirectory: true
        )

        try fileManager.createDirectory(
            at: stagingBoardURL,
            withIntermediateDirectories: true
        )
        try fileManager.createDirectory(
            at: stagingPlaceBoardURL,
            withIntermediateDirectories: true
        )
        try fileManager.createDirectory(
            at: stagingCompositeBoardURL,
            withIntermediateDirectories: true
        )
        defer {
            try? fileManager.removeItem(at: stagingURL)
        }

        let stationsData = Data(
            JSONOutput.stations(
                builder.stations,
                regions: StationRegions(),
                coordinates: builder.coordinates
            ).utf8
        )
        try stationsData.write(
            to: stagingURL.appendingPathComponent("stations.json"),
            options: .atomic
        )

        let builtAt = ISO8601DateFormatter().string(from: Date())
        let metaData = Data(
            JSONOutput.meta(
                builtAt: builtAt,
                appBuild: appBuild,
                boardFormat: boardFormatVersion,
                placesFingerprint: placesFingerprint,
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
        let placeEncoder = JSONEncoder()
        placeEncoder.outputFormatting = [.sortedKeys]
        for placeBoard in placeBoards {
            try placeEncoder.encode(placeBoard).write(
                to: stagingPlaceBoardURL.appendingPathComponent(
                    "\(placeBoard.i).json"
                ),
                options: .atomic
            )
        }
        for compositeBoard in compositeBoards {
            try placeEncoder.encode(compositeBoard).write(
                to: stagingCompositeBoardURL.appendingPathComponent(
                    "\(compositeBoard.i).json"
                ),
                options: .atomic
            )
        }
        // 索引與看板檔在同一次發布裡一起產生，所以 `i` 永遠對得上；
        // 設定裡存的是 label 不是 i，站增減造成的索引位移影響不到既有設定。
        let compositesData = try placeEncoder.encode(compositeRecords)
        try compositesData.write(
            to: stagingURL.appendingPathComponent("composites.json"),
            options: .atomic
        )

        let boardURL = rootURL.appendingPathComponent("board", isDirectory: true)
        let placeBoardURL = rootURL.appendingPathComponent(
            "place-board",
            isDirectory: true
        )
        let compositeBoardURL = rootURL.appendingPathComponent(
            "composite-board",
            isDirectory: true
        )
        try fileManager.createDirectory(
            at: boardURL,
            withIntermediateDirectories: true
        )
        try fileManager.createDirectory(
            at: placeBoardURL,
            withIntermediateDirectories: true
        )
        try fileManager.createDirectory(
            at: compositeBoardURL,
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
        for placeBoard in placeBoards {
            try atomicallyInstall(
                stagedURL: stagingPlaceBoardURL.appendingPathComponent(
                    "\(placeBoard.i).json"
                ),
                destinationURL: placeBoardURL.appendingPathComponent(
                    "\(placeBoard.i).json"
                ),
                fileManager: fileManager
            )
        }
        let validPlaceBoardNames = Set(placeBoards.map { "\($0.i).json" })
        for staleURL in try fileManager.contentsOfDirectory(
            at: placeBoardURL,
            includingPropertiesForKeys: nil
        ) where staleURL.pathExtension == "json"
            && !validPlaceBoardNames.contains(staleURL.lastPathComponent)
        {
            try fileManager.removeItem(at: staleURL)
        }
        for compositeBoard in compositeBoards {
            try atomicallyInstall(
                stagedURL: stagingCompositeBoardURL.appendingPathComponent(
                    "\(compositeBoard.i).json"
                ),
                destinationURL: compositeBoardURL.appendingPathComponent(
                    "\(compositeBoard.i).json"
                ),
                fileManager: fileManager
            )
        }
        let validCompositeNames = Set(compositeBoards.map { "\($0.i).json" })
        for staleURL in try fileManager.contentsOfDirectory(
            at: compositeBoardURL,
            includingPropertiesForKeys: nil
        ) where staleURL.pathExtension == "json"
            && !validCompositeNames.contains(staleURL.lastPathComponent)
        {
            try fileManager.removeItem(at: staleURL)
        }
        // composites.json 排在看板檔之後：索引出現時，它指到的每一份看板都已經就位。
        try atomicallyInstall(
            stagedURL: stagingURL.appendingPathComponent("composites.json"),
            destinationURL: rootURL.appendingPathComponent("composites.json"),
            fileManager: fileManager
        )
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

extension RailBoardScheduleWriter {
    #if canImport(UIKit)
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
    #endif

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
        let lat: Double?
        let lon: Double?
    }

    struct ExistingMeta: Decodable {
        let appBuild: String
        let placesFingerprint: String?
        /// 舊版 App 寫的 meta 沒有這個欄位；缺值一律當作「格式不同」而重算。
        let boardFormat: Int?
    }

    struct ExistingStationsDocument: Decodable {
        let stations: [Station]
    }

    struct Station: Decodable, Hashable {
        let n: String
        let s: String
    }

    struct PlacesInputDocument: Decodable {
        let v: Int
        let places: [PlaceInput]
    }

    struct PlaceInput: Decodable {
        let label: String
        let lat: Double
        let lon: Double
        let manual: Bool
    }

    struct PlaceIndexDocument: Decodable {
        let v: Int
        let samples: Int
        let lines: [String: PlaceIndexLine]
        let segs: [PlaceIndexSegment]
        let trains: [PlaceIndexTrain]
    }

    struct PlaceIndexLine: Decodable {
        let sys: String
        let name: String
        let color: String
        let order: Int
    }

    struct PlaceIndexTrain: Decodable {
        let no: String
        let ty: String
        let days: Int
        let sys: String
        let to: String
    }

    struct PlaceIndexSegment: Decodable {
        let trainIndex: Int
        let lineID: String
        let dAMeters: Int
        let dBMeters: Int
        let positions: [Int]
        let times: [Int]

        init(from decoder: Decoder) throws {
            var values = try decoder.unkeyedContainer()
            trainIndex = try values.decode(Int.self)
            lineID = try values.decode(String.self)
            dAMeters = try values.decode(Int.self)
            dBMeters = try values.decode(Int.self)
            positions = try values.decode([Int].self)
            times = try values.decode([Int].self)
        }
    }

    struct TrackDocument: Decodable {
        let lines: [TrackLine]
    }

    struct TrackLine: Decodable {
        let id: String
        let name: String
        let color: String
        let shape: [[Double]]
    }

    struct PlaceBoardDocument: Encodable {
        let v: Int
        let i: Int
        let label: String
        let lat: Double
        let lon: Double
        let lines: [PlaceBoardLine]
    }

    struct PlaceBoardLine: Encodable {
        let id: String
        let sys: String
        let name: String
        let color: String
        let d: Int
        let perp: Int
        let pass: [PlaceBoardPass]
    }

    struct PlaceBoardPass: Encodable {
        let no: String
        let ty: String
        let to: String
        let at: Int
        let days: Int
        let sys: String
        /// 行進方向：1＝里程遞增、0＝里程遞減。
        ///
        /// 為什麼不用終點站名判方向：高鐵往台中的車兩個方向都有（順里程 36 段、逆里程 5 段），
        /// 台鐵更明顯——同一個方向的終點站散在樹林／新竹／潮州／彰化。里程增減是段自帶的事實，
        /// 不受終點站怎麼命名影響，而且支線（平溪、集集）也一樣適用，不必假設「南下＝里程遞增」。
        let dir: Int
    }

    /// 共站（台鐵與高鐵同一個地方）的一筆。
    struct CompositeStationRecord: Encodable {
        let i: Int
        let label: String
        let subtitle: String
        let lat: Double
        let lon: Double
    }

    /// 找出「不同系統但實際上在同一個地方」的車站，做成一筆合併入口。
    ///
    /// 為什麼用座標而不是站名：12 個高鐵站有 8 個與台鐵共站，其中 5 個**名字不一樣**
    /// （高鐵新竹在台鐵六家、高鐵苗栗在豐富、高鐵台中在新烏日、高鐵台南在沙崙、
    /// 高鐵左營在新左營），剩下 3 個裡台北還要處理臺／台 的寫法差異。靠站名比對會漏掉一半。
    ///
    /// 800 公尺這個門檻不是猜的：實測 8 個共站的距離是 24–346 公尺，
    /// 而最近的**非**共站是高鐵彰化到社頭 2451 公尺——中間隔了七倍，門檻放哪都一樣。
    enum CompositeStationFinder {
        static let maximumSeparationMeters = 800.0

        /// 只為了比對站名是否等價；顯示一律用原本的寫法。
        private static func normalized(_ name: String) -> String {
            name.replacingOccurrences(of: "臺", with: "台")
        }

        static func find(
            coordinates: [Station: (lat: Double, lon: Double)],
            systemOrder: [String],
            systemLabels: [String: String]
        ) -> [(place: PlaceInput, subtitle: String)] {
            let entries = coordinates.map {
                (station: $0.key, lat: $0.value.lat, lon: $0.value.lon)
            }.sorted {
                let leftRank = systemOrder.firstIndex(of: $0.station.s) ?? .max
                let rightRank = systemOrder.firstIndex(of: $1.station.s) ?? .max
                if leftRank != rightRank { return leftRank < rightRank }
                return $0.station.n < $1.station.n
            }

            // 只合併「不同系統」的站：同系統相鄰站再近也是兩站（例如台鐵的臺北與華山側線）。
            var parent = Array(entries.indices)
            func root(_ index: Int) -> Int {
                var current = index
                while parent[current] != current { current = parent[current] }
                return current
            }
            for i in entries.indices {
                for j in entries.indices where j > i {
                    guard entries[i].station.s != entries[j].station.s else {
                        continue
                    }
                    let separation = metersBetween(
                        lat1: entries[i].lat, lon1: entries[i].lon,
                        lat2: entries[j].lat, lon2: entries[j].lon
                    )
                    guard separation <= maximumSeparationMeters else { continue }
                    let a = root(i)
                    let b = root(j)
                    if a != b { parent[max(a, b)] = min(a, b) }
                }
            }

            var groups: [Int: [Int]] = [:]
            for index in entries.indices {
                groups[root(index), default: []].append(index)
            }

            return groups.keys.sorted().compactMap { key -> (PlaceInput, String)? in
                guard let members = groups[key] else { return nil }
                let systems = Set(members.map { entries[$0].station.s })
                guard systems.count > 1 else { return nil }

                // 🔴 一個群組可能含同系統的兩站：高鐵台中距台鐵新烏日 346 公尺、距台鐵烏日
                // 也在 800 公尺內，於是「新烏日 — 高鐵台中 — 烏日」被連成一串。直接把全部成員
                // 列出來會得到「新烏日・烏日・台中」與副標「台鐵・台鐵・高鐵 共站」。
                // 所以每個系統只留一個代表：與「其他系統成員」總距離最短的那一個
                // （台中這組＝新烏日，它比烏日更貼著高鐵站）。
                let representatives = systems.sorted {
                    let leftRank = systemOrder.firstIndex(of: $0) ?? .max
                    let rightRank = systemOrder.firstIndex(of: $1) ?? .max
                    if leftRank != rightRank { return leftRank < rightRank }
                    return $0 < $1
                }.compactMap { system -> Int? in
                    members.filter { entries[$0].station.s == system }.min {
                        distanceToOtherSystems($0, members: members, entries: entries)
                            < distanceToOtherSystems($1, members: members, entries: entries)
                    }
                }
                guard representatives.count == systems.count else { return nil }

                // 名字寫法相同（台北／臺北）就只顯示第一個系統的寫法，不同才並列。
                let names = representatives.map { entries[$0].station.n }
                let label = Set(names.map(normalized)).count == 1
                    ? names[0]
                    : names.joined(separator: "・")
                let subtitle = representatives
                    .map { systemLabels[entries[$0].station.s] ?? entries[$0].station.s }
                    .joined(separator: "・") + " 共站"

                // 座標取代表的平均，不是全部成員的平均：後者會被「剛好也在附近的同系統鄰站」
                // 把落點往旁邊拉（台中那組會被烏日拉走），代表平均才落在兩個系統之間。
                let lat = representatives.reduce(0.0) { $0 + entries[$1].lat }
                    / Double(representatives.count)
                let lon = representatives.reduce(0.0) { $0 + entries[$1].lon }
                    / Double(representatives.count)
                // manual 只影響「我的地點」在選單裡的排序，共站不走那條路徑、值不被讀。
                return (
                    PlaceInput(label: label, lat: lat, lon: lon, manual: false),
                    subtitle
                )
            }
        }

        /// 這一站到「群組裡其他系統的站」的總距離。用來在同系統有多站時挑代表。
        private static func distanceToOtherSystems(
            _ index: Int,
            members: [Int],
            entries: [(station: Station, lat: Double, lon: Double)]
        ) -> Double {
            members.filter { entries[$0].station.s != entries[index].station.s }
                .reduce(0.0) { total, other in
                    total + metersBetween(
                        lat1: entries[index].lat, lon1: entries[index].lon,
                        lat2: entries[other].lat, lon2: entries[other].lon
                    )
                }
        }

        private static func metersBetween(
            lat1: Double, lon1: Double,
            lat2: Double, lon2: Double
        ) -> Double {
            // 800 公尺尺度的等距近似；緯度取中點，台灣的經度收縮率誤差可忽略。
            let meanLatitude = (lat1 + lat2) / 2 * .pi / 180
            let dy = (lat2 - lat1) * 110_574
            let dx = (lon2 - lon1) * 111_320 * cos(meanLatitude)
            return (dx * dx + dy * dy).squareRoot()
        }
    }

    enum PlaceBoardBuilder {
        private static let maximumPerpendicularKilometers = 1.5
        private static let maximumLines = 3

        static func build(
            places: [PlaceInput],
            index: PlaceIndexDocument,
            trackLines: [TrackLine]
        ) -> [PlaceBoardDocument] {
            let segmentsByLine = Dictionary(
                grouping: index.segs,
                by: \.lineID
            )

            return places.enumerated().map { placeIndex, place in
                let nearby = trackLines.compactMap {
                    line -> (line: TrackLine, projection: Projection)? in
                    guard
                        let projection = project(
                            line: line,
                            lat: place.lat,
                            lon: place.lon
                        ),
                        projection.perpKilometers
                            <= maximumPerpendicularKilometers
                    else {
                        return nil
                    }
                    return (line, projection)
                }.sorted {
                    if $0.projection.perpKilometers
                        != $1.projection.perpKilometers
                    {
                    return $0.projection.perpKilometers
                            < $1.projection.perpKilometers
                    }
                    let leftOrder = index.lines[$0.line.id]?.order
                        ?? Int.max
                    let rightOrder = index.lines[$1.line.id]?.order
                        ?? Int.max
                    if leftOrder != rightOrder {
                        return leftOrder < rightOrder
                    }
                    return $0.line.id < $1.line.id
                }.prefix(maximumLines)

                let placeLines = nearby.compactMap {
                    candidate -> PlaceBoardLine? in
                    guard let lineMeta = index.lines[candidate.line.id] else {
                        return nil
                    }
                    // 同一班車只留一筆。地點的里程若落在車站附近,「進站段」與「出站段」
                    // 會同時包含它(下面刻意留的 ±1m 容差更保證了這件事),不去重的話同一班車
                    // 會在看板佔掉兩列——實測竹北座標的前三筆是 1112／1112／1122,medium 每線
                    // 只放 3 列,等於一半版面被同一班車吃掉。
                    // JS 的 crossingPasses 用 byTrain Map 每班車只留最近的一次命中
                    // (index.html:5771-5773),這裡做同一件事。
                    // 鍵用 trainIndex 而不是車次號:台鐵 dense 裡有 5 個車次號各有 2–3 筆
                    // 不同行駛日的變體,用號碼當鍵會把它們錯併成一班。
                    // 取較早那筆即等價於 JS 的「delta 最小」——跨午夜以秒數累加表示
                    // (實測最大 114720 秒),不會回繞成小數字,所以直接比大小是安全的。
                    var earliestByTrain: [Int: PlaceBoardPass] = [:]
                    for segment in segmentsByLine[candidate.line.id] ?? [] {
                        let low = min(
                            segment.dAMeters,
                            segment.dBMeters
                        )
                        let high = max(
                            segment.dAMeters,
                            segment.dBMeters
                        )
                        let distance = candidate.projection.dMeters
                        // 索引端點為整數公尺、投影仍保留浮點；站點邊界若不留量化容差，
                        // 同一里程的到達／發車兩段會因 ±0.5m 被靜默漏掉其中一段。
                        guard
                            distance >= Double(low) - 1,
                            distance <= Double(high) + 1,
                            index.trains.indices.contains(segment.trainIndex),
                            let at = interpolate(
                                segment: segment,
                                distanceMeters: distance
                            )
                        else {
                            continue
                        }
                        if let existing = earliestByTrain[segment.trainIndex],
                           existing.at <= at {
                            continue
                        }
                        let train = index.trains[segment.trainIndex]
                        earliestByTrain[segment.trainIndex] = PlaceBoardPass(
                            no: train.no,
                            ty: train.ty,
                            to: train.to,
                            at: at,
                            days: train.days,
                            sys: train.sys,
                            dir: segment.dBMeters > segment.dAMeters ? 1 : 0
                        )
                    }

                    var passes = Array(earliestByTrain.values)
                    passes.sort {
                        if $0.at != $1.at { return $0.at < $1.at }
                        if $0.sys != $1.sys { return $0.sys < $1.sys }
                        return $0.no.localizedStandardCompare($1.no)
                            == .orderedAscending
                    }
                    return PlaceBoardLine(
                        id: candidate.line.id,
                        sys: lineMeta.sys,
                        name: lineMeta.name,
                        color: lineMeta.color,
                        d: Int(candidate.projection.dMeters.rounded()),
                        perp: Int(
                            (
                                candidate.projection.perpKilometers
                                    * 1_000
                            ).rounded()
                        ),
                        pass: passes
                    )
                }

                return PlaceBoardDocument(
                    v: 1,
                    i: placeIndex,
                    label: place.label,
                    lat: place.lat,
                    lon: place.lon,
                    lines: placeLines
                )
            }
        }

        private static func interpolate(
            segment: PlaceIndexSegment,
            distanceMeters: Double
        ) -> Int? {
            let span = Double(
                abs(segment.dBMeters - segment.dAMeters)
            )
            guard
                span > 0,
                segment.positions.count >= 2,
                segment.positions.count == segment.times.count
            else {
                return nil
            }
            let fraction = min(
                1,
                max(
                    0,
                    abs(
                        distanceMeters - Double(segment.dAMeters)
                    ) / span
                )
            )
            let position = fraction * 1_000_000
            var lowIndex = 0
            var highIndex = segment.positions.count - 1
            while lowIndex + 1 < highIndex {
                let middle = (lowIndex + highIndex) / 2
                if Double(segment.positions[middle]) <= position {
                    lowIndex = middle
                } else {
                    highIndex = middle
                }
            }
            lowIndex = min(lowIndex, segment.times.count - 2)
            let lowPosition = Double(segment.positions[lowIndex])
            let highPosition = Double(segment.positions[lowIndex + 1])
            let localFraction = highPosition > lowPosition
                ? min(
                    1,
                    max(
                        0,
                        (position - lowPosition)
                            / (highPosition - lowPosition)
                    )
                )
                : 0
            let low = Double(segment.times[lowIndex])
            let high = Double(segment.times[lowIndex + 1])
            return Int(
                (low + (high - low) * localFraction).rounded()
            )
        }

        struct Projection {
            let dMeters: Double
            let perpKilometers: Double
        }

        static func project(
            line: TrackLine,
            lat: Double,
            lon: Double,
            useSegmentMidpointLatitude: Bool = false
        ) -> Projection? {
            guard line.shape.count >= 2 else { return nil }
            let cumulative = cumulativeKilometers(line.shape)
            let ky = 111.32
            var bestDistance: Double?
            var bestPerpendicular = Double.greatestFiniteMagnitude

            for index in 0 ..< line.shape.count - 1 {
                let first = line.shape[index]
                let second = line.shape[index + 1]
                guard first.count >= 2, second.count >= 2 else {
                    continue
                }
                let projectionLatitude = useSegmentMidpointLatitude
                    ? (first[0] + second[0]) / 2
                    : lat
                let kx = cos(
                    projectionLatitude * Double.pi / 180
                ) * 111.32
                let ax = (first[1] - lon) * kx
                let ay = (first[0] - lat) * ky
                let bx = (second[1] - lon) * kx
                let by = (second[0] - lat) * ky
                let vx = bx - ax
                let vy = by - ay
                let lengthSquared = vx * vx + vy * vy
                let fraction: Double
                if lengthSquared > 0 {
                    fraction = max(
                        0,
                        min(
                            1,
                            -(ax * vx + ay * vy) / lengthSquared
                        )
                    )
                } else {
                    fraction = 0
                }
                let px = ax + vx * fraction
                let py = ay + vy * fraction
                let perpendicular = hypot(px, py)
                if perpendicular < bestPerpendicular {
                    bestPerpendicular = perpendicular
                    bestDistance = (
                        cumulative[index]
                            + sqrt(lengthSquared) * fraction
                    ) * 1_000
                }
            }
            guard let bestDistance else { return nil }
            return Projection(
                dMeters: bestDistance,
                perpKilometers: bestPerpendicular
            )
        }

        private static func cumulativeKilometers(
            _ shape: [[Double]]
        ) -> [Double] {
            var result = Array(
                repeating: 0.0,
                count: shape.count
            )
            guard shape.count >= 2 else { return result }
            for index in 1 ..< shape.count {
                let first = shape[index - 1]
                let second = shape[index]
                guard first.count >= 2, second.count >= 2 else {
                    result[index] = result[index - 1]
                    continue
                }
                result[index] = result[index - 1] + haversineKilometers(
                    lat1: first[0],
                    lon1: first[1],
                    lat2: second[0],
                    lon2: second[1]
                )
            }
            return result
        }

        private static func haversineKilometers(
            lat1: Double,
            lon1: Double,
            lat2: Double,
            lon2: Double
        ) -> Double {
            let radians = Double.pi / 180
            let deltaLat = (lat2 - lat1) * radians
            let deltaLon = (lon2 - lon1) * radians
            let firstLat = lat1 * radians
            let secondLat = lat2 * radians
            let value = sin(deltaLat / 2) * sin(deltaLat / 2)
                + cos(firstLat) * cos(secondLat)
                * sin(deltaLon / 2) * sin(deltaLon / 2)
            return 2 * 6_371 * asin(sqrt(value))
        }
    }

    /// 車站 → 縣市，只給小工具設定畫面的「區域」用（245 站一路下拉找太慢）。
    /// 縣市刻意不進 `Station`：那個型別是車站索引的身分鍵（index 穩定性靠它比對），
    /// 多一個欄位就會讓舊 stations.json 的既有記錄比對不上、索引整批位移。改在輸出時查表附加。
    struct StationRegions {
        /// 正規化站名 → 縣市。台鐵讀 bundle 內 tra_station_info.json 的 address 前綴。
        private var byName: [String: String] = [:]

        /// 高鐵 12 站不在台鐵那份資料裡，且與同名台鐵站不一定同縣市（高鐵新竹在新竹縣竹北、
        /// 台鐵新竹在新竹市），所以不可用站名回退查台鐵表——這裡寫死，站名本身不隨改點變動。
        private static let thsr: [String: String] = [
            "南港": "臺北市", "台北": "臺北市", "板橋": "新北市", "桃園": "桃園市",
            "新竹": "新竹縣", "苗栗": "苗栗縣", "台中": "臺中市", "彰化": "彰化縣",
            "雲林": "雲林縣", "嘉義": "嘉義縣", "台南": "臺南市", "左營": "高雄市",
        ]

        private struct StationInfo: Decodable {
            let address: String
        }

        init(bundle: Bundle = .main) {
            guard
                let url = bundle.url(
                    forResource: "public/data/tra_station_info.json",
                    withExtension: nil
                ),
                let data = try? Data(contentsOf: url),
                let raw = try? JSONDecoder().decode([String: StationInfo].self, from: data)
            else {
                return // 讀不到就一律回 nil：設定畫面自動退回原本的「依系統分組」，不是壞掉
            }
            for (name, info) in raw {
                guard let region = Self.region(fromAddress: info.address) else { continue }
                byName[Self.normalize(name)] = region
            }
        }

        func region(systemID: String, name: String) -> String? {
            let key = Self.normalize(name)
            if systemID == "thsr" { return Self.thsr[key] }
            if let hit = byName[key] { return hit }
            // 班表用「左營(舊城)」「新城 (太魯閣)」這種帶括號別名，車站資料只收本名 → 去掉括號段再查一次
            let base = Self.stripParenthetical(key)
            return base == key ? nil : byName[base]
        }

        /// 「203001基隆市中山區中山一路 16 之 1 號」→「基隆市」。台灣的縣市名一律三個字。
        static func region(fromAddress address: String) -> String? {
            let body = address.drop(while: \.isNumber)
            guard body.count >= 3 else { return nil }
            let region = String(body.prefix(3))
            guard region.hasSuffix("縣") || region.hasSuffix("市") else { return nil }
            return region
        }

        /// 班表與車站資料的臺／台混用（臺北 vs 台北）、且別名帶半形/全形空白：查表前一律折平。
        static func normalize(_ name: String) -> String {
            name.replacingOccurrences(of: "臺", with: "台")
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "　", with: "")
        }

        static func stripParenthetical(_ name: String) -> String {
            guard let index = name.firstIndex(where: { $0 == "(" || $0 == "（" }) else { return name }
            return String(name[name.startIndex ..< index])
        }
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
        /// 座標是輸出附加資料，不可進 `Station` 身分鍵；同站只採班表第一次提供的座標。
        private(set) var coordinates: [Station: (lat: Double, lon: Double)] = [:]

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
                    rememberCoordinate(systemID: system.id, stop: stop)
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

        private mutating func rememberCoordinate(systemID: String, stop: ScheduleStop) {
            let station = Station(n: stop.name, s: systemID)
            guard coordinates[station] == nil,
                  let lat = stop.lat,
                  let lon = stop.lon else { return }
            coordinates[station] = (lat: lat, lon: lon)
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
        /// v2 起多了 `c`；v3 起多了 `la`／`lo`。附加欄位查不到就整個不寫，
        /// 小工具端皆以 optional 解碼，舊 App 寫的檔案照樣讀得動。
        static func stations(
            _ stations: [Station],
            regions: StationRegions,
            coordinates: [Station: (lat: Double, lon: Double)]
        ) -> String {
            let records = stations.map { station -> String in
                let region = regions.region(systemID: station.s, name: station.n)
                let regionField = region.map { #","c":\#(string($0))"# } ?? ""
                let coordinate = coordinates[station]
                let coordinateFields = coordinate.map { #","la":\#($0.lat),"lo":\#($0.lon)"# } ?? ""
                return #"{"n":\#(string(station.n)),"s":\#(string(station.s))\#(regionField)\#(coordinateFields)}"#
            }.joined(separator: ",")
            return #"{"v":3,"stations":[\#(records)]}"#
        }

        static func meta(
            builtAt: String,
            appBuild: String,
            boardFormat: Int,
            placesFingerprint: String,
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
            {"v":1,"builtAt":\(string(builtAt)),"appBuild":\(string(appBuild)),"boardFormat":\(boardFormat),"placesFingerprint":\(string(placesFingerprint)),"types":{\(typeValues)},"systems":[\(systemValues)]}
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
