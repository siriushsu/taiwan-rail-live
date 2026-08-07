// /api/basemap-session 的節流與前端退避驗證（2026-08-04 Codex 稽核後收緊）。
//
// 為什麼這條端點要單獨一支判準：它與 /api/basemap-token 的**單價不同**。
//   · basemap-token：抽再多次都是同一個值，拿到一把就夠了，再抽不多花錢。
//   · basemap-session：**每呼叫一次就開一顆計費的 session**。
// 合法客戶端的真實速率是「每 12 小時約 1 顆」（index.html 的 SAT_SESSION_AT / SAT_SESSION_MARGIN），
// 而兩條端點原本共用 60 次/分鐘的 BASEMAP_LIMITER —— 對後者等於開了 86,400 顆/日/IP 的門。
//
// ⚠️ 這支驗的**不是付費牆**。衛星底圖是免費功能（satBtn 全站沒有任何 Plus 閘門），
// session 只是計價模式切換；Plus 管的是 Retina 那一層（satRetinaAllowed()），與這條端點正交。
// 2026-08-04 的外部稽核把兩者看成一件事、建議在這裡加資格閘門——那會 (a) 讓免費重度使用者
// 失去 session 封頂、退回較貴的按張數計價，(b) 完全擋不住它擔心的濫用（basemap-token 依設計
// 必須把 token 送進瀏覽器，拿到的人可以自己偽造 Referer 直接打 Esri）。**不要照那個方向改。**
//
// 判準刻意寫「是什麼／怎麼排」而不是「幾次」：第 2 節比的是兩顆 limiter 的**關係**
// （每次計費的那條必須比冪等取值的那條更緊），不是寫死 5 這個數字。
//
// 跑法：node scripts/verify_basemap_session_limit.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = f => createHash('md5').update(readFileSync(path.join(ROOT, f))).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
for (const f of ['worker.js', 'wrangler.jsonc', 'index.html']) console.log(`[G0] ${f} md5=${md5(f)}`);

const results = [];
const sections = new Map();
const ok = (sec, name, pass, detail = '') => {
  results.push({ name, pass });
  sections.set(sec, (sections.get(sec) || 0) + 1);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const { _rateLimit } = await import('../worker.js');
const { basemapSession } = _rateLimit;

// ── 第 1 節：Worker 端行為 ────────────────────────────────────────────────────
// 手法：換掉 globalThis.fetch 數「上游到底被打了幾次」。被節流時必須是 0——這是本節的核心，
// 因為「回 429」本身不值錢，值錢的是「沒有真的去開一顆計費 session」。
// 每個「必須為 0」都配同一支計數器的正向對照（1b），否則計數器壞掉與真的沒打長得一樣。
const REQ = { headers: { get: () => '203.0.113.7' } };
const limiter = verdict => ({ limit: async () => { if (verdict === 'throw') throw new Error('limiter down'); return { success: verdict }; } });

async function call(env) {
  const realFetch = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = async () => {
    hits++;
    return new Response(JSON.stringify({ sessionToken: 'st', endTime: Date.now() + 3600e3 }), { status: 200 });
  };
  try {
    const res = await basemapSession(REQ, env);
    return { status: res.status, hits, body: await res.json() };
  } finally { globalThis.fetch = realFetch; }
}

const TOKEN = { ESRI_WEB_TOKEN: 'fake-web-token' };

const denied = await call({ ...TOKEN, BASEMAP_SESSION_LIMITER: limiter(false) });
ok(1, '1a 被自己的 limiter 擋下時：回 429，而且**沒有**去開上游 session（擋在計費動作之前，不是擋在回應之後）',
  denied.status === 429 && denied.hits === 0, JSON.stringify(denied));

const allowed = await call({ ...TOKEN, BASEMAP_SESSION_LIMITER: limiter(true) });
ok(1, '1b 正向對照：limiter 放行時回 200 且上游恰好被打 1 次——證明這支計數器真的會動，1a 的 0 不是因為它壞了',
  allowed.status === 200 && allowed.hits === 1, JSON.stringify(allowed));

const fellBack = await call({ ...TOKEN, BASEMAP_LIMITER: limiter(false) });
ok(1, '1c 新 binding 沒部署成功時退回舊的 BASEMAP_LIMITER，**不會變成無限制**（rateLimited 對缺席的 limiter 是放行的，所以這個 fallback 不是裝飾）',
  fellBack.status === 429 && fellBack.hits === 0, JSON.stringify(fellBack));

const threw = await call({ ...TOKEN, BASEMAP_SESSION_LIMITER: limiter('throw') });
ok(1, '1d limiter 自己拋錯時 fail-closed（視同已達上限）——方向刻意：擋下來只是退回按張數計價，放行則是無上限地開計費 session',
  threw.status === 429 && threw.hits === 0, JSON.stringify(threw));

const wrongOne = await call({ ...TOKEN, BASEMAP_SESSION_LIMITER: limiter(false), BASEMAP_LIMITER: limiter(true) });
ok(1, '1e 用的是自己那顆 limiter，不是 basemap-token 共用的那顆（兩顆給相反答案時，必須聽自己這顆的）',
  wrongOne.status === 429 && wrongOne.hits === 0, JSON.stringify(wrongOne));

// ── 第 2 節：設定關係（不寫死數字，比的是兩顆 limiter 的相對緊度）─────────────
const wrangler = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
const bind = name => {
  const m = wrangler.match(new RegExp(`\\{[^{}]*"name"\\s*:\\s*"${name}"[^{}]*\\{[^{}]*\\}[^{}]*\\}`));
  if (!m) return null;
  const lim = m[0].match(/"limit"\s*:\s*(\d+)/), ns = m[0].match(/"namespace_id"\s*:\s*"(\d+)"/);
  return { limit: lim ? Number(lim[1]) : null, ns: ns ? ns[1] : null };
};
const sess = bind('BASEMAP_SESSION_LIMITER'), tok = bind('BASEMAP_LIMITER');
ok(2, '2a wrangler.jsonc 真的宣告了 BASEMAP_SESSION_LIMITER（沒有這個 binding，worker 那邊的收緊等於沒生效）',
  !!(sess && sess.limit && sess.ns), JSON.stringify(sess));
ok(2, '2b 每次呼叫都計費的那條，節流必須**嚴格緊於**冪等取值的那條（比關係不比數字：日後兩邊怎麼調，這個大小關係都必須成立）',
  !!(sess && tok && sess.limit < tok.limit), `session=${sess && sess.limit} token=${tok && tok.limit}`);
const allNs = [...wrangler.matchAll(/"namespace_id"\s*:\s*"(\d+)"/g)].map(m => m[1]);
ok(2, '2c 每個 ratelimit binding 的 namespace_id 互不重複（撞號等於兩條端點共用同一個計數桶，收緊會被另一條的流量吃掉）',
  new Set(allNs).size === allNs.length, allNs.join(','));

// ── 第 3 節：前端退避（真引擎；沒有它，收緊會反噬）──────────────────────────
// 為什麼一定要驗：satTileLoaded() 是「每載入一張衛星圖磚就呼叫一次」，而平移一次就是幾十張。
// 舊版失敗後會在**下一張圖磚**立刻重試 ⇒ 對已經收緊到 5/分鐘的端點連發。在 CGNAT 之類共用 IP 下
// 就變成：被擋的客戶端不斷重試、把自己那個 IP 的額度一直咬住，同 IP 的其他人也永遠拿不到，
// 反而讓「本來該被 session 封頂的重度使用者」全部退回較貴的按張數計價。
const PORT = Number(process.env.PORT || 5471);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 高鐵班表已改走 /api/thsr-schedule(commit 9f05f2f):真實端點只有兩種合法形狀——200 帶完整文件,
  // 或(上游失敗時)404。下面通用的 /api/* 200 `{}` 是這支假伺服器自己造出來、現實中不存在的第三種
  // 形狀——`{}` 是 truthy,index.html 的 fallbackUrl 退路只在 raw 為假值時才啟動,於是 resolveScheduleDay
  // 原樣放行 `{}`、sys.data.trains 變成 undefined,開機時 for...of 直接丟 TypeError。這裡回真實靜態檔
  // 內容,才是這條路徑成功時的忠實模擬。
  if (url.pathname === '/api/thsr-schedule') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
  }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });
