#!/usr/bin/env node
// ship_web 並行出貨防線（scripts/ship_web_guard.mjs）的守門人。
//
// 為什麼需要這支:ship_web.mjs 本身不能試跑(沒有 --help、不認得的旗標一律忽略,不帶 --preview
// 就是出正式站),所以兩道防線的邏輯拆進 ship_web_guard.mjs,在這裡直接測:
//   L 組 出貨鎖——用真的子程序(真的 pid):第二發被擋且訊息點名持有者、死鎖被接手、
//        正常結束／fail() 的 process.exit／丟例外三條路都會解鎖、不會刪到別人的鎖。
//   P 組 認正式站——在暫存目錄造 origin＋兩個 clone 的小 repo(假 strip 腳本只刪整行註解)。
//        「正式站內容」由這支自己的 expectStripped() 產生,不經過被測的程式碼。
//   W 組 ship_web.mjs 的呼叫位置(靜態)——模組對了但沒被呼叫,等於沒有。
// 預設全部離線、只寫暫存目錄:不碰共用的 .git/ship-web.lock、不打正式站、不跑 ship_web.mjs。
//
// 兩個手動模式(唯讀,但會連網):
//   --real  在本 repo 上跑真的去註解:拿 HEAD 的產物當「正式站」,看認不認得出 HEAD。
//   --live  抓真正的正式站,報它是哪一顆、是不是 origin/main 的祖先。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as guard from './ship_web_guard.mjs';
import { acquireShipLock, checkProductionAncestry } from './ship_web_guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'ship_web_guard.mjs');
const R = [];
const ok = (id, pass, detail) => { R.push(pass); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };
const taipei = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-web-guard-'));

if (process.argv.includes('--live') || process.argv.includes('--real')) await manual();

// ── L 組:出貨鎖 ────────────────────────────────────────────────────────────
// 子程序:拿鎖後依 mode 結束。hold＝等父程序關 stdin 才正常結束。
const CHILD = `
import { acquireShipLock } from ${JSON.stringify(pathToFileURL(GUARD).href)};
const [lockPath, ref, sha, mode] = process.argv.slice(1);
const r = acquireShipLock({ lockPath, ref, sha });
if (!r.ok) { console.log('REFUSED ' + r.message); process.exit(3); }
if (r.note) console.log('NOTE ' + r.note);
console.log('LOCKED ' + process.pid);
if (mode === 'hold') await new Promise(res => { process.stdin.on('end', res); process.stdin.resume(); });
if (mode === 'exit1') { try { process.exit(1); } finally { console.log('FINALLY-RAN'); } }
if (mode === 'throw') throw new Error('boom');
`;
const runChild = (lockPath, mode = 'normal', ref = 'origin/main', sha = 'c'.repeat(40)) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, lockPath, ref, sha, mode], { encoding: 'utf8' });
const holdChild = (lockPath, ref, sha) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD, lockPath, ref, sha, 'hold']);
  let out = '';
  const t = setTimeout(() => reject(new Error(`持鎖子程序 30 秒沒拿到鎖:${out}`)), 30000);   // 出貨時機器常滿載
  child.stdout.on('data', d => { out += d; if (out.includes('LOCKED')) { clearTimeout(t); resolve(child); } });
  child.on('exit', c => { clearTimeout(t); reject(new Error(`持鎖子程序提早結束(${c}):${out}`)); });
});
const exited = child => (child.exitCode !== null || child.signalCode !== null)
  ? Promise.resolve() : new Promise(r => child.once('exit', r));
const deadPid = () => { const p = spawnSync(process.execPath, ['-e', '0']).pid; try { process.kill(p, 0); return null; } catch { return p; } };
const exists = f => fs.existsSync(f);
const readOr = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
// 一組中途丟例外(例如被突變弄壞後鎖檔不見了)只記成那一組 ❌,後面照跑——整支掛掉的話,
// 後面的判準會「沒紅也沒綠」,突變測試就看不出它們到底有沒有牙。
const group = async (id, fn) => { try { await fn(); } catch (e) { ok(id, false, `整組中途丟出例外:${String(e.message).split('\n')[0]}`); } };

