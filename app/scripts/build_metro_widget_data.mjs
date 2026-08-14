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
  { id: 'trtc', label: '臺北捷運', geo: 'data/trtc.json', precision: 'sec', crowd: true,
    fl: ['data/tdx/TRTC_FirstLastTimetable.json'] },
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

const out = { version: 1, builtAt: new Date().toISOString(), systems: [], alias: {}, lastTrain: {} };

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
