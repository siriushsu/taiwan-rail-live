// 機捷「指定日期」官網各站時刻表 vs 網站那天會選到的班表，逐站逐筆比對。
// 用途：連假、補假、活動疏運前先跑，提早知道哪一天網站跟官方對不上（TDX 只有平日/假日兩種，
// 特定日期的例外只有官網查得到）。對不上的日子照官方字面寫進 data/special_ops.json。
//
// 用法：
//   node scripts/check_tymc_official_dates.mjs 2026-10-11 2026-10-26      指定日期
//   node scripts/check_tymc_official_dates.mjs --special=30               往後 30 天內的特殊日
//        （國定假日/補假、special_ops 例外日，外加最近一個一般平日與一般週末當對照組）
//   加 --detail 印出每站差在哪幾班
// 結束碼：0＝比到的日子全部逐筆相同（官網還沒資料的日子只提示、不算失敗）；1＝有日子對不上；2＝抓取失敗
//
// 比法：官網是出發時刻表（終點站沒有時刻），所以只比每站「出發」紀錄的時分，不比車種；
// 網站挑班表的規則照 index.html prepFreqTimes()：dates 例外 > 國定假日/補班 > 星期幾。
// 官網查詢流程：先開一頁拿 session，每一站之前都要重 POST 一次日期（session 裡的日期只管一頁），
// 抓完核對頁面上的 timetable_date 真的是要的那天。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const B = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide';
const ORDER = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14a', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22'];
const CLS = { des01: '直', des02: '★', des03: '普', des04: '▲', des05: '◆', des06: '■', des07: '○' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hm = s => { s = ((s % 86400) + 86400) % 86400; return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0'); };
const WD = '日一二三四五六';
const wd = d => new Date(d + 'T00:00:00Z').getUTCDay();
const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ---- 官網抓取（自帶 cookie jar，手動跟 redirect 才收得到中途的 Set-Cookie）----
function jar() {
  const c = new Map();
  const req = async (url, opt = {}) => {
    for (let hop = 0; hop < 6; hop++) {
      const r = await fetch(url, { ...opt, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0', ...(opt.headers || {}), Cookie: [...c].map(([k, v]) => `${k}=${v}`).join('; ') }, signal: AbortSignal.timeout(30000) });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).href; opt = { method: 'GET' }; continue; }
      if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
      return r.text();
    }
    throw new Error(`${url} redirect 太多次`);
  };
  return req;
}

function parseStation(html) {
  const date = (html.match(/id="timetable_date"[^>]*value="([^"]+)"/) || [])[1];
  const res = { date, S: [], N: [] };
  for (const [, body] of html.matchAll(/<table[^>]*class="time-table"[^>]*>([\s\S]*?)<\/table>/g)) {
    const header = ((body.match(/<th scope="col" colspan="8">([^<]*)<\/th>/) || [])[1] || '').trim();
    const k = /中壢|老街溪/.test(header) ? 'S' : /台北車站/.test(header) ? 'N' : null;   // 'S'＝往老街溪、'N'＝往台北車站
    if (!k) continue;
    for (const [, hh, row] of body.matchAll(/<tr>\s*<th scope="row">(\d\d)<\/th>([\s\S]*?)<\/tr>/g)) {
      for (const [, cell] of row.matchAll(/<td>([\s\S]*?)<\/td>/g)) {
        const m = cell.match(/<span class="([^"]*)"[^>]*>\s*<i[^>]*>(\d\d)<\/i>/);
        if (m) res[k].push({ t: `${hh}:${m[2]}`, cls: (m[1].match(/des0\d/g) || []).map(c => CLS[c] || c).join('+') || m[1] });
      }
    }
  }
  return res;
}

async function fetchOfficial(date) {
  const req = jar(), out = {};
  await req(`${B}/timetable-A1`);
  for (const st of ORDER) {
    await req(`${B}/station-timetable-date.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `date=${date}` });
    const r = parseStation(await req(`${B}/timetable-${st}`));
    if (r.date !== date) throw new Error(`${date} ${st} 頁面日期是 ${r.date || '無'}（查詢日期沒生效）`);
    out[st] = r;
    await sleep(300);
  }
  return out;
}

// ---- 網站那天會選的班表（照 index.html prepFreqTimes 的挑法）----
const T = J('data/tymc_times.json').lines.A;
const DT = J('data/tw_daytype.json');
function siteSet(date) {
  const dt = DT[date];
  let day = dt === 1 ? (T.holiday || T.days[0]) : dt === 2 ? T.days[1] : T.days[wd(date)];
  if (T.dates && T.dates[date] && T.sets[T.dates[date]]) day = T.dates[date];
  return day;
}
function siteDeps(day) {
  const m = {};
  for (const tr of T.sets[day]) {
    const asc = tr[tr.length - 2] > tr[0];
    for (let j = 0; j < tr.length - 2; j += 2) (m[ORDER[tr[j]] + (asc ? 'S' : 'N')] ||= []).push(hm(tr[j + 1]));
  }
  return m;
}

function compare(date, off) {
  const day = siteSet(date), site = siteDeps(day);
  let nOff = 0, nSite = 0; const onlyOff = {}, lines = []; let nOnlySite = 0;
  for (const st of ORDER) for (const k of ['S', 'N']) {
    const o = off[st][k], pool = {};
    for (const t of site[st + k] || []) pool[t] = (pool[t] || 0) + 1;
    nOff += o.length; nSite += (site[st + k] || []).length;
    const oo = [];
    for (const x of o) { if (pool[x.t]) pool[x.t]--; else { oo.push(x.t + x.cls); onlyOff[x.cls] = (onlyOff[x.cls] || 0) + 1; } }
    const ss = Object.entries(pool).flatMap(([t, c]) => Array(c).fill(t)).sort();
    nOnlySite += ss.length;
    if (oo.length || ss.length) lines.push(`    ${st}${k === 'S' ? '往老街溪' : '往台北'} 官網獨有[${oo.sort().slice(0, 10).join(' ')}${oo.length > 10 ? ` …共${oo.length}` : ''}] 網站獨有[${ss.slice(0, 10).join(' ')}${ss.length > 10 ? ` …共${ss.length}` : ''}]`);
  }
  const nOnlyOff = Object.values(onlyOff).reduce((a, b) => a + b, 0);
  return { day, nOff, nSite, onlyOff, nOnlyOff, nOnlySite, lines, same: nOnlyOff + nOnlySite === 0 };
}

// ---- 要查哪幾天 ----
const args = process.argv.slice(2), DETAIL = args.includes('--detail');
let dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const sp = args.find(a => a.startsWith('--special='));
if (sp) {
  const n = Number(sp.split('=')[1]), today = taipeiToday(), want = new Set(), why = {}, seen = new Set();
  // special_ops 改版區間(有 from 的 op)指過去的 set 整段每天都在 dates 裡,不是單日例外:同一版只查第一天
  const RANGE = new Set((J('data/special_ops.json').ops || []).filter(o => o.from && o.out === 'data/tymc_times.json').flatMap(o => Object.values(o.lines?.A?.replace || {})));
  let plainWd = null, plainWe = null;
  for (let i = 0; i <= n; i++) {
    const d = addDays(today, i);
    if (DT[d]) { want.add(d); why[d] = DT[d] === 1 ? '國定假日/補假' : '補班'; }
    else if (T.dates && T.dates[d] && !RANGE.has(T.dates[d])) { want.add(d); why[d] = `例外「${T.dates[d]}」`; }
    else if (T.dates && RANGE.has(T.dates[d])) { if (!seen.has(T.dates[d])) { seen.add(T.dates[d]); want.add(d); why[d] = `改版「${T.dates[d]}」(同版只查第一天)`; } }
    else if (!plainWd && wd(d) >= 1 && wd(d) <= 5) { plainWd = d; want.add(d); why[d] = '對照：一般平日'; }
    else if (!plainWe && (wd(d) === 0 || wd(d) === 6)) { plainWe = d; want.add(d); why[d] = '對照：一般週末'; }
  }
  dates = [...new Set([...dates, ...[...want].sort()])];
  console.log(`往後 ${n} 天要查的日子：${dates.map(d => `${d}(${why[d] || '指定'})`).join('、')}`);
}
if (!dates.length) { console.error('用法：node scripts/check_tymc_official_dates.mjs YYYY-MM-DD … ｜ --special=天數 [--detail]'); process.exit(2); }

let bad = 0, fetchErr = 0, compared = 0;
for (const d of dates) {
  let off;
  try { off = await fetchOfficial(d); }
  catch (e) { fetchErr++; console.log(`✗ ${d} 抓取失敗：${e.message}`); continue; }
  const total = ORDER.reduce((a, st) => a + off[st].S.length + off[st].N.length, 0);
  if (!total) { console.log(`… ${d}(${WD[wd(d)]}) 官網這天還沒有時刻表資料（查得到的範圍外），之後再查`); continue; }
  const r = compare(d, off); compared++;
  if (!r.same) bad++;
  console.log(`${r.same ? '✓' : '✗'} ${d}(${WD[wd(d)]}) 網站用「${r.day}」：官網 ${r.nOff} 筆、網站 ${r.nSite} 筆；官網獨有 ${r.nOnlyOff}${r.nOnlyOff ? ' ' + JSON.stringify(r.onlyOff) : ''}、網站獨有 ${r.nOnlySite}${r.same ? '  逐筆相同' : ''}`);
  if (DETAIL && r.lines.length) console.log(r.lines.join('\n'));
}
console.log(`\n比對 ${compared} 天：對不上 ${bad} 天${fetchErr ? `、抓取失敗 ${fetchErr} 天` : ''}`);
process.exit(fetchErr ? 2 : bad ? 1 : 0);
