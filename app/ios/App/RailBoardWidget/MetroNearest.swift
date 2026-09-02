import AppIntents
import CoreLocation
import Foundation

// 自動選站(最近的站)。站台選單的哨兵值 "auto",解析發生在 timeline 生成當下:
// 取定位 → 對目錄座標做全站最近距離 → 在服務範圍內就當成那一站續走原本的看板流程,
// 太遠(見 MetroNearestMath.serviceRadiusMeters)則畫「不在服務範圍」而不是硬解析一個遠站。
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

    /// 解析哨兵值。三態:回 `.serviceable` 就照常走看板流程、`.outOfRange` 由卡面明講範圍外、
    /// nil ＝ 沒授權或定位失敗【且一次都沒成功解析過】(沒有快取可退)。
    ///
    /// 定位到手就算最近站並記快取;拿不到定位退上次解析結果——最近站短時間內幾乎不變,
    /// 舊站名比整卡空白有用。
    ///
    /// 🔴 退快取那一路要回 `stale: true` 並【一路帶到卡面】。小工具一段時間沒被看到,
    ///    系統就不再供應定位(Apple 的 widget in-use 窗,見 isAuthorizedForWidgetUpdates
    ///    文件),此時卡上畫的是【上次】的位置而不是現在的;不標出來的話畫面與正常狀態
    ///    一模一樣,使用者只會覺得「自動選站壞了」而無從分辨(2026-08-30 使用者回報)。
    static func resolve(catalog: MetroWidgetCatalog) async
        -> (outcome: MetroNearestMath.Outcome, stale: Bool)? {
        if let fix = await OneShotLocation.shared.fix(),
           let outcome = MetroNearestMath.classify(catalog: catalog,
                                                   lat: fix.coordinate.latitude,
                                                   lon: fix.coordinate.longitude) {
            switch outcome {
            case .serviceable(let sys, let station):
                suite?.set("\(sys)|\(station)", forKey: cacheKey)
            case .outOfRange:
                // 🔴 確認人在範圍外就要【清掉】快取。留著的話下一輪定位失敗會退回舊站,
                //    卡上繼續畫幾百公里外那一站的倒數——那比直說「範圍外」更隱蔽,
                //    因為畫面看起來完全正常(2026-08-18 回報的同一個問題的另一半)。
                suite?.removeObject(forKey: cacheKey)
            }
            return (outcome, false)
        }
        if let cached = suite?.string(forKey: cacheKey) {
            let p = cached.split(separator: "|", maxSplits: 1).map(String.init)
            if p.count == 2 { return (.serviceable(sys: p[0], station: p[1]), true) }
        }
        return nil
    }
}

// 最近站計算的純函式層。🔴 刻意獨立成頂層宣告、零外部依賴(不碰 CoreLocation/AppIntents)
//    ——verify_metro_nearest.mjs 用大括號抽取把它跟 MetroWidgetCatalog 一起裸編譯,
//    對 JS 獨立實作的 haversine 做差分驗證;塞回 MetroNearest 裡它就抽不出來了。
enum MetroNearestMath {
    /// 一次定位的判定結果。🔴 「夠不夠近」這個比較【刻意住在純函式層】——
    ///    放在 resolve() 裡的話它依賴 CoreLocation/UserDefaults、抽不出來裸編譯,
    ///    verify 就只驗得到「距離算得對」與「門檻常數是多少」這兩個分支的上游,
    ///    把 `<=` 寫成 `>=` 也照樣全綠(判準落在受測物下游)。
    enum Outcome {
        case serviceable(sys: String, station: String)
        /// 最近站在服務範圍外。附站名與距離,讓卡面講得出「最近的是誰、多遠」。
        case outOfRange(station: String, meters: Double)
    }

    /// 自動選站的服務範圍半徑。最近站在這之外時,那一站的倒數對使用者沒有意義
    /// ——他不會走過去搭,而卡上照常畫著秒級倒數(2026-08-18 使用者回報)。
    ///
    /// 12,000 取自對目錄裡 trtc/krtc/tymc 三系統實算的天然斷點:
    ///   合理   桃園藝文特區 8.4km→環北、桃園車站 9.2km→體育大學、烏來 10.6km→新店
    ///   不合理 屏東車站 11.2km→大寮(屏東人搭台鐵進高雄)、基隆車站 14.8km→東湖(隔一座山)
    /// 🔴 偏寬是刻意的:自動選站是通行證功能,擋錯＝付費使用者的卡整片空白,代價遠高於
    ///    多顯示一個沒用的站名;而範圍外的卡面會明講最近站與距離,資訊仍然誠實。
    /// 🔴 姊妹功能(發車看板「我的地點」RailBoardPlaces.maximumDistanceMeters)是 5km,
    ///    刻意不共用:台鐵站密度遠高於捷運,5km 會把三峽/鶯歌/桃園全境一起誤擋。
    static let serviceRadiusMeters = 12_000.0

    /// 範圍外時卡面那一行。距離【無條件進位】到公里:四捨五入會印出「約 12 公里」,
    /// 而 12 公里正好是門檻值,使用者看了會覺得自己明明在範圍內卻被擋。
    /// 🔴 放在純函式層是為了讓 render_metro_widget.mjs 算繪那張卡時能呼叫【真的這一支】
    ///    ——在算繪器裡重打一份字面值,文案改了就會無聲分岔(那張圖照樣好看)。
    static func outOfRangeHint(station: String, meters: Double) -> String {
        "最近的捷運站是\(station)，約 \(Int(ceil(meters / 1000))) 公里。可改選一個固定車站。"
    }

    /// 取最近站並判服務範圍。目錄一站都沒有(座標全缺)才回 nil。
    static func classify(catalog: MetroWidgetCatalog, lat: Double, lon: Double) -> Outcome? {
        guard let hit = nearest(catalog: catalog, lat: lat, lon: lon) else { return nil }
        return hit.meters <= serviceRadiusMeters
            ? .serviceable(sys: hit.sys, station: hit.station)
            : .outOfRange(station: hit.station, meters: hit.meters)
    }

    /// 跨系統全站掃描取大圓距離最小者。【不套】服務範圍門檻——
    /// 「誰最近」與「夠不夠近」分成兩支:範圍外的文案還要靠這一支拿最近站名與距離。
    static func nearest(catalog: MetroWidgetCatalog, lat: Double, lon: Double)
        -> (sys: String, station: String, meters: Double)? {
        var best: (sys: String, station: String, meters: Double)? = nil
        var bestMeters = Double.greatestFiniteMagnitude
        for s in catalog.systems {
            for name in s.stationNames {
                guard let c = catalog.coords["\(s.id)|\(name)"] else { continue }
                let d = haversineMeters(lat1: lat, lon1: lon, lat2: c.lat, lon2: c.lon)
                if d < bestMeters { bestMeters = d; best = (s.id, name, d) }
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
