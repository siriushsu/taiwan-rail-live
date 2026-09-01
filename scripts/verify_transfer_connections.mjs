#!/usr/bin/env node
// 轉乘接續查詢層驗收。從 index.html 抽真原始碼執行，不另建複本
// (repo 既有的 verify_*.mjs 都是這樣做，避免另外維護一份會漂移的複本)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const data = JSON.parse(readFileSync(path.join(ROOT, 'data', 'transfer_departures.json'), 'utf8'));

let fails = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) fails++; };

// G0 —— 先證明我抽到的是真的那個函式（形態 0：沒證明「我在量的是誰」）。
// 連同前面的 XFER_WINDOW_SEC 一起抽：函式本體引用它，只抽 function 那段會在
// eval 時丟 ReferenceError（不是「找不到函式」，是「函式找到了但缺它依賴的常數」，
// 兩種失敗長得不一樣，故意用單一正則把兩者當同一個單元抽出，不留下第二個漂移點）。
const m = html.match(/const XFER_WINDOW_SEC[\s\S]*?\nfunction transferConnections\([\s\S]*?\n\}/);
ok('G0 抽到 transferConnections(含 XFER_WINDOW_SEC)', !!m, m ? `${m[0].split('\n').length} 行` : '找不到');
if (!m) { console.log(`\n${fails} 項未過`); process.exit(1); }

const state = { transferDepartures: data };
const { transferConnections, XFER_WINDOW_SEC } =
  new Function('state', `${m[0]}; return { transferConnections, XFER_WINDOW_SEC };`)(state);

const S = (h, mm) => h * 3600 + mm * 60;

// 用群 id，不用站名（規格：groupId 是 transferId，用站名當鍵在各系統寫法不同會靜默對不上）。
// 下面兩個 id 已對照 data/transfer_departures.json 實際內容核實過（非猜測）：
const GID_TAICHUNG = 'T-THSR-1040';  // 台中：THSR 成員「台中」／TRA 成員「新烏日」
const GID_BANQIAO  = 'T-NTMC-Y16';   // 板橋：THSR 成員「板橋」／TRA 成員「板橋」，members 裡沒有捷運鍵

// G1 —— 正向：台中，台鐵車 15:38 到新烏日，應該查得到高鐵
const r1 = transferConnections(GID_TAICHUNG, S(15, 38), 'TRA');
ok('G1 台中查得到接續', r1.length > 0, `${r1.length} 班`);
ok('G1b 全部是高鐵(排除自己)', r1.every(x => x.sys !== 'TRA'), r1.map(x => x.sys).join(','));
ok('G1c 依時間升冪', r1.every((x, i) => i === 0 || x.sec >= r1[i - 1].sec));
ok('G1d 全部晚於到站時刻', r1.every(x => x.sec >= S(15, 38)));
ok('G1e leftSec = sec - atSec', r1.every(x => x.leftSec === x.sec - S(15, 38)));

// G2 —— 反向對照：只把到站時刻往後推，其餘輸入完全相同 ⇒ 前面的班次必須落選
const r2 = transferConnections(GID_TAICHUNG, S(15, 38) + 40 * 60, 'TRA');
ok('G2 誤點 40 分後第一班不同', r1.length && r2.length && r1[0].n !== r2[0].n,
   `${r1[0]?.n} → ${r2[0]?.n}`);
ok('G2b 落選的都比新到站時刻早', r1.filter(x => !r2.some(y => y.n === x.n))
   .every(x => x.sec < S(15, 38) + 40 * 60));

// G2c —— 3 小時窗：超過就不該出現(規格 §5.5)
ok('G2c 全部落在 3 小時窗內', r1.every(x => x.leftSec <= 3 * 3600),
   `最遠 ${Math.max(...r1.map(x => x.leftSec)) / 60} 分`);
const far = transferConnections(GID_TAICHUNG, S(2, 0), 'TRA');   // 凌晨 2 點：窗內不會有車
ok('G2d 窗外回空陣列', far.length === 0, `${far.length} 班`);

// G3 —— 板橋只回高鐵，不含捷運（板橋群的 members 結構上就沒有捷運鍵，見規格 §2「捷運不做接續」）
const r3 = transferConnections(GID_BANQIAO, S(16, 12), 'TRA');
ok('G3 板橋有查到接續', r3.length > 0, `${r3.length} 班`);
ok('G3b 板橋只回高鐵、不含捷運', r3.every(x => x.sys === 'THSR'), [...new Set(r3.map(x => x.sys))].join(','));

// G4 —— 不在 9 群裡的 id 回空陣列（而不是拋錯）
const r4 = transferConnections('NOT-A-REAL-GROUP-ID', S(15, 0), 'TRA');
ok('G4 非轉乘群 id 回空陣列', Array.isArray(r4) && r4.length === 0, `${r4.length} 班`);

// G5 —— 資料缺席時不炸（載不到就靜默消失，比照 state.stationTransfers 的約定）
const noData = new Function('state', `${m[0]}; return transferConnections;`)({ transferDepartures: null });
let threw = false;
let r5 = null;
try { r5 = noData(GID_TAICHUNG, S(15, 38), 'TRA'); } catch (e) { threw = true; }
ok('G5 沒有資料時不拋錯', !threw);
ok('G5b 沒有資料時回空陣列', Array.isArray(r5) && r5.length === 0);

