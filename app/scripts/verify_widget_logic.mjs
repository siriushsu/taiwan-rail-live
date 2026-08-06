#!/usr/bin/env node
// 驗共站偵測與方向篩選——把真正會被編譯進 App 的那幾個宣告抽出來實跑，不是重寫一份來對答案。
//
// 抽取（而非複製）的理由同 render_place_widget.mjs：判準若與實作各留一份，
// 就會出現「測試綠、產品壞」或反過來。抽不到就直接失敗。
//
// 用法：node app/scripts/verify_widget_logic.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const widgetDir = join(repoRoot, 'app/ios/App/RailBoardWidget');
const writerPath = join(repoRoot, 'app/ios/App/App/RailBoardScheduleWriter.swift');
const work = resolve(process.argv[2] ?? join(repoRoot, 'tmp/widget-logic-verify'));

function extractDeclaration(source, header, label = header) {
  const found = source.indexOf(header);
  if (found < 0) throw new Error(`抽不到宣告：${label}（原始碼是不是改名了？）`);
  const open = source.indexOf('{', found);
  if (open < 0) throw new Error(`找不到 ${label} 的左大括號`);
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inString) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(found, i + 1);
    }
  }
  throw new Error(`${label} 的大括號沒有配對成功`);
}

const writerSource = readFileSync(writerPath, 'utf8');
const dataSource = readFileSync(join(widgetDir, 'RailBoardData.swift'), 'utf8');
const intentSource = readFileSync(join(widgetDir, 'AppIntent.swift'), 'utf8');
const fallbackBuilderPath = join(here, 'build_widget_station_fallback.mjs');

