// 交給使用者去 Organizer 上傳之前的最後一道閘門。
//
//   node app/scripts/verify_archive_ready.mjs             # 期望版號從 pbxproj 讀
//   node app/scripts/verify_archive_ready.mjs 1.5.3 87    # 明講要驗哪一顆
//
// 正本流程寫在 app/出貨規則.md 第五節。這支是那一節的守門人，不要在這裡另立說法。
//
// 為什麼要有這支（2026-09-01 立，起因是同一天的真實事故）：
// 那天 ~/Library/Developer/Xcode/Archives 底下同時存在**兩顆 1.5.3 (86)**——使用者自己
// archive 了一顆、我用 CLI 又 archive 了一顆。我 patch 的是我那顆，使用者在 Organizer 裡
// 挑的是他那顆（沒 patch），上傳後 ASC 回二進位錯誤（ITMS-90111），86 這個號就燒掉了。
// Organizer 的清單只顯示「App／日期／版本」，兩顆長得一模一樣，人眼分不出來。
// 這不是第一次：1.5.2 (83) 在磁碟上有四顆、1.4.9 (69) 那顆得靠手打檔名 "patched" 才記得住。
//
// 所以這支驗的第一件事不是「這顆對不對」，而是「**同一個版號底下只有一顆**」——
// 有兩顆的時候，「哪顆對」這個問題本身就沒有安全答案。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));      // …/app
// RAIL_ARCHIVES_ROOT 只給這支自己的突變測試用（把 _已作廢的archive 當根,
// 那裡就躺著 2026-09-01 那兩顆同號 archive,是現成的控制組）。正常出貨不要設。
const ARCHIVES = process.env.RAIL_ARCHIVES_ROOT || join(homedir(), 'Library/Developer/Xcode/Archives');
const RETIRED = join(homedir(), 'Library/Developer/Xcode/_已作廢的archive');
const RELEASE_OS_BUILD = process.env.RAIL_RELEASE_OS_BUILD || '25G70';
const EXPECTED_MIN_OS = process.env.RAIL_EXPECTED_MIN_OS || '15.0';
const BETA_RE = /^\d+[A-Z]5\d{3}[a-z]$/;

const plist = (cmd, file) => {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch { return ''; }
};

const fails = [];
const fail = (code, msg, hint) => fails.push({ code, msg, hint });
const ok = msg => console.log(`  ✅ ${msg}`);

// ── 期望版號：一律以 pbxproj 為準（它才是 archive 出來會寫進去的那個值）────────────
const pbxproj = join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj');
const pbx = readFileSync(pbxproj, 'utf8');
const uniq = re => [...new Set([...pbx.matchAll(re)].map(m => m[1].trim()))];
const pbxM = uniq(/MARKETING_VERSION = ([^;]+);/g);
const pbxB = uniq(/CURRENT_PROJECT_VERSION = ([^;]+);/g);
const wantM = process.argv[2] || pbxM[0];
const wantB = process.argv[3] || pbxB[0];

console.log(`\n這棵樹  ${appRoot}`);
console.log(`要驗的  軌島 ${wantM} (${wantB})\n`);

if (!process.argv[2]) {
  if (pbxM.length !== 1 || pbxB.length !== 1) {
    fail('P0', `pbxproj 裡版號不只一種：MARKETING_VERSION=${pbxM.join('/')} CURRENT_PROJECT_VERSION=${pbxB.join('/')}`,
      '跑 node app/scripts/set-release-mode.mjs <模式> 讓它統一寫入。');
  } else ok(`pbxproj 版號一致：${pbxM[0]} (${pbxB[0]})`);
} else if (pbxM[0] !== wantM || pbxB[0] !== wantB) {
  fail('P1', `參數要驗 ${wantM} (${wantB})，但這棵樹的 pbxproj 是 ${pbxM[0]} (${pbxB[0]})`,
    '兩者必須一致，否則你驗的 archive 不是這棵樹現在會建出來的東西。');
}