await group('L1', async () => { // L1:第二發被擋,訊息點名持有者的 pid／ref／起跑時間,而且沒動到持有者的鎖
  const lp = path.join(TMP, 'l1.lock');
  const ref = 'feature/l1-holder', sha = 'a1'.repeat(20);
  const holder = await holdChild(lp, ref, sha);
  const before = readOr(lp);
  const held = JSON.parse(before);
  const b = runChild(lp);
  const msg = b.stdout;
  ok('L1a 第二發被擋', b.status === 3 && msg.startsWith('REFUSED'), `exit ${b.status}:${msg.trim().slice(0, 90)}`);
  ok('L1b 訊息點名持有者 pid', msg.includes(`pid ${holder.pid}`), `要有「pid ${holder.pid}」`);
  ok('L1c 訊息點名持有者 ref 與 sha', msg.includes(`ref ${ref}`) && msg.includes(sha.slice(0, 8)), `要有「ref ${ref}」與 ${sha.slice(0, 8)}`);
  ok('L1d 訊息點名起跑時間', msg.includes(taipei(held.startedAt)), `要有「${taipei(held.startedAt)}」(鎖檔 startedAt ${held.startedAt})`);
  ok('L1e 被擋的那發沒動到持有者的鎖', readOr(lp) === before, '鎖檔內容逐字不變');
  holder.stdin.end(); await exited(holder);
  ok('L1f 持有者正常結束就解鎖', !exists(lp), exists(lp) ? '鎖檔還在' : '鎖檔已刪');
});

await group('L2', async () => { // L2:鎖檔的 pid 已死 ⇒ 接手,並說出接手了誰
  const lp = path.join(TMP, 'l2.lock');
  const pid = deadPid();
  fs.writeFileSync(lp, JSON.stringify({ pid, ref: 'origin/main', sha: 'd'.repeat(40),
    startedAt: new Date(Date.now() - 50 * 60000).toISOString(), token: 'dead' }) + '\n');
  const c = runChild(lp);
  ok('L2a 死鎖(pid 已死)被接手', pid !== null && c.status === 0 && c.stdout.includes('LOCKED'), `pid ${pid}:exit ${c.status}`);
  ok('L2b 接手時說出前任 pid', c.stdout.includes('接手') && c.stdout.includes(`pid ${pid}`), c.stdout.split('\n')[0].slice(0, 90));
  ok('L2c 接手的那發結束後解鎖', !exists(lp), exists(lp) ? '鎖檔還在' : '鎖檔已刪');
});

await group('L3', async () => { // L3:真的被 SIGKILL 的持有者——'exit' 不會跑、鎖會留下(所以才需要接手),下一發接得起來
  const lp = path.join(TMP, 'l3.lock');
  const holder = await holdChild(lp, 'origin/main', 'e'.repeat(40));
  holder.kill('SIGKILL'); await exited(holder);
  ok('L3a SIGKILL 後鎖檔留著(不接手就會永遠卡住)', exists(lp), exists(lp) ? '留著' : '不見了——那這組就沒測到接手');
  const c = runChild(lp);
  ok('L3b 下一發接手被殺掉的那發', c.status === 0 && c.stdout.includes(`pid ${holder.pid}`), `exit ${c.status}:${c.stdout.split('\n')[0].slice(0, 80)}`);
});

await group('L4–L6', async () => { // L4–L6:三條結束路徑都解鎖。exit1 對應 ship_web 的 fail()——它走 process.exit,finally 不會跑
  for (const [id, mode, want] of [['L4 正常結束', 'normal', 0], ['L5 fail() 的 process.exit(1)', 'exit1', 1], ['L6 丟出例外', 'throw', 1]]) {
    const lp = path.join(TMP, `${mode}.lock`);
    const c = runChild(lp, mode);
    const locked = c.stdout.includes('LOCKED');
    ok(`${id} 解鎖`, locked && c.status === want && !exists(lp),
      `拿到鎖 ${locked}、exit ${c.status}、鎖檔${exists(lp) ? '還在' : '已刪'}` + (mode === 'exit1' ? `、finally ${c.stdout.includes('FINALLY-RAN') ? '有跑' : '沒跑(所以不能靠 finally 解鎖)'}` : ''));
  }
});

