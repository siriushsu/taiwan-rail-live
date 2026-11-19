// 搭乘集章驗收（2026-11-19 定案，規格 native 主樹 build/ride-stamps-1119/搭乘集章-提案.html；契約 docs/bounty/contract-v3.md 3.0.1 節）：
// 判定合格的每一趟記一列 ride_log（schema/0027）→ chips-me 照規則檔 chips.stamps 換算成章 → 一組蓋滿從開賣中的車款自選一款（POST /api/stamp-claim，不扣點數）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS（規則檔、單位清單、迷你台鐵班表）＋ BOUNTY_NOW 釘死；不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_stamps.mjs
//
// 期望值全部寫死在這裡，不呼叫實作去產生期望（純函式只在 P 組驗它自己）：
//   ・章對照照正式規則檔 chips.stamps（6 款台鐵車種＋區間車通用章＋高鐵 700T；專車不蓋）。
//   ・700 秒 @20 m/s 的一段（leg）：山線 13 點（同 verify_bounty_plus.mjs 檔頭）；300 秒不到 minTripSec 600 → 0 點、不算合格。
//   ・測試用的價目表寫在這裡（ITEMS），不讀正式規則檔的 chips.items（上線開關，哪幾款開賣會變）。
// 分組：P 純函式與規則檔　W 判定寫搭乘紀錄　M 錢包的 stamps 欄　C 領車　G 合併與刪帳號　B 回補
import { readFileSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';
import { stampOfRide, stampsView, canClaimSet, stampsOn } from './bounty_chips_core.mjs';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const outbound = [];
let firebaseUid = null;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes('identitytoolkit.googleapis.com'))
    return firebaseUid ? new Response(JSON.stringify({ users: [{ localId: firebaseUid }] }), { status: 200 }) : new Response('{}', { status: 400 });
  outbound.push(url);
  throw new Error('offline: ' + url);
};

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const same = (a, b) => canon(a) === canon(b);

const RULES0 = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const ITEMS = { 'train:dr3000': 150, 'train:ct250': 150 };
const RULES = { ...RULES0, chips: { ...RULES0.chips, items: ITEMS, plusBonusPct: 0 } };          // 加成關掉：判定不打 RevenueCat
const RULES_OFF = { ...RULES, chips: Object.fromEntries(Object.entries(RULES.chips).filter(([k]) => k !== 'stamps')) };
const CHIPS = RULES.chips;

// ── 固定的世界（同 verify_bounty_plus.mjs）────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T02:00:00Z');          // 台北 2026-07-29 10:00
const D28 = '2026-07-28';
const APP = { platform: 'ios', app: '2.0.4', simulator: false };
const limiter = { limit: async () => ({ success: true }) };
const mkLine = (sys, lnId) => ({ sys, lnId, name: lnId, stations: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, d: i * 2 })) });
const UNITS = { generatedAt: 1, schedDate: D28, units: [], lines: { 'tra_sched|山線': mkLine('tra_sched', '山線') } };
// 迷你台鐵班表（形狀同 data/tra_schedule.json：dates[日期]＝trains 的索引；trains[i].train／carName）。
// P1 那天是 EMU3000；Q2 只在另一天有（退回同車次任一天）；P2 那天是區間車；X9 不在班表。
const SCHED = { dates: { [D28]: [0, 2], '2026-07-30': [1] }, trains: [
  { train: 'P1', carName: '自強(3000障)' }, { train: 'Q2', carName: '自強(普,障)' }, { train: 'P2', carName: '區間車' }] };

