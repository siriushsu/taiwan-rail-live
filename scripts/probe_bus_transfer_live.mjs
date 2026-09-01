#!/usr/bin/env node
// 手動實打代表站的唯讀 probe；不掛 package script／cron，不寫檔、不印金鑰。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { _busTransfer } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envArg = process.argv.indexOf('--env-file');
const envPath = envArg >= 0 && process.argv[envArg + 1] ? path.resolve(process.argv[envArg + 1]) : path.join(ROOT, '.env');
const env = {};
for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}
if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) throw new Error('缺 TDX_CLIENT_ID／TDX_CLIENT_SECRET');
env.BUS_TRANSFER_DEBUG = true;

const manifestBody = readFileSync(path.join(ROOT, 'data', 'bus_transfer_stations.json'));
env.ASSETS = { async fetch(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/data/bus_transfer_stations.json') return new Response(manifestBody, { headers: { 'content-type': 'application/json' } });
  if (/^\/data\/bus-transfer\/TRA-\d{4}\.json$/.test(pathname)) {
    try { return new Response(readFileSync(path.join(ROOT, pathname)), { headers: { 'content-type': 'application/json' } }); }
    catch (error) { return new Response('not found', { status: 404 }); }
  }
  return new Response('not found', { status: 404 });
} };

const edge = new Map();
globalThis.caches = { default: {
  async match(request) { return edge.has(request.url) ? edge.get(request.url).clone() : undefined; },
  async put(request, response) { edge.set(request.url, response.clone()); },
} };

_busTransfer.resetBusTransferCaches();
let totalTdxCalls = 0;
let totalTdxBytes = 0;
const stationArgs = process.argv.filter(arg => /^TRA:\d{4}$/.test(arg));
const stationIds = stationArgs.length ? stationArgs : ['TRA:1000', 'TRA:4220', 'TRA:7000'];
const openLeg = !process.argv.includes('--no-leg');
const delayArg = process.argv.find(arg => /^--delay-ms=\d+$/.test(arg));
const delayMs = delayArg ? Number(delayArg.split('=')[1]) : 0;
for (const [stationIndex, stationId] of stationIds.entries()) {
  // TDX 會員等級的月點數與瞬間 QPS 是兩件事。批次 probe 可節流；正式 UI 一次只查使用者正在看的站。
  if (delayMs && stationIndex) await new Promise(resolve => setTimeout(resolve, delayMs));
  const response = await worker.fetch(new Request(`https://railisland.tw/api/bus-transfer?station=${encodeURIComponent(stationId)}`), env, {});
  const body = await response.json();
  if (!response.ok) {
    console.log(`${stationId}: HTTP ${response.status} ${body.error || ''}`);
    continue;
  }
  const states = Object.fromEntries([...new Set(body.arrivals.map(row => row.live.state))].sort().map(state => [state, body.arrivals.filter(row => row.live.state === state).length]));
  const matches = Object.fromEntries([...new Set(body.arrivals.map(row => row.routeMatch))].sort().map(match => [match, body.arrivals.filter(row => row.routeMatch === match).length]));
  const stationBytes = body.live.scopes.reduce((sum, scope) => sum + (scope.bytes || 0), 0);
  totalTdxCalls += body.live.scopes.filter(scope => scope.state === 'live').length;
  totalTdxBytes += stationBytes;
  console.log(`${body.station.name}: arrivals=${body.arrivals.length}/${body.totals.accepted}, rejected=${body.totals.rejected}, live=${body.live.state}, cache=${body.live.cache}`);
  console.log(`  states=${JSON.stringify(states)} routeMatch=${JSON.stringify(matches)} scopes=${body.live.scopes.map(scope => `${scope.scope}:${scope.state}/${scope.rows}/${scope.bytes || 0}B`).join(',')}`);
  for (const row of body.arrivals.slice(0, 5)) console.log(`  ${row.routeName} → ${row.headsign || '方向未確認'} @ ${row.stopName}: ${row.live.state} eta=${row.live.etaSec ?? '-'}s age=${row.live.ageSec ?? '-'}s match=${row.routeMatch}`);
  const selected = stationId === 'TRA:1000'
    ? (body.arrivals.find(row => row.scope === 'City/Taipei') || body.arrivals[0])
    : body.arrivals[0];
  if (selected && openLeg) {
    const legUrl = new URL('https://railisland.tw/api/bus-leg-live');
    legUrl.searchParams.set('station', stationId);
    legUrl.searchParams.set('arrival', selected.key);
    const legResponse = await worker.fetch(new Request(legUrl), env, {});
    const leg = await legResponse.json();
    if (!legResponse.ok) console.log(`  leg ${selected.routeName}: HTTP ${legResponse.status} ${leg.error || ''}`);
    else {
      const tdxSources = leg.live.sources.filter(source => source.tdx !== false);
      totalTdxCalls += tdxSources.length;
      totalTdxBytes += tdxSources.reduce((sum, source) => sum + (source.bytes || 0), 0);
      const occupancy = Object.fromEntries([...new Set(leg.vehicles.map(vehicle => vehicle.occupancy.state))].map(state => [state, leg.vehicles.filter(vehicle => vehicle.occupancy.state === state).length]));
      console.log(`  leg ${selected.routeName}: binding=${leg.binding.state}, vehicles=${leg.vehicles.length}, fresh=${leg.totals.freshInService}, occupancy=${JSON.stringify(occupancy)}, sources=${leg.live.sources.map(source => `${source.kind}:${source.rows}/${source.bytes || 0}B`).join(',')}`);
      if (!leg.vehicles.length && leg.live.sources.some(source => source.kind === 'A1' && source.rows > 0)) {
        const raw = await _busTransfer.cachedBusLegRaw(new Request(legUrl), env, selected);
        const sample = raw.a1Rows[0] || {};
        console.log(`  leg-empty diagnostic: plate=${sample.PlateNumb || '-'} route=${sample.RouteUID || '-'} sub=${sample.SubRouteUID || '-'} dir=${sample.Direction ?? '-'} position=${sample.BusPosition ? 'yes' : 'no'} gps=${sample.GPSTime || '-'}`);
      }
    }
  }
}
console.log(`TOTAL TDX calls=${totalTdxCalls}, bytes=${totalTdxBytes}`);
