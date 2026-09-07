// 用完整車體佔用回饋約束求解器；每輪仍以獨立資源掃描驗證，不能只信 solver 回傳可行。
import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';
import {isScheduledTurnback} from '../rail-3d/physical/turnbacks.js';
import {makeTopology} from '../rail-3d/physical/topology.js';import {stationKey,segmentTime} from '../rail-3d/physical/timing.js';import {vehicleReservations} from '../rail-3d/physical/reservations.js';
const n=JSON.parse(fs.readFileSync('.cache/physical-tracks/routes.json')),g=makeTopology(JSON.parse(fs.readFileSync('.cache/physical-tracks/routed-source.json'))),all=JSON.parse(fs.readFileSync('.cache/physical-tracks/timetable.json'));
if(process.env.DIRECTIONAL)Object.assign(n.pairs,JSON.parse(fs.readFileSync(process.env.DIRECTIONAL)).pairs);
all.sort((a,b)=>a.stops[0].arrSec-b.stops[0].arrSec||a.id.localeCompare(b.id));const selected=(process.env.SYSTEM?all.filter(t=>t.system===process.env.SYSTEM):all).filter(t=>!process.env.TRAINS||process.env.TRAINS.split(',').includes(t.id.split(':')[1])),trains=process.env.COUNT?selected.slice(0,+process.env.COUNT):selected,pairs={},transitions={};
for(const tr of trains){tr.pairs=tr.stops.slice(1).map((b,i)=>stationKey(tr.system,tr.stops[i].name)+'>'+stationKey(tr.system,b.name));for(const key of tr.pairs)pairs[key]=n.pairs[key];for(let i=1;i<tr.pairs.length;i++){
 const before=tr.pairs[i-1],after=tr.pairs[i],key=before+'~'+after;if(transitions[key])continue;
 const allowed=[];for(const a of pairs[before])for(const b of pairs[after]){const x=n.paths[a],y=n.paths[b];if(x.to===y.from&&(isScheduledTurnback(tr.system,tr.stops[i].name,x,y)||g.canTurn(x.nodeIds.at(-2),x.to,y.nodeIds[1],g.edges.get(x.edgeIds.at(-1)),g.edges.get(y.edgeIds[0]))))allowed.push([a,b]);}if(!allowed.length)throw Error('整趟路徑無法連續 '+key);transitions[key]=allowed;
}}
const handoffs=[];for(let ai=0;ai<trains.length;ai++){const a=trains[ai],end=a.stops.at(-1);if(a.system!=='afr_sched'||end.depSec-end.arrSec<=180)continue;for(let bi=0;bi<trains.length;bi++){const b=trains[bi],start=b.stops[0];if(a===b||a.system!==b.system||end.name!==start.name||end.arrSec!==start.arrSec||end.depSec!==start.depSec||a.stops.at(-2).name!==b.stops[1]?.name)continue;const allowed=[];for(const x of pairs[a.pairs.at(-1)])for(const y of pairs[b.pairs[0]]){const p=n.paths[x],q=n.paths[y];if(p.to===q.from&&p.nodeIds.at(-2)===q.nodeIds[1])allowed.push([x,y]);}if(allowed.length)handoffs.push({a:ai,b:bi,allowed});}}
const sameHandoff=(a,b)=>handoffs.some(h=>trains[h.a].id===a&&trains[h.b].id===b||trains[h.a].id===b&&trains[h.b].id===a);
const networkSha256=createHash('sha256').update(fs.readFileSync('.cache/physical-tracks/routes.json')).digest('hex');
const input='.cache/physical-tracks/optimization-input-'+(process.env.SYSTEM||'all')+'.json',hints=JSON.parse(fs.readFileSync('output/dispatch-coord-all.json')).plans;
if(process.env.WARM_PLANS)Object.assign(hints,JSON.parse(fs.readFileSync(process.env.WARM_PLANS)).plans);
// 暖啟動缺少的車次先選一條全程連續的候選，沒有衝突的車保持原股道。
for(const tr of trains)if(!hints[tr.id]){let states=[{id:null,pathIds:[],cost:0}];for(let i=0;i<tr.pairs.length;i++){const next=[];for(const id of pairs[tr.pairs[i]]){let best=null;for(const old of states){if(i&&!transitions[tr.pairs[i-1]+'~'+tr.pairs[i]].some(([a,b])=>a===old.id&&b===id))continue;const cost=old.cost+(n.paths[id].preference||0)+n.paths[id].lengthM*.00001;if(!best||cost<best.cost)best={id,pathIds:[...old.pathIds,id],cost};}if(best)next.push(best);}states=next;}if(!states.length)throw Error('缺少連續初始路徑 '+tr.id);hints[tr.id]=states.sort((a,b)=>a.cost-b.cost)[0];}
fs.writeFileSync(input,JSON.stringify({trains:trains.map(t=>({...t,stops:t.stops.map(s=>({name:s.name,arrSec:s.arrSec,depSec:s.depSec}))})),pairs,transitions,handoffs,hints,maxWaitSec:+process.env.MAX_WAIT||600,fixedOrder:!!process.env.FIXED_ORDER,focus:!!process.env.FOCUS}));
const processSolver=spawn('python3',['scripts/optimize_physical_dispatch.py',input],{stdio:['pipe','pipe','inherit']}),reader=createInterface({input:processSolver.stdout}),iterator=reader[Symbol.asyncIterator]();let previous=JSON.parse((await iterator.next()).value);console.log(previous);let conflicts=[];
const index=new Map(trains.map((t,i)=>[t.id,i]));let final=null;const focused=new Set();
if(process.env.EAGER){const {candidateConflicts}=await import('./lib/physical_candidate_conflicts.mjs');conflicts=candidateConflicts(n,trains,pairs,{maxWaitSec:+process.env.EAGER_WINDOW||+process.env.MAX_WAIT||600,orderSameDirection:!!process.env.ORDER_SAME_DIRECTION,progress:console.log});console.log({eagerConstraints:conflicts.length});for(let i=0;i<conflicts.length;i+=10000){processSolver.stdin.write(JSON.stringify({conflicts:conflicts.slice(i,i+10000),addOnly:true,alreadyUnique:true})+'\n');const ack=await iterator.next();if(ack.done)throw Error('約束匯入中斷');if(i%200000===0)console.log({imported:i,total:conflicts.length});}conflicts=[];}
if(process.env.WARM_CONSTRAINTS){const warm=JSON.parse(fs.readFileSync(process.env.WARM_PLANS));if(warm.networkSha256!==networkSha256)throw Error('暖啟動股道路網版本不同');const oldIds=Object.keys(warm.plans),unique=new Map();for(const line of fs.readFileSync(process.env.WARM_CONSTRAINTS,'utf8').trim().split('\n'))for(const c of JSON.parse(line).conflicts){const a=index.get(oldIds[c.a.trainIndex]),b=index.get(oldIds[c.b.trainIndex]);if(a===undefined||b===undefined)continue;c.a.trainIndex=a;c.b.trainIndex=b;unique.set(JSON.stringify(c),c);}conflicts=[...unique.values()];console.log({warmConstraints:conflicts.length});}
try{
 for(let round=0;round<200;round++){
  let result;for(let attempt=0;attempt<4;attempt++){processSolver.stdin.write(JSON.stringify({conflicts:attempt?[]:conflicts,seconds:(+process.env.SOLVE_SECONDS||30)*2**attempt,focused:[...focused]})+'\n');const response=await iterator.next();if(response.done)throw Error('求解程序中止');result=JSON.parse(response.value);if(result.release?.length){for(const i of result.release)focused.add(i);console.log({releaseFixed:result.release.length});attempt--;continue;}if(result.plans||result.status!=='UNKNOWN')break;console.log({round,retry:attempt+1,status:result.status});}if(!result.plans){fs.writeFileSync('output/dispatch-solver-failure.json',JSON.stringify(result));throw Error('尚無可驗證的安排 '+JSON.stringify({...result,core:result.core?.slice(0,10)}));}
  const booked=new Map();for(const tr of trains){const p=result.plans[tr.id],schedule=tr.stops.map((s,i)=>({arrSec:s.arrSec+(tr.delaySec||0)+(i?p.departureHolds[i-1]:p.departureHolds[0]),depSec:s.depSec+(tr.delaySec||0)+p.departureHolds[i]}));
   p.holds=schedule.map((s,i)=>({arrival:s.arrSec-tr.stops[i].arrSec-(tr.delaySec||0),departure:s.depSec-tr.stops[i].depSec-(tr.delaySec||0)}));
   for(const r of vehicleReservations(n,tr,p.pathIds,schedule)){if(!booked.has(r.resource))booked.set(r.resource,[]);booked.get(r.resource).push(r);}
  }
  const found=[];for(const list of booked.values()){list.sort((a,b)=>a.start-b.start);const active=[];for(const b of list){for(let i=active.length-1;i>=0;i--)if(active[i].end<=b.start+.001)active.splice(i,1);for(const a of active)if(a.train!==b.train&&!sameHandoff(a.train,b.train)&&Math.min(a.end,b.end)-Math.max(a.start,b.start)>.001)found.push({a,b});active.push(b);}}
  const serialize=r=>{
   const ti=index.get(r.train),tr=trains[ti],plan=result.plans[r.train],owner=r.owners[0],i=owner.segment,p=n.paths[plan.pathIds[i]],half=(tr.lengthM||240)/2+3;
   function ref(distance,end){
    if(distance<0){if(i===0)return {stop:0,base:tr.stops[0].arrSec};const candidates=n.pairs[tr.pairs[i-1]].map(id=>n.paths[id]).filter(q=>q.to===p.from);
     if(candidates.some(q=>q.lengthM+distance<0))return null;
     return {stop:i-1,base:Math.min(...candidates.map(q=>tr.stops[i-1].depSec+segmentTime(tr.stops[i-1],tr.stops[i],(q.lengthM+distance)/q.lengthM,{system:tr.system})))};
    }
    if(distance>p.lengthM){if(i===tr.pairs.length-1)return {stop:i+1,base:tr.stops[i+1].depSec};const candidates=n.pairs[tr.pairs[i+1]].map(id=>n.paths[id]).filter(q=>q.from===p.to),extra=distance-p.lengthM;
     if(candidates.some(q=>extra>q.lengthM))return null;
     return {stop:i+1,base:Math.max(...candidates.map(q=>tr.stops[i+1].depSec+segmentTime(tr.stops[i+1],tr.stops[i+2],extra/q.lengthM,{system:tr.system})))};
    }
    if(distance<.00001)return {stop:end?i:Math.max(0,i-1),base:end?tr.stops[i].depSec:tr.stops[i].arrSec};
    if(p.lengthM-distance<.00001)return {stop:end?i+1:i,base:end?tr.stops[i+1].depSec:tr.stops[i+1].arrSec};
    return {stop:i,base:tr.stops[i].depSec+segmentTime(tr.stops[i],tr.stops[i+1],distance/p.lengthM,{system:tr.system})};
   }
   // 車身跨站界的部分取所有相接股道的保守包絡，讓約束不因隔壁站換股而失效。
   let offset=0;for(let k=0;k<i;k++)offset+=n.paths[plan.pathIds[k]].lengthM;
   const start=ref(owner.d0-offset-half,false),end=ref(owner.d1-offset+half,true);
   if(start&&end)return {trainIndex:ti,variables:[[i,plan.pathIds[i]]],startRef:{stop:start.stop,base:Math.floor((start.base+(tr.delaySec||0)-2)*10)},endRef:{stop:end.stop,base:Math.ceil((end.base+(tr.delaySec||0)+2)*10)}};
   return {trainIndex:ti,variables:r.variables,startRef:{stop:r.startRef.stop,base:Math.floor(r.startRef.base*10)},endRef:{stop:r.endRef.stop,base:Math.ceil(r.endRef.base*10)}};
  };
  for(const {a,b}of found){focused.add(index.get(a.train));focused.add(index.get(b.train));}console.log({focused:focused.size});
  const unique=new Map();
  // 同一段共用股道採一致先後順序；把碎線段約束合併，並提早涵蓋可能的等候範圍。
  for(const list of booked.values()){
   const possible=list.map(r=>({r,c:serialize(r)})).sort((a,b)=>a.c.startRef.base-b.c.startRef.base),active=[];
   for(const item of possible){for(let i=active.length-1;i>=0;i--)if(active[i].c.endRef.base+(+process.env.MAX_WAIT||600)*10<=item.c.startRef.base)active.splice(i,1);
    for(const other of active){if(item.r.train===other.r.train||sameHandoff(item.r.train,other.r.train))continue;let a=other.c,b=item.c;if(a.trainIndex>b.trainIndex)[a,b]=[b,a];
     const key=JSON.stringify([a.trainIndex,a.variables,a.startRef.stop,a.endRef.stop,b.trainIndex,b.variables,b.startRef.stop,b.endRef.stop]),da=a.endRef.base-b.startRef.base,db=b.endRef.base-a.startRef.base;
     const prior=unique.get(key);if(prior){prior.a.endRef.base=Math.max(prior.a.endRef.base,da);prior.b.endRef.base=Math.max(prior.b.endRef.base,db);}
     else unique.set(key,{a:{...a,startRef:{stop:a.startRef.stop,base:0},endRef:{stop:a.endRef.stop,base:da}},b:{...b,startRef:{stop:b.startRef.stop,base:0},endRef:{stop:b.endRef.stop,base:db}}});
    }active.push(item);
   }
  }
  conflicts=[...unique.values()];fs.appendFileSync(process.env.CONSTRAINT_OUT||'output/dispatch-optimizer-constraints.jsonl',JSON.stringify({round,conflicts})+'\n');
  console.log({round,status:result.status,constraints:result.constraints,collisions:found.length,added:conflicts.length,holdCost:result.objective,maxHoldSec:Math.max(...Object.values(result.plans).flatMap(p=>p.departureHolds))});
  fs.writeFileSync('output/dispatch-optimizer-progress-'+(process.env.SYSTEM||'all')+'.json',JSON.stringify({round,conflicts:found.length,plans:result.plans}));
  if(!found.length){final={plans:result.plans,failures:[],conflicts:0,networkSha256,source:n.source,nodeSource:n.nodeSource,handoffs:handoffs.map(h=>({from:trains[h.a].id,to:trains[h.b].id,basis:'matching-timetable-turnaround'}))};break;}
 }
 if(!final)throw Error('股道與放行安排尚未收斂');fs.writeFileSync(process.env.OUT||'output/dispatch-optimized.json',JSON.stringify(final));console.log('PASS',Object.keys(final.plans).length,'班完整車體、道岔、停靠與通過資源無重疊');
}finally{processSolver.stdin.end(JSON.stringify({stop:true})+'\n');await new Promise(resolve=>processSolver.on('exit',resolve));}
