import Foundation
import WidgetKit

// 捷運小工具的通行證閘門(2026-08-15 使用者裁示):
//   免費版一次看【一站】(MetroBoardIntent.freeStationLimit)——免費名額跟著「目前還設著的站」走,
//   換站或移除小工具就自動釋放,不會把人鎖死在第一次選的站。
//   「自動(最近的站)」會隨移動換站,天生是多站功能 ⇒ 通行證限定(同批裁示),連定位都不必打。
// 🔴 判定核心 MetroPlusCore 刻意做成頂層零依賴 enum——與 MetroNearestMath 同慣例,
//    讓 verify_metro_plus_gate.mjs 能大括號抽取原始碼、真 swiftc 編譯後與獨立 JS 對照組互驗。
//    IO(UserDefaults/WidgetCenter)全部留在 MetroPlusGate 殼層,核心永遠可以離線窮舉真值表。

enum MetroPlusDecision: Equatable {
    case allowed                          // 放行(通行證、全免費、或本來就在免費名額內)
    case claimFree                        // 放行,且這一站佔下免費名額(殼層負責落盤)
    case needPassAuto                     // 擋下:自動選站是通行證功能
    case needPassMulti(claimedName: String) // 擋下:免費名額已被另一站佔用(帶站名供 CTA 文案)
}

enum MetroPlusCore {
    /// 純判定,零 IO。
    /// - plus: App 同步來的通行證資格(App Group 鍵 metro.plusActive)
    /// - limit: MetroBoardIntent.freeStationLimit(nil ＝全免費)
    /// - isAuto: 這格選的是「自動(最近的站)」哨兵
    /// - current: 這格設定的站鍵 "sys|站名"(未選站為 nil)
    /// - claimed: 已佔用免費名額的站鍵們(App Group 鍵 metro.freeStations)
    /// - configured: 目前【所有】已安裝實例(捷運小卡＋混合大卡)設定中的站鍵集合
    static func decide(plus: Bool, limit: Int?, isAuto: Bool, current: String?,
                       claimed: [String], configured: [String]) -> MetroPlusDecision {
        if plus { return .allowed }
        guard let limit else { return .allowed }
        if isAuto { return .needPassAuto }
        guard let current, !current.isEmpty else { return .allowed } // 「請選擇車站」佔位畫面不 gate
        // 舊 claim 若已不在任何現裝實例的設定裡(換過站/移除小工具),名額自動釋放。
        // 🔴 枚舉失敗時 configured 會是空集合 ⇒ 所有 claim 視同已釋放 ⇒ 本站直接補位。
        //    這是刻意的 fail-open:寧可少擋一次,不可把換了站的免費使用者鎖在 CTA 上。
        // 🔴 2026-08-16 prefix(limit) 是「免費【一】站」這三個字本身,不是防禦性寫法:
        //    沒有它的話,claimed 裡只要同時有兩筆還活著的 claim,兩筆都會被判 allowed ＝免費兩站。
        //    而 claimed 真的會累積到兩筆,且**不需要任何競態**——舊版 evaluate() 寫回時只濾掉
        //    「自己這一筆」,換過站的舊 claim 留在陣列裡([板橋] → 換到中山 → [板橋,中山]),
        //    使用者日後再放一張卡設回板橋,兩筆就同時復活。從沒訂過通行證的人也做得到,
        //    而且可以重複操作到 N 站(2026-08-16 由 verify_metro_plus_gate.mjs 的三條累積情境抓到)。
        //    殼層那邊同一批已改成寫回時就剪掉失效 claim(見 evaluate),這裡是**結構性的第二道**:
        //    不管陣列怎麼長,任何時刻最多只有 limit 個名額算數。
        let live = Array(claimed.filter { configured.contains($0) }.prefix(limit))
        if live.contains(current) { return .allowed }
        if live.count < limit { return .claimFree }
        let name = String((live.first ?? "").split(separator: "|", maxSplits: 1).last ?? "")
        return .needPassMulti(claimedName: name)
    }
}

enum MetroPlusGate {
    private static let suite = UserDefaults(suiteName: "group.tw.railisland.app")
    /// App 端 RailMetroWaitPlugin.setPlus 寫入;widget 只讀。鍵不存在(裝了 App 從沒開過)＝false,
    /// 與自動選站快取同一套「開 App 一次就同步」的期待,CTA 文案要把這條路講出來。
    static let plusKey = "metro.plusActive"
    /// 免費名額佔用表(站鍵陣列)。limit=1 時最多一筆;存陣列是讓 limit 未來變動不用搬資料。
    static let claimKey = "metro.freeStations"

    static func plusActive() -> Bool { suite?.bool(forKey: plusKey) ?? false }

    /// 這一格的閘門判定。claimFree 在此當場落盤(去重後附加),呼叫端拿到的兩種放行同樣續走原流程。
    static func evaluate(stationKey: String?, isAuto: Bool) async -> MetroPlusDecision {
        let configured = await configuredStationKeys()
        let d = MetroPlusCore.decide(plus: plusActive(),
                                     limit: MetroBoardIntent.freeStationLimit,
                                     isAuto: isAuto,
                                     current: stationKey,
                                     claimed: suite?.stringArray(forKey: claimKey) ?? [],
                                     configured: configured)
        if case .claimFree = d, let key = stationKey {
            // 🔴 2026-08-16:寫回時把「已經不在任何現裝實例設定裡」的舊 claim 一併剪掉。
            //    舊版只濾掉 key 自己 ⇒ 陣列單調成長,而且使用者把某張卡設回舊站時兩筆會同時復活
            //    (核心的 prefix(limit) 註解有完整重現步驟)。剪掉之後陣列恆等於「目前真的在用的名額」,
            //    也讓「先設的那一站保住免費資格」這件事符合直覺——被擋的是後來新增的那張卡。
            var next = (suite?.stringArray(forKey: claimKey) ?? []).filter { $0 != key && configured.contains($0) }
            next.append(key)
            suite?.set(next, forKey: claimKey)
        }
        return d
    }

    /// 所有現裝實例(兩種卡)設定中的站鍵。哨兵「auto」不算站鍵——自動實例不參與名額佔用。
    /// 🔴 WidgetCenter 枚舉拿不到就回空集合,走核心的 fail-open 路(見 decide 註解)。
    private static func configuredStationKeys() async -> [String] {
        let infos: [WidgetInfo] = await withCheckedContinuation { cont in
            WidgetCenter.shared.getCurrentConfigurations { result in
                cont.resume(returning: (try? result.get()) ?? [])
            }
        }
        var keys: [String] = []
        for info in infos {
            if let m = info.widgetConfigurationIntent(of: MetroBoardIntent.self),
               let s = m.station, s != MetroNearest.sentinel { keys.append(s) }
            if let x = info.widgetConfigurationIntent(of: MixedBoardIntent.self),
               let s = x.metroStation, s != MetroNearest.sentinel { keys.append(s) }
        }
        return keys
    }
}
