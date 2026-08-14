import AppIntents
import CoreLocation
import Foundation

// 自動選站(最近的站)。站台選單的哨兵值 "auto",解析發生在 timeline 生成當下:
// 取定位 → 對目錄座標做全站最近距離 → 當成那一站續走原本的看板流程。
// 🔴 授權來源是【App】的 WhenInUse(App/Info.plist 已有文案)＋widget Info.plist 的
//    NSWidgetWantsLocation;widget 自己不能發授權請求,拿不到就走快取退路。
enum MetroNearest {
    static let sentinel = "auto"
    private static let suite = UserDefaults(suiteName: "group.tw.railisland.app")
    // 鍵前綴沿用 metro.,不碰發車看板的檔案目錄與 meta.json(與 MetroFetcher 同一條紀律)。
    private static let cacheKey = "metro.autoNearest"

    /// 站台選單最上面的「定位」段(北捷小卡與混合大卡共用,恆在、不受系統格過濾)。
    static func optionSection() -> IntentItemSection<String> {
        IntentItemSection("定位", items: [
            IntentItem<String>(sentinel, title: "自動（最近的站）"),
        ])
    }

    /// 解析哨兵值。定位到手就算最近站並記快取;拿不到定位退上次解析結果——
    /// 最近站短時間內幾乎不變,舊站名比整卡空白有用;一次都沒解析過才回 nil。
    static func resolve(catalog: MetroWidgetCatalog) async -> (sys: String, station: String)? {
        if let fix = await OneShotLocation.shared.fix(),
           let hit = nearest(catalog: catalog,
                             lat: fix.coordinate.latitude, lon: fix.coordinate.longitude) {
            suite?.set("\(hit.sys)|\(hit.station)", forKey: cacheKey)
            return hit
        }
        if let cached = suite?.string(forKey: cacheKey) {
            let p = cached.split(separator: "|", maxSplits: 1).map(String.init)
            if p.count == 2 { return (p[0], p[1]) }
        }
        return nil
    }

    static func nearest(catalog: MetroWidgetCatalog, lat: Double, lon: Double)
        -> (sys: String, station: String)? {
        MetroNearestMath.nearest(catalog: catalog, lat: lat, lon: lon)
    }
}

// 最近站計算的純函式層。🔴 刻意獨立成頂層宣告、零外部依賴(不碰 CoreLocation/AppIntents)
//    ——verify_metro_nearest.mjs 用大括號抽取把它跟 MetroWidgetCatalog 一起裸編譯,
//    對 JS 獨立實作的 haversine 做差分驗證;塞回 MetroNearest 裡它就抽不出來了。
enum MetroNearestMath {
    /// 跨系統全站掃描取大圓距離最小者。
    static func nearest(catalog: MetroWidgetCatalog, lat: Double, lon: Double)
        -> (sys: String, station: String)? {
        var best: (sys: String, station: String)? = nil
        var bestMeters = Double.greatestFiniteMagnitude
        for s in catalog.systems {
            for name in s.stationNames {
                guard let c = catalog.coords["\(s.id)|\(name)"] else { continue }
                let d = haversineMeters(lat1: lat, lon1: lon, lat2: c.lat, lon2: c.lon)
                if d < bestMeters { bestMeters = d; best = (s.id, name) }
            }
        }
        return best
    }

    static func haversineMeters(lat1: Double, lon1: Double,
                                lat2: Double, lon2: Double) -> Double {
        let r = 6_371_000.0
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}

// 一發定位。🔴 CLLocationManager 的 delegate 回呼要有 runloop——整個類釘在 @MainActor
//    (主執行緒建立 manager),timeout 與 delegate 都收斂到同一個 finish(),
//    continuation 先清後用,雙路競速也不會 double-resume(那是當場 crash 的等級)。
@MainActor
final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    static let shared = OneShotLocation()
    private var mgr: CLLocationManager?
    private var cont: CheckedContinuation<CLLocation?, Never>?

    func fix() async -> CLLocation? {
        let m = mgr ?? CLLocationManager()
        mgr = m
        let auth = m.authorizationStatus
        guard auth == .authorizedWhenInUse || auth == .authorizedAlways,
              m.isAuthorizedForWidgetUpdates else { return nil }
        // 系統手上剛好有 10 分鐘內的定位就直接用——widget 的執行時間預算很小,能不等就不等。
        if let l = m.location, l.timestamp.timeIntervalSinceNow > -600 { return l }
        // 防重入:上一發還在飛就不疊第二發,退而求其次拿現值(可能 nil,由呼叫端走快取)。
        if cont != nil { return m.location }
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyHundredMeters
        return await withCheckedContinuation { (c: CheckedContinuation<CLLocation?, Never>) in
            cont = c
            m.requestLocation()
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                // 逾時:有什麼用什麼。finish 對已結束的請求是 no-op。
                self.finish(self.mgr?.location)
            }
        }
    }

    private func finish(_ l: CLLocation?) {
        guard let c = cont else { return }
        cont = nil
        c.resume(returning: l)
    }

    nonisolated func locationManager(_ manager: CLLocationManager,
                                     didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.finish(locations.last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager,
                                     didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }
}
