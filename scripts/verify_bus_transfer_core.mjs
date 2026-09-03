#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildNearbyScope,
  normalizeN1State,
  outdoorWalkEstimate,
  resolveBusLegVehicles,
  resolveBusRouteStops,
  resolveStationN1,
} from './bus_transfer_core.mjs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

const NOW = Date.parse('2026-09-01T14:05:00+08:00');
const position = (lat, lon) => ({ PositionLat: lat, PositionLon: lon });
const n1 = (overrides = {}) => ({
  RouteUID: 'TNN10170', RouteName: { Zh_tw: '14' }, SubRouteUID: 'TNN101700',
  Direction: 0, StopUID: 'TNN9140', StopStatus: 0, SrcUpdateTime: '2026-09-01T14:04:42+08:00',
  ...overrides,
});

check('戶外步行估算明示不含站內，且距離與分鐘單調增加', () => {
  const near = outdoorWalkEstimate({ lat: 25, lon: 121 }, { lat: 25.001, lon: 121 });
  const far = outdoorWalkEstimate({ lat: 25, lon: 121 }, { lat: 25.004, lon: 121 });
  assert.equal(near.kind, 'estimated_outdoor');
  assert.equal(near.includesIndoor, false);
  assert(near.straightLineM < far.straightLineM);
  assert(near.estimatedWalkMin < far.estimatedWalkMin);
  assert.equal(outdoorWalkEstimate(null, { lat: 25, lon: 121 }), null);
});

check('N1 有 EstimateTime 時會扣除資料年齡，不把快取前的秒數原封不動顯示', () => {
  const state = normalizeN1State(n1({ EstimateTime: 292 }), NOW);
  assert.equal(state.state, 'countdown');
  assert.equal(state.ageSec, 18);
  assert.equal(state.etaSec, 274);
});

check('N1 空值依 StopStatus 拆成尚未發車／末班已過／暫無預估／今日未營運', () => {
  assert.equal(normalizeN1State(n1({ StopStatus: 1 }), NOW).state, 'not_departed');
  assert.equal(normalizeN1State(n1({ StopStatus: 3 }), NOW).state, 'last_bus_passed');
  assert.equal(normalizeN1State(n1({ StopStatus: 0 }), NOW).state, 'no_estimate');
  assert.equal(normalizeN1State(n1({ StopStatus: 4 }), NOW).state, 'not_operating');
});

check('N1 資料超過 180 秒一律標 stale，但保留原始語意供診斷', () => {
  const state = normalizeN1State(n1({ EstimateTime: null, StopStatus: 1, SrcUpdateTime: '2026-09-01T14:00:00+08:00' }), NOW);
  assert.equal(state.state, 'stale');
  assert.equal(state.sourceState, 'not_departed');
  assert.equal(state.ageSec, 300);
});

const stopRows = [{
  RouteUID: 'TNN10170', RouteName: { Zh_tw: '14' }, SubRouteUID: 'TNN101700', SubRouteName: { Zh_tw: '14路 台南二中→慈濟高中' }, Direction: 0,
  Stops: [
    { StopUID: 'TNN9140', StopName: { Zh_tw: '臺南火車站(中山路C)' }, StopPosition: position(22.997061, 120.211189) },
    { StopUID: 'TNN9999', StopName: { Zh_tw: '很遠的站' }, StopPosition: position(23.2, 120.4) },
  ],
}];
const station = { id: 'TRA:4220', name: '臺南車站', position: { lat: 22.99681, lon: 120.21295 } };
const scope = buildNearbyScope({ station, scope: 'City/Tainan', stopOfRouteRows: stopRows, radiusM: 600, maxStopUids: 24 });

check('靜態索引只收半徑內站牌，並保留路線方向與終點', () => {
  assert.equal(scope.stops.length, 1);
  assert.equal(scope.stops[0].stopUid, 'TNN9140');
  assert.equal(scope.stops[0].routeStops.length, 1);
  assert.equal(scope.routeRefs.length, 1);
  assert.equal(scope.routeRefs[0].headsign, '很遠的站');
});

