#!/usr/bin/env node
// publish_public_snapshot.mjs 的守門人：在暫存目錄建一個假開發 repo＋兩個 bare repo（私有、公開），
// 真的跑快照腳本、真的推到假的公開 repo，再讀回來驗。全程離線，不碰這個 repo 的任何 remote。
// 這支守的是「內部檔案不會被推上公開 repo」，所以排除清單的樣本兩邊都要有：該拿掉的、名字很像但該留的。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'publish_public_snapshot.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-public-snapshot-'));
const dev = path.join(tmp, 'dev'), pub = path.join(tmp, 'pub.git'), priv = path.join(tmp, 'priv.git');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { cwd, encoding: 'utf8' });
const write = (rel, text) => { const f = path.join(dev, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const commitAll = (msg, author) => {
  git(dev, 'add', '-A');
  git(dev, ...(author ? ['-c', `user.name=${author[0]}`, '-c', `user.email=${author[1]}`] : []), 'commit', '-q', '-m', msg);
  return git(dev, 'rev-parse', 'HEAD').trim();
};
const run = (...args) => spawnSync('node', [SCRIPT, ...args], { cwd: dev, encoding: 'utf8' });
const pubMain = () => git(pub, 'rev-parse', 'refs/heads/main').trim();
const pubFiles = () => new Set(git(pub, 'ls-tree', '-r', '--name-only', 'main').split('\n').filter(Boolean));

let failed = 0;
const ok = (pass, msg, extra = '') => { console.log(`${pass ? 'PASS' : 'FAIL'} ${msg}${!pass && extra ? `\n     ${extra.trim().split('\n').slice(-6).join('\n     ')}` : ''}`); if (!pass) failed++; };

try {
  git(tmp, 'init', '-q', '--bare', pub);
  git(tmp, 'init', '-q', '--bare', priv);
  git(tmp, 'init', '-q', '-b', 'main', dev);
  git(dev, 'config', 'user.name', 'owner');
  git(dev, 'config', 'user.email', 'owner@example.invalid');
  git(dev, 'remote', 'add', 'origin', priv);
  git(dev, 'remote', 'add', 'public', pub);

  const DROP = ['docs/plan.md', 'docs/m9/lanes/x-handoff.md', '.claude/launch.json', 'suno musics/Afloat/a.mp3',
    'CODEX-筆記.md', '研究_模型.md', '圖示規格單_2026.md', 'DESIGN_BRIEF.md'];
  const KEEP = ['index.html', 'README.md', 'LICENSE', 'data/a.json', 'scripts/x.mjs', 'app/docs/keep.md',
    'sub/CODEX-keep.md', 'sub/研究_keep.md', 'docs.html', 'rail-3d/m.bin'];
  for (const f of [...DROP, ...KEEP]) write(f, `${f}\n`);
  write('index.html', "const BUILD = 'v0101a';\n");
  const c0 = commitAll('初始');
  git(dev, 'push', '-q', 'public', `${c0}:refs/heads/main`); // 模擬搬家前就公開的歷史

  // A. --dry-run：不建 commit、不推
  let r = run('--ref', 'HEAD', '--dry-run');
  ok(r.status === 0 && /拿掉 8 檔/.test(r.stdout) && pubMain() === c0, 'A1 --dry-run 算得出要拿掉 8 檔、公開 main 沒動', r.stdout + r.stderr);

  // B. 第一次快照：只拿掉內部檔案
  r = run('--ref', 'HEAD');
  const x1 = pubMain();
  const files1 = pubFiles();
  ok(r.status === 0 && x1 !== c0, 'B1 第一次快照推上去了', r.stdout + r.stderr);
  ok(DROP.every(f => !files1.has(f)), 'B2 排除清單的檔都不在公開 main', [...files1].filter(f => DROP.includes(f)).join(', '));
  ok(KEEP.every(f => files1.has(f)), 'B3 名字像但不在清單的檔都留著（子目錄的 CODEX-*、docs.html、app/docs/）', KEEP.filter(f => !files1.has(f)).join(', '));
  ok(git(pub, 'rev-parse', `${x1}^`).trim() === c0, 'B4 快照接在原本的公開 main 後面（快進、沒改寫歷史）');
  const msg1 = git(pub, 'log', '-1', '--format=%B', x1);
  ok(msg1.startsWith('網站 v0101a 上線（') && msg1.includes(`Source-Commit: ${c0}`) && !/Co-authored-by/.test(msg1), 'B5 訊息只有版本、日期、來源 commit', msg1);

  // C. 同一版再跑：不推
  r = run('--ref', 'HEAD');
  ok(r.status === 0 && pubMain() === x1 && /已經是這一版/.test(r.stdout), 'C1 同一版再跑不會多一顆', r.stdout + r.stderr);

  // D. 只改內部檔案：不推
  write('docs/plan.md', '使用者原話寫在這裡也不會公開\n');
  commitAll('docs: 計畫');
  r = run('--ref', 'HEAD');
  ok(r.status === 0 && pubMain() === x1, 'D1 只動 docs 的出貨不會產生公開 commit', r.stdout + r.stderr);

  // E. 改網站＋外部貢獻者：多一顆、保留署名、接在上一顆快照後面
  write('index.html', "const BUILD = 'v0101b';\n// 新功能\n");
  commitAll('feat: 新功能');
  write('scripts/x.mjs', 'export const fixed = true;\n');
  const c3 = commitAll('fix: 外部修正', ['Ext Contributor', 'ext@example.invalid']);
  r = run('--ref', 'HEAD');
  const x2 = pubMain();
  const msg2 = git(pub, 'log', '-1', '--format=%B', x2);
  ok(r.status === 0 && x2 !== x1 && git(pub, 'rev-parse', `${x2}^`).trim() === x1, 'E1 改網站後多一顆，父節點是上一顆快照', r.stdout + r.stderr);
  ok(msg2.startsWith('網站 v0101b 上線（') && msg2.includes(`Source-Commit: ${c3}`)
    && msg2.includes('Co-authored-by: Ext Contributor <ext@example.invalid>') && !msg2.includes('owner <'), 'E2 外部貢獻者有署名、自己沒有', msg2);
  ok(!pubFiles().has('docs/plan.md'), 'E3 第二顆快照仍然沒有 docs');

  // F. 新增行有金鑰字樣：衛生掃描擋下、不推（樣本用拼接，免得本檔自己被掃描器咬到）
  write('index.html', "const BUILD = 'v0101c';\nconst k = '" + 'AI' + 'za' + 'Q'.repeat(20) + "';\n");
  commitAll('feat: 帶金鑰');
  r = run('--ref', 'HEAD');
  ok(r.status !== 0 && pubMain() === x2, 'F1 新增行有金鑰字樣時不推', r.stdout + r.stderr);
  git(dev, 'reset', '-q', '--hard', 'HEAD~1');

  // G. 公開 main 被別處動過：不強推
  const other = path.join(tmp, 'other');
  git(tmp, 'clone', '-q', pub, other);
  fs.writeFileSync(path.join(other, 'README.md'), '在 GitHub 上按了合併\n');
  git(other, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-q', '-am', 'merge on github');
  git(other, 'push', '-q', 'origin', 'HEAD:main');
  const moved = pubMain();
  write('index.html', "const BUILD = 'v0101d';\n");
  commitAll('feat: 另一版');
  r = run('--ref', 'HEAD');
  ok(r.status !== 0 && pubMain() === moved, 'G1 公開 main 有開發 repo 沒有的 commit 時停下、不把它蓋掉', r.stdout + r.stderr);
  write('README.md', '在 GitHub 上按了合併\n'); // 把那個修改搬進開發 repo（實務上是 cherry-pick 或合併 PR 的 head）
  commitAll('port: 公開 main 上的修改');
  ok(run('--ref', 'HEAD', '--accept-public-main', moved.slice(0, 6)).status !== 0, 'G2 --accept-public-main 給太短的 sha 不算數');
  r = run('--ref', 'HEAD', '--accept-public-main', moved.slice(0, 10));
  ok(r.status === 0 && git(pub, 'rev-parse', `${pubMain()}^`).trim() === moved && /在 GitHub 上按了合併/.test(git(pub, 'show', 'main:README.md')),
    'G3 搬進私有 main 並明示接受之後再出：接在它後面、它的修改還在', r.stdout + r.stderr);

  // H. 參數防呆
  ok(run('--ref', 'HEAD', '--public-ref', 'HEAD~1').status === 2, 'H1 --public-ref 沒配 --dry-run 被拒');
  ok(run('--ref', 'HEAD', '--force').status === 2, 'H2 不認得的參數被拒');
  git(dev, 'remote', 'set-url', 'origin', pub);
  ok(run('--ref', 'HEAD').status !== 0, 'H3 origin 跟 public 指向同一個 repo 時拒絕');
} catch (e) {
  ok(false, `測試環境本身出錯：${String(e.stderr || e.message || e).slice(0, 300)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n──────── ${failed ? `FAIL ${failed} 項` : 'ALL PASS'} ────────`);
process.exit(failed ? 1 : 0);
