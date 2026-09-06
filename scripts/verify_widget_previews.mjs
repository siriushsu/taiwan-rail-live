// 小工具預覽圖預算(spec §7-11):15 檔皆 git 追蹤、每檔 ≤30 KB、合計 ≤500 KB。分母自己有斷言。
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IOS = ['metro-small', 'metro-medium', 'metro-large', 'rail-small', 'rail-medium', 'rail-large', 'rail-rect', 'mixed-large'];
const ANDROID = ['metro-small', 'metro-medium', 'metro-large', 'rail-small', 'rail-medium', 'rail-large', 'mixed-large'];
const files = [...IOS.map(k => `assets/widgets/ios/${k}.webp`), ...ANDROID.map(k => `assets/widgets/android/${k}.webp`)];
const tracked = new Set(execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'assets/widgets'], { encoding: 'utf8' }).split('\n').filter(Boolean));
let total = 0, fails = [];
for (const f of files) {
  if (!tracked.has(f)) { fails.push(`${f} 未追蹤（App 打包只收追蹤檔）`); continue; }
  const s = statSync(path.join(ROOT, f)).size; total += s;
  if (s > 30 * 1024) fails.push(`${f} ${Math.round(s / 1024)} KB > 30 KB`);
}
if (files.length !== 15) fails.push(`清單應為 15 檔，實際 ${files.length}`);
if (total > 500 * 1024) fails.push(`合計 ${Math.round(total / 1024)} KB > 500 KB`);
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `PASS 15 檔、合計 ${Math.round(total / 1024)} KB`);
process.exit(fails.length ? 1 : 0);
