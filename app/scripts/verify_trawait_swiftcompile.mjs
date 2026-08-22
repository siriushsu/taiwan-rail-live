// 台鐵等站卡四個 Swift 檔「有沒有真的被編進該進的 target」——判準來源是 archive 的
// xcodebuild log，不是 pbxproj 的文字。
//
// 🔴 為什麼不讀 pbxproj：`project.pbxproj` 是【意圖】，log 是【事實】。手改 pbxproj 少一個
//    PBXBuildFile，檔案照樣躺在磁碟上、`plutil -lint` 照樣過、**build 也照樣 SUCCEEDED**，
//    只是那個 target 裡沒有這個型別——症狀要等到真機上「plugin 不存在／卡片畫不出來」才現形
//    （memory: widget-target-setup 的「加新 Swift 檔不改 pbxproj 就不會被編進去」）。
//
// 🔴 逐檔逐 target 各一條斷言，不可以用 OR 併成「至少有一個 target 編了它」——
//    共用型別要【兩個 target 都編到】才算對，OR 會讓「只進了 App、Extension 沒有」全綠，
//    而那正是跨行程解碼失敗最典型的形狀。
//
// 另外兩條是【反向對照】：plugin 不該進 Extension、版面不該進 App target。
// 少了它們，「把四個檔全部塞進兩個 target」也會通過。
//
// 跑法：node app/scripts/verify_trawait_swiftcompile.mjs <archive 的 xcodebuild log>
import { readFileSync } from 'node:fs';

const logPath = process.argv[2];
if (!logPath) {
  console.error('用法：node app/scripts/verify_trawait_swiftcompile.mjs <xcodebuild archive 的 log>');
  process.exit(2);
}
const log = readFileSync(logPath, 'utf8');

// Release 走 whole-module，一個 target 的所有檔會併成一行：
//   SwiftCompile normal arm64 Compiling\ A.swift,\ B.swift,\ … /abs/path/A.swift … (in target 'X' from project 'Y')
const lines = log.split('\n').filter((l) => l.startsWith('SwiftCompile normal arm64 Compiling'));
const filesForTarget = (target) => {
  const out = new Set();
  for (const l of lines) {
    const m = /\(in target '([^']+)' from project '([^']+)'\)/.exec(l);
    if (!m || m[1] !== target) continue;
    // 只取「Compiling\ …」那一段的檔名，不要掃絕對路徑（路徑會把同名檔重複帶進來）
    const head = l.split(' /')[0];
    for (const f of head.match(/[A-Za-z0-9_+-]+\.swift/g) ?? []) out.add(f);
  }
  return out;
};

const compiled = { App: filesForTarget('App'), RailBoardWidgetExtension: filesForTarget('RailBoardWidgetExtension') };

// 控制組：兩個 target 都要真的有東西被編。log 抓錯檔或格式變了的話，
// 下面每一條「不應被編」會全部假綠（空集合對任何 not-in 都成立）。
let bad = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) bad++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
ok('C0 App target 有檔案被編（分母存在）', compiled.App.size > 0, `${compiled.App.size} 檔`);
ok('C0 Extension target 有檔案被編（分母存在）', compiled.RailBoardWidgetExtension.size > 0,
  `${compiled.RailBoardWidgetExtension.size} 檔`);

const EXPECT = [
  // 共用型別：跨行程的 ActivityAttributes，兩邊都要有，少一邊就解不出對方寫的 ContentState
  ['TraWaitAttributes.swift', 'App', true],
  ['TraWaitAttributes.swift', 'RailBoardWidgetExtension', true],
  // LiveActivityIntent：卡片上的「結束」鈕在 Extension 畫、在 App 行程執行
  ['TraWaitEndIntent.swift', 'App', true],
  ['TraWaitEndIntent.swift', 'RailBoardWidgetExtension', true],
  // Capacitor plugin：只有 App 有 bridge
  ['RailTraWaitPlugin.swift', 'App', true],
  ['RailTraWaitPlugin.swift', 'RailBoardWidgetExtension', false],
  // 卡片版面：只有 Extension 畫得出來
  ['TraWaitActivity.swift', 'RailBoardWidgetExtension', true],
  ['TraWaitActivity.swift', 'App', false],
];
for (const [file, target, want] of EXPECT) {
  const got = compiled[target].has(file);
  ok(`${file} 在 ${target} ${want ? '應該' : '不應'}被編`, got === want, `實際${got ? '有' : '無'}`);
}

console.log(`\n總計 ${EXPECT.length + 2} 條，FAIL ${bad}`);
process.exit(bad ? 1 : 0);
