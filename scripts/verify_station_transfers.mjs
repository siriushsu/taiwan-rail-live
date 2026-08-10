#!/usr/bin/env node
// 共站轉乘表資料 gate。TRANSFER_MUTATION 支援三種只在記憶體生效的語意突變，
// 用來證明配對上界、雙向路線完整性與 TRA 專屬來源都有被 gate 覆蓋；不會覆寫正式 JSON。

import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ROOT,
  OUTPUT,
  MAX_TRANSFER_DISTANCE_M,
  buildTransferData,
  haversineMeters,
  loadSourceData,
} from './build_station_transfers.mjs';

const mutation = process.env.TRANSFER_MUTATION || 'none';
const mutationModes = new Set(['none', 'zero-distance', 'drop-reverse-route', 'drop-tra-source']);
if (!mutationModes.has(mutation)) throw new Error(`未知 TRANSFER_MUTATION=${mutation}`);
const verifyDistanceM = mutation === 'zero-distance' ? 0.01 : MAX_TRANSFER_DISTANCE_M;
const reportPath = process.env.TRANSFER_VERIFY_REPORT ? path.resolve(ROOT, process.env.TRANSFER_VERIFY_REPORT) : null;
if (reportPath && path.relative(ROOT, reportPath).startsWith('..')) throw new Error('報告路徑不可離開 repo');

const lines = [];
const checks = [];
const log = text => { lines.push(text); console.log(text); };
const check = (name, fn) => {
  try { fn(); checks.push({ name, pass: true }); log(`PASS ${name}`); }
  catch (e) { checks.push({ name, pass: false }); log(`FAIL ${name} — ${e.message}`); }
};

log(`MODE mutation=${mutation} verifyDistanceM=${verifyDistanceM}`);
const product = JSON.parse(readFileSync(OUTPUT, 'utf8'));
if (mutation === 'drop-reverse-route') {
  const target = product.transferStations.find(group => group.members.includes('NTMC:Y07') && group.members.includes('TRTC:G04'));
  if (!target) throw new Error('drop-reverse-route 突變找不到大坪林群');
  target.routes = target.routes.filter(route => route !== 'TRTC:G');
  log(`MUTATION drop-reverse-route group=${target.id} removed=TRTC:G`);
}
const expected = buildTransferData({ maxDistanceM: verifyDistanceM, includeTra: mutation !== 'drop-tra-source' });
const source = loadSourceData();

check('產物與目前來源及配對規則完全一致', () => assert.deepEqual(product, expected));
check('涵蓋率具名斷言：12 系統／全網 562 站／579 路線會員', () => {
  assert.equal(product.stats.sourceSystems, 12);
  assert.equal(product.stats.stationRecords, 562);
  assert.equal(product.stats.routeMemberships, 579);
  assert.equal(Object.keys(product.stations).length, 562);
});
check('轉乘涵蓋具名斷言：58 轉乘站／涵蓋 109 站記錄／126 路線會員', () => {
  assert.equal(product.stats.transferStations, 58);
  assert.equal(product.stats.transferStationRecords, 109);
  assert.equal(product.stats.transferRouteMemberships, 126);
  assert.equal(product.stats.matchedStationPairs, 63);
});

const traSource = product.sourceSystems.find(system => system.system === 'TRA');
check('台鐵來源具名斷言：三檔接線／242 線網站／12 線／256 路線會員', () => {
  assert(traSource, '產物沒有 TRA sourceSystem');
  assert.equal(traSource.stationFile, 'data/tra_station_info.json');
  assert.equal(traSource.stationOfLineFile, 'data/tra_station_of_line.json');
  assert.equal(traSource.stationClassFile, 'data/tra_station_class.json');
  assert.equal(traSource.stationInfoRecords, 245);
  assert.equal(traSource.stationClassRecords, 210);
  assert.equal(traSource.stationRecords, 242);
  assert.equal(traSource.stationOfLines, 12);
  assert.equal(traSource.routeMemberships, 256);
});
check('台鐵專屬重建與產物一致', () => {
  const expectedTra = expected.sourceSystems.find(system => system.system === 'TRA');
  assert(expectedTra, '重建結果缺 TRA（台鐵來源路徑未被納入）');
  assert.deepEqual(traSource, expectedTra);
  const productStations = Object.fromEntries(Object.entries(product.stations).filter(([, station]) => station.system === 'TRA'));
  const expectedStations = Object.fromEntries(Object.entries(expected.stations).filter(([, station]) => station.system === 'TRA'));
  assert.deepEqual(productStations, expectedStations);
});

