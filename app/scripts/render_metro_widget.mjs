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
//   metro-small.png         systemSmall ,十四張(環狀線,無擁擠度)——改版後是【單班大卡】,
//                            測五列硬預算(識別20/站名24/方向19/倒數44/註腳16)在最窄卡不溢出
//   metro-medium.png        systemMedium,台北車站(有擁擠度)——測「主班43＋hairline9＋從班28×2」
//                            的 137pt 預算,與主班內容欄「線名＋六節色塊＋詞」會不會換行
//   metro-large.png         systemLarge ,哈瑪星(高捷,整數分鐘)——測「約 N 分」靜態文字與 6 列上限
//   metro-medium-interchange.png systemMedium,忠孝復興(文湖/板南轉乘)——逐列線別的唯一難例。
//                            🔴 這一張【另出一張單色版】(metro-medium-interchange-mono.png):
//                            改版前這張的兩列都寫「往 南港展覽館」、只靠棕點與藍點區分,
//                            單色模式下顏色被系統吃掉 ⇒ 兩列完全無從分辨。線名是不是真的
//                            補上了這個缺口,只有單色那張看得出來(全彩那張永遠看起來沒問題)
//   metro-medium-lastcall.png systemMedium,台北車站,now 撥到官方視野以外逼近末班窗——
//                            測「板面空白訊息＋末班列」同時出現時版面不會破(這是本 task
//                            標題「含末班車列」的招牌情境,三個一般樣本的時間點都在下午,
//                            湊不出末班窗,必須刻意撥時鐘才看得到)
//   metro-small-auto.png     systemSmall ,十四張＋auto 徽章——測「自動」徽章在最窄卡不擠爆標頭
//   metro-small-auto-fail.png systemSmall,自動選站解析失敗的 autoHint 空狀態(定位指引文案)
//   metro-small-out-of-range.png systemSmall,定位到了但最近的站在服務範圍外(台中→老街溪站 107km)

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
// 共用元件層直接交給 swiftc 一起編（不抽宣告）：抽取會有「抽到舊版」的風險，而這一層是
// 七個畫面的地基，抽錯的症狀是「算繪出來的版面不是出貨的版面」這種不會報錯的假象。
const kitPath = join(widgetDir, 'RailWidgetKit.swift');
const intentSource = readFileSync(join(widgetDir, 'MetroBoardIntent.swift'), 'utf8');
const widgetSource = readFileSync(join(widgetDir, 'MetroBoardWidget.swift'), 'utf8');
const dataPath = join(widgetDir, 'MetroWidgetData.json');

// 只抽版面真正會用到的型別/邏輯:MetroBoardProvider／MetroFetcher／MetroBoardWidget(連網
// 與 Widget 外殼)刻意不抽——組 entry 這裡改吃凍結樣本,不打真的網路(見上方檔頭說明)。
const pieces = [
  extractDeclaration(intentSource, 'struct MetroWidgetCatalog'),
  // 服務範圍外那張卡的文案要走【真的那一支】,不在這裡重打字面值(文案改了會無聲分岔)。
  extractDeclaration(readFileSync(join(widgetDir, 'MetroNearest.swift'), 'utf8'),
                     'enum MetroNearestMath'),
  extractDeclaration(widgetSource, 'struct MetroEntry'),
  // 空狀態文案(連不上／資料過舊／官方沒班次)住在這個 extension 裡,MetroBoardView 直接呼叫它;
  // 沒抽進來的話 harness 一編就是「has no member 'emptyText'」。
  extractDeclaration(widgetSource, 'extension MetroEntry'),
  extractDeclaration(widgetSource, 'enum MetroPalette'),
  extractDeclaration(widgetSource, 'enum MetroLastTrain'),
  extractDeclaration(widgetSource, 'extension MetroWidgetCatalog'),
  extractDeclaration(widgetSource, 'struct MetroBoardView'),
  // 倒數形態的判定(秒級→分鐘/進站、分鐘級→約 N 分)住在這裡,小卡與列表列共用同一條規則。
  extractDeclaration(widgetSource, 'enum MetroCountdown'),
  extractDeclaration(widgetSource, 'struct MetroRowView'),
];

// 三個凍結樣本的絕對路徑,直接嵌進 harness 原始碼字面值(harness 是一次性產生的檔案,
// 不是需要跨機器可攜的產物)。站名字面值與 app/scripts/verify_metro_board_logic.mjs 用的
// 完全一致(「十四張」「哈瑪星」都已經是別名表查過的正規化形式,不是原始站牌字串)。
const trtcFixture = join(fixtureDir, 'trtc-live.json');
const yFixture = join(fixtureDir, 'trtc-live-y.json');
const krtcFixture = join(fixtureDir, 'krtc-live.json');

