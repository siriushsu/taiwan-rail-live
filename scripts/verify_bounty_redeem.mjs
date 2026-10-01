// 路段懸賞 v2 後端驗收（二）：籌碼餘額 GET /api/chips-me、車庫兌換 POST /api/garage-redeem、
// 看板常青線（bounty-board）、整段收滿（cron 的 covered_at）、通行證對照組。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS ＋ BOUNTY_NOW 釘死；不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_redeem.mjs
//
// 期望值全部寫死在這裡，不呼叫實作（連 scripts/bounty_chips_core.mjs 都不呼叫）去產生期望：
//   ・產品規則：車庫第 1 座 4 籌碼、之後每座 8；捷運不列入懸賞。
//   ・其餘數字（台鐵 50／高鐵 15 位不同的人收滿、一趟 1 籌碼、每日上限 4、雲端搭乘 3 次換 1 籌碼、四座場景 id）
//     來自 data/bounty_rules.json，這裡照抄成字面。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準。
//
// ⚠️ 假 D1 的保真度：scripts/d1_local.mjs 的 batch() 是排隊序列化的，但 batch 之外的單句寫入
//    可以插進另一個 batch 的交易中間；真的 D1 不會這樣。所以下面 C 組「兩個併發的請求」只證明「序列化之後的
//    各種交錯」是安全的，證明不了真 D1 的行為。上線後要對正式庫做一次唯讀抽查（重複的 redeem 列、對不上的 nth、
//    餘額變負）。
//
// 稽核修補（身分與授權）之後：帳號（uid）與已併進帳號的裝置，讀餘額與兌換都必須帶該帳號的 Bearer；
// 原本不帶 token 也讀得到、花得掉的那幾條判準（M6、R7a、R7b）就是被修掉的洞，已改成新行為（標了「改寫」）。
// 「併進帳號」的種子（put.merge）與正式合併一樣，同時留下帳號列——沒有帳號列的 uid 在伺服器眼裡只是一個匿名 id。
// 身分規則本身的驗收在 scripts/verify_bounty_auth.mjs。
//
// 分組：M 籌碼餘額（chips-me）　R 兌換（garage-redeem）　C 併發與競態　B 看板常青線　T 整段收滿　P 通行證對照組
import { readFileSync } from 'node:fs';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

// 邊緣快取替身：記下每一次 put 的鍵（B4 用它證明快取鍵沒被查詢字串汙染）
const edgePuts = [];
globalThis.caches = { default: { match: async () => undefined, put: async (k) => { edgePuts.push(String(k.url)); } } };
// 對外連線偵測：籌碼餘額與兌換只該讀寫 D1，不該打任何外部服務。會丟例外：真有人加了外部呼叫，
// 流程會在那裡斷掉（比默默成功更容易被發現）。Firebase 查 uid 是合法的外連，用 withFirebase() 單獨替身。
const outbound = [];
globalThis.fetch = async (u) => { outbound.push(String(u)); throw new Error('offline: ' + String(u)); };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
// 例外也要記成 FAIL（而不是讓整支腳本崩潰、後面的判準全部沒跑）：突變測試時「紅」有兩種長相——
// 斷言為假、或流程直接丟例外，兩種都必須被記下來。
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
// 物件比對用：鍵排序後轉字串，鍵順序不同不算差異、但多一個鍵或少一個鍵都算
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const same = (a, b) => canon(a) === canon(b);

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00（週三）
const TODAY = '2026-07-29';
const TRIP_DATE = '2026-07-28';
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });
const throwingLimiter = { limit: async () => { throw new Error('limiter down'); } };
// 價目表（第一座 4、之後每座 8）——寫死，不呼叫實作
const PRICE = n => (n === 1 ? 4 : 8);

// 三條合成的線（名字用真的鍵）：20 公里、每 2 公里一站（S0…S10），正規區間 10 段
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const UNITS = { generatedAt: 1, schedDate: TRIP_DATE, units: [], lines: {
  'tra_sched|南迴線': mkLine('tra_sched', '南迴線'),
  'tra_sched|山線': mkLine('tra_sched', '山線'),
  'thsr_sched|THSR': mkLine('thsr_sched', 'THSR'),
} };

// 一個獨立的世界：全新的 D1、規則與題庫替身、釘死的時鐘。DB 包一層記錄器：
//   w.sql 記下每一句 prepare 過的 SQL（證明「被擋掉的請求沒有碰 D1」「沒有查通行證表」）、
//   w.beforeBatch 是一次性的鉤子（在下一個 batch 送出前同步執行，用來模擬「別的請求在我讀完之後、寫入之前搶先提交」）。
function world(over = {}) {
  const rules = over.rules || RULES;
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const w = { db, sql: [], batches: 0, maxBatch: 0, beforeBatch: null };
  const DB = {
    prepare: s => { w.sql.push(s); return DELAY_DB.prepare(s); },
    exec: s => DELAY_DB.exec(s),
    batch: async st => {
      w.batches++; w.maxBatch = Math.max(w.maxBatch, st.length);
      if (w.beforeBatch) { const h = w.beforeBatch; w.beforeBatch = null; h(); }
      return DELAY_DB.batch(st);
    },
  };
  const ASSETS = { fetch: async r => new Response(
    String(r.url).includes('bounty_units') ? JSON.stringify(over.units || UNITS) : JSON.stringify(rules), { status: 200 }) };
  w.env = { DELAY_DB: DB, ASSETS, BOUNTY_LIMITER: limiter(false), BOUNTY_NOW: String(over.now || NOW_MS), ...(over.env || {}) };
  // 模組層級有 rules／units 快取（bountyResetMemCaches 的註解），每次跑之前歸零，情境之間才不會串味
  w.cron = async now => { _bounty.bountyResetMemCaches(); return _bounty.bountyVerifyCron(now ? { ...w.env, BOUNTY_NOW: String(now) } : w.env); };
  return w;
}

// ── 呼叫端 ─────────────────────────────────────────────────────────────────
const ALL = [];                 // 每一個回應本文；最後一項（Z1）掃一遍有沒有通行證字樣
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
async function fin(res) {
  const text = await res.text();
  ALL.push(text);
  return { status: res.status, text, json: parse(text), headers: res.headers };
}
async function call(fn, request, env) { _bounty.bountyResetMemCaches(); return fin(await fn(request, env)); }
const me = (w, query = '', hdr = {}, env) => call(_bounty.chipsMe, req('/api/chips-me' + query, { headers: hdr }), env || w.env);
const rdReq = (b, hdr = {}, method = 'POST') => req('/api/garage-redeem', {
  method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr },
  ...(method === 'GET' ? {} : { body: typeof b === 'string' ? b : JSON.stringify(b) }) });
const redeem = (w, b, hdr = {}, env) => call(_bounty.garageRedeem, rdReq(b, hdr), env || w.env);
const routed = async (w, path, init) => { _bounty.bountyResetMemCaches(); return fin(await worker.fetch(req(path, init), w.env, { waitUntil() {} })); };
const board = async (w, path = '/api/bounty-board') => call(_bounty.bountyBoard, req(path), w.env);
const body = (actor, scene, requestId, extra = {}) => ({ actor, scene, requestId, ...extra });
// Firebase 替身：mode 是驗過會回的 uid；null＝Firebase 說 token 無效。回傳 {out, calls}：calls 是被打的網址
async function withFirebase(mode, fn) {
  const saved = globalThis.fetch, calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u));
    return mode ? new Response(JSON.stringify({ users: [{ localId: mode }] }), { status: 200 }) : new Response('{}', { status: 400 }); };
  try { return { out: await fn(), calls }; } finally { globalThis.fetch = saved; }
}

// ── 種子與讀庫（一律自己寫 SQL，期望值不能與被驗的實作同源）───────────────────────────
let seq = 0;
const put = {
  ledger: (db, actor, kind, delta, o = {}) => db.prepare('INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(`seed-${++seq}`, actor, kind, delta, o.ref || `seed-ref-${seq}`, o.day === undefined ? null : o.day, o.at ?? NOW_MS - 1000),
  unlock: (db, actor, scene, nth, cost, at) => db.prepare('INSERT INTO garage_unlocks (actor,scene,nth,cost,created_at) VALUES (?,?,?,?,?)')
    .run(actor, scene, nth, cost, at ?? NOW_MS - 5000),
  ride: (db, actor, day) => db.prepare('INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at) VALUES (?,?,?,?,?,?)')
    .run(actor, day, 'tk-' + day, 700, null, NOW_MS - 1000),
  // 與正式合併留下的狀態一樣：來源是墓碑（merged_into），目的地是帳號列（uid 欄有值）。只種墓碑的話，uid 在伺服器眼裡只是匿名 id。
  merge: (db, from, to) => {
    db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,NULL,0,?,1)').run(from, to);
    db.prepare('INSERT OR IGNORE INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,0,NULL,1)').run(to, to);
  },
};
// 一致的起始狀態：已解鎖 unlocked（依序第 1、2、3…座，各自花當時的價格）、剩下 balance 個籌碼。
// 帳本：一筆 adjust（balance＋花掉的總額）再加每座一筆負數 redeem，加總＝balance。
function give(db, actor, { balance, unlocked = [], at = NOW_MS - 60000 }) {
  let spent = 0;
  unlocked.forEach((scene, i) => {
    spent += PRICE(i + 1);
    put.unlock(db, actor, scene, i + 1, PRICE(i + 1), at + i);
    put.ledger(db, actor, 'redeem', -PRICE(i + 1), { ref: `seed-redeem-${actor}-${scene}` });
  });
  put.ledger(db, actor, 'adjust', balance + spent, { ref: `seed-adjust-${actor}` });
}
const q = {
  bal: (db, a) => db.prepare('SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=?').get(a).n,
  nRedeem: (db, a) => db.prepare("SELECT COUNT(*) c FROM chip_ledger WHERE actor=? AND kind='redeem'").get(a).c,
  nUnlock: (db, a) => db.prepare('SELECT COUNT(*) c FROM garage_unlocks WHERE actor=?').get(a).c,
  nLedger: (db, a) => db.prepare('SELECT COUNT(*) c FROM chip_ledger WHERE actor=?').get(a).c,
  unlocks: (db, a) => db.prepare('SELECT scene, nth, cost, created_at FROM garage_unlocks WHERE actor=? ORDER BY nth').all(a).map(r => ({ ...r })),
  redeemRows: (db, a) => db.prepare("SELECT delta, ref, day, created_at FROM chip_ledger WHERE actor=? AND kind='redeem' ORDER BY delta").all(a).map(r => ({ ...r })),
};
const snap = (db, a) => canon({ ledger: q.nLedger(db, a), bal: q.bal(db, a), unlocks: q.unlocks(db, a) });   // 「一個字都沒動」的比對用

