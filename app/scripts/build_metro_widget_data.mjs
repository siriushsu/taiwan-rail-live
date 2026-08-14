#!/usr/bin/env node
// 產生捷運小工具的離線資料檔(站清單／方向／別名表／末班車表),打包進 Widget Extension bundle。
// 🔴 這份檔「不」寫進 App Group、不碰 boardFormatVersion——與發車看板的寫檔管線零交集。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'app/ios/App/RailBoardWidget/MetroWidgetData.json');

// 只收「官方有站牌倒數」的系統。環狀線／淡海／安坑只有軌道佔用、中捷無公開介接,刻意不列。
const SYS = [
  // 🔴 `data/trtc.json` 的 9 條線包含環狀線 Y——它由新北捷運公司營運,首末班在 NTMC 那份,
  //    只讀 TRTC 那份會讓 Y 的 14 站全部沒有方向與末班車(而且其中 4 站會因為站名與北捷站
  //    相同而配到別條線的終點,那是錯資料不是缺資料)。Y 的站牌 ETA 確實存在,就在 trtc-live
  //    的 board[] 裡(dest ＝新北產業園區站／大坪林站,實測 22 筆涵蓋 13/14 站)。
  { id: 'trtc', label: '臺北捷運', geo: 'data/trtc.json', precision: 'sec', crowd: true,
    fl: ['data/tdx/TRTC_FirstLastTimetable.json', 'data/tdx/NTMC_FirstLastTimetable.json'] },
  { id: 'krtc', label: '高雄捷運', geo: 'data/krtc.json', precision: 'min', crowd: false,
    fl: ['data/tdx/KRTC_FirstLastTimetable.json', 'data/tdx/KLRT_FirstLastTimetable.json'] },
  { id: 'tymc', label: '桃園機場捷運', geo: 'data/tymc.json', precision: 'min', crowd: false,
    fl: ['data/tdx/TYMC_FirstLastTimetable.json'] },
];

const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// 🔴 別名規則:先直接比對,不中才去尾綴「站」。無條件去尾會弄丟「台北車站」與「岡山車站」。
function canonical(liveName, known) {
  if (known.has(liveName)) return liveName;
  const stripped = liveName.replace(/站$/, '');
  if (known.has(stripped)) return stripped;
  return null;
}

const out = { version: 1, builtAt: new Date().toISOString(), systems: [], alias: {}, lastTrain: {}, dropped: {} };

for (const s of SYS) {
  const geo = read(s.geo);
  const known = new Set(geo.lines.flatMap(l => l.stations.map(st => st.name)));
  const destsOf = new Map();   // 站名 → Set(終點名)
  const alias = {};
  let dropped = [];

  for (const path of s.fl) {
    for (const r of read(path)) {
      const rawSt = r.StationName?.Zh_tw, rawDest = r.DestinationStationName?.Zh_tw;
      if (!rawSt || !rawDest) continue;
      const st = canonical(rawSt, known), dest = canonical(rawDest, known);
      if (!st || !dest) { dropped.push(rawSt + '→' + rawDest); continue; }
      alias[rawSt] = st; alias[rawDest] = dest;
      if (!destsOf.has(st)) destsOf.set(st, new Set());
      destsOf.get(st).add(dest);
      if (r.LastTrainTime) out.lastTrain[`${s.id}|${st}|${dest}`] = r.LastTrainTime;
    }
  }
  // 即時回應用的是帶「站」的名字,而首末班表不一定兩種都出現過 ⇒ 兩種寫法都補進別名表。
  for (const n of known) { alias[n] = n; alias[n + '站'] = n; }

  // 🔴 配不上的列數要寫進產物,不能只印 console——驗收才 gate 得到它(否則分母會無聲縮水)。
  out.dropped[s.id] = dropped.length;
  out.alias[s.id] = alias;
  out.systems.push({
    id: s.id, label: s.label, precision: s.precision, crowd: s.crowd,
    lines: geo.lines.map(l => ({
      id: l.id, name: l.name, color: l.color,
      stations: l.stations.map(st => ({ name: st.name, dests: [...(destsOf.get(st.name) || [])].sort() })),
    })),
  });
  console.log(`${s.id}: ${known.size} 站, 別名 ${Object.keys(alias).length} 筆, 末班 ` +
    `${Object.keys(out.lastTrain).filter(k => k.startsWith(s.id + '|')).length} 筆` +
    (dropped.length ? `, 🔴 對不上的首末班列 ${dropped.length} 筆: ${dropped.slice(0, 3)}` : ''));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`寫出 ${OUT}`);
