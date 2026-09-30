#!/usr/bin/env node
// 驗「車站收集」桌面小工具的網頁端 payload（資料格式 v1，契約在
// docs/collect-widget-contract.md）。
//
// 使用者裁示：小工具的「已收集 N 座」必須跟護照的「車站 N 座」是同一個數字（跟完／搭過／到訪都算）。
// 所以判準的重心是 N ＝ 頁面上真的在跑的 stationCollection(loadRides()).size；其餘欄位（分母、各系統數、
// 最近蓋章、點陣）用「Node 端獨立重算」對照——重算只讀 localStorage 傾印＋geojson 原檔，不呼叫頁面的任何實作，
// 免得判準與受測物同源。
//
// 用法：node scripts/verify_collect_widget_payload.mjs [驗哪個目錄，預設＝這個 repo 根目錄]
//   ENGINE=chromium|webkit（預設 chromium，無視窗）；PAYLOAD_OUT=檔案路徑 → 把一包真實 fixture 的 payload 存下來。
//   突變測試把 index.html 複製到別處改，再用第一個參數指過去（見 tmp/collect-widget/run-mutations.mjs）。
//
// 判準對應：
//   G0  第一道 gate：印出目標路徑＋index.html md5，並確認伺服器吐的就是那份
//   J   空收集：total＝geojson 獨立重算（09-29 為 538；09-30 台北與台中的市政府分開算後為 539）、n＝0、recent 空、點全灰
//   A   開機推送：欄位名稱／型別逐欄符合契約；n＝護照函式；total／各系統 v／n／recent（每系統各取最近 4 筆，
//       合併後整體再排序）／點陣與獨立重算一致；fixture 有系統超過 4 筆候選、有多個系統各有紀錄（具名前提斷言）
//   B   完乘寫入（saveRides）→ 3 秒內新一包；follow→s=1
//   C   打卡寫入（writeCheckin，含捷運同名併鍵）→ 3 秒內新一包
//   D   rail-user-data-changed（帳號同步合併）→ 3 秒內新一包
//   E   切換語言（en／ja／zh-TW）→ 各 3 秒內新一包，label／lang 隨語言
//   F   內容沒變不重送（事件重發、saveRides 同內容）
//   G   userDataRenderAll（登出／換帳號的落點）→ 3 秒內新一包
//   H   純網站（沒有 bridge）：零 geojson 請求、不註冊 listener、不留 schedule；對照 App 形態確實請求且多註冊 1 個
//   I   開機落在捷運群組（state.schedStations 是 []）：total 仍＝清單座數，別名站不會多出來
//   K   資料一致性：清單去別名後，台鐵站名全都在班表站名裡（別名表沒漏、沒錯）；K4 跨系統同名的捷運站裡只有「市政府」
//       實體相距很遠（分開算的表剛好涵蓋它），total 因此比舊規則多 1
//   M   recent 每系統各取 4 筆（第二輪第 2 點）：專屬 fixture＝九個系統各有紀錄、兩個系統候選超過 4 筆、
//       邊界同日（以 n 決勝）與同日同 n（以收集鍵字典序決勝）；literal 手算對照＋獨立重算
//   R   轉乘站（同一把收集鍵出現在兩個以上系統的清單）的最近蓋章：recent[] 送 ks（固定順序、含 k、第一個是歸屬 k），每個系統的前 4 筆看成員資格；
//       專屬 fixture＝北捷／三鶯專屬站占滿名額、四座真實轉乘鍵較舊，期望值手寫（ks 內容與順序、專屬站沒有 ks、淡海只有轉乘站紀錄也選得到、兩邊都落選的頂埔不出現）
//   S   台北與台中的「市政府」各算一枚：只蓋台北／只蓋台中／兩座都蓋／只有舊資料（沒記錄城市，歸台北）四種情境，各在
//       全台同框（裝飾層附近清單＋桌面護照）與捷運分頁（單捷運附近清單＋旅程護照面板）跑；蓋章走真實的附近清單點鈕，
//       護照 N 讀畫面文字、鍵讀 localStorage 逐字、期望值手算；另含帳號同步的真實合併路徑（不重組鍵）
//   T   清單不隨分頁變：T1 全／台／高／捷四個分頁各開機一次，清單裡每座站都蓋滿 → 每個分頁都收滿（n＝total＝清單座數、各系統
//       v＝n、點全亮）且小工具內容逐字相同；T2 台鐵分頁蓋左營 → 切到高鐵分頁，total／台鐵那一列／左營那顆點都不變
//   P   護照深連結（第二輪第 6 點）：waitOpen 收到 {view:'passport'} → #ridePanel（旅程護照）真的在畫面上、看得見、
//       沒被蓋住；對照 {view:'pass'} 仍開通行證面板（#plusModal）而不是護照；桌面 1280 與手機 375 各跑一次，
//       含「原生冷啟動時事件在 listener 掛上瞬間就進來」與「別的面板開著／護照已開著」兩種狀態
//   V   切到背景時補送：有排程中的推送時 visibilitychange→hidden、pagehide → 1 秒內送出、內容是新的（不等 2 秒去抖）；
//       沒有排程（排程已走完、補送過後）→ 不送，且內容其實有變（證明不是「內容沒變」才沒送）；變回 visible 不補送
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..'));
const ENGINE = (process.env.ENGINE || 'chromium').toLowerCase();
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p: !!p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const md5 = buf => createHash('md5').update(buf).digest('hex');

