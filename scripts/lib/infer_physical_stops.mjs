import {distanceM} from '../../rail-3d/integration/train-path.js';
// 補上缺少 stop_position 的實際月台股道；新停車點只能落在來源線段上。
export function inferPhysicalStops(data,graph,stations){
 const inferred=[],insertions=new Map(),ways=new Map(data.ways.map(w=>[String(w.id),w]));
 for(const st of Object.values(stations)){
  const known=graph.stopCandidates(st,st.system);if(!known.length)continue;
  const groups=new Set(known.map(c=>c.trackGroup)),origin=[known.reduce((a,c)=>a+c.coordinate[0],0)/known.length,known.reduce((a,c)=>a+c.coordinate[1],0)/known.length],mx=111320*Math.cos(origin[1]*Math.PI/180);
  const exemplar=graph.nodes.get(known[0].nodeId),edge=exemplar.edges.find(e=>e.system===st.system),v0=graph.nodes.get(edge.a).coordinate,v1=graph.nodes.get(edge.b).coordinate,axis=[(v1[0]-v0[0])*mx,(v1[1]-v0[1])*111320],an=Math.hypot(...axis);axis[0]/=an;axis[1]/=an;
  const candidates=new Map();
  for(const e of graph.edges.values()){
   if(e.system!==st.system||['yard','spur','crossover'].includes(e.tags.service))continue;
   const a=graph.nodes.get(e.a),b=graph.nodes.get(e.b),group=st.system+':'+(graph.trackGroups.get(a.id)||graph.trackGroups.get(b.id)||e.resource);if(groups.has(group))continue;
   const ax=(a.coordinate[0]-origin[0])*mx,ay=(a.coordinate[1]-origin[1])*111320,dx=(b.coordinate[0]-a.coordinate[0])*mx,dy=(b.coordinate[1]-a.coordinate[1])*111320,l=Math.hypot(dx,dy);if(Math.abs((dx*axis[0]+dy*axis[1])/l)<.85)continue;
   const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(l*l))),x=ax+dx*t,y=ay+dy*t,along=x*axis[0]+y*axis[1],across=x*axis[1]-y*axis[0];
   if(Math.abs(along)>70||Math.abs(across)>65)continue;
   const p=[a.coordinate[0]+(b.coordinate[0]-a.coordinate[0])*t,a.coordinate[1]+(b.coordinate[1]-a.coordinate[1])*t];if(known.some(c=>{const ox=(c.coordinate[0]-origin[0])*mx,oy=(c.coordinate[1]-origin[1])*111320;return Math.abs(across-(ox*axis[1]-oy*axis[0]))<2;}))continue;
   const score=Math.abs(along)*4+Math.abs(across),old=candidates.get(group);if(!old||score<old.score)candidates.set(group,{edge:e,t,coordinate:p,score,group});
  }
  for(const c of [...candidates.values()].sort((a,b)=>a.score-b.score).slice(0,8-known.length)){
   const e=c.edge,id='estimated:'+st.key+':'+e.id,record={id,station:st.key,system:st.system,sourceWay:e.wayId,sourceSegment:[e.a,e.b],fraction:c.t,coordinate:c.coordinate};
   // 點已在來源端點就只補標記；不用兩個重疊節點破壞道岔連通。
   if(c.t<1e-7||c.t>1-1e-7){const node=c.t<.5?e.a:e.b;if(data.nodeTags[node]?.railway==='switch')continue;data.nodeTags[node]={...data.nodeTags[node],railway:'stop',name:st.name,_source:'estimated-stop-on-osm-track'};record.id=node;}
   else{data.nodes[id]=c.coordinate;data.nodeTags[id]={railway:'stop',name:st.name,_source:'estimated-stop-on-osm-track'};if(!insertions.has(e.wayId))insertions.set(e.wayId,[]);insertions.get(e.wayId).push({edgeIndex:+e.id.split(':').at(-1),t:c.t,id});}
   inferred.push(record);
  }
 }
 for(const [wayId,values]of insertions){values.sort((a,b)=>b.edgeIndex-a.edgeIndex||b.t-a.t);const nodes=ways.get(wayId).nodes;for(const v of values)nodes.splice(v.edgeIndex+1,0,v.id);}
 return inferred;
}
