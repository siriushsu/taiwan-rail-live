// 與渲染共用形狀，另讀原始 DEM 核對淨空；密集取樣含兩方向的車體角落。
import fs from 'node:fs';import assert from 'node:assert/strict';import {makePath,makeHeightProfile,shapeKey} from '../rail-3d/integration/train-path.js';import {openRailDem} from './lib/local_rail_dem.mjs';
const root=new URL('../',import.meta.url),dem=openRailDem(root),profiles=JSON.parse(fs.readFileSync(new URL('rail-3d/integration/display-profiles.json',root)));
const cases=[['afr','AFR_MAIN',[120.6074,23.5385],1900,7,2.6],['tra','宜蘭線',[121.8208,24.6256],1800,13.5,3.3]];
let total=0;try{
// 驗每兩個取樣節點之間的中點，不能只核對建立包絡時用過的點。
let midpointCount=0,minimum=Infinity,routeCount=0;
for(const file of ['tra','thsr_track','afr','trtc','tymc','ntdlrt','ntalrt','sanying','krtc','tmrt']){
 for(const ln of JSON.parse(fs.readFileSync(new URL('data/'+file+'.json',root))).lines){
  const coordinates=ln.shape?ln.shape.map(c=>[c[1],c[0]]):ln.stations.map(s=>[s.lon,s.lat]);
  const path=makePath(coordinates,!!ln.loop),p=profiles.entries[shapeKey(coordinates)];
  assert.ok(p&&Math.abs(p.lengthM-path.length)<.01,file+':'+ln.id+' 高程對應正確形狀');
  const z=makeHeightProfile(p.values,p.stepM,path.length);let min=Infinity;
  for(let s=p.stepM/2;s<path.length;s+=p.stepM){
   const delta=z(s)+.65-await dem.ground(path.at(s).coordinate);
   assert.ok(delta>.5,file+':'+ln.id+' 里程 '+s+' 的軌道穿入地形');
   min=Math.min(min,delta);midpointCount++;
  }
  minimum=Math.min(minimum,min);routeCount++;
 }
}
assert.equal(profiles.railElevationM,null,'顯示高程不得冒充實測軌面');
console.log({routeCount,midpointCount,minimum});
for(const [file,lineId,center,radius,halfCar,halfWidth]of cases){const ln=JSON.parse(fs.readFileSync(new URL('data/'+file+'.json',root))).lines.find(l=>l.id===lineId),path=makePath(ln.shape.map(c=>[c[1],c[0]])),p=profiles.entries[shapeKey(path.coordinates)],z=makeHeightProfile(p.values,p.stepM,path.length),middle=path.locate(center).s;let minRail=Infinity,minBody=Infinity,worst=null;
for(let s=middle-radius;s<middle+radius;s+=2){const c=path.at(s).coordinate,g=await dem.ground(c);minRail=Math.min(minRail,z(s)+.65-g);total++;if(total%5)continue;
 for(const dir of [-1,1]){const a=path.at(s-dir*5).coordinate,b=path.at(s+dir*5).coordinate,angle=Math.atan2(b[1]-a[1],(b[0]-a[0])*Math.cos(c[1]*Math.PI/180)),slope=(z(s+dir*5)-z(s-dir*5))/10;
 for(const u of [-halfCar,0,halfCar])for(const v of [-halfWidth,0,halfWidth]){const x=(Math.cos(angle)*u-Math.sin(angle)*v)/(111320*Math.cos(c[1]*Math.PI/180)),y=(Math.sin(angle)*u+Math.cos(angle)*v)/111320,h=z(s)+.65+slope*u,ground=await dem.ground([c[0]+x,c[1]+y]),delta=h-ground;if(delta<minBody){minBody=delta;worst={s,dir,u,v,delta};}}
 }
}
console.log({lineId,minRail,minBody,worst});assert.ok(minRail>.5,lineId+' 軌道高於地形');assert.ok(minBody>0,lineId+' 整節車體不穿入地形');}
console.log('PASS '+total+' 個軌道點、雙向車體淨空；高程仍為顯示示意');}finally{dem.close();}
