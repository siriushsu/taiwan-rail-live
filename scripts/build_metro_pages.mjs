// 捷運路線圖頁（階段 A，2026-09-29）：從 data/ 產生「總覽／系統／路線」三層靜態頁，三語（zh／en／ja）。
// 由 scripts/build_aeo_pages.mjs 呼叫（--check 也在那邊做），本檔不直接寫檔，只回傳 { files, paths, date, ... }。
//
// 內容紅線（每一句都要能追到 data/ 或既有文案）：
//   - 站數、站名、站序、轉乘、首末班車、班距一律由 data/ 推得，不寫營運商、開通年份、票價、設施、航廈資訊。
//   - 資料來源沒有逐班時刻表的路線（trtc BR、tmrt TG、sanying LB，*_times.json 標 estimated）不列各方向首末班車，
//     只列營運時段與班距（營運時段取自資料的首末班，推估的只有逐班時刻）；其餘路線的首末班車由逐站時刻表計算。
//   - 「地圖上怎麼跑」照站上現行說法（index.html 捷運頁導言、9/11 更新紀錄 metrolead0911）：台北捷運九條資料線
//     （含文湖線、環狀線）的列車位置與車站倒數來自官方逐班即時資料，文湖線只有備援時刻表依班距推估；三鶯線與台中捷運
//     依班距推估的時刻表跑；其餘系統依時刻表跑、有官方即時資料時校正。不提收費與通行證；不寫「錄影含音樂」。
//   - 環狀線（資料在 trtc.json 內，即時資料也走北捷那條）歸在台北捷運頁：這是主對話的判讀，沒有使用者裁示；
//     頁面不寫任何營運單位。
//   - 輸出必須逐 byte 決定性：不讀時鐘、不讀環境；日期＝max(範本日, 各資料檔 source_notes 內的 ISO 日期)。
import fs from 'node:fs';
import path from 'node:path';

const METRO_TEMPLATE_DATE = '2026-09-29';
const LANGS = ['zh', 'en', 'ja'];
const LANG_INFO = {
  zh: { html: 'zh-Hant', og: 'zh_TW', prefix: '' },
  en: { html: 'en', og: 'en_US', prefix: '/en' },
  ja: { html: 'ja', og: 'ja_JP', prefix: '/ja' },
};
const GITHUB = 'https://github.com/siriushsu/taiwan-rail-live';

const N = (zh, en, ja) => ({ zh, en, ja });
const SITE = 'https://railisland.tw';
let esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');
const pick = (lang, zh, en, ja) => (lang === 'zh' ? zh : lang === 'en' ? en : ja);

// ── 系統與路線設定 ───────────────────────────────────────────────────────────────
// 資料檔：data/<file>.json（路線幾何＋站序）與 data/<file>_times.json（逐班時刻）。
// dict＝i18n/stations.json 的 systems 分類；routeKey＝data/station_transfers.json 的路線鍵（非北捷路線用它反查站碼）。
const FILE_OF = {
  BR: 'trtc', R: 'trtc', R_XBT: 'trtc', G: 'trtc', G_XBT: 'trtc', O_XINZHUANG: 'trtc', O_LUZHOU: 'trtc', BL: 'trtc', Y: 'trtc',
  A: 'tymc', V: 'ntdlrt', VB: 'ntdlrt', K: 'ntalrt', LB: 'sanying', KR: 'krtc', KO: 'krtc', C: 'krtc', TG: 'tmrt',
};
const DICT_OF = { trtc: 'mrt', tymc: 'tymc', ntdlrt: 'ntdlrt', ntalrt: 'ntalrt', sanying: 'sanying', krtc: 'krtc', tmrt: 'tmrt' };
const ROUTEKEY_OF = { KR: 'KRTC:R', KO: 'KRTC:O', C: 'KLRT:C', TG: 'TMRT:G', K: 'NTALRT:K', V: 'NTDLRT:V', VB: 'NTDLRT:V', LB: 'SANYING:LB', A: 'TYMC:A', Y: 'NTMC:Y' };

// 頁面單位＝一個「營運路線」，支線併進主線頁：
//   mode 'prefix'：幾條資料線共用前段站序（中和新蘆線的迴龍／蘆洲、淡海輕軌的綠山／藍海），頁面拆成「共用路段＋各分支」。
//   attached：另一條獨立的短資料線接在主線某站上（淡水信義線的新北投支線、松山新店線的小碧潭支線）。
// en/ja 路線名取自 i18n/stations.json 的 routes 與 translations.js 既有詞條；紅線／橘線／綠線的顏色別名也只用字典裡已有的。
const SYSTEMS = [
  { id: 'taipei', name: N('台北捷運', 'Taipei MRT', '台北MRT'),
    title: N('台北捷運路線圖：路線、車站與首末班車｜軌島', 'Taipei MRT Map: Lines, Stations & First/Last Trains | Rail Island', '台北MRT 路線図｜路線・駅・始発終電｜軌島'),
    panels: [['BR', 'R', 'R_XBT', 'G', 'G_XBT', 'O_XINZHUANG', 'O_LUZHOU', 'BL', 'Y']] },
  { id: 'taoyuan-airport', name: N('桃園機場捷運', 'Taoyuan Airport MRT', '桃園空港MRT'),
    title: N('桃園機場捷運路線圖：車站與首末班車｜軌島', 'Taoyuan Airport MRT Map: Stations & First/Last Trains | Rail Island', '桃園空港MRT 路線図｜駅・始発終電｜軌島'),
    panels: [['A']] },
  { id: 'new-taipei', name: N('新北捷運', 'New Taipei Metro', '新北メトロ'),
    title: N('新北捷運路線圖：淡海輕軌、安坑輕軌、三鶯線｜軌島', 'New Taipei Metro Map: Danhai LRT, Ankeng LRT & Sanying Line | Rail Island', '新北メトロ 路線図｜淡海ライトレール・安坑ライトレール・三鶯線｜軌島'),
    panels: [['V', 'VB'], ['K'], ['LB']] },
  { id: 'taichung', name: N('台中捷運', 'Taichung MRT', '台中MRT'),
    title: N('台中捷運路線圖：綠線車站與營運時間｜軌島', 'Taichung MRT Map: Green Line Stations & Operating Hours | Rail Island', '台中MRT 路線図｜緑線の駅と運行時間｜軌島'),
    panels: [['TG']] },
  { id: 'kaohsiung', name: N('高雄捷運', 'Kaohsiung MRT', '高雄MRT'),
    title: N('高雄捷運路線圖：紅線、橘線與環狀輕軌｜軌島', 'Kaohsiung MRT Map: Red Line, Orange Line & Circular Light Rail | Rail Island', '高雄MRT 路線図｜赤線・オレンジ線・ライトレール環状線｜軌島'),
    panels: [['KR', 'KO', 'C']] },
];

const LINE_PAGES = [
  { sys: 'taipei', slug: 'wenhu', lines: ['BR'], name: N('文湖線', 'Wenhu Line', '文湖線') },
  { sys: 'taipei', slug: 'tamsui-xinyi', lines: ['R'], attached: ['R_XBT'], name: N('淡水信義線', 'Tamsui-Xinyi Line', '淡水信義線') },
  { sys: 'taipei', slug: 'songshan-xindian', lines: ['G'], attached: ['G_XBT'], name: N('松山新店線', 'Songshan-Xindian Line', '松山新店線') },
  { sys: 'taipei', slug: 'zhonghe-xinlu', lines: ['O_XINZHUANG', 'O_LUZHOU'], mode: 'prefix', name: N('中和新蘆線', 'Zhonghe-Xinlu Line', '中和新蘆線') },
  { sys: 'taipei', slug: 'bannan', lines: ['BL'], name: N('板南線', 'Bannan Line', '板南線') },
  { sys: 'taipei', slug: 'circular', lines: ['Y'], name: N('環狀線', 'Circular Line', '環状線') },
  { sys: 'taoyuan-airport', slug: 'airport-mrt', lines: ['A'], name: N('機場捷運', 'Airport MRT Line', '桃園空港MRT') },
  { sys: 'new-taipei', slug: 'danhai', lines: ['V', 'VB'], mode: 'prefix', name: N('淡海輕軌', 'Danhai LRT', '淡海ライトレール') },
  { sys: 'new-taipei', slug: 'ankeng', lines: ['K'], name: N('安坑輕軌', 'Ankeng LRT', '安坑ライトレール') },
  { sys: 'new-taipei', slug: 'sanying', lines: ['LB'], name: N('三鶯線', 'Sanying Line', '三鶯線') },
  { sys: 'taichung', slug: 'green', lines: ['TG'], name: N('綠線', 'Green Line', '緑線'), alias: N('烏日文心北屯線', 'Wuriwenxin Beitun Line', '烏日文心北屯線') },
  { sys: 'kaohsiung', slug: 'red', lines: ['KR'], name: N('紅線', 'Red Line', '赤線') },
  { sys: 'kaohsiung', slug: 'orange', lines: ['KO'], name: N('橘線', 'Orange Line', 'オレンジ線') },
  { sys: 'kaohsiung', slug: 'circular-lrt', lines: ['C'], name: N('環狀輕軌', 'Circular Light Rail', 'ライトレール環状線') },
];

// 獨立短資料線（attached）與單獨資料線在圖例上的名稱（顏色不同才需要各自一格）
const BRANCH_NAME = {
  R_XBT: N('新北投支線', 'Xinbeitou Branch Line', '新北投支線'),
  G_XBT: N('小碧潭支線', 'Xiaobitan Branch Line', '小碧潭支線'),
  V: N('綠山線', 'Green Mountain Line', '緑山線'),
  VB: N('藍海線', 'Blue Seaside Line', '藍海線'),
};

// 機捷車種（tymc_times.json 的 kinds：'1'＝普通車、'2'＝直達車）。詞條同 i18n/translations.js 的「普通車／直達車」。
const KIND_LABEL = { '1': N('普通車', 'Commuter', '普通列車'), '2': N('直達車', 'Express', '直達列車') };

// 臨時營運調整的頁面附註：data/special_ops.json 仍有該條、且頁面日期（M.date，由資料日期決定、不讀時鐘）不晚於 until 才輸出。
// 展後那條 op 要留到 TDX 換版（可能到 2027），附註講的疏運期卻在 10/11 結束；10/12 後重抓機捷資料、M.date 越過 until，附註就消失。
// 文字改寫自該條 `quote`（桃園捷運官網原文，已在 special_ops.json 留存）；站名／站號從資料線的站序取，不手打。
// text(lang, a, z)：a／z＝區間起訖站（「站名（站號）」）。
const SPECIAL_NOTES = [
  { opId: 'tymc-20261012-post-expo', until: '2026-10-11', lineIds: ['A'], fromIdx: 11, toIdx: 20,
    text: (lang, a, z) => pick(lang,
      `9/24（四）至 10/11（日）為 2026 台灣設計展疏運期間，${a}到${z}之間加開每站停靠的區間加班車（週一至四 16:00–20:00；週五至日含國定假日 11:00–22:00；10/11 為 11:00–20:00），該時段取消南延直達車。10/12 起改用展後班表。下列首末班車與班距是一般班表的計算結果，臨時班表以營運單位公告為準。`,
      `Sep 24 (Thu) to Oct 11 (Sun) is the special service period for the 2026 Taiwan Design Expo. Extra trains that stop at every station run between ${a} and ${z} (Mon–Thu 16:00–20:00; Fri–Sun and public holidays 11:00–22:00; Oct 11 11:00–20:00), and the express trains that run on to the southern extension are cancelled in those hours. From Oct 12 the post-expo timetable applies. The first and last trains and headways below are calculated from the regular timetable; temporary timetables are subject to the operator's announcements.`,
      `9/24（木）〜10/11（日）は2026台湾デザイン展の輸送対策期間です。${a}〜${z}の間で各駅に停車する区間臨時列車が増発され（月〜木 16:00〜20:00、金〜日・祝日 11:00〜22:00、10/11は11:00〜20:00）、この時間帯は南側の延伸区間まで走る直達列車が運休になります。10/12からは展示会終了後のダイヤになります。以下の始発・終電と運転間隔は通常ダイヤから計算したもので、臨時ダイヤは運営会社の発表を優先してください。`) },
];

// ── 共用小工具 ───────────────────────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');
// 捨去到分，跟站上 fmtHM 一樣：資料有秒（例 22:25:30），四捨五入會把末班寫晚一分鐘。
const hmOf = sec => {
  const m = Math.floor(sec / 60);
  return { text: `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`, next: m >= 1440 };
};
const timeHtml = sec => { const t = hmOf(sec); return t.next ? `${t.text}<sup class="nd">+1</sup>` : t.text; };
const timeText = (sec, lang) => {
  const t = hmOf(sec);
  if (!t.next) return t.text;
  return lang === 'zh' ? `${t.text}（次日）` : lang === 'en' ? `${t.text} (next day)` : `${t.text}（翌日）`;
};
const median = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const DAY_NAMES = {
  zh: d => `週${'日一二三四五六'[d]}`,
  en: d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d],
  ja: d => `${'日月火水木金土'[d]}曜`,
};
const DAY_FMT = {
  zh: { range: (a, b) => `${a}至${b}`, sep: '、', holiday: '國定假日' },
  en: { range: (a, b) => `${a}–${b}`, sep: ', ', holiday: 'public holidays' },
  ja: { range: (a, b) => `${a.replace('曜', '')}〜${b}`, sep: '・', holiday: '祝日' },
};
// days＝該班表涵蓋的星期（JS getDay，0＝週日），holiday＝是否也是國定假日用的班表
function dayLabel(lang, days, holiday) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const runs = [];
  let cur = null;
  for (const d of order) {
    if (days.includes(d)) { if (cur) cur.push(d); else { cur = [d]; runs.push(cur); } } else cur = null;
  }
  const nm = DAY_NAMES[lang], f = DAY_FMT[lang];
  const parts = runs.map(r => (r.length >= 3 ? f.range(nm(r[0]), nm(r[r.length - 1])) : r.map(nm).join(f.sep)));
  if (holiday) parts.push(f.holiday);
  return parts.join(f.sep);
}

const isoDates = text => [...String(text || '').matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m => m[0]);
const fetchDate = text => {
  const found = [...String(text || '').matchAll(/(\d{4}-\d{2}-\d{2}) 抓取/g)].map(m => m[1]).sort();
  return found.length ? found[found.length - 1] : null;
};

// 標籤用的短站名：去掉尾綴「站／Station／駅」（「台北車站」「岡山車站」這類「車站」結尾不動）
function shortLabel(lang, text) {
  if (lang === 'zh') return /車站$/.test(text) || text.length <= 2 ? text : text.replace(/站$/, '');
  if (lang === 'en') return text.replace(/\s+Station$/, '');
  return text.replace(/駅$/, '');
}