const groupsById = new Map(product.transferStations.map(group => [group.id, group]));
check('雙向一致：群路線完整，且每個 A 站→B 線都有 B 站→A 線', () => {
  for (const group of product.transferStations) {
    const memberRoutes = [...new Set(group.members.flatMap(key => product.stations[key].routes))].sort();
    assert.deepEqual(group.routes, memberRoutes, `${group.id} 的群路線不是會員路線完整聯集`);
  }
  for (const [stationKey, station] of Object.entries(product.stations)) {
    if (!station.transferId) continue;
    const group = groupsById.get(station.transferId);
    assert(group, `${stationKey} 指向不存在的 ${station.transferId}`);
    for (const targetRoute of group.routes.filter(route => !station.routes.includes(route))) {
      const reverseStations = group.members.filter(key => product.stations[key].routes.includes(targetRoute));
      assert(reverseStations.length, `${stationKey} 找不到 ${targetRoute} 的對應站`);
      for (const sourceRoute of station.routes) {
        assert(reverseStations.some(key => groupsById.get(product.stations[key].transferId).routes.includes(sourceRoute)),
          `${stationKey}/${sourceRoute} → ${targetRoute} 沒有反向`);
      }
    }
  }
});

const distances = [];
for (const group of product.transferStations) {
  for (let i = 0; i < group.members.length; i++) for (let j = i + 1; j < group.members.length; j++) {
    const a = product.stations[group.members[i]], b = product.stations[group.members[j]];
    distances.push({ distanceM: haversineMeters({ lat: a.position[0], lon: a.position[1] }, { lat: b.position[0], lon: b.position[1] }), a: group.members[i], b: group.members[j] });
  }
}
distances.sort((a, b) => a.distanceM - b.distanceM);
const median = distances[Math.floor((distances.length - 1) / 2)].distanceM;
const maximum = distances.at(-1).distanceM;
check('座標上界：每一組共站內任兩筆都小於 450m', () => {
  assert(distances.length > 0);
  for (const pair of distances) assert(pair.distanceM < product.criteria.maxDistanceM, `${pair.a} ↔ ${pair.b} = ${pair.distanceM.toFixed(1)}m`);
});
log(`DIST pairs=${distances.length} median=${median.toFixed(1)}m max=${maximum.toFixed(1)}m`);
for (const pair of distances.slice(-5).reverse()) log(`DIST_TOP ${pair.distanceM.toFixed(1)}m ${pair.a} <> ${pair.b}`);

