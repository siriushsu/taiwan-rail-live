import ActivityKit
import Capacitor
import Foundation

// 台鐵等站卡:全手動開卡——零定位、零背景工作。
// 🔴 與捷運等車卡最大的差別是【沒有倒數】:主角是「實際約到站時刻」(表定＋官方誤點),
//    一個固定的鐘面時刻。台鐵官方只有這兩個值(memory: tra-thsr-no-official-eta),
//    換算成秒級倒數就是製造官方沒有的精度。連帶的好處是這張卡結構上不可能踩到
//    la-countdown-static-text-freeze 那一族問題——沒有自走文字,就沒有凍住的自走文字。
// 開卡走 pushType: .token,token 交給 JS 送 /api/tra-wait/bind,之後由伺服器每分鐘把官方
// 誤點 join 回來。綁定失敗時整張卡退回零推播行為(表定與開卡當下的誤點仍然是真的,
// 只是不會再更新),視圖照 state.pushed 如實說明是哪一種。

/// 兩張等候卡的互斥。
///
/// 🔴 鎖屏上同時掛捷運等車卡與台鐵等站卡,只會讓兩張都看不清(各約 150pt,疊起來超過
///    一個螢幕能好好呈現的量),而使用者一次只會在一個站等一班車。所以【任一張卡開之前
///    要把兩種都收乾淨】——兩支 plugin 的 start() 都呼叫這裡,不可以各收各的。
///    (各收各的症狀:從捷運站走到台鐵站再開一張,舊卡留在鎖屏上繼續跑一個早就不相干的倒數。)
enum RailWaitCards {
    @available(iOS 17.6, *)
    @MainActor
    static func endAll() async {
        for act in Activity<TraWaitAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
        for act in Activity<MetroWaitAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
    }
}

