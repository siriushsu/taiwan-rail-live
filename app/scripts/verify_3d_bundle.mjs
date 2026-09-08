// 動態 import、physical JSON 與 Blender 網格不一定出現在 HTML 的 src；逐檔驗載貨。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verify3dBundle(target) {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'rail-3d', 'rail-3d.js', 'rail-3d.css'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const required of ['rail-3d/physical/network.json', 'rail-3d/physical/display-profiles.json', 'rail-3d/physical/metro-network.json', 'rail-3d/physical/metro-display-profiles.json', 'rail-3d/physical/dispatch.json', 'rail-3d/assets/blender-map-v1/manifest.json']) {
    if (!files.includes(required)) throw Error('3D 必要資產未追蹤：' + required);
  }
  let bytes = 0;
  for (const file of files) {
    const source = await readFile(resolve(repo, file));
    let bundled;
    try { bundled = await readFile(resolve(target, file)); }
    catch { throw Error('3D 載貨缺檔：' + file); }
    if (digest(source) !== digest(bundled)) throw Error('3D 載貨與來源不一致：' + file);
    bytes += source.length;
  }
  console.log(`  · 3D 載貨逐檔 SHA-256 一致：${files.length} 檔，${bytes} bytes`);
  return { files: files.length, bytes };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verify3dBundle(resolve(process.argv[2] || 'app/www'));
}
