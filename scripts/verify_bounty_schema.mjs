// 懸賞 D1 schema 驗收：把 schema/*.sql 真的套到一顆 node:sqlite 記憶體庫上，
// 斷言表、欄位、主鍵、NOT NULL 約束、索引都在，且重複套用不會炸（cron 與新環境都會重跑同一份檔）。
// 跑法：node scripts/verify_bounty_schema.mjs
// 註：node:sqlite 會印一行 ExperimentalWarning，那是正常輸出。
import { openTestDb, applySchemaFiles } from './d1_local.mjs';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };

const { db } = openTestDb();

// A1 四張懸賞表都建起來了
{
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  const want = ['bounty_board', 'bounty_claims', 'bounty_points', 'bounty_samples'];
  ok('A1 懸賞四張表都在', want.every(t => names.includes(t)), names.join(','));
  // 既有三張表也要在——驗證閘的第二重要查 tra_station_events，測試環境沒有它就等於沒驗到
  ok('A2 既有三張表也重建了',
    ['tra_delay_daily', 'tra_station_events', 'kv_blobs'].every(t => names.includes(t)), names.join(','));
}

// A3 欄位逐一比對（判準是規格的欄位表 + 本計畫載明的兩處偏離，寫死在測試裡，不從 schema 檔反推）
{
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name).sort();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b.slice().sort());
  ok('A3 bounty_board 欄位', eq(cols('bounty_board'), [
    'seg_key', 'sys', 'train_kind', 'dir', 'kind', 'slot', 'l1', 'l2', 'points', 'per_day',
    'first_listed_at', 'first_claimable_at', 'l2_capped_at', 'sample_count', 'covered_at', 'unlocked_offer',
    'distinct_ok_users',       // 0014（路段懸賞 v2）：每段去重貢獻人數
  ]), cols('bounty_board').join(','));
  ok('A4 bounty_claims 欄位', eq(cols('bounty_claims'), [
    'id', 'actor', 'seg_key', 'train_kind', 'dir', 'kind', 'slot', 'points_locked', 'claimed_at', 'expires_at', 'status',
  ]), cols('bounty_claims').join(','));
  ok('A5 bounty_samples 欄位', eq(cols('bounty_samples'), [
    'id', 'actor', 'sys', 'ln_id', 'train_no', 'dir', 'trip_date', 'payload', 'segs',
    'submitted_at', 'verdict', 'verdict_at', 'quality_code', 'reject_code',
    'client',                 // 0014（路段懸賞 v2）：上傳當下的 {platform,app,simulator} JSON 字串
  ]), cols('bounty_samples').join(','));
  ok('A6 bounty_points 欄位', eq(cols('bounty_points'), ['actor', 'uid', 'points', 'merged_into', 'updated_at']),
    cols('bounty_points').join(','));
}

// A7 主鍵是五欄複合（同一段同車種同方向的 track 與 dwell 不可互相覆蓋）
{
  const pk = db.prepare('PRAGMA table_info(bounty_board)').all().filter(r => r.pk > 0)
    .sort((a, b) => a.pk - b.pk).map(r => r.name);
  ok('A7 bounty_board 主鍵五欄且順序正確',
    JSON.stringify(pk) === JSON.stringify(['seg_key', 'train_kind', 'dir', 'kind', 'slot']), pk.join(','));
}

// A8 重複套用不炸（IF NOT EXISTS）——cron 與新環境都會重跑同一份檔
{
  let threw = '';
  try { applySchemaFiles(db); } catch (e) { threw = String(e.message || e); }
  ok('A8 schema 可重複套用', threw === '', threw);
}

// 【原 A9 已移除】原本斷言「dwell 鍵 A==B、track 鍵 A!=B」的 parse() 是測試檔案內當場定義、
// 當場斷言的閉包，不碰 schema 也不碰任何產品程式碼，除非有人手動改壞這條測試本身否則不可能 FAIL——
// 是恆真斷言（複審 Minor 2 指出）。這個鍵約定目前唯一的消費者是「人」（寫 SQL/寫測試時要遵守的約定），
// 還沒有解析它的產品程式碼可測；等後面 task 寫出真的 parse seg_key 的函式，再對那個函式寫這條斷言。

