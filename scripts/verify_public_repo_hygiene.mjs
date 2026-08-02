// 公開 repo 衛生檢查:掃「本分支新增的行」有沒有把內部成本／額度用量／金鑰類資訊寫進 repo。
//
// 為什麼需要這支:2026-08-02 的 Plus 批次,Global Constraint 第一行就寫著
// 「本 repo 是 PUBLIC,內部成本資訊不得寫進 index.html／worker.js／docs/／測試檔」——
// 而**寫下那條約束的人(我)在同一個檔案裡違反了三次**:一處在驗收腳本註解、兩處在計畫檔,
// 型態分別是用量比例、計費期區間、以及「已用百分比＋見底日期＋超額費率」。
// 複審只抓到其中一處。**散文寫的約束不會自己執行**,所以把它變成會紅的判準。
//
// ⚠️ 本檔自己也在掃描範圍內,所以下面的對照樣本一律用**明顯造假的數值**(99.9%、01-01、$9.99)。
//    第一版拿真實字串當樣本,結果這支腳本自己就是最大的一處洩漏——
//    執法的機制必須自己先守法,而對照要驗的是「形狀」不是「那個真值」。
//
// 只掃「新增行」(diff 的 +):既有的違規另案處理,不讓存量把新增的淹沒;
// 也避免把 origin/main 既有的設計說明(「Esri 額度止血用」這類無數字的機制描述)算進來。
//
// 用法:node scripts/verify_public_repo_hygiene.mjs [base]   base 預設 origin/main
import { execFileSync } from 'node:child_process';

const ARGV = process.argv.slice(2);
// 無法辨識的旗標直接 exit 2,不要當成 base 吃下去:`-allow-history-hits=30`(少打一個 `-`)
// 原本會被 `!a.startsWith('--')` 判成 base,`git merge-base` 再吐一個看不懂的錯——
// 打錯字的懲罰應該是一句清楚的用法說明,不是一個假的掃描基準。
const badFlags = ARGV.filter(a => a.startsWith('-') && !/^--allow-history-hits=/.test(a));
if (badFlags.length) {
  console.error(`無法辨識的參數:${badFlags.join(' ')}\n用法:node scripts/verify_public_repo_hygiene.mjs [base] [--allow-history-hits=<N>]`);
  process.exit(2);
}
const BASE = ARGV.find(a => !a.startsWith('-')) || 'origin/main';
// 🔴 具名容忍(不是靜默上限):歷史命中要求的動作是「push 前 squash 或改寫那幾顆 commit」,
// 那是合併時才做得到的事,所以允許在合併之前明示放行——但必須是**呼叫者打出來的一個決定**,
// 而且要印出容忍了什麼、幾筆。此前這一整類完全不影響 exit code ⇒ 只看 exit code 的自動化
// 會把「21 筆待處理」讀成「全都掃過了」,靜默的上限會被讀成通行證。
//   用法:--allow-history-hits=<N>   (未給＝0＝一筆都不容忍)
const ALLOW_HIST_ARG = ARGV.find(a => a.startsWith('--allow-history-hits='));
const ALLOW_HIST = ALLOW_HIST_ARG ? Number(ALLOW_HIST_ARG.split('=')[1]) : 0;
if (!Number.isInteger(ALLOW_HIST) || ALLOW_HIST < 0) {
  console.error(`--allow-history-hits 要一個非負整數,收到:${ALLOW_HIST_ARG}`);
  process.exit(2);
}

