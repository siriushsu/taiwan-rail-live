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
// "line" 模式:直接逐案跑 resolveLine 這支純函式(stdin 是案例陣列,輸出同長度的結果陣列)。
if a[1] == "line" {
  let cases = try! JSONSerialization.jsonObject(with: raw) as! [[String: Any]]
  let out: [Any] = cases.map {
    MetroBoardModel.resolveLine(joined: $0["joined"] as? String, trainNo: $0["trainNo"] as? String,
                                station: $0["station"] as? String ?? "",
                                dest: $0["dest"] as? String ?? "",
                                stationLines: $0["stationLines"] as? [String] ?? [],
                                destLines: $0["destLines"] as? [String] ?? []) ?? NSNull()
  }
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out))
  exit(0)
}
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
  if let l = r.lineCode { d["lineCode"] = l }
  if let n = r.trainNo { d["trainNo"] = n }
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

// 🔴 T4 家族:上面那個 NOW 取的是全檔案最早 eta 再減 60 秒 ⇒ 樣本裡【沒有】任何已過站的列,
//    所以「已過站的不得出現」在那個時刻是恆真的,把 Swift 的 eta>now 濾掉也不會轉紅(空過)。
//    要驗這件事必須把時鐘撥到台北車站班次的【中間】,讓真的有幾列落在過去。
const tpEtas = trtcRaw.board.filter(b => b.name === '台北車站').map(b => b.eta).sort((a, b) => a - b);
const MID = tpEtas[Math.floor(tpEtas.length / 2)];
const expFuture = trtcRaw.board.filter(b => b.name === '台北車站' && b.eta > MID).sort(byEta);
const gotMid = run('trtc', '台北車站', MID, 'trtc-live.json', 'trtc');
ok('T4a 正向對照:這個時刻真的有列該被濾掉(否則 T4b 是空過)',
   expFuture.length > 0 && expFuture.length < tpEtas.length,
   `未來 ${expFuture.length} / 全部 ${tpEtas.length}`);
ok('T4b 已過站的列不得出現(列數與內容都要對)',
   gotMid.rows.length === expFuture.length &&
   gotMid.rows.every((r, i) => r.etaEpoch === expFuture[i].eta) &&
   gotMid.rows.every(r => r.etaEpoch > MID),
   `got ${gotMid.rows.length} 列 ${JSON.stringify(gotMid.rows.map(r => r.etaEpoch))} vs exp ${JSON.stringify(expFuture.map(b => b.eta))}`);

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
  // 🔴 stale 在 minuteSystem 這條路徑原本零覆蓋——把它寫死 false 一樣全綠。
  //    兩側都要驗:有列時必須是 false,查不到的站必須是 true 且不留列。
  ok(`M-${sys}4 有列時 stale=false`, got.rows.length > 0 && got.stale === false,
     `rows=${got.rows.length} stale=${got.stale}`);
  const none = run('min', '__不存在的站__', Date.now() / 1000, file, sys);
  ok(`M-${sys}5 查不到的站 stale=true 且不留列`, none.stale === true && none.rows.length === 0,
     `rows=${none.rows.length} stale=${none.stale}`);
}

// ── 官方視野以外要標 stale,不是繼續倒數 ──
const late = run('trtc', '台北車站', Math.max(...trtcRaw.board.map(b => b.eta)) + 1, 'trtc-live.json', 'trtc');
ok('S1 全部過期時 stale=true', late.stale === true);
ok('S2 全部過期時不留任何列', late.rows.length === 0);
ok('S3 未過期時 stale=false', gotTaipei.stale === false);

