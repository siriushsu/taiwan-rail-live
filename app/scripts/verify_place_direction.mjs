#!/usr/bin/env node
// 驗「看板上每一班車的行進方向欄位是對的」。
//
// 兩條獨立路徑比對，而不是拿實作去對實作：
//   路徑 A＝App 真正會跑的 Swift（直接編譯 RailBoardScheduleWriter，呼叫 PlaceBoardBuilder.build）
//   路徑 B＝這支腳本在 node 裡從 place_index.json 原始段資料重新判一次里程增減
// 只有兩邊對每一班車都給出同一個方向才算過。
//
// 用法：node app/scripts/verify_place_direction.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const work = resolve(process.argv[2] ?? join(repoRoot, 'tmp/place-direction-verify'));
mkdirSync(work, { recursive: true });

// 三個真實座標：兩條線並存的（竹北）、共站的（台北車站）、只有高鐵的（高鐵桃園）。
const places = [
  { label: '竹北', lat: 24.8386, lon: 121.0043, manual: true },
  { label: '台北車站', lat: 25.0478, lon: 121.5170, manual: true },
  { label: '高鐵桃園', lat: 25.0130, lon: 121.2150, manual: true },
];
writeFileSync(join(work, 'places.json'), JSON.stringify(places));

// 共站入口用的站點座標：與 App 端 builder.coordinates 同一份來源（網站線形檔）。
const stationCoordinates = [];
for (const [file, sys] of [['data/tra.json', 'tra'], ['data/thsr_track.json', 'thsr']]) {
  const doc = JSON.parse(readFileSync(join(repoRoot, file), 'utf8'));
  const seen = new Set();
  for (const line of doc.lines) {
    for (const station of line.stations ?? []) {
      if (seen.has(station.name)) continue;
      seen.add(station.name);
      stationCoordinates.push({ n: station.name, s: sys, lat: station.lat, lon: station.lon });
    }
  }
}
writeFileSync(join(work, 'stations.json'), JSON.stringify(stationCoordinates));

