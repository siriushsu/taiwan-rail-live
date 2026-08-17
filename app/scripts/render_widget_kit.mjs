#!/usr/bin/env node
// 把共用元件層（RailWidgetKit.swift）的八個元件算繪成展示廊 PNG，不必進模擬器。
//
// 為什麼要有這一支：元件層是七個畫面的地基，字級、缺口、圓鼻、單色退化這些東西
// 讀原始碼看不出對不對，一定要親眼看。而且它是「改一個元件、七個畫面一起變」的位置，
// 沒有一張基準圖就沒辦法證明某次調整只動了想動的那個元件。
//
// 做法：RailWidgetKit.swift 只 import SwiftUI／WidgetKit、不依賴專案裡任何其他型別，
// 所以這裡【整檔逐字納入】而不是抽宣告——連抽取都不必，就沒有「抽到舊版」的可能。
// 檔案若哪天開始依賴其他檔，swiftc 會當場編不過（而不是安靜算出舊版面），這是刻意的。
//
// 用法：node app/scripts/render_widget_kit.mjs [輸出目錄]
// 產物：kit-light.png／kit-dark.png／kit-mono.png（同一份版面，三種顯示模式）

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kitPath = resolve(here, '../ios/App/RailBoardWidget/RailWidgetKit.swift');
const outDir = resolve(process.argv[2] ?? join(here, '../../tmp/widget-kit-shots'));

const kit = readFileSync(kitPath, 'utf8');
// 逐字納入前先確認它真的是那個檔（抽不到就失敗，不留退路）。
for (const marker of ['struct RailSpineCell', 'enum RailCountdown', 'struct RailCarriageMeter',
                      'struct RailLineMark', 'struct RailTrainMark', 'struct RailStatusTag',
                      'struct RailSectionHeader', 'struct RailEndButton', 'struct RailRow<']) {
  if (!kit.includes(marker)) throw new Error(`RailWidgetKit.swift 裡找不到 ${marker}（改名了？）`);
}
// import 行由 harness 自己出，避免重複 import。
const kitBody = kit.replace(/^import .*$/gm, '');

