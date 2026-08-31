// 把 iOS 專案切到某一種發行模式，然後一路建置到發行閘門通過。
//
//   node app/scripts/set-release-mode.mjs hotfix    → 1.0.1 (build 12)，無音樂
//   node app/scripts/set-release-mode.mjs feature   → 正式發行模式，Sandbox 資格關閉
//   node app/scripts/set-release-mode.mjs testflight → TestFlight 測試模式，Sandbox 購買可完整解鎖
//
// build 號為什麼從 11 跳到 12：11 已經被一顆「忘了跑 patch-archive-os、帶著 beta macOS
// 標記」的 archive 上傳掉了。build 號在同一個版本內不可重複，所以往前跳一號。
//
// 為什麼要有這支：兩個模式的差別是「版號」＋「音樂旗標」兩件事，而它們分在兩個地方
// （project.pbxproj 與環境變數）。手動做最容易發生的失誤是版號改了、旗標忘了改——
// 產出一顆版號寫著 hotfix、裡面卻有 154MB 音樂而且授權證據還沒補齊的 IPA。
// 這支把「哪個模式配哪組設定」變成單一事實來源，改完直接跑到閘門綠燈才收工。
//
// 做不到的事：簽章與 Archive。本機只有 Apple Development 憑證，沒有 Distribution，
// 必須在 Xcode 裡 Product ▸ Archive（Xcode 會自動申請 Distribution 憑證）。
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pbxproj = join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj');

