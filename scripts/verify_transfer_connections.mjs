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

// ── 渲染層(三個顯示實例):跟隨小卡 #fpConn、捷運班距卡 #fcConn、手機列車卡 #tcConn ──────────
// 🔴 命名接續 G10 之後、不重用 G6/G7/G7b/G8——那幾個標籤上面查詢層已經用掉(G6=atSec guard、
// G7/G7b=fromSys 聯集、G8=群 id 對照 station_transfers.json),重複標籤會讓輸出裡兩件完全不同的
// 事情印成同一個名字,突變測試時「哪一條紅了」會分不清是查詢層還是渲染層出問題。
const mh = html.match(/function transferConnectionHtml\([\s\S]*?\n\}/);
ok('G11 抽到 transferConnectionHtml', !!mh, mh ? `${mh[0].split('\n').length} 行` : '找不到');

// G12 —— 三個實例都要更新(漏一個＝手機點開列車卡後資訊消失),且各自能獨立轉紅:
// 拿掉某一處的 setTransferConn 呼叫,只有那個 id 的這條斷言會紅,其餘兩個 id 不受擾動。
// 容器存在的判準比對完整形狀(class+id+hidden),不是只查 id 出現過——避免 id 被放到錯的標籤上
// 或漏掉 hidden 屬性都測不出來。
for (const id of ['fpConn', 'fcConn', 'tcConn']) {
  ok(`G12 ${id} 容器存在(xfer-conn+hidden)`,
     new RegExp(`<div class="xfer-conn" id="${id}" hidden></div>`).test(html));
  ok(`G12 ${id} 有接上 setTransferConn`, new RegExp(`setTransferConn\\(\\s*'${id}'`).test(html));
}
// G12b —— 捷運卡那一處必須傳 null 當 fromSys(傳錯會把台鐵/高鐵整組排除掉,畫面永遠空的)
ok('G12b fcConn 的 fromSys 傳 null',
   /setTransferConn\(\s*'fcConn'[\s\S]{0,200}?null\s*\)/.test(html));
// G12c/d —— 反向對照:fpConn/tcConn 不可複製 fcConn 的 null 寫法。這兩張卡的 fromSys 該傳「本班車
// 的系統」,傳 null 會連同系統/本系統都算成有效轉乘,不是規格要的「對向系統」。
// 🔴 這兩條在函式尚未實作時是空字串比對、恆為真(vacuous pass)——不是「起始已通過」而是「還沒有
// 東西可比對」,真正的把關力道要靠下面的突變測試(把 fpConn 的最後一個參數換成字面 null)來證明。
ok('G12c fpConn 的 fromSys 不是字面 null(要傳實際系統)',
   !/setTransferConn\(\s*'fpConn'[\s\S]{0,200}?null\s*\)/.test(html));
ok('G12d tcConn 的 fromSys 不是字面 null(要傳實際系統)',
   !/setTransferConn\(\s*'tcConn'[\s\S]{0,200}?null\s*\)/.test(html));

// G13 —— 不得出現「來得及/來不及」字樣(規格硬約束:站內步行時間沒有資料,猜太短會害人錯過車)。
// 同上,函式不存在時 mh 為 null、比對空字串恆為真,是 guard 不是「起始通過的功能測試」。
ok('G13 沒有「來得及」字樣', !/來得及|趕得上|趕不上/.test(mh ? mh[0] : ''));

