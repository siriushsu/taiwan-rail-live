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
  const value={plan,bindingBasis:binding.basis,sourceKey:binding.sourceKey,stops,stopIndexes:binding.stopIndexes,holds,schedule,maxHold:Math.max(...holds.map(h=>h.departure)),reversals,initialFacing:afrInitialFacing(tr)??1};cache.set(tr,value);return value;
 }
 // 第 i 段的跑段曲線。併段（中間略過了派車表沒有的站）整段都在同一條曲線上（略過的是通過站）時沿用它、段長取各小段相加；
 // 跨了跑段（略過的是停靠站）沒有一條曲線涵蓋整段，回 null 退回等速，與沒有跑段曲線的段落同一條退路。
 // 每次取樣現讀 tr.stops：前端重算剖面（reassignTrainProfile）是就地改寫這些站物件。
 function runOf(r,tr,i){const s=r.stops[i],a=r.stopIndexes?.[i],b=r.stopIndexes?.[i+1];if(a==null||b===a+1)return s.rp?s:null;
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
  let f=0,rawTime;
  if(dwell)rawTime=Math.min(s.depSec,s.arrSec+Math.max(0,t-schedule[i].arrSec));
  else{const elapsed=t-schedule[i].depSec,span=stops[i+1].arrSec-s.depSec,run=runOf(r,tr,i);rawTime=s.depSec+elapsed;
   if(run){const runTime=(s.depSec-run.rpDep)+elapsed,distance=profileProgress(run.rp,runTime)*run.rp.L,length=run.rpSegKm*1000;f=length>0?Math.max(0,Math.min(1,(distance-run.rpOff)/length)):0;}
   else f=span>0?Math.max(0,Math.min(1,elapsed/span)):0;
  }
  if(!dwell&&(tr.sys||tr.system)==='afr_sched')f=turnbackProgress(f,s,stops[i+1]);
  const chainageM=route.offsets[i-from]+(dwell?0:(route.offsets[i+1-from]-route.offsets[i-from])*f),point=route.path.at(Math.max(0,Math.min(route.path.length,chainageM)));
  // stopIndex 換回原班表的站序（呼叫端拿它查 tr.stops）；segmentIndex 是 plan.pathIds 的段序。
  return {lat:point.coordinate[1],lon:point.coordinate[0],physical:true,route,chainageM,railDirection:1,formationFacing,segmentIndex:segment,stopIndex:r.stopIndexes?r.stopIndexes[i]:i,dwell,f,rawTime,estimatedHoldSec:Math.max(0,t-rawTime)};
 }
 return {sample,record,geometry,has:tr=>!!record(tr)};
}
