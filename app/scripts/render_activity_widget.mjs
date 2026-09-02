#!/usr/bin/env node
// 把三張 Live Activity（臺鐵跟車、捷運候車、臺鐵等站）與動態島的版面算繪成 PNG。
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
const nativeL10nPath = join(widgetDir, 'RailNativeL10n.swift');

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
const traSource = readFileSync(join(widgetDir, 'TraWaitActivity.swift'), 'utf8');
// 🔴 這個檔【不在】widget 目錄裡：它同屬 App 與 widget extension 兩個 target，是
//    「設 staleDate 的那側」與「畫過期樣式的那側」唯一的共同祖先。把它抽進來，這支
//    harness 驗到的就是出貨路徑真正用的那個常數與算式，而不是 harness 自己抄的一份。
const attrSource = readFileSync(resolve(here, '../ios/App/App/RailFollowAttributes.swift'), 'utf8');
// 同上：等站卡的保鮮期常數住在雙 target 的 TraWaitAttributes.swift，是「設 staleDate 的那側」
// 與「畫過期樣式的那側」唯一的共同祖先。
const traAttrSource = readFileSync(resolve(here, '../ios/App/App/TraWaitAttributes.swift'), 'utf8');

/**
 * 🔴 原始碼層 gate：harness 用替身畫「結束」鈕，所以它照不到 intent 有沒有真的接上。
 * 少接 intent 的症狀是「按鈕畫得出來但按了沒反應」——算繪全綠、真機無效。
 */