const harness = `
import Foundation

func decode<T: Decodable>(_ type: T.Type, path: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(contentsOf: URL(fileURLWithPath: path)))
}

struct StationCoordinate: Decodable {
    let n: String
    let s: String
    let lat: Double
    let lon: Double
}

@main
struct DirectionHarness {
    static func main() throws {
        let work = CommandLine.arguments[1]
        let index = try decode(
            RailBoardScheduleWriter.PlaceIndexDocument.self,
            path: CommandLine.arguments[2]
        )
        let tra = try decode(
            RailBoardScheduleWriter.TrackDocument.self,
            path: CommandLine.arguments[3]
        )
        let thsr = try decode(
            RailBoardScheduleWriter.TrackDocument.self,
            path: CommandLine.arguments[4]
        )
        let places = try decode(
            [RailBoardScheduleWriter.PlaceInput].self,
            path: work + "/places.json"
        )
        let boards = RailBoardScheduleWriter.PlaceBoardBuilder.build(
            places: places,
            index: index,
            trackLines: tra.lines + thsr.lines
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(boards).write(
            to: URL(fileURLWithPath: work + "/boards.json"),
            options: .atomic
        )

        // 共站入口走的是同一支 PlaceBoardBuilder，只是座標由 CompositeStationFinder 算出來。
        let coordinateRecords = try decode(
            [StationCoordinate].self,
            path: work + "/stations.json"
        )
        var coordinates: [RailBoardScheduleWriter.Station: (lat: Double, lon: Double)] = [:]
        for record in coordinateRecords {
            coordinates[
                RailBoardScheduleWriter.Station(n: record.n, s: record.s)
            ] = (record.lat, record.lon)
        }
        // 共站【不再】走 PlaceBoardBuilder（2026-08-17 改吃官方發車看板）。這裡要驗的
        // 是「共站有沒有正確認出它的成員站」——那是官方看板索引的唯一來源，錯了就會
        // 指到別站的班次，而站名反推救不了（5 對共站兩系統名字不一樣）。
        let composites = RailBoardScheduleWriter.CompositeStationFinder.find(
            coordinates: coordinates,
            systemOrder: ["tra", "thsr"],
            systemLabels: ["tra": "台鐵", "thsr": "高鐵"]
        )
        struct CompositeOut: Encodable {
            let label: String
            let subtitle: String
            let members: [[String]]
        }
        try encoder.encode(
            composites.map {
                CompositeOut(
                    label: $0.place.label,
                    subtitle: $0.subtitle,
                    members: $0.members.map { [$0.s, $0.n] }
                )
            }
        ).write(
            to: URL(fileURLWithPath: work + "/composites.json"),
            options: .atomic
        )
        print("寫出 \\(boards.count) 份地點看板、\\(composites.count) 筆共站")
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
    harnessPath,
    '-o',
    binary,
  ],
  { cwd: repoRoot, stdio: 'inherit', maxBuffer: 32 * 1024 * 1024 }
);
execFileSync(
  binary,
  [
    work,
    join(repoRoot, 'data/place_index.json'),
    join(repoRoot, 'data/tra.json'),
    join(repoRoot, 'data/thsr_track.json'),
  ],
  { stdio: 'inherit' }
);

// ── 路徑 B：從原始索引重新判方向 ─────────────────────────────
const index = JSON.parse(readFileSync(join(repoRoot, 'data/place_index.json'), 'utf8'));
const composites = JSON.parse(readFileSync(join(work, 'composites.json'), 'utf8'));
const boards = JSON.parse(readFileSync(join(work, 'boards.json'), 'utf8'));

console.log('');
console.log('【共站：成員站要認得出來，而且兩個系統各一個】');
const compositeProblems = [];
// 🔴 這五對是「靠站名比對一定會漏掉」的那一半（高鐵新竹在台鐵六家…）。把它們寫成
//    具名期望，是為了讓這條判準真的有牙：只要成員站認錯，這裡就會紅，而不是靠
//    「有 8 筆」這種數量判準（數量對、成員錯，官方看板就會指到別站的班次）。
const expectedPairs = {
  新竹: { tra: '六家', thsr: '新竹' },
  苗栗: { tra: '豐富', thsr: '苗栗' },
  台中: { tra: '新烏日', thsr: '台中' },
  台南: { tra: '沙崙', thsr: '台南' },
  左營: { tra: '新左營', thsr: '左營' },
};
const byThsrName = new Map();
for (const composite of composites) {
  const bySystem = Object.fromEntries(composite.members.map(([sys, name]) => [sys, name]));
  const systems = Object.keys(bySystem);
  console.log(
    `  ${composite.label}（${composite.subtitle}）：`
    + composite.members.map(([sys, name]) => `${sys}=${name}`).join('、')
  );
  if (systems.length < 2) {
    compositeProblems.push(`${composite.label} 只有 ${systems.join('') || '零'} 一個系統`);
  }
  if (new Set(systems).size !== composite.members.length) {
    compositeProblems.push(`${composite.label} 同一個系統出現兩個代表站`);
  }
  if (bySystem.thsr) byThsrName.set(bySystem.thsr, bySystem);
}
for (const [thsrName, expected] of Object.entries(expectedPairs)) {
  const actual = byThsrName.get(thsrName);
  if (!actual) {
    compositeProblems.push(`高鐵${thsrName} 沒有被判成共站`);
    continue;
  }
  for (const [sys, name] of Object.entries(expected)) {
    if (actual[sys] !== name) {
      compositeProblems.push(
        `高鐵${thsrName} 的 ${sys} 成員應該是 ${name}，實際 ${actual[sys] ?? '缺'}`
      );
    }
  }
}

const segmentsByLine = new Map();
for (const seg of index.segs) {
  if (!segmentsByLine.has(seg[1])) segmentsByLine.set(seg[1], []);
  segmentsByLine.get(seg[1]).push(seg);
}

let checked = 0;
let missing = 0;
let mismatched = 0;
let withoutDir = 0;
const perDirection = new Map();

for (const board of boards) {
  for (const line of board.lines) {
    for (const pass of line.pass) {
      checked += 1;
      if (pass.dir === undefined) { withoutDir += 1; continue; }
      // 索引端點是整數公尺、看板的 d 也是四捨五入過的整數，比對時放寬 2 公尺。
      const candidates = (segmentsByLine.get(line.id) ?? []).filter(seg => {
        const train = index.trains[seg[0]];
        if (train.no !== pass.no || train.sys !== pass.sys) return false;
        const low = Math.min(seg[2], seg[3]) - 2;
        const high = Math.max(seg[2], seg[3]) + 2;
        return line.d >= low && line.d <= high;
      });
      if (candidates.length === 0) { missing += 1; continue; }
      const expected = candidates.map(seg => (seg[3] > seg[2] ? 1 : 0));
      if (!expected.every(value => value === pass.dir)) {
        mismatched += 1;
        if (mismatched <= 5) {
          console.log(
            `  ✗ ${board.label} / ${line.name} / ${pass.ty} ${pass.no}：`
            + `看板說 ${pass.dir}，索引說 ${[...new Set(expected)].join(',')}`
          );
        }
        continue;
      }
      const key = `${board.label} / ${line.name} / ${pass.dir === 1 ? '順里程' : '逆里程'}`;
      perDirection.set(key, (perDirection.get(key) ?? 0) + 1);
    }
  }
}

console.log('');
for (const [key, count] of [...perDirection].sort()) {
  console.log(`  ${key}：${count} 班`);
}
console.log('');
console.log(`  比對 ${checked} 班`);

const problems = [...compositeProblems];
if (composites.length !== 8) {
  problems.push(`共站應該有 8 筆，實際 ${composites.length}`);
}
if (checked === 0) problems.push('一班車都沒比到（座標選錯或索引是空的？）');
if (withoutDir > 0) problems.push(`${withoutDir} 班沒有 dir 欄位`);
if (missing > 0) problems.push(`${missing} 班在索引裡找不到對應段`);
if (mismatched > 0) problems.push(`${mismatched} 班方向與索引不符`);
// 只有單一方向的話，這個測試等於沒驗到「會不會兩邊都判成同一個值」。
const directionsSeen = new Set([...perDirection.keys()].map(key => key.split(' / ').pop()));
if (directionsSeen.size < 2) problems.push('取樣裡只出現一個方向，判準沒有鑑別力');

if (problems.length > 0) {
  console.log(`  ❌ ${problems.join('；')}`);
  process.exit(1);
}
console.log('  ✅ 每一班的方向都與原始索引的里程增減一致，且兩個方向都出現過');
