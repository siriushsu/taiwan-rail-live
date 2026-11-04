#!/usr/bin/env node
// 誤點重播回補：把 TDX 歷史誤點原始檔（一天一個 YYYY-MM-DD.jsonl.gz，內容就是 HIST_DELAY_URL 回的 JSONL）
// 算成 tra_delay_replay 的列。算法跟每日 cron 同一支（scripts/delay_replay.mjs）。
// 一列約 60 KB，寫成 SQL 字面值會超過 D1 單句 100 KB；`d1 execute --file` 走匯入，匯入時整個資料庫不能服務。
// 所以 --apply 逐天打 D1 REST、用參數帶 hex，只補正式庫還沒有的日子，重跑無害。
// 用法：node scripts/delay_replay_backfill.mjs <原始檔目錄> <輸出目錄>   # 只算，寫 <輸出目錄>/<日期>.json.gz
//       node scripts/delay_replay_backfill.mjs --apply <輸出目錄>       # 寫正式庫（要 wrangler 已登入、先套 schema/0023_delay_replay.sql）
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayBuildNet, replayDay } from './delay_replay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args[0] === '--apply';
if (args.length !== 2) {
  console.error('用法：node scripts/delay_replay_backfill.mjs <原始檔目錄> <輸出目錄>\n      node scripts/delay_replay_backfill.mjs --apply <輸出目錄>');
  process.exit(2);
}

async function build(rawDir, outDir) {
  const { _ingest } = await import('../worker.js');
  const net = replayBuildNet(
    JSON.parse(readFileSync(path.join(ROOT, 'data/tra.json'), 'utf8')),
    JSON.parse(readFileSync(path.join(ROOT, 'data/tra_station_info.json'), 'utf8')));
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(rawDir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl\.gz$/.test(f)).sort();
  let bytes = 0, max = 0;
  for (const f of files) {
    const day = f.slice(0, 10);
    const events = _ingest.parseDayEvents(gunzipSync(readFileSync(path.join(rawDir, f))).toString('utf8'));
    const gz = gzipSync(JSON.stringify(replayDay(day, events, net)), { level: 9 });
    writeFileSync(path.join(outDir, day + '.json.gz'), gz);
    bytes += gz.length; max = Math.max(max, gz.length);
  }
  console.log(`算完 ${files.length} 天，共 ${(bytes / 1e6).toFixed(1)} MB，最大一天 ${(max / 1e3).toFixed(0)} KB → ${outDir}`);
}

async function push(outDir) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('wrangler auth token 失敗：' + r.stderr);
  const { token } = JSON.parse(r.stdout);
  const cfg = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  const dbId = /"binding":\s*"DELAY_DB"[^}]*"database_id":\s*"([\w-]+)"/.exec(cfg)[1];
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const api = async (p, body) => {
    for (let i = 0; ; i++) {
      const res = await fetch('https://api.cloudflare.com/client/v4' + p, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.success) return j.result;
      if (i >= 2) throw new Error(`${p} ${res.status} ${JSON.stringify(j && j.errors)}`);
      await new Promise(ok => setTimeout(ok, 3000));
    }
  };
  const accounts = await api('/accounts');
  if (accounts.length !== 1) throw new Error('帳號不只一個，不知道要寫哪個');
  const query = (sql, params) => api(`/accounts/${accounts[0].id}/d1/database/${dbId}/query`, { sql, params });
  const have = new Set((await query('SELECT service_date FROM tra_delay_replay'))[0].results.map(x => x.service_date));
  const days = readdirSync(outDir).filter(f => f.endsWith('.json.gz')).map(f => f.slice(0, 10)).sort().filter(d => !have.has(d));
  console.log(`正式庫已有 ${have.size} 天，要寫 ${days.length} 天`);
  for (const [i, day] of days.entries()) {
    await query('INSERT OR REPLACE INTO tra_delay_replay (service_date, gz) VALUES (?, unhex(?))', [day, readFileSync(path.join(outDir, day + '.json.gz')).toString('hex')]);
    if ((i + 1) % 50 === 0) console.log(`${day} 寫到第 ${i + 1} 天`);
  }
  const [{ results: [c] }] = await query('SELECT COUNT(*) AS n, SUM(LENGTH(gz)) AS b FROM tra_delay_replay');
  console.log(`完成：正式庫 ${c.n} 天，${(c.b / 1e6).toFixed(1)} MB`);
}

await (apply ? push(args[1]) : build(args[0], args[1]));