await group('L7', async () => { // L7:release 只刪自己那一份——鎖已被別人接手時不能把他的刪掉
  const lp = path.join(TMP, 'l7.lock');
  const r = acquireShipLock({ lockPath: lp, ref: 'origin/main', sha: 'f'.repeat(40) });
  const other = JSON.stringify({ pid: 99999, ref: 'x', sha: 'x', startedAt: new Date().toISOString(), token: 'other' }) + '\n';
  fs.writeFileSync(lp, other);
  r.release();
  ok('L7 release 不刪別人的鎖', r.ok && readOr(lp) === other, readOr(lp) === other ? '別人的鎖還在' : '被刪或被改了');
  if (exists(lp)) fs.unlinkSync(lp);
});

await group('L8', async () => { // L8:pid 存在但不歸我們管(EPERM,例如 pid 1)＝活著,不准接手
  const lp = path.join(TMP, 'l8.lock');
  fs.writeFileSync(lp, JSON.stringify({ pid: 1, ref: 'origin/main', sha: '1'.repeat(40), startedAt: new Date().toISOString(), token: 'p1' }) + '\n');
  const c = runChild(lp);
  ok('L8 EPERM 的 pid 當成活著', c.status === 3 && c.stdout.includes('pid 1，'), `exit ${c.status}:${c.stdout.trim().slice(0, 70)}`);
});

await group('L9', async () => { // L9:讀不懂的鎖檔不准當死鎖接手,要擋下並說怎麼處理
  const lp = path.join(TMP, 'l9.lock');
  fs.writeFileSync(lp, 'garbage');
  const c = runChild(lp);
  ok('L9 讀不懂的鎖檔被擋、原封不動', c.status === 3 && c.stdout.includes('讀不懂') && readOr(lp) === 'garbage',
    `exit ${c.status}:${c.stdout.trim().slice(0, 70)}`);
});

await group('L10', async () => { // L10:判死到搬走之間,鎖被別人換成新鎖(兩發同時接手的競態)——不准把那把新鎖當死鎖刪掉。
  // 用注入的 isAlive 把競態釘在「判死」那一刻,不靠碰運氣。
  const lp = path.join(TMP, 'l10.lock');
  const dead = deadPid();
  fs.writeFileSync(lp, JSON.stringify({ pid: dead, ref: 'origin/main', sha: '0'.repeat(40), startedAt: new Date().toISOString(), token: 'stale' }) + '\n');
  const fresh = JSON.stringify({ pid: process.pid, ref: 'origin/main', sha: '9'.repeat(40), startedAt: new Date().toISOString(), token: 'fresh' }) + '\n';
  let swapped = false;
  const r = acquireShipLock({ lockPath: lp, ref: 'x', sha: 'x'.repeat(40), isAlive: pid => {
    if (pid === dead && !swapped) { swapped = true; fs.writeFileSync(lp, fresh); return false; }
    return pid === process.pid;
  } });
  const intact = readOr(lp) === fresh;
  ok('L10 接手競態:不會把別人剛建的新鎖當死鎖刪掉', swapped && !r.ok && intact, `${r.ok ? '搶到了' : '擋下'}、鎖檔${intact ? '仍是那把新鎖' : '被動過'}`);
  if (exists(lp)) fs.unlinkSync(lp);
});

