// Archive 之後、Distribute 之前，把 App bundle 的 BuildMachineOSBuild 從 beta macOS 值
// 改成正式版值，否則 App Store Connect 的二進位審查會回 ITMS-90111（invalid binary）。
//
//   node app/scripts/patch-archive-os.mjs                 # 自動挑最新的 .xcarchive
//   node app/scripts/patch-archive-os.mjs <archive 路徑>
//
// 為什麼只改這一個欄位：2026-07-25 成功上傳的 build 9 留下了實證——那顆 archive 裡
// DTPlatformBuild / DTSDKBuild / DTXcodeBuild 全是原值，只有 BuildMachineOSBuild 從
// 26A5378n（macOS 27 beta seed，結尾小寫字母是 seed 的特徵）被改成 25G70（正式版）。
// 因為 Xcode 26.6 (17F113) 本身是正式版，beta 的只有作業系統。多改欄位＝多一個
// 與實際工具鏈不一致的地方，沒有好處。
//
// 為什麼改了簽章壞掉還能過：Organizer 的 Distribute App 會用發行憑證**重新簽章**，
// 所以這裡暫時破壞的簽章會在匯出時被重建。反過來說——
// ⚠️ 一定要走 Distribute App ▸ App Store Connect ▸ Upload。若選了不重新簽章的匯出方式，
//    上傳會因簽章不符被擋。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));   // …/app

// 已證實可通過二進位審查的正式版 macOS build（build 9 用的就是這個值）。
// 之後若換機器或 Apple 收緊檢查，改這裡一處即可。
const RELEASE_OS_BUILD = process.env.RAIL_RELEASE_OS_BUILD || '25G70';
// beta seed 的 build 號長相：<主版>A<5開頭四碼><小寫字母>，例如 26A5378n。
const BETA_RE = /^\d+[A-Z]5\d{3}[a-z]$/;

const plist = (cmd, file) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, file], { encoding: 'utf8' }).trim();

function newestArchive() {
  const root = join(homedir(), 'Library/Developer/Xcode/Archives');
  if (!existsSync(root)) throw new Error(`找不到 Archives 目錄：${root}`);
  const found = [];
  for (const day of readdirSync(root)) {
    const dir = join(root, day);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.xcarchive')) continue;
      const path = join(dir, name);
      found.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  if (!found.length) throw new Error('Archives 目錄下沒有任何 .xcarchive——請先在 Xcode 跑 Product ▸ Archive');
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].path;
}

const archive = process.argv[2] || newestArchive();
if (!existsSync(archive)) throw new Error(`archive 不存在：${archive}`);

const appsDir = join(archive, 'Products/Applications');
const app = readdirSync(appsDir).find(name => name.endsWith('.app'));
if (!app) throw new Error(`archive 裡找不到 .app：${appsDir}`);
const infoPlist = join(appsDir, app, 'Info.plist');

console.log(`\narchive : ${archive}`);
console.log(`app     : ${app}`);
console.log(`版本    : ${plist('Print :CFBundleShortVersionString', infoPlist)} (build ${plist('Print :CFBundleVersion', infoPlist)})`);

// ── 上傳前的硬閘門：這兩件事改 plist 救不了，只能重新 Archive ──────────────────
// 2026-07-26 實際踩到：機器上同時有 /Applications/Xcode.app（26.6 正式版）與
// ~/Downloads/Xcode-beta.app（27.0 beta）。`xcodebuild -version` 回報的是命令列選到的 26.6，
// 但 GUI 開的是 beta，於是 archive 用 iOS 27.0 beta SDK 建成——而且因為 App target 的
// IPHONEOS_DEPLOYMENT_TARGET 綁在 $(RECOMMENDED_...)，最低支援版本被無聲從 15.0 拉到 17.0，
// 等於把 iOS 15／16 的既有使用者擋在更新之外。兩件事都是 Info.plist 上看不出「壞掉」的樣子。
const blockers = [];

