// 車庫車款兌換的後端驗收：POST /api/garage-collect、chips-me 的 items、帳號合併的車款退款、刪帳號（schema/0021 的 garage_items）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ BOUNTY_NOW 釘死；不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_collect.mjs
//
// 期望值全部寫死在這裡，不呼叫實作去產生期望（scripts/bounty_chips_core.mjs 只在 P 組驗它自己）：
//   ・產品規則：每款固定 150 點，不隨兌換順序漲，跟場景的「第 1 座 200、之後每座 300」分開算；規則檔 chips.items 列了價格的那款才收。
//   ・測試用的價目表寫在這裡（ITEMS），不讀正式規則檔的 chips.items（上線開關，哪幾款開賣會變）；K1 把正式規則檔的 chips.items 拿掉，驗「沒列就不收」。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準。
//
// ⚠️ 假 D1 的保真度同 verify_bounty_redeem.mjs 檔頭：batch 是排隊序列化的，C 組只證明「序列化之後的各種交錯」安全。
//
// 分組：K 規則開關　S 兌換與錢包　I 冪等與衝突　C 併發　M 帳號合併　D 刪帳號　A 身分　G 閘門　P 純函式
import { readFileSync } from 'node:fs';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';
import { itemPrice, canCollect } from './bounty_chips_core.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// 對外連線偵測：只有 Firebase 查 uid 是合法的外連（withFirebase 單獨替身），其餘一律丟例外
const outbound = [];
globalThis.fetch = async (u) => { outbound.push(String(u)); throw new Error('offline: ' + String(u)); };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const SCN = RULES.chips.scenes;
const ITEMS = { 'train:dr3000': 150, 'train:ct250': 150, 'train:fuxing': 150 };   // 測試用價目表（產品規則：每款 150）
const RULES_I = { ...RULES, chips: { ...RULES.chips, items: ITEMS } };
const RULES_OFF = { ...RULES, chips: Object.fromEntries(Object.entries(RULES.chips).filter(([k]) => k !== 'items')) };   // 上線開關關著
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const same = (a, b) => canon(a) === canon(b);

const NOW_MS = Date.parse('2026-07-29T02:00:00Z');
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });

function world(over = {}) {
  const rules = over.rules || RULES_I;
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const w = { db, sql: [], beforeBatch: null };
  const DB = {
    prepare: s => { w.sql.push(s); return DELAY_DB.prepare(s); },
    exec: s => DELAY_DB.exec(s),
    batch: async st => {
      if (w.beforeBatch) { const h = w.beforeBatch; w.beforeBatch = null; h(); }
      return DELAY_DB.batch(st);
    },
  };
  const ASSETS = { fetch: async () => new Response(JSON.stringify(rules), { status: 200 }) };
  w.env = { DELAY_DB: DB, ASSETS, BOUNTY_LIMITER: limiter(false), AUTH_LIMITER: limiter(false), BOUNTY_NOW: String(NOW_MS),
    FIREBASE_WEB_API_KEY: 'k', ...(over.env || {}) };
  return w;
}

// ── 呼叫端 ─────────────────────────────────────────────────────────────────
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
async function fin(res) { const text = await res.text(); return { status: res.status, text, json: parse(text) }; }
async function call(fn, request, env) { _bounty.bountyResetMemCaches(); return fin(await fn(request, env)); }
const jpost = (path, b, hdr = {}, method = 'POST') => req(path, {
  method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr },
  ...(method === 'GET' ? {} : { body: typeof b === 'string' ? b : JSON.stringify(b) }) });
