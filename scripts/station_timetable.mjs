// 車站時刻頁的資料層:把「逐日班表」整理成「某站兩週逐班＋行駛日」。純函式,不讀時鐘——
// 同樣輸入產出逐 byte 相同(下游 build_aeo_pages 的 --check 靠這點)。
//
// ── 介面 ──────────────────────────────────────────────────────────────────────
//   const inputs = loadStationTimetableInputs(root)      // 便利函式:讀檔(不讀時鐘),回傳下面 inputs
//   inputs = { tra, thsr, daytype, holidayNames, i18n, lineNames }
//     tra          data/tra_schedule_dense.json(已 parse)。停靠點有 stop:true/false,通過站 stop:false。
//     thsr         scripts/seo_data/thsr_timetable.json(scripts/fetch_thsr_timetable.py 產生)。清單只有停靠站。
//     daytype      data/tw_daytype.json           日期→1(放假);週末預設放假,除非標 0(補班)
//     holidayNames data/holiday_names.json        日期→中文節日名(只有中文,英日文不翻節日名)
//     i18n         i18n/stations.json             systems.tra_sched / thsr_sched(鍵＝官方站名)、trainTypes
//     lineNames    scripts/seo_data/tra_line_names.json(本檔不用,順便讀給頁面產生器)
//
//   traStationTimetable(stationName, inputs)    stationName 用官方寫法(「臺北」「池上」),
//                                               即 station_transfers.json 的 stations["TRA:1000"].name
//   thsrStationTimetable(stationName, inputs)   高鐵站名(「台北」「台中」「左營」)
//   任何站在資料範圍內一班「停本站」的班次都找不到 → throw(不回空結果)。
//   i18n 缺站名／車種 → throw(缺譯文不准悄悄漏出中文)。
//
//   兩者回傳同一形狀:
//   {
//     system: 'TRA' | 'THSR',
//     station: {zh, en, ja},
//     dateRange: [首日, 末日],            // 該資料集自己的涵蓋區間(台鐵 dense 與高鐵新檔各自不同)
//     dates: [ISO 日期…],                 // 該資料集涵蓋的每一天(升冪)
//     offDates: [ISO 日期…],              // 其中的放假日(週末預設放假,日型表標 0＝補班則不算)
//     perDay: [{ date, weekday, md:{zh,en,ja}, departing, terminating, stopping }],
//         // weekday 0=週一…6=週日;md＝「10/9（國慶）」式短日期(節日註記只在放假日)
//         // departing   ＝ 當天從本站開出的班數(＝方向表裡「行駛日含該日」的列數;含以本站為始發者,
//         //                不含以本站為終點者)。台鐵樣本頁的「每天班數」就是這個口徑。
//         // terminating ＝ 當天以本站為終點的班數(到站表)
//         // stopping    ＝ departing + terminating(所有停本站班次)
//     directions: [{                      // 台鐵依「本站在清單裡的下一個點」分;高鐵依沿線站序分南下／北上
//       key,                              // 台鐵＝下一個點的站名(中文);高鐵＝'south' | 'north'
//       next: {zh,en,ja}|null,            // 台鐵:下一個點(可能是通過站,en/ja 缺譯時為 null);高鐵:null
//       label: {zh,en,ja}|null,           // 高鐵:南下／Southbound／南下 等;台鐵:null(頁面用 destinations 組標題)
//       endpoint: {zh,en,ja}|null,        // 高鐵:該方向的線端點(左營／南港);台鐵:null
//       count,                            // 該方向列數(合併後)
//       destinations: [{ name:{zh,en,ja}, count }],   // 該方向各終點的列數,count 降冪、同數依站名
//       rows: [{
//         depSec,                         // 本站開車秒(從當日 00:00 起,≥86400 為隔日)
//         dep: fmtTime(depSec),           // 見下
//         train,                          // 車次(字串,保留前導零如 '0108')
//         type: {key,zh,en,ja},           // 車種大類(trainTypes 的鍵)
//         to: {zh,en,ja},                 // 終點(最後一個停靠站)
//         run: [ISO 日期…],               // 實際行駛日(升冪)
//         label: runLabel(run, cal)       // 見下
//       }]                                // 列序:depSec、車次、終點 升冪(決定性)
//     }],                                 // 方向序:count 降冪、key 升冪(高鐵固定 south, north)
//     arrivals: [{                        // 以本站為終點的班次(本站是終點才進這裡)
//       arrSec, arr, train, type, from:{zh,en,ja} /*始發站*/, run, label
//     }]
//   }
//   合併鍵:車次＋本站開車「分」(floor(秒/60),與頁面顯示同單位)＋終點(到站表:車次＋到站分＋始發站),行駛日取聯集。
//   同一車次改點前後各一版、顯示時刻相同(秒數可差幾秒)的會併成一列;列的 depSec／arrSec 取該組最小值。台鐵同一站在同一班的清單裡出現兩次
//   (環島專車 6669 始發又終到新左營)時,始發那次進方向表、終到那次進 arrivals。
//
//   fmtTime(sec) → { hm:'00:34', nextDay:true, zh:'00:34（+1）', en:'00:34 (+1)', ja:'00:34（翌日）' }
//     **捨去到分**(不四捨五入:22:25:30 是 22:25,跟站上 fmtHM 一致);sec≥86400 標隔日;≥172800 throw。
//
//   runLabel(runDates, cal) → { kind, special, zh, en, ja }     cal = makeCalendar(dates, inputs)
//     special＝不是「每日」。kind 是機器可讀的分類(見下)。
//     語法(順序即判斷順序,第一個成立的為準;zh 完全照 phaseb_mockup.py 的 run_label):
//       kind        zh                     en                              ja
//       daily       每日                   Daily                           毎日
//       workdays    上班日（放假日不開）   Working days                    平日（休日は運休）
//       offdays     週末與放假日           Weekends and holidays           土日・休日
//       from        10/3 起每日            Daily from Oct 3                10月3日から毎日
//       until       10/2 以前每日          Daily through Oct 2             10月2日まで毎日
//       span        10/3–10/8 每日         Daily Oct 3–Oct 8               10月3日〜10月8日 毎日
//                   (from/until/span 只在「日期連續、≥3 天」時用;起點是首日→until,終點是末日→from)
//       weekdays    週五、週日             Fri, Sun                        金曜・日曜
//                   週一至週三、週五       Mon–Wed, Fri                    月曜〜水曜・金曜  (連續 ≥3 個星期幾才用「至／–／〜」)
//                     + 例外日  ，另 10/3  , plus Oct 3                    、ほか10月3日     (該日在 run 裡、但它的星期幾不在歸納內)
//                     + 缺席日  ；9/28（放假） 不開  ; not on Sep 28 (holiday)  ；9月28日（休日）は運休
//                   星期幾歸納＝「資料涵蓋的每個該星期幾都開」才算(涵蓋內沒出現過的星期幾不算)
//       only        僅 9/28（放假）        Only Sep 28 (holiday)           9月28日（休日）のみ   (歸納不出任何星期幾)
//     日期寫法:zh「10/9（國慶）」、en「Oct 9 (holiday)」、ja「10月9日（休日）」;
//     註記只加在放假日:zh 用 holiday_names 的中文節日名,平日放假但沒有節日名寫「放假」;
//     en／ja 一律 holiday／休日(節日名不翻)。週末沒有節日名就不註記。
//
//   makeCalendar(dates, inputs)、mdLabel(cal, iso, lang)、THSR_ORDER 也有 export。
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const THSR_ORDER = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];
const LANGS = ['zh', 'en', 'ja'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = {
  zh: ['一', '二', '三', '四', '五', '六', '日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ja: ['月', '火', '水', '木', '金', '土', '日'],
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // 刻意不用語系相關的比較:語系不同排序會漂
const pad2 = n => String(n).padStart(2, '0');

export function loadStationTimetableInputs(root) {
  const rd = rel => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
  return {
    tra: rd('data/tra_schedule_dense.json'),
    thsr: rd('scripts/seo_data/thsr_timetable.json'),
    daytype: rd('data/tw_daytype.json'),
    holidayNames: rd('data/holiday_names.json'),
    i18n: rd('i18n/stations.json'),
    lineNames: rd('scripts/seo_data/tra_line_names.json'),
  };
}

// ── 時刻 ─────────────────────────────────────────────────────────────────────
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0 || sec >= 172800) throw new RangeError(`fmtTime: 秒數超出範圍 ${sec}`);
  const m = Math.floor(sec / 60);                       // 捨去到分
  const hm = `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
  const nextDay = sec >= 86400;
  return { hm, nextDay, zh: hm + (nextDay ? '（+1）' : ''), en: hm + (nextDay ? ' (+1)' : ''), ja: hm + (nextDay ? '（翌日）' : '') };
}

// ── 日曆與行駛日標籤 ──────────────────────────────────────────────────────────
const weekdayOf = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // 0=週一
};

export function makeCalendar(dates, { daytype, holidayNames }) {
  if (!dates.length) throw new Error('makeCalendar: 沒有日期');
  const years = new Set(Object.keys(daytype).map(k => k.slice(0, 4)));
  const wd = {}, off = new Set(), work = new Set();
  for (const d of dates) {
    if (!years.has(d.slice(0, 4))) throw new Error(`makeCalendar: tw_daytype 沒有 ${d.slice(0, 4)} 年資料,無法判定放假日`);
    wd[d] = weekdayOf(d);
    const t = daytype[d];
    (t === 1 || (wd[d] >= 5 && t !== 0) ? off : work).add(d);
  }
  return { dates: [...dates], wd, off, work, daytype, holidayNames };
}

export function mdLabel(cal, iso, lang) {
  const [, m, d] = iso.split('-').map(Number);
  const name = cal.holidayNames[iso] || (cal.daytype[iso] === 1 && cal.wd[iso] < 5 ? '放假' : null);
  if (lang === 'zh') return `${m}/${d}` + (name ? `（${name}）` : '');
  if (lang === 'en') return `${MON_EN[m - 1]} ${d}` + (name ? ' (holiday)' : '');
  return `${m}月${d}日` + (name ? '（休日）' : '');
}

const T = {
  zh: {
    daily: '每日', workdays: '上班日（放假日不開）', offdays: '週末與放假日',
    from: m => `${m} 起每日`, until: m => `${m} 以前每日`, span: (a, b) => `${a}–${b} 每日`,
    extra: l => `，另 ${l}`, miss: l => `；${l} 不開`, only: l => `僅 ${l}`,
    sep: '、', wdSep: '、', wd: i => `週${WD.zh[i]}`, wdRange: (a, b) => `週${WD.zh[a]}至週${WD.zh[b]}`,
  },
  en: {
    daily: 'Daily', workdays: 'Working days', offdays: 'Weekends and holidays',
    from: m => `Daily from ${m}`, until: m => `Daily through ${m}`, span: (a, b) => `Daily ${a}–${b}`,
    extra: l => `, plus ${l}`, miss: l => `; not on ${l}`, only: l => `Only ${l}`,
    sep: ', ', wdSep: ', ', wd: i => WD.en[i], wdRange: (a, b) => `${WD.en[a]}–${WD.en[b]}`,
  },
  ja: {
    daily: '毎日', workdays: '平日（休日は運休）', offdays: '土日・休日',
    from: m => `${m}から毎日`, until: m => `${m}まで毎日`, span: (a, b) => `${a}〜${b} 毎日`,
    extra: l => `、ほか${l}`, miss: l => `；${l}は運休`, only: l => `${l}のみ`,
    sep: '、', wdSep: '・', wd: i => `${WD.ja[i]}曜`, wdRange: (a, b) => `${WD.ja[a]}曜〜${WD.ja[b]}曜`,   // 單獨一個「日」易讀成別的意思,每個星期都寫「曜」
  },
};

function weekdayText(ws, lang) {                        // ws 升冪的 0–6;連續 ≥3 個才用範圍
  const t = T[lang], runs = [];
  let cur = [ws[0]];
  for (const w of ws.slice(1)) { if (w === cur[cur.length - 1] + 1) cur.push(w); else { runs.push(cur); cur = [w]; } }
  runs.push(cur);
  return runs.map(r => (r.length >= 3 ? t.wdRange(r[0], r[r.length - 1]) : r.map(t.wd).join(t.wdSep))).join(t.wdSep);
}

export function runLabel(runDates, cal) {
  const run = new Set(runDates);
  if (!run.size) throw new Error('runLabel: 空的行駛日集合');
  for (const d of run) if (!(d in cal.wd)) throw new Error(`runLabel: ${d} 不在資料涵蓋的日期內`);
  const dates = cal.dates, sameSet = s => s.size === run.size && [...s].every(d => run.has(d));
  const make = (kind, f) => ({ kind, special: kind !== 'daily', zh: f(T.zh, 'zh'), en: f(T.en, 'en'), ja: f(T.ja, 'ja') });
  const md = (d, lang) => mdLabel(cal, d, lang);

  if (run.size === dates.length) return make('daily', t => t.daily);
  if (sameSet(cal.work)) return make('workdays', t => t.workdays);
  if (sameSet(cal.off)) return make('offdays', t => t.offdays);
  const idx = dates.map((d, i) => (run.has(d) ? i : -1)).filter(i => i >= 0);
  if (idx.length >= 3 && idx[idx.length - 1] - idx[0] + 1 === idx.length) {
    const a = dates[idx[0]], b = dates[idx[idx.length - 1]];
    if (idx[0] === 0) return make('until', (t, l) => t.until(md(b, l)));
    if (idx[idx.length - 1] === dates.length - 1) return make('from', (t, l) => t.from(md(a, l)));
    return make('span', (t, l) => t.span(md(a, l), md(b, l)));
  }
  // 星期幾歸納:涵蓋內出現過、而且每次出現都開的星期幾(涵蓋內沒出現過的不算)
  const inc = [0, 1, 2, 3, 4, 5, 6].filter(w => {
    const ds = dates.filter(d => cal.wd[d] === w);
    return ds.length > 0 && ds.every(d => run.has(d));
  });
  const extra = dates.filter(d => run.has(d) && !inc.includes(cal.wd[d]));
  const miss = dates.filter(d => !run.has(d) && inc.includes(cal.wd[d]));
  if (!inc.length) return make('only', (t, l) => t.only(extra.map(d => md(d, l)).join(t.sep)));
  return make('weekdays', (t, l) => weekdayText(inc, l)
    + (extra.length ? t.extra(extra.map(d => md(d, l)).join(t.sep)) : '')
    + (miss.length ? t.miss(miss.map(d => md(d, l)).join(t.sep)) : ''));
}

// ── 名稱 ─────────────────────────────────────────────────────────────────────
// 字典裡兩個台鐵站的英文帶底線消歧義標記(1100 中壢 Zhongli_Taoyuan、7170 中里 Zhongli_Yilan;TDX 逐字相同),
// docs/i18n/tra_station_names.json 的 _caveats 建議顯示成 Zhongli (Taoyuan)。只在頁面產生時轉換,不改字典。
const displayEn = en => en && en.replace(/^([^_\s]+)_([^_\s]+)$/, '$1 ($2)');
function nameOf(i18n, sys, zh, lenient = false) {
  const e = (i18n.systems[sys] || {})[zh];
  if (!e || !e.en || !e.ja) {
    if (lenient) return { zh, en: displayEn(e && e.en) || null, ja: e && e.ja || null };
    throw new Error(`i18n/stations.json systems.${sys} 缺「${zh}」的英日文名`);
  }
  return { zh, en: displayEn(e.en), ja: e.ja };
}

function typeOf(i18n, typeName, carName) {
  const tt = i18n.trainTypes || {};
  for (const cand of [typeName, carName]) {
    if (!cand) continue;
    for (const k of [cand, cand.replace(/[(（].*$/, '')]) {
      if (tt[k]) return { key: k, zh: k, en: tt[k].en, ja: tt[k].ja };
    }
  }
  throw new Error(`i18n/stations.json trainTypes 對不上車種 typeName=${typeName} carName=${carName}`);
}

// ── 共用骨架 ─────────────────────────────────────────────────────────────────
// occ(train, 站名) → 該班在本站的停靠次數(通常 1 次);每次是 {terminating, sec, ...}。
// 系統各自提供 occ／dirOf／dirMeta／dirOrder,這裡只管合併、排序、統計。
function assemble({ system, station, stationName, ds, inputs, sysKey, defaultType, occ, dirOf, dirMeta, dirOrder }) {
  const dates = Object.keys(ds.dates).sort();
  const cal = makeCalendar(dates, inputs);
  const runsOf = new Map();                                     // trains 索引 → 行駛日集合
  for (const d of dates) for (const i of ds.dates[d]) (runsOf.get(i) || runsOf.set(i, new Set()).get(i)).add(d);

  const dep = new Map(), arr = new Map();                       // 合併鍵 → 列
  for (const i of [...runsOf.keys()].sort((a, b) => a - b)) {
    const tr = ds.trains[i];
    for (const o of occ(tr, stationName)) {
      const run = runsOf.get(i);
      // 合併鍵用「分」不用「秒」:頁面只顯示到分(捨去),同車次改點前後只差幾秒、顯示成同一分鐘的必須併成一列
      // (否則會出現顯示上一模一樣、行駛日互補的兩列)。列的秒數取該組最小值,排序才不看到達順序。
      if (o.terminating) {
        const key = `${tr.train}|${Math.floor(o.sec / 60)}|${o.from}`;
        const row = arr.get(key) || arr.set(key, { sec: o.sec, train: tr.train, tr, from: o.from, run: new Set() }).get(key);
        row.sec = Math.min(row.sec, o.sec);
        for (const d of run) row.run.add(d);
      } else {
        const g = dirOf(o);
        const key = `${g}|${tr.train}|${Math.floor(o.sec / 60)}|${o.to}`;
        const row = dep.get(key) || dep.set(key, { g, sec: o.sec, train: tr.train, tr, to: o.to, next: o.next, run: new Set() }).get(key);
        row.sec = Math.min(row.sec, o.sec);
        for (const d of run) row.run.add(d);
      }
    }
  }
  if (!dep.size && !arr.size) {
    throw new Error(`${system} 站「${stationName}」在 ${ds.dateRange[0]}…${ds.dateRange[1]} 內找不到任何停靠班次`);
  }

  const fin = r => ({ run: [...r.run].sort(), typeInfo: typeOf(inputs.i18n, r.tr.typeName || defaultType, r.tr.carName) });
  const groups = new Map();
  for (const r of dep.values()) (groups.get(r.g) || groups.set(r.g, []).get(r.g)).push(r);
  const directions = [...groups.entries()].map(([key, rs]) => {
    rs.sort((a, b) => a.sec - b.sec || cmp(a.train, b.train) || cmp(a.to, b.to));
    const dest = new Map();
    for (const r of rs) dest.set(r.to, (dest.get(r.to) || 0) + 1);
    const meta = dirMeta(key, rs);
    return {
      key, next: meta.next, label: meta.label, endpoint: meta.endpoint, count: rs.length,
      destinations: [...dest.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
        .map(([n, count]) => ({ name: nameOf(inputs.i18n, sysKey, n), count })),
      rows: rs.map(r => {
        const f = fin(r);
        return { depSec: r.sec, dep: fmtTime(r.sec), train: r.train, type: f.typeInfo, to: nameOf(inputs.i18n, sysKey, r.to),
                 run: f.run, label: runLabel(f.run, cal) };
      }),
    };
  });
  directions.sort(dirOrder);

  const arrivals = [...arr.values()].sort((a, b) => a.sec - b.sec || cmp(a.train, b.train) || cmp(a.from, b.from)).map(r => {
    const f = fin(r);
    return { arrSec: r.sec, arr: fmtTime(r.sec), train: r.train, type: f.typeInfo, from: nameOf(inputs.i18n, sysKey, r.from),
             run: f.run, label: runLabel(f.run, cal) };
  });

  const perDay = dates.map(d => {
    const departing = directions.reduce((n, g) => n + g.rows.filter(r => r.run.includes(d)).length, 0);
    const terminating = arrivals.filter(r => r.run.includes(d)).length;
    return { date: d, weekday: cal.wd[d], md: { zh: mdLabel(cal, d, 'zh'), en: mdLabel(cal, d, 'en'), ja: mdLabel(cal, d, 'ja') },
             departing, terminating, stopping: departing + terminating };
  });

  return { system, station, dateRange: [...ds.dateRange], dates, offDates: [...cal.off].sort(), perDay, directions, arrivals };
}

// ── 台鐵 ─────────────────────────────────────────────────────────────────────
export function traStationTimetable(stationName, inputs) {
  const { tra, i18n } = inputs;
  const stopsOf = tr => (typeof tr.stops === 'string' ? JSON.parse(tr.stops) : tr.stops);
  const occ = (tr, name) => {
    const st = stopsOf(tr);
    const stopped = [];
    st.forEach((p, k) => { if (p.stop) stopped.push(k); });
    const firstK = stopped[0], lastK = stopped[stopped.length - 1], out = [];
    for (const k of stopped) {
      if (st[k].name !== name) continue;
      if (k === lastK) out.push({ terminating: true, sec: st[k].arrSec, from: st[firstK].name });
      else out.push({ terminating: false, sec: st[k].depSec, to: st[lastK].name, next: st[k + 1].name });
    }
    return out;
  };
  return assemble({
    system: 'TRA', station: nameOf(i18n, 'tra_sched', stationName), stationName, ds: tra, inputs, sysKey: 'tra_sched', occ,
    dirOf: o => o.next,
    dirMeta: key => ({ next: nameOf(i18n, 'tra_sched', key, true), label: null, endpoint: null }),
    dirOrder: (a, b) => b.count - a.count || cmp(a.key, b.key),
  });
}

// ── 高鐵 ─────────────────────────────────────────────────────────────────────
export function thsrStationTimetable(stationName, inputs) {
  const { thsr, i18n } = inputs;
  const pos = n => {
    const p = THSR_ORDER.indexOf(n);
    if (p < 0) throw new Error(`THSR 站名不在沿線站序內:「${n}」`);
    return p;
  };
  const here = pos(stationName);
  const occ = (tr, name) => {
    const st = tr.stops;
    for (const s of st) pos(s.name);                     // 沿線站序不認得的站名一律 throw(將來加站要先改 THSR_ORDER)
    const k = st.findIndex(s => s.name === name);
    if (k < 0) return [];
    if (k === st.length - 1) return [{ terminating: true, sec: st[k].arrSec, from: st[0].name }];
    return [{ terminating: false, sec: st[k].depSec, to: st[st.length - 1].name, dir: pos(st[k + 1].name) > here ? 'south' : 'north' }];
  };
  const DIRS = {
    south: { label: { zh: '南下', en: 'Southbound', ja: '南下' }, endpoint: '左營' },
    north: { label: { zh: '北上', en: 'Northbound', ja: '北上' }, endpoint: '南港' },
  };
  return assemble({
    system: 'THSR', station: nameOf(i18n, 'thsr_sched', stationName), stationName, ds: thsr, inputs, sysKey: 'thsr_sched', defaultType: '高鐵', occ,
    dirOf: o => o.dir,
    dirMeta: key => ({ next: null, label: DIRS[key].label, endpoint: nameOf(i18n, 'thsr_sched', DIRS[key].endpoint) }),
    dirOrder: (a, b) => (a.key === 'south' ? -1 : 1) - (b.key === 'south' ? -1 : 1),
  });
}
