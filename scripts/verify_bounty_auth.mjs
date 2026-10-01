// 路段懸賞 v2 後端驗收（五）：身分與授權——誰能用哪個 actor 讀、賺、花、併、刪。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ Firebase 替身；不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_auth.mjs
//
// 期望值全部寫死在這裡，不呼叫實作去產生期望：
//   ・產品規則：車庫第 1 座 4 籌碼、之後每座 8；捷運不列入懸賞。（這支腳本只用到價目 4／8 與捷運搭乘。）
//   ・身分規則本身（uid 不是憑證、匿名裝置的 installId 是它自己的憑證、併進帳號之後錢包只認帳號的 Bearer、
//     上傳與認領是「賺」不是「花」）來自設計原則。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準（每一層防線都做過突變測試，指名由哪個檢查抓到）。
//
// 分組（每個 A 組對應稽核的一個洞；括號是被修的規格）：
//   A1  以別人的 uid 當合併來源（S2a not_a_device）　A1b 舊版留下的髒列不能再被搬（G 的 uid IS NULL）
//   A2  還沒出現過的 uid 被預先佔位，本人第一次合併要能收回（S2b）　A2b 收回也發生在非合併的寫入端點（S0）
//   A3  裝置已併進 X，Y 不能把它拉走（S2a merged_elsewhere、S2d ④⑤ 守衛）　A3b 從沒合併過的帳號也會被 S0 認成帳號
//       A3f 帶餘點的墓碑不能被搬（② 的 merged_into IS NULL 那一層）
//   A4  merged 只在真的搬了才為真（S2e）　　A5  字面 'ephemeral' 一律不收（S1）
//   A6  兌換：帳號 uid 沒帶自己的 Bearer 一律不准花（S4 錢包）　A7  兌換：併進帳號的裝置同上
//   A8  雲端搭乘：同上，加上「替受害者佔掉當天那一格」的攻擊（C1）
//   A9  chips-me：?actor= 的錢包規則、Bearer 不跟 merged_into（S3）
//   A10 上傳與認領（賺）：帳號 uid 要 Bearer、併過的裝置與匿名裝置不用（S4 earn）
//   A11 刪帳號：body 傳來的 deviceActor 不能刪別人的 v2 錢包（S5）；也不能刪別人的帳號列與被髒標記指向自己的帳號（A11d–g）
//   A12 兌換重送：同一個 requestId 不能拿去兌換另一座（S6）　A13 雲端搭乘重送：兩天後、合併之後都要對得上（S7）
//   A14 chips-me 與 bounty-me 的 ?actor= 限流（S8）　A15 壞 Bearer 一律 401、不降級成匿名　A16 帶著有效 Bearer 的寫入都先補帳號列（S0）
//
// ⚠️ 假 D1 的保真度：scripts/d1_local.mjs 的 batch() 是排隊序列化的，但 batch 之外的單句寫入
//    可以插進另一個 batch 的交易中間；真的 D1 不會這樣。這支腳本沒有併發判準；上線後對正式庫做一次唯讀抽查
//    （bounty_points 有沒有「uid 非空、又有 merged_into」的髒列、有沒有籌碼落在沒有帳號列的 uid 底下）。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(new URL('../worker.js', import.meta.url))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// Firebase 替身：驗過 token 會回 fbUid（null＝Firebase 說 token 無效）。這支腳本唯一允許的對外連線就是這個端點。
let fbUid = null;
const fetchCalls = [];
globalThis.fetch = async (u) => {
  fetchCalls.push(String(u));
  if (!String(u).includes('identitytoolkit.googleapis.com')) throw new Error('offline: ' + String(u));
  return fbUid ? new Response(JSON.stringify({ users: [{ localId: fbUid }] }), { status: 200 }) : new Response('{}', { status: 400 });
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
const NOW_MS = Date.parse('2026-07-29T08:00:00Z');          // 台北 2026-07-29 16:00（週三）
const TODAY = '2026-07-29', YESTERDAY = '2026-07-28';
const t0 = day => Date.parse(day + 'T00:00:00Z') - 8 * 3600e3;
const at = (day, h, m = 0) => t0(day) + (h * 60 + m) * 60000;
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const SIM = { platform: 'ios', app: '1.6.13', simulator: true };
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });
// 角色（全部合法的 actor 形狀）：V 受害者帳號、DV 併進 V 的裝置；A 攻擊者帳號；X／Y 同一個瀏覽器先後登入的兩個帳號；
// DX 併進 X 的裝置；W 還沒出現過的帳號、DW 它的裝置；U 一般帳號、D 併進 U 的裝置、DANON 從沒併過的匿名裝置；Z 不相干的第三個帳號
const V = 'uid-victim-0001', DV = 'dev-victim-0001', A = 'uid-attack-0001', X = 'uid-userx-00001', Y = 'uid-usery-00001';
const DX = 'dev-userx-00001', W = 'uid-newbie-0001', DW = 'dev-newbie-0001', U = 'uid-user-000001', D = 'dev-user-000001', DANON = 'dev-anon-000001', Z = 'uid-other-00001';
const SEG = 'tra_sched|南迴線|大武|太麻里';
const CARD = 'tra_sched|南迴線|0|自強|track|';
const UNITS = { generatedAt: 1, schedDate: YESTERDAY, units: [], lines: { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] } } };

function world(over = {}) {
  const { db, DELAY_DB } = openTestDb('');
  const w = { db };
  const ASSETS = { fetch: async r => {
    const name = new URL(String(r.url)).pathname.replace(/^\/data\//, '');
    if (name === 'bounty_rules.json') return new Response(JSON.stringify(RULES), { status: 200 });
    if (name === 'bounty_units.json') return new Response(JSON.stringify(UNITS), { status: 200 });
    return new Response('nf', { status: 404 });
  } };
  w.env = { DELAY_DB, ASSETS, FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(false), DELETE_LIMITER: limiter(false),
    BOUNTY_LIMITER: limiter(false), BOUNTY_NOW: String(NOW_MS), ...(over.env || {}) };
  w.at = ms => { w.env.BOUNTY_NOW = String(ms); };
  return w;
}
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
async function fin(res) { const text = await res.text(); return { status: res.status, text, json: parse(text) }; }
async function call(fn, request, env) { _bounty.bountyResetMemCaches(); return fin(await fn(request, env)); }
const postTo = (path, b, hdr = {}) => req(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr },
  body: typeof b === 'string' ? b : JSON.stringify(b) });
// as(uid)：把 Firebase 替身設成「這一位」並回傳 Bearer 標頭；as(null)＝Firebase 說 token 無效
const as = uid => { fbUid = uid; return { Authorization: 'Bearer tok-' + (uid || 'bad') }; };
let rid = 0;
const nextReq = () => 'req-' + String(++rid).padStart(6, '0');

const merge = (w, dev, uid, hdr) => call(_bounty.bountyMerge, postTo('/api/bounty-merge', { actor: dev }, hdr === undefined ? as(uid) : hdr), w.env);
const redeem = (w, actor, scene, requestId, hdr = {}) => call(_bounty.garageRedeem, postTo('/api/garage-redeem', { actor, scene, requestId }, hdr), w.env);
const ride = (w, actor, o = {}, hdr = {}) => call(_bounty.cloudRide, postTo('/api/cloud-ride', {
  actor, day: TODAY, trainKey: 'mrt|BR|veh-0001', startedAt: at(TODAY, 9), sec: 600, requestId: nextReq(), client: APP, ...o }, hdr), w.env);
const chipsMe = (w, query = '', hdr = {}) => call(_bounty.chipsMe, req('/api/chips-me' + query, { headers: { 'cf-connecting-ip': '203.0.113.9', ...hdr } }), w.env);
const boMe = (w, query = '', hdr = {}) => call(_bounty.bountyMe, req('/api/bounty-me' + query, { headers: { 'cf-connecting-ip': '203.0.113.9', ...hdr } }), w.env);
const SAMPLES = [{ d: 0, t: 100, v: 10, acc: 5 }, { d: 100, t: 110, v: 10, acc: 5 }];
const submit = (w, actor, o = {}, hdr = {}) => call(_bounty.bountySubmit, postTo('/api/bounty-submit', {
  actor, client: APP, sys: 'tra_sched', lnId: '南迴線', trainNo: '123', tripDate: YESTERDAY, dir: 0, samples: SAMPLES, requestId: nextReq(), ...o }, hdr), w.env);