// 版號為什麼不是使用者口中的「1.0」與「1.01」：
// 1.0 已經是 Ready for Sale，Apple 不接受用同一個 CFBundleShortVersionString 送更新，
// 版本字串一定要遞增。所以「取代線上那顆的修正版」＝ 1.0.1（沿用既有的 1.0.1 版本紀錄，
// 只是改挑新的 build，不發行含 XSS 的 build 9），「後續功能版」＝ 1.0.2。
const MODES = {
  hotfix: {
    marketing: '1.0.1', build: '12', music: false, metroCore: false,
    why: '隱私＋安全修正版：與線上 build 8 相同的功能範圍（本來就沒有音樂），只多修正。差異最小＝審查風險最小。',
  },
  // 2026-07-30 更新：使用者裁示這一輪走 1.3.0 (15)。
  //
  // ⚠️ 為什麼跳過 1.1.0／1.0.3：線上那顆的版本字串是 `1.02`（不是 1.0.2——lookup API 與
  // App Store 公開頁兩個獨立來源都這樣回，而 git 歷史裡 `MARKETING_VERSION = 1.02;` 出現 0 次，
  // 那顆是在 Xcode 手改或未 commit 的狀態下打出去的）。Apple 逐段比整數 ⇒ `1.02` = [1,2]，
  // 所以 1.1.0=[1,1,0] 與 1.0.3=[1,0,3] 都比線上「小」，ASC 建版本項目時會被擋。
  // 1.3.0 在「[1,2]」與「[1,0,2]」兩種解析下都比線上大，才是安全值。
  // 下次要動這張表：先用 lookup API 查線上實際字串，不要相信筆記——
  //   curl -s 'https://itunes.apple.com/lookup?bundleId=tw.railisland.app&country=tw' | grep -o '"version":"[^"]*"'
  // build 跳到 15 是為了避開「1.0.3 (14) 那顆已作廢的 archive 是否已被 ASC 吃掉」這個
  // 不確定性（那顆的刪帳號少了 device actor，不可送審）。下面那道單調遞增閘門只擋
  // 「往回推」，擋不住「撞到已用過的號」。
  // 2026-07-31：build 15 於 07-30 15:0x 已上傳 ASC ⇒ 那個號燒掉了，這一輪從 16 起。
  // pbxproj 早在 `45ab9aa` 就推到 16（小工具的重算閘門只吃 build 號，改 Swift 不推格
  // 會讓修正在既有裝置上看起來沒生效），這裡是把表補齊，否則單調遞增閘門會擋下整個 build。
  // 2026-08-01：build 16（v0731b）使用者已上傳 ASC ⇒ 那個號燒掉了，這一輪從 17 起。
  // 這一輪是為了 Esri 衛星改成「時段計費」而緊急重出的——衛星圖磚用量的大頭在 App 端，
  // 只改網站吃不到那一塊，不重出 build 省不下來。
  // （原文寫了我方各端用量佔比的實測數字，比照 `793c142` 移出公開 repo：機制留著、數字不留。）
  // lookup API 08-01 實查線上仍是 `1.02` ⇒ `1.3.0` 仍安全（沒有改 marketing 的理由）。
  // 2026-08-04：走 1.3.1 (18)。線上 lookup API 實查回 `1.3.0`（08-02 上架，就是 build 17 那顆），
  // 建新版本項目必須大於它 ⇒ marketing 進到 1.3.1；build 17 已上傳燒掉 ⇒ 從 18 起。
  // 2026-08-04 下午：1.3.1 (18)（班表自救版）已由另一個 session 出包、使用者已在上傳 ASC
  // ⇒ 那一組號燒掉了。這一輪是「北捷帳本後端上線之後的前端版」，用途是 TestFlight 試用、
  // 不是送審。build 從 19 起；marketing 進到 1.3.2 而不是沿用 1.3.1——1.3.1 那個版本項目
  // 正在送審中，同一個版本項目底下再多一顆 build，會讓「哪一顆該送審」變成可誤按的選擇，
  // 而這顆的送審文件（What's New／審查備註）並沒有對齊北捷的內容。
  // 2026-08-06：build 20、21、22 都已上傳；23 是軌島通行證第一顆正式送審包。
  // 24 改以 1.4.0 承接這次帳號、通行證、Live Activity、雲端同步與小工具的大改版；
  // 25 再補進目的站依賴值稍晚送到時，選單短暫載入後自行收起的真機修正。仍必須走 feature 模式，
  // 讓 assertPlusSandboxOff 證明 Sandbox 測試通道與 build 標記都已移除。
  // 2026-08-07 深夜：1.4.0 已於今晨上架（lookup API 實查 version=1.4.0）。這一輪收本日
  // main（24e9c2c／網頁 v0807a）的三批修正：高鐵班表改每日自動連網更新（App 打
  // railisland.tw 的 /api/thsr-schedule，CORS 已實測放行 capacitor origin；抓不到自動退回
  // 內建快照）、台鐵 14 天班表重抓（涵蓋到 08-20）、北捷逐班綁定後端影子期（App 吃
  // /api/trtc-live 自動受益，前端不切換）。build 25 是否已上傳 ASC 未查證，直接跳 26
  // 避開不確定性；marketing 進 1.4.1（1.4.0 已上架，建新版本項目必須大於它）。
  // foundingLaunchAt（2026-08-08T12:00+08:00）原封沿用，不因這顆 build 改動。
  // 2026-08-07 深夜：build 26 Transporter 上傳被拒 -19232「套件版本必須高於先前上傳的版本：26」
  // ＝26 已被用掉（本表註解只記到 25，「撞已用號」閘門結構上擋不住，ASC 實況才是權威）；
  // 使用者指示改 27。
  // 2026-08-08 凌晨：27 上傳撞 ITMS-90683——Capacitor 定位 plugin 的 binary 引用 Always 授權 API，
  // Info.plist 卻只有 NSLocationWhenInUseUsageDescription；已補
  // NSLocationAlwaysAndWhenInUseUsageDescription（照實寫「不會背景定位」），28 重出。
  // 2026-08-08：28 的 IPA 已出（凌晨那顆），是否已上傳 ASC 未查證 ⇒ 直接跳 29 避開不確定性
  // （撞已用號閘門結構上擋不住，ASC／Transporter 實況才是權威，26 與 27 都是這樣被打回來的）。
  // lookup API 08-08 實查線上仍是 1.4.0 ⇒ marketing 維持 1.4.1（比線上大，安全）。
  // 這一輪的內容：跟車即時動態改由後端推播（鎖屏／動態島會自己換下一站，不必開著 App），
  // 外加併入的高鐵自由座車廂、最愛面板「我的車・準點」、探索面板「準點排行」。
  // 2026-08-08 深夜：29 的 IPA 已出、是否已被 ASC 吃掉未查證，而本輪把鎖屏卡片本身也一起
  // 強化了（停靠中徽章、往下一站的進度條、車種與代表色、上一站／終點站），內容與 29 不同
  // ⇒ 進 build 30。lookup API 08-08 實查線上仍是 1.4.0 ⇒ marketing 維持 1.4.1（比線上大）。
  // 🔴 30 這顆已先以 development 簽章裝進實機測試過（archive 未跑 patch-archive-os 才裝得動），
  //    實機一看就發現動態島展開的最後一列被【圓角】切掉（「基隆」左半、「往 花蓮」下緣）。
  //    修法＝bottom 區塊補水平內距＋下緣間距。改的是原生程式碼，網頁 BUILD 字串不會變動
  //    ⇒ 唯一能分辨「手機上跑的是修好那顆嗎」的只有 build 號 ⇒ 進 31，30 留給那顆有裁字的。
  // 2026-08-08 深夜:31 已裝機、使用者確認過動態島圓角修好了,但它【不含】小工具「共站起站
  //    點目的站一點就關掉」的修正——那顆修正 8/7 就寫好了,卻只 commit 在 feat/railboard-widget,
  //    main 與 feat/la-push 都沒有 ⇒ 27／28／29／31 全部照舊帶著 `.empty` 出貨(iOS 收到
  //    .empty 就把選單直接收掉)。修正現已進 feat/la-push(`69a65a5`)與 main(`ff408ae`),
  //    ⇒ 進 build 32,而且必須從含 `69a65a5` 的 tip 出,否則這個修正又會漏掉第五顆 build。
  //    marketing 維持 1.4.1(線上仍是 1.4.0)。
  // 2026-08-10：build 33＝背景音樂續播（Info.plist 宣告 UIBackgroundModes audio＋錄影混音閘門
  //    加 RECORDING_ENABLED＋背景化 1.5 秒窗補播），基底改用含 v0809a 速度上界修正的
  //    preview/speed-ceiling-0809 一線（32 從 9c6718c 出、沒有那顆修正）。
  // 2026-08-10 之二：build 34＝跟車 LA minimal 小圓改顯示下一站（與背景音樂並存被系統縮到
  //    最小時，車次號沒資訊量——使用者實測「下一站直接看不到了」）；殺 App 卡片殘留裁示維持現狀。
  // 2026-08-10 之三：build 35＝minimal 小圓改兩行「站名＋到站倒數」（使用者裁示「車站倒數
  //    才是重點」）；音樂圓外觀是系統畫的動不了、鎖屏完全合併做不到，皆已對使用者說明。
  // 2026-08-10 之四：build 36＝MediaSession 曲目資訊——鎖定畫面/控制中心封面全用軌島 icon
  //    （favicon-512/192）、曲名=檔名去副檔名；只設 metadata 不接 action handler。
  // 2026-08-10 之五：build 37＝音樂隱形化 spike（AppDelegate 全域 mixWithOthers）——實測失敗，
  //    WKWebView 播 <audio> 時 WebKit 用自己的 session 蓋掉 App 層設定，音樂圓仍在。
  // 2026-08-10 之六：build 38＝音樂改走原生 AVPlayer（RailAudioPlugin），分時讓位：
  //    跟車中 mixWithOthers＋清 NowPlaying（跟車獨占動態島），沒跟車正常播放卡
  //    （曲名＋軌島封面＋暫停/換首）；佇列與自動接下一首在原生層（背景 JS 凍結也走得動）；
  //    App 內音量滑桿隨之修復（AVPlayer.volume 可控，music-volume-unavailable 解除）。
  // 2026-08-10 之七：build 39＝38 的一行修復——RailAudioPlugin 沒在 RailBridgeViewController
  //    .capacitorDidLoad() 註冊（App 內自製 plugin 不自動發現），音樂全滅；補 registerPluginInstance。
  // 2026-08-10 之八：build 40/41＝MUSDIAG 臨時診斷顆（不上傳）。41 實測結論：原生鏈全通
  //    （setQueue29→play rate=1.0→ramp→喇叭出聲），按鈕互動正常；「39 仍壞」極可能是
  //    裝機時舊行程(38)未終止、使用者測到的是舊版。42＝拆診斷的乾淨顆。
  // 2026-08-11：build 43＝**1.4.2**，不是 1.4.1 的又一顆。1.4.1(32) 送審中(等待審查)、
  //    已綁訂閱群組，刻意不去動它——移除重送會把排隊位置歸零，而創始期(8/10 12:00 起 30 天)
  //    的窗不會因此延後。43 是「1.4.1 一過就能立刻送」的後手，內容＝la-push 的音樂/動態島
  //    ＋origin/main 的批次A(轉乘提示、附近車站互斥、B19 讓位、v0809a 速度上界)
  //    ＋App 更新提示與評分。
  //    🔴 marketing 必須推到 1.4.2：ASC 只讓「短版本字串等於版本號」的 build 被選進該版本，
  //    掛 1.4.1 的 build 之後選不進 1.4.2 的版本紀錄。
  // 2026-08-11 之二：build 44＝43 的內容再加上橫式版面修正。43 使用者已上傳 ASC ⇒ 那個號燒掉了。
  //    橫式那批是真使用者回報的缺陷（橫放跟車時列車不在畫面裡、資訊卡互相阻擋），修完又收了
  //    實機回報的三件（「回到列車」撞「隨機跟隨」、停靠站名牌吃掉整個寬度、動態島擋住文字），
  //    正式站已上（v0811c）；App 這一顆是同一批的原生版，網頁 BUILD 進 v0811d（合併後的內容
  //    與 43 的 v0811a、正式站的 v0811c 都不同，不共用號）。marketing 維持 1.4.2——ASC 上
  //    1.4.2 的版本紀錄還沒送出，換掉底下的 build 即可，不必再推版本字串。
  // 2026-08-14：1.4.3 (50) 上傳時 App Store Connect 明確回覆該 train 已關閉，
  //    因此本輪改開 1.4.4，build 續增到 51；不可再產出任何 1.4.3 新 build。
  //    內容＝48 的旋轉尺寸過期自癒（P0）再加上北捷官方即時名冊（origin/main dab284a 併入）。
  // 2026-08-15：**1.4.4 已於 08-14 21:36Z 上架**（lookup API 實查，不是靠筆記）⇒ 那條 train
  //    已關閉，本輪必須開 1.4.5。build 從 58 起：51 是上架的那顆，52–57 是捷運小工具那批
  //    真機回饋六輪燒掉的本機測試號（未上傳，但號不重用——原生改動不會動到網頁 BUILD 字串，
  //    build 號是實機上分辨「跑的是哪一顆」的唯一依據，見 [[app-ios-shell-progress]]）。
  // 2026-08-16：build 推到 62。60＝01:29 出的那顆（桌面 ipa，內容缺本輪的徽章閘門，不傳）；
  //    61＝並行 session 在 `feat/metro-widget` 推的號（小工具通行證閘門兩個洞的修正，
  //    58a08bf），那條線的內容已整批併進本樹 ⇒ 62 是「61 的內容＋北捷分支鎖與徽章閘門」。
  //    號一律不重用（原生改動不會動到網頁 BUILD 字串，build 號是實機上分辨版本的唯一依據）。
  // 2026-08-16 之二：**1.4.5 已於 2026-08-15T20:37:42Z（台北 08-16 04:37）上架** ⇒ 那條 train
  //    關閉，本輪必須開 1.4.6，build 續增到 63（62 已出過 ipa，號不重用）。
  //    🔴 這件事我第一次查錯了：`curl 'itunes.apple.com/lookup?...'` **裸 URL 會吃到 CDN 快取**，
  //    09:00 查回的是舊的 `1.4.4`，害我先出了一顆掛 1.4.5 的 build 62。
  //    ⇒ 查線上版本一律 `curl -H 'Cache-Control: no-cache' ...&t=$(date +%s)`，
  //    並看 `currentVersionReleaseDate` 對時間，不要只看 `version` 欄位。
  // 2026-08-17：1.4.6 (63) 已於 08-16 17:16Z 上架（lookup API 帶 no-cache 實查回 1.4.6）
  // ⇒ marketing 進到 1.4.7、build 從 64 起。這一顆的載貨是小工具版面改版
  // （發車看板撤軌脊改六欄、方向三角、新增 Large、大字好讀版）＋捷運小工具換站修法，
  // 並把 index.html 併到 main 現況（08-17 那 20 顆，含藍線加班車看板修正——App 吃 bundle，
  // 線上修好不算）。
  // 2026-08-19：1.4.7 (64) 已上傳(小工具改版線),使用者裁示下一顆開 1.4.8、build 65。
  // 這一顆是三線合一:App 街道底圖換 OpenFreeMap(含遠端來源開關與本機自動退場,見
  // docs/superpowers/plans/2026-08-18-App底圖換OSM與退路設計.md)、08-18 北捷位置模型
  // (build/trtc-y-device,旗標開回官方即時)、feat/widget-redesign 現 tip。刻意不含 69f9aa0。
  // 2026-08-19 之二：1.4.8 (65)(66)(67) 皆已上傳 ⇒ 這一顆開 build 68。載貨只有一件：
  // 併入 origin/main fb1de23——官方倒數看得到的車一律畫出來(CarWeight 逐車清單會整趟漏車、
  // 也會漏填終點站,兩種都會讓車在地圖上整趟不存在)。網站同批已上正式站(BUILD v0819e)。
  // 2026-08-21：1.4.8 (68) 已是正式版，下一顆開 1.4.9、build 69。這顆把網站已驗收的
  // v0821b Private Metro Core 一併打入 App，並由 prepare-web 明確注入啟用旗標；網站與 App
  // 因此共用同一份北捷／高捷列車身分、軌跡、到站事件與降級規則。
  // 2026-08-21 之二：69 已上傳 App Store Connect，定位改成前景持續追蹤且 Android 恢復
  // 精確位置後必須另出 build 70。這顆同時包含 v0821c 共站辨線／跟隨寬限／斷訊判斷修正，
  // 不得沿用已燒掉的 69；marketing 維持尚未關閉的 1.4.9。
  // 2026-08-22：73 為等車卡合流顆（小工具直接開卡＋北捷「再下一班・約 N 分」），只裝過
  // 真機沒上傳，但裝機當天就抓到等車卡把「約 N 分」推導列畫成秒級倒數的精度缺陷——
  // 照「內容與已裝機顆不同就換號」慣例，修正後直接開 74，70–73 全部作廢不得上傳。
  // 2026-08-22 之二：74 裝機後使用者抓到開機彈的「更新了什麼」還是 1.4.8 的文——那卡片
  // 抓的是 iTunes lookup 的【線上版】releaseNotes，剛裝的版比線上新時必然彈到舊文。
  // 修法＝把本模式的 why 經 RAIL_WHATS_NEW 注入 bundle 當本版內建文案（送審文字本來
  // 每版都要寫 ⇒ 零額外維護），verify-release 加 gate 擋「版號升了 why 沒改」。開 75。
  // 2026-08-23：76＝75 的全部載貨＋台鐵等站卡。
  // 🔴 why 為什麼要把 75 的內容一起寫進去：**75 從來沒上架過**（線上仍是 1.4.8，75 那顆
  //    archive 還躺在等使用者 Organizer 上傳）。76 一旦出，使用者會傳 76 而不是 75 ⇒
  //    1.4.9 這個版本項目的 What's New 必須涵蓋「相對 1.4.8 的全部差異」，不是只寫這一批。
  //    判準照 [[app-shipping-artifacts]]：逐項問「使用者是不是非裝這一版才拿得到」。
  // ⚠️ 順帶記一個閘門盲點：verify-release 只檢查 why 裡有沒有**行銷版號**，
  //    所以「marketing 不動、只升 build 號」時它擋不住忘改 why（這一輪正是這種形狀）。
  // 2026-08-23 之二：**1.4.9 train 已關閉** —— lookup（帶 no-cache）實查線上就是 1.4.9、
  //    currentVersionReleaseDate `2026-08-22T23:49:22Z`，也就是 75 已上架（上一輪筆記寫的
  //    「75 從來沒上架過」是錯的，使用者當場更正）。照 08-11 與 08-14 兩條記錄：ASC 只讓
  //    「短版本字串等於版本號」的 build 被選進該版本，且已上架的 train 會被明確回絕
  //    ⇒ 掛 1.4.9 的 76／77 兩顆 archive **一律不得上傳**，本輪改開 1.4.10、build 續增到 78。
  //    版號比較全鏈已對 index.html 的真函式實跑過（cmpVer 逐段數值比較，1.4.10 > 1.4.9 正確；
  //    強更閘門與「更新了什麼」彈窗在 1.4.10 都判對），不是字串比較所以 10 不會被當成 1。
  // 🔴 why 的涵蓋範圍也跟著變窄：線上 1.4.9 的 releaseNotes 已經寫過小工具開等車卡、
  //    「再下一班・約 N 分」、捷運動畫統一、共站辨識、定位前景更新 ⇒ 那些使用者**已經拿到了**。
  //    1.4.10 只需寫使用者非裝這一版拿不到的兩件：台鐵等站卡（76 的載貨，從沒上架）
  //    與地圖縮放／拖曳跨層同步修法（77 的載貨）。判準照 [[app-shipping-artifacts]]。
  // 2026-08-23 之三：**build 號從 78 跳到 79**。78 那顆 archive 已經在磁碟上（`軌島-1.4.10-78`），
  //    但它是**補回遺失內容之前**打的；同一個 build 號配兩份不同載貨，正是這整串事故的病根
  //    （身分不明確），所以不重用、直接進位。78 連同 76／77 一併作廢，不得上傳。
  // 2026-08-27：走 1.5.0 (80)。
  //   marketing 從 1.4.10 進到 1.5.0——lookup API 帶 no-cache 實查線上就是 `1.4.10`
  //   （currentVersionReleaseDate 2026-08-23T14:20:52Z）。seq 比較下 [1,5,0] > [1,4,10]，
  //   單調遞增閘門的 mDelta > 0 ⇒ build 那關直接跳過，與 Apple「同一版本串內遞增」一致。
  //   build 從 79 接到 80，**不是**接 904。904／903 那組是「裝到使用者自己 iPhone 上」的
  //   本機測試號（900 系列是刻意跟 ASC 那條線分開的），從沒上傳過 ASC；ASC 上最高的是
  //   1.4.10 (79)。把 900 系列拿去送審會讓「下一顆該是幾號」永久失去參考點。
  //   ⚠️ 這一顆是版面重整那條線（`build/redesign-901`，領先 origin/main 150+ 顆）第一次送審，
  //   出 build 前已把 origin/main 併回來（漏掉的是桃捷原民精裝套票冊那顆）。
  //   ⚠️ 音樂曲庫同批換成 57 首、只內建 12 首其餘串流；**那 45 首要 railisland.tw 上有檔才播得出來**，
  //   正式站已於 2026-08-27 先行部署並逐一驗過 57/57 回 200。網站與 App 的出貨順序不可對調。
  // 1.5.1 (81)：1.5.0 (80) 已上架（v0827e）。這一顆的基底是多語出貨線＋今天的網站修正，
  //   why 只寫 1.5.0 之後的差異，逐條對應 index.html 的 8/28–8/29 更新紀錄，不重述 1.5.0 講過的。
  //   ⚠️ 1.5.0 的商店文案寫了三語，但那顆 build 實際漏帶英日字典（translation-polish 修的就是它），
  //   所以「三語真的切得動了」對從 1.5.0 升上來的人是真的新東西，要寫在第一段。
  feature: {
    // 2026-08-30：線上 1.5.1 已於 08-29 23:15 發佈（lookup no-cache 實查）⇒ 該 train 已關，
    // 83 必須掛新的行銷版號 1.5.2（1.4.9 那輪的 76/77 就是掛了已上架版本而作廢）。
    // 2026-08-31：909 → 910。909 那個號已經在 pbxproj 上釘過、載貨與這一顆不同，
    //   規則四「一個 build 號只對應一份載貨」⇒ 不重用、直接進位（跳號不花錢，重用會查不出來）。
    //   910 的載貨＝909 ＋ 使用者 08-31 回報的四件：
    //     ① 衛星縮放閃底圖（真修：底下常駐兩層衛星影像，8/30 那次只調顏色是治標）
    //     ② 車站看板欄位對齊，特大字級把「即將進站」精簡成「即將」
    //     ③ 臺北-環島併回臺北
    //     ④ 桌面小工具的發車看板標出北上／南下（併自 feat/widget-pass-default）
    //   why 把 ① 那一段改寫成「真的修好了」，其餘三件放在前段——舊的那段講的是 8/30 的
    //   治標做法，留著會跟這一顆的行為互相矛盾。
    // 2026-08-31：910 → 911。910 已經裝進使用者手機、載貨不同 ⇒ 規則四不重用。
    //   911 的載貨＝910 ＋ 對「更新說明 vs 更新紀錄」逐條核對後補上的東西：
    //   (a) why/whyEn/whyJa 各補三段——火車站看板分方向（本輪最大的功能改動，原本整段漏了）、
    //       搭車時的時鐘、英文與日文版的頂列。satfallback 刻意不補：它已被本輪的
    //       satunderlay 取代，寫進去會跟這一顆的行為互相矛盾。
    //   (b) index.html 更新紀錄補 data-cl="branchdepart"（新北投與小碧潭）——
    //       原本只有 why 有這一段、更新紀錄兩層都沒有，違反「更新紀錄必加」。
    //   核對方法：兩版 index.html 的 data-cl 集合差集（基準 eee8731 = 1.5.1(82) / v0830a），
    //       新增 10、消失 0、改寫 1；再拿那 10 條逐條對 why 的段落，對不上的就是缺口。
    marketing: '1.5.2', build: '911', music: true, metroCore: true,
    why: '軌島 1.5.2\n\n衛星影像的底色\n衛星影像模式下放大或縮小時，畫面不會再閃一下底色。8/30 那次只是把墊在底下的顏色調得接近衛星影像，治標沒治本；這次改成底下永遠墊著一層真的衛星影像，開啟衛星時就把全台先抓好，縮放時露出來的是影像，不是色塊。\n\n車站看板的欄位對齊\n倒數變成「即將進站」的那幾列，原本會把時刻與擁擠度往左推，整張看板看起來歪歪的。現在倒數與時刻兩欄會量出整張板最寬的那一列、全板同寬，每一列都對齊。字級調到特大時，倒數會精簡成「即將」，才不會把車次與時刻擠掉。\n\n台北車站不再多一顆\n環島之星繞完一圈回到台北時，官方在班表裡用另一個站碼記那一次到達，於是地圖上是兩顆點、車站看板也是兩張。現在併成一顆，手機桌面小工具的車站清單也一起併。\n\n桌面小工具標出北上南下\n台鐵與高鐵發車看板的每一列都會標出方向。iPhone 版本來就有方向三角，但灰得像裝飾；現在放大並換成台鐵新版車站標示的顏色：北上藍、南下綠。方向看的是「離開這站往哪走」，所以像臺中往大甲這種先北上到竹南再走海線的繞行車不會指反。\n\n火車站看板分方向\n台鐵與高鐵的車站看板改成南下、北上各自成區，不再混成一長串照時間排。竹南、彰化這種山線海線分家的站，同一個方向會再拆成山線與海線；二水、三貂嶺、新竹這種有支線的站，支線自成一區，照官方月台的說法寫「往車埕」「往菁桐」「往內灣」——支線的南北距離常常只有幾公里，講南下北上沒有意義。每一區各給三班，冷門方向不會再被熱門方向整個擠掉。方向顏色和桌面小工具一樣，是台鐵新版車站標示的北上藍、南下綠。阿里山林鐵的車站看板同步套用。\n\n搭車時的時鐘\n按下「我上車了」之後，再去點一班還沒發車的車，時鐘不會再被撥到那班車的發車前。原本會整趟停在那個假的時間，讓地圖上另一班車剛好跟著你走，看起來像自己搭的車被標成別的車次。時鐘真的不在現在時，跟車卡上會標「非即時」，點一下就回到現在；手機點左上角的時鐘也多了一顆「回到現在」。\n\n通行證與捷運小工具\n訂閱通行證後，桌面的捷運小工具立刻就能放多站、也能自動選最近的站，不必等下一次同步或按恢復購買。帳號登出或訂閱結束時，小工具也會同步收回。\n\n新北投與小碧潭\n這兩條兩站接駁支線的車，發車之後補上區間行車秒，地圖上才畫得動。\n\n英文與日文版的頂列\n英文版在 360 寬的手機上，頂列右邊的「捷運」分組切換鈕整顆在畫面外，也沒有地方可以捲過去。分頁列英文要 248px、日文 234px，中文只要 190px，而左上角的軌島牌原本一寸不讓，被擠掉的就是按鈕。現在改成牌讓給按鈕：先保住起訖站名，標題最後，裝不下收成省略號。日文在有公告時的同樣情形也一併修好。\n\n放空模式與背景音樂\n放空模式下鏡頭完全交給程式：地圖不會再被手指拉歪、也不會被捏到縮回不來，跟車與群車兩種視角一樣；點列車仍然可以接手跟隨。「離開放空」鈕不再淡到看不見，也不會落進系統手勢區按不到。背景音樂的開關不會再顯示成跟實際相反的狀態。',
    whyEn: 'Rail Island 1.5.2\n\nSatellite basemap backdrop\nZooming in satellite mode no longer flashes a flat colour. The 30 August build only tuned that backdrop colour to look like satellite imagery, which treated the symptom; now there is always a real satellite layer underneath, prefetched for the whole of Taiwan when you switch satellite on, so what shows through while you zoom is imagery rather than a block of colour.\n\nStation board columns\nRows whose countdown reads "Arriving" used to push the time and the crowding bars to the left, leaving the whole board looking crooked. The countdown and time columns are now measured against the widest row on that board and share one width, so every row lines up. At the extra-large text size the countdown shortens to "Due" so it cannot squeeze out the train number and the time.\n\nOne Taipei Main Station, not two\nWhen the Formosa Express finishes its loop back into Taipei, the official timetable records that arrival under a second station code — so the map showed two dots and the station board two panels. They are now merged into one, and the station list in the home screen widgets is merged the same way.\n\nNorthbound and southbound in home screen widgets\nEvery row of the TRA and THSR departure widgets now shows its direction. iPhone widgets already had the arrow, but it was grey enough to read as decoration; it is now larger and uses the colours from TRA\'s new station signage: blue for northbound, green for southbound. The direction is "which way this train leaves this station", so a train that runs north to Zhunan before turning down the coast line is not pointed the wrong way.\n\nStation boards split by direction\nTRA and THSR station boards now separate southbound from northbound instead of listing everything in one run of departure times. Where the mountain and coast lines part company — Zhunan, Changhua — each direction splits again into mountain and coast. At stations with a branch line — Ershui, Sandiaoling, Hsinchu — the branch gets its own group, labelled the way the platform signs label it ("to Checheng", "to Jingtong", "to Neiwan"); a branch often runs only a few kilometres north to south, so calling it northbound or southbound says nothing. Each group shows three departures, so a quiet direction is not pushed out by a busy one. The direction colours match the widgets: blue for northbound, green for southbound. The Alishan Forest Railway boards work the same way.\n\nThe clock while you are on board\nAfter you tap "I\'m on board", tapping a train that has not departed yet no longer winds the clock back to before its departure. It used to stay at that false time for the rest of the journey, so a different train on the map happened to travel alongside you and it looked as though your own train had been labelled with someone else\'s number. When the clock really is away from now, the follow card says so and one tap brings it back; on phones the clock in the top left has its own button for returning to now.\n\nThe Pass and the Metro widget\nOnce you subscribe, the home screen Metro widgets can hold several stations and pick the nearest one straight away, without waiting for the next sync or tapping Restore Purchases. Signing out, or the end of a subscription, takes that back the same way.\n\nXinbeitou and Xiaobitan\nTrains on these two-station shuttle branches now carry a running time between the two stations from the moment they depart, so the map can move them.\n\nThe top bar in English and Japanese\nOn a 360-wide phone in English, the Metro group button at the right of the top bar sat entirely off screen with nothing to scroll. The tab row needs 248px in English and 234px in Japanese against 190px in Chinese, and the Rail Island plate in the top left gave up nothing, so the button was what got pushed out. The plate now yields instead: the origin and destination names come first, the title last, and what will not fit is trimmed to an ellipsis. The same situation in Japanese with an announcement showing is fixed too.\n\nAmbient mode and background music\nIn ambient mode the camera is now driven entirely by the app: the map can no longer be dragged off course or pinched down to a zoom it never comes back from, and the follow and cluster views behave the same way. Tapping a train still hands following over to it. The button that leaves ambient mode no longer fades out of sight, and no longer sits inside the system gesture area where a tap does not reach it. The background music switch no longer shows the opposite of what is actually playing.',
    whyJa: '軌島 1.5.2\n\n衛星画像の下地の色\n衛星画像モードで拡大・縮小しても、下地の色が一瞬見えることはなくなりました。8月30日の版では下地の色を衛星画像に近づけただけで、原因そのものは残っていました。今回は下に常に本物の衛星画像を敷き、衛星表示に切り替えた時点で台湾全体を先に読み込みます。拡大・縮小の途中に見えるのは色の面ではなく画像です。\n\n駅の発車案内の桁揃え\nカウントダウンが「まもなく到着」になる行が、時刻と混雑度を左へ押し出し、案内全体が歪んで見えていました。カウントダウンと時刻の2列は、その案内の中でいちばん広い行に合わせて同じ幅になり、すべての行が揃います。文字サイズを特大にしたときは、カウントダウンを「まもなく」に短くして、列車番号と時刻が押し出されないようにしました。\n\n台北駅が2つに分かれない\n環島之星が一周して台北に戻るとき、公式の時刻表はその到着を別の駅コードで記録しています。そのため地図上では2つの点、駅の発車案内も2枚になっていました。今回1つにまとめ、ホーム画面ウィジェットの駅一覧も同じようにまとめています。\n\nホーム画面ウィジェットの上り／下り\n台鉄・高鉄の発車ウィジェットで、各行に方向を表示します。iPhone のウィジェットには以前から三角がありましたが、灰色で飾りのように見えていました。三角を大きくし、台鉄の新しい駅サインの色（上り＝青、下り＝緑）に変えています。方向は「この駅を出てどちらへ向かうか」で判断するため、台中から大甲へ向かう列車のように竹南まで北上してから海線へ入る列車でも、逆を指すことはありません。\n\n駅の発車案内を方向別に\n台鉄・高鉄の駅の発車案内を、下り・上りで区分けしました。時刻順に一列で並べることはしません。竹南や彰化のように山線と海線が分かれる駅では、同じ方向をさらに山線・海線に分けます。二水・三貂嶺・新竹のように支線がある駅では、支線を独立した区分にし、ホームの案内表示と同じ「車埕方面」「菁桐方面」「内湾方面」と書きます。支線は南北の距離が数キロしかないことも多く、上り下りでは意味をなさないためです。各区分に3本ずつ表示するので、本数の少ない方向が多い方向に押し出されることはありません。方向の色はウィジェットと同じで、上りが青、下りが緑です。阿里山森林鉄道の案内も同様です。\n\n乗車中の時計\n「乗りました」を押したあと、まだ発車していない列車をタップしても、時計がその列車の発車前まで戻ることはなくなりました。以前はそのまま偽の時刻で止まり、地図上の別の列車がちょうど並走するため、自分の乗っている列車が別の列車番号で表示されているように見えていました。時計が現在時刻から離れているときは追跡カードにその旨が表示され、ワンタップで現在に戻ります。スマートフォンでは左上の時計にも「現在に戻る」ボタンを追加しました。\n\nパスとメトロウィジェット\nパスを購読すると、ホーム画面のメトロウィジェットで複数の駅を設定でき、最寄り駅の自動選択もすぐ使えます。次回の同期や「購入の復元」を待つ必要はありません。サインアウトや購読終了のときも、同じように反映します。\n\n新北投と小碧潭\nこの2駅の支線を走る列車に、発車の時点で駅間の所要秒数が入るようにしました。地図上で動かせるようになります。\n\n英語版・日本語版のトップバー\n英語表示の幅360の端末で、トップバー右側の「メトロ」切り替えボタンが画面外に出たまま、スクロールもできない状態でした。タブ列は英語で248px、日本語で234px必要なのに対し、中国語では190pxです。左上の軌島のプレートが幅を譲らないため、押し出されるのはボタンでした。今回はプレート側が譲るようにしました。始発・終着の駅名を先に確保し、タイトルは最後、収まらない分は省略記号にします。日本語でお知らせが出ているときの同じ現象も直しました。\n\nぼんやりモードと背景音楽\nぼんやりモードでは、カメラをアプリ側が完全に受け持つようにしました。地図を指でずらしたり、戻れないほど縮小したりすることはもうありません。追跡表示と群れ表示のどちらも同じ動きです。列車をタップして追跡を引き継ぐ操作は、これまでどおり使えます。「ぼんやり解除」ボタンが薄れて見えなくなることも、システムのジェスチャー領域に入って押せなくなることもありません。背景音楽のスイッチが実際と逆に表示される問題も直しました。',
  },
  // 2026-08-06：build 20、21、22 已上 TestFlight；22 專門驗收 Sandbox 購買後的
  // 軌島通行證客端功能、雲端同步與伺服器付費牆。這顆不可選去正式送審；正式版必須另推 build 號，
  // 回到 feature 模式並由 assertPlusSandboxOff 驗證測試通道確實關閉。
  testflight: {
    marketing: '1.3.2', build: '22', music: true, metroCore: false, plusSandboxBuild: '22',
    why: 'TestFlight 軌島通行證端到端測試版：Sandbox 月票／年票完成後，完整開放通行證與雲端功能驗收。',
  },
};

