// 從已出貨的 network.json 還原派車管線的中繼檔(OSM 快照與 .cache/physical-tracks 已不在磁碟),
// 台鐵／林鐵沿用既有路徑與派車;高鐵候選路徑依真實月台配置重建,班表改用 TDX 逐日時刻表。
// 用法:node scripts/rebuild_physical_cache.mjs .cache/physical-tracks/thsr-daily/*.json
//   之後每個日型各跑一次 SYSTEM=thsr_sched TIMETABLE=<日型檔> OUT=<結果檔> node scripts/optimize_physical_dispatch.mjs,
//   再 node scripts/assemble_physical_dispatch.mjs output/dispatch-passthrough.json <結果檔...>、node scripts/pack_physical_network.mjs。
import fs from 'node:fs';
import {makeTopology} from '../rail-3d/physical/topology.js';
import {distanceM} from '../rail-3d/integration/train-path.js';
import {stationKey} from '../rail-3d/physical/timing.js';
import {physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/plan-binding.js';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),write=(p,v)=>fs.writeFileSync(new URL(p,root),JSON.stringify(v));
const dayFiles=process.argv.slice(2);if(!dayFiles.length)throw Error('必須指定高鐵逐日時刻表(TDX Rail/THSR/DailyTimetable/TrainDate 原始回應)');
const net=read('rail-3d/physical/network.json'),dispatch=read('rail-3d/physical/dispatch.json');

// 1. 路網底稿:network.json 保留全部來源股道、節點座標、節點標記與系統歸屬。
const nodes={};for(const w of net.ways)w.nodes.forEach((id,i)=>{nodes[id]=w.coordinates[i];});
const source={source:net.source,nodeSource:net.nodeSource,ways:net.ways.map(w=>({id:w.id,tags:w.tags,nodes:w.nodes})),nodes,nodeTags:net.nodeTags,systemByWay:Object.fromEntries(net.ways.map(w=>[w.id,w.system]))};
const g=makeTopology(source);

// 2. 舊路徑原編號還原(台鐵／林鐵派車直接引用這些編號),每一條都必須逐邊對回拓撲。
const paths=[];
for(const [pid,p] of Object.entries(net.paths)){
 const edgeIds=[],nodeIds=[];
 for(const [wi,ix,steps] of p.walk){const w=net.ways[wi],dir=Math.sign(steps);for(let k=0;k<Math.abs(steps);k++){const e=ix+k*dir,[from,to]=dir>0?[w.nodes[e],w.nodes[e+1]]:[w.nodes[e+1],w.nodes[e]];if(!nodeIds.length)nodeIds.push(from);else if(nodeIds.at(-1)!==from)throw Error('舊路徑不連續 '+pid);nodeIds.push(to);edgeIds.push(w.id+':'+e);}}
 for(const id of edgeIds)if(!g.edges.has(id))throw Error('舊路徑的邊不在拓撲 '+pid+' '+id);
 if(nodeIds[0]!==p.from||nodeIds.at(-1)!==p.to)throw Error('舊路徑端點不符 '+pid);
 paths[+pid]={from:p.from,to:p.to,fromGroup:p.fromGroup,toGroup:p.toGroup,system:p.system,nodeIds,edgeIds,lengthM:p.lengthM,preference:p.preference};
}
for(let i=0;i<paths.length;i++)if(!paths[i])paths[i]=null;
const edges={};for(const e of g.edges.values())edges[e.id]={a:e.a,b:e.b,resource:e.resource,length:e.length,wayId:e.wayId,system:e.system,tags:e.tags};

// 3. 高鐵停車候選。高鐵站只停 OSM 標的停車點,不用推估點;有通過線的車站,外側側線才是到發線(月台),
//    內側正線只供通過——停靠列車一律停外側、通過列車一律走內側(使用者 2026-09-12 指正,桃園最明顯)。
const THROUGH=new Set(['板橋','桃園','新竹','苗栗','台中','彰化','雲林','嘉義','台南']);
const normalize=n=>String(n).replaceAll('臺','台');
const trackKinds=id=>[...new Set(g.nodes.get(id).edges.filter(e=>e.system==='thsr_sched').map(e=>e.tags.service||e.tags.usage||'?'))];
const stations={},report=[];
for(const st of read('data/thsr_track.json').lines[0].stations){
 const name=normalize(st.name),key=stationKey('thsr_sched',name),all=g.stopCandidates({name,lon:st.lon,lat:st.lat},'thsr_sched');
 const kept=all.filter(c=>{if(c.source!=='osm-stop-position')return false;const kinds=trackKinds(c.nodeId);return !THROUGH.has(name)||kinds.length===1&&kinds[0]==='siding';});
 if(kept.length<2)throw Error('高鐵站停車候選不足 '+name+' '+JSON.stringify(all.map(c=>[c.nodeId,c.source,trackKinds(c.nodeId)])));
 stations[key]={name,lon:st.lon,lat:st.lat,key,system:'thsr_sched',candidates:kept};
 report.push({name,through:THROUGH.has(name),kept:kept.map(c=>trackKinds(c.nodeId).join('+')+'@'+Math.round(distanceM(c.coordinate,[st.lon,st.lat]))+'m'),dropped:all.filter(c=>!kept.includes(c)).map(c=>trackKinds(c.nodeId).join('+')+(c.source==='osm-stop-position'?'':'*'))});
}

// 4. 高鐵班表:TDX 逐日時刻表轉成正式站 /api/thsr-schedule 的同一種文件(語意同 worker.js thsrConvertDaily),
//    再套前端綁定前的中途離站 +30 秒(index.html HSR_DEP_MID_SEC),派車鍵與停靠簽章才對得上。
const stationMap=new Map();for(const t of read('data/thsr_schedule_dense.json').trains)for(const s of t.stops)if(!stationMap.has(s.name))stationMap.set(s.name,true);
const hms=t=>{const p=String(t).split(':').map(Number);return p[0]*3600+p[1]*60+(p[2]||0);};
const HSR_DEP_MID_SEC=30,THSR_LENGTH_M=304;
function convertDaily(daily){
 const trains=[];
 for(const rec of daily){
  const info=rec.DailyTrainInfo||{},seq=(rec.StopTimes||[]).slice().sort((a,b)=>a.StopSequence-b.StopSequence);
  if(seq.length<2||seq.some(s=>!s.StationName?.Zh_tw||!stationMap.has(s.StationName.Zh_tw)))continue;
  const stops=[];let prev=-1;
  for(const s of seq){let arr=hms(s.ArrivalTime||s.DepartureTime),dep=hms(s.DepartureTime||s.ArrivalTime);while(arr<prev)arr+=86400;while(dep<arr)dep+=86400;stops.push({name:normalize(s.StationName.Zh_tw),arrSec:arr,depSec:dep});prev=dep;}
  for(let i=0;i<stops.length-1;i++)stops[i].depSec+=HSR_DEP_MID_SEC;
  const tr={system:'thsr_sched',train:info.TrainNo,stops,lengthM:THSR_LENGTH_M};tr.id=physicalTrainKey(tr);trains.push(tr);
 }
 return trains;
}
const days=[];
for(const file of dayFiles){const trains=convertDaily(JSON.parse(fs.readFileSync(file))),sig=trains.map(t=>t.id).sort().join('|');let day=days.find(d=>d.sig===sig);if(!day){day={sig,trains,files:[]};days.push(day);}day.files.push(file.split('/').at(-1));}

// 5. 高鐵站間候選路徑:中途站的月台股道(側線)一律不進,只在起訖站 1.5 km 內准進側線;
//    同一站間只留同側(左行)且不用渡線的候選——另一側月台屬於對向,不當備選。
const SIDING_REACH_M=1500;
const pairs=new Map();for(const d of days)for(const tr of d.trains)for(let i=1;i<tr.stops.length;i++){const a=stationKey('thsr_sched',tr.stops[i-1].name),b=stationKey('thsr_sched',tr.stops[i].name);if(a===b)continue;if(!stations[a]||!stations[b])throw Error('班表站點未對應 '+a+' '+b);pairs.set(a+'>'+b,{from:a,to:b});}
const result={version:1,inferredStops:net.inferredStops,source:net.source,nodeSource:net.nodeSource,railElevationM:null,assignmentBasis:'inferred',stations,pairs:{},paths,nodes:{},edges};
const center=list=>[list.reduce((v,c)=>v+c.coordinate[0],0)/list.length,list.reduce((v,c)=>v+c.coordinate[1],0)/list.length];
const side=(c,mid,x,y)=>{const scale=Math.cos(c[1]*Math.PI/180),dx=(y[0]-x[0])*scale,dy=y[1]-x[1],ox=(c[0]-mid[0])*scale*111320,oy=(c[1]-mid[1])*111320;return (dx*oy-dy*ox)/(Math.hypot(dx,dy)||1);};
let dropped=0;
for(const [key,pair] of pairs){
 const a=stations[pair.from],b=stations[pair.to],options=[];
 for(const ca of a.candidates)for(const cb of b.candidates){
  const near=e=>Math.min(...[e.a,e.b].flatMap(n=>[distanceM(g.nodes.get(n).coordinate,ca.coordinate),distanceM(g.nodes.get(n).coordinate,cb.coordinate)]))<=SIDING_REACH_M;
  const edgeAllowed=e=>e.tags.service!=='siding'||near(e);
  const direct=distanceM(ca.coordinate,cb.coordinate),maxLength=Math.max(1500,direct*4+1000),found=[];
  const primary=g.shortestPath({from:ca.nodeId,to:cb.nodeId,system:'thsr_sched',maxLength,edgeAllowed});
  if(primary){found.push(primary);const pivot=primary.edgeIds[Math.floor(primary.edgeIds.length/2)];if(pivot){const alt=g.shortestPath({from:ca.nodeId,to:cb.nodeId,system:'thsr_sched',maxLength:primary.lengthM*1.15+100,blocked:new Set([g.edges.get(pivot).resource]),edgeAllowed});if(alt)found.push(alt);}}
  for(const path of found){
   const aSide=side(ca.coordinate,center(a.candidates),path.coordinates[0],path.coordinates[1]),bSide=side(cb.coordinate,center(b.candidates),path.coordinates.at(-2),path.coordinates.at(-1));
   const preference=(Math.max(0,-aSide)+Math.max(0,-bSide))*10+path.edgeIds.filter(id=>g.edges.get(id).tags.service==='crossover').length*2;
   const id=paths.length;paths.push({from:ca.nodeId,to:cb.nodeId,fromGroup:ca.trackGroup,toGroup:cb.trackGroup,system:'thsr_sched',nodeIds:path.nodeIds,edgeIds:path.edgeIds,lengthM:path.lengthM,preference});options.push(id);
   for(const n of path.nodeIds)result.nodes[n]={coordinate:g.nodes.get(n).coordinate,tags:g.nodes.get(n).tags};
  }
 }
 if(!options.length)throw Error('高鐵站間沒有連通路徑 '+key);
 const best=Math.min(...options.map(id=>paths[id].preference));
 result.pairs[key]=options.filter(id=>paths[id].preference===best);dropped+=options.length-result.pairs[key].length;
}

// 6. 班表:台鐵／林鐵從既有派車還原(簽章與鍵必須一字不差),高鐵為各日型的聯集。
const passthrough={},trains=[];
for(const [id,p] of Object.entries(dispatch.plans)){
 const system=id.split(':')[0];if(system==='thsr_sched')continue;passthrough[id]=p;
 const tr={id,system,train:id.split(':')[1],stops:JSON.parse(p.stopSignature).map(([k,arrSec,depSec])=>({name:k.slice(system.length+1),arrSec,depSec})),lengthM:p.lengthM};
 if(physicalStopSignature(tr)!==p.stopSignature||physicalTrainKey(tr)!==id)throw Error('既有派車無法還原成班表 '+id);
 trains.push(tr);
}
const seen=new Set();for(const d of days)for(const tr of d.trains)if(!seen.has(tr.id)){seen.add(tr.id);trains.push(tr);}

fs.mkdirSync(new URL('.cache/physical-tracks/',root),{recursive:true});fs.mkdirSync(new URL('output/',root),{recursive:true});
write('.cache/physical-tracks/routed-source.json',source);
write('.cache/physical-tracks/routes.json',result);
write('.cache/physical-tracks/timetable.json',trains);
days.forEach((d,i)=>{d.file='.cache/physical-tracks/timetable-thsr-'+i+'.json';write(d.file,d.trains);});
write('output/dispatch-coord-all.json',{plans:dispatch.plans});
write('output/dispatch-passthrough.json',{plans:passthrough,handoffs:dispatch.handoffs||[],conflicts:0,failures:[],source:net.source,nodeSource:net.nodeSource});
console.log(JSON.stringify({oldPaths:Object.keys(net.paths).length,edges:Object.keys(edges).length,thsrPairs:pairs.size,thsrPaths:paths.length-Object.keys(net.paths).length,droppedOtherSide:dropped,passthroughPlans:Object.keys(passthrough).length,thsrTrains:seen.size,days:days.map(d=>({file:d.file,trains:d.trains.length,dates:d.files})),stations:report},null,1));
