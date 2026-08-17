#!/usr/bin/env node
// 把「發車看板」小工具的三個家族算繪成 PNG，不必進模擬器也不必上手機。
// 車站看板（board）與我的地點（place）都在同一個小工具裡，所以同一支腳本一起算。
//
// 為什麼是抽取而不是複製：版面常數（字級、列數、間距）一旦在這裡各留一份，
// 就會跟真正出貨的檔案分岔——那正是 07-31 預覽假資料把區間快寫成橘色、
// 害人用截圖審版面卻審到假東西的那個坑。所以這支腳本每次都從
// RailBoardWidget.swift／RailBoardData.swift 現場抽出「真的會被編譯進 App 的那幾個宣告」，
// 只補上凍結樣本。抽不到就直接失敗，不留退路。
//
// 刻意不抽 Provider／RailBoardWidgetEntryView：前者只負責組 entry（要 App Group 與 AppIntents），
// 後者用了 UIKit 的 Color(uiColor:)，兩者在裸 macOS 執行檔都編不起來。版面真正吃的是
// 六個 View，而它們的內容邊距【寫在自己身上】（RailBoardInsets）⇒ 這裡不必也不可以再補一層。
//
// 用法：node app/scripts/render_board_widget.mjs [輸出目錄]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const outDir = resolve(process.argv[2] ?? join(here, '../../tmp/board-widget-shots'));