const BASE = `http://localhost:${PORT}/`;
const browser = await chromium.launch();

// 三輪 burst，每輪都遠超過 SAT_SESSION_AT。fail=true 時端點恆 429。
async function bursts(fail) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  let hits = 0;
  await page.route('**/api/basemap-session', async route => {
    hits++;
    if (fail) return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate_limited"}' });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionToken: 'st-ok', endTime: Date.now() + 12 * 3600e3 }),
    });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  for (let b = 0; b < 3; b++) {
    await page.evaluate(() => { for (let i = 0; i < 200; i++) satTileLoaded(); });
    await page.waitForTimeout(300);   // 讓那一發 fetch 收尾（成功或失敗都會把 satSessionBusy 放掉）
  }
  const got = await page.evaluate(() => !!(typeof satSession !== 'undefined' && satSession && satSession.t));
  await ctx.close();
  return { hits, got };
}

// 「恰好 1」是**雙向**的判準，這是刻意的：
//   · 大於 1 ⇒ 退避沒生效（每輪都重問，正是收緊之後會反噬的那個行為）；
//   · 等於 0 ⇒ 這條路徑根本沒被驅動到（門檻沒跨過、函式改名、harness 壞了），
//     那樣「請求很少」就是零資訊的假綠。
// 所以這一條自己就同時扮演正向對照，不需要再補一條 `hits >= 1`——那在 `=== 1` 之後恆真。
const failing = await bursts(true);
ok(3, '3a 要不到 session 之後會退避：三輪各 200 次 satTileLoaded()（共 600 次，每輪都跨過門檻）換來的請求數必須**恰好 1**（>1＝沒退避，0＝這條路徑根本沒跑到）',
  failing.hits === 1, JSON.stringify(failing));

const okRun = await bursts(false);
ok(3, '3b 成功時也只問一次，而且真的拿到了 session（satSession 有值）——證明這套 harness 確實驅動得到完整成功路徑，不是全程在空轉',
  okRun.hits === 1 && okRun.got === true, JSON.stringify(okRun));

await browser.close();
server.close();

// 段落覆蓋自檢（整段被刪掉時不會靜靜變綠）
ok(0, '每個宣告過的段落都真的跑過至少一條判準',
  [1, 2, 3].every(s => (sections.get(s) || 0) > 0),
  [1, 2, 3].map(s => `${s}=${sections.get(s) || 0}`).join(' '));

const failed = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - failed.length}/${results.length} PASS ────────`);
if (failed.length) { for (const f of failed) console.log(`FAIL: ${f.name}`); process.exit(1); }
console.log('全部 PASS');
