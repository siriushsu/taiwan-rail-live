#!/usr/bin/env node
// /api/bus-spot（景點最後一段，native AI 排行程 2026-11-23）的 fixture 測試：不打真的 TDX。
// TDX 回應用 scripts/verify_bus_spot.fixture.json（正式站 /api/bus-route-stops 擷取＋靜態分站索引組成的 StopOfRoute 列）。
// 驗：選得出對的下車站牌（日月潭、阿里山、九份）、參數檢查、每包路線數上限、快取命中不再打 TDX、上游失敗的狀態、不接輪詢。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { _busTransfer } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'verify_bus_spot.fixture.json'), 'utf8')).rows;
const workerSource = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const edge = new Map();
let authCalls = 0;
const routeCalls = [];
const failScopes = new Set();

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
  if (url.hostname === 'bus.test' && url.pathname.startsWith('/live/StopOfRoute/')) {
    const scope = decodeURIComponent(url.pathname.slice('/live/StopOfRoute/'.length));
    routeCalls.push({ scope, url });
    if (failScopes.has(scope)) return Response.json({ message: 'fixture down' }, { status: 503 });
    const filter = url.searchParams.get('$filter') || '';
    const uids = new Set([...filter.matchAll(/RouteUID eq '([^']+)'/g)].map(m => m[1]));
    return Response.json((fixture[scope] || []).filter(row => uids.has(row.RouteUID)));
  }
  throw new Error(`未預期 outbound fetch：${url}`);
};

const env = {
  TDX_CLIENT_ID: 'fixture-id',
  TDX_CLIENT_SECRET: 'fixture-secret',
  TDX_AUTH_URL_OVERRIDE: 'https://auth.test/token',
  BUS_API_BASE_URL_OVERRIDE: 'https://bus.test/live',
  BUS_TRANSFER_DEBUG: true,
  ASSETS: {
    async fetch(request) {
      const p = new URL(request.url).pathname;
      if (!/^\/data\/(bus_transfer_stations\.json|bus-transfer\/[A-Za-z0-9_-]+\.json)$/.test(p)) return new Response('not found', { status: 404 });
      try { return new Response(readFileSync(path.join(ROOT, p)), { headers: { 'content-type': 'application/json' } }); }
      catch (e) { return new Response('not found', { status: 404 }); }
    },
  },
};

const ask = async (lat, lon, stations) => {
  const url = `https://railisland.tw/api/bus-spot?lat=${lat}&lon=${lon}&stations=${encodeURIComponent(stations.join(','))}`;
  const response = await worker.fetch(new Request(url), env, {});
  return { status: response.status, body: await response.json() };
};
const ridesOf = (body, id) => (body.stations.find(s => s.id === id) || { rides: [] }).rides;
const fresh = () => { edge.clear(); _busTransfer.resetBusTransferCaches(); };

await check('StopOfRoute 網址：RouteUID 用 or 串、select 站序欄位、擋掉不安全的 scope 與 UID', () => {
  const url = _busTransfer.busSpotRoutesUrl(env, 'InterCity', ['THB6289', 'THB6801']);
  assert.equal(url.origin + url.pathname, 'https://bus.test/live/StopOfRoute/InterCity');
  assert.equal(url.searchParams.get('$filter'), "RouteUID eq 'THB6289' or RouteUID eq 'THB6801'");
  assert.match(url.searchParams.get('$select'), /Stops/);
  assert.throws(() => _busTransfer.busSpotRoutesUrl(env, 'InterCity', ["x' or 1 eq 1"]), /invalid route uid/);
  assert.throws(() => _busTransfer.busSpotRoutesUrl(env, '../Route', ['THB6289']), /invalid scope/);
});

await check('參數不對回 400，不取 token、不打 TDX', async () => {
  fresh();
  const before = routeCalls.length, auth = authCalls;
  assert.equal((await ask(35.0, 139.7, ['TRA:3435'])).status, 400, '台灣以外的座標');
  assert.equal((await ask(23.85, 120.93, [])).status, 400, '沒有車站');
  assert.equal((await ask(23.85, 120.93, ["TRA:3435'"])).status, 400, '站 ID 格式');
  const many = Array.from({ length: _busTransfer.BUS_SPOT_MAX_STATIONS + 1 }, (_, i) => `TRA:${1000 + i}`);
  assert.equal((await ask(23.85, 120.93, many)).status, 400, '超過站數上限');
  assert.equal(routeCalls.length, before);
  assert.equal(authCalls, auth);
});

