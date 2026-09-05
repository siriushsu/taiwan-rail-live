import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertLicensedBuildAllowed, verifyRelease, STADIA_ATTRIBUTION } from './verify-release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const out = join(appRoot, 'www');
// 隔離 worktree 不會自動帶入 gitignored .env；允許出包端明確指向同一份本機祕密檔，
// 檔案內容仍不複製、不寫入產物或版控。未設定時維持既有 repo 根 .env 行為。
const envFile = process.env.RAIL_ENV_FILE ? resolve(process.env.RAIL_ENV_FILE) : join(repoRoot, '.env');
const includeLicensedMusic = process.env.RAIL_INCLUDE_LICENSED_MUSIC === '1';
const includeLicensedBasemaps = process.env.RAIL_INCLUDE_LICENSED_BASEMAPS === '1';
// Metro Core 的公開 client 已隨 index.html 打包；這顆旗標只決定是否切到 Private Worker snapshot。
// 首次切換仍要出一顆 App build，此後模型更新只動 Worker，不必再改 App。
const enableMetroCore = process.env.RAIL_ENABLE_METRO_CORE === '1';

// Android 通行證採「明確開啟才存在」：沒有 public SDK key、Sandbox build 或後台 allowlist
// 任一項時都拒絕產出付費版，避免再次得到「看得到入口但買不到」的半套 AAB。
// RevenueCat 的 goog_ key 是可放在 App 端的 public SDK key；sk_ 類 secret 絕不可進 bundle。
const androidPlusEnabled = process.env.RAIL_ANDROID_PLUS_ENABLED === '1';

async function readOptionalEnv(name) {
  const direct = String(process.env[name] || '').trim();
  if (direct) return direct;
  try {
    const source = await readFile(envFile, 'utf8');
    const line = source.split(/\r?\n/).find(candidate => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(candidate));
    if (!line) return '';
    let value = line.slice(line.indexOf('=') + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.trim();
  } catch { return ''; }
}

const androidRevenueCatApiKey = androidPlusEnabled
  ? await readOptionalEnv('RAIL_REVENUECAT_ANDROID_API_KEY') : '';
const androidPlusSandboxPolicy = String(process.env.RAIL_ANDROID_PLUS_SANDBOX_POLICY || '').trim();
const androidPlusSandboxBuild = String(process.env.RAIL_ANDROID_PLUS_SANDBOX_BUILD || '').trim();
if (androidPlusEnabled) {
  if (!/^goog_[A-Za-z0-9]+$/.test(androidRevenueCatApiKey)) {
    throw new Error('RAIL_ANDROID_PLUS_ENABLED=1 時必須提供 RevenueCat Android public SDK key（RAIL_REVENUECAT_ANDROID_API_KEY，格式 goog_…）；sk_ secret 絕不可放進 App');
  }
  if (!enableMetroCore) {
    throw new Error('Android 通行證版必須同時設定 RAIL_ENABLE_METRO_CORE=1；拒絕產出退回舊捷運位置模型的 AAB');
  }
  if (androidPlusSandboxPolicy !== 'revenuecat-allowlist') {
    throw new Error('Android 通行證正式包必須設定 RAIL_ANDROID_PLUS_SANDBOX_POLICY=revenuecat-allowlist，並先在 RevenueCat 與 Worker 限定測試 UID');
  }
  if (!/^[1-9]\d*$/.test(androidPlusSandboxBuild)) {
    throw new Error('Android 通行證正式包必須設定正整數 RAIL_ANDROID_PLUS_SANDBOX_BUILD，讓同一顆 Play AAB 能在 UID allowlist 內驗收測試購買');
  }
  const androidGradle = await readFile(join(appRoot, 'android/app/build.gradle'), 'utf8');
  const versionCode = /\bversionCode\s+(\d+)/.exec(androidGradle)?.[1] || '';
  if (versionCode !== androidPlusSandboxBuild) {
    throw new Error(`RAIL_ANDROID_PLUS_SANDBOX_BUILD=${androidPlusSandboxBuild} 與 Android versionCode=${versionCode || '找不到'} 不一致`);
  }
} else if (androidPlusSandboxPolicy || androidPlusSandboxBuild) {
  throw new Error('RAIL_ANDROID_PLUS_ENABLED 未開啟，卻留下 Android Sandbox policy/build；拒絕產出含糊的半啟用版本');
}

async function readRequiredEnv(name) {
  let source;
  try { source = await readFile(envFile, 'utf8'); }
  catch { throw new Error(`建立含授權底圖的 App 前，建置用 .env 必須設定 ${name}`); }
  const line = source.split(/\r?\n/).find(candidate => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(candidate));
  if (!line) throw new Error(`建立含授權底圖的 App 前，建置用 .env 必須設定 ${name}`);
  let value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value) throw new Error(`建置用 .env 的 ${name} 不可為空`);
  return value;
}