const claim = (w, actor, o = {}, hdr = {}) => call(_bounty.bountyClaim, postTo('/api/bounty-claim', { actor, cardId: CARD, ...o }, hdr), w.env);
const delAccount = (w, body, hdr) => worker.fetch(postTo('/api/account-delete', body, hdr), w.env, { waitUntil() {} }).then(fin);

// ── 種子與讀庫（一律自己寫 SQL，期望值不能與被驗的實作同源）──────────────────────────
const S = {
  acct: (w, uid, points = 0, mergedInto = null) => w.db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,?,?,1)').run(uid, uid, points, mergedInto),
  dev: (w, actor, points = 0, mergedInto = null) => w.db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,NULL,?,?,1)').run(actor, points, mergedInto),
  ledger: (w, actor, kind, delta, ref, day = null, atMs = 1000) => w.db.prepare('INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(`${kind}|${ref}`, actor, kind, delta, ref, day, atMs),
  unlock: (w, actor, scene, nth, cost, atMs) => w.db.prepare('INSERT INTO garage_unlocks (actor,scene,nth,cost,created_at) VALUES (?,?,?,?,?)').run(actor, scene, nth, cost, atMs),
  ride: (w, actor, day, o = {}) => w.db.prepare('INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at,simulator) VALUES (?,?,?,?,?,?,?)')
    .run(actor, day, 'mrt|BR|seed', 700, o.requestId === undefined ? null : o.requestId, o.at ?? 1000, o.simulator ? 1 : 0),
  contrib: (w, seg, actor) => w.db.prepare('INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES (?,?,1)').run(seg, actor),
  board: (w, seg, o = {}) => w.db.prepare('INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,first_listed_at,covered_at,distinct_ok_users) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(seg, seg.split('|')[0], o.trainKind || '自強', o.dir ?? 0, 'track', '', 1, o.covered ?? null, o.distinct ?? 0),
  sample: (w, actor, id) => w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict) VALUES (?,?,?,?,?,?,?,?,NULL,?,'pending')")
    .run(id, actor, 'tra_sched', '南迴線', '123', 0, '2026-07-27', '[]', 1),
  claim: (w, actor, id) => w.db.prepare("INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,'open')")
    .run(id, actor, SEG, '自強', 0, 'track', '', 5, 1, 2),
};
const rows = (w, sql, ...p) => w.db.prepare(sql).all(...p).map(r => ({ ...r }));
const q = {
  bal: (w, a) => w.db.prepare('SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=?').get(a).n,
  nLedger: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM chip_ledger WHERE actor=?').get(a).c,
  nUnlocks: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM garage_unlocks WHERE actor=?').get(a).c,
  unlocks: (w, a) => rows(w, 'SELECT scene,nth,cost,created_at FROM garage_unlocks WHERE actor=? ORDER BY nth', a),
  nRides: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM cloud_rides WHERE actor=?').get(a).c,
  rides: (w, a) => rows(w, 'SELECT day,request_id,simulator,created_at FROM cloud_rides WHERE actor=? ORDER BY day', a),
  nContrib: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib WHERE actor=?').get(a).c,
  nSamples: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM bounty_samples WHERE actor=?').get(a).c,
  nClaims: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM bounty_claims WHERE actor=?').get(a).c,
  point: (w, a) => { const r = w.db.prepare('SELECT uid,points,merged_into FROM bounty_points WHERE actor=?').get(a); return r ? { ...r } : null; },
  nPoints: w => w.db.prepare('SELECT COUNT(*) c FROM bounty_points').get().c,
};
// 全庫快照（八張表逐列）。omit：這些 actor 的 bounty_points 列不比（那是被 S0 補出來的帳號列，是預期會變的那一列）
const dump = (w, omit = []) => canon({
  samples: rows(w, 'SELECT id,actor,sys,ln_id,train_no,dir,trip_date,payload,verdict FROM bounty_samples ORDER BY id'),
  claims: rows(w, 'SELECT id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status FROM bounty_claims ORDER BY id'),
  ledger: rows(w, 'SELECT id,actor,kind,delta,ref,day,created_at FROM chip_ledger ORDER BY id'),
  unlocks: rows(w, 'SELECT * FROM garage_unlocks ORDER BY actor,scene'),
  rides: rows(w, 'SELECT * FROM cloud_rides ORDER BY actor,day'),
  contrib: rows(w, 'SELECT * FROM bounty_seg_contrib ORDER BY seg_key,actor'),
  board: rows(w, 'SELECT seg_key,train_kind,dir,distinct_ok_users,covered_at FROM bounty_board ORDER BY seg_key,train_kind,dir'),
  points: rows(w, 'SELECT actor,uid,points,merged_into FROM bounty_points ORDER BY actor').filter(r => !omit.includes(r.actor)),
});
// 只看錢包相關的兩張表（兌換與雲端搭乘被擋時「一個字都沒動」的比對）
const wallet = w => canon({ ledger: rows(w, 'SELECT id,actor,kind,delta,ref,day,created_at FROM chip_ledger ORDER BY id'),
  unlocks: rows(w, 'SELECT * FROM garage_unlocks ORDER BY actor,scene'), rides: rows(w, 'SELECT * FROM cloud_rides ORDER BY actor,day') });
const isAcct = (w, a, extra = {}) => same(q.point(w, a), { uid: a, points: 0, merged_into: null, ...extra });

// ═══ A1：把別人的 uid 當合併來源（合併劫持）══════════════════════════════════════════════════════
await attempt('A1', async () => {
  const w = world();
  // 受害者 V：帳號列（40 點）、v2 四張表、v1 樣本與認領各有東西，還有一台併進 V 的裝置 DV
  S.acct(w, V, 40); S.dev(w, DV, 0, V);
  S.ledger(w, V, 'adjust', 10, 'a1-adj'); S.ledger(w, V, 'redeem', -4, 'a1-red'); S.unlock(w, V, 'south-coast', 1, 4, 1000);
  S.ride(w, V, '2026-07-11', { requestId: 'a1-r11' }); S.board(w, SEG, { distinct: 5 }); S.contrib(w, SEG, V);
  S.sample(w, V, 'a1-s1'); S.claim(w, V, 'a1-c1');
  S.ledger(w, A, 'adjust', 2, 'a1-attacker');                    // 攻擊者自己有 2 顆籌碼（沒有 bounty_points 列）
  const before = dump(w, [A]);
  const r = await merge(w, V, A);
  ok('A1a 攻擊者（帶自己的有效 Bearer）拿受害者的 uid 當來源合併 → 400 not_a_device', r.status === 400 && r.json && r.json.error === 'not_a_device', r.text);
  ok('A1b 受害者的點數列與 v2 四張表、樣本、認領、看板、去重貢獻逐列都沒動（攻擊者的帳號列除外）', dump(w, [A]) === before, '');
  const rv = await chipsMe(w, '', as(V));
  ok('A1c 受害者帶自己的 Bearer 讀 chips-me：餘額 6、已解鎖 south-coast——自己的帳還在自己名下',
    rv.status === 200 && rv.json.balance === 6 && rv.json.unlocked.length === 1 && rv.json.unlocked[0].scene === 'south-coast', rv.text);
  const mv = await boMe(w, '', as(V));
  ok('A1d 受害者帶自己的 Bearer 讀 bounty-me：點數 40、身分是自己（不是被導向攻擊者）', mv.status === 200 && mv.json.points === 40 && mv.json.actor === V, mv.text);
  const ra = await chipsMe(w, '', as(A));
  ok('A1e 攻擊者什麼都沒拿到：Bearer 讀 chips-me 餘額仍是自己的 2、沒有解鎖；他的點數列是 0 點的帳號列',
    ra.status === 200 && ra.json.balance === 2 && ra.json.unlocked.length === 0 && same(q.point(w, A), { uid: A, points: 0, merged_into: null }), ra.text + ' ' + JSON.stringify(q.point(w, A)));
  const r2 = await merge(w, V, A);
  ok('A1f 攻擊者再試一次：仍是 400、庫仍逐列相同（不因重試而鬆動）', r2.status === 400 && r2.json.error === 'not_a_device' && dump(w, [A]) === before, r2.text);
  // 對照組：同一支合併端點，來源是一台一般的匿名裝置 → 照常搬（不能是「一律 400」才綠）
  const w2 = world();
  S.ledger(w2, DANON, 'adjust', 5, 'a1-ctl');
  const rc = await merge(w2, DANON, A);
  ok('A1g [對照] 來源是匿名裝置 → 200 merged:true，5 顆籌碼搬進帳號', rc.status === 200 && rc.json.merged === true && q.bal(w2, A) === 5 && q.nLedger(w2, DANON) === 0, rc.text);
});

