#!/usr/bin/env node
// 驗收「自動選站的最近站計算＋服務範圍門檻」——差分測試:
//   受測物 = 真的會出貨的 Swift(MetroWidgetCatalog + MetroNearestMath,大括號抽取後裸編譯,
//            與 render_metro_widget.mjs 同一套抽取,抽不到直接失敗不留退路)
//   判準   = 本檔用【獨立實作】的 haversine 對同一份目錄自己掃一遍(不同語言、不同程式碼路徑,
//            只共享「大圓距離」的數學定義)——兩邊對不上就是有一邊寫錯了(心得 29:判準不與實作同源)。
//
// 探針點是固定字面值(不用亂數):三個系統各一個「站點自身座標」的恆等探針、
// 一個 ~280m 偏移探針(鄰站距離餘裕 ≫ 浮點雜訊,不會踩到近平手翻面)、
// 一個只斷言系統歸屬的跨系統探針(高雄市區必須解析到 krtc,證明掃描沒有被第一個系統遮蔽)。
//
// 🔴 服務範圍門檻(2026-08-18)的判準設計:
//   (a) 邊界【兩側】對照是唯一有牙的部分——除了「離最近站多遠」這一個變因之外,兩顆探針
//       的其餘輸入逐格相同(同一個方位角、同一顆最近站)。少了任何一側,「乾脆全部放行」
//       或「乾脆全部擋掉」都能全綠。
//   (b) 邊界探針的座標【由 Swift 原始碼裡的半徑推導】,不是手打的公里數:半徑改成 15km 時
//       探針自己跟著走,判準不會退化成綁在舊常數上的魔術數字(心得 35)。
//   (c) 半徑常數要驗「編出來的值 === 原始碼字面值」——否則有人加了新常數卻沒接上,
//       解析得到、實際沒用到,判準照樣全綠。
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const dataPath = join(widgetDir, 'MetroWidgetData.json');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ---- 大括號抽取(與 render_metro_widget.mjs 完全同一份實作) ----
function extractDeclaration(source, header, { occurrence = 1 } = {}) {
  let searchFrom = 0;
  let found = -1;
  for (let i = 0; i < occurrence; i += 1) {
    found = source.indexOf(header, searchFrom);
    if (found < 0) break;
    searchFrom = found + header.length;
  }
  if (found < 0) throw new Error(`抽不到宣告：${header}（原始碼是不是改名了？）`);
  const open = source.indexOf('{', found);
  if (open < 0) throw new Error(`找不到 ${header} 的左大括號`);
  let depth = 0, inString = false, inLineComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inString) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(found, i + 1); }
  }
  throw new Error(`${header} 的大括號沒有配對成功`);
}

// ---- JS 側獨立實作(判準) ----
const D = JSON.parse(readFileSync(dataPath, 'utf8'));
const nearestSource = readFileSync(join(widgetDir, 'MetroNearest.swift'), 'utf8');

// 半徑從【產物】取,不再 regex 抽 Swift 字面值。
//
// 🔴 2026-09-11 改法與理由:這支腳本原本是
//      const radiusLiteral = /static let serviceRadiusMeters\s*=\s*([0-9_.]+)/.exec(nearestSource)
//    ——判準與被測物同源(兩邊都是那一行 Swift),所以 C0「編出來的 === 原始碼字面值」其實只驗到
//    「我的 regex 抄對了」,而且【只守得住 iOS】。同一個數字當時在三個地方各寫一份:
//    MetroNearest.swift 12000、RailBoardData.swift 5000、RailWidgetData.java 5000,再加公車就是第四份,
//    各自漂移時沒有任何一支腳本會紅。現在唯一來源是 build_metro_widget_data.mjs 產生的
//    MetroWidgetData.json.serviceRadii,兩端都從那裡讀。
//
// 🔴 EXPECT_RADII 是【刻意的第四份】,與資料檔、iOS、Android 都不同源——只改資料檔而沒改這裡,
//    D1 會紅(Android 那支 verify_widget_nearest.mjs 有一份一樣的表,所以兩端【同時】紅;
//    只有 iOS 紅就代表 Android 沒真的接上)。判準與實作同源時「相等」是零資訊。
//    這兩個值是對站點密度實算出來的天然斷點,不該被順手改掉;要改就兩邊一起改,
//    而那一刻你會被迫看到這段註解。
const EXPECT_RADII = { metro: 12000, rail: 5000 };
const RADII = D.serviceRadii;
const RADIUS = RADII?.metro;