/**
 * 從 Swift 原始碼抽出一個頂層宣告（含其大括號區塊）。
 * 用大括號配對而不是行號——行號會隨任何一次編輯失效，而失效時的症狀是
 * 「算繪出來的是舊版面」這種不會報錯的假象。
 * （與 render_metro_widget.mjs 完全同一份實作。）
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

// 共用元件層直接交給 swiftc 一起編（不抽宣告）：抽取會有「抽到舊版」的風險，而這一層是
// 七個畫面的地基，抽錯的症狀是「算繪出來的版面不是出貨的版面」這種不會報錯的假象。
const kitPath = join(widgetDir, 'RailWidgetKit.swift');
const widgetSource = readFileSync(join(widgetDir, 'RailBoardWidget.swift'), 'utf8');
const dataSource = readFileSync(join(widgetDir, 'RailBoardData.swift'), 'utf8');

const pieces = [
  extractDeclaration(dataSource, 'enum RailBoardClock'),
  extractDeclaration(dataSource, 'enum JourneyRelation'),
  extractDeclaration(dataSource, 'enum ScheduleNotice'),
  extractDeclaration(widgetSource, 'extension Color'),
  // 資料模型（BoardRow 裡有「倒數已含誤點」的 effectiveDate 與三種關係詞，都是版面在讀的）
  extractDeclaration(widgetSource, 'struct BoardRow'),
  extractDeclaration(widgetSource, 'struct BoardSnapshot'),
  extractDeclaration(widgetSource, 'struct PlaceBoardRow'),
  extractDeclaration(widgetSource, 'struct PlaceLineSnapshot'),
  extractDeclaration(widgetSource, 'struct PlaceBoardSnapshot'),
  // 倒數規則（>90 分鐘退成時刻、誤點推遲、逐分鐘邊界）
  extractDeclaration(widgetSource, 'enum BoardCountdown'),
  // 版面
  extractDeclaration(widgetSource, 'enum RailBoardInsets'),
  extractDeclaration(widgetSource, 'struct BoardNotice'),
  extractDeclaration(widgetSource, 'enum BoardPalette'),
  extractDeclaration(widgetSource, 'enum PlaceDistance'),
  extractDeclaration(widgetSource, 'struct PassBadge'),
  extractDeclaration(widgetSource, 'struct SmallBoardView'),
  extractDeclaration(widgetSource, 'struct MediumBoardView'),
  extractDeclaration(widgetSource, 'struct BoardRowView'),
  extractDeclaration(widgetSource, 'struct RectangularBoardView'),
  extractDeclaration(widgetSource, 'struct SmallPlaceBoardView'),
  extractDeclaration(widgetSource, 'struct MediumPlaceBoardView'),
  extractDeclaration(widgetSource, 'private struct PlaceColumnView'),
  extractDeclaration(widgetSource, 'private struct PlaceRowView'),
  extractDeclaration(widgetSource, 'struct RectangularPlaceBoardView'),
];

const harness = `
import AppKit
import Foundation
import SwiftUI
import WidgetKit

${pieces.join('\n\n')}

// ── 凍結樣本 ────────────────────────────────────────────────────────────────
//
// 車種色是 App 實際寫出的 meta.json types。改這裡之前先確認 App 端寫的是什麼——
// 假資料與真值分岔就等於用截圖審了一個不存在的版面（07-31 就發生過）。
let sampleTypeColors: [String: String] = [
    "區間快": "#16A085",
    "區間車": "#2E6FB0",
    "自強": "#C0392B",
    "莒光/復興": "#D4A017",
    "高鐵": "#E85D0D",
    "其他": "#8E44AD",
]

let clockNow = Date()

/// 一列。minutesFromNow 是【表定】相對現在的分鐘數；delay 走真正的欄位，
/// 所以「倒數已含誤點」這件事是由出貨程式碼算的，不是這裡手捏的。
func boardRow(
    _ number: String,
    _ type: String,
    to destination: String?,
    minutesFromNow: Int,
    relation: JourneyRelation = .departure,
    delay: Int? = nil,
    arrivalMinutes: Int? = nil,
    lastOfDay: Bool = false
) -> BoardRow {
    let date = clockNow.addingTimeInterval(TimeInterval(minutesFromNow * 60))
    let cal = RailBoardClock.calendar
    let start = cal.startOfDay(for: date)
    let seconds = Int(date.timeIntervalSince(start))
    let arrival = arrivalMinutes.map { clockNow.addingTimeInterval(TimeInterval($0 * 60)) }
    return BoardRow(
        trainNumber: number,
        trainType: type,
        scheduledSecond: seconds,
        scheduledDate: date,
        arrivalSecond: arrival.map { Int($0.timeIntervalSince(cal.startOfDay(for: $0))) },
        arrivalDate: arrival,
        destinationName: destination,
        relation: relation,
        delay: delay,
        isLastOfDay: lastOfDay
    )
}

func snapshot(
    title: String,
    watching: Bool,
    rows: [BoardRow],
    empty: String? = nil,
    notice: ScheduleNotice? = nil
) -> BoardSnapshot {
    BoardSnapshot(title: title, isWatching: watching, isLive: true,
                  typeColors: sampleTypeColors, rows: rows,
                  emptyMessage: empty, notice: notice, generatedAt: clockNow)
}

// 設計稿 A/B 的示範資料（臺北站，三班：高鐵準點、自強誤點、區間車）。
// 🔴 delay 刻意三種都有：0（官方讀數＝準點）、6（誤點，倒數要含它）、nil（沒有讀數，
//    不准畫「準點」）——這三者在畫面上必須長得不一樣，那正是這批改版的重點之一。
let taipeiWatch = snapshot(title: "臺北", watching: true, rows: [
    boardRow("0814", "高鐵", to: "南港", minutesFromNow: 5, delay: 0),
    boardRow("420", "自強", to: "臺東", minutesFromNow: 7, delay: 6),
    boardRow("1168", "區間車", to: "基隆", minutesFromNow: 12),
])

// 主角誤點（設計稿：「11:35 開 → 11:41」＋「誤點 · 倒數已含誤點」）。
let taipeiLate = snapshot(title: "臺北", watching: true, rows: [
    boardRow("420", "自強", to: "臺東", minutesFromNow: -2, delay: 6),
    boardRow("1168", "區間車", to: "基隆", minutesFromNow: 12),
    boardRow("4037", "區間快", to: "桃園", minutesFromNow: 19),
])

// 直達模式（有目的地）：標題是「竹北 → 臺北」，副標多一段「抵 HH:mm」。
// 最壞情況也塞在這裡：最長的車種名（莒光/復興）、4 碼車次、最長的終點站名（臺北-環島）。
let commute = snapshot(title: "竹北 → 臺北", watching: false, rows: [
    boardRow("1234", "莒光/復興", to: "臺北-環島", minutesFromNow: 9,
             delay: 3, arrivalMinutes: 64),
    boardRow("152", "自強", to: "臺北", minutesFromNow: 26, arrivalMinutes: 81),
    boardRow("1112", "區間車", to: "基隆", minutesFromNow: 38, delay: 0, arrivalMinutes: 96),
])

// 通過不停靠＋今日末班：兩個「漏讀就會錯過一班車」的標記同時出現。
let passing = snapshot(title: "花壇", watching: true, rows: [
    boardRow("2", "自強", to: "臺北", minutesFromNow: 4, relation: .pass),
    boardRow("1284", "區間車", to: "彰化", minutesFromNow: 21, delay: 0, lastOfDay: true),
    boardRow("3", "自強", to: "潮州", minutesFromNow: 33, relation: .pass),
])

// 終到列車（relation: .arrival ⇒ 方向欄是「終點」、時刻詞是「抵」）。
let terminating = snapshot(title: "潮州", watching: true, rows: [
    boardRow("3", "自強", to: nil, minutesFromNow: 6, relation: .arrival, delay: 0),
    boardRow("1284", "區間車", to: "枋寮", minutesFromNow: 24),
])

// 🔴 >90 分鐘：倒數退成靜態時刻（RailCountdown 只有「分」這個單位，480 分讀不出來）。
//    副標同時要換成「表定」，否則畫面上會出現兩個一模一樣的時刻。
// delay 一律 nil：出貨路徑只在「下一班在 30 分鐘內」才去抓即時誤點（liveWindow），
// 3.5 小時後的班次不可能有讀數 ⇒ 樣本給 0 會畫出一個生產環境不存在的「準點」。
let farAway = snapshot(title: "臺東", watching: true, rows: [
    boardRow("310", "自強", to: "臺北", minutesFromNow: 214),
    boardRow("704", "區間車", to: "花蓮", minutesFromNow: 260),
])

// 班表過期警示（Medium 少列一班、Small 的註腳讓位給它）。
let expiring = snapshot(
    title: "臺北", watching: true,
    rows: [
        boardRow("0814", "高鐵", to: "南港", minutesFromNow: 5, delay: 0),
        boardRow("420", "自強", to: "臺東", minutesFromNow: 7, delay: 6),
        boardRow("1168", "區間車", to: "基隆", minutesFromNow: 12),
    ],
    notice: .expiring(until: clockNow.addingTimeInterval(2 * 86_400))
)

let emptyBoard = snapshot(title: "花壇", watching: true, rows: [], empty: "今天沒有列車經過")

// ── 我的地點 ────────────────────────────────────────────────────────────────

func placeRow(
    _ number: String,
    _ type: String,
    _ destination: String,
    minutesFromNow: Int,
    system: String = "tra"
) -> PlaceBoardRow {
    let date = clockNow.addingTimeInterval(TimeInterval(minutesFromNow * 60))
    let start = RailBoardClock.calendar.startOfDay(for: date)
    return PlaceBoardRow(
        trainNumber: number, trainType: type, destinationName: destination,
        scheduledSecond: Int(date.timeIntervalSince(start)),
        scheduledDate: date, systemID: system
    )
}

let traLine = PlaceLineSnapshot(
    id: "tra|縱貫線北段", name: "縱貫線北段", color: "#2E6FB0", perpendicularMeters: 412,
    rows: [
        placeRow("4037", "區間快", "桃園", minutesFromNow: 4),
        placeRow("1282", "區間車", "南港", minutesFromNow: 13),
        placeRow("1283", "區間車", "楊梅", minutesFromNow: 18),
    ]
)

// 線名用索引裡的真值「高鐵」（不是「台灣高鐵」）。
let thsrLine = PlaceLineSnapshot(
    id: "thsr|THSR", name: "高鐵", color: "#E85D0D", perpendicularMeters: 1_043,
    rows: [
        placeRow("0567", "高鐵", "左營", minutesFromNow: 7, system: "thsr"),
        placeRow("0862", "高鐵", "南港", minutesFromNow: 22, system: "thsr"),
        placeRow("0294", "高鐵", "南港", minutesFromNow: 41, system: "thsr"),
    ]
)

// 最壞情況：資料裡最長的線名、最長的車種（莒光/復興）、4 碼車次、最長的終點站名。
// 車種標【不准縮】（設計稿），所以這一欄就是欄寬預算的下界證明。
let worstLine = PlaceLineSnapshot(
    id: "tra|縱貫線南段", name: "縱貫線南段", color: "#C0392B", perpendicularMeters: 1_499,
    rows: [
        placeRow("1234", "莒光/復興", "臺北-環島", minutesFromNow: 9),
        placeRow("5678", "莒光/復興", "新左營", minutesFromNow: 24),
        placeRow("4321", "區間快", "蘇澳新", minutesFromNow: 47),
    ]
)

let quietLine = PlaceLineSnapshot(
    id: "tra|平溪線", name: "平溪線", color: "#16A085", perpendicularMeters: 780, rows: []
)

func place(_ lines: [PlaceLineSnapshot]) -> PlaceBoardSnapshot {
    PlaceBoardSnapshot(title: "家", lines: lines,
                       typeColors: sampleTypeColors, generatedAt: clockNow)
}

// ── 算繪與 gate ─────────────────────────────────────────────────────────────

@MainActor
func pngData<V: View>(_ view: V, family: WidgetFamily? = nil, width: CGFloat, height: CGFloat,
                      scheme: ColorScheme = .light, mono: Bool = false) -> Data {
    // 🔴 這裡【不】補 16pt 內容邊距：這個小工具 contentMarginsDisabled()，邊距由 View 自己
    //    帶（RailBoardInsets）。補第二層會讓算繪出來的內容框比出貨窄一圈——
    //    與捷運那支腳本相反的錯誤方向，一樣是「圖看起來沒問題但不是出貨的版面」。
    // 🔴 \\.widgetFamily 對外唯讀（WidgetKit 只讓真的小工具宿主寫它），previewContext 在
    //    swiftc 編出的裸執行檔對它完全無效（2026-08-17 受控實驗：三種 family 讀回來都是
    //    .systemMedium）⇒ 走元件層的 railFamilyOverride 哨兵。守門人是下面的 familyGate()。
    let renderer = ImageRenderer(
        content: view
            .frame(width: width, height: height)
            .background(Color(white: scheme == .dark ? 0.09 : 0.98))
            .environment(\\.colorScheme, scheme)
            .environment(\\.railMonochrome, mono)
            .environment(\\.railFamilyOverride, family)
            // macOS 的 WidgetFamily 沒有鎖屏那個 case（WidgetKit 明文標為 unavailable）
            // ⇒ 鎖屏那兩個 View 傳 nil：它們不讀 family，靠 mono 與 inset 0 就還原得了
            // 鎖屏的顯示條件。previewContext 只吃非 nil，給它一個不影響結果的值。
            .previewContext(WidgetPreviewContext(family: family ?? .systemSmall))
    )
    renderer.scale = 3
    guard
        let image = renderer.nsImage,
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write(Data("算繪失敗\\n".utf8))
        exit(1)
    }
    return png
}

/// 墨跡邊界。判準用「非底色像素」這個物理事實，不用 SwiftUI 自己的量測值——後者與版面同源
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
func componentPNG<V: View>(_ v: V) -> Data? {
    let r = ImageRenderer(content: v.fixedSize().padding(6).background(Color.white))
    r.scale = 3
    guard let img = r.nsImage, let tiff = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff) else { return nil }
    return rep.representation(using: .png, properties: [:])
}

@MainActor
func inkSize<V: View>(_ v: V) -> (w: CGFloat, h: CGFloat)? {
    guard let png = componentPNG(v), let b = inkBounds(png, scale: 3) else { return nil }
    return (b.x1 - b.x0, b.y1 - b.y0)
}

/// 🔴 gate 1：證明 family 真的傳進去了。
///
/// 同一個 snapshot、同一個畫布，只換 family——Small 走單班大卡、Medium 走一主兩從，
/// 兩張圖【必須不同】。相等就代表 family 的傳遞機制壞了（previewContext 那條路就是這樣
/// 壞掉且沒有任何人發現），此時所有 Small 產物都是 Medium 版面的偽裝 ⇒ 直接失敗，
/// 不要產出會被誤信的圖。
@MainActor
func familyGate() {
    let small = pngData(SmallBoardView(snapshot: taipeiWatch, entryDate: clockNow),
                        family: .systemSmall, width: 170, height: 170)
    let medium = pngData(MediumBoardView(snapshot: taipeiWatch, entryDate: clockNow),
                         family: .systemMedium, width: 170, height: 170)
    if small == medium {
        FileHandle.standardError.write(Data("""
            算繪失敗：Small 與 Medium 在同一個畫布上算出【完全相同】的圖。
            兩個版面不再有差別（或 railFamilyOverride 的傳遞斷了）——修好之前不要拿去驗收。
            """.utf8))
        exit(1)
    }
    print("gate 通過：Small 與 Medium 版面確實不同")
}

/// 🔴 gate 2：每一種倒數形態都要塞得進它的槽。
///
/// 為什麼墨跡邊界那道擋不住：數字欄是固定寬 frame，字級太大時 (a) 文字被裁在欄內、
/// (b) SwiftUI 的 frame 修飾詞【不裁切】，超寬的子元素會往內畫到內容欄上面——兩種都是
/// 「整張圖看起來沒破版」。所以要單獨量元件本身，再比對槽寬與列高。
/// 槽寬與列高一律【引用真正的常數】：寫死數字的話改了 RailNumberColumn，這道 gate
/// 會對一個過期的值斷言並繼續全綠（心得 35「判準綁在會漂移的量上」）。
@MainActor
func slotGate() {
    func slot(_ size: RailCountdownText.Size) -> (CGFloat, CGFloat) {
        switch size {
        case .heroRow:  return (RailNumberColumn.wide, RailRowHeight.hero)
        case .heroCard: return (RailScale.smallReference, RailCountdownText.Size.heroCard.pt)
        case .row, .minor: return (RailNumberColumn.narrow, RailRowHeight.follow)
        }
    }
    // 🔴 「經過」也要窮舉：我的地點用它取代「進站」，字寬不同（都是兩個字，但實心色塊的
    //    內距與槽寬的餘裕很小），只驗「進站」等於沒驗過那條路徑。
    let forms: [(String, RailCountdown, String)] = [
        ("12 分", .minutes(12), "進站"),
        ("約 12 分", .approxMinutes(12), "進站"),
        ("59 秒", .seconds(59), "進站"),
        ("進站", .arriving, "進站"),
        ("經過", .arriving, "經過"),
        ("暫無資料", .noData, "進站"),
        ("表定 11:38", .scheduled("11:38"), "進站"),
    ]
    var bad: [String] = []
    var n = 0
    for size in RailCountdownText.Size.allCases {
        let (maxW, maxH) = slot(size)
        for (label, form, word) in forms {
            n += 1
            guard let s = inkSize(RailCountdownText(value: form, size: size, arrivingWord: word)) else {
                bad.append("\\(size)／\\(label)：量不到墨跡"); continue
            }
            if s.w > maxW { bad.append("\\(size)／\\(label)：寬 \\(Int(s.w)) > 槽 \\(Int(maxW))") }
            if s.h > maxH { bad.append("\\(size)／\\(label)：高 \\(Int(s.h)) > 列高 \\(Int(maxH))") }
        }
    }
    if !bad.isEmpty {
        FileHandle.standardError.write(Data(("倒數形態塞不進槽：\\n  "
            + bad.joined(separator: "\\n  ") + "\\n").utf8))
        exit(1)
    }
    print("gate 通過：\\(n) 種「Size × 倒數形態」組合都塞得進各自的槽")
}

/// 🔴 gate 3：「倒數已含誤點」必須真的在畫面上成立。
///
/// 這是設計稿對這張卡最實質的一條要求（「11:35 開 → 11:41」配「4 分」），而它【只在數字上
/// 顯形】——把 effectiveDate 改回 scheduledDate，版面 gate、破版 gate、槽位 gate 會全部
/// 照樣通過，因為版面完全沒變、只有那個數字錯了。判準是純資料事實：同一班車，
/// 誤點 6 分與不誤點算出來的倒數必須差 6 分，而且誤點那版的副標必須出現箭頭。
func delayGate() {
    let plain = boardRow("420", "自強", to: "臺東", minutesFromNow: 7)
    let late = boardRow("420", "自強", to: "臺東", minutesFromNow: 7, delay: 6)
    guard case .minutes(let a) = BoardCountdown.of(row: plain, at: clockNow),
          case .minutes(let b) = BoardCountdown.of(row: late, at: clockNow) else {
        FileHandle.standardError.write(Data("誤點 gate：倒數不是分鐘形態，樣本壞了\\n".utf8))
        exit(1)
    }
    if b - a != 6 {
        let msg = "誤點 gate 失敗：誤點 6 分的倒數是 \\(b) 分、不誤點是 \\(a) 分，差 \\(b - a) 不是 6。"
            + "設計稿「倒數已含誤點」沒有成立——使用者會照著早走 6 分鐘的數字上月台。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    if !late.departureText.contains("→") || late.departureText == plain.departureText {
        let msg = "誤點 gate 失敗：誤點列的時刻字串是「\\(late.departureText)」，"
            + "沒有「表定 → 實際」兩個時刻。只給誤點分鐘的話使用者要自己做加法才能對上廣播。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // 準點與「沒有讀數」不可以長得一樣：前者是官方讀數，後者是我們不知道。
    if plain.statusKind != nil {
        FileHandle.standardError.write(Data("誤點 gate 失敗：沒有誤點讀數的列竟然拿到狀態標\\n".utf8))
        exit(1)
    }
    let onTime = boardRow("420", "自強", to: "臺東", minutesFromNow: 7, delay: 0)
    guard onTime.statusKind == .delay(0) else {
        FileHandle.standardError.write(Data("誤點 gate 失敗：delay 0 沒有變成狀態標（畫不出「準點」）\\n".utf8))
        exit(1)
    }
    print("gate 通過：倒數含誤點（+6 分 ⇒ 倒數多 6 分）、誤點列給出兩個時刻、準點與無讀數可分辨")
}

/// 🔴 gate 4：逐分鐘 entry 真的排出來了。
///
/// 倒數從「會自己走的相對時間」改成靜態文字之後，timeline 少排一個分鐘邊界，畫面上的數字
/// 就會凍在那裡直到下一班發車——而任何一張截圖都看不出「它其實不會動」。
/// 判準：一班 20 分鐘後的車，未來 20 分鐘內必須有 ≥19 個翻頁時點，且每個相鄰間隔都是 60 秒。
func timelineGate() {
    let target = clockNow.addingTimeInterval(20 * 60)
    let bounds = BoardCountdown.minuteBoundaries(
        of: [target], after: clockNow, until: clockNow.addingTimeInterval(60 * 60))
    let inWindow = bounds.filter { $0 <= target }
    if inWindow.count < 19 {
        let msg = "timeline gate 失敗：20 分鐘內只排出 \\(inWindow.count) 個分鐘翻頁（要 ≥19）。"
            + "倒數是靜態文字，少排一個邊界就等於那一分鐘畫面凍住。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    let gaps = zip(inWindow.dropFirst(), inWindow).map { $0.timeIntervalSince($1) }
    if let bad = gaps.first(where: { abs($0 - 60) > 0.5 }) {
        FileHandle.standardError.write(Data("timeline gate 失敗：相鄰邊界差 \\(Int(bad)) 秒不是 60\\n".utf8))
        exit(1)
    }
    // 遠在 90 分鐘外的班次不該燒 entry（畫的是靜態時刻，不會變）。
    let far = BoardCountdown.minuteBoundaries(
        of: [clockNow.addingTimeInterval(214 * 60)], after: clockNow,
        until: clockNow.addingTimeInterval(50 * 60))
    if !far.isEmpty {
        FileHandle.standardError.write(Data("""
            timeline gate 失敗：3.5 小時後的班次在未來 50 分鐘內排了 \\(far.count) 個 entry。
            那段時間畫面上是靜態時刻、不會變，燒的是 WidgetKit 的刷新預算。
            """.utf8))
        exit(1)
    }
    print("gate 通過：逐分鐘翻頁排滿（\\(inWindow.count) 個、間隔 60 秒），遠班次不燒 entry")
}

@MainActor
func render<V: View>(_ view: V, family: WidgetFamily? = nil, width: CGFloat, height: CGFloat,
                     scheme: ColorScheme = .light, mono: Bool = false,
                     inset: CGFloat = 16, to path: String) {
    let png = pngData(view, family: family, width: width, height: height,
                      scheme: scheme, mono: mono)
    try! png.write(to: URL(fileURLWithPath: path))
    let name = (path as NSString).lastPathComponent
    guard let b = inkBounds(png, scale: 3) else {
        FileHandle.standardError.write(Data("破版：\\(name) 整張空白\\n".utf8)); exit(1)
    }
    // 抗鋸齒會讓邊界向外溢半個像素，量到 inset − 0.5 以內都算貼齊。
    let m = inset - 0.5
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
}

// 430pt 機型：small 170×170、medium 364×170。393pt 機型：158×158、338×158。
// 兩種寬度都要算——RailScale 的下限（k ≥ 0.86）只有窄機型踩得到。
@main
struct Harness {
    @MainActor
    static func main() {
        let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        familyGate()
        slotGate()
        delayGate()
        timelineGate()

        // ── 車站看板 ──
        render(SmallBoardView(snapshot: taipeiWatch, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small.png")
        render(SmallBoardView(snapshot: taipeiLate, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small-late.png")
        render(SmallBoardView(snapshot: commute, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small-commute.png")
        render(SmallBoardView(snapshot: passing, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small-pass.png")
        render(SmallBoardView(snapshot: expiring, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small-notice.png")
        render(SmallBoardView(snapshot: farAway, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small-far.png")
        render(SmallBoardView(snapshot: emptyBoard, entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/board-small-empty.png")
        render(SmallBoardView(snapshot: taipeiWatch, entryDate: clockNow),
               family: .systemSmall, width: 158, height: 158, to: out + "/board-small-393.png")

        render(MediumBoardView(snapshot: taipeiWatch, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium.png")
        render(MediumBoardView(snapshot: taipeiWatch, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, scheme: .dark,
               to: out + "/board-medium-dark.png")
        render(MediumBoardView(snapshot: taipeiWatch, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, scheme: .dark, mono: true,
               to: out + "/board-medium-mono.png")
        render(MediumBoardView(snapshot: commute, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium-commute.png")
        render(MediumBoardView(snapshot: passing, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium-pass.png")
        render(MediumBoardView(snapshot: terminating, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium-terminal.png")
        render(MediumBoardView(snapshot: farAway, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium-far.png")
        render(MediumBoardView(snapshot: expiring, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium-notice.png")
        render(MediumBoardView(snapshot: emptyBoard, entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/board-medium-empty.png")
        // 最壞情況 × 最窄機型：車種標不准縮，這張是內容欄預算的下界證明。
        render(MediumBoardView(snapshot: commute, entryDate: clockNow),
               family: .systemMedium, width: 338, height: 158, to: out + "/board-medium-worst-393.png")

        // 鎖屏：家族自己就是單色，且沒有內容邊距。
        render(RectangularBoardView(snapshot: taipeiWatch, entryDate: clockNow),
               width: 160, height: 72,
               scheme: .dark, mono: true, inset: 0, to: out + "/board-rect.png")
        render(RectangularBoardView(snapshot: passing, entryDate: clockNow),
               width: 160, height: 72,
               scheme: .dark, mono: true, inset: 0, to: out + "/board-rect-pass.png")

        // ── 我的地點 ──
        render(SmallPlaceBoardView(snapshot: place([traLine, thsrLine]), entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/place-small.png")
        render(SmallPlaceBoardView(snapshot: place([worstLine]), entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/place-small-worst.png")
        render(SmallPlaceBoardView(snapshot: place([quietLine]), entryDate: clockNow),
               family: .systemSmall, width: 170, height: 170, to: out + "/place-small-quiet.png")
        render(SmallPlaceBoardView(snapshot: place([traLine, thsrLine]), entryDate: clockNow),
               family: .systemSmall, width: 158, height: 158, to: out + "/place-small-393.png")

        // 一條線＝軌脊列表；兩條以上＝並排欄（兩個版面都要算）。
        render(MediumPlaceBoardView(snapshot: place([traLine]), entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/place-medium-single.png")
        render(MediumPlaceBoardView(snapshot: place([traLine, thsrLine]), entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/place-medium-2.png")
        render(MediumPlaceBoardView(snapshot: place([traLine, thsrLine, worstLine]),
                                    entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/place-medium-3.png")
        // 三欄 × 最壞內容 × 最窄機型：每欄只剩約 89pt，車種標不准縮 ⇒ 這是欄寬的極限證明。
        render(MediumPlaceBoardView(snapshot: place([worstLine, worstLine, worstLine]),
                                    entryDate: clockNow),
               family: .systemMedium, width: 338, height: 158, to: out + "/place-medium-3-worst-393.png")
        render(MediumPlaceBoardView(snapshot: place([traLine, quietLine]), entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, to: out + "/place-medium-quiet.png")
        render(MediumPlaceBoardView(snapshot: place([traLine, thsrLine]), entryDate: clockNow),
               family: .systemMedium, width: 364, height: 170, scheme: .dark, mono: true,
               to: out + "/place-medium-mono.png")

        render(RectangularPlaceBoardView(snapshot: place([traLine, thsrLine]), entryDate: clockNow),
               width: 160, height: 72,
               scheme: .dark, mono: true, inset: 0, to: out + "/place-rect.png")
    }
}
`;

mkdirSync(outDir, { recursive: true });
const swiftPath = join(outDir, 'harness.swift');
const binPath = join(outDir, 'harness');
writeFileSync(swiftPath, harness);

execFileSync(
  'swiftc',
  ['-O', '-parse-as-library', swiftPath, kitPath, '-o', binPath],
  { stdio: 'inherit' }
);
execFileSync(binPath, [outDir], { stdio: 'inherit' });