// 禁的是「具體數值」,不是「提到成本」——機制說明(「額度吃緊時改 false」)必須留著,
// 否則維護的人看不懂那個開關為什麼存在。所以每條 pattern 都綁著數字或金額符號。
const RULES = [
  { name: '額度／用量百分比', re: /(額度|用量|配額|quota)[^\n]{0,20}\d+(\.\d+)?\s*[%％]/ },
  // ⚠️ 這兩條原本寫成「關鍵詞在前、數字在後」的單一順序,被正向對照當場咬出來:
  //    真實洩漏的語序是反的(「佔…用量約N成」關鍵詞在後、「估 MM-DD 見底」日期在前)。
  //    沒有對照的話,這兩條會是永遠的死規則,而它們正是要抓當天那兩處真洩漏的。
  { name: '用量比例(中文數字)', re: /(額度|用量|配額)[^\n]{0,12}[一二三四五六七八九]成/ },
  { name: '「第 N/M 天已用」型進度', re: /第\s*\d+\s*\/\s*\d+\s*天[^\n]{0,10}已用/ },
  // 這條原本也只認一種語序(符號在前),與上面兩條同病——複審指出「同一批修好了兩條卻沒把
  // 同一課套用到第三條」。補上中文語序:「每千次…收費 N 美元」。
  { name: '金額費率', re: /((\$|US\$|美元|NT\$)\s*\d+(\.\d+)?\s*\/\s*(千|萬|月|年|k))|(每\s*(千|萬)[^\n]{0,12}\d+(\.\d+)?\s*(美元|元|美金))/ },
  { name: '計費期日期區間', re: /計費期[^\n]{0,6}\d{1,2}-\d{1,2}\s*[→~-]\s*\d{1,2}-\d{1,2}/ },
  { name: '見底／耗盡日期推估', re: /((見底|耗盡|用完)[^\n]{0,12}\d{1,2}[-\/月]\d{1,2})|(\d{1,2}[-\/月]\d{1,2}[^\n]{0,12}(見底|耗盡|用完))/ },
  { name: '疑似金鑰字串', re: /(AAPT|sk-|ghp_|AIza)[A-Za-z0-9_\-]{12,}/ },
];

// 🔴 正向對照:pattern 打錯一個字,整支就變成永遠的綠燈(判準盲點形態 11)。
// 每條規則都先餵一句「一定要被咬住」的樣本,咬不住就直接 FAIL,不進主掃描。
// 這些樣本**必然**會命中自己的 pattern(那正是它們的用途),所以每行掛 ALLOW 標記讓主掃描跳過。
// 用「逐行標記」而不是「整個檔案豁免」:這個檔案的其他部分仍然要被掃,
// 否則它就變成 repo 裡唯一一個可以藏東西的地方——而它剛好是最容易被信任、最少被讀的檔。
const CONTROLS = [
  ['額度／用量百分比', '本期額度已用 99.9%'], // hygiene:allow-sample
  ['用量比例(中文數字)', '某端佔某服務用量約九成'], // hygiene:allow-sample
  ['「第 N/M 天已用」型進度', '第 99/99 天已用 99.9%'], // hygiene:allow-sample
  ['金額費率', '之後 $9.99/千'], // hygiene:allow-sample
  ['計費期日期區間', '本期計費期 01-01→01-31'], // hygiene:allow-sample
  ['見底／耗盡日期推估', '估 01-01 見底'], // hygiene:allow-sample
  ['疑似金鑰字串', 'token=AAPTxFakeKeyForControl123'], // hygiene:allow-sample
];
// 刻意拆成兩段字串:寫成完整字面的話,這一行自己就帶著標記 ⇒ 被算成第 8 個豁免。
// (上面那條「豁免數必須等於對照數」的斷言第一次跑就咬到了這個 off-by-one,留著當它有牙的證據。)
const ALLOW = 'hygiene:allow' + '-sample';

