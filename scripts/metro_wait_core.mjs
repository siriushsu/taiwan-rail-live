// 捷運等車卡推播鏈的純邏輯。獨立成檔的理由與 la_push_core.mjs 相同:測試要能直接 import,
// 而 worker.js 從 Node import 不可靠。worker.js:9 就是這樣吃它的。
//
// 🔴 這一整支的職責只有一件事:【把前端開卡當下那份挑選規則,原封不動地在伺服器重做一次】。
//    卡片開的時候內容來自 index.html 的 metroWaitTrtcBundle／metroWaitLiveBundle,推播接手之後
//    來自這裡——兩邊只要有一條規則不一樣,使用者就會看到卡片在第一次推播時「跳掉」
//    (換成另一班車、另一個方向、或突然空掉)。所以下面每一條門檻都標了它在 index.html 的出處,
//    改任何一條之前先確認前端那條也一起改。

// ── 站名比對:兩套【故意不同】的正規化 ──────────────────────────────────
// 🔴 這兩支不可以合併成一支。北捷官方看板的 StationName 帶「站/車站」尾碼而我們的靜態站名不帶,
//    所以那一側必須去尾;而 krtc/tymc 的 LiveBoard StationName 與靜態站名本來就逐字相同,
//    對它去尾反而會把機捷「三重站」與中和新蘆線「三重」這兩個不同的物理站撞成同一個 key
//    (index.html:18698-18705 有這個實測踩坑的完整紀錄)。
// index.html:16511 trtcOfficialStationName 的逐字對應。
export function mwTrtcStationKey(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/臺/g, '台').replace(/\s+/g, '')
    .replace(/車站$/, '').replace(/站$/, '').trim();
}
// index.html:18792／18796 metroWaitLiveBundle 的比對法(只換 臺→台,不去尾)。
export function mwLiveStationKey(value) {
  return String(value == null ? '' : value).replace(/臺/g, '台');
}

// ── 北捷:可採列的三道門檻(全部照抄 index.html) ───────────────────────
// 資料齡上限,index.html:16508 TRTC_OFFICIAL_BOARD_MAX_AGE_MS=45e3。
export const MW_TRTC_MAX_AGE_SEC = 45;
// 上游時鐘比我們快時的容忍,index.html:16509 TRTC_OFFICIAL_BOARD_FUTURE_SKEW_MS=5e3。
export const MW_TRTC_FUTURE_SKEW_SEC = 5;
// 已到站但還留在板上的寬限,index.html:16510 TRTC_OFFICIAL_BOARD_ARRIVING_GRACE_SEC=30。
// 🔴 這一條同時決定了「卡片停在【進站】多久才翻下一班」:列車到站後 staleDate 已過 ⇒ 視圖顯示
//    「進站」,而這一列還留在板上 ⇒ 首班不變 ⇒ 不推播;過了寬限它從板上消失,次班遞補成首班,
//    這時才推。與月台顯示器的行為一致,不是延遲。
export const MW_TRTC_ARRIVING_GRACE_SEC = 30;
// 太遠的班次不採,index.html:18468 的 left > 7200。
export const MW_TRTC_HORIZON_SEC = 7200;
// 高捷/機捷:整份 LiveBoard 的資料齡上限,index.html:18791 的 150 秒。
export const MW_LIVE_MAX_AGE_SEC = 150;
// 每個方向最多取幾班,index.html:18497 group.rows.slice(0, 2)。
const MW_ROWS_PER_DIR = 2;