for (const key of ['DTXcodeBuild', 'DTSDKBuild', 'DTPlatformBuild']) {
  let value = '';
  try { value = plist(`Print :${key}`, infoPlist); } catch {}
  if (BETA_RE.test(value)) blockers.push(`${key} = ${value} 是 beta 版建置工具鏈`);
}

// 最低支援 iOS。商店頁與 build 8 都是 15.0，變動一定要是刻意的。
const EXPECTED_MIN_OS = process.env.RAIL_EXPECTED_MIN_OS || '15.0';
let minOS = '';
try { minOS = plist('Print :MinimumOSVersion', infoPlist); } catch {}
if (minOS !== EXPECTED_MIN_OS) {
  blockers.push(`MinimumOSVersion = ${minOS}，預期 ${EXPECTED_MIN_OS}——最低支援版本被改動了`);
}

if (blockers.length) {
  console.error('\n🔴 這顆 archive 不可上傳：\n');
  for (const b of blockers) console.error(`   ・${b}`);
  console.error(`
   Apple 不收 beta SDK 建置的 App Store 版本，而改 Info.plist 救不了——二進位本身
   就是連結那套 SDK 的。最低支援版本同理，它由建置時的設定決定。

   怎麼修：
   1. 完全結束 Xcode（含 ~/Downloads/Xcode-beta.app），用 /Applications/Xcode.app 重開
      open -a /Applications/Xcode.app "${join(appRoot, 'ios/App/App.xcworkspace')}"
   2. 確認 Xcode ▸ About Xcode 顯示的是正式版（不是 beta）
   3. 重新 Product ▸ Archive，再跑一次這支腳本
`);
  process.exit(1);
}

const current = plist('Print :BuildMachineOSBuild', infoPlist);
console.log(`\n工具鏈檢查通過：SDK ${(() => { try { return plist('Print :DTSDKName', infoPlist); } catch { return '?'; } })()}，最低 iOS ${minOS}`);
console.log(`BuildMachineOSBuild 現值：${current}`);

if (current === RELEASE_OS_BUILD) {
  console.log('已經是正式版值，不用改。');
} else if (!BETA_RE.test(current)) {
  // 不符 beta 長相就停手：可能是已在正式版 macOS 上建置，硬改反而製造不一致。
  console.log(`⚠️  這個值不像 beta seed（beta 長相為 26A5378n 這種）。沒有改動。`);
  console.log(`   若確定仍需改，執行：RAIL_RELEASE_OS_BUILD=${RELEASE_OS_BUILD} 並自行確認。`);
  process.exit(0);
} else {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :BuildMachineOSBuild ${RELEASE_OS_BUILD}`, infoPlist]);
  const after = plist('Print :BuildMachineOSBuild', infoPlist);   // 回讀確認，不靠「指令沒報錯」當作改成功
  if (after !== RELEASE_OS_BUILD) throw new Error(`寫入後回讀不符：${after}`);
  console.log(`已改為：${after}`);
}

// 其餘工具鏈欄位一併列出來，讓你一眼看出有沒有別的 beta 值混進來（正常情況它們都該是正式版）。
console.log('\n其餘工具鏈欄位（應全為正式版值，出現 beta 長相要停下來查）：');
for (const key of ['DTPlatformBuild', 'DTSDKBuild', 'DTXcodeBuild', 'DTXcode']) {
  let value = '—';
  try { value = plist(`Print :${key}`, infoPlist); } catch {}
  const flag = BETA_RE.test(value) ? '  ⚠️ 像 beta' : '';
  console.log(`  ${key.padEnd(18)} ${value}${flag}`);
}

console.log('\n下一步：Xcode ▸ Window ▸ Organizer ▸ 選這顆 archive ▸ Distribute App ▸ App Store Connect ▸ Upload');
console.log('（一定要走這條，它會重新簽章；剛才的修改會讓現有簽章失效，靠重簽補回來。）');
