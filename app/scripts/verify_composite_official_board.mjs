#!/usr/bin/env node
// 驗「共站看板吃的是官方發車時刻，不是幾何通過時刻」。
//
// 2026-08-17 使用者在真機上選了台北車站共站，看板每一列都寫「經過」——那兩個字其實
// 忠實反映了當時的資料：共站與「我的地點」共用 PlaceBoardBuilder，時刻是把座標投影到
// 軌道上算出來的「幾點跨過這個里程」，不含停靠時間。台北車站有月台、車會停，寫「經過」
// 等於告訴使用者這班車不停。改法是共站改讀成員站的官方發車看板。
//
// 這支腳本要證明的是那件事真的成立，而且不是只改了字：
//   G1 共站解得出成員站，兩個系統各一個（台鐵臺北＋高鐵台北）
//   G2 合成後的每一列，時刻都在該成員站的官方看板裡找得到同一班車同一秒
//      ——這是「官方」的定義，不是「看起來差不多」
//   G3 兩個系統的車都真的出現在同一張看板上（共站的賣點）
//   G4 逐列都帶得出所屬系統，而且只有台鐵那些會去查即時誤點
//   G5 【獨立對照】同一個座標用舊的幾何管線算一次，時刻必須與官方不同——
//      若兩者恰好全等，G2 就是零資訊（心得 29：判準不得與實作同源）
//   G6 【靜態】發車看板的列不准用到「經過」那個字；它只屬於我的地點
//
// 用法：node app/scripts/verify_composite_official_board.mjs
// 前置：data/place_index.json（沒有就先跑 app/scripts/build_place_index.mjs）

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const work = resolve(process.argv[2] ?? join(repoRoot, 'tmp/composite-official-verify'));
mkdirSync(work, { recursive: true });

const indexPath = join(repoRoot, 'data/place_index.json');
if (!existsSync(indexPath)) {
  console.error('缺 data/place_index.json —— 先跑 node app/scripts/build_place_index.mjs');
  process.exit(1);
}

// 驗哪一個共站：台北車站就是使用者回報的那一個，而且它兩個系統的站名寫法不同
// （台鐵「臺北」／高鐵「台北」）⇒ 順便證明成員站不是靠站名比對來的。
const TARGET_THSR_NAME = '台北';

