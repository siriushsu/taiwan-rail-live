import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertLicensedBuildAllowed, verifyRelease } from './verify-release.mjs';

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

const indexPath = join(out, 'index.html');
let html = await readFile(indexPath, 'utf8');
const legacyBasemapBlock = /  if \(onlineBasemapsAvailable\(\)\) \{\n    baseLayers\.light = L\.tileLayer\('https:\/\/\{s\}\.basemaps\.cartocdn\.com[\s\S]*?\n  \}\n  \/\/ 外觀三段/;
const stadiaAttribution = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const appBasemapBlock = includeLicensedBasemaps
  ? `  if (onlineBasemapsAvailable()) {
    baseLayers.light = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key=${stadiaApiKey}', {
      maxZoom: 20, crossOrigin: true, keepBuffer: kb, attribution: '${stadiaAttribution}',
    });
    baseLayers.dark = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png?api_key=${stadiaApiKey}', {
      maxZoom: 20, crossOrigin: true, keepBuffer: kb, attribution: '${stadiaAttribution}',
    });
  }
  // 外觀三段`
  : `  if (onlineBasemapsAvailable()) {
    // App 安全 build：發行政策未核准線上底圖，不建立任何線上 tile layer。
  }
  // 外觀三段`;
if (!legacyBasemapBlock.test(html)) throw new Error('App index basemap rewrite target not found');
html = html
  .replace(/<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.css"[^>]*>/, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">')
  .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.js"[^>]*><\/script>/, '<script src="vendor/leaflet/leaflet.js"></script>')
  // 原生 App 的數位功能只走 StoreKit／Google Play Billing；網站既有的 Ko-fi／銀行贊助區不帶進 App。
  .replace(/\s*<details class="foot-box foot-donate">[\s\S]*?<\/details>/, '')
  .replace(/\s*<li class="web-only-donation-log">[\s\S]*?<\/li>/, '')
  .replace(/\/\/ APP_STRIP_START donation-handler[\s\S]*?\/\/ APP_STRIP_END donation-handler/, '')
  .replace('<span class="ver" id="buildVer"></span>', '<a href="third-party-notices.txt" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;padding:0 4px">第三方軟體授權</a>\n      <span class="ver" id="buildVer"></span>')
  .replace('<script src="revenuecat-config.js"></script>', `<script src="revenuecat-config.js"></script>\n<script>window.RAIL_MUSIC_AVAILABLE=${includeLicensedMusic};window.RAIL_ONLINE_BASEMAPS_AVAILABLE=${includeLicensedBasemaps}</script>\n<script src="native-bridge.js"></script>`)
  .replace(legacyBasemapBlock, appBasemapBlock)
  .replace("const sat = online && state.basemap === 'sat';", "const sat = false; // App v1 暫不提供衛星底圖")
  .replace('id="satBtn" title="切換衛星影像"', 'id="satBtn" style="display:none" title="切換衛星影像"')
  .replace('class="ms-row" data-proxy="satBtn"', 'class="ms-row" data-proxy="satBtn" style="display:none"')
  .replace(
    'CARTO basemaps（© OpenStreetMap）、Esri World Imagery（衛星影像）與 Natural Earth（離線海陸輪廓）',
    includeLicensedBasemaps
      ? 'Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap）與 Natural Earth（離線海陸輪廓）'
      : 'Natural Earth（離線海陸輪廓；線上底圖未納入此版本）'
  );
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
