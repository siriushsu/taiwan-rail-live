// 驗「/api/* 流量來源埋點真的把 App 殼與網頁分開，而且分類依據站得住腳」（2026-07-26）。
//
// 為什麼判準是 blob 內容而不是「有沒有記到一筆」：埋點的價值全在分類正確——App 殼與網頁打的是
// 同一顆 Worker、同一批端點，唯一可靠的差別是 Origin（App 是 capacitor://localhost 或
// https://localhost 的跨來源請求，瀏覽器必帶 Origin；網頁同源 GET 不帶）。所以每一條都要斷言
// 「這個請求被記成哪一邊」，而不只是數筆數。
//
// 另外兩件事一起驗：
//   1. 端點白名單（worker.js 的 API_ENDPOINTS）與路由的 if 鏈不能漂移——白名單漏一個，那個端點的
//      流量就會全部記成 'other'，統計無聲失真。這裡直接從 worker.js 原始碼撈出路由認得的端點逐一過。
//   2. 觀測絕不可影響服務：writeDataPoint 丟例外、或 binding 根本不存在時，回應都要照常。
//
// 用法：node scripts/verify_usage_split.mjs
import { readFileSync } from 'node:fs';
import worker, { _alertLog } from '../worker.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}`); };

// ── 替身 ────────────────────────────────────────────────────────────────────
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async () => new Response('{}', { status: 500 });   // 一律不打真上游

let points = [];
const ASSET_STATUS = 599;                                            // 落到 env.ASSETS = 沒被路由認出來
const ENV = (over = {}) => ({
  TRAFFIC: { writeDataPoint: p => points.push(p) },
  ASSETS: { fetch: async () => new Response('asset', { status: ASSET_STATUS }) },
  TDX_CLIENT_ID: 'x', TDX_CLIENT_SECRET: 'y',
  FIREBASE_WEB_API_KEY: 'k', REVENUECAT_PROJECT_ID: 'p', REVENUECAT_V2_SECRET_KEY: 's',
  ...over,
});

// 送一發請求，回傳 { status, pt }（pt = 這一發寫下的埋點，沒有就 null）。
// 端點內部炸掉不算失敗:埋點在路由之前，這裡只在意「記成什麼」與「回應有沒有被拖累」。
async function hit(pathname, { origin, ua, method = 'GET', env = ENV() } = {}) {
  points = [];
  const headers = {};
  if (origin) headers.Origin = origin;
  if (ua) headers['user-agent'] = ua;
  let status;
  try {
    const res = await worker.fetch(new Request('https://railisland.tw' + pathname, { method, headers }), env);
    status = res.status;
  } catch (e) { status = 'throw:' + (e && e.message); }
  return { status, pt: points[0] || null, count: points.length };
}
const blobs = pt => (pt && pt.blobs) || [];

const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';

// ── 1. 來源分類 ─────────────────────────────────────────────────────────────
console.log('\n===== 來源分類（App 殼 vs 網頁）=====');
let r = await hit('/api/tra-alert', { origin: 'capacitor://localhost', ua: APP_UA });
check(blobs(r.pt)[0] === 'app', `capacitor://localhost → app（實際 ${blobs(r.pt)[0]}）`);
r = await hit('/api/tra-alert', { origin: 'https://localhost', ua: APP_UA });
check(blobs(r.pt)[0] === 'app', `https://localhost（Android/舊殼 origin）→ app（實際 ${blobs(r.pt)[0]}）`);
r = await hit('/api/tra-alert', { ua: MAC_UA });
check(blobs(r.pt)[0] === 'web', `無 Origin（網頁同源 GET）→ web（實際 ${blobs(r.pt)[0]}）`);
r = await hit('/api/tra-alert', { origin: 'https://railisland.tw', ua: MAC_UA });
check(blobs(r.pt)[0] === 'web', `Origin 是自家網域 → web（實際 ${blobs(r.pt)[0]}）`);
r = await hit('/api/tra-alert', { origin: 'https://evil.example', ua: MAC_UA });
check(blobs(r.pt)[0] === 'web', `不認識的 Origin → web，不會被算成 App（實際 ${blobs(r.pt)[0]}）`);

