// 高鐵派車「佔用模型 vs 行車模型」同源閘門(掛在 ship_web 高鐵車站股道閘門之後)。
//
// 2026-09-12 抓到:求解器的佔用模型(reservations.js)算 0108 在桃園 09:12 通過,網頁行車模型
// (motion.js)09:10:38 就過了——班表沒掛跑段曲線,segmentTime 退回等速內插;停靠的 0610 因此
// 多等約 90 秒,別站會反過來該讓沒讓。三道判準,每一道配正向對照,分母不得為 0:
//  G1 dispatch.json 記的曲線指紋 = 用出貨樹的 index.html＋thsr_track.json＋各班停靠簽章重算的指紋
//     (曲線模型、班表或 +30 秒常數任一改了而沒重派,這裡紅)。
//  G2 每班每個通過站:佔用模型的通過時刻(segmentTime 反解)與行車模型(motion.sample 二分搜尋)
//     差 ≤ 1 秒,且該站節點的預約時窗要包住那個時刻;同一組資料改用等速內插當對照,對行車模型的
//     最大差必須 > 60 秒(證明這條量得到今天這種病,不是恆真)。
//  G3 同一日型(dispatch.groups)全部班次用曲線模型重算佔用:股道／道岔／停車點零交疊,
//     且各組聯集必須涵蓋全部高鐵派車(分組漏班＝沒驗)。
// 用法:node scripts/verify_thsr_reservation_motion.mjs
//   DISPATCH=<檔> 指定別份派車(陰性對照:對沒帶指紋、用等速內插解的舊派車跑,G1 紅、G3 應紅);
//   REPORT=<檔> 分布報告輸出位置(預設 output/thsr-reservation-vs-motion.json,
//   含「等速內插 vs 曲線」的逐站通過時刻差分布——正值＝佔用模型比行車模型晚)。
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createPhysicalMotion} from '../rail-3d/physical/motion.js';
import {vehicleReservations} from '../rail-3d/physical/reservations.js';
import {segmentTime} from '../rail-3d/physical/timing.js';
import {distanceM} from '../rail-3d/integration/train-path.js';
import {restorePhysicalRoutes} from './lib/restore_physical_routes.mjs';
import {attachThsrRunProfiles,thsrProfileFingerprint} from './lib/thsr_run_profiles.mjs';
const root=new URL('../',import.meta.url),at=p=>fileURLToPath(new URL(p,root)),read=p=>JSON.parse(fs.readFileSync(at(p)));
const dispatchPath=process.env.DISPATCH||at('rail-3d/physical/dispatch.json');
const pack=read('rail-3d/physical/network.json'),profiles=read('rail-3d/physical/display-profiles.json'),dispatch=JSON.parse(fs.readFileSync(dispatchPath)),track=read('data/thsr_track.json');
const norm=n=>String(n).replaceAll('臺','台'),SYS='thsr_sched',hms=s=>new Date(Math.round(s)*1000).toISOString().slice(11,19);
const results=[],check=(ok,label,detail)=>{results.push([ok?'PASS':'FAIL',label,detail]);};

// 班表從派車表的停靠簽章還原(與 verify_thsr_plan_binding 同法),再掛上瀏覽器同源的曲線。
const plans=Object.entries(dispatch.plans).filter(([k])=>k.startsWith(SYS+':'));
const trains=plans.map(([id,p])=>({id,system:SYS,sys:SYS,train:id.split(':')[1],lengthM:p.lengthM||304,stops:JSON.parse(p.stopSignature).map(([k,arrSec,depSec])=>({name:k.slice(SYS.length+1),arrSec,depSec,stop:true}))}));
const attached=attachThsrRunProfiles(trains,{indexPath:at('index.html'),trackPath:at('data/thsr_track.json')});
const fingerprint=thsrProfileFingerprint(trains);
check(plans.length>=150,'高鐵派車班次分母',plans.length+' 班');
check(attached.profiled>0&&attached.plain===0,'每一段都掛得上瀏覽器的曲線',`曲線 ${attached.profiled} 段／退等速 ${attached.plain} 段`);
check(dispatch.thsrProfileSha256===fingerprint,'G1 派車表的曲線指紋與出貨樹重算一致',`記錄 ${String(dispatch.thsrProfileSha256||'(無)').slice(0,12)} vs 重算 ${fingerprint.slice(0,12)}`);