const harness = `
import AppKit
import Foundation
import SwiftUI
import WidgetKit

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

// 🔴 sys 一定要帶:每一列的線色與線名是 MetroRowView 用 sys＋station 呼 rowLine(...) 算的,
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

// 主角列【帶擁擠度】:內容欄寬度的最壞情況——線名＋六節色塊＋擁擠度詞要同時排在
// 「往 <終點>」下面那一行。三個一般樣本的第一列都恰好沒有擁擠度(台北車站的 203/208
// 有,但排不到第一列)⇒ 這個組合在改版前後都【從來沒被算繪到】。
// 做法:把 rows 濾成「有擁擠度的那些」——與生產環境的方向格(cfg.dir)完全同一種轉換
// (MetroBoardProvider.entry 的 filtered),不是手捏 rows。
let crowdRows = taipeiSnap.rows.filter { ($0.crowd?.isEmpty == false) }
let crowdSnap = MetroSnapshot(station: taipeiSnap.station, dataAt: taipeiSnap.dataAt,
                              rows: crowdRows, stale: crowdRows.isEmpty)
let crowdEntry = makeEntry(sys: "trtc", station: "台北車站", snapshot: crowdSnap, now: taipeiNow)

// 自動選站的兩個新視覺狀態(2026-08-15 批次):
// (1) 解析成功=正常看板+「自動」小徽章——用最窄的 small 卡驗徽章不會把站名/時戳擠爆;
let szAutoEntry = MetroEntry(date: szEntry.date, title: szEntry.title, lineColor: szEntry.lineColor,
                             snapshot: szEntry.snapshot, precision: szEntry.precision,
                             lastTrain: szEntry.lastTrain, failed: szEntry.failed,
                             deepLink: szEntry.deepLink, auto: true,
                             // 🔴 sys 漏帶就是整張卡的線色與線名一顆都不畫(本檔檔頭 makeEntry
                             //    上方那條警告講的正是這件事,而這個 entry 自己踩了)。
                             sys: szEntry.sys)
// (2) 解析失敗=autoHint 空狀態(文案與 MetroBoardProvider.entry(for:) 的字面值一致,
//     這裡是視覺驗證不是邏輯來源;真源頭在 MetroBoardWidget.swift 的 auto 分支)。
let autoFailEntry = MetroEntry(date: Date(), title: "自動選站", lineColor: nil, snapshot: nil,
                               precision: "sec", lastTrain: nil, failed: false,
                               autoHint: "開啟 App 一次，或到「設定 › 軌島」允許取用位置")
// (3) 定位到了但最近的站在服務範圍外(2026-08-18)。探針放台中車站——最近站是 106 公里外的
//     機捷老街溪站,是實際會遇到的案例裡站名最長的那一種(四個字),文案最長也就這樣。
//     站名、距離、整句都走【真的】MetroNearestMath,不手捏字面值:這張圖要能證明的是
//     「出貨的那句話在最窄的卡上排得下」,重打一份就只證明了我打的那句排得下。
let farHit = MetroNearestMath.nearest(catalog: MetroWidgetCatalog.shared,
                                      lat: 24.1369, lon: 120.6851)!
let outOfRangeEntry = MetroEntry(date: Date(), title: "不在服務範圍", lineColor: nil,
                                 snapshot: nil, precision: "sec", lastTrain: nil, failed: false,
                                 autoHint: MetroNearestMath.outOfRangeHint(station: farHit.station,
                                                                           meters: farHit.meters))

@MainActor
func pngData<V: View>(_ view: V, family: WidgetFamily, width: CGFloat, height: CGFloat,
                      scheme: ColorScheme = .light, mono: Bool = false) -> Data {
    // 🔴 \\.widgetFamily 對外只是唯讀 KeyPath(WidgetKit 只讓真的小工具宿主寫它)。
    //    2026-08-17 受控實驗:官方文件建議的 previewContext(WidgetPreviewContext(family:))
    //    在 swiftc 編出的【裸執行檔】裡對它完全沒有作用——三種 family 讀回來都是 .systemMedium
    //    ⇒ 這支腳本在那之前【從來沒有真的算繪過 Small 與 Large 的版面】(family: 只是裝飾)。
    //    所以改走元件層的 railFamilyOverride 哨兵(見 RailWidgetKit.swift);previewContext 保留,
    //    它同時負責 widget 專屬的顯示情境,只是 family 那一項要自己來。
    //    這個機制的守門人是下面 main 裡的 familyGate(),不是這行註解。
    let renderer = ImageRenderer(
        content: view
            // 🔴 WidgetKit 對 system family 預設加 16pt 內容邊距,出貨的 View 拿到的是
            //    170−32＝138、364−32＝332、382−32＝350 的內容框——這正是設計稿標的
            //    138／332／346 那組數字(它們是【扣掉邊距後】的內容框,不是小工具外框)。
            //    算繪少了這 32pt ⇒ 每張圖都比出貨寬一圈、底部多一片假空白,
            //    版面預算的緊繃程度被系統性低估(改版前這支腳本一直是這樣)。
            .padding(16)
            .frame(width: width, height: height)
            .background(Color(white: scheme == .dark ? 0.09 : 0.98))
            .environment(\\.colorScheme, scheme)
            // 🔴 單色(tinted／accented)模式:\\.widgetRenderingMode 同樣是唯讀 KeyPath,
            //    裸執行檔寫不了 ⇒ 走元件層自己的 railMonochrome 環境值(RailWidgetKit.swift)。
            //    根 View 的 railRenderingMode 用 transformEnvironment 做 OR,不會把這裡設的 true
            //    在 fullColor 時洗掉。
            .environment(\\.railMonochrome, mono)
            .environment(\\.railFamilyOverride, family)
            .previewContext(WidgetPreviewContext(family: family))
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

/// 🔴 第二道 gate:墨跡必須完全落在 16pt 內容框【之內】。
///
/// 為什麼要程式量而不是看圖:溢出一兩個 pt 的破版在縮圖上看不出來,而列高預算
/// (21＋8＋43＋9＋28×2＝137/138)只剩 1pt 餘裕——任何一次字級或列數調整都可能吃掉它。
/// 判準用「非底色像素的邊界」,不用 SwiftUI 自己的量測值:後者與版面同源
/// (心得 29:判準不得與實作共用推導假設),而背景像素是獨立的物理事實。
/// 回傳 nil＝這張圖完全空白(也是缺陷,由呼叫端判斷是否合法)。
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

/// 🔴 第三道 gate:每一種倒數形態都要塞得進它的槽。
///
/// 為什麼 inkBounds 那道擋不住:數字欄是固定寬 frame(width: 76),字級太大時
///  (a) 文字被裁在欄內 ⇒ 墨跡邊界完全看不出來,(b) SwiftUI 的 frame 修飾詞【不裁切】,
///  超寬的子元素會往內畫到內容欄上面 ⇒ 墨跡仍在卡內。兩種都是「圖看起來沒破版」。
/// 實測:把主角字級 40 改成 96,inkBounds gate 全綠通過(突變測試抓到的 gate 盲點)。
/// 所以要【單獨量元件本身】:fixedSize 讓它畫出真正想要的尺寸,再比對槽寬與列高。
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

@MainActor
func slotGate() {
    // 🔴 窮舉 Size 的【每一個 case】×【每一種倒數形態】,不挑樣本:
    //    挑樣本的版本漏掉了「約 12 分」(實測 80pt > 當時的 76pt 槽),而那是高捷／機捷
    //    兩位數 ETA 當主班時每天都會出現的形態。CaseIterable 讓新增 Size 時自動納入。
    // 🔴 槽寬與列高一律【引用真正的常數】,不寫死數字:寫死的話改了 RailNumberColumn
    //    這道 gate 就在對一個過期的值斷言,而它會繼續全綠(心得 35「判準綁在會漂移的量上」)。
    func slot(_ size: RailCountdownText.Size) -> (CGFloat, CGFloat) {
        switch size {
        case .heroRow:  return (RailNumberColumn.wide, RailRowHeight.hero)
        // Small 的倒數獨佔一整列 ⇒ 槽就是內容框寬(138)、列高＝該字級本身。
        case .heroCard: return (RailScale.smallReference, RailCountdownText.Size.heroCard.pt)
        case .row, .minor: return (RailNumberColumn.narrow, RailRowHeight.follow)
        }
    }
    let forms: [(String, RailCountdown)] = [
        ("12 分", .minutes(12)), ("約 12 分", .approxMinutes(12)), ("59 秒", .seconds(59)),
        ("進站", .arriving), ("暫無資料", .noData), ("表定 11:38", .scheduled("11:38")),
    ]
    var bad: [String] = []
    var n = 0
    for size in RailCountdownText.Size.allCases {
        let (maxW, maxH) = slot(size)
        for (label, form) in forms {
            n += 1
            guard let s = inkSize(RailCountdownText(value: form, size: size)) else {
                bad.append("\\(size)／\\(label):量不到墨跡"); continue
            }
            if s.w > maxW { bad.append("\\(size)／\\(label):寬 \\(Int(s.w)) > 槽 \\(Int(maxW))") }
            if s.h > maxH { bad.append("\\(size)／\\(label):高 \\(Int(s.h)) > 列高 \\(Int(maxH))") }
        }
    }
    if !bad.isEmpty {
        FileHandle.standardError.write(Data(("倒數形態塞不進槽:\\n  "
            + bad.joined(separator: "\\n  ") + "\\n").utf8))
        exit(1)
    }
    print("gate 通過:\\(n) 種「Size × 倒數形態」組合都塞得進各自的槽")
}

/// 🔴 精度 gate:「約」字是【秒級與整數分鐘級精度差異在畫面上的唯一顯形處】。
///
/// 沒有這道 gate,把那個前綴拿掉會讓高捷／機捷的整數分鐘偽裝成北捷的秒級推算,
/// 而版面 gate、破版 gate、槽位 gate 會【全部照樣通過】(突變測試實測:拿掉 prefix 三道全綠)。
/// 判準是「同一個數字在兩種形態下算出來的圖必須不同」——純畫面事實,不看實作。
@MainActor
func precisionGate() {
    for size in RailCountdownText.Size.allCases {
        guard let a = componentPNG(RailCountdownText(value: .minutes(9), size: size)),
              let b = componentPNG(RailCountdownText(value: .approxMinutes(9), size: size)) else {
            FileHandle.standardError.write(Data("精度 gate:算不出圖(\\(size))\\n".utf8))
            exit(1)
        }
        if a == b {
            let msg = "精度 gate 失敗(\\(size)):.minutes(9) 與 .approxMinutes(9) 算出完全相同的圖。"
                + "「約」字是整數分鐘系統(高捷／機捷)與秒級系統(北捷)的唯一畫面差異,"
                + "消失就等於把整數分鐘偽裝成秒級推算的假精度。\\n"
            FileHandle.standardError.write(Data(msg.utf8))
            exit(1)
        }
    }
    print("gate 通過:整數分鐘與秒級在每個字級都畫得出差異(「約」字沒被吃掉)")
}

@MainActor
func render<V: View>(_ view: V, family: WidgetFamily, width: CGFloat, height: CGFloat,
                     scheme: ColorScheme = .light, mono: Bool = false, to path: String) {
    let png = pngData(view, family: family, width: width, height: height, scheme: scheme, mono: mono)
    try! png.write(to: URL(fileURLWithPath: path))
    let name = (path as NSString).lastPathComponent
    guard let b = inkBounds(png, scale: 3) else {
        FileHandle.standardError.write(Data("破版:\\(name) 整張空白\\n".utf8)); exit(1)
    }
    // 邊距 16pt,量到 15.5 以內都算貼齊(抗鋸齒會讓邊界向外溢半個像素)。
    let m: CGFloat = 15.5
    var over: [String] = []
    if b.x0 < m { over.append("左 \\(b.x0)") }
    if b.x1 > width - m { over.append("右 \\(b.x1) > \\(width - 16)") }
    if b.y0 < m { over.append("上 \\(b.y0)") }
    if b.y1 > height - m { over.append("下 \\(b.y1) > \\(height - 16)") }
    if !over.isEmpty {
        FileHandle.standardError.write(Data("破版:\\(name) 墨跡溢出內容框——\\(over.joined(separator: "、"))\\n".utf8))
        exit(1)
    }
    print("寫出 \\(name)（\\(Int(width))×\\(Int(height)) pt @3x,墨跡 y \\(Int(b.y0))–\\(Int(b.y1))/\\(Int(height - 16))）")
}

/// 🔴 第一道 gate:證明 family 真的傳進去了。
///
/// 同一個 entry、同一個畫布尺寸,只換 family——Small 走單班大卡、Medium 走一主多從,
/// 兩張圖【必須不同】。相等就代表 family 的傳遞機制又壞了(previewContext 那條路就是這樣
/// 壞掉且沒有任何人發現的),此時所有 Small／Large 的產物都是 Medium 版面的偽裝,
/// 後面每一張圖都不值得看 ⇒ 直接 exit 1,不要產出會被誤信的圖。
@MainActor
func familyGate(_ entry: MetroEntry) {
    let small = pngData(MetroBoardView(entry: entry), family: .systemSmall, width: 170, height: 170)
    let medium = pngData(MetroBoardView(entry: entry), family: .systemMedium, width: 170, height: 170)
    if small == medium {
        FileHandle.standardError.write(Data("""
            算繪失敗:family 沒有真的傳進 View。
            同一個 entry 在 .systemSmall 與 .systemMedium 算出【完全相同】的圖,
            代表 railFamilyOverride 的傳遞斷了(或版面不再依 family 分支)。
            在修好之前,Small／Large 的產物都是 Medium 版面的偽裝,不要拿去驗收。
            """.utf8))
        exit(1)
    }
    print("gate 通過:Small 與 Medium 版面確實不同(family 有生效)")
}

// iPhone 16 Pro Max 的小工具尺寸(與 render_place_widget.mjs 同一套基準):
// small 170×170、medium 364×170、large 364×382。
@main
struct Harness {
    @MainActor
    static func main() {
        let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        familyGate(szEntry)
        slotGate()
        precisionGate()

        render(MetroBoardView(entry: szEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small.png")
        render(MetroBoardView(entry: taipeiEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium.png")
        // 深色（非 mono）：桌面深色模式的實際長相,送審圖合成用。
        render(MetroBoardView(entry: taipeiEntry), family: .systemMedium,
               width: 364, height: 170, scheme: .dark, to: outDir + "/metro-medium-dark.png")
        // 送審圖用：使用者那台是 402pt 機型,量到的卡片實際是 350×164pt。
        // 拿 364pt 的圖去縮會讓字級整體小 4%,直接照那台的點數渲染才是它真的長相。
        // 🔴 用忠孝復興不用台北車站：同一張送審圖裡下面那張混合大卡已經是台北車站,
        //    兩張卡同一站會看起來像同一個小工具擺兩次;忠孝復興還順便帶到轉乘站兩條線。
        render(MetroBoardView(entry: zxfxEntry), family: .systemMedium,
               width: 350, height: 164, scheme: .dark, to: outDir + "/metro-medium-store.png")
        render(MetroBoardView(entry: hmxEntry), family: .systemLarge,
               width: 364, height: 382, to: outDir + "/metro-large.png")
        render(MetroBoardView(entry: taipeiLateEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium-lastcall.png")
        render(MetroBoardView(entry: zxfxEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium-interchange.png")
        render(MetroBoardView(entry: zxfxEntry), family: .systemMedium,
               width: 364, height: 170, scheme: .dark, mono: true,
               to: outDir + "/metro-medium-interchange-mono.png")
        render(MetroBoardView(entry: crowdEntry), family: .systemMedium,
               width: 364, height: 170, to: outDir + "/metro-medium-crowd.png")
        // 深色（非 mono）：送審圖合成用,同上。
        render(MetroBoardView(entry: crowdEntry), family: .systemMedium,
               width: 364, height: 170, scheme: .dark, to: outDir + "/metro-medium-crowd-dark.png")
        // 🔴 393pt 機型（iPhone 15／16 非 Max）：medium 小工具 338×158 ⇒ 內容框 306×126,
        //    k＝306/332≈0.92。RailScale 的下限就是為這個機型存在的,不驗它等於沒驗縮放路徑
        //    ——而 430pt 那張永遠看不出來（改版前兩支算繪腳本都只有 430pt 一種寬度）。
        render(MetroBoardView(entry: crowdEntry), family: .systemMedium,
               width: 338, height: 158, to: outDir + "/metro-medium-crowd-393.png")
        render(MetroBoardView(entry: taipeiEntry), family: .systemMedium,
               width: 338, height: 158, to: outDir + "/metro-medium-393.png")
        render(MetroBoardView(entry: crowdEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small-crowd.png")
        // 台北車站排 Large:多線大站班次最多,測 6 列上限與軌脊貫穿整張卡
        render(MetroBoardView(entry: taipeiEntry), family: .systemLarge,
               width: 364, height: 382, to: outDir + "/metro-large-taipei.png")
        render(MetroBoardView(entry: szAutoEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small-auto.png")
        render(MetroBoardView(entry: autoFailEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small-auto-fail.png")
        render(MetroBoardView(entry: outOfRangeEntry), family: .systemSmall,
               width: 170, height: 170, to: outDir + "/metro-small-out-of-range.png")
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
  ['-O', '-parse-as-library', swiftPath, modelPath, kitPath, '-o', binPath],
  { stdio: 'inherit' }
);
execFileSync(binPath, [outDir], { stdio: 'inherit' });
