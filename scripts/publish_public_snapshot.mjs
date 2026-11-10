#!/usr/bin/env node
// 公開快照（2026-11-09 起）：開發在私有 repo（remote origin），公開 repo（remote public）
// 只在每次網站上線後收一顆 commit，內容＝上線那顆去掉內部檔案（排除清單見 isExcluded）。
//
// 用法：node scripts/publish_public_snapshot.mjs --ref <commit> [--dry-run] [--public-ref <ref>]
//   --dry-run     只算快照 tree、跑公開衛生掃描、印差異統計，不建 commit、不推。
//   --public-ref  比對基準改用這個 ref（預設是 fetch 之後的 public/main）。只准跟 --dry-run 一起用。
//   --accept-public-main <sha>  公開 main 被別處動過、而且那個修改已經搬進私有 main 之後，明示接在它後面。
//
// ship_web 正式出貨收貨之後自動呼叫。失敗不影響正式站：快照只看 tree、不看中間的 commit，
// 下一發出貨會整包補上。公開 main 被別處動過（例如在 GitHub 上按了合併）就停，不強推。
// .git/hooks/pre-push 擋所有推往公開 repo 的 push，只放行這支設的 RAILISLAND_PUBLIC_SNAPSHOT=1。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCANNER = path.join(HERE, 'verify_public_repo_hygiene.mjs');
const PUBLIC_REMOTE = 'public';

// 不進公開快照的路徑。只改這裡；scripts/verify_public_snapshot.mjs 會驗留下與拿掉的樣本。
const EXCLUDE_DIRS = ['docs/', '.claude/', 'suno musics/'];
const EXCLUDE_ROOT_FILES = /^(CODEX-[^/]*|研究_[^/]*|圖示規格單_[^/]*|DESIGN_BRIEF)\.md$/;
const isExcluded = p => EXCLUDE_DIRS.some(d => p.startsWith(d)) || (!p.includes('/') && EXCLUDE_ROOT_FILES.test(p));

const fail = (msg, code = 1) => { console.error('❌ ' + msg); process.exit(code); };
const argv = process.argv.slice(2);
const KNOWN = new Set(['--ref', '--dry-run', '--public-ref', '--accept-public-main']);
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) fail(`不認得的參數：${argv[i]}\n用法：node scripts/publish_public_snapshot.mjs --ref <commit> [--dry-run] [--public-ref <ref>]`, 2);
  if (argv[i] !== '--dry-run') i++;
}
const valueOf = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const REF = valueOf('--ref');
const PUBLIC_REF = valueOf('--public-ref');
const DRY = argv.includes('--dry-run');
const ACCEPT = valueOf('--accept-public-main');
if (!REF) fail('要給 --ref <commit>', 2);
if (PUBLIC_REF && !DRY) fail('--public-ref 只准跟 --dry-run 一起用（真的推只能接在 public/main 後面）', 2);

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, opts = {}) => execFileSync('git', ['-c', 'core.quotePath=false', ...args],
  { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });

const sha = git(['rev-parse', '--verify', `${REF}^{commit}`]).trim();
let base;
if (PUBLIC_REF) base = git(['rev-parse', '--verify', `${PUBLIC_REF}^{commit}`]).trim();
else {
  let publicUrl = '', originUrl = '';
  try { publicUrl = git(['remote', 'get-url', PUBLIC_REMOTE]).trim(); } catch {}
  try { originUrl = git(['remote', 'get-url', 'origin']).trim(); } catch {}
  if (!publicUrl) fail(`沒有名為 ${PUBLIC_REMOTE} 的 remote（公開 repo）`);
  if (publicUrl === originUrl) fail(`${PUBLIC_REMOTE} 跟 origin 指向同一個 repo（${publicUrl}），開發 repo 應該是私有的另一個`);
  git(['fetch', '--quiet', PUBLIC_REMOTE, 'main']);
  base = git(['rev-parse', '--verify', `refs/remotes/${PUBLIC_REMOTE}/main^{commit}`]).trim();
  console.log(`公開 repo：${publicUrl}（main = ${base.slice(0, 10)}）`);
}

// 公開 main 的尖端要嘛是上一顆快照（帶 Source-Commit），要嘛已經在開發歷史裡（搬家前的公開 main、
// 或已經併回私有 main 的外部修改）。兩者都不是 ⇒ 有人在 GitHub 上動了公開 main，快照整棵樹蓋上去會把那個修改
// 靜默退掉，所以停。
if (!/^Source-Commit: [0-9a-f]{40}$/m.test(git(['log', '-1', '--format=%B', base]))) {
  let contained = false;
  try { git(['merge-base', '--is-ancestor', base, sha]); contained = true; } catch {}
  if (!contained && !(ACCEPT && base.startsWith(ACCEPT) && ACCEPT.length >= 7))
    fail(`公開 main（${base.slice(0, 10)}）有開發 repo 沒有的 commit，可能有人在 GitHub 上按了合併。`
      + `先把那個修改搬進私有 main（cherry-pick，或抓 PR 的 head 合併），再加 --accept-public-main ${base.slice(0, 10)} 重跑`);
}

