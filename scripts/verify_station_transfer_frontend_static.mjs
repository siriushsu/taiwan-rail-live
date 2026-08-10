#!/usr/bin/env node
// Browser 被環境阻擋時仍可跑的前端靜態／資料接線 gate；不能取代真實排版驗證。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const transfers = JSON.parse(readFileSync(path.join(ROOT, 'data/station_transfers.json'), 'utf8'));
const tra = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
const thsr = JSON.parse(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'), 'utf8'));

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, pass: false }); console.log(`FAIL ${name} — ${e.message}`); }
};

check('index.html inline JavaScript 語法可解析', () => {
  let parsed = 0;
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/.test(attrs) || /type=["']application\/(?:ld\+json|json)["']/.test(attrs)) continue;
    new vm.Script(match[2], { filename: `index-inline-${parsed + 1}.js` });
    parsed++;
  }
  assert(parsed > 0);
});

check('BUILD／更新紀錄／本地資料載入接線齊全', () => {
  assert.match(html, /const BUILD = 'v0810a'/);
  assert.match(html, /最後更新：2026\/8\/10/);
  assert.match(html, /data-cl-of="stationtransfer"/);
  assert.match(html, /data-cl="stationtransfer"/);
  assert.match(html, /fetchJSON\('\.\/data\/station_transfers\.json'\)/);
});

check('最近更新仍維持八條上限，且每條都在完整歷史有正本', () => {
  const recent = /<ul class="foot-list foot-recent">([\s\S]*?)<\/ul>/.exec(html)?.[1] || '';
  const refs = [...recent.matchAll(/data-cl-of="([^"]+)"/g)].map(match => match[1]);
  assert.equal(refs.length, 8);
  for (const ref of refs) assert(html.includes(`data-cl="${ref}"`), `${ref} 缺完整歷史正本`);
});

const rad = Math.PI / 180;
const distanceKm = (a, b) => {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(q));
};
const groups = new Map(transfers.transferStations.map(group => [group.id, group]));
const anchors = Object.entries(transfers.stations).map(([key, station]) => ({ key, station, lat: station.position[0], lon: station.position[1] }));
const normalizeName = name => String(name || '').normalize('NFKC').replace(/臺/g, '台').replace(/^(高鐵|台鐵)/, '')
  .replace(/火車站$/, '').replace(/車站$/, '').replace(/站$/, '').trim();
const anchorsBySystemName = new Map();
for (const anchor of anchors) {
  const key = `${anchor.station.system}|${anchor.station.normalizedName}`;
  if (!anchorsBySystemName.has(key)) anchorsBySystemName.set(key, []);
  anchorsBySystemName.get(key).push(anchor);
}
const routesFor = (sys, stop) => {
  const source = { tra_sched: 'TRA', thsr_sched: 'THSR', afr_sched: 'AFR' }[sys] || null;
  if (!source) return [];
  const nearest = (anchorsBySystemName.get(`${source}|${normalizeName(stop.name)}`) || [])
    .map(anchor => ({ anchor, km: distanceKm(stop, anchor) }))
    .filter(item => item.km < transfers.criteria.maxDistanceM / 1000)
    .sort((a, b) => a.km - b.km)[0];
  if (!nearest) return [];
  const station = nearest.anchor.station;
  const keys = station.transferId ? groups.get(station.transferId).routes : station.routes;
  return keys.filter(key => transfers.routes[key].system !== source);
};

check('前端台鐵與其他時刻系統共用「系統＋站名索引」查表，不留 200m 最近 anchor fallback', () => {
  assert.match(html, /const TRANSFER_SCHED_SYSTEM = \{ tra_sched: 'TRA', thsr_sched: 'THSR', afr_sched: 'AFR' \}/);
  assert.match(html, /state\.stationTransferBySystemName\.get\(sourceSystem \+ '\|' \+ transferStationName\(stop\.name\)\)/);
  assert.doesNotMatch(html, /sourceSystem \? 0\.005 : 0\.2/);
});

