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
    marketing: '1.0.1', build: '12', music: false,
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
  feature: {
    marketing: '1.4.1', build: '35', music: true,
    why: '軌島 1.4.1：App 收起與鎖屏後背景音樂續播、跟車即時動態改由後端推播（鎖屏自動換站）＋卡片強化（停靠中、進度條、車種顏色、上一站與終點站）、高鐵自由座車廂、我的車・準點、準點排行；production 資格，TestFlight Sandbox 通道維持關閉。',
  },
  // 2026-08-06：build 20、21、22 已上 TestFlight；22 專門驗收 Sandbox 購買後的
  // 軌島通行證客端功能、雲端同步與伺服器付費牆。這顆不可選去正式送審；正式版必須另推 build 號，
  // 回到 feature 模式並由 assertPlusSandboxOff 驗證測試通道確實關閉。
  testflight: {
    marketing: '1.3.2', build: '22', music: true, plusSandboxBuild: '22',
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
if (mDelta < 0 || (mDelta === 0 && cmp(cfg.build, before.b) < 0)) {
  console.error(
    `\n✋ 拒絕執行：這會把版號往回推。\n` +
    `   專案現在是 ${before.m} (${before.b})，${mode} 模式要寫成 ${cfg.marketing} (${cfg.build})。\n` +
    `   Apple 不接受 build 號回退，而這個腳本會一路建到閘門綠燈、沒有任何一關擋得住。\n` +
    `   請先確認 App Store Connect 上哪些 build 已經用掉，再更新這支腳本的 MODES 表。\n`);
  process.exit(3);
}
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
console.log(`  音樂 ${cfg.music ? '開啟（154MB 級）' : '關閉（與線上 build 8 一致）'}\n`);
if (cfg.plusSandboxBuild) console.log(`  Plus Sandbox 開啟（僅 TestFlight build ${cfg.plusSandboxBuild}；不可送正式審查）\n`);

// 線上底圖兩個模式都要開——那是 App 的基本功能，不是新增項目。
const env = { ...process.env, LANG: 'en_US.UTF-8', RAIL_INCLUDE_LICENSED_BASEMAPS: '1', RAIL_REQUIRE_NATIVE: '1' };
if (cfg.music) env.RAIL_INCLUDE_LICENSED_MUSIC = '1';
else delete env.RAIL_INCLUDE_LICENSED_MUSIC;
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
