// 機捷直達車端點 gate（缺陷④）。
//
// 為什麼既有的 verify_metro_times.mjs 抓不到：它驗的是結構與「相對於基準的漂移」，
// 而這個錯誤從一開始就在基準裡，漂移為零 ⇒ 432/432 全綠也不代表端點是對的。
//
// 判準來源刻意獨立於 builder：官方停靠序列與端點寫成本檔自己的常數，
// 不讀產物的 dest 欄位、也不呼叫 builder 的任何函式。
//   官方直達車（https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable.php 逐字實查）：
//     「加底線-直達車(停靠A1、A3、A8、A12、A13)」          ＝ 基本直達車，終點就是機場第二航廈
//     「加星號-尖峰增停直達車(停靠A1、A3、A8、A12、A13、A18、A21)」＝ 尖峰才延伸到高鐵桃園、環北
//   對應 index：A1=0、A3=2、A8=7、A12=11、A13=12、A18=17（高鐵桃園）、A21=20（環北）。
//   老街溪(A22=21)整條直達車班表都是「-」，兩個方向都不該出現。
//
// 🔴 2026-09-04 修正分母（原版只驗到 14/134 班）：舊的候選條件是
//   `stops.includes(HSR)`，而基本直達車（120 班）根本不停高鐵桃園 ⇒ 天生被排除在分母外，
//   11/11 全綠只證明了那 14 班尖峰增停班次是對的，對其餘 120 班完全失明。
//   新分母改用「跳站與否」認直達車——那才是直達車的定義本身，與停哪幾站無關。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');

console.log('[機捷直達車 gate] 目標目錄:', ROOT);

const SOUTH_EXPRESS = [0, 2, 7, 11, 12, 17, 20];
const NORTH_EXPRESS = [20, 17, 12, 11, 7, 2, 0];
const TAIPEI = 0, HSR = 17, HUANBEI = 20, LAOJIEXI = 21;

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

const line = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tymc.json'), 'utf8')).lines.find(l => l.id === 'A');
const times = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tymc_times.json'), 'utf8'));

// 1/2：站序索引是本檔所有判準的地基，先驗它
check('G1 站序索引：index 0＝台北車站、index 17＝高鐵桃園站、index 20＝環北站、index 21＝老街溪站',
  line.stations[TAIPEI].name === '台北車站' && line.stations[HSR].name === '高鐵桃園站' &&
    line.stations[HUANBEI].name === '環北站' && line.stations[LAOJIEXI].name === '老街溪站',
  `0=${line.stations[TAIPEI].name}、17=${line.stations[HSR].name}、20=${line.stations[HUANBEI].name}、21=${line.stations[LAOJIEXI].name}`);

// 把產物攤平成 { days, stops: number[] } 的班次清單
const trips = [];
for (const [setName, list] of Object.entries(times.lines.A.sets)) {
  for (const t of list) {
    const stops = [];
    for (let i = 0; i * 2 + 1 < t.length; i++) stops.push(t[i * 2]);
    trips.push({ set: setName, stops, dep: t[1] });
  }
}
check('G2 分母閘門：真的解析出班次（解析失敗時下面每一條都會以「找不到違規」假綠）',
  trips.length > 50, `解析出 ${trips.length} 班`);

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const isWeekday = s => s === '平日';
const same = (arr) => JSON.stringify(arr);

const southFull = trips.filter(t => eq(t.stops, SOUTH_EXPRESS));
const northFull = trips.filter(t => eq(t.stops, NORTH_EXPRESS));
check('A1 平日與假日各至少一班完整的南下直達車（…→高鐵桃園→環北）',
  southFull.some(t => isWeekday(t.set)) && southFull.some(t => !isWeekday(t.set)),
  `共 ${southFull.length} 班完整符合 ${same(SOUTH_EXPRESS)}；平日 ${southFull.filter(t => isWeekday(t.set)).length}、假日 ${southFull.filter(t => !isWeekday(t.set)).length}`);
check('A2 平日與假日各至少一班完整的北上直達車（環北→…）',
  northFull.some(t => isWeekday(t.set)) && northFull.some(t => !isWeekday(t.set)),
  `共 ${northFull.length} 班完整符合 ${same(NORTH_EXPRESS)}；平日 ${northFull.filter(t => isWeekday(t.set)).length}、假日 ${northFull.filter(t => !isWeekday(t.set)).length}`);

// 直達車「樣態」候選：南下從台北車站起、北上到台北車站止；兩者皆為最多 9 站且包含高鐵桃園。
// 不用精確序列篩選，因 B 系列要抓的正是端點錯掉的班次，精確序列會先把違規班次濾掉。
// 直達車＝跳站；普通車＝站站停。停靠索引連不連續就是車種本身（班表沒有 pattern 欄位）。
const isExpress = stops => stops.some((v, i) => i > 0 && Math.abs(v - stops[i - 1]) !== 1);
const SOUTH_FULL = SOUTH_EXPRESS, NORTH_FULL = NORTH_EXPRESS;
const southExpressish = trips.filter(t => isExpress(t.stops) && t.stops[0] < t.stops[t.stops.length - 1]);
const northExpressish = trips.filter(t => isExpress(t.stops) && t.stops[0] > t.stops[t.stops.length - 1]);
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// 首末班要單獨看：實測每天約 17 班跳法與官方兩種樣態都不同（如 23:08 台北車站→老街溪
// 前段跳站後段站站停、05:33 首班本來就從老街溪開）。那些是真實班次不是資料錯誤，
// 但官方怎麼歸類它們我們沒有依據 ⇒ 前端留白不標車種，這裡也只盯數量與時段（E1）。
// B 系列要抓的是「端點被建錯」，分母因此收在日間。
const FIRSTLAST = t => t.dep <= 7 * 3600 || t.dep >= 22.5 * 3600;
const southDay = southExpressish.filter(t => !FIRSTLAST(t));
const northDay = northExpressish.filter(t => !FIRSTLAST(t));

