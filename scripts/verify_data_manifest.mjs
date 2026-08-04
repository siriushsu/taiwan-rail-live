// 閘門:data/data_manifest.json 必須與磁碟上的資料檔一致。
//
// 存在的理由:清單過期是「無聲失效」——網站會宣稱什麼都沒變,App 就永遠不更新資料,
// 而畫面照常有車,沒有任何錯誤訊息。這正是這個專案最常踩的那類 bug,所以要有閘門。
// 退出碼非 0 ⇒ 跑 `node scripts/build_data_manifest.mjs` 重產並一起 commit。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build_data_manifest.mjs';

const ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('[manifest gate] 目標目錄:', ROOT);

let onDisk;
try { onDisk = JSON.parse(readFileSync(path.join(ROOT, 'data/data_manifest.json'), 'utf8')); }
catch (e) {
  console.error('❌ 讀不到 data/data_manifest.json —— 跑 `node scripts/build_data_manifest.mjs`');
  process.exit(1);
}
const expect = buildManifest(ROOT);

const missing = Object.keys(expect).filter(k => !(k in onDisk));
const extra = Object.keys(onDisk).filter(k => !(k in expect));
const differ = Object.keys(expect).filter(k => k in onDisk && onDisk[k] !== expect[k]);

for (const k of missing) console.error(`  ❌ 清單缺少：${k}`);
for (const k of extra) console.error(`  ❌ 清單多出（檔案已不存在或已不再被載入）：${k}`);
for (const k of differ) console.error(`  ❌ 雜湊過期：${k}（清單 ${onDisk[k].slice(0, 8)}… vs 實際 ${expect[k].slice(0, 8)}…）`);

if (missing.length || extra.length || differ.length) {
  console.error(`\n❌ data_manifest 與實際資料檔不符（缺 ${missing.length}／多 ${extra.length}／過期 ${differ.length}）。`);
  console.error('   修法：node scripts/build_data_manifest.mjs，然後把 data/data_manifest.json 一起 commit。');
  process.exit(1);
}
console.log(`✅ data_manifest 與 ${Object.keys(expect).length} 個資料檔一致`);
