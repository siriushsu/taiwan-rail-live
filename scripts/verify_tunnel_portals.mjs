import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {groupTunnelPortals} from '../rail-3d/integration/tunnel-portals.js';
import {createRailStructures} from '../rail-3d/integration/rail-structures.js';
import {makePath} from '../rail-3d/integration/train-path.js';
const read=f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f+'.json'));
const levels=read('level-profiles'),ways=[...read('network').ways,...read('metro-network').ways],ends=[];
for(const w of ways){if(levels.entries[w.id]?.kind!=='tunnel')continue;for(const i of [0,w.coordinates.length-1])ends.push({w,i,q:w.coordinates[i]});}
const sample=(e,s,key)=>{let i=0;while(i<e.distances.length-2&&e.distances[i+1]<s)i++;const f=Math.max(0,Math.min(1,(s-e.distances[i])/(e.distances[i+1]-e.distances[i]||1)));return e[key][i]*(1-f)+e[key][i+1]*f;};
const paths=new Map(),path=w=>{if(!paths.has(w.id))paths.set(w.id,makePath(w.coordinates));return paths.get(w.id);};
const origin=[121,24],lat0=24*Math.PI/180,R=6378137*Math.cos(lat0),merc=q=>[(q[0]-origin[0])*Math.PI/180*R,(Math.log(Math.tan(Math.PI/4+q[1]*Math.PI/360))-Math.log(Math.tan(Math.PI/4+lat0/2)))*R];
const sources=levels.portals.map(([lon,lat,bearing,system],id)=>{
 const candidates=ends.filter(e=>e.w.system===system).map(e=>({...e,dist:Math.hypot((e.q[0]-lon)*101000,(e.q[1]-lat)*111000),turn:(()=>{const inner=e.w.coordinates[e.i===0?Math.min(6,e.w.coordinates.length-1):Math.max(0,e.w.coordinates.length-7)];return 1-Math.cos(Math.atan2(inner[1]-e.q[1],(inner[0]-e.q[0])*Math.cos(lat*Math.PI/180))-(90-bearing)*Math.PI/180);})()})).sort((a,b)=>a.dist-b.dist||a.turn-b.turn);
 const e=candidates[0];assert.ok(e?.dist<.2,'洞口必須對到來源隧道端點 '+id);return {...e,id,coordinate:[lon,lat],angle:Math.atan2(e.w.coordinates[e.i===0?1:e.i-1][1]-e.q[1],(e.w.coordinates[e.i===0?1:e.i-1][0]-e.q[0])*Math.cos(e.q[1]*Math.PI/180)),system};
});
const scene=new THREE.Scene(),structures=createRailStructures(scene),rows=[];
for(const mode of ['offsets','terrainValues']){
 const items=sources.map(s=>{const e=levels.entries[s.w.id],h=e[mode][s.i===0?0:e[mode].length-1]+.65,scale=Math.cos(lat0)/Math.cos(s.coordinate[1]*Math.PI/180);const route=path(s.w),start=s.i===0?0:route.length,dir=s.i===0?1:-1,samples=[0,3,6,9,12].map(d=>{const distance=Math.max(0,Math.min(route.length,start+dir*d)),point=route.at(distance);return [...merc(point.coordinate),(sample(e,distance,mode)+.65)*scale];});return {...s,p:samples[0],samples,scale};});
 const groups=groupTunnelPortals(items);assert.equal(groups.reduce((s,g)=>s+g.members.length,0),levels.portals.length);
 let rays=0,failures=[];
 for(const g of groups){
  const nearby=groups.filter(o=>Math.hypot(o.p[0]-g.p[0],o.p[1]-g.p[1])<50*g.scale);
  structures.set([],[],2,nearby.map(o=>({...o,ground:Array(5).fill(o.p[2]-12*o.scale)})));scene.updateMatrixWorld(true);
  assert.ok([...scene.children[0].geometry.attributes.position.array].every(Number.isFinite));
  for(const m of g.members){
    const route=path(m.w),e=levels.entries[m.w.id],dir=m.i===0?1:-1,first=dir===1?0:route.length;
    // 射線穿過真正的來源路徑：兩方向、全車高與車體兩側；不是問模型自己宣告的淨空。
    for(const side of [-1.65,0,1.65])for(const z of [.25,2,4.2])for(let d=-2;d<12;d+=2){
      const points=[d,d+2].map(distance=>{const s=Math.max(0,Math.min(route.length,first+dir*distance));const q=distance<0?{coordinate:[m.coordinate[0]+Math.cos(m.angle)*distance/(111320*Math.cos(m.coordinate[1]*Math.PI/180)),m.coordinate[1]+Math.sin(m.angle)*distance/110574],angle:m.angle}:route.at(s);const xy=merc(q.coordinate),a=q.angle??m.angle,scale=m.scale;return new THREE.Vector3(xy[0]-Math.sin(a)*side*scale,xy[1]+Math.cos(a)*side*scale,(sample(e,s,mode)+.65+z)*scale);});
      const delta=points[1].clone().sub(points[0]),len=delta.length();for(const sign of [1,-1]){rays++;const ray=new THREE.Raycaster(sign===1?points[0]:points[1],delta.clone().normalize().multiplyScalar(sign),.001,len-.001);const hits=ray.intersectObjects(scene.children,true);if(hits.length)failures.push({portal:m.id,mode,way:m.w.id,d,z,side,point:hits[0].point.toArray(),color:new THREE.Color().fromBufferAttribute(hits[0].object.geometry.attributes.color,hits[0].face.a).getHexString()});}
    }
  }
 }
 rows.push({mode,sourcePortals:items.length,groups:groups.length,rays,failures});console.log(mode,items.length,'洞口',groups.length,'模型',rays,'射線',failures.length,'碰撞');
}
// 不同系統、高低層、朝向相反的洞口不可直接合併。
const p={p:[0,0,10],angle:0,scale:1,system:'tra_sched'};
assert.equal(groupTunnelPortals([p,{...p,p:[0,4,10]}]).length,1);
for(const other of [{...p,system:'mrt'},{...p,p:[0,4,20]},{...p,angle:Math.PI}])assert.equal(groupTunnelPortals([p,other]).length,2);
structures.destroy();assert.equal(scene.children.length,0);
fs.mkdirSync('output/portal-review',{recursive:true});fs.writeFileSync('output/portal-review/geometry.json',JSON.stringify(rows,null,2));
assert.equal(rows.reduce((s,r)=>s+r.failures.length,0),0,'來源路徑與洞口殼相撞，詳見 geometry.json');