// ═══ M 組：GET /api/chips-me ═══════════════════════════════════════════════
// M1 種入 +5 → 餘額 5、下一座 4、沒有解鎖；五個欄位一個不多（多了就有東西漏出來）
await attempt('M1', async () => {
  const A = 'device-m1aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 5);
  const r = await me(w, `?actor=${A}`);
  ok('M1a 種入 +5 → balance 5、nextCost 4、unlocked []、雲端 0 次（再 3 次換 1 個）、今天 0／上限 4，五個欄位一個不多',
    r.status === 200 && same(r.json, { balance: 5, unlocked: [], nextCost: 4, cloud: { rides: 0, toNextChip: 3 }, today: { chips: 0, cap: 4 } }), r.text);
  ok('M1b 回應標 no-store（個人餘額不能進邊緣快取）', r.headers.get('cache-control') === 'no-store', String(r.headers.get('cache-control')));
  const r0 = await me(w, '?actor=device-m1zero001');
  ok('M1c 一個沒有任何紀錄的人：餘額 0、nextCost 4，不是 404 也不是錯誤',
    r0.status === 200 && same(r0.json, { balance: 0, unlocked: [], nextCost: 4, cloud: { rides: 0, toNextChip: 3 }, today: { chips: 0, cap: 4 } }), r0.text);
});

// M2 解鎖清單依 nth 排序（種子故意反著插）；每一項只有 scene／nth／at；nextCost＝下一座的價格（第 1 座 4、其後都 8）
await attempt('M2', async () => {
  const A = 'device-m2aa0001', B = 'device-m2bb0001';
  const w = world();
  // 先插第 2 座；場景 id 的字母序（shifen < viaduct）刻意與名次（viaduct 是第 1 座）相反，拿掉 ORDER BY nth 才看得出來
  put.unlock(w.db, A, 'shifen', 2, 8, NOW_MS - 2000);
  put.unlock(w.db, A, 'viaduct', 1, 4, NOW_MS - 9000);
  put.ledger(w.db, A, 'adjust', 20, { ref: 'm2-a' }); put.ledger(w.db, A, 'redeem', -4, { ref: 'm2-r1' }); put.ledger(w.db, A, 'redeem', -8, { ref: 'm2-r2' });
  const r = await me(w, `?actor=${A}`);
  ok('M2a unlocked 依 nth 排序、每項只有 scene／nth／at（cost 不外洩）；balance 20−4−8＝8；第 3 座價格 8',
    r.status === 200 && same(r.json, { balance: 8, unlocked: [{ scene: 'viaduct', nth: 1, at: NOW_MS - 9000 }, { scene: 'shifen', nth: 2, at: NOW_MS - 2000 }],
      nextCost: 8, cloud: { rides: 0, toNextChip: 3 }, today: { chips: 0, cap: 4 } }) &&
      JSON.stringify(r.json.unlocked.map(u => u.nth)) === '[1,2]', r.text);
  give(w.db, B, { balance: 0, unlocked: ['south-coast', 'shifen', 'viaduct', 'alishan'] });
  const r4 = await me(w, `?actor=${B}`);
  ok('M2b 四座都解鎖了：nextCost 仍是 8（價目表最後一格沿用），unlocked 四項依序 1～4',
    r4.status === 200 && r4.json.nextCost === 8 && JSON.stringify(r4.json.unlocked.map(u => u.scene + ':' + u.nth)) ===
      '["south-coast:1","shifen:2","viaduct:3","alishan:4"]' && r4.json.balance === 0, r4.text);
});

// M2c 數字來自設定檔，不是寫死：價目表 [3,6]、每日上限 6、雲端每 5 次換 1 個
await attempt('M2c', async () => {
  const A = 'device-m2cc0001';
  const rules = { ...RULES, chips: { ...RULES.chips, prices: [3, 6], dailyChipCap: 6, cloud: { ...RULES.chips.cloud, perChip: 5 } } };
  const w = world({ rules });
  put.ledger(w.db, A, 'adjust', 10); put.ride(w.db, A, '2026-07-20'); put.ride(w.db, A, '2026-07-21');
  const r0 = await me(w, `?actor=${A}`);
  put.unlock(w.db, A, 'shifen', 1, 3); put.ledger(w.db, A, 'redeem', -3, { ref: 'm2c-r' });
  const r1 = await me(w, `?actor=${A}`);
  ok('M2c 價目表改成 [3,6]：第 1 座 nextCost 3、解鎖 1 座後 6；cap 6；雲端 2 次、每 5 次換 1 個 → 再 3 次',
    r0.json.nextCost === 3 && r1.json.nextCost === 6 && r0.json.today.cap === 6 && r0.json.cloud.rides === 2 && r0.json.cloud.toNextChip === 3,
    JSON.stringify([r0.json, r1.json]));
});

// M3 雲端搭乘：次數＝cloud_rides 列數；toNextChip＝再幾次換 1 個籌碼（每 3 次 1 個）：0→3、1→2、2→1、3→3、4→2
await attempt('M3', async () => {
  const A = 'device-m3aa0001';
  const w = world();
  put.ride(w.db, 'device-m3other01', '2026-07-19'); put.ride(w.db, 'device-m3other01', '2026-07-20');   // 別人的不算
  const got = [];
  const days = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'];
  got.push((await me(w, `?actor=${A}`)).json.cloud);
  for (const d of days) { put.ride(w.db, A, d); got.push((await me(w, `?actor=${A}`)).json.cloud); }
  ok('M3 cloud 依序＝{0,3}、{1,2}、{2,1}、{3,3}、{4,2}（別人的搭乘不算、整除時是「再 3 次」不是 0）',
    canon(got) === canon([{ rides: 0, toNextChip: 3 }, { rides: 1, toNextChip: 2 }, { rides: 2, toNextChip: 1 }, { rides: 3, toNextChip: 3 }, { rides: 4, toNextChip: 2 }]),
    canon(got));
});

// M4 today：只數「台北今天」乘車日的錄程（kind='trip'）；不是 UTC 日、不是別的 kind、不是別人
await attempt('M4', async () => {
  const A = 'device-m4aa0001';
  const w = world();
  put.ledger(w.db, A, 'trip', 1, { day: '2026-07-29', ref: 't-1' }); put.ledger(w.db, A, 'trip', 2, { day: '2026-07-29', ref: 't-2' });
  put.ledger(w.db, A, 'trip', 2, { day: '2026-07-28', ref: 't-3' }); put.ledger(w.db, A, 'trip', 1, { day: '2026-07-30', ref: 't-4' });
  put.ledger(w.db, A, 'cloud', 1, { day: '2026-07-29', ref: 'c-1' }); put.ledger(w.db, A, 'adjust', 5, { day: '2026-07-29', ref: 'a-1' });
  put.ledger(w.db, 'device-m4other01', 'trip', 4, { day: '2026-07-29', ref: 'o-1' });
  const r = await me(w, `?actor=${A}`);
  ok('M4a 今天 2026-07-29：trip 的 1＋2＝3（前一天、明天、cloud、adjust、別人的都不算）；餘額仍是全部加總 1+2+2+1+1+5＝12',
    r.json.today.chips === 3 && r.json.today.cap === 4 && r.json.balance === 12, r.text);
  // 台北凌晨 01:30（UTC 還是前一天）：今天是 07-29，不是 07-28
  const w2 = world({ now: Date.parse('2026-07-28T17:30:00Z') });
  put.ledger(w2.db, A, 'trip', 2, { day: '2026-07-29', ref: 'b-1' }); put.ledger(w2.db, A, 'trip', 1, { day: '2026-07-28', ref: 'b-2' });
  const r2 = await me(w2, `?actor=${A}`);
  ok('M4b 台北 07-29 01:30（UTC 07-28 17:30）：今天是 07-29 → 2（用 UTC 日算會得 1）', r2.json.today.chips === 2, r2.text);
  // 台北午夜剛過（UTC 還是同一天的下午）：今天是 07-30
  const w3 = world({ now: Date.parse('2026-07-29T16:30:00Z') });
  put.ledger(w3.db, A, 'trip', 1, { day: '2026-07-29', ref: 'c-2' }); put.ledger(w3.db, A, 'trip', 3, { day: '2026-07-30', ref: 'c-3' });
  const r3 = await me(w3, `?actor=${A}`);
  ok('M4c 台北 07-30 00:30（UTC 07-29 16:30）：今天是 07-30 → 3（用 UTC 日算會得 1）', r3.json.today.chips === 3, r3.text);
});

// M5 身分：actor 查詢參數，或 Bearer Firebase idToken（uid 蓋過 actor 參數）；Bearer 那條走 AUTH_LIMITER，
// ?actor= 那條走 BOUNTY_LIMITER（以前完全不限流；bountyMe 的 ?actor= 讀取現在也走同一道限流，見 verify_bounty_auth.mjs 的 A14d）
await attempt('M5', async () => {
  const D = 'device-m5other1', U = 'uid-m5bearer01';
  const mk = env => { const w = world({ env }); give(w.db, U, { balance: 9 }); give(w.db, D, { balance: 2 }); return w; };
  const w = mk({ FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(false) });
  const noId = await me(w, '');
  const badId = await Promise.all(['?actor=short', '?actor=../etc/passwd', '?actor=' + 'x'.repeat(65), '?actor=a b c d e f g h'].map(x => me(w, x)));
  ok('M5a 沒帶身分／actor 格式不對 → 400 bad_actor（不是 200 空帳、不是 500）',
    noId.status === 400 && noId.json.error === 'bad_actor' && badId.every(r => r.status === 400 && r.json.error === 'bad_actor'), JSON.stringify([noId.json, ...badId.map(r => r.json)]));
  const ok1 = await withFirebase(U, () => me(w, `?actor=${D}`, { Authorization: 'Bearer tok-abc' }));
  ok('M5b Bearer 驗過 → 看的是 uid 的帳（9），不是 actor 參數那個 device 的帳（2）；Firebase 查了恰好 1 次、打的是 identitytoolkit',
    ok1.out.status === 200 && ok1.out.json.balance === 9 && ok1.calls.length === 1 && ok1.calls[0].startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup'),
    JSON.stringify({ b: ok1.out.json, calls: ok1.calls }));
  const bad = await withFirebase(null, () => me(w, `?actor=${D}`, { Authorization: 'Bearer tok-bad' }));
  ok('M5c Bearer 被 Firebase 判無效 → 401 unauthorized，本文沒有任何餘額（不會退回用 actor 參數）',
    bad.out.status === 401 && same(bad.out.json, { error: 'unauthorized' }), bad.out.text);
  const wNoKey = mk({ AUTH_LIMITER: limiter(false) });
  const noKey = await withFirebase(U, () => me(wNoKey, `?actor=${D}`, { Authorization: 'Bearer tok-abc' }));
  ok('M5d 伺服器沒設 FIREBASE_WEB_API_KEY → Bearer 一律 401，也不會打出去', noKey.out.status === 401 && noKey.calls.length === 0, JSON.stringify(noKey.out.json));
  const wBlk = mk({ FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(true) });
  const blk = await withFirebase(U, () => me(wBlk, `?actor=${D}`, { Authorization: 'Bearer tok-abc' }));
  ok('M5e Bearer 且 AUTH_LIMITER 擋下 → 429 rate_limited，而且 Firebase 一次都沒打（限流在外連之前）',
    blk.out.status === 429 && blk.out.json.error === 'rate_limited' && blk.calls.length === 0, JSON.stringify({ s: blk.out.status, calls: blk.calls }));
  const plain = await me(wBlk, `?actor=${D}`);
  ok('M5f 同一個被擋的 AUTH_LIMITER，走 actor 查詢參數那條照樣 200（AUTH_LIMITER 只管 Bearer；?actor= 那條走 BOUNTY_LIMITER，見 verify_bounty_auth 的 A14）', plain.status === 200 && plain.json.balance === 2, plain.text);
});

