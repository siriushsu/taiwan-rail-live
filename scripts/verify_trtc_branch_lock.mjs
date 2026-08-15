#!/usr/bin/env node
// 2026-08-16 中和新蘆線共線段「分支歸屬一趟一鎖」驗收。
//
// 問題：南勢角(idx0)…大橋頭(idx11) 是蘆洲、迴龍兩支共用的同一段實體軌道，卻被 data/trtc.json
// 表示成兩條完整的線。官方站牌「景安站→南勢角站」這種列在兩條線上都成立 ⇒「這筆列歸誰」得由系統決定，
// 而舊碼決定它的方式是一條沒有獨立錨點的回饋迴圈：
//   車號 → aliasToTrack(只用車號當鍵) → track.line(每輪被 trackUpdates 以 claim.line 覆寫)
//        → branchLineHintsFromLedger 拿它當 hint → pickBoardCandidate 判分支 → 哪一支吃到那筆列 → 又改寫 track.line
// 錯一次就自我維持。08-16 正式站實測：D1 今日 55 條 O 線 synth track 恰好 1 條「鑄造分支≠現行 line」
// （車號 436），同時每輪平均 2.9 台永久退牌（畫面上的無號 O 車）、2.4 台滯留 >10 分。
//
// 本檔鎖三條不變量：
//   F1 逐車資料在共線段站碼(O01–O12，兩支都有)上不得猜分支——沒有可信 priorLine 就不採用該列。
//   F2 共線段的 claim 不得改寫既有 track 的分支歸屬；只有分支獨有段(idx>11)的觀測才有權建立／變更它。
//   F3 帶號 claim 若與 alias 綁定的 track 分支相衝突、且自己站在分支獨有段，不得接管該 track
//      （那是同號跨分支重用，要另鑄 track），否則車號會被搬到別支、原車永久退牌。
// 每條都配「反向控制組」：分支獨有段的證據仍然必須能建立／更新分支，修法不得把功能一起關掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LEDGER_PATH = path.join(HERE, 'trtc_board_ledger.mjs');
const DAY = '2026-08-16';
const O_TRUNK_MAX = 11;            // 與 ledger 內同名常數對齊；共線段＝索引 0..11
const NOW = 1786834019;            // 2026-08-16 06:46:59 +08，即實測到那對重複車的時刻

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
const load = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

const ledger = await import(pathToFileURL(LEDGER_PATH).href);
const model = ledger.buildTrtcModel(load('data/trtc.json'), load('data/trtc_times.json'),
  load('data/trtc_codes.json'), { includeY: true });
const epochOf = value => Number(value);

// 前置事實：判準本身踩在真的資料上，不是我以為的形狀。
{
  const trunkCodes = ['O01', 'O05', 'O12'].map(c => model.codeMap.get(c));
  const exclusive = model.codeMap.get('O13');
  check(trunkCodes.every(r => r && r.on.filter(x => x.line.startsWith('O_')).length === 2),
    '前置：O01/O05/O12 是兩支共用的站碼');
  check(exclusive && exclusive.on.length === 1 && exclusive.on[0].line === 'O_XINZHUANG',
    '前置：O13 台北橋只屬迴龍支');
  const luzhou = model.lines.get('O_LUZHOU'), xin = model.lines.get('O_XINZHUANG');
  check(luzhou && xin && luzhou.stations.slice(0, O_TRUNK_MAX + 1)
    .every((s, i) => s.name === xin.stations[i].name),
    `前置：索引 0..${O_TRUNK_MAX} 兩支站名完全相同（同一段實體軌道）`);
}

