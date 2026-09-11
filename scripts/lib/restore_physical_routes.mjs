// 從已出貨的 network.json 還原派車管線用的路網:拓撲、逐邊路徑(nodeIds／edgeIds)與邊資源。
// rebuild_physical_cache.mjs 在 OSM 快照與 .cache/physical-tracks 不在磁碟時用它;
// verify_thsr_reservation_motion.mjs 用它在出貨樹上重算佔用——vehicleReservations 要的是
// edgeIds／nodeIds／edges[].resource,pack 裡只有 walk。
import {makeTopology} from '../../rail-3d/physical/topology.js';
export function restorePhysicalRoutes(net){
 const nodes={};for(const w of net.ways)w.nodes.forEach((id,i)=>{nodes[id]=w.coordinates[i];});
 const source={source:net.source,nodeSource:net.nodeSource,ways:net.ways.map(w=>({id:w.id,tags:w.tags,nodes:w.nodes})),nodes,nodeTags:net.nodeTags,systemByWay:Object.fromEntries(net.ways.map(w=>[w.id,w.system]))};
 const g=makeTopology(source),paths=[];
 // 舊路徑原編號還原(台鐵／林鐵派車直接引用這些編號),每一條都必須逐邊對回拓撲。
 for(const [pid,p] of Object.entries(net.paths)){
  const edgeIds=[],nodeIds=[];
  for(const [wi,ix,steps] of p.walk){const w=net.ways[wi],dir=Math.sign(steps);for(let k=0;k<Math.abs(steps);k++){const e=ix+k*dir,[from,to]=dir>0?[w.nodes[e],w.nodes[e+1]]:[w.nodes[e+1],w.nodes[e]];if(!nodeIds.length)nodeIds.push(from);else if(nodeIds.at(-1)!==from)throw Error('舊路徑不連續 '+pid);nodeIds.push(to);edgeIds.push(w.id+':'+e);}}
  for(const id of edgeIds)if(!g.edges.has(id))throw Error('舊路徑的邊不在拓撲 '+pid+' '+id);
  if(nodeIds[0]!==p.from||nodeIds.at(-1)!==p.to)throw Error('舊路徑端點不符 '+pid);
  paths[+pid]={from:p.from,to:p.to,fromGroup:p.fromGroup,toGroup:p.toGroup,system:p.system,nodeIds,edgeIds,lengthM:p.lengthM,preference:p.preference};
 }
 for(let i=0;i<paths.length;i++)if(!paths[i])paths[i]=null;
 const edges={};for(const e of g.edges.values())edges[e.id]={a:e.a,b:e.b,resource:e.resource,length:e.length,wayId:e.wayId,system:e.system,tags:e.tags};
 return {source,g,paths,edges,nodes};
}
