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

// B. 別名表覆蓋兩種寫法(這三條【不】測 canonical(),見下方 B4/B5——
//    別名表結尾有一圈 alias[n]=n; alias[n+'站']=n 的補齊,這三條會被它滿足)
ok('B1 台北車站別名指向自己', D.alias.trtc['台北車站'] === '台北車站',
   JSON.stringify(D.alias.trtc['台北車站']));
ok('B2 松山機場站去尾', D.alias.trtc['松山機場站'] === '松山機場',
   JSON.stringify(D.alias.trtc['松山機場站']));
ok('B3 高捷岡山車站別名指向自己', D.alias.krtc['岡山車站'] === '岡山車站',
   JSON.stringify(D.alias.krtc['岡山車站']));

// 🔴 B4/B5 才是 canonical() 真正的判準:它決定首末班表那一側的 join 配不配得上。
//    無條件去尾時「台北車站」→「台北車」、「岡山車站」→「岡山車」,兩者都不在站名集合裡
//    ⇒ 整站的末班車鍵歸零(實測 4→0 與 1→0)。這兩條是 2026-08-14 補的:
//    原本只有 B1–B3,而突變測試證明它們在 canonical() 壞掉時照樣全綠。
const lastKeys = (sys, st) => Object.keys(D.lastTrain).filter(k => k.startsWith(`${sys}|${st}|`)).length;
ok('B4 台北車站有末班車鍵(canonical 的真判準)', lastKeys('trtc', '台北車站') > 0,
   `鍵數=${lastKeys('trtc', '台北車站')}`);
ok('B5 岡山車站有末班車鍵(canonical 的真判準)', lastKeys('krtc', '岡山車站') > 0,
   `鍵數=${lastKeys('krtc', '岡山車站')}`);

// B6. 首末班表沒有任何一列配不上站名集合。產生器原本只把這個數字印在 console,
//     沒有斷言在守 ⇒ 分母會無聲縮水。現在它寫進產物,這裡當 gate。
for (const s of D.systems) ok(`B6-${s.id} 首末班列全部配得上`, (D.dropped?.[s.id] ?? -1) === 0,
   `dropped=${D.dropped?.[s.id]}`);

// B7. 🔴 B4/B5 只抽兩站,B6 只測「有出現但配不上」——兩者都測不到 canonical() 變成「來者不拒」
//     (突變成無條件去尾時它永不回 null ⇒ dropped 恆 0,末班鍵卻寫成了「台北車」這種不存在的站)。
//     這條把分母補成全體:末班表每個鍵的站名與終點名都必須是該系統的合法站名。
{
  const namesOf = Object.fromEntries(D.systems.map(s =>
    [s.id, new Set(s.lines.flatMap(l => l.stations.map(st => st.name)))]));
  const bad = Object.keys(D.lastTrain).filter(k => {
    const [sys, st, dest] = k.split('|');
    return !namesOf[sys] || !namesOf[sys].has(st) || !namesOf[sys].has(dest);
  });
  ok('B7 末班表每個鍵的站名與終點都是合法站名', bad.length === 0,
     `${bad.length} 筆非法, 前 5: ${JSON.stringify(bad.slice(0, 5))}`);
}

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

// E4. 🔴 環狀線的末班班表在 NTMC 那份(它由新北捷運公司營運),上面 E1–E3 只讀 TRTC 那份 ⇒
//     Y 線的末班值一條都沒被驗過。少了 NTMC 時 Y 站仍會從 board[] 拿到方向 ⇒ D-trtc 照樣綠,
//     所以這條是「NTMC 真的有被讀進來且逐字照抄」的唯一 gate。
{
  const ny = JSON.parse(readFileSync(join(ROOT, 'data/tdx/NTMC_FirstLastTimetable.json'), 'utf8'));
  const r = ny.find(x => x.StationName?.Zh_tw && x.DestinationStationName?.Zh_tw && x.LastTrainTime);
  const key = r && `trtc|${r.StationName.Zh_tw}|${r.DestinationStationName.Zh_tw}`;
  ok('E4 環狀線末班逐字相符(NTMC 來源)', !!r && D.lastTrain[key] === r.LastTrainTime,
     `${key} → ${D.lastTrain?.[key]} vs ${r?.LastTrainTime}`);
}

// F. 站座標——自動選站(最近站)的基礎。兩條判準刻意不同源(心得 29):
//    F1 判「照抄」:對全體站(不抽樣)與來源 geo 檔逐值相等。與產生器同源(都讀 geo 檔),
//       抓得到產生器的加工/漏抄,抓不到 geo 檔自己壞掉。
//    F2 判「合理」:座標落在台灣框(外部地理常數,與 geo 檔無關)——lat/lon 對調時
//       lat 會變成 ~121 出框必紅,geo 檔整欄壞掉也在這裡現形。
{
  const GEO = { trtc: 'data/trtc.json', krtc: 'data/krtc.json', tymc: 'data/tymc.json' };
  for (const s of D.systems) {
    const src = JSON.parse(readFileSync(join(ROOT, GEO[s.id]), 'utf8'));
    const srcBy = new Map(src.lines.flatMap(l => l.stations.map(st => [`${l.id}|${st.name}`, st])));
    const badEq = [], badBox = [];
    for (const l of s.lines) for (const st of l.stations) {
      const o = srcBy.get(`${l.id}|${st.name}`);
      if (!o || st.lat !== o.lat || st.lon !== o.lon) badEq.push(`${l.id}|${st.name}`);
      if (!(st.lat >= 21.5 && st.lat <= 25.5 && st.lon >= 119.5 && st.lon <= 122.2)) badBox.push(st.name);
    }
    ok(`F1-${s.id} 站座標逐字等於來源 geo 檔`, badEq.length === 0, JSON.stringify(badEq.slice(0, 5)));
    ok(`F2-${s.id} 站座標落在台灣框`, badBox.length === 0, JSON.stringify(badBox.slice(0, 5)));
  }
}

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
