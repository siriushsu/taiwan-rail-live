// 產生 data/data_manifest.json:每個「開機會載入的資料檔」對應一個內容雜湊。
//
// 為什麼要這個:App bundle 裡的 data/*.json 是送審當下的快照,之後只有再送審才會更新
// ——三鶯線試營運時段(2026-08-31 到期)、各線改點、班表重抓都會讓它與網站脫節,而使用者
// 看到的是錯的班次。有了這份清單,App 開機只抓它(約 1KB),雜湊對不上的檔才回網站重抓;
// 平常一個小請求,改了什麼就只下載什麼。消費端在 index.html 的 initDataFreshness()。
//
// 檔案清單刻意「從 index.html 掃出來」而不是手寫在這裡:手寫的清單一定會跟程式漂移
// (日後新增一個資料檔卻忘了加進來,就是無聲失效)。index.html 裡全部是字面字串,掃得到。
//
// 🔴 資料檔改動後必須重跑本腳本並一起 commit,否則網站的清單會宣稱「什麼都沒變」而 App
// 永遠不會更新。verify_data_manifest.mjs 是對應的閘門(prepare-web 與發行檢查都會跑)。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'data/data_manifest.json';

export function collectDataFiles(root = ROOT) {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const found = new Set();
  for (const m of html.matchAll(/'\.\/(data\/[a-z0-9_]+\.(?:geo)?json)'/g)) found.add(m[1]);
  return [...found].sort();
}

export function buildManifest(root = ROOT) {
  const out = {};
  for (const rel of collectDataFiles(root)) {
    if (rel === OUT) continue;                       // 清單不含自己
    let buf;
    try { buf = readFileSync(path.join(root, rel)); }
    catch (e) { continue; }                          // 選用資料檔可以不存在(前端本來就容忍缺檔)
    out[rel] = createHash('md5').update(buf).digest('hex');
  }
  return out;
}

// 🔴 判「是不是被直接執行」不可以寫成 `import.meta.url === \`file://${process.argv[1]}\``:
// 這個 repo 的路徑含中文,import.meta.url 會百分比編碼而 argv[1] 不會,兩者永遠不相等 ⇒
// 腳本靜默什麼都不做、退出碼還是 0(2026-08-04 踩過)。一律解碼成路徑再比。
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const m = buildManifest();
  writeFileSync(path.join(ROOT, OUT), JSON.stringify(m, null, 1) + '\n');
  const bytes = Buffer.byteLength(JSON.stringify(m, null, 1));
  console.log(`data_manifest: ${Object.keys(m).length} 個資料檔，${bytes} bytes → ${OUT}`);
}