function intentGate() {
  const bad = [];
  // 🔴 不用「字串出現過就算」：突變測試實測到，兩個呼叫點只改壞一個時，另一個還在
  //    ⇒ 存在性檢查照樣全綠。Live Activity 的鎖屏跑不了任意 closure，`Button(action:)`
  //    在那裡【一定】是死鈕，所以判準是「這兩個檔裡的每一顆 Button 都得吃 intent」。
  for (const [name, src] of [['跟車卡', followSource], ['候車卡', waitSource], ['等站卡', traSource]]) {
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
  if (!traSource.includes('TraWaitEndIntent')) {
    bad.push('等站卡完全沒有 TraWaitEndIntent（「結束」鈕收不掉卡）');
  }
  for (const [name, src, needle] of [
    ['等車卡', waitSource, 'struct MetroWaitEndButton'],
    ['跟車卡', followSource, 'RailFollowDisplay.make('],
    ['等車卡', waitSource, 'MetroWaitDisplay.make('],
    ['等站卡', traSource, 'struct TraWaitEndButton'],
    ['等站卡', traSource, 'TraWaitDisplay.make('],
  ]) {
    if (!src.includes(needle)) bad.push(`${name}少了 ${needle}`);
  }
  if (bad.length) throw new Error('intent gate 失敗：\n' + bad.map((b) => '  ' + b).join('\n'));
  console.log('gate 通過：三張卡都走 make(...) 唯一入口，「結束」鈕真的接上 intent');
}

intentGate();

/**
 * 🔴 原始碼層 gate：Dynamic Island 的 bottom region 沒有替 44pt 級圓角保留安全區。
 * 1.5.0(80) 真機取證證明 10pt 會把「結束」鈕送進右側斜切區；三種卡與三種語言都必須
 * 共用完整 22pt 內縮。PNG gate 再以 21.5pt 墨跡界線驗實際輸出。
 */
function expandedIslandSafeInsetGate() {
  const bad = [];
  for (const [name, src, header] of [
    ['跟車卡', followSource, 'struct RailFollowIslandBottom'],
    ['捷運等車卡', waitSource, 'struct MetroWaitIslandBottom'],
    ['台鐵等站卡', traSource, 'struct TraWaitIslandBottom'],
  ]) {
    const body = extractDeclaration(src, header);
    if (!body.includes('.padding(.horizontal, scale.pt(22))')) {
      bad.push(`${name}沒有 22pt Dynamic Island 圓角安全內距`);
    }
  }
  for (const [name, src, header] of [
    ['捷運等車卡', waitSource, 'struct MetroWaitEndButton'],
    ['台鐵等站卡', traSource, 'struct TraWaitEndButton'],
  ]) {
    const body = extractDeclaration(src, header);
    if (!body.includes('.fixedSize(horizontal: true, vertical: false)')) {
      bad.push(`${name}的結束按鈕仍可被長文字壓到零寬`);
    }
  }
  if (bad.length) throw new Error('動態島安全內距 gate 失敗：\n' + bad.map((b) => '  ' + b).join('\n'));
  console.log('gate 通過：三張 Live Activity 的展開動態島都保留 22pt 圓角安全內距');
}

expandedIslandSafeInsetGate();

/**
 * 🔴 原始碼層 gate：算繪一律把軌道畫成靜態（理由見 pngData），所以它照不到
 * 「出貨路徑有沒有真的傳 interval 進去」——少傳的症狀是真機上那條唯一會動的填色條不動，
 * 而 26 張圖全部照樣長得一樣。順便守住哨兵不可以被寫進出貨程式碼。
 */
function staticProgressGate() {
  const bad = [];
  for (const [name, src] of [['跟車卡', followSource], ['候車卡', waitSource], ['等站卡', traSource]]) {
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
  console.log('gate 通過：三張卡的軌道都吃 display.track（算繪走靜態版只是為了看得見）');
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
  for (const [name, src] of [['跟車卡', followSource], ['候車卡', waitSource], ['等站卡', traSource]]) {
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
  console.log('gate 通過：三張 Live Activity 都沒有把倒數折成死數字（一律 .until 自走）');
}

selfRunningCountdownGate();

/**
 * 🔴 原始碼層 gate：等站卡【一個自走文字都不准有】。
 *
 * 精度紅線（memory: `tra-thsr-no-official-eta`）：臺鐵官方只有表定時刻與誤點分鐘，
 * 沒有預估到站、更沒有秒級精度。任何「自己往前跑」的文字（RailCountdownText／
 * `Text(.currentDate, format:)`／`style: .relative`／`timerInterval:`）都是在把
 * 官方沒說過的精度畫給使用者看——而且畫得越像真的越危險。
 *
 * 🔴 這道 gate 與 selfRunningCountdownGate 剛好【方向相反】：那一道要求捷運與跟車卡
 *    的倒數【必須】自走（不准折成死數字），這一道要求等站卡【完全不准】自走。
 *    兩張卡的官方資料精度不同，判準也就不可能是同一條——把兩者混成一條的症狀是
 *    有一邊永遠被放行。值層另有 traStaticTextGate() 從渲染輸出反向掃一次。
 */
function traNoSelfRunningTextGate() {
  const bad = [];
  // 只看程式碼行：檔頭的精度紅線註解裡就逐一列著這些名字在解釋為什麼不用它們。
  const code = traSource.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const [needle, why] of [
    ['RailCountdownText', '那是自走倒數元件'],
    ['Text(.currentDate', '那會讓系統自己重排時間文字'],
    ['style: .relative', '那是「還有 N 分」的相對時間文字'],
    ['timerInterval:', '那是自走的計時文字／進度條'],
    ['RailCountdown', '整個倒數型別在這張卡上都沒有立足點（主角是鐘面時刻）'],
  ]) {
    const hits = code.split(needle).length - 1;
    if (hits) {
      bad.push(`等站卡出現 ${hits} 處 ${needle}——${why}；`
             + '臺鐵官方只有表定與誤點分鐘，秒級倒數是在製造官方沒有的精度');
    }
  }
  // 🔴 正向對照：上面五條全是「不可以有」，五個 needle 一起打錯字時整道 gate 會恆綠。
  //    這一條證明我們掃的是一個真的有內容、而且真的畫了主角時刻的檔。
  if (!code.includes('display.heroText')) {
    bad.push('等站卡的版面根本沒畫 display.heroText——這道 gate 掃的檔不對，上面五條沒有意義');
  }
  if (bad.length) throw new Error('等站卡自走文字 gate 失敗：\n' + bad.map((b) => '  ' + b).join('\n'));
  console.log('gate 通過：等站卡一個自走文字都沒有（主角是官方值算出來的鐘面時刻）');
}

traNoSelfRunningTextGate();

const pieces = [
  extractDeclaration(dataSource, 'enum RailBoardClock'),
  extractDeclaration(attrSource, 'enum RailFollowStale'),
  extractDeclaration(followSource, 'struct RailFollowDisplay'),
  extractDeclaration(followSource, 'struct RailFollowLockView'),
  extractDeclaration(followSource, 'struct RailFollowIslandBottom'),
  extractDeclaration(waitSource, 'struct MetroWaitDisplay'),
  extractDeclaration(waitSource, 'struct MetroWaitSecondLine'),
  extractDeclaration(waitSource, 'struct MetroWaitLockView'),
  extractDeclaration(waitSource, 'struct MetroWaitIslandBottom'),
  extractDeclaration(waitSource, 'struct RailIslandMinimal'),
  extractDeclaration(traAttrSource, 'enum TraWaitStale'),
  extractDeclaration(traSource, 'struct TraWaitDisplay'),
  extractDeclaration(traSource, 'struct TraWaitLockView'),
  extractDeclaration(traSource, 'struct TraWaitIslandBottom'),
  extractDeclaration(traSource, 'struct TraWaitIslandMinimal'),
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
                .fixedSize(horizontal: true, vertical: false)
        } else {
            RailEndButton(scale: scale, height: height) { Text("結束") }
        }
    }
}