// 北捷:從 /api/trtc-live 的 board 列挑出這一站(可再限定方向)的班次,依 eta 升冪。
// 回傳 [{dest, eta}],eta 是絕對 epoch 秒。dest 傳 null = 不限方向(＝選單的「最快一班」)。
// 🔴 前端多做而這裡【不做】的一件事:依「使用者關掉了哪些路線」過濾(index.html:18475)。
//    伺服器沒有前端的圖層可見性狀態,也不該有——卡片是對「這一站」開的,開卡時那一站的路線
//    必然是開著的(不然看板不會長出按鈕),之後使用者在地圖上關圖層不該讓鎖屏卡片停止更新。
export function mwTrtcRows(board, station, dest, nowSec) {
  const key = mwTrtcStationKey(station);
  const destKey = dest == null || dest === '' ? null : mwTrtcStationKey(dest);
  const seen = new Set();
  const byDir = new Map();
  for (const row of Array.isArray(board) ? board : []) {
    const at = Number(row && row.at), eta = Number(row && row.eta);
    if (!Number.isFinite(at) || !Number.isFinite(eta)) continue;
    if (mwTrtcStationKey(row.name) !== key) continue;
    const age = nowSec - at;                          // index.html:16517 的 age 判定
    if (age < -MW_TRTC_FUTURE_SKEW_SEC || age > MW_TRTC_MAX_AGE_SEC) continue;
    const left = eta - nowSec;
    if (left < -MW_TRTC_ARRIVING_GRACE_SEC || left > MW_TRTC_HORIZON_SEC) continue;
    const rowDest = String((row && row.dest) || '');
    if (!rowDest) continue;
    if (destKey != null && mwTrtcStationKey(rowDest) !== destKey) continue;
    // index.html:18469 的 exactKey 去重(同一列在上游重複出現時只算一次)
    const exact = [row.name, rowDest, eta, at, String((row && row.no) || '')].join('');
    if (seen.has(exact)) continue;
    seen.add(exact);
    // 方向分組後各取兩班(index.html:18497),再全域排序——直接全域取兩班會讓某一方向連續
    // 三班進站時吃掉另一方向的位置,與看板顯示的內容不一致。
    const dirKey = mwTrtcStationKey(rowDest);
    let group = byDir.get(dirKey);
    if (!group) byDir.set(dirKey, group = []);
    // at 一併帶出來:它是上游自己的資料時刻(NowDateTime),ContentState.dataAt 要用它,
    // 不可以用我方的 now——那是「我什麼時候算的」不是「這批資料多新」。
    // no 一併帶出來:擁擠度是逐車 join 的鍵(mwCrowdByNo)。看板列自己的車號才是它自己那台車,
    // 用終點當鍵會讓同終點的每一列拿到同一台車的值(2026-08-29 忠孝復興實測:文湖線那列
    // 長出板南線的 6 格,而文湖線只有 4 節)。index.html metroWaitTrtcBundle 逐字同一件事。
    group.push({ dest: rowDest, eta: Math.round(eta), at: Math.round(at),
      no: String((row && row.no) || '').trim() });
  }
  const out = [];
  for (const group of byDir.values()) {
    group.sort((a, b) => a.eta - b.eta);
    out.push(...group.slice(0, MW_ROWS_PER_DIR));
  }
  out.sort((a, b) => a.eta - b.eta);
  return out;
}

// 高捷/機捷:從 /api/metro-live 的 rows 挑出這一站的班次,依整數分鐘升冪。
// 回傳 { rows:[{dest, minutes}], serviceOver }。
// 🔴 serviceOver 看的是【這一站的全部列】而不是方向過濾後的列:「末班已過」是整站的事實,
//    而且只在【每一列都這麼說】時才成立——一條線收班不代表另一條線也收班。
//    這是唯一一個由官方明說、而不是由我方推論出來的收卡條件(北捷沒有對應欄位,見 worker 的收卡段)。
export function mwLiveRows(rows, station, dest) {
  const key = mwLiveStationKey(station);
  const destKey = dest == null || dest === '' ? null : mwLiveStationKey(dest);
  const out = [];
  let atStation = 0, over = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (mwLiveStationKey(row && row.s) !== key) continue;
    atStation++;
    if (Number(row && row.st) === 3) over++;
    // index.html:18795 的口徑:只採 st===0(正常營運)且 e 非 null 的列
    if (Number(row.st) !== 0 || row.e == null) continue;
    const rowDest = String(row.d || '');
    if (!rowDest) continue;
    if (destKey != null && mwLiveStationKey(rowDest) !== destKey) continue;
    const minutes = Number(row.e);
    if (!Number.isFinite(minutes)) continue;
    out.push({ dest: rowDest, minutes: Math.round(minutes) });
  }
  out.sort((a, b) => a.minutes - b.minutes);
  return { rows: out, serviceOver: atStation > 0 && over === atStation };
}

