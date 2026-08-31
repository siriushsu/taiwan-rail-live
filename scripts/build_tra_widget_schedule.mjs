// 產生 data/tra_widget_schedule.json:給「原生桌面小工具」用的台鐵班表精簡版。
//
// 為什麼要這一份:桌面小工具的台鐵班表是打包進 APK/IPA 的靜態快照,而台鐵班表是
// 14 天滾動窗——App 不重新上架,小工具就會一直拿過期班表推算,窗過完之後只能退到
// 「同星期最近來源日」硬撐。網頁版早就會自己抓新的,小工具沒有這條路。
//
// 為什麼不直接讓小工具抓 data/tra_schedule_dense.json:那份 5.9 MB,小工具更新跑在
// 廣播接收器/timeline provider 裡,解析成本與記憶體都不合適。這份把站名換成索引、
// depSec 換成停站秒數、丟掉小工具用不到的欄位(lat/lon 只留在站表、order 可由順序推得),
// 實測 646 KB / gzip 174 KB——而且**一份涵蓋整個 14 天窗**,抓一次撐到窗結束,
// 不是每天抓一次。
//
// 沒有做成 worker 端點:它是純衍生的靜態檔,放 data/ 就跟其他資料檔一樣被邊緣快取,
// 零 CPU、零 D1;而且日期窗寫在檔裡,對不上就退回內建,不會有「端點吐了昨天的」這種狀態。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'data/tra_schedule_dense.json';
const OUT = 'data/tra_widget_schedule.json';

const dense = JSON.parse(readFileSync(path.join(ROOT, SRC), 'utf8'));

const index = new Map();
const stations = [];
for (const train of dense.trains) {
  for (const stop of train.stops) {
    if (index.has(stop.name)) continue;
    index.set(stop.name, stations.length);
    // 座標給小工具的「自動選最近的站」用;dense 裡通過站的座標是沿線形內插出來的。
    stations.push([stop.name, stop.lat, stop.lon]);
  }
}

// 顏色是車種的純函數(實測 5 個車種零衝突),所以抽成對照表而不是逐車帶一份。
const types = {};
for (const train of dense.trains) {
  const prev = types[train.typeName];
  if (prev && prev !== train.color) {
    throw new Error(`車種 ${train.typeName} 有兩個顏色(${prev} / ${train.color})——顏色不再是車種的函數,這份的 types 對照表要改成逐車帶`);
  }
  types[train.typeName] = train.color;
}

// [車次, 車種, [[站索引, 到站秒, 停站秒, 停靠?1:0], ...]]
const trains = dense.trains.map((train) => [
  train.train,
  train.typeName,
  train.stops.map((stop) => [index.get(stop.name), stop.arrSec, stop.depSec - stop.arrSec, stop.stop ? 1 : 0]),
]);

const doc = {
  v: 1,
  source_notes: `台鐵官方 ODS 逐日時刻表,經 ${SRC} 轉出;站座標沿用 dense 檔(停靠站為官方站點,通過站為沿 tra.json 線形內插)`,
  generated: new Date().toISOString(),
  dateRange: dense.dateRange,
  stations,
  types,
  dates: dense.dates,
  trains,
};

// 自檢:解回去必須與來源逐欄相同。編碼錯了要在這裡當場死,不要等小工具畫出錯的時刻。
let checked = 0;
for (let i = 0; i < dense.trains.length; i += 1) {
  const src = dense.trains[i];
  const [no, ty, stops] = trains[i];
  if (no !== src.train || ty !== src.typeName) throw new Error(`第 ${i} 筆車次/車種對不上`);
  if (stops.length !== src.stops.length) throw new Error(`車次 ${no} 停靠數對不上`);
  for (let j = 0; j < stops.length; j += 1) {
    const [si, arr, dwell, stop] = stops[j];
    const s = src.stops[j];
    if (stations[si][0] !== s.name) throw new Error(`車次 ${no} 第 ${j} 站站名對不上`);
    if (arr !== s.arrSec || arr + dwell !== s.depSec) throw new Error(`車次 ${no} 第 ${j} 站時刻對不上`);
    if (Boolean(stop) !== Boolean(s.stop)) throw new Error(`車次 ${no} 第 ${j} 站停靠旗標對不上`);
    checked += 1;
  }
}

writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(doc)}\n`);
const kb = (Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(0);
console.log(`${OUT}: ${dense.trains.length} 車次 / ${stations.length} 站 / ${Object.keys(dense.dates).length} 天 / ${kb} KB`);
console.log(`  涵蓋 ${doc.dateRange[0]} ~ ${doc.dateRange[1]},往返自檢 ${checked} 個停靠點全對`);
