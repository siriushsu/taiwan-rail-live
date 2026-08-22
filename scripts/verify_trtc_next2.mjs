// 驗收：小工具「再下一班」推導 deriveSecondArrivals（2026-08-22 裁示）。
// 用真 model（data/trtc*.json）＋手工名冊固定樣本，逐條具名斷言；任一 FAIL exit 1。
// 斷言原則（judgment 心得 35/37）：判「誰被選上/誰被排除」這種結構性行為，
// 不判「秒數加總對不對」（那與實作同源，只做上下界 sanity）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrtcModel, deriveSecondArrivals, applyNext2ToBoard,
  NEXT2_MIN_GAP_SEC, NEXT2_MAX_HORIZON_SEC } from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p)));
const model = buildTrtcModel(load('data/trtc.json'), load('data/trtc_times.json'),
  load('data/trtc_codes.json'), { includeY: true });

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};

const BASE = 1787400000;
const br = model.lines.get('BR');
if (!br) { console.log('FAIL model 無 BR 線'); process.exit(1); }
const S = 10, DEST = 0; // BR 中段站往 idx0 方向（dir 1，索引遞減）
const rowAt = (line, stationIdx, destIdx, arrSec) => ({
  line, dir: destIdx > stationIdx ? 2 : 1, stationIdx, destIdx,
  destName: model.lines.get(line).stations[destIdx].name,
  arrEpoch: BASE + arrSec, baseEpoch: BASE, sec: arrSec, atStation: arrSec === 0,
});
const veh = (line, dir, from, to, dest, arrSec, extra = {}) => ({
  vehicleId: `t:${line}:${from}>${to}:${arrSec}`, line, dir, dest, from, to,
  run: 10, arrEpoch: BASE + arrSec, terminal: false, ...extra,
});
const keyOf = r => `${model.lines.get(r.line).stations[r.stationIdx].name}|${r.destName}`;
const hit = (out, r) => out.find(x => `${x.s}|${x.d}` === keyOf(r));

