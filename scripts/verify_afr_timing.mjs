// 官方停靠時刻不變；全林鐵發車、速度、連續性、折返與車身股道交集。
import fs from 'node:fs';import assert from 'node:assert/strict';import {runInContext} from 'node:vm';
import {makeSandbox} from './build_run_profiles.mjs';
import {createPhysicalMotion,physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/motion.js';
import {distanceM,formationPoses} from '../rail-3d/integration/train-path.js';
import {assembleFormation,formationFor} from '../rail-3d/integration/formations.js';
const read=p=>JSON.parse(fs.readFileSync(p)),pack=read('rail-3d/physical/network.json'),profiles=read('rail-3d/physical/display-profiles.json'),dispatch=read('rail-3d/physical/dispatch.json');
const ctx=makeSandbox('index.html'),track=read('data/afr.json');
const trains=read('data/afr_schedule_dense.json').trains.map(t=>({...t,sys:'afr_sched'}));
// 觀日列車逐日改點；用既有派軌的時刻作基準，另測平移後的路徑模板。
for(const no of ['97','98']){const entry=Object.entries(dispatch.plans).find(([k])=>k.startsWith('afr_sched:'+no+':'));
 const coords=new Map(track.lines.flatMap(l=>l.stations.map(s=>[s.name,s])));trains.push({sys:'afr_sched',train:no,carName:'祝山線',stops:JSON.parse(entry[1].stopSignature).map(([k,arrSec,depSec])=>({name:k.slice(10),arrSec,depSec,stop:depSec>arrSec,...coords.get(k.slice(10))}))});}
ctx.trains=trains;ctx.lines=track.lines;runInContext('assignSchedShapePathsFor(trains, lines)',ctx);
const original=trains.map(t=>JSON.stringify(t.stops.map(s=>[s.name,s.arrSec,s.depSec,s.stop]))),motion=createPhysicalMotion(pack,profiles,dispatch);
assert.equal(trains.length,52,'必須覆蓋全部本線／園區／觀日班次');
let runs=0,departures=0,samples=0,maxKmh=0,turns=0,handoffs=0,maxHandoffJump=0;
const catalog=read('rail-3d/assets/blender-map-v1/manifest.json'),parts=assembleFormation(formationFor({systemId:'afr_sched'}),catalog).parts;
for(const tr of trains){const r=motion.record(tr);assert(r,'必須使用實體股道 '+tr.train);assert.equal(r.afrTiming.fallbacks,0,'速度曲線不能退回等速 '+tr.train);runs+=r.afrTiming.runs;
 assert(r.holds.every(h=>!h.arrival&&!h.departure));assert.equal(r.maxHold,0);
 for(let i=0;i<r.stops.length;i++){const s=r.stops[i];if(s.stop!==false){assert.equal(s.arrSec,tr.stops[i].arrSec);assert.equal(s.depSec,tr.stops[i].depSec);}
  if(i===r.stops.length-1)continue;
  if(s.stop!==false){const a=motion.sample(tr,s.depSec),b=motion.sample(tr,s.depSec+1);assert(a?.dwell&&b&&!b.dwell&&b.chainageM>a.chainageM,'表定離站後必須立即開始移動 '+tr.train+' '+s.name);departures++;}
 }
 for(let t=r.schedule[0].depSec;t<r.schedule.at(-1).arrSec;t+=1){const a=motion.sample(tr,t),b=motion.sample(tr,Math.min(t+1,r.schedule.at(-1).arrSec-.0001));assert(a&&b,'途中不得消失 '+tr.train);
  const v=distanceM([a.lon,a.lat],[b.lon,b.lat])*3.6;assert(v<=45+1e-6,'林鐵模型速度上限 '+tr.train+' '+v);maxKmh=Math.max(maxKmh,v);samples++;}
 for(const i of r.reversals){const t=r.schedule[i].arrSec,a=motion.sample(tr,t-.001),b=motion.sample(tr,t+.001);assert(a&&b);assert.equal(a.formationFacing,-b.formationFacing);assert(distanceM([a.lon,a.lat],[b.lon,b.lat])<.001);turns++;}
 if(r.afrTiming.hideAt!=null){const t=r.afrTiming.hideAt,a=motion.sample(tr,t-.001);assert(a&&(a.dwell||t===r.schedule.at(-1).arrSec),'銜接須在終到後');assert.equal(motion.sample(tr,t),null);
  const next=trains.find(q=>q!==tr&&q.stops[0].arrSec===t&&q.stops[0].name===tr.stops.at(-1).name&&q.stops[1].name===tr.stops.at(-2).name);assert(next,'銜接必須有下一車次');
  const b=motion.sample(next,t),pa=formationPoses(a.route.path,a.chainageM,a.formationFacing,parts),pb=formationPoses(b.route.path,b.chainageM,b.formationFacing,parts);
  assert(distanceM([a.lon,a.lat],[b.lon,b.lat])<.001);if(pa&&pb)for(let j=0;j<pa.length;j++)maxHandoffJump=Math.max(maxHandoffJump,distanceM(pa[j].coordinate,pb[j].coordinate));handoffs++;
 }
}
assert.equal(turns,6);assert(handoffs>=19);assert(maxHandoffJump<1,'換車次不能把整列車翻到另一邊');
// 車身長度取產品的 70 m；逐秒全日掃描同股道交集，含停站中與對向車。
let overlap=0;for(let t=4*3600;t<=17*3600;t++){const booked=new Map();for(const tr of trains){const p=motion.sample(tr,t);if(!p)continue;const path=p.route.path,a=Math.max(0,p.chainageM-35),b=Math.min(path.length,p.chainageM+35);
 for(let i=path.at(a).index;i<=path.at(b).index;i++){if(Math.min(b,path.d[i+1])-Math.max(a,path.d[i])<=.001)continue;const resource=p.route.edges[i].resource,other=booked.get(resource);if(other&&other!==String(tr.train)){overlap++;if(overlap<5)console.error('交疊',t,other,tr.train,resource);}booked.set(resource,String(tr.train));}}}
assert.equal(overlap,0,'準時發車不可用車身互穿換取');
// 非林鐵仍保留原派軌等待；避免把此修正套到高鐵／台鐵。
for(const sys of ['tra_sched','thsr_sched']){const base=trains.find(t=>String(t.train)==='33'),tr={...base,sys},p=dispatch.plans[physicalTrainKey(base)],d={plans:{[physicalTrainKey(tr)]:{...p,stopSignature:physicalStopSignature(tr)}}};
 const m=createPhysicalMotion(pack,profiles,d),r=m.record(tr);assert.equal(r.holds[0].departure,124);assert.equal(r.schedule[0].depSec,tr.stops[0].depSec+124);}
// 觀日班次平移依然準時，不能重新吃到模板的等待。
for(const no of ['97','98']){const base=trains.find(t=>String(t.train)===no),tr={...base,stops:base.stops.map(s=>({...s,arrSec:s.arrSec+900,depSec:s.depSec+900}))};const r=motion.record(tr);assert(r?.bindingBasis.startsWith('route-template'));assert.equal(r.schedule[0].depSec,tr.stops[0].depSec);assert(motion.sample(tr,tr.stops[0].depSec+1)?.f>0);}
trains.forEach((t,i)=>assert.equal(JSON.stringify(t.stops.map(s=>[s.name,s.arrSec,s.depSec,s.stop])),original[i],'不改共享班表'));
console.log({trains:trains.length,runs,departures,samples,maxKmh,turns,handoffs,maxHandoffJump,overlap});
