// laPushAll 的單 tick 成本上界(修復輪次4/5)整個建立在一個 runtime 假設上:
//
//   「Workers 的 Date.now() 會在 await fetch() 之後往前走」
//
// Workers 為了緩解計時側通道,在沒有 I/O 的期間會把時鐘凍住。laPushAll 的牆鐘預算
// (LA_TICK_BUDGET_MS)是在迴圈裡讀 Date.now() 來決定要不要停手——若時鐘不推進,那個預算
// 永遠不會觸發,宣稱的上界(約 451 次 APNs 往返)就不成立。
//
// 🔴 為什麼非得在真 workerd 上量:verify_la_push_loop.mjs 走 getPlatformProxy(),那是在
// Node 裡跑 worker 程式碼,Node 的 Date.now() 本來就一直在走 ⇒ 這個假設在那支腳本裡【結構性
// 測不出來】。本專案已經被同一類假象咬過一次(workerd 不收 redirect:'error',Node 的 fetch
// 收 ⇒ 純 Node 判準測不出來,造成正式站 502 十六分鐘)。文件這樣寫 ≠ runtime 這樣跑。
//
// 做法:起一個「每次回應前故意慢 DELAY_MS」的本機 HTTP 伺服器,再用 wrangler dev(真 workerd)
// 跑一支極小探針 Worker,在裡面連打 N 次 fetch,每次記下 Date.now() - t0。
// 期望:delta 嚴格遞增、每步約 DELAY_MS。若每個 delta 都是 0 ⇒ 時鐘凍住,上界宣稱要改掉。
//
// 刻意不打 Apple、不需要金鑰、不需要 D1、不碰 repo 的 wrangler.jsonc:探針 Worker 與它的
// 設定都寫進 os.tmpdir() 的暫存目錄,跑完刪掉。純 HTTP(workerd 拒收自簽 HTTPS 憑證,
// 修復輪次1 已經撞過)。
//
// 用法:node scripts/probe_workerd_clock.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 20;                 // 打幾次 fetch
const DELAY_MS = 50;          // 本機伺服器每次刻意慢多久
const READY_DEADLINE_MS = 240_000;
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// 隨機高位埠;真的被佔用時 listen 會拋錯,直接讓腳本失敗比靜默改埠好(才不會量到別人的東西)
const pick = () => 40000 + Math.floor(Math.random() * 20000);
const STUB_PORT = pick(), DEV_PORT = pick(), INSPECT_PORT = DEV_PORT + 1;

