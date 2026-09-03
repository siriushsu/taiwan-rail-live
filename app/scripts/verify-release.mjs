import { inventory, compare as compareShipInventory } from './verify_no_ship_regression.mjs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyAndroidWidgetParity } from './verify_android_widget_parity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const defaultOut = join(appRoot, 'www');

const fail = message => { throw new Error(`App 發行檢查失敗：${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

export function assertNativeBridgeLoggingDisabled(capacitorConfig) {
  assert(capacitorConfig?.loggingBehavior === 'none',
    'capacitor.config.json loggingBehavior 必須是 none——Firebase 原生登入結果含憑證，不可寫入 Android logcat');
}

// Android v5 曾在 MainActivity.super.onCreate() 之前呼叫 EdgeToEdge.enable()。那一步會提早把
// SplashScreen theme 的 ActionBar 建出來；Capacitor BridgeActivity 隨後才切 NoActionBar 已經來不及，
// WebView 因而被上下各擠出一塊系統底色。Capacitor 8 自帶 SystemBars/insets handling，殼不應再手動開一次。
export function assertAndroidMainActivityDoesNotPreInitWindow(mainActivity) {
  assert(!/\bEdgeToEdge\s*\.\s*enable\s*\(/.test(mainActivity),
    'Android MainActivity 不可手動呼叫 EdgeToEdge.enable()——會在 Capacitor 套用 NoActionBar 前初始化 launch theme，讓上下白帶回歸');
}

// Android 前景定位契約：同時宣告 coarse/fine，並明確請求 location alias，讓系統提供「精確位置」
// 選項。一次性與連續定位都必須保留呼叫端的 enableHighAccuracy，不可在 bridge 偷壓回 false。
export function assertAndroidPreciseLocationContract({ nativeBridgeSource, packagedBridge, androidManifest }) {
  assert(androidManifest.includes('android.permission.ACCESS_COARSE_LOCATION'),
    'Android manifest 必須宣告 ACCESS_COARSE_LOCATION');
  assert(androidManifest.includes('android.permission.ACCESS_FINE_LOCATION'),
    'Android manifest 必須宣告 ACCESS_FINE_LOCATION，否則無法提供精確位置');
  assert(/ANDROID_PRECISE_LOCATION\s*=\s*Object\.freeze\(\{\s*permissions:\s*\['location'\]\s*\}\)/s.test(nativeBridgeSource),
    'Android 定位 bridge 必須以 location alias 請求精確位置');
  assert(/Geolocation\.requestPermissions\(ANDROID_PRECISE_LOCATION\)/.test(nativeBridgeSource),
    'Android 定位 bridge 沒有明確呼叫 Geolocation.requestPermissions(location)');
  assert(!/androidGeoOptions|enableHighAccuracy:\s*false/.test(nativeBridgeSource),
    'Android 定位 bridge 不可強制降為模糊位置');
  assert(/Geolocation\.getCurrentPosition\(options\)/.test(nativeBridgeSource),
    '一次性定位沒有原樣保留精確定位選項');
  assert(/Geolocation\.watchPosition\(options,/.test(nativeBridgeSource),
    '連續定位沒有原樣保留精確定位選項');
  assert(/permissions:\[?["']location["']\]?/.test(packagedBridge),
    '打包後 native-bridge.js 不含精確位置契約——原始碼修正沒有進入發行包');
}

// Android 實體／手勢返回鍵契約：官方 App plugin 接原生事件，index.html 決定浮層優先序。
// 一旦註冊 listener，Capacitor 就不再代做預設返回；所以「沒有浮層時」的 history/minimize
// 退路也必須一起存在，否則補了關閉選單卻會讓一般返回鍵整顆失效。
export function assertAndroidBackButtonContract({ nativeBridgeSource, packagedBridge, html }) {
  assert(nativeBridgeSource.includes("import { App } from '@capacitor/app'"),
    'Android 返回鍵必須使用官方 @capacitor/app，不可另開自製原生橋');
  assert(/App\.addListener\('backButton',[\s\S]*new CustomEvent\('rail:native-back', \{ cancelable: true \}\)/.test(nativeBridgeSource),
    'native bridge 沒有把官方 backButton 轉成可取消的 rail:native-back 事件');
  assert(/if \(canGoBack\) window\.history\.back\(\);[\s\S]*App\.minimizeApp\(\)/.test(nativeBridgeSource),
    '返回鍵沒有保留「可返回就上一頁，否則收 App 到背景」的既有退路');
  assert(packagedBridge.includes('rail:native-back') && packagedBridge.includes('backButton'),
    '打包後 native-bridge.js 缺少 Android 返回鍵接線');
  const setup = (html.match(/function setupNativeBackButton\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(setup.includes("addEventListener('rail:native-back'")
      && setup.includes('gtabPopSet(false)') && setup.includes('statPopSet(false)')
      && setup.includes('e.preventDefault()'),
    'index.html 必須讓返回鍵依序先收群組選單／資料狀態卡，並攔下該次原生返回');
  assert(html.includes('setupGtabPop(); setupNativeBackButton();'),
    'Android 返回鍵處理函式存在但沒有在 boot 掛上');
}

// Android WebView <140 的 env(safe-area-inset-*) 有已知錯誤；Capacitor 8 會把正確值注入
// --safe-area-inset-*。所有版面只准從 --sa-* 別名取值，否則三鍵導覽／手勢條會再次蓋住貼底控制。
export function assertAndroidSafeAreaCssContract(html) {
  for (const [short, edge] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
    const pattern = new RegExp(`--sa-${short}:\\s*var\\(--safe-area-inset-${edge},\\s*env\\(safe-area-inset-${edge},\\s*0px\\)\\)`);
    assert(pattern.test(html),
      `CSS --sa-${short} 必須優先讀 Capacitor --safe-area-inset-${edge}，再退回 env(safe-area-inset-${edge})`);
  }
  assert(/body\.ambient \.controls\s*\{[^}]*bottom:\s*calc\(8px \+ var\(--sa-b\)\)/s.test(html),
    'Android 放空模式底部控制未避讓 --sa-b——系統導覽列會再次蓋住「離開放空」');
  assert(/\.topbar \.grouptabs \.gtab\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/s.test(html)
      && /\.topbar \.alert-chip\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/s.test(html),
    'Android 手機頂列必須維持緊湊 36px 幾何——360dp＋營運公告時「捷」會被裁掉');
}

// 2026-08-22 的 63e38b2 曾在三方合併時把 index.html 整檔選成 main 那側，
// 讓只活在 App 線的功能、定位與公開更新紀錄一起靜默消失；原生碼與 build 全部仍會綠。
// 這裡鎖住「必須一起存在」的 App 血脈，不再只靠散落且未接進出貨流程的瀏覽器驗收器。
export function assertAppLineageContent(html) {
  const requiredSource = [
    ['id="fpLaCta"', '跟車面板的鎖屏通行證入口'],
    ['function renderLaCta()', '跟車鎖屏通行證渲染'],
    ['function maybeSatPlusNotice()', '衛星高解析通行證提示'],
    ["{ key: 'metrowidget'", '使用說明中心的捷運小工具章節'],
    ["{ key: 'metrowait'", '使用說明中心的在這站等車章節'],
    ['function startForegroundGeoWatch(', 'App 前景持續定位'],
    ['function updateGeoCamera(', '所在地鏡頭跟隨'],
    ['function zaCalGl(', '捏合縮放的 MapLibre 重標定'],
    ['const syncDraw = () =>', '拖曳時 overlay 同幀重畫'],
    ['L.MaplibreGL.prototype', 'MapLibre 同步 redraw 補丁'],
  ];
  for (const [needle, label] of requiredSource) {
    assert(html.includes(needle), `${label}遺失（缺少 ${needle}）——請檢查 index.html 是否又在合併時整檔退回 main`);
  }

  const requiredHistory = [
    'apprestore', 'geofollow', 'metrocoreidentity', 'widgetredesign', 'androidwidgets', 'plusctas', 'mapsync',
    'appwhatsnewlag', 'androidcoarse', 'androidtopgap', 'androidinsets', 'androidbars', 'android142',
  ];
  for (const id of requiredHistory) {
    assert(html.includes(`data-cl="${id}"`),
      `完整更新歷史缺少 data-cl="${id}"——App 專屬紀錄不可在網站／iOS 合併時被整段吃掉`);
  }
}

// 2026-08-30:同一顆 63e38b2 還吃掉了另一種東西——不是「識別字不見了」,而是【函式還在、
// 但它本體裡的那一行呼叫不見了】。420a0a5(08-16)把通行證資格推給小工具的呼叫端從 1 處補到 8 處,
// 合併整檔取 main 那側之後又退回 1 處,而 metroWidgetSyncPlus 這個函式名本身還在 ⇒
// assertAppLineageContent 的 includes() 與 verify_no_ship_regression 的識別字盤點【兩道都照不到】,
// Android 1.5.0(16/19) 與 iOS 1.5.1(82) 三顆出貨顆就這樣帶著單向閥出去(登出後小工具照樣解鎖)。
// 所以這道閘門判的是「呼叫在不在它該在的那個函式本體裡」,不是全檔數量——數量會被任何一處補寫矇過去。
// 行為層的判準另有 scripts/verify_metro_widget_plus_sync.mjs(量 setPlus 的呼叫序列),那支要瀏覽器,
// 不適合掛在這條純 Node 的出貨鏈上;這裡只做「結構還在不在」的廉價守門。
export function assertWidgetPlusSyncSites(html) {
  // 每一條都是一個【明確答案】的來源:拿到答案就必須把旗標推給小工具,否則它會停在上一個值。
  const sites = [
    ['accountForgetIdentity', '登出'],
    ['accountEnsureInit', 'auth 明確解出 null(換人／session 失效)'],
    ['setupAccountUi', '冷啟動就是訪客(「更新即關」的唯一保障)'],
    ['plusReconcileEntitlement', '資格文件握手'],
    ['plusApplyCustomerInfo', 'RevenueCat 推播／付費操作前重新驗證'],
    ['plusRefresh', '回前景／到期／退費'],
    ['plusPurchase', '購買成功'],
    ['plusRestore', '恢復購買'],
  ];
  for (const [fn, why] of sites) {
    const start = html.search(new RegExp(String.raw`^(?:async )?function ${fn}\(`, 'm'));
    assert(start >= 0, `找不到函式 ${fn}——通行證資格同步的閘門失去受測對象,請先確認它是不是改名或被整檔合併吃掉`);
    const rest = html.slice(start + 1);
    const nextRelative = rest.search(/^(?:async )?function [A-Za-z_$]/m);
    const body = html.slice(start, nextRelative < 0 ? html.length : start + 1 + nextRelative);
    assert(body.includes('metroWidgetSyncPlus('),
      `${fn}() 沒有把通行證資格推給小工具(${why})——旗標會變成單向閥:寫成 true 之後回不去,` +
      `登出／到期後小工具照樣解鎖;反向則是付了錢還鎖著。見 index.html 的 metroWidgetSyncPlus 上方說明。`);
  }
}

// Stadia 官方要求的逐字署名(prepare-web 注入、本檔驗證,單一事實來源)
export const STADIA_ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
// OpenFreeMap 要求的逐字署名(index.html 內就有這個常數,本檔驗它沒被改動,單一事實來源)。
// 署名是**生效要件**不是禮貌:ODbL 與 OpenFreeMap 的使用條件都要求標示,拿掉就不再是合法使用。
export const OFM_ATTRIBUTION = '&copy; <a href="https://openfreemap.org/" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

async function walk(root) {
  const files = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      const info = await lstat(full);
      assert(!info.isSymbolicLink(), `發行包不可含符號連結：${relative(root, full)}`);
      if (info.isDirectory()) await visit(full);
      else files.push(full);
    }
  };
  await visit(root);
  return files;
}

export async function readReleasePolicy() {
  return JSON.parse(await readFile(join(appRoot, 'release-policy.json'), 'utf8'));
}

// 發行版不得允許 sandbox 資格。背景:RevenueCat 的 entitlements.active 等同 activeInAnyEnvironment
// (SDK doc comment),所以 index.html 的 plusActiveFrom 用建置期注入的 window.RAIL_PLUS_SANDBOX_OK
// 把 sandbox 購買擋在正式 build 之外;那個旗標只給「要實測購買流程」的內部版打開
// (RAIL_PLUS_SANDBOX_OK=1 npm run build)。這道閘門就是「內部版上不了架」的那把鎖——沒有它,
// 那個建置旗標就只是一個沒人看守的後門。
// 判準刻意是「必須明確寫著 false」而不是「不得出現 true」:注入整段被拿掉時,後者會沉默放行
// (constraint 10 的沉默不是證據)。抽成獨立導出函式是為了能單元測試——餵合成 HTML 就驗得到
// 紅/綠,不必先建出一整包 www(見 scripts/verify_plus_entitlement_env.mjs)。
export function assertPlusSandboxOff(html) {
  assert(/window\.RAIL_PLUS_SANDBOX_OK=(true|false)/.test(html),
    '發行包缺少 window.RAIL_PLUS_SANDBOX_OK 注入——sandbox 資格閘門的建置旗標不見了,'
    + '請確認 app/scripts/prepare-web.mjs 仍在注入這個值');
  assert(!/window\.RAIL_PLUS_SANDBOX_OK=true/.test(html),
    '發行包把 sandbox 資格打開了(window.RAIL_PLUS_SANDBOX_OK=true)——TestFlight/模擬器的 sandbox 購買'
    + '會解鎖正式付費功能。這個旗標只給內部測試版用,送審/上架的 build 請不要帶 RAIL_PLUS_SANDBOX_OK=1');
  assert(/window\.RAIL_PLUS_SANDBOX_BUILD=null/.test(html),
    '正式發行包仍帶著 RAIL_PLUS_SANDBOX_BUILD——即使 SANDBOX_OK=false 也拒絕留下含糊的測試通道標記');
}

// TestFlight 內部測試包也要有自己的 fail-closed 閘門：只有 boolean=true 不夠，還必須把這次
// 明確核准的 build 號逐字打進包內。正式 verify 不傳 expect 值，仍走上面的嚴格關閉檢查。
export function assertPlusSandboxTestBuild(html, expectedBuild) {
  const build = String(expectedBuild || '');
  assert(/^[1-9]\d*$/.test(build), 'TestFlight Sandbox build 號必須是正整數');
  assert(/window\.RAIL_PLUS_SANDBOX_OK=true/.test(html),
    'TestFlight Sandbox 包沒有注入 window.RAIL_PLUS_SANDBOX_OK=true——購買後只會看到價格、不會解鎖');
  assert(html.includes(`window.RAIL_PLUS_SANDBOX_BUILD=${JSON.stringify(build)}`),
    `TestFlight Sandbox 包的測試通道 build 標記不是 ${build}`);
}

export const ANDROID_PLUS_GATE_LINE =
  "  if (IS_NATIVE_APP && window.Capacitor?.getPlatform?.() === 'android') return window.RAIL_ANDROID_PLUS_ENABLED === true;";

export function assertAndroidPlusGate(html) {
  const exactInitializer = [
    'const PLUS_ENABLED = (() => { try {',
    ANDROID_PLUS_GATE_LINE,
    '  if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return true;',
    "  return new URLSearchParams(location.search).get('plus') === '1';",
    '} catch (e) { return false; } })();',
  ].join('\n');
  assert(html.includes(exactInitializer),
    'PLUS_ENABLED 必須讓原生 Android 只讀 build-time 明確旗標，再逐字保留既有 iOS 原生與 Web ?plus=1 分支；'
    + '不得只藏單一入口或重寫共享判定式');
  assert(html.split(ANDROID_PLUS_GATE_LINE).length === 2,
    'Android 通行證平台 gate 必須且只能出現一次');
}

export function assertAndroidPlusReleaseConfig(html, expectedVersionCode = '') {
  const enabled = /window\.RAIL_ANDROID_PLUS_ENABLED=(true|false)/.exec(html)?.[1];
  assert(enabled, '發行包缺少 window.RAIL_ANDROID_PLUS_ENABLED 明確注入');
  if (enabled === 'false') {
    assert(/window\.RAIL_ANDROID_PLUS_SANDBOX_POLICY=null/.test(html)
      && /window\.RAIL_ANDROID_PLUS_SANDBOX_BUILD=null/.test(html),
    'Android 通行證關閉時 Sandbox policy/build 必須同時為 null');
    assert(!/androidApiKey\s*:/.test(html),
      'Android 通行證關閉時不應把 RevenueCat Android key 打進包內');
    return false;
  }

  const key = /androidApiKey\s*:\s*["'](goog_[A-Za-z0-9]+)["']/.exec(html)?.[1] || '';
  assert(key, 'Android 通行證已開啟，但發行包沒有格式正確的 RevenueCat Android public SDK key（goog_…）');
  assert(!/androidApiKey\s*:\s*["']sk_/.test(html),
    'Android App 絕不可打包 RevenueCat secret key（sk_…）');
  assert(/window\.RAIL_METRO_CORE_ENABLED=true/.test(html),
    'Android 通行證版必須明確啟用 Metro Core；不可退回舊捷運位置模型');
  assert(/window\.RAIL_ANDROID_PLUS_SANDBOX_POLICY="revenuecat-allowlist"/.test(html),
    'Android 通行證正式包必須明確採 revenuecat-allowlist Sandbox policy');
  const build = /window\.RAIL_ANDROID_PLUS_SANDBOX_BUILD="([1-9]\d*)"/.exec(html)?.[1] || '';
  assert(build, 'Android 通行證正式包缺少 Sandbox build 號');
  if (expectedVersionCode) assert(build === String(expectedVersionCode),
    `Android Sandbox build=${build}，與 versionCode=${expectedVersionCode} 不一致`);
  assert(/const ANDROID_PLUS_SANDBOX_OK = PLUS_ENABLED[\s\S]*RAIL_ANDROID_PLUS_SANDBOX_POLICY === 'revenuecat-allowlist'[\s\S]*RAIL_ANDROID_PLUS_SANDBOX_BUILD/.test(html),
    'Android 同 AAB Sandbox 驗收的 runtime 收斂判定消失');
  return true;
}

export async function assertLicensedBuildAllowed({ includeLicensedMusic, includeLicensedBasemaps }) {
  const policy = await readReleasePolicy();
  if (includeLicensedMusic) {
    assert(policy.music?.allTracksCommercialRightsVerified === true,
      '音樂授權政策尚未核准，不可建立含 Suno 音樂的 App');
    const checklist = await readFile(join(appRoot, 'MUSIC_LICENSE_CHECKLIST.md'), 'utf8');
    const trackRows = checklist.split('\n').filter(line => /^\| .+\.mp3 \|/.test(line));
    // 2026-08-27：曲庫由 29 首換成 57 首(六個歌單資料夾)。這個數字是硬編的,因為它的用途是
    // 「有人動了曲庫卻沒回頭補核對表」的警報——跟著曲庫自動走就永遠不會響。
    assert(trackRows.length === 57, `音樂核對表應有 57 首，目前是 ${trackRows.length} 首`);
    assert(trackRows.every(line => /\| 已核對 \|\s*$/.test(line)),
      '音樂核對表仍有未核對曲目');
  }
  const basemapRights = [
    ['paidAppUseVerified', '付費 App 商用'],
    ['leafletAndCapacitorUseVerified', 'Leaflet／Capacitor'],
    ['attributionRequirementsVerified', '署名要求']
  ];
  const rights = policy.onlineBasemaps || {};
  if (includeLicensedBasemaps) {
    for (const [key, label] of basemapRights) assert(rights[key] === true, `線上底圖的「${label}」授權尚未核准`);
  } else if (basemapRights.every(([key]) => rights[key] === true) && process.env.RAIL_ALLOW_SAFE_BUILD !== '1') {
    // 防呆（靜默降級）：release-policy 已核准線上底圖，卻要建「安全 build」（不含 Stadia／Esri 衛星）＝
    // 多半是忘了帶 RAIL_INCLUDE_LICENSED_BASEMAPS=1。此檢查在 prepare-web 清空 www 之前就擋下，保住既有
    // 授權版 www、避免把降級版本 cap sync 進原生或送審。刻意要出安全 build 就設 RAIL_ALLOW_SAFE_BUILD=1。
    fail('release-policy 已核准線上底圖，但目前要建的是「安全 build」（不含 Stadia／Esri 衛星）——多半是忘了帶授權旗標。'
      + '請改用 npm run build:release／npm run sync:release（或 RAIL_INCLUDE_LICENSED_BASEMAPS=1 npm run build）。'
      + '若確實要建安全 build，設 RAIL_ALLOW_SAFE_BUILD=1 再跑。');
  }
}

// ── showToast 注入面的審查帳本 ──────────────────────────────────────────────
// 指紋＝呼叫參數拿掉「所有字串literal內容」與空白之後剩下的程式結構。
// 這樣改文案不會動到指紋（不會為了改一句話就紅燈），改結構才會。
const TOAST_REVIEWED = new Map([
  [`res&&res.why===''?'':res&&res.why===''?'':''`, '等車卡開卡失敗提示:res.why 只被比較,三個寫死字串三選一,無插入'],
  [`info.done?'':''`, '兩個寫死字串二選一,無插入'],
  [`on?'':''`, '兩個寫死字串二選一,無插入'],
  [`core?'':''`, 'Core 跟隨失聯提示:core 只在兩個寫死字串間二選一,無插入'],
  [`''+note+''`, 'onLocateFail:note 只可能是四個寫死常數之一,無使用者資料'],
  [`m`, 'announceCollections:msgs 每個插值都已 escHtml;此處刻意傳 <b> 做粗體'],
  ['`${escHtml(item.title)}`', '眾包校正提示,已逸出'],
  ["`${out.added}${out.updated?`${out.updated}`:''}${out.skipped?`${out.skipped}`:''}`", '匯入結果的三個筆數,皆為數字'],
  [`label?(''+escHtml(label)+''):''`, '儲存地點:地點名可由 Takeout 匯入/帳號同步汙染,已逸出'],
  [`p.label?(''+escHtml(p.label)+''):''`, '設預設啟動地點:同上,已逸出'],
  // 2026-07-27 登記:使用說明中心「試一次」。helpRun() 只做 `const t = HELP_TRY[key]; if (!t) return;`,
  // 所以 t 必為 HELP_TRY 的成員;該表每個 toast 都是寫死的字面字串(實測:非字面值的 `toast:` grep 回 0,
  // 全檔無 `.toast =` 賦值),零插值、零使用者資料。新增 HELP_TRY 條目時若 toast 改成樣板字串要重審。
  [`t.toast`, '使用說明「試一次」:t 必為 HELP_TRY 成員,其 toast 全是寫死字面字串,無插入'],
  ["j.why===''?'':`${st.name}${Math.round(j.distM)},(${j.r})`", '單站打卡:st.name 來自內建班表/路線資料;distM 是 haversineKm 計算值,r 是 CHECKIN_RADIUS_M 數字常數'],
  ['`${st.name}`', '單站打卡:st 只由 nearbyStationCandidates 的內建班表/路線車站產生,站名不可由使用者編輯'],
  // 2026-08-26 登記:網站 OpenFreeMap 失效提示(ofmNoticeWeb,來自 origin/main 的 fdf04b0)。
  // main 上沒有人跑 App 發版閘門,所以這條進 App 血脈的第一天才被擋——不是回歸。
  // 實查:canSat = !!document.getElementById('satBtn') ⇒ 布林;三段字串(前綴與三元的兩個分支)
  // 全是寫死字面值,全檔 canSat 只出現 2 次(宣告＋此處),零插值、零使用者資料。
  // 指紋帶著 canSat 這個專屬變數名 ⇒ 只涵蓋這一個呼叫點,不會一次放行所有同形呼叫。
  [`''+(canSat?'':''),{wrap:true}`, '底圖失效提示:canSat 是布林,兩個分支與前綴都是寫死字串,無插入'],
  // 2026-08-15 登記:北捷官方訊號恢復通知(trtcOfficialResyncTick,index.html:5059,斷訊挽救批次)。
  // msg 是本地變數,由三個插值組成、全部是數字:
  //   mins    = Math.max(1, Math.round(r.outageSec / 60));r.outageSec 唯一寫入點是
  //             `Math.max(Number(...) || 0, coastedFor)`(index.html:5197)⇒ 數字
  //   count   = r.count,唯一寫入點是 `(Number(...) || 0) + 1`(index.html:5198)⇒ 數字
  //   removed = Number(rec.removed),且被 `Number(rec.removed) > 0` 守著 ⇒ 有限正數
  // rec 來自自家 /api/trtc-live 的 recovery 物件,但即使上游吐 HTML 字串,Number() 也會變 NaN
  // 而被 >0 擋掉。三處皆無字串路徑進 innerHTML;句中的 <b> 是刻意的粗體排版。
  [`msg,{wrap:true}`, '官方訊號恢復通知:三個插值(分鐘/台數/移除台數)全經 Number()/Math.* 收斂為數字,無字串來源'],
  // 2026-08-16 登記:通行證提示批次的兩發說明型 toast(看板的小工具引導、衛星的高解析說明)。
  // 這個指紋是**偵測器的已知假陽性**,不是「有插入但我判斷安全」:blankLiterals 把整段字面字串
  // 換成 '',於是只剩選項物件 `{wrap:true}` 裡的識別字 `wrap` 被 toastHasInjection 認成插入。
  // 這一格涵蓋的呼叫形狀是【單一字串字面值 ＋ {wrap:true}】,結構上不存在插入點:
  //   · 若有人日後改成 showToast('前綴' + name, {wrap:true}),blankLiterals 後是 ''+name,{wrap:true}
  //     ⇒ 指紋不同 ⇒ 仍會被擋下來(這一格【不會】順便放行拼接版本)。
  //   · 若改成樣板字串帶插值,指紋也會帶著 ${...} 而不同,同樣擋得住。
  [`'',{wrap:true}`, '純字面字串＋{wrap:true} 選項:指紋裡的 wrap 是選項名不是插值,無任何值進 innerHTML'],
  // 2026-08-14 登記:捷運等車卡(Task 6)。
  [`res&&res.why===''?'':''`, '等車卡開卡失敗:兩個寫死字串二選一(why===disabled 與否),無插入'],
  [`''+escHtml(String(station||''))+''`, '等車卡深連結找不到站:station 來自小工具深連結(外部輸入),已 escHtml 逸出;verify_metro_wait_entry.mjs H 組實測覆蓋'],
  ['`${st.name}${e&&e.n>1?`(${escHtml(e.n)})`:\'\'}`', '單站打卡成功:站名來自內建資料;e.n 從 localStorage 重讀且寫入失敗時可能保留髒值,故已逸出'],
  ['`${st.name}${tr.stops[toIdx].name}`+(j.ok?\'\':\'\')', '開始搭乘:兩個站名都來自 state.trains 的內建班表停靠站;j.ok 只選擇兩個寫死字串'],
  ['`${escHtml(r.fromName)}${st.name}${n}`', '完成搭乘:r.fromName 從 localStorage 還原故已逸出;st.name 由內建班表重建,n 是索引相減後的數字'],
  ['`${pts}24`', '懸賞認領成功:示範卡與 API 點數都先經 bountyNum 收斂為有限非負整數'],
  [`''+(j.error===''?'':'')`, '懸賞 API 的 error 只用來選擇兩個寫死字串,API 回傳內容本身沒有插入'],
  ['`${pts}`', '懸賞認領落盤失敗提示:pts 已先經 bountyNum 收斂為有限非負整數'],
  ['`${escHtml(r.train)},`', '搭乘衝突提示:r.train 從 localStorage 還原,已在進入 innerHTML 前逸出'],
  // 2026-08-18 登記:北捷官方位置的兩則說明。兩者插入的**全部是我們自己算出來的數字**
  // (count/maxM 經 Math.round、mins/count/removed 經 Math.max/Math.round/Number),
  // 沒有任何官方或使用者字串進得來;<b> 是刻意的排版。
  // 🔴 變數名故意不叫 `msg`:指紋是「拿掉字串內容後的結構」,登記 `msg,{wrap:true}` 等於放行
  //    未來所有同形呼叫。取專屬名字讓這兩條只涵蓋這兩個呼叫點,新的通用 msg 仍會被擋下來。
  [`resyncMsg,{wrap:true}`, 'trtcOfficialResyncTick:只插入 mins/count/removed,三者皆先經 Math 收斂為數字'],
  // 2026-08-28 多語化：下列呼叫只是在原本已審查的值外包 t(...)。t 不做 HTML 逸出，
  // 所以使用者／外部字串仍逐一要求 escHtml；數量則經 i18nNumber 收斂成在地化數字。
  [`t(core?'':'')`, 'Core 跟隨失聯提示:core 只選兩個固定翻譯 key'],
  [`t(info.done?'':'')`, '班次結束提示:info.done 只選兩個固定翻譯 key'],
  [`t('',{note})`, '定位失敗提示:note 只來自同函式四個固定且已翻譯的說明'],
  [`t('',{n:i18nNumber(out.added),updated:out.updated?t('',{n:i18nNumber(out.updated)},out.updated):'',skipped:out.skipped?t('',{n:i18nNumber(out.skipped)},out.skipped):'',},out.added)`,
    '匯入結果:added/updated/skipped 全是匯入計數並經 i18nNumber'],
  [`label?t('',{label:escHtml(label)}):t('')`, '儲存地點提示:使用者地點名已 escHtml'],
  [`t('',{station:escHtml(stationName(f.name,f.metroSysId||f.sys))})`, '最愛車站跳轉提示:收藏站名經 stationName 後已 escHtml'],
  [`j.why===''?t(''):t('',{station:escHtml(stationName(st.name,st.sys)),distance:i18nNumber(Math.round(j.distM)),radius:i18nNumber(j.r)})`,
    '單站打卡失敗:站名已 escHtml,距離與半徑是數字'],
  [`t('',{station:escHtml(stationName(st.name,st.sys))})`, '單站打卡提示:站名已 escHtml'],
  [`t('',{station:escHtml(stationName(st.name,st.sys)),count:e&&e.n>1?t('',{n:i18nNumber(e.n)},e.n):''})`,
    '單站打卡成功:站名已 escHtml,次數經 i18nNumber'],
  [`t('',{from:escHtml(stationName(st.name,tr.sys)),to:escHtml(stationName(tr.stops[toIdx].name,tr.sys)),note:j.ok?'':t('')})`,
    '開始搭乘:兩端站名已 escHtml,note 只選固定翻譯 key'],
  [`t('',{from:escHtml(stationName(r.fromName,tr.sys)),to:escHtml(stationName(st.name,tr.sys)),n:i18nNumber(n)},n)`,
    '完成搭乘:localStorage 起站與目的站皆已 escHtml,站數經 i18nNumber'],
  [`t(res&&res.why===''?'':res&&res.why===''?'':'')`, '等車卡開卡結果:why 只被比較,三個固定翻譯 key 三選一'],
  [`t('',{station:escHtml(String(station||''))})`, '等車卡深連結站名屬外部輸入,已 escHtml'],
  [`t(canSat?'':''),{wrap:true}`, '底圖失效提示:canSat 只選兩個固定翻譯 key'],
  [`t(action.toast)`, '使用說明「試一次」:action 是 HELP_TRY 固定成員,toast 為固定翻譯 key'],
  [`t(on?'':'')`, '省電模式提示:on 只選兩個固定翻譯 key'],
  [`p.label?t('',{label:escHtml(p.label)}):t('')`, '預設啟動地點提示:使用者地點名已 escHtml'],
]);

// 掃出每一個 showToast( 呼叫的完整參數（括號配對，不是 regex 抓一行）。
export function showToastCalls(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf('showToast(', i)) !== -1) {
    if (/[\w$.]/.test(src[i - 1] || '')) { i += 10; continue; }   // 別把 xxxShowToast( 當成它
    const isDecl = /function\s+showToast\s*\($/.test(src.slice(Math.max(0, i - 12), i + 10));
    let j = i + 10, depth = 1;
    const start = j;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '(') depth++; else if (c === ')') depth--;
      j++;
    }
    if (!isDecl) out.push(src.slice(start, j - 1));
    i = j;
  }
  return out;
}