// 用暫存 index 從出貨那顆組出快照 tree，不碰任何工作樹。
const tmpIndex = path.join(os.tmpdir(), `public-snapshot-${process.pid}-${Date.now()}.index`);
const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
let tree, kept, dropped;
try {
  git(['read-tree', sha], { env });
  const all = git(['ls-files', '-z'], { env }).split('\0').filter(Boolean);
  const drop = all.filter(isExcluded);
  if (drop.length) git(['update-index', '--force-remove', '-z', '--stdin'], { env, input: drop.join('\0') + '\0' });
  tree = git(['write-tree'], { env }).trim();
  kept = all.length - drop.length; dropped = drop.length;
} finally { fs.rmSync(tmpIndex, { force: true }); }

const leaked = git(['ls-tree', '-r', '-z', '--name-only', tree]).split('\0').filter(Boolean).filter(isExcluded);
if (leaked.length) fail(`快照 tree 裡還有該排除的檔：${leaked.slice(0, 5).join('、')}`);
console.log(`快照 tree ${tree.slice(0, 10)}：來源 ${sha.slice(0, 10)}，留 ${kept} 檔、拿掉 ${dropped} 檔`);

if (git(['rev-parse', `${base}^{tree}`]).trim() === tree) {
  console.log('✅ 公開 repo 已經是這一版，不用推');
  process.exit(0);
}
console.log(`跟公開 main 的差異：${git(['diff', '--shortstat', base, tree]).trim()}`);

const scan = spawnSync('node', [SCANNER, `--tree-diff=${base}..${tree}`], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const scanOut = (scan.stdout || '') + (scan.stderr || '');
process.stdout.write(scanOut.split('\n').filter(l => /^(FAIL|      |─{4,} )/.test(l)).join('\n') + '\n');
if (scan.status !== 0) fail('公開衛生掃描未過，沒有推（完整輸出：node scripts/verify_public_repo_hygiene.mjs '
  + `--tree-diff=${base}..${tree}）`);

if (DRY) { console.log('（--dry-run：沒有建 commit、沒有推）'); process.exit(0); }

// 訊息只放網站上本來就公開的東西：版本字串、日期、來源 commit；有外部貢獻者就保留署名。
const build = (git(['show', `${sha}:index.html`]).match(/const BUILD = '([^']+)'/) || [])[1] || '（版本不明）';
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
const prevSource = (git(['log', '-1', '--format=%B', base]).match(/^Source-Commit: ([0-9a-f]{40})$/m) || [])[1];
let coauthors = [];
if (prevSource) {
  let isAncestor = false;
  try { git(['merge-base', '--is-ancestor', prevSource, sha]); isAncestor = true; } catch {}
  if (isAncestor) {
    const me = git(['config', 'user.name']).trim();
    coauthors = [...new Set(git(['log', '--format=%an <%ae>', `${prevSource}..${sha}`]).split('\n').filter(Boolean))]
      .filter(a => !a.startsWith(`${me} <`));
  }
}
const message = `網站 ${build} 上線（${date}）\n\nSource-Commit: ${sha}\n`
  + coauthors.map(a => `Co-authored-by: ${a}\n`).join('');
const commit = git(['commit-tree', tree, '-p', base, '-F', '-'], { input: message }).trim();

const push = spawnSync('git', ['push', PUBLIC_REMOTE, `${commit}:refs/heads/main`],
  { cwd: repo, encoding: 'utf8', env: { ...process.env, RAILISLAND_PUBLIC_SNAPSHOT: '1' } });
process.stdout.write(push.stdout || ''); process.stderr.write(push.stderr || '');
if (push.status !== 0) fail(`推公開 repo 失敗（沒有強推）。公開 main 若被動過，先看 git log ${PUBLIC_REMOTE}/main`);

const remoteMain = git(['ls-remote', PUBLIC_REMOTE, 'refs/heads/main']).split(/\s/)[0];
if (remoteMain !== commit) fail(`推完公開 main 是 ${remoteMain.slice(0, 10)}，不是剛推的 ${commit.slice(0, 10)}`);
console.log(`✅ 公開快照已推：${commit.slice(0, 10)}（網站 ${build}，來源 ${sha.slice(0, 10)}${coauthors.length ? `，署名 ${coauthors.length} 位` : ''}）`);