// ── P 組:認正式站 ──────────────────────────────────────────────────────────
// 假 strip 腳本:S1 刪整行 // 註解;S2 另外刪整行 /* */ 註解(用來測「重做時用那顆 commit 自己的腳本」)。
// 判準的正式站內容由 expectStripped() 產生——與被測的 guard 不同源。
const S1 = `import fs from 'node:fs'; import path from 'node:path';
const f = path.join(process.argv[2], 'index.html');
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\\n').filter(l => !/^\\s*\\/\\//.test(l)).join('\\n'));
`;
const S2 = `import fs from 'node:fs'; import path from 'node:path';
const f = path.join(process.argv[2], 'index.html');
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\\n').filter(l => !/^\\s*\\/\\//.test(l) && !/^\\s*\\/\\*.*\\*\\/\\s*$/.test(l)).join('\\n'));
`;
const expectStripped = (text, v) => text.split('\n')
  .filter(l => !/^\s*\/\//.test(l) && !(v === 'S2' && /^\s*\/\*.*\*\/\s*$/.test(l))).join('\n');
const page = (build, body) => `<!doctype html>\n<script>\n// const BUILD = 'v0';\nconst BUILD = '${build}';\n// 註解 ${body}\n/* s1 留、s2 刪 */\nrun('${body}');\n</script>\n`;
const I1 = page('v1', 'one'), I2 = page('v2', 'two'), I4 = page('v4', 'four'), I9 = page('v9', 'nine');
const M1 = '{"tra_times.json":"aaa"}\n', M2 = '{"tra_times.json":"bbb"}\n';

const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (dir, files) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); } };
const commit = (dir, files, msg) => { put(dir, files); G(dir, 'add', '-A'); G(dir, 'commit', '-q', '-m', msg); return G(dir, 'rev-parse', 'HEAD'); };

let work, other, broken, NM, C1, C2, C3, C4, C5;
await group('P0 建暫存 repo', async () => {
  const P = path.join(TMP, 'repo');
  fs.mkdirSync(P);
  G(P, 'init', '-q', '--bare', 'origin.git');
  G(P, 'clone', '-q', 'origin.git', 'work');
  work = path.join(P, 'work');
  C1 = commit(work, { 'index.html': I1, 'scripts/strip_ship_comments.mjs': S1, 'data/data_manifest.json': M1, 'worker.js': 'w1' }, 'C1');
  C2 = commit(work, { 'index.html': I2 }, 'C2 改 index');
  C3 = commit(work, { 'worker.js': 'w2' }, 'C3 只改 worker');
  G(work, 'push', '-q', 'origin', 'HEAD:main');
  G(P, 'clone', '-q', 'origin.git', 'other');
  other = path.join(P, 'other');
  C4 = commit(other, { 'index.html': I4, 'scripts/strip_ship_comments.mjs': S2 }, 'C4 改 index 與 strip 腳本');
  C5 = commit(other, { 'data/data_manifest.json': M2 }, 'C5 只改資料');
  G(other, 'push', '-q', 'origin', 'HEAD:main');           // work 還沒 fetch 到 C4／C5
  G(P, 'clone', '-q', 'origin.git', 'broken');
  broken = path.join(P, 'broken');
  G(broken, 'remote', 'set-url', 'origin', path.join(P, 'nope.git'));
  NM = path.join(P, 'nm'); fs.mkdirSync(NM);         // 假 strip 不需要 esbuild,但 guard 會照樣接 node_modules
});

const prodOf = (index, manifest, st = {}) => async p => {
  if (p === '/') return { status: st.index ?? 200, body: Buffer.from(index) };
  if (p === '/data/data_manifest.json') return manifest === null ? { status: 404, body: Buffer.alloc(0) } : { status: st.manifest ?? 200, body: Buffer.from(manifest) };
  return { status: 404, body: Buffer.alloc(0) };
};
const check = (repo, sha, fetchProd) => checkProductionAncestry({ repo, sha, fetchProd, nodeModules: NM, fetchRetryMs: 10 });
const s8 = c => c.slice(0, 8);

await group('P1', async () => { const r = await check(work, C3, prodOf(expectStripped(I1, 'S1'), M1));
  ok('P1 正式站是較舊的祖先 ⇒ 放行', r.ok && r.commit === C1, `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 80)}`); });
await group('P2', async () => { const r = await check(work, C3, prodOf(expectStripped(I2, 'S1'), M1));
  ok('P2 正式站＝出貨基準的指紋(C2／C3 同指紋) ⇒ 放行', r.ok && r.commit === C3, `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 80)}`); });