const mode = process.argv[2];
if (!MODES[mode]) {
  console.error(`用法：node app/scripts/set-release-mode.mjs <${Object.keys(MODES).join('|')}>`);
  process.exit(2);
}
const cfg = MODES[mode];

let src = await readFile(pbxproj, 'utf8');
const before = { m: (src.match(/MARKETING_VERSION = ([^;]+);/) || [])[1], b: (src.match(/CURRENT_PROJECT_VERSION = ([^;]+);/) || [])[1] };

// 單調遞增閘門（2026-07-28）：上面那張 MODES 表是 1.0.1／1.0.2 那一輪的決策，會過期，
// 而過期的徵狀不是報錯而是**靜默把版號往回推**——專案現在是 1.0.3 (14)，跑一次 feature
// 就悄悄改回 1.0.2 (13)，然後一路 build 到閘門綠燈，沒有任何一關看得出來（版號一致性
// 只比 www 與 repo 的 BUILD，不比 pbxproj 的版號跟上一次出貨的關係）。往回推的 build
// 號 Apple 會直接退件，但那是幾十分鐘之後的事了。
// 這裡不自動挑新版號——「下一顆該是哪個號」取決於 ASC 上哪些 build 已經被吃掉，
// 那是人才知道的事實。所以要往回推就停下來，要人更新 MODES。
const seq = v => String(v ?? '').trim().split('.').map(n => Number(n) || 0);
const cmp = (a, b) => { const A = seq(a), B = seq(b); for (let i = 0; i < Math.max(A.length, B.length); i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0); } return 0; };
const mDelta = cmp(cfg.marketing, before.m);
const bDelta = cmp(cfg.build, before.b);
// 900 系＝本機裝機測試號，從不上傳 ASC（MODES.feature 註解）。從 900 系切回送審線（<900）
// 是「回到 ASC 真實序列」不是回退——但這支腳本無從得知 ASC 已用到幾號，所以仍預設擋下，
// 要人先查線上版號（帶 no-cache）＋確認 ASC 最高已用號，再帶 ALLOW_ASC_REBASE=1 明示放行
//（比照 verify_landscape 的 ALLOW_SAME_BASE：只給確認過的那一趟用，不是常開旗標）。
const ascRebase = mDelta === 0 && bDelta < 0 && seq(before.b)[0] >= 900 && seq(cfg.build)[0] < 900;
if (mDelta < 0 || (mDelta === 0 && bDelta < 0 && !(ascRebase && process.env.ALLOW_ASC_REBASE === '1'))) {
  console.error(
    `\n✋ 拒絕執行：這會把版號往回推。\n` +
    `   專案現在是 ${before.m} (${before.b})，${mode} 模式要寫成 ${cfg.marketing} (${cfg.build})。\n` +
    `   Apple 不接受 build 號回退，而這個腳本會一路建到閘門綠燈、沒有任何一關擋得住。\n` +
    `   請先確認 App Store Connect 上哪些 build 已經用掉，再更新這支腳本的 MODES 表。\n` +
    (ascRebase ? `   （偵測到 900 系測試號 → 送審號：若已確認 ASC 最高已用號小於 ${cfg.build}，` +
      `帶 ALLOW_ASC_REBASE=1 重跑放行這一趟。）\n` : ''));
  process.exit(3);
}

