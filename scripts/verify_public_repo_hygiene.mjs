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

const BASE = process.argv[2] || 'origin/main';

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

let file = '';
const hits = [];
let addedLines = 0, allowed = 0;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const text = line.slice(1);
  addedLines++;
  if (text.includes(ALLOW)) { allowed++; continue; }
  for (const r of RULES) if (r.re.test(text)) hits.push({ file, rule: r.name, text: text.trim().slice(0, 160) });
}

// 掃描器本身也要證明有在掃:新增行為 0 表示 base 選錯或分支是空的,
// 那樣「零命中」同樣沒有意義(形態 11 的另一半——量測器沒在量)。
ok(addedLines > 0, `掃描器有讀到新增行(base=${BASE}) — ${addedLines} 行`);

// 豁免行要印出數量:豁免是給對照樣本用的,數量應該恰好等於 CONTROLS 的長度。
// 多出來就代表有人拿這個標記在藏東西——豁免機制本身也要看得見,不然它就是後門。
ok(allowed === CONTROLS.length, `豁免行數量符合對照樣本數 — 豁免 ${allowed} 行 / 對照 ${CONTROLS.length} 條`);

ok(hits.length === 0, `本分支新增行零內部成本／金鑰洩漏 — 命中 ${hits.length} 筆`);
for (const h of hits) console.log(`   ⚠️ ${h.file} [${h.rule}] ${h.text}`);

// ── 第二階段:歷史掃描 ────────────────────────────────────────────────
// 上面掃的是「HEAD 的樹」= 最終狀態。但這個 repo 是 PUBLIC,**中間 commit 也會被 push 出去**,
// `git log -p` 撈得到。最終狀態乾淨 ≠ 歷史乾淨:把洩漏的那行在後續 commit 改掉,
// 原始字串仍然永久留在前一顆 commit 裡。
// 這一段刻意不計入 exit code——它要求的動作是「push 前 squash 或改寫歷史」,
// 屬於合併時的閘門,不是每次跑驗收都能當場解決的事。但它必須**印出來**,
// 否則就是另一個「寫了沒人看」的警告。
console.log('\n── 歷史掃描:中間 commit(push 前必須處理) ──');
let histHits = [];
try {
  const log = execFileSync('git', ['log', '-p', '-U0', `${BASE}..HEAD`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  let commit = '', hfile = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 14); continue; }
    if (line.startsWith('+++ b/')) { hfile = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    if (text.includes(ALLOW)) continue; // 與主掃描同一套豁免:否則本檔的對照樣本會被算成「洩漏 commit」,
                                        // 讓待處理 commit 數比實際多一顆,照文件操作的人會對不上而困惑。
    for (const r of RULES) if (r.re.test(text)) histHits.push({ commit, file: hfile, rule: r.name, text: text.trim().slice(0, 120) });
  }
} catch (e) { console.log(`   (歷史掃描失敗:${String(e).slice(0, 100)})`); }

// 🔴 第三個資料面:commit message 本體。
// 兩段掃描都只看 diff 裡以 `+` 開頭的行,而 commit message **不帶 + 前綴** ⇒ 結構上永遠掃不到。
// 這不是理論風險:本批次「修掉三處洩漏」那顆 commit,自己的訊息裡把三處原文整段引用了進去
// (作者在描述「我修了什麼」時貼了原句),由範圍複審抓出。訊息會隨 push 一起公開,
// 在 GitHub 的 commit 頁面直接看得到。
for (const c of (execFileSync('git', ['log', '--format=%H', `${BASE}..HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean))) {
  const msg = execFileSync('git', ['log', '-1', '--format=%B', c], { encoding: 'utf8' });
  for (const line of msg.split('\n')) {
    if (line.includes(ALLOW)) continue;
    for (const r of RULES) if (r.re.test(line)) histHits.push({ commit: c.slice(0, 7), file: '(commit message)', rule: r.name, text: line.trim().slice(0, 120) });
  }
}

if (histHits.length === 0) {
  console.log('   ✅ 歷史與 commit message 都乾淨,可直接 push。');
} else {
  const commits = [...new Set(histHits.map(h => h.commit))];
  console.log(`   🔴 ${histHits.length} 筆命中,分布在 ${commits.length} 顆 commit:${commits.join(' ')}`);
  for (const h of histHits) console.log(`      ${h.commit} ${h.file} [${h.rule}] ${h.text}`);
  console.log('   ⇒ push 前必須 squash 合併(或改寫這幾顆),否則這些字串會永久公開。');
}

console.log(`\n──────── ${failed ? 'FAIL' : 'ALL PASS'}(最終狀態)${histHits.length ? ' ／ 歷史待處理' : ''} ────────`);
process.exit(failed ? 1 : 0);
