import ActivityKit
import Capacitor
import Foundation
import StoreKit
import UIKit

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
    // 🔴 解析不出來就是 nil。原稿在呼叫端用 `?? Date().addingTimeInterval(60)` 兜底,
    //    那會在卡片上造出一個憑空捏造、而且真的在走的「還有 1 分鐘」——使用者無從分辨真假。
    private static func epoch(_ raw: String?) -> Double? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        return d?.timeIntervalSince1970
    }

    @available(iOS 17.6, *)
    private func state(from call: CAPPluginCall) -> RailFollowAttributes.ContentState {
        // 🔴 notice 刻意不從這裡帶:那是後端在上游中斷時才寫的字串,前景有新鮮資料、
        //    本來就不該掛那句話(省略 ⇒ Optional 預設 nil ⇒ 前景更新順帶把它清掉,正確)。
        return RailFollowAttributes.ContentState(
            nextStop: call.getString("nextStop") ?? "",
            arrivalDate: Self.epoch(call.getString("arrivalIso")),
            // 🔴 departedDate 原本【完全沒帶】⇒ 前景時進度條兩端缺一端,一格都畫不出來,
            //    只有後端推播那條路才有進度條。前景與背景顯示不一致,使用者會以為壞了。
            departedDate: Self.epoch(call.getString("departedIso")),
            delaySec: call.getInt("delaySec") ?? 0,
            terminus: call.getString("terminus") ?? "",
            stopping: call.getBool("stopping"),
            prevStop: call.getString("prevStop")
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
        // 告知音樂端「跟車讓位」結束：RailAudioPlugin 據此把播放卡掛回鎖定畫面。
        NotificationCenter.default.post(name: Notification.Name("railFollowChanged"), object: nil, userInfo: ["active": false])
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
            sys: call.getString("sys") ?? "",
            // 車種代表色。Attributes 只在 request 當下定版,之後的 update 改不了它——
            // 但車種本來就不會中途變,這正是它該放在 Attributes 而不是 ContentState 的理由。
            color: call.getString("color")
        )
        let st = state(from: call)
        enqueue {
            await self.endAll()   // 🔴 await:舊卡確實收掉之後才開新的
            do {
                let act = try Activity.request(
                    attributes: attrs,
                    // 🔴 staleDate 綁在【這一份內容的到站時刻】上,不是寫死的 8 小時:
                    //    卡片交班給伺服器之後就沒有本機 update,而伺服器「四個量都沒變就不推」
                    //    ⇒ 準點車可以整段零推播。到站時刻過去而沒有新推播時,ActivityKit 靠這個
                    //    日期把 isStale 翻成 true 並【觸發一次重繪】——那正是「0 秒／行駛中」
                    //    這種凍住畫面唯一能自己脫困的路徑(視圖端的過期判斷要重繪才生效,
                    //    而零推播正好就是不會重繪)。算不出 ETA 時退回 8 小時的孤兒兜底。
                    content: .init(state: st, staleDate: RailFollowStale.date(arrival: st.arrivalDate)),
                    pushType: .token          // 🔴 少了這個參數就拿不到 token,卡片只能靠前景更新
                )
                self.current = act
                // 跟車卡上島了:通知音樂端讓位(收播放卡、轉混音模式),跟車獨占動態島。
                NotificationCenter.default.post(name: Notification.Name("railFollowChanged"), object: nil, userInfo: ["active": true])
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
            // staleDate 每一發都要重算(理由見 start 那側)。前景更新期間它會被一路往後推,
            // 只有「停止更新」之後才真的走到期——這正是要量的那件事。
            await act.update(.init(state: next, staleDate: RailFollowStale.date(arrival: next.arrivalDate)))
            call.resolve(["ok": true])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": true]); return }
        enqueue { await self.endAll(); call.resolve(["ok": true]) }
    }
}

// ── 評分邀請 ────────────────────────────────────────────────────────────────
// 🔴 刻意寫在這個檔案裡、不另開 .swift：往 App/ 加新檔而沒手改 project.pbxproj，
// 檔案不會被編進去而 build 照樣 SUCCEEDED（小工具那顆修正就是這樣連漏四顆 build）。
// Capacitor 靠 Objective-C runtime 掃描註冊 plugin，與檔名無關，同檔多 class 完全成立。
//
// 只負責「請求」——顯不顯示由 Apple 決定（一年最多 3 次，且不保證出現），
// 我們收不到結果回報，所以 resolve 的 requested 只代表「我們請求過了」。
// 節流全部做在 JS 端（index.html 的 reviewShouldAsk）。
@objc(RailReviewPlugin)
public final class RailReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailReviewPlugin"
    public let jsName = "RailReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                call.resolve(["requested": false])
                return
            }
            if #available(iOS 18.0, *) {
                AppStore.requestReview(in: scene)
            } else if #available(iOS 16.0, *) {
                SKStoreReviewController.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview()
            }
            call.resolve(["requested": true])
        }
    }
}
