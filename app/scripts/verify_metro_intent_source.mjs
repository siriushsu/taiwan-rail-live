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
// 2b. 本檔的設計約定(2026-09-02 起):恰兩個依賴——車站 provider 綁 \.$sys、方向 provider 綁
//     \.$station(方向只列該站開得到的;原本「方向不帶依賴、列全系統終點」讓使用者選得到
//     跨系統／跨線的方向,選完看板永遠空白——使用者回報後改掉)。
const depKeys = depDecls.map(m => m[1].trim());
ok('L2b 全檔恰兩個依賴:sys 與 station', depDecls.length === 2
   && depKeys.some(k => /\\\.\$sys\b/.test(k)) && depKeys.some(k => /\\\.\$station\b/.test(k)),
   `找到 ${depDecls.length} 個: ${depKeys.join(' | ')}`);
// 2c. 方向格要有「不指定」哨兵,而且真的放進清單(單選 picker 選過就清不掉,這是唯一的出路)。
ok('L2c 方向格有「不指定」哨兵常數', /static let anyDirection\s*=\s*"any"/.test(code));
ok('L2d 方向清單把哨兵放進 IntentItem', /IntentItem<String>\(MetroBoardIntent\.anyDirection/.test(code));
ok('L2e 哨兵由 direction(_:) 收成 nil', /static func direction\(_ raw: String\?\) -> String\?/.test(code)
   && /raw != anyDirection else \{ return nil \}/.test(code));

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

// ══════════ 7. 🔴 小工具 Button(intent:) 帶的參數值必須是純 ASCII ══════════
// 2026-08-22 在 iOS 26.5 模擬器做單一變因對照(同一顆 build 只換 Button 綁的 intent 值):
//   值 = ""(預設)               → 小工具正常畫出來
//   值 = sys:"TRTC" station:"TESTASCII" → 正常畫出來
//   值 = sys:"TRTC" station:"大安"      → 【整張小工具變佔位圖,連畫都畫不出來】
// 壞掉那次 widget extension 的 log:
//   -[INAppIntent linkAction] No LinkAction; returning nil (NSCocoaErrorDomain 4097)
//   → Unable to get LNAction from intent → chronod 收到 CHSErrorDomain 1101
//     「Returned view collection was either nil or empty.」整份畫面存檔被丟掉。
// 對照組:同一顆 build 把 Button 換成無參數的 MetroWaitEndIntent 也正常
// ⇒ 不是 Button、也不是 LiveActivityIntent 本身,就是【參數值的字元集】。
// 站名／終點站名全是中文 ⇒ 唯一安全的走法是包成 Base64(全 ASCII)再當參數傳。
{
  const START = join(ROOT, 'app/ios/App/App/MetroWaitStartIntent.swift');
  ok('L7-0 MetroWaitStartIntent.swift 存在', existsSync(START), START);
  if (existsSync(START)) {
    const rawStart = readFileSync(START, 'utf8');
    const codeStart = rawStart.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const intentBody = (codeStart.match(/struct\s+MetroWaitStartIntent\s*:[\s\S]*?\n\}/) || [''])[0];
    const params = [...intentBody.matchAll(/@Parameter\([^)]*\)\s*var\s+(\w+)\s*:\s*([\w?]+)/g)];
    // 參數只准一個、只准 String——多一個中文欄位就會走回頭路(這條是本組的核心)。
    ok('L7a 只宣告一個 @Parameter', params.length === 1, `找到 ${params.length}: ${params.map(m => m[1]).join(',')}`);
    ok('L7b 那個參數是 payload: String', params[0]?.[1] === 'payload' && params[0]?.[2] === 'String',
       JSON.stringify(params[0]?.slice(1)));
    // 唯一寫入點必須是編碼函式,不能有人繞過去直接塞原字串。
    const writes = [...intentBody.matchAll(/self\.payload\s*=\s*([^\n]+)/g)].map(m => m[1].trim());
    ok('L7c payload 只由 Self.encode( 寫入', writes.length === 1 && writes[0].startsWith('Self.encode('),
       JSON.stringify(writes));
    ok('L7d encode 以 base64EncodedString() 收尾',
       /static\s+func\s+encode\([^)]*\)\s*->\s*String\s*\{[^}]*base64EncodedString\(\)/.test(codeStart),
       '(找不到 encode → base64EncodedString)');
    // 呼叫端只准用便利 init,不准自己動 payload(動了就等於自己決定字元集)。
    for (const f of ['app/ios/App/RailBoardWidget/MetroBoardWidget.swift',
                     'app/ios/App/RailBoardWidget/MixedBoardWidget.swift']) {
      const c = readFileSync(join(ROOT, f), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
      const calls = [...c.matchAll(/MetroWaitStartIntent\(([^)]*)\)/g)].map(m => m[1]);
      const base = f.split('/').pop();
      ok(`L7e-${base} 有綁 Button(intent: MetroWaitStartIntent(…))`, calls.length >= 1, `calls=${calls.length}`);
      ok(`L7f-${base} 呼叫端一律走 sys:station:dest: 便利 init`,
         calls.every(a => /^\s*sys\s*:/.test(a)), JSON.stringify(calls));
      ok(`L7g-${base} 呼叫端不直接寫 payload`, !/\bpayload\s*:/.test(c) && !/\.payload\s*=/.test(c), f);
    }
    // 行為對照:把 Swift 的編碼規則在 JS 重做一次,拿【真的中文站名】跑一遍。
    // 正向:編出來必須全 ASCII(這才是產品真正依賴的性質)。
    // 負向:不編碼的原字串必須【不是】ASCII——證明這條斷言不是恆真的空過。
    const enc = (sys, station, dest) => Buffer.from(`${sys}\t${station}\t${dest ?? ''}`, 'utf8').toString('base64');
    const isAscii = t => /^[\x00-\x7F]*$/.test(t);
    const sample = enc('TRTC', '大安', '象山');
    ok('L7h 中文站名編出來全 ASCII', isAscii(sample), sample);
    ok('L7i 負對照:未編碼的同一份內容不是 ASCII', !isAscii('TRTC\t大安\t象山'), '這條若過了代表 L7h 恆真');
    // 解得回來才算數(dest 空字串＝不限方向)。
    const dec = t => { const p = Buffer.from(t, 'base64').toString('utf8').split('\t');
                       return p.length === 3 ? { sys: p[0], station: p[1], dest: p[2] || null } : null; };
    const back = dec(sample);
    ok('L7j round-trip 還原得回原值', back && back.sys === 'TRTC' && back.station === '大安' && back.dest === '象山',
       JSON.stringify(back));
    const noDest = dec(enc('TRTC', '大安', null));
    ok('L7k 不限方向還原成 null', noDest && noDest.dest === null, JSON.stringify(noDest));
    // 🔴 L7h–L7k 驗的是【格式契約】(JS 重做一遍),不是 Swift 實作本身;Swift 那邊 encode 與
    //    decode 的分隔符若各改各的,上面四條照樣全綠。L7l 就是補這個縫:兩邊都必須是 tab。
    ok('L7l encode/decode 分隔符都是 tab',
       /static\s+func\s+encode\([\s\S]{0,200}?\\t/.test(codeStart) &&
       /components\(separatedBy:\s*"\\t"\)/.test(codeStart),
       '(encode 或 decode 沒用 \\t)');

    // ── L8 approx 精度契約(2026-08-22 build 73 實踩) ─────────────────────────
    // 伺服端 eta2 推導列帶 approx:true,etaEpoch 是「約 N 分」的投影值不是官方站牌原文。
    // build 73 的 seed() 無條件 st.secondEta = b?.etaEpoch ⇒ MetroWaitActivity 的
    // .until 把投影畫成 mm:ss 秒級倒數=冒充官方精度(小工具側 MetroCountdown 有攔,
    // 卡片側漏了)。這組鎖:approx 列只准折整分鐘走 secondMinutes,secondEta 必須留空;
    // 官方列(else 路)必須照抄 etaEpoch——兩側都驗,免得「乾脆全走分鐘」也全綠。
    const seedBranch = codeStart.match(
      /if\s+let\s+b\s*,\s*b\.approx\s*,\s*let\s+e2\s*=\s*b\.etaEpoch\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/);
    ok('L8a seed() 有 approx 分支(if let b, b.approx, let e2)', !!seedBranch,
       '(找不到 approx 分支——回到 build 73 的無條件照抄形狀)');
    if (seedBranch) {
      const [, approxBody, elseBody] = seedBranch;
      ok('L8b approx 路不寫 secondEta', !/st\.secondEta/.test(approxBody),
         '(approx 分支裡出現 st.secondEta=投影值又會被 .until 畫成秒)');
      ok('L8c approx 路以 ceil((e2 - now) / 60) 折整分鐘進 secondMinutes',
         /ceil\(\(e2\s*-\s*now\)\s*\/\s*60\)/.test(approxBody) && /st\.secondMinutes\s*=/.test(approxBody),
         approxBody.trim().slice(0, 120));
      ok('L8d approx 路有 m >= 1 閘(到期整行不畫,不出「約 0 分」)',
         /m\s*>=\s*1/.test(approxBody) && /st\.secondDest\s*=\s*m\s*>=\s*1/.test(approxBody),
         '(缺 m>=1 閘或 secondDest 沒跟著閘)');
      // 反向對照:官方列的照抄必須還在——沒有這條,「把 secondEta 整個刪掉」也能讓 L8b 全綠,
      // 但那會把北捷官方秒級倒數降級成分鐘,違反「有資訊就一定要對」。
      ok('L8e 官方路(else)照抄 st.secondEta = b?.etaEpoch', /st\.secondEta\s*=\s*b\?\.etaEpoch/.test(elseBody),
         elseBody.trim().slice(0, 120));
      ok('L8f 官方路同時保留 secondMinutes 與 secondDest',
         /st\.secondMinutes\s*=\s*b\?\.minutes/.test(elseBody) && /st\.secondDest\s*=\s*b\?\.dest/.test(elseBody),
         '(else 路少欄位)');
    }
    // 消費端契約:卡片把 secondEta 餵給 RailCountdown.until(秒級)、secondMinutes 餵給
    // approxMinutes——這正是 approx 不准進 secondEta 的原因;渲染偏好若改了,這組要重審。
    const actC = readFileSync(join(ROOT, 'app/ios/App/RailBoardWidget/MetroWaitActivity.swift'), 'utf8')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    ok('L8g MetroWaitActivity:secondEta→.until、secondMinutes→approxMinutes 的偏好序仍在',
       /secondEta[\s\S]{0,120}?RailCountdown\.until/.test(actC) &&
       /secondMinutes[\s\S]{0,120}?RailCountdown\.approxMinutes/.test(actC),
       '(渲染偏好變了——重審 L8 全組前提)');
  }
}

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
