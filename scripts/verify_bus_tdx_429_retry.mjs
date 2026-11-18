#!/usr/bin/env node
// 守門人：公車 N1／StopOfRoute 遇到 TDX 每秒上限的 429 會延後重打，App 行程規劃式的連發不再回 502。
// 2026-11-18 正式站 BUS_USAGE 實測：一次行程規劃同一秒 S2 429×10、N1 429×2，/api/bus-route-stops 回 502。
// 這裡用假上游照 TDX 規則限流（全部公車端點共用一把，按「整秒」計數，每秒最多 LIMIT 發，多的回 429），
// 照 App（railcore TripBus.plan）的形狀：先對幾個車站同時打 bus-transfer，每支回來後對它的到站列各打 bus-route-stops。
// 用法：node scripts/verify_bus_tdx_429_retry.mjs [--worker=<worker.js 路徑>]（給舊版路徑可看控制組變紅）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerArg = (process.argv.find(a => a.startsWith('--worker=')) || '').slice(9);
const workerPath = workerArg ? path.resolve(workerArg) : path.join(ROOT, 'worker.js');
const { default: worker, _busTransfer } = await import(pathToFileURL(workerPath).href);

const LIMIT = 10;
const STATIONS = ['TRA:1000', 'TRA:1010', 'TRA:1020'];
const ROUTES_PER_STATION = 6; // railcore TripBus.MAX_ROUTE_CALLS
const station = id => JSON.parse(readFileSync(path.join(ROOT, 'data', 'bus-transfer', id.replace(':', '-') + '.json'), 'utf8')).station;
const manifest = readFileSync(path.join(ROOT, 'data', 'bus_transfer_stations.json'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

// ── 假 TDX：按整秒計數 ──
const perSecond = new Map();
const upstream = { ok: 0, limited: 0 };
function admit() {
  const sec = Math.floor(Date.now() / 1000);
  const n = (perSecond.get(sec) || 0) + 1;
  perSecond.set(sec, n);
  if (n > LIMIT) { upstream.limited++; return false; }
  upstream.ok++; return true;
}
const nowIso = () => new Date(Date.now() - 5000).toISOString();
const usageRows = [];
const realFetch = globalThis.fetch;
const edge = new Map();
globalThis.caches = { default: {
  async match(request) { return edge.has(request.url) ? edge.get(request.url).clone() : undefined; },
  async put(request, response) { edge.set(request.url, response.clone()); },
} };
globalThis.fetch = async (requestLike, init) => {
  const url = new URL(requestLike instanceof URL ? requestLike.href : (typeof requestLike === 'string' ? requestLike : requestLike.url));
  if (url.hostname === 'auth.test') return Response.json({ access_token: 'fixture-token', expires_in: 86400 });
  if (url.hostname !== 'bus.test') throw new Error(`未預期 outbound fetch：${url}`);
  await new Promise(r => setTimeout(r, 30));
  if (init?.signal?.aborted) throw new Error('aborted');
  if (!admit()) return Response.json({ message: 'API rate limit exceeded' }, { status: 429 });
  const filter = url.searchParams.get('$filter') || '';
  if (url.pathname.startsWith('/n1/')) {
    const scope = url.pathname.slice('/n1/'.length);
    const uids = new Set([...filter.matchAll(/StopUID eq '([^']+)'/g)].map(m => m[1]));
    const rows = [];
    for (const st of STATIONS.map(station)) for (const sc of st.scopes) if (sc.scope === scope) for (const stop of sc.stops) {
      if (!uids.has(stop.stopUid)) continue;
      for (const rs of stop.routeStops) {
        const [, routeUid, subRouteUid, dir] = rs.routeKey.split('|');
        rows.push({ RouteUID: routeUid, RouteName: { Zh_tw: routeUid }, SubRouteUID: subRouteUid, Direction: Number(dir),
          StopUID: stop.stopUid, EstimateTime: 300, StopStatus: 0, SrcUpdateTime: nowIso() });
      }
    }
    return Response.json(rows);
  }
  if (url.pathname.includes('/StopOfRoute/')) {
    const routeUid = (filter.match(/RouteUID eq '([^']+)'/) || [])[1];
    const sub = (filter.match(/SubRouteUID eq '([^']+)'/) || [])[1] || routeUid;
    const dir = Number((filter.match(/Direction eq (\d)/) || [])[1] || 0);
    const stops = [];
    for (const st of STATIONS.map(station)) for (const sc of st.scopes) for (const stop of sc.stops) for (const rs of stop.routeStops) {
      const [, r, s, d] = rs.routeKey.split('|');
      if (r === routeUid && (s || r) === sub && Number(d) === dir) stops.push({ StopUID: stop.stopUid, StopName: { Zh_tw: stop.stopName }, StopSequence: rs.stopSequence,
        StopPosition: { PositionLat: stop.position.lat, PositionLon: stop.position.lon } });
    }
    for (let i = 1; i <= 3; i++) stops.push({ StopUID: `X${i}`, StopName: { Zh_tw: `下游${i}` }, StopSequence: 900 + i, StopPosition: { PositionLat: 25, PositionLon: 121.5 } });
    return Response.json([{ RouteUID: routeUid, SubRouteUID: sub, Direction: dir, Stops: stops }]);
  }
  return Response.json([], { status: 404 });
};

const env = {
  TDX_CLIENT_ID: 'fixture-id', TDX_CLIENT_SECRET: 'fixture-secret',
  TDX_AUTH_URL_OVERRIDE: 'https://auth.test/token',
  BUS_N1_BASE_URL_OVERRIDE: 'https://bus.test/n1',
  BUS_API_BASE_URL_OVERRIDE: 'https://bus.test/live',
  BUS_TRANSFER_DEBUG: true,
  BUS_USAGE: { writeDataPoint(row) { usageRows.push(row); } },
  ASSETS: { async fetch(request) {
    const p = new URL(request.url).pathname;
    if (p === '/data/bus_transfer_stations.json') return new Response(manifest, { headers: { 'content-type': 'application/json' } });
    try { return new Response(readFileSync(path.join(ROOT, p)), { headers: { 'content-type': 'application/json' } }); }
    catch (e) { return new Response('not found', { status: 404 }); }
  } },
};
const call = async u => {
  const res = await worker.fetch(new Request('https://railisland.tw' + u), env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
};

// App 形狀：先等到整秒開頭，同時發各站 bus-transfer；每支回來就發它前 6 個到站列的 bus-route-stops。
async function tripPlanBurst() {
  await new Promise(r => setTimeout(r, 1000 - (Date.now() % 1000) + 5));
  const route = [], transfer = [];
  await Promise.all(STATIONS.map(async sid => {
    const t = await call(`/api/bus-transfer?station=${encodeURIComponent(sid)}`);
    transfer.push({ sid, status: t.status, state: t.body.live && t.body.live.state });
    const keys = (t.body.arrivals || []).slice(0, ROUTES_PER_STATION).map(a => a.key);
    await Promise.all(keys.map(async k => {
      const r = await call(`/api/bus-route-stops?station=${encodeURIComponent(sid)}&arrival=${encodeURIComponent(k)}`);
      route.push({ sid, k, status: r.status, state: r.body.state, detail: r.body.detail });
    }));
  }));
  return { transfer, route };
}

console.log('worker:', path.relative(process.cwd(), workerPath) || workerPath);
const t0 = Date.now();
const { transfer, route } = await tripPlanBurst();
const tally = rows => rows.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
console.log('bus-transfer', JSON.stringify(tally(transfer)), JSON.stringify(transfer.map(t => t.state)));
console.log('bus-route-stops', JSON.stringify(tally(route)), [...new Set(route.filter(r => r.status !== 200).map(r => r.detail))].join(' / '));
console.log(`上游：通過 ${upstream.ok}、429 ${upstream.limited}；最忙一秒 ${Math.max(...perSecond.values())} 發；全程 ${Date.now() - t0} ms`);

await check('連發確實撞到上游每秒上限（不然這支量不到東西）', () => assert(upstream.limited > 0, '假上游一發都沒擋，連發不夠密'));
await check(`三站 bus-transfer 都回 200 且所有 scope 都拿到`, () => {
  assert.equal(transfer.length, STATIONS.length);
  for (const t of transfer) { assert.equal(t.status, 200, t.sid); assert.equal(t.state, 'live', `${t.sid} ${t.state}`); }
});
await check(`bus-route-stops ${route.length} 發全部 200（不得 502）`, () => {
  assert(route.length >= 12, `到站列不夠：${route.length}`);
  const bad = route.filter(r => r.status !== 200);
  assert.equal(bad.length, 0, bad.slice(0, 3).map(r => `${r.status} ${r.detail}`).join('; '));
});
await check('撞到的 429 每一發都記進 BUS_USAGE', () => {
  const rec429 = usageRows.filter(r => r.blobs[2] === '429').length;
  assert.equal(rec429, upstream.limited);
});
await check('任何一發都沒有等超過 12 秒（BUS_INFLIGHT_WAIT_MAX_MS）', () => assert(Date.now() - t0 < 12e3, `${Date.now() - t0} ms`));

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} 項失敗` : '\n全部通過');
process.exit(failures ? 1 : 0);
