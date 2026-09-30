#!/usr/bin/env node
// 車站時刻頁（SEO 階段 B，2026-09-30）的靜態驗收：stations／en/stations／ja/stations 的台鐵、高鐵逐班時刻段。
// 不開瀏覽器。頁面每週隨 `npm run fetch-schedule` 重產，沒有人逐頁看，所以這支要能「資料或程式一改壞就紅、
// 而且紅在指名的那一條」。
//
// 兩批頁面：
//   第一批 23 站（手寫內容，build_aeo_pages.mjs 的 stations 陣列）× 三語；
//   第二批（B2）：台鐵每個有停靠的站各一頁中文（221 個，自動產生）＋其中 7 站再有英日文頁。
//   第二批「哪些站必須有頁」不從產生器抓，而是從原始資料推：兩週內有停靠的台鐵站名
//   − 「臺北-環島」（環島列車終點別名，不是站）− 第一批頁的台鐵成員 − 待通車站（scripts/fetch_tra.py 的 PENDING_STATIONS）（G10）。
//
// 獨立性（這支閘門最重要的性質）：
//   期望值一律從原始資料自己算（data/tra_schedule_dense.json、scripts/seo_data/thsr_timetable.json、
//   data/tw_daytype.json、data/holiday_names.json、i18n/stations.json、data/station_transfers.json、
//   data/tra_station_info.json、data/tra_station_of_line.json、scripts/seo_data/tra_line_names.json、scripts/fetch_tra.py 的 PENDING_STATIONS），
//   頁面的真相一律從產出的 HTML 解析。**不 import、也不複製** scripts/station_timetable.mjs 與
//   scripts/build_aeo_pages.mjs 的邏輯——閘門與實作同源時，「相等」是零資訊。
//   只有兩處讀了它們的「資料」而非「邏輯」：
//     · build_aeo_pages.mjs 的 stations 陣列裡每站的 slug／title／members 常數（第一批：哪一站有哪些台鐵／高鐵成員）；
//     · station_timetable.mjs 檔頭註解裡的三語行駛日標籤語法（那是規格）。
//   第二批的規格常數只有三個，寫在下面 SLUG_OVERRIDE／EN_JA_SECOND／SAME_NAME_HSR，出處是 B2_PLAN.md 頁面規則 1、2、6。
//
// 兩棵樹：原始資料與規格來源固定讀「腳本所在的樹」；被驗的頁面、sitemap、索引讀 --root（預設同一棵樹）。
//
// 十五條閘門（失敗訊息一律以 [G<n>] 開頭；G1–G9 是第一批就有的，G10–G15 是第二批新增）：
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
//   G8 覆蓋率        印出並斷言 站 × 語 × 段 × 列；--all 時語言必須 3；驗到的列數必須等於原始資料算出的總列數
//   G9 資料窗        頁面寫的資料涵蓋區間＝各資料檔的 dateRange（台鐵 dense／高鐵 seo_data，不是 availableRange）
//   G10 站清單獨立推導  第二批期望站＝原始資料兩週內有停靠的台鐵站 − 「臺北-環島」− 第一批台鐵成員 − 待通車站；期望網址用自己寫的 slug 函式
//                    ＋規格常數 {左營:'zuoying-tra'}；每個期望的頁都在、磁碟上沒有多出來的站頁、slug 不重複；/stations/zuoying/ 仍是第一批那頁；
//                    被待通車名單比中的站不可已有官方英文站名（忘了移除、或名單誤中真站）
//   G11 具名覆蓋率     zh／en／ja 站數必須剛好是 EXPECT_ZH／EN／JA_STATIONS（--all；推導出的站數任何模式都驗）；
//                    各語逐列比對的列數印出，並斷言等於「從原始資料重算的總列數」且 > 0
//   G12 hreflang       只有中文的頁 alternate 恰為 {zh-Hant, x-default} 且都指自己；有三語的頁四種互指；alternate 目標存在；
//                    中文頁尾 English／日本語連結跟有沒有對應頁一致；sitemap 恰含全部車站頁與三個索引，不含不存在的網址；站頁內部連結目標存在
//   G13 導言與轉乘事實  第二批頁：標題、導言（路線名＋縣市鄉鎮市區，地址由閘門自己解析）、轉乘夥伴（系統、站名、公尺數對 pairs）、
//                    多路線句、同名高鐵站（公里數自己算、連結 slug）、沒有轉乘的那一句、事實表站點／地址／座標、附近車站（規則 5）；
//                    英日文 7 站的導言與轉乘；英文頁的標題／描述／內文沒有漏譯中文
//   G14 索引分組       中文索引「全部台鐵車站」分組：每站恰出現一次、歸在自己地址的縣市下、連結目標存在；23 張卡片、ItemList 網址集合、跳轉按鈕；英日文索引恰 30 張卡片
//   G15 第一批反向連結  中文 miaoli-hsr／changhua-hsr／zuoying 的轉乘段各有一個連到 miaoli／changhua／zuoying-tra 的連結
//
// 用法：node scripts/verify_station_pages.mjs [--all] [--sample=<N>] [--seed=<字串>] [--quiet] [--root <目錄>] [--max-fails=<N|all>]
//   預設：具名案例六站（第一批 taipei、zuoying、taichung-hsr；第二批 zuoying-tra、ruifang、xinshi）＋隨機 N 站
//        （預設 3，seed 一定會印出來，失敗時原樣重跑）；G10／G12／G14／G15 這類整體結構的檢查任何模式都跑全部頁。
//   --all：第一批 23 站＋第二批 221 站（zh 244／en 30／ja 30 頁）全量。
//   --root <目錄>：被驗的站台樹（頁面、sitemap.xml）；預設＝本腳本所在的樹。第一道就印出目標路徑與 stations/index.html 的 md5。
//   --max-fails=<N|all>：每條閘門最多印出幾行 FAIL（預設 8；差異逐條歸因時用 all）。
//   不認識的參數拒絕並以 2 離開。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // 原始資料與規格來源：腳本所在的樹
const rd = rel => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
const rdText = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const opt = { all: false, sample: 3, seed: null, quiet: false, root: null, maxFails: 8 };
{
  const argv = process.argv.slice(2);
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--all') opt.all = true;
    else if (a === '--quiet') opt.quiet = true;
    else if (a === '--root') { const v = argv[++k]; if (!v || v.startsWith('--')) { console.error('--root 需要一個目錄'); process.exit(2); } opt.root = v; }
    else if (a.startsWith('--root=')) { opt.root = a.slice(7); if (!opt.root) { console.error('--root 需要一個目錄'); process.exit(2); } }
    else if (a.startsWith('--seed=')) opt.seed = a.slice(7);
    else if (a.startsWith('--sample=')) opt.sample = Number(a.slice(9));
    else if (a.startsWith('--max-fails=')) { const v = a.slice(12); opt.maxFails = v === 'all' ? Infinity : Number(v); if (!(opt.maxFails >= 1)) { console.error('--max-fails 要是正整數或 all'); process.exit(2); } }
    else { console.error(`未知參數：${a}`); process.exit(2); }
  }
}
if (!Number.isInteger(opt.sample) || opt.sample < 0) { console.error('--sample 要是非負整數'); process.exit(2); }
const site = path.resolve(opt.root ?? repo);   // 被驗的站台樹
if (!fs.existsSync(site) || !fs.statSync(site).isDirectory()) { console.error(`--root 不是目錄：${site}`); process.exit(2); }
const siteFile = (...p) => path.join(site, ...p);
{   // 第一道：印出目標（突變測試與對照靠這行確認驗的是哪一棵）
  const f = siteFile('stations/index.html');
  const md5 = fs.existsSync(f) ? crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex') : '（不存在）';
  console.log(`目標樹：${site}｜stations/index.html md5=${md5}｜原始資料與規格：${repo}`);
}

