#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const { _trtcLedger: api } = await import('../worker.js');

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}

const model = { lines: new Map([['BL', { stations: [{}, {}, {}, {}],
  runs:new Map([['0>1',20],['1>0',20],['1>2',20],['2>1',20],['2>3',20],['3>2',20]]) }]]) };
const row = (from, to, arrEpoch, no = '') => ({
  line: 'BL', dir: 2, from, to, destIdx: 3, run: from === to ? 0 : 20,
  arrEpoch, no, terminal: from === to,
});

class FakeD1 {
  constructor(shared = new Map()) {
    this.shared = shared;
    this.writes = 0;
    this.updateAttempts = 0;
    this.conflictOnce = null;
  }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (/SELECT v FROM trtc_state WHERE k=\?/.test(sql)) {
          const value = db.shared.get(String(this.args[0]));
          return value == null ? null : { v: value };
        }
        if (/SELECT a\.alias,t\.line/.test(sql)) return null;
        throw new Error(`FakeD1 不支援 first: ${sql}`);
      },
      async all() {
        if (/trtc_track_aliases/.test(sql)) return { results: [] };
        throw new Error(`FakeD1 不支援 all: ${sql}`);
      },
      async run() {
        if (/INSERT INTO trtc_state \(k,v\).*DO NOTHING/s.test(sql)) {
          const [key, value] = this.args;
          if (db.shared.has(String(key))) return { meta: { changes: 0 } };
          db.shared.set(String(key), String(value)); db.writes++;
          return { meta: { changes: 1 } };
        }
        if (/UPDATE trtc_state SET v=\? WHERE k=\? AND v=\?/.test(sql)) {
          db.updateAttempts++;
          const [value, key, oldValue] = this.args;
          if (db.conflictOnce) {
            db.shared.set(String(key), JSON.stringify(db.conflictOnce));
            db.conflictOnce = null;
            return { meta: { changes: 0 } };
          }
          if (db.shared.get(String(key)) !== String(oldValue)) return { meta: { changes: 0 } };
          db.shared.set(String(key), String(value)); db.writes++;
          return { meta: { changes: 1 } };
        }
        throw new Error(`FakeD1 不支援 run: ${sql}`);
      },
    };
  }
  async batch(statements) {
    // schema DDL 在 verifier 不需實作；若傳入有 run 的資料句則逐句執行。
    const runnable = statements.filter(statement => statement && typeof statement.run === 'function');
    const out = [];
    for (const statement of runnable) {
      try { out.push(await statement.run()); }
      catch (error) { if (!/FakeD1 不支援 run: CREATE/.test(String(error))) throw error; }
    }
    return out;
  }
}

const args = (db, rows, nowEpoch, sourceRevision, day = '2026-08-13', sourceObservedEpoch = nowEpoch) => ({
  env: db ? { TRTC_LEDGER: db } : {}, model, rows, day, nowEpoch, sourceRevision, sourceObservedEpoch,
});

console.log('Worker official roster integration：');

// 成功空列是 authoritative official snapshot；讀取 failure 則必須 hold D1 最後官方名冊。
const emptyDb = new FakeD1();
const empty = await api.trtcPersistOfficialRoster(args(emptyDb, [], 100, 90));
const noPriorOutage = await api.trtcBoardPositionAnchors({ TRTC_LEDGER: new FakeD1() },
  [row(0, 1, 120)], 'outage');
check(empty.roster.vehicles.length === 0 && !empty.degraded, '官方成功空列仍建立 official 名冊');
check(noPriorOutage.feedMode === 'outage' && noPriorOutage.rows.length === 0 &&
  noPriorOutage.vehicles.length === 0 && noPriorOutage.extensions.length === 0,
  '從未取得官方名冊時，TrackInfo failure 才能退回班表');
const legacyShared = new Map([['official_roster_v3', JSON.stringify({ schema:3, day:'2026-08-13',
  nowEpoch:100, sourceRevision:100, vehicles:[{ vehicleId:'legacy-flying-br', line:'BR', coastCycle:3 }] })]]);