function jsHaversine(lat1, lon1, lat2, lon2) {
  const r = 6371000, toRad = x => x * Math.PI / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function jsNearest(lat, lon) {
  let best = null, bestD = Infinity;
  for (const s of D.systems) {
    const seen = new Set();
    for (const l of s.lines) for (const st of l.stations) {
      if (seen.has(st.name)) continue;   // 與 Swift 的 stationNames 去重語意一致
      seen.add(st.name);
      if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
      const d = jsHaversine(lat, lon, st.lat, st.lon);
      if (d < bestD) { bestD = d; best = `${s.id}|${st.name}`; }
    }
  }
  return { key: best, meters: bestD };
}
// 判準側的分類:獨立算距離、獨立比半徑。Swift 的 classify() 要與這一支逐顆一致。
const jsClassify = (lat, lon) => {
  const n = jsNearest(lat, lon);
  return { kind: n.meters <= RADIUS ? 'serviceable' : 'outOfRange', ...n };
};
const coordOf = (sys, name) => {
  for (const s of D.systems) if (s.id === sys)
    for (const l of s.lines) for (const st of l.stations) if (st.name === name) return st;
  throw new Error(`目錄裡找不到 ${sys}|${name}`);
};

// ---- 探針點 ----
const zoo = coordOf('trtc', '動物園');
const tpe = coordOf('trtc', '台北車站');
const hamasen = coordOf('krtc', '哈瑪星');
// 機捷的站名在 geo 檔就自帶「站」尾綴(照抄字面,不是別名層的事)。
const a12 = coordOf('tymc', '機場第二航廈站');

// 邊界對照的錨:岡山車站是高捷紅線北端點,正北方一路到台南都沒有任何捷運站,
// 所以沿著它的經線往北移動時「最近的站」恆為岡山車站——兩顆探針只有距離這一個變因。
// (這個前提本身由 B0/B1 現場斷言,站點增修讓它不成立時測試會直說,不會靜默漂掉。)
const gangshan = coordOf('krtc', '岡山車站');
const degPerMeterLat = 180 / (Math.PI * 6371000);
const boundaryProbe = (offsetMeters) => ({
  lat: gangshan.lat + (RADIUS + offsetMeters) * degPerMeterLat,
  lon: gangshan.lon,
});

const probes = [
  { name: '恆等-北捷動物園', lat: zoo.lat, lon: zoo.lon, expectKey: 'trtc|動物園' },
  { name: '恆等-高捷哈瑪星', lat: hamasen.lat, lon: hamasen.lon, expectKey: 'krtc|哈瑪星' },
  { name: '恆等-機捷二航廈', lat: a12.lat, lon: a12.lon, expectKey: 'tymc|機場第二航廈站' },
  // 偏移探針的期望值不寫死,由 JS 獨立實作現場算——這才是差分的本體。
  { name: '偏移-台北車站東北280m', lat: tpe.lat + 0.002, lon: tpe.lon + 0.002 },
  { name: '跨系統-高雄市區歸krtc', lat: 22.63, lon: 120.30, sysOnly: 'krtc' },
  // ---- 服務範圍:邊界兩側(除了距離之外逐格相同) ----
  { name: `邊界內-岡山正北${(RADIUS - 100) / 1000}km`, ...boundaryProbe(-100),
    expectKind: 'serviceable', boundary: 'in' },
  { name: `邊界外-岡山正北${(RADIUS + 100) / 1000}km`, ...boundaryProbe(+100),
    expectKind: 'outOfRange', boundary: 'out' },
  // ---- 服務範圍:實際會發生的遠距情境(使用者 2026-08-18 回報的那一類) ----
  { name: '範圍外-台中車站', lat: 24.1369, lon: 120.6851, expectKind: 'outOfRange' },
  { name: '範圍外-花蓮車站', lat: 23.9930, lon: 121.6010, expectKind: 'outOfRange' },
  { name: '範圍外-台南車站', lat: 22.9971, lon: 120.2129, expectKind: 'outOfRange' },
  { name: '範圍外-基隆車站', lat: 25.1319, lon: 121.7398, expectKind: 'outOfRange' },
  // ---- 服務範圍:邊界內側但不是市中心的真實案例(擋錯這些人的代價最高) ----
  { name: '範圍內-三峽老街', lat: 24.9345, lon: 121.3690, expectKind: 'serviceable' },
  { name: '範圍內-桃園車站', lat: 24.9892, lon: 121.3139, expectKind: 'serviceable' },
];

// ---- 組 Swift harness、編譯、執行 ----
// 🔴 MetroWidgetCatalog 2026-08-22 搬到 App/MetroWidgetShared.swift(App target 也要用它:
//    等車卡從小工具背景開卡時,perform() 在 App 行程裡跑)。
const sharedSource = readFileSync(join(widgetDir, '..', 'App', 'MetroWidgetShared.swift'), 'utf8');
const harness = `
import Foundation
${extractDeclaration(sharedSource, 'enum WidgetServiceRadius')}
${extractDeclaration(sharedSource, 'struct MetroWidgetCatalog')}
${extractDeclaration(nearestSource, 'enum MetroNearestMath')}
let probesPath = CommandLine.arguments[1]
let raw = try! Data(contentsOf: URL(fileURLWithPath: probesPath))
let probes = try! JSONSerialization.jsonObject(with: raw) as! [[Double]]
let catalog = MetroWidgetCatalog.shared
// 前兩行印【編出來的】半徑。第一行走 MetroNearestMath(捷運小工具真的用的那條路),
// 第二行直接問共用層要台鐵的值——台鐵那一端在 RailBoardData(相依太多,裸編不起來),
// 但真正要證明的是「iOS 這一側從產物讀得到 rail 的值」,那一段就是這裡這個 enum。
print(MetroNearestMath.serviceRadiusMeters)
print(WidgetServiceRadius.meters(WidgetServiceRadius.rail))
for p in probes {
    // 距離一律另外由 nearest() 取,分類則走 classify()——兩支各自輸出,
    // 「算得對」與「判得對」才不會靠同一個回傳值互相掩護。
    let raw = MetroNearestMath.nearest(catalog: catalog, lat: p[0], lon: p[1])
    switch MetroNearestMath.classify(catalog: catalog, lat: p[0], lon: p[1]) {
    case .serviceable(let sys, let station):
        print("serviceable|\\(sys)|\\(station)|\\(raw!.meters)")
    case .outOfRange(let station, let meters):
        // 第五欄是卡面那句話,讓 JS 驗「距離無條件進位」這個決定(四捨五入會印出門檻值本身)。
        print("outOfRange|\\(raw!.sys)|\\(station)|\\(meters)|"
              + MetroNearestMath.outOfRangeHint(station: station, meters: meters))
    case .none:
        print("nil|||")
    }
}
`;

const work = mkdtempSync(join(tmpdir(), 'metro-nearest-'));
writeFileSync(join(work, 'harness.swift'), harness);
// Bundle.main 對裸執行檔=執行檔所在目錄,目錄檔放旁邊就找得到(render harness 已證實)。
copyFileSync(dataPath, join(work, 'MetroWidgetData.json'));
writeFileSync(join(work, 'probes.json'), JSON.stringify(probes.map(p => [p.lat, p.lon])));
execFileSync('xcrun', ['swiftc', '-O', join(work, 'harness.swift'), '-o', join(work, 'harness')],
             { stdio: ['ignore', 'inherit', 'inherit'] });
const lines = execFileSync(join(work, 'harness'), [join(work, 'probes.json')], { encoding: 'utf8' })
  .trim().split('\n');

const swiftRadius = Number(lines[0]);
const swiftRailRadius = Number(lines[1]);
const out = lines.slice(2);

console.log(`  （服務範圍半徑 metro=${RADII?.metro} rail=${RADII?.rail} 公尺，探針 ${probes.length} 顆）`);
ok('D0 產物有 serviceRadii(metro/rail 都在)',
   !!RADII && typeof RADII.metro === 'number' && typeof RADII.rail === 'number',
   JSON.stringify(RADII));
for (const [modality, expect] of Object.entries(EXPECT_RADII)) {
  ok(`D1 資料檔 serviceRadii.${modality} === 判準表 ${expect}`,
     RADII?.[modality] === expect, `資料檔=${RADII?.[modality]}`);
}
// 公車的值屬設計書單元 C(要對站牌密度實算)。實算之前資料檔裡不准有 bus——有了兩端就會讀去用。
ok('D2 公車半徑尚未填入(單元 C 實算前不准猜一個)',
   RADII?.bus === undefined, `bus=${RADII?.bus}`);
ok('C0 iOS 編出來的捷運半徑 === 資料檔的值', swiftRadius === RADIUS,
   `swift=${swiftRadius} 資料檔=${RADIUS}`);
ok('C0b iOS 編出來的台鐵半徑 === 資料檔的值(「我的地點」那條路也接上了)',
   swiftRailRadius === RADII?.rail, `swift=${swiftRailRadius} 資料檔=${RADII?.rail}`);
// 反向對照:上面兩條在「iOS 又把數字寫死回原始碼」時仍會全綠(寫死的值剛好等於資料檔),
// 所以另外斷言原始碼裡沒有字面值。註解不算——記病史的註解不是病灶。
const stripSwift = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const placesSource = stripSwift(readFileSync(join(widgetDir, 'RailBoardData.swift'), 'utf8'));
ok('C0c iOS 捷運半徑沒有被寫死回原始碼',
   !/static let serviceRadiusMeters\s*=\s*[0-9]/.test(stripSwift(nearestSource))
   && /WidgetServiceRadius\.meters/.test(stripSwift(nearestSource)));
ok('C0d iOS 台鐵「我的地點」半徑沒有被寫死回原始碼',
   !/maximumDistanceMeters\s*=\s*[0-9]/.test(placesSource)
   && /WidgetServiceRadius\.meters/.test(placesSource));
ok('C1 探針數與輸出行數一致', out.length === probes.length, `${out.length} vs ${probes.length}`);
// 探針集合本身要有兩邊:全部同一側的話「一律放行」與「一律擋掉」都能全綠。
const kinds = probes.map(p => jsClassify(p.lat, p.lon).kind);
ok('C2 探針同時覆蓋範圍內與範圍外(各≥2)',
   kinds.filter(k => k === 'serviceable').length >= 2 &&
   kinds.filter(k => k === 'outOfRange').length >= 2,
   `serviceable=${kinds.filter(k => k === 'serviceable').length} outOfRange=${kinds.filter(k => k === 'outOfRange').length}`);
// 邊界對照的前提:兩顆探針的最近站必須是【同一顆】,否則變因不只一個,對照就不成立。
const bIn = probes.find(p => p.boundary === 'in');
const bOut = probes.find(p => p.boundary === 'out');
ok('B0 邊界兩顆探針的最近站是同一顆(對照只差距離這一個變因)',
   jsNearest(bIn.lat, bIn.lon).key === jsNearest(bOut.lat, bOut.lon).key,
   `in=${jsNearest(bIn.lat, bIn.lon).key} out=${jsNearest(bOut.lat, bOut.lon).key}`);
ok('B1 邊界錨站如預期是岡山車站(站點增修讓前提失效時要看得見)',
   jsNearest(bOut.lat, bOut.lon).key === 'krtc|岡山車站',
   jsNearest(bOut.lat, bOut.lon).key);

let compared = 0;
probes.forEach((p, i) => {
  const [kind, sys, station, meters, hint] = (out[i] ?? '').split('|');
  const got = `${sys}|${station}`;
  const judge = jsClassify(p.lat, p.lon);
  compared += 1;

  // 1) 最近站是誰:期望值只有恆等探針寫死,其餘一律由 JS 判準現場算。
  ok(`H${i + 1} ${p.name}｜最近站`, got === (p.expectKey ?? judge.key),
     `swift=${got} 判準=${p.expectKey ?? judge.key}`);
  // 2) 距離數值:兩套獨立實作的 haversine 相對誤差要在浮點雜訊內。
  const rel = Math.abs(Number(meters) - judge.meters) / Math.max(judge.meters, 1);
  ok(`H${i + 1} ${p.name}｜距離`, rel < 1e-9,
     `swift=${meters} 判準=${judge.meters} rel=${rel}`);
  // 3) 分類:期望值有寫死就用寫死的(那是這顆探針存在的理由),否則對 JS 判準。
  ok(`H${i + 1} ${p.name}｜範圍判定`, kind === (p.expectKind ?? judge.kind),
     `swift=${kind} 判準=${p.expectKind ?? judge.kind} meters=${meters}`);
  if (p.sysOnly) {
    ok(`H${i + 1} ${p.name}｜系統歸屬`, sys === p.sysOnly, `got=${sys}`);
  }
  // 4) 範圍外的卡面文案:必須點名最近站,而且公里數【嚴格大於半徑】——
  //    四捨五入會讓 12.1km 印成「約 12 公里」,而 12 正是門檻值,使用者看了會覺得
  //    自己明明在範圍內卻被擋。判準從半徑推導,不是寫死 13(心得 35:數字要能推導)。
  if (kind === 'outOfRange') {
    const km = Number(/約 (\d+) 公里/.exec(hint ?? '')?.[1]);
    ok(`H${i + 1} ${p.name}｜文案點名最近站`, (hint ?? '').includes(station), `hint=${hint}`);
    ok(`H${i + 1} ${p.name}｜公里數進位後 > 門檻`, Number.isFinite(km) && km > RADIUS / 1000,
       `hint=${hint} 門檻=${RADIUS / 1000}km 實際=${Number(meters) / 1000}km`);
  }
});
// 覆蓋率要有具名斷言:只把 N/M 印在細節裡等於沒 gate,分母會無聲縮水(心得 37)。
ok('C3 每一顆探針都真的被比對過', compared === probes.length, `${compared}/${probes.length}`);

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
