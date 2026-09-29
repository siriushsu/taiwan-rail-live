// 路段懸賞 v2 後端驗收：每段去重人數、籌碼入帳、每日上限、反作弊（送交端）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ BOUNTY_NOW 釘死，不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_ledger.mjs
//
// 期望值一律寫死在這裡，不呼叫實作去產生期望。來源分兩種，不混寫：
//   ・使用者原話（09-29，逐字）：「捷運不用懸賞」「1跟2照你建議」「第一座4 後面都8 我不怕大家開的快」。
//   ・其餘數字（台鐵 50／高鐵 15 位不同的人、一趟至少 10 分鐘、每日上限 4 籌碼、南迴×2、一趟 1 籌碼）
//     來自 data/bounty_rules.json 與主對話派工單對「1跟2照你建議」的讀法，是主對話的判讀，不是使用者逐字說的。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準（見 verify_bounty_api 的 C5b）。
//
// 分組：D 每段去重人數／收滿  C 籌碼入帳與每日上限  S 送交端（app_only／requestId／client）
//       P 通行證沒有倍率  E 設定缺漏的邊界
import { readFileSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// 對外連線偵測：籌碼入帳與去重登記只該讀寫 D1，不該打任何外部服務（P1d 用它證明沒有偷偷去查通行證資格）。
// 會丟例外：真有人加了外部呼叫，流程會在那裡斷掉（比默默成功更容易被發現）。
const outbound = [];
globalThis.fetch = async (u) => { outbound.push(String(u)); throw new Error('offline: ' + String(u)); };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
// 例外也要記成 FAIL（而不是讓整支腳本崩潰、後面的判準全部沒跑）：突變測試時「紅」有兩種長相——
// 斷言為假、或流程直接丟例外（例如 INSERT 撞 UNIQUE），兩種都必須被記下來。
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00（週三）
const TRIP_DATE = '2026-07-28';                              // 週二：不是假日，coverageOf 不會產 dwell
const NEXT_DATE = '2026-07-29';                              // 「隔天」：BOUNTY_NOW 那一天，仍在乘車日窗內
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const limiter = { limit: async () => ({ success: true }) };

// 三條合成的線，名字用真的鍵（bounty_rules.json 的 remoteLines 認的是 'tra_sched|南迴線'）：
// 20 公里、每 2 公里一站（S0…S10），正規區間 10 段。
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const UNITS = { generatedAt: 1, schedDate: TRIP_DATE, units: [], lines: {
  'tra_sched|南迴線': mkLine('tra_sched', '南迴線'),       // 偏遠線：×2
  'tra_sched|山線': mkLine('tra_sched', '山線'),           // 一般線：×1
  'thsr_sched|THSR': mkLine('thsr_sched', 'THSR'),
} };
const SEGS10 = Array.from({ length: 9 }, (_, i) => `S${i}|S${i + 1}`);   // 板上種 9 段：S0|S1 … S8|S9
const segKey = (sys, lnId, s) => `${sys}|${lnId}|${s}`;

// 一趟乾淨軌跡：等速 speed m/s 跑 durationSec 秒（1 Hz、acc 8 m）。durationSec＝t 的 max−min，
// 所以 601 個點 ＝ 600 秒。20 m/s 跑 700 秒 ＝ 14 公里 ＝ 剛好蓋滿前 7 段（S0|S1 … S6|S7）。
function tripPts(durationSec, speed = 20, t0 = 30000) {
  const pts = [];
  for (let i = 0; i <= durationSec; i++) pts.push({ d: i * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc: 8 });
  return pts;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// 一個獨立的世界：全新的 D1、規則與題庫替身、釘死的時鐘。
function world(over = {}) {
  const rules = over.rules || RULES;
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const ASSETS = { fetch: async r => new Response(
    String(r.url).includes('bounty_units') ? JSON.stringify(over.units || UNITS) : JSON.stringify(rules), { status: 200 }) };
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, BOUNTY_NOW: String(over.now || NOW_MS) };
  return {
    db, env,
    // 模組層級有 rules／units 快取（bountyResetMemCaches 的註解），每次跑之前歸零，情境之間才不會串味
    cron: async (now) => { _bounty.bountyResetMemCaches(); return _bounty.bountyVerifyCron(now ? { ...env, BOUNTY_NOW: String(now) } : env); },
    submit: async (b, hdr = {}) => { _bounty.bountyResetMemCaches(); return _bounty.bountySubmit(new Request('https://railisland.tw/api/bounty-submit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr }, body: JSON.stringify(b) }), env); },
  };
}

// 板上種段。opts：trainKind／dir／points／covered／distinct／sampleCount，一次可以種多列（同段不同車種）。
// segs 預設種 9 段；只想種其中幾段（例如「這一趟沒經過的那一段」）就傳自己的清單。
const boardSql = (sys, lnId, rows, segs = SEGS10) => {
  const v = [];
  for (const s of segs) for (const r of rows) {
    v.push(`('${segKey(sys, lnId, s)}','${sys}','${r.trainKind || '自強'}',${r.dir ?? 0},'track','',1,1,${r.points ?? 3},10,1,1,` +
      `${r.sampleCount ?? 0},${r.covered ?? 'NULL'},${r.distinct ?? 0})`);
  }
  return `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users) VALUES ${v.join(',')};`;
};
// 預塞 n 位「別人」已經貢獻過這些段（contrib 與板上計數一致）
const stuffSql = (sys, lnId, n) => {
  const v = [];
  for (const s of SEGS10) for (let i = 0; i < n; i++) v.push(`('${segKey(sys, lnId, s)}','other-${String(i).padStart(3, '0')}',1)`);
  return `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ${v.join(',')};`;
};

// 直接寫樣本列（快，且能指定每一批自己的 client）。clients：每一批各用哪個 client；client===null 寫 NULL（舊列）；
// clientRaw：原樣寫進 client 欄的字串（測壞掉的 JSON）。
function addTrip(db, o) {
  const { actor, trainNo, lnId = '南迴線', sys = 'tra_sched', date = TRIP_DATE, durationSec = 700 } = o;
  const pts = o.pts || tripPts(durationSec, o.speed || 20);
  chunk(pts, 200).forEach((part, k) => {
    const c = o.clientRaw !== undefined ? o.clientRaw
      : o.clients ? o.clients[Math.min(k, o.clients.length - 1)] : (o.client === undefined ? APP : o.client);
    db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
      " VALUES (?,?,?,?,?,0,?,?,NULL,?,'pending',?)")
      .run(`${actor}.${trainNo}.${date}.${k}`, actor, sys, lnId, trainNo, date, JSON.stringify(part), NOW_MS - 3600e3 + k,
        typeof c === 'string' ? c : c ? JSON.stringify(c) : null);
  });
}
// 走完整條路徑（POST /api/bounty-submit，每批 ≤60 秒）：需要驗 client 真的從請求流進 D1 的情境用這個。
async function submitTrip(w, o) {
  const { actor, trainNo, lnId = '南迴線', sys = 'tra_sched', date = TRIP_DATE, durationSec = 700 } = o;
  const out = [];
  for (const [k, part] of chunk(tripPts(durationSec, 20), 61).entries()) {
    out.push(await w.submit({
      actor, sys, lnId, trainNo, dir: 0, tripDate: date, batch: k + 1, samples: part,
      client: o.client === undefined ? APP : o.client, requestId: `${actor}-${trainNo}-${date}-${k}`.slice(0, 64), ...(o.extra || {}),
    }));
  }
  return out;
}

const q = {
  board: (db, key) => db.prepare('SELECT train_kind,dir,sample_count,covered_at,distinct_ok_users FROM bounty_board WHERE seg_key=? ORDER BY train_kind,dir').all(key),
  contrib: (db, key) => db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib WHERE seg_key=?').get(key).c,
  contribAll: (db, actor) => db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib WHERE actor=?').get(actor).c,
  ledger: (db, actor) => db.prepare('SELECT * FROM chip_ledger WHERE actor=? ORDER BY created_at,id').all(actor),
  // trip 籌碼合計；day 不給就是全部日子。這裡刻意自己寫 SQL、不呼叫實作的任何函式——期望值不能與被驗的實作同源。
  chips: (db, actor, day) => day == null
    ? db.prepare("SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=? AND kind='trip'").get(actor).n
    : db.prepare("SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=? AND kind='trip' AND day=?").get(actor, day).n,
  verdicts: (db, actor) => db.prepare('SELECT DISTINCT verdict v FROM bounty_samples WHERE actor=?').all(actor).map(r => r.v).sort().join(),
};
const K = k => segKey('tra_sched', '南迴線', k);
const KT = k => segKey('thsr_sched', 'THSR', k);
const STUB = over => ({ ...RULES, coverDistinct: { ...RULES.coverDistinct, ...over } });

// ═══ D 組：每段去重人數與收滿 ═══════════════════════════════════════════════
// D1 同 actor 同段 3 趟 ok → 1 位；3 個 actor → 3 位（驗收 1）
await attempt('D1', async () => {
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{}]) });
  for (const n of ['101', '102', '103']) addTrip(w.db, { actor: 'device-d1', trainNo: n });
  await w.cron();
  const b = q.board(w.db, K('S0|S1'))[0], b6 = q.board(w.db, K('S6|S7'))[0], b7 = q.board(w.db, K('S7|S8'))[0];
  ok('D1 [驗收1] 同一位 actor 同一段 3 趟 ok → distinct_ok_users=1、contrib 1 列（sample_count 照舊累加＝3）',
    q.verdicts(w.db, 'device-d1') === 'ok' && b.distinct_ok_users === 1 && q.contrib(w.db, K('S0|S1')) === 1 && b.sample_count === 3,
    JSON.stringify({ verdicts: q.verdicts(w.db, 'device-d1'), b, contrib: q.contrib(w.db, K('S0|S1')) }));
  ok('D1b 蓋到的 7 段每一段都是 1 位；沒蓋到的（S7|S8）維持 0——不是整張板一起加',
    b6.distinct_ok_users === 1 && b7.distinct_ok_users === 0 && q.contrib(w.db, K('S7|S8')) === 0,
    JSON.stringify({ b6, b7 }));
});
await attempt('D1c', async () => {
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{}]) });
  for (const [a, n] of [['device-d1a', '101'], ['device-d1b', '102'], ['device-d1c', '103']]) addTrip(w.db, { actor: a, trainNo: n });
  await w.cron();
  const b = q.board(w.db, K('S0|S1'))[0];
  ok('D1c [驗收1] 3 個不同 actor 各一趟 → distinct_ok_users=3、contrib 3 列、sample_count=3',
    b.distinct_ok_users === 3 && q.contrib(w.db, K('S0|S1')) === 3 && b.sample_count === 3, JSON.stringify(b));
});

