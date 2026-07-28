// 懸賞四個端點的離線驗收。不起伺服器、不用 wrangler：直接呼叫 worker.js 導出的處理函式，
// D1 用 scripts/d1_local.mjs 的真 SQLite 替身（模式抄 scripts/verify_rate_limit.mjs）。
// 跑法：node scripts/verify_bounty_api.mjs
import { readFileSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

// Node 沒有全域 caches（Workers Cache API），worker.js 多個端點含 bountyBoard 都用
// caches.default——比照 verify_rate_limit.mjs／verify_usage_split.mjs／dev_server.mjs 的既有慣例補 mock。
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const body = async res => JSON.parse(await res.text());

// 節流替身：limit() 回 success:false 代表額度用完
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });
// ASSETS 替身：bountyRules() 讀 data/bounty_rules.json——與前端讀的是同一份實體檔。
const ASSETS = { fetch: async () => new Response(readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
const ENV = (DELAY_DB, over = {}) => ({ DELAY_DB, BOUNTY_LIMITER: limiter(false), ASSETS, ...over });

// 種子：兩條線、track 與 dwell 都有、一筆已收滿
const SEED = `
INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at) VALUES
 ('tra_sched|南迴線|大武|太麻里','tra_sched','自強',0,'track','',3,1,3,4,1700000000000,1700000000000,0,NULL),
 ('tra_sched|南迴線|大武|枋寮',  'tra_sched','自強',0,'track','',3,1,3,4,1700000000000,1700000000000,0,NULL),
 ('tra_sched|南迴線|大武|太麻里','tra_sched','自強',1,'track','',3,1,3,4,1700000000000,1700000000000,0,NULL),
 ('tra_sched|縱貫線北段|七堵|臺北',  'tra_sched','區間',0,'track','',1,1,1,60,1700000000000,1700000000000,1,1700000900000),
 ('tra_sched|南迴線|臺東|臺東',  'tra_sched','自強',0,'dwell','peak',3,1,3,4,1700000000000,1700000000000,0,NULL);
INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES
 ('c1|0','dev-a','tra_sched|南迴線|大武|太麻里','自強',0,'track','',3,1700000000000,1799999999999,'open'),
 ('c2|0','dev-b','tra_sched|南迴線|大武|太麻里','自強',0,'track','',3,1700000000000,1700000000001,'open');
`;

// ── A 組：GET /api/bounty-board ───────────────────────────────────────────
{
  const { groupBoardRows, bountyCardId, bountySegLine } = _bounty;

  // A1 純函式分組：判準由測試自己算，不呼叫實作的聚合
  const rows = [
    { seg_key: 'tra_sched|南迴線|大武|太麻里', sys: 'tra_sched', train_kind: '自強', dir: 0, kind: 'track', slot: '', points: 3, sample_count: 0 },
    { seg_key: 'tra_sched|南迴線|大武|枋寮', sys: 'tra_sched', train_kind: '自強', dir: 0, kind: 'track', slot: '', points: 3, sample_count: 0 },
    { seg_key: 'tra_sched|南迴線|大武|太麻里', sys: 'tra_sched', train_kind: '自強', dir: 1, kind: 'track', slot: '', points: 3, sample_count: 0 },
  ];
  const cards = groupBoardRows(rows, new Map([['tra_sched|南迴線|大武|太麻里|自強|0|track|', 2]]), { TRA: 1, THSR: 1, metro: 3 });
  const dir0 = cards.find(c => c.dir === 0), dir1 = cards.find(c => c.dir === 1);
  ok('A1 依 (sys,lnId,dir,trainKind,kind,slot) 分組成兩張卡', cards.length === 2, JSON.stringify(cards.map(c => c.id)));
  ok('A2 dir0 卡有 2 個單位、6 點（3+3，測試自己加的）', dir0 && dir0.units === 2 && dir0.points === 6, JSON.stringify(dir0));
  ok('A3 dir1 卡有 1 個單位、3 點', dir1 && dir1.units === 1 && dir1.points === 3, JSON.stringify(dir1));
  ok('A4 cardId 六段', bountyCardId(rows[0]) === 'tra_sched|南迴線|0|自強|track|', bountyCardId(rows[0]));
  ok('A5 dwell 鍵解得出 isDwell', bountySegLine('tra_sched|南迴線|臺東|臺東').isDwell === true && bountySegLine('tra_sched|南迴線|大武|枋寮').isDwell === false);
  ok('A6 claimers 取自傳入的計數，不是自己去查 D1', dir0 && dir0.claimers === 2, JSON.stringify(dir0));

  // A7–A10 端點層
  const { DELAY_DB } = openTestDb(SEED);
  const res = await _bounty.bountyBoard(req('/api/bounty-board'), ENV(DELAY_DB));
  const b = await body(res);
  ok('A7 回 200 且有 cards', res.status === 200 && Array.isArray(b.cards), String(res.status));
  ok('A8 已收滿的 track 單位不在板上', !b.cards.some(c => c.unitKeys.includes('tra_sched|縱貫線北段|七堵|臺北')),
    JSON.stringify(b.cards.map(c => c.id)));
  ok('A9 收滿的 dwell 仍在板上（規格 §4：停站點留著、獎勵衰減但不歸零）',
    b.cards.some(c => c.kind === 'dwell'), JSON.stringify(b.cards.map(c => c.id)));
  // A10 過期的 claim 不算人數：種子裡 c2 的 expires_at 已過
  const nh0 = b.cards.find(c => c.id === 'tra_sched|南迴線|0|自強|track|');
  ok('A10 過期的認領不計入 claimers（應為 1 不是 2）', nh0 && nh0.claimers === 1, JSON.stringify(nh0));
  ok('A11 回應帶 coverN 供前端顯示「已有 1/3 趟」', b.coverN && b.coverN.metro === 3, JSON.stringify(b.coverN));
}

// ── B 組：POST /api/bounty-claim ──────────────────────────────────────────
// 🔴 actor 字面值已從 brief 原文的 'dev-x'/'dev-y'/'dev-old'（5/5/7 碼）訂正為
// 'device-x'/'device-y'/'device-old'（8/8/10 碼）：Step 4 的 isActorId 正規表示式下限是
// {8,64}，brief 原文的短助記字串短於下限，逐字照抄會讓 B2/B4/B6/B7/B9 全部卡在 400 bad_actor，
// 測不到真正要驗的情境（B1 因節流檢查在 isActorId 之前短路不受影響；B8 的四個髒輸入案例無論
// actor 長度為何都預期 400，不受影響，但放著不修會讓 B8 變成掩蓋 B2 等真實失敗的巧合通過）。
// 8/8/10 碼與正式環境實測的 actor 長度吻合（index.html:5616 userDataDeviceId()：
// crypto.randomUUID() 36 碼／回退格式 20+ 碼／保底 'ephemeral' 9 碼，三條路徑全部 ≥9 碼）。
// SEED 常數裡的 'dev-a'／'dev-b'（Task 2 既有、直接寫入 D1 的認領列）不受影響——那兩個從未經過
// isActorId（不是任何 B 組測試呼叫 bountyClaim() 時傳入的 b.actor）。B9 的 'uid-1' 也不變——
// 它是 resolveActor 查表後的內部值，同樣從未經過 isActorId。
{
  const { bountyClaim } = _bounty;
  const post = (b, over) => req('/api/bounty-claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...(over || {}) },
    body: JSON.stringify(b),
  });

  // B1 節流擋在任何 D1 寫入之前（判準是「有沒有寫進去」，不是「回不回 429」）
  {
    const { db, DELAY_DB } = openTestDb(SEED);
    const r = await bountyClaim(post({ actor: 'device-x', cardId: 'tra_sched|南迴線|0|自強|track|' }),
      ENV(DELAY_DB, { BOUNTY_LIMITER: limiter(true) }));
    const n = db.prepare('SELECT COUNT(*) c FROM bounty_claims').get().c;
    ok('B1 被節流時回 429 且一列都沒寫進 D1', r.status === 429 && n === 2, `status=${r.status} rows=${n}`);
  }

  // B2 正常認領：把卡展開成單位、鎖當時的點數
  const { db, DELAY_DB } = openTestDb(SEED);
  const r2 = await bountyClaim(post({ actor: 'device-x', cardId: 'tra_sched|南迴線|0|自強|track|' }), ENV(DELAY_DB));
  const b2 = await body(r2);
  ok('B2 回 200、2 個單位、鎖 6 點（測試自己加：3+3）',
    r2.status === 200 && b2.units === 2 && b2.pointsLocked === 6, JSON.stringify(b2));
  ok('B3 24 小時後過期', Math.abs((b2.expiresAt - Date.now()) - 86400000) < 5000, String(b2.expiresAt));

  // B4 鎖價不獨佔：第二個人接同一張卡照樣成功
  const r4 = await bountyClaim(post({ actor: 'device-y', cardId: 'tra_sched|南迴線|0|自強|track|' }), ENV(DELAY_DB));
  const b4 = await body(r4);
  ok('B4 第二人接同一張卡照樣成功（鎖價不鎖獨佔）', r4.status === 200 && b4.units === 2, JSON.stringify(b4));
  ok('B5 回傳「已有 N 人接了這段」', b4.claimers >= 2, String(b4.claimers));

  // B6 鎖價真的鎖住：板上漲價之後，先接的那筆 points_locked 不動
  db.exec("UPDATE bounty_board SET points=99 WHERE seg_key='tra_sched|南迴線|大武|太麻里'");
  const locked = db.prepare("SELECT points_locked FROM bounty_claims WHERE actor='device-x' AND seg_key='tra_sched|南迴線|大武|太麻里'").get();
  ok('B6 事後漲價不影響已鎖的價', locked && locked.points_locked === 3, JSON.stringify(locked));

  // B7 已收滿的 track 單位不可認領
  const r7 = await bountyClaim(post({ actor: 'device-x', cardId: 'tra_sched|縱貫線北段|0|區間|track|' }), ENV(DELAY_DB));
  ok('B7 已收滿的卡回 404', r7.status === 404, String(r7.status));

  // B8 髒輸入不打 D1
  for (const bad of [{ actor: 'device-x' }, { cardId: 'tra_sched|南迴線|0|自強|track|' }, { actor: '../../etc', cardId: 'tra_sched|南迴線|0|自強|track|' },
    { actor: 'device-x', cardId: 'not-a-card' }]) {
    const rr = await bountyClaim(post(bad), ENV(DELAY_DB));
    ok('B8 髒輸入回 400 — ' + JSON.stringify(bad), rr.status === 400, String(rr.status));
  }

  // B9 resolveActor：合併過的 device token 寫入要轉向 uid
  {
    const { DELAY_DB: DB2, db: db2 } = openTestDb(SEED + `
      INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('device-old',NULL,0,'uid-1',1700000000000);
      INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('uid-1','uid-1',5,NULL,1700000000000);`);
    await bountyClaim(post({ actor: 'device-old', cardId: 'tra_sched|南迴線|0|自強|track|' }), ENV(DB2));
    const who = db2.prepare("SELECT DISTINCT actor FROM bounty_claims WHERE seg_key='tra_sched|南迴線|大武|枋寮'").all().map(x => x.actor);
    ok('B9 合併過的 token 認領記在 uid 名下', who.includes('uid-1') && !who.includes('device-old'), who.join(','));
  }
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