const collect = (w, b, hdr = {}, env) => call(_bounty.garageCollect, jpost('/api/garage-collect', b, hdr), env || w.env);
const redeem = (w, b, hdr = {}) => call(_bounty.garageRedeem, jpost('/api/garage-redeem', b, hdr), w.env);
const me = (w, query = '', hdr = {}) => call(_bounty.chipsMe, req('/api/chips-me' + query, { headers: hdr }), w.env);
const mergeCall = (w, dev, tok) => call(_bounty.bountyMerge, jpost('/api/bounty-merge', { actor: dev }, { Authorization: 'Bearer ' + tok }), w.env);
const cb = (actor, item, requestId, extra = {}) => ({ actor, item, requestId, ...extra });
async function withFirebase(uid, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => uid ? new Response(JSON.stringify({ users: [{ localId: uid }] }), { status: 200 }) : new Response('{}', { status: 400 });
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

// ── 種子與讀庫（一律自己寫 SQL）──────────────────────────────────────────────
let seq = 0;
const put = {
  ledger: (db, actor, kind, delta, o = {}) => db.prepare('INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES (?,?,?,?,?,?,?,?)')
    .run(o.id || `seed-${++seq}`, actor, kind, delta, o.ref || `seed-ref-${++seq}`, null, o.at ?? NOW_MS - 1000, 'point'),
  item: (db, actor, item, cost, at) => db.prepare("INSERT INTO garage_items (actor,item,cost,created_at,unit) VALUES (?,?,?,?,'point')").run(actor, item, cost, at),
  unlock: (db, actor, scene, nth, cost, at) => db.prepare("INSERT INTO garage_unlocks (actor,scene,nth,cost,created_at,unit) VALUES (?,?,?,?,?,'point')").run(actor, scene, nth, cost, at),
  // 與正式合併留下的狀態一樣：來源是墓碑（merged_into），目的地是帳號列（uid 欄有值）
  merge: (db, from, to) => {
    db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,NULL,0,?,1)').run(from, to);
    db.prepare('INSERT OR IGNORE INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,0,NULL,1)').run(to, to);
  },
  account: (db, uid) => db.prepare('INSERT OR IGNORE INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,0,NULL,1)').run(uid, uid),
};
const q = {
  bal: (db, a) => db.prepare('SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=?').get(a).n,
  items: (db, a) => db.prepare('SELECT item, cost, created_at AS at, unit FROM garage_items WHERE actor=? ORDER BY item').all(a).map(r => ({ ...r })),
  nItems: (db, a) => db.prepare('SELECT COUNT(*) c FROM garage_items WHERE actor=?').get(a).c,
  nAllItems: db => db.prepare('SELECT COUNT(*) c FROM garage_items').get().c,
  redeems: (db, a) => db.prepare("SELECT id, delta, ref, unit FROM chip_ledger WHERE actor=? AND kind='redeem' ORDER BY id").all(a).map(r => ({ ...r })),
  merges: (db, a) => db.prepare("SELECT id, delta, ref, unit FROM chip_ledger WHERE actor=? AND kind='merge' ORDER BY id").all(a).map(r => ({ ...r })),
  nLedger: db => db.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c,
};

// ═══ K：規則開關（chips.items 列了價格的那款才收）════════════════════════════════
await attempt('K1', async () => {
  const A = 'device-k1aa0001';
  const w = world({ rules: RULES_OFF });                     // 正式規則檔拿掉 chips.items
  put.ledger(w.db, A, 'adjust', 1000);
  const r = await collect(w, cb(A, 'train:dr3000', 'req-k1-000001'));
  ok('K1 規則檔沒有 chips.items（上線開關關著）：換 dr3000 → 400 unknown_item，帳本與 garage_items 一列都沒多',
    r.status === 400 && r.json.error === 'unknown_item' && q.nItems(w.db, A) === 0 && q.nLedger(w.db) === 1, r.text);
  const m = await me(w, `?actor=${A}`);
  ok('K1b 同一個人讀錢包：items []（欄位在、空的），餘額 1000 沒動', m.status === 200 && same(m.json.items, []) && m.json.balance === 1000, m.text);
});
await attempt('K2', async () => {
  const A = 'device-k2aa0001';
  const w = world({ rules: { ...RULES, chips: { ...RULES.chips,
    items: { 'train:dr3000': 150, 'train:zero': 0, 'train:frac': 1.5, 'train:neg': -150, 'train:str': '150', 'train:bad|x': 150, 'dr3000': 150 } } } });
  put.ledger(w.db, A, 'adjust', 1000);
  const ids = ['train:emu300', 'train:zero', 'train:frac', 'train:neg', 'train:str', 'train:bad|x', 'dr3000', 'train:DR3000', ''];
  const rs = [];
  for (const [i, id] of ids.entries()) rs.push(await collect(w, cb(A, id, `req-k2-${String(i).padStart(6, '0')}`)));
  ok('K2 價目表沒列的款、價格是 0／小數／負數／字串、id 含「|」、少了 train: 前綴、大寫、空字串 → 九個都 400 unknown_item，一列都沒寫',
    rs.every(r => r.status === 400 && r.json && r.json.error === 'unknown_item') && q.nItems(w.db, A) === 0 && q.nLedger(w.db) === 1,
    JSON.stringify(rs.map(r => r.status + ' ' + r.text)));
  const r = await collect(w, cb(A, 'train:dr3000', 'req-k2-ok00001'));
  ok('K2b [對照] 同一份價目表裡格式正確的那款照收：dr3000 → 200、cost 150', r.status === 200 && r.json.cost === 150, r.text);
  const nob = await collect(w, { actor: A, requestId: 'req-k2-noitem1' });
  ok('K2c 沒帶 item 欄 → 400 unknown_item', nob.status === 400 && nob.json.error === 'unknown_item', nob.text);
});

