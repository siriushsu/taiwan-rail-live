// 機捷車廂擁擠度:worker.js 的 tymcLiveSrc(把桃捷官網兩份回應整理成每列車一筆)與前端的逐班對法。
// 樣本是 2026-11-13 09:31 錄下的官方回應(scripts/fixtures/tymc-live-20261113-0931.json),不打真實服務。
// 對班規則與 index.html 的 tymcCrowdCars 是同一條:同方向、同車種、在指紋那一站的時刻比官方表定發車秒
// 早 -20～110 秒(TDX 時刻是整分,官方是秒)。改那邊的規則要連這裡一起改。
// 看板倒數列的對法與 index.html 的 tymcCrowdForRow 是同一條(見第 10 節),同樣要一起改。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _tymc } = await import(new URL('../worker.js', import.meta.url).href);
const { tymcLiveSrc, tymcStale } = _tymc;
const fx = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/tymc-live-20261113-0931.json'), 'utf8'));
const times = JSON.parse(fs.readFileSync(path.join(root, 'data/tymc_times.json'), 'utf8')).lines.A;
const clone = v => JSON.parse(JSON.stringify(v));
const sysData = JSON.parse(fs.readFileSync(path.join(root, 'data/tymc.json'), 'utf8'));
const stationKey = name => String(name).replace(/臺/g, '台').replace(/站$/, '');
const stationNames = sysData.lines.find(l => l.id === 'A').stations.map(s => stationKey(s.name));
// 樣本時刻(列車清單的 CreateTime,台北時間的當日秒)
const sampleSec = (m => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))(/(\d\d):(\d\d):(\d\d)$/.exec(fx.imm.CreateTime));

// 樣本那天是週五 ⇒ 平日班表。班次＝[站序, 秒, 站序, 秒, …];kinds 一班一字元(1 普通、2 直達)。
const trips = times.sets['平日'].map((tr, i) => ({ tr, kind: { 1: 'com', 2: 'exp' }[times.kinds['平日'][i]] || null,
  d: tr[0] <= tr[tr.length - 2] ? 1 : -1 }));
const matchTrips = t => trips.filter(x => {
  if (x.d !== t.d || x.kind !== t.k) return false;
  for (let k = 0; k < x.tr.length; k += 2) {
    if (x.tr[k] !== t.fp[0]) continue;
    let diff = (t.fp[1] - x.tr[k + 1]) % 86400;
    if (diff < -43200) diff += 86400; else if (diff > 43200) diff -= 86400;
    return diff >= -20 && diff <= 110;
  }
  return false;
});

// 〔1〕樣本整理出來的樣子
const src = tymcLiveSrc(fx.imm, fx.pids, null);
assert.equal(src.trains.length, 19, '〔1〕樣本有 19 列車');
for (const t of src.trains) {
  assert.ok(Array.isArray(t.cars) && t.cars.length === 4 && t.cars.every(v => Number.isInteger(v) && v >= 1 && v <= 5), '〔1〕四節擁擠度都在 1～5:' + t.no);
  assert.ok(t.d === 1 || t.d === -1, '〔1〕方向');
  assert.ok(t.k === 'exp' || t.k === 'com', '〔1〕車種');
}
const byNo = Object.fromEntries(src.trains.map(t => [t.no, t]));
assert.deepEqual(byNo['206'].cars, [1, 2, 2, 2], '〔1〕206 的四節照官方順序');

// 〔2〕有指紋的列車,在我們的平日班表上都恰好對到一班,而且不重複
const withFp = src.trains.filter(t => t.fp);
assert.ok(withFp.length >= 17, '〔2〕樣本裡至少 17 列車有指紋,實際 ' + withFp.length);
const seen = new Map();
for (const t of withFp) {
  const hit = matchTrips(t);
  assert.equal(hit.length, 1, `〔2〕${t.no}（${t.trip}）應恰好對到一班,實際 ${hit.length}`);
  assert.ok(!seen.has(hit[0]), `〔2〕${t.no} 與 ${seen.get(hit[0])} 對到同一班`);
  seen.set(hit[0], t.no);
  // 對到的那一班的終點要等於官方這列車的終點(直達車往北的起點官方記成 A14,終點不受影響)
  if (t.to != null) assert.equal(hit[0].tr[hit[0].tr.length - 2], t.to, `〔2〕${t.no} 對到的班次終點不符`);
  // 獨立的對照:對到的那一班照時刻表在樣本時刻走到哪,要跟官方回報的位置差不多(差兩站以內)。
  // 對到別趟(例如折返後、還沒開始跑的那一趟)會差到十幾站。
  const tr = hit[0].tr;
  let lo = tr[0], hi = tr[0];
  if (sampleSec >= tr[tr.length - 1]) lo = hi = tr[tr.length - 2];
  else for (let k = 0; k + 3 < tr.length; k += 2) if (sampleSec >= tr[k + 1] && sampleSec < tr[k + 3]) { lo = tr[k]; hi = tr[k + 2]; break; }
  const mid = (t.loc[0] + t.loc[1]) / 2, a = Math.min(lo, hi), b = Math.max(lo, hi);
  const off = mid < a ? a - mid : mid > b ? mid - b : 0;
  assert.ok(off <= 2, `〔2〕${t.no}（${t.trip}）官方在站序 ${t.loc.join('-')},對到的班次此刻在 ${lo}-${hi}`);
}

