// ship_web.mjs 的兩道並行出貨防線：出貨鎖、upload／deploy 前認正式站。
//
// 🔴 為什麼拆成獨立模組：ship_web.mjs 沒有 --help、不認得的旗標一律忽略，任何不帶 --preview 的
//    呼叫都會把 origin/main 出上正式站——它本身永遠不能拿來試跑。所以防線的邏輯全放這裡，由
//    scripts/verify_ship_web_guard.mjs 直接測；ship_web.mjs 只負責在對的位置呼叫
//    （呼叫位置也由那支的 W 組靜態守著）。背景、判準與限制寫在 ship_web.mjs 檔頭。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const taipei = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });

// ── 1. 出貨鎖 ──────────────────────────────────────────────────────────────

// EPERM＝程序在、只是不歸我們管 ⇒ 當它活著。寧可擋錯（多等一發），不可搶錯（兩發並行）。
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function describeHolder(h, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - Date.parse(h.startedAt)) / 60000));
  return `pid ${h.pid}，ref ${h.ref}（${String(h.sha).slice(0, 8)}），${taipei(h.startedAt)} 開始（台北時間，已跑 ${mins} 分鐘）`;
}

// 回傳 { ok:true, release, note } 或 { ok:false, message }。
// 🔴 解鎖掛在 process 'exit'，不靠呼叫端的 finally：ship_web 的 fail() 走 process.exit，
//    finally 根本不會跑（實測：exit(1) 不跑 finally、'exit' 會跑；throw 與 reject 兩者都跑）。
//    被 kill／Ctrl-C 的那發連 'exit' 都不跑——鎖留著但 pid 已死，下一發在這裡自己接手。
export function acquireShipLock({ lockPath, ref, sha, isAlive = pidAlive }) {
  const mine = JSON.stringify({ pid: process.pid, ref, sha, startedAt: new Date().toISOString(),
    token: crypto.randomBytes(8).toString('hex') }) + '\n';
  let note = '', last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(lockPath, mine, { flag: 'wx' });            // O_CREAT|O_EXCL：已有人持有就 EEXIST
      // 只刪自己那一份：萬一鎖已經被別人接手，不能把他的刪掉
      const release = () => { try { if (fs.readFileSync(lockPath, 'utf8') === mine) fs.unlinkSync(lockPath); } catch {} };
      process.on('exit', release);
      return { ok: true, release, note };
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let raw;
    try { raw = fs.readFileSync(lockPath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    last = raw;
    let h = null; try { h = JSON.parse(raw); } catch {}
    if (!Number.isInteger(h?.pid)) { sleepSync(200); continue; }   // 剛建好還沒寫完 ⇒ 稍等重讀
    if (isAlive(h.pid)) return { ok: false, message: `另一發 ship-web 正在出貨：${describeHolder(h)}。`
      + '兩發同時跑是「後收尾的贏」——較舊的那發會把較新的正式站蓋回去。等它跑完再出'
      + `（它成功或失敗都會自己解鎖；它若被中斷，下一發會自動接手）。鎖檔：${lockPath}` };
    // 持有者已死。先把那一份原子地搬到自己專屬的名字，再確認搬走的正是剛才判死的那一份——
    // 直接 unlink 的話，兩發同時接手會變成「甲刪死鎖、建新鎖；乙把甲的新鎖當死鎖刪掉」。
    const tomb = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try { fs.renameSync(lockPath, tomb); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (fs.readFileSync(tomb, 'utf8') !== raw) {                 // 判死到搬走之間被換成新鎖 ⇒ 原樣放回
      try { fs.linkSync(tomb, lockPath); } catch {}
      fs.unlinkSync(tomb); continue;
    }
    fs.unlinkSync(tomb);
    note = `⚠️ 接手殘留的出貨鎖：${describeHolder(h)}——那個程序已經不在（被中斷或當掉，沒跑到解鎖）`;
  }
  return { ok: false, message: `拿不到出貨鎖：${lockPath} 一直在變或讀不懂（內容：${last.trim() || '空'}）。`
    + '先 pgrep -fl scripts/ship_web.mjs 確認沒有 ship-web 在跑，再刪掉這個鎖檔重跑。' };
}

// ── 2. upload／deploy 前認正式站 ────────────────────────────────────────────
// 正式站的指紋＝去註解後的 index.html ＋ data/data_manifest.json。後者是開機資料檔的內容雜湊
// 清單（出貨鏈的 verify_data_manifest 保證它跟資料同步），線上那份與 git blob 逐 byte 相同，
// 所以直接比 blob id；少了它，只改資料的出貨（過去 300 顆裡比只改 index.html 的還多）全都認不出來。

const STRIP = 'scripts/strip_ship_comments.mjs';
const MANIFEST = 'data/data_manifest.json';
const buildsOf = s => new Set([...String(s).matchAll(/const BUILD = '([^']*)'/g)].map(m => m[1]));

// 每個 spec（<commit>:<path>）對應的 blob id；路徑不存在 ⇒ null
function blobIds(repo, specs) {
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch-check=%(objectname)'],
    { input: specs.join('\n') + '\n', encoding: 'utf8', maxBuffer: 256 << 20 });
  return out.split('\n').slice(0, specs.length).map(l => (/^[0-9a-f]{40,64}$/.test(l) ? l : null));
}

// 每顆代表 commit 的 index.html 裡出現過的所有 BUILD 值（註解裡的也算，所以正式站那個一定在其中）
function grepBuilds(repo, revs) {
  const out = new Map(revs.map(r => [r, new Set()]));
  for (let i = 0; i < revs.length; i += 200) {                 // 分批：命令列長度有上限
    const r = spawnSync('git', ['-C', repo, 'grep', '-o', '-e', "const BUILD = '[^']*'",
      ...revs.slice(i, i + 200), '--', 'index.html'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0 && r.status !== 1) throw new Error(`git grep 失敗：${r.stderr || r.error}`);   // 1＝沒命中
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^([0-9a-f]{40,64}):index\.html:const BUILD = '([^']*)'$/);
      if (m) out.get(m[1])?.add(m[2]);
    }
  }
  return out;
}

