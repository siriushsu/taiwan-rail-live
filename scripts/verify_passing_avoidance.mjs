// 回歸 A54 實際捕獲的台北車站情境。比對原始股道線段，不只用同一條 path 自證。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
import {formationFor,assembleFormation} from '../rail-3d/integration/formations.js';
import {formationPoses,distanceM} from '../rail-3d/integration/train-path.js';
const read=p=>JSON.parse(fs.readFileSync(p)),fixture=read('scripts/fixtures/physical-taipei-0908.json'),catalog=read('rail-3d/assets/blender-map-v1/manifest.json');
const packs={rail:read('rail-3d/physical/network.json'),metro:read('rail-3d/physical/metro-network.json')},runtimes=Object.fromEntries(Object.entries(packs).map(([k,p])=>[k,createRouteRuntime(p)]));
const segmentDistance=(p,a,b)=>{const mx=111320*Math.cos(p[1]*Math.PI/180),x=(p[0]-a[0])*mx,y=(p[1]-a[1])*111320,dx=(b[0]-a[0])*mx,dy=(b[1]-a[1])*111320,t=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-t*dx,y-t*dy);};
let samples=0,turnouts=0,maxErrorM=0;
for(const v of fixture.vehicles){
 const kind=v.systemId.endsWith('_sched')?'rail':'metro',pack=packs[kind],g=runtimes[kind],r=g.route(v.pathIds,v.systemId,v.color,v.extension),model=assembleFormation(formationFor(v,'actual'),catalog);
 const onSource=poses=>{assert.equal(poses?.length,model.parts.length);for(const p of poses){const edge=r.edges[r.path.at(p.s).index],w=g.wayById.get(edge.wayId),i=Number(edge.edgeId.slice(edge.edgeId.lastIndexOf(':')+1)),error=segmentDistance(p.coordinate,w.coordinates[i],w.coordinates[i+1]);maxErrorM=Math.max(maxErrorM,error);assert.ok(error<.00001,'車廂不可離開指派的原始股道 '+v.id);samples++;}};
 onSource(formationPoses(r.path,v.chainageM,v.railDirection*(v.formationFacing||1),model.parts));
 // 來源資料有分歧節點的台北站區，測兩個方向逐節越過同一岔道。
 const switches=r.nodeIds.map((id,i)=>({id,s:r.path.d[i],coordinate:r.coordinates[i]})).filter(x=>pack.nodeTags[x.id]?.railway==='switch'&&x.coordinate[0]>121.51&&x.coordinate[0]<121.524&&x.s>model.lengthM&&x.s<r.path.length-model.lengthM);
 for(const point of switches.slice(0,2))for(const dir of [1,-1]){
  const crossing=Array(model.parts.length).fill(null),previous=Array(model.parts.length).fill(null),span=model.lengthM+30;
  for(let step=0;step<=span*2;step++){
   const center=point.s+dir*(-span+step),poses=formationPoses(r.path,center,dir,model.parts);onSource(poses);
   poses.forEach((p,i)=>{if(crossing[i]===null&&(p.s-point.s)*dir>=0)crossing[i]=step;if(previous[i])assert.ok(distanceM(previous[i],p.coordinate)<1.01,'沿股道前進 1m 不可瞬移');previous[i]=p.coordinate;});
  }
  assert.ok(crossing.every(Number.isFinite));
  for(let i=1;i<crossing.length;i++)assert.ok(crossing[i]-crossing[i-1]>10,'每節車廂必須依序通過，不可整列橫移');
  turnouts++;
 }
}
assert.equal(fixture.vehicles.length,6);assert.ok(turnouts>=8);assert.ok(fixture.vehicles.filter(v=>v.formerOffsetM>=5).length===4);
console.log({vehicles:fixture.vehicles.length,samples,turnouts,directions:2,maxErrorM});
