#!/usr/bin/env node
// 把「鐵路＋捷運」混合大卡（systemLarge）算繪成 PNG。
//
// 這張卡把另外兩張卡的元件疊在同一條軌脊上，所以它是唯一一支要同時抽【兩邊】宣告的
// harness：捷運那半邊吃真正的凍結樣本過 MetroBoardModel，臺鐵那半邊吃手寫的 BoardSnapshot
// （與 render_board_widget.mjs 同一套車種色與樣本形狀）。
//
// 抽取而不是複製的理由與另外兩支相同：版面常數留兩份就會分岔，而分岔的症狀是
// 「算繪出來的不是出貨的版面」這種不會報錯的假象。抽不到就直接失敗。
//
// 🔴 刻意不抽 MixedBoardEntryView：它的 containerBackground 用了 UIKit 的
//    Color(uiColor: .systemBackground)，裸 macOS 執行檔編不起來。改成算繪它包住的
//    MixedBoardCard，外殼那三行（padding／railRenderingMode／widgetURL）由下方的
//    wrapperGate() 在【原始碼層】驗——不然「production 忘了補內距」這件事 harness
//    量不到（這張卡 contentMarginsDisabled，內距全靠 View 自己）。
//
// 用法：node app/scripts/render_mixed_widget.mjs [輸出目錄]

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const fixtureDir = resolve(here, '../fixtures/metro');
const outDir = resolve(process.argv[2] ?? join(here, '../../tmp/mixed-widget-shots'));

/**
 * 從 Swift 原始碼抽出一個頂層宣告（含其大括號區塊）。
 * 用大括號配對而不是行號——行號會隨任何一次編輯失效，而失效時的症狀是
 * 「算繪出來的是舊版面」這種不會報錯的假象。
 * （與 render_metro_widget.mjs／render_board_widget.mjs 完全同一份實作。）
 */
function extractDeclaration(source, header, { occurrence = 1 } = {}) {
  let searchFrom = 0;
  let found = -1;
  for (let i = 0; i < occurrence; i += 1) {
    found = source.indexOf(header, searchFrom);
    if (found < 0) break;
    searchFrom = found + header.length;
  }
  if (found < 0) {
    throw new Error(`抽不到宣告：${header}（原始碼是不是改名了？）`);
  }
  const open = source.indexOf('{', found);
  if (open < 0) throw new Error(`找不到 ${header} 的左大括號`);

  let depth = 0;
  let inString = false;
  let inLineComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
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
  throw new Error(`${header} 的大括號沒有配對成功`);
}

// 共用元件層與捷運模型層直接交給 swiftc（不抽宣告）：抽取有「抽到舊版」的風險，
// 而這兩層是所有畫面的地基。
const kitPath = join(widgetDir, 'RailWidgetKit.swift');
const modelPath = join(widgetDir, 'MetroBoardModel.swift');
const dataPath = join(widgetDir, 'MetroWidgetData.json');
const boardSource = readFileSync(join(widgetDir, 'RailBoardWidget.swift'), 'utf8');
const dataSource = readFileSync(join(widgetDir, 'RailBoardData.swift'), 'utf8');
const metroSource = readFileSync(join(widgetDir, 'MetroBoardWidget.swift'), 'utf8');
const intentSource = readFileSync(join(widgetDir, 'MetroBoardIntent.swift'), 'utf8');
const mixedSource = readFileSync(join(widgetDir, 'MixedBoardWidget.swift'), 'utf8');

/**
 * 🔴 原始碼層 gate：harness 算繪的是 MixedBoardCard，外殼那幾行是它【看不到】的。
 * 出貨的 MixedBoardEntryView 必須自己補 16pt 內距（這張卡 contentMarginsDisabled），
 * 而且 scale／box 必須從 GeometryReader 的實測尺寸來——否則 harness 全綠而真機破版。
 */
