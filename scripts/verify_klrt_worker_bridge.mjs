#!/usr/bin/env node
// /api/metro-live 的 KLRT 欄位契約。全程 mock Cache API、OAuth 與 TDX，零真實網路。
// 這一層刻意驗行為，不只掃原始碼：拿掉 KLRT operator、把 dir 寫成空字串、或讓欄位
// 洩到 KRTC，都會在這裡具名失敗。
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const calls = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async input => {
  const url = String(input);
  calls.push(url);
  if (url.includes('/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'fixture-token', expires_in: 3600 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('/LiveBoard/KRTC?')) {
    return new Response(JSON.stringify([{ LineID: 'R', StationName: { Zh_tw: '美麗島' },
      DestinationStationName: { Zh_tw: '岡山車站' }, EstimateTime: 2, ServiceStatus: 0,
      TripHeadSign: { Zh_tw: '不可外流' }, SrcUpdateTime: '不可外流',
    }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/LiveBoard/KLRT?')) {
    return new Response(JSON.stringify([
      { LineID: 'C', StationName: { Zh_tw: '籬仔內' }, DestinationStationName: { Zh_tw: '籬仔內' },
        EstimateTime: 1, ServiceStatus: 1, TripHeadSign: { Zh_tw: '順行' }, SrcUpdateTime: '2026-09-28T12:34:56+08:00' },
      { LineID: 'C', StationName: { Zh_tw: '凱旋瑞田' }, DestinationStationName: { Zh_tw: '籬仔內' },
        EstimateTime: 3, ServiceStatus: 0, TripHeadSign: '逆行', SrcUpdateTime: '2026-09-28T12:35:01+08:00' },
      { LineID: 'C', StationName: { Zh_tw: '前鎮之星' }, DestinationStationName: { Zh_tw: '籬仔內' },
        EstimateTime: 5, ServiceStatus: 0 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('未預期的網路呼叫：' + url);
};

try {
  const worker = (await import('../worker.js?klrt-worker-contract')).default;
  const response = await worker.fetch(new Request('https://railisland.test/api/metro-live?sys=krtc'),
    { TDX_CLIENT_ID: 'fixture-id', TDX_CLIENT_SECRET: 'fixture-secret' }, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert(Array.isArray(body.rows), 'metro-live 必須回 rows');

  const krtc = body.rows.filter(row => row.op === 'KRTC');
  const klrt = body.rows.filter(row => row.op === 'KLRT');
  assert.equal(krtc.length, 1, 'KRTC operator 不可因 KLRT 欄位改動消失');
  assert.equal(klrt.length, 3, 'krtc 聚合端點必須仍抓 KLRT operator');
  assert.equal(Object.hasOwn(krtc[0], 'dir'), false, 'KLRT 專用 dir 不可改變 KRTC payload shape');
  assert.equal(Object.hasOwn(krtc[0], 'su'), false, 'KLRT 專用 su 不可改變 KRTC payload shape');
  assert.deepEqual(klrt.map(row => row.dir), ['順行', '逆行', ''], 'dir 必須支援多語物件、scalar 與缺值');
  assert.deepEqual(klrt.map(row => row.su ?? null),
    ['2026-09-28T12:34:56+08:00', '2026-09-28T12:35:01+08:00', null], 'su 必須原樣轉手且允許缺值');

  const krtcUrl = calls.find(url => url.includes('/LiveBoard/KRTC?'));
  const klrtUrl = calls.find(url => url.includes('/LiveBoard/KLRT?'));
  assert(krtcUrl && klrtUrl, '必須同時呼叫 KRTC 與 KLRT LiveBoard');
  assert.equal(decodeURIComponent(krtcUrl).includes('TripHeadSign'), false, 'KRTC $select 不可多取 KLRT 專用欄位');
  assert(decodeURIComponent(klrtUrl).includes('TripHeadSign,SrcUpdateTime'), 'KLRT $select 必須包含方向與來源時刻');
  console.log('PASS Worker KLRT dir/su 行為契約：operator、object/scalar/missing、KRTC shape、$select');
} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
}