// A9（原 A10）D1 轉接器的形狀與真 D1 一致（後面每個 task 都靠它，形狀錯會讓所有測試一起說謊）
{
  const { DELAY_DB } = openTestDb();
  await DELAY_DB.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,?,?,?)')
    .bind('dev-1', null, 7, null, 1700000000000).run();
  const one = await DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind('dev-1').first();
  const col = await DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind('dev-1').first('points');
  const many = await DELAY_DB.prepare('SELECT actor FROM bounty_points').all();
  const none = await DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind('nope').first();
  ok('A9 轉接器 first/first(col)/all/空值語意與 D1 一致',
    one && one.points === 7 && col === 7 && Array.isArray(many.results) && many.results.length === 1 && none === null,
    JSON.stringify({ one, col, n: many.results && many.results.length, none }));
}

// A10 bounty_claims.id 與 bounty_samples.id 皆為 NOT NULL（複審 Critical 1）——SQLite 的 rowid 表
// 對 TEXT PRIMARY KEY 不隱含 NOT NULL（WITHOUT ROWID 表才隱含），這兩張表不是 WITHOUT ROWID，
// 沒寫死 NOT NULL 就能存進多筆 id=NULL 的列：驗證 cron 的 UPDATE ... WHERE id=? 永遠打不到它們，
// 樣本/認領永遠卡在 pending、無法定址、零錯誤訊息。
{
  const notNull = (t, c) => {
    const row = db.prepare(`PRAGMA table_info(${t})`).all().find(r => r.name === c);
    return !!row && row.notnull === 1;
  };
  ok('A10 bounty_claims.id、bounty_samples.id 皆為 NOT NULL',
    notNull('bounty_claims', 'id') && notNull('bounty_samples', 'id'),
    `claims.id notnull=${notNull('bounty_claims', 'id')} samples.id notnull=${notNull('bounty_samples', 'id')}`);
}

// A11 索引存在性（複審 Important 3）——索引是唯一「遺失後完全無聲」的 schema 元素：表或欄位掉了
// 會直接拋錯，索引掉了查詢照樣回對的結果只是變慢，沒有任何下游測試會變紅，所以要專門斷言存在。
// idx_claims_expiry 是複審 Minor 3 新增：claims 的 24 小時過期掃描 WHERE status='open' AND
// expires_at<? 原本兩個索引（一個押 seg_key 起頭、一個押 actor 起頭）都服務不了，只能全表掃。
{
  const idxNames = db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all().map(r => r.name);
  const want = [
    'idx_board_open', 'idx_claims_actor', 'idx_claims_expiry', 'idx_claims_unit',
    'idx_samples_pending', 'idx_samples_trip',
    'idx_chip_ledger_actor_day',   // 0014：每日籌碼上限與餘額查詢都以 actor 起頭
    'idx_seg_contrib_actor',       // 0014：合併與刪帳號都以 actor 找 bounty_seg_contrib 的列（PK 的 actor 在第二欄）
    'idx_seg_contrib_first',       // 0014：bounty-me 的首位校正者，每段讀 first_ok_at 最早的一列
  ];
  ok('A11 九個索引都在', want.every(n => idxNames.includes(n)), idxNames.join(','));
  // 名字在不夠：索引建在錯的表或錯的欄，查詢照樣回對的結果只是不走索引。直接讀索引的定義。
  const info = db.prepare("SELECT m.tbl_name AS t, ii.name AS c FROM sqlite_master m, pragma_index_info(m.name) ii WHERE m.type='index' AND m.name='idx_seg_contrib_actor'").all()
    .map(r => `${r.t}.${r.c}`);
  ok('A11b idx_seg_contrib_actor 建在 bounty_seg_contrib 的 actor 欄（且只有這一欄）', JSON.stringify(info) === '["bounty_seg_contrib.actor"]', JSON.stringify(info));
  // 欄位順序就是用途：seg_key 等號、first_ok_at 排序、actor 同時刻的次序——順序錯了每段又要讀遍所有貢獻者再排序。
  const first = db.prepare("SELECT m.tbl_name AS t, ii.name AS c FROM sqlite_master m, pragma_index_info(m.name) ii WHERE m.type='index' AND m.name='idx_seg_contrib_first' ORDER BY ii.seqno").all()
    .map(r => `${r.t}.${r.c}`);
  ok('A11c idx_seg_contrib_first 建在 bounty_seg_contrib 的 (seg_key, first_ok_at, actor)，順序照這樣',
    JSON.stringify(first) === '["bounty_seg_contrib.seg_key","bounty_seg_contrib.first_ok_at","bounty_seg_contrib.actor"]', JSON.stringify(first));
}

