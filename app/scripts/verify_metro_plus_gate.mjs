#!/usr/bin/env node
// 捷運小工具通行證閘門的差分驗收。
//
// 判準不同源(心得 29):真 Swift 的 MetroPlusCore 大括號抽取後裸編譯,對上這裡獨立寫的
// JS 期望模型(不是照抄 Swift,是照【裁示語意】重寫:免費一站、名額跟著現裝實例走、
// 自動選站要通行證、fail-open)。兩邊都算一次同一組情境,逐格比對。
//
// 另有 S 組原始碼斷言:守住「同批必須有明講 CTA」這條裁示——擋下的兩條路徑都要帶 passCTA,
// 且卡片檢視真的畫得出來(不是只放在 entry 裡沒人讀)。
// A 組守 Android 的同一件事(MULTI_STATION_NEEDS_PASS 與 passUnlocked),C 組守文案(方案面板、條款、
// 說明中心與英日文)。2026-10-05 起由 app/scripts/verify-release.mjs 在出 App 時呼叫。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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
// 🔴 2026-10-05 起 freeStationLimit = nil:多站與自動對所有人免費(即時資訊不設付費門檻是
//    資料授權的條件)。S2 以下守的 CTA 路徑仍保留,limit 改回數字時照樣要講清楚。
ok('S1 freeStationLimit 是 nil(多站與自動免費)',
   /freeStationLimit\s*:\s*Int\?\s*=\s*nil\b/.test(intentSrc),
   (intentSrc.match(/freeStationLimit.*/) || ['(找不到)'])[0]);