// ── C1：同一個版號底下只准有一顆 archive ────────────────────────────────────────
// 用 archive 自己 Info.plist 裡的 ApplicationProperties 判身分,不看檔名——
// 檔名是人打的,說謊過（"RailIsland 1.4.9 (69) v0821b patched"）。
function scanArchives(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const day of readdirSync(root)) {
    const dir = join(root, day);
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.xcarchive')) continue;
      const path = join(dir, name);
      const info = join(path, 'Info.plist');
      if (!existsSync(info)) continue;
      out.push({
        path, name, day,
        m: plist('Print :ApplicationProperties:CFBundleShortVersionString', info),
        b: plist('Print :ApplicationProperties:CFBundleVersion', info),
        mtime: statSync(path).mtimeMs,
      });
    }
  }
  return out;
}

const all = scanArchives(ARCHIVES);
const hits = all.filter(a => a.m === wantM && a.b === wantB).sort((x, y) => x.mtime - y.mtime);

if (hits.length === 0) {
  fail('C1', `Archives 底下找不到 ${wantM} (${wantB}) 的 archive（掃過 ${all.length} 顆）`,
    '先跑 node app/scripts/ios-release.mjs <模式> 把它建出來。');
} else if (hits.length > 1) {
  const list = hits.map(h => `        ${new Date(h.mtime).toLocaleString('zh-TW')}  ${h.day}/${h.name}`).join('\n');
  fail('C1', `${wantM} (${wantB}) 在 Archives 底下有 ${hits.length} 顆——Organizer 裡它們長得一模一樣，你挑不出哪顆 patch 過`,
    `這正是 2026-09-01 燒掉 build 86 的形狀。留一顆、其餘搬走：\n` +
    `        mkdir -p "${RETIRED}/${wantM}-${wantB}"\n` +
    `        mv <要作廢那顆> "${RETIRED}/${wantM}-${wantB}/"\n` +
    `      搬完重跑這支。若無法確定哪顆是對的,全部搬走、改用新 build 號重出（規則四）。\n${list}`);
} else {
  ok(`${wantM} (${wantB}) 在 Archives 底下恰好一顆`);
}

const arch = hits.length === 1 ? hits[0] : null;

