#!/usr/bin/env node
// 驗「車站收集」桌面小工具的網頁端 payload（資料格式 v1，契約在
// docs/superpowers/plans/2026-09-29-車站收集小工具.md 最後一節）。
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
//   J   空收集：total＝geojson 獨立重算（09-29 為 538）、n＝0、recent 空、點全灰
//   A   開機推送：欄位名稱／型別逐欄符合契約；n＝護照函式；total／各系統 v／n／recent 順序／點陣與獨立重算一致
//   B   完乘寫入（saveRides）→ 3 秒內新一包；follow→s=1
//   C   打卡寫入（writeCheckin，含捷運同名併鍵）→ 3 秒內新一包
//   D   rail-user-data-changed（帳號同步合併）→ 3 秒內新一包
//   E   切換語言（en／ja／zh-TW）→ 各 3 秒內新一包，label／lang 隨語言
//   F   內容沒變不重送（事件重發、saveRides 同內容）
//   G   userDataRenderAll（登出／換帳號的落點）→ 3 秒內新一包
//   H   純網站（沒有 bridge）：零 geojson 請求、不註冊 listener、不留 schedule；對照 App 形態確實請求且多註冊 1 個
//   I   開機落在捷運群組（state.schedStations 是 []）：total 仍＝清單座數，別名站不會多出來
//   K   資料一致性：清單去別名後，台鐵站名全都在班表站名裡（別名表沒漏、沒錯）
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

