// 閘門:data/data_provenance.json 必須與磁碟上的資料檔一致,而且不得「轉述」來源。
//
// 存在的理由:一份沒有閘門的來源清單,過幾個月就是一份讀起來很合理的謊——正是它想防的那件事
// (`data/tdx/` 底下的檔不保證來自 TDX)。所以每一格都要能被機器打臉:
//   P1 覆蓋:manifest 的每一個檔都要有條目,沒有孤兒條目
//   P2 雜湊:條目的 checksum == 磁碟實算 == data_manifest 的值(兩份清單不得各說各話)
//   P3 逐字前綴:sourceField 指得到欄位的,描述必須是那段原文(空白正規化後)的【逐字前綴】
//              ——擋住「把來源改寫成一句好聽的話」這種無聲漂移
//   P4 非空:每條描述至少 8 個字
//   P5 座標基準:有幾何來源就必須掛對應的基準句,沒有就必須是 null(不得留一句沒人查過的話)
//   P6 決定性:重跑 buildProvenance() 要與磁碟上的檔逐 byte 相同(＝資料改了卻沒重產,會紅)
//   P7 手寫表無孤兒:GEOMETRY_SOURCE / HAND / SOURCE_FIELD 裡指到已不存在的檔要報出來
//
// 退出碼非 0 ⇒ 跑 `node scripts/build_data_provenance.mjs` 重產並一起 commit。
// 用法:node scripts/verify_data_provenance.mjs [受測樹根目錄]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build_data_manifest.mjs';
import { buildProvenance, GEOMETRY_SOURCE, HAND, SOURCE_FIELD, BASIS } from './build_data_provenance.mjs';

const ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log('[provenance gate] 目標目錄:', ROOT);

