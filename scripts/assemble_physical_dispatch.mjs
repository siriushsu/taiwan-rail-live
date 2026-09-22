import fs from 'node:fs';import path from 'node:path';import {physicalStopSignature} from '../rail-3d/physical/motion.js';
import {attachThsrRunProfiles,thsrProfileFingerprint} from './lib/thsr_run_profiles.mjs';
const allowYield=process.argv.includes('--allow-visual-yield'),inputs=process.argv.slice(2).filter(s=>s!=='--allow-visual-yield');if(!inputs.length)throw Error('必須指定驗證通過的派車結果');const plans={},handoffs=[],sources=[],groups=[],trains=JSON.parse(fs.readFileSync('.cache/physical-tracks/timetable.json'));
// 高鐵派車必須是用瀏覽器同源的跑段曲線解的(見 lib/thsr_run_profiles.mjs):每份結果的 profileSha256 要對得上
// 聯集班表重算的指紋,否則等速內插解出來的待避會算在錯的時間點。同日班次分組(哪些班同一天跑)嵌進 dispatch.json,
// 出貨閘門 verify_thsr_reservation_motion.mjs 才能逐日型重算零交疊;日期來自 rebuild 寫的 timetable-thsr-days.json。
const thsr=trains.filter(t=>t.system==='thsr_sched');if(thsr.length)attachThsrRunProfiles(thsr);
let days=[];try{days=JSON.parse(fs.readFileSync('.cache/physical-tracks/timetable-thsr-days.json'));}catch{}
// 同一 id 在不同日型可能只差中途站時刻(聯集班表留第一個版本,當天的瀏覽器會以 retimed 綁上):
// 每份結果的指紋要對它自己解的那份日型班表算,不能對聯集算。
const dayTrains=name=>{const list=name&&fs.existsSync('.cache/physical-tracks/'+name)?JSON.parse(fs.readFileSync('.cache/physical-tracks/'+name)).filter(t=>t.system==='thsr_sched'):thsr;if(list!==thsr)attachThsrRunProfiles(list);return list;};
// 同一車次出現在多個日型:留「待避最多」的那一份。待避只為了解開當天的交會,沒解到的那天會是零;
// 取最後一個輸入(舊政策)會把別天需要的待避洗掉,那天在瀏覽器上就會交疊(2026-09-12 量到 9~66 個)。
// 平手時以來源檔名決勝,輸出才不隨參數順序改變。日型內各班「當天的到離站時刻」只在與聯集班表不同時記進
// groups[].stops,出貨閘門才能在沒有 .cache 的樹上重現瀏覽器的 exact／retimed 綁定。
const canonical=new Map(thsr.map(t=>[t.id,t])),holdTotal=p=>(p.departureHolds||[]).reduce((a,b)=>a+b,0),chosen={};
for(const file of inputs){const d=JSON.parse(fs.readFileSync(file));if((d.conflicts!==0||(d.failures||[]).length)&&!allowYield)throw Error('派車尚未驗證 '+file);if(!d.plans)throw Error('缺少派軌 '+file);
 const src=path.basename(file),thsrIds=Object.keys(d.plans).filter(k=>k.startsWith('thsr_sched:'));
 if(thsrIds.length){const list=dayTrains(d.timetable),expect=thsrProfileFingerprint(list.filter(t=>d.plans[t.id]));if(d.profileSha256!==expect)throw Error('高鐵派車不是用瀏覽器同源的跑段曲線解的(profileSha256 缺或不符,要重跑 optimize_physical_dispatch.mjs) '+file);
  const stops={};for(const t of list){const c=canonical.get(t.id);if(!d.plans[t.id]||!c)continue;
   if(t.stops.length!==c.stops.length||t.stops.some((s,i)=>s.arrSec!==c.stops[i].arrSec||s.depSec!==c.stops[i].depSec))stops[t.id]=t.stops.map(s=>[s.arrSec,s.depSec]);}
  const day=days.find(x=>x.trains.length===thsrIds.length&&x.trains.every(id=>d.plans[id]));groups.push({source:src,timetable:d.timetable||null,dates:day?.dates||[],trains:thsrIds,stops});}
 for(const [id,p] of Object.entries(d.plans)){const prev=chosen[id];
  if(!prev||holdTotal(p)>holdTotal(prev.p)||(holdTotal(p)===holdTotal(prev.p)&&src<prev.src)){plans[id]=p;chosen[id]={p,src};}}
 handoffs.push(...d.handoffs||[]);sources.push(d.source);}
for(const tr of trains){const p=plans[tr.id];if(p){p.stopSignature=physicalStopSignature(tr);p.lengthM=tr.lengthM;}}
const thsrPlanned=thsr.filter(t=>plans[t.id]),thsrProfileSha256=thsrPlanned.length?thsrProfileFingerprint(thsrPlanned):null;
fs.writeFileSync('rail-3d/physical/dispatch.json',JSON.stringify({version:2,assignmentBasis:'inferred',conflictPolicy:allowYield?'temporary-visual-yield':'scheduled-hold',plans,handoffs,source:sources[0],coverage:{trains:Object.keys(plans).length,total:trains.length},thsrProfileSha256,groups}));console.log({trains:Object.keys(plans).length,total:trains.length,thsrProfileSha256:thsrProfileSha256?.slice(0,12),groups:groups.map(g=>g.source+':'+g.trains.length+(g.dates.length?'('+g.dates.join(',')+')':''))});
