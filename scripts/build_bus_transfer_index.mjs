#!/usr/bin/env node
// TDX StopOfRoute → 全臺目前有台鐵客運班表車站的靜態附近站牌索引。
// 這支只由開發者手動執行，不掛 package script、cron 或 Worker scheduled；正式服務不會背景重抓。
// 索引按站分檔，避免 Worker 冷啟時為查一站而載入全臺數 MB 的站牌資料。

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUS_TRANSFER_SCHEMA, buildNearbyScope, haversineMeters } from './bus_transfer_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'data', 'bus-transfer');
const MANIFEST_PATH = path.join(ROOT, 'data', 'bus_transfer_stations.json');
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Bus';
const RADIUS_M = 600;
const MAX_STOP_UIDS = 24;

// tra_station_info.address 的縣市名稱 → TDX Bus City scope。順序刻意把「市」放在同名「縣」前。
const ADDRESS_SCOPES = [
  ['基隆市', 'Keelung'], ['臺北市', 'Taipei'], ['台北市', 'Taipei'], ['新北市', 'NewTaipei'],
  ['桃園市', 'Taoyuan'], ['新竹市', 'Hsinchu'], ['新竹縣', 'HsinchuCounty'], ['苗栗縣', 'MiaoliCounty'],
  ['臺中市', 'Taichung'], ['台中市', 'Taichung'], ['彰化縣', 'ChanghuaCounty'], ['南投縣', 'NantouCounty'],
  ['雲林縣', 'YunlinCounty'], ['嘉義市', 'Chiayi'], ['嘉義縣', 'ChiayiCounty'],
  ['臺南市', 'Tainan'], ['台南市', 'Tainan'], ['高雄市', 'Kaohsiung'], ['屏東縣', 'PingtungCounty'],
  ['宜蘭縣', 'YilanCounty'], ['花蓮縣', 'HualienCounty'], ['臺東縣', 'TaitungCounty'], ['台東縣', 'TaitungCounty'],
];

const stationKey = name => String(name).replace(/臺/g, '台').replace(/\s*\([^)]*\)\s*$/, '').trim();

function activeStations() {
  const info = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tra_station_info.json'), 'utf8'));
  const schedule = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tra_schedule.json'), 'utf8'));
  const infoByName = new Map();
  for (const [key, value] of Object.entries(info)) {
    infoByName.set(stationKey(key), value);
    infoByName.set(stationKey(value.name), value);
  }
  const scheduleNames = [...new Set((schedule.trains || []).flatMap(train => (train.stops || []).map(stop => stop.name)))];
  const scheduleKeys = new Set(scheduleNames.map(stationKey));
  // 與前端既有別名站合併同一條規則：X-… 若 X 也在班表且兩點 200m 內，視為同一實體站。
  // 目前命中臺北-環島(1001)→臺北(1000)，避免替畫面上永遠不會出現的第二顆站建立重複索引。
  const physicalNames = [...new Set(scheduleNames.map(name => {
    const key = stationKey(name);
    const dash = key.indexOf('-');
    if (dash <= 0) return name;
    const baseKey = key.slice(0, dash);
    if (!scheduleKeys.has(baseKey)) return name;
    const alias = infoByName.get(key);
    const base = infoByName.get(baseKey);
    if (!alias || !base || haversineMeters({ lat: alias.lat, lon: alias.lon }, { lat: base.lat, lon: base.lon }) > 200) return name;
    return base.name;
  }))];
  const stations = physicalNames.map(name => {
    const source = infoByName.get(stationKey(name));
    if (!source || !/^\d{4}$/.test(String(source.id || ''))) throw new Error(`找不到營運站 ${name} 的四碼 StationID`);
    const address = String(source.address || '');
    const city = ADDRESS_SCOPES.find(([label]) => address.includes(label));
    if (!city) throw new Error(`找不到營運站 ${name} 的 TDX City scope：${address || '地址空白'}`);
    return {
      id: `TRA:${source.id}`,
      name: `${source.name || name}車站`,
      position: { lat: Number(source.lat), lon: Number(source.lon) },
      scopes: [`City/${city[1]}`, 'InterCity'],
    };
  });
  const ids = new Set(stations.map(station => station.id));
  if (ids.size !== stations.length) throw new Error('營運站 StationID 重複，拒絕覆寫分站索引');
  return stations.sort((a, b) => a.id.localeCompare(b.id));
}

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
  } catch (error) {
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

export function buildStationProduct(station, rowsByScope, generatedAt) {
  const scopes = station.scopes.map(scope => buildNearbyScope({
    station,
    scope,
    stopOfRouteRows: rowsByScope[scope] || [],
    radiusM: RADIUS_M,
    maxStopUids: MAX_STOP_UIDS,
  })).filter(scope => scope.stops.length > 0);
  const nearbyStopCount = scopes.reduce((sum, scope) => sum + scope.stops.length, 0);
  return {
    schemaVersion: BUS_TRANSFER_SCHEMA,
    generatedAt,
    coverage: 'all_active_tra_stations',
    trigger: 'user_open_only',
    polling: false,
    station: {
      id: station.id,
      name: station.name,
      position: station.position,
      radiusM: RADIUS_M,
      nearbyStopCount,
      coverageState: nearbyStopCount ? 'indexed' : 'no_nearby_stops',
      scopes,
    },
  };
}

export function buildManifest(stations, generatedAt) {
  return {
    schemaVersion: BUS_TRANSFER_SCHEMA,
    generatedAt,
    coverage: 'all_active_tra_stations',
    trigger: 'user_open_only',
    polling: false,
    stationCount: stations.length,
    stations: Object.fromEntries(stations.map(station => [station.id, {
      id: station.id,
      name: station.name,
      asset: `/data/bus-transfer/${station.id.replace(':', '-')}.json`,
    }])),
  };
}

async function main() {
  const stations = activeStations();
  const env = readEnv();
  const token = await tokenOf(env);
  const scopes = [...new Set(stations.flatMap(station => station.scopes))].sort();
  const rowsByScope = {};
  for (const scope of scopes) {
    rowsByScope[scope] = await fetchStopOfRoute(scope, token);
    console.log(`${scope}: ${rowsByScope[scope].length} StopOfRoute`);
  }

  const generatedAt = new Date().toISOString();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const expectedFiles = new Set();
  let indexed = 0;
  let withoutStops = 0;
  let stopRefs = 0;
  for (const station of stations) {
    const product = buildStationProduct(station, rowsByScope, generatedAt);
    const filename = `${station.id.replace(':', '-')}.json`;
    expectedFiles.add(filename);
    writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(product) + '\n');
    if (product.station.nearbyStopCount) indexed += 1;
    else withoutStops += 1;
    stopRefs += product.station.nearbyStopCount;
  }
  for (const filename of readdirSync(OUTPUT_DIR)) {
    if (/^TRA-\d{4}\.json$/.test(filename) && !expectedFiles.has(filename)) unlinkSync(path.join(OUTPUT_DIR, filename));
  }
  const manifest = buildManifest(stations, generatedAt);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`寫入 ${stations.length} 站：${indexed} 站有 600m 內站牌、${withoutStops} 站目前無站牌，共 ${stopRefs} 個 scope/StopUID 記錄`);
  console.log(`manifest：${path.relative(ROOT, MANIFEST_PATH)}`);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();

export { activeStations };