let failed = 0;
const ok = (pass, msg) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${msg}`); if (!pass) failed++; };

// 🔴 對照樣本裡准許出現的數字,只有這些「一看就假」的。
// 為什麼需要這條:豁免機制只認標記、不看內容 ⇒ 有人把樣本從 99.9% 換成真實的百分比,
// 標記還在、豁免數還是 7、pattern 照樣咬得住 ⇒ **全綠,而真數字就這樣躺在公開 repo 裡**。
// (複審用突變實測過:換成真數字後 ALL PASS / exit 0。)
// 反過來白名單化「什麼數字算假」就擋得住,而且**不必在這裡寫出任何真數字**
// ——寫出來就等於又洩漏一次,那正是這支腳本 v1 犯的錯。
const FAKE_TOKENS = ['99.9', '99', '9.99', '01', '31', '123'];
function digitsAreObviouslyFake(s) {
  const nums = s.match(/\d+(\.\d+)?/g) || [];
  return nums.every(n => FAKE_TOKENS.includes(n));
}

console.log('── 正向對照:每條 pattern 都必須咬得住已知樣本 ──');
for (const [name, sample] of CONTROLS) {
  const rule = RULES.find(r => r.name === name);
  ok(!!rule && rule.re.test(sample), `對照「${name}」咬得住樣本 — ${sample}`);
  ok(digitsAreObviouslyFake(sample), `對照「${name}」的數字全是造假值(沒有人偷換成真數字)`);
}
// 每條 RULE 都必須有對照,否則新增的 pattern 會悄悄變成沒人驗過的死規則(形態 11)。
// 複審實測:加第 8 條 RULE 不加對照,舊版仍 ALL PASS——覆蓋率原本只是人工維持的巧合。
const missing = RULES.filter(r => !CONTROLS.some(c => c[0] === r.name)).map(r => r.name);
ok(missing.length === 0 && RULES.length === CONTROLS.length,
  `每條 RULE 都配得到對照 — RULES=${RULES.length} CONTROLS=${CONTROLS.length}${missing.length ? ' 缺:' + missing.join('、') : ''}`);

// 🔴 解析器抽成純函式:主掃描、歷史掃描、以及下面的自檢樣本全部走**同一條路徑**。
// 為什麼:此前兩段掃描各有一份 `line.startsWith('+')`,而歷史掃描的自檢是 `histCommits > 0`
// ——那數的是 commit 顆數,跟真正會壞掉的那一層(`+` 行解析)不同層。複審實測:只改壞歷史那份,
// 腳本從「歷史命中 21 筆 exit 1」變成「ALL PASS 歷史命中 0 筆 exit 0」,而自檢照樣印綠。
// 今天有 21 筆真命中在撐著才看得出不對;**squash 之後「命中 0」會變成合法常態**,
// 那時這個失效模式就再也分不出來了——而 squash 正是出貨路徑上的既定步驟。
// 正向對照只證明「收集器不會永遠回空」,證明不了「它不會漏抓」;要證偽漏抓,
// 得餵一份**已知必然命中**的輸入給同一條解析路徑。
function scanDiffText(text) {
  let commit = '', file = '', addedLines = 0, allowed = 0;
  const found = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 14); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const t = line.slice(1);
    addedLines++;
    // 對照樣本用的逐行豁免:與歷史掃描共用,否則本檔的樣本會被算成「洩漏 commit」,
    // 待處理 commit 數比實際多一顆,照文件操作的人會對不上而困惑。
    if (t.includes(ALLOW)) { allowed++; continue; }
    for (const r of RULES) if (r.re.test(t)) found.push({ commit, file, rule: r.name, text: t.trim().slice(0, 160) });
  }
  return { found, addedLines, allowed };
}
// commit message 是第三個資料面,不帶 `+` 前綴 ⇒ 走另一條解析路徑,所以它也要有自己的自檢。
function scanMessageText(msg) {
  const found = [];
  for (const line of msg.split('\n')) {
    if (line.includes(ALLOW)) continue;
    for (const r of RULES) if (r.re.test(line)) found.push({ rule: r.name, text: line.trim().slice(0, 120) });
  }
  return found;
}

// 自檢樣本用**既有的** CONTROLS 元素組成,不引入任何新的字面樣本:
// 新字面會多出一行帶豁免標記的原始碼,把上面那條「豁免數 === 對照數」推翻。
{
  const probe = scanDiffText([
    'commit 0000000probe',
    '+++ b/(probe-in-memory)',
    '+' + CONTROLS[0][1],                       // 新增行且必然命中 ⇒ 要抓到
    '+' + CONTROLS[1][1] + '  # ' + ALLOW,      // 帶豁免標記的新增行 ⇒ 算 allowed、不算命中
    ' ' + CONTROLS[2][1],                       // context 行 ⇒ 不是新增行
    '-' + CONTROLS[3][1],                       // 刪除行 ⇒ 不是新增行
  ].join('\n'));
  ok(probe.found.length === 1 && probe.addedLines === 2 && probe.allowed === 1 && probe.found[0].file === '(probe-in-memory)',
    `解析器自檢:假 diff 走同一條路徑,「+ 行」抓得到且 context／刪除行不算新增 — ` +
    `命中 ${probe.found.length}(期望 1)、新增 ${probe.addedLines}(期望 2)、豁免 ${probe.allowed}(期望 1)、檔名 ${probe.found[0] ? probe.found[0].file : '(無)'}`);
  const probeMsg = scanMessageText(`chore: 假訊息標題\n\n${CONTROLS[5][1]}\n`);
  ok(probeMsg.length === 1,
    `解析器自檢:commit message 的逐行比對咬得住已知樣本 — 命中 ${probeMsg.length}(期望 1)`);
}

if (failed) {
  console.log('\n🔴 pattern 自身壞掉,主掃描的「零命中」沒有意義,直接中止。');
  process.exit(1);
}

// 主掃描比對「合併基準 → **工作樹**」,不是 `BASE...HEAD`。
// 理由:這支是 commit 前的閘門,要能在還沒 commit 時就告訴你哪一行不能進去。
// 拿 HEAD 當右端的話,你永遠只能在犯錯之後才看到它(第一版就是這樣,自己被自己咬了一輪)。
console.log('\n── 主掃描:合併基準 → 工作樹(含未 commit 的改動) ──');
let diff = '';
try {
  const mb = execFileSync('git', ['merge-base', BASE, 'HEAD'], { encoding: 'utf8' }).trim();
  diff = execFileSync('git', ['diff', mb, '-U0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  ok(false, `取不到 diff(base=${BASE}):${String(e).slice(0, 120)}`);
  process.exit(1);
}

const { found: hits, addedLines, allowed } = scanDiffText(diff);

// 掃描器本身也要證明有在掃:新增行為 0 表示 base 選錯或分支是空的,
// 那樣「零命中」同樣沒有意義(形態 11 的另一半——量測器沒在量)。
ok(addedLines > 0, `掃描器有讀到新增行(base=${BASE}) — ${addedLines} 行`);

// 豁免行要印出數量:豁免是給對照樣本用的,數量應該恰好等於 CONTROLS 的長度。
// 多出來就代表有人拿這個標記在藏東西——豁免機制本身也要看得見,不然它就是後門。
// ⏳ 已知的到期條件:這條假設「diff 裡一定含本檔那幾行對照樣本」,而那只在**本檔還沒進 base**
//    的時候成立。本檔一旦合併進 origin/main,下一條 feature 分支跑它就會拿到 `豁免 0 行`
//    而為了不相干的理由變紅。合併那一輪要把它改成條件式(本檔有出現在 diff 裡才要求相等),
//    現在不改是因為改了就沒有東西守著「有人拿標記藏東西」這件事。
ok(allowed === CONTROLS.length, `豁免行數量符合對照樣本數 — 豁免 ${allowed} 行 / 對照 ${CONTROLS.length} 條`);

ok(hits.length === 0, `本分支新增行零內部成本／金鑰洩漏 — 命中 ${hits.length} 筆`);
for (const h of hits) console.log(`   ⚠️ ${h.file} [${h.rule}] ${h.text}`);

// ── 第二階段:歷史掃描 ────────────────────────────────────────────────
// 上面掃的是「HEAD 的樹」= 最終狀態。但這個 repo 是 PUBLIC,**中間 commit 也會被 push 出去**,
// `git log -p` 撈得到。最終狀態乾淨 ≠ 歷史乾淨:把洩漏的那行在後續 commit 改掉,
// 原始字串仍然永久留在前一顆 commit 裡。
// 這一段**計入 exit code**(2026-08-03 修正):它要求的動作是「push 前 squash 或改寫歷史」,
// 屬於合併時的閘門;但「不是現在能解決」不等於「可以不影響 exit code」——只看 exit code 的
// 自動化會把這一整類發現讀成不存在。要放行就用 --allow-history-hits=<N> 明示,見檔頭。
console.log('\n── 歷史掃描:中間 commit(push 前必須處理) ──');
let histHits = [];
let histCommits = 0;
try {
  const log = execFileSync('git', ['log', '-p', '-U0', `${BASE}..HEAD`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  histHits = scanDiffText(log).found; // 與主掃描同一支解析器 ⇒ 不可能只有這一半被改壞而無聲
} catch (e) { console.log(`   (歷史掃描失敗:${String(e).slice(0, 100)})`); }

// 🔴 第三個資料面:commit message 本體。
// 兩段掃描都只看 diff 裡以 `+` 開頭的行,而 commit message **不帶 + 前綴** ⇒ 結構上永遠掃不到。
// 這不是理論風險:本批次「修掉三處洩漏」那顆 commit,自己的訊息裡把三處原文整段引用了進去
// (作者在描述「我修了什麼」時貼了原句),由範圍複審抓出。訊息會隨 push 一起公開,
// 在 GitHub 的 commit 頁面直接看得到。
const histCommitList = execFileSync('git', ['log', '--format=%H', `${BASE}..HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
histCommits = histCommitList.length;
for (const c of histCommitList) {
  const msg = execFileSync('git', ['log', '-1', '--format=%B', c], { encoding: 'utf8' });
  for (const h of scanMessageText(msg)) histHits.push({ commit: c.slice(0, 7), file: '(commit message)', rule: h.rule, text: h.text });
}