// ═══ A1b：舊版攻擊留下的髒列（帳號列＋merged_into 指向攻擊者）不能再被同一個攻擊者搬 ═══════════════════════════════
await attempt('A1b', async () => {
  const w = world();
  // 舊版的 F2 攻擊做完之後 V 的列長這樣：uid 是自己、卻掛著 merged_into＝攻擊者；V 名下的東西還在
  S.acct(w, V, 7, A);
  S.ledger(w, V, 'adjust', 10, 'a1b-adj'); S.unlock(w, V, 'shifen', 1, 4, 1000); S.ride(w, V, '2026-07-11', { requestId: 'a1b-r' });
  S.board(w, SEG, { distinct: 5 }); S.contrib(w, SEG, V); S.sample(w, V, 'a1b-s'); S.claim(w, V, 'a1b-c');
  const before = dump(w, [A]);
  const r = await merge(w, V, A);
  ok('A1b1 髒列（帳號列 merged_into＝攻擊者）再被攻擊者拿來合併 → 400 not_a_device，而且逐列沒動（守衛不能只看 merged_into＝我）',
    r.status === 400 && r.json.error === 'not_a_device' && dump(w, [A]) === before, r.text);
  const rv = await chipsMe(w, '', as(V)), mv = await boMe(w, '', as(V));
  ok('A1b2 受害者帶自己的 Bearer 讀 chips-me／bounty-me：看到的是自己的帳（餘額 10、點數 7），不是被 merged_into 導向的攻擊者',
    rv.json.balance === 10 && rv.json.unlocked.length === 1 && mv.json.points === 7 && mv.json.actor === V, rv.text + ' | ' + mv.text);
});

// ═══ A2：還沒出現過的 uid 被攻擊者預先佔位（標成墓碑），本人第一次帶 Bearer 合併時要能收回 ══════════════════════════
await attempt('A2', async () => {
  const w = world();
  S.ledger(w, A, 'adjust', 7, 'a2-attacker');
  const pre = await merge(w, W, A);
  ok('A2a [fixture] 攻擊者把「還沒出現過的 uid（W）」當來源合併：查不到任何東西可搬，200 merged:true，W 被標成併進攻擊者的墓碑',
    pre.status === 200 && same(q.point(w, W), { uid: null, points: 0, merged_into: A }), pre.text + ' ' + JSON.stringify(q.point(w, W)));
  S.ledger(w, DW, 'adjust', 5, 'a2-dw');
  const m = await merge(w, DW, W);
  ok('A2b 本人（W）第一次帶自己的 Bearer 合併自己的裝置 → 200 merged:true，W 的列收回成帳號列（uid＝W、merged_into＝NULL）',
    m.status === 200 && m.json.merged === true && isAcct(w, W), m.text + ' ' + JSON.stringify(q.point(w, W)));
  const rw = await chipsMe(w, '', as(W)), ra = await chipsMe(w, '', as(A));
  ok('A2c W 帶自己的 Bearer 讀到的是自己裝置的 5 顆，不是攻擊者的 7；攻擊者仍是自己的 7（W 的合併沒有動到他）',
    rw.json.balance === 5 && ra.json.balance === 7, rw.text + ' | ' + ra.text);
  const rd = await redeem(w, W, 'south-coast', nextReq(), as(W));
  ok('A2d W 之後用自己的 Bearer 兌換（actor＝W）成功：不是 403 wrong_account（它不再是「併進攻擊者的墓碑」）；扣的是 W 的帳（5→1）',
    rd.status === 200 && rd.json.balance === 1 && q.nUnlocks(w, W) === 1 && q.nUnlocks(w, A) === 0, rd.text);
  const noTok = await redeem(w, W, 'shifen', nextReq());
  ok('A2e W 已經是帳號：不帶 token 的兌換 → 401 auth_required（不會被當匿名裝置）', noTok.status === 401 && noTok.json.error === 'auth_required', noTok.text);
});
await attempt('A2b', async () => {
  // 同樣的預先佔位，但本人第一次出現是在「非合併」的寫入端點（雲端搭乘）：S0 要在身分判斷之前收回帳號列
  const w = world();
  await merge(w, W, A);
  ok('A2f [fixture] W 被攻擊者標成墓碑', same(q.point(w, W), { uid: null, points: 0, merged_into: A }), JSON.stringify(q.point(w, W)));
  const r = await ride(w, W, {}, as(W));
  ok('A2g W 第一次用自己的 Bearer 送雲端搭乘（actor＝W）→ 200，搭乘列在 W 名下、不在攻擊者名下；W 的列是帳號列、沒有 merged_into',
    r.status === 200 && q.nRides(w, W) === 1 && q.nRides(w, A) === 0 && isAcct(w, W), r.text + ' ' + JSON.stringify(q.point(w, W)));
});

// ═══ A3：裝置已併進 X，同一個瀏覽器換 Y 登入，Y 不能把它拉走═══════════════════════════════════════════
await attempt('A3', async () => {
  const w = world();
  S.acct(w, X, 5); S.dev(w, D, 0, X);
  S.ledger(w, X, 'adjust', 9, 'a3-x'); S.ledger(w, X, 'redeem', -4, 'a3-x-r'); S.unlock(w, X, 'shifen', 1, 4, 1000);
  S.ride(w, X, '2026-07-11', { requestId: 'a3-r' }); S.board(w, SEG, { distinct: 5 }); S.contrib(w, SEG, X);
  S.sample(w, X, 'a3-xs'); S.claim(w, X, 'a3-xc');
  // D 併進 X 之後才寫進來的東西（遲到的樣本與認領、直接寫的籌碼等）仍掛在 D 名下：Y 不能把它們搬走
  S.sample(w, D, 'a3-late-s'); S.claim(w, D, 'a3-late-c'); S.ledger(w, D, 'adjust', 3, 'a3-late-l'); S.unlock(w, D, 'viaduct', 1, 4, 2000);
  S.ride(w, D, '2026-07-12', { requestId: 'a3-late-r' }); S.contrib(w, 'tra_sched|南迴線|太麻里|金崙', D);
  const before = dump(w, [Y]);
  const r = await merge(w, D, Y);
  ok('A3a 已併進 X 的裝置被 Y 拿來合併 → 409 merged_elsewhere', r.status === 409 && r.json && r.json.error === 'merged_elsewhere', r.text);
  ok('A3b 所有相關表逐列相同（樣本、認領、帳本、解鎖、雲端搭乘、去重貢獻、看板、點數），唯一的例外是 Y 的帳號列',
    dump(w, [Y]) === before, '');
  ok('A3c 例外的那一列是 S0 補出的 Y 帳號列（uid＝Y、0 點、沒有 merged_into）；D 仍是併進 X 的墓碑', isAcct(w, Y) && same(q.point(w, D), { uid: null, points: 0, merged_into: X }),
    JSON.stringify([q.point(w, Y), q.point(w, D)]));
  const ry = await chipsMe(w, '', as(Y)), rx = await chipsMe(w, '', as(X));
  ok('A3d Y 什麼都沒拿到（餘額 0、沒有解鎖）；X 的帳不變（餘額 5＝9−4、解鎖 shifen）', ry.json.balance === 0 && ry.json.unlocked.length === 0 && rx.json.balance === 5 && rx.json.unlocked.length === 1, ry.text + ' | ' + rx.text);
  // 對照組：X 自己重跑同一個合併 → 200 merged:false（冪等，不是「一律 409」）
  const again = await merge(w, D, X);
  ok('A3e [對照] 併進 X 的裝置由 X 本人重跑合併 → 200 merged:false（冪等）', again.status === 200 && again.json.merged === false, again.text);
});
await attempt('A3b', async () => {
  // 從沒合併過的帳號 U：用自己的 Bearer 送過搭乘之後，它就是帳號——之後不帶 token 的三種錢包請求都要被擋
  const w = world();
  S.ledger(w, U, 'adjust', 10, 'a3b-u');                       // U 名下已經有籌碼（沒有 bounty_points 列、從沒合併過）
  const r = await ride(w, U, {}, as(U));
  ok('A3b1 [fixture] U 用自己的 Bearer 送雲端搭乘（actor＝U）→ 200，搭乘列在 U 名下、U 有了帳號列', r.status === 200 && q.nRides(w, U) === 1 && isAcct(w, U), r.text + ' ' + JSON.stringify(q.point(w, U)));
  const w0 = wallet(w);
  const rd = await redeem(w, U, 'south-coast', nextReq());
  const rr = await ride(w, U, { day: YESTERDAY, startedAt: at(YESTERDAY, 9) });
  const cm = await chipsMe(w, '?actor=' + U);
  ok('A3b2 之後不帶 token、actor＝U 的兌換／雲端搭乘／chips-me 讀取 → 三個都是 401 auth_required（uid 不是憑證）',
    [rd, rr, cm].every(x => x.status === 401 && x.json && x.json.error === 'auth_required'), JSON.stringify([rd.json, rr.json, cm.json]));
  ok('A3b3 被擋的請求什麼都沒寫（帳本、解鎖、雲端搭乘逐列相同）、餘額仍 10', wallet(w) === w0 && q.bal(w, U) === 10, '');
  const rd2 = await redeem(w, U, 'south-coast', nextReq(), as(U));
  ok('A3b4 [對照] 同一個 U 帶自己的 Bearer 兌換 → 200（不是「一律擋」才綠）', rd2.status === 200 && rd2.json.balance === 6, rd2.text);
});
await attempt('A3f', async () => {
  // 髒墓碑：D 早就併進 X，但併走「之後」又被寫進 7 點（例：驗證 cron 在合併的瞬間讀到舊的 merged_into、把點數入在墓碑上）。
  // Y 拿它當來源合併：那 7 點不能被 ② 的子查詢讀走加進 Y，墓碑也不能被 ③ 改標成併進 Y——② 與 ③ 各有一條自己的 merged_into IS NULL，
  // A3 的墓碑點數是 0，② 少了那條守衛也加 0，看不出來；這一組讓它有非零的餘點，② 的那一層才有東西可考。
  const w = world();
  S.acct(w, X, 5); S.dev(w, D, 7, X);
  const before = dump(w, [Y]);
  const r = await merge(w, D, Y);
  ok('A3f 帶著餘點的墓碑（併進 X、7 點）被 Y 拿來合併 → 409 merged_elsewhere；Y 沒有多出那 7 點（帳號列 0 點）；墓碑與其他表逐列沒動',
    r.status === 409 && r.json && r.json.error === 'merged_elsewhere' && isAcct(w, Y) && dump(w, [Y]) === before && same(q.point(w, D), { uid: null, points: 7, merged_into: X }),
    r.text + ' ' + JSON.stringify([q.point(w, Y), q.point(w, D)]));
});

