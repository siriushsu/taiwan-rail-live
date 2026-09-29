#!/usr/bin/env node
// pre-push 閘門:推往 main 的那顆 commit,data/ 必須與 data_manifest.json、data_provenance.json 一致。
//
// 為什麼有這支:地圖巡檢的 manifest 閘門 2026-09-23 09:10 紅到 09-24 09:20、每小時通知一次——
// 78384b1f(高捷班表)與 eddad808(北捷 v39)改了 data/ 卻沒跑 `npm run build-manifest`,
// 中間 987a4687 只補了 manifest、沒補 provenance。更早的 6e515e4、a7fbe17 也是同一種漏法。
// 巡檢(scripts/scan_map_health_cron.sh)只能事後叫,這支在 push 那一刻擋。
//
// 驗的是「被推的那顆 commit」,不是工作樹:工作樹可能有沒 commit 的改動,被推的 ref 也不一定是 HEAD。
// 做法是把那顆 commit 的 index.html、data/ 與 verify 用到的四支腳本抽到暫存目錄,
// 用**那顆 commit 自己的** verify 腳本去驗——push 之後巡檢在 origin/main 上跑的就是這一份。
//
// 用法:node scripts/check_data_manifest_commit.mjs <commit>(由 .git/hooks/pre-push 呼叫)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2];
if (!ref) {
  console.error('用法:node scripts/check_data_manifest_commit.mjs <commit>');
  process.exit(2);
}

const VERIFY = ['verify_data_manifest', 'verify_data_provenance'];
const NEEDS = ['index.html', 'data',
  ...['build_data_manifest', 'build_data_provenance', ...VERIFY].map(n => `scripts/${n}.mjs`)];

const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 30 });

// 回傳紅行(空陣列＝一致);檢查本身跑不起來就拋錯——那不是資料問題,但也不能當作通過
function check(sha) {
  const tmp = mkdtempSync(join(tmpdir(), 'railisland-manifest-'));
  try {
    execFileSync('tar', ['-x', '-C', tmp], { input: git(['archive', '--format=tar', sha, ...NEEDS]) });
    const red = [];
    for (const v of VERIFY) {
      const r = spawnSync(process.execPath, [join(tmp, 'scripts', `${v}.mjs`), tmp], { encoding: 'utf8' });
      if (r.status === 0) continue;
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      // verify 自己判紅一定會印 ❌ 總結行;沒有就是它半路崩了,不是 data/ 不一致
      if (!/^\s*❌/m.test(out))
        throw new Error(`${v} 沒跑完:${out.split('\n').find(l => /Error|error/.test(l)) || `離開碼 ${r.status}`}`);
      // 目標目錄是暫存路徑、✓ 是通過的條目、verify 自己的修法跟下面重複,都不印
      red.push(...out.split('\n').filter(l => l.trim() && !/目標目錄|^\s*✓|修法/.test(l)));
    }
    return red;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

let sha, red;
try {
  sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  red = check(sha);
} catch (e) {
  console.log(`check-data-manifest(${ref}):❌ 檢查本身跑不起來——${String(e.message).split('\n')[0]}`);
  console.log('  這不是 data/ 的問題,是檢查沒跑成;修好環境再推,不要繞過。');
  process.exit(1);
}

console.log(`check-data-manifest(${sha.slice(0, 8)}):用該 commit 自己的 verify_data_manifest＋verify_data_provenance`);
if (!red.length) {
  console.log('  ✓ data/ 與 data_manifest.json、data_provenance.json 一致');
  process.exit(0);
}
for (const l of red) console.log(`  ${l.trim()}`);
console.log('  推上 main 之後,地圖巡檢每小時都會為這個跳一次通知。');
console.log('  修法:npm run build-manifest(兩份清單一起重產),把 data/data_manifest.json 與 data/data_provenance.json 一起 commit 再推。');
process.exit(1);
