#!/usr/bin/env node
// 產「跳站校正資料覆蓋明細」HTML：逐相鄰路段、逐車次各有多少實測撐著。
// 輸出的 HTML 不進版控（可重生），且被 .assetsignore／.gitignore 擋住不會上線。
// 用法：node scripts/report_pass_obs_coverage.mjs
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';
const R=join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const norm=s=>String(s||'').replace(/台/g,'臺').trim();
const m=JSON.parse(readFileSync(R+'data/tra_pass_obs_model.json','utf8'));
const o=JSON.parse(readFileSync(R+'data/tra_pass_obs.json','utf8'));
const diag=JSON.parse(readFileSync(R+'data/tra_pass_obs_diag.json','utf8')).trains;
const sched=JSON.parse(readFileSync(R+'data/tra_schedule_dense.json','utf8'));
// feed 站名
const feed=new Set();
for(const f of readdirSync(R+'.cache/tra_hist').filter(x=>x.endsWith('.jsonl.gz')).slice(-3))
  for(const ln of gunzipSync(readFileSync(R+'.cache/tra_hist/'+f)).toString('utf8').replace(/^﻿/,'').split('\n')){
    if(!ln)continue; try{feed.add(norm(JSON.parse(ln).StationName?.Zh_tw));}catch{} }
const ALIAS=new Map([['新城 (太魯閣)','新城']]);
const inFeed=n=>feed.has(ALIAS.get(n)??n);
// 站對 → 速度表樣本數（聚合 bt/cls）
const pairN=new Map();
for(const k in m.segs){ const [a,b]=k.split('|'); const kk=a+'→'+b;
  pairN.set(kk,(pairN.get(kk)||0)+m.segs[k][1]); }
// 全網相鄰站對（只算「快車會通過的」＝跑段內部段）
const pairs=new Map();   // A→B : {km,trains:Set,pass:bool}
const rows=[]; const seenTr=new Set();   // 車次層（同號變體只算一次，與 build 一致）
for(const t of sched.trains){
  const s=t.stops, names=s.map(x=>norm(x.name));
  if(!s.some(x=>x.stop===false)) continue;
  if(seenTr.has(t.train)) continue; seenTr.add(t.train);
  let nA=0,nB=0,nNone=0,dSum=0;
  for(let i=1;i<s.length-1;i++){
    if(s[i].stop!==false) continue;
    const fA=m.trains_layerA?.[t.train]?.[names[i]], fO=o.trains?.[t.train]?.[names[i]];
    // 母體＝前端真的會查的槽位；判「有值」一律看產物（第一層算出後可能被最終速度清洗刪掉）
    if(fO==null){nNone++;continue;}
    if(fA!=null){nA++; const d=diag?.[t.train]?.[names[i]]; if(d)dSum+=d[1];} else nB++;
  }
  for(let i=0;i<s.length-1;i++){
    const kk=names[i]+'→'+names[i+1];
    if(!pairs.has(kk)) pairs.set(kk,{trains:new Set(),ends:inFeed(names[i])&&inFeed(names[i+1])});
    pairs.get(kk).trains.add(t.train);
  }
  if(nA+nB+nNone>0) rows.push({tr:t.train,ty:t.typeName||'',car:t.carName||'',
    a:nA,b:nB,none:nNone,days:nA?Math.round(dSum/nA*10)/10:0,
    head:names[0],tail:names[names.length-1]});
}
const pr=[...pairs.entries()].map(([k,v])=>({k,n:pairN.get(k)||0,tr:v.trains.size,ends:v.ends}))
  .sort((a,b)=>b.n-a.n||a.k.localeCompare(b.k));