function expectPayload(coll, lang) {
  const per = ORDER.map(() => new Map());
  for (const f of GEO.features) {
    const k = K_OF_GEO[f.properties.sys]; if (!k) continue;
    const i = ORDER.indexOf(k), ck = CK_OF(k), key = ck + '|' + normName(ck, f.properties.name);
    if (per[i].has(key)) continue;
    const [lon, lat] = f.geometry.coordinates;
    per[i].set(key, { name: normName(ck, f.properties.name), x: Math.round((lon - 120.15) / (122.0 - 120.15) * 1000), y: Math.round((25.27 - lat) / (25.27 - 22.2) * 1000), color: f.properties.color, lineId: f.properties.lineId });
  }
  const sys = ORDER.map((k, i) => ({ k, label: LABEL[lang][i], v: [...per[i].keys()].filter(x => coll.has(x)).length, n: per[i].size })).filter(s => s.n);
  const pts = [];
  ORDER.forEach((k, i) => { if (!per[i].size) return; per[i].forEach((pt, key) => pts.push([pt.x, pt.y, pt.color, STATUS_S[(coll.get(key) || {}).s] || 0, sys.findIndex(s => s.k === k)])); });
  const all = new Set([...per.flatMap(m => [...m.keys()]), ...coll.keys()]);
  const cmp = (a, b) => (a[1].d < b[1].d ? 1 : a[1].d > b[1].d ? -1 : 0) || b[1].n - a[1].n || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const recent = [...coll.entries()].filter(([, v]) => v.d).sort(cmp).slice(0, 4).map(([key, v]) => {
    const i = per.findIndex(m => m.has(key)), hit = i >= 0 ? per[i].get(key) : null;
    const k = i >= 0 ? ORDER[i] : ORDER.find(o => CK_OF(o) === v.sys) || 'tra';
    const geoSys = GEO_OF[k];
    let line = LABEL[lang][ORDER.indexOf(k)];
    if (hit) {
      const base = stripParen(LINES.get(`${geoSys}|${hit.lineId}`));
      if (base) line = lang === 'zh-TW' ? base : ((CATALOG.routes[geoSys] || {})[base]?.[lang] ? foreign(CATALOG.routes[geoSys][base][lang]) : (MESSAGES[lang]?.[base] ?? base));
    }
    const row = hit ? catRow(geoSys, v.name) : null;
    return { name: lang === 'zh-TW' || !row || !row[lang] ? v.name : foreign(row[lang]), line, k, d: v.d };
  });
  return { n: coll.size, total: all.size, sys, pts, recent, listSizes: Object.fromEntries(ORDER.map((k, i) => [k, per[i].size])) };
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
  if (!Array.isArray(p.recent) || p.recent.length > 4) bad.push('recent 超過 4 筆或不是陣列');
  for (const r of p.recent || []) {
    if (keys(r) !== 'd,k,line,name') bad.push(`recent 項欄位 ${keys(r)}`);
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
async function open({ bridge, seed = {}, query = '?gltracks=0', tag }) {
  // locale 固定 zh-TW：App 形態下頁面語言吃 navigator.languages（headless 預設 en-US），不釘住開機語言會是 en
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  await ctx.addInitScript(({ bridge, seed }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }
    window.__listen = {};
    const add = window.addEventListener.bind(window);
    window.addEventListener = function (type, ...rest) { window.__listen[type] = (window.__listen[type] || 0) + 1; return add(type, ...rest); };
    window.__pushes = [];
    if (bridge) {
      // App 形態：Capacitor 判定為原生＋桌面小工具橋接（純網站沒有 window.RAIL_NATIVE_COLLECTION）
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      window.RAIL_NATIVE_COLLECTION = { sync(json) { window.__pushes.push({ t: Date.now(), type: typeof json, json }); return Promise.resolve(); } };
    }
  }, { bridge, seed });
  const page = await ctx.newPage();
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
  await checkPayload(page, id, got.payload, lang, expectN, note);
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
  ok(`${id} recent 順序與內容 ＝ 獨立重算（d 新到舊、同日 n 多到少）`, JSON.stringify(p.recent) === JSON.stringify(exp.recent), JSON.stringify(p.recent) === JSON.stringify(exp.recent) ? p.recent.map(r => r.name).join('/') : `${JSON.stringify(p.recent)}\n     期望 ${JSON.stringify(exp.recent)}`);
  ok(`${id} pts 數量與每點 x／y／色／s／sysIdx ＝ 獨立重算`, JSON.stringify(p.pts) === JSON.stringify(exp.pts), `${p.pts.length} 點` + (JSON.stringify(p.pts) === JSON.stringify(exp.pts) ? '' : ` 首個差異 ${p.pts.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(exp.pts[i]))}`));
  const direct = await page.evaluate(() => { const q = collectionWidgetPayload(); if (q) q.at = 0; return q; });
  const pushed = { ...p, at: 0 };
  ok(`${id} 直接呼叫 collectionWidgetPayload() ＝ 剛推送的內容（不含 at）`, JSON.stringify(direct) === JSON.stringify(pushed));
  return exp;
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
const EMPTY0 = expectPayload(new Map(), 'zh-TW');
const TOTAL0 = EMPTY0.total, PTS0 = EMPTY0.pts.length, TRA0 = EMPTY0.listSizes.tra;

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
let appListen = 0, appGeoReqs = 0;
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
  ok('A 手算：recent ＝ 不存在捷運站、紅樹林、台北車站、花蓮（同日 n 多者在前，兩對都是）', JSON.stringify(p0.recent.map(r => r.name)) === JSON.stringify(['不存在捷運站', '紅樹林', '台北車站', '花蓮']), p0.recent.map(r => r.name).join('/'));
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
    ok('B recent ＝ 09-27 四站（高鐵台中、台北、三貂嶺、菁桐）', JSON.stringify(got.payload.recent.map(r => r.name + '@' + r.k)) === JSON.stringify(['台中@thsr', '台北@thsr', '三貂嶺@tra', '菁桐@tra']), got.payload.recent.map(r => r.name + '@' + r.k).join('/'));
    ok('B 菁桐的線名是「平溪線」、不是代碼 PINGXI', got.payload.recent[3].line === '平溪線', got.payload.recent[3].line);
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
  const st = await page.evaluate(() => ({ sched: nativeCollectionSchedule, bridge: typeof window.RAIL_NATIVE_COLLECTION, geo: NATIVE_COLLECTION.geo, geoP: NATIVE_COLLECTION.geoP, listen: window.__listen['rail-user-data-changed'] || 0 }));
  ok('H 純網站：沒有 bridge、schedule 是 null、沒快取 geojson', st.bridge === 'undefined' && st.sched === null && st.geo === null && st.geoP === null, JSON.stringify(st));
  ok('H 純網站：不註冊 rail-user-data-changed listener（App 形態恰好多 1 個）', appListen - st.listen === 1, `App ${appListen} − 網站 ${st.listen}`);
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

await finish();

async function finish() {
  await browser.close();
  server.close();
  ok('Z 全程零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const pass = R.filter(x => x.p).length;
  console.log(`\n${pass}/${R.length} 通過（引擎 ${ENGINE}）`);
  process.exit(pass === R.length ? 0 : 1);
}
