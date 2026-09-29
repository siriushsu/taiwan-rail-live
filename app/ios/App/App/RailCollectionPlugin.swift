import Capacitor
import Foundation
import WidgetKit

/// 「車站收集」小工具的資料通道：網頁 JS 算好一包 JSON 字串（資料格式 v1，
/// 見 docs/superpowers/plans/2026-09-29-車站收集小工具.md），這裡驗過就原樣寫進
/// App Group 容器根目錄的 `collection.json`，再通知 CollectionWidget 重畫。
///
/// 只做「驗形狀＋原子寫入」，不解碼內容：小工具端自己解碼，格式演進不用動這裡。
/// 刻意不碰 places.json／board 檔／boardFormatVersion，也不呼叫 RailBoardScheduleWriter
/// （收集資料與發車看板無關，不該觸發整包看板重建）。
@objc(RailCollectionPlugin)
public final class RailCollectionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailCollectionPlugin"
    public let jsName = "RailCollection"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
    ]

    private static let appGroupID = "group.tw.railisland.app"
    private static let fileName = "collection.json"
    private static let widgetKind = "CollectionWidget"
    /// 538 座站的 payload 約 20 KB；512 KB 是「明顯不對勁」的保險絲，不是預期值。
    private static let maxBytes = 512 * 1024
    private static let supportedVersion = 1

    private let workQueue = DispatchQueue(
        label: "tw.railisland.app.collection-writer",
        qos: .utility
    )

    @objc public func sync(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json string")
            return
        }
        let data = Data(json.utf8)
        if data.isEmpty {
            call.reject("Empty json")
            return
        }
        if data.count > Self.maxBytes {
            call.reject("Payload too large (\(data.count) bytes, limit \(Self.maxBytes))")
            return
        }
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any]
        else {
            call.reject("Payload is not a JSON object")
            return
        }
        // JSONSerialization 把數字都轉成 NSNumber；true 也是 NSNumber，要排除才不會把 v:true 當 1。
        guard
            let version = dictionary["v"] as? NSNumber,
            CFGetTypeID(version) != CFBooleanGetTypeID(),
            version.intValue == Self.supportedVersion,
            version.doubleValue == Double(Self.supportedVersion)
        else {
            call.reject("Unsupported payload version (expected v == \(Self.supportedVersion))")
            return
        }

        workQueue.async {
            guard let rootURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: Self.appGroupID
            ) else {
                call.reject("App Group container unavailable")
                return
            }

            do {
                try data.write(
                    to: rootURL.appendingPathComponent(Self.fileName),
                    options: .atomic
                )
            } catch {
                call.reject("Unable to persist collection")
                return
            }
            WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
            call.resolve()
        }
    }
}
