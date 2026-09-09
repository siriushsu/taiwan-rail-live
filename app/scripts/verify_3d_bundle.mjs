// 動態 import、physical JSON 與 Blender 網格不一定出現在 HTML 的 src；逐檔驗載貨。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verify3dBundle(target) {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'rail-3d', 'rail-3d.js', 'rail-3d.css', 'train-garage.js', 'train-garage.css', 'train-garage-catalog.js', 'rail-discovery.js', 'night-theme.css', 'night-map.js', 'night-board.js', 'rail-platform.js', 'rail-platform-ui.js', 'rail-platform.css', 'bus-transfer-ui.js', 'i18n'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const required of ['rail-3d/environment/sun.mjs', 'rail-3d/integration/rail-structures.js', 'rail-3d/integration/follow-camera-lock.js', 'rail-3d/physical/network.json', 'rail-3d/physical/display-profiles.json', 'rail-3d/physical/metro-network.json', 'rail-3d/physical/metro-display-profiles.json', 'rail-3d/physical/dispatch.json', 'rail-3d/assets/blender-map-v1/manifest.json']) {
    if (!files.includes(required)) throw Error('3D 必要資產未追蹤：' + required);
  }
  const html=await readFile(resolve(target,'index.html'),'utf8');
  if(!html.includes("import('./rail-3d/environment/sun.js')")||html.includes("import('./rail-3d/environment/sun.mjs')"))throw Error('App 日夜光影必須使用原生可識別的 js 模組入口');
  const sunSource=await readFile(resolve(repo,'rail-3d/environment/sun.mjs'));
  const sunAlias=await readFile(resolve(target,'rail-3d/environment/sun.js'));
  if(digest(sunSource)!==digest(sunAlias))throw Error('App 日夜光影模組別名內容不一致');
  let bytes = 0;
  for (const file of files) {
    const source = await readFile(resolve(repo, file));
    let bundled;
    try { bundled = await readFile(resolve(target, file)); }
    catch { throw Error('3D 載貨缺檔：' + file); }
    if (digest(source) !== digest(bundled)) throw Error('3D 載貨與來源不一致：' + file);
    bytes += source.length;
  }
  console.log(`  · 3D／地景／車庫／日夜／翻譯載貨逐檔 SHA-256 一致：${files.length} 檔，${bytes} bytes`);
  return { files: files.length, bytes };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verify3dBundle(resolve(process.argv[2] || 'app/www'));
}
