// 巡檢回歸：環線攤平端點、終點停靠與同站車數。直接執行巡檢判準，避免另寫一份判官。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./scan_map_health.mjs', import.meta.url), 'utf8');
const sampleSource = source.slice(source.indexOf('const SAMPLE ='), source.indexOf('\nconst browser ='));
const constants = source.slice(source.indexOf('const OVERLAP_BAD_M'), source.indexOf('\nlet problems ='));
const collisionSource = source.slice(source.indexOf('// 1. 同向疊車（'), source.indexOf('// 2. 倒退'));

function sampleTrain(train, systemId = 'klrt', loop = true) {
  const ln = { id: 'C', loop, stations: Array.from({ length: 38 }, (_, i) => ({ d: i })) };
  const context = vm.createContext({
    state: { _freqHits: [], lines: [ln], visible: new Set(['C']), trtcOfficialRoster: {} },
    M: { getZoom: () => 11, fromScreen: () => [25, 121], distance: () => 1 },
    metroCoreSystemIdForLine: () => systemId, metroCoreSnapshotLive: () => true,
    metroCoreSystem: () => ({ trains: [train] }), metroCoreLineBlocked: () => null,
    metroCoreSampleTrain: () => ({ progress: train.fromStationIndex }),
    metroCorePositionAt: () => ({ lat: 25, lon: 121 }),
  });
  const result = vm.runInContext(`${sampleSource}\nSAMPLE()`, context);
  assert.equal(result.corePlace.length, 1, '必須真的進入 Core 判準');
  return result.coreStuck;
}

const train = (from, dest, direction) => ({ vehicleId: 'loop-trip', lineId: 'C',
  fromStationIndex: from, toStationIndex: from, destinationStationIndex: dest, direction,
  retireAt: 1791159788.053 });

test('高雄輕軌順行 37→38 是合法的最後一段', () => {
  assert.equal(sampleTrain(train(37, 38, 2)).length, 0);
});
test('高雄輕軌逆行可由攤平起點 38 出發', () => {
  assert.equal(sampleTrain(train(38, 0, 1)).length, 0);
});
test('已到終點且仍在停靠，不需要再有下一站', () => {
  assert.equal(sampleTrain(train(38, 38, 2)).length, 0);
});
test('環線方向與終點真的矛盾仍須告警', () => {
  assert.ok(sampleTrain(train(37, 0, 2)).length > 0);
});
test('非 KLRT 路線不能借用虛擬站序 38', () => {
  assert.ok(sampleTrain(train(37, 38, 2), 'trtc', false).length > 0);
});
test('KLRT 真正越出攤平端點的車仍須告警', () => {
  assert.ok(sampleTrain(train(38, 39, 2)).length > 0);
});

function collision(hits) {
  const messages = [], problems = [];
  const context = vm.createContext({ s1: { hits }, s2: { hits, mpp: 1, zoom: 11 }, GAP_SEC: 25,
    console: { log: text => messages.push(text) },
    note: (level, msg, detail) => problems.push({ level, msg, detail }),
    noteLoud: (level, msg, detail) => problems.push({ level, msg, detail }) });
  vm.runInContext(`${constants}\n${collisionSource}`, context);
  return { messages, problems };
}
const hit = (key, d = 5, nearM = 0) => ({ key, line: 'BR', dir: -1, x: d, y: 0,
  d, dsrc: 'float', nearM, nearIdx: 14 });

test('劍南路三個身分形成三組配對，台數應為 3', () => {
  const result = collision(['a', 'b', 'c'].map(id => hit(id)));
  assert.ok(result.problems.some(p => p.level === 'bad' && p.msg.startsWith('同站堆積')));
  assert.ok(result.messages.some(m => m.includes('BR|-1@14=3台')));
});
test('四個身分形成六組配對，台數仍應為 4', () => {
  assert.ok(collision(['a', 'b', 'c', 'd'].map(id => hit(id))).messages
    .some(m => m.includes('BR|-1@14=4台')));
});
test('同站兩台仍在既有容許範圍', () => {
  assert.equal(collision([hit('a'), hit('b')]).problems.filter(p => p.level === 'bad').length, 0);
});
test('站外持續 65 公尺的文湖線疊車仍須告警', () => {
  assert.ok(collision([hit('6d', 3.4, 320), hit('6g', 3.335, 255)]).problems
    .some(p => p.level === 'bad' && p.msg.startsWith('同向疊車')));
});