// 歷史掃描器本身也要證明有在掃(比照主掃描的 addedLines>0):base..HEAD 是空的時候,
// 「零歷史命中」跟主掃描的「零新增行命中」一樣沒有意義——那是量測器沒在量,不是乾淨。
ok(histCommits > 0, `歷史掃描器有讀到 commit(base=${BASE}) — ${histCommits} 顆`);

if (histHits.length === 0) {
  console.log('   ✅ 歷史與 commit message 都乾淨,可直接 push。');
} else {
  const commits = [...new Set(histHits.map(h => h.commit))];
  console.log(`   🔴 ${histHits.length} 筆命中,分布在 ${commits.length} 顆 commit:${commits.join(' ')}`);
  for (const h of histHits) console.log(`      ${h.commit} ${h.file} [${h.rule}] ${h.text}`);
  console.log('   ⇒ push 前必須 squash 合併(或改寫這幾顆),否則這些字串會永久公開。');
}
// 具名容忍要印出來:容忍了什麼、幾筆、上限是多少。靜默容忍會被讀成「全都掃過了」。
if (ALLOW_HIST > 0) {
  console.log(`   🟡 具名容忍 --allow-history-hits=${ALLOW_HIST}:呼叫端明示接受「歷史命中尚未 squash」這一類,` +
    `本次 ${histHits.length} 筆${histHits.length <= ALLOW_HIST ? '在容忍額度內,不計入 exit code' : '超出容忍額度,仍計入 exit code'}。`);
}
ok(histHits.length <= ALLOW_HIST,
  `歷史／commit message 命中在容忍額度內 — 命中 ${histHits.length} 筆 / 容忍上限 ${ALLOW_HIST}` +
  (histHits.length > ALLOW_HIST ? '(push 前 squash 或改寫;確定要先放行請加 --allow-history-hits=<N>)' : ''));

console.log(`\n──────── ${failed ? 'FAIL' : 'ALL PASS'} ／ 最終狀態命中 ${hits.length} 筆、歷史命中 ${histHits.length} 筆(容忍 ${ALLOW_HIST}) ────────`);
process.exit(failed ? 1 : 0);
