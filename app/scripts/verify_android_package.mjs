// 驗實際 APK/AAB 的資產，不只驗 cap sync 前的 www。
// AGP 曾把車庫 *.bin.gz 自動解壓並改名，造成 www 全綠、App 車庫卻缺模型。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(appRoot, 'android/app/src/main/assets/public');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else files.push(file);
  }
}
walk(sourceRoot);
if (files.length < 1000) throw Error('原生來源資產不足，請先 cap sync android');
if (!process.argv[2]) throw Error('用法：node app/scripts/verify_android_package.mjs <APK 或 AAB>');
for (const arg of process.argv.slice(2)) {
  const archive = resolve(arg);
  const prefix = archive.endsWith('.aab') ? 'base/assets/public/' : 'assets/public/';
  const packed = unzipSync(readFileSync(archive), { filter: entry => entry.name.startsWith(prefix) });
  const failures = [];
  let gzipCount = 0;
  for (const source of files) {
    const name = relative(sourceRoot, source).split('\\').join('/');
    const bytes = packed[prefix + name];
    if (!bytes) failures.push('缺檔：' + name);
    else if (!readFileSync(source).equals(Buffer.from(bytes))) failures.push('位元組不符：' + name);
    if (name.endsWith('.gz')) gzipCount++;
  }
  if (gzipCount !== 62) throw Error(`車庫壓縮模型應有 62 份，來源只有 ${gzipCount}`);
  if (failures.length) throw Error(`${archive}：${failures.length} 項錯誤\n${failures.slice(0, 8).join('\n')}`);
  console.log(`Android 成品核對通過：${archive}，${files.length} 檔逐 byte 一致，${gzipCount} 份 gzip 模型完整保留。`);
}
