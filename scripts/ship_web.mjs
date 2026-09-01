#!/usr/bin/env node
// 網站出貨鏈（railisland.tw 正式站）——固化成唯一入口：npm run ship-web [-- --ref <ref>] [--preview]
//
// --preview：只做到 upload（不升 100%），給使用者親試用。預覽也走同一條乾淨樹＋strip，
// 因為預覽的用途是「試那顆待出貨的產物」——上傳未 strip 的原始檔，等於試的跟要出的不是同一份，
// 而且它一旦被 promote 就是把去註解靜默退掉（本檔開頭那個 08-27 事故的成因）。
// 🔴 預覽 URL 在 Cloudflare Access 後面：curl／Playwright 只會拿到登入頁，自動化驗不了，
// 只有使用者本人開得起來——所以這條路徑刻意沒有收貨檢查，不要假裝有。
//
// 為什麼要有這條：去註解（strip_ship_comments）是出貨的必經步驟，但它以前只是一個獨立
// npm script——任何一次「直接 wrangler versions upload」都會把原始檔出上去，去註解靜默
// 回歸（2026-08-27 音樂曲庫那次部署就是這樣把 08-26 的去註解版蓋掉的）。這支把
// 乾淨 worktree → strip（自帶 esbuild 逐 byte 等價證明）→ 上傳 → 升 100% → 對正式站
// 逐 byte 收貨 整條固化。防呆全是實際踩過的坑：
//  - 只從乾淨 detached worktree 出貨（wrangler 傳磁碟檔，.gitignore 管不到未追蹤檔）
//  - 出貨基準落後 origin/main 就停（整包替換會退掉別人的 commit）
//  - 內容與正式站不同但 BUILD 字串相同就停（內容不同的兩顆不准共用版號）
//  - versions deploy 的版本 ID 只取自同一次 upload 的輸出（versions list 取 [0] 會拿到最舊版）
//  - 收貨判準＝正式站 md5 與本地 stripped 檔逐 byte 相等（不是 BUILD 字串、不是抽 grep）

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const args = process.argv.slice(2);
const REF = (() => { const i = args.indexOf('--ref'); return i >= 0 ? args[i + 1] : 'origin/main'; })();
const PREVIEW = args.includes('--preview');
const PROD = 'https://railisland.tw';

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');
const fail = msg => { console.error('❌ ' + msg); process.exit(1); };
async function fetchProd(pathname = '/') {
  const url = `${PROD}${pathname}${pathname.includes('?') ? '&' : '?'}bust=${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  } catch { return { status: 0, body: Buffer.alloc(0) }; }
}

// ── 1. preflight ──────────────────────────────────────────────────────────
git('fetch', 'origin');
const sha = git('rev-parse', REF).trim();
const behind = git('log', '--oneline', `${sha}..origin/main`).trim();
if (behind) fail(`出貨基準落後 origin/main，整包替換會退掉這些 commit：\n${behind}`);
console.log(`出貨基準 ${REF} = ${sha.slice(0, 8)}`);

// ── 2. 乾淨 worktree（只含追蹤檔＝結構性排除所有未追蹤檔）──────────────────
const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-web-'));
git('worktree', 'add', '--detach', '--force', wt, sha);
let ok = false;
try {
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(wt, 'node_modules'));

  // ── 2.5 i18n 稽核閘門（漏譯不准出貨）──────────────────────────────────────
  // 🔴 位置不可移到 strip 之後:check_i18n 的 evaluateConstBlock 拿【註解】當區塊結束標記
  //    （'// 有精選特色'、'// 播放/速度/時間'），strip 把註解刪光之後它會報「找不到內容區塊」
  //    ——整條出貨鏈會每次都假紅卡死。2026-08-29 實測:同一顆 strip 前 exit 0、strip 後 exit 1。
  // 驗的是【這棵乾淨出貨樹】而不是呼叫者的工作樹（腳本 root 由自身檔案位置推導）；實測用
  // 「只弄壞乾淨樹的 index.html」確認過:乾淨樹紅、呼叫者工作樹綠，兩者確實獨立。
  const i18n = spawnSync('node', [path.join(wt, 'scripts', 'check_i18n.mjs')], { encoding: 'utf8' });
  process.stdout.write(i18n.stdout || ''); process.stderr.write(i18n.stderr || '');
  if (i18n.status !== 0) fail('i18n 稽核未過——補齊 en/ja 再出貨（單獨重跑：npm run check-i18n）');

  // ── 2.6 部署設定的「整包覆蓋」防線 ────────────────────────────────────────
  // `triggers.crons` 與 `.assetsignore` 都是宣告式整包覆蓋:部署時拿檔案裡那份【取代】現況。
  // 少一條不會有任何錯誤訊息——git 不當衝突、wrangler 不報錯、worker.js 的程式碼一行不少,
  // 只是那個分支永遠不會被呼叫,而少掉的東西可能不可重現（北捷帳本每分鐘的官方取樣）。
  // 這是唯一會在部署前擋下來的地方。同 i18n:驗的是【這棵乾淨出貨樹】那一份。
  const cfg = spawnSync('node', [path.join(wt, 'scripts', 'check_deploy_config.mjs')], { encoding: 'utf8' });
  process.stdout.write(cfg.stdout || ''); process.stderr.write(cfg.stderr || '');
  if (cfg.status !== 0) fail('部署設定檢查未過——cron 或資產排除少了東西,出貨會靜默關掉功能'
    + '（單獨重跑：npm run check-deploy-config）');

  // ── 2.7 對外用語閘門（更名後的舊名不准出貨）────────────────────────────────
  // 🔴 位置與 2.5 同一個理由,不可移到 strip 之後:check_voice 的 constBlock surface
  //    content-station／content-sys 用的 end 標記就是【註解】（'// 有精選特色'、
  //    '// 播放/速度/時間',與 check_i18n 同兩條),strip 刪光註解後抽不到區塊。
  // 這支此前【沒有任何呼叫者】（不在 package.json、不在本鏈、無 CI）——等於 2026-08-05
  // 產品更名(軌島 Plus → 軌島通行證)之後,對外文字再冒出「Plus」完全沒人守,跟 check_i18n
  // 在 2026-08-29 之前的處境一模一樣。同 i18n:驗的是【這棵乾淨出貨樹】那一份。
  const voice = spawnSync('node', [path.join(wt, 'scripts', 'check_voice.mjs')], { encoding: 'utf8' });
  process.stdout.write(voice.stdout || ''); process.stderr.write(voice.stderr || '');
  if (voice.status !== 0) fail('對外用語稽核未過——出貨文字用了更名前的舊名或未登記的 surface'
    + '（單獨重跑：npm run check-voice）');

  // ── 2.8 轉乘接續資料閘門（純 node、無瀏覽器，兩支合計數十毫秒，不划算不放進來的理由不成立）─
  // 只放這兩支（departures/connections),不放 pin/transitions/mobile——那三支要開瀏覽器
  // (Playwright),每次出貨多開一次瀏覽器的成本换不到對應的保護(它們驗的是互動/過渡態,
  // 不是「班表更新後資料還接得上」這種每次出貨都可能出錯的東西)。同 i18n/voice:驗的是
  // 【這棵乾淨出貨樹】那一份。「不在出貨鏈上的驗收腳本等於不存在」——這兩支本來就不吃
  // 瀏覽器,沒有理由不掛。
  const xferDep = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_departures.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferDep.stdout || ''); process.stderr.write(xferDep.stderr || '');
  if (xferDep.status !== 0) fail('轉乘接續資料未過——多半是班表更新後沒重產'
    + '（單獨重跑：npm run check-transfer-departures）');

  const xferConn = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_connections.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferConn.stdout || ''); process.stderr.write(xferConn.stderr || '');
  if (xferConn.status !== 0) fail('轉乘接續查詢層未過——transferConnections/transferConnectionHtml 邏輯壞了'
    + '（單獨重跑：npm run check-transfer-connections）');

  // ── 3. strip（腳本內建 esbuild AST 重印等價證明，任何不等價都非零退出）────
  const rawBytes = fs.readFileSync(path.join(wt, 'index.html'));
  execFileSync('node', [path.join(wt, 'scripts', 'strip_ship_comments.mjs'), wt], { stdio: 'inherit' });
  const stripped = fs.readFileSync(path.join(wt, 'index.html'));
  const strippedMd5 = md5(stripped);
  if (stripped.length >= rawBytes.length * 0.85)
    fail(`strip 後只小了 ${(100 - stripped.length / rawBytes.length * 100).toFixed(1)}%——疑似沒生效`);
  const anchors = s => (String(s).match(/APP_REPLACE_START/g) || []).length;
  if (anchors(stripped) !== anchors(rawBytes)) fail('APP_REPLACE 錨點數量變了——HTML 註解被動到');
  console.log(`strip ✓ ${rawBytes.length} → ${stripped.length} bytes（−${(100 - stripped.length / rawBytes.length * 100).toFixed(1)}%），md5 ${strippedMd5}`);

  // ── 4. BUILD 版號防撞 ────────────────────────────────────────────────────
  const buildOf = s => (String(s).match(/const BUILD = '([^']+)'/) || [])[1] || '';
  const newBuild = buildOf(stripped);
  const prodNow = await fetchProd('/');
  if (prodNow.status === 200 && md5(prodNow.body) !== strippedMd5 && buildOf(prodNow.body) === newBuild)
    fail(`內容與正式站不同但 BUILD 同為 '${newBuild}'——先 bump BUILD 再出貨`);

  // ── 5. upload ────────────────────────────────────────────────────────────
  const wrangler = path.join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const up = spawnSync('arch', ['-arm64', 'node', wrangler, 'versions', 'upload'], { cwd: wt, encoding: 'utf8' });
  process.stdout.write(up.stdout || ''); process.stderr.write(up.stderr || '');
  if (up.status !== 0) fail('versions upload 失敗');
  const verId = ((up.stdout || '') + (up.stderr || '')).match(/Worker Version ID:\s*([0-9a-f-]{36})/)?.[1];
  if (!verId) fail('upload 輸出裡找不到 Worker Version ID');
  console.log(`upload ✓ version ${verId}`);

  if (PREVIEW) {
    const out = (up.stdout || '') + (up.stderr || '');
    const url = out.match(/https:\/\/[0-9a-z-]+\.workers\.dev\S*/)?.[0]
      || `https://${verId.slice(0, 8)}-taiwan-rail-live.sirius1984.workers.dev`;
    console.log(`\n✅ 預覽已上傳（未升正式站）：${url}`);
    console.log(`   版本 ${verId}｜基底 ${sha.slice(0, 8)}｜BUILD '${newBuild}'｜stripped md5 ${strippedMd5}`);
    console.log(`   升正式站：把這條分支併進 main 之後跑 npm run ship-web`);
  } else {
    // ── 6. deploy @100%（ID 只取自上面那次 upload 的輸出）──────────────────
    const dep = spawnSync('arch', ['-arm64', 'node', wrangler, 'versions', 'deploy', `${verId}@100%`, '--yes'],
      { cwd: wt, encoding: 'utf8' });
    process.stdout.write(dep.stdout || ''); process.stderr.write(dep.stderr || '');
    if (dep.status !== 0) fail('versions deploy 失敗');

    // ── 7. 收貨：正式站逐 byte＝本地 stripped（邊緣快取最長等 ~3 分鐘）─────
    let live = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const got = await fetchProd('/');
      if (got.status === 200 && md5(got.body) === strippedMd5) { live = got; break; }
      console.log(`  收貨重試 ${attempt}/10（拿到 ${got.status}／md5 ${md5(got.body).slice(0, 8)}…，等 20s）`);
      await new Promise(r => setTimeout(r, 20000));
    }
    if (!live) fail('正式站內容在 ~3 分鐘內未收斂到本次 stripped md5——查 deployments list 與快取');
    const api = await fetchProd('/api/trtc-live');
    if (api.status !== 200) fail(`/api/trtc-live 回 ${api.status}——Worker 路由疑似壞了`);
    console.log(`✅ 出貨完成：railisland.tw 逐 byte＝stripped(${sha.slice(0, 8)})，${stripped.length} bytes，BUILD '${newBuild}'，API 200`);
  }
  ok = true;
} finally {
  if (ok) { try { git('worktree', 'remove', '--force', wt); git('worktree', 'prune'); } catch {} }
  else console.error(`（出貨樹保留供除錯：${wt}）`);
}