// ═══ S：兌換成功、錢包、跟場景的價格分開══════════════════════════════════════════
await attempt('S1', async () => {
  const A = 'device-s1aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 400);
  const r = await collect(w, cb(A, 'train:dr3000', 'req-s1-000001'));
  ok('S1a 400 點換 dr3000 → 200 {ok, item, cost 150, balance 250, items [{dr3000, at}]}，回應恰好這五欄',
    r.status === 200 && same(r.json, { ok: true, item: 'train:dr3000', cost: 150, balance: 250, items: [{ item: 'train:dr3000', at: NOW_MS }] }), r.text);
  ok("S1b 帳本恰一筆 redeem：id 'item|train:dr3000|<actor>.<requestId>'、ref '<actor>.<requestId>'、−150、unit point",
    same(q.redeems(w.db, A), [{ id: `item|train:dr3000|${A}.req-s1-000001`, delta: -150, ref: `${A}.req-s1-000001`, unit: 'point' }]), JSON.stringify(q.redeems(w.db, A)));
  ok('S1c garage_items 恰一列：dr3000、cost 150、created_at＝現在、unit point；garage_unlocks 一列都沒有（車款不佔場景的「第幾座」）',
    same(q.items(w.db, A), [{ item: 'train:dr3000', cost: 150, at: NOW_MS, unit: 'point' }]) &&
      w.db.prepare('SELECT COUNT(*) c FROM garage_unlocks').get().c === 0, JSON.stringify(q.items(w.db, A)));
  const m = await me(w, `?actor=${A}`);
  ok('S1d 讀錢包：items [{dr3000, at}]（不帶 cost）、balance 250、unlocked []、nextCost 仍是 200（換車不讓場景變貴）',
    m.status === 200 && same(m.json.items, [{ item: 'train:dr3000', at: NOW_MS }]) && m.json.balance === 250 &&
      same(m.json.unlocked, []) && m.json.nextCost === 200, m.text);
  const sc = await redeem(w, { actor: A, scene: SCN[0], requestId: 'req-s1-scene01' });
  ok('S1e 接著兌換場景：仍是第 1 座、200 點（nth 1、cost 200、balance 50）', sc.status === 200 && sc.json.nth === 1 && sc.json.cost === 200 && sc.json.balance === 50, sc.text);
});
await attempt('S2', async () => {
  const A = 'device-s2aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 1000);
  put.unlock(w.db, A, SCN[0], 1, 200, NOW_MS - 9000); put.ledger(w.db, A, 'redeem', -200, { ref: 's2-scene' });
  const a = await collect(w, cb(A, 'train:ct250', 'req-s2-000001'));
  const b = await collect(w, cb(A, 'train:dr3000', 'req-s2-000002'));
  const c = await collect(w, cb(A, 'train:fuxing', 'req-s2-000003'));
  ok('S2a 已有 1 座場景，再連換三款：每款都是 150（不隨第幾款漲、也不吃場景價目），餘額 800 → 650 → 500 → 350',
    [a, b, c].every(r => r.status === 200 && r.json.cost === 150) && a.json.balance === 650 && b.json.balance === 500 && c.json.balance === 350,
    JSON.stringify([a, b, c].map(r => r.text)));
  const m = await me(w, `?actor=${A}`);
  ok('S2b 錢包的 items 依兌換時間排、三款都在；unlocked 仍只有 1 座、nextCost 300（第 2 座的價）',
    m.status === 200 && m.json.items.length === 3 && same(m.json.items.map(x => x.item).sort(), ['train:ct250', 'train:dr3000', 'train:fuxing']) &&
      m.json.unlocked.length === 1 && m.json.nextCost === 300, m.text);
});