let stub, dev, tmp;
const cleanup = async () => {
  if (dev && dev.exitCode === null) { try { process.kill(-dev.pid, 'SIGTERM'); } catch (e) { /* 已經走了 */ } }
  if (stub) await new Promise(r => stub.close(r));
  if (tmp) await rm(tmp, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  // ── 1. 慢速本機 stub(純 HTTP)────────────────────────────────────────────
  let stubHits = 0;
  stub = createServer((req, res) => {
    stubHits++;
    setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }, DELAY_MS);
  });
  await new Promise((res, rej) => { stub.once('error', rej); stub.listen(STUB_PORT, '127.0.0.1', res); });
  console.log(`[probe] 慢速 stub 在 http://127.0.0.1:${STUB_PORT}(每次延遲 ${DELAY_MS}ms)`);

  // ── 2. 極小探針 Worker(寫進暫存目錄,不碰 repo 設定)──────────────────────
  tmp = await mkdtemp(join(tmpdir(), 'workerd-clock-'));
  await writeFile(join(tmp, 'probe.js'), `export default {
  async fetch(request) {
    if (new URL(request.url).pathname !== '/probe') return new Response('ready');
    const t0 = Date.now();
    const deltas = [];
    for (let i = 0; i < ${N}; i++) {
      await fetch('http://127.0.0.1:${STUB_PORT}/');
      deltas.push(Date.now() - t0);          // 與 laPushAll 迴圈裡的讀法一模一樣
    }
    return Response.json({ deltas });
  }
};
`);
  await writeFile(join(tmp, 'wrangler.json'), JSON.stringify({
    name: 'workerd-clock-probe', main: 'probe.js', compatibility_date: '2026-07-09',
  }));

  // ── 3. 起 wrangler dev(真 workerd)────────────────────────────────────────
  dev = spawn('arch', ['-arm64', 'node', join(REPO, 'node_modules/wrangler/bin/wrangler.js'), 'dev',
    '--config', join(tmp, 'wrangler.json'), '--local-protocol', 'http',
    '--port', String(DEV_PORT), '--inspector-port', String(INSPECT_PORT)],
    { cwd: tmp, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let devLog = '';
  dev.stdout.on('data', d => { devLog += d; });
  dev.stderr.on('data', d => { devLog += d; });

  // 就緒條件＝真的給得出 HTTP 回應(埠在 LISTEN 完全不算就緒,見 wrangler 本機驗證的既有教訓)
  const base = `http://127.0.0.1:${DEV_PORT}`;
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < READY_DEADLINE_MS) {
    if (dev.exitCode !== null) throw new Error(`wrangler dev 提早結束(exit ${dev.exitCode})\n${devLog.slice(-2000)}`);
    try { await fetch(base, { signal: AbortSignal.timeout(5000) }); ready = true; break; } catch (e) { /* 還沒起來 */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`wrangler dev 在 ${READY_DEADLINE_MS / 1000} 秒內沒有回應\n${devLog.slice(-2000)}`);
  console.log(`[probe] wrangler dev 就緒(${base},${Math.round((Date.now() - t0) / 1000)} 秒)`);

  // ── 4. 量測 ──────────────────────────────────────────────────────────────
  const { deltas } = await (await fetch(`${base}/probe`, { signal: AbortSignal.timeout(120_000) })).json();
  const steps = deltas.map((d, i) => d - (i ? deltas[i - 1] : 0));
  const allZero = deltas.every(d => d === 0);
  const monotonic = deltas.every((d, i) => i === 0 || d > deltas[i - 1]);

  console.log(`\n[probe] stub 實際被打 ${stubHits} 次(應為 ${N})`);
  console.log(`[probe] Date.now() - t0 逐次:${JSON.stringify(deltas)}`);
  console.log(`[probe] 每步增量:${JSON.stringify(steps)}`);
  console.log(`[probe] 判定:${allZero
    ? '🔴 時鐘凍住 —— LA_TICK_BUDGET_MS 永遠不會觸發,單 tick 上界的宣稱必須改成「掃完整張候選表」'
    : monotonic
      ? '✅ 每次 await fetch 之後時鐘都往前走(嚴格遞增)—— 牆鐘預算成立,上界宣稱有效'
      : '⚠️ 有推進但非嚴格遞增 —— 預算仍會觸發,但請看逐次數值判斷是否有粗顆粒'}`);
  // 🔴 最終複審 C1-I3:退出碼原本只看 allZero ⇒ 兩種「量到的東西根本不算數」的情況會回 0(綠):
  //   (a) stubHits !== N —— 迴圈沒有真的打滿 N 次(workerd 去重/合併子請求、或 stub 被別人打),
  //       那 deltas 就不是「N 次 await fetch 之後的時鐘」,拿它下結論等於量錯對象;
  //   (b) 非嚴格遞增 —— 時鐘有動但可能是粗顆粒/回跳,「牆鐘預算一定會觸發」這個結論沒被證到。
  // 三者皆成立才算通過;任何一項不成立都回非 0,讓上游(CI/人)必須看一眼結論再決定。
  const pass = !allZero && monotonic && stubHits === N;
  if (!pass) console.log(`[probe] 🔴 退出碼非 0:allZero=${allZero} monotonic=${monotonic} stubHits=${stubHits}/${N}`);
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  console.error('[probe] 失敗:', (e && e.stack) || String(e));
  process.exitCode = 2;
} finally {
  await cleanup();
}
