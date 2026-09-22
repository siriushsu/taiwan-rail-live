import {segmentTime} from './timing.js';
// 預約整列車與每個道岔/停車點；分開記錄同一股道的不同通過時段。
export function vehicleReservations(network,tr,ids,schedule){
 const paths=ids.map(id=>network.paths[id]),distances=[0];for(const p of paths)distances.push(distances.at(-1)+p.lengthM);
 const half=(tr.lengthM||240)/2+3,resources=new Map(),baseDelay=tr.delaySec||0;
 function time(s,end){
  if(s<=0)return {t:schedule[0].arrSec,base:tr.stops[0].arrSec+baseDelay,stop:0,segment:0};
  if(s>=distances.at(-1))return {t:schedule.at(-1).depSec,base:tr.stops.at(-1).depSec+baseDelay,stop:tr.stops.length-1,segment:paths.length-1};
  let lo=0,hi=distances.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(distances[m]<=s)lo=m;else hi=m;}
  if(Math.abs(s-distances[lo])<.00001)return {t:end?schedule[lo].depSec:schedule[lo].arrSec,base:(end?tr.stops[lo].depSec:tr.stops[lo].arrSec)+baseDelay,stop:end?lo:Math.max(0,lo-1),segment:lo};
  const offset=segmentTime(tr.stops[lo],tr.stops[lo+1],(s-distances[lo])/paths[lo].lengthM,{system:tr.system});
  return {t:schedule[lo].depSec+offset,base:tr.stops[lo].depSec+baseDelay+offset,stop:lo,segment:lo};
 }
 function add(resource,d0,d1,segment){const a=time(d0-half,false),b=time(d1+half,true),variables=[];
  for(let i=Math.min(segment,a.segment);i<=Math.max(segment,b.segment)&&i<ids.length;i++)variables.push([i,ids[i]]);
  const r={resource,start:a.t-2,end:b.t+2,train:tr.id,variables,owners:[{segment,d0,d1}],startRef:{stop:a.stop,base:a.base-2},endRef:{stop:b.stop,base:b.base+2}};
  if(!resources.has(resource))resources.set(resource,[]);resources.get(resource).push(r);
 }
 for(let i=0;i<paths.length;i++){const p=paths[i];let d=distances[i];
  for(let j=0;j<p.edgeIds.length;j++){const e=network.edges[p.edgeIds[j]],end=d+e.length;add(e.resource,d,end,i);add(tr.system+':node:'+p.nodeIds[j],d,d,i);d=end;}
  add(tr.system+':node:'+p.nodeIds.at(-1),d,d,i);
 }
 const output=[];for(const list of resources.values()){
  list.sort((a,b)=>a.start-b.start);let prior=null;
  for(const r of list){if(prior&&r.start<=prior.end+.00001){if(r.end>prior.end){prior.end=r.end;prior.endRef=r.endRef;}prior.owners.push(...r.owners);prior.variables=[...new Map([...prior.variables,...r.variables].map(v=>[v[0],v])).values()];}
   else{prior=r;output.push(r);}}
 }
 return output;
}