// 車廂擁擠度:【逐車號】join。index.html applyTrtcOfficialBoard 的 crowdByNo 逐字同一套
// (那裡的註解寫死「兩個介面看到的必須是同一份,改 join 要兩邊一起改」——這裡是第三個介面)。
// 🔴 2026-08-29 之前這裡的鍵是【終點】,與看板/小工具同一套錯:同終點的每一列都拿到「第一台
//    有 cars 的車」的值。忠孝復興往南港展覽館有文湖線與板南線兩列,文湖線那列(4 節車廂)因此
//    長出板南線那台的 6 格。正式站實測 306 列只有 56 列兩代一致,鎖屏卡片吃的是同一份。
//    對不到自己那台車就留白——不拿別台頂替(「不畫假資料、不猜」)。
export function mwCrowdByNo(trains) {
  const out = {};
  for (const t of Array.isArray(trains) ? trains : []) {
    const no = String((t && t.no) || '').trim();
    if (!no || out[no]) continue;
    const cars = t && t.cars;
    if (Array.isArray(cars) && cars.length && cars.every(v => Number.isFinite(Number(v)))) {
      out[no] = cars.map(Number);
    }
  }
  return out;
}

// 組 ContentState。🔴 欄位集合是跨行程契約:每一個 key 都要送(值可以是 null),不可省略——
// 與 laPushAll 同一條規矩(worker.js:3073「不是省略這個 key」)。欄位名與順序對應
// app/ios/App/App/MetroWaitAttributes.swift 的 ContentState。
// 精度誠實(index.html:18806 的鐵則):北捷只送 nextEta/secondEta(絕對 epoch 秒),
// 分鐘級系統只送 nextMinutes/secondMinutes,絕不把分鐘換算成 eta。
export function mwContentState(sys, rows, crowdByNo, dataAt) {
  const isTrtc = sys === 'trtc';
  const a = rows[0] || null, b = rows[1] || null;
  // 鍵是這一列自己的官方車號;沒有車號(文湖線恆無)或對不到就留白,不退回終點比對。
  const crowdKey = String((a && a.no) || '').trim();
  const crowd = isTrtc && crowdKey && crowdByNo ? (crowdByNo[crowdKey] || null) : null;
  return {
    nextEta: isTrtc && a ? a.eta : null,
    nextMinutes: !isTrtc && a ? a.minutes : null,
    secondEta: isTrtc && b ? b.eta : null,
    secondMinutes: !isTrtc && b ? b.minutes : null,
    nextDest: a ? a.dest : null,
    secondDest: b ? b.dest : null,
    crowd: Array.isArray(crowd) && crowd.length ? crowd : null,
    dataAt: dataAt == null || !Number.isFinite(Number(dataAt)) ? null : Math.round(Number(dataAt)),
    notice: null,
    // 🔴 pushed:告訴視圖「這張卡有伺服器在餵」。它唯一的消費點是 stale 時那句說明——
    //    零推播的卡到站後必須老實說「不會自己接下一班」,推播接手的卡說那句話就是說謊。
    //    App 開卡時不送(nil=未知/沒接上),伺服器每一發都送 true。
    pushed: true,
  };
}