// ═══ A4：merged 只在這一次真的搬了才為真════════════════════════════════════════════════════
await attempt('A4', async () => {
  const w = world();
  S.ledger(w, DANON, 'adjust', 5, 'a4-dev'); S.dev(w, DANON, 12);
  const r1 = await merge(w, DANON, U);
  const snap = dump(w);
  const r2 = await merge(w, DANON, U), r3 = await merge(w, DANON, U);
  ok('A4a 第一次合併 merged:true 且點數 12 搬進 U；重跑兩次 merged:false、仍是 200、點數不變（12，沒有再加）',
    r1.json.merged === true && r1.json.points === 12 && r2.json.merged === false && r3.json.merged === false && r2.status === 200 && r2.json.points === 12, [r1.text, r2.text, r3.text].join(' | '));
  ok('A4b 重跑之後庫逐列不變', dump(w) === snap, '');
});

// ═══ A5：字面 'ephemeral' 一律不收═════════════════════════════════════════════════════════
await attempt('A5', async () => {
  const w = world();
  const E = 'ephemeral';
  S.dev(w, E, 5); S.ledger(w, E, 'adjust', 7, 'a5-e'); S.unlock(w, E, 'shifen', 1, 4, 1000); S.ride(w, E, '2026-07-11', { requestId: 'a5-r' });
  S.contrib(w, SEG, E); S.sample(w, E, 'a5-s'); S.claim(w, E, 'a5-c'); S.board(w, SEG, { distinct: 5 });
  const before = dump(w);
  const rs = {
    submit: await submit(w, E), claim: await claim(w, E), redeem: await redeem(w, E, 'south-coast', nextReq()), ride: await ride(w, E),
    chips: await chipsMe(w, '?actor=' + E), me: await boMe(w, '?actor=' + E), merge: await merge(w, E, U),
  };
  ok('A5a 字面 ephemeral 送到 submit／claim／redeem／cloud-ride／chips-me／bounty-me／merge 一律 400 bad_actor',
    Object.values(rs).every(r => r.status === 400 && r.json && r.json.error === 'bad_actor'), JSON.stringify(Object.fromEntries(Object.entries(rs).map(([k, r]) => [k, r.status + ':' + (r.json && r.json.error)]))));
  ok('A5b 這些請求什麼都沒寫（庫逐列不變，連帳號列都沒補）', dump(w) === before, '');
  ok('A5c 純函式：isActorId 拒字面 ephemeral、仍收一般 id', _bounty.isActorId('ephemeral') === false && _bounty.isActorId('dev-user-000001') === true, '');
  const del = await delAccount(w, { actor: E }, as(U));
  ok('A5d 刪帳號（U）body 帶 actor:"ephemeral" → 200，但 ephemeral 名下六張明細表與點數一列都沒被刪',
    del.status === 200 && dump(w, [U]) === before, del.text);
});

// ═══ A6：兌換——actor 是帳號 uid：不帶自己的 Bearer 一律不准花═══════════════════════════════════════
await attempt('A6', async () => {
  const w = world();
  S.acct(w, U); S.ledger(w, U, 'adjust', 10, 'a6-u');
  const w0 = wallet(w);
  const c0 = fetchCalls.length;
  const noTok = await redeem(w, U, 'south-coast', nextReq());
  const c1 = fetchCalls.length;
  const other = await redeem(w, U, 'south-coast', nextReq(), as(Z));
  const bad = await redeem(w, U, 'south-coast', nextReq(), as(null));
  ok('A6a actor＝帳號 uid：不帶 token → 401 auth_required；帶別人（Z）的 token → 403 wrong_account；壞 token → 401 unauthorized',
    noTok.status === 401 && noTok.json.error === 'auth_required' && other.status === 403 && other.json.error === 'wrong_account' && bad.status === 401 && bad.json.error === 'unauthorized',
    JSON.stringify([noTok.json, other.json, bad.json]));
  ok('A6b 三個被擋的請求一個字都沒動（帳本、解鎖逐列相同、餘額仍 10）；不帶 token 的那個沒有打 Firebase', wallet(w) === w0 && q.bal(w, U) === 10 && c1 === c0, `calls=${c1 - c0}`);
  const c2 = fetchCalls.length;
  const own = await redeem(w, U, 'south-coast', nextReq(), as(U));
  ok('A6c 帶自己的 Bearer → 200：第 1 座 nth 1、cost 4、餘額 6；解鎖與 redeem 列都在 U 名下；Firebase 恰好查 1 次',
    own.status === 200 && own.json.nth === 1 && own.json.cost === 4 && own.json.balance === 6 && q.nUnlocks(w, U) === 1 && fetchCalls.length - c2 === 1, own.text);
  // Z 被擋的那兩次也各自補出了 Z 的帳號列（S0），但 Z 沒有拿到任何東西
  ok('A6d 被擋的 Z 沒有拿到任何東西（Z 名下帳本 0、解鎖 0）', q.nLedger(w, Z) === 0 && q.nUnlocks(w, Z) === 0, '');
});

