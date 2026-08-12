#!/usr/bin/env node
// TDX 各系統資料＋repo 台鐵精簡站點／路線資料 → 共站轉乘表。
//
// 配對不是只看站名：不同 Station 記錄必須同時通過「有限正規化後名稱完全相同」與
// Haversine 距離上界。StationID 只在自己的系統內當鍵，避免跨系統撞號。
// 用法：node scripts/build_station_transfers.mjs

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TDX_DIR = path.join(ROOT, 'data', 'tdx');
export const OUTPUT = path.join(ROOT, 'data', 'station_transfers.json');
// 450 不是隨手取的整數：TDX 對同一站體的各系統月台給各自座標，目前**合格**候選的最大實測值是
// 412.0m（北捷台北車站 ↔ 機捷 A1），450 只留 38m 給上游座標抖動。往上調會開始把「相鄰但不同站」
// 收進來（純距離分群在 812.9m 就把北門串進台北群，所以名稱閘門不能拿掉）；往下調會先斷掉
// 高鐵台中 ↔ 台鐵新烏日（389.5m）。要動這個數字，先重跑 verify 看 63 組配對的分布再說。
export const MAX_TRANSFER_DISTANCE_M = 450;
export const TRA_LINE_NAMES = Object.freeze({
  CZ: '成追線',
  EL: '東部幹線',
  JJ: '集集線',
  LJ: '六家線',
  NW: '內灣線',
  PX: '平溪線',
  SA: '深澳線',
  SH: '沙崙線',
  SL: '南迴線',
  SU: '蘇澳線',
  WL: '西部幹線（山線）',
  'WL-C': '海線',
});

// TDX 各系統對同一高鐵共構站的正式命名不同；只以系統內 StationID 明列已知別名，
// 後續仍須通過與一般候選完全相同的座標上界，不能只靠這張字串表配對。
export const TRANSFER_NAME_ALIASES = Object.freeze({
  'TRA:1194': '新竹',       // 六家 ↔ 高鐵新竹
  'TRA:3150': '苗栗',       // 豐富 ↔ 高鐵苗栗
  'TRA:3340': '台中',       // 新烏日 ↔ 高鐵／中捷台中
  'TRA:4272': '台南',       // 沙崙 ↔ 高鐵台南
  'TRA:4340': '左營',       // 新左營 ↔ 高鐵／高捷左營
});

function readCollection(file, key, { optional = false } = {}) {
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) {
    if (optional && e && e.code === 'ENOENT') return null;
    throw new Error(`無法讀取 ${path.relative(ROOT, file)}：${e.message}`);
  }
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw[key])) return raw[key];
  throw new Error(`${path.relative(ROOT, file)} 頂層必須是陣列或含 ${key} 陣列`);
}

export function normalizeStationName(name) {
  return String(name || '').normalize('NFKC')
    .replace(/臺/g, '台')
    .replace(/^(高鐵|台鐵)/, '')
    .replace(/火車站$/, '')
    .replace(/車站$/, '')
    .replace(/站$/, '')
    .trim();
}

export function haversineMeters(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const q = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(q));
}

function routeName(line) {
  return line && line.LineName && (line.LineName.Zh_tw || line.LineName.En) || null;
}