function wrapperGate() {
  const required = [
    ['.padding(RailBoardInsets.content)', '外殼沒有補回 16pt 內容邊距（這張卡 contentMarginsDisabled，內距只能由 View 自己帶）'],
    ['RailScale(width: geo.size.width, reference: RailScale.mediumReference)', 'scale 不是從 GeometryReader 的實測寬度算的（縮放路徑會與 harness 分岔）'],
    ['box: geo.size.height', '高度預算不是從 GeometryReader 的實測高度來的（次列名額會算在假的框上）'],
  ];
  const missing = required.filter(([needle]) => !mixedSource.includes(needle));
  if (missing.length) {
    const lines = missing.map(([needle, why]) => `  ${needle}\n    ⇒ ${why}`).join('\n');
    throw new Error(`外殼 gate 失敗：MixedBoardWidget.swift 少了這些東西：\n${lines}`);
  }
  console.log('gate 通過：出貨外殼自己帶 16pt 內距，且 scale／高度預算都取自實測尺寸');
}

wrapperGate();

const pieces = [
  // 資料與時間
  extractDeclaration(dataSource, 'enum RailBoardClock'),
  extractDeclaration(dataSource, 'enum JourneyRelation'),
  extractDeclaration(dataSource, 'enum ScheduleNotice'),
  extractDeclaration(boardSource, 'extension Color'),
  extractDeclaration(boardSource, 'struct BoardRow'),
  extractDeclaration(boardSource, 'struct BoardSnapshot'),
  extractDeclaration(boardSource, 'struct PlaceBoardRow'),
  extractDeclaration(boardSource, 'struct PlaceLineSnapshot'),
  extractDeclaration(boardSource, 'struct PlaceBoardSnapshot'),
  extractDeclaration(boardSource, 'enum RailBoardEntryContent'),
  extractDeclaration(boardSource, 'struct RailBoardEntry'),
  extractDeclaration(boardSource, 'enum BoardCountdown'),
  // 臺鐵半邊的版面零件
  extractDeclaration(boardSource, 'enum RailBoardInsets'),
  extractDeclaration(boardSource, 'struct BoardNotice'),
  extractDeclaration(boardSource, 'enum BoardPalette'),
  extractDeclaration(boardSource, 'enum PlaceDistance'),
  extractDeclaration(boardSource, 'struct PassBadge'),
  extractDeclaration(boardSource, 'struct BoardRowView'),
  extractDeclaration(boardSource, 'struct PlaceRowView'),
  // 捷運半邊
  extractDeclaration(intentSource, 'struct MetroWidgetCatalog'),
  extractDeclaration(metroSource, 'struct MetroEntry'),
  extractDeclaration(metroSource, 'extension MetroEntry'),
  extractDeclaration(metroSource, 'enum MetroPalette'),
  extractDeclaration(metroSource, 'enum MetroLastTrain'),
  extractDeclaration(metroSource, 'extension MetroWidgetCatalog'),
  extractDeclaration(metroSource, 'enum MetroCountdown'),
  extractDeclaration(metroSource, 'struct MetroRowView'),
  // 混合卡本體
  extractDeclaration(mixedSource, 'struct MixedBoardEntry'),
  extractDeclaration(mixedSource, 'private enum MixedMetrics'),
  extractDeclaration(mixedSource, 'private struct MixedPlan'),
  extractDeclaration(mixedSource, 'private struct MixedBoardCard'),
];

const trtcFixture = join(fixtureDir, 'trtc-live.json');

