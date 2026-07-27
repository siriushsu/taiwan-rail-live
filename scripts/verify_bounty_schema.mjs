// 懸賞 D1 schema 驗收：把 schema/*.sql 真的套到一顆 node:sqlite 記憶體庫上，
// 斷言表、欄位、主鍵、索引都在，且重複套用不會炸（cron 與新環境都會重跑同一份檔）。
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

// A9 dwell 的 A==B 約定真的能用同一個 split 解出來（這是全計畫共用的鍵約定）
{
  const parse = k => { const p = String(k).split('|'); return { sys: p[0], lnId: p[1], a: p[2], b: p[3], isDwell: p[2] === p[3] }; };
  ok('A9 dwell 鍵 A==B、track 鍵 A!=B',
    parse('TRA|WL|臺北|臺北').isDwell === true && parse('TRA|WL|七堵|臺北').isDwell === false);
}

// A10 D1 轉接器的形狀與真 D1 一致（後面每個 task 都靠它，形狀錯會讓所有測試一起說謊）
{
  const { DELAY_DB } = openTestDb();
  await DELAY_DB.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,?,?,?)')
    .bind('dev-1', null, 7, null, 1700000000000).run();
  const one = await DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind('dev-1').first();
  const col = await DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind('dev-1').first('points');
  const many = await DELAY_DB.prepare('SELECT actor FROM bounty_points').all();
  const none = await DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind('nope').first();
  ok('A10 轉接器 first/first(col)/all/空值語意與 D1 一致',
    one && one.points === 7 && col === 7 && Array.isArray(many.results) && many.results.length === 1 && none === null,
    JSON.stringify({ one, col, n: many.results && many.results.length, none }));
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