// ═══ I：冪等、重送、衝突═══════════════════════════════════════════════════
await attempt('I1', async () => {
  const A = 'device-i1aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 400);
  const first = await collect(w, cb(A, 'train:dr3000', 'req-i1-000001'));
  const again = await collect(w, cb(A, 'train:dr3000', 'req-i1-000001'));
  ok('I1a 同一個 requestId 重送同一款 → 200、本文與第一次相同（cost 150、balance 250），帳本仍只有一筆 −150',
    first.status === 200 && again.status === 200 && again.text === first.text && q.redeems(w.db, A).length === 1 && q.bal(w.db, A) === 250, JSON.stringify([first.text, again.text]));
  const other = await collect(w, cb(A, 'train:ct250', 'req-i1-000001'));
  ok('I1b 同一個 requestId 拿去換別款 → 409 conflict；ct250 沒有入庫、餘額不動',
    other.status === 409 && other.json.error === 'conflict' && q.nItems(w.db, A) === 1 && q.bal(w.db, A) === 250, other.text);
  const dup = await collect(w, cb(A, 'train:dr3000', 'req-i1-000002'));
  ok('I1c 換新的 requestId 再換已經有的 dr3000 → 409 already，不再扣', dup.status === 409 && dup.json.error === 'already' && q.bal(w.db, A) === 250, dup.text);
});
await attempt('I2', async () => {
  const A = 'device-i2aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 1000);
  const sc = await redeem(w, { actor: A, scene: SCN[0], requestId: 'req-i2-shared1' });
  const car = await collect(w, cb(A, 'train:dr3000', 'req-i2-shared1'));
  ok('I2a 換場景用過的 requestId 拿來換車 → 409 conflict，車沒有入庫、只扣了場景那 200',
    sc.status === 200 && car.status === 409 && car.json.error === 'conflict' && q.nItems(w.db, A) === 0 && q.bal(w.db, A) === 800, car.text);
  const car2 = await collect(w, cb(A, 'train:ct250', 'req-i2-shared2'));
  const sc2 = await redeem(w, { actor: A, scene: SCN[1], requestId: 'req-i2-shared2' });
  ok('I2b 反過來：換車用過的 requestId 拿去換場景 → 409 conflict，那座沒有解鎖、只扣了車那 150',
    car2.status === 200 && sc2.status === 409 && sc2.json.error === 'conflict' &&
      w.db.prepare('SELECT COUNT(*) c FROM garage_unlocks WHERE actor=?').get(A).c === 1 && q.bal(w.db, A) === 650, sc2.text);
});
await attempt('I3', async () => {
  const A = 'device-i3aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 100);
  const r = await collect(w, cb(A, 'train:dr3000', 'req-i3-000001'));
  ok('I3a 100 點換 150 的車 → 409 {error not_enough, cost 150, balance 100}，帳本與車款一列都沒多',
    r.status === 409 && same(r.json, { error: 'not_enough', cost: 150, balance: 100 }) && q.nItems(w.db, A) === 0 && q.nLedger(w.db) === 1, r.text);
  put.ledger(w.db, A, 'adjust', 50);
  const r2 = await collect(w, cb(A, 'train:dr3000', 'req-i3-000002'));
  ok('I3b 剛好 150 點 → 200、餘額 0（守衛是 ≥，不是 >）', r2.status === 200 && r2.json.balance === 0 && q.bal(w.db, A) === 0, r2.text);
  const bad = await collect(w, { actor: A, item: 'train:ct250' });
  const bad2 = await collect(w, cb(A, 'train:ct250', 'short'));
  ok('I3c 沒帶 requestId、或格式不對 → 400 bad_request_id', bad.status === 400 && bad.json.error === 'bad_request_id' && bad2.status === 400 && bad2.json.error === 'bad_request_id',
    JSON.stringify([bad.text, bad2.text]));
});