// 佔用模型:vehicleReservations 要的路網從 pack 還原;行車模型:motion.js 原樣。
const {paths,edges}=restorePhysicalRoutes(pack),net={paths,edges};
const motion=createPhysicalMotion(pack,profiles,dispatch),geometry=motion.geometry;
const ORDER=track.lines[0].stations.map(s=>norm(s.name)),coordOf=Object.fromEntries(track.lines[0].stations.map(s=>[norm(s.name),[s.lon,s.lat]]));
const scheduleOf=(tr,p)=>{const holds=p.holds||p.departureHolds.map((departure,i)=>({arrival:p.departureHolds[Math.max(0,i-1)],departure}));return tr.stops.map((s,i)=>({arrSec:s.arrSec+holds[i].arrival,depSec:s.depSec+holds[i].departure}));};
const events=[],approaches=[];let windowMiss=0,motionMiss=0;
for(const tr of trains){
 const p=dispatch.plans[tr.id],schedule=scheduleOf(tr,p),r=motion.record(tr);
 if(!r){motionMiss++;continue;}
 const reservations=vehicleReservations(net,tr,p.pathIds,schedule);
 // 行車模型:在第 i 段內二分搜尋列車中心走到路徑里程 d 的時刻。
 const chainageRel=(i,t)=>{const s=motion.sample(tr,t);if(!s)return null;return s.chainageM-s.route.offsets[i-r.routeFrom];};
 const motionTime=(i,d)=>{let lo=schedule[i].depSec,hi=schedule[i+1].arrSec;for(let k=0;k<40;k++){const m=(lo+hi)/2,c=chainageRel(i,m);if(c===null)return null;if(c<d)lo=m;else hi=m;}return (lo+hi)/2;};
 const times=(i,d)=>{const st=tr.stops[i],nx=tr.stops[i+1],L=paths[p.pathIds[i]].lengthM,f=d/L;
  return {lin:schedule[i].depSec+(nx.arrSec-st.depSec)*f,res:schedule[i].depSec+segmentTime(st,nx,f,{system:SYS}),mot:motionTime(i,d)};};
 for(let i=0;i<p.pathIds.length;i++){
  const u=geometry.unfold(p.pathIds[i]),a=ORDER.indexOf(norm(tr.stops[i].name)),b=ORDER.indexOf(norm(tr.stops[i+1].name));
  for(let j=Math.min(a,b)+1;j<Math.max(a,b);j++){
   const name=ORDER[j];let best=null;
   for(let k=0;k<u.nodeIds.length;k++){const m=distanceM(u.coordinates[k],coordOf[name]);if(!best||m<best.m)best={m,k};}
   if(!best||best.m>600)continue;
   const d=u.path.d[best.k],t=times(i,d),node=u.nodeIds[best.k];
   const win=reservations.find(x=>x.resource===SYS+':node:'+node&&x.start<=t.res&&t.res<=x.end);if(!win)windowMiss++;
   events.push({id:tr.id,train:tr.train,station:name,segment:i,dLinear:t.lin-t.res,dParity:t.mot===null?null:t.res-t.mot,dLinearVsMotion:t.mot===null?null:t.lin-t.mot,res:t.res,mot:t.mot,window:win?[win.start,win.end]:null});
  }
  // 停靠站進站:月台前 1 公里(等速內插 vs 曲線;煞車段會讓曲線提早到這裡)
  const L=paths[p.pathIds[i]].lengthM;if(L>1500){const t=times(i,L-1000);approaches.push({id:tr.id,train:tr.train,station:norm(tr.stops[i+1].name),dLinear:t.lin-t.res,dParity:t.mot===null?null:t.res-t.mot});}
 }
}
const stats=list=>{const v=list.filter(x=>x!==null&&Number.isFinite(x));if(!v.length)return {n:0};const abs=v.map(Math.abs).sort((a,b)=>a-b),q=f=>abs[Math.min(abs.length-1,Math.floor(f*(abs.length-1)))];return {n:v.length,mean:+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2),absMean:+(abs.reduce((a,b)=>a+b,0)/abs.length).toFixed(2),absP50:+q(.5).toFixed(2),absP95:+q(.95).toFixed(2),absMax:+abs.at(-1).toFixed(2),min:+Math.min(...v).toFixed(2),max:+Math.max(...v).toFixed(2),over60:v.filter(x=>Math.abs(x)>60).length,negativeOver30:v.filter(x=>x<-30).length};};
const parity=stats(events.map(e=>e.dParity)),control=stats(events.map(e=>e.dLinearVsMotion)),drift=stats(events.map(e=>e.dLinear));
const byStation={};for(const e of events){(byStation[e.station]??=[]).push(e.dLinear);}
check(events.length>=300,'通過站事件分母',events.length+' 站次');
check(motionMiss===0,'每班都綁得上行車模型',motionMiss+' 班綁不上');
check(parity.n===events.length&&parity.absMax<=1,'G2 佔用模型與行車模型的通過時刻差 ≤ 1 秒',`最大 ${parity.absMax} 秒(${parity.n} 站次)`);
check(windowMiss===0,'G2 通過站節點的預約時窗包住佔用模型的通過時刻',windowMiss+' 站次落在時窗外');
check(control.absMax>60,'G2 正向對照:改用等速內插對行車模型的最大差 > 60 秒',`最大 ${control.absMax} 秒、>60 秒 ${control.over60} 站次`);

