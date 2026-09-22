import {segmentTime} from '../../rail-3d/physical/timing.js';
// 先列舉可選股道的車體佔用，讓求解器在換軌前就知道新路徑的衝突。
// 每次只展開一個來源資源，避免把全日數百萬個佔用區間同時留在記憶體。
export function candidateConflicts(n,trains,pairs,{maxWaitSec=600,orderSameDirection=false,progress=()=>{}}={}){
 const uses=new Map(),resources=new Map(),unique=new Map();
 for(let ti=0;ti<trains.length;ti++)for(let i=0;i<trains[ti].pairs.length;i++)for(const id of pairs[trains[ti].pairs[i]]){if(!uses.has(id))uses.set(id,[]);uses.get(id).push({ti,i});}
 for(const id of uses.keys()){const p=n.paths[id];let d=0;const add=(resource,d0,d1,j)=>{if(!resources.has(resource))resources.set(resource,[]);resources.get(resource).push({id,d0,d1,j});};
  for(let j=0;j<p.edgeIds.length;j++){const e=n.edges[p.edgeIds[j]];add(e.resource,d,d+e.length,j);add(p.system+':node:'+p.nodeIds[j],d,d,j);d+=e.length;}add(p.system+':node:'+p.nodeIds.at(-1),d,d,p.nodeIds.length-2);
 }
 const neighbors=new Map();
 function reference(ti,i,id,s,end){const tr=trains[ti],p=n.paths[id];
  if(s<0){if(i===0)return {stop:0,base:tr.stops[0].arrSec};const key=id+':prev:'+tr.pairs[i-1];let candidates=neighbors.get(key);if(!candidates){candidates=pairs[tr.pairs[i-1]].map(k=>n.paths[k]).filter(q=>q.to===p.from);neighbors.set(key,candidates);}if(!candidates.length||candidates.some(q=>q.lengthM+s<0))return null;
   return {stop:i-1,base:Math.min(...candidates.map(q=>tr.stops[i-1].depSec+segmentTime(tr.stops[i-1],tr.stops[i],(q.lengthM+s)/q.lengthM,{system:tr.system})))};
  }
  if(s>p.lengthM){if(i===tr.pairs.length-1)return {stop:i+1,base:tr.stops[i+1].depSec};const key=id+':next:'+tr.pairs[i+1];let candidates=neighbors.get(key);if(!candidates){candidates=pairs[tr.pairs[i+1]].map(k=>n.paths[k]).filter(q=>q.from===p.to);neighbors.set(key,candidates);}const extra=s-p.lengthM;if(!candidates.length||candidates.some(q=>extra>q.lengthM))return null;
   return {stop:i+1,base:Math.max(...candidates.map(q=>tr.stops[i+1].depSec+segmentTime(tr.stops[i+1],tr.stops[i+2],extra/q.lengthM,{system:tr.system})))};
  }
  if(s<.00001)return {stop:end?i:Math.max(0,i-1),base:end?tr.stops[i].depSec:tr.stops[i].arrSec};
  if(p.lengthM-s<.00001)return {stop:end?i+1:i,base:end?tr.stops[i+1].depSec:tr.stops[i+1].arrSec};
  return {stop:i,base:tr.stops[i].depSec+segmentTime(tr.stops[i],tr.stops[i+1],s/p.lengthM,{system:tr.system})};
 }
 let done=0,intervals=0,skipped=0;for(const geometries of resources.values()){
  const rows=[];
  for(const {id,d0,d1,j}of geometries)for(const {ti,i}of uses.get(id)){const tr=trains[ti],half=(tr.lengthM||240)/2+3,start=reference(ti,i,id,d0-half,false),end=reference(ti,i,id,d1+half,true);if(!start||!end){skipped++;continue;}
   const p=n.paths[id],a=n.nodes[p.nodeIds[j]].coordinate,b=n.nodes[p.nodeIds[j+1]].coordinate,dx=(b[0]-a[0])*Math.cos(a[1]*Math.PI/180),dy=b[1]-a[1],len=Math.hypot(dx,dy);const delay=tr.delaySec||0;rows.push({heading:[dx/len,dy/len],trainIndex:ti,variables:[[i,id]],startRef:{stop:start.stop,base:Math.floor((start.base+delay-2)*10)},endRef:{stop:end.stop,base:Math.ceil((end.base+delay+2)*10)}});
  }
  intervals+=rows.length;rows.sort((a,b)=>a.startRef.base-b.startRef.base);const active=[];
  for(const row of rows){for(let j=active.length-1;j>=0;j--)if(active[j].endRef.base+maxWaitSec*10<=row.startRef.base)active.splice(j,1);
   for(const prior of active){if(prior.trainIndex===row.trainIndex)continue;let a=prior,b=row;if(a.trainIndex>b.trainIndex)[a,b]=[b,a];
    const ordered=orderSameDirection&&(a.heading[0]*b.heading[0]+a.heading[1]*b.heading[1]>.8);const key=[a.trainIndex,a.variables[0],a.startRef.stop,a.endRef.stop,b.trainIndex,b.variables[0],b.startRef.stop,b.endRef.stop].join('|'),da=a.endRef.base-b.startRef.base,db=b.endRef.base-a.startRef.base,r=unique.get(key);
    if(r){r.ordered&&=ordered;r.a.endRef.base=Math.max(r.a.endRef.base,da);r.b.endRef.base=Math.max(r.b.endRef.base,db);}
    else unique.set(key,{ordered,a:{...a,startRef:{stop:a.startRef.stop,base:0},endRef:{stop:a.endRef.stop,base:da}},b:{...b,startRef:{stop:b.startRef.stop,base:0},endRef:{stop:b.endRef.stop,base:db}}});
   }active.push(row);
  }
  if(++done%1000===0)progress({done,total:resources.size,intervals,constraints:unique.size,skipped});
 }
 return [...unique.values()];
}