const cov=pr.filter(x=>x.n>0).length;
rows.sort((a,b)=>(b.none-a.none)||(b.a+b.b)-(a.a+a.b));
const tot=rows.reduce((s,r)=>({a:s.a+r.a,b:s.b+r.b,n:s.n+r.none}),{a:0,b:0,n:0});
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const H=`<!doctype html><meta charset="utf-8"><title>軌島 · 跳站校正資料覆蓋明細</title>
<style>
:root{--bg:#0f1216;--fg:#e8eaed;--dim:#9aa3ad;--line:#242a31;--ok:#4ade80;--mid:#fbbf24;--no:#f87171}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"PingFang TC","Noto Sans TC",sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 6px}
.c{background:#171b21;border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}
.c b{display:block;font-size:20px;font-weight:600}.c span{color:var(--dim);font-size:11px}
input{width:100%;max-width:340px;padding:7px 10px;background:#171b21;border:1px solid var(--line);border-radius:6px;color:var(--fg);font:inherit;margin:6px 0 10px}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--dim);font-weight:500;position:sticky;top:0;background:var(--bg)}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok)}.mid{color:var(--mid)}.no{color:var(--no)}
.wrap{max-height:60vh;overflow:auto;border:1px solid var(--line);border-radius:8px}
.note{color:var(--dim);font-size:12px;margin:8px 0 0}
</style>
<h1>跳站校正 · 資料覆蓋明細</h1>
<div class="sub">資料源 TDX Historical LiveTrainDelay，${m.dates?.length ?? '59'} 個營運日（${m.dates?.[0]}～${m.dates?.[m.dates.length-1]}）／產出 ${new Date(m.built_at||Date.now()).toISOString().slice(0,16).replace('T',' ')} UTC</div>
<div class="cards">
<div class="c"><b class="ok">${tot.a}</b><span>第一層：這班車自己的實測</span></div>
<div class="c"><b class="mid">${tot.b}</b><span>第二層：同路段其他車次的實測</span></div>
<div class="c"><b class="no">${tot.n}</b><span>無資料（官方不回報該站）</span></div>
<div class="c"><b>${(100*(tot.a+tot.b)/(tot.a+tot.b+tot.n)).toFixed(1)}%</b><span>通過站覆蓋率</span></div>
<div class="c"><b>${cov}/${pr.length}</b><span>相鄰路段有實測速度</span></div>
</div>
<h2>逐路段（相鄰兩站之間）</h2>
<div class="note">「實測筆數」＝這段路在 59 天內被幾筆「車次×日」的觀測量到過（降序，0 筆的排在最後）。
0 筆＝兩端至少有一站不在官方回報名單內。<br>
<b>為什麼路段只有 45% 有實測、通過站卻有 88% 有資料？</b>因為一個跑段（兩個停靠站之間）通常橫跨好幾個小段，
只要其中幾段量到了，就能推出這班車在這段路的實際速度水準，再分配給沒量到的小段——
不需要每一小段都被直接量過。完全沒有任何一段量到的跑段才會落到「無資料」，維持原本的加減速曲線推算。</div>
<input id="q1" placeholder="搜尋站名，例如「浮洲」或「臺北→板橋」">
<div class="wrap"><table id="t1"><thead><tr><th>路段</th><th class="n">實測筆數</th><th class="n">經過車次</th><th>兩端是否都在官方回報名單</th></tr></thead><tbody>
${pr.map(x=>`<tr><td>${esc(x.k)}</td><td class="n ${x.n>0?'ok':'no'}">${x.n}</td><td class="n">${x.tr}</td><td class="${x.ends?'ok':'no'}">${x.ends?'是':'否'}</td></tr>`).join('\n')}
</tbody></table></div>
<h2>逐車次（有通過站的快車）</h2>
<div class="note">「平均天數」＝第一層節點背後平均有幾天的實際到站紀錄。</div>
<input id="q2" placeholder="搜尋車次或站名，例如「281」或「自強」">
<div class="wrap"><table id="t2"><thead><tr><th>車次</th><th>車種</th><th>區間</th><th class="n">自己的實測</th><th class="n">平均天數</th><th class="n">同路段推估</th><th class="n">無資料</th></tr></thead><tbody>
${rows.map(r=>`<tr><td>${esc(r.tr)}</td><td>${esc(r.ty)}</td><td>${esc(r.head)}→${esc(r.tail)}</td><td class="n ok">${r.a}</td><td class="n">${r.days||''}</td><td class="n mid">${r.b}</td><td class="n ${r.none?'no':''}">${r.none||''}</td></tr>`).join('\n')}
</tbody></table></div>
<script>
for (const [qi,ti] of [['q1','t1'],['q2','t2']]) {
  const q=document.getElementById(qi), rows=[...document.getElementById(ti).tBodies[0].rows];
  q.addEventListener('input',()=>{const v=q.value.trim();
    for(const r of rows) r.hidden = v && !r.textContent.includes(v);});
}
</script>`;
const out=R+'研究_跳站校正覆蓋明細_2026-07-26.html';
writeFileSync(out,H);
console.log('路段', pr.length, '有實測', cov, `(${(100*cov/pr.length).toFixed(1)}%)`);
console.log('通過站槽位 A',tot.a,'B',tot.b,'無',tot.n, `覆蓋 ${(100*(tot.a+tot.b)/(tot.a+tot.b+tot.n)).toFixed(1)}%`);
console.log('零實測路段前 12:', pr.filter(x=>x.n===0).slice(0,12).map(x=>x.k).join('  '));
console.log('→', out);