check('臺南退役 2 路 gate：不在當前靜態索引的 N1／候選不得進 arrivals', () => {
  const pilotStation = { ...station, scopes: [scope] };
  const result = resolveStationN1({
    pilotStation,
    nowMs: NOW,
    rowsByScope: {
      'City/Tainan': [
        n1({ EstimateTime: 292 }),
        n1({ RouteUID: 'TNN00002', RouteName: { Zh_tw: '2' }, SubRouteUID: 'TNN000020', EstimateTime: 120 }),
      ],
    },
  });
  assert.equal(result.arrivals.length, 1);
  assert.equal(result.arrivals[0].routeName, '14');
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].routeName, '2');
  assert.equal(result.rejected[0].reason, 'route_not_in_current_static_index');
});

check('臺北 N1 沒有 SubRouteUID 時，仍可用當前 StopUID＋RouteUID＋Direction 安全降級對應', () => {
  const taipeiScope = buildNearbyScope({
    station: { id: 'TRA:1000', name: '臺北車站', position: { lat: 25.04775, lon: 121.51711 } },
    scope: 'City/Taipei',
    radiusM: 600,
    stopOfRouteRows: [{
      RouteUID: 'TPE16111', RouteName: { Zh_tw: '307' }, SubRouteUID: 'TPE157462', SubRouteName: { Zh_tw: '307莒光往板橋前站' }, Direction: 1,
      Stops: [
        { StopUID: 'TPE15315', StopName: { Zh_tw: '臺北車站(忠孝)' }, StopPosition: position(25.0465408, 121.5167218) },
        { StopUID: 'TPE99999', StopName: { Zh_tw: '板橋前站' }, StopPosition: position(25.01, 121.46) },
      ],
    }],
  });
  const result = resolveStationN1({
    pilotStation: { id: 'TRA:1000', name: '臺北車站', position: { lat: 25.04775, lon: 121.51711 }, scopes: [taipeiScope] },
    rowsByScope: { 'City/Taipei': [{ RouteUID: 'TPE16111', RouteName: { Zh_tw: '307' }, Direction: 1, StopUID: 'TPE15315', EstimateTime: 180, StopStatus: 0, SrcUpdateTime: '2026-09-01T14:04:42+08:00' }] },
    nowMs: NOW,
  });
  assert.equal(result.arrivals.length, 1);
  assert.equal(result.arrivals[0].routeName, '307');
  assert.equal(result.arrivals[0].headsign, '板橋前站');
  assert.equal(result.arrivals[0].routeMatch, 'route_direction');
});

check('回應契約明示只由使用者開啟觸發、沒有 polling，位置與乘載另行按需載入', () => {
  const result = resolveStationN1({ pilotStation: { ...station, scopes: [scope] }, rowsByScope: { 'City/Tainan': [n1({ EstimateTime: 292 })] }, nowMs: NOW });
  assert.equal(result.trigger, 'user_open_only');
  assert.equal(result.polling, false);
  assert.equal(result.arrivals[0].vehicleBinding.state, 'not_loaded');
  assert.equal(result.arrivals[0].occupancy.state, 'not_provided');
  assert.equal(result.arrivals[0].access.includesIndoor, false);
});

const vehicleRow = (overrides = {}) => ({
  PlateNumb: 'EAL-2258', RouteUID: 'TPE16111', SubRouteUID: 'TPE157462', Direction: 1,
  BusPosition: position(25.04, 121.51), DutyStatus: 1, BusStatus: 0, GPSTime: '2026-09-01T14:04:40+08:00',
  ...overrides,
});
const a2Row = (overrides = {}) => ({
  PlateNumb: 'EAL-2258', RouteUID: 'TPE16111', SubRouteUID: 'TPE157462', Direction: 1,
  StopUID: 'TPE100', StopName: { Zh_tw: '前一站' }, StopSequence: 18, TripStartTimeType: 0,
  TripStartTime: '2026-09-01T13:30:00+08:00', GPSTime: '2026-09-01T14:04:40+08:00',
  ...overrides,
});
const arrival = {
  key: 'City/Taipei|TPE16111|TPE157462|1|TPE15315', scope: 'City/Taipei', routeUid: 'TPE16111',
  subRouteUid: 'TPE157462', direction: 1, stopUid: 'TPE15315', stopSequence: 20,
  vehicleBinding: { state: 'not_loaded', plate: null, plateHint: null },
};