// 照出貨時的做法重做一次去註解：那顆 commit 的 index.html ＋【那顆 commit 自己的】strip 腳本。
// 腳本改過的話，拿現在這份去重做舊版會對不上，正式站就永遠認不出來、每發都被擋。
function strippedMd5(repo, indexBlob, stripBlob, nodeModules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-web-prod-'));
  try {
    const blob = id => execFileSync('git', ['-C', repo, 'cat-file', 'blob', id], { maxBuffer: 256 << 20 });
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'index.html'), blob(indexBlob));
    fs.writeFileSync(path.join(dir, STRIP), blob(stripBlob));
    fs.symlinkSync(nodeModules, path.join(dir, 'node_modules'));   // strip 要 esbuild（同 ship_web 對出貨樹的做法）
    const r = spawnSync(process.execPath, [path.join(dir, STRIP), dir], { encoding: 'utf8' });
    fs.unlinkSync(path.join(dir, 'node_modules'));                 // 先拆連結，下面的遞迴刪除才碰不到真的 node_modules
    if (r.status !== 0) return { error: (r.stderr || r.stdout || String(r.error)).trim().split('\n')[0] };
    return { md5: md5(fs.readFileSync(path.join(dir, 'index.html'))) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// 回傳 { ok, message, commit? }。判準：正式站的指紋等於某顆 X，且 X 在出貨基準的歷史裡（是祖先或就是它）。
// fetchProd(pathname) → { status, body }，每次都要帶不同的 bust 參數（邊緣快取不能回舊的）。
export async function checkProductionAncestry({ repo, sha, fetchProd, nodeModules, fetchRetryMs = 3000 }) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
  const list = s => s.split('\n').filter(Boolean);
  const label = c => `${c.slice(0, 8)}「${git('log', '-1', '--format=%s', c).slice(0, 40)}」`;

  // (1) 重新 fetch：別的 session 可能剛推了 main 又出了貨，沒有它的 commit 就只會落到「認不出」。
  //     別的 session 同時 fetch 會撞 ref lock，所以重試。
  for (let i = 1; ; i++) {
    const f = spawnSync('git', ['-C', repo, 'fetch', 'origin'], { encoding: 'utf8' });
    if (f.status === 0) break;
    if (i === 3) return { ok: false, message: 'git fetch origin 連續失敗 3 次——拿不到最新的 main 就認不出正式站，不出貨。\n'
      + (f.stderr || String(f.error)).trim() };
    sleepSync(fetchRetryMs);
  }

  // (2) 正式站的指紋
  const page = await fetchProd('/');
  if (page.status !== 200) return { ok: false, message: `正式站 / 回 HTTP ${page.status}——認不出線上是哪一版，不出貨`
    + '（正式站若真的掛了要不要硬出，由使用者決定）。' };
  const man = await fetchProd('/' + MANIFEST);
  if (man.status !== 200 && man.status !== 404) return { ok: false, message: `正式站 /${MANIFEST} 回 HTTP ${man.status}——認不出線上是哪一版，不出貨。` };
  const prodMan = man.status === 404 ? null
    : execFileSync('git', ['-C', repo, 'hash-object', '--stdin'], { input: man.body, encoding: 'utf8' }).trim();
  const prodMd5 = md5(page.body), prodBuilds = buildsOf(page.body);

  // (3) 候選＝origin/main 與出貨基準的【全部】歷史（設窗的話，很久沒出貨時正式站落在窗外就會假擋）。
  //     先用資料清單的 blob id 篩（精確、幾乎免費），再用 BUILD 字串篩，最後才真的跑去註解（每份約 3 秒）。
  const commits = list(git('rev-list', 'origin/main', sha));
  const newer = new Set(list(git('rev-list', `${sha}..origin/main`)));   // 在 main 上、不在出貨基準歷史裡
  const ids = blobIds(repo, commits.flatMap(c => [`${c}:index.html`, `${c}:${STRIP}`, `${c}:${MANIFEST}`]));
  const byIndex = new Map();                                   // index.html blob → [{ c, strip }]，新到舊
  commits.forEach((c, i) => {
    const [ib, sb, mb] = ids.slice(3 * i, 3 * i + 3);
    if (!ib || !sb || mb !== prodMan) return;
    if (!byIndex.has(ib)) byIndex.set(ib, []);
    byIndex.get(ib).push({ c, strip: sb });
  });
  const builds = grepBuilds(repo, [...byIndex.values()].map(xs => xs[0].c));
  const matched = [], stripErrors = [];
  for (const [ib, xs] of byIndex) {
    const bs = builds.get(xs[0].c);
    if (prodBuilds.size ? ![...prodBuilds].every(b => bs.has(b)) : bs.size) continue;
    for (const sb of new Set(xs.map(x => x.strip))) {
      const r = strippedMd5(repo, ib, sb, nodeModules);
      if (r.error) stripErrors.push(`${xs[0].c.slice(0, 8)}：${r.error}`);
      else if (r.md5 === prodMd5) matched.push(...xs.filter(x => x.strip === sb).map(x => x.c));
    }
  }

  // (4) 判定。同一個指紋可能對上好幾顆（只改 worker.js 或清單外資料的 commit 指紋不變）：
  //     只要其中一顆在出貨基準的歷史裡就放行——那幾顆之間的差異本來就看不見（限制見 ship_web.mjs 檔頭）。
  const anc = matched.filter(c => !newer.has(c)), nw = matched.filter(c => newer.has(c));
  if (anc.length) return { ok: true, commit: anc[0],
    message: `正式站＝${label(anc[0])}（去註解＋資料清單逐 byte 對上），是出貨基準 ${sha.slice(0, 8)} 的祖先 ✓` };
  if (nw.length) return { ok: false, message: `正式站是 ${nw.slice(0, 3).map(label).join('、')}${nw.length > 3 ? ` 等 ${nw.length} 顆` : ''}，`
    + `比出貨基準 ${sha.slice(0, 8)} 新（在 main 上、不在它的歷史裡）——照出會把它退掉。`
    + '把 origin/main 併進出貨基準再跑（不帶 --ref 就是出最新的 origin/main）。' };
  return { ok: false, message: `認不出正式站：它的 index.html（md5 ${prodMd5}、BUILD ${[...prodBuilds].join('／') || '無'}）`
    + `與 ${MANIFEST}（${prodMan ? prodMan.slice(0, 8) : '404'}）對不上 origin/main 或出貨基準 ${sha.slice(0, 8)} 歷史上任何一顆`
    + '——可能是從沒推上去的分支、髒工作樹，或繞過 ship-web 直接上傳的版本。先查清楚線上是哪一版'
    + '（wrangler deployments list），把它併進出貨基準再出；查不出來就停下來問使用者。'
    + (stripErrors.length ? `\n（有 ${stripErrors.length} 份去註解重做失敗，第一份：${stripErrors[0]}）` : '') };
}