await group('P3', async () => { const r = await check(work, C3, prodOf(expectStripped(I4, 'S2'), M1));   // 要先重新 fetch 才看得到 C4
  ok('P3 正式站比出貨基準新(改過 index) ⇒ 擋,並點名那一顆', !r.ok && r.message.includes(s8(C4)) && r.message.includes('比出貨基準'),
    `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 90)}`); });
await group('P4', async () => { const r = await check(other, C4, prodOf(expectStripped(I4, 'S2'), M2));
  ok('P4 正式站比出貨基準新(只改資料、index 沒變) ⇒ 擋,並點名那一顆', !r.ok && r.message.includes(s8(C5)),
    `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 90)}`); });
await group('P5', async () => { const r = await check(work, C3, prodOf(expectStripped(I9, 'S1'), M1));
  ok('P5 正式站跟哪一顆都對不上 ⇒ 擋', !r.ok && r.message.startsWith('認不出正式站'), `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 70)}`); });
await group('P6', async () => { const r = await check(work, C3, prodOf(expectStripped(I1, 'S1'), M1, { index: 503 }));
  ok('P6 正式站 / 不是 200 ⇒ 擋', !r.ok && r.message.includes('503'), r.message.slice(0, 70)); });
await group('P7', async () => { const r = await check(work, C3, prodOf(expectStripped(I1, 'S1'), M1, { manifest: 500 }));
  ok('P7 資料清單抓不到(非 200／404) ⇒ 擋', !r.ok && r.message.includes('500'), r.message.slice(0, 70)); });
await group('P8', async () => { const r = await check(other, C5, prodOf(expectStripped(I1, 'S1'), M1));  // C5 的 strip 是 S2;C1 出貨時用的是 S1
  ok('P8 用那顆 commit 自己的 strip 腳本重做(腳本改過也認得出舊版)', r.ok && r.commit === C1, `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 80)}`); });
await group('P9', async () => { const r = await check(other, C5, prodOf(expectStripped(I4, 'S2'), M2));
  ok('P9 正式站就是出貨基準本身 ⇒ 放行', r.ok && r.commit === C5, `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 80)}`); });
await group('P10', async () => { const r = await check(broken, C3, prodOf(expectStripped(I1, 'S1'), M1));
  ok('P10 fetch origin 失敗 ⇒ 擋(不拿舊的 main 硬判)', !r.ok && r.message.includes('fetch'), r.message.split('\n')[0].slice(0, 70)); });
await group('P11', async () => { const r = await check(work, C3, prodOf(expectStripped(I1, 'S1'), M2));
  ok('P11 index 對上但資料清單對不上 ⇒ 擋', !r.ok && r.message.startsWith('認不出正式站'), `${r.ok ? '放行' : '擋'}:${r.message.slice(0, 70)}`); });