const harness = `
import AppKit
import Foundation
import SwiftUI
import WidgetKit

// harness 替身：真正的 intent 要 AppIntents 與 App Group（裸執行檔編不起來）。
// 版面【完全不讀】configuration（只讀 rail／metro 兩個 entry）⇒ 空殼不影響算繪結果。
struct ConfigurationAppIntent {}
struct MixedBoardIntent {}

${pieces.join('\n\n')}

// ── 捷運半邊：凍結樣本過真正的 MetroBoardModel ────────────────────────────────

let widgetDataObj = try! JSONSerialization.jsonObject(
    with: Data(contentsOf: URL(fileURLWithPath: "${dataPath}"))
) as! [String: Any]
let aliasTable = widgetDataObj["alias"] as! [String: [String: String]]
let catalog = MetroWidgetCatalog.shared

func minEta(_ path: String) -> Double {
    let obj = try! JSONSerialization.jsonObject(
        with: Data(contentsOf: URL(fileURLWithPath: path))
    ) as! [String: Any]
    let board = obj["board"] as! [[String: Any]]
    return board.map { $0["eta"] as! Double }.min()!
}

// 🔴 把整份快照平移到現在。樣本是 2026-08-14 下午擷取的，直接用會全部被判成過站而畫面空白；
//    平移後每列的【剩餘秒數】與擷取當下逐秒相同（不是手捏 rows），dataAt 保持樣本值。
func shiftedToWallClock(_ s: MetroSnapshot, sampleNow: Double) -> MetroSnapshot {
    let delta = Date().timeIntervalSince1970 - sampleNow
    return MetroSnapshot(station: s.station, dataAt: s.dataAt,
                         rows: s.rows.map { MetroRow(dest: $0.dest,
                                                     etaEpoch: $0.etaEpoch.map { $0 + delta },
                                                     minutes: $0.minutes, crowd: $0.crowd,
                                                     lineCode: $0.lineCode, trainNo: $0.trainNo) },
                         stale: s.stale)
}

let taipeiNow = minEta("${trtcFixture}") - 60
let taipeiRaw = try! MetroBoardModel.trtc(
    json: try! Data(contentsOf: URL(fileURLWithPath: "${trtcFixture}")),
    station: "台北車站", alias: aliasTable["trtc"] ?? [:], now: taipeiNow)
let taipeiSnap = shiftedToWallClock(taipeiRaw, sampleNow: taipeiNow)

// 🔴 sys 一定要帶：逐列線色與線名是 MetroRowView 用 sys＋station 算的，nil 就一顆都不畫。
func metroEntry(station: String, snapshot: MetroSnapshot?, lastTrain: String? = nil,
                passCTA: String? = nil, auto: Bool = false) -> MetroEntry {
    MetroEntry(date: Date(), title: station,
               lineColor: MetroPalette.color(sys: "trtc", station: station),
               snapshot: snapshot, precision: "sec", lastTrain: lastTrain,
               failed: false, auto: auto, passCTA: passCTA, sys: "trtc")
}

let metroTaipei = metroEntry(station: "台北車站", snapshot: taipeiSnap)
let metroWithLast = metroEntry(station: "台北車站", snapshot: taipeiSnap, lastTrain: "00:35")
// 通行證閘門的文案形狀取自 MetroBoardProvider.entry 的 needPassMulti 分支（那裡是真來源，
// 這裡只是視覺驗證）。改版前混合卡把這一行整個丟掉 ⇒ 付費功能被擋住卻不講。
let metroGated = metroEntry(
    station: "再加一站", snapshot: nil,
    passCTA: "免費版可設定一站（目前是「板橋」）。點一下開啟軌島，用通行證解鎖多站。")

// ── 臺鐵半邊：手寫樣本（車種色與樣本形狀與 render_board_widget.mjs 一致）────────

let sampleTypeColors: [String: String] = [
    "區間快": "#16A085",
    "區間車": "#2E6FB0",
    "自強": "#C0392B",
    "莒光/復興": "#D4A017",
    "高鐵": "#E85D0D",
    "其他": "#8E44AD",
]
let clockNow = Date()

func boardRow(_ number: String, _ type: String, to destination: String?,
              minutesFromNow: Int, relation: JourneyRelation = .departure,
              delay: Int? = nil, arrivalMinutes: Int? = nil,
              lastOfDay: Bool = false) -> BoardRow {
    let date = clockNow.addingTimeInterval(TimeInterval(minutesFromNow * 60))
    let cal = RailBoardClock.calendar
    let seconds = Int(date.timeIntervalSince(cal.startOfDay(for: date)))
    let arrival = arrivalMinutes.map { clockNow.addingTimeInterval(TimeInterval($0 * 60)) }
    return BoardRow(trainNumber: number, trainType: type, scheduledSecond: seconds,
                    scheduledDate: date,
                    arrivalSecond: arrival.map { Int($0.timeIntervalSince(cal.startOfDay(for: $0))) },
                    arrivalDate: arrival, destinationName: destination, relation: relation,
                    delay: delay, isLastOfDay: lastOfDay)
}

func board(title: String, rows: [BoardRow], empty: String? = nil,
           notice: ScheduleNotice? = nil) -> BoardSnapshot {
    BoardSnapshot(title: title, isWatching: true, isLive: true, typeColors: sampleTypeColors,
                  rows: rows, emptyMessage: empty, notice: notice, generatedAt: clockNow)
}

// 台北站的一長串：兩區都排得滿才驗得到「次列名額對半分」與底部不留白。
let railTaipei = board(title: "臺北", rows: [
    boardRow("0814", "高鐵", to: "南港", minutesFromNow: 5, delay: 0),
    boardRow("420", "自強", to: "臺東", minutesFromNow: 7, delay: 6),
    boardRow("1168", "區間車", to: "基隆", minutesFromNow: 12),
    boardRow("4037", "區間快", to: "桃園", minutesFromNow: 19),
    boardRow("152", "自強", to: "臺北", minutesFromNow: 26),
    boardRow("1112", "區間車", to: "基隆", minutesFromNow: 38, delay: 0),
])

// 最壞情況＋兩條額外資訊同時出現（末班車那一行在捷運區、班表告示在臺鐵區）。
let railWorst = board(title: "竹北 → 臺北", rows: [
    boardRow("1234", "莒光/復興", to: "臺北-環島", minutesFromNow: 9, delay: 3, arrivalMinutes: 64),
    boardRow("2", "自強", to: "臺北", minutesFromNow: 14, relation: .pass),
    boardRow("1284", "區間車", to: "彰化", minutesFromNow: 21, delay: 0, lastOfDay: true),
    boardRow("152", "自強", to: "臺北", minutesFromNow: 26, arrivalMinutes: 81),
], notice: .expiring(until: clockNow.addingTimeInterval(2 * 86_400)))

let railEmpty = board(title: "花壇", rows: [], empty: "今天沒有列車經過")

func placeRow(_ number: String, _ type: String, _ destination: String,
              minutesFromNow: Int, system: String = "tra") -> PlaceBoardRow {
    let date = clockNow.addingTimeInterval(TimeInterval(minutesFromNow * 60))
    let start = RailBoardClock.calendar.startOfDay(for: date)
    return PlaceBoardRow(trainNumber: number, trainType: type, destinationName: destination,
                         scheduledSecond: Int(date.timeIntervalSince(start)),
                         scheduledDate: date, systemID: system)
}

// 「我的地點」當臺鐵半邊：兩條線合併後按時刻排（線色留在軌脊點上）。
let railPlace = PlaceBoardSnapshot(title: "家", lines: [
    PlaceLineSnapshot(id: "tra|縱貫線北段", name: "縱貫線北段", color: "#2E6FB0",
                      perpendicularMeters: 412, rows: [
        placeRow("4037", "區間快", "桃園", minutesFromNow: 4),
        placeRow("1282", "區間車", "南港", minutesFromNow: 13),
        placeRow("1283", "區間車", "楊梅", minutesFromNow: 18),
    ]),
    PlaceLineSnapshot(id: "thsr|THSR", name: "高鐵", color: "#E85D0D",
                      perpendicularMeters: 1_043, rows: [
        placeRow("0567", "高鐵", "左營", minutesFromNow: 7, system: "thsr"),
        placeRow("0862", "高鐵", "南港", minutesFromNow: 22, system: "thsr"),
    ]),
], typeColors: sampleTypeColors, generatedAt: clockNow)

func mixed(_ metro: MetroEntry, _ rail: RailBoardEntryContent) -> MixedBoardEntry {
    MixedBoardEntry(date: Date(), configuration: MixedBoardIntent(),
                    rail: RailBoardEntry(date: Date(), configuration: ConfigurationAppIntent(),
                                         content: rail),
                    metro: metro)
}

// ── 算繪 ────────────────────────────────────────────────────────────────────

/// 出貨的 MixedBoardEntryView 去掉三個 widget 專屬修飾詞（containerBackground 用了
/// UIKit 的 Color(uiColor:)，裸執行檔編不起來）。內距與 scale／box 的算法逐字相同，
/// 且由 wrapperGate() 在原始碼層擋住分岔。
struct MixedHarnessCard: View {
    let entry: MixedBoardEntry

    var body: some View {
        GeometryReader { geo in
            MixedBoardCard(
                entry: entry,
                scale: RailScale(width: geo.size.width, reference: RailScale.mediumReference),
                box: geo.size.height
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(RailBoardInsets.content)
    }
}

@MainActor
func pngData(_ entry: MixedBoardEntry, width: CGFloat, height: CGFloat,
             scheme: ColorScheme = .light, mono: Bool = false) -> Data {
    let renderer = ImageRenderer(
        content: MixedHarnessCard(entry: entry)
            .frame(width: width, height: height)
            .background(Color(white: scheme == .dark ? 0.09 : 0.98))
            .environment(\\.colorScheme, scheme)
            .environment(\\.railMonochrome, mono)
            .environment(\\.railFamilyOverride, WidgetFamily.systemLarge)
            .previewContext(WidgetPreviewContext(family: .systemLarge))
    )
    renderer.scale = 3
    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write(Data("算繪失敗\\n".utf8))
        exit(1)
    }
    return png
}

/// 墨跡邊界。判準用「非底色像素」這個物理事實，不用 SwiftUI 自己的量測值
/// （心得 29：判準不得與實作共用推導假設）。回傳 nil＝整張空白。
func inkBounds(_ png: Data, scale: CGFloat) -> (x0: CGFloat, x1: CGFloat, y0: CGFloat, y1: CGFloat)? {
    guard let rep = NSBitmapImageRep(data: png) else { return nil }
    let w = rep.pixelsWide, h = rep.pixelsHigh
    guard let bg = rep.colorAt(x: 1, y: 1) else { return nil }
    var x0 = w, x1 = -1, y0 = h, y1 = -1
    for y in 0..<h {
        for x in 0..<w {
            guard let c = rep.colorAt(x: x, y: y) else { continue }
            let d = abs(c.redComponent - bg.redComponent) + abs(c.greenComponent - bg.greenComponent)
                  + abs(c.blueComponent - bg.blueComponent)
            if d > 0.07 {
                if x < x0 { x0 = x }; if x > x1 { x1 = x }
                if y < y0 { y0 = y }; if y > y1 { y1 = y }
            }
        }
    }
    guard x1 >= 0 else { return nil }
    return (CGFloat(x0) / scale, CGFloat(x1) / scale, CGFloat(y0) / scale, CGFloat(y1) / scale)
}

@MainActor
func render(_ entry: MixedBoardEntry, width: CGFloat, height: CGFloat,
            scheme: ColorScheme = .light, mono: Bool = false, to path: String) -> Data {
    let png = pngData(entry, width: width, height: height, scheme: scheme, mono: mono)
    try! png.write(to: URL(fileURLWithPath: path))
    let name = (path as NSString).lastPathComponent
    guard let b = inkBounds(png, scale: 3) else {
        FileHandle.standardError.write(Data("破版：\\(name) 整張空白\\n".utf8)); exit(1)
    }
    let inset = RailBoardInsets.content
    let m = inset - 0.5   // 抗鋸齒會讓邊界向外溢半個像素
    var over: [String] = []
    if b.x0 < m { over.append("左 \\(b.x0)") }
    if b.x1 > width - m { over.append("右 \\(b.x1) > \\(width - inset)") }
    if b.y0 < m { over.append("上 \\(b.y0)") }
    if b.y1 > height - m { over.append("下 \\(b.y1) > \\(height - inset)") }
    if !over.isEmpty {
        FileHandle.standardError.write(
            Data("破版：\\(name) 墨跡溢出內容框——\\(over.joined(separator: "、"))\\n".utf8))
        exit(1)
    }
    print("寫出 \\(name)（\\(Int(width))×\\(Int(height)) pt @3x，墨跡 y \\(Int(b.y0))–\\(Int(b.y1))/\\(Int(height - inset))）")
    return png
}

// ── gate ────────────────────────────────────────────────────────────────────

/// 🔴 gate：軌脊必須是【一條連續的線】貫穿兩區（設計稿 C 的整個立論）。
///
/// 為什麼要量像素：漏一個 lineAbove/lineBelow、或分區 hairline 那一列忘了放軌脊欄，
/// 畫面上只是「中間空一小段」——縮圖看不出來，而破版 gate 完全照不到（墨跡邊界不變）。
/// 判準：掃軌脊中心那一欄（內距 16 ＋ 半個軌脊欄），從第一段線到最後一段線之間，
/// 連續空白不得超過 6pt。站點圓點上下各留 1.5pt 缺口是設計本身，8pt 以上就是斷開。
///
/// 🔴 掃描範圍要從【卡片標題以下】起算：站名的字就壓在軌脊那一欄上，把它算進來的話
///    「標題底部到第一段軌脊」那段本來就該空的距離會被讀成斷點（第一次跑就是這樣紅的）。
func spineGate(_ png: Data, name: String) {
    guard let rep = NSBitmapImageRep(data: png) else {
        FileHandle.standardError.write(Data("軌脊 gate：讀不到圖\\n".utf8)); exit(1)
    }
    let scale: CGFloat = 3
    let cx = Int((RailBoardInsets.content + RailSpineCell.column / 2) * scale)
    let top = Int((RailBoardInsets.content + RailRowHeight.cardTitle) * scale)
    guard let bg = rep.colorAt(x: 1, y: 1) else { exit(1) }
    var rows: [Bool] = Array(repeating: false, count: top)
    for y in top..<rep.pixelsHigh {
        var hit = false
        // 軌線寬 2pt；容許 ±2px 的抗鋸齒偏移。
        for dx in -3...3 {
            guard let c = rep.colorAt(x: cx + dx, y: y) else { continue }
            let d = abs(c.redComponent - bg.redComponent) + abs(c.greenComponent - bg.greenComponent)
                  + abs(c.blueComponent - bg.blueComponent)
            if d > 0.07 { hit = true; break }
        }
        rows.append(hit)
    }
    guard let first = rows.firstIndex(of: true), let last = rows.lastIndex(of: true) else {
        FileHandle.standardError.write(Data("軌脊 gate 失敗：\\(name) 整條軌脊都沒畫出來\\n".utf8))
        exit(1)
    }
    var worst = 0, run = 0, worstAt = 0
    for y in first...last {
        if rows[y] { run = 0 } else {
            run += 1
            if run > worst { worst = run; worstAt = y }
        }
    }
    let gapPt = CGFloat(worst) / scale
    if gapPt > 6 {
        let msg = "軌脊 gate 失敗：\\(name) 軌脊在 y≈\\(Int(CGFloat(worstAt) / scale))pt 斷了 "
            + "\\(gapPt)pt（>6）。設計稿 C 的立論就是「一條軌脊貫穿兩區」——"
            + "分區標題與分區 hairline 那兩列必須自己帶 RailSpineCell(kind: .line)。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    print("gate 通過：\\(name) 軌脊連續貫穿兩區（最大缺口 \\(gapPt)pt ≤ 6）")
}

/// 🔴 gate：兩區都排滿時，底部不准留一整列以上的空白。
///
/// 這條直接編碼 08-15 的真機回饋（「大卡下半還有空位卻只列三班」）。設計稿字面的
/// 「每區兩班次要」在 350pt 的框裡會空 68pt ⇒ 這道 gate 會紅，而破版 gate 永遠不會。
func fillGate(_ png: Data, height: CGFloat, name: String) {
    guard let b = inkBounds(png, scale: 3) else {
        FileHandle.standardError.write(Data("留白 gate：\\(name) 整張空白\\n".utf8)); exit(1)
    }
    let slack = height - RailBoardInsets.content - b.y1
    if slack > RailRowHeight.followLarge + 8 {
        let msg = "留白 gate 失敗：\\(name) 底部空了 \\(Int(slack))pt，還放得下至少一列。"
            + "次列名額是從實測內容框高推的（MixedPlan），空這麼多代表算錯了框或漏給名額。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    print("gate 通過：\\(name) 底部只剩 \\(Int(slack))pt（放不下第二列，沒有浪費空間）")
}

/// 🔴 gate：捷運半邊空白時，通行證 CTA 與自動選站指引必須真的講出來。
///
/// 改版前混合卡自己印一句 emptyText，於是這兩種狀態在大卡上【完全不講】。
/// 這是純資料斷言（不看畫面）：小卡與大卡共用 MetroEntry.emptyBody 這一個出口。
func ctaGate() {
    let gated = metroGated.emptyBody(at: Date())
    if !gated.isCTA || !gated.text.contains("通行證") {
        FileHandle.standardError.write(Data(
            "CTA gate 失敗：被通行證閘門擋下時，混合卡沒有講出「為什麼看不到、去哪裡買」。\\n".utf8))
        exit(1)
    }
    let plain = metroEntry(station: "板橋", snapshot: nil).emptyBody(at: Date())
    if plain.isCTA {
        FileHandle.standardError.write(Data(
            "CTA gate 失敗：一般空白狀態被誤判成付費 CTA（會用主色喊一句沒人買得到的東西）。\\n".utf8))
        exit(1)
    }
    print("gate 通過：通行證閘門講得出 CTA，一般空白狀態不會被誤判成 CTA")
}

// systemLarge：430pt 機型 364×382、393pt 機型 338×354。
@main
struct Harness {
    @MainActor
    static func main() {
        let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        ctaGate()

        let main = render(mixed(metroTaipei, .board(railTaipei)), width: 364, height: 382,
                          to: outDir + "/mixed-large.png")
        spineGate(main, name: "mixed-large.png")
        fillGate(main, height: 382, name: "mixed-large.png")

        let narrow = render(mixed(metroTaipei, .board(railTaipei)), width: 338, height: 354,
                            to: outDir + "/mixed-large-393.png")
        spineGate(narrow, name: "mixed-large-393.png")
        fillGate(narrow, height: 354, name: "mixed-large-393.png")

        _ = render(mixed(metroTaipei, .board(railTaipei)), width: 364, height: 382,
                   scheme: .dark, mono: true, to: outDir + "/mixed-large-mono.png")
        // 末班車＋班表告示同時出現：兩行額外資訊各吃 18pt，次列要自己讓位。
        let busy = render(mixed(metroWithLast, .board(railWorst)), width: 364, height: 382,
                          to: outDir + "/mixed-large-extras.png")
        spineGate(busy, name: "mixed-large-extras.png")
        // 捷運半邊被通行證擋下 ⇒ 名額全讓給臺鐵。
        _ = render(mixed(metroGated, .board(railTaipei)), width: 364, height: 382,
                   to: outDir + "/mixed-large-gated.png")
        // 臺鐵半邊沒班次／整個不可用。
        _ = render(mixed(metroTaipei, .board(railEmpty)), width: 364, height: 382,
                   to: outDir + "/mixed-large-rail-empty.png")
        _ = render(mixed(metroTaipei, .unavailable("先在小工具設定裡挑一個車站")),
                   width: 364, height: 382, to: outDir + "/mixed-large-rail-unavailable.png")
        // 臺鐵半邊是「我的地點」：分區標題改講「經過」。
        let placeShot = render(mixed(metroTaipei, .place(railPlace)), width: 364, height: 382,
                               to: outDir + "/mixed-large-place.png")
        spineGate(placeShot, name: "mixed-large-place.png")
        // 兩半設在不同車站：分區標題要把臺鐵那一站的名字講出來。
        _ = render(mixed(metroEntry(station: "板橋", snapshot: taipeiSnap), .board(railWorst)),
                   width: 364, height: 382, to: outDir + "/mixed-large-diffstation.png")
    }
}
`;

mkdirSync(outDir, { recursive: true });
const swiftPath = join(outDir, 'harness.swift');
const binPath = join(outDir, 'harness');
writeFileSync(swiftPath, harness);

// Bundle.main 對裸執行檔＝執行檔所在目錄 ⇒ 複製真的 MetroWidgetData.json 過去，
// 讓 MetroWidgetCatalog／MetroPalette／MetroLastTrain 原封不動吃真資料算。
copyFileSync(dataPath, join(outDir, 'MetroWidgetData.json'));

execFileSync(
  'swiftc',
  ['-O', '-parse-as-library', swiftPath, modelPath, kitPath, '-o', binPath],
  { stdio: 'inherit' }
);
execFileSync(binPath, [outDir], { stdio: 'inherit' });
