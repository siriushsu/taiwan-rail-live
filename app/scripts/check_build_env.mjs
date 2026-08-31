#!/usr/bin/env node
// 建置前的環境自檢 —— `npm run verify:build-env`
// （已掛在 app 的 build 鏈最前面：build / build:verify / sync / build:release / sync:release
//   全部會先跑這支；set-release-mode.mjs 走的是 `npm run sync`，所以出貨流程也被涵蓋）
//
// ── 為什麼要有這支（2026-08-31 的真實事故）─────────────────────────────────
// `app-build-worktree-traps.md` 第 1 條早就寫著「app/node_modules 不能做 symlink，必須實體複製」，
// 但那條規則【沒有守門人】。`.claude/worktrees/widget-pass` 被建成 symlink 借主樹，而主樹停在
// feat/changelog-slim、它的 app/package.json 沒有宣告 `@capacitor/app`
// ⇒ 那棵樹的磁碟上就真的沒有這個套件 ⇒ gradle 報 `Could not resolve project :capacitor-app`。
//
// 代價不是「build 壞掉」，是【誤診】：那個 session 把「我這棵樹沒裝」讀成「這個相依是產生檔殘骸」，
// commit f2ffb22 把 `:capacitor-app` 從 `capacitor.settings.gradle` 與 `app/capacitor.build.gradle`
// 刪掉（已由 f81af50 還原）。若沒被同儕實查抓到，後果會非常安靜——build 綠、verify 綠、那段 JS
// 照樣打包，只是原生端不再註冊 ⇒ Android 實體返回鍵不走自家處理（`app/src/native-bridge.mjs` 的
// `App.addListener('backButton')`／`minimizeApp`），【只有真的按下去才看得出來】。
//
// 所以這支不驗「套件版本對不對」，它回答的是更前面的一個問題：
//   ★ 我現在讀到的相依清單，和磁碟上那份套件集，是不是【同一棵樹】的？★
// 事故當下有兩個各自足以分辨的一行判準，一個都沒做，這支就是把那兩行變成會擋人的閘門：
//   (a) `app/node_modules` 是不是 symlink（是 ⇒ 磁碟上那份根本不屬於這棵樹）
//   (b) 這棵樹自己的 package.json 宣告的每個套件，是不是真的在 `app/node_modules` 底下
//
// ⚠️ (a) 紅的時候 (b) 會【略過】而不是照跑：穿過 symlink 去數套件，量到的是別棵樹，
//    那種綠燈正是當初讓人放心往下走的東西。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用【這支腳本自己的路徑】往上解出 app 根目錄——檢查對象與腳本永遠是同一棵樹，
// 不會因為 cwd 或參數而驗到別的地方，也不提供「驗哪個目錄」的參數（那種參數的
// 預設值遲早會指向一份釘死的舊副本，然後兩輪全綠驗的都是舊檔）。
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = path.join(APP_ROOT, 'package.json');
const MODULES_PATH = path.join(APP_ROOT, 'node_modules');

// 不吃參數就要明講不吃，否則傳進來的參數只是裝飾、讓人以為驗的是別的東西。
if (process.argv.length > 2) {
  console.error(`check_build_env.mjs 不接受參數（收到：${process.argv.slice(2).join(' ')}）。`);
  console.error('它固定檢查自己所在的那棵樹，這是刻意的——可指定目標的驗收腳本會驗到舊副本。');
  process.exit(2);
}

const fails = [];
const fail = message => fails.push(message);
const ok = message => console.log('  ✓ ' + message);

console.log(`建置前環境自檢：${APP_ROOT}`);

// ── (a) app/node_modules 必須是實體目錄 ───────────────────────────────────
let modulesInfo = null;
try { modulesInfo = fs.lstatSync(MODULES_PATH); } catch { /* 不存在 */ }