// A12 0001 重建表接得住 worker.js「現在」的真實查詢語句（複審 Important 1）——A1/A2 只驗表名存在，
// 這個洞永遠是綠的：從 worker.js 的查詢語句反推，卻沒有拿真的查詢語句回頭驗過反推的結果，
// tra_delay_daily 漏了 events/last_station/last_seen、kv_blobs 漏了 updated，6 條真實語句 4 條打不動。
// 逐句照抄 worker.js 原文（不是重新描述），連著來源行號釘住，以後語句改了這裡才追得到飄移；
// 行號抄的時候各自獨立核對過一次（跑 `grep -n` 對照，不是照搬複審報告裡的行號）。
{
  const { db: db2 } = openTestDb();
  const real = [
    ["INSERT INTO tra_station_events (service_date,train_no,sta,status,delay,delay_max,obs_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(service_date,train_no,sta,status) DO UPDATE SET delay_max = excluded.delay_max WHERE excluded.delay_max > tra_station_events.delay_max",
      ['2026-07-28', '152', '1000', 'ARRIVED', 5, 5, '2026-07-28T10:00:00+08:00'], 'worker.js:83 STATION_EVENT_UPSERT'],
    ["SELECT v FROM kv_blobs WHERE k='tra_delay_stats_30d'", [], 'worker.js:440 delayStats'],
    ['SELECT MAX(service_date) AS m FROM tra_delay_daily', [], 'worker.js:553 delayHistory'],
    ['SELECT service_date, final_delay, max_delay FROM tra_delay_daily WHERE train_no=? AND service_date>=? AND service_date<=? ORDER BY service_date ASC',
      ['152', '2026-01-01', '2026-12-31'], 'worker.js:557-558 delayHistory'],
    ['UPDATE tra_delay_daily SET final_delay=?, max_delay=?, events=?, last_station=?, last_seen=? WHERE service_date=? AND train_no=?',
      [3, 5, 2, '1000', '2026-07-27T23:50:00+08:00', '2026-07-27', '152'], 'worker.js:911 writeDayRows'],
    ['INSERT OR REPLACE INTO tra_delay_daily (service_date, train_no, final_delay, max_delay, events, last_station, last_seen) VALUES (?,?,?,?,?,?,?)',
      ['2026-07-28', '152', 3, 5, 2, '1000', '2026-07-28T10:05:00+08:00'], 'worker.js:912 writeDayRows'],
    ['SELECT DISTINCT service_date FROM tra_delay_daily WHERE service_date >= ?', ['2026-01-01'], 'worker.js:928 ingestDelayHistory'],
    ['SELECT train_no, final_delay, max_delay, events, last_station, last_seen FROM tra_delay_daily WHERE service_date = ?',
      ['2026-07-28'], 'worker.js:944 ingestDelayHistory'],
    ['SELECT v FROM kv_blobs WHERE k=?', ['tra_delay_stats_30d'], 'worker.js:958 ingestDelayHistory'],
    ['SELECT service_date, train_no, final_delay, max_delay FROM tra_delay_daily WHERE service_date >= ?',
      ['2026-01-01'], 'worker.js:965 ingestDelayHistory'],
    ["INSERT OR REPLACE INTO kv_blobs(k,v,updated) VALUES(?,?,datetime('now'))", ['tra_delay_stats_30d', '{}'], 'worker.js:968 ingestDelayHistory'],
  ];
  const failed = [];
  for (const [sql, params, src] of real) {
    try {
      const stmt = db2.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql)) stmt.all(...params); else stmt.run(...params);
    } catch (e) { failed.push(`${src} — ${e.message}`); }
  }
  ok('A12 0001 重建表接得住 worker.js 現在的真實查詢語句（11 句）', failed.length === 0, failed.join(' | '));
}

