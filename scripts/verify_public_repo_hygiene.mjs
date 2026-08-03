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
// 用法:node scripts/verify_public_repo_hygiene.mjs [base] [--allow-history-hits=<N>]
//   base 預設 origin/main。base **只能放寬範圍不能縮小**:掃描範圍必須涵蓋 origin/main..HEAD 的
//   全部,縮小會被下面那條「範圍涵蓋」斷言擋下並印出少掃了哪幾顆 commit。
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
// 🔴 範圍錨點(2026-08-03 修復輪 4 補):掃描範圍必須涵蓋 `origin/main..HEAD` 的**全部**,
// 而「全部」由這個**外部基準**算出,不吃呼叫者給的 BASE。
// 為什麼非要外部基準不可:此前六條自檢的「期望」與「實看」**都從同一個 BASE 算**——
// 範圍一縮,量尺跟著縮,覆蓋自檢結構上不可能發現。複審零編輯、零旗標實測:
// `node scripts/verify_public_repo_hygiene.mjs <某顆中間 commit>` ⇒ ALL PASS exit 0,
// 21 筆真命中一筆不剩。而那顆正是「修好洩漏」的 commit,「從修好的那一顆開始掃」
// 是最自然的人類動作,它換來的卻是一張全綠。
// BASE 保留給診斷用(想單看某一段時很方便),但**縮小範圍必須紅**,不是靜默放行。
// 取不到 origin/main(離線／沒有 remote)同樣算紅:錨點不存在時,「涵蓋了」這句話沒有意義,
// 而「取不到 ≠ 掃過了」正是這支腳本反覆踩到的同一個形態。
const ANCHOR = 'origin/main';
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
  let commit = '', file = '', addedLines = 0, allowed = 0, lastOld = '';
  const found = [];
  // commits = 這支解析器**實際走過**的 commit 集合。與 files 同樣的用途:讓「掃描範圍」
  // 這件事有一個從受測物本身讀出來的量,可以拿去跟外部錨點(ANCHOR)比對。
  const commits = new Set();
  // files = 這支解析器**實際看進去內容**的檔案集合。只認 `+++ b/` 這個「後面跟著可掃描的行」
  // 的表頭:被 .gitattributes 標成 -diff 的檔只會吐 `Binary files … differ`,沒有 `+++`,
  // 正好落在集合外——那就是它該被抓到的方式。純刪除檔(`+++ /dev/null`)沒有新增行可掃,算看過。
  const files = new Set();
  for (const line of text.split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 14); commits.add(line.slice(7).trim()); continue; }
    if (line.startsWith('--- a/')) { lastOld = line.slice(6); continue; }
    if (line.startsWith('+++ /dev/null')) { if (lastOld) files.add(lastOld); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); files.add(file); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const t = line.slice(1);
    addedLines++;
    // 對照樣本用的逐行豁免:與歷史掃描共用,否則本檔的樣本會被算成「洩漏 commit」,
    // 待處理 commit 數比實際多一顆,照文件操作的人會對不上而困惑。
    if (t.includes(ALLOW)) { allowed++; continue; }
    for (const r of RULES) if (r.re.test(t)) found.push({ commit, file, rule: r.name, text: t.trim().slice(0, 160) });
  }
  return { found, addedLines, allowed, files, commits };
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

