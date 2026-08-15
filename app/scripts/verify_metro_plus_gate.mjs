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
ok('S4 檢視真的畫得出 passCTA',
   /if let cta = entry\.passCTA[\s\S]{0,400}Text\(cta\)/.test(widgetSrc));
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

// 情境表:每格 [plus, limit, isAuto, current, claimed[], configured[]]
const CASES = [
  ['通行證+自動', true, 1, true, 'auto', [], []],
  ['通行證+第二站', true, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山']],
  ['全免費(limit=nil)+自動', false, null, true, 'auto', [], []],
  ['免費+自動 → 擋', false, 1, true, 'auto', [], []],
  ['免費+首站 → 佔名額', false, 1, false, 'trtc|板橋', [], []],
  ['免費+同一站再算 → 放行', false, 1, false, 'trtc|板橋', ['trtc|板橋'], ['trtc|板橋']],
  ['免費+第二站 → 擋', false, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山']],
  ['免費+換站(舊 claim 已不在) → 補位', false, 1, false, 'trtc|中山', ['trtc|板橋'], ['trtc|中山']],
  ['免費+未選站 → 不擋', false, 1, false, null, ['trtc|板橋'], ['trtc|板橋']],
  ['免費+枚舉失敗 → fail-open', false, 1, false, 'trtc|中山', ['trtc|板橋'], []],
  ['免費+limit=2 第二站 → 佔名額', false, 2, false, 'trtc|中山', ['trtc|板橋'], ['trtc|板橋', 'trtc|中山']],
];

// 獨立期望模型:照裁示語意重寫,刻意不看 Swift 實作。
function expected(plus, limit, isAuto, current, claimed, configured) {
  if (plus) return 'allowed';
  if (limit === null) return 'allowed';
  if (isAuto) return 'needPassAuto';
  if (!current) return 'allowed';
  const live = claimed.filter(k => configured.includes(k));
  if (live.includes(current)) return 'allowed';
  if (live.length < limit) return 'claimFree';
  return 'needPassMulti';
}

const dir = mkdtempSync(join(tmpdir(), 'plusgate-'));
const swiftLines = CASES.map(([name, plus, limit, isAuto, current, claimed, configured]) => {
  const lim = limit === null ? 'nil' : String(limit);
  const cur = current === null ? 'nil' : `"${current}"`;
  const arr = a => `[${a.map(s => `"${s}"`).join(', ')}]`;
  return `probe("${name}", MetroPlusCore.decide(plus: ${plus}, limit: ${lim}, isAuto: ${isAuto}, `
       + `current: ${cur}, claimed: ${arr(claimed)}, configured: ${arr(configured)}))`;
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
for (const [name, plus, limit, isAuto, current, claimed, configured] of CASES) {
  const want = expected(plus, limit, isAuto, current, claimed, configured);
  ok(`D ${name} → ${want}`, got.get(name) === want, `Swift=${got.get(name)} JS=${want}`);
}
// 🔴 覆蓋率具名斷言(心得 37d):情境表每一格都要真的被 Swift 那側回答到,
//    分母無聲縮水(harness 少印一行)必須是 FAIL,不能只印在 detail。
ok('D 覆蓋率 每個情境都被比對到', got.size === CASES.length, `${got.size}/${CASES.length}`);

console.log(`[total] PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
