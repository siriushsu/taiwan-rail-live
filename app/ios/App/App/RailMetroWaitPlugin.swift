import ActivityKit
import Capacitor
import Foundation
import WidgetKit

// 捷運等車卡:全手動開卡(使用者裁示)——零定位。倒數靠 Text(timerInterval:) 自走,
// staleDate=下一班到站整點,isStale 翻真=view 畫「進站」。
// 🔴 2026-08-14 推播鏈:開卡改成 pushType: .token,拿到的 token 交給 JS 去 /api/metro-wait/bind,
//    之後由伺服器每分鐘接續班次、時段到點推 end 收卡。綁定失敗(沒網路、伺服器拒收)時整張卡
//    退回原本的零推播行為——倒數照樣自走,只是不會自己接下一班,而視圖會照 state.pushed
//    如實說明是哪一種。App 本身仍然不在背景做任何事。
@objc(RailMetroWaitPlugin)
public final class RailMetroWaitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailMetroWaitPlugin"
    public let jsName = "RailMetroWait"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlus", returnType: CAPPluginReturnPromise),
    ]

    // ── 深連結轉運(小工具 railisland://metro-wait?sys=…&station=…) ──
    // 本專案沒裝 @capacitor/app,appUrlOpen 那條 JS 事件根本沒人聽;深連結由 AppDelegate
    // 直接交給本 plugin 轉成 "waitOpen" 事件。cold start 時 open-url 可能比 plugin load()
    // 先到 ⇒ 先暫存;JS listener 可能比事件晚掛 ⇒ notifyListeners 用 retainUntilConsumed。
    // 兩端都補上,冷熱啟動才都接得住。只在主執行緒被呼叫(AppDelegate 與 capacitorDidLoad 都是)。
    private static weak var shared: RailMetroWaitPlugin?
    private static var pendingOpenURL: URL?

    // 通行證閘門擋下時,小工具的 widgetURL 是 railisland://pass ——同樣沒有 appUrlOpen 可聽,
    // 一併由本 plugin 轉運成 "waitOpen" 事件(帶 view:"pass"),JS 端收到就開通行證面板。
    public static func handleOpen(url: URL) -> Bool {
        guard url.scheme == "railisland", url.host == "metro-wait" || url.host == "pass" else { return false }
        if let p = shared { p.forwardOpen(url) } else { pendingOpenURL = url }
        return true
    }

    // 背景開卡(MetroWaitStartIntent)整條失敗時留下的待辦——轉成同一個 "waitOpen" 事件,
    // 走網頁端既有的深連結流程補開一次,退回改版前的行為。
    // 🔴 兩個呼叫點缺一不可:load() 接冷啟動(App 那時還沒起來),didBecomeActive 接熱啟動
    //    (待辦是在 App 這個行程被背景喚醒之後才寫的,那時 load() 早就跑完了)。
    static func flushPendingOpen() {
        guard let p = shared, let pend = MetroWaitPending.take() else { return }
        var data: [String: Any] = ["sys": pend.sys, "station": pend.station]
        if let d = pend.dest { data["dest"] = d }
        p.notifyListeners("waitOpen", data: data, retainUntilConsumed: true)
    }

    private func forwardOpen(_ url: URL) {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        var data: [String: Any] = [:]
        for item in comps.queryItems ?? [] { data[item.name] = item.value ?? "" }
        if comps.host == "pass" { data["view"] = "pass" }
        notifyListeners("waitOpen", data: data, retainUntilConsumed: true)
    }

    override public func load() {
        Self.shared = self
        if let url = Self.pendingOpenURL { Self.pendingOpenURL = nil; forwardOpen(url) }
        Self.flushPendingOpen()
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

    // pushTokenUpdates 的監看 Task。生命週期綁在 endAll()——換站時先 cancel,
    // 否則舊卡的 token 會在新卡開好之後才回來、被 JS 當成新卡的 token 送去綁定
    // (照抄 RailLiveActivityPlugin 走過的同一條血路)。
    private var tokenTask: Task<Void, Never>?

    // 掃掉所有等候卡——用 Activity<>.activities 而不是自存 handle,連「App 被系統終止後
    // 遺留」的孤兒一起涵蓋(handle 不跨行程存活)。
    // 🔴 收的是【兩種】卡(RailWaitCards.endAll 同時掃捷運等車卡與台鐵等站卡):鎖屏上
    //    一次只留一張等候卡。這裡若只收自己那型,從台鐵站走到捷運站開新卡時,舊的台鐵
    //    等站卡會留在鎖屏上繼續顯示一班早就不相干的車。兩支 plugin 都走同一個入口。
    @available(iOS 17.6, *)
    @MainActor
    private func endAll() async {
        tokenTask?.cancel()
        tokenTask = nil
        await RailWaitCards.endAll()
    }

    @objc func start(_ call: CAPPluginCall) {
        // 照 RailLiveActivityPlugin 慣例回 resolve(ok:false, why:) 不 reject,JS 端好處理。
        guard #available(iOS 17.6, *) else { call.resolve(["ok": false, "why": "ios<17.6"]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["ok": false, "why": "disabled"]); return
        }
        // 追蹤時長(30/60/90 分,選單選的;深連結不經選單=預設 30)。endAt 進 attributes,
        // 視圖印「追蹤至 HH:mm」;到點自動收卡由伺服器推 end 準時收,JS 的
        // metroWaitSyncFromNative 仍保留當兜底(綁定失敗或推播全滅時的退路)。
        let durationMin = call.getInt("durationMin") ?? 30
        // 🔴 endAt 只在這裡算一次,並且【原值回傳給 JS】——JS 交班時必須送這個值上去,
        //    不可以自己再算一次。兩邊各算會差幾百毫秒到幾秒,卡片印的「追蹤至 HH:mm」與
        //    伺服器收卡的時刻就會對不上,而使用者只看得到前者。
        let endAt = Date().timeIntervalSince1970 + Double(durationMin) * 60
        let attrs = MetroWaitAttributes(
            sys: call.getString("sys") ?? "",
            station: call.getString("station") ?? "",
            lineLabel: call.getString("lineLabel") ?? "",
            color: call.getString("color"),
            endAt: endAt)
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
                // staleDate:下一班【到站整點】。isStale 翻真=「列車進站」狀態(view 有分支),
                // 不是「資料過期」——真機回饋(08-14):倒數歸零後停在 0:00 的殭屍卡不夠實用,
                // 到點就把語意翻成進站,次班倒數(絕對時刻)在 stale 後仍自走。
                let stale = st.nextEta.map { Date(timeIntervalSince1970: $0) }
                    ?? Date().addingTimeInterval(Double((st.nextMinutes ?? 5) * 60))
                let act = try Activity.request(
                    attributes: attrs,
                    content: .init(state: st, staleDate: stale),
                    // 🔴 少了 .token 就拿不到 push token,伺服器永遠接不了手(卡片仍能開,
                    //    只是停在開卡當下那一班——那正是推播鏈之前的行為)。
                    pushType: .token)
                // pushTokenUpdates 是 AsyncSequence,token 會【多次】輪替,不是拿一次就結束。
                // key 由 JS 帶進來、原樣回傳:JS 靠它認出「這顆 token 屬於我現在這張卡」,
                // 換站很快時舊卡的 token 可能比新卡的先/後回來(RailLiveActivityPlugin 的同一條血路)。
                let key = call.getString("key") ?? ""
                self.tokenTask = Task { @MainActor in
                    for await data in act.pushTokenUpdates {
                        let hex = data.map { String(format: "%02x", $0) }.joined()
                        self.notifyListeners("waitPushToken", data: ["token": hex, "key": key],
                                             retainUntilConsumed: true)
                    }
                }
                call.resolve(["ok": true, "id": act.id, "endAt": endAt])
            } catch {
                // 🔴 localizedDescription 對 ActivityAuthorizationError 是一句籠統英文,
                //    分不出「背景不能開卡(visibility)」「使用者關了即時動態(denied)」
                //    「同時開太多張(targetMaximumExceeded)」——真機失敗時查不出原因。
                //    String(describing:) 印得出 case 名,NSError 的 domain/code 是後路;
                //    刻意不寫 case 比對,免得 SDK 改名就編不過。
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

    // 通行證資格同步給小工具(App Group)。widget extension 拿不到 RevenueCat 的資格,
    // 由 JS 在資格變動時(登入/購買/還原/每次 plusRefresh)推過來;鍵不存在＝未購買,
    // 所以「裝了 App 從沒開過」的人看到的是免費層行為——CTA 文案要把「開一次 App」講出來。
    @objc func setPlus(_ call: CAPPluginCall) {
        let active = call.getBool("active") ?? false
        UserDefaults(suiteName: "group.tw.railisland.app")?.set(active, forKey: "metro.plusActive")
        // 資格變了要讓已裝的小工具重畫,否則買完還要等下一次 timeline 才解鎖。
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["ok": true])
    }

    // JS 回前景對帳用:「結束」鈕(LiveActivityIntent)與鎖屏左滑清除都不經 JS,
    // 看板鈕的「追蹤這站/結束追蹤」文案要跟真實卡況對齊,只能來這裡問。
    @objc func status(_ call: CAPPluginCall) {
        guard #available(iOS 17.6, *) else { call.resolve(["active": false]); return }
        enqueue {
            // 🔴 一定要濾 activityState:`activities` 連【已結束/已關閉】的卡都還留在列表裡,
            //    照收就會回報「還在追蹤」⇒ 看板鈕變「結束追蹤」⇒ 使用者以為在重新追蹤,
            //    實際執行的是 metroWaitStop(),零提示、零新卡,要再點第二次才開得成。
            //    (真機回報「打開 App 重新追蹤有時也不會出現」的其中一條路徑。)
            //    .stale 必須算數:本卡刻意用 staleDate 把語意翻成「列車進站」,
            //    那段時間卡片還在螢幕上,當成沒卡就會把它悄悄收掉。
            let alive = Activity<MetroWaitAttributes>.activities.first {
                $0.activityState == .active || $0.activityState == .stale
            }
            guard let act = alive else {
                call.resolve(["active": false]); return
            }
            var data: [String: Any] = ["active": true, "sys": act.attributes.sys, "station": act.attributes.station]
            if let endAt = act.attributes.endAt { data["endAt"] = endAt }
            call.resolve(data)
        }
    }
}