check('沒有 N1 車牌時只回同路線方向候選集合，不硬綁某一台；A2 站序可算距目標幾站', () => {
  const result = resolveBusLegVehicles({ arrival, a1Rows: [vehicleRow()], a2Rows: [a2Row()], nowMs: NOW });
  assert.equal(result.trigger, 'user_route_open_only');
  assert.equal(result.polling, false);
  assert.equal(result.binding.state, 'candidate_set');
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].binding, 'route_candidate');
  assert.equal(result.vehicles[0].progress.stopsBefore, 2);
  assert.equal(result.vehicles[0].progress.state, 'approaching');
});

check('縣市 A1 有位置但沒有車牌時，保留匿名路線候選而不假造車牌或 A2 進度', () => {
  const hualienArrival = { ...arrival, scope: 'City/HualienCounty', routeUid: 'HUA0308', subRouteUid: 'HUA030802', direction: 1 };
  const result = resolveBusLegVehicles({
    arrival: hualienArrival,
    a1Rows: [vehicleRow({ PlateNumb: null, RouteUID: 'HUA0308', SubRouteUID: 'HUA030802', Direction: 1 })],
    a2Rows: [a2Row({ PlateNumb: null, RouteUID: 'HUA0308', SubRouteUID: 'HUA030802', Direction: 1 })],
    nowMs: NOW,
  });
  assert.equal(result.binding.state, 'candidate_set');
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].plate, null);
  assert.equal(result.vehicles[0].binding, 'route_candidate_unidentified');
  assert.equal(result.vehicles[0].progress.state, 'unknown');
  assert.equal(result.vehicles[0].occupancy.state, 'not_provided');
});

check('N1 提供的車牌必須在 A1/A2 同路線重新驗到才升級成 exact', () => {
  const hinted = { ...arrival, vehicleBinding: { state: 'not_loaded', plate: null, plateHint: 'EAL-2258' } };
  const exact = resolveBusLegVehicles({ arrival: hinted, a1Rows: [vehicleRow()], a2Rows: [a2Row()], nowMs: NOW });
  assert.deepEqual(exact.binding, { state: 'exact_n1_plate', plate: 'EAL-2258' });
  const missing = resolveBusLegVehicles({ arrival: { ...hinted, vehicleBinding: { ...hinted.vehicleBinding, plateHint: 'OTHER-1' } }, a1Rows: [vehicleRow()], a2Rows: [a2Row()], nowMs: NOW });
  assert.equal(missing.binding.state, 'candidate_set');
});

check('臺北只採官方 Level 0/1/2；其他縣市即使撞到同車牌也固定 not_provided', () => {
  const occupancyRows = [{ BusID: 'EAL2258', Level: 2 }];
  const taipei = resolveBusLegVehicles({ arrival, a1Rows: [vehicleRow()], a2Rows: [a2Row()], occupancyRows, occupancyUpdatedAt: '2026-09-01T14:04:30+08:00', nowMs: NOW });
  assert.equal(taipei.vehicles[0].occupancy.state, 'available');
  assert.equal(taipei.vehicles[0].occupancy.level, 'crowded');
  const tainanArrival = { ...arrival, scope: 'City/Tainan' };
  const tainan = resolveBusLegVehicles({ arrival: tainanArrival, a1Rows: [vehicleRow()], a2Rows: [a2Row()], occupancyRows, occupancyUpdatedAt: '2026-09-01T14:04:30+08:00', nowMs: NOW });
  assert.equal(tainan.vehicles[0].occupancy.state, 'not_provided');
});