// ── 資料模型 ─────────────────────────────────────────────────────────────────────
function loadMetroModel(root, stationPages = []) {
  const J = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const i18n = J('i18n/stations.json');
  const transfers = J('data/station_transfers.json');
  const trtcCodes = J('data/trtc_codes.json');
  const specialOps = J('data/special_ops.json');
  const files = {};
  for (const f of new Set(Object.values(FILE_OF))) files[f] = { data: J(`data/${f}.json`), times: J(`data/${f}_times.json`) };

  // 日期：範本日與所有資料檔 source_notes 內 ISO 日期取最大（決定性，不讀時鐘）
  const allDates = [METRO_TEMPLATE_DATE];
  for (const f of Object.values(files)) allDates.push(...isoDates(f.data.source_notes), ...isoDates(f.times.source_notes));
  const date = allDates.sort()[allDates.length - 1];

  // 轉乘群組索引
  const groupOfKey = new Map();
  for (const g of transfers.transferStations) for (const m of g.members) groupOfKey.set(m, g);
  const byRouteName = new Map();
  for (const [key, s] of Object.entries(transfers.stations)) {
    for (const r of s.routes) { const k = `${r}|${s.name}`; if (!byRouteName.has(k)) byRouteName.set(k, key); }
  }
  const trtcByLineIdx = new Map();
  for (const [code, rec] of Object.entries(trtcCodes)) for (const o of rec.on) trtcByLineIdx.set(`${o.ln}|${o.i}`, code);

  // 既有車站資料頁：station key → slug
  const stationPageOf = new Map();
  for (const sp of stationPages) for (const m of sp.members) if (!stationPageOf.has(m)) stationPageOf.set(m, sp.slug);

  const missingNames = new Set();
  const nameOf = (lang, lineId, zh) => {
    if (lang === 'zh') return { text: zh, missing: false };
    const dict = DICT_OF[FILE_OF[lineId]];
    const hit = i18n.systems[dict]?.[zh]?.[lang];
    if (hit) return { text: hit.replace(/\s+/g, ' ').trim(), missing: false };
    missingNames.add(`${lang}\t${dict}\t${zh}`);
    return { text: zh, missing: true };
  };

  // 資料線 → 站清單（含站碼與轉乘 key）
  const lineModels = {};
  for (const [lineId, file] of Object.entries(FILE_OF)) {
    const dl = files[file].data.lines.find(l => l.id === lineId);
    if (!dl) throw new Error(`data/${file}.json 找不到路線 ${lineId}`);
    const tl = files[file].times.lines[lineId];
    if (!tl) throw new Error(`data/${file}_times.json 找不到路線 ${lineId}`);
    const routeKey = ROUTEKEY_OF[lineId];
    const stations = dl.stations.map((s, idx) => {
      let key = null, code = null;
      if (file === 'trtc' && lineId !== 'Y') {
        code = trtcByLineIdx.get(`${lineId}|${idx}`) || null;
        if (!code) throw new Error(`trtc_codes.json 沒有 ${lineId} 第 ${idx} 站 ${s.name}`);
        key = `TRTC:${code}`;
        if (!transfers.stations[key]) key = null;
      } else {
        key = byRouteName.get(`${routeKey}|${s.name}`) || null;
        if (!key) throw new Error(`station_transfers.json 找不到 ${routeKey} 的 ${s.name}`);
        code = transfers.stations[key].stationId;
      }
      return { idx, zh: s.name, lat: s.lat, lon: s.lon, code, key };
    });
    lineModels[lineId] = { id: lineId, file, data: dl, times: tl, timesEstimated: !!(tl.estimated || files[file].times.estimated), stations };
  }

  return { root, i18n, transfers, files, date, groupOfKey, stationPageOf, nameOf, missingNames, lineModels, specialOps };
}

// ── 時刻分析 ─────────────────────────────────────────────────────────────────────
// 一班車＝[站序, 秒, 站序, 秒, …]（當日發車秒，跨午夜 >86400）。
// 「首班／末班」＝該方向在起點站的最早／最晚發車；各站首末班＝該方向所有列車（含中途折返）在該站的最早／最晚發車。
function regularSets(tl) {
  const names = [];
  for (const d of [1, 2, 3, 4, 5, 6, 0]) if (!names.includes(tl.days[d])) names.push(tl.days[d]);
  if (!names.includes(tl.holiday)) names.push(tl.holiday);
  return names.map(name => ({ name, days: [0, 1, 2, 3, 4, 5, 6].filter(d => tl.days[d] === name), holiday: tl.holiday === name }));
}

const dirOf = (t, n, loop) => {
  const a = t[0], b = t[2];
  return loop ? (((b - a + n) % n) <= n / 2 ? 'fwd' : 'bwd') : (b > a ? 'fwd' : 'bwd');
};
const modalKey = counts => {
  let best = null;
  for (const [k, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) if (!best || c > best[1]) best = [k, c];
  return best ? best[0] : null;
};

function analyzeLine(lm) {
  const { data, times, stations } = lm;
  const n = stations.length, loop = !!data.loop;
  const sets = regularSets(times);
  const kinds = times.kinds || null;
  const groups = kinds ? ['1', '2'] : [null];
  const trainsIn = (setName, g) => {
    const list = times.sets[setName] || [];
    const kindArr = kinds ? kinds[setName] : null;
    return list.filter((t, i) => t.length >= 4 && (g == null || (kindArr && kindArr[i] === g)));
  };
  const out = { lineId: lm.id, estimated: lm.timesEstimated, loop, n, sets, services: [], perStation: {}, headway: null, window: null };

  // 各方向的起訖站：無車種的線固定用路線兩端（環線用 0）；有車種（機捷）取所有一般班表合併後的眾數
  for (const g of groups) {
    for (const dir of ['fwd', 'bwd']) {
      let origin, dest;
      if (!kinds) {
        origin = loop ? 0 : (dir === 'fwd' ? 0 : n - 1);
        dest = loop ? null : (dir === 'fwd' ? n - 1 : 0);
      } else {
        const oc = new Map();
        for (const s of sets) for (const t of trainsIn(s.name, g)) if (dirOf(t, n, loop) === dir) oc.set(t[0], (oc.get(t[0]) || 0) + 1);
        origin = modalKey(oc);
        if (origin == null) continue;
        const dc = new Map();
        for (const s of sets) for (const t of trainsIn(s.name, g)) if (dirOf(t, n, loop) === dir && t[0] === origin) dc.set(t[t.length - 2], (dc.get(t[t.length - 2]) || 0) + 1);
        dest = modalKey(dc);
      }
      // bySet＝開到終點站的列車在起點站的首末班（沒有終點站的環線＝所有發車）；
      // allBySet＝起點站所有發車（含不開到終點站的）；others＝不開到終點站、但把首班提早或末班延後的班次
      //（例：機捷最後兩班普通車只開到機場第二航廈站，不能算進「台北車站 → 老街溪站」的末班）
      const bySet = {}, allBySet = {}, others = {};
      const span = arr => ({ first: Math.min(...arr), last: Math.max(...arr), count: arr.length });
      let any = false;
      for (const s of sets) {
        const dep = trainsIn(s.name, g).filter(t => dirOf(t, n, loop) === dir && t[0] === origin);
        const thru = dest == null ? dep : dep.filter(t => t[t.length - 2] === dest);
        const use = thru.length ? thru : dep;
        bySet[s.name] = use.length ? span(use.map(t => t[1])) : null;
        allBySet[s.name] = dep.length ? span(dep.map(t => t[1])) : null;
        others[s.name] = [];
        if (dest != null && thru.length) {
          const by = new Map();
          for (const t of dep) {
            const d = t[t.length - 2];
            if (d === dest) continue;
            if (!by.has(d)) by.set(d, []);
            by.get(d).push(t[1]);
          }
          for (const [d, times] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
            times.sort((a, b) => a - b);
            if (times[0] < bySet[s.name].first || times[times.length - 1] > bySet[s.name].last) others[s.name].push({ dest: d, count: times.length, first: times[0], last: times[times.length - 1], times });
          }
        }
        if (dep.length) any = true;
      }
      if (any) out.services.push({ group: g, dir, origin, dest, bySet, allBySet, others });
    }
  }

  // 各站首末班（不分車種；跳站的直達車自然不會出現在沒停的站）
  for (const s of sets) {
    const per = Array.from({ length: n }, () => ({ fwd: null, bwd: null }));
    for (const t of trainsIn(s.name, null)) {
      const dir = dirOf(t, n, loop);
      for (let i = 0; i < t.length / 2 - 1; i++) {
        const st = t[2 * i], sec = t[2 * i + 1];
        const cell = per[st][dir];
        if (!cell) per[st][dir] = { first: sec, last: sec };
        else { if (sec < cell.first) cell.first = sec; if (sec > cell.last) cell.last = sec; }
      }
    }
    out.perStation[s.name] = per;
  }

  // 班距
  if (lm.timesEstimated) {
    out.headway = { estimated: true, flagged: !!data.headway_estimated, peakMin: data.peakHeadwaySec ? Math.round(data.peakHeadwaySec / 60) : null, offMin: data.offpeakHeadwaySec ? Math.round(data.offpeakHeadwaySec / 60) : null };
    out.window = {};
    for (const s of sets) {
      const svc = out.services.filter(x => x.bySet[s.name]);
      if (svc.length) out.window[s.name] = { first: Math.min(...svc.map(x => x.bySet[s.name].first)), last: Math.max(...svc.map(x => x.bySet[s.name].last)) };
    }
  } else {
    // 依時刻表計算：平日（週三所屬班表）兩個時窗內、各方向起點站相鄰兩班發車間隔的中位數（各車種合計）。
    // 兩個方向不一樣時（區間車只從一端發車、機捷兩端車種不同）分開列，所以每個方向各算一個。
    const ref = times.days[3];
    const trains = trainsIn(ref, null);
    const gapsIn = (dir, origin, a, b) => {
      const deps = trains.filter(t => dirOf(t, n, loop) === dir && t[0] === origin).map(t => t[1]).filter(x => x >= a * 3600 && x < b * 3600).sort((x, y) => x - y);
      const gaps = [];
      for (let i = 1; i < deps.length; i++) gaps.push((deps[i] - deps[i - 1]) / 60);
      return gaps.length >= 3 ? Math.max(1, Math.round(median(gaps))) : null;
    };
    out.headway = {
      estimated: false, ref,
      dirs: ['fwd', 'bwd'].map(dir => {
        const origin = loop ? 0 : (dir === 'fwd' ? 0 : n - 1);
        return { dir, origin, morningMin: gapsIn(dir, origin, 7, 9), middayMin: gapsIn(dir, origin, 12, 14) };
      }),
    };
  }
  return out;
}

// ── 頁面結構：共用路段＋分支、站列、轉乘 ─────────────────────────────────────────────
function buildPages(model) {
  const pages = LINE_PAGES.map((cfg, order) => {
    const lines = cfg.lines.map(id => model.lineModels[id]);
    const attached = (cfg.attached || []).map(id => model.lineModels[id]);
    const rowOf = (s, lineId) => ({ ...s, lineId });
    let trunk, branches = [];
    if (cfg.mode === 'prefix') {
      const a = lines[0].stations;
      let p = 0;
      while (lines.every(l => l.stations[p] && l.stations[p].zh === a[p].zh)) p++;
      if (p < 2) throw new Error(`${cfg.slug}: 資料線沒有共用前段`);
      trunk = a.slice(0, p).map(s => rowOf(s, lines[0].id));
      for (const l of lines) branches.push({ lineId: l.id, junction: trunk[p - 1], rows: l.stations.slice(p).map(s => rowOf(s, l.id)) });
    } else {
      trunk = lines[0].stations.map(s => rowOf(s, lines[0].id));
      for (const l of attached) {
        const junction = trunk.find(s => s.zh === l.stations[0].zh);
        if (!junction) throw new Error(`${cfg.slug}: 支線 ${l.id} 的起點 ${l.stations[0].zh} 不在主線上`);
        branches.push({ lineId: l.id, junction, rows: l.stations.slice(1).map(s => rowOf(s, l.id)) });
      }
    }
    const allRows = [...trunk, ...branches.flatMap(b => b.rows)];
    const names = new Set(allRows.map(r => r.zh));
    const coords = allRows.map(r => [r.lat, r.lon]);
    const bbox = [Math.min(...coords.map(c => c[0])), Math.min(...coords.map(c => c[1])), Math.max(...coords.map(c => c[0])), Math.max(...coords.map(c => c[1]))];
    // 終點站：prefix 各分支的最後一站；attached 主線兩端
    const dataLineIds = [...cfg.lines, ...(cfg.attached || [])];
    const analysis = Object.fromEntries(dataLineIds.map(id => [id, analyzeLine(model.lineModels[id])]));
    return { cfg, order, sysId: cfg.sys, slug: cfg.slug, name: cfg.name, dataLineIds, trunk, branches, stationCount: names.size, bbox, analysis, estimated: dataLineIds.every(id => model.lineModels[id].timesEstimated), color: model.lineModels[cfg.lines[0]].data.color };
  });
  const bySlug = new Map(pages.map(p => [p.slug, p]));
  const pageOfLine = new Map();
  for (const p of pages) for (const id of p.dataLineIds) pageOfLine.set(id, p);
  // 站 key → { page, code }（轉乘標籤用）
  const keyIndex = new Map();
  for (const p of pages) for (const r of [...p.trunk, ...p.branches.flatMap(b => b.rows)]) if (r.key && !keyIndex.has(r.key)) keyIndex.set(r.key, { page: p, code: r.code });
  const systems = SYSTEMS.map((sys, order) => {
    const sp = pages.filter(p => p.sysId === sys.id);
    const rows = sp.flatMap(p => [...p.trunk, ...p.branches.flatMap(b => b.rows)]);
    const names = new Set(rows.map(r => r.zh));
    const coords = rows.map(r => [r.lat, r.lon]);
    const bbox = [Math.min(...coords.map(c => c[0])), Math.min(...coords.map(c => c[1])), Math.max(...coords.map(c => c[0])), Math.max(...coords.map(c => c[1]))];
    return { ...sys, order, slug: sys.id, pages: sp, stationCount: names.size, bbox, estimatedOnly: sp.every(p => p.estimated) };
  });
  return { pages, bySlug, pageOfLine, keyIndex, systems };
}

// 某一站的轉乘目標：同系統其他路線頁、其他捷運系統、台鐵、高鐵
function transfersOf(model, built, page, row) {
  const g = row.key ? model.groupOfKey.get(row.key) : null;
  if (!g) return [];
  const out = [];
  const seen = new Set();
  for (const m of g.members) {
    if (m === row.key) continue;
    const rec = model.transfers.stations[m];
    let t = null;
    if (rec.system === 'TRA') t = { kind: 'tra' };
    else if (rec.system === 'THSR') t = { kind: 'thsr' };
    else {
      const hit = built.keyIndex.get(m);
      if (hit && hit.page.slug !== page.slug) t = { kind: 'metro', page: hit.page, code: hit.code };
    }
    if (!t) continue;
    const id = t.kind === 'metro' ? `m:${t.page.slug}` : t.kind;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  const rank = t => (t.kind === 'metro' ? t.page.order : t.kind === 'tra' ? 100 : 101);
  return out.sort((a, b) => rank(a) - rank(b));
}

// 深連結：/?g=metro&at=<lat>,<lon>&z=<zoom>（index.html 的 deepG／deepAt／deepZ；z 會被夾在 7–18）
function zoomFor(bbox) {
  const [la0, lo0, la1, lo1] = bbox;
  const dLon = Math.max(lo1 - lo0, 0.002), dLat = Math.max(la1 - la0, 0.002);
  const cosLat = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const px = 256 / 360; // zoom 0 時每度經度的像素數
  const zW = Math.log2(300 / (dLon * px));
  const zH = Math.log2(420 / (dLat / cosLat * px));
  return Math.max(7, Math.min(18, Math.floor(Math.min(zW, zH))));
}
function liveHref(lang, bbox) {
  const lat = ((bbox[0] + bbox[2]) / 2).toFixed(4), lon = ((bbox[1] + bbox[3]) / 2).toFixed(4);
  return `/?g=metro&at=${lat},${lon}&z=${zoomFor(bbox)}${lang === 'zh' ? '' : `&lang=${lang}`}`;
}

// ── SVG：地理路線圖（系統頁）───────────────────────────────────────────────────────
// 等距圓柱投影（經度乘 cos 緯度）、Ramer–Douglas–Peucker 簡化、貪婪標籤配置（避開已放標籤與所有站點圓點，
// 盡量不跨線）。先試「全部站名」，放不下就改「只標端點與轉乘站」，兩種都不重疊；
// 端點與轉乘站放不下時退到拉線標籤（最遠 96 單位）或較窄的三行版本，端點標籤盡量也不壓到別站的圓點。
const MAP_W = 360, MAP_MAX_H = 520, MAP_MX = 12, MAP_MY = 14, LABEL_FS = 12;
const num = v => { const s = v.toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s; };
const R_NORMAL = 2.5, R_END = 3.4, R_XFER = 3.9;
const LEADER_ANGLES = [16, 24, 12, 32, 20, 8];

function rdp(points, eps) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)); d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// 文字寬度估計（CJK 一字一個字寬、拉丁字母依字形分級；粗體再放寬 6%，偏保守以免重疊）
function textWidth(str, fs) {
  let w = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c >= 0x2E80) w += fs;
    else if (ch === ' ') w += fs * 0.32;
    else if (/[MW@]/.test(ch)) w += fs * 0.92;
    else if (/[A-Z]/.test(ch)) w += fs * 0.72;
    else if (/[mw]/.test(ch)) w += fs * 0.88;
    else if (/[il.,'|!:;]/.test(ch)) w += fs * 0.32;
    else if (/[0-9]/.test(ch)) w += fs * 0.62;
    else w += fs * 0.6;
  }
  return w * 1.06 + 1;
}