// 〔3〕同一個運行號同時有兩趟:取方向與列車相同的那一趟
// 樣本:108(運行號 510)在 A17-A18 往老街溪,月台資料同時有 510-003(往老街溪)與 510-004(折返往台北)。
assert.equal(byNo['108'].trip, '510-003', '〔3〕108 現在跑的是 510-003');
assert.equal(byNo['108'].d, 1, '〔3〕');

// 〔4〕停在端點站等折返:官方只剩下一趟,方向跟著那一趟
// 樣本:103(運行號 509)停在 A22、方向仍記成往老街溪,月台資料只有 509-004(往台北)。
assert.equal(byNo['103'].trip, '509-004', '〔4〕103 在 A22 等折返,算下一趟');
assert.equal(byNo['103'].d, -1, '〔4〕方向跟著下一趟');
assert.equal(matchTrips(byNo['103']).length, 1, '〔4〕A22 沒有月台資料,指紋落在下一站,照樣對得到');

// 〔5〕快到終點:月台資料只剩折返後那一趟,行進中的列車不准被掛到下一趟;有上一輪就沿用上一輪
// 樣本:203(運行號 301)在 A02-A01 往台北,月台資料只剩 301-005(往機場)。
assert.equal(byNo['203'].trip, undefined, '〔5〕沒有上一輪時留白,不掛到折返後那一趟');
assert.equal(byNo['203'].fp, undefined, '〔5〕');
const prev = { trains: [{ no: '203', seq: '301', d: -1, k: 'exp', trip: '301-004', fp: [2, 33480] }] };
const carried = tymcLiveSrc(fx.imm, fx.pids, prev).trains.find(t => t.no === '203');
assert.equal(carried.trip, '301-004', '〔5〕沿用上一輪對到的那一趟');
assert.deepEqual(carried.fp, [2, 33480], '〔5〕');
const flipped = { trains: [{ ...prev.trains[0], d: 1 }] };
assert.equal(tymcLiveSrc(fx.imm, fx.pids, flipped).trains.find(t => t.no === '203').trip, undefined, '〔5〕上一輪方向不同就不沿用');

// 〔6〕月台資料整份抓不到:擁擠度照給,只是沒有指紋
const noPids = tymcLiveSrc(fx.imm, null, null);
assert.equal(noPids.trains.length, 19, '〔6〕');
assert.ok(noPids.trains.every(t => t.cars && !t.fp), '〔6〕有擁擠度、沒有指紋');

// 〔7〕髒值:任何一節出界整份不帶;位置或方向不成形的列車整筆丟掉;列車清單不成形回 null
const dirty = clone(fx.imm);
dirty.Payload[0].car02_level = '6';
dirty.Payload[1].car03_level = '';
dirty.Payload[2].location = 'A99-A01';
dirty.Payload[3].direction = 'X';
const d7 = tymcLiveSrc(dirty, fx.pids, null);
assert.equal(d7.trains.length, 17, '〔7〕兩筆不成形的丟掉');
assert.equal(d7.trains.find(t => t.no === dirty.Payload[0].train_no).cars, undefined, '〔7〕等級 6 整份不帶');
assert.equal(d7.trains.find(t => t.no === dirty.Payload[1].train_no).cars, undefined, '〔7〕空字串整份不帶');
assert.equal(tymcLiveSrc({ errorcode: 1 }, fx.pids, null), null, '〔7〕沒有 Payload');
assert.equal(tymcLiveSrc(null, fx.pids, null), null, '〔7〕');
assert.deepEqual(tymcLiveSrc({ Payload: [] }, fx.pids, null), { trains: [] }, '〔7〕收班後是空陣列,不是 null');

// 〔8〕通過不停的站不當指紋(我們的直達車班次沒有那一站)
const pass = clone(fx.pids);
pass.A02_PL1 = [{ Station: 'A02', SetNum: '303', SetTripNum: '303-005', StartStation: 'A01', EndStation: 'A13',
  ScheduleTime: '09:33:00', Direction: 1, StopStation: ['A01', 'A03', 'A08', 'A12', 'A13'], TrainType: 'Express' }];