// 等站卡「結束」鈕的替身（理由同上，出貨版是 Button(intent: TraWaitEndIntent())）。
struct TraWaitEndButton: View {
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
                .fixedSize(horizontal: true, vertical: false)
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

// 臺鐵等站卡（設計稿 F）。
//
// 🔴 時刻【寫死成具體的日期時間】而不是 now 的相對量：這張卡的判準是「主角時刻等於
//    表定＋誤點」這種逐字等式，浮動的 now 會讓期望值也跟著浮動 ⇒ 只能拿實作自己算的
//    值來比（心得 29：判準與實作同源＝集體失明）。錨死之後期望值才能走另一條路算。
let traSchedDate: Date = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Taipei")!
    return c.date(from: DateComponents(year: 2026, month: 8, day: 22, hour: 18, minute: 32))!
}()
let traSchedSec = traSchedDate.timeIntervalSince1970
// 使用者站在月台上、表定前 11 分鐘看這張卡。
let traNow = Date(timeIntervalSince1970: traSchedSec - 11 * 60)

func tra(delayMin: Int?, dataAgeSec: Double = 40, isStale: Bool = false,
         pushed: Bool? = true, notice: String? = nil,
         at when: Date = traNow) -> TraWaitDisplay {
    TraWaitDisplay.make(
        trainType: "自強", station: "板橋", colorHex: "#C0392B",
        trainNo: "123", dest: "潮州", schedSec: traSchedSec,
        delayMin: delayMin, dataAt: when.timeIntervalSince1970 - dataAgeSec,
        notice: notice, pushed: pushed, isStale: isStale, now: when)
}

let traLate = tra(delayMin: 3)
let traOnTime = tra(delayMin: 0)
// 🔴 「沒有資訊」與「準點」是兩件事：這班車不在官方動態窗裡（南迴那種長跑區段很常見）。
let traUnknown = tra(delayMin: nil)
// 誤點資訊過齡：主角退回表定，整卡降級。delayMin 刻意仍給 7——過期的處置不可以看有沒有值。
let traExpired = tra(delayMin: 7, dataAgeSec: TraWaitStale.delayMaxAgeSeconds + 60)
// 官方值照抄，包含負的（早到）。不夾正、不當成 0。
let traEarly = tra(delayMin: -2)
let traNotice = tra(delayMin: 12, notice: "臺鐵今日因設備檢修，部分列車延誤")
// 車應該到了：接上推播與沒接上是兩種話。
let traArrived = tra(delayMin: 3, isStale: true)
let traArrivedNoPush = tra(delayMin: 3, isStale: true, pushed: nil)
// 最壞情況：最長車種名＋4 碼車次＋最長站名與終點＋三位數誤點。
let traWorst = TraWaitDisplay.make(
    trainType: "自強(3000)", station: "臺北-環島", colorHex: "#C0392B",
    trainNo: "1234", dest: "臺北-環島", schedSec: traSchedSec,
    delayMin: 125, dataAt: traNow.timeIntervalSince1970 - 30,
    notice: "臺鐵即時資料中斷，誤點分鐘為最後一次官方更新", pushed: true,
    isStale: false, now: traNow)

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