// 🔴 檔案集合覆蓋自檢:掃描器「看進去內容的檔案集合」必須涵蓋「這個範圍內真的動過的檔案集合」。
// 為什麼要這一條,而不是一個形態補一個旗標:三種已知的「成功但回傳不完整」形態——
//   (a) `git log -p` 被加上 pathspec、(b) .gitattributes 把某類檔標成 `-diff`
//       (一般人為了產物檔／二進位檔會加的正常設定,不需要惡意)、(c) merge commit 預設不出 diff
// ——全都**不丟例外**,所以上一輪那條 histScanErrs 一條都抓不到;而它們的**共同顯形**都是
// 「有檔案沒出現在掃描裡」。期望集合的來源必須與 `-p` 無關(用 --name-only),
// 否則判準與受測物同源、會一起失明。
function filesChangedNameOnly(args) {
  return new Set(execFileSync('git', ['diff', '--name-only', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').map(t => t.trim()).filter(Boolean));
}
// 真二進位檔(PNG 之類)本來就沒有可掃的文字行,落在集合外是正確的,不該報紅。
// 判「是不是真的二進位」要用**內容**(有沒有 NUL byte),不能用 git 的 binary 判定——
// 後者正是被 .gitattributes 操縱的那一個,拿它當判準等於與受測物同源。
function looksBinaryAtHead(p) {
  try {
    const buf = execFileSync('git', ['show', `HEAD:${p}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    return buf.subarray(0, 8000).includes(0);
  } catch (e) { return false; } // 取不到就當文字:寧可為此紅一次,也不要靜默放過一個沒被掃到的檔
}
function coverageGap(seen, expected) {
  return [...expected].filter(f => !seen.has(f) && !looksBinaryAtHead(f));
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
let MERGE_BASE = '';
try {
  MERGE_BASE = execFileSync('git', ['merge-base', BASE, 'HEAD'], { encoding: 'utf8' }).trim();
  diff = execFileSync('git', ['diff', MERGE_BASE, '-U0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  ok(false, `取不到 diff(base=${BASE}):${String(e).slice(0, 120)}`);
  process.exit(1);
}

// 範圍錨點的兩個量:規範基準的合併點(給主掃描的覆蓋自檢用)與規範基準以來的 commit 清單
// (給下面那條「範圍涵蓋」斷言用)。這兩個都**不經過 BASE**,才打得斷「量尺跟著範圍一起縮」。
let ANCHOR_MERGE_BASE = '', anchorCommits = [], anchorErr = '';
try {
  ANCHOR_MERGE_BASE = execFileSync('git', ['merge-base', ANCHOR, 'HEAD'], { encoding: 'utf8' }).trim();
  anchorCommits = execFileSync('git', ['rev-list', `${ANCHOR}..HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch (e) { anchorErr = String(e).replace(/\s+/g, ' ').slice(0, 140); }

const { found: hits, addedLines, allowed, files: mainFilesSeen } = scanDiffText(diff);

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

// 覆蓋自檢(主掃描):同樣的三種形態也會讓主掃描無聲漏檔——.gitattributes 是全域設定,
// 不會只影響歷史那一半。只補歷史、不補主掃描,等於把同一個洞留了一半。
// 期望集合從**錨點**的合併點算(不是 BASE 的):BASE 預設就是 ANCHOR ⇒ 兩者同值、行為不變;
// BASE 被縮小時 expected 不跟著縮,少掃的檔就會具名印出來。
{
  let gap = [], expected = new Set();
  if (anchorErr) gap = [`(取不到範圍錨點 ${ANCHOR}:${anchorErr})`];
  else {
    try { expected = filesChangedNameOnly([ANCHOR_MERGE_BASE]); gap = coverageGap(mainFilesSeen, expected); }
    catch (e) { gap = ['(取不到期望檔案集合:' + String(e).slice(0, 80) + ')']; }
  }
  ok(gap.length === 0,
    `主掃描看進去的檔案集合涵蓋錨點(${ANCHOR})以來動過的所有文字檔 — 期望 ${expected.size} 檔 / 實看 ${mainFilesSeen.size} 檔` +
    (gap.length ? ` / 🔴 沒被掃到:${gap.slice(0, 8).join('、')}${gap.length > 8 ? ` …共 ${gap.length} 檔` : ''}` : ''));
}

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
let histFilesSeen = new Set();
let histCommitsSeen = new Set();
// 🔴 取不到資料 ≠ 掃過了、乾淨。這兩件事此前在下面那條斷言眼裡完全一樣:catch 只印一行
// console.log,而唯一的消費者是自動化(這一段本來就是為了計入 exit code 才存在的),
// console.log 對它不存在。實測的真實失效模式:大 repo 讓 `git log -p` 撐爆 maxBuffer(ENOBUFS)
// ⇒ 21 筆真命中整批消失、三條自檢全綠、ALL PASS exit 0。
// 而 squash 之後「命中 0」會變成合法常態 ⇒ 那時再也分不出「乾淨」與「根本沒掃到」。
// 所以掃描失敗一律記成錯誤,併進最後那條斷言。
const histScanErrs = [];
try {
  // --diff-merges=remerge:merge commit 預設**完全不出 diff** ⇒ 只活在衝突解法裡的行結構上掃不到,
  // 而衝突落點通常正是更新紀錄與版本字串——洩漏字串會住的地方。
  // ⚠️ 這一項**沒有安全網**(此處原本寫成「拿掉它,下面那條覆蓋自檢就會把漏掉的檔名印出來」,寫反了):
  //    覆蓋自檢比對的是**檔案集合**,只有在「merge 動到的檔沒被範圍內任何其他 commit 動過」時才照得到;
  //    而衝突落點恰恰是每顆 commit 都在動的那幾個檔(更新紀錄、版本字串、index.html)
  //    ⇒ 拿掉 remerge,那個檔仍然在 seen 裡、gap 仍然是空的、覆蓋自檢照樣全綠。
  //    下一個人讀的是這裡不是報告,所以這句話必須跟事實一致:remerge 是這條路上唯一的東西,
  //    刪掉它不會有人接住。
  const log = execFileSync('git', ['log', '-p', '-U0', '--diff-merges=remerge', `${BASE}..HEAD`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const hr = scanDiffText(log); // 與主掃描同一支解析器 ⇒ 不可能只有這一半被改壞而無聲
  histHits = hr.found; histFilesSeen = hr.files; histCommitsSeen = hr.commits;
} catch (e) { histScanErrs.push(`git log -p:${String(e).slice(0, 120)}`); }

// 🔴 第三個資料面:commit message 本體。
// 兩段掃描都只看 diff 裡以 `+` 開頭的行,而 commit message **不帶 + 前綴** ⇒ 結構上永遠掃不到。
// 這不是理論風險:本批次「修掉三處洩漏」那顆 commit,自己的訊息裡把三處原文整段引用了進去
// (作者在描述「我修了什麼」時貼了原句),由範圍複審抓出。訊息會隨 push 一起公開,
// 在 GitHub 的 commit 頁面直接看得到。
// 這一段同樣「取不到就是錯」,不是「取不到就當乾淨」:逐顆抓訊息任何一顆失敗都會讓
// 那顆的訊息完全沒被看過,而迴圈跑完之後的結果長得跟「全都乾淨」一模一樣。
let histCommitList = [];
try {
  histCommitList = execFileSync('git', ['log', '--format=%H', `${BASE}..HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch (e) { histScanErrs.push(`git log --format=%H:${String(e).slice(0, 120)}`); }
histCommits = histCommitList.length;
for (const c of histCommitList) {
  try {
    const msg = execFileSync('git', ['log', '-1', '--format=%B', c], { encoding: 'utf8' });
    for (const h of scanMessageText(msg)) histHits.push({ commit: c.slice(0, 7), file: '(commit message)', rule: h.rule, text: h.text });
  } catch (e) { histScanErrs.push(`git log -1 ${c.slice(0, 7)}:${String(e).slice(0, 80)}`); }
}

// 歷史掃描器本身也要證明有在掃(比照主掃描的 addedLines>0):base..HEAD 是空的時候,
// 「零歷史命中」跟主掃描的「零新增行命中」一樣沒有意義——那是量測器沒在量,不是乾淨。
ok(histCommits > 0, `歷史掃描器有讀到 commit(base=${BASE}) — ${histCommits} 顆`);
// 🔴 範圍涵蓋斷言:`ANCHOR..HEAD` 的每一顆 commit 都必須出現在**實際掃過**的 commit 集合裡。
// 期望來自外部錨點(`git rev-list origin/main..HEAD`)、實看來自受測物自己(`git log -p` 輸出裡
// 解析到的 `commit ` 表頭)⇒ 兩邊不同源,範圍被縮小時這條會紅並具名印出少了哪幾顆。
// 上面那兩條都答不了這個問題:`histCommits > 0` 只問「有沒有讀到東西」,覆蓋自檢問的是「檔案」
// 而它的期望集合此前也吃同一個 BASE ⇒ 範圍縮小時三條一起印綠。
// 錨點取不到時一律紅:不是「跳過」,取不到 ≠ 涵蓋了。
{
  const missing = anchorCommits.filter(c => !histCommitsSeen.has(c));
  ok(!anchorErr && missing.length === 0,
    `掃描範圍涵蓋 ${ANCHOR}..HEAD 的每一顆 commit(BASE 只能放寬範圍,不能縮小) — ` +
    `錨點 ${anchorCommits.length} 顆 / 實掃 ${histCommitsSeen.size} 顆` +
    (anchorErr ? ` / 🔴 取不到錨點 ${ANCHOR}:${anchorErr}` : '') +
    (missing.length ? ` / 🔴 base=${BASE} 把範圍縮小了,少掃 ${missing.length} 顆:` +
      `${missing.slice(0, 8).map(c => c.slice(0, 7)).join(' ')}${missing.length > 8 ? ' …' : ''}` : ''));
}
// 注意這條與上面那條不同層:上面數的是 commit 顆數(走 `git log --format=%H`),
// 這條問的是「三支 git 呼叫有沒有哪一支根本沒回資料」。ENOBUFS 那個失效模式只會踩到這一條。
ok(histScanErrs.length === 0,
  `歷史掃描三支 git 呼叫全部取得資料(取不到 ≠ 乾淨) — ${histScanErrs.length ? '失敗:' + histScanErrs.join(' ; ') : '無失敗'}`);
// 🔴 上面那條只答「有沒有丟例外」。三支呼叫**成功但回傳不完整**時它是空的、而 21 筆真命中
// 會無聲蒸發(實測:只加一個 `docs/** -diff` 的 .gitattributes、腳本一行不動,6 筆就沒了)。
// 這一條答的是「該看的檔案都看到了嗎」,才是那三種形態的共同顯形。
// 期望集合同樣改吃錨點(理由見主掃描那一條):BASE 預設＝ANCHOR 時完全等值,行為不變。
{
  let gap = [], expected = new Set();
  if (anchorErr) gap = [`(取不到範圍錨點 ${ANCHOR}:${anchorErr})`];
  else {
    try { expected = filesChangedNameOnly([`${ANCHOR}...HEAD`]); gap = coverageGap(histFilesSeen, expected); }
    catch (e) { gap = ['(取不到期望檔案集合:' + String(e).slice(0, 80) + ')']; }
  }
  ok(gap.length === 0,
    `歷史掃描看進去的檔案集合涵蓋錨點(${ANCHOR})以來動過的所有文字檔 — 期望 ${expected.size} 檔 / 實看 ${histFilesSeen.size} 檔` +
    (gap.length ? ` / 🔴 沒被掃到:${gap.slice(0, 8).join('、')}${gap.length > 8 ? ` …共 ${gap.length} 檔` : ''}` : ''));
}

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
