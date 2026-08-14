// 機捷直達車端點 gate（缺陷④）。
//
// 為什麼既有的 verify_metro_times.mjs 抓不到：它驗的是結構與「相對於基準的漂移」，
// 而這個錯誤從一開始就在基準裡，漂移為零 ⇒ 432/432 全綠也不代表端點是對的。
//
// 判準來源刻意獨立於 builder：官方停靠序列與端點寫成本檔自己的常數，
// 不讀產物的 dest 欄位、也不呼叫 builder 的任何函式。
//   官方直達車（TYMC 各站時刻表頁實查）：
//     南下 台北車站→新北產業園區→長庚醫院→機場第一航廈→機場第二航廈→高鐵桃園→環北
//     北上 反向；老街溪(A22)整條直達車班表都是「-」，兩個方向都不該出現。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');

const SOUTH_EXPRESS = [0, 2, 7, 11, 12, 17, 20];
const NORTH_EXPRESS = [20, 17, 12, 11, 7, 2, 0];
const TAIPEI = 0, HSR = 17, HUANBEI = 20, LAOJIEXI = 21;

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

const line = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tymc.json'), 'utf8')).lines.find(l => l.id === 'A');
const times = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tymc_times.json'), 'utf8'));

// 1/2：站序索引是本檔所有判準的地基，先驗它
check('G1 站序索引：index 20＝環北站、index 21＝老街溪站',
  line.stations[HUANBEI].name === '環北站' && line.stations[LAOJIEXI].name === '老街溪站',
  `20=${line.stations[HUANBEI].name}、21=${line.stations[LAOJIEXI].name}`);

// 把產物攤平成 { days, stops: number[] } 的班次清單
const trips = [];
for (const [setName, list] of Object.entries(times.lines.A.sets)) {
  for (const t of list) {
    const stops = [];
    for (let i = 0; i * 2 + 1 < t.length; i++) stops.push(t[i * 2]);
    trips.push({ set: setName, stops });
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

// 直達車的辨識特徵：不停 index 1（A2 三重）之類的中間站，且首站是台北車站或環北
const southExpressish = trips.filter(t => t.stops[0] === TAIPEI && t.stops.length <= 9 && t.stops.includes(HSR));
const northExpressish = trips.filter(t => t.stops[t.stops.length - 1] === TAIPEI && t.stops.length <= 9 && t.stops.includes(HSR));

const stopShort = southExpressish.filter(t => t.stops[t.stops.length - 1] === HSR);
check('B1 南下直達車不得終止於高鐵桃園（缺一站的原症狀）',
  stopShort.length === 0, `${southExpressish.length} 班南下直達車樣態，其中終止於 index 17 的有 ${stopShort.length} 班`);

const stopLao = southExpressish.filter(t => t.stops.includes(LAOJIEXI));
check('B2 南下直達車不得包含老街溪（門檻放寬到四步會補成這裡）',
  stopLao.length === 0, `包含 index 21 的有 ${stopLao.length} 班`);

const startLao = northExpressish.filter(t => t.stops[0] === LAOJIEXI);
check('B3 北上直達車不得以老街溪起頭（多一站的原症狀）',
  startLao.length === 0, `${northExpressish.length} 班北上直達車樣態，其中以 index 21 起頭的有 ${startLao.length} 班`);

const northLao = northExpressish.filter(t => t.stops.includes(LAOJIEXI));
check('B4 北上直達車不得包含老街溪',
  northLao.length === 0, `包含 index 21 的有 ${northLao.length} 班`);

// 控制組：普通車必須照常跑完全線 0↔21，證明 A22 不是被全域截掉
const localSouth = trips.filter(t => t.stops[0] === TAIPEI && t.stops[t.stops.length - 1] === LAOJIEXI && t.stops.length >= 20);
const localNorth = trips.filter(t => t.stops[0] === LAOJIEXI && t.stops[t.stops.length - 1] === TAIPEI && t.stops.length >= 20);
check('C 控制組：普通車兩個方向仍跑完全線（台北車站 ↔ 老街溪），A22 沒被全域截掉',
  localSouth.length > 0 && localNorth.length > 0,
  `南下全線 ${localSouth.length} 班、北上全線 ${localNorth.length} 班`);

const bad = results.filter(r => !r.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
