#!/usr/bin/env node
// 驗收「捷運小工具離線資料檔」。判準寫的是「是什麼／怎麼對應」,不是「有幾個」。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'app/ios/App/RailBoardWidget/MetroWidgetData.json');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

if (!existsSync(OUT)) { console.log(`FAIL 產物不存在: ${OUT}`); process.exit(1); }
const D = JSON.parse(readFileSync(OUT, 'utf8'));

// A. 三個系統都在,精度與擁擠度旗標與實況相符(這兩欄是畫面誠實度的來源)
const sysById = Object.fromEntries(D.systems.map(s => [s.id, s]));
ok('A1 三個系統齊全', ['trtc', 'krtc', 'tymc'].every(id => sysById[id]));
ok('A2 北捷精度=sec 且有擁擠度', sysById.trtc?.precision === 'sec' && sysById.trtc?.crowd === true);
ok('A3 高捷精度=min 且無擁擠度', sysById.krtc?.precision === 'min' && sysById.krtc?.crowd === false);
ok('A4 機捷精度=min 且無擁擠度', sysById.tymc?.precision === 'min' && sysById.tymc?.crowd === false);
ok('A5 沒有官方站牌倒數的系統不得出現',
   !D.systems.some(s => ['ntmc', 'tmrt', 'ntdlrt', 'ntalrt'].includes(s.id)));

// B. 別名規則的具名案例——這兩個站是「無條件去尾」會壞掉的證據
ok('B1 台北車站別名指向自己', D.alias.trtc['台北車站'] === '台北車站',
   JSON.stringify(D.alias.trtc['台北車站']));
ok('B2 松山機場站去尾', D.alias.trtc['松山機場站'] === '松山機場',
   JSON.stringify(D.alias.trtc['松山機場站']));
ok('B3 高捷岡山車站別名指向自己', D.alias.krtc['岡山車站'] === '岡山車站',
   JSON.stringify(D.alias.krtc['岡山車站']));

// C. 別名表對凍結樣本要 100% 覆蓋——別名表存在的唯一理由就是這件事
for (const [sys, file] of [['trtc', 'trtc-live.json'], ['krtc', 'krtc-live.json'], ['tymc', 'tymc-live.json']]) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'app/fixtures/metro', file), 'utf8'));
  const liveNames = sys === 'trtc'
    ? [...new Set(raw.board.map(b => b.name))]
    : [...new Set(raw.rows.map(r => r.s))];
  const miss = liveNames.filter(n => !D.alias[sys][n]);
  ok(`C-${sys} 樣本站名全部有別名`, miss.length === 0, JSON.stringify(miss.slice(0, 5)));
  const destNames = sys === 'trtc'
    ? [...new Set(raw.board.map(b => b.dest))]
    : [...new Set(raw.rows.map(r => r.d))];
  const dmiss = destNames.filter(n => !D.alias[sys][n]);
  ok(`C-${sys} 樣本終點全部有別名`, dmiss.length === 0, JSON.stringify(dmiss.slice(0, 5)));
}

// D. 每個站至少一個方向,且方向名稱本身也是合法站名(終點必須是這個系統的站)
for (const s of D.systems) {
  const names = new Set(s.lines.flatMap(l => l.stations.map(st => st.name)));
  const bad = s.lines.flatMap(l => l.stations)
    .filter(st => !st.dests?.length || st.dests.some(d => !names.has(d)))
    .map(st => st.name);
  ok(`D-${s.id} 每站都有合法方向`, bad.length === 0, JSON.stringify(bad.slice(0, 5)));
}

// E. 末班車逐字等於 TDX 原值(抽 3 筆),不是重算的
const fl = JSON.parse(readFileSync(join(ROOT, 'data/tdx/TRTC_FirstLastTimetable.json'), 'utf8'));
let sampled = 0;
for (const r of fl.slice(0, 400)) {
  const st = r.StationName?.Zh_tw, dest = r.DestinationStationName?.Zh_tw;
  if (!st || !dest || sampled >= 3) continue;
  const key = `trtc|${st}|${dest}`;
  if (!(key in D.lastTrain)) continue;
  ok(`E${++sampled} 末班逐字相符 ${key}`, D.lastTrain[key] === r.LastTrainTime,
     `${D.lastTrain[key]} vs ${r.LastTrainTime}`);
}
ok('E0 真的抽到 3 筆', sampled === 3, `sampled=${sampled}`);

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