const t8 = tymcLiveSrc(fx.imm, pass, null).trains.find(t => t.no === '206');
assert.notEqual(t8.fp[0], 1, '〔8〕A02 是通過站,不能當 206 的指紋');
assert.equal(matchTrips(t8).length, 1, '〔8〕');

// 〔9〕各站預估到站秒(calls):沿行進方向排、停在月台的那一站帶 1、機場旅館站(官方代碼有 A14a／A14A 兩種寫法)不能漏
for (const t of src.trains) for (let i = 1; i < (t.calls || []).length; i++) {
  assert.ok(t.d * (t.calls[i][0] - t.calls[i - 1][0]) > 0, `〔9〕${t.no} 的 calls 要沿行進方向排`);
}
assert.deepEqual(byNo['119'].calls[0], [0, 33984, 1], '〔9〕119 停在台北車站月台等發車');
assert.equal(byNo['119'].to, 21, '〔9〕終點取趟次自己的');
assert.ok(src.trains.some(t => (t.calls || []).some(c => c[0] === 13)), '〔9〕機場旅館站(站序 13)有列車會到');
assert.ok(src.trains.every(t => (t.calls || []).every(c => c.length === 2 || c[2] === 1)), '〔9〕');

// 〔10〕看板的官方倒數列(TDX,整分、沒有車號)直接對到列車。規則與 index.html 的 tymcCrowdForRow 相同:
// 同方向、同終點、那一站在 calls 裡;停在月台的對「0～1 分」的列,其餘要求 倒數列到站秒 − 官方預估到站秒 落在 0～180 秒
// (TDX 的分鐘是進位過的,資料又比我們取回的時刻舊一點,所以倒數列一律偏晚);恰好一列車才算。
const tdxAt = Date.parse(fx.tdx.at) / 1000;
const secOfDay = epoch => ((epoch + 8 * 3600) % 86400 + 86400) % 86400;
const rowTrains = (name, destName, minutes) => {
  const si = stationNames.indexOf(stationKey(name)), di = stationNames.indexOf(stationKey(destName));
  assert.ok(si >= 0 && di >= 0 && si !== di, '〔10〕站名對不上:' + name + '→' + destName);
  const d = di > si ? 1 : -1, eta = secOfDay(tdxAt + minutes * 60 + 30);
  return src.trains.filter(t => {
    if (t.d !== d || t.to !== di || !Array.isArray(t.calls)) return false;
    const call = t.calls.find(c => c[0] === si);
    if (!call) return false;
    if (call[2]) return minutes <= 1;
    let diff = (eta - call[1]) % 86400;
    if (diff < -43200) diff += 86400; else if (diff > 43200) diff -= 86400;
    return diff >= 0 && diff <= 180;
  });
};
// 看板每個(站, 終點)只顯示最近兩列
const shownRows = new Map();
for (const [s, dname, e] of fx.tdx.rows) (shownRows.get(s + '>' + dname) || shownRows.set(s + '>' + dname, []).get(s + '>' + dname)).push(e);
let rowsShown = 0, rowsOne = 0; const rowsTwo = [];
for (const [key, list] of shownRows) {
  const [s, dname] = key.split('>');
  for (const e of list.sort((x, y) => x - y).slice(0, 2)) {
    rowsShown++;
    const hit = rowTrains(s, dname, e);
    if (hit.length === 1) rowsOne++; else if (hit.length > 1) rowsTwo.push(`${s}→${dname} ${e}`);
  }
}
assert.equal(rowsShown, 90, '〔10〕樣本裡看板會顯示 90 列');
assert.ok(rowsOne >= 70, `〔10〕至少 70 列恰好對到一列車,實際 ${rowsOne}`);
// 長庚醫院往台北:直達在這一站追上普通,兩班一分鐘內先後到 ⇒ 兩列都對到兩列車,留白(不猜)。
assert.deepEqual(rowsTwo, ['長庚醫院站→台北車站 10', '長庚醫院站→台北車站 11'], '〔10〕對到兩列車的只有直達追上普通的那一站');
assert.deepEqual(rowTrains('台北車站', '老街溪站', 0).map(t => t.no), ['119'], '〔10〕台北車站往老街溪的第一列＝停在月台的 119');
// 台北車站往二航廈 5 分後進月台的那一班:列車(203)還在跑上一趟(往台北),擁擠度是上一趟的,不掛到這一列。
assert.deepEqual(rowTrains('台北車站', '機場第二航廈站', 5), [], '〔10〕列車還在跑上一趟時不對');