// ── 🔴 資料時刻必須是「資料的時刻」,不是「我抓取的時刻」 ──
// 2026-08-15 事故:dataAt 寫死成 now,於是任何一層快取(URLCache／CDN／SWR)送來的舊主體
// 都被戳上當下時刻 ⇒ 卡上寫「14:34 更新」、內容卻是 13:25 的班次,每一站都空。
// 全套 23 條判準沒有一條看得出來,因為沒有一條在問「這份資料多老」。
// 判準不同源:期望值直接從 fixture 的 at 字串用 Date.parse 獨立算,不碰 Swift 那條路徑。
// 🔴 每個情境的 now 都刻意離 at 很遠(數萬秒),寫死 now 的舊實作必轉紅——同源時「相等」是零資訊。
for (const [kind, sys, file] of [['trtc', 'trtc', 'trtc-live.json'],
                                 ['min', 'krtc', 'krtc-live.json'],
                                 ['min', 'tymc', 'tymc-live.json']]) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro', file), 'utf8'));
  const expAt = Date.parse(raw.at) / 1000;
  const st = kind === 'trtc' ? '台北車站' : DATA.alias[sys][raw.rows[0].s];
  const NOW_FAR = expAt + 50000;           // 與 at 差 50000 秒:寫死 now 的話這條必紅
  const got = run(kind, st, NOW_FAR, file, sys);
  ok(`A-${sys}1 🔴 dataAt 取自回應自帶的 at,不是抓取時刻`,
     Math.abs(got.dataAt - expAt) < 0.001,
     `got ${got.dataAt} vs at ${expAt}(now 給的是 ${NOW_FAR})`);
  ok(`A-${sys}2 正向對照:這個情境的 now 真的與 at 不同(否則上一條空過)`,
     Math.abs(NOW_FAR - expAt) > 1, `now=${NOW_FAR} at=${expAt}`);
}
// 缺 at 的回應要退回抓取時刻,不能整份作廢(端點欄位若變動,寧可少一點資訊)。
{
  const raw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro/trtc-live.json'), 'utf8'));
  delete raw.at;
  const noAt = join(dir, 'no-at.json');
  writeFileSync(noAt, JSON.stringify(raw));
  writeFileSync(join(dir, 'alias.json'), JSON.stringify(DATA.alias.trtc));
  const FALLBACK = 1700000000;
  const got = JSON.parse(execFileSync(join(dir, 'harness'),
    ['trtc', '台北車站', String(FALLBACK), join(dir, 'alias.json')],
    { input: readFileSync(noAt) }).toString());
  ok('A-fallback 缺 at 時退回抓取時刻(不得整份解析失敗)', got.dataAt === FALLBACK, `dataAt=${got.dataAt}`);
}

// ── 🔴 逐列線色的來源:官方車號 join,不准用站別/終點猜 ──
// 真機回饋(08-15):台北車站標頭畫紅點、底下卻列著藍線(板南線)的班次——站別取「第一條線」
// 等於隨機指定,轉乘站必錯。正解是每一列各自對回它真正的路線:看板列的車號 join 官方
// `trains[]`,取該車 `stn` 的字母前綴(BL10 → BL)。
// 判準不同源:期望值直接從 fixture 的 board.no / trains.stn 用 regex 獨立算,不碰 Swift。
{
  const trainByNo = new Map((trtcRaw.trains || []).filter(t => t.no).map(t => [String(t.no), t]));
  const expCode = b => (b.no && trainByNo.get(String(b.no))?.stn?.match(/^[A-Za-z]+/)?.[0]) || null;
  const rows = trtcRaw.board.filter(b => b.name === '台北車站' && b.eta > NOW).sort(byEta);
  const joinable = rows.filter(b => expCode(b));
  const orphan = rows.filter(b => !expCode(b));
  // 🔴 正向對照:兩種列都要真的存在,否則下面兩條各自空過一半。
  ok('N0 樣本同時含「對得到車」與「對不到車」的列',
     joinable.length > 0 && orphan.length > 0, `對得到 ${joinable.length} / 對不到 ${orphan.length}`);
  const got = gotTaipei.rows;
  ok('N1 🔴 對得到車的列,線代碼＝該車 stn 的字母前綴',
     rows.every((b, i) => !expCode(b) || got[i]?.lineCode === expCode(b)),
     JSON.stringify(rows.map((b, i) => `${b.dest}:${got[i]?.lineCode}vs${expCode(b)}`)));
  ok('N2 🔴 對不到車的列一律不給線代碼(不准用站別或終點猜)',
     rows.every((b, i) => expCode(b) || got[i]?.lineCode === undefined),
     JSON.stringify(rows.map((b, i) => `${b.dest}:${got[i]?.lineCode}`)));
  // 車號要原樣帶進 MetroRow(空字串收成 nil)——resolveLine 的第三層只有它可用。
  ok('N4 車號逐列帶進 MetroRow(空字串收成 nil)',
     rows.every((b, i) => got[i]?.trainNo === (b.no ? String(b.no) : undefined)),
     JSON.stringify(rows.map((b, i) => `${b.dest}:${got[i]?.trainNo}vs${b.no}`)));
}

