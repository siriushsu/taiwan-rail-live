// 發版前的 APNs 環境閘門（最終複審 B-I4 的客戶端那半）。
//
// 為什麼非得驗「建出來的東西」而不是驗 App.entitlements：
//   entitlements 檔只是**申請**，實際簽進 bundle 的是「申請 ∩ 佈建描述檔允許」。App ID 沒開
//   Push Notifications 時，`aps-environment` 會在重新簽章時被**整條丟掉**——沒有建置錯誤、
//   沒有警告，App 照樣跑，只是 ActivityKit 永遠不會發 push token ⇒ 後端 la_bindings 恆空、
//   cron 每分鐘掃 0 列，整條 LA-1 靜默失效。本檔寫成的當下，手上兩顆產物就是活生生的例子：
//     ~/Desktop/軌島-1.4.1-26.ipa（07-30 匯出）與 1.4.1 (28) 的 archive（08-08 00:23）
//     兩者的 embedded entitlements 都沒有 aps-environment，而它們的佈建描述檔
//     （iOS Team Store Provisioning Profile，07-30 產生）也沒有——因為 aps-environment 是
//     08-08 01:15 才加進 App.entitlements 的，那兩顆本來就在它之前。
//   換句話說：**沒有任何一顆現存產物證明過 aps-environment 真的簽得進去**，這支就是要在
//   Distribute 之前把這件事變成一條會紅的斷言，而不是上架後才發現整條推播沒作用。
//
// 另一半風險是值本身：development 的 token 只有 api.sandbox.push.apple.com 認得，
// 而 worker.js 的預設主機是 api.push.apple.com ⇒ 全員 BadDeviceToken，還會誤觸 A-I1 的熔斷。
//
// 用法：
//   node app/scripts/verify_aps_env.mjs                      # 自動挑最新的 .xcarchive，期望 production
//   node app/scripts/verify_aps_env.mjs <archive|.app|.ipa>  # 指定產物
//   RAIL_APS_EXPECT=development node app/scripts/verify_aps_env.mjs …   # 驗開發簽章的 build
//
// 退出碼：0＝全過；1＝有 FAIL；2＝中止（連要驗什麼都沒找到）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const EXPECT = process.env.RAIL_APS_EXPECT || 'production';

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
let printed = false;
function summary(reason) {
  if (printed) return;
  printed = true;
  const bad = results.filter(r => !r.p).length;
  console.log(reason ? `\n總計(中止,未完成) ${results.length} 項,FAIL ${bad} — 原因:${reason}`
                     : `\n總計 ${results.length} 項,FAIL ${bad}`);
}
function abort(reason) { console.error(reason); summary(reason); process.exit(2); }
const fatal = tag => e => { console.error((e && e.stack) || String(e)); abort(`${tag}:${String((e && e.message) || e).split('\n')[0]}`); };
process.on('uncaughtException', fatal('未攔截例外'));
process.on('unhandledRejection', fatal('未處理的 rejection'));
process.on('exit', () => { if (!printed) { summary('行程在印出總計之前就結束了'); process.exitCode = 2; } });

