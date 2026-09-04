// iOS 出檔的唯一入口。一支指令從版號設定跑到「可以交給使用者上傳」。
//
//   node app/scripts/ios-release.mjs feature      # 正式送審
//   node app/scripts/ios-release.mjs testflight   # TestFlight（Sandbox 購買可解鎖）
//
// 正本流程與非談判條款寫在 app/出貨規則.md 第五節。這支是那一節的可執行版本。
//
// 為什麼要有這支（2026-09-01 立）：
// 連續幾次出 build，每一次的做法與說法都不一樣。根因不是記性，是流程沒有單一住所——
// 它散在四個地方：set-release-mode 的檔頭註解、patch-archive-os 的檔頭註解、
// 出貨規則.md、以及各 session 的記憶。而**註解是跟著分支走的**：同一天 origin/main 上的
// 檔頭寫著「archive 我做得到」，build 線上的同一支腳本還寫著「archive 做不到，你要自己
// 按 Product ▸ Archive」。在哪棵樹讀到哪一份，就給出哪一種說法。
//
// 修法不是再寫一份更好的文件，是把流程變成**一支指令**：能被執行的東西沒有詮釋空間。
// 要改流程就改這支，不要在別處另立說法。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));      // …/app
const repoRoot = dirname(appRoot);
const scripts = join(appRoot, 'scripts');
const iosDir = join(appRoot, 'ios');
// 兩個 ROOT 覆寫只給這支自己的突變測試用,正常出貨不要設。
const ARCHIVES = process.env.RAIL_ARCHIVES_ROOT || join(homedir(), 'Library/Developer/Xcode/Archives');
const RETIRED = process.env.RAIL_RETIRED_ROOT || join(homedir(), 'Library/Developer/Xcode/_已作廢的archive');

const mode = process.argv[2];
if (!['feature', 'testflight', 'hotfix'].includes(mode)) {
  console.error(`\n用法：node app/scripts/ios-release.mjs <feature|testflight|hotfix>\n`);
  process.exit(2);
}

