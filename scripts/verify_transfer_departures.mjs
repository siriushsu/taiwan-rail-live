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

// G2 —— 轉乘群逐一具名，不是「有 N 個」。前 9 個是台鐵/高鐵/林鐵原有的；
// 後 4 個由機捷 TYMC 與高捷 KRTC 帶進來（桃園＝高鐵桃園×機捷 A18，
// 高雄／橋頭／岡山＝台鐵×高捷紅線）。左營與台北則是原有群多了一個系統成員。
const WANT = ['台北', '南港', '板橋', '新竹', '苗栗', '台中', '台南', '左營', '嘉義',
              '桃園', '高雄', '橋頭', '岡山'];
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
const OUT_SYS = ['tra', 'thsr', 'afr', 'tymc', 'krtc'];
for (const sys of OUT_SYS) {
  const allow = allowBySys[sys.toUpperCase()] || new Set();
  const leaks = new Set();
  for (const t of d[sys] || []) {
    for (const [stn] of t.h) if (!allow.has(stn)) leaks.add(stn);
  }
  ok(`G5 ${sys} 沒有系統外漏的站名`, leaks.size === 0, [...leaks].join('、'));
}

// ── 以下是捷運（機捷 TYMC／高捷 KRTC）納入後才有的判準 ────────────────────────

// G6 —— 兩個新系統都真的有東西。G3 只保證「群裡每個成員有班次」，若整個系統從
// METRO_SYS 掉出去，連帶那幾個群也不成立、G2 會先紅；這條是分母的具名斷言。
for (const sys of ['tymc', 'krtc']) ok(`G6 ${sys} 有班次`, (d[sys] || []).length > 0, `${(d[sys] || []).length} 班`);

// G7 —— 捷運不得出現車次。官方沒有公告車次，硬塞線代號或內部合成編號就是假車次
// （使用者裁示：沒有就整欄消失）。畫面上的 .xfc-no 是靠 r.n 為空字串才收起來的。
for (const sys of ['tymc', 'krtc']) {
  const bad = (d[sys] || []).filter(t => String(t.n || '') !== '');
  ok(`G7 ${sys} 沒有任何車次值（官方沒有就要留空）`, bad.length === 0,
     bad.slice(0, 3).map(t => t.n).join('、'));
}