let modulesIsRealDir = false;
if (!modulesInfo) {
  fail('app/node_modules 不存在 —— 這棵樹還沒裝相依，原生 build 一定過不了。\n'
    + `      修法：npm --prefix "${APP_ROOT}" install`);
} else if (modulesInfo.isSymbolicLink()) {
  let target = '(讀不到)';
  try { target = fs.readlinkSync(MODULES_PATH); } catch { /* 斷鏈的 symlink */ }
  fail('🔴 app/node_modules 是 symlink —— 違反 app-build-worktree-traps 第 1 條'
    + '「app/node_modules 不能做 symlink，必須實體複製」。\n'
    + `      指向：${target}\n`
    + '      後果一（2026-08-31 實際踩到的）：磁碟上的套件集是照【那棵樹的 package.json】裝的，\n'
    + '              不是這棵樹的。這棵樹宣告的相依可能根本沒裝，而錯誤訊息會長得像\n'
    + '              「這個相依不存在」，很容易被誤診成產生檔殘骸而把真相依刪掉。\n'
    + '      後果二：CocoaPods 會把 @capacitor-firebase/authentication 看成 absolute 與 relative\n'
    + '              兩個不同來源而爆掉。\n'
    + '      後果三：npx cap sync 會把本機絕對路徑寫進 app/android/capacitor.settings.gradle（第 6 條）。\n'
    + `      修法：rm "${MODULES_PATH}" && npm --prefix "${APP_ROOT}" install\n`
    + '            🔴 不要改用 cp -R 別棵樹的 node_modules——那複製過來的仍是【別棵樹的】套件集，\n'
    + '            只是換一種形式犯同一個錯；要的是照這棵樹自己的 package.json 裝一份。');
} else if (!modulesInfo.isDirectory()) {
  fail(`app/node_modules 不是目錄也不是 symlink（mode ${modulesInfo.mode.toString(8)}）—— 先把它清掉再重裝。`);
} else {
  modulesIsRealDir = true;
  ok('app/node_modules 是實體目錄（沒有借別棵樹的套件集）');
}

// ── (b) 這棵樹宣告的每個套件都要真的在磁碟上 ──────────────────────────────
let pkg = null;
try { pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')); }
catch (error) { fail(`讀不到／解析不了 ${PKG_PATH}：${error.message}`); }

if (pkg) {
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const names = Object.keys(declared);

  // 分母守衛：一個都讀不到 ⇒ package.json 的形狀變了（或讀錯檔），此時 missing 必為空、
  // 下面那條就會【假綠】——分母無聲縮水是這類盤點最常見的失明方式。
  if (!names.length) {
    fail(`${PKG_PATH} 讀不到任何 dependencies／devDependencies —— 這道檢查失去受測對象，`
      + '請先確認是不是 package.json 的欄位改名或檔案讀錯了。');
  } else if (!modulesIsRealDir) {
    console.log(`  · 略過套件在位盤點（${names.length} 個宣告）：node_modules 不是實體目錄，`
      + '穿過去數到的是別棵樹的套件集，綠燈不代表這棵樹裝好了');
  } else {
    // 判「在位」用套件自己的 package.json 而不是只看目錄在不在——空目錄會給出假綠。
    const missing = names.filter(name => !fs.existsSync(path.join(MODULES_PATH, name, 'package.json')));
    if (!missing.length) {
      ok(`package.json 宣告的 ${names.length} 個套件全部在 app/node_modules 底下`);
    } else {
      fail(`🔴 宣告了卻沒裝的套件 ${missing.length}／${names.length} 個：\n`
        + missing.map(name => `        ${name}@${declared[name]}`).join('\n') + '\n'
        + '      —— 這在原生端的顯形是 gradle 的 `Could not resolve project :capacitor-xxx`\n'
        + '         或 pod install 找不到 target。🔴 那是【環境沒裝】不是【相依是幽靈】，\n'
        + '         在刪掉任何 capacitor.settings.gradle／capacitor.build.gradle 的條目之前，\n'
        + '         先把這裡弄綠——刪錯的代價是原生功能靜默失效，而 build 仍會 SUCCEEDED。\n'
        + `      修法：npm --prefix "${APP_ROOT}" install`);
    }
  }
}

// ── 收尾 ──────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error('\n❌ 建置前環境自檢未過：\n' + fails.map(message => '  ✗ ' + message).join('\n'));
  console.error('\n這兩條都是【環境】的紅，不是【產品】的紅。');
  console.error('在改任何 gradle／pod 設定或刪任何相依宣告之前，先把這裡弄綠，否則你會修錯東西。');
  process.exit(1);
}
console.log('\n✅ 建置前環境自檢通過');