check('G3 南下直達車分母閘門：解析出的班數要涵蓋全部直達車，不是只有完整樣態那幾班',
  southExpressish.length > 50, `解析出 ${southExpressish.length} 班（舊版分母只有 14 班）`);

const stopShort = southExpressish.filter(t => t.stops[t.stops.length - 1] === HSR);
check('B1 南下直達車不得終止於高鐵桃園（缺一站的原症狀；官方只有「到二航廈」與「到環北」兩種）',
  stopShort.length === 0, `${southExpressish.length} 班南下直達車，其中終止於 index 17 的有 ${stopShort.length} 班`);

// 每一班都必須落在官方兩種樣態上：基本直達車是完整樣態的前綴（南下）／後綴（北上）。
const southOff = southDay.filter(t => !eqArr(t.stops, SOUTH_FULL.slice(0, t.stops.length)));
check('B1b 日間（07:00–22:30 發車）每一班南下直達車都落在官方樣態上（分母涵蓋全部直達車，不再只驗完整那 8 班）',
  southDay.length > 40 && southOff.length === 0,
  `日間 ${southDay.length} 班中偏離官方樣態的有 ${southOff.length} 班` +
  (southOff.length ? `：${[...new Set(southOff.map(t => t.stops.join(',')))].slice(0, 3).join(' | ')}` : ''));

const stopLao = southDay.filter(t => t.stops.includes(LAOJIEXI));
check('B2 日間南下直達車不得包含老街溪（門檻放寬到四步會補成這裡）',
  stopLao.length === 0, `日間 ${southDay.length} 班中包含 index 21 的有 ${stopLao.length} 班`);

check('G4 北上直達車分母閘門：解析出的班數要涵蓋全部直達車',
  northExpressish.length > 50, `解析出 ${northExpressish.length} 班（舊版分母只有 14 班）`);

const startLao = northDay.filter(t => t.stops[0] === LAOJIEXI);
check('B3 日間北上直達車不得以老街溪起頭（多一站的原症狀）',
  startLao.length === 0, `日間 ${northDay.length} 班北上直達車，其中以 index 21 起頭的有 ${startLao.length} 班`);

const northOff = northDay.filter(t => !eqArr(t.stops, NORTH_FULL.slice(NORTH_FULL.length - t.stops.length)));
check('B3b 日間每一班北上直達車都落在官方樣態上',
  northDay.length > 40 && northOff.length === 0,
  `日間 ${northDay.length} 班中偏離官方樣態的有 ${northOff.length} 班` +
  (northOff.length ? `：${[...new Set(northOff.map(t => t.stops.join(',')))].slice(0, 3).join(' | ')}` : ''));

// 首末班特殊班次：不假裝知道它們是什麼，但要盯住「數量沒暴增、也沒有跑到日間來」。
// 這條紅＝上游停靠樣態變了，得回頭查官方並重新決定前端要不要標它們。
const special = [...southExpressish, ...northExpressish].filter(t =>
  !eqArr(t.stops, (t.stops[0] < t.stops[t.stops.length - 1] ? SOUTH_FULL : NORTH_FULL)
    .slice(t.stops[0] < t.stops[t.stops.length - 1] ? 0 : NORTH_FULL.length - t.stops.length,
           t.stops[0] < t.stops[t.stops.length - 1] ? t.stops.length : undefined)));
check('E1 首末班特殊班次：全部仍落在首末班時段，數量沒暴增（前端對這些班次留白不標車種）',
  special.length > 0 && special.length <= 30 && special.every(FIRSTLAST),
  `共 ${special.length} 班，其中落在日間的有 ${special.filter(t => !FIRSTLAST(t)).length} 班`);

const northLao = northDay.filter(t => t.stops.includes(LAOJIEXI));
check('B4 日間北上直達車不得包含老街溪',
  northLao.length === 0, `日間 ${northDay.length} 班中包含 index 21 的有 ${northLao.length} 班`);

// 控制組：普通車必須照常跑完全線 0↔21，證明 A22 不是被全域截掉
const localSouth = trips.filter(t => t.stops[0] === TAIPEI && t.stops[t.stops.length - 1] === LAOJIEXI && t.stops.length >= 20);
const localNorth = trips.filter(t => t.stops[0] === LAOJIEXI && t.stops[t.stops.length - 1] === TAIPEI && t.stops.length >= 20);
check('C 控制組：普通車兩個方向仍跑完全線（台北車站 ↔ 老街溪），A22 沒被全域截掉',
  localSouth.length > 0 && localNorth.length > 0,
  `南下全線 ${localSouth.length} 班、北上全線 ${localNorth.length} 班`);

const bad = results.filter(r => !r.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
