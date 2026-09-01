#!/usr/bin/env node
// TDX StopOfRoute → 臺北／臺南／花蓮三站的靜態附近站牌索引。
// 這支只由開發者手動執行，不掛 package script、cron 或 Worker scheduled；正式服務不會背景重抓。

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUS_TRANSFER_SCHEMA, buildNearbyScope } from './bus_transfer_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data', 'bus_transfer_pilot.json');
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Bus';

export const PILOT_STATIONS = [
  { id: 'TRA:1000', name: '臺北車站', stationKey: 'TRA:1000', radiusM: 600, maxStopUids: 24, scopes: ['City/Taipei', 'InterCity'] },
  { id: 'TRA:4220', name: '臺南車站', stationKey: 'TRA:4220', radiusM: 600, maxStopUids: 24, scopes: ['City/Tainan', 'InterCity'] },
  { id: 'TRA:7000', name: '花蓮車站', stationKey: 'TRA:7000', radiusM: 600, maxStopUids: 24, scopes: ['City/HualienCounty', 'InterCity'] },
];

function readEnv() {
  const out = { ...process.env };
  const envArg = process.argv.indexOf('--env-file');
  const envPath = envArg >= 0 && process.argv[envArg + 1]
    ? path.resolve(process.argv[envArg + 1])
    : (process.env.TDX_ENV_FILE ? path.resolve(process.env.TDX_ENV_FILE) : path.join(ROOT, '.env'));
  try {
    for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (out[key] == null) out[key] = value;
    }
  } catch (e) {
    throw new Error(`讀不到 TDX env：${envPath}`);
  }
  if (!out.TDX_CLIENT_ID || !out.TDX_CLIENT_SECRET) throw new Error('缺 TDX_CLIENT_ID／TDX_CLIENT_SECRET');
  return out;
}

async function tokenOf(env) {
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET,
    }),
    redirect: 'manual',
  });
  if (!response.ok) throw new Error(`TDX OAuth HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('TDX OAuth 回應缺 access_token');
  return data.access_token;
}

function unwrap(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.StopOfRoutes)) return body.StopOfRoutes;
  return [];
}

async function fetchStopOfRoute(scope, token) {
  const url = new URL(`${API_BASE}/StopOfRoute/${scope}`);
  url.searchParams.set('$top', '100000');
  url.searchParams.set('$format', 'JSON');
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual' });
  if (!response.ok) throw new Error(`StopOfRoute/${scope} HTTP ${response.status}`);
  return unwrap(await response.json());
}

export function loadStationPositions() {
  const transfers = JSON.parse(readFileSync(path.join(ROOT, 'data', 'station_transfers.json'), 'utf8'));
  return Object.fromEntries(PILOT_STATIONS.map(station => {
    const source = transfers.stations && transfers.stations[station.stationKey];
    if (!source || !Array.isArray(source.position) || source.position.length !== 2) throw new Error(`找不到 ${station.stationKey} 座標`);
    return [station.id, { lat: Number(source.position[0]), lon: Number(source.position[1]) }];
  }));
}

export function buildPilotProduct(rowsByScope, generatedAt = new Date().toISOString()) {
  const positions = loadStationPositions();
  const stations = {};
  for (const config of PILOT_STATIONS) {
    const station = { id: config.id, name: config.name, position: positions[config.id] };
    const scopes = config.scopes.map(scope => buildNearbyScope({
      station,
      scope,
      stopOfRouteRows: rowsByScope[scope] || [],
      radiusM: config.radiusM,
      maxStopUids: config.maxStopUids,
    }));
    stations[config.id] = { ...station, radiusM: config.radiusM, scopes };
  }
  return {
    schemaVersion: BUS_TRANSFER_SCHEMA,
    generatedAt,
    pilotOnly: true,
    trigger: 'user_open_only',
    polling: false,
    stations,
  };
}

async function main() {
  const env = readEnv();
  const token = await tokenOf(env);
  const scopes = [...new Set(PILOT_STATIONS.flatMap(station => station.scopes))];
  const rowsByScope = {};
  for (const scope of scopes) {
    rowsByScope[scope] = await fetchStopOfRoute(scope, token);
    console.log(`${scope}: ${rowsByScope[scope].length} StopOfRoute`);
  }
  const product = buildPilotProduct(rowsByScope);
  writeFileSync(OUTPUT, JSON.stringify(product, null, 2) + '\n');
  for (const station of Object.values(product.stations)) {
    console.log(`${station.name}: ${station.scopes.reduce((sum, scope) => sum + scope.stops.length, 0)} 站牌、${station.scopes.reduce((sum, scope) => sum + scope.routeRefs.length, 0)} 路線方向`);
  }
  console.log(`寫入 ${path.relative(ROOT, OUTPUT)}`);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
