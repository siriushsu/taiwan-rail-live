#!/usr/bin/env node
// 轉乘發車表驗收。判準寫「是什麼／怎麼排」，不寫「有幾個」。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'transfer_departures.json');
const DENSE = path.join(ROOT, 'data', 'tra_schedule_dense.json');

let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) fails++;
};

// G0 —— 先證明我在驗什麼（形態 0：沒證明「我在量的是誰」）
ok('G0 產物存在', existsSync(OUT), OUT);
if (!existsSync(OUT)) { console.log(`\n${fails} 項未過`); process.exit(1); }
const d = JSON.parse(readFileSync(OUT, 'utf8'));
console.log(`     驗的是 ${OUT}  schemaVersion=${d.schemaVersion}  date=${d.date}`);

// G1 —— 日期守門人：產生檔會無聲落後，這條是唯一照得到的
const dense = JSON.parse(readFileSync(DENSE, 'utf8'));
ok('G1 日期等於班表當日鍵', d.date === dense.date, `產物 ${d.date} / 班表 ${dense.date}`);

// G1b —— 絕對日期守門人（2026-09-01 Finding 5）。G1 只證明「兩個產物是同一天生的」，兩個一起
// 落後它是綠的；而 transfer_departures.json 是【建置當日】的單日快照，前端 index.html:30575
// 開機只檢查 schemaVersion===1，沒有任何日期判斷 ⇒ 檔案放久了畫面照樣顯示，只是顯示的是別天
// 的班表。這條是唯一能把「整組資料一起過期」照出來的斷言。
// 門檻取 14 天：npm run fetch-schedule 產出的台鐵窗就是 14 天逐日，超出這個窗連來源班表本身
// 都沒有那天的資料；廣審量過的「單日快照 vs 14 天窗最多差 3 班（≤2.3%）」也只在這個範圍內
// 成立，再遠就沒有任何量測支撐。時區釘 Asia/Taipei（比照 scripts/verify_afr.mjs:193），
// 不吃跑腳本那台機器的本地時區。
const todayTW = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); // YYYY-MM-DD
const ageDays = Math.round((Date.parse(`${todayTW}T00:00:00Z`) - Date.parse(`${d.date}T00:00:00Z`)) / 86400000);
ok('G1b 資料日期與台北當日相差在 14 天內（單日快照會無聲落後，前端沒有日期守門）',
   Number.isFinite(ageDays) && ageDays >= -1 && ageDays <= 14,
   `產物 ${d.date} / 台北今天 ${todayTW} / 差 ${ageDays} 天`);

// G2 —— 9 個轉乘群逐一具名，不是「有 9 個」
const WANT = ['台北', '南港', '板橋', '新竹', '苗栗', '台中', '台南', '左營', '嘉義'];
const got = new Set(d.groups.map(g => g.name));
for (const n of WANT) ok(`G2 轉乘群「${n}」在`, got.has(n));
ok('G2b 沒有多出來的群', d.groups.length === WANT.length, `實際 ${d.groups.length}`);

// G3 —— 每個有班表成員都至少有一班（覆蓋率要有具名斷言，不能只印在 detail）
for (const g of d.groups) {
  for (const [sys, names] of Object.entries(g.members)) {
    const pool = d[sys.toLowerCase()] || [];
    const hit = pool.some(t => t.h.some(([stn]) => names.includes(stn)));
    ok(`G3 ${g.name}/${sys} 有班次`, hit);
  }
}

// G4 —— 逐筆對回來源，不是「大約相同」
const byNo = new Map(dense.trains.map(t => [t.train, t]));
let checked = 0;
for (const t of d.tra.slice(0, 3)) {
  const src = byNo.get(t.n);
  ok(`G4 車次 ${t.n} 在來源班表裡`, !!src);
  if (!src) continue;
  for (const [stn, sec, isLast] of t.h) {
    const i = src.stops.findIndex(s => s.name === stn);
    const want = isLast ? src.stops[i].arrSec : src.stops[i].depSec;
    ok(`G4 ${t.n}@${stn} 秒數逐 byte 等於來源`, sec === want, `${sec} vs ${want}`);
    checked++;
  }
}
ok('G4b 真的比對過至少 3 筆', checked >= 3, `實比對 ${checked} 筆`);

// G5 —— 不外漏：每個系統輸出的 h 站名，都必須是「該系統至少一個群的 members」之一。
// 防的是同名異地站跨系統污染（例：THSR 需要「左營」，但台鐵縱貫線另有一個
// 與高鐵無關、真實存在的「左營」站；若三系統共用一個站名集合，會把後者的
// 停靠也混進台鐵輸出——結構完全正常、G0-G4b 全過，只是多了不該有的筆數）。
const allowBySys = {};
for (const g of d.groups) {
  for (const [sys, names] of Object.entries(g.members)) {
    (allowBySys[sys] ||= new Set());
    names.forEach(n => allowBySys[sys].add(n));
  }
}
for (const sys of ['tra', 'thsr', 'afr']) {
  const allow = allowBySys[sys.toUpperCase()] || new Set();
  const leaks = new Set();
  for (const t of d[sys] || []) {
    for (const [stn] of t.h) if (!allow.has(stn)) leaks.add(stn);
  }
  ok(`G5 ${sys} 沒有系統外漏的站名`, leaks.size === 0, [...leaks].join('、'));
}

console.log(fails ? `\n${fails} 項未過` : '\n全部通過');
process.exit(fails ? 1 : 0);
