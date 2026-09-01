#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { _busTransfer } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = readFileSync(path.join(ROOT, 'data', 'bus_transfer_stations.json'));
const stationAssets = new Map([
  ['/data/bus-transfer/TRA-4220.json', readFileSync(path.join(ROOT, 'data', 'bus-transfer', 'TRA-4220.json'))],
  ['/data/bus-transfer/TRA-1150.json', readFileSync(path.join(ROOT, 'data', 'bus-transfer', 'TRA-1150.json'))],
]);
const workerSource = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const coreSource = readFileSync(path.join(ROOT, 'scripts', 'bus_transfer_core.mjs'), 'utf8');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const edge = new Map();
let assetCalls = 0;
const assetPaths = [];
let authCalls = 0;
const n1Calls = [];
const dynamicCalls = [];
const usageRows = [];
let selectedTargetSequence = 20;
let failA2 = false;
const nowIso = () => new Date(Date.now() - 10_000).toISOString();

globalThis.caches = {
  default: {
    async match(request) { return edge.has(request.url) ? edge.get(request.url).clone() : undefined; },
    async put(request, response) { edge.set(request.url, response.clone()); },
  },
};
globalThis.fetch = async requestLike => {
  const url = new URL(requestLike instanceof URL ? requestLike.href : (typeof requestLike === 'string' ? requestLike : requestLike.url));
  if (url.hostname === 'auth.test') {
    authCalls += 1;
    return Response.json({ access_token: 'fixture-token', expires_in: 3600 });
  }
  if (url.hostname === 'bus.test') {
    const filter = url.searchParams.get('$filter') || '';
    if (url.pathname.startsWith('/n1/')) {
      n1Calls.push(url);
      if (url.pathname.endsWith('/City/Tainan')) {
      assert(filter.includes("StopUID eq 'TNN33884'"), '臺南 N1 filter 沒包含試點站牌');
      assert(!filter.includes('TPE15315'), '臺南 N1 filter 混入臺北站牌');
      return Response.json([
        {
          RouteUID: 'TNN2102', RouteName: { Zh_tw: '102' }, SubRouteUID: 'TNN210201', SubRouteName: { Zh_tw: '102路 崑山科大→安平' },
          Direction: 0, StopUID: 'TNN33884', PlateNumb: 'TNN-001', EstimateTime: 180, StopStatus: 0, SrcUpdateTime: nowIso(),
        },
        {
          RouteUID: 'TNN00002', RouteName: { Zh_tw: '2' }, SubRouteUID: 'TNN000020', Direction: 0,
          StopUID: 'TNN33884', EstimateTime: 90, StopStatus: 0, SrcUpdateTime: nowIso(),
        },
      ]);
      }
      if (url.pathname.endsWith('/InterCity')) return Response.json([]);
    }
    if (url.pathname.startsWith('/live/')) {
      dynamicCalls.push(url);
      assert(filter.includes("RouteUID eq 'TNN2102'"));
      assert(filter.includes("SubRouteUID eq 'TNN210201'"));
      assert(filter.includes('Direction eq 0'));
      if (url.pathname.includes('/RealTimeByFrequency/')) return Response.json([{
        PlateNumb: 'TNN-001', RouteUID: 'TNN2102', SubRouteUID: 'TNN210201', Direction: 0,
        BusPosition: { PositionLat: 22.99, PositionLon: 120.21 }, DutyStatus: 1, BusStatus: 0, GPSTime: nowIso(),
      }]);
      if (url.pathname.includes('/RealTimeNearStop/')) {
        if (failA2) return Response.json({ error: 'fixture A2 unavailable' }, { status: 503 });
        return Response.json([{
          PlateNumb: 'TNN-001', RouteUID: 'TNN2102', SubRouteUID: 'TNN210201', Direction: 0,
          StopUID: 'TNN-PREV', StopName: { Zh_tw: '前兩站' }, StopSequence: selectedTargetSequence - 2,
          TripStartTimeType: 0, TripStartTime: nowIso(), DutyStatus: 1, BusStatus: 0, GPSTime: nowIso(),
        }]);
      }
    }
    return Response.json([], { status: 404 });
  }
  throw new Error(`未預期 outbound fetch：${url}`);
};