const legacyDb = new FakeD1(legacyShared);
const legacyOutage = await api.trtcBoardPositionAnchors({ TRTC_LEDGER:legacyDb }, [], 'outage');
const cleanV4 = await api.trtcPersistOfficialRoster(args(legacyDb, [row(0, 1, 120, '134')], 100, 100));
check(legacyOutage.feedMode === 'outage' && legacyOutage.vehicles.length === 0 &&
  cleanV4.roster.schema === 4 && cleanV4.roster.vehicles.every(vehicle => vehicle.vehicleId !== 'legacy-flying-br') &&
  legacyShared.has('official_roster_v3') && legacyShared.has('official_roster_v4'),
  'v3 飛車名冊完全不讀，v4 從當下官方列乾淨建立');
const heldDb = new FakeD1();
const heldSeed = await api.trtcPersistOfficialRoster(args(heldDb, [row(0, 1, 120, '134')], 100, 100));
const heldWrites = heldDb.writes;
const heldOutage = await api.trtcBoardPositionAnchors({ TRTC_LEDGER: heldDb }, [], 'outage');
check(heldOutage.feedMode === 'official' && heldOutage.held === true &&
  heldOutage.rosterStateSource === 'd1-held-after-outage' && heldOutage.vehicles.length === 1 &&
  heldOutage.vehicles[0].vehicleId === heldSeed.roster.vehicles[0].vehicleId &&
  heldOutage.vehicles[0].officialNo === '134' && heldOutage.rows[0].no === '134' &&
  heldDb.writes === heldWrites,
  '新開頁面首輪 TrackInfo failure 仍讀回 D1 已知車與官方車次，只讀不寫');
const revisionDb = new FakeD1();
await api.trtcPersistOfficialRoster(args(revisionDb, [row(0, 1, 104, 'REV')], 104, 104,
  '2026-08-13', 104));
const generatedEmptyRevision = api.trtcOfficialSourceRevision([], 105);
const generatedEmpty = await api.trtcPersistOfficialRoster(args(revisionDb, [], 105, generatedEmptyRevision,
  '2026-08-13', 105));
check(generatedEmptyRevision === 105 && generatedEmpty.roster.rows.length === 1 &&
  generatedEmpty.roster.rows[0].vehicleId === generatedEmpty.roster.vehicles[0].vehicleId &&
  generatedEmpty.roster.vehicles[0].carried === true,
  '合法空列仍更新 revision，但已識別車沿時間軸保留');

// 同一份共享 D1 模擬 isolate 重載；第二輪仍須沿用第一輪 vehicleId。
const shared = new Map(), dbA = new FakeD1(shared), dbB = new FakeD1(shared);
const first = await api.trtcPersistOfficialRoster(args(dbA, [row(0, 1, 120, '101')], 100, 100));
const firstId = first.roster.rows[0].vehicleId;
const second = await api.trtcPersistOfficialRoster(args(dbB, [row(1, 2, 140, '101')], 115, 115));
check(second.roster.rows[0].vehicleId === firstId, '共享 D1 狀態跨 isolate 重載延續 vehicleId');
const anonymousShared = new Map(), anonymousA = new FakeD1(anonymousShared), anonymousB = new FakeD1(anonymousShared);
const anonymousFirst = await api.trtcPersistOfficialRoster(args(anonymousA, [row(0, 1, 120)], 100, 100));
const anonymousSecond = await api.trtcPersistOfficialRoster(args(anonymousB, [row(1, 2, 140)], 115, 115));
check(anonymousSecond.roster.rows[0].vehicleId === anonymousFirst.roster.rows[0].vehicleId,
  '匿名車身分也能靠 D1 跨 isolate 延續');
