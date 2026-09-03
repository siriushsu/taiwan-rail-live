#!/usr/bin/env node
// TDX StopOfRoute → 軌島地圖上所有客運鐵路／捷運／輕軌車站的靜態附近站牌索引。
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
const COVERAGE = 'all_active_rail_stations';

// tra_station_info.address 的縣市名稱 → TDX Bus City scope。順序刻意把「市」放在同名「縣」前。
const ADDRESS_SCOPES = [
  ['基隆市', 'Keelung'], ['臺北市', 'Taipei'], ['台北市', 'Taipei'], ['新北市', 'NewTaipei'],
  ['桃園市', 'Taoyuan'], ['新竹市', 'Hsinchu'], ['新竹縣', 'HsinchuCounty'], ['苗栗縣', 'MiaoliCounty'],
  ['臺中市', 'Taichung'], ['台中市', 'Taichung'], ['彰化縣', 'ChanghuaCounty'], ['南投縣', 'NantouCounty'],
  ['雲林縣', 'YunlinCounty'], ['嘉義市', 'Chiayi'], ['嘉義縣', 'ChiayiCounty'],
  ['臺南市', 'Tainan'], ['台南市', 'Tainan'], ['高雄市', 'Kaohsiung'], ['屏東縣', 'PingtungCounty'],
  ['宜蘭縣', 'YilanCounty'], ['花蓮縣', 'HualienCounty'], ['臺東縣', 'TaitungCounty'], ['台東縣', 'TaitungCounty'],
];

// App 的七組捷運／輕軌資料有些是一個畫面系統包兩個 TDX 營運機構（台北捷運含環狀線、
// 高雄捷運含輕軌）。station_transfers.json 已保留官方 StationID 與座標，這裡只負責把地圖
// 實際會出現的站接回官方身份；找不到才用穩定 RI id，不能因官方名冊晚一版就漏掉新站。
const APP_RAIL_SYSTEMS = [
  { appSystem: 'mrt', label: '台北捷運', file: 'trtc.json', sourceSystems: ['TRTC', 'NTMC'], cityScopes: ['Taipei', 'NewTaipei'] },
  { appSystem: 'tymc', label: '桃園機場捷運', file: 'tymc.json', sourceSystems: ['TYMC'], cityScopes: ['Taipei', 'NewTaipei', 'Taoyuan'] },
  { appSystem: 'tmrt', label: '台中捷運', file: 'tmrt.json', sourceSystems: ['TMRT'], cityScopes: ['Taichung'] },
  { appSystem: 'krtc', label: '高雄捷運與輕軌', file: 'krtc.json', sourceSystems: ['KRTC', 'KLRT'], cityScopes: ['Kaohsiung'] },
  { appSystem: 'ntalrt', label: '安坑輕軌', file: 'ntalrt.json', sourceSystems: ['NTALRT'], cityScopes: ['NewTaipei'] },
  { appSystem: 'ntdlrt', label: '淡海輕軌', file: 'ntdlrt.json', sourceSystems: ['NTDLRT'], cityScopes: ['NewTaipei'] },
  { appSystem: 'sanying', label: '三鶯線', file: 'sanying.json', sourceSystems: ['SANYING'], cityScopes: ['NewTaipei', 'Taoyuan'] },
  { appSystem: 'afr_sched', label: '阿里山林鐵', file: 'afr.json', sourceSystems: ['AFR'], cityScopes: ['Chiayi', 'ChiayiCounty'] },
  { appSystem: 'thsr_sched', label: '高鐵', file: 'thsr_track.json', sourceSystems: ['THSR'], cityScopes: [
    'Taipei', 'NewTaipei', 'Taoyuan', 'HsinchuCounty', 'MiaoliCounty', 'Taichung',
    'ChanghuaCounty', 'YunlinCounty', 'ChiayiCounty', 'Tainan', 'Kaohsiung',
  ] },
];

const stationKey = name => String(name).replace(/臺/g, '台').replace(/\s*\([^)]*\)\s*$/, '').trim();
const railStationKey = name => stationKey(String(name || '').normalize('NFKC'))
  .replace(/^(高鐵|台鐵)/, '').replace(/火車站$/, '').replace(/車站$/, '').replace(/站$/, '').trim();

