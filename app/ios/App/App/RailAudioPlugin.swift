import AVFoundation
import Capacitor
import Foundation
import MediaPlayer
import UIKit

// 原生背景音樂播放器（2026-08-10 build 38，使用者裁示「跟車時島位讓給列車動態」）。
// 為什麼不能繼續用 WKWebView 的 <audio>：網頁音訊一播放，WebKit 就替 App 註冊系統「正在播放」，
// 跟車 Live Activity 並存時動態島被仲裁成兩顆 minimal 小圓；而 App 層 AVAudioSession 的設定
// 會被 WebKit 自己的 session 蓋掉（build 37 mixWithOthers 實測無效）。只有音訊走原生層，
// App 才拿得到「要不要掛系統播放卡」的決定權。行為（分時）：
//   沒跟車：正常 .playback＋MPNowPlayingInfoCenter ⇒ 鎖定畫面播放卡（曲名＋軌島封面＋暫停/換首）
//   跟車中：mixWithOthers＋清空 NowPlaying ⇒ 音樂完全讓位，跟車獨占動態島與鎖定畫面
// 佇列與自動接下一首由原生持有：App 收進背景後 WKWebView 的 JS 可能被凍結，
// 「ended 之後由 JS 換下一首」在背景會斷炊（web 版維持 JS 路，見 index.html makeNativeMusicShim）。
@objc(RailAudioPlugin)
public final class RailAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailAudioPlugin"
    public let jsName = "RailAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAmbience", returnType: CAPPluginReturnPromise),
    ]

    // 全部狀態只在 main queue 讀寫（bridge 方法一律 DispatchQueue.main.async 進來）。
    private var player: AVPlayer?
    private var tracks: [(url: URL, title: String)] = []
    private var idx = 0
    private var volume: Float = 0.5
    private var followActive = false
    private var appliedFollow: Bool?
    private var commandsWired = false
    private var artwork: MPMediaItemArtwork?
    private var wasPlayingBeforeInterruption = false
    // 預抓下一首用。nextItemIndex 是它對應的曲序,-1 代表沒有預抓。
    private var nextItem: AVPlayerItem?
    private var nextItemIndex = -1
    // 目前這一首 item.status 的 KVO 句柄;換曲時先 invalidate,舊 item 的狀態不再回報。
    private var statusObs: NSKeyValueObservation?
    // 車聲圖層(2026-09-03):與配樂並行的第二條聲道——AVAudioPlayer 單檔無限循環,音量用
    // setVolume(_:fadeDuration:) 淡入淡出。不碰 NowPlaying(鎖定畫面仍只顯示配樂)、不改 session 模式;
    // 「此刻該不該有聲」(跟車中車在動/放空模式)由 JS 決定,這裡只管開、關、淡。
    private var amb: AVAudioPlayer?
    private var ambSrc = ""
    private var ambOn = false
    private var ambGen = 0
    private static let ambFade: TimeInterval = 1.2

    private var isPlaying: Bool { (player?.rate ?? 0) > 0 }

    override public func load() {
        // 跟車開始/結束由 RailLiveActivityPlugin 廣播；音樂端只管切模式。
        NotificationCenter.default.addObserver(forName: Notification.Name("railFollowChanged"), object: nil, queue: .main) { [weak self] note in
            guard let self else { return }
            self.followActive = (note.userInfo?["active"] as? Bool) ?? false
            self.applyMode()
        }
        // 來電等中斷：began 先暫停並告知 JS；ended 帶 shouldResume 才續播。
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self.wasPlayingBeforeInterruption = self.isPlaying
                if self.isPlaying { self.player?.pause(); self.pushState(playing: false); self.pushNowPlaying() }
                self.amb?.pause()   // 車聲跟著讓位;ended 且 shouldResume 時照 ambOn 續播
            } else if type == .ended {
                let opts = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
                if opts.contains(.shouldResume) {
                    if self.wasPlayingBeforeInterruption, self.player?.currentItem != nil { self.doResume() }
                    self.ambResume()
                }
            }
        }
    }

    // MARK: - 模式（跟車讓位 vs 正常播放卡）

    private func applySession(activate: Bool) {
        let s = AVAudioSession.sharedInstance()
        if followActive {
            try? s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        } else {
            try? s.setCategory(.playback, mode: .default)
        }
        // 只在真的要出聲時 activate：非混音的 activate 會切掉別家正在播的音訊，
        // 音樂沒在放就別無故打斷人家。
        if activate { try? s.setActive(true) }
    }

    private func applyMode() {
        guard appliedFollow != followActive else { return }
        appliedFollow = followActive
        applySession(activate: isPlaying)
        if followActive {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            wireCommands(false)
        } else {
            wireCommands(true)
            if player?.currentItem != nil { pushNowPlaying() }
        }
    }

    private func wireCommands(_ on: Bool) {
        let c = MPRemoteCommandCenter.shared()
        if on && !commandsWired {
            commandsWired = true
            c.playCommand.addTarget { [weak self] _ in self?.doResume(); return .success }
            c.pauseCommand.addTarget { [weak self] _ in self?.doPause(); return .success }
            c.nextTrackCommand.addTarget { [weak self] _ in
                guard let self, !self.tracks.isEmpty else { return .commandFailed }
                self.playIndex(self.idx + 1)
                return .success
            }
        }
        c.playCommand.isEnabled = on
        c.pauseCommand.isEnabled = on
        c.nextTrackCommand.isEnabled = on
        c.previousTrackCommand.isEnabled = false
        c.changePlaybackPositionCommand.isEnabled = false
    }

    private func pushNowPlaying() {
        guard !followActive else { return }
        guard idx < tracks.count else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: tracks[idx].title,
            MPMediaItemPropertyArtist: "軌島",
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let item = player?.currentItem {
            let d = item.duration.seconds
            if d.isFinite && d > 0 { info[MPMediaItemPropertyPlaybackDuration] = d }
            let t = item.currentTime().seconds
            if t.isFinite && t >= 0 { info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = t }
        }
        if artwork == nil,
           let p = Bundle.main.resourceURL?.appendingPathComponent("public/favicon-512.png"),
           let img = UIImage(contentsOfFile: p.path) {
            artwork = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
        }
        if let a = artwork { info[MPMediaItemPropertyArtwork] = a }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - 播放核心

    private func playIndex(_ i: Int) {
        guard !tracks.isEmpty else { return }
        idx = ((i % tracks.count) + tracks.count) % tracks.count
        let entry = tracks[idx]
        // 🔴 只有本地檔才驗存在:串流曲目的 url.path 是 /suno musics/x.mp3,在檔案系統上
        //    永遠不存在 ⇒ 不排除的話每一首串流曲都會被當成缺檔、直接吐 trackError 而從不播放。
        guard entry.url.isFileURL == false || FileManager.default.fileExists(atPath: entry.url.path) else {
            // 缺檔不自動跳下一首：與 web 版一致，交給 JS 的 error 處理（含整份清單都壞的停損）。
            notifyListeners("trackError", data: ["index": idx])
            return
        }
        if let old = player?.currentItem {
            NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: old)
            NotificationCenter.default.removeObserver(self, name: .AVPlayerItemFailedToPlayToEndTime, object: old)
        }
        statusObs?.invalidate()
        statusObs = nil
        // 預抓好的那顆用得上就直接用,省掉一次冷啟的網路往返(串流曲目在隧道裡差別最大)。
        let item: AVPlayerItem
        if nextItemIndex == idx, let preloaded = nextItem {
            item = preloaded
        } else {
            item = AVPlayerItem(url: entry.url)
        }
        nextItem = nil
        nextItemIndex = -1
        NotificationCenter.default.addObserver(self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: item)
        NotificationCenter.default.addObserver(self, selector: #selector(itemFailed(_:)), name: .AVPlayerItemFailedToPlayToEndTime, object: item)
        if player == nil { player = AVPlayer() }
        player?.replaceCurrentItem(with: item)
        // 🔴 串流曲目載入失敗(404、斷網、母站還沒部署)只反映在 item.status,沒有任何通知會來。
        //    2026-09-03 iOS 91 實測:正式站尚未上 _pass/ 曲目時每一首都靜靜地不播,JS 也收不到
        //    error ⇒ 「跳下一首、連錯三次退回內建曲」那套從沒被觸發,使用者看到的是「點了沒反應」。
        //    readyToPlay 才回報 ready(JS 據此才發 'playing'),failed 走與缺檔同一條 trackError。
        statusObs = item.observe(\.status, options: [.initial, .new]) { [weak self] observed, _ in
            DispatchQueue.main.async {
                guard let self, self.player?.currentItem === observed else { return }   // 已換曲的舊 item 不回報
                switch observed.status {
                case .readyToPlay: self.notifyListeners("ready", data: ["index": self.idx])
                case .failed: self.notifyListeners("trackError", data: ["index": self.idx])
                default: break
                }
            }
        }
        player?.volume = volume
        applySession(activate: true)
        player?.play()
        pushNowPlaying()
        notifyListeners("track", data: ["index": idx, "playing": true])
        preloadNext(after: idx)
        // 本地檔一秒內必已載入時長；補推一次讓播放卡出現正確的進度列。
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.pushNowPlaying() }
    }

    // 預抓下一首:只建 AVPlayerItem 並給它一段前向緩衝,AVFoundation 就會自己開始拉資料。
    // 不碰 player、不 replaceCurrentItem ⇒ 完全不影響正在播的那一首。
    // 🔴 目的是【隧道裡換得了歌】:原本每次換曲都是「當下才建 item」＝一次冷啟網路請求,
    //    收訊斷掉的那幾秒剛好換曲就會靜掉。本地檔沒有這個問題,所以只對串流曲目預抓。
    private func preloadNext(after index: Int) {
        guard !tracks.isEmpty else { nextItem = nil; nextItemIndex = -1; return }
        let n = ((index + 1) % tracks.count + tracks.count) % tracks.count
        let url = tracks[n].url
        guard !url.isFileURL else { nextItem = nil; nextItemIndex = -1; return }
        if nextItemIndex == n, nextItem != nil { return }   // 同一首已經抓過就不重建
        let item = AVPlayerItem(url: url)
        item.preferredForwardBufferDuration = 10
        nextItem = item
        nextItemIndex = n
    }

    // 播到一半才斷(隧道、伺服器中途掛掉):AVFoundation 不會再改 status,只發這一則通知。
    @objc private func itemFailed(_ note: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.notifyListeners("trackError", data: ["index": self.idx])
        }
    }

    @objc private func itemEnded(_ note: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.tracks.isEmpty else { return }
            self.playIndex(self.idx + 1)   // 自動接下一首（原生持有，背景也走得動）
        }
    }

    private func doPause() {
        player?.pause()
        pushState(playing: false)
        pushNowPlaying()
    }

    private func doResume() {
        guard player?.currentItem != nil else { return }
        applySession(activate: true)
        player?.play()
        pushState(playing: true)
        pushNowPlaying()
    }

    private func pushState(playing: Bool) {
        notifyListeners("state", data: ["playing": playing, "index": idx])
    }

    // MARK: - 車聲圖層

    private func ambApply(on: Bool, src: String, gain: Float) {
        ambGen += 1
        let gen = ambGen
        if on {
            if amb == nil || ambSrc != src {
                amb?.stop(); amb = nil
                guard let base = Bundle.main.resourceURL else { return }
                let url = base.appendingPathComponent("public").appendingPathComponent(src)
                guard let p = try? AVAudioPlayer(contentsOf: url) else {
                    notifyListeners("ambienceError", data: ["src": src])
                    return
                }
                p.numberOfLoops = -1
                p.volume = 0
                p.prepareToPlay()
                amb = p
                ambSrc = src
            }
            ambOn = true
            applySession(activate: true)
            guard let p = amb else { return }
            if !p.isPlaying { p.volume = 0; p.play() }
            p.setVolume(max(0, min(1, gain)), fadeDuration: Self.ambFade)
        } else {
            ambOn = false
            guard let p = amb, p.isPlaying else { return }
            p.setVolume(0, fadeDuration: Self.ambFade)
            // 淡出結束才 pause;期間若又被打開(gen 變了或 ambOn 回真)就不 pause。
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.ambFade + 0.1) { [weak self] in
                guard let self, self.ambGen == gen, !self.ambOn else { return }
                self.amb?.pause()
            }
        }
    }

    private func ambResume() {
        guard ambOn, let p = amb, !p.isPlaying else { return }
        p.play()
    }

    // MARK: - bridge 方法

    @objc func setQueue(_ call: CAPPluginCall) {
        let list = (call.getArray("tracks") ?? []).compactMap { $0 as? [String: Any] }
        DispatchQueue.main.async {
            guard let base = Bundle.main.resourceURL else { call.resolve(["ok": false]); return }
            // 逐項對齊 JS 清單（不因缺檔壓縮索引，缺檔在 playIndex 時回報），src 是 www 相對路徑。
            self.tracks = list.compactMap { t in
                guard let rel = t["src"] as? String else { return nil }
                let title = (t["title"] as? String) ?? ""
                // 🔴 2026-08-27:曲庫 57 首只有 12 首打包進 App,其餘從正式站串流 ⇒ src 有兩種形態。
                //    絕對網址【必須】走 URL(string:) 直接建;交給 appendingPathComponent 會把整串
                //    當成一個檔名接在 bundle 後面,變成 .../public/https:/railisland.tw/... 而永遠播不出來。
                if rel.hasPrefix("https://") || rel.hasPrefix("http://") {
                    guard let remote = URL(string: rel) else { return nil }
                    return (remote, title)
                }
                return (base.appendingPathComponent("public").appendingPathComponent(rel), title)
            }
            // 佇列換掉了,舊的預抓對應到的曲序已經不是同一首,一律作廢。
            self.nextItem = nil
            self.nextItemIndex = -1
            call.resolve(["ok": true, "count": self.tracks.count])
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        let i = call.getInt("index")
        DispatchQueue.main.async {
            self.playIndex(i ?? self.idx)
            call.resolve(["ok": true])
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.doResume(); call.resolve(["ok": true]) }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.doPause(); call.resolve(["ok": true]) }
    }

    @objc func setAmbience(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        let src = call.getString("src") ?? ""
        let gain = Float(call.getDouble("gain") ?? 0.5)
        DispatchQueue.main.async {
            self.ambApply(on: on, src: src, gain: gain)
            call.resolve(["ok": true])
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let v = Float(call.getDouble("v") ?? 0.5)
        DispatchQueue.main.async {
            self.volume = max(0, min(1, v))
            self.player?.volume = self.volume
            call.resolve(["ok": true])
        }
    }
}