// D2 stub 規則把台鐵門檻調小成 3：第 2 位不寫、第 3 位到才寫 covered_at（驗收 2 前半）
// 順序刻意是 A、A、B、C：同一位 A 交兩趟不推進人數，B 是第 2 位，C 才是第 3 位。
await attempt('D2', async () => {
  const w = world({ rules: STUB({ TRA: 3 }), seed: boardSql('tra_sched', '南迴線', [{}]) });
  const state = () => q.board(w.db, K('S0|S1'))[0];
  addTrip(w.db, { actor: 'device-a', trainNo: '101' }); await w.cron();
  const afterA1 = state();
  addTrip(w.db, { actor: 'device-a', trainNo: '102' }); await w.cron();
  const afterA2 = state();
  addTrip(w.db, { actor: 'device-b', trainNo: '103' }); await w.cron();
  const afterB = state();
  addTrip(w.db, { actor: 'device-c', trainNo: '104' }); await w.cron();
  const afterC = state();
  ok('D2a [驗收2] 門檻 3：A 一趟 → 1 位、未收滿', afterA1.distinct_ok_users === 1 && afterA1.covered_at === null, JSON.stringify(afterA1));
  ok('D2b A 再交一趟 → 仍是 1 位、未收滿（同一個人不重算）', afterA2.distinct_ok_users === 1 && afterA2.covered_at === null &&
    afterA2.sample_count === 2, JSON.stringify(afterA2));
  ok('D2c [驗收2] 第 2 位（B）到 → 2 位、covered_at 不寫', afterB.distinct_ok_users === 2 && afterB.covered_at === null, JSON.stringify(afterB));
  ok('D2d [驗收2] 第 3 位（C）到才寫 covered_at（＝判定當下的 now）', afterC.distinct_ok_users === 3 && afterC.covered_at === NOW_MS,
    JSON.stringify(afterC));
});

// D3 真設定（台鐵 50）：預塞 48 位，第 49 位不寫、第 50 位寫、第 51 位不改寫 covered_at（驗收 2 後半）
await attempt('D3', async () => {
  ok('D3 前提：真設定的台鐵門檻是 50、高鐵是 15（不是 stub）', RULES.coverDistinct.TRA === 50 && RULES.coverDistinct.THSR === 15,
    JSON.stringify(RULES.coverDistinct));
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{ distinct: 48 }]) + stuffSql('tra_sched', '南迴線', 48) });
  const s = () => q.board(w.db, K('S0|S1'))[0];
  addTrip(w.db, { actor: 'device-n49', trainNo: '101' }); await w.cron();
  const at49 = s();
  addTrip(w.db, { actor: 'device-n50', trainNo: '102' }); await w.cron();
  const at50 = s();
  addTrip(w.db, { actor: 'device-n51', trainNo: '103' }); await w.cron(NOW_MS + 3600e3);
  const at51 = s();
  ok('D3a [驗收2] 第 49 位到 → 49 位、covered_at 不寫', at49.distinct_ok_users === 49 && at49.covered_at === null, JSON.stringify(at49));
  ok('D3b [驗收2] 第 50 位到 → 50 位、寫 covered_at', at50.distinct_ok_users === 50 && at50.covered_at === NOW_MS, JSON.stringify(at50));
  ok('D3c 第 51 位到 → 51 位、covered_at 仍是第 50 位那一刻（COALESCE，不被改寫）',
    at51.distinct_ok_users === 51 && at51.covered_at === NOW_MS, JSON.stringify(at51));
});