// ── 🔴 逐列線別的三層判定(resolveLine 純函式,逐案測) ──
// 第三層「候選恰為 {BL,BR} 時,有車號＝板南、沒車號＝文湖」是正式站地圖同一條規則
// (worker.js → scripts/trtc_board_ledger.mjs 的 pickBoardCandidate),不是這裡新發明的。
// 判準不同源:候選集直接從 MetroWidgetData.json 的線站清單獨立算,不碰 Swift。
{
  const trtcSys = DATA.systems.find(s => s.id === 'trtc');
  const linesAt = new Map();
  for (const ln of trtcSys.lines) for (const st of ln.stations) {
    if (!linesAt.has(st.name)) linesAt.set(st.name, []);
    if (!linesAt.get(st.name).includes(ln.id)) linesAt.get(st.name).push(ln.id);
  }
  const at = n => linesAt.get(n) ?? [];
  const runLine = cases => JSON.parse(execFileSync(join(dir, 'harness'), ['line'],
    { input: JSON.stringify(cases) }).toString()).map(v => v === null ? null : v);
  // L0 正向對照:下面幾條踩的是真實目錄形狀,不是我編出來的候選集。
  ok('L0 目錄裡「忠孝復興／南港展覽館」真的同時屬於 BL 與 BR',
     JSON.stringify([...at('忠孝復興')].sort()) === '["BL","BR"]' &&
     JSON.stringify([...at('南港展覽館')].sort()) === '["BL","BR"]',
     `忠孝復興=${JSON.stringify(at('忠孝復興'))} 南港展覽館=${JSON.stringify(at('南港展覽館'))}`);
  ok('L0b 正向對照:板南線也有「單一候選」的站對(否則 L1 是空過)',
     at('市政府').length === 1 && at('永寧').length === 1,
     `市政府=${JSON.stringify(at('市政府'))} 永寧=${JSON.stringify(at('永寧'))}`);
  const amb = { station: '忠孝復興', dest: '南港展覽館',
                stationLines: at('忠孝復興'), destLines: at('南港展覽館') };
  const single = { station: '市政府', dest: '永寧', stationLines: at('市政府'), destLines: at('永寧') };
  // 台北車站→大安:紅線與板南線都經過台北車站,但大安只有紅線 ⇒ 交集單一(R)。
  // 東門→大橋頭:橘線兩支(迴龍/蘆洲)都服務,兩解且【不是】{BL,BR} ⇒ 不准套第三層。
  const orange = { station: '東門', dest: '大橋頭', stationLines: at('東門'), destLines: at('大橋頭') };
  const [aNo, aYes, aJoined, sNo, oNo, oYes, selfSame] = runLine([
    { ...amb, trainNo: null },                       // 沒車號的兩解列
    { ...amb, trainNo: '217' },                      // 有車號的兩解列
    { ...amb, trainNo: null, joined: 'BL' },         // join 得到答案時一律照 join
    { ...single, trainNo: null },                    // 單一候選:沒車號照樣判得出來
    { ...orange, trainNo: null },                    // 兩解但不是 {BL,BR}:沒車號不准猜
    { ...orange, trainNo: '1234' },                  // 同上,有車號也不准猜
    { station: '南港展覽館', dest: '南港展覽館', trainNo: null,
      stationLines: at('南港展覽館'), destLines: at('南港展覽館') },
  ]);
  ok('L1 單一候選路線 ⇒ 就是它', sNo === at('市政府')[0], `got ${sNo}`);
  ok('L2 🔴 {BL,BR} 兩解且沒車號 ⇒ 文湖線(官方對文湖線恆不給車次)', aNo === 'BR', `got ${aNo}`);
  ok('L3 🔴 {BL,BR} 兩解且有車號 ⇒ 板南線', aYes === 'BL', `got ${aYes}`);
  ok('L4 join 到的線代碼優先於任何推論', aJoined === 'BL', `got ${aJoined}`);
  ok('L5 🔴 候選不是 {BL,BR} 的多解一律不猜(不准擴大成「沒車號就是文湖線」)',
     oNo === null && oYes === null, `無車號 ${oNo} / 有車號 ${oYes}`);
  ok('L6 終點等於本站的列不判線', selfSame === null, `got ${selfSame}`);
  // L7 端到端:上面測的是純函式,這條確認 trtc() 解出來的 trainNo 真的能餵出同一個答案。
  const ambRows = trtcRaw.board.filter(b => DATA.alias.trtc[b.name] === '忠孝復興' &&
                                            DATA.alias.trtc[b.dest] === '南港展覽館');
  ok('L7a 正向對照:fixture 真的有「忠孝復興→南港展覽館」且有無車號各一列',
     ambRows.some(b => b.no) && ambRows.some(b => !b.no),
     JSON.stringify(ambRows.map(b => b.no)));
  const gotAmb = run('trtc', '忠孝復興', Math.min(...ambRows.map(b => b.eta)) - 60, 'trtc-live.json', 'trtc');
  const e2e = runLine(gotAmb.rows.map(r => ({ ...amb, trainNo: r.trainNo ?? null, joined: r.lineCode ?? null })));
  const expE2E = ambRows.sort(byEta).map(b => b.no ? 'BL' : 'BR');
  ok('L7b 🔴 端到端:同一站兩列各自拿到自己的線別',
     JSON.stringify(e2e) === JSON.stringify(expE2E),
     `${JSON.stringify(e2e)} vs ${JSON.stringify(expE2E)}`);
}
// ── 🔴 擁擠度必須是【這一列自己那台車】的 ──
// 舊實作用「終點」配車 ⇒ 同一個終點的所有列拿到同一台車的資料,實測 211 條可比對的列
// 裡有 140 條畫的是別台車的擁擠度。判準不同源:期望值直接從 fixture 的 board.no / trains.cars 算。
{
  const trainByNo = new Map((trtcRaw.trains || []).filter(t => t.no).map(t => [String(t.no), t]));
  const firstByDest = d => (trtcRaw.trains || []).find(t => t.dest === d && (t.cars || []).length);
  const rows = trtcRaw.board.filter(b => b.name === '台北車站' && b.eta > NOW).sort(byEta);
  const got = gotTaipei.rows;
  // 🔴 正向對照:樣本裡「該車」與「同終點第一台」必須真的不同,否則 W1 兩種實作都會過(空過)。
  const discriminating = rows.filter(b => {
    const own = b.no && trainByNo.get(String(b.no))?.cars, alt = firstByDest(b.dest)?.cars;
    return own && alt && JSON.stringify(own) !== JSON.stringify(alt);
  });
  ok('W0 樣本能分辨兩種配法(該車 vs 同終點第一台)', discriminating.length > 0,
     `可分辨的列 ${discriminating.length}`);
  ok('W1 🔴 擁擠度＝該列自己那台車的 cars',
     rows.every((b, i) => {
       const own = b.no ? trainByNo.get(String(b.no))?.cars : null;
       return JSON.stringify(got[i]?.crowd) === JSON.stringify(own?.length ? own : undefined);
     }),
     JSON.stringify(rows.map((b, i) => `${b.dest}:${JSON.stringify(got[i]?.crowd)}`)));
  ok('W2 🔴 對不到車的列不得借用別台車的擁擠度',
     rows.every((b, i) => (b.no && trainByNo.has(String(b.no))) || got[i]?.crowd === undefined),
     JSON.stringify(rows.map((b, i) => `${b.dest}:${JSON.stringify(got[i]?.crowd)}`)));
}

