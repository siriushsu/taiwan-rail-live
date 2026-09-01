#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(ROOT, 'data', 'bus_transfer_pilot.json'), 'utf8'));
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

check('資料契約明示 pilot、使用者點開觸發、沒有 polling', () => {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.pilotOnly, true);
  assert.equal(data.trigger, 'user_open_only');
  assert.equal(data.polling, false);
});

check('垂直切片只有臺北／臺南／花蓮三站', () => {
  assert.deepEqual(Object.keys(data.stations).sort(), ['TRA:1000', 'TRA:4220', 'TRA:7000']);
  assert.deepEqual(Object.values(data.stations).map(station => station.name).sort(), ['臺北車站', '臺南車站', '花蓮車站'].sort());
});

check('每個 scope 最多 24 個 StopUID，所有站牌都在 600 公尺內且 routeStops 可解析', () => {
  for (const station of Object.values(data.stations)) {
    assert.equal(station.radiusM, 600);
    for (const scope of station.scopes) {
      assert(scope.stops.length > 0, `${station.name}/${scope.scope} 沒有站牌`);
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
});

check('每站同時涵蓋市區公車與公路客運 scope', () => {
  const expectedCity = { 'TRA:1000': 'City/Taipei', 'TRA:4220': 'City/Tainan', 'TRA:7000': 'City/HualienCounty' };
  for (const [id, station] of Object.entries(data.stations)) {
    const scopes = new Set(station.scopes.map(scope => scope.scope));
    assert(scopes.has(expectedCity[id]), `${station.name} 缺 ${expectedCity[id]}`);
    assert(scopes.has('InterCity'), `${station.name} 缺 InterCity`);
  }
});

check('臺南現行靜態資料有 102、沒有退役 2；臺北的 2 路不被跨城市誤殺', () => {
  const routeNames = stationId => data.stations[stationId].scopes.flatMap(scope => scope.routeRefs.map(ref => `${scope.scope}|${ref.routeName}`));
  const tainan = routeNames('TRA:4220');
  assert(tainan.includes('City/Tainan|102'), '臺南車站附近索引缺現行 102');
  assert(!tainan.includes('City/Tainan|2'), '臺南車站附近索引混入退役 2');
  assert(routeNames('TRA:1000').includes('City/Taipei|2'), '臺北仍在營運的 2 路被路線名稱誤殺');
});

check('generatedAt 是有效時間且所有路線／站牌必要識別欄位完整', () => {
  assert(Number.isFinite(Date.parse(data.generatedAt)));
  for (const station of Object.values(data.stations)) for (const scope of station.scopes) {
    for (const stop of scope.stops) assert(stop.stopUid && stop.stopName && Number.isFinite(stop.position.lat) && Number.isFinite(stop.position.lon));
    for (const ref of scope.routeRefs) assert(ref.key && ref.scope === scope.scope && ref.routeUid && ref.routeName);
  }
});

console.log(`RESULT failures=${failures} status=${failures ? 'RED' : 'GREEN'}`);
process.exit(failures ? 1 : 0);
