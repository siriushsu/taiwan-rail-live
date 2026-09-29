#!/usr/bin/env node
// 產生 docs/i18n/tra_station_names.json(台鐵站名的中/英/日三語表)。
//
// 為什麼會有這支:這個檔在 2026-09-12 之前是**手工爬下來的、沒有產生腳本**——
// 檔頭把方法寫成散文留在 `_method` 欄位裡,等於「知識只存在註解裡」,下次要更新
// (例如平鎮臨時站通車)只能靠有人讀懂那段散文再手動重做一次。這支就是把那段散文
// 變成可執行的東西(judgment 九-10:跨 session 要一致的東西不要只寫成文字)。
//
// 日文為什麼非得從官網爬:**TDX 的 TRA Station 完全沒有 Ja 欄位**(v2/v3 皆然,
// 不是空值而是沒有這個欄位),所以日文只有台鐵官網時刻查詢頁這一個來源。
//
// 方法(官網把語言存在 session 裡,所以要兩段):
//   1. GET /tra-tip-web/tip?lang=<L>  建立 session
//   2. 同一個 cookie 再 GET 查詢頁,取內嵌的 availableTags 陣列(格式 "站碼-站名")
//
// 用法:
//   node scripts/fetch_tra_station_names.mjs          # 抓取並比對,**不寫檔**
//   node scripts/fetch_tra_station_names.mjs --write  # 差異確認過了才寫回
// 離開碼:0=與現有檔一致 10=有差異(要人看過才寫) 1=抓取/解析失敗
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/i18n/tra_station_names.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const BASE = 'https://www.railway.gov.tw/tra-tip-web';
const LANGS = { zh: 'ZH_TW', en: 'EN_US', ja: 'JA_JP' };
const WRITE = process.argv.includes('--write');

// 正向對照:抓回來的表必須看得到這幾站,否則就是頁面改版/被擋,而不是「台鐵少了幾站」。
// 少了這道,解析失敗會長得跟「官方真的移除了站」一模一樣(judgment 八:陰性結果不可信)。
const CONTROL = { 1000: '臺北', 1100: '中壢', 1110: '埔心', 4400: '高雄' };
const MIN_STATIONS = 200;

async function tagsFor(lang) {
  // 第一段:建 session。語言存在 session,不是存在 query 裡,所以這一段不能省。
  const r1 = await fetch(`${BASE}/tip?lang=${lang}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!r1.ok) throw new Error(`${lang} 建 session 失敗 HTTP ${r1.status}`);
  const cookie = (r1.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`${lang} 沒拿到 cookie(頁面可能改版)`);
  const r2 = await fetch(`${BASE}/tip/tip001/tip112/gobytime?lang=${lang}`,
    { headers: { 'user-agent': UA, cookie }, signal: AbortSignal.timeout(60000) });
  if (!r2.ok) throw new Error(`${lang} 取查詢頁失敗 HTTP ${r2.status}`);
  const html = await r2.text();
  const m = html.match(/availableTags\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error(`${lang} 頁面裡找不到 availableTags(頁面改版?)`);
  const out = {};
  for (const raw of m[1].split(',')) {
    const t = raw.trim().replace(/^['"]|['"]$/g, '');
    const i = t.indexOf('-');
    if (i < 0) continue;
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

async function tdxNames() {
  // tdx_zh/tdx_en 保留原檔就有的欄位:官網與 TDX 兩套值並存時要看得出來差在哪
  // (檔頭 _caveats 記著中壢 Zhongli_Taoyuan 那種消歧義寫法兩邊逐字相同)。
  const env = Object.fromEntries(readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
  const tok = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET }),
    signal: AbortSignal.timeout(60000),
  }).then(r => r.json());
  if (!tok.access_token) throw new Error('TDX 取 token 失敗');
  const r = await fetch('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Station?%24format=JSON',
    { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`TDX Station HTTP ${r.status}`);
  const j = await r.json();
  const rows = j.Stations || j;
  const out = {};
  for (const s of rows) out[s.StationID] = { zh: s.StationName?.Zh_tw, en: s.StationName?.En };
  return out;
}

const prev = JSON.parse(readFileSync(OUT, 'utf8'));
const [zh, en, ja, tdx] = await Promise.all([tagsFor(LANGS.zh), tagsFor(LANGS.en), tagsFor(LANGS.ja), tdxNames()]);

for (const [code, name] of Object.entries(CONTROL)) {
  if (zh[code] !== name) throw new Error(`正向對照未過:站碼 ${code} 預期「${name}」實得「${zh[code] ?? '(缺)'}」 — 判定抓取/解析故障,不當作台鐵少了站`);
}
if (Object.keys(zh).length < MIN_STATIONS) throw new Error(`正向對照未過:只解析到 ${Object.keys(zh).length} 站(需 ≥${MIN_STATIONS})`);

const stations = {};
for (const code of Object.keys(zh).sort()) {
  stations[code] = { zh: zh[code], en: en[code] ?? zh[code], ja: ja[code] ?? zh[code],
    tdx_zh: tdx[code]?.zh ?? null, tdx_en: tdx[code]?.en ?? null };
}
// `_caveats` 是人讀出來的結論(機翻殘留、官方換字、消歧義底線…),不是抓得回來的東西,
// 所以沿用舊檔那一份;有新結論要自己加,不要指望重抓會生出來。
const next = { _source: prev._source, _url: prev._url, _method: prev._method,
  _generator: 'scripts/fetch_tra_station_names.mjs',
  _fetched: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }),
  _count: Object.keys(stations).length, _caveats: prev._caveats, stations };

const pk = Object.keys(prev.stations), nk = Object.keys(stations);
const added = nk.filter(k => !pk.includes(k));
const removed = pk.filter(k => !nk.includes(k));
const changed = nk.filter(k => pk.includes(k) &&
  ['zh', 'en', 'ja', 'tdx_zh', 'tdx_en'].some(f => (prev.stations[k][f] ?? null) !== (stations[k][f] ?? null)));

console.log(`台鐵站名三語表:抓到 ${nk.length} 站(原 ${pk.length} 站),對照站 ${Object.keys(CONTROL).length}/${Object.keys(CONTROL).length} 命中`);
for (const k of added) console.log(`  ＋ ${k} ${stations[k].zh} / ${stations[k].en} / ${stations[k].ja}`);
for (const k of removed) console.log(`  － ${k} ${prev.stations[k].zh}`);
for (const k of changed) console.log(`  ~ ${k} ${stations[k].zh}:` +
  ['zh', 'en', 'ja', 'tdx_zh', 'tdx_en'].filter(f => (prev.stations[k][f] ?? null) !== (stations[k][f] ?? null))
    .map(f => ` ${f} 「${prev.stations[k][f] ?? '空'}」→「${stations[k][f] ?? '空'}」`).join(''));

const diff = added.length + removed.length + changed.length;
if (!diff) console.log('與現有檔完全一致(重抓可重現)');
if (WRITE) { writeFileSync(OUT, JSON.stringify(next, null, 1) + '\n'); console.log(`已寫入 ${path.relative(ROOT, OUT)}`); }
else if (diff) console.log('有差異,確認過再加旗標寫回');
process.exit(diff ? 10 : 0);
