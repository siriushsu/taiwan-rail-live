#!/usr/bin/env node
// 擋住「.gitignore 說不要、卻仍被 commit 進版控」的檔案。
//
// 為什麼有這支:2026-09-01 發現 app/送審文字_1.4.9_build76.md 與 _1.4.10_build79.md
// 被 commit 進 ship-main 的歷史、正要推上 public repo,而 .gitignore 早就寫著
// `app/送審文字_*`。git 不會為此報任何錯——.gitignore 只管未追蹤檔,一旦被追蹤就完全失效。
// 當時是靠人工比對 `git ls-files` × `git check-ignore` 才攔下來的,沒有這一步就上線了。
//
// 判準是棘輪不是歸零:repo 裡本來就有 14 個刻意的例外(設計稿、計畫書、研究稿),
// 寫死「必須為 0」會一加上去就全紅、然後被關掉。基線放在
// scripts/tracked-ignored-baseline.txt,只擋「基線以外的新增」。
//
// 真的要新增例外時:確認它可以公開,然後把路徑加進基線檔,連同理由寫進 commit message。
//
// 與 verify_ignore_symmetry.mjs 的 D 條是互補的兩個方向,不是同一道防線的兩代:
//   D 條(那邊)  問「**新加的 ignore 規則** 有沒有誤殺 **既有的已追蹤檔**」——規則側的變動。
//                它拿基準 repo 比對,所以檔案違反的若是**早就存在**的規則,該檔在基準裡也被擋著,
//                newlyKilled 為空 ⇒ PASS。送審文字正是這樣穿過去的。
//   這一支      問「**新進版控的檔案** 有沒有違反 **既有的 ignore 規則**」——檔案側的變動。
// 那邊的註解自己寫著「那是既存狀態、另案」;這支就是那個另案。
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'tracked-ignored-baseline.txt');
const ref = process.argv[2] || null;   // 不給就驗工作區的索引

const git = (args, input) =>
  execFileSync('git', args, { cwd: ROOT, input, maxBuffer: 1 << 28 });

// 用 -z 走 NUL 分隔:CJK 檔名在預設設定下會被 git 轉成八進位跳脫,
// 用一般輸出去比對會安靜地漏掉它們(這正是當初漏看的原因之一)。
const split0 = (buf) => buf.toString('utf8').split('\0').filter(Boolean);

const tracked = ref
  ? split0(git(['ls-tree', '-r', '-z', '--name-only', ref]))
  : split0(git(['ls-files', '-z']));

let hits = [];
if (tracked.length) {
  try {
    hits = split0(git(['check-ignore', '--no-index', '--stdin', '-z'], tracked.join('\0') + '\0'));
  } catch (e) {
    // check-ignore 沒有任何命中時 exit code 是 1,那是正常結果不是錯誤
    if (e.status !== 1) throw e;
    hits = split0(e.stdout || Buffer.alloc(0));
  }
}

const baseline = existsSync(BASELINE)
  ? new Set(readFileSync(BASELINE, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')))
  : new Set();

const added = hits.filter(f => !baseline.has(f));
const gone = [...baseline].filter(f => !hits.includes(f));
const label = ref || '工作區索引';

console.log(`check-tracked-ignored(${label}):追蹤 ${tracked.length} 檔,被 .gitignore 命中 ${hits.length} 個,基線 ${baseline.size} 個`);
if (gone.length) console.log(`  (基線有 ${gone.length} 個已不在,可順手從基線移除:${gone.slice(0, 3).join(', ')}${gone.length > 3 ? ' …' : ''})`);

if (!added.length) { console.log('  ✓ 沒有基線以外的新增'); process.exit(0); }

console.error(`\n  ✗ ${added.length} 個檔案被 .gitignore 排除、卻仍被版控追蹤,且不在基線內:\n`);
for (const f of added) console.error(`      ${f}`);
console.error(`
  這代表有東西違反了 .gitignore 的規定卻進了版控。這個 repo 是 public,
  推上去之後 fork 會共用物件庫,改寫歷史收不回來。

  處理方式(擇一):
    a) 這東西本來就不該進版控 → git rm --cached -- '<路徑>' 然後 commit
    b) 這是刻意的例外、可以公開   → 把路徑加進 scripts/tracked-ignored-baseline.txt
`);
process.exit(1);