// ═══ C：併發（別的請求在我讀完之後、寫入之前搶先提交）════════════════════════════════
await attempt('C1', async () => {
  const A = 'device-c1aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 400);
  // 別的請求（另一個 requestId、同一款）搶先換走 dr3000
  w.beforeBatch = () => {
    w.db.prepare("INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES (?,?,'redeem',-150,?,NULL,?,'point')")
      .run(`item|train:dr3000|${A}.req-c1-other01`, A, `${A}.req-c1-other01`, NOW_MS);
    put.item(w.db, A, 'train:dr3000', 150, NOW_MS);
  };
  const r = await collect(w, cb(A, 'train:dr3000', 'req-c1-mine001'));
  ok('C1 同一款被別的請求搶先換走：我這一筆不扣（守衛「這款還沒換過」在交易裡），重讀後回 409 already；總共只扣一次 150',
    r.status === 409 && r.json.error === 'already' && q.redeems(w.db, A).length === 1 && q.bal(w.db, A) === 250 && q.nItems(w.db, A) === 1, r.text);
});
await attempt('C2', async () => {
  const A = 'device-c2aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 1000);
  // 同一個 requestId 的另一個請求（換 dr3000）搶先提交；我這一個拿同一個 requestId 換同價的 ct250
  w.beforeBatch = () => {
    w.db.prepare("INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES (?,?,'redeem',-150,?,NULL,?,'point')")
      .run(`item|train:dr3000|${A}.req-c2-shared1`, A, `${A}.req-c2-shared1`, NOW_MS);
    put.item(w.db, A, 'train:dr3000', 150, NOW_MS);
  };
  const r = await collect(w, cb(A, 'train:ct250', 'req-c2-shared1'));
  ok('C2 同一個 requestId 併發換兩款同價的車：寫車款那一句用帳本 id 指名，不會憑 dr3000 的帳本列白送 ct250；回 409 conflict',
    r.status === 409 && r.json.error === 'conflict' && same(q.items(w.db, A).map(x => x.item), ['train:dr3000']) && q.bal(w.db, A) === 850, r.text + ' ' + JSON.stringify(q.items(w.db, A)));
});
await attempt('C3', async () => {
  const A = 'device-c3aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 200);                        // 只夠換一款
  w.beforeBatch = () => {
    w.db.prepare("INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES (?,?,'redeem',-150,?,NULL,?,'point')")
      .run(`item|train:fuxing|${A}.req-c3-other01`, A, `${A}.req-c3-other01`, NOW_MS);
    put.item(w.db, A, 'train:fuxing', 150, NOW_MS);
  };
  const r = await collect(w, cb(A, 'train:dr3000', 'req-c3-mine001'));
  ok('C3 只夠換一款、另一款被併發的請求先換走：我這一筆被交易內的餘額守衛擋下，重讀後 409 not_enough（balance 50）；餘額不會變負',
    r.status === 409 && r.json.error === 'not_enough' && r.json.balance === 50 && q.bal(w.db, A) === 50 && same(q.items(w.db, A).map(x => x.item), ['train:fuxing']), r.text);
});

