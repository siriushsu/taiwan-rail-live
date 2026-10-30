#!/usr/bin/env node
// 高捷終點顯示驗收：直接執行 index.html 的正式函式，只替換時鐘、外部來源與路線幾何。
// 固定班次身分／看板／跟車軌跡，驗證畫面短留不會把已退場班次放回 canonical。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert(start >= 0, `找不到正式函式 ${name}`);
  const open = HTML.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < HTML.length; index++) {
    if (HTML[index] === '{') depth++;
    else if (HTML[index] === '}' && --depth === 0) return HTML.slice(start, index + 1);
  }
  throw new Error(`${name} 大括號未閉合`);
}
function extractConstant(name) {
  const match = HTML.match(new RegExp(`^const ${name} = [^;]+;`, 'm'));
  assert(match, `找不到正式常數 ${name}`);
  return match[0];
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const FUNCTIONS = ['metroCoreRowVehicleId', 'metroCoreSampleTrajectory', 'metroCoreSampleTrain',
  'metroCoreSystemIdForLine', 'ntmFeedForSystem', 'metroCoreSystem', 'metroCoreSnapshotLive',
  'metroCoreLineForId', 'metroCoreKlrtLoop', 'metroCoreFlatMax', 'metroCoreStationAt',
  'metroCorePositionAt', 'metroCoreLineBlocked', 'metroCoreItemsForLine', 'metroCoreFollowRecord',
  'metroCoreDisplayItemsForLine', 'metroCoreDisplayFollowRecord', 'metroCoreFollowRecordWithGrace',
  'metroCoreEpochSecOfDay', 'metroCoreVehicleInfo', 'runningCount'];
const CONSTANTS = ['METRO_CORE_SCHEMA', 'METRO_CORE_FOLLOW_GRACE_SEC',
  'METRO_CORE_TERMINAL_HOLD_SEC', 'METRO_CORE_TERMINAL_FADE_SEC', 'metroCoreTerminalDisplays'];
const CODE = CONSTANTS.map(extractConstant).concat(FUNCTIONS.map(extractFunction)).join('\n');

function makeLine(id = 'KR') {
  return { id, _sys: id === 'BL' ? 'mrt' : 'krtc', n: 0, loop: id === 'C',
    stations: Array.from({ length: 4 }, (_, index) => ({ name: `${id}站${index}`,
      lat: 22 + index / 100, lon: 120 + index / 100, d: index })) };
}
function makeTrain({ id = 'trip-old', lineId = 'KR', direction = 2, generation = 1,
  destination = direction === 2 ? 3 : 0, arrival = 330, progress = direction === 2 ? 2 : 1,
  retireAt = arrival, state = 'running' } = {}) {
  return { vehicleId: id, lineId, direction, publicLabel: '', destinationStationIndex: destination,
    fromStationIndex: direction === 2 ? Math.floor(progress) : Math.ceil(progress),
    toStationIndex: destination, state, retireAt,
    quality: { generation, source: 'board-bound' },
    nextCall: { stationIndex: destination, arrivalEpoch: arrival, departureEpoch: null },
    trajectory: [{ epoch: 290, progress, stateAfter: state },
      { epoch: arrival, progress: destination, stateAfter: 'terminal' }] };
}
function scene({ lineId = 'KR', trains = [makeTrain({ lineId })], validUntil = 1000 } = {}) {
  let clock = 300;
  const line = makeLine(lineId), systemId = lineId === 'BL' ? 'trtc' : lineId === 'C' ? 'klrt' : 'krtc';
  const state = { mode: 'freq', lines: [line], decoLines: [], visible: new Set([lineId]),
    simSec: 300, metroCore: { snapshot: null } };
  const context = vm.createContext({ state, METRO_CORE_ENABLED: true,
    TRTC_BOARD_LINES: new Set(['BL']),
    Date: class extends Date { static now() { return clock * 1000; } },
    freqSysIdOf: value => value && value._sys,
    metroLivePool: () => state.lines,
    trtcOfficialBoardRealNow: () => true,
    trtcOfficialItemsForLine: () => [],
    posBetweenStations: (ln, from, to, fraction) => {
      const a = ln.stations[from], b = ln.stations[to];
      return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
    } });
  vm.runInContext(CODE, context, { filename: 'index.html:terminal-display-functions' });
  const publish = (nextTrains, { boards = [], until = validUntil, generatedAt = 280, systems } = {}) => {
    state.metroCore.snapshot = deepFreeze({ schema: 'metro-snapshot/v1', revision: 'test',
      generatedAt, validUntil: until,
      systems: systems || [{ systemId, trains: nextTrains, boards }] });
  };
  publish(trains);
  return { context, line, state, publish,
    setNow: now => { clock = now; state.simSec = now; },
    core: now => context.metroCoreItemsForLine(line, now),
    display: now => context.metroCoreDisplayItemsForLine(line, now),
    cacheSize: () => vm.runInContext('metroCoreTerminalDisplays.size', context),
    follow: (id = trains[0]?.vehicleId) => ({ core: true, systemId, lineId, vehicleId: id }) };
}
function only(items, message) {
  assert.equal(items?.length, 1, message);
  return items[0];
}
function ids(items) { return Array.from(items || [], item => item.vehicleId); }

for (const lineId of ['KR', 'KO']) for (const direction of [1, 2]) {
  test(`${lineId} 方向 ${direction}：抵達終點後完整停 10 秒，再淡出 1 秒`, () => {
    const train = makeTrain({ lineId, direction });
    const s = scene({ lineId, trains: [train] });
    const original = JSON.stringify(s.state.metroCore.snapshot);
    const before = only(s.display(329.9));
    assert(!before.terminalDisplay);
    assert(!before.pos.atStation, '退場前一幀仍在最後區間');
    assert.equal(s.core(330), null, '認車資料在原本時刻退場');
    for (const now of [330, 330, 335, 339.999, 340]) {
      const item = only(s.display(now));
      assert(item.terminalDisplay && item.terminalArrived && item.pos.atStation);
      assert.equal(item.pos.progress, train.destinationStationIndex);
      assert.equal(item.displayOpacity, 1);
    }
    assert.equal(only(s.display(340.5)).displayOpacity, 0.5);
    assert.equal(s.display(341), null, '重複讀取不可延長 10 秒停留或 1 秒淡出');
    assert.equal(JSON.stringify(s.state.metroCore.snapshot), original, '不得修改 canonical 的生命週期或軌跡');
  });
}

test('刷新提早移除最後區間列車，仍沿原軌跡跑完；重複刷新不重開時鐘', () => {
  const s = scene();
  s.display(310);
  s.publish([]);
  const approach = only(s.display(315));
  assert(approach.terminalDisplay && !approach.terminalArrived);
  assert(approach.pos.progress > 2 && approach.pos.progress < 3);
  const expected = s.context.metroCoreSampleTrajectory(makeTrain().trajectory, 315);
  assert.equal(approach.pos.progress, expected.progress, '接續原軌跡，不能跳到終點');
  for (const now of [315, 320, 330, 335, 340.5]) {
    s.publish([]);
    only(s.display(now));
  }
  assert.equal(s.display(341), null);
});

test('短留開始後同班次暫時重現，較晚的到站訊號不能延長原截止時間', () => {
  const s = scene();
  s.display(320);
  s.publish([]);
  only(s.display(325));
  s.publish([makeTrain({ arrival: 370 })]);
  assert(!only(s.display(326)).terminalDisplay, '真正仍在 canonical 的班次使用當前軌跡');
  s.publish([]);
  assert.equal(only(s.display(335)).pos.progress, 3);
  assert.equal(only(s.display(340.5)).displayOpacity, 0.5);
  assert.equal(s.display(341), null, '重現事件不能使顯示多活到新的 381 秒截止');
});

test('短留不增加營運車數、不認領下一班看板、不修改後車軌跡', () => {
  const old = makeTrain(), next = makeTrain({ id: 'trip-next', progress: 1, arrival: 450 });
  const s = scene({ trains: [old, next] });
  s.display(320);
  const board = { lineId: 'KR', stationIndex: 2, rows: [{ vehicleId: next.vehicleId,
    direction: 2, destinationStationIndex: 3, arrivalEpoch: 420 }] };
  s.publish([next], { boards: [board] });
  const canonical = JSON.stringify(s.state.metroCore.snapshot);
  const nextTrajectory = JSON.stringify(next.trajectory);
  const visible = s.display(335);
  assert.deepEqual(ids(visible).sort(), [next.vehicleId, old.vehicleId].sort());
  assert.deepEqual(ids(s.core(335)), [next.vehicleId]);
  s.setNow(335);
  assert.equal(s.context.runningCount(), 1, '顯示兩台時只有下一班算營運中');
  const system = s.state.metroCore.snapshot.systems[0];
  assert.equal(s.context.metroCoreRowVehicleId(system, board, board.rows[0]), next.vehicleId);
  assert.equal(s.context.metroCoreRowVehicleId(system, board, { ...board.rows[0], vehicleId: old.vehicleId }), null);
  assert.equal(JSON.stringify(next.trajectory), nextTrajectory, '短留不得讓後車減速或改到站時刻');
  assert.equal(JSON.stringify(s.state.metroCore.snapshot), canonical);
});

for (const variant of ['中途區間', 'held', '停站', '缺終點節點', '終點不符', '超過預測有效期', '未曾看見最後區間']) {
  test(`${variant} 不補畫成終點短留`, () => {
    const train = makeTrain();
    let until = 1000;
    if (variant === '中途區間') train.trajectory[0].progress = 0;
    if (variant === 'held') train.trajectory[0].stateAfter = 'held';
    if (variant === '停站') {
      train.trajectory = [{ epoch: 290, progress: 2, stateAfter: 'dwelling' },
        { epoch: 320, progress: 2, stateAfter: 'running' }, { epoch: 330, progress: 3, stateAfter: 'terminal' }];
    }
    if (variant === '缺終點節點') train.trajectory.at(-1).stateAfter = 'held';
    if (variant === '終點不符') train.trajectory.at(-1).progress = 2;
    if (variant === '超過預測有效期') until = 329;
    const s = scene({ trains: [train], validUntil: until });
    if (variant !== '未曾看見最後區間') s.display(300);
    s.publish([]);
    assert.equal(s.display(315), null);
  });
}

test('下一班與反向班次各自保留身分，不能因同站誤合併', () => {
  const old = makeTrain(), next = makeTrain({ id: 'trip-next', direction: 1, progress: 3, arrival: 500 });
  const s = scene({ trains: [old] });
  s.display(320);
  s.publish([next]);
  const items = s.display(335);
  assert.deepEqual(ids(items).sort(), [old.vehicleId, next.vehicleId].sort());
  const followed = s.context.metroCoreDisplayFollowRecord(s.follow(old.vehicleId), 335);
  assert.equal(followed.train.vehicleId, old.vehicleId);
  assert.equal(followed.train.direction, 2);
  assert.equal(s.context.metroCoreDisplayFollowRecord(s.follow(next.vehicleId), 335).train.direction, 1);
});

for (const changed of ['generation', 'direction', 'destination']) {
  test(`同 ID 的 ${changed} 改變不能沿用舊趟終點`, () => {
    const s = scene();
    s.display(320);
    const replacement = makeTrain({ progress: 0, arrival: 500 });
    if (changed === 'generation') replacement.quality.generation = 2;
    if (changed === 'direction') replacement.direction = 1;
    if (changed === 'destination') replacement.destinationStationIndex = 2;
    s.publish([replacement]);
    const current = only(s.display(325));
    assert(!current.terminalDisplay);
    assert.equal(current.train, replacement);
    s.publish([]);
    assert.equal(s.display(335), null, '新趟消失時不可復活舊趟顯示');
  });
}

test('視覺跟隨跑完最後區間與短留，卡片不再顯示已過期倒數', () => {
  const s = scene(), follow = s.follow();
  const record = now => s.context.metroCoreFollowRecordWithGrace(follow, now);
  assert(record(320));
  s.publish([]);
  const approach = record(325);
  assert(approach.terminalDisplay && !approach.terminalArrived);
  const approachingInfo = s.context.metroCoreVehicleInfo(approach);
  assert.equal(approachingInfo.nextName, 'KR站3');
  assert.equal(approachingInfo.nextSec, null);
  const arrived = record(335), info = s.context.metroCoreVehicleInfo(arrived);
  assert(arrived.terminalArrived && info.terminalArrived);
  assert.equal(info.termName, 'KR站3');
  assert.equal(info.nextSec, null);
  assert.equal(info.officialNo, '', '匿名 trip ID 不得充當官方車號');
  assert(record(340.5));
  assert.equal(record(341), null, '終點短留完成後不能再延長一般 30 秒跟隨寬限');
  assert.equal(record(350), null);
});

for (const reason of ['snapshot 過期', 'blocked', 'system 移除', '時鐘倒退']) {
  test(`${reason} 清除短留快取`, () => {
    const s = scene();
    s.display(320);
    s.publish([]);
    only(s.display(325));
    if (reason === 'snapshot 過期') s.publish([], { until: 325 });
    if (reason === 'blocked') s.state.metroCore.blockedLines = { 'krtc:KR': { reason: 'test-block' } };
    if (reason === 'system 移除') s.publish([], { systems: [] });
    const now = reason === '時鐘倒退' ? 310 : 326;
    assert.equal(s.display(now), null);
    delete s.state.metroCore.blockedLines;
    s.publish([]);
    assert.equal(s.display(335), null, '來源恢復不能復活已丟棄的舊顯示');
  });
}

for (const lineId of ['BL', 'C']) {
  test(`${lineId} 的退場與原有跟隨不受高捷短留影響`, () => {
    const s = scene({ lineId });
    assert.deepEqual(ids(s.display(320)), ids(s.core(320)));
    const follow = s.follow();
    assert(s.context.metroCoreFollowRecordWithGrace(follow, 320));
    assert.equal(s.display(330), null);
    assert.equal(s.context.metroCoreFollowRecordWithGrace(follow, 330), null);
    assert.equal(s.cacheSize(), 0);
  });
}

// Core 新版公開 payload 的 retireAt 已含十秒短留；舊 App 沿原取樣器也能顯示到站。
// 新網站須沿用 arrivalEpoch，不能再把 retireAt 當到站時刻加第二次十秒。
function coreHeldTrain(options = {}) {
  const arrival = options.arrival ?? 330;
  const train = makeTrain({ ...options, arrival, retireAt: arrival + 10 });
  train.trajectory.push({ epoch: arrival + 10, progress: train.destinationStationIndex,
    stateAfter: 'terminal' });
  if (options.metadata) train.terminalDisplay = { arrivalEpoch: arrival, holdUntil: arrival + 10 };
  return train;
}

for (const lineId of ['KR', 'KO']) for (const direction of [1, 2]) {
  test(`${lineId} 方向 ${direction}：Core 已延長 retireAt，網站仍是到站 10＋1 秒`, () => {
    const train = coreHeldTrain({ lineId, direction });
    const s = scene({ lineId, trains: [train] });
    const original = JSON.stringify(s.state.metroCore.snapshot);
    assert(!only(s.display(329.9)).terminalDisplay);
    assert(s.context.metroCoreSampleTrain(train, 339.9), '舊 App 取樣器到站第九秒仍有車');
    assert.equal(s.context.metroCoreSampleTrain(train, 340), null, '公開 retireAt 固定為到站十秒');
    for (const now of [330, 335, 339.999, 340]) {
      const held = only(s.display(now));
      assert(held.terminalDisplay && held.terminalArrived && held.pos.atStation);
      assert.equal(held.pos.progress, train.destinationStationIndex);
      assert.equal(held.displayOpacity, 1);
      assert.equal(s.core(now), null, '到站車雖仍在公開快照，不能算在途車');
    }
    assert.equal(only(s.display(340.5)).displayOpacity, 0.5);
    assert.equal(s.display(341), null);
    assert.equal(s.display(350), null, '不能因 Core 已延長一次而總共多留二十秒');
    assert.equal(JSON.stringify(s.state.metroCore.snapshot), original);
  });
}

test('冷啟動直接遇到延長 retireAt 的終點車，不必先看過最後區間', () => {
  const s = scene({ trains: [coreHeldTrain()] });
  const item = only(s.display(335));
  assert(item.terminalDisplay && item.terminalArrived);
  assert.equal(item.pos.progress, 3);
  assert.equal(s.core(335), null);
  assert.equal(only(s.display(340.5)).displayOpacity, 0.5);
  assert.equal(s.display(341), null);
});

for (const firstSeen of [325, 335]) {
  test(`冷啟動於 ${firstSeen} 秒收到 Core terminalDisplay，可接續進站／终點短留`, () => {
    const train = coreHeldTrain({ metadata: true });
    const s = scene({ trains: [train] });
    const item = only(s.display(firstSeen));
    assert(item.terminalDisplay);
    assert.equal(item.terminalArrived, firstSeen >= 330);
    assert.equal(item.pos.progress, s.context.metroCoreSampleTrajectory(train.trajectory, firstSeen).progress);
    assert.equal(s.core(firstSeen), null, 'metadata 即使仍接續進站也只用於顯示');
    const follow = s.follow();
    assert(s.context.metroCoreFollowRecordWithGrace(follow, firstSeen));
    const terminal = s.context.metroCoreFollowRecordWithGrace(follow, 335);
    assert(terminal.terminalDisplay && terminal.terminalArrived);
    assert.equal(s.context.metroCoreVehicleInfo(terminal).nextSec, null);
    assert.equal(only(s.display(340.5)).displayOpacity, 0.5);
    assert.equal(s.context.metroCoreFollowRecordWithGrace(follow, 341), null);
  });
}

test('Core metadata 舊趟與正常下一班共存，不計車數、不認看板，也不改正常車', () => {
  const held = coreHeldTrain({ metadata: true });
  const next = makeTrain({ id: 'trip-next', progress: 1, arrival: 450 });
  const s = scene({ trains: [held, next] });
  const board = { lineId: 'KR', stationIndex: 2, rows: [] };
  const row = { vehicleId: next.vehicleId, direction: 2, destinationStationIndex: 3, arrivalEpoch: 420 };
  s.publish([held, next], { boards: [{ ...board, rows: [row] }] });
  const original = JSON.stringify(s.state.metroCore.snapshot);
  s.setNow(335);
  const items = s.display(335), system = s.state.metroCore.snapshot.systems[0];
  assert.deepEqual(ids(items).sort(), [held.vehicleId, next.vehicleId].sort());
  assert.deepEqual(ids(s.core(335)), [next.vehicleId]);
  assert.equal(s.context.runningCount(), 1);
  assert.equal(s.context.metroCoreRowVehicleId(system, board, row), next.vehicleId);
  assert.equal(s.context.metroCoreRowVehicleId(system, board, { ...row, vehicleId: held.vehicleId }), null,
    '即使上游看板誤指到仍存在快照內的 metadata 車，也不能認領該班');
  const active = items.find(item => item.vehicleId === next.vehicleId);
  assert.equal(active.train, next);
  assert.equal(active.displayOpacity ?? 1, 1);
  assert(!active.terminalDisplay);
  assert.equal(JSON.stringify(s.state.metroCore.snapshot), original);
});

test('同 ID 已到站 metadata 重複刷新不重開時鐘，過期後不再復活', () => {
  const s = scene({ trains: [coreHeldTrain({ metadata: true })] });
  const follow = s.follow();
  assert(s.context.metroCoreFollowRecordWithGrace(follow, 335));
  for (const now of [337, 339, 340.5]) {
    s.publish([coreHeldTrain({ metadata: true })], { generatedAt: now });
    const item = only(s.display(now));
    assert.equal(item.pos.progress, 3);
    assert.equal(item.displayOpacity, now > 340 ? 0.5 : 1);
  }
  for (const now of [341, 345, 350]) {
    s.publish([coreHeldTrain({ metadata: true })], { generatedAt: now });
    assert.equal(s.display(now), null);
    assert.equal(s.core(now), null);
    assert.equal(s.context.metroCoreFollowRecordWithGrace(follow, now), null);
  }
  const cold = scene({ trains: [coreHeldTrain({ metadata: true })] });
  assert.equal(cold.display(341), null, '首次看到的 metadata 若已過期也不能重開十秒');
});