@objc(RailTraWaitPlugin)
public final class RailTraWaitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailTraWaitPlugin"
    public let jsName = "RailTraWait"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    /// 追蹤窗的上限,與伺服器 bind 的 TW_MAX_TRACK_SEC 同值(3.5 小時)。
    /// 🔴 兩邊必須一致:算出超過上限的 endAt 送上去會被 bind 以 bad_end 拒收,
    ///    而使用者只會看到「卡片開了但誤點永遠不更新」。
    private static let maxTrackSec: Double = 3.5 * 3600
    /// end_at 相對「實際約到站」的緩衝,與伺服器 TW_END_PAD_SEC 同值。
    private static let endPadSec: Double = 1800
    /// 追蹤窗的下限。表定已經過去的車(正是本功能最典型的情境)算出來的 endAt 可能已經很近,
    /// 給它至少 10 分鐘,免得卡一開就被伺服器第一輪收掉。
    private static let minTrackSec: Double = 600

    // 所有 ActivityKit 動作排成一條序列(照 RailMetroWaitPlugin 的血淚註解):
    // 連點兩下時,兩組「先收舊卡再開新卡」若交錯,會出現兩張卡並存或新卡被舊卡的 end 收掉。
    private var chain: Task<Void, Never>?
    private func enqueue(_ job: @escaping @MainActor () async -> Void) {
        DispatchQueue.main.async {
            let prev = self.chain
            self.chain = Task { @MainActor in await prev?.value; await job() }
        }
    }

    // pushTokenUpdates 的監看 Task。生命週期綁在 endAll()——換車時先 cancel,
    // 否則舊卡的 token 會在新卡開好之後才回來、被 JS 當成新卡的 token 送去綁定。
    private var tokenTask: Task<Void, Never>?

    @available(iOS 17.6, *)
    @MainActor
    private func endAll() async {
        tokenTask?.cancel()
        tokenTask = nil
        await RailWaitCards.endAll()
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": false, "why": "ios<17.6"]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["ok": false, "why": "disabled"]); return
        }
        // 🔴 schedSec 是【絕對 epoch 秒】不是當日秒數:跨午夜的末班車用當日秒數會算到昨天。
        let schedSec = call.getDouble("schedSec") ?? 0
        guard schedSec > 0 else { call.resolve(["ok": false, "why": "bad_sched"]); return }
        // delayMin 的 nil 與 0 是兩件事:nil＝開卡當下沒有即時誤點資訊(卡片會明說),
        // 0＝官方說準點。JS 端只在真的查得到時才送這一欄。
        let delayMin = call.getInt("delayMin")
        // 實際約到站 = 表定 + 誤點(誤點未知就是表定本人)。全卡唯一算出來的數字,
        // 而它的兩個輸入都是官方值。
        let eta = schedSec + Double(delayMin ?? 0) * 60
        let now = Date().timeIntervalSince1970
        // 🔴 endAt 只在這裡算一次並【原值回傳給 JS】,JS 交班時送這個值上去。
        //    伺服器之後會隨誤點把它往後延(twNextEndAt),而這張卡【不印】它——
        //    捷運等車卡那條「兩邊必須是同一個數」的鐵則守的是「卡片印出來的承諾」,
        //    這裡的解法是不對使用者承諾這個數。
        let endAt = min(max(eta + Self.endPadSec, now + Self.minTrackSec), now + Self.maxTrackSec)
        let attrs = TraWaitAttributes(
            station: call.getString("station") ?? "",
            trainNo: call.getString("trainNo") ?? "",
            trainType: call.getString("trainType") ?? "",
            dest: call.getString("dest") ?? "",
            schedSec: schedSec,
            color: call.getString("color"),
            endAt: endAt)

        var st = TraWaitAttributes.ContentState()
        st.delayMin = delayMin
        st.dataAt = call.getDouble("dataAt")
        st.notice = call.getString("notice")
        // pushed 刻意不寫(nil＝還不知道):綁定是開卡之後才非同步完成的,
        // 伺服器每一發推播都會送 true。
        enqueue {
            await self.endAll()   // 🔴 await:等候卡最多一張(含捷運等車卡),舊卡確實收掉才開新的
            do {
                // staleDate ＝ 實際約到站時刻。isStale 翻真的語意是「車應該到了」,
                // 不是「資料過期」——後者是 dataAt 過齡,視圖上長得不一樣。
                let act = try Activity.request(
                    attributes: attrs,
                    content: .init(state: st, staleDate: Date(timeIntervalSince1970: eta)),
                    // 少了 .token 就拿不到 push token,伺服器永遠接不了手(卡片仍能開,
                    // 只是誤點分鐘停在開卡當下那一個)。
                    pushType: .token)
                // pushTokenUpdates 是 AsyncSequence,token 會【多次】輪替,不是拿一次就結束。
                // key 由 JS 帶進來、原樣回傳:JS 靠它認出「這顆 token 屬於我現在這張卡」。
                let key = call.getString("key") ?? ""
                self.tokenTask = Task { @MainActor in
                    for await data in act.pushTokenUpdates {
                        let hex = data.map { String(format: "%02x", $0) }.joined()
                        self.notifyListeners("traWaitPushToken", data: ["token": hex, "key": key],
                                             retainUntilConsumed: true)
                    }
                }
                call.resolve(["ok": true, "id": act.id, "endAt": endAt])
            } catch {
                // localizedDescription 對 ActivityAuthorizationError 是一句籠統英文,分不出
                // 「背景不能開卡」「使用者關了即時動態」「同時開太多張」——真機失敗時查不出原因。
                call.resolve(["ok": false,
                              "why": String(describing: error),
                              "detail": error.localizedDescription,
                              "domain": (error as NSError).domain,
                              "code": (error as NSError).code])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["ok": true]); return }
        enqueue { await self.endAll(); call.resolve(["ok": true]) }
    }

    // JS 回前景對帳用:「結束」鈕(LiveActivityIntent)與鎖屏左滑清除都不經 JS,
    // 看板鈕的「追蹤這班/結束追蹤」文案要跟真實卡況對齊,只能來這裡問。
    @objc func status(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["active": false]); return }
        enqueue {
            // 🔴 一定要濾 activityState:`activities` 連【已結束】的卡都還留在列表裡,
            //    照收就會回報「還在追蹤」⇒ 看板鈕變「結束追蹤」⇒ 使用者以為在重新追蹤,
            //    實際執行的是停止,要再點第二次才開得成。
            //    .stale 必須算數:本卡用 staleDate 把語意翻成「車應已到」,
            //    那段時間卡片還在螢幕上,當成沒卡就會把它悄悄收掉。
            let alive = Activity<TraWaitAttributes>.activities.first {
                $0.activityState == .active || $0.activityState == .stale
            }
            guard let act = alive else { call.resolve(["active": false]); return }
            var data: [String: Any] = ["active": true,
                                       "station": act.attributes.station,
                                       "trainNo": act.attributes.trainNo,
                                       "schedSec": act.attributes.schedSec]
            if let endAt = act.attributes.endAt { data["endAt"] = endAt }
            call.resolve(data)
        }
    }
}
