// 環線沿來源節點閉合；沿用已選好的各站股道，不重選其他路線或補直線。
import fs from 'node:fs';
import {createRouteRuntime} from '../../rail-3d/physical/route-runtime.js';
import {makeTopology} from '../../rail-3d/physical/topology.js';
import {distanceM} from '../../rail-3d/integration/train-path.js';

export function metroLoopLines(pack,root){
 const systems=[...new Set(Object.keys(pack.routes).map(key=>key.split(':')[0]))];
 return systems.flatMap(system=>JSON.parse(fs.readFileSync(new URL('data/'+system+'.json',root))).lines
  .filter(line=>line.loop).map(line=>({...line,_sys:system})));
}
export function closeMetroLoops(pack,lines){
 const geometry=createRouteRuntime({...pack,ways:pack.ways.map(({_path,...way})=>({...way}))}),nodes={},wayIndex=new Map(pack.ways.map((way,i)=>[String(way.id),i]));
 for(const way of pack.ways)way.nodes.forEach((id,i)=>nodes[id]=way.coordinates[i]);
 const graph=makeTopology({nodes,nodeTags:pack.nodeTags,ways:pack.ways,systemByWay:Object.fromEntries(pack.ways.map(way=>[way.id,way.system]))});
 const vector=(a,b)=>[(b[0]-a[0])*Math.cos(a[1]*Math.PI/180),b[1]-a[1]],report=[];
 for(const line of lines)for(const direction of [1,-1]){
  const key=line._sys+':'+line.id+':'+direction,record=pack.routes[key],n=line.stations.length;
  if(!record||record.startIndex!==0||record.endIndex!==n-1)throw Error('環線股道未涵蓋全部車站：'+key);
  const first=geometry.unfold(record.pathIds[0]),last=geometry.unfold(record.pathIds.at(-1));
  if(record.loop&&record.pathIds.length===n&&first.nodeIds[0]===last.nodeIds.at(-1))continue;
  if(record.pathIds.length!==n-1)throw Error('環線站間數不符：'+key);
  const from=last.nodeIds.at(-1),to=first.nodeIds[0],blocked=new Set(record.pathIds.flatMap(id=>geometry.unfold(id).edges.map(edge=>edge.resource)));
  const closure=graph.shortestPath({from,to,system:line._sys,blocked,maxLength:Math.max(1000,distanceM(nodes[from],nodes[to])*3),
   startVector:vector(last.coordinates.at(-2),last.coordinates.at(-1)),endVector:vector(first.coordinates[0],first.coordinates[1])});
  if(!closure||!graph.canTurn(last.nodeIds.at(-2),from,closure.nodeIds[1],graph.edges.get(last.edges.at(-1).edgeId),graph.edges.get(closure.edgeIds[0]))||
   !graph.canTurn(closure.nodeIds.at(-2),to,first.nodeIds[1],graph.edges.get(closure.edgeIds.at(-1)),graph.edges.get(first.edges[0].edgeId)))throw Error('環線接續股道不連通：'+key);
  const walk=[];let prior=null;
  for(let i=0;i<closure.edgeIds.length;i++){
   const edge=graph.edges.get(closure.edgeIds[i]),index=+edge.id.split(':').at(-1),sign=edge.a===closure.nodeIds[i]?1:-1,wi=wayIndex.get(edge.wayId);
   if(prior&&prior[0]===wi&&Math.sign(prior[2])===sign&&prior[1]+prior[2]===index)prior[2]+=sign;
   else{prior=[wi,index,sign];walk.push(prior);}
  }
  record.pathIds.push(pack.paths.length);pack.paths.push({from,to,system:line._sys,lengthM:closure.lengthM,walk});
  record.stationIndices.push(record.stationIndices[0]);record.stationNames.push(record.stationNames[0]);record.loop=true;
  report.push({key,lengthM:closure.lengthM,segments:record.pathIds.length});
 }
 return report;
}
