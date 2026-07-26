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
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATASET = 'railisland_traffic';
const args = process.argv.slice(2);
const hours = Math.max(1, Math.min(24 * 31, parseInt((args.find(a => a.startsWith('--hours=')) || '').split('=')[1], 10) || 24));
const showSql = args.includes('--sql');

function wranglerToken() {
  const files = [
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
  ];
  for (const f of files) {
    try {
      const m = readFileSync(f, 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    } catch (e) { /* 換下一個候選路徑 */ }
  }
  return null;
}

const token = process.env.CLOUDFLARE_API_TOKEN || wranglerToken();
if (!token) {
  console.error('找不到憑證：設 CLOUDFLARE_API_TOKEN，或先 `npx wrangler login`。');
  process.exit(1);
}

async function cf(url, init) {
  const r = await fetch(url, { ...init, headers: { authorization: 'Bearer ' + token, ...(init && init.headers) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init && init.method === 'POST' ? 'AE SQL' : 'API'} ${r.status}: ${text.slice(0, 300)}`);
  return text;
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  // 公開 repo 不寫死帳號 id，用 token 自己問
  const j = JSON.parse(await cf('https://api.cloudflare.com/client/v4/accounts?per_page=50'));
  const list = (j && j.result) || [];
  if (!list.length) throw new Error('這個 token 看不到任何 account');
  if (list.length > 1) console.error(`（有 ${list.length} 個 account，用第一個「${list[0].name}」；要指定請設 CLOUDFLARE_ACCOUNT_ID）`);
  return list[0].id;
}

// _sample_interval 是 AE 的取樣權重，必須加總它才是真實請求數（直接 count() 會低估）
const SQL = `SELECT blob1 AS plat, blob2 AS endpoint, blob3 AS dev, SUM(_sample_interval) AS req
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR
GROUP BY plat, endpoint, dev
ORDER BY req DESC`;

const n = v => Number(v).toLocaleString('en-US');
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - String(s).length));
const padL = (s, w) => ' '.repeat(Math.max(0, w - String(s).length)) + String(s);

const acct = await accountId();
if (showSql) console.log(SQL + '\n');
const rows = JSON.parse(await cf(`https://api.cloudflare.com/client/v4/accounts/${acct}/analytics_engine/sql`, { method: 'POST', body: SQL })).data || [];

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
