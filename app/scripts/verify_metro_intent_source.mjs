#!/usr/bin/env node
// 從原始碼現場抽宣告,守住 AppIntents 的四條硬限制。
// 這些限制只有真機點得出來,但「有沒有寫錯」可以在這裡先擋掉一輪。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'app/ios/App/RailBoardWidget/MetroBoardIntent.swift');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  PASS ${n}`)) : (fail++, console.log(`  FAIL ${n} ${d}`)); };

if (!existsSync(SRC)) { console.log(`FAIL 原始碼不存在: ${SRC}`); process.exit(1); }
const src = readFileSync(SRC, 'utf8');

// 🔴 判準只看程式碼,不看註解——Direction provider 的說明註解裡就有「\.$station」與
//    「intent?.station」,不剝掉會同時污染 declared 與 readFields:L3p 對零依賴的 provider
//    誤觸發還只是小事,最壞情況是未來真的在那裡讀了沒宣告的參數,declared 裡來自註解的
//    名字會把違規遮成合法——判準在它該開火的那一型上失明。
//    (本檔沒有含 // 的字串常值;若未來加了,這個逐行去尾要改成語法感知的剝法。)
const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

// 1. 不准用 AppEntity(這個 extension 註冊 AppEntity 一律失敗,兩個參數會被還原成 nil)
//    conformance 清單裡「, AppEntity」也要抓,不只「: AppEntity」。
ok('L1 沒有 AppEntity', !/[:,]\s*AppEntity\b/.test(code));

// 2. 🔴 每個 @IntentParameterDependency 只准綁【一個】keypath——綁兩個那一列整列點不動
//    (已出貨的發車看板 AppIntent.swift:113-116 與 193-195 兩處實測)。
//    注意:限制是「每個依賴一個 keypath」,不是「全檔最多一個依賴」——出貨檔就有兩個
//    provider 各帶一個依賴,都正常。本檔另有設計約定 L2b。
const depDecls = [...code.matchAll(/@IntentParameterDependency<[^>]*>\(([^)]*)\)/g)];
for (const [i, m] of depDecls.entries()) {
  const n = (m[1].match(/\\\.\$/g) || []).length;
  ok(`L2a-${i} 依賴只綁一個 keypath`, n === 1, `綁了 ${n} 個: ${m[1]}`);
}
// 2b. 本檔的設計約定:唯一的依賴在車站 provider 上、綁 \.$sys。方向 provider 不帶依賴是
//     刻意保守(單一依賴的形狀在發車看板驗證過可行,但用在方向格需真機驗過才開,見下方註解)。
ok('L2b 全檔恰一個依賴且綁 sys', depDecls.length === 1 && /\\\.\$sys\b/.test(depDecls[0]?.[1] ?? ''),
   `找到 ${depDecls.length} 個: ${depDecls.map(m => m[1]).join(' | ')}`);

// 3. 沒宣告在依賴裡的參數不准讀(讀了當場 fatalError,出貨檔 AppIntent.swift:196-198 實測)
//    抽出每個 OptionsProvider 的大括號區塊,比對它宣告的依賴 keyPath 與它讀到的 intent 欄位。
//    🔴 依賴變數必須照出貨慣例命名 intent(AppIntent.swift:124/202)——L3p 鎖住這個約定,
//    改名會讓這裡的 regex 咬不到、L3 變空過。
for (const m of code.matchAll(/struct\s+(\w*OptionsProvider)\b[\s\S]*?\n\}/g)) {
  const block = m[0], name = m[1];
  const declared = new Set([...block.matchAll(/\\\.\$(\w+)/g)].map(x => x[1]));
  const readFields = new Set([...block.matchAll(/\bintent\??\.(\w+)/g)].map(x => x[1]));
  const illegal = [...readFields].filter(f => !declared.has(f));
  ok(`L3-${name} 只讀宣告過的參數`, illegal.length === 0, JSON.stringify(illegal));
  if (declared.size) ok(`L3p-${name} 正向對照:宣告了依賴就要真的讀 intent?.…`,
     readFields.size > 0, '讀數=0——依賴變數沒叫 intent 或根本沒用,L3 正在空過');
  // 4. 任何 provider 都不准回 .empty(選單會被系統整個收掉,AppIntent.swift:137-141 實測)
  ok(`L4-${name} 不回 .empty`, !/return\s+\.empty/.test(block));
}
ok('L0 真的有抽到 provider', /OptionsProvider/.test(code));

// 5. 免費站數常數存在且是合法值。
// 🔴 2026-08-15 改判準:原本釘死 `= nil`(定價未決時的當下實測值),定價一落地就假紅——
//    心得 35「判準寫是什麼、不寫有幾個」。真正要守的兩件事:(a) 常數還在(它是唯一開關);
//    (b) 若設了限制,同批必須有明講 CTA——後者由 verify_metro_plus_gate.mjs 的 S 組守,
//    這裡只斷言「設了限制就必須有那支驗收在守」,避免有人把限制打開卻繞過 CTA 那條裁示。
const limitMatch = code.match(/freeStationLimit\s*:\s*Int\?\s*=\s*(nil|\d+)/);
ok('L5 免費站數常數存在且值合法', !!limitMatch,
   (src.match(/freeStationLimit.*/) || ['(找不到)'])[0]);
if (limitMatch && limitMatch[1] !== 'nil') {
  const gate = join(ROOT, 'app/scripts/verify_metro_plus_gate.mjs');
  ok('L5b 有限制就必須有 CTA 驗收在守', existsSync(gate), `找不到 ${gate}`);
}

// 6. 🔴 不准定義 parameterSummary——定義了它,沒被列進 Summary 的參數那一格會被整格
//    藏起來(原規劃稿只列 station/dir ⇒「系統」格消失)。出貨檔同樣不定義,三格全顯示。
//    真要定義,先把這條改成「必須含全部三個 keypath」再動手。
// 🔧 用宣告語法(`var parameterSummary`)而非裸子字串比對:本檔自己給的參考實作(Step 3)
//    有一段註解專門解釋「刻意不定義 parameterSummary」,文字裡就含這個識別字——裸子字串會把
//    這段說明性註解也判定為「有定義」,對自己給的參考碼假紅。改成比對宣告語法(涵蓋
//    `var parameterSummary` 與 `static var parameterSummary`,因為後者以子字串涵蓋前者),
//    真的加回宣告(Step 6 的突變)一樣抓得到,只是不再誤判單純提及這個名字的說明文字。
ok('L6 沒有 parameterSummary', !/\bvar\s+parameterSummary\b/.test(code),
   (src.match(/.*parameterSummary.*/) || ['(找不到)'])[0]);

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