// 讀某個 bundle 實際簽進去的 entitlements（不是 .entitlements 原始檔）
// 🔴 完全沒有 entitlements 的 bundle：codesign 會吐空字串,plutil 接著就以非 0 結束。
//    這一條路徑正是 A1 要抓的情況,不可以讓它變成未攔截例外（0 條斷言、非綠非紅——
//    本專案栽過的坑）。取不到就回空字串,交給 apsOf() 判成 null。
function signedEntitlements(bundlePath) {
  let xml = '';
  try {
    xml = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', bundlePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return ''; }
  if (!xml.trim()) return '';
  try {
    return execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'],
      { input: xml, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (e) { return xml; }   // 已是 XML 就直接用（新版 codesign 本來就吐 XML）
}
const apsOf = xml => (xml.match(/<key>aps-environment<\/key>\s*<string>([^<]*)<\/string>/) || [])[1] || null;

// 佈建描述檔允許的 entitlements（＝重新簽章時的天花板，也是缺 aps-environment 的根因層）
function profileAps(appPath) {
  const p = join(appPath, 'embedded.mobileprovision');
  if (!existsSync(p)) return { found: false, aps: null, name: '' };
  const plist = execFileSync('/usr/bin/security', ['cms', '-D', '-i', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { found: true, aps: apsOf(plist), name: (plist.match(/<key>Name<\/key>\s*<string>([^<]*)<\/string>/) || [])[1] || '' };
}

function newestArchive() {
  const root = join(homedir(), 'Library/Developer/Xcode/Archives');
  if (!existsSync(root)) return null;
  const found = [];
  for (const day of readdirSync(root)) {
    const dir = join(root, day);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.xcarchive')) found.push({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found.length ? found[0].path : null;
}

// 把三種輸入(.xcarchive/.app/.ipa)都收斂成「一個可以 codesign -d 的 .app 路徑」
function resolveApp(input) {
  if (input.endsWith('.app')) return input;
  if (input.endsWith('.xcarchive')) {
    const dir = join(input, 'Products/Applications');
    if (!existsSync(dir)) abort(`archive 裡沒有 Products/Applications：${input}`);
    const app = readdirSync(dir).find(n => n.endsWith('.app'));
    if (!app) abort(`archive 裡找不到 .app：${dir}`);
    return join(dir, app);
  }
  if (input.endsWith('.ipa')) {
    const tmp = mkdtempSync(join(tmpdir(), 'aps-env-'));
    execFileSync('/usr/bin/unzip', ['-oq', input, '-d', tmp], { stdio: 'ignore' });
    const dir = join(tmp, 'Payload');
    const app = existsSync(dir) && readdirSync(dir).find(n => n.endsWith('.app'));
    if (!app) abort(`ipa 裡找不到 Payload/*.app：${input}`);
    return join(dir, app);
  }
  abort(`看不懂的產物型別（只收 .xcarchive / .app / .ipa）：${input}`);
}

const input = process.argv[2] || newestArchive();
// 🔴 找不到產物一律中止（exit 2），不可靜默略過：這支存在的理由就是「沒有任何產物證明過
// aps-environment 簽得進去」，把「沒東西可驗」印成綠燈等於把它自己廢掉。
if (!input) abort('沒有指定產物、也找不到任何 .xcarchive——先 Product ▸ Archive 再跑這支');
if (!existsSync(input)) abort(`產物不存在：${input}`);
console.log(`[APS] 產物：${input}`);
console.log(`[APS] 期望的 aps-environment：${EXPECT}（RAIL_APS_EXPECT 可覆寫）`);

const app = resolveApp(input);
const appAps = apsOf(signedEntitlements(app));
const prof = profileAps(app);

ok('A1 App 本體實際簽進去的 entitlements 帶 aps-environment(缺＝ActivityKit 永遠拿不到 push token,整條 LA-1 靜默失效)',
   appAps !== null, appAps === null ? '(整條被丟掉)' : appAps);
ok(`A2 aps-environment 的值＝${EXPECT}(development 的 token 只有 sandbox 主機認得,對正式主機一律 BadDeviceToken 並誤觸熔斷)`,
   appAps === EXPECT, String(appAps));
ok('A3 佈建描述檔本身就允許 aps-environment(這是根因層:描述檔沒有 ⇒ 重新簽章時一定再被丟掉一次)',
   prof.found && prof.aps !== null, prof.found ? `${prof.name}:${prof.aps === null ? '(描述檔沒有這一項)' : prof.aps}` : '(找不到 embedded.mobileprovision)');

// widget extension:B-I5 尚待裁示,這裡【不】要求它移除,只要求「若有就不可與 App 本體衝突」。
const plugins = join(app, 'PlugIns');
const appexes = existsSync(plugins) ? readdirSync(plugins).filter(n => n.endsWith('.appex')) : [];
const conflicts = appexes.map(n => ({ n, aps: apsOf(signedEntitlements(join(plugins, n))) })).filter(x => x.aps !== null && x.aps !== appAps);
ok('A4 附屬 extension 的 aps-environment 不與 App 本體衝突(值不同＝兩個 target 分屬不同 APNs 環境)',
   conflicts.length === 0, appexes.length ? `${appexes.length} 個 extension,衝突 ${conflicts.length} 個${conflicts.length ? ':' + JSON.stringify(conflicts) : ''}` : '沒有 extension');

summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);