const numberShared = new Map(), numberA = new FakeD1(numberShared), numberB = new FakeD1(numberShared);
const numberFirst = await api.trtcPersistOfficialRoster(args(numberA, [row(0, 1, 120, '134')], 100, 100));
const numberBlank = await api.trtcPersistOfficialRoster(args(numberB, [row(1, 2, 140, '')], 115, 115));
check(numberBlank.roster.vehicles[0].vehicleId === numberFirst.roster.vehicles[0].vehicleId &&
  numberBlank.roster.vehicles[0].officialNo === '134' &&
  numberBlank.roster.vehicles[0].officialNoLockedOut === false,
  '共享 D1 跨輪站牌空白仍保留已認到的 134');

const writesBeforeSameRevision = dbB.writes;
const sameRevision = await api.trtcPersistOfficialRoster(args(dbB, [row(1, 2, 140, '101')], 115, 115));
check(dbB.writes === writesBeforeSameRevision && sameRevision.writes === 0 &&
  sameRevision.rosterStateSource === 'd1-current', '相同 sourceRevision 直接讀回、零重寫');

// revision 相同不代表 frame 相同：合法空列及上游同秒修訂都必須逐筆採用 fresh frame。
const sameRevisionChanged = await api.trtcPersistOfficialRoster(args(dbB,
  [row(1, 2, 140, '101'), row(0, 1, 150, '202')], 115, 115));
check(sameRevisionChanged.roster.rows.length === 1 && sameRevisionChanged.writes === 1 &&
  sameRevisionChanged.roster.diagnostics.ignoredObservations === 1,
  '相同 revision 仍採 fresh frame，但站間未配列不得另生新車');
const sameRevisionEmpty = await api.trtcPersistOfficialRoster(args(dbB, [], 115, 115));
check(sameRevisionEmpty.roster.rows.length === 1 && sameRevisionEmpty.roster.vehicles[0].carried === true &&
  sameRevisionEmpty.writes === 1,
  '成功空 frame 不得把尚未到終點的既有車清掉');
const sameRevisionEmptyAgain = await api.trtcPersistOfficialRoster(args(dbB, [], 115, 115));
check(sameRevisionEmptyAgain.writes === 0 && sameRevisionEmptyAgain.roster.rows.length === 1,
  '相同 revision、相同空 frame 才是零寫重播');
const clearDb = new FakeD1();
await api.trtcPersistOfficialRoster(args(clearDb, [row(0, 1, 120, 'CLEAR')], 100, 100));
const cleared = await api.trtcPersistOfficialRoster(args(clearDb, [], 100, 100));
check(cleared.roster.rows.length === 1 && cleared.roster.vehicles.length === 1 &&
  cleared.roster.vehicles[0].carried === true,
  '同 revision 非空→空列仍保留未到終點的既有車');
const raceDb = new FakeD1();
await api.trtcPersistOfficialRoster(args(raceDb, [row(0, 1, 120, 'RACE')], 100, 100,
  '2026-08-13', 1000));
const raceEmpty = await api.trtcPersistOfficialRoster(args(raceDb, [], 100, 100,
  '2026-08-13', 1001));
const raceLateOld = await api.trtcPersistOfficialRoster(args(raceDb, [row(0, 1, 120, 'RACE')], 100, 100,
  '2026-08-13', 1000));
check(raceEmpty.roster.rows.length === 1 && raceLateOld.roster.rows.length === 1 && raceLateOld.writes === 0 &&
  raceLateOld.roster.rows[0].vehicleId === raceEmpty.roster.rows[0].vehicleId,
  '同 revision 遲到 frame 不得改寫較晚快照的既有車時間軸');
const tiedDb = new FakeD1();
await api.trtcPersistOfficialRoster(args(tiedDb, [row(0, 1, 120, 'TIE')], 100, 100,
  '2026-08-13', 1000));
const tiedEmpty = await api.trtcPersistOfficialRoster(args(tiedDb, [], 100, 100,
  '2026-08-13', 1000));
const tiedLate = await api.trtcPersistOfficialRoster(args(tiedDb, [row(0, 1, 120, 'TIE')], 100, 100,
  '2026-08-13', 1000));
check(tiedEmpty.roster.rows.length === 1 && tiedLate.roster.rows.length === 1 && tiedLate.writes === 0 &&
  tiedLate.roster.rows[0].vehicleId === tiedEmpty.roster.rows[0].vehicleId,
  'acquisition 毫秒相同時 deterministic frame rank 防止時間軸 ping-pong');
