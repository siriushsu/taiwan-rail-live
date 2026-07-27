// D1 形狀的 node:sqlite 轉接器——懸賞後端所有離線測試的底座。
//
// 為什麼不是 wrangler dev / miniflare：這台機器的 node_modules/workerd 裝成了別的平台的二進位，
// `wrangler d1 execute --local` 與 `wrangler dev` 都直接爆掉（見計畫 B 的〈這個環境的兩個已知事實〉）。
// node:sqlite 是 Node 22+ 內建，零依賴、真的跑 SQL，實測支援 WITHOUT ROWID、ON CONFLICT upsert、
// 視窗函式——本 repo 用到的 D1 特性都涵蓋。
//
// 只實作 worker.js 真正用到的 D1 表面：prepare().bind().all()/first()/run()、batch()、exec()。
// 沒用到的（dump、withSession）刻意不實作：假裝支援反而會讓測試在錯誤的地方通過。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));       // CJS/tsx 環境不用 import.meta.dirname
const SCHEMA_DIR = join(HERE, '..', 'schema');

// D1 只吃固定的型別對照表：null／Number／String／Boolean／ArrayBuffer，undefined 不在其中。
// boolean→0/1 是 D1 文件明列的既定行為，這裡照做，node:sqlite 收到 boolean 會直接丟例外所以必須轉。
// undefined 則刻意比照 D1 的嚴格：拋錯，不要靜默轉成 null——「忘記給值」這種呼叫端 bug 若被吞成
// null，會在本機全綠、只在正式站才炸（真 D1 對 undefined 丟 D1_TYPE_ERROR）。
// 誠實揭露：這台機器的 wrangler/workerd 壞掉（見檔頭），「D1 真的對 undefined 丟 D1_TYPE_ERROR」
// 這件事本身沒有在本機被獨立驗證過，是採信 Cloudflare D1 型別對照表文件的推論，不是實測結果；
// 選擇拋錯而不是靜默轉換，是因為兩種可能後果不對稱——比真 D1 嚴格的代價是本機提早報錯，
// 比真 D1 寬鬆的代價是本機全綠、正式站才炸，前者便宜很多。
function coerce(v) {
  if (v === undefined) {
    throw new TypeError('d1_local: bind() 收到 undefined——D1 沒有這個型別，呼叫端請顯式傳 null');
  }
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class D1Stmt {
  constructor(db, sql, params) { this._db = db; this._sql = sql; this._p = params || []; }
  bind(...p) { return new D1Stmt(this._db, this._sql, p.map(coerce)); }
  async all() { return { success: true, results: this._db.prepare(this._sql).all(...this._p) }; }
  async first(col) {
    const row = this._db.prepare(this._sql).get(...this._p);
    if (row === undefined || row === null) return null;    // D1 查無列回 null，不是 undefined
    return col === undefined ? row : (row[col] === undefined ? null : row[col]);
  }
  async run() {
    const r = this._db.prepare(this._sql).run(...this._p);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

function wrap(db) {
  return {
    prepare: sql => new D1Stmt(db, sql, []),
    // D1 的 batch 是單一交易；照做，否則「寫一半失敗」的行為會與正式環境不同
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

// 依檔名排序套用 schema/*.sql。排序是刻意的：0001 先於 0002，日後新增 0003 自動接在後面。
export function applySchemaFiles(db) {
  for (const f of readdirSync(SCHEMA_DIR).filter(n => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
  }
}

// extraSql：測試想額外塞的種子資料。回傳 db（原生，測試自己查用）與 DELAY_DB（D1 形狀，塞進 env 用）。
export function openTestDb(extraSql) {
  const db = new DatabaseSync(':memory:');
  applySchemaFiles(db);
  if (extraSql) db.exec(extraSql);
  return { db, DELAY_DB: wrap(db) };
}
