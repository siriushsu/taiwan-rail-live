// 在**真 workerd** 裡冒煙測試每一支帶憑證 subrequest 的端點。
//
// 🔴 為什麼需要這支（2026-08-04 23:36 事故）：那批把 worker.js 全部 22 個 fetch 呼叫點改成
// `redirect: 'error'`，判準 verify_plus_redirect_policy.mjs 全綠出貨，正式站所有打 TDX 的端點當場
// 502（tra-live／metro-live／三支 alert），十六分鐘後回滾。真因是 **Cloudflare Workers 的 fetch()
// 根本不接受 'error'**，workerd 在呼叫當下就丟：
//   Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented…)
// 而那支判準跑在**本機 Node**（Node 的 fetch 支援 'error'），替身又自己把 'error' 模擬成「遇到 30x
// 才 reject」——判準的行為模型與實作出自同一個誤解（心得 29：判準不得與實作同源），
// **結構上不可能測出來**。
//
// 所以這支的存在理由只有一個：**只有真 runtime 答得出「這個值 workerd 收不收」**。它不驗語意
// （那是另一支的事），只驗「跑起來會不會被 runtime 當場拒絕」。兩支要一起跑才算驗過。
//
// 用法：
//   node scripts/verify_worker_runtime_smoke.mjs              （含突變對照，約 60–90 秒）
//   node scripts/verify_worker_runtime_smoke.mjs --no-mutation（只跑對照組，約 30–45 秒）
//
// 本機環境的既知條件（照 wrangler-local-verification-traps 記憶檔設計，不是產品問題）：
//   · `wrangler dev` 只讀 `.dev.vars` 不讀 `.env` ⇒ 這台多半沒有 TDX／北捷金鑰，上游會回 400/401，
//     **這正好可以用**：憑證錯不錯無所謂，重點是 fetch() 有沒有被 runtime 放行。
//   · 必須 `--local-protocol https`，否則 worker.js 開頭的 http→https 301 會讓 /api/* 無限重導。
//   · `npx wrangler` 在這台被 Rosetta 拉成 x64 ⇒ 一律 `arch -arm64 node ./node_modules/wrangler/…`。
//   · server 一律從乾淨 worktree 起（工作樹會 ~5 次/秒重載風暴，請求會被殺掉）。
//   · 突變測試重啟前必刪 `.wrangler`（邊緣快取跨重啟存活 ⇒ 假綠）。
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const RUN_MUTATION = !process.argv.includes('--no-mutation');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

let fails = 0;
const check = (ok, msg, detail = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`);
};

// ── G0：驗的是哪棵樹、哪一版 worker.js（心得 32）─────────────────────────────────────────
const WORKER_SRC = readFileSync(WORKER_PATH);
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5(WORKER_SRC)}（工作樹當下的內容，含未 commit 的改動）`);

// ── 受測端點：每一支都會發出至少一個帶憑證的 subrequest ────────────────────────────────
// 只列「上游是外部服務」的；純 D1／純資產的端點不在射程內。
const ENDPOINTS = [
  { path: '/api/tra-live', 上游: 'TDX' },
  { path: '/api/tra-alert', 上游: 'TDX' },
  { path: '/api/thsr-alert', 上游: 'TDX' },
  { path: '/api/metro-alert', 上游: 'TDX' },
  { path: '/api/metro-live?sys=mrt', 上游: 'TDX' },
  { path: '/api/klrt-position', 上游: 'TDX（高雄輕軌逐車 GPS）' },
  { path: '/api/ntmetro-live?sys=ntm', 上游: '新北捷（公開端點，具名豁免）' },
  { path: '/api/trtc-live', 上游: '北捷會員 API' },
  { path: '/api/hazard-alert', 上游: 'NCDR（公開端點，具名豁免）' },
];

// runtime 拒收 redirect 值時的指紋。抓兩個獨立特徵，避免哪天訊息措辭微調就整支失明。
const REJECTED = /Invalid redirect value|must be one of "follow" or "manual"/i;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