// ═══ A7：兌換——actor 是併進帳號 U 的裝置 D：同樣要 U 的 Bearer ═════════════════════════════════════════════════
await attempt('A7', async () => {
  const w = world();
  S.acct(w, U); S.dev(w, D, 0, U); S.ledger(w, U, 'adjust', 10, 'a7-u');
  S.ledger(w, DANON, 'adjust', 10, 'a7-anon');
  const w0 = wallet(w);
  const noTok = await redeem(w, D, 'south-coast', nextReq());
  const other = await redeem(w, D, 'south-coast', nextReq(), as(Z));
  ok('A7a 併進 U 的舊裝置 id：不帶 token → 401 auth_required；帶別人（Z）的 token → 403 wrong_account；帳本與解鎖一個字都沒動',
    noTok.status === 401 && noTok.json.error === 'auth_required' && other.status === 403 && other.json.error === 'wrong_account' && wallet(w) === w0, JSON.stringify([noTok.json, other.json]));
  const own = await redeem(w, D, 'south-coast', nextReq(), as(U));
  ok('A7b 帶 U 的 Bearer → 200，扣的是 U 的帳：U 名下 1 座解鎖、1 筆 redeem（−4）、餘額 6；裝置名下什麼都沒有',
    own.status === 200 && own.json.balance === 6 && q.nUnlocks(w, U) === 1 && q.nUnlocks(w, D) === 0 && q.nLedger(w, D) === 0, own.text);
  const anon = await redeem(w, DANON, 'south-coast', nextReq());
  ok('A7c [對照] 從沒併過的匿名裝置憑自己的 id 兌換 → 200（不帶 token 也行；不是「一律擋」才綠）', anon.status === 200 && anon.json.balance === 6 && q.nUnlocks(w, DANON) === 1, anon.text);
});

// ═══ A8：雲端搭乘——同一套規則，加上「替受害者佔掉當天那一格」的攻擊══════════════════════════════════════
await attempt('A8', async () => {
  const w = world();
  S.acct(w, U); S.dev(w, D, 0, U); S.acct(w, V);
  const w0 = wallet(w);
  const rs = [await ride(w, U), await ride(w, D), await ride(w, U, {}, as(Z)), await ride(w, D, {}, as(Z)), await ride(w, U, {}, as(null))];
  ok('A8a 帳號 uid／併進帳號的裝置送雲端搭乘：不帶 token → 401 auth_required；別人的 token → 403 wrong_account；壞 token → 401 unauthorized',
    rs[0].status === 401 && rs[0].json.error === 'auth_required' && rs[1].status === 401 && rs[1].json.error === 'auth_required' &&
    rs[2].status === 403 && rs[2].json.error === 'wrong_account' && rs[3].status === 403 && rs[3].json.error === 'wrong_account' &&
    rs[4].status === 401 && rs[4].json.error === 'unauthorized', JSON.stringify(rs.map(r => r.json)));
  ok('A8b 五個被擋的請求什麼都沒寫（帳本、解鎖、雲端搭乘逐列相同）', wallet(w) === w0, '');
  const ownU = await ride(w, U, {}, as(U)), ownD = await ride(w, D, { day: YESTERDAY, startedAt: at(YESTERDAY, 9) }, as(U));
  ok('A8c 帶 U 的 Bearer：actor＝U、actor＝D 都 200，兩筆搭乘（今天、昨天）都在 U 名下、D 名下 0 列、rides＝2',
    ownU.status === 200 && ownD.status === 200 && ownD.json.rides === 2 && q.nRides(w, U) === 2 && q.nRides(w, D) === 0, JSON.stringify([ownU.json, ownD.json]));
  // C1：攻擊者不帶 token、用模擬器身分替受害者（V）送搭乘，想佔掉當天那一格（PK＝(actor, day)），讓受害者真正的搭乘吃 409 already_today
  const atk = await ride(w, V, { client: SIM, requestId: 'atk-req-0001' });
  ok('A8d 不帶 token、替受害者（帳號 V）送模擬器搭乘 → 401 auth_required，V 名下沒有多出任何一列', atk.status === 401 && atk.json.error === 'auth_required' && q.nRides(w, V) === 0, atk.text);
  const real = await ride(w, V, {}, as(V));
  ok('A8e 受害者本人（帶 Bearer）之後送真正的搭乘 → 200（不是 409 already_today）、rides 1、列是真機（simulator 0）', real.status === 200 && real.json.rides === 1 && same(q.rides(w, V).map(r => r.simulator), [0]), real.text);
  const anon = await ride(w, DANON);
  ok('A8f [對照] 從沒併過的匿名裝置送搭乘 → 200（不帶 token）', anon.status === 200 && q.nRides(w, DANON) === 1, anon.text);
});

// ═══ A9：chips-me——?actor= 的錢包規則、限流、Bearer 不跟 merged_into═════════════════════════════
await attempt('A9', async () => {
  const w = world();
  S.acct(w, U); S.dev(w, D, 0, U); S.ledger(w, U, 'adjust', 6, 'a9-u'); S.unlock(w, U, 'shifen', 1, 4, 1000);
  S.ledger(w, DANON, 'adjust', 3, 'a9-anon');
  const [byDev, byUid, byAnon, byBearer] = [await chipsMe(w, '?actor=' + D), await chipsMe(w, '?actor=' + U), await chipsMe(w, '?actor=' + DANON), await chipsMe(w, '', as(U))];
  ok('A9a ?actor＝併進帳號的裝置 → 401 auth_required、?actor＝帳號 uid → 401 auth_required；回應裡沒有任何餘額或解鎖',
    [byDev, byUid].every(r => r.status === 401 && same(r.json, { error: 'auth_required' })), JSON.stringify([byDev.json, byUid.json]));
  ok('A9b ?actor＝匿名裝置 → 200 餘額 3（憑 installId 讀自己的帳）；帶帳號 Bearer → 200 餘額 6、解鎖 shifen',
    byAnon.status === 200 && byAnon.json.balance === 3 && byBearer.status === 200 && byBearer.json.balance === 6 && byBearer.json.unlocked[0].scene === 'shifen', JSON.stringify([byAnon.json, byBearer.json]));
  const both = await chipsMe(w, '?actor=' + DANON, as(U));
  ok('A9c Bearer 與 ?actor= 都帶：Bearer 贏、?actor= 被無視（看到的是 U 的 6，不是匿名裝置的 3）', both.status === 200 && both.json.balance === 6, both.text);
  const bad = await chipsMe(w, '?actor=' + DANON, as(null));
  ok('A9d 壞 Bearer ＋ 匿名裝置的 ?actor= → 401 unauthorized（不降級成匿名讀取）', bad.status === 401 && bad.json.error === 'unauthorized', bad.text);
  // 舊版 F2 攻擊留下的髒列：U2 的列是帳號列、卻掛著 merged_into＝攻擊者 A2；Bearer 讀取不能被導向 A2 的帳
  const w2 = world();
  S.acct(w2, V, 40, A); S.acct(w2, A, 77); S.ledger(w2, V, 'adjust', 6, 'a9-v'); S.ledger(w2, A, 'adjust', 99, 'a9-a');
  const rv = await chipsMe(w2, '', as(V)), mv = await boMe(w2, '', as(V));
  ok('A9e 髒列（V 是帳號列、merged_into＝攻擊者）：V 帶自己的 Bearer 讀 chips-me 是自己的 6（不是攻擊者的 99）、讀 bounty-me 是自己的 40 點（不是 77）',
    rv.json.balance === 6 && mv.json.points === 40 && mv.json.actor === V, rv.text + ' | ' + mv.text);
  // bounty-me 的 ?actor= 走同一條錢包規則：舊版併進帳號的裝置不帶 Bearer 就讀得到帳號的點數與認領——
  // 裝置 token 是別人拿得到的字串（分享出去的舊網址、被看到的畫面），拿著它就能看帳號的東西。現在要帳號的 Bearer，與 chips-me 同一條。
  const w3 = world();
  S.acct(w3, U, 40); S.dev(w3, D, 0, U); S.dev(w3, DANON, 9);
  const viaDev = await boMe(w3, '?actor=' + D), viaUid = await boMe(w3, '?actor=' + U), viaAnon = await boMe(w3, '?actor=' + DANON), viaBearer = await boMe(w3, '', as(U));
  ok('A9f bounty-me 的 ?actor=：併進 U 的裝置 → 401 auth_required、帳號 uid → 401 auth_required（回應裡沒有點數）；匿名裝置 → 200 自己的 9；帶 U 的 Bearer → 200 帳號的 40',
    [viaDev, viaUid].every(r => r.status === 401 && same(r.json, { error: 'auth_required' })) &&
      viaAnon.status === 200 && viaAnon.json.points === 9 && viaBearer.status === 200 && viaBearer.json.points === 40 && viaBearer.json.actor === U,
    [viaDev.text, viaUid.text, viaAnon.text.slice(0, 60), viaBearer.text.slice(0, 60)].join(' | '));
});