const nameGroups = new Map();
for (const station of source.stations) {
  if (!nameGroups.has(station.transferName)) nameGroups.set(station.transferName, []);
  nameGroups.get(station.transferName).push(station);
}
const nameCollisionControls = [];
for (const [name, stations] of nameGroups) {
  const systems = new Set(stations.map(station => station.system));
  if (systems.size < 2) continue;
  const excludedPairs = [];
  for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
    if (stations[i].system === stations[j].system) continue;
    const distanceM = haversineMeters(stations[i], stations[j]);
    if (distanceM >= MAX_TRANSFER_DISTANCE_M) excludedPairs.push({ a: stations[i].key, b: stations[j].key, distanceM });
  }
  if (excludedPairs.length) nameCollisionControls.push({ name, excludedPairs });
}
nameCollisionControls.sort((a, b) => a.name.localeCompare(b.name));
check('撞名控制：同 canonical 名但距離不合格的跨系統 pair 全部排除', () => {
  assert(nameCollisionControls.length > 0);
  for (const item of nameCollisionControls) for (const pair of item.excludedPairs) {
    const a = product.stations[pair.a], b = product.stations[pair.b];
    assert(a && b, `${pair.a}／${pair.b} 不在產物`);
    assert(!a.transferId || a.transferId !== b.transferId, `${pair.a} ↔ ${pair.b} 被同名誤配`);
  }
  assert(nameCollisionControls.some(item => item.name === '嘉義'), '嘉義遠端高鐵控制不見了');
});
log(`NAME_COLLISION groups=${nameCollisionControls.length} excludedPairs=${nameCollisionControls.reduce((sum, item) => sum + item.excludedPairs.length, 0)}`);
for (const item of nameCollisionControls) {
  const minDistanceM = Math.min(...item.excludedPairs.map(pair => pair.distanceM));
  log(`NAME_COLLISION_EXCLUDED ${item.name} min=${minDistanceM.toFixed(1)}m ${item.excludedPairs.map(pair => `${pair.a}<>${pair.b}`).join(',')}`);
}

const idGroups = new Map();
for (const station of source.stations) {
  if (!idGroups.has(station.stationId)) idGroups.set(station.stationId, []);
  idGroups.get(station.stationId).push(station);
}
const idCollisionControls = [];
for (const [stationId, stations] of idGroups) {
  if (new Set(stations.map(station => station.system)).size < 2) continue;
  const excludedPairs = [];
  for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
    if (stations[i].system === stations[j].system) continue;
    const distanceM = haversineMeters(stations[i], stations[j]);
    if (stations[i].transferName !== stations[j].transferName || distanceM >= MAX_TRANSFER_DISTANCE_M)
      excludedPairs.push({ a: stations[i].key, b: stations[j].key, distanceM });
  }
  if (excludedPairs.length) idCollisionControls.push({ stationId, excludedPairs });
}
idCollisionControls.sort((a, b) => a.stationId.localeCompare(b.stationId));
check('撞號控制：跨系統同 StationID 只在站名規則與座標都合格時才可共站', () => {
  assert(idCollisionControls.length > 0);
  for (const item of idCollisionControls) for (const pair of item.excludedPairs) {
    const a = product.stations[pair.a], b = product.stations[pair.b];
    assert(!a.transferId || a.transferId !== b.transferId, `${pair.a} ↔ ${pair.b} 因跨系統撞號被誤配`);
  }
  assert(idCollisionControls.some(item => item.stationId === '0990'), '0990 南港／松山撞號控制不見了');
});
log(`ID_COLLISION groups=${idCollisionControls.length} excludedPairs=${idCollisionControls.reduce((sum, item) => sum + item.excludedPairs.length, 0)}`);
for (const item of idCollisionControls) log(`ID_COLLISION_EXCLUDED ${item.stationId} ${item.excludedPairs.map(pair => `${pair.a}<>${pair.b}:${pair.distanceM.toFixed(1)}m`).join(',')}`);

const reverseControls = [
  ['NTMC:Y07', 'TRTC:G04', '大坪林'],
  ['NTMC:Y11', 'TRTC:O02', '景安'],
  ['NTMC:Y18', 'TRTC:O17', '頭前庄'],
  ['TRA:3340', 'THSR:1040', '新烏日／高鐵台中'],
  ['TRA:4340', 'KRTC:R16', '新左營／高捷左營'],
];
check('反向控制：原三組 0m 共站與台鐵異名共構站都成功配對', () => {
  for (const [a, b, label] of reverseControls) {
    assert(product.stations[a] && product.stations[b], `${label} 來源站不存在`);
    assert.equal(product.stations[a].transferId, product.stations[b].transferId, `${label} 未共站`);
    assert(product.stations[a].transferId, `${label} 沒有轉乘群`);
    const group = groupsById.get(product.stations[a].transferId);
    assert(group.routes.some(route => product.stations[a].routes.includes(route)) && group.routes.some(route => product.stations[b].routes.includes(route)), `${label} 路線未雙向收錄`);
  }
});
log(`REVERSE_CONTROLS ${reverseControls.map(control => control[2]).join('、')}`);

