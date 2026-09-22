// OSM 節點連通路徑；停車候選以官方站點查找，不把圖上距離當成道岔。
import fs from 'node:fs';
import {makeTopology} from '../rail-3d/physical/topology.js';
import {inferPhysicalStops} from './lib/infer_physical_stops.mjs';
import {distanceM} from '../rail-3d/integration/train-path.js';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const data=read('.cache/physical-tracks/network-with-stations.json');let graph=makeTopology(data);
const normalize=n=>String(n).replaceAll('臺','台').replace(/\s*[（(].*?[）)]/g,'').replace(/-環島$/,'').trim();
const stations={},pairs=new Map(),systems={tra_sched:['tra','tra_schedule'],thsr_sched:['thsr_track','thsr_schedule_dense'],afr_sched:['afr','afr_schedule_dense']};
const official={};for(const st of Object.values(read('data/tra_station_info.json'))){const key=normalize(st.name);if(!official[key]||st.name.length<official[key].name.length)official[key]=st;}
for(const [sys,[file,schedule]]of Object.entries(systems)){
 for(const ln of read('data/'+file+'.json').lines)for(const st of ln.stations){const key=sys+':'+normalize(st.name);stations[key]={...st,...(sys==='tra_sched'?official[normalize(st.name)]:{}),key,system:sys};}
 for(const tr of read('data/'+schedule+'.json').trains)for(let i=1;i<tr.stops.length;i++){
  const a=sys+':'+normalize(tr.stops[i-1].name),b=sys+':'+normalize(tr.stops[i].name);if(a===b)continue;
  if(!stations[a]||!stations[b])throw Error('班表站點未對應 '+a+' '+b);
  pairs.set(a+'>'+b,{from:a,to:b,system:sys});
 }
}
const inferredStops=inferPhysicalStops(data,graph,stations);graph=makeTopology(data);fs.writeFileSync(new URL('.cache/physical-tracks/routed-source.json',root),JSON.stringify(data));
// 未標記停車點只從相同系統、實際連續股道上取最近的來源節點；不產生假側移。
for(const st of Object.values(stations)){
 st.candidates=graph.stopCandidates(st,st.system);
 if(!st.candidates.length){const groups=new Map(),coord=[st.lon,st.lat];for(const n of graph.nodes.values()){
  if(!n.edges.some(e=>e.system===st.system&&!['yard','spur','crossover'].includes(e.tags.service))||n.tags.railway==='switch')continue;
  const distance=distanceM(n.coordinate,coord);if(distance>250)continue;const key=st.system+':'+(graph.trackGroups.get(n.id)||n.id),old=groups.get(key);
  if(!old||distance<old.distance)groups.set(key,{nodeId:n.id,coordinate:n.coordinate,trackGroup:key,source:'estimated-stop-on-osm-track',trackRefs:[],distance});
 }st.candidates=[...groups.values()].sort((a,b)=>a.distance-b.distance).slice(0,8);}
}
// 班表密化後新增的通過站也要有連續路徑；兩個方向各保留一組。
for(const [sys,[file]]of Object.entries(systems))for(const ln of read('data/'+file+'.json').lines)for(let i=1;i<ln.stations.length;i++){
 const a=sys+':'+normalize(ln.stations[i-1].name),b=sys+':'+normalize(ln.stations[i].name);
 if(a!==b){pairs.set(a+'>'+b,{from:a,to:b,system:sys});pairs.set(b+'>'+a,{from:b,to:a,system:sys});}
}
const result={version:1,inferredStops,source:data.source,nodeSource:data.nodeSource,railElevationM:null,assignmentBasis:'inferred',stations,pairs:{},paths:[],nodes:{},edges:{}};
const memo=new Map();let done=0;for(const [key,pair]of pairs){
 const a=stations[pair.from],b=stations[pair.to],options=[];
 for(const ca of a.candidates)for(const cb of b.candidates){const cache=pair.system+':'+ca.nodeId+'>'+cb.nodeId;let paths=memo.get(cache);
  if(!paths){const direct=distanceM(ca.coordinate,cb.coordinate),maxLength=Math.max(1500,direct*(pair.system==='afr_sched'?9:4)+1000);
   const primary=graph.shortestPath({from:ca.nodeId,to:cb.nodeId,system:pair.system,maxLength,allowYard:pair.system==='afr_sched'});paths=[];
   if(primary){paths.push(primary);const pivot=primary.edgeIds[Math.floor(primary.edgeIds.length/2)];
    if(pivot){const alt=graph.shortestPath({from:ca.nodeId,to:cb.nodeId,system:pair.system,maxLength:primary.lengthM*1.15+100,allowYard:pair.system==='afr_sched',blocked:new Set([graph.edges.get(pivot).resource])});if(alt)paths.push(alt);}
   }memo.set(cache,paths);
  }
  for(const path of paths){const center=list=>[list.reduce((v,c)=>v+c.coordinate[0],0)/list.length,list.reduce((v,c)=>v+c.coordinate[1],0)/list.length];
   const side=(c,mid,x,y)=>{const scale=Math.cos(c[1]*Math.PI/180),dx=(y[0]-x[0])*scale,dy=y[1]-x[1],ox=(c[0]-mid[0])*scale*111320,oy=(c[1]-mid[1])*111320;return (dx*oy-dy*ox)/(Math.hypot(dx,dy)||1);};
   // 推估方向慣例而非官方行車方向：在來源股道中維持相同相對側，減少不必要的換線。
   const aSide=side(ca.coordinate,center(a.candidates),path.coordinates[0],path.coordinates[1]),bSide=side(cb.coordinate,center(b.candidates),path.coordinates.at(-2),path.coordinates.at(-1));
   const preference=(Math.max(0,-aSide)+Math.max(0,-bSide))*10+path.edgeIds.filter(id=>graph.edges.get(id).tags.service==='crossover').length*2;
   const id=result.paths.length;const record={from:ca.nodeId,to:cb.nodeId,fromGroup:ca.trackGroup,toGroup:cb.trackGroup,system:pair.system,nodeIds:path.nodeIds,edgeIds:path.edgeIds,lengthM:path.lengthM,preference};result.paths.push(record);options.push(id);
   for(const node of path.nodeIds)result.nodes[node]={coordinate:graph.nodes.get(node).coordinate,tags:graph.nodes.get(node).tags};
   for(const id of path.edgeIds){const e=graph.edges.get(id);result.edges[id]={a:e.a,b:e.b,resource:e.resource,length:e.length,wayId:e.wayId,system:e.system,tags:e.tags};}
  }
 }
 result.pairs[key]=options;done++;if(done%50===0)console.log(done+'/'+pairs.size,'paths',result.paths.length);
}
const missing=Object.entries(result.pairs).filter(([,ids])=>!ids.length).map(([key])=>key),summary={pairs:pairs.size,covered:pairs.size-missing.length,paths:result.paths.length,stations:Object.keys(stations).length,missing};
fs.mkdirSync(new URL('.cache/physical-tracks/',root),{recursive:true});fs.writeFileSync(new URL('.cache/physical-tracks/routes.json',root),JSON.stringify(result));fs.writeFileSync(new URL('output/physical-route-coverage.json',root),JSON.stringify(summary,null,2));console.log(summary);