const segHitsRect = (s, r) => {
  if (Math.max(s.x0, s.x1) < r.x0 || Math.min(s.x0, s.x1) > r.x1 || Math.max(s.y0, s.y1) < r.y0 || Math.min(s.y0, s.y1) > r.y1) return false;
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  if (inside(s.x0, s.y0) || inside(s.x1, s.y1)) return true;
  const ccw = (ax, ay, bx, by, cx, cy) => (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
  const cross = (a, b, c, d) => ccw(a[0], a[1], c[0], c[1], d[0], d[1]) !== ccw(b[0], b[1], c[0], c[1], d[0], d[1]) && ccw(a[0], a[1], b[0], b[1], c[0], c[1]) !== ccw(a[0], a[1], b[0], b[1], d[0], d[1]);
  const p = [s.x0, s.y0], q = [s.x1, s.y1];
  return cross(p, q, [r.x0, r.y0], [r.x1, r.y0]) || cross(p, q, [r.x1, r.y0], [r.x1, r.y1]) || cross(p, q, [r.x1, r.y1], [r.x0, r.y1]) || cross(p, q, [r.x0, r.y1], [r.x0, r.y0]);
};

// 候選位置：東西南北與四個斜角，再加東西兩側上下微移；端點與轉乘站放不下時再退到「拉線標籤」（離點 16–96 單位、附一條細引線；angles＝每圈幾個方向）
function labelCandidates(n, w, h, width, height, withLeaders, angles) {
  // h＝這個標籤的總高度（單行或兩行）
  const gap = n.r + 2.6, dg = gap * 0.6, out = [];
  const add = (pos, x0, y0, a, leader = null) => out.push({ pos, x0, y0, x1: x0 + w, y1: y0 + h, a, leader });
  add('E', n.x + gap, n.y - h / 2, 'start');
  add('W', n.x - gap - w, n.y - h / 2, 'end');
  add('N', n.x - w / 2, n.y - gap - h, 'middle');
  add('S', n.x - w / 2, n.y + gap, 'middle');
  add('NE', n.x + dg, n.y - dg - h, 'start');
  add('NW', n.x - dg - w, n.y - dg - h, 'end');
  add('SE', n.x + dg, n.y + dg, 'start');
  add('SW', n.x - dg - w, n.y + dg, 'end');
  const cx = Math.min(Math.max(n.x - w / 2, 1.5), width - 1.5 - w);
  if (Math.abs(cx - (n.x - w / 2)) > 0.5) { add('Nc', cx, n.y - gap - h, 'start'); add('Sc', cx, n.y + gap, 'start'); }
  add('E-', n.x + gap, n.y - h * 0.95, 'start');
  add('E+', n.x + gap, n.y - h * 0.05, 'start');
  add('W-', n.x - gap - w, n.y - h * 0.95, 'end');
  add('W+', n.x - gap - w, n.y - h * 0.05, 'end');
  if (withLeaders) {
    for (const r of [16, 26, 36, 48, 62, 78, 96]) {
      for (let k = 0; k < angles; k++) {
        const th = (k * Math.PI * 2) / angles, ux = Math.cos(th), uy = Math.sin(th);
        const px = n.x + ux * r, py = n.y + uy * r;
        const a = ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
        const x0 = a === 'start' ? px : a === 'end' ? px - w : px - w / 2;
        const y0 = py - h / 2 + (uy > 0.35 ? h * 0.35 : uy < -0.35 ? -h * 0.35 : 0);
        const ex = a === 'start' ? x0 : a === 'end' ? x0 + w : Math.min(Math.max(n.x, x0), x0 + w);
        const ey = uy > 0.35 ? y0 : uy < -0.35 ? y0 + h : y0 + h / 2;
        add('L' + r + '/' + k, x0, y0, a, { x0: n.x + ux * (n.r + 0.5), y0: n.y + uy * (n.r + 0.5), x1: ex, y1: ey });
      }
    }
  }
  return out;
}

function placeLabels(nodes, segs, width, height, mode, angles) {
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const dots = nodes.map(n => ({ n, x0: n.x - n.r - 1.6, y0: n.y - n.r - 1.6, x1: n.x + n.r + 1.6, y1: n.y + n.r + 1.6 }));
  const placed = [];
  const list = nodes.filter(n => mode === 'all' || n.important).sort((a, b) => (b.weight - a.weight) || (a.order - b.order));
  for (const n of list) n.box = null;
  let ok = true;
  for (const n of list) {
    let best = null;
    n.shapes.forEach((shape, si) => {
      const cands = labelCandidates(n, shape.tw, shape.th, width, height, n.important === 1, angles);
      cands.forEach((c, i) => {
        if (c.x0 < 1.5 || c.x1 > width - 1.5 || c.y0 < 1.5 || c.y1 > height - 1.5) return;
        if (placed.some(r => overlap(c, r))) return;
        // 標籤絕不壓到別的標籤；壓到別站的圓點只有端點站可以（標籤有白邊），其他站一律不行
        const dotHits = dots.filter(d => d.n !== n && overlap(c, d)).length;
        if (dotHits && !n.terminal) return;
        if (c.leader && placed.some(r => segHitsRect(c.leader, r))) return;
        // 壓圓點的懲罰遠大於拉線與三行版本的代價：寧可拉線、換成三行，也不要蓋住別的站
        let cost = i * 0.05 + si * 2.5 + (c.leader ? 4 : 0) + dotHits * 14;
        // 讀圖時「這個標籤是哪個點的」不能有歧義：拉線標籤有引線不算；其餘的，若別站的圓點離標籤框比自己的點更近或差不多近，加重罰
        if (!c.leader) {
          const rectDist = (px, py) => Math.hypot(Math.max(c.x0 - px, 0, px - c.x1), Math.max(c.y0 - py, 0, py - c.y1));
          const own = rectDist(n.x, n.y);
          for (const d of dots) if (d.n !== n && rectDist(d.n.x, d.n.y) <= Math.max(own + 4, 8)) cost += 6;
        }
        for (const sg of segs) if (segHitsRect(sg, c)) cost += 1;
        if (!best || cost < best.cost) best = { ...c, cost, shape, dotHits };
      });
    });
    if (best) { n.box = best; placed.push(best); } else ok = false;
  }
  return ok;
}

// 長標籤折行（英文在空格、任何語言在「/」「・」處）。wrapLabel＝寬度最小的兩行方案；wrapLabel3＝三行方案（窄而高），
// 只在擠的地方（兩行版找不到不壓圓點的位置）才會被選用。
function wrapCuts(text) {
  const cuts = [];
  for (let i = 1; i < text.length; i++) {
    if (text[i - 1] === ' ') cuts.push([i, i - 1]);
    else if (text[i - 1] === '/' || text[i - 1] === '・') cuts.push([i, i]);
  }
  return cuts;
}
function wrapLabel(text, fs) {
  const whole = textWidth(text, fs);
  if (whole <= 84) return { lines: [text], tw: whole };
  let best = null;
  for (const [cut, end] of wrapCuts(text)) {
    const a = text.slice(0, end).trim(), b = text.slice(cut).trim();
    if (!a || !b) continue;
    const w = Math.max(textWidth(a, fs), textWidth(b, fs));
    if (!best || w < best.tw) best = { lines: [a, b], tw: w };
  }
  return best && best.tw < whole ? best : { lines: [text], tw: whole };
}
function wrapLabel3(text, fs) {
  const cuts = wrapCuts(text);
  let best = null;
  for (let i = 0; i < cuts.length; i++) for (let j = i + 1; j < cuts.length; j++) {
    const [c1, e1] = cuts[i], [c2, e2] = cuts[j];
    const a = text.slice(0, e1).trim(), b = text.slice(c1, e2).trim(), c = text.slice(c2).trim();
    if (!a || !b || !c) continue;
    const w = Math.max(textWidth(a, fs), textWidth(b, fs), textWidth(c, fs));
    if (!best || w < best.tw) best = { lines: [a, b, c], tw: w };
  }
  return best;
}

// panelLineIds：這張圖畫哪幾條資料線；回傳 { svg, mode, unlabeled, ... }
// 版面最多重試四次：端點站的標籤放不下時，把四周留白加大（地圖縮小）再排一次
function geoMapSvg(model, built, lang, panelLineIds, mapId, titleText, descText) {
  const lms = panelLineIds.map(id => model.lineModels[id]);
  const lats = [], lons = [];
  for (const lm of lms) { for (const p of lm.data.shape) { lats.push(p[0]); lons.push(p[1]); } for (const s of lm.stations) { lats.push(s.lat); lons.push(s.lon); } }
  const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
  const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const dx = (lo1 - lo0) * kx, dy = la1 - la0;

  // 站點（同名合併）與相鄰關係（與投影無關，只算一次）
  const nodeMap = new Map();
  const adjacency = new Map();
  const link = (a, b) => { if (!adjacency.has(a)) adjacency.set(a, new Set()); if (!adjacency.has(b)) adjacency.set(b, new Set()); adjacency.get(a).add(b); adjacency.get(b).add(a); };
  let order = 0;
  for (const lm of lms) {
    const page = built.pageOfLine.get(lm.id);
    lm.stations.forEach((s, i) => {
      let nd = nodeMap.get(s.zh);
      if (!nd) {
        nd = { zh: s.zh, lat: 0, lon: 0, count: 0, lineId: lm.id, row: { ...s, lineId: lm.id }, page, order: order++, lines: new Set(), ends: 0, interior: 0 };
        nodeMap.set(s.zh, nd);
      }
      nd.lat += s.lat; nd.lon += s.lon; nd.count++; nd.lines.add(lm.id);
      // 端點＝在某條資料線上是頭或尾、又不是任何一條線的中間站（環狀線沒有端點）
      if (!lm.data.loop && (i === 0 || i === lm.stations.length - 1)) nd.ends++; else nd.interior++;
      if (i > 0) link(lm.stations[i - 1].zh, s.zh);
    });
    if (lm.data.loop) link(lm.stations[lm.stations.length - 1].zh, lm.stations[0].zh);
  }
  const base = [...nodeMap.values()].map(nd => {
    const terminal = nd.ends > 0 && nd.interior === 0;
    const ext = transfersOf(model, built, nd.page, nd.row);
    const pagesHere = new Set([...nd.lines].map(id => built.pageOfLine.get(id).slug));
    const xfer = ext.length > 0 || pagesHere.size > 1;
    const hub = new Set([...pagesHere, ...ext.map(t => (t.kind === 'metro' ? t.page.slug : t.kind))]).size;
    const nm = model.nameOf(lang, nd.lineId, nd.zh);
    const labelText = shortLabel(lang, nm.text);
    const wrapped = wrapLabel(labelText, LABEL_FS);
    const shapes = [{ lines: wrapped.lines, tw: wrapped.tw, th: wrapped.lines.length * LABEL_FS * 1.2 }];
    // 端點與轉乘站的兩行標籤，另備一個明顯較窄的三行版本（窄至少 15%）
    if ((terminal || xfer) && wrapped.lines.length === 2) {
      const w3 = wrapLabel3(labelText, LABEL_FS);
      if (w3 && w3.tw <= wrapped.tw * 0.85) shapes.push({ lines: w3.lines, tw: w3.tw, th: 3 * LABEL_FS * 1.2 });
    }
    return { ...nd, terminal, xfer, r: xfer ? R_XFER : terminal ? R_END : R_NORMAL, important: terminal || xfer ? 1 : 0, weight: (terminal ? 1000 : 0) + hub * 10 + nd.lines.size, shapes };
  });

  let chosen = null;
  for (const extra of [0, 14, 28, 42]) {
    const mx = MAP_MX + extra, my = MAP_MY + extra;
    let scale = (MAP_W - 2 * mx) / dx;
    let height = dy * scale + 2 * my;
    if (height > MAP_MAX_H) { scale = (MAP_MAX_H - 2 * my) / dy; height = MAP_MAX_H; }
    const ox = (MAP_W - dx * scale) / 2;
    const project = (lat, lon) => [ox + (lon - lo0) * kx * scale, my + (la1 - lat) * scale];
    height = Math.round(height * 10) / 10;
    const tracks = [], segs = [];
    for (const lm of lms) {
      const pts = rdp(lm.data.shape.map(p => project(p[0], p[1])), 0.35);
      tracks.push({ color: lm.data.color, d: 'M' + pts.map(p => `${num(p[0])} ${num(p[1])}`).join('L') });
      for (let i = 0; i + 1 < pts.length; i++) segs.push({ x0: pts[i][0], y0: pts[i][1], x1: pts[i + 1][0], y1: pts[i + 1][1] });
    }
    const nodes = base.map(b => { const [x, y] = project(b.lat / b.count, b.lon / b.count); return { ...b, x, y, box: null }; });
    // 貪婪配置對引線角度很敏感（差一組角度，後面整批站名就放不下），所以每個模式輪流試幾組角度：
    // 品質排序＝端點缺標（必須 0）→ 端點標籤壓到別站圓點 → 只標重點（key）不如全站名（all）；第一組滿分就收手。
    let attempt = null;
    search: for (const mode of ['all', 'key']) {
      for (const angles of LEADER_ANGLES) {
        for (const n of nodes) n.box = null;
        const complete = placeLabels(nodes, segs, MAP_W, height, mode, angles);
        const missingEnds = nodes.filter(n => n.terminal && !n.box).length;
        const dirtyEnds = nodes.filter(n => n.box && n.box.dotHits).length;
        const rank = missingEnds * 100 + dirtyEnds * 10 + (mode === 'all' ? 0 : 1) + (complete ? 0 : 5);
        if (!attempt || rank < attempt.rank) attempt = { rank, mode, missingEnds, dirtyEnds, boxes: nodes.map(n => n.box) };
        if (missingEnds === 0 && dirtyEnds === 0 && complete) break search;
      }
    }
    nodes.forEach((n, i) => { n.box = attempt.boxes[i]; });
    const cand = { extra, tracks, segs, nodes, mode: attempt.mode, height, missingEnds: attempt.missingEnds, rank: attempt.rank };
    if (!chosen || cand.rank < chosen.rank) chosen = cand;
    if (attempt.missingEnds === 0 && attempt.dirtyEnds === 0) break;
  }
  const { tracks, nodes, mode, height } = chosen;
  const unlabeled = nodes.filter(n => n.important && !n.box).map(n => n.zh);
  const unlabeledEnds = nodes.filter(n => n.terminal && !n.box).map(n => n.zh);

  const out = [];
  out.push(`<svg class="geo-map" viewBox="0 0 ${MAP_W} ${num(height)}" role="img" aria-labelledby="${mapId}-t ${mapId}-d" xmlns="http://www.w3.org/2000/svg">`);
  out.push(`<title id="${mapId}-t">${esc(titleText)}</title><desc id="${mapId}-d">${esc(descText)}</desc>`);
  out.push('<g class="casings">' + tracks.map(t => `<path class="casing" d="${t.d}" stroke-width="5.6"/>`).join('') + '</g>');
  out.push('<g class="tracks">' + tracks.map(t => `<path class="track" d="${t.d}" stroke="${t.color}" stroke-width="3.4"/>`).join('') + '</g>');
  const dotOrder = [...nodes].sort((a, b) => (a.xfer - b.xfer) || (a.terminal - b.terminal) || (a.order - b.order));
  out.push('<g class="dots">' + dotOrder.map(n => `<circle class="dot${n.terminal ? ' end' : ''}${n.xfer ? ' xfer' : ''}" cx="${num(n.x)}" cy="${num(n.y)}" r="${n.r}"/>`).join('') + '</g>');
  const labelled = nodes.filter(n => n.box).sort((a, b) => a.order - b.order);
  const leaders = labelled.filter(n => n.box.leader);
  if (leaders.length) out.push('<g class="leaders">' + leaders.map(n => `<path class="leader" d="M${num(n.box.leader.x0)} ${num(n.box.leader.y0)}L${num(n.box.leader.x1)} ${num(n.box.leader.y1)}"/>`).join('') + '</g>');
  out.push('<g class="labels">' + labelled.map(n => {
    const b = n.box, lh = LABEL_FS * 1.2;
    const x = b.a === 'start' ? b.x0 : b.a === 'end' ? b.x1 : (b.x0 + b.x1) / 2;
    return b.shape.lines.map((line, k) => `<text class="lbl" x="${num(x)}" y="${num(b.y0 + (k + 0.5) * lh + LABEL_FS * 0.34)}" text-anchor="${b.a}">${esc(line)}</text>`).join('');
  }).join('') + '</g>');
  out.push('</svg>');
  return { svg: out.join(''), mode, unlabeled, unlabeledEnds, labelCount: labelled.length, nodeCount: nodes.length, height, extra: chosen.extra };
}

// ── 頁面文字與共用片段 ───────────────────────────────────────────────────────────────
// 每一句話都由 data/ 推得或改寫自站上既有文案；三語並排寫在同一個 pick() 裡，改一句時三語一起看。
let M = null; // loadMetroModel 的結果（buildMetroPages 開頭設定；本模組一次建置只用一份）
let B = null; // buildPages 的結果
let ZH_SHELL = null; // build_aeo_pages.mjs 傳入的繁中頁首／頁尾（沿用站上既有版型）

const SYS = Object.fromEntries(SYSTEMS.map(s => [s.id, s]));
const GENERIC_NAMES = new Set(['green', 'red', 'orange']); // 台中綠線、高雄紅／橘線：跨系統引用時要冠上系統名
const homeHref = lang => (lang === 'zh' ? '/' : `${LANG_INFO[lang].prefix}/`);
const ovHref = lang => `${LANG_INFO[lang].prefix}/metro/`;
const sysHref = (lang, sysId) => `${LANG_INFO[lang].prefix}/metro/${sysId}/`;
const lineHref = (lang, page) => `${LANG_INFO[lang].prefix}/metro/${page.sysId}/${page.slug}/`;
const absUrl = pathname => `${SITE}${pathname}`;
const liveAll = lang => `/?g=metro${lang === 'zh' ? '' : `&lang=${lang}`}`;

const dn = (lang, row) => M.nameOf(lang, row.lineId, row.zh).text; // 站名（頁面語言，缺詞條退回中文）
const pn = (lang, row) => (lang === 'zh' ? row.zh : shortLabel(lang, dn(lang, row))); // 行文用站名（去掉 Station／駅）
const stRow = (lineId, idx) => ({ ...M.lineModels[lineId].stations[idx], lineId });
const allRows = page => [...page.trunk, ...page.branches.flatMap(b => b.rows)];
const lineName = (lang, page, fromSysId = null) => {
  const n = page.name[lang];
  if (fromSysId === page.sysId || !GENERIC_NAMES.has(page.slug)) return n;
  const s = SYS[page.sysId].name[lang];
  return lang === 'en' ? `${s} ${n}` : `${s}${n}`;
};
const list = (lang, items) => (lang === 'en' && items.length > 1
  ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  : items.join(pick(lang, '、', ', ', '・')));
const arrow = ' → ';

// 「桃園機場捷運」系統名與「機場捷運」路線名重複時，標題主體只用較長的那個
function headName(lang, page) {
  const s = SYS[page.sysId].name[lang], n = page.name[lang];
  const norm = t => t.toLowerCase().replace(/\s+line$/, '');
  if (norm(s).includes(norm(n)) || norm(n).includes(norm(s))) return norm(s).length >= norm(n).length ? s : n;
  return lang === 'en' ? `${s} ${n}` : lang === 'ja' ? `${s} ${n}` : `${s}${n}`;
}

// ── 營運時段／班距 ───────────────────────────────────────────────────────────────────
const set0Of = (page, lineId) => page.analysis[lineId].sets[0];
const set0Label = (lang, page, lineId) => dayLabel(lang, set0Of(page, lineId).days, set0Of(page, lineId).holiday);
const rangeText = (a, b, lang) => `${timeText(a, lang)}–${timeText(b, lang)}`;

// 該頁第一個班表日（平日）的最早首班與最晚末班。依附的短支線（新北投、小碧潭）也算：淡水信義線主線末班 00:00、
// 新北投支線到 00:12，只算主線會讓摘要少了支線的末班。支線的第一個班表日跟主線不同就不算（避免混到別的日型）。
function daySpan(page) {
  let first = Infinity, last = -Infinity;
  const main0 = set0Label('zh', page, page.cfg.lines[0]);
  for (const id of page.dataLineIds.filter(x => page.cfg.lines.includes(x) || set0Label('zh', page, x) === main0)) {
    const a = page.analysis[id], s0 = a.sets[0].name;
    if (a.estimated) {
      const w = a.window[s0];
      if (w) { first = Math.min(first, w.first); last = Math.max(last, w.last); }
    } else {
      for (const svc of a.services) { const c = svc.allBySet[s0]; if (c) { first = Math.min(first, c.first); last = Math.max(last, c.last); } }
    }
  }
  return Number.isFinite(first) ? { first, last, label: set0Label('zh', page, page.cfg.lines[0]) } : null;
}
const spanText = (lang, page) => {
  const sp = daySpan(page);
  if (!sp) return '';
  const r = rangeText(sp.first, sp.last, lang);
  return page.estimated
    ? pick(lang, `營運時段 ${r}`, `Operating hours ${r}`, `運行時間帯 ${r}`)
    : pick(lang, `${set0Label(lang, page, page.cfg.lines[0])}發車 ${r}`, `${set0Label(lang, page, page.cfg.lines[0])} departures ${r}`, `${set0Label(lang, page, page.cfg.lines[0])}の運行 ${r}`);
};

// 班距：實際時刻表的兩個時窗中位數（各方向起點站），或資料標示為估算的尖峰／離峰值
function headwayText(lang, page, lineId) {
  const a = page.analysis[lineId], h = a.headway;
  if (!h) return '';
  const lm = M.lineModels[lineId];
  if (h.estimated) {
    if (!h.peakMin && !h.offMin) return '';
    // 「資料標示為估算」只給資料自己把班距標成估算的線（三鶯線 headway_estimated）；文湖線、台中綠線的班距是 TDX 的班距資料，
    // 推估的只是逐班時刻（見 data/*_times.json 的 source_notes）
    const [lz, le, lj] = h.flagged ? ['班距（資料標示為估算）', 'Headway (estimate in the data)', '運転間隔（データ上の推定値）'] : ['班距', 'Headway', '運転間隔'];
    return pick(lang,
      `${lz}：${h.peakMin ? `尖峰約每 ${h.peakMin} 分鐘` : ''}${h.peakMin && h.offMin ? '、' : ''}${h.offMin ? `離峰約每 ${h.offMin} 分鐘` : ''}一班`,
      `${le}: ${h.peakMin ? `about every ${h.peakMin} min at peak` : ''}${h.peakMin && h.offMin ? ', ' : ''}${h.offMin ? `every ${h.offMin} min off-peak` : ''}`,
      `${lj}：${h.peakMin ? `ピーク時は約${h.peakMin}分おき` : ''}${h.peakMin && h.offMin ? '、' : ''}${h.offMin ? `オフピーク時は約${h.offMin}分おき` : ''}`);
  }
  const dirs = h.dirs.filter(d => d.morningMin || d.middayMin);
  if (!dirs.length) return '';
  const both = lm.times.kinds ? pick(lang, '，含普通車與直達車', ', all trains combined', '、各種別の合計') : '';
  const dayL = set0Label(lang, page, lineId);
  const win = (d, l) => {
    const m = d.morningMin, k = d.middayMin;
    if (l === 'zh') return [m ? `07:00–09:00 約每 ${m} 分鐘一班` : '', k ? `12:00–14:00 約每 ${k} 分鐘一班` : ''].filter(Boolean).join('、');
    if (l === 'en') return [m ? `about every ${m} min from 07:00 to 09:00` : '', k ? `about every ${k} min from 12:00 to 14:00` : ''].filter(Boolean).join(', ');
    return [m ? `07:00〜09:00は約${m}分おき` : '', k ? `12:00〜14:00は約${k}分おき` : ''].filter(Boolean).join('、');
  };
  const same = dirs.length === h.dirs.length && dirs.every(d => d.morningMin === dirs[0].morningMin && d.middayMin === dirs[0].middayMin);
  const head = pick(lang, `班距（依時刻表計算，${dayL}${both}）：`, `Headway (calculated from the timetable, ${dayL}${both}): `, `運転間隔（時刻表から計算、${dayL}${both}）：`);
  if (same) return head + win(dirs[0], lang);
  const per = dirs.map(d => {
    const o = pn(lang, stRow(lineId, d.origin));
    return pick(lang, `${o}發車 ${win(d, 'zh')}`, `from ${o}, ${win(d, 'en')}`, `${o}発：${win(d, 'ja')}`);
  });
  return head + per.join(pick(lang, '；', '; ', '／'));
}

// ── 路線結構描述 ─────────────────────────────────────────────────────────────────────
const branchLabel = (lang, lineId) => BRANCH_NAME[lineId] ? BRANCH_NAME[lineId][lang] : '';
function termLast(page, b) { return b.rows.length ? b.rows[b.rows.length - 1] : b.junction; }

function structureText(lang, page) {
  const n = page.stationCount, loop = page.cfg.lines.some(id => M.lineModels[id].data.loop);
  const A = pn(lang, page.trunk[0]);
  if (loop) return pick(lang, `共 ${n} 站的環狀路線`, `a loop line with ${n} stations`, `全${n}駅の環状路線`);
  if (page.cfg.mode === 'prefix') {
    const J = pn(lang, page.branches[0].junction);
    const ends = page.branches.map(b => pn(lang, termLast(page, b)));
    return pick(lang,
      `共 ${n} 站，從${A}出發，在${J}分成${list(lang, ends)}兩個方向`,
      `${n} stations from ${A}, splitting at ${J} toward ${list(lang, ends)}`,
      `全${n}駅で、${A}から${J}を経て${list(lang, ends)}の2方面に分かれます`);
  }
  const Z = pn(lang, page.trunk[page.trunk.length - 1]);
  let text = pick(lang, `共 ${n} 站，由${A}到${Z}`, `${n} stations from ${A} to ${Z}`, `${A}から${Z}まで全${n}駅`);
  if (page.branches.length) {
    const extra = page.branches.map(b => {
      const nm = branchLabel(lang, b.lineId) || pick(lang, '支線', 'branch', '支線');
      return pick(lang, `${nm}（${pn(lang, b.junction)}—${pn(lang, termLast(page, b))}）`, `${nm} (${pn(lang, b.junction)} – ${pn(lang, termLast(page, b))})`, `${nm}（${pn(lang, b.junction)}〜${pn(lang, termLast(page, b))}）`);
    });
    text += pick(lang, `，另有${list(lang, extra)}`, `, plus the ${list(lang, extra)}`, `。ほかに${list(lang, extra)}があります`);
  }
  return text;
}

function termText(lang, page) {
  const loop = page.cfg.lines.some(id => M.lineModels[id].data.loop);
  if (loop) return pick(lang, '環狀', 'loop', '環状');
  const A = pn(lang, page.trunk[0]);
  if (page.cfg.mode === 'prefix') {
    const ends = page.branches.map(b => pn(lang, termLast(page, b)));
    return lang === 'en' ? `${A} – ${ends.join(' / ')}` : `${A}—${ends.join('／')}`;
  }
  const Z = pn(lang, page.trunk[page.trunk.length - 1]);
  return lang === 'en' ? `${A} – ${Z}` : `${A}—${Z}`;
}

function xferStationCount(page) {
  const seen = new Set();
  for (const r of allRows(page)) if (transfersOf(M, B, page, r).length) seen.add(r.zh);
  return seen.size;
}

// ── 服務（方向×車種）標題與首末班文字 ───────────────────────────────────────────────
function svcRoute(lang, page, lineId, svc) {
  const lm = M.lineModels[lineId];
  const o = pn(lang, stRow(lineId, svc.origin));
  if (svc.dest != null) return `${o}${arrow}${pn(lang, stRow(lineId, svc.dest))}`;
  const next = pn(lang, stRow(lineId, svc.dir === 'fwd' ? 1 : lm.stations.length - 1));
  return pick(lang, `${o}出發，往${next}方向`, `From ${o} toward ${next}`, `${o}発、${next}方面`);
}
function svcTitle(lang, page, lineId, svc) {
  const parts = [];
  if (page.dataLineIds.length > 1 && BRANCH_NAME[lineId]) parts.push(BRANCH_NAME[lineId][lang]);
  if (svc.group) parts.push(KIND_LABEL[svc.group][lang]);
  parts.push(svcRoute(lang, page, lineId, svc));
  return parts.join(' · ');
}

// ── 特殊時段附註（只在 data/special_ops.json 還有該條時輸出） ─────────────────────────
function specialNotesFor(lang, page) {
  const ids = new Set((M.specialOps.ops || []).map(o => o.id));
  const label = (lineId, idx) => { const r = stRow(lineId, idx); return r.code ? (lang === 'en' ? `${pn(lang, r)} (${r.code})` : `${pn(lang, r)}（${r.code}）`) : pn(lang, r); };
  return SPECIAL_NOTES
    .filter(n => ids.has(n.opId) && M.date <= n.until && n.lineIds.some(id => page.dataLineIds.includes(id)))
    .map(n => ({ opId: n.opId, text: n.text(lang, label(n.lineIds[0], n.fromIdx), label(n.lineIds[0], n.toIdx)) }));
}

// ── 資料來源／日期 ────────────────────────────────────────────────────────────────────
function fetchInfo(page) {
  const file = M.lineModels[page.cfg.lines[0]].file;
  return { file, timesDate: fetchDate(M.files[file].times.source_notes) };
}
function sourceParagraphs(lang, page) {
  const { timesDate } = fetchInfo(page);
  const est = page.estimated;
  const p1 = pick(lang,
    `路線、站序與站間資料來自交通部 TDX 運輸資料流通服務與 OpenStreetMap 貢獻者（詳見<a href="/data-sources/">資料來源</a>）。${est ? '軌島的資料來源沒有這條路線的逐班時刻表，營運時段取自資料，班次依官方班距推估，不是營運單位公告的時刻。' : '首末班車與班距依本站收錄的逐站時刻表計算。'}${timesDate ? `時刻表資料抓取日：${timesDate}。` : ''}`,
    `Routes, stop order and running times come from Taiwan's Ministry of Transportation TDX open data and OpenStreetMap contributors (see <a href="/data-sources/" hreflang="zh-Hant">Data sources</a>, Traditional Chinese). ${est ? 'Rail Island\'s data sources have no train-by-train timetable for this line: the operating hours come from the data and the services are estimated from official headways, not the operator\'s published times.' : 'First and last trains and headways are calculated from the station-by-station timetable used on this site.'}${timesDate ? ` Timetable data fetched on ${timesDate}.` : ''}`,
    `路線、停車駅の順序、駅間データは交通部TDXの運輸データとOpenStreetMap貢献者のデータにもとづきます（<a href="/data-sources/" hreflang="zh-Hant">データの出典</a>・繁体字中国語）。${est ? '軌島のデータソースにはこの路線の列車ごとの時刻表がなく、運行時間帯はデータから、運行本数は公式の運転間隔からの推定で、運営会社が公表した時刻ではありません。' : '始発・終電と運転間隔は、このサイトで使っている駅別時刻表から計算しています。'}${timesDate ? `時刻表データの取得日：${timesDate}。` : ''}`);
  const p2 = pick(lang, `頁面產生日期：${M.date}。`, `Page generated on ${M.date}.`, `ページ生成日：${M.date}。`);
  return { p1, p2 };
}
const noticeText = lang => pick(lang, '臨時班表與異動以營運單位公告為準。', 'Temporary timetables and service changes are subject to the operator\'s announcements.', '臨時ダイヤや運行変更は、運営会社の発表を優先してください。');

// 地圖上怎麼跑：照站上現行說法（index.html 捷運頁導言與 9/11 更新紀錄 metrolead0911，OFFICIAL_ROSTER_ENABLED 預設開）。
//   台北捷運（含文湖線、環狀線）：位置與車站倒數來自官方逐班即時資料，時刻表只是沒有即時資料時的備案；
//     文湖線沒有逐班時刻表，備案時刻表依班距推估。
//   三鶯線、台中捷運：沒有即時列車資料（index.html METRO_LIVE_SYS 不含），依班距推估的時刻表跑。
//   高雄環狀輕軌：有官方逐車 GPS。其餘：依時刻表跑，有官方到站倒數或列車動態時校正。
function runNote(lang, page) {
  if (page && page.sysId === 'taipei') {
    const n = page.name[lang];
    return pick(lang,
      `${n}的列車位置與車站倒數來自官方逐班即時資料；沒有即時資料時，才改依時刻表推演${page.estimated ? `，而${n}的時刻表是依官方班距推估的` : ''}。`,
      `${n} train positions and station countdowns come from official train-by-train live data; only when there is no live data does Rail Island fall back to the timetable${page.estimated ? ', which for this line is estimated from official headways' : ''}.`,
      `${n}の列車位置と駅のカウントダウンは、公式の列車ごとのリアルタイムデータにもとづきます。リアルタイムデータがないときだけ時刻表にもとづいて表示します${page.estimated ? `。${n}の時刻表は公式の運転間隔からの推定です` : ''}。`);
  }
  if (page && page.estimated) {
    return pick(lang,
      '軌島的資料來源沒有這條路線的即時列車資料，列車依時刻表在地圖上跑；這份時刻表是依官方班距推估的。',
      'Rail Island\'s data sources have no live train data for this line, so trains run on the timetable on the map, and that timetable is estimated from official headways.',
      '軌島のデータソースにはこの路線のリアルタイムの列車データがないため、列車は時刻表どおりに地図上を走ります。その時刻表は公式の運転間隔からの推定です。');
  }
  if (page && page.dataLineIds.includes('C')) {
    return pick(lang,
      '高雄環狀輕軌有官方逐車 GPS 可用時，軌島用它校正各車位置；定位中斷時退回到站看板，列車仍依時刻表在地圖上跑。',
      'When the official per-train GPS of the Kaohsiung Circular Light Rail is available, Rail Island uses it to correct each train\'s position; when positioning drops out it falls back to the arrival boards, and trains keep running on the timetable on the map.',
      '高雄のライトレール環状線では、公式の列車ごとの GPS が使えるときはその情報で各列車の位置を補正します。位置情報が途切れたときは駅の到着案内に戻りますが、列車は引き続き時刻表どおりに地図上を走ります。');
  }
  return pick(lang,
    '沒有逐車 GPS 的部分，列車依時刻表在地圖上跑；有官方到站倒數或列車動態時，軌島會用它校正畫面。',
    'Where there is no per-train GPS, trains run on the timetable on the map; where the operator provides arrival countdowns or train positions, Rail Island uses them to correct the picture.',
    '列車ごとの GPS がない部分は、列車が時刻表どおりに地図上を走ります。公式の到着カウントダウンや列車位置が使える場合は、それで画面を補正します。');
}

// 總覽：台北捷運（官方逐班即時）與其他系統（依時刻表跑、有官方即時資料時校正）分開寫
function overviewRunNote(lang) {
  return pick(lang,
    '台北捷運各線的列車位置與車站倒數來自官方逐班即時資料；其他系統的列車依時刻表在地圖上跑，有官方到站倒數、列車動態或逐車 GPS 時，軌島會用它校正畫面。',
    'On Taipei MRT lines, train positions and station countdowns come from official train-by-train live data. On the other systems, trains run on the timetable on the map, and Rail Island corrects them with official arrival countdowns, train positions or per-train GPS where available.',
    '台北MRTの各線は、列車位置と駅のカウントダウンが公式の列車ごとのリアルタイムデータにもとづきます。ほかのシステムでは列車が時刻表どおりに地図上を走ります。公式の到着カウントダウン、列車位置、列車ごとの GPS が使える場合は、それで画面を補正します。');
}

// ── 版型：head／header／footer／麵包屑 ────────────────────────────────────────────────
function headHtml(lang, { title, description, pathname, alts, schema }) {
  const canonical = absUrl(pathname);
  const alt = [['zh-Hant', alts.zh], ['en', alts.en], ['ja', alts.ja], ['x-default', alts.zh]];
  return `<!doctype html>
<html lang="${LANG_INFO[lang].html}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
${alt.map(([code, p]) => `  <link rel="alternate" hreflang="${code}" href="${absUrl(p)}">`).join('\n')}
  <meta property="og:locale" content="${LANG_INFO[lang].og}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="軌島 Rail Island">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE}/og-1200x630.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-180.png">
  <meta name="theme-color" content="#F2EDE2">
  <link rel="stylesheet" href="/assets/aeo.css">
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>`;
}

function headerHtml(lang, alts) {
  if (lang === 'zh') return ZH_SHELL.header();
  const switchLinks = LANGS.filter(l => l !== lang).map(l => [pick(l, '中文', 'English', '日本語'), alts[l], LANG_INFO[l].html]);
  const live = `/?lang=${lang}`;
  return `<body>
  <a class="skip-link" href="#main">${esc(pick(lang, '', 'Skip to main content', 'メインコンテンツへ'))}</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="${homeHref(lang)}" aria-label="${esc(pick(lang, '', 'Rail Island home', '軌島 ホーム'))}"><span class="brand-mark" aria-hidden="true">軌</span><span>軌島 Rail Island</span></a>
      <nav class="site-nav" aria-label="${esc(pick(lang, '', 'Main navigation', 'メインナビゲーション'))}">
        ${switchLinks.map(([label, href, code]) => `<a href="${href}" hreflang="${code}" lang="${code}">${esc(label)}</a>`).join('\n        ')}
        <a href="${ovHref(lang)}">${esc(pick(lang, '', 'Metro maps', 'メトロ路線図'))}</a>
        <a class="nav-live" href="${live}">${esc(pick(lang, '', 'Open the live map', 'ライブ地図を開く'))}</a>
      </nav>
    </div>
  </header>`;
}

function footerHtml(lang, alts) {
  if (lang === 'zh') {
    const extra = `<a href="${ovHref('zh')}">捷運路線圖</a><a href="${alts.en}" hreflang="en" lang="en">English</a><a href="${alts.ja}" hreflang="ja" lang="ja">日本語</a>`;
    return ZH_SHELL.footer(extra);
  }
  const links = [
    [pick(lang, '', 'Metro maps', 'メトロ路線図'), ovHref(lang), null],
    [pick(lang, '', 'Accuracy and limits (Traditional Chinese)', '精度と限界（繁体字中国語）'), '/accuracy/', 'zh-Hant'],
    [pick(lang, '', 'Data sources (Traditional Chinese)', 'データの出典（繁体字中国語）'), '/data-sources/', 'zh-Hant'],
    [pick(lang, '', 'GitHub source', 'GitHub ソースコード'), GITHUB, null],
  ];
  return `<footer class="site-footer">
    <div class="site-footer-inner">
      <div>${esc(pick(lang, '', 'Rail Island is an independently maintained, source-available animated map of Taiwan\'s railways and is not affiliated with any operator.', '軌島は独立して運営している、ソースコード公開の台湾鉄道アニメーション地図です。各鉄道事業者とは関係ありません。'))}</div>
      <div class="footer-links">${links.map(([label, href, hl]) => `<a href="${href}"${hl ? ` hreflang="${hl}"` : ''}>${esc(label)}</a>`).join('')}</div>
    </div>
  </footer>
</body>
</html>
`;
}

function crumbsHtml(lang, items) {
  const label = pick(lang, '麵包屑', 'Breadcrumb', 'パンくずリスト');
  return `<nav class="breadcrumbs" aria-label="${label}"><ol>${items.map((item, i) => `<li>${i === items.length - 1 ? esc(item.label) : `<a href="${item.href}">${esc(item.label)}</a>`}</li>`).join('')}</ol></nav>`;
}

function schemaFor(lang, { type, title, description, pathname, crumbs, extra = {} }) {
  const url = absUrl(pathname);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': type, '@id': `${url}#webpage`, name: title, description, url, inLanguage: LANG_INFO[lang].html, dateModified: M.date,
        isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${SITE}/` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        ...extra,
      },
      {
        '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: absUrl(c.href) })),
      },
    ],
  };
}

// 麵包屑：首頁 → 捷運路線圖 → （系統）→ 本頁
function crumbList(lang, kind, sys = null, page = null) {
  const items = [{ label: pick(lang, '首頁', 'Home', 'ホーム'), href: homeHref(lang) }];
  items.push({ label: pick(lang, '捷運路線圖', 'Metro maps', 'メトロ路線図'), href: ovHref(lang) });
  if (sys) items.push({ label: sys.name[lang], href: sysHref(lang, sys.id) });
  if (page) items.push({ label: page.name[lang], href: lineHref(lang, page) });
  return items;
}

function pageDocument(lang, { title, description, pathname, alts, schema, crumbs, eyebrow, h1, lede, actions, content }) {
  return `${headHtml(lang, { title, description, pathname, alts, schema })}
${headerHtml(lang, alts)}
  <main class="page-shell" id="main">
    ${crumbsHtml(lang, crumbs)}
    <section class="hero">
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h1>${esc(h1)}</h1>
      <p class="lede">${esc(lede)}</p>
      <div class="hero-actions">${actions}</div>
    </section>
    ${content}
  </main>
${footerHtml(lang, alts)}`;
}

const liveButton = (lang, href, secondary = false) => `<a class="button${secondary ? ' secondary' : ''}" href="${esc(href)}">${esc(pick(lang, '在地圖上看即時列車', 'See the trains on the live map', 'ライブ地図で列車を見る'))}</a>`;
const section = (id, h2, body) => `<section class="content-section" id="${id}"><h2>${esc(h2)}</h2>${body}</section>`;

// ── 路線頁 ───────────────────────────────────────────────────────────────────────────
const dataLineLabel = (lang, page, lineId) => {
  const n = M.lineModels[lineId].stations.length;
  const span = lang === 'en' ? `${pn(lang, stRow(lineId, 0))} – ${pn(lang, stRow(lineId, n - 1))}` : `${pn(lang, stRow(lineId, 0))}—${pn(lang, stRow(lineId, n - 1))}`;
  const nm = BRANCH_NAME[lineId] ? BRANCH_NAME[lineId][lang] : '';
  return nm ? (lang === 'en' ? `${nm} (${span})` : `${nm}（${span}）`) : span;
};

// 轉乘清單的分隔：站碼膠囊（.stop-code）是 inline-block，瀏覽器可以在它後面斷行，分隔符號就被擠到下一行行首（「、機場捷運」）。
// 把膠囊和緊跟的分隔符號包進不斷行的 .nb；英文逗號後的空白留在外面，換行落在兩項之間。items：{ head: html, code?: 站碼 }
function joinXfer(lang, items) {
  const mark = esc(pick(lang, '、', ',', '・')), gap = lang === 'en' ? ' ' : '';
  return items.map((it, i) => {
    const last = i === items.length - 1, s = last ? '' : mark;
    return (it.code ? `${it.head} <span class="nb"><span class="stop-code">${esc(it.code)}</span>${s}</span>` : `${it.head}${s}`) + (last ? '' : gap);
  }).join('');
}

function xferHtml(lang, page, row) {
  const items = transfersOf(M, B, page, row).map(t => {
    if (t.kind === 'metro') return { head: `<a href="${lineHref(lang, t.page)}">${esc(lineName(lang, t.page, page.sysId))}</a>`, code: t.code };
    if (t.kind === 'tra') return { head: esc(pick(lang, '台鐵', 'Taiwan Railway (TRA)', '台鉄（TRA）')) };
    return { head: esc(pick(lang, '高鐵', 'Taiwan High Speed Rail', '台湾高速鉄道')) };
  });
  return items.length ? `<div class="stop-xfer">${esc(pick(lang, '轉乘：', 'Transfer: ', '乗り換え：'))}${joinXfer(lang, items)}</div>` : '';
}

function stopRow(lang, page, row, i, n, opts) {
  const isFirst = i === 0, isLast = i === n - 1;
  const isEnd = (isFirst && opts.endFirst) || (isLast && opts.endLast);
  const xf = xferHtml(lang, page, row);
  const cls = ['stop', isFirst ? 'is-first' : '', isLast ? 'is-last' : '', isEnd ? 'is-end' : '', xf ? 'is-xfer' : ''].filter(Boolean).join(' ');
  const name = dn(lang, row);
  const alt = lang !== 'zh' && row.zh !== name && row.zh !== shortLabel('zh', name) ? `<span class="stop-alt" lang="zh-Hant">${esc(row.zh)}</span>` : '';
  const slug = row.key ? M.stationPageOf.get(row.key) : null;
  const guide = slug ? `<a class="stop-guide" href="/stations/${slug}/"${lang === 'zh' ? '' : ' hreflang="zh-Hant"'}>${esc(pick(lang, '車站資料', 'Station guide (Traditional Chinese)', '駅ガイド（繁体字中国語）'))}</a>` : '';
  const ring = isEnd ? '<circle class="core" cx="10" cy="10" r="3.2"/>' : '';
  return `<li class="${cls}"><div class="rail" style="color:${opts.color}" aria-hidden="true"><svg class="rail-seg" viewBox="0 0 40 10" preserveAspectRatio="none"><rect class="cas" x="13" y="0" width="14" height="10"/><rect x="16" y="0" width="8" height="10" fill="currentColor"/></svg><svg class="rail-node" viewBox="0 0 20 20"><circle class="ring" cx="10" cy="10" r="${xf ? 7.6 : 6.2}"/>${ring}</svg></div><div class="stop-body"><div class="stop-name">${esc(name)}${row.code ? `<span class="stop-code">${esc(row.code)}</span>` : ''}${alt}</div>${xf}${guide}</div></li>`;
}

function stopGroup(lang, page, rows, opts, heading = '', note = '') {
  const head = heading ? `<h3>${esc(heading)}</h3>` : '';
  const noteHtml = note ? `<p class="group-note">${esc(note)}</p>` : '';
  return `<div class="stop-group">${head}${noteHtml}<ol class="stop-list">${rows.map((r, i) => stopRow(lang, page, r, i, rows.length, opts)).join('')}</ol></div>`;
}

function stopsSection(lang, page) {
  const color = page.color;
  const loop = page.cfg.lines.some(id => M.lineModels[id].data.loop);
  const A = pn(lang, page.trunk[0]);
  const intro = pick(lang,
    `站序依資料由${A}排列；站名旁是車站代號，「轉乘」列出可換乘的路線、台鐵與高鐵。轉乘關係依站名相同且距離小於 ${M.transfers.criteria.maxDistanceM} 公尺判讀，不代表站內導引或所需時間。`,
    `Stops are listed from ${A}; the code next to each name is the station code, and "Transfer" lists the lines, Taiwan Railway (TRA) and High Speed Rail you can change to. A transfer means the same station name within ${M.transfers.criteria.maxDistanceM} m; it says nothing about walking time inside the station.`,
    `停車駅は${A}側から順に並べています。駅名の横は駅コード、「乗り換え」は乗り換えられる路線・台鉄・台湾高速鉄道です。乗り換えは、同じ駅名で距離が${M.transfers.criteria.maxDistanceM}m未満のものを示し、駅構内の歩行時間は表しません。`);
  let groups = '';
  if (page.cfg.mode === 'prefix') {
    const J = pn(lang, page.branches[0].junction);
    groups += stopGroup(lang, page, page.trunk, { color, endFirst: true, endLast: false },
      pick(lang, `共用路段：${A}${arrow}${J}`, `Shared section: ${A}${arrow}${J}`, `共通区間：${A}${arrow}${J}`));
    for (const b of page.branches) {
      const T = pn(lang, termLast(page, b));
      const bn = branchLabel(lang, b.lineId);
      groups += stopGroup(lang, page, b.rows, { color: M.lineModels[b.lineId].data.color, endFirst: false, endLast: true },
        pick(lang, `往${T}${bn ? `（${bn}）` : ''}`, `Toward ${T}${bn ? ` (${bn})` : ''}`, `${T}方面${bn ? `（${bn}）` : ''}`),
        pick(lang, `從${J}分岔`, `Branches from ${J}`, `${J}で分岐`));
    }
  } else if (page.branches.length) {
    const Z = pn(lang, page.trunk[page.trunk.length - 1]);
    groups += stopGroup(lang, page, page.trunk, { color, endFirst: true, endLast: true }, pick(lang, `主線：${A}${arrow}${Z}`, `Main line: ${A}${arrow}${Z}`, `本線：${A}${arrow}${Z}`));
    for (const b of page.branches) {
      const T = pn(lang, termLast(page, b));
      const bn = branchLabel(lang, b.lineId);
      groups += stopGroup(lang, page, b.rows, { color: M.lineModels[b.lineId].data.color, endFirst: false, endLast: true },
        `${bn ? `${bn}${pick(lang, '：', ': ', '：')}` : ''}${pn(lang, b.junction)}${arrow}${T}`,
        pick(lang, `從${pn(lang, b.junction)}分岔`, `Branches from ${pn(lang, b.junction)}`, `${pn(lang, b.junction)}で分岐`));
    }
  } else {
    groups += stopGroup(lang, page, page.trunk, { color, endFirst: !loop, endLast: !loop });
    if (loop) groups += `<p class="loop-close">${esc(pick(lang, `↻ 回到${A}，環狀營運`, `↻ Back to ${A} — the line runs as a loop`, `↻ ${A}に戻る環状運転`))}</p>`;
  }
  return section('stops', pick(lang, `${page.name.zh}路線圖與車站`, `${page.name.en} route map and stations`, `${page.name.ja}の路線図と駅`), `<p class="section-intro">${esc(intro)}</p>${groups}`);
}

// 不開到終點站的班次（analyzeLine 的 others：只留把首班提早或末班延後的目的地）。班數少就逐班列出發車時間，多就寫區間與班數。
function shortRunText(lang, o) {
  const ts = o.times.map(t => timeText(t, lang));
  if (o.count <= 4) return pick(lang, `${ts.join('、')} 發車`, `departing ${ts.join(', ')}`, `${ts.join('、')}発`);
  return pick(lang, `${ts[0]}–${ts[ts.length - 1]} 之間共 ${o.count} 班`, `${o.count} trains between ${ts[0]} and ${ts[ts.length - 1]}`, `${ts[0]}〜${ts[ts.length - 1]}の間に${o.count}本`);
}

function shortRunNotes(lang, page, lineId, svc) {
  const a = page.analysis[lineId];
  const dests = [...new Set(a.sets.flatMap(set => (svc.others[set.name] || []).map(o => o.dest)))].sort((x, y) => x - y);
  return dests.map(d => {
    const per = a.sets.map(set => ({ set, o: (svc.others[set.name] || []).find(o => o.dest === d) })).filter(x => x.o);
    const same = per.length === a.sets.length && per.every(x => x.o.times.join(',') === per[0].o.times.join(','));
    const name = pn(lang, stRow(lineId, d));
    const body = same ? shortRunText(lang, per[0].o) : per.map(x => `${dayLabel(lang, x.set.days, x.set.holiday)} ${shortRunText(lang, x.o)}`).join(pick(lang, '；', '; ', '／'));
    const tail = same && a.sets.length > 1 ? pick(lang, '（各班表日相同）', ' (same on every timetable day)', '（どの曜日も同じ）') : '';
    return pick(lang, `另有只開到${name}、不開到終點站的班次：${body}${tail}`, `Some trains stop short at ${name}: ${body}${tail}`, `${name}止まりの列車もあります：${body}${tail}`);
  });
}

function serviceCard(lang, page, lineId, svc) {
  const a = page.analysis[lineId];
  const rows = a.sets.map(set => {
    const cell = svc.bySet[set.name];
    return `<tr><th scope="row">${esc(dayLabel(lang, set.days, set.holiday))}</th><td class="t">${cell ? timeHtml(cell.first) : '—'}</td><td class="t">${cell ? timeHtml(cell.last) : '—'}</td></tr>`;
  }).join('');
  const head = pick(lang, ['班表日', '首班', '末班'], ['Days', 'First', 'Last'], ['曜日', '始発', '終電']).map(t => `<th scope="col">${esc(t)}</th>`).join('');
  const foot = shortRunNotes(lang, page, lineId, svc).map(t => `<p class="svc-foot">${esc(t)}</p>`).join('');
  return `<article class="time-card"><h3>${esc(svcTitle(lang, page, lineId, svc))}</h3><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${foot}</article>`;
}

function answerSection(lang, page) {
  const n = page.name[lang];
  const items = [];
  for (const id of page.cfg.lines) {
    const a = page.analysis[id], s0 = a.sets[0], dl = dayLabel(lang, s0.days, s0.holiday);
    if (a.estimated) {
      const w = a.window[s0.name];
      if (w) items.push(pick(lang,
        `<strong>營運時段（${esc(dl)}）</strong>：${esc(rangeText(w.first, w.last, lang))}`,
        `<strong>Operating hours (${esc(dl)})</strong>: ${esc(rangeText(w.first, w.last, lang))}`,
        `<strong>運行時間帯（${esc(dl)}）</strong>：${esc(rangeText(w.first, w.last, lang))}`));
    } else {
      for (const svc of a.services) {
        const c = svc.bySet[s0.name];
        if (!c) continue;
        items.push(pick(lang,
          `<strong>${esc(svcTitle(lang, page, id, svc))}</strong>（${esc(dl)}）：首班 ${esc(timeText(c.first, lang))}、末班 ${esc(timeText(c.last, lang))}`,
          `<strong>${esc(svcTitle(lang, page, id, svc))}</strong> (${esc(dl)}): first ${esc(timeText(c.first, lang))}, last ${esc(timeText(c.last, lang))}`,
          `<strong>${esc(svcTitle(lang, page, id, svc))}</strong>（${esc(dl)}）：始発 ${esc(timeText(c.first, lang))}、終電 ${esc(timeText(c.last, lang))}`));
        for (const o of svc.others[s0.name] || []) {
          const t = esc(svcTitle(lang, page, id, { ...svc, dest: o.dest }));
          items.push(pick(lang,
            `<strong>${t}</strong>（${esc(dl)}，不開到終點站的班次）：${esc(shortRunText(lang, o))}`,
            `<strong>${t}</strong> (${esc(dl)}, trains that stop short): ${esc(shortRunText(lang, o))}`,
            `<strong>${t}</strong>（${esc(dl)}、途中までの列車）：${esc(shortRunText(lang, o))}`));
        }
      }
    }
  }
  for (const id of page.cfg.lines) {
    const hw = headwayText(lang, page, id);
    if (hw) items.push(esc(page.cfg.lines.length > 1 ? `${dataLineLabel(lang, page, id)}${pick(lang, '：', ': ', '：')}${hw}` : hw));
  }
  const loopLine = page.cfg.lines.some(id => M.lineModels[id].data.loop);
  const note = page.estimated
    ? pick(lang, '軌島的資料來源沒有這條路線的逐班時刻表，因此不列首末班車，營運時段與班距請以營運單位公告為準。',
      'Rail Island\'s data sources have no train-by-train timetable for this line, so first and last trains are not listed; check the operator for the actual hours and headways.',
      '軌島のデータソースにはこの路線の列車ごとの時刻表がないため、始発・終電は掲載していません。実際の運行時間と運転間隔は運営会社の発表で確認してください。')
    : loopLine
    ? pick(lang, '環狀線沒有終點站：「首班」「末班」是從上面列出的車站往各方向發車的最早與最晚時間；各班表日與各站時刻在下方。',
      'The line is a loop with no terminus: "first" and "last" are the earliest and latest departures from the station shown above, in each direction. Other day types and every station are further down.',
      '環状線には終点がないため、「始発」「終電」は上に示した駅から各方向へ出る最初と最後の列車の発車時刻です。ほかの曜日と各駅の時刻は下にあります。')
    : pick(lang, '「首班」「末班」是開到終點站的列車在起點站的最早與最晚發車時間；比這更早或更晚、只開到中途的班次另外標示；各班表日與各站時刻在下方。',
      '"First" and "last" are the earliest and latest departures from the starting terminus of trains that run all the way to the other end; trains that stop short and leave earlier or later than these are listed separately. Other day types and every station are further down.',
      '「始発」「終電」は、反対側の終点まで走る列車の起点駅での最初と最後の発車時刻です。それより早く、または遅く出る途中止まりの列車は別に示します。ほかの曜日と各駅の時刻は下にあります。');
  const h2 = page.estimated
    ? pick(lang, `${page.name.zh}的營運時間`, `${page.name.en} operating hours`, `${page.name.ja}の運行時間`)
    : pick(lang, `${page.name.zh}首班車和末班車幾點？`, `What time are the first and last trains on the ${page.name.en}?`, `${page.name.ja}の始発・終電は何時？`);
  return section('answer', h2, `<div class="answer-box"><ul class="answer-list">${items.map(i => `<li>${i}</li>`).join('')}</ul><p class="table-note">${esc(note)}</p></div>`);
}

function timesSection(lang, page) {
  const cards = [];
  const facts = [];
  for (const id of page.dataLineIds) {
    const a = page.analysis[id];
    if (!a.estimated) for (const svc of a.services) cards.push(serviceCard(lang, page, id, svc));
    const hw = headwayText(lang, page, id);
    if (hw) facts.push(page.dataLineIds.length > 1 ? `${dataLineLabel(lang, page, id)}${pick(lang, '：', ': ', '：')}${hw}` : hw);
  }
  let body = '';
  if (page.estimated) {
    const rows = [];
    for (const id of page.dataLineIds) {
      const a = page.analysis[id];
      for (const set of a.sets) {
        const w = a.window[set.name];
        if (w) rows.push(`<tr><th scope="row">${esc(dayLabel(lang, set.days, set.holiday))}</th><td class="t">${timeHtml(w.first)}</td><td class="t">${timeHtml(w.last)}</td></tr>`);
      }
    }
    const head = pick(lang, ['班表日', '營運開始', '營運結束'], ['Days', 'Starts', 'Ends'], ['曜日', '運行開始', '運行終了']).map(t => `<th scope="col">${esc(t)}</th>`).join('');
    body += `<div class="time-grid"><article class="time-card"><h3>${esc(pick(lang, '營運時段', 'Operating hours', '運行時間帯'))}</h3><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></article></div>`;
  } else {
    body += `<div class="time-grid">${cards.join('')}</div>`;
  }
  if (facts.length) body += `<ul class="facts-list">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
  const foot = page.estimated
    ? pick(lang, '「+1」表示次日凌晨。', '"+1" means after midnight (next day).', '「+1」は翌日の深夜を表します。')
    : pick(lang, '「+1」表示次日凌晨。班距是起點站相鄰兩班發車間隔的中位數，依本站收錄的逐站時刻表計算。', '"+1" means after midnight (next day). Headway is the median gap between consecutive departures at the starting station, calculated from the station-by-station timetable used on this site.', '「+1」は翌日の深夜を表します。運転間隔は起点駅で隣り合う2本の発車間隔の中央値で、このサイトで使っている駅別時刻表から計算しています。');
  body += `<p class="table-note">${esc(foot)}</p>`;
  for (const note of specialNotesFor(lang, page)) body += `<div class="notice"><strong>${esc(pick(lang, '特殊時段：', 'Special period: ', '特別ダイヤ：'))}</strong>${esc(note.text)}</div>`;
  return section('times', page.estimated ? pick(lang, '營運時段與班距', 'Operating hours and headways', '運行時間帯と運転間隔') : pick(lang, '首末班車與班距明細', 'First and last trains and headways in detail', '始発・終電と運転間隔の詳細'), body);
}

function stationTimesSection(lang, page) {
  if (page.estimated) return '';
  const loopLine = page.cfg.lines.some(id => M.lineModels[id].data.loop);
  let body = `<p class="section-intro">${esc(loopLine ? pick(lang,
    '環狀線各站往兩個方向的最早與最晚發車時間；某站沒有列車往該方向發車時以「—」表示。',
    'The earliest and latest departure from each station in each direction around the loop. "—" means no train departs from that station in that direction.',
    '環状線の各駅から、それぞれの方向へ出る最初と最後の発車時刻です。その駅からその方向へ出る列車がない場合は「—」です。') : pick(lang,
    '各站往某個方向的最早與最晚發車時間，含中途折返、不開到終點站的班次；某站沒有列車往該方向發車（例如終點站）以「—」表示。',
    'The earliest and latest departure from each station in one direction, including short-turn trains and trains that do not run to the end of the line. "—" means no train departs from that station in that direction (for example the terminus).',
    '各駅からその方向へ出る最初と最後の発車時刻で、途中折り返しの列車や終点まで行かない列車も含みます。その駅からその方向へ出る列車がない場合（終点など）は「—」です。'))}</p>`;
  for (const id of page.dataLineIds) {
    const a = page.analysis[id], lm = M.lineModels[id], n = lm.stations.length;
    if (page.dataLineIds.length > 1) body += `<h3>${esc(dataLineLabel(lang, page, id))}</h3>`;
    for (const dir of ['fwd', 'bwd']) {
      const idxs = lm.stations.map((_, i) => i);
      if (dir === 'bwd') idxs.reverse();
      const toIdx = a.loop ? (dir === 'fwd' ? 1 : n - 1) : (dir === 'fwd' ? n - 1 : 0);
      const dest = pn(lang, stRow(id, toIdx));
      body += `<h3>${esc(pick(lang, `往${dest}方向`, `Toward ${dest}`, `${dest}方面`))}</h3>`;
      for (const set of a.sets) {
        const per = a.perStation[set.name];
        const rows = idxs.map(i => {
          const c = per[i][dir];
          return `<tr><th scope="row">${esc(dn(lang, stRow(id, i)))}</th><td class="t">${c ? timeHtml(c.first) : '—'}</td><td class="t">${c ? timeHtml(c.last) : '—'}</td></tr>`;
        }).join('');
        const head = pick(lang, ['車站', '首班', '末班'], ['Station', 'First', 'Last'], ['駅', '始発', '終電']).map(t => `<th scope="col">${esc(t)}</th>`).join('');
        body += `<details><summary>${esc(dayLabel(lang, set.days, set.holiday))}</summary><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
      }
    }
  }
  return `<section class="content-section stop-times" id="station-times"><h2>${esc(pick(lang, `${page.name.zh}各站首末班車`, `${page.name.en} first and last trains by station`, `${page.name.ja}の駅ごとの始発・終電`))}</h2>${body}</section>`;
}

function siblingSection(lang, page) {
  const sys = SYS[page.sysId];
  const same = B.pages.filter(p => p.sysId === page.sysId && p.slug !== page.slug);
  const others = SYSTEMS.filter(s => s.id !== page.sysId);
  const pill = (href, label, color) => `<li><a href="${href}">${color ? `<span class="sw" style="background:${color}" aria-hidden="true"></span>` : ''}${esc(label)}</a></li>`;
  let body = '';
  if (same.length) body += `<h3>${esc(pick(lang, `${sys.name.zh}的其他路線`, `Other ${sys.name.en} lines`, `${sys.name.ja}のほかの路線`))}</h3><ul class="sibling-links">${same.map(p => pill(lineHref(lang, p), p.name[lang], p.color)).join('')}</ul>`;
  body += `<h3>${esc(pick(lang, '其他捷運系統', 'Other metro systems', 'ほかのメトロ'))}</h3><ul class="sibling-links">${pill(sysHref(lang, sys.id), pick(lang, `${sys.name.zh}路線圖`, `${sys.name.en} map`, `${sys.name.ja} 路線図`), null)}${others.map(s => pill(sysHref(lang, s.id), s.name[lang], null)).join('')}<li><a href="${ovHref(lang)}">${esc(pick(lang, '捷運路線圖總覽', 'All metro maps', 'メトロ路線図の一覧'))}</a></li></ul>`;
  return section('related', pick(lang, '其他路線與系統', 'Other lines and systems', 'ほかの路線とシステム'), body);
}

function liveSection(lang, href, page, sys) {
  const body = `<div class="answer-box"><p>${esc(runNote(lang, page))}</p></div><p>${liveButton(lang, href)}</p>`;
  return section('live', pick(lang, '在地圖上看即時列車', 'See the trains on the live map', 'ライブ地図で列車を見る'), body);
}

function sourceSection(lang, page) {
  const { p1, p2 } = sourceParagraphs(lang, page);
  return section('source', pick(lang, '資料來源與更新', 'Data sources and updates', 'データの出典と更新'),
    `<div class="answer-box"><p>${p1}</p><p class="source-note">${esc(p2)}</p></div><div class="notice"><strong>${esc(pick(lang, '提醒：', 'Note: ', 'ご注意：'))}</strong>${esc(noticeText(lang))}</div>`);
}

function buildLinePage(lang, page) {
  const sys = SYS[page.sysId];
  const est = page.estimated;
  const pathname = lineHref(lang, page);
  const alts = { zh: lineHref('zh', page), en: lineHref('en', page), ja: lineHref('ja', page) };
  const n = page.name[lang], s = sys.name[lang], hn = headName(lang, page);
  // 線名與系統名相同時（日文的機場捷運）不重複系統段：「桃園空港MRT … ｜桃園空港MRT｜軌島」→「桃園空港MRT … ｜軌島」
  const sysSeg = n === s ? null : s;
  const title = pick(lang,
    `${n}路線圖、車站與${est ? '營運時間' : '首末班車'}${sysSeg ? `｜${sysSeg}` : ''}｜軌島`,
    `${n} Map, Stations & ${est ? 'Operating Hours' : 'First/Last Trains'}${sysSeg ? ` | ${sysSeg}` : ''} | Rail Island`,
    `${n} 路線図・駅一覧・${est ? '運行時間' : '始発終電'}${sysSeg ? `｜${sysSeg}` : ''}｜軌島`);
  const h1 = pick(lang,
    `${hn}路線圖、車站與${est ? '營運時間' : '首末班車'}`,
    `${hn}: Map, Stations & ${est ? 'Operating Hours' : 'First/Last Trains'}`,
    `${hn} 路線図・駅一覧・${est ? '運行時間' : '始発終電'}`);
  const structure = structureText(lang, page);
  const xc = xferStationCount(page);
  const alias = page.cfg.alias ? page.cfg.alias[lang] : '';
  const nameAlias = alias ? pick(lang, `（${alias}）`, ` (${alias})`, `（${alias}）`) : '';
  const lede = pick(lang,
    `${hn}${nameAlias}${structure}${xc ? `，其中 ${xc} 站可轉乘其他路線、台鐵或高鐵` : ''}。${est ? '軌島的資料來源沒有這條路線的逐班時刻表，下面只列營運時段與班距。' : '下面列出兩個方向的首末班車、班距與各站轉乘。'}`,
    `${hn}${nameAlias}: ${structure}${xc ? `; ${xc === 1 ? '1 station connects' : `${xc} stations connect`} to other lines, Taiwan Railway (TRA) or High Speed Rail` : ''}. ${est ? 'Rail Island\'s data sources have no train-by-train timetable for this line, so only the operating hours and headways are listed below.' : 'Below are the first and last trains in both directions, headways and the transfers at each station.'}`,
    `${hn}${nameAlias}は、${structure}${xc ? `。そのうち${xc}駅で他の路線や台鉄、台湾高速鉄道に乗り換えられます` : ''}。${est ? '軌島のデータソースにはこの路線の列車ごとの時刻表がないため、下には運行時間帯と運転間隔だけを載せています。' : '下に両方向の始発・終電、運転間隔、各駅の乗り換えを載せています。'}`);
  const sp = spanText(lang, page);
  const brief = pick(lang, `共 ${page.stationCount} 站（${termText(lang, page)}）`, `${page.stationCount} stations (${termText(lang, page)})`, `全${page.stationCount}駅（${termText(lang, page)}）`);
  const description = pick(lang,
    `${hn}${brief}。${sp}。附各站轉乘${est ? '' : '、首末班車與班距'}，可在軌島地圖上看列車。`,
    `${hn}: ${brief}. ${sp}. Includes each station's transfers${est ? '' : ', first and last trains and headways'}, plus a link to the trains on Rail Island's live map.`,
    `${hn}は${brief}。${sp}。各駅の乗り換え${est ? '' : '、始発・終電、運転間隔'}をまとめ、軌島のライブ地図で列車を見られます。`);
  const crumbs = crumbList(lang, 'line', sys, page);
  const schema = schemaFor(lang, {
    type: 'WebPage', title, description, pathname, crumbs,
    extra: { mainEntity: { '@type': 'ItemList', name: `${n} ${pick(lang, '車站', 'stations', '駅')}`, numberOfItems: allRows(page).length, itemListElement: allRows(page).map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: dn(lang, r) })) } },
  });
  const live = liveHref(lang, page.bbox);
  const content = [answerSection(lang, page), stopsSection(lang, page), timesSection(lang, page), stationTimesSection(lang, page), liveSection(lang, live, page, sys), siblingSection(lang, page), sourceSection(lang, page)].filter(Boolean).join('\n    ');
  return {
    pathname,
    html: pageDocument(lang, {
      title, description, pathname, alts, schema, crumbs: crumbs.map(c => c), eyebrow: `${sys.name.en.toUpperCase()} · LINE MAP`, h1, lede,
      actions: `${liveButton(lang, live)}<a class="button secondary" href="${sysHref(lang, sys.id)}">${esc(pick(lang, `回${sys.name.zh}路線圖`, `Back to the ${sys.name.en} map`, `${sys.name.ja} 路線図へ`))}</a>`,
      content,
    }),
  };
}

// ── 系統頁 ───────────────────────────────────────────────────────────────────────────
function legendEntries(lang, sys, lineIds) {
  const out = [];
  const pages = [...new Set(lineIds.map(id => B.pageOfLine.get(id)))];
  for (const page of pages) {
    const ids = lineIds.filter(id => B.pageOfLine.get(id) === page);
    const colors = [...new Set(ids.map(id => M.lineModels[id].data.color))];
    if (colors.length === 1) { out.push({ page, color: colors[0], name: page.name[lang] }); continue; }
    for (const color of colors) {
      const id = ids.find(x => M.lineModels[x].data.color === color);
      const main = id === page.cfg.lines[0] && page.cfg.mode !== 'prefix';
      out.push({ page, color, name: main ? page.name[lang] : (BRANCH_NAME[id] ? BRANCH_NAME[id][lang] : page.name[lang]) });
    }
  }
  return out;
}

function systemMapFigures(lang, sys) {
  const descOf = names => pick(lang, `${names}的路線示意圖`, `Schematic map of ${names}`, `${names}の路線略図`);
  return sys.panels.map((panel, pi) => {
    const names = legendEntries(lang, sys, panel).map(e => e.name);
    const r = geoMapSvg(M, B, lang, panel, `map-${sys.id}-${pi}`, `${sys.name[lang]} ${pick(lang, '路線圖', 'route map', '路線図')}`, descOf(list(lang, names)));
    const legend = `<ul class="map-legend">${legendEntries(lang, sys, panel).map(e => `<li><a href="${lineHref(lang, e.page)}"><span class="swatch" style="background:${e.color}" aria-hidden="true"></span>${esc(e.name)}</a></li>`).join('')}</ul>`;
    const symbols = `<ul class="map-symbols"><li><span class="sym end"></span>${esc(pick(lang, '端點站', 'Terminus', '終点駅'))}</li><li><span class="sym xfer"></span>${esc(pick(lang, '轉乘站', 'Transfer station', '乗り換え駅'))}</li><li><span class="sym"></span>${esc(pick(lang, '車站', 'Station', '駅'))}</li></ul>`;
    const noteKey = r.mode === 'key' ? pick(lang, '圖中只標端點站與部分轉乘站，完整站名請看各路線頁。', 'Only termini and some transfer stations are named on the map; every station is listed on the line pages.', '地図には終点駅と一部の乗り換え駅だけを載せています。全駅の名前は各路線のページにあります。') : '';
    const note = `<p class="map-note">${esc(pick(lang, '路線圖依站點座標繪製，比例僅供參考。', 'The map is drawn from station coordinates; distances are not to scale.', '路線図は駅の座標から描いたもので、縮尺は目安です。'))}${noteKey ? (lang === 'en' ? ' ' : '') + esc(noteKey) : ''}</p>`;
    const caption = sys.panels.length > 1 ? panel.map(id => B.pageOfLine.get(id).name[lang]).filter((v, i, a) => a.indexOf(v) === i).join(pick(lang, '、', ', ', '・')) : `${sys.name[lang]} ${pick(lang, '路線圖', 'route map', '路線図')}`;
    return `<figure class="metro-figure"><figcaption>${esc(caption)}</figcaption>${r.svg}${legend}${symbols}${note}</figure>`;
  }).join('');
}

function lineIndexItem(lang, page, withSys) {
  const sys = SYS[page.sysId];
  const meta = [withSys ? sys.name[lang] : '', termText(lang, page), pick(lang, `${page.stationCount} 站`, `${page.stationCount} stations`, `${page.stationCount}駅`), spanText(lang, page)].filter(Boolean).join(' · ');
  return `<li><span class="line-swatch" style="background:${page.color}" aria-hidden="true"></span><div class="line-main"><div class="line-title"><a href="${lineHref(lang, page)}">${esc(page.name[lang])}</a></div><div class="line-meta">${esc(meta)}</div></div></li>`;
}

function systemTransferRows(lang, sys) {
  const rows = new Map();
  for (const page of sys.pages) for (const r of allRows(page)) {
    let e = rows.get(r.zh);
    if (!e) { e = { row: r, lines: new Map(), ext: new Map() }; rows.set(r.zh, e); }
    if (!e.lines.has(page.slug)) e.lines.set(page.slug, { page, code: r.code });
    for (const t of transfersOf(M, B, page, r)) {
      if (t.kind === 'metro') {
        if (t.page.sysId === sys.id) { if (!e.lines.has(t.page.slug)) e.lines.set(t.page.slug, { page: t.page, code: t.code }); } else e.ext.set(`m:${t.page.slug}`, t);
      } else e.ext.set(t.kind, t);
    }
  }
  return [...rows.values()].filter(e => e.lines.size > 1 || e.ext.size > 0);
}

function systemTransferSection(lang, sys) {
  const rows = systemTransferRows(lang, sys);
  if (!rows.length) return '';
  const body = rows.map(e => {
    const parts = [...e.lines.values()].map(l => ({ head: `<a href="${lineHref(lang, l.page)}">${esc(l.page.name[lang])}</a>`, code: l.code }));
    for (const t of [...e.ext.values()].sort((a, b) => (a.kind === 'metro' ? a.page.order : a.kind === 'tra' ? 100 : 101) - (b.kind === 'metro' ? b.page.order : b.kind === 'tra' ? 100 : 101))) {
      if (t.kind === 'metro') parts.push({ head: `<a href="${lineHref(lang, t.page)}">${esc(lineName(lang, t.page, sys.id))}</a>`, code: t.code });
      else parts.push({ head: esc(t.kind === 'tra' ? pick(lang, '台鐵', 'Taiwan Railway (TRA)', '台鉄（TRA）') : pick(lang, '高鐵', 'Taiwan High Speed Rail', '台湾高速鉄道')) });
    }
    return `<tr><th scope="row">${esc(dn(lang, e.row))}</th><td>${joinXfer(lang, parts)}</td></tr>`;
  }).join('');
  const head = pick(lang, ['車站', '可轉乘'], ['Station', 'Connects to'], ['駅', '乗り換え先']).map(t => `<th scope="col">${esc(t)}</th>`).join('');
  return section('transfers', pick(lang, `${sys.name.zh}的轉乘站`, `${sys.name.en} transfer stations`, `${sys.name.ja}の乗り換え駅`),
    `<p class="section-intro">${esc(pick(lang,
      `可換乘同系統的其他路線，或台鐵、高鐵與其他捷運系統的車站。轉乘依站名相同且距離小於 ${M.transfers.criteria.maxDistanceM} 公尺判讀。`,
      `Stations where you can change to another line of the same system, Taiwan Railway (TRA), High Speed Rail or another metro system. A transfer means the same station name within ${M.transfers.criteria.maxDistanceM} m.`,
      `同じシステムの別路線、台鉄、台湾高速鉄道、ほかのメトロに乗り換えられる駅です。乗り換えは、同じ駅名で距離が${M.transfers.criteria.maxDistanceM}m未満のものを示します。`))}</p><div class="table-wrap"><table class="xfer-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
}

function buildSystemPage(lang, sys) {
  const pathname = sysHref(lang, sys.id);
  const alts = { zh: sysHref('zh', sys.id), en: sysHref('en', sys.id), ja: sysHref('ja', sys.id) };
  const title = sys.title[lang];
  const lineCount = sys.pages.length;
  const realLines = sys.pages.some(p => !p.estimated);
  const what = realLines ? pick(lang, '首末班車', 'first and last trains', '始発・終電') : pick(lang, '營運時間', 'operating hours', '運行時間');
  const names = sys.pages.map(p => p.name[lang]);
  const description = pick(lang,
    `${sys.name.zh}路線圖：${list(lang, names)}，共 ${lineCount} 條路線、${sys.stationCount} 站。附各線站序、轉乘站與${what}，可在軌島地圖上看列車。`,
    `${sys.name.en} map: ${list(lang, names)} — ${lineCount} ${lineCount === 1 ? 'line' : 'lines'} and ${sys.stationCount} stations, with stop order, transfers and ${what} for each line, plus a link to the trains on Rail Island's live map.`,
    `${sys.name.ja}の路線図：${list(lang, names)}の${lineCount}路線・${sys.stationCount}駅。各路線の停車駅順、乗り換え、${what}をまとめ、軌島のライブ地図で列車を見られます。`);
  const lede = pick(lang,
    `${sys.name.zh}在軌島收錄 ${lineCount} 條路線、${sys.stationCount} 站。下方路線圖依站點座標繪製；點路線名稱可看站序、轉乘站與${what}。`,
    `Rail Island covers ${lineCount} ${lineCount === 1 ? 'line' : 'lines'} and ${sys.stationCount} stations on the ${sys.name.en}. The map below is drawn from station coordinates; open a line for its stop order, transfers and ${what}.`,
    `軌島には${sys.name.ja}の${lineCount}路線・${sys.stationCount}駅を収録しています。下の路線図は駅の座標から描いたものです。路線名を選ぶと、停車駅の順序、乗り換え、${what}を確認できます。`);
  const crumbs = crumbList(lang, 'system', sys);
  const schema = schemaFor(lang, {
    type: 'CollectionPage', title, description, pathname, crumbs,
    extra: { mainEntity: { '@type': 'ItemList', numberOfItems: lineCount, itemListElement: sys.pages.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name[lang], url: absUrl(lineHref(lang, p)) })) } },
  });
  const live = liveHref(lang, sys.bbox);
  const estNames = sys.pages.filter(p => p.estimated).map(p => lineName(lang, p, sys.id));
  const estNote = estNames.length && estNames.length < sys.pages.length
    ? pick(lang, `軌島的資料來源沒有${list(lang, estNames)}的逐班時刻表，頁面只列營運時段與班距。`, `Rail Island's data sources have no train-by-train timetable for ${list(lang, estNames)}, so the page lists only operating hours and headways.`, `軌島のデータソースには${list(lang, estNames)}の列車ごとの時刻表がないため、運行時間帯と運転間隔だけを載せています。`)
    : '';
  const content = [
    section('map', pick(lang, `${sys.name.zh}路線圖`, `${sys.name.en} route map`, `${sys.name.ja} 路線図`), systemMapFigures(lang, sys)),
    section('lines', pick(lang, `${sys.name.zh}的路線與車站`, `Lines and stations of ${sys.name.en}`, `${sys.name.ja}の路線と駅`), `<ul class="line-index">${sys.pages.map(p => lineIndexItem(lang, p, false)).join('')}</ul>${estNote ? `<p class="table-note">${esc(estNote)}</p>` : ''}`),
    systemTransferSection(lang, sys),
    section('live', pick(lang, '在地圖上看即時列車', 'See the trains on the live map', 'ライブ地図で列車を見る'), `<div class="answer-box">${systemRunHtml(lang, sys)}</div><p>${liveButton(lang, live)}</p>`),
    section('related', pick(lang, '其他捷運系統', 'Other metro systems', 'ほかのメトロ'), `<ul class="sibling-links">${SYSTEMS.filter(s => s.id !== sys.id).map(s => `<li><a href="${sysHref(lang, s.id)}">${esc(s.name[lang])}</a></li>`).join('')}<li><a href="${ovHref(lang)}">${esc(pick(lang, '捷運路線圖總覽', 'All metro maps', 'メトロ路線図の一覧'))}</a></li></ul>`),
    section('source', pick(lang, '資料來源與更新', 'Data sources and updates', 'データの出典と更新'), `<div class="answer-box"><p>${systemSourceText(lang, sys)}</p><p class="source-note">${esc(pick(lang, `頁面產生日期：${M.date}。`, `Page generated on ${M.date}.`, `ページ生成日：${M.date}。`))}</p></div><div class="notice"><strong>${esc(pick(lang, '提醒：', 'Note: ', 'ご注意：'))}</strong>${esc(noticeText(lang))}</div>`),
  ].filter(Boolean).join('\n    ');
  return { pathname, html: pageDocument(lang, { title, description, pathname, alts, schema, crumbs, eyebrow: `${sys.name.en.toUpperCase()} · SYSTEM MAP`, h1: pick(lang, `${sys.name.zh}路線圖`, `${sys.name.en} Map`, `${sys.name.ja} 路線図`), lede, actions: `${liveButton(lang, live)}<a class="button secondary" href="${ovHref(lang)}">${esc(pick(lang, '捷運路線圖總覽', 'All metro maps', 'メトロ路線図の一覧'))}</a>`, content }) };
}

// 系統頁的「地圖上怎麼跑」：台北捷運整個系統一種說法（推估線另補一句備援時刻表的來源）；其他單一路線的系統直接用該線的說法；
// 多線系統先寫通則，再逐條補上例外（推估線、有逐車 GPS 的線）
function systemRunHtml(lang, sys) {
  if (sys.id === 'taipei') {
    const est = sys.pages.filter(p => p.estimated).map(p => p.name[lang]);
    return `<p>${esc(pick(lang,
      `台北捷運各線的列車位置與車站倒數來自官方逐班即時資料；沒有即時資料時，才改依時刻表推演${est.length ? `，其中${list(lang, est)}的時刻表是依官方班距推估的` : ''}。`,
      `On all Taipei MRT lines, train positions and station countdowns come from official train-by-train live data; only when there is no live data does Rail Island fall back to the timetable${est.length ? `, and the ${list(lang, est)} timetable is estimated from official headways` : ''}.`,
      `台北MRTの各線は、列車位置と駅のカウントダウンが公式の列車ごとのリアルタイムデータにもとづきます。リアルタイムデータがないときだけ時刻表にもとづいて表示します${est.length ? `。${list(lang, est)}の時刻表は公式の運転間隔からの推定です` : ''}。`))}</p>`;
  }
  if (sys.pages.length === 1) return `<p>${esc(runNote(lang, sys.pages[0]))}</p>`;
  const out = [];
  if (sys.pages.some(p => !p.estimated && !p.dataLineIds.includes('C'))) out.push(runNote(lang, null));
  for (const p of sys.pages) if (p.estimated || p.dataLineIds.includes('C')) out.push(`${p.name[lang]}${pick(lang, '：', ': ', '：')}${runNote(lang, p)}`);
  return out.map(t => `<p>${esc(t)}</p>`).join('');
}

function systemSourceText(lang, sys) {
  const dates = [...new Set(sys.pages.map(p => fetchInfo(p).timesDate).filter(Boolean))].sort();
  const d = dates.length ? dates.join(pick(lang, '、', ', ', '・')) : '';
  return pick(lang,
    `路線、站序與站間資料來自交通部 TDX 運輸資料流通服務與 OpenStreetMap 貢獻者（詳見<a href="/data-sources/">資料來源</a>）。${sys.estimatedOnly ? '軌島的資料來源沒有這個系統的逐班時刻表，營運時段取自資料，班次依官方班距推估。' : '首末班車與班距依本站收錄的逐站時刻表計算。'}${d ? `時刻表資料抓取日：${d}。` : ''}`,
    `Routes, stop order and running times come from Taiwan's Ministry of Transportation TDX open data and OpenStreetMap contributors (see <a href="/data-sources/" hreflang="zh-Hant">Data sources</a>, Traditional Chinese). ${sys.estimatedOnly ? 'Rail Island\'s data sources have no train-by-train timetable for this system: the operating hours come from the data and the services are estimated from official headways.' : 'First and last trains and headways are calculated from the station-by-station timetable used on this site.'}${d ? ` Timetable data fetched on ${d}.` : ''}`,
    `路線、停車駅の順序、駅間データは交通部TDXの運輸データとOpenStreetMap貢献者のデータにもとづきます（<a href="/data-sources/" hreflang="zh-Hant">データの出典</a>・繁体字中国語）。${sys.estimatedOnly ? '軌島のデータソースにはこのシステムの列車ごとの時刻表がなく、運行時間帯はデータから、運行本数は公式の運転間隔からの推定です。' : '始発・終電と運転間隔は、このサイトで使っている駅別時刻表から計算しています。'}${d ? `時刻表データの取得日：${d}。` : ''}`);
}

// ── 總覽頁 ───────────────────────────────────────────────────────────────────────────
function buildOverviewPage(lang) {
  const pathname = ovHref(lang);
  const alts = { zh: ovHref('zh'), en: ovHref('en'), ja: ovHref('ja') };
  const lineCount = B.pages.length;
  const sysCount = B.systems.length;
  const title = pick(lang,
    '台灣捷運路線圖：台北、桃園、新北、台中、高雄｜軌島',
    'Taiwan Metro Maps: Taipei, Taoyuan, New Taipei, Taichung & Kaohsiung MRT | Rail Island',
    '台湾MRT 路線図｜台北・桃園・新北・台中・高雄｜軌島');
  const description = pick(lang,
    `軌島整理台北、桃園、新北、台中、高雄共 ${sysCount} 個捷運與輕軌系統、${lineCount} 條路線的路線圖、車站順序、轉乘站、首末班車與班距，並可在軌島地圖上看列車。`,
    `Line maps, stop order, transfers, first and last trains and headways for ${lineCount} lines in ${sysCount} metro and light rail systems: Taipei MRT, Taoyuan Airport MRT, New Taipei Metro, Taichung MRT and Kaohsiung MRT — with a link to the trains on Rail Island's live map.`,
    `台北MRT、桃園空港MRT、新北メトロ、台中MRT、高雄MRTの${sysCount}システム・${lineCount}路線について、路線図、停車駅の順序、乗り換え、始発・終電、運転間隔をまとめました。軌島のライブ地図で列車も見られます。`);
  const lede = pick(lang,
    '台北、桃園、新北、台中、高雄的捷運與輕軌，路線圖、車站順序、轉乘站、首末班車與班距一次查。每一頁的內容都由軌島的路線與時刻表資料產生，並可一鍵在地圖上看列車。',
    'Line maps, stop order, transfers, first and last trains and headways for the metro and light rail of Taipei, Taoyuan, New Taipei, Taichung and Kaohsiung. Every page is generated from the same route and timetable data that drives the Rail Island map, and each one links to the trains on the live map.',
    '台北・桃園・新北・台中・高雄のメトロとライトレールについて、路線図、停車駅の順序、乗り換え駅、始発・終電、運転間隔をまとめて確認できます。各ページは軌島の地図と同じ路線・時刻表データから生成され、ワンタップでライブ地図の列車に移動できます。');
  const crumbs = crumbList(lang, 'overview');
  const schema = schemaFor(lang, {
    type: 'CollectionPage', title, description, pathname, crumbs,
    extra: { mainEntity: { '@type': 'ItemList', numberOfItems: sysCount, itemListElement: B.systems.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.name[lang], url: absUrl(sysHref(lang, s.id)) })) } },
  });
  const estNames = B.pages.filter(p => p.estimated).map(p => lineName(lang, p));
  const cards = B.systems.map(s => `<article class="card"><h3><a href="${sysHref(lang, s.id)}">${esc(s.name[lang])}</a></h3><p>${esc(pick(lang, `${s.pages.length} 條路線、${s.stationCount} 站：${list(lang, s.pages.map(p => p.name[lang]))}`, `${s.pages.length} ${s.pages.length === 1 ? 'line' : 'lines'}, ${s.stationCount} stations: ${list(lang, s.pages.map(p => p.name[lang]))}`, `${s.pages.length}路線・${s.stationCount}駅：${list(lang, s.pages.map(p => p.name[lang]))}`))}</p><a class="card-link" href="${sysHref(lang, s.id)}">${esc(pick(lang, `看${s.name.zh}路線圖 →`, `${s.name.en} map →`, `${s.name.ja} 路線図 →`))}</a></article>`).join('');
  const notes = `<div class="answer-box"><p>${esc(pick(lang,
    `站名、站序與座標來自交通部 TDX 與 OpenStreetMap。軌島的資料來源沒有${list(lang, estNames)}的逐班時刻表，這些頁面只列營運時段與班距；其餘路線的首末班車與班距，由各系統公開的逐站時刻表計算。`,
    `Routes, stop order and station positions come from Taiwan's Ministry of Transportation TDX open data and OpenStreetMap. Rail Island's data sources have no train-by-train timetable for ${list(lang, estNames)}, so those pages list only operating hours and headways; for every other line, first and last trains and headways are calculated from each system's published station-by-station timetable.`,
    `路線、停車駅の順序、駅の位置は交通部TDXのオープンデータとOpenStreetMapにもとづきます。軌島のデータソースには${list(lang, estNames)}の列車ごとの時刻表がないため、これらのページは運行時間帯と運転間隔だけを載せています。そのほかの路線の始発・終電と運転間隔は、各システムが公開している駅別時刻表から計算しています。`))}</p><p>${esc(overviewRunNote(lang))}</p><p class="source-note">${esc(pick(lang, `頁面產生日期：${M.date}。`, `Page generated on ${M.date}.`, `ページ生成日：${M.date}。`))}</p></div><div class="notice"><strong>${esc(pick(lang, '提醒：', 'Note: ', 'ご注意：'))}</strong>${esc(noticeText(lang))}</div>`;
  const content = [
    section('systems', pick(lang, '選擇城市或系統', 'Choose a city or system', '都市・システムを選ぶ'), `<div class="card-grid system-cards">${cards}</div>`),
    section('lines', pick(lang, '所有捷運與輕軌路線', 'All metro and light rail lines', 'すべてのメトロ・ライトレール路線'), `<ul class="line-index">${B.pages.map(p => lineIndexItem(lang, p, true)).join('')}</ul>`),
    section('notes', pick(lang, '這些頁面的資料與限制', 'About the data on these pages', 'これらのページのデータと限界'), notes),
  ].join('\n    ');
  return { pathname, html: pageDocument(lang, { title, description, pathname, alts, schema, crumbs, eyebrow: 'TAIWAN METRO MAPS', h1: pick(lang, '台灣捷運路線圖', 'Taiwan Metro Maps', '台湾MRT 路線図'), lede, actions: liveButton(lang, liveAll(lang)), content }) };
}

// ── 對外入口 ─────────────────────────────────────────────────────────────────────────
// 回傳所有頁面內容（不寫檔；寫檔與 --check 在 build_aeo_pages.mjs）。
export function buildMetroPages(root, { stationPages = [], zhShell, escapeHtml } = {}) {
  if (escapeHtml) esc = escapeHtml;
  ZH_SHELL = zhShell;
  M = loadMetroModel(root, stationPages);
  B = buildPages(M);
  const files = new Map();
  const paths = [];
  const add = (lang, built) => {
    const rel = built.pathname.replace(/^\//, '') + 'index.html';
    files.set(rel, built.html);
    paths.push(built.pathname);
  };
  for (const lang of LANGS) {
    add(lang, buildOverviewPage(lang));
    for (const sys of B.systems) add(lang, buildSystemPage(lang, sys));
    for (const page of B.pages) add(lang, buildLinePage(lang, page));
  }
  const counts = { overview: LANGS.length, systems: LANGS.length * B.systems.length, lines: LANGS.length * B.pages.length };
  return {
    files, paths, date: M.date, templateDate: METRO_TEMPLATE_DATE, counts,
    missingNames: [...M.missingNames].sort(),
    overviewHref: ovHref,
    // 給 /about/、/stations/、/en/、/ja/ 的入口區塊用
    linkSectionText: {
      zh: { h: '捷運路線圖', text: '台北、桃園、新北、台中、高雄的捷運與輕軌路線圖、車站順序、轉乘站、首末班車與班距，全部由軌島的路線與時刻表資料整理，並可一鍵在地圖上看列車。', link: '看台灣捷運路線圖' },
      en: { h: 'Metro maps', text: 'Line maps, stop order, transfers, first and last trains and headways for the metro and light rail of Taipei, Taoyuan, New Taipei, Taichung and Kaohsiung, generated from the same data as the Rail Island map.', link: 'Taiwan metro maps' },
      ja: { h: 'メトロ路線図', text: '台北・桃園・新北・台中・高雄のメトロとライトレールについて、路線図、停車駅の順序、乗り換え、始発・終電、運転間隔を、軌島の地図と同じデータからまとめています。', link: '台湾MRT 路線図を見る' },
    },
  };
}
