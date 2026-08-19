#!/usr/bin/env node
// 捷運小工具通行證閘門的差分驗收。
//
// 判準不同源(心得 29):真 Swift 的 MetroPlusCore 大括號抽取後裸編譯,對上這裡獨立寫的
// JS 期望模型(不是照抄 Swift,是照【裁示語意】重寫:免費一站、名額跟著現裝實例走、
// 自動選站要通行證、fail-open)。兩邊都算一次同一組情境,逐格比對。
//
// 另有 S 組原始碼斷言:守住「同批必須有明講 CTA」這條裁示——擋下的兩條路徑都要帶 passCTA,
// 且卡片檢視真的畫得出來(不是只放在 entry 裡沒人讀)。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(ROOT, 'app/ios/App/RailBoardWidget/MetroPlusGate.swift');
const WIDGET = join(ROOT, 'app/ios/App/RailBoardWidget/MetroBoardWidget.swift');
const INTENT = join(ROOT, 'app/ios/App/RailBoardWidget/MetroBoardIntent.swift');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  PASS ${n}`)) : (fail++, console.log(`  FAIL ${n} ${d}`)); };

for (const f of [GATE, WIDGET, INTENT]) {
  if (!existsSync(f)) { console.log(`FAIL 原始碼不存在: ${f}`); process.exit(1); }
}
const gateSrc = readFileSync(GATE, 'utf8');
const widgetSrc = readFileSync(WIDGET, 'utf8');
const intentSrc = readFileSync(INTENT, 'utf8');

// ── S 組:原始碼層的裁示守門 ─────────────────────────────────────────
ok('S1 freeStationLimit 已是 1(免費一站)',
   /freeStationLimit\s*:\s*Int\?\s*=\s*1\b/.test(intentSrc),
   (intentSrc.match(/freeStationLimit.*/) || ['(找不到)'])[0]);
// 🔴 這條是「明講 CTA」裁示的牙:兩條擋下路徑各自都要帶 passCTA,漏一條就是靜默空白卡。
const autoBranch = widgetSrc.match(/case \.needPassAuto:[\s\S]*?case \.needPassMulti/);
ok('S2 needPassAuto 帶 CTA 文案', !!autoBranch && /passCTA:\s*"/.test(autoBranch[0]));
const multiBranch = widgetSrc.match(/case \.needPassMulti[\s\S]*?case \.allowed/);
ok('S3 needPassMulti 帶 CTA 文案', !!multiBranch && /passCTA:/.test(multiBranch[0]));
// 🔴 這條原本綁「if let cta = entry.passCTA … Text(cta)」這個寫法，08-17 改版把判定收進
//    MetroEntry.emptyBody（就是為了讓混合大卡也講同一句，它以前完全不講）之後就變成假紅。
//    改成驗資料流與去處，不綁寫法：CTA 從 emptyBody 出來 → 有人畫成 Text → 而且與錯誤訊息
//    在視覺上分得開（isCTA 分支）→ 且兩張卡都走這個出口。
const emptyBodyFn = widgetSrc.match(/func emptyBody\(at date: Date\)[\s\S]*?\n    \}/);
ok('S4a passCTA 會從 emptyBody 流出來',
   !!emptyBodyFn && /passCTA/.test(emptyBodyFn[0]) && /true\)/.test(emptyBodyFn[0]));
ok('S4b 有人把 emptyBody 的字畫成 Text',
   /emptyBody\(at: entry\.date\)/.test(widgetSrc) && /Text\(body\.text\)/.test(widgetSrc));
ok('S4c CTA 與錯誤訊息視覺分得開', /body\.isCTA \?/.test(widgetSrc));
ok('S4d 混合大卡走同一個出口(它曾經完全不講付費被擋)',
   /emptyBody\(at: entry\.date\)/.test(readFileSync(
     join(ROOT, 'app/ios/App/RailBoardWidget/MixedBoardWidget.swift'), 'utf8')));
ok('S5 擋下時給得出去處(deepLink 指向通行證頁)',
   /passLink\(\)/.test(widgetSrc) && /host = "pass"/.test(widgetSrc));
// 閘門必須在抓取與定位之前:否則被擋的人照樣打官方 API、照樣叫醒定位。
const gateIdx = widgetSrc.indexOf('MetroPlusGate.evaluate');
const fetchIdx = widgetSrc.indexOf('MetroFetcher.fetch');
const nearestIdx = widgetSrc.indexOf('MetroNearest.resolve');
ok('S6 閘門在抓取與定位之前', gateIdx > 0 && gateIdx < fetchIdx && gateIdx < nearestIdx,
   `gate=${gateIdx} fetch=${fetchIdx} nearest=${nearestIdx}`);

// ── 差分:抽真 Swift 核心編譯,對上獨立 JS 模型 ──────────────────────
function extractDeclaration(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error(`抽不到宣告: ${header}`);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error(`大括號不平衡: ${header}`);
}
const core = extractDeclaration(gateSrc, 'enum MetroPlusCore');
const decision = extractDeclaration(gateSrc, 'enum MetroPlusDecision');

// 情境表:每格 [plus, limit, isAuto, current, claimed[], configured[], slots]
// slots ＝目前現裝的「捷運格」數(一張捷運小卡恆為一格,連還沒選站的也算;混合大卡只有真的
// 設了捷運站才算)。它與 configured 是**兩件事**:configured 是系統枚舉回來的【已生效】站鍵,
// 編輯中的那張卡在這裡仍然是舊站;slots 數的是卡片張數,不受那個舊值影響。
const CASES = [
  ['通行證+自動', true, 1, true, 'auto', [], [], 0],
  ['通行證+第二站', true, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山'], 2],
  ['全免費(limit=nil)+自動', false, null, true, 'auto', [], [], 0],
  ['免費+自動 → 擋', false, 1, true, 'auto', [], [], 0],
  ['免費+首站 → 佔名額', false, 1, false, 'trtc|板橋', [], [], 1],
  ['免費+同一站再算 → 放行', false, 1, false, 'trtc|板橋', ['trtc|板橋'], ['trtc|板橋'], 1],
  ['免費+第二站 → 擋', false, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山'], 2],
  ['免費+換站(舊 claim 已不在) → 補位', false, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|中山'], 1],
  ['免費+未選站 → 不擋', false, 1, false, null, ['trtc|板橋'], ['trtc|板橋'], 1],
  ['免費+枚舉失敗 → fail-open', false, 1, false, 'trtc|中山', ['trtc|板橋'], [], 0],
  ['免費+limit=2 第二站 → 佔名額', false, 2, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山'], 2],
  // 🔴 2026-08-16 新增:名額累積成兩筆的情境。舊 claim 在「換站」時只會被 configured 過濾掉、
  //    不會從陣列裡刪除 ⇒ claimed 單調成長([甲] → 換到乙 → [甲,乙]);使用者日後只要再放一張卡
  //    設回甲,兩筆 claim 同時復活、兩站都被判 allowed ＝ 免費拿到兩站。這條**不需要任何競態**,
  //    從沒訂過通行證的人也做得到,而且可以重複操作到 N 站。裁示是「免費一站」,故期望模型
  //    照裁示寫成「最多 limit 個名額算數」,與 Swift 實作是否這樣寫無關(心得 29:判準不得同源)。
  ['免費+claim 累積兩筆:較早那筆 → 放行', false, 1, false, 'trtc|板橋', ['trtc|板橋', 'trtc|中山'], ['trtc|板橋', 'trtc|中山'], 2],
  ['免費+claim 累積兩筆:較晚那筆 → 擋', false, 1, false, 'trtc|中山', ['trtc|板橋', 'trtc|中山'], ['trtc|板橋', 'trtc|中山'], 2],
  ['免費+claim 累積三筆:第三筆 → 擋', false, 1, false, 'trtc|忠孝復興', ['trtc|板橋', 'trtc|中山', 'trtc|忠孝復興'], ['trtc|板橋', 'trtc|中山', 'trtc|忠孝復興'], 3],
  ['免費+limit=2 累積三筆:第三筆 → 擋', false, 2, false, 'trtc|忠孝復興', ['trtc|板橋', 'trtc|中山', 'trtc|忠孝復興'], ['trtc|板橋', 'trtc|中山', 'trtc|忠孝復興'], 3],
  // 🔴 2026-08-17 真機回報:「只有一張小工具,選完站以後想換站卻被告知要訂閱」。
  //    換站當下 WidgetCenter 枚舉回來的仍是【換站前】的舊站(設定要退出編輯才生效),
  //    於是舊站與待生效的新站在閘門眼裡長得像兩張卡兩站 ⇒ 使用者被自己的卡擋住。
  //    裁示是「免費一站」,不是「免費一個站名、選了就不准改」——一張卡一次只顯示一站,
  //    現裝格數沒超過名額時結構上不可能超額,無論枚舉回來的是新值還是舊值。
  ['免費+單卡換站(枚舉仍是舊站) → 放行', false, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋'], 1],
  ['免費+單卡換站(已生效) → 放行', false, 1, false, 'trtc|中山', ['trtc|板橋', 'trtc|中山'], ['trtc|中山'], 1],
  ['免費+limit=2 兩卡換其中一張 → 放行', false, 2, false, 'trtc|忠孝復興', ['trtc|板橋', 'trtc|中山'], ['trtc|板橋', 'trtc|中山'], 2],
  // 🔴 反向對照(沒有它,上面三條可以被「乾脆別擋了」通過):第二張卡【剛放上桌面、自己那格
  //    還沒選站】時 configured 與上面第一條一模一樣,只有 slots 不同 ⇒ 必須擋。
  //    這也是 slots 要把「還沒選站的捷運小卡」算進去的理由:不算的話這裡會先放行、
  //    等使用者退出編輯才翻臉成 CTA。
  ['免費+第二張卡編輯中(該格未選站) → 擋', false, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋'], 2],
  ['免費+第三張卡編輯中 → 擋', false, 2, false, 'trtc|忠孝復興', ['trtc|板橋', 'trtc|中山'], ['trtc|板橋', 'trtc|中山'], 3],
];

// 獨立期望模型:照裁示語意重寫,刻意不看 Swift 實作。
// 🔴 裁示是「免費【一】站」⇒ 不論 claimed 陣列長成什麼樣,任何時刻最多只有 limit 個站鍵算數。
//    這一行(prefix(limit))就是「一站」這三個字;少了它,模型會退化成 Swift 實作的鏡子,
//    而鏡子照不出上面那三條累積情境(2026-08-16 前的版本正是如此,所以漏了整整一個洞)。
function expected(plus, limit, isAuto, current, claimed, configured, slots) {
  if (plus) return 'allowed';
  if (limit === null) return 'allowed';
  if (isAuto) return 'needPassAuto';
  if (!current) return 'allowed';
  const live = claimed.filter(k => configured.includes(k)).slice(0, limit);
  if (live.includes(current)) return 'allowed';
  if (live.length < limit) return 'claimFree';
  // 🔴 裁示算的是「同時看得到幾站」,不是「這個站名有沒有被登記過」。一張卡一次只顯示一站,
  //    所以現裝格數 ≤ 名額時超額是結構上不可能的事,claim 表與枚舉值再怎麼過期都改變不了。
  //    擋人的責任因此完全落在「卡片張數真的超過名額」這一種情形上。
  if (slots <= limit) return 'claimFree';
  return 'needPassMulti';
}

const dir = mkdtempSync(join(tmpdir(), 'plusgate-'));
const swiftLines = CASES.map(([name, plus, limit, isAuto, current, claimed, configured, slots]) => {
  const lim = limit === null ? 'nil' : String(limit);
  const cur = current === null ? 'nil' : `"${current}"`;
  const arr = a => `[${a.map(s => `"${s}"`).join(', ')}]`;
  return `probe("${name}", MetroPlusCore.decide(plus: ${plus}, limit: ${lim}, isAuto: ${isAuto}, `
       + `current: ${cur}, claimed: ${arr(claimed)}, configured: ${arr(configured)}, slots: ${slots}))`;
}).join('\n');

const harness = `${decision}\n${core}\n
func probe(_ name: String, _ d: MetroPlusDecision) {
    let tag: String
    switch d {
    case .allowed: tag = "allowed"
    case .claimFree: tag = "claimFree"
    case .needPassAuto: tag = "needPassAuto"
    case .needPassMulti: tag = "needPassMulti"
    }
    print("\\(name)\\t\\(tag)")
}
${swiftLines}
`;
const srcPath = join(dir, 'main.swift');
writeFileSync(srcPath, harness);
let out;
try {
  execFileSync('xcrun', ['swiftc', '-O', srcPath, '-o', join(dir, 'probe')], { stdio: 'pipe' });
  out = execFileSync(join(dir, 'probe'), { encoding: 'utf8' });
} catch (e) {
  console.log(`FAIL 差分編譯/執行失敗: ${(e.stderr || e.message || '').toString().slice(0, 900)}`);
  process.exit(1);
}
const got = new Map(out.trim().split('\n').map(l => l.split('\t')));
for (const [name, plus, limit, isAuto, current, claimed, configured, slots] of CASES) {
  const want = expected(plus, limit, isAuto, current, claimed, configured, slots);
  ok(`D ${name} → ${want}`, got.get(name) === want, `Swift=${got.get(name)} JS=${want}`);
}
// 🔴 覆蓋率具名斷言(心得 37d):情境表每一格都要真的被 Swift 那側回答到,
//    分母無聲縮水(harness 少印一行)必須是 FAIL,不能只印在 detail。
ok('D 覆蓋率 每個情境都被比對到', got.size === CASES.length, `${got.size}/${CASES.length}`);

console.log(`[total] PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
