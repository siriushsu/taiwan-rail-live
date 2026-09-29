import {makePath} from '../integration/train-path.js';
import {makeTopology} from './topology.js';
import {classifyRailStructure} from './structure-kind.js';
// 車身延伸只沿來源節點與可通行接頭；不補直線、不橫移列車。
export function createRouteRuntime(pack,profiles){
 const ways=pack.ways,paths=new Map(),routes=new Map(),wayById=new Map(ways.map(w=>[String(w.id),w]));let graph=null;const structureById=new Map(ways.map(w=>[String(w.id),classifyRailStructure(w.tags)]));
 const sample=(e,s,key='values')=>{if(!e)return null;let lo=0,hi=e.distances.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(e.distances[m]<=s)lo=m;else hi=m;}const f=Math.max(0,Math.min(1,(s-e.distances[lo])/(e.distances[hi]-e.distances[lo]||1)));return e[key][lo]*(1-f)+e[key][hi]*f;};
 const atHeight=(wayId,s,mode='terrain')=>{const e=profiles?.entries[wayId];return mode==='flat'?(e?.level?sample(e.level,s,e.level.flatOffsets?'flatOffsets':'offsets'):0):sample(e?.level||e,s);};
 // kind 優先取層位剖面：那份是建置時算的，含官方橋隧補正；來源標籤只是沒有剖面時的退路。
 const levelAt=(wayId,s)=>{const e=profiles?.entries[wayId]?.level;return {kind:e?.kind||structureById.get(String(wayId))?.kind||'surface',layer:e?.layer??structureById.get(String(wayId))?.layer??null,offsetM:e?sample(e,s,'offsets'):0,flatOffsetM:e?sample(e,s,e.flatOffsets?'flatOffsets':'offsets'):0,...(e?.terrainValues?{terrainHeightM:sample(e,s,'terrainValues'),terrainBasis:e.terrainBasis,terrainTransition:e.terrainTransition,coverM:sample(e,s,'values')-sample(e,s,'offsets')-sample(e,s,'terrainValues')}:{}),estimated:true};};
 const sourcePath=w=>w._path||(w._path=makePath(w.coordinates));
 const edgeRecord=(w,a,b)=>({wayId:String(w.id),edgeId:w.id+':'+Math.min(a,b),a:sourcePath(w).d[a],b:sourcePath(w).d[b],resource:[w.system,...[w.nodes[a],w.nodes[b]].sort()].join(':')});
 function unfold(id){if(paths.has(id))return paths.get(id);const record=pack.paths[id],coordinates=[],edges=[],nodeIds=[];
  for(const [wi,start,count]of record.walk){const w=ways[wi],sign=Math.sign(count);for(let j=0;j<Math.abs(count);j++){const i=start+j*sign,a=i+(sign<0?1:0),b=i+(sign>0?1:0);if(!nodeIds.length){nodeIds.push(w.nodes[a]);coordinates.push(w.coordinates[a]);}else if(nodeIds.at(-1)!==w.nodes[a])throw Error('實體股道不連續');nodeIds.push(w.nodes[b]);coordinates.push(w.coordinates[b]);edges.push(edgeRecord(w,a,b));}}
  const path=makePath(coordinates),result={...record,id,coordinates,nodeIds,edges,path};paths.set(id,result);if(paths.size>512)paths.delete(paths.keys().next().value);return result;
 }
 function topology(){if(!graph){const nodes={};for(const w of ways)w.nodes.forEach((id,i)=>nodes[id]=w.coordinates[i]);graph=makeTopology({nodes,nodeTags:pack.nodeTags,systemByWay:Object.fromEntries(ways.map(w=>[w.id,w.system])),ways});}return graph;}
 function extension(previous,current,incoming,length){const g=topology(),nodes=[],coordinates=[],edges=[];let walked=0,last=g.edges.get(incoming.edgeId);const seen=new Set([previous,current]);
  for(let n=0;walked<length&&n<2000;n++){
   const here=g.nodes.get(current),a=g.nodes.get(previous).coordinate,b=here.coordinate,dx=(b[0]-a[0])*Math.cos(b[1]*Math.PI/180),dy=b[1]-a[1];
   const options=here.edges.filter(e=>e.system===last.system).map(e=>({e,to:e.a===current?e.b:e.a})).filter(({e,to})=>!seen.has(to)&&g.canTurn(previous,current,to,last,e)).map(v=>{const c=g.nodes.get(v.to).coordinate,x=(c[0]-b[0])*Math.cos(b[1]*Math.PI/180),y=c[1]-b[1];return {...v,score:(x*dx+y*dy)/(Math.hypot(x,y)*Math.hypot(dx,dy)||1)};}).sort((a,b)=>b.score-a.score||a.e.id.localeCompare(b.e.id));
   const next=options[0];if(!next)break;const w=wayById.get(next.e.wayId),index=+next.e.id.slice(next.e.id.lastIndexOf(':')+1),from=next.e.a===current?index:index+1,to=next.e.a===current?index+1:index;
   edges.push(edgeRecord(w,from,to));coordinates.push(g.nodes.get(next.to).coordinate);nodes.push(next.to);walked+=next.e.length;seen.add(next.to);previous=current;current=next.to;last=next.e;
  }return {nodes,coordinates,edges,length:walked};
 }
 function route(ids,system,color,{prefixM=0,suffixM=0}={}){const key=ids.join(',')+':'+prefixM+':'+suffixM,cached=routes.get(key);if(cached)return cached;const coordinates=[],edges=[],offsets=[0],nodeIds=[];
  for(const id of ids){const p=unfold(id);if(nodeIds.length&&nodeIds.at(-1)!==p.nodeIds[0])throw Error('車站股道不連續');coordinates.push(...p.coordinates.slice(coordinates.length?1:0));nodeIds.push(...p.nodeIds.slice(nodeIds.length?1:0));edges.push(...p.edges);offsets.push(offsets.at(-1)+p.path.length);}
  let prefixLength=0;if(prefixM){const pre=extension(nodeIds[1],nodeIds[0],edges[0],prefixM);prefixLength=pre.length;coordinates.unshift(...pre.coordinates.reverse());nodeIds.unshift(...pre.nodes.reverse());edges.unshift(...pre.edges.reverse().map(e=>({...e,a:e.b,b:e.a})));for(let i=0;i<offsets.length;i++)offsets[i]+=prefixLength;}
  if(suffixM){const post=extension(nodeIds.at(-2),nodeIds.at(-1),edges.at(-1),suffixM);coordinates.push(...post.coordinates);nodeIds.push(...post.nodes);edges.push(...post.edges);}
  const path=makePath(coordinates),lookup=(s,fn)=>{const point=path.at(Math.max(0,Math.min(path.length,s)));if(!point)return null;const i=point.index,e=edges[i],f=(point.s-path.d[i])/(path.d[i+1]-path.d[i]||1);return fn(e.wayId,e.a+(e.b-e.a)*f);},elevation=(s,mode)=>lookup(s,(id,d)=>atHeight(id,d,mode)),level=s=>lookup(s,levelAt);
  const result={id:'physical:'+key,systemId:system,routeId:'physical',coordinates,color,loop:false,physical:true,path,offsets,elevation,level,nodeIds,edges,prefixLength};routes.set(key,result);if(routes.size>128)routes.delete(routes.keys().next().value);return result;
 }
 const drawings=new Map();function drawingWays(system,color){const key=system+':'+color;if(!drawings.has(key))drawings.set(key,ways.filter(w=>w.system===system).map(w=>({id:'physical-way:'+w.id,systemId:system,routeId:w.id,physical:true,coordinates:w.coordinates,color,elevation:(s,mode)=>atHeight(w.id,s,mode),level:s=>levelAt(w.id,s)})));return drawings.get(key);}
 return {unfold,route,drawingWays,atHeight,levelAt,wayById};
}