const LANGS = ['zh', 'en', 'ja'];
const PAGE_DIR = { zh: 'stations', en: 'en/stations', ja: 'ja/stations' };
const EXPECT_LANGS = 3;
const EXPECT_FIRST_BATCH = 23;   // 第一批：23 站（含只有捷運的美麗島）
// 具名覆蓋率常數（B2_PLAN 閘門 11）：--all 時各語言的站頁數必須剛好是這三個數字；
// 資料出現新站（例如 2026-10 通車的平鎮臨時站）時，推導出的站數會跟這裡對不上，那時要人工確認再改常數。
const EXPECT_ZH_STATIONS = 244, EXPECT_EN_STATIONS = 30, EXPECT_JA_STATIONS = 30;
const EXPECT_STATIONS = { zh: EXPECT_ZH_STATIONS, en: EXPECT_EN_STATIONS, ja: EXPECT_JA_STATIONS };
const NAMED = ['taipei', 'zuoying', 'taichung-hsr'];          // 預設模式指名：第一批
const NAMED2 = ['zuoying-tra', 'ruifang', 'xinshi'];           // 預設模式指名：第二批（左營撞名／多路線＋英日文／臺南市新市區的正向對照）
// 第二批的規格常數（B2_PLAN 頁面規則 2、6）
const SLUG_OVERRIDE = { 左營: 'zuoying-tra' };                                      // 台鐵左營跟第一批 /stations/zuoying/（左營轉乘站）撞名
const EN_JA_SECOND = ['瑞芳', '十分', '菁桐', '礁溪', '福隆', '集集', '知本'];         // 第二批有英日文頁的 7 站
const SAME_NAME_HSR = { 苗栗: ['miaoli-hsr', 'miaoli'], 彰化: ['changhua-hsr', 'changhua'], 左營: ['zuoying', 'zuoying-tra'] };   // 同名高鐵站在別處：[第一批頁 slug, 台鐵頁 slug]
const LOOP_ALIAS = '臺北-環島';                                                       // 環島列車終點別名（站碼 1001），不是站
const SITE_BASE = 'https://railisland.tw';
const PREFIX = { zh: '/stations/', en: '/en/stations/', ja: '/ja/stations/' };
const HTML_LANG = { zh: 'zh-Hant', en: 'en', ja: 'ja' };
const THSR_ORDER = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];   // 沿線站序（北→南），真實世界事實
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = { zh: ['一', '二', '三', '四', '五', '六', '日'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ja: ['月', '火', '水', '木', '金', '土', '日'] };
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

// ───────────────────────── 失敗登記 ─────────────────────────
const GATE_NAME = {
  1: '班次完整', 2: '行駛日可逆', 3: '每天班數', 4: '方向', 5: '捨去到分', 6: '三語', 7: '不斷言公開', 8: '覆蓋率', 9: '資料窗',
  10: '站清單獨立推導', 11: '具名覆蓋率', 12: 'hreflang與sitemap', 13: '導言與轉乘事實', 14: '索引分組', 15: '第一批反向連結',
};
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
const traInfo = rd('data/tra_station_info.json');              // 台鐵站地址（G13、G14 的縣市／鄉鎮市區）
const traLines = rd('data/tra_station_of_line.json').lines;    // 每條線的站序（規則 5「附近的車站」）
const traLineNames = rd('scripts/seo_data/tra_line_names.json').lines;   // 路線英文名（TDX 字面）

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

// 第一批站與成員：build_aeo_pages.mjs 的 stations 陣列常數（只讀資料，不 import；只取 slug／title／members 三個欄位）。
// 範圍限在 `const stations = [` 到陣列結尾，第二批日後在產生器別處加的東西不會被誤抓；找不到陣列邊界才退回整檔。
const buildSrc = rdText('scripts/build_aeo_pages.mjs');
const STATIONS = [];
{
  const a = buildSrc.indexOf('const stations = ['), b = a >= 0 ? buildSrc.indexOf('\n];', a) : -1;
  const cfg = a >= 0 && b > a ? buildSrc.slice(a, b) : buildSrc;
  const heads = [...cfg.matchAll(/slug:\s*'([^']+)'/g)];
  heads.forEach((h, k) => {
    const seg = cfg.slice(h.index, k + 1 < heads.length ? heads[k + 1].index : cfg.length);
    const mem = seg.match(/members:\s*\[([^\]]*)\]/);
    if (!mem) return;   // 沒有 members 的 slug 不是站設定
    const ttl = (seg.match(/title:\s*'([^']*)'/) || [])[1] || null;   // 同一個物件裡第一個 title 是中文（en／ja 在後面）
    STATIONS.push({ slug: h[1], title: ttl && CJK.test(ttl) ? ttl : null, members: [...mem[1].matchAll(/'([^']+)'/g)].map(x => x[1]) });
  });
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

const isStop = s => s.stop !== false;   // 有沒有停靠（資料裡每一筆都有明確的 true／false）

// 某系統某站的期望結構：dirs（方向 → 列）、arrivals（到站列）、perDay（每天開出班數）
function buildExpected(sys, stationName) {
  const { data, dates } = DS[sys];
  const dirs = new Map(); const arrivals = new Map();
  const perDayKeys = new Map(dates.map(d => [d, new Set()]));
  const perDayOcc = new Map(dates.map(d => [d, 0]));
  const anomalies = [];
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

// ───────────────────────── 站清單：第二批從原始資料推導（G10）─────────────────────────
const norm = s => String(s).normalize('NFKC').replace(/臺/g, '台');
const urlOf = (lang, slug) => `${SITE_BASE}${PREFIX[lang]}${slug ? `${slug}/` : ''}`;
function slugOf(name) {   // 網址規則（B2_PLAN 頁面規則 6）：tra_sched[站名].en 轉小寫、非 [a-z0-9] 一律換 -、合併、去頭尾；覆寫表 SLUG_OVERRIDE
  if (SLUG_OVERRIDE[name]) return SLUG_OVERRIDE[name];
  const en = i18n.systems.tra_sched[name]?.en;
  if (!en) return null;
  return en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null;
}
function parseAddress(addr) {   // 規則 2：去掉開頭郵遞區號、取 3 字縣市；之後取「最短、以『區』結尾（2–4 字）」，沒有才取「最短、以『鄉／鎮／市』結尾」；取不到回 null
  const a = String(addr || '').replace(/^\d+/, '');
  const county = a.slice(0, 3), rest = a.slice(3).replace(/^\s+/, '');   // 資料裡有「新竹市 東區」這種縣市後面帶空白的寫法
  if (!/[市縣]$/.test(county)) return null;
  for (const suffix of [/區$/, /[鄉鎮市]$/]) for (let n = 2; n <= 4; n++) if (rest.length >= n && suffix.test(rest.slice(0, n))) return { county, town: rest.slice(0, n) };
  return null;
}
const infoById = new Map(Object.values(traInfo).map(v => [v.id, v]));   // 用站碼取，不用站名：tra_station_info 的鍵是「台」、schedule／transfers 是「臺」（臺中港）
const kmBetween = (p, q) => {   // 兩點直線距離（公里，haversine，R=6371）
  const rad = x => x * Math.PI / 180, dLat = rad(q[0] - p[0]), dLon = rad(q[1] - p[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const traRecByName = new Map(), traNameDup = [];
for (const [key, rec] of Object.entries(transfers.stations)) if (rec.system === 'TRA') { if (traRecByName.has(rec.name)) traNameDup.push(rec.name); traRecByName.set(rec.name, { key, ...rec }); }
const thsrByNorm = new Map();
for (const [key, rec] of Object.entries(transfers.stations)) if (rec.system === 'THSR') thsrByNorm.set(norm(rec.name), { key, ...rec });

// 待通車站＝scripts/fetch_tra.py 的 PENDING_STATIONS（產生器、班表抓取的待上架站閘門讀同一份；這裡不 import 產生器）。
// 班表有停靠也不期望有頁：站還在整合，官方英文站名、地址、轉乘表可能都還沒有（2026-09-30 平鎮臨時站）。
// 比對照 fetch_tra_schedule.py：去括號後綴、臺→台、「包含」。那一筆移除後這站回到一般規則（缺譯名 G10 紅、站數變了 G11 紅）。
// 注意：這段讀法與比對跟產生器相同，兩邊一起讀錯（名單誤中真站、忘了移除）時資料夾比對看不出來；
// 擋這種錯的是 G10 另一條不看名單的斷言：被比中的站不可已有官方英文站名（真的待通車站還沒有）。
const PENDING_TRA = (() => {
  const dict = rdText('scripts/fetch_tra.py').match(/^PENDING_STATIONS\b[^=\n]*=\s*\{([^}]*)\}/m);
  ok(10, !!dict, 'scripts/fetch_tra.py 找不到 PENDING_STATIONS（被改名或刪掉了？待通車站無從扣除）');
  return dict ? [...dict[1].matchAll(/(?:^|[{,])\s*(["'])([^"'\n]+)\1\s*:/gm)].map(m => m[2]) : [];
})();
const traKey = name => String(name).replace(/\s*[（(].*$/, '').replace(/臺/g, '台');
const isPendingTra = name => PENDING_TRA.some(p => traKey(name).includes(traKey(p)));
const traStopNames = new Set(), traPendingStops = new Set();   // 兩週內（dates 各日索引到的車次）有停靠的台鐵站名；待通車站另外收
for (const date of DS.TRA.dates) for (const idx of tra.dates[date]) for (const s of tra.trains[idx].stops) if (isStop(s)) (isPendingTra(s.name) ? traPendingStops : traStopNames).add(s.name);
if (traPendingStops.size) console.log(`⏸ 待通車站 ${[...traPendingStops].sort().join('、')} 在班表有停靠，仍在 PENDING_STATIONS：不期望有頁（磁碟上有它的頁，G10 會列為多出來的資料夾）`);
const firstTraSlug = new Map();   // 第一批頁的台鐵成員：站名 → slug
for (const st of STATIONS) for (const m of st.members) if (m.startsWith('TRA:')) { const rec = transfers.stations[m]; if (rec) firstTraSlug.set(rec.name, st.slug); }

const SECOND = [];   // 第二批期望站（含推不出網址的，由 G10 指名紅）
for (const name of [...traStopNames].sort()) {
  if (name === LOOP_ALIAS || firstTraSlug.has(name)) continue;
  const rec = traRecByName.get(name);
  SECOND.push({ name, code: rec ? rec.stationId : null, slug: slugOf(name) });
}
// 所有站頁：第一批 3 語；第二批只有中文，EN_JA_SECOND 那 7 站再有英日文
const ALL = STATIONS.map(s => ({ slug: s.slug, batch: 1, title: s.title, name: null, members: s.members, langs: LANGS }));
for (const s of SECOND) if (s.slug && s.code) ALL.push({ slug: s.slug, batch: 2, title: s.name in SLUG_OVERRIDE ? `台鐵${s.name}車站` : `${s.name}車站`, name: s.name, members: [`TRA:${s.code}`], langs: EN_JA_SECOND.includes(s.name) ? LANGS : ['zh'] });
const stationsOf = lang => ALL.filter(s => s.langs.includes(lang));

// 全部台鐵站（第一批成員＋第二批）：站名 → { slug, county, town }，G14 索引分組與規則 5 用
const TRA_ALL = new Map();
for (const name of traStopNames) {
  if (name === LOOP_ALIAS) continue;
  const rec = traRecByName.get(name);
  const info = rec ? infoById.get(rec.stationId) : null;
  TRA_ALL.set(name, { name, code: rec ? rec.stationId : null, slug: firstTraSlug.get(name) ?? slugOf(name), first: firstTraSlug.has(name), addr: info ? parseAddress(info.address) : null, info });
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
  // 導言、轉乘段、附近車站卡片、內文連結（G12–G14 用）
  const h1 = strip((main.match(/<h1>([\s\S]*?)<\/h1>/) || [, ''])[1]);
  const lede = strip((main.match(/<p class="lede">([\s\S]*?)<\/p>/) || [, ''])[1]);
  const tm = main.match(/<section class="content-section st-anchor" id="transfer">([\s\S]*?)<\/section>/);
  const cards = [...main.matchAll(/<article class="card station-card">([\s\S]*?)<\/article>/g)].map(m => ({ href: (m[1].match(/<a class="card-link" href="([^"]+)"/) || [])[1] || null, title: strip((m[1].match(/<h3>([\s\S]*?)<\/h3>/) || [, ''])[1]) }));
  return { main, mainText: strip(main), sections, facts, h1, lede, transferHtml: tm ? tm[1] : null, transferText: tm ? strip(tm[1]) : null, cards };
}
// 頁面的 head／頁尾（hreflang、canonical、頁尾語言連結、標題與描述）
function parseMeta(html) {
  const he = html.indexOf('</head>'), fs0 = html.lastIndexOf('</main>');
  const head = he >= 0 ? html.slice(0, he) : '', foot = fs0 >= 0 ? html.slice(fs0) : '';
  const attr = re => decode((head.match(re) || [, ''])[1]);
  return {
    head, foot,
    htmlLang: (html.match(/<html[^>]*\blang="([^"]*)"/) || [])[1] ?? null,
    titleTag: strip((head.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]),
    metaDesc: attr(/<meta name="description" content="([^"]*)"/), ogTitle: attr(/<meta property="og:title" content="([^"]*)"/), ogDesc: attr(/<meta property="og:description" content="([^"]*)"/),
    canon: [...head.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]),
    alts: [...head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]),
    footEn: (foot.match(/<a href="([^"]+)" hreflang="en" lang="en">English<\/a>/) || [])[1] ?? null,
    footJa: (foot.match(/<a href="([^"]+)" hreflang="ja" lang="ja">日本語<\/a>/) || [])[1] ?? null,
    stationLinks: [...html.matchAll(/href="(\/(?:(?:en|ja)\/)?stations\/[^"#?]*)/g)].map(m => m[1]),
  };
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

// ───────────────────────── 整體結構與第二批頁的檢查（G10–G15）─────────────────────────
const clip = (arr, n = 60) => arr.length <= n ? arr.join('、') : `${arr.slice(0, n).join('、')}…（共 ${arr.length} 個）`;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const urlToFile = url => (url.startsWith(SITE_BASE) ? siteFile(url.slice(SITE_BASE.length), 'index.html') : null);
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

// G10：站清單獨立推導＋磁碟上的站頁
function checkStationList() {
  ok(10, STATIONS.length === EXPECT_FIRST_BATCH, `第一批站設定（build_aeo_pages.mjs 的 stations 陣列）的站數必須是 ${EXPECT_FIRST_BATCH}`, `實際 ${STATIONS.length}`);
  ok(10, new Set(STATIONS.map(s => s.slug)).size === STATIONS.length, '第一批站設定 slug 重複');
  ok(10, traNameDup.length === 0, 'station_transfers.json 有同名的台鐵站，站名推不出唯一站碼', traNameDup.join('、'));
  ok(10, traStopNames.has(LOOP_ALIAS), `原始資料沒有「${LOOP_ALIAS}」（規格要從清單扣掉的環島終點別名；資料變了要重新確認）`);
  for (const n of firstTraSlug.keys()) ok(10, traStopNames.has(n), `第一批頁的台鐵成員「${n}」在兩週資料裡沒有停靠`);
  for (const s of SECOND) {
    ok(10, !!s.code, `station_transfers.json 沒有台鐵站「${s.name}」，推不出站碼`);
    ok(10, !!s.slug, `i18n/stations.json 的 tra_sched 沒有「${s.name}」的英文名，推不出網址（要先補官方譯名）`);
  }
  for (const n of traPendingStops) ok(10, !i18n.systems.tra_sched[n]?.en, `台鐵站「${n}」已有官方英文站名，卻仍被 scripts/fetch_tra.py 的 PENDING_STATIONS 比中、不產頁：整合完了就移除那一筆；不是待通車站就是名單誤中了真站`, `tra_sched 英文名 ${i18n.systems.tra_sched[n]?.en}`);
  for (const [n, x] of TRA_ALL) ok(10, !!x.addr, `台鐵站「${n}」的地址取不出縣市＋鄉鎮市區（tra_station_info.json）`, x.info ? x.info.address : '沒有這個站碼的紀錄');
  for (const n of EN_JA_SECOND) ok(10, SECOND.some(s => s.name === n), `英日文站「${n}」不在推導出的第二批站清單裡`);
  for (const n of Object.keys(SLUG_OVERRIDE)) ok(10, SECOND.some(s => s.name === n), `slug 覆寫表的「${n}」不在推導出的第二批站清單裡（覆寫過期？）`);
  const bySlug = new Map();
  for (const s of ALL) (bySlug.get(s.slug) || bySlug.set(s.slug, []).get(s.slug)).push(s.batch === 1 ? `第一批 ${s.slug}` : `第二批 ${s.name}`);
  for (const [slug, who] of bySlug) ok(10, who.length === 1, `網址 slug「${slug}」重複（不准默默覆蓋）`, who.join('、'));
  for (const slug of [...NAMED, ...NAMED2]) ok(10, ALL.some(s => s.slug === slug), `指名站 ${slug} 不在站清單裡`);
  // 磁碟：每個期望的頁都在、沒有多出來的
  for (const lang of LANGS) {
    const dir = siteFile(PAGE_DIR[lang]);
    const want = stationsOf(lang).map(s => s.slug);
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const dirs = entries.filter(n => fs.statSync(path.join(dir, n)).isDirectory());
    const stray = entries.filter(n => !dirs.includes(n) && n !== 'index.html');
    const missing = want.filter(s => !fs.existsSync(path.join(dir, s, 'index.html'))).sort();
    const extra = dirs.filter(n => !want.includes(n)).sort();
    ok(10, missing.length === 0, `${PAGE_DIR[lang]}/ 缺 ${missing.length} 個期望的站頁`, clip(missing));
    ok(10, extra.length === 0, `${PAGE_DIR[lang]}/ 多出 ${extra.length} 個不該有的站頁資料夾`, clip(extra));
    ok(10, stray.length === 0, `${PAGE_DIR[lang]}/ 底下有站資料夾以外的檔案`, clip(stray));
  }
  // /stations/zuoying/ 仍是第一批那頁（含高鐵左營時刻段）；zuoying-tra 只有台鐵
  const zy = STATIONS.find(s => s.slug === 'zuoying');
  ok(10, !!zy && zy.members.includes('THSR:1070') && zy.members.includes('TRA:4340'), '第一批 zuoying 的成員應含高鐵左營（THSR:1070）與台鐵新左營（TRA:4340）', zy ? zy.members.join(',') : '沒有 zuoying');
  const zyf = siteFile('stations/zuoying/index.html'), ztf = siteFile('stations/zuoying-tra/index.html');
  if (fs.existsSync(zyf)) { const ids = parsePage(fs.readFileSync(zyf, 'utf8')).sections.map(s => s.id); ok(10, ids.includes('thsr-1070') && ids.includes('tra-4340'), '/stations/zuoying/ 仍要是第一批那頁（含高鐵左營 thsr-1070 與台鐵新左營 tra-4340 時刻段）', `現在的時刻段：${ids.join(',') || '（無）'}`); }
  if (fs.existsSync(ztf)) { const ids = parsePage(fs.readFileSync(ztf, 'utf8')).sections.map(s => s.id); ok(10, ids.length === 1 && ids[0] === 'tra-4350', '/stations/zuoying-tra/ 只該有台鐵左營（tra-4350）一段', `現在的時刻段：${ids.join(',') || '（無）'}`); }
}

// G11（推導模型的部分）：三個語言的站數＝具名常數
function checkModelCounts() {
  for (const lang of LANGS) ok(11, stationsOf(lang).length === EXPECT_STATIONS[lang], `推導出的 ${lang} 站頁數必須是 ${EXPECT_STATIONS[lang]}（具名覆蓋率常數）`, `推導 ${stationsOf(lang).length}（第一批 ${STATIONS.length}＋第二批 ${stationsOf(lang).length - STATIONS.length}）；資料出現新站或站名變動時要人工確認再改常數`);
}

// G12：每一頁的 hreflang／canonical／頁尾語言連結／內部連結，以及三個索引頁
function expectedAlts(st) {
  const zh = urlOf('zh', st.slug);
  return st.langs.length === LANGS.length ? { 'zh-Hant': zh, en: urlOf('en', st.slug), ja: urlOf('ja', st.slug), 'x-default': zh } : { 'zh-Hant': zh, 'x-default': zh };
}
function checkAlts(tag, m, want, onlyZh) {
  const got = new Map(); let dup = [];
  for (const [hl, href] of m.alts) { if (got.has(hl)) dup.push(hl); got.set(hl, href); }
  ok(12, dup.length === 0, `${tag} hreflang 重複`, dup.join('、'));
  for (const hl of got.keys()) ok(12, hl in want, `${tag} 不該有 hreflang="${hl}" 的 alternate`, `${onlyZh ? '只有中文的頁 alternate 恰為 zh-Hant＋x-default；' : ''}指向 ${got.get(hl)}`);
  for (const [hl, url] of Object.entries(want)) ok(12, got.get(hl) === url, `${tag} hreflang="${hl}" 應指向 ${url}`, `實際 ${got.get(hl) ?? '（沒有）'}`);
  for (const [hl, url] of got) { const f = urlToFile(url); ok(12, !!f && fs.existsSync(f), `${tag} hreflang="${hl}" 的目標不存在`, url); }
}
function checkPagesMeta() {
  for (const st of ALL) for (const lang of st.langs) {
    const f = siteFile(PAGE_DIR[lang], st.slug, 'index.html');
    if (!fs.existsSync(f)) continue;   // 缺頁由 G10 列出
    const html = fs.readFileSync(f, 'utf8'), m = parseMeta(html), tag = `${lang} ${st.slug}`;
    ok(12, m.htmlLang === HTML_LANG[lang], `${tag} <html lang> 應為 ${HTML_LANG[lang]}`, `實際 ${m.htmlLang}`);
    ok(12, m.canon.length === 1 && m.canon[0] === urlOf(lang, st.slug), `${tag} canonical 應恰為自己的網址`, `實際 ${m.canon.join('、') || '（沒有）'}、應為 ${urlOf(lang, st.slug)}`);
    checkAlts(tag, m, expectedAlts(st), st.langs.length < LANGS.length);
    if (lang === 'zh') {   // 頁尾的 English／日本語連結：有對應頁連到對應頁，沒有就連到該語言的索引
      const three = st.langs.length === LANGS.length;
      ok(12, m.footEn === (three ? `${PREFIX.en}${st.slug}/` : PREFIX.en), `${tag} 頁尾 English 連結不符`, `實際 ${m.footEn ?? '（沒有）'}、應為 ${three ? `${PREFIX.en}${st.slug}/` : PREFIX.en}`);
      ok(12, m.footJa === (three ? `${PREFIX.ja}${st.slug}/` : PREFIX.ja), `${tag} 頁尾 日本語 連結不符`, `實際 ${m.footJa ?? '（沒有）'}、應為 ${three ? `${PREFIX.ja}${st.slug}/` : PREFIX.ja}`);
    }
    const broken = [...new Set(m.stationLinks)].filter(l => !fs.existsSync(path.join(site, l, 'index.html')));
    ok(12, broken.length === 0, `${tag} 內部連結指到不存在的站頁`, clip(broken, 12));
  }
  for (const lang of LANGS) {   // 三個索引頁：四個 alternate 互指、canonical 指自己
    const f = siteFile(PAGE_DIR[lang], 'index.html');
    if (!fs.existsSync(f)) { ok(12, false, `${lang} 索引頁不存在`, path.relative(site, f)); continue; }
    const m = parseMeta(fs.readFileSync(f, 'utf8'));
    ok(12, m.canon.length === 1 && m.canon[0] === urlOf(lang), `${lang} 索引 canonical 應為 ${urlOf(lang)}`, `實際 ${m.canon.join('、') || '（沒有）'}`);
    checkAlts(`${lang} 索引`, m, { 'zh-Hant': urlOf('zh'), en: urlOf('en'), ja: urlOf('ja'), 'x-default': urlOf('zh') }, false);
  }
}
function checkSitemap() {
  const f = siteFile('sitemap.xml');
  if (!ok(12, fs.existsSync(f), 'sitemap.xml 不存在')) return;
  const locs = [...fs.readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1].trim()));
  const dups = locs.filter((u, i) => locs.indexOf(u) !== i);
  ok(12, dups.length === 0, 'sitemap 有重複的網址', clip([...new Set(dups)], 12));
  const inStations = u => LANGS.some(l => u.startsWith(SITE_BASE + PREFIX[l]));
  const got = new Set(locs.filter(inStations));
  const want = new Set([...LANGS.map(l => urlOf(l)), ...ALL.flatMap(s => s.langs.map(l => urlOf(l, s.slug)))]);
  const missing = [...want].filter(u => !got.has(u)).sort(), extra = [...got].filter(u => !want.has(u)).sort();
  ok(12, missing.length === 0, `sitemap 漏了 ${missing.length} 個車站頁網址`, clip(missing.map(u => u.slice(SITE_BASE.length)), 40));
  ok(12, extra.length === 0, `sitemap 多了 ${extra.length} 個不該有的車站網址`, clip(extra.map(u => u.slice(SITE_BASE.length)), 40));
  const ghost = [...got].filter(u => { const p = urlToFile(u); return !p || !fs.existsSync(p); }).sort();
  ok(12, ghost.length === 0, `sitemap 含 ${ghost.length} 個磁碟上不存在的網址`, clip(ghost.map(u => u.slice(SITE_BASE.length)), 40));
  const wantCount = EXPECT_ZH_STATIONS + EXPECT_EN_STATIONS + EXPECT_JA_STATIONS + LANGS.length;
  ok(12, got.size === wantCount, `sitemap 的車站網址數必須是 ${wantCount}（${EXPECT_ZH_STATIONS}＋${EXPECT_EN_STATIONS}＋${EXPECT_JA_STATIONS}＋${LANGS.length} 個索引）`, `實際 ${got.size}`);
  log(`G12 sitemap：車站網址 ${got.size} 個（期望 ${wantCount}）；漏 ${missing.length}、多 ${extra.length}、磁碟上不存在 ${ghost.length}`);
}

// G13：第二批頁的導言與轉乘事實（期望值全部從原始資料算）
const PARTNER_SYS = {   // 轉乘夥伴的系統名。規格：「照 build_metro_pages.mjs 既有寫法」——這裡收路線圖頁面用過的寫法與常見簡稱；產生器另選寫法時在這加一行
  KRTC: ['高雄捷運', '高捷'],
  TMRT: ['台中捷運', '臺中捷運', '中捷'],
  KLRT: ['高雄捷運環狀輕軌', '高雄捷運', '高雄輕軌', '環狀輕軌', '輕軌'],
  SANYING: ['新北捷運三鶯線', '新北捷運', '三鶯線'],
};
const traNameById = new Map([...traRecByName.values()].map(r => [r.stationId, r.name]));
function secondFacts(st) {
  const code = st.members[0].split(':')[1];
  const rec = transfers.stations[`TRA:${code}`], info = infoById.get(code);
  const routes = (rec.routes || []).map(k => { const ln = traLineNames[k.split(':')[1]]; return { key: k, zh: ln ? ln.zh : null, en: ln ? ln.en : null }; });   // 台鐵路線名一律取 TDX 官方字面（tra_line_names.json），不取 station_transfers.json 的 routes[].name（App 簡稱）
  const ts = transfers.transferStations.find(t => t.members.includes(`TRA:${code}`));
  const partners = [];
  for (const p of ts ? ts.pairs : []) {
    const other = p.a === `TRA:${code}` ? p.b : p.b === `TRA:${code}` ? p.a : null;
    if (!other || other.startsWith('TRA:')) continue;
    const o = transfers.stations[other];
    partners.push({ key: other, sys: other.split(':')[0], name: o.name, norm: o.normalizedName, meters: Math.round(p.distanceM), raw: p.distanceM });
  }
  const th = thsrByNorm.get(norm(st.name));
  const hsr = th && !partners.some(p => p.key === th.key) ? { key: th.key, name: th.name, km: Math.round(kmBetween(rec.position, th.position)) } : null;
  return { code, rec, info, addr: info ? parseAddress(info.address) : null, routes, partners, hsr, none: partners.length === 0 && routes.length <= 1 && !hsr };
}
function neighborNames(name) {   // 規則 5：這一站經過的每條路線，前後各一個「有頁面的站」。兩種讀法都收：A 跳過沒頁面的站繼續往外找；B 只看緊鄰、緊鄰沒頁面就不放
  const rec = traRecByName.get(name), A = new Set(), B = new Set();
  for (const key of rec.routes || []) {
    const line = traLines.find(l => l.lineId === key.split(':')[1]);
    if (!line) continue;
    const seq = [...line.stations].sort((a, b) => a.seq - b.seq), i = seq.findIndex(x => x.id === rec.stationId);
    if (i < 0) continue;
    for (const d of [-1, 1]) {
      const nb = traNameById.get((seq[i + d] || {}).id);
      if (nb && TRA_ALL.has(nb)) B.add(nb);
      for (let j = i + d; seq[j]; j += d) { const n = traNameById.get(seq[j].id); if (n && TRA_ALL.has(n)) { A.add(n); break; } }
    }
  }
  return { A, B };
}
const partnerText = p => `${(PARTNER_SYS[p.sys] || [p.sys])[0]}${/站$/.test(p.name) ? p.name : `${p.name}站`}`;   // 只給訊息用的示意寫法；實際比對見 partnerRe（多種寫法都收）
const hrefToTraName = new Map([...TRA_ALL.values()].map(x => [`${PREFIX.zh}${x.slug}/`, x.name]));
function partnerRe(p, tail, head = '') {   // 「{系統名}{站名}站」：站名本身已以「站」結尾（岡山車站、橋頭火車站）就不再加一個站
  const sysAlt = (PARTNER_SYS[p.sys] || []).map(escRe).join('|');
  const forms = [...new Set([`${p.norm}站`, `${p.name.replace(/(火車站|車站|站)$/, '')}站`, /站$/.test(p.name) ? p.name : `${p.name}站`])].map(escRe).join('|');
  return sysAlt ? new RegExp(`${head}(?:${sysAlt})(?:${forms})${tail}`) : null;
}

const g13Branch = { zhPages: 0, enPages: 0, jaPages: 0, partner: 0, multi: 0, hsr: 0, none: 0 };   // 各分支實際被行使的次數（判準沒被行使＝沒驗）
// 事實表「路線」的台鐵路線名（第一批與第二批的中文頁都跑）：一律等於 TDX 官方字面（tra_line_names.json 的 zh，如「西部幹線 (海線)」的半形括號），
// 不是 station_transfers.json 的 routes[].name——那是 App 簡稱，TRA:WL 寫「西部幹線（山線）」但它涵蓋基隆到屏東，寫進站頁是事實錯誤。
// 以「、」拆成集合比對，不用 includes：「海線」是「西部幹線 (海線)」的子字串，「西部幹線」是它的前綴。
function checkTraRouteFact(tag, st, page) {
  const keys = new Set(st.members.filter(m => m.startsWith('TRA:')).flatMap(m => ((transfers.stations[m] || {}).routes || [])).filter(k => k.startsWith('TRA:')));
  const rawFact = strip(page.facts.get('路線') || ''), got = new Set(rawFact.split('、').map(s => s.trim()));
  for (const k of keys) { const ln = traLineNames[k.split(':')[1]]; ok(13, !!ln && got.has(ln.zh), `${tag} 事實表「路線」缺台鐵官方路線名「${ln ? ln.zh : k}」（tra_line_names.json）`, rawFact); }
  for (const [id, ln] of Object.entries(traLineNames)) if (!keys.has(`TRA:${id}`)) ok(13, !got.has(ln.zh), `${tag} 事實表「路線」多了不屬於本站的「${ln.zh}」`, rawFact);
  const official = new Set(Object.values(traLineNames).map(ln => ln.zh));
  for (const [k, v] of Object.entries(transfers.routes)) if (k.startsWith('TRA:') && !official.has(v.name)) ok(13, !got.has(v.name), `${tag} 事實表「路線」不得出現 App 簡稱「${v.name}」（不是 TDX 官方路線名）`, rawFact);
}
function verifySecondZh(st, page, html, F) {
  const tag = `zh ${st.slug}`, meta = parseMeta(html);
  g13Branch.zhPages++; if (F.partners.length) g13Branch.partner++; if (F.routes.length > 1) g13Branch.multi++; if (F.hsr) g13Branch.hsr++; if (F.none) g13Branch.none++;
  // 標題（規則 1）
  ok(13, page.h1.includes(st.title), `${tag} <h1> 應含標題「${st.title}」`, page.h1);
  ok(13, meta.titleTag.includes(st.title), `${tag} <title> 應含「${st.title}」`, meta.titleTag);
  if (st.name in SLUG_OVERRIDE) ok(13, !page.h1.includes('轉乘站'), `${tag} 台鐵${st.name}要跟「${st.name}轉乘站」分開寫，<h1> 不該出現「轉乘站」`, page.h1);
  // 導言（規則 2）：每句追得到資料
  const lede = page.lede;
  ok(13, !!F.addr, `${tag} 地址解析不了（資料缺）`);
  const rm = lede.match(/是台鐵(.+?)的車站，位於/);
  if (ok(13, !!rm && lede.includes(`${st.name}車站是台鐵`), `${tag} 導言應為「${st.name}車站是台鐵…的車站，位於…。」句型`, lede.slice(0, 70))) {
    const gotRoutes = new Set(rm[1].split('、')), wantRoutes = new Set(F.routes.map(r => r.zh));
    ok(13, setEq(gotRoutes, wantRoutes), `${tag} 導言的路線名不符 routes`, `頁面「${[...gotRoutes].join('、')}」、資料「${[...wantRoutes].join('、')}」`);
  }
  if (F.addr) ok(13, lede.includes(`位於${F.addr.county}${F.addr.town}。`), `${tag} 導言的縣市＋鄉鎮市區應為「${F.addr.county}${F.addr.town}」`, `地址 ${F.info.address}；導言「${lede.slice(0, 80)}」`);
  ok(13, F.partners.length === 0 ? !lede.includes('可步行轉乘') : true, `${tag} 沒有轉乘夥伴的站，導言不該寫「可步行轉乘」`, lede);
  for (const p of F.partners) {
    const re = partnerRe(p, '。', '可步行轉乘');
    ok(13, !!re && re.test(lede), `${tag} 導言應有「可步行轉乘${partnerText(p)}。」（夥伴 ${p.key}；系統名容許 ${(PARTNER_SYS[p.sys] || []).join('／')}）`, `導言「${lede.slice(0, 100)}」`);
  }
  // 轉乘段（規則 3）
  const T = page.transferText;
  if (!ok(13, T !== null, `${tag} 沒有 id="transfer" 的轉乘段`)) return;
  for (const p of F.partners) {
    const re = partnerRe(p, '與台鐵站點在資料中相距約 (\\d+) 公尺，屬步行轉乘，不代表同一月台。');
    if (!ok(13, !!re, `${tag} PARTNER_SYS 沒有系統 ${p.sys} 的寫法，驗不了轉乘句`)) continue;
    const m = T.match(re);
    if (ok(13, !!m, `${tag} 轉乘段缺「${partnerText(p)}與台鐵站點在資料中相距約 N 公尺，屬步行轉乘，不代表同一月台。」（夥伴 ${p.key}）`, T.slice(0, 120))) ok(13, +m[1] === p.meters, `${tag} 轉乘公尺數不符 pairs`, `頁面 ${m[1]} 公尺、pairs ${p.raw}（四捨五入 ${p.meters}）`);
    ok(13, T.includes('資料中的距離用於辨識'), `${tag} 有轉乘夥伴的頁應保留「資料中的距離用於辨識…」那段`);
  }
  const mr = T.match(/本站同時屬於台鐵(.+?)。/);
  if (F.routes.length > 1) {
    if (ok(13, !!mr, `${tag} 多路線站（${F.routes.map(r => r.zh).join('、')}）轉乘段應有「本站同時屬於台鐵…。」`, T.slice(0, 100))) ok(13, setEq(new Set(mr[1].split(/與|、|及/)), new Set(F.routes.map(r => r.zh))), `${tag} 「本站同時屬於」的路線不符 routes`, `頁面「${mr[1]}」、資料「${F.routes.map(r => r.zh).join('、')}」`);
  } else ok(13, !mr, `${tag} 單一路線的站不該寫「本站同時屬於台鐵…」`, mr ? mr[0] : '');
  if (F.hsr) {
    const [firstSlug, secondSlug] = SAME_NAME_HSR[st.name] || [];
    const first = STATIONS.find(s => s.slug === firstSlug);
    const m = T.match(new RegExp(`高鐵${escRe(F.hsr.name)}站是另一個車站，與本站在資料中直線相距約 (\\d+) 公里，請看〈(.+?)〉。`));
    if (ok(13, !!m, `${tag} 轉乘段缺「高鐵${F.hsr.name}站是另一個車站，與本站在資料中直線相距約 N 公里，請看〈…〉。」`, T.slice(0, 100))) {
      ok(13, +m[1] === F.hsr.km, `${tag} 到高鐵${F.hsr.name}站的公里數不符（閘門用 haversine 自己算）`, `頁面 ${m[1]}、算出 ${F.hsr.km}`);
      ok(13, !!first && m[2] === first.title, `${tag} 〈…〉應是第一批頁標題「${first ? first.title : '（沒有這頁）'}」`, `頁面「${m[2]}」`);
    }
    ok(13, !!first && (page.transferHtml || '').includes(`href="${PREFIX.zh}${firstSlug}/"`), `${tag} 轉乘段應連到第一批頁 ${PREFIX.zh}${firstSlug}/`);
    ok(13, secondSlug === st.slug, `${tag} 同名高鐵站的規格常數 SAME_NAME_HSR 與這頁的 slug 對不上`, `常數 ${secondSlug}、頁面 ${st.slug}`);
  } else ok(13, !/高鐵.{1,8}站是另一個車站/.test(T), `${tag} 沒有同名高鐵站的頁不該寫「高鐵…站是另一個車站」`);
  const noneS = '軌島的轉乘資料沒有列出本站與其他軌道系統的轉乘。';
  ok(13, F.none === T.includes(noneS), `${tag} ${F.none ? '沒有任何轉乘的頁要有' : '有轉乘資訊的頁不該有'}「${noneS}」`, `該站夥伴 ${F.partners.length}、路線 ${F.routes.length}、同名高鐵 ${F.hsr ? 1 : 0}`);
  // 事實表（規則 4，沿用第一批口徑）
  const fv = label => strip(page.facts.get(label) || '');
  ok(13, fv('軌島站點').includes(`台鐵 ${st.name}（${F.code}）`), `${tag} 事實表「軌島站點」應含「台鐵 ${st.name}（${F.code}）」`, fv('軌島站點'));
  ok(13, !!F.info && fv('台鐵地址') === F.info.address, `${tag} 事實表「台鐵地址」應等於 tra_station_info.json 的地址`, `頁面「${fv('台鐵地址')}」、資料「${F.info ? F.info.address : '（無）'}」`);
  ok(13, fv('參考座標') === `${F.rec.position[0].toFixed(6)}, ${F.rec.position[1].toFixed(6)}`, `${tag} 事實表「參考座標」應為 station_transfers 的座標（小數 6 位）`, `頁面「${fv('參考座標')}」、資料 ${F.rec.position.join(', ')}`);
  checkTraRouteFact(tag, st, page);
  // 附近的車站（規則 5）
  const { A, B } = neighborNames(st.name), got = new Set();
  for (const c of page.cards) {
    const nm = hrefToTraName.get(c.href);
    if (!ok(13, nm !== undefined, `${tag} 「附近的車站」連到不是台鐵站頁的網址`, String(c.href))) continue;
    ok(13, !got.has(nm), `${tag} 「附近的車站」重複列了「${nm}」`);
    got.add(nm);
  }
  ok(13, got.size >= 1 && got.size <= 4, `${tag} 「附近的車站」數量應為 1–4 個`, `實際 ${got.size}`);
  const okSet = setEq(got, A) || setEq(got, B) || ((A.size > 4 || B.size > 4) && got.size === 4 && [...got].every(n => A.has(n) || B.has(n)));
  ok(13, okSet, `${tag} 「附近的車站」應是同路線前後相鄰、有頁面的站（去重、最多 4 個）`, `頁面 ${[...got].join('、')}；期望（跳過沒頁面的）${[...A].join('、')}／（只看緊鄰）${[...B].join('、')}`);
}

function verifySecondEnJa(st, lang, html, page, F) {
  const tag = `${lang} ${st.slug}`, meta = parseMeta(html);
  g13Branch[`${lang}Pages`]++;
  const nameL = tr(lang, 'station', st.name, 'TRA');
  if (!ok(13, nameL !== null, `${tag} i18n 缺「${st.name}」的 ${lang} 站名`)) return;
  ok(13, page.h1.includes(nameL), `${tag} <h1> 應含站名「${nameL}」`, page.h1);
  ok(13, meta.titleTag.includes(nameL), `${tag} <title> 應含站名「${nameL}」`, meta.titleTag);
  const lede = page.lede, T = page.transferText || '';
  ok(13, page.transferText !== null, `${tag} 沒有 id="transfer" 的轉乘段`);
  if (lang === 'en') {
    const m = lede.match(/station on the ([^.]+)\./);
    if (ok(13, lede.includes(`${nameL} Station is a Taiwan Railway (TRA) station on the `) && !!m, `${tag} 導言應為「${nameL} Station is a Taiwan Railway (TRA) station on the …」句型`, lede.slice(0, 90))) {
      for (const r of F.routes) ok(13, m[1].includes(r.en), `${tag} 導言缺路線英文名「${r.en}」（tra_line_names.json）`, m[1]);
      for (const [k, v] of Object.entries(traLineNames)) if (!F.routes.some(r => r.key === `TRA:${k}`)) ok(13, !m[1].includes(v.en) || F.routes.some(r => r.en && r.en.includes(v.en)), `${tag} 導言多了不屬於本站的路線「${v.en}」`, m[1]);
    }
    ok(13, !CJK.test(`${meta.titleTag} ${meta.metaDesc} ${meta.ogTitle} ${meta.ogDesc}`), `${tag} 英文頁的標題／描述不得含中日文字（漏譯）`, (`${meta.titleTag} ${meta.metaDesc}`.match(new RegExp(`.{0,12}${CJK.source}+.{0,12}`)) || [''])[0]);
    ok(13, !CJK.test(lede + T), `${tag} 英文頁導言與轉乘段不得含中日文字（漏譯）`);
    if (F.routes.length > 1) for (const r of F.routes) ok(13, T.includes(r.en), `${tag} 多路線站的轉乘段應寫出路線「${r.en}」`, T.slice(0, 100));
    else if (F.none) ok(13, /transfer data does not list/i.test(T), `${tag} 沒有任何轉乘的頁，轉乘段要有「transfer data does not list…」那一句（沿用第一批高鐵彰化頁的英文措辭）`, T.slice(0, 100));
  } else {
    const m = lede.match(/駅は台鉄（TRA）の(.+?)の駅です。/);
    if (ok(13, lede.includes(`${nameL}駅は台鉄（TRA）の`) && !!m, `${tag} 導言應為「${nameL}駅は台鉄（TRA）の…の駅です。」句型`, lede.slice(0, 70))) ok(13, setEq(new Set(m[1].split('・')), new Set(F.routes.map(r => r.zh))), `${tag} 導言的路線名不符 routes（日文照抄中文路線名，以「・」連接）`, `頁面「${m[1]}」、資料「${F.routes.map(r => r.zh).join('・')}」`);
    if (F.addr) ok(13, !lede.includes(F.addr.county) && !lede.includes(F.addr.town), `${tag} 日文頁不寫縣市鄉鎮（沒有官方譯名來源）`, lede.slice(0, 80));
    if (F.routes.length > 1) for (const r of F.routes) ok(13, T.includes(r.zh), `${tag} 多路線站的轉乘段應寫出路線「${r.zh}」`, T.slice(0, 100));
    else if (F.none) ok(13, /乗り換えデータ[\s\S]*?載っていません/.test(T), `${tag} 沒有任何轉乘的頁，轉乘段要有「乗り換えデータ…載っていません」那一句（沿用第一批高鐵彰化頁的日文措辭）`, T.slice(0, 100));
  }
}

// G14：三個索引頁
function itemListOf(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    if (j.mainEntity && j.mainEntity['@type'] === 'ItemList') return j.mainEntity;
  }
  return null;
}
function checkIndexes() {
  for (const lang of LANGS) {
    const f = siteFile(PAGE_DIR[lang], 'index.html');
    if (!ok(14, fs.existsSync(f), `${lang} 索引頁不存在`, path.relative(site, f))) continue;
    const html = fs.readFileSync(f, 'utf8'), page = parsePage(html), tag = `${lang} 索引`;
    const wantSt = stationsOf(lang), wantUrls = new Set(wantSt.map(s => urlOf(lang, s.slug)));
    // ItemList：網址集合＝這個語言所有站頁、不重複
    const il = itemListOf(html);
    if (ok(14, !!il, `${tag} 缺 ItemList（JSON-LD）`)) {
      const urls = (il.itemListElement || []).map(x => x.url), uniq = new Set(urls);
      ok(14, urls.length === uniq.size, `${tag} ItemList 網址重複`, clip(urls.filter((u, i) => urls.indexOf(u) !== i), 10));
      ok(14, il.numberOfItems === urls.length && urls.length === EXPECT_STATIONS[lang], `${tag} ItemList 必須恰 ${EXPECT_STATIONS[lang]} 個不重複網址且 numberOfItems 一致`, `numberOfItems=${il.numberOfItems}、實際 ${urls.length}、不重複 ${uniq.size}`);
      const miss = [...wantUrls].filter(u => !uniq.has(u)), extra = [...uniq].filter(u => !wantUrls.has(u));
      ok(14, miss.length === 0 && extra.length === 0, `${tag} ItemList 的網址集合應等於全部站頁`, `缺 ${clip(miss.map(u => u.slice(SITE_BASE.length)), 10)}；多 ${clip(extra.map(u => u.slice(SITE_BASE.length)), 10)}`);
    }
    // 卡片：中文＝原本 23 張（第一批），英日文＝30 張（不分組）
    const wantCards = new Set((lang === 'zh' ? ALL.filter(s => s.batch === 1) : wantSt).map(s => `${PREFIX[lang]}${s.slug}/`));
    const gotCards = page.cards.map(c => c.href);
    ok(14, gotCards.length === wantCards.size && setEq(new Set(gotCards), wantCards), `${tag} 卡片應恰為 ${wantCards.size} 張（${lang === 'zh' ? '原本的第一批 23 張' : '英日文 30 站不分組'}）`, `實際 ${gotCards.length} 張；缺 ${clip([...wantCards].filter(u => !gotCards.includes(u)), 8)}；多 ${clip(gotCards.filter(u => !wantCards.has(u)), 8)}`);
    const stale = { zh: /第一批/, en: /first (?:station pages|batch)/i, ja: /最初の駅ページ|第一弾|第1弾/ }[lang].exec(page.mainText);
    ok(14, !stale, `${tag} 不該再有「這是第一批車站頁」這類字樣`, stale ? stale[0] : '');
    if (lang !== 'zh') {
      ok(14, !/id="all-stations"/.test(html), `${tag} 英日文索引不分組（不該有 id="all-stations"）`);
      const anchors = [...page.main.matchAll(/<a\b([^>]*)>/g)].map(m => m[1]);
      ok(14, anchors.some(a => /href="\/stations\/"/.test(a) && /hreflang="zh-Hant"/.test(a)), `${tag} 說明段要連到中文索引 /stations/（hreflang="zh-Hant"）`);
    }
  }
  checkGroupedIndex();
}
// 中文索引「全部台鐵車站」分組區塊的最小結構約定（閘門只解析這些，其餘 markup 隨便）：
//   <section … id="all-tra"> … <nav>…<a href="#tra-county-NN">縣市<small>N</small></a>…</nav>          ← 上方跳轉按鈕，每組一個
//     <h3 id="tra-county-NN">縣市<small>N 站</small></h3> 後面接該組的站連結 <a href="/stations/{slug}/">站名</a>（到下一個 h3 為止）
//   … </section>
// 換分組方案（例如改成依路線）時，改這兩個常數與 checkGroupedIndex 的期望歸屬即可。
const IDX_SECTION_ID = 'all-tra', IDX_GROUP_PREFIX = 'tra-county-';
function checkGroupedIndex() {
  const f = siteFile('stations/index.html');
  if (!fs.existsSync(f)) return;
  const html = fs.readFileSync(f, 'utf8'), page = parsePage(html), tag = 'zh 索引分組';
  const sm = page.main.match(new RegExp(`<section\\b[^>]*\\bid="${IDX_SECTION_ID}"[^>]*>([\\s\\S]*?)</section>`));
  if (!ok(14, !!sm, `${tag} 缺 <section id="${IDX_SECTION_ID}">（全部台鐵車站的分組區塊）`)) return;
  const groups = [];
  for (const part of sm[1].split(new RegExp(`<h3\\b[^>]*\\bid="${IDX_GROUP_PREFIX}`)).slice(1)) {
    const id = `${IDX_GROUP_PREFIX}${part.slice(0, part.indexOf('"'))}`;
    const hm = part.match(/^[^"]*"[^>]*>([\s\S]*?)<\/h3>/);
    const rest = hm ? part.slice(hm[0].length) : part;
    const title = hm ? strip(hm[1]).trim() : '';
    groups.push({ id, title, county: norm(title).slice(0, 3), n: (title.match(/(\d+) 站/) || [])[1], links: [...rest.matchAll(/<a\b[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ href: m[1], text: strip(m[2]).trim() })) });
  }
  ok(14, groups.length > 0, `${tag} 沒有任何縣市分組（<h3 id="${IDX_GROUP_PREFIX}…">）`);
  ok(14, new Set(groups.map(g => g.id)).size === groups.length, `${tag} 分組 id 重複`);
  ok(14, new Set(groups.map(g => g.county)).size === groups.length, `${tag} 同一個縣市出現在兩個分組`, clip(groups.map(g => g.county).filter((c, i, a) => a.indexOf(c) !== i), 6));
  for (const g of groups) {
    ok(14, g.links.length > 0, `${tag} 「${g.title}」是空的分組`);
    if (g.n !== undefined) ok(14, +g.n === g.links.length, `${tag} 「${g.county}」標題寫 ${g.n} 站、實際連結 ${g.links.length} 個`);
  }
  // 縣市集合＝台鐵站地址裡出現的縣市（從原始資料算）
  const wantCounties = new Set([...TRA_ALL.values()].filter(x => x.addr).map(x => norm(x.addr.county)));
  ok(14, setEq(new Set(groups.map(g => g.county)), wantCounties), `${tag} 分組的縣市集合應等於台鐵站地址裡的縣市（${wantCounties.size} 個）`, `缺 ${clip([...wantCounties].filter(c => !groups.some(g => g.county === c)), 8)}；多 ${clip(groups.map(g => g.county).filter(c => !wantCounties.has(c)), 8)}`);
  ok(14, new RegExp(`(?<!\\d)${TRA_ALL.size}(?!\\d)`).test(strip(sm[1]).slice(0, 400)), `${tag} 分組區塊的說明要寫出台鐵站數 ${TRA_ALL.size}（不可寫死過期的數字）`, strip(sm[1]).slice(0, 120));
  // 每個台鐵站恰出現一次、歸在自己地址的縣市下、第一批成員連到第一批頁、連結目標存在
  const where = new Map();   // href → [{group, text}]
  for (const g of groups) for (const l of g.links) (where.get(l.href) || where.set(l.href, []).get(l.href)).push({ g, text: l.text });
  const wantHrefs = new Set();
  for (const [name, x] of TRA_ALL) {
    const href = `${PREFIX.zh}${x.slug}/`; wantHrefs.add(href);
    const hits = where.get(href) || [];
    if (!ok(14, hits.length === 1, `${tag} 台鐵「${name}」應恰出現一次（連到 ${href}${x.first ? '，第一批成員連到它所在的第一批頁' : ''}）`, `出現 ${hits.length} 次`)) continue;
    const h = hits[0];
    if (x.addr) ok(14, h.g.county === norm(x.addr.county), `${tag} 台鐵「${name}」應歸在「${x.addr.county}」下`, `頁面歸在「${h.g.title}」（地址 ${x.info.address}）`);
    ok(14, norm(h.text).includes(norm(name)), `${tag} 台鐵「${name}」的連結文字應含站名`, `文字「${h.text}」`);
    ok(14, fs.existsSync(siteFile(href.slice(1), 'index.html')), `${tag} 台鐵「${name}」的連結目標不存在`, href);
  }
  const unexpected = [...where.keys()].filter(h => !wantHrefs.has(h));
  ok(14, unexpected.length === 0, `${tag} 分組區塊出現不是台鐵站的網址`, clip(unexpected, 10));
  const total = [...where.values()].reduce((n, a) => n + a.length, 0);
  ok(14, total === TRA_ALL.size, `${tag} 分組區塊的連結總數必須等於台鐵站數 ${TRA_ALL.size}`, `實際 ${total}`);
  // 上方跳轉按鈕：每組一個 <a href="#tra-county-NN">，文字是該縣市（有 <small>N</small> 的要等於該組站數），目標存在
  const jumps = [...page.main.matchAll(new RegExp(`<a\\b[^>]*?\\bhref="#(${IDX_GROUP_PREFIX}[^"]+)"[^>]*>([\\s\\S]*?)</a>`, 'g'))].map(m => ({ id: m[1], text: strip(m[2]).trim(), n: (m[2].match(/<small>(\d+)<\/small>/) || [])[1] }));
  ok(14, jumps.length === groups.length && setEq(new Set(jumps.map(j => j.id)), new Set(groups.map(g => g.id))), `${tag} 跳轉按鈕（href="#${IDX_GROUP_PREFIX}…"）應與分組一一對應`, `按鈕 ${jumps.length}、分組 ${groups.length}；沒有按鈕的組 ${clip(groups.map(g => g.id).filter(i => !jumps.some(j => j.id === i)), 6)}；按鈕沒有目標 ${clip(jumps.map(j => j.id).filter(i => !groups.some(g => g.id === i)), 6)}`);
  for (const j of jumps) {
    const g = groups.find(x => x.id === j.id); if (!g) continue;
    ok(14, norm(j.text).startsWith(g.county), `${tag} 跳轉按鈕「${j.text}」與它指向的分組「${g.county}」不符`);
    if (j.n !== undefined) ok(14, +j.n === g.links.length, `${tag} 跳轉按鈕「${g.county}」標 ${j.n} 站、實際連結 ${g.links.length} 個`);
  }
  log(`G14 索引分組：${groups.length} 個縣市、${total} 個連結（台鐵站 ${TRA_ALL.size}）、跳轉按鈕 ${jumps.length}`);
}

// G15：第一批三頁的反向連結
function checkReverseLinks() {
  const derived = {};   // 由原始資料推：第二批站裡有同名高鐵站（不在同一轉乘組）的
  for (const s of SECOND) { const F = s.code ? secondFacts({ name: s.name, members: [`TRA:${s.code}`] }) : null; if (F && F.hsr) derived[s.name] = F.hsr.key; }
  ok(15, JSON.stringify(Object.keys(derived).sort()) === JSON.stringify(Object.keys(SAME_NAME_HSR).sort()), '由原始資料推出的「有同名高鐵站在別處」的台鐵站，應與規格常數 SAME_NAME_HSR 一致', `推導 ${Object.keys(derived).join('、')}；常數 ${Object.keys(SAME_NAME_HSR).join('、')}`);
  for (const [name, [firstSlug, secondSlug]] of Object.entries(SAME_NAME_HSR)) {
    const first = STATIONS.find(s => s.slug === firstSlug);
    ok(15, !!first && first.members.includes(derived[name]), `第一批 ${firstSlug} 應是含高鐵${name}（${derived[name] || '?'}）的那一頁`, first ? first.members.join(',') : '沒有這個站設定');
    ok(15, ALL.some(s => s.slug === secondSlug && s.name === name), `台鐵${name}頁的 slug 應為 ${secondSlug}`, `推導 ${slugOf(name)}`);
    const f = siteFile('stations', firstSlug, 'index.html');
    if (!ok(15, fs.existsSync(f), `第一批 ${firstSlug} 頁不存在`)) continue;
    const page = parsePage(fs.readFileSync(f, 'utf8'));
    const links = [...(page.transferHtml || '').matchAll(/<a\b[^>]*?\bhref="([^"]+)"/g)].map(m => m[1]);
    ok(15, links.includes(`${PREFIX.zh}${secondSlug}/`), `中文 ${firstSlug} 轉乘段應有一個連到 ${PREFIX.zh}${secondSlug}/（台鐵${name}）的連結`, `轉乘段的連結：${links.join('、') || '（沒有）'}`);
    ok(15, fs.existsSync(siteFile('stations', secondSlug, 'index.html')), `${firstSlug} 連到的 ${secondSlug} 頁不存在`);
  }
}

// ───────────────────────── 主流程 ─────────────────────────
function seededRng(seed) {   // mulberry32
  let a = 0; for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 前置：站清單與資料一致性
ok(8, STATIONS.length > 0, '從 build_aeo_pages.mjs 擷取不到任何站設定');
for (const [sys, s] of Object.entries(DS)) {
  const first = s.dates[0], last = s.dates[s.dates.length - 1];
  ok(9, Array.isArray(s.range) && s.range[0] === first && s.range[1] === last, `${s.file} 自己的 dateRange 與 dates 鍵的首末日不一致`, `dateRange ${JSON.stringify(s.range)}、dates ${first}…${last}`);
  const days = s.dates.map(d => Date.UTC(...d.split('-').map((x, i) => (i === 1 ? +x - 1 : +x))));
  ok(9, days.every((t, k) => k === 0 || t - days[k - 1] === 86400000), `${s.file} 的 dates 不是逐日連續`);
}
checkStationList();   // G10：站清單獨立推導＋磁碟上的站頁
checkModelCounts();   // G11：推導出的三個語言站數＝具名常數

const rng = seededRng(opt.seed || String(Date.now()));
const seed = opt.seed || 'random-' + Math.floor(rng() * 1e9);
const allSlugs = ALL.map(s => s.slug);
const stOf = slug => ALL.find(s => s.slug === slug);
const namedSlugs = [...NAMED, ...NAMED2].filter(n => allSlugs.includes(n));
let picked;
if (opt.all) picked = allSlugs;
else {
  const pool = allSlugs.filter(s => !namedSlugs.includes(s));
  const r2 = seededRng(seed);
  const shuffled = pool.map(s => [r2(), s]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  picked = [...namedSlugs, ...shuffled.slice(0, opt.sample)];
}
log(`車站時刻頁閘門｜${opt.all ? '--all 全量' : `具名案例 ${[...NAMED, ...NAMED2].join('、')} ＋ 隨機 ${opt.sample} 站（seed=${seed}）`}｜共 ${picked.length} 站（第一批 ${picked.filter(s => stOf(s).batch === 1).length}、第二批 ${picked.filter(s => stOf(s).batch === 2).length}）`);

// 一次掃描資料，只算需要的站
const expByMember = new Map();
for (const slug of picked) {
  for (const m of stOf(slug).members) {
    const info = memberInfo(m);
    if (!info || expByMember.has(m)) continue;
    expByMember.set(m, buildExpected(info.sys, info.name));
  }
}
for (const [m, e] of expByMember) {
  ok(1, e.rowCount > 0, `${m}（${e.stationName}）在資料範圍內一班停靠的班次都沒有`);
  for (const a of e.anomalies) notes.push(`資料備註 ${m}：${a}`);
}
// 這一輪選定的站，各語言「從原始資料重算」的站數／段數／列數（G11 的分母；不靠頁面）
const expTotal = Object.fromEntries(LANGS.map(l => [l, { stations: 0, sections: 0, rows: 0 }]));
for (const slug of picked) {
  const st = stOf(slug);
  for (const lang of st.langs) {
    expTotal[lang].stations++;
    for (const m of st.members) { const e = expByMember.get(m); if (e) { expTotal[lang].sections += e.sectionCount; expTotal[lang].rows += e.rowCount; } }
  }
}

for (const slug of picked) {
  const st = stOf(slug);
  const members = st.members.map(memberInfo).filter(Boolean);
  const F = st.batch === 2 ? secondFacts(st) : null;
  for (const lang of st.langs) {
    const f = siteFile(PAGE_DIR[lang], slug, 'index.html');
    if (!fs.existsSync(f)) {   // 第二批的缺頁由 G10 統一列出；第一批維持原本 G1 的紅
      if (st.batch === 1) ok(1, false, `${lang} ${slug} 頁面不存在`, path.relative(site, f));
      continue;
    }
    const html = fs.readFileSync(f, 'utf8');
    const page = parsePage(html);
    // G7
    const hit = page.mainText.match(NO_PUBLISH_CLAIM[lang]);
    ok(7, !hit, `${lang} ${slug} 不斷言官方有沒有公開（只寫軌島的資料來源沒有）`, hit ? hit[0] : '');
    if (lang === 'en') ok(6, !CJK.test(page.mainText), `en ${slug} 英文頁 <main> 不得含中日文字`, (page.mainText.match(new RegExp(`.{0,16}${CJK.source}+.{0,16}`)) || [''])[0]);
    verifyStation(st, lang, page, members, expByMember);
    if (st.batch === 1 && lang === 'zh') checkTraRouteFact(`${lang} ${slug}`, st, page);
    if (st.batch === 2) { if (lang === 'zh') verifySecondZh(st, page, html, F); else verifySecondEnJa(st, lang, html, page, F); }
  }
}
// 整體結構（任何模式都跑全部頁）：G12 hreflang／sitemap、G14 索引、G15 反向連結
checkPagesMeta();
checkSitemap();
checkIndexes();
checkReverseLinks();

// G2 控制組：行駛日解析器自己要先過——手算的標籤展開結果（含「例外日」「缺席日」這兩個目前資料裡沒出現過、
// 但規格有的語法）；解析器解錯或不認得，這裡先紅，不會讓 G2 因為「解析器太寬鬆」而空過。
{
  // 手算的期望值是照 2026-09-27（日）…10/10（六）這 14 天寫的（9/28 週一與 10/9 週五是放假日），所以用這個固定日曆、不用資料當下的窗：
  // 每週重抓後窗會移走，拿新窗展開這些日期會整組無故轉紅（2026-09-30 用 10/15–10/28 的窗實測紅 13 項）。
  const cal = makeCal(Array.from({ length: 14 }, (_, k) => new Date(Date.UTC(2026, 8, 27 + k)).toISOString().slice(0, 10)));
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

// G13 控制組：閘門自己的地址解析器要先過（規則 2）。臺南市新市區必須解析成「新市區」而不是「新市」——
// 「新市」本身也是「以市結尾」，只要「區」的優先權被弄反就會錯；產生器與閘門各自實作，這裡守閘門這一邊。
{
  const cases = [
    ['744004臺南市新市區新和里中華路 1 號', '臺南市', '新市區'], ['744008臺南市新市區大營里大營 287-300 號', '臺南市', '新市區'],
    ['203001基隆市中山區中山一路 16 之 1 號', '基隆市', '中山區'], ['400005臺中市中區綠川里臺灣大道一段 1 號', '臺中市', '中區'],
    ['950030臺東縣臺東市岩灣里岩灣路 101 巷 598 號', '臺東縣', '臺東市'], ['959001臺東縣太麻里鄉三和村1鄰', '臺東縣', '太麻里鄉'],
    ['950042臺東縣卑南鄉溫泉村', '臺東縣', '卑南鄉'],
  ];
  for (const [addr, county, town] of cases) { const p = parseAddress(addr); ok(13, !!p && p.county === county && p.town === town, `地址解析器控制組：「${addr}」`, `解出 ${p ? p.county + p.town : 'null'}、應為 ${county}${town}`); }
  ok(13, parseAddress('') === null && parseAddress(undefined) === null, '地址解析器控制組：空地址必須回 null（取不到就不能默默放行）');
  for (const n of ['新市', '南科']) { const x = TRA_ALL.get(n); ok(13, !!x && !!x.addr && x.addr.county === '臺南市' && x.addr.town === '新市區', `具名案例：「${n}」（資料地址臺南市新市區）必須解析成「臺南市新市區」`, x && x.addr ? x.addr.county + x.addr.town : '解析失敗'); }
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

// G13 分支覆蓋：各種轉乘情形都要真的被驗到（預設模式靠指名案例保證前三種；夥伴分支只有 --all 才保證）
log(`G13 第二批頁：中文 ${g13Branch.zhPages}、英文 ${g13Branch.enPages}、日文 ${g13Branch.jaPages}；分支——轉乘夥伴 ${g13Branch.partner}、多路線 ${g13Branch.multi}、同名高鐵站 ${g13Branch.hsr}、沒有任何轉乘 ${g13Branch.none}`);
ok(13, g13Branch.multi >= 1 && g13Branch.hsr >= 1 && g13Branch.none >= 1, '第二批頁的三個基本分支（多路線、同名高鐵站、沒有任何轉乘）都要真的被驗到', JSON.stringify(g13Branch));
if (opt.all) ok(13, g13Branch.partner >= 1, '--all 時轉乘夥伴分支必須被驗到（判準沒被行使）', JSON.stringify(g13Branch));

// G8 覆蓋率＋G11 具名覆蓋率
if (!opt.quiet) {
  console.log('覆蓋率（站 × 語 × 段 × 列）：');
  for (const lang of LANGS) {
    const c = cov[lang];
    console.log(`  ${lang}：${c.stations} 站 × ${c.sections} 段 × ${c.rows} 列（列數比對成功 ${c.rowsMatched}／原始資料重算 ${expTotal[lang].rows}；期望段數 ${expTotal[lang].sections}；具名常數 ${EXPECT_STATIONS[lang]} 站${opt.all ? '' : '，--all 才驗'}）`);
  }
}
for (const lang of LANGS) {
  const c = cov[lang], e = expTotal[lang];
  ok(8, c.stations === e.stations, `${lang} 實際驗到的站數應等於選定站數`, `驗到 ${c.stations}、選定 ${e.stations}`);
  ok(8, c.sections === c.expSections, `${lang} 驗到的段數應等於原始資料算出的段數（分母不得無聲縮水）`, `驗到 ${c.sections}、原始資料 ${c.expSections}`);
  ok(8, c.rows === c.expRows, `${lang} 頁面上的列數應等於原始資料算出的總列數`, `頁面 ${c.rows}、原始資料 ${c.expRows}`);
  ok(8, c.rowsMatched === c.expRows, `${lang} 逐列比對成功的列數應等於原始資料的總列數`, `成功 ${c.rowsMatched}、原始資料 ${c.expRows}`);
  ok(8, c.expRows > 0 && c.sections > 0, `${lang} 覆蓋率為零（判準沒被行使）`);
  // G11：分母不靠頁面，直接從原始資料對「選定的站」重算——缺一頁、缺一段、缺一列都會讓這三個數字對不上
  ok(11, e.rows > 0 && c.rows > 0, `${lang} 逐列比對的列數必須 > 0`, `頁面 ${c.rows}、重算 ${e.rows}`);
  ok(11, c.rows === e.rows, `${lang} 逐列比對的列數必須等於閘門從原始資料重算的總列數`, `頁面 ${c.rows}、重算 ${e.rows}`);
  ok(11, c.rowsMatched === e.rows, `${lang} 逐列比對「成功」的列數必須等於重算的總列數`, `成功 ${c.rowsMatched}、重算 ${e.rows}`);
  ok(11, c.sections === e.sections, `${lang} 驗到的時刻段數必須等於重算的段數`, `驗到 ${c.sections}、重算 ${e.sections}`);
}
ok(8, LANGS.length === EXPECT_LANGS, `語言數應為 ${EXPECT_LANGS}`);
if (opt.all) {
  for (const lang of LANGS) ok(11, cov[lang].stations === EXPECT_STATIONS[lang], `--all 時 ${lang} 驗到的站數必須是 ${EXPECT_STATIONS[lang]}（具名覆蓋率常數）`, `實際 ${cov[lang].stations}`);
  ok(8, LANGS.filter(l => cov[l].stations > 0).length === EXPECT_LANGS, `--all 時語言必須是 ${EXPECT_LANGS}`);
} else {
  ok(8, picked.length >= NAMED.length + NAMED2.length, `預設至少要驗具名案例 ${NAMED.length + NAMED2.length} 站`, `實際 ${picked.length}`);
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
  for (const f of g.fails.slice(0, opt.maxFails)) console.log(`FAIL ${f}`);
  if (g.fails.length > opt.maxFails) console.log(`FAIL [G${n}] …另有 ${g.fails.length - opt.maxFails} 項（--max-fails=all 全部列出）`);
}
const totalChecks = Object.values(gate).reduce((s, g) => s + g.checks, 0);
console.log(`${totalFails ? 'FAIL' : 'PASS'}：${totalChecks} 個檢查，${totalFails} 項失敗（紅的閘門：${Object.keys(GATE_NAME).filter(n => gate[n].fails.length).map(n => `G${n}`).join('、') || '無'}）`);
process.exit(totalFails ? 1 : 0);