/// 臺鐵等站卡:主角時刻的【獨立期望值】。
///
/// 🔴 刻意不呼叫 RailBoardClock.updateTimeString(出貨路徑用的那支):判準與實作同源時,
///    把兩邊一起改壞(例如都改成 UTC、都改成 mm:ss)這道 gate 照樣全綠——量測值恰好相等
///    在同源時是零資訊。這裡走 Calendar 元件＋String(format:),與 DateFormatter 沒有共用
///    任何一行;唯一共享的是「Asia/Taipei」這個外部常數。
func traClockHHmm(_ epoch: Double) -> String {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Taipei")!
    let c = cal.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: epoch))
    return String(format: "%02d:%02d", c.hour ?? -1, c.minute ?? -1)
}

/// 🔴 gate:等站卡的主角時刻 = 表定 + 官方誤點,而且【只】等於那個。
///
/// 這是整張卡的精度紅線落成判準(memory: tra-thsr-no-official-eta、使用者長期裁示
/// 「有資訊就一定要對」)。兩個輸入都是官方值 ⇒ 相加可以顯示;再往下一層換算成
/// 「還有幾分幾秒」就是製造官方沒有的精度。
func traPrecisionGate() {
    func fail(_ msg: String) -> Never {
        FileHandle.standardError.write(Data(("等站卡精度 gate 失敗:" + msg + "\\n").utf8))
        exit(1)
    }
    // 保鮮期是三方共用的外部值(worker TW_DELAY_MAX_AGE_SEC / 網頁 liveActive())。
    // 🔴 寫死 1800 不讀常數的理由同 expiryGate:讀它就是讓受測物自己供判準——
    //    把常數改成 1e9 時 fixture 的資料齡也跟著變,這道 gate 會照樣全綠。
    if TraWaitStale.delayMaxAgeSeconds != 1800 {
        fail("誤點保鮮期被改成 \\(TraWaitStale.delayMaxAgeSeconds) 秒(訂為 1800,與 worker 同值)")
    }

    let schedClock = traClockHHmm(traSchedSec)
    let schedText = "表定 " + schedClock
    // (1) 逐一驗主角時刻的【值】。期望值走 traClockHHmm,與實作沒有共用程式碼。
    // 🔴 主角標籤（第五欄）與主角時刻是一組的:同一個「18:32」，標成「實際約」是宣稱
    //    官方說了它會準點，標成「表定」才是我們真正知道的事。少了這一欄，「誤點未知」
    //    與「準點」在畫面上會長得一模一樣（主角同值），而它們是兩件完全不同的事。
    let cases: [(String, TraWaitDisplay, Double, String, String, TraWaitDisplay.DelayTone)] = [
        ("誤點 3 分", traLate, traSchedSec + 180, "實際約", "誤點 3 分", .late),
        ("準點", traOnTime, traSchedSec, "實際約", "準點", .onTime),
        ("誤點未知", traUnknown, traSchedSec, "表定", "目前無即時誤點資訊", .unknown),
        ("誤點資訊過齡", traExpired, traSchedSec, "表定", "誤點資訊已過期", .unknown),
        ("早到 2 分", traEarly, traSchedSec - 120, "實際約", "早到 2 分", .late),
    ]
    for (name, d, wantEpoch, wantCaption, wantDelayText, wantTone) in cases {
        let want = traClockHHmm(wantEpoch)
        if d.heroText != want {
            fail("「\\(name)」的主角時刻是「\\(d.heroText)」,表定＋官方誤點應該是「\\(want)」")
        }
        if d.heroCaption != wantCaption {
            fail("「\\(name)」的主角標成「\\(d.heroCaption)」，應該是「\\(wantCaption)」"
               + "——沒有官方誤點時那個時刻就只是表定，標成「實際約」等於替官方說它會準點")
        }
        if d.delayText != wantDelayText {
            fail("「\\(name)」的誤點句是「\\(d.delayText)」,應該是「\\(wantDelayText)」"
               + "——官方值一律照抄,不夾正、不合併")
        }
        if d.delayTone != wantTone {
            fail("「\\(name)」的語氣判錯了(nil 與 0 是兩件事:沒有資訊 vs 官方說準點)")
        }
        // 🔴 不變量:表定那個時刻在卡上【恰好出現一次】。
        //    有官方誤點時它住在第三列（主角是實際約到站）;沒有時主角本身就是表定，
        //    第三列的那一半要收掉，否則同一個數字並排兩份。
        //    「≥1」擋的是「表定整個不見了」（使用者就驗不了我們算出來的主角）;
        //    「≤1」擋的是重複。兩邊都要——只寫一邊，各有一種壞法會漏。
        let schedShown = [d.heroCaption == "表定" ? d.heroText : "", d.schedText ?? ""]
            .filter { $0.contains(schedClock) }.count
        if schedShown != 1 {
            fail("「\\(name)」的表定時刻在卡上出現 \\(schedShown) 次（應該恰好一次）:"
               + "主角標籤「\\(d.heroCaption)」／主角「\\(d.heroText)」／第三列「\\(d.schedText ?? "(無)")」")
        }
        if let sched = d.schedText, sched != schedText {
            fail("「\\(name)」的第三列表定是「\\(sched)」,應該是「\\(schedText)」")
        }
        // (2) 形狀:24 小時制鐘面。「1:30」這種 m:ss 過不了(小時位不合 [01]\\d|2[0-3])。
        if d.heroText.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) == nil {
            fail("「\\(name)」的主角「\\(d.heroText)」不是 24 小時制鐘面時刻")
        }
    }
    // (3) 🔴 反向對照:少了這條,「一律畫表定」可以通過上面五條裡的三條。
    if traLate.heroText == traOnTime.heroText {
        fail("誤點 3 分與準點畫出同一個主角時刻——誤點沒有真的加進去(或是被畫成了表定)")
    }
    // 🔴 這一對是本卡最容易出事的地方:「準點」與「誤點未知」的主角時刻【本來就相同】
    //    （都等於表定），兩者唯一的差別就是標籤與那句誤點文字。把標籤寫死成同一個值
    //    （例如一律「實際約」）時，只有這條會轉紅。
    if traOnTime.heroText != traUnknown.heroText {
        fail("fixture 壞了:準點與誤點未知的主角時刻應該都等於表定，這一對才問得出標籤有沒有用")
    }
    if traOnTime.heroCaption == traUnknown.heroCaption {
        fail("準點與誤點未知的主角標成同一個詞（\\(traOnTime.heroCaption)）——"
           + "兩者的主角時刻本來就相同，標籤是使用者唯一分得出「官方說準點」與「官方沒說」的地方")
    }
    // (4) 🔴 過期的反向對照:過期那格與準點那格【輸入只差資料齡】,結果卻必須不同語氣。
    //     少了這條,「乾脆永不過期」也能通過(2) 裡那格——它的主角本來就等於表定。
    if !traExpired.expired || traOnTime.expired {
        fail("過期判定失效(過期那格 expired=\\(traExpired.expired)、"
           + "新鮮那格 expired=\\(traOnTime.expired));兩格輸入只差資料齡")
    }
    // (5) 到站後那句話有兩種版本,不可以只留一種。
    guard let hintPushed = traArrived.staleHint, let hintNoPush = traArrivedNoPush.staleHint else {
        fail("車應已到卻沒有任何說明句")
    }
    if hintPushed == hintNoPush {
        fail("接上推播與沒接上推播的卡,到站後說同一句話(「\\(hintPushed)」)"
           + "——沒接上的那張不會自己更新誤點,也不會自己收,必須老實講")
    }
    if traLate.staleHint != nil {
        fail("車還沒到就先講了到站後的話")
    }
    print("gate 通過:等站卡主角 = 表定＋官方誤點(逐格獨立驗值),"
        + "誤點未知與過期都退回表定,到站說明句分得出有沒有接上推播")
}

