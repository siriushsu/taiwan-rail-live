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
const esriApiKey = includeLicensedBasemaps ? encodeURIComponent(await readRequiredEnv('ESRI_API_KEY')) : null;
await assertLicensedBuildAllowed({ includeLicensedMusic, includeLicensedBasemaps });

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const copyFile = async relative => {
  const target = join(out, relative); await mkdir(dirname(target), { recursive: true });
  await cp(join(repoRoot, relative), target);
};
const copyTree = async relative => {
  const source = join(repoRoot, relative), target = join(out, relative);
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source)) {
    if (entry === '.DS_Store' || entry.includes('.bak-')) continue;
    const child = join(relative, entry), info = await stat(join(repoRoot, child));
    if (info.isDirectory()) await copyTree(child); else await copyFile(child);
  }
};

for (const file of [
  'index.html', 'account-deletion.html', 'app-support.html', 'privacy.html', 'terms.html', 'firebase-config.js', 'revenuecat-config.js', 'manifest.webmanifest',
  'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'favicon-192.png', 'favicon-512.png',
  'apple-touch-180.png', 'icon-maskable-512.png', 'og-1200x630.png'
]) await copyFile(file);
for (const dir of ['assets', 'data']) await copyTree(dir);
if (includeLicensedMusic) await copyTree('suno musics');

const noticeEntries = [
  ['Capacitor Core／iOS／Android 8.4.2', 'node_modules/@capacitor/core/LICENSE'],
  ['Capacitor Geolocation 8.2.0', 'node_modules/@capacitor/geolocation/LICENSE'],
  ['Capacitor Share 8.0.1', 'node_modules/@capacitor/share/LICENSE'],
  ['Capacitor Firebase Authentication 8.3.0', 'node_modules/@capacitor-firebase/authentication/LICENSE'],
  ['Firebase JavaScript SDK 12.16.0（Apache License 2.0）', 'node_modules/@capacitor-firebase/authentication/LICENSE'],
  ['RevenueCat Purchases Capacitor 13.2.2', 'node_modules/@revenuecat/purchases-capacitor/LICENSE'],
  ['Leaflet 1.9.4', 'node_modules/leaflet/LICENSE'],
  ['fflate 0.8.3', 'node_modules/fflate/LICENSE']
];
const notices = ['軌島原生 App 第三方軟體授權聲明', '產生自 app/package-lock.json 的直接發行依賴。原生 archive 的 transitive dependency acknowledgements 另於送審前核對。'];
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
    ? 'Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap）、Esri World Imagery（衛星影像）與 Natural Earth（離線海陸輪廓）'
    : 'Natural Earth（離線海陸輪廓；線上底圖未納入此版本）');
// (5) 注入:第三方授權入口＋功能旗標＋RAIL_APP_CONFIG(授權圖磚與計量底圖的跟車 zoom 上限)
const appConfig = includeLicensedBasemaps ? {
  followZoomCap: 16, // 計量底圖止血:跟車進場/導播 zoom 上限(index.html 的 FOLLOW_ZOOM_CAP/DIRECTOR_FOLLOW_Z 消費)
  tiles: {
    light: { url: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key=${stadiaApiKey}`, maxZoom: 20, attribution: STADIA_ATTRIBUTION },
    dark: { url: `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png?api_key=${stadiaApiKey}`, maxZoom: 20, attribution: STADIA_ATTRIBUTION },
    sat: { url: `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${esriApiKey}`, maxZoom: 19, attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics' }
  }
} : null;
html = html
  .replace('<span class="ver" id="buildVer"></span>', '<a href="third-party-notices.txt" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;padding:0 4px">第三方軟體授權</a>\n      <span class="ver" id="buildVer"></span>')
  .replace('<script src="revenuecat-config.js"></script>', `<script src="revenuecat-config.js"></script>\n<script>window.RAIL_MUSIC_AVAILABLE=${includeLicensedMusic};window.RAIL_ONLINE_BASEMAPS_AVAILABLE=${includeLicensedBasemaps}${appConfig ? `;window.RAIL_APP_CONFIG=${JSON.stringify(appConfig)}` : ''}</script>\n<script src="native-bridge.js"></script>`);
if (!html.includes('vendor/leaflet/leaflet.js') || !html.includes('native-bridge.js')) throw new Error('App index vendor/native bridge injection failed');
if (/ko-fi|PayPal|111010691056|web-only-donation-log|贊助方式更新/i.test(html) || html.includes('id="donateCopy"') || html.includes('class="foot-box foot-donate"')) throw new Error('External donation content leaked into native App');
if (/cartocdn\.com|arcgisonline\.com/i.test(html)) throw new Error('App index still contains unlicensed CARTO/Esri tile URLs');
await writeFile(indexPath, html);

await verifyRelease({
  out,
  expectLicensedMusic: includeLicensedMusic,
  expectLicensedBasemaps: includeLicensedBasemaps,
  // cap sync 在 build 之後才跑,此刻原生內嵌資產必然還是舊版;原生同步的比對留給獨立的 npm run verify。
  skipNativeSyncCheck: true
});
console.log(`App web assets ready: ${out} (licensed music: ${includeLicensedMusic ? 'included' : 'excluded'}, licensed basemaps: ${includeLicensedBasemaps ? 'enabled' : 'disabled'})`);