// staleDate:下一班的【到站瞬間】。視圖靠 isStale 把倒數翻成綠字「進站」
// (MetroWaitActivity.swift:67),所以每一發推播都必須帶——推播的 content 會整包取代舊 content,
// 少送這一項等於把卡片的「進站」語意拿掉,倒數歸零後會停在 0:00(那正是 08-14 真機回饋
// 要修掉的殭屍卡)。分鐘級系統沒有秒級真值,用「現在＋N 分」當近似(與 App 開卡時
// RailMetroWaitPlugin.swift:104 的算法同一套)。
export function mwStaleDate(sys, rows, nowSec) {
  const a = rows[0] || null;
  if (!a) return null;
  if (sys === 'trtc') return Number(a.eta);
  return Math.round(nowSec + Math.max(0, Number(a.minutes) || 0) * 60);
}

// 北捷這一批資料的時刻＝所選各列 at 的最大值(index.html:16573 sourceAt 的同一種取法,
// 差別只在那邊取整份看板、這裡取這一站選出來的列——卡片標的是「這張卡的資料多新」)。
// 沒有可採列時回 null:寧可不標,不可以拿我方的 now 冒充上游時刻。
export function mwTrtcDataAt(rows) {
  let max = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const at = Number(r && r.at);
    if (Number.isFinite(at) && (max == null || at > max)) max = at;
  }
  return max;
}

// eta 的遲滯門檻:同一班車的官方 eta 每一輪都會被上游重新估算而抖動幾秒,逐秒推播等於
// 每分鐘一發、一小時 60 發,而使用者看到的倒數根本沒有意義上的差別(卡片的 Text(timerInterval:)
// 本來就自己在走)。20 秒的取法:低於它的修正在一個「約 N 分」的等車情境裡無法感知,
// 高於它就會讓「列車誤點多等半分鐘」這種真的該讓使用者知道的變化被吃掉。
export const MW_ETA_EPS_SEC = 20;
function mwEtaChanged(prev, next) {
  const pn = prev == null, nn = next == null;
  if (pn !== nn) return true;                    // 有→無、無→有 都是內容變化,一定要推
  if (pn) return false;
  return Math.abs(Number(prev) - Number(next)) >= MW_ETA_EPS_SEC;
}
const mwCrowdKey = v => (Array.isArray(v) ? v.map(Number).join(',') : '');
// 這一輪算出來的內容,跟【上一次真的送出去的】比,值不值得再推一發。
// 🔴 比較基準是「上一次送出去的」而不是「上一輪算出來的」——這是遲滯能成立的關鍵:
//    eta 每輪漂 3 秒時,跟上一輪比永遠不到 20 秒門檻(推不出去),跟上次送出的比則會在
//    第七輪左右累積到門檻而推一發,卡片因此不會漂到與官方差太多,也不會每分鐘都推。
// 🔴 dataAt 刻意不在比較範圍內:它每輪必變而視圖根本不畫它(MetroWaitActivity.swift 沒有
//    任何一處讀 state.dataAt),把它算進去等於讓遲滯完全失效。pushed 同理(恆為 true)。
export function mwShouldPush(prev, next) {
  if (!prev) return true;
  if (String(prev.nextDest == null ? '' : prev.nextDest) !== String(next.nextDest == null ? '' : next.nextDest)) return true;
  if (String(prev.secondDest == null ? '' : prev.secondDest) !== String(next.secondDest == null ? '' : next.secondDest)) return true;
  if (String(prev.nextMinutes == null ? '' : prev.nextMinutes) !== String(next.nextMinutes == null ? '' : next.nextMinutes)) return true;
  if (String(prev.secondMinutes == null ? '' : prev.secondMinutes) !== String(next.secondMinutes == null ? '' : next.secondMinutes)) return true;
  if (mwCrowdKey(prev.crowd) !== mwCrowdKey(next.crowd)) return true;
  if (String(prev.notice == null ? '' : prev.notice) !== String(next.notice == null ? '' : next.notice)) return true;
  if (mwEtaChanged(prev.nextEta, next.nextEta)) return true;
  if (mwEtaChanged(prev.secondEta, next.secondEta)) return true;
  return false;
}
