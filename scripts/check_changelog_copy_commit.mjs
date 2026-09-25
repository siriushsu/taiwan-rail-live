#!/usr/bin/env node
// pre-push 閘門:推往 main 的那顆 commit,更新紀錄要過 verify_changelog_copy(npm run check-copy):
// 最近更新最多 8 條、每條 ≤90 字;完整歷史每條 ≤120 字。
//
// 為什麼有這支:check-copy 不在 ship_web 的閘門鏈裡,也沒掛在任何推送檢查上,只能靠人記得手動跑。
// 2026-09-08 首層一條寫到 97 字、2026-09-25 第二層一條寫到 136 字,兩次都是推上 main 之後才被別的 session 抓到。
// 2026-09-25 使用者裁示「check-copy 掛進推送前檢查吧」;掛上當下 origin/main 本身就是紅的
// (機捷設計展那條第二層 165 字,v0925o 推上去時沒人跑 check-copy),同一輪縮回 120 字。
//
// 驗的是「被推的那顆 commit」,不是工作樹(同 check_data_manifest_commit.mjs):工作樹可能有沒 commit 的改動,
// 被推的 ref 也不一定是 HEAD。做法是把那顆 commit 的 index.html 與它自己的 verify_changelog_copy.mjs
// 抽到暫存目錄再跑——verify 固定讀自己上一層的 index.html。
//
// 用法:node scripts/check_changelog_copy_commit.mjs <commit>(由 .git/hooks/pre-push 呼叫)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2];
if (!ref) {
  console.error('用法:node scripts/check_changelog_copy_commit.mjs <commit>');
  process.exit(2);
}

const VERIFY = 'scripts/verify_changelog_copy.mjs';
const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 30, ...opts });

let sha, out, status;
try {
  sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  try { git(['cat-file', '-e', `${sha}:${VERIFY}`], { stdio: 'ignore' }); } catch (e) {
    console.log(`check-copy(${sha.slice(0, 8)}):這顆 commit 還沒有 ${VERIFY},略過`);
    process.exit(0);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'railisland-copy-'));
  try {
    execFileSync('tar', ['-x', '-C', tmp], { input: git(['archive', '--format=tar', sha, 'index.html', VERIFY]) });
    const r = spawnSync(process.execPath, [join(tmp, VERIFY)], { encoding: 'utf8' });
    out = `${r.stdout || ''}${r.stderr || ''}`;
    status = r.status;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // verify 判紅一定會印「更新紀錄文案驗收失敗」;沒有就是它半路崩了(例如找不到更新紀錄區段)。
  // 崩潰時 node 先印出錯的那行原始碼,真正的訊息在「Error: …」那行
  if (status !== 0 && !/更新紀錄文案驗收失敗/.test(out))
    throw new Error(`verify_changelog_copy 沒跑完:${out.split('\n').map(l => l.trim()).find(l => /^[A-Za-z]*Error:/.test(l)) || `離開碼 ${status}`}`);
} catch (e) {
  console.log(`check-copy(${sha ? sha.slice(0, 8) : ref}):❌ 檢查本身跑不起來——${String(e.message).split('\n')[0]}`);
  console.log('  檢查沒有跑成,不能當作通過;先修好再推,不要繞過。');
  process.exit(1);
}

console.log(`check-copy(${sha.slice(0, 8)}):用該 commit 自己的 verify_changelog_copy`);
const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
if (status === 0) {
  console.log(`  ✓ ${lines[lines.length - 1]}`);
  process.exit(0);
}
for (const l of lines) console.log(`  ${l}`);
console.log('  修法:把上面列出的條目縮短(最近更新最多 8 條、每條 ≤90 字;完整歷史每條 ≤120 字),commit 後再推。本機重現:npm run check-copy。');
process.exit(1);