// ═══ M：帳號合併══════════════════════════════════════════════════════════
// 兩邊換過同一款＝留較早的那份（平手留帳號的），較晚那份的點數以 kind='merge' 退回；只有一邊有的照搬。
await attempt('M1', async () => {
  const run = async (devAt, uidAt) => {
    const DEV = 'device-m1dev0001', UID = 'uid-m1acct00001';
    const w = world();
    put.account(w.db, UID);
    put.item(w.db, DEV, 'train:dr3000', 150, devAt); put.ledger(w.db, DEV, 'redeem', -150, { ref: 'm1-dev-r' }); put.ledger(w.db, DEV, 'adjust', 300, { ref: 'm1-dev-a' });
    put.item(w.db, UID, 'train:dr3000', 150, uidAt); put.ledger(w.db, UID, 'redeem', -150, { ref: 'm1-uid-r' }); put.ledger(w.db, UID, 'adjust', 300, { ref: 'm1-uid-a' });
    put.item(w.db, DEV, 'train:ct250', 150, devAt + 5); put.ledger(w.db, DEV, 'redeem', -150, { ref: 'm1-dev-r2' });
    put.unlock(w.db, UID, SCN[0], 1, 200, NOW_MS - 50000);
    const r = await withFirebase(UID, () => mergeCall(w, DEV, 'tok-m1'));
    return { w, r, DEV, UID };
  };
  const a = await run(NOW_MS - 40000, NOW_MS - 30000);       // 裝置那份較早
  ok('M1a 裝置那份 dr3000 較早：合併後帳號名下 dr3000 恰一列、時間是裝置那份的；ct250 照搬；裝置名下一列都不剩',
    a.r.status === 200 && same(a.w.db.prepare('SELECT item, created_at AS at FROM garage_items WHERE actor=? ORDER BY item').all(a.UID).map(x => ({ ...x })),
      [{ item: 'train:ct250', at: NOW_MS - 40000 + 5 }, { item: 'train:dr3000', at: NOW_MS - 40000 }]) && q.nItems(a.w.db, a.DEV) === 0, a.r.text);
  ok("M1b 退回較晚那份（帳號的）150 點：一筆 kind='merge'、id 'merge|item|<裝置>|train:dr3000'、ref 'item|<裝置>|train:dr3000'、+150、unit point；合併後餘額＝300−150−150＋300−150＋150＝300",
    same(q.merges(a.w.db, a.UID), [{ id: `merge|item|${a.DEV}|train:dr3000`, delta: 150, ref: `item|${a.DEV}|train:dr3000`, unit: 'point' }]) && q.bal(a.w.db, a.UID) === 300,
    JSON.stringify({ merges: q.merges(a.w.db, a.UID), bal: q.bal(a.w.db, a.UID) }));
  ok('M1c 場景的解鎖不受車款影響：帳號那 1 座仍是 nth 1', same(a.w.db.prepare('SELECT scene, nth FROM garage_unlocks WHERE actor=?').all(a.UID).map(x => ({ ...x })), [{ scene: SCN[0], nth: 1 }]));
  const b = await run(NOW_MS - 30000, NOW_MS - 40000);       // 帳號那份較早
  ok('M1d 帳號那份 dr3000 較早：留帳號那份的時間，退的是裝置那份的 150（同一筆 merge 列）',
    b.r.status === 200 && b.w.db.prepare("SELECT created_at c FROM garage_items WHERE actor=? AND item='train:dr3000'").get(b.UID).c === NOW_MS - 40000 &&
      q.merges(b.w.db, b.UID).length === 1 && q.merges(b.w.db, b.UID)[0].delta === 150 && q.nItems(b.w.db, b.UID) === 2, JSON.stringify(q.merges(b.w.db, b.UID)));
  const t = await run(NOW_MS - 30000, NOW_MS - 30000);       // 平手
  ok('M1e 平手：留一份（帳號的）、退一筆 150', t.r.status === 200 && q.nItems(t.w.db, t.UID) === 2 && q.merges(t.w.db, t.UID).length === 1 && q.nItems(t.w.db, t.DEV) === 0,
    JSON.stringify(q.merges(t.w.db, t.UID)));
  const again = await withFirebase(a.UID, () => mergeCall(a.w, a.DEV, 'tok-m1'));
  ok('M1f 重跑同一次合併：不再退款、車款不變（冪等）', again.status === 200 && q.merges(a.w.db, a.UID).length === 1 && q.nItems(a.w.db, a.UID) === 2 && q.bal(a.w.db, a.UID) === 300,
    again.text);
});
await attempt('M2', async () => {
  // 守衛：裝置已經併進「別的」帳號 → 一列都不搬（同 bountyMerge 的守衛 G）
  const DEV = 'device-m2dev0001', UID = 'uid-m2acct00001', OTHER = 'uid-m2other0001';
  const w = world();
  put.merge(w.db, DEV, OTHER);
  put.item(w.db, DEV, 'train:dr3000', 150, NOW_MS - 1000);
  const r = await withFirebase(UID, () => mergeCall(w, DEV, 'tok-m2'));
  ok('M2 已併進別人帳號的裝置：它的車款不會被搬到我名下（409 merged_elsewhere，garage_items 原封不動）',
    r.status === 409 && q.nItems(w.db, UID) === 0 && q.nItems(w.db, DEV) === 1, r.text);
});

