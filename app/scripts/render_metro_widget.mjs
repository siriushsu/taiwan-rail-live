#!/usr/bin/env node
// 把捷運小工具的看板版面算繪成 PNG，不必進模擬器也不必上手機。
//
// 為什麼是抽取而不是複製：版面常數（字級、列數、間距）一旦在這裡各留一份，就會跟真正
// 出貨的檔案分岔。所以這支腳本每次都從 MetroBoardWidget.swift／MetroBoardIntent.swift
// 現場抽出「真的會被編譯進 App 的那幾個宣告」，只補上 WidgetKit 外殼與凍結樣本。
// 抽不到就直接失敗，不留退路。（做法照抄 app/scripts/render_place_widget.mjs。）
//
// 刻意不抽 MetroBoardProvider／MetroFetcher／MetroBoardWidget:那三個只負責「怎麼把
// entry 組出來」(含連網)，版面真正吃的是 MetroBoardView，組 entry 這裡改用凍結樣本
// 自己動手,不打真的網路。
//
// 餵給版面的 MetroSnapshot 一律是凍結樣本(app/fixtures/metro/*.json)過真正的
// MetroBoardModel.trtc()／minuteSystem() 算出來的結果,不手捏 rows。
// lineColor／末班字串也走真正的 MetroPalette.color()／MetroLastTrain.within60min()——
// 靠複製一份真的 MetroWidgetData.json 到輸出目錄,讓裸執行檔的 Bundle.main 找得到
// (已用小實驗證實:swiftc 編出的裸執行檔,Bundle.main.bundlePath 就是執行檔所在目錄,
// 同目錄的散落資源檔可以被 url(forResource:withExtension:) 找到)。
//
// 用法：node app/scripts/render_metro_widget.mjs [輸出目錄]
// 產物（四張,對應四種要親眼檢查的情境）：
//   metro-small.png         systemSmall ,十四張(環狀線,無擁擠度)——測 2 列上限與短版面
//   metro-medium.png        systemMedium,台北車站(有擁擠度)——測擁擠度色塊會不會換行
//   metro-large.png         systemLarge ,哈瑪星(高捷,整數分鐘)——測「約 N 分」靜態文字與 6 列上限
//   metro-medium-interchange.png systemMedium,忠孝復興(文湖/板南轉乘)——逐列線點的唯一難例
//   metro-medium-lastcall.png systemMedium,台北車站,now 撥到官方視野以外逼近末班窗——
//                            測「板面空白訊息＋末班列」同時出現時版面不會破(這是本 task
//                            標題「含末班車列」的招牌情境,三個一般樣本的時間點都在下午,
//                            湊不出末班窗,必須刻意撥時鐘才看得到)
//   metro-small-auto.png     systemSmall ,十四張＋auto 徽章——測「自動」徽章在最窄卡不擠爆標頭
//   metro-small-auto-fail.png systemSmall,自動選站解析失敗的 autoHint 空狀態(定位指引文案)

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const fixtureDir = resolve(here, '../fixtures/metro');
const outDir = resolve(process.argv[2] ?? join(here, '../../tmp/metro-widget-shots'));

