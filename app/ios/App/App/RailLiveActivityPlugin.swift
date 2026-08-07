import ActivityKit
import Capacitor
import Foundation

@objc(RailLiveActivityPlugin)
public final class RailLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailLiveActivityPlugin"
    public let jsName = "RailLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    // current／chain 只在 main queue 上被讀寫(由 enqueue 保證)。用 Any 存 Activity,
    // 避免整個 class 被 @available 綁死(class 本身要對 iOS 15.0 編得過)。
    private var current: Any?
    private var chain: Task<Void, Never>?
    private var tokenTask: Task<Void, Never>?

    // 🔴 把所有 ActivityKit 動作排成一條序列。原稿的 end 是 fire-and-forget 的 Task,
    //    換車時「舊卡的 end」與「新卡的 request」會交錯 ⇒ 兩張卡並存,或新卡被舊卡的 end 收掉。
    //    Capacitor 的 plugin 方法在自己的序列佇列上被呼叫,對同一來源佇列 main.async 保序。
    private func enqueue(_ job: @escaping @MainActor () async -> Void) {
        DispatchQueue.main.async {
            let prev = self.chain
            self.chain = Task { @MainActor in await prev?.value; await job() }
        }
    }

    // 🔴 signature 提到 @available 型別 ⇒ 方法本身必須標 @available。
    //    原稿沒標,而 class 是對 iOS 15.0 編譯的 ⇒ 直接編不過(而且錯誤訊息指向型別不是這裡)。
    @available(iOS 17.6, *)
    private func state(from call: CAPPluginCall) -> RailFollowAttributes.ContentState {
        let raw = call.getString("arrivalIso") ?? ""
        var date: Date? = nil
        if !raw.isEmpty {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            date = iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        }
        // 🔴 解析不出來就是 nil。原稿的 `?? Date().addingTimeInterval(60)` 會在卡片上
        //    造出一個憑空捏造、而且真的在走的「還有 1 分鐘」——使用者無從分辨真假。
        return RailFollowAttributes.ContentState(
            nextStop: call.getString("nextStop") ?? "",
            arrivalDate: date,
            delaySec: call.getInt("delaySec") ?? 0,
            terminus: call.getString("terminus") ?? ""
        )
    }

    // 收掉所有屬於本 App 的跟車卡片——包含「App 被系統終止後遺留」的孤兒。
    // 🔴 只清 self.current 不夠:handle 不跨行程存活,App 重開後那張卡還在鎖定畫面上,
    // 會一路留到 staleDate(8 小時),而且再跟一次車就變兩張。
    @available(iOS 17.6, *)
    @MainActor
    private func endAll() async {
        tokenTask?.cancel(); tokenTask = nil
        current = nil
        for act in Activity<RailFollowAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
    }

    override public func load() {
        guard #available(iOS 17.6, *) else { return }
        enqueue { await self.endAll() }   // App 啟動先掃一次孤兒
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": false, "why": "ios<17.6"]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["ok": false, "why": "disabled"]); return
        }
        let attrs = RailFollowAttributes(
            trainNo: call.getString("trainNo") ?? "",
            kind: call.getString("kind") ?? "",
            sys: call.getString("sys") ?? ""
        )
        let st = state(from: call)
        enqueue {
            await self.endAll()   // 🔴 await:舊卡確實收掉之後才開新的
            do {
                let act = try Activity.request(
                    attributes: attrs,
                    content: .init(state: st, staleDate: Date().addingTimeInterval(8 * 3600)),
                    pushType: .token          // 🔴 少了這個參數就拿不到 token,卡片只能靠前景更新
                )
                self.current = act
                // pushTokenUpdates 是 AsyncSequence,token 會【多次】輪替,不是拿一次就結束。
                // 這條 Task 的生命週期綁在 endAll()——換車時先 cancel,否則舊卡的 token 會被當成新卡的送上去。
                let key = call.getString("key") ?? ""
                self.tokenTask = Task { @MainActor in
                    for await data in act.pushTokenUpdates {
                        let hex = data.map { String(format: "%02x", $0) }.joined()
                        self.notifyListeners("pushToken", data: ["token": hex, "key": key])
                    }
                }
                call.resolve(["ok": true])
            } catch {
                call.resolve(["ok": false, "why": error.localizedDescription])
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": false, "why": "ios<17.6"]); return }
        let next = state(from: call)
        enqueue {
            // 🔴 current 只能在 main queue 上讀(見上面 enqueue 的註解),而 Capacitor 的 plugin 方法
            //    跑在它自己的背景序列佇列上 ⇒ 在 enqueue 外面讀它,一是對 var 的跨執行緒讀寫,
            //    二是必定讀到 start 尚未寫入的舊值 ⇒ 跟上車後緊接的那發 force update 一律回
            //    noactivity。start／end／load 三支都守著這條不變量,只有這裡漏在外面。
            guard let act = self.current as? Activity<RailFollowAttributes> else {
                call.resolve(["ok": false, "why": "noactivity"]); return
            }
            await act.update(.init(state: next, staleDate: Date().addingTimeInterval(8 * 3600)))
            call.resolve(["ok": true])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": true]); return }
        enqueue { await self.endAll(); call.resolve(["ok": true]) }
    }
}
