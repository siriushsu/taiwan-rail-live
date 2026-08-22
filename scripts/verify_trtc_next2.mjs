// 驗收：小工具「再下一班」推導 deriveSecondArrivals＋裝飾 applyNext2ToBoard（2026-08-22 裁示）。
// 用真 model（data/trtc*.json）＋手工名冊固定樣本，逐條具名斷言；任一 FAIL exit 1。
// 斷言原則（judgment 心得 35/37）：判「誰被選上/誰被排除」這種結構性行為，
// 不判「秒數加總對不對」（那與實作同源，只做上下界 sanity）。
// 獨立驗收（2026-08-22 NO-GO 輪）補的判準缺口在此版全數補上：
//   裁示4 欄位逐欄不變（T16，殺 M6/M7 突變）、同鍵單邊產出／不可分辨情境（T12 族）、
//   T7 恆綠空斷言移除（改 Y 正向產出）、terminal:1 型別漂移（T17）。
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
const rowAt = (line, stationIdx, destIdx, arrSec, no = '') => ({
  line, dir: destIdx > stationIdx ? 2 : 1, stationIdx, destIdx,
  destName: model.lines.get(line).stations[destIdx].name,
  no, arrEpoch: BASE + arrSec, baseEpoch: BASE, sec: arrSec, atStation: arrSec === 0,
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
// （突變註記：拿掉該 guard 時，走訪方向綁行進步向 ⇒ 已過站候選只會走離本站、
//   在線端因缺 run 被棄，結構上仍不可能產生錯 eta2——guard 是縱深防禦，本測試釘行為不釘實作路徑。）
{
  const r = rowAt('BR', S, DEST, 60);
  const passed = veh('BR', 1, S - 1, S - 2, DEST, 30);
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), passed]);
  check('T6 已過站車 ⇒ 不回頭當第二班', !hit(out, r), JSON.stringify(out));
}
// T7 Y 線正向產出（環狀線 runs 目前有值——舊版此處是「有 runs 就跳過」的恆綠空斷言，
// 獨立驗收點名後改成正向覆蓋；缺 run 的行為由 T7b 用合成線永久釘住，不依賴 Y 資料現況）
{
  const y = model.lines.get('Y');
  if (y) {
    const yr = rowAt('Y', 3, 0, 60);
    const out = deriveSecondArrivals(model, [yr], [veh('Y', 1, 4, 3, 0, 60), veh('Y', 1, 6, 5, 0, 30)]);
    const anyRun = [...(y.runs || new Map()).values()].some(v => v > 0);
    check('T7 Y 線(runs 有值)正常產出第二班', anyRun ? !!hit(out, yr) : !hit(out, yr),
      JSON.stringify({ anyRun, out }));
  } else check('T7 model 無 Y 線（跳過）', true);
}
// T7b 缺 run 的永久覆蓋（不依賴 Y 線資料現況）：合成三站線、runs 全空 ⇒ 留白不猜
{
  const fake = { lines: new Map([['FAKE', { id: 'FAKE',
    stations: [{ name: '甲', dwell: 25 }, { name: '乙', dwell: 25 }, { name: '丙', dwell: 25 }],
    runs: new Map() }]]) };
  const fr = { line: 'FAKE', dir: 1, stationIdx: 0, destIdx: 0, destName: '甲',
    no: '', arrEpoch: BASE + 60, baseEpoch: BASE, sec: 60, atStation: false };
  const out = deriveSecondArrivals(fake, [fr],
    [veh('FAKE', 1, 1, 0, 0, 60), veh('FAKE', 1, 2, 1, 0, 400)]); // 400s：若缺 run 被當 0 硬走，eta 會越過 MIN_GAP 而露餡
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
// T12 忠孝復興 BL/BR 撞名對——同批互斥信任（獨立驗收抓到的洩漏路徑：BL 掉車號會被
// 解析成 BR ⇒ 板南線列拿到文湖線車的第二班；join 鍵擋不住，必須在推導層擋）
{
  const bl = model.lines.get('BL');
  const blS = bl.stations.findIndex(x => x.name === '忠孝復興');
  const brS = br.stations.findIndex(x => x.name === '忠孝復興');
  const blDest = bl.stations.length - 1, brDest = br.stations.length - 1;
  check('T12pre 兩線都有忠孝復興且終點同名', blS > 0 && brS > 0 &&
    bl.stations[blDest].name === br.stations[brDest].name, `bl=${blS} br=${brS}`);
  const fleet = [
    veh('BL', 2, blS - 1, blS, blDest, 60), veh('BL', 2, blS - 3, blS - 2, blDest, 90),
    veh('BR', 2, brS - 1, brS, brDest, 60), veh('BR', 2, brS - 5, brS - 4, brDest, 120),
  ];
  // (a) 現實正常形狀：BL 帶號＋BR 無號 ⇒ 互斥成立，兩列各得自己線的第二班
  const rBLn = rowAt('BL', blS, blDest, 60, '222');
  const rBR = rowAt('BR', brS, brDest, 60);
  const outN = deriveSecondArrivals(model, [rBLn, rBR], fleet);
  check('T12a 帶號+無號 ⇒ 兩列各得自己線的第二班', outN.length === 2 &&
    outN.some(x => x.no === '222' && /^t:BL:/.test(x.v2)) &&
    outN.some(x => x.no === '' && /^t:BR:/.test(x.v2)), JSON.stringify(outN));
  // (b) 洩漏場景（BL 掉號 ⇒ 解析後兩列都是無號）⇒ 不可分辨，整組不產
  const rBLblank = rowAt('BL', blS, blDest, 60);
  const outB = deriveSecondArrivals(model, [rBLblank, rBR], fleet);
  check('T12b 全無號 ⇒ 不可分辨,整組留白', outB.length === 0, JSON.stringify(outB));
  // (c) 無號列落單（可能是掉號的 BL 也可能是 BR）⇒ 無佐證,留白
  const outC = deriveSecondArrivals(model, [rBR], fleet);
  check('T12c 無號列落單 ⇒ 留白', outC.length === 0, JSON.stringify(outC));
  // (d) 帶號列落單 ⇒ 恆可信,正常產出
  const outD = deriveSecondArrivals(model, [rBLn], fleet);
  check('T12d 帶號列落單 ⇒ 正常產出', outD.length === 1 && /^t:BL:/.test(outD[0].v2),
    JSON.stringify(outD));
  // (e) 裝飾層毒化直測（縱深防禦,推導層擋掉後這裡用手工條目維持突變有牙）：
  //     同鍵不同 eta2 ⇒ 兩列都留白
  const b2 = [
    { name: '忠孝復興站', dest: '南港展覽館站', eta: BASE + 60, at: BASE, no: '' },
    { name: '忠孝復興站', dest: '南港展覽館站', eta: BASE + 60, at: BASE, no: '' },
  ];
  const n2 = applyNext2ToBoard(b2, [
    { s: '忠孝復興', d: '南港展覽館', no: '', eta: BASE + 60, eta2: BASE + 300, v2: 'x' },
    { s: '忠孝復興', d: '南港展覽館', no: '', eta: BASE + 60, eta2: BASE + 400, v2: 'y' },
  ]);
  check('T12e 同鍵不同值 ⇒ 毒化雙留白', n2 === 0 && b2[0].eta2 == null && b2[1].eta2 == null,
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
// T15 中和新蘆線共線段往南勢角——兩支線候選聯集（13 檔實測 54% 的列姊妹支線更早、
// 平均早 350 秒；只取同支線會把真第二班跳過＝顯示錯誤資訊）
{
  const oL = model.lines.get('O_LUZHOU'), oX = model.lines.get('O_XINZHUANG');
  const sIdx = oL.stations.findIndex(x => x.name === '大橋頭');
  const sIdxX = oX.stations.findIndex(x => x.name === '大橋頭');
  const nanIdx = oL.stations.findIndex(x => x.name === '南勢角');
  check('T15pre 大橋頭/南勢角在兩支線都存在', sIdx > 0 && sIdxX > 0 && nanIdx === 0 &&
    oX.stations.findIndex(x => x.name === '南勢角') === 0, `L=${sIdx} X=${sIdxX}`);
  // (a) 往南勢角：本支線第二班在 4 站外、姊妹支線的車只在 1 站外 ⇒ 取姊妹支線
  const r = rowAt('O_LUZHOU', sIdx, nanIdx, 60);
  const ownFirst = veh('O_LUZHOU', 1, sIdx + 1, sIdx, nanIdx, 60);
  const ownSecond = veh('O_LUZHOU', 1, sIdx + 5, sIdx + 4, nanIdx, 30);
  const sisterSooner = veh('O_XINZHUANG', 1, sIdxX + 2, sIdxX + 1, 0, 40);
  const out = deriveSecondArrivals(model, [r], [ownFirst, ownSecond, sisterSooner]);
  const h = hit(out, r);
  check('T15a 姊妹支線更早 ⇒ eta2 取聯集最早(跨支線)', !!h && h.v2 === sisterSooner.vehicleId,
    JSON.stringify(out));
  // (b) 往蘆洲：終點只在自己支線 ⇒ 不聯集,迴龍向的姊妹車絕不誤入
  const luzhouIdx = oL.stations.length - 1;
  const r2 = rowAt('O_LUZHOU', sIdx, luzhouIdx, 60);
  const sisterWrong = veh('O_XINZHUANG', 2, sIdxX - 1, sIdxX + 1, oX.stations.length - 1, 40);
  const out2 = deriveSecondArrivals(model, [r2], [veh('O_LUZHOU', 2, sIdx - 1, sIdx, luzhouIdx, 60), sisterWrong]);
  check('T15b 往蘆洲 ⇒ 姊妹支線(往迴龍)不誤入', !hit(out2, r2), JSON.stringify(out2));
  // (c) XBT 接駁線與主線不誤聯：G 主線七張往新店,G_XBT 車不得成為第二班
  const g = model.lines.get('G');
  const qz = g.stations.findIndex(x => x.name === '七張');
  const r3 = rowAt('G', qz, 0, 60); // 往新店(idx 0)
  const xbtCar = veh('G_XBT', 1, 1, 0, 0, 40); // 小碧潭→七張方向的接駁車
  const out3 = deriveSecondArrivals(model, [r3], [veh('G', 1, qz + 1, qz, 0, 60), xbtCar]);
  check('T15c G 主線列不吃 XBT 接駁車', !hit(out3, r3), JSON.stringify(out3));
}
// T16 裁示4：applyNext2ToBoard 之後,board 列的既有欄位一個位元組都不能變、列數順序不變
//（獨立驗收 M6/M7 突變證明舊版無此斷言 ⇒ 裝飾層順手改欄位不會被抓到）
{
  const r = rowAt('BR', S, DEST, 60);
  const out = deriveSecondArrivals(model, [r],
    [veh('BR', 1, S + 1, S, DEST, 60), veh('BR', 1, S + 3, S + 2, DEST, 30)]);
  const stName = br.stations[S].name, destName = br.stations[DEST].name;
  const rows = [
    { name: `${stName}站`, dest: `${destName}站`, eta: BASE + 60, at: BASE, no: '' },
    { name: '別站', dest: '別終點', eta: BASE + 90, at: BASE, no: '77' },
  ];
  const before = rows.map(b => ({ name: b.name, dest: b.dest, eta: b.eta, at: b.at, no: b.no }));
  applyNext2ToBoard(rows, out);
  const same = rows.length === before.length && rows.every((b, i) =>
    ['name', 'dest', 'eta', 'at', 'no'].every(k => Object.is(b[k], before[i][k])));
  check('T16 既有欄位逐欄不變(只增 eta2)', same &&
    Object.keys(rows[0]).every(k => k === 'eta2' || k in before[0]),
    JSON.stringify(rows));
}
// T17 terminal 型別漂移：terminal:1 的未發車起點列也要被排除（D1/SQLite 無布林型別）
{
  const r = rowAt('BR', S, DEST, 60);
  const origin1 = { ...veh('BR', 1, br.stations.length - 1, br.stations.length - 1, DEST, 300),
    from: br.stations.length - 1, to: br.stations.length - 1, run: 0, terminal: 1 };
  const out = deriveSecondArrivals(model, [r], [veh('BR', 1, S + 1, S, DEST, 60), origin1]);
  check('T17 terminal:1 未發車列 ⇒ 一樣排除', !hit(out, r), JSON.stringify(out));
}
// T18 no 是 join 鍵的一部分：兩列同站同終點【同一秒】只剩車號能分（獨立驗收實測
// 樣本 12 真的發生過）⇒ 拿掉 no 判別欄會讓兩列被毒化留白（安全但功能消失），
// 本測釘住「可分辨時必須各得其值」
{
  const b = [
    { name: '忠孝復興站', dest: '南港展覽館站', eta: BASE + 60, at: BASE, no: '222' },
    { name: '忠孝復興站', dest: '南港展覽館站', eta: BASE + 60, at: BASE, no: '' },
  ];
  const n = applyNext2ToBoard(b, [
    { s: '忠孝復興', d: '南港展覽館', no: '222', eta: BASE + 60, eta2: BASE + 300, v2: 'bl' },
    { s: '忠孝復興', d: '南港展覽館', no: '', eta: BASE + 60, eta2: BASE + 400, v2: 'br' },
  ]);
  check('T18 同秒兩列靠 no 分辨 ⇒ 各得其值', n === 2 && b[0].eta2 === BASE + 300 && b[1].eta2 === BASE + 400,
    JSON.stringify(b));
}
// T11 覆蓋率具名斷言：本檔案應執行的斷言數（心得37d：分母自己要被 gate）
{
  const EXPECTED_MIN = 27;
  check('T11 斷言分母未縮水', pass + fail >= EXPECTED_MIN, `ran=${pass + fail}`);
}

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