// M6 合併過的匿名 token：帳號的帳只給帶著帳號 Bearer 的人看；舊 token 自己名下的帳不會被混進來
await attempt('M6', async () => {
  const OLD = 'device-m6old001', NEW = 'uid-m6new00001';
  const w = world({ env: { FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(false) } });
  put.merge(w.db, OLD, NEW);
  put.ledger(w.db, OLD, 'adjust', 100, { ref: 'm6-old' });                       // 舊 token 名下的（不該出現）
  give(w.db, NEW, { balance: 6, unlocked: ['south-coast'] });
  const viaOld = await me(w, `?actor=${OLD}`), viaNew = await me(w, `?actor=${NEW}`);
  // 改寫：舊版是「舊 token 與 uid 不帶任何憑證就看到同一份帳（resolveActor 轉向）」——那是洞。
  ok('M6a [改寫] 已併進 uid 的舊 device token、與 uid 本身，不帶 Bearer 讀 chips-me 一律 401 auth_required，本文沒有任何餘額或解鎖',
    [viaOld, viaNew].every(r => r.status === 401 && same(r.json, { error: 'auth_required' })), JSON.stringify([viaOld.json, viaNew.json]));
  const asUid = await withFirebase(NEW, () => me(w, '', { Authorization: 'Bearer tok-m6' }));
  const asUidWithOld = await withFirebase(NEW, () => me(w, `?actor=${OLD}`, { Authorization: 'Bearer tok-m6' }));
  const v = asUid.out;
  ok('M6b uid 本人帶 Bearer：餘額 6（不是 100、不是 106——舊 token 名下的不會混進來）、已解鎖 south-coast、nextCost 8；同時帶 ?actor=<舊 token> 也是同一份（Bearer 贏）',
    v.status === 200 && v.json.balance === 6 && v.json.unlocked.length === 1 && v.json.unlocked[0].scene === 'south-coast' &&
      v.json.nextCost === 8 && same(v.json, asUidWithOld.out.json), JSON.stringify([v.json, asUidWithOld.out.json]));
});

// M7 每一種回應（200／400／401／429／503）都標 no-store
await attempt('M7', async () => {
  const A = 'device-m7aa0001';
  const w = world({ env: { FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(false) } });
  const wBlk = world({ env: { FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(true) } });
  const { chips, ...noChips } = RULES; void chips;
  const wBad = world({ rules: noChips });
  const rs = {
    r200: await me(w, `?actor=${A}`), r400: await me(w, ''),
    r401: (await withFirebase(null, () => me(w, `?actor=${A}`, { Authorization: 'Bearer x' }))).out,
    r429: (await withFirebase('uid-m7000001', () => me(wBlk, `?actor=${A}`, { Authorization: 'Bearer x' }))).out,
    r503: await me(wBad, `?actor=${A}`),
  };
  const st = Object.fromEntries(Object.entries(rs).map(([k, r]) => [k, r.status + ':' + r.headers.get('cache-control')]));
  ok('M7 200／400／401／429／503 一律 cache-control: no-store（503 是設定缺 chips）',
    canon(st) === canon({ r200: '200:no-store', r400: '400:no-store', r401: '401:no-store', r429: '429:no-store', r503: '503:no-store' }), canon(st));
  ok('M7b 設定缺 chips → 503 not_ready（不是崩潰、也不是拿猜的預設值回一份假餘額）', rs.r503.json && rs.r503.json.error === 'not_ready', rs.r503.text);
});