function stableRailId(appSystem, name) {
  const source = `${appSystem}|${stationKey(name)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 0x01000193);
  return `RI:${String(appSystem).toUpperCase()}_${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function officialRailAnchors() {
  const data = JSON.parse(readFileSync(path.join(ROOT, 'data', 'station_transfers.json'), 'utf8'));
  return Object.entries(data.stations || {}).map(([id, station]) => ({
    id,
    system: station.system,
    name: station.name,
    nameKey: station.normalizedName || railStationKey(station.name),
    position: { lat: Number(station.position && station.position[0]), lon: Number(station.position && station.position[1]) },
  })).filter(station => Number.isFinite(station.position.lat) && Number.isFinite(station.position.lon));
}

function appRailStations() {
  const anchors = officialRailAnchors();
  const stations = [];
  for (const definition of APP_RAIL_SYSTEMS) {
    const data = JSON.parse(readFileSync(path.join(ROOT, 'data', definition.file), 'utf8'));
    const byName = new Map();
    for (const line of data.lines || []) for (const station of line.stations || []) {
      const key = stationKey(station.name);
      if (!byName.has(key)) byName.set(key, station);
    }
    for (const station of byName.values()) {
      const position = { lat: Number(station.lat), lon: Number(station.lon) };
      if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) throw new Error(`${definition.label} ${station.name} 缺座標`);
      const candidates = anchors.filter(anchor => definition.sourceSystems.includes(anchor.system) &&
        anchor.nameKey === railStationKey(station.name)).map(anchor => ({
          ...anchor,
          distanceM: haversineMeters(position, anchor.position),
        })).filter(anchor => anchor.distanceM < 450).sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
      const official = candidates[0] || null;
      stations.push({
        id: official ? official.id : stableRailId(definition.appSystem, station.name),
        name: station.name,
        appSystem: definition.appSystem,
        systemLabel: definition.label,
        position,
        scopes: [...definition.cityScopes.map(scope => `City/${scope}`), 'InterCity'],
      });
    }
  }
  return stations;
}

function activeTraStations() {
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
      appSystem: 'tra_sched',
      systemLabel: '台鐵',
      position: { lat: Number(source.lat), lon: Number(source.lon) },
      scopes: [`City/${city[1]}`, 'InterCity'],
    };
  });
  const ids = new Set(stations.map(station => station.id));
  if (ids.size !== stations.length) throw new Error('營運站 StationID 重複，拒絕覆寫分站索引');
  return stations.sort((a, b) => a.id.localeCompare(b.id));
}

function activeRailStations() {
  const stations = [...activeTraStations(), ...appRailStations()];
  const byId = new Map();
  for (const station of stations) {
    const previous = byId.get(station.id);
    // 同一個官方站碼可能被同一系統的轉乘線各列一次；位置相同就共用一份公車索引。
    if (previous) {
      if (haversineMeters(previous.position, station.position) >= 450) throw new Error(`車站索引 id 撞號：${station.id}`);
      continue;
    }
    byId.set(station.id, station);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
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
    coverage: COVERAGE,
    trigger: 'user_open_only',
    polling: false,
    station: {
      id: station.id,
      name: station.name,
      appSystem: station.appSystem,
      systemLabel: station.systemLabel,
      position: station.position,
      radiusM: RADIUS_M,
      nearbyStopCount,
      coverageState: nearbyStopCount ? 'indexed' : 'no_nearby_stops',
      scopes,
    },
  };
}

export function buildManifest(stations, generatedAt) {
  const systemCounts = {};
  for (const station of stations) systemCounts[station.appSystem] = (systemCounts[station.appSystem] || 0) + 1;
  return {
    schemaVersion: BUS_TRANSFER_SCHEMA,
    generatedAt,
    coverage: COVERAGE,
    trigger: 'user_open_only',
    polling: false,
    stationCount: stations.length,
    systemCounts: Object.fromEntries(Object.entries(systemCounts).sort(([a], [b]) => a.localeCompare(b))),
    stations: Object.fromEntries(stations.map(station => [station.id, {
      id: station.id,
      name: station.name,
      appSystem: station.appSystem,
      systemLabel: station.systemLabel,
      asset: `/data/bus-transfer/${station.id.replace(':', '-')}.json`,
    }])),
  };
}

async function main() {
  const stations = activeRailStations();
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
    if (/^[A-Za-z][A-Za-z0-9_-]*\.json$/.test(filename) && !expectedFiles.has(filename)) unlinkSync(path.join(OUTPUT_DIR, filename));
  }
  const manifest = buildManifest(stations, generatedAt);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`寫入 ${stations.length} 站：${indexed} 站有 600m 內站牌、${withoutStops} 站目前無站牌，共 ${stopRefs} 個 scope/StopUID 記錄`);
  console.log(`manifest：${path.relative(ROOT, MANIFEST_PATH)}`);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();

export { activeRailStations, activeTraStations, stableRailId };
