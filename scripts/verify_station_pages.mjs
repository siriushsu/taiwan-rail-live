#!/usr/bin/env node
// 車站時刻頁（SEO 階段 B，2026-09-30）的靜態驗收：stations／en/stations／ja/stations 的台鐵、高鐵逐班時刻段。
// 不開瀏覽器。頁面每週隨 `npm run fetch-schedule` 重產，沒有人逐頁看，所以這支要能「資料或程式一改壞就紅、
// 而且紅在指名的那一條」。
//
// 獨立性（這支閘門最重要的性質）：
//   期望值一律從原始資料自己算（data/tra_schedule_dense.json、scripts/seo_data/thsr_timetable.json、
//   data/tw_daytype.json、data/holiday_names.json、i18n/stations.json、data/station_transfers.json），
//   頁面的真相一律從產出的 HTML 解析。**不 import、也不複製** scripts/station_timetable.mjs 與
//   scripts/build_aeo_pages.mjs 的邏輯——閘門與實作同源時，「相等」是零資訊。
//   只有兩處讀了它們的「資料」而非「邏輯」：
//     · build_aeo_pages.mjs 的 stations 陣列裡每站的 slug／members 常數（哪一站有哪些台鐵／高鐵成員）；
//     · station_timetable.mjs 檔頭註解裡的三語行駛日標籤語法（那是規格）。
//
// 九條閘門（失敗訊息一律以 [G<n>] 開頭）：
//   G1 班次完整      每站每方向：頁面列數＝原始資料數出的不重複（車次、floor(開車秒/60)、終點）列數——一列的身分以「分」為單位，
//                    逐列比時刻／車次／終點／車種；
//                    到站表同理；表內時間遞增；小標與導言的班數＝列數
//   G2 行駛日可逆    自己寫解析器，把頁面標籤展開回日期集合，必須等於該列實際行駛日；三語都驗；日期註記（放假）也驗
//   G3 每天班數      事實表每天開出班數＝原始資料算出的值；放假日標記＝tw_daytype
//   G4 方向          頁面的方向集合＝資料的方向集合；中途站兩向都有、始發／終點站只有一向；具名案例：
//                    台北（台鐵兩向）、左營高鐵（只有北上）、台中高鐵（兩向）
//   G5 捨去          頁面時刻＝floor(秒/60)，不是四捨五入；指名一班秒數 %60 ≥ 30 的當正向對照（找不到就紅）
//   G6 三語          英文頁不含中日文字；站名／車種／終點取 i18n/stations.json 的該語系值
//   G7 不斷言公開    沿用 verify_metro_pages.mjs 的 NO_PUBLISH_CLAIM，車站頁不得命中
//   G8 覆蓋率        印出並斷言 站 × 語 × 段 × 列；--all 時站數必須 23、語言必須 3；驗到的列數必須等於原始資料算出的總列數
//   G9 資料窗        頁面寫的資料涵蓋區間＝各資料檔的 dateRange（台鐵 dense／高鐵 seo_data，不是 availableRange）
//
// 用法：node scripts/verify_station_pages.mjs [--all] [--sample=<N>] [--seed=<字串>] [--quiet]
//   預設：具名案例三站（taipei、zuoying、taichung-hsr）＋隨機 N 站（預設 3，seed 一定會印出來，失敗時原樣重跑）。
//   --all：23 站 × 3 語全量。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const rdText = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const opt = { all: false, sample: 3, seed: null, quiet: false };
for (const a of process.argv.slice(2)) {
  if (a === '--all') opt.all = true;
  else if (a === '--quiet') opt.quiet = true;
  else if (a.startsWith('--seed=')) opt.seed = a.slice(7);
  else if (a.startsWith('--sample=')) opt.sample = Number(a.slice(9));
  else { console.error(`未知參數：${a}`); process.exit(2); }
}
if (!Number.isInteger(opt.sample) || opt.sample < 0) { console.error('--sample 要是非負整數'); process.exit(2); }

const LANGS = ['zh', 'en', 'ja'];
const PAGE_DIR = { zh: 'stations', en: 'en/stations', ja: 'ja/stations' };
const EXPECT_STATIONS = 23;   // 計畫的第一批：23 站（含只有捷運的美麗島）
const EXPECT_LANGS = 3;
const NAMED = ['taipei', 'zuoying', 'taichung-hsr'];
const THSR_ORDER = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];   // 沿線站序（北→南），真實世界事實
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = { zh: ['一', '二', '三', '四', '五', '六', '日'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ja: ['月', '火', '水', '木', '金', '土', '日'] };
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

// ───────────────────────── 失敗登記 ─────────────────────────
const GATE_NAME = { 1: '班次完整', 2: '行駛日可逆', 3: '每天班數', 4: '方向', 5: '捨去到分', 6: '三語', 7: '不斷言公開', 8: '覆蓋率', 9: '資料窗' };
const gate = {};
for (const n of Object.keys(GATE_NAME)) gate[n] = { checks: 0, fails: [] };
function ok(g, cond, msg, detail = '') {
  gate[g].checks++;
  if (!cond) gate[g].fails.push(`[G${g}] ${msg}${detail ? `：${detail}` : ''}`);
  return !!cond;
}
const log = m => { if (!opt.quiet) console.log(m); };

// ───────────────────────── 原始資料 ─────────────────────────
const tra = rd('data/tra_schedule_dense.json');
const thsr = rd('scripts/seo_data/thsr_timetable.json');
const daytype = rd('data/tw_daytype.json');
const holidayNames = rd('data/holiday_names.json');
const i18n = rd('i18n/stations.json');
const transfers = rd('data/station_transfers.json');

const pad2 = n => String(n).padStart(2, '0');
const isoWeekday = iso => { const [y, m, d] = iso.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };   // 0=週一…6=週日
const isHoliday = iso => daytype[iso] === 1 || (isoWeekday(iso) >= 5 && daytype[iso] !== 0);   // 週末預設放假，除非標 0＝補班
const holidayNote = (iso, lang) => {   // 註記只加在放假日；週末沒有節日名就不註記
  if (!isHoliday(iso)) return null;
  const name = holidayNames[iso];
  if (lang === 'zh') return name || (isoWeekday(iso) < 5 ? '放假' : null);
  return (name || isoWeekday(iso) < 5) ? (lang === 'en' ? 'holiday' : '休日') : null;
};

const DS = {
  TRA: { data: tra, dates: Object.keys(tra.dates).sort(), file: 'data/tra_schedule_dense.json' },
  THSR: { data: thsr, dates: Object.keys(thsr.dates).sort(), file: 'scripts/seo_data/thsr_timetable.json' },
};
for (const s of Object.values(DS)) s.range = s.data.dateRange;

// 站與成員：build_aeo_pages.mjs 的 stations 陣列常數（只讀資料，不 import）
const buildSrc = rdText('scripts/build_aeo_pages.mjs');
const STATIONS = [];
for (const m of buildSrc.matchAll(/slug:\s*'([^']+)'[\s\S]{0,600}?members:\s*\[([^\]]*)\]/g)) {
  STATIONS.push({ slug: m[1], members: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) });
}

// NO_PUBLISH_CLAIM：從 verify_metro_pages.mjs 原始碼抽出字面量（該檔沒 export，import 會跑整支驗收）
function loadNoPublishClaim() {
  const src = rdText('scripts/verify_metro_pages.mjs');
  const i = src.indexOf('const NO_PUBLISH_CLAIM = {');
  if (i < 0) throw new Error('verify_metro_pages.mjs 找不到 NO_PUBLISH_CLAIM');
  const j = src.indexOf('\n};', i);
  return new Function(`"use strict";return (${src.slice(i + 'const NO_PUBLISH_CLAIM = '.length, j + 2)})`)();
}
const NO_PUBLISH_CLAIM = loadNoPublishClaim();

