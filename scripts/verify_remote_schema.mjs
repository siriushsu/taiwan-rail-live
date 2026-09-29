#!/usr/bin/env node
// 正式庫 schema 守門人：schema/*.sql 宣告的每張表、每一欄，正式 D1（DELAY_DB＝railisland-delay-history）都要有。
//
// 為什麼要有這支：2026-09-24 00:1x 才發現正式庫從沒套過 0012_la_journey_handoff.sql——
// v0904d（09-04）起 laBind 的 INSERT 每一發都寫 journey_state ⇒ 每次綁定都 no such column ⇒ 503 bind_failed
// ⇒ App 靜默忽略 ⇒ iPhone 跟車卡的伺服器推播近三週全停，沒有任何錯誤訊息。本機驗收（verify_la_backend、
// verify_la_push_loop）自己套齊全部 schema，結構上照不到正式庫漏套；出貨鏈也從來不看正式庫長什麼樣子。
//
// 做法：唯讀查正式庫 sqlite_master 的建表語句（ALTER ADD COLUMN 之後的欄位也會出現在裡面），
// 逐支比對 schema/*.sql 的 CREATE TABLE（表名＋每一欄）與 ALTER TABLE … ADD COLUMN。
// D1 不准 pragma_table_info（SQLITE_AUTH），所以比對的是 DDL 文字裡的欄位名。
//
// 用法：node scripts/verify_remote_schema.mjs            # 查正式庫（要 wrangler 已登入）
//       node scripts/verify_remote_schema.mjs --ddl <檔>  # 讀存下來的 `d1 execute --json` 輸出（離線、給突變測試用）
// exit 0＝全對；1＝正式庫缺東西（訊息列出缺什麼、要套哪一支）；2＝查不到正式庫（驗不了，不准當成通過）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ddlArg = args.includes('--ddl') ? args[args.indexOf('--ddl') + 1] : null;
const stripComments = sql => sql.replace(/--[^\n]*/g, '');

// CREATE TABLE 的欄位：括號配對取整段定義，在最外層逗號切開，排除表層約束。
function createdTables(sql) {
  const out = [];
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 1, i = re.lastIndex, part = '', parts = [];
    for (; i < sql.length && depth > 0; i++) {
      const ch = sql[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) { parts.push(part); part = ''; } else part += ch;
    }
    parts.push(part);
    const cols = parts.map(p => p.trim()).filter(p => p && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(p))
      .map(p => p.split(/\s+/)[0].replace(/["`[\]]/g, ''));
    out.push({ table: m[1], cols });
    re.lastIndex = i;
  }
  return out;
}

function expected() {
  const dir = path.join(root, 'schema');
  const files = fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  const need = [];   // {file, table, col|null}
  for (const f of files) {
    const sql = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const t of createdTables(sql)) {
      need.push({ file: f, table: t.table, col: null });
      for (const c of t.cols) need.push({ file: f, table: t.table, col: c });
    }
    for (const [, table, col] of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi)) need.push({ file: f, table, col });
  }
  return { files, need };
}

const hasCol = (ddlSql, col) => new RegExp(`(^|[\\s(,"\`\\[])${col}([\\s,)"\`\\]]|$)`).test(ddlSql);
function missing(need, ddl) {
  return need.filter(n => !(n.table in ddl) || (n.col && !hasCol(ddl[n.table], n.col)));
}

function parseD1Json(text) {
  const start = text.search(/^\s*[[{]/m);
  if (start < 0) return { error: '輸出裡找不到 JSON' };
  let data;
  try { data = JSON.parse(text.slice(start)); } catch (e) { return { error: `JSON 解析失敗：${e.message}` }; }
  if (!Array.isArray(data) || !data[0]?.results) return { error: `查詢失敗：${JSON.stringify(data).slice(0, 300)}` };
  const ddl = {};
  for (const r of data[0].results) if (r.name) ddl[r.name] = stripComments(r.sql || '');
  return { ddl };
}

const { files, need } = expected();

// 正向對照：同一套比對邏輯，餵「每張表都空白」的假 DDL，必須判出全部都缺。
// 這道沒過代表比對函式本身失明（恆綠），那時任何「正式庫全對」都是零資訊。
const blank = Object.fromEntries([...new Set(need.map(n => n.table))].map(t => [t, 'CREATE TABLE ' + t + ' ()']));
const control = missing(need.filter(n => n.col), blank).length;
if (control !== need.filter(n => n.col).length || need.filter(n => n.col).length === 0) {
  console.error(`❌ 正向對照失敗：空白 DDL 只判出 ${control}/${need.filter(n => n.col).length} 欄缺漏，比對邏輯失明`);
  process.exit(2);
}

let raw;
if (ddlArg) raw = fs.readFileSync(ddlArg, 'utf8');
else {
  const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  // 沒有 wrangler 時 node 只印 MODULE_NOT_FOUND，下面那句「查不到正式庫」會讓人以為要對正式庫補 migration。
  if (!fs.existsSync(wrangler)) {
    console.error(`❌ 找不到 wrangler（${wrangler}）：這棵樹沒有 node_modules，不是正式庫的問題——先 ln -sn <主 repo>/node_modules 接上再跑`);
    process.exit(2);
  }
  const r = spawnSync('arch', ['-arm64', 'node', wrangler, 'd1', 'execute', 'DELAY_DB', '--remote', '--json',
    '--command', "SELECT name, sql FROM sqlite_master WHERE type='table'"], { cwd: root, encoding: 'utf8' });
  raw = r.stdout || '';
  if (r.status !== 0 && !raw.trim()) {
    console.error(`❌ 查不到正式庫（wrangler exit ${r.status}）：${(r.stderr || '').trim().split('\n').slice(-3).join(' / ')}`);
    process.exit(2);
  }
}
const parsed = parseD1Json(raw);
if (parsed.error) { console.error(`❌ 查不到正式庫：${parsed.error}`); process.exit(2); }

const gaps = missing(need, parsed.ddl);
if (gaps.length) {
  console.error(`❌ 正式庫缺 ${gaps.length} 項 schema（程式碼會讀寫它們，缺了就是靜默失敗）：`);
  for (const g of gaps) console.error(`   - ${g.col ? `${g.table}.${g.col}` : `整張表 ${g.table}`}（${g.file}）`);
  const toApply = [...new Set(gaps.map(g => g.file))];
  console.error('   補套（正式庫寫入，要使用者 go）：');
  for (const f of toApply) console.error(`   arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/${f}`);
  process.exit(1);
}
const tables = new Set(need.map(n => n.table)).size;
console.log(`正式庫 schema ✓ ${files.length} 支 migration、${tables} 張表、${need.filter(n => n.col).length} 欄全在（正向對照 ${control} 欄判缺 ✓）`);