// ── W 組:ship_web.mjs 的呼叫位置(靜態) ─────────────────────────────────────
await group('W', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ship_web.mjs'), 'utf8');
  const at = s => src.indexOf(s);
  const lock = at('acquireShipLock({'), firstGate = at("'check_i18n.mjs'"), behind = at('`${sha}..origin/main`');
  const strip = at("'strip_ship_comments.mjs'"), upload = at("'versions', 'upload'"), deploy = at("'versions', 'deploy'");
  const pre = at("prodGate('上傳前')"), pre2 = at("prodGate('升版前'");
  ok('W1 出貨鎖在落後檢查與所有閘門之前拿', lock > 0 && lock < behind && lock < firstGate, `鎖@${lock}、落後檢查@${behind}、第一道閘門@${firstGate}`);
  ok('W2 鎖只在正式出貨拿,拿不到就停', /if \(!PREVIEW\) \{[^}]*acquireShipLock\(\{/.test(src) && /if \(!lock\.ok\) fail\(lock\.message\)/.test(src)
    && /'--git-common-dir'/.test(src), '要有 if (!PREVIEW) {…acquireShipLock、if (!lock.ok) fail(…)、--git-common-dir');
  ok('W3 upload 前認正式站(strip 之後、versions upload 之前,只在正式出貨)', strip > 0 && strip < pre && pre < upload
    && src.includes("if (!PREVIEW) await prodGate('上傳前')"), `strip@${strip}、認正式站@${pre}、upload@${upload}`);
  ok('W4 deploy 前再認一次(upload 之後、versions deploy 之前)', upload < pre2 && pre2 < deploy, `upload@${upload}、認正式站@${pre2}、deploy@${deploy}`);
  ok('W5 prodGate 真的呼叫 checkProductionAncestry 且未過就停', /const prodGate = async[^]*?checkProductionAncestry\(\{[^]*?if \(!r\.ok\) fail\(/.test(src),
    'prodGate 內要有 checkProductionAncestry(…) 與 if (!r.ok) fail(…)');
  // ship_web 不能跑,所以 import 打錯字要等到下一次真的出貨才炸——在這裡先對
  const names = ((src.match(/import \{([^}]+)\} from '\.\/ship_web_guard\.mjs'/) || [])[1] || '').split(',').map(s => s.trim()).filter(Boolean);
  ok('W6 ship_web 從 guard 匯入的名字都真的有匯出', names.length >= 2 && names.every(n => typeof guard[n] === 'function'), names.join('、') || '找不到那行 import');
});

fs.rmSync(TMP, { recursive: true, force: true });
const bad = R.filter(x => !x).length;
console.log(`\n${R.length - bad}/${R.length} 通過`);
process.exit(bad ? 1 : 0);

// ── 手動模式(唯讀,會連網)──────────────────────────────────────────────────
async function manual() {
  const fetchProd = async p => {
    const res = await fetch(`https://railisland.tw${p}?bust=${process.hrtime.bigint()}${Math.floor(Math.random() * 1e6)}`, { redirect: 'follow' });
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  };
  const nodeModules = path.join(ROOT, 'node_modules');
  if (process.argv.includes('--real')) {
    // 照出貨鏈的做法做出 HEAD 的產物(HEAD 的 index.html ＋ HEAD 的 strip 腳本),當成「正式站」
    const head = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const d = path.join(TMP, 'real');
    fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
    for (const f of ['index.html', 'scripts/strip_ship_comments.mjs'])
      fs.writeFileSync(path.join(d, f), execFileSync('git', ['-C', ROOT, 'show', `${head}:${f}`], { maxBuffer: 256 << 20 }));
    fs.symlinkSync(nodeModules, path.join(d, 'node_modules'));
    execFileSync(process.execPath, [path.join(d, 'scripts/strip_ship_comments.mjs'), d], { stdio: 'ignore' });
    const idx = fs.readFileSync(path.join(d, 'index.html'));
    const man = execFileSync('git', ['-C', ROOT, 'show', `${head}:data/data_manifest.json`]);
    fs.unlinkSync(path.join(d, 'node_modules'));
    const t0 = Date.now();
    const r = await checkProductionAncestry({ repo: ROOT, sha: head, nodeModules,
      fetchProd: async p => p === '/' ? { status: 200, body: idx } : { status: 200, body: man } });
    ok('REAL 真的去註解產物認得出是 HEAD', r.ok && r.commit === head, `${((Date.now() - t0) / 1000).toFixed(1)} 秒:${r.message}`);
  }
  if (process.argv.includes('--live')) {
    execFileSync('git', ['-C', ROOT, 'fetch', 'origin'], { stdio: 'ignore' });
    const main = execFileSync('git', ['-C', ROOT, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
    const t0 = Date.now();
    const r = await checkProductionAncestry({ repo: ROOT, sha: main, fetchProd, nodeModules });
    console.log(`LIVE（出貨基準＝origin/main ${main.slice(0, 8)}，${((Date.now() - t0) / 1000).toFixed(1)} 秒）${r.ok ? '放行' : '擋'}:${r.message}`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(R.some(x => !x) ? 1 : 0);
}
