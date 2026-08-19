#!/usr/bin/env node
// 把兩張 Live Activity（臺鐵跟車、捷運候車）與動態島的版面算繪成 PNG。
//
// 🔴 改版前這兩張卡【結構上沒有辦法在改版時被看見】：版面直接讀 ActivityViewContext，
//    而那個型別（連同 ActivityConfiguration）在裸執行檔裡構造不出來 ⇒ 五種狀態全靠上真機。
//    所以這次把 context 攤平成純值（RailFollowDisplay／MetroWaitDisplay），出貨路徑與這支
//    腳本走同一個 make(...)：倒數形態、狀態詞、軌道區間的規則都被驗到，不只驗到「畫得出圖」。
//
// 刻意不抽的東西：
//   - ActivityConfiguration 外殼與 DynamicIsland 的四個 region builder（ActivityKit only）
//   - MetroWaitEndIntent（LiveActivityIntent 需要 ActivityKit）⇒ 下方用同名替身，
//     視覺完全相同（都是 RailEndButton）；出貨端真的接了 intent 由 intentGate() 在原始碼層驗
//
// 用法：node app/scripts/render_activity_widget.mjs [輸出目錄]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const outDir = resolve(process.argv[2] ?? join(here, '../../tmp/activity-shots'));

/** 從 Swift 原始碼抽出一個頂層宣告（含大括號區塊）。與其他三支算繪腳本同一份實作。 */
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
    if (inString) { if (ch === '\\') { i += 1; continue; } if (ch === '"') inString = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(found, i + 1); }
  }
  throw new Error(`${header} 的大括號沒有配對成功`);
}

const kitPath = join(widgetDir, 'RailWidgetKit.swift');
const dataSource = readFileSync(join(widgetDir, 'RailBoardData.swift'), 'utf8');
const followSource = readFileSync(join(widgetDir, 'RailFollowActivity.swift'), 'utf8');
const waitSource = readFileSync(join(widgetDir, 'MetroWaitActivity.swift'), 'utf8');

/**
 * 🔴 原始碼層 gate：harness 用替身畫「結束」鈕，所以它照不到 intent 有沒有真的接上。
 * 少接 intent 的症狀是「按鈕畫得出來但按了沒反應」——算繪全綠、真機無效。
 */