await check('日月潭纜車站：水里有 6289、6801，高鐵台中有 6670；下車站牌離景點 3 公里內、比上車處近', async () => {
  fresh();
  const { status, body } = await ask(23.85208, 120.93486, ['TRA:3436', 'TRA:3435', 'THSR:1040']);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.reachM, 3000);
  const shuili = ridesOf(body, 'TRA:3435');
  assert.deepEqual(shuili.map(r => r.routeName).sort(), ['6289', '6801']);
  for (const r of shuili) {
    assert(r.alight.toSpotM <= 3000 && r.alight.toSpotM > 1000, `${r.routeName} 下車離景點 ${r.alight.toSpotM}`);
    assert(r.board.walkM < 600, '上車站牌在車站 600m 內');
    assert.equal(r.intercity, true);
    assert(r.stops > 5 && r.distanceM > 10000, '沿站牌距離');
    assert.equal(r.points.length % 2, 0);
    assert.match(r.arrivalKey, /^InterCity\|THB\d+\|[A-Z0-9]+\|[01]\|THB\d+$/);
  }
  assert.deepEqual(ridesOf(body, 'THSR:1040').map(r => [r.routeName, r.alight.name]), [['6670', '朝霧碼頭']]);
  assert.deepEqual(ridesOf(body, 'TRA:3436'), []);
});

await check('同一組再問一次：全部命中快取，不再打 TDX', async () => {
  const before = routeCalls.length;
  const { status, body } = await ask(23.85208, 120.93486, ['TRA:3436', 'TRA:3435', 'THSR:1040']);
  assert.equal(status, 200);
  assert.equal(routeCalls.length, before);
  assert(body.stations.every(s => s.cache === 'hit' || !s.rides.length));
});

await check('阿里山：嘉義車站 7322、高鐵嘉義 7329，下車站牌在景點 1 公里內（走得到）', async () => {
  fresh();
  const { status, body } = await ask(23.50882, 120.80200, ['TRA:3450', 'TRA:4080', 'THSR:1050']);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(ridesOf(body, 'TRA:4080').map(r => r.routeName), ['7322']);
  assert.deepEqual(ridesOf(body, 'THSR:1050').map(r => r.routeName), ['7329']);
  for (const r of [...ridesOf(body, 'TRA:4080'), ...ridesOf(body, 'THSR:1050')]) assert(r.alight.toSpotM <= 1000, `${r.routeName} ${r.alight.toSpotM}`);
  assert.deepEqual(ridesOf(body, 'TRA:3450'), []);
});

await check('嘉義車站客運路線多：每包 StopOfRoute 最多 BUS_SPOT_ROUTE_CHUNK 條路線', async () => {
  const calls = routeCalls.filter(c => c.scope === 'InterCity');
  assert(calls.length >= 2, `只打了 ${calls.length} 包`);
  for (const c of calls) {
    const n = [...(c.url.searchParams.get('$filter') || '').matchAll(/RouteUID eq/g)].length;
    assert(n >= 1 && n <= _busTransfer.BUS_SPOT_ROUTE_CHUNK, `一包 ${n} 條`);
  }
});

await check('九份老街：瑞芳 1062 坐到九份老街站（80m）', async () => {
  fresh();
  const { status, body } = await ask(25.10987, 121.84518, ['TRA:7350', 'TRA:7360']);
  assert.equal(status, 200, JSON.stringify(body));
  const r = ridesOf(body, 'TRA:7360').find(x => x.routeName === '1062');
  assert(r, JSON.stringify(ridesOf(body, 'TRA:7360').map(x => x.routeName)));
  assert.equal(r.alight.name, '九份老街');
  assert(r.alight.toSpotM < 200);
  assert.equal(ridesOf(body, 'TRA:7360')[0].routeName, '1062', '走得到景點的排前面');
});

await check('附近沒有站牌的站照實回 no_nearby_stops、不支援的站回 unsupported，都不打 TDX', async () => {
  fresh();
  const before = routeCalls.length;
  const { status, body } = await ask(24.0, 121.0, ['TRA:1150', 'TRA:9999']);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.stations.map(s => [s.id, s.state]), [['TRA:1150', 'no_nearby_stops'], ['TRA:9999', 'unsupported']]);
  assert.equal(routeCalls.length, before);
});

await check('上游壞一個 scope＝partial（有拿到的照回）；全部壞＝502', async () => {
  fresh();
  failScopes.add('City/NewTaipei');
  try {
    const one = await ask(25.10987, 121.84518, ['TRA:7360']);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.state, 'partial');
    assert.equal(one.body.stations[0].state, 'partial');
    assert(ridesOf(one.body, 'TRA:7360').some(r => r.routeName === '1062'), 'InterCity 的 1062 照回');
    fresh();
    failScopes.add('InterCity');
    const all = await ask(25.10987, 121.84518, ['TRA:7360']);
    assert.equal(all.status, 502, JSON.stringify(all.body));
  } finally { failScopes.clear(); }
});

await check('路由有接上、scheduled 沒有接 bus-spot（只在使用者排行程時打）', () => {
  assert.match(workerSource, /else if \(url\.pathname === '\/api\/bus-spot'\) res = await busSpot\(request, env\);/);
  const scheduled = /async scheduled\([\s\S]*?\n  async fetch\(/.exec(workerSource)?.[0] || '';
  assert(scheduled, '找不到 scheduled handler');
  assert.doesNotMatch(scheduled, /busSpot|bus-spot/);
});

globalThis.fetch = realFetch;
if (realCaches === undefined) delete globalThis.caches;
else globalThis.caches = realCaches;

console.log(`RESULT failures=${failures} status=${failures ? 'RED' : 'GREEN'}`);
process.exit(failures ? 1 : 0);