// 🔴 這條是「明講 CTA」裁示的牙:兩條擋下路徑各自都要帶 passCTA,漏一條就是靜默空白卡。
const autoBranch = widgetSrc.match(/case \.needPassAuto:[\s\S]*?case \.needPassMulti/);
ok('S2 needPassAuto 帶 CTA 文案', !!autoBranch
   && /passCTA:\s*(?:RailNativeL10n\.text\()?"[^"\n]+"/.test(autoBranch[0]));
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
   /emptyBody\(at: entry\.date\)/.test(widgetSrc)
   && /Text\(\s*(?:RailNativeL10n\.text\()?body\.text/.test(widgetSrc));
ok('S4c CTA 與錯誤訊息視覺分得開', /body\.isCTA \?/.test(widgetSrc));
ok('S4d 混合大卡走同一個出口(它曾經完全不講付費被擋)',
   /emptyBody\(at: entry\.date\)/.test(readFileSync(
     join(ROOT, 'app/ios/App/RailBoardWidget/MixedBoardWidget.swift'), 'utf8')));
ok('S5 擋下時給得出去處(deepLink 指向通行證頁)',
   /passLink\(\)/.test(widgetSrc) && /host = "pass"/.test(widgetSrc));
// 閘門必須在抓取與定位之前:否則被擋的人照樣打官方 API、照樣叫醒定位。
// 比的是程式碼的位置,整行註解先拿掉(檔頭註解提到 MetroNearest.resolve 會讓這條假紅)。
const widgetCode = widgetSrc.replace(/^\s*\/\/.*$/gm, '');
const gateIdx = widgetCode.indexOf('MetroPlusGate.evaluate');
const fetchIdx = widgetCode.indexOf('MetroFetcher.fetch');
const nearestIdx = widgetCode.indexOf('MetroNearest.resolve');
ok('S6 閘門在抓取與定位之前', gateIdx > 0 && gateIdx < fetchIdx && gateIdx < nearestIdx,
   `gate=${gateIdx} fetch=${fetchIdx} nearest=${nearestIdx}`);
// S1 只看宣告、D 只看核心;evaluate 若改傳寫死的數字,兩邊都照樣綠。這條守接線。
const gateCode = gateSrc.replace(/^\s*\/\/.*$/gm, '');
const evaluateFn = gateCode.match(/static func evaluate\([\s\S]*?\n    \}/);
ok('S7 evaluate 把 MetroBoardIntent.freeStationLimit 原樣傳給 decide',
   !!evaluateFn && /MetroPlusCore\.decide\([\s\S]*?\blimit:\s*MetroBoardIntent\.freeStationLimit\s*,/.test(evaluateFn[0]),
   evaluateFn ? '' : '(找不到 evaluate)');

// ── A 組:Android 的同一件事 ─────────────────────────────────────────
// 🔴 2026-10-05 起 MULTI_STATION_NEEDS_PASS = false,與 iOS 的 nil 同義。原生小工具判定一律經
//    passUnlocked();任何地方直接讀 plus_active 去擋人,沒通行證的使用者就會被悄悄擋回去。
//    只掃 src/main(出貨碼);debug 的 WidgetGalleryActivity 不進正式版。
const ANDROID_DIR = join(ROOT, 'app/android/app/src/main/java/tw/railisland/app');
const androidSrc = name => readFileSync(join(ANDROID_DIR, name), 'utf8');
const stripJava = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
const providerCode = stripJava(androidSrc('MetroWidgetProvider.java'));
ok('A1 MULTI_STATION_NEEDS_PASS 是 false(多站與自動免費)',
   /static final boolean MULTI_STATION_NEEDS_PASS\s*=\s*false\s*;/.test(providerCode),
   (providerCode.match(/MULTI_STATION_NEEDS_PASS\s*=.*/) || ['(找不到)'])[0]);
const unlockFn = providerCode.match(/static boolean passUnlocked\(SharedPreferences prefs\)\s*\{([\s\S]*?)\}/);
ok('A2 passUnlocked 先看旗標才看 plus_active',
   !!unlockFn && /^\s*return\s+!MULTI_STATION_NEEDS_PASS\s*\|\|\s*prefs\.getBoolean\("plus_active",\s*false\)\s*;\s*$/.test(unlockFn[1]),
   unlockFn ? unlockFn[1].trim() : '(找不到 passUnlocked)');
// 直接讀 plus_active 只准出現在 passUnlocked 本體,以及兩個設定頁的通行證說明(那兩列的顯示要綁旗標,見 A4)。
const NOTE_PAGES = ['MetroWidgetConfigActivity.java', 'MixedWidgetConfigActivity.java'];
const strayReads = [];
for (const name of readdirSync(ANDROID_DIR).filter(n => n.endsWith('.java'))) {
  let code = stripJava(androidSrc(name));
  if (name === 'MetroWidgetProvider.java' && unlockFn) code = code.replace(unlockFn[0], unlockFn[0].replace(/[^\n]/g, ' '));
  if (NOTE_PAGES.includes(name)) continue;
  code.split('\n').forEach((line, i) => { if (/getBoolean\(\s*"plus_active"/.test(line)) strayReads.push(`${name}:${i + 1}`); });
}
ok('A3 passUnlocked 以外沒有人直接讀 plus_active 去判定', strayReads.length === 0, strayReads.join(', '));
for (const name of NOTE_PAGES) {
  const code = stripJava(androidSrc(name));
  ok(`A4 ${name} 的通行證說明只在需要通行證時顯示`,
     /\.setVisibility\(\s*MetroWidgetProvider\.MULTI_STATION_NEEDS_PASS\s*\?\s*View\.VISIBLE\s*:\s*View\.GONE\s*\)/.test(code));
}
ok('A5 「自動（最近的站）」只在需要通行證時才標通行證',
   /MULTI_STATION_NEEDS_PASS\s*\?\s*"自動（最近的站・通行證）"\s*:\s*"自動（最近的站）"/.test(stripJava(androidSrc('MetroWidgetConfigActivity.java'))));

// ── C 組:文案不得再把小工具多站／自動講成付費 ────────────────────────────
// 方案面板、條款第 3 節、說明中心的通行證與小工具兩節(兩個平台的版本)和它們的英日文,都是付款決定點,
// 任何一處講回付費都是不實說法。逐子句比對,講「免費」的子句不算:
//   C1 通行證功能清單裡,同一子句不准同時講到小工具與多站／自動;
//   C2 小工具那節裡提到通行證的字串,只准是鎖定畫面跟車那一句(且不准提多站／自動),也不准出現「免費一站」這種額度說法。
// C0 先拿改版前的實際舊文案當正向對照,證明偵測器真的會紅。
const WIDGET_W = /小工具|widget|ウィジェット/i;
const MULTI_W = /多站|自動（最近的站|自動\(最近的站|自動選站|最近的站|multiple stations|several stations|nearest station|Auto \(nearest|Automatic \(nearest|複数の駅|複数駅|最寄り駅/i;
const PASS_W = /通行證|\bPass\b|パス(?!ポート)/;
const FREE_W = /免費|\bfree\b|無料/i;
const QUOTA_W = /一站|one station|1 ?駅|一駅/i;
const LOCK_W = /鎖定畫面|lock screen|ロック画面/i;
const FOLLOW_W = /跟隨|跟車|follow|追跡/i;
const clauses = text => String(text).split(/[、，；。;：:・•\n]|(?<=[.!?])\s+|,\s/).map(c => c.trim()).filter(Boolean);
const paidListHits = text => clauses(text).filter(c => WIDGET_W.test(c) && MULTI_W.test(c) && !FREE_W.test(c));
const widgetSecHits = text => [
  ...(PASS_W.test(text) && !(LOCK_W.test(text) && FOLLOW_W.test(text) && !MULTI_W.test(text)) ? [text] : []),
  ...clauses(text).filter(c => FREE_W.test(c) && QUOTA_W.test(c)),
];
ok('C0 偵測器對改版前的舊文案會紅',
   paidListHits('iPhone 捷運小工具放多站，或用「自動（最近的站）」跟著你移動換站').length > 0
   && paidListHits('· Metro widgets showing several stations at once, or "Automatic (nearest station)" that follows you as you move').length > 0
   && paidListHits('・メトロのウィジェットに複数の駅を表示、または「自動（最寄り駅）」で移動に合わせて切り替え').length > 0
   && widgetSecHits('捷運免費可設定一站；想放多站或用「自動（最近的站）」需啟用軌島通行證').length > 0
   && widgetSecHits('想放多站，或用自動選站，需要軌島通行證').length > 0
   && widgetSecHits('跟隨台鐵或高鐵列車時，通行證也能把下一站進度放上鎖定畫面').length === 0);

const readRoot = rel => readFileSync(join(ROOT, rel), 'utf8');
const indexSrc = readRoot('index.html');
const I18N_SRC = ['i18n/translations.js', 'i18n/content-translations.js'].map(readRoot);
const between = (src, a, b) => { const i = src.indexOf(a); const j = i < 0 ? -1 : src.indexOf(b, i + a.length); return j < 0 ? '' : src.slice(i, j); };
const zhLiterals = block => [...block.replace(/^\s*\/\/.*$/gm, '').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)]
  .map(m => m[1].replace(/<\/?b>/g, '')).filter(s => /[一-鿿]{2}/.test(s));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const translationsOf = zh => I18N_SRC.flatMap(src =>
  [...src.matchAll(new RegExp(`'${reEsc(zh)}'\\s*:\\s*'((?:[^'\\\\\\n]|\\\\.)*)'`, 'g'))].map(m => m[1]));
const blockTexts = block => { const zh = zhLiterals(block); const tr = zh.flatMap(translationsOf); return { zh, tr, all: [...zh, ...tr] }; };

const feats = blockTexts(between(indexSrc, 'const feats = [', '].map(feature'));
const plusSec = blockTexts(between(indexSrc, "{ key: 'plus', ic: '票'", "try: 'plus' }"));
const widgetSec = blockTexts(between(indexSrc, "{ key: 'metrowidget', ic: '桌'", 'widgets: helpIsAndroid'));
const terms3 = between(readRoot('terms.html'), '<h2>3. 軌島通行證</h2>', '<h2>4.').replace(/<[^>]+>/g, ' ');
const legalLines = readRoot('i18n/legal-translations.js').split('\n');
ok('C 覆蓋 方案面板、說明中心兩節、條款第 3 節都抽得到,且三段都對得到英日文',
   [feats, plusSec, widgetSec].every(b => b.zh.length > 0 && b.tr.length > 0) && terms3.length > 100,
   `方案面板 ${feats.zh.length}/${feats.tr.length}、通行證節 ${plusSec.zh.length}/${plusSec.tr.length}、`
   + `小工具節 ${widgetSec.zh.length}/${widgetSec.tr.length}、條款第 3 節 ${terms3.length} 字`);
const c1 = [
  ...[...feats.all, ...plusSec.all, terms3].flatMap(paidListHits),
  ...legalLines.flatMap((line, i) => paidListHits(line).map(c => `legal-translations.js:${i + 1} ${c}`)),
];
ok('C1 通行證功能清單沒有把小工具多站／自動列進去', c1.length === 0, c1.slice(0, 4).join(' | '));
const c2 = widgetSec.all.flatMap(widgetSecHits);
ok('C2 小工具那節沒有把多站／自動講成要通行證', c2.length === 0, c2.slice(0, 4).join(' | '));

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
  ['全免費(limit=nil)+第三站', false, null, false, 'trtc|忠孝復興', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山', 'trtc|忠孝復興'], 3],
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
