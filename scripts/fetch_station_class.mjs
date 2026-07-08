#!/usr/bin/env node
// 抓台鐵車站「站等」(特等/一等/二等/三等/簡易/招呼…) → data/tra_station_class.json
// 來源:維基百科「臺灣鐵路車站列表」表格(官方 OpenData 車站基本資料集無站等欄位,
// TDX 有 StationClass 但需金鑰;此處取維基就不用金鑰)。
// 表格列結構:<td>里程</td><td>等級</td><td>站碼(4碼)</td><td><a>站名</a></td>…
// 只保留站名能對上 data/tra_schedule_dense.json 的站(自動過濾廢站/貨運站)。
import { readFileSync, writeFileSync } from 'node:fs';

const URL = 'https://zh.wikipedia.org/wiki/%E8%87%BA%E7%81%A3%E9%90%B5%E8%B7%AF%E8%BB%8A%E7%AB%99%E5%88%97%E8%A1%A8';
const CLS_RE = /^(特等|一等|二等|三等|甲簡|乙簡|簡易|招呼|號誌)/;
const norm = n => n.replace(/台/g, '臺');

const html = await (await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();

const ours = new Set();
for (const tr of JSON.parse(readFileSync('data/tra_schedule_dense.json', 'utf8')).trains)
  for (const s of tr.stops) ours.add(norm(s.name));

// 站名比對:兩邊都去掉括號註記後比(如資料的「新城 (太魯閣)」vs 維基「新城」),
// 寫出時用資料檔的原名,前端才查得到
const stripParen = n => norm(n).split(/[（(]/)[0].trim();
const canon = new Map();
for (const n of ours) canon.set(stripParen(n), n);

const strip = s => s.replace(/<[^>]*>/g, '').replace(/&#\d+;|&[a-z]+;/g, '').trim();
const out = {};
let rows = 0;
const trRows = html.split('<tr>').slice(1).map(row => row.split(/<td[^>]*>/).slice(1).map(strip));
for (let r = 0; r < trRows.length; r++) {
  const cells = trRows[r];
  for (let i = 0; i < cells.length - 2; i++) {
    const m = CLS_RE.exec(cells[i]);
    if (!m || !/^\d{4}$/.test(cells[i + 1])) continue;
    // 一般列:等級/站碼後面就是站名;改名站的等級列是舊名(rowspan),現名在後續列開頭
    // (改名 N 次 rowspan=N+1,最後一列才是現名;掃到下一個帶站碼的列就停)
    const hasOwnCode = row => row.some((c, j) => CLS_RE.test(c) && /^\d{4}$/.test(row[j + 1] || ''));
    let key = canon.get(stripParen(cells[i + 2] || ''));
    for (let k = r + 1; !key && k <= r + 3 && trRows[k] && !hasOwnCode(trRows[k]); k++)
      key = canon.get(stripParen(trRows[k][0] || ''));
    if (!key) continue;
    out[key] = m[1];
    rows++;
    break;
  }
}
// 維基表格漏掉/對不上的重要車站人工覆蓋(只放高把握的)
const OVERRIDES = { '七堵': '一等' };
for (const [k, v] of Object.entries(OVERRIDES)) if (ours.has(k) && !out[k]) out[k] = v;

const dist = {};
Object.values(out).forEach(c => dist[c] = (dist[c] || 0) + 1);
console.log(`matched ${rows} stations; class dist:`, dist);
console.log('our stations without class:', [...ours].filter(n => !out[n]).join('、') || '(none)');
writeFileSync('data/tra_station_class.json', JSON.stringify(out), 'utf8');
console.log('wrote data/tra_station_class.json');