// G8 —— 車種字串必須與 index.html 的 TYMC_KIND_NAME 逐字相同。畫面是 t(r.ty) 直接拿它
// 當翻譯鍵，兩邊各寫一份就會漂：改了 index.html 那份，接續列會退回顯示原始中文而不是
// 使用者語言，而畫面「有字」看起來完全正常。真值來源取 index.html（畫面那份），不是產生
// 腳本自己的表——同源比對是零資訊。
const idx = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const kindLine = (idx.match(/const TYMC_KIND_NAME = \{([^}]*)\}/) || [])[1] || '';
const kindNames = [...kindLine.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(x => !['exp', 'com'].includes(x));
ok('G8pre 讀得到 index.html 的 TYMC_KIND_NAME', kindNames.length === 2, kindNames.join('、'));
const tyVals = [...new Set((d.tymc || []).map(t => String(t.ty || '')))].filter(Boolean);
ok('G8 機捷車種字串等於 index.html 的 TYMC_KIND_NAME',
   tyVals.length > 0 && tyVals.every(v => kindNames.includes(v)),
   `產物 ${tyVals.join('、')} / index.html ${kindNames.join('、')}`);
ok('G8b 兩種車種都真的出現過（只出現一種＝車種判定塌掉了）',
   kindNames.every(k => tyVals.includes(k)), tyVals.join('、'));
// 高捷官方沒有車種 ⇒ 必須留白，不可拿線名頂替
ok('G8c 高捷不標車種（官方沒有這個值）',
   (d.krtc || []).every(t => String(t.ty || '') === ''),
   [...new Set((d.krtc || []).map(t => t.ty))].join('、'));

// G9 —— 選日一致：產生腳本讀 data/tw_daytype.json，這裡改讀 index.html 裡的 TW_DAYTYPE
// （畫面 prepFreqTimes 實際用的那一份）。兩份若漂掉，接續表會挑到跟畫面上跑的車不同的班表，
// 而兩邊各自都「有資料」，看不出來。判準是「同一天選到同一個 set 名」。
const dtLine = (idx.match(/const TW_DAYTYPE = \{([\s\S]*?)\n\};/) || [])[1] || '';
const TW_DAYTYPE = {};
for (const m of dtLine.matchAll(/'(\d{4}-\d{2}-\d{2})':\s*(\d)/g)) TW_DAYTYPE[m[1]] = Number(m[2]);
ok('G9pre 讀得到 index.html 的 TW_DAYTYPE', Object.keys(TW_DAYTYPE).length > 0,
   `${Object.keys(TW_DAYTYPE).length} 筆`);
const setNameByFront = t => {
  const dt = TW_DAYTYPE[d.date];
  let day;
  if (dt === 1) day = t.holiday || (t.days && t.days[0]);
  else if (dt === 2) day = t.days && t.days[1];
  else day = t.days ? t.days[new Date(`${d.date}T00:00:00Z`).getUTCDay()] : null;
  if (t.dates && t.dates[d.date] && t.sets && t.sets[t.dates[d.date]]) day = t.dates[d.date];
  return day;
};

// G10 —— 逐筆對回來源班表（比照 G4，不是「大約相同」）。這裡從 *_times.json 的
// 「站 idx → 發車秒」攤平對重建一次，與產生腳本各寫各的：產物那一班的每一格
// [站名, 秒] 都必須在來源某一班裡逐值對得上，且該班的終點與 de 相同。
const METRO = {
  tymc: { times: 'tymc_times.json', geo: 'tymc.json', lines: ['A'] },
  krtc: { times: 'krtc_times.json', geo: 'krtc.json', lines: ['KR', 'KO'] },
};
let mChecked = 0;
for (const [sys, cfg] of Object.entries(METRO)) {
  const T = JSON.parse(readFileSync(path.join(ROOT, 'data', cfg.times), 'utf8'));
  const G = JSON.parse(readFileSync(path.join(ROOT, 'data', cfg.geo), 'utf8'));
  ok(`G10pre ${sys} 來源不是班距合成（estimated）`, !T.estimated, String(T.estimated));
  // 來源側：把今天那份 set 的每一班攤成 "終點|站名@秒,站名@秒" 的簽章
  const srcSigs = new Set();
  const srcAtStation = new Map();          // 站名 → 該站今天的發車秒集合
  for (const lid of cfg.lines) {
    const lt = T.lines[lid], lg = (G.lines || []).find(l => l.id === lid);
    const day = setNameByFront(lt);
    const set = (lt.sets && lt.sets[day]) || [];
    ok(`G10pre ${sys}/${lid} 前端選日規則挑得到今天的班表`, set.length > 0, `set=${day} ${set.length} 班`);
    const stn = lg.stations.map(x => x.name);
    for (const tr of set) {
      const parts = [];
      for (let p = 0; p < tr.length; p += 2) {
        parts.push(`${stn[tr[p]]}@${tr[p + 1]}`);
        if (!srcAtStation.has(stn[tr[p]])) srcAtStation.set(stn[tr[p]], new Set());
        srcAtStation.get(stn[tr[p]]).add(tr[p + 1]);
      }
      srcSigs.add(`${stn[tr[tr.length - 2]]}|${parts.join(',')}`);
    }
  }
  // 產物側：每一班的 h 必須是某一條來源簽章的子序列（同終點、同站名同秒、同順序）
  for (const t of (d[sys] || []).slice(0, 3)) {
    const need = t.h.map(([n, sec]) => `${n}@${sec}`);
    const hit = [...srcSigs].some(sig => {
      const [de, body] = sig.split('|');
      if (de !== t.de) return false;
      const seq = body.split(',');
      let i = 0;
      for (const x of seq) if (x === need[i]) i++;
      return i === need.length;
    });
    ok(`G10 ${sys} 「往${t.de} ${t.h[0][0]}@${t.h[0][1]}」逐值對得回來源班表`, hit,
       need.join(','));
    mChecked++;
  }
  // 覆蓋率的具名斷言：轉乘站在來源裡有幾班，產物就要有幾班（分母來自來源，不是產物自己）
  const allow = new Set();
  for (const g of d.groups) for (const [S, names] of Object.entries(g.members))
    if (S.toLowerCase() === sys) names.forEach(n => allow.add(n));
  for (const name of allow) {
    const want = (srcAtStation.get(name) || new Set()).size;
    const got = new Set();
    for (const t of d[sys] || []) for (const [n, sec] of t.h) if (n === name) got.add(sec);
    ok(`G11 ${sys}/${name} 產物班次數等於來源班次數`, want > 0 && got.size === want,
       `產物 ${got.size} / 來源 ${want}`);
  }
}
ok('G10b 真的比對過至少 3 筆捷運班次', mChecked >= 3, `實比對 ${mChecked} 筆`);

console.log(fails ? `\n${fails} 項未過` : '\n全部通過');
process.exit(fails ? 1 : 0);