let fail = 0;
const ck = (name, ok, detail) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name} — ${detail}`); if (!ok) fail++; };

let onDisk;
try { onDisk = JSON.parse(readFileSync(path.join(ROOT, 'data/data_provenance.json'), 'utf8')); }
catch (e) {
  console.error('❌ 讀不到 data/data_provenance.json —— 跑 `node scripts/build_data_provenance.mjs`');
  process.exit(1);
}
const manifest = buildManifest(ROOT);
const files = onDisk.files || {};
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const at = (j, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), j);

// P1 覆蓋
{
  const missing = Object.keys(manifest).filter(k => !(k in files));
  const orphan = Object.keys(files).filter(k => !(k in manifest));
  ck('P1 覆蓋:manifest 的每個檔都有來源條目、無孤兒',
    missing.length === 0 && orphan.length === 0,
    `${Object.keys(manifest).length} 個資料檔;缺 ${missing.length}${missing.length ? '(' + missing.join(',') + ')' : ''}、孤兒 ${orphan.length}${orphan.length ? '(' + orphan.join(',') + ')' : ''}`);
}

// P2 雜湊三方一致
// 🔴 第三方必須是【磁碟上那份 data_manifest.json】,不是 buildManifest() 現算的結果:
//    buildManifest 是照著同一批檔案重算一次雜湊,拿它跟實檔比是同源恆等式,零資訊
//    (初版就是這樣寫的,對 2026-08-21 那筆真實的 manifest 過期完全視而不見)。
{
  let mDisk = null;
  try { mDisk = JSON.parse(readFileSync(path.join(ROOT, 'data/data_manifest.json'), 'utf8')); } catch (e) { mDisk = null; }
  const bad = [];
  if (!mDisk) bad.push('讀不到 data/data_manifest.json');
  for (const [rel, v] of Object.entries(files)) {
    let real = null;
    try { real = createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex'); } catch (e) { bad.push(`${rel}:讀不到檔`); continue; }
    if (v.checksum !== real) bad.push(`${rel}:本清單 ${String(v.checksum).slice(0, 8)}… vs 實檔 ${real.slice(0, 8)}…`);
    else if (mDisk && mDisk[rel] && mDisk[rel] !== real) bad.push(`${rel}:data_manifest 記 ${String(mDisk[rel]).slice(0, 8)}… vs 實檔 ${real.slice(0, 8)}…(App 因此永遠不會重抓這個檔)`);
  }
  ck('P2 雜湊:條目 == 磁碟實算 == 磁碟上的 data_manifest', bad.length === 0,
    bad.length ? bad.slice(0, 4).join(' / ') : `${Object.keys(files).length} 個檔三方一致`);
}

// P3 逐字前綴
{
  const bad = []; let checked = 0;
  for (const [rel, v] of Object.entries(files)) {
    if (!v.sourceField) continue;
    let j = null;
    try { j = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')); } catch (e) { bad.push(`${rel}:解析不了`); continue; }
    const raw = at(j, v.sourceField);
    if (typeof raw !== 'string') { bad.push(`${rel}:欄位 ${v.sourceField} 不是字串`); continue; }
    checked++;
    if (!norm(raw).startsWith(v.sourceDescription)) bad.push(`${rel}:描述不是 ${v.sourceField} 的逐字前綴`);
  }
  // 分母也要有牙:有內嵌來源的檔一路變成 sourceField=null 的話,這條會靜默退化成 0/0 全過。
  const withField = Object.values(files).filter(v => v.sourceField).length;
  ck('P3 逐字前綴:描述必須逐字取自檔內來源欄位', bad.length === 0 && checked === withField && checked >= 20,
    bad.length ? bad.slice(0, 4).join(' / ') : `${checked} 個檔逐字比對通過(另 ${Object.keys(files).length - checked} 個檔內無來源欄位,描述來自 HAND 表)`);
}

// P4 非空
{
  const bad = Object.entries(files).filter(([, v]) => !(typeof v.sourceDescription === 'string' && v.sourceDescription.length >= 8)).map(([k]) => k);
  ck('P4 每條來源描述非空', bad.length === 0, bad.length ? bad.join(',') : `${Object.keys(files).length} 條皆 ≥8 字`);
}

// P5 座標基準
{
  const bad = [];
  for (const [rel, v] of Object.entries(files)) {
    if (v.geometrySource) {
      if (v.coordinateBasis !== BASIS[v.geometrySource]) bad.push(`${rel}:基準句與 ${v.geometrySource} 的定義不符`);
    } else if (v.coordinateBasis !== null) bad.push(`${rel}:無幾何來源卻掛了座標基準`);
  }
  const geo = Object.values(files).filter(v => v.geometrySource).length;
  ck('P5 座標基準與幾何來源一致', bad.length === 0 && geo >= 10,
    bad.length ? bad.slice(0, 4).join(' / ') : `含座標 ${geo} 個、無座標 ${Object.keys(files).length - geo} 個,基準句逐條對上`);
}

// P6 決定性/新鮮度
{
  let rebuilt = null, err = null;
  try { rebuilt = JSON.stringify(buildProvenance(ROOT), null, 1) + '\n'; } catch (e) { err = e.message; }
  const cur = readFileSync(path.join(ROOT, 'data/data_provenance.json'), 'utf8');
  ck('P6 決定性:重跑 build 與磁碟上的檔逐 byte 相同', !err && rebuilt === cur,
    err ? `build 直接拋錯:${err}` : (rebuilt === cur ? `${cur.length} bytes 完全一致` : '清單過期 —— 跑 node scripts/build_data_provenance.mjs 重產並一起 commit'));
}

// P7 手寫表無孤兒
{
  const orphan = [];
  for (const [tbl, obj] of [['GEOMETRY_SOURCE', GEOMETRY_SOURCE], ['HAND', HAND], ['SOURCE_FIELD', SOURCE_FIELD]])
    for (const k of Object.keys(obj)) if (!(k in manifest)) orphan.push(`${tbl}:${k}`);
  ck('P7 手寫表沒有指向已不存在的檔', orphan.length === 0,
    orphan.length ? orphan.join(' / ') : 'GEOMETRY_SOURCE／HAND／SOURCE_FIELD 三張表皆對得上 manifest');
}

if (fail) { console.error(`\n❌ data_provenance 有 ${fail} 項不通過。`); process.exit(1); }
console.log(`\n✅ data_provenance 與 ${Object.keys(manifest).length} 個資料檔一致(7 項全過)`);