const harness = `
import Foundation

// RailBoardData extends this UI-owned enum. The production target gets it from
// RailWidgetKit.swift; this Foundation-only model harness supplies the same shape.
enum RailHeading {
    case north
    case south
}

func decode<T: Decodable>(_ type: T.Type, path: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(contentsOf: URL(fileURLWithPath: path)))
}

struct RowOut: Encodable {
    let no: String
    let ty: String
    let sys: String
    let relation: String
    let scheduledSecond: Int
    let dest: String?
    /// 這一列會不會去查即時誤點——問的是產品自己的 PreparedBoard.isLive(systemID:)，
    /// 不是 harness 餵進去的旗標。拿整張看板的 anyLive 來當這個值就是那個 bug。
    let live: Bool
}

struct HarnessOut: Encodable {
    let label: String
    let anchor: String
    let members: [MemberOut]
    let officialRows: [RowOut]
    let rowsBySystem: [String: Int]
    let geometricRows: [RowOut]
    let liveSystems: [String]
}

struct MemberOut: Encodable {
    let sys: String
    let name: String
    let st: Int
}

struct MemberRec: Encodable {
    let sys: String
    let st: Int
}

struct CompositeRec: Encodable {
    let i: Int
    let label: String
    let subtitle: String
    let lat: Double
    let lon: Double
    let sts: [MemberRec]
}

@main
struct CompositeHarness {
    static func main() throws {
        let work = CommandLine.arguments[1]
        let root = URL(fileURLWithPath: work + "/appgroup", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("board"), withIntermediateDirectories: true
        )

        // ── 用 App 真正的 BoardBuilder 產出官方看板檔（與 publish 用同一組 JSONOutput）──
        let inputs = [
            RailBoardScheduleWriter.SystemInput(
                id: "tra", label: "台鐵",
                resource: CommandLine.arguments[3], live: true
            ),
            RailBoardScheduleWriter.SystemInput(
                id: "thsr", label: "高鐵",
                resource: CommandLine.arguments[4], live: false
            ),
        ]
        var builder = RailBoardScheduleWriter.BoardBuilder(existingStations: [])
        for input in inputs {
            let document = try decode(
                RailBoardScheduleWriter.ScheduleDocument.self, path: input.resource
            )
            builder.add(system: input, document: document)
        }
        for index in builder.stations.indices {
            let station = builder.stations[index]
            let board = builder.boards[index]
                ?? RailBoardScheduleWriter.MutableBoard(stationIndex: index, systemID: station.s)
            try Data(RailBoardScheduleWriter.JSONOutput.board(board).utf8).write(
                to: root.appendingPathComponent("board/\\(index).json"), options: .atomic
            )
        }
        try Data(
            RailBoardScheduleWriter.JSONOutput.stations(
                builder.stations,
                regions: RailBoardScheduleWriter.StationRegions(),
                coordinates: builder.coordinates
            ).utf8
        ).write(to: root.appendingPathComponent("stations.json"), options: .atomic)
        try Data(
            RailBoardScheduleWriter.JSONOutput.meta(
                builtAt: "2026-08-17T00:00:00Z", appBuild: "verify",
                boardFormat: 3, placesFingerprint: "verify",
                types: builder.types, systems: builder.systems
            ).utf8
        ).write(to: root.appendingPathComponent("meta.json"), options: .atomic)

        // ── 共站：成員站與索引（與 write() 裡同一套判定）──
        let composites = RailBoardScheduleWriter.CompositeStationFinder.find(
            coordinates: builder.coordinates,
            systemOrder: inputs.map(\\.id),
            systemLabels: Dictionary(uniqueKeysWithValues: inputs.map { ($0.id, $0.label) })
        )
        let targetName = CommandLine.arguments[5]
        guard let target = composites.first(where: {
            $0.members.contains { $0.s == "thsr" && $0.n == targetName }
        }) else {
            FileHandle.standardError.write(Data("找不到高鐵\\(targetName) 的共站\\n".utf8))
            exit(2)
        }
        let members = target.members.compactMap { station -> MemberOut? in
            guard let st = builder.stations.firstIndex(of: station) else { return nil }
            return MemberOut(sys: station.s, name: station.n, st: st)
        }
        // composites.json 用 Encodable 產，不手拼 JSON：欄位名寫錯就會在解碼端變成
        // 「沒有 sts」的舊格式，而那條路是刻意會早退的 ⇒ 判準會變成驗到降級路徑。
        let recordEncoder = JSONEncoder()
        recordEncoder.outputFormatting = [.sortedKeys]
        try recordEncoder.encode([
            CompositeRec(
                i: 0, label: target.place.label, subtitle: target.subtitle,
                lat: target.place.lat, lon: target.place.lon,
                sts: members.map { MemberRec(sys: $0.sys, st: $0.st) }
            )
        ]).write(to: root.appendingPathComponent("composites.json"), options: .atomic)

        // ── 官方路徑：小工具端真正會跑的 prepare(composite:) ──
        let store = RailBoardStore(rootURL: root)
        guard let selection = store.compositeSelection(
            forKey: RailBoardStore.compositeKeyPrefix + target.place.label
        ) else {
            FileHandle.standardError.write(Data("compositeSelection 解不出來\\n".utf8))
            exit(3)
        }
        // 🔴 觀測時刻要從班表窗自己推，不可以寫死：台鐵是 14 天逐日制，寫死的日期
        //    一定會滑出窗外，而窗外的台鐵一班車都不會出現 ⇒ 這支腳本會以「只有高鐵」
        //    的樣子轉紅，看起來像產品壞了，其實是判準過期（心得 34 的三種紅之一）。
        guard let anchorText = builder.systems.first(where: { $0.days > 0 })?.from,
              let anchorDay = RailBoardClock.parseDate(anchorText) else {
            FileHandle.standardError.write(Data("找不到逐日制系統的班表起日\\n".utf8))
            exit(4)
        }
        let now = RailBoardClock.absoluteDate(serviceDay: anchorDay, seconds: 8 * 3600)
        let engine = RailBoardEngine(store: store)
        let prepared = try engine.prepare(composite: selection, now: now)
        let officialRows = prepared.journeys.prefix(40).map {
            RowOut(
                no: $0.trainNumber, ty: $0.trainType, sys: $0.systemID,
                relation: String(describing: $0.relation),
                scheduledSecond: $0.scheduledSecond, dest: $0.destinationName,
                live: prepared.isLive(systemID: $0.systemID)
            )
        }

        // ── 幾何路徑（舊做法）：同一個座標，獨立來源的對照組 ──
        let index = try decode(
            RailBoardScheduleWriter.PlaceIndexDocument.self, path: CommandLine.arguments[2]
        )
        let tra = try decode(
            RailBoardScheduleWriter.TrackDocument.self, path: CommandLine.arguments[6]
        )
        let thsr = try decode(
            RailBoardScheduleWriter.TrackDocument.self, path: CommandLine.arguments[7]
        )
        let geometric = RailBoardScheduleWriter.PlaceBoardBuilder.build(
            places: [target.place], index: index, trackLines: tra.lines + thsr.lines
        )
        let geometricRows = geometric.flatMap { board in
            board.lines.flatMap { line in
                line.pass.map {
                    RowOut(
                        no: $0.no, ty: $0.ty, sys: $0.sys, relation: "geometric",
                        scheduledSecond: $0.at, dest: $0.to, live: false
                    )
                }
            }
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(
            HarnessOut(
                label: target.place.label, anchor: anchorText, members: members,
                officialRows: Array(officialRows),
                rowsBySystem: prepared.journeys.reduce(into: [:]) { $0[$1.systemID, default: 0] += 1 },
                geometricRows: geometricRows,
                liveSystems: prepared.systems.filter(\\.live).map(\\.id)
            )
        ).write(to: URL(fileURLWithPath: work + "/out.json"), options: .atomic)
        print("共站 \\(target.place.label)：官方 \\(officialRows.count) 列、幾何 \\(geometricRows.count) 列")
    }
}
`;

