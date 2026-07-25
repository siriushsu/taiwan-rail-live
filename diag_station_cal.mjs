// 逐站 first 偏差診斷：站級偏差是量測問題還是地理特性？順便驗「停靠 vs 短停」型態依賴
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadObs, CACHE, norm, med } from './scripts/build_pass_obs.mjs';
const dates = readdirSync(CACHE).filter(f => f.endsWith('.jsonl.gz')).map(f => f.slice(0, 10)).sort();
const ob = loadObs(dates), have = dates.filter(d => ob[d]);
const sched = JSON.parse(readFileSync('data/tra_schedule_dense.json', 'utf8'));
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * b.length)]; };
const byStation = {};                    // st -> {short:[], long:[]}
for (const t of sched.trains) for (const d of have) {
  const T = ob[d][t.train]; if (!T) continue;
  const any = Object.values(T)[0]; if (!any) continue;
  const day0 = Math.floor((any.first + 8 * 3600) / 86400) * 86400 - 8 * 3600;
  for (const s of t.stops) {
    if (s.stop === false) continue;
    const st = norm(s.name), e = T[st]; if (!e) continue;
    if (e.last - e.first > 240 || e.n >= 5) continue;              // 與生產同一道板窗守門
    const off = e.first - (day0 + s.arrSec + e.dlyFirst * 60);
    if (Math.abs(off) > 600) continue;
    const g = byStation[st] || (byStation[st] = { short: [], long: [] });
    (s.depSec - s.arrSec <= 60 ? g.short : g.long).push(off);
  }
}
const all = [], stMed = [], typeDiff = [], rows = [];
for (const st in byStation) {
  const g = byStation[st], both = [...g.short, ...g.long];
  all.push(...both);
  if (both.length >= 20) { stMed.push(med(both)); rows.push([st, both.length, Math.round(med(both)), g.short.length >= 10 && g.long.length >= 10 ? Math.round(med(g.short) - med(g.long)) : null]); }
  if (g.short.length >= 10 && g.long.length >= 10) typeDiff.push(med(g.short) - med(g.long));
}
console.log(`全網 first 偏差：n=${all.length} 中位 ${med(all)}s（生產用的單一常數）`);
console.log(`站級中位偏差（≥20 樣本的 ${stMed.length} 站）：p10 ${q(stMed, .1)} 中位 ${q(stMed, .5)} p90 ${q(stMed, .9)}s；|偏差|>30s 的站 ${stMed.filter(x => Math.abs(x) > 30).length}`);
console.log(`型態依賴（同站短停 − 長停,${typeDiff.length} 站）：中位 ${med(typeDiff).toFixed(0)}s p10 ${q(typeDiff, .1).toFixed(0)} p90 ${q(typeDiff, .9).toFixed(0)}s`);
rows.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
console.log('偏差最大的 10 站 [站,n,站級偏差,短停−長停]:'); for (const r of rows.slice(0, 10)) console.log('  ', JSON.stringify(r));
