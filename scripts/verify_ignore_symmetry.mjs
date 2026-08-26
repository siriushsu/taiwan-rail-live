// 內部工作文件的擋牆對稱性檢查:同一批類別必須在 .gitignore 與 .assetsignore **兩邊**都有。
//
// 為什麼需要這支:2026-08-26 的工程審查抓到 `tools/` 與 `android-native-design-mock.html`
// 只進了 .assetsignore、沒進 .gitignore(反方向也有:`回覆草稿_*` 只在 .gitignore)。
// 這不是兩個獨立的疏漏,是**同一個結構性錯誤的兩面**——兩個檔的語意域根本不同:
//   .gitignore      管「會不會進公開 git 歷史」(push 後不可改寫,7 個 fork 共用物件庫)
//   .assetsignore   管「wrangler 會不會把磁碟上的它當靜態資產上傳」(它讀磁碟,.gitignore 無效)
// 少任何一邊,檔案就從另一邊漏出去,而且**兩邊各自看起來都很完整**——這正是 2026-07-26
// 的 .cache 事故(只進 .gitignore,結果 TDX 原始快取在預覽站可下載)。
//
// 判準刻意寫「是哪一類、擋不擋得住」,不寫「有幾條規則」:後者下次加一類就要改魔術數字。
//
// 用法:node scripts/verify_ignore_symmetry.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 🔴 core.quotepath=false 是必要的,不是美化:git 對非 ASCII 路徑預設輸出 "\350\250..." 這種
// 八進位轉義形式,原樣字串比對會全部對不上——而這個 repo 的內部文件檔名幾乎全是中文。
// 少了它,9 個類別裡只有純 ASCII 的 android 那一條會過,其餘 8 條是**假紅**(2026-08-26 首跑實測)。
const GIT = ['-c', 'core.quotepath=false'];
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const sh = (args, opts = {}) => execFileSync('git', [...GIT, ...args], { cwd: ROOT, encoding: 'utf8', ...opts });

// ── 受保護的內部工作文件類別 ─────────────────────────────────────────────
// 每一類都要有 sample(不必真的存在;check-ignore 對不存在的路徑照樣判得出來),
// 這樣即使某一類這一刻剛好一個檔都沒有,規則被刪掉還是會紅。
const CLASSES = [
  { name: 'App 送審文字',   git: 'app/送審文字_*', sample: 'app/送審文字_9.9.9_build999.md',
    assetCoveredBy: 'app', why: '.assetsignore 已用 `app` 整個目錄排除,不必重列' },
  { name: '功能設計稿',     git: '設計_*',   asset: '設計_*',   sample: '設計_測試類別_2026-01-01.md' },
  { name: '實作計畫',       git: '計畫_*',   asset: '計畫_*',   sample: '計畫_測試類別_2026-01-01.md' },
  { name: '外包派工單',     git: '派工單_*', asset: '派工單_*', sample: '派工單_測試類別_2026-01-01.md' },
  { name: '商標申請工作表', git: '商標申請工作表*', asset: '商標申請工作表*', sample: '商標申請工作表_2026-01-01.html' },
  { name: '對外回覆草稿',   git: '回覆草稿_*', asset: '回覆草稿_*', sample: '回覆草稿_測試_2026-01-01.md' },
  { name: '小工具設計稿',   git: '發車看板小工具設計*', asset: '發車看板小工具設計*', sample: '發車看板小工具設計_測試_2026-01-01.md' },
  { name: '內部出圖工具',   git: 'tools/',   asset: 'tools',    sample: 'tools/公告版型/x.html' },
  { name: 'Android 版面稿', git: 'android-native-design-mock.html', asset: 'android-native-design-mock.html',
    sample: 'android-native-design-mock.html' },
];

// 反向對照:這些一定要出得了貨,防止新規則誤殺(參照 Jekyll exclude 曾誤殺送審 Support URL)。
// ⚠️ worker.js **不可**列進來:它在 .assetsignore 被排除是刻意的(Worker 腳本由 wrangler 自己
//    部署,不是靜態資產)。清單裡每個檔都必須真的存在,否則「沒被擋」是零資訊(心得 29)。
// ⚠️ 也不可列 _config.yml:它跟 package.json／AGENTS.md 並排在 .assetsignore:33,是建置設定不是站台資產。
//    這份清單三次被我用猜的填錯(worker.js、三個不存在的路徑、_config.yml),所以下面那條
//    「清單本身沒過期」的斷言是必要的——但它只驗得到「檔在不在」,驗不到「這個檔該不該出貨」,
//    加新項目時要自己去 .assetsignore 確認它不是被刻意排除的。
const MUST_SHIP = ['index.html', 'data/afr.json', 'assets/wm-logo.png', 'manifest.webmanifest'];

const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); };

