import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const defaultOut = join(appRoot, 'www');

const fail = message => { throw new Error(`App 發行檢查失敗：${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

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
  if (includeLicensedBasemaps) {
    const rights = policy.onlineBasemaps || {};
    for (const [key, label] of [
      ['paidAppUseVerified', '付費 App 商用'],
      ['leafletAndCapacitorUseVerified', 'Leaflet／Capacitor'],
      ['recordedVideoOutputVerified', '錄影輸出'],
      ['attributionRequirementsVerified', '署名要求']
    ]) assert(rights[key] === true, `線上底圖的「${label}」授權尚未核准`);
  }
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

  if (!basemapsEnabled) {
    assert(html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=false'), '安全 build 必須明確關閉線上底圖');
    assert(/id="satBtn" style="display:none"/.test(html), '安全 build 必須預先隱藏衛星按鈕');
  }

  // Stored XSS 迴歸（QA 2026-07-21）：「我的最愛」的列車／站名是使用者資料,可能來自被污染的
  // 匯入或 localStorage。渲染必須以 escHtml 逸出後才進 innerHTML,否則可在 Capacitor WebView 執行 script。
  assert(html.includes('escHtml(f.train)') && html.includes('escHtml(f.label)'),
    '「我的最愛」未以 escHtml 逸出使用者資料——stored XSS 迴歸,不可發行');
  assert(!/<b>\$\{f\.train\}<\/b>/.test(html),
    '「我的最愛」仍把未逸出的 ${f.train} 直接插入 innerHTML——stored XSS 迴歸,不可發行');

  // 版本一致性（QA 2026-07-21）：確保發行包確實含最新網站修正,而不是舊產物綠燈通過。
  const extractBuild = source => source.match(/const BUILD\s*=\s*'([^']+)'/)?.[1] ?? null;
  const wwwBuild = extractBuild(html);
  assert(wwwBuild, 'app/www/index.html 找不到 BUILD 版本戳記');
  const repoBuild = extractBuild(await readFile(join(repoRoot, 'index.html'), 'utf8'));
  assert(repoBuild, '根目錄 index.html 找不到 BUILD 版本戳記');
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
      catch { continue; } // 原生專案尚未生成則略過
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