// ── 出貨回歸基線的新鮮度閘門（2026-08-30 使用者裁示：「出貨前都要仔細檢查前一顆的內容，
//    不能每次都退掉其他東西」）────────────────────────────────────────────────
// 為什麼要在這裡擋：verify_no_ship_regression 是拿 app/shipped-baseline.json 當「還在使用者
// 手上的東西」的清單，可是**推進基線是人手動跑 --update**——沒人跑，基線就停在更早那一顆，
// 於是「比 80 沒少」照樣綠，而真正該比的 82 早就上架了。這是**沉默的**失效：閘門全綠、
// 訊息還大聲說「沒有任何一項比已上架的少」，只是它口中的「已上架」是舊的。
// 判準刻意用線上 lookup 的 version（實查，不用記憶、不用 repo 裡的任何值），
// 而且**只在 build 之前**跑一次——查不到就放行（fail-open），因為離線不該擋住出貨。
{
  const { readFileSync } = await import('node:fs');
  const baselinePath = join(appRoot, 'shipped-baseline.json');
  let base = null;
  try { base = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { /* 沒基線由 verify 自己報 */ }
  if (base) {
    let live = null;
    try {
      // 裸 URL 會拿到 CDN 舊值 ⇒ no-cache ＋ 時間戳（心得 itunes-lookup-cdn-cache）
      const out = execFileSync('curl', ['-s', '--max-time', '12', '-H', 'Cache-Control: no-cache',
        `https://itunes.apple.com/lookup?id=6792673516&t=${process.hrtime.bigint()}`], { encoding: 'utf8' });
      const r = JSON.parse(out).results?.[0];
      if (r?.version) live = { v: r.version, at: r.currentVersionReleaseDate };
    } catch { /* 離線／查不到 → 放行 */ }
    if (!live) {
      console.warn('⚠️  查不到線上版號（離線？），無法確認出貨回歸基線是不是最新的那一顆。');
      console.warn(`   基線目前是 ${base.marketing} (${base.build})；上傳前請自己對一次。\n`);
    } else if (cmp(live.v, base.marketing) > 0) {
      console.error(
        `\n✋ 拒絕執行：出貨回歸基線比線上落後了。\n` +
        `   線上已上架 ${live.v}（${live.at}），基線卻還停在 ${base.marketing} (${base.build})。\n` +
        `   照這樣建下去，「沒有任何一項比已上架的少」比的是 ${base.marketing}，\n` +
        `   ${live.v} 才加進去的東西這一顆弄不見也不會有人知道。\n\n` +
        `   先把基線推進到還在使用者手上的所有 build 的聯集：\n` +
        `     node app/scripts/verify_no_ship_regression.mjs --update \\\n` +
        `       --from <${base.marketing} 的 index.html>,<${live.v} 的 index.html> \\\n` +
        `       --marketing ${live.v} --build <那一顆的 build 號>\n` +
        `   （${live.v} 的 index.html 可從它的 archive 或 IPA 內 Payload/App.app/public/ 取。）\n`);
      process.exit(4);
    } else {
      console.log(`▸ 出貨回歸基線 ${base.marketing} (${base.build}) 已涵蓋線上現行版 ${live.v}（${live.at}）`);
    }
  }
}
if (ascRebase) console.log(`⚠️ ALLOW_ASC_REBASE：900 系測試號 (${before.b}) → ASC 送審號 (${cfg.build})，已人工確認 ASC 序列後放行這一趟。`);
src = src.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${cfg.marketing};`)
         .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${cfg.build};`);