check('兩個方向的站序都用各方向自己的遞增序列；過期 GPS 保留但 fresh=false', () => {
  const dir0Arrival = { ...arrival, direction: 0, subRouteUid: 'SUB0', stopSequence: 30 };
  const dir0 = resolveBusLegVehicles({
    arrival: dir0Arrival,
    a1Rows: [vehicleRow({ SubRouteUID: 'SUB0', Direction: 0, GPSTime: '2026-09-01T14:00:00+08:00' })],
    a2Rows: [a2Row({ SubRouteUID: 'SUB0', Direction: 0, StopSequence: 27 })],
    nowMs: NOW,
  });
  assert.equal(dir0.vehicles[0].progress.stopsBefore, 3);
  assert.equal(dir0.vehicles[0].fresh, false);
  const dir1 = resolveBusLegVehicles({ arrival, a1Rows: [vehicleRow()], a2Rows: [a2Row()], nowMs: NOW });
  assert.equal(dir1.vehicles[0].progress.stopsBefore, 2);
});

check('下車站只取上車站之後，兩個方向各自保留自己的站序', () => {
  const rows = [
    { RouteUID: 'R1', SubRouteUID: 'R1-0', Direction: 0, Stops: [
      { StopUID: 'A', StopName: { Zh_tw: '甲' }, StopSequence: 1 },
      { StopUID: 'B', StopName: { Zh_tw: '乙' }, StopSequence: 2 },
      { StopUID: 'C', StopName: { Zh_tw: '丙' }, StopSequence: 3 },
    ] },
    { RouteUID: 'R1', SubRouteUID: 'R1-1', Direction: 1, Stops: [
      { StopUID: 'C', StopName: { Zh_tw: '丙' }, StopSequence: 1 },
      { StopUID: 'B', StopName: { Zh_tw: '乙' }, StopSequence: 2 },
      { StopUID: 'A', StopName: { Zh_tw: '甲' }, StopSequence: 3 },
    ] },
  ];
  const dir0 = resolveBusRouteStops({ arrival: { routeUid: 'R1', subRouteUid: 'R1-0', direction: 0, stopUid: 'B', stopName: '乙' }, stopOfRouteRows: rows });
  const dir1 = resolveBusRouteStops({ arrival: { routeUid: 'R1', subRouteUid: 'R1-1', direction: 1, stopUid: 'B', stopName: '乙' }, stopOfRouteRows: rows });
  assert.equal(dir0.state, 'ready');
  assert.deepEqual(dir0.stops.map(stop => stop.stopName), ['丙']);
  assert.deepEqual(dir1.stops.map(stop => stop.stopName), ['甲']);
  assert.equal(dir0.stops[0].stopSequence, 3);
  assert.equal(dir1.stops[0].stopSequence, 3);
});

check('同 RouteUID 無法唯一判定支線時拒絕混站序', () => {
  const rows = [
    { RouteUID: 'R2', Direction: 0, Stops: [
      { StopUID: 'B', StopName: { Zh_tw: '乙' } }, { StopUID: 'C', StopName: { Zh_tw: '丙' } },
    ] },
    { RouteUID: 'R2', Direction: 0, Stops: [
      { StopUID: 'B', StopName: { Zh_tw: '乙' } }, { StopUID: 'D', StopName: { Zh_tw: '丁' } },
    ] },
  ];
  const result = resolveBusRouteStops({ arrival: { routeUid: 'R2', direction: 0, stopUid: 'B' }, stopOfRouteRows: rows });
  assert.equal(result.state, 'ambiguous');
  assert.deepEqual(result.stops, []);
  assert.equal(result.variants, 2);
});

console.log(`RESULT failures=${failures} status=${failures ? 'RED' : 'GREEN'}`);
process.exit(failures ? 1 : 0);