const env = {
  TDX_CLIENT_ID: 'fixture-id',
  TDX_CLIENT_SECRET: 'fixture-secret',
  TDX_AUTH_URL_OVERRIDE: 'https://auth.test/token',
  BUS_N1_BASE_URL_OVERRIDE: 'https://bus.test/n1',
  BUS_API_BASE_URL_OVERRIDE: 'https://bus.test/live',
  BUS_TRANSFER_DEBUG: true,
  BUS_USAGE: { writeDataPoint(row) { usageRows.push(row); } },
  ASSETS: {
    async fetch(request) {
      assetCalls += 1;
      const url = new URL(request.url);
      assetPaths.push(url.pathname);
      if (url.pathname === '/data/bus_transfer_stations.json') return new Response(manifest, { headers: { 'content-type': 'application/json' } });
      if (stationAssets.has(url.pathname)) return new Response(stationAssets.get(url.pathname), { headers: { 'content-type': 'application/json' } });
      return new Response('not found', { status: 404 });
    },
  },
};

await check('N1 URL 只接受索引內安全 StopUID，並明確 select 所需欄位', () => {
  const url = _busTransfer.busN1Url(env, 'City/Tainan', ['TNN33884', 'TNN16128']);
  assert.equal(url.origin, 'https://bus.test');
  assert(url.searchParams.get('$filter').includes("StopUID eq 'TNN33884'"));
  assert(url.searchParams.get('$select').includes('SrcUpdateTime'));
  assert.throws(() => _busTransfer.busN1Url(env, 'City/Tainan', ["x' or 1 eq 1"]), /invalid StopUID/);
});

await check('不支援的站回 400，且不會打 TDX', async () => {
  _busTransfer.resetBusTransferCaches();
  const before = n1Calls.length;
  const response = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A9999'), env, {});
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.coverage, 'all_active_tra_stations');
  assert.equal(body.stationCount, 239);
  assert.equal(n1Calls.length, before);
});

await check('600 公尺內無站牌的營運站照實回空結果，不取 token、不打 TDX', async () => {
  edge.clear();
  _busTransfer.resetBusTransferCaches();
  const n1Before = n1Calls.length;
  const authBefore = authCalls;
  const response = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A1150'), env, {});
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.live.state, 'no_nearby_stops');
  assert.equal(body.live.cache, 'not_applicable');
  assert.equal(body.nearbyStopCount, 0);
  assert.deepEqual(body.arrivals, []);
  assert.equal(n1Calls.length, n1Before);
  assert.equal(authCalls, authBefore);
});

await check('臺南主動查詢只打 City＋InterCity N1，102 進來、退役 2 被 current-static gate 擋掉', async () => {
  edge.clear();
  usageRows.length = 0;
  _busTransfer.resetBusTransferCaches();
  const response = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A4220'), env, {});
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.trigger, 'user_open_only');
  assert.equal(body.polling, false);
  assert.equal(body.pilotOnly, false);
  assert.equal(body.coverage, 'all_active_tra_stations');
  assert.equal(body.live.state, 'live');
  assert.equal(body.live.scheduleFallback, 'not_implemented');
  assert.equal(body.arrivals.length, 1);
  assert.equal(body.arrivals[0].routeName, '102');
  assert.equal(body.arrivals[0].access.includesIndoor, false);
  assert.equal(body.arrivals[0].vehicleBinding.state, 'not_loaded');
  assert.equal(body.arrivals[0].occupancy.state, 'not_provided');
  assert.equal(body.arrivals[0].vehicleBinding.plateHint, 'TNN-001');
  assert(Number.isFinite(body.arrivals[0].live.ageSec));
  assert(body.rejected.some(row => row.routeName === '2' && row.reason === 'route_not_in_current_static_index'));
  assert.equal(n1Calls.length, 2);
  assert.equal(authCalls, 1);
  assert.equal(usageRows.length, 2);
  assert(usageRows.every(row => row.blobs[0] === 'N1' && row.doubles[0] === 1));
  selectedTargetSequence = body.arrivals[0].stopSequence;
});

await check('20 秒 raw cache 命中時不再打 TDX，但每次回應仍重新計算資料 age', async () => {
  const before = n1Calls.length;
  const usageBefore = usageRows.length;
  const response = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A4220'), env, {});
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.live.cache, 'hit');
  assert.equal(n1Calls.length, before);
  assert.equal(usageRows.length, usageBefore);
  assert(Number.isFinite(body.arrivals[0].live.ageSec));
});

await check('端點只收 GET／HEAD，POST 在任何 TDX 呼叫前被既有唯讀閘門擋下', async () => {
  const before = n1Calls.length;
  const response = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A4220', { method: 'POST' }), env, {});
  assert.equal(response.status, 405);
  assert.equal(n1Calls.length, before);
});

