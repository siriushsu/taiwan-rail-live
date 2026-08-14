import ActivityKit
import Capacitor
import Foundation

// 捷運等車卡:全手動開卡(使用者裁示)——零推播、零定位。倒數靠 Text(timerInterval:) 自走,
// staleDate 到期系統自己標灰,App 不在背景做任何事。
@objc(RailMetroWaitPlugin)
public final class RailMetroWaitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailMetroWaitPlugin"
    public let jsName = "RailMetroWait"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    // ── 深連結轉運(小工具 railisland://metro-wait?sys=…&station=…) ──
    // 本專案沒裝 @capacitor/app,appUrlOpen 那條 JS 事件根本沒人聽;深連結由 AppDelegate
    // 直接交給本 plugin 轉成 "waitOpen" 事件。cold start 時 open-url 可能比 plugin load()
    // 先到 ⇒ 先暫存;JS listener 可能比事件晚掛 ⇒ notifyListeners 用 retainUntilConsumed。
    // 兩端都補上,冷熱啟動才都接得住。只在主執行緒被呼叫(AppDelegate 與 capacitorDidLoad 都是)。
    private static weak var shared: RailMetroWaitPlugin?
    private static var pendingOpenURL: URL?

    public static func handleOpen(url: URL) -> Bool {
        guard url.scheme == "railisland", url.host == "metro-wait" else { return false }
        if let p = shared { p.forwardOpen(url) } else { pendingOpenURL = url }
        return true
    }

    private func forwardOpen(_ url: URL) {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        var data: [String: Any] = [:]
        for item in comps.queryItems ?? [] { data[item.name] = item.value ?? "" }
        notifyListeners("waitOpen", data: data, retainUntilConsumed: true)
    }

    override public func load() {
        Self.shared = self
        if let url = Self.pendingOpenURL { Self.pendingOpenURL = nil; forwardOpen(url) }
        // 🔴 刻意【不】比照 RailFollowActivity 在啟動時掃孤兒卡:等車卡的倒數是官方絕對時刻,
        //    App 死掉之後卡片依然是真的;staleDate 一到系統自己標灰。使用者手動開的卡,
        //    在他重開 App 查個地圖時被我們收掉,才是 bug。單卡不變量由 start() 的先掃後開保證。
    }

    // 🔴 所有 ActivityKit 動作排成一條序列(照 RailLiveActivityPlugin 的血淚註解):
    //    連點兩下「在這站等」時,兩組「先收舊卡再開新卡」若交錯,會出現兩張卡並存
    //    或新卡被舊卡的 end 收掉。Capacitor plugin 方法在自己的序列佇列上被呼叫,
    //    對同一來源佇列 main.async 保序。
    private var chain: Task<Void, Never>?
    private func enqueue(_ job: @escaping @MainActor () async -> Void) {
        DispatchQueue.main.async {
            let prev = self.chain
            self.chain = Task { @MainActor in await prev?.value; await job() }
        }
    }

    // 掃掉所有等車卡——用 Activity<>.activities 而不是自存 handle,連「App 被系統終止後
    // 遺留」的孤兒一起涵蓋(handle 不跨行程存活)。
    @available(iOS 17.6, *)
    @MainActor
    private func endAll() async {
        for act in Activity<MetroWaitAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        // 照 RailLiveActivityPlugin 慣例回 resolve(ok:false, why:) 不 reject,JS 端好處理。
        guard #available(iOS 17.6, *) else { call.resolve(["ok": false, "why": "ios<17.6"]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["ok": false, "why": "disabled"]); return
        }
        let attrs = MetroWaitAttributes(
            sys: call.getString("sys") ?? "",
            station: call.getString("station") ?? "",
            lineLabel: call.getString("lineLabel") ?? "",
            color: call.getString("color"))
        var st = MetroWaitAttributes.ContentState()
        // 🔴 精度誠實:北捷帶 nextEta(官方絕對時刻,epoch 秒),分鐘級系統帶 nextMinutes。
        //    JS 端負責二選一;這裡照收不換算——分鐘換算成 eta 就是在畫假倒數。
        st.nextEta = call.getDouble("nextEta")
        st.nextMinutes = call.getInt("nextMinutes")
        st.secondEta = call.getDouble("secondEta")
        st.secondMinutes = call.getInt("secondMinutes")
        st.nextDest = call.getString("nextDest")
        st.secondDest = call.getString("secondDest")
        let crowd = (call.getArray("crowd") ?? []).compactMap { ($0 as? NSNumber)?.intValue }
        st.crowd = crowd.isEmpty ? nil : crowd
        st.dataAt = call.getDouble("dataAt")
        st.notice = call.getString("notice")
        enqueue {
            await self.endAll()   // 🔴 await:等車卡最多一張,換站=舊卡確實收掉才開新的
            do {
                // staleDate:下一班到站後 90 秒。到期系統自己標灰,不必推播、不假裝還新鮮。
                let stale = st.nextEta.map { Date(timeIntervalSince1970: $0 + 90) }
                    ?? Date().addingTimeInterval(Double((st.nextMinutes ?? 5) * 60 + 90))
                let act = try Activity.request(
                    attributes: attrs,
                    content: .init(state: st, staleDate: stale),
                    pushType: nil)          // 🔴 零推播:全手動開卡,倒數自走
                call.resolve(["ok": true, "id": act.id])
            } catch {
                call.resolve(["ok": false, "why": error.localizedDescription])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": true]); return }
        enqueue { await self.endAll(); call.resolve(["ok": true]) }
    }
}
