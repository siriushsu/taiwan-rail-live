#!/usr/bin/env node
// 跟這趟（AI 串聯行程 P3）的後端驗收：真 SQLite D1 替身＋真 laBind／laPushAll，網路只替換 TDX／APNs。
// 骨架照 scripts/verify_transfer_live_handoff.mjs（openTestDb、假時鐘、假 TDX TrainLiveBoard、假 APNs），
// 不依賴 .dev.vars、wrangler 或 .wrangler 狀態，可以直接掛 package.json／ship_web。
//
// 驗的事：
//   S 真實樣本（scripts/fixtures/la_trip_bind_samples.json，原生 railcore 產的三組 bind）：laBind 收、
//     各誤點下 content-state 的接續判斷與改搭＝交接檔 E 節的表（原生 TripFollowVerdict 算的數字）。
//   A 合成三段行程：誤點讓判斷變成「可能接不上」的那一分鐘才推 conn:'miss'＋alert（前一分鐘沒有）、之後同樣 miss
//     不再帶 alert；預估到站晚過界線 ⇒ 交棒到改搭第一段（missed* 帶被換掉的那班）；高鐵到站換下一段；最後一段到站收卡刪列。
//   B 準點 ⇒ 交棒到原本的下一段。
//   C 晚到連改搭都趕不上 ⇒ alert 的內文換成「請留意轉乘時間」、交棒仍照原本的下一段。
//   G 一般跟車（沒有 journey）：多出來的 21 個欄位全是 null、不帶 alert、沒變照樣不推、收卡那發也全 null。
//   V bind：壞的 journey 回 400、有 journey 就不收 handoff、重新 bind 時 last_conn 歸零。
//   I P4 公告：颱風重播快照（scripts/fixtures/trip_impact_vectors.json 的 A／B）灌進 rail_ai_revisions，
//     兩段行程第二段被判受影響：公告五欄的值、第一次受影響才亮（之後、恢復版、再變回受影響都不亮）、
//     沒有整理時全 null、公告一變就推、跟「可能接不上」同一發只帶接不上那個、一般跟車全 null、半分鐘那一輪同一份。
//     放在最前面跑：快照是 10/24，其他各組都比它晚（時間只往前走）。
//
// 判準獨立性（心得 29）：期望值是字面量——樣本那組抄自交接檔 E 節表格（原生算的），沒列數字的幾格與合成行程
// 用註解裡的手算；不呼叫 laTripVerdict／laTripSlack 產生期望。
// 時間只往前走：traLive 的 mem 快取以 Date.now() 差值判過期，時鐘倒退會讓上一組的看板被當成新的。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openTestDb } from './d1_local.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail && !pass ? ` — ${detail}` : ''}`);
};

// App 端照這組名字讀 content-state（laTripFields）。獨立寫死一份，不從 worker 拿。尾端五個是 P4 公告欄位。
const IMPACT_KEYS = ['impact', 'impactSys', 'impactState', 'impactUntil', 'impactLeg'];
const TRIP_KEYS = ['legIndex', 'legCount', 'conn', 'connSlack', 'nextSys', 'nextNo', 'nextKind', 'nextDep',
  'rebookSys', 'rebookNo', 'rebookKind', 'rebookDep', 'rebookArr', 'missedSys', 'missedNo', 'missedKind', ...IMPACT_KEYS];
const allTripNull = cs => !!cs && TRIP_KEYS.every(k => k in cs && cs[k] === null);

const realNow = Date.now;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let now = 0;
Date.now = () => now * 1000;

