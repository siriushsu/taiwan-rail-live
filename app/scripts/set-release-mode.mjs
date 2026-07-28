// 把 iOS 專案切到某一種發行模式，然後一路建置到發行閘門通過。
//
//   node app/scripts/set-release-mode.mjs hotfix    → 1.0.1 (build 12)，無音樂
//   node app/scripts/set-release-mode.mjs feature   → 1.0.2 (build 13)，含音樂
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
  feature: {
    marketing: '1.0.2', build: '13', music: true,
    why: 'TestFlight／後續送審版：含音樂與開機定位等新功能。',
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

// 線上底圖兩個模式都要開——那是 App 的基本功能，不是新增項目。
const env = { ...process.env, LANG: 'en_US.UTF-8', RAIL_INCLUDE_LICENSED_BASEMAPS: '1', RAIL_REQUIRE_NATIVE: '1' };
if (cfg.music) env.RAIL_INCLUDE_LICENSED_MUSIC = '1';
else delete env.RAIL_INCLUDE_LICENSED_MUSIC;

const run = (cmd, args) => execFileSync(cmd, args, { cwd: appRoot, env, stdio: 'inherit' });
run('npm', ['run', 'sync']);
// RAIL_REQUIRE_NATIVE=1：cap sync 之後 App/public 一定存在，這次不准再因為「檔案不存在」而略過
// 原生內嵌資產一致性檢查——那個略過就是 CI 從來沒真的驗過打包進 IPA 的那份網頁的原因。
run('npm', ['run', 'verify']);

console.log(`\n✅ ${mode} 模式就緒。接著在 Xcode：Product ▸ Archive ▸ Distribute App。`);