const freshnessBarrierDb = new FakeD1();
const barrierFirst = await api.trtcPersistOfficialRoster(args(freshnessBarrierDb,
  [row(0, 1, 120, 'BARRIER')], 100, 100, '2026-08-13', 1000));
// 第二次刻意帶較晚 nowEpoch（同 sourceRevision）：若 reducer 被重跑，observedEpoch 會變 104。
const barrierRefresh = await api.trtcPersistOfficialRoster(args(freshnessBarrierDb,
  [row(0, 1, 120, 'BARRIER')], 104, 100, '2026-08-13', 1002));
const barrierLate = await api.trtcPersistOfficialRoster(args(freshnessBarrierDb,
  [row(1, 2, 140, 'OTHER')], 100, 100, '2026-08-13', 1001));
check(barrierRefresh.writes === 1 && barrierLate.roster.rows[0].no === 'BARRIER' && barrierLate.writes === 0,
  '同內容較晚觀測仍更新 freshness barrier，阻擋夾在中間的遲到異 frame');
check(barrierRefresh.roster.sourceObservedEpoch === 1002 &&
  barrierRefresh.roster.nowEpoch === barrierFirst.roster.nowEpoch &&
  barrierRefresh.roster.nextSequence === barrierFirst.roster.nextSequence &&
  barrierRefresh.roster.vehicles.length === 1 &&
  barrierRefresh.roster.vehicles[0].vehicleId === barrierFirst.roster.vehicles[0].vehicleId &&
  barrierRefresh.roster.vehicles[0].observedEpoch === barrierFirst.roster.vehicles[0].observedEpoch &&
  JSON.stringify(barrierRefresh.roster.diagnostics) === JSON.stringify(barrierFirst.roster.diagnostics),
  '同 frame 不重跑 reducer：只更新 barrier metadata，vehicles/nextSequence/diagnostics 原封不動');

const newer = api.trtcOfficialRosterSnapshot(model, [row(2, 3, 160, '101')], second.roster,
  '2026-08-13', 130, 130);
shared.set('official_roster_v4', JSON.stringify(newer));
const beforeRollback = dbB.writes;
const olderRequest = await api.trtcPersistOfficialRoster(args(dbB, [row(1, 2, 145, '101')], 120, 120));
check(olderRequest.roster.sourceRevision === 130 && dbB.writes === beforeRollback,
  '較新 sourceRevision 不被延遲訪客回退');
const nextDay = await api.trtcPersistOfficialRoster(args(dbB, [row(0, 1, 86420, '101')], 86400, 86400,
  '2026-08-14'));
check(nextDay.roster.day === '2026-08-14' && nextDay.roster.rows.length === 1 &&
  nextDay.roster.rows[0].vehicleId.includes('2026-08-14') && nextDay.roster.rows[0].vehicleId !== firstId,
  '營運日切換不沿用前一日 vehicleId／alias');

// 無 D1 仍以 canonical 排序分配 deterministic IDs；完全相同的兩列合一（不製造第二個身分）。
const dupRows = [row(0, 1, 120, 'DUP'), row(0, 1, 120, 'DUP'), row(1, 2, 140, '')];
const readonlyA = await api.trtcPersistOfficialRoster(args(null, dupRows, 100, 100));
const readonlyB = await api.trtcPersistOfficialRoster(args(null, [dupRows[2], dupRows[0], dupRows[1]], 100, 100));
const canonical = result => result.roster.rows.map(x => JSON.stringify(x)).sort();
check(readonlyA.degraded && readonlyA.rosterStateSource === 'deterministic-read-only',
  'D1 缺席明確標示 deterministic read-only degraded');
check(JSON.stringify(canonical(readonlyA)) === JSON.stringify(canonical(readonlyB)),
  'rows shuffle 不改 canonical multiset 的 ID 對應');