let board = [];          // 假 TDX 看板：[{TrainNo, StationID, TrainStationStatus, DelayTime}]
const calls = [];
let maxBodyBytes = 0, pushCount = 0;   // 全程每一發 APNs body 的最大位元組數(Live Activity 上限 4096)
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
globalThis.fetch = async (url, init = {}) => {
  const value = String(url);
  if (value.includes('openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'la-trip-test', expires_in: 86400 }), { status: 200 });
  }
  if (value.includes('TrainLiveBoard')) {
    return new Response(JSON.stringify({ UpdateTime: new Date(now * 1000).toISOString(), TrainLiveBoards: board }), { status: 200 });
  }
  if (value.includes('/3/device/')) {
    calls.push({ url: value, headers: init.headers || {}, body: JSON.parse(init.body) });
    maxBodyBytes = Math.max(maxBodyBytes, Buffer.byteLength(init.body, 'utf8'));
    pushCount++;
    return new Response('{}', { status: 200 });
  }
  throw new Error(`未預期的 fetch：${value}`);
};

// 合成三段行程（T＝這一組的基準秒）：
//   第 1 段 台鐵 1201 A→B→C→D，在 C 下車（endIndex 2、T+1200 到）。
//   第 2 段 高鐵 0201 C高鐵 T+2100 開 → E高鐵 T+3900 到。接續：步行 300 秒、界線 T+1800。
//     改搭：高鐵 0203（T+3900 開、T+5700 到）＋台鐵 3205（F T+6300 開、H T+7500 到），界線 T+3600。
//   第 3 段 台鐵 3201 F T+4500 開 → H T+5700 到。接續：步行 240 秒、界線 T+4260。改搭：台鐵 3205，界線 T+6060。
// 手算的裕度（分）：
//   1201→0201：floor((T+2100 − (T+1200+誤點))/60) − 5 − 2 ＝ 8 − 誤點分（整分誤點）。8 分＝0 偏緊、9 分＝−1 可能接不上。
//   0201→3201 與 0203→3205（高鐵誤點當 0）：floor(600/60) − 4 − 2 ＝ 4 接得上。
function synthTrip(T) {
  const tra3205 = {
    trainNo: '3205', sys: 'tra_sched', kind: '區間', color: '#1F5AA6', terminus: 'H站', transferStop: 'F站',
    waitUntil: T + 6300, carModel: null,
    stops: [{ name: 'F站', at: T + 6300, dep: T + 6300 }, { name: 'G站', at: T + 6900, dep: T + 6930 }, { name: 'H站', at: T + 7500, dep: T + 7500 }],
    staMap: { 3001: 1, 3002: 2, 3003: 2 }, stopCodes: ['3001', '3002', '3003'],
    endIndex: 2, endAt: T + 7500, endCode: '3003',
    conn: { sys: 'tra_sched', no: '3205', kind: '區間', dep: T + 6300, walkSec: 240, latest: T + 6060 },
  };
  const hsr0203 = {
    trainNo: '0203', sys: 'thsr_sched', kind: '高鐵', color: '#E85D0D', terminus: 'E高鐵', transferStop: 'C高鐵',
    waitUntil: T + 3900, carModel: null,
    stops: [{ name: 'C高鐵', at: T + 3900, dep: T + 3900 }, { name: 'E高鐵', at: T + 5700, dep: T + 5760 }],
    staMap: {}, stopCodes: ['2001', '2002'], endIndex: 1, endAt: T + 5700, endCode: '2002',
    conn: { sys: 'thsr_sched', no: '0203', kind: '高鐵', dep: T + 3900, walkSec: 300, latest: T + 3600 },
  };
  const hsr0201 = {
    trainNo: '0201', sys: 'thsr_sched', kind: '高鐵', color: '#E85D0D', terminus: 'E高鐵', transferStop: 'C高鐵',
    waitUntil: T + 2100, carModel: 'THSR700T',
    stops: [{ name: 'C高鐵', at: T + 2100, dep: T + 2100 }, { name: 'E高鐵', at: T + 3900, dep: T + 3960 }],
    staMap: {}, stopCodes: ['2001', '2002'], endIndex: 1, endAt: T + 3900, endCode: '2002',
    conn: { sys: 'thsr_sched', no: '0201', kind: '高鐵', dep: T + 2100, walkSec: 300, latest: T + 1800 },
    rebook: [{ latest: T + 3600, arrive: T + 7500, legs: [hsr0203, tra3205] }],
  };
  const tra3201 = {
    trainNo: '3201', sys: 'tra_sched', kind: '區間', color: '#1F5AA6', terminus: 'H站', transferStop: 'F站',
    waitUntil: T + 4500, carModel: null,
    stops: [{ name: 'F站', at: T + 4500, dep: T + 4500 }, { name: 'G站', at: T + 5100, dep: T + 5130 }, { name: 'H站', at: T + 5700, dep: T + 5700 }],
    staMap: { 3001: 1, 3002: 2, 3003: 2 }, stopCodes: ['3001', '3002', '3003'],
    endIndex: 2, endAt: T + 5700, endCode: '3003',
    conn: { sys: 'tra_sched', no: '3201', kind: '區間', dep: T + 4500, walkSec: 240, latest: T + 4260 },
    rebook: [{ latest: T + 6060, arrive: T + 7500, legs: [tra3205] }],
  };
  return {
    sys: 'tra_sched', trainNo: '1201', carModel: 'EMU900',
    stops: [{ name: 'A站', at: T, dep: T }, { name: 'B站', at: T + 600, dep: T + 630 },
      { name: 'C站', at: T + 1200, dep: T + 1260 }, { name: 'D站', at: T + 1800, dep: T + 1800 }],
    staMap: { 1001: 1, 1002: 2, 1003: 3, 1004: 3 }, stopCodes: ['1001', '1002', '1003', '1004'],
    journey: { legIndex: 0, legCount: 3, endIndex: 2, endAt: T + 1200, endCode: '1003', legs: [hsr0201, tra3201] },
  };
}
const tra1201 = (sta, status, delayMin) => [{ TrainNo: '1201', StationID: sta, TrainStationStatus: status, DelayTime: delayMin }];

try {
  const { DELAY_DB } = openTestDb();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n');
  const env = {
    DELAY_DB,
    APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`,
    APNS_KEY_ID: 'LATRIP01', APNS_TEAM_ID: 'LATRIPTEAM',
    TDX_CLIENT_ID: 'test', TDX_CLIENT_SECRET: 'test',
    LA_TEST_BEARER: 'la-trip-test',     // laBind 的本機測試閘門(跳過 Plus 資格查詢)
  };
  const worker = await import('../worker.js');
  const { laPushAll, laBind } = worker._la;
  const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

  const bind = async (body) => {
    const res = await laBind(new Request('https://la-trip.invalid/api/la/bind', {
      method: 'POST', headers: { Authorization: 'Bearer la-trip-test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);
    return { status: res.status, json: await res.json() };
  };
  // 一分鐘的 cron：回傳這一分鐘送出的 APNs（content-state、alert、priority、event）。
  const tick = async (nextBoard) => {
    board = nextBoard;
    calls.length = 0;
    const res = await laPushAll(env, ctx, 'https://la-trip.invalid');
    return { res, pushes: calls.map(c => ({ token: c.url.split('/3/device/')[1], aps: c.body.aps, cs: c.body.aps['content-state'],
      priority: c.headers['apns-priority'] })) };
  };
  const rowOf = token => DELAY_DB.prepare('SELECT * FROM la_bindings WHERE token=?').bind(token).first();
  const reset = () => DELAY_DB.prepare('DELETE FROM la_bindings').run();
  const tok = n => (n.toString(16).padStart(2, '0')).repeat(32);
  const brief = p => p ? JSON.stringify({ alert: p.aps.alert || null, pr: p.priority, ...Object.fromEntries(['conn', 'connSlack', 'nextNo', 'rebookNo', 'missedNo', 'legIndex', 'legCount', 'trainNoOverride', 'nextStop'].map(k => [k, p.cs[k]])) }) : '(沒有推播)';

  // ══ I：P4 公告（AI 營運整理 × 跟這趟）══════════════════════════════════════════
  // 快照 A＝10/24 06:00（台鐵 西部幹線 基隆=彰化 對號列車停駛到 12 時）、B＝10/24 12:30（西部幹線 12 時後正常、宜蘭線北迴線停駛到 15 時）。
  // 手算（照 scripts/trip_impact.mjs 檔頭規則，也與 verify_trip_impact 的向量 A-reserved-keelung-changhua、B-thsr-then-tra 同型）：
  //   I1＝高鐵 0809 台北 10:41→台中 11:43（站表到左營）＋台鐵自強 111 臺中 11:55→彰化 12:10。
  //     A：第二段 對號＋臺中～彰化在基隆=彰化範圍內＋時間 [11:55,12:10] 跟「到 12:00」有交集 ⇒ 受影響、第 1 段、停駛、12:00；
  //        高鐵那筆是「正常」⇒ 第一段不受影響。
  //     B：西部幹線那筆 12:00 起正常（跟第二段有交集、範圍涵蓋）⇒ 不受影響；最嚴重的第一個有依據的段是高鐵（全線正常）⇒ 第 0 段、thsr、正常、
  //        沒有恢復時刻。宜蘭線停駛到 15:00 還沒結束 ⇒ show 仍為真（台鐵有用到）。
  //   I2＝台鐵區間 1131 臺北 10:41→桃園 11:15＋自強 109 桃園 11:30→新竹 12:05（步行 300 秒）。
  //     接續裕度 floor(900/60)−5−2＝8−誤點分：0 分＝8 接得上、20 分＝−12 可能接不上（沒有改搭 ⇒ 挑 −1）。A：第二段同 I1 受影響。
  //   last_conn：'#' 前是 P3 的接續（tone|pick|missed，沒有接續＝'-'），'#' 後 H＝已亮過、再接五欄（null 寫成空字串）。
  const vec = JSON.parse(readFileSync(join(HERE, 'fixtures', 'trip_impact_vectors.json'), 'utf8'));
  const T = hm => Date.parse(`2026-10-24T${hm}:00+08:00`) / 1000;
  const U12 = T('12:00');
  const putRev = async snap => {
    const s = vec.snapshots[snap];
    const atMs = Date.parse(s.at);
    const systems = Object.fromEntries(s.systems.map(e => [e.id, { ...e, updatedAt: atMs }]));
    await DELAY_DB.prepare('INSERT INTO rail_ai_revisions (at_ms, changed, systems, cost_usd, meta) VALUES (?, ?, ?, 0, NULL)')
      .bind(atMs, JSON.stringify(Object.keys(systems)), JSON.stringify(systems)).run();
  };
  const clearRev = () => DELAY_DB.prepare('DELETE FROM rail_ai_revisions').run();
  const imp = p => p ? JSON.stringify({ alert: p.aps.alert ? p.aps.alert.title['loc-key'] : null, pr: p.priority, conn: p.cs.conn,
    connSlack: p.cs.connSlack, legIndex: p.cs.legIndex, ...Object.fromEntries(IMPACT_KEYS.map(k => [k, p.cs[k]])) }) : '(沒有推播)';
  const impIs = (p, impact, sys, state, until, leg) => !!p && p.cs.impact === impact && p.cs.impactSys === sys
    && p.cs.impactState === state && p.cs.impactUntil === until && p.cs.impactLeg === leg;
  const impNull = p => !!p && IMPACT_KEYS.every(k => k in p.cs && p.cs[k] === null);
  const hitAlert = p => !!p && !!p.aps.alert && p.aps.alert.title['loc-key'] === '這趟受營運公告影響'
    && p.aps.alert.body['loc-key'] === '鎖屏卡上有公告重點' && p.aps.alert.sound === 'default' && p.priority === '10';
  {
    // ── I2 先跑（時間較早）：跟「可能接不上」同一發 ──
    const tra109 = {
      trainNo: '109', sys: 'tra_sched', kind: '自強', color: '#C8102E', terminus: '新竹', transferStop: '桃園',
      waitUntil: T('11:30'), carModel: null,
      stops: [{ name: '桃園', at: T('11:30'), dep: T('11:30') }, { name: '中壢', at: T('11:40'), dep: T('11:41') }, { name: '新竹', at: T('12:05'), dep: T('12:05') }],
      staMap: { 1080: 1, 1100: 2, 1210: 2 }, stopCodes: ['1080', '1100', '1210'], endIndex: 2, endAt: T('12:05'), endCode: '1210',
      conn: { sys: 'tra_sched', no: '109', kind: '自強', dep: T('11:30'), walkSec: 300, latest: T('11:25') },
    };
    const I2 = {
      sys: 'tra_sched', trainNo: '1131', carModel: 'EMU900',
      stops: [{ name: '臺北', at: T('10:40'), dep: T('10:41') }, { name: '板橋', at: T('10:50'), dep: T('10:51') }, { name: '桃園', at: T('11:15'), dep: T('11:16') }],
      staMap: { 1000: 1, 1020: 2, 1080: 2 }, stopCodes: ['1000', '1020', '1080'],
      journey: { legIndex: 0, legCount: 2, endIndex: 2, endAt: T('11:15'), endCode: '1080', legs: [tra109] },
    };
    const b1131 = d => [{ TrainNo: '1131', StationID: '1000', TrainStationStatus: 1, DelayTime: d }];
    await reset(); await clearRev();
    const tokI2 = tok(0x52);
    now = T('10:15');
    const bI2 = await bind({ ...I2, token: tokI2 });
    now = T('10:20');
    let t = await tick(b1131(0));
    let p = t.pushes[0];
    ok('I1 沒有任何整理（rail_ai_revisions 空）：跟這趟照推、公告五欄都在、全是 null、不亮', bI2.status === 200 && t.pushes.length === 1
      && impNull(p) && p.cs.conn === 'ok' && p.cs.connSlack === 8 && !p.aps.alert, imp(p));
    let row = await rowOf(tokI2);
    ok('I1b 沒有公告時 last_conn 照 P3 原格式（ok|-1|0）', !!row && row.last_conn === 'ok|-1|0', row && row.last_conn);

    now = T('10:21');
    await putRev('A');
    t = await tick(b1131(20));
    p = t.pushes[0];
    ok('I2 誤點 20 分＋整理換成颱風版 A 同一分鐘：可能接不上（−12）、第 1 段受影響', t.pushes.length === 1 && p.cs.conn === 'miss'
      && p.cs.connSlack === -12 && impIs(p, 'hit', 'tra', '停駛', U12, 1), imp(p));
    ok('I2b 同一發只帶一個 alert：接不上優先（「這趟可能接不上」／「請留意轉乘時間」），不是公告那個', !!p && !!p.aps.alert
      && p.aps.alert.title['loc-key'] === '這趟可能接不上' && p.aps.alert.body['loc-key'] === '請留意轉乘時間' && p.priority === '10',
      JSON.stringify(p && p.aps.alert));
    row = await rowOf(tokI2);
    ok('I2c last_conn 記下接續與公告（含 H：受影響那一次已用掉）', !!row && row.last_conn === `miss|-1|0#Hhit|tra|停駛|${U12}|1`, row && row.last_conn);

    now = T('10:22');
    t = await tick(b1131(21));
    p = t.pushes[0];
    ok('I3 下一發（誤點 21 分）：仍受影響、仍接不上，兩個 alert 都不補響、priority 5', t.pushes.length === 1 && p.cs.conn === 'miss'
      && impIs(p, 'hit', 'tra', '停駛', U12, 1) && !p.aps.alert && p.priority === '5', imp(p));
  }
  {
    // ── I1：公告五欄、第一次受影響才亮、恢復版、沒有整理、一般跟車、半分鐘那一輪、換段 ──
    const tra111 = {
      trainNo: '111', sys: 'tra_sched', kind: '自強', color: '#C8102E', terminus: '彰化', transferStop: '臺中',
      waitUntil: T('11:55'), carModel: null,
      stops: [{ name: '臺中', at: T('11:55'), dep: T('11:55') }, { name: '彰化', at: T('12:10'), dep: T('12:10') }],
      staMap: { 3300: 1, 3360: 1 }, stopCodes: ['3300', '3360'], endIndex: 1, endAt: T('12:10'), endCode: '3360',
      conn: { sys: 'tra_sched', no: '111', kind: '自強', dep: T('11:55'), walkSec: 300, latest: T('11:50') },
    };
    const I1 = {
      sys: 'thsr_sched', trainNo: '0809', carModel: 'THSR700T',
      stops: [{ name: '台北', at: T('10:41'), dep: T('10:41') }, { name: '板橋', at: T('10:49'), dep: T('10:50') },
        { name: '桃園', at: T('11:03'), dep: T('11:04') }, { name: '台中', at: T('11:43'), dep: T('11:45') },
        { name: '左營', at: T('12:40'), dep: T('12:40') }],
      staMap: {}, stopCodes: ['1000', '1010', '1020', '1040', '1070'],
      journey: { legIndex: 0, legCount: 2, endIndex: 3, endAt: T('11:43'), endCode: '1040', legs: [tra111] },
    };
    await reset(); await clearRev();
    const tokI1 = tok(0x51), tokN = tok(0x5f);
    now = T('10:25');
    const bI1 = await bind({ ...I1, token: tokI1 });
    const N = { ...I1 };
    delete N.journey;
    const bN = await bind({ ...N, token: tokN });
    await putRev('A');
    const mine = (tt, token) => tt.pushes.filter(x => x.token === token);

    now = T('10:35');
    let t = await tick([]);
    let p = mine(t, tokI1)[0];
    ok('I4 颱風版 A：第一發公告五欄＝受影響／tra／停駛／12:00／第 1 段（第二段）', bI1.status === 200 && mine(t, tokI1).length === 1
      && impIs(p, 'hit', 'tra', '停駛', U12, 1) && p.cs.legIndex === 0 && p.cs.legCount === 2, imp(p));
    ok('I4b 第一次判成受影響那一發亮：「這趟受營運公告影響」／「鎖屏卡上有公告重點」、有聲音、priority 10', hitAlert(p),
      JSON.stringify(p && p.aps.alert));
    const n = mine(t, tokN)[0];
    ok('I4c 同一輪的一般跟車（同一班高鐵、沒有 journey）：21 個跟這趟欄位全 null、不亮', bN.status === 200 && allTripNull(n && n.cs)
      && !!n && !n.aps.alert && n.priority === '5', n ? JSON.stringify(Object.fromEntries(TRIP_KEYS.map(k => [k, n.cs[k]]))) : '(沒有推播)');
    let row = await rowOf(tokI1);
    ok('I4d last_conn＝ok|-1|0#Hhit|tra|停駛|<12:00>|1（接續 12−5−2＝5 接得上）', !!row && row.last_conn === `ok|-1|0#Hhit|tra|停駛|${U12}|1`,
      row && row.last_conn);

    now = T('10:36');
    t = await tick([]);
    ok('I5 下一分鐘什麼都沒變（還沒發車、公告同一版）：不推（公告不會讓判定式每分鐘不相等）', t.pushes.length === 0,
      t.pushes.map(imp).join(' '));

    now = T('10:37');
    await putRev('B');
    t = await tick([]);
    p = mine(t, tokI1)[0];
    ok('I6 整理換成恢復版 B（車沒動、接續沒變）：只因公告變了就推一發', mine(t, tokI1).length === 1 && t.pushes.length === 1,
      t.pushes.map(imp).join(' '));
    ok('I6b 欄位跟著變：不受影響／thsr／正常／沒有恢復時刻／第 0 段；不亮', impIs(p, 'clear', 'thsr', '正常', null, 0) && !p.aps.alert
      && p.priority === '5', imp(p));
    row = await rowOf(tokI1);
    ok('I6c last_conn 保留 H（亮過）＋新的五欄', !!row && row.last_conn === 'ok|-1|0#Hclear|thsr|正常||0', row && row.last_conn);

    now = T('10:38');
    await clearRev();
    t = await tick([]);
    p = mine(t, tokI1)[0];
    ok('I7 整理清空：推一發、公告五欄全 null、不亮', mine(t, tokI1).length === 1 && impNull(p) && !p.aps.alert && p.cs.conn === 'ok', imp(p));

    now = T('10:39');
    t = await tick([]);
    ok('I7b 再下一分鐘沒變：不推', t.pushes.length === 0, t.pushes.map(imp).join(' '));

    now = T('10:40');
    await putRev('A');
    t = await tick([]);
    p = mine(t, tokI1)[0];
    ok('I8 又換回颱風版 A：欄位回到受影響、但這次綁定已亮過 ⇒ 不再亮、priority 5', mine(t, tokI1).length === 1
      && impIs(p, 'hit', 'tra', '停駛', U12, 1) && !p.aps.alert && p.priority === '5', imp(p));

    now = T('10:45');                                   // 台北 10:41 開、板橋 10:49 到之間：行駛中，每分鐘都推
    t = await tick([]);
    p = mine(t, tokI1)[0];
    ok('I9 行駛中照每分鐘推：仍受影響、不亮', mine(t, tokI1).length === 1 && impIs(p, 'hit', 'tra', '停駛', U12, 1) && !p.aps.alert
      && p.cs.nextStop === '板橋', imp(p));
    ok('I9b 交給半分鐘那一輪的 handoff 帶著這一輪的整理（systems 陣列）', !!t.res.handoff && Array.isArray(t.res.handoff.railSystems)
      && t.res.handoff.railSystems.some(e => e.id === 'tra'), JSON.stringify(t.res.handoff && Object.keys(t.res.handoff)));
    now = T('10:45') + 30;
    calls.length = 0;
    await laPushAll(env, ctx, 'https://la-trip.invalid', { ...t.res.handoff, deadlineMs: Date.now() + 30000 });
    const halfP = calls.filter(c => c.url.endsWith(tokI1)).map(c => ({ aps: c.body.aps, cs: c.body.aps['content-state'], priority: c.headers['apns-priority'] }))[0];
    ok('I9c 半分鐘那一輪：公告五欄同一份（受影響、第 1 段）、不亮', impIs(halfP, 'hit', 'tra', '停駛', U12, 1) && !halfP.aps.alert, imp(halfP));

    now = T('11:44');                                   // 高鐵 11:43 到台中 ⇒ 換第二段台鐵 111
    t = await tick([]);
    p = mine(t, tokI1)[0];
    ok('I10 換段到台鐵 111（第 2／2 段）：impactLeg＝1＋0＝1（整趟算）、不亮', mine(t, tokI1).length === 1 && p.cs.trainNoOverride === '111'
      && p.cs.legIndex === 1 && impIs(p, 'hit', 'tra', '停駛', U12, 1) && !p.aps.alert, imp(p));
    row = await rowOf(tokI1);
    ok('I10b 沒有下一個接續：last_conn＝-#Hhit|…（H 跟著換段留下）', !!row && row.last_conn === `-#Hhit|tra|停駛|${U12}|1`, row && row.last_conn);
  }
  {
    // ── I11：第一段是台鐵對號列車、bind 帶 kind ⇒ 「對號列車停駛」判得出受影響；同一趟不帶 kind ⇒ 只能判可能受影響（證明 kind 有被用到）──
    const tra1131 = {
      trainNo: '1131', sys: 'tra_sched', kind: '區間', color: '#0070C0', terminus: '員林', transferStop: '彰化',
      waitUntil: T('12:25'), carModel: null,
      stops: [{ name: '彰化', at: T('12:25'), dep: T('12:25') }, { name: '員林', at: T('12:40'), dep: T('12:40') }],
      staMap: { 3360: 0, 3390: 1 }, stopCodes: ['3360', '3390'], endIndex: 1, endAt: T('12:40'), endCode: '3390',
      conn: { sys: 'tra_sched', no: '1131', kind: '區間', dep: T('12:25'), walkSec: 300, latest: T('12:20') },
    };
    const K = {
      sys: 'tra_sched', trainNo: '111', carModel: null,
      stops: [{ name: '臺中', at: T('11:55'), dep: T('11:55') }, { name: '彰化', at: T('12:10'), dep: T('12:10') }],
      staMap: { 3300: 0, 3360: 1 }, stopCodes: ['3300', '3360'],
      journey: { legIndex: 0, legCount: 2, endIndex: 1, endAt: T('12:10'), endCode: '3360', legs: [tra1131] },
    };
    await reset(); await clearRev(); await putRev('A');
    const tokK1 = tok(0x61), tokK2 = tok(0x62);
    now = T('11:00');
    const bK1 = await bind({ ...K, token: tokK1, kind: '自強' });
    const bK2 = await bind({ ...K, token: tokK2 });
    const rK1 = await rowOf(tokK1), rK2 = await rowOf(tokK2);
    ok('I11a laBind 把 kind 存進 journey_state（帶＝自強；不帶＝null；過長／非字串＝null）', bK1.status === 200 && bK2.status === 200
      && JSON.parse(rK1.journey_state).kind === '自強' && JSON.parse(rK2.journey_state).kind === null,
      `${rK1 && rK1.journey_state && JSON.parse(rK1.journey_state).kind}/${rK2 && rK2.journey_state && JSON.parse(rK2.journey_state).kind}`);
    now = T('11:10');
    const t = await tick([]);
    const pk1 = t.pushes.find(x => x.token === tokK1), pk2 = t.pushes.find(x => x.token === tokK2);
    ok('I11 第一段台鐵自強（bind 帶 kind）＋對號列車停駛到 12 時、行程在範圍與時段內 ⇒ impact hit／tra／停駛', !!pk1
      && impIs(pk1, 'hit', 'tra', '停駛', U12, 0), imp(pk1));
    ok('I11b 同一趟 bind 不帶 kind ⇒ maybe（車種未知，限定對號的公告只能判可能受影響）', !!pk2 && pk2.cs.impact === 'maybe', imp(pk2));
  }
  await reset();
  await clearRev();

  // ══ S：原生 railcore 產的真實 bind（契約對接的證據）══════════════════════════════
  // 期望值抄自交接檔 E 節的表（原生 TripFollowVerdict 算的）；表上沒寫數字的幾格是手算：
  //   2134：豐富 08:37 到（endAt 1794875850）→ 0806 08:56 開（1794876990），差 1140 秒，步行 351 秒＝6 分：
  //         0 分 19−6−2＝11、3 分 16−8＝8、5 分 14−8＝6。
  //   1734：六家 endAt 1794890880 → 0637 1794891390，差 510 秒，步行 303 秒＝6 分：
  //         5 分 floor(210/60)=3−8＝−5、9 分 floor(−30/60)=−1−8＝−9、15 分 floor(−390/60)=−7−8＝−15。
  const samples = JSON.parse(readFileSync(join(HERE, 'fixtures', 'la_trip_bind_samples.json'), 'utf8'));
  const EXPECT = {
    2023: { tone: ['ok', 'ok', 'ok', 'tight', 'miss'], slack: [10, 7, 5, 1, -5], rebook: '0672', firstMiss: 4 },
    2134: { tone: ['ok', 'ok', 'ok', 'tight', 'miss'], slack: [11, 8, 6, 2, -4], rebook: '0810', firstMiss: 4 },
    1734: { tone: ['tight', 'miss', 'miss', 'miss', 'miss'], slack: [0, -3, -5, -9, -15], rebook: '0639', firstMiss: 1 },
  };
  const DELAYS = [0, 3, 5, 9, 15];
  ok('S0 樣本檔有三組、各帶 journey', samples.length === 3 && samples.every(s => s.journey && EXPECT[s.trainNo]),
    samples.map(s => s.trainNo).join(','));
  samples.sort((x, y) => x.stops[0].at - y.stops[0].at);
  for (const [si, s] of samples.entries()) {
    await reset();
    const e = EXPECT[s.trainNo];
    const token = tok(0x10 + si);
    now = s.stops[0].at - 600;
    const r = await bind({ ...s, token });
    const row = await rowOf(token);
    const st = row && JSON.parse(row.journey_state || 'null');
    ok(`S1 ${s.trainNo} bind 收（200）、journey_state 是 mode:trip、段數對`, r.status === 200 && st && st.mode === 'trip'
      && st.legs.length === s.journey.legs.length && st.legCount === s.journey.legCount && row.last_conn === null,
      `${r.status} ${JSON.stringify(r.json)} ${row && row.journey_state && row.journey_state.slice(0, 120)}`);
    const got = [];
    for (const d of DELAYS) {
      now += 60;
      const { pushes } = await tick([{ TrainNo: s.trainNo, StationID: s.stopCodes[0], TrainStationStatus: 1, DelayTime: d }]);
      got.push(pushes.length === 1 ? pushes[0] : null);
    }
    ok(`S2 ${s.trainNo} 誤點 0／3／5／9／15 分各推一發`, got.every(Boolean), got.map(brief).join(' '));
    ok(`S3 ${s.trainNo} 接續判斷＝${e.tone.join('／')}`, got.every((p, i) => p && p.cs.conn === e.tone[i]),
      got.map(p => p && p.cs.conn).join(','));
    ok(`S4 ${s.trainNo} 裕度＝${e.slack.join('／')} 分`, got.every((p, i) => p && p.cs.connSlack === e.slack[i]),
      got.map(p => p && p.cs.connSlack).join(','));
    ok(`S5 ${s.trainNo} 可能接不上時改搭＝${e.rebook}、其他時候改搭欄位是 null`,
      got.every((p, i) => p && (e.tone[i] === 'miss' ? p.cs.rebookNo === e.rebook && p.cs.rebookSys === 'thsr_sched'
        : p.cs.rebookNo === null && p.cs.rebookSys === null)), got.map(p => p && p.cs.rebookNo).join(','));
    ok(`S6 ${s.trainNo} 只有第一次變成可能接不上（誤點 ${DELAYS[e.firstMiss]} 分）那一發帶 alert`,
      got.every((p, i) => p && (i === e.firstMiss ? !!p.aps.alert && p.priority === '10' : !p.aps.alert && p.priority === '5')),
      got.map(brief).join(' '));
    ok(`S7 ${s.trainNo} 第 1／${s.journey.legCount} 段、下一班＝${s.journey.legs[0].trainNo}`,
      got.every(p => p && p.cs.legIndex === 0 && p.cs.legCount === s.journey.legCount
        && p.cs.nextNo === s.journey.legs[0].conn.no && p.cs.nextDep === s.journey.legs[0].conn.dep),
      brief(got[0]));
  }

  // ══ A：合成三段行程，誤點一路變大到改搭，再一路走到收卡 ══════════════════════════
  await reset();
  const TA = 1_810_000_000;
  const A = synthTrip(TA), tokA = tok(0xa1);
  now = TA - 300;
  const bA = await bind({ ...A, token: tokA });
  ok('A0 合成行程 bind 收（200）', bA.status === 200, JSON.stringify(bA.json));

  now = TA - 240;                                   // 在 A 站，準點
  let t = await tick(tra1201('1001', 1, 0));
  let p = t.pushes[0];
  ok('A1 開卡第一發：第 1／3 段、接續高鐵 0201 接得上（裕度 8）', t.pushes.length === 1 && p.cs.legIndex === 0 && p.cs.legCount === 3
    && p.cs.conn === 'ok' && p.cs.connSlack === 8 && p.cs.nextSys === 'thsr_sched' && p.cs.nextNo === '0201'
    && p.cs.nextKind === '高鐵' && p.cs.nextDep === TA + 2100, brief(p));
  ok('A1b 還沒有改搭、也沒有被換掉的班次；第一段沒有身分覆寫、車型是 bind 的', !!p && p.cs.rebookNo === null && p.cs.rebookDep === null
    && p.cs.rebookArr === null && p.cs.missedNo === null && p.cs.trainNoOverride === null && p.cs.carModelOverride === 'EMU900', brief(p));

  now = TA + 360;                                   // 離開 A 站，誤點 8 分：裕度 0＝偏緊
  t = await tick(tra1201('1001', 2, 8));
  p = t.pushes[0];
  ok('A2 誤點 8 分：偏緊（裕度 0），這一發不帶 alert、priority 5', t.pushes.length === 1 && p.cs.conn === 'tight'
    && p.cs.connSlack === 0 && !p.aps.alert && p.priority === '5' && p.cs.rebookNo === null, brief(p));

  now = TA + 420;                                   // 誤點 9 分：裕度 −1＝可能接不上
  t = await tick(tra1201('1001', 2, 9));
  p = t.pushes[0];
  ok('A3 誤點 9 分：這一分鐘才推出可能接不上（裕度 −1）', t.pushes.length === 1 && p.cs.conn === 'miss' && p.cs.connSlack === -1, brief(p));
  ok('A3b 而且帶 alert：標題「這趟可能接不上」、內文「鎖屏卡上有改搭建議」、有聲音、priority 10',
    !!p && !!p.aps.alert && p.aps.alert.title['loc-key'] === '這趟可能接不上'
    && p.aps.alert.body['loc-key'] === '鎖屏卡上有改搭建議' && p.aps.alert.sound === 'default' && p.priority === '10',
    JSON.stringify(p && p.aps.alert));
  ok('A3c 改搭＝高鐵 0203（T+3900 開，到終點 T+7500）', !!p && p.cs.rebookSys === 'thsr_sched' && p.cs.rebookNo === '0203'
    && p.cs.rebookKind === '高鐵' && p.cs.rebookDep === TA + 3900 && p.cs.rebookArr === TA + 7500, brief(p));
  let row = await rowOf(tokA);
  ok('A3d D1 記下 last_conn＝miss|0|0（挑第 0 個改搭、還沒自動改搭）', !!row && row.last_conn === 'miss|0|0', row && row.last_conn);

  now = TA + 480;                                   // 誤點 10 分：仍是可能接不上
  t = await tick(tra1201('1001', 2, 10));
  p = t.pushes[0];
  ok('A4 誤點 10 分：照樣推（裕度 −2），但不再帶 alert、priority 5', t.pushes.length === 1 && p.cs.conn === 'miss'
    && p.cs.connSlack === -2 && !p.aps.alert && p.priority === '5', brief(p));

  now = TA + 1860;                                  // 晚 11 分到 C 站：T+1860 晚過界線 T+1800 ⇒ 自動改搭
  t = await tick(tra1201('1003', 1, 11));
  p = t.pushes[0];
  ok('A5 預估到站晚過界線：交棒到改搭第一段高鐵 0203（第 2／3 段）', t.pushes.length === 1 && p.cs.trainNoOverride === '0203'
    && p.cs.sysOverride === 'thsr_sched' && p.cs.kindOverride === '高鐵' && p.cs.legIndex === 1 && p.cs.legCount === 3, brief(p));
  ok('A5b missed* 帶被換掉的高鐵 0201', !!p && p.cs.missedSys === 'thsr_sched' && p.cs.missedNo === '0201' && p.cs.missedKind === '高鐵', brief(p));
  ok('A5c 卡片先顯示在 C高鐵 等 0203 發車；下一個接續台鐵 3205 接得上（裕度 4）', !!p && p.cs.nextStop === 'C高鐵'
    && p.cs.transferWaiting === true && p.cs.arrivalDate === TA + 3900 && p.cs.conn === 'ok' && p.cs.connSlack === 4
    && p.cs.nextNo === '3205' && !p.aps.alert, brief(p));
  ok('A5d 改搭的車沒有車型 ⇒ carModelOverride 是 null（不沿用第一段的 EMU900）', !!p && p.cs.carModelOverride === null,
    String(p && p.cs.carModelOverride));
  row = await rowOf(tokA);
  let js = row && JSON.parse(row.journey_state);
  ok('A5e D1 換成 0203：sys／train_no／journey_state（cur＝0203、剩 3205、missed＝0201）／last_conn',
    !!row && row.sys === 'thsr_sched' && row.train_no === '0203' && js.mode === 'trip' && js.legIndex === 1
    && js.cur && js.cur.trainNo === '0203' && js.legs.length === 1 && js.legs[0].trainNo === '3205'
    && js.missed && js.missed.no === '0201' && row.last_conn === 'ok|-1|1' && row.last_idx === 0,
    row ? `${row.sys}/${row.train_no} last_conn=${row.last_conn} idx=${row.last_idx} cur=${js && js.cur && js.cur.trainNo}` : '(查無列)');

  now = TA + 5760;                                  // 0203 到 E高鐵（高鐵照表定）⇒ 換最後一段台鐵 3205
  t = await tick([]);
  p = t.pushes[0];
  ok('A6 高鐵到站：交棒到原本下一段台鐵 3205（第 3／3 段），被換掉的那班不再顯示、沒有下一個接續',
    t.pushes.length === 1 && p.cs.trainNoOverride === '3205' && p.cs.sysOverride === 'tra_sched' && p.cs.legIndex === 2
    && p.cs.legCount === 3 && p.cs.missedNo === null && p.cs.conn === null && p.cs.nextNo === null
    && p.cs.nextStop === 'F站' && p.cs.transferWaiting === true, brief(p));
  row = await rowOf(tokA);
  ok('A6b D1 換成 3205、last_conn 清成 NULL', !!row && row.train_no === '3205' && row.last_conn === null,
    row ? `${row.train_no} ${row.last_conn}` : '(查無列)');

  now = TA + 7560;                                  // 3205 到 H 站（最後一段的下車站）⇒ 收卡
  t = await tick([{ TrainNo: '3205', StationID: '3003', TrainStationStatus: 1, DelayTime: 1 }]);
  p = t.pushes[0];
  ok('A7 最後一段過下車站：送 end（dismissal-date＝現在）', t.pushes.length === 1 && p.aps.event === 'end'
    && p.aps['dismissal-date'] === now && p.cs.nextStop === 'H站' && p.cs.terminus === 'H站', brief(p));
  ok('A7b 收卡那發的跟這趟欄位全在、全是 null', allTripNull(p && p.cs), JSON.stringify(p && p.cs));
  ok('A7c 收卡後刪列', (await rowOf(tokA)) === null);

  // ══ B：準點到站 ⇒ 交棒到原本的下一段 ══════════════════════════════════════════
  await reset();
  const TB = TA + 10_000;
  const tokB = tok(0xb1);
  now = TB - 300;
  await bind({ ...synthTrip(TB), token: tokB });
  now = TB + 1260;
  t = await tick(tra1201('1003', 1, 0));
  p = t.pushes[0];
  ok('B1 準點到 C 站：交棒到原本的高鐵 0201（第 2／3 段），沒有 missed', t.pushes.length === 1 && p.cs.trainNoOverride === '0201'
    && p.cs.legIndex === 1 && p.cs.legCount === 3 && p.cs.missedNo === null && p.cs.missedSys === null, brief(p));
  ok('B1b 下一個接續是台鐵 3201（裕度 4），0201 自己的車型 THSR700T', !!p && p.cs.conn === 'ok' && p.cs.connSlack === 4
    && p.cs.nextNo === '3201' && p.cs.carModelOverride === 'THSR700T' && p.cs.transferWaiting === true, brief(p));
  row = await rowOf(tokB);
  js = row && JSON.parse(row.journey_state);
  ok('B1c D1：train_no 0201、cur＝0201、剩 3201、last_conn＝ok|-1|0', !!row && row.train_no === '0201' && js.cur.trainNo === '0201'
    && js.legs.length === 1 && js.legs[0].trainNo === '3201' && js.missed === null && row.last_conn === 'ok|-1|0',
    row ? `${row.train_no} ${row.last_conn}` : '(查無列)');

  // ══ C：晚到連改搭都趕不上 ══════════════════════════════════════════════════════
  await reset();
  const TC = TB + 10_000;
  const tokC = tok(0xc1);
  now = TC - 300;
  await bind({ ...synthTrip(TC), token: tokC });
  now = TC + 360;                                   // 誤點 41 分：預估 T+3660 到，晚過唯一改搭的界線 T+3600
  t = await tick(tra1201('1001', 2, 41));
  p = t.pushes[0];
  ok('C1 可能接不上但沒有趕得上的改搭：alert 內文「請留意轉乘時間」、改搭欄位全 null', t.pushes.length === 1
    && p.cs.conn === 'miss' && p.cs.connSlack === -33 && !!p.aps.alert && p.aps.alert.body['loc-key'] === '請留意轉乘時間'
    && p.cs.rebookNo === null && p.cs.rebookArr === null, brief(p));
  now = TC + 3720;
  t = await tick(tra1201('1003', 1, 41));
  p = t.pushes[0];
  ok('C2 到站時沒有改搭可換：照原本的下一段 0201 交棒、沒有 missed、不再 alert', t.pushes.length === 1
    && p.cs.trainNoOverride === '0201' && p.cs.missedNo === null && p.cs.legIndex === 1 && !p.aps.alert, brief(p));

  // ══ G：一般跟車（沒有 journey）════════════════════════════════════════════════
  await reset();
  const TG = TC + 10_000;
  const tokG = tok(0xd1);
  const G = synthTrip(TG);
  delete G.journey;
  now = TG - 300;
  const bG = await bind({ ...G, token: tokG });
  row = await rowOf(tokG);
  ok('G0 一般跟車 bind 收；journey_state 只有 carModel、last_conn 是 NULL', bG.status === 200 && !!row
    && row.journey_state === JSON.stringify({ carModel: 'EMU900' }) && row.last_conn === null, row && row.journey_state);
  now = TG - 240;
  t = await tick(tra1201('1001', 1, 0));
  p = t.pushes[0];
  ok('G1 一般跟車照樣推第一發，21 個跟這趟欄位都在、全是 null', t.pushes.length === 1 && allTripNull(p.cs), JSON.stringify(p && p.cs));
  ok('G1b 不帶 alert、priority 5、車型照 bind', !!p && !p.aps.alert && p.priority === '5' && p.cs.carModelOverride === 'EMU900', brief(p));
  now = TG - 180;
  t = await tick(tra1201('1001', 1, 0));
  ok('G2 沒變（同一站停著、誤點沒變）照樣不推（last_conn 是 NULL 不會讓判定式每分鐘不相等）', t.pushes.length === 0,
    `pushes=${t.pushes.length}`);
  now = TG - 120;
  t = await tick(tra1201('1001', 1, 2));
  ok('G3 誤點一變就推、欄位仍全 null', t.pushes.length === 1 && allTripNull(t.pushes[0].cs) && !t.pushes[0].aps.alert,
    t.pushes.map(brief).join(' '));
  row = await rowOf(tokG);
  ok('G3b 一般跟車寫回後 last_conn 仍是 NULL', !!row && row.last_conn === null && row.last_delay === 120, row && `${row.last_conn} ${row.last_delay}`);
  now = TG + 2400;                                  // 過了 D 站（全程走完）
  t = await tick([]);
  p = t.pushes[0];
  ok('G4 一般跟車走完全程照舊送 end、刪列，end 那發欄位全 null', t.pushes.length === 1 && p.aps.event === 'end'
    && p.cs.nextStop === 'D站' && allTripNull(p.cs) && (await rowOf(tokG)) === null, brief(p));

  // ══ V：bind 的驗證與重設 ══════════════════════════════════════════════════════
  await reset();
  const TV = TG + 10_000;
  now = TV - 300;
  const V = synthTrip(TV);
  const bad = [
    ['journey 不是物件', 'oops'],
    ['legCount 與段數對不上', { ...V.journey, legCount: 5 }],
    ['下車站索引超出站表', { ...V.journey, endIndex: 9 }],
    ['接續的界線晚於發車', { ...V.journey, legs: [{ ...V.journey.legs[0], conn: { ...V.journey.legs[0].conn, latest: TV + 2200 } }, V.journey.legs[1]] }],
    ['段的系統不是台鐵／高鐵', { ...V.journey, legs: [{ ...V.journey.legs[0], sys: 'trtc' }, V.journey.legs[1]] }],
  ];
  const badRes = [];
  for (const [name, j] of bad) {
    const r = await bind({ ...V, journey: j, token: tok(0xe1) });
    badRes.push(`${name}:${r.status}/${r.json.error}`);
  }
  ok('V1 壞的 journey 一律 400 bad_journey、不寫列', badRes.every(x => x.endsWith(':400/bad_journey'))
    && (await rowOf(tok(0xe1))) === null, badRes.join(' '));

  const tokV = tok(0xe2);
  const rv = await bind({ ...V, token: tokV, handoff: { sys: 'not-a-system' } });
  row = await rowOf(tokV);
  js = row && JSON.parse(row.journey_state);
  ok('V2 有 journey 就不收 handoff（壞的 handoff 也不擋）：journey_state 是 mode:trip、沒有 phase、carModel 照 bind',
    rv.status === 200 && !!js && js.mode === 'trip' && js.phase === undefined && js.carModel === 'EMU900' && row.last_conn === null,
    `${rv.status} ${row && row.journey_state && row.journey_state.slice(0, 80)}`);
  await DELAY_DB.prepare("UPDATE la_bindings SET last_conn='miss|0|0', last_idx=2, last_obs_idx=2 WHERE token=?").bind(tokV).run();
  const before = await rowOf(tokV);           // 前置：這一列真的存在、而且真的帶著舊判斷(不然下面是測一個全新 INSERT)
  now = TV - 200;
  const rv2 = await bind({ ...V, token: tokV });
  row = await rowOf(tokV);
  ok('V3 同一顆 token 重新 bind：last_conn 歸零（與 last_idx／last_obs_idx 同一個重設點）', !!before && before.last_conn === 'miss|0|0'
    && rv2.status === 200 && !!row && row.last_conn === null && row.last_idx === -1 && row.last_obs_idx === -1,
    `前=${before && before.last_conn} 後=${row && row.last_conn}/${row && row.last_idx}`);

  // ══ P：多了 21 個欄位（含 P4 公告五欄）、改搭與 alert 之後，payload 仍在 APNs 對 Live Activity 的 4096 bytes 以內 ══
  ok('P1 全程每一發 APNs body ≤ 4096 bytes（超過 APNs 直接拒收、整張卡停更）', pushCount > 0 && maxBodyBytes <= 4096,
    `pushes=${pushCount} max=${maxBodyBytes}`);
  console.log(`(payload 最大 ${maxBodyBytes} bytes，共 ${pushCount} 發)`);
} catch (error) {
  ok('測試流程完整執行', false, error && error.stack ? error.stack : String(error));
} finally {
  Date.now = realNow;
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