// D4 高鐵用高鐵的門檻（驗收 3）：同樣「已有 14 位」，高鐵再來 1 位就收滿（15），台鐵不會（要 50）。
// 「拿台鐵門檻判高鐵」會讓高鐵那一列不收滿；「拿高鐵門檻判台鐵」會讓台鐵那一列提早收滿——兩個方向都有對照。
await attempt('D4', async () => {
  const w = world({
    seed: boardSql('thsr_sched', 'THSR', [{ distinct: 14 }]) + stuffSql('thsr_sched', 'THSR', 14) +
      boardSql('tra_sched', '南迴線', [{ distinct: 14 }]) + stuffSql('tra_sched', '南迴線', 14) });
  addTrip(w.db, { actor: 'device-h15', trainNo: '801', sys: 'thsr_sched', lnId: 'THSR' });
  addTrip(w.db, { actor: 'device-t15', trainNo: '312', sys: 'tra_sched', lnId: '南迴線' });
  await w.cron();
  const hs = q.board(w.db, KT('S0|S1'))[0], tr = q.board(w.db, K('S0|S1'))[0];
  ok('D4a [驗收3] 高鐵第 15 位到 → 收滿（門檻取 THSR 的 15）', hs.distinct_ok_users === 15 && hs.covered_at === NOW_MS, JSON.stringify(hs));
  ok('D4b [驗收3 對照] 台鐵同樣第 15 位 → 不收滿（若拿高鐵門檻判台鐵就會誤收滿）', tr.distinct_ok_users === 15 && tr.covered_at === null,
    JSON.stringify(tr));
});

// D5 unusable／suspect 不進 contrib、也不動 distinct_ok_users（驗收 4 前半）。控制組＝同一次 cron 裡另一位 ok 的確有進。
await attempt('D5', async () => {
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{}]) });
  const blocked = tripPts(700).map(p => ({ ...p, acc: 120 }));                 // acc 中位數 > 80 m → unusable（acc_blocked）
  const jumped = tripPts(700); jumped[400] = { ...jumped[400], d: jumped[100].d };   // 里程倒退 → suspect（impossible_physics）
  addTrip(w.db, { actor: 'device-un', trainNo: '201', pts: blocked });
  addTrip(w.db, { actor: 'device-sp', trainNo: '202', pts: jumped });
  addTrip(w.db, { actor: 'device-ok', trainNo: '203' });
  await w.cron();
  const b = q.board(w.db, K('S0|S1'))[0];
  ok('D5a [驗收4] 三趟各自判成 unusable／suspect／ok（前提：不是因為全都判壞了才「零」）',
    q.verdicts(w.db, 'device-un') === 'unusable' && q.verdicts(w.db, 'device-sp') === 'suspect' && q.verdicts(w.db, 'device-ok') === 'ok',
    JSON.stringify({ un: q.verdicts(w.db, 'device-un'), sp: q.verdicts(w.db, 'device-sp'), ok: q.verdicts(w.db, 'device-ok') }));
  ok('D5b-un [驗收4] unusable 的 actor 在 contrib 裡一列都沒有（防線：只有 ok 才登記）', q.contribAll(w.db, 'device-un') === 0,
    String(q.contribAll(w.db, 'device-un')));
  ok('D5b-sp [驗收4] suspect 的 actor 在 contrib 裡一列都沒有（防線：suspect 沒有覆蓋段＋只有 ok 才登記，兩層）', q.contribAll(w.db, 'device-sp') === 0,
    String(q.contribAll(w.db, 'device-sp')));
  ok('D5b-ok [驗收4 對照] 同一次 cron 裡那位 ok 的登記了 7 段（前面兩個 0 不是因為登記整條壞了）', q.contribAll(w.db, 'device-ok') === 7,
    String(q.contribAll(w.db, 'device-ok')));
  ok('D5c [驗收4] 該段 distinct_ok_users 只有 1（那位 ok 的），不是 3', b.distinct_ok_users === 1, JSON.stringify(b));
  ok('D5d [驗收4] unusable 與 suspect 的籌碼帳本 0 列；ok 那位 2 籌碼（南迴 ×2）',
    q.ledger(w.db, 'device-un').length === 0 && q.ledger(w.db, 'device-sp').length === 0 && q.chips(w.db, 'device-ok') === 2,
    JSON.stringify({ un: q.ledger(w.db, 'device-un').length, sp: q.ledger(w.db, 'device-sp').length, ok: q.chips(w.db, 'device-ok') }));
});

// D6 收滿是「段」的屬性（路段懸賞 v2 A2-T0）：同一個 seg_key 底下的每一列——另一個車種、另一個方向——
// distinct_ok_users 到門檻時一起收滿；sample_count 仍是逐列累加（只有被計功的那一列 +1）。
// 這一趟沒經過的 seg_key 不受影響：就算它的人數也剛好夠，也不會被順手收滿（收滿只發生在這一趟覆蓋到的段）。
// 原本這條把「只寫被計功的那一列」釘死並註明「若日後改成整段一起收，這條會紅」——現在改成整段，所以改釘新語意。
await attempt('D6', async () => {
  const w = world({ rules: STUB({ TRA: 1 }),
    seed: boardSql('tra_sched', '南迴線', [{ trainKind: '自強', points: 3 }, { trainKind: '區間', points: 1 }, { trainKind: '自強', dir: 1, points: 3 }], ['S0|S1']) +
      boardSql('tra_sched', '南迴線', [{ trainKind: '自強', points: 3, distinct: 1 }], ['S8|S9']) });   // 這一趟蓋不到的段，人數 1 ≥ 門檻 1
  addTrip(w.db, { actor: 'device-d6', trainNo: '101' });
  await w.cron();
  const rows = q.board(w.db, K('S0|S1'));
  const zq = rows.find(r => r.train_kind === '自強' && r.dir === 0), qj = rows.find(r => r.train_kind === '區間'), back = rows.find(r => r.dir === 1);
  const far = q.board(w.db, K('S8|S9'))[0];
  ok('D6a 同段三列（自強／區間／另一方向）distinct_ok_users 都是 1、covered_at 都是這一刻——整段一起收滿',
    rows.length === 3 && rows.every(r => r.distinct_ok_users === 1 && r.covered_at === NOW_MS), JSON.stringify(rows));
  ok('D6b sample_count 仍逐列累加：只有被計功的自強（dir0）那一列是 1，區間與另一方向都是 0',
    zq.sample_count === 1 && qj.sample_count === 0 && back.sample_count === 0, JSON.stringify(rows));
  ok('D6c 這一趟沒經過的段（S8|S9，人數 1 ≥ 門檻 1）不受影響：covered_at 仍是空',
    far.covered_at === null && far.distinct_ok_users === 1, JSON.stringify(far));
});

