#!/usr/bin/env node
// 跟這趟的「下車前 N 分」提醒（行程導航第二棒 B 節，通行證）後端驗收：真 SQLite D1 替身＋真 laBind／laPushAll，
// 網路只替換 TDX／APNs。骨架照 scripts/verify_la_trip.mjs，不依賴 .dev.vars、wrangler 或 .wrangler 狀態。
//
// 驗的事：
//   R1 準點：預估到站前 N 分那一輪才推 transfer 提醒（前一輪沒有）、loc-key／loc-args 逐字、有聲音、priority 10；
//      同一段只推一次；換段後最後一段到站前 N 分推 arrive；remindLead 換段後還在。
//   R2 誤點 9 分：推的時刻跟著延後 9 分（準點該推的那一輪不推），到站時刻寫延後的；半分鐘那一輪不帶。
//   R3 沒帶 remindLead（或值不合）：bind 照收、一律不推提醒。
//   R4 過了預估到站才綁（App 晚綁）：不補送；到站前才綁而且已在 N 分內：馬上送。
//   R5 跟「可能接不上」同一輪：只送接不上，last_conn 不記 R；下一輪補送提醒。
//   R6 晚過界線、有趕得上的改搭：提醒寫的是到站時會交棒的改搭那班。
//
// 判準獨立性（心得 29）：期望值是字面量（時刻用 2026-11-18 台北時間手算），不呼叫 worker 的函式產生期望。
// 時間只往前走：traLive 的 mem 快取以 Date.now() 差值判過期，時鐘倒退會讓上一組的看板被當成新的。
import { openTestDb } from './d1_local.mjs';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail && !pass ? ` — ${detail}` : ''}`);
};

const realNow = Date.now;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let now = 0;
Date.now = () => now * 1000;

let board = [];
const calls = [];
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
globalThis.fetch = async (url, init = {}) => {
  const value = String(url);
  if (value.includes('openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'la-remind-test', expires_in: 86400 }), { status: 200 });
  }
  if (value.includes('TrainLiveBoard')) {
    return new Response(JSON.stringify({ UpdateTime: new Date(now * 1000).toISOString(), TrainLiveBoards: board }), { status: 200 });
  }
  if (value.includes('/3/device/')) {
    calls.push({ url: value, headers: init.headers || {}, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  }
  throw new Error(`未預期的 fetch：${value}`);
};

// 兩段行程（T＝這一組的基準秒，取台北整點，方便手算 HH:mm）：
//   第 1 段 台鐵區間 1201 A→B→C→D，在 C站 下車（endIndex 2、T+1200 到）。
//   第 2 段 高鐵 0201 C高鐵 T+1200+gap 開 → E高鐵 T+1200+gap+1800 到（最後一段）。接續：步行 300 秒、界線＝發車前 300 秒。
//   rebook（選填）：高鐵 0203 C高鐵 T+3900 開 → E高鐵 T+5700 到，界線 T+3600。
// 接續裕度（分）＝floor((gap − 誤點秒)/60) − 5 − 2：gap 900 ⇒ 8 − 誤點分（9 分＝−1 可能接不上）；gap 1800 ⇒ 23 − 誤點分。
function trip(T, gap, remindLead, withRebook = false) {
  const dep = T + 1200 + gap;
  const hsr0203 = {
    trainNo: '0203', sys: 'thsr_sched', kind: '高鐵', color: '#E85D0D', terminus: 'E高鐵', transferStop: 'C高鐵',
    waitUntil: T + 3900, carModel: null,
    stops: [{ name: 'C高鐵', at: T + 3900, dep: T + 3900 }, { name: 'E高鐵', at: T + 5700, dep: T + 5760 }],
    staMap: {}, stopCodes: ['2001', '2002'], endIndex: 1, endAt: T + 5700, endCode: '2002',
    conn: { sys: 'thsr_sched', no: '0203', kind: '高鐵', dep: T + 3900, walkSec: 300, latest: T + 3600 },
  };
  const hsr0201 = {
    trainNo: '0201', sys: 'thsr_sched', kind: '高鐵', color: '#E85D0D', terminus: 'E高鐵', transferStop: 'C高鐵',
    waitUntil: dep, carModel: null,
    stops: [{ name: 'C高鐵', at: dep, dep }, { name: 'E高鐵', at: dep + 1800, dep: dep + 1860 }],
    staMap: {}, stopCodes: ['2001', '2002'], endIndex: 1, endAt: dep + 1800, endCode: '2002',
    conn: { sys: 'thsr_sched', no: '0201', kind: '高鐵', dep, walkSec: 300, latest: dep - 300 },
    ...(withRebook ? { rebook: [{ latest: T + 3600, arrive: T + 5700, legs: [hsr0203] }] } : {}),
  };
  const journey = { legIndex: 0, legCount: 2, endIndex: 2, endAt: T + 1200, endCode: '1003', legs: [hsr0201] };
  if (remindLead !== undefined) journey.remindLead = remindLead;
  return {
    sys: 'tra_sched', trainNo: '1201', kind: '區間', carModel: 'EMU900',
    stops: [{ name: 'A站', at: T, dep: T }, { name: 'B站', at: T + 600, dep: T + 630 },
      { name: 'C站', at: T + 1200, dep: T + 1260 }, { name: 'D站', at: T + 1800, dep: T + 1800 }],
    staMap: { 1001: 1, 1002: 2, 1003: 3, 1004: 3 }, stopCodes: ['1001', '1002', '1003', '1004'],
    journey,
  };
}
const tra1201 = (sta, status, delayMin) => [{ TrainNo: '1201', StationID: sta, TrainStationStatus: status, DelayTime: delayMin }];
const at = hm => Date.parse(`2026-11-18T${hm}:00+08:00`) / 1000;

try {
  const { DELAY_DB } = openTestDb();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n');
  const env = {
    DELAY_DB,
    APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`,
    APNS_KEY_ID: 'LAREMIND1', APNS_TEAM_ID: 'LAREMINDTM',
    TDX_CLIENT_ID: 'test', TDX_CLIENT_SECRET: 'test',
    LA_TEST_BEARER: 'la-remind-test',
  };
  const worker = await import('../worker.js');
  const { laPushAll, laBind } = worker._la;
  const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

  const bind = async (body) => {
    const res = await laBind(new Request('https://la-remind.invalid/api/la/bind', {
      method: 'POST', headers: { Authorization: 'Bearer la-remind-test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);
    return { status: res.status, json: await res.json() };
  };
  const tick = async (nextBoard) => {
    board = nextBoard;
    calls.length = 0;
    const res = await laPushAll(env, ctx, 'https://la-remind.invalid');
    return { res, pushes: calls.map(c => ({ token: c.url.split('/3/device/')[1], aps: c.body.aps, cs: c.body.aps['content-state'],
      priority: c.headers['apns-priority'] })) };
  };
  const rowOf = token => DELAY_DB.prepare('SELECT * FROM la_bindings WHERE token=?').bind(token).first();
  const reset = () => DELAY_DB.prepare('DELETE FROM la_bindings').run();
  const tok = n => (n.toString(16).padStart(2, '0')).repeat(32);
  const show = t => t.pushes.length ? t.pushes.map(p => JSON.stringify({ alert: p.aps.alert || null, pr: p.priority, conn: p.cs.conn,
    leg: p.cs.legIndex, next: p.cs.nextStop })).join(' ') : '(沒有推播)';
  const alertOf = t => (t.pushes[0] && t.pushes[0].aps.alert) || null;
  const isRemind = a => !!a && a.title && a.title['loc-key'] === '快到%@了';
  // 提醒 alert 逐字：title、body 的 loc-key 與 loc-args、聲音；priority 10。
  const remindIs = (t, station, bodyKey, args) => {
    const p = t.pushes[0], a = p && p.aps.alert;
    return t.pushes.length === 1 && !!a && JSON.stringify(a) === JSON.stringify({
      title: { 'loc-key': '快到%@了', 'loc-args': [station] },
      body: { 'loc-key': bodyKey, 'loc-args': args },
      sound: 'default',
    }) && p.priority === '10';
  };
  const TRANSFER = '約 %@ 到。下車後搭 %@ %@', ARRIVE = '約 %@ 到，終點';

  // ══ R1：準點、lead 5 ═══════════════════════════════════════════════════════════
  // T＝09:00。C站 09:20 到 ⇒ 09:15 推 transfer；0201 09:35 開（gap 900）、E高鐵 10:05 到 ⇒ 10:00 推 arrive。
  {
    await reset();
    const T = at('09:00'), tk = tok(0x71);
    now = T - 300;
    const b = await bind({ ...trip(T, 900, 5), token: tk });
    const row0 = await rowOf(tk);
    ok('R1a bind 收 remindLead 5、存進 journey_state', b.status === 200 && !!row0 && JSON.parse(row0.journey_state).remindLead === 5,
      `${b.status} ${row0 && row0.journey_state && row0.journey_state.slice(0, 200)}`);
    now = T + 840;                                    // 09:14，B→C 行駛中，離預估到站 6 分
    let t = await tick(tra1201('1002', 2, 0));
    ok('R1b 預估到站前 6 分（09:14）：照常推一發、沒有提醒', t.pushes.length === 1 && !alertOf(t) && t.pushes[0].priority === '5', show(t));
    now = T + 900;                                    // 09:15＝09:20 − 5 分
    t = await tick(tra1201('1002', 2, 0));
    ok('R1c 預估到站前 5 分（09:15）：推 transfer 提醒「快到C站了」／「約 09:20 到。下車後搭 09:35 高鐵 0201」、有聲音、priority 10',
      remindIs(t, 'C站', TRANSFER, ['09:20', '09:35', '高鐵 0201']), show(t));
    let row = await rowOf(tk);
    ok('R1d last_conn 記 R0（第 0 段響過）：ok|-1|0#R0~', !!row && row.last_conn === 'ok|-1|0#R0~', row && row.last_conn);
    now = T + 960;                                    // 09:16
    t = await tick(tra1201('1002', 2, 0));
    ok('R1e 下一輪（09:16，仍在 5 分內）：照常推、不再響', t.pushes.length === 1 && !alertOf(t) && t.pushes[0].priority === '5', show(t));
    now = T + 1020;                                   // 09:17 誤點變 1 分（預估 09:21，仍在窗內）
    t = await tick(tra1201('1002', 2, 1));
    ok('R1f 誤點變了（09:17、晚 1 分）：同一段只推一次，不再響', t.pushes.length === 1 && !alertOf(t), show(t));
    now = T + 1260;                                   // 09:21 到 C站 ⇒ 換第二段高鐵 0201（最後一段）
    t = await tick(tra1201('1003', 1, 1));
    ok('R1g 換段到高鐵 0201（第 2／2 段）：這一發不響（10:05 到還早）', t.pushes.length === 1 && t.pushes[0].cs.trainNoOverride === '0201'
      && t.pushes[0].cs.legIndex === 1 && !alertOf(t), show(t));
    row = await rowOf(tk);
    const js = row && JSON.parse(row.journey_state);
    ok('R1h 換段後 journey_state 仍帶 remindLead 5；last_conn 的 R0 掉了（NULL）', !!js && js.remindLead === 5 && row.last_conn === null,
      row && `${js && js.remindLead} ${row.last_conn}`);
    now = at('09:59');
    t = await tick([]);
    ok('R1i 最後一段 09:59（離 10:05 到 6 分）：不響', !t.pushes.some(p => isRemind(p.aps.alert)), show(t));
    now = at('10:00');
    t = await tick([]);
    ok('R1j 最後一段 10:00：推 arrive 提醒「快到E高鐵了」／「約 10:05 到，終點」', remindIs(t, 'E高鐵', ARRIVE, ['10:05']), show(t));
    row = await rowOf(tk);
    ok('R1k last_conn＝-#R1~（沒有接續、第 1 段響過）', !!row && row.last_conn === '-#R1~', row && row.last_conn);
    now = at('10:01');
    t = await tick([]);
    ok('R1l 10:01：不再響', !t.pushes.some(p => isRemind(p.aps.alert)), show(t));
  }

  // ══ R2：誤點 9 分、lead 5、gap 1800（接得上，不會被接不上擠掉）═══════════════════════
  // T＝11:00。C站 表定 11:20、晚 9 分 ⇒ 預估 11:29 ⇒ 11:24 才推（準點該推的 11:15 不推）；0201 11:50 開。
  {
    await reset();
    const T = at('11:00'), tk = tok(0x72);
    now = T - 300;
    await bind({ ...trip(T, 1800, 5), token: tk });
    now = T + 360;
    let t = await tick(tra1201('1001', 2, 9));
    ok('R2a 11:06 誤點 9 分：接得上（23−9＝14）、沒有提醒', t.pushes.length === 1 && t.pushes[0].cs.conn === 'ok'
      && t.pushes[0].cs.connSlack === 14 && !alertOf(t), show(t));
    now = T + 900;                                    // 11:15＝準點時該推的那一刻
    t = await tick(tra1201('1002', 2, 9));
    ok('R2b 11:15（準點會推的時刻）：不推提醒', !t.pushes.some(p => isRemind(p.aps.alert)), show(t));
    now = T + 1380;                                   // 11:23
    t = await tick(tra1201('1002', 2, 9));
    ok('R2c 11:23（預估 11:29 前 6 分）：不推提醒', !t.pushes.some(p => isRemind(p.aps.alert)), show(t));
    const handoff = t.res.handoff;
    now = T + 1410;                                   // 11:23:30 半分鐘那一輪（還沒到 11:24）
    calls.length = 0;
    await laPushAll(env, ctx, 'https://la-remind.invalid', { ...handoff, deadlineMs: Date.now() + 30000 });
    ok('R2d 半分鐘那一輪不帶任何 alert', calls.every(c => !c.body.aps.alert), calls.map(c => JSON.stringify(c.body.aps.alert || null)).join(' '));
    now = T + 1440;                                   // 11:24＝11:29 − 5 分
    t = await tick(tra1201('1002', 2, 9));
    ok('R2e 11:24：推提醒，到站時刻寫延後的「約 11:29 到。下車後搭 11:50 高鐵 0201」',
      remindIs(t, 'C站', TRANSFER, ['11:29', '11:50', '高鐵 0201']), show(t));
  }

  // ══ R3：沒帶 remindLead、或值不合 ⇒ bind 照收、不推 ══════════════════════════════════
  // 同一個 uid 最多留 3 列（laBind 的 per-uid 上限，最早綁的先刪）：五種都驗存法，推播只看最後綁的三列（沒帶、2、"5"）。
  {
    await reset();
    const T = at('13:00');
    now = T - 300;
    const cases = [['0', 0], ['5.5', 5.5], ['沒帶', undefined], ['2（不在 1／3／5／10）', 2], ['字串 "5"', '5']];
    const toks = [];
    const bres = [];
    for (const [i, [name, lead]] of cases.entries()) {
      const tk = tok(0x80 + i);
      toks.push(tk);
      const r = await bind({ ...trip(T, 900, lead), token: tk });
      const row = await rowOf(tk);
      bres.push(`${name}:${r.status}/${row && 'remindLead' in JSON.parse(row.journey_state) ? 'has' : 'none'}`);
    }
    ok('R3a 五種都 200、journey_state 沒有 remindLead（舊 App 存法不變）', bres.every(x => x.endsWith(':200/none')), bres.join(' '));
    now = T + 900;                                    // 13:15＝lead 5 時該推的那一刻
    let t = await tick(tra1201('1002', 2, 0));
    ok('R3b 13:15 留下的三列（沒帶、2、"5"）都照常推、沒有任何 alert', t.pushes.length === 3 && t.pushes.every(p => !p.aps.alert && p.priority === '5'), show(t));
    now = T + 1140;                                   // 13:19 連 lead 1 的窗也進來了
    t = await tick(tra1201('1002', 2, 0));
    ok('R3c 13:19 仍然沒有 alert', t.pushes.length === 3 && t.pushes.every(p => !p.aps.alert), show(t));
    const rows = await Promise.all(toks.slice(2).map(rowOf));
    ok('R3d last_conn 照 P3 原格式（ok|-1|0，沒有 #R）', rows.every(r => r && r.last_conn === 'ok|-1|0'), rows.map(r => r && r.last_conn).join(','));
  }

  // ══ R4：晚綁 ═══════════════════════════════════════════════════════════════════
  // T＝15:00，C站 15:20 到。
  {
    await reset();
    const T = at('15:00'), tLate = tok(0x91), tIn = tok(0x92);
    now = T + 1100;                                   // 15:18:20，離到站 1 分 40 秒、lead 10 的窗內 ⇒ 第一發就響
    await bind({ ...trip(T, 900, 10), token: tIn });
    let t = await tick(tra1201('1002', 2, 0));
    ok('R4a 到站前才綁（15:18:20、lead 10，已在窗內）：第一發就推提醒', remindIs(t, 'C站', TRANSFER, ['15:20', '15:35', '高鐵 0201']), show(t));
    await reset();
    now = T + 1230;                                   // 15:20:30，已過預估到站 15:20，台鐵寬限 3 分內還沒換段
    await bind({ ...trip(T, 900, 10), token: tLate });
    t = await tick(tra1201('1002', 2, 0));
    ok('R4b 過了預估到站才綁（15:20:30）：照推卡片、不補送提醒', t.pushes.length === 1 && !alertOf(t) && t.pushes[0].cs.legIndex === 0, show(t));
    const row = await rowOf(tLate);
    ok('R4c last_conn 沒記 R', !!row && row.last_conn === 'ok|-1|0', row && row.last_conn);
  }

  // ══ R5：跟「可能接不上」同一輪 ════════════════════════════════════════════════════
  // T＝17:00，gap 900、lead 10。誤點 9 分 ⇒ 裕度 −1 可能接不上、預估 17:29 ⇒ 17:19 起該響提醒。
  {
    await reset();
    const T = at('17:00'), tk = tok(0xa1);
    now = T - 300;
    await bind({ ...trip(T, 900, 10), token: tk });
    now = T + 360;
    let t = await tick(tra1201('1001', 2, 0));
    ok('R5a 17:06 準點：接得上、沒有 alert', t.pushes.length === 1 && t.pushes[0].cs.conn === 'ok' && !alertOf(t), show(t));
    now = T + 1140;                                   // 17:19：第一次看到誤點 9 分 ⇒ 第一次接不上＋提醒也到窗
    t = await tick(tra1201('1002', 2, 9));
    const a = alertOf(t);
    ok('R5b 17:19 同一輪：只帶「這趟可能接不上」（請留意轉乘時間），不是提醒', t.pushes.length === 1 && t.pushes[0].cs.conn === 'miss'
      && !!a && a.title['loc-key'] === '這趟可能接不上' && a.body['loc-key'] === '請留意轉乘時間' && t.pushes[0].priority === '10', show(t));
    let row = await rowOf(tk);
    ok('R5c last_conn 沒記 R（被擠掉的提醒還沒響）：miss|-1|0', !!row && row.last_conn === 'miss|-1|0', row && row.last_conn);
    now = T + 1200;                                   // 17:20 下一輪
    t = await tick(tra1201('1002', 2, 9));
    ok('R5d 17:20 下一輪補送提醒「約 17:29 到。下車後搭 17:35 高鐵 0201」、接不上不再響',
      remindIs(t, 'C站', TRANSFER, ['17:29', '17:35', '高鐵 0201']), show(t));
    row = await rowOf(tk);
    ok('R5e last_conn＝miss|-1|0#R0~', !!row && row.last_conn === 'miss|-1|0#R0~', row && row.last_conn);
    now = T + 1260;
    t = await tick(tra1201('1002', 2, 9));
    ok('R5f 17:21：什麼都不再響', t.pushes.every(p => !p.aps.alert), show(t));
  }

  // ══ R6：晚過界線、有趕得上的改搭 ⇒ 提醒寫改搭那班 ═══════════════════════════════════
  // T＝19:00，gap 900（界線 19:30）、lead 10、改搭高鐵 0203 20:05 開（界線 20:00）。誤點 11 分 ⇒ 預估 19:31 > 19:30 ⇒ 到站會換 0203。
  {
    await reset();
    const T = at('19:00'), tk = tok(0xb1);
    now = T - 300;
    await bind({ ...trip(T, 900, 10, true), token: tk });
    now = T + 360;
    let t = await tick(tra1201('1001', 2, 11));
    ok('R6a 19:06 誤點 11 分：第一次接不上那發是接不上的 alert（改搭建議）', !!alertOf(t) && alertOf(t).title['loc-key'] === '這趟可能接不上'
      && alertOf(t).body['loc-key'] === '鎖屏卡上有改搭建議' && t.pushes[0].cs.rebookNo === '0203', show(t));
    now = T + 1260;                                   // 19:21＝19:31 − 10 分
    t = await tick(tra1201('1002', 2, 11));
    ok('R6b 19:21：提醒寫改搭那班「約 19:31 到。下車後搭 20:05 高鐵 0203」',
      remindIs(t, 'C站', TRANSFER, ['19:31', '20:05', '高鐵 0203']), show(t));
  }
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