// A13 d1_local.mjs 的 coerce() 對 undefined 拋錯、不靜默轉成 null（複審 Important 2 (a)）——
// D1 的型別對照表沒有 undefined，真的 D1 用戶端對它丟 D1_TYPE_ERROR；轉接器若靜默吞成 null，
// 「忘記給值」這種呼叫端 bug 會本機全綠、只在正式站才炸，而且與 A10 的 NOT NULL 復合更危險
// （undefined→null→多筆 NULL 主鍵，全程無錯誤訊息）。null 本身仍是合法值，不受影響（A9 已驗證）。
{
  const { DELAY_DB: DB2 } = openTestDb();
  let threw = false, msg = '';
  try {
    await DB2.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,?,?,?)')
      .bind('dev-x', undefined, 1, null, 1700000000000).run();
  } catch (e) { threw = true; msg = String(e.message || e); }
  ok('A13 coerce() 對 undefined 拋錯', threw === true, msg);
}

// ── 0014 路段懸賞 v2：去重貢獻、籌碼帳本、車庫解鎖、雲端搭乘 ──────────────────────
// 期望值寫死在測試裡（來源：主對話派工單的欄位表），不從 schema 檔反推。
const NEW_TABLES = ['bounty_seg_contrib', 'chip_ledger', 'garage_unlocks', 'cloud_rides'];
const colsOf = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name).sort();
const pkOf = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().filter(r => r.pk > 0)
  .sort((a, b) => a.pk - b.pk).map(r => r.name);
const sameSet = (a, b) => JSON.stringify(a) === JSON.stringify(b.slice().sort());
// 丟例外就回訊息字串，沒丟回 ''——CHECK／UNIQUE／NOT NULL 都靠「插入時被擋」來證明，不是靠讀 DDL 文字
const tryRun = (d, sql, ...p) => { try { d.prepare(sql).run(...p); return ''; } catch (e) { return String(e.message || e); } };

// A14 四張新表都建起來了
{
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  ok('A14 0014 四張新表都在', NEW_TABLES.every(t => names.includes(t)), names.join(','));
}

// A15 欄位逐一比對
{
  ok('A15a bounty_seg_contrib 欄位', sameSet(colsOf(db, 'bounty_seg_contrib'), ['seg_key', 'actor', 'first_ok_at']),
    colsOf(db, 'bounty_seg_contrib').join(','));
  ok('A15b chip_ledger 欄位', sameSet(colsOf(db, 'chip_ledger'),
    ['id', 'actor', 'kind', 'delta', 'ref', 'day', 'created_at']), colsOf(db, 'chip_ledger').join(','));
  ok('A15c garage_unlocks 欄位', sameSet(colsOf(db, 'garage_unlocks'),
    ['actor', 'scene', 'nth', 'cost', 'created_at']), colsOf(db, 'garage_unlocks').join(','));
  ok('A15d cloud_rides 欄位', sameSet(colsOf(db, 'cloud_rides'),
    ['actor', 'day', 'train_key', 'sec', 'request_id', 'created_at', 'simulator']), colsOf(db, 'cloud_rides').join(','));
}

// A16 主鍵（順序也算：複合主鍵的欄位順序決定前綴索引能服務哪種查詢）
{
  const got = {
    bounty_seg_contrib: pkOf(db, 'bounty_seg_contrib'), chip_ledger: pkOf(db, 'chip_ledger'),
    garage_unlocks: pkOf(db, 'garage_unlocks'), cloud_rides: pkOf(db, 'cloud_rides'),
  };
  ok('A16 四張新表的主鍵：contrib(seg_key,actor)、ledger(id)、unlocks(actor,scene)、rides(actor,day)',
    JSON.stringify(got.bounty_seg_contrib) === '["seg_key","actor"]' && JSON.stringify(got.chip_ledger) === '["id"]' &&
    JSON.stringify(got.garage_unlocks) === '["actor","scene"]' && JSON.stringify(got.cloud_rides) === '["actor","day"]',
    JSON.stringify(got));
}