const harness = `
import AppKit
import Foundation
import SwiftUI
import WidgetKit

${kitBody}

// ── 展示廊 ────────────────────────────────────────────────────────────────

private let 板南 = Color(.sRGB, red: 0x00 / 255, green: 0x70 / 255, blue: 0xBD / 255)
private let 淡信 = Color(.sRGB, red: 0xD9 / 255, green: 0x00 / 255, blue: 0x23 / 255)
private let 自強色 = Color(.sRGB, red: 0xC0 / 255, green: 0x39 / 255, blue: 0x2B / 255)
private let 高鐵色 = Color(.sRGB, red: 0xE8 / 255, green: 0x5D / 255, blue: 0x0D / 255)

private struct Cell<C: View>: View {
    let title: String
    @ViewBuilder var content: () -> C
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
            content()
        }
        .frame(width: 250, alignment: .leading)
    }
}

private struct Gallery: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {

            HStack(alignment: .top, spacing: 20) {
                Cell(title: "RailCountdown · hero 44 / 40") {
                    HStack(alignment: .bottom, spacing: 16) {
                        RailCountdownText(value: .minutes(3), size: .hero(44))
                        RailCountdownText(value: .minutes(12), size: .hero(40))
                        RailCountdownText(value: .arriving, size: .hero(44))
                    }
                }
                Cell(title: "RailCountdown · 秒（LA 專用）/ 過期 / 表定") {
                    HStack(alignment: .bottom, spacing: 14) {
                        RailCountdownText(value: .seconds(52), size: .hero(44))
                        RailCountdownText(value: .noData, size: .hero(44))
                        RailCountdownText(value: .scheduled("11:38"), size: .hero(40))
                    }
                }
                Cell(title: "RailCountdown · 次列 17 / 第三層 13") {
                    HStack(alignment: .bottom, spacing: 14) {
                        RailCountdownText(value: .minutes(5), size: .row)
                        RailCountdownText(value: .minutes(9), size: .row)
                        RailCountdownText(value: .arriving, size: .row)
                        RailCountdownText(value: .minutes(2), size: .minor)
                    }
                }
            }

            HStack(alignment: .top, spacing: 20) {
                Cell(title: "RailCarriageMeter · 三級（六節，車頭圓鼻在上）") {
                    VStack(alignment: .leading, spacing: 7) {
                        RailCarriageMeter(levels: [1, 1, 1, 1, 2, 1])
                        RailCarriageMeter(levels: [2, 3, 3, 2, 3, 2])
                        RailCarriageMeter(levels: [4, 4, 3, 4, 4, 4])
                        RailCarriageMeter(levels: [1, 2, 3, 4], showWord: false)
                    }
                }
                Cell(title: "RailLineMark（點必配線名）") {
                    VStack(alignment: .leading, spacing: 7) {
                        RailLineMark(name: "板南線", color: 板南)
                        RailLineMark(name: "淡水信義線", color: 淡信)
                        RailLineMark(name: "文湖線", color: nil)
                    }
                }
                Cell(title: "RailTrainMark（標＋車次兩種角色）") {
                    VStack(alignment: .leading, spacing: 7) {
                        RailTrainMark(kind: "高鐵", number: "0814", color: 高鐵色)
                        RailTrainMark(kind: "自強", number: "420", color: 自強色)
                        RailTrainMark(kind: "區間", number: "1168", color: 板南)
                    }
                }
            }

            HStack(alignment: .top, spacing: 20) {
                Cell(title: "RailStatusTag（純文字無膠囊）") {
                    VStack(alignment: .leading, spacing: 6) {
                        RailStatusTag(kind: .onTime)
                        RailStatusTag(kind: .delay(6))
                        RailStatusTag(kind: .lastTrain)
                        RailStatusTag(kind: .suspended)
                        RailStatusTag(kind: .stamp("11:28 資料"))
                    }
                }
                Cell(title: "RailSpineCell（線在圓點處斷開）") {
                    VStack(spacing: 0) {
                        RailSpineCell(kind: .lead(淡信), lineAbove: false, lineBelow: true)
                            .frame(height: 43)
                        RailSpineCell(kind: .follow).frame(height: 28)
                        RailSpineCell(kind: .follow).frame(height: 28)
                        RailSpineCell(kind: .train(板南), lineBelow: false).frame(height: 28)
                    }
                    .frame(width: 12)
                }
                Cell(title: "RailSpineTrack（LA 水平進度三態）") {
                    VStack(alignment: .leading, spacing: 12) {
                        RailSpineTrack(progress: 0.42).frame(height: 12)
                        RailSpineTrack(progress: 0.62, arriving: true).frame(height: 12)
                        RailSpineTrack(progress: 0.62, stopping: true).frame(height: 12)
                    }
                }
            }

            HStack(alignment: .top, spacing: 20) {
                Cell(title: "RailSectionHeader / RailStamp / RailEndButton") {
                    VStack(alignment: .leading, spacing: 8) {
                        RailSectionHeader(text: "捷運 · 倒數")
                        RailSectionHeader(text: "臺鐵・高鐵 · 時刻")
                        RailStamp(text: "11:33")
                        RailStamp(text: "11:28", warn: true)
                        RailEndButton { Text("結束") }
                    }
                }
                Cell(title: "RailRow 三欄骨架（軌脊 12 / 內容彈性 / 數字 76 靠右）") {
                    VStack(spacing: 0) {
                        RailRow(spine: .lead(淡信), lineAbove: false, height: RailRowHeight.hero,
                                numberWidth: RailNumberColumn.wide) {
                            Text("往 象山").font(.system(size: 20, weight: .semibold)).lineLimit(1)
                            HStack(spacing: 6) {
                                RailLineMark(name: "淡水信義線", color: 淡信, fontSize: 13)
                                RailCarriageMeter(levels: [1, 1, 2, 1, 1, 1])
                            }
                        } trailing: {
                            RailCountdownText(value: .minutes(2), size: .hero(40))
                        }
                        RailRow(spine: .follow) {
                            Text("往 亞東醫院").font(.system(size: 17, weight: .medium)).lineLimit(1)
                        } trailing: {
                            RailCountdownText(value: .minutes(5), size: .row)
                        }
                        RailRow(spine: .follow, lineBelow: false) {
                            Text("往 南港展覽館").font(.system(size: 17, weight: .medium)).lineLimit(1)
                        } trailing: {
                            RailCountdownText(value: .minutes(9), size: .row)
                        }
                    }
                    .frame(width: 240)
                }
            }
        }
        .padding(20)
    }
}

@MainActor
func render(scheme: ColorScheme, mono: Bool, to path: String) {
    let renderer = ImageRenderer(
        content: Gallery()
            .environment(\\.colorScheme, scheme)
            .environment(\\.railMonochrome, mono)
            .background(scheme == .dark ? Color(white: 0.08) : Color(white: 0.99))
    )
    renderer.scale = 2
    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write(Data("算繪失敗：\\(path)\\n".utf8)); exit(1)
    }
    try! png.write(to: URL(fileURLWithPath: path))
    print("寫出 \\(path)")
}

@main
struct Harness {
    @MainActor
    static func main() {
        let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
        render(scheme: .light, mono: false, to: out + "/kit-light.png")
        render(scheme: .dark,  mono: false, to: out + "/kit-dark.png")
        // 🔴 單色模式要【亮暗各算一次】：白色圓盤上的方向三角在深色模式用 Color.primary
        //    會整顆消失，只算亮色那張看不到；反過來灰底白字的對比問題只在亮色現形。
        //    只驗一種＝一半的破法沒被驗到。
        render(scheme: .dark,  mono: true,  to: out + "/kit-mono-dark.png")
        render(scheme: .light, mono: true,  to: out + "/kit-mono-light.png")
    }
}
`;

mkdirSync(outDir, { recursive: true });
const swiftPath = join(outDir, 'kit-harness.swift');
const binPath = join(outDir, 'kit-harness');
writeFileSync(swiftPath, harness);
execFileSync('swiftc', ['-O', '-parse-as-library', swiftPath, '-o', binPath], { stdio: 'inherit' });
execFileSync(binPath, [outDir], { stdio: 'inherit' });
