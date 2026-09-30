// 路段懸賞 v2 後端驗收（四）：登入合併 POST /api/bounty-merge 與刪帳號 bountyPurgeUid 對 v2 四張表的處理（A-T7／T2／T3）。
// 四張表＝chip_ledger（籌碼帳本）／garage_unlocks（車庫解鎖）／cloud_rides（雲端搭乘）／bounty_seg_contrib（每段去重貢獻）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ Firebase 替身；不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_merge.mjs
//
// 期望值全部寫死在這裡，不呼叫實作去產生期望。來源：
//   ・使用者原話（09-29，逐字）：「第一座4 後面都8 我不怕大家開的快」「捷運不用懸賞」「1跟2照你建議」。
//   ・其餘（併帳號時較晚那份解鎖退款、撞天的雲端搭乘留一筆、撞段的去重人數減 1、不追討）來自主對話派工單的判讀，不是使用者逐字說的。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準（突變表在回報裡）。
//
// ⚠️ 假 D1 的保真度（稽核 F20）：scripts/d1_local.mjs 的 batch() 是排隊序列化的，但 batch 之外的單句寫入
//    可以插進另一個 batch 的交易中間；真的 D1 不會這樣。所以下面「兩個併發的請求」這類判準只證明「序列化之後的
//    各種交錯」是安全的，證明不了真 D1 的行為。上線後要對正式庫做一次唯讀抽查（重複的退款列、對不上的 nth、
//    被減兩次的 distinct_ok_users）。
//
// 稽核修補（身分與授權）之後，這支腳本讀「已併進帳號的裝置／帳號本人」的錢包一律帶 Bearer（helper：bearer()／meAs()），
// 原本不帶 token 也讀得到、花得掉的那幾條判準是被修掉的洞本身，已改成新行為（每一處都標了「稽核 F3／F2 改寫」）。
// 身分規則本身的驗收在 scripts/verify_bounty_auth.mjs。
//
// 分組：M 合併（M1 餘額與解鎖　M2 撞座退款與重排　M3 撞天雲端搭乘　M4 撞段去重人數　M5 冪等與併發　M6 沒有點數列的裝置
//       M7 已併進別人的 token 不搬　M8 合併後的雲端籌碼結算　M10 授權　M11 單一 batch　M12 每日上限不回溯
//       M13 首位校正者與撞段時的首次時間）
//       P 刪帳號（M9）
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(new URL('../worker.js', import.meta.url))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// Firebase 替身：驗過 token 會回 firebaseUid（null＝Firebase 說 token 無效）。這支腳本唯一允許的對外連線就是這個端點。
let firebaseUid = 'uid-merge-0001';
const fetchCalls = [];
globalThis.fetch = async (u) => {
  fetchCalls.push(String(u));
  if (!String(u).includes('identitytoolkit.googleapis.com')) throw new Error('offline: ' + String(u));
  return firebaseUid ? new Response(JSON.stringify({ users: [{ localId: firebaseUid }] }), { status: 200 }) : new Response('{}', { status: 400 });
};

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const same = (a, b) => canon(a) === canon(b);

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T08:00:00Z');          // 台北 2026-07-29 16:00
const TODAY = '2026-07-29', YESTERDAY = '2026-07-28';
const t0 = day => Date.parse(day + 'T00:00:00Z') - 8 * 3600e3;
const at = (day, h, m = 0) => t0(day) + (h * 60 + m) * 60000;
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });
const UID = 'uid-merge-0001', DEV = 'dev-merge-0001', OTHER = 'uid-other-0001';

function world(over = {}) {
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const w = { db, DB: DELAY_DB };
  const ASSETS = { fetch: async r => String(r.url).endsWith('bounty_rules.json')
    ? new Response(JSON.stringify(RULES), { status: 200 }) : new Response('nf', { status: 404 }) };
  w.env = { DELAY_DB: over.db || DELAY_DB, ASSETS, FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(false), DELETE_LIMITER: limiter(false),
    BOUNTY_LIMITER: limiter(false), BOUNTY_NOW: String(over.now || NOW_MS), ...(over.env || {}) };
  w.at = ms => { w.env.BOUNTY_NOW = String(ms); };
  return w;
}
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
async function fin(res) { const text = await res.text(); return { status: res.status, text, json: parse(text) }; }
const postTo = (path, b, hdr = {}) => req(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr },
  body: typeof b === 'string' ? b : JSON.stringify(b) });
const merge = async (w, dev = DEV, uid = UID, hdr = { Authorization: 'Bearer t' }) => {
  firebaseUid = uid;
  return fin(await _bounty.bountyMerge(postTo('/api/bounty-merge', { actor: dev }, hdr), w.env));
};
const me = async (w, actor) => { _bounty.bountyResetMemCaches(); return fin(await _bounty.chipsMe(req('/api/chips-me?actor=' + actor), w.env)); };
// 帶 Bearer 的錢包讀取／搭乘：帳號（uid）與已併進帳號的裝置，讀餘額、送雲端搭乘都必須帶該帳號的 Bearer（稽核 F3）。
// firebaseUid 是這支腳本的 Firebase 替身要回的 uid，所以取 Bearer 的同時把它設成這一位。
const bearer = (uid = UID) => { firebaseUid = uid; return { Authorization: 'Bearer t' }; };
const meAs = async (w, uid = UID, query = '') => { _bounty.bountyResetMemCaches(); return fin(await _bounty.chipsMe(req('/api/chips-me' + query, { headers: bearer(uid) }), w.env)); };
let rid = 0;
const nextReq = () => 'req-' + String(++rid).padStart(6, '0');
const cloud = async (w, o, hdr = {}) => { _bounty.bountyResetMemCaches(); return fin(await _bounty.cloudRide(postTo('/api/cloud-ride', {
  actor: UID, day: TODAY, trainKey: 'mrt|BR|veh-0001', startedAt: at(TODAY, 9), sec: 600, requestId: nextReq(), client: APP, ...o }, hdr), w.env)); };