// M8 經過 worker.fetch 的完整路由：GET 接得上、POST chips-me 被路由層 405、GET／PUT garage-redeem 被處理器 405、POST 進得了處理器
await attempt('M8', async () => {
  const A = 'device-m8aa0001';
  const w = world();
  give(w.db, A, { balance: 5 });
  const g = await routed(w, `/api/chips-me?actor=${A}`);
  const pc = await routed(w, `/api/chips-me?actor=${A}`, { method: 'POST', body: '{}' });
  const gr = await routed(w, '/api/garage-redeem');
  const put_ = await routed(w, '/api/garage-redeem', { method: 'PUT', body: '{}' });
  const pr = await routed(w, '/api/garage-redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(A, 'south-coast', 'req-m8-00001')) });
  ok('M8a 路由層：GET /api/chips-me → 200 且是這個人的帳（不是掉到資產層）', g.status === 200 && g.json && g.json.balance === 5 && g.json.nextCost === 4, g.text.slice(0, 120));
  ok('M8b POST /api/chips-me → 405（唯讀端點，路由層擋；Allow 標頭列出 GET）', pc.status === 405 && /GET/.test(pc.headers.get('allow') || ''), `${pc.status} ${pc.headers.get('allow')}`);
  ok('M8c GET／PUT /api/garage-redeem → 405 {error:"method"}（處理器自己收斂成只收 POST；不是 404、也不是被當成 POST 處理）',
    gr.status === 405 && gr.json && gr.json.error === 'method' && put_.status === 405 && put_.json && put_.json.error === 'method', `${gr.status} ${put_.status}`);
  ok('M8d POST /api/garage-redeem 經路由進得了處理器：200、餘額 5→1（證明 API_POST_ALLOWED 與 router 都接上）',
    pr.status === 200 && pr.json && pr.json.ok === true && pr.json.balance === 1 && q.nUnlock(w.db, A) === 1, pr.text.slice(0, 160));
});

// M8e 跨來源：App 殼（capacitor://localhost）的預檢與實際請求都帶得上 CORS；陌生來源不給
await attempt('M8e', async () => {
  const A = 'device-m8ee0001', ORIGIN = 'capacitor://localhost';
  const w = world();
  give(w.db, A, { balance: 5 });
  const pre1 = await routed(w, '/api/garage-redeem', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  const pre2 = await routed(w, '/api/chips-me', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  const g = await routed(w, `/api/chips-me?actor=${A}`, { headers: { Origin: ORIGIN } });
  const p = await routed(w, '/api/garage-redeem', { method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body(A, 'south-coast', 'req-m8e-00001')) });
  const evil = await routed(w, `/api/chips-me?actor=${A}`, { headers: { Origin: 'https://evil.example' } });
  ok('M8e App 殼預檢 204 且允許 POST；GET／POST 的實際回應都帶 Access-Control-Allow-Origin＝App 來源與 Vary: Origin；陌生來源不給 CORS 標頭',
    pre1.status === 204 && /POST/.test(pre1.headers.get('access-control-allow-methods') || '') && pre1.headers.get('access-control-allow-origin') === ORIGIN && pre2.status === 204 &&
      g.status === 200 && g.headers.get('access-control-allow-origin') === ORIGIN && /Origin/i.test(g.headers.get('vary') || '') &&
      p.status === 200 && p.headers.get('access-control-allow-origin') === ORIGIN && evil.headers.get('access-control-allow-origin') === null,
    JSON.stringify([pre1.status, pre1.headers.get('access-control-allow-methods'), g.headers.get('access-control-allow-origin'), p.headers.get('access-control-allow-origin'), evil.headers.get('access-control-allow-origin')]));
});
// M8f 用量埋點：兩支新端點記在自己的名字底下（API_ENDPOINTS 有登記），不是全部歸成 'other'
await attempt('M8f', async () => {
  const A = 'device-m8ff0001';
  const pts = [];
  const w = world({ env: { TRAFFIC: { writeDataPoint: d => pts.push(d.blobs[1]) } } });
  give(w.db, A, { balance: 5 });
  await routed(w, `/api/chips-me?actor=${A}`);
  await routed(w, '/api/garage-redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(A, 'south-coast', 'req-m8f-00001')) });
  ok('M8f 用量埋點：chips-me、garage-redeem 各記在自己的名字底下（不是 other）', canon(pts) === canon(['chips-me', 'garage-redeem']), canon(pts));
});

// ═══ R 組：POST /api/garage-redeem ═════════════════════════════════════════
// R1 成功一座：+5 → 兌換 south-coast → nth 1、cost 4、餘額 1；DB 恰一列解鎖、一筆負數 redeem（ref 是 <actor>.<requestId>）
await attempt('R1', async () => {
  const A = 'device-r1aa0001', RID = 'req-r1-0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 5, { ref: 'r1-seed' });
  const before = await me(w, `?actor=${A}`);
  const r = await redeem(w, body(A, 'south-coast', RID));
  ok('R1a 種入 +5：chips-me＝{5, 4, []}；兌換 south-coast → 200 {ok, scene, nth 1, cost 4, balance 1, unlocked[{south-coast,1,此刻}]}',
    before.json.balance === 5 && before.json.nextCost === 4 && before.json.unlocked.length === 0 && r.status === 200 &&
      same(r.json, { ok: true, scene: 'south-coast', nth: 1, cost: 4, balance: 1, unlocked: [{ scene: 'south-coast', nth: 1, at: NOW_MS }] }), r.text);
  ok('R1b 回應標 no-store', r.headers.get('cache-control') === 'no-store', String(r.headers.get('cache-control')));
  const rows = q.redeemRows(w.db, A), un = q.unlocks(w.db, A);
  ok('R1c DB：恰一筆 redeem（−4、ref＝"<actor>.<requestId>"、day 空、時間＝BOUNTY_NOW）與恰一列解鎖（south-coast、nth 1、cost 4）',
    rows.length === 1 && rows[0].delta === -4 && rows[0].ref === `${A}.${RID}` && rows[0].day === null && rows[0].created_at === NOW_MS &&
      un.length === 1 && un[0].scene === 'south-coast' && un[0].nth === 1 && un[0].cost === 4 && un[0].created_at === NOW_MS, JSON.stringify({ rows, un }));
  const after = await me(w, `?actor=${A}`);
  ok('R1d 兌換後 chips-me＝餘額 1、nextCost 8（第 2 座）、unlocked 一項', after.json.balance === 1 && after.json.nextCost === 8 &&
    same(after.json.unlocked, [{ scene: 'south-coast', nth: 1, at: NOW_MS }]), after.text);
});

// R2 同一個 requestId 重送：200、同一份結果、餘額仍是 1、redeem 仍只有一筆
await attempt('R2', async () => {
  const A = 'device-r2aa0001', RID = 'req-r2-0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 5, { ref: 'r2-seed' });
  const first = await redeem(w, body(A, 'south-coast', RID));
  const again = await redeem(w, body(A, 'south-coast', RID));
  const third = await redeem(w, body(A, 'south-coast', RID));
  ok('R2a 重送兩次：都是 200，本文與第一次逐字相同（{nth 1, cost 4, balance 1}）',
    first.status === 200 && again.status === 200 && third.status === 200 && again.text === first.text && third.text === first.text && first.json.balance === 1,
    JSON.stringify([first.text, again.text]));
  ok('R2b 重送不重複扣：redeem 恰一筆、解鎖恰一列、餘額 1', q.nRedeem(w.db, A) === 1 && q.nUnlock(w.db, A) === 1 && q.bal(w.db, A) === 1,
    JSON.stringify({ r: q.nRedeem(w.db, A), u: q.nUnlock(w.db, A), b: q.bal(w.db, A) }));
  // 對照：不同 requestId 對同一座＝這才是「已經解鎖」
  const other = await redeem(w, body(A, 'south-coast', 'req-r2-0002'));
  ok('R2c 對照組：換一個 requestId 再兌換同一座 → 409 already（重送與重複兌換是兩件事，不能混成一條）', other.status === 409 && other.json.error === 'already', other.text);
});

// R3 價格：第 1 座 4、其後每座 8，價目表最後一格一直沿用；餘額剛好等於價格可以、少 1 不行
await attempt('R3', async () => {
  const A = 'device-r3aa0001';
  const w = world();
  give(w.db, A, { balance: 7, unlocked: ['south-coast'] });
  const short = await redeem(w, body(A, 'shifen', 'req-r3-short01'));
  ok('R3a 餘額 7＋已解鎖 1 座 → 第 2 座 409 not_enough {cost 8, balance 7}，什麼都沒扣（餘額仍 7、解鎖仍 1 座）',
    short.status === 409 && same(short.json, { error: 'not_enough', cost: 8, balance: 7 }) && q.bal(w.db, A) === 7 && q.nUnlock(w.db, A) === 1 && q.nRedeem(w.db, A) === 1, short.text);
  const B = 'device-r3bb0001';
  give(w.db, B, { balance: 16, unlocked: ['south-coast'] });
  const enough = await redeem(w, body(B, 'shifen', 'req-r3-enough1'));
  ok('R3b 餘額 16＋已解鎖 1 座 → 第 2 座成功：nth 2、cost 8、餘額 8',
    enough.status === 200 && enough.json.nth === 2 && enough.json.cost === 8 && enough.json.balance === 8 && q.unlocks(w.db, B)[1].cost === 8, enough.text);
  const C = 'device-r3cc0001';
  give(w.db, C, { balance: 8, unlocked: ['south-coast', 'shifen', 'viaduct'] });
  const fourth = await redeem(w, body(C, 'alishan', 'req-r3-fourth01'));
  ok('R3c 已解鎖 3 座、餘額 8 → 第 4 座 alishan：nth 4、cost 8、餘額 0（價目表最後一格沿用，餘額剛好等於價格也可以）',
    fourth.status === 200 && fourth.json.nth === 4 && fourth.json.cost === 8 && fourth.json.balance === 0, fourth.text);
  // 第 5 座：預設只有四座場景，補一座讓價目表的「沿用」看得見
  const rules5 = { ...RULES, chips: { ...RULES.chips, scenes: [...RULES.chips.scenes, 'tunnel'] } };
  const w5 = world({ rules: rules5 });
  const D5 = 'device-r3dd0001';
  give(w5.db, D5, { balance: 8, unlocked: ['south-coast', 'shifen', 'viaduct', 'alishan'] });
  const chk = await me(w5, `?actor=${D5}`);
  const fifth = await redeem(w5, body(D5, 'tunnel', 'req-r3-fifth001'));
  ok('R3d 第 5 座（補一座場景）：nextCost 仍是 8、兌換 nth 5、cost 8、餘額 0——不會因為超出價目表就變成 0 或 undefined',
    chk.json.nextCost === 8 && fifth.status === 200 && fifth.json.nth === 5 && fifth.json.cost === 8 && fifth.json.balance === 0, fifth.text);
  const E = 'device-r3ee0001', F = 'device-r3ff0001';
  put.ledger(w.db, E, 'adjust', 4, { ref: 'r3e' }); put.ledger(w.db, F, 'adjust', 3, { ref: 'r3f' });
  const exact = await redeem(w, body(E, 'alishan', 'req-r3-exact001'));       // 第一座可以是任何一座，價格都是 4
  const minus1 = await redeem(w, body(F, 'alishan', 'req-r3-minus101'));
  ok('R3e 第 1 座不論哪一座都是 4：餘額 4 → 成功（nth 1、cost 4、餘額 0）；餘額 3 → 409 not_enough {cost 4, balance 3}',
    exact.status === 200 && exact.json.nth === 1 && exact.json.cost === 4 && exact.json.balance === 0 &&
      minus1.status === 409 && same(minus1.json, { error: 'not_enough', cost: 4, balance: 3 }) && q.nUnlock(w.db, F) === 0, JSON.stringify([exact.text, minus1.text]));
});

// R4 已解鎖 → 409 already，不扣款；「已解鎖」優先於「餘額不足」
await attempt('R4', async () => {
  const A = 'device-r4aa0001', B = 'device-r4bb0001';
  const w = world();
  give(w.db, A, { balance: 20, unlocked: ['south-coast'] });
  const s0 = snap(w.db, A);
  const r = await redeem(w, body(A, 'south-coast', 'req-r4-new-01'));
  ok('R4a 已解鎖的場景再兌換（新的 requestId）→ 409 {error:"already"}；帳本、餘額、解鎖表一個字都沒動', r.status === 409 && same(r.json, { error: 'already' }) && snap(w.db, A) === s0, r.text);
  give(w.db, B, { balance: 0, unlocked: ['south-coast'] });
  const r2 = await redeem(w, body(B, 'south-coast', 'req-r4-new-02'));
  ok('R4b 已解鎖且餘額 0：回 already 不是 not_enough（別叫使用者去賺籌碼買他已經有的東西）', r2.status === 409 && r2.json.error === 'already', r2.text);
});

// R5 輸入驗證：未知場景、requestId 必填且格式合法；全部零寫入
await attempt('R5', async () => {
  const A = 'device-r5aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 20, { ref: 'r5-seed' });
  const s0 = snap(w.db, A);
  const unk = [];
  for (const sc of ['no-such-scene', 'South-Coast', 'south-coast ', '', undefined, 5, null, { x: 1 }, ['south-coast']]) {
    const r = await redeem(w, { actor: A, scene: sc, requestId: 'req-r5-unk-01' });
    unk.push(r.status + ':' + (r.json && r.json.error));
  }
  ok('R5a 未知場景（含大小寫不同、尾端空白、缺、數字、null、物件、陣列）→ 一律 400 unknown_scene', unk.every(x => x === '400:unknown_scene'), JSON.stringify(unk));
  const bads = [];
  for (const rid of [undefined, null, '', 'short', 'has space here', 'a.b.c.d.e.f.g.h', '中文的請求編號12', 'x'.repeat(65), 12345678, ['req-r5-00001']]) {
    const b = { actor: A, scene: 'south-coast' }; if (rid !== undefined) b.requestId = rid;
    const r = await redeem(w, b);
    bads.push(r.status + ':' + (r.json && r.json.error));
  }
  ok('R5b requestId 缺、null、空、太短、含空白或點、CJK、65 字、數字、陣列 → 一律 400 bad_request_id（兌換是扣錢的動作，沒有去重鍵不能收）', bads.every(x => x === '400:bad_request_id'), JSON.stringify(bads));
  ok('R5c 上面十九個壞請求之後，帳本、解鎖表一個字都沒動', snap(w.db, A) === s0);
  const ok64 = await redeem(w, body(A, 'south-coast', 'x'.repeat(64)));
  const ok8 = await redeem(w, body(A, 'shifen', 'ab-_CD12'));
  ok('R5d 對照：64 字與 8 字（含 - 與 _）的 requestId 是合法的 → 兩筆都成功（nth 1、nth 2）', ok64.status === 200 && ok8.status === 200 && ok64.json.nth === 1 && ok8.json.nth === 2, JSON.stringify([ok64.text, ok8.text]));
});

// R6 閘門：送不進去的請求一律零 D1 存取（節流／寫入總閘／壞 JSON／壞 actor／座標／壞 requestId／未知場景）
await attempt('R6', async () => {
  const A = 'device-r6aa0001';
  const mk = env => world({ env });
  const cases = [];
  const run = async (name, w, b, want, hdr) => {
    const r = await redeem(w, b, hdr);
    cases.push({ name, got: r.status + ':' + (r.json && r.json.error), want, sql: w.sql.length, cc: r.headers.get('cache-control') });
  };
  await run('限流擋下', mk({ BOUNTY_LIMITER: limiter(true) }), body(A, 'south-coast', 'req-r6-00001'), '429:rate_limited');
  await run('限流器丟例外（fail-closed）', mk({ BOUNTY_LIMITER: throwingLimiter }), body(A, 'south-coast', 'req-r6-00002'), '429:rate_limited');
  await run('寫入總閘 off', mk({ BOUNTY_WRITES: 'off' }), body(A, 'south-coast', 'req-r6-00003'), '503:bounty_paused');
  await run('寫入總閘 OFF（大小寫不拘）', mk({ BOUNTY_WRITES: 'OFF' }), body(A, 'south-coast', 'req-r6-00004'), '503:bounty_paused');
  await run('壞 JSON', mk({}), '{not json', '400:bad_json');
  await run('沒有 actor', mk({}), { scene: 'south-coast', requestId: 'req-r6-00005' }, '400:bad_actor');
  await run('壞 actor（../）', mk({}), body('../etc/x', 'south-coast', 'req-r6-00006'), '400:bad_actor');
  await run('帶座標 lat', mk({}), body(A, 'south-coast', 'req-r6-00007', { lat: 25.03 }), '400:coordinates_not_accepted');
  await run('巢狀座標 extra.coords', mk({}), body(A, 'south-coast', 'req-r6-00008', { extra: { coords: [121.5, 25.0] } }), '400:coordinates_not_accepted');
  await run('大小寫不同的 Position', mk({}), body(A, 'south-coast', 'req-r6-00009', { Position: 1 }), '400:coordinates_not_accepted');
  await run('壞 requestId', mk({}), body(A, 'south-coast', 'no'), '400:bad_request_id');
  await run('未知場景', mk({}), body(A, 'nowhere', 'req-r6-00010'), '400:unknown_scene');
  ok('R6a 七類被擋的請求：狀態碼與錯誤碼逐一符合', cases.every(c => c.got === c.want), JSON.stringify(cases.filter(c => c.got !== c.want)));
  ok('R6b 這些被擋的請求一律零 D1 存取（沒有任何一句 SQL 被 prepare：節流與驗證擋在存取之前）', cases.every(c => c.sql === 0), JSON.stringify(cases.filter(c => c.sql !== 0)));
  ok('R6c 每一個被擋的回應都標 no-store', cases.every(c => c.cc === 'no-store'));
  // 總閘只擋寫入：停機期間 chips-me 仍讀得到自己的餘額
  const wOff = world({ env: { BOUNTY_WRITES: 'off' } });
  put.ledger(wOff.db, A, 'adjust', 5, { ref: 'r6-off' });
  const rd = await redeem(wOff, body(A, 'south-coast', 'req-r6-off001'));
  const rm = await me(wOff, `?actor=${A}`);
  ok('R6d BOUNTY_WRITES=off：兌換 503 bounty_paused、什麼都沒寫（餘額仍 5、無解鎖）；同一個世界 chips-me 仍 200 讀得到餘額 5',
    rd.status === 503 && rd.json.error === 'bounty_paused' && q.bal(wOff.db, A) === 5 && q.nUnlock(wOff.db, A) === 0 && rm.status === 200 && rm.json.balance === 5,
    JSON.stringify([rd.text, rm.text]));
  const wOn = world({ env: { BOUNTY_WRITES: 'on' } });
  put.ledger(wOn.db, A, 'adjust', 5, { ref: 'r6-on' });
  const ron = await redeem(wOn, body(A, 'south-coast', 'req-r6-on0001'));
  ok('R6e 對照：BOUNTY_WRITES 不是 off（on）→ 正常兌換', ron.status === 200, ron.text);
  // 設定缺 chips：兌換 503 not_ready，零寫入（不拿猜的價格扣人家的籌碼）
  const { chips, ...noChips } = RULES; void chips;
  const wBad = world({ rules: noChips });
  put.ledger(wBad.db, A, 'adjust', 50, { ref: 'r6-bad' });
  const rb = await redeem(wBad, body(A, 'south-coast', 'req-r6-bad0001'));
  ok('R6f 設定缺 chips → 503 not_ready，餘額仍 50、無解鎖', rb.status === 503 && rb.json.error === 'not_ready' && q.bal(wBad.db, A) === 50 && q.nUnlock(wBad.db, A) === 0, rb.text);
});

// R7 合併過的 token：兌換動的是 uid 的帳；重送靠「解析前的 actor」對得上同一筆（合併把帳搬去 uid 之後，重送仍是同一個結果）
await attempt('R7', async () => {
  const OLD = 'device-r7old001', NEW = 'uid-r7new00001';
  const w = world({ env: { FIREBASE_WEB_API_KEY: 'k' } });
  put.merge(w.db, OLD, NEW);
  put.ledger(w.db, NEW, 'adjust', 5, { ref: 'r7-new' });
  // 改寫：已併進帳號的舊 token 兌換必須帶該帳號（NEW）的 Bearer；舊版不帶憑證就花得掉別人的籌碼
  const { out: r, calls: r7calls } = await withFirebase(NEW, () => redeem(w, body(OLD, 'south-coast', 'req-r7-00001'), { Authorization: 'Bearer tok-r7' }));
  ok('R7a 舊 device token 兌換（帶 uid 的 Bearer）→ 扣的是 uid 的帳：uid 名下 1 座解鎖＋1 筆 redeem（−4），舊 token 名下什麼都沒有；Firebase 恰好查 1 次',
    r.status === 200 && r.json.balance === 1 && q.nUnlock(w.db, NEW) === 1 && q.nRedeem(w.db, NEW) === 1 && q.nUnlock(w.db, OLD) === 0 && q.nLedger(w.db, OLD) === 0 && r7calls.length === 1, r.text);
  ok('R7a2 帳本 ref 用的是「解析前」的 actor（客戶端送的那個舊 token）："<舊 token>.<requestId>"，不是解析後的 uid——'
    + '合併前後、換裝置重送，客戶端手上永遠只有它自己送出去的那個 actor，ref 才對得上',
    q.redeemRows(w.db, NEW).length === 1 && q.redeemRows(w.db, NEW)[0].ref === `${OLD}.req-r7-00001`, JSON.stringify(q.redeemRows(w.db, NEW)));
  // 重送＋合併：先用還沒合併的 device 兌換，之後合併（帳搬給 uid、ref 不變），舊 token 重送同一個 requestId
  const w2 = world({ env: { FIREBASE_WEB_API_KEY: 'k' } });
  const OLD2 = 'device-r7old002', NEW2 = 'uid-r7new00002';
  put.ledger(w2.db, OLD2, 'adjust', 5, { ref: 'r7-old2' });
  const first = await redeem(w2, body(OLD2, 'south-coast', 'req-r7-00002'));
  w2.db.prepare('UPDATE chip_ledger SET actor=? WHERE actor=?').run(NEW2, OLD2);
  w2.db.prepare('UPDATE garage_unlocks SET actor=? WHERE actor=?').run(NEW2, OLD2);
  put.merge(w2.db, OLD2, NEW2);
  // 改寫：合併後 OLD2 已併進 NEW2，重送要帶 NEW2 的 Bearer（第一次是合併前、匿名兌換，不需要）
  const replay = (await withFirebase(NEW2, () => redeem(w2, body(OLD2, 'south-coast', 'req-r7-00002'), { Authorization: 'Bearer tok-r7b' }))).out;
  ok('R7b 合併前兌換、合併後（帳搬給 uid）帶 uid 的 Bearer 重送同一個 requestId → 200 與第一次同一份 {nth 1, cost 4, balance 1}，不是 409 already、也不會再扣',
    first.status === 200 && replay.status === 200 && replay.text === first.text && q.nRedeem(w2.db, NEW2) === 1 && q.bal(w2.db, NEW2) === 1, JSON.stringify([first.text, replay.text]));
  ok('R7c 合併搬帳只換 actor、ref 不動：搬過去的那筆 redeem 的 ref 仍是 "<舊 token>.<requestId>"（重送靠它對得上）',
    q.redeemRows(w2.db, NEW2).length === 1 && q.redeemRows(w2.db, NEW2)[0].ref === `${OLD2}.req-r7-00002`, JSON.stringify(q.redeemRows(w2.db, NEW2)));
});

// ═══ C 組：併發與競態═══════════════════════════════════════════════
// 自然交錯（Promise.all）：兩個請求同時讀到「還沒解鎖、餘額夠」，靠 D1 端的條件式寫入分出勝負
await attempt('C1', async () => {
  const A = 'device-c1aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 8, { ref: 'c1-seed' });
  const rs = await Promise.all([redeem(w, body(A, 'south-coast', 'req-c1-000001')), redeem(w, body(A, 'south-coast', 'req-c1-000002'))]);
  const st = rs.map(r => r.status).sort().join(',');
  const loser = rs.find(r => r.status !== 200);
  ok('C1 餘額 8、兩個不同 requestId 同時兌換「同一座」→ 恰一個 200、另一個 409 already；只扣一次（餘額 4）、一列解鎖、一筆 redeem',
    st === '200,409' && loser.json.error === 'already' && q.bal(w.db, A) === 4 && q.nUnlock(w.db, A) === 1 && q.nRedeem(w.db, A) === 1,
    JSON.stringify({ st, loser: loser && loser.json, bal: q.bal(w.db, A), u: q.nUnlock(w.db, A), r: q.nRedeem(w.db, A) }));
});
await attempt('C2', async () => {
  const A = 'device-c2aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 12, { ref: 'c2-seed' });
  const rs = await Promise.all([redeem(w, body(A, 'south-coast', 'req-c2-000001')), redeem(w, body(A, 'shifen', 'req-c2-000002'))]);
  const un = q.unlocks(w.db, A), rd = q.redeemRows(w.db, A);
  ok('C2 餘額 12、同時兌換「兩座不同場景」→ 兩個都成功；一座是第 1 座（4）、一座是第 2 座（8），不是兩座都拿第 1 座的價格；餘額 0',
    rs.every(r => r.status === 200) && canon(rs.map(r => r.json.nth).sort()) === '[1,2]' && q.bal(w.db, A) === 0 &&
      canon(un.map(u => [u.nth, u.cost])) === '[[1,4],[2,8]]' && canon(rd.map(r => r.delta)) === '[-8,-4]',
    JSON.stringify({ st: rs.map(r => r.status), nth: rs.map(r => r.json.nth), un, rd }));
});
await attempt('C3', async () => {
  const A = 'device-c3aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 11, { ref: 'c3-seed' });
  const rs = await Promise.all([redeem(w, body(A, 'south-coast', 'req-c3-000001')), redeem(w, body(A, 'shifen', 'req-c3-000002'))]);
  const win = rs.find(r => r.status === 200), lose = rs.find(r => r.status !== 200);
  ok('C3 餘額 11、同時兌換兩座 → 恰一個成功（第 1 座 4）、另一個 409 not_enough {cost 8, balance 7}；餘額 7、不會是負的',
    !!win && !!lose && win.json.nth === 1 && win.json.cost === 4 && lose.status === 409 && same(lose.json, { error: 'not_enough', cost: 8, balance: 7 }) &&
      q.bal(w.db, A) === 7 && q.nUnlock(w.db, A) === 1, JSON.stringify({ st: rs.map(r => r.status), bodies: rs.map(r => r.json), bal: q.bal(w.db, A) }));
});
// 同一個 requestId 併發重送：兩個都要回 200 同一座，且只扣一次
await attempt('C4', async () => {
  const A = 'device-c4aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 8, { ref: 'c4-seed' });
  const rs = await Promise.all([redeem(w, body(A, 'south-coast', 'req-c4-000001')), redeem(w, body(A, 'south-coast', 'req-c4-000001'))]);
  ok('C4 同一個 requestId 同時送兩次 → 兩個都 200、都是 nth 1／cost 4／餘額 4；恰一筆 redeem、一列解鎖（重送不會變成 409 也不會多扣）',
    rs.every(r => r.status === 200 && r.json.nth === 1 && r.json.cost === 4 && r.json.balance === 4) && q.nRedeem(w.db, A) === 1 && q.nUnlock(w.db, A) === 1 && q.bal(w.db, A) === 4,
    JSON.stringify({ st: rs.map(r => r.status), b: rs.map(r => r.json), r: q.nRedeem(w.db, A), u: q.nUnlock(w.db, A) }));
});
// 同一個 requestId 拿去兌換兩座不同場景（客戶端 bug）併發：只能有一座被解鎖、只扣一次；輸的那個回 409 conflict
await attempt('C5', async () => {
  const A = 'device-c5aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 12, { ref: 'c5-seed' });
  const rs = await Promise.all([redeem(w, body(A, 'south-coast', 'req-c5-000001')), redeem(w, body(A, 'shifen', 'req-c5-000001'))]);
  const lose = rs.find(r => r.status !== 200);
  ok('C5 同一個 requestId 併發兌換兩座不同場景 → 恰一座解鎖、只扣一次（餘額 8）；輸的那個 409 conflict（不會憑對方的帳本列白拿一座）',
    rs.map(r => r.status).sort().join() === '200,409' && lose.json.error === 'conflict' && q.nUnlock(w.db, A) === 1 && q.nRedeem(w.db, A) === 1 && q.bal(w.db, A) === 8,
    JSON.stringify({ st: rs.map(r => r.status), lose: lose && lose.json, u: q.nUnlock(w.db, A), r: q.nRedeem(w.db, A), b: q.bal(w.db, A) }));
});
// 同一個 requestId 用在不同場景（循序）：第二次 409 conflict，不扣款、不解鎖第二座
await attempt('C5b', async () => {
  const A = 'device-c5bb0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 12, { ref: 'c5b-seed' });
  const a = await redeem(w, body(A, 'south-coast', 'req-c5b-00001'));
  const b = await redeem(w, body(A, 'shifen', 'req-c5b-00001'));
  ok('C5b 循序：同一個 requestId 先兌換 south-coast、再拿去兌換 shifen → 第二次 409 conflict；shifen 沒解鎖、沒扣款（餘額 8）',
    a.status === 200 && b.status === 409 && b.json.error === 'conflict' && q.unlocks(w.db, A).length === 1 && q.bal(w.db, A) === 8, JSON.stringify([a.text, b.text]));
});
// 鉤子：模擬「別的請求在我讀完之後、寫入之前搶先提交」。自然交錯測不到的兩道守衛靠它各自單獨驗
await attempt('C6', async () => {
  const A = 'device-c6aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 5, { ref: 'c6-seed' });
  w.beforeBatch = () => put.ledger(w.db, A, 'adjust', -3, { ref: 'c6-drain' });    // 讀到 5 之後、寫入之前，餘額被別的動作花到 2
  const r = await redeem(w, body(A, 'south-coast', 'req-c6-000001'));
  ok('C6 餘額守衛：我讀到餘額 5（夠）、寫入前被扣到 2 → 不能寫出負餘額。重讀後 409 not_enough {cost 4, balance 2}；沒有解鎖、沒有 redeem 帳',
    w.batches >= 1 && r.status === 409 && same(r.json, { error: 'not_enough', cost: 4, balance: 2 }) && q.bal(w.db, A) === 2 && q.nUnlock(w.db, A) === 0 && q.nRedeem(w.db, A) === 0, JSON.stringify({ r: r.text, bal: q.bal(w.db, A), u: q.nUnlock(w.db, A) }));
});
await attempt('C7', async () => {
  const A = 'device-c7aa0001';
  const w = world();
  put.ledger(w.db, A, 'adjust', 12, { ref: 'c7-seed' });
  w.beforeBatch = () => {                                                            // 別的請求搶先解鎖了 shifen（第 1 座、花 4）
    put.unlock(w.db, A, 'shifen', 1, 4, NOW_MS - 1234); put.ledger(w.db, A, 'redeem', -4, { ref: 'other-req-c7' });
  };
  const r = await redeem(w, body(A, 'south-coast', 'req-c7-000001'));
  ok('C7 名次守衛：我讀到「0 座已解鎖、我是第 1 座、4」、寫入前別人搶先解鎖了一座 → 不能用過期的價格 4 收我的錢。重讀後我是第 2 座、8：'
    + '200 {nth 2, cost 8, balance 0, unlocked[shifen, south-coast]}',
    r.status === 200 && same(r.json, { ok: true, scene: 'south-coast', nth: 2, cost: 8, balance: 0,
      unlocked: [{ scene: 'shifen', nth: 1, at: NOW_MS - 1234 }, { scene: 'south-coast', nth: 2, at: NOW_MS }] }) &&
      canon(q.unlocks(w.db, A).map(u => [u.scene, u.nth, u.cost])) === '[["shifen",1,4],["south-coast",2,8]]' && q.bal(w.db, A) === 0, r.text);
});

// ═══ B 組：看板常青線（bounty-board）══════════════════════════════════════
const bRow = (segKey, kind, dir, k, slot, points, samples, distinct, covered) =>
  `('${segKey}','${segKey.split('|')[0]}','${kind}',${dir},'${k}','${slot}',1,1,${points},10,1,1,${samples},${covered ?? 'NULL'},${distinct})`;
const bSeed = rows => `INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at,distinct_ok_users) VALUES ${rows.join(',')};`;
const C_AT = NOW_MS - 3600e3;   // 種子裡「已收滿」的時間
const BOARD_ROWS = [
  bRow('tra_sched|山線|S0|S1', '自強', 0, 'track', '', 3, 0, 50, C_AT),          // 一般線、已收滿 → 不該出現
  bRow('tra_sched|山線|S1|S2', '自強', 0, 'track', '', 5, 2, 7, null),           // 一般線、沒收滿 → 山線卡（只有這一個單位）
  bRow('tra_sched|南迴線|S0|S1', '自強', 0, 'track', '', 9, 4, 60, C_AT),        // 常青線、整張卡都收滿
  bRow('tra_sched|南迴線|S1|S2', '自強', 0, 'track', '', 9, 5, 55, C_AT),
  bRow('tra_sched|南迴線|S0|S1', '自強', 1, 'track', '', 3, 0, 12, null),        // 常青線、另一個方向沒收滿
  bRow('tra_sched|臺東線|S0|S1', '區間', 0, 'track', '', 4, 1, 51, C_AT),        // 第二條常青線、收滿
  bRow('tra_sched|臺東線|S1|S2', '自強', 0, 'track', '', 8, 3, 55, C_AT),        // 臺東線混合卡：一個收滿
  bRow('tra_sched|臺東線|S2|S3', '自強', 0, 'track', '', 6, 1, 20, null),        //             一個沒收滿
  bRow('tra_sched|南迴線二|S0|S1', '自強', 0, 'track', '', 8, 0, 60, C_AT),      // 名字只是「開頭像」南迴線：不是常青線 → 收滿就下架
  bRow('thsr_sched|THSR|S0|S1', '標準', 0, 'track', '', 7, 0, 3, null),
  bRow('afr_sched|阿里山線|S0|S1', '一般', 0, 'track', '', 1, 0, 0, null),
  bRow('tra_sched|山線|S3|S3', '自強', 0, 'dwell', 'peak', 4, 0, 30, C_AT),      // dwell 收滿仍在架上、行為不變
  bRow('tra_sched|山線|S4|S4', '自強', 0, 'dwell', 'off', 2, 0, 0, null),
];
// 期望的卡片順序（手算）：沒收滿的依點數大到小 7、6、5、4、3、2、1，收滿的排最後（18 分的南迴卡在 4 分的臺東卡前面）
const BOARD_ORDER = [
  'thsr_sched|THSR|0|標準|track|', 'tra_sched|臺東線|0|自強|track|', 'tra_sched|山線|0|自強|track|', 'tra_sched|山線|0|自強|dwell|peak',
  'tra_sched|南迴線|1|自強|track|', 'tra_sched|山線|0|自強|dwell|off', 'afr_sched|阿里山線|0|一般|track|',
  'tra_sched|南迴線|0|自強|track|', 'tra_sched|臺東線|0|區間|track|',
];
const CARD_KEYS = ['id', 'sys', 'lnId', 'dir', 'trainKind', 'kind', 'slot', 'unitKeys', 'units', 'points', 'samples', 'claimers', 'coverN', 'need', 'distinctOk', 'covered'].sort();
await attempt('B1', async () => {
  const w = world({ seed: bSeed(BOARD_ROWS) });
  const r = await board(w);
  const cards = (r.json && r.json.cards) || [];
  const by = id => cards.find(c => c.id === id) || {};
  ok('B1a 一般線收滿的單位不在板上（山線 S0|S1）；常青線（南迴線、臺東線）收滿的還在；名字只是開頭像的「南迴線二」收滿就下架；共 9 張卡、順序照手算',
    r.status === 200 && canon(cards.map(c => c.id)) === canon(BOARD_ORDER) && !cards.some(c => c.unitKeys.includes('tra_sched|山線|S0|S1') || c.unitKeys.some(k => k.includes('南迴線二'))),
    JSON.stringify(cards.map(c => c.id)));
  const ev = by('tra_sched|南迴線|0|自強|track|'), tt = by('tra_sched|臺東線|0|區間|track|');
  ok('B1b 常青線整張收滿的卡：covered:true、單位全在（南迴 2 段共 18 點；臺東區間 1 段 4 點）、排在所有沒收滿的卡後面',
    ev.covered === true && ev.units === 2 && ev.points === 18 && ev.samples === 9 && tt.covered === true && tt.units === 1 && tt.points === 4 &&
      cards.slice(-2).every(c => c.covered === true) && cards.slice(0, 7).every(c => c.covered === false), JSON.stringify([ev, tt]));
  const th = by('thsr_sched|THSR|0|標準|track|'), sl = by('tra_sched|山線|0|自強|track|'), af = by('afr_sched|阿里山線|0|一般|track|');
  ok('B1c need：台鐵卡 50、高鐵卡 15、阿里山（歸台鐵家族）50——查表要先過系統家族的桶（用 sys id 直接查會全部落空）',
    sl.need === 50 && th.need === 15 && af.need === 50 && ev.need === 50, JSON.stringify({ sl: sl.need, th: th.need, af: af.need }));
  ok('B1d distinctOk＝卡上各單位人數的最小值：高鐵 3、山線 7、阿里山 0、南迴收滿卡 min(60,55)＝55、臺東區間 51',
    th.distinctOk === 3 && sl.distinctOk === 7 && af.distinctOk === 0 && ev.distinctOk === 55 && tt.distinctOk === 51, JSON.stringify({ th: th.distinctOk, sl: sl.distinctOk, af: af.distinctOk, ev: ev.distinctOk }));
  ok('B1e 舊欄位原樣保留（samples 是趟數、coverN 是趟數門檻、units／points／claimers／unitKeys／id／sys／lnId／dir／trainKind／kind／slot），加上 need／distinctOk／covered，恰 16 個鍵',
    cards.every(c => canon(Object.keys(c).sort()) === canon(CARD_KEYS)) && sl.samples === 2 && sl.coverN === 1 && th.coverN === 1 && sl.units === 1 && sl.points === 5 && sl.claimers === 0 &&
      sl.sys === 'tra_sched' && sl.lnId === '山線' && sl.dir === 0 && sl.trainKind === '自強' && sl.kind === 'track' && sl.slot === '' &&
      canon(sl.unitKeys) === canon(['tra_sched|山線|S1|S2']) && r.json.coverN && r.json.coverN.metro === 3 && typeof r.json.at === 'number', JSON.stringify(sl));
  const mix = by('tra_sched|臺東線|0|自強|track|'), zero = by('tra_sched|南迴線|1|自強|track|');
  ok('B1f 常青線的混合卡（臺東線自強：一段收滿、一段沒收滿）：covered:false；收滿的那一段不算進卡（1 個單位、6 點、只有 S2|S3），與「接得了的單位」一致',
    mix.covered === false && mix.units === 1 && mix.points === 6 && mix.samples === 1 && mix.distinctOk === 20 && canon(mix.unitKeys) === canon(['tra_sched|臺東線|S2|S3']) &&
      zero.covered === false && zero.points === 3 && zero.distinctOk === 12, JSON.stringify([mix, zero]));
  const dp = by('tra_sched|山線|0|自強|dwell|peak'), dof = by('tra_sched|山線|0|自強|dwell|off');
  ok('B1g dwell 行為不變：收滿的停站點仍在架上、covered 恆 false、依點數排序（4 分的收滿 dwell 排在 3 分的沒收滿南迴卡前面）、need／distinctOk 照樣有',
    dp.covered === false && dp.units === 1 && dp.points === 4 && dp.distinctOk === 30 && dp.need === 50 && dof.covered === false && dof.points === 2 &&
      cards.findIndex(c => c.id === dp.id) < cards.findIndex(c => c.id === zero.id), JSON.stringify([dp, dof]));
  ok('B1h 快取行為不變：cache-control 仍是 public, s-maxage=300, stale-while-revalidate=900（板是公開資料，不是 no-store）',
    r.headers.get('cache-control') === 'public, s-maxage=300, stale-while-revalidate=900', String(r.headers.get('cache-control')));
});
// B2 常青線名單來自設定檔，不是寫死：沒有 evergreen 時，收滿的南迴線／臺東線一樣下架
await attempt('B2', async () => {
  const rules = { ...RULES, chips: { ...RULES.chips, evergreen: [] } };
  const w = world({ rules, seed: bSeed(BOARD_ROWS) });
  const r = await board(w);
  const ids = r.json.cards.map(c => c.id);
  ok('B2 evergreen 是空的 → 收滿的常青線單位不再出現（南迴 dir0 卡沒了、臺東區間卡沒了）；沒收滿的照舊；沒有任何卡是 covered:true',
    r.status === 200 && !ids.includes('tra_sched|南迴線|0|自強|track|') && !ids.includes('tra_sched|臺東線|0|區間|track|') &&
      ids.includes('tra_sched|南迴線|1|自強|track|') && ids.includes('tra_sched|臺東線|0|自強|track|') && r.json.cards.every(c => c.covered === false), JSON.stringify(ids));
});
// B3 設定檔沒有 coverDistinct → need 退回 coverN（台鐵 1、高鐵 1），而不是 undefined／0
await attempt('B3', async () => {
  const { coverDistinct, ...legacy } = RULES; void coverDistinct;
  const w = world({ rules: legacy, seed: bSeed(BOARD_ROWS) });
  const r = await board(w);
  const th = r.json.cards.find(c => c.id === 'thsr_sched|THSR|0|標準|track|'), sl = r.json.cards.find(c => c.id === 'tra_sched|山線|0|自強|track|');
  ok('B3 設定檔還沒升 v2（沒有 coverDistinct）→ need 退回 coverN：高鐵 1、台鐵 1', th.need === 1 && sl.need === 1, JSON.stringify([th.need, sl.need]));
});
// B4 快取鍵沒被查詢字串汙染：帶 ?x=1 進來，寫進邊緣快取的鍵仍是不帶查詢字串的 /api/bounty-board
await attempt('B4', async () => {
  const w = world({ seed: bSeed(BOARD_ROWS) });
  edgePuts.length = 0;
  await board(w, '/api/bounty-board?x=1&actor=device-b4aa0001');
  ok('B4 快取鍵＝https://railisland.tw/api/bounty-board（不含查詢字串）', edgePuts.length === 1 && edgePuts[0] === 'https://railisland.tw/api/bounty-board', JSON.stringify(edgePuts));
});
// B5 純函式：直接餵列，證明「分組」本身不靠 DB 過濾——covered 只給 track、dwell 不受影響
await attempt('B5', async () => {
  const mk = (seg, k, dir, kind, slot, pts, dist, cov) => ({ seg_key: seg, sys: seg.split('|')[0], train_kind: k, dir, kind, slot, points: pts, sample_count: 0, distinct_ok_users: dist, covered_at: cov });
  const cards = _bounty.groupBoardRows([
    mk('tra_sched|南迴線|S0|S1', '自強', 0, 'track', '', 5, 50, 1), mk('tra_sched|南迴線|S1|S2', '自強', 0, 'track', '', 5, 70, 1),
    mk('tra_sched|山線|S0|S0', '自強', 0, 'dwell', 'peak', 9, 80, 1),
  ], new Map(), { TRA: 1, THSR: 1, metro: 3 }, { TRA: 50, THSR: 15 });
  const tk = cards.find(c => c.kind === 'track'), dw = cards.find(c => c.kind === 'dwell');
  ok('B5 全收滿的 track 卡 covered:true（單位都在、distinctOk 50）；全收滿的 dwell 卡 covered:false；dwell 排在收滿的 track 卡前面（9 分 vs 10 分：因為 covered 排最後）',
    tk.covered === true && tk.units === 2 && tk.distinctOk === 50 && tk.need === 50 && dw.covered === false && cards[0].id === dw.id && cards[1].id === tk.id, JSON.stringify(cards.map(c => [c.id, c.covered, c.units])));
});

// ═══ T 組：整段收滿（cron 的 covered_at）══════════════════════════════════
const segKey = (sys, ln, s) => `${sys}|${ln}|${s}`;
const SEGS9 = Array.from({ length: 9 }, (_, i) => `S${i}|S${i + 1}`);
// points 有差別是刻意的：沒接懸賞就直接錄的那一趟，被計功的是「同段同方向點數最高的那一列」（同分依車種字典序），
// 所以要讓自強0 的點數最高，才知道 sample_count 該落在哪一列。
const tBoard = (sys, ln, rows, segs = SEGS9) => bSeed(segs.flatMap(s => rows.map(r => bRow(segKey(sys, ln, s), r.k, r.dir, 'track', '', r.points ?? 3, r.samples ?? 0, r.distinct ?? 0, r.covered))));
const tStuff = (sys, ln, n) => `INSERT INTO bounty_seg_contrib (seg_key,actor,first_ok_at) VALUES ${SEGS9.flatMap(s => Array.from({ length: n }, (_, i) => `('${segKey(sys, ln, s)}','other-${String(i).padStart(3, '0')}',1)`)).join(',')};`;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
// 一趟乾淨軌跡：等速 20 m/s 跑 700 秒（1 Hz、acc 8 m）＝14 公里＝剛好蓋滿前 7 段（S0|S1 … S6|S7）
const tripPts = (durationSec = 700, speed = 20, t0 = 30000) => Array.from({ length: durationSec + 1 }, (_, i) => ({ d: i * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc: 8 }));
function addTrip(db, { actor, trainNo, lnId = '南迴線', sys = 'tra_sched', durationSec = 700 }) {
  chunk(tripPts(durationSec), 200).forEach((part, k) => db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
    " VALUES (?,?,?,?,?,0,?,?,NULL,?,'pending',?)").run(`${actor}.${trainNo}.${TRIP_DATE}.${k}`, actor, sys, lnId, trainNo, TRIP_DATE, JSON.stringify(part), NOW_MS - 3600e3 + k, JSON.stringify(APP)));
}
const boardOf = (db, key) => db.prepare('SELECT train_kind, dir, sample_count, covered_at, distinct_ok_users FROM bounty_board WHERE seg_key=? ORDER BY train_kind, dir').all(key).map(r => ({ ...r }));
const ROWS3 = [{ k: '自強', dir: 0, points: 3 }, { k: '區間', dir: 0, points: 1 }, { k: '自強', dir: 1, points: 3 }];
// T1 第 49 位不收、第 50 位（need 位）整段一起收（同段的別種車種、另一個方向都收）、第 51 位不改寫時間；這一趟沒經過的段不受影響
await attempt('T1', async () => {
  const TR = 'tra_sched', LN = '南迴線';
  const w = world({ seed: tBoard(TR, LN, ROWS3.map(r => ({ ...r, distinct: 48 })), SEGS9.slice(0, 8)) + tStuff(TR, LN, 48) +
    tBoard(TR, LN, [{ k: '自強', dir: 0, distinct: 60 }], ['S8|S9']) });                       // S8|S9：這一趟蓋不到，人數 60 ≥ 50 卻沒收滿（人為狀態）
  const traversed = ['S0|S1', 'S3|S4', 'S6|S7'];
  const read = () => Object.fromEntries([...traversed, 'S7|S8', 'S8|S9'].map(s => [s, boardOf(w.db, segKey(TR, LN, s))]));
  addTrip(w.db, { actor: 'device-t1n49aa', trainNo: '101' }); await w.cron();
  const at49 = read();
  ok('T1a 第 49 位到：蓋到的段（S0|S1、S3|S4、S6|S7）每一列（三列＝自強0／區間0／自強1）都是 49 位、covered_at 空——差 1 位不收',
    traversed.every(s => at49[s].length === 3 && at49[s].every(r => r.distinct_ok_users === 49 && r.covered_at === null)), JSON.stringify(at49['S0|S1']));
  addTrip(w.db, { actor: 'device-t1n50aa', trainNo: '102' }); await w.cron();
  const at50 = read();
  ok('T1b 第 50 位到：蓋到的段的「三列全部」covered_at＝這一刻——被計功的自強0 收滿，同段的區間0、另一個方向的自強1 也一起收',
    traversed.every(s => at50[s].length === 3 && at50[s].every(r => r.distinct_ok_users === 50 && r.covered_at === NOW_MS)), JSON.stringify(at50['S0|S1']));
  ok('T1c 沒經過的段不受影響：S7|S8（人數停在 48）與 S8|S9（人數 60、已達門檻卻沒被這一趟蓋到）covered_at 仍是空、人數不變',
    at50['S7|S8'].every(r => r.covered_at === null && r.distinct_ok_users === 48) && at50['S8|S9'].length === 1 && at50['S8|S9'][0].covered_at === null && at50['S8|S9'][0].distinct_ok_users === 60,
    JSON.stringify([at50['S7|S8'], at50['S8|S9']]));
  addTrip(w.db, { actor: 'device-t1n51aa', trainNo: '103' }); await w.cron(NOW_MS + 3600e3);
  const at51 = read();
  ok('T1d 第 51 位到（一小時後）：人數 51、covered_at 仍是第 50 位那一刻（COALESCE，不被改寫）；sample_count 逐列累加＝只有被計功的自強0 是 3、其餘 0',
    traversed.every(s => at51[s].every(r => r.distinct_ok_users === 51 && r.covered_at === NOW_MS)) &&
      at51['S0|S1'].find(r => r.train_kind === '自強' && r.dir === 0).sample_count === 3 && at51['S0|S1'].filter(r => !(r.train_kind === '自強' && r.dir === 0)).every(r => r.sample_count === 0), JSON.stringify(at51['S0|S1']));
});
// T2 高鐵用高鐵的門檻（15）：同樣「已有 14 位」，高鐵再來 1 位整段收滿（含別種車種、別的方向），台鐵不會
await attempt('T2', async () => {
  const w = world({ seed: tBoard('thsr_sched', 'THSR', [{ k: '標準', dir: 0, distinct: 14 }, { k: '南港', dir: 1, distinct: 14 }]) + tStuff('thsr_sched', 'THSR', 14) +
    tBoard('tra_sched', '南迴線', [{ k: '自強', dir: 0, distinct: 14 }, { k: '區間', dir: 1, distinct: 14 }]) + tStuff('tra_sched', '南迴線', 14) });
  addTrip(w.db, { actor: 'device-t2h15aa', trainNo: '801', sys: 'thsr_sched', lnId: 'THSR' });
  addTrip(w.db, { actor: 'device-t2t15aa', trainNo: '312', sys: 'tra_sched', lnId: '南迴線' });
  await w.cron();
  const hs = boardOf(w.db, segKey('thsr_sched', 'THSR', 'S0|S1')), tr = boardOf(w.db, segKey('tra_sched', '南迴線', 'S0|S1'));
  ok('T2a 高鐵第 15 位到：同段兩列（不同車種、不同方向）都收滿（人數 15、covered_at＝此刻）', hs.length === 2 && hs.every(r => r.distinct_ok_users === 15 && r.covered_at === NOW_MS), JSON.stringify(hs));
  ok('T2b [對照] 台鐵同樣第 15 位：兩列都不收（要 50）——拿高鐵的門檻判台鐵就會誤收滿', tr.length === 2 && tr.every(r => r.distinct_ok_users === 15 && r.covered_at === null), JSON.stringify(tr));
});
// T3 設定檔缺該家族的 coverDistinct 鍵 → 退回舊行為：門檻取 coverN、比趟數、只寫被計功的那一列（同段別的列不動）
await attempt('T3', async () => {
  const rules = { ...RULES, coverDistinct: { THSR: 15 } };                                     // 缺 TRA 的鍵
  const w = world({ rules, seed: tBoard('tra_sched', '南迴線', ROWS3, ['S0|S1']) });
  addTrip(w.db, { actor: 'device-t3aa0001', trainNo: '101' }); await w.cron();
  const rows = boardOf(w.db, segKey('tra_sched', '南迴線', 'S0|S1'));
  const zq = rows.find(r => r.train_kind === '自強' && r.dir === 0);
  ok('T3 缺台鐵的 coverDistinct 鍵 → 舊行為：coverN.TRA＝1，被計功的自強0 那一列收滿（covered_at＝此刻、sample_count 1）；同段區間0 與另一個方向 covered_at 仍空',
    rows.length === 3 && zq.covered_at === NOW_MS && zq.sample_count === 1 && rows.filter(r => r !== zq).every(r => r.covered_at === null && r.sample_count === 0) && rows.every(r => r.distinct_ok_users === 1), JSON.stringify(rows));
});

// T4 長趟（60 段）：登記與收滿寫入。每個 batch ≤ 80 句（專案自訂的上限）；同一段的「登記、收滿」一定在同一個 batch 且收滿排在登記之後——
// 收滿排在登記前面的話，這一位剛好補滿門檻的那一刻讀到的還是舊人數，整段要等下一位才收（差一位，沒有任何錯誤訊息）。
// 現在登記與收滿不再逐段各寫一句：段鍵包成一個 JSON 陣列走 json_each，整班車一個 batch、句數不隨段數成長
// （舊版一段三句、60 段 180 句要拆成 3 批）。
await attempt('T4', async () => {
  // 每公里一站＝60 段（里程單位是公里，軌跡的 d 才是公尺）。站名補零：區間鍵是字典序（'L10' 排在 'L9' 前面），不補零 L9|L10 會變成 L10|L9
  const nm = i => 'L' + String(i).padStart(2, '0');
  const stations = Array.from({ length: 61 }, (_, i) => ({ name: nm(i), d: i }));
  const units = { generatedAt: 1, schedDate: TRIP_DATE, units: [], lines: { 'tra_sched|山線': { sys: 'tra_sched', lnId: '山線', name: '山線', stations } } };
  const segs = Array.from({ length: 60 }, (_, i) => `${nm(i)}|${nm(i + 1)}`);
  const seed = bSeed(segs.map(sg => bRow(segKey('tra_sched', '山線', sg), '自強', 0, 'track', '', 3, 0, 0, null)));
  const w = world({ units, rules: { ...RULES, coverDistinct: { TRA: 1, THSR: 15 } }, seed });
  addTrip(w.db, { actor: 'device-t4aa0001', trainNo: '101', lnId: '山線', durationSec: 3000 });
  const sizes = [];                                          // 每個 batch 幾句、是不是登記那一批（bountyCounted 交給 batch 的是真正的 prepared statement，讀得到 _sql）
  const ob = w.env.DELAY_DB.batch;
  w.env.DELAY_DB.batch = async st => { sizes.push({ n: st.length, contrib: st.some(x => /INTO bounty_seg_contrib/.test(String(x && x._sql))) }); return ob(st); };
  await w.cron();
  const rows = w.db.prepare('SELECT seg_key, distinct_ok_users d, covered_at c FROM bounty_board').all();
  ok('T4a 60 公里的長趟：60 段全部登記（distinct 1）且全部收滿（門檻調成 1 位）——分批寫入沒有漏掉任何一段、也沒有差一位',
    rows.length === 60 && rows.every(r => r.d === 1 && r.c === NOW_MS) && w.db.prepare('SELECT COUNT(*) c FROM bounty_seg_contrib').get().c === 60,
    JSON.stringify({ n: rows.length, bad: rows.filter(r => !(r.d === 1 && r.c === NOW_MS)).slice(0, 3) }));
  const cb = sizes.filter(x => x.contrib);
  ok('T4b 每個 batch 至多 80 句；60 段的登記＋收滿是一個 batch、3 句（人數＋1、登記、台鐵家族收滿一句），不隨段數成長',
    w.maxBatch <= 80 && cb.length === 1 && cb[0].n === 3, `maxBatch=${w.maxBatch} batches=${JSON.stringify(sizes)}`);
});

// ═══ P 組：通行證對照組══════════════════════════════════════════
// 同一套操作跑兩個世界：一個乾淨、一個「處處都有通行證資料」——請求帶各種通行證旗標與標頭、假 D1 裡有通行證資格表、
// 環境變數配了 RevenueCat／Firebase。兩邊的回應必須逐欄相同；整段過程零外連、零通行證相關 SQL、回應裡沒有通行證字樣。
await attempt('P1', async () => {
  const A = 'device-p1aa0001';
  outbound.length = 0;
  const run = async plus => {
    const w = world({ env: plus ? { REVENUECAT_API_KEY: 'rc_secret', REVENUECAT_ENTITLEMENT: 'plus', FIREBASE_WEB_API_KEY: 'k', FIREBASE_PROJECT_ID: 'p', PLUS_ADMIN_TOKEN: 't' } : {} });
    if (plus) {
      w.db.exec('CREATE TABLE plus_entitlements (actor TEXT PRIMARY KEY, active INTEGER, until INTEGER); ' +
        `INSERT INTO plus_entitlements VALUES ('${A}', 1, 9999999999999); ` +
        'CREATE TABLE pass_claims (actor TEXT PRIMARY KEY, code TEXT); ' + `INSERT INTO pass_claims VALUES ('${A}', 'GIFT-2026');`);
    }
    give(w.db, A, { balance: 13 });
    const flags = plus ? { plus: true, plusActive: true, plus_active: true, isPlus: true, entitlements: { plus: true }, pass: 'islander', client: { plus: true } } : {};
    const hdr = plus ? { 'X-Rail-Plus-Sandbox-Build': '22', 'X-Plus': '1' } : {};
    const qs = plus ? '&plus=1&plusActive=true' : '';
    const seqs = [
      await me(w, `?actor=${A}${qs}`, hdr),
      await redeem(w, body(A, 'south-coast', 'req-p1-00001', flags), hdr),
      await me(w, `?actor=${A}${qs}`, hdr),
      await redeem(w, body(A, 'shifen', 'req-p1-00002', flags), hdr),
      await redeem(w, body(A, 'viaduct', 'req-p1-00003', flags), hdr),
      await redeem(w, body(A, 'south-coast', 'req-p1-00001', flags), hdr),
    ];
    return { w, out: seqs.map(r => `${r.status} ${canon(r.json)}`) };
  };
  const clean = await run(false), loaded = await run(true);
  ok('P1a 乾淨世界與「處處有通行證」的世界：六次操作（餘額、兌換、餘額、第 2 座、餘額不足、重送）的狀態碼與本文逐欄相同', canon(clean.out) === canon(loaded.out), JSON.stringify({ clean: clean.out, loaded: loaded.out }));
  // 對照組本身要有牙：乾淨世界的六次結果是寫死的預期（不是「兩邊一樣就好」——兩邊一起錯也會一樣）
  const exp0 = { balance: 13, unlocked: [], nextCost: 4, cloud: { rides: 0, toNextChip: 3 }, today: { chips: 0, cap: 4 } };
  const exp1 = { ok: true, scene: 'south-coast', nth: 1, cost: 4, balance: 9, unlocked: [{ scene: 'south-coast', nth: 1, at: NOW_MS }] };
  const exp2 = { balance: 9, unlocked: [{ scene: 'south-coast', nth: 1, at: NOW_MS }], nextCost: 8, cloud: { rides: 0, toNextChip: 3 }, today: { chips: 0, cap: 4 } };
  const exp3 = { ok: true, scene: 'shifen', nth: 2, cost: 8, balance: 1, unlocked: [{ scene: 'south-coast', nth: 1, at: NOW_MS }, { scene: 'shifen', nth: 2, at: NOW_MS }] };
  const exp4 = { error: 'not_enough', cost: 8, balance: 1 };
  ok('P1b 乾淨世界的六次結果對得上寫死的預期（13 → 兌換第 1 座 4 → 9 → 第 2 座 8 → 1 → 第 3 座餘額不足 → 重送第 1 座回同一份）',
    canon(clean.out.map(s => s.replace(/^\d+ /, '')).map(parse)) === canon([exp0, exp1, exp2, exp3, exp4, { ...exp1, balance: 1, unlocked: exp3.unlocked }]) &&
      canon(clean.out.map(s => s.slice(0, 3))) === canon(['200', '200', '200', '200', '409', '200']), canon(clean.out));
  ok('P1c 整段過程零外連（沒有去查 RevenueCat／Firebase／任何服務；兩個世界合計）', outbound.length === 0, JSON.stringify(outbound));
  ok('P1d 兩個世界都沒有任何一句 SQL 提到 plus／entitle／pass_claims（通行證資料表就在庫裡，但兩支端點連碰都沒碰）',
    !clean.w.sql.concat(loaded.w.sql).some(s => /plus|entitle|pass_claims|通行證/i.test(s)), JSON.stringify(loaded.w.sql.filter(s => /plus|entitle|pass_claims/i.test(s))));
  const still = loaded.w.db.prepare('SELECT COUNT(*) c FROM plus_entitlements').get().c;
  ok('P1e 對照：通行證資料確實在庫裡（1 列、沒被動過），上面的相同不是因為資料根本沒放進去', still === 1);
});
// 原始碼掃描：這一區（去掉註解後）不出現 plus／entitlement／revenuecat／pass 相關識別字
await attempt('P2', async () => {
  const src = readFileSync('worker.js', 'utf8');
  const a = src.indexOf('async function bountyChipsRules'), b = src.indexOf('// ── 估值:兩層乘數');
  const code = src.slice(a, b).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  ok('P2 chipsMe／garageRedeem 區塊（去掉註解）不含 plus／entitle／revenuecat／checkPlus 字樣，且區塊真的抓到了（長度 > 4000 字）',
    a > 0 && b > a && code.length > 4000 && !/plus|entitle|revenuecat|checkPlus|通行證/i.test(code), `len=${code.length}`);
});

// ═══ Z：全局掃描 ══════════════════════════════════════════════════════════
await attempt('Z1', async () => {
  const bad = ALL.filter(t => /plus|通行證/i.test(t));
  ok(`Z1 本檔所有回應本文（${ALL.length} 個，含成功與各種錯誤）都沒有 plus／通行證字樣`, ALL.length > 100 && bad.length === 0, JSON.stringify(bad.slice(0, 2)));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