/**
 * 從 Swift 原始碼抽出一個頂層宣告（含其大括號區塊）。
 * 用大括號配對而不是行號——行號會隨任何一次編輯失效，而失效時的症狀是
 * 「算繪出來的是舊版面」這種不會報錯的假象。（與 render_place_widget.mjs 完全同一份實作。）
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

const modelPath = join(widgetDir, 'MetroBoardModel.swift');
// 🔴 MetroWidgetCatalog 與它的查詢 extension 2026-08-22 搬到 App/MetroWidgetShared.swift。
const sharedSource = readFileSync(join(widgetDir, '..', 'App', 'MetroWidgetShared.swift'), 'utf8');
const widgetSource = readFileSync(join(widgetDir, 'MetroBoardWidget.swift'), 'utf8');
const l10nSource = readFileSync(join(widgetDir, 'RailNativeL10n.swift'), 'utf8');
const dataPath = join(widgetDir, 'MetroWidgetData.json');

// 只抽版面真正會用到的型別/邏輯:MetroBoardProvider／MetroFetcher／MetroBoardWidget(連網
// 與 Widget 外殼)刻意不抽——組 entry 這裡改吃凍結樣本,不打真的網路(見上方檔頭說明)。
const pieces = [
  extractDeclaration(l10nSource, 'enum RailNativeL10n'),
  extractDeclaration(sharedSource, 'struct MetroWidgetCatalog'),
  extractDeclaration(widgetSource, 'struct MetroEntry'),
  extractDeclaration(widgetSource, 'struct MetroWaitTarget'),
  // 空狀態文案(連不上／資料過舊／官方沒班次)住在這個 extension 裡,MetroBoardView 直接呼叫它;
  // 沒抽進來的話 harness 一編就是「has no member 'emptyText'」。
  extractDeclaration(widgetSource, 'extension MetroEntry'),
  extractDeclaration(widgetSource, 'enum MetroPalette'),
  extractDeclaration(widgetSource, 'enum MetroLastTrain'),
  extractDeclaration(sharedSource, 'extension MetroWidgetCatalog'),
  extractDeclaration(widgetSource, 'struct MetroBoardView'),
  extractDeclaration(widgetSource, 'struct MetroRowView'),
];

// 三個凍結樣本的絕對路徑,直接嵌進 harness 原始碼字面值(harness 是一次性產生的檔案,
// 不是需要跨機器可攜的產物)。站名字面值與 app/scripts/verify_metro_board_logic.mjs 用的
// 完全一致(「十四張」「哈瑪星」都已經是別名表查過的正規化形式,不是原始站牌字串)。
const trtcFixture = join(fixtureDir, 'trtc-live.json');
const yFixture = join(fixtureDir, 'trtc-live-y.json');
const krtcFixture = join(fixtureDir, 'krtc-live.json');

const harness = `
import AppIntents
import AppKit
import Foundation
import SwiftUI
import WidgetKit

// 🔴 MetroWaitStartIntent 的【替身】。真品是 LiveActivityIntent,而 ActivityKit 是 iOS 限定,
//    這支 harness 是 macOS 裸執行檔,抽真品進來根本編不過。
//    這裡只要它能讓 MetroBoardView 的 Button(intent:) 編譯——本 harness 每個情境的
//    waitTarget 都是 nil ⇒ 執行時一律走 else 那條(widgetURL),替身連畫都不會被畫到。
//    版面會不會被 Button 改變,要看真的小工具截圖(模擬器),不是看這裡。
struct MetroWaitStartIntent: AppIntent {
    static let title: LocalizedStringResource = "追蹤這一站的車"
    @Parameter(title: "系統", default: "") var sys: String
    @Parameter(title: "車站", default: "") var station: String
    @Parameter(title: "方向") var dest: String?
    init() {}
    init(sys: String, station: String, dest: String?) {
        self.sys = sys; self.station = station; self.dest = dest
    }
    func perform() async throws -> some IntentResult { .result() }
}

${pieces.join('\n\n')}

// ── 從凍結樣本算真正的 MetroSnapshot(不手捏 rows)──────────────────────────

let widgetDataObj = try! JSONSerialization.jsonObject(
    with: Data(contentsOf: URL(fileURLWithPath: "${dataPath}"))
) as! [String: Any]
let aliasTable = widgetDataObj["alias"] as! [String: [String: String]]
let catalog = MetroWidgetCatalog.shared

func snap(kind: String, station: String, now: Double, fixture: String, sys: String) -> MetroSnapshot {
    let raw = try! Data(contentsOf: URL(fileURLWithPath: fixture))
    let alias = aliasTable[sys] ?? [:]
    return kind == "trtc"
        ? try! MetroBoardModel.trtc(json: raw, station: station, alias: alias, now: now)
        : try! MetroBoardModel.minuteSystem(json: raw, station: station, alias: alias, now: now)
}

func precisionOf(_ sys: String) -> String {
    catalog.systems.first(where: { $0.id == sys })?.precision ?? "sec"
}

// 🔴 sys 一定要帶:每一列的線色是 MetroBoardView 用 entry.sys.flatMap { rowColor(...) } 算的,
//    entry.sys 是 nil 就等於整張卡的逐列線點【一顆都不會畫】——算繪出來的圖會漂亮地通過
//    肉眼檢查,卻完全照不到線色這件事(2026-08-15 補:這正是使用者回報的那個缺陷所在的圖層)。
func makeEntry(sys: String, station: String, snapshot: MetroSnapshot?, now: Double) -> MetroEntry {
    MetroEntry(date: Date(), title: station,
               lineColor: MetroPalette.color(sys: sys, station: station),
               snapshot: snapshot, precision: precisionOf(sys),
               lastTrain: MetroLastTrain.within60min(catalog: catalog, sys: sys, station: station, now: now),
               failed: false, sys: sys)
}

// 🔴 算繪專用的整體時間平移:Text(timerInterval:) 讀的是【真實牆鐘】,凍結樣本的 eta 全在
//    過去 ⇒ 倒數一律顯示 0:00——那是倒數的【最窄形】,「12:44」這種寬形的溢版風險完全
//    驗不到(2026-08-14 主對話收貨時抓到的盲區)。修法:把每列 etaEpoch 統一加上
//    (真實現在 − 樣本 now),等於把整份快照平移到現在——每列的【剩餘秒數】與樣本擷取
//    當下逐秒相同,不是手捏 rows;dataAt 保持樣本值,「HH:mm 更新」照樣顯示資料時刻。
func shiftedToWallClock(_ s: MetroSnapshot, sampleNow: Double) -> MetroSnapshot {
    let delta = Date().timeIntervalSince1970 - sampleNow
    return MetroSnapshot(station: s.station, dataAt: s.dataAt,
                         // 🔴 只平移時刻,其餘欄位【逐欄照抄】——漏抄 lineCode/trainNo 會讓
                         //    逐列線點在算繪路徑上永遠不出現,圖看起來正常但那一層沒被驗到。
                         rows: s.rows.map { MetroRow(dest: $0.dest,
                                                     etaEpoch: $0.etaEpoch.map { $0 + delta },
                                                     minutes: $0.minutes, crowd: $0.crowd,
                                                     lineCode: $0.lineCode, trainNo: $0.trainNo) },
                         stale: s.stale)
}

// 🔴 now 一律從樣本自己的 eta 推,不用真實現在——樣本是 2026-08-14 下午擷取的凍結快照,
//    真實現在早就晚於裡面所有 eta,若用 Date() 全部班次會被模型層濾成「過站」而畫面空白。
//    算法與 app/scripts/verify_metro_board_logic.mjs 的 NOW／yNow 逐字相同(最早 eta - 60)。
func minEta(_ path: String) -> Double {
    let obj = try! JSONSerialization.jsonObject(
        with: Data(contentsOf: URL(fileURLWithPath: path))
    ) as! [String: Any]
    let board = obj["board"] as! [[String: Any]]
    return board.map { $0["eta"] as! Double }.min()!
}
let taipeiNow = minEta("${trtcFixture}") - 60
let yNow = minEta("${yFixture}") - 60

// 台北車站(北捷,trains[] 裡 203/208 兩班配得到擁擠度)
let taipeiSnap = shiftedToWallClock(
    snap(kind: "trtc", station: "台北車站", now: taipeiNow, fixture: "${trtcFixture}", sys: "trtc"),
    sampleNow: taipeiNow)
let taipeiEntry = makeEntry(sys: "trtc", station: "台北車站", snapshot: taipeiSnap, now: taipeiNow)

// 忠孝復興(文湖線與板南線的轉乘站,而且兩條線都開往南港展覽館——全線唯一一組
// 「站與終點都分不出線」的組合)。這張圖要看的是:兩列各自拿到自己的線點(棕/藍),
// 站名旁邊【不】畫站別點(轉乘站取第一條線等於亂指,見 MetroPalette.color)。
let zxfxNow = 1786690589.0 - 60   // 樣本裡那兩列的 at
let zxfxSnap = shiftedToWallClock(
    snap(kind: "trtc", station: "忠孝復興", now: zxfxNow, fixture: "${trtcFixture}", sys: "trtc"),
    sampleNow: zxfxNow)
let zxfxEntry = makeEntry(sys: "trtc", station: "忠孝復興", snapshot: zxfxSnap, now: zxfxNow)

// 十四張(環狀線 Y 線,官方對這條線沒有車廂擁擠度)
let szSnap = shiftedToWallClock(
    snap(kind: "trtc", station: "十四張", now: yNow, fixture: "${yFixture}", sys: "trtc"),
    sampleNow: yNow)
let szEntry = makeEntry(sys: "trtc", station: "十四張", snapshot: szSnap, now: yNow)

// 哈瑪星(高捷,官方只給整數分鐘;樣本裡兩線各有一組同分鐘並列 e=12)
let hmxSnap = snap(kind: "min", station: "哈瑪星", now: taipeiNow, fixture: "${krtcFixture}", sys: "krtc")
let hmxEntry = makeEntry(sys: "krtc", station: "哈瑪星", snapshot: hmxSnap, now: taipeiNow)

// 台北車站,但把 now 撥到官方視野以外、逼近真的末班窗:三個一般樣本都是下午擷取,湊不出
// 「末班前 60 分鐘」這個窗,必須刻意撥時鐘才看得到「含末班車列」這個 task 標題點名的情境——
// 且這個情境下官方視野內沒有未來班次(board 全部過期),版面會同時顯示「沒有班次資訊」與
// 「末班 hh:mm」,兩者共處時版面撐不撐得住正是要親眼檢查的重點。
// dayAfter 直接用字面值(樣本擷取日 2026-08-14 的隔天凌晨),不是重新實作 MetroLastTrain
// 的顯示規則——那段規則(60 分鐘窗／跨午夜推一天)仍然是上面剛從原始碼抽出的
// MetroLastTrain.within60min,這裡只是替算繪選一個能展示末班列的示範時間點。
let lastCallCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Taipei")!
    return c
}()
let dayAfterCapture = lastCallCal.startOfDay(for: Date(timeIntervalSince1970: taipeiNow))
    .addingTimeInterval(86_400)
// 樣本裡「trtc|台北車站|」最早的末班是 00:35(往淡水)——現場即時查,不寫死時分,
// 這裡只往前推 20 分鐘當作 now,確保落在 60 分鐘窗內又不早到窗外。
func earliestLastTrain(prefix: String) -> String {
    let hits = catalog.lastTrain.filter { $0.key.hasPrefix(prefix) }.values.sorted()
    guard let first = hits.first else {
        FileHandle.standardError.write(Data("算繪失敗:找不到 \\(prefix) 的末班車資料\\n".utf8))
        exit(1)
    }
    return first
}
let earliestHHMM = earliestLastTrain(prefix: "trtc|台北車站|").split(separator: ":")
let lastCallNow = dayAfterCapture.timeIntervalSince1970
    + Double(Int(earliestHHMM[0])! * 3600 + Int(earliestHHMM[1])! * 60) - 20 * 60
let taipeiLateSnap = snap(kind: "trtc", station: "台北車站", now: lastCallNow, fixture: "${trtcFixture}", sys: "trtc")
let taipeiLateEntry = makeEntry(sys: "trtc", station: "台北車站", snapshot: taipeiLateSnap, now: lastCallNow)

// 自動選站的兩個新視覺狀態(2026-08-15 批次):
// (1) 解析成功=正常看板+「自動」小徽章——用最窄的 small 卡驗徽章不會把站名/時戳擠爆;
let szAutoEntry = MetroEntry(date: szEntry.date, title: szEntry.title, lineColor: szEntry.lineColor,
                             snapshot: szEntry.snapshot, precision: szEntry.precision,
                             lastTrain: szEntry.lastTrain, failed: szEntry.failed,
                             deepLink: szEntry.deepLink, auto: true)
// (2) 解析失敗=autoHint 空狀態(文案與 MetroBoardProvider.entry(for:) 的字面值一致,
//     這裡是視覺驗證不是邏輯來源;真源頭在 MetroBoardWidget.swift 的 auto 分支)。
let autoFailEntry = MetroEntry(date: Date(), title: "自動選站", lineColor: nil, snapshot: nil,
                               precision: "sec", lastTrain: nil, failed: false,
                               autoHint: "開啟 App 一次，或到「設定 › 軌島」允許取用位置")

@MainActor
func render<V: View>(_ view: V, family: WidgetFamily, width: CGFloat, height: CGFloat, to path: String) {
    // 🔴 \\.widgetFamily 對外只是唯讀 KeyPath(WidgetKit 只讓真的小工具宿主寫它),
    //    .environment(\\.widgetFamily, ...) 在裸執行檔會編不過(WritableKeyPath 型別不符)。
    //    官方給外部程式碼指定 family 的正規做法就是 previewContext(WidgetPreviewContext(family:))
    //    ——它是一般 View modifier,不綁 Xcode 的 #Preview 巨集,ImageRenderer 吃得下。
    let renderer = ImageRenderer(
        content: view
            .frame(width: width, height: height)
            .background(Color(white: 0.98))
            .environment(\\.colorScheme, .light)
            .previewContext(WidgetPreviewContext(family: family))
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

// iPhone 16 Pro Max 的小工具尺寸(與 render_place_widget.mjs 同一套基準):
// small 170×170、medium 364×170、large 364×382。
@main
struct Harness {
    @MainActor
    static func main() {
        let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

        render(MetroBoardView(entry: szEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small.png")
        render(MetroBoardView(entry: taipeiEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium.png")
        render(MetroBoardView(entry: hmxEntry), family: .systemLarge,
               width: 364, height: 382, to: outDir + "/metro-large.png")
        render(MetroBoardView(entry: taipeiLateEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium-lastcall.png")
        render(MetroBoardView(entry: zxfxEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium-interchange.png")
        render(MetroBoardView(entry: szAutoEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small-auto.png")
        render(MetroBoardView(entry: autoFailEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small-auto-fail.png")
    }
}
`;

mkdirSync(outDir, { recursive: true });
const swiftPath = join(outDir, 'harness.swift');
const binPath = join(outDir, 'harness');
writeFileSync(swiftPath, harness);

// Bundle.main 對裸執行檔會把「執行檔所在目錄」當 bundlePath,同目錄的散落資源檔可以被
// url(forResource:withExtension:) 找到(已用小實驗證實)。複製真正的 MetroWidgetData.json
// 過去,讓 MetroWidgetCatalog.load()／MetroPalette.color／MetroLastTrain.within60min
// 全部原封不動吃真資料算,不必另外手刻一份查色/末班邏輯。
copyFileSync(dataPath, join(outDir, 'MetroWidgetData.json'));

execFileSync(
  'swiftc',
  ['-O', '-parse-as-library', swiftPath, modelPath, '-o', binPath],
  { stdio: 'inherit' }
);
execFileSync(binPath, [outDir], { stdio: 'inherit' });