// ═══ A10：上傳與認領（賺）——actor 自己是帳號 uid 才要 Bearer；併過的裝置與匿名裝置不用══════════════════════════
await attempt('A10', async () => {
  const w = world();
  S.acct(w, U); S.dev(w, D, 0, U); S.board(w, SEG, { distinct: 0 });
  const dSub = dump(w);
  const noTok = [await submit(w, U), await claim(w, U)];
  const other = [await submit(w, U, {}, as(Z)), await claim(w, U, {}, as(Z))];
  const bad = [await submit(w, U, {}, as(null)), await claim(w, U, {}, as(null))];
  ok('A10a actor＝帳號 uid 的上傳與認領：不帶 token → 401 auth_required；別人（Z）的 token → 403 wrong_account；壞 token → 401 unauthorized',
    noTok.every(r => r.status === 401 && r.json.error === 'auth_required') && other.every(r => r.status === 403 && r.json.error === 'wrong_account') &&
    bad.every(r => r.status === 401 && r.json.error === 'unauthorized'), JSON.stringify([noTok, other, bad].map(x => x.map(r => r.json))));
  ok('A10b 六個被擋的請求什麼都沒寫（樣本、認領逐列相同；Z 的帳號列除外）', dump(w, [Z]) === dSub, '');
  const own = [await submit(w, U, {}, as(U)), await claim(w, U, {}, as(U))];
  ok('A10c 帶自己的 Bearer → 200：樣本與認領都記在 U 名下', own.every(r => r.status === 200) && q.nSamples(w, U) === 1 && q.nClaims(w, U) > 0, JSON.stringify(own.map(r => r.json)));
  // 併進 U 的裝置：不帶 token 照樣賺（只是把成果記進帳號），這是「賺」不是「花」
  const dev = [await submit(w, D), await claim(w, D)];
  ok('A10d 併進 U 的裝置不帶 token 上傳與認領 → 200，成果記進帳號 U（樣本 2 筆、認領在 U 名下），裝置名下 0 列',
    dev.every(r => r.status === 200) && q.nSamples(w, U) === 2 && q.nSamples(w, D) === 0 && q.nClaims(w, D) === 0, JSON.stringify(dev.map(r => r.json)));
  // 網頁的認領形狀（只有 actor＋cardId、沒有 Bearer）：匿名裝置照常
  const web = await claim(w, DANON), sub = await submit(w, DANON);
  ok('A10e 網頁形狀的認領（actor＋cardId、沒有任何標頭）與匿名裝置的上傳照常 200，記在裝置自己名下', web.status === 200 && sub.status === 200 && q.nClaims(w, DANON) > 0 && q.nSamples(w, DANON) === 1, JSON.stringify([web.json, sub.json]));
  // 上傳端有帶 Bearer 但 actor 是匿名裝置：照樣以裝置身分記帳（Bearer 只是讓帳號列存在）
  const w2 = world();
  const sb = await submit(w2, DANON, {}, as(Z));
  ok('A10f 帶著別人（Z）的有效 Bearer 上傳匿名裝置的批次 → 200，樣本記在裝置名下（不是 Z 名下）', sb.status === 200 && q.nSamples(w2, DANON) === 1 && q.nSamples(w2, Z) === 0, sb.text);
});

