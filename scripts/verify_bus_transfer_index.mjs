#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'bus_transfer_stations.json'), 'utf8'));
const schedule = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tra_schedule.json'), 'utf8'));
const stationInfo = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tra_station_info.json'), 'utf8'));
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};
const stnKey = name => String(name).replace(/臺/g, '台').replace(/\s*\([^)]*\)\s*$/, '').trim();
const infoByName = new Map(Object.entries(stationInfo).flatMap(([key, value]) => [[stnKey(key), value], [stnKey(value.name), value]]));
const scheduleNames = [...new Set(schedule.trains.flatMap(train => train.stops.map(stop => stop.name)))];
const scheduleKeys = new Set(scheduleNames.map(stnKey));
const nearbyAliasBase = name => {
  const key = stnKey(name);
  const dash = key.indexOf('-');
  if (dash <= 0 || !scheduleKeys.has(key.slice(0, dash))) return name;
  const alias = infoByName.get(key);
  const base = infoByName.get(key.slice(0, dash));
  if (!alias || !base) return name;
  const avgLatRad = ((Number(alias.lat) + Number(base.lat)) / 2) * Math.PI / 180;
  const dy = (Number(alias.lat) - Number(base.lat)) * 111_320;
  const dx = (Number(alias.lon) - Number(base.lon)) * 111_320 * Math.cos(avgLatRad);
  return Math.hypot(dx, dy) <= 200 ? base.name : name;
};
const physicalNames = [...new Set(scheduleNames.map(nearbyAliasBase))];
const stationProducts = Object.fromEntries(Object.entries(manifest.stations).map(([id, meta]) => {
  const assetPath = path.join(ROOT, meta.asset);
  assert(existsSync(assetPath), `${id} 缺 ${meta.asset}`);
  return [id, { meta, assetPath, data: JSON.parse(readFileSync(assetPath, 'utf8')) }];
}));

check('資料契約明示全臺營運台鐵站、使用者點開觸發、沒有 polling', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.coverage, 'all_active_tra_stations');
  assert.equal(manifest.trigger, 'user_open_only');
  assert.equal(manifest.polling, false);
  assert.equal(manifest.stationCount, Object.keys(manifest.stations).length);
});

check('目前班表的 239 座實體客運站全部有唯一索引，別名站、維修基地與已停靠站不混入', () => {
  assert.equal(scheduleNames.length, 240);
  assert.equal(physicalNames.length, 239);
  assert.equal(manifest.stationCount, physicalNames.length);
  const expectedIds = physicalNames.map(name => {
    const info = infoByName.get(stnKey(name));
    assert(info, `班表站 ${name} 缺 tra_station_info`);
    return `TRA:${info.id}`;
  }).sort();
  assert.deepEqual(Object.keys(manifest.stations).sort(), expectedIds);
  for (const forbidden of ['TRA:1001', 'TRA:1998', 'TRA:5170', 'TRA:5998', 'TRA:5999', 'TRA:7140']) {
    assert(!manifest.stations[forbidden], `非目前客運停靠站 ${forbidden} 混入`);
  }
});

check('每站獨立檔案且不超過 128 KiB，全臺索引總量不超過 5 MiB', () => {
  let total = 0;
  for (const [id, product] of Object.entries(stationProducts)) {
    const bytes = statSync(product.assetPath).size;
    total += bytes;
    assert(bytes <= 128 * 1024, `${id} 單站索引 ${bytes} bytes 過大`);
    assert.equal(product.data.station.id, id);
    assert.equal(product.data.generatedAt, manifest.generatedAt);
    assert.equal(product.data.coverage, manifest.coverage);
  }
  assert(total <= 5 * 1024 * 1024, `全臺分站索引 ${total} bytes 過大`);
});

check('每個 scope 最多 24 個 StopUID，所有站牌都在 600 公尺內且 routeStops 可解析', () => {
  let indexed = 0;
  let withoutStops = 0;
  for (const { data } of Object.values(stationProducts)) {
    const station = data.station;
    assert.equal(station.radiusM, 600);
    assert.equal(station.nearbyStopCount, station.scopes.reduce((sum, scope) => sum + scope.stops.length, 0));
    if (station.coverageState === 'no_nearby_stops') {
      withoutStops += 1;
      assert.equal(station.nearbyStopCount, 0);
      assert.deepEqual(station.scopes, []);
      continue;
    }
    indexed += 1;
    assert.equal(station.coverageState, 'indexed');
    assert(station.nearbyStopCount > 0);
    for (const scope of station.scopes) {
      assert(scope.scope === 'InterCity' || scope.scope.startsWith('City/'), `${station.name} scope 非法`);
      assert(scope.stops.length > 0, `${station.name}/${scope.scope} 空 scope 未濾除`);
      assert(scope.stops.length <= 24, `${station.name}/${scope.scope} 超過 24 個 StopUID`);
      const refs = new Set(scope.routeRefs.map(ref => ref.key));
      assert.equal(refs.size, scope.routeRefs.length, `${station.name}/${scope.scope} route ref 重複`);
      for (const stop of scope.stops) {
        assert(stop.access.straightLineM <= 600, `${station.name}/${stop.stopUid} 距離 ${stop.access.straightLineM}m`);
        assert.equal(stop.access.includesIndoor, false);
        assert(stop.routeStops.length > 0, `${station.name}/${stop.stopUid} 沒有路線`);
        for (const routeStop of stop.routeStops) {
          assert(refs.has(routeStop.routeKey), `${station.name}/${stop.stopUid} 指向不存在的 ${routeStop.routeKey}`);
          assert(routeStop.stopSequence == null || Number.isFinite(routeStop.stopSequence), `${station.name}/${stop.stopUid} 站序不是數字`);
        }
      }
    }
  }
  assert(indexed >= 200, `只有 ${indexed} 個營運站有附近公車索引`);
  assert(indexed + withoutStops === manifest.stationCount);
});

check('臺南現行靜態資料有 102、沒有退役 2；臺北的 2 路不被跨城市誤殺', () => {
  const routeNames = stationId => stationProducts[stationId].data.station.scopes.flatMap(scope => scope.routeRefs.map(ref => `${scope.scope}|${ref.routeName}`));
  const tainan = routeNames('TRA:4220');
  assert(tainan.includes('City/Tainan|102'), '臺南車站附近索引缺現行 102');
  assert(!tainan.includes('City/Tainan|2'), '臺南車站附近索引混入退役 2');
  assert(routeNames('TRA:1000').includes('City/Taipei|2'), '臺北仍在營運的 2 路被路線名稱誤殺');
});

check('所有路線／站牌必要識別欄位完整', () => {
  assert(Number.isFinite(Date.parse(manifest.generatedAt)));
  for (const { data } of Object.values(stationProducts)) for (const scope of data.station.scopes) {
    for (const stop of scope.stops) assert(stop.stopUid && stop.stopName && Number.isFinite(stop.position.lat) && Number.isFinite(stop.position.lon));
    for (const ref of scope.routeRefs) assert(ref.key && ref.scope === scope.scope && ref.routeUid && ref.routeName);
  }
});

console.log(`RESULT failures=${failures} status=${failures ? 'RED' : 'GREEN'}`);
process.exit(failures ? 1 : 0);