// G3 同日班次零交疊:各日型分組來自 assemble(dispatch.groups),依瀏覽器 plan-binding 的規則重算佔用後掃描——
// 當天時刻與派車表相同的班次(exact)沿用派車表的待避;當天只改了時刻的班次(retimed)待避一律歸零,
// 時刻取 groups[].stops 記的當天值,曲線也要按當天時刻重掛(段內時間會變)。dropHolds 是正向對照用的開關。
const groups=(dispatch.groups||[]).filter(g=>g.trains.some(id=>id.startsWith(SYS+':')));
const trainById=new Map(trains.map(t=>[t.id,t])),handoff=(a,b)=>(dispatch.handoffs||[]).some(h=>h.from===a&&h.to===b||h.from===b&&h.to===a);
const dayTrainsOf=g=>{const list=g.trains.filter(id=>trainById.has(id)).map(id=>{const tr=trainById.get(id),ov=g.stops&&g.stops[id];
  return {...tr,retimed:!!ov,stops:tr.stops.map((s,i)=>({name:s.name,arrSec:ov?ov[i][0]:s.arrSec,depSec:ov?ov[i][1]:s.depSec,stop:true}))};});
 attachThsrRunProfiles(list,{indexPath:at('index.html'),trackPath:at('data/thsr_track.json')});return list;};
const scanGroup=(g,list,dropHolds)=>{
 const booked=new Map();let maxHold=0,missing=g.trains.filter(id=>!trainById.has(id)||!dispatch.plans[id]).length;
 for(const tr of list){const p=dispatch.plans[tr.id];if(!p)continue;
  const keepHolds=!tr.retimed&&!dropHolds;if(keepHolds)maxHold=Math.max(maxHold,...p.departureHolds);
  const schedule=keepHolds?scheduleOf(tr,p):tr.stops.map(s=>({arrSec:s.arrSec,depSec:s.depSec}));
  for(const r of vehicleReservations(net,tr,p.pathIds,schedule)){if(!booked.has(r.resource))booked.set(r.resource,[]);booked.get(r.resource).push(r);}}
 const found=[];for(const list2 of booked.values()){list2.sort((a,b)=>a.start-b.start);const active=[];for(const b of list2){for(let i=active.length-1;i>=0;i--)if(active[i].end<=b.start+.001)active.splice(i,1);for(const a of active)if(a.train!==b.train&&!handoff(a.train,b.train)&&Math.min(a.end,b.end)-Math.max(a.start,b.start)>.001)found.push({resource:b.resource,a:a.train,b:b.train,overlapSec:+(Math.min(a.end,b.end)-Math.max(a.start,b.start)).toFixed(1),at:hms(Math.max(a.start,b.start))});active.push(b);}}
 return {found,maxHold,missing};};