// ═══ A11：刪帳號——body 傳來的 deviceActor 不能刪別人的 v2 錢包══════════════════════════════════════════
await attempt('A11', async () => {
  const w = world();
  const seed = (actor, n) => {
    for (let i = 0; i < n[0]; i++) S.ledger(w, actor, 'adjust', 1, `${actor}|a11-l${i}`);
    for (let i = 0; i < n[1]; i++) S.unlock(w, actor, ['south-coast', 'shifen', 'viaduct', 'alishan'][i], i + 1, 4, 100 + i);
    for (let i = 0; i < n[2]; i++) S.ride(w, actor, `2026-07-1${i}`);
    for (let i = 0; i < n[3]; i++) S.contrib(w, `tra_sched|南迴線|站${i}|站${i + 1}`, actor);
  };
  // X 是呼叫者；DX 是併進 X 的裝置；DV 是受害者「還沒併進任何帳號」的裝置；V 是受害者的帳號
  S.acct(w, X, 40); S.dev(w, DX, 0, X); S.dev(w, DV, 9); S.acct(w, V, 5);
  seed(X, [2, 1, 2, 3]); seed(DX, [1, 2, 1, 1]); seed(DV, [3, 1, 1, 2]); seed(V, [2, 2, 2, 2]);
  const T = ['chip_ledger', 'garage_unlocks', 'cloud_rides', 'bounty_seg_contrib'];
  const vBefore = T.map(t => rows(w, `SELECT * FROM ${t} WHERE actor IN (?,?) ORDER BY 1,2`, DV, V));
  const del = await delAccount(w, { actor: DV }, as(X));
  const vAfter = T.map(t => rows(w, `SELECT * FROM ${t} WHERE actor IN (?,?) ORDER BY 1,2`, DV, V));
  ok('A11a X 刪帳號時 body 帶受害者還沒併進任何帳號的裝置（DV）→ 200，但受害者 DV 與 V 的 v2 四張表逐列沒動', del.status === 200 && canon(vBefore) === canon(vAfter) && vBefore[0].length > 0, del.text);
  ok('A11b X 自己與併進 X 的裝置（DX）的 v2 四張表一列都不在了', T.every(t => w.db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE actor IN (?,?)`).get(X, DX).c === 0), '');
  ok('A11c 回應如實回報刪了幾列：chips 3（X 2＋DX 1）、unlocks 3、cloudRides 3、contrib 4（DV 的不算）', del.json && same({ c: del.json.deleted.chips, u: del.json.deleted.unlocks, r: del.json.deleted.cloudRides, s: del.json.deleted.contrib }, { c: 3, u: 3, r: 3, s: 4 }),
    JSON.stringify(del.json && del.json.deleted));
});
await attempt('A11d', async () => {
  // body 的 deviceActor 填成「別人的帳號」（uid）：那是帳號不是裝置。它的 v1 樣本與認領、點數列（＝帳號身分的標記）不能被刪；
  // 否則受害者的帳號標記被抹掉，下一次不帶 token 的 actor＝V 請求就被當成「匿名裝置」放行，S4 的錢包規則等於被繞過。
  const w = world();
  S.acct(w, X, 1); S.acct(w, V, 40); S.dev(w, DV, 0, V);
  S.sample(w, V, 'a11d-s'); S.claim(w, V, 'a11d-c'); S.ledger(w, V, 'adjust', 6, 'a11d-l'); S.unlock(w, V, 'shifen', 1, 4, 1000);
  const before = dump(w, [X]);
  const del = await delAccount(w, { actor: V }, as(X));
  ok('A11d X 刪帳號時 body 帶「別人的帳號」V 當 deviceActor → 200，但 V 的帳號列（40 點）、樣本、認領與 v2 錢包一個字都沒動',
    del.status === 200 && dump(w, [X]) === before && isAcct(w, V, { points: 40 }), del.text + ' ' + JSON.stringify(q.point(w, V)));
  const noTok = await redeem(w, V, 'south-coast', nextReq());
  ok('A11e V 仍是帳號：不帶 token 的兌換 → 401 auth_required（不會因為帳號列被刪而變成「匿名裝置」被花掉）', noTok.status === 401 && noTok.json.error === 'auth_required', noTok.text);
});
for (const [tag, body] of [['A11f', {}], ['A11g', { actor: DANON }]]) {
  await attempt(tag, async () => {
    // 舊版 F2 攻擊留下的髒列：V 是帳號列（7 點），卻掛著 merged_into＝攻擊者 A。A 刪自己的帳號時，V 不是 A 的裝置，不能被一起帶走
    // （「merged_into 指向我」只算裝置：uid 欄 NULL 的列）。A11f 是不帶 body、A11g 是帶一個不相干的匿名裝置 DANON（兩條 SQL 路徑各一）。
    const w = world();
    S.acct(w, A, 3); S.acct(w, V, 7, A); S.dev(w, DANON, 2);
    S.sample(w, V, `${tag}-s`); S.claim(w, V, `${tag}-c`); S.ledger(w, V, 'adjust', 6, `${tag}-l`); S.unlock(w, V, 'shifen', 1, 4, 1000);
    S.ride(w, V, '2026-07-11', { requestId: `${tag}-r` }); S.contrib(w, SEG, V);
    const before = dump(w, [A, DANON]);
    const del = await delAccount(w, body, as(A));
    ok(`${tag} A 刪自己的帳號${body.actor ? '（body 帶不相干的匿名裝置）' : ''} → 200；掛著 merged_into＝A 的髒帳號列 V（7 點）與它的樣本、認領、v2 四張表一個字都沒動（V 不是 A 的裝置）`,
      del.status === 200 && dump(w, [A, DANON]) === before && same(q.point(w, V), { uid: V, points: 7, merged_into: A }), del.text + ' ' + JSON.stringify(q.point(w, V)));
  });
}

// ═══ A12：兌換重送——同一個 requestId 不能拿去兌換另一座═══════════════════════════════════════════════
await attempt('A12', async () => {
  const w = world();
  S.ledger(w, DANON, 'adjust', 30, 'a12-seed');
  const r1 = await redeem(w, DANON, 'south-coast', 'req-a12-0001');       // 第 1 座 4
  const r2 = await redeem(w, DANON, 'shifen', 'req-a12-0002');            // 第 2 座 8
  ok('A12a [fixture] 兩座都兌換成功：4＋8，餘額 18', r1.status === 200 && r2.status === 200 && r1.json.cost === 4 && r2.json.cost === 8 && q.bal(w, DANON) === 18, JSON.stringify([r1.json, r2.json]));
  const w0 = wallet(w);
  const bad = await redeem(w, DANON, 'shifen', 'req-a12-0001');           // 同一個 requestId（當初兌換 south-coast）拿去兌換「剛好已經解鎖過」的 shifen
  ok('A12b 同一個 requestId 拿去兌換另一座（那一座剛好已經解鎖過）→ 409 conflict（舊版回 200，把別座的解鎖當成這一筆的結果）；一個字都沒動',
    bad.status === 409 && bad.json.error === 'conflict' && wallet(w) === w0, bad.text);
  const same1 = await redeem(w, DANON, 'south-coast', 'req-a12-0001');
  ok('A12c 同 requestId、同場景重送 → 200：scene south-coast、cost 4（當初扣的）、nth 1；balance 18／unlocked 2 座是現況；沒有再扣',
    same1.status === 200 && same1.json.scene === 'south-coast' && same1.json.cost === 4 && same1.json.nth === 1 && same1.json.balance === 18 && same1.json.unlocked.length === 2 && wallet(w) === w0, same1.text);
  // 合併之後 nth 重排：U 有 shifen@100（第 1 座 4）與 south-coast@1000（第 2 座 8）；裝置 D 較晚才兌換 south-coast（第 1 座 4）→ 併進 U 之後
  // 較晚那份被退款丟掉、D 的那筆 redeem 帳本列改名成 U。重送 D 當初的 requestId：cost 仍是當初扣的 4（不是留下那份的 8）、nth 是現況 2（不是當初的 1）
  const w2 = world();
  S.acct(w2, U); S.ledger(w2, U, 'adjust', 30, 'a12-u'); S.ledger(w2, U, 'redeem', -4, 'a12-u-r1'); S.ledger(w2, U, 'redeem', -8, 'a12-u-r2');
  S.unlock(w2, U, 'shifen', 1, 4, 100); S.unlock(w2, U, 'south-coast', 2, 8, 1000);
  S.ledger(w2, D, 'adjust', 10, 'a12-d');
  const first = await redeem(w2, D, 'south-coast', 'req-a12-0003');
  const mg = await merge(w2, D, U);
  const replay = await redeem(w2, D, 'south-coast', 'req-a12-0003', as(U));
  ok('A12d [fixture] D 匿名兌換 south-coast 成功（第 1 座 4）；合併進 U：較晚那份退款丟掉、U 的 south-coast 是第 2 座 cost 8',
    first.status === 200 && first.json.nth === 1 && first.json.cost === 4 && mg.json.merged === true && same(q.unlocks(w2, U).map(u => [u.scene, u.nth, u.cost]), [['shifen', 1, 4], ['south-coast', 2, 8]]), JSON.stringify(q.unlocks(w2, U)));
  ok('A12e 合併之後帶 U 的 Bearer 重送 D 當初的 requestId → 200：cost 4（當初扣的價，不是留下那份的 8）、nth 2（現況，不是當初的 1）、balance／unlocked 讀現況；沒有再扣',
    replay.status === 200 && replay.json.scene === 'south-coast' && replay.json.cost === 4 && replay.json.nth === 2 && replay.json.unlocked.length === 2 &&
    replay.json.balance === q.bal(w2, U) && q.bal(w2, U) === 30 - 4 - 8 + 10 - 4 + 4, JSON.stringify(replay.json) + ' bal=' + q.bal(w2, U));
});

// ═══ A13：雲端搭乘重送——兩天之後、合併之後都要對得上══════════════════════════════════════════════════
await attempt('A13', async () => {
  const w = world();
  S.ride(w, DANON, '2026-07-20', { requestId: 'a13-old1' }); S.ride(w, DANON, '2026-07-21', { requestId: 'a13-old2' });     // 已有 2 次：這次是第 3 次、剛好發第 1 顆
  const first = await ride(w, DANON, { requestId: 'req-a13-0001' });
  ok('A13a [fixture] 第 3 次搭乘 → 200 rides 3、chipAwarded true、拿到 1 顆雲端籌碼', first.status === 200 && first.json.rides === 3 && first.json.chipAwarded === true && q.bal(w, DANON) === 1, first.text);
  w.at(NOW_MS + 2 * 86400e3);                                                             // 兩天之後：第一次的營運日早就出了「台北今天或昨天」的窗
  const replay = await ride(w, DANON, { requestId: 'req-a13-0001' });
  ok('A13b 兩天後用同一個 requestId 重送（body 仍是原本那一天）→ 200 且與第一次逐位元相同（不是 400 bad_day）；沒有再發籌碼（餘額仍 1）',
    replay.status === 200 && replay.text === first.text && q.bal(w, DANON) === 1 && q.nRides(w, DANON) === 3, replay.text + ' vs ' + first.text);
  const fresh = await ride(w, DANON, { requestId: 'req-a13-0002', day: TODAY });
  ok('A13c [對照] 兩天後「新的」搭乘（新 requestId）送原本那一天 → 仍是 400 bad_day（窗口只移到重送判斷之後，沒有被拿掉）', fresh.status === 400 && fresh.json.error === 'bad_day', fresh.text);
  const wrongDay = await ride(w, DANON, { requestId: 'req-a13-0001', day: YESTERDAY });
  ok('A13d 同一個 requestId 拿去送別的營運日 → 409 conflict（重送判斷仍檢查營運日一致）', wrongDay.status === 409 && wrongDay.json.error === 'conflict', wrongDay.text);
  // 合併把那筆搭乘改名之後：重送要用「解析後的身分」對得上
  const w2 = world();
  S.acct(w2, U);
  S.ride(w2, D, '2026-07-20', { requestId: 'a13-o1' }); S.ride(w2, D, '2026-07-21', { requestId: 'a13-o2' });
  const f2 = await ride(w2, D, { requestId: 'req-a13-0003' });
  const mg = await merge(w2, D, U);
  const r2 = await ride(w2, D, { requestId: 'req-a13-0003' }, as(U));
  ok('A13e D 送搭乘後併進 U：搭乘列改名成 U；帶 U 的 Bearer 用 D 當初的 requestId 重送 → 200 且與第一次逐位元相同（rides 3、chipAwarded true）',
    f2.status === 200 && mg.json.merged === true && q.nRides(w2, U) === 3 && r2.status === 200 && r2.text === f2.text, r2.text + ' vs ' + f2.text);
  // 合併把那筆搭乘「丟掉」（兩邊同一天各有一筆、留了另一筆）：重送找不到 → 照新搭乘的規則走，同一天已有一筆 → 409 already_today
  const w3 = world();
  S.acct(w3, U); S.ride(w3, U, TODAY, { requestId: 'a13-u-today', at: 1000 });
  const f3 = await ride(w3, D, { requestId: 'req-a13-0004' });                         // D 較晚（created_at＝現在）→ 併進 U 時被丟掉
  const mg3 = await merge(w3, D, U);
  const r3 = await ride(w3, D, { requestId: 'req-a13-0004' }, as(U));
  ok('A13f 那筆搭乘被合併丟掉（U 同一天有更早的一筆）：重送 → 409 already_today（不是 200 假成功、也不是 500）；U 仍只有 1 列',
    f3.status === 200 && mg3.json.merged === true && q.nRides(w3, U) === 1 && r3.status === 409 && r3.json.error === 'already_today', r3.text);
});

// ═══ A14：chips-me 與 bounty-me 的 ?actor= 限流════════════════════════════════════════════════════════════════════
await attempt('A14', async () => {
  const wBlk = world({ env: { BOUNTY_LIMITER: limiter(true) } });
  S.ledger(wBlk, DANON, 'adjust', 3, 'a14-anon'); S.acct(wBlk, U); S.ledger(wBlk, U, 'adjust', 6, 'a14-u');
  const noBearer = await chipsMe(wBlk, '?actor=' + DANON);
  ok('A14a ?actor= 路徑被 BOUNTY_LIMITER 擋下 → 429 rate_limited，本文沒有餘額', noBearer.status === 429 && same(noBearer.json, { error: 'rate_limited' }), noBearer.text);
  const withBearer = await chipsMe(wBlk, '', as(U));
  ok('A14b [對照] 同一個被擋的 BOUNTY_LIMITER 不影響 Bearer 那條（Bearer 走 AUTH_LIMITER）→ 200 餘額 6', withBearer.status === 200 && withBearer.json.balance === 6, withBearer.text);
  const wAuthBlk = world({ env: { AUTH_LIMITER: limiter(true) } });
  S.ledger(wAuthBlk, DANON, 'adjust', 3, 'a14-anon2');
  const plain = await chipsMe(wAuthBlk, '?actor=' + DANON), bearerBlk = await chipsMe(wAuthBlk, '', as(U));
  ok('A14c [對照] AUTH_LIMITER 被擋：?actor= 路徑照樣 200（它不走 AUTH_LIMITER）；Bearer 那條 429', plain.status === 200 && plain.json.balance === 3 && bearerBlk.status === 429, JSON.stringify([plain.json, bearerBlk.json]));
  // bounty-me 的 ?actor= 路徑：同樣不驗身分、免費，舊版沒有限流，一個匿名 actor 連打就能大量燒 D1 讀取
  S.dev(wBlk, DANON, 4); S.dev(wAuthBlk, DANON, 4);
  const meBlk = await boMe(wBlk, '?actor=' + DANON), meBearer = await boMe(wBlk, '', as(U));
  ok('A14d bounty-me 的 ?actor= 路徑被 BOUNTY_LIMITER 擋下 → 429 rate_limited，本文沒有點數', meBlk.status === 429 && same(meBlk.json, { error: 'rate_limited' }), meBlk.text);
  ok('A14e [對照] 同一個被擋的 BOUNTY_LIMITER 不影響 bounty-me 的 Bearer 那條 → 200、帳號 U 自己的帳', meBearer.status === 200 && meBearer.json.actor === U, meBearer.text.slice(0, 120));
  const mePlain = await boMe(wAuthBlk, '?actor=' + DANON), meBearerBlk = await boMe(wAuthBlk, '', as(U));
  ok('A14f [對照] AUTH_LIMITER 被擋：bounty-me 的 ?actor= 照樣 200（點數 4）；Bearer 那條 429', mePlain.status === 200 && mePlain.json.points === 4 && meBearerBlk.status === 429,
    JSON.stringify([mePlain.status, mePlain.json && mePlain.json.points, meBearerBlk.status]));
});

// ═══ A15：壞 Bearer 一律 401 unauthorized，不降級成匿名═════════════════════════════════════════════════════
await attempt('A15', async () => {
  const w = world();
  S.board(w, SEG, { distinct: 0 }); S.ledger(w, DANON, 'adjust', 10, 'a15-anon');
  const before = dump(w);
  const rs = [await redeem(w, DANON, 'south-coast', nextReq(), as(null)), await ride(w, DANON, {}, as(null)), await submit(w, DANON, {}, as(null)),
    await claim(w, DANON, {}, as(null)), await chipsMe(w, '?actor=' + DANON, as(null)), await merge(w, DANON, null, as(null))];
  ok('A15a 匿名裝置的兌換／雲端搭乘／上傳／認領／chips-me／合併，帶著 Firebase 判無效的 Bearer → 一律 401 unauthorized', rs.every(r => r.status === 401 && r.json.error === 'unauthorized'), JSON.stringify(rs.map(r => r.status + ':' + (r.json && r.json.error))));
  ok('A15b 什麼都沒寫（庫逐列不變）', dump(w) === before, '');
  const wNoKey = world({ env: { FIREBASE_WEB_API_KEY: undefined } });
  S.ledger(wNoKey, DANON, 'adjust', 10, 'a15-nokey');
  const c0 = fetchCalls.length;
  const nk = await redeem(wNoKey, DANON, 'south-coast', nextReq(), as(U));
  ok('A15c 伺服器沒設 FIREBASE_WEB_API_KEY：帶 Bearer 的兌換 → 401 unauthorized，而且沒有打出去', nk.status === 401 && nk.json.error === 'unauthorized' && fetchCalls.length === c0 && q.nUnlocks(wNoKey, DANON) === 0, nk.text);
});

// ═══ A16：帶著有效 Bearer 的寫入，都先補出（或收回）帳號列═════════════════════════════════════════════════════
await attempt('A16', async () => {
  const F = ['uid-fresh-00001', 'uid-fresh-00002', 'uid-fresh-00003', 'uid-fresh-00004', 'uid-fresh-00005', 'uid-fresh-00006', 'uid-fresh-00007'];
  const w = world();
  S.board(w, SEG, { distinct: 0 }); S.ledger(w, DANON, 'adjust', 30, 'a16-anon');
  // 每個端點各用一位從沒出現過的 uid，對象是匿名裝置（身分不受 Bearer 影響），只看帳號列有沒有被補出來
  const r1 = await redeem(w, DANON, 'south-coast', nextReq(), as(F[0]));
  const r2 = await ride(w, DANON, {}, as(F[1]));
  const r3 = await submit(w, DANON, {}, as(F[2]));
  const r4 = await claim(w, DANON, {}, as(F[3]));
  ok('A16a 兌換／雲端搭乘／上傳／認領各帶一位新 uid 的有效 Bearer（對象是匿名裝置）→ 都 200，而且每一位的帳號列都被補出來（uid＝自己、0 點、沒有 merged_into）',
    [r1, r2, r3, r4].every(r => r.status === 200) && [0, 1, 2, 3].every(i => isAcct(w, F[i])), JSON.stringify([r1.status, r2.status, r3.status, r4.status]) + JSON.stringify(F.slice(0, 4).map(f => q.point(w, f))));
  // 合併的每一種結果都要補帳號列：自己併自己、來源是帳號（400）、來源是併進別人的裝置（409）、一般成功（200）
  const self = await merge(w, F[4], F[4]);
  S.acct(w, V, 3); const notDev = await merge(w, V, F[5]);
  S.dev(w, 'dev-elsewhere-01', 0, X); const elsewhere = await merge(w, 'dev-elsewhere-01', F[6]);
  ok('A16b 合併：自己併自己 200、來源是別人的帳號 400、來源已併進別人 409——三種結果之後，呼叫者的帳號列都存在（uid＝自己、0 點、沒有 merged_into）',
    self.status === 200 && notDev.status === 400 && elsewhere.status === 409 && [4, 5, 6].every(i => isAcct(w, F[i])), JSON.stringify([self.status, notDev.status, elsewhere.status]) + JSON.stringify(F.slice(4).map(f => q.point(w, f))));
  ok('A16c 自己併自己的回應形狀不變：{ok:true, uid, points:0, merged:false}', same(self.json, { ok: true, uid: F[4], points: 0, merged: false }), self.text);
  // 條件式 upsert 的對照：帳號列已經是常態（uid 對、沒有 merged_into）時，再帶 Bearer 不改它的點數
  S.acct(w, U, 25);
  const keep = await redeem(w, DANON, 'shifen', nextReq(), as(U));
  ok('A16d [對照] 已經有帳號列（25 點）的 uid 再帶 Bearer 寫入：點數不被歸零（S0 只補、不重設）', keep.status === 200 && same(q.point(w, U), { uid: U, points: 25, merged_into: null }), keep.text + JSON.stringify(q.point(w, U)));
});

ok('Z 這支腳本全程只打過 Firebase 查 uid 的端點（其餘連線一律丟例外）', fetchCalls.every(u => u.includes('identitytoolkit.googleapis.com')), String(fetchCalls.length) + ' 次');
const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