const traInternalControls = [
  ['TRA:0920', ['TRA:EL', 'TRA:WL'], '八堵'],
  ['TRA:7330', ['TRA:EL', 'TRA:PX'], '三貂嶺'],
  ['TRA:7360', ['TRA:EL', 'TRA:SA'], '瑞芳'],
];
check('台鐵同系統多線反向控制：八堵／三貂嶺／瑞芳皆保留全部線別', () => {
  for (const [stationKey, routes, label] of traInternalControls) {
    const station = product.stations[stationKey];
    assert(station && station.transferId, `${label} 沒有轉乘群`);
    const group = groupsById.get(station.transferId);
    for (const route of routes) assert(group.routes.includes(route), `${label} 缺 ${route}`);
  }
});
log(`TRA_INTERNAL_CONTROLS ${traInternalControls.map(control => control[2]).join('、')}`);

const routeLabel = routeKey => {
  const route = product.routes[routeKey];
  return route && (route.name || (routeKey === 'THSR:THSR' ? '高鐵' : route.lineId));
};
const sampleCases = [
  ['TRA:1000', '台北', ['THSR:THSR', 'TRTC:BL', 'TRTC:R', 'TYMC:A']],
  ['TRA:1020', '板橋', ['NTMC:Y', 'THSR:THSR', 'TRTC:BL']],
  ['TRA:0980', '南港', ['THSR:THSR', 'TRTC:BL']],
  ['TRA:0990', '松山', ['TRTC:G']],
  ['TRA:1010', '萬華', []],
  ['TRA:1100', '中壢', []],
  ['TRA:3340', '新烏日', ['THSR:THSR', 'TMRT:G']],
  ['TRA:4340', '新左營', ['KRTC:R', 'THSR:THSR']],
  ['TRA:4080', '嘉義', ['AFR:1']],
  ['TRA:7000', '花蓮', []],
];
check('十站抽驗具名斷言：台鐵站的跨系統轉乘路線完全符合預期', () => {
  for (const [stationKey, label, expectedRoutes] of sampleCases) {
    const station = product.stations[stationKey];
    assert(station, `${label} 不在產物`);
    const group = station.transferId && groupsById.get(station.transferId);
    const actual = (group ? group.routes : station.routes).filter(routeKey => product.routes[routeKey].system !== 'TRA').sort();
    assert.deepEqual(actual, [...expectedRoutes].sort(), `${label} 實得 ${actual.join(',') || '無'}`);
  }
});
for (const [stationKey, label] of sampleCases) {
  const station = product.stations[stationKey];
  const group = station.transferId && groupsById.get(station.transferId);
  const routes = (group ? group.routes : station.routes).filter(routeKey => product.routes[routeKey].system !== 'TRA');
  log(`SAMPLE ${label} ${routes.length ? routes.map(routeKey => `${routeKey}=${routeLabel(routeKey)}`).join('、') : '無'}`);
}

const missingLines = product.sourceSystems.filter(system => !system.lineFile).map(system => system.system).sort();
check('來源限制具名：SANYING／THSR／TRA 無獨立 Line 檔，TRA 線名由受控 LineID 表補足', () => {
  assert.deepEqual(missingLines, ['SANYING', 'THSR', 'TRA']);
  assert.equal(traSource.routeNameSource, 'scripts/build_station_transfers.mjs#TRA_LINE_NAMES');
  assert.equal(Object.keys(product.routes).filter(route => route.startsWith('TRA:')).length, 12);
});
log(`SOURCE_LIMITS missingLine=${missingLines.join(',')} traRouteNames=${traSource.routeNameSource}`);

const failures = checks.filter(item => !item.pass);
log(`RESULT checks=${checks.length} failures=${failures.length} status=${failures.length ? 'RED' : 'GREEN'}`);
if (reportPath) writeFileSync(reportPath, lines.join('\n') + '\n');
process.exit(failures.length ? 1 : 0);