// 起一台乾淨 worktree 的 wrangler dev，回傳 { base, stop, log }。
async function startServer(label, workerSource) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rt-smoke-'));
  const tree = path.join(dir, 'vtree');
  execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', tree, 'HEAD'], { stdio: 'ignore' });
  // 🔴 刻意**不**把 node_modules symlink 進來。wrangler 本體是用 ROOT 的絕對路徑呼叫的，
  // 而 worker.js 只 import 同 repo 的相對檔（`./scripts/trtc_board_ledger.mjs`），零 node_modules 相依。
  // 借進來反而害慘：本專案 `assets.directory` 是 `"."`，資產監看器會跟著 symlink 走進數萬個目錄
  // ——wrangler 會自己抱怨「reduce the number of subdirectories」，然後起服務從約 60 秒暴增到
  // 超過 240 秒（2026-08-05 實測，這支因此假紅一次）。
  for (const f of ['.dev.vars', '.env']) {
    if (existsSync(path.join(ROOT, f)) && !existsSync(path.join(tree, f))) {
      symlinkSync(path.join(ROOT, f), path.join(tree, f));
    }
  }
  // 受測的 worker.js 是**工作樹當下**的內容（可能未 commit），不是 HEAD 的。寫進去後立刻回讀
  // 比對 md5——不做這一步，就可能像心得 32 那樣連兩輪驗的都是別的檔案。
  const target = path.join(tree, 'worker.js');
  writeFileSync(target, workerSource);
  const landed = md5(readFileSync(target));
  check(landed === md5(workerSource), `[${label}] 起 server 的樹裡，worker.js 逐 byte 等於要驗的內容`, `md5=${landed}`);

  const port = await freePort();
  const inspectorPort = await freePort();          // 預設兩邊都搶 9230，必須各給一個
  const proc = spawn('arch', ['-arm64', 'node', path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--local-protocol', 'https', '--port', String(port), '--inspector-port', String(inspectorPort)],
  { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  const base = `https://127.0.0.1:${port}`;
  const stop = () => {
    try { proc.kill('SIGTERM'); } catch (e) { /* 已經死了 */ }
    try { execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch (e) { /* 留著也無妨 */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 同上 */ }
  };

  // 就緒檢查一定要**真打一發 HTTP**（只看埠開了會誤判成已就緒——這台的 wrangler 立刻 bind 好埠，
  // 但要約 50 秒才真的能服務）。每一發自帶 timeout，否則暖機期卡住的請求會把整個 deadline 用光。
  // 刻意**不**看狀態碼：/api/delay-stats 在全新的本機 D1 上本來就回 503，那是環境條件不是暖機狀態，
  // 把它寫進就緒條件會讓這支永遠等不到（試過）。
  const t0 = Date.now();
  const deadline = t0 + 300_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/api/delay-stats`, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      await r.text();
      ready = true; break;                                        // 給得出回應就算就緒，不看狀態碼
    } catch (e) { /* 還沒起來，等下一輪 */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  const 起服務秒 = Math.round((Date.now() - t0) / 1000);
  // 耗時要印出來：這個數字一變大就是監看範圍又被撐開了（例如有人把 node_modules 借回樹裡），
  // 藏起來的話只會在某天變成「逾時假紅」再重查一次。
  check(ready, `[${label}] wrangler dev 起得來且真的回應 HTTP（不是只看到埠開著）`,
    ready ? `${base}（起服務耗時 ${起服務秒}s）` : `等了 ${起服務秒}s 仍無回應；退出碼=${proc.exitCode}；log 尾巴：${log.slice(-400)}`);
  return { base, stop, log: () => log, ready };
}

// 打一輪所有端點，回傳每支的 { status, body, 被 runtime 拒收 }。
async function probeAll(base) {
  const out = [];
  for (const ep of ENDPOINTS) {
    let status = 0; let body = '';
    try {
      const r = await fetch(base + ep.path, { headers: { 'cache-control': 'no-cache' } });
      status = r.status;
      body = (await r.text()).slice(0, 400);
    } catch (e) { body = `（連線失敗）${String(e && e.message || e)}`; }
    out.push({ ...ep, status, body, rejected: REJECTED.test(body) });
  }
  return out;
}

// ── 對照組：現行 worker.js 在真 workerd 裡不該有任何 redirect 值被拒收 ────────────────────
console.log(`\n===== 1 對照組：現行 worker.js 在真 workerd 裡跑 =====`);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';           // 本機 wrangler 是自簽憑證
const ctrl = await startServer('對照組', WORKER_SRC);
let ctrlProbes = [];
if (ctrl.ready) {
  ctrlProbes = await probeAll(ctrl.base);
  for (const p of ctrlProbes) {
    console.log(`    · ${p.path.padEnd(28)} ${String(p.status).padStart(3)}  ${p.body.replace(/\s+/g, ' ').slice(0, 88)}`);
  }
  const rejected = ctrlProbes.filter((p) => p.rejected);
  check(rejected.length === 0,
    'workerd 沒有拒收任何 redirect 值（沒有端點回 Invalid redirect value）',
    rejected.length ? rejected.map((p) => `${p.path} → ${p.body.slice(0, 80)}`).join(' ／ ') : `已打 ${ctrlProbes.length} 支端點`);

  // 🔴 fail-loud：綠燈必須是「真的跑到 fetch」換來的，不是「根本沒跑到那條路徑」。
  // 判準綁**證據形態**不綁措辭：200 ＝ subrequest 成功；502＋錯誤訊息裡帶著上游回的 HTTP 狀態碼
  // ＝ subrequest 發出去了、上游答了（本機沒金鑰時就是這一類，屬環境條件不是產品回歸）。
  // 兩者都不是 ⇒ 這一支這輪沒有鑑別力，明講、不靜默跳過。
  const 有跑到 = (p) => p.status === 200 || (p.status >= 500 && /\b[45]\d\d\b/.test(p.body));
  const reached = ctrlProbes.filter(有跑到);
  const 沒鑑別力 = ctrlProbes.filter((p) => !有跑到(p));
  check(reached.length >= 4,
    `至少 4 支端點真的把 subrequest 發出去了（綠燈不是因為沒跑到那條路徑）— 實得 ${reached.length}/${ctrlProbes.length}`,
    沒鑑別力.length ? `這輪沒有鑑別力的：${沒鑑別力.map((p) => `${p.path}(${p.status})`).join(', ')}` : '');
}

// ── 2 突變對照：故意寫回 'error'，這支冒煙測試必須當場抓到 ──────────────────────────────
// 沒有這一段，這支腳本本身就是「未經證實有牙的判準」——正是 08-04 那場事故的形狀。
if (RUN_MUTATION && ctrl.ready) {
  console.log(`\n===== 2 突變對照：把一處寫回 redirect:'error'（重演事故）=====`);
  const src = WORKER_SRC.toString('utf8');
  const NEEDLE = "client_secret: env.TDX_CLIENT_SECRET,\n    }),\n    redirect: 'manual',";
  const mutated = src.replace(NEEDLE, NEEDLE.replace("'manual'", "'error'"));
  check(mutated !== src, "突變真的套用了（比對字串有對到 getTdxToken 那處）", mutated === src ? '沒對到 ⇒ 這段等於沒跑' : '');
  if (mutated !== src) {
    const mut = await startServer('突變組', Buffer.from(mutated, 'utf8'));
    if (mut.ready) {
      const probes = await probeAll(mut.base);
      for (const p of probes) {
        console.log(`    · ${p.path.padEnd(28)} ${String(p.status).padStart(3)}  ${p.body.replace(/\s+/g, ' ').slice(0, 88)}`);
      }
      const tdx = probes.filter((p) => p.上游 === 'TDX');
      const caught = tdx.filter((p) => p.rejected);
      check(caught.length === tdx.length && tdx.length > 0,
        `突變後每一支打 TDX 的端點都被 workerd 拒收 ⇒ 這支冒煙測試對事故有牙 — ${caught.length}/${tdx.length}`,
        caught.length === tdx.length ? '' : `沒被抓到的：${tdx.filter((p) => !p.rejected).map((p) => `${p.path}(${p.status}) ${p.body.slice(0, 60)}`).join(' ／ ')}`);
      const 不該被波及 = probes.filter((p) => p.上游 !== 'TDX' && p.rejected);
      check(不該被波及.length === 0,
        '突變只讓 TDX 那條路徑紅，沒有波及不相干的端點（紅得有指向性，不是整片壞掉）',
        不該被波及.map((p) => p.path).join(', '));
    }
    mut.stop();
  }
}

ctrl.stop();
console.log(`\n──────── ${fails ? `${fails} 條 FAIL` : '全部 PASS'} ────────`);
process.exit(fails ? 1 : 0);