const harnessPath = join(work, 'harness.swift');
writeFileSync(harnessPath, harness);
const binary = join(work, 'harness');
execFileSync(
  'swiftc',
  [
    join(repoRoot, 'app/ios/App/App/RailBoardScheduleWriter.swift'),
    join(repoRoot, 'app/ios/App/RailBoardWidget/RailBoardData.swift'),
    join(repoRoot, 'app/ios/App/RailBoardWidget/RailNativeL10n.swift'),
    harnessPath,
    '-o',
    binary,
  ],
  { cwd: repoRoot, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
);
execFileSync(
  binary,
  [
    work,
    indexPath,
    join(repoRoot, 'data/tra_schedule_dense.json'),
    join(repoRoot, 'data/thsr_schedule_dense.json'),
    TARGET_THSR_NAME,
    join(repoRoot, 'data/tra.json'),
    join(repoRoot, 'data/thsr_track.json'),
  ],
  { stdio: 'inherit' }
);

const out = JSON.parse(readFileSync(join(work, 'out.json'), 'utf8'));
const problems = [];
const pass = [];
const ok = (name, condition, detail) => {
  (condition ? pass : problems).push(`${name}${detail ? `（${detail}）` : ''}`);
  console.log(`  ${condition ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('');
console.log(`【共站 ${out.label}】`);
console.log('  成員站：' + out.members.map(m => `${m.sys}=${m.name}(board/${m.st}.json)`).join('、'));

// G1 成員站
const systems = new Set(out.members.map(m => m.sys));
ok('G1 兩個系統各一個代表站', out.members.length === 2 && systems.size === 2,
  `${out.members.length} 個成員、${systems.size} 個系統`);
const traMember = out.members.find(m => m.sys === 'tra');
const thsrMember = out.members.find(m => m.sys === 'thsr');
ok('G1b 成員站不是靠站名比對來的（台鐵臺北／高鐵台北 寫法不同）',
  traMember?.name === '臺北' && thsrMember?.name === '台北',
  `tra=${traMember?.name} thsr=${thsrMember?.name}`);

// G2 每一列都要在官方看板裡對得上同一班車同一秒
const officialSeconds = new Map(); // sys → Map(trainNo → Set(seconds))
for (const member of out.members) {
  const board = JSON.parse(
    readFileSync(join(work, 'appgroup', 'board', `${member.st}.json`), 'utf8')
  );
  const byTrain = new Map();
  const put = (no, second) => {
    if (!byTrain.has(no)) byTrain.set(no, new Set());
    byTrain.get(no).add(second);
  };
  for (const dep of board.deps) put(dep.no, dep.dep);
  for (const arr of board.arrs) put(arr.no, arr.arr);
  for (const p of board.pass) put(p.no, p.at);
  officialSeconds.set(member.sys, byTrain);
}
const unmatched = out.officialRows.filter(row => {
  const byTrain = officialSeconds.get(row.sys);
  return !byTrain?.get(row.no)?.has(row.scheduledSecond);
});
ok('G2 每一列的時刻都在該站官方看板裡找得到同一班車同一秒',
  out.officialRows.length > 0 && unmatched.length === 0,
  `${out.officialRows.length} 列、對不上 ${unmatched.length} 列`
  + (unmatched.length ? `（例：${unmatched[0].ty} ${unmatched[0].no} @${unmatched[0].scheduledSecond}）` : ''));

// G3 兩個系統的車都在同一張看板上
const rowSystems = new Set(out.officialRows.map(row => row.sys));
ok('G3 同一張看板上真的同時有台鐵與高鐵的車', rowSystems.size === 2,
  `前 ${out.officialRows.length} 列＝${[...rowSystems].join('＋') || '零'}；`
  + `整張看板逐系統班次＝${Object.entries(out.rowsBySystem).map(([s, n]) => `${s}:${n}`).join('、') || '零'}`
  + `（觀測日錨在班表起日 ${out.anchor}）`);

// G4 逐列問 isLive：台鐵那些要 true、高鐵那些要 false
// 🔴 判準落在 PreparedBoard.isLive(systemID:) 上，不是落在 harness 餵的旗標上：
//    把逐班判斷換成整張看板的 anyLive（那正是最可能的寫法失誤）必須讓這條紅。
const traRows = out.officialRows.filter(row => row.sys === 'tra');
const thsrRows = out.officialRows.filter(row => row.sys === 'thsr');
ok('G4 逐列的即時誤點旗標：台鐵全開、高鐵全關',
  out.liveSystems.join(',') === 'tra'
    && traRows.length > 0 && traRows.every(row => row.live)
    && thsrRows.length > 0 && thsrRows.every(row => !row.live),
  `台鐵 ${traRows.filter(r => r.live).length}/${traRows.length} 開、`
  + `高鐵 ${thsrRows.filter(r => r.live).length}/${thsrRows.length} 開（應為 0）`);

// G5 獨立對照：幾何時刻必須與官方不同
const geometricByTrain = new Map();
for (const row of out.geometricRows) {
  geometricByTrain.set(`${row.sys}|${row.no}`, row.scheduledSecond);
}
let compared = 0;
let identical = 0;
const gaps = [];
for (const row of out.officialRows) {
  const geometric = geometricByTrain.get(`${row.sys}|${row.no}`);
  if (geometric === undefined) continue;
  compared += 1;
  if (geometric === row.scheduledSecond) identical += 1;
  else gaps.push(Math.abs(geometric - row.scheduledSecond));
}
gaps.sort((a, b) => a - b);
ok('G5 幾何時刻與官方時刻真的不一樣（否則 G2 是零資訊）',
  compared > 0 && identical < compared,
  compared === 0
    ? '一班都比不到，對照組失效'
    : `比到 ${compared} 班、全等 ${identical} 班、`
      + `差距中位 ${gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0} 秒、最大 ${gaps.at(-1) ?? 0} 秒`);

// G6 靜態：發車看板的列不准用到「經過」
// 🔴 只能切「那一顆 struct 自己的大括號範圍」。用「到下一個 struct 為止」會把中間夾著的
//    我的地點視圖一起掃進來（它們本來就該用「經過」）⇒ 判準恆紅、然後被人放寬掉。
const widgetSource = readFileSync(
  join(repoRoot, 'app/ios/App/RailBoardWidget/RailBoardWidget.swift'), 'utf8'
);
const structBody = (source, name) => {
  const head = source.indexOf(`struct ${name}`);
  if (head < 0) return null;
  const open = source.indexOf('{', head);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(head, i + 1);
    }
  }
  return null;
};
const boardRowBody = structBody(widgetSource, 'BoardRowView');
const placeRowBody = structBody(widgetSource, 'PlaceRowView');
ok('G6 發車看板的列沒有用到「經過」（那個字只屬於我的地點）',
  boardRowBody !== null && !boardRowBody.includes('passWord') && !boardRowBody.includes('經過'),
  boardRowBody === null ? '找不到 BoardRowView，判準失效' : `掃了 ${boardRowBody.length} 字`);
// 正向對照：沒有這一條，把 PlaceRowView 的「經過」也一起刪掉照樣會全綠。
// 「經過」在我的地點有兩種用法，兩種都要在：倒數不足一分鐘時的那個字，以及
// 「11:35 經過」那行的字首。只驗「有出現 passWord」的話，刪掉其中一種照樣全綠。
const placeUses = placeRowBody === null ? [] : [
  ['倒數字', /arrivingWord: PlaceDistance\.passWord/.test(placeRowBody)],
  ['時刻字首', /\\\(PlaceDistance\.passWord\)/.test(placeRowBody)],
];
ok('G6b 我的地點的兩種「經過」用法都還在（正向對照，否則 G6 可以靠全刪通過）',
  placeUses.length > 0 && placeUses.every(([, present]) => present),
  placeRowBody === null
    ? '找不到 PlaceRowView，判準失效'
    : placeUses.map(([name, present]) => `${name}${present ? '在' : '不見了'}`).join('、'));

console.log('');
if (problems.length > 0) {
  console.log(`❌ ${problems.length} 項不過：${problems.join('；')}`);
  process.exit(1);
}
console.log(`✅ 共站官方看板 gate 全過（${pass.length} 項）`);