// ═══ D：刪帳號═════════════════════════════════════════════════════════════
await attempt('D1', async () => {
  const UID = 'uid-d1acct00001', DEV = 'device-d1dev0001', LOOSE = 'device-d1loose01', OTHER = 'uid-d1other0001';
  const w = world();
  put.merge(w.db, DEV, UID);
  put.item(w.db, UID, 'train:dr3000', 150, 1); put.item(w.db, UID, 'train:ct250', 150, 2);
  put.item(w.db, DEV, 'train:fuxing', 150, 3);
  put.item(w.db, LOOSE, 'train:dr3000', 150, 4);              // 沒併進任何帳號的裝置（body 帶它）
  put.account(w.db, OTHER); put.item(w.db, OTHER, 'train:dr3000', 150, 5);
  const out = await _bounty.bountyPurgeUid(w.env, UID, LOOSE);
  ok('D1a 刪帳號：帳號自己 2 款、併進來的裝置 1 款都刪掉，回報 items 3',
    out.items === 3 && q.nItems(w.db, UID) === 0 && q.nItems(w.db, DEV) === 0, JSON.stringify(out));
  ok('D1b body 帶的、沒併進帳號的裝置與別人帳號的車款都不刪（錢包不吃 body 的 deviceActor）',
    q.nItems(w.db, LOOSE) === 1 && q.nItems(w.db, OTHER) === 1 && q.nAllItems(w.db) === 2, JSON.stringify({ loose: q.nItems(w.db, LOOSE), other: q.nItems(w.db, OTHER) }));
});

// ═══ A：身分（換車是「花」，走 bountyIdentity 'wallet'）══════════════════════════════
await attempt('A1', async () => {
  const UID = 'uid-a1acct00001', DEV = 'device-a1dev0001';
  const w = world();
  put.merge(w.db, DEV, UID);
  put.ledger(w.db, UID, 'adjust', 400);
  const noTok = await collect(w, cb(UID, 'train:dr3000', 'req-a1-000001'));
  const noTokDev = await collect(w, cb(DEV, 'train:dr3000', 'req-a1-000002'));
  ok('A1a 帳號、或已併進帳號的裝置，不帶 Bearer → 401 auth_required，一列都沒寫',
    noTok.status === 401 && noTok.json.error === 'auth_required' && noTokDev.status === 401 && noTokDev.json.error === 'auth_required' && q.nAllItems(w.db) === 0,
    JSON.stringify([noTok.text, noTokDev.text]));
  const wrong = await withFirebase('uid-a1someone01', () => collect(w, cb(UID, 'train:dr3000', 'req-a1-000003'), { Authorization: 'Bearer tok-x' }));
  ok('A1b 帶別人的 Bearer → 403 wrong_account，一列都沒寫', wrong.status === 403 && wrong.json.error === 'wrong_account' && q.nAllItems(w.db) === 0, wrong.text);
  const good = await withFirebase(UID, () => collect(w, cb(DEV, 'train:dr3000', 'req-a1-000004'), { Authorization: 'Bearer tok-a1' }));
  ok('A1c 併進帳號的裝置帶帳號的 Bearer → 200，扣的是帳號的點數、車款記在帳號名下',
    good.status === 200 && good.json.balance === 250 && q.nItems(w.db, UID) === 1 && q.nItems(w.db, DEV) === 0 && q.bal(w.db, UID) === 250, good.text);
  const m = await withFirebase(UID, () => me(w, '', { Authorization: 'Bearer tok-a1' }));
  ok('A1d 帶 Bearer 讀錢包：items 看得到剛換的 dr3000', m.status === 200 && same(m.json.items, [{ item: 'train:dr3000', at: NOW_MS }]), m.text);
});