// 分鐘制系統官方沒有車號,不得無中生有。
for (const [sys, file] of [['krtc', 'krtc-live.json'], ['tymc', 'tymc-live.json']]) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro', file), 'utf8'));
  const st = DATA.alias[sys][raw.rows[0].s];
  const g = run('min', st, Date.now() / 1000, file, sys);
  ok(`N3-${sys} 分鐘制不得有線代碼`, g.rows.every(r => r.lineCode === undefined),
     JSON.stringify(g.rows.map(r => r.lineCode)));
}

// ── 🔴 抓取必須關掉用戶端快取 ──
// 端點回 `max-age=14400`(給瀏覽器離線退路用),而捷運看板的視野只有約 15 分鐘 ⇒
// 只要沿用 URLSession 的預設政策,小工具就會拿到最多四小時前的同一份主體,每一站都是 0 班,
// 而且 HTTP 層完全成功、看不出異狀(2026-08-15 事故的真兇)。網頁端三個消費者早就寫死
// `cache: 'no-store'`,Swift 這側必須有等價防護。判準寫「是什麼」:接受停用快取的政策或
// ephemeral session,不釘死某一行寫法。
{
  // MetroFetcher 2026-08-22 搬到 App/MetroWidgetShared.swift(App target 的背景開卡也要抓班次)。
  const src = readFileSync(join(ROOT, 'app/ios/App/App/MetroWidgetShared.swift'), 'utf8')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const fetchBlock = src.match(/static func fetch\(sys: String\)[\s\S]*?\n    \}/)?.[0] ?? '';
  ok('C0 真的抽到 fetch 區塊', fetchBlock.length > 0);
  ok('C1 🔴 抓取必須停用用戶端快取(否則吃到端點的 max-age=14400)',
     /cachePolicy\s*=\s*\.(reloadIgnoringLocalCacheData|reloadIgnoringLocalAndRemoteCacheData)/.test(fetchBlock)
     || /URLSessionConfiguration\.ephemeral/.test(src),
     fetchBlock.split('\n').filter(l => /cachePolicy|URLSession/.test(l)).join(' | ') || '(fetch 裡沒有任何快取政策)');
}

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
