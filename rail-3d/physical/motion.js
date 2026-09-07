import {createRouteRuntime} from './route-runtime.js';
import {isScheduledTurnback} from './turnbacks.js';
import {profileProgress,stationKey,turnbackProgress} from './timing.js';
export const physicalTrainKey=tr=>[tr.sys||tr.system,tr.train,tr.stops[0].depSec,tr.stops.at(-1).arrSec].join(':');
export const physicalStopSignature=tr=>JSON.stringify(tr.stops.map(s=>[stationKey(tr.sys||tr.system,s.name),s.arrSec,s.depSec]));
export function createPhysicalMotion(pack,profiles,dispatch,{requireSignature=true}={}){
 const geometry=createRouteRuntime(pack,profiles),cache=new WeakMap();
 function record(tr){if(cache.has(tr))return cache.get(tr);const plan=dispatch.plans[physicalTrainKey(tr)];
  if(!plan||plan.pathIds.length!==tr.stops.length-1||(requireSignature&&plan.stopSignature!==physicalStopSignature(tr))){cache.set(tr,null);return null;}
  const holds=plan.holds||plan.departureHolds.map((departure,i)=>({arrival:plan.departureHolds[Math.max(0,i-1)],departure}));
  const schedule=tr.stops.map((s,i)=>({arrSec:s.arrSec+holds[i].arrival,depSec:s.depSec+holds[i].departure}));
  const reversals=[];for(let i=1;i<plan.pathIds.length;i++){const a=geometry.unfold(plan.pathIds[i-1]),b=geometry.unfold(plan.pathIds[i]);if(isScheduledTurnback(tr.sys||tr.system,tr.stops[i].name,a,b))reversals.push(i);}
  const value={plan,holds,schedule,maxHold:Math.max(...holds.map(h=>h.departure)),reversals};cache.set(tr,value);return value;
 }
 function sample(tr,clockSec,{officialDelaySec=0,wrap=(s,t,grace)=>t<s[0].arrSec&&t+86400<=s.at(-1).depSec+grace?t+86400:t}={}){
  const r=record(tr);if(!r)return undefined;const t=wrap(tr.stops,clockSec-officialDelaySec,r.maxHold),schedule=r.schedule;
  if(t<schedule[0].arrSec||t>schedule.at(-1).depSec)return null;
  if(dispatch.handoffs?.some(h=>h.from===physicalTrainKey(tr))&&t>=schedule.at(-1).arrSec)return null;
  let lo=0,hi=schedule.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(schedule[m].arrSec<=t)lo=m;else hi=m;}
  const i=t>=schedule[hi].arrSec?hi:lo,s=tr.stops[i],dwell=t<=schedule[i].depSec;
  const segment=Math.min(i,r.plan.pathIds.length-1),legStart=r.reversals.filter(k=>k<=segment).at(-1)||0,legEnd=r.reversals.find(k=>k>segment)||r.plan.pathIds.length;
  const from=Math.max(legStart,segment-1),to=Math.min(legEnd,segment+2),route=geometry.route(r.plan.pathIds.slice(from,to),tr.sys||tr.system,tr.color||'#547466',{prefixM:from===legStart?250:0,suffixM:to===legEnd?250:0}),formationFacing=r.reversals.filter(k=>k<=segment).length%2?-1:1;
  let f=0,rawTime;
  if(dwell)rawTime=Math.min(s.depSec,s.arrSec+Math.max(0,t-schedule[i].arrSec));
  else{const elapsed=t-schedule[i].depSec,span=tr.stops[i+1].arrSec-s.depSec;rawTime=s.depSec+elapsed;
   if(s.rp){const runTime=(s.depSec-s.rpDep)+elapsed,distance=profileProgress(s.rp,runTime)*s.rp.L,length=s.rpSegKm*1000;f=length>0?Math.max(0,Math.min(1,(distance-s.rpOff)/length)):0;}
   else f=span>0?Math.max(0,Math.min(1,elapsed/span)):0;
  }
  if(!dwell&&(tr.sys||tr.system)==='afr_sched')f=turnbackProgress(f,s,tr.stops[i+1]);
  const chainageM=route.offsets[i-from]+(dwell?0:(route.offsets[i+1-from]-route.offsets[i-from])*f),point=route.path.at(Math.max(0,Math.min(route.path.length,chainageM)));
  return {lat:point.coordinate[1],lon:point.coordinate[0],physical:true,route,chainageM,railDirection:1,formationFacing,segmentIndex:segment,stopIndex:i,dwell,f,rawTime,estimatedHoldSec:Math.max(0,t-rawTime)};
 }
 return {sample,record,geometry,has:tr=>!!record(tr)};
}