// ═══ G：閘門（都擋在任何 D1 存取之前）═══════════════════════════════════════════
await attempt('G1', async () => {
  const A = 'device-g1aa0001';
  const off = world({ env: { BOUNTY_WRITES: 'off' } });
  const r1 = await collect(off, cb(A, 'train:dr3000', 'req-g1-000001'));
  ok('G1a 寫入總閘關著 → 503 bounty_paused，沒有碰 D1', r1.status === 503 && r1.json.error === 'bounty_paused' && off.sql.length === 0, r1.text);
  const blk = world({ env: { BOUNTY_LIMITER: limiter(true) } });
  const r2 = await collect(blk, cb(A, 'train:dr3000', 'req-g1-000002'));
  const down = world({ env: { BOUNTY_LIMITER: { limit: async () => { throw new Error('limiter down'); } } } });
  const r2b = await collect(down, cb(A, 'train:dr3000', 'req-g1-000002'));
  ok('G1b 限流擋下、或限流器自己壞掉（failClosed）→ 429 rate_limited，沒有碰 D1',
    r2.status === 429 && blk.sql.length === 0 && r2b.status === 429 && down.sql.length === 0, JSON.stringify([r2.text, r2b.text]));
  const w = world();
  const r3 = await call(_bounty.garageCollect, jpost('/api/garage-collect', null, {}, 'GET'), w.env);
  const r4 = await collect(w, '{not json');
  const r5 = await collect(w, cb('x', 'train:dr3000', 'req-g1-000005'));
  const r6 = await collect(w, cb(A, 'train:dr3000', 'req-g1-000006', { lat: 25.04, lng: 121.5 }));
  ok('G1c GET → 405 method；壞 JSON → 400 bad_json；actor 格式不對 → 400 bad_actor；帶座標 → 400 coordinates_not_accepted',
    r3.status === 405 && r4.status === 400 && r4.json.error === 'bad_json' && r5.status === 400 && r5.json.error === 'bad_actor' &&
      r6.status === 400 && r6.json.error === 'coordinates_not_accepted' && q.nAllItems(w.db) === 0, JSON.stringify([r3.text, r4.text, r5.text, r6.text]));
  const v2 = world({ rules: { ...RULES_I, chips: { ...RULES_I.chips, unit: 'chip' } } });
  put.ledger(v2.db, A, 'adjust', 1000);
  const r7 = await collect(v2, cb(A, 'train:dr3000', 'req-g1-000007'));
  ok('G1d 規則檔被換回 v2（unit 不是 point）→ 503 not_ready，一列都沒寫', r7.status === 503 && r7.json.error === 'not_ready' && q.nItems(v2.db, A) === 0, r7.text);
});
await attempt('G2', async () => {
  const A = 'device-g2aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 400);
  _bounty.bountyResetMemCaches();
  const res = await fin(await worker.fetch(jpost('/api/garage-collect', cb(A, 'train:dr3000', 'req-g2-000001')), w.env, { waitUntil() {} }));
  ok('G2 走 worker.fetch 的正式路由：POST /api/garage-collect 到得了處理函式（非 GET 白名單有它）→ 200', res.status === 200 && res.json && res.json.ok === true, res.text);
});

// ═══ P：純函式════════════════════════════════════════════════════════════
await attempt('P1', async () => {
  const chips = { items: { 'train:dr3000': 150, 'train:zero': 0, 'train:x|y': 150 } };
  ok('P1a itemPrice：列了的回價格；沒列、0、id 含「|」、chips 沒有 items、items 是陣列都回 null',
    itemPrice('train:dr3000', chips) === 150 && itemPrice('train:ct250', chips) === null && itemPrice('train:zero', chips) === null &&
      itemPrice('train:x|y', chips) === null && itemPrice('train:dr3000', {}) === null && itemPrice('train:dr3000', { items: ['train:dr3000'] }) === null &&
      itemPrice('train:constructor', { items: {} }) === null);
  ok('P1b canCollect：沒列 unknown_item；已有 already；不夠 not_enough（帶 cost）；夠就 ok（帶 cost）',
    same(canCollect('train:ct250', [], 999, chips), { ok: false, why: 'unknown_item' }) &&
      same(canCollect('train:dr3000', ['train:dr3000'], 999, chips), { ok: false, why: 'already' }) &&
      same(canCollect('train:dr3000', [], 149, chips), { ok: false, why: 'not_enough', cost: 150 }) &&
      same(canCollect('train:dr3000', [], 150, chips), { ok: true, cost: 150 }));
});

ok('Z 整支腳本沒有任何非 Firebase 的對外連線', outbound.length === 0, JSON.stringify(outbound));

const pass = R.filter(r => r.p).length;
console.log(`\n[SUMMARY] ${pass}/${R.length} 條判準通過`);
process.exit(pass === R.length ? 0 : 1);