// ── 擋牆評估器 ───────────────────────────────────────────────────────────
// .assetsignore 一律用**真的 gitignore 引擎**評(臨時 repo),不自己寫 glob:wrangler 用的
// 就是 gitignore 語法,自己實作等於再造一個會漂移的第二實作。
function checkIgnore(dir, paths) {
  if (!paths.length) return new Set();
  let out = '';
  try {
    out = execFileSync('git', [...GIT, '-C', dir, 'check-ignore', '--stdin'],
      { input: paths.join('\n') + '\n', encoding: 'utf8' });
  } catch (e) { out = e.stdout || ''; }   // 一個都沒中時 git 回 exit 1
  return new Set(out.split('\n').filter(Boolean));
}
function scratchRepo(content) {
  const dir = mkdtempSync(join(tmpdir(), 'ignorecheck-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, '.gitignore'), content);
  return dir;
}
const ASSET_REPO = scratchRepo(readFileSync(join(ROOT, '.assetsignore'), 'utf8'));
const assetIgnored = (paths) => checkIgnore(ASSET_REPO, paths);
const gitIgnored = (paths) => checkIgnore(ROOT, paths);

const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map(s => s.trim());
const ai = readFileSync(join(ROOT, '.assetsignore'), 'utf8').split('\n').map(s => s.trim());

// ── S:對稱斷言(這支腳本存在的理由)───────────────────────────────────────
for (const c of CLASSES) {
  ok(`S/${c.name} 在 .gitignore 有規則`, gi.includes(c.git), c.git);
  if (c.assetCoveredBy) ok(`S/${c.name} 由 .assetsignore 的 \`${c.assetCoveredBy}\` 涵蓋`, ai.includes(c.assetCoveredBy), c.why);
  else ok(`S/${c.name} 在 .assetsignore 有規則`, ai.includes(c.asset), c.asset);
}

// ── B:兩個引擎都真的擋得住(不是只有規則長得對)──────────────────────────
const samples = CLASSES.map(c => c.sample);
const gBlocked = gitIgnored(samples);
const aBlocked = assetIgnored(samples);
for (const c of CLASSES) {
  ok(`B/${c.name} 進不了 git 歷史`, gBlocked.has(c.sample), c.sample);
  ok(`B/${c.name} 上不了靜態站`, aBlocked.has(c.sample), c.sample);
}

// ── B 的正向對照:規則沒生效時上面那組必須會紅 ────────────────────────────
// 逐類判,不用「新擋住 > 0 就算過」——那太鬆:8 條沒生效、1 條生效也會綠,
// 而那正是 quotepath 那一輪的實況(心得 35:判準有沒有牙要突變測試才知道)。
let base = null;
try { base = sh(['merge-base', 'HEAD', 'origin/main']).trim(); } catch {}
let baseRepo = null;
if (base) {
  baseRepo = scratchRepo(sh(['show', `${base}:.gitignore`]));
  const baseGi = sh(['show', `${base}:.gitignore`]).split('\n').map(x => x.trim());
  const oldBlocked = checkIgnore(baseRepo, samples);
  const shouldBeNew = CLASSES.filter(c => !baseGi.includes(c.git));
  const notNew = shouldBeNew.filter(c => oldBlocked.has(c.sample) || !gBlocked.has(c.sample));
  ok('B/正向對照:每條新規則都確實新擋住了東西', notNew.length === 0,
    notNew.length ? `這些沒有變化:${notNew.map(c => c.name).join(', ')}`
      : `${shouldBeNew.length} 類在基準 ${base.slice(0, 8)} 是裸的,現在都擋住了`);
}

// ── C:覆蓋率斷言——沒有「用同一套命名慣例但沒被任何一類認領」的檔裸著 ────
// 分母是磁碟現況,不是這份 CLASSES 清單;新開一類(例如「訪談_…」)而忘了加規則,這條會紅。
// 心得 37(d):覆蓋率必須有一條具名斷言,只把 N/M 印在 detail 等於沒 gate。
const untracked = sh(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
const CJK_DOC = /(^|\/)[一-鿿]{2,}_[^/]*$/;   // 類別_主題_日期
const orphans = untracked.filter(p => CJK_DOC.test(p));
ok('C/沒有未被認領的內部工作文件裸著', orphans.length === 0,
  orphans.length ? `裸露 ${orphans.length} 個:${orphans.slice(0, 5).join(', ')}` : `掃過 ${untracked.length} 個未追蹤檔`);

// ── D:反向——沒有誤殺 ────────────────────────────────────────────────
// 判準只問「**本次新增的規則**有沒有誤殺」。這棵樹本來就有一批已追蹤檔被 main 自己的
// docs/superpowers/ 與 `hand off/` 規則擋著,那是既存狀態、另案;拿「任何已追蹤檔都不准被擋」
// 當判準會恆紅,而恆紅的判準跟沒有判準一樣——真的誤殺發生時沒人分得出來。
const trackedIgnored = sh(['ls-files', '-i', '-c', '--exclude-standard']).split('\n').filter(Boolean);
const baseKilled = baseRepo ? checkIgnore(baseRepo, trackedIgnored) : new Set(trackedIgnored);
const newlyKilled = trackedIgnored.filter(p => !baseKilled.has(p));
ok('D/本次規則沒有誤殺已追蹤的檔', newlyKilled.length === 0,
  newlyKilled.length ? `誤殺:${newlyKilled.join(', ')}`
    : `已追蹤被擋 ${trackedIgnored.length} 個,全部是基準就有的(既存,非本次造成)`);

const shipBlocked = [...assetIgnored(MUST_SHIP)];
ok('D/必出貨資產沒被 .assetsignore 誤殺', shipBlocked.length === 0,
  shipBlocked.length ? `被擋:${shipBlocked.join(', ')}` : MUST_SHIP.join(' '));
const missingShip = MUST_SHIP.filter(p => !existsSync(join(ROOT, p)));
ok('D/必出貨清單本身沒過期', missingShip.length === 0,
  missingShip.length ? `清單裡這些檔不存在,等於沒驗:${missingShip.join(', ')}` : `${MUST_SHIP.length} 個都在`);

// ── 輸出 ─────────────────────────────────────────────────────────────
let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
}
console.log(`\n總計 ${results.length - fail}/${results.length} 通過`);
process.exit(fail ? 1 : 0);