check('實際抽取前端查表函式：臺北跨系統與三貂嶺同系統支線都能回傳', () => {
  const source = /\/\/ 靜態轉乘表索引。[\s\S]*?(?=function transferHintHtml)/.exec(html)?.[0];
  assert(source, '找不到前端轉乘函式區塊');
  const context = {
    state: {},
    haversineKm: distanceKm,
  };
  vm.runInNewContext(`${source}\nglobalThis.__transferApi = { initStationTransfers, transferRoutesForStop };`, context, { filename: 'station-transfer-logic.js' });
  context.__transferApi.initStationTransfers(transfers);
  const stationStop = key => {
    const station = transfers.stations[key];
    return { name: station.name, lat: station.position[0], lon: station.position[1] };
  };
  const taipeiStops = [stationStop('TRA:1010'), stationStop('TRA:1000'), stationStop('TRA:0990')];
  const taipeiRoutes = context.__transferApi.transferRoutesForStop({ sys: 'tra_sched', stops: taipeiStops }, taipeiStops[1]).map(route => route.key);
  assert.deepEqual(new Set(taipeiRoutes), new Set(['THSR:THSR', 'TRTC:BL', 'TRTC:R', 'TYMC:A']));
  const sandiaolingStops = [stationStop('TRA:7320'), stationStop('TRA:7330'), stationStop('TRA:7350')];
  const sandiaolingRoutes = Array.from(context.__transferApi.transferRoutesForStop({ sys: 'tra_sched', stops: sandiaolingStops }, sandiaolingStops[1]), route => route.key);
  assert.deepEqual(sandiaolingRoutes, ['TRA:PX']);
});

check('具名台鐵臺北案例由 TRA 本身節點得到四條跨系統轉乘路線', () => {
  const stop = tra.trains.flatMap(train => train.stops).find(item => item.name === '臺北');
  assert(stop);
  assert.deepEqual(new Set(routesFor('tra_sched', stop)), new Set(['THSR:THSR', 'TRTC:BL', 'TRTC:R', 'TYMC:A']));
});
check('具名高鐵台北案例排除本線後得到台鐵＋三條捷運路線', () => {
  const stop = thsr.trains.flatMap(train => train.stops).find(item => item.name === '台北');
  assert(stop);
  assert.deepEqual(new Set(routesFor('thsr_sched', stop)), new Set(['TRA:WL', 'TRTC:BL', 'TRTC:R', 'TYMC:A']));
});
check('台鐵嘉義可接到林鐵本線，遠端高鐵嘉義不會被誤接', () => {
  const traStop = tra.trains.flatMap(train => train.stops).find(item => item.name === '嘉義');
  const hsrStop = thsr.trains.flatMap(train => train.stops).find(item => item.name === '嘉義');
  assert(routesFor('tra_sched', traStop).includes('AFR:1'));
  assert.deepEqual(routesFor('thsr_sched', hsrStop), []);
});

check('台鐵異名共構與同系統多線都已寫進轉乘表', () => {
  assert.deepEqual(new Set(routesFor('tra_sched', { name: '新烏日', lat: 24.10937, lon: 120.61421 })), new Set(['THSR:THSR', 'TMRT:G']));
  assert.deepEqual(new Set(routesFor('tra_sched', { name: '新左營', lat: 22.68754, lon: 120.30678 })), new Set(['KRTC:R', 'THSR:THSR']));
  for (const [stationKey, expected] of [['TRA:0920', ['TRA:EL', 'TRA:WL']], ['TRA:7330', ['TRA:EL', 'TRA:PX']]]) {
    const station = transfers.stations[stationKey], group = groups.get(station.transferId);
    assert(group);
    for (const route of expected) assert(group.routes.includes(route));
  }
});

check('手機精簡標記與桌面完整標記 CSS 都存在', () => {
  assert.match(html, /\.tc-xfer-short \{ display: none; \}/);
  assert.match(html, /@media \(max-width: 900px\)[\s\S]*?\.tc-xfer-wide \{ display: none; \}/);
  assert.match(html, /<span class="tc-xfer-short">轉 \$\{routes\.length\}<\/span>/);
});

const failures = results.filter(result => !result.pass);
console.log(`RESULT checks=${results.length} failures=${failures.length} status=${failures.length ? 'RED' : 'GREEN'}`);
process.exit(failures.length ? 1 : 0);