// ── G0：驗哪個目錄 ─────────────────────────────────────────────────────────
console.log(`[G0] ROOT=${ROOT}`);
if (!existsSync(path.join(ROOT, 'index.html'))) { console.log('目標目錄沒有 index.html，停手'); process.exit(1); }
const DISK_MD5 = md5(readFileSync(path.join(ROOT, 'index.html')));
console.log(`[G0] index.html md5=${DISK_MD5}`);
console.log(`[G0] track_stations.geojson md5=${md5(readFileSync(path.join(ROOT, 'data/track_stations.geojson')))}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.bin': 'application/octet-stream' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
const BASE = `http://127.0.0.1:${server.address().port}/`;
{
  const served = md5(Buffer.from(await (await fetch(BASE + 'index.html')).arrayBuffer()));
  ok('G0 伺服器吐的 index.html ＝ 目標目錄那份', served === DISK_MD5, `${served.slice(0, 8)} vs ${DISK_MD5.slice(0, 8)}`);
  if (served !== DISK_MD5) { console.log('\n驗錯目標，停手'); process.exit(1); }
}

// ── 獨立於頁面的資料來源（Node 端直接讀檔）──────────────────────────────────
const readJson = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const GEO = readJson('data/track_stations.geojson');
const LINES = new Map(readJson('data/track_lines.geojson').features.map(f => [`${f.properties.sys}|${f.properties.id}`, f.properties.name]));
const CATALOG = readJson('i18n/stations.json');
const MESSAGES = (() => {
  const box = { window: {} }; vm.createContext(box);
  for (const f of ['translations.js', 'content-translations.js']) vm.runInContext(readFileSync(path.join(ROOT, 'i18n', f), 'utf8'), box);
  return box.window.RAIL_I18N_MESSAGES || {};
})();
const ORDER = ['tra', 'thsr', 'trtc', 'tymc', 'tmrt', 'krtc', 'ntdlrt', 'ntalrt', 'sanying', 'afr'];
const GEO_OF = { tra: 'tra_sched', thsr: 'thsr_sched', trtc: 'mrt', tymc: 'tymc', tmrt: 'tmrt', krtc: 'krtc', ntdlrt: 'ntdlrt', ntalrt: 'ntalrt', sanying: 'sanying', afr: 'afr_sched' };
const CK_OF = k => (k === 'tra' ? 'tra_sched' : k === 'thsr' ? 'thsr_sched' : k === 'afr' ? 'afr_sched' : 'metro');
const K_OF_GEO = Object.fromEntries(Object.entries(GEO_OF).map(([k, g]) => [g, k]));
const LABEL = {
  'zh-TW': ['台鐵', '高鐵', '北捷', '機捷', '中捷', '高捷', '淡海', '安坑', '三鶯', '林鐵'],
  en: ['TRA', 'THSR', 'Taipei', 'Airport', 'Taichung', 'Kaohsiung', 'Danhai', 'Ankeng', 'Sanying', 'Alishan'],
  ja: ['台鉄', '高鉄', '台北', '空港', '台中', '高雄', '淡海', '安坑', '三鶯', '阿里山'],
};
// 清單站名 → 收集鍵站名：geojson 是舊名（左營(舊城)、新城 (太魯閣)），收集層存班表正名；台北一族一律併成臺北。
const TRA_ALIAS = { '左營(舊城)': '左營', '新城 (太魯閣)': '新城' };
const normName = (ck, n) => ck !== 'tra_sched' ? n
  : (/^台北(?:[-－—]?環島)?$/.test(String(n).replace(/臺/g, '台').replace(/\s/g, '')) ? '臺北' : (TRA_ALIAS[n] || n));
const STATUS_S = { follow: 1, pass: 2, visit: 2 };
const RANK = { follow: 0, pass: 1, visit: 2 };
// 收集鍵的系統段：捷運一律 'metro'；唯一例外是「站名相同、實體是兩座」的站——台北與台中各有一座「市政府」，
// 台中另立自己的系統段（'tmrt|市政府'），台北維持 metro|市政府，沒記錄城市的舊資料也歸台北。
// 這張表是 gate 自己的一份（key＝geojson 的 sys|清單站名），與頁面的 COLLECT_SPLIT 各自獨立；K4 用 geojson 座標
// 證明它剛好涵蓋「跨系統同名而且實體相距很遠」的站，不多不少（將來多出第二組同名站，K4 會紅、逼人做決定，不會無聲併掉）。
const SPLIT_GEO = new Set(['tmrt|市政府']);

// 獨立重算 stationCollection：只吃 localStorage 傾印（rides＋checkins）
function oracleColl(rides, checkins) {
  const m = new Map();
  const at = (sys0, name0) => {
    const sys = sys0 || 'tra_sched', name = normName(sys, name0), k = sys + '|' + name;
    if (!m.has(k)) m.set(k, { name, sys, s: 'follow', n: 0, d: '' });
    return m.get(k);
  };
  for (const r of rides) for (const nm of [r.from, r.to]) {
    if (!nm) continue;
    const c = at(r.sys, nm); c.n++; if (r.date && r.date > c.d) c.d = r.date;
  }
  for (const e of Object.values((checkins && checkins.st) || {})) {
    if (!e || !e.name) continue;
    const c = at(e.sys, e.name), s = RANK[e.s] != null ? e.s : 'visit';
    if (RANK[s] > RANK[c.s]) c.s = s;
    c.n += Math.max(1, Number(e.n) || 1);
    if (e.d && e.d > c.d) c.d = e.d;
  }
  return m;
}
const catRow = (sysId, name) => {
  const rows = CATALOG.systems[sysId] || {}, nn = s => String(s).trim().replace(/[台臺]/g, '臺');
  return rows[name] || Object.entries(rows).find(([n]) => nn(n) === nn(name))?.[1];
};
const foreign = v => String(v || '').replace(/_([^_]+)/g, ' ($1)').replace(/\s{2,}/g, ' ');
const stripParen = s => String(s || '').replace(/（[^（）]*）\s*$/, '').trim();

function expectPayload(coll, lang, split = SPLIT_GEO) {
  const per = ORDER.map(() => new Map());
  for (const f of GEO.features) {
    const k = K_OF_GEO[f.properties.sys]; if (!k) continue;
    const i = ORDER.indexOf(k), ck = CK_OF(k), nm = normName(ck, f.properties.name);
    const key = (split.has(f.properties.sys + '|' + nm) ? f.properties.sys : ck) + '|' + nm;
    if (per[i].has(key)) continue;
    const [lon, lat] = f.geometry.coordinates;
    per[i].set(key, { name: normName(ck, f.properties.name), x: Math.round((lon - 120.15) / (122.0 - 120.15) * 1000), y: Math.round((25.27 - lat) / (25.27 - 22.2) * 1000), color: f.properties.color, lineId: f.properties.lineId });
  }
  const sys = ORDER.map((k, i) => ({ k, label: LABEL[lang][i], v: [...per[i].keys()].filter(x => coll.has(x)).length, n: per[i].size })).filter(s => s.n);
  const pts = [];
  ORDER.forEach((k, i) => { if (!per[i].size) return; per[i].forEach((pt, key) => pts.push([pt.x, pt.y, pt.color, STATUS_S[(coll.get(key) || {}).s] || 0, sys.findIndex(s => s.k === k)])); });
  const all = new Set([...per.flatMap(m => [...m.keys()]), ...coll.keys()]);
  // recent（第二輪語意）：每個系統各取最近 4 筆，合併後整體再依同一規則排序。
  // 排序：d 新到舊、同日 n 大到小、再依收集鍵字典序。系統歸屬：清單裡第一個有這把鍵的系統；清單外的站退到同鍵系統的第一個。
  const cmp = (a, b) => (a.e[1].d < b.e[1].d ? 1 : a.e[1].d > b.e[1].d ? -1 : 0) || b.e[1].n - a.e[1].n || (a.e[0] < b.e[0] ? -1 : a.e[0] > b.e[0] ? 1 : 0);
  // 轉乘站（同一把鍵出現在兩個以上系統的清單）：歸屬 k 是第一個系統，另送 ks＝全部所屬系統（固定順序、含 k）；
  // 每個系統的最近 4 筆看「成員資格」（轉乘站算進它所屬的每個系統），合併後同一筆只留一次，整體再排序。清單外的站只屬於退路系統。
  const members = key => ORDER.filter((o, x) => per[x].has(key));
  const cand = [...coll.entries()].filter(([, v]) => v.d).map(e => {
    const mem = members(e[0]), i = mem.length ? ORDER.indexOf(mem[0]) : -1;
    return { e, i, mem, k: i >= 0 ? ORDER[i] : ORDER.find(o => CK_OF(o) === e[1].sys || GEO_OF[o] === e[1].sys) || 'tra' };
  });
  const recentCand = {};
  for (const k of ORDER) { const c = cand.filter(x => x.k === k).length; if (c) recentCand[k] = c; }
  const inGroup = (x, k) => (x.mem.length ? x.mem.includes(k) : x.k === k);
  const picked = new Set(ORDER.flatMap(k => cand.filter(x => inGroup(x, k)).sort(cmp).slice(0, 4)));
  const recent = [...picked].sort(cmp).map(({ e: [key, v], i, k, mem }) => {
    const hit = i >= 0 ? per[i].get(key) : null;
    const geoSys = GEO_OF[k];
    let line = LABEL[lang][ORDER.indexOf(k)];
    if (hit) {
      const base = stripParen(LINES.get(`${geoSys}|${hit.lineId}`));
      if (base) line = lang === 'zh-TW' ? base : ((CATALOG.routes[geoSys] || {})[base]?.[lang] ? foreign(CATALOG.routes[geoSys][base][lang]) : (MESSAGES[lang]?.[base] ?? base));
    }
    const row = hit ? catRow(geoSys, v.name) : null;
    const o = { name: lang === 'zh-TW' || !row || !row[lang] ? v.name : foreign(row[lang]), line, k };
    if (mem.length > 1) o.ks = mem;
    o.d = v.d;
    return o;
  });
  return { n: coll.size, total: all.size, sys, pts, recent, recentCand, members, listSizes: Object.fromEntries(ORDER.map((k, i) => [k, per[i].size])), listKeys: new Set(per.flatMap(m => [...m.keys()])) };
}

// ── 契約逐欄檢查（欄位名稱與型別）────────────────────────────────────────────
function schemaProblems(p, lang) {
  const bad = [];
  const keys = o => Object.keys(o).sort().join(',');
  const isInt = x => Number.isInteger(x);
  if (keys(p) !== 'aspect,at,box,lang,n,pts,recent,sys,total,v') bad.push(`頂層欄位 ${keys(p)}`);
  if (p.v !== 1) bad.push('v!==1');
  if (!isInt(p.at) || p.at <= 0) bad.push('at 不是正整數');
  if (p.lang !== lang) bad.push(`lang=${p.lang} 期望 ${lang}`);
  if (JSON.stringify(p.box) !== '[120.15,22.2,122,25.27]') bad.push('box 不是固定值');
  if (p.aspect !== Math.round((122 - 120.15) * Math.cos((22.2 + 25.27) / 2 * Math.PI / 180) / (25.27 - 22.2) * 1e4) / 1e4) bad.push(`aspect=${p.aspect}`);
  if (!isInt(p.n) || p.n < 0) bad.push('n');
  if (!isInt(p.total) || p.total < p.n) bad.push('total<n');
  if (!Array.isArray(p.sys) || !p.sys.length) bad.push('sys 不是非空陣列');
  let lastOrd = -1;
  for (const s of p.sys || []) {
    if (keys(s) !== 'k,label,n,v') bad.push(`sys 項欄位 ${keys(s)}`);
    const o = ORDER.indexOf(s.k);
    if (o <= lastOrd) bad.push(`sys 順序錯 ${s.k}`); lastOrd = o;
    if (typeof s.label !== 'string' || !s.label) bad.push(`sys.label ${s.k}`);
    if (!isInt(s.v) || !isInt(s.n) || s.v > s.n) bad.push(`sys v/n ${s.k}`);
  }
  if (!Array.isArray(p.recent)) bad.push('recent 不是陣列');
  else {
    const per = {}; for (const r of p.recent) if (!('ks' in r)) per[r.k] = (per[r.k] || 0) + 1; // 只屬一個系統的站：每個系統最多 4 筆（轉乘站可能被另一個系統選進來，不受這個上限）
    if (Object.values(per).some(c => c > 4)) bad.push(`recent 有系統超過 4 筆（不含轉乘站） ${JSON.stringify(per)}`);
    if (p.recent.some((r, i) => i && r.d > p.recent[i - 1].d)) bad.push('recent 沒有依 d 新到舊');
  }
  for (const r of p.recent || []) {
    if (keys(r) !== 'd,k,line,name' && keys(r) !== 'd,k,ks,line,name') bad.push(`recent 項欄位 ${keys(r)}`);
    if ('ks' in r) { // ks（選用）：兩個以上不重複的系統代碼、照 sys 的固定順序、含 k、第一個就是歸屬 k
      const idx = Array.isArray(r.ks) ? r.ks.map(x => (p.sys || []).findIndex(s => s.k === x)) : [];
      if (!Array.isArray(r.ks) || r.ks.length < 2 || idx.some(x => x < 0) || idx.some((x, j) => j && x <= idx[j - 1])) bad.push(`recent.ks 不是「兩個以上、都在 sys、照 sys 順序」：${JSON.stringify(r.ks)}`);
      else if (r.ks[0] !== r.k) bad.push(`recent.ks 第一個不是歸屬 k：${JSON.stringify(r.ks)} k=${r.k}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.d)) bad.push(`recent.d ${r.d}`);
    if (!p.sys.some(s => s.k === r.k)) bad.push(`recent.k ${r.k}`);
    if (typeof r.name !== 'string' || !r.name) bad.push('recent.name 空');
    if (typeof r.line !== 'string' || !r.line || /^[A-Z][A-Z0-9_]*$/.test(r.line)) bad.push(`recent.line 是代碼或空：${r.line}`);
  }
  if (!Array.isArray(p.pts)) bad.push('pts 不是陣列');
  for (const pt of p.pts || []) {
    if (!Array.isArray(pt) || pt.length !== 5) { bad.push('pts 項長度≠5'); break; }
    const [x, y, c, s, si] = pt;
    if (!isInt(x) || x < 0 || x > 1000 || !isInt(y) || y < 0 || y > 1000) { bad.push(`pts 座標 ${pt}`); break; }
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) { bad.push(`pts 色 ${pt}`); break; }
    if (![0, 1, 2].includes(s)) { bad.push(`pts.s ${pt}`); break; }
    if (!isInt(si) || si < 0 || si >= p.sys.length) { bad.push(`pts.sysIdx ${pt}`); break; }
  }
  if (p.pts && p.sys && p.pts.length !== p.sys.reduce((a, s) => a + s.n, 0)) bad.push('pts 數量≠各系統 n 加總');
  return bad;
}

// ── 瀏覽器端 ──────────────────────────────────────────────────────────────
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true });
const pageErrors = [];
// mw：接一個 RailMetroWait 外掛替身（原生把 railisland://… 轉成 waitOpen 事件走的就是這條）；
// mwCold：非 null 時，替身在 addListener('waitOpen') 掛上的瞬間就把這個事件送進來（原生 retainUntilConsumed 的冷啟動行為）。
// mobile：375×812＋isMobile＋hasTouch（專案規定手機驗收不能只縮 viewport）。
// slow：每個 /data/ 請求多等這麼多毫秒（模擬真機冷啟動 boot 要好幾秒；本機 boot 太快，冷啟動閘門不拖慢就量不出來）。
async function open({ bridge, seed = {}, query = '?gltracks=0', tag, mw = false, mwCold = null, mobile = false, slow = 0 }) {
  // locale 固定 zh-TW：App 形態下頁面語言吃 navigator.languages（headless 預設 en-US），不釘住開機語言會是 en
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 375, height: 812 }, locale: 'zh-TW', isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  await ctx.addInitScript(({ bridge, seed, mw, mwCold }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }
    window.__listen = {};
    const add = window.addEventListener.bind(window);
    window.addEventListener = function (type, ...rest) { window.__listen[type] = (window.__listen[type] || 0) + 1; return add(type, ...rest); };
    window.__listenDoc = {};
    const addDoc = document.addEventListener.bind(document);
    document.addEventListener = function (type, ...rest) { window.__listenDoc[type] = (window.__listenDoc[type] || 0) + 1; return addDoc(type, ...rest); };
    window.__pushes = [];
    if (bridge) {
      // App 形態：Capacitor 判定為原生＋桌面小工具橋接（純網站沒有 window.RAIL_NATIVE_COLLECTION）
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      window.RAIL_NATIVE_COLLECTION = { sync(json) { window.__pushes.push({ t: Date.now(), type: typeof json, json }); return Promise.resolve(); } };
    }
    if (mw) {
      window.Capacitor = window.Capacitor || { Plugins: {} };
      window.Capacitor.Plugins = window.Capacitor.Plugins || {};
      const listeners = window.__mwListeners = {};
      window.__mwFire = (name, evt) => (listeners[name] || []).forEach(fn => fn(evt));
      // 記下護照面板「第一次被打開」那一刻 boot 完成了沒（冷啟動閘門的可觀察後果：事件比 boot 早到，面板卻不能比 boot 早開）
      window.__rideOpenedWhenReady = null;
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('ridePanel'); if (!el) return;
        new MutationObserver(() => {
          if (window.__rideOpenedWhenReady === null && !el.hidden) window.__rideOpenedWhenReady = (() => { try { return state.ready === true; } catch (e) { return false; } })();
        }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      });
      window.Capacitor.Plugins.RailMetroWait = {
        start: async () => ({ ok: true }), stop: async () => ({ ok: true }), status: async () => ({ active: false }), setPlus: async () => ({}),
        addListener: (name, fn) => {
          (listeners[name] = listeners[name] || []).push(fn);
          if (name === 'waitOpen') window.__mwAttachAt = Date.now();
          if (name === 'waitOpen' && mwCold) setTimeout(() => fn(mwCold), 0);
          return { remove() {} };
        },
      };
    }
  }, { bridge, seed, mw, mwCold });
  const page = await ctx.newPage();
  if (slow) await page.route(/\/data\//, async route => { await sleep(slow); try { await route.continue(); } catch (e) {} });
  const geoReqs = [];
  page.on('pageerror', e => pageErrors.push(`[${tag}] ${e}`));
  page.on('request', r => { if (/track_stations\.geojson/.test(r.url())) geoReqs.push(r.url()); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000, polling: 50 });
  return { ctx, page, geoReqs, readyAt: Date.now() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const count = page => page.evaluate(() => window.__pushes.length);
// 等到推送數超過 before；回最新一包（含到達時間）。逾時回 null。
async function waitPush(page, before, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const got = await page.evaluate(b => window.__pushes.length > b ? window.__pushes[window.__pushes.length - 1] : null, before);
    if (got) return { ...got, payload: JSON.parse(got.json), waited: Date.now() - t0 };
    await sleep(60);
  }
  return null;
}
// 觸發＋等新一包＋逐項比對。expect：{ n, listExtra }
async function step(page, id, before, lang, trigger, expectN, note) {
  const t0 = Date.now();
  await trigger();
  const got = await waitPush(page, before, 3000);
  ok(`${id} 觸發後 3 秒內送出新的一包`, !!got, got ? `${Date.now() - t0}ms` : '逾時');
  if (!got) return null;
  ok(`${id} bridge 收到的是字串（契約：json 是字串）`, got.type === 'string');
  got.exp = await checkPayload(page, id, got.payload, lang, expectN, note);
  return got;
}
async function checkPayload(page, id, p, lang, expectN, note = '') {
  const bad = schemaProblems(p, lang);
  ok(`${id} 契約逐欄檢查（欄位名稱／型別／範圍）`, bad.length === 0, bad.slice(0, 4).join('；'));
  const dump = await page.evaluate(() => ({
    checkins: JSON.parse(localStorage.getItem('trainmap-checkins-v1') || 'null'),
    rides: loadRides(),
    pageN: stationCollection(loadRides()).size,
  }));
  ok(`${id} n ＝ 頁面 stationCollection(loadRides()).size（護照同一個函式）`, p.n === dump.pageN, `payload ${p.n} vs 頁面 ${dump.pageN}`);
  if (expectN != null) ok(`${id} n ＝ 手算的 fixture 座數`, p.n === expectN, `payload ${p.n} vs 手算 ${expectN}`);
  const exp = expectPayload(oracleColl(dump.rides, dump.checkins), lang);
  ok(`${id} n ＝ 獨立重算`, p.n === exp.n, `${p.n} vs ${exp.n}`);
  ok(`${id} total ＝ 獨立重算（清單去重 ∪ 清單外已收集）`, p.total === exp.total, `${p.total} vs ${exp.total}`);
  ok(`${id} 各系統 k／label／v／n ＝ 獨立重算`, JSON.stringify(p.sys) === JSON.stringify(exp.sys), JSON.stringify(p.sys) === JSON.stringify(exp.sys) ? '' : `${JSON.stringify(p.sys)}\n     期望 ${JSON.stringify(exp.sys)}`);
  ok(`${id} recent 順序與內容 ＝ 獨立重算（每系統各取 4 筆、合併後 d 新到舊、同日 n 多到少）`, JSON.stringify(p.recent) === JSON.stringify(exp.recent), JSON.stringify(p.recent) === JSON.stringify(exp.recent) ? p.recent.map(r => r.name).join('/') : `${JSON.stringify(p.recent)}\n     期望 ${JSON.stringify(exp.recent)}`);
  ok(`${id} pts 數量與每點 x／y／色／s／sysIdx ＝ 獨立重算`, JSON.stringify(p.pts) === JSON.stringify(exp.pts), `${p.pts.length} 點` + (JSON.stringify(p.pts) === JSON.stringify(exp.pts) ? '' : ` 首個差異 ${p.pts.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(exp.pts[i]))}`));
  const direct = await page.evaluate(() => { const q = collectionWidgetPayload(); if (q) q.at = 0; return q; });
  const pushed = { ...p, at: 0 };
  ok(`${id} 直接呼叫 collectionWidgetPayload() ＝ 剛推送的內容（不含 at）`, JSON.stringify(direct) === JSON.stringify(pushed));
  return exp;
}

// 「每系統各取 4 筆」與「全系統只取 4 筆」要分得出來，fixture 必須真的有這兩種情況——用 Node 端算的候選筆數
//（有蓋章日 d 的收集鍵，依系統歸屬）證明，並與手算的 literal 對照（不然判準是空過）。
const perK = recent => { const c = {}; for (const r of recent) c[r.k] = (c[r.k] || 0) + 1; return c; };
const sameObj = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort()); // 不看鍵的順序
function recentPremise(id, exp, literal, minSys) {
  const cand = exp.recentCand;
  ok(`${id} 前提：有系統的候選超過 4 筆（不然「每系統各取 4 筆」與「全系統取 4 筆」測不出差別）`, Object.values(cand).some(c => c > 4), JSON.stringify(cand));
  ok(`${id} 前提：至少 ${minSys} 個系統各有紀錄（不然「每系統」只是「一個系統」）`, Object.keys(cand).length >= minSys, `${Object.keys(cand).length} 個系統`);
  ok(`${id} 前提：各系統候選筆數 ＝ 手算 ${JSON.stringify(literal)}（獨立重算的系統歸屬沒走偏）`, sameObj(cand, literal), JSON.stringify(cand));
}

// ── fixture ────────────────────────────────────────────────────────────────
const ck = (name, sys, s, n, d) => [`${sys}|${name}`, { name, sys, s, n, d, u: Date.parse(d + 'T00:00:00Z') }];
const CHECKINS_A = {
  v: 2, sg: {}, st: Object.fromEntries([
    ck('臺北', 'tra_sched', 'visit', 3, '2026-09-20'),
    ck('臺北-環島', 'tra_sched', 'pass', 1, '2026-09-18'),        // 舊別名鍵 → 併進臺北
    ck('左營(舊城)', 'tra_sched', 'pass', 1, '2026-09-10'),        // 舊別名鍵 → 左營（清單是舊名，收集層是正名）
    ck('新城', 'tra_sched', 'visit', 2, '2026-09-11'),             // 正名；清單是「新城 (太魯閣)」
    ck('池上', 'tra_sched', 'visit', 1, '2026-09-21'),             // 與花蓮同日、n 較少
    ck('花蓮', 'tra_sched', 'pass', 2, '2026-09-21'),              // 同日 n 較多 → 該排在池上前（鍵字典序相反）
    ck('測試站', 'tra_sched', 'visit', 1, '2026-09-05'),           // 清單外
    ck('台北車站', 'metro', 'pass', 1, '2026-09-25'),              // 北捷＋機捷同名 → 兩點、兩系統各 +1
    ck('紅樹林', 'metro', 'visit', 5, '2026-09-25'),               // 北捷＋淡海同名；與台北車站同日、n 較多
    ck('西門', 'metro', 'visit', 1, '2026-09-12'),
    ck('頂埔', 'metro', 'visit', 1, '2026-09-13'),               // 北捷＋三鶯同名（第三組跨系統同名：讓 Σ各系統v ≠ n，否則清單外 2 座剛好抵銷）
    ck('不存在捷運站', 'metro', 'pass', 1, '2026-09-26'),          // 清單外的捷運站（recent 的退路）
  ]),
};
// 手算：合併後 臺北／左營／新城／池上／花蓮／測試站／台北車站／紅樹林／西門／頂埔／不存在捷運站 ＝ 11 座
//（Σ各系統 v ＝ 5＋(4＋1＋1＋1) ＝ 12 ≠ 11：跨系統同名多算 3、清單外少算 2，故意不讓兩者抵銷）
const N_A = 11;
const RIDES_B = [
  { train: 'r1', sys: 'tra_sched', kind: '自強', from: '基隆', to: '臺北', km: 0, date: '2026-09-15' },
  { train: 'r2', sys: 'thsr_sched', kind: '高鐵', from: '台北', to: '台中', km: 0, date: '2026-09-27' },
  { train: 'r3', sys: 'afr_sched', kind: '林鐵', from: '嘉義', to: '阿里山', km: 0, date: '2026-09-22' },
  { train: 'r4', sys: 'tra_sched', kind: '區間', from: '菁桐', to: '三貂嶺', km: 0, date: '2026-09-27' },
];
// 手算：新增 基隆、高鐵台北、高鐵台中、嘉義、阿里山、菁桐、三貂嶺 ＝ +7（臺北已在）
const N_B = N_A + 7;

// 分母與點數從 geojson 獨立重算，不寫死：清單會長站（例：2026-10 平鎮臨時站），寫死 538 會在那天假紅。
// 2026-09-29 當時：total 538（台鐵241＋高鐵12＋林鐵21＋捷運七系統同名併鍵264）、點數 543。
// 2026-09-30 台北與台中的市政府分開算之後：total 539（捷運同名併鍵 265）、點數不變。
const EMPTY0 = expectPayload(new Map(), 'zh-TW');
const TOTAL0 = EMPTY0.total, PTS0 = EMPTY0.pts.length, TRA0 = EMPTY0.listSizes.tra;
const TOTAL_MERGED0 = expectPayload(new Map(), 'zh-TW', new Set()).total; // 對照：不分開（舊規則）的座數

// ══ K 資料一致性（不用瀏覽器）══════════════════════════════════════════════
{
  const sched = readJson('data/tra_schedule_dense.json');
  const stops = new Set(); for (const t of sched.trains) for (const s of t.stops) stops.add(s.name);
  const list = new Set(GEO.features.filter(f => f.properties.sys === 'tra_sched').map(f => normName('tra_sched', f.properties.name)));
  const missing = [...list].filter(n => !stops.has(n));
  ok('K1 清單去別名後，台鐵站名全都在班表站名裡（別名表沒漏、沒錯）', missing.length === 0, missing.length ? `班表沒有：${missing.join('、')}` : `${list.size} 站`);
  const geoNames = k => new Set(GEO.features.filter(f => f.properties.sys === k).map(f => f.properties.name));
  ok('K2 fixture 用到的清單站都在 geojson（不然「清單內」的斷言是空的）', ['基隆', '菁桐', '三貂嶺', '池上', '花蓮', '十分', '瑞芳', '平溪'].every(n => geoNames('tra_sched').has(n)) && geoNames('thsr_sched').has('台北') && geoNames('thsr_sched').has('台中') && geoNames('afr_sched').has('嘉義') && geoNames('afr_sched').has('阿里山') && geoNames('mrt').has('南港展覽館') && geoNames('mrt').has('西門') && geoNames('mrt').has('頂埔') && geoNames('sanying').has('頂埔'));
  ok('K3 別名站確實在 geojson 裡是舊名（不然別名斷言是空的）', geoNames('tra_sched').has('左營(舊城)') && geoNames('tra_sched').has('新城 (太魯閣)') && !geoNames('tra_sched').has('左營'));
  // K4：分開算的表要剛好涵蓋「跨系統同名、實體卻相距很遠」的捷運站。台北車站／紅樹林／頂埔／十四張是同一座站掛在兩個系統
  // （相距不到 1 公里、該併成一枚章），市政府是台北與台中兩座不同的站（相距約 135 公里）。座標是 geojson 原檔，跟頁面實作無關。
  const METRO_GEO = ['mrt', 'tymc', 'tmrt', 'krtc', 'ntdlrt', 'ntalrt', 'sanying'];
  const km = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const bySys = new Map();
  for (const f of GEO.features) {
    if (!METRO_GEO.includes(f.properties.sys)) continue;
    if (!bySys.has(f.properties.name)) bySys.set(f.properties.name, new Map());
    const m = bySys.get(f.properties.name); if (!m.has(f.properties.sys)) m.set(f.properties.sys, f.geometry.coordinates);
  }
  const spread = []; // 跨系統同名的站：[站名, 系統們, 最遠兩點相距 km]
  for (const [name, m] of bySys) {
    if (m.size < 2) continue;
    const pts = [...m.values()]; let mx = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) mx = Math.max(mx, km(pts[i], pts[j]));
    spread.push([name, [...m.keys()], mx]);
  }
  const far = spread.filter(x => x[2] > 5), near = spread.filter(x => x[2] <= 5);
  ok('K4 跨系統同名的捷運站裡，實體相距很遠的只有「市政府」，其餘同名站相距都不到 1 公里（同一座站掛兩個系統）', far.length === 1 && far[0][0] === '市政府' && far[0][2] > 100 && near.length >= 3 && near.every(x => x[2] < 1),
    `遠：${far.map(x => `${x[0]}(${x[1].join('+')}) ${x[2].toFixed(1)}km`).join('；')}／近：${near.map(x => `${x[0]} ${x[2].toFixed(2)}km`).join('、')}`);
  ok('K4 gate 分開算的表恰好＝相距很遠那一組的台中那座（台北那座是預設，不用列）', SPLIT_GEO.size === 1 && far.length === 1 && far[0][1].includes('tmrt') && SPLIT_GEO.has('tmrt|' + far[0][0]), [...SPLIT_GEO].join(','));
  ok('K4 分開算讓 total 剛好多 1（不分開＝舊規則的座數＋1；清單長站時兩邊一起漲，不會假紅）', TOTAL0 === TOTAL_MERGED0 + 1, `分開 ${TOTAL0}／不分開 ${TOTAL_MERGED0}（2026-09-30 當時 539／538）`);
}

// ══ J 空收集 ═══════════════════════════════════════════════════════════════
{
  const { ctx, page, geoReqs, readyAt } = await open({ bridge: true, tag: 'J' });
  const got = await waitPush(page, 0, 8000);
  ok('J 開機後有推送', !!got, got ? `ready 後 ${Date.now() - readyAt}ms（含等待）` : '沒有');
  if (got) {
    const p = got.payload;
    ok('J 契約逐欄檢查', schemaProblems(p, 'zh-TW').length === 0, schemaProblems(p, 'zh-TW').join('；'));
    ok('J 獨立重算的 total 在合理範圍（400–800；清單讀壞會掉到 0 或爆量）', TOTAL0 >= 400 && TOTAL0 <= 800, `total=${p.total}，各系統清單 ${p.sys.map(s => s.k + ':' + s.n).join(' ')}`);
    ok('J total ＝ 獨立重算（清單去重）', p.total === TOTAL0, `頁面 ${p.total}／重算 ${TOTAL0}`);
    ok('J n＝0、recent 空、點全灰（s＝0）', p.n === 0 && p.recent.length === 0 && p.pts.every(x => x[3] === 0));
    ok('J 點數 ＝ 獨立重算（每系統每座站一點；捷運同名跨系統各一點）', p.pts.length === PTS0, `頁面 ${p.pts.length}／重算 ${PTS0}`);
    const exp = expectPayload(new Map(), 'zh-TW');
    ok('J 各系統 n ＝ 獨立重算', JSON.stringify(p.sys) === JSON.stringify(exp.sys));
    ok('J 座標全落在 0..1000（投影框沒有裁掉站）', p.pts.every(x => x[0] > 0 && x[0] < 1000 && x[1] > 0 && x[1] < 1000));
  }
  ok('J 只抓一次 geojson（快取）', geoReqs.length === 1, `${geoReqs.length} 次`);
  await ctx.close();
}

// ══ A–G 主流程（一個 App 形態的頁面，資料一路累加）═══════════════════════════
let appListen = 0, appGeoReqs = 0, appPagehide = 0, appVis = 0;
{
  const seed = { 'trainmap-checkins-v1': JSON.stringify(CHECKINS_A) };
  const { ctx, page, geoReqs, readyAt } = await open({ bridge: true, seed, tag: 'A' });
  // A 開機推送
  const first = await waitPush(page, 0, 8000);
  ok('A 開機資料就緒後推送一次', !!first, first ? `ready 後 ${Date.now() - readyAt}ms` : '沒有');
  if (!first) { await ctx.close(); await finish(); }
  ok('A bridge 收到字串', first.type === 'string');
  const expA = await checkPayload(page, 'A', first.payload, 'zh-TW', N_A);
  // 手算的幾個特例（不經 oracle）
  const p0 = first.payload, sv = k => p0.sys.find(s => s.k === k);
  ok('A 手算：total ＝ 清單座數 ＋ 清單外 2 座（測試站、不存在捷運站）', p0.total === TOTAL0 + 2, `${p0.total}／應為 ${TOTAL0 + 2}`);
  ok('A 手算：台鐵 v＝5（臺北、左營、新城、池上、花蓮；測試站不算）', sv('tra').v === 5, String(sv('tra').v));
  ok('A 手算：北捷 v＝4、機捷 v＝1、淡海 v＝1、三鶯 v＝1（同名捷運站在各系統都算）', sv('trtc').v === 4 && sv('tymc').v === 1 && sv('ntdlrt').v === 1 && sv('sanying').v === 1, `${sv('trtc').v}/${sv('tymc').v}/${sv('ntdlrt').v}/${sv('sanying').v}`);
  ok('A 前提：n ≠ Σ各系統 v（不然 n 的斷言分不出「護照函式」與「各系統加總」；突變 M6 就是這樣漏過一次）', p0.n !== p0.sys.reduce((a, x) => a + x.v, 0), `n=${p0.n} Σv=${p0.sys.reduce((a, x) => a + x.v, 0)}`);
  // 每系統各取最近 4 筆：台鐵候選 6 筆（花蓮、池上、臺北、新城 ∣ 左營、測試站 出局）、北捷候選 5 筆（不存在捷運站、紅樹林、台北車站、頂埔 ∣ 西門 出局）；
  // 合併後再整體排序 ⇒ 兩系統的紀錄交錯（花蓮／池上／臺北 夾在 台北車站 與 頂埔 之間），沒有整體重排會露餡。
  recentPremise('A', expA, { tra: 6, trtc: 5 }, 2);
  ok('A 手算：recent ＝ 每系統各取 4 筆、合併後整體重排（8 筆；同日 n 多者在前：紅樹林>台北車站、花蓮>池上）', JSON.stringify(p0.recent.map(r => r.name + '@' + r.k)) === JSON.stringify(['不存在捷運站@trtc', '紅樹林@trtc', '台北車站@trtc', '花蓮@tra', '池上@tra', '臺北@tra', '頂埔@trtc', '新城@tra']), p0.recent.map(r => r.name + '@' + r.k).join('/'));
  ok('A 手算：每系統筆數 ＝ tra 4、trtc 4；第 5 名（左營、西門）與清單外的測試站不在裡面', sameObj(perK(p0.recent), { tra: 4, trtc: 4 }) && !p0.recent.some(r => ['左營', '西門', '測試站'].includes(r.name)), JSON.stringify(perK(p0.recent)));
  ok('A 手算：recent 的線名是人看得懂的（紅樹林→淡水信義線、花蓮→臺東線；清單外→系統簡稱）', p0.recent[1].line === '淡水信義線' && p0.recent[3].line === '臺東線' && p0.recent[0].line === '北捷' && p0.recent[0].k === 'trtc', p0.recent.map(r => r.line + '/' + r.k).join(' '));
  ok('A 手算：三種章的 s 值（follow=1、搭過／到訪=2、未收集=0）在 A 階段只有 0 與 2', new Set(p0.pts.map(x => x[3])).size === 2);
  await sleep(3300);
  ok('A 開機只推一次（沒有連環推送）', (await count(page)) === 1, String(await count(page)));

  let before = await count(page);
  // B 完乘寫入
  let got = await step(page, 'B', before, 'zh-TW', () => page.evaluate(r => saveRides(loadRides().concat(r)), RIDES_B), N_B);
  if (got) {
    const s1 = got.payload.pts.filter(x => x[3] === 1).length;
    ok('B follow（只有完乘紀錄的站）→ s＝1：基隆、高鐵2、林鐵2、菁桐、三貂嶺 共 7 點', s1 === 7, String(s1));
    ok('B 高鐵 v＝2、林鐵 v＝2', got.payload.sys.find(s => s.k === 'thsr').v === 2 && got.payload.sys.find(s => s.k === 'afr').v === 2);
    ok('B total 不變（都在清單內）', got.payload.total === TOTAL0 + 2, String(got.payload.total));
    // B 起有四個系統各有紀錄：台鐵候選 9 筆只留 4（三貂嶺、菁桐、花蓮、池上；臺北掉出前 4）、高鐵 2、林鐵 2（全都比全域前 4 名舊，舊語意會整個消失）、北捷 4。
    recentPremise('B', got.exp, { tra: 9, thsr: 2, trtc: 5, afr: 2 }, 4);
    ok('B recent ＝ 四個系統各取最近 4 筆共 12 筆（09-27 高鐵台中／台北、台鐵三貂嶺／菁桐 → 北捷 → 林鐵 09-22 → 台鐵 09-21 → 北捷頂埔）', JSON.stringify(got.payload.recent.map(r => r.name + '@' + r.k)) === JSON.stringify(['台中@thsr', '台北@thsr', '三貂嶺@tra', '菁桐@tra', '不存在捷運站@trtc', '紅樹林@trtc', '台北車站@trtc', '嘉義@afr', '阿里山@afr', '花蓮@tra', '池上@tra', '頂埔@trtc']), got.payload.recent.map(r => r.name + '@' + r.k).join('/'));
    ok('B 每系統筆數 ＝ tra 4、thsr 2、trtc 4、afr 2；林鐵兩筆都在（舊語意「全系統取 4 筆」會讓它消失）', sameObj(perK(got.payload.recent), { tra: 4, thsr: 2, trtc: 4, afr: 2 }) && got.payload.recent.filter(r => r.k === 'afr').length === 2, JSON.stringify(perK(got.payload.recent)));
    ok('B 菁桐的線名是「平溪線」、不是代碼 PINGXI', (got.payload.recent.find(r => r.name === '菁桐') || {}).line === '平溪線', (got.payload.recent.find(r => r.name === '菁桐') || {}).line);
    before = await count(page);
  }
  // C 打卡寫入（真的 writeCheckin：台鐵一站、捷運同名併鍵一站）
  got = await step(page, 'C1', before, 'zh-TW', () => page.evaluate(() => writeCheckin({ sys: 'tra_sched', name: '瑞芳' }, 'visit')), N_B + 1);
  if (got) {
    before = await count(page);
    const today = await page.evaluate(() => loadCheckins().st['tra_sched|瑞芳'].d);
    ok('C1 recent 第一筆是剛蓋的站、d ＝ 今天', got.payload.recent[0].name === '瑞芳' && got.payload.recent[0].d === today, `${got.payload.recent[0].name}@${got.payload.recent[0].d} 今天=${today}`);
  }
  got = await step(page, 'C2', before, 'zh-TW', () => page.evaluate(() => writeCheckin({ sys: 'freq', name: '南港展覽館' }, 'pass')), N_B + 2);
  if (got) {
    const mrt = got.payload.sys.find(s => s.k === 'trtc');
    ok('C2 捷運打卡走 metro 併鍵：北捷 v 5', mrt.v === 5, String(mrt.v));
    before = await count(page);
  }
  // D 帳號同步合併（rail-user-data-changed；本機打卡不派事件，這裡直接改 storage 再派事件，隔離出「listener 本身」）
  got = await step(page, 'D', before, 'zh-TW', () => page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    c.st['tra_sched|十分'] = { name: '十分', sys: 'tra_sched', s: 'visit', n: 1, d: '2026-09-28', u: Date.now() };
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify(c));
    window.dispatchEvent(new CustomEvent('rail-user-data-changed', { detail: { source: 'remote' } }));
  }), N_B + 3);
  if (got) before = await count(page);
  // E 切換語言
  for (const lang of ['en', 'ja', 'zh-TW']) {
    got = await step(page, `E(${lang})`, before, lang, () => page.evaluate(l => window.__i18n.setLanguage(l), lang), N_B + 3);
    if (got) {
      before = await count(page);
      if (lang !== 'zh-TW') {
        const p = got.payload;
        ok(`E(${lang}) 簡稱／站名／線名都換成當下語言`, p.sys[0].label === LABEL[lang][0] && p.recent.every(r => r.name && r.line));
        console.log(`       ${lang}: ${p.recent.map(r => `${r.name}|${r.line}`).join('  ')}`);
      }
    }
  }
  // F 內容沒變不重送
  before = await count(page);
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('rail-user-data-changed', { detail: { source: 'remote' } })); saveRides(loadRides()); });
  await sleep(3500);
  ok('F 內容沒變（事件重發＋saveRides 同內容）→ 3.5 秒內不重送', (await count(page)) === before, `${before} → ${await count(page)}`);
  before = await count(page);
  // G userDataRenderAll（登出／刪帳號／換帳號的落點）
  got = await step(page, 'G', before, 'zh-TW', () => page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    c.st['tra_sched|平溪'] = { name: '平溪', sys: 'tra_sched', s: 'visit', n: 1, d: '2026-09-28', u: Date.now() };
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify(c));
    userDataRenderAll();
  }), N_B + 4);
  if (got && process.env.PAYLOAD_OUT) { writeFileSync(process.env.PAYLOAD_OUT, JSON.stringify(got.payload)); console.log(`       payload 已存 ${process.env.PAYLOAD_OUT}`); }
  ok('E/G 期間 at 逐包遞增', await page.evaluate(() => { const a = window.__pushes.map(x => JSON.parse(x.json).at); return a.every((x, i) => i === 0 || x >= a[i - 1]); }));
  appGeoReqs = geoReqs.length;
  ok('A–G 全程 geojson 只抓一次（快取；?gltracks=0 所以請求都是這個功能發的＝正向對照）', geoReqs.length === 1, `${geoReqs.length} 次`);
  appListen = await page.evaluate(() => window.__listen['rail-user-data-changed'] || 0);
  appPagehide = await page.evaluate(() => window.__listen['pagehide'] || 0);
  appVis = await page.evaluate(() => window.__listenDoc['visibilitychange'] || 0);
  ok('App 形態：schedule 已掛（nativeCollectionSchedule 是函式）', await page.evaluate(() => typeof nativeCollectionSchedule === 'function'));
  await ctx.close();
}

// ══ H 純網站 ═══════════════════════════════════════════════════════════════
{
  const seed = { 'trainmap-checkins-v1': JSON.stringify(CHECKINS_A) };
  const { ctx, page, geoReqs } = await open({ bridge: false, seed, tag: 'H' });
  await sleep(4500);
  ok('H 純網站：開機 4.5 秒零 geojson 請求（?gltracks=0 排除地圖自己的請求）', geoReqs.length === 0, `${geoReqs.length} 次`);
  await page.evaluate(() => {
    writeCheckin({ sys: 'tra_sched', name: '瑞芳' }, 'visit');
    saveRides(loadRides().concat([{ train: 'w1', sys: 'tra_sched', kind: '自強', from: '基隆', to: '臺北', km: 0, date: '2026-09-15' }]));
    window.dispatchEvent(new CustomEvent('rail-user-data-changed', { detail: { source: 'remote' } }));
    userDataRenderAll();
    window.__i18n.setLanguage('en'); window.__i18n.setLanguage('zh-TW');
  });
  await sleep(3500);
  ok('H 純網站：打卡／完乘／同步事件／登出落點／切語言之後仍零 geojson 請求', geoReqs.length === 0, `${geoReqs.length} 次`);
  const st = await page.evaluate(() => ({ sched: nativeCollectionSchedule, bridge: typeof window.RAIL_NATIVE_COLLECTION, geo: NATIVE_COLLECTION.geo, geoP: NATIVE_COLLECTION.geoP, listen: window.__listen['rail-user-data-changed'] || 0, pagehide: window.__listen['pagehide'] || 0, vis: window.__listenDoc['visibilitychange'] || 0 }));
  ok('H 純網站：沒有 bridge、schedule 是 null、沒快取 geojson', st.bridge === 'undefined' && st.sched === null && st.geo === null && st.geoP === null, JSON.stringify(st));
  ok('H 純網站：不註冊 rail-user-data-changed listener（App 形態恰好多 1 個）', appListen - st.listen === 1, `App ${appListen} − 網站 ${st.listen}`);
  ok('H 純網站：不註冊切背景補送的 listener（App 形態的 pagehide、visibilitychange 各恰好多 1 個）', appPagehide - st.pagehide === 1 && appVis - st.vis === 1, `pagehide：App ${appPagehide} − 網站 ${st.pagehide}；visibilitychange：App ${appVis} − 網站 ${st.vis}`);
  ok('H 純網站：打卡等功能本身不受影響（n 仍算得出來）', (await page.evaluate(() => stationCollection(loadRides()).size)) === N_A + 2, '');
  await ctx.close();
}

// ══ I 開機落在捷運群組（schedStations 為空）═══════════════════════════════
{
  const st = {}; for (const [k, v] of [ck('左營', 'tra_sched', 'visit', 1, '2026-09-20'), ck('新城', 'tra_sched', 'visit', 1, '2026-09-19'), ck('臺北', 'tra_sched', 'pass', 1, '2026-09-18')]) st[k] = v;
  const { ctx, page } = await open({ bridge: true, seed: { 'trainmap-checkins-v1': JSON.stringify({ v: 2, sg: {}, st }) }, query: '?gltracks=0&g=metro', tag: 'I' });
  const got = await waitPush(page, 0, 8000);
  ok('I 捷運群組開機有推送', !!got);
  if (got) {
    const sched = await page.evaluate(() => (state.schedStations || []).length);
    ok('I 前提成立：state.schedStations 是空的（不然這關是空過）', sched === 0, `schedStations=${sched}`);
    const p = got.payload;
    ok('I total 仍＝清單座數（清單的別名站沒有變成多餘的兩座）', p.total === TOTAL0, `${p.total}／應為 ${TOTAL0}`);
    ok('I 台鐵 v＝3（左營／新城／臺北：清單是舊名也算收到）', p.sys.find(s => s.k === 'tra').v === 3, String(p.sys.find(s => s.k === 'tra').v));
    ok('I 台鐵清單 n ＝ 獨立重算', p.sys.find(s => s.k === 'tra').n === TRA0, `${p.sys.find(s => s.k === 'tra').n}／應為 ${TRA0}`);
    await checkPayload(page, 'I', p, 'zh-TW', 3);
  }
  await ctx.close();
}

// ══ L 捷運群組開機後切到台鐵群組：別名併回生效，n 跟著護照變 ═════════════════════
// 存了舊括號別名鍵（左營(舊城)，08-16 前的 canonical）的使用者，schedStations 空的時候護照把它和「左營」算兩座；台鐵班表載入
// （applySchedSystems）後併成一座。小工具要在那一刻重送，不能等下一次打卡。
{
  const st = {}; for (const [k, v] of [ck('左營', 'tra_sched', 'visit', 1, '2026-09-20'), ck('左營(舊城)', 'tra_sched', 'pass', 1, '2026-09-19'), ck('花蓮', 'tra_sched', 'visit', 1, '2026-09-18')]) st[k] = v;
  const { ctx, page } = await open({ bridge: true, seed: { 'trainmap-checkins-v1': JSON.stringify({ v: 2, sg: {}, st }) }, query: '?gltracks=0&g=metro', tag: 'L' });
  const first = await waitPush(page, 0, 8000);
  const size0 = await page.evaluate(() => stationCollection(loadRides()).size);
  ok('L 前提：捷運群組時護照把左營(舊城)與左營算兩座（不然這關是空過）', !!first && size0 === 3 && first.payload.n === 3, `護照 ${size0}、小工具 ${first && first.payload.n}`);
  const before = await page.evaluate(() => window.__pushes.length);
  await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
  let size1 = 0; const t0 = Date.now();
  while (Date.now() - t0 < 20000) { size1 = await page.evaluate(() => (state.schedStations || []).length ? stationCollection(loadRides()).size : 0); if (size1) break; await sleep(100); }
  ok('L 前提：切到台鐵群組後護照併成兩座', size1 === 2, `護照 ${size1}`);
  const got = await waitPush(page, before, 6000);
  ok('L 切群組後小工具重送，n ＝ 護照', !!got && got.payload.n === size1, got ? `n=${got.payload.n}（班表就緒後 ${got.waited}ms）` : '沒有重送');
  await ctx.close();
}

// ══ M recent 每系統各取最近 4 筆（專屬 fixture）════════════════════════════════
// 九個系統各有紀錄（淡海、安坑外的都有；安坑清單有站但沒蓋章）；高捷候選 6 筆、中捷候選 5 筆（都超過 4）。
// 邊界故意做成兩種決勝：高捷第 4／5 名同日、以 n 決勝（獅甲 n2 進榜、三多商圈 n1 出局）；中捷五筆同日同 n、以收集鍵字典序決勝（舊社出局）。
// 林鐵阿里山蓋章日最舊（全域排第 18）——舊語意「全系統只取 4 筆」下它會整個消失，單一系統範圍的小工具就沒有東西可畫。
const CHECKINS_R = {
  v: 2, sg: {}, st: Object.fromEntries([
    ck('測試站', 'tra_sched', 'visit', 1, '2026-09-30'),          // 清單外的台鐵站 → 退路歸台鐵
    ck('瑞芳', 'tra_sched', 'visit', 1, '2026-09-10'),
    ck('十分', 'tra_sched', 'pass', 1, '2026-09-09'),
    ck('台中', 'thsr_sched', 'pass', 1, '2026-09-29'),
    ck('台北', 'thsr_sched', 'visit', 1, '2026-09-29'),
    ck('南港展覽館', 'metro', 'pass', 1, '2026-09-29'),           // 北捷
    ck('小港', 'metro', 'visit', 1, '2026-09-28'),                // 高捷 6 筆候選
    ck('草衙', 'metro', 'visit', 3, '2026-09-28'),                // 與小港同日、n 較多 → 排在小港前
    ck('凱旋', 'metro', 'pass', 1, '2026-09-24'),
    ck('獅甲', 'metro', 'visit', 2, '2026-09-23'),                // 第 4 名：同日 n 較多 → 進榜
    ck('三多商圈', 'metro', 'visit', 1, '2026-09-23'),            // 第 5 名：同日 n 較少 → 出局
    ck('中央公園', 'metro', 'visit', 1, '2026-09-01'),            // 第 6 名
    ck('北屯總站', 'metro', 'visit', 1, '2026-09-20'),            // 中捷 5 筆候選，同日同 n
    ck('舊社', 'metro', 'visit', 1, '2026-09-20'),
    ck('松竹', 'metro', 'visit', 1, '2026-09-20'),
    ck('四維國小', 'metro', 'visit', 1, '2026-09-20'),
    ck('文心崇德', 'metro', 'visit', 1, '2026-09-20'),
    ck('淡江大學', 'metro', 'visit', 1, '2026-09-05'),            // 淡海
    ck('鶯歌車站', 'metro', 'visit', 1, '2026-09-04'),            // 三鶯
    ck('林口站', 'metro', 'visit', 1, '2026-09-03'),              // 機捷
    ck('阿里山', 'afr_sched', 'visit', 1, '2026-09-01'),          // 林鐵：全域最舊
  ]),
};
const N_R = 21; // 手算：台鐵3＋高鐵2＋高捷6＋北捷1＋中捷5＋淡海1＋三鶯1＋機捷1＋林鐵1
const R_ALL = ['測試站@tra', '南港展覽館@trtc', '台中@thsr', '台北@thsr', '草衙@krtc', '小港@krtc', '凱旋@krtc', '獅甲@krtc', '北屯總站@tmrt', '四維國小@tmrt', '文心崇德@tmrt', '松竹@tmrt', '瑞芳@tra', '十分@tra', '淡江大學@ntdlrt', '鶯歌車站@sanying', '林口站@tymc', '阿里山@afr'];
{
  const { ctx, page } = await open({ bridge: true, seed: { 'trainmap-checkins-v1': JSON.stringify(CHECKINS_R) }, tag: 'M' });
  const got = await waitPush(page, 0, 8000);
  ok('M 開機有推送', !!got);
  if (got) {
    const p = got.payload, names = k => p.recent.filter(r => r.k === k).map(r => r.name);
    const exp = await checkPayload(page, 'M', p, 'zh-TW', N_R);
    recentPremise('M', exp, { tra: 3, thsr: 2, trtc: 1, tymc: 1, tmrt: 5, krtc: 6, ntdlrt: 1, sanying: 1, afr: 1 }, 9);
    ok('M 手算：total ＝ 清單座數 ＋ 清單外 1 座（測試站）', p.total === TOTAL0 + 1, `${p.total}／應為 ${TOTAL0 + 1}`);
    ok('M 手算：recent ＝ 九個系統各取最近 4 筆共 18 筆，合併後 d 新到舊、同日 n 多到少、再依鍵字典序', JSON.stringify(p.recent.map(r => r.name + '@' + r.k)) === JSON.stringify(R_ALL), p.recent.map(r => r.name + '@' + r.k).join('/'));
    ok('M 手算：每系統筆數（高捷 4、中捷 4、台鐵 3、高鐵 2、其餘 1；沒紀錄的安坑不出現）', sameObj(perK(p.recent), { tra: 3, thsr: 2, trtc: 1, tymc: 1, tmrt: 4, krtc: 4, ntdlrt: 1, sanying: 1, afr: 1 }), JSON.stringify(perK(p.recent)));
    ok('M 邊界（n 決勝）：高捷 獅甲（同日 n2）在榜、三多商圈（同日 n1）與第 6 名中央公園出局', JSON.stringify(names('krtc')) === JSON.stringify(['草衙', '小港', '凱旋', '獅甲']), names('krtc').join('/'));
    ok('M 邊界（鍵字典序決勝）：中捷五筆同日同 n，留 北屯總站／四維國小／文心崇德／松竹、舊社出局', JSON.stringify(names('tmrt')) === JSON.stringify(['北屯總站', '四維國小', '文心崇德', '松竹']), names('tmrt').join('/'));
    ok('M 全域最舊的系統仍有紀錄：林鐵阿里山（全域排第 18）在 recent 裡（舊語意下會消失）', p.recent.length === 18 && p.recent[17].name === '阿里山' && p.recent[17].k === 'afr');
    ok('M 清單外的站退路：測試站歸台鐵（k＝tra、線名＝系統簡稱「台鐵」）', p.recent[0].name === '測試站' && p.recent[0].k === 'tra' && p.recent[0].line === '台鐵', JSON.stringify(p.recent[0]));
    ok('M 原生端「單一系統範圍取 k 相符的前 4 筆」有東西可取：每個有紀錄的系統至少 1 筆、至多 4 筆', ['tra', 'thsr', 'trtc', 'tymc', 'tmrt', 'krtc', 'ntdlrt', 'sanying', 'afr'].every(k => names(k).length >= 1 && names(k).length <= 4) && names('ntalrt').length === 0);
    ok('M 每個系統各自的列依 d 新到舊（單一系統取前 4 筆時順序就是對的）', ['tra', 'krtc', 'tmrt', 'thsr'].every(k => { const d = p.recent.filter(r => r.k === k).map(r => r.d); return d.every((x, i) => !i || x <= d[i - 1]); }));
  }
  await ctx.close();
}

// ══ R 轉乘站的最近蓋章（ks）═══════════════════════════════════════════════════════
// 轉乘站＝同一把收集鍵出現在兩個以上系統的清單。真實資料只有四把：台北車站＝北捷＋機捷、紅樹林＝北捷＋淡海、頂埔＝北捷＋三鶯、十四張＝北捷＋安坑。
// 舊做法只把轉乘站歸給第一個系統（北捷）：淡海範圍「已收集 1／14 座」卻沒有任何最近蓋章，北捷自己的前 4 筆也會把轉乘站擠掉。
// 新做法：轉乘站算進每個所屬系統各自的前 4 筆，歸屬 k 仍是第一個系統，另送 ks＝全部所屬系統（固定順序、含 k）；只屬一個系統的站沒有 ks。
// fixture（sys 全是 metro，期望值手寫）：北捷專屬 4 筆最新、三鶯專屬 4 筆次之，四座轉乘站都比它們舊——
//   北捷前 4 筆被專屬站占滿，紅樹林／台北車站／十四張只有靠「所屬的另一個系統」才選得到（淡海、安坑只有轉乘站那一筆紀錄）；
//   頂埔在三鶯也被 4 筆專屬站擠掉，兩邊都落選 ⇒ 不在 recent 裡；機捷專屬的林口站最舊，與台北車站同屬機捷的前 4 筆。
const CHECKINS_X = {
  v: 2, sg: {}, st: Object.fromEntries([
    ck('南港展覽館', 'metro', 'pass', 1, '2026-09-29'),           // 北捷專屬
    ck('西門', 'metro', 'visit', 1, '2026-09-28'),
    ck('龍山寺', 'metro', 'visit', 1, '2026-09-27'),
    ck('忠孝復興', 'metro', 'visit', 1, '2026-09-26'),
    ck('鶯歌車站', 'metro', 'visit', 1, '2026-09-25'),            // 三鶯專屬
    ck('三峽', 'metro', 'visit', 1, '2026-09-24'),
    ck('龍埔', 'metro', 'visit', 1, '2026-09-23'),
    ck('橫溪', 'metro', 'visit', 1, '2026-09-22'),
    ck('紅樹林', 'metro', 'visit', 2, '2026-09-20'),              // 北捷＋淡海；淡海只有這一筆
    ck('台北車站', 'metro', 'pass', 1, '2026-09-19'),             // 北捷＋機捷
    ck('頂埔', 'metro', 'visit', 1, '2026-09-18'),                // 北捷＋三鶯；兩邊都被較新的專屬站擠掉
    ck('十四張', 'metro', 'visit', 1, '2026-09-17'),              // 北捷＋安坑；安坑只有這一筆
    ck('林口站', 'metro', 'visit', 1, '2026-09-15'),              // 機捷專屬
  ]),
};
const N_X = 13;
// [站名, k, ks, d]：合併後 d 新到舊。北捷歸屬 8 筆候選只有前 4 筆是專屬站的名額；紅樹林／台北車站／十四張是靠另一個系統選進來的。
const X_RECENT = [
  ['南港展覽館', 'trtc', null, '2026-09-29'], ['西門', 'trtc', null, '2026-09-28'], ['龍山寺', 'trtc', null, '2026-09-27'], ['忠孝復興', 'trtc', null, '2026-09-26'],
  ['鶯歌車站', 'sanying', null, '2026-09-25'], ['三峽', 'sanying', null, '2026-09-24'], ['龍埔', 'sanying', null, '2026-09-23'], ['橫溪', 'sanying', null, '2026-09-22'],
  ['紅樹林', 'trtc', ['trtc', 'ntdlrt'], '2026-09-20'], ['台北車站', 'trtc', ['trtc', 'tymc'], '2026-09-19'], ['十四張', 'trtc', ['trtc', 'ntalrt'], '2026-09-17'],
  ['林口站', 'tymc', null, '2026-09-15'],
];
{
  const { ctx, page } = await open({ bridge: true, seed: { 'trainmap-checkins-v1': JSON.stringify(CHECKINS_X) }, tag: 'R' });
  const got = await waitPush(page, 0, 8000);
  ok('R 開機有推送', !!got);
  if (got) {
    const p = got.payload, exp = await checkPayload(page, 'R', p, 'zh-TW', N_X);
    // 前提（geojson 原檔，跟頁面實作無關）：這四把鍵在清單裡真的分屬兩個系統，專屬站只屬一個系統
    const mem = k => exp.members(k).join('+');
    ok('R 前提：四把轉乘鍵在清單裡分屬 台北車站＝trtc+tymc、紅樹林＝trtc+ntdlrt、頂埔＝trtc+sanying、十四張＝trtc+ntalrt', mem('metro|台北車站') === 'trtc+tymc' && mem('metro|紅樹林') === 'trtc+ntdlrt' && mem('metro|頂埔') === 'trtc+sanying' && mem('metro|十四張') === 'trtc+ntalrt',
      ['台北車站', '紅樹林', '頂埔', '十四張'].map(n => `${n}＝${mem('metro|' + n)}`).join(' '));
    ok('R 前提：專屬站只屬一個系統（北捷四筆、三鶯四筆、機捷林口站）', ['南港展覽館', '西門', '龍山寺', '忠孝復興'].every(n => mem('metro|' + n) === 'trtc') && ['鶯歌車站', '三峽', '龍埔', '橫溪'].every(n => mem('metro|' + n) === 'sanying') && mem('metro|林口站') === 'tymc');
    recentPremise('R', exp, { trtc: 8, sanying: 4, tymc: 1 }, 3); // 北捷歸屬 8 筆候選 > 4：北捷的名額被專屬站占滿，轉乘站只能靠另一個系統
    ok('R 手算：recent（名稱、歸屬 k、ks、日期）＝ 12 筆（頂埔兩邊都落選）', JSON.stringify(p.recent.map(r => [r.name, r.k, r.ks || null, r.d])) === JSON.stringify(X_RECENT), p.recent.map(r => `${r.name}@${r.k}${r.ks ? '[' + r.ks + ']' : ''}`).join('/'));
    ok('R 手算：ks 只出現在轉乘站（紅樹林、台北車站、十四張）；其餘 9 筆沒有 ks 欄位', p.recent.filter(r => 'ks' in r).map(r => r.name).join('/') === '紅樹林/台北車站/十四張' && p.recent.filter(r => !('ks' in r)).length === 9);
    ok('R 手算：ks 的順序是 sys 的固定順序（北捷在前）、第一個就是歸屬 k、不重複', p.recent.filter(r => r.ks).every(r => r.ks[0] === r.k && r.ks[0] === 'trtc' && new Set(r.ks).size === r.ks.length));
    ok('R 手算：頂埔（北捷＋三鶯）兩邊都被較新的專屬站擠掉 → 不在 recent；每座站只出現一次', !p.recent.some(r => r.name === '頂埔') && new Set(p.recent.map(r => r.name)).size === p.recent.length);
    ok('R 紅樹林的線名仍是歸屬系統（北捷）的「淡水信義線」，不因從淡海選進來而改', (p.recent.find(r => r.name === '紅樹林') || {}).line === '淡水信義線', (p.recent.find(r => r.name === '紅樹林') || {}).line);
    // 原生端單一系統範圍取「k 相符、或 ks 含該系統」的前 4 筆（契約 recent 細節）——這裡照契約的規則篩，期望值手寫
    const scope = s => p.recent.filter(r => r.k === s || (r.ks || []).includes(s)).slice(0, 4).map(r => r.name).join('/');
    ok('R 淡海範圍：只有轉乘站紅樹林一筆紀錄，也選得到（舊做法是空的）', scope('ntdlrt') === '紅樹林', scope('ntdlrt') || '（空）');
    ok('R 安坑範圍：十四張選得到；機捷範圍：台北車站、林口站；三鶯範圍：四筆專屬站（頂埔落選）', scope('ntalrt') === '十四張' && scope('tymc') === '台北車站/林口站' && scope('sanying') === '鶯歌車站/三峽/龍埔/橫溪', `${scope('ntalrt')}｜${scope('tymc')}｜${scope('sanying')}`);
    ok('R 北捷範圍：前 4 筆是四座專屬站（轉乘站排在後面，沒有搶走名額）', scope('trtc') === '南港展覽館/西門/龍山寺/忠孝復興', scope('trtc'));
  }
  await ctx.close();
}

// ══ S 台北與台中的「市政府」各算一枚 ═══════════════════════════════════════════
// 兩座站名相同、實體相距約 135 公里。蓋章、護照「車站 N 座」、小工具的 n／total／各系統 v／點，都要把它們當兩座；
// 沒有記錄城市的舊資料（存的是 metro|市政府）一律是台北。
// 為什麼這樣量：
//   ・蓋章走真實流程——定位 → 附近車站清單 → 點「市政府」那一列的「蓋章」鈕，不直接呼叫 writeCheckin。附近清單的去重
//     曾把排在後面的城市的同名站吃掉（台中那一列根本不在清單裡），只驗 writeCheckin 會漏。
//   ・鍵不靠頁面函式：localStorage 的鍵與內容逐字比對；護照 N 讀畫面上真的畫出來的字，不呼叫 stationCollection。
//   ・期望值每個情境各自手算寫死（N、各系統 v、兩顆點亮或暗、recent），total／各系統 n 用 geojson 獨立重算。
//     不能拿「儲存內容」去算期望：兩座若都被存成同一把鍵，用它算出來的 N 也會是 1，跟頁面錯得一模一樣。
// group：'all'＝全台同框（裝飾層捷運的附近清單＋桌面護照 #passport）；'metro'＝捷運分頁（單捷運 freq 的附近清單＋旅程護照面板 #ridePanel）。
const cityPt = (geoSys, k) => {
  const f = GEO.features.find(x => x.properties.sys === geoSys && x.properties.name === '市政府');
  const [lon, lat] = f.geometry.coordinates;
  return { k, lon, lat, x: Math.round((lon - 120.15) / (122.0 - 120.15) * 1000), y: Math.round((25.27 - lat) / (25.27 - 22.2) * 1000) };
};
const CITY = { taipei: cityPt('mrt', 'trtc'), taichung: cityPt('tmrt', 'tmrt') };
const LIST_N = { trtc: EMPTY0.listSizes.trtc, tmrt: EMPTY0.listSizes.tmrt };
const CITY_WANT = {
  taipei: { n: 1, keys: ['metro|市政府'], trtcV: 1, tmrtV: 0, dotTP: 2, dotTC: 0, recent: ['市政府@trtc'] },
  taichung: { n: 1, keys: ['tmrt|市政府'], trtcV: 0, tmrtV: 1, dotTP: 0, dotTC: 2, recent: ['市政府@tmrt'] },
  both: { n: 2, keys: ['metro|市政府', 'tmrt|市政府'], trtcV: 1, tmrtV: 1, dotTP: 2, dotTC: 2, recent: ['市政府@trtc', '市政府@tmrt'] }, // 同日同 n：依收集鍵字典序 metro < tmrt
  legacy: { n: 1, keys: ['metro|市政府'], trtcV: 1, tmrtV: 0, dotTP: 2, dotTC: 0, recent: ['市政府@trtc'] },
};
async function openGroup(tag, group, seed) {
  const r = await open({ bridge: true, seed: seed || {}, query: `?gltracks=0&g=${group}`, tag });
  if (group === 'all') await r.page.waitForFunction(() => { try { return !!(state.deco && state.decoLines && state.decoLines.length); } catch (e) { return false; } }, null, { timeout: 60000, polling: 100 });
  return r;
}
// 護照畫面上真的畫出來的車站數：桌面護照 #passport 統計列的「車站 N 座」／旅程護照面板 #ridePanel 的「車站收集 N」
async function passportShown(page, group) {
  if (group === 'all') {
    const txt = await page.evaluate(() => { const e = document.querySelector('#passport .ph-stats'); return e && !document.getElementById('passport').hidden ? e.textContent : ''; });
    const m = /車站\s*(\d+)\s*座/.exec(txt);
    return { n: m ? Number(m[1]) : 0, txt: txt.replace(/\s+/g, ' ').trim() };
  }
  await page.evaluate(() => { if (document.getElementById('ridePanel').hidden) openRidePanel(); else renderRidePanel(); });
  const txt = await page.evaluate(() => { const e = document.querySelector('#ridePanel .ph-sec[data-sec="stn"]'); return e ? e.textContent : ''; });
  const m = /車站收集\s*(\d+)/.exec(txt);
  return { n: m ? Number(m[1]) : 0, txt: txt.replace(/\s+/g, ' ').trim().slice(0, 40) };
}
// 站在某座市政府、開附近車站清單：回「市政府」那一列（清單裡有幾列、標籤、蓋章鈕的字與狀態；此刻的狀態，還沒點）
async function nearbyCity(page, city) {
  await page.evaluate(([lat, lon]) => openNearbyStations(lat, lon, 30), [city.lat, city.lon]);
  const rows = page.locator('#nearCard .nx-row').filter({ has: page.locator('.nx-name', { hasText: /^市政府$/ }) });
  const n = await rows.count();
  const info = n === 1 ? await rows.first().evaluate(r => {
    const b = r.querySelector('.nx-ck');
    return { label: ((r.querySelector('.nx-sub b') || {}).textContent || '').trim(), btn: b ? b.textContent.trim() : null, disabled: !!(b && b.disabled) };
  }) : null;
  return { n, rows, info };
}
async function stampCity(page, city) { // 真的點那一列的「蓋章」鈕；鈕停用（兩座的鍵相撞時，第二座會顯示「今天已蓋 ✓」）就不點，讓呼叫端的 rowOk 判準記成 FAIL，不要卡 8 秒逾時、整支腳本崩潰
  const r = await nearbyCity(page, city);
  if (r.n === 1 && r.info && !r.info.disabled) await r.rows.first().locator('.nx-ck').click({ timeout: 8000 });
  return r;
}
const rowOk = (r, label, btn) => r.n === 1 && !!r.info && r.info.label === label && (btn instanceof RegExp ? btn.test(r.info.btn || '') : r.info.btn === btn) && r.info.disabled === (btn === '今天已蓋 ✓');
async function cityChecks(id, page, group, p, want) {
  const entries = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st; } catch (e) { return null; } });
  const keys = Object.keys(entries || {}).sort();
  ok(`${id} localStorage 存的鍵 ＝ ${JSON.stringify(want.keys)}，每筆 name＝市政府、sys＝鍵的系統段（逐字，不經頁面函式）`,
    JSON.stringify(keys) === JSON.stringify([...want.keys].sort()) && keys.every(k => entries[k].name === '市政府' && entries[k].sys === k.split('|')[0]), keys.join(','));
  const shown = await passportShown(page, group);
  ok(`${id} 護照畫面「車站 N 座」＝ ${want.n}（讀 DOM 文字）`, shown.n === want.n, `畫面「${shown.txt}」`);
  ok(`${id} 小工具 n ＝ 護照畫面 N ＝ 手算 ${want.n}`, p.n === shown.n && p.n === want.n, `payload ${p.n}／畫面 ${shown.n}`);
  ok(`${id} total ＝ 獨立重算 ${TOTAL0}（兩座市政府本來就各在清單裡，蓋章不改分母）`, p.total === TOTAL0, String(p.total));
  const sv = k => p.sys.find(s => s.k === k) || {};
  ok(`${id} 北捷 v／n ＝ ${want.trtcV}／${LIST_N.trtc}、中捷 v／n ＝ ${want.tmrtV}／${LIST_N.tmrt}`,
    sv('trtc').v === want.trtcV && sv('trtc').n === LIST_N.trtc && sv('tmrt').v === want.tmrtV && sv('tmrt').n === LIST_N.tmrt, `北捷 ${sv('trtc').v}/${sv('trtc').n}、中捷 ${sv('tmrt').v}/${sv('tmrt').n}`);
  const dot = c => { const h = p.pts.filter(pt => pt[0] === c.x && pt[1] === c.y && p.sys[pt[4]] && p.sys[pt[4]].k === c.k); return h.length === 1 ? h[0][3] : `x${h.length}`; };
  ok(`${id} 兩顆市政府點（依 geojson 座標＋系統找）：台北 s＝${want.dotTP}、台中 s＝${want.dotTC}`, dot(CITY.taipei) === want.dotTP && dot(CITY.taichung) === want.dotTC, `台北 ${dot(CITY.taipei)}／台中 ${dot(CITY.taichung)}`);
  ok(`${id} recent ＝ ${JSON.stringify(want.recent)}（各歸各的系統，台中的章不再掛成北捷）`, JSON.stringify(p.recent.map(r => r.name + '@' + r.k)) === JSON.stringify(want.recent), p.recent.map(r => r.name + '@' + r.k).join('/'));
  await checkPayload(page, id, p, 'zh-TW', want.n);
}
// 台北 → 台中連蓋兩座（S1 只蓋台北、S3 兩座都蓋），全台同框再做帳號同步往返
async function cityChain(group) {
  const tag = `S[${group}] 台北→台中`;
  const { ctx, page } = await openGroup(tag, group);
  const first = await waitPush(page, 0, 8000);
  ok(`${tag} 開機有推送（空收集，n＝0）`, !!first && first.payload.n === 0);
  let before = await count(page);
  let r = await stampCity(page, CITY.taipei);
  ok(`${tag} S1 台北市政府那一列在清單裡（恰好一列、標籤台北捷運、蓋章鈕「蓋章」可按）`, rowOk(r, '台北捷運', '蓋章'), JSON.stringify(r.info));
  let got = await waitPush(page, before, 6000);
  ok(`${tag} S1 只蓋台北：蓋章後 6 秒內送出新的一包`, !!got);
  if (got) { await cityChecks(`S1 只蓋台北[${group}]`, page, group, got.payload, CITY_WANT.taipei); before = await count(page); }
  r = await stampCity(page, CITY.taichung);
  ok(`${tag} S3 台北蓋過之後，台中市政府那一列還是「蓋章」可按（台北的章不算台中的；此刻的狀態）`, rowOk(r, '台中捷運', '蓋章'), JSON.stringify(r.info));
  got = await waitPush(page, before, 6000);
  ok(`${tag} S3 兩座都蓋：蓋章後 6 秒內送出新的一包`, !!got);
  if (got) { await cityChecks(`S3 兩座都蓋[${group}]`, page, group, got.payload, CITY_WANT.both); before = await count(page); }
  const rc = await nearbyCity(page, CITY.taichung), rp = await nearbyCity(page, CITY.taipei);
  ok(`${tag} 兩座都蓋之後，兩列的蓋章鈕都是「今天已蓋 ✓」且停用`, rowOk(rc, '台中捷運', '今天已蓋 ✓') && rowOk(rp, '台北捷運', '今天已蓋 ✓'), `台中 ${JSON.stringify(rc.info)}／台北 ${JSON.stringify(rp.info)}`);
  if (group === 'all') {
    // R 帳號同步的真實合併路徑（accountSyncTxn 用的同一串函式：checkinsToCollections → userDataNormalizeCollection →
    // userDataMergeCollection → collectionsToCheckins）：本機有台北＋台中兩枚，雲端是舊版 App 來的、只有 metro|市政府（n 較大、時間較新）。
    // 沒有任何一步會重組鍵：三把鍵原樣留下、各自的 sys 不變，舊版的 metro|市政府贏的是台北那一筆、碰不到台中。
    const rt = await page.evaluate(() => {
      const localCols = checkinsToCollections(loadCheckins()), at = Date.now() + 60000;
      const cloud = userDataNormalizeCollection('checkins', { items: [
        { id: 'metro|市政府', value: { k: 'metro|市政府', name: '市政府', sys: 'metro', s: 'visit', n: 7, d: '2026-09-29' }, updatedAt: at },
        { id: 'tra_sched|瑞芳', value: { k: 'tra_sched|瑞芳', name: '瑞芳', sys: 'tra_sched', s: 'pass', n: 1, d: '2026-09-28' }, updatedAt: at },
      ], tombstones: [] });
      const merged = userDataMergeCollection(userDataNormalizeCollection('checkins', localCols.checkins), cloud);
      const back = collectionsToCheckins({ checkins: merged, segments: { items: [], tombstones: [] } });
      saveCheckins(back);
      userDataRenderAll(); // 帳號同步寫回後的落點
      return back.st;
    });
    ok(`${tag} R 同步合併後鍵原樣留下：metro|市政府（舊版來的 n＝7 贏）、tmrt|市政府（n＝1、sys 仍是 tmrt）、tra_sched|瑞芳`,
      JSON.stringify(Object.keys(rt).sort()) === JSON.stringify(['metro|市政府', 'tmrt|市政府', 'tra_sched|瑞芳'])
      && rt['metro|市政府'].n === 7 && rt['metro|市政府'].sys === 'metro' && rt['tmrt|市政府'].n === 1 && rt['tmrt|市政府'].sys === 'tmrt' && rt['tmrt|市政府'].name === '市政府', JSON.stringify(Object.keys(rt).sort()));
    got = await waitPush(page, before, 6000);
    ok(`${tag} R 合併寫回後（userDataRenderAll）6 秒內送出新的一包`, !!got);
    if (got) {
      const p = got.payload, shown = await passportShown(page, group), sv = k => p.sys.find(s => s.k === k) || {};
      ok(`${tag} R 護照畫面 N ＝ 小工具 n ＝ 3（台北、台中、瑞芳；不是 2 也不是 4）`, shown.n === 3 && p.n === 3, `畫面「${shown.txt}」／payload ${p.n}`);
      ok(`${tag} R 北捷 v＝1、中捷 v＝1、台鐵 v＝1；total 不變`, sv('trtc').v === 1 && sv('tmrt').v === 1 && sv('tra').v === 1 && p.total === TOTAL0, `${sv('trtc').v}/${sv('tmrt').v}/${sv('tra').v} total ${p.total}`);
      await checkPayload(page, `R 同步往返[${group}]`, p, 'zh-TW', 3);
    }
  }
  await ctx.close();
}
// 只蓋台中（S2）：台北那一列與那顆點都不該亮
async function cityTaichungOnly(group) {
  const tag = `S[${group}] 只蓋台中`;
  const { ctx, page } = await openGroup(tag, group);
  const first = await waitPush(page, 0, 8000);
  ok(`${tag} 開機有推送（空收集，n＝0）`, !!first && first.payload.n === 0);
  const before = await count(page);
  const r = await stampCity(page, CITY.taichung);
  ok(`${tag} S2 台中市政府那一列在清單裡（恰好一列、標籤台中捷運、蓋章鈕「蓋章」可按；清單去重曾把它吃掉）`, rowOk(r, '台中捷運', '蓋章'), `${r.n} 列 ${JSON.stringify(r.info)}`);
  const got = await waitPush(page, before, 6000);
  ok(`${tag} S2 只蓋台中：蓋章後 6 秒內送出新的一包`, !!got);
  if (got) await cityChecks(`S2 只蓋台中[${group}]`, page, group, got.payload, CITY_WANT.taichung);
  const rp = await nearbyCity(page, CITY.taipei);
  ok(`${tag} S2 台中蓋過之後，台北市政府那一列還是「蓋章」可按（台中的章不算台北的）`, rowOk(rp, '台北捷運', '蓋章'), JSON.stringify(rp.info));
  await ctx.close();
}
// 只有舊資料（S4）：存的是沒記錄城市的 metro|市政府（含舊版 App 同步進來的）→ 一律是台北
async function cityLegacy(group) {
  const tag = `S[${group}] 只有舊資料`;
  const seed = { 'trainmap-checkins-v1': JSON.stringify({ v: 2, sg: {}, st: Object.fromEntries([ck('市政府', 'metro', 'visit', 1, '2026-09-20')]) }) };
  const { ctx, page } = await openGroup(tag, group, seed);
  const first = await waitPush(page, 0, 8000);
  ok(`${tag} 開機有推送`, !!first);
  if (first) await cityChecks(`S4 只有舊資料[${group}]`, page, group, first.payload, CITY_WANT.legacy);
  const rp = await nearbyCity(page, CITY.taipei), rc = await nearbyCity(page, CITY.taichung);
  ok(`${tag} S4 清單：台北那一列已有 1 次（「蓋章 · 第 2 次」）、台中那一列是全新的（「蓋章」）——舊章歸台北`, rowOk(rp, '台北捷運', /第 2 次/) && rowOk(rc, '台中捷運', '蓋章'), `台北 ${JSON.stringify(rp.info)}／台中 ${JSON.stringify(rc.info)}`);
  await ctx.close();
}
await cityChain('all');
await cityChain('metro');
await cityTaichungOnly('all');
await cityTaichungOnly('metro');
await cityLegacy('all');
await cityLegacy('metro');

// ══ T 清單不隨分頁變 ═════════════════════════════════════════════════════════
// 清單（分母）是全台固定的一份，站名去別名的規則是靜態的。原本清單站名走 checkinName，而它吃當前分頁的 state.schedStations：
// 捷運分頁是空的、高鐵分頁只有高鐵站，查不到台鐵的別名，清單就留著 geojson 的舊名（左營(舊城)、新城 (太魯閣)），收集層存的卻是
// 正名（左營、新城）——兩邊對不上：total 多 2、台鐵已收少 2、那兩顆點不亮。預設分頁（全、台）與 I（捷運分頁）都抓不到高鐵分頁。
// T1 四個分頁各開機一次：把清單裡每一座站都蓋滿（收集鍵與正名來自獨立重算），每個分頁都要「收滿」——n＝total＝清單座數、
//    每個系統 v＝n、每個點 s＝2——而且四個分頁的小工具內容逐字相同。
// T2 停在高鐵分頁：台鐵分頁蓋左營 → 切到高鐵分頁 → 台鐵那一列、total、左營那顆點都跟切換前一樣。
//    內容沒變時原本就不會重送，所以除了看最新一包，也直接呼叫 collectionWidgetPayload() 看「此刻會送什麼」。
const EVERY = Object.fromEntries([...EMPTY0.listKeys].map(key => { const i = key.indexOf('|'); return ck(key.slice(i + 1), key.slice(0, i), 'visit', 1, '2026-09-20'); }));
ok('T 前提：收滿 fixture 的座數 ＝ 獨立重算的清單座數（含左營、新城的正名與兩座市政府）', Object.keys(EVERY).length === TOTAL0 && 'tra_sched|左營' in EVERY && 'tra_sched|新城' in EVERY && 'tra_sched|臺北' in EVERY && 'metro|市政府' in EVERY && 'tmrt|市政府' in EVERY, `${Object.keys(EVERY).length}／${TOTAL0}`);
const TABS = { all: s => s.includes('tra_sched'), tra: s => s.includes('tra_sched'), hsr: s => s.length > 0 && s.every(x => x === 'thsr_sched'), metro: s => s.length === 0 };
const tabPayload = {};
for (const g of Object.keys(TABS)) {
  const tag = `T1[${g}]`;
  const { ctx, page } = await open({ bridge: true, seed: { 'trainmap-checkins-v1': JSON.stringify({ v: 2, sg: {}, st: EVERY }) }, query: `?gltracks=0&g=${g}`, tag });
  const got = await waitPush(page, 0, 8000);
  ok(`${tag} 開機有推送`, !!got);
  const sched = await page.evaluate(() => (state.schedStations || []).map(s => s.sys));
  ok(`${tag} 前提：state.schedStations 是這個分頁該有的樣子（高鐵分頁只有高鐵站、捷運分頁是空的；不然這關是空過）`, TABS[g](sched), `${sched.length} 站，系統 ${[...new Set(sched)].join('/') || '（空）'}`);
  if (got) {
    const p = got.payload; tabPayload[g] = p;
    ok(`${tag} 收滿：n ＝ total ＝ 獨立重算的清單座數 ${TOTAL0}（清單站名不隨分頁變，不會多出收集層對不上的站）`, p.n === TOTAL0 && p.total === TOTAL0, `n ${p.n}／total ${p.total}`);
    ok(`${tag} 每個系統 v ＝ n ＝ 獨立重算的清單座數（台鐵 ${TRA0}）、點全亮（s＝2）、點數 ${PTS0}`, p.sys.length === EMPTY0.sys.length && p.sys.every((s, i) => s.k === EMPTY0.sys[i].k && s.v === s.n && s.n === EMPTY0.sys[i].n) && p.pts.length === PTS0 && p.pts.every(x => x[3] === 2),
      p.sys.map(s => `${s.k}:${s.v}/${s.n}`).join(' '));
    await checkPayload(page, tag, p, 'zh-TW', TOTAL0);
  }
  await ctx.close();
}
{
  const strip = p => JSON.stringify({ ...p, at: 0 });
  const base = tabPayload.all;
  ok('T1 四個分頁的小工具內容逐字相同（不含 at）', !!base && Object.keys(TABS).every(g => tabPayload[g] && strip(tabPayload[g]) === strip(base)),
    Object.keys(TABS).map(g => `${g}:${tabPayload[g] ? (strip(tabPayload[g]) === strip(base) ? '同' : '不同') : '無'}`).join(' '));
}
{
  const tag = 'T2 停在高鐵分頁';
  const gf = GEO.features.find(f => f.properties.sys === 'tra_sched' && f.properties.name === '左營(舊城)'); // 清單裡左營的座標（geojson 原檔）
  const zx = Math.round((gf.geometry.coordinates[0] - 120.15) / (122.0 - 120.15) * 1000), zy = Math.round((25.27 - gf.geometry.coordinates[1]) / (25.27 - 22.2) * 1000);
  const view = p => {
    const tra = p.sys.find(s => s.k === 'tra') || {}, ti = p.sys.findIndex(s => s.k === 'tra');
    const dots = p.pts.filter(x => x[0] === zx && x[1] === zy && x[4] === ti);
    return { n: p.n, total: p.total, traV: tra.v, traN: tra.n, dots: dots.length === 1 ? dots[0][3] : `x${dots.length}`, lit: p.pts.filter(x => x[4] === ti && x[3] === 2).length };
  };
  const WANT = { n: 1, total: TOTAL0, traV: 1, traN: TRA0, dots: 2, lit: 1 };
  const { ctx, page } = await open({ bridge: true, query: '?gltracks=0&g=tra', tag });
  const first = await waitPush(page, 0, 8000);
  ok(`${tag} 開機有推送（台鐵分頁、空收集）`, !!first && first.payload.n === 0);
  const before = await count(page);
  await page.evaluate(() => writeCheckin({ sys: 'tra_sched', name: '左營' }, 'visit')); // 台鐵分頁蓋左營（收集層的正名）
  const s1 = await waitPush(page, before, 6000);
  ok(`${tag} 台鐵分頁蓋左營後送出新的一包`, !!s1);
  const v1 = s1 ? view(s1.payload) : null;
  ok(`${tag} 切換前（台鐵分頁）：n／total／台鐵 v／n／左營點／台鐵亮點數 ＝ 手算 ${JSON.stringify(WANT)}`, !!v1 && JSON.stringify(v1) === JSON.stringify(WANT), JSON.stringify(v1));
  await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'hsr')));
  await page.waitForFunction(() => { try { const s = state.schedStations || []; return state.group === 'hsr' && s.length > 0 && s.every(x => x.sys === 'thsr_sched'); } catch (e) { return false; } }, null, { timeout: 30000, polling: 100 });
  const sched = await page.evaluate(() => [...new Set((state.schedStations || []).map(s => s.sys))].join('/'));
  ok(`${tag} 前提：已切到高鐵分頁、state.schedStations 只剩高鐵站（不然這關是空過）`, sched === 'thsr_sched', sched);
  await sleep(3500); // 給重送一個機會（內容沒變本來就不會送）
  const last = await page.evaluate(() => JSON.parse(window.__pushes[window.__pushes.length - 1].json));
  const direct = await page.evaluate(() => { const q = collectionWidgetPayload(); if (q) q.at = 0; return q; });
  ok(`${tag} 切換後、此刻會送的內容（collectionWidgetPayload）：n／total／台鐵 v／n／左營點／台鐵亮點數 ＝ 手算 ${JSON.stringify(WANT)}`, JSON.stringify(view(direct)) === JSON.stringify(WANT), JSON.stringify(view(direct)));
  ok(`${tag} 切換後、最新一包實際送出的內容：同上`, JSON.stringify(view(last)) === JSON.stringify(WANT), JSON.stringify(view(last)));
  ok(`${tag} 切換前後小工具內容逐字相同（不含 at）`, !!s1 && JSON.stringify({ ...s1.payload, at: 0 }) === JSON.stringify(direct), '');
  await ctx.close();
}

// ══ P 護照深連結 ═══════════════════════════════════════════════════════════
// 契約：原生把 railisland://passport 轉成 waitOpen 事件（data.view＝'passport'）；網頁收到 → openRidePanel()（旅程護照 #ridePanel）。
// 量的是「畫面上真的看得見」：hidden 屬性、display／visibility／opacity、與視窗相交的面積、中心點 elementFromPoint 命中面板自己、
// 標題文字與標題可命中；不是「函式有沒有被呼叫」。對照組是既有的 view:'pass'（通行證面板 #plusModal）：兩個入口要分得開。
const measureFn = () => {
  const box = el => {
    if (!el) return { exists: false, shown: false, hiddenAttr: null };
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight);
    const w = x1 - x0, h = y1 - y0;
    const top = w > 0 && h > 0 ? document.elementFromPoint(x0 + w / 2, y0 + h / 2) : null;
    const hit = !!(top && el.contains(top));
    return { exists: true, hiddenAttr: el.hidden, w: Math.round(w), h: Math.round(h), hit, display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      shown: !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5 && w >= 100 && h >= 80 && hit };
  };
  const ride = document.getElementById('ridePanel');
  const h3 = ride && ride.querySelector(':scope > h3');
  let titleHit = false;
  if (h3) { const r = h3.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight) { const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); titleHit = !!(e && h3.contains(e)); } }
  return {
    ride: box(ride), plus: box(document.getElementById('plusModal')), fav: box(document.getElementById('favPanel')),
    rideTitle: h3 ? h3.textContent.replace(/[×\s]+$/, '').trim() : null, titleHit,
    stats: !!(ride && ride.querySelector('.ride-stats')),
    plusTitle: ((document.querySelector('#plusBody .plus-hero h3') || {}).textContent || '').trim(),
  };
};
async function waitMeasure(page, pred, ms) {
  const t0 = Date.now(); let m;
  while (Date.now() - t0 < ms) { m = await page.evaluate(measureFn); if (pred(m)) return { m, ok: true, waited: Date.now() - t0 }; await sleep(100); }
  return { m: m || await page.evaluate(measureFn), ok: false, waited: ms };
}
const shownStr = b => `${b.shown ? '看得見' : '看不見'}(hidden=${b.hiddenAttr} ${b.display}/${b.visibility}/op${b.opacity} 可見${b.w}×${b.h} 命中自己=${b.hit})`;
async function deepLinkChecks(tag, mobile) {
  const { ctx, page } = await open({ bridge: true, mw: true, mobile, tag });
  const L = await page.evaluate(() => (window.__mwListeners.waitOpen || []).length);
  ok(`${tag} 前提：waitOpen listener 真的接在外掛替身上（不然送事件是空過）`, L === 1, `${L} 個`);
  let m = await page.evaluate(measureFn);
  ok(`${tag} 前提：一開始護照與通行證都沒開（hidden、看不見）`, m.ride.hiddenAttr === true && !m.ride.shown && m.plus.hiddenAttr === true && !m.plus.shown, `護照 ${shownStr(m.ride)}／通行證 ${shownStr(m.plus)}`);
  // 對照組：view:'pass' → 通行證，不是護照
  await page.evaluate(() => window.__mwFire('waitOpen', { view: 'pass' }));
  let r = await waitMeasure(page, x => x.plus.shown, 8000); m = r.m;
  ok(`${tag} 對照：{view:'pass'} → 通行證面板出現在畫面上（標題含「通行證」）`, r.ok && /通行證/.test(m.plusTitle), `${shownStr(m.plus)} 標題「${m.plusTitle}」`);
  ok(`${tag} 對照：{view:'pass'} 沒有打開護照`, m.ride.hiddenAttr === true && !m.ride.shown, shownStr(m.ride));
  await page.evaluate(() => plusClose());
  // 護照
  await page.evaluate(() => window.__mwFire('waitOpen', { view: 'passport' }));
  r = await waitMeasure(page, x => x.ride.shown, 8000);
  await sleep(600); m = await page.evaluate(measureFn);
  ok(`${tag} {view:'passport'} → 旅程護照面板出現在畫面上（沒 hidden、可見面積夠大、中心點沒被別的蓋住）`, r.ok && m.ride.shown, shownStr(m.ride));
  ok(`${tag} 護照標題「旅程護照」、標題自己可命中（沒被蓋住）`, m.rideTitle === '旅程護照' && m.titleHit, `標題「${m.rideTitle}」命中=${m.titleHit}`);
  ok(`${tag} 護照內容真的畫出來了（完乘／總里程／收集章 統計列）`, m.stats);
  ok(`${tag} {view:'passport'} 沒有打開通行證`, m.plus.hiddenAttr === true && !m.plus.shown, shownStr(m.plus));
  // 已開著再送一次不會把它關掉（rideBtn 是開關鈕，深連結不是）
  await page.evaluate(() => window.__mwFire('waitOpen', { view: 'passport' }));
  await sleep(1800); m = await page.evaluate(measureFn);
  ok(`${tag} 護照已開著時再送一次 → 仍開著、仍看得見`, m.ride.shown, shownStr(m.ride));
  // 別的面板開著（最愛）→ 深連結把它換成護照
  await page.evaluate(() => { closeRidePanel(); openFavPanel(); });
  m = await page.evaluate(measureFn);
  ok(`${tag} 前提：最愛面板已開、護照已關`, m.fav.shown && m.ride.hiddenAttr === true, `最愛 ${shownStr(m.fav)}／護照 ${shownStr(m.ride)}`);
  await page.evaluate(() => window.__mwFire('waitOpen', { view: 'passport' }));
  r = await waitMeasure(page, x => x.ride.shown, 8000);
  await sleep(400); m = await page.evaluate(measureFn);
  ok(`${tag} 最愛面板開著時 {view:'passport'} → 護照看得見、最愛收起來`, r.ok && m.ride.shown && m.fav.hiddenAttr === true, `護照 ${shownStr(m.ride)}／最愛 hidden=${m.fav.hiddenAttr}`);
  await ctx.close();
}
// 冷啟動：App 沒在跑、使用者點小工具 → 原生在 listener 掛上的瞬間就把事件送進來，而此刻 boot 還沒完成。
async function coldDeepLinkChecks(tag, mobile) {
  const { ctx, page, readyAt } = await open({ bridge: true, mw: true, mwCold: { view: 'passport' }, mobile, tag, slow: 1500 });
  const attach = await page.evaluate(() => window.__mwAttachAt);
  ok(`${tag} 前提：listener 掛上後 boot 還要 ≥ 900ms 才完成（比閘門後的 600ms 等待長；不然拿掉閘門也量不出差別）`, !!attach && readyAt - attach >= 900, `attach→ready ${readyAt - attach}ms`);
  const r = await waitMeasure(page, x => x.ride.shown, 25000);
  ok(`${tag} 冷啟動事件（listener 掛上瞬間送進來）→ 開機後護照出現在畫面上`, r.ok, `${shownStr(r.m.ride)}（ready 後 ${r.waited}ms）`);
  await sleep(3500);
  const m = await page.evaluate(measureFn);
  ok(`${tag} 冷啟動：3.5 秒後護照仍開著、看得見（沒被開機後段的重繪／關面板洗掉）`, m.ride.shown && m.rideTitle === '旅程護照' && m.titleHit, `${shownStr(m.ride)} 標題「${m.rideTitle}」`);
  ok(`${tag} 冷啟動：通行證沒被打開`, m.plus.hiddenAttr === true && !m.plus.shown);
  const rw = await page.evaluate(() => window.__rideOpenedWhenReady);
  ok(`${tag} 冷啟動：事件比 boot 早到，護照卻是 boot 完成（state.ready）之後才打開的（閘門沒被繞過）`, rw === true, `打開那一刻 state.ready＝${rw}`);
  await ctx.close();
}
await deepLinkChecks('P 桌面 1280', false);
await deepLinkChecks('P 手機 375', true);
await coldDeepLinkChecks('P 冷啟動 桌面 1280', false);
await coldDeepLinkChecks('P 冷啟動 手機 375', true);

// ══ V 切到背景時補送排程中的推送 ══════════════════════════════════════════════════
// 原生 App 被滑走、鎖屏之後 WebView 很快被凍結，2 秒的去抖計時器等不到：蓋章後 2 秒內離開 App，小工具要等下次開 App 才更新。
// 補送只在「有排程中的推送」時發生；沒有排程（內容沒動、或動了但沒人通知）就什麼都不做；只有「變成看不見」才補送，變回看得見不補。
// 無視窗的瀏覽器裡頁面永遠是 visible，所以覆寫 document.hidden／visibilityState 再派 visibilitychange 來模擬（同 verify_metro_wait_start），
// pagehide 直接派在 window。量的是「送出的時間」：補送 < 1 秒、去抖要 2 秒，兩者分得開。
{
  const { ctx, page } = await open({ bridge: true, seed: { 'trainmap-checkins-v1': JSON.stringify(CHECKINS_A) }, tag: 'V' });
  const first = await waitPush(page, 0, 8000);
  ok('V 開機有推送', !!first);
  if (first) {
    await sleep(3300); // 開機那次的排程走完：此刻沒有排程中的推送
    await page.evaluate(() => {
      window.__fire = via => {
        const t0 = Date.now();
        if (via === 'pagehide') { window.dispatchEvent(new Event('pagehide')); return t0; }
        const hidden = via === 'hidden';
        Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        delete document.hidden; delete document.visibilityState; // 還原成瀏覽器自己的值（不再派 visible 事件，免得別的功能被驚動）
        return t0;
      };
    });
    const stamp = (name, via) => page.evaluate(({ name, via }) => { writeCheckin({ sys: 'tra_sched', name }, 'visit'); return window.__fire(via); }, { name, via }); // 蓋章＝排程 2 秒去抖，同一個 evaluate 內立刻觸發
    // 直接改 storage、不通知排程：內容真的變了（n +1），但沒有任何推送在排程中
    const silent = name => page.evaluate(name => {
      const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
      c.st['tra_sched|' + name] = { name, sys: 'tra_sched', s: 'visit', n: 1, d: '2026-09-28', u: Date.now() };
      localStorage.setItem('trainmap-checkins-v1', JSON.stringify(c));
    }, name);
    let before = await count(page), got, nExp = N_A;
    // 0 開機那次的排程已經走完（計時器觸發過）：此刻 hidden 不送。內容其實變了，所以「沒送」不是因為內容沒變
    await silent('三貂嶺'); nExp++;
    await page.evaluate(() => window.__fire('hidden'));
    await sleep(1200);
    ok('V 排程已走完、沒有排程中的推送時 hidden → 不送（內容其實變了，只是沒人通知）', (await count(page)) === before, `${before} → ${await count(page)}`);
    // 1 有排程時變成看不見 → 立刻送（< 1 秒，不等 2 秒去抖），內容是新的（含上一步悄悄改的那筆）
    let t0 = await stamp('瑞芳', 'hidden'); nExp++;
    got = await waitPush(page, before, 1800);
    ok('V 有排程中的推送時 visibilitychange → hidden：1 秒內就送出新的一包（不等 2 秒去抖）', !!got && got.t - t0 < 1000, got ? `${got.t - t0}ms` : '1.8 秒內沒有送');
    ok('V 補送的內容是新的（n＝蓋章後、最近蓋章第一筆是剛蓋的瑞芳）', !!got && got.payload.n === nExp && got.payload.recent[0].name === '瑞芳', got ? `n=${got.payload.n}/${nExp} 第一筆=${got.payload.recent[0].name}` : '');
    before = await count(page);
    // 2 補送過後排程已清掉：再次 hidden 不送（補送沒清掉排程旗標的話，這裡會把下面悄悄改的內容送出去）
    await silent('平溪'); nExp++;
    await page.evaluate(() => window.__fire('hidden'));
    await sleep(1200);
    ok('V 補送過後沒有排程了：再次 hidden → 不送', (await count(page)) === before, `${before} → ${await count(page)}`);
    // 對照：同一個變更，正常通知（事件＋去抖）會送出來——證明上一格的「沒送」不是內容沒變
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('rail-user-data-changed', { detail: { source: 'remote' } })));
    got = await waitPush(page, before, 3500);
    ok('V 對照：同一個變更經正常通知（事件＋2 秒去抖）會送出，n 多 1', !!got && got.payload.n === nExp, got ? `n=${got.payload.n}/${nExp}，${got.waited}ms` : '沒有送');
    before = await count(page);
    // 3 pagehide 也補送
    t0 = await stamp('十分', 'pagehide'); nExp++;
    got = await waitPush(page, before, 1800);
    ok('V 有排程中的推送時 pagehide：1 秒內就送出新的一包，內容是新的', !!got && got.t - t0 < 1000 && got.payload.n === nExp && got.payload.recent[0].name === '十分', got ? `${got.t - t0}ms n=${got.payload.n}/${nExp} 第一筆=${got.payload.recent[0].name}` : '1.8 秒內沒有送');
    before = await count(page);
    // 4 變回看得見（visible）不補送：有排程時派 visible，0.9 秒內不送；之後照常等去抖送出
    t0 = await stamp('菁桐', 'visible'); nExp++;
    await sleep(900);
    ok('V 變回看得見（visible）不補送：排程中的推送要等去抖', (await count(page)) === before, `${before} → ${await count(page)}`);
    got = await waitPush(page, before, 3500);
    ok('V visible 之後排程照常由去抖送出（約 2 秒）', !!got && got.t - t0 >= 1500 && got.payload.n === nExp, got ? `${got.t - t0}ms n=${got.payload.n}/${nExp}` : '沒有送');
  }
  await ctx.close();
}

await finish();

async function finish() {
  await browser.close();
  server.close();
  ok('Z 全程零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const pass = R.filter(x => x.p).length;
  console.log(`\n${pass}/${R.length} 通過（引擎 ${ENGINE}）`);
  process.exit(pass === R.length ? 0 : 1);
}
