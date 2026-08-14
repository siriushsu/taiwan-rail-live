#!/usr/bin/env node
// 把 MetroBoardModel.swift 編成 CLI 實跑,與 Node 從同一份原始樣本【獨立重算】的結果逐列比對。
// 🔴 期望值必須從 fixture 的原始欄位算,不得呼叫 Swift 那條路徑——判準與實作同源會集體失明。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = join(ROOT, 'app/ios/App/RailBoardWidget/MetroBoardModel.swift');
const DATA = JSON.parse(readFileSync(join(ROOT, 'app/ios/App/RailBoardWidget/MetroWidgetData.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  PASS ${n}`)) : (fail++, console.log(`  FAIL ${n} ${d}`)); };

// 把純邏輯編成命令列 harness:吃 <kind> <station> <now> 與 stdin 的原始回應,吐 JSON。
const HARNESS = `
import Foundation
let a = CommandLine.arguments
let raw = FileHandle.standardInput.readDataToEndOfFile()
let aliasData = try! Data(contentsOf: URL(fileURLWithPath: a[4]))
let alias = try! JSONDecoder().decode([String: String].self, from: aliasData)
let snap = a[1] == "trtc"
  ? try! MetroBoardModel.trtc(json: raw, station: a[2], alias: alias, now: Double(a[3])!)
  : try! MetroBoardModel.minuteSystem(json: raw, station: a[2], alias: alias, now: Double(a[3])!)
let rows = snap.rows.map { r -> [String: Any] in
  var d: [String: Any] = ["dest": r.dest]
  if let e = r.etaEpoch { d["etaEpoch"] = e }
  if let m = r.minutes { d["minutes"] = m }
  if let c = r.crowd { d["crowd"] = c }
  return d
}
let out: [String: Any] = ["station": snap.station, "dataAt": snap.dataAt, "stale": snap.stale, "rows": rows]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out))
`;

const dir = mkdtempSync(join(tmpdir(), 'metroboard-'));
writeFileSync(join(dir, 'main.swift'), HARNESS);
try {
  execFileSync('swiftc', ['-O', MODEL, join(dir, 'main.swift'), '-o', join(dir, 'harness')], { stdio: 'pipe' });
} catch (e) {
  console.log('FAIL 編譯不過\n' + (e.stderr?.toString() || e.message));
  process.exit(1);
}
const run = (kind, station, now, fixture, sys) => {
  writeFileSync(join(dir, 'alias.json'), JSON.stringify(DATA.alias[sys]));
  return JSON.parse(execFileSync(join(dir, 'harness'), [kind, station, String(now), join(dir, 'alias.json')],
    { input: readFileSync(join(ROOT, 'app/fixtures/metro', fixture)) }).toString());
};

// ── 北捷:絕對 epoch 逐欄相等,不是「接近」 ──
const trtcRaw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro/trtc-live.json'), 'utf8'));
const NOW = Math.min(...trtcRaw.board.map(b => b.eta)) - 60;
// 🔴 平手規則要與 Swift 那邊逐字相同(eta 相等時比原始 dest 字串)——
//    Swift 的 sorted 不穩定、Node 的 sort 穩定,少了平手規則就不是同一個排序。
const byEta = (x, y) => x.eta === y.eta ? (x.dest < y.dest ? -1 : x.dest > y.dest ? 1 : 0) : x.eta - y.eta;
const expTaipei = trtcRaw.board.filter(b => b.name === '台北車站' && b.eta > NOW)
  .sort(byEta)
  .map(b => ({ dest: DATA.alias.trtc[b.dest], etaEpoch: b.eta }));
const gotTaipei = run('trtc', '台北車站', NOW, 'trtc-live.json', 'trtc');
ok('T1 北捷列數與順序', gotTaipei.rows.length === expTaipei.length &&
   gotTaipei.rows.every((r, i) => r.dest === expTaipei[i].dest),
   JSON.stringify(gotTaipei.rows.map(r => r.dest)) + ' vs ' + JSON.stringify(expTaipei.map(r => r.dest)));
ok('T2 北捷到站時刻逐欄等於官方 eta',
   gotTaipei.rows.every((r, i) => r.etaEpoch === expTaipei[i]?.etaEpoch),
   JSON.stringify(gotTaipei.rows.map(r => r.etaEpoch)));
ok('T3 北捷不得出現分鐘欄', gotTaipei.rows.every(r => r.minutes === undefined));
ok('T4 已過站的列不得出現', gotTaipei.rows.every(r => r.etaEpoch > NOW));

// ── 帶「站」的官方站名要能查到 ──
const gotSongshan = run('trtc', '松山機場', NOW, 'trtc-live.json', 'trtc');
ok('T5 別名生效(官方送「松山機場站」)', gotSongshan.rows.length > 0);

// ── 環狀線:它併在 trtc 裡(Y 線),終點是新北產業園區／大坪林,而且官方沒給它的車廂資料 ──
// 🔴 `trtc-live.json` 那份凍結樣本【沒有】任何 Y 的列,所以上面 T1–T5 一條都沒驗到環狀線。
//    `trtc-live-y.json` 是另一次真實擷取的裁切(只挑欄位、不改值),trains[] 裡確實沒有 Y 的車。
const yRaw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro/trtc-live-y.json'), 'utf8'));
const yNow = Math.min(...yRaw.board.map(b => b.eta)) - 60;
const gotY = run('trtc', '十四張', yNow, 'trtc-live-y.json', 'trtc');
const expY = yRaw.board.filter(b => b.name === '十四張站').sort(byEta).map(b => DATA.alias.trtc[b.dest]);
ok('T6 環狀線站出得來且終點已正規化', gotY.rows.length === expY.length &&
   gotY.rows.every((r, i) => r.dest === expY[i]),
   JSON.stringify(gotY.rows.map(r => r.dest)) + ' vs ' + JSON.stringify(expY));
ok('T7 🔴 環狀線不得出現擁擠度(官方 trains[] 只有高運量與文湖線)',
   gotY.rows.every(r => r.crowd === undefined), JSON.stringify(gotY.rows.map(r => r.crowd)));
ok('T8 環狀線樣本的 trains[] 真的不含 Y(否則 T7 是空過)',
   (yRaw.trains || []).every(t => !['新北產業園區站', '大坪林站'].includes(t.dest)) &&
   (yRaw.trains || []).length > 0, `trains=${(yRaw.trains || []).length}`);

// ── 高捷／機捷:只准有整數分鐘,不准有絕對時刻 ──
for (const [sys, file, station] of [['krtc', 'krtc-live.json', null], ['tymc', 'tymc-live.json', null]]) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro', file), 'utf8'));
  const st = station || DATA.alias[sys][raw.rows[0].s];
  const mine = raw.rows.filter(r => DATA.alias[sys][r.s] === st && Number.isFinite(r.e));
  // 🔴 正向對照:平手規則若沒被真的踩到,這條判準等於沒驗。凍結樣本裡高捷哈瑪星有兩筆 e=12。
  if (sys === 'krtc') ok('M-krtc0 樣本真的含同分鐘並列(否則平手規則沒被驗到)',
     new Set(mine.map(r => r.e)).size !== mine.length,
     `e 值=${JSON.stringify(mine.map(r => r.e))}`);
  const exp = mine
    .sort((x, y) => x.e === y.e ? (x.d < y.d ? -1 : x.d > y.d ? 1 : 0) : x.e - y.e)
    .map(r => ({ dest: DATA.alias[sys][r.d], minutes: r.e }));
  const got = run('min', st, Date.now() / 1000, file, sys);
  ok(`M-${sys}1 列數與順序`, got.rows.length === exp.length &&
     got.rows.every((r, i) => r.dest === exp[i].dest && r.minutes === exp[i].minutes),
     JSON.stringify(got.rows));
  ok(`M-${sys}2 🔴 不得出現絕對時刻(那是假精度)`, got.rows.every(r => r.etaEpoch === undefined),
     JSON.stringify(got.rows.map(r => r.etaEpoch)));
  ok(`M-${sys}3 🔴 不得出現擁擠度(這個系統官方沒有)`, got.rows.every(r => r.crowd === undefined));
}

// ── 官方視野以外要標 stale,不是繼續倒數 ──
const late = run('trtc', '台北車站', Math.max(...trtcRaw.board.map(b => b.eta)) + 1, 'trtc-live.json', 'trtc');
ok('S1 全部過期時 stale=true', late.stale === true);
ok('S2 全部過期時不留任何列', late.rows.length === 0);
ok('S3 未過期時 stale=false', gotTaipei.stale === false);

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
