// 具名守住 C37↔C1：節點閉合、來源股道、雙向連續位置與跨接點的完整車身。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMetroPhysicalMotion} from '../rail-3d/physical/metro-motion.js';
import {formationFor,assembleFormation} from '../rail-3d/integration/formations.js';
import {makePath,distanceM,formationPoses} from '../rail-3d/integration/train-path.js';
import {closeMetroLoops,metroLoopLines} from './lib/close_metro_loops.mjs';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),pack=read('rail-3d/physical/metro-network.json'),profiles=read('rail-3d/physical/metro-display-profiles.json');
const motion=createMetroPhysicalMotion(structuredClone(pack),profiles),ln=read('data/krtc.json').lines.find(l=>l.id==='C');ln._sys='krtc';
const shape=makePath(ln.shape.map(p=>[p[1],p[0]]),true),model=assembleFormation(formationFor({systemId:'krtc',routeId:'C'},'actual'),read('rail-3d/assets/blender-map-v1/manifest.json'));
let samples=0,poses=0;
for(const direction of [1,-1]){
 const selected=motion.routeFor(ln,direction),{record,route}=selected;
 assert.equal(record.pathIds.length,38);assert.equal(record.loop,true);assert.equal(route.path.closed,true);assert.equal(route.nodeIds[0],route.nodeIds.at(-1));
 const closure=motion.geometry.unfold(record.pathIds.at(-1));assert.ok(closure.path.length>300&&closure.path.length<600);
 const existing=new Set(record.pathIds.slice(0,-1).flatMap(id=>motion.geometry.unfold(id).edges.map(e=>e.resource)));
 assert.ok(closure.edges.every(edge=>!existing.has(edge.resource)),'閉合路徑不得重走既有環線');
 let previous=null,travel=0;
 for(let k=0;k<=120;k++){
  const f=direction>0?k/120:1-k/120,s=ln.stations.at(-1).d*1000+(shape.length-ln.stations.at(-1).d*1000)*f,p=shape.at(s);
  const raw={lat:p.coordinate[1],lon:p.coordinate[0]},actual=motion.sample(ln,raw,direction);assert.equal(actual.physical,true);
  const q=[actual.lon,actual.lat];if(previous){const d=distanceM(q,previous);assert.ok(d<8,'跨接段瞬移 '+d+'m');travel+=d;}previous=q;samples++;
 }
 assert.ok(travel>300&&travel<600,'跨接段必須實際移動，不能卡在站上');
 for(const progress of [-.0001,0,.0001,36.9999,37,37.0001,37.5,37.9999,38,38.0001]){
  const p=motion.sample(ln,{progress},direction),cars=formationPoses(route.path,p.chainageM,1,model.parts,s=>route.elevation(s));
  assert.equal(cars.length,5);assert.ok(cars.every(c=>Number.isFinite(c.height)&&Number.isFinite(c.angle)));poses+=cars.length;
 }
 for(const s of [-10,0,route.path.length-10,route.path.length+10])assert.ok(Math.abs(route.elevation(s)-route.elevation(((s%route.path.length)+route.path.length)%route.path.length))<1e-9,'車身高程必須跨閉環接續');
 console.log(JSON.stringify({direction,closureM:closure.path.length,travelM:travel,closed:true}));
}
const before=JSON.stringify(pack);assert.deepEqual(closeMetroLoops(pack,metroLoopLines(pack,root)),[]);assert.equal(JSON.stringify(pack),before,'重跑不得改寫原股道');
// 打開封口再重建：打包流程也要補回兩個方向，避免資料重抓後退回漏段。
const open=structuredClone(pack);for(const d of [1,-1]){const r=open.routes['krtc:C:'+d];r.pathIds.pop();r.stationIndices.pop();r.stationNames.pop();delete r.loop;}
const rebuilt=closeMetroLoops(open,[ln]);assert.equal(rebuilt.length,2);
for(const d of [1,-1]){const r=open.routes['krtc:C:'+d];assert.equal(r.pathIds.length,38);const path=createMetroPhysicalMotion(open).routeFor(ln,d).route.path;assert.equal(path.closed,true);}
console.log(`高雄輕軌閉環驗收通過：${samples} 個雙向位置、${poses} 節跨接點車身、重建與重跑防呆`);