// ---- F1：逐車資料在共線段不得猜分支 ----
const carRow = (no, stationID, cid = 1) => ({
  TrainNumber: no, StationID: stationID, CID: cid, utime: NOW,
  Cart1L: 1, Cart2L: 1, Cart3L: 1, Cart4L: 1, Cart5L: 1, Cart6L: 1,
});
{
  const blind = ledger.normalizeCarRows(model, [carRow('436', 'O05')], [], epochOf, new Map());
  check(blind.length === 0,
    'F1 共線段站碼＋無 priorLine ⇒ 不得採用（不准猜分支）',
    blind.length ? `卻猜成 ${blind[0].line}` : '已略過');

  const hinted = ledger.normalizeCarRows(model, [carRow('436', 'O05')], [], epochOf,
    new Map([['hw_no:436', 'O_LUZHOU']]));
  check(hinted.length === 1 && hinted[0].line === 'O_LUZHOU',
    'F1 控制組：共線段站碼＋有 priorLine ⇒ 沿用該分支',
    hinted.length ? hinted[0].line : '整列被丟掉');

  const exclusive = ledger.normalizeCarRows(model, [carRow('436', 'O13')], [], epochOf, new Map());
  check(exclusive.length === 1 && exclusive[0].line === 'O_XINZHUANG',
    'F1 控制組：分支獨有站碼 ⇒ 照常採用，分支唯一',
    exclusive.length ? exclusive[0].line : '整列被丟掉');

  const xbt = model.codeMap.get('G03');
  if (xbt && xbt.on.length > 1) {
    const g = ledger.normalizeCarRows(model, [{ ...carRow('999', 'G03'), CID: 1 }], [], epochOf, new Map());
    check(g.length === 1 && !/_XBT$/.test(g[0].line),
      'F1 控制組：小碧潭類 XBT 支線的既有偏好不受影響',
      g.length ? g[0].line : '整列被丟掉');
  }
}

// ---- 建 claim 的工具：直接組出 claimBoardRows 會產出的形狀 ----
function makeClaim({ line, dir, to, no, arrEpoch = NOW + 60, terminal = false }) {
  const step = dir === 2 ? 1 : -1;
  const from = terminal ? to : to - step;
  const run = terminal ? 0 : (ledger.runSeconds(model, line, dir, from, to, new Map()) || 90);
  const destIdx = dir === 2 ? model.lines.get(line).stations.length - 1 : 0;
  return {
    line, dir, stationIdx: to, destIdx, destName: model.lines.get(line).stations[destIdx].name,
    no: no || '', arrEpoch, baseEpoch: NOW, sec: arrEpoch - NOW, atStation: false,
    from, to, run, depEpoch: arrEpoch - run, progress: 0.5, ix: from + step * 0.5,
    terminal, eventClaims: [],
  };
}
const priorTrack = ({ id, line, dir, idx, no }) => ({
  day: DAY, track_id: id, line, dir, station_idx: idx, progress: idx,
  official_no: no || null, crowd: null, evidence: 'board', evidence_epoch: NOW - 60,
  last_seen_epoch: NOW - 60, payload: JSON.stringify({ key: id, no: no || null, line, dir }),
});
const alias = (no, trackId) => ({ day: DAY, alias_type: 'hw_no', alias: no, track_id: trackId,
  first_seen_epoch: NOW - 600, last_seen_epoch: NOW - 60 });
const updateFor = (frame, trackId) => frame.trackUpdates.find(u => u.trackId === trackId);