check(readonlyA.roster.rows.length === 2 && new Set(readonlyA.roster.rows.map(x => x.vehicleId)).size === 2 &&
  readonlyA.roster.diagnostics.duplicateRowsCollapsed === 1,
  '完全相同的官方列合一：不可區分的證據不得變成兩台車');
check(readonlyA.roster.rows.every(r => readonlyA.roster.vehicles.some(v => !v.extension &&
  v.vehicleId === r.vehicleId && v.line === r.line && v.dir === r.dir && v.from === r.from &&
  v.to === r.to && v.dest === r.dest && v.run === r.run && v.arrEpoch === r.arrEpoch)),
  '每筆 boardPos.rows 的 vehicleId 精確指向同一筆 official vehicle');
const joinRows = api.trtcOfficialRowsForJoin(readonlyA.roster.rows);
check(joinRows.length === readonlyA.roster.rows.length && joinRows.every((value, index) =>
  value.vehicleId === readonlyA.roster.rows[index].vehicleId && value.destIdx === readonlyA.roster.rows[index].dest),
  '相容 trips 與 vehicle 裝飾共用同一份 official snapshot rows');

// 兩段自身觀測後，即使下一輪整包空也保留同一 ID；舊 extension 規則不得復活。
const extDb = new FakeD1();
await api.trtcPersistOfficialRoster(args(extDb, [row(0, 1, 120, 'X')], 100, 100));
await api.trtcPersistOfficialRoster(args(extDb, [row(1, 2, 140, 'X')], 115, 115));
const extended = await api.trtcPersistOfficialRoster(args(extDb, [], 125, 125));
const extRows = extended.roster.rows;
const extVehicles = extended.roster.vehicles;
const extensions = extVehicles.filter(x => x.extension);
check(extVehicles.length === 1 && extRows.length === 1 && extensions.length === 0 &&
  extVehicles[0].carried === true,
  '空輪沿同一 ID 保留，不另生 extension 車');

// trip miss／歧義都只能少裝飾，不能使 vehicle 消失；唯一完整 row key 才附 tripKey。
const rosterRows = readonlyA.roster.rows;
const uniqueRow = rosterRows.find(x => x.from === 1);
const trip = [0, 28900, 1, 28920, 2, 28940, 3, 28960];
const tripSets = new Map([['BL|2', [trip]]]);
const bindings = [{ line: 'BL', dir: 2, tripKey: '0@28900>3@28960', trackId: 'track:1', lastShift: 0 }];
const miss = api.trtcOfficialTripDecorations({ tripSets, rosterRows, bindings: [], aliasByHwNo: new Map() });
const unique = api.trtcOfficialTripDecorations({ tripSets, rosterRows: [uniqueRow], bindings,
  aliasByHwNo: new Map() });
const duplicateRows = rosterRows.filter(x => x.from === 0);
const ambiguous = api.trtcOfficialTripDecorations({ tripSets, rosterRows: duplicateRows, bindings,
  aliasByHwNo: new Map() });
check(miss.size === 0 && rosterRows.length === readonlyA.roster.vehicles.length,
  'optional trip miss 不丟任何 official vehicle');
check(unique.get(uniqueRow.vehicleId) === '0@28900>3@28960' && ambiguous.size === 0,
  'tripKey 僅在 row 唯一對應時裝飾，duplicate fail closed');

// CAS 第一次被競爭者改值，第二次必須讀新 prior 重算並成功，不得 blind overwrite。
const casShared = new Map(), casDb = new FakeD1(casShared);
const casSeed = await api.trtcPersistOfficialRoster(args(casDb, [row(0, 1, 120, 'C')], 100, 100));
casDb.conflictOnce = api.trtcOfficialRosterSnapshot(model, [row(0, 1, 125, 'C')], casSeed.roster,
  '2026-08-13', 105, 105);
const casResult = await api.trtcPersistOfficialRoster(args(casDb, [row(1, 2, 140, 'C')], 115, 115));
check(casDb.updateAttempts === 2 && casResult.roster.sourceRevision === 115 && !casResult.degraded,
  'CAS 衝突有限重試後寫入新 revision');