// A17 UNIQUE(kind, ref)：同一個來源只能入帳一次；換 kind 則是不同來源（不是「ref 全域唯一」）
{
  const { db: d } = openTestDb();
  const ins = (id, kind, ref) => tryRun(d,
    'INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES (?,?,?,?,?,?,?)',
    id, 'device-u', kind, 1, ref, '2026-10-10', 1);
  const first = ins('l1', 'trip', 'r-1');
  const dupSameKind = ins('l2', 'trip', 'r-1');            // 不同 id、同 (kind, ref) → 必須被擋
  const sameRefOtherKind = ins('l3', 'cloud', 'r-1');       // 同 ref、不同 kind → 放行
  const n = d.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c;
  ok('A17 UNIQUE(kind,ref)：同 (kind,ref) 第二筆被擋、同 ref 換 kind 放行',
    first === '' && /UNIQUE/i.test(dupSameKind) && sameRefOtherKind === '' && n === 2,
    JSON.stringify({ first, dupSameKind, sameRefOtherKind, n }));
  // INSERT OR IGNORE 是 worker 重跑保護的實際手段：被擋的那筆要「靜默不寫」而不是丟例外
  const before = d.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c;
  const r = d.prepare("INSERT OR IGNORE INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES ('l9','device-u','trip',1,'r-1','2026-10-10',1)").run();
  ok('A17b INSERT OR IGNORE 重複來源：changes=0、筆數不變（cron 重跑不會重複發）',
    Number(r.changes) === 0 && d.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c === before, `changes=${r.changes}`);
}

// A18 CHECK 只放行五種 kind，非法值被擋
{
  const { db: d } = openTestDb();
  const ins = (kind, i) => tryRun(d,
    'INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES (?,?,?,?,?,NULL,1)', 'k' + i, 'device-k', kind, 1, 'ref-' + i);
  const legal = ['trip', 'cloud', 'redeem', 'merge', 'adjust'].map(ins);
  const illegal = ['bogus', 'TRIP', '', 'refund'].map((k, i) => ins(k, 50 + i));
  ok('A18a 五種合法 kind 全部收得下', legal.every(m => m === ''), JSON.stringify(legal));
  ok('A18b 非法 kind（bogus／大寫 TRIP／空字串／refund）全部被 CHECK 擋下',
    illegal.every(m => /CHECK/i.test(m)), JSON.stringify(illegal));
}

// A19 NOT NULL：該擋的擋、該放的放（day 與 request_id 是可空的，client 也是）
{
  const { db: d } = openTestDb();
  const notNull = (t, c) => d.prepare(`PRAGMA table_info(${t})`).all().find(r => r.name === c).notnull === 1;
  const must = {
    chip_ledger: ['id', 'actor', 'kind', 'delta', 'ref', 'created_at'],
    bounty_seg_contrib: ['seg_key', 'actor', 'first_ok_at'],
    garage_unlocks: ['actor', 'scene', 'nth', 'cost', 'created_at'],
    cloud_rides: ['actor', 'day', 'train_key', 'sec', 'created_at', 'simulator'],
  };
  const bad = [];
  for (const [t, cs] of Object.entries(must)) for (const c of cs) if (!notNull(t, c)) bad.push(`${t}.${c} 應為 NOT NULL`);
  for (const [t, c] of [['chip_ledger', 'day'], ['cloud_rides', 'request_id'], ['bounty_samples', 'client']])
    if (notNull(t, c)) bad.push(`${t}.${c} 應可空`);
  if (!notNull('bounty_board', 'distinct_ok_users')) bad.push('bounty_board.distinct_ok_users 應為 NOT NULL');
  ok('A19 新表 NOT NULL 欄位齊全；day／request_id／client 可空', bad.length === 0, bad.join('; '));
  // 行為面：id 為 NULL 的帳本列真的進不去（rowid 表的 TEXT PRIMARY KEY 不隱含 NOT NULL，0002 同一課）
  const m = tryRun(d, "INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES (NULL,'a','trip',1,'x',NULL,1)");
  ok('A19b chip_ledger.id 為 NULL 被擋（不會出現無法定址的帳本列）', /NOT NULL/i.test(m), m);
}

// A20 distinct_ok_users 預設 0：worker 的估值 cron 用的 INSERT 沒有列這一欄，必須仍然收得下
{
  const { db: d } = openTestDb();
  d.exec(`INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at)
          VALUES ('tra_sched|山線|A|B','tra_sched','自強',0,'track','',1,1,1,4,1)`);
  const row = d.prepare('SELECT distinct_ok_users AS n FROM bounty_board').get();
  ok('A20 沒列 distinct_ok_users 的既有 INSERT 仍可用，預設值 0', row && row.n === 0, JSON.stringify(row));
}