const blankLiterals = s => s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
export const toastFingerprint = raw => blankLiterals(raw).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '');

// 有沒有東西被插進去：拿掉 escHtml(...) 與字串內容後還剩識別字 ⇒ 有。
export function toastHasInjection(raw) {
  // t(...) 只是翻譯包裝，不會把內容變成 HTML；真正要審的是它的插值值。
  // 物件的 `name:`／`n:` 是插值欄位名稱，也不是值。兩者若不先排除，多語化後連
  // `showToast(t('固定字串'))` 都會被誤判；但 `{ name: userValue }` 的 userValue 仍會留下。
  const rest = blankLiterals(raw.replace(/escHtml\([^()]*\)/g, ''))
    .replace(/\bt\s*\(/g, '(')
    .replace(/\b[A-Za-z_$][\w$]*\s*:/g, ':')
    .replace(/[^\x20-\x7E]/g, '');
  return (rest.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [])
    .some(id => !['true', 'false', 'null', 'undefined'].includes(id));
}

export function assertToastSinksReviewed(html) {
  // 自檢：壞掉的偵測器不會報錯，它會安靜地讓每一樣東西通過——那比沒有閘門更糟，因為看起來是綠的。
  // 所以每次建置都先拿一個合成的惡意呼叫試它一次，認不出來就當場失敗。
  const canary = showToastCalls(`showToast('嗨' + attackerControlledName + '你好')`);
  assert(canary.length === 1 && toastHasInjection(canary[0]),
    'showToast 注入偵測器失效——連合成的未逸出拼接都認不出來,這道閘門已經沒有牙,不可發行');
  assert(!TOAST_REVIEWED.has(toastFingerprint(canary[0])), '合成樣本不該出現在審查帳本裡');

  const calls = showToastCalls(html);
  assert(calls.length >= 25, `showToast 呼叫點只掃到 ${calls.length} 個——掃描器壞了,不可當作通過`);
  const unreviewed = calls.filter(toastHasInjection).map(toastFingerprint).filter(fp => !TOAST_REVIEWED.has(fp));
  assert(unreviewed.length === 0,
    `showToast 有未經審查的動態插入（會直接進 innerHTML）,不可發行。\n` +
    unreviewed.map(fp => `      ${fp}`).join('\n') +
    `\n    請確認插入的值是否含使用者資料:含就包 escHtml(),確定安全就把上面的指紋登記進 verify-release.mjs 的 TOAST_REVIEWED 並寫明理由。`);
}

// ── Esri 金鑰活體檢查 ───────────────────────────────────────────────────────
// 為什麼需要它:2026-07-26 稽核發現網站那把 Esri token 早就失效,卻九天沒人察覺——因為判斷
// 「金鑰還活著嗎」用的證據是「衛星圖出得來」,而那個證據是假的:Esri 的**圖磚**端點只檢查
// token 參數在不在、不看值(實測撒哈拉 z17 冷門座標,真 token／`token=x`／亂打字串三者都回
// HTTP 200 且同樣 6416 bytes,完全不帶 token= 才回 499)。所以:
//   (1) 一律改打會真的驗證的 basemapstyles v2,不准用圖磚端點驗任何金鑰;
//   (2) 一定要**同時**打一串亂打的假金鑰當對照組。少了對照組,這道閘門哪天被換到另一個
//       不驗證的端點上,它會安靜地一直亮綠燈——那比沒有閘門更糟。
// 回應形狀(2026-07-26 實測):有效金鑰=HTTP 200 樣式 JSON;無效金鑰=HTTP 401 且 body 為
// {"error":{"code":498,...}};不帶 token=則是 499。故以「HTTP 狀態/錯誤碼」的組合當判準。
const ESRI_STYLE_PROBE = 'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery';

export async function probeEsriKey(token, fetchImpl = fetch) {
  const res = await fetchImpl(`${ESRI_STYLE_PROBE}?token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  let errorCode = null;
  try { errorCode = JSON.parse(body)?.error?.code ?? null; } catch { /* 非 JSON 或無 error 欄=正常樣式回應 */ }
  return { status: res.status, errorCode, verdict: `HTTP ${res.status}/${errorCode ?? 'ok'}`, alive: res.ok && errorCode === null };
}

export async function assertEsriKeyAlive(token, fetchImpl = fetch) {
  assert(token, 'App 包裡找不到 Esri token,無法檢查金鑰死活');
  // 對照組刻意做成與真金鑰同長度,免得失敗被歸因成「格式不對才被擋」而不是「值無效」。
  const decoy = 'AAPT' + 'x'.repeat(Math.max(60, token.length - 4));
  let live, dead;
  try {
    [live, dead] = await Promise.all([probeEsriKey(token, fetchImpl), probeEsriKey(decoy, fetchImpl)]);
  } catch (e) {
    fail(`連不上 ArcGIS,無法確認 Esri 金鑰死活（${e.message}）——這道閘門根本沒跑過,不可當作通過。`
      + '請確認網路後重跑;確實要在離線環境建置,設 RAIL_SKIP_KEY_LIVENESS=1 自行負責。');
  }
  // (1) 對照組先判:假金鑰擋不掉 ⇒ 這個端點不驗證 token 的值。
  assert(dead.errorCode === 498,
    `Esri 金鑰活體檢查沒有鑑別力:一串亂打的假金鑰竟拿到 ${dead.verdict}（預期 HTTP 401/498 Token Invalid）——`
    + '驗到的是一個不驗證的端點,等於沒驗。這正是 2026-07-26 那把死了九天的網站金鑰能一直「看起來正常」的原因。'
    + `請確認 ${ESRI_STYLE_PROBE} 仍是會驗證 API key 的端點,修好探針再發行——不要放寬判準讓它過。`);
  // (2) 正負對照:走到這裡代表假金鑰已被擋下,所以「兩邊一樣」只可能是真金鑰也被擋=它死了。
  assert(live.verdict !== dead.verdict,
    `Esri 金鑰已失效:打包進 App 的金鑰與對照用的假金鑰拿到完全相同的結果（${live.verdict}）,`
    + 'ArcGIS 對兩者一視同仁 ⇒ 這把金鑰的值沒有任何效力。'
    + '請到 https://location.arcgis.com/ 開一張新憑證（先設權限、最後才 Generate;只勾 Basemaps）,'
    + '更新 repo 根 .env 的 ESRI_API_KEY 後重建。切勿用「衛星圖還出得來」當作金鑰有效的證據。');
  // (3) 真金鑰必須真的通過,而不只是「跟假的不一樣」。
  assert(live.alive,
    `打包進 App 的 Esri 金鑰未通過 ArcGIS 驗證（${live.verdict}）,不可發行。`
    + '請確認 repo 根 .env 的 ESRI_API_KEY 是有效且權限含 Basemaps 的憑證。');
  return { live, dead };
}

export async function verifyRelease({
  out = defaultOut,
  expectLicensedMusic,
  expectLicensedBasemaps,
  expectMetroCore = process.env.RAIL_EXPECT_METRO_CORE === '1' ? true
    : process.env.RAIL_EXPECT_METRO_CORE === '0' ? false : undefined,
  expectPlusSandboxBuild = process.env.RAIL_PLUS_SANDBOX_OK === '1'
    ? String(process.env.RAIL_PLUS_SANDBOX_BUILD || '') : null,
  skipNativeSyncCheck = false
} = {}) {
  const output = resolve(out);
  const files = await walk(output);
  const relativeFiles = files.map(file => relative(output, file).replaceAll('\\', '/'));
  const indexPath = join(output, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const nativeBridgeSource = await readFile(join(appRoot, 'src/native-bridge.mjs'), 'utf8');
  const packagedBridge = await readFile(join(output, 'native-bridge.js'), 'utf8');
  const androidManifest = await readFile(join(appRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  verifyAndroidWidgetParity();
  assertAndroidPreciseLocationContract({ nativeBridgeSource, packagedBridge, androidManifest });
  assertAndroidBackButtonContract({ nativeBridgeSource, packagedBridge, html });
  assertAppLineageContent(html);
  assertWidgetPlusSyncSites(html);

  // ── 創始會員截止時刻的「上線錨點」(B-4,2026-08-03 裁示)───────────────────────
  // 創始價視窗＝上線錨點時刻起算固定 30 天。上線錨點由 revenuecat-config.js 的
  // window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt 提供(見該檔註解),程式碼本身不留猜的
  // 日期。index.html 端「未設定」有安全預設(foundingFrom() 一律回傳 false,沒人是創始
  // 會員)——但那個安全預設是給網站用的(網站部署不經過這支腳本,沒有等效閘門);App 一旦
  // 送審就無法即時改,所以這裡是唯一會把「忘了填」或「填了過去式舊值」擋成 build 失敗的地方,
  // 不讓需要人為決定的值靠「安全預設」矇混過關溜上線。
  const revenuecatSource = await readFile(join(output, 'revenuecat-config.js'), 'utf8');
  const foundingLaunchAtMatch = revenuecatSource.match(/foundingLaunchAt\s*:\s*(null|false|'([^']*)'|"([^"]*)")/);
  assert(foundingLaunchAtMatch,
    'revenuecat-config.js 找不到 foundingLaunchAt 欄位——請在該檔 window.RAIL_REVENUECAT_CONFIG 補上 '
    + "foundingLaunchAt(ISO8601 時刻字串,建議台北時區午夜整點,例如 '2026-09-01T00:00:00+08:00';"
    + '這一版不辦創始期就填 false)');
  // false ＝「明確裁示這一版不辦創始期」(2026-08-09)。刻意與 null 分開:null 是「還沒決定」,
  // 兩者若共用同一個值,這道閘門就再也分不出「決定不辦」與「忘了決定」——而它存在的唯一理由
  // 正是後者。false 直接放行,不必也不該再比對日期(沒有窗,自然沒有「早於 build 日」可言);
  // index.html 的 FOUNDING_LAUNCH_MS 對它解析出 NaN,foundingFrom() 一律回 false ⇒ 沒人是創始會員。
  if (foundingLaunchAtMatch[1] === 'false') {
    console.log('  · foundingLaunchAt=false：本版不辦創始期（明確裁示,非「忘了填」）');
  } else {
    const foundingLaunchAtRaw = foundingLaunchAtMatch[1] === 'null'
      ? null
      : (foundingLaunchAtMatch[2] !== undefined ? foundingLaunchAtMatch[2] : foundingLaunchAtMatch[3]);
    assert(foundingLaunchAtRaw !== null && foundingLaunchAtRaw !== '',
      `revenuecat-config.js 的 foundingLaunchAt 尚未設定(目前是${foundingLaunchAtRaw === null ? ' null' : '空字串'})——`
      + '這是發版流程要在按下發版當下才決定的值,請把實際上線日期填進 revenuecat-config.js 的 '
      + 'window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt 後重新建置');
    const foundingLaunchAtMs = Date.parse(foundingLaunchAtRaw);
    assert(Number.isFinite(foundingLaunchAtMs),
      `revenuecat-config.js 的 foundingLaunchAt 不是可解析的日期(目前值：${foundingLaunchAtRaw})——`
      + '請改成 ISO8601 時刻字串並修正 revenuecat-config.js 的 window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt');
    // 用台北時區的「今天 00:00」當比較基準(不比對時分秒),避免同一個日曆日內因為 build 執行的
    // 時刻不同而誤判。
    const buildDayTaipei = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const buildDayStartMs = Date.parse(`${buildDayTaipei}T00:00:00+08:00`);
    // 🔴 2026-08-11 改判準。原本這裡斷言「錨點不得早於 build 當天」——那是在「先訂上線日、
    // 再出 build」的世界寫的。8/10 12:00 窗一開跑,之後每一顆 build 的日期都必然晚於錨點,
    // 原判準會把整個窗期內的出貨全部擋死(1.4.2(43) 就是第一顆撞上的),而那些 build 完全合法。
    // 它真正要防的從來不是「錨點在過去」,而是「一個沒人在看的過期日期溜上線」——那件事的特徵
    // 是**窗已經關了、程式碼卻還宣稱在辦創始期**。故改成：build 當天必須落在窗內。
    // 窗長不手打,從 index.html 的 FOUNDING_UNTIL_MS 讀回來(判準的數字要跟受測物同源,心得 35);
    // 讀不到就 FAIL,不准退回猜一個預設值——窗長改寫法時這道閘門必須跟著被迫更新。
    const windowDaysMatch = html.match(/FOUNDING_LAUNCH_MS\s*\+\s*(\d+)\s*\*\s*86400000/);
    assert(windowDaysMatch,
      'index.html 找不到創始期窗長的定義(FOUNDING_LAUNCH_MS + N * 86400000)——窗長改寫法時,'
      + '這道閘門要跟著改;它刻意不設預設值,免得判準與程式碼各說各話');
    const windowDays = Number(windowDaysMatch[1]);
    const foundingUntilMs = foundingLaunchAtMs + windowDays * 86400000;
    assert(buildDayStartMs < foundingUntilMs,
      `revenuecat-config.js 的 foundingLaunchAt(${foundingLaunchAtRaw})起算 ${windowDays} 天的創始期視窗,`
      + `在本次 build 的日期(${buildDayTaipei})之前就已經結束——程式碼還宣稱在辦創始期,但窗早就關了。`
      + '請更新 window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt;若這一版不打算辦創始期,把它改成 false');
    const daysLeft = Math.ceil((foundingUntilMs - buildDayStartMs) / 86400000);
    console.log(`  · foundingLaunchAt=${foundingLaunchAtRaw}（窗 ${windowDays} 天，本次 build 當天起還剩 ${daysLeft} 天）`);
  }

  const musicEnabled = html.includes('window.RAIL_MUSIC_AVAILABLE=true');
  const basemapsEnabled = html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=true');
  const metroCoreMatch = /window\.RAIL_METRO_CORE_ENABLED=(true|false)/.exec(html);
  assert(metroCoreMatch, '所有 build 都必須明確注入 window.RAIL_METRO_CORE_ENABLED');
  const metroCoreEnabled = metroCoreMatch[1] === 'true';

  if (expectLicensedMusic !== undefined) {
    assert(musicEnabled === expectLicensedMusic, '音樂功能旗標與本次 build 模式不一致');
  }
  if (expectLicensedBasemaps !== undefined) {
    assert(basemapsEnabled === expectLicensedBasemaps, '線上底圖旗標與本次 build 模式不一致');
  }
  if (expectMetroCore !== undefined) {
    assert(metroCoreEnabled === expectMetroCore, 'Metro Core 旗標與本次 build 模式不一致');
  }
  assert(html.includes("typeof window.RAIL_METRO_CORE_ENABLED === 'boolean'"),
    'App 內的 index.html 沒有把 Metro Core 發版旗標當成顯式布林覆寫');
  assert(/L\.map\('map',\s*\{[^}]*zoomAnimation:\s*false\s*\}/.test(html),
    'App 地圖必須在 L.map 建構時設定 zoomAnimation:false；圖磚 CSS 補間會與獨立 overlay canvas 失步');

  // 版本號對**所有** build 模式都必須注入(不是只有授權底圖 build)——App 內的更新提示與評分
  // 全靠它判斷「手上這顆是哪一版」。刻意寫在模式分支之外:放進安全 build 的條件裡就漏掉另一半。
  const appVerMatch = /window\.RAIL_APP_VERSION="([^"]+)"/.exec(html);
  assert(appVerMatch, '所有 build 都必須注入 window.RAIL_APP_VERSION（更新提示與評分靠它判版本）');
  assert(/^\d+(\.\d+)*$/.test(appVerMatch[1]),
    `RAIL_APP_VERSION 格式無法解析：${appVerMatch[1]}——版本比較會直接放棄,提示永遠不出現`);
  const expectedAppVersion = String(process.env.RAIL_EXPECT_APP_VERSION || '').trim();
  if (expectedAppVersion) {
    assert(appVerMatch[1] === expectedAppVersion,
      `RAIL_APP_VERSION=${appVerMatch[1]}，與本次預期 ${expectedAppVersion} 不一致`);
    const androidGradle = await readFile(join(appRoot, 'android/app/build.gradle'), 'utf8');
    const androidVersionName = /\bversionName\s+["']([^"']+)["']/.exec(androidGradle)?.[1] || null;
    assert(androidVersionName === expectedAppVersion,
      `Android versionName=${androidVersionName || '找不到'}，與 App 內建版本 ${expectedAppVersion} 不一致`);
  }
  const expectedAndroidVersionCode = String(process.env.RAIL_EXPECT_ANDROID_VERSION_CODE || '').trim();
  if (expectedAndroidVersionCode) {
    const androidGradle = await readFile(join(appRoot, 'android/app/build.gradle'), 'utf8');
    const androidVersionCode = /\bversionCode\s+(\d+)/.exec(androidGradle)?.[1] || null;
    assert(androidVersionCode === expectedAndroidVersionCode,
      `Android versionCode=${androidVersionCode || '找不到'}，與本次預期 ${expectedAndroidVersionCode} 不一致`);
  }

  // 本版「更新了什麼」內建文案:剛更新完的彈窗與「更多」面板的常駐入口都吃它。
  // 判準刻意是「文案裡要出現本版版號」——擋的正是「版號升了、set-release-mode 的 why
  // 忘了改」那個形狀(1.4.8 舊文頂著 1.4.9 出門,就是 build 74 被使用者當場抓到的事故)。
  // sandbox 測試包豁免:那類 why 是測試說明,不跟行銷版號連動。
  const whatsNewMatch = /window\.RAIL_APP_WHATS_NEW="((?:[^"\\]|\\.)*)"/.exec(html);
  assert(whatsNewMatch, '發行包缺少 window.RAIL_APP_WHATS_NEW 注入——剛更新完的「更新了什麼」會整組消失。'
    + '請經由 set-release-mode 出貨(它把發行模式的 why 傳給 prepare-web),不要手呼 prepare-web');
  if (expectPlusSandboxBuild === null) {
    const notes = JSON.parse(`"${whatsNewMatch[1]}"`);
    assert(notes.trim().length > 0, 'RAIL_APP_WHATS_NEW 是空的——這一版的更新內容沒寫。'
      + '請更新 set-release-mode.mjs 該模式的 why(它同時是送審 What’s New 與 App 內更新內容)');
    assert(notes.includes(appVerMatch[1]),
      `RAIL_APP_WHATS_NEW 文案裡沒有本版版號 ${appVerMatch[1]}——十之八九是版號升了、`
      + 'set-release-mode.mjs 的 why 還是上一版的文。每一版都要重寫 why(=App 內「更新了什麼」)');

    // 英日整段文案。1.5.1 之前只注入中文 ⇒ 英日使用者更新完看到的是標著「中文原文」的
    // 中文說明(日文實機截圖為證),而那一版的頭條正好是「三語真的切得動了」。
    // 判準刻意驗到「字裡真的是那個語言」:只驗有值的話,把中文貼進 whyEn 也會過,
    // 而那比現況更糟——連「中文原文」標籤都不會出現。
    for (const [lang, key, why] of [['en', 'RAIL_APP_WHATS_NEW_EN', 'whyEn'], ['ja', 'RAIL_APP_WHATS_NEW_JA', 'whyJa']]) {
      const m = new RegExp(`window\\.${key}="((?:[^"\\\\]|\\\\.)*)"`).exec(html);
      assert(m, `發行包缺少 window.${key} 注入——${lang} 使用者的「更新了什麼」會退回中文。`
        + `請在 set-release-mode.mjs 該模式補 ${why}`);
      const text = JSON.parse(`"${m[1]}"`);
      assert(text.trim().length > 0, `${key} 是空的——${lang} 使用者會看到中文更新說明。補 set-release-mode.mjs 的 ${why}`);
      assert(text.includes(appVerMatch[1]),
        `${key} 裡沒有本版版號 ${appVerMatch[1]}——中文改了但 ${why} 還是上一版的文`);
      if (lang === 'en') {
        // 用比例不用「零漢字」:英文裡本來就會有站名(廣慈/奉天宮這種 App 自己也顯示中文、
        // stations.json 沒英文名的站),寫羅馬拼音反而跟 App 內顯示不一致。實測 0.3%;
        // 誤把整段中文貼進來是 84%。10% 兩邊都有數量級的餘裕。
        const nonSpace = text.replace(/\s/g, '');
        const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
        assert(han / Math.max(1, nonSpace.length) < 0.10,
          `${key} 有 ${han}/${nonSpace.length} 是漢字——十之八九是把中文貼進 whyEn 了。這比沒填更糟:`
          + '沒填會退回中文並標「中文原文」,填錯則是無標記的中文');
      } else {
        // 「有沒有假名」對這件事沒有牙:中黑點「・」(U+30FB)在片假名區塊,而中文 why 的
        // 條列正是用它 ⇒ 整段中文貼進 whyJa 照樣通過(2026-08-30 突變測試實測:中文 why
        // 8 個「假名」全是・)。改量【平假名】比例——中文不可能有平假名,日文散文則滿是
        // は/の/を/が。實測:日文 41.5%(Android)、37.9%(iOS 1.5.1),貼中文 0.0%,
        // 10% 兩邊各有一個數量級的餘裕。
        const hira = (text.match(/[\u3041-\u3096]/g) || []).length;
        const nonSpaceJa = text.replace(/\s/g, '').length;
        assert(hira / Math.max(1, nonSpaceJa) >= 0.10,
          `${key} 只有 ${hira}/${nonSpaceJa} 是平假名——十之八九是把中文貼進 whyJa 了。`
          + '注意條列用的「・」是片假名區塊的字元,光看「有沒有假名」擋不住整段中文');
      }
    }
  }

  if (expectPlusSandboxBuild !== null) assertPlusSandboxTestBuild(html, expectPlusSandboxBuild);
  else assertPlusSandboxOff(html);
  assertAndroidPlusGate(html);
  const androidGradleForPlus = await readFile(join(appRoot, 'android/app/build.gradle'), 'utf8');
  const androidVersionCodeForPlus = /\bversionCode\s+(\d+)/.exec(androidGradleForPlus)?.[1] || '';
  assertAndroidPlusReleaseConfig(html, androidVersionCodeForPlus);

  await assertLicensedBuildAllowed({
    includeLicensedMusic: musicEnabled,
    includeLicensedBasemaps: basemapsEnabled
  });

  const required = [
    'index.html', 'account-deletion.html', 'app-support.html',
    'privacy.html', 'terms.html',
    'firebase-config.js', 'revenuecat-config.js', 'native-bridge.js',
    'third-party-notices.txt',
    'i18n/translations.js', 'i18n/content-translations.js',
    'i18n/legal-translations.js', 'i18n/legal-pages.js', 'i18n/stations.json',
    'data/taiwan_land.json', 'vendor/leaflet/leaflet.css',
    'vendor/leaflet/leaflet.js', 'vendor/fflate.js', 'vendor/firebase.mjs'
  ];
  for (const file of required) assert(relativeFiles.includes(file), `缺少必要檔案：${file}`);

  // 首頁相對連結完整性：頁面內每個指向本機 .html／.txt 的連結都要有對應檔案,
  // 否則像 privacy.html／terms.html 那樣在 Capacitor 本機來源回 404（QA 2026-07-21）。
  const relativeSet = new Set(relativeFiles);
  const linkTargets = new Set();
  for (const [, value] of html.matchAll(/href="([^"#]+\.(?:html|txt))"/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) continue; // 略過 http(s):／mailto: 等外部連結
    linkTargets.add(value.replace(/^\.?\//, ''));
  }
  for (const target of linkTargets) {
    assert(relativeSet.has(target), `首頁連結指向未打包檔案（會 404）：${target}`);
  }

  const forbiddenNames = [
    /(^|\/)AGENTS\.md$/i,
    /(^|\/)TODO\.md$/i,
    /(^|\/)火車頭(\/|$)/,
    /(^|\/)\.env(?:\.|$)/i,
    /(^|\/)授權查證[^/]*$/,
    /(^|\/)安全審查[^/]*$/,
    /(^|\/)_專案資訊\.html$/,
    /(^|\/)hand off(\/|$)/i,
    /\.map$/i
  ];
  for (const file of relativeFiles) {
    assert(!forbiddenNames.some(pattern => pattern.test(file)), `含內部或禁止發行檔案：${file}`);
  }

  assert(html.includes('vendor/leaflet/leaflet.css') && html.includes('vendor/leaflet/leaflet.js'),
    'App 必須使用內建 Leaflet');
  assert(!html.includes('cdnjs.cloudflare.com/ajax/libs/leaflet'), 'App 仍依賴遠端 Leaflet CDN');
  assert(!/ko-fi|PayPal|111010691056|web-only-donation-log|贊助方式更新/i.test(html),
    'App 仍含網站外部贊助內容');
  assert(!html.includes('class="foot-box foot-donate"') && !html.includes('id="donateCopy"'),
    'App 仍含外部贊助操作元件');
  assert(!/cartocdn\.com|arcgisonline\.com/i.test(html),
    'App 不可含 CARTO／Esri legacy 圖磚網址');
  assert(/href="third-party-notices\.txt"[^>]*min-height:44px/.test(html),
    'App 頁尾缺少 44px 觸控高度的第三方軟體授權入口');
  const notices = await readFile(join(output, 'third-party-notices.txt'), 'utf8');
  // 'Noto Emoji'：唯一一條不是 npm 依賴的授權（換圖批次內嵌的字型子集）。列進來是因為
  // third-party-notices.txt 是每次 build 重新生成的——條目從 prepare-web 的陣列裡消失時，
  // 產物看起來一樣正常，沒有人會發現我們在沒有附授權的情況下散布一份 OFL 字型。
  for (const name of ['Capacitor', 'Firebase', 'RevenueCat', 'Leaflet', 'fflate', 'Noto Emoji']) {
    assert(notices.includes(name), `第三方軟體授權聲明缺少 ${name}`);
  }

  const musicFiles = relativeFiles.filter(file => file.startsWith('suno musics/'));
  if (musicEnabled) {
    // 🔴 判準刻意【不是】一個寫死的首數(舊版寫死 29,曲庫一換就得回來改一個魔術數字,而且
    //    數字對了不代表檔案對)。改成與打包進去的 index.html 自己宣告的 MUSIC_BUNDLED 逐檔比對:
    //    少一首=飛航模式下那首靜默播不出來,多一首=白白墊高 App 下載大小,兩種都會當場紅。
    const block = html.match(/const MUSIC_BUNDLED = new Set\(\[([\s\S]*?)\]\);/);
    assert(!!block, '含音樂 build 的 index.html 必須宣告 MUSIC_BUNDLED');
    const declared = [...block[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
      .map(m => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
    assert(declared.length > 0, 'MUSIC_BUNDLED 解析出 0 首');
    const shipped = new Set(musicFiles.filter(file => /\.mp3$/i.test(file))
      .map(file => file.slice('suno musics/'.length)));
    const missing = declared.filter(rel => !shipped.has(rel));
    const extra = [...shipped].filter(rel => !declared.includes(rel));
    assert(missing.length === 0, `內建曲目缺 ${missing.length} 首:${missing.slice(0, 3).join('、')}`);
    assert(extra.length === 0, `bundle 多出 ${extra.length} 首不在 MUSIC_BUNDLED:${extra.slice(0, 3).join('、')}`);

    // 🔴 2026-08-27 補：把「授權核對表」綁到「實際會播的曲目」。
    //    為什麼非有不可：核對表的首數斷言(上面 readReleasePolicy 那段)只是核對表與一個常數
    //    互相同意,兩者可以一起停在舊曲庫上而閘門全綠——曲庫 29→57 那次就是這樣穿過去的
    //    (核對表 29 列、斷言 ===29、App 裡卻是另一批 57 首,零告警)。判準要架在產物上。
    const chk = await readFile(join(appRoot, 'MUSIC_LICENSE_CHECKLIST.md'), 'utf8');
    const listed = new Set(chk.split('\n').filter(line => /^\| .+\.mp3 \|/.test(line))
      .map(line => line.split('|')[1].trim()));
    const allBlock = html.match(/const MUSIC_FILES = \[([\s\S]*?)\];/);
    assert(!!allBlock, '含音樂 build 的 index.html 必須宣告 MUSIC_FILES');
    const allTracks = [...allBlock[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
      .map(m => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
    const noLicence = allTracks.filter(rel => !listed.has(rel));
    const orphan = [...listed].filter(rel => !allTracks.includes(rel));
    assert(noLicence.length === 0,
      `有 ${noLicence.length} 首會播但不在授權核對表裡:${noLicence.slice(0, 3).join('、')}`);
    assert(orphan.length === 0,
      `授權核對表有 ${orphan.length} 首已不在曲目清單裡(核對表沒跟上換庫):${orphan.slice(0, 3).join('、')}`);

    // 🔴 車聲圖層(2026-09-03):Envato 授權的鐵軌環境音 loop,只在含音樂 build 內建、不進 repo 不上網站。
    //    缺檔或旗標沒帶的症狀只有「車聲開關不見了」,沒有別的訊號;授權條目綁在同一份核對表上。
    assert(relativeFiles.includes('audio/train-ride-loop.mp3'), '含音樂 build 必須內建車聲 loop(audio/train-ride-loop.mp3)');
    assert(html.includes('window.RAIL_AMBIENCE_AVAILABLE=true'), '含音樂 build 的 index.html 必須宣告 RAIL_AMBIENCE_AVAILABLE=true');
    assert(chk.includes('train-ride-loop') && /Envato/.test(chk), '音樂授權核對表缺車聲 loop 的 Envato 授權條目');
  }
  else {
    assert(musicFiles.length === 0, '安全 build 不可含 suno musics/');
    assert(html.includes('window.RAIL_MUSIC_AVAILABLE=false'), '安全 build 必須明確關閉音樂');
    assert(!relativeFiles.includes('audio/train-ride-loop.mp3'), '安全 build 不得內建車聲 loop');
    assert(html.includes('window.RAIL_AMBIENCE_AVAILABLE=false'), '安全 build 必須明確關閉車聲圖層');
  }

  if (basemapsEnabled) {
    // 授權底圖走「注入 window.RAIL_APP_CONFIG＋index.html 讀設定」機制(2026-07-22 起),
    // 驗證對象=(1)注入的設定內容 (2)index.html 端的消費機制還活著。不再比對被改寫的程式碼字串。
    assert(html.includes('window.RAIL_APP_CONFIG='), 'App 缺少 RAIL_APP_CONFIG 設定注入');
    assert(html.includes('APP_CFG.tiles'), 'index.html 的 APP_CFG.tiles 圖磚設定機制消失——注入的授權底圖不會被使用');
    assert(/tiles\.stadiamaps\.com\/tiles\/alidade_smooth\/\{z\}\/\{x\}\/\{y\}\.png\?api_key=[^'"\s]+/.test(html),
      '亮色底圖退路不是含 api_key 的 Stadia alidade_smooth——L2 退場時會沒有東西可退');
    assert(/tiles\.stadiamaps\.com\/tiles\/alidade_smooth_dark\/\{z\}\/\{x\}\/\{y\}\.png\?api_key=[^'"\s]+/.test(html),
      '暗色底圖退路不是含 api_key 的 Stadia alidade_smooth_dark——L2 退場時會沒有東西可退');
    const satTokenMatch = html.match(/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\?token=([^'"\s]+)/);
    assert(satTokenMatch, '衛星底圖必須是含 token 的授權 Esri ibasemaps');
    // 2026-08-02:衛星本體維持免費(satLine 那條顧),但高解析(Retina)是 Plus。
    // 這條反過來要求資格函式存在——移除它等於把付費層靜默送掉。
    assert(/function satRetinaAllowed\s*\(/.test(html),
      '衛星高解析的資格判定 satRetinaAllowed() 消失——Retina 會變成全體免費');
    assert(/const wantLQ = [^;]*satRetinaAllowed\(\)/.test(html),
      'setBasemap 的選層條件沒有消費 satRetinaAllowed()——資格判定形同虛設');
    // 原本是逐字比對整行 `const sat = online && state.basemap === 'sat';`，但那樣任何無關的條件
    // （2026-07-26 加的 token 就緒判斷）也會誤擋。改成檢查意圖：判斷式裡不得出現付費條件。
    const satLine = (html.match(/const sat = online && state\.basemap === 'sat'[^;\n]*;/) || [])[0];
    assert(satLine, 'index.html 找不到衛星顯示判斷（const sat = …）——「衛星免費開放」這條檢查已失效');
    assert(!/plus|entitle|paid|subscri|premium/i.test(satLine),
      `App 第一版衛星顯示必須免費開放（不綁 Plus），但判斷式含付費條件：${satLine}`);
    assert(html.includes('  prefetchFollowAhead(dt);'),
      'Stadia App 必須保留既有高速跟車預抓；手機省電模式會自行停用，避免 iPad／關省電模式高速跟車露白');
    // 跟車 zoom 上限:設定要載明 16,且 index.html 的消費機制(FOLLOW_ZOOM_CAP/followEntryZoom)未被移除
    assert(html.includes('"followZoomCap":16'), 'RAIL_APP_CONFIG 未載明 followZoomCap:16(計量底圖跟車上限)');
    // 衛星 Retina 止血開關:只驗機制還活著(值可為 true/false,由 Esri 額度狀況決定)
    assert(/"satRetina":(true|false)/.test(html), 'RAIL_APP_CONFIG 未載明 satRetina(衛星高解析止血開關)');
    assert(html.includes('APP_CFG.satRetina'), 'index.html 的 SAT_RETINA 消費機制消失——App 端衛星解析度開關失效');
    // （DIRECTOR_FOLLOW_Z 那條斷言已隨 2026-09-03 刪除 OBS 導播模式一起拿掉；一般跟車的 z16 上限仍由上一條與下一條守著）
    assert((html.match(/followEntryZoom\(\), \{ animate: false \}/g) || []).length >= 3,
      '跟車進場 followEntryZoom 呼叫點少於 3 處——台鐵／高鐵／捷運跟車 zoom 上限未完整覆蓋');
    assert(html.includes(JSON.stringify(STADIA_ATTRIBUTION)),
      'Stadia 圖磚署名不是官方要求的三組連結逐字內容');
    // ── OSM 向量街道底圖(OpenFreeMap)與它的兩層退路 ─────────────────────────
    // 這批把 App 街道圖從計量的 Stadia 換成不計量的 OpenFreeMap(Stadia 降為退路)。
    // 下面每一條驗的都是「主來源真的裝上去了」——漏掉任何一件,App 會**靜默**退回 Stadia:
    // build 成功、地圖照畫、使用者無感,只有一個月後的帳單知道。所以這裡全部是正向斷言。
    for (const f of ['maplibre-gl.js', 'maplibre-gl.css', 'leaflet-maplibre-gl.js', 'ofm-positron.json', 'ofm-dark.json']) {
      assert(relativeFiles.includes('vendor/' + f), `bundle 缺 vendor/${f}——OFM 街道底圖會靜默退回計費的 Stadia`);
    }
    assert(html.includes(OFM_ATTRIBUTION), 'OpenFreeMap 圖磚署名不是官方要求的三組連結逐字內容（署名是生效要件）');
    assert(html.includes('"streetSrc":"ofm"'), 'RAIL_APP_CONFIG 未載明 streetSrc:"ofm"——這顆 build 的街道底圖預設不是 OpenFreeMap');
    assert(html.includes('APP_CFG.streetSrc'), 'index.html 的 APP_CFG.streetSrc 消費機制消失——注入的預設來源不會被讀取');
    assert(/const useOfmStreet = \(APP_CFG\.tiles \?/.test(html),
      'useOfmStreet 沒有 App 分支——App 會永遠用不到 OFM(舊版是 !APP_CFG.tiles,對 App 恆假)');
    // L1/L2 是「OpenFreeMap 沒有 SLA、而 App 改一行要等審查」的唯一保險,少一層等於沒有。
    assert(html.includes("apiUrl('api/basemap-src')"),
      'L1 遠端來源開關的讀取端消失——OFM 出事時將無法不出版本就切回 Stadia');
    assert(/function ofmWatch\s*\(/.test(html),
      'L2 健康監看 ofmWatch() 消失——OFM 半死時不會有人踩煞車');
    assert(/function ofmFallToRaster\s*\(/.test(html),
      'L2 本地自動退場 ofmFallToRaster() 消失——OFM 載不動時會停在空白地圖');
    assert(html.includes('OpenFreeMap（© OpenFreeMap © OpenMapTiles © OpenStreetMap，街道圖）、Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap，街道圖退路）、Esri World Imagery（衛星影像）與內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版）'),
      'App 頁尾底圖來源未同時包含 OpenFreeMap(主)、Stadia(退路)、Esri 衛星與內政部離線輪廓的署名');
    // 放在本區塊最後:上面全是免費的本機檢查,先讓它們失敗;這一項要連外,擺最後才不會為了
    // 一個過期產物白等網路。驗的是**實際打包進這個 build 的那把金鑰**(不是 .env 當下的值——
    // 兩者可能已經分岔),所以送審包裡的金鑰死活,這裡是最後一道、也是唯一一道會發現的閘門。
    if (process.env.RAIL_SKIP_KEY_LIVENESS === '1') {
      console.warn('⚠️  已跳過 Esri 金鑰活體檢查（RAIL_SKIP_KEY_LIVENESS=1）——這個 build 沒有任何人確認過金鑰還活著。');
    } else {
      await assertEsriKeyAlive(decodeURIComponent(satTokenMatch[1]));
    }
  } else {
    assert(html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=false'), '安全 build 必須明確關閉線上底圖');
    assert(!html.includes('tiles.stadiamaps.com'), '安全 build 不可含 Stadia 圖磚網址或 API key');
    assert(!html.includes('window.RAIL_APP_CONFIG='), '安全 build 不應注入 RAIL_APP_CONFIG(授權圖磚設定)');
  }

  // Stored XSS 迴歸（QA 2026-07-21）：「我的最愛」的列車／站名是使用者資料,可能來自被污染的
  // 匯入或 localStorage。渲染必須以 escHtml 逸出後才進 innerHTML,否則可在 Capacitor WebView 執行 script。
  // 多語版會先把舊收藏的「車種　起站→終點」拆開翻譯，再由 favTrainLabel() 回傳純文字；
  // 安全邊界仍必須在 innerHTML sink 外層，不能把「有經過翻譯函式」誤當成已逸出。
  assert(html.includes('escHtml(f.train)')
      && html.includes('escHtml(favTrainLabel(f))')
      && html.includes('escHtml(t(f.label))'),
    '「我的最愛」未在 innerHTML sink 以 escHtml 逸出列車／車站使用者資料——stored XSS 迴歸,不可發行');
  assert(!/<b>\$\{f\.train\}<\/b>/.test(html),
    '「我的最愛」仍把未逸出的 ${f.train} 直接插入 innerHTML——stored XSS 迴歸,不可發行');

  // Stored XSS：showToast 的參數直接進 innerHTML（announceCollections 等呼叫端刻意傳 <b>），
  // 所以「逸出」的責任在呼叫端。
  //
  // 這裡刻意**不是**逐一比對已知的幾個呼叫點。2026-07-26 上架版的 XSS 之所以能溜到 App Store，
  // 就是因為發行閘門只驗打包正確性、沒有任何安全斷言；而事後補的三條逐字規則同樣只認得那三個
  // 點——新寫的第四個動態 toast 一樣會直接過關。改成結構性規則：**掃描每一個 showToast 呼叫，
  // 凡是有東西被插進字串的，都必須在下面的審查帳本裡**。新增動態 toast ⇒ 閘門紅燈 ⇒ 有人得
  // 真的看過它插的是什麼、決定要不要 escHtml，才能登記放行。預設是擋，不是放。
  assertToastSinksReviewed(html);

  // 版本一致性（QA 2026-07-21）：確保發行包確實含最新網站修正,而不是舊產物綠燈通過。
  const extractBuild = source => source.match(/const BUILD\s*=\s*'([^']+)'/)?.[1] ?? null;
  const wwwBuild = extractBuild(html);
  assert(wwwBuild, 'app/www/index.html 找不到 BUILD 版本戳記');
  const repoIndex = await readFile(join(repoRoot, 'index.html'), 'utf8');
  const repoBuild = extractBuild(repoIndex);
  assert(repoBuild, '根目錄 index.html 找不到 BUILD 版本戳記');
  assertAndroidSafeAreaCssContract(repoIndex);

  // 金鑰不得寫死進公開 repo（稽核 2026-07-26）：2026-07-25 的 commit 5aab5c4 把網站用的 Esri
  // token 直接寫進 index.html，於是隨 public repo 推上 GitHub、也印在 railisland.tw 的網頁原始碼裡。
  // 實測那把 token 無任何 referrer 限制（偽造來源照樣回 200 真圖磚），而 PAYG 是開著的＝被盜用時
  // 帳單沒有天花板。網站金鑰一律改由 Worker 的 /api/basemap-token 下發；App 金鑰由 prepare-web
  // 注入 www（build 產物、不進版控），所以這裡只檢查 repo 根的**原始檔**，不檢查 www。
  assert(!/ibasemaps-api\.arcgis\.com[^'"`\s]*[?&]token=[A-Za-z0-9]/.test(repoIndex),
    'repo 根 index.html 寫死了 Esri token——這個 repo 是公開的,金鑰必須改由 Worker /api/basemap-token 下發');
  assert(!/tiles\.stadiamaps\.com[^'"`\s]*[?&]api_key=[A-Za-z0-9]/.test(repoIndex),
    'repo 根 index.html 寫死了 Stadia api_key——這個 repo 是公開的,App 金鑰只能由 prepare-web 注入 www');
  assert(wwwBuild === repoBuild,
    `App 產物版本落後：app/www 為 ${wwwBuild},但根目錄網站已是 ${repoBuild};請執行 npm run sync 重建並同步後再送審`);

  // 原生內嵌資產一致性：iOS／Android 打包的 public/ 必須與 app/www 同版。
  // build 結尾呼叫時 cap sync 尚未跑,故 skipNativeSyncCheck=true;獨立 npm run verify 才做此比對。
  if (!skipNativeSyncCheck) {
    const nativeTarget = String(process.env.RAIL_VERIFY_NATIVE || 'all').toLowerCase();
    assert(['all', 'ios', 'android'].includes(nativeTarget),
      'RAIL_VERIFY_NATIVE 只接受 all、ios 或 android');
    const nativeIndexes = [
      ['ios', 'iOS', join(appRoot, 'ios/App/App/public/index.html')],
      ['android', 'Android', join(appRoot, 'android/app/src/main/assets/public/index.html')]
    ].filter(([platform]) => nativeTarget === 'all' || nativeTarget === platform);
    for (const [, label, nativeIndex] of nativeIndexes) {
      let nativeHtml;
      try { nativeHtml = await readFile(nativeIndex, 'utf8'); }
      catch {
        // 原生專案尚未生成則略過。但在 CI（cap sync 之後）這個「略過」等於整條檢查從沒跑過——
        // 乾淨 clone 沒有 App/public,發行閘門會在完全沒比對內嵌資產的情況下亮綠燈。
        // 故 ci_post_clone 的同步後複驗帶 RAIL_REQUIRE_NATIVE=1,把略過改成失敗。
        assert(!process.env.RAIL_REQUIRE_NATIVE,
          `${label} 內嵌資產不存在（${relative(repoRoot, nativeIndex)}）——cap sync 未產生打包用網頁,不可發行`);
        continue;
      }
      const nativeBuild = extractBuild(nativeHtml);
      assert(nativeBuild === wwwBuild,
        `${label} 內嵌資產版本不一致：${relative(repoRoot, nativeIndex)} 為 ${nativeBuild},app/www 為 ${wwwBuild};請執行 npm run sync（build + cap sync）`);
    }
    if (nativeTarget === 'all' || nativeTarget === 'android') {
      const mainActivityPath = join(appRoot, 'android/app/src/main/java/tw/railisland/app/MainActivity.java');
      let mainActivity = null;
      try { mainActivity = await readFile(mainActivityPath, 'utf8'); }
      catch {
        assert(!process.env.RAIL_REQUIRE_NATIVE,
          `Android MainActivity 不存在（${relative(repoRoot, mainActivityPath)}）——無法驗證 launch theme 不會重生 ActionBar`);
      }
      if (mainActivity !== null) assertAndroidMainActivityDoesNotPreInitWindow(mainActivity);
    }
  }

  // 🔴 自製原生 plugin 必須在 capacitorDidLoad() 註冊,否則 JS 端 registerPlugin('X') 的呼叫
  // 全部靜默拒絕——功能整條死掉,而 build 照樣 SUCCEEDED、沒有任何紅字。這個坑已經踩過兩次
  // (build 38 音樂全滅＝RailAudioPlugin 漏註冊;1.4.2 的評分＝RailReviewPlugin 漏註冊),
  // 而 RailPlacesPlugin.swift 裡就寫著警告註解仍然再犯 ⇒ 靠人記得是不夠的,改成機械判準。
  // 判的是「宣告出來的每一顆都被註冊」(是什麼/怎麼配對),不是「有幾顆」——新增 plugin 不必改這裡。
  {
    const iosSrcDir = join(appRoot, 'ios/App/App');
    let swiftFiles = [];
    try { swiftFiles = (await readdir(iosSrcDir)).filter(name => name.endsWith('.swift')); }
    catch { swiftFiles = []; }
    if (!swiftFiles.length) {
      assert(!process.env.RAIL_REQUIRE_NATIVE,
        `iOS 原生原始碼不存在（${relative(repoRoot, iosSrcDir)}）——無法檢查自製 plugin 註冊,不可發行`);
    } else {
      const swiftSource = (await Promise.all(
        swiftFiles.map(name => readFile(join(iosSrcDir, name), 'utf8'))
      )).join('\n');
      // 只要求「繼承串裡有 CAPBridgedPlugin」,不綁協定順序也不綁還列了哪些協定——
      // 綁死 `: CAPPlugin, CAPBridgedPlugin` 的話,新 plugin 只要把兩個協定寫反就整顆隱形,
      // 而其餘三顆仍在 ⇒ 分母守衛不會響、漏註冊照樣溜過去(突變測試就是這樣抓到的)。
      // \b 是必要的:少了它,CAPBridgedPluginX 之類的改名也會被當成命中。
      const declared = [...swiftSource.matchAll(/class\s+(\w+)\s*:[^{\n]*\bCAPBridgedPlugin\b/g)]
        .map(match => match[1]);
      // 分母守衛：宣告一顆都抓不到＝正則跟不上寫法改動,此時 missing 必為空、下面那條會假綠。
      assert(declared.length > 0,
        `${relative(repoRoot, iosSrcDir)} 裡找不到任何 CAPBridgedPlugin 宣告——`
        + '要嘛自製 plugin 真的一顆都不剩了,要嘛這道閘門的比對寫法已經跟不上原始碼,請先確認是哪一種');
      const registered = new Set(
        [...swiftSource.matchAll(/registerPluginInstance\(\s*(\w+)\s*\(/g)].map(match => match[1])
      );
      const missing = declared.filter(name => !registered.has(name));
      assert(missing.length === 0,
        `自製原生 plugin 宣告了卻沒有註冊：${missing.join('、')}——請在 RailBridgeViewController`
        + '.capacitorDidLoad() 補 bridge?.registerPluginInstance(該類別());少了它,JS 端對應的功能會'
        + '整條靜默失效,而 build 仍然會 SUCCEEDED(build 38 音樂全滅就是這個)');
      console.log(`  · 自製原生 plugin ${declared.length} 顆全部已註冊：${declared.join('、')}`);
    }
  }

  // 半套登入 gate（STORE_SUBMISSION_CHECKLIST 步驟 4）：帳號開了但 Sign in with Apple 沒開
  // ＝App Store Guideline 4.8 退件主因。檢查對象是重建後的 www/，舊副本綠燈不算數。
  // 🔴 判準不綁 ACCOUNT_ENABLED(2026-08-02 判準過期修正):2026-07-21 起帳號實際入口是
  // plusOpen→accountEnsureInit,ACCOUNT_ENABLED 只決定帳號鈕要不要 eager 顯示在主畫面——
  // ACCOUNT_ENABLED=false 時 Google 登入鈕仍可能經由購買流程或 ?account=delete 深連結被畫出來
  // (index.html 的 accountConfigured() 本身就與 ACCOUNT_ENABLED 無關)。舊判準綁 ACCOUNT_ENABLED
  // 的後果不是誤紅,是永遠不跑(ACCOUNT_ENABLED 現在恆 false)——半套登入的防線形同不存在。
  // 改綁 firebase-config.js 是否配置齊全(accountConfigured() 的靜態等價條件),才是登入鈕
  // 實際會不會被畫出來的真正判準。
  const firebaseConfig = await readFile(join(output, 'firebase-config.js'), 'utf8');
  const firebaseConfigured = /apiKey\s*:/.test(firebaseConfig) && /authDomain\s*:/.test(firebaseConfig) && /projectId\s*:/.test(firebaseConfig);
  if (firebaseConfigured) {
    assert(/window\.RAIL_APPLE_LOGIN\s*=\s*true/.test(firebaseConfig),
      '登入鈕可能被畫出(Firebase 已配置)但 RAIL_APPLE_LOGIN 不是 true——半套登入（有 Google 無 Apple）會被 App Store 4.8 退件');
  }

  // Capacitor 的 production logging 是「正式版也開啟」，Bridge 會把 plugin call/result
  // 完整序列化到 logcat。FirebaseAuthentication 回傳含 access token 與 ID token，
  // 因此不能只依賴「不手動 console.log」：發行閣門必須強制關閉原生橋接日誌。
  const capacitorConfig = JSON.parse(await readFile(join(appRoot, 'capacitor.config.json'), 'utf8'));
  assertNativeBridgeLoggingDisabled(capacitorConfig);

  // 出貨回歸閘門(2026-08-23 新增):這一顆不准比「還在使用者手上的 build」少東西。
  // 事故背景:63e38b2 那顆合併把 index.html 整檔取 main 那一側,靜默吃掉跟車鎖屏與衛星高解析
  // 兩個通行證入口、說明中心兩節、前景持續定位與 11 條更新紀錄——build 成功、archive 成功、
  // 這支發行檢查也全綠,使用者是在 1.4.9 上架之後才發現。基線與判準見
  // app/scripts/verify_no_ship_regression.mjs 與 app/shipped-baseline.json。
  const shipInv = inventory(await readFile(join(output, 'index.html'), 'utf8'));
  const shipBase = JSON.parse(await readFile(join(appRoot, 'shipped-baseline.json'), 'utf8'));
  const shipGone = compareShipInventory(shipBase.inventory, shipInv, shipBase.allowRemoved || {});
  const shipGoneCount = Object.values(shipGone).reduce((n, a) => n + a.length, 0);
  // 基線是「所有還在使用者手上的 build」的聯集,不是只有最新那顆——訊息要照實講,
  // 否則下次有人看到「比 1.4.9 少」會誤以為只要對 1.4.9 交代就好(08-23 的損失正是 68 有、75 沒有)。
  const shipBaseLabel = shipBase.covers || `${shipBase.marketing} (${shipBase.build})`;
  assert(shipGoneCount === 0,
    `比已上架的 ${shipBaseLabel} 少了 ${shipGoneCount} 項：` +
    Object.entries(shipGone).map(([k, v]) => `${k}=${v.join('/')}`).join('；') +
    '（單獨跑 node app/scripts/verify_no_ship_regression.mjs 看完整說明）');
  console.log(`  · 出貨回歸閘門通過:沒有任何一項比已上架的 ${shipBaseLabel} 少`);

  const textExtensions = new Set(['.html', '.js', '.mjs', '.json', '.css', '.webmanifest', '.txt', '.md']);
  const suspiciousSecretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk_[A-Za-z0-9_-]{8,}/,
    /REVENUECAT_V2_SECRET_KEY\s*[:=]\s*["'][^"']+/,
    /TDX_CLIENT_SECRET\s*[:=]\s*["'][^"']+/,
    /FIREBASE_WEB_API_KEY\s*[:=]\s*["'][^"']+/
  ];
  for (const file of files) {
    const extension = basename(file).includes('.') ? `.${basename(file).split('.').pop()}` : '';
    if (!textExtensions.has(extension)) continue;
    const content = await readFile(file, 'utf8');
    assert(!suspiciousSecretPatterns.some(pattern => pattern.test(content)),
      `疑似含伺服器密鑰：${relative(output, file)}`);
  }

  const size = (await Promise.all(files.map(file => lstat(file)))).reduce((sum, info) => sum + info.size, 0);
  console.log(`App 發行檢查通過：${relative(repoRoot, output)}，${wwwBuild}，${files.length} 個檔案，${(size / 1024 / 1024).toFixed(1)} MB，音樂 ${musicEnabled ? '開啟' : '關閉'}，線上底圖 ${basemapsEnabled ? '開啟' : '關閉'}`);
  return { files: files.length, bytes: size, musicEnabled, basemapsEnabled };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyRelease();
}
