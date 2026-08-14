import Capacitor
import Foundation
import UIKit
import WidgetKit

@objc(RailBridgeViewController)
public final class RailBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RailPlacesPlugin())
        bridge?.registerPluginInstance(RailLiveActivityPlugin())
        bridge?.registerPluginInstance(RailMetroWaitPlugin())
    }
}

@objc(RailPlacesPlugin)
public final class RailPlacesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailPlacesPlugin"
    public let jsName = "RailPlaces"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
    ]

    private static let appGroupID = "group.tw.railisland.app"
    private static let taiwanLatitude = 21.88 ... 25.35
    private static let taiwanLongitude = 119.9 ... 122.05
    private let workQueue = DispatchQueue(
        label: "tw.railisland.app.places-writer",
        qos: .utility
    )

    private struct Place: Encodable {
        let label: String
        let lat: Double
        let lon: Double
        let manual: Bool
    }

    private struct PlacesDocument: Encodable {
        let v: Int
        let places: [Place]
    }

    @objc public func sync(_ call: CAPPluginCall) {
        let places = (call.getArray("places") ?? []).compactMap(Self.validatedPlace)

        workQueue.async {
            guard let rootURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: Self.appGroupID
            ) else {
                call.reject("App Group container unavailable")
                return
            }

            do {
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys]
                let data = try encoder.encode(PlacesDocument(v: 1, places: places))
                try data.write(
                    to: rootURL.appendingPathComponent("places.json"),
                    options: .atomic
                )
                DispatchQueue.main.async {
                    RailBoardScheduleWriter.refreshIfNeeded(
                        application: UIApplication.shared
                    )
                    call.resolve()
                }
            } catch {
                call.reject("Unable to persist places")
            }
        }
    }

    private static func validatedPlace(_ value: JSValue) -> Place? {
        guard
            let item = value as? JSObject,
            let label = item["label"] as? String,
            let lat = doubleValue(item["lat"]),
            let lon = doubleValue(item["lon"]),
            let manual = item["manual"] as? Bool,
            lat.isFinite,
            lon.isFinite,
            taiwanLatitude.contains(lat),
            taiwanLongitude.contains(lon)
        else {
            return nil
        }
        return Place(label: label, lat: lat, lon: lon, manual: manual)
    }

    private static func doubleValue(_ value: JSValue?) -> Double? {
        if value is Bool { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Float { return Double(number) }
        if let number = value as? Int { return Double(number) }
        return nil
    }
}