// ───────────────────────── 期望值：從原始資料自己算 ─────────────────────────
function tr(lang, kind, zhName, sys) {   // kind: 'station'（sys 必給）| 'type'
  if (lang === 'zh') return zhName;
  const rec = kind === 'type' ? i18n.trainTypes[zhName] : i18n.systems[sys === 'TRA' ? 'tra_sched' : 'thsr_sched'][zhName];
  if (!rec || !rec[lang]) return null;
  return (W_NAME[lang] || {})[rec[lang]] ?? rec[lang];
}
const revCache = {};
function revStation(lang, sys, text) {   // 該語系的站名文字 → 官方（中文）站名
  const k = `${lang}|${sys}`;
  if (!revCache[k]) {
    revCache[k] = new Map();
    for (const [zh, rec] of Object.entries(i18n.systems[sys === 'TRA' ? 'tra_sched' : 'thsr_sched'])) revCache[k].set(lang === 'zh' ? zh : rec[lang], zh);
    if (lang === 'zh') for (const zh of Object.keys(i18n.systems[sys === 'TRA' ? 'tra_sched' : 'thsr_sched'])) revCache[k].set(zh, zh);
  }
  return revCache[k].get(text) ?? null;
}
const timeParts = sec => ({ hh: Math.floor(sec / 3600) % 24, mm: Math.floor((sec % 3600) / 60), nd: sec >= 86400 });
const floorText = sec => { const t = timeParts(sec); return `${pad2(t.hh)}:${pad2(t.mm)}${t.nd ? '+1' : ''}`; };
const roundText = sec => floorText(Math.round(sec / 60) * 60);

// 一列的身分是（車次、floor(本站開車秒/60)、終點）——以「分」為單位，不是秒（規格，主對話 2026-09-30 訂正）。
// 同車次改點前後只差幾秒、捨去到分後同一分鐘的，必須併成一列（行駛日取聯集）；否則頁面會出現顯示上一模一樣的兩列。
const mergeMin = sec => Math.floor(sec / 60);

// 某系統某站的期望結構：dirs（方向 → 列）、arrivals（到站列）、perDay（每天開出班數）
function buildExpected(sys, stationName) {
  const { data, dates } = DS[sys];
  const dirs = new Map(); const arrivals = new Map();
  const perDayKeys = new Map(dates.map(d => [d, new Set()]));
  const perDayOcc = new Map(dates.map(d => [d, 0]));
  const anomalies = [];
  const isStop = s => s.stop !== false;
  for (const date of dates) {
    for (const idx of data.dates[date]) {
      const t = data.trains[idx];
      const st = t.stops;
      let first = -1, last = -1;
      for (let i = 0; i < st.length; i++) if (isStop(st[i])) { if (first < 0) first = i; last = i; }
      for (let i = 0; i < st.length; i++) {
        if (st[i].name !== stationName || !isStop(st[i])) continue;
        if (i === last && i !== first) {   // 本站是終點：到站
          const sec = st[i].arrSec, from = st[first].name;
          if (sec >= 172800) anomalies.push(`到站秒數 ≥172800：${t.train}`);
          const key = `${t.train}|${mergeMin(sec)}|${from}`;
          if (!arrivals.has(key)) arrivals.set(key, { train: t.train, sec, secs: new Set(), other: from, types: new Set(), dates: new Set() });
          const r = arrivals.get(key); r.types.add(t.typeName || '高鐵'); r.dates.add(date); r.secs.add(sec);
        } else {   // 開出（含始發）
          const sec = st[i].depSec, dest = st[last].name;
          if (sec >= 172800) anomalies.push(`開車秒數 ≥172800：${t.train}`);
          let dirKey;
          if (sys === 'TRA') dirKey = st[i + 1].name;
          else {
            const a = THSR_ORDER.indexOf(stationName), b = THSR_ORDER.indexOf(st[i + 1].name);
            if (a < 0 || b < 0) throw new Error(`高鐵站序表沒有 ${stationName} 或 ${st[i + 1].name}`);
            dirKey = b > a ? 'south' : 'north';
          }
          if (!dirs.has(dirKey)) dirs.set(dirKey, new Map());
          const key = `${t.train}|${mergeMin(sec)}|${dest}`;
          const m = dirs.get(dirKey);
          if (!m.has(key)) m.set(key, { train: t.train, sec, secs: new Set(), other: dest, types: new Set(), dates: new Set(), dirKey });
          const r = m.get(key); r.types.add(t.typeName || '高鐵'); r.dates.add(date); r.secs.add(sec);
          perDayKeys.get(date).add(`${dirKey}|${key}`);
          perDayOcc.set(date, perDayOcc.get(date) + 1);
        }
      }
    }
  }
  const dirList = [...dirs.entries()].map(([key, m]) => ({ key, rows: [...m.values()] }));
  for (const d of dates) if (perDayKeys.get(d).size !== perDayOcc.get(d)) anomalies.push(`${d} 開出班數 由列數(${perDayKeys.get(d).size})與班次出現次數(${perDayOcc.get(d)})不同`);
  return {
    sys, stationName, dirs: dirList, arrivals: [...arrivals.values()],
    perDay: new Map(dates.map(d => [d, perDayKeys.get(d).size])), anomalies,
    rowCount: dirList.reduce((n, d) => n + d.rows.length, 0) + arrivals.size,
    sectionCount: dirList.length + (arrivals.size ? 1 : 0),
  };
}

function memberInfo(member) {   // 'TRA:1000' → {sys, code, name}
  const [sys, code] = member.split(':');
  if (sys !== 'TRA' && sys !== 'THSR') return null;
  const rec = transfers.stations[member];
  if (!rec) throw new Error(`station_transfers.json 沒有 ${member}`);
  return { sys, code, name: rec.name, member };
}

// ───────────────────────── 頁面解析 ─────────────────────────
const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = s => decode(s.replace(/<[^>]*>/g, ''));

function parsePage(html) {
  // 表格元素上的 ARIA role（role="row" 等，手機版讓讀屏保留表格語意用）與時刻內容無關，解析前先剝掉，下面的結構正規式維持原樣。
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [''])[0].replace(/ role="[^"]*"/g, '');
  const sections = [];
  for (const m of main.matchAll(/<section class="content-section tt" id="([a-z]+)-([0-9A-Za-z]+)">([\s\S]*?)<\/section>/g)) {
    const body = m[3];
    const sec = {
      sys: m[1] === 'tra' ? 'TRA' : m[1] === 'thsr' ? 'THSR' : m[1], code: m[2], id: `${m[1]}-${m[2]}`,
      h2: strip((body.match(/<h2>([\s\S]*?)<\/h2>/) || [, ''])[1]),
      intro: strip((body.match(/<p class="section-intro">([\s\S]*?)<\/p>/) || [, ''])[1]),
      text: strip(body), blocks: [],
    };
    for (const chunk of body.split('<div class="dir-block">').slice(1)) {
      const h3 = chunk.match(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/);
      const sub = h3 ? (h3[2].match(/<span class="dir-sub">([\s\S]*?)<\/span>/) || [, ''])[1] : '';
      const blk = {
        id: h3 ? h3[1] : '', title: h3 ? strip(h3[2].replace(/<span class="dir-sub">[\s\S]*?<\/span>/, '')) : '', sub: strip(sub),
        cols: [...chunk.matchAll(/<th scope="col">([\s\S]*?)<\/th>/g)].map(x => strip(x[1])), rows: [],
        trCount: (chunk.match(/<tbody>[\s\S]*?<\/tbody>/) || [''])[0].split('<tr').length - 1,
      };
      for (const r of chunk.matchAll(/<tr(?: class="([^"]*)")?><th scope="row" class="t">([\s\S]*?)<\/th><td class="c-train">([\s\S]*?)(?:<small class="car">([\s\S]*?)<\/small>)?<\/td><td class="c-(to|from)">([\s\S]*?)<\/td><td class="c-run">([\s\S]*?)<\/td><\/tr>/g)) {
        const tm = r[2].match(/^(\d\d):(\d\d)(<sup class="nd">\+1<\/sup>)?$/);
        blk.rows.push({
          special: /\bspecial\b/.test(r[1] || ''), timeRaw: strip(r[2]),
          timeText: tm ? `${tm[1]}:${tm[2]}${tm[3] ? '+1' : ''}` : null,
          sec: tm ? (+tm[1]) * 3600 + (+tm[2]) * 60 + (tm[3] ? 86400 : 0) : null,
          train: strip(r[3]), type: strip(r[4] || ''), other: strip(r[6]), run: strip(r[7]),
        });
      }
      sec.blocks.push(blk);
    }
    sections.push(sec);
  }
  // 事實表
  const facts = new Map();
  for (const m of main.matchAll(/<div class="fact-row"><div class="fact-label">([\s\S]*?)<\/div><div class="fact-value">([\s\S]*?)<\/div><\/div>/g)) facts.set(strip(m[1]), m[2]);
  return { main, mainText: strip(main), sections, facts };
}

