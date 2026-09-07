import fs from 'node:fs';import assert from 'node:assert/strict';
import {makeTopology} from '../rail-3d/physical/topology.js';import {distanceM} from '../rail-3d/integration/train-path.js';
const tags={railway:'rail',gauge:'1067'},way=(id,nodes,extra={})=>({id,nodes,tags:{...tags,...extra}});
const crossing=makeTopology({nodes:{w:[121,24],x:[121.001,24],e:[121.002,24],n:[121.001,24.001],s:[121.001,23.999]},nodeTags:{x:{railway:'railway_crossing'}},ways:[way('a',['w','x','e']),way('b',['n','x','s'])]});
assert.ok(crossing.shortestPath({from:'w',to:'e',system:'tra_sched'}));assert.equal(crossing.shortestPath({from:'w',to:'n',system:'tra_sched'}),null);
const sameXY=makeTopology({nodes:{a:[121,24],b:[121.001,24],c:[121.001,24],d:[121.002,24]},ways:[way('a',['a','b']),way('b',['c','d'])]});assert.equal(sameXY.shortestPath({from:'a',to:'d',system:'tra_sched'}),null);
const micro=makeTopology({nodes:{a:[120.3434036,23.3388952],b:[120.3455284,23.3423103],c:[120.3455269,23.3423107],d:[120.345617,23.3424559]},ways:[way('a',['a','b']),way('b',['b','c','d'])]});for(const [from,to]of [['a','d'],['d','a']])assert.ok(micro.shortestPath({from,to,system:'tra_sched'}));
const duplicate=makeTopology({nodes:{a:[121,24],b:[121.001,24]},ways:[way('a',['a','b']),way('b',['b','a'])]});assert.equal(new Set([...duplicate.edges.values()].map(e=>e.resource)).size,1);
const hairpin=makeTopology({nodes:{a:[121,24],b:[121.001,24],c:[121.001,24.0002],d:[121,24.0002]},ways:[way('a',['a','b','c','d'])]});assert.ok(hairpin.shortestPath({from:'a',to:'d',system:'tra_sched'}));
const n=JSON.parse(fs.readFileSync('.cache/physical-tracks/routes.json')),source=JSON.parse(fs.readFileSync('.cache/physical-tracks/network-with-stations.json')),routed=JSON.parse(fs.readFileSync('.cache/physical-tracks/routed-source.json')),g=makeTopology(routed);
for(const [id,c]of Object.entries(source.nodes))assert.deepEqual(routed.nodes[id],c,'不可改原始來源 XY '+id);
for(const p of n.inferredStops){const a=source.nodes[p.sourceSegment[0]],b=source.nodes[p.sourceSegment[1]],expected=[a[0]+(b[0]-a[0])*p.fraction,a[1]+(b[1]-a[1])*p.fraction];assert.ok(distanceM(expected,p.coordinate)<1e-5,p.id+' 必須在來源股道上');}
for(const [key,ids]of Object.entries(n.pairs))assert.ok(ids.length,key+' 無可連通路徑');
for(const [id,p]of n.paths.entries()){
 assert.equal(p.nodeIds.length,p.edgeIds.length+1);assert.equal(new Set(p.nodeIds).size,p.nodeIds.length,'不可繞圈偷偷倒向 '+id);
 for(let i=0;i<p.edgeIds.length;i++){const e=g.edges.get(p.edgeIds[i]),a=p.nodeIds[i],b=p.nodeIds[i+1];assert.ok(e&&(e.a===a&&e.b===b||e.b===a&&e.a===b));if(i)assert.ok(g.canTurn(p.nodeIds[i-1],a,b,g.edges.get(p.edgeIds[i-1]),e),'不可非法轉線 '+id);}
}
for(const [name,min]of [['台北',4],['北湖',4],['彰化',4]])assert.ok(n.stations['tra_sched:'+name].candidates.length>=min,name+' 需保留多股');
console.log(`PASS ${Object.keys(n.pairs).length} 站間組合、${n.paths.length} 來源路徑與 ${n.inferredStops.length} 推估停車點；交叉、分岔、微小接頭、雙向和重複來源驗證`);
