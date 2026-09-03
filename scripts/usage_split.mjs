// 查「Worker 的請求數裡，App 殼與網頁各佔多少」。
//
// 為什麼需要這支：App 殼的頁面/資料/音樂都在 bundle 內，但 /api/* 一律打正式站
// （app/src/native-bridge.mjs 把 RAIL_API_BASE 設成 https://railisland.tw/），
// 所以兩邊共用同一顆 Worker，Cloudflare 自己的請求計數是一個混合數字、拆不開。
// worker.js 在每筆 /api/* 按 Origin 記一筆到 Analytics Engine（dataset railisland_traffic），
// 這支就是把那份資料讀回來。靜態資產不在裡面——資產直出不喚醒 Worker，也不計費。
//
// 用法：node scripts/usage_split.mjs [--hours=24] [--sql]
// 憑證：優先 CLOUDFLARE_API_TOKEN；沒有就借 wrangler 已登入的 OAuth token（實測可查 AE SQL）。
//       token 過期就跑一次 `npx wrangler whoami` 讓 wrangler 自動換新，再重跑本支。
import { requireTokens, makeClient, parseHours, n, pad, padL } from './lib/cf_analytics.mjs';

const DATASET = 'railisland_traffic';
const args = process.argv.slice(2);
const hours = parseHours(args);
const showSql = args.includes('--sql');
// 憑證探索、帳號 id 與 AE SQL 呼叫都在 scripts/lib/cf_analytics.mjs(2026-09-03 抽出,供 usage_ofm_fallback.mjs 共用)。
const { aeSql } = makeClient(requireTokens());

// _sample_interval 是 AE 的取樣權重，必須加總它才是真實請求數（直接 count() 會低估）
const SQL = `SELECT blob1 AS plat, blob2 AS endpoint, blob3 AS dev, SUM(_sample_interval) AS req
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR
GROUP BY plat, endpoint, dev
ORDER BY req DESC`;

if (showSql) console.log(SQL + '\n');
const rows = await aeSql(SQL);

if (!rows.length) {
  console.log(`過去 ${hours} 小時 ${DATASET} 沒有任何資料。`);
  console.log('若埋點才剛上線，要等正式站部署後才會開始寫入（AE 資料不回溯）。');
  process.exit(0);
}

const byPlat = new Map(), byEp = new Map(), appDev = new Map();
let total = 0;
for (const r of rows) {
  const req = Number(r.req);
  total += req;
  byPlat.set(r.plat, (byPlat.get(r.plat) || 0) + req);
  if (!byEp.has(r.endpoint)) byEp.set(r.endpoint, { app: 0, web: 0 });
  byEp.get(r.endpoint)[r.plat === 'app' ? 'app' : 'web'] += req;
  if (r.plat === 'app') appDev.set(r.dev, (appDev.get(r.dev) || 0) + req);
}

console.log(`\n過去 ${hours} 小時的 Worker 請求（/api/*，來源 ${DATASET}）\n`);
console.log(`  ${pad('來源', 8)}${padL('請求數', 12)}${padL('佔比', 9)}`);
for (const [plat, req] of [...byPlat].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(plat === 'app' ? 'App 殼' : plat === 'web' ? '網頁' : plat, 8)}${padL(n(req), 12)}${padL((req / total * 100).toFixed(1) + '%', 9)}`);
}
console.log(`  ${pad('合計', 8)}${padL(n(total), 12)}`);

console.log(`\n  ${pad('端點', 16)}${padL('App', 10)}${padL('網頁', 12)}${padL('App 佔比', 11)}`);
for (const [ep, v] of [...byEp].sort((a, b) => (b[1].app + b[1].web) - (a[1].app + a[1].web))) {
  const t = v.app + v.web;
  console.log(`  ${pad(ep, 16)}${padL(n(v.app), 10)}${padL(n(v.web), 12)}${padL((v.app / t * 100).toFixed(1) + '%', 11)}`);
}

if (appDev.size) {
  const parts = [...appDev].map(([d, r]) => `${d === 'm' ? '手機 UA' : '桌機 UA'} ${n(r)}`).join('、');
  console.log(`\n  App 內裝置別：${parts}`);
}
console.log('\n  註：靜態資產（HTML／資料檔／音樂）直出不喚醒 Worker、不計費，也不在此表內；');
console.log('      App 的那些檔案本來就在 bundle 裡，資產請求結構上 100% 來自網頁。\n');