function intentGate() {
  const bad = [];
  // 🔴 不用「字串出現過就算」：突變測試實測到，兩個呼叫點只改壞一個時，另一個還在
  //    ⇒ 存在性檢查照樣全綠。Live Activity 的鎖屏跑不了任意 closure，`Button(action:)`
  //    在那裡【一定】是死鈕，所以判準是「這兩個檔裡的每一顆 Button 都得吃 intent」。
  for (const [name, src] of [['跟車卡', followSource], ['候車卡', waitSource]]) {
    const buttons = src.match(/(?<![A-Za-z])Button\(/g)?.length ?? 0;
    const withIntent = src.match(/(?<![A-Za-z])Button\(intent:/g)?.length ?? 0;
    if (buttons !== withIntent) {
      bad.push(`${name}有 ${buttons} 顆 Button，只有 ${withIntent} 顆接了 intent`
             + '——鎖屏跑不了 closure，沒接 intent 的那顆按了不會有任何反應');
    }
  }
  if (!waitSource.includes('MetroWaitEndIntent')) {
    bad.push('等車卡完全沒有 MetroWaitEndIntent（「結束」鈕收不掉卡）');
  }
  for (const [name, src, needle] of [
    ['等車卡', waitSource, 'struct MetroWaitEndButton'],
    ['跟車卡', followSource, 'RailFollowDisplay.make('],
    ['等車卡', waitSource, 'MetroWaitDisplay.make('],
  ]) {
    if (!src.includes(needle)) bad.push(`${name}少了 ${needle}`);
  }
  if (bad.length) throw new Error('intent gate 失敗：\n' + bad.map((b) => '  ' + b).join('\n'));
  console.log('gate 通過：兩張卡都走 make(...) 唯一入口，「結束」鈕真的接上 intent');
}

intentGate();

/**
 * 🔴 原始碼層 gate：算繪一律把軌道畫成靜態（理由見 pngData），所以它照不到
 * 「出貨路徑有沒有真的傳 interval 進去」——少傳的症狀是真機上那條唯一會動的填色條不動，
 * 而 26 張圖全部照樣長得一樣。順便守住哨兵不可以被寫進出貨程式碼。
 */
function staticProgressGate() {
  const bad = [];
  for (const [name, src] of [['跟車卡', followSource], ['候車卡', waitSource]]) {
    // 🔴 同樣不用存在性檢查（見 intentGate）：兩張卡各有鎖屏與動態島【兩個】呼叫點，
    //    只改壞一個時存在性檢查是綠的（突變測試實測）。
    const calls = src.match(/RailSpineTrack\(/g)?.length ?? 0;
    const wired = src.match(/RailSpineTrack\(interval: display\.track,/g)?.length ?? 0;
    if (calls !== wired) {
      bad.push(`${name}有 ${calls} 個 RailSpineTrack 呼叫點，只有 ${wired} 個把 display.track 傳進去`
             + ' ⇒ 沒傳的那條在真機上不會自己走');
    }
    if (src.includes('railStaticProgress')) {
      bad.push(`${name}的出貨程式碼碰到了 railStaticProgress——那個哨兵只准 harness 設`);
    }
  }
  if (bad.length) throw new Error('靜態進度 gate 失敗：\n' + bad.map((b) => '  ' + b).join('\n'));
  console.log('gate 通過：兩張卡的軌道都吃 display.track（算繪走靜態版只是為了看得見）');
}

staticProgressGate();

/**
 * 🔴 原始碼層 gate：Live Activity 的兩張卡都不准用 `RailCountdown.from(secondsLeft:)`。
 *
 * 那個建構子在【組 ContentState 的當下】把秒數折成 `.seconds(52)`／`.minutes(3)` 這種
 * 算好的死數字，而 Live Activity 的視圖只在收到新 ContentState 時重繪一次 ⇒ 兩次推播之間
 * 畫面上那個數字不會變。08-17 小工具改版就是這樣讓跟車卡與等車卡雙雙凍住的
 * （使用者實機回報：鎖屏「16 分」整段不動，旁邊的進度條卻爬到 90%）。
 * LA 一律走 `.until(絕對到站時刻)` 讓系統自己重排重繪。
 *
 * 🔴 這道 gate 補的是值層 gate 照不到的洞：值層只驗得到 fixture 走過的那幾條分支，
 *    而「某條冷門分支又折回死數字」（例如次班、或某個系統的退路）它看不到。
 *    Home Screen widget 不在管轄內——那裡有 timeline reload，`.from` 本來就會被重算。
 */
function selfRunningCountdownGate() {
  const bad = [];
  for (const [name, src] of [['跟車卡', followSource], ['候車卡', waitSource]]) {
    // 只看程式碼行：這兩個檔的註解裡就寫著 `.from(secondsLeft:)` 在解釋為什麼不用它。
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const hits = code.match(/\.from\(secondsLeft:/g)?.length ?? 0;
    if (hits) {
      bad.push(`${name}還有 ${hits} 處 RailCountdown.from(secondsLeft:)`
             + '——那是「算好的死數字」，Live Activity 在兩次推播之間不重繪，畫面會凍住；'
             + 'LA 一律用 .until(絕對到站時刻) 交給系統自走');
    }
  }
  if (bad.length) throw new Error('自走倒數 gate 失敗：\n' + bad.map((b) => '  ' + b).join('\n'));
  console.log('gate 通過：兩張 Live Activity 都沒有把倒數折成死數字（一律 .until 自走）');
}

selfRunningCountdownGate();

const pieces = [
  extractDeclaration(dataSource, 'enum RailBoardClock'),
  extractDeclaration(followSource, 'struct RailFollowDisplay'),
  extractDeclaration(followSource, 'struct RailFollowLockView'),
  extractDeclaration(followSource, 'struct RailFollowIslandBottom'),
  extractDeclaration(waitSource, 'struct MetroWaitDisplay'),
  extractDeclaration(waitSource, 'struct MetroWaitSecondLine'),
  extractDeclaration(waitSource, 'struct MetroWaitLockView'),
  extractDeclaration(waitSource, 'struct MetroWaitIslandBottom'),
  extractDeclaration(waitSource, 'struct RailIslandMinimal'),
];

const harness = `
import AppKit
import Foundation
import SwiftUI

// 「結束」鈕的替身：出貨版是 Button(intent: MetroWaitEndIntent())（LiveActivityIntent 需要
// ActivityKit，這裡編不起來），視覺就是同一顆 RailEndButton。intent 有沒有接上由
// render_activity_widget.mjs 的 intentGate() 在原始碼層驗。
struct MetroWaitEndButton: View {
    var scale: RailScale = RailScale(k: 1)
    var compact: Bool = false
    var height: CGFloat = 30

    @ViewBuilder var body: some View {
        if compact {
            Text("結束")
                .font(.system(size: scale.pt(11), weight: .semibold))
                .padding(.horizontal, scale.pt(8))
                .frame(height: scale.pt(20))
                .background(RoundedRectangle(cornerRadius: scale.pt(5)).fill(Color.primary.opacity(0.12)))
        } else {
            RailEndButton(scale: scale, height: height) { Text("結束") }
        }
    }
}

${pieces.join('\n\n')}

// ── 凍結樣本 ────────────────────────────────────────────────────────────────
//
// 一律走 make(...)：倒數形態、狀態詞、軌道區間都由【出貨的規則】算，不在這裡手捏。

let now = Date()
let nowSec = now.timeIntervalSince1970

// 臺鐵跟車三態（設計稿 D）。車種色用班表裡自強的實際值。
func follow(minutesToArrive: Double, stopping: Bool = false, delaySec: Int = 180,
            prevStop: String? = "臺北", notice: String? = nil) -> RailFollowDisplay {
    RailFollowDisplay.make(
        kind: "自強", trainNo: "420", colorHex: "#C0392B", terminus: "臺東",
        nextStop: "板橋", prevStop: prevStop,
        arrivalDate: nowSec + minutesToArrive * 60,
        departedDate: nowSec - 7 * 60,
        delaySec: delaySec, stopping: stopping, notice: notice, now: now)
}

let followRunning = follow(minutesToArrive: 4)
let followArriving = follow(minutesToArrive: 0.6)
let followStopping = follow(minutesToArrive: 0, stopping: true)
// 誤點 0 ⇒ 準點；始發站 ⇒ 軌道左端留白；上游中斷 ⇒ 多一行橘字。
let followOnTime = follow(minutesToArrive: 12, delaySec: 0, prevStop: nil)
let followNotice = follow(minutesToArrive: 9, notice: "臺鐵即時資料中斷，位置為班表推估")
// 🔴 到站時刻早就過去而沒有新推播 ⇒ 手上這份是舊的（跟車卡沒有 dataAt，用這個當代理）。
let followStale = follow(minutesToArrive: -4)
// 最壞情況：最長車種名＋4 碼車次＋最長站名。
let followWorst = RailFollowDisplay.make(
    kind: "莒光/復興", trainNo: "1234", colorHex: "#D4A017", terminus: "臺北-環島",
    nextStop: "新左營", prevStop: "臺北-環島",
    arrivalDate: nowSec + 23 * 60, departedDate: nowSec - 11 * 60,
    delaySec: 1_260, stopping: false, notice: nil, now: now)

// 捷運候車兩態（設計稿 E）＋兩個極端值。
func wait(secondsToArrive: Double?, minutes: Int? = nil, isStale: Bool = false,
          dataAgeSec: Double = 8, crowd: [Int]? = [1, 1, 2, 2, 1, 1],
          second: (dest: String, sec: Double)? = ("南港展覽館", 132),
          pushed: Bool? = true, notice: String? = nil) -> MetroWaitDisplay {
    MetroWaitDisplay.make(
        lineLabel: "板南線", station: "龍山寺", colorHex: "#0070BD",
        nextDest: "頂埔", nextEta: secondsToArrive.map { nowSec + $0 }, nextMinutes: minutes,
        secondDest: second?.dest, secondEta: second.map { nowSec + $0.sec }, secondMinutes: nil,
        crowd: crowd, dataAt: nowSec - dataAgeSec, endAt: nowSec + 30 * 60,
        notice: notice, pushed: pushed, isStale: isStale, now: now)
}

let waitNormal = wait(secondsToArrive: 52)
let waitMinutes = wait(secondsToArrive: 195)
let waitArriving = wait(secondsToArrive: 0, isStale: true, crowd: [2, 3, 3, 2, 2, 3])
// 沒接上推播的卡到站後必須老實說「不會自己接下一班」。
let waitArrivingNoPush = wait(secondsToArrive: 0, isStale: true, pushed: nil)
// 🔴 資料過期：設計稿唯一會拿掉主角數字的狀態（dataAt 超過 90 秒）。
let waitExpired = wait(secondsToArrive: 40, dataAgeSec: 140)
// 整數分鐘系統（高捷／機捷）：沒有絕對時刻，只有「約 N 分」，軌道退成靜態。
let waitApprox = MetroWaitDisplay.make(
    lineLabel: "紅線", station: "哈瑪星", colorHex: "#D3202A",
    nextDest: "小港", nextEta: nil, nextMinutes: 6,
    secondDest: nil, secondEta: nil, secondMinutes: 12,
    crowd: nil, dataAt: nowSec - 20, endAt: nowSec + 30 * 60,
    notice: nil, pushed: false, isStale: false, now: now)
// 最壞情況：最長線名＋最長站名＋最長終點。
let waitWorst = MetroWaitDisplay.make(
    lineLabel: "中和新蘆線（迴龍）", station: "新北產業園區", colorHex: "#F5A818",
    nextDest: "南港展覽館", nextEta: nowSec + 512, nextMinutes: nil,
    secondDest: "臺北車站（直達車）", secondEta: nowSec + 900, secondMinutes: nil,
    crowd: [3, 3, 2, 2, 3, 3], dataAt: nowSec - 30, endAt: nowSec + 45 * 60,
    notice: "板南線板橋站往南港方向延誤約 5 分", pushed: true, isStale: false, now: now)

// ── 算繪 ────────────────────────────────────────────────────────────────────

@MainActor
func pngData<V: View>(_ view: V, width: CGFloat, height: CGFloat?,
                      dark: Bool = true, mono: Bool = false) -> Data {
    // Live Activity 一律深底（鎖屏卡片有自己的 activityBackgroundTint），高度自適應
    // ⇒ height 傳 nil 就讓它自己長，破版 gate 只驗左右與上下有沒有貼邊。
    let base = view
        .frame(width: width)
        .environment(\\.colorScheme, dark ? .dark : .light)
        .environment(\\.railMonochrome, mono)
        // 🔴 ProgressView(timerInterval:) 在 macOS 的 ImageRenderer 底下畫成一塊亮黃色
        //    佔位方塊（中間一個 ⊘、tint 不吃），把軌道與它下面的端點標籤全遮掉 ⇒ 算繪一律
        //    走靜態那條（版面高度兩條路徑相同）。出貨端有沒有真的傳 interval 由
        //    staticProgressGate() 在原始碼層驗。
        .environment(\\.railStaticProgress, true)
    let sized = height.map { AnyView(base.frame(height: $0)) } ?? AnyView(base)
    let renderer = ImageRenderer(
        content: sized.background(Color(white: dark ? 0.11 : 0.97))
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

/// 墨跡邊界（非底色像素這個物理事實，不用 SwiftUI 自己的量測值）。
///
/// 🔴 底色一律取【窗內眾數色】，不可取角落像素：ImageRenderer 在某些尺寸會留一圈
///    完全透明（α=0）的 1px 邊，取 (1,1) 當底色就等於拿透明去比每一個像素 ⇒ 墨跡邊界
///    整張攤開、報出假破版（2026-08-17 實例：等車卡 411px 高那張，x 量成 0–359.67）。
///    α<0.5 的像素也一併跳過——那不是畫出來的東西。
func inkBounds(_ png: Data, scale: CGFloat) -> (x0: CGFloat, x1: CGFloat, y0: CGFloat, y1: CGFloat, w: CGFloat, h: CGFloat)? {
    guard let rep = NSBitmapImageRep(data: png) else { return nil }
    let w = rep.pixelsWide, h = rep.pixelsHigh
    var hist: [String: Int] = [:]
    for y in stride(from: 0, to: h, by: 3) {
        for x in stride(from: 0, to: w, by: 3) {
            guard let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.5 else { continue }
            hist[String(format: "%.2f,%.2f,%.2f", c.redComponent, c.greenComponent, c.blueComponent),
                 default: 0] += 1
        }
    }
    guard let mode = hist.max(by: { $0.value < $1.value })?.key else { return nil }
    let p = mode.split(separator: ",").compactMap { Double($0) }
    guard p.count == 3 else { return nil }
    var x0 = w, x1 = -1, y0 = h, y1 = -1
    for y in 0..<h {
        for x in 0..<w {
            guard let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.5 else { continue }
            let d = abs(c.redComponent - p[0]) + abs(c.greenComponent - p[1])
                  + abs(c.blueComponent - p[2])
            if d > 0.07 {
                if x < x0 { x0 = x }; if x > x1 { x1 = x }
                if y < y0 { y0 = y }; if y > y1 { y1 = y }
            }
        }
    }
    guard x1 >= 0 else { return nil }
    return (CGFloat(x0) / scale, CGFloat(x1) / scale, CGFloat(y0) / scale, CGFloat(y1) / scale,
            CGFloat(w) / scale, CGFloat(h) / scale)
}

/// 系統給的高度上限（Apple HIG，verbatim）：
///   鎖屏 "The system may truncate a Live Activity on the Lock Screen if its height
///   exceeds 160 points (≈213 px)."
///   動態島展開 "The height of the extended view in the Dynamic Island can't exceed
///   144 points (≈192 px)"
///
/// 🔴 這兩個數字是外部常數，不是我手打的門檻——超過就是【使用者會看到上下緣被切掉】，
///    而不是「稍微擠了一點」。2026-08-17 使用者回報「通知卡片邊緣被卡掉了」的根因正是
///    等車卡自然高度 198–216pt、跟車卡 162–180pt，全部超過 160。
///    這支腳本以前【結構上照不到】：算繪時 height 傳 nil（自然高度、想長多高長多高），
///    而破版判定只比左右兩邊，上下一次都沒驗（原註解卻寫著「只驗左右與上下有沒有貼邊」）。
let lockScreenMaxHeight: CGFloat = 160
let islandExpandedMaxHeight: CGFloat = 144

@MainActor
func render<V: View>(_ view: V, width: CGFloat, maxHeight: CGFloat? = nil,
                     height: CGFloat? = nil, dark: Bool = true, mono: Bool = false,
                     inset: CGFloat = 13.5, to path: String) -> Data {
    let png = pngData(view, width: width, height: height, dark: dark, mono: mono)
    try! png.write(to: URL(fileURLWithPath: path))
    let name = (path as NSString).lastPathComponent
    guard let b = inkBounds(png, scale: 3) else {
        FileHandle.standardError.write(Data("破版：\\(name) 整張空白\\n".utf8)); exit(1)
    }
    var over: [String] = []
    // 鎖屏 LA 的內容區沒有系統 margins，版面自己帶 14pt ⇒ 量到 13.5 以內算貼齊。
    if b.x0 < inset { over.append("左 \\(b.x0) < \\(inset)") }
    if b.x1 > b.w - inset { over.append("右 \\(b.x1) > \\(b.w - inset)") }
    if !over.isEmpty {
        FileHandle.standardError.write(
            Data("破版：\\(name) 墨跡貼到卡片邊緣——\\(over.joined(separator: "、"))（圓角會裁掉）\\n".utf8))
        exit(1)
    }
    if let cap = maxHeight, b.h > cap {
        FileHandle.standardError.write(Data(
            "破版：\\(name) 高 \\(Int(b.h))pt 超過系統上限 \\(Int(cap))pt ⇒ 實機會被截掉上下緣\\n".utf8))
        exit(1)
    }
    let room = maxHeight.map { "，上限 \\(Int($0))、餘 \\(Int($0 - b.h))pt" } ?? ""
    print("寫出 \\(name)（\\(Int(b.w))×\\(Int(b.h)) pt @3x，墨跡 x \\(Int(b.x0))–\\(Int(b.x1))\\(room)）")
    return png
}

// ── gate ────────────────────────────────────────────────────────────────────

/// 🔴 gate：三種狀態在畫面上必須真的不一樣。
///
/// 設計稿：「狀態差異只做在三個地方：倒數的形態、軌脊上列車點的形狀、底部狀態詞。
/// 位置與版面完全不動」——「版面不動」很容易寫成「畫出來完全一樣」，而那時三個狀態
/// 在使用者眼裡就不存在了。判準是純畫面事實（PNG 位元組），不看實作。
@MainActor
func stateGate() {
    let shots: [(String, Data)] = [
        ("行駛中", pngData(RailFollowLockView(display: followRunning), width: 360, height: nil)),
        ("即將進站", pngData(RailFollowLockView(display: followArriving), width: 360, height: nil)),
        ("停靠中", pngData(RailFollowLockView(display: followStopping), width: 360, height: nil)),
    ]
    for i in shots.indices {
        for j in (i + 1)..<shots.count {
            if shots[i].1 == shots[j].1 {
                let msg = "狀態 gate 失敗：跟車卡的「\\(shots[i].0)」與「\\(shots[j].0)」"
                    + "算出【完全相同】的圖。設計稿要求狀態差異出現在倒數形態、軌脊圓點形狀"
                    + "與底部狀態詞三處，畫出來一樣就等於這三處都沒生效。\\n"
                FileHandle.standardError.write(Data(msg.utf8))
                exit(1)
            }
        }
    }
    // 單色模式也要分得出來：設計稿「每個狀態都必須另有形狀或文字備援」。
    //
    // 🔴 這裡量的是【軌脊那一顆單獨算繪】，不是整張卡：整張卡在單色下本來就會因為倒數文字
    //    （「4 分」vs「進站」）與底部狀態詞而不同 ⇒ 拿整張卡比，等於這道斷言對圓點的形狀
    //    恆真。把環的粗細改回三態一樣（真的發生過：三態原本只靠填色差異）也照樣全綠。
    let dots: [(String, Data)] = [
        ("行駛中", pngData(RailSpineTrack(phase: .running, lineColor: .blue), width: 120, height: 20, mono: true)),
        ("即將進站", pngData(RailSpineTrack(phase: .arriving, lineColor: .blue), width: 120, height: 20, mono: true)),
        ("停靠中", pngData(RailSpineTrack(phase: .stopping, lineColor: .blue), width: 120, height: 20, mono: true)),
    ]
    for i in dots.indices {
        for j in (i + 1)..<dots.count {
            if dots[i].1 == dots[j].1 {
                let msg = "狀態 gate 失敗：單色模式下軌脊圓點的「\\(dots[i].0)」與「\\(dots[j].0)」"
                    + "長得一模一樣。這三態在彩色下靠路線色／綠／白心區分，顏色被系統吃掉之後"
                    + "必須還有形狀（環的粗細）撐著。\\n"
                FileHandle.standardError.write(Data(msg.utf8))
                exit(1)
            }
        }
    }
    print("gate 通過：跟車三態互不相同，單色模式下軌脊圓點三態靠形狀仍分得出來")
}

/// 🔴 gate：資料過期是唯一會拿掉主角數字的狀態（設計稿）。
///
/// 純資料斷言：90 秒是分界，過期的卡不准還印著一個不再變動的數字
/// （設計稿：「留著一個不再變動的『2 分』比空白更危險」）。
func expiryGate() {
    // 🔴 門檻【寫死成設計稿的 90】，不讀 MetroWaitDisplay.expirySeconds：讀它就是讓受測物
    //    自己供判準——把常數改成 1e9（永不過期）時，fixture 的資料齡也跟著變成 1e9+1，
    //    這道 gate 照樣全綠（突變測試實測）。常數本身另外用等值斷言守。
    if MetroWaitDisplay.expirySeconds != 90 {
        FileHandle.standardError.write(Data(
            "過期 gate 失敗：捷運的過期門檻被改成 \\(MetroWaitDisplay.expirySeconds) 秒，設計稿是 90\\n".utf8))
        exit(1)
    }
    let fresh = wait(secondsToArrive: 40, dataAgeSec: 8)
    let stale = wait(secondsToArrive: 40, dataAgeSec: 91)
    if fresh.countdown == .noData {
        FileHandle.standardError.write(Data("過期 gate 失敗：資料才 8 秒就被判成過期\\n".utf8))
        exit(1)
    }
    if stale.countdown != .noData || !stale.expired {
        let msg = "過期 gate 失敗：資料已經 91 秒，"
            + "主角倒數卻還是 \\(stale.countdown.plainText)。設計稿：超過 90 秒沒有新資料"
            + "就換成「暫無資料」並整卡降級——"
            + "留著一個不再變動的數字比空白更危險。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // 而「到站」不是「過期」：兩者共用一個視覺就分不出「車來了」與「我看到的是舊的」。
    let arrived = wait(secondsToArrive: 0, isStale: true, dataAgeSec: 200)
    if arrived.countdown != .arriving || arrived.expired {
        FileHandle.standardError.write(Data(
            "過期 gate 失敗：列車進站被畫成資料過期（isStale 的語意是「車到了」不是「資料舊了」）\\n".utf8))
        exit(1)
    }
    // 跟車卡那側：沒有 dataAt，用「到站時刻已經過去這麼久」當代理（見 staleGraceSeconds）。
    if RailFollowDisplay.staleGraceSeconds != 150 {
        FileHandle.standardError.write(Data(
            "過期 gate 失敗：跟車卡的過站寬限被改成 \\(RailFollowDisplay.staleGraceSeconds) 秒（訂為 150）\\n".utf8))
        exit(1)
    }
    let late = follow(minutesToArrive: -3)
    if late.countdown != .noData || late.stateWord != "資料未更新" || late.phase == .arriving {
        let msg = "過期 gate 失敗：跟車卡的到站時刻已經過去 180 秒而沒有新推播，"
            + "主角卻還是 \\(late.countdown?.plainText ?? "nil")／狀態詞「\\(late.stateWord)」。"
            + "手上這份必定是舊的，不可以繼續宣稱車還在跑。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // 而剛好過站一點點不算過期（臺鐵 ETA 分鐘級＋到站推播有延遲，太敏感會誤報）。
    let justPassed = follow(minutesToArrive: -0.5)
    if justPassed.countdown == .noData {
        FileHandle.standardError.write(Data(
            "過期 gate 失敗：跟車卡才過站 30 秒就被判成資料過期（寬限是 150 秒）\\n".utf8))
        exit(1)
    }
    print("gate 通過：90 秒界線兩側可分辨，「車進站」不會被誤畫成「資料過期」，跟車卡的過站寬限也對")
}

/// 🔴 gate：臺鐵不准畫秒數（TDX 是分鐘級），捷運不准畫 m:ss。
///
/// 設計稿：「『1:30』這種 m:ss 在候車情境會被誤讀成 1 小時 30 分」。RailCountdown 型別上
/// 根本沒有 m:ss 這個 case，這道 gate 守的是另一半——臺鐵那側不足一分鐘要收斂成「進站」，
/// 不是「37 秒」（把 ±2 分的推估講成秒級精度）。
func precisionGate() {
    let nearly = follow(minutesToArrive: 0.6)
    if nearly.countdown != .arriving {
        let msg = "精度 gate 失敗：臺鐵在剩 36 秒時畫了 \\(nearly.countdown?.plainText ?? "nil")。"
            + "TDX 的 ETA 是分鐘級，畫秒數是假精度 ⇒ 不足一分鐘一律收斂成「進站」。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // 🔴 捷運那半移到 liveCountdownGate()：改版後捷運的倒數是自走的（「.until」），
    //    「有沒有畫到秒」問列舉的形狀已經問不出來——形狀只說「交給系統」。
    //    那邊改問系統實際算出來的字串，順便把「會不會自己走」一起量了。
    print("gate 通過：臺鐵不足一分鐘收斂成「進站」（捷運那半見 liveCountdownGate）")
}

/// 自走倒數在某個時刻【使用者實際看到的那串字】。
///
/// 🔴 判準取系統算出來的字串、不取列舉的形狀：「.until」 只說「交給系統算」，說不出使用者
///    看到的是幾——把期望值寫成 「== .until」 就只是覆述實作，連「秒數被畫成分鐘」都攔不到。
///    這裡與版面共用同一個 format style（「railLiveCountdownStyle」），但字串的【值】是
///    Foundation 算的，不是判準自己算的。
@available(macOS 15.0, *)
func liveShown(_ c: RailCountdown, at t: Date) -> String? {
    guard case .until(let d) = c else { return nil }
    return String(railLiveCountdownStyle(until: d).format(t).characters)
}

/// 🔴 gate：等車卡上使用者看得到的倒數，必須真的會隨時間改變。
///
/// 這是 2026-08-19 那個缺陷的判準化。08-17 的小工具改版把倒數折成【組 ContentState 當下】
/// 算好的死數字（「.seconds(52)」），而 Live Activity 的視圖只在收到新 ContentState 時重繪
/// ⇒ 鎖屏上的秒數整段不動。伺服器那側的遲滯不是元兇也不該改：worker 的註解白紙黑字寫著
/// 「卡片的 Text(timerInterval:) 本來就自己在走」——改版讓那個前提失效，修法在客戶端。
///
/// 判準不問「型別是不是 「.until」」，問「同一張卡在 t 與 t+N 秒看到的字一不一樣」。
@MainActor
func liveCountdownGate() {
    func fail(_ msg: String) -> Never {
        FileHandle.standardError.write(Data(("自走倒數 gate 失敗：" + msg + "\\n").utf8))
        exit(1)
    }
    guard #available(macOS 15.0, *) else {
        fail("這台 macOS < 15，量不到自走倒數的字串。判準沒跑到就不算通過")
    }
    // 主角：官方是秒級絕對時刻 ⇒ 不足一分鐘要真的看得到秒（設計稿的示範就是「52 秒」）。
    let metro = wait(secondsToArrive: 52)
    guard let sec0 = liveShown(metro.countdown, at: now) else {
        fail("捷運主角在剩 52 秒時畫的是「\\(metro.countdown.plainText)」——那是算繪當下折好的"
           + "死數字，卡片在下一次推播之前不會重繪，鎖屏上會整段不動")
    }
    if !sec0.contains("秒") {
        fail("捷運主角在剩 52 秒時顯示「\\(sec0)」。官方給的是秒級絕對時刻，這裡不准收斂成分鐘")
    }
    guard let sec1 = liveShown(metro.countdown, at: now.addingTimeInterval(50)) else {
        fail("捷運主角倒數在 50 秒後算不出字串")
    }
    // 「會自己走」的可觀測定義：同一張卡、不同時刻，字串必須不同。
    if sec0 == sec1 {
        fail("捷運主角倒數過了 50 秒仍然是「\\(sec0)」——這個倒數不會自己走")
    }
    // 分鐘區間：畫「N 分鐘」，不准出現 m:ss（設計稿：「1:30」在候車情境會被讀成 1 小時 30 分）。
    let metroMin = wait(secondsToArrive: 195)
    guard let min0 = liveShown(metroMin.countdown, at: now) else {
        fail("捷運主角在剩 195 秒時不是自走倒數（畫的是「\\(metroMin.countdown.plainText)」）")
    }
    if !min0.contains("分") || min0.contains(":") {
        fail("捷運主角在剩 195 秒時顯示「\\(min0)」——分鐘區間要畫「N 分鐘」，不准 m:ss")
    }
    // 🔴 第三層那一句的倒數也要自走。它同樣是官方絕對時刻，而改版前是被【拼進一整串
    //    String】裡的——句子裡的死數字比主角那個大數字更不容易被發現。
    guard let second = metro.second else { fail("fixture 沒有次班，這道 gate 量不到第三層") }
    guard let sn0 = liveShown(second.countdown, at: now),
          let sn1 = liveShown(second.countdown, at: now.addingTimeInterval(80)) else {
        fail("第三層「再下一班」的倒數不是自走的（畫的是「\\(second.countdown.plainText)」）")
    }
    if sn0 == sn1 {
        fail("第三層「再下一班」的倒數過了 80 秒仍然是「\\(sn0)」——它不會自己走")
    }
    // 🔴 反向對照：整數分鐘系統（高捷／機捷）刻意【不】自走。官方只給「約 N 分」，沒有絕對
    //    時刻可錨，硬換算成逐秒倒數就是製造假精度。把它釘成明示的例外，免得日後被當成
    //    漏網之魚一起「修掉」；也讓上面那幾條不會被「乾脆全部都自走」矇混過關。
    if liveShown(waitApprox.countdown, at: now) != nil {
        fail("整數分鐘系統被畫成秒級自走倒數——官方只給「約 N 分」，那是假精度")
    }
    // 🔴 動態島 minimal 那顆圓：不足一分鐘要與改版前的「.seconds」畫得【完全一樣】
    //    （實心綠、不塞字）。設計稿：「形狀本身就是狀態，不必塞字」。
    //    只驗字串的話，把「快到了＝實心綠」整個拿掉（環一路空心到進站）照樣全綠
    //    ——改版把 <60 秒從 .seconds 換成 .until，那個訊號是最容易無聲掉的一個。
    let ringColor = Color(.sRGB, red: 0, green: 0.44, blue: 0.74)
    let soon = pngData(RailIslandMinimal(countdown: .until(now.addingTimeInterval(40)), color: ringColor),
                       width: 30, height: 30)
    let asSeconds = pngData(RailIslandMinimal(countdown: .seconds(40), color: ringColor),
                            width: 30, height: 30)
    let far = pngData(RailIslandMinimal(countdown: .until(now.addingTimeInterval(195)), color: ringColor),
                      width: 30, height: 30)
    if soon != asSeconds {
        fail("動態島 minimal：不足一分鐘的自走倒數畫得跟改版前的「40 秒」不一樣"
           + "——「快到了＝實心綠、不塞字」這個訊號掉了")
    }
    if soon == far {
        fail("動態島 minimal：不足一分鐘與還有三分鐘畫成同一張圖——那顆圓不再說得出狀態")
    }
    print("gate 通過：等車卡主角與第三層的倒數都會自己走（52 秒→秒、195 秒→分鐘），"
        + "整數分鐘系統維持「約 N 分」不假裝有秒級精度，"
        + "動態島 minimal 不足一分鐘仍是實心綠")
}

// 鎖屏 Live Activity 的內容寬：430pt 機型約 360pt，393pt 機型約 330pt。
// 動態島展開版約 360pt 寬。
@main
struct Harness {
    @MainActor
    static func main() {
        let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        stateGate()
        expiryGate()
        precisionGate()
        liveCountdownGate()

        // 臺鐵跟車：三態＋準點＋中斷＋最壞值
        _ = render(RailFollowLockView(display: followRunning), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-running.png")
        _ = render(RailFollowLockView(display: followArriving), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-arriving.png")
        _ = render(RailFollowLockView(display: followStopping), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-stopping.png")
        _ = render(RailFollowLockView(display: followOnTime), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-ontime.png")
        _ = render(RailFollowLockView(display: followNotice), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-notice.png")
        _ = render(RailFollowLockView(display: followStale), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-stale.png")
        _ = render(RailFollowLockView(display: followWorst), width: 330, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-follow-worst-393.png")
        _ = render(RailFollowLockView(display: followArriving), width: 360, maxHeight: lockScreenMaxHeight, mono: true,
                   to: outDir + "/la-follow-arriving-mono.png")

        // 捷運候車：正常／進站／未接推播／過期／整數分鐘／最壞值
        _ = render(MetroWaitLockView(display: waitNormal), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-normal.png")
        _ = render(MetroWaitLockView(display: waitMinutes), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-minutes.png")
        _ = render(MetroWaitLockView(display: waitArriving), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-arriving.png")
        _ = render(MetroWaitLockView(display: waitArrivingNoPush), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-arriving-nopush.png")
        _ = render(MetroWaitLockView(display: waitExpired), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-expired.png")
        _ = render(MetroWaitLockView(display: waitApprox), width: 360, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-approx.png")
        _ = render(MetroWaitLockView(display: waitWorst), width: 330, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-worst-393.png")
        // 🔴 300pt 比任何在賣的機型都窄（最窄的 iPhone 13 mini 內容區約 315pt）。
        //    等車卡在 360pt 只剩 3pt 餘裕，而【變窄會讓字折行、折行就長高】⇒ 只掃 360/330
        //    等於把最容易破的方向留在盲區。這兩張是安全邊界，不是機型。
        _ = render(MetroWaitLockView(display: waitNormal), width: 300, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-normal-narrow300.png")
        _ = render(MetroWaitLockView(display: waitWorst), width: 300, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-wait-worst-narrow300.png")

        // 動態島展開版的下半（識別列由 region builder 提供，那一層 ActivityKit only）。
        // 島上沒有 14pt 邊距，內縮只有 10pt ⇒ inset 放寬到 9.5。
        _ = render(RailFollowIslandBottom(display: followRunning), width: 360, maxHeight: islandExpandedMaxHeight, inset: 9.5,
                   to: outDir + "/island-follow-bottom.png")
        _ = render(RailFollowIslandBottom(display: followStopping), width: 360, maxHeight: islandExpandedMaxHeight, inset: 9.5,
                   to: outDir + "/island-follow-bottom-stopping.png")
        _ = render(MetroWaitIslandBottom(display: waitNormal), width: 360, maxHeight: islandExpandedMaxHeight, inset: 9.5,
                   to: outDir + "/island-wait-bottom.png")
        _ = render(MetroWaitIslandBottom(display: waitWorst), width: 360, maxHeight: islandExpandedMaxHeight, inset: 9.5,
                   to: outDir + "/island-wait-bottom-worst.png")
        // 進站時島上捨棄「再下一班」保住擁擠度（見 MetroWaitIslandBottom 的註解）。
        _ = render(MetroWaitIslandBottom(display: waitArriving), width: 360, maxHeight: islandExpandedMaxHeight, inset: 9.5,
                   to: outDir + "/island-wait-bottom-arriving.png")

        // minimal：只剩一顆圓（22pt）。四種形態各一張，證明「只剩一顆圓時仍答得出
        // 哪條線、還有幾分」。
        // 🔴 「.until」兩張都要有：等車卡改成自走倒數之後，minimal 走的就是這條路徑
        //    ——「環裡塞得下系統給的整串字嗎」與「不足一分鐘還是不是實心綠」都只有
        //    真的算繪一次才看得到（live 是空心＋自走字，livesoon 是實心＋不塞字）。
        for (name, value) in [("min", RailCountdown.minutes(3)),
                              ("approx", RailCountdown.approxMinutes(12)),
                              ("sec", RailCountdown.seconds(40)),
                              ("live", RailCountdown.until(now.addingTimeInterval(195))),
                              ("livesoon", RailCountdown.until(now.addingTimeInterval(40))),
                              ("nodata", RailCountdown.noData)] {
            _ = render(RailIslandMinimal(countdown: value, color: Color(.sRGB, red: 0, green: 0.44, blue: 0.74))
                        .frame(width: 22, height: 22).padding(4),
                       width: 30, inset: 0, to: outDir + "/island-minimal-\\(name).png")
        }
    }
}
`;

mkdirSync(outDir, { recursive: true });
const swiftPath = join(outDir, 'harness.swift');
const binPath = join(outDir, 'harness');
writeFileSync(swiftPath, harness);

execFileSync('swiftc', ['-O', '-parse-as-library', swiftPath, kitPath, '-o', binPath], { stdio: 'inherit' });
execFileSync(binPath, [outDir], { stdio: 'inherit' });
