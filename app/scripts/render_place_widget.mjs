#!/usr/bin/env node
// 把小工具的「我的地點」版面算繪成 PNG，不必進模擬器也不必上手機。
//
// 為什麼是抽取而不是複製：版面常數（字級、列數、間距）一旦在這裡各留一份，
// 就會跟真正出貨的檔案分岔——那正是 07-31 預覽假資料把區間快寫成橘色、
// 害人用截圖審版面卻審到假東西的那個坑。所以這支腳本每次都從
// RailBoardWidget.swift／RailBoardData.swift 現場抽出「真的會被編譯進 App 的那幾個宣告」，
// 只補上 WidgetKit 相關的外殼。抽不到就直接失敗，不留退路。
//
// 用法：node app/scripts/render_place_widget.mjs [輸出目錄]
// 產物：<輸出目錄>/place-small.png、place-medium.png（@3x）

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const outDir = resolve(process.argv[2] ?? join(here, '../../tmp/place-widget-shots'));

/**
 * 從 Swift 原始碼抽出一個頂層宣告（含其大括號區塊）。
 * 用大括號配對而不是行號——行號會隨任何一次編輯失效，而失效時的症狀是
 * 「算繪出來的是舊版面」這種不會報錯的假象。
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

const widgetSource = readFileSync(join(widgetDir, 'RailBoardWidget.swift'), 'utf8');
const dataSource = readFileSync(join(widgetDir, 'RailBoardData.swift'), 'utf8');

const pieces = [
  extractDeclaration(dataSource, 'enum RailBoardClock'),
  extractDeclaration(widgetSource, 'extension Color'),
  extractDeclaration(widgetSource, 'struct PlaceBoardRow'),
  extractDeclaration(widgetSource, 'struct PlaceLineSnapshot'),
  extractDeclaration(widgetSource, 'struct PlaceBoardSnapshot'),
  extractDeclaration(widgetSource, 'struct SmallPlaceBoardView'),
  extractDeclaration(widgetSource, 'private struct SmallPlaceLineView'),
  extractDeclaration(widgetSource, 'struct PlaceColumnMetrics'),
  extractDeclaration(widgetSource, 'struct MediumPlaceBoardView'),
  extractDeclaration(widgetSource, 'private struct MediumPlaceLineView'),
];

// 樣本刻意用真實的落釘結果形狀：兩條線、時刻跨越整點、車種色票與 meta.json 實際寫出的值一致。
// 第三條線是為了量「三欄」那個最壞情況——欄寬只剩兩欄時的三分之二。
const harness = `
import AppKit
import Foundation
import SwiftUI

${pieces.join('\n\n')}

// meta.json 實際會寫出的值。改這裡之前先確認 App 端寫的是什麼——
// 假資料與真值分岔就等於用截圖審了一個不存在的版面。
let sampleTypeColors: [String: String] = [
    "區間快": "#16A085",
    "區間車": "#2E6FB0",
    "自強": "#C0392B",
    "莒光/復興": "#D4A017",
    "高鐵": "#E85D0D",
    "其他": "#8E44AD",
]

func sampleRow(
    _ number: String,
    _ type: String,
    _ destination: String,
    minutesFromNow: Int,
    system: String
) -> PlaceBoardRow {
    let now = Date()
    let date = now.addingTimeInterval(TimeInterval(minutesFromNow * 60))
    let calendar = RailBoardClock.calendar
    let start = calendar.startOfDay(for: date)
    let seconds = Int(date.timeIntervalSince(start))
    return PlaceBoardRow(
        trainNumber: number,
        trainType: type,
        destinationName: destination,
        scheduledSecond: seconds,
        scheduledDate: date,
        systemID: system
    )
}

let tra = PlaceLineSnapshot(
    id: "tra|縱貫線北段",
    name: "縱貫線北段",
    color: "#2E6FB0",
    perpendicularMeters: 412,
    rows: [
        sampleRow("4037", "區間快", "桃園", minutesFromNow: 4, system: "tra"),
        sampleRow("1282", "區間車", "南港", minutesFromNow: 13, system: "tra"),
        sampleRow("1283", "區間車", "楊梅", minutesFromNow: 18, system: "tra"),
    ]
)

// 線名用索引裡的真值「高鐵」（不是「台灣高鐵」）；車種、終點站名也都取自 place_index.json。
let thsr = PlaceLineSnapshot(
    id: "thsr|THSR",
    name: "高鐵",
    color: "#E85D0D",
    perpendicularMeters: 1_043,
    rows: [
        sampleRow("0567", "高鐵", "左營", minutesFromNow: 7, system: "thsr"),
        sampleRow("0862", "高鐵", "南港", minutesFromNow: 22, system: "thsr"),
        sampleRow("0294", "高鐵", "南港", minutesFromNow: 41, system: "thsr"),
    ]
)

// 最壞情況：資料裡最長的線名（縱貫線北段，5 字）、最長的車種（莒光/復興，5 字）、
// 4 碼車次、最長的終點站名（臺北-環島，5 字）。字級公式就是照這一列反解的，
// 它不爆版才算數——用「區間車 1282」那種好看的樣本量出來的字級是自欺。
let worstCase = PlaceLineSnapshot(
    id: "tra|縱貫線南段",
    name: "縱貫線南段",
    color: "#C0392B",
    perpendicularMeters: 1_499,
    rows: [
        sampleRow("1234", "莒光/復興", "臺北-環島", minutesFromNow: 9, system: "tra"),
        sampleRow("5678", "莒光/復興", "新左營", minutesFromNow: 24, system: "tra"),
        sampleRow("4321", "區間快", "蘇澳新", minutesFromNow: 47, system: "tra"),
    ]
)

let mountain = PlaceLineSnapshot(
    id: "tra|山線",
    name: "山線",
    color: "#E8792B",
    perpendicularMeters: 1_380,
    rows: [
        sampleRow("123", "自強", "潮州", minutesFromNow: 11, system: "tra"),
        sampleRow("2711", "區間車", "苗栗", minutesFromNow: 26, system: "tra"),
        sampleRow("151", "自強", "臺東", minutesFromNow: 38, system: "tra"),
    ]
)

func snapshot(_ lines: [PlaceLineSnapshot]) -> PlaceBoardSnapshot {
    PlaceBoardSnapshot(
        title: "家",
        lines: lines,
        typeColors: sampleTypeColors,
        generatedAt: Date()
    )
}

@MainActor
func render<V: View>(_ view: V, width: CGFloat, height: CGFloat, to path: String) {
    let renderer = ImageRenderer(
        content: view
            .frame(width: width, height: height)
            .background(Color(white: 0.98))
            .environment(\\.colorScheme, .light)
    )
    renderer.scale = 3
    guard
        let image = renderer.nsImage,
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write(Data("算繪失敗：\\(path)\\n".utf8))
        exit(1)
    }
    try! png.write(to: URL(fileURLWithPath: path))
    print("寫出 \\(path)（\\(Int(width))×\\(Int(height)) pt @3x）")
}

// iPhone 16 Pro Max 的小工具尺寸：small 170×170、medium 364×170。
// 用最大的機型量「字會不會太小」，用下面的窄版量「會不會被擠爆」。
@main
struct Harness {
    @MainActor
    static func main() {
        let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        let now = Date()

        render(
            SmallPlaceBoardView(snapshot: snapshot([tra, thsr]), entryDate: now),
            width: 170, height: 170,
            to: outDir + "/place-small.png"
        )
        render(
            MediumPlaceBoardView(snapshot: snapshot([tra, thsr]), entryDate: now),
            width: 364, height: 170,
            to: outDir + "/place-medium.png"
        )
        render(
            MediumPlaceBoardView(snapshot: snapshot([tra, thsr, mountain]), entryDate: now),
            width: 364, height: 170,
            to: outDir + "/place-medium-3lines.png"
        )
        // 最窄的 medium（iPhone SE 等級）——字級調大最先在這裡爆掉。
        render(
            MediumPlaceBoardView(snapshot: snapshot([tra, thsr]), entryDate: now),
            width: 291, height: 141,
            to: outDir + "/place-medium-narrow.png"
        )
        // 最寬的一列 × 最窄的機型：字級公式的下界就靠這張證明沒爆。
        render(
            MediumPlaceBoardView(snapshot: snapshot([worstCase, thsr]), entryDate: now),
            width: 291, height: 141,
            to: outDir + "/place-medium-worst-narrow.png"
        )
        render(
            MediumPlaceBoardView(snapshot: snapshot([worstCase, thsr]), entryDate: now),
            width: 364, height: 170,
            to: outDir + "/place-medium-worst.png"
        )
    }
}
`;

mkdirSync(outDir, { recursive: true });
const swiftPath = join(outDir, 'harness.swift');
const binPath = join(outDir, 'harness');
writeFileSync(swiftPath, harness);

execFileSync(
  'swiftc',
  ['-O', '-parse-as-library', swiftPath, '-o', binPath],
  { stdio: 'inherit' }
);
execFileSync(binPath, [outDir], { stdio: 'inherit' });