// D7 dwell 與 track 走同一套去重（seg_key 相同就是同一段）：兩位不同的人停靠同一站 → dwell 列 2 位；同一位再停一次仍是 2
await attempt('D7', async () => {
  const SAT = '2026-07-25';                                                    // 週六：holiday，coverageOf 才會產 dwell
  const centerM = 6000;                                                        // S3（d=6 km）
  // 接近→煞停→靜止 6 秒→起步。速度變化 ≤3.9 m/s²（物理閘），v 帶雜訊（都卜勒閘）。
  function stopTraj() {
    const pts = []; let d = 4200, t = 30000, n = 0;
    const push = (dd, v) => { d += dd; t += 1; n += 1; pts.push({ d, t, v, acc: 8 + (n % 3) }); };
    pts.push({ d, t, v: 10, acc: 8 });
    while (d + 10 < centerM - 105) push(10, 10 + Math.sin(n / 3) * 0.5);
    for (let j = 1; j <= 20; j++) push(10 - 9.5 * j / 20, Math.max(0, 10 - 9.5 * j / 20 + Math.sin(n / 3) * 0.3));
    for (let j = 0; j < 6; j++) push(0.2, 0.35 + (j % 2) * 0.1);
    for (let j = 1; j <= 20; j++) push(0.5 + 9.5 * j / 20, 0.5 + 9.5 * j / 20 + Math.sin(n / 3) * 0.3);
    for (let j = 0; j < 25; j++) push(10, 10 + Math.sin(n / 3) * 0.5);
    return pts;
  }
  const dwellKey = K('S3|S3');
  const board = `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users)
    VALUES ('${dwellKey}','tra_sched','自強',0,'dwell','holiday',1,1,3,10,1,1,0,NULL,0);`;
  const w = world({ seed: board });
  addTrip(w.db, { actor: 'device-w1', trainNo: '301', date: SAT, pts: stopTraj() });
  addTrip(w.db, { actor: 'device-w2', trainNo: '302', date: SAT, pts: stopTraj() });
  await w.cron();
  const two = q.board(w.db, dwellKey)[0];
  addTrip(w.db, { actor: 'device-w1', trainNo: '303', date: SAT, pts: stopTraj() });
  await w.cron();
  const still = q.board(w.db, dwellKey)[0];
  ok('D7a dwell 列也進 contrib：兩位不同的人停靠同一站 → distinct_ok_users=2、contrib 2 列（前提：兩趟真的判成 ok）',
    q.verdicts(w.db, 'device-w1') === 'ok' && two.distinct_ok_users === 2 && q.contrib(w.db, dwellKey) === 2, JSON.stringify({ two, v: q.verdicts(w.db, 'device-w1') }));
  ok('D7b 同一位再停一次 → 仍是 2 位（dwell 也去重）', still.distinct_ok_users === 2 && q.contrib(w.db, dwellKey) === 2 && still.sample_count === 3, JSON.stringify(still));
});

// D8 晚上架的單位：該段已經有 3 位不同的人交過 ok，換班表後多了「區間」那一列——每日估值 cron 上架時要把 3 帶進去，
// 不能從 0 起算（人數是「段」的屬性，先上架的兄弟列已經是 3；從 0 起算就永遠少 3 位而且沒有任何錯誤訊息）。
// 已經在板上的列不動；沒有任何貢獻者的段，新列是 0（對照：帶入的數字來自 contrib，不是隨便一個常數）。
await attempt('D8', async () => {
  const seg = K('S0|S1'), seg2 = K('S1|S2');
  const unit = (segKey, trainKind) => ({ segKey, sys: 'tra_sched', trainKind, dir: 0, kind: 'track', slot: '', perDay: 10 });
  const w = world({
    units: { ...UNITS, units: [unit(seg, '自強'), unit(seg, '區間'), unit(seg2, '自強')] },
    seed: `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users)
             VALUES ('${seg}','tra_sched','自強',0,'track','',1,1,3,10,1,1,0,NULL,3);
           INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ('${seg}','other-a',1),('${seg}','other-b',1),('${seg}','other-c',1);` });
  _bounty.bountyResetMemCaches();
  const r = await _bounty.bountyValuationCron(w.env);
  const a = q.board(w.db, seg), b = q.board(w.db, seg2);
  ok('D8a 上架 2 個新單位（區間、S1|S2 的自強），原本就在板上的自強不動', r.inserted === 2 && a.length === 2, JSON.stringify({ inserted: r.inserted, rows: a.length }));
  ok('D8b 晚上架的「區間」列帶入該段已有的 3 位（兄弟列自強仍是 3）', a.every(x => x.distinct_ok_users === 3), JSON.stringify(a));
  ok('D8c 沒有任何貢獻者的段：新列是 0（不是任何一個固定常數）', b.length === 1 && b[0].distinct_ok_users === 0, JSON.stringify(b));
});