// source-level 正向／mutation controls：避免 verifier 只測替身而產品編排根本沒接上。
// 每個 mutation 都要只打紅自己的 wiring property，不能靠「整體 gate 反正已紅」假裝有牙。
function sourceAudit(source) {
  return {
    reducerImport: /import \{ reduceOfficialRoster \}/.test(source),
    officialFeedGate: /feedMode !== 'official'/.test(source),
    stateKey: /official_roster_v4/.test(source),
    optimisticCas: /UPDATE trtc_state SET v=\? WHERE k=\? AND v=\?/.test(source),
    frameFingerprint: /const sourceFrameKey = trtcOfficialFrameKey\(rows\);/.test(source),
    observedOrder: /current\.state\.sourceObservedEpoch\) > observedRevision/.test(source),
    frameTieOrder: /current\.state\.sourceFrameOrder \|\| ''\) >= sourceFrameOrder/.test(source),
    sameSnapshotJoin: /rows: trtcOfficialRowsForJoin\(officialRows\)/.test(source),
    identityAudit: /vehicles, identityAudit,/.test(source),
    extensionsPayload: /extensions: vehicles\.filter\(vehicle => vehicle\.extension\)/.test(source),
    carWeightOptional: /!tkResult\.ok && hwRaw\.length === 0 && brRaw\.length === 0/.test(source),
    assemblyErrorHold: /boardPos = await trtcOfficialHeldPayload\(env, 'assembly-error'\)/.test(source),
    staleHold: /\.\.\.stale\.data, boardPos: heldBoardPos/.test(source),
  };
}
const source = fs.readFileSync(WORKER_PATH, 'utf8');
const baselineSourceAudit = sourceAudit(source);
check(Object.values(baselineSourceAudit).every(Boolean),
  'source 正向控制：reducer／缺訊 hold／CAS／frame／extensions 均接入產品碼');
const sourceMutations = [
  ['reducerImport', "import { reduceOfficialRoster }", 'import { reduceOfficialRosterDisabled }'],
  ['officialFeedGate', "feedMode !== 'official'", "feedMode === 'official'"],
  ['stateKey', 'official_roster_v4', 'official_roster_DISABLED'],
  ['optimisticCas', 'WHERE k=? AND v=?', 'WHERE k=?'],
  ['frameFingerprint', 'const sourceFrameKey = trtcOfficialFrameKey(rows);',
    "const sourceFrameKey = 'disabled';"],
  ['observedOrder', 'trtcOfficialRevision(current.state.sourceObservedEpoch) > observedRevision', 'false'],
  ['frameTieOrder', "String(current.state.sourceFrameOrder || '') >= sourceFrameOrder", 'false'],
  ['sameSnapshotJoin', 'rows: trtcOfficialRowsForJoin(officialRows)', 'rows: collapsed'],
  ['identityAudit', 'vehicles, identityAudit,', 'vehicles, identityAudit: {},'],
  ['extensionsPayload', 'extensions: vehicles.filter(vehicle => vehicle.extension)', 'extensions: []'],
  ['carWeightOptional', '!tkResult.ok && hwRaw.length === 0 && brRaw.length === 0',
    'hwRaw.length === 0 && brRaw.length === 0'],
  ['assemblyErrorHold', "boardPos = await trtcOfficialHeldPayload(env, 'assembly-error')", 'boardPos = boardPos'],
  ['staleHold', '...stale.data, boardPos: heldBoardPos', '...stale.data'],
];
for (const [target, from, to] of sourceMutations) {
  const mutant = source.replace(from, to);
  const audit = sourceAudit(mutant);
  const red = Object.entries(audit).filter(([, pass]) => !pass).map(([key]) => key);
  check(mutant !== source && red.length === 1 && red[0] === target,
    `source mutation ${target} 只打紅預期 wiring`, `紅燈=${red.join(',') || '無'}`);
}

if (failures) {
  console.error(`\n❌ official Worker verifier：${failures} 項失敗`);
  process.exit(1);
}
console.log('\n✅ official Worker verifier 全數通過');