// ── 種子與讀庫（一律自己寫 SQL）────────────────────────────────────────────────
const S = {
  ledger: (w, actor, kind, delta, ref, day = null, atMs = 1000) => w.db.prepare('INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(`${kind}|${ref}`, actor, kind, delta, ref, day, atMs),
  unlock: (w, actor, scene, nth, cost, atMs) => w.db.prepare('INSERT INTO garage_unlocks (actor,scene,nth,cost,created_at) VALUES (?,?,?,?,?)').run(actor, scene, nth, cost, atMs),
  ride: (w, actor, day, o = {}) => w.db.prepare('INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at,simulator) VALUES (?,?,?,?,?,?,?)')
    .run(actor, day, o.trainKey || 'mrt|BR|seed', 700, o.requestId === undefined ? null : o.requestId, o.at ?? 1000, o.simulator ? 1 : 0),
  contrib: (w, seg, actor, atMs = 1) => w.db.prepare('INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES (?,?,?)').run(seg, actor, atMs),
  board: (w, seg, o = {}) => w.db.prepare('INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,first_listed_at,covered_at,distinct_ok_users) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(seg, seg.split('|')[0], o.trainKind || '自強', o.dir ?? 0, 'track', '', 1, o.covered ?? null, o.distinct ?? 0),
  points: (w, actor, points = 0, mergedInto = null) => w.db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,NULL,?,?,1)').run(actor, points, mergedInto),
};
const q = {
  bal: (w, a) => w.db.prepare('SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=?').get(a).n,
  nLedger: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM chip_ledger WHERE actor=?').get(a).c,
  merges: (w, a) => w.db.prepare("SELECT actor,kind,delta,ref,day FROM chip_ledger WHERE actor=? AND kind='merge' ORDER BY ref").all(a).map(r => ({ ...r })),
  unlocks: (w, a) => w.db.prepare('SELECT scene,nth,cost,created_at FROM garage_unlocks WHERE actor=? ORDER BY nth').all(a).map(r => ({ ...r })),
  nUnlocks: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM garage_unlocks WHERE actor=?').get(a).c,
  rides: (w, a) => w.db.prepare('SELECT day,request_id,created_at,simulator FROM cloud_rides WHERE actor=? ORDER BY day').all(a).map(r => ({ ...r })),
  nRides: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM cloud_rides WHERE actor=?').get(a).c,
  contrib: (w, a) => w.db.prepare('SELECT seg_key FROM bounty_seg_contrib WHERE actor=? ORDER BY seg_key').all(a).map(r => r.seg_key),
  nContrib: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib WHERE actor=?').get(a).c,
  board: (w, seg) => w.db.prepare('SELECT train_kind,dir,distinct_ok_users d,covered_at c FROM bounty_board WHERE seg_key=? ORDER BY train_kind,dir').all(seg).map(r => ({ ...r })),
  point: (w, a) => { const r = w.db.prepare('SELECT points,merged_into FROM bounty_points WHERE actor=?').get(a); return r ? { ...r } : null; },
  all: w => canon({
    ledger: w.db.prepare('SELECT id,actor,kind,delta,ref,day FROM chip_ledger ORDER BY id').all().map(r => ({ ...r })),
    unlocks: w.db.prepare('SELECT * FROM garage_unlocks ORDER BY actor,scene').all().map(r => ({ ...r })),
    rides: w.db.prepare('SELECT * FROM cloud_rides ORDER BY actor,day').all().map(r => ({ ...r })),
    contrib: w.db.prepare('SELECT * FROM bounty_seg_contrib ORDER BY seg_key,actor').all().map(r => ({ ...r })),
    board: w.db.prepare('SELECT seg_key,train_kind,dir,distinct_ok_users,covered_at FROM bounty_board ORDER BY seg_key,train_kind,dir').all().map(r => ({ ...r })),
    points: w.db.prepare('SELECT actor,points,merged_into FROM bounty_points ORDER BY actor').all().map(r => ({ ...r })),
  }),
};

// ═══ M1：裝置有 5 個籌碼、uid 已用 4 個解鎖南迴——併完餘額是 5、解鎖仍是那一座 ═══════════════════════════════
await attempt('M1', async () => {
  const w = world();
  S.ledger(w, DEV, 'adjust', 5, 'm1-dev');
  S.ledger(w, UID, 'adjust', 4, 'm1-uid-adj'); S.ledger(w, UID, 'redeem', -4, 'm1-uid-red', null, 1500);
  S.unlock(w, UID, 'south-coast', 1, 4, 1500);
  const r = await merge(w);
  ok('M1a [驗收 B1] 回應 {ok:true, uid, points:0, merged:true}（裝置沒有點數列也算「這一次消化了它」）',
    r.status === 200 && same(r.json, { ok: true, uid: UID, points: 0, merged: true }), r.text);
  ok('M1b uid 的餘額＝自己的 0（+4−4）＋裝置的 5＝5；裝置名下帳本 0 列（整批改名，不是複製）', q.bal(w, UID) === 5 && q.nLedger(w, DEV) === 0 && q.nLedger(w, UID) === 3, `bal=${q.bal(w, UID)} dev=${q.nLedger(w, DEV)} uid=${q.nLedger(w, UID)}`);
  ok('M1c uid 的解鎖仍是南迴第 1 座、花 4（沒被動）', same(q.unlocks(w, UID), [{ scene: 'south-coast', nth: 1, cost: 4, created_at: 1500 }]), JSON.stringify(q.unlocks(w, UID)));
  const mu = await meAs(w, UID);
  ok('M1d chips-me（uid 本人帶自己的 Bearer）：balance 5、下一座 8（已解鎖 1 座，第 2 座的價）、unlocked 只有 south-coast',
    mu.status === 200 && mu.json.balance === 5 && mu.json.nextCost === 8 && mu.json.unlocked.length === 1 && mu.json.unlocked[0].scene === 'south-coast', mu.text);
  const md = await me(w, DEV);
  // 稽核 F3 改寫：舊版這裡是「舊 token 不帶任何憑證就看得到 uid 的帳（resolveActor 轉向）」——那正是被修掉的洞。
  ok('M1e [驗收 B7；稽核 F3 改寫] 已併進 uid 的舊 token 不帶 Bearer 查 chips-me → 401 auth_required，回應裡沒有任何餘額或解鎖',
    md.status === 401 && md.json && md.json.error === 'auth_required' && !('balance' in md.json) && !('unlocked' in md.json), md.text);
  const md2 = await meAs(w, UID, '?actor=' + DEV);
  ok('M1e2 [驗收 B7] uid 本人帶 Bearer、同時帶 ?actor=<舊 token>：Bearer 贏、?actor= 被無視，看到的是 uid 的帳（與 M1d 同一份）',
    md2.status === 200 && same(md2.json, mu.json), md2.text + ' vs ' + mu.text);
  ok('M1f 裝置在 bounty_points 有一列標記「併進 uid」、點數 0（沒有列的裝置由合併補一列當墓碑）',
    same(q.point(w, DEV), { points: 0, merged_into: UID }), JSON.stringify(q.point(w, DEV)));
});

// ═══ M2：兩邊解鎖同一座——留較早的一份、較晚那份的價格退回、其餘改名、nth 依時間重排 ═════════════════════════════
await attempt('M2a', async () => {
  // 裝置較晚：uid 南迴 @1000（第 1 座花 4）、裝置南迴 @2000（第 1 座花 4）→ 留 uid 的、退 4
  const w = world();
  S.ledger(w, UID, 'adjust', 10, 'a-uid'); S.ledger(w, UID, 'redeem', -4, 'a-uid-r');
  S.unlock(w, UID, 'south-coast', 1, 4, 1000);
  S.ledger(w, DEV, 'adjust', 10, 'a-dev'); S.ledger(w, DEV, 'redeem', -4, 'a-dev-r');
  S.unlock(w, DEV, 'south-coast', 1, 4, 2000);
  const r = await merge(w);
  ok('M2a [驗收 B2] 兩邊都解鎖南迴、裝置較晚：只剩 1 列（uid 的，created_at 1000、nth 1、cost 4）、裝置名下 0 列',
    r.status === 200 && same(q.unlocks(w, UID), [{ scene: 'south-coast', nth: 1, cost: 4, created_at: 1000 }]) && q.nUnlocks(w, DEV) === 0, JSON.stringify(q.unlocks(w, UID)));
  ok('M2a2 恰好一筆退款：kind=merge、delta＝+4（較晚那份的價）、ref＝merge|<裝置>|south-coast、掛在 uid 名下',
    same(q.merges(w, UID), [{ actor: UID, kind: 'merge', delta: 4, ref: `merge|${DEV}|south-coast`, day: null }]), JSON.stringify(q.merges(w, UID)));
  ok('M2a3 餘額＝uid 6＋裝置 6＋退款 4＝16', q.bal(w, UID) === 16, String(q.bal(w, UID)));
});
await attempt('M2b', async () => {
  // 裝置較早：uid 有 shifen@100（第 1 座 4）＋南迴@1000（第 2 座 8）；裝置有南迴@500（第 1 座 4）
  // → 南迴留裝置那份（較早）：cost 4、created_at 500；退 uid 那份較晚的 8；重排：shifen@100＝第 1、南迴@500＝第 2
  const w = world();
  S.ledger(w, UID, 'adjust', 20, 'b-uid'); S.ledger(w, UID, 'redeem', -4, 'b-uid-r1'); S.ledger(w, UID, 'redeem', -8, 'b-uid-r2');
  S.unlock(w, UID, 'shifen', 1, 4, 100); S.unlock(w, UID, 'south-coast', 2, 8, 1000);
  S.ledger(w, DEV, 'adjust', 6, 'b-dev'); S.ledger(w, DEV, 'redeem', -4, 'b-dev-r');
  S.unlock(w, DEV, 'south-coast', 1, 4, 500);
  await merge(w);
  ok('M2b 裝置較早：南迴留裝置那份（cost 4、created_at 500）、shifen@100 是第 1 座、南迴@500 重排成第 2 座；uid 較晚那份被刪',
    same(q.unlocks(w, UID), [{ scene: 'shifen', nth: 1, cost: 4, created_at: 100 }, { scene: 'south-coast', nth: 2, cost: 4, created_at: 500 }]) && q.nUnlocks(w, DEV) === 0,
    JSON.stringify(q.unlocks(w, UID)));
  ok('M2b2 退的是較晚那份（uid 的第 2 座花 8）不是保留那份：+8；餘額＝8＋2＋8＝18',
    same(q.merges(w, UID).map(x => x.delta), [8]) && q.bal(w, UID) === 18, JSON.stringify(q.merges(w, UID)) + ' bal=' + q.bal(w, UID));
});
await attempt('M2c', async () => {
  // 同一毫秒：平手留 uid 的（cost 8、nth 2），退裝置那份的價（4）
  const w = world();
  S.ledger(w, UID, 'adjust', 20, 'c-uid'); S.ledger(w, UID, 'redeem', -4, 'c-uid-r1'); S.ledger(w, UID, 'redeem', -8, 'c-uid-r2');
  S.unlock(w, UID, 'shifen', 1, 4, 100); S.unlock(w, UID, 'south-coast', 2, 8, 1000);
  S.ledger(w, DEV, 'adjust', 6, 'c-dev'); S.ledger(w, DEV, 'redeem', -4, 'c-dev-r');
  S.unlock(w, DEV, 'south-coast', 1, 4, 1000);
  await merge(w);
  ok('M2c 同一毫秒平手：留 uid 那份（cost 8）、退裝置那份的價 4',
    same(q.unlocks(w, UID), [{ scene: 'shifen', nth: 1, cost: 4, created_at: 100 }, { scene: 'south-coast', nth: 2, cost: 8, created_at: 1000 }]) &&
    same(q.merges(w, UID).map(x => x.delta), [4]), JSON.stringify(q.unlocks(w, UID)) + JSON.stringify(q.merges(w, UID)));
});
await attempt('M2d', async () => {
  // 沒有撞座：uid 有 shifen@100（1，4）、alishan@300（2，8）；裝置有 viaduct@200（1，4）→ 無退款；依時間重排 shifen 1、viaduct 2、alishan 3，cost 保留
  const w = world();
  S.unlock(w, UID, 'shifen', 1, 4, 100); S.unlock(w, UID, 'alishan', 2, 8, 300);
  S.unlock(w, DEV, 'viaduct', 1, 4, 200);
  await merge(w);
  ok('M2d 不撞座：依 created_at 重排成 shifen 1／viaduct 2／alishan 3，cost 各自保留（4／4／8），沒有退款',
    same(q.unlocks(w, UID), [{ scene: 'shifen', nth: 1, cost: 4, created_at: 100 }, { scene: 'viaduct', nth: 2, cost: 4, created_at: 200 }, { scene: 'alishan', nth: 3, cost: 8, created_at: 300 }]) &&
    q.merges(w, UID).length === 0 && q.nUnlocks(w, DEV) === 0, JSON.stringify(q.unlocks(w, UID)));
});

// ═══ M3：兩邊同一天都有雲端搭乘——留一筆（算次數的勝過模擬器的；同類留較早的；平手留 uid 的），其餘改名 ═══════════════════
await attempt('M3', async () => {
  const w = world();
  // 07-11：裝置較晚（uid 的較早，留 uid 的）；07-12：裝置較早（留裝置的）；07-13：平手（留 uid 的）；
  // 07-14：裝置是模擬器、較早，uid 是真機、較晚（真機勝）；07-15：uid 是模擬器、較早，裝置是真機、較晚（真機勝）；
  // 07-10：只有裝置有（改名）；07-16：只有 uid 有（不動）
  S.ride(w, UID, '2026-07-11', { at: 1000, requestId: 'uid-r11' }); S.ride(w, DEV, '2026-07-11', { at: 2000, requestId: 'dev-r11' });
  S.ride(w, UID, '2026-07-12', { at: 1000, requestId: 'uid-r12' }); S.ride(w, DEV, '2026-07-12', { at: 500, requestId: 'dev-r12' });
  S.ride(w, UID, '2026-07-13', { at: 1000, requestId: 'uid-r13' }); S.ride(w, DEV, '2026-07-13', { at: 1000, requestId: 'dev-r13' });
  S.ride(w, UID, '2026-07-14', { at: 900, requestId: 'uid-r14' }); S.ride(w, DEV, '2026-07-14', { at: 100, requestId: 'dev-r14', simulator: true });
  S.ride(w, UID, '2026-07-15', { at: 100, requestId: 'uid-r15', simulator: true }); S.ride(w, DEV, '2026-07-15', { at: 900, requestId: 'dev-r15' });
  S.ride(w, DEV, '2026-07-10', { at: 300, requestId: 'dev-r10' });
  S.ride(w, UID, '2026-07-16', { at: 400, requestId: 'uid-r16' });
  const r = await merge(w);
  const got = q.rides(w, UID).map(x => `${x.day.slice(5)}:${x.request_id}:${x.simulator}`);
  ok('M3a [驗收 B3] 撞天各留一筆、其餘改名：07-10 dev／07-11 uid（較早）／07-12 dev（較早）／07-13 uid（平手）／07-14 uid（真機勝模擬器）／07-15 dev（真機勝模擬器）／07-16 uid',
    r.status === 200 && same(got, ['07-10:dev-r10:0', '07-11:uid-r11:0', '07-12:dev-r12:0', '07-13:uid-r13:0', '07-14:uid-r14:0', '07-15:dev-r15:0', '07-16:uid-r16:0']) && q.nRides(w, DEV) === 0,
    JSON.stringify(got));
  const m = await meAs(w, UID);
  ok('M3b chips-me 的雲端次數＝留下來的非模擬器列數（7 列都是真機）→ rides 7、toNextChip 2', m.json.cloud.rides === 7 && m.json.cloud.toNextChip === 2, m.text);
});

// ═══ M4：兩邊貢獻過同一段——刪裝置那列、該段所有看板列的去重人數減 1（下限 0、收滿時間不動）；其餘改名 ═══════════════════
await attempt('M4', async () => {
  const w = world();
  const S1 = 'tra_sched|南迴線|大武|太麻里', S2 = 'tra_sched|南迴線|太麻里|金崙', S3 = 'tra_sched|南迴線|金崙|古庄', S4 = 'tra_sched|南迴線|古庄|知本';
  // S1：兩邊都貢獻、兩列看板（不同車種）各 5 人；S2：只有裝置；S3：兩邊都貢獻、已收滿（50 人、covered_at=12345）；S4：兩邊都貢獻但看板值已是 0（下限）
  S.board(w, S1, { trainKind: '自強', dir: 0, distinct: 5 }); S.board(w, S1, { trainKind: '區間', dir: 1, distinct: 5 });
  S.board(w, S2, { distinct: 3 });
  S.board(w, S3, { distinct: 50, covered: 12345 });
  S.board(w, S4, { distinct: 0 });
  S.contrib(w, S1, UID); S.contrib(w, S3, UID); S.contrib(w, S4, UID);
  S.contrib(w, S1, DEV); S.contrib(w, S2, DEV); S.contrib(w, S3, DEV); S.contrib(w, S4, DEV);
  await merge(w);
  ok('M4a [驗收 B4] 貢獻列：uid 名下 S1／S2／S3／S4 各一列（撞段的合成一列、S2 改名），裝置名下 0 列',
    same(q.contrib(w, UID), [S1, S2, S3, S4].sort()) && q.nContrib(w, DEV) === 0 && q.nContrib(w, UID) === 4, JSON.stringify(q.contrib(w, UID)));
  ok('M4b 撞段 S1：兩列看板的 distinct_ok_users 都減 1（5→4）', same(q.board(w, S1).map(x => x.d), [4, 4]), JSON.stringify(q.board(w, S1)));
  ok('M4c 沒撞的 S2 不減（3）', same(q.board(w, S2).map(x => x.d), [3]), JSON.stringify(q.board(w, S2)));
  ok('M4d 已收滿的 S3 減 1（50→49）但 covered_at 不動（12345）——「曾經收滿」是歷史事實', same(q.board(w, S3), [{ train_kind: '自強', dir: 0, d: 49, c: 12345 }]), JSON.stringify(q.board(w, S3)));
  ok('M4e 撞段但看板值已是 0：下限 0，不變成 −1', same(q.board(w, S4).map(x => x.d), [0]), JSON.stringify(q.board(w, S4)));
});

// ═══ M5：冪等與併發 ═══════════════════════════════════════════════════════════════════════════════════
const seedFull = (w) => {
  const S1 = 'tra_sched|南迴線|大武|太麻里';
  S.ledger(w, UID, 'adjust', 10, 'f-uid'); S.ledger(w, UID, 'redeem', -4, 'f-uid-r'); S.unlock(w, UID, 'south-coast', 1, 4, 1000);
  S.ledger(w, DEV, 'adjust', 10, 'f-dev'); S.ledger(w, DEV, 'redeem', -4, 'f-dev-r'); S.unlock(w, DEV, 'south-coast', 1, 4, 2000); S.unlock(w, DEV, 'shifen', 2, 8, 3000);
  S.ride(w, UID, '2026-07-11', { at: 1000, requestId: 'f-u11' }); S.ride(w, DEV, '2026-07-11', { at: 2000, requestId: 'f-d11' }); S.ride(w, DEV, '2026-07-12', { at: 2500, requestId: 'f-d12' });
  S.board(w, S1, { distinct: 5 }); S.contrib(w, S1, UID); S.contrib(w, S1, DEV);
  return S1;
};
await attempt('M5', async () => {
  const w = world();
  const S1 = seedFull(w);
  const r1 = await merge(w);
  const after1 = q.all(w);
  const r2 = await merge(w), r3 = await merge(w);
  ok('M5a [驗收 B5] 重跑合併：第一次 merged:true，第二、三次 merged:false（③ 已標記，什麼都不再搬）', r1.json.merged === true && r2.json.merged === false && r3.json.merged === false && r2.status === 200, [r1.text, r2.text, r3.text].join(' | '));
  ok('M5b [驗收 B5] 重跑後四張表、看板與餘額與第一次之後逐列相同（退款沒有再寫、去重人數沒有再減、nth 沒有再變）', q.all(w) === after1 && q.bal(w, UID) === 16 && q.board(w, S1)[0].d === 4,
    `bal=${q.bal(w, UID)} board=${JSON.stringify(q.board(w, S1))}`);
  // 併發：兩個同時抵達的合併——退款恰好一筆、去重人數恰好減 1
  const w2 = world();
  const T1 = seedFull(w2);
  const both = await Promise.all([merge(w2), merge(w2)]);
  ok('M5c 兩個併發的合併：退款恰好 1 筆（+4）、去重人數恰好減 1（5→4）、只有一個回報 merged:true、餘額 16',
    both.every(x => x.status === 200) && both.filter(x => x.json.merged === true).length === 1 && q.merges(w2, UID).length === 1 && q.board(w2, T1)[0].d === 4 && q.bal(w2, UID) === 16,
    JSON.stringify(both.map(x => x.json)) + ' merges=' + q.merges(w2, UID).length + ' d=' + q.board(w2, T1)[0].d + ' bal=' + q.bal(w2, UID));
});

// ═══ M6：沒有 bounty_points 列的裝置（只有籌碼／雲端搭乘）併完，舊 token 之後寫的東西也要落在 uid 名下 ════════════════════
await attempt('M6', async () => {
  const w = world();
  S.ledger(w, DEV, 'adjust', 3, 'm6-dev');
  S.ledger(w, UID, 'adjust', 2, 'm6-uid');           // uid 自己也有 2：合併後的 5 才分得出「看到 uid 的帳」與「只看到裝置自己的 3」
  ok('M6a [fixture] 裝置在合併前沒有 bounty_points 列', q.point(w, DEV) === null);
  await merge(w);
  ok('M6b 合併後 bounty_points 有裝置的墓碑（merged_into＝uid、點數 0）', same(q.point(w, DEV), { points: 0, merged_into: UID }), JSON.stringify(q.point(w, DEV)));
  const md = await me(w, DEV);
  // 稽核 F3 改寫：舊版是「舊 token 不帶憑證就讀到 uid 的帳（5）」——那是洞。現在的判準反過來抓「墓碑有被認得」：
  // 沒有墓碑的話它會被當成匿名裝置、回 200 與餘額 0（掉回 token 名下），而不是 401。
  ok('M6c 沒有 bounty_points 列的裝置併完之後，它的墓碑讓舊 token 不帶 Bearer 讀 chips-me 得到 401 auth_required（若墓碑沒建，會被當匿名裝置回 200）',
    md.status === 401 && md.json && md.json.error === 'auth_required', md.text);
  const mu6 = await meAs(w, UID);
  ok('M6c2 uid 本人帶 Bearer 讀到 uid 的帳（uid 自己的 2＋裝置搬來的 3＝5；只看得到裝置自己的話會是 3 或 0）', mu6.status === 200 && mu6.json.balance === 5, mu6.text);
  const r = await cloud(w, { actor: DEV, day: TODAY }, bearer(UID));
  ok('M6d 舊 token（帶 uid 的 Bearer）之後送的雲端搭乘落在 uid 名下（uid 1 列、token 0 列）', r.status === 200 && q.nRides(w, UID) === 1 && q.nRides(w, DEV) === 0, r.text);
});

// ═══ M7：已經併進「別的 uid」的 token 一列都不搬（那是別人帳號底下的資料）══════════════════════════════════════════════
await attempt('M7', async () => {
  const w = world();
  const S1 = 'tra_sched|南迴線|大武|太麻里';
  S.points(w, DEV, 0, OTHER);                        // DEV 早就併進 OTHER
  S.points(w, UID, 0);                               // uid 的點數列先存在：合併只會刷新它的 updated_at，前後快照才比得起來
  S.ledger(w, DEV, 'adjust', 9, 'm7-dev'); S.unlock(w, DEV, 'shifen', 1, 4, 100); S.ride(w, DEV, '2026-07-11', { requestId: 'm7-r' });
  S.board(w, S1, { distinct: 5 }); S.contrib(w, S1, DEV); S.contrib(w, S1, UID);
  S.ledger(w, UID, 'adjust', 1, 'm7-uid');
  const before = q.all(w);
  const r = await merge(w);
  // 稽核 F2 改寫：舊版回 200 {merged:false}（該搬的一列沒搬，但樣本與認領沒有守衛照樣被搬走）；現在明確回 409 merged_elsewhere
  ok('M7 [守衛；稽核 F2 改寫] 已併進別的 uid 的 token 再被拿來併：409 merged_elsewhere，四張表與看板一列都沒動（token 名下的東西仍在 token 名下）',
    r.status === 409 && r.json && r.json.error === 'merged_elsewhere' && q.all(w) === before && q.bal(w, DEV) === 9 && q.nUnlocks(w, DEV) === 1 && q.nRides(w, DEV) === 1 && q.board(w, S1)[0].d === 5,
    r.text + ' bal(dev)=' + q.bal(w, DEV));
});

// ═══ M8：合併之後的雲端籌碼結算（「應得−已得」，不是「剛好跨過 3 的倍數」）════════════════════════════════════════
await attempt('M8a', async () => {
  // 兩邊各 2 次、都還沒有籌碼 → 併成 4 次；下一次（第 5 次）就該補發第 1 顆——5 不是 3 的倍數
  const w = world();
  S.ride(w, DEV, '2026-07-10'); S.ride(w, DEV, '2026-07-11'); S.ride(w, UID, '2026-07-12'); S.ride(w, UID, '2026-07-13');
  await merge(w);
  const m = await meAs(w, UID);
  ok('M8a1 併完：雲端 4 次（toNextChip 2）、balance 0（合併當下不結算，等下一次搭乘補齊）', m.json.balance === 0 && same(m.json.cloud, { rides: 4, toNextChip: 2 }), m.text);
  w.at(at(YESTERDAY, 16));
  const r5 = await cloud(w, { day: YESTERDAY, startedAt: at(YESTERDAY, 9) }, bearer(UID));
  ok('M8a2 [驗收 E-c] 第 5 次搭乘（5 不是 3 的倍數）補發第 1 顆：chipAwarded 真、rides 5、toNextChip 1、帳本 ref＝<uid>|cloud|1',
    r5.status === 200 && r5.json.chipAwarded === true && r5.json.rides === 5 && r5.json.toNextChip === 1 &&
    same(w.db.prepare("SELECT ref FROM chip_ledger WHERE actor=? AND kind='cloud'").all(UID).map(x => x.ref), [`${UID}|cloud|1`]), r5.text);
  w.at(at(TODAY, 16));
  const r6 = await cloud(w, { day: TODAY, startedAt: at(TODAY, 9) }, bearer(UID));
  ok('M8a3 第 6 次再發第 2 顆（應得 2－已得 1）：ref 接在後面 |cloud|2，餘額 2',
    r6.json.chipAwarded === true && r6.json.rides === 6 && q.bal(w, UID) === 2 &&
    same(w.db.prepare("SELECT ref FROM chip_ledger WHERE actor=? AND kind='cloud' ORDER BY ref").all(UID).map(x => x.ref), [`${UID}|cloud|1`, `${UID}|cloud|2`]), r6.text);
});
await attempt('M8b', async () => {
  // 兩邊各 3 次、各已領 1 顆 → 併成 6 次、2 顆（refs 不同前綴）；再 2 次 → 8 次不補；再 1 次（9 次）才補第 3 顆
  const w = world();
  for (const d of ['2026-07-10', '2026-07-11', '2026-07-12']) S.ride(w, UID, d);
  for (const d of ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16']) S.ride(w, DEV, d);        // 裝置 4 次
  S.ledger(w, UID, 'cloud', 1, `${UID}|cloud|1`, '2026-07-12'); S.ledger(w, DEV, 'cloud', 1, `${DEV}|cloud|1`, '2026-07-15');
  await merge(w);
  const m = await meAs(w, UID);
  ok('M8b1 併完：雲端 7 次（toNextChip 2）、兩顆雲端籌碼都在 uid 名下（balance 2）', m.json.balance === 2 && same(m.json.cloud, { rides: 7, toNextChip: 2 }), m.text);
  w.at(at(YESTERDAY, 16));
  const r8 = await cloud(w, { day: YESTERDAY, startedAt: at(YESTERDAY, 9) }, bearer(UID));
  ok('M8b2 第 8 次：應得 2、已得 2（搬過來的也算）→ 不補發，chipAwarded 假、帳本仍 2 顆', r8.json.chipAwarded === false && r8.json.rides === 8 && q.bal(w, UID) === 2, r8.text);
  w.at(at(TODAY, 16));
  const r9 = await cloud(w, { day: TODAY, startedAt: at(TODAY, 9) }, bearer(UID));
  ok('M8b3 第 9 次：應得 3、已得 2 → 補第 3 顆，ref＝<uid>|cloud|3（不撞 uid 自己的 |1、也不撞搬來的 <裝置>|cloud|1），餘額 3',
    r9.json.chipAwarded === true && r9.json.rides === 9 && q.bal(w, UID) === 3 &&
    same(w.db.prepare("SELECT ref FROM chip_ledger WHERE actor=? AND kind='cloud' ORDER BY ref").all(UID).map(x => x.ref), [`${DEV}|cloud|1`, `${UID}|cloud|1`, `${UID}|cloud|3`]), r9.text);
});

// ═══ M10：授權與早退 ═══════════════════════════════════════════════════════════════════════════════════
await attempt('M10', async () => {
  const w = world();
  S.ledger(w, DEV, 'adjust', 5, 'm10-dev');
  const before = q.all(w);
  const noTok = await merge(w, DEV, UID, {});
  const badTok = await merge(w, DEV, null);
  ok('M10a 沒帶 token／Firebase 說 token 無效 → 401 且一列都沒動', noTok.status === 401 && badTok.status === 401 && q.all(w) === before, noTok.text + ' / ' + badTok.text);
  const badActor = await fin(await _bounty.bountyMerge(postTo('/api/bounty-merge', { actor: 'x' }, { Authorization: 'Bearer t' }), w.env));
  ok('M10b actor 不合法 → 400 bad_actor', badActor.status === 400 && badActor.json.error === 'bad_actor', badActor.text);
  firebaseUid = UID;
  const self = await fin(await _bounty.bountyMerge(postTo('/api/bounty-merge', { actor: UID }, { Authorization: 'Bearer t' }), w.env));
  // 稽核 F2／S0 改寫：自己併自己仍然是「帶著有效 Bearer 的寫入」，帳號列必須存在——所以「什麼都不動」改成
  // 「只多一列 uid 的帳號列（點數 0、沒有 merged_into）」，四張表、看板、其他人的列一列都沒動。
  const snap = x => JSON.parse(x), noPoints = o => ({ ...o, points: null });
  const sb = snap(before), sa = snap(q.all(w));
  ok('M10c actor 就是 uid 本人 → 200 {merged:false} 早退；除了 S0 補出的那一列 uid 帳號列（點數 0、merged_into null），四張表／看板／點數一列都沒動',
    self.status === 200 && same(self.json, { ok: true, uid: UID, points: 0, merged: false }) && same(noPoints(sa), noPoints(sb)) &&
    same(sa.points, [...sb.points, { actor: UID, points: 0, merged_into: null }].sort((a, b) => (a.actor < b.actor ? -1 : 1))), self.text + ' ' + JSON.stringify(sa.points));
  // 別人的資料一列都不動
  const w2 = world();
  S.ledger(w2, OTHER, 'adjust', 7, 'o-1'); S.unlock(w2, OTHER, 'viaduct', 1, 4, 100); S.ride(w2, OTHER, '2026-07-11'); S.contrib(w2, 'tra_sched|南迴線|大武|太麻里', OTHER);
  S.ledger(w2, DEV, 'adjust', 5, 'm10-dev2');
  const beforeOther = { l: q.nLedger(w2, OTHER), u: q.nUnlocks(w2, OTHER), r: q.nRides(w2, OTHER), c: q.nContrib(w2, OTHER) };
  await merge(w2);
  ok('M10d 合併只碰「裝置」與「uid」兩邊：第三個人的四張表一列都沒動', same({ l: q.nLedger(w2, OTHER), u: q.nUnlocks(w2, OTHER), r: q.nRides(w2, OTHER), c: q.nContrib(w2, OTHER) }, beforeOther) && q.bal(w2, OTHER) === 7);
});

// ═══ M11：單一 batch、沒有獨立寫入（交易邊界是結構保證）═══════════════════════════════════════════════════
await attempt('M11', async () => {
  const w = world();
  seedFull(w);
  let batches = 0, batchSize = 0, standaloneWrites = 0, inBatch = false;
  const spy = {
    prepare: sql => {
      const s = w.DB.prepare(sql);
      const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
      return { bind: (...p) => { const b = s.bind(...p); return {
        all: () => b.all(), first: c => b.first(c),
        run: () => { if (isWrite && !inBatch) standaloneWrites++; return b.run(); },
      }; } };
    },
    batch: st => { batches++; batchSize = st.length; inBatch = true; return w.DB.batch(st).finally(() => { inBatch = false; }); },
  };
  const r = await merge({ ...w, env: { ...w.env, DELAY_DB: spy } });
  ok(`M11 含 v2 四張表的合併仍是 1 個 batch、0 個獨立寫入語句（這個 batch 共 ${batchSize} 句）`, r.status === 200 && batches === 1 && standaloneWrites === 0 && batchSize > 5,
    JSON.stringify({ batches, standaloneWrites, batchSize }));
});

// ═══ M12：每日上限不回溯、不追討 ═══════════════════════════════════════════════════════════════════════
await attempt('M12', async () => {
  // 裝置與 uid 同一天各自已領滿 4 顆錄程籌碼（每人每日上限 4）——併起來是 8，不追討
  const w = world();
  for (let i = 1; i <= 4; i++) { S.ledger(w, DEV, 'trip', 1, `${DEV}|${TODAY}|t${i}`, TODAY); S.ledger(w, UID, 'trip', 1, `${UID}|${TODAY}|t${i}`, TODAY); }
  await merge(w);
  const m = await meAs(w, UID);
  ok('M12 兩邊各自領滿的當日錄程籌碼併成 8 顆、不回溯追討（balance 8、today.chips 8 > 上限 4）', m.json.balance === 8 && m.json.today.chips === 8 && m.json.today.cap === 4, m.text);
});

// ═══ M13：首位校正者（/api/bounty-me 的 firsts）與合併撞段時的首次時間（第十批）═══════════════════════════════════
// 「第一位」＝這一段的去重貢獻（bounty_seg_contrib）裡 first_ok_at 最早的人，同時刻取 actor 字序最前；樣本只決定
// 「這一段有沒有交過 ok」。模擬器的趟不寫貢獻，所以只有樣本、沒有貢獻列的段不算首位。這套語意是主對話判讀，不是使用者逐字說的。
// 合併撞段時留下的那一列取兩邊較早的 first_ok_at：併進帳號之後，裝置當年先跑的那一段仍算這個人先跑。
const okSample = (w, actor, id, keys) => w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,verdict_at) VALUES (?,?,?,?,?,?,?,?,?,?,'ok',1)")
  .run(id, actor, 'tra_sched', '南迴線', '123', 0, '2026-07-27', '[]', JSON.stringify(keys.map(key => ({ key, kind: 'track', slot: '', cov: 1 }))), 1);
const boMe = async (w, actor, hdr) => { _bounty.bountyResetMemCaches();
  return fin(await _bounty.bountyMe(req('/api/bounty-me' + (hdr ? '' : '?actor=' + actor), { headers: { 'cf-connecting-ip': '203.0.113.9', ...(hdr || {}) } }), w.env)); };
const firstAt = (w, a) => Object.fromEntries(w.db.prepare('SELECT seg_key, first_ok_at FROM bounty_seg_contrib WHERE actor=?').all(a).map(r => [r.seg_key, r.first_ok_at]));
await attempt('M13', async () => {
  const K = i => `tra_sched|南迴線|首${i}|首${i + 1}`;
  const EARLY = 'dev-aaaa-0001', LATE = 'dev-zzzz-0001';     // 字序 EARLY < DEV（dev-merge-0001）< LATE
  const w = world();
  // K1 DEV 較早（對手字序較前）　K2 DEV 較晚（對手字序較後）：只照字序排的話兩段的答案都會反過來
  // K3 同時刻、對手字序較前　K4 同時刻、對手字序較後　K5 只有樣本、沒有任何貢獻列（模擬器的趟）　K6 只有 DEV 一列（K5 的對照）
  S.contrib(w, K(1), DEV, 100); S.contrib(w, K(1), EARLY, 200);
  S.contrib(w, K(2), DEV, 200); S.contrib(w, K(2), LATE, 100);
  S.contrib(w, K(3), DEV, 150); S.contrib(w, K(3), EARLY, 150);
  S.contrib(w, K(4), DEV, 150); S.contrib(w, K(4), LATE, 150);
  S.contrib(w, K(6), DEV, 300);
  okSample(w, DEV, 'm13-a', [K(1), K(2), K(3)]); okSample(w, DEV, 'm13-b', [K(4), K(5), K(6)]);
  const r = await boMe(w, DEV);
  const got = r.json && Array.isArray(r.json.firsts) ? [...r.json.firsts].sort() : null;
  ok('M13a 首位校正者：first_ok_at 最早的人（K1 是、K2 不是——兩段的對手字序一前一後，只照字序排會兩段都錯）；同時刻取字序最前（K3 不是、K4 是）',
    r.status === 200 && got && got.includes(K(1)) && !got.includes(K(2)) && !got.includes(K(3)) && got.includes(K(4)), r.text.slice(0, 300));
  ok('M13b 只有樣本、沒有貢獻列的段不算首位（K5 不在、同形狀但有貢獻列的 K6 在）；firsts 恰好是 K1／K4／K6', got && !got.includes(K(5)) && got.includes(K(6)) && same(got, [K(1), K(4), K(6)].sort()),
    JSON.stringify(got));
  // 合併：K8 裝置 50、帳號 300、OTHER 100——併完帳號這一列取 50，變成第一位；K9 帳號 30、裝置 80、OTHER 60——帳號留 30（不被較晚的 80 蓋掉），仍是第一位；
  // K10 只有裝置 70、OTHER 90——改名後帶著 70，帳號是第一位。樣本：帳號自己交過 K8／K9，K10 的樣本在裝置名下（合併時一起改名）。
  const w2 = world();
  S.contrib(w2, K(8), DEV, 50); S.contrib(w2, K(8), UID, 300); S.contrib(w2, K(8), OTHER, 100);
  S.contrib(w2, K(9), UID, 30); S.contrib(w2, K(9), DEV, 80); S.contrib(w2, K(9), OTHER, 60);
  S.contrib(w2, K(10), DEV, 70); S.contrib(w2, K(10), OTHER, 90);
  okSample(w2, UID, 'm13-u', [K(8), K(9)]); okSample(w2, DEV, 'm13-d', [K(10)]);
  const before = await boMe(w2, UID, bearer(UID));
  ok('M13c [fixture] 合併前帳號只是 K9 的第一位（K8 有更早的裝置與 OTHER）', before.status === 200 && same(before.json.firsts, [K(9)]), before.text.slice(0, 300));
  const mg = await merge(w2);
  const after = await boMe(w2, UID, bearer(UID));
  const fa = firstAt(w2, UID);
  ok('M13d 合併撞段：留下的帳號列取兩邊較早的 first_ok_at（K8 300→50）、較早的一邊不被較晚的蓋掉（K9 仍 30）、只在裝置名下的段改名時帶著原值（K10 70）；裝置名下 0 列',
    mg.status === 200 && mg.json.merged === true && fa[K(8)] === 50 && fa[K(9)] === 30 && fa[K(10)] === 70 && q.nContrib(w2, DEV) === 0 && q.nContrib(w2, OTHER) === 3,
    JSON.stringify({ merge: mg.json, fa, dev: q.nContrib(w2, DEV) }));
  ok('M13e 合併後帳號是 K8／K9／K10 三段的第一位', after.status === 200 && same([...after.json.firsts].sort(), [K(8), K(9), K(10)].sort()), after.text.slice(0, 300));
});

// ═══ P：刪帳號（bountyPurgeUid）清掉四張表——本人＋併進本人的 token＋本機當下的 device；別人的一列不動；看板人數不回扣 ═══════════════
await attempt('P1', async () => {
  const DEV2 = 'dev-purge-cur1', DEV3 = 'dev-purge-oth1';
  const SEG = 'tra_sched|南迴線|大武|太麻里';
  const w = world();
  // 身分：UID 本人；DEV 已併進 UID（墓碑）；DEV2 是本機當下的 device（還沒併）；DEV3 併進別人；OTHER 是別人
  S.points(w, UID, 40); S.points(w, DEV, 0, UID); S.points(w, DEV2, 9); S.points(w, DEV3, 0, OTHER); S.points(w, OTHER, 50);
  // 每一格的列數刻意不同，算錯一格的計數（或少刪一張表）都會被看出來
  const seed = (actor, n) => {
    for (let i = 0; i < n[0]; i++) S.ledger(w, actor, 'adjust', 1, `${actor}|p-l${i}`);
    for (let i = 0; i < n[1]; i++) S.unlock(w, actor, ['south-coast', 'shifen', 'viaduct', 'alishan'][i], i + 1, 4, 100 + i);
    for (let i = 0; i < n[2]; i++) S.ride(w, actor, `2026-07-1${i}`);
    for (let i = 0; i < n[3]; i++) S.contrib(w, `tra_sched|南迴線|站${i}|站${i + 1}`, actor);
  };
  seed(UID, [2, 1, 2, 3]); seed(DEV, [1, 2, 1, 1]); seed(DEV2, [3, 1, 1, 2]);      // 會被刪：合計 6／4／4／6
  seed(DEV3, [2, 2, 2, 2]); seed(OTHER, [3, 1, 1, 2]);                              // 不能動
  S.board(w, SEG, { distinct: 5 });
  // 🔴 看板要有「被刪的人真的貢獻過的那幾段」（站0|站1、站1|站2、站2|站3 都有人貢獻；站3|站4 沒人）：
  // 只有 SEG 一列而沒有人貢獻過 SEG 的話，「刪帳號時回扣去重人數」這種回歸沒有東西可以減，P1e 永遠是綠的。
  for (let i = 0; i < 4; i++) S.board(w, `tra_sched|南迴線|站${i}|站${i + 1}`, { distinct: 5 });
  const boardBefore = w.db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all().map(x => ({ ...x }));
  firebaseUid = UID;
  const res = await worker.fetch(postTo('/api/account-delete', { actor: DEV2 }, { Authorization: 'Bearer t' }), w.env, { waitUntil() {} });
  const b = await fin(res);
  const left = t => w.db.prepare(`SELECT DISTINCT actor FROM ${t} ORDER BY actor`).all().map(r => r.actor);
  // 稽核 F3／S5 改寫：v2 四張表是錢包，不再吃 body 傳來的 deviceActor——DEV2 是「還沒併進 UID 的裝置」，它的 v2 資料留著
  // （舊版連它一起刪：呼叫端自己填別人的裝置 id 就能刪掉對方買到的場景）。所以四張表剩 DEV2／DEV3／OTHER。
  const want = [DEV2, DEV3, OTHER].sort();
  ok('P1a [驗收 B9；稽核 S5 改寫] 刪帳號後四張表只剩：沒併進本人的 body deviceActor（DEV2）、「併進別人的 token」（DEV3）、別人（OTHER）',
    res.status === 200 && ['chip_ledger', 'garage_unlocks', 'cloud_rides', 'bounty_seg_contrib'].every(t => same(left(t), want)), JSON.stringify({ status: res.status, l: left('chip_ledger'), u: left('garage_unlocks'), r: left('cloud_rides'), c: left('bounty_seg_contrib') }));
  ok('P1b [驗收 B9] 本人與併進本人的 token 的四張表任何一列都不在了',
    ['chip_ledger', 'garage_unlocks', 'cloud_rides', 'bounty_seg_contrib'].every(t => w.db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE actor IN (?,?)`).get(UID, DEV).c === 0));
  ok('P1b2 [稽核 S5] 沒併進本人的 body deviceActor（DEV2）四張表的列數一列都沒少（3／1／1／2）——v2 錢包不能被別人填的裝置 id 刪掉',
    q.nLedger(w, DEV2) === 3 && q.nUnlocks(w, DEV2) === 1 && q.nRides(w, DEV2) === 1 && q.nContrib(w, DEV2) === 2);
  ok('P1c 別人與「併進別人的 token」的列數一列都沒少（DEV3 2／2／2／2；OTHER 3／1／1／2）',
    q.nLedger(w, DEV3) === 2 && q.nUnlocks(w, DEV3) === 2 && q.nRides(w, DEV3) === 2 && q.nContrib(w, DEV3) === 2 &&
    q.nLedger(w, OTHER) === 3 && q.nUnlocks(w, OTHER) === 1 && q.nRides(w, OTHER) === 1 && q.nContrib(w, OTHER) === 2);
  ok('P1d 回應如實回報刪了幾列：points 3（UID／DEV／DEV2，v1 的 bounty_points 維持舊行為）、chips 3、unlocks 3、cloudRides 3、contrib 4（只算 UID 與 DEV），samples／claims 0',
    b.json && same(b.json.deleted, { samples: 0, claims: 0, points: 3, chips: 3, unlocks: 3, cloudRides: 3, contrib: 4 }), JSON.stringify(b.json && b.json.deleted));
  const boardAfter = w.db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all().map(x => ({ ...x }));
  ok('P1e 看板的去重人數不回扣（5 列 bounty_board 逐列相同、distinct_ok_users 全都仍是 5；其中 3 列是被刪的人貢獻過的段）——那是匿名彙總，刪帳號不讓別人看到的進度倒退', same(boardAfter, boardBefore) && boardAfter.length === 5 && boardAfter.every(x => x.distinct_ok_users === 5), JSON.stringify(boardAfter));
  ok('P1f bounty_points：本人／併進本人的墓碑／本機 device 三列刪了，DEV3 的墓碑與 OTHER 留著', same(w.db.prepare('SELECT actor FROM bounty_points ORDER BY actor').all().map(r => r.actor), [DEV3, OTHER].sort()));
});
await attempt('P2', async () => {
  // 不帶 deviceActor：只碰 uid 家族，不誤刪任何匿名 token 的四張表資料（比照 L10）
  const w = world();
  S.points(w, DEV, 5); S.ledger(w, DEV, 'adjust', 5, 'p2-dev'); S.unlock(w, DEV, 'shifen', 1, 4, 100);
  S.ledger(w, UID, 'adjust', 2, 'p2-uid');
  const out = await _bounty.bountyPurgeUid(w.env, UID);
  ok('P2 不傳 deviceActor：只刪 uid 家族（uid 的 1 列帳本），沒併進 uid 的 token 的四張表一列不動；回傳七欄',
    out.chips === 1 && out.unlocks === 0 && q.nLedger(w, DEV) === 1 && q.nUnlocks(w, DEV) === 1 && Object.keys(out).length === 7, JSON.stringify(out));
});

ok('Z 這支腳本全程只打過 Firebase 查 uid 的端點（其餘連線一律丟例外）', fetchCalls.every(u => u.includes('identitytoolkit.googleapis.com')), String(fetchCalls.length) + ' 次');
const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