// A20b cloud_rides.simulator 預設 0（一般搭乘不必列這一欄）、只有明寫 1 才是模擬器；欄位在 CREATE 裡（不是 ALTER），
// 所以 A22「恰有兩句 ALTER」的期望不變
{
  const { db: d } = openTestDb();
  d.exec("INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at) VALUES ('device-s','2026-10-10','tra_sched|123',700,NULL,1)");
  d.exec("INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at,simulator) VALUES ('device-s','2026-10-11','tra_sched|123',700,NULL,1,1)");
  const rows = d.prepare('SELECT day, simulator AS s FROM cloud_rides ORDER BY day').all().map(r => ({ ...r }));
  const info = d.prepare('PRAGMA table_info(cloud_rides)').all().find(r => r.name === 'simulator');
  ok('A20b cloud_rides.simulator：INTEGER NOT NULL、沒列時預設 0、明寫 1 留 1',
    info && /INT/i.test(info.type) && info.notnull === 1 && JSON.stringify(rows) === '[{"day":"2026-10-10","s":0},{"day":"2026-10-11","s":1}]',
    JSON.stringify({ info, rows }));
  const m = tryRun(d, "INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at,simulator) VALUES ('device-s','2026-10-12','tra_sched|123',700,NULL,1,NULL)");
  ok('A20c simulator 明寫 NULL 被 NOT NULL 擋下（查次數時 simulator=0 不會漏掉 NULL 列）', /NOT NULL/i.test(m), m);
}

// A21 重複套用：資料不掉；新表被砍掉後再套會長回來（證明 CREATE 都在檔內第一句 ALTER 之前）
{
  const { db: d } = openTestDb();
  d.exec("INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES ('keep','device-r','trip',3,'ref-keep','2026-10-10',1)");
  let threw = '';
  try { applySchemaFiles(d); } catch (e) { threw = String(e.message || e); }
  const kept = d.prepare("SELECT delta FROM chip_ledger WHERE id='keep'").get();
  ok('A21a 帳本有資料時再套一次 schema：不炸、資料原封不動', threw === '' && kept && kept.delta === 3, threw || JSON.stringify(kept));
  for (const t of NEW_TABLES) d.exec(`DROP TABLE ${t}`);      // DROP TABLE 連帶帶走 idx_chip_ledger_actor_day、idx_seg_contrib_actor、idx_seg_contrib_first
  try { applySchemaFiles(d); } catch (e) { threw = String(e.message || e); }
  const names = d.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all().map(r => r.name);
  ok('A21b 新表與索引被砍掉後再套一次全部長回來（CREATE 全在 ALTER 之前，重套時沒被 duplicate column 的例外吞掉）',
    NEW_TABLES.every(t => names.includes(t)) && names.includes('idx_chip_ledger_actor_day') && names.includes('idx_seg_contrib_actor') &&
    names.includes('idx_seg_contrib_first') && threw === '',
    threw || names.filter(n => NEW_TABLES.includes(n) || n.startsWith('idx_chip') || n.startsWith('idx_seg_contrib')).join(','));
}

// A22 結構判準（與 A21b 不同源）：0014 檔內第一句 ALTER 之後不得再有 CREATE。
// 只看非註解行——註解裡講到 ALTER／CREATE 的字樣不算。
{
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', '0014_bounty_v2.sql'), 'utf8');
  const stmts = src.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').split(';').map(s => s.trim()).filter(Boolean);
  const firstAlter = stmts.findIndex(s => /^ALTER\s+TABLE/i.test(s));
  const createAfter = stmts.slice(firstAlter + 1).filter(s => /^CREATE\s/i.test(s));
  const alters = stmts.filter(s => /^ALTER\s+TABLE/i.test(s));
  ok('A22 0014：ALTER 全部排在檔尾（第一句 ALTER 之後沒有 CREATE），且恰有兩句（distinct_ok_users、client）',
    firstAlter > 0 && createAfter.length === 0 && alters.length === 2 &&
    /distinct_ok_users/.test(alters[0]) && /\bclient\b/.test(alters[1]),
    JSON.stringify({ firstAlter, createAfter: createAfter.length, alters: alters.length }));
}

