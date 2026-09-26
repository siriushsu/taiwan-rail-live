import {createRouteRuntime} from './route-runtime.js';
import {afrInitialFacing} from './afr-operation.js';
import {isScheduledTurnback} from './turnbacks.js';
import {profileProgress,turnbackProgress} from './timing.js';
import {createPlanBinding,physicalTrainKey,physicalStopSignature} from './plan-binding.js';
export {physicalTrainKey,physicalStopSignature};
export function createPhysicalMotion(pack,profiles,dispatch,{requireSignature=true}={}){
 const geometry=createRouteRuntime(pack,profiles),cache=new WeakMap(),bind=createPlanBinding(dispatch);
 // stops＝綁定實際用的站序：略過派車表沒有的站之後的那一份（見 plan-binding.js），沒略過就是 tr.stops。
 function record(tr){if(cache.has(tr))return cache.get(tr);const binding=requireSignature?bind(tr):{plan:dispatch.plans[physicalTrainKey(tr)],basis:'unchecked'},plan=binding?.plan,stops=binding?.stops||tr.stops;
  if(!plan||plan.pathIds.length!==stops.length-1){cache.set(tr,null);return null;}
  const holds=plan.holds||plan.departureHolds.map((departure,i)=>({arrival:plan.departureHolds[Math.max(0,i-1)],departure}));
  const schedule=stops.map((s,i)=>({arrSec:s.arrSec+holds[i].arrival,depSec:s.depSec+holds[i].departure}));
  const reversals=[];for(let i=1;i<plan.pathIds.length;i++){const a=geometry.unfold(plan.pathIds[i-1]),b=geometry.unfold(plan.pathIds[i]);if(isScheduledTurnback(tr.sys||tr.system,stops[i].name,a,b))reversals.push(i);}
  // cuts[i]＝第 i 段中途被略過的停靠站（派車表沒有、官方有停，2026-10 起的平鎮臨時站）：k 是原班表站序，at 是那一站座標
  // 投影到這一段實體路徑上、離這一段起點的距離（公尺；股道表 via 用同一個投影當剖面長下限，scripts/lib/track_section_via.mjs）。
  // 車停在投影點到官方離站時刻，前後各截照自己的跑段剖面走；通過站不切。沒有這種站的段是 null，照舊。
  const cuts=binding.stopIndexes&&stops.slice(0,-1).map((_,i)=>{let at=0;const out=[];
   for(let k=binding.stopIndexes[i]+1;k<binding.stopIndexes[i+1];k++){const st=tr.stops[k];if(st.stop===false||!Number.isFinite(st.lat)||!Number.isFinite(st.lon))continue;
    at=Math.max(at,geometry.unfold(plan.pathIds[i]).path.locate([st.lon,st.lat]).s);out.push({k,at});}
   return out.length?out:null;});
  const value={plan,bindingBasis:binding.basis,sourceKey:binding.sourceKey,stops,stopIndexes:binding.stopIndexes,cuts,holds,schedule,maxHold:Math.max(...holds.map(h=>h.departure)),reversals,initialFacing:afrInitialFacing(tr)??1};cache.set(tr,value);return value;
 }
 // 第 i 段的跑段曲線。併段（中間略過了派車表沒有的站）整段都在同一條曲線上（略過的是通過站）時沿用它、段長取各小段相加；
 // 略過的停靠站由 sample() 照 cuts 分截、各截用各自的曲線，只有那一站沒有座標切不了時才會跨跑段：沒有一條曲線涵蓋整段，
 // 回 null 退回等速，與沒有跑段曲線的段落同一條退路。每次取樣現讀 tr.stops：前端重算剖面（reassignTrainProfile）是就地改寫這些站物件。
 function runOf(r,tr,i){const a=r.stopIndexes?.[i];return a==null?(r.stops[i].rp?r.stops[i]:null):runBetween(tr,a,r.stopIndexes[i+1]);}
 // 原班表第 a 站到第 b 站之間（中間只有通過站）的跑段曲線；同上，各小段不是同一條曲線就回 null 退回等速。
 function runBetween(tr,a,b){const s=tr.stops[a];if(b===a+1)return s.rp?s:null;
  let segKm=0;for(let k=a;k<b;k++){if(!s.rp||tr.stops[k].rp!==s.rp)return null;segKm+=tr.stops[k].rpSegKm;}return {rp:s.rp,rpDep:s.rpDep,rpOff:s.rpOff,rpSegKm:segKm};}
 function sample(tr,clockSec,{officialDelaySec=0,wrap=(s,t,grace)=>t<s[0].arrSec&&t+86400<=s.at(-1).depSec+grace?t+86400:t}={}){
  // 跨夜判斷拿原班表的陣列：名冊把 _prevNight 等旗標掛在它上面（index.html schedWrapT）。首末站從不略過，時間範圍與綁定站序相同。
  const r=record(tr);if(!r)return undefined;const stops=r.stops,t=wrap(tr.stops,clockSec-officialDelaySec,r.maxHold),schedule=r.schedule;
  if(t<schedule[0].arrSec||t>schedule.at(-1).depSec)return null;
  if(r.bindingBasis!=='route-template'&&dispatch.handoffs?.some(h=>h.from===physicalTrainKey(tr))&&t>=schedule.at(-1).arrSec)return null;
  let lo=0,hi=schedule.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(schedule[m].arrSec<=t)lo=m;else hi=m;}
  const i=t>=schedule[hi].arrSec?hi:lo,s=stops[i],dwell=t<=schedule[i].depSec;
  const segment=Math.min(i,r.plan.pathIds.length-1),legStart=r.reversals.filter(k=>k<=segment).at(-1)||0,legEnd=r.reversals.find(k=>k>segment)||r.plan.pathIds.length;
  const from=Math.max(legStart,segment-1),to=Math.min(legEnd,segment+2);
  // 全台活躍車超過共用 LRU 容量時，仍由這班車持有當前的三段線形。
  // 區間改變即替換；WeakMap 跟隨班表物件釋放，不累積整日路線。
  if(!r.activeRoute||r.routeFrom!==from||r.routeTo!==to){r.activeRoute=geometry.route(r.plan.pathIds.slice(from,to),tr.sys||tr.system,tr.color||'#547466',{prefixM:from===legStart?250:0,suffixM:to===legEnd?250:0});r.routeFrom=from;r.routeTo=to;}
  const route=r.activeRoute,formationFacing=r.initialFacing*(r.reversals.filter(k=>k<=segment).length%2?-1:1);
  let f=0,rawTime,chainageM,stopIndex=r.stopIndexes?r.stopIndexes[i]:i,stopped=dwell;
  const cut=!dwell&&r.cuts?.[i];
  if(cut){
   // 這一段中途有略過的停靠站：先找此刻在哪一截（官方到站時刻過了幾個切點），停在切點上或照那一截的跑段曲線走。
   // 起站若帶待避（離站延後），整段連同中途停靠一起順延，與沒有切點的段落一樣。
   const shift=schedule[i].depSec-s.depSec,start=route.offsets[i-from],end=route.offsets[i+1-from]-start;
   let q=0;while(q<cut.length&&t>=tr.stops[cut[q].k].arrSec+shift)q++;
   const c=q?cut[q-1]:null,n=q<cut.length?cut[q]:null,p0=c?tr.stops[c.k]:s,at0=c?c.at:0;
   if(c)stopIndex=c.k;
   if(c&&t<=p0.depSec+shift){stopped=true;rawTime=Math.min(p0.depSec,p0.arrSec+Math.max(0,t-(p0.arrSec+shift)));chainageM=start+at0;}
   else{const p1=n?tr.stops[n.k]:stops[i+1],at1=n?n.at:end,elapsed=t-(p0.depSec+shift),span=p1.arrSec-p0.depSec,run=runBetween(tr,c?c.k:r.stopIndexes[i],n?n.k:r.stopIndexes[i+1]);rawTime=p0.depSec+elapsed;
    let g;if(run){const runTime=(p0.depSec-run.rpDep)+elapsed,distance=profileProgress(run.rp,runTime)*run.rp.L,length=run.rpSegKm*1000;g=length>0?Math.max(0,Math.min(1,(distance-run.rpOff)/length)):0;}
    else g=span>0?Math.max(0,Math.min(1,elapsed/span)):0;
    chainageM=start+at0+(at1-at0)*g;}
   f=end>0?(chainageM-start)/end:0;
  }
  else{
  if(dwell)rawTime=Math.min(s.depSec,s.arrSec+Math.max(0,t-schedule[i].arrSec));
  else{const elapsed=t-schedule[i].depSec,span=stops[i+1].arrSec-s.depSec,run=runOf(r,tr,i);rawTime=s.depSec+elapsed;
   if(run){const runTime=(s.depSec-run.rpDep)+elapsed,distance=profileProgress(run.rp,runTime)*run.rp.L,length=run.rpSegKm*1000;f=length>0?Math.max(0,Math.min(1,(distance-run.rpOff)/length)):0;}
   else f=span>0?Math.max(0,Math.min(1,elapsed/span)):0;
  }
  if(!dwell&&(tr.sys||tr.system)==='afr_sched')f=turnbackProgress(f,s,stops[i+1]);
  chainageM=route.offsets[i-from]+(dwell?0:(route.offsets[i+1-from]-route.offsets[i-from])*f);
  }
  const point=route.path.at(Math.max(0,Math.min(route.path.length,chainageM)));
  // stopIndex 換回原班表的站序（呼叫端拿它查 tr.stops）；停在中途略過的停靠站或從那裡開出後，是那一站。segmentIndex 是 plan.pathIds 的段序。
  return {lat:point.coordinate[1],lon:point.coordinate[0],physical:true,route,chainageM,railDirection:1,formationFacing,segmentIndex:segment,stopIndex,dwell:stopped,f,rawTime,estimatedHoldSec:Math.max(0,t-rawTime)};
 }
 return {sample,record,geometry,has:tr=>!!record(tr)};
}