// ═══ C 組：籌碼入帳與每日上限 ═════════════════════════════════════════════
// C1 一般線 ok 趟 → 帳本 +1（驗收 5）；同時驗帳本列的形狀（ref＝趟鍵、day＝乘車日不是判定日、kind＝trip）
await attempt('C1', async () => {
  const w = world();
  addTrip(w.db, { actor: 'device-c1', trainNo: '101', lnId: '山線' });
  const st = await w.cron();
  const L = q.ledger(w.db, 'device-c1');
  ok('C1a [驗收5] 一般線（山線）ok 趟 → 帳本 1 列、delta=+1', q.verdicts(w.db, 'device-c1') === 'ok' && L.length === 1 && L[0].delta === 1, JSON.stringify(L));
  ok('C1b 帳本列形狀：kind=trip、ref＝趟鍵 actor|乘車日|車次、day＝乘車日（不是 cron 跑的那天 07-29）',
    L[0].kind === 'trip' && L[0].ref === 'device-c1|2026-07-28|101' && L[0].day === '2026-07-28' && L[0].created_at === NOW_MS, JSON.stringify(L[0]));
  ok('C1c cron 回報 stat.chips＝本次入帳的籌碼數（運維看得到今天發了多少）', st.chips === 1, JSON.stringify(st));
});
// C2 南迴 ok 趟 → +2；臺東線同樣 ×2；北迴線不算偏遠（設定檔的 remoteLines）
await attempt('C2', async () => {
  UNITS.lines['tra_sched|臺東線'] = mkLine('tra_sched', '臺東線');
  UNITS.lines['tra_sched|北迴線'] = mkLine('tra_sched', '北迴線');
  const w = world();
  addTrip(w.db, { actor: 'device-c2a', trainNo: '101', lnId: '南迴線' });
  addTrip(w.db, { actor: 'device-c2b', trainNo: '102', lnId: '臺東線' });
  addTrip(w.db, { actor: 'device-c2c', trainNo: '103', lnId: '北迴線' });
  await w.cron();
  ok('C2 [驗收5] 南迴 ok 趟 +2、臺東線 +2、北迴線 +1',
    q.chips(w.db, 'device-c2a') === 2 && q.chips(w.db, 'device-c2b') === 2 && q.chips(w.db, 'device-c2c') === 1,
    JSON.stringify({ nanhui: q.chips(w.db, 'device-c2a'), taitung: q.chips(w.db, 'device-c2b'), beihui: q.chips(w.db, 'device-c2c') }));
});
// C3 599 秒 ok 趟 → 0；剛好 600 秒 → 1（durationSec＝t 的 max−min，兩側邊界都要有）
await attempt('C3', async () => {
  const w = world();
  addTrip(w.db, { actor: 'device-c3a', trainNo: '101', lnId: '山線', durationSec: 599 });
  addTrip(w.db, { actor: 'device-c3b', trainNo: '102', lnId: '山線', durationSec: 600 });
  await w.cron();
  ok('C3a [驗收5] 599 秒的 ok 趟：判定 ok、帳本 0（未滿 10 分鐘）', q.verdicts(w.db, 'device-c3a') === 'ok' && q.ledger(w.db, 'device-c3a').length === 0,
    JSON.stringify({ v: q.verdicts(w.db, 'device-c3a'), n: q.ledger(w.db, 'device-c3a').length }));
  ok('C3b 剛好 600 秒的 ok 趟：帳本 +1（門檻是 ≥600，不是 >600）', q.verdicts(w.db, 'device-c3b') === 'ok' && q.chips(w.db, 'device-c3b') === 1,
    JSON.stringify({ v: q.verdicts(w.db, 'device-c3b'), c: q.chips(w.db, 'device-c3b') }));
});
// C4 每日上限（驗收 6）：同一天 5 趟一般 ok → 合計 4；再來一趟南迴 → 仍 4；隔天 → 重新可得
await attempt('C4', async () => {
  const w = world();
  const a = 'device-c4a';
  const got = [];
  for (const n of ['101', '102', '103', '104', '105']) { addTrip(w.db, { actor: a, trainNo: n, lnId: '山線' }); await w.cron(); got.push(q.chips(w.db, a, TRIP_DATE)); }
  addTrip(w.db, { actor: a, trainNo: '106', lnId: '南迴線' }); await w.cron();
  const afterRemote = q.chips(w.db, a, TRIP_DATE);
  addTrip(w.db, { actor: a, trainNo: '107', lnId: '山線', date: NEXT_DATE }); await w.cron();
  ok('C4a [驗收6] 同一天 5 趟一般 ok：累計 1、2、3、4、4（第 5 趟被上限擋下，帳本合計 4）', JSON.stringify(got) === '[1,2,3,4,4]', JSON.stringify(got));
  ok('C4b [驗收6] 已滿 4 之後再來一趟南迴（×2）→ 仍是 4', afterRemote === 4, String(afterRemote));
  ok('C4c [驗收6] 隔天（07-29）重新可得：+1；前一天的 4 不動', q.chips(w.db, a, NEXT_DATE) === 1 && q.chips(w.db, a, TRIP_DATE) === 4,
    JSON.stringify({ next: q.chips(w.db, a, NEXT_DATE), prev: q.chips(w.db, a, TRIP_DATE) }));
  ok('C4d 第 5、6 趟都判成 ok（前提：0 是被上限擋下，不是判壞了）', q.verdicts(w.db, a) === 'ok');
});
await attempt('C4e', async () => {
  const w = world();
  const a = 'device-c4e';
  for (const n of ['101', '102', '103']) { addTrip(w.db, { actor: a, trainNo: n, lnId: '山線' }); await w.cron(); }
  const before = q.chips(w.db, a, TRIP_DATE);
  addTrip(w.db, { actor: a, trainNo: '104', lnId: '南迴線' }); const st = await w.cron();
  const L = q.ledger(w.db, a);
  ok('C4e [驗收6] 已得 3 時來一趟南迴（原本 +2）→ 只入 1，合計 4', before === 3 && q.chips(w.db, a, TRIP_DATE) === 4 &&
    L[L.length - 1].delta === 1 && st.chips === 1, JSON.stringify({ before, after: q.chips(w.db, a, TRIP_DATE), last: L[L.length - 1], st: st.chips }));
});
// C4f 每日上限只數 kind='trip'：同一天已有的雲端搭乘（cloud）、之前花掉的兌換（redeem，負數）都不占 trip 的額度
await attempt('C4f', async () => {
  const a = 'device-c4f';
  const w = world({ seed: `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES
    ('seed-cloud','${a}','cloud',1,'seed-cloud-ref','${TRIP_DATE}',1),
    ('seed-redeem','${a}','redeem',-4,'seed-redeem-ref','${TRIP_DATE}',1);` });
  for (const n of ['101', '102', '103', '104', '105']) { addTrip(w.db, { actor: a, trainNo: n, lnId: '山線' }); await w.cron(); }
  const trip = q.chips(w.db, a, TRIP_DATE);
  ok('C4f 同一天另有 cloud +1、redeem −4 時，trip 仍可拿滿 4（上限只數 kind=trip，不是整本帳）', trip === 4, String(trip));
});
// C4g 每日上限是每個人各自的：另一位同一天已拿滿 4，這一位的第一趟仍是 +1（上限的 SUM 要綁 actor）
await attempt('C4g', async () => {
  const w = world();
  for (const n of ['101', '102', '103', '104']) addTrip(w.db, { actor: 'device-c4g-full', trainNo: n, lnId: '山線' });
  addTrip(w.db, { actor: 'device-c4g-new', trainNo: '201', lnId: '山線' });
  await w.cron();
  ok('C4g 別人同一天已拿滿 4 → 這一位的第一趟仍 +1（不是被別人的額度擋掉）；那位滿的維持 4',
    q.chips(w.db, 'device-c4g-full', TRIP_DATE) === 4 && q.chips(w.db, 'device-c4g-new', TRIP_DATE) === 1,
    JSON.stringify({ full: q.chips(w.db, 'device-c4g-full', TRIP_DATE), fresh: q.chips(w.db, 'device-c4g-new', TRIP_DATE) }));
});
// C5 cron 重跑同一批 → 帳本不重複、去重人數不重複算（驗收 7）。重跑的做法：把已判定的樣本改回 pending 再跑一次。
await attempt('C5', async () => {
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{}]) });
  addTrip(w.db, { actor: 'device-c5a', trainNo: '101', lnId: '南迴線' });
  addTrip(w.db, { actor: 'device-c5b', trainNo: '102', lnId: '南迴線' });
  await w.cron();
  const snap = () => JSON.stringify({
    ledger: w.db.prepare('SELECT id,actor,kind,delta,ref,day FROM chip_ledger ORDER BY id').all(),
    contrib: w.db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib').get().c,
    distinct: w.db.prepare('SELECT seg_key, distinct_ok_users d FROM bounty_board ORDER BY seg_key').all().map(r => r.d).join(),
  });
  const first = snap();
  w.db.exec("UPDATE bounty_samples SET verdict='pending', verdict_at=NULL, segs=NULL");
  const st2 = await w.cron(NOW_MS + 3600e3);
  const second = snap();
  const nLedger = JSON.parse(first).ledger.length;
  ok('C5 [驗收7] 同一批樣本重判一次：帳本列數與內容、contrib 列數、每段 distinct_ok_users 完全不變，且重判確實發生過（st2.trips=2）',
    nLedger === 2 && first === second && st2.trips === 2 && st2.chips === 0, JSON.stringify({ nLedger, st2, same: first === second }));
});
// C6 simulator（驗收 8）：走完整條路徑（POST → D1 → cron）。判定照跑、樣本照收、contrib 照進（我的選擇，見檔尾說明）、帳本 0。
await attempt('C6', async () => {
  const w = world({ seed: boardSql('tra_sched', '南迴線', [{}]) });
  const SIM = { platform: 'ios', app: '1.6.13', simulator: true };
  const rs = await submitTrip(w, { actor: 'device-sim1', trainNo: '101', client: SIM });
  await submitTrip(w, { actor: 'device-real', trainNo: '102' });
  await w.cron();
  const nSamples = w.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE actor='device-sim1'").get().c;
  const stored = JSON.parse(w.db.prepare("SELECT client FROM bounty_samples WHERE actor='device-sim1'").get().client);
  ok('C6a [驗收8] simulator:true 的趟：每一批都收下（200）、client.simulator 存進 D1', rs.every(r => r.status === 200) && nSamples === rs.length && stored.simulator === true,
    JSON.stringify({ statuses: rs.map(r => r.status), nSamples, stored }));
  ok('C6b [驗收8] 判定照跑＝ok；帳本 0 列', q.verdicts(w.db, 'device-sim1') === 'ok' && q.ledger(w.db, 'device-sim1').length === 0,
    JSON.stringify({ v: q.verdicts(w.db, 'device-sim1'), n: q.ledger(w.db, 'device-sim1').length }));
  ok('C6c [驗收8 對照] 同樣的趟、simulator:false 的另一位 → 帳本 2 籌碼（南迴 ×2；0 不是因為整條路壞了）', q.chips(w.db, 'device-real') === 2, String(q.chips(w.db, 'device-real')));
  ok('C6d [驗收8] 我的選擇：simulator 的 ok 趟 contrib 照進（7 段），distinct_ok_users 兩位（模擬器＋真機）',
    q.contribAll(w.db, 'device-sim1') === 7 && q.board(w.db, K('S0|S1'))[0].distinct_ok_users === 2,
    JSON.stringify({ contrib: q.contribAll(w.db, 'device-sim1'), board: q.board(w.db, K('S0|S1'))[0] }));
});
// C6e 任何一批自報模擬器，整趟就不入帳（一趟有很多批，不能靠「混一批真機」洗掉旗標）
await attempt('C6e', async () => {
  const w = world();
  addTrip(w.db, { actor: 'device-mix', trainNo: '101', lnId: '山線', clients: [APP, { ...APP, simulator: true }, APP, APP] });
  await w.cron();
  ok('C6e 一趟四批裡只有一批自報 simulator:true → 整趟 ok、帳本 0', q.verdicts(w.db, 'device-mix') === 'ok' && q.ledger(w.db, 'device-mix').length === 0,
    JSON.stringify({ v: q.verdicts(w.db, 'device-mix'), n: q.ledger(w.db, 'device-mix').length }));
});
// C6f 舊列（client 欄是 NULL：0014 之前寫入的、或直接寫入的測試列）視為「不是模擬器」，照常入帳
await attempt('C6f', async () => {
  const w = world();
  addTrip(w.db, { actor: 'device-old', trainNo: '101', lnId: '山線', client: null });
  await w.cron();
  ok('C6f client 為 NULL 的舊列：不是模擬器，照常 +1', q.chips(w.db, 'device-old') === 1, String(q.chips(w.db, 'device-old')));
});
// C6g client 欄是壞掉的 JSON（寫入端只存 sanitizeClient 的結果，正常不會發生；直接動 D1 的人才做得出來）：
// 不能讓整支 cron 掛掉——那會讓所有人的判定卡在 pending。視為「不是模擬器」，照常入帳。
await attempt('C6g', async () => {
  const w = world();
  addTrip(w.db, { actor: 'device-bad', trainNo: '101', lnId: '山線', clientRaw: '{not json' });
  addTrip(w.db, { actor: 'device-fine', trainNo: '102', lnId: '山線' });
  await w.cron();
  ok('C6g client 欄是壞掉的 JSON：cron 不掛、當「不是模擬器」處理（兩位各 +1）；正常那位不受影響',
    q.chips(w.db, 'device-bad') === 1 && q.chips(w.db, 'device-fine') === 1 && q.verdicts(w.db, 'device-bad') === 'ok',
    JSON.stringify({ bad: q.chips(w.db, 'device-bad'), fine: q.chips(w.db, 'device-fine') }));
});
// C7 與看板有沒有這一段無關（驗收 9）：板上完全沒有該段單位、或該段已收滿下架，ok 趟照樣 +1
await attempt('C7', async () => {
  const empty = world();                                                           // 板是空的
  addTrip(empty.db, { actor: 'device-c7a', trainNo: '101', lnId: '山線' });
  await empty.cron();
  const full = world({ seed: boardSql('tra_sched', '山線', [{ covered: 1700000000000, distinct: 50, sampleCount: 50 }]) });   // 整條線都收滿了
  addTrip(full.db, { actor: 'device-c7b', trainNo: '101', lnId: '山線' });
  await full.cron();
  const boardRows = empty.db.prepare('SELECT COUNT(*) c FROM bounty_board').get().c;
  ok('C7a [驗收9] 板上完全沒有任何單位（bounty_board 0 列）：ok 趟照樣 +1 籌碼', boardRows === 0 && q.chips(empty.db, 'device-c7a') === 1,
    JSON.stringify({ boardRows, chips: q.chips(empty.db, 'device-c7a') }));
  ok('C7b [驗收9] 該段已收滿下架（covered_at 有值）：ok 趟照樣 +1 籌碼', q.verdicts(full.db, 'device-c7b') === 'ok' && q.chips(full.db, 'device-c7b') === 1,
    JSON.stringify({ v: q.verdicts(full.db, 'device-c7b'), chips: q.chips(full.db, 'device-c7b') }));
});
// C8 高鐵（一般 ×1）與跨日的 day 歸屬
await attempt('C8', async () => {
  const w = world();
  addTrip(w.db, { actor: 'device-c8', trainNo: '801', sys: 'thsr_sched', lnId: 'THSR' });
  await w.cron();
  ok('C8 高鐵 ok 趟 +1（thsr_sched|THSR 不在 remoteLines）', q.chips(w.db, 'device-c8') === 1, String(q.chips(w.db, 'device-c8')));
});