const stadiaApiKey = includeLicensedBasemaps ? encodeURIComponent(await readRequiredEnv('STADIA_API_KEY')) : null;
// 兩個形態都要:圖磚網址吃 URL 編碼過的，開 basemap session 時前端會自己再編碼一次，
// 所以 RAIL_APP_CONFIG.esriKey 必須放沒編碼的原值（塞編碼過的會變成二次編碼、開不了 session）。
const esriApiKeyRaw = includeLicensedBasemaps ? await readRequiredEnv('ESRI_API_KEY') : null;
const esriApiKey = includeLicensedBasemaps ? encodeURIComponent(esriApiKeyRaw) : null;
await assertLicensedBuildAllowed({ includeLicensedMusic, includeLicensedBasemaps });

// data_manifest 閘門:App 開機靠它判斷「打包的資料檔有沒有比網站舊」(index.html 的
// initDataFreshness)。清單過期是無聲失效——網站會宣稱什麼都沒變,App 就永遠不更新資料,
// 畫面照常有車、不報錯,只是班次是錯的。所以打包前先擋下來,而不是事後才發現。
await new Promise(ok => {
  execFile(process.execPath, [join(repoRoot, 'scripts/verify_data_manifest.mjs'), repoRoot],
    (err, stdout, stderr) => {
      process.stdout.write(stdout || '');
      if (err) {
        process.stderr.write(stderr || '');
        process.exit(1);          // 直接退出:閘門訊息已經講清楚怎麼修,再疊一層 stack trace 只是雜訊
      }
      ok();
    });
});

// 地點型小工具的通過時刻索引必須由真實頁面 runtime 產生：段配對、obs 剖面與反解時刻
// 全部呼叫 index.html 自己的函式，不在 Node 端維護第二份演算法。
const placeIndexBuild = await new Promise((resolveBuild, rejectBuild) => {
  execFile(
    process.execPath,
    [join(here, 'build_place_index.mjs')],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (error) {
        rejectBuild(new Error(`place_index 建構失敗：${stderr || stdout || error.message}`));
      } else {
        resolveBuild({ stdout, stderr });
      }
    }
  );
});
if (placeIndexBuild.stdout) process.stdout.write(placeIndexBuild.stdout);
if (placeIndexBuild.stderr) process.stderr.write(placeIndexBuild.stderr);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const copyFile = async relative => {
  const target = join(out, relative); await mkdir(dirname(target), { recursive: true });
  await cp(join(repoRoot, relative), target);
};
// 目錄整棵複製時，只收「git 已追蹤」的檔案。
// 為什麼不是逐個檔名排除：磁碟上的未追蹤檔會被無聲打進 App bundle——歷史上發生過兩次
// （9.4MB 的 app icon 概念圖、330KB 的 tra_pass_obs_diag.json 逐節點稽核產物），
// 每次都是事後補一條檔名規則，下一個未追蹤檔再重演。.assetsignore 只管 wrangler 出貨，
// 管不到這條路徑，兩邊要各擋各的。改用「版控說了算」就一次治掉整類。
const trackedFiles = new Set(
  (await new Promise((resolve, reject) => {
    execFile('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(stdout));
  })).split('\0').filter(Boolean)
);
if (trackedFiles.size === 0) throw new Error('git ls-files 回空——無法判斷哪些檔已追蹤，拒絕建置（避免把未追蹤檔打進發行包）');

const copyTree = async relative => {
  const source = join(repoRoot, relative), target = join(out, relative);
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source)) {
    if (entry === '.DS_Store' || entry.includes('.bak-')) continue;
    const child = join(relative, entry), info = await stat(join(repoRoot, child));
    if (info.isDirectory()) { await copyTree(child); continue; }
    if (!trackedFiles.has(child.replaceAll('\\', '/'))) continue;
    await copyFile(child);
  }
};