// ---- F2：共線段的 claim 不得改寫既有 track 的分支歸屬 ----
{
  // T1 = 蘆洲支上的 436，上一輪還在三重國小(idx12，蘆洲獨有)。本輪只剩共線段的列，
  // 而該列（因為 hint 掉了）被判成迴龍。舊碼會把 T1 的 line 直接改寫成 O_XINZHUANG。
  const prior = [priorTrack({ id: 'T1', line: 'O_LUZHOU', dir: 1, idx: 12, no: '436' })];
  const frame = ledger.assignLedgerFrame({
    model, claims: [makeClaim({ line: 'O_XINZHUANG', dir: 1, to: 1, no: '436' })],
    cars: [], priorTracks: prior, aliases: [alias('436', 'T1')], day: DAY, nowEpoch: NOW,
  });
  const t1 = updateFor(frame, 'T1');
  check(!t1 || t1.line === 'O_LUZHOU',
    'F2 共線段 claim 不得把 track 的分支改寫掉',
    t1 ? `T1.line=${t1.line}` : 'T1 本輪未被改寫');

  // 反向控制組：分支獨有段(idx15 先嗇宮，迴龍獨有)的觀測仍必須能建立／更新分支。
  const prior2 = [priorTrack({ id: 'T2', line: 'O_LUZHOU', dir: 1, idx: 12, no: '407' })];
  const frame2 = ledger.assignLedgerFrame({
    model, claims: [makeClaim({ line: 'O_XINZHUANG', dir: 1, to: 15, no: '407' })],
    cars: [], priorTracks: prior2, aliases: [alias('407', 'T2')], day: DAY, nowEpoch: NOW,
  });
  const anyXin = frame2.trackUpdates.some(u => u.line === 'O_XINZHUANG');
  check(anyXin, 'F2 控制組：分支獨有段的觀測仍能把分支定到迴龍',
    frame2.trackUpdates.map(u => `${u.trackId}=${u.line}`).join(' '));
}

// ---- F3：同號跨分支不得接管別支的 track ----
{
  // T3 是蘆洲支的 436（在蘆洲獨有段 idx13）。本輪迴龍獨有段 idx15 也出現一筆 436
  // ——那是不同的一趟。舊碼靠 aliasToTrack('hw_no:436') 直接接管 T3，把它整個搬到迴龍支。
  const prior = [priorTrack({ id: 'T3', line: 'O_LUZHOU', dir: 1, idx: 13, no: '436' })];
  const frame = ledger.assignLedgerFrame({
    model, claims: [makeClaim({ line: 'O_XINZHUANG', dir: 1, to: 15, no: '436' })],
    cars: [], priorTracks: prior, aliases: [alias('436', 'T3')], day: DAY, nowEpoch: NOW,
  });
  const t3 = updateFor(frame, 'T3');
  check(!t3, 'F3 分支獨有段的同號 claim 不得接管別支既有 track（應另鑄）',
    t3 ? `卻把 T3 搬成 ${t3.line}` : '已另鑄新 track');
  check(frame.trackUpdates.length === 1 && frame.trackUpdates[0].line === 'O_XINZHUANG',
    'F3 該 claim 仍要有自己的 track（不得整筆消失）',
    frame.trackUpdates.map(u => `${u.trackId.slice(0, 28)}=${u.line}`).join(' '));

  // 反向控制組：同分支同號本來就該接回原 track，不可因為修法而每輪重鑄。
  const prior2 = [priorTrack({ id: 'T4', line: 'O_LUZHOU', dir: 1, idx: 13, no: '436' })];
  const frame2 = ledger.assignLedgerFrame({
    model, claims: [makeClaim({ line: 'O_LUZHOU', dir: 1, to: 12, no: '436' })],
    cars: [], priorTracks: prior2, aliases: [alias('436', 'T4')], day: DAY, nowEpoch: NOW,
  });
  check(!!updateFor(frame2, 'T4'), 'F3 控制組：同分支同號仍接回原 track',
    frame2.trackUpdates.map(u => u.trackId).join(' '));
}

// ---- 迴圈整體：共線段的資料不得反過來決定 hint ----
{
  // 一條已經開進共線段的 track，其 line 若是被共線段資料寫上去的，就不該當成下一輪的分支證據。
  // 修好之後這條由 F2 保證：track.line 只能來自分支獨有段，於是它本來就是可信的證據。
  const onTrunk = priorTrack({ id: 'T5', line: 'O_XINZHUANG', dir: 1, idx: 3, no: '436' });
  const hints = ledger.branchLineHintsFromLedger([onTrunk], [alias('436', 'T5')]);
  check(hints.get('436') === 'O_XINZHUANG',
    '迴圈：hint 仍由 track.line 供應（F2 讓這個來源變成可信）', String(hints.get('436')));
}

console.log(`\n${failures ? '❌' : '✅'} 共 ${failures} 項未通過`);
process.exit(failures ? 1 : 0);