/// 🔴 gate(精度反向對照):等站卡渲染出來的每一個字,都不准長得像倒數,也不准隨時間變。
///
/// traPrecisionGate() 驗的是「主角那個值對不對」,這一道驗的是「整張卡有沒有別的地方
/// 偷偷畫了秒級精度」——派工的原話是「卡片渲染輸出絕不出現 mm:ss 倒數形式(正則掃)」。
/// 判準有兩半,缺一不可:
///   · 靜態掃:禁字(秒／還有／剩／倒數)＋含冒號的欄位必須是 24 小時制鐘面。
///   · 動態掃:同一份輸入在兩個不同的 now 算出來,每一個字串都必須【逐字相同】。
///     這一半才擋得住「畫了一個自己會走的東西」——它在單一時點的快照上完全合法。
func traStaticTextGate() {
    func fail(_ msg: String) -> Never {
        FileHandle.standardError.write(Data(("等站卡靜態文字 gate 失敗:" + msg + "\\n").utf8))
        exit(1)
    }
    func texts(_ d: TraWaitDisplay) -> [(String, String)] {
        [("lead", d.lead), ("caption", d.heroCaption), ("hero", d.heroText),
         ("sched", d.schedText ?? ""),
         ("delay", d.delayText), ("footer", d.footer ?? ""),
         ("notice", d.notice ?? ""), ("hint", d.staleHint ?? "")]
    }
    let scenes: [(String, TraWaitDisplay)] = [
        ("誤點", traLate), ("準點", traOnTime), ("未知", traUnknown), ("過期", traExpired),
        ("早到", traEarly), ("公告", traNotice), ("到站", traArrived),
        ("到站未接推播", traArrivedNoPush), ("最壞值", traWorst),
    ]
    for (name, d) in scenes {
        for (field, text) in texts(d) {
            for bad in ["秒", "還有", "剩", "倒數"] where text.contains(bad) {
                fail("「\\(name)」的 \\(field) 是「\\(text)」,裡面有「\\(bad)」"
                   + "——臺鐵官方只有分鐘級誤點,任何秒級或倒數口吻都是假精度")
            }
            guard text.contains(":") else { continue }
            // 卡上只有三個地方是【時刻】:主角、表定、底列的資料時刻。其餘欄位帶冒號一律
            // 視為偷偷長出來的 m:ss。這三個各自剝掉自己的固定綴詞之後,都必須是鐘面。
            let body: String
            switch field {
            case "hero": body = text
            case "sched": body = String(text.dropFirst(3))          // 「表定 」
            case "footer": body = String(text.dropLast(3))          // 「 更新」
            default:
                fail("「\\(name)」的 \\(field) 出現冒號:「\\(text)」。只有主角、表定與資料時刻是時刻,"
                   + "其他欄位帶冒號多半是偷偷長出來的 m:ss")
            }
            if body.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) == nil {
                fail("「\\(name)」的 \\(field)「\\(text)」不是 24 小時制鐘面"
                   + "——「1:30」這種 m:ss 在等車情境會被讀成 1 小時 30 分")
            }
        }
    }
    // 🔴 正向對照:上面全是「不可以有」,整組欄位如果都是空字串會恆綠。
    if !traLate.lead.contains("次 往") || traLate.footer == nil {
        fail("fixture 的文字欄位是空的——上面那一整輪掃描沒有掃到任何東西")
    }

    // 動態掃:推進 5 分鐘(仍在保鮮期內),每一個字都必須一字不差。
    //
    // 🔴 dataAt 必須【釘死】,不可以跟著 now 一起走:底列「HH:mm 更新」印的就是 dataAt,
    //    兩個都動的話它本來就會變 ⇒ 這道斷言會誤報,而真正要抓的東西反而被雜訊蓋掉。
    //    要變的只有一個變因:now。
    let fixedDataAt = traNow.timeIntervalSince1970 - 40
    func snap(_ delay: Int?, _ when: Date) -> TraWaitDisplay {
        TraWaitDisplay.make(
            trainType: "自強", station: "板橋", colorHex: "#C0392B",
            trainNo: "123", dest: "潮州", schedSec: traSchedSec,
            delayMin: delay, dataAt: fixedDataAt,
            notice: nil, pushed: true, isStale: false, now: when)
    }
    let later = Date(timeIntervalSince1970: traNow.timeIntervalSince1970 + 300)
    for (delay, name) in [(3 as Int?, "誤點"), (0, "準點"), (nil, "未知")] {
        for (lhs, rhs) in zip(texts(snap(delay, traNow)), texts(snap(delay, later))) where lhs.1 != rhs.1 {
            fail("「\\(name)」的 \\(lhs.0) 過了 5 分鐘就從「\\(lhs.1)」變成「\\(rhs.1)」"
               + "——這張卡上不准有任何自己會走的數字(官方只給表定與誤點分鐘)")
        }
    }
    // 🔴 上面那一輪的正向對照:證明 now 真的有被 make(...) 用到。少了這條,
    //    「make 根本忽略 now」會讓「文字不隨時間變」這件事恆真,整個動態掃是空的。
    let wayLater = Date(timeIntervalSince1970: traNow.timeIntervalSince1970
                        + TraWaitStale.delayMaxAgeSeconds + 120)
    if !snap(3, wayLater).expired {
        fail("把 now 推到保鮮期之外,卡片卻還說誤點資訊是新的——make(...) 根本沒在看 now,"
           + "上面那一輪「文字不隨時間變」的斷言全部恆真")
    }
    print("gate 通過:等站卡的九個情境沒有任何秒級或 m:ss 字樣,"
        + "而且同一份資料在不同時刻算出來逐字相同(now 確實有接上,推過保鮮期會翻成過期)")
}