if (arch) {
  console.log(`\narchive ${arch.day}/${arch.name}`);
  const appsDir = join(arch.path, 'Products/Applications');
  const appName = existsSync(appsDir) ? readdirSync(appsDir).find(n => n.endsWith('.app')) : null;

  if (!appName) {
    fail('C2', `archive 裡沒有 .app：${appsDir}`, 'archive 的 scheme 選錯了（例如選到 widget extension 的 scheme）。');
  } else {
    const appDir = join(appsDir, appName);
    const infoPlist = join(appDir, 'Info.plist');

    // ── C2：載貨是不是這棵樹建出來的 ──────────────────────────────────────────
    // patch-archive-os 也驗這條,但它是 archive 之後立刻跑;這支是**上傳前一刻**再驗一次,
    // 因為中間可能為了出 Android 重跑過 build:release,把 app/www 換成 Android 版。
    const wwwIndex = join(appRoot, 'www/index.html');
    const archIndex = join(appDir, 'public/index.html');
    const buildOf = f => (readFileSync(f, 'utf8').match(/const BUILD = '([^']+)'/) || [])[1] || '(讀不到)';
    if (!existsSync(archIndex)) {
      fail('C2', 'archive 裡沒有 public/index.html', 'Capacitor 的網頁資產沒被打包進去。');
    } else if (!existsSync(wwwIndex)) {
      fail('C2', `這棵樹沒有 app/www/index.html，無法比對`, '跑 node app/scripts/set-release-mode.mjs <模式> 重建 www。');
    } else {
      const a = createHash('md5').update(readFileSync(archIndex)).digest('hex');
      const w = createHash('md5').update(readFileSync(wwwIndex)).digest('hex');
      if (a !== w) {
        fail('C2', `載貨與這棵樹不符：archive BUILD ${buildOf(archIndex)} md5 ${a.slice(0, 12)}… / www BUILD ${buildOf(wwwIndex)} md5 ${w.slice(0, 12)}…`,
          '最常見原因是中間跑過 npm run build:release（出 Android）把 www 換成 Android 版——\n' +
          '      重跑 node app/scripts/set-release-mode.mjs <模式> 讓 www 回到 iOS 版即可,不必重 archive。\n' +
          '      重跑後 md5 仍不符,才是真的 archive 錯了。');
      } else ok(`載貨與這棵樹逐 byte 相同（BUILD ${buildOf(archIndex)}  md5 ${a.slice(0, 12)}…）`);
    }

    // ── C3：小工具 extension 有沒有被打進去 ───────────────────────────────────
    // 2026-09-01 使用者那顆是用 RailBoardWidgetExtension 這個 scheme 出的。它照樣產出
    // 含 App.app 的 archive、版號也對,人眼看不出差別。這條驗的是「該有的都在」。
    const plugIns = join(appDir, 'PlugIns');
    const appex = existsSync(plugIns) ? readdirSync(plugIns).filter(n => n.endsWith('.appex')) : [];
    if (!appex.length) {
      fail('C3', 'App.app/PlugIns 底下沒有任何 .appex——桌面小工具沒被打包進去',
        'archive 的 scheme 要選 App（不是 RailBoardWidgetExtension）。用 ios-release.mjs 就不會選錯。');
    } else ok(`小工具 extension 已打包：${appex.join('、')}`);

    // ── C4：版號 ─────────────────────────────────────────────────────────────
    const gotM = plist('Print :CFBundleShortVersionString', infoPlist);
    const gotB = plist('Print :CFBundleVersion', infoPlist);
    if (gotM !== wantM || gotB !== wantB) {
      fail('C4', `.app 內版號是 ${gotM} (${gotB})，與要驗的 ${wantM} (${wantB}) 不符`, 'archive 根 Info.plist 與 .app 對不上,這顆不可信。');
    } else ok(`.app 內版號 ${gotM} (${gotB})`);

    // ── C5：patch 過了沒（全 archive 掃，不是只看 .app）────────────────────────
    const infos = [];
    (function walk(dir) {
      let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'Info.plist') infos.push(p);
      }
    })(arch.path);

    const values = new Map();
    for (const p of infos) {
      const v = plist('Print :BuildMachineOSBuild', p);
      if (v) values.set(p, v);
    }
    const beta = [...values].filter(([, v]) => BETA_RE.test(v));
    if (beta.length) {
      fail('C5', `還有 ${beta.length} 個 bundle 帶著 beta macOS 標記（${[...new Set(beta.map(b => b[1]))].join('、')}）——上傳會被 ASC 回 ITMS-90111`,
        `跑 node app/scripts/patch-archive-os.mjs "${arch.path}"`);
    } else {
      const tally = {};
      for (const [, v] of values) tally[v] = (tally[v] || 0) + 1;
      ok(`BuildMachineOSBuild 零個 beta 值（${Object.entries(tally).map(([v, n]) => `${v}×${n}`).join('、')}）`);
    }
    const appOS = plist('Print :BuildMachineOSBuild', infoPlist);
    if (appOS !== RELEASE_OS_BUILD) {
      fail('C5', `.app 本體的 BuildMachineOSBuild 是 ${appOS || '(讀不到)'}，不是 ${RELEASE_OS_BUILD}`, 'Apple 真正檢查的就是這一個。');
    }

    // ── C6：工具鏈與最低支援版本（改 plist 救不了，只能重 archive）─────────────
    for (const key of ['DTXcodeBuild', 'DTSDKBuild', 'DTPlatformBuild']) {
      const v = plist(`Print :${key}`, infoPlist);
      if (BETA_RE.test(v)) fail('C6', `${key} = ${v} 是 beta 建置工具鏈`, '用 /Applications/Xcode.app（非 beta）重新 archive。');
    }
    const minOS = plist('Print :MinimumOSVersion', infoPlist);
    if (minOS !== EXPECTED_MIN_OS) {
      fail('C6', `MinimumOSVersion = ${minOS || '(讀不到)'}，預期 ${EXPECTED_MIN_OS}`, '最低支援版本被改動了,會把既有使用者擋在更新之外。');
    } else ok(`工具鏈非 beta、最低支援 iOS ${minOS}`);
  }
}

// ── 收尾 ────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n🔴 ${fails.length} 項不通過，這顆不可交給使用者上傳：\n`);
  for (const f of fails) {
    console.error(`  [${f.code}] ${f.msg}`);
    if (f.hint) console.error(`      → ${f.hint}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`\n✅ 全數通過。交給使用者的唯一一步：

   Xcode ▸ Window ▸ Organizer ▸ 選「${arch.name.replace(/\.xcarchive$/, '')}」
   ▸ Distribute App ▸ App Store Connect ▸ Upload

   （一定要走 Distribute App。patch 破壞了現有簽章，靠這一步用發行憑證重簽補回來；
     選了不重簽的匯出方式會因簽章不符被擋。）
`);