// 2026-08-06 真機回報：App 更新後共享班表尚未建立時，起站／目的站 provider 把讀檔錯誤
// 丟回 AppIntents，iOS 會關掉整張 Widget 設定頁；第二輪真機又抓到依賴值短暫為 nil、或
// 起站鍵暫時解析成空陣列時，目的站回 .empty 也會讓選單「載入一下就收起」。兩列都必須能
// 改讀 bundle 內建站表；目的站在共享資料正常時仍保留「只列直達站」的起站連動。
const destinationProvider = extractDeclaration(
  intentSource,
  'struct DestinationOptionsProvider: DynamicOptionsProvider',
  'DestinationOptionsProvider',
);
if (!destinationProvider.includes('RailBoardStore.shared.configurationStationOptions()')) {
  throw new Error('目的站 provider 讀不到共享班表時必須退回內建車站清單');
}
if (!destinationProvider.includes('@IntentParameterDependency<ConfigurationAppIntent>(\\.$origin)')) {
  throw new Error('目的站 provider 應保留依起站只列直達站的既有行為');
}
if (!destinationProvider.includes('destinationOptions(from: origin)')
    || !destinationProvider.includes('catch {')) {
  throw new Error('目的站 provider 必須在直達站讀取失敗時接住錯誤並降級');
}
if (/guard\s+let\s+origin\s*=\s*intent\?\.origin\s+else\s*\{\s*return\s+\.empty/s.test(destinationProvider)) {
  throw new Error('目的站 provider 不可在起站依賴值短暫為 nil 時回 .empty');
}
if (!destinationProvider.includes('if direct.isEmpty {')
    || !destinationProvider.includes('if let origin = intent?.origin {')) {
  throw new Error('目的站 provider 必須接住 nil dependency 與空直達站陣列，兩者都降級成完整站表');
}
console.log('【目的站選單契約】✅ 正常只列直達站；依賴值 nil、空陣列或讀檔錯誤皆降級成完整站表');

const originProvider = extractDeclaration(
  intentSource,
  'struct OriginOptionsProvider: DynamicOptionsProvider',
  'OriginOptionsProvider',
);
for (const [label, provider] of [
  ['起站', originProvider],
  ['目的站', destinationProvider],
]) {
  if (!provider.includes('configurationStationOptions()')) {
    throw new Error(`${label} provider 必須使用不丟錯的設定專用車站目錄`);
  }
}
console.log('【起訖站容錯契約】✅ 共享班表準備中也不會把讀檔錯誤丟回 AppIntents');
execFileSync(process.execPath, [fallbackBuilderPath, '--check'], { stdio: 'inherit' });

const pieces = [
  extractDeclaration(writerSource, 'struct Station: Decodable, Hashable'),
  extractDeclaration(writerSource, 'struct PlaceInput: Decodable'),
  extractDeclaration(writerSource, 'enum CompositeStationFinder'),
  extractDeclaration(writerSource, 'struct ExistingMeta: Decodable'),
  extractDeclaration(dataSource, 'struct PlaceBoardDocument: Decodable'),
  extractDeclaration(dataSource, 'struct PlaceBoardLineRecord: Decodable'),
  extractDeclaration(dataSource, 'struct PlaceBoardPassRecord: Decodable'),
  extractDeclaration(dataSource, 'struct FilterOption: Hashable'),
  extractDeclaration(dataSource, 'enum BoardFilter: Hashable'),
  extractDeclaration(dataSource, 'struct BoardFilterSet'),
  // RailBoardEngine 的方法，抽出來當自由函式跑：它只讀參數，不碰 self.store。
  extractDeclaration(dataSource, '    func directionOptions(', 'directionOptions'),
];

// BoardFilterSet.matches(_:) 吃 JourneyTemplate；這裡只驗地點看板那條路徑，給個最小型別讓它編得過。
const stubs = `
struct JourneyTemplate {
    let trainNumber: String
    let trainType: String
}
`;

// 真站點座標：與 App 端 builder.coordinates 的來源同一份（網站的線形檔）。
const stationCoordinates = [];
for (const [file, sys] of [['data/tra.json', 'tra'], ['data/thsr_track.json', 'thsr']]) {
  const doc = JSON.parse(readFileSync(join(repoRoot, file), 'utf8'));
  const seen = new Set();
  for (const line of doc.lines) {
    for (const station of line.stations ?? []) {
      if (seen.has(station.name)) continue;
      seen.add(station.name);
      stationCoordinates.push({ n: station.name, s: sys, lat: station.lat, lon: station.lon });
    }
  }
}

mkdirSync(work, { recursive: true });
writeFileSync(
  join(work, 'stations.json'),
  JSON.stringify(stationCoordinates)
);

const harness = `
import Foundation

${stubs}

${pieces.join('\n\n')}

struct StationCoordinate: Decodable {
    let n: String
    let s: String
    let lat: Double
    let lon: Double
}

var failures: [String] = []
var checks = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    checks += 1
    if condition {
        print("  ✅ \\(name)")
    } else {
        let extra = detail()
        print("  ❌ \\(name)\\(extra.isEmpty ? "" : " — " + extra)")
        failures.append(name)
    }
}

let work = CommandLine.arguments[1]
let coordinateData = try Data(
    contentsOf: URL(fileURLWithPath: work + "/stations.json")
)
let coordinateRecords = try JSONDecoder().decode(
    [StationCoordinate].self,
    from: coordinateData
)
var coordinates: [Station: (lat: Double, lon: Double)] = [:]
for record in coordinateRecords {
    coordinates[Station(n: record.n, s: record.s)] = (record.lat, record.lon)
}

print("【共站偵測】\\(coordinateRecords.count) 個站進去")
let composites = CompositeStationFinder.find(
    coordinates: coordinates,
    systemOrder: ["tra", "thsr"],
    systemLabels: ["tra": "台鐵", "thsr": "高鐵"]
)
for entry in composites {
    print("     \\(entry.place.label)  [\\(entry.subtitle)]")
}
// 實測基準：12 個高鐵站有 8 個與台鐵站相距 24–346 公尺，第 9 名是高鐵彰化→社頭 2451 公尺。
check("共站恰好 8 組", composites.count == 8, "實際 \\(composites.count)")
let labels = Set(composites.map(\\.place.label))
for expected in ["南港", "臺北", "板橋", "六家・新竹", "豐富・苗栗", "新烏日・台中", "沙崙・台南", "新左營・左營"] {
    check("有「\\(expected)」", labels.contains(expected))
}
check(
    "臺北沒有被寫成「臺北・台北」（臺／台 視為同名）",
    !labels.contains("臺北・台北")
)
check(
    "副標都標明兩個系統",
    composites.allSatisfy { $0.subtitle.contains("台鐵") && $0.subtitle.contains("高鐵") }
)
// 座標取群組平均，必須仍落在原本兩站之間（不會被拉到別的地方）。
check(
    "共站座標都在台灣本島範圍內",
    composites.allSatisfy {
        $0.place.lat > 21.8 && $0.place.lat < 25.4
            && $0.place.lon > 119.9 && $0.place.lon < 122.1
    }
)

print("")
print("【方向鍵的往返】")
let sampleKey = BoardFilter.direction(line: "縱貫線北段", forward: true).key
check("鍵格式", sampleKey == "dir|縱貫線北段|1", sampleKey)
check(
    "解回來是同一個",
    BoardFilter(key: sampleKey) == .direction(line: "縱貫線北段", forward: true)
)
check(
    "逆向也對",
    BoardFilter(key: "dir|THSR|0") == .direction(line: "THSR", forward: false)
)
check("車種鍵沒被方向搶走", BoardFilter(key: "ty|莒光/復興") == .trainType("莒光/復興"))
check("認不得的前綴回 nil", BoardFilter(key: "zz|1") == nil)

print("")
print("【篩選語意：車種／車次 OR、方向 AND】")
let southbound = BoardFilter.direction(line: "THSR", forward: true).key
let northbound = BoardFilter.direction(line: "THSR", forward: false).key

let noFilter = BoardFilterSet(keys: nil)
check("全空＝不篩", noFilter.isEmpty)
check(
    "全空時任何車都過",
    noFilter.matches(trainType: "高鐵", trainNumber: "0567", lineID: "THSR", direction: true)
)

let dirOnly = BoardFilterSet(keys: [southbound])
check("只勾方向：順里程過", dirOnly.matches(trainType: "高鐵", trainNumber: "0567", lineID: "THSR", direction: true))
check("只勾方向：逆里程擋", !dirOnly.matches(trainType: "高鐵", trainNumber: "0862", lineID: "THSR", direction: false))
check(
    "只勾高鐵方向，不影響台鐵那條線",
    dirOnly.matches(trainType: "區間車", trainNumber: "1282", lineID: "縱貫線北段", direction: false)
)
check(
    "看板檔沒有 dir 欄（舊版 App 寫的）一律放行",
    dirOnly.matches(trainType: "高鐵", trainNumber: "0862", lineID: "THSR", direction: nil)
)

let dirAndType = BoardFilterSet(keys: [southbound, "ty|高鐵"])
check(
    "方向＋車種：兩者都符合才過",
    dirAndType.matches(trainType: "高鐵", trainNumber: "0567", lineID: "THSR", direction: true)
)
check(
    "方向＋車種：方向不符就擋（AND，不是 OR）",
    !dirAndType.matches(trainType: "高鐵", trainNumber: "0862", lineID: "THSR", direction: false)
)

let typeOrNumber = BoardFilterSet(keys: ["ty|自強", "no|1282"])
check("車種與車次之間仍是 OR（車種命中）", typeOrNumber.matches(trainType: "自強", trainNumber: "999", lineID: "縱貫線北段", direction: true))
check("車種與車次之間仍是 OR（車次命中）", typeOrNumber.matches(trainType: "區間車", trainNumber: "1282", lineID: "縱貫線北段", direction: true))
check("兩者都不中就擋", !typeOrNumber.matches(trainType: "區間車", trainNumber: "9999", lineID: "縱貫線北段", direction: true))

let bothDirections = BoardFilterSet(keys: [southbound, northbound])
check(
    "兩個方向都勾＝等於沒篩",
    bothDirections.matches(trainType: "高鐵", trainNumber: "0862", lineID: "THSR", direction: false)
        && bothDirections.matches(trainType: "高鐵", trainNumber: "0567", lineID: "THSR", direction: true)
)

print("")
print("【方向選項的標題】")
func pass(_ no: String, _ to: String, _ dir: Int?) -> PlaceBoardPassRecord {
    let json = dir.map {
        "{\\"no\\":\\"\\(no)\\",\\"ty\\":\\"高鐵\\",\\"to\\":\\"\\(to)\\",\\"at\\":100,\\"days\\":16383,\\"sys\\":\\"thsr\\",\\"dir\\":\\($0)}"
    } ?? "{\\"no\\":\\"\\(no)\\",\\"ty\\":\\"高鐵\\",\\"to\\":\\"\\(to)\\",\\"at\\":100,\\"days\\":16383,\\"sys\\":\\"thsr\\"}"
    return try! JSONDecoder().decode(
        PlaceBoardPassRecord.self,
        from: Data(json.utf8)
    )
}
func line(_ id: String, _ name: String, _ passes: [PlaceBoardPassRecord]) -> PlaceBoardLineRecord {
    let encoded = passes.map {
        "{\\"no\\":\\"\\($0.no)\\",\\"ty\\":\\"\\($0.ty)\\",\\"to\\":\\"\\($0.to)\\",\\"at\\":\\($0.at),\\"days\\":\\($0.days),\\"sys\\":\\"\\($0.sys)\\"" + ($0.dir.map { ",\\"dir\\":\\($0)}" } ?? "}")
    }.joined(separator: ",")
    let json = "{\\"id\\":\\"\\(id)\\",\\"sys\\":\\"thsr\\",\\"name\\":\\"\\(name)\\",\\"color\\":\\"#E85D0D\\",\\"d\\":0,\\"perp\\":100,\\"pass\\":[\\(encoded)]}"
    return try! JSONDecoder().decode(PlaceBoardLineRecord.self, from: Data(json.utf8))
}

// 實資料的形狀：高鐵順里程 554 段全往左營、36 段往台中；逆里程 578 段往南港、7 段往台北。
// 所以「往台中」在兩個方向都出現過——標題必須挑各方向的多數，不能拿終點站當方向。
let thsrLine = line("THSR", "高鐵", [
    pass("0567", "左營", 1), pass("0569", "左營", 1), pass("0571", "台中", 1),
    pass("0862", "南港", 0), pass("0864", "南港", 0), pass("0866", "台中", 0),
])
let document = PlaceBoardDocument(v: 1, i: 0, label: "家", lat: 24.8, lon: 121.0, lines: [thsrLine])
let options = directionOptions(placeBoard: document)
for option in options { print("     \\(option.title)  [\\(option.subtitle ?? "")]  key=\\(option.key)") }
check("兩個方向各一個選項", options.count == 2, "實際 \\(options.count)")
check("順里程標成往左營", options.contains { $0.title == "往 左營 方向" && $0.key == "dir|THSR|1" })
check("逆里程標成往南港", options.contains { $0.title == "往 南港 方向" && $0.key == "dir|THSR|0" })
check(
    "「往台中」兩個方向都有，沒有被拿來當方向名",
    !options.contains { $0.title.contains("台中") }
)

let oneWay = line("PINGXI", "平溪線", [pass("1", "菁桐", 1), pass("3", "菁桐", 1)])
check(
    "只有單一方向的線不給選項（勾了等於沒勾）",
    directionOptions(
        placeBoard: PlaceBoardDocument(v: 1, i: 1, label: "x", lat: 25, lon: 121.7, lines: [oneWay])
    ).isEmpty
)
let legacy = line("THSR", "高鐵", [pass("0567", "左營", nil), pass("0862", "南港", nil)])
check(
    "舊看板（沒有 dir）不給方向選項，不會列出假的方向",
    directionOptions(
        placeBoard: PlaceBoardDocument(v: 1, i: 2, label: "x", lat: 24.8, lon: 121, lines: [legacy])
    ).isEmpty
)

print("")
print("【重算閘門：改了看板格式一定要重算】")
// 這一段對應 RailBoardScheduleWriter.shouldRebuild：舊 meta 沒有 boardFormat 欄位，
// 解出來必須是 nil（≠ 目前的版本號）才會觸發重算；否則改了格式的那一版會靜默沿用舊看板檔。
let legacyMeta = try JSONDecoder().decode(
    ExistingMeta.self,
    from: Data(#"{"v":1,"builtAt":"x","appBuild":"v0730h+15","placesFingerprint":"abc"}"#.utf8)
)
check("舊 meta（沒有 boardFormat）解成 nil", legacyMeta.boardFormat == nil)
check("舊 meta 仍讀得到 appBuild", legacyMeta.appBuild == "v0730h+15")
let currentMeta = try JSONDecoder().decode(
    ExistingMeta.self,
    from: Data(#"{"v":1,"builtAt":"x","appBuild":"v0730h+16","boardFormat":2,"placesFingerprint":"abc"}"#.utf8)
)
check("新 meta 讀得到 boardFormat", currentMeta.boardFormat == 2)
// 寫出的 meta 一定要帶這個欄位，否則閘門永遠看到 nil、每次都重算（另一種壞法）。
let writerText = try String(
    contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]),
    encoding: .utf8
)
// 只比對不含反斜線的片段：這份 harness 是從 JS 樣板字串生出來的，
// 反斜線會先被 JS 吃掉一層，寫成 Swift 跳脫反而對不上（第一版就是這樣紅的）。
check(
    "meta.json 的產生器有寫出 boardFormat 欄位",
    writerText.contains(#""boardFormat":"#)
)
check(
    "meta 產生器有收 boardFormat 參數",
    writerText.contains("boardFormat: boardFormatVersion")
)
check(
    "shouldRebuild 有比對 boardFormat",
    writerText.contains("meta.boardFormat != boardFormatVersion")
)

print("")
if failures.isEmpty {
    print("全部通過（\\(checks) 項）")
} else {
    print("失敗 \\(failures.count)／\\(checks)：\\(failures.joined(separator: "、"))")
    exit(1)
}
`;

const swiftPath = join(work, 'harness.swift');
writeFileSync(swiftPath, harness);
execFileSync('swiftc', ['-O', swiftPath, '-o', join(work, 'harness')], { stdio: 'inherit' });
execFileSync(join(work, 'harness'), [work, writerPath], { stdio: 'inherit' });
