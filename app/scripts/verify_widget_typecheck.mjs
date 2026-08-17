#!/usr/bin/env node
/**
 * 小工具與 Live Activity 的 iOS 目標 typecheck 閘門。
 *
 * 🔴 為什麼算繪 harness 補不了這一支：render_board_widget.mjs／render_activity_widget.mjs
 *    是把版面攤成純值後在 macOS 上算圖，**編的是子集**——`Widget`／`ActivityConfiguration`
 *    與吃 `ActivityViewContext` 的那幾個函式在 macOS 上根本建不起來，所以被排除在外。
 *    2026-08-17 就這樣同時漏掉兩個「整個 target 編不過」的錯：
 *      1. MetroBoardWidget 的邊界時刻一行式 flatMap ⇒ 編譯器型別檢查爆搜
 *         （"unable to type-check this expression in reasonable time"，只在 iOS target 現）。
 *      2. RailFollowActivity 讀 `ctx.attributes.terminus`，但 terminus 在 ContentState 裡
 *         ——這一行只存在於被 harness 排除的那段，於是零告警。
 *    這支把**整組原始碼**丟給 iOS 目標做 typecheck，兩類都攔得到，只花幾秒。
 *
 * 🔴 target 一定要釘 17.6（部署目標）：拿掉 -target 會冒出一堆 availability 假錯誤，
 *    真正的那一條會被蓋過去。
 *
 * 跑法：node app/scripts/verify_widget_typecheck.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIDGET = join(ROOT, 'app/ios/App/RailBoardWidget');
const APP = join(ROOT, 'app/ios/App/App');

// widget target 會編到的 App 側共用型別（Attributes／Intent）。少給就會是「找不到型別」的假錯誤。
const SHARED = ['MetroWaitAttributes.swift', 'MetroWaitEndIntent.swift', 'RailFollowAttributes.swift'];

const sources = [
  ...readdirSync(WIDGET).filter(f => f.endsWith('.swift')).map(f => join(WIDGET, f)),
  ...SHARED.map(f => join(APP, f)),
];
if (sources.length < 14) {
  console.error(`只找到 ${sources.length} 個原始檔，少於預期——是不是路徑跑掉了？`);
  process.exit(1);
}

const sdk = execFileSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' }).trim();
let out = '';
try {
  execFileSync('xcrun', ['--sdk', 'iphoneos', 'swiftc', '-typecheck',
    '-target', 'arm64-apple-ios17.6', '-sdk', sdk, ...sources], { encoding: 'utf8', stdio: 'pipe' });
} catch (error) {
  out = String(error.stderr ?? '') + String(error.stdout ?? '');
}
const errors = out.split('\n').filter(line => /: error: /.test(line));
if (errors.length) {
  console.error(`iOS typecheck 失敗 ${errors.length} 條：`);
  for (const line of errors) console.error(' ✗ ' + line.trim());
  process.exit(1);
}
console.log(`iOS typecheck 全過（${sources.length} 個原始檔，arm64-apple-ios17.6）`);