/// 🔴 gate:動態島 minimal 那一顆圓要答得出「到了沒有」。
///
/// 那顆圓只有 22pt——塞得下「3」這種分鐘數,塞不下「18:35」這種時刻,而把時刻截成
/// 「18」或「35」都會被讀成別的意思。所以這張卡的 minimal 不塞字,狀態全靠形狀。
/// 判準是純畫面事實:兩個狀態的 PNG 不可以相同(空心環 vs 實心)。
@MainActor
func traMinimalGate() {
    let color = Color(.sRGB, red: 0.75, green: 0.23, blue: 0.17)
    let waiting = pngData(TraWaitIslandMinimal(arrived: false, color: color), width: 30, height: 30)
    let arrived = pngData(TraWaitIslandMinimal(arrived: true, color: color), width: 30, height: 30)
    if waiting == arrived {
        FileHandle.standardError.write(Data(
            ("等站卡 minimal gate 失敗:「還沒到」與「車應已到」畫成同一張圖。"
             + "那顆圓塞不下時刻,狀態只能靠形狀,兩者一樣就等於這顆圓什麼都沒說\\n").utf8))
        exit(1)
    }
    // 單色模式(系統把顏色吃掉)也要分得出來:實心與空心是形狀差異,不是顏色差異。
    let waitingMono = pngData(TraWaitIslandMinimal(arrived: false, color: color),
                              width: 30, height: 30, mono: true)
    let arrivedMono = pngData(TraWaitIslandMinimal(arrived: true, color: color),
                              width: 30, height: 30, mono: true)
    if waitingMono == arrivedMono {
        FileHandle.standardError.write(Data(
            ("等站卡 minimal gate 失敗:單色模式下兩個狀態長得一模一樣"
             + "——顏色被系統吃掉之後必須還有形狀撐著\\n").utf8))
        exit(1)
    }
    print("gate 通過:等站卡 minimal 的圓在「車應已到」時變實心(單色模式下仍分得出來)")
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
        liveCountdownGate()
        traPrecisionGate()
        traStaticTextGate()
        traMinimalGate()

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

        // 臺鐵等站：誤點／準點／未知／過期／早到／公告／到站（接上與沒接上推播）／最壞值
        for (name, d) in [("late", traLate), ("ontime", traOnTime), ("unknown", traUnknown),
                          ("expired", traExpired), ("early", traEarly), ("notice", traNotice),
                          ("arrived", traArrived), ("arrived-nopush", traArrivedNoPush)] {
            _ = render(TraWaitLockView(display: d), width: 360, maxHeight: lockScreenMaxHeight,
                       to: outDir + "/la-trawait-\\(name).png")
        }
        _ = render(TraWaitLockView(display: traWorst), width: 330, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-trawait-worst-393.png")
        // 🔴 300pt 比任何在賣的機型都窄——變窄會讓字折行、折行就長高，只掃 360/330 等於把
        //    最容易破的方向留在盲區（理由同等車卡那兩張）。這兩張是安全邊界，不是機型。
        _ = render(TraWaitLockView(display: traLate), width: 300, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-trawait-late-narrow300.png")
        _ = render(TraWaitLockView(display: traWorst), width: 300, maxHeight: lockScreenMaxHeight,
                   to: outDir + "/la-trawait-worst-narrow300.png")
        _ = render(TraWaitLockView(display: traLate), width: 360, maxHeight: lockScreenMaxHeight, mono: true,
                   to: outDir + "/la-trawait-late-mono.png")

        // 動態島展開版的下半（識別列由 region builder 提供，那一層 ActivityKit only）。
        // bottom region 沒有 system 圓角安全區；出貨版自行內縮 22pt，墨跡至少守住 21.5pt。
        _ = render(RailFollowIslandBottom(display: followRunning), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-follow-bottom.png")
        _ = render(RailFollowIslandBottom(display: followStopping), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-follow-bottom-stopping.png")
        _ = render(MetroWaitIslandBottom(display: waitNormal), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-wait-bottom.png")
        _ = render(MetroWaitIslandBottom(display: waitWorst), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-wait-bottom-worst.png")
        // 進站時島上捨棄「再下一班」保住擁擠度（見 MetroWaitIslandBottom 的註解）。
        _ = render(MetroWaitIslandBottom(display: waitArriving), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-wait-bottom-arriving.png")

        _ = render(TraWaitIslandBottom(display: traLate), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-trawait-bottom.png")
        _ = render(TraWaitIslandBottom(display: traUnknown), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-trawait-bottom-unknown.png")
        _ = render(TraWaitIslandBottom(display: traWorst), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-trawait-bottom-worst.png")
        _ = render(TraWaitIslandBottom(display: traArrived), width: 360, maxHeight: islandExpandedMaxHeight, inset: 21.5,
                   to: outDir + "/island-trawait-bottom-arrived.png")
        // 等站卡的 minimal 不塞字（塞不下「18:35」），兩態靠形狀分（gate 已驗過不同）。
        for (name, arrived) in [("waiting", false), ("arrived", true)] {
            _ = render(TraWaitIslandMinimal(arrived: arrived,
                                            color: Color(.sRGB, red: 0.75, green: 0.23, blue: 0.17))
                        .frame(width: 22, height: 22).padding(4),
                       width: 30, inset: 0, to: outDir + "/island-trawait-minimal-\\(name).png")
        }

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

execFileSync('swiftc', ['-O', '-parse-as-library', swiftPath, kitPath, nativeL10nPath, '-o', binPath], { stdio: 'inherit' });
execFileSync(binPath, [outDir], { stdio: 'inherit' });
