import fs from 'node:fs';import {makeTopology} from '../rail-3d/physical/topology.js';import {inferPhysicalStops} from './lib/infer_physical_stops.mjs';import {distanceM,makePath} from '../rail-3d/integration/train-path.js';
const data=JSON.parse(fs.readFileSync('.cache/physical-tracks/network-with-stations.json')),lines=[],stations={},systems=['mrt','krtc','tymc','tmrt','ntdlrt','ntalrt','sanying'];let g=makeTopology(data);
for(const ln of JSON.parse(fs.readFileSync('.cache/physical-tracks/metro-lines.json'))){lines.push(ln);for(const st of ln.stations){const key=ln.system+':'+ln.id+':'+st.name;stations[key]={...st,key,system:ln.system,line:ln.key};}}
const inferred=[],insertions=new Map(),ways=new Map(data.ways.map(w=>[String(w.id),w])),inserted=new Map();
for(const st of Object.values(stations)){
 const ln=lines.find(l=>l.key===st.line),path=makePath(ln.shape.map(q=>[q[1],q[0]])),s=Math.max(0,Math.min(path.length,st.d*1000)),at=path.at(s),pa=path.at(Math.max(0,s-10)).coordinate,pb=path.at(Math.min(path.length,s+10)).coordinate,angle=Math.atan2(pb[1]-pa[1],(pb[0]-pa[0])*Math.cos(pa[1]*Math.PI/180)),origin=at.coordinate,mx=111320*Math.cos(origin[1]*Math.PI/180),byGroup=new Map();
 for(const e of g.edges.values()){
  if(e.system!==st.system||['yard','spur','crossover'].includes(e.tags.service))continue;const a=g.nodes.get(e.a).coordinate,b=g.nodes.get(e.b).coordinate,dx=(b[0]-a[0])*mx,dy=(b[1]-a[1])*111320,len=Math.hypot(dx,dy);if(Math.abs((dx*Math.cos(angle)+dy*Math.sin(angle))/len)<.8)continue;
  const ax=(a[0]-origin[0])*mx,ay=(a[1]-origin[1])*111320,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(len*len))),x=ax+dx*t,y=ay+dy*t,along=x*Math.cos(angle)+y*Math.sin(angle),side=-x*Math.sin(angle)+y*Math.cos(angle);if(Math.abs(along)>100||Math.abs(side)>45)continue;
  const group=g.trackGroups.get(e.a)||g.trackGroups.get(e.b)||e.resource,score=Math.abs(along)*4+Math.abs(side),old=byGroup.get(group);if(!old||score<old.score)byGroup.set(group,{e,t,group,score,coordinate:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]});
 }
 st.candidates=[];for(const c of [...byGroup.values()].sort((a,b)=>a.score-b.score).slice(0,6)){let nodeId;if(c.t<1e-7)nodeId=c.e.a;else if(c.t>1-1e-7)nodeId=c.e.b;else{
   const key=c.e.id+':'+Math.round(c.t*1e8);nodeId=inserted.get(key);if(!nodeId){nodeId='metro-stop:'+key;inserted.set(key,nodeId);data.nodes[nodeId]=c.coordinate;data.nodeTags[nodeId]={railway:'stop',name:st.name,_source:'estimated-stop-on-osm-track'};if(!insertions.has(c.e.wayId))insertions.set(c.e.wayId,[]);insertions.get(c.e.wayId).push({edgeIndex:+c.e.id.split(':').at(-1),t:c.t,id:nodeId});inferred.push({id:nodeId,station:st.key,sourceWay:c.e.wayId,sourceSegment:[c.e.a,c.e.b],fraction:c.t,coordinate:c.coordinate});}
  }st.candidates.push({nodeId,trackGroup:st.system+':'+c.group,coordinate:c.coordinate});
 }
}
for(const [wayId,values]of insertions){values.sort((a,b)=>b.edgeIndex-a.edgeIndex||b.t-a.t);for(const v of values)ways.get(wayId).nodes.splice(v.edgeIndex+1,0,v.id);}
// 環狀輕軌原終點殘留車止標籤：來源本身已有兩段連續的營運軌道，保留 XY，僅記錄推估接續。
const corrections=[];for(const id of ['4430465314','4430465313'])if(data.nodeTags[id]?.railway==='buffer_stop'){data.nodeTags[id]={...data.nodeTags[id],railway:'rail',_source:'inferred-through-connection'};corrections.push(id);}g=makeTopology(data);
const paths=[],pairs={},missing=[],routes={};
for(const ln of lines){
 const allStations=ln.stations.map(st=>stations[ln.key+':'+st.name]);let startIndex=0,endIndex=allStations.length-1;while(startIndex<endIndex&&!allStations[startIndex].candidates.length)startIndex++;while(endIndex>startIndex&&!allStations[endIndex].candidates.length)endIndex--;const forward=allStations.slice(startIndex,endIndex+1);for(const direction of [1,-1]){
  const ss=direction===1?[...forward]:[...forward].reverse(),keys=[],other=new Set((routes[ln.key+':1']?.pathIds||[]).flatMap(id=>paths[id].edgeIds)),penalties=new Map([...other].map(id=>[g.edges.get(id).resource,100000]));
  for(let i=1;i<ss.length;i++){const a=ss[i-1],b=ss[i],key=a.key+'>'+b.key;keys.push(key);const options=[];
   for(const ca of a.candidates)for(const cb of b.candidates){const p=g.shortestPath({from:ca.nodeId,to:cb.nodeId,system:ln.system,maxLength:Math.max(2500,distanceM(ca.coordinate,cb.coordinate)*3),allowYard:ln.system==='tmrt',penalties:direction<0?penalties:new Map()});if(!p)continue;
    const c=makePath(p.coordinates),at=c.at(c.length/2),source=makePath(ln.shape.map(q=>[q[1],q[0]])),hit=source.locate(at.coordinate);if(hit.error>150)continue;
    const q=source.at(hit.s).coordinate,side=(-Math.sin(hit.angle)*(at.coordinate[0]-q[0])*Math.cos(q[1]*Math.PI/180)+Math.cos(hit.angle)*(at.coordinate[1]-q[1]))*111320*direction;
    const id=paths.length;paths.push({...p,id,system:ln.system,from:ca.nodeId,to:cb.nodeId,cost:p.lengthM*.001-side+(direction<0?p.edgeIds.filter(id=>other.has(id)).length*1000:0)});options.push(id);
   }pairs[key]=options;
  }
  while(keys.length&&!pairs[keys[0]].length){keys.shift();ss.shift();}while(keys.length&&!pairs[keys.at(-1)].length){keys.pop();ss.pop();}let states=[{ids:[],cost:0,last:null}];for(const key of keys){const next=[];for(const id of pairs[key]){const p=paths[id];let best=null;for(const old of states){const before=old.last;if(before&&(before.to!==p.from||!g.canTurn(before.nodeIds.at(-2),p.from,p.nodeIds[1],g.edges.get(before.edgeIds.at(-1)),g.edges.get(p.edgeIds[0]))))continue;const cost=old.cost+p.cost;if(!best||cost<best.cost)best={ids:[...old.ids,id],cost,last:p};}if(best)next.push(best);}states=next;if(!states.length){missing.push({line:ln.key,direction,key,candidates:pairs[key].length});break;}}
  if(states.length){const best=states.sort((a,b)=>a.cost-b.cost)[0];routes[ln.key+':'+direction]={pathIds:best.ids,stationNames:ss.map(s=>s.name),direction,stationIndices:ss.map(s=>allStations.indexOf(s)),startIndex:Math.min(...ss.map(s=>allStations.indexOf(s))),endIndex:Math.max(...ss.map(s=>allStations.indexOf(s)))};}
 }console.log(ln.key,Object.keys(routes).length,'routes',missing.at(-1));
}
fs.writeFileSync('.cache/physical-tracks/metro-routes-expanded.json',JSON.stringify({paths,pairs,routes,stations,inferred,corrections,missing}));fs.writeFileSync('.cache/physical-tracks/metro-routed-source.json',JSON.stringify(data));console.log({routes:Object.keys(routes).length,missing});
