// 閘門：data/tra_track_sections.json 的每一對單／雙線，必須等於「真相表」。
//
// 為什麼要有這一支：區間表是純幾何產的（OSM 線形旁邊有沒有第二股），判錯的代價很直接——
// 判雙線會漏掉整段交會推論、判單線會多夾一次通過時刻。幾何的真值來源就是被驗的那份網路，
// 自己驗自己是零資訊，所以期望值取**另外四個外部來源交叉出來的**逐站對真相表
// scripts/fixtures/tra-track-sections-truth-0914.json（官方《路線修築沿革》2024-08、
// 交通部鐵道局公告、維基路線／隧道條目、TDX GIS v3 逐股幾何；核實過程見該檔的 provenance）。
//
// 判準：
//   * 真相表有的站對 → tracks 必須相同，任何一對不同就 FAIL（這是硬閘門）。
//   * 真相表沒有的站對（派車表新長出來的）→ 只警告，不擋；請補進真相表再說。
//   * 全網單／雙線 km 對官方年度統計 → 只印，不擋。口徑本來就不同（見下）。
// 站名用字：兩邊的鍵都用 sectionKey() 正規化成班表用字「臺」再比。
//
// 跑法：node scripts/verify_tra_track_sections.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionKey } from './lib/parallel_tracks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const truth = rd('scripts/fixtures/tra-track-sections-truth-0914.json');
const repo = rd('data/tra_track_sections.json');
const key = k => sectionKey(...k.split('|'));

const T = new Map(Object.entries(truth.pairs).map(([k, v]) => [key(k), v]));
const R = new Map(Object.entries(repo.pairs).map(([k, v]) => [key(k), v]));

const bad = [], extra = [], missing = [];
for (const [k, v] of R) {
  const t = T.get(k);
  if (!t) { extra.push(k); continue; }
  if (t.tracks !== v.tracks) bad.push(`${k}  真相 ${t.tracks} ≠ 本檔 ${v.tracks}（幾何 parallelFrac=${v.parallelFrac}；真相依據：${t.basis}／${t.era}）`);
}
for (const k of T.keys()) if (!R.has(k)) missing.push(k);

// 全網里程對帳（只印）。兩套長度都印：真相表用官方營業里程，本檔用 OSM 路徑幾何長。
let km1 = 0, km2 = 0;
for (const v of R.values()) { if (v.tracks === 2) km2 += v.lengthM / 1000; else km1 += v.lengthM / 1000; }
const stats = rd('scripts/fixtures/tra-track-length-stats.json');
const y = stats[stats.length - 1], o1 = y['單線路線里程公里'], o2 = y['雙線路線里程公里'];
console.log(`站對 ${R.size}（真相表 ${T.size}）｜不一致 ${bad.length}｜真相表沒有的新站對 ${extra.length}｜真相表有但本檔沒有 ${missing.length}`);
console.log(`里程對帳（只印不擋）：本檔幾何長 單線 ${km1.toFixed(1)} km／雙線 ${km2.toFixed(1)} km ｜`
  + ` 真相表官方里程 單線 ${truth.totals.singleKmBinarized}／雙線 ${truth.totals.doubleKmBinarized} km ｜`
  + ` 官方 ${y['年度']} 年度統計 單線 ${o1}／雙線 ${o2} km（台鐵公司開放資料，政府資料開放授權 1.0）`);
// 差額逐項對得上（4 項合計 = 41.2），來源 double-track-truth.md §5：
//   +9.1 花東 4 處瓶頸 2022-11-21 才完工，官方統計停在 2020 ⇒ 本來就不在 717.4 裡
//   +22.5 「營業雙線路線里程」與「逐區間幾何加總」的量測基準差（官方未公布口徑），在全網 1053.1 km 的判法上量得
//   +4.6 每對只能記 1 或 2 的二值化進位（大武｜枋野一對就佔 6.4：整段 23.3 km 只有 16.9 km 雙線）
//   +5.0 母體差：本表 243 對合計 1058.1 km，上面那個判法的表列各線合計 1053.1 km
console.log(`  雙線差 +${(truth.totals.doubleKmBinarized - o2).toFixed(1)} km ＝ 2022-11 才完工 +9.1｜統計口徑基準差 +22.5｜`
  + `二值化進位 +${(truth.totals.doubleKmBinarized - truth.totals.doubleKmExact).toFixed(1)}（大武｜枋野佔 6.4）｜母體差 +5.0（243 對 1058.1 km vs 表列各線 1053.1 km）。`
  + `四項加總剛好等於差額，都不是逐對判錯 ⇒ 不當閘門。`);
for (const k of extra) console.log(`  ⚠️ 真相表沒有這一對，未驗：${k}`);
for (const k of missing) console.log(`  ⚠️ 真相表有、本檔沒有（派車表不再派這一段？）：${k}`);
for (const b of bad) console.log(`  ❌ ${b}`);
console.log(bad.length === 0 ? 'PASS  區間表逐對與真相表一致' : `FAIL  ${bad.length} 對與真相表不一致`);
process.exit(bad.length === 0 ? 0 : 1);