// ═══ S 組：送交端 ══════════════════════════════════════════════════════════
const BASE = { actor: 'device-s01', sys: 'tra_sched', lnId: '南迴線', trainNo: '312', dir: 0, tripDate: TRIP_DATE, batch: 1,
  samples: [{ d: 1000, t: 30000, v: 25, acc: 8 }, { d: 1025, t: 30001, v: 25.1, acc: 9 }] };
const nSamples = db => db.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c;
await attempt('S1', async () => {
  const w = world();
  const none = await w.submit({ ...BASE });
  const web = await w.submit({ ...BASE, client: { platform: 'web', app: 'x', simulator: false } });
  const bad = [];
  for (const c of [null, 'ios', ['ios'], {}, { platform: 'IOS' }, { platform: 'windows' }, { app: '1.6.13' }, { platform: null }])
    bad.push((await w.submit({ ...BASE, client: c })).status);
  const bn = await none.json(), bw = await web.json();
  ok('S1a [驗收10] 沒帶 client → 400 app_only、零寫入', none.status === 400 && bn.error === 'app_only' && nSamples(w.db) === 0, JSON.stringify({ s: none.status, bn, n: nSamples(w.db) }));
  ok("S1b [驗收10] platform:'web' → 400 app_only、零寫入", web.status === 400 && bw.error === 'app_only' && nSamples(w.db) === 0, JSON.stringify({ s: web.status, bw }));
  ok('S1c 其他不合格的 client（null／字串／陣列／空物件／大小寫不對／不明平台／缺 platform）全部 400', bad.every(s => s === 400) && nSamples(w.db) === 0, JSON.stringify(bad));
  const okIos = await w.submit({ ...BASE, client: { platform: 'ios', app: '1.6.13', simulator: false } });
  const okAnd = await w.submit({ ...BASE, trainNo: '313', client: { platform: 'android', app: '1.6.13', simulator: false } });
  ok('S1d [驗收10 對照] platform 為 ios／android 都收（前面的 400 不是因為整條路壞了）', okIos.status === 200 && okAnd.status === 200 && nSamples(w.db) === 2,
    JSON.stringify({ ios: okIos.status, android: okAnd.status, n: nSamples(w.db) }));
});
await attempt('S2', async () => {
  const w = world();
  const body = { ...BASE, client: APP, requestId: 'req-s2-aaaa-0001' };
  const r1 = await w.submit(body), r2 = await w.submit(body);
  const b1 = await r1.json(), b2 = await r2.json();
  ok('S2a [驗收10] 同一個 requestId POST 兩次 → 兩次都 200、回應完全相同、bounty_samples 只有 1 列',
    r1.status === 200 && r2.status === 200 && JSON.stringify(b1) === JSON.stringify(b2) && b1.ok === true && b1.verdict === 'pending' &&
    b1.accepted === 2 && nSamples(w.db) === 1, JSON.stringify({ s: [r1.status, r2.status], b1, b2, n: nSamples(w.db) }));
  const r3 = await w.submit({ ...body, requestId: 'req-s2-aaaa-0002' });
  const b3 = await r3.json();
  ok('S2b [驗收10 對照] 換一個 requestId → 新的一列（去重押的是 requestId，不是「同一趟」）', r3.status === 200 && b3.id !== b1.id && nSamples(w.db) === 2,
    JSON.stringify({ s: r3.status, ids: [b1.id, b3.id], n: nSamples(w.db) }));
  const r4 = await w.submit({ ...body, actor: 'device-s02' });
  ok('S2c 同一個 requestId 換一位 actor → 各自一列（去重範圍是 actor＋requestId，別人不能用同一個字串蓋掉你的批次）', r4.status === 200 && nSamples(w.db) === 3,
    JSON.stringify({ s: r4.status, n: nSamples(w.db) }));
  const noReq1 = await w.submit({ ...BASE, client: APP, trainNo: '400' }), noReq2 = await w.submit({ ...BASE, client: APP, trainNo: '400' });
  const i1 = (await noReq1.json()).id, i2 = (await noReq2.json()).id;
  ok('S2d 沒帶 requestId 維持舊行為：同一批送兩次是兩列、id 各自隨機', noReq1.status === 200 && noReq2.status === 200 && i1 !== i2 && /^bs-/.test(i1) && nSamples(w.db) === 5,
    JSON.stringify({ i1, i2, n: nSamples(w.db) }));
  const rows = w.db.prepare("SELECT id FROM bounty_samples WHERE actor='device-s01' AND train_no='312'").all().map(r => r.id);
  ok('S2e 有 requestId 的列，id 是確定值（重送才對得上）而且帶 requestId 本身', rows.some(id => id.includes('req-s2-aaaa-0001')), JSON.stringify(rows));
});
// S3 重送要在每日額度之前認出來：額度剛好滿的那一刻重送「已經收下」的那一批，不可以被 429 擋掉
await attempt('S3', async () => {
  const filler = Array.from({ length: 719 }, (_, i) =>
    `('q${i}','device-s03','tra_sched','南迴線','312',0,'${TRIP_DATE}','[]',1,'pending')`).join(',');
  const w = world({ seed: `INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,submitted_at,verdict) VALUES ${filler};` });
  const body = { ...BASE, actor: 'device-s03', client: APP, requestId: 'req-s3-aaaa-0720' };
  const last = await w.submit(body);                         // 第 720 批：額度剛好用完
  const retry = await w.submit(body);                        // 回應掉了，客戶端重送同一批
  const fresh = await w.submit({ ...body, requestId: 'req-s3-aaaa-0721' });
  const bf = await fresh.json();
  ok('S3 第 720 批收下、重送同一批仍是 200（不吃額度），全新的下一批才是 429 daily_quota；DB 共 720 列',
    last.status === 200 && retry.status === 200 && fresh.status === 429 && bf.error === 'daily_quota' && nSamples(w.db) === 720,
    JSON.stringify({ last: last.status, retry: retry.status, fresh: fresh.status, n: nSamples(w.db) }));
});
// S4 座標鍵照擋（驗收 10）：samples 裡、client 裡都要掃到；擋下就零寫入
await attempt('S4', async () => {
  const w = world();
  const inSamples = await w.submit({ ...BASE, client: APP, samples: [{ d: 1, t: 2, v: 3, acc: 4, lat: 25.04 }] });
  const inLng = await w.submit({ ...BASE, client: APP, samples: [{ d: 1, t: 2, v: 3, acc: 4, lng: 121.5 }] });
  const inClient = await w.submit({ ...BASE, client: { ...APP, latitude: 25.04 } });
  const inRoot = await w.submit({ ...BASE, client: APP, coords: { a: 1 } });
  const bs = await inSamples.json();
  ok('S4 [驗收10] 含 lat／lng 鍵（samples 裡、client 裡、最外層）→ 全部 400 coordinates_not_accepted、零寫入',
    [inSamples, inLng, inClient, inRoot].every(r => r.status === 400) && bs.error === 'coordinates_not_accepted' && nSamples(w.db) === 0,
    JSON.stringify([inSamples, inLng, inClient, inRoot].map(r => r.status)));
});
// S5 client 只存三個欄位；requestId 格式
await attempt('S5', async () => {
  const w = world();
  const r = await w.submit({ ...BASE, client: { platform: 'android', app: 'X'.repeat(50), simulator: 'true', deviceModel: 'Pixel', plus: true, plusActive: true }, plus: true });
  const st = JSON.parse(w.db.prepare('SELECT client FROM bounty_samples').get().client);
  ok('S5a client 只存 platform／app／simulator 三個欄位：其他鍵（deviceModel、plus…）丟掉、app 截到 32 字、"true" 字串不算模擬器',
    r.status === 200 && JSON.stringify(Object.keys(st).sort()) === '["app","platform","simulator"]' && st.app.length === 32 &&
    st.simulator === false && st.platform === 'android', JSON.stringify(st));
  const bads = [];
  for (const rid of ['short', 'has space here', '中文的請求編號12', 'x'.repeat(65), 12345678, '', 'a.b.c.d.e.f.g.h'])
    { const rr = await w.submit({ ...BASE, trainNo: '500', client: APP, requestId: rid }); bads.push(rr.status + ':' + (await rr.json()).error); }
  ok('S5b requestId 有帶但格式不對 → 400 bad_request_id（不是悄悄忽略、也不是收下），零新增', bads.every(x => x === '400:bad_request_id') && nSamples(w.db) === 1, JSON.stringify(bads));
  const rn = await w.submit({ ...BASE, trainNo: '501', client: APP, requestId: null });
  ok('S5c requestId 為 null 視同沒帶（舊行為：隨機 id）', rn.status === 200 && nSamples(w.db) === 2, String(rn.status));
});

