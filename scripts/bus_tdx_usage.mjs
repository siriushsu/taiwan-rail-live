#!/usr/bin/env node

// 查公車轉乘功能真正 cache miss 打到 TDX 的次數與 bytes，並依公車 v2 費率估算點數。
// 用法：node scripts/bus_tdx_usage.mjs [--hours=744] [--sql]
// 懑證：優先 CLOUDFLARE_API_TOKEN；沒有就借已登入 wrangler 的 OAuth token。

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATASET = 'railisland_bus_tdx_usage';
const args = process.argv.slice(2);
const hours = Math.max(1, Math.min(24 * 31, parseInt((args.find(arg => arg.startsWith('--hours=')) || '').split('=')[1], 10) || 24 * 31));
const showSql = args.includes('--sql');

function wranglerTokens() {
  const files = [
    path.join(os.homedir(), '.wrangler/config/default.toml'),
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
  ];
  const found = [];
  for (const file of files) {
    try {
      const text = readFileSync(file, 'utf8');
      const token = (text.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1];
      const expires = Date.parse((text.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1] || '') || 0;
      if (token) found.push({ token, expires });
    } catch (error) { /* 換下一個候選路徑 */ }
  }
  return found.sort((a, b) => b.expires - a.expires).map(row => row.token);
}

const tokens = process.env.CLOUDFLARE_API_TOKEN ? [process.env.CLOUDFLARE_API_TOKEN] : wranglerTokens();
if (!tokens.length) {
  console.error('找不到懑證：設 CLOUDFLARE_API_TOKEN，或先跑 `npx wrangler login`。');
  process.exit(1);
}

async function cloudflare(url, init) {
  for (let i = 0; i < tokens.length; i++) {
    const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${tokens[i]}`, ...(init && init.headers) } });
    const text = await response.text();
    if (response.ok) return text;
    if ((response.status === 401 || response.status === 403) && i < tokens.length - 1) continue;
    throw new Error(`Cloudflare API ${response.status}: ${text.slice(0, 300)}`);
  }
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const body = JSON.parse(await cloudflare('https://api.cloudflare.com/client/v4/accounts?per_page=50'));
  const accounts = body && body.result || [];
  if (!accounts.length) throw new Error('這個 token 看不到任何 Cloudflare account');
  return accounts[0].id;
}

const sql = `SELECT blob1 AS kind, blob2 AS scope, blob3 AS status,
  SUM(_sample_interval) AS calls,
  SUM(double2 * _sample_interval) AS bytes,
  SUM(double3 * _sample_interval) AS decoded_bytes
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR
GROUP BY kind, scope, status
ORDER BY calls DESC`;

const account = await accountId();
if (showSql) console.log(`${sql}\n`);
const response = JSON.parse(await cloudflare(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, { method: 'POST', body: sql }));
const rows = response.data || [];
if (!rows.length) {
  console.log(`過去 ${hours} 小時 ${DATASET} 沒有資料；公車轉乘 API 尚未部署或沒有人查詢時是預期結果。`);
  process.exit(0);
}

const total = rows.reduce((sum, row) => ({
  calls: sum.calls + Number(row.calls || 0),
  bytes: sum.bytes + Number(row.bytes || 0),
}), { calls: 0, bytes: 0 });
const pointCalls = total.calls / 1_500;
const pointBytes = total.bytes / 150_000_000;
const number = value => Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const points = value => Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

console.log(`\n過去 ${hours} 小時公車轉乘 TDX 增量用量\n`);
for (const row of rows) {
  console.log(`  ${row.kind} ${row.scope} HTTP ${row.status}: ${number(row.calls)} 次，${points(Number(row.bytes) / 1_000_000)} MB`);
}
console.log(`\n  合計 ${number(total.calls)} 次，${points(total.bytes / 1_000_000)} MB`);
console.log(`  計次 ${points(pointCalls)} 點＋計量 ${points(pointBytes)} 點＝估計 ${points(pointCalls + pointBytes)} 點`);
console.log('  呼叫語意：N1＝打開一站的到站預估；A1＋A2＝展開一路的車輛位置／站序；S2＝明確選定接續公車後取得一次完整下車站序（同一路線快取 6 小時）。');
console.log('  註：這是功能自己記錄的增量估算；當月實際扣點仍以 TDX 會員中心為準。\n');
