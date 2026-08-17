// census 建車的區間與標記規則（純函式層，鏡像與前端同一套規則）。
//
// 註：本檔原先還有兩條「不准把車放到官方站碼兩站以外」與「方向要改聽 dir 欄位」的判準，
// 實測後撤掉——2026-08-17 對正式站量 390 個可判方向的樣本：dir 與 path 只有 4.1% 吵架，
// 其中 12/16 是車停在端點站（既有註解說的折返落後），剩下 4 筆的 dest 都站在 path 那邊
// （例：404 在景安、dir=1 南下，但 dest 迴龍在北、path 頭頂溪也在北 ⇒ dir 才是錯的那個）。
// 所以「path 優先於 dir」是對的，而「離官方站碼兩站以外」在官方同時給出遠站 eta 時，
// 依「位置不用準，時間一定要準」也是可接受的。判準不該寫成我猜的門檻。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrtcModel } from './trtc_board_ledger.mjs';
import { buildCensusRoster } from './trtc_census_roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const model = buildTrtcModel(j('data/trtc.json'), j('data/trtc_times.json'), j('data/trtc_codes.json'), { includeY: true });
const day = '2026-08-17';
const NOW = 1786951200;

let pass = 0, fail = 0;
const ok = (name, cond, got) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '　實測：' + got}`); };
const build = (t, prior) => {
  const { vehicles } = buildCensusRoster({ model, trains: [t], nowEpoch: NOW, day, prior: prior || [] });
  return vehicles[0] || null;
};
// O_LUZHOU 站序：0 南勢角 1 景安 2 永安市場 3 頂溪 4 古亭 5 東門 …
const IDX = { 南勢角: 0, 景安: 1, 永安市場: 2, 頂溪: 3, 古亭: 4, 東門: 5 };

// ── 官方站碼落後一段時，採信較新的 path（stn 實測落後 96–265 秒）────────────────
{
  const v = build({ no: 'B1', sys: 'hw', dir: 2, stn: 'O03', dest: '蘆洲站', at: NOW - 114,
    path: [{ name: '古亭', eta: NOW + 187 }, { name: '東門', eta: NOW + 382 }] });
  ok('stn 落後一段時採信 path，車放在頂溪→古亭',
    !!v && v.from === IDX.頂溪 && v.to === IDX.古亭, v ? `from=${v.from} to=${v.to}` : '沒建出來');
  ok('到站時刻照抄官方 path 的 eta（時間一定要準）',
    !!v && v.arrEpoch === NOW + 187, v ? String(v.arrEpoch - NOW) : '—');
}
// ── path 頭就是隔壁站 ⇒ from 必為官方站碼本身 ──────────────────────────────────
{
  const v = build({ no: 'C1', sys: 'hw', dir: 2, stn: 'O03', dest: '蘆洲站', at: NOW - 30,
    path: [{ name: '頂溪', eta: NOW + 60 }] });
  ok('path 頭是隔壁站 ⇒ from＝官方站碼',
    !!v && v.from === IDX.永安市場 && v.to === IDX.頂溪, v ? `from=${v.from} to=${v.to}` : '沒建出來');
}
// ── 防倒退分支必須自己填 holdReason，不得沿用上一輪的原因 ──────────────────────
// 這條是 2026-08-17 診斷 432 時真的被騙過的：名冊回報 holdReason='unresolved-station'，
// 但同一輪對同一台車直接呼叫解析函式其實回 {line:'O_LUZHOU',score:5} ⇒ 標籤是假的。
{
  const prior = [{ vehicleId: `cs:${day}:hw:E1`, line: 'O_LUZHOU', dir: 2, dest: 16,
    from: 3, to: 4, run: 100, arrEpoch: NOW + 50, terminal: false, officialNo: 'E1',
    source: 'census-hold', holdReason: 'unresolved-station', observedEpoch: NOW - 20,
    timeline: [{ from: 3, to: 4, depEpoch: NOW - 50, arrEpoch: NOW + 50, terminal: false }] }];
  const v = build({ no: 'E1', sys: 'hw', dir: 2, stn: 'O03', dest: '蘆洲站', at: NOW - 40,
    path: [{ name: '頂溪', eta: NOW + 60 }] }, prior);
  ok('防倒退分支不得沿用上一輪的 holdReason',
    !!v && v.holdReason !== 'unresolved-station', v ? `holdReason=${v.holdReason}` : '沒建出來');
  ok('防倒退分支標得出自己的原因',
    !!v && v.holdReason === 'no-backward', v ? `holdReason=${v.holdReason}` : '沒建出來');
}

console.log(`\n合計 ${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