// G14 —— #tcConn 兩個陷阱(task-3-context.md §3):
// 陷阱A:[hidden] 是全域 display:none!important(index.html:175),#tcConn 的顯示規則若沒有
//        :not([hidden]) 限定,hidden=true 就永遠蓋不掉它,手機列車卡會常駐一個空框。
// 陷阱B:.tc-head 只在 sheet 態才 flex-wrap,#tcConn 必須 flex:0 0 100% 自成一列,且規則要限定在
//        .traincard.tc-sheet .tc-head 底下——不限定的話桌面併卡會冒出一塊不該出現的東西。
const tcConnRule = html.match(/\.traincard\.tc-sheet \.tc-head #tcConn:not\(\[hidden\]\)\s*\{([^}]*)\}/);
ok('G14 tcConn CSS 有 :not([hidden]) 守門(陷阱A)', !!tcConnRule);
ok('G14b tcConn CSS 在 sheet 態撐滿一列(陷阱B,flex 0 0 100%)',
   !!(tcConnRule && /flex:\s*0\s+0\s+100%/.test(tcConnRule[1])));

// ── 渲染層真執行(獨立審查發現:G11–G14 全部只做原始碼文字比對,一次都沒有真的呼叫過
// transferConnectionHtml,硬約束零保護——突變 5/6 46/46 全綠零訊號)。以下把它拉進沙箱實際
// 執行,補行為面斷言。抽取段擴充 G0 的作法,從 XFER_WINDOW_SEC 一路抓到 transferConnectionHtml
// 結尾(中間順帶含 transferConnections 本體與新增的 xfcSysName,三者本來就是同一段連續程式碼)。
const mFull = html.match(/const XFER_WINDOW_SEC[\s\S]*?\nfunction transferConnectionHtml\([\s\S]*?\n\}/);
// 具名閘門(記憶 verify-fixture-stub-drift.md):先證明抽到的是現行這一份,不是抽到舊版或空字串。
// 🔴 2026-09-01「雙框」修復後,回傳字串不再自己包一層 <div class="xfer-conn">(外層容器本身
// 就是 .xfer-conn,包兩層等於兩圈框線),所以具名閘門改認三個永遠會出現的結構性 class:
// xfc-h(標題)/xfc-row(可點的列)/xfc-f(表定註腳)。判準沒有放寬——三個同時比對比原本
// 一個 xfer-conn 更難巧合命中,且都是這個函式獨有的字樣。
ok('G15 抽出的原始碼含 xfc-h/xfc-row/xfc-f(具名閘門,防抽到舊版/空字串)',
   !!mFull && /xfc-h/.test(mFull[0]) && /xfc-row/.test(mFull[0]) && /xfc-f/.test(mFull[0]));
if (!mFull) { console.log(`\n${fails} 項未過`); process.exit(1); }

// stub 只求最小、夠撐起結構與分支判斷,不求譯文正確(譯文由 check_i18n.mjs 另外把關):
// escHtml/fmtHM 抄實作(兩者都無外部依賴,抄了就不會漂移);t 只做 {x} 代入、回傳中文原文。
const hEscHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hFmtHM = sec => { sec = ((sec % 86400) + 86400) % 86400; return String(Math.floor(sec / 3600)).padStart(2, '0') + ':' + String(Math.floor(sec % 3600 / 60)).padStart(2, '0'); };
const hT = (source, vars = {}) => String(source == null ? '' : source).replace(/\{([\w]+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
const hI18nNumber = v => String(v);
const hState = { transferDepartures: data, xferPin: null };
const transferConnectionHtml = new Function(
  'state', 't', 'escHtml', 'fmtHM', 'i18nNumber',
  `${mFull[0]}\n; return transferConnectionHtml;`
)(hState, hT, hEscHtml, hFmtHM, hI18nNumber);

// G16 —— 無接續回空字串,不留空殼(打死突變6:把 '' 換成 <div class="xfer-conn"></div>)。
// 沿用 G2d 已驗過的窗:凌晨 2 點,台中群排除台鐵後窗內無車。
// 第二半改比對 xfc-(整個函式所有輸出片段共同的前綴),不再比對 xfer-conn——「雙框」修復後
// 那個字樣本來就不會出現在回傳值裡,拿它當判準恆真等於零訊號。
const emptyHtml = transferConnectionHtml(GID_TAICHUNG, S(2, 0), 'TRA');
ok('G16 無接續回空字串、連一個 xfc-* 片段都沒有', emptyHtml === '' && !/xfc-/.test(emptyHtml));
// G16b —— 「雙框」正向對照:有接續時回傳字串不可再自己包一層 .xfer-conn(容器本身就是),
// 包回去會讓內外兩層都吃到 border/padding/margin ⇒ 畫面出現兩圈框。畫面端的量測在
// verify_transfer_pin.mjs 的 G5(computed border),這裡守的是產生它的那一行字串。
ok('G16b 回傳字串不自帶 .xfer-conn 外框(否則與容器疊成雙框)',
   !/class="xfer-conn"/.test(transferConnectionHtml(GID_TAICHUNG, S(15, 38), 'TRA')));

// G17 —— 跨午夜時刻不會印成 25:10。真實資料(非人造):T-KRTC-R16 23:37 查詢,第二筆 sec=87120
// (24:12 raw)在窗內且入選前二。⚠️ 這條驗的是「輸出恆在 00:00–23:59」這個最終不變量,不是
// 呼叫端 `fmtHM(r.sec % 86400)` 那個 `% 86400` 運算子本身——fmtHM 內部已有等價 modulo,
// 對任何 x,`fmtHM(x % 86400) === fmtHM(x)` 恆成立(模一次或模兩次結果相同,可證明的無操作),
// 移除呼叫端那個 `% 86400` 不會改變任何輸出,黑箱測試分辨不出來,因此保留現狀不動它(選項a,
// 與其餘 20 幾處呼叫端一致)。這條斷言真正防的是更根本的回歸——fmtHM 自己的內部 modulo 被拿掉。
const crossMidnight = transferConnectionHtml('T-KRTC-R16', S(23, 37), null);
ok('G17 跨午夜輸出恆在 00:00–23:59(不出現 2[4-9]:)',
   /\b([01]\d|2[0-3]):[0-5]\d\b/.test(crossMidnight) && !/\b2[4-9]:/.test(crossMidnight),
   (crossMidnight.match(/\d\d:\d\d/g) || []).join(','));

// G18 —— 同系統(未釘選,真實資料:台中 15:38 排除台鐵後前兩班都是高鐵):標題含系統名、
// 不逐列標系統(headSys truthy 分支,畫面不變)。
const sameSysHtml = transferConnectionHtml(GID_TAICHUNG, S(15, 38), 'TRA');
ok('G18 同系統:標題含系統名', /轉高鐵/.test(sameSysHtml),
   (sameSysHtml.match(/<span class="xfc-h">([^<]*)</) || [])[1]);
ok('G18b 同系統:不逐列標系統(無 xfc-sys)', !/xfc-sys/.test(sameSysHtml));

// G19 —— 混系統(未釘選,真實資料:台中 06:02 前兩班是台鐵3147+高鐵0502):標題中性、
// 兩列都有小標、且小標彼此不同(不是兩個一樣的標籤混充)。
const mixedHtml = transferConnectionHtml(GID_TAICHUNG, S(6, 2), null);
ok('G19 混系統:標題不含系統名(中性標題)',
   !/轉高鐵|轉台鐵|轉阿里山林鐵/.test(mixedHtml),
   (mixedHtml.match(/<span class="xfc-h">([^<]*)</) || [])[1]);
const sysTags = [...mixedHtml.matchAll(/<span class="xfc-sys">([^<]*)<\/span>/g)].map(x => x[1]);
ok('G19b 混系統:兩列都有 xfc-sys 小標', sysTags.length === 2, sysTags.join(','));
ok('G19c 混系統:兩列小標不同', sysTags.length === 2 && sysTags[0] !== sysTags[1], sysTags.join(' vs '));

// G20 —— 釘選(state.xferPin 指到 r1 的第一筆):標題不指名系統、改成「你的接續班次」,
// 且該列仍有 xfc-sys 小標——釘選態的標題從來不指名系統,不給小標就等於整塊沒有系統資訊
// (findings 明文要求的第三格)。用完把 xferPin 歸位,不影響後面任何斷言。
// g 必須帶且要等於這裡查詢用的 GID_TAICHUNG——2026-09-01 修復輪1 Finding A 之後
// pinned 判斷式多比對一個 g===groupId,這個 stub 若不帶 g 會恆假、G20/G20b 恆紅
// (與生產碼邏輯無關,純粹是這份 sandbox fixture 沒跟著新 shape 更新)。
hState.xferPin = { g: GID_TAICHUNG, n: r1[0].n, sys: r1[0].sys };
const pinnedHtml = transferConnectionHtml(GID_TAICHUNG, S(15, 38), 'TRA');
hState.xferPin = null;
ok('G20 釘選:標題是「你的接續班次」', /你的接續班次/.test(pinnedHtml));
ok('G20b 釘選:仍有 xfc-sys 小標', /xfc-sys/.test(pinnedHtml));

// ── G21 —— Finding 4:「剩 N 分」用 Math.floor,不是 Math.round(四捨五入最多高估 29 秒,
// 90 秒會顯示「剩 2 分」)。本分支 c6f66f59 已為同一個理由(高估餘裕是要避免的方向)改過一次。
// 構造 90 秒情境:從 r1(台中 15:38)挑一班「與前一班相隔 >90 秒」的目標,再把 atSec 設成
// 它發車前 90 秒——rows 依 sec 升冪,任何 sec 落在 [S-90,S) 的候選都只可能是前一班(已排除),
// 所以第一列必定是目標本人、leftSec 恰為 90。
const target90 = r1.find((x, i) => i > 0 && x.sec - r1[i - 1].sec > 90);
ok('G21pre 找得到「與前一班相隔 >90 秒」的目標班次(構造 90 秒情境的前提)', !!target90,
   target90 ? `${target90.n} @${target90.sec}` : JSON.stringify(r1.slice(0, 3).map(x => x.sec)));
const html90 = target90 ? transferConnectionHtml(GID_TAICHUNG, target90.sec - 90, 'TRA') : '';
const first90 = (html90.match(/data-xn="([^"]*)"/) || [])[1];
ok('G21pre2 第一列真的是那班(證明我量的是 leftSec=90 的那一列,不是別班)',
   !!target90 && first90 === target90.n, `${first90} vs ${target90 && target90.n}`);
ok('G21 剩 90 秒顯示「剩 1 分」(Math.floor;改回 Math.round 會變成 2)',
   /<span class="xfc-left">剩 1 分<\/span>/.test(html90),
   (html90.match(/<span class="xfc-left">([^<]*)</) || [])[1]);

// ── G22 —— Finding 6/M2:Global Constraint「高鐵沒有即時誤點 ⇒ 畫面要分得出來」與「不寫
// 來得及/來不及」的唯一畫面體現就是這行註腳,刪掉它五支腳本零告警(2026-09-01 廣審突變 M2)。
// 三種形態各驗一次,不是只驗某一格。
const footRe = /<span class="xfc-f">表定時刻 · 未計站內步行<\/span>/;
ok('G22 同系統形態帶「表定時刻 · 未計站內步行」註腳', footRe.test(sameSysHtml));
ok('G22b 混系統形態也帶', footRe.test(mixedHtml));
ok('G22c 釘選形態也帶', footRe.test(pinnedHtml));

console.log(fails ? `\n${fails} 項未過` : '\n全部通過');
process.exit(fails ? 1 : 0);
