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
const includeLicensedMusic = process.env.RAIL_INCLUDE_LICENSED_MUSIC === '1';
const includeLicensedBasemaps = process.env.RAIL_INCLUDE_LICENSED_BASEMAPS === '1';

async function readRequiredEnv(name) {
  let source;
  try { source = await readFile(join(repoRoot, '.env'), 'utf8'); }
  catch { throw new Error(`建立含授權底圖的 App 前，repo 根目錄 .env 必須設定 ${name}`); }
  const line = source.split(/\r?\n/).find(candidate => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(candidate));
  if (!line) throw new Error(`建立含授權底圖的 App 前，repo 根目錄 .env 必須設定 ${name}`);
  let value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value) throw new Error(`repo 根目錄 .env 的 ${name} 不可為空`);
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
  'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'favicon-192.png', 'favicon-512.png',
  'apple-touch-180.png', 'icon-maskable-512.png', 'og-1200x630.png'
]) await copyFile(file);
for (const dir of ['assets', 'data']) await copyTree(dir);
// place_index.json 是本次 build 現場產物，尚未 git add 時不會通過 copyTree 的「只收 tracked」
// 閘門；明確單檔複製，不放寬其他未追蹤資料進 bundle。
await copyFile('data/place_index.json');
if (includeLicensedMusic) await copyTree('suno musics');

const noticeEntries = [
  ['Capacitor Core／iOS／Android 8.4.2', 'node_modules/@capacitor/core/LICENSE'],
  ['Capacitor Geolocation 8.2.0', 'node_modules/@capacitor/geolocation/LICENSE'],
  ['Capacitor Share 8.0.1', 'node_modules/@capacitor/share/LICENSE'],
  ['Capacitor Firebase Authentication 8.3.0', 'node_modules/@capacitor-firebase/authentication/LICENSE'],
  ['Firebase JavaScript SDK 12.16.0（Apache License 2.0）', 'node_modules/@capacitor-firebase/authentication/LICENSE'],
  ['RevenueCat Purchases Capacitor 13.2.2', 'node_modules/@revenuecat/purchases-capacitor/LICENSE'],
  ['Leaflet 1.9.4', 'node_modules/leaflet/LICENSE'],
  ['fflate 0.8.3', 'node_modules/fflate/LICENSE'],
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
await mkdir(join(vendor, 'leaflet', 'images'), { recursive: true });
await cp(join(appRoot, 'node_modules/leaflet/dist/leaflet.css'), join(vendor, 'leaflet/leaflet.css'));
await cp(join(appRoot, 'node_modules/leaflet/dist/leaflet.js'), join(vendor, 'leaflet/leaflet.js'));
await cp(join(appRoot, 'node_modules/leaflet/dist/images'), join(vendor, 'leaflet/images'), { recursive: true });
await cp(join(appRoot, 'node_modules/fflate/umd/index.js'), join(vendor, 'fflate.js'));

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

// (1) Leaflet:CDN 版換打包版(整個錨點區塊替換,不管網站用哪個 Leaflet 版本/SRI)
html = replaceHtmlRegion(html, 'leaflet-cdn',
  '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">\n<script src="vendor/leaflet/leaflet.js"></script>');
// (2) 原生 App 的數位功能只走 StoreKit／Google Play Billing;網站的 Ko-fi／銀行贊助區不帶進 App
html = stripHtmlRegion(html, 'donate-box');
html = stripHtmlRegion(html, 'donation-log');
html = stripJsRegion(html, 'donation-handler');
// (3) 網站免費層底圖預設(CARTO/舊 Esri)整段拔除——App 包內不得殘留其網址(CARTO 條款不允許包進上架 App)
html = stripJsRegion(html, 'web-tiles');
// (4) 頁尾底圖來源文字換成本 build 的實況
html = replaceHtmlRegion(html, 'basemap-credit',
  includeLicensedBasemaps
    ? 'Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap）、Esri World Imagery（衛星影像）與內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版）'
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
html = html
  .replace('<span class="ver" id="buildVer"></span>', '<a href="third-party-notices.txt" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;padding:0 4px">第三方軟體授權</a>\n      <span class="ver" id="buildVer"></span>')
  .replace('<script src="revenuecat-config.js"></script>', `<script src="revenuecat-config.js"></script>\n<script>window.RAIL_MUSIC_AVAILABLE=${includeLicensedMusic};window.RAIL_ONLINE_BASEMAPS_AVAILABLE=${includeLicensedBasemaps};window.RAIL_PLUS_SANDBOX_OK=${plusSandboxOk};window.RAIL_PLUS_SANDBOX_BUILD=${plusSandboxOk ? JSON.stringify(plusSandboxBuild) : 'null'}${appConfig ? `;window.RAIL_APP_CONFIG=${JSON.stringify(appConfig)}` : ''}</script>\n<script src="native-bridge.js"></script>`);
if (!html.includes('vendor/leaflet/leaflet.js') || !html.includes('native-bridge.js')) throw new Error('App index vendor/native bridge injection failed');
if (/ko-fi|PayPal|111010691056|web-only-donation-log|贊助方式更新/i.test(html) || html.includes('id="donateCopy"') || html.includes('class="foot-box foot-donate"')) throw new Error('External donation content leaked into native App');
if (/cartocdn\.com|arcgisonline\.com/i.test(html)) throw new Error('App index still contains unlicensed CARTO/Esri tile URLs');
await writeFile(indexPath, html);

await verifyRelease({
  out,
  expectLicensedMusic: includeLicensedMusic,
  expectLicensedBasemaps: includeLicensedBasemaps,
  expectPlusSandboxBuild: plusSandboxOk ? plusSandboxBuild : null,
  // cap sync 在 build 之後才跑,此刻原生內嵌資產必然還是舊版;原生同步的比對留給獨立的 npm run verify。
  skipNativeSyncCheck: true
});
console.log(`App web assets ready: ${out} (licensed music: ${includeLicensedMusic ? 'included' : 'excluded'}, licensed basemaps: ${includeLicensedBasemaps ? 'enabled' : 'disabled'})`);