// ═══ P 組：通行證沒有倍率（驗收 11）══════════════════════════════════════════
await attempt('P1', async () => {
  outbound.length = 0;
  const w = world();
  const flags = { plus: true, plusActive: true, plus_active: true, entitlements: { plus: true }, isPlus: true };
  const withPlus = await submitTrip(w, { actor: 'device-plus', trainNo: '101', lnId: '山線',
    client: { ...APP, plus: true, plusActive: true }, extra: flags });
  await submitTrip(w, { actor: 'device-free', trainNo: '101', lnId: '山線' });
  await submitTrip(w, { actor: 'device-plus', trainNo: '102', lnId: '南迴線', client: { ...APP, plusActive: true }, extra: flags });
  await submitTrip(w, { actor: 'device-free', trainNo: '102', lnId: '南迴線' });
  await w.cron();
  const shape = a => q.ledger(w.db, a).map(r => `${r.kind}:${r.delta}:${r.day}`).join('|');
  ok('P1a [驗收11] 帶 plus／plusActive 等旗標的請求都收下（旗標被無視，不是被擋）', withPlus.every(r => r.status === 200), JSON.stringify(withPlus.map(r => r.status)));
  ok('P1b [驗收11] 帶旗標與不帶旗標的兩位：帳本逐列相同（一般線 +1、南迴 +2，合計 3，沒有任何倍率）',
    shape('device-plus') === shape('device-free') && q.chips(w.db, 'device-plus') === 3 && q.chips(w.db, 'device-free') === 3,
    JSON.stringify({ plus: shape('device-plus'), free: shape('device-free') }));
  ok('P1d 整條路徑（送交＋判定＋籌碼入帳）沒有任何對外連線：籌碼沒有去查 RevenueCat／Firebase 的通行證資格', outbound.length === 0, JSON.stringify(outbound));
  const stored = w.db.prepare("SELECT client FROM bounty_samples WHERE actor='device-plus' LIMIT 1").get().client;
  ok('P1c 通行證旗標不會被存進 D1（client 只有三個欄位）', !/plus/i.test(stored), stored);
});

