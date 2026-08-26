// Stadia 期末推估的日窗與速率驗收。
//
// 為什麼要有這支:被修的兩個 bug 都是**靜默系統性偏差**——不會拋錯、不會變 0、
// 輸出永遠長得像個合理的數字。而它們的方向相反(進行中日 ⇒ 低估;濾掉零用量日 ⇒ 高估),
// 在真實資料上會**互相掩蓋**,所以「看起來差不多」完全不是證據。
// 期望值一律手算寫死在下面,不從實作反推(心得 29:判準的真值來源不得與實作同源)。
//
// 用法:node scripts/verify_stadia_projection.mjs
import { readFileSync } from 'node:fs';
import { dayWindow, rates } from './lib/stadia_projection.mjs';

const R = [];
const eq = (name, got, want) => R.push({
  name, pass: JSON.stringify(got) === JSON.stringify(want),
  detail: `得 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`,
});
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail });

// ── 形態 0:先證明我在量的是誰 ────────────────────────────────────────
// lib 自己對不代表 launch_watch 有在用它。這三條擋的是「受測物根本沒被接上」。
const LW_RAW = readFileSync(new URL('./launch_watch.mjs', import.meta.url), 'utf8');
// 🔴 剝掉行註解再比對:首跑就被自己咬到——launch_watch 那邊我留了一句
// 「這裡不可加 .filter(...)」的警語,警語**本身**含著要偵測的字串,純字串掃描於是假紅。
// 判準要問「程式碼有沒有這樣做」,不是「這幾個字有沒有出現過」。
const LW = LW_RAW.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
ok('0/launch_watch 有 import 這組純函式',
  /import \{ dayWindow, rates \} from '\.\/lib\/stadia_projection\.mjs'/.test(LW));
ok('0/舊的「拿進行中日當速率」已不存在', !/const hi = today\[1\]/.test(LW), 'const hi = today[1]');
ok('0/舊的「濾掉零用量日」已不存在', !/\.filter\(\(\[, v\]\) => v > 0\)/.test(LW), '.filter(([, v]) => v > 0)');

// ── A:進行中的 UTC 日 ────────────────────────────────────────────────
// 腳本在 UTC 01:30 跑,今天那格只有約 1.5/24 天的量。
const A = [['2026-08-23', 900_000], ['2026-08-24', 1_000_000], ['2026-08-25', 1_100_000], ['2026-08-26', 62_000]];
const wA = dayWindow(A, '2026-08-26');
eq('A/進行中日被切出來當 partial', wA.partial, ['2026-08-26', 62_000]);
eq('A/完整日只到昨天', wA.complete.map(([d]) => d), ['2026-08-23', '2026-08-24', '2026-08-25']);
const rA = rates(wA.complete);
eq('A/hi 是最後一個完整日,不是進行中那格', [rA.hi, rA.hiDay], [1_100_000, '2026-08-25']);
eq('A/lo 是近 3 完整日均值', [rA.lo, rA.loN], [1_000_000, 3]);
// 正向對照:舊算法在同一組輸入上會給出**不同**答案 ⇒ 這次改的是行為不是寫法。
// 舊 hi = 最後一格 = 62,000(只有真值的 5.6%)。低估 17.7 倍。
ok('A/正向對照:舊算法確實會低估', A[A.length - 1][1] !== rA.hi,
  `舊 hi=${A[A.length - 1][1]} / 新 hi=${rA.hi}(${(rA.hi / A[A.length - 1][1]).toFixed(1)} 倍)`);

// ── B:跨日之後跑(上游最後一格已經是完整日)────────────────────────────
const wB = dayWindow(A, '2026-08-27');
eq('B/沒有進行中那格時 partial 為 null', wB.partial, null);
eq('B/四天全部算完整日', wB.complete.length, 4);

// ── C:零用量日 ───────────────────────────────────────────────────────
// 手算:(100000 + 0 + 200000)/3 = 100000。舊算法濾掉中間那天 ⇒ (100000+200000)/2 = 150000,
// 高估 50%。這是「分母縮水」型的系統性偏差。
const C = [['2026-08-24', 100_000], ['2026-08-25', 0], ['2026-08-26', 200_000]];
const rC = rates(dayWindow(C, '2026-08-27').complete);
eq('C/零用量日算進均值的分母', [rC.lo, rC.loN], [100_000, 3]);
ok('C/正向對照:舊算法(濾掉零)確實會高估',
  (100_000 + 200_000) / 2 !== rC.lo, `舊 lo=150000 / 新 lo=${rC.lo}`);

// ── D:上游把整個計費期列出來、未來日為 0 ──────────────────────────────
// 這些格子不是「零用量」是「還沒發生」,混進均值會反過來系統性**低估**。
// 判準必須是日期不是數值——C 與 D 只差一個字,效果相反,兩條都要有才證明分得清。
const D = [['2026-08-24', 100_000], ['2026-08-25', 200_000], ['2026-08-26', 30_000],
           ['2026-08-27', 0], ['2026-08-28', 0]];
const wD = dayWindow(D, '2026-08-26');
eq('D/未來日被排除', wD.complete.map(([d]) => d), ['2026-08-24', '2026-08-25']);
eq('D/今天仍是 partial', wD.partial, ['2026-08-26', 30_000]);
eq('D/均值不被未來的 0 拉低', rates(wD.complete).lo, 150_000);

// ── E:期初資料不足 ──────────────────────────────────────────────────
// 回 0 會讓期末推估 = 現在的累計,看起來像「很安全」——最危險的假象,所以要回 null。
eq('E/沒有完整日時回 null 而不是 0', rates(dayWindow([['2026-08-26', 5_000]], '2026-08-26').complete), null);
eq('E/空序列也回 null', rates(dayWindow([], '2026-08-26').complete), null);

// ── F:窗不足時 loN 誠實反映實際取到幾日 ─────────────────────────────
const rF = rates(dayWindow([['2026-08-25', 100_000], ['2026-08-26', 300_000]], '2026-08-27').complete);
eq('F/只有 2 個完整日時 loN=2、均值除以 2', [rF.lo, rF.loN], [200_000, 2]);

// ── G:上游亂序也要對 ────────────────────────────────────────────────
// Object.entries 的順序不是規格保證的,launch_watch 已加 .sort();這裡驗 lib 對排序的依賴
// 是明講的(它假設升冪),亂序進來時「最後一個完整日」會是錯的——所以這條是**契約斷言**:
// 若哪天 sort 被拿掉,這條紅的會是 launch_watch 那邊,不是這裡。
ok('G/lib 對「日期升冪」的依賴有在 launch_watch 端被滿足',
  /\.sort\(\(a, b\) => a\[0\] < b\[0\] \? -1 : 1\)/.test(LW), 'daily 建立時要 sort');

let fail = 0;
for (const r of R) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`); }
console.log(`\n總計 ${R.length - fail}/${R.length} 通過`);
process.exit(fail ? 1 : 0);