// ───────────────────────── 行駛日標籤：展開回日期集合 ─────────────────────────
function makeCal(dates) {
  const set = new Set(dates);
  const byMd = new Map(dates.map(d => [`${+d.slice(5, 7)}/${+d.slice(8, 10)}`, d]));
  return { dates, set, byMd, first: dates[0], last: dates[dates.length - 1] };
}
const DATE_RE = {   // (月, 日, 註記)
  zh: /^(\d+)\/(\d+)(?:（([^）]+)）)?$/,
  en: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+)(?: \(([^)]+)\))?$/,
  ja: /^(\d+)月(\d+)日(?:（([^）]+)）)?$/,
};
function parseDateTok(lang, tok, cal, errs) {
  const m = tok.match(DATE_RE[lang]);
  if (!m) { errs.push(`日期寫法解析不了「${tok}」`); return null; }
  const mon = lang === 'en' ? MON_EN.indexOf(m[1]) + 1 : +m[1];
  const iso = cal.byMd.get(`${mon}/${+m[2]}`);
  if (!iso) { errs.push(`日期 ${mon}/${m[2]} 不在資料涵蓋區間`); return null; }
  const want = holidayNote(iso, lang);
  const got = m[3] || null;
  if (want !== got) errs.push(`${iso} 的註記應為${want ? `「${want}」` : '（無）'}、頁面是${got ? `「${got}」` : '（無）'}`);
  return iso;
}
const SEP = { zh: '、', en: ', ', ja: '、' };
function parseDateList(lang, str, cal, errs) { return str.split(SEP[lang]).map(t => parseDateTok(lang, t.trim(), cal, errs)).filter(Boolean); }
function parseWeekdayBody(lang, body, errs) {   // → Set(dow 0..6)
  const set = new Set();
  const sep = lang === 'zh' ? '、' : lang === 'en' ? ', ' : '・';
  const one = lang === 'zh' ? /^週([一二三四五六日])$/ : lang === 'en' ? /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ : /^([月火水木金土日])曜?$/;   // ja：「金」「金曜」都收
  const range = lang === 'zh' ? /^週([一二三四五六日])至週([一二三四五六日])$/ : lang === 'en' ? /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)–(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ : /^([月火水木金土日])曜?〜([月火水木金土日])曜?$/;
  for (const part of body.split(sep)) {
    let m;
    if ((m = part.match(one))) set.add(WD[lang].indexOf(m[1]));
    else if ((m = part.match(range))) {
      const a = WD[lang].indexOf(m[1]), b = WD[lang].indexOf(m[2]);
      if (b - a < 2) errs.push(`星期幾範圍「${part}」不足 3 個連續星期幾（規格：≥3 個才用至）`);
      for (let k = a; k <= b; k++) set.add(k);
    } else errs.push(`星期幾寫法解析不了「${part}」`);
  }
  return set;
}
// 回傳 { set: Set(iso), errs: [...] }
function decodeLabel(lang, text, cal) {
  const errs = []; const D = cal.dates;
  const all = () => new Set(D);
  const between = (a, b) => new Set(D.filter(d => d >= a && d <= b));
  let m;
  const T = { zh: '(\\d+/\\d+(?:（[^）]+）)?)', en: '((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d+(?: \\([^)]+\\))?)', ja: '(\\d+月\\d+日(?:（[^）]+）)?)' }[lang];
  const one = s => parseDateTok(lang, s, cal, errs);
  if (lang === 'zh') {
    if (text === '每日') return { set: all(), errs };
    if (text === '上班日（放假日不開）') return { set: new Set(D.filter(d => !isHoliday(d))), errs };
    if (text === '週末與放假日') return { set: new Set(D.filter(d => isHoliday(d))), errs };
    if ((m = text.match(new RegExp(`^${T} 起每日$`)))) return { set: between(one(m[1]) || '', cal.last), errs };
    if ((m = text.match(new RegExp(`^${T} 以前每日$`)))) return { set: between(cal.first, one(m[1]) || ''), errs };
    if ((m = text.match(new RegExp(`^${T}[–—-]${T} 每日$`)))) return { set: between(one(m[1]) || '', one(m[2]) || ''), errs };
    if ((m = text.match(/^僅 (.+)$/))) return { set: new Set(parseDateList(lang, m[1], cal, errs)), errs };
    if ((m = text.match(/^(週[^，；]+)(?:，另 ([^；]+))?(?:；(.+) 不開)?$/))) return finishWeekdays(lang, m[1], m[2], m[3], cal, errs);
  } else if (lang === 'en') {
    if (text === 'Daily') return { set: all(), errs };
    if (text === 'Working days') return { set: new Set(D.filter(d => !isHoliday(d))), errs };
    if (text === 'Weekends and holidays') return { set: new Set(D.filter(d => isHoliday(d))), errs };
    if ((m = text.match(new RegExp(`^Daily from ${T}$`)))) return { set: between(one(m[1]) || '', cal.last), errs };
    if ((m = text.match(new RegExp(`^Daily through ${T}$`)))) return { set: between(cal.first, one(m[1]) || ''), errs };
    if ((m = text.match(new RegExp(`^Daily ${T}[–—-]${T}$`)))) return { set: between(one(m[1]) || '', one(m[2]) || ''), errs };
    if ((m = text.match(/^Only (.+)$/))) return { set: new Set(parseDateList(lang, m[1], cal, errs)), errs };
    if ((m = text.match(/^((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^;]*?)(?:, plus ([^;]+))?(?:; not on (.+))?$/))) return finishWeekdays(lang, m[1], m[2], m[3], cal, errs);
  } else {
    if (text === '毎日') return { set: all(), errs };
    if (text === '平日（休日は運休）') return { set: new Set(D.filter(d => !isHoliday(d))), errs };
    if (text === '土日・休日') return { set: new Set(D.filter(d => isHoliday(d))), errs };
    if ((m = text.match(new RegExp(`^${T}から毎日$`)))) return { set: between(one(m[1]) || '', cal.last), errs };
    if ((m = text.match(new RegExp(`^${T}まで毎日$`)))) return { set: between(cal.first, one(m[1]) || ''), errs };
    if ((m = text.match(new RegExp(`^${T}〜${T} 毎日$`)))) return { set: between(one(m[1]) || '', one(m[2]) || ''), errs };
    if ((m = text.match(/^(.+)のみ$/))) return { set: new Set(parseDateList(lang, m[1], cal, errs)), errs };
    if ((m = text.match(/^([月火水木金土日][^、；]*?)(?:、ほか([^；]+))?(?:；(.+)は運休)?$/))) return finishWeekdays(lang, m[1], m[2], m[3], cal, errs);
  }
  errs.push(`標籤不符任何規格語法「${text}」`);
  return { set: new Set(), errs };
}
function finishWeekdays(lang, body, extras, missing, cal, errs) {
  const W = parseWeekdayBody(lang, body, errs);
  const set = new Set(cal.dates.filter(d => W.has(isoWeekday(d))));
  for (const iso of extras ? parseDateList(lang, extras, cal, errs) : []) {
    if (W.has(isoWeekday(iso))) errs.push(`例外日 ${iso} 的星期幾已在歸納內（規格：例外日的星期幾不在歸納內）`);
    set.add(iso);
  }
  for (const iso of missing ? parseDateList(lang, missing, cal, errs) : []) {
    if (!W.has(isoWeekday(iso))) errs.push(`缺席日 ${iso} 的星期幾不在歸納內`);
    set.delete(iso);
  }
  return { set, errs };
}
const mdList = set => [...set].sort().map(d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`).join(',');

// ───────────────────────── 頁面文字（每語系一組，這是頁面的措辭，不是產生器邏輯）─────────────────────────
const W_ = {
  zh: {
    period: '時刻表涵蓋區間', perDay: '每天開出班數', sysWord: { TRA: '台鐵', THSR: '高鐵' },
    range: /(\d+)\/(\d+)（(.)）至 (\d+)\/(\d+)（(.)）/,
    depN: /開出 (\d+) 個班次/, arrN: /以本站為終點的 (\d+) 班/, subN: /(\d+) 班/,
    dayLabel: /^(\d+)\/(\d+) 週(.)(?:（(.+)）)?$/,
    south: /^南下/, north: /^北上/,
  },
  en: {
    period: 'Timetable period', perDay: 'Departures per day', sysWord: { TRA: 'TRA', THSR: 'HSR' },
    range: /(?:From )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+) \((...)\) to (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+) \((...)\)/,
    depN: /there (?:is|are) (\d+) distinct (?:TRA|HSR) departures?/, arrN: /trains that end here \((\d+)\)/, subN: /(\d+) trains?/,
    dayLabel: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+) (Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?: \((.+)\))?$/,
    south: /^Southbound/, north: /^Northbound/,
  },
  ja: {
    period: '時刻表の対象期間', perDay: '1日の発車本数', sysWord: { TRA: '台鉄', THSR: '高鉄' },
    range: /(\d+)月(\d+)日（(.)）〜(\d+)月(\d+)日（(.)）/,
    depN: /発車する(?:台鉄|高鉄)は.*?合計(\d+)本/, arrN: /終点の列車（(\d+)本）/, subN: /(\d+)本/,
    dayLabel: /^(\d+)月(\d+)日 (.)曜(?:（(.+)）)?$/,
    south: /^南下/, north: /^北上/,
  },
};
// 頁面顯示的站名與字典值不同的少數幾個（字典 en 帶底線，頁面顯示成括號寫法；docs/i18n/tra_station_names.json _caveats 的建議）
const W_NAME = { en: { Zhongli_Taoyuan: 'Zhongli (Taoyuan)', Zhongli_Yilan: 'Zhongli (Yilan)' } };
const rangeParts = (lang, m) => {   // → {a:{mon,day,wd}, b:{...}}
  const mon = x => (lang === 'en' ? MON_EN.indexOf(x) + 1 : +x);
  return { a: { mon: mon(m[1]), day: +m[2], wd: m[3] }, b: { mon: mon(m[4]), day: +m[5], wd: m[6] } };
};

// ───────────────────────── 逐站逐語驗證 ─────────────────────────
const cov = Object.fromEntries(LANGS.map(l => [l, { stations: 0, sections: 0, rows: 0, rowsMatched: 0, expSections: 0, expRows: 0 }]));
const named = { taipeiTraDirs: null, zuoyingThsr: null, taichungThsr: null };
let g5Example = null;
const notes = [];

function verifyStation(st, lang, page, members, expByMember) {
  const tag = `${lang} ${st.slug}`;
  const c = cov[lang];
  c.stations++;
  const cal = { TRA: makeCal(DS.TRA.dates), THSR: makeCal(DS.THSR.dates) };
  const hasTt = members.length > 0;
  // 沒有台鐵／高鐵成員的站（美麗島）：不得出現時刻段
  if (!hasTt) {
    ok(1, page.sections.length === 0, `${tag} 只有捷運，不應有台鐵／高鐵時刻段`, `找到 ${page.sections.length} 段`);
    return;
  }
  // 段落集合＝成員集合
  const expIds = new Set(members.map(m => `${m.sys === 'TRA' ? 'tra' : 'thsr'}-${m.code}`));
  const gotIds = page.sections.map(s => s.id);
  for (const id of expIds) ok(1, gotIds.includes(id), `${tag} 缺時刻段 ${id}`);
  for (const id of gotIds) ok(1, expIds.has(id), `${tag} 多出不屬於本站成員的時刻段 ${id}`);
  ok(1, new Set(gotIds).size === gotIds.length, `${tag} 時刻段 id 重複`, gotIds.join(','));

  // 事實表：資料窗
  const periodHtml = page.facts.get(W_[lang].period);
  ok(9, periodHtml !== undefined, `${tag} 事實表沒有「${W_[lang].period}」列`);
  const periodText = periodHtml === undefined ? '' : strip(periodHtml);
  const factRanges = {};
  for (const m of periodText.matchAll(new RegExp(W_[lang].range.source, 'g'))) {
    const before = periodText.slice(0, m.index);
    let sys = null, pos = -1;
    for (const [s, w] of Object.entries(W_[lang].sysWord)) { const p = before.lastIndexOf(w); if (p > pos) { pos = p; sys = s; } }
    if (sys) factRanges[sys] = rangeParts(lang, m);
  }
  const memberSystems = new Set(members.map(m => m.sys));
  for (const sys of ['TRA', 'THSR']) {
    ok(9, memberSystems.has(sys) === (sys in factRanges), `${tag} 事實表的涵蓋區間系統集合與成員不符`, `${sys}：成員${memberSystems.has(sys) ? '有' : '無'}、事實表${sys in factRanges ? '有' : '無'}`);
  }
  const checkRange = (label, r, sys) => {
    const [d0, d1] = DS[sys].range;
    for (const [end, iso] of [['a', d0], ['b', d1]]) {
      const okMd = r[end].mon === +iso.slice(5, 7) && r[end].day === +iso.slice(8, 10);
      ok(9, okMd, `${tag} ${label} ${sys} 涵蓋區間${end === 'a' ? '起' : '迄'}日與資料檔 dateRange 不符`, `頁面 ${r[end].mon}/${r[end].day}、資料檔 ${iso}（${DS[sys].file}）`);
      ok(9, r[end].wd === WD[lang][isoWeekday(iso)], `${tag} ${label} ${sys} 涵蓋區間${end === 'a' ? '起' : '迄'}日的星期標記不符`, `頁面「${r[end].wd}」、應為「${WD[lang][isoWeekday(iso)]}」`);
    }
  };
  for (const sys of Object.keys(factRanges)) checkRange('事實表', factRanges[sys], sys);

  // 每天班數
  const dcHtml = page.facts.get(W_[lang].perDay);
  ok(3, dcHtml !== undefined, `${tag} 事實表沒有「${W_[lang].perDay}」列`);
  const dcGroups = [];
  for (const m of (dcHtml || '').matchAll(/<p class="dc-title">([\s\S]*?)<\/p><ul class="day-counts">([\s\S]*?)<\/ul>/g)) {
    dcGroups.push({ title: strip(m[1]), items: [...m[2].matchAll(/<li( class="off")?><span>([\s\S]*?)<\/span><b>(\d+)<\/b><\/li>/g)].map(x => ({ off: !!x[1], label: strip(x[2]), n: +x[3] })), liCount: m[2].split('<li').length - 1 });
  }
  ok(3, dcGroups.length === members.length, `${tag} 每天開出班數的分組數應等於成員數`, `頁面 ${dcGroups.length}、成員 ${members.length}`);

  for (const mem of members) {
    const exp = expByMember.get(mem.member);
    const secId = `${mem.sys === 'TRA' ? 'tra' : 'thsr'}-${mem.code}`;
    const sec = page.sections.find(s => s.id === secId);
    const stTag = `${tag} ${mem.sys}:${mem.code}（${mem.name}）`;
    const C = cal[mem.sys];
    const nameL = tr(lang, 'station', mem.name, mem.sys);
    ok(6, nameL !== null, `${stTag} i18n/stations.json 缺「${mem.name}」的 ${lang} 站名`);

    // G3：每天班數
    const sysW = W_[lang].sysWord[mem.sys];
    const grp = dcGroups.filter(g => g.title.includes(sysW) && nameL && g.title.includes(nameL));
    if (ok(3, grp.length === 1, `${stTag} 每天開出班數應恰有一組（標題含「${sysW}」與站名「${nameL}」）`, `找到 ${grp.length} 組`)) {
      const g = grp[0];
      ok(3, g.items.length === C.dates.length && g.liCount === C.dates.length, `${stTag} 每天開出班數的天數應＝資料涵蓋天數`, `頁面 ${g.items.length}、資料 ${C.dates.length}`);
      for (let k = 0; k < Math.min(g.items.length, C.dates.length); k++) {
        const it = g.items[k], iso = C.dates[k];
        const m = it.label.match(W_[lang].dayLabel);
        if (!ok(3, !!m, `${stTag} 每天班數的日期標籤解析不了`, `「${it.label}」`)) continue;
        const mon = lang === 'en' ? MON_EN.indexOf(m[1]) + 1 : +m[1];
        const [monP, dayP, wdP, noteP] = lang === 'zh' ? [+m[1], +m[2], m[3], m[4]] : lang === 'en' ? [mon, +m[2], m[3], m[4]] : [+m[1], +m[2], m[3], m[4]];
        ok(3, monP === +iso.slice(5, 7) && dayP === +iso.slice(8, 10), `${stTag} 每天班數第 ${k + 1} 天的日期應為 ${iso}`, `頁面「${it.label}」`);
        ok(3, wdP === WD[lang][isoWeekday(iso)], `${stTag} ${iso} 的星期標記不符`, `頁面「${wdP}」、應為「${WD[lang][isoWeekday(iso)]}」`);
        ok(3, it.n === exp.perDay.get(iso), `${stTag} ${iso} 每天開出班數不符`, `頁面 ${it.n}、原始資料 ${exp.perDay.get(iso)}`);
        ok(3, it.off === isHoliday(iso), `${stTag} ${iso} 放假日標記（off）不符 tw_daytype`, `頁面 off=${it.off}、資料 ${isHoliday(iso)}`);
        const wantNote = holidayNote(iso, lang);
        ok(3, (noteP || null) === wantNote, `${stTag} ${iso} 的放假註記不符`, `頁面「${noteP || ''}」、應為「${wantNote || ''}」`);
      }
    }

    if (!sec) continue;   // 缺段已在上面記為 G1 失敗
    // G9：段落導言的資料窗
    const rm = sec.intro.match(W_[lang].range);
    if (ok(9, !!rm, `${stTag} 導言解析不到日期區間`, sec.intro.slice(0, 60))) checkRange('段落導言', rangeParts(lang, rm), mem.sys);

    // G1：導言班數
    const expDep = exp.dirs.reduce((n, d) => n + d.rows.length, 0);
    const dn = sec.intro.match(W_[lang].depN), an = sec.intro.match(W_[lang].arrN);
    ok(1, dn && +dn[1] === expDep, `${stTag} 導言的開出班數不符`, `頁面 ${dn ? dn[1] : '（解析不到）'}、原始資料 ${expDep}`);
    ok(1, exp.arrivals.length === 0 ? !an : an && +an[1] === exp.arrivals.length, `${stTag} 導言的到站班數不符`, `頁面 ${an ? an[1] : '（無）'}、原始資料 ${exp.arrivals.length}`);
    // G6：段落標題含該語系站名
    ok(6, nameL && sec.h2.includes(nameL), `${stTag} 段落標題應含站名「${nameL}」`, sec.h2);
    if (lang === 'en') ok(6, !CJK.test(sec.text), `${stTag} 英文時刻段不得含中日文字`, (sec.text.match(new RegExp(`.{0,12}${CJK.source}+.{0,12}`)) || [''])[0]);

    // 區塊分類
    const arrBlocks = sec.blocks.filter(b => b.id === `${secId}-arrivals`);
    const depBlocks = sec.blocks.filter(b => b.id !== `${secId}-arrivals`);
    ok(1, sec.blocks.length === depBlocks.length + arrBlocks.length && arrBlocks.length <= 1, `${stTag} 區塊 id 異常`, sec.blocks.map(b => b.id).join(','));
    ok(1, (exp.arrivals.length > 0) === (arrBlocks.length === 1), `${stTag} 到站表${exp.arrivals.length > 0 ? '缺' : '不該有'}`, `原始資料到站 ${exp.arrivals.length} 班`);
    c.expSections += exp.sectionCount; c.expRows += exp.rowCount;

    // 方向對應：以「方向裡的車次集合重疊」把頁面區塊配到期望方向（不依賴區塊順序或編號）
    const expDirs = exp.dirs.map(d => ({ ...d, trains: new Set(d.rows.map(r => r.train)) }));
    const assign = new Map();   // block → expected dir
    const taken = new Map();
    for (const b of depBlocks) {
      const trains = new Set(b.rows.map(r => r.train));
      let best = null, bestN = 0, tie = false;
      for (const d of expDirs) {
        let n = 0; for (const t of trains) if (d.trains.has(t)) n++;
        if (n > bestN) { best = d; bestN = n; tie = false; } else if (n === bestN && n > 0) tie = true;
      }
      if (best && !tie) {
        assign.set(b, best);
        taken.set(best.key, (taken.get(best.key) || 0) + 1);
      }
    }
    // G1：各方向表的列數合計＝資料的開出班數（整個方向的表不見時，逐列比對不會報，這裡要紅）
    const pageDepRows = depBlocks.reduce((n, b) => n + b.rows.length, 0);
    ok(1, pageDepRows === expDep, `${stTag} 各方向表的列數合計不符（可能整個方向的表不見了）`, `頁面 ${pageDepRows}、原始資料 ${expDep}${expDirs.filter(d => !taken.get(d.key)).map(d => `；方向「${d.key}」${d.rows.length} 列沒有對應的表`).join('')}`);
    // G4：方向集合＝資料的方向集合
    ok(4, depBlocks.length === expDirs.length, `${stTag} 方向數不符`, `頁面 ${depBlocks.length}、原始資料 ${expDirs.length}（${expDirs.map(d => d.key).join('、')}）`);
    for (const d of expDirs) ok(4, taken.get(d.key) === 1, `${stTag} 資料的方向「${d.key}」（${d.rows.length} 列）在頁面上應恰對應一個區塊`, `對應到 ${taken.get(d.key) || 0} 個`);
    if (mem.sys === 'THSR') {
      const st0 = THSR_ORDER.indexOf(mem.name);
      const wantKeys = [st0 < THSR_ORDER.length - 1 ? 'south' : null, st0 > 0 ? 'north' : null].filter(Boolean);
      ok(4, wantKeys.length === expDirs.length && wantKeys.every(k => expDirs.some(d => d.key === k)), `${stTag} 原始資料的方向集合與沿線站序推論不一致（資料或站序表有誤）`, `站序推論 ${wantKeys.join('、')}、資料 ${expDirs.map(d => d.key).join('、')}`);
      for (const b of depBlocks) {
        const suf = b.id.slice(secId.length + 1);
        const isS = suf === 'south', isN = suf === 'north';
        if (!ok(4, isS || isN, `${stTag} 高鐵方向區塊 id 應為 south／north`, b.id)) continue;
        ok(4, W_[lang][isS ? 'south' : 'north'].test(b.title), `${stTag} 「${suf}」區塊的標題方向字樣不符`, b.title);
        ok(4, wantKeys.includes(suf), `${stTag} ${mem.name} 站不應有${isS ? '南下' : '北上'}方向（始發／終點站只有一向）`);
        // 每一列的終點必須在該方向的正確一側（用 i18n 反查頁面文字對回官方站名，不靠 G1 的列配對）
        for (const r of b.rows) {
          const destZh = revStation(lang, 'THSR', r.other);
          if (!ok(4, destZh !== null, `${stTag} 「${suf}」區塊車次 ${r.train} 的終點「${r.other}」不是 i18n 裡的高鐵站名`)) continue;
          const side = THSR_ORDER.indexOf(destZh) > THSR_ORDER.indexOf(mem.name) ? 'south' : 'north';
          ok(4, side === suf, `${stTag} 車次 ${r.train}（往${destZh}）被放在錯的方向「${suf}」`);
        }
      }
    }
    // 具名案例
    if (mem.sys === 'TRA' && st.slug === 'taipei') named.taipeiTraDirs = { lang, dirs: depBlocks.length, expected: expDirs.length };
    if (mem.sys === 'THSR' && st.slug === 'zuoying') named.zuoyingThsr = { ...(named.zuoyingThsr || {}), [lang]: depBlocks.map(b => b.id.slice(secId.length + 1)) };
    if (mem.sys === 'THSR' && st.slug === 'taichung-hsr') named.taichungThsr = { ...(named.taichungThsr || {}), [lang]: depBlocks.map(b => b.id.slice(secId.length + 1)).sort() };

    // 逐區塊逐列
    const checkTable = (blk, expRows, isArr, dirLabel) => {
      const bTag = `${stTag} ${dirLabel}`;
      ok(1, blk.trCount === blk.rows.length, `${bTag} 有列沒被解析（<tr> ${blk.trCount}、解析出 ${blk.rows.length}）`);
      const subN = blk.sub.match(W_[lang].subN);
      ok(1, subN && +subN[1] === expRows.length, `${bTag} 小標的班數不符`, `頁面 ${subN ? subN[1] : '（解析不到）'}、原始資料 ${expRows.length}`);
      ok(1, blk.rows.length === expRows.length, `${bTag} 列數不符`, `頁面 ${blk.rows.length}、原始資料不重複（車次,時刻,${isArr ? '始發' : '終點'}）${expRows.length}`);
      c.rows += blk.rows.length; c.sections++;
      // 表內時間遞增
      for (let k = 1; k < blk.rows.length; k++) {
        if (blk.rows[k].sec !== null && blk.rows[k - 1].sec !== null && blk.rows[k].sec < blk.rows[k - 1].sec) { ok(1, false, `${bTag} 第 ${k + 1} 列時間早於前一列（表應依時間遞增）`, `${blk.rows[k - 1].timeRaw} → ${blk.rows[k].timeRaw}`); break; }
      }
      // 期望列 → 頁面列。合併鍵是（車次、開車「秒」、終點）：同車次改點前後只差幾秒、顯示成同一分鐘時，
      // 會是顯示上一模一樣的兩列（行駛日互補）。所以先按「顯示鍵」（車次、顯示時刻、終點）分組，組內再靠行駛日配對。
      const expBy = new Map(), pageBy = new Map();
      for (const e of expRows) {
        const destL = tr(lang, 'station', e.other, mem.sys);
        if (destL === null) { ok(6, false, `${bTag} i18n/stations.json 缺「${e.other}」的 ${lang} 站名`); continue; }
        const key = `${e.train}|${floorText(e.sec)}|${destL}`;
        (expBy.get(key) || expBy.set(key, []).get(key)).push(e);
      }
      for (const r of blk.rows) { const key = `${r.train}|${r.timeText}|${r.other}`; (pageBy.get(key) || pageBy.set(key, []).get(key)).push(r); }
      for (const [key, es] of expBy) {
        const [train, timeWant, destL] = key.split('|');
        const pr = pageBy.get(key) || [];
        ok(1, pr.length === es.length, `${bTag} 車次 ${train} ${timeWant}（${isArr ? '始發' : '終點'}${destL}）列數不符`, `頁面 ${pr.length} 列、原始資料 ${es.length} 列${pr.length === 0 ? `（原始秒數 ${es.map(e => `${Math.floor(e.sec / 3600)}:${pad2(Math.floor(e.sec % 3600 / 60))}:${pad2(e.sec % 60)}`).join('、')}）` : ''}`);
        // G5：捨去。秒數 %60 ≥ 30 時捨去與四捨五入差一分鐘——頁面要有捨去的那列、不得有四捨五入的那列。
        // 這裡不依賴後面的配對：四捨五入的頁面會讓配對整組落空，G5 必須自己就紅。
        for (const e of es) {
          const frac = [...e.secs].find(x => x % 60 >= 30);
          if (frac === undefined) continue;
          const rkey = `${train}|${roundText(frac)}|${destL}`;
          const hasFloor = pageBy.has(key), hasRound = pageBy.has(rkey) && !expBy.has(rkey);
          ok(5, hasFloor && !hasRound, `${bTag} 車次 ${train} 開車秒數 ${frac}（%60=${frac % 60}，≥30）應顯示捨去的 ${timeWant}`, `頁面${hasFloor ? '有' : '沒有'} ${timeWant}、${hasRound ? `有四捨五入的 ${roundText(frac)}` : `沒有 ${roundText(frac)}`}`);
          if (!g5Example || (!g5Example.preferred && mem.name === '臺北' && !isArr)) g5Example = { preferred: mem.name === '臺北' && !isArr, station: mem.name, train, sec: frac, floor: timeWant, round: roundText(frac), page: hasFloor ? timeWant : (hasRound ? roundText(frac) : '（缺）') };
        }
        const used = new Set();
        for (const e of es) {
          const dec = pr.map(r => ({ r, d: decodeLabel(lang, r.run, C) }));
          let pick = dec.find(x => !used.has(x.r) && x.d.set.size === e.dates.size && [...e.dates].every(d => x.d.set.has(d)));
          const exact = !!pick;
          if (!pick) pick = dec.find(x => !used.has(x.r));
          if (!pick) continue;   // 缺列已在上面記為 G1
          used.add(pick.r);
          const r = pick.r;
          c.rowsMatched++;
          const timeTag = `${train} ${timeWant}`;
          // 車種
          // 高鐵每一列的車種都一樣（High Speed Rail／高鐵），是雜訊，頁面不顯示；台鐵照舊要對上 i18n 的車種名
          const typeOk = mem.sys === 'THSR' ? r.type === '' : [...e.types].some(k => tr(lang, 'type', k) === r.type);
          ok(6, typeOk, `${bTag} 車次 ${timeTag} 車種不符`, mem.sys === 'THSR' ? `高鐵列不該顯示車種、頁面「${r.type}」` : `頁面「${r.type}」、應為 ${[...e.types].map(k => `「${tr(lang, 'type', k)}」`).join('／')}`);
          // G2：行駛日
          ok(2, pick.d.errs.length === 0, `${bTag} 車次 ${timeTag} 行駛日標籤「${r.run}」不合規格`, pick.d.errs.join('；'));
          ok(2, exact, `${bTag} 車次 ${timeTag} 行駛日標籤「${r.run}」展開後與實際行駛日不同`, `標籤展開 [${mdList(pick.d.set)}]、實際 [${mdList(e.dates)}]`);
          ok(2, r.special === (e.dates.size !== C.dates.length), `${bTag} 車次 ${timeTag} 的 special 標記應等於「不是每日」`, `special=${r.special}、行駛 ${e.dates.size}/${C.dates.length} 天`);
        }
      }
      for (const [key, rs] of pageBy) if (!expBy.has(key)) ok(1, false, `${bTag} 頁面多出原始資料沒有的列`, `${key}（${rs[0].run}）`);
    };
    for (const b of depBlocks) {
      const d = assign.get(b);
      if (!d) { ok(1, false, `${stTag} 區塊 ${b.id} 對不上任何資料方向（車次集合沒有重疊）`); continue; }
      checkTable(b, d.rows, false, `方向 ${b.id}${mem.sys === 'TRA' ? `（下一點 ${d.key}）` : ''}`);
    }
    if (arrBlocks.length === 1) checkTable(arrBlocks[0], exp.arrivals, true, '到站');
  }
}

// ───────────────────────── 主流程 ─────────────────────────
function seededRng(seed) {   // mulberry32
  let a = 0; for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 前置：站清單與資料一致性
ok(8, STATIONS.length > 0, '從 build_aeo_pages.mjs 擷取不到任何站設定');
ok(8, new Set(STATIONS.map(s => s.slug)).size === STATIONS.length, '站設定 slug 重複');
for (const lang of LANGS) {
  const dir = path.join(root, PAGE_DIR[lang]);
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isDirectory()).sort() : [];
  const want = STATIONS.map(s => s.slug).sort();
  ok(8, JSON.stringify(onDisk) === JSON.stringify(want), `${PAGE_DIR[lang]}/ 底下的站資料夾與站設定不一致`, `磁碟 ${onDisk.length}、設定 ${want.length}；差異 ${[...onDisk.filter(x => !want.includes(x)), ...want.filter(x => !onDisk.includes(x))].join(',') || '（順序）'}`);
}
for (const [sys, s] of Object.entries(DS)) {
  const first = s.dates[0], last = s.dates[s.dates.length - 1];
  ok(9, Array.isArray(s.range) && s.range[0] === first && s.range[1] === last, `${s.file} 自己的 dateRange 與 dates 鍵的首末日不一致`, `dateRange ${JSON.stringify(s.range)}、dates ${first}…${last}`);
  const days = s.dates.map(d => Date.UTC(...d.split('-').map((x, i) => (i === 1 ? +x - 1 : +x))));
  ok(9, days.every((t, k) => k === 0 || t - days[k - 1] === 86400000), `${s.file} 的 dates 不是逐日連續`);
}

const rng = seededRng(opt.seed || String(Date.now()));
const seed = opt.seed || 'random-' + Math.floor(rng() * 1e9);
const allSlugs = STATIONS.map(s => s.slug);
let picked;
if (opt.all) picked = allSlugs;
else {
  const pool = allSlugs.filter(s => !NAMED.includes(s));
  const r2 = seededRng(seed);
  const shuffled = pool.map(s => [r2(), s]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  picked = [...NAMED.filter(n => allSlugs.includes(n)), ...shuffled.slice(0, opt.sample)];
}
log(`車站時刻頁閘門｜${opt.all ? '--all 全量' : `具名案例 ${NAMED.join('、')} ＋ 隨機 ${opt.sample} 站（seed=${seed}）`}｜共 ${picked.length} 站`);

// 一次掃描資料，只算需要的站
const expByMember = new Map();
for (const slug of picked) {
  const st = STATIONS.find(s => s.slug === slug);
  for (const m of st.members) {
    const info = memberInfo(m);
    if (!info || expByMember.has(m)) continue;
    expByMember.set(m, buildExpected(info.sys, info.name));
  }
}
for (const [m, e] of expByMember) {
  ok(1, e.rowCount > 0, `${m}（${e.stationName}）在資料範圍內一班停靠的班次都沒有`);
  for (const a of e.anomalies) notes.push(`資料備註 ${m}：${a}`);
}

for (const slug of picked) {
  const st = STATIONS.find(s => s.slug === slug);
  const members = st.members.map(memberInfo).filter(Boolean);
  for (const lang of LANGS) {
    const f = path.join(root, PAGE_DIR[lang], slug, 'index.html');
    if (!ok(1, fs.existsSync(f), `${lang} ${slug} 頁面不存在`, path.relative(root, f))) continue;
    const page = parsePage(fs.readFileSync(f, 'utf8'));
    // G7
    const hit = page.mainText.match(NO_PUBLISH_CLAIM[lang]);
    ok(7, !hit, `${lang} ${slug} 不斷言官方有沒有公開（只寫軌島的資料來源沒有）`, hit ? hit[0] : '');
    if (lang === 'en') ok(6, !CJK.test(page.mainText), `en ${slug} 英文頁 <main> 不得含中日文字`, (page.mainText.match(new RegExp(`.{0,16}${CJK.source}+.{0,16}`)) || [''])[0]);
    verifyStation(st, lang, page, members, expByMember);
  }
}

// G2 控制組：行駛日解析器自己要先過——手算的標籤展開結果（含「例外日」「缺席日」這兩個目前資料裡沒出現過、
// 但規格有的語法）；解析器解錯或不認得，這裡先紅，不會讓 G2 因為「解析器太寬鬆」而空過。
{
  const cal = makeCal(DS.TRA.dates);   // 9/27（日）…10/10（六）；9/28 週一與 10/9 週五是放假日
  const want = (...md) => new Set(md.map(x => { const [m, d] = x.split('/').map(Number); return `2026-${pad2(m)}-${pad2(d)}`; }));
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const cases = [
    ['zh', '週一至週三、週五，另 10/3；9/28（放假） 不開', want('9/29', '9/30', '10/2', '10/3', '10/5', '10/6', '10/7', '10/9')],
    ['en', 'Mon–Wed, Fri, plus Oct 3; not on Sep 28 (holiday)', want('9/29', '9/30', '10/2', '10/3', '10/5', '10/6', '10/7', '10/9')],
    ['ja', '月〜水・金、ほか10月3日；9月28日（休日）は運休', want('9/29', '9/30', '10/2', '10/3', '10/5', '10/6', '10/7', '10/9')],
    ['ja', '月曜〜水曜・金曜、ほか10月3日；9月28日（休日）は運休', want('9/29', '9/30', '10/2', '10/3', '10/5', '10/6', '10/7', '10/9')],
    ['ja', '日曜', want('9/27', '10/4')],
    ['ja', '金曜・日曜、ほか10月3日', want('9/27', '10/2', '10/3', '10/4', '10/9')],
    ['ja', '月〜金曜', want('9/28', '9/29', '9/30', '10/1', '10/2', '10/5', '10/6', '10/7', '10/8', '10/9')],
    ['zh', '上班日（放假日不開）', want('9/29', '9/30', '10/1', '10/2', '10/5', '10/6', '10/7', '10/8')],
    ['zh', '週一至週五', want('9/28', '9/29', '9/30', '10/1', '10/2', '10/5', '10/6', '10/7', '10/8', '10/9')],
    ['en', 'Only Sep 28 (holiday), Oct 9 (holiday)', want('9/28', '10/9')],
    ['ja', '10月3日から毎日', want('10/3', '10/4', '10/5', '10/6', '10/7', '10/8', '10/9', '10/10')],
    ['zh', '10/2 以前每日', want('9/27', '9/28', '9/29', '9/30', '10/1', '10/2')],
    ['zh', '週末與放假日', want('9/27', '9/28', '10/3', '10/4', '10/9', '10/10')],
  ];
  for (const [lang, text, expect] of cases) {
    const d = decodeLabel(lang, text, cal);
    ok(2, d.errs.length === 0 && same(d.set, expect), `解析器控制組：${lang}「${text}」`, `解出 [${mdList(d.set)}]、應為 [${mdList(expect)}]${d.errs.length ? `；${d.errs.join('；')}` : ''}`);
  }
  // 反向：上班日與週一至週五只差在放假的平日（9/28、10/9）——解析器要分得出來（M3 類錯誤全靠它）
  ok(2, !same(decodeLabel('zh', '上班日（放假日不開）', cal).set, decodeLabel('zh', '週一至週五', cal).set), '解析器控制組：「上班日（放假日不開）」與「週一至週五」在這個區間必須展開成不同集合');
  // 反向：寫錯的註記要被抓到（9/28 是放假的平日，「9/28」不帶註記＝錯）
  ok(2, decodeLabel('zh', '僅 9/28', cal).errs.length > 0, '解析器控制組：放假日沒帶註記的「僅 9/28」必須報錯');
}

// G7 控制組：抽出來的正規式真的擋得到已知正例（抽錯段落或被改鬆會當場紅）
for (const [lang, s] of [['zh', '官方沒有公開逐班時刻表'], ['en', 'The operator does not publish a timetable.'], ['ja', '公式の時刻表は公開されていません。']]) {
  ok(7, NO_PUBLISH_CLAIM[lang].test(s), `NO_PUBLISH_CLAIM.${lang} 擋不到已知正例（正規式被改鬆或抽錯）`, s);
}

// G4 具名案例
if (named.taipeiTraDirs) {
  const e = expByMember.get('TRA:1000');
  ok(4, e && e.dirs.length >= 2, '具名案例：台北（台鐵臺北）資料應有兩個以上方向', `資料 ${e ? e.dirs.length : '—'}`);
  ok(4, named.taipeiTraDirs.dirs >= 2, '具名案例：台北（台鐵臺北）頁面應有兩個以上方向', `頁面 ${named.taipeiTraDirs.dirs}`);
} else ok(4, false, '具名案例 台北 沒有被驗到');
if (named.zuoyingThsr) {
  for (const lang of LANGS) ok(4, JSON.stringify(named.zuoyingThsr[lang]) === JSON.stringify(['north']), `具名案例：左營高鐵（${lang}）應只有北上`, `頁面方向 ${JSON.stringify(named.zuoyingThsr[lang])}`);
} else ok(4, false, '具名案例 左營高鐵 沒有被驗到');
if (named.taichungThsr) {
  for (const lang of LANGS) ok(4, JSON.stringify(named.taichungThsr[lang]) === JSON.stringify(['north', 'south']), `具名案例：台中高鐵（${lang}）應南北兩向`, `頁面方向 ${JSON.stringify(named.taichungThsr[lang])}`);
} else ok(4, false, '具名案例 台中高鐵 沒有被驗到');

// G5 正向對照：一定要找得到一班秒數 %60 ≥ 30 的
ok(5, !!g5Example, '找不到秒數 %60 ≥ 30 的班次當正向對照（判準沒被行使）');
if (g5Example) log(`G5 指名對照：${g5Example.station} 車次 ${g5Example.train} 原始秒數 ${g5Example.sec}（${Math.floor(g5Example.sec / 3600)}:${pad2(Math.floor(g5Example.sec % 3600 / 60))}:${pad2(g5Example.sec % 60)}）→ 頁面 ${g5Example.page}（捨去 ${g5Example.floor}，四捨五入會是 ${g5Example.round}）`);

// G8 覆蓋率
const stationsVerified = picked.length;
if (!opt.quiet) {
  console.log('覆蓋率（站 × 語 × 段 × 列）：');
  for (const lang of LANGS) {
    const c = cov[lang];
    console.log(`  ${lang}：${c.stations} 站 × ${c.sections} 段 × ${c.rows} 列（列數比對成功 ${c.rowsMatched}／原始資料 ${c.expRows}；期望段數 ${c.expSections}）`);
  }
}
for (const lang of LANGS) {
  const c = cov[lang];
  ok(8, c.stations === stationsVerified, `${lang} 實際驗到的站數應等於選定站數`, `驗到 ${c.stations}、選定 ${stationsVerified}`);
  ok(8, c.sections === c.expSections, `${lang} 驗到的段數應等於原始資料算出的段數（分母不得無聲縮水）`, `驗到 ${c.sections}、原始資料 ${c.expSections}`);
  ok(8, c.rows === c.expRows, `${lang} 頁面上的列數應等於原始資料算出的總列數`, `頁面 ${c.rows}、原始資料 ${c.expRows}`);
  ok(8, c.rowsMatched === c.expRows, `${lang} 逐列比對成功的列數應等於原始資料的總列數`, `成功 ${c.rowsMatched}、原始資料 ${c.expRows}`);
  ok(8, c.expRows > 0 && c.sections > 0, `${lang} 覆蓋率為零（判準沒被行使）`);
}
ok(8, LANGS.length === EXPECT_LANGS, `語言數應為 ${EXPECT_LANGS}`);
if (opt.all) {
  ok(8, stationsVerified === EXPECT_STATIONS, `--all 時站數必須是 ${EXPECT_STATIONS}`, `實際 ${stationsVerified}`);
  ok(8, STATIONS.length === EXPECT_STATIONS, `站設定（build_aeo_pages.mjs）的站數必須是 ${EXPECT_STATIONS}`, `實際 ${STATIONS.length}`);
  for (const lang of LANGS) ok(8, cov[lang].stations === EXPECT_STATIONS, `--all 時 ${lang} 的站數必須是 ${EXPECT_STATIONS}`, `實際 ${cov[lang].stations}`);
  ok(8, LANGS.filter(l => cov[l].stations > 0).length === EXPECT_LANGS, `--all 時語言必須是 ${EXPECT_LANGS}`);
} else {
  ok(8, stationsVerified >= NAMED.length, `預設至少要驗具名案例 ${NAMED.length} 站`, `實際 ${stationsVerified}`);
}

for (const n of notes) log(n);

// ───────────────────────── 結果 ─────────────────────────
let totalFails = 0;
console.log('閘門結果：');
for (const n of Object.keys(GATE_NAME)) {
  const g = gate[n];
  totalFails += g.fails.length;
  console.log(`  G${n} ${GATE_NAME[n]}：${g.fails.length ? `紅 ${g.fails.length} 項` : '綠'}（${g.checks} 個檢查）`);
}
for (const n of Object.keys(GATE_NAME)) {
  const g = gate[n];
  for (const f of g.fails.slice(0, 8)) console.log(`FAIL ${f}`);
  if (g.fails.length > 8) console.log(`FAIL [G${n}] …另有 ${g.fails.length - 8} 項`);
}
const totalChecks = Object.values(gate).reduce((s, g) => s + g.checks, 0);
console.log(`${totalFails ? 'FAIL' : 'PASS'}：${totalChecks} 個檢查，${totalFails} 項失敗（紅的閘門：${Object.keys(GATE_NAME).filter(n => gate[n].fails.length).map(n => `G${n}`).join('、') || '無'}）`);
process.exit(totalFails ? 1 : 0);
