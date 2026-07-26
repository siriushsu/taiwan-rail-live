import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const defaultOut = join(appRoot, 'www');

const fail = message => { throw new Error(`App 發行檢查失敗：${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

// Stadia 官方要求的逐字署名(prepare-web 注入、本檔驗證,單一事實來源)
export const STADIA_ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

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

export async function assertLicensedBuildAllowed({ includeLicensedMusic, includeLicensedBasemaps }) {
  const policy = await readReleasePolicy();
  if (includeLicensedMusic) {
    assert(policy.music?.allTracksCommercialRightsVerified === true,
      '音樂授權政策尚未核准，不可建立含 Suno 音樂的 App');
    const checklist = await readFile(join(appRoot, 'MUSIC_LICENSE_CHECKLIST.md'), 'utf8');
    const trackRows = checklist.split('\n').filter(line => /^\| .+\.mp3 \|/.test(line));
    assert(trackRows.length === 29, `音樂核對表應有 29 首，目前是 ${trackRows.length} 首`);
    assert(trackRows.every(line => /\| 已核對 \|\s*$/.test(line)),
      '音樂核對表仍有未核對曲目');
    const config = await readFile(join(repoRoot, 'revenuecat-config.js'), 'utf8');
    assert(/musicRecordingLicensed\s*:\s*true/.test(config),
      'revenuecat-config.js 尚未明確啟用 musicRecordingLicensed:true');
  }
  const basemapRights = [
    ['paidAppUseVerified', '付費 App 商用'],
    ['leafletAndCapacitorUseVerified', 'Leaflet／Capacitor'],
    ['recordedVideoOutputVerified', '錄影輸出'],
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
  [`info.done?'':''`, '兩個寫死字串二選一,無插入'],
  [`on?'':''`, '兩個寫死字串二選一,無插入'],
  [`''+note+''`, 'onLocateFail:note 只可能是四個寫死常數之一,無使用者資料'],
  [`m`, 'announceCollections:msgs 每個插值都已 escHtml;此處刻意傳 <b> 做粗體'],
  ['`${escHtml(item.title)}`', '眾包校正提示,已逸出'],
  ["`${out.added}${out.updated?`${out.updated}`:''}${out.skipped?`${out.skipped}`:''}`", '匯入結果的三個筆數,皆為數字'],
  [`label?(''+escHtml(label)+''):''`, '儲存地點:地點名可由 Takeout 匯入/帳號同步汙染,已逸出'],
  [`p.label?(''+escHtml(p.label)+''):''`, '設預設啟動地點:同上,已逸出'],
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
  const rest = blankLiterals(raw.replace(/escHtml\([^()]*\)/g, '')).replace(/[^\x20-\x7E]/g, '');
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

export async function verifyRelease({
  out = defaultOut,
  expectLicensedMusic,
  expectLicensedBasemaps,
  skipNativeSyncCheck = false
} = {}) {
  const output = resolve(out);
  const files = await walk(output);
  const relativeFiles = files.map(file => relative(output, file).replaceAll('\\', '/'));
  const indexPath = join(output, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const musicEnabled = html.includes('window.RAIL_MUSIC_AVAILABLE=true');
  const basemapsEnabled = html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=true');

  if (expectLicensedMusic !== undefined) {
    assert(musicEnabled === expectLicensedMusic, '音樂功能旗標與本次 build 模式不一致');
  }
  if (expectLicensedBasemaps !== undefined) {
    assert(basemapsEnabled === expectLicensedBasemaps, '線上底圖旗標與本次 build 模式不一致');
  }

  await assertLicensedBuildAllowed({
    includeLicensedMusic: musicEnabled,
    includeLicensedBasemaps: basemapsEnabled
  });

  const required = [
    'index.html', 'account-deletion.html', 'app-support.html',
    'privacy.html', 'terms.html',
    'firebase-config.js', 'revenuecat-config.js', 'native-bridge.js',
    'third-party-notices.txt',
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
  for (const name of ['Capacitor', 'Firebase', 'RevenueCat', 'Leaflet', 'fflate']) {
    assert(notices.includes(name), `第三方軟體授權聲明缺少 ${name}`);
  }

  const musicFiles = relativeFiles.filter(file => file.startsWith('suno musics/'));
  if (musicEnabled) assert(musicFiles.filter(file => /\.mp3$/i.test(file)).length === 29,
    '含音樂 build 必須恰好帶入 29 首已核對曲目');
  else {
    assert(musicFiles.length === 0, '安全 build 不可含 suno musics/');
    assert(html.includes('window.RAIL_MUSIC_AVAILABLE=false'), '安全 build 必須明確關閉音樂');
  }

  if (basemapsEnabled) {
    // 授權底圖走「注入 window.RAIL_APP_CONFIG＋index.html 讀設定」機制(2026-07-22 起),
    // 驗證對象=(1)注入的設定內容 (2)index.html 端的消費機制還活著。不再比對被改寫的程式碼字串。
    assert(html.includes('window.RAIL_APP_CONFIG='), 'App 缺少 RAIL_APP_CONFIG 設定注入');
    assert(html.includes('APP_CFG.tiles'), 'index.html 的 APP_CFG.tiles 圖磚設定機制消失——注入的授權底圖不會被使用');
    assert(/tiles\.stadiamaps\.com\/tiles\/alidade_smooth\/\{z\}\/\{x\}\/\{y\}\.png\?api_key=[^'"\s]+/.test(html),
      '亮色底圖不是含 api_key 的 Stadia alidade_smooth');
    assert(/tiles\.stadiamaps\.com\/tiles\/alidade_smooth_dark\/\{z\}\/\{x\}\/\{y\}\.png\?api_key=[^'"\s]+/.test(html),
      '暗色底圖不是含 api_key 的 Stadia alidade_smooth_dark');
    assert(/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\?token=[^'"\s]+/.test(html),
      '衛星底圖必須是含 token 的授權 Esri ibasemaps');
    assert(!html.includes("plusGateOpen('satellite'"), 'App 第一版衛星免費，不可殘留 Plus 付費閘');
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
    assert(html.includes('Math.min(18, FOLLOW_ZOOM_CAP)'),
      'DIRECTOR_FOLLOW_Z 未由 FOLLOW_ZOOM_CAP 收斂——App 導播跟車 z16 上限失效');
    assert((html.match(/followEntryZoom\(\), \{ animate: false \}/g) || []).length >= 3,
      '跟車進場 followEntryZoom 呼叫點少於 3 處——台鐵／高鐵／捷運跟車 zoom 上限未完整覆蓋');
    assert(html.includes(JSON.stringify(STADIA_ATTRIBUTION)),
      'Stadia 圖磚署名不是官方要求的三組連結逐字內容');
    assert(html.includes('Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap）、Esri World Imagery（衛星影像）與 Natural Earth（離線海陸輪廓）'),
      'App 頁尾底圖來源未包含 Esri 衛星');
  } else {
    assert(html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=false'), '安全 build 必須明確關閉線上底圖');
    assert(!html.includes('tiles.stadiamaps.com'), '安全 build 不可含 Stadia 圖磚網址或 API key');
    assert(!html.includes('window.RAIL_APP_CONFIG='), '安全 build 不應注入 RAIL_APP_CONFIG(授權圖磚設定)');
  }

  // Stored XSS 迴歸（QA 2026-07-21）：「我的最愛」的列車／站名是使用者資料,可能來自被污染的
  // 匯入或 localStorage。渲染必須以 escHtml 逸出後才進 innerHTML,否則可在 Capacitor WebView 執行 script。
  assert(html.includes('escHtml(f.train)') && html.includes('escHtml(f.label)'),
    '「我的最愛」未以 escHtml 逸出使用者資料——stored XSS 迴歸,不可發行');
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
    const nativeIndexes = [
      ['iOS', join(appRoot, 'ios/App/App/public/index.html')]
      // Android 生成後補上 ['Android', join(appRoot, 'android/app/src/main/assets/public/index.html')]
    ];
    for (const [label, nativeIndex] of nativeIndexes) {
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
  }

  // 半套登入 gate（STORE_SUBMISSION_CHECKLIST 步驟 4）：帳號開了但 Sign in with Apple 沒開
  // ＝App Store Guideline 4.8 退件主因。檢查對象是重建後的 www/，舊副本綠燈不算數。
  if (/const ACCOUNT_ENABLED = true/.test(html)) {
    const firebaseConfig = await readFile(join(output, 'firebase-config.js'), 'utf8');
    assert(/window\.RAIL_APPLE_LOGIN\s*=\s*true/.test(firebaseConfig),
      '帳號功能已開啟但 RAIL_APPLE_LOGIN 不是 true——半套登入（有 Google 無 Apple）會被 App Store 4.8 退件');
  }

  const textExtensions = new Set(['.html', '.js', '.mjs', '.json', '.css', '.webmanifest', '.txt', '.md']);
  const suspiciousSecretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
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
