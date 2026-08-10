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
  // 不釘死版本字串：釘死的話每改一次就要跟著調一次，調到後來就沒人在意它了（而且它擋不住任何真缺陷）。
  // 要驗的是「版本戳記與最後更新日互相對得上」這個結構性事實。
  const build = /const BUILD = '(v(\d{2})(\d{2})[a-z]?)'/.exec(html);
  assert(build, 'BUILD 不存在或格式不是 vMMDD[a-z]');
  const updated = /最後更新：(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(html);
  assert(updated, '找不到「最後更新」日期');
  assert.equal(`${String(+updated[2]).padStart(2, '0')}${String(+updated[3]).padStart(2, '0')}`, build[2] + build[3],
    `BUILD ${build[1]} 與最後更新 ${updated[0]} 不同一天——改了版本卻忘了更新日期（或反過來）`);
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
  // 邊界取到 transferMetaHtml 之前：它以後的函式要 escHtml／document，在 vm 裡跑不起來。
  const source = /\/\/ 靜態轉乘表索引。[\s\S]*?(?=function transferMetaHtml)/.exec(html)?.[0];
  assert(source, '找不到前端轉乘函式區塊');
  const context = {
    state: {},
    haversineKm: distanceKm,
  };
  vm.runInNewContext(`${source}\nglobalThis.__transferApi = { initStationTransfers, transferRoutesForStop, transferRoutesAtStation, transferRoutesForMetro };`, context, { filename: 'station-transfer-logic.js' });
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

  // ── 落點 A 用的 transferRoutesAtStation：只列別的系統（同系統的線由看板自己的班次清單回答）──
  const atStation = key => new Set(context.__transferApi.transferRoutesAtStation(stationStop(key)).map(route => route.key));
  assert.deepEqual(atStation('TRA:1000'), new Set(['THSR:THSR', 'TRTC:BL', 'TRTC:R', 'TYMC:A']), '台鐵台北看板應列四條跨系統');
  // 同一個站體、換成北捷節點：兩條北捷線都要被扣掉（板南線與淡水信義線都在該站的班次清單裡）
  assert.deepEqual(atStation('TRTC:BL12'), new Set(['THSR:THSR', 'TRA:WL', 'TYMC:A']), '北捷台北看板不該再列北捷自己的線');

  // ── 落點 B（捷運）用的 transferRoutesForMetro：只扣「正在搭的那條線」，同系統其他線是有效轉乘 ──
  // 這是與看板相反的取捨：人在板南線車上時，淡水信義線正是他要的答案。
  const forMetro = ln => new Set(context.__transferApi.transferRoutesForMetro(ln, stationStop('TRTC:BL12')).map(route => route.key));
  // 兩個排除分支各自要有專屬判準，否則其中一支壞掉會被另一支蓋住：先驗只給線名、再驗只給 id。
  assert.deepEqual(forMetro({ name: '板南線' }), new Set(['THSR:THSR', 'TRA:WL', 'TRTC:R', 'TYMC:A']), '只給線名時應只扣板南線');
  assert.deepEqual(forMetro({ id: 'BL' }), new Set(['THSR:THSR', 'TRA:WL', 'TRTC:R', 'TYMC:A']), '只給 lineId 時應只扣板南線');
  // 兩個都對不上時寧可多列一條，不可整組落空
  assert.deepEqual(forMetro({ name: '不存在線', id: 'ZZ' }), new Set(['THSR:THSR', 'TRA:WL', 'TRTC:BL', 'TRTC:R', 'TYMC:A']), '對不上時應全列，不是全空');
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

check('兩個落點的接線都在，舊落點已拆乾淨', () => {
  // 落點 A：看板站況區。stnMetaHtml 是兩條看板路徑（台鐵/高鐵、捷運/林鐵）共用的同一個函式，
  // 所以只要驗它有叫 transferMetaHtml，四個系統就都吃得到。
  assert.match(html, /function stnMetaHtml\(st\)[\s\S]{0,900}?transferMetaHtml\(st\)/);
  assert.equal((html.match(/stnMetaHtml\(st\)/g) || []).length, 3, '看板路徑數（1 個定義＋2 個呼叫）變了，共用前提要重新確認');
  assert.match(html, /\.board \.stnMeta \.xfer \{/);
  // 落點 B：兩張跟隨卡的「下一站」各有一顆標，且都真的被填。
  for (const id of ['fpXfer', 'fcXfer']) {
    assert.match(html, new RegExp(`<span class="xfer-tag" id="${id}" hidden></span>`), `${id} 靜態節點不見了`);
    assert.match(html, new RegExp(`setTransferTag\\('${id}'`), `${id} 沒有任何填值端`);
  }
  assert.match(html, /\.xfer-tag \{/);
  // 舊落點（資訊卡逐站停靠表）：CSS、DOM、呼叫端一個都不准留。
  assert.doesNotMatch(html, /tc-xfer/);
  assert.doesNotMatch(html, /transferHintHtml/);
});

const failures = results.filter(result => !result.pass);
console.log(`RESULT checks=${results.length} failures=${failures.length} status=${failures.length ? 'RED' : 'GREEN'}`);
process.exit(failures.length ? 1 : 0);
