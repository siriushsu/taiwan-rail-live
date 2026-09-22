// 小工具預覽圖守門人(spec §7-11):分母不是手打清單,而是 index.html 說明中心 widgets[] 真正引用的 img(兩個平台分支都算),
// 與 git 追蹤的 assets/widgets/** 必須「恰好相等」(缺一張=說明頁破圖;多一張=孤兒檔進 App bundle);每檔 ≤30 KB、合計 ≤500 KB。
// 掛在 app/scripts/verify-release.mjs(App 出貨鏈);網站永不請求這些檔(verify_query_tab G10a),不掛 ship_web。
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function verifyWidgetPreviews({ log = true } = {}) {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const referenced = [...new Set([...html.matchAll(/img: '(assets\/widgets\/[^']+\.webp)'/g)].map(m => m[1]))];
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'assets/widgets'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const fails = [];
  if (referenced.length === 0) fails.push('index.html 找不到任何 widgets[].img 引用（regex 過期？）');
  for (const f of referenced) if (!tracked.includes(f)) fails.push(`${f} 被說明中心引用但未追蹤（App 打包只收追蹤檔）`);
  for (const f of tracked) if (!referenced.includes(f)) fails.push(`${f} 已追蹤但說明中心沒引用（孤兒檔會進 App bundle）`);
  let total = 0;
  for (const f of referenced) {
    let s; try { s = statSync(path.join(ROOT, f)).size; } catch (e) { fails.push(`${f} 磁碟上不存在`); continue; }
    total += s; if (s > 30 * 1024) fails.push(`${f} ${Math.round(s / 1024)} KB > 30 KB`);
  }
  if (total > 500 * 1024) fails.push(`合計 ${Math.round(total / 1024)} KB > 500 KB`);
  if (fails.length) throw new Error('小工具預覽圖守門人：\n' + fails.join('\n'));
  if (log) console.log(`PASS 小工具預覽圖 ${referenced.length} 檔（index.html 引用＝git 追蹤）、合計 ${Math.round(total / 1024)} KB`);
  return { files: referenced, total };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { verifyWidgetPreviews(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