for (const file of [
  'index.html', 'account-deletion.html', 'app-support.html', 'privacy.html', 'terms.html', 'firebase-config.js', 'revenuecat-config.js', 'manifest.webmanifest',
  // bus-transfer-ui.js：541 站公車轉乘的 UI，index.html 直接 <script src> 載入、網站與 App 共用同一份。
  // 2026-09-01 上線後這份清單沒補，iOS 93／95／96 與 Android 35／37 全部漏打包；index.html 的守衛遇到
  // !window.BusTransferUI 只是靜默 return ⇒ build 全綠、App 照開，公車卡在 App 裡整個不存在（1.5.5／1.5.6
  // 上架後才發現）。verify-release 現在另有「首頁引用的本機腳本／樣式都要在 bundle 裡」守門，再漏會當場紅。
  'bus-transfer-ui.js',
  'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'favicon-192.png', 'favicon-512.png',
  'apple-touch-180.png', 'icon-maskable-512.png', 'og-1200x630.png'
]) await copyFile(file);
// i18n 是首頁 runtime 的必要靜態資產，不是只供網站維護的資料。漏掉時 App 仍能啟動，
// 語言按鈕也會改變 html lang，但英／日字典 404 後所有文字都安全 fallback 回繁中，
// 真機看起來就像按鈕完全失效。與 assets/data 一樣只複製 git 已追蹤檔案。
for (const dir of ['assets', 'data', 'i18n']) await copyTree(dir);
// place_index.json 是本次 build 現場產物，尚未 git add 時不會通過 copyTree 的「只收 tracked」
// 閘門；明確單檔複製，不放寬其他未追蹤資料進 bundle。
await copyFile('data/place_index.json');
// 🔴 音樂只複製 index.html 的 MUSIC_BUNDLED 那 12 首,不是整棵 'suno musics'。
//    整棵是 57 首 196MB,全帶會讓 App 下載從 174MB 漲到約 267MB(越過 iOS 行動網路下載
//    要另外允許的 200MB 門檻);其餘曲目由前端改指向正式站串流。
//    名單【刻意從 index.html 解析而不在這裡再寫一份】——兩份清單一定會漂,而漂掉的症狀是
//    「某幾首在飛航模式下靜默播不出來」,不會有任何 build 期訊號。
if (includeLicensedMusic) {
  const indexSrc = await readFile(join(repoRoot, 'index.html'), 'utf8');
  const block = indexSrc.match(/const MUSIC_BUNDLED = new Set\(\[([\s\S]*?)\]\);/);
  if (!block) throw new Error('prepare-web: index.html 找不到 MUSIC_BUNDLED');
  const bundled = [...block[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
  if (!bundled.length) throw new Error('prepare-web: MUSIC_BUNDLED 解析出 0 首');
  for (const rel of bundled) await copyFile(join('suno musics', rel));
  console.log(`  · 內建音樂 ${bundled.length} 首(其餘從正式站串流)`);
}
// 車聲圖層(2026-09-03):Envato 授權的鐵軌環境音 loop。授權不允許公開散布原檔 ⇒ 不進 repo、不上網站,
// 只在含授權音樂的 App build 從 repo 外(gitignored 的 suno musics/_licensed/)烤進 bundle。
// 缺檔一律硬失敗:靜默略過的症狀只有「車聲開關不見了」,沒有任何 build 期訊號(同 verify-release 的三個洞)。
const AMBIENCE_REL = 'audio/train-ride-loop.mp3';
if (includeLicensedMusic) {
  const src = process.env.RAIL_AMBIENCE_FILE || join(repoRoot, 'suno musics', '_licensed', 'ambience', 'train-ride-loop.mp3');
  if (!existsSync(src)) throw new Error(`prepare-web: 車聲 loop 不存在:${src}(放到 suno musics/_licensed/ambience/ 或設 RAIL_AMBIENCE_FILE)`);
  await mkdir(join(out, 'audio'), { recursive: true });
  await cp(src, join(out, AMBIENCE_REL));
  console.log('  · 車聲圖層 loop 已內建(Envato 授權,App 限定)');
}

const noticeEntries = [
  ['Capacitor Core／iOS／Android 8.4.2', 'node_modules/@capacitor/core/LICENSE'],
  ['Capacitor Geolocation 8.2.0', 'node_modules/@capacitor/geolocation/LICENSE'],
  ['Capacitor Share 8.0.1', 'node_modules/@capacitor/share/LICENSE'],
  ['Capacitor Firebase Authentication 8.3.0', 'node_modules/@capacitor-firebase/authentication/LICENSE'],
  ['Firebase JavaScript SDK 12.16.0（Apache License 2.0）', 'node_modules/@capacitor-firebase/authentication/LICENSE'],
  ['RevenueCat Purchases Capacitor 13.2.2', 'node_modules/@revenuecat/purchases-capacitor/LICENSE'],
  ['fflate 0.8.3', 'node_modules/fflate/LICENSE'],
  // 地圖引擎不是 npm 依賴(釘版 vendor/ 進版控),授權全文另存 vendor/maplibre-gl-LICENSE.txt。
  // M1a 內建 MapLibre 時漏列,M4-B(2026-09-05)拔掉 Leaflet 後它是唯一的地圖函式庫,BSD-3 要求隨附條款與免責聲明。
  ['MapLibre GL JS 4.7.1（BSD 3-Clause）——App 內建的 vendor/maplibre-gl.js／.css', '../vendor/maplibre-gl-LICENSE.txt'],
  // 唯一不是 npm 依賴的一條,所以路徑指回 repo 根的 assets/。2026-07-28 的換圖批次把成就徽章與
  // 車廂標記換成 Noto Emoji 單色版的 26 字形子集(assets/fonts/rail-emoji.woff2),字型檔隨 assets/
  // 整包進 www ⇒ App 有散布這份字型,OFL 要求隨附授權全文。子集已改名 RailEmoji(Noto 的著作權行
  // 沒有宣告 Reserved Font Name,改名只是更保險)。
  ['Noto Emoji（SIL Open Font License 1.1）——本 App 內嵌的 assets/fonts/rail-emoji.woff2 為其 26 字形子集', '../assets/fonts/NotoEmoji-OFL.txt']
];
const notices = ['軌島原生 App 第三方軟體授權聲明', '產生自 app/package-lock.json 的直接發行依賴，另含隨 App 散布的內嵌字型。原生 archive 的 transitive dependency acknowledgements 另於送審前核對。'];
for (const [label, licensePath] of noticeEntries) {
  notices.push(`\n${'='.repeat(72)}\n${label}\n${'='.repeat(72)}\n`, await readFile(join(appRoot, licensePath), 'utf8'));
}
await writeFile(join(out, 'third-party-notices.txt'), notices.join('\n'));

const vendor = join(out, 'vendor');
await mkdir(vendor, { recursive: true });
await cp(join(appRoot, 'node_modules/fflate/umd/index.js'), join(vendor, 'fflate.js'));
// 地圖引擎(MapLibre GL)與 OSM 向量底圖(OpenFreeMap)的樣式:函式庫與樣式檔都自存在 repo 的 vendor/,
// 不吃 CDN——地圖是首屏必需品,不想再多一個第三方單點。index.html 的兩個標籤網站/App 共用,
// 所以這幾個檔非複製不可:少了 maplibre-gl.js 整張地圖起不來;少了 ofm-*.json 街道 style 讀不到
// ⇒ App 悄悄退回計費的 Stadia,build 卻照樣成功(所以下面另有正向斷言)。
// 樣式 JSON 內的圖磚/sprite/glyphs 仍指向 tiles.openfreemap.org(免金鑰、無用量上限、明文可商用)。
for (const f of ['maplibre-gl.js', 'maplibre-gl.css', 'ofm-positron.json', 'ofm-dark.json']) await cp(join(repoRoot, 'vendor', f), join(vendor, f));

await build({
  entryPoints: [join(appRoot, 'src/native-bridge.mjs')],
  outfile: join(out, 'native-bridge.js'), bundle: true, format: 'iife', platform: 'browser', target: ['ios15', 'chrome100'], minify: true
});
await build({
  entryPoints: [join(appRoot, 'src/firebase-web.mjs')],
  outfile: join(vendor, 'firebase.mjs'), bundle: true, format: 'esm', platform: 'browser', target: ['ios15', 'chrome100'], minify: true
});

// ── index.html 轉換 ──────────────────────────────────────────────────────────
// 鐵則(2026-07-22 起):App/網站的「行為差異」一律由 index.html 讀 window.RAIL_APP_CONFIG 決定,
// 本檔只做三種機械動作:(1)拔 APP_STRIP 錨點區塊 (2)換 APP_REPLACE 錨點區塊 (3)注入旗標與設定。
// 禁止新增「精確比對網站程式碼字串再改寫」的手術——那讓網站日常改動動輒弄壞 App build(舊病根)。
// 仍依賴的兩個既有穩定錨點:<span id="buildVer">(授權入口注入點)與 revenuecat-config.js script(設定注入點)。
const indexPath = join(out, 'index.html');
let html = await readFile(indexPath, 'utf8');

// 錨點區塊工具:自起標記頭到迄標記尾整段換成 replacement(strip=換成空字串)。
// 找不到錨點=網站端把標記移掉了,錯誤訊息直接點名要恢復哪個錨點。
const cutRegion = (source, name, startMarker, endMarker, replacement = '') => {
  const s = source.indexOf(startMarker);
  if (s < 0) throw new Error(`index.html 找不到錨點「${name}」的起標記(${startMarker})——請在網站端恢復該錨點,勿改回字串手術`);
  const e = source.indexOf(endMarker, s + startMarker.length);
  if (e < 0) throw new Error(`index.html 找不到錨點「${name}」的迄標記(${endMarker})`);
  return source.slice(0, s) + replacement + source.slice(e + endMarker.length);
};
const stripHtmlRegion = (source, name) => cutRegion(source, name, `<!-- APP_STRIP_START ${name}`, `<!-- APP_STRIP_END ${name} -->`);
const stripJsRegion = (source, name) => cutRegion(source, name, `// APP_STRIP_START ${name}`, `// APP_STRIP_END ${name}`);
const replaceHtmlRegion = (source, name, replacement) => cutRegion(source, name, `<!-- APP_REPLACE_START ${name}`, `<!-- APP_REPLACE_END ${name} -->`, replacement);

// (1) M4-B 起地圖引擎(MapLibre)本來就是 vendor/ 自架、網站與 App 共用同一組標籤,
//     不再需要「CDN 版換打包版」的整段替換(原 leaflet-cdn 錨點已隨 Leaflet 一起移除)。
// (2) 原生 App 的數位功能只走 StoreKit／Google Play Billing;網站的 Ko-fi／銀行贊助區不帶進 App
html = stripHtmlRegion(html, 'donate-box');
html = stripHtmlRegion(html, 'donation-log');
html = stripJsRegion(html, 'donation-handler');
// (3) 網站免費層底圖預設(CARTO/舊 Esri)整段拔除——App 包內不得殘留其網址(CARTO 條款不允許包進上架 App)
html = stripJsRegion(html, 'web-tiles');
// (4) 頁尾底圖來源文字換成本 build 的實況
html = replaceHtmlRegion(html, 'basemap-credit',
  includeLicensedBasemaps
    // 街道圖兩個來源都要列:哪一個在跑是 runtime 才決定的(L1 遠端開關/L2 自動退場),
    // 而頁尾文字是 build 期烘死的,只列其中一個必然有一種情況署名不實。
    ? 'OpenFreeMap（© OpenFreeMap © OpenMapTiles © OpenStreetMap，街道圖）、Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap，街道圖退路）、Esri World Imagery（衛星影像）與內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版）'
    : '內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版；線上底圖未納入此版本）');
// (4b) 狀態頁連結:App 包內沒有 status.html(其相對 /api 呼叫在 Capacitor 本機來源也不通),換成正式站絕對網址外開
html = replaceHtmlRegion(html, 'status-link',
  '<li><span class="d">狀態</span><a href="https://railisland.tw/status.html" target="_blank" rel="noopener">資料源連線狀態頁</a></li>');
// (5) 注入:第三方授權入口＋功能旗標＋RAIL_APP_CONFIG(授權圖磚與計量底圖的跟車 zoom 上限)
const appConfig = includeLicensedBasemaps ? {
  followZoomCap: 16, // 計量底圖止血:跟車進場/導播 zoom 上限(index.html 的 FOLLOW_ZOOM_CAP/DIRECTOR_FOLLOW_Z 消費)
  // 2026-07-29 曾因圖磚配額吃緊整個關掉;2026-08-02 改成收斂給 Plus 訂閱者
  // (index.html 的 satRetinaAllowed())——這裡只決定「這個平台建不建得出高解析層」，
  // 不等於全體使用者都拿得到:非 Plus 一律降回標準解析，所以額度風險已由訂閱資格擋住。
  // 🔴 這個值一旦 build 進 App 就鎖死到下一次送審——網站改一行部署就生效，App 不行。
  satRetina: true, // 兩層都建;實際給不給高解析由 index.html 的 satRetinaAllowed()(訂閱資格)決定。額度吃緊時改 false＝全體降回標準解析
  // 衛星計費模式從「按張數」升級成「按 session」時，App 殼要自己跟 Esri 開 session（index.html 的
  // fetchSatSession 消費）。網站那把金鑰有 referrer 白名單所以得繞 Worker，App 這把沒有，
  // capacitor://localhost 實測可直接開（2026-08-01 正負對照驗過）。
  // 值與下面 tiles.sat.url 裡的是同一把，不是新的金鑰、不增加曝險面。
  esriKey: esriApiKeyRaw,
  // 這顆 build 的街道底圖預設來源。runtime 還有兩層可以蓋過它:L1(Worker 的 /api/basemap-src,
  // 存進 localStorage、下次開機生效)與 L2(載不動就當場退回 raster)。
  // 這裡留一個 build 期開關,是為了「送審期間 OFM 出事」這種等不到 L1 生效的情境能直接出一顆
  // 以 Stadia 為預設的版本,而不必動 index.html。
  streetSrc: 'ofm',
  tiles: {
    light: { url: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key=${stadiaApiKey}`, maxZoom: 20, attribution: STADIA_ATTRIBUTION },
    dark: { url: `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png?api_key=${stadiaApiKey}`, maxZoom: 20, attribution: STADIA_ATTRIBUTION },
    sat: { url: `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${esriApiKey}`, maxZoom: 19, attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics' }
  }
} : null;
// sandbox(TestFlight／模擬器／Xcode 直裝)購買的 Plus 資格要不要算數。預設 false——RevenueCat 的
// entitlements.active 等同 activeInAnyEnvironment,不收斂就等於讓 sandbox 購買解鎖正式付費功能
// (index.html 的 plusActiveFrom 有完整說明)。只有明確帶 RAIL_PLUS_SANDBOX_OK=1 建的內部測試版
// 才會是 true,而 verify-release.mjs 的 assertPlusSandboxOff 會擋下把 true 打包進發行版
// ⇒ 這是建置期的測試通道,不是使用者可切換的開關。無條件注入(值 true/false 都寫出來),
// 讓發版閘門驗的是「明確是 false」而不是「字串剛好不存在」。
const plusSandboxOk = process.env.RAIL_PLUS_SANDBOX_OK === '1';
const plusSandboxBuild = String(process.env.RAIL_PLUS_SANDBOX_BUILD || '');
if (plusSandboxOk && !/^[1-9]\d*$/.test(plusSandboxBuild)) {
  throw new Error('RAIL_PLUS_SANDBOX_OK=1 時必須同時提供正整數 RAIL_PLUS_SANDBOX_BUILD，讓 Worker 能把測試通道限縮到指定 build');
}
// App 版本號:iOS 預設直接讀 pbxproj 的 MARKETING_VERSION——那是真正會被打進這顆 build 的值。
// Android 的 Play 版號獨立遞增；Android-only 修正版可明確傳 RAIL_APP_VERSION_OVERRIDE，
// 讓內建更新提示與 Gradle versionName 一致，而不必為了 Android 動到 iOS 專案版號。
// 刻意不讀 set-release-mode.mjs 的 MODES 表:那只是「打算寫成什麼」,有人手改原生設定時兩者會不一致。
// 沒有 override 時，App 與 widget 兩個 iOS target 的值必須相同,不同就是版號沒推乾淨,當場擋下。
// 🔴 無條件注入,不可放進下面 appConfig 的三元——那個物件只在授權底圖 build 才有,
// 而安全 build 是受支援的產出模式(verify-release 還斷言安全 build 裡不存在 RAIL_APP_CONFIG),
// 放錯地方＝安全 build 出來的 App 版本提示與評分整套靜默消失。
const pbxSrc = await readFile(join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const pbxVers = [...new Set([...pbxSrc.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1].trim()))];
if (pbxVers.length !== 1) throw new Error(`pbxproj 的 MARKETING_VERSION 不唯一：${pbxVers.join(' / ')}`);
if (!/^\d+(\.\d+)*$/.test(pbxVers[0])) throw new Error(`MARKETING_VERSION 格式無法解析：${pbxVers[0]}`);
const appVersionOverride = String(process.env.RAIL_APP_VERSION_OVERRIDE || '').trim();
if (appVersionOverride && !/^\d+(\.\d+)*$/.test(appVersionOverride)) {
  throw new Error(`RAIL_APP_VERSION_OVERRIDE 格式無法解析：${appVersionOverride}`);
}
const appVersion = appVersionOverride || pbxVers[0];
// 本版「更新了什麼」內建文案(set-release-mode 把發行模式的 why 經 RAIL_WHATS_NEW 傳進來)。
// 為什麼要內建:App 內那張卡原本抓 iTunes lookup 的 releaseNotes——那是【線上版】的文,
// 剛裝的版比線上新時(每次送審前必然)彈到的是上一版內容(1.4.9 build 74 實踩)。
// 沒給就注入空字串:相關 UI 整組不出現,不炸開機。
const whatsNew = typeof process.env.RAIL_WHATS_NEW === 'string' ? process.env.RAIL_WHATS_NEW.trim() : '';
// 英日各自的整段文案。刻意做成【兩個獨立字串】而不是一個物件:verify-release 既有的
// gate 用一條已驗證的 regex 解析 RAIL_APP_WHATS_NEW,同一條形狀可以原樣複用兩次,
// 不必為了新欄位去改那條擋過真事故(1.4.9 build 74)的 gate。
const whatsNewEn = typeof process.env.RAIL_WHATS_NEW_EN === 'string' ? process.env.RAIL_WHATS_NEW_EN.trim() : '';
const whatsNewJa = typeof process.env.RAIL_WHATS_NEW_JA === 'string' ? process.env.RAIL_WHATS_NEW_JA.trim() : '';

const androidPlusConfigInjection = androidPlusEnabled
  ? `;window.RAIL_REVENUECAT_CONFIG={...(window.RAIL_REVENUECAT_CONFIG||{}),androidApiKey:${JSON.stringify(androidRevenueCatApiKey)}}`
  : '';

html = html
  .replace('<span class="ver" id="buildVer"></span>', '<a href="third-party-notices.txt" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;padding:0 4px">第三方軟體授權</a>\n      <span class="ver" id="buildVer"></span>')
  .replace('<script src="revenuecat-config.js"></script>', `<script src="revenuecat-config.js"></script>\n<script>window.RAIL_MUSIC_AVAILABLE=${includeLicensedMusic};window.RAIL_AMBIENCE_AVAILABLE=${includeLicensedMusic};window.RAIL_ONLINE_BASEMAPS_AVAILABLE=${includeLicensedBasemaps};window.RAIL_METRO_CORE_ENABLED=${enableMetroCore};window.RAIL_APP_VERSION=${JSON.stringify(appVersion)};window.RAIL_APP_WHATS_NEW=${JSON.stringify(whatsNew)};window.RAIL_APP_WHATS_NEW_EN=${JSON.stringify(whatsNewEn)};window.RAIL_APP_WHATS_NEW_JA=${JSON.stringify(whatsNewJa)};window.RAIL_PLUS_SANDBOX_OK=${plusSandboxOk};window.RAIL_PLUS_SANDBOX_BUILD=${plusSandboxOk ? JSON.stringify(plusSandboxBuild) : 'null'};window.RAIL_ANDROID_PLUS_ENABLED=${androidPlusEnabled};window.RAIL_ANDROID_PLUS_SANDBOX_POLICY=${androidPlusEnabled ? JSON.stringify(androidPlusSandboxPolicy) : 'null'};window.RAIL_ANDROID_PLUS_SANDBOX_BUILD=${androidPlusEnabled ? JSON.stringify(androidPlusSandboxBuild) : 'null'}${androidPlusConfigInjection}${appConfig ? `;window.RAIL_APP_CONFIG=${JSON.stringify(appConfig)}` : ''}</script>\n<script src="native-bridge.js"></script>`);
if (!html.includes('vendor/maplibre-gl.js') || !html.includes('native-bridge.js')) throw new Error('App index vendor/native bridge injection failed');
if (/ko-fi|PayPal|111010691056|web-only-donation-log|贊助方式更新/i.test(html) || html.includes('id="donateCopy"') || html.includes('class="foot-box foot-donate"')) throw new Error('External donation content leaked into native App');
if (/cartocdn\.com|arcgisonline\.com/i.test(html)) throw new Error('App index still contains unlicensed CARTO/Esri tile URLs');
// 正向斷言:上面那條反向的「不該有的網址不在」照不到「該有的檔沒進來」。OFM 資產漏複製時
// build 一樣成功、App 一樣能開,只是靜默退回計費底圖——那正是這批要消滅的成本,不能靠肉眼發現。
for (const f of ['maplibre-gl.js', 'maplibre-gl.css', 'ofm-positron.json', 'ofm-dark.json']) {
  try { await stat(join(vendor, f)); }
  catch { throw new Error(`www/vendor/${f} 沒進 bundle——地圖起不來,或街道底圖靜默退回計費的 Stadia`); }
}
await writeFile(indexPath, html);

await verifyRelease({
  out,
  expectLicensedMusic: includeLicensedMusic,
  expectLicensedBasemaps: includeLicensedBasemaps,
  expectMetroCore: enableMetroCore,
  expectPlusSandboxBuild: plusSandboxOk ? plusSandboxBuild : null,
  // cap sync 在 build 之後才跑,此刻原生內嵌資產必然還是舊版;原生同步的比對留給獨立的 npm run verify。
  skipNativeSyncCheck: true
});
console.log(`App web assets ready: ${out} (licensed music: ${includeLicensedMusic ? 'included' : 'excluded'}, licensed basemaps: ${includeLicensedBasemaps ? 'enabled' : 'disabled'}, Metro Core: ${enableMetroCore ? 'enabled' : 'disabled'})`);
