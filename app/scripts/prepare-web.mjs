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
html = html
  .replace(/<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.css"[^>]*>/, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">')
  .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.js"[^>]*><\/script>/, '<script src="vendor/leaflet/leaflet.js"></script>')
  // 原生 App 的數位功能只走 StoreKit／Google Play Billing；網站既有的 Ko-fi／銀行贊助區不帶進 App。
  .replace(/\s*<details class="foot-box foot-donate">[\s\S]*?<\/details>/, '')
  .replace(/\s*<li class="web-only-donation-log">[\s\S]*?<\/li>/, '')
  .replace(/\/\/ APP_STRIP_START donation-handler[\s\S]*?\/\/ APP_STRIP_END donation-handler/, '')
  .replace('<span class="ver" id="buildVer"></span>', '<a href="third-party-notices.txt" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;padding:0 4px">第三方軟體授權</a>\n      <span class="ver" id="buildVer"></span>')
  .replace('<script src="revenuecat-config.js"></script>', `<script src="revenuecat-config.js"></script>\n<script>window.RAIL_MUSIC_AVAILABLE=${includeLicensedMusic};window.RAIL_ONLINE_BASEMAPS_AVAILABLE=${includeLicensedBasemaps}</script>\n<script src="native-bridge.js"></script>`);
if (!includeLicensedBasemaps) html = html.replace('id="satBtn" title="切換衛星影像"', 'id="satBtn" style="display:none" title="切換衛星影像"');
if (!html.includes('vendor/leaflet/leaflet.js') || !html.includes('native-bridge.js')) throw new Error('App index vendor/native bridge injection failed');
if (/ko-fi|PayPal|111010691056|web-only-donation-log|贊助方式更新/i.test(html) || html.includes('id="donateCopy"') || html.includes('class="foot-box foot-donate"')) throw new Error('External donation content leaked into native App');
await writeFile(indexPath, html);

await verifyRelease({
  out,
  expectLicensedMusic: includeLicensedMusic,
  expectLicensedBasemaps: includeLicensedBasemaps,
  // cap sync 在 build 之後才跑,此刻原生內嵌資產必然還是舊版;原生同步的比對留給獨立的 npm run verify。
  skipNativeSyncCheck: true
});
console.log(`App web assets ready: ${out} (licensed music: ${includeLicensedMusic ? 'included' : 'excluded'}, licensed basemaps: ${includeLicensedBasemaps ? 'enabled' : 'disabled'})`);