await writeFile(pbxproj, src);

// 改完立刻回讀確認，不靠「replace 沒丟例外」當作改成功。
const after = await readFile(pbxproj, 'utf8');
const gotM = [...new Set([...after.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1]))];
const gotB = [...new Set([...after.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(m => m[1]))];
if (gotM.length !== 1 || gotM[0] !== cfg.marketing || gotB.length !== 1 || gotB[0] !== cfg.build) {
  throw new Error(`版號寫入後回讀不符：MARKETING_VERSION=${gotM.join('/')} CURRENT_PROJECT_VERSION=${gotB.join('/')}`);
}

console.log(`\n▸ 模式：${mode}  ${cfg.why}`);
console.log(`  版號 ${before.m} (${before.b}) → ${cfg.marketing} (${cfg.build})`);
// 2026-08-27:曲庫換成 57 首分六個歌單,但只內建 12 首(約 37MB)、其餘串流 ⇒ 音樂不再是體積大頭。
// 這行只是提示,真正的把關是 verify-release 對 MUSIC_BUNDLED 逐檔比對。
console.log(`  音樂 ${cfg.music ? '開啟（內建 12 首約 37MB，其餘串流）' : '關閉（與線上 build 8 一致）'}\n`);
if (cfg.plusSandboxBuild) console.log(`  Plus Sandbox 開啟（僅 TestFlight build ${cfg.plusSandboxBuild}；不可送正式審查）\n`);

// 線上底圖兩個模式都要開——那是 App 的基本功能，不是新增項目。
const env = { ...process.env, LANG: 'en_US.UTF-8', RAIL_INCLUDE_LICENSED_BASEMAPS: '1', RAIL_REQUIRE_NATIVE: '1' };
if (cfg.music) env.RAIL_INCLUDE_LICENSED_MUSIC = '1';
else delete env.RAIL_INCLUDE_LICENSED_MUSIC;
// 發行模式必須明確決定 Metro Core，不能只靠 prepare-web 的預設 false。1.4.9 build 69 就因為
// 註解寫「啟用」但環境變數沒送進去，整顆包安靜退回舊模型；RAIL_EXPECT_METRO_CORE 讓同步後
// 的獨立 verify 再比一次實際內嵌資產，避免 build 階段與 cap sync 階段各說各話。
env.RAIL_EXPECT_METRO_CORE = cfg.metroCore ? '1' : '0';
if (cfg.metroCore) env.RAIL_ENABLE_METRO_CORE = '1';
else delete env.RAIL_ENABLE_METRO_CORE;
// 本版「更新了什麼」內建文案＝why 本人。iTunes lookup 的 releaseNotes 是【線上版】的,
// 剛裝的版比線上新時(每次送審前必然)彈到的是上一版的文——1.4.9 (74) 實踩。
env.RAIL_WHATS_NEW = cfg.why;
// 英日整段文案。沒寫就送空字串 ⇒ appWhatsNewText() 退回中文(行為與 1.5.1 之前相同),
// 但 verify-release 會對 feature 模式擋下來,免得無聲退回「日文使用者看中文」。
if (typeof cfg.whyEn === 'string') env.RAIL_WHATS_NEW_EN = cfg.whyEn; else delete env.RAIL_WHATS_NEW_EN;
if (typeof cfg.whyJa === 'string') env.RAIL_WHATS_NEW_JA = cfg.whyJa; else delete env.RAIL_WHATS_NEW_JA;
if (cfg.plusSandboxBuild) {
  env.RAIL_PLUS_SANDBOX_OK = '1';
  env.RAIL_PLUS_SANDBOX_BUILD = cfg.plusSandboxBuild;
} else {
  delete env.RAIL_PLUS_SANDBOX_OK;
  delete env.RAIL_PLUS_SANDBOX_BUILD;
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: appRoot, env, stdio: 'inherit' });
run('npm', ['run', 'sync']);
// RAIL_REQUIRE_NATIVE=1：cap sync 之後 App/public 一定存在，這次不准再因為「檔案不存在」而略過
// 原生內嵌資產一致性檢查——那個略過就是 CI 從來沒真的驗過打包進 IPA 的那份網頁的原因。
run('npm', ['run', 'verify']);

console.log(`\n✅ ${mode} 模式就緒。接著在 Xcode：Product ▸ Archive ▸ Distribute App。`);
