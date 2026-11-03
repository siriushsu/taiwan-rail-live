#!/usr/bin/env node
// 誤點氣候圖回補：把 TDX 歷史誤點原始檔（一天一個 YYYY-MM-DD.jsonl.gz，內容就是 HIST_DELAY_URL 回的 JSONL）
// 算成 tra_delay_climate 的列，輸出一支 SQL 給 wrangler d1 execute --file 用。
// 算法直接用 worker.js 每日 cron 那一支（_climate.climateDayAgg），回補與日後每天寫的同一套。
// 用法：node scripts/delay_climate_backfill.mjs <原始檔目錄> <輸出.sql>
// 套用：arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=<輸出.sql>
//       （先套 schema/0022_delay_climate.sql；INSERT OR REPLACE，重跑無害）
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [rawDir, outFile] = process.argv.slice(2);
if (!rawDir || !outFile || process.argv.length > 4) {
  console.error('用法：node scripts/delay_climate_backfill.mjs <原始檔目錄> <輸出.sql>');
  process.exit(2);
}
const { _climate, _ingest } = await import('../worker.js');
const net = _climate.climateBuildNet(
  JSON.parse(readFileSync(path.join(ROOT, 'data/tra.json'), 'utf8')),
  JSON.parse(readFileSync(path.join(ROOT, 'data/tra_station_info.json'), 'utf8')));

const files = readdirSync(rawDir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl\.gz$/.test(f)).sort();
const lines = [];
let empty = 0;
for (const f of files) {
  const day = f.slice(0, 10);
  const events = _ingest.parseDayEvents(gunzipSync(readFileSync(path.join(rawDir, f))).toString('utf8'));
  const segs = _climate.climateDayAgg(events, net);
  const n = Object.keys(segs).length;
  if (!n) { empty++; console.log(`${day} 沒算出任何段（事件 ${events.length}），跳過`); continue; }
  lines.push(`INSERT OR REPLACE INTO tra_delay_climate (service_date, segs) VALUES ('${day}', '${JSON.stringify(segs).replace(/'/g, "''")}');`);
  console.log(`${day} 事件 ${events.length}，段 ${n}`);
}
writeFileSync(outFile, lines.join('\n') + '\n');
console.log(`寫出 ${lines.length} 天（跳過 ${empty} 天）→ ${outFile}，${(Buffer.byteLength(lines.join('\n')) / 1e6).toFixed(1)} MB`);