function leg({ sec, speed = 20, t0 = 30000, d0 = 0 }) {
  const pts = [];
  for (let i = 0; i <= sec; i++) pts.push({ d: d0 + i * speed, t: t0 + i, v: speed + Math.sin(i / 7) * 0.6, acc: 8 });
  return pts;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function world(over = {}) {
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const rules = over.rules || RULES;
  const fetched = [];
  const ASSETS = { fetch: async r => {
    const u = String((r && r.url) || r);
    fetched.push(u.replace(/^.*\/data\//, ''));
    if (u.includes('bounty_units')) return new Response(J(UNITS), { status: 200 });
    if (u.includes('tra_schedule.json')) return over.noSched ? new Response('x', { status: 500 }) : new Response(J(SCHED), { status: 200 });
    return new Response(J(rules), { status: 200 });
  } };
  const env = { DELAY_DB, ASSETS, BOUNTY_LIMITER: limiter, AUTH_LIMITER: limiter, FIREBASE_WEB_API_KEY: 'k', BOUNTY_NOW: String(NOW_MS), ...(over.env || {}) };
  const call = async (fn, path, init, envOver) => {
    _bounty.bountyResetMemCaches();
    const res = await fn(new Request('https://railisland.tw' + path, init), { ...env, ...(envOver || {}) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { json = null; }
    return { status: res.status, text, json };
  };
  return {
    db, env, fetched,
    cron: async () => { _bounty.bountyResetMemCaches(); return _bounty.bountyVerifyCron(env); },
    me: (actor, envOver) => call(_bounty.chipsMe, '/api/chips-me?actor=' + actor, { headers: { 'cf-connecting-ip': '203.0.113.9' } }, envOver),
    claim: (body, hdr = {}, envOver) => call(_bounty.stampClaim, '/api/stamp-claim', { method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr }, body: J(body) }, envOver),
    collect: body => call(_bounty.garageCollect, '/api/garage-collect', { method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: J(body) }),
    merge: (dev, uid) => { firebaseUid = uid; return call(_bounty.bountyMerge, '/api/bounty-merge', { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer t', 'cf-connecting-ip': '203.0.113.9' }, body: J({ actor: dev }) }); },
  };
}
function putTrain(db, { actor, trainNo, sec = 700, simulator = false }) {
  chunk(leg({ sec }), 200).forEach((part, k) => {
    db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client)" +
      " VALUES (?,?,?,?,?,0,?,?,NULL,?,'pending',?)")
      .run(`${actor}.${trainNo}.${D28}.山線.${k}`, actor, 'tra_sched', '山線', trainNo, D28, J(part), NOW_MS - 3600e3 + k, J({ ...APP, simulator }));
  });
}
const rideSql = (actor, rows) => rows.map(([d, n, sys, car]) =>
  `INSERT INTO ride_log (actor,trip_date,train_no,sys,car,created_at) VALUES ('${actor}','${d}','${n}','${sys}','${car}',1);`).join('');
const TC4 = [['2026-07-01', '101', 'tra_sched', '自強(3000障)'], ['2026-07-02', '102', 'tra_sched', '自強(普,障)'],
  ['2026-07-03', '103', 'tra_sched', '自強(PP障)'], ['2026-07-04', '104', 'tra_sched', '自強(太,障)']];
const accountSql = uid => `INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('${uid}','${uid}',0,NULL,1);`;
const q = {
  rides: (db, a) => db.prepare('SELECT trip_date, train_no, sys, car FROM ride_log WHERE actor=? ORDER BY trip_date, train_no').all(a).map(r => ({ ...r })),
  nRides: db => db.prepare('SELECT COUNT(*) c FROM ride_log').get().c,
  trips: (db, a) => db.prepare("SELECT delta FROM chip_ledger WHERE actor=? AND kind='trip'").all(a).map(r => r.delta),
  items: (db, a) => db.prepare('SELECT item, cost FROM garage_items WHERE actor=? ORDER BY item').all(a).map(r => ({ ...r })),
  redeems: (db, a) => db.prepare("SELECT id, delta FROM chip_ledger WHERE actor=? AND kind='redeem' ORDER BY id").all(a).map(r => ({ ...r })),
  nLedger: db => db.prepare('SELECT COUNT(*) c FROM chip_ledger').get().c,
};

// ═══ P：純函式與規則檔════════════════════════════════════════════════════════
await attempt('P1', async () => {
  const cases = [['自強(3000障)', 'emu3000'], ['自強(3000親障)', 'emu3000'], ['110K', 'emu3000'], ['自強(普,障)', 'temu2000'], ['自強(PP障12)', 'e1000'],
    ['自強(PP親)', 'e1000'], ['自強(太,障)', 'temu1000'], ['自強(D31)', 'dr3100'], ['莒光', 'juguang'], ['莒光(專)', 'juguang'], ['區間車', 'local'],
    ['區間快', 'local'], ['電車(專)', null], ['普通車(專)', null], ['自強(商專)', null], ['自強(專)', null], ['兩鐵(專)', null], ['', null], ['-', null]];
  const bad = cases.filter(([car, want]) => stampOfRide('tra_sched', car, CHIPS) !== want).map(([car, want]) => [car, want, stampOfRide('tra_sched', car, CHIPS)]);
  ok('P1a 台鐵車種名→章（正式規則檔）：EMU3000（3000、3000親、110K）、普悠瑪、推拉（PP 各型）、太魯閣、DR3100、莒光（含莒光專車）、區間車與區間快→通用章；' +
    '電車專車、普通車專車、商務專車、自強專車、兩鐵、空字串、「-」都不蓋', bad.length === 0, J(bad));
  ok('P1b 高鐵不看車種名一律 700T；同一個車種名換成高鐵以外的系統不蓋（林鐵、捷運）',
    stampOfRide('thsr_sched', '', CHIPS) === '700t' && stampOfRide('thsr_sched', '高鐵', CHIPS) === '700t' &&
      stampOfRide('afr_sched', '自強(3000障)', CHIPS) === null && stampOfRide('mrt', '', CHIPS) === null);
  ok('P1c 規則檔拿掉 stamps＝關著：stampsOn false、任何一趟都不蓋', !stampsOn(RULES_OFF.chips) && stampOfRide('thsr_sched', '', RULES_OFF.chips) === null && stampsOn(CHIPS));
  const broken = { stamps: { cars: [{ id: 'x', sys: 'tra_sched', match: '(' }, { id: 'y', sys: 'tra_sched', match: '自強' }], sets: [] } };
  ok('P1d match 寫壞（不是合法正規式）的那一條當成沒列，下一條照比', stampOfRide('tra_sched', '自強(3000障)', broken) === 'y');
});
await attempt('P2', async () => {
  // 現行台鐵班表每一個車種名，不是蓋得到章、就是專車（名稱含「專」）：班表出現新的車種寫法（例如新車型）時這條會紅，提醒補對照。
  const S = JSON.parse(readFileSync('data/tra_schedule.json', 'utf8'));
  const names = [...new Set(S.trains.map(t => t.carName))];
  const loose = names.filter(n => !stampOfRide('tra_sched', n, CHIPS) && !/專/.test(n));
  ok(`P2 現行 data/tra_schedule.json 的 ${names.length} 種車種名：都蓋得到章，或是專車（含「專」）——沒有漏網的新寫法`, names.length > 5 && loose.length === 0, J(loose));
});
await attempt('P3', async () => {
  const rides = [{ trip_date: '2026-07-05', train_no: '9', sys: 'thsr_sched', car: '' }, { trip_date: '2026-07-01', train_no: '3', sys: 'tra_sched', car: '區間車' },
    { trip_date: '2026-07-02', train_no: '7', sys: 'tra_sched', car: '自強(普,障)' }, { trip_date: '2026-07-03', train_no: '8', sys: 'tra_sched', car: '區間快' },
    { trip_date: '2026-07-04', train_no: '1', sys: 'tra_sched', car: '自強(專)' }];
  ok('P3 stampsView：照規則檔 cars 的順序（普悠瑪、區間車、700T），次數照算（區間車＋區間快＝2），first 是傳進來順序的第一趟，專車不列',
    same(stampsView(rides, CHIPS), [{ id: 'temu2000', n: 1, first: { day: '2026-07-02', train: '7' } }, { id: 'local', n: 2, first: { day: '2026-07-01', train: '3' } },
      { id: '700t', n: 1, first: { day: '2026-07-05', train: '9' } }]), J(stampsView(rides, CHIPS)));
});
await attempt('P4', async () => {
  const full = ['emu3000', 'temu2000', 'e1000', 'temu1000'].map(id => ({ id }));
  const c = (set, item, view, claimed = [], owned = []) => canClaimSet(set, item, view, claimed, owned, CHIPS);
  ok('P4 canClaimSet：沒有這組 unknown_set；日常通勤只蓋章 no_reward；差一款 incomplete；領過 claimed；不是開賣中 unknown_item；已經有 already；都對才 ok',
    same(c('nope', 'train:dr3000', full), { ok: false, why: 'unknown_set' }) &&
      same(c('daily', 'train:dr3000', [{ id: 'local' }, { id: '700t' }, { id: 'juguang' }, { id: 'dr3100' }]), { ok: false, why: 'no_reward' }) &&
      same(c('tc4', 'train:dr3000', full.slice(0, 3)), { ok: false, why: 'incomplete' }) &&
      same(c('tc4', 'train:dr3000', full, ['tc4']), { ok: false, why: 'claimed' }) &&
      same(c('tc4', 'train:emu300', full), { ok: false, why: 'unknown_item' }) &&
      same(c('tc4', 'train:dr3000', full, [], ['train:dr3000']), { ok: false, why: 'already' }) &&
      same(c('tc4', 'train:dr3000', full), { ok: true }));
});

// ═══ W：判定寫搭乘紀錄════════════════════════════════════════════════════════
await attempt('W1', async () => {
  const w = world({ seed: accountSql('uid-w1acct0001') });
  putTrain(w.db, { actor: 'uid-w1acct0001', trainNo: 'P1' });
  await w.cron();
  ok('W1a 合格的一班（山線 700 秒、入帳 13 點）→ ride_log 一列：乘車日、車次 P1、tra_sched、car 空字串（判定這一端不讀班表）',
    J(q.trips(w.db, 'uid-w1acct0001')) === '[13]' && same(q.rides(w.db, 'uid-w1acct0001'), [{ trip_date: D28, train_no: 'P1', sys: 'tra_sched', car: '' }]), J(q.rides(w.db, 'uid-w1acct0001')));
  ok('W1b 判定這一發沒有讀台鐵班表（tra_schedule.json 一次都沒抓）', !w.fetched.includes('tra_schedule.json'), J(w.fetched));
  await w.cron();
  ok('W1c 再跑一發（沒有待判的）：仍是一列', q.nRides(w.db) === 1);
});
await attempt('W2', async () => {
  const w = world({ seed: accountSql('uid-w2acct0001') });
  putTrain(w.db, { actor: 'uid-w2acct0001', trainNo: 'P1', sec: 300 });
  await w.cron();
  ok('W2 [對照 W1] 不到 minTripSec 的一班（300 秒、0 點）→ 沒有搭乘紀錄', q.trips(w.db, 'uid-w2acct0001').length === 0 && q.nRides(w.db) === 0, J(q.rides(w.db, 'uid-w2acct0001')));
});
await attempt('W3', async () => {
  const w = world({ seed: accountSql('uid-w3acct0001') +
    `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES ('trip|uid-w3|${D28}|Z0','uid-w3acct0001','trip',500,'uid-w3|${D28}|Z0','${D28}',1,'point');` });
  putTrain(w.db, { actor: 'uid-w3acct0001', trainNo: 'P1' });
  await w.cron();
  ok('W3 當天已經領滿 500 點：這一班入帳 0 點（帳本沒多），搭乘紀錄照寫一列（合格就蓋章，不看上限）',
    J(q.trips(w.db, 'uid-w3acct0001')) === '[500]' && q.rides(w.db, 'uid-w3acct0001').length === 1, J({ t: q.trips(w.db, 'uid-w3acct0001'), r: q.rides(w.db, 'uid-w3acct0001') }));
});
await attempt('W4', async () => {
  const w = world({ seed: accountSql('uid-w4acct0001') });
  putTrain(w.db, { actor: 'uid-w4acct0001', trainNo: 'P1', simulator: true });
  await w.cron();
  ok('W4 模擬器的一班（不入帳）→ 沒有搭乘紀錄', q.trips(w.db, 'uid-w4acct0001').length === 0 && q.nRides(w.db) === 0);
});
await attempt('W5', async () => {
  const w = world({ seed: accountSql('uid-w5acct0001') + "INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('dev-w5-000001',NULL,0,'uid-w5acct0001',1);" });
  putTrain(w.db, { actor: 'dev-w5-000001', trainNo: 'P1' });
  await w.cron();
  ok('W5 樣本掛在已併進帳號的裝置下：搭乘紀錄記在帳號名下（跟錄程點數同一個身分）',
    q.rides(w.db, 'uid-w5acct0001').length === 1 && q.rides(w.db, 'dev-w5-000001').length === 0 && J(q.trips(w.db, 'uid-w5acct0001')) === '[13]');
});
await attempt('W6', async () => {
  const w = world({ seed: accountSql('uid-w6acct0001') });
  w.db.exec('DROP TABLE ride_log');
  putTrain(w.db, { actor: 'uid-w6acct0001', trainNo: 'P1' });
  const st = await w.cron();
  ok('W6 正式庫還沒套 0027（沒有 ride_log）：點數照常入帳 13、這班判完（不留 pending），判定不丟例外',
    J(q.trips(w.db, 'uid-w6acct0001')) === '[13]' && st.ok === 1 && w.db.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE verdict='pending'").get().c === 0, J(st));
});

// ═══ M：錢包的 stamps 欄════════════════════════════════════════════════════════
await attempt('M1', async () => {
  const A = 'dev-m1-000001';
  const w = world({ seed: rideSql(A, [[D28, 'P1', 'tra_sched', ''], ['2026-07-27', 'Q2', 'tra_sched', ''], [D28, 'X9', 'tra_sched', ''], ['2026-07-26', '0152', 'thsr_sched', '']]) });
  const r = await w.me(A);
  ok('M1a chips-me 的 stamps：EMU3000（P1 那天）、普悠瑪（Q2 那天不在班表，退回同車次另一天）、700T（高鐵）；X9 不在班表不蓋；claimed []',
    r.status === 200 && same(r.json.stamps, { cars: [{ id: 'emu3000', n: 1, first: { day: D28, train: 'P1' } }, { id: 'temu2000', n: 1, first: { day: '2026-07-27', train: 'Q2' } },
      { id: '700t', n: 1, first: { day: '2026-07-26', train: '0152' } }], claimed: [] }), r.text);
  ok('M1b 台鐵的車種名寫回 ride_log（P1→自強(3000障)、Q2→自強(普,障)、查不到的 X9→「-」）；高鐵那列不動（空字串）',
    same(q.rides(w.db, A), [{ trip_date: '2026-07-26', train_no: '0152', sys: 'thsr_sched', car: '' }, { trip_date: '2026-07-27', train_no: 'Q2', sys: 'tra_sched', car: '自強(普,障)' },
      { trip_date: D28, train_no: 'P1', sys: 'tra_sched', car: '自強(3000障)' }, { trip_date: D28, train_no: 'X9', sys: 'tra_sched', car: '-' }]), J(q.rides(w.db, A)));
  const n0 = w.fetched.filter(f => f === 'tra_schedule.json').length;
  const r2 = await w.me(A);
  ok('M1c 再讀一次：stamps 一樣，而且不再抓台鐵班表（每一列都補過了）',
    r2.status === 200 && same(r2.json.stamps, r.json.stamps) && n0 === 1 && w.fetched.filter(f => f === 'tra_schedule.json').length === 1, J(w.fetched));
});
await attempt('M2', async () => {
  const A = 'dev-m2-000001';
  const w = world({ seed: rideSql(A, [[D28, 'P1', 'tra_sched', '']]), env: { BOUNTY_WRITES: 'off' } });
  const r = await w.me(A);
  ok('M2 寫入總閘關著：這一次照樣蓋得到 EMU3000，但 ride_log 不寫回（car 仍是空字串）',
    r.status === 200 && J(r.json.stamps.cars.map(s => s.id)) === '["emu3000"]' && q.rides(w.db, A)[0].car === '', r.text);
});
await attempt('M3', async () => {
  const A = 'dev-m3-000001';
  const w = world({ seed: rideSql(A, [[D28, 'P1', 'tra_sched', ''], ['2026-07-02', '7', 'thsr_sched', '']]), noSched: true });
  const r = await w.me(A);
  ok('M3 台鐵班表讀不到：錢包照回 200，高鐵的章照蓋，台鐵那一趟這一次蓋不到、car 留空字串（下次再補）',
    r.status === 200 && J(r.json.stamps.cars.map(s => s.id)) === '["700t"]' && q.rides(w.db, A).find(x => x.train_no === 'P1').car === '', r.text);
});
await attempt('M4', async () => {
  const A = 'dev-m4-000001';
  const w = world({ rules: RULES_OFF, seed: rideSql(A, TC4) });
  const r = await w.me(A);
  ok('M4 規則檔沒有 stamps（關著）：錢包回應沒有 stamps 這個欄位', r.status === 200 && !('stamps' in r.json) && 'items' in r.json, r.text);
});
await attempt('M5', async () => {
  const A = 'dev-m5-000001';
  const w = world({ seed: rideSql(A, [['2026-07-09', '1', 'tra_sched', '區間車'], ['2026-07-01', '2', 'tra_sched', '區間快'], ['2026-07-05', '3', 'tra_sched', '自強(太,障)']]) });
  const r = await w.me(A);
  ok('M5 次數與第一趟：區間車 2 次、第一趟是乘車日最早的 07-01；順序照規則檔（太魯閣在區間車之前）',
    same(r.json.stamps.cars, [{ id: 'temu1000', n: 1, first: { day: '2026-07-05', train: '3' } }, { id: 'local', n: 2, first: { day: '2026-07-01', train: '2' } }]), r.text);
});

// ═══ C：領車══════════════════════════════════════════════════════════════════
const body = (actor, item, requestId, set = 'tc4') => ({ actor, set, item, requestId });
await attempt('C1', async () => {
  const A = 'dev-c1-000001';
  const w = world({ seed: rideSql(A, TC4) + `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES ('s1','${A}','adjust',40,'s1',NULL,1,'point');` });
  const r = await w.claim(body(A, 'train:dr3000', 'req-c1-000001'));
  ok('C1a 自強四款蓋滿，領 dr3000 → 200：items 有 dr3000、stamps.claimed ["tc4"]',
    r.status === 200 && r.json.ok === true && r.json.set === 'tc4' && r.json.item === 'train:dr3000' && r.json.items.some(x => x.item === 'train:dr3000') &&
      same(r.json.stamps.claimed, ['tc4']), r.text);
  ok('C1b 寫進去的兩列：garage_items cost 0；帳本一列 kind redeem、delta 0、id stampset|tc4|train:dr3000|<actor>.<requestId>；餘額 40 沒動',
    same(q.items(w.db, A), [{ item: 'train:dr3000', cost: 0 }]) && same(q.redeems(w.db, A), [{ id: `stampset|tc4|train:dr3000|${A}.req-c1-000001`, delta: 0 }]) &&
      w.db.prepare('SELECT SUM(delta) n FROM chip_ledger WHERE actor=?').get(A).n === 40, J({ i: q.items(w.db, A), r: q.redeems(w.db, A) }));
  const again = await w.claim(body(A, 'train:dr3000', 'req-c1-000001'));
  ok('C1c 同一個 requestId 重送 → 200、跟第一次同一款，沒有多寫', again.status === 200 && again.json.item === 'train:dr3000' && q.nLedger(w.db) === 2, again.text);
  const other = await w.claim(body(A, 'train:ct250', 'req-c1-000002'));
  ok('C1d 同一組換一款、新的 requestId → 409 claimed，一列都沒多', other.status === 409 && other.json.error === 'claimed' && q.nLedger(w.db) === 2 && q.items(w.db, A).length === 1, other.text);
  const m = await w.me(A);
  ok('C1e 錢包：stamps.claimed ["tc4"]、items 有 dr3000', same(m.json.stamps.claimed, ['tc4']) && m.json.items.some(x => x.item === 'train:dr3000'), m.text);
});
await attempt('C2', async () => {
  const A = 'dev-c2-000001';
  const w = world({ seed: rideSql(A, TC4.slice(0, 3)) });
  const r = await w.claim(body(A, 'train:dr3000', 'req-c2-000001'));
  ok('C2 [對照 C1] 只蓋了三款 → 409 incomplete，一列都沒寫', r.status === 409 && r.json.error === 'incomplete' && q.nLedger(w.db) === 0 && q.items(w.db, A).length === 0, r.text);
});
await attempt('C3', async () => {
  const A = 'dev-c3-000001';
  const w = world({ seed: rideSql(A, [...TC4, ['2026-07-05', '1', 'tra_sched', '區間車'], ['2026-07-06', '2', 'thsr_sched', ''], ['2026-07-07', '3', 'tra_sched', '莒光'], ['2026-07-08', '4', 'tra_sched', '自強(D31)']]) });
  const rs = [await w.claim(body(A, 'train:dr3000', 'req-c3-000001', 'daily')), await w.claim(body(A, 'train:dr3000', 'req-c3-000002', 'nope')),
    await w.claim(body(A, 'train:emu300', 'req-c3-000003')), await w.claim(body(A, 'train:dr3000', 'req-c3-000004', 'TC4')), await w.claim({ actor: A, set: 'tc4', requestId: 'req-c3-000005' })];
  ok('C3 日常通勤蓋滿也只蓋章 → 400 no_reward；沒有這組、組名大寫 → 400 unknown_set；不是開賣中的車、沒帶 item → 400 unknown_item；全部一列都沒寫',
    J(rs.map(r => `${r.status} ${r.json && r.json.error}`)) === J(['400 no_reward', '400 unknown_set', '400 unknown_item', '400 unknown_set', '400 unknown_item']) && q.nLedger(w.db) === 0,
    J(rs.map(r => r.text)));
});
await attempt('C4', async () => {
  const A = 'dev-c4-000001';
  const w = world({ seed: rideSql(A, TC4) + `INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES ('s4','${A}','adjust',300,'s4',NULL,1,'point');` });
  const c = await w.collect({ actor: A, item: 'train:dr3000', requestId: 'req-c4-000001' });
  const r = await w.claim(body(A, 'train:dr3000', 'req-c4-000002'));
  ok('C4a 已經用點數換到 dr3000 → 領 dr3000 是 409 already（換一款）', c.status === 200 && r.status === 409 && r.json.error === 'already', r.text);
  const reuse = await w.claim(body(A, 'train:ct250', 'req-c4-000001'));
  ok('C4b 拿換車用過的 requestId 來領 → 409 conflict，沒有白送', reuse.status === 409 && reuse.json.error === 'conflict' && q.items(w.db, A).length === 1, reuse.text);
  const ok2 = await w.claim(body(A, 'train:ct250', 'req-c4-000003'));
  ok('C4c [對照] 換成還沒有的 ct250、新的 requestId → 200', ok2.status === 200 && same(q.items(w.db, A).map(x => x.item), ['train:ct250', 'train:dr3000']), ok2.text);
});
await attempt('C5', async () => {
  const A = 'dev-c5-000001';
  const w = world({ seed: rideSql(A, TC4) });
  const rs = await Promise.all([w.claim(body(A, 'train:dr3000', 'req-c5-000001')), w.claim(body(A, 'train:ct250', 'req-c5-000002'))]);
  ok('C5 同一組兩款同時送：恰好一個 200、另一個 409，garage_items 只多一款、帳本只多一列',
    J(rs.map(r => r.status).sort()) === '[200,409]' && q.items(w.db, A).length === 1 && q.redeems(w.db, A).length === 1, J(rs.map(r => r.text)));
});
await attempt('C6', async () => {
  const A = 'dev-c6-000001';
  const off = world({ seed: rideSql(A, TC4), env: { BOUNTY_WRITES: 'off' } });
  const r = await off.claim(body(A, 'train:dr3000', 'req-c6-000001'));
  ok('C6a 寫入總閘關著 → 503 bounty_paused，一列都沒寫', r.status === 503 && r.json.error === 'bounty_paused' && q.nLedger(off.db) === 0, r.text);
  const w = world({ seed: accountSql('uid-c6acct0001') + rideSql('uid-c6acct0001', TC4) });
  firebaseUid = null;
  const noTok = await w.claim(body('uid-c6acct0001', 'train:dr3000', 'req-c6-000002'));
  ok('C6b 帳號不帶 Bearer → 401 auth_required（錢包身分規則，同換車）', noTok.status === 401 && noTok.json.error === 'auth_required' && q.nLedger(w.db) === 0, noTok.text);
  firebaseUid = 'uid-c6acct0001';
  const tok = await w.claim(body('uid-c6acct0001', 'train:dr3000', 'req-c6-000003'), { Authorization: 'Bearer t' });
  ok('C6c [對照] 帶這個帳號的 Bearer → 200', tok.status === 200, tok.text);
  const bad = await w.claim({ actor: 'uid-c6acct0001', set: 'tc4', item: 'train:ct250', requestId: 'x y' }, { Authorization: 'Bearer t' });
  ok('C6d requestId 格式不對 → 400 bad_request_id，一列都沒多', bad.status === 400 && bad.json.error === 'bad_request_id' && q.redeems(w.db, 'uid-c6acct0001').length === 1, bad.text);
});

// ═══ G：合併與刪帳號════════════════════════════════════════════════════════════
await attempt('G1', async () => {
  const DEV = 'dev-g1-000001', UID = 'uid-g1acct0001';
  const w = world({ seed: rideSql(DEV, [TC4[0], TC4[1], ['2026-07-09', '9', 'thsr_sched', '']]) + rideSql(UID, [TC4[1], TC4[2], TC4[3]]) });
  const c = await w.claim(body(DEV, 'train:dr3000', 'req-g1-000001'));
  const mr = await w.merge(DEV, UID);
  ok('G1a 裝置（三趟、其中 07-02 那趟帳號也有）併進帳號：帳號 5 趟（同一趟只留一列）、裝置 0 列',
    mr.status === 200 && q.rides(w.db, UID).length === 5 && q.rides(w.db, DEV).length === 0, J({ mr: mr.text, u: q.rides(w.db, UID) }));
  firebaseUid = UID;
  const m = await w.claim(body(UID, 'train:ct250', 'req-g1-000002'), { Authorization: 'Bearer t' });
  ok('G1b 合併前裝置沒蓋滿（C 不成立，領不到）；合併後帳號蓋滿自強四款、可以領 → 200，claimed ["tc4"]',
    c.status === 409 && c.json.error === 'incomplete' && m.status === 200 && same(m.json.stamps.claimed, ['tc4']) &&
      J(m.json.stamps.cars.map(s => s.id)) === J(['emu3000', 'temu2000', 'e1000', 'temu1000', '700t']), J({ c: c.text, m: m.text }));
});
await attempt('G2', async () => {
  const DEV = 'dev-g2-000001', UID = 'uid-g2acct0001';
  const w = world({ seed: rideSql(DEV, TC4) + accountSql('uid-g2other001') + rideSql('uid-g2other001', TC4.slice(0, 1)) });
  const c = await w.claim(body(DEV, 'train:dr3000', 'req-g2-000001'));
  await w.merge(DEV, UID);
  firebaseUid = UID;
  const again = await w.claim(body(UID, 'train:ct250', 'req-g2-000002'), { Authorization: 'Bearer t' });
  ok('G2 裝置先領過自強四款再併進帳號：領過的記錄跟著走，帳號再領 → 409 claimed；車款也搬過去了',
    c.status === 200 && again.status === 409 && again.json.error === 'claimed' && same(q.items(w.db, UID).map(x => x.item), ['train:dr3000']), J({ c: c.text, a: again.text }));
});
await attempt('G3', async () => {
  const UID = 'uid-g3acct0001', DEV = 'dev-g3-000001', OTHER = 'dev-g3-other01';
  const w = world({ seed: accountSql(UID) + `INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('${DEV}',NULL,0,'${UID}',1);` +
    rideSql(UID, TC4.slice(0, 2)) + rideSql(DEV, TC4.slice(2, 3)) + rideSql(OTHER, TC4.slice(0, 1)) });
  await _bounty.bountyPurgeUid(w.env, UID, null);
  ok('G3 刪帳號：帳號自己與併進來的裝置的搭乘紀錄都刪掉；別人的（沒併進來的裝置）留著',
    q.rides(w.db, UID).length === 0 && q.rides(w.db, DEV).length === 0 && q.rides(w.db, OTHER).length === 1, J({ n: q.nRides(w.db) }));
});

// ═══ B：回補（scripts/ride_log_backfill.sql）══════════════════════════════════════
await attempt('B1', async () => {
  const w = world({ seed: accountSql('uid-b1acct0001') });
  const S = (id, actor, no, verdict, sys = 'tra_sched') => w.db.prepare("INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,client) VALUES (?,?,?,'山線',?,0,?,'[]',NULL,1,?,NULL)")
    .run(id, actor, sys, no, D28, verdict);
  const L = (actor, ref) => w.db.prepare("INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES (?,?,'trip',10,?,?,1,'point')").run('trip|' + ref, actor, ref, D28);
  const A = 'uid-b1acct0001';
  S('b1', A, 'P1', 'ok'); S('b2', A, 'P1', 'ok'); L(A, `${A}|${D28}|P1`);                 // 合格、兩批樣本 → 一趟
  S('b3', A, 'Q1', 'ok'); L(A, `${A}|${D28}|Q1|topup|30`);                                  // 只有補差額列（不該發生，但不算）
  S('b4', A, 'R1', 'unusable'); L(A, `${A}|${D28}|R1`);                                     // 樣本不是 ok
  S('b5', A, 'T1', 'ok');                                                                   // 合格但當天領滿、沒有錄程列
  S('b6', A, '0152', 'ok', 'thsr_sched'); L(A, `${A}|${D28}|0152`);                         // 高鐵
  S('b7', A, '11', 'ok'); L(A, `${A}|${D28}|111`);                                          // 車次 11 不能被 111 的錄程列冒認
  w.db.exec(readFileSync('scripts/ride_log_backfill.sql', 'utf8'));
  w.db.exec(readFileSync('scripts/ride_log_backfill.sql', 'utf8'));
  ok('B1 回補：有錄程列而且樣本 ok 的才補（P1、0152 高鐵），兩批樣本只補一趟；只有補差額、樣本不 ok、沒有錄程列、車次只是尾巴相同的都不補；重跑兩次一樣',
    same(q.rides(w.db, A), [{ trip_date: D28, train_no: '0152', sys: 'thsr_sched', car: '' }, { trip_date: D28, train_no: 'P1', sys: 'tra_sched', car: '' }]), J(q.rides(w.db, A)));
});

ok('Z 整支腳本沒有任何非 Firebase 的對外連線', outbound.length === 0, J(outbound));

const pass = R.filter(r => r.p).length;
console.log(`\n[SUMMARY] ${pass}/${R.length} 條判準通過`);
process.exit(pass === R.length ? 0 : 1);