// T1 兩班同終點在途 ⇒ 第二班有 eta2，且嚴格晚於官方列 eta＋間隔、早於視界
{
  const r = rowAt('BR', S, DEST, 60);
  const first = veh('BR', 1, S + 1, S, DEST, 60);        // 第一班：下一站就是本站，與官方列同刻
  const second = veh('BR', 1, S + 3, S + 2, DEST, 30);   // 第二班：上游兩站外
  const out = deriveSecondArrivals(model, [r], [first, second]);
  const h = hit(out, r);
  check('T1 第二班在途 ⇒ 產出 eta2', !!h, JSON.stringify(out));
  if (h) {
    check('T1b eta2 晚於官方列 eta+MIN_GAP', h.eta2 > r.arrEpoch + NEXT2_MIN_GAP_SEC, `eta2=${h.eta2}`);
    check('T1c eta2 在一小時視界內', h.eta2 - BASE <= NEXT2_MAX_HORIZON_SEC, `eta2=${h.eta2}`);
    check('T1d 選中的是第二班不是自己', h.v2 === second.vehicleId, h.v2);
  }
}
// T2 只有第一班在途 ⇒ 自班被 MIN_GAP 濾掉，留白
{
  const r = rowAt('BR', S, DEST, 60);
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60)]);
  check('T2 僅自班 ⇒ 留白', !hit(out, r), JSON.stringify(out));
}
// T3 未發車起點列不算車（08-18 裁示）：from===to && terminal && run===0 排除
{
  const r = rowAt('BR', S, DEST, 60);
  const origin = { ...veh('BR', 1, br.stations.length - 1, br.stations.length - 1, DEST, 300),
    from: br.stations.length - 1, to: br.stations.length - 1, run: 0, terminal: true };
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), origin]);
  check('T3 未發車起點列 ⇒ 不生第二班', !hit(out, r), JSON.stringify(out));
  const originMoving = { ...origin, terminal: false, run: 40, from: br.stations.length - 1,
    to: br.stations.length - 2, vehicleId: 't:BR:moved' };
  const out2 = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), originMoving]);
  check('T3b 同一台一旦發車 ⇒ 恢復可當第二班', !!hit(out2, r), JSON.stringify(out2));
}
// T4 短程車終點不同 ⇒ 不掛在本列（它屬於官方自己的那一列）
{
  const r = rowAt('BR', S, DEST, 60);
  const shortTurn = veh('BR', 1, S + 3, S + 2, 5, 30); // 物理上會經過 S，但 dest=5≠0
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), shortTurn]);
  check('T4 短程車(終點不同) ⇒ 不掛本列', !hit(out, r), JSON.stringify(out));
}
// T5 反向車不誤入
{
  const r = rowAt('BR', S, DEST, 60);
  // 反向但終點欄與本列相同＝矛盾的名冊資料（dir 與 to→dest 幾何互斥）；
  // 同終點檢查擋不住這種列，方向檢查是它唯一的閘（fail-closed on malformed row）。
  const wrongDir = veh('BR', 2, S + 3, S + 2, DEST, 30);
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), wrongDir]);
  check('T5 反向車 ⇒ 不誤入', !hit(out, r), JSON.stringify(out));
}
// T6 已駛過本站的車不回頭
// （突變註記：拿掉該 guard 時，走訪方向綁 r.dir ⇒ 已過站候選只會走離本站、
//   在線端因缺 run 被棄，結構上仍不可能產生錯 eta2——guard 是縱深防禦，本測試釘行為不釘實作路徑。）
{
  const r = rowAt('BR', S, DEST, 60);
  const passed = veh('BR', 1, S - 1, S - 2, DEST, 30);
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), passed]);
  check('T6 已過站車 ⇒ 不回頭當第二班', !hit(out, r), JSON.stringify(out));
}
// T7 區間 run 缺值 ⇒ 放棄候選不猜（用假線 id 摸不到 runs 的路徑：Y 線 runs 實際全缺）
{
  const y = model.lines.get('Y');
  if (y) {
    const yr = rowAt('Y', 3, 0, 60);
    const out = deriveSecondArrivals(model, [yr], [veh('Y', 1, 4, 3, 0, 60), veh('Y', 1, 6, 5, 0, 30)]);
    const anyRun = [...(y.runs || new Map()).values()].some(v => v > 0);
    if (anyRun) check('T7 Y 線有 runs（前提變了，跳過缺值斷言）', true);
    else check('T7 缺 run ⇒ 留白不猜', !hit(out, yr), JSON.stringify(out));
  } else check('T7 model 無 Y 線（跳過）', true);
}
// T7b 缺 run 的永久覆蓋（不依賴 Y 線資料現況）：合成三站線、runs 全空 ⇒ 留白不猜
{
  const fake = { lines: new Map([['FAKE', { id: 'FAKE',
    stations: [{ name: '甲', dwell: 25 }, { name: '乙', dwell: 25 }, { name: '丙', dwell: 25 }],
    runs: new Map() }]]) };
  const fr = { line: 'FAKE', dir: 1, stationIdx: 0, destIdx: 0, destName: '甲',
    arrEpoch: BASE + 60, baseEpoch: BASE, sec: 60, atStation: false };
  const out = deriveSecondArrivals(fake, [fr],
    [veh('FAKE', 1, 1, 0, 0, 60), veh('FAKE', 1, 2, 1, 0, 400)]); // 400s：確保若缺 run 被當 0 硬走，eta 會越過 MIN_GAP 而露餡
  check('T7b 缺 run ⇒ 放棄候選留白', !out.find(x => x.s === '甲'), JSON.stringify(out));
}
// T8 視界上限：一小時外不出手
{
  const r = rowAt('BR', S, DEST, 60);
  const far = veh('BR', 1, S + 2, S + 1, DEST, 3550); // 到下一站已 59 分，再加一段必超 60 分
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), far]);
  check('T8 超過一小時視界 ⇒ 留白', !hit(out, r), JSON.stringify(out));
}
// T9 空名冊 ⇒ 空產出（不憑空造）
{
  const r = rowAt('BR', S, DEST, 60);
  const out = deriveSecondArrivals(model, [r], []);
  check('T9 空名冊 ⇒ 零產出', out.length === 0, JSON.stringify(out));
}
// T10 站名鍵與 board 列 join 的正規化一致性：model 站名不帶「站」尾且臺→台
{
  const bad = [];
  for (const [, line] of model.lines) for (const st of line.stations) {
    if (/站$/.test(st.name) || /臺/.test(st.name)) bad.push(`${line.id}:${st.name}`);
  }
  check('T10 model 站名已正規化（join 鍵兩側同套）', bad.length === 0, bad.slice(0, 5).join(','));
}
// T12 忠孝復興撞名對（全網唯一的跨線同站同終點）：join 鍵靠 no+eta 分辨，
// 完全不可分辨時毒化留白，絕不把 A 線的第二班貼到 B 線列上
{
  const bl = model.lines.get('BL');
  const blS = bl.stations.findIndex(x => x.name === '忠孝復興');
  const brS = br.stations.findIndex(x => x.name === '忠孝復興');
  const blDest = bl.stations.length - 1, brDest = br.stations.length - 1;
  check('T12pre 兩線都有忠孝復興且終點同名', blS > 0 && brS > 0 &&
    bl.stations[blDest].name === br.stations[brDest].name, `bl=${blS} br=${brS}`);
  const rBL = rowAt('BL', blS, blDest, 60);
  const rBR = rowAt('BR', brS, brDest, 60);
  const fleet = [
    veh('BL', 2, blS - 1, blS, blDest, 60), veh('BL', 2, blS - 3, blS - 2, blDest, 90),
    veh('BR', 2, brS - 1, brS, brDest, 60), veh('BR', 2, brS - 5, brS - 4, brDest, 120),
  ];
  const out = deriveSecondArrivals(model, [rBL, rBR], fleet);
  check('T12a 兩線各推出自己的第二班', out.length === 2 &&
    new Set(out.map(x => x.v2)).size === 2, JSON.stringify(out));
  const mkBoard = (noBL, noBR) => [
    { name: '忠孝復興站', dest: '南港展覽館站', eta: BASE + 60, at: BASE, no: noBL },
    { name: '忠孝復興站', dest: '南港展覽館站', eta: BASE + 60, at: BASE, no: noBR },
  ];
  // 現實形狀：BL 有車號、BR 無 ⇒ 鍵可分辨，兩列各得自己線的 eta2
  const outN = deriveSecondArrivals(model, [{ ...rBL, no: '222' }, rBR], fleet);
  const b1 = mkBoard('222', '');
  const n1 = applyNext2ToBoard(b1, outN);
  const e2BL = outN.find(x => x.no === '222'), e2BR = outN.find(x => x.no === '');
  check('T12b no 可分辨 ⇒ 各得其線', n1 === 2 && e2BL && e2BR &&
    b1[0].eta2 === e2BL.eta2 && b1[1].eta2 === e2BR.eta2 && b1[0].eta2 !== b1[1].eta2,
    JSON.stringify({ n1, b1 }));
  // 理論角落：兩列 no 都空、同刻 ⇒ 鍵完全相同但 eta2 不同 ⇒ 毒化，兩列都留白
  const b2 = mkBoard('', '');
  const n2 = applyNext2ToBoard(b2, out);
  check('T12c 完全不可分辨 ⇒ 毒化雙留白', n2 === 0 && b2[0].eta2 == null && b2[1].eta2 == null,
    JSON.stringify({ n2, b2 }));
}
// T13 applyNext2ToBoard 一般情形：正規化站名 join＋只在 eta2>eta 時裝飾
{
  const r = rowAt('BR', S, DEST, 60);
  const out = deriveSecondArrivals(model, [r],
    [veh('BR', 1, S + 1, S, DEST, 60), veh('BR', 1, S + 3, S + 2, DEST, 30)]);
  const stName = br.stations[S].name, destName = br.stations[DEST].name;
  const rows = [{ name: `${stName}站`, dest: `${destName}站`, eta: BASE + 60, at: BASE, no: '' }];
  const n = applyNext2ToBoard(rows, out);
  check('T13 一般列 join 成功且 eta2>eta', n === 1 && rows[0].eta2 > rows[0].eta,
    JSON.stringify(rows));
}
// T11 覆蓋率具名斷言：本檔案應執行的斷言數（心得37d：分母自己要被 gate）
{
  const EXPECTED_MIN = 19; // T1..T13 全部路徑至少 19 條 check
  check('T11 斷言分母未縮水', pass + fail >= EXPECTED_MIN, `ran=${pass + fail}`);
}

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
