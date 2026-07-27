// 懸賞 D1 schema 驗收：把 schema/*.sql 真的套到一顆 node:sqlite 記憶體庫上，
// 斷言表、欄位、主鍵、NOT NULL 約束、索引都在，且重複套用不會炸（cron 與新環境都會重跑同一份檔）。
// 跑法：node scripts/verify_bounty_schema.mjs
// 註：node:sqlite 會印一行 ExperimentalWarning，那是正常輸出。
import { openTestDb, applySchemaFiles } from './d1_local.mjs';

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
  ]), cols('bounty_board').join(','));
  ok('A4 bounty_claims 欄位', eq(cols('bounty_claims'), [
    'id', 'actor', 'seg_key', 'train_kind', 'dir', 'kind', 'slot', 'points_locked', 'claimed_at', 'expires_at', 'status',
  ]), cols('bounty_claims').join(','));
  ok('A5 bounty_samples 欄位', eq(cols('bounty_samples'), [
    'id', 'actor', 'sys', 'ln_id', 'train_no', 'dir', 'trip_date', 'payload', 'segs',
    'submitted_at', 'verdict', 'verdict_at', 'quality_code', 'reject_code',
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
  ];
  ok('A11 六個索引都在', want.every(n => idxNames.includes(n)), idxNames.join(','));
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

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
