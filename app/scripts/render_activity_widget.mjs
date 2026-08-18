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
// 🔴 這個檔【不在】widget 目錄裡：它同屬 App 與 widget extension 兩個 target，是
//    「設 staleDate 的那側」與「畫過期樣式的那側」唯一的共同祖先。把它抽進來，這支
//    harness 驗到的就是出貨路徑真正用的那個常數與算式，而不是 harness 自己抄的一份。
const attrSource = readFileSync(resolve(here, '../ios/App/App/RailFollowAttributes.swift'), 'utf8');

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

const pieces = [
  extractDeclaration(dataSource, 'enum RailBoardClock'),
  extractDeclaration(attrSource, 'enum RailFollowStale'),
  extractDeclaration(followSource, 'struct RailFollowDisplay'),
  extractDeclaration(followSource, 'struct RailFollowLockView'),
  extractDeclaration(followSource, 'struct RailFollowIslandBottom'),
  extractDeclaration(waitSource, 'struct MetroWaitDisplay'),
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
            prevStop: String? = "臺北", notice: String? = nil,
            isStale: Bool = false) -> RailFollowDisplay {
    RailFollowDisplay.make(
        kind: "自強", trainNo: "420", colorHex: "#C0392B", terminus: "臺東",
        nextStop: "板橋", prevStop: prevStop,
        arrivalDate: nowSec + minutesToArrive * 60,
        departedDate: nowSec - 7 * 60,
        delaySec: delaySec, stopping: stopping, notice: notice,
        isStale: isStale, now: now)
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
    delaySec: 1_260, stopping: false, notice: nil, isStale: false, now: now)

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
    // 跟車卡那側：沒有 dataAt，用「到站時刻已經過去這麼久」當代理（見 RailFollowStale）。
    if RailFollowStale.graceSeconds != 150 {
        FileHandle.standardError.write(Data(
            "過期 gate 失敗：跟車卡的過站寬限被改成 \\(RailFollowStale.graceSeconds) 秒（訂為 150）\\n".utf8))
        exit(1)
    }
    // 🔴 版面讀的必須【就是】那顆共享常數：把 RailFollowDisplay.staleGraceSeconds 改回自己的
    //    字面值時，上面那條照樣全綠（它問的是共享常數），而 plugin 設的 staleDate 與版面畫的
    //    過期界線就此各走各的——症狀是卡片在「系統說過期」與「版面說還在跑」之間打架。
    if RailFollowDisplay.staleGraceSeconds != RailFollowStale.graceSeconds {
        let msg = "過期 gate 失敗：版面的寬限（\\(RailFollowDisplay.staleGraceSeconds)）與 plugin／後端"
            + "共用的 RailFollowStale.graceSeconds（\\(RailFollowStale.graceSeconds)）不是同一個值\\n"
        FileHandle.standardError.write(Data(msg.utf8))
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

/// 🔴 gate：零推播時，卡片要靠 ActivityKit 的 staleDate 自己脫困。
///
/// 守的是【三方共用同一個約定】：plugin 設 staleDate、後端 worker 送 stale-date、版面畫過期樣式。
/// 前兩者不在這支 harness 的編譯範圍（一個要 ActivityKit、一個是 JS），所以這裡驗它們共同依賴
/// 的那個算式，以及「旗標翻真時版面真的會變」——後者是整個修法的意義所在：staleDate 到期會
/// 讓系統重繪一次，如果那一次重繪畫出來的東西跟原本一樣，這個機制等於沒接上。
func staleDateGate() {
    let base = Date(timeIntervalSince1970: 1_800_000_000)
    let grace = RailFollowStale.graceSeconds
    let cap = RailFollowStale.orphanFallbackSeconds

    // (1) 有 ETA ⇒ 到站再過寬限。
    let withEta = RailFollowStale.date(arrival: base.timeIntervalSince1970 + 600, now: base)
    if abs(withEta.timeIntervalSince(base) - (600 + grace)) > 0.001 {
        let msg = "staleDate gate 失敗：到站在 600 秒後，保鮮期卻算成 \\(withEta.timeIntervalSince(base)) 秒"
            + "（該是 600＋\\(grace)）\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // (2) 算不出 ETA ⇒ 退回孤兒兜底，【不是】沒有保鮮期。少了它，App 被系統終止後遺留的卡
    //     會永遠留在鎖定畫面上。
    let noEta = RailFollowStale.date(arrival: nil, now: base)
    if abs(noEta.timeIntervalSince(base) - cap) > 0.001 {
        let msg = "staleDate gate 失敗：算不出 ETA 時的保鮮期是 \\(noEta.timeIntervalSince(base)) 秒，"
            + "該是孤兒兜底的 \\(cap) 秒\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // (3) 遠得離譜的到站時刻（資料異常）不可以把孤兒保護頂過去。
    let absurd = RailFollowStale.date(arrival: base.timeIntervalSince1970 + 30 * 24 * 3600, now: base)
    if absurd.timeIntervalSince(base) > cap {
        let msg = "staleDate gate 失敗：到站時刻在 30 天後時，保鮮期被拉到 \\(absurd.timeIntervalSince(base)) 秒，"
            + "超過孤兒兜底的上界 \\(cap)\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }

    // (4) 旗標翻真 ⇒ 主角數字必須消失。
    //     🔴 到站【還在未來】：這正是實機那個畫面——推播斷了，倒數卻還在自己往下走，
    //     走到 0 就凍在「0 秒／行駛中」。版面手上唯一知道「沒有新資料」的證據就是這個旗標。
    let stalled = follow(minutesToArrive: 3, isStale: true)
    if stalled.countdown != .noData || stalled.stateWord != "資料未更新" || !stalled.expired {
        let msg = "staleDate gate 失敗：系統已經把這張卡標成過期（isStale），"
            + "版面卻還畫著 \\(stalled.countdown?.plainText ?? "nil")／狀態詞「\\(stalled.stateWord)」。"
            + "staleDate 到期那一次重繪什麼都沒改變＝這個機制沒有接上。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // (5) 反向對照：除了 isStale 之外【逐格相同】的那一張必須還是正常的倒數。
    //     少了這一條，「乾脆全部畫成資料未更新」也會讓上面那條全綠。
    let live = follow(minutesToArrive: 3, isStale: false)
    if live.countdown == .noData || live.stateWord != "行駛中" || live.expired {
        let msg = "staleDate gate 失敗：沒有被標成過期的卡也被畫成"
            + "\\(live.countdown?.plainText ?? "nil")／「\\(live.stateWord)」"
            + "——過期樣式吃掉了正常狀態\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    print("gate 通過：staleDate 的算式三種情況都對，旗標翻真時版面真的換成「資料未更新」")
}

/// 🔴 gate：動態島 minimal 的那一顆圓，在倒數走完之後不可以是空的。
///
/// 用像素量，不看程式碼：until 那個 case 的自走文字只畫在「還沒到站」的前提下，而環裡的
/// 靜態字對它固定是 nil ⇒ 倒數走完之後那一顆圓【既沒有數字也沒有實心】。這種空白在型別層與
/// computed 值上都照不出來，只有真的畫一次、量中心那幾個像素才看得見。
@MainActor
func minimalArrivedGate() {
    let blue = Color(.sRGB, red: 0, green: 0.44, blue: 0.74)
    // 🔴 判準是【填色面積】不是中心那一點：中心會被自走文字蓋住，於是「量中心」實際上量的是
    //    「有沒有字」而不是「實不實心」——第一版就是這樣寫的，把 solid 改成恆真的突變照樣全綠
    //    （實測）。改數整張圖裡有多少像素是那個進站綠：實心≈整個圓，空心環≈零（環是路線色）。
    func shot(_ cd: RailCountdown) -> NSBitmapImageRep {
        let png = pngData(RailIslandMinimal(countdown: cd, color: blue)
                            .frame(width: 22, height: 22).padding(4),
                          width: 30, height: nil)
        guard let rep = NSBitmapImageRep(data: png) else {
            FileHandle.standardError.write(Data("minimal gate 失敗：算繪不出點陣圖\\n".utf8)); exit(1)
        }
        return rep
    }
    /// 進站綠取自 .arriving 自己的圓心，不硬編色碼 ⇒ 改配色不會讓這道 gate 假紅。
    let ref = shot(.arriving)
    guard let refColor = ref.colorAt(x: ref.pixelsWide / 2, y: ref.pixelsHigh / 2),
          // 角落一定是底色（元件外圍有 padding），拿它當「這顆圓到底有沒有填色」的外部參照。
          let bgColor = ref.colorAt(x: 3, y: 3) else {
        FileHandle.standardError.write(Data("minimal gate 失敗：取不到「進站」的基準色\\n".utf8)); exit(1)
    }
    // 🔴 基準色是從受測物自己身上取的 ⇒ 受測物整個壞掉時它會退化成底色，而「數出一堆同色像素」
    //    看起來仍然很正常（實測：把 solid 改成恆假，三張圖的「綠像素」全變成背景像素數，
    //    下面兩條比較照樣有數字可比，紅在錯的條款上）。所以先用一個【與受測物無關】的事實把關：
    //    圓心與角落底色必須明顯不同，否則這張圖上根本沒有一顆填了色的圓。
    let refVsBg = abs(refColor.redComponent - bgColor.redComponent)
                + abs(refColor.greenComponent - bgColor.greenComponent)
                + abs(refColor.blueComponent - bgColor.blueComponent)
    if refVsBg < 0.3 {
        let msg = "minimal gate 失敗：「進站」那一顆的圓心與角落底色幾乎同色（色差 \\(refVsBg)）"
            + "——實心圓根本沒畫出來，接下來的像素比較全是在數背景\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    func greenPixels(_ rep: NSBitmapImageRep) -> Int {
        var n = 0
        for y in 0..<rep.pixelsHigh {
            for x in 0..<rep.pixelsWide {
                guard let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.5 else { continue }
                let d = abs(c.redComponent - refColor.redComponent)
                      + abs(c.greenComponent - refColor.greenComponent)
                      + abs(c.blueComponent - refColor.blueComponent)
                if d < 0.12 { n += 1 }
            }
        }
        return n
    }
    let total = ref.pixelsWide * ref.pixelsHigh
    let arriving = greenPixels(ref)
    let passed = greenPixels(shot(.until(Date().addingTimeInterval(-30))))
    let future = greenPixels(shot(.until(Date().addingTimeInterval(600))))

    // (0) 正向對照：基準本身要真的是一顆實心圓。少了這條，「三張都是空白」也會讓下面兩條成立。
    //     下界從幾何推導（22pt 的圓佔 30pt 見方畫布約 42%），取一半當保守門檻，不是手打的數字。
    if Double(arriving) < Double(total) * 0.21 {
        let msg = "minimal gate 失敗：「進站」那一顆根本不是實心圓（綠像素 \\(arriving)/\\(total)）"
            + "——基準壞了，下面兩條的比較沒有意義\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // (1) 倒數走完＝車到了，與 .arriving 同一顆實心（形狀本身就是狀態，不必也放不下字）。
    if Double(passed) < Double(arriving) * 0.85 {
        let msg = "minimal gate 失敗：倒數走完的那一顆圓只有 \\(passed) 個進站綠像素，"
            + "「進站」那一顆有 \\(arriving) 個——舊碼在這裡什麼都不畫，環裡是空的\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    // (2) 反向對照：還沒到站的那一顆【不可以】也是實心，否則上面那條用「一律畫實心」就能通過。
    if Double(future) > Double(arriving) * 0.15 {
        let msg = "minimal gate 失敗：還有 10 分鐘的那一顆圓有 \\(future) 個進站綠像素"
            + "（「進站」是 \\(arriving)）——實心色塊吃掉了「還在等」這個狀態\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    print("gate 通過：minimal 的圓在倒數走完後畫成「進站」實心（\\(passed)/\\(arriving) 綠像素），"
          + "還沒到站時仍是空心環（\\(future)）")
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
    let metro = wait(secondsToArrive: 52)
    if metro.countdown != .seconds(52) {
        let msg = "精度 gate 失敗：捷運在剩 52 秒時畫了 \\(metro.countdown.plainText)，"
            + "而官方給的是秒級絕對時刻（設計稿的示範就是「52 秒」）。\\n"
        FileHandle.standardError.write(Data(msg.utf8))
        exit(1)
    }
    print("gate 通過：臺鐵不足一分鐘收斂成「進站」，捷運照官方秒級顯示秒")
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
        staleDateGate()
        minimalArrivedGate()
        precisionGate()

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
        for (name, value) in [("min", RailCountdown.minutes(3)),
                              ("approx", RailCountdown.approxMinutes(12)),
                              ("sec", RailCountdown.seconds(40)),
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