const groupRows=[];let controlOverlaps=0;
for(const g of groups){
 const list=dayTrainsOf(g),{found,maxHold,missing}=scanGroup(g,list,false);
 controlOverlaps+=scanGroup(g,list,true).found.length;
 groupRows.push({source:g.source,dates:g.dates||[],trains:g.trains.length,retimed:list.filter(t=>t.retimed).length,missing,overlaps:found.length,maxHoldSec:+maxHold.toFixed(1),examples:found.slice(0,5)});
}
const covered=new Set(groups.flatMap(g=>g.trains));
check(groups.length>=1,'G3 派車表帶同日班次分組(assemble 嵌入)',groups.length+' 組');
check(plans.every(([k])=>covered.has(k)),'G3 分組聯集涵蓋全部高鐵派車',plans.filter(([k])=>!covered.has(k)).length+' 班不在任何分組');
for(const g of groupRows)check(g.missing===0&&g.overlaps===0,`G3 ${g.source}(${g.dates.join('/')||'日期未記'}) ${g.trains} 班零交疊`,`交疊 ${g.overlaps}${g.missing?`、缺班 ${g.missing}`:''}、改時刻 ${g.retimed} 班(待避歸零)、最大待避 ${g.maxHoldSec} 秒`+(g.examples.length?' 例:'+g.examples.map(e=>`${e.a.split(':')[1]}×${e.b.split(':')[1]}@${e.at} ${e.overlapSec}s`).join(' '):''));
check(controlOverlaps>0,'G3 正向對照:待避全部歸零後同日確實掃得出交疊',`六個日型合計 ${controlOverlaps} 個`);
check(groups.some(g=>Object.keys(g.stops||{}).length),'G3 分組帶當天時刻(改時刻班次才綁得對)',groups.map(g=>Object.keys(g.stops||{}).length).join('/')+' 班');

const report={generatedAt:new Date().toISOString(),dispatch:String(dispatchPath),profileSha256:fingerprint,recordedSha256:dispatch.thsrProfileSha256||null,trains:trains.length,throughEvents:events.length,
 linearMinusProfile:{...drift,byStation:Object.fromEntries(Object.entries(byStation).map(([k,v])=>[k,stats(v)])),worst:[...events].sort((a,b)=>Math.abs(b.dLinear)-Math.abs(a.dLinear)).slice(0,15).map(e=>({train:e.train,station:e.station,dLinear:+e.dLinear.toFixed(1),profile:hms(e.res)}))},
 approachLinearMinusProfile:stats(approaches.map(a=>a.dLinear)),parity,linearVsMotionControl:control,groups:groupRows,groupsZeroHoldControl:controlOverlaps,results,
 events:events.map(e=>({train:e.train,station:e.station,linearMinusProfile:+e.dLinear.toFixed(1),parity:e.dParity===null?null:+e.dParity.toFixed(3),profile:hms(e.res),motion:e.mot===null?null:hms(e.mot),window:e.window&&e.window.map(hms)}))};
const reportPath=process.env.REPORT||at('output/thsr-reservation-vs-motion.json');fs.mkdirSync(at('output/'),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,1));
for(const [s,l,d] of results)console.log(s,l,'—',d);
console.log(`等速內插 vs 曲線(通過站 ${drift.n} 站次):平均 ${drift.mean}s、|p95| ${drift.absP95}s、最大 ${drift.max}s／最小 ${drift.min}s、>60s ${drift.over60} 站次;報告 ${reportPath}`);
const failed=results.filter(r=>r[0]==='FAIL').length;
console.log(failed?`高鐵佔用模型同源:${failed} 項未通過`:`高鐵佔用模型同源:${results.length} 項通過(${trains.length} 班、${events.length} 通過站次、${groups.length} 個日型)`);
process.exit(failed?1:0);
