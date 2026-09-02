#!/usr/bin/env node
// 產生捷運小工具的離線資料檔(站清單／方向／別名表／末班車表),打包進 Widget Extension bundle。
// 🔴 這份檔「不」寫進 App Group、不碰 boardFormatVersion——與發車看板的寫檔管線零交集。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'app/ios/App/RailBoardWidget/MetroWidgetData.json');

// 只收「官方有站牌倒數」的系統。淡海／安坑只有軌道佔用(沒有 rows)、中捷無公開介接,刻意不列。
// 🔴 環狀線【有】站牌倒數,而且已經在 trtc 裡(它是 data/trtc.json 的 Y 線)——2026-08-14 更正:
//    初版寫「環狀線只有軌道佔用」是量錯端點(量了 /api/ntmetro-live?sys=circular)。
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

// 幾何檔的線 id 與 TDX 首末班表的 LineID 不是同一套命名，站號要對得起來就得先翻譯：
//   - 支線與分支在幾何檔是獨立線（R_XBT／O_XINZHUANG／O_LUZHOU），TDX 只有幹線代碼 ⇒ 取 `_` 前段
//   - 高雄的幾何檔用 KR／KO，TDX 用 R／O（同一個系統內不會與北捷撞號，codeOf 是逐系統建的）
// 🔴 對不到的線在下面會印出 `站號 0/N`，新增路線時漏翻譯一眼就看得到（別靜靜地少一批站號）。
const TDX_LINE_ALIAS = { KR: 'R', KO: 'O' };
const tdxLineId = id => TDX_LINE_ALIAS[id] || String(id).split('_')[0];

// 🔴 別名規則:先直接比對,不中才去尾綴「站」。無條件去尾會弄丟「台北車站」與「岡山車站」。
function canonical(liveName, known) {
  if (known.has(liveName)) return liveName;
  const stripped = liveName.replace(/站$/, '');
  if (known.has(stripped)) return stripped;
  return null;
}

const out = { version: 2, builtAt: new Date().toISOString(), systems: [], alias: {},
               lastTrain: {}, firstTrain: {}, ambiguousFirstTrain: {}, dropped: {} };

for (const s of SYS) {
  const geo = read(s.geo);
  const known = new Set(geo.lines.flatMap(l => l.stations.map(st => st.name)));
  const destsOf = new Map();   // 站名 → Set(終點名)
  const codeOf = new Map();    // 線id|站名 → 官方站號（R10／BL12）
  const enOf = new Map();      // 站名 → 官方英文站名
  const firstSeen = new Map(); // 系統|站|終點 → Set(官方首班時刻字面值)
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
      // 站號與英文站名照抄官方字面值。站號綁在【線】上（台北車站在 R 線是 R10、在 BL 線是
      // BL12），所以用線id＋站名當鍵；英文站名與線無關。
      const lineId = r.LineID || r.LineNo;
      if (lineId && r.StationID) codeOf.set(`${lineId}|${st}`, r.StationID);
      if (r.StationName?.En) enOf.set(st, r.StationName.En);
      // 🔴 首班【不】沿用末班那種「後面覆蓋前面」：同一個站＋終點在官方檔裡常有多組值
      //    （不同 TrainType／營運日，實測 KLRT 38/38 鍵、TYMC 16/70 鍵都有多組），
      //    覆蓋等於替使用者挑一個。這裡先全收，收完只有【全部一致】的鍵才寫進產物。
      if (r.FirstTrainTime) {
        const key = `${s.id}|${st}|${dest}`;
        if (!firstSeen.has(key)) firstSeen.set(key, new Set());
        firstSeen.get(key).add(r.FirstTrainTime);
      }
    }
  }
  // 即時回應用的是帶「站」的名字,而首末班表不一定兩種都出現過 ⇒ 兩種寫法都補進別名表。
  for (const n of known) { alias[n] = n; alias[n + '站'] = n; }

  // 首班：一致的才輸出，有分歧的只記數量與樣本（留給使用者裁示，不自己挑）。
  const ambiguous = [];
  for (const [key, times] of firstSeen) {
    if (times.size === 1) out.firstTrain[key] = [...times][0];
    else ambiguous.push(key + ' ⇒ ' + [...times].sort().join(' / '));
  }
  out.ambiguousFirstTrain[s.id] = { count: ambiguous.length, samples: ambiguous.slice(0, 5) };

  // 🔴 配不上的列數要寫進產物,不能只印 console——驗收才 gate 得到它(否則分母會無聲縮水)。
  out.dropped[s.id] = dropped.length;
  out.alias[s.id] = alias;
  out.systems.push({
    id: s.id, label: s.label, precision: s.precision, crowd: s.crowd,
    lines: geo.lines.map(l => ({
      id: l.id, name: l.name, color: l.color,
      // lat/lon 照抄 geo 檔字面值(自動選站的最近站計算用),不重算不取捨。
      stations: l.stations.map(st => {
        const one = { name: st.name, lat: st.lat, lon: st.lon,
                      dests: [...(destsOf.get(st.name) || [])].sort() };
        // 對不到就不給，Android 那邊沒有站號徽章就不畫（不編一個假的）。
        const code = codeOf.get(`${tdxLineId(l.id)}|${st.name}`);
        if (code) one.code = code;
        const en = enOf.get(st.name);
        if (en) one.en = en;
        return one;
      }),
    })),
  });
  const codeHit = geo.lines.reduce((n, l) =>
    n + l.stations.filter(st => codeOf.has(`${tdxLineId(l.id)}|${st.name}`)).length, 0);
  const codeMissLines = geo.lines
    .filter(l => l.stations.every(st => !codeOf.has(`${tdxLineId(l.id)}|${st.name}`)))
    .map(l => `${l.id}(${l.name})`);
  const enHit = geo.lines.reduce((n, l) =>
    n + l.stations.filter(st => enOf.has(st.name)).length, 0);
  const total = geo.lines.reduce((n, l) => n + l.stations.length, 0);
  console.log(`${s.id}: ${known.size} 站, 別名 ${Object.keys(alias).length} 筆, 末班 ` +
    `${Object.keys(out.lastTrain).filter(k => k.startsWith(s.id + '|')).length} 筆` +
    `, 站號 ${codeHit}/${total}, 英文站名 ${enHit}/${total}` +
    `, 首班 ${Object.keys(out.firstTrain).filter(k => k.startsWith(s.id + '|')).length} 筆` +
    `（分歧 ${ambiguous.length} 鍵不輸出）` +
    (dropped.length ? `, 🔴 對不上的首末班列 ${dropped.length} 筆: ${dropped.slice(0, 3)}` : '') +
    (codeMissLines.length ? `, 🔴 整條線沒有站號: ${codeMissLines.join('、')}` : ''));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`寫出 ${OUT}`);