// ═══ E 組：設定缺漏的邊界 ════════════════════════════════════════════════════
await attempt('E1', async () => {
  const { chips, ...noChips } = RULES; void chips;
  const w = world({ rules: noChips });
  addTrip(w.db, { actor: 'device-e1', trainNo: '101', lnId: '山線' });
  let msg = '';
  try { await w.cron(); } catch (e) { msg = String(e.message || e); }
  const pending = w.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c;
  ok('E1 設定檔沒有 chips → cron 整支中止（invalid bounty rule: chips），樣本仍是 pending，不會悄悄改用預設值判完', /invalid bounty rule: chips/.test(msg) && pending > 0,
    JSON.stringify({ msg, pending }));
});
await attempt('E2', async () => {
  const { coverDistinct, ...legacy } = RULES; void coverDistinct;
  const w = world({ rules: legacy, seed: boardSql('tra_sched', '南迴線', [{}]) });
  addTrip(w.db, { actor: 'device-e2', trainNo: '101' });
  await w.cron();
  const b = q.board(w.db, K('S0|S1'))[0];
  ok('E2 設定檔還沒升 v2（沒有 coverDistinct）→ 退回舊行為：門檻取 coverN.TRA=1、比趟數，一趟就收滿；去重人數照樣記',
    b.covered_at === NOW_MS && b.sample_count === 1 && b.distinct_ok_users === 1, JSON.stringify(b));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