// ── 2. 裝置別與筆數 ─────────────────────────────────────────────────────────
console.log('\n===== 裝置別與筆數 =====');
r = await hit('/api/tra-alert', { origin: 'capacitor://localhost', ua: APP_UA });
check(blobs(r.pt)[2] === 'm', `iPhone 殼 UA → m（實際 ${blobs(r.pt)[2]}）`);
check(r.count === 1, `一個請求只記一筆（實際 ${r.count}）`);
r = await hit('/api/tra-alert', { ua: MAC_UA });
check(blobs(r.pt)[2] === 'd', `桌機 UA → d（實際 ${blobs(r.pt)[2]}）`);
r = await hit('/api/tra-alert', {});
check(blobs(r.pt)[2] === 'd', `完全沒有 UA → d（實際 ${blobs(r.pt)[2]}）`);
r = await hit('/api/delay-history?train=1234', { origin: 'capacitor://localhost', method: 'OPTIONS', ua: APP_UA });
check(r.status === 204 && blobs(r.pt)[0] === 'app', `App 的 CORS preflight 也算一筆 app（狀態 ${r.status}、來源 ${blobs(r.pt)[0]}）`);

// ── 3. 端點白名單 vs 路由，不准漂移 ─────────────────────────────────────────
console.log('\n===== 端點白名單 vs 路由 =====');
const src = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const routed = [...new Set([...src.matchAll(/url\.pathname === '\/api\/([a-z-]+)'/g)].map(m => m[1]))];
check(routed.length >= 12, `從 worker.js 撈到 ${routed.length} 個路由端點（<12 就是這支的抓法失效了，先修抓法）`);
for (const ep of routed) {
  const q = ep === 'metro-live' ? '?sys=tymc' : ep === 'ntmetro-live' ? '?sys=ntdx' : ep === 'delay-history' ? '?train=1234' : '';
  const res = await hit('/api/' + ep + q, { ua: MAC_UA });
  const got = blobs(res.pt)[1];
  check(got === ep, `/api/${ep} 記成「${got}」`);
  check(res.status !== ASSET_STATUS, `/api/${ep} 真的被路由接走，不是掉到靜態資產（狀態 ${res.status}）`);
}
r = await hit('/api/tra-live?cam=follow&z=12', { ua: MAC_UA });
check(blobs(r.pt)[1] === 'tra-live', `帶 query string 不影響端點名（實際 ${blobs(r.pt)[1]}）`);
r = await hit('/api/zzz-not-a-real-endpoint', { ua: MAC_UA });
check(blobs(r.pt)[1] === 'other' && r.status === ASSET_STATUS,
  `未知 /api 路徑記成 other（實際 ${blobs(r.pt)[1]}）——blob 基數不會被亂打的路徑炸開`);

// ── 4. 資產請求不記 ─────────────────────────────────────────────────────────
console.log('\n===== 只記 /api/*，資產不記 =====');
for (const p of ['/', '/index.html', '/data/tra.json', '/status.html']) {
  const res = await hit(p, { ua: MAC_UA });
  check(res.count === 0, `${p} 一筆都不記（實際 ${res.count}）——資產直出不喚醒 Worker，記了只是虛增`);
}

// ── 5. 觀測不可影響服務 ─────────────────────────────────────────────────────
console.log('\n===== fail-safe：觀測壞掉不能拖累 API =====');
const good = await hit('/api/tra-alert', { ua: MAC_UA });
r = await hit('/api/tra-alert', { ua: MAC_UA, env: ENV({ TRAFFIC: { writeDataPoint: () => { throw new Error('AE down'); } } }) });
check(r.status === good.status, `writeDataPoint 丟例外 → 回應照常（${r.status} vs 正常 ${good.status}）`);
r = await hit('/api/tra-alert', { ua: MAC_UA, env: ENV({ TRAFFIC: undefined }) });
check(r.status === good.status && r.count === 0, `binding 不存在（本機 dev_server）→ 回應照常、不炸（${r.status}）`);

// ── 6. cron 自身流量不誤記(2026-07-27 審查 Important 5 / 修復輪 2 M11 補牙)───────────
// verify_alert_log.mjs 的 G 段只測 trafficTag() 這個純函式本身回傳 null——那條測不到
// fetch() 是否真的把回傳值接上了 TRAFFIC 埋點的 if(tag) 守門。拿掉那行 if 判斷,G 段
// 依然全綠,只有這裡（真的呼叫 worker.fetch()）會炸,這正是這一輪要補的牙。
console.log('\n===== cron 自身流量不誤記 =====');
r = await hit('/api/tra-alert', { ua: _alertLog.ALERT_LOG_CRON_UA });
check(r.count === 0, `cron 專屬 UA 打 /api/* 一筆都不記（實際 ${r.count}）——不然埋點的 if(tag) 守門就是裝飾`);
r = await hit('/api/tra-alert', { ua: MAC_UA });
check(r.count === 1, `對照組:一般 UA 正常記 1 筆（實際 ${r.count}）`);

console.log(`\n${fails ? `❌ ${fails} 項未過` : '✅ 全部通過'}\n`);
process.exit(fails ? 1 : 0);