await check('點一路公車才查 A1＋A2；N1 車牌經同路線重新驗證後才標 exact，並算出還差兩站', async () => {
  dynamicCalls.length = 0;
  const stationResponse = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A4220'), env, {});
  const stationBody = await stationResponse.json();
  const selected = stationBody.arrivals.find(row => row.routeName === '102');
  assert(selected);
  selectedTargetSequence = selected.stopSequence;
  const url = new URL('https://railisland.tw/api/bus-leg-live');
  url.searchParams.set('station', 'TRA:4220');
  url.searchParams.set('arrival', selected.key);
  const usageBefore = usageRows.length;
  const response = await worker.fetch(new Request(url), env, {});
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.trigger, 'user_route_open_only');
  assert.equal(body.polling, false);
  assert.deepEqual(body.binding, { state: 'exact_n1_plate', plate: 'TNN-001' });
  assert.equal(body.vehicles.length, 1);
  assert.equal(body.vehicles[0].progress.stopsBefore, 2);
  assert.equal(body.vehicles[0].occupancy.state, 'not_provided');
  assert.deepEqual(body.live.sources.map(source => source.kind), ['A1', 'A2']);
  assert.equal(dynamicCalls.length, 2);
  assert.equal(usageRows.length, usageBefore + 2);
  assert.deepEqual(usageRows.slice(-2).map(row => row.blobs[0]).sort(), ['A1', 'A2']);

  const again = await worker.fetch(new Request(url), env, {});
  const againBody = await again.json();
  assert.equal(again.status, 200);
  assert.equal(againBody.live.cache, 'hit');
  assert.equal(dynamicCalls.length, 2, 'leg raw cache 命中仍重打 A1/A2');
});

await check('A2 暫時失敗時仍回 A1 公車位置，進度與整體狀態如實降級', async () => {
  edge.clear();
  _busTransfer.resetBusTransferCaches();
  dynamicCalls.length = 0;
  failA2 = true;
  try {
    const stationResponse = await worker.fetch(new Request('https://railisland.tw/api/bus-transfer?station=TRA%3A4220'), env, {});
    const stationBody = await stationResponse.json();
    const selected = stationBody.arrivals.find(row => row.routeName === '102');
    selectedTargetSequence = selected.stopSequence;
    const url = new URL('https://railisland.tw/api/bus-leg-live');
    url.searchParams.set('station', 'TRA:4220');
    url.searchParams.set('arrival', selected.key);
    const response = await worker.fetch(new Request(url), env, {});
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.live.state, 'partial');
    assert.equal(body.vehicles.length, 1);
    assert.equal(body.vehicles[0].progress.state, 'unknown');
    assert.equal(body.live.sources.find(source => source.kind === 'A2').state, 'unavailable');
    assert.equal(dynamicCalls.length, 2);
    assert(usageRows.slice(-2).some(row => row.blobs[0] === 'A2' && row.blobs[2] === '503'));
  } finally {
    failA2 = false;
  }
});

await check('scheduled 與核心都沒有接入 bus transfer 輪詢／timer', () => {
  const scheduled = /async scheduled\([\s\S]*?\n  async fetch\(/.exec(workerSource)?.[0] || '';
  assert(scheduled, '找不到 scheduled handler');
  assert.doesNotMatch(scheduled, /busTransfer|fetchBusN1|busLegLive|fetchBusDynamic|bus-transfer|bus-leg-live/);
  assert.doesNotMatch(coreSource, /setInterval\s*\(|setTimeout\s*\(/);
  assert.match(workerSource, /else if \(url\.pathname === '\/api\/bus-transfer'\) res = await busTransfer\(request, env\);/);
});

assert(assetCalls >= 1, 'fixture asset 從未讀取');
assert(assetPaths.includes('/data/bus_transfer_stations.json'), '未讀取 manifest');
assert(assetPaths.includes('/data/bus-transfer/TRA-4220.json'), '未按站讀取臺南索引');
assert(!assetPaths.includes('/data/bus-transfer/TRA-1000.json'), '查臺南時不應載入臺北索引');
globalThis.fetch = realFetch;
if (realCaches === undefined) delete globalThis.caches;
else globalThis.caches = realCaches;

console.log(`RESULT failures=${failures} status=${failures ? 'RED' : 'GREEN'}`);
process.exit(failures ? 1 : 0);
