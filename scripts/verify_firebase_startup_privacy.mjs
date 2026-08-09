// iOS 啟動時 Firebase 行為與公開隱私文案一致性判準（Task 12）。
//
// 這支判準刻意把「產品目前確實會在啟動時載入 native Auth plugin」與兩份公開文案綁在一起：
// 任何一邊改成延後載入、換 Firebase／Capacitor 版本，或文案又寫回「登入時才初始化」，都必須
// 重新查證 SDK 的網路行為後才能讓判準恢復。網路結論的逐行原始碼證據記在 CODEX-T12-REPORT.md。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..');
const rel = file => path.join(ROOT, file);
const read = file => readFileSync(rel(file), 'utf8');
const md5 = text => createHash('md5').update(text).digest('hex');

const sources = {
  appDelegate: read('app/ios/App/App/AppDelegate.swift'),
  capacitorConfig: read('app/capacitor.config.json'),
  packageJson: read('app/package.json'),
  podfileLock: read('app/ios/App/Podfile.lock'),
  bridge: read('app/node_modules/@capacitor/ios/Capacitor/Capacitor/CapacitorBridge.swift'),
  authPlugin: read('app/node_modules/@capacitor-firebase/authentication/ios/Plugin/FirebaseAuthenticationPlugin.swift'),
  authImplementation: read('app/node_modules/@capacitor-firebase/authentication/ios/Plugin/FirebaseAuthentication.swift'),
  privacy: read('privacy.html'),
  support: read('app-support.html'),
};

console.log(`[G0] ROOT=${ROOT}`);
for (const key of ['appDelegate', 'podfileLock', 'privacy', 'support']) {
  console.log(`[G0] ${key} md5=${md5(sources[key])}`);
}

const failures = [];
const requireFact = (condition, message) => { if (!condition) failures.push(message); };

// G0：ROOT 只由本檔位置推導，不接受 --root／環境變數；移動腳本後若目錄形狀不符直接紅。
requireFact(SCRIPT === path.join(ROOT, 'scripts', 'verify_firebase_startup_privacy.mjs'),
  'G0 腳本位置與由自身推導的 ROOT 不一致');

const packageJson = JSON.parse(sources.packageJson);
const capacitorConfig = JSON.parse(sources.capacitorConfig);
const includedIOSPlugins = capacitorConfig.ios?.includePlugins ?? capacitorConfig.includePlugins ?? null;

// 行為錨點：目前 Capacitor 會把 dependency 產生進 packageClassList，bridge 預設自動註冊並立即
// load()；FirebaseAuthentication 的 init 隨即 configure Firebase 並掛兩種 listener。
// 版本固定是刻意的：升級 SDK 後「初始化不發網路」必須重查，不能沿用舊結論靜默過關。
requireFact(packageJson.dependencies?.['@capacitor-firebase/authentication'] === '8.3.0',
  'Firebase Authentication plugin 已不是查證過的 8.3.0，請重查啟動網路行為');
requireFact(/- FirebaseAuth \(12\.7\.0\):/.test(sources.podfileLock),
  'FirebaseAuth 已不是查證過的 12.7.0，請重查啟動網路行為');
requireFact(includedIOSPlugins === null || includedIOSPlugins.includes('@capacitor-firebase/authentication'),
  'iOS includePlugins 已排除 Firebase Authentication；啟動行為可能改成延後載入，請同步改文案');
requireFact(/autoRegisterPlugins:\s*Bool\s*=\s*true/.test(sources.bridge)
  && /registerPlugins\(\)/.test(sources.bridge)
  && /registrationList\.packageClassList/.test(sources.bridge)
  && /registerPlugin\(capPlugin\)/.test(sources.bridge),
  'Capacitor 自動註冊流程已變動，無法再證明 Firebase plugin 於啟動時 load');
requireFact(/override public func load\(\)\s*\{[\s\S]*FirebaseAuthentication\(plugin:\s*self,\s*config:/.test(sources.authPlugin),
  'Firebase Authentication plugin 的 load() 已不再立即建立實作');
requireFact(/if FirebaseApp\.app\(\) == nil\s*\{\s*FirebaseApp\.configure\(\)\s*\}/.test(sources.authImplementation)
  && /Auth\.auth\(\)\.addStateDidChangeListener/.test(sources.authImplementation)
  && /Auth\.auth\(\)\.addIDTokenDidChangeListener/.test(sources.authImplementation),
  'plugin 初始化時 configure Firebase／掛 Auth listeners 的行為已變動');
requireFact(/#else[\s\S]*fatalError\("GoogleService-Info\.plist 缺失：release build/.test(sources.appDelegate),
  'Release 缺正式 GoogleService-Info.plist 的 fatalError 防呆不可移除');

const visibleText = html => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const privacyText = visibleText(sources.privacy);
const supportText = visibleText(sources.support);
const startupClaim = 'iOS App 啟動時會初始化 Firebase Core 與 Firebase Authentication，並掛上登入狀態監聽器';
const noRequestClaim = '此時不會向 Google／Firebase 發出網路請求，也不會建立或傳送 Firebase 使用者識別碼';
const laterHeartbeatClaim = '該 heartbeat 可能隨你之後發動的 Firebase 請求傳送';
const loginTimingClaim = 'Firebase Authentication 的網路連線與下述帳號資料處理，要到你選擇 Google 或 Apple 登入時才開始';

requireFact(privacyText.includes(startupClaim)
  && privacyText.includes(noRequestClaim)
  && privacyText.includes(laterHeartbeatClaim)
  && /user agent 不會連結到使用者或裝置識別碼/.test(privacyText)
  && privacyText.includes(loginTimingClaim)
  && /基本功能仍會[\s\S]*軌島 API、Cloudflare 與底圖供應商/.test(privacyText),
  'privacy.html 未完整揭露「啟動即初始化／未登入不送 Firebase 請求或 UID／heartbeat 後續傳送邊界／登入才開始 Auth 網路／其他服務仍會連線」');
requireFact(/App 一開啟就會連到 Firebase 嗎？/.test(supportText)
  && /iOS App 啟動時會先初始化 Firebase 登入元件並掛上登入狀態監聽器/.test(supportText)
  && /初始化本身不會向 Google／Firebase 發出網路請求，也不會建立或傳送 Firebase 使用者識別碼/.test(supportText)
  && /要等你選擇 Google 或 Apple 登入時，Firebase Authentication 才會開始連線及處理帳號資料/.test(supportText)
  && /基本功能仍會連線到軌島 API、Cloudflare 或底圖供應商/.test(supportText),
  'app-support.html 與 privacy.html 的 Firebase 啟動時點／網路邊界不一致');

if (failures.length) {
  console.log('FAIL T12 iOS Firebase 啟動行為與公開隱私文案一致');
  for (const failure of failures) console.log(`  - ${failure}`);
  console.log('\n──────── 0/1 PASS ────────');
  process.exit(1);
}

console.log('PASS T12 iOS Firebase 啟動行為與公開隱私文案一致');
console.log('\n──────── 1/1 PASS ────────');
