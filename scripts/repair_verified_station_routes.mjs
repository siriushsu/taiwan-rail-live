// 局部候選產生器：只補經來源覆核的太麻里月台股道與四班車的錯股路徑。
// 產物先寫 output；停站衝突下降只是候選條件，必須另跑真瀏覽器全日互穿、接站連續與層位閘門。
// 不改班表、不增加 hold、不把 OSM 推估派軌宣稱為官方當班月台。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {restorePhysicalRoutes} from './lib/restore_physical_routes.mjs';
import {createPlanBinding,physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/plan-binding.js';
import {formationFor} from '../rail-3d/integration/formations.js';
const read=f=>JSON.parse(fs.readFileSync(f)),net=read(process.env.NETWORK||'rail-3d/physical/network.json'),dispatch=read(process.env.DISPATCH||'rail-3d/physical/dispatch.json');
const sched=read('data/tra_schedule_dense.json'),special=read('data/tra_special_trains.json'),proof=read('scripts/fixtures/taimali-platform-track-0912.json');
const out=process.env.OUT||'output/verified-station-routes';fs.mkdirSync(out,{recursive:true});
const report={basis:proof.basis,addedWays:[],changes:[],lengthMetadata:[]};
const anchor=proof.elements.find(e=>e.type==='way'&&e.id===81151575),existing=net.ways.find(e=>String(e.id)==='81151575');
// 來源更新不能靜默重編舊 way 的節點序號；舊路徑以這個序號引用 edge。
assert.deepEqual(existing.nodes,anchor.nodes.map(String),'太麻里主線快照變動，須重查接頭');
for(const track of [proof,proof.dieselTrack]){
 const w=proof.elements.find(e=>e.type==='way'&&String(e.id)===track.allowedWay);
 assert.equal(w.tags.electrified,track===proof?'contact_line':'no');assert(w.nodes.includes(Number(track.stopNode)));
 for(const end of [w.nodes[0],w.nodes.at(-1)]){
  assert(existing.nodes.includes(String(end)),'兩端必須接回原有主線');
  assert.equal(proof.elements.find(e=>e.type==='node'&&e.id===end)?.tags.railway,'switch');
 }
 if(!net.ways.some(e=>String(e.id)===track.allowedWay)){
  net.ways.push({id:String(w.id),system:'tra_sched',nodes:w.nodes.map(String),coordinates:w.geometry.map(p=>[p.lon,p.lat]),tags:w.tags});
  report.addedWays.push(track.allowedWay);
 }
}
for(const e of proof.elements.filter(e=>e.type==='node'))if(e.tags)net.nodeTags[e.id]=e.tags;
const {g,paths}=restorePhysicalRoutes(net),wi=new Map(net.ways.map((w,i)=>[String(w.id),i]));
const fingerprint=p=>p.nodeIds.join(','),known=new Map(paths.flatMap((p,id)=>p?[[fingerprint(p),id]]:[]));
let nextId=paths.length;
function savePath(p,old){
 const key=fingerprint(p);if(known.has(key))return known.get(key);
 const id=nextId++,walk=p.edgeIds.map((eid,i)=>{const e=g.edges.get(eid);return [wi.get(e.wayId),+eid.slice(eid.lastIndexOf(':')+1),e.a===p.nodeIds[i]?1:-1];});
 const from=p.nodeIds[0],to=p.nodeIds.at(-1);
 net.paths[id]={...net.paths[old],from,to,fromGroup:'tra_sched:'+(g.trackGroups.get(from)||from),toGroup:'tra_sched:'+(g.trackGroups.get(to)||to),lengthM:p.lengthM,walk};
 paths[id]={...net.paths[id],nodeIds:p.nodeIds,edgeIds:p.edgeIds};known.set(key,id);return id;
}
function vector(a,b){const x=g.nodes.get(a).coordinate,y=g.nodes.get(b).coordinate;return [(y[0]-x[0])*Math.cos(x[1]*Math.PI/180),y[1]-x[1]];}
function joins(ids){for(let i=1;i<ids.length;i++){const a=paths[ids[i-1]],b=paths[ids[i]];if(a.to!==b.from||!g.canTurn(a.nodeIds.at(-2),a.to,b.nodeIds[1],g.edges.get(a.edgeIds.at(-1)),g.edges.get(b.edgeIds[0])))return false;}return true;}
// 同端點的來源路徑替换：限制增長 30 m，並檢查來向與去向，不跨到憑空造出的股道。
for(const fix of read('scripts/fixtures/physical-route-conflicts-0912.json').repairs)
for(const [key,p]of Object.entries(dispatch.plans).filter(([k])=>k.startsWith('tra_sched:'+fix.train+':'))){
 const at=p.pathIds.indexOf(fix.oldPath);if(at<0)continue;const old=paths[fix.oldPath];
 const candidate=g.shortestPath({from:old.from,to:old.to,system:'tra_sched',blocked:new Set(fix.blocked),maxLength:old.lengthM+30,
  startVector:vector(old.nodeIds[0],old.nodeIds[1]),endVector:vector(old.nodeIds.at(-2),old.nodeIds.at(-1))});
 assert(candidate,fix.train+' 缺少替代路徑');const id=savePath(candidate,fix.oldPath),ids=p.pathIds.slice();ids[at]=id;
 assert(joins(ids.slice(Math.max(0,at-1),at+2)),fix.train+' 替代路徑在接站倒車');p.pathIds=ids;
 report.changes.push({key,station:fix.station,fromPath:fix.oldPath,toPath:id,extraMetres:candidate.lengthM-old.lengthM});
}
const binding=createPlanBinding(dispatch),rows=new Map(),days=Object.keys(sched.dates).sort();
for(const day of days)for(const ix of sched.dates[day]){
 const raw=sched.trains[ix],tr={...raw,sys:'tra_sched'},i=tr.stops.findIndex(s=>s.name==='太麻里'&&s.stop!==false);if(i<=0||i>=tr.stops.length-1)continue;
 const key=physicalTrainKey(tr),bound=binding(tr);if(!bound?.plan)continue;
 if(!rows.has(key))rows.set(key,{key,tr,i,plan:structuredClone(bound.plan),days:new Set()});rows.get(key).days.add(day);
}
const nodeOf=r=>paths[r.plan.pathIds[r.i-1]].to;
function conflicts(){const found=[];for(const day of days){const rs=[...rows.values()].filter(r=>r.days.has(day));for(let a=0;a<rs.length;a++)for(let b=a+1;b<rs.length;b++){
 const x=rs[a],y=rs[b],xs=x.tr.stops[x.i],ys=y.tr.stops[y.i];if(nodeOf(x)===nodeOf(y)&&Math.min(xs.depSec,ys.depSec)>Math.max(xs.arrSec,ys.arrSec))found.push({x,y,day});
 }}return found;}
const cache=new Map();
const isBlue=tr=>special.namedTrains.find(n=>n.id===proof.dieselTrack.namedId)?.trainNos.includes(String(tr.train));
function reroute(oldId,from,to,diesel){
 const key=[oldId,from,to,diesel].join(':');if(cache.has(key))return cache.get(key);
 const old=paths[oldId],p=g.shortestPath({from,to,system:'tra_sched',maxLength:old.lengthM*1.05+30,allowYard:true,
  edgeAllowed:e=>!['yard','spur'].includes(e.tags.service)||e.wayId===proof.allowedWay||(diesel&&e.wayId===proof.dieselTrack.allowedWay),
  startVector:vector(old.nodeIds[0],old.nodeIds[1]),endVector:vector(old.nodeIds.at(-2),old.nodeIds.at(-1))});
 const id=p?savePath(p,oldId):null;cache.set(key,id);return id;
}
let best=conflicts();report.beforeDwellPairs=best.length;const changed=new Set();
for(let round=0;round<10;round++){
 const before=best.length;
 for(const r of [...new Set(best.flatMap(c=>[c.x,c.y]))]){
  const {i,plan}=r,oldNode=nodeOf(r);
  const diesel=isBlue(r.tr),options=diesel?[proof.dieselTrack.stopNode,proof.stopNode,'9267198336']:[proof.stopNode,'9267198336'];
  for(const node of options.filter(n=>n!==oldNode)){
   const ids=plan.pathIds;
   const a=reroute(ids[i-1],paths[ids[i-1]].from,node,diesel),b=reroute(ids[i],node,paths[ids[i]].to,diesel);if(a===null||b===null)continue;
   const save=ids.slice();ids[i-1]=a;ids[i]=b;
   if(!joins(ids.slice(Math.max(0,i-2),i+2))){plan.pathIds=save;continue;}
   const after=conflicts();if(after.length<best.length){best=after;changed.add(r.key);report.changes.push({key:r.key,station:'太麻里',fromNode:oldNode,toNode:node});break;}
   plan.pathIds=save;continue;
  }
 }
 if(best.length===before)break;
}
report.afterDwellPairs=best.length;report.remainingDwellPairs=best.map(c=>({day:c.day,a:c.x.tr.train,b:c.y.tr.train}));
for(const key of changed){const r=rows.get(key);dispatch.plans[key]={...r.plan,stopSignature:physicalStopSignature(r.tr),...(isBlue(r.tr)?{templateEligible:false}:{})};}
// 先前補落成的 PP 計畫把 14 節寫成 54.8 m；只同步中繼資料，不冒稱已依新長度重新求解。
for(const raw of sched.trains){const tr={...raw,sys:'tra_sched'},key=physicalTrainKey(tr),p=dispatch.plans[key];if(!p)continue;
 const stock=special.rollingStock.find(s=>s.carNames.includes(tr.carName)),named=special.namedTrains.find(s=>s.trainNos.includes(String(tr.train))),branch=special.branchLines.find(b=>tr.stops.some(s=>b.matchStations.includes(s.name)));
 const f=formationFor({systemId:tr.sys,carName:tr.carName,typeName:tr.typeName,stockId:stock?.id,namedId:named?.id,branchId:branch?.id},'actual');if(!f)continue;
 const length=+f.lengths.reduce((a,b)=>a+b,0).toFixed(4);if(Math.abs((p.lengthM??0)-length)>1e-6){report.lengthMetadata.push({key,before:p.lengthM,after:length});p.lengthM=length;}
}
// 丟掉候選搜尋中沒有被採用的新路徑；既有 ID／非台鐵計畫保持原樣。
const used=new Set(Object.values(dispatch.plans).flatMap(p=>p.pathIds));
const initialIds=new Set(Object.keys(read(process.env.NETWORK||'rail-3d/physical/network.json').paths));for(const id of Object.keys(net.paths))if(!initialIds.has(id)&&!used.has(+id))delete net.paths[id];
for(const w of net.ways)delete w._path;
fs.writeFileSync(out+'/network.json',JSON.stringify(net));fs.writeFileSync(out+'/dispatch.json',JSON.stringify(dispatch));fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