const step = (n, title) => console.log(`\n\x1b[1m━━ ${n}／6　${title}\x1b[0m`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const cap = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

// ── 1／6　我在哪棵樹 ────────────────────────────────────────────────────────
// 先自證來源。2026-08-16 有一次整套判斷是讀到過期工作樹做出來的,而過期的樹每一行都讀得通,
// 只有版號與行數量級會漏餡。出 build 更嚴重:讀錯樹＝出錯貨。
step(1, '這是哪棵樹');
const branch = cap('git', ['branch', '--show-current'], { cwd: repoRoot }) || '(detached)';
const head = cap('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
const behind = cap('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: repoRoot });
console.log(`  樹      ${repoRoot}`);
console.log(`  分支    ${branch} @ ${head}`);
console.log(`  落後    origin/main ${behind} 顆${behind !== '0' ? '  ⚠️ 確認這條線是刻意的（規則 1c）' : ''}`);
const dirty = cap('git', ['status', '--porcelain'], { cwd: repoRoot }).split('\n').filter(Boolean);
console.log(`  未提交  ${dirty.length} 個路徑${dirty.length ? `\n${dirty.slice(0, 12).map(l => `          ${l}`).join('\n')}` : ''}`);

// iOS 現在同時承載 iPhone、iPad 與完整的軌道轉公車旅程。這兩支瀏覽器矩陣若只放在
// package.json 等人手動想起來，正式 archive 仍可能在版面或原生橋接已壞時一路綠到底。
// 固定放進唯一出檔指令，讓每顆 iOS build 都先驗真實觸控、WebKit 與旅程分享生命週期。
console.log('\n  ▸ iPhone／iPad 與轉乘旅程驗收');
sh('npm', ['run', 'check-tablet'], { cwd: repoRoot });
sh('npm', ['run', 'check-bus-transfer'], { cwd: repoRoot });

// ── 2／6　版號、更新了什麼、www、cap sync、發行閘門 ────────────────────────────
// set-release-mode 自己會做：version train 實查、出貨基線涵蓋檢查、pbxproj 寫入＋回讀、
// prepare-web、cap sync、npm run verify。這裡不重做它做過的事。
step(2, `set-release-mode ${mode}`);
sh('node', [join(scripts, 'set-release-mode.mjs'), mode], { cwd: repoRoot });

// ── 3／6　這個 build 號還沒被用過嗎（規則四）────────────────────────────────
step(3, 'build 號未被用過');
const pbx = readFileSync(join(iosDir, 'App/App.xcodeproj/project.pbxproj'), 'utf8');
const one = re => {
  const v = [...new Set([...pbx.matchAll(re)].map(m => m[1].trim()))];
  if (v.length !== 1) throw new Error(`pbxproj 裡有 ${v.length} 種值：${v.join(' / ')}`);
  return v[0];
};
const marketing = one(/MARKETING_VERSION = ([^;]+);/g);
const build = one(/CURRENT_PROJECT_VERSION = ([^;]+);/g);
const webBuild = (readFileSync(join(appRoot, 'www/index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
console.log(`  要出的  軌島 ${marketing} (${build})　網頁 ${webBuild}`);

// 連「已作廢」那區一起掃。作廢的號**更**不能重用——它之所以作廢,常常正是因為已經
// 被 ASC 吃掉了（build 86 就是這樣燒的）。只掃 Archives 會讓燒掉的號看起來又乾淨了。
const existing = [];
for (const [label, root] of [['', ARCHIVES], ['已作廢：', RETIRED]]) {
  if (!existsSync(root)) continue;
  for (const day of readdirSync(root)) {
    const dir = join(root, day);
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.xcarchive')) continue;
      const info = join(dir, name, 'Info.plist');
      if (!existsSync(info)) continue;
      const get = k => { try { return cap('/usr/libexec/PlistBuddy', ['-c', `Print :ApplicationProperties:${k}`, info]); } catch { return ''; } };
      if (get('CFBundleShortVersionString') === marketing && get('CFBundleVersion') === build) existing.push(`${label}${day}/${name}`);
    }
  }
}
if (existing.length) {
  console.error(`\n🔴 ${marketing} (${build}) 的 archive 已經存在，不可再打一顆同號的：\n`);
  for (const e of existing) console.error(`   ・${e}`);
  console.error(`
   規則四：一個 build 號只對應一份載貨。同號兩份不同內容，是 2026-09-01 燒掉 build 86
   的直接原因（我 patch 一顆、使用者上傳另一顆，Organizer 裡兩顆長得一模一樣）。

   三條出路：
   ・那顆就是你要的     → 跑 node app/scripts/verify_archive_ready.mjs 驗它，不要重打。
   ・上面標「已作廢」   → 這個號已經燒掉了，把 set-release-mode.mjs 的 MODES.${mode}.build
                          進位到下一號再跑這支。作廢的號絕不重用（常常是已被 ASC 吃掉才作廢的）。
   ・那顆要作廢         → 搬去 ~/Library/Developer/Xcode/_已作廢的archive/${marketing}-${build}/
                          （檔名寫清楚為什麼作廢），build 號一樣要進位。
`);
  process.exit(1);
}
console.log(`  ✅ Archives 底下沒有同號 archive`);

// ── 4／6　archive ──────────────────────────────────────────────────────────
// 本機開發憑證就簽得出 archive（2026-09-01 實測 ARCHIVE SUCCEEDED，同日出過 86／87 兩顆）。
// 不需要使用者去按 Product ▸ Archive——那個說法是舊註解，已作廢。
step(4, 'xcodebuild archive');
const today = new Date().toLocaleDateString('sv-SE');        // YYYY-MM-DD
const outDir = join(ARCHIVES, today);
mkdirSync(outDir, { recursive: true });
const archivePath = join(outDir, `軌島-${marketing}-${build}-${webBuild}.xcarchive`);
const derived = join(iosDir, 'DerivedData');                 // app/.gitignore 已含 ios/DerivedData/
console.log(`  產物    ${archivePath}`);
console.log(`  約 3–6 分鐘，輸出很長只印結果…`);
const log = join(derived, `archive-${build}.log`);
mkdirSync(derived, { recursive: true });
try {
  const out = cap('xcodebuild', [
    '-workspace', 'App/App.xcworkspace',
    '-scheme', 'App',                     // 一定是 App，不是 RailBoardWidgetExtension
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-derivedDataPath', derived,
    '-archivePath', archivePath,
    'archive',
  ], { cwd: iosDir, maxBuffer: 1 << 28 });
  execFileSync('/bin/sh', ['-c', `cat > ${JSON.stringify(log)}`], { input: out });
  if (!/\*\* ARCHIVE SUCCEEDED \*\*/.test(out)) throw new Error('輸出裡沒有 ARCHIVE SUCCEEDED');
  console.log('  ✅ ARCHIVE SUCCEEDED');
} catch (err) {
  console.error(`\n🔴 archive 失敗。完整輸出：${log}\n`);
  const tail = (err.stdout || err.message || '').toString().split('\n').slice(-40).join('\n');
  console.error(tail);
  process.exit(1);
}

// ── 5／6　patch（拿掉 beta macOS 標記，否則 ASC 回 ITMS-90111）─────────────────
// 明講路徑，不讓它自己挑「mtime 最新」——挑錯是這整串事故的老根。
step(5, 'patch-archive-os');
sh('node', [join(scripts, 'patch-archive-os.mjs'), archivePath], { cwd: repoRoot });

// ── 6／6　上傳前閘門 ────────────────────────────────────────────────────────
step(6, 'verify_archive_ready');
sh('node', [join(scripts, 'verify_archive_ready.mjs')], { cwd: repoRoot });