function loadTraSourceData(root) {
  const stationOfLineRel = 'data/tra_station_of_line.json';
  const stationInfoRel = 'data/tra_station_info.json';
  const stationClassRel = 'data/tra_station_class.json';
  const stationOfLine = JSON.parse(readFileSync(path.join(root, stationOfLineRel), 'utf8'));
  const stationInfo = JSON.parse(readFileSync(path.join(root, stationInfoRel), 'utf8'));
  const stationClass = JSON.parse(readFileSync(path.join(root, stationClassRel), 'utf8'));
  if (!stationOfLine || !Array.isArray(stationOfLine.lines))
    throw new Error(`${stationOfLineRel} 頂層必須含 lines 陣列`);
  if (!stationInfo || Array.isArray(stationInfo) || typeof stationInfo !== 'object')
    throw new Error(`${stationInfoRel} 頂層必須是站名到站點資訊的 object`);
  if (!stationClass || Array.isArray(stationClass) || typeof stationClass !== 'object' ||
      Object.values(stationClass).some(value => typeof value !== 'string'))
    throw new Error(`${stationClassRel} 頂層必須是站名到站等字串的 object`);

  const infoRows = Object.values(stationInfo);
  const infoById = new Map();
  for (const station of infoRows) {
    const stationId = String(station && station.id || '');
    if (!/^\d{4}$/.test(stationId) || !station.name || !Number.isFinite(station.lat) || !Number.isFinite(station.lon))
      throw new Error(`${stationInfoRel} 有缺四位 id／站名／座標的站`);
    if (infoById.has(stationId)) throw new Error(`${stationInfoRel} 的 id ${stationId} 重複`);
    infoById.set(stationId, station);
  }

  const routes = {};
  const memberships = new Map();
  for (const line of stationOfLine.lines) {
    const lineId = String(line && line.lineId || '');
    if (!lineId || !Array.isArray(line.stations)) throw new Error(`${stationOfLineRel} 有缺 lineId／stations 的線`);
    if (!TRA_LINE_NAMES[lineId]) throw new Error(`${stationOfLineRel} 有未知台鐵 lineId ${lineId}`);
    const routeKey = `TRA:${lineId}`;
    routes[routeKey] = {
      system: 'TRA',
      lineId,
      name: TRA_LINE_NAMES[lineId],
      lineDefinition: stationOfLineRel,
    };
    for (const member of line.stations) {
      const stationId = String(member && member.id || '');
      const info = infoById.get(stationId);
      if (!/^\d{4}$/.test(stationId) || !info) throw new Error(`${stationOfLineRel} 的 ${lineId} 引用了 info 不存在的四位站碼 ${stationId || '(空)'}`);
      if (member.name !== info.name) throw new Error(`${stationOfLineRel} 的 ${stationId} 站名 ${member.name} 與 info ${info.name} 不同`);
      if (!memberships.has(stationId)) memberships.set(stationId, new Set());
      memberships.get(stationId).add(routeKey);
    }
  }

  const stations = [];
  for (const [stationId, stationRoutes] of memberships) {
    const info = infoById.get(stationId);
    const key = `TRA:${stationId}`;
    stations.push({
      key,
      system: 'TRA',
      stationId,
      name: info.name,
      normalizedName: normalizeStationName(info.name),
      transferName: normalizeStationName(TRANSFER_NAME_ALIASES[key] || info.name),
      lat: info.lat,
      lon: info.lon,
      routes: [...stationRoutes].sort(),
    });
  }

  return {
    stations,
    routes,
    sourceSystem: {
      system: 'TRA',
      stationFile: stationInfoRel,
      stationOfLineFile: stationOfLineRel,
      stationClassFile: stationClassRel,
      lineFile: null,
      routeNameSource: 'scripts/build_station_transfers.mjs#TRA_LINE_NAMES',
      stationInfoRecords: infoRows.length,
      stationClassRecords: Object.keys(stationClass).length,
      stationRecords: stations.length,
      stationOfLines: stationOfLine.lines.length,
      routeMemberships: [...memberships.values()].reduce((sum, set) => sum + set.size, 0),
    },
  };
}

export function loadSourceData(root = ROOT, { includeTra = true } = {}) {
  const tdxDir = path.join(root, 'data', 'tdx');
  const prefixes = readdirSync(tdxDir)
    .map(file => /^(.+)_Station\.json$/.exec(file))
    .filter(Boolean)
    .map(match => match[1])
    .sort();

  const stations = [];
  const routes = {};
  const sourceSystems = [];

  for (const system of prefixes) {
    const stationRel = `data/tdx/${system}_Station.json`;
    const stationOfLineRel = `data/tdx/${system}_StationOfLine.json`;
    const lineRel = `data/tdx/${system}_Line.json`;
    const stationRows = readCollection(path.join(root, stationRel), 'Stations');
    const stationOfLines = readCollection(path.join(root, stationOfLineRel), 'StationOfLines');
    const lineRows = readCollection(path.join(root, lineRel), 'Lines', { optional: true });
    const lineById = new Map((lineRows || []).map(line => [String(line.LineID), line]));
    const memberships = new Map();

    for (const line of stationOfLines) {
      const lineId = String(line.LineID || '');
      if (!lineId) throw new Error(`${stationOfLineRel} 有缺 LineID 的記錄`);
      const key = `${system}:${lineId}`;
      if (!routes[key]) routes[key] = {
        system,
        lineId,
        name: routeName(lineById.get(lineId)),
        lineDefinition: lineById.has(lineId) ? lineRel : null,
      };
      for (const member of line.Stations || []) {
        const stationId = String(member.StationID || '');
        if (!stationId) throw new Error(`${stationOfLineRel} 的 ${lineId} 有缺 StationID 的站`);
        if (!memberships.has(stationId)) memberships.set(stationId, new Set());
        memberships.get(stationId).add(key);
      }
    }

    const sourceIds = new Set();
    for (const station of stationRows) {
      const stationId = String(station.StationID || '');
      const name = station.StationName && station.StationName.Zh_tw;
      const lat = station.StationPosition && station.StationPosition.PositionLat;
      const lon = station.StationPosition && station.StationPosition.PositionLon;
      if (!stationId || !name || !Number.isFinite(lat) || !Number.isFinite(lon))
        throw new Error(`${stationRel} 有缺 StationID／中文站名／座標的站`);
      if (sourceIds.has(stationId)) throw new Error(`${stationRel} 的 StationID ${stationId} 重複`);
      sourceIds.add(stationId);
      const stationRoutes = [...(memberships.get(stationId) || [])].sort();
      if (!stationRoutes.length) throw new Error(`${stationRel} 的 ${stationId} 未出現在 StationOfLine`);
      stations.push({
        key: `${system}:${stationId}`,
        system,
        stationId,
        name,
        normalizedName: normalizeStationName(name),
        transferName: normalizeStationName(TRANSFER_NAME_ALIASES[`${system}:${stationId}`] || name),
        lat,
        lon,
        routes: stationRoutes,
      });
    }
    for (const stationId of memberships.keys()) {
      if (!sourceIds.has(stationId)) throw new Error(`${stationOfLineRel} 引用了 Station 檔不存在的 ${stationId}`);
    }

    sourceSystems.push({
      system,
      stationFile: stationRel,
      stationOfLineFile: stationOfLineRel,
      lineFile: lineRows ? lineRel : null,
      stationRecords: stationRows.length,
      stationOfLines: stationOfLines.length,
      routeMemberships: [...memberships.values()].reduce((sum, set) => sum + set.size, 0),
    });
  }

  if (includeTra) {
    const tra = loadTraSourceData(root);
    stations.push(...tra.stations);
    Object.assign(routes, tra.routes);
    sourceSystems.push(tra.sourceSystem);
  }

  stations.sort((a, b) => a.key.localeCompare(b.key));
  sourceSystems.sort((a, b) => a.system.localeCompare(b.system));
  return { stations, routes: Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b))), sourceSystems };
}

