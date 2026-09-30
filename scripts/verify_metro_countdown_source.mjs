// 直接執行正式函式；只讀、本機，不連線、不以身分連結率冒充到站準確率。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let model = fs.readFileSync(new URL('../ntm-live-model.js', import.meta.url), 'utf8');
const mutations = {
  route: ['row.timeRouteId==null?row.routeId:row.timeRouteId', 'row.routeId'],
  clock: ['feed, src, at, receivedAt / 1000)', 'feed, src, receivedAt / 1000, receivedAt / 1000)'],
  gate: ['if (!stationLines.some(entry => entry.systemId || sources.get(entry).length)) return null;',
    'if (!stationLines.some(entry => entry.systemId)) return null;'],
  source: ['if (sourceRows.length) {', 'if (false) {'],
  direction: ['if (row.direction != null && Number(train.direction) !== Number(row.direction)) return null;', '/* wrong direction accepted */'],
  stale: ['nowEpoch - at <= 150', 'nowEpoch - at <= 1800'],
};
if (process.env.METRO_COUNTDOWN_MUTATION) {
  const mutation = mutations[process.env.METRO_COUNTDOWN_MUTATION];
  if (process.env.METRO_COUNTDOWN_MUTATION === 'route') {
    assert(mutation && model.includes(mutation[0]), '突變未命中');
    model = model.replace(...mutation);
  } else {
    assert(mutation && html.includes(mutation[0]), '突變未命中');
    html = html.replace(...mutation);
  }
}
const lines = html.split('\n');
function fn(name) {
  const start = lines.findIndex(l => l.startsWith(`function ${name}(`));
  assert(start >= 0, name);
  if (/\}\s*$/.test(lines[start])) return lines[start];
  const end = lines.findIndex((l, i) => i > start && /^\}/.test(l));
  return lines.slice(start, end + 1).join('\n');
}
const epoch = Date.parse('2026-09-30T00:50:00Z') / 1000;
const ln = { id: 'KR', _sys: 'krtc', stations: ['小港', '美麗島', '岡山車站'].map(name => ({ name })), _tt: [] };
const state = { _metroLiveRaw: {}, _ntmLiveRaw: {}, metroCore: {}, visible: new Set(['KR', 'K']) };
const sandbox = {
  state, Date, console, NTM_ST_IDX: { V: { V08: 7, V09: 8 }, VB: { V08: 7, V28: 9 }, K: { K01: 0, K02: 1, K03: 2 } },
  NTM_LIVE_FEEDS: { ankeng: { sys: 'ntalrt', lines: ['K'] }, danhai: { sys: 'ntdlrt', lines: ['V', 'VB'] } },
  METRO_LIVE_LINES: { KRTC: { R: ['KR'], O: ['KO'] }, TYMC: { A: ['A'] } },
  METRO_CORE_MATCH_MIN: .5, METRO_CORE_BOARD_WINDOW_SEC: 7200,
  freqSysIdOf: line => line._sys,
  metroCoreSystemIdForLine: line => line.id === 'KR' ? 'krtc' : null,
  metroCoreSnapshotLive: () => false, metroCoreSystem: () => null, metroCoreLineBlocked: () => null,
  ntmFeedForSystem: id => id === 'ntalrt' ? 'ankeng' : id === 'ntdlrt' ? 'danhai' : null,
  trtcOfficialBoardRealNow: () => true,
  trtcOfficialStationName: name => String(name).replace(/臺/g, '台').replace(/站$/, ''),
  t: (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key]), i18nNumber: String,
  metroCoreLineIdIssues: () => ({ unknown: [], missing: [] }),
  metroCoreMatchRatios: () => ({ krtc: { matched: 28, total: 78, ratio: 28 / 78 }, trtc: { ratio: .1 } }),
  metroCoreEvaluateCounts: () => ({ 'krtc:KO': { reason: 'count' } }),
  metroCoreStationCountBlocks: () => ({ 'krtc:KR': { reason: 'stations' } }),
  metroCoreLegacyGroupsForEntry: (entry, directions = new Set()) => [1, 2].filter(d => !directions.has(d))
    .map(direction => ({ kind: 'legacy', ...entry, rows: [{ dtm: 999, direction }] })),
  buildArrIdx: () => new Map(), evalLineAnomaly: () => {},
};
vm.createContext(sandbox);
vm.runInContext(model, sandbox);
for (const name of ['metroSourceEpoch', 'metroSourceFresh', 'ntmCountdownRows', 'applyNtmLive',
  'metroSourceRowsForEntry', 'metroSourceRecordFresh', 'metroCoreBoardView', 'metroCoreCountdownText', 'metroCoreApplyGates',
  'metroCoreRowVehicleId', 'metroCoreSampleTrajectory', 'metroCoreSampleTrain']) {
  vm.runInContext(fn(name), sandbox);
}
let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }
const entry = { ln, si: 1, li: 0, systemId: null };
const rawRow = (d, e = 2) => ({ op: 'KRTC', l: 'R', s: '美麗島', d, e, st: 0 });
const source = rows => { state._metroLiveRaw.krtc = { at: new Date(epoch * 1000).toISOString(), rows }; };
test('資料時間缺失、未來偏差或過期不冒充新鮮倒數', () => {
  assert.equal(sandbox.metroSourceEpoch(undefined), null);
  assert.equal(sandbox.metroSourceEpoch('bad'), null);
  for (const at of [null, NaN, epoch - 151, epoch + 6]) assert.equal(sandbox.metroSourceFresh(at, epoch), false);
});
test('淡海 timeRouteId 決定倒數支線；不受列車 routeId 誤導，雙向保留', () => {
  const gpsData = [{ V08: { routeId: 4, timeRouteId: 3, time: 60, time3: 60, time4: 616, carNum: '' } }, {}, {},
    { V28: { routeId: 3, timeRouteId: 4, time: 90 } }];
  const result = sandbox.ntmCountdownRows('danhai', { gpsData });
  assert.deepEqual(Array.from(result, r => [r.lineId, r.dir, r.seconds]), [['V', 1, 60], ['VB', -1, 90]]);
  const board = sandbox.ntmCountdownRows('danhai', { gpsData }, true);
  assert.deepEqual(Array.from(board, r => [r.lineId, r.dir, r.seconds]), [['V', 1, 60], ['VB', 1, 616], ['VB', -1, 90]]);
});
test('無資料、未知支線與 routeId=null 的時刻表推估列不混入即時列', () => {
  const gpsData = [{ V08: { routeId: 4, timeRouteId: 9, time: 60 }, V09: { routeId: null, timeRouteId: 3, time: 80 } },
    { V08: { routeId: 3, time: -1 }, V09: { routeId: 3, time: '' } }];
  assert.equal(sandbox.ntmCountdownRows('danhai', { gpsData }).length, 0);
});
test('快取倒數以來源時間校正，重複接收不重置；舊批次不能倒灌', () => {
  const k = { id: 'K', _sys: 'ntalrt', stations: [{}, {}, {}], _tt: [[0, 0, 2, 600]] };
  sandbox.metroLivePool = () => [k];
  const observed = [];
  sandbox.nearestArrDiff = (_idx, _si, _dir, time) => { observed.push(time); return 10; };
  const src = { gpsData: [{ K01: { routeId: 1, time: 60 }, K02: { routeId: 1, time: 90, carNum: '212' }, K03: { routeId: 1, time: 120 } }] };
  const at = new Date(epoch * 1000).toISOString();
  sandbox.applyNtmLive('ankeng', src, at, (epoch + 45) * 1000);
  const first = observed.slice();
  assert.equal(k._liveShift, undefined, '匿名預告不得再偏移全方向');
  assert.equal(first.length, 0);
  assert.equal(state.ntmLiveModel.feeds.ankeng.trains[0].sourceAt, epoch);
  assert.equal(state.ntmLiveModel.feeds.ankeng.trains[0].calls[0].arrivalEpoch, epoch + 90);
  observed.length = 0;
  sandbox.applyNtmLive('ankeng', src, at, (epoch + 90) * 1000);
  assert.deepEqual(observed, first);
  sandbox.applyNtmLive('ankeng', src, new Date((epoch - 30) * 1000).toISOString(), (epoch + 90) * 1000);
  assert.equal(state._ntmLiveRaw.ankeng.at, epoch);
  const kEntry = { ln: k, si: 1, li: 0 };
  const rows = sandbox.metroSourceRowsForEntry(kEntry, epoch + 45);
  assert.equal(rows[0].arrivalEpoch, epoch + 90); // 看板到站秒數不含模型的半停站 +15。
  assert.equal(rows[0].vehicleId, null);
});
test('高捷未連結且 Core 離線，兩方向官方倒數仍顯示；不猜班表身分', () => {
  source([rawRow('岡山車站'), rawRow('小港', 3)]);
  const rows = sandbox.metroSourceRowsForEntry(entry, epoch + 40);
  assert.deepEqual(Array.from(rows, r => r.direction), [2, 1]);
  assert.equal(rows[0].arrivalEpoch, epoch + 150);
  assert(rows.every(r => r.vehicleId === null && r.kind === 'source'));
  assert.equal(sandbox.metroCoreCountdownText(rows[0], epoch + 40), '約 2 分');
  assert.equal(sandbox.metroSourceRecordFresh(rows[0], epoch + 151), false);
});
test('本站看板有倒數的方向不補班表；只對缺資料方向局部補足', () => {
  source([rawRow('岡山車站')]);
  const view = sandbox.metroCoreBoardView({ name: '美麗島' }, [ln], false, epoch + 40);
  assert(view, '沒有核心身分仍須顯示有效倒數');
  assert.equal(view.groups.filter(g => g.kind === 'source').length, 1);
  assert.deepEqual(Array.from(view.groups.filter(g => g.kind === 'legacy'), g => g.rows[0].direction), [1]);
  assert.equal(view.linked, 0);
  sandbox.trtcOfficialBoardRealNow = () => false;
  assert.equal(sandbox.metroCoreBoardView({ name: '美麗島' }, [ln], false, epoch), null);
  sandbox.trtcOfficialBoardRealNow = () => true;
});
test('空字串、負值、錯營運者、錯線、錯目的站、異常狀態都不能變成官方列', () => {
  source([rawRow('不存在'), rawRow('小港', ''), rawRow('小港', -1), { ...rawRow('小港'), st: 2 },
    { ...rawRow('小港'), l: 'O' }, { ...rawRow('小港'), op: 'TYMC' }]);
  assert.equal(sandbox.metroSourceRowsForEntry(entry, epoch).length, 0);
});
test('同一來源重複列去重；新批次讓舊看板列立即失效', () => {
  source([rawRow('小港'), rawRow('小港')]);
  const rows = sandbox.metroSourceRowsForEntry(entry, epoch);
  assert.equal(rows.length, 1);
  state._metroLiveRaw.krtc.at = new Date((epoch + 1) * 1000).toISOString();
  assert.equal(sandbox.metroSourceRecordFresh(rows[0], epoch + 1), false);
});
test('高捷位置門檻仍在，但不能牽連有效倒數；車數與站列版本防線保留', () => {
  sandbox.metroCoreApplyGates({}, epoch);
  assert.equal(state.metroCore.blockedSystems.krtc.reason, 'match');
  assert.equal(state.metroCore.blockedSystems.trtc.reason, 'match');
  assert.equal(state.metroCore.blockedLines['krtc:KO'].reason, 'count');
  assert.equal(state.metroCore.stationMismatch['krtc:KR'].reason, 'stations');
  source([rawRow('小港')]);
  assert.equal(sandbox.metroSourceRowsForEntry(entry, epoch).length, 1);
});
test('只保留同線同向同終點、時間相符且仍在途的既有核心連結', () => {
  source([rawRow('岡山車站')]);
  const train = { vehicleId: 'anon-1', lineId: 'KR', direction: 2, destinationStationIndex: 2,
    retireAt: epoch + 500, trajectory: [{ epoch: epoch - 10, progress: .5 }, { epoch: epoch + 150, progress: 1 }] };
  const row = { vehicleId: 'anon-1', direction: 2, destinationStationIndex: 2, match: 'inferred', arrivalEpoch: epoch + 150 };
  const system = { trains: [train], boards: [{ lineId: 'KR', stationIndex: 1, rows: [row] }] };
  sandbox.metroCoreSnapshotLive = () => true;
  sandbox.metroCoreSystem = () => system;
  const get = () => sandbox.metroSourceRowsForEntry(entry, epoch)[0];
  assert.equal(get().vehicleId, 'anon-1');
  for (const [field, wrong] of [['lineId', 'KO'], ['direction', 1], ['destinationStationIndex', 0], ['retireAt', epoch]]) {
    const old = train[field]; train[field] = wrong;
    assert.equal(get().vehicleId, null, field);
    assert.equal(get().arrivalEpoch, epoch + 150, '失去身分不能丟掉倒數');
    train[field] = old;
  }
  row.arrivalEpoch += 90;
  assert.equal(get().vehicleId, null);
  row.arrivalEpoch -= 90;
  sandbox.metroCoreLineBlocked = () => 'stations';
  assert.equal(get().vehicleId, null);
  assert.equal(get().arrivalEpoch, epoch + 150);
});
console.log(`${checks}/${checks} 正式函式回歸測試通過`);
