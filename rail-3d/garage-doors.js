// 車門：讀車模 doors 中繼資料（garage-doors-v1），依門開度在頂點著色器位移門扇。門扇與車身仍是同一次繪製，draw call 不增加。
// 任何需要門位置的程式（乘客走位、驗收）都從 doorOffset 算，不讀 GPU。
import * as THREE from './vendor/three.module.js';
export const MAX_DOORS=8,INWARD_SHARE=.4/3;
const ease=t=>t*t*(3-2*t),clamp01=v=>Math.min(1,Math.max(0,v));
// 門開度 0..1 → 車模座標位移：前 0.4 秒內退到壁袋平面，後 2.6 秒滑進壁袋；關門倒過來走同一條路。
export function doorOffset(door,open){
 const i=ease(clamp01(open/INWARD_SHARE)),s=ease(clamp01((open-INWARD_SHARE)/(1-INWARD_SHARE)))*door.travel;
 return [0,1,2].map(k=>door.inward[k]*i+door.slide[k]*s);
}
// 每個頂點屬於第幾扇門（0＝不是門）；區段互相重疊或越界直接丟錯，不默默畫錯門。
export function buildDoorIndex(vertexCount,items){
 if(items.length>MAX_DOORS)throw Error('garage doors: more than '+MAX_DOORS+' doors');
 const index=new Float32Array(vertexCount);
 for(const [k,door]of items.entries())for(const r of door.ranges){
  if(!(r.start>=0&&r.count>0&&r.start+r.count<=vertexCount))throw Error('garage doors: range out of bounds '+door.id);
  for(let v=r.start;v<r.start+r.count;v++){if(index[v])throw Error('garage doors: overlapping ranges '+door.id);index[v]=k+1;}
 }
 return index;
}
// 門廳透光（設計書 §9「開門時門內透光」）：頂燈藏在門楣後、鏡頭一律俯看看不到它，three.js 的自發光也不照亮別的面；
// 所以門洞後方、車殼內側（比門扇中心面再往內 4 公分）、門檻到門楣之間的三角形標 1，讓它們跟著這節車的窗燈一起亮。
// z 夾在門檻與門楣之間：車殼在車肩、裙板往內彎，範圍放寬會把門洞上下的車殼外側也標進來，夜裡車外會發亮。門扇（index≠0）不算。
export function buildDoorGlow(position,items,index){
 const glow=new Float32Array(position.count);
 for(let v=0;v+2<position.count;v+=3){if(index[v]||index[v+1]||index[v+2])continue;
  let x=0,y=0,z=0;for(let k=0;k<3;k++){x+=position.getX(v+k)/3;y+=position.getY(v+k)/3;z+=position.getZ(v+k)/3;}
  if(items.some(d=>{const w=Math.sign(d.center[1])*y;return Math.abs(x-d.center[0])<=d.width/2+.05&&w>.5&&w<=Math.abs(d.center[1])-.04&&z>=d.center[2]-d.height/2-.01&&z<=d.center[2]+d.height/2-.005;}))glow.fill(1,v,v+3);
 }
 return glow;
}
// 車模 +Y 那一側是否面向月台：+1 是、-1 否。normal 是「從軌道指向月台」的世界方向。
const axis=new THREE.Vector3();
export function platformSide(quaternion,normal){axis.set(0,1,0).applyQuaternion(quaternion);return axis.dot(normal)>0?1:-1;}
const VERTEX_HEAD='#include <common>\nattribute float doorIndex;\nattribute float doorGlow;\nvarying float vDoorGlow;\nuniform vec3 doorOffsets['+MAX_DOORS+'];';
const VERTEX_MOVE='#include <begin_vertex>\n{int door=int(doorIndex+.5);if(door>0)transformed+=doorOffsets[door-1];}\nvDoorGlow=doorGlow;';
const FRAGMENT_HEAD='#include <common>\nuniform vec3 doorGlowColor;\nvarying float vDoorGlow;';
const FRAGMENT_GLOW='#include <emissivemap_fragment>\ntotalEmissiveRadiance+=doorGlowColor*vDoorGlow;';
// 同一段 shader 修改、同一個快取鍵；uniform 則是每節車自己一份（onBeforeCompile 對每個材質各跑一次）。
function patch(material,uniforms){
 material.onBeforeCompile=shader=>{shader.uniforms.doorOffsets=uniforms.doorOffsets;shader.uniforms.doorGlowColor=uniforms.doorGlowColor;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',VERTEX_HEAD).replace('#include <begin_vertex>',VERTEX_MOVE);
  // 深度材質沒有自發光那一段，只多宣告不使用。
  if(shader.fragmentShader)shader.fragmentShader=shader.fragmentShader.replace('#include <common>',FRAGMENT_HEAD).replace('#include <emissivemap_fragment>',FRAGMENT_GLOW);};
 material.customProgramCacheKey=()=>'garage-doors-v1';material.needsUpdate=true;return material;
}
export function createDoorControl(cars){
 const rows=[],q=new THREE.Quaternion(),v=new THREE.Vector3();
 for(const c of cars){const items=c.asset.doors?.items;if(!items?.length)continue;const g=c.asset.geometry;
  if(!g.getAttribute('doorIndex'))g.setAttribute('doorIndex',new THREE.BufferAttribute(buildDoorIndex(g.getAttribute('position').count,items),1));
  if(!g.getAttribute('doorGlow'))g.setAttribute('doorGlow',new THREE.BufferAttribute(buildDoorGlow(g.getAttribute('position'),items,g.getAttribute('doorIndex').array),1));
  const uniforms={doorOffsets:{value:Array.from({length:MAX_DOORS},()=>new THREE.Vector3())},doorGlowColor:{value:new THREE.Color(0,0,0)}},owned=[];
  // 車燈模組已替發光材質各做一份複本（它的 rows 還握著那幾份）；那幾份直接加上車門位移，其餘共用材質這裡才複製，每節車各一份。
  c.litMaterials=c.litMaterials.map((m,i)=>{if(m!==c.asset.materials[i])return patch(m,uniforms);const copy=patch(m.clone(),uniforms);owned.push(copy);return copy;});
  c.body.material=c.litMaterials;
  // 陰影跟著門走：同樣位移的深度材質。
  const depth=patch(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),uniforms);c.body.customDepthMaterial=depth;owned.push(depth);
  // 門廳跟著這節車的窗燈亮：車燈模組每個時段改的是這一份（傍晚、夜晚亮，白天 0）。
  rows.push({c,items,uniforms,owned,side:0,open:0,window:c.litMaterials.find(m=>m.userData.railLightingRole==='window')});
 }
 // open＝門開度 0..1；normal＝從軌道指向月台的世界方向。只開月台那一側。
 function update(open,normal){
  for(const r of rows){r.c.car.getWorldQuaternion(q);r.side=platformSide(q,normal);r.open=open;
   if(r.window)r.uniforms.doorGlowColor.value.copy(r.window.emissive).multiplyScalar(r.window.emissiveIntensity);
   r.items.forEach((d,k)=>{const o=d.side===r.side?doorOffset(d,open):[0,0,0];r.uniforms.doorOffsets.value[k].set(o[0],o[1],o[2]);});}
 }
 // 關門位置的門中心（世界座標）：which='platform' 取月台側，其餘取另一側。
 function points(which='platform'){
  const out=[];
  for(const r of rows){r.c.body.updateWorldMatrix(true,false);
   for(const d of r.items)if((which==='platform')===(d.side===r.side))out.push({id:r.c.id+':'+d.id,car:r.c,door:d,point:v.set(...d.center).applyMatrix4(r.c.body.matrixWorld).clone()});}
  return out;
 }
 return{update,points,
  get state(){return rows.map(r=>({car:r.c.id,side:r.side,open:r.open,moving:r.items.filter(d=>d.side===r.side&&r.open>0).map(d=>d.id)}));},
  dispose(){for(const r of rows)r.owned.forEach(m=>m.dispose());}};
}
