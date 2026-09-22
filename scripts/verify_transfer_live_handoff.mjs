#!/usr/bin/env node
// 跨車轉乘的後端垂直切片：真 SQLite D1 替身＋真 laPushAll，網路只替換 TDX/APNs。
// 這支可直接掛 package.json／ship_web，不依賴未版控的 .dev.vars 或既有 .wrangler 狀態。
import { openTestDb } from './d1_local.mjs';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const realNow = Date.now;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let now = 1_810_000_000;
Date.now = () => now * 1000;

const calls = [];
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
globalThis.fetch = async (url, init = {}) => {
  const value = String(url);
  calls.push({ url: value, init });
  if (value.includes('openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'handoff-test', expires_in: 86400 }), { status: 200 });
  }
  if (value.includes('TrainLiveBoard')) {
    return new Response(JSON.stringify({
      UpdateTime: new Date(now * 1000).toISOString(),
      TrainLiveBoards: [{ TrainNo: '9909', DelayTime: 0, StationID: '1020', TrainStationStatus: 1 }],
    }), { status: 200 });
  }
  if (value.includes('/3/device/')) return new Response('{}', { status: 200 });
  throw new Error(`未預期的 fetch：${value}`);
};

try {
  const { DELAY_DB } = openTestDb();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n');
  const env = {
    DELAY_DB,
    APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`,
    APNS_KEY_ID: 'HANDOFF01', APNS_TEAM_ID: 'HANDOFFTEAM',
    TDX_CLIENT_ID: 'test', TDX_CLIENT_SECRET: 'test',
  };
  const worker = await import('../worker.js');
  const push = worker._la.laPushAll;
  const token = 'ab'.repeat(32);
  const target = {
    sys: 'thsr_sched', trainNo: '0841', kind: '高鐵', color: '#f05a28', terminus: '左營',
    transferStop: '板橋', waitUntil: now + 300,
    stops: [{ name: '板橋', at: now + 300 }, { name: '台北', at: now + 1000 }],
    staMap: {}, stopCodes: ['', ''],
  };
  const journey = { phase: 'planned', sourceIndex: 1, sourceAt: now, sourceCode: '1020', target };
  await DELAY_DB.prepare(
    'INSERT INTO la_bindings (token,uid,sys,train_no,stops,sta_map,stop_codes,journey_state,' +
    'last_idx,last_obs_idx,last_delay,last_notice,last_stopping,apns_env,fail_streak,bound_at,expire_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(token, 'handoff-user', 'tra_sched', '9909',
    JSON.stringify([{ name: '樹林', at: now - 600 }, { name: '板橋', at: now }, { name: '台北', at: now + 500 }]),
    JSON.stringify({ '1040': 0, '1020': 1, '1000': 2 }), JSON.stringify(['1040', '1020', '1000']),
    JSON.stringify(journey), 0, 0, 0, 0, 0, 'prod', 0, now - 1200, now + 7200).run();

  const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };
  const first = await push(env, ctx, 'https://handoff.invalid');
  const apns1 = calls.filter(c => c.url.includes('/3/device/'));
  const cs1 = apns1.length === 1 ? JSON.parse(apns1[0].init.body).aps['content-state'] : null;
  ok('板橋到站會送出一發 APNs 交棒', first.sent === 1 && apns1.length === 1,
    `sent=${first.sent} APNs=${apns1.length}`);
  ok('卡片身分由區間車切為高鐵 0841', !!cs1 && cs1.trainNoOverride === '0841'
    && cs1.sysOverride === 'thsr_sched' && cs1.kindOverride === '高鐵', JSON.stringify(cs1));
  ok('交棒後先顯示板橋等候發車倒數', !!cs1 && cs1.transferWaiting === true
    && cs1.nextStop === '板橋' && cs1.arrivalDate === now + 300, JSON.stringify(cs1));
  let row = await DELAY_DB.prepare('SELECT * FROM la_bindings WHERE token=?').bind(token).first();
  let saved = row && JSON.parse(row.journey_state || 'null');
  ok('推播成功後 D1 原子切為高鐵 active', !!row && row.sys === 'thsr_sched'
    && row.train_no === '0841' && saved && saved.phase === 'active',
    row ? `${row.sys}/${row.train_no}/${saved && saved.phase}` : '(查無列)');

  now += 400;
  calls.length = 0;
  const second = await push(env, ctx, 'https://handoff.invalid');
  const apns2 = calls.filter(c => c.url.includes('/3/device/'));
  const cs2 = apns2.length === 1 ? JSON.parse(apns2[0].init.body).aps['content-state'] : null;
  ok('高鐵發車後同一卡片前進到下一站台北', second.sent === 1 && !!cs2
    && cs2.nextStop === '台北' && cs2.transferWaiting === false && cs2.trainNoOverride === '0841',
    JSON.stringify(cs2));
  row = await DELAY_DB.prepare('SELECT * FROM la_bindings WHERE token=?').bind(token).first();
  ok('高鐵站序寫回 1，後續不會跳回來源區間車', !!row && row.sys === 'thsr_sched'
    && row.train_no === '0841' && row.last_idx === 1,
    row ? `${row.sys}/${row.train_no}/idx=${row.last_idx}` : '(查無列)');
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