// G6 —— atSec 非有限數一律回空陣列，不補預設值、不用 Date.now() 兜底（幽靈車沒有到站秒數）
ok('G6 atSec=NaN 回空陣列', transferConnections(GID_TAICHUNG, NaN, 'TRA').length === 0);
ok('G6b atSec=undefined 回空陣列', transferConnections(GID_TAICHUNG, undefined, 'TRA').length === 0);
// G6c(獨立審查發現原版是假陽性,已改法)—— atSec=Infinity 這個輸入無法用「結果是不是空陣列」
// 測出 guard 在不在:sec-Infinity 恆為 -Infinity,恆滿足 left<0,不管 Number.isFinite(atSec)
// 這關存不存在,結果都是 []（已用獨立實驗證實:把整道 guard 拿掉,G6/G6b 正確轉紅,但原本這條
// Infinity 版本仍全綠——是「算術巧合通過」,從未真的命中守門邏輯）。±Infinity 在數學上都會被
// 視窗的上/下界攔下,無法用任何黑箱輸入分辨,故改讀原始碼:斷言 guard 條件式明文包含
// Number.isFinite(atSec) 這個判斷——這是唯一能把「關卡在不在」與「這個特定輸入的巧合」分開的方式。
ok('G6c guard 明文包含 Number.isFinite(atSec)', /Number\.isFinite\(atSec\)/.test(m[0]));

// G7 —— fromSys=null 代表不排除任何系統（規格：搭捷運時傳 null）。
// 用聯集驗證，不用「筆數相同」：fromSys='TRA' 只留 THSR、fromSys='THSR' 只留 TRA，
// 兩個結果集合不相交，其聯集必須等於 fromSys=null 的結果（實測 32+22=54，任何一邊都不等於 54）。
const rExclTra  = transferConnections(GID_TAICHUNG, S(15, 38), 'TRA');
const rExclThsr = transferConnections(GID_TAICHUNG, S(15, 38), 'THSR');
const rNull     = transferConnections(GID_TAICHUNG, S(15, 38), null);
ok('G7 fromSys=null 同時含兩個系統', new Set(rNull.map(x => x.sys)).size === 2,
   [...new Set(rNull.map(x => x.sys))].join(','));
ok('G7b null 的筆數 = 兩次個別排除的總和', rNull.length === rExclTra.length + rExclThsr.length,
   `${rExclTra.length}+${rExclThsr.length} vs ${rNull.length}`);

// G8 —— 群 id 命名空間與 station_transfers.json 一致(兩份 Task 1 產物用同一套 id，
// 否則畫面層用 stationTransferGroups 反查同一個 id 時會靜默對不上，見 task-2-context.md §4)
const stationTransfers = JSON.parse(readFileSync(path.join(ROOT, 'data', 'station_transfers.json'), 'utf8'));
const stIds = new Set((stationTransfers.transferStations || []).map(g => g.id));
for (const g of data.groups) ok(`G8 群 id ${g.id} 存在於 station_transfers.json`, stIds.has(g.id));

// ── 以下三組是獨立審查(fresh-context agent 對本檔跑突變測試)發現的沉默盲區,補上 ──────────

// G9 —— isLast 到站不是「可搭的班次」(index.html:16325 `if (!names.includes(stn) || isLast) continue;`)。
// 審查發現:把這個判斷拿掉,原本 27 條照樣全綠——G1 用 atSec=15:38 剛好躲開全部 7 筆 THSR 台中
// isLast 到站(2 筆在窗前、其餘 5 筆在窗後);G2 用 atSec=16:18 其實會命中 1 筆(18:56 那班該混進來,
// 已用獨立 Python 重算證實),但 G2/G2b 只驗「首班變了」與「落選的都更早」,不驗「有沒有混進不該有
// 的」,所以照樣測不到。直接複用 G2 已查過的 r2(查詢窗 (58680,69480]):THSR 車次 1547 於
// 18:56(68160 秒)到台中是它的終點站,68160 落在這個窗內,若 isLast 判斷被拿掉就會混進來。
ok('G9 終點到站(THSR 1547・18:56)不得出現在接續清單', !r2.some(x => x.n === '1547'), r2.map(x => x.n).join(','));
// 正向對照:不是「整段查詢剛好回空」才通過 G9——窗內仍有其他(非終點)班次正常回傳。
ok('G9b 同一窗內其他(非終點)班次仍正常回傳', r2.length > 0, `${r2.length} 班`);

// G10 —— 3 小時窗是規格 §5.5 寫死的數字,不是「隨便一個夠用的值」。
// 審查發現:原本只驗「沒超過 3 小時」(G2c)與「length>0」(G1),把窗改成 2 小時(32→20 班)一樣
// 全綠——「更窄的窗」天生滿足「沒超過 3 小時」,G1 也還是 length>0。先直接釘住常數本身:
ok('G10 XFER_WINDOW_SEC 等於 3 小時', XFER_WINDOW_SEC === 3 * 3600, `${XFER_WINDOW_SEC}`);
// 再用行為面補一刀,防止「常數對但比較邏輯抄錯」這種 G10 抓不到的錯(例如筆誤成一半)：
// r1(atSec=15:38)裡最遠的一班,已核實是 THSR 0846(sec=66960,leftSec=178 分=10680 秒),必須
// 存在且落在 (2 小時, 3 小時] 之間——窗若被悄悄改小到 2 小時,這班車會從結果消失。
const farthestLeft = Math.max(...r1.map(x => x.leftSec));
ok('G10b 窗確實延伸到(2h,3h]區間(非只到 2h)', farthestLeft > 2 * 3600 && farthestLeft <= 3 * 3600,
   `${farthestLeft / 60} 分`);

console.log(fails ? `\n${fails} 項未過` : '\n全部通過');
process.exit(fails ? 1 : 0);