// A23（2026-09-30）：出貨鏈的正式庫 schema 守門人（verify_remote_schema.mjs，ship-web 每一發都跑）要看得到索引。
// 認領五句寫 INDEXED BY idx_claims_actor，索引不在時那幾句直接報錯（no such index）；只比表與欄位的舊版照不到這一種漏套。
// 做法：把這顆本機庫的 sqlite_master（表＋索引）包成 `d1 execute --json` 的形狀，餵它的 --ddl 離線模式——
// 完整的要過；拿掉 idx_claims_actor、或它建在別張表上，都要 exit 1 而且點名它（拿掉的那一種還要點名該補套的 0002_bounty.sql）。
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index')").all().map(r => ({ ...r }));
  const dir = mkdtempSync(join(tmpdir(), 'rschema-'));
  const runGate = (tag, rs) => {
    const f = join(dir, tag + '.json');
    writeFileSync(f, JSON.stringify([{ results: rs, success: true }]));
    const p = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify_remote_schema.mjs'), '--ddl', f], { cwd: ROOT, encoding: 'utf8' });
    return { rc: p.status, out: (p.stdout || '') + (p.stderr || '') };
  };
  const full = runGate('full', rows);
  const noIdx = runGate('no-idx', rows.filter(r => r.name !== 'idx_claims_actor'));
  const wrongTbl = runGate('wrong-table', rows.map(r => r.name === 'idx_claims_actor' ? { ...r, tbl_name: 'bounty_board' } : r));
  ok('A23a 正式庫 schema 守門人：本機庫的表＋索引全在 → exit 0，而且有比到 idx_claims_actor',
    full.rc === 0 && /idx_claims_actor/.test(full.out) && rows.some(r => r.type === 'index' && r.name === 'idx_claims_actor'), full.out.trim().slice(-240));
  ok('A23b 拿掉 idx_claims_actor（其餘不變）→ exit 1，點名 idx_claims_actor 與 0002_bounty.sql',
    noIdx.rc === 1 && /idx_claims_actor/.test(noIdx.out) && /0002_bounty\.sql/.test(noIdx.out), noIdx.out.trim().slice(0, 300));
  ok('A23c idx_claims_actor 建在別張表上 → exit 1，點名 idx_claims_actor',
    wrongTbl.rc === 1 && /idx_claims_actor/.test(wrongTbl.out), wrongTbl.out.trim().slice(0, 300));
  // 第十批起六張會長大的表都釘 INDEXED BY，其中四張指名主鍵的自動索引（sqlite_autoindex_<表>_<n>，schema 裡沒有 CREATE INDEX 可比）。
  // 正式庫的 sqlite_master 一樣列得出自動索引；守門人要把它們當成「建表那一支 migration 宣告的」，缺了照樣 exit 1、點名該補套的那一支。
  const autos = rows.filter(r => r.type === 'index' && /^sqlite_autoindex_/.test(r.name)).map(r => r.name);
  const needAuto = ['sqlite_autoindex_bounty_samples_1', 'sqlite_autoindex_garage_unlocks_1', 'sqlite_autoindex_cloud_rides_1',
    'sqlite_autoindex_bounty_seg_contrib_1'];
  ok('A23d 守門人比到的索引含四個主鍵自動索引與 idx_seg_contrib_first（worker.js 的 INDEXED BY 真的有指名它們，本機庫也真的有）',
    full.rc === 0 && needAuto.every(n => full.out.includes(n) && autos.includes(n)) && /idx_seg_contrib_first/.test(full.out),
    JSON.stringify({ rc: full.rc, autos, out: full.out.trim().slice(-400) }));
  const noAuto = runGate('no-auto', rows.filter(r => r.name !== 'sqlite_autoindex_garage_unlocks_1'));
  ok('A23e 正式庫沒有 sqlite_autoindex_garage_unlocks_1 → exit 1，點名它與建表的 0014_bounty_v2.sql（不是當成程式錯）',
    noAuto.rc === 1 && /sqlite_autoindex_garage_unlocks_1（ON garage_unlocks/.test(noAuto.out) && /0014_bounty_v2\.sql/.test(noAuto.out),
    noAuto.out.trim().slice(0, 400));
  const noFirst = runGate('no-first', rows.filter(r => r.name !== 'idx_seg_contrib_first'));
  ok('A23f 正式庫沒有 idx_seg_contrib_first（0014 較早版本套過、這一版新加的索引還沒套）→ exit 1，點名它與 0014_bounty_v2.sql',
    noFirst.rc === 1 && /idx_seg_contrib_first/.test(noFirst.out) && /0014_bounty_v2\.sql/.test(noFirst.out), noFirst.out.trim().slice(0, 400));
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