function makeGroups(stations, maxDistanceM) {
  const parent = stations.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
    if (stations[i].transferName !== stations[j].transferName) continue;
    if (haversineMeters(stations[i], stations[j]) < maxDistanceM) union(i, j);
  }

  const components = new Map();
  for (let i = 0; i < stations.length; i++) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(stations[i]);
  }

  return [...components.values()]
    .map(members => {
      members.sort((a, b) => a.key.localeCompare(b.key));
      const groupRoutes = [...new Set(members.flatMap(member => member.routes))].sort();
      if (groupRoutes.length < 2) return null;
      const pairs = [];
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        const distanceM = haversineMeters(members[i], members[j]);
        if (members[i].transferName !== members[j].transferName || distanceM >= maxDistanceM) {
          throw new Error(`共站群 ${members[0].transferName} 不是 complete-link：${members[i].key} ↔ ${members[j].key} ${distanceM.toFixed(1)}m`);
        }
        pairs.push({ a: members[i].key, b: members[j].key, distanceM: +distanceM.toFixed(3) });
      }
      return {
        id: `T-${members[0].key.replace(':', '-')}`,
        normalizedName: members[0].transferName,
        members: members.map(member => member.key),
        routes: groupRoutes,
        pairs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildTransferData({ root = ROOT, maxDistanceM = MAX_TRANSFER_DISTANCE_M, includeTra = true } = {}) {
  if (!(maxDistanceM > 0)) throw new Error('maxDistanceM 必須大於 0');
  const source = loadSourceData(root, { includeTra });
  const groups = makeGroups(source.stations, maxDistanceM);
  const transferIdByStation = new Map(groups.flatMap(group => group.members.map(key => [key, group.id])));
  const stations = {};
  for (const station of source.stations) stations[station.key] = {
    system: station.system,
    stationId: station.stationId,
    name: station.name,
    normalizedName: station.normalizedName,
    transferName: station.transferName,
    position: [station.lat, station.lon],
    routes: station.routes,
    transferId: transferIdByStation.get(station.key) || null,
  };

  const transferStationRecords = groups.reduce((sum, group) => sum + group.members.length, 0);
  const transferRouteMemberships = groups.reduce((sum, group) => sum + group.routes.length, 0);
  return {
    schemaVersion: 1,
    criteria: {
      maxDistanceM,
      distanceRule: 'haversine_meters < maxDistanceM',
      nameRule: 'NFKC; 臺→台; remove leading 高鐵/台鐵; remove trailing 火車站/車站/站; exact equality; scoped StationID aliases only',
      stationIdScope: 'system',
    },
    sourceSystems: source.sourceSystems,
    routes: source.routes,
    stations,
    transferStations: groups,
    stats: {
      sourceSystems: source.sourceSystems.length,
      stationRecords: source.stations.length,
      routeMemberships: source.stations.reduce((sum, station) => sum + station.routes.length, 0),
      matchedStationPairs: groups.reduce((sum, group) => sum + group.pairs.length, 0),
      transferStations: groups.length,
      transferStationRecords,
      transferRouteMemberships,
    },
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const out = buildTransferData();
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`station_transfers: ${out.stats.stationRecords} 站 → ${out.stats.transferStations} 個轉乘站（${out.stats.matchedStationPairs} 組座標配對）`);
  console.log(`缺 Line 定義：${out.sourceSystems.filter(system => !system.lineFile).map(system => system.system).join('、') || '無'}`);
  console.log(`→ ${path.relative(ROOT, OUTPUT)}`);
}