// 〔11〕同一個運行號連下下趟都列出來時,不能只看方向相同
const future = clone(fx.pids);
// 203(運行號 301)在 A02-A01 往台北:月台資料補一筆 301-006(折返之後再回台北的那一趟,方向與現在相同)。
future.A13_PL2 = (future.A13_PL2 || []).concat([{ Station: 'A13', SetNum: '301', SetTripNum: '301-006', StartStation: 'A13', EndStation: 'A01',
  ScheduleTime: '10:40:30', Direction: 0, StopStation: ['A13', 'A12', 'A08', 'A03', 'A01'], TrainType: 'Express',
  EstArrivalTime: '10:38:42', EstArrivalCountdown: 4056, ActArrivalTime: '' }]);
const t11 = tymcLiveSrc(fx.imm, future, null).trains.find(t => t.no === '203');
assert.equal(t11.trip, undefined, '〔11〕203 快到終點:不准掛到方向相同的下下趟 301-006');
assert.equal(t11.calls, undefined, '〔11〕');

// 〔12〕停在終點前一站(A21 往老街溪):現在這一趟在月台資料上已經沒有站可列,只剩折返後那一趟(起點 A22)。
// 列車不在那一趟的起點 ⇒ 不算它;車上還是要到 A22 下車的乘客,擁擠度不能掛到「往台北、還沒開」的那一班。
const atA21 = clone(fx.imm);
const t103 = atA21.Payload.find(t => String(t.train_no) === '103');
assert.equal(t103.location, 'A22-A22', '〔12〕樣本前提:103 停在 A22');
t103.location = 'A21-A21';
const t12 = tymcLiveSrc(atA21, fx.pids, null).trains.find(t => t.no === '103');
assert.deepEqual(t12.loc, [20, 20], '〔12〕');
assert.equal(t12.trip, undefined, '〔12〕103 停在 A21 往老街溪:不准掛到折返後的 509-004');
assert.equal(t12.calls, undefined, '〔12〕');
assert.ok(Array.isArray(t12.cars), '〔12〕擁擠度本身照給(只是對不到班次)');

// 〔13〕官網那份自己停住(照樣回 200):列車清單的 CreateTime(台北時間)落後超過三分鐘就算過期;讀不出時間不擋。
const made = Date.parse('2026-11-13T09:31:01+08:00');
assert.equal(tymcStale(fx.imm, made + 60e3), false, '〔13〕一分鐘前的不算過期');
assert.equal(tymcStale(fx.imm, made + 181e3), true, '〔13〕超過三分鐘算過期');
assert.equal(tymcStale(fx.imm, made - 30e3), false, '〔13〕時鐘差一點(比現在還新)不算過期');
assert.equal(tymcStale({ Payload: [] }, made), false, '〔13〕沒有 CreateTime 不擋');
assert.equal(tymcStale({ CreateTime: '11/13 09:31' }, made + 3600e3), false, '〔13〕格式讀不出來不擋');

// 〔14〕上游回離譜的大小:列車數與每趟的 calls 都有上限(整份要存進 Durable Object,單值有大小上限)。
const huge = clone(fx.imm);
for (let i = 0; i < 300; i++) huge.Payload.push({ ...fx.imm.Payload[0], train_no: 'X' + i });
assert.ok(tymcLiveSrc(huge, fx.pids, null).trains.length <= 64, '〔14〕列車數上限 64');
const dup = clone(fx.pids);
// 挑一列有 calls 的列車,把它那一趟的某一筆月台資料重複 200 次。
const fat = src.trains.find(t => t.calls && t.calls.length >= 3);
const fatKey = Object.keys(dup).find(k => dup[k].some(r => r.SetTripNum === fat.trip && r.EstArrivalTime && r.EndStation));
const fatRow = dup[fatKey].find(r => r.SetTripNum === fat.trip && r.EstArrivalTime && r.EndStation);
for (let i = 0; i < 200; i++) dup[fatKey].push({ ...fatRow });
const fatOut = tymcLiveSrc(fx.imm, dup, null).trains.find(t => t.no === fat.no);
assert.equal(fatOut.trip, fat.trip, '〔14〕');
assert.equal(fatOut.calls.length, 24, `〔14〕${fat.no} 的 calls 截在 24,實際 ${fatOut.calls.length}`);
for (const t of src.trains) assert.ok(!t.calls || t.calls.length <= 22, '〔14〕樣本裡每趟的 calls 不超過站數');

console.log(`verify_tymc_live: OK（${src.trains.length} 列車,${withFp.length} 列有指紋且各自唯一對到一班）`);
